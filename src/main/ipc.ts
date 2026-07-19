import { BrowserWindow, ipcMain } from 'electron'
import {
  IpcChannel,
  attachRequestSchema,
  writeRequestSchema,
  resizeRequestSchema,
  killRequestSchema,
  sessionDataEventSchema,
  sessionExitEventSchema,
  cliDetectRequestSchema,
  layoutGetRequestSchema,
  layoutGetResponseSchema,
  type AttachResponse,
  type CliDetectResponse,
  type LayoutGetResponse
} from '../shared/ipc'
import { detectClis } from './services/cliDetect'
import type { SessionManager } from './services/sessionManager'
import type { ProjectRecord, StorageService } from './services/storage'

/**
 * Register all IPC handlers. Every renderer payload is Zod-parsed before use;
 * a payload that fails validation rejects the invoke and never reaches the PTY.
 */
export function registerIpc(
  sessions: SessionManager,
  storage: StorageService,
  project: ProjectRecord
): void {
  ipcMain.handle(IpcChannel.SessionAttach, (_event, payload): AttachResponse => {
    const { agent, sessionId } = attachRequestSchema.parse(payload)
    if (sessionId) {
      // Stable identity path: the sessionId is a sessions DB row id; the PTY
      // is spawned/re-attached under it with the row's stored cwd.
      const row = storage.getSessionsForProject(project.id).find((s) => s.id === sessionId)
      if (!row) throw new Error(`Unknown sessionId for project: ${sessionId}`)
      return sessions.attach({ sessionId, agent }, row.cwd)
    }
    return sessions.attach({ agent }, project.rootPath)
  })

  ipcMain.handle(IpcChannel.CliDetect, (_event, payload): Promise<CliDetectResponse> => {
    cliDetectRequestSchema.parse(payload ?? {})
    return detectClis()
  })

  ipcMain.handle(IpcChannel.LayoutGet, (_event, payload): LayoutGetResponse => {
    layoutGetRequestSchema.parse(payload ?? {})
    // Session data rides the layout:get response (no new channel). Outbound
    // parse keeps the boundary schema-checked in both directions.
    return layoutGetResponseSchema.parse({
      layout: storage.getPaneLayout(project.id),
      sessions: storage.getSessionsForProject(project.id)
    })
  })

  ipcMain.handle(IpcChannel.SessionWrite, (_event, payload) => {
    const { sessionId, data } = writeRequestSchema.parse(payload)
    sessions.write(sessionId, data)
  })

  ipcMain.handle(IpcChannel.SessionResize, (_event, payload) => {
    const { sessionId, cols, rows } = resizeRequestSchema.parse(payload)
    sessions.resize(sessionId, cols, rows)
  })

  ipcMain.handle(IpcChannel.SessionKill, (_event, payload) => {
    const { sessionId } = killRequestSchema.parse(payload)
    sessions.kill(sessionId)
  })

  // Outbound events are validated here in main (the preload cannot run Zod
  // under the page CSP), so both directions of the boundary stay schema-checked.
  sessions.onData((sessionId, data) => {
    const event = sessionDataEventSchema.parse({ sessionId, data })
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IpcChannel.SessionData, event)
    }
  })

  sessions.onExit((sessionId, exitCode) => {
    const event = sessionExitEventSchema.parse({ sessionId, exitCode })
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IpcChannel.SessionExit, event)
    }
  })
}
