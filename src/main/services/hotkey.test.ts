import { describe, it, expect } from 'vitest'
import { createHotkeyService, type UiohookKeyboardEventLike, type UiohookModule } from './hotkey'
import { DEFAULT_CHORD, HOTKEY_CODES, formatChord, parseChord } from './hotkeyCore'
import { DEFAULT_VOICE_SETTINGS } from '../../shared/ipc'

/** A fake uIOhook that records lifecycle and replays events on demand. */
function fakeHook() {
  const listeners = new Map<string, Array<(e: UiohookKeyboardEventLike) => void>>()
  const calls: string[] = []
  const uIOhook = {
    start: () => void calls.push('start'),
    stop: () => void calls.push('stop'),
    on: (event: 'keydown' | 'keyup', cb: (e: UiohookKeyboardEventLike) => void) => {
      const arr = listeners.get(event) ?? []
      arr.push(cb)
      listeners.set(event, arr)
      return undefined
    },
    removeAllListeners: () => {
      calls.push('removeAllListeners')
      listeners.clear()
      return undefined
    }
  }
  const emit = (event: 'keydown' | 'keyup', e: Partial<UiohookKeyboardEventLike> = {}): void => {
    const full: UiohookKeyboardEventLike = {
      keycode: HOTKEY_CODES.Space,
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      metaKey: false,
      ...e
    }
    for (const cb of listeners.get(event) ?? []) cb(full)
  }
  return { uIOhook, calls, emit, listenerCount: () => [...listeners.values()].flat().length }
}

/** The live key table, matching hotkeyCore's copy. */
const LIVE_KEYS: Record<string, number> = { ...HOTKEY_CODES }

function harness(over: { load?: () => UiohookModule; mode?: 'hold' | 'toggle' } = {}) {
  const hook = fakeHook()
  const activations: string[] = []
  const cycles: number[] = []
  const service = createHotkeyService({
    load: over.load ?? (() => ({ uIOhook: hook.uIOhook, UiohookKey: LIVE_KEYS })),
    onActivate: (a) => void activations.push(a),
    onCycleTarget: () => void cycles.push(1),
    mode: over.mode ?? 'hold'
  })
  return { hook, activations, cycles, service }
}

describe('hotkey — loading is an OUTCOME, never a throw', () => {
  it('reports ok when the module loads', () => {
    const h = harness()
    expect(h.service.start()).toEqual({ ok: true })
    expect(h.service.available()).toBe(true)
    expect(h.hook.calls).toContain('start')
  })

  it('⚠ RETURNS A REFUSAL WHEN THE NATIVE MODULE CANNOT LOAD — it does not throw', () => {
    // VoicePlan §10 lists this as a real failure mode. Throwing here would turn
    // a native-module problem into a dead app, when a fully working alternative
    // (click-to-talk) is sitting right there.
    const h = harness({
      load: () => {
        throw Object.assign(new Error("The specified module could not be found.\\uiohook-napi.node"), {
          name: 'Error'
        })
      }
    })
    let result: ReturnType<typeof h.service.start>
    expect(() => (result = h.service.start())).not.toThrow()
    expect(result!.ok).toBe(false)
    expect(h.service.available()).toBe(false)
  })

  it('does not throw when the hook itself fails to start, and cleans up its listeners', () => {
    const hook = fakeHook()
    hook.uIOhook.start = () => {
      throw new Error('EPERM: could not install a low-level keyboard hook')
    }
    const service = createHotkeyService({
      load: () => ({ uIOhook: hook.uIOhook, UiohookKey: LIVE_KEYS }),
      onActivate: () => {},
      onCycleTarget: () => {}
    })
    const r = service.start()
    expect(r.ok).toBe(false)
    expect(service.available()).toBe(false)
    // No listeners left attached to a hook that never ran.
    expect(hook.calls).toContain('removeAllListeners')
  })

  it('⚠ REFUSES ON KEY-TABLE DRIFT rather than binding the wrong key', () => {
    // hotkeyCore carries a COPY of uiohook's keycodes so the pure module never
    // loads a native binding. Drift would not crash — it would bind the wrong
    // key, and the symptom is "the hotkey silently does nothing", which reads as
    // a broken hook rather than a stale constant.
    const hook = fakeHook()
    const service = createHotkeyService({
      load: () => ({ uIOhook: hook.uIOhook, UiohookKey: { ...LIVE_KEYS, Space: 999 } }),
      onActivate: () => {},
      onCycleTarget: () => {}
    })
    const r = service.start()
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toMatch(/drift.*Space/i)
    // And it never started the hook.
    expect(hook.calls).not.toContain('start')
  })

  it('refuses when a key is missing from the live table entirely', () => {
    const hook = fakeHook()
    const partial: Record<string, number> = { ...LIVE_KEYS }
    delete partial.Tab
    const service = createHotkeyService({
      load: () => ({ uIOhook: hook.uIOhook, UiohookKey: partial }),
      onActivate: () => {},
      onCycleTarget: () => {}
    })
    expect(service.start().ok).toBe(false)
  })

  it('a second start is idempotent, not a second hook', () => {
    const h = harness()
    h.service.start()
    h.service.start()
    expect(h.hook.calls.filter((c) => c === 'start')).toHaveLength(1)
  })
})

describe('hotkey — the hook must not outlive the process', () => {
  it('stop() stops the hook and drops its listeners', () => {
    const h = harness()
    h.service.start()
    h.service.stop()
    expect(h.hook.calls).toContain('stop')
    expect(h.hook.calls).toContain('removeAllListeners')
    expect(h.service.available()).toBe(false)
    expect(h.hook.listenerCount()).toBe(0)
  })

  it('stop() is safe before start and safe twice', () => {
    const h = harness()
    expect(() => h.service.stop()).not.toThrow()
    h.service.start()
    h.service.stop()
    expect(() => h.service.stop()).not.toThrow()
    expect(h.hook.calls.filter((c) => c === 'stop')).toHaveLength(1)
  })

  it('a throwing stop() still releases the service', () => {
    // Teardown must not be blocked by the thing it is tearing down.
    const hook = fakeHook()
    hook.uIOhook.stop = () => {
      throw new Error('hook already gone')
    }
    const service = createHotkeyService({
      load: () => ({ uIOhook: hook.uIOhook, UiohookKey: LIVE_KEYS }),
      onActivate: () => {},
      onCycleTarget: () => {}
    })
    service.start()
    expect(() => service.stop()).not.toThrow()
    expect(service.available()).toBe(false)
  })

  it('events after stop() are inert', () => {
    const h = harness()
    h.service.start()
    h.service.stop()
    h.hook.emit('keydown')
    expect(h.activations).toEqual([])
  })
})

describe('hotkey — events reach the pure reducer with the right shape', () => {
  it('a press/release drives start then stop', () => {
    const h = harness()
    h.service.start()
    h.hook.emit('keydown')
    h.hook.emit('keyup')
    expect(h.activations).toEqual(['start', 'stop'])
  })

  it('⚠ KEY REPEAT PRODUCES ONE CAPTURE, through the real event path', () => {
    const h = harness()
    h.service.start()
    for (let i = 0; i < 30; i++) h.hook.emit('keydown')
    h.hook.emit('keyup')
    expect(h.activations).toEqual(['start', 'stop'])
  })

  it('translates uiohook modifier names correctly', () => {
    // uiohook says ctrlKey/shiftKey/altKey/metaKey; the reducer wants
    // ctrl/shift/alt/meta. A mistranslation here means the chord never matches
    // and the hotkey silently does nothing.
    const h = harness()
    h.service.start()
    h.hook.emit('keydown', { ctrlKey: false })
    expect(h.activations).toEqual([])
    h.hook.emit('keydown', { shiftKey: false })
    expect(h.activations).toEqual([])
    h.hook.emit('keydown')
    expect(h.activations).toEqual(['start'])
  })

  it('honours toggle mode', () => {
    const h = harness({ mode: 'toggle' })
    h.service.start()
    h.hook.emit('keydown')
    h.hook.emit('keyup')
    expect(h.activations).toEqual(['start'])
    h.hook.emit('keydown')
    expect(h.activations).toEqual(['start', 'stop'])
  })

  it('a handler that throws does not propagate into the hook callback', () => {
    // This runs on a global low-level keyboard callback — an exception here
    // happens on a keystroke the user made in some OTHER application.
    const hook = fakeHook()
    const service = createHotkeyService({
      load: () => ({ uIOhook: hook.uIOhook, UiohookKey: LIVE_KEYS }),
      onActivate: () => {
        throw new Error('handler exploded')
      },
      onCycleTarget: () => {}
    })
    service.start()
    expect(() => hook.emit('keydown')).not.toThrow()
  })
})

describe('hotkey — Tab cycles the target, and only during a capture', () => {
  const tab = { keycode: HOTKEY_CODES.Tab, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false }

  it('⚠ TAB IS INERT WHEN NOTHING IS BEING DICTATED', () => {
    // Outside a capture, Tab is an ordinary Tab and must stay entirely
    // uninteresting to this feature.
    const h = harness()
    h.service.start()
    h.hook.emit('keydown', tab)
    expect(h.cycles).toHaveLength(0)
    expect(h.activations).toEqual([])
  })

  it('cycles while listening, and does not disturb the capture', () => {
    const h = harness()
    h.service.start()
    h.hook.emit('keydown') // start listening
    h.hook.emit('keydown', tab)
    h.hook.emit('keydown', tab)
    expect(h.cycles).toHaveLength(2)
    // The capture is untouched: still one start, and the release still stops it.
    h.hook.emit('keyup')
    expect(h.activations).toEqual(['start', 'stop'])
  })

  it('a throwing cycle handler does not propagate', () => {
    const hook = fakeHook()
    const service = createHotkeyService({
      load: () => ({ uIOhook: hook.uIOhook, UiohookKey: LIVE_KEYS }),
      onActivate: () => {},
      onCycleTarget: () => {
        throw new Error('cycle exploded')
      }
    })
    service.start()
    hook.emit('keydown')
    expect(() => hook.emit('keydown', tab)).not.toThrow()
  })

  it('stops cycling once the capture ends', () => {
    const h = harness()
    h.service.start()
    h.hook.emit('keydown')
    h.hook.emit('keyup')
    h.hook.emit('keydown', tab)
    expect(h.cycles).toHaveLength(0)
  })
})

describe('hotkey — a custom chord', () => {
  it('binds the configured chord instead of the default', () => {
    const hook = fakeHook()
    const activations: string[] = []
    const service = createHotkeyService({
      load: () => ({ uIOhook: hook.uIOhook, UiohookKey: LIVE_KEYS }),
      onActivate: (a) => void activations.push(a),
      onCycleTarget: () => {},
      chord: parseChord('Alt+F8')!
    })
    service.start()
    // The default chord no longer fires.
    hook.emit('keydown')
    expect(activations).toEqual([])
    // The configured one does.
    const f8 = { keycode: HOTKEY_CODES.F8, ctrlKey: false, shiftKey: false, altKey: true, metaKey: false }
    hook.emit('keydown', f8)
    hook.emit('keyup', f8)
    expect(activations).toEqual(['start', 'stop'])
  })
})

describe('hotkey — configure() from settings (Task 5-4)', () => {
  const f8 = { keycode: HOTKEY_CODES.F8, ctrlKey: false, shiftKey: false, altKey: true, metaKey: false }

  it('the wire default and the reducer default are the SAME chord', () => {
    // DEFAULT_VOICE_SETTINGS lives in shared/ipc.ts so main and the renderer
    // agree; DEFAULT_CHORD lives in hotkeyCore. Neither may drift from the other.
    expect(DEFAULT_VOICE_SETTINGS.hotkey).toBe(formatChord(DEFAULT_CHORD))
    expect(parseChord(DEFAULT_VOICE_SETTINGS.hotkey!)).toEqual(DEFAULT_CHORD)
  })

  it('rebinds a running hook to a new chord without restarting it', () => {
    const h = harness()
    expect(h.service.start()).toEqual({ ok: true })
    const startsBefore = h.hook.calls.filter((c) => c === 'start').length
    expect(h.service.configure({ chord: parseChord('Alt+F8')!, mode: 'hold' })).toEqual({ ok: true })
    expect(h.hook.calls.filter((c) => c === 'start').length).toBe(startsBefore)
    // The old chord is inert; the new one fires.
    h.hook.emit('keydown')
    h.hook.emit('keyup')
    expect(h.activations).toEqual([])
    h.hook.emit('keydown', f8)
    h.hook.emit('keyup', f8)
    expect(h.activations).toEqual(['start', 'stop'])
    expect(h.service.current()).toEqual({ chord: parseChord('Alt+F8'), mode: 'hold' })
  })

  it('switches activation mode live', () => {
    const h = harness()
    h.service.start()
    h.service.configure({ chord: DEFAULT_CHORD, mode: 'toggle' })
    h.hook.emit('keydown')
    h.hook.emit('keyup')
    expect(h.activations).toEqual(['start']) // toggle: release is inert
    h.hook.emit('keydown')
    expect(h.activations).toEqual(['start', 'stop'])
  })

  it('⚠ chord: null STOPS THE HOOK — off means not running, not ignoring', () => {
    const h = harness()
    h.service.start()
    expect(h.service.available()).toBe(true)
    expect(h.service.configure({ chord: null, mode: 'hold' })).toEqual({ ok: true })
    expect(h.service.available()).toBe(false)
    expect(h.hook.calls).toContain('stop')
    expect(h.hook.calls).toContain('removeAllListeners')
    // And start() refuses while off, with a reason that says it was a choice.
    expect(h.service.start()).toEqual({ ok: false, reason: 'push-to-talk is turned off in settings' })
    expect(h.service.current()).toEqual({ chord: null, mode: 'hold' })
  })

  it('a chord after null STARTS the hook again', () => {
    const h = harness()
    h.service.configure({ chord: null, mode: 'hold' })
    expect(h.service.available()).toBe(false)
    expect(h.service.configure({ chord: DEFAULT_CHORD, mode: 'hold' })).toEqual({ ok: true })
    expect(h.service.available()).toBe(true)
    h.hook.emit('keydown')
    h.hook.emit('keyup')
    expect(h.activations).toEqual(['start', 'stop'])
  })

  it('a reconfigure resets the reducer so a half-pressed old chord cannot complete as the new one', () => {
    const h = harness()
    h.service.start()
    h.hook.emit('keydown') // old chord down: listening
    expect(h.activations).toEqual(['start'])
    h.service.configure({ chord: parseChord('Alt+F8')!, mode: 'hold' })
    // The old chord's release is now meaningless to the reducer.
    h.hook.emit('keyup')
    expect(h.activations).toEqual(['start'])
  })

  it('configure on an unloadable module reports the refusal, not a throw', () => {
    const h = harness({
      load: () => {
        throw new Error('no native module')
      }
    })
    const r = h.service.configure({ chord: DEFAULT_CHORD, mode: 'hold' })
    expect(r.ok).toBe(false)
    expect(h.service.available()).toBe(false)
  })
})
