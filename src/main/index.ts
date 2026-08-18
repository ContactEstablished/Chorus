import { app, shell, powerMonitor, BrowserWindow, session, screen } from 'electron'
import { existsSync, rmSync } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import fsp from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

/** Task 5-2: promisified `execFile` for the whisper engine — NEVER a shell,
 *  NEVER a string-concatenated command. The `git.ts` shape, which already
 *  documents each of the options this passes. */
const pExecFile = promisify(execFile)
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { SessionManager } from './services/sessionManager'
import { StorageService } from './services/storage'
import { GitWorktreeManager } from './services/worktrees'
import { CredentialVault } from './services/vault'
import { createDispatchRecorder, type DispatchRecorder } from './services/dispatches'
import { createTurnRecorder, type TurnRecorder } from './services/turns'
import type { CouncilService } from './services/councilService'
import { createAttentionTracker, type AttentionTracker } from './services/attention'
import { createAgentEventListener, type AgentEventListener } from './services/agentEvents'
import { createContextUsageTracker, type ContextUsageTracker } from './services/contextUsage'
import { createScrollbackStore } from './services/scrollbackStore'
import { createMemoryService, type MemoryService } from './services/memoryService'
import { createNeo4jClient } from './services/neo4jClient'
import { createVoiceService, type VoiceService } from './services/voice'
import { createOwnOriginCheck } from './services/voiceCore'
import { createWhisperService } from './services/whisper'
import { createHotkeyService, type HotkeyService } from './services/hotkey'
import { parseChord } from './services/hotkeyCore'
import type { VoiceRefiner } from './services/voiceRefine'
import { fallbackOutcome } from './services/voiceRefineCore'
import { createVoiceOverlay, type VoiceOverlay } from './services/voiceOverlay'
import { TICK_SECONDS } from './services/attentionCore'
import { DispatchAttribution } from './services/dispatchAttribution'
import { createOpenRouterKeyClient } from './services/openrouterKeys'
import { createSubscriptionMeter } from './services/subscriptionMeter'
import { IpcChannel, MANAGEMENT_AUTH_MODE, windowMaximizedSchema } from '../shared/ipc'
import { detectClis } from './services/cliDetect'
import { watchSessionExits } from './services/notifications'
import { registerIpc } from './ipc'
import { DEV_WORKING_DIR } from './constants'
// Task 6a-2: the four read-only git calls `memoryService.index` is handed.
import { countCommits, logNameOnly, lsFiles, rootCommitShas } from './services/git'
import {
  dockerAvailable,
  findFreeBoltPort,
  inspectContainer,
  removeContainer,
  runContainer,
  startContainer,
  stopContainer
} from './services/docker'
// The redacting logger (Task 3-1). Importing it initializes pino at the top of
// the boot sequence — every main-process module logs through it, never raw
// console calls.
import { logger } from './services/logger'
/**
 * The app icon, replacing Electron's default for the taskbar button, the
 * Alt-Tab card and the window's own small icon. Generated from the seven-bar
 * mark by `npm run icons` (scripts/generate-icon.mjs) — regenerate it there,
 * never hand-edit the .ico.
 *
 * ⚠ `?asset` COMPILES TO `join(__dirname, '../../resources/icon.ico')` — it
 * does NOT copy the file into `out/`. Verified by reading the built bundle; do
 * not assume otherwise. Two consequences worth knowing:
 *   - It resolves in dev because `out/main/` sits two levels under the repo
 *     root, next to `resources/`.
 *   - PACKAGING (Phase 7) MUST SHIP `resources/` ALONGSIDE `out/` inside the
 *     asar, or this path dangles and the window silently falls back to
 *     Electron's default icon. electron-builder's stock electron-vite `files`
 *     list already does; a hand-rolled one has to be checked.
 * It is still preferable to writing that join by hand: the path is resolved at
 * BUILD time, so a missing or renamed icon fails the build instead of shipping.
 */
import appIcon from '../../resources/icon.ico?asset'

/**
 * ⚠ THE PACKAGED APP NAMES ITS OWN DATA DIRECTORY, AND A SHORTCUT ARGUMENT IS
 * NOT ALLOWED TO BE THE THING THAT FINDS IT.
 *
 * Electron derives `userData` from the app NAME, which resolves to `Chorus` in
 * a packaged build and `chorus` in dev — the SAME FOLDER on Windows, which is
 * case-insensitive. So out of the box the installed app and `npm run dev` share
 * one database, and a dev run writes over the real one.
 *
 * That was worked around by launching the installed app from a shortcut
 * carrying `--user-data-dir=…\chorus-app`. **A shortcut argument is the wrong
 * home for this, and it failed exactly the way an argument fails: the installer
 * regenerates its shortcuts, the flag is not in the installer's vocabulary, and
 * the first reinstall would have silently pointed the app at the dev database.**
 * The user's providers, credentials and council members would all still exist
 * and none of them would be on screen — the worst shape a data problem can take,
 * because it looks like deletion.
 *
 * So the packaged build states the directory itself. Dev keeps the default
 * (`%APPDATA%\chorus`) — its data is where it has always been, and the two no
 * longer collide.
 *
 * ⚠ AN EXPLICIT `--user-data-dir` STILL WINS. Someone passing it means it —
 * running a second profile, or a harness pointing at a copied directory — and
 * this must not quietly override them. It only supplies the default they did
 * not state.
 *
 * ⚠ AND IT RUNS AT MODULE SCOPE, BEFORE `whenReady`. `setPath('userData', …)`
 * has to land before anything reads the path or Chromium starts writing under
 * it; the storage open at the top of `whenReady` is only the first of those
 * readers, not the earliest.
 */
const PACKAGED_USER_DATA_DIR = 'chorus-app'
if (app.isPackaged && !app.commandLine.hasSwitch('user-data-dir')) {
  app.setPath('userData', join(app.getPath('appData'), PACKAGED_USER_DATA_DIR))
}

const sessions = new SessionManager()
/** Module scope for the same reason `sessions` is: the boot sequence binds it
 *  into the manager, `registerIpc` fans its events out, and 'before-quit'
 *  closes it — three call sites that would otherwise each need it threaded. */
const agentEvents: AgentEventListener = createAgentEventListener()
let storage: StorageService | null = null
/** v16: constructed in the boot sequence (it needs `storage` for the launch-
 *  model lookup), so unlike `agentEvents` above it cannot be built at module
 *  scope. Null until then, and every caller treats null as "no ring". */
let contextUsage: ContextUsageTracker | null = null
let dispatches: DispatchRecorder | null = null
/** Task 8-0: the same shape as `dispatches` one granularity down — built in
 *  the boot sequence because it needs `storage`, healed before restore, and
 *  closed on 'before-quit'. */
let turns: TurnRecorder | null = null
let attention: AttentionTracker | null = null
// 3b-3: held only so 'before-quit' can abandon a run in flight. A council run
// is NOT a session and never enters SessionManager (D63 Q2).
let council: CouncilService | null = null
// Task 6-3: held for exactly one reason — 'before-quit' must dispose the bolt
// driver. A driver owns a connection pool with live sockets, and one left open
// keeps handles alive past the point the app has stopped.
let memory: MemoryService | null = null
/**
 * Task 5-1: held so the window's own teardown and 'before-quit' can abandon a
 * capture in flight.
 *
 * ⚠ THE RENDERER OWNS THE DEVICE, SO THIS CANNOT RELEASE IT — only
 * `capture.ts` can call `track.stop()`. What this reaches is main's SINK: a
 * capture left `listening` across a reload would keep a queue and a capture id
 * alive that no renderer is feeding, and the next start would be refused as
 * "already capturing" for a session that no longer exists. Cancelling on
 * teardown is what stops a reload from wedging the feature.
 */
let voice: VoiceService | null = null
/**
 * Task 5-3: held so 'before-quit' can stop the GLOBAL keyboard hook.
 *
 * ⚠ A SYSTEM-WIDE LOW-LEVEL KEYBOARD HOOK MUST NOT OUTLIVE THE PROCESS, and
 * leaking one is worse than leaking a file handle: it observes every keystroke
 * the user makes in every application on the machine.
 */
let hotkey: HotkeyService | null = null
/** Task 5-4: how long the overlay stays up after a dictation ends, so the
 *  outcome line ("inserted" / "original inserted — refinement timed out") can
 *  actually be read by someone whose eyes are on another application. */
const VOICE_OVERLAY_LINGER_MS = 4_000
/** Task 5-3: the always-on-top dictation indicator. */
let overlay: VoiceOverlay | null = null

/**
 * The launch splash's three facts, handed to the renderer on the URL it loads.
 *
 * ⚠ ON THE URL, NOT OVER IPC, AND DELIBERATELY. All three are WRITE-ONCE BOOT
 * CONSTANTS fixed before the window exists: a channel + Zod pair + preload
 * forwarder would let the splash ask a question whose answer could not change,
 * and it would have to render its first frame before the reply arrived anyway.
 * The renderer half (`renderer/src/boot/bootInfo.ts`) parses this defensively —
 * a query string is editable in a way an IPC payload is not, so nothing there
 * trusts a value.
 *
 * `restoring` is the D16 restore set's size for the ACTIVE project, read from
 * SessionManager.planRestoreCount(). It is omitted entirely when zero: D76
 * forbids rendering a placeholder or a zero, and the splash drops its boot line
 * rather than announcing that it is restoring nothing.
 */
function splashQuery(restoringSessions: number): Record<string, string> {
  const query: Record<string, string> = {
    // `app.getVersion()` reads the version out of the app's package.json —
    // 0.1.0 today, and it follows the real number through packaging without a
    // second home to update.
    v: app.getVersion(),
    // "windows x64" — the mock's own phrasing. `process.platform` is `win32`,
    // which is a build target rather than a thing to show a person.
    platform: `${process.platform === 'win32' ? 'windows' : process.platform} ${process.arch}`
  }
  if (restoringSessions > 0) query.restoring = String(restoringSessions)
  return query
}

function createWindow(restoringSessions: number): BrowserWindow {
  const savedBounds = storage?.getWindowBounds()

  const mainWindow = new BrowserWindow({
    width: savedBounds?.width ?? 1200,
    height: savedBounds?.height ?? 800,
    x: savedBounds?.x,
    y: savedBounds?.y,
    show: false,
    autoHideMenuBar: true,
    // ⚠ THE WINDOW ICON IS THE ONLY ONE THIS APP HAS A NATIVE SLOT FOR. `frame:
    // false` below means there is no native titlebar to hang a small icon in —
    // TitleBar.vue already draws the mark there via ChorusMark.vue. So what
    // this line actually fixes is every surface OUTSIDE the window: the taskbar
    // button, Alt-Tab and the window list, all of which show Electron's default
    // icon until a window supplies its own.
    icon: appIcon,
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

  // Task 5-1: a reload takes the renderer's JS with it, so any capture it owned
  // is over whether main has been told or not. Without this the sink would stay
  // `listening` on a capture id nothing is feeding, and the next start would be
  // refused as "already capturing" for a session that no longer exists — a
  // reload would wedge the feature until restart. `cancel` returns immediately
  // when nothing is live, which is the case on the very first load.
  mainWindow.webContents.on('did-start-loading', () => voice?.cancel('renderer reload'))
  mainWindow.on('closed', () => {
    voice?.cancel('window closed')
    /**
     * ⚠ THE OVERLAY MUST DIE WITH THE MAIN WINDOW, AND FINDING OUT WHY IS WHAT
     * TASK 5-3's "no leaked hook" GATE IS FOR.
     *
     * The overlay is a second BrowserWindow. Electron fires 'window-all-closed'
     * only when EVERY window is gone, so an overlay left alive — even hidden —
     * keeps the app running after the user has closed it: 'window-all-closed'
     * never fires, `app.quit()` is never called, 'before-quit' never runs, and
     * **the global low-level keyboard hook stays installed on a machine where
     * the user believes Chorus is shut down.** Measured exactly that way: the
     * window closed, the process stayed, and the hook was never removed.
     *
     * A leaked system-wide keyboard hook is worse than a leaked file handle —
     * it observes every keystroke the user makes in every application — so the
     * indicator window is not allowed to be the thing that keeps it alive.
     */
    overlay?.destroy()
    overlay = null
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Both load paths carry the splash's boot facts. `loadFile`'s `query` option
  // and a hand-built search string on the dev URL produce the same
  // `location.search`, so the renderer has one code path for both.
  const query = splashQuery(restoringSessions)
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    const url = new URL(process.env['ELECTRON_RENDERER_URL'])
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
    mainWindow.loadURL(url.toString())
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'), { query })
  }

  return mainWindow
}

const APP_USER_MODEL_ID = 'com.contactestablished.chorus'

/**
 * ⚠ THE DEV SHELL GETS ITS OWN IDENTITY, AND SHARING ONE IS WHAT PUT THE
 * ELECTRON LOGO ON THE INSTALLED APP'S TASKBAR BUTTON.
 *
 * An AUMID is not a label — on Windows it is the identity the taskbar GROUPS
 * and PINS by, and it is resolved to a Start Menu shortcut to find the icon.
 * Two shortcuts claimed this one: the installer's `Chorus.lnk`, whose icon is
 * Chorus.exe's, and the `Chorus (Dev).lnk` written below, which targets
 * `node_modules/electron/dist/electron.exe` and supplied NO icon of its own —
 * so its icon was the Electron logo. Whichever Windows resolved first supplied
 * the icon for BOTH, and the dev one was winning.
 *
 * The window's own `icon:` was never the problem and never the fix: it is
 * correct, it is loaded, and Windows overrides it with the shortcut's whenever
 * an AUMID matches one.
 */
const DEV_APP_USER_MODEL_ID = `${APP_USER_MODEL_ID}.dev`

/**
 * Windows only delivers toasts for AUMIDs registered via a Start Menu shortcut
 * (error 0x803E0114 otherwise). The installer registers the real one; in dev,
 * write a "Chorus (Dev)" shortcut so exit toasts are actually visible. Delete
 * the .lnk to undo.
 *
 * ⚠ WRITTEN WITH `replace`, NOT SKIPPED WHEN PRESENT. The previous version
 * returned early if the file existed, which made a shortcut written by an older
 * build permanent — including the one carrying the production AUMID and the
 * Electron icon. An idempotent write that can never correct what it wrote is
 * not idempotence, it is a stale value with a guard in front of it.
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
  const ok = shell.writeShortcutLink(shortcutPath, 'replace', {
    target: process.execPath,
    appUserModelId: DEV_APP_USER_MODEL_ID,
    // ⚠ THE SHORTCUT CARRIES THE MARK, because the shortcut is what Windows
    // reads. Without this the icon falls back to the TARGET's — and in dev the
    // target is electron.exe. In dev `appIcon` is a real file beside the repo,
    // which is what a .lnk needs; a packaged build's copy lives inside the asar
    // and could not serve as one, which is another reason this stays dev-only.
    icon: appIcon,
    iconIndex: 0,
    description: 'Chorus development shell'
  })
  logger.info(ok ? `[notify] dev toast shortcut written: ${shortcutPath}` : '[notify] dev toast shortcut write failed')
}

/**
 * ══════════════════ THE MICROPHONE BOUNDARY (D162) ══════════════════
 *
 * ⚠ BOTH HANDLERS, AND BEFORE ANY WINDOW EXISTS.
 *
 * F79, measured 2026-08-17 and re-measured against this very build before this
 * function was written: with NO handler installed, Electron 43.1.1 grants
 * `getUserMedia({audio:true})` SILENTLY — it resolved in 147 ms, opened a real
 * device, and exposed the device's label. `Phase-5-VoicePlan.md` §4.3 flagged
 * the unset-handler default as NOT VERIFIED and warned that assuming "it
 * approves" is the D4 failure mode. It approves. **So this is not hardening in
 * advance of a feature; it is closing a boundary that is open at HEAD.**
 *
 * The same probe found the gap is wider than the microphone: `geolocation`
 * resolved GRANTED too, in an app that has never had a reason to ask for it.
 * Nothing in Chorus requests either — which is exactly why it has never
 * mattered, and exactly why it must not stay that way now that something is
 * about to.
 *
 * ⚠ AND IT TAKES BOTH. Electron's own documentation for
 * `setPermissionRequestHandler` (`electron.d.ts:13243`): *"you must also
 * implement `setPermissionCheckHandler` to get complete permission handling.
 * Most web APIs do a permission check and then make a permission request if the
 * check is denied."* One handler is a policy with a hole in it that testing the
 * happy path will NEVER reveal, because the happy path is the one that goes
 * through the handler you installed.
 *
 * ⚠ IT IS CALLED AT THE TOP OF `whenReady`, HUNDREDS OF LINES BEFORE
 * `createWindow`, AND THE ORDERING IS THE CONTENT OF THE RULING. `createWindow`
 * is what makes a renderer capable of asking; a policy installed after it has a
 * window of exposure in it. Task 5-1's acceptance criterion is that deleting
 * everything under `src/renderer/src/voice/` still leaves a hardened app — the
 * boundary must not depend on the feature that finally exercises it.
 */
function installPermissionPolicy(): void {
  /**
   * ⚠ THE PREDICATE IS NOT `() => true`. A handler that returns true for
   * `'media'` without asking WHO is requesting it is the pre-task behaviour with
   * extra steps. The two accepted origins mirror `createWindow`'s own load
   * branch exactly, so there is no third way for this app to be on screen:
   * `ELECTRON_RENDERER_URL`'s origin in dev, and the renderer's own directory
   * when loading from disk. In dev the file root is null, so a `file://`
   * requester is refused outright rather than measured against a root nobody
   * loaded.
   */
  const devRendererUrl = is.dev ? process.env['ELECTRON_RENDERER_URL'] ?? null : null
  const isOwnOrigin = createOwnOriginCheck({
    devRendererUrl,
    appRootFileUrl: devRendererUrl ? null : pathToFileURL(join(__dirname, '../renderer/')).href
  })

  /**
   * The permissions this app is willing to hold, and nothing else.
   *
   * ⚠ `media` IS WHAT THIS TASK IS FOR. The two clipboard entries are NOT new
   * capability — they are the app's EXISTING behaviour, and they are on this
   * list because of a measurement rather than a hunch. `TerminalPane.vue:913`
   * calls `navigator.clipboard.readText()` for Ctrl+V into a PTY and
   * `:868` calls `writeText()` for Ctrl+C; Chromium routes both through
   * Electron's permission handlers, and a probe against this build BEFORE the
   * policy existed recorded both as passing. A media-only allow-list would
   * therefore have shipped a hardening commit that silently broke paste in
   * every terminal pane — the exact class of regression a happy-path test does
   * not catch. `ImplementationSpec-5-1.md` §0 says "media only"; this is a
   * declared deviation, measured, and it grants nothing the app was not already
   * using.
   *
   * ⚠ EVERYTHING ELSE IS REFUSED, INCLUDING THE ONES ELECTRON GRANTS TODAY.
   * `geolocation`, `notifications`, `midi`, `usb`, `hid`, `serial`,
   * `display-capture`, `idle-detection`, `window-management`, `openExternal`
   * and the rest are not on this list and must not be added without the same
   * treatment this list got: a measurement, a reason, and a line in the
   * roadmap. `openExternal` in particular is already handled the right way —
   * `setWindowOpenHandler` in `createWindow` sends links to the OS browser
   * itself, so the renderer never needs the permission.
   */
  const ALLOWED = new Set<string>(['media', 'clipboard-read', 'clipboard-sanitized-write'])

  /**
   * ⚠ THE PERMISSION NAME IS LOGGED AND THE URL IS NOT, ON EVERY BRANCH. A
   * requesting URL carries a path and a query, and the phase's purity contract
   * forbids that class of leak; this is the first place in the app where it
   * could happen. `isMainFrame` is a boolean and safe to record — it is the
   * useful half of the diagnosis when a refusal is unexpected.
   */
  function refuse(permission: string, where: string, isMainFrame: boolean): void {
    logger.info({ permission, isMainFrame }, `[voice] permission ${where} refused`)
  }

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
    // ⚠ MAIN FRAME ONLY. The app renders no iframes and no <webview>, so a
    // sub-frame asking for the microphone is not a case this app has — which
    // makes refusing it free, and makes it one fewer route if that ever changes
    // by accident.
    const ok = ALLOWED.has(permission) && details.isMainFrame && isOwnOrigin(details)
    if (!ok) refuse(permission, 'request', details.isMainFrame)
    callback(ok)
  })

  session.defaultSession.setPermissionCheckHandler((_wc, permission, origin, details) => {
    // ⚠ IT DENIES BY DEFAULT RATHER THAN MIRRORING THE REQUEST HANDLER'S ALLOW,
    // and it reads the ORIGIN argument rather than `details.requestingUrl` —
    // which the typings mark optional precisely because it is absent for
    // cross-origin sub frames. Trusting the optional field would mean an absent
    // URL fell through to whatever the rest of the expression decided.
    //
    // ⚠ MEASURED, SO IT IS NOT MISTAKEN FOR A BUG LATER: this handler is called
    // with an EMPTY origin a handful of times during startup — Chromium checks
    // `media`, `geolocation` and `web-app-installation` before the renderer has
    // committed a URL. Those are refused, which is correct (an unidentifiable
    // requester is not this app), and they appear in the log as refusals on a
    // perfectly healthy boot. Once the page has committed, every `media` check
    // arrives with the real `http:`/`file:` origin and is allowed.
    const ok = ALLOWED.has(permission) && details.isMainFrame && isOwnOrigin({ requestingUrl: origin })
    if (!ok) refuse(permission, 'check', details.isMainFrame)
    return ok
  })

  logger.info(
    { allowed: [...ALLOWED].sort(), dev: devRendererUrl !== null },
    '[voice] permission policy installed (both handlers, before any window)'
  )
}

app.whenReady().then(async () => {
  // ⚠ THE RUNNING APP MUST CLAIM THE SAME IDENTITY ITS SHORTCUT DOES, or the
  // taskbar button does not associate with it — no pinning, no icon, no toasts.
  // Dev claims the dev one; a packaged build claims the installer's `appId`.
  electronApp.setAppUserModelId(is.dev ? DEV_APP_USER_MODEL_ID : APP_USER_MODEL_ID)
  ensureDevToastShortcut()

  installPermissionPolicy()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  storage = new StorageService(join(app.getPath('userData'), 'chorus.db'))
  sessions.bindStorage(storage)

  /**
   * The localhost hook listener (Phase 4's spine, built for the filmstrip's
   * activity lights — see `services/agentEvents.ts` for the scope note and the
   * answer to the roadmap's [CR] spoofing question).
   *
   * ⚠ AWAITED, AND BEFORE ANY RESTORE SPAWNS. Restore relaunches sessions a few
   * lines below, and a session spawned before the port is bound gets no hook
   * config at all — it would run blind for its whole life, because the config
   * is written once at launch. Binding first is what makes restored sessions
   * carry lights too.
   *
   * ⚠ A BIND FAILURE MUST NOT BLOCK BOOT. It costs the activity lights and
   * nothing else: `bindHooks` is simply never called, `spec.hooks` stays
   * undefined, and every launch is byte-identical to the pre-hooks app.
   */
  const hookConfigDir = join(app.getPath('userData'), 'agent-hooks')
  // Config files are per-session and deleted on exit, but a tree-kill or a
  // power loss leaves them behind — and each one holds a (now dead) capability
  // token. Boot is the one moment it is provably safe to clear the whole
  // directory: no session of THIS run has been spawned yet, so nothing in it
  // can still be in use. Cleared BEFORE the listener binds, for that reason.
  try {
    rmSync(hookConfigDir, { recursive: true, force: true })
  } catch (err) {
    logger.warn({ err }, '[agent-events] could not clear stale hook configs')
  }
  try {
    await agentEvents.start()
    sessions.bindHooks(agentEvents, hookConfigDir)
  } catch (err) {
    logger.error({ err }, '[agent-events] hook listener unavailable; sessions launch without lights')
  }

  /* Task 6a-1 / D148: the memory usage contract's per-session files.
   *
   * ⚠ BOUND OUTSIDE THE `try` ABOVE, AND THAT INDENTATION LEVEL IS THE WHOLE
   * POINT. `bindHooks` is inside it because a listener can fail to claim its
   * port; if this binder went in with it, a machine whose hook port is refused
   * would silently lose the memory contract too — two unrelated failures welded
   * together by nothing but proximity.
   *
   * ⚠ SAME DIRECTORY IDIOM AS `agent-hooks`, AND SWEPT FOR THE SAME REASON.
   * Files are per-session and deleted on exit, but a tree-kill or a power loss
   * leaves them behind. Boot is the one moment it is provably safe to clear the
   * whole directory: no session of THIS run has been spawned yet, so nothing in
   * it can still be in use. These hold no capability — unlike a hook config —
   * so the sweep is litter control rather than a security property.
   */
  const instructionsDir = join(app.getPath('userData'), 'agent-instructions')
  try {
    rmSync(instructionsDir, { recursive: true, force: true })
  } catch (err) {
    logger.warn({ err }, '[memory] could not clear stale instruction files')
  }
  sessions.bindInstructionsDir(instructionsDir)

  /* Task 4a-4 / D141: the scrollback mirror — one flat file per session under
   * userData, so a restored pane comes back with its history instead of an
   * empty terminal (docs/PLAN.md:173).
   *
   * ⚠ SAME DIRECTORY IDIOM AS `agent-hooks` ABOVE, AND FOR THE SAME REASON.
   * These files are a plaintext record of the user's work: userData gives them
   * the same location, and therefore the same OS protection, as `chorus.db`.
   * Never TEMP, never a project directory — a mirror inside a repo eventually
   * gets committed by an agent that was told to `git add -A`.
   *
   * ⚠ BOUND BEFORE THE FIRST RESTORE, which is what makes restored panes carry
   * history at all: `spawn` reads its seed at construction, so a store bound
   * after the restore below would arrive one boot too late.
   *
   * ⚠ AND SWEPT ONCE, HERE, BEFORE ANY SPAWN. A row deleted while the app was
   * closed leaves a mirror with nothing pointing at it — deleted, not
   * resurrected. The sweep is app-wide (`getAllSessionStates`), not per
   * project, because the directory is: sweeping one project's live ids would
   * delete every other project's history. A sweep failure costs the sweep and
   * nothing else. */
  const scrollback = createScrollbackStore(join(app.getPath('userData'), 'scrollback'))
  sessions.bindScrollback(scrollback)
  try {
    scrollback.pruneOrphans(new Set(storage.getAllSessionStates().map((s) => s.id)))
  } catch (err) {
    logger.warn({ err }, '[scrollback] orphan sweep failed; stale mirrors remain until next boot')
  }

  /* v16: the context ring's tracker.
   *
   * ⚠ CONSTRUCTED OUTSIDE THE try/catch ABOVE, ON PURPOSE. A failed hook
   * listener costs Claude its ring but must not cost CODEX one — the Codex
   * source is a scrape of PTY output and does not involve the listener or its
   * port at all. Putting this inside that block would have coupled two
   * independent sources to one failure.
   *
   * The launch-model resolver is injected because only the LAUNCH knows whether
   * a `[1m]` window was asked for; the transcript records the base model either
   * way (contextUsageCore). Fail-safe to null — an unresolvable profile means
   * the 200k default, which is what every current Claude model actually is.
   */
  contextUsage = createContextUsageTracker({
    resolveLaunchModel: (sessionId) => {
      try {
        const row = storage?.getSessionById(sessionId)
        if (!row?.launchProfileId) return null
        return storage?.getLaunchProfileById(row.launchProfileId)?.model ?? null
      } catch (err) {
        logger.warn({ err, sessionId }, '[context] could not resolve launch model; assuming default window')
        return null
      }
    }
  })
  sessions.bindContextUsage(contextUsage)
  // Claude's source: every hook body that names a transcript. The tracker
  // throttles its own reads (READ_THROTTLE_MS) — this fires per hook event.
  agentEvents.onTranscriptPath((sessionId, transcriptPath) => {
    contextUsage?.noteClaudeTranscript(sessionId, transcriptPath)
  })
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

  // Task 8-0: TURN telemetry — the same three lines one granularity down. A
  // dispatch is one PTY lifetime and almost never ends observably (F52: 5 of
  // 172 reached `completed`); a turn is bounded by two hook events that are
  // already arriving and being thrown away. Heal BEFORE restore for the exact
  // reason the dispatch heal above does.
  //
  // ⚠ `attach` IS HERE RATHER THAN INSIDE THE `agentEvents.start()` TRY BLOCK
  // ABOVE, WHICH IS A DELIBERATE DEPARTURE FROM ImplementationSpec-8-0 §5. The
  // spec asks for construction beside this line AND attachment ~100 lines
  // EARLIER, which cannot both hold — the recorder would not exist yet. Its
  // stated worry is a boot where "the lights still work but no turns are
  // recorded", and attaching out here is what prevents that rather than causes
  // it: `onActivity` is a plain Set on an object that exists from module scope,
  // so subscribing succeeds whether or not the port bound, and this line cannot
  // be skipped by a listener failure. If the bind DID fail, no callback ever
  // fires and the recorder writes nothing — the correct outcome, reached
  // without coupling turn capture to the listener's error path.
  turns = createTurnRecorder(storage)
  turns.healOrphansAtBoot()
  turns.attach(agentEvents, sessions)

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
  //
  // ⚠ AND THE SEED IS CONDITIONAL ON THAT DIRECTORY EXISTING, BECAUSE IT IS A
  // PATH ON ONE DEVELOPER'S MACHINE. Unconditionally it seeded
  // `C:\Projects\ContactEstablished\Chorus` on ANY machine — so a copy running
  // anywhere else opened with a project whose root does not exist, and every
  // git and worktree call against it fails on a path the user never chose.
  // Found while packaging a build for a second machine, 2026-07-28.
  //
  // ⚠ NO SUBSTITUTE SEED IS INVENTED. Seeding the home directory or Documents
  // would put a project the user did not ask for in their rail, and a project
  // root is not a neutral choice — it is what worktrees are created under.
  // Booting with NO project is the honest first-run state, and the four uses
  // below are guarded for it rather than being handed a fiction.
  //
  // ⚠ AND THE SEED READS BEFORE IT CREATES (v15). `getOrCreateProject` is the
  // RESURRECTION path — it reactivates a hidden or archived row, because
  // picking a folder in the picker says you want that project back. Boot is not
  // a click: nobody picked anything. Routing the seed through it would mean
  // archiving your dev project and restarting SILENTLY UN-ARCHIVES IT, which is
  // the archive feature failing at the one moment nobody is watching. So the
  // seed asks `getProjectByRootPath` first and only creates when there is
  // genuinely no row — and an archived DEV_WORKING_DIR stays archived, which
  // leaves the app in the honest no-active-project state below.
  let active = storage.getActiveProjectId()
  let project = active ? storage.getProjectById(active) : null
  if (!project && existsSync(DEV_WORKING_DIR)) {
    const existing = storage.getProjectByRootPath(DEV_WORKING_DIR)
    if (!existing) {
      project = storage.getOrCreateProject(DEV_WORKING_DIR).project
      storage.setActiveProjectId(project.id)
    } else if (existing.status === 'active') {
      project = existing
      storage.setActiveProjectId(project.id)
    }
  }
  logger.info(
    project
      ? `[storage] project '${project.name}' (${project.rootPath}) db=chorus.db`
      : '[storage] no project yet — first run on this machine; the rail offers Add project'
  )

  // ⚠ SILENT ON A CLEAN DATABASE, WHICH IS WHY IT IS WORTH HAVING (F47). Rows
  // naming a project that no longer exists are invisible to every surface the
  // app has — reads are scoped by `project_id`, so an orphan simply never
  // matches anything — and 22 of them sat in this developer's database for six
  // weeks. `PRAGMA foreign_key_check` would have caught the FK-enforced ones,
  // but nothing runs it, and it says nothing at all about the soft-pointer
  // tables. One line at boot turns "we assume the schema held" into a fact that
  // is checked on every start.
  //
  // ⚠ GUARDED, AND IT COST A WORKING APP TO LEARN THAT A DIAGNOSTIC MUST NEVER
  // BE LOAD-BEARING (2026-08-08). This ran unwrapped while the reconcile
  // below it was already wrapped, and the asymmetry was invisible until page
  // corruption in `attention_spans` — a TELEMETRY table — made the scan throw
  // `SQLITE_CORRUPT`. The throw became an unhandled rejection, boot stopped
  // BEFORE `registerIpc`, and every channel in the app went with it: Providers
  // and keys rendered empty, and so did the adapter dropdown, which is a frozen
  // array in this process and reads no database at all. Nothing on screen said
  // "corrupt" — it said "your settings are gone", which is the shape
  // `PACKAGED_USER_DATA_DIR`'s comment above already warns is the worst one a
  // data problem can take.
  //
  // ⚠ THE SEVERITY IS INVERTED WITHOUT THIS: the check exists to REPORT damage,
  // so the one input it must survive is a damaged database. A row-counting
  // diagnostic that can brick startup is strictly worse than no diagnostic.
  // Logged at error level rather than warn — a check that could not run is a
  // different fact from a check that ran and found nothing.
  try {
    const orphans = storage.countOrphanedProjectRows()
    if (orphans.length > 0) {
      logger.warn(
        `[storage] ⚠ ${orphans.reduce((n, o) => n + o.n, 0)} row(s) name a project that does not exist: ` +
          orphans.map((o) => `${o.table}=${o.n}`).join(' ') +
          ' — see roadmap F47'
      )
    }
  } catch (err) {
    logger.error({ err }, '[storage] orphan-row check failed; continuing boot')
  }

  // 2-2: the SAME manager instance the boot reconcile uses is threaded into
  // the IPC layer — session:launch's new-worktree path is createWorktree's
  // first caller. (Construction already precedes this call.)
  // 3-2: the vault rides along for the credential:*/provider:* handlers.
  // Task 6-3: the memory service and its bolt driver. Constructed HERE rather
  // than inside `registerIpc` for the reason `attention` and `attribution` are:
  // 'before-quit' has to dispose the driver, and a service built inside the IPC
  // layer is not reachable from there. The driver itself is LAZY — this
  // constructs no connection and opens no socket.
  // Task 6-5: the directory Chorus writes agent MCP configs into. MAIN OWNS
  // THIS PATH — it is `userData`-relative, and an adapter that computed it
  // would be an adapter that knows Electron's layout (the `hookConfigDir`
  // precedent a few hundred lines up). It is inside Chorus's own data
  // directory, which is the security property: never the user's repository and
  // never a CLI's global config (D49).
  // ⚠ CAPTURED IN A LOCAL BEFORE THE CLOSURE. `storage` is a module-level
  // `| null`, and `rootPathFor` below runs LATER — long after this function
  // returns — so reading the mutable binding from inside it would not
  // typecheck and, worse, could observe a different value than the one this
  // service was built with.
  const storageForIndex = storage
  memory = createMemoryService(storage, createNeo4jClient(), {
    mcpConfigDir: join(app.getPath('userData'), 'mcp'),
    // Task 6a-2: the git reads `index` needs, handed over rather than imported
    // so `memoryService.ts` stays loadable under plain node (its unit suite
    // cannot pull in `node:child_process`). The project's OWN checkout only —
    // `workspaceInstanceId` is `pj:<projectId>`, and indexing each live
    // worktree too would multiply every node and make MODIFIED edges ambiguous.
    codeIndex: {
      rootPathFor: (projectId) =>
        storageForIndex.listProjects().find((p) => p.id === projectId)?.rootPath ?? null,
      lsFiles,
      rootCommitShas,
      logNameOnly,
      countCommits
    },
    // Task 6a-4: the docker calls the provisioner needs, injected for exactly
    // the reason the git reads above are — `docker.ts` imports
    // `node:child_process`, and `memoryService.ts` must stay loadable under
    // plain node so its unit suite can assert refusals without a daemon.
    docker: {
      available: dockerAvailable,
      inspect: inspectContainer,
      run: runContainer,
      start: startContainer,
      stop: stopContainer,
      remove: removeContainer,
      findFreePort: findFreeBoltPort
    },
    // The container name is derived from the project's DISPLAY NAME, which only
    // storage knows. Handed over as a thunk on the same reasoning as
    // `rootPathFor`: the naming rule itself is pure and lives in `dockerCore`.
    projectNameFor: (projectId) =>
      storageForIndex.listProjects().find((p) => p.id === projectId)?.name ?? null
  })
  /**
   * Task 5-1: the main-side capture sink.
   *
   * ⚠ EVERY FRAME IS COUNTED AND THEN DISCARDED IN THIS TASK, and the discard is
   * injected rather than written inside the service precisely so Task 5-2 can
   * replace it with the WAV assembly without touching the queue policy that this
   * task proved. See `voice.ts`'s header.
   */
  /**
   * Task 5-2: the local transcription engine.
   *
   * ⚠ ONE RESOLVER, BOTH PATHS, AND BOTH PROVEN. Under `electron-vite dev` the
   * binaries sit in the repo at `resources/whisper/`; in a packaged build
   * `extraResources` (electron-builder.yml) copies them to
   * `process.resourcesPath/whisper/`, which is a real directory beside
   * `app.asar` rather than a path inside it — Windows cannot spawn an executable
   * or load a DLL from inside an archive at all, which is the same rule that
   * forces `asarUnpack` for node-pty. A path that works only in dev is the
   * classic way this ships broken, because every unit test and every dev drive
   * passes.
   */
  const whisperDir = app.isPackaged
    ? join(process.resourcesPath, 'whisper')
    : join(app.getAppPath(), 'resources', 'whisper')
  const whisper = createWhisperService({
    binaryPath: () => join(whisperDir, 'whisper-cli.exe'),
    modelDir: () => join(app.getPath('userData'), 'models'),
    tempDir: () => join(app.getPath('userData'), 'voice-temp'),
    runProcess: async (binary, args, opts) => {
      const { stdout, stderr } = await pExecFile(binary, args, {
        cwd: opts.cwd,
        timeout: opts.timeoutMs,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024
      })
      return { stdout, stderr }
    },
    fileSize: async (p) => {
      try {
        return (await fsp.stat(p)).size
      } catch {
        return null
      }
    },
    readTextFile: (p) => fsp.readFile(p, 'utf8'),
    writeBinaryFile: (p, data) => fsp.writeFile(p, data),
    // ⚠ THE MODEL DOWNLOAD STREAMS THROUGH THIS rather than buffering the whole
    // file in memory — 141 MB for base.en, 465 MB for small.en. See
    // `appendBinaryFile`'s note in whisper.ts for the version it replaced.
    appendBinaryFile: (p, data) => fsp.appendFile(p, data),
    removeFile: (p) => fsp.rm(p, { force: true }),
    renameFile: (from, to) => fsp.rename(from, to),
    ensureDir: async (p) => {
      await fsp.mkdir(p, { recursive: true })
    },
    fetch: (url, init) => fetch(url, init),
    newId: () => randomUUID(),
    joinPath: (...parts) => join(...parts)
  })

  /**
   * Task 5-4: the refiner is built inside `registerIpc` (it needs
   * `resolveCredential`, which lives there) and installed here afterwards.
   * Until it is, a network mode falls back to the original with
   * `not-configured` — which is also exactly right, since nothing can be
   * configured before IPC is up.
   */
  let voiceRefiner: VoiceRefiner | null = null

  voice = createVoiceService({
    newCaptureId: () => randomUUID(),
    // Task 5-2: the discard is gone. `voice.ts` accumulates the capture and
    // hands it here; `whisper.ts` owns the child process and the model.
    // Task 5-4: the model is the SETTING, read at transcription time, so a
    // change in Settings applies to the next dictation without a restart.
    transcribe: (samples) => whisper.transcribe(samples, { modelId: storageForIndex.readVoiceSettings().model }),
    // ⚠ SessionManager.write — the SAME path every other write in the app
    // takes. One call, no newline; see deliver() in voice.ts.
    writeToTarget: (targetId, text) => sessions.write(targetId, text),
    // Task 5-4: Verbatim / Clean up / Organize, from settings, read per dictation.
    refinementMode: () => storageForIndex.readVoiceSettings().refinement,
    refine: (req) => {
      if (voiceRefiner === null) return Promise.resolve(fallbackOutcome(req.original, req.mode, 'not-configured'))
      // The dispatch context: the HELD target's session row, read once here for
      // the spend row's opaque columns — never to re-aim the write.
      const row = req.targetSessionId === null ? null : storageForIndex.getSessionById(req.targetSessionId)
      return voiceRefiner.refine({
        original: req.original,
        mode: req.mode,
        target: { sessionId: req.targetSessionId, projectId: row?.projectId ?? null, cwd: row?.cwd ?? null }
      })
    },
    // Validated at write time; the id itself is never re-resolved.
    targetExists: (targetId) => sessions.isRunning(targetId),
    // ⚠ `queueMicrotask` RATHER THAN A SYNCHRONOUS CALL, so the queue genuinely
    // holds frames between arrival and consumption. With a synchronous drain the
    // depth would never exceed one and the bound could not engage at all — which
    // would make the backpressure gate untestable rather than passing.
    scheduleDrain: (run) => {
      // ⚠ A DEV-ONLY VERIFICATION SEAM, DOUBLE-GATED, AND IT EXISTS BECAUSE THE
      // BACKPRESSURE GATE CANNOT BE MET ANY OTHER WAY IN THE REAL PROCESS.
      // Task 5-1 must be able to show the queue BOUNDING and memory staying flat
      // while it drops — and a stalled consumer cannot be simulated from outside
      // main, because microtasks drain between IPC messages no matter how fast a
      // renderer sends. Unit tests prove the policy; this proves it in the
      // process that actually runs it.
      //
      // `is.dev` AND an explicit env var, so a packaged build has no path to it
      // at all. Task 5-2 replaces the discard consumer with real work and should
      // delete this along with it.
      if (is.dev && process.env['CHORUS_VOICE_STALL'] === '1') return
      queueMicrotask(run)
    }
  })

  /**
   * Task 5-3: the dictation overlay and the global hotkey.
   *
   * ⚠ THE OVERLAY IS BUILT LAZILY AND SHOWN WITH `showInactive()`. It must never
   * take focus — push-to-talk exists to dictate while ANOTHER application owns
   * the foreground, and an overlay that activates both moves the user's caret
   * and changes what "the focused pane" means mid-capture.
   */
  overlay = createVoiceOverlay({
    preloadPath: join(__dirname, '../preload/index.js'),
    rendererUrl: is.dev && process.env['ELECTRON_RENDERER_URL'] ? process.env['ELECTRON_RENDERER_URL'] : null,
    rendererDir: join(__dirname, '../renderer'),
    workArea: () => screen.getPrimaryDisplay().workArea
  })

  const voiceService = voice
  /**
   * The overlay is visible while there is something to indicate — and, from
   * Task 5-4, for a moment AFTER, so the outcome can be read.
   *
   * ⚠ THE OUTCOME LINE IS THE ONE PLACE A REFINEMENT FALLBACK IS SEEN. The user
   * dictates while another application owns the foreground; the main window is
   * not in view, and toasts are dead on this machine (ToastEnabled=0). If the
   * overlay vanished the instant the state left `refining`, "your original words
   * were inserted because refinement timed out" would be shown to nobody. So
   * terminal states linger for a few seconds and then hide.
   */
  let overlayHide: ReturnType<typeof setTimeout> | null = null
  voiceService.onState((state) => {
    if (overlayHide) {
      clearTimeout(overlayHide)
      overlayHide = null
    }
    if (state.state === 'listening' || state.state === 'finalizing' || state.state === 'refining') {
      overlay?.show()
      return
    }
    if (state.state === 'inserted' || state.state === 'ready-for-review' || state.state === 'failed') {
      overlay?.show()
      overlayHide = setTimeout(() => {
        overlayHide = null
        overlay?.hide()
      }, VOICE_OVERLAY_LINGER_MS)
      return
    }
    overlay?.hide()
  })

  /**
   * ⚠ PUSH-TO-TALK IS ONE OF TWO PEER ROUTES INTO THE SAME CAPTURE, AND THE
   * OTHER ONE DOES NOT PASS THROUGH HERE. If this hook fails to load, PTT is
   * unavailable and click-to-talk still dictates end to end — it is the
   * accessibility path (VoicePlan §7.2: a sustained hold is exactly the
   * interaction a motor-impaired user cannot perform), so it may not depend on a
   * native module.
   */
  hotkey = createHotkeyService({
    // ⚠ REQUIRED INSIDE THE SEAM, NOT AT MODULE SCOPE. A missing, corrupt or
    // ABI-mismatched .node must become a typed refusal rather than a boot crash.
    load: () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('uiohook-napi')
      return { uIOhook: mod.uIOhook, UiohookKey: mod.UiohookKey }
    },
    onActivate: (action) => {
      if (action === 'start') voiceService.startCapture()
      else {
        const id = voiceService.state().captureId
        if (id) voiceService.stopCapture(id)
      }
    },
    onCycleTarget: () => {
      // The panes the user can see, in the order they see them.
      // The panes of the ACTIVE project, in the order storage returns them —
      // the order the user sees. `nextTarget` must not re-sort it.
      const pid = storage?.getActiveProjectId() ?? null
      const ids = pid ? storage!.getSessionsForProject(pid).map((r) => r.id) : []
      voiceService.cycleTarget(ids)
    }
  })
  /**
   * Task 5-4: the chord and mode come from SETTINGS, and `configure` is the one
   * path that applies them — at boot here, and on every save in `ipc.ts`. A
   * null chord means the user turned push-to-talk off, and the hook is then
   * never installed at all.
   */
  const bootVoiceSettings = storageForIndex.readVoiceSettings()
  const hotkeyStart = hotkey.configure({
    chord: bootVoiceSettings.hotkey === null ? null : parseChord(bootVoiceSettings.hotkey),
    mode: bootVoiceSettings.activation
  })
  if (!hotkeyStart.ok) {
    logger.info(
      { reason: hotkeyStart.reason },
      '[voice] push-to-talk unavailable; click-to-talk is unaffected'
    )
  }

  council = registerIpc(
    sessions,
    storage,
    worktrees,
    vault,
    attention,
    attribution,
    // 3b-3: the SAME client `attribution` holds, and the SAME thunk it asks.
    keys,
    () => managementProfileId() !== null,
    // The SAME listener `sessions` mints tokens from — one port, one map.
    agentEvents,
    // The tenth, on the precedent every one above it set.
    memory,
    // v17: the eleventh — and the SAME tracker `sessions` feeds Codex output
    // to, so there is one map rather than two that can disagree.
    contextUsage,
    // Task 5-1: the twelfth, on the precedent every one above it set.
    voice,
    // Task 5-3: the thirteenth.
    hotkey,
    // Task 5-4: the fourteenth — the same engine `voice` transcribes through.
    whisper,
    // Task 5-4: the refiner comes BACK through this seam once registerIpc has
    // built it around `resolveCredential`.
    (refiner) => {
      voiceRefiner = refiner
    }
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
  // ⚠ TASK 6-3: THIS IS THE SLOT A MEMORY BOOT RECONCILE MUST OCCUPY, AND IT IS
  // DELIBERATELY EMPTY RATHER THAN HOLDING A NO-OP CALL.
  //
  // Stage 2 configures a memory graph the USER already runs; Chorus starts no
  // container and owns no resource that could have gone away while it was shut
  // down, so there is genuinely nothing to reconcile yet and a
  // `memory.reconcileAll()` that returned immediately would be a stub — the
  // thing D76 forbids, one layer down. A comment is a note to the next person;
  // a no-op call site is a lie that typechecks.
  //
  // WHEN STAGE 5 LANDS its container reconcile belongs HERE: in the same band
  // as `worktrees.reconcileAll()` above and `dispatches.healOrphansAtBoot()`,
  // and therefore BEFORE `sessions.restore(...)` below. The reason is the one
  // plan §9 gives — restore relaunches sessions, and a session launched before
  // the reconcile can be handed an MCP config pointing at a container the
  // reconcile is about to mark dead.
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
  //
  // ⚠ THE COUNT IS READ BEFORE THE RESTORE RUNS, AND THE ORDER IS THE POINT.
  // `restore()` is async but its first pass is SYNCHRONOUS up to the first
  // stagger await — it heals rows and can spawn the first session before ever
  // yielding — so a count taken afterwards would already be missing whatever
  // that pass consumed. Taken here it is the plan, which is what the splash
  // means by "restoring N sessions". (Read-only: planRestoreCount spawns
  // nothing and writes nothing, so it cannot disturb the run below.)
  //
  // ⚠ WITH NO PROJECT THERE IS NOTHING TO RESTORE, AND THAT IS A STATE RATHER
  // THAN AN ERROR (first run on a machine the DEV_WORKING_DIR seed does not
  // match). The splash must say "restoring 0", not stall on a count it cannot
  // take, and the window falls back to the product name.
  const restoringSessions = project ? sessions.planRestoreCount(project.id) : 0
  if (project) void sessions.restore(project.id)
  const win = createWindow(restoringSessions)
  win.setTitle(project?.name ?? 'Chorus')

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
    // 0, not `restoringSessions`: this re-opens a window in an app that is
    // ALREADY UP, so the restore run above is long finished and nothing is
    // coming back. Replaying the boot count here would make the splash claim a
    // restore that already happened.
    if (BrowserWindow.getAllWindows().length === 0) createWindow(0)
  })
})

app.on('before-quit', () => {
  sessions.dispose()
  // Task 3a-1: AFTER dispose (some rows close via onExit during teardown),
  // BEFORE the DB closes. Idempotent — closeDispatch's WHERE clause makes a
  // second close a no-write.
  dispatches?.closeOpenOnQuit()
  // Task 8-0: the same close, one granularity down — AFTER dispose (a session
  // dying during teardown closes its own turn via onExit) and BEFORE
  // `storage?.close()` below. Idempotent: closeAgentTurn's WHERE clause makes a
  // second close a no-write.
  turns?.closeOpenOnQuit()
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
  // Close the hook port and drop every capability token. `sessions.dispose()`
  // above already retired each live session's own, so this is the backstop for
  // anything it could not see — and it is fire-and-forget for the same reason
  // the council abandon above is: 'before-quit' does not await.
  void agentEvents.dispose()
  // Task 6-3: close the bolt driver's connection pool. Fire-and-forget for the
  // same reason the council abandon and the hook-port close above are:
  // 'before-quit' does not await. What matters is that the close is REQUESTED
  // before the process goes — a pool left open holds live sockets, and an
  // open handle is what keeps a process alive after it has been told to stop.
  // Almost always a no-op: the driver is lazy, so unless somebody clicked Test
  // this session there is nothing to close.
  void memory?.dispose()
  memory = null
  // Task 5-1: abandon a capture in flight. Synchronous and cheap — it clears a
  // queue and a capture id held in main's memory. The DEVICE is released by the
  // renderer (`capture.ts` stops each track on every exit path); this is the
  // main-side half, and it exists so a quit during a dictation cannot leave the
  // sink believing a capture is still live.
  voice?.dispose()
  voice = null
  // ⚠ THE GLOBAL KEYBOARD HOOK COMES DOWN WITH THE APP, ALWAYS. See the
  // declaration above for why this is worse than a leaked file handle.
  hotkey?.stop()
  hotkey = null
  overlay?.destroy()
  overlay = null
  storage?.close()
  storage = null
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
