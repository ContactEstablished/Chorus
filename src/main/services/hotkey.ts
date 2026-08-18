import { logger } from './logger'
import {
  DEFAULT_CHORD,
  HOTKEY_CODES,
  IDLE,
  reduce,
  type Activation,
  type ActivationState,
  type Chord,
  type HotkeyEvent
} from './hotkeyCore'

/**
 * The impure half of voice activation (Task 5-3) — a thin wrapper around
 * `uiohook-napi`'s global keyboard hook.
 *
 * ⚠ DELIBERATELY THIN. `uiohook` needs a real OS input stack and cannot be
 * unit-tested, so every decision this makes is delegated to `hotkeyCore`'s pure
 * reducer. What is left here is loading, subscribing, translating uiohook's
 * event shape, and stopping — small enough to review by eye, which is the only
 * review this half can get.
 *
 * ⚠ LOADING IS AN OUTCOME, NOT AN ASSUMPTION. VoicePlan §10 lists "the native
 * hotkey hook fails to load" as a real failure mode. If it threw into boot, a
 * native-module problem would become a dead app — and the app has a fully
 * working alternative sitting right there. `start()` RETURNS the outcome and the
 * UI says push-to-talk is unavailable.
 *
 * ⚠ AND CLICK-TO-TALK IS NOT DOWNSTREAM OF THIS FILE. It is a peer route into
 * the same capture, not a fallback bolted on: VoicePlan §7.2 makes it the
 * ACCESSIBILITY path, because a sustained hold is exactly the interaction a
 * motor-impaired user cannot perform. A build where push-to-talk is the only
 * route is broken even when the hook loads.
 */

/** The parts of `uIOhook` this file uses. Structural, so a test can supply one. */
export interface UiohookLike {
  start(): void
  stop(): void
  on(event: 'keydown' | 'keyup', listener: (e: UiohookKeyboardEventLike) => void): unknown
  removeAllListeners(event?: string): unknown
}

export interface UiohookKeyboardEventLike {
  readonly keycode: number
  readonly ctrlKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
  readonly metaKey: boolean
}

export interface UiohookModule {
  readonly uIOhook: UiohookLike
  /** The live key table, cross-checked against `HOTKEY_CODES`. */
  readonly UiohookKey: Readonly<Record<string, number>>
}

export type HotkeyStartResult = { readonly ok: true } | { readonly ok: false; readonly reason: string }

export interface HotkeyDeps {
  /**
   * Load `uiohook-napi`.
   *
   * ⚠ INJECTED, AND IT MAY THROW — that is the point. `index.ts` supplies a
   * `require` inside this seam so a missing, corrupt or ABI-mismatched `.node`
   * becomes a typed refusal here rather than an exception during boot. It is
   * also what lets `hotkey.test.ts` drive the load-failure path with no native
   * module involved.
   */
  readonly load: () => UiohookModule
  /** Start or stop a capture. Called from the pure reducer's decisions only. */
  readonly onActivate: (action: 'start' | 'stop') => void
  /** Tab was pressed during a live capture — cycle the dictation target. */
  readonly onCycleTarget: () => void
  readonly chord?: Chord
  readonly mode?: Activation
}

export interface HotkeyService {
  start(): HotkeyStartResult
  stop(): void
  /** Whether the global hook is currently running. */
  available(): boolean
  /**
   * Task 5-4: apply the user's chord and activation mode, from settings.
   *
   * ⚠ `chord: null` MEANS OFF, AND OFF MEANS THE HOOK IS NOT INSTALLED. Not
   * "installed and ignoring keys": a system-wide low-level keyboard hook that
   * is running observes every keystroke in every application, and the only
   * honest way to be off is to not be running. So a null chord STOPS a running
   * hook, and a chord after a null STARTS one. Click-to-talk is unaffected
   * either way — it never passes through this file.
   *
   * A live capture is not touched by a reconfigure; the reducer's state is
   * reset so a half-pressed old chord cannot complete as the new one.
   */
  configure(next: { readonly chord: Chord | null; readonly mode: Activation }): HotkeyStartResult
  /** What is currently applied, for the status channel. */
  current(): { readonly chord: Chord | null; readonly mode: Activation }
}

export function createHotkeyService(deps: HotkeyDeps): HotkeyService {
  /** `let`, since Task 5-4 — `configure` replaces both from settings. A null
   *  chord is the OFF state and `start()` refuses while it is null. */
  let chord: Chord | null = deps.chord ?? DEFAULT_CHORD
  let mode: Activation = deps.mode ?? 'hold'

  let hook: UiohookLike | null = null
  let state: ActivationState = IDLE

  /**
   * ⚠ THE KEY TABLE IS CROSS-CHECKED BEFORE THE HOOK IS EVER STARTED.
   * `hotkeyCore` carries a COPY of uiohook's keycodes so that the pure module
   * never loads a native binding. A copy that drifts would not crash — it would
   * bind the wrong key, and the symptom is "the hotkey silently does nothing",
   * which reads as a broken hook rather than a stale constant. Checking it here
   * turns that into a named refusal at startup.
   */
  function verifyKeyTable(live: Readonly<Record<string, number>>): string | null {
    for (const [name, code] of Object.entries(HOTKEY_CODES)) {
      const actual = live[name]
      if (actual !== code) {
        return `key table drift: ${name} is ${String(actual)} in uiohook-napi, ${code} in hotkeyCore`
      }
    }
    return null
  }

  function onKey(kind: 'down' | 'up', e: UiohookKeyboardEventLike): void {
    // ⚠ TAB IS HANDLED BEFORE THE REDUCER AND ONLY WHILE LISTENING. The mock's
    // own words are "hold tab while dictating to cycle targets", so Tab is
    // meaningful exclusively during a capture — outside one it is an ordinary
    // Tab and must stay entirely uninteresting to this feature.
    if (kind === 'down' && e.keycode === HOTKEY_CODES.Tab && state.listening) {
      try {
        deps.onCycleTarget()
      } catch (err) {
        logger.error({ err }, '[voice] target cycle handler threw')
      }
      return
    }

    const ev: HotkeyEvent = {
      kind,
      keycode: e.keycode,
      ctrl: e.ctrlKey,
      shift: e.shiftKey,
      alt: e.altKey,
      meta: e.metaKey
    }
    // A null chord means the hook should not be running at all; if an event
    // arrives anyway (a stop racing a keystroke) it is inert.
    if (chord === null) return
    const result = reduce(state, ev, mode, chord)
    state = result.state
    if (result.action === 'none') return
    try {
      deps.onActivate(result.action)
    } catch (err) {
      // ⚠ NEVER THROW BACK INTO THE HOOK CALLBACK. This runs on a global
      // low-level keyboard callback; an exception here happens on a keystroke
      // the user made in some other application.
      logger.error({ err }, '[voice] hotkey activation handler threw')
    }
  }

  const service: HotkeyService = {
    start(): HotkeyStartResult {
      if (hook) return { ok: true }
      if (chord === null) {
        // Off by setting. Not a failure and not a hook.
        return { ok: false, reason: 'push-to-talk is turned off in settings' }
      }
      let mod: UiohookModule
      try {
        mod = deps.load()
      } catch (err) {
        // ⚠ A REFUSAL, NOT A THROW. The reason is the error's NAME and message,
        // both of which come from the module loader and carry no user content.
        const reason = err instanceof Error ? `${err.name}: ${err.message}` : 'unknown load failure'
        logger.error({ reason }, '[voice] global hotkey unavailable; push-to-talk disabled')
        return { ok: false, reason }
      }

      const drift = verifyKeyTable(mod.UiohookKey)
      if (drift) {
        logger.error({ reason: drift }, '[voice] global hotkey unavailable; push-to-talk disabled')
        return { ok: false, reason: drift }
      }

      try {
        mod.uIOhook.on('keydown', (e) => onKey('down', e))
        mod.uIOhook.on('keyup', (e) => onKey('up', e))
        mod.uIOhook.start()
      } catch (err) {
        const reason = err instanceof Error ? `${err.name}: ${err.message}` : 'unknown start failure'
        logger.error({ reason }, '[voice] global hotkey failed to start; push-to-talk disabled')
        try {
          mod.uIOhook.removeAllListeners()
        } catch {
          // Nothing more to do; the hook never started.
        }
        return { ok: false, reason }
      }

      hook = mod.uIOhook
      state = IDLE
      logger.info({ chord: chord.key, mode }, '[voice] global hotkey installed')
      return { ok: true }
    },

    configure(next): HotkeyStartResult {
      chord = next.chord
      mode = next.mode
      // A half-pressed OLD chord must not complete as the NEW one, and a held
      // key from before the change must not be read as an activation after it.
      state = IDLE
      if (chord === null) {
        // ⚠ OFF IS "NOT RUNNING". See the interface note.
        service.stop()
        logger.info('[voice] global hotkey turned off in settings')
        return { ok: true }
      }
      if (hook) {
        logger.info({ chord: chord.key, mode }, '[voice] global hotkey reconfigured')
        return { ok: true }
      }
      return service.start()
    },

    current: () => ({ chord, mode }),

    stop(): void {
      /**
       * ⚠ A GLOBAL LOW-LEVEL KEYBOARD HOOK MUST NOT OUTLIVE THE PROCESS, AND
       * THIS IS WORSE THAN LEAKING A FILE HANDLE: it observes every keystroke
       * the user makes in every application. Called from 'before-quit' and from
       * every failure path above, and it is idempotent so a second call during
       * teardown is free.
       */
      if (!hook) return
      const h = hook
      hook = null
      state = IDLE
      try {
        h.stop()
      } catch (err) {
        logger.error({ err }, '[voice] global hotkey stop failed')
      }
      try {
        h.removeAllListeners()
      } catch {
        // The hook is already down; listeners are moot.
      }
      logger.info('[voice] global hotkey removed')
    },

    available: (): boolean => hook !== null
  }
  return service
}
