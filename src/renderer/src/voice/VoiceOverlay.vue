<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { VoiceStateEvent, VoiceTarget } from '../../../shared/ipc'

/**
 * The dictation overlay's contents (Task 5-3).
 *
 * ⚠ IT NEVER RENDERS TRANSCRIPT TEXT, AND THAT IS A HARD RULE RATHER THAN A
 * DESIGN CHOICE. This window floats above every application on the desktop —
 * including whatever the user happens to be screen-sharing or recording. What it
 * shows is a state token, a level derived from the audio, the name of a pane the
 * user can already see, and an elapsed clock. Nothing here is a secret, because
 * nothing here is content.
 *
 * ⚠ NO PINIA, NO ROUTER, NO APP CHROME. This is a second BrowserWindow with its
 * own tiny bundle; pulling the main app's store graph into it would load the
 * whole application into an indicator.
 */

const state = ref<VoiceStateEvent | null>(null)
const target = ref<VoiceTarget | null>(null)
const elapsedMs = ref(0)

let started = 0
let timer: ReturnType<typeof setInterval> | null = null
const offs: Array<() => void> = []

const bridge = (): typeof window.chorus => window.chorus

const phase = computed(() => state.value?.state ?? 'ready')
const listening = computed(() => phase.value === 'listening')

/** The pane the words will land in. Falls back to a neutral phrase rather than
 *  guessing — an overlay that names the wrong pane is worse than one that
 *  names none. */
const targetName = computed(() => target.value?.title ?? 'no pane targeted')

const label = computed(() => {
  switch (phase.value) {
    case 'listening':
      return 'Listening'
    case 'finalizing':
      return 'Transcribing'
    case 'inserted':
      return 'Inserted'
    case 'ready-for-review':
      return 'Held — target gone'
    case 'failed':
      return 'Failed'
    default:
      return 'Ready'
  }
})

/** ⚠ A COUNT AND A CAUSE, NEVER THE WORDS. `keepingUp` false means audio is
 *  being dropped, which the user needs to know while they are still talking. */
const dropped = computed(() => state.value?.framesDropped ?? 0)
const keepingUp = computed(() => state.value?.keepingUp !== false)

const elapsed = computed(() => {
  const total = Math.floor(elapsedMs.value / 1000)
  const m = String(Math.floor(total / 60)).padStart(1, '0')
  const s = String(total % 60).padStart(2, '0')
  return `${m}:${s}`
})

/** Twelve bars, lit from the level. A meter rather than a waveform: the level is
 *  one number per push, not a signal. */
const BARS = 12
const litBars = computed(() => {
  const lvl = state.value?.level ?? 0
  // The level is an RMS in roughly [0, 0.4] for speech, so it is scaled rather
  // than used raw — a linear 0..1 meter would barely move.
  const scaled = Math.min(1, lvl / 0.25)
  return Math.round(scaled * BARS)
})

onMounted(() => {
  offs.push(
    bridge().onVoiceState((e) => {
      const was = state.value?.state
      state.value = e
      if (e.state === 'listening' && was !== 'listening') {
        started = Date.now()
        elapsedMs.value = 0
        if (!timer) timer = setInterval(() => (elapsedMs.value = Date.now() - started), 200)
      }
      if (e.state !== 'listening' && timer) {
        clearInterval(timer)
        timer = null
      }
    })
  )
  offs.push(bridge().onVoiceTarget((t) => (target.value = t)))
})

onUnmounted(() => {
  // F13: release every subscription, and the clock with them.
  for (const off of offs) off()
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div class="overlay" :class="{ 'is-listening': listening }">
    <div class="row">
      <span class="dot" :class="{ live: listening }" aria-hidden="true"></span>
      <span class="label">{{ label }}</span>
      <span class="elapsed">{{ elapsed }}</span>
    </div>

    <div class="meter" role="img" :aria-label="`input level ${litBars} of ${BARS}`">
      <span v-for="i in BARS" :key="i" class="bar" :class="{ lit: i <= litBars }"></span>
    </div>

    <div class="row sub">
      <span class="target">{{ targetName }}</span>
      <span v-if="!keepingUp" class="warn">dropping {{ dropped }}</span>
    </div>
  </div>
</template>

<style scoped>
/* The window itself is transparent; this is the whole visible surface. */
.overlay {
  box-sizing: border-box;
  height: 100vh;
  padding: 10px 12px;
  border-radius: 10px;
  /* Opaque enough to read over any application underneath. */
  background: rgba(13, 15, 18, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #e6e8eb;
  font: 12px/1.35 system-ui, sans-serif;
  display: flex;
  flex-direction: column;
  gap: 6px;
  /* Clicks pass through at the window level too (setIgnoreMouseEvents). */
  user-select: none;
}
.is-listening {
  border-color: rgba(239, 68, 68, 0.55);
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #6b7280;
  flex: none;
}
.dot.live {
  background: #ef4444;
}
.label {
  font-weight: 600;
}
.elapsed {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
  opacity: 0.75;
}
.meter {
  display: flex;
  gap: 2px;
  height: 14px;
  align-items: flex-end;
}
.bar {
  flex: 1;
  height: 100%;
  border-radius: 1px;
  background: rgba(255, 255, 255, 0.12);
}
.bar.lit {
  background: #ef4444;
}
.sub {
  opacity: 0.75;
}
.target {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.warn {
  margin-left: auto;
  color: #f59e0b;
  flex: none;
}
</style>
