import { app, shell, BrowserWindow } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { SessionManager } from './services/sessionManager'
import { StorageService } from './services/storage'
import { detectClis } from './services/cliDetect'
import { watchSessionExits } from './services/notifications'
import { registerIpc } from './ipc'
import { DEV_WORKING_DIR } from './constants'

const sessions = new SessionManager()
let storage: StorageService | null = null

function createWindow(): void {
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
  console.log(ok ? `[notify] dev toast shortcut created: ${shortcutPath}` : '[notify] dev toast shortcut creation failed')
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId(APP_USER_MODEL_ID)
  ensureDevToastShortcut()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  storage = new StorageService(join(app.getPath('userData'), 'chorus.db'))
  const project = storage.getOrCreateProject(DEV_WORKING_DIR)
  console.log(`[storage] project '${project.name}' (${project.rootPath}) db=chorus.db`)

  registerIpc(sessions, storage, project)
  watchSessionExits(sessions)
  createWindow()

  // One-line summary per tool; detection is memoized, so the IPC channel reuses this run.
  void detectClis().then((tools) => {
    for (const tool of tools) {
      console.log(
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
