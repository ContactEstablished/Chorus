import { BrowserWindow, dialog, ipcMain } from 'electron'
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
  sessionRestoredEventSchema,
  cliDetectRequestSchema,
  layoutGetRequestSchema,
  layoutGetResponseSchema,
  projectAddRequestSchema,
  projectAddResponseSchema,
  projectsListSchema,
  projectSelectRequestSchema,
  restartRequestSchema,
  restartResponseSchema,
  deleteSessionRequestSchema,
  setTitleRequestSchema,
  agentKindSchema,
  type AttachResponse,
  type CliDetectResponse,
  type LaunchResponse,
  type LaunchContextResponse,
  type LayoutGetResponse,
  type Project,
  type ProjectAddResponse,
  type ProjectsList,
  type RestartResponse
} from '../shared/ipc'
import { collectSessionIds } from '../shared/layout'
import { detectClis } from './services/cliDetect'
import type { SessionManager } from './services/sessionManager'
import type { ProjectRecord, StorageService } from './services/storage'

/** Soft cap on panes per project (spec §6/§12): bounds how many agent
 *  processes one project can hold; launches beyond it are rejected. */
const LAUNCH_PANE_CAP = 16

/** Map the internal record onto the IPC wire shape (snake_case root_path). */
function toWireProject(p: ProjectRecord): Project {
  return { id: p.id, name: p.name, root_path: p.rootPath }
}

/** Strip C0 control chars + DEL from a captured title; titles are raw terminal
 *  output. Returns the trimmed remainder (possibly empty — the caller rejects
 *  an empty result rather than writing a blank title). */
export function sanitizeTitle(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\x00-\x1F\x7F]/g, '').trim()
}

/**
 * Register all IPC handlers. Every renderer payload is Zod-parsed before use;
 * a payload that fails validation rejects the invoke and never reaches the PTY.
 *
 * Task 1-5: no closure over a single project — every project-scoped handler
 * resolves `project_id` from its parsed request and FK-checks it against the
 * projects table (schema validity ≠ existence) before touching anything.
 */
export function registerIpc(sessions: SessionManager, storage: StorageService): void {
  function requireProject(projectId: string): ProjectRecord {
    const p = storage.getProjectById(projectId)
    if (!p) throw new Error(`Unknown project_id: ${projectId}`)
    return p
  }

  ipcMain.handle(IpcChannel.SessionAttach, (_event, payload): AttachResponse => {
    const { sessionId } = attachRequestSchema.parse(payload)
    // The sessionId is a sessions DB row id; the row supplies the persisted
    // exit state and cwd for the manager-unknown path below.
    const row = storage.getSessionById(sessionId)
    if (!row) throw new Error(`Unknown sessionId: ${sessionId}`)
    const snap = sessions.attach(sessionId)
    if (snap) {
      // Live in the manager. The restored flag lets a pane that mounted after
      // the session:restored event still wear the badge — consumed here, so
      // exactly one attach reports it per restore relaunch. The snapshot has
      // no title of its own; the row is the source (1b-1).
      return sessions.consumeRestoredBadge(sessionId)
        ? { ...snap, title: row.title, restored: true }
        : { ...snap, title: row.title }
    }
    // Unknown to the SessionManager (row from a previous app run, or a session
    // the restore engine has not reached yet): attach never spawns — report
    // the row's persisted exit state plus the restore chrome signals.
    return {
      sessionId: row.id,
      buffer: '',
      status: 'exited',
      exitCode: row.exitCode,
      title: row.title,
      ...(sessions.isRestorePending(sessionId) ? { restorePending: true } : {}),
      ...(!fs.existsSync(row.cwd) ? { cwdMissing: true } : {})
    }
  })

  ipcMain.handle(IpcChannel.SessionLaunch, (_event, payload): LaunchResponse => {
    const req = launchRequestSchema.parse(payload)
    const p = requireProject(req.project_id)
    // Security boundary: cwd must be absolute and exist. Main-only, before
    // any row is created or PTY spawned; the renderer is never trusted.
    if (!path.isAbsolute(req.cwd) || !fs.existsSync(req.cwd)) {
      return { ok: false, reason: `Directory not found or not absolute: ${req.cwd}` }
    }
    // Soft pane cap (spec §6): a pathological layout cannot fork dozens of
    // agent processes. Panes = layout leaves for this project.
    const layout = storage.getPaneLayout(p.id)
    const paneCount = layout ? collectSessionIds(layout.root).length : 0
    if (paneCount >= LAUNCH_PANE_CAP) {
      return { ok: false, reason: `Pane cap reached (${LAUNCH_PANE_CAP} per project)` }
    }
    const row = storage.createSession({
      id: randomUUID(),
      projectId: p.id,
      agent: req.agent,
      cwd: req.cwd,
      status: 'running',
      exitCode: null,
      createdAt: new Date().toISOString()
    })
    const snap = sessions.launch(req.agent, req.cwd, row.id)
    storage.pushRecentCwd(req.cwd)
    // Fresh row: title is NULL until a capture event lands (1b-1).
    return { ...snap, title: row.title }
  })

  ipcMain.handle(IpcChannel.SessionLaunchContext, (_event, payload): LaunchContextResponse => {
    const req = launchContextRequestSchema.parse(payload)
    const p = requireProject(req.project_id)
    // Outbound parse re-filters recent cwds to strings: the renderer never
    // trusts raw disk contents.
    return launchContextResponseSchema.parse({
      projectRoot: p.rootPath,
      recentCwds: storage.getRecentCwds()
    })
  })

  ipcMain.handle(IpcChannel.SessionRestart, (_event, payload): RestartResponse => {
    const { sessionId } = restartRequestSchema.parse(payload)
    // D16 clause 4: one path for in-run and post-restart restarts. Read the
    // row, re-validate cwd, spawn via the launch path under the SAME row id
    // (no row creation), write 'running' only after the spawn succeeds.
    const row = storage.getSessionById(sessionId)
    if (!row) return { ok: false, reason: `Unknown sessionId: ${sessionId}` }
    if (sessions.isRunning(sessionId)) {
      return { ok: false, reason: 'Session is still running — kill it before restarting' }
    }
    if (!fs.existsSync(row.cwd)) {
      return { ok: false, reason: `Working directory not found: ${row.cwd}` }
    }
    const agent = agentKindSchema.parse(row.agent)
    try {
      const snap = sessions.launch(agent, row.cwd, row.id)
      storage.updateSessionStatus(sessionId, 'running', null)
      return restartResponseSchema.parse({ ...snap, title: row.title })
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IpcChannel.SessionDelete, (_event, payload): void => {
    const { sessionId } = deleteSessionRequestSchema.parse(payload)
    // Pane close ordering is kill -> awaited exit -> leaf removed -> delete;
    // a live PTY must never lose its row (the invisible-process guard's twin:
    // no PTY may exist that no pane can reach).
    if (sessions.isRunning(sessionId)) {
      throw new Error(`Refusing to delete live session: ${sessionId} (kill it first)`)
    }
    storage.deleteSession(sessionId)
  })

  ipcMain.handle(IpcChannel.SessionSetTitle, (_event, payload): void => {
    const { sessionId, title } = setTitleRequestSchema.parse(payload)
    // Titles are raw terminal output: strip controls, re-bound, and never
    // persist a blank — an empty post-sanitize result is a silent no-op.
    const clean = sanitizeTitle(title).slice(0, 120)
    if (clean.length === 0) return
    storage.updateSessionTitle(sessionId, clean)
    // Write cadence is the debounce's observable: ~1 line per settle, never
    // one per TUI redraw. Titles are terminal output, not secrets.
    console.log(`[title] persisted ${sessionId}: ${JSON.stringify(clean)}`)
  })

  ipcMain.handle(IpcChannel.CliDetect, (_event, payload): Promise<CliDetectResponse> => {
    cliDetectRequestSchema.parse(payload ?? {})
    return detectClis()
  })

  ipcMain.handle(IpcChannel.LayoutGet, (_event, payload): LayoutGetResponse => {
    const req = layoutGetRequestSchema.parse(payload)
    const p = requireProject(req.project_id)
    // Session data rides the layout:get response (no new channel). Outbound
    // parse keeps the boundary schema-checked in both directions.
    return layoutGetResponseSchema.parse({
      layout: storage.getPaneLayout(p.id),
      sessions: storage.getSessionsForProject(p.id)
    })
  })

  ipcMain.handle(IpcChannel.LayoutSet, (_event, payload): void => {
    // layoutSetRequestSchema enforces shape + ratio bounds at the boundary;
    // savePaneLayout normalizes again on write (clamp + dedupe) — defense in
    // depth per council D9. A null tree means the last pane closed: DELETE the
    // row — its absence is the empty signal. Per project, as 1-4 established.
    const req = layoutSetRequestSchema.parse(payload)
    const p = requireProject(req.project_id)
    if (req.layout === null) {
      storage.clearPaneLayout(p.id)
      return
    }
    storage.savePaneLayout(p.id, req.layout)
  })

  ipcMain.handle(IpcChannel.ProjectAdd, async (_event, payload): Promise<ProjectAddResponse> => {
    projectAddRequestSchema.parse(payload ?? {})
    // D3: the native picker runs in main; the renderer never enumerates
    // directories itself. Cancel is a structured no-op, not an error.
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled || !result.filePaths[0]) {
      return projectAddResponseSchema.parse({ cancelled: true })
    }
    const project = storage.getOrCreateProject(result.filePaths[0])
    return projectAddResponseSchema.parse({ project: toWireProject(project) })
  })

  ipcMain.handle(IpcChannel.ProjectList, (_event): ProjectsList => {
    const activeId = storage.getActiveProjectId()
    return projectsListSchema.parse(
      storage.listProjects().map((p) => ({ ...toWireProject(p), active: p.id === activeId }))
    )
  })

  ipcMain.handle(IpcChannel.ProjectSelect, (_event, payload): void => {
    const req = projectSelectRequestSchema.parse(payload)
    const p = requireProject(req.project_id)
    storage.setActiveProjectId(p.id)
    BrowserWindow.getAllWindows()[0]?.setTitle(p.name)
    // Lazy restore (D16): relaunch this project's persisted 'running' rows
    // now — never before its first activation. restore() is idempotent within
    // a run (live-guarded, healed rows stay healed), so re-selects are cheap.
    void sessions.restore(p.id)
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

  sessions.onRestored((sessionId) => {
    const event = sessionRestoredEventSchema.parse({ sessionId })
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IpcChannel.SessionRestored, event)
    }
  })
}
