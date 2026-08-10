import { onBeforeUnmount, onMounted, readonly, ref, type Ref } from 'vue'

/**
 * The escalation ladder — how loud a state is allowed to be, as a function of
 * how long it has been true.
 *
 * ─── THE SOURCE, VERBATIM ─────────────────────────────────────────────────
 * `docs/design/v2/Chorus Needs Attention.html`, panel **D · ESCALATION OVER
 * TIME**, whose own subtitle is *"the wait is the only thing that grows
 * louder"*:
 *
 *   0–30s   token appears, no pulse. It may resolve itself.
 *   30s–5m  pulse begins, card border lifts, inbox count increments.
 *   5m–20m  wait timer turns amber, item sorts to top of inbox, tray badge appears.
 *   20m+    pulse STOPS. "A blinking light you've ignored for 20 minutes is
 *           noise; the copy takes over instead."
 *
 * and its closing rule: *"Escalation adds consequence… **Intensity peaks in the
 * middle, not at the end.**"*
 *
 * ⚠ THIS IS NOT A DECAY CURVE, AND READING IT AS ONE INVERTS IT. The intuitive
 * scheme — loudest when fresh, fading as it ages — is precisely what this
 * ladder rejects at BOTH ends. A brand-new stop is quiet because it may resolve
 * itself without you (an agent that stops for two seconds and continues should
 * never have flashed at all), and a twenty-minute-old stop is quiet because
 * motion you have already ignored has stopped being information. The loud band
 * is the middle: old enough to be real, new enough that you have not yet
 * decided to ignore it.
 *
 * It is also the ladder's answer to the design system's standing prohibition,
 * `"Pulse forever. Motion that never resolves is trained-out within a day."`
 * (same doc, DON'T list; quoted again at `Phase-3c-Overview.md:216`). The pulse
 * here always resolves — that is what `stale` is for.
 */
export type AttentionTier = 'calm' | 'pulse' | 'urgent' | 'stale'

/** 30s — below this a stop may still resolve itself without a human. */
const PULSE_AFTER_MS = 30_000
/** 5m — past this the wait is worth a number, not just a shape. */
const URGENT_AFTER_MS = 5 * 60_000
/** 20m — past this the motion has been ignored and becomes noise. */
const STALE_AFTER_MS = 20 * 60_000

/**
 * Which rung a state that began at `since` is on, as of `now`.
 *
 * `since === null` means "began before this app run" (see
 * `projectAttentionSchema`) and lands on `stale`: no motion, no age claimed.
 * Clock skew that puts `since` in the renderer's own future lands on `calm`,
 * which is the safe direction — a light that is briefly too quiet is a smaller
 * failure than one that pulses at nothing.
 */
export function tierFor(since: number | null, now: number): AttentionTier {
  if (since === null) return 'stale'
  const age = now - since
  if (!(age >= PULSE_AFTER_MS)) return 'calm'
  if (age < URGENT_AFTER_MS) return 'pulse'
  if (age < STALE_AFTER_MS) return 'urgent'
  return 'stale'
}

/**
 * How long a state has been true, in the register the mock writes it
 * (`waiting 4m 12s`, `waiting 6m 40s`) — seconds while seconds still matter,
 * minutes after that, hours past the hour.
 *
 * Returns '' for an unknown instant rather than a placeholder: D76's rule is
 * say what is true and stop, and "—" is exactly the placeholder it rules out.
 */
export function ageLabel(since: number | null, now: number): string {
  if (since === null) return ''
  const secs = Math.floor((now - since) / 1000)
  if (!(secs >= 0)) return ''
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) {
    const rem = secs % 60
    // The seconds are dropped past 10m: at that point they are noise on a
    // number the user reads to decide which of several items to open first.
    return mins < 10 && rem > 0 ? `${mins}m ${rem}s` : `${mins}m`
  }
  const hrs = Math.floor(mins / 60)
  return hrs < 24 ? `${hrs}h` : `${Math.floor(hrs / 24)}d`
}

/**
 * ─── ONE CLOCK FOR THE WHOLE APP ──────────────────────────────────────────
 *
 * ⚠ A MODULE-LEVEL SINGLETON WITH REFERENCE COUNTING, not a ref per component,
 * and both halves are load-bearing.
 *
 * Singleton, because the surfaces that need it are unbounded in number: every
 * filmstrip card, every rail row, and every pane header. A timer each would
 * mean N wakeups per tick, N re-render cascades, and — worse — N clocks drifting
 * against each other, so two views of the SAME session could sit on different
 * rungs of the ladder at the same moment. One ref makes that impossible by
 * construction.
 *
 * Reference-counted, because the interval must not outlive its last consumer.
 * A 5s wakeup that runs forever in a window showing no lights is a battery cost
 * for nothing; the count starts the interval on the first mount and clears it
 * on the last unmount.
 *
 * 5s granularity is chosen against the BOUNDARIES, not for smoothness: the
 * rungs are at 30s, 5m and 20m, so 5s bounds the worst-case lateness of a tier
 * change to 5s on a 30s threshold. Nothing here animates off this ref — the
 * pulse is a CSS keyframe running independently — so a faster tick would buy
 * only a more precise seconds label, at 12× the wakeups.
 */
const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | undefined
let consumers = 0

const TICK_MS = 5_000

/**
 * A shared, read-only `Date.now()` that advances every 5s while any component
 * is using it. Call from `setup()`; the interval is released automatically when
 * the calling component unmounts.
 */
export function useAttentionClock(): Readonly<Ref<number>> {
  onMounted(() => {
    consumers += 1
    if (clock === undefined) {
      // Re-read immediately: a clock that has been idle since the last consumer
      // unmounted is stale, and the first tick is 5s away.
      now.value = Date.now()
      clock = setInterval(() => {
        now.value = Date.now()
      }, TICK_MS)
    }
  })
  onBeforeUnmount(() => {
    consumers -= 1
    if (consumers <= 0) {
      consumers = 0
      clearInterval(clock)
      clock = undefined
    }
  })
  return readonly(now)
}
