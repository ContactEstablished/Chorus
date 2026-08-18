import { describe, it, expect } from 'vitest'
import {
  DEFAULT_CHORD,
  HOTKEY_CODES,
  IDLE,
  chordMatches,
  formatChord,
  nextTarget,
  parseChord,
  reduce,
  type ActivationState,
  type Chord,
  type HotkeyEvent
} from './hotkeyCore'

/** A chord event for the default chord (Ctrl+Shift+Space). */
const ev = (kind: 'down' | 'up', over: Partial<HotkeyEvent> = {}): HotkeyEvent => ({
  kind,
  keycode: HOTKEY_CODES.Space,
  ctrl: true,
  shift: true,
  alt: false,
  meta: false,
  ...over
})

/** Feed a sequence and collect the actions, the way the real hook would. */
function run(events: HotkeyEvent[], mode: 'hold' | 'toggle', chord: Chord = DEFAULT_CHORD) {
  let state: ActivationState = IDLE
  const actions: string[] = []
  for (const e of events) {
    const r = reduce(state, e, mode, chord)
    state = r.state
    if (r.action !== 'none') actions.push(r.action)
  }
  return { state, actions }
}

describe('the key table — a copy, cross-checked at runtime by hotkey.ts', () => {
  it('holds the values read from uiohook-napi v1.5.5 typings', () => {
    // ⚠ hotkeyCore MUST NOT import uiohook-napi: it would load a native .node
    // into every unit test, in the one module whose claim is that it has no
    // effects. These are the measured values; `hotkey.ts` asserts each against
    // the live `UiohookKey` before starting the hook, so a drift becomes a typed
    // load failure rather than a hotkey that silently never fires.
    expect(HOTKEY_CODES.Escape).toBe(1)
    expect(HOTKEY_CODES.Tab).toBe(15)
    expect(HOTKEY_CODES.Ctrl).toBe(29)
    expect(HOTKEY_CODES.Shift).toBe(42)
    expect(HOTKEY_CODES.Alt).toBe(56)
    expect(HOTKEY_CODES.Space).toBe(57)
    expect(HOTKEY_CODES.F8).toBe(66)
  })

  it('defaults to a MODIFIED chord, because this hook is global', () => {
    // A bare function key on a system-wide hook eats other applications'
    // shortcuts while the user types in them.
    expect(DEFAULT_CHORD.ctrl || DEFAULT_CHORD.shift || DEFAULT_CHORD.alt || DEFAULT_CHORD.meta).toBe(true)
    expect(formatChord(DEFAULT_CHORD)).toBe('Ctrl+Shift+Space')
  })
})

describe('parseChord / formatChord', () => {
  it('round-trips the canonical form', () => {
    for (const s of ['Ctrl+Shift+Space', 'Ctrl+Space', 'Alt+Tab', 'Shift+Alt+F8', 'Escape']) {
      const c = parseChord(s)
      expect(c, s).not.toBeNull()
      expect(formatChord(c!)).toBe(s)
    }
  })

  it('normalizes case, spacing and modifier order', () => {
    expect(formatChord(parseChord('ctrl + shift + space')!)).toBe('Ctrl+Shift+Space')
    expect(formatChord(parseChord('SHIFT+CTRL+SPACE')!)).toBe('Ctrl+Shift+Space')
    expect(formatChord(parseChord('control+space')!)).toBe('Ctrl+Space')
  })

  it('accepts the platform aliases for meta', () => {
    for (const s of ['Win+Space', 'Super+Space', 'Cmd+Space', 'Meta+Space']) {
      expect(formatChord(parseChord(s)!)).toBe('Meta+Space')
    }
  })

  it('⚠ REFUSES garbage rather than coercing it to a default', () => {
    // Silently falling back to DEFAULT_CHORD on a typo would bind a global
    // hotkey the user did not ask for, and never tell them why theirs is dead.
    for (const s of ['', '   ', '+', '++', 'Ctrl+', 'Ctrl', 'Ctrl+Shift', 'Banana', 'Ctrl+Banana', 'Ctrl+Space+Tab']) {
      expect(parseChord(s), s).toBeNull()
    }
  })

  it('refuses a repeated modifier and a non-string', () => {
    expect(parseChord('Ctrl+Ctrl+Space')).toBeNull()
    expect(parseChord(undefined as unknown as string)).toBeNull()
    expect(parseChord(42 as unknown as string)).toBeNull()
  })

  it('a modifier-only chord is not a chord', () => {
    // There is no key to complete it, and binding "Ctrl" globally is absurd.
    expect(parseChord('Ctrl+Shift')).toBeNull()
    expect(parseChord('Alt')).toBeNull()
  })
})

describe('chordMatches', () => {
  it('requires the key AND the exact modifier set', () => {
    expect(chordMatches(ev('down'), DEFAULT_CHORD)).toBe(true)
    expect(chordMatches(ev('down', { ctrl: false }), DEFAULT_CHORD)).toBe(false)
    expect(chordMatches(ev('down', { shift: false }), DEFAULT_CHORD)).toBe(false)
    // A SUPERSET is not a match either — Ctrl+Shift+Alt+Space is a different
    // binding, and treating it as this one would fire during other shortcuts.
    expect(chordMatches(ev('down', { alt: true }), DEFAULT_CHORD)).toBe(false)
    expect(chordMatches(ev('down', { keycode: HOTKEY_CODES.Tab }), DEFAULT_CHORD)).toBe(false)
  })
})

describe('reduce — HOLD mode', () => {
  it('down starts and up stops', () => {
    expect(run([ev('down'), ev('up')], 'hold').actions).toEqual(['start', 'stop'])
  })

  it('⚠ SURVIVES KEY REPEAT — one capture, not one per repeat', () => {
    // Windows emits `down` continuously while a key is held; a 5 s hold produces
    // dozens. This is the case the spec calls "most likely to be missed and
    // guaranteed to occur".
    const held = [ev('down'), ...Array.from({ length: 40 }, () => ev('down')), ev('up')]
    const { actions, state } = run(held, 'hold')
    expect(actions).toEqual(['start', 'stop'])
    expect(state).toEqual(IDLE)
  })

  it('ends the capture even when the modifiers are released first', () => {
    // ⚠ THE REAL-WORLD RELEASE. Letting go of Ctrl+Shift+Space almost never
    // releases all three on the same tick — Shift usually goes first, so the
    // Space `up` arrives with shift:false and no longer matches the chord.
    // Matching the full chord on release would strand the capture open.
    const { actions, state } = run([ev('down'), ev('up', { shift: false, ctrl: false })], 'hold')
    expect(actions).toEqual(['start', 'stop'])
    expect(state.listening).toBe(false)
  })

  it('ignores an unrelated key entirely', () => {
    const other = ev('down', { keycode: HOTKEY_CODES.Tab })
    expect(run([other, ev('up', { keycode: HOTKEY_CODES.Tab })], 'hold').actions).toEqual([])
  })

  it('a stray up with nothing listening is inert', () => {
    expect(run([ev('up')], 'hold').actions).toEqual([])
  })

  it('two full press/release cycles are two captures', () => {
    expect(run([ev('down'), ev('up'), ev('down'), ev('up')], 'hold').actions).toEqual([
      'start',
      'stop',
      'start',
      'stop'
    ])
  })
})

describe('reduce — TOGGLE mode', () => {
  it('press starts, next press stops, and the intervening up is inert', () => {
    expect(run([ev('down'), ev('up'), ev('down'), ev('up')], 'toggle').actions).toEqual(['start', 'stop'])
  })

  it('⚠ A HELD KEY DOES NOT DOUBLE-FIRE', () => {
    // In toggle mode key repeat is worse than in hold: without the guard it
    // would flip listening on and off dozens of times a second.
    const held = [ev('down'), ...Array.from({ length: 40 }, () => ev('down')), ev('up')]
    const { actions, state } = run(held, 'toggle')
    expect(actions).toEqual(['start'])
    expect(state.listening).toBe(true)
  })

  it('stays listening across the release', () => {
    const { state } = run([ev('down'), ev('up')], 'toggle')
    expect(state.listening).toBe(true)
    expect(state.keyDown).toBe(false)
  })

  it('three presses are start, stop, start', () => {
    const seq = [ev('down'), ev('up'), ev('down'), ev('up'), ev('down'), ev('up')]
    expect(run(seq, 'toggle').actions).toEqual(['start', 'stop', 'start'])
  })
})

describe('reduce — never opens a second capture (VoicePlan §7.2)', () => {
  it('hold: a second chord press while listening does not start again', () => {
    // Reachable when the first `up` was swallowed — a focus change or a
    // suspend/resume can lose it.
    const listening: ActivationState = { listening: true, keyDown: false }
    const r = reduce(listening, ev('down'), 'hold')
    expect(r.action).toBe('none')
    expect(r.state.listening).toBe(true)
  })

  it('emits `start` only from a non-listening state, in either mode', () => {
    const listening: ActivationState = { listening: true, keyDown: false }
    expect(reduce(listening, ev('down'), 'hold').action).not.toBe('start')
    expect(reduce(listening, ev('down'), 'toggle').action).toBe('stop')
  })

  it('never mutates the state it was given', () => {
    const before: ActivationState = { listening: false, keyDown: false }
    const copy = { ...before }
    reduce(before, ev('down'), 'hold')
    expect(before).toEqual(copy)
  })
})

describe('reduce — with a custom chord', () => {
  const f8 = parseChord('F8')!

  it('honours a modifier-free chord', () => {
    const down: HotkeyEvent = { kind: 'down', keycode: HOTKEY_CODES.F8, ctrl: false, shift: false, alt: false, meta: false }
    const up: HotkeyEvent = { ...down, kind: 'up' }
    expect(run([down, up], 'hold', f8).actions).toEqual(['start', 'stop'])
  })

  it('does not fire the default chord when a custom one is bound', () => {
    expect(run([ev('down'), ev('up')], 'hold', f8).actions).toEqual([])
  })
})

describe('nextTarget', () => {
  const three = ['a', 'b', 'c']

  it('cycles in the given order and wraps', () => {
    expect(nextTarget(three, 'a')).toBe('b')
    expect(nextTarget(three, 'b')).toBe('c')
    expect(nextTarget(three, 'c')).toBe('a')
  })

  it('⚠ PRESERVES THE CALLER’S ORDER — it must not sort or dedupe', () => {
    // The list is the pane order the user sees. A ring jumping around a grid in
    // an order that is not the visible one is worse than no cycling at all.
    const odd = ['zeta', 'alpha', 'mid']
    expect(nextTarget(odd, 'zeta')).toBe('alpha')
    expect(nextTarget(odd, 'alpha')).toBe('mid')
    expect(nextTarget(odd, 'mid')).toBe('zeta')
  })

  it('is a no-op with one pane, not a refusal', () => {
    expect(nextTarget(['only'], 'only')).toBe('only')
  })

  it('handles an empty list and a null current', () => {
    expect(nextTarget([], null)).toBeNull()
    expect(nextTarget([], 'a')).toBeNull()
    expect(nextTarget(three, null)).toBe('a')
  })

  it('restarts the cycle when the current target no longer exists (F4)', () => {
    // The pane can legitimately be deleted between one Tab and the next; the
    // cycle must not strand.
    expect(nextTarget(three, 'deleted-id')).toBe('a')
  })

  it('a full cycle visits every target exactly once', () => {
    const seen: string[] = []
    let cur: string | null = 'a'
    for (let i = 0; i < three.length; i++) {
      seen.push(cur!)
      cur = nextTarget(three, cur)
    }
    expect(seen.sort()).toEqual(['a', 'b', 'c'])
  })
})
