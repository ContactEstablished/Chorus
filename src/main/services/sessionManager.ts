import * as pty from 'node-pty'
import fs from 'node:fs'
import { getAdapterOrThrow } from '../adapters/registry'
import { isPtyAdapter } from '../adapters/types'
import { computeRestoreSet } from './restore'
import { logger } from './logger'
import type { AgentKind } from '../../shared/ipc'
import type { StorageService } from './storage'

/**
 * Ring buffer cap for session replay, in characters. Roughly 50k lines of
 * typical terminal output. Full transcript-to-disk mirroring comes later.
 */
const BUFFER_MAX_CHARS = 4_000_000

/** D16: spawns within one restore run are staggered to keep ConPTY creation
 *  off the UI thread's critical path. */
const RESTORE_STAGGER_MS = 500
/** Soft cap on restore relaunches per project per run — bounds process count
 *  against a pathological persisted layout (spec §6/§12). Beyond-cap members
 *  are healed to exited chrome, never spawned. */
const RESTORE_CAP = 16

export interface SessionSnapshot {
  sessionId: string
  buffer: string
  status: 'running' | 'exited'
  exitCode: number | null
}

interface PtySession {
  id: string
  agent: AgentKind
  pty: pty.IPty
  buffer: string
  status: 'running' | 'exited'
  exitCode: number | null
}

type DataListener = (sessionId: string, data: string) => void
type ExitListener = (sessionId: string, exitCode: number) => void
type RestoredListener = (sessionId: string) => void

/**
 * Owns PTY sessions in the main process. Renderers are views: they attach by
 * sessionId over IPC and never touch the process. N concurrent sessions per
 * agent kind are supported (Task 1-4): each session is a distinct sessions-row
 * id + PTY, and no lookup ever collapses same-kind sessions together.
 *
 * Storage reaches this class ONLY for the D16 restore engine (heal writes and
 * the after-success 'running' write are the contract's own steps); launch/
 * attach keep the 1-4 division of labor — the IPC layer owns rows.
 */
export class SessionManager {
  private sessions = new Map<string, PtySession>()
  private dataListeners = new Set<DataListener>()
  private exitListeners = new Set<ExitListener>()
  private restoredListeners = new Set<RestoredListener>()
  private storage: StorageService | null = null
  /** Restore-relaunched sessions whose pane has not attached since — the badge
   *  signal. An entry is consumed by the first attach that reports it, so
   *  every restored pane wears the fresh-conversation badge exactly once, no
   *  matter how late it mounts (a timestamp window would lose slow dev cold
   *  starts — found at runtime in 1-5 verification). */
  private restoredUnbadged = new Set<string>()
  /** projectId -> restore-set ids queued but not yet spawned this run. */
  private restorePending = new Map<string, Set<string>>()

  /** Called once from the boot sequence after storage init (the manager is
   *  constructed at module scope, before the DB exists). */
  bindStorage(storage: StorageService): void {
    this.storage = storage
  }

  /**
   * Launch a brand-new session: spawn a fresh PTY under the given stable
   * sessions-row id (the IPC layer creates the row first — launch is the only
   * op that starts a PTY for a session this manager has never seen).
   */
  launch(agent: AgentKind, cwd: string, sessionId: string): SessionSnapshot {
    const session = this.spawn(agent, cwd, sessionId)
    this.sessions.set(sessionId, session)
    return this.snapshot(session)
  }

  /**
   * Reattach a view to a session this manager already knows, replaying its
   * buffered output. A PURE VIEW BINDING — no spawn path at all (Task 1-5/D16:
   * the 1-4 attach-time relaunch gate is removed; Vue remounts panes on
   * sibling close, so attach must never resurrect a session — F5). An unknown id yields
   * `null` so the caller reports the row's persisted exit state; relaunch
   * lives in `restore()` and the session:restart channel only.
   */
  attach(sessionId: string): SessionSnapshot | null {
    const existing = this.sessions.get(sessionId)
    if (!existing) return null
    return this.snapshot(existing)
  }

  /**
   * The D16 restore contract, run at boot (active project) and on first tab
   * activation (lazy). Order matters:
   *   1. HEAL FIRST — every persisted 'running' row with no layout leaf is
   *      flipped to 'exited' BEFORE any spawn (the invisible-process guard:
   *      no PTY may exist that no pane can reach).
   *   2. Relaunch the restore set (leaves ∩ 'running' rows, minus live) under
   *      the ORIGINAL row ids with fresh PTYs: cwd re-validated per spawn
   *      (missing -> heal + the pane's own "Working directory not found"
   *      chrome, no sentinel exit code), 'running' written ONLY AFTER the
   *      spawn succeeds, spawns staggered, each success announced via
   *      onRestored for the fresh-conversation badge.
   * Idempotent within a run: healed rows stay healed, live sessions are
   * excluded by computeRestoreSet's live guard.
   */
  async restore(projectId: string): Promise<void> {
    const storage = this.requireStorage()
    const set = computeRestoreSet(
      storage.getPaneLayout(projectId),
      storage.getSessionsForProject(projectId),
      new Set(this.sessions.keys())
    )

    // better-sqlite3 is synchronous: the heal block and the selection read are
    // transactionally adjacent by construction (findings action 2).
    for (const row of set.toHeal) {
      storage.updateSessionStatus(row.id, 'exited', row.exitCode ?? null)
      logger.info(`[restore] healed running row with no layout leaf -> exited: ${row.id}`)
    }

    const pending = new Set(set.toRelaunch.map((r) => r.id))
    this.restorePending.set(projectId, pending)
    // Every member's conclusion is announced, success or not: a pane holding a
    // restorePending spinner re-attaches on the event and lands on live chrome
    // (running) or honest exited chrome (heal / cwd-missing / spawn failure).
    const conclude = (sessionId: string): void => {
      pending.delete(sessionId)
      for (const listener of this.restoredListeners) listener(sessionId)
    }
    let spawned = 0
    try {
      for (const row of set.toRelaunch) {
        if (spawned >= RESTORE_CAP) {
          storage.updateSessionStatus(row.id, 'exited', row.exitCode ?? null)
          logger.info(`[restore] cap ${RESTORE_CAP} reached; healed beyond-cap row -> exited: ${row.id}`)
          conclude(row.id)
          continue
        }
        if (!fs.existsSync(row.cwd)) {
          // Own chrome state ("Working directory not found"), resolved at
          // attach time from the row — no sentinel exit code (resolution c).
          storage.updateSessionStatus(row.id, 'exited', row.exitCode ?? null)
          logger.info(`[restore] cwd missing, healed -> exited: ${row.id} (${row.cwd})`)
          conclude(row.id)
          continue
        }
        try {
          const session = this.spawn(row.agent as AgentKind, row.cwd, row.id)
          this.sessions.set(row.id, session)
          // 'running' is written ONLY AFTER the spawn succeeds (resolution a):
          // a crash between spawn and write leaves the row 'exited', which is
          // self-consistent at the next boot's reconcile.
          storage.updateSessionStatus(row.id, 'running', null)
          this.restoredUnbadged.add(row.id)
          logger.info(`[restore] relaunched ${row.agent} session ${row.id}`)
          spawned++
        } catch (err) {
          // Spawn threw: no PTY exists, so the row must not say 'running'.
          storage.updateSessionStatus(row.id, 'exited', row.exitCode ?? null)
          logger.error({ err }, `[restore] spawn failed for ${row.id}:`)
        }
        conclude(row.id)
        await new Promise((resolve) => setTimeout(resolve, RESTORE_STAGGER_MS))
      }
    } finally {
      this.restorePending.delete(projectId)
    }
  }

  /** True while a live (running) PTY exists for this id — session:restart and
   *  session:delete both refuse to touch a live session. */
  isRunning(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.status === 'running'
  }

  /** Restore engine has this id queued for a staggered relaunch right now. */
  isRestorePending(sessionId: string): boolean {
    for (const pending of this.restorePending.values()) {
      if (pending.has(sessionId)) return true
    }
    return false
  }

  /** Consume the restore badge signal for an attach: true exactly once per
   *  restore relaunch — the first attach to report it wears the badge. */
  consumeRestoredBadge(sessionId: string): boolean {
    return this.restoredUnbadged.delete(sessionId)
  }

  onRestored(listener: RestoredListener): void {
    this.restoredListeners.add(listener)
  }

  /** Kill a live session by id. State transition is handled by the existing
   *  onExit handler — do NOT mutate status here. No-op if already exited. */
  kill(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    if (session.status === 'exited') return
    session.pty.kill()
  }

  write(sessionId: string, data: string): void {
    const s = this.requireSession(sessionId)
    if (s.status !== 'running') return
    s.pty.write(data)
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const s = this.requireSession(sessionId)
    if (s.status !== 'running') return
    s.pty.resize(cols, rows)
  }

  /** Which agent a session belongs to (undefined when the manager has never
   *  seen the id this run). */
  getAgent(sessionId: string): AgentKind | undefined {
    return this.sessions.get(sessionId)?.agent
  }

  onData(listener: DataListener): void {
    this.dataListeners.add(listener)
  }

  onExit(listener: ExitListener): void {
    this.exitListeners.add(listener)
  }

  /** Kill all live PTYs (and their process trees, via ConPTY teardown) on app quit. */
  dispose(): void {
    for (const session of this.sessions.values()) {
      if (session.status === 'running') {
        session.pty.kill()
      }
    }
    this.sessions.clear()
  }

  private snapshot(session: PtySession): SessionSnapshot {
    return {
      sessionId: session.id,
      buffer: session.buffer,
      status: session.status,
      exitCode: session.exitCode
    }
  }

  private spawn(agent: AgentKind, cwd: string, sessionId: string): PtySession {
    // Task 3-3: the adapter owns HOW this agent starts. The registry lookup is
    // a genuine RUNTIME check even though `agent` is typed — sessions.agent is
    // a TEXT column, so the caller's cast is unsound by construction and this
    // is where that unsoundness is caught. UnknownAgentError propagates to the
    // restore engine's existing catch, which heals the row to 'exited' and
    // logs it (D34(c)) — no new failure path, no new status value.
    const adapter = getAdapterOrThrow(agent)
    if (!isPtyAdapter(adapter)) {
      throw new Error(`Agent '${agent}' is not a PTY agent`)
    }
    const request = adapter.buildLaunch({ sessionId, cwd })
    // Stable identity: the sessions DB row id. Fresh PTYs are re-created
    // under the same id by the restore engine and session:restart.
    const id = sessionId

    const child = pty.spawn(request.executable, [...request.args], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: request.cwd,
      // UNCHANGED (D5 still stands until Task 3-6): both agents use their own
      // subscription logins; no credentials are injected or logged here.
      // request.envAdditions and request.secretEnv are both {} this task and
      // are DELIBERATELY not merged in — merging empty objects would quietly
      // move env composition into this commit, where it cannot be reviewed
      // against D33. Task 3-6 replaces this line and this comment together.
      env: process.env as Record<string, string>,
      useConpty: true
    })

    const session: PtySession = {
      id,
      agent,
      pty: child,
      buffer: '',
      status: 'running',
      exitCode: null
    }

    child.onData((data) => {
      session.buffer += data
      if (session.buffer.length > BUFFER_MAX_CHARS) {
        session.buffer = session.buffer.slice(session.buffer.length - BUFFER_MAX_CHARS)
      }
      for (const listener of this.dataListeners) listener(id, data)
    })

    child.onExit(({ exitCode }) => {
      session.status = 'exited'
      session.exitCode = exitCode
      for (const listener of this.exitListeners) listener(id, exitCode)
    })

    return session
  }

  private requireSession(sessionId: string): PtySession {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`Unknown sessionId: ${sessionId}`)
    }
    return session
  }

  private requireStorage(): StorageService {
    if (!this.storage) {
      throw new Error('SessionManager: bindStorage() was not called before restore()')
    }
    return this.storage
  }
}
