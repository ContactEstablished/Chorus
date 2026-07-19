import * as pty from 'node-pty'
import { resolveCli } from './cliDetect'
import type { AgentKind } from '../../shared/ipc'

/**
 * Ring buffer cap for session replay, in characters. Roughly 50k lines of
 * typical terminal output. Full transcript-to-disk mirroring comes later.
 */
const BUFFER_MAX_CHARS = 4_000_000

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

/**
 * Owns PTY sessions in the main process. Renderers are views: they attach by
 * sessionId over IPC and never touch the process. N concurrent sessions per
 * agent kind are supported (Task 1-4): each session is a distinct sessions-row
 * id + PTY, and no lookup ever collapses same-kind sessions together.
 */
export class SessionManager {
  private sessions = new Map<string, PtySession>()
  private dataListeners = new Set<DataListener>()
  private exitListeners = new Set<ExitListener>()

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
   * buffered output. Never spawns for an unknown id: a row from a previous app
   * run yields `null` so the caller reports the row's persisted exit state
   * (no auto-relaunch — Task 1-5 owns restore). A KNOWN session whose PTY
   * exited is reported dead as-is, UNLESS the caller is the renderer Restart
   * chrome (`respawn: true`, sent only after kill -> await exit): that is the
   * sole respawn path, under the same stable row id. A plain view attach must
   * not resurrect a killed session — Vue remounts panes when sibling leaves
   * are removed, and a remount is not a Restart.
   */
  attach(
    opts: { sessionId: string; agent: AgentKind; respawn?: boolean },
    cwd: string
  ): SessionSnapshot | null {
    const { sessionId, agent, respawn } = opts
    const existing = this.sessions.get(sessionId)
    if (!existing) return null
    if (existing.status === 'exited') {
      if (!respawn) return this.snapshot(existing)
      this.sessions.delete(sessionId)
      const session = this.spawn(agent, cwd, sessionId)
      this.sessions.set(sessionId, session)
      return this.snapshot(session)
    }
    return this.snapshot(existing)
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

  /** Which agent a session belongs to (undefined after a respawn replaces it). */
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
    const cli = resolveCli(agent)
    // Stable identity: the sessions DB row id. The PTY is re-created under
    // the same id on every respawn (renderer Restart).
    const id = sessionId

    const child = pty.spawn(cli.file, cli.args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      // Inherit the app environment untouched. Both agents use their own
      // subscription logins; no credentials are injected or logged here.
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
}
