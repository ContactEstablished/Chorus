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
 *
 * ⚠ IT IS NO LONGER CLICK-THROUGH, AND THAT IS A DELIBERATE REVERSAL (D181).
 * It used to call `setIgnoreMouseEvents(true)` so nothing underneath was ever
 * blocked. Matthew asked for a panel he can DRAG out of the way, and a window
 * that passes every click through cannot be grabbed — the two are the same bit.
 * So the panel catches the mouse for as long as it is visible.
 *
 * ⚠ THE DRAG IS `setPosition` FROM HERE, NOT `-webkit-app-region: drag`. The
 * titlebar's idiom — let Windows run the move loop — was tried first and does
 * not move this window, because `focusable: false` is `WS_EX_NOACTIVATE` and
 * DefWindowProc will not run an HTCAPTION move on one. `focusable: false` stays:
 * catching a click and taking focus are different things, and only the second
 * would break push-to-talk.
 */

/** The panel's own size. Tall enough for the mark, which IS the level meter. */
const OVERLAY_WIDTH = 320
const OVERLAY_HEIGHT = 188

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Keep `value` inside `[lo, hi]`, with `lo` winning if the range has inverted
 *  (a work area smaller than the overlay — rare, but a monitor can be). */
function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(value, hi))
}

/**
 * Where the overlay sits: THE CENTRE OF THE CHORUS WINDOW, clamped so it can
 * never land off-screen.
 *
 * ⚠ THE HOST IS THE APP WINDOW, NOT THE DISPLAY (D181). It used to be the
 * top-centre of the work area. Centring on Chorus is what Matthew asked for and
 * it does something the screen-relative version could not: two monitors, a
 * half-width window, a window dragged to a corner — the indicator turns up
 * where he is already looking rather than where the monitor happens to be.
 * `area` is still consulted, but now only as the CLAMP: a Chorus window hanging
 * off an edge (or larger than the display) must not take the overlay with it.
 *
 * `host` is null when there is no usable main window — none yet, destroyed, or
 * MINIMIZED, whose bounds are a meaningless off-screen rectangle. The work area
 * centre is the right answer in all three.
 *
 * ⚠ RECOMPUTED ON EVERY `show()`, NOT ONCE AT BUILD. The window is built lazily
 * and then hidden/shown for the life of the app; a position fixed at build time
 * would follow the monitor layout of the FIRST dictation forever (2026-08-19:
 * Matthew's first report had it at the bottom of a different monitor from the
 * one he was looking at — the primary display's bottom-right, fixed at build).
 * It is ALSO what makes a dragged overlay re-centre for the next dictation,
 * which is the behaviour Matthew chose over remembering where he left it.
 *
 * Pure and exported so the arithmetic is unit-testable without a BrowserWindow.
 */
export function overlayPlacement(host: Rect | null, area: Rect): { x: number; y: number } {
  const box = host ?? area
  return {
    x: clamp(
      Math.round(box.x + (box.width - OVERLAY_WIDTH) / 2),
      area.x,
      area.x + area.width - OVERLAY_WIDTH
    ),
    y: clamp(
      Math.round(box.y + (box.height - OVERLAY_HEIGHT) / 2),
      area.y,
      area.y + area.height - OVERLAY_HEIGHT
    )
  }
}

export interface VoiceOverlay {
  /** Create (once) and reveal WITHOUT activating. */
  show(): void
  hide(): void
  /**
   * Drag the panel (D181). `dx`/`dy` are cumulative from the gesture's origin;
   * `start` latches the position they are measured against.
   *
   * ⚠ THE DRAGGED POSITION IS NOT REMEMBERED, BY CHOICE. The next `show()`
   * recomputes the placement, so every dictation opens centred on Chorus again.
   * That is also what makes it safe not to clamp here: a panel dragged
   * somewhere unhelpful is undone by the next capture rather than persisted.
   */
  move(dx: number, dy: number, start: boolean): void
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
  /** The work area of the display to park the window on — read on EVERY
   *  show, so the caller should answer "where is the main window now", not a
   *  value cached at startup. Injected so the caller owns display geometry.
   *  Now the CLAMP rather than the anchor; see `overlayPlacement`. */
  readonly workArea: () => { x: number; y: number; width: number; height: number }
  /** The Chorus window's bounds — the thing the overlay centres on — or null
   *  when there is no usable one (absent, destroyed, or minimized). Read on
   *  every show, for the same reason `workArea` is. */
  readonly hostBounds: () => { x: number; y: number; width: number; height: number } | null
}

export function createVoiceOverlay(deps: VoiceOverlayDeps): VoiceOverlay {
  let win: BrowserWindow | null = null
  /** Where the panel was when the current drag began. Null between drags. */
  let dragOrigin: { x: number; y: number } | null = null

  function build(): BrowserWindow {
    const { x, y } = overlayPlacement(deps.hostBounds(), deps.workArea())
    const created = new BrowserWindow({
      width: OVERLAY_WIDTH,
      height: OVERLAY_HEIGHT,
      // Centred on the Chorus window (see overlayPlacement); re-placed on every
      // show, so this is only where the window is BORN.
      x,
      y,
      frame: false,
      transparent: true,
      resizable: false,
      // ⚠ TRUE, AND `setPosition` IS WHY — NOT the OS drag. Electron gates
      // `setPosition` on Windows behind `movable`, so a `movable: false` window
      // ignores it SILENTLY: no throw, no log, the window simply stays put.
      // Measured — the drag IPC arrived in main and moved nothing until this
      // flipped. (`show()`'s re-placement was equally inert; it only ever looked
      // right because the window is BUILT at the placement it wants.)
      movable: true,
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

    // ⚠ NO `setIgnoreMouseEvents` — see the file header. The panel catches the
    // mouse so it can be dragged, which is the trade Matthew chose over
    // clicking through it. It is only visible while a dictation is running.

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
        // ⚠ IDEMPOTENT, AND THAT IS THE WHOLE POINT OF THE GUARD (D181).
        // `index.ts` calls this on EVERY voice state event — about eight times a
        // second while listening — because the state machine's rule is "visible
        // whenever there is something to indicate". Re-placing on each of those
        // put the panel back in the middle eight times a second, which made a
        // drag look completely broken: the IPC arrived, `setPosition` returned
        // the new coordinates, and the window was already home again before
        // anything could read it. Placement belongs to the moment the panel
        // APPEARS, not to every push while it is up.
        if (win.isVisible()) return
        // The main window may have moved — to another display, or just across
        // this one — since the overlay was last shown, and the panel may have
        // been dragged away during the previous dictation. Recomputing here is
        // what answers both, and it is what makes "always re-centre" true.
        const { x, y } = overlayPlacement(deps.hostBounds(), deps.workArea())
        win.setPosition(x, y)
        dragOrigin = null
        // ⚠ `showInactive()`, NEVER `show()`. `show()` activates the window.
        win.showInactive()
      } catch (err) {
        // The overlay is an indicator. Losing it must never take down a capture
        // — the dictation still works, the user just cannot see it.
        logger.error({ err }, '[voice] overlay could not be shown')
      }
    },

    hide(): void {
      dragOrigin = null
      if (!win || win.isDestroyed()) return
      try {
        win.hide()
      } catch (err) {
        logger.error({ err }, '[voice] overlay could not be hidden')
      }
    },

    move(dx: number, dy: number, start: boolean): void {
      if (!win || win.isDestroyed()) return
      try {
        if (start || dragOrigin === null) {
          const [x, y] = win.getPosition()
          dragOrigin = { x, y }
        }
        win.setPosition(dragOrigin.x + dx, dragOrigin.y + dy)
      } catch (err) {
        // Losing a drag must never take down a capture; the panel just stays put.
        logger.error({ err }, '[voice] overlay could not be moved')
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
