/**
 * The pure half of voice activation (Task 5-3).
 *
 * ⚠ NO `uiohook-napi`, NO `electron`, NO CLOCK. `uiohook` needs a real OS input
 * stack and cannot be unit-tested, so ALL activation logic lives here behind a
 * pure interface and the impure wrapper in `hotkey.ts` stays thin enough to
 * review by eye. This file is where activation correctness is actually proven.
 *
 * ⚠ AND IT DELIBERATELY DOES NOT IMPORT `uiohook-napi` FOR ITS KEY TABLE.
 * Importing it would load a native `.node` binding into every unit test — and
 * into a module whose whole claim is that it has no effects. The small key table
 * below is a copy, its values read from the shipped typings on 2026-08-17, and
 * `hotkey.ts` CROSS-CHECKS it against the real `UiohookKey` at startup, turning a
 * drift into a typed load failure rather than a hotkey that silently never
 * fires. Same discipline as `pcm-worklet.js`'s frame size in Task 5-1.
 */

/* ─────────────────────────── the key table ────────────────────────────────── */

/**
 * The subset of `UiohookKey` this feature can bind, name → keycode.
 *
 * ⚠ VALUES READ FROM `node_modules/uiohook-napi/dist/index.d.ts` ON 2026-08-17
 * (v1.5.5, 124 entries total). Verified in this pass: `Tab` 15, `Ctrl` 29,
 * `Shift` 42, `Alt` 56, `Space` 57, `Escape` 1, `F8` 66. `hotkey.ts` asserts
 * every entry here against the live table before it starts the hook.
 */
export const HOTKEY_CODES = {
  Escape: 1,
  Tab: 15,
  Ctrl: 29,
  Shift: 42,
  Alt: 56,
  Space: 57,
  F8: 66
} as const

export type HotkeyName = keyof typeof HOTKEY_CODES

/** The modifiers a chord may require. `Ctrl` here means EITHER control key —
 *  uiohook reports left/right separately as keycodes but sets one `ctrlKey`. */
export interface ChordModifiers {
  readonly ctrl: boolean
  readonly shift: boolean
  readonly alt: boolean
  readonly meta: boolean
}

export interface Chord extends ChordModifiers {
  /** The non-modifier key that completes the chord. */
  readonly key: HotkeyName
}

/**
 * Chorus's default push-to-talk chord.
 *
 * ⚠ CTRL+SHIFT+SPACE RATHER THAN A BARE FUNCTION KEY, AND THE REASON IS THAT
 * THIS HOOK IS GLOBAL. A bare `F8` would fire while the user is typing in any
 * application that binds it, and a modifier-less binding on a system-wide hook
 * is how a dictation feature starts eating other programs' shortcuts. The
 * surface that lets a user change it is Task 5-4's (D76).
 */
export const DEFAULT_CHORD: Chord = { key: 'Space', ctrl: true, shift: true, alt: false, meta: false }

/* ─────────────────────────── chord parse / format ─────────────────────────── */

const MODIFIER_ALIASES: Record<string, keyof ChordModifiers> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  shift: 'shift',
  alt: 'alt',
  meta: 'meta',
  win: 'meta',
  super: 'meta',
  cmd: 'meta'
}

/** Canonical order, so `formatChord(parseChord(s))` is stable. */
const MODIFIER_ORDER: Array<keyof ChordModifiers> = ['ctrl', 'shift', 'alt', 'meta']
const MODIFIER_LABEL: Record<keyof ChordModifiers, string> = {
  ctrl: 'Ctrl',
  shift: 'Shift',
  alt: 'Alt',
  meta: 'Meta'
}

/**
 * `"Ctrl+Shift+Space"` → a chord, or **null**.
 *
 * ⚠ AN UNPARSEABLE CHORD IS REFUSED, NEVER COERCED TO A DEFAULT. Silently
 * falling back to `DEFAULT_CHORD` on a typo would bind a global hotkey the user
 * did not ask for and never told them why theirs does not work — the caller
 * decides what a refusal means.
 */
export function parseChord(input: string): Chord | null {
  if (typeof input !== 'string') return null
  const parts = input
    .split('+')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
  if (parts.length === 0) return null

  const mods: Record<keyof ChordModifiers, boolean> = { ctrl: false, shift: false, alt: false, meta: false }
  let key: HotkeyName | null = null

  for (const part of parts) {
    const asModifier = MODIFIER_ALIASES[part.toLowerCase()]
    if (asModifier) {
      // A repeated modifier is a malformed chord, not a louder one.
      if (mods[asModifier]) return null
      mods[asModifier] = true
      continue
    }
    // Exactly one non-modifier key. A second one is malformed.
    if (key !== null) return null
    const match = (Object.keys(HOTKEY_CODES) as HotkeyName[]).find(
      (n) => n.toLowerCase() === part.toLowerCase()
    )
    if (!match) return null
    key = match
  }
  if (key === null) return null
  return { key, ...mods }
}

/** The canonical string form. Round-trips through `parseChord`. */
export function formatChord(chord: Chord): string {
  const parts = MODIFIER_ORDER.filter((m) => chord[m]).map((m) => MODIFIER_LABEL[m])
  parts.push(chord.key)
  return parts.join('+')
}

/* ──────────────────────────── the reducer ─────────────────────────────────── */

export type Activation = 'hold' | 'toggle'

/**
 * One keyboard event, already normalized off uiohook's own shape.
 *
 * ⚠ WIDER THAN `ImplementationSpec-5-3.md` §1's `{kind, keycode}`, DELIBERATELY.
 * A chord cannot be matched without the modifier state, and modifier matching is
 * activation logic — leaving it in the impure wrapper would put the part most
 * likely to be wrong in the one file that cannot be unit-tested. uiohook's
 * `UiohookKeyboardEvent` carries `ctrlKey`/`shiftKey`/`altKey`/`metaKey`, so this
 * is a rename, not an invention.
 */
export interface HotkeyEvent extends ChordModifiers {
  readonly kind: 'down' | 'up'
  readonly keycode: number
}

export interface ActivationState {
  /** A capture is open. */
  readonly listening: boolean
  /**
   * The chord's key is currently held.
   *
   * ⚠ THIS FIELD EXISTS ENTIRELY TO SURVIVE KEY REPEAT, AND KEY REPEAT IS
   * GUARANTEED. Windows emits `down` continuously while a key is held — a
   * five-second push-to-talk hold produces dozens of them. Without this, `hold`
   * mode would open a capture per repeat and `toggle` mode would flip state
   * dozens of times a second.
   */
  readonly keyDown: boolean
}

export const IDLE: ActivationState = { listening: false, keyDown: false }

export type ActivationAction = 'start' | 'stop' | 'none'

export interface ActivationResult {
  readonly state: ActivationState
  readonly action: ActivationAction
}

/** Does this event complete the chord? */
export function chordMatches(ev: HotkeyEvent, chord: Chord): boolean {
  return (
    ev.keycode === HOTKEY_CODES[chord.key] &&
    ev.ctrl === chord.ctrl &&
    ev.shift === chord.shift &&
    ev.alt === chord.alt &&
    ev.meta === chord.meta
  )
}

/**
 * The activation state machine.
 *
 * ⚠ IT NEVER STARTS A SECOND CAPTURE. A `start` is emitted only from
 * `listening: false`; a repeat, a second chord press in hold mode, or any event
 * arriving while a capture is open yields `none`. VoicePlan §7.2 requires
 * overlapping activations to be structurally impossible, and main's
 * `voice.startCapture` refuses as well — this is the first of the two, not the
 * only one.
 *
 * ⚠ THE RELEASE RULE DIFFERS BETWEEN MODES AND THAT IS THE WHOLE DISTINCTION:
 * in `hold`, the key going up ENDS the capture; in `toggle`, the key going up is
 * INERT and the next press ends it.
 */
export function reduce(
  state: ActivationState,
  ev: HotkeyEvent,
  mode: Activation,
  chord: Chord = DEFAULT_CHORD
): ActivationResult {
  // ⚠ THE RELEASE IS MATCHED ON THE KEYCODE ALONE, NOT ON THE WHOLE CHORD.
  // Releasing Ctrl+Shift+Space in the real world almost never releases all three
  // simultaneously: letting go of Shift first makes the Space `up` arrive with
  // `shift: false`, which no longer matches the chord. Requiring a full chord
  // match on release would strand the capture open until the user pressed the
  // exact combination again — measured as the obvious failure of the naive
  // implementation, and the reason down and up are matched differently.
  const isChordKey = ev.keycode === HOTKEY_CODES[chord.key]

  if (ev.kind === 'up') {
    if (!isChordKey) return { state, action: 'none' }
    if (mode === 'hold') {
      if (!state.listening) return { state: { ...state, keyDown: false }, action: 'none' }
      return { state: IDLE, action: 'stop' }
    }
    // toggle: the release is inert, but the key is no longer held.
    return { state: { ...state, keyDown: false }, action: 'none' }
  }

  // down
  if (!chordMatches(ev, chord)) return { state, action: 'none' }
  // The repeat guard. Every held key on Windows produces a stream of these.
  if (state.keyDown) return { state, action: 'none' }

  if (mode === 'hold') {
    if (state.listening) return { state: { ...state, keyDown: true }, action: 'none' }
    return { state: { listening: true, keyDown: true }, action: 'start' }
  }
  // toggle: this press flips whichever way we are.
  return state.listening
    ? { state: { listening: false, keyDown: true }, action: 'stop' }
    : { state: { listening: true, keyDown: true }, action: 'start' }
}

/* ──────────────────────────── target cycling ──────────────────────────────── */

export type TargetId = string

/**
 * The next dictation target, cycling in the order given and wrapping.
 *
 * ⚠ STABLE ORDER, AND THE CALLER OWNS IT. The list is the pane order the user
 * sees; this function must not sort, dedupe or reorder it, because the ring
 * jumping around a grid in an order that is not the visible one is worse than no
 * cycling at all.
 *
 * A single target is a no-op rather than a refusal: pressing Tab with one pane
 * open should do nothing visible, not report an error.
 */
export function nextTarget(targets: ReadonlyArray<TargetId>, current: TargetId | null): TargetId | null {
  if (targets.length === 0) return null
  if (targets.length === 1) return targets[0]
  if (current === null) return targets[0]
  const i = targets.indexOf(current)
  // An unknown current id starts the cycle rather than stranding it — the target
  // can legitimately have been deleted between one Tab and the next (F4).
  if (i === -1) return targets[0]
  return targets[(i + 1) % targets.length]
}
