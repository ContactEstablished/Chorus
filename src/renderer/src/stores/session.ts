import { defineStore } from 'pinia'
import type { SessionStatus } from '../../../shared/ipc'

interface SessionState {
  sessionId: string | null
  status: SessionStatus | 'detached'
  exitCode: number | null
}

export const useSessionStore = defineStore('session', {
  state: (): SessionState => ({
    sessionId: null,
    status: 'detached',
    exitCode: null
  }),
  actions: {
    attached(sessionId: string, status: SessionStatus, exitCode: number | null) {
      this.sessionId = sessionId
      this.status = status
      this.exitCode = exitCode
    },
    exited(exitCode: number) {
      this.status = 'exited'
      this.exitCode = exitCode
    }
  }
})
