import { app, shell, BrowserWindow } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { SessionManager } from './services/sessionManager'
import { StorageService } from './services/storage'
import { GitWorktreeManager } from './services/worktrees'
import { CredentialVault } from './services/vault'
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
  registerIpc(sessions, storage, worktrees, vault)
  watchSessionExits(sessions)
  // D11: persist exit state on every PTY exit so the sessions table stops
  // reporting dead sessions as 'running'. Independent second listener
  // (exitListeners is a Set) — notifications.ts stays untouched.
  sessions.onExit((sessionId, exitCode) => {
    storage?.updateSessionStatus(sessionId, 'exited', exitCode)
  })
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
  storage?.close()
  storage = null
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
