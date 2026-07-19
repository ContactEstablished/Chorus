import { defineStore } from 'pinia'
import type { AgentKind, SessionStatus } from '../../../shared/ipc'

/** Coarse lifecycle shown by the pane header dot, derived from status + exitCode. */
export type DotStatus = 'detached' | 'running' | 'exited-ok' | 'exited-error'

interface PaneSessionState {
  sessionId: string | null
  status: SessionStatus | 'detached'
  exitCode: number | null
  /** True while a kill/restart is in flight; disables the header buttons. */
  busy: boolean
}

function detached(): PaneSessionState {
  return { sessionId: null, status: 'detached', exitCode: null, busy: false }
}

/** One entry per agent kind: two concurrent sessions with independent state. */
export const useSessionStore = defineStore('session', {
  state: (): { sessions: Record<AgentKind, PaneSessionState> } => ({
    sessions: {
      claude: detached(),
      codex: detached()
    }
  }),
  getters: {
    /** Header-dot status: exit code 0 -> gray (ok), non-zero -> red (error). */
    dotStatus:
      (state) =>
      (agent: AgentKind): DotStatus => {
        const s = state.sessions[agent]
        if (s.status === 'running') return 'running'
        if (s.status === 'exited') return s.exitCode === 0 ? 'exited-ok' : 'exited-error'
        return 'detached'
      }
  },
  actions: {
    attached(agent: AgentKind, sessionId: string, status: SessionStatus, exitCode: number | null) {
      this.sessions[agent] = { sessionId, status, exitCode, busy: false }
    },
    exited(agent: AgentKind, exitCode: number) {
      this.sessions[agent].status = 'exited'
      this.sessions[agent].exitCode = exitCode
      this.sessions[agent].busy = false
    },
    setBusy(agent: AgentKind, busy: boolean) {
      this.sessions[agent].busy = busy
    }
  }
})
