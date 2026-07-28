<script setup lang="ts">
/**
 * THE LAUNCH SPLASH — `docs/design/v2/Chorus Startup.dc.html`, built.
 *
 * D83 recorded this mock as "a NEW FEATURE … Unbuilt and unscheduled, recorded
 * so it is not silently dropped", because its boot line needs restore progress
 * "the renderer is never told". This is that follow-through, commissioned by
 * Matthew on 2026-07-27. The renderer is now told — see `boot/bootInfo.ts` for
 * how, and why it is not an IPC channel.
 *
 * ⚠ THE MOCK'S BOOT LINE IS NOT BUILT AS DRAWN, AND D76 IS WHY. It reads
 * "waking 7 voices · restoring 3 sessions". The restore count is real and is
 * rendered. "7 voices" is not: Chorus registers exactly TWO agent kinds
 * (`staticRegistry` — claude, codex), so no honest reading of the app produces
 * seven of anything, and D76's rule for precisely this case is "render what the
 * data supports, omit the rest, and never render a placeholder or a zero".
 * The clause is dropped rather than back-filled with a number that looks real.
 * (Matthew chose this over inventing a source, 2026-07-27.)
 *
 * ⚠ AND THE WHOLE LINE DISAPPEARS ON A COLD BOOT. Nothing to restore means no
 * count, which means no line — not "restoring 0 sessions". The splash is a
 * fraction shorter in the middle and that is the correct rendering.
 *
 * Timing, colour and choreography are otherwise the mock's, verbatim; the
 * numbers below are its numbers. The bar rise and lead-bar glow live in
 * `ChorusMark.vue`, since they belong to the mark rather than to this screen.
 */
import { onBeforeUnmount, onMounted } from 'vue'
import ChorusMark from './ChorusMark.vue'
import { bootLine, footerLine, parseBootInfo } from '../boot/bootInfo'

const emit = defineEmits<{ done: [] }>()

/** Read ONCE at setup, not per-render: these are boot constants, and re-parsing
 *  the URL on every tick would imply they can change. They cannot. */
const info = parseBootInfo(window.location.search)
const line = bootLine(info)
const footer = footerLine(info)

/**
 * ⚠ THE REDUCED-MOTION BRANCH MUST MOVE THIS TIMER TOO, and forgetting it is
 * the trap. The CSS below shortens the fade to finish at 1.6s under reduced
 * motion; if the unmount stayed at 2.75s the splash would sit there fully
 * transparent but still mounted for another 1.15s — an invisible sheet over the
 * workspace eating every click. The fade and the unmount are one behaviour and
 * are kept in step here.
 *
 * Each value is its CSS counterpart's end (delay + duration) plus a 50ms tail,
 * so the element is removed after the fade lands rather than mid-frame.
 */
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const HOLD_MS = reducedMotion ? 1_650 : 2_750

let timer: ReturnType<typeof setTimeout> | undefined

onMounted(() => {
  timer = setTimeout(() => emit('done'), HOLD_MS)
})

// F13 listener/timer discipline: whatever unmounts this first (the timer, an
// HMR reload, a window close) leaves nothing pending.
onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <!-- ⚠ `drag` IS DELIBERATE. For 2.75s this sheet is the entire window
       surface, and a frameless window whose only draggable strip is hidden
       underneath it cannot be moved at all. The splash inherits the titlebar's
       job while it covers it. -->
  <div class="splash" data-testid="startup-splash">
    <div class="splash-stack">
      <ChorusMark :height="76" animated />

      <!-- The wordmark, twice: the base text, and a transparent copy whose
           gradient is clipped to the glyphs and swept across them. Two elements
           is the only way to do it — one element cannot hold both a solid fill
           and a moving clipped gradient. -->
      <div class="splash-wordmark">
        <div class="splash-word">chorus</div>
        <div class="splash-word splash-word-glint" aria-hidden="true">chorus</div>
      </div>

      <!-- D76: present only when there is a real count behind it. -->
      <div v-if="line" class="splash-bootline">{{ line }}</div>
    </div>

    <div v-if="footer" class="splash-footer">{{ footer }}</div>
  </div>
</template>

<style scoped>
.splash {
  position: fixed;
  inset: 0;
  /* Above the 50 that overlays.css and App's palette notice share — the splash
     is not an overlay among overlays, it is in front of the entire window,
     titlebar and all. */
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  /* The mock's backdrop is the void tone, NOT the app surface: the splash reads
     as the app arriving out of nothing rather than as a panel over a workspace. */
  background: var(--color-surface-void);
  user-select: none;
  -webkit-app-region: drag;
  animation: chorusSplashOut 0.45s ease-in 2.25s forwards;
}

.splash-stack {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 26px;
  animation: chorusLogoExit 0.45s ease-in 2.25s forwards;
}

.splash-wordmark {
  position: relative;
}

.splash-word {
  font-family: var(--font-mono);
  font-size: 27px;
  letter-spacing: 0.34em;
  color: var(--color-text-secondary);
  /* Letter-spacing appends a trailing gap after the final glyph, which shifts
     the word visually left of centre. The matching left pad cancels it. */
  padding-left: 0.34em;
  animation: chorusWordIn 0.6s ease-out 0.55s both;
}

.splash-word-glint {
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
  animation: chorusGlintSweep 0.8s cubic-bezier(0.6, 0.05, 0.3, 0.95) 1.15s both;
}

.splash-bootline {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--color-text-eyebrow);
  animation: chorusSubIn 0.4s ease-out 1s both;
}

.splash-footer {
  position: absolute;
  bottom: 26px;
  left: 0;
  right: 0;
  text-align: center;
  font-family: var(--font-mono);
  font-size: 9.5px;
  color: var(--color-logo-bar-low);
  animation: chorusSubIn 0.4s ease-out 1s both;
}

@keyframes chorusWordIn {
  0%   { opacity: 0; letter-spacing: 0.6em; }
  100% { opacity: 1; letter-spacing: 0.34em; }
}

@keyframes chorusGlintSweep {
  0%   { background-position: 180% 0; }
  100% { background-position: -80% 0; }
}

@keyframes chorusSubIn {
  0%   { opacity: 0; }
  100% { opacity: 1; }
}

@keyframes chorusSplashOut {
  0%   { opacity: 1; }
  100% { opacity: 0; }
}

@keyframes chorusLogoExit {
  0%   { transform: scale(1); }
  100% { transform: scale(0.94); }
}

/* The mock's own reduced-motion block: the content ARRIVES rather than
   animating in (0.01s, no stagger), and the whole sheet fades out early. Keep
   `HOLD_MS` above in step with the 1.2s + 0.4s end this produces. */
@media (prefers-reduced-motion: reduce) {
  .splash-word,
  .splash-word-glint,
  .splash-bootline,
  .splash-footer {
    animation-duration: 0.01s;
    animation-delay: 0s;
  }

  .splash {
    animation-duration: 0.4s;
    animation-delay: 1.2s;
  }

  /* The exit scale is motion for its own sake — drop it entirely rather than
     compress it. The fade alone still reads as "leaving". */
  .splash-stack {
    animation: none;
  }
}
</style>
