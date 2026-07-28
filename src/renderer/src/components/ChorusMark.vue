<script setup lang="ts">
/**
 * THE CHORUS MARK — the official logo, and the only place it is drawn.
 *
 * Geometry is read from `docs/design/v2/Chorus Startup.dc.html` (the splash's
 * logo block), which Matthew confirmed on 2026-07-27 is the official mark:
 * SEVEN bars, six px wide on a 13px pitch, fully rounded (radius = half the
 * width), vertically centred, heights 28 / 44 / 62 / 76 / 62 / 44 / 28.
 *
 * ⚠ IT IS SYMMETRIC, AND THE SYMMETRY IS THE MARK. The jade bar is the CENTRE
 * one — the tallest, the only coloured one, with three descending grey bars
 * mirrored either side of it. A chorus has a lead voice with the rest ranged
 * around it, and the logo says exactly that.
 *
 * ⚠ THIS SUPERSEDES THE SIX-BAR GLYPH the Workspace / Launch / Settings /
 * Council mocks draw inline (`<svg width="20" height="14">`, bars at
 * x = 0/3.6/7.2/10.8/14.4/18, heights 4/8/12/14/8/4). That version is the same
 * mark MISSING ITS SECOND `high` BAR, which lands the jade bar off-centre and
 * breaks the mirror. D73 makes the mock the authority on COLOUR AND GEOMETRY of
 * the surfaces it draws, but it cannot be the authority on what Matthew's own
 * logo is — those four mocks are wrong about the mark and are superseded here
 * on his instruction, not silently "improved". Colours are unchanged: the four
 * fills below are the same four 3c-1 tokens the six-bar glyph used.
 *
 * Three callers, one drawing:
 *   - TitleBar.vue  — 14px, static. The window chrome's brand.
 *   - StartupSplash.vue — 76px, `animated`. The bars rise staggered and the
 *     lead bar glows, per the mock's `barIntro` / `leadGlow` keyframes.
 *   - TerminalPane.vue — a very low-opacity watermark behind the terminal.
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    /** Rendered height in px. Width follows the mark's 84:76 aspect. */
    height?: number
    /**
     * Splash only: the staggered rise + the lead bar's glow. Off everywhere
     * else — a titlebar that re-animated on every remount, or a watermark that
     * moved behind live terminal output, would both be worse than still.
     */
    animated?: boolean
    /**
     * Fill the whole mark with `currentColor` instead of its four brand
     * tones. Unused today; here because a mark placed on jade, or inside a
     * button that already owns a colour, must not fight it.
     */
    monochrome?: boolean
  }>(),
  { height: 14, animated: false, monochrome: false }
)

/** The mark's intrinsic box: 7×6px bars on a 13px pitch = 84 wide; the lead
 *  bar's own height = 76 tall. Every other number below derives from these. */
const VIEWBOX_W = 84
const VIEWBOX_H = 76

const width = computed(() => (props.height * VIEWBOX_W) / VIEWBOX_H)

/** `y` is `(76 - height) / 2` for every bar — the mock centres them all. */
const BARS = [
  { x: 0, y: 24, h: 28, tone: 'low' },
  { x: 13, y: 16, h: 44, tone: 'mid' },
  { x: 26, y: 7, h: 62, tone: 'high' },
  { x: 39, y: 0, h: 76, tone: 'lead' },
  { x: 52, y: 7, h: 62, tone: 'high' },
  { x: 65, y: 16, h: 44, tone: 'mid' },
  { x: 78, y: 24, h: 28, tone: 'low' }
] as const

const FILLS: Record<(typeof BARS)[number]['tone'], string> = {
  low: 'var(--color-logo-bar-low)',
  mid: 'var(--color-logo-bar-mid)',
  high: 'var(--color-logo-bar-high)',
  lead: 'var(--color-accent-jade)'
}
</script>

<template>
  <svg
    class="chorus-mark"
    :class="{ 'is-animated': props.animated }"
    :width="width"
    :height="props.height"
    :viewBox="`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`"
    fill="none"
    aria-hidden="true"
    focusable="false"
  >
    <rect
      v-for="bar in BARS"
      :key="bar.x"
      :x="bar.x"
      :y="bar.y"
      width="6"
      :height="bar.h"
      rx="3"
      :fill="props.monochrome ? 'currentColor' : FILLS[bar.tone]"
    />
  </svg>
</template>

<style scoped>
.chorus-mark {
  /* Bars are laid out on a fixed grid, so the mark must never be stretched to
     fit a box of a different aspect. */
  flex: none;
}

/* ── The splash's entrance, ported from the mock's <style> head ──────────────
   ⚠ `transform-box: fill-box` IS REQUIRED and is the whole reason this works
   on `<rect>` rather than on the mock's `<span>`s. Without it an SVG element's
   `transform-origin: center` resolves against the SVG VIEWPORT, not the rect,
   so every bar would scale from the middle of the mark and slide sideways as
   it rose. The mock's divs get fill-box behaviour for free; rects do not. */
.chorus-mark.is-animated rect {
  transform-box: fill-box;
  transform-origin: center;
  animation: chorusBarIntro 0.55s cubic-bezier(0.34, 1.4, 0.5, 1) both;
}

/* The mock's stagger, verbatim: .10s, then +.08s per bar outward. */
.chorus-mark.is-animated rect:nth-child(1) { animation-delay: 0.1s; }
.chorus-mark.is-animated rect:nth-child(2) { animation-delay: 0.18s; }
.chorus-mark.is-animated rect:nth-child(3) { animation-delay: 0.26s; }
.chorus-mark.is-animated rect:nth-child(4) { animation-delay: 0.34s; }
.chorus-mark.is-animated rect:nth-child(5) { animation-delay: 0.42s; }
.chorus-mark.is-animated rect:nth-child(6) { animation-delay: 0.5s; }
.chorus-mark.is-animated rect:nth-child(7) { animation-delay: 0.58s; }

/* The lead bar carries a SECOND animation on the same delay — the rise and the
   glow start together, and the glow outlives it (1.2s vs .55s) so the mark
   settles lit rather than flashing. */
.chorus-mark.is-animated rect:nth-child(4) {
  animation:
    chorusBarIntro 0.55s cubic-bezier(0.34, 1.4, 0.5, 1) 0.34s both,
    chorusLeadGlow 1.2s ease-out 0.34s both;
}

@keyframes chorusBarIntro {
  0%   { transform: scaleY(0); opacity: 0; }
  55%  { transform: scaleY(1.18); opacity: 1; }
  75%  { transform: scaleY(0.92); }
  100% { transform: scaleY(1); opacity: 1; }
}

@keyframes chorusLeadGlow {
  0%, 60% { filter: drop-shadow(0 0 0 rgb(59 207 174 / 0)); }
  80%     { filter: drop-shadow(0 0 14px rgb(59 207 174 / 0.85)); }
  100%    { filter: drop-shadow(0 0 8px rgb(59 207 174 / 0.45)); }
}

/* ⚠ THE RESOLUTION IS THE SETTLED STATE, NOT "NO ANIMATION". Dropping the
   animation entirely would leave `both`-filled rects at their 0% keyframe —
   `scaleY(0)`, i.e. an INVISIBLE LOGO. The same trap main.css already
   documents for [data-pulse]: reduced motion means arrive, not disappear. */
@media (prefers-reduced-motion: reduce) {
  .chorus-mark.is-animated rect,
  .chorus-mark.is-animated rect:nth-child(4) {
    animation: none;
    transform: none;
    opacity: 1;
  }
  .chorus-mark.is-animated rect:nth-child(4) {
    filter: drop-shadow(0 0 8px rgb(59 207 174 / 0.45));
  }
}
</style>
