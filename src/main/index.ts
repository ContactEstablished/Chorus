import { app, shell, powerMonitor, BrowserWindow } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { SessionManager } from './services/sessionManager'
import { StorageService } from './services/storage'
import { GitWorktreeManager } from './services/worktrees'
import { CredentialVault } from './services/vault'
import { createDispatchRecorder, type DispatchRecorder } from './services/dispatches'
import type { CouncilService } from './services/councilService'
import { createAttentionTracker, type AttentionTracker } from './services/attention'
import { TICK_SECONDS } from './services/attentionCore'
import { DispatchAttribution } from './services/dispatchAttribution'
import { createOpenRouterKeyClient } from './services/openrouterKeys'
import { createSubscriptionMeter } from './services/subscriptionMeter'
import { IpcChannel, MANAGEMENT_AUTH_MODE, windowMaximizedSchema } from '../shared/ipc'
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
// 3b-3: held only so 'before-quit' can abandon a run in flight. A council run
// is NOT a session and never enters SessionManager (D63 Q2).
let council: CouncilService | null = null

function createWindow(): BrowserWindow {
  const savedBounds = storage?.getWindowBounds()

  const mainWindow = new BrowserWindow({
    width: savedBounds?.width ?? 1200,
    height: savedBounds?.height ?? 800,
    x: savedBounds?.x,
    y: savedBounds?.y,
    show: false,
    autoHideMenuBar: true,
    // 3c-2 / D74: no native frame — TitleBar.vue draws the 36px bar the mock
    // specifies, close hover and all. ⚠ The accepted cost is that the window
    // behaviours the frame gave us for free are now ours: minimize, maximize,
    // restore, close and the maximized-icon swap are re-implemented over the
    // four window:* channels.
    //
    // ⚠ NOTHING ELSE IS ADDED HERE ON PURPOSE. `titleBarStyle` /
    // `titleBarOverlay` would layer a second mechanism over D74's custom
    // controls, and `resizable` already defaults to true. A frameless window on
    // Windows KEEPS its resize border and its snap behaviour — so if resizing
    // ever looks broken, the cause is a renderer element covering the edge and
    // the fix is CSS, not a window option or a manual hit-test.
    frame: false,
    backgroundColor: '#0D0F12', // 3c-1: matches --color-surface-app so the window does not flash grey before first paint
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

  // 3c-2 / D74: the maximized state, pushed to the renderer so the titlebar's
  // restore icon can follow the window rather than only the button.
  //
  // ⚠ BOTH LISTENERS, AND THEY ARE THE WHOLE REASON THE EVENT CHANNEL EXISTS.
  // The state changes by routes the renderer never sees — double-clicking the
  // drag region, Win+↑ / Win+↓, or the OS snapping the window to an edge. A
  // titlebar wired only to its own button's click shows a maximize glyph on a
  // maximized window the first time the user presses Win+↑, and stays wrong.
  //
  // Same wiring slot, same window and same lifecycle as persistBounds above.
  // The send follows the house pattern from ipc.ts (validate in main, fan out
  // to every window), guarded so a window torn down between the event and the
  // send is never written to.
  const sendMaximized = (maximized: boolean): void => {
    const event = windowMaximizedSchema.parse({ maximized })
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IpcChannel.WindowMaximizedChanged, event)
    }
  }
  mainWindow.on('maximize', () => sendMaximized(true))
  mainWindow.on('unmaximize', () => sendMaximized(false))

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

  // Task 3a-3 (D42): per-dispatch token & cost attribution.
  //
  // ⚠ THE MANAGEMENT KEY IS RESOLVED PER USE AND NEVER CACHED. `getManagementKey`
  // is a THUNK that finds the management provider's profile and decrypts it at
  // the moment a management call is made, so the plaintext exists only inside
  // one await and dies with it. No module-level variable holds it, there is no
  // memo, and nothing is decrypted at boot — holding a higher-privilege
  // credential resident for the app's lifetime would be strictly worse than
  // what D33 sanctioned for a launch credential.
  // A local binding: the module-level `storage` is nullable and these closures
  // outlive the narrowing.
  const db = storage
  const managementProfileId = (): string | null => {
    const providers = db.listProviderConfigs().filter((p) => p.authMode === MANAGEMENT_AUTH_MODE)
    for (const provider of providers) {
      const profile = db
        .listCredentialProfiles()
        .find((c) => c.providerId === provider.id && c.unavailableSince === null)
      // A profile marked unavailable is skipped, not refused: D33 clause 8
      // keeps the row, and a management key that cannot be decrypted is the
      // same as not having one — attribution degrades, nothing breaks.
      if (profile) return profile.id
    }
    return null
  }
  // ⚠ HOISTED IN 3b-3 SO THERE IS EXACTLY ONE OF THESE. A council run mints its
  // own capped key (D64(2)) and therefore needs a key client — but building it
  // a second one would create a SECOND management-key path beside the
  // decrypt-per-use thunk 3a-3 designed. One client, one thunk, two consumers.
  const keys = createOpenRouterKeyClient({
    getManagementKey: async () => {
      const id = managementProfileId()
      if (!id) return null
      const decrypted = await vault.decryptForLaunch(id)
      return decrypted.ok ? decrypted.value.key : null
    }
  })
  const attribution = new DispatchAttribution({
    storage,
    keys,
    meter: createSubscriptionMeter(),
    hasManagementKey: () => managementProfileId() !== null
  })
  // The subsystem's single most useful diagnostic, and nothing sensitive —
  // mirroring the vault line above. A false value must NOT block anything: an
  // app with no management key works perfectly, it just does not attribute.
  logger.info(`[attribution] management key configured: ${managementProfileId() !== null}`)

  // Task 3a-1: dispatch telemetry. Constructed here, healed BEFORE restore.
  dispatches = createDispatchRecorder(storage)
  // No PTY survives an app restart, so every dispatch still open belongs to a
  // run that is already over — the same idea as F6 one layer up ("persisted
  // 'running' means WAS running when last observed"). Running this AFTER
  // restore would close the dispatches restore has just opened.
  dispatches.healOrphansAtBoot()
  dispatches.attach(sessions)

  // Task 3b-3 / D66(d): the SAME heal, one table over. A council run writes no
  // `sessions` row and cannot be restored (D63 Q2), so every `council_runs` row
  // still open at boot belongs to a run that is already over — the identical
  // argument the dispatch heal above makes.
  //
  // ⚠ ITS POSITION IS LOAD-BEARING FOR THE SAME REASON THE RECONCILE'S IS.
  // `reconcileOrphanedKeys` (below, after the worktree pass) reads "is this run
  // still going?" from this table. Run it before this heal and a crashed run
  // still reads as RUNNING, so matrix row 2 fires, row 1 never does, and the
  // reconcile appears to work while doing nothing on exactly the rows it exists
  // for. Nothing may be inserted between these two.
  for (const runId of storage.healOpenCouncilRunsAtBoot()) {
    logger.info(`[council] healed orphan run ${runId} -> abandoned/boot-heal`)
  }

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
  council = registerIpc(
    sessions,
    storage,
    worktrees,
    vault,
    attention,
    attribution,
    // 3b-3: the SAME client `attribution` holds, and the SAME thunk it asks.
    keys,
    () => managementProfileId() !== null
  )
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
  // Task 3a-3 (§6.2): revoke keys a crash orphaned. ⚠ THE POSITION IS
  // LOAD-BEARING IN BOTH DIRECTIONS, and getting either wrong makes the
  // reconcile appear to work while doing nothing, on exactly the rows it exists
  // for:
  //  - AFTER dispatches.healOrphansAtBoot() (called above, before the window is
  //    created) because the classifier's "is this dispatch still running?" input
  //    is read from the dispatches table. Run it before the heal and every
  //    crashed dispatch still reads as RUNNING, so matrix row 1 never fires.
  //  - BEFORE sessions.restore(...) because restore relaunches sessions and this
  //    revokes keys — reconciling first means a restored session can never be
  //    handed a key that is about to be destroyed.
  // reconcileOrphanedKeys never throws; the try/catch is belt and braces for the
  // same reason the worktree reconcile has one — a telemetry failure must never
  // brick boot.
  try {
    // The beta analytics API's live schema, logged once — how D4 obligation 2
    // stays re-CHECKED rather than re-remembered. Not awaited: it is a
    // diagnostic and must not delay the reconcile behind it.
    void attribution.logAnalyticsSchemaOnce()
    await attribution.reconcileOrphanedKeys()
    // Analytics freshness is UNDOCUMENTED (D4 obligation 3), so rows closed
    // moments before a shutdown may still have no tokens. Not awaited: it is
    // best-effort and must not hold up the first paint.
    void attribution.backfillPendingTokens()
  } catch (err) {
    logger.error({ err }, '[attribution] boot reconcile failed; continuing boot')
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
  // 3b-3: abort every in-flight council member and mark the run abandoned.
  // ⚠ IT CANNOT REVOKE — 'before-quit' does not await, and the process is about
  // to die. The run's ledger row therefore stays OPEN, which is exactly what
  // makes the boot reconcile the backstop for this one path (D66).
  council?.abandonOpenRunsOnQuit()
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
