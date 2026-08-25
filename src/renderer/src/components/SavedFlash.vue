<script setup lang="ts">
/**
 * THE SAVE CONFIRMATION — the Chorus mark rises in the middle of the window
 * with the word `Saved` under it, then fades. Commissioned by Matthew on
 * 2026-08-25: a corner toast is a label you have to go and read, and the mark
 * arriving is something you see without looking.
 *
 * ⚠ IT IS THE SPLASH'S CHOREOGRAPHY, NOT A SECOND ONE. `ChorusMark`'s
 * `animated` prop carries the staggered bar rise and the lead bar's glow, and
 * this screen reuses it as-is rather than declaring its own — one mark, one
 * entrance, whether the app is starting or a setting was written. The wordmark
 * treatment below (mono, wide tracking, the clipped glint sweep) is
 * `StartupSplash`'s, verbatim, with a different word.
 *
 * ⚠ AND IT IS THE ONE OVERLAY IN THE APP THAT TAKES NO CLICKS. `pointer-events:
 * none` on the sheet, deliberately: a confirmation appears over whatever the
 * user is already doing, and a transparent panel that swallowed a click for two
 * seconds after every save would be a worse bug than no confirmation at all.
 * `StartupSplash` is the opposite case (it is `-webkit-app-region: drag` and
 * covers the window on purpose) — the two look alike and must not be copied
 * into each other.
 */
import { onBeforeUnmount, onMounted } from 'vue'
import ChorusMark from './ChorusMark.vue'

const emit = defineEmits<{ done: [] }>()

/**
 * ⚠ THE TIMER AND THE CSS FADE ARE ONE BEHAVIOUR, KEPT IN STEP HERE — the trap
 * `StartupSplash` records and the same fix. Each value is its CSS
 * counterpart's end (delay + duration) plus a small tail, so the element is
 * removed after the fade lands rather than mid-frame. If the keyframe delays
 * below move, these move with them.
 *
 * The full stagger ends at 1.13s (the last bar) and the lead glow settles at
 * 1.54s, so a fade before then would cut the mark off mid-entrance. 1.6s + 0.4s
 * is the earliest exit that lets the animation finish being itself.
 */
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const HOLD_MS = reducedMotion ? 1_400 : 2_050

let timer: ReturnType<typeof setTimeout> | undefined

onMounted(() => {
  timer = setTimeout(() => emit('done'), HOLD_MS)
})

// F13 listener/timer discipline: whatever unmounts this first — the timer, a
// second save remounting it under a new key, an HMR reload — leaves nothing
// pending.
onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <!-- `role="status"` and the visible word are the same fact: a screen reader
       hears "Saved" once, and the mark is `aria-hidden` inside ChorusMark. -->
  <div class="saved-flash" role="status" data-testid="saved-flash">
    <div class="saved-flash-stack">
      <ChorusMark :height="88" animated />

      <!-- Two elements, as on the splash: one cannot hold both a solid fill and
           a moving gradient clipped to its glyphs. -->
      <div class="saved-flash-wordmark">
        <div class="saved-flash-word">saved</div>
        <div class="saved-flash-word saved-flash-word-glint" aria-hidden="true">saved</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.saved-flash {
  position: fixed;
  inset: 0;
  /* Above the overlays (50) so a save made INSIDE settings is confirmed on top
     of it, and below the splash (100), which owns the window outright. */
  z-index: 90;
  display: flex;
  align-items: center;
  justify-content: center;
  /* ⚠ THE LINE THAT MAKES THIS SAFE. See the header: it must never eat a
     click, and every child inherits this. */
  pointer-events: none;
  user-select: none;
  /* ⚠ NO ANIMATION ON THIS ELEMENT, AND IT IS NOT AN OVERSIGHT — IT IS THE ONE
     THING THAT MAKES THE SCRIM BELOW WORK. An ancestor that animates OPACITY
     becomes a backdrop root, and `backdrop-filter` on anything inside it then
     has nothing to filter: the blur silently does nothing and the mark reads as
     a watermark over live terminal output. MEASURED IN THIS WINDOW rather than
     inferred — four swatches over a running pane (`_verify/saved-flash/`):
     blur alone blurs; blur + a radial mask blurs; a flat `rgb(6 8 10 / 0.9)`
     wash leaves the text READABLE; and blur under an opacity-animated parent
     does not blur at all. So each layer fades ITSELF and this sheet never
     changes its own opacity. */
}

/**
 * ⚠ THE SCRIM IS THE DIFFERENCE BETWEEN A CONFIRMATION AND A GHOST, and the
 * first cut got it wrong in a way only a screenshot showed: the wash lived on
 * the STACK, so it was the size of the mark plus its padding — about 100px of
 * falloff — and over a terminal mid-output the mark read as a watermark with
 * code showing straight through it.
 *
 * Two layers, both masked to the same circle so the window's edges are
 * untouched: a BLUR, which is what actually destroys the text underneath, and a
 * DARKENING wash over it for contrast. `farthest-corner` resolves the stops
 * against the whole viewport, so the dimmed area scales with the window instead
 * of with the glyph.
 */
.saved-flash::before {
  content: '';
  position: absolute;
  inset: 0;
  backdrop-filter: blur(14px) saturate(0.45) brightness(0.3);
  -webkit-backdrop-filter: blur(14px) saturate(0.45) brightness(0.3);
  /* A light wash ON TOP of the blur, not instead of it — the blur destroys the
     text, this keeps the disc from reading blue-grey where the pane behind it
     is bright. */
  background: radial-gradient(
    circle at center,
    rgb(6 8 10 / 0.55) 0%,
    rgb(6 8 10 / 0.4) 16%,
    rgb(6 8 10 / 0) 36%
  );
  -webkit-mask-image: radial-gradient(circle at center, #000 0%, #000 13%, transparent 35%);
  mask-image: radial-gradient(circle at center, #000 0%, #000 13%, transparent 35%);
  animation: savedFlashScrim 2s ease both;
}

.saved-flash-stack {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 22px;
  /* Layout only — the scrim is the sheet's job (see `.saved-flash::before`),
     because a background on a content-sized box is a background the size of the
     glyph. `position: relative` keeps the stack above that layer. */
  position: relative;
  /* Two animations, because this element owns BOTH ends of its life now that
     the sheet owns neither: the rise, then its own fade out on the timeline the
     scrim shares. */
  animation:
    savedFlashRise 0.5s cubic-bezier(0.2, 0.8, 0.3, 1) both,
    savedFlashOut 0.4s ease-in 1.6s both;
}

.saved-flash-wordmark {
  position: relative;
}

.saved-flash-word {
  font-family: var(--font-mono);
  font-size: 23px;
  letter-spacing: 0.34em;
  /* ⚠ PRIMARY, NOT SECONDARY — the splash's own choice is `secondary`, and it
     is right there: that screen owns a void backdrop and has no competition.
     This one lands over live terminal output, where the mid grey measured as
     barely legible. */
  color: var(--color-text-primary);
  text-shadow: 0 2px 18px rgb(6 8 10 / 0.9);
  /* Tracking appends a trailing gap after the last glyph, which shifts the word
     left of centre; the matching left pad cancels it. */
  padding-left: 0.34em;
  animation: savedFlashWordIn 0.5s ease-out 0.5s both;
}

.saved-flash-word-glint {
  position: absolute;
  inset: 0;
  color: transparent;
  background: linear-gradient(
    105deg,
    rgb(255 255 255 / 0) 38%,
    rgb(235 255 250 / 0.95) 50%,
    rgb(59 207 174 / 0.5) 54%,
    rgb(255 255 255 / 0) 62%
  );
  background-size: 220% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  animation: savedFlashGlint 0.7s cubic-bezier(0.6, 0.05, 0.3, 0.95) 0.9s both;
}

@keyframes savedFlashRise {
  0%   { opacity: 0; transform: translateY(8px) scale(0.97); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}

@keyframes savedFlashWordIn {
  0%   { opacity: 0; letter-spacing: 0.6em; }
  100% { opacity: 1; letter-spacing: 0.34em; }
}

@keyframes savedFlashGlint {
  0%   { background-position: 180% 0; }
  100% { background-position: -80% 0; }
}

/* One keyframe for the scrim's whole life: in, hold, out. Its end is the same
   1.6s + 0.4s the stack fades on, so the disc and the mark leave together. */
@keyframes savedFlashScrim {
  0%   { opacity: 0; }
  18%  { opacity: 1; }
  80%  { opacity: 1; }
  100% { opacity: 0; }
}

@keyframes savedFlashOut {
  0%   { opacity: 1; }
  100% { opacity: 0; }
}

/* ⚠ ARRIVE, DO NOT DISAPPEAR — the rule `ChorusMark` and `main.css` both state.
   The content is simply THERE (0.01s, no stagger, no glint sweep worth the
   name) and the sheet leaves early; `HOLD_MS` above is the counterpart of the
   1.0s + 0.35s end this produces. */
@media (prefers-reduced-motion: reduce) {
  .saved-flash-word,
  .saved-flash-word-glint {
    animation-duration: 0.01s;
    animation-delay: 0s;
  }

  /* The rise is motion for its own sake here — dropped outright rather than
     compressed, exactly as the splash drops its exit scale. ⚠ The SCRIM keeps
     its fade: it is legibility, not decoration, and snapping a dark disc onto
     the window is harsher than easing it in over a third of a second. */
  .saved-flash-stack {
    animation: none;
  }

  /* The sheet has no animation to retime any more; the two layers that do are
     shortened to land at 1.0s + 0.35s, which is what `HOLD_MS` above pairs
     with. */
  .saved-flash-stack {
    animation: savedFlashOut 0.35s ease-in 1s both;
  }

  .saved-flash::before {
    animation-duration: 1.35s;
  }
}
</style>
