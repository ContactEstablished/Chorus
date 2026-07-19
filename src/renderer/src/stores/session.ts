import { defineStore } from 'pinia'
import type { AgentKind, SessionStatus } from '../../../shared/ipc'

interface PaneSessionState {
  sessionId: string | null
  status: SessionStatus | 'detached'
  exitCode: number | null
}

function detached(): PaneSessionState {
  return { sessionId: null, status: 'detached', exitCode: null }
}

/** One entry per agent kind: two concurrent sessions with independent state. */
export const useSessionStore = defineStore('session', {
  state: (): { sessions: Record<AgentKind, PaneSessionState> } => ({
    sessions: {
      claude: detached(),
      codex: detached()
    }
  }),
  actions: {
    attached(agent: AgentKind, sessionId: string, status: SessionStatus, exitCode: number | null) {
      this.sessions[agent] = { sessionId, status, exitCode }
    },
    exited(agent: AgentKind, exitCode: number) {
      this.sessions[agent].status = 'exited'
      this.sessions[agent].exitCode = exitCode
    }
  }
})
