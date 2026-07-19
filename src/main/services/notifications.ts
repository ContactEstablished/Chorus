import { BrowserWindow, Notification } from 'electron'
import type { AgentKind } from '../../shared/ipc'
import type { SessionManager } from './sessionManager'

const AGENT_LABELS: Record<AgentKind, string> = {
  claude: 'Claude Code',
  codex: 'Codex'
}

/**
 * Phase 0 notification engine: an OS toast when a session's process exits,
 * clicking it focuses the app window. Policies, the hook listener, and the
 * event bus arrive in Phase 4.
 */
export function watchSessionExits(sessions: SessionManager): void {
  sessions.onExit((sessionId, exitCode) => {
    if (!Notification.isSupported()) return
    const agent = sessions.getAgent(sessionId)
    const label = agent ? AGENT_LABELS[agent] : 'Agent'
    const toast = new Notification({
      title: 'Chorus',
      body: `${label} exited (code ${exitCode})`
    })
    // Windows silently drops toasts from unregistered AUMIDs and under Focus
    // Assist; log the lifecycle so a missing toast is diagnosable from the console.
    toast.on('show', () => console.log(`[notify] toast shown: ${label} exited (${exitCode})`))
    toast.on('failed', (_e, error) => console.log(`[notify] toast failed: ${error}`))
    toast.on('click', () => {
      const win = BrowserWindow.getAllWindows()[0]
      if (!win) return
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    })
    toast.show()
  })
}
