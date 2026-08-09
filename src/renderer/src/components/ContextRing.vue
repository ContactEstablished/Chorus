<script setup lang="ts">
import { computed } from 'vue'
import type { SessionContextUsage } from '../../../shared/ipc'

/**
 * The context ring (v16): how full an agent's context window is, as a small
 * SVG donut with the percentage beside it.
 *
 * ─── IT IS ONLY EVER MOUNTED WHERE THERE IS A REAL READING ────────────────
 * ⚠ THERE IS NO "UNKNOWN" STATE AND THERE MUST NOT BE ONE. Callers render this
 * behind `v-if="contextFor(id)"`; an agent whose CLI exposes no context (today:
 * opencode) shows NOTHING. A greyed 0% ring would be a claim — "this agent has
 * used none of its window" — that Chorus cannot stand behind, and it is exactly
 * the shape D76/D83 forbid: the answer to "the design wants a number we do not
 * have" is omit it or source it, never draw a placeholder. Same rule the amber
 * light already follows.
 *
 * ─── COLOUR IS NOT THE ENCODING ───────────────────────────────────────────
 * ⚠ THE SWEPT ARC IS THE SIGNAL; the three colour bands only reinforce it, which
 * is `StateMarker`'s contract restated for a different primitive. A ring at 91%
 * is legible as nearly-full in grayscale, because the arc has swept nearly all
 * the way round — the red says "and that is a problem" rather than carrying the
 * quantity on its own. The numeral beside it is the third, fully redundant
 * channel and is why this reads at 11px.
 */
const props = defineProps<{
  usage: SessionContextUsage
  /** The stroke/track diameter in px. 14 on a filmstrip card, 15 in the pane
   *  header's meta row — small enough not to compete with the state marker. */
  size?: number
}>()

const size = computed(() => props.size ?? 14)

/* Geometry. The circle is stroked, not filled, so the "donut" needs no mask and
 * no second shape: `stroke-dasharray` on a circle whose circumference we know is
 * the whole mechanism. r is set so the stroke sits fully inside the viewBox —
 * (size/2) minus half the stroke — or the arc clips on every edge. */
const STROKE = 2
const radius = computed(() => (size.value - STROKE) / 2)
const circumference = computed(() => 2 * Math.PI * radius.value)

/** The swept length. Clamped defensively even though main bounds this: the ring
 *  is drawn from an IPC payload and a dash offset outside [0, C] renders as a
 *  silently wrong arc rather than as an error. */
const dash = computed(() => {
  const pct = Math.min(100, Math.max(0, props.usage.usedPercent))
  return (pct / 100) * circumference.value
})

/**
 * The three bands.
 *
 * ⚠ THE THRESHOLDS ARE UI JUDGEMENT, NOT AGENT BEHAVIOUR, and saying so matters
 * because they look like they should mean something exact. Neither CLI publishes
 * the point at which it will compact, and inventing a "will auto-compact soon"
 * claim from a number we picked would be a fabricated fact of exactly the kind
 * D76 rules out. So these say only what they can: getting full, nearly full.
 */
const band = computed(() => {
  if (props.usage.usedPercent >= 85) return 'high'
  if (props.usage.usedPercent >= 60) return 'mid'
  return 'low'
})

/**
 * The tooltip.
 *
 * ⚠ IT NAMES TOKEN COUNTS ONLY WHEN THE SOURCE SUPPLIED THEM. Claude's
 * transcript gives exact counters and a known window, so it can read
 * "113,081 / 200,000 tokens". Codex reports a percentage and nothing else, so
 * its tooltip stops at the percentage — back-filling a token count from an
 * assumed window would turn one measured number into two invented ones.
 */
const title = computed(() => {
  const { usedPercent, usedTokens, windowTokens } = props.usage
  const head = `${usedPercent}% of context used`
  if (usedTokens === null || windowTokens === null) return head
  return `${head} — ${usedTokens.toLocaleString()} / ${windowTokens.toLocaleString()} tokens`
})
</script>

<template>
  <span class="ctx" :class="`ctx-${band}`" :title="title">
    <svg
      :width="size"
      :height="size"
      :viewBox="`0 0 ${size} ${size}`"
      fill="none"
      aria-hidden="true"
    >
      <!-- The track: the full window, always drawn, so the ring reads as a
           proportion rather than as a lone arc floating in space. -->
      <circle
        :cx="size / 2"
        :cy="size / 2"
        :r="radius"
        class="ctx-track"
        :stroke-width="STROKE"
      />
      <!-- The swept arc. Rotated -90° so 0% starts at twelve o'clock; without
           it the ring fills from three o'clock and reads as an arbitrary
           fragment at low percentages. -->
      <circle
        :cx="size / 2"
        :cy="size / 2"
        :r="radius"
        class="ctx-arc"
        :stroke-width="STROKE"
        stroke-linecap="round"
        :stroke-dasharray="`${dash} ${circumference}`"
        :transform="`rotate(-90 ${size / 2} ${size / 2})`"
      />
    </svg>
    <!-- The redundant numeric channel. `tabular-nums` so the label does not
         jitter its neighbours as the value ticks 9% -> 10% -> 11%. -->
    <span class="ctx-label">{{ usage.usedPercent }}%</span>
  </span>
</template>

<style scoped>
.ctx {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
  font-family: var(--font-mono);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

/* Dim enough to read as chrome rather than as a fourth status light. */
.ctx-track {
  stroke: var(--color-glyph-dim-high);
}

/* No transition on the arc: the value is edge-triggered per whole percent and
   arrives in irregular bursts (a hook event, a TUI redraw), so an animated
   sweep would lag the truth rather than illustrate it. */
.ctx-arc {
  stroke: currentColor;
}

.ctx-label {
  color: currentColor;
}

/* `color` on the wrapper drives BOTH the arc (via currentColor) and the label,
   so the two can never disagree about which band they are in. */
.ctx-low {
  color: var(--color-text-quiet);
}

.ctx-mid {
  color: var(--color-state-attention-text);
}

.ctx-high {
  color: var(--color-state-error-text);
}
</style>
