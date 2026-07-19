import { randomUUID } from 'crypto'
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
 * sessionId over IPC and never touch the process. Phase 0 keeps at most one
 * live session per agent kind; arbitrary concurrent sessions per agent arrive
 * with the launch dialog in Phase 1.
 */
export class SessionManager {
  private sessions = new Map<string, PtySession>()
  private dataListeners = new Set<DataListener>()
  private exitListeners = new Set<ExitListener>()

  /** Attach to the agent's session, starting it if none is running. */
  attach(agent: AgentKind, cwd: string): SessionSnapshot {
    let session = this.findByAgent(agent)
    if (!session || session.status === 'exited') {
      if (session) this.sessions.delete(session.id)
      session = this.spawn(agent, cwd)
      this.sessions.set(session.id, session)
    }
    return {
      sessionId: session.id,
      buffer: session.buffer,
      status: session.status,
      exitCode: session.exitCode
    }
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

  private findByAgent(agent: AgentKind): PtySession | undefined {
    for (const session of this.sessions.values()) {
      if (session.agent === agent) return session
    }
    return undefined
  }

  private spawn(agent: AgentKind, cwd: string): PtySession {
    const cli = resolveCli(agent)
    const id = randomUUID()

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
