/**
 * THE MARK AS A LEVEL METER — the arithmetic behind the dictation overlay's
 * reactive Chorus logo.
 *
 * Extracted as a pure module for the same reason `projectSwitcher.ts` was:
 * there are no `.vue` tests in this repo, so anything worth asserting has to
 * live outside the component.
 *
 * ⚠ BRIGHTNESS ONLY. The mark's geometry is fixed — `ChorusMark.vue`'s header
 * forbids stretching it — so a rising voice lights bars OUTWARD FROM THE LEAD
 * rather than growing them. The jade centre bar is lit first and dies last;
 * the three mirrored pairs come up in order. That keeps the symmetry that is
 * the mark while still reading as a meter.
 *
 * ⚠ AND NO BAR EVER GOES FULLY DARK. `MARK_DIM` is the floor, for the same
 * reason ChorusMark's reduced-motion block gives: a logo that can reach zero
 * opacity is a logo that can disappear, and "reduced motion means arrive, not
 * disappear" applies just as well to a quiet room.
 */

/** Seven bars, mirrored about index 3. Pinned so a change to the mark breaks a test. */
export const MARK_BAR_COUNT = 7

/** The jade lead bar — the tallest, the centre one, the one lit at any level. */
export const MARK_LEAD_INDEX = 3

/** The opacity floor. See the header: the mark must never vanish. */
export const MARK_DIM = 0.16

/**
 * Where each bar lights, as a `[start, full]` pair on the 0..1 display level.
 * Index-aligned to `ChorusMark.vue`'s `BARS`, and symmetric — the pairs are
 * literally the same numbers either side of the lead.
 */
export const BAR_RAMPS: ReadonlyArray<readonly [number, number]> = [
  [0.55, 0.92], // low  (outermost, shortest)
  [0.32, 0.68], // mid
  [0.12, 0.45], // high
  [0.0, 0.3], // lead — already climbing at a whisper
  [0.12, 0.45], // high
  [0.32, 0.68], // mid
  [0.55, 0.92] // low
]

/**
 * The envelope. ⚠ IT IS NOT DECORATION.
 *
 * `VoiceStateEvent.level` is pushed every OTHER 64 ms frame — about 7.8 times a
 * second (`voice.ts`'s `capturedFrames % 2 === 0`). Bound straight to opacity
 * that is a visible flicker, and the feature requirements
 * (`Voice-Input-Feature-Requirements.md` §15) ban rapidly flashing recording
 * animations outright. The overlay eases toward each pushed value instead.
 *
 * Asymmetric on purpose: a consonant should snap the mark on, and the fall
 * should be a decay rather than a cut, so the logo breathes with a sentence
 * instead of chattering with its syllables.
 *
 * ⚠ THE ENVELOPE SMOOTHS THE *LEVEL*; THE BARS STILL MOVE FASTER THAN IT DOES,
 * and mistaking one for the other wastes an afternoon. `BAR_RAMPS` are narrow —
 * the lead reaches full at a level of 0.30 — so smoothstep multiplies a level
 * step by up to ~4x on its way to an opacity. Measured against a real capture,
 * a level that never moves more than 0.25 per 40 ms still swings the lead bar
 * by 0.53. That is the intended pop at a phrase onset, not a flicker: what the
 * accessibility requirement actually bounds is FLASHES PER SECOND (WCAG says
 * three), and the same capture shows 0.27 direction changes per second.
 *
 * 90 ms rather than 60: both read as immediate, and the slower one leaves more
 * headroom under a requirement that exists to protect people. The release is
 * deliberately ~3x longer, so the mark settles between words rather than
 * chattering with syllables.
 */
export const ATTACK_MS = 90
export const RELEASE_MS = 260

/**
 * Speech RMS full scale. `peakWindowRms` returns roughly 0.38 at a speech peak
 * and 0.0015 for an ambient room (`whisperCore.ts`), so a raw 0..1 meter would
 * barely move. This is the same divisor the twelve-bar meter used before the
 * mark replaced it — carried over rather than re-tuned, so the redesign changes
 * how the level LOOKS and not what counts as loud.
 */
export const SPEECH_FULL_SCALE = 0.25

function clamp01(n: number): number {
  // NaN included: an unparseable level must read as silence, never as a flash.
  if (!Number.isFinite(n)) return 0
  return n < 0 ? 0 : n > 1 ? 1 : n
}

/** Hermite ease between two thresholds. Flat outside `[t0, t1]`. */
export function smoothstep(t0: number, t1: number, x: number): number {
  if (t1 <= t0) return x >= t1 ? 1 : 0
  const t = clamp01((x - t0) / (t1 - t0))
  return t * t * (3 - 2 * t)
}

/** The raw RMS main pushes, mapped onto the 0..1 the mark is driven with. */
export function displayLevelFromRms(rms: number): number {
  return clamp01(clamp01(rms) / SPEECH_FULL_SCALE)
}

/** Per-bar opacity for a display level, index-aligned to `ChorusMark.vue`'s `BARS`. */
export function barOpacities(level: number): number[] {
  const lvl = clamp01(level)
  return BAR_RAMPS.map(([t0, t1]) => MARK_DIM + (1 - MARK_DIM) * smoothstep(t0, t1, lvl))
}

/**
 * One step of the envelope, toward `target`, over `dtMs` of real time.
 *
 * ⚠ TIME-BASED, NOT FRAME-BASED. A fixed per-frame coefficient would make the
 * mark rise at a different speed on a 60 Hz and a 144 Hz display; `1 - e^(-dt/tau)`
 * does not care how often it is called.
 */
export function smoothLevel(current: number, target: number, dtMs: number): number {
  const from = clamp01(current)
  const to = clamp01(target)
  if (!Number.isFinite(dtMs) || dtMs <= 0) return from
  // A tab that was backgrounded can hand back a huge dt; clamp it so the mark
  // catches up rather than overshooting on the first frame after a stall.
  const dt = Math.min(dtMs, 250)
  const tau = to > from ? ATTACK_MS : RELEASE_MS
  const next = from + (to - from) * (1 - Math.exp(-dt / tau))
  // Settle exactly instead of approaching forever, so an idle mark stops
  // scheduling repaints for a difference nobody can see.
  return Math.abs(to - next) < 0.001 ? to : next
}
