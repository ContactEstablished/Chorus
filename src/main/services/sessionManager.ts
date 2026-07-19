import { randomUUID } from 'crypto'
import * as pty from 'node-pty'
import { resolveClaudeCli } from './cliDetect'

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
  pty: pty.IPty
  buffer: string
  status: 'running' | 'exited'
  exitCode: number | null
}

type DataListener = (sessionId: string, data: string) => void
type ExitListener = (sessionId: string, exitCode: number) => void

/**
 * Owns PTY sessions in the main process. Renderers are views: they attach by
 * sessionId over IPC and never touch the process. Phase 0 manages exactly one
 * session (Claude Code); the map-of-sessions shape it will grow into is
 * deliberately kept simple here.
 */
export class SessionManager {
  private session: PtySession | null = null
  private dataListeners = new Set<DataListener>()
  private exitListeners = new Set<ExitListener>()

  /** Attach to the current session, starting it if needed. */
  attach(cwd: string): SessionSnapshot {
    if (!this.session || this.session.status === 'exited') {
      this.session = this.spawn(cwd)
    }
    const s = this.session
    return { sessionId: s.id, buffer: s.buffer, status: s.status, exitCode: s.exitCode }
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

  onData(listener: DataListener): void {
    this.dataListeners.add(listener)
  }

  onExit(listener: ExitListener): void {
    this.exitListeners.add(listener)
  }

  /** Kill the PTY (and its process tree, via ConPTY teardown) on app quit. */
  dispose(): void {
    if (this.session && this.session.status === 'running') {
      this.session.pty.kill()
    }
    this.session = null
  }

  private spawn(cwd: string): PtySession {
    const cli = resolveClaudeCli()
    const id = randomUUID()

    const child = pty.spawn(cli.file, cli.args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      // Inherit the app environment untouched. Claude Code uses its own
      // subscription login; no credentials are injected or logged here.
      env: process.env as Record<string, string>,
      useConpty: true
    })

    const session: PtySession = { id, pty: child, buffer: '', status: 'running', exitCode: null }

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
    if (!this.session || this.session.id !== sessionId) {
      throw new Error(`Unknown sessionId: ${sessionId}`)
    }
    return this.session
  }
}
