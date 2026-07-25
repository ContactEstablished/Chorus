import { app, shell, powerMonitor, BrowserWindow } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { SessionManager } from './services/sessionManager'
import { StorageService } from './services/storage'
import { GitWorktreeManager } from './services/worktrees'
import { CredentialVault } from './services/vault'
import { createDispatchRecorder, type DispatchRecorder } from './services/dispatches'
import { createAttentionTracker, type AttentionTracker } from './services/attention'
import { TICK_SECONDS } from './services/attentionCore'
import { detectClis } from './services/cliDetect'
import { watchSessionExits } from './services/notifications'
import { registerIpc } from './ipc'
import { DEV_WORKING_DIR } from './constants'
// The redacting logger (Task 3-1). Importing it initializes pino at the top of
// the boot sequence — every main-process module logs through it, never raw
// console calls.
import { logger } from './services/logger'

const sessions = new SessionManager()
let storage: StorageService | null = null
let dispatches: DispatchRecorder | null = null
let attention: AttentionTracker | null = null

function createWindow(): BrowserWindow {
  const savedBounds = storage?.getWindowBounds()

  const mainWindow = new BrowserWindow({
    width: savedBounds?.width ?? 1200,
    height: savedBounds?.height ?? 800,
    x: savedBounds?.x,
    y: savedBounds?.y,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // 'resized'/'moved' fire once after the interaction ends (Windows), so no debounce.
  const persistBounds = (): void => {
    if (!mainWindow.isMinimized()) storage?.saveWindowBounds(mainWindow.getNormalBounds())
  }
  mainWindow.on('resized', persistBounds)
  mainWindow.on('moved', persistBounds)

  // 3a-2: the window half of the attention signal — main knows whether this
  // window holds the OS's keyboard focus; only the renderer knows which
  // terminal holds DOM focus, and classify() requires BOTH. Same wiring slot
  // and same shape as persistBounds above.
  //
  // ⚠ Latch from the CURRENT state rather than waiting for an event: a window
  // created already-focused fires no 'focus', and the first tick would then
  // classify a focused window as blurred.
  attention?.setWindowFocused(mainWindow.isFocused())
  attention?.setWindowMinimized(mainWindow.isMinimized())
  mainWindow.on('focus', () => attention?.setWindowFocused(true))
  mainWindow.on('blur', () => attention?.setWindowFocused(false))
  mainWindow.on('minimize', () => attention?.setWindowMinimized(true))
  mainWindow.on('restore', () => attention?.setWindowMinimized(false))
  // A reload/HMR destroys the DOM the last report described, so the report is
  // stale until the fresh renderer's onMounted send lands (table row 11 —
  // classified as overhead, which cannot corrupt a per-task number).
  mainWindow.webContents.on('did-finish-load', () => attention?.markReportStale())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

const APP_USER_MODEL_ID = 'com.contactestablished.chorus'

/**
 * Windows only delivers toasts for AUMIDs registered via a Start Menu shortcut
 * (error 0x803E0114 otherwise). The installer will register the real one in
 * Phase 7; in dev, write an idempotent "Chorus (Dev)" shortcut so exit toasts
 * are actually visible. Delete the .lnk to undo.
 */
function ensureDevToastShortcut(): void {
  if (!is.dev || process.platform !== 'win32') return
  const shortcutPath = join(
    app.getPath('appData'),
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Chorus (Dev).lnk'
  )
  if (existsSync(shortcutPath)) return
  const ok = shell.writeShortcutLink(shortcutPath, 'create', {
    target: process.execPath,
    appUserModelId: APP_USER_MODEL_ID,
    description: 'Chorus development shell'
  })
  logger.info(ok ? `[notify] dev toast shortcut created: ${shortcutPath}` : '[notify] dev toast shortcut creation failed')
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId(APP_USER_MODEL_ID)
  ensureDevToastShortcut()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  storage = new StorageService(join(app.getPath('userData'), 'chorus.db'))
  sessions.bindStorage(storage)
  const worktrees = new GitWorktreeManager(storage)
  // Task 3-2 (D33): the credential vault — safeStorage/DPAPI encryption for
  // BYOK keys. Constructed alongside the worktree manager and threaded into
  // registerIpc. Availability is logged ONCE (the subsystem's single most
  // useful diagnostic, and nothing sensitive); a false value must NOT block
  // boot — a user with no credentials has a perfectly working app, and the
  // refusal lives at credential creation (D33 Q3), not at startup.
  const vault = new CredentialVault(storage)
  logger.info(`[vault] safeStorage encryption available: ${vault.isAvailable()}`)

  // Task 3a-1: dispatch telemetry. Constructed here, healed BEFORE restore.
  dispatches = createDispatchRecorder(storage)
  // No PTY survives an app restart, so every dispatch still open belongs to a
  // run that is already over — the same idea as F6 one layer up ("persisted
  // 'running' means WAS running when last observed"). Running this AFTER
  // restore would close the dispatches restore has just opened.
  dispatches.healOrphansAtBoot()
  dispatches.attach(sessions)

  // Task 3a-2: attention capture. ONE setInterval for the whole application —
  // panes are not subscribers, and ten panes cost what one pane costs.
  // powerMonitor is reached through an injected reader so the service module
  // holds no Electron reference and the seam stays substitutable.
  attention = createAttentionTracker({
    storage,
    readIdleSeconds: () => powerMonitor.getSystemIdleTime(),
    now: () => Date.now()
  })
  // ⚠ THE ONLY LINE THIS SUBSYSTEM MAY EVER LOG. No per-tick logging: it would
  // turn the log file into a second, unredacted behavioural record of the
  // operator's day, four lines a minute forever.
  logger.info(
    `[attention] capture ${attention.enabled ? 'on' : 'off'} · tick ${TICK_SECONDS}s · local-only`
  )
  // 'lock-screen'/'unlock-screen' are typed @platform darwin,win32. On this
  // machine getSystemIdleState() was never observed returning 'locked'
  // (verified 2026-07-25), so the `locked` class rests on these events alone —
  // a smaller claim than "cross-checked", and recorded as smaller.
  powerMonitor.on('lock-screen', () => attention?.setOsLocked(true))
  powerMonitor.on('unlock-screen', () => attention?.setOsLocked(false))
  powerMonitor.on('suspend', () => attention?.setOsLocked(true))
  powerMonitor.on('resume', () => {
    attention?.setOsLocked(false)
    // The suspended stretch becomes a hole BETWEEN two runs rather than a lie
    // inside one; coverage() finds it there.
    attention?.markGap()
  })

  // Resolve the active project: the persisted one if it still exists, else the
  // first-run default seed. DEV_WORKING_DIR is ONLY that seed (Task 1-5) —
  // never a per-session cwd source. Existing dev DBs already hold exactly one
  // projects row for this root, so they open as one tab, zero migration.
  let active = storage.getActiveProjectId()
  let project = active ? storage.getProjectById(active) : null
  if (!project) {
    project = storage.getOrCreateProject(DEV_WORKING_DIR)
    storage.setActiveProjectId(project.id)
  }
  logger.info(`[storage] project '${project.name}' (${project.rootPath}) db=chorus.db`)

  // 2-2: the SAME manager instance the boot reconcile uses is threaded into
  // the IPC layer — session:launch's new-worktree path is createWorktree's
  // first caller. (Construction already precedes this call.)
  // 3-2: the vault rides along for the credential:*/provider:* handlers.
  registerIpc(sessions, storage, worktrees, vault, attention)
  watchSessionExits(sessions)
  // D11: persist exit state on every PTY exit so the sessions table stops
  // reporting dead sessions as 'running'. Independent second listener
  // (exitListeners is a Set) — notifications.ts stays untouched.
  sessions.onExit((sessionId, exitCode) => {
    storage?.updateSessionStatus(sessionId, 'exited', exitCode)
  })
  // 3a-2 (focus-state table row 10): stop crediting a pane whose agent has
  // exited. Another independent listener on the same Set — order within it is
  // not contractual.
  sessions.onExit((sessionId) => attention?.onSessionExited(sessionId))
  // D26 Q3 / findings risk 4: worktree reconcile runs AWAITED, BEFORE the
  // restore below, so restore never spawns into a worktree the reconcile is
  // about to act on. It touches only worktrees rows (restore owns sessions
  // cwd healing — no double-heal) and is inert on an empty worktrees table.
  // A reconcile failure must never brick boot — logged and boot continues.
  try {
    await worktrees.reconcileAll()
  } catch (err) {
    logger.error({ err }, '[worktrees] boot reconcile failed; continuing boot')
  }
  // D16 restore contract: relaunch the ACTIVE project's restore set (layout
  // leaves ∩ persisted 'running' rows) — heal-first, cwd-validated, staggered,
  // badged. Inactive projects restore lazily via project:select. Not awaited:
  // pane chrome renders immediately and resolves as spawns land.
  void sessions.restore(project.id)
  const win = createWindow()
  win.setTitle(project.name)

  // One-line summary per tool; detection is memoized, so the IPC channel reuses this run.
  void detectClis().then((tools) => {
    for (const tool of tools) {
      logger.info(
        tool.found
          ? `[cli-detect] ${tool.name}: ${tool.version} (${tool.path})`
          : `[cli-detect] ${tool.name}: not found`
      )
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  sessions.dispose()
  // Task 3a-1: AFTER dispose (some rows close via onExit during teardown),
  // BEFORE the DB closes. Idempotent — closeDispatch's WHERE clause makes a
  // second close a no-write.
  dispatches?.closeOpenOnQuit()
  // Task 3a-2: stop the clock BEFORE the DB closes — a tick landing on a closed
  // connection would throw. There is nothing to flush (every tick has already
  // written durably), which is exactly why a tree-kill loses the same one tick
  // that a clean quit does.
  attention?.dispose()
  storage?.close()
  storage = null
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
