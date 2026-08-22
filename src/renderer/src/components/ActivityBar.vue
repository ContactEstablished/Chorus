<script setup lang="ts">
/**
 * THE ACTIVITY BAR — the light that runs under a project with an agent mid-turn,
 * and the only place it is drawn.
 *
 * The artwork is `docs/project-activity-indicator.svg`, Matthew's, inlined here
 * VERBATIM in geometry and colour. That file is the authority; if it changes,
 * this component is what gets re-copied. Nothing about the drawing is derived,
 * recomputed, or "improved" on the way in.
 *
 * ⚠ IT CARRIES RAW HEX, WHICH `ProjectRail.vue` DELIBERATELY DOES NOT. That
 * rail's header states it holds no raw hex — every value is a 3c-1 token — and
 * that rule is exactly why this is a separate component rather than fifteen
 * lines of `<svg>` pasted into it. These five teals are a supplied drawing's
 * palette, not a theme decision, and they are near-neighbours of
 * `--color-accent-jade` rather than aliases of it (#43E6D2 vs #3BCFAE).
 * Substituting tokens would have been the same class of mistake as redrawing
 * the logo to match a mock: the artwork is the thing being asked for.
 *
 * ⚠ SMIL, NOT CSS KEYFRAMES, and that is a consequence of the source rather
 * than a preference. The sweep, its fade-in/out envelope and the layered glow
 * are all authored inside the file as `<animate>` / `<animateTransform>`. They
 * run in Chromium, they need no JavaScript, and they cannot be reached by CSS —
 * which is the whole reason `motion` below is decided in markup (see it).
 *
 * ⚠ EVERY `id` IS NAMESPACED PER INSTANCE. The file's ids (`rail`, `comet`,
 * `railGlow`, …) are document-global once inlined, and the rail renders one of
 * these per busy project. Duplicated ids do not error — `url(#comet)` silently
 * resolves to whichever came FIRST in the document — so several bars would
 * quietly share one instance's gradients and filters. Identical artwork makes
 * that invisible today and a genuine puzzle the first time one bar needs to
 * differ. `useId()` costs nothing and removes the class of bug entirely.
 */
import { useId } from 'vue'

/** Vue's per-instance id, folded into every internal reference. */
const uid = useId()
const ref_ = (name: string): string => `${name}-${uid}`

/**
 * Whether the comet may run.
 *
 * ⚠ READ IN JS BECAUSE CSS CANNOT REACH SMIL. A `@media (prefers-reduced-motion)`
 * block can suppress a CSS animation; it has no effect whatsoever on an
 * `<animateTransform>`, so honouring the preference means not rendering the
 * animated group at all. One read at setup, matching `StartupSplash.vue` — the
 * component is created when an agent starts working and destroyed when it
 * stops, so it never lives long enough for a stale answer to matter.
 *
 * ⚠ AND THE SIGNAL SURVIVES: the comet goes, and the rail lights steadily in
 * its place (`stop-opacity` below). A user who asked for less movement must
 * lose the movement, not the fact that their agents are running.
 */
let motion = true
try {
  motion = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
} catch {
  // No matchMedia (a test environment, a stripped host): assume motion is fine.
}
</script>

<template>
  <svg
    class="activity-bar"
    viewBox="0 0 1000 32"
    fill="none"
    preserveAspectRatio="none"
    aria-hidden="true"
  >
    <defs>
      <linearGradient
        :id="ref_('rail')"
        x1="0"
        y1="0"
        x2="1000"
        y2="0"
        gradientUnits="userSpaceOnUse"
      >
        <stop offset="0" stop-color="#43E6D2" stop-opacity="0" />
        <!-- ⚠ THE ONE VALUE THAT MOVES WITH `motion`. At rest the track is a
             hint of a path (0.13); with the comet suppressed it becomes the
             whole signal, so it lights. Same colour, same place, same meaning —
             stated as presence instead of travel. -->
        <stop offset="0.08" stop-color="#43E6D2" :stop-opacity="motion ? 0.13 : 0.62" />
        <stop offset="0.92" stop-color="#43E6D2" :stop-opacity="motion ? 0.13 : 0.62" />
        <stop offset="1" stop-color="#43E6D2" stop-opacity="0" />
      </linearGradient>

      <linearGradient
        :id="ref_('comet')"
        x1="0"
        y1="16"
        x2="270"
        y2="16"
        gradientUnits="userSpaceOnUse"
      >
        <stop offset="0" stop-color="#34E7D0" stop-opacity="0" />
        <stop offset="0.34" stop-color="#34E7D0" stop-opacity="0.08" />
        <stop offset="0.72" stop-color="#42EBD7" stop-opacity="0.62" />
        <stop offset="0.94" stop-color="#72F5E5" stop-opacity="0.95" />
        <stop offset="1" stop-color="#E9FFFC" />
      </linearGradient>

      <filter
        :id="ref_('railGlow')"
        x="0"
        y="8"
        width="1000"
        height="16"
        filterUnits="userSpaceOnUse"
        color-interpolation-filters="sRGB"
      >
        <feGaussianBlur stdDeviation="1.4" />
      </filter>

      <filter
        :id="ref_('cometOuter')"
        x="-24"
        y="-8"
        width="330"
        height="48"
        filterUnits="userSpaceOnUse"
        color-interpolation-filters="sRGB"
      >
        <feGaussianBlur stdDeviation="5.5" />
      </filter>

      <filter
        :id="ref_('cometInner')"
        x="-10"
        y="4"
        width="300"
        height="24"
        filterUnits="userSpaceOnUse"
        color-interpolation-filters="sRGB"
      >
        <feGaussianBlur stdDeviation="2" />
      </filter>

      <clipPath :id="ref_('railClip')">
        <rect width="1000" height="32" rx="4" />
      </clipPath>
    </defs>

    <g :clip-path="`url(#${ref_('railClip')})`">
      <path
        d="M10 16H990"
        :stroke="`url(#${ref_('rail')})`"
        stroke-width="4"
        stroke-linecap="round"
        :opacity="motion ? 0.24 : 0.5"
        :filter="`url(#${ref_('railGlow')})`"
      />
      <path
        d="M10 16H990"
        :stroke="`url(#${ref_('rail')})`"
        stroke-width="1.25"
        stroke-linecap="round"
      />

      <!-- The comet: a fade-in/out envelope wrapped around a constant-speed
           traverse, so it never pops into or out of existence at either edge. -->
      <g v-if="motion" opacity="0">
        <animate
          attributeName="opacity"
          values="0;1;1;0"
          keyTimes="0;0.08;0.92;1"
          dur="1.65s"
          repeatCount="indefinite"
        />
        <g>
          <animateTransform
            attributeName="transform"
            type="translate"
            from="-290 0"
            to="1010 0"
            dur="1.65s"
            repeatCount="indefinite"
          />
          <path
            d="M0 16H270"
            :stroke="`url(#${ref_('comet')})`"
            stroke-width="10"
            stroke-linecap="round"
            opacity="0.25"
            :filter="`url(#${ref_('cometOuter')})`"
          />
          <path
            d="M0 16H270"
            :stroke="`url(#${ref_('comet')})`"
            stroke-width="4.5"
            stroke-linecap="round"
            opacity="0.65"
            :filter="`url(#${ref_('cometInner')})`"
          />
          <path
            d="M0 16H270"
            :stroke="`url(#${ref_('comet')})`"
            stroke-width="1.5"
            stroke-linecap="round"
          />
          <ellipse
            cx="270"
            cy="16"
            rx="9"
            ry="2.8"
            fill="#66F4E2"
            opacity="0.7"
            :filter="`url(#${ref_('cometInner')})`"
          />
          <ellipse cx="270" cy="16" rx="3.2" ry="1.35" fill="#E9FFFC" />
        </g>
      </g>
    </g>
  </svg>
</template>

<style scoped>
/* Fills whatever box the caller gives it — `preserveAspectRatio="none"` means
   the drawing stretches to that box rather than reserving its own 1000:32. The
   caller therefore owns the geometry, and this file owns only the drawing. */
.activity-bar {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
