import { defineStore } from 'pinia'
import type { AgentKind, SessionStatus } from '../../../shared/ipc'

/** Coarse lifecycle shown by the pane header dot, derived from status + exitCode. */
export type DotStatus = 'detached' | 'running' | 'exited-ok' | 'exited-error'

export interface PaneSessionState {
  /** Agent kind, kept for labels/icons — never the key into this store (D10). */
  agent: AgentKind
  status: SessionStatus | 'detached'
  exitCode: number | null
  /** True while a kill/restart is in flight; disables the header buttons. */
  busy: boolean
}

/**
 * Per-session pane state, keyed by the stable sessions-row id (D10). Entries
 * are created by `attached()` on launch/attach, never pre-seeded: N concurrent
 * sessions of the same agent kind are N independent entries, so two Codex
 * panes never share status, busy flags, or exit events.
 */
export const useSessionStore = defineStore('session', {
  state: (): { sessions: Record<string, PaneSessionState> } => ({ sessions: {} }),
  getters: {
    /** Header-dot status: exit code 0 -> gray (ok), non-zero -> red (error). */
    dotStatus:
      (state) =>
      (sessionId: string): DotStatus => {
        const s = state.sessions[sessionId]
        if (!s) return 'detached'
        if (s.status === 'running') return 'running'
        if (s.status === 'exited') return s.exitCode === 0 ? 'exited-ok' : 'exited-error'
        return 'detached'
      }
  },
  actions: {
    attached(sessionId: string, agent: AgentKind, status: SessionStatus, exitCode: number | null) {
      this.sessions[sessionId] = { agent, status, exitCode, busy: false }
    },
    exited(sessionId: string, exitCode: number) {
      const s = this.sessions[sessionId]
      if (!s) return
      s.status = 'exited'
      s.exitCode = exitCode
      s.busy = false
    },
    setBusy(sessionId: string, busy: boolean) {
      const s = this.sessions[sessionId]
      if (s) s.busy = busy
    }
  }
})
