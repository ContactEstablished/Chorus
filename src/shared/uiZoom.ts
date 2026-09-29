/**
 * Text size — the whole-app zoom set in Settings > Appearance and nudged by
 * Ctrl+= / Ctrl+- / Ctrl+0.
 *
 * ⚠ FIVE PERCENT STEPS, NOT CHROMIUM'S PRESET LADDER. Electron's default menu
 * zoom walks 100 → 110 → 125 → 150 → 175, which is the "huge jumps" this
 * setting exists to replace. At the 14px terminal font one step here is ~0.7px.
 *
 * Pure and shared so main (which owns the zoom) and the settings screen (which
 * only draws it) agree on the ladder without either owning it.
 */

export const UI_ZOOM_MIN_PERCENT = 70
export const UI_ZOOM_MAX_PERCENT = 200
export const UI_ZOOM_STEP_PERCENT = 5
export const UI_ZOOM_DEFAULT_PERCENT = 100

/** Clamp into range and round to the nearest step, so any number becomes a
 *  value the stored schema accepts. */
export function normalizeZoomPercent(percent: number): number {
  if (!Number.isFinite(percent)) return UI_ZOOM_DEFAULT_PERCENT
  const snapped = Math.round(percent / UI_ZOOM_STEP_PERCENT) * UI_ZOOM_STEP_PERCENT
  return Math.min(UI_ZOOM_MAX_PERCENT, Math.max(UI_ZOOM_MIN_PERCENT, snapped))
}

export type UiZoomAction = 'in' | 'out' | 'reset'

/** Where one shortcut press lands from `current`. Stops at the ends rather than
 *  wrapping. */
export function applyZoomAction(current: number, action: UiZoomAction): number {
  if (action === 'reset') return UI_ZOOM_DEFAULT_PERCENT
  const delta = action === 'in' ? UI_ZOOM_STEP_PERCENT : -UI_ZOOM_STEP_PERCENT
  return normalizeZoomPercent(normalizeZoomPercent(current) + delta)
}

/**
 * Which zoom shortcut a key press is, or null. The shape is Electron's
 * `before-input-event` Input, reduced to the fields read here.
 *
 * ⚠ MATCHED ON `key`, NOT `code`, so Ctrl+_ is never a zoom. xterm 6 sends
 * NOTHING for Ctrl+=, Ctrl+- or Ctrl+0 (verified in its keyboard evaluator), so
 * taking those three steals nothing from a pane. Ctrl+Shift+- is `key: '_'`,
 * which xterm would send as ^_ (undo) — though today it never gets the chance:
 * electron-toolkit's `watchWindowShortcuts` (index.ts, every window) cancels
 * every `code: 'Minus'` + Ctrl press, shifted or not, before the page sees it.
 * That predates this and is left alone. Numpad +/-/0 report the same keys.
 *
 * ⚠ ALT EXCLUDES IT: AltGr arrives as Ctrl+Alt, and on layouts where AltGr
 * types `=` or `0` that is a character, not a zoom.
 */
export function zoomActionForKey(input: {
  type: string
  key: string
  control: boolean
  alt: boolean
  meta: boolean
}): UiZoomAction | null {
  if (input.type !== 'keyDown' || !input.control || input.alt || input.meta) return null
  switch (input.key) {
    case '=':
    case '+':
      return 'in'
    case '-':
      return 'out'
    case '0':
      return 'reset'
    default:
      return null
  }
}
