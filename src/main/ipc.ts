import { BrowserWindow, ipcMain } from 'electron'
import {
  IpcChannel,
  attachRequestSchema,
  writeRequestSchema,
  resizeRequestSchema,
  sessionDataEventSchema,
  sessionExitEventSchema,
  cliDetectRequestSchema,
  type AttachResponse,
  type CliDetectResponse
} from '../shared/ipc'
import { DEV_WORKING_DIR } from './constants'
import { detectClis } from './services/cliDetect'
import type { SessionManager } from './services/sessionManager'

/**
 * Register all IPC handlers. Every renderer payload is Zod-parsed before use;
 * a payload that fails validation rejects the invoke and never reaches the PTY.
 */
export function registerIpc(sessions: SessionManager): void {
  ipcMain.handle(IpcChannel.SessionAttach, (_event, payload): AttachResponse => {
    const { agent } = attachRequestSchema.parse(payload)
    return sessions.attach(agent, DEV_WORKING_DIR)
  })

  ipcMain.handle(IpcChannel.CliDetect, (_event, payload): Promise<CliDetectResponse> => {
    cliDetectRequestSchema.parse(payload ?? {})
    return detectClis()
  })

  ipcMain.handle(IpcChannel.SessionWrite, (_event, payload) => {
    const { sessionId, data } = writeRequestSchema.parse(payload)
    sessions.write(sessionId, data)
  })

  ipcMain.handle(IpcChannel.SessionResize, (_event, payload) => {
    const { sessionId, cols, rows } = resizeRequestSchema.parse(payload)
    sessions.resize(sessionId, cols, rows)
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
