import * as pty from 'node-pty'
import fs from 'node:fs'
import { getAdapterOrThrow } from '../adapters/registry'
import { isPtyAdapter, type PtyLaunchRoute, type ResolvedCredential } from '../adapters/types'
import { composeChildEnv } from '../adapters/env'
import { computeRestoreSet } from './restore'
import { logger } from './logger'
import { createSessionOutput, type SessionOutput } from './sessionOutput'
import type { AgentKind } from '../../shared/ipc'
import type { StorageService } from './storage'

/**
 * Ring buffer cap for session replay, in characters. Roughly 50k lines of
 * typical terminal output. Full transcript-to-disk mirroring comes later.
 */
const BUFFER_MAX_CHARS = 4_000_000

/** D33 resolution (e): a held carry (a chunk tail that could be the start of
 *  a secret) is released by timer so a TUI pausing mid-prefix never stalls
 *  rendering. 50 ms is long enough that a normal output burst never triggers
 *  a mid-burst flush, short enough to be imperceptible — measured at runtime
 *  (Task 3-5 verification), not just asserted. */
const SCRUB_FLUSH_MS = 50

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
  status: 'running' | 'exited'
  exitCode: number | null
  /** Task 3a-1: end intent, set by kill()/dispose() BEFORE pty.kill() so the
   *  exit event can never race the flag and misclassify a user kill as an
   *  agent failure. Lives on the session record, so it dies with the record. */
  killRequested: boolean
  /** The session-shaped ingest pipeline (Task 3-6 Commit 1, D46): scrub →
   *  ring buffer → broadcast, plus the carry-flush timer. Its scrubber
   *  closure is — via the match set — THE ONLY PLACE in Chorus that retains
   *  injected plaintext beyond the spawn call.
   *
   *  D33 resolution (a), verbatim in intent: clause 4 says the decrypted
   *  plaintext "never enters a retained variable". Exact-match scrubbing
   *  REQUIRES exactly that, so clause 4 carries an explicit carve-out for this
   *  match set: main memory only, never persisted, never logged, never sent
   *  over IPC, cleared on session end.
   *
   *  NAMED LIMIT: this widens the crash-dump exposure window from the
   *  milliseconds of a spawn call to the lifetime of the session. Ratified as
   *  sound without a council round-trip because an attacker who can read this
   *  heap can already read the child process's environment block — the same
   *  excluded threat class, a longer duration, no new class.
   *
   *  The match set dies with this object — the closure IS the storage, so
   *  there is no separate structure to forget to clear (safer by construction
   *  than a Map<sessionId, Set<string>> alongside). */
  output: SessionOutput
}

type DataListener = (sessionId: string, data: string) => void
type ExitListener = (sessionId: string, exitCode: number) => void
type RestoredListener = (sessionId: string) => void

/** What a dispatch record needs and `spawn` already has (Task 3a-1).
 *  Deliberately a plain fact bundle, not a telemetry type: SessionManager
 *  announces lifecycle and stays ignorant of what listens. */
export interface SessionStartInfo {
  readonly sessionId: string
  readonly agent: AgentKind
  readonly cwd: string
  /** D42's discriminator, derived from the SAME fact composeChildEnv uses to
   *  select its policy: a credential is present, or it is not. */
  readonly authMode: 'subscription' | 'api_key'
  readonly model: string | null
  readonly providerName: string | null
}
type StartListener = (info: SessionStartInfo) => void

/** What a BYOK launch carries beyond a plain one (Task 3-6). All three are
 *  produced by the IPC layer's resolveCredential step, which retains nothing
 *  after the launch call returns (D33 clause 4). */
export interface LaunchOptions {
  /** Exact values to register with the per-session scrubber (3-5's seam).
   *  The spawn-time registration set is the UNION of this and the request's
   *  secretEnv values, so "injected" and "scrubbed" cannot diverge. */
  readonly secrets?: readonly string[]
  /** The decrypted credential, handed to the adapter's buildLaunch. */
  readonly credential?: ResolvedCredential
  /** The route's non-secret connection metadata (D47/D48), for adapters that
   *  point the CLI at a custom endpoint. */
  readonly route?: PtyLaunchRoute
}

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
  private startListeners = new Set<StartListener>()
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
   *
   * `opts.secrets` are exact values to register with the per-session scrubber
   * so Chorus never STORES or REPLAYS them (D33 clause 7); `opts.credential`
   * and `opts.route` flow into the adapter's buildLaunch. Task 3-6 is the one
   * legal caller.
   *
   * SETTLED by Task 3-6 Step 7 (decision (b), F26): the restore path
   * (restore() -> this.spawn) passes NO options, and credentialed sessions
   * are NEVER auto-restored — restore() heals their rows to 'exited' instead
   * of relaunching them keyless. A restored BYOK session running silently on
   * ambient credentials is the one unacceptable outcome.
   */
  launch(agent: AgentKind, cwd: string, sessionId: string, opts: LaunchOptions = {}): SessionSnapshot {
    const session = this.spawn(agent, cwd, sessionId, opts)
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
    // Task 3-6 Step 7, decision (b) — F26 settled: a session that launched on
    // a stored credential is NEVER auto-restored. Re-resolving it would mean
    // UNATTENDED DECRYPTION AT BOOT (a wider surface than D33's
    // decrypt-on-explicit-user-action model); relaunching it keyless would
    // silently run the agent on ambient credentials while the user believes
    // it runs on their profile — the one unacceptable outcome. So its row is
    // healed to honest exited chrome and its title carries the reason. The
    // mark SURVIVES the heal: session:restart refuses the row on the same
    // grounds, and only session:delete clears it.
    const credentialed = storage.getCredentialedSessionIds()
    let spawned = 0
    try {
      for (const row of set.toRelaunch) {
        if (credentialed.has(row.id)) {
          storage.updateSessionStatus(row.id, 'exited', row.exitCode ?? null)
          storage.updateSessionTitle(
            row.id,
            'Credential not re-supplied — relaunch from the dialog to re-enter it'
          )
          logger.info(`[restore] credentialed session healed -> exited (no keyless restore): ${row.id}`)
          conclude(row.id)
          continue
        }
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
    // Set BEFORE the kill: the exit event can arrive immediately, and a flag
    // set afterwards is a race that misclassifies user kills as failures —
    // intermittently, which is the worst kind (Task 3a-1).
    session.killRequested = true
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

  onStart(listener: StartListener): void {
    this.startListeners.add(listener)
  }

  /** Task 3a-1: true when kill()/dispose() initiated this session's end — the
   *  dispatch classifier's "user abandoned it" fact. The flag lives on the
   *  session record, so it dies with the record and leaks nothing. */
  wasKilledByChorus(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.killRequested ?? false
  }

  /** Kill all live PTYs (and their process trees, via ConPTY teardown) on app quit. */
  dispose(): void {
    for (const session of this.sessions.values()) {
      // A leaked timer holds a closure over the match set past teardown.
      session.output.dispose()
      if (session.status === 'running') {
        // Same before-the-kill ordering as kill(): an exit delivered during
        // teardown must still classify as intent, not failure (Task 3a-1).
        session.killRequested = true
        session.pty.kill()
      }
    }
    this.sessions.clear()
  }

  private snapshot(session: PtySession): SessionSnapshot {
    return {
      sessionId: session.id,
      buffer: session.output.buffer,
      status: session.status,
      exitCode: session.exitCode
    }
  }

  private spawn(agent: AgentKind, cwd: string, sessionId: string, opts: LaunchOptions = {}): PtySession {
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
    const request = adapter.buildLaunch({
      sessionId,
      cwd,
      credential: opts.credential,
      route: opts.route
    })
    // Stable identity: the sessions DB row id. Fresh PTYs are re-created
    // under the same id by the restore engine and session:restart.
    const id = sessionId

    // SUPERSEDES D5 (Phase 0 → Task 3-6). Env policy has ONE owner and this is
    // the call site (D34(d)): a launch with no credential inherits process.env
    // wholesale, exactly as it always has (D33 resolution c); a credential-
    // bearing launch gets a constructed allow-list so the developer's ambient
    // provider keys do not ride along (D33 clause 4). The key travels ONLY in
    // this env block — never in argv, never in a log, never on disk.
    const env = composeChildEnv({
      parentEnv: process.env,
      requiredEnvVars: adapter.requiredEnvVars,
      envAdditions: request.envAdditions,
      secretEnv: request.secretEnv
    })

    const child = pty.spawn(request.executable, [...request.args], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: request.cwd,
      env,
      useConpty: true
    })

    // Scrubber registration derives from what is ACTUALLY being injected
    // (request.secretEnv's values), unioned with the caller's explicit list —
    // so "injected" and "scrubbed" cannot diverge, and a separately-passed
    // list is never the only place a value is registered. createScrubber
    // dedupes, empty-filters and sorts longest-first, so the union needs no
    // pre-processing here.
    const secrets = [...(opts.secrets ?? []), ...Object.values(request.secretEnv)]

    // Task 3-6 Commit 1 (D46): the whole output pipeline — scrubber, carry-
    // flush timer, ring buffer, broadcast — lives in ONE session-shaped
    // object (D45 mitigation 1: scrubbing is a property of "a session emits
    // text", not "a PTY emits text"). Constructed in the SAME synchronous
    // block as pty.spawn and the onData wiring: one tick later and the first
    // chunk — exactly when a shell might echo its environment — is lost or
    // unscrubbed.
    const output = createSessionOutput({
      secrets,
      maxChars: BUFFER_MAX_CHARS,
      flushMs: SCRUB_FLUSH_MS,
      onText: (text) => {
        for (const listener of this.dataListeners) listener(id, text)
      }
    })

    const session: PtySession = {
      id,
      agent,
      pty: child,
      status: 'running',
      exitCode: null,
      killRequested: false,
      // Task 3-5 (D33 clause 7): exact-value scrub on INGEST, so the ring
      // buffer, the session:data stream, and attach()'s replay all see only
      // scrubbed text. A no-credential launch registers zero secrets — the
      // identity fast path makes that case free.
      output
    }

    child.onData((data) => output.ingest(data))

    child.onExit(({ exitCode }) => {
      session.status = 'exited'
      session.exitCode = exitCode
      // Don't strand a held tail on exit — flush BEFORE notifying, so the
      // renderer receives the final bytes before the exit event.
      output.flush()
      for (const listener of this.exitListeners) listener(id, exitCode)
    })

    // Additive announcement (Task 3a-1), AFTER the PTY exists and the output
    // pipeline is wired, so it can never precede a working session — and a
    // throwing spawn above leaves no listener-fired row behind. Defensive by
    // construction: this is a NEW loop, so wrapping it changes nothing that
    // exists, and a throwing listener must never be able to fail a launch.
    const startInfo: SessionStartInfo = {
      sessionId: id,
      agent,
      cwd: request.cwd,
      authMode: opts.credential ? 'api_key' : 'subscription',
      model: opts.route?.modelId ?? null,
      providerName: opts.route?.providerName ?? null
    }
    for (const listener of this.startListeners) {
      try {
        listener(startInfo)
      } catch (err) {
        logger.error({ err }, '[session] start listener threw')
      }
    }

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
