import { BrowserWindow, Notification } from 'electron'
import type { AgentKind } from '../../shared/ipc'
import type { SessionManager } from './sessionManager'
import { logger } from './logger'

// ⚠ `Record<AgentKind, string>` ON PURPOSE — a Partial or an index signature
// would let a new agent kind ship with a toast that says "Agent". D86 added
// 'kimi' and the COMPILER found this file; D90 added 'opencode' and it found it
// again. That is the property working, not a chore. Labels mirror each
// adapter's own `displayName`.
const AGENT_LABELS: Record<AgentKind, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  kimi: 'Kimi Code',
  opencode: 'opencode'
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
    // Assist; log the lifecycle so a missing toast is diagnosable from the log.
    toast.on('show', () => logger.info(`[notify] toast shown: ${label} exited (${exitCode})`))
    toast.on('failed', (_e, error) => logger.info(`[notify] toast failed: ${error}`))
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
