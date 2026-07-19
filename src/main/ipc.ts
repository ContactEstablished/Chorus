import { BrowserWindow, ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  IpcChannel,
  layoutSetRequestSchema,
  attachRequestSchema,
  launchRequestSchema,
  launchContextRequestSchema,
  launchContextResponseSchema,
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
  type LaunchResponse,
  type LaunchContextResponse,
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
    const { agent, sessionId, respawn } = attachRequestSchema.parse(payload)
    // The sessionId is a sessions DB row id; the row supplies the stored cwd.
    const row = storage.getSessionsForProject(project.id).find((s) => s.id === sessionId)
    if (!row) throw new Error(`Unknown sessionId for project: ${sessionId}`)
    const snap = sessions.attach({ sessionId, agent, respawn }, row.cwd)
    // Restart chrome respawned the PTY under the same row id: flip the row
    // back to running so the DB stops lying in both directions (D11).
    if (snap && respawn && snap.status === 'running') {
      storage.updateSessionStatus(sessionId, 'running', null)
    }
    // Unknown to the SessionManager (row from a previous app run): attach
    // never spawns — report the row's persisted exit state so the pane shows
    // dead/exited chrome. Relaunch on restore is Task 1-5's contract.
    return snap ?? { sessionId: row.id, buffer: '', status: 'exited', exitCode: row.exitCode }
  })

  ipcMain.handle(IpcChannel.SessionLaunch, (_event, payload): LaunchResponse => {
    const req = launchRequestSchema.parse(payload)
    // Security boundary: cwd must be absolute and exist. Main-only, before
    // any row is created or PTY spawned; the renderer is never trusted.
    if (!path.isAbsolute(req.cwd) || !fs.existsSync(req.cwd)) {
      return { ok: false, reason: `Directory not found or not absolute: ${req.cwd}` }
    }
    const row = storage.createSession({
      id: randomUUID(),
      projectId: project.id,
      agent: req.agent,
      cwd: req.cwd,
      status: 'running',
      exitCode: null,
      createdAt: new Date().toISOString()
    })
    const snap = sessions.launch(req.agent, req.cwd, row.id)
    storage.pushRecentCwd(req.cwd)
    return snap
  })

  ipcMain.handle(IpcChannel.SessionLaunchContext, (_event, payload): LaunchContextResponse => {
    launchContextRequestSchema.parse(payload ?? {})
    // Outbound parse re-filters recent cwds to strings: the renderer never
    // trusts raw disk contents.
    return launchContextResponseSchema.parse({
      projectRoot: project.rootPath,
      recentCwds: storage.getRecentCwds()
    })
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

  ipcMain.handle(IpcChannel.LayoutSet, (_event, payload): void => {
    // layoutSetRequestSchema (layoutJsonSchema.nullable()) enforces shape +
    // ratio bounds at the boundary; savePaneLayout normalizes again on write
    // (clamp + dedupe) — defense in depth per council D9. A null tree means
    // the last pane closed: DELETE the row — its absence is the empty signal.
    const layout = layoutSetRequestSchema.parse(payload)
    if (layout === null) {
      storage.clearPaneLayout(project.id)
      return
    }
    storage.savePaneLayout(project.id, layout)
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
