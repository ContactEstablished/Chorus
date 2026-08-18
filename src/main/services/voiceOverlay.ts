import { BrowserWindow } from 'electron'
import { join } from 'path'
import { logger } from './logger'

/**
 * The dictation overlay window (Task 5-3).
 *
 * ⚠ `focusable: false` IS THE POINT OF THE WHOLE FEATURE, NOT A POLISH DETAIL.
 * Push-to-talk exists to dictate at a Chorus pane WHILE AN IDE OWNS THE
 * FOREGROUND (VoicePlan §7.1). An overlay that activates:
 *
 *   (a) takes focus from the editor the user is reading — the exact thing they
 *       were avoiding by not alt-tabbing; and
 *   (b) changes what "the focused pane" means MID-CAPTURE, which can move the
 *       dictation target out from under the ring the user is looking at.
 *
 * So it is shown with `showInactive()` and NEVER with `show()`. A reviewer
 * should treat any `show()` on this window as a defect.
 *
 * ⚠ AND IT NEVER RENDERS TRANSCRIPT TEXT. It floats above every application on
 * the desktop, including whatever the user happens to be screen-sharing. It
 * shows a state, a level, a pane name and an elapsed time — all of which the
 * user can already see or already knows.
 */

/** Small, and parked out of the way of the centre of the screen. */
const OVERLAY_WIDTH = 320
const OVERLAY_HEIGHT = 96
const SCREEN_MARGIN = 24

export interface VoiceOverlay {
  /** Create (once) and reveal WITHOUT activating. */
  show(): void
  hide(): void
  /** Push a payload to the overlay's renderer. */
  send(channel: string, payload: unknown): void
  destroy(): void
  isVisible(): boolean
}

export interface VoiceOverlayDeps {
  readonly preloadPath: string
  /** Dev server URL, or null when loading from disk. */
  readonly rendererUrl: string | null
  /** Directory the built renderer lives in, for the packaged load. */
  readonly rendererDir: string
  /** Where to park the window. Injected so the caller owns display geometry. */
  readonly workArea: () => { x: number; y: number; width: number; height: number }
}

export function createVoiceOverlay(deps: VoiceOverlayDeps): VoiceOverlay {
  let win: BrowserWindow | null = null

  function build(): BrowserWindow {
    const area = deps.workArea()
    const created = new BrowserWindow({
      width: OVERLAY_WIDTH,
      height: OVERLAY_HEIGHT,
      // Bottom-right of the work area, clear of the taskbar.
      x: area.x + area.width - OVERLAY_WIDTH - SCREEN_MARGIN,
      y: area.y + area.height - OVERLAY_HEIGHT - SCREEN_MARGIN,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      // Not in the taskbar and not in Alt-Tab: this is an indicator, not a window
      // the user manages.
      skipTaskbar: true,
      // ⚠ THE LOAD-BEARING ONE. See the file header.
      focusable: false,
      show: false,
      // ⚠ THE SAME HARDENED webPreferences AS THE MAIN WINDOW. A second window
      // with a laxer policy is a policy hole with a nice UI on it.
      webPreferences: {
        preload: deps.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    })

    // ⚠ 'screen-saver' IS THE LEVEL THAT ACTUALLY STAYS ABOVE A FULL-SCREEN
    // EDITOR. Plain `alwaysOnTop: true` sits at 'floating', which a maximized or
    // full-screen foreground window can cover — and being covered exactly when
    // another app owns the screen is the one case this overlay exists for.
    created.setAlwaysOnTop(true, 'screen-saver')
    created.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    // Belt to `focusable: false`'s brace: never steal activation on Windows.
    created.setFocusable(false)

    // ⚠ CLICKS PASS THROUGH TO WHATEVER IS UNDERNEATH. The overlay covers a
    // corner of the screen for the duration of a dictation; a user reaching for
    // something under it must not be blocked by an indicator.
    created.setIgnoreMouseEvents(true)

    created.on('closed', () => {
      win = null
    })

    if (deps.rendererUrl) {
      void created.loadURL(`${deps.rendererUrl}/src/voice/overlay.html`)
    } else {
      void created.loadFile(join(deps.rendererDir, 'src', 'voice', 'overlay.html'))
    }
    return created
  }

  return {
    show(): void {
      try {
        if (!win || win.isDestroyed()) win = build()
        // ⚠ `showInactive()`, NEVER `show()`. `show()` activates the window.
        win.showInactive()
      } catch (err) {
        // The overlay is an indicator. Losing it must never take down a capture
        // — the dictation still works, the user just cannot see it.
        logger.error({ err }, '[voice] overlay could not be shown')
      }
    },

    hide(): void {
      if (!win || win.isDestroyed()) return
      try {
        win.hide()
      } catch (err) {
        logger.error({ err }, '[voice] overlay could not be hidden')
      }
    },

    send(channel: string, payload: unknown): void {
      if (!win || win.isDestroyed()) return
      try {
        win.webContents.send(channel, payload)
      } catch {
        // A window torn down between the check and the send is not an error.
      }
    },

    destroy(): void {
      if (!win || win.isDestroyed()) {
        win = null
        return
      }
      const w = win
      win = null
      try {
        w.destroy()
      } catch (err) {
        logger.error({ err }, '[voice] overlay could not be destroyed')
      }
    },

    isVisible: (): boolean => win !== null && !win.isDestroyed() && win.isVisible()
  }
}
