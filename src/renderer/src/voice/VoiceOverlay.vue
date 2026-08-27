<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { VoiceStateEvent, VoiceTarget } from '../../../shared/ipc'
import ChorusMark from '../components/ChorusMark.vue'
import { displayLevelFromRms, smoothLevel } from '../markLevel'

/**
 * The dictation overlay's contents (Task 5-3; redesigned around the mark, D181).
 *
 * ⚠ IT NEVER RENDERS TRANSCRIPT TEXT, AND THAT IS A HARD RULE RATHER THAN A
 * DESIGN CHOICE. This window floats above every application on the desktop —
 * including whatever the user happens to be screen-sharing or recording. What it
 * shows is a state token, a level derived from the audio, the name of a pane the
 * user can already see, and an elapsed clock. Nothing here is a secret, because
 * nothing here is content. The redesign added no new text.
 *
 * ⚠ NO PINIA, NO ROUTER, NO APP CHROME. This is a second BrowserWindow with its
 * own tiny bundle; pulling the main app's store graph into it would load the
 * whole application into an indicator. `ChorusMark` is admitted because it is a
 * pure drawing with no store, no IPC and no imports of its own beyond
 * `markLevel.ts` — and because the app's stylesheet is still NOT loaded here,
 * which is why `overlay.html` declares the mark's four fills itself.
 *
 * ⚠ THE MARK IS THE LEVEL METER. It replaced twelve red bars that read, at any
 * real speaking volume, as one solid red rectangle. Bars light OUTWARD from the
 * jade lead as the level rises; nothing about the geometry moves.
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
    case 'refining':
      // Task 5-4: the transcript is, at this moment, leaving the machine on the
      // user's key (VoicePlan §5) — named as such, not hidden inside "working".
      return 'Refining'
    case 'inserted':
      // Task 5-4: the outcome is the news. "Inserted" alone would let a fallback
      // read as a success; the sub-line below carries the reason.
      return state.value?.refinement?.outcome === 'refined' ? 'Inserted — cleaned up' : 'Inserted'
    case 'ready-for-review':
      // F87: the CAUSE rides `message` (no pane targeted, or the pane is gone);
      // the label only says what happened to the words.
      return 'Held — not written'
    case 'failed':
      return 'Failed'
    default:
      return 'Ready'
  }
})

/**
 * The fixed sentence main sends for a refinement fallback or a failure. It is
 * a closed-vocabulary string composed in main from nothing the user said; the
 * overlay shows it as-is. Null on the happy path.
 */
const outcomeLine = computed(() => {
  const s = state.value
  if (!s) return null
  if (s.state === 'inserted' || s.state === 'ready-for-review' || s.state === 'failed') return s.message
  return null
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

/* ── The mark, driven by the voice ─────────────────────────────────────────
 *
 * ⚠ THE LEVEL IS EASED HERE, NOT BOUND DIRECTLY, AND THAT IS NOT POLISH.
 * `VoiceStateEvent.level` is pushed every OTHER 64 ms frame — about 7.8 times a
 * second. Bound straight to opacity that is a visible flicker, and the feature
 * requirements (§15) ban rapidly flashing recording animations outright. So the
 * pushed value becomes a TARGET and a requestAnimationFrame loop walks toward
 * it with an asymmetric envelope (see `markLevel.ts`).
 *
 * The loop stops itself the moment it has settled, so a hidden or idle overlay
 * schedules no repaints at all.
 */

/** What the mark shows under `prefers-reduced-motion`: lit, settled, still.
 *  ⚠ NOT ZERO. ChorusMark's own rule — reduced motion means arrive, not
 *  disappear — applies to a quiet room just as much as to a splash screen. */
const REDUCED_MOTION_LEVEL = 0.55

/** How long the `inserted` bloom is held before it is allowed to decay. */
const INSERTED_BLOOM_MS = 260

const displayLevel = ref(0)
let targetLevel = 0
let frame: number | null = null
let lastFrameAt = 0
let reducedMotion = false
let bloomHold: ReturnType<typeof setTimeout> | null = null

function tick(now: number): void {
  // First frame of a run has no previous timestamp; assume one 60 Hz step
  // rather than easing by however long the overlay happened to be idle.
  const dt = lastFrameAt === 0 ? 16 : now - lastFrameAt
  lastFrameAt = now
  displayLevel.value = smoothLevel(displayLevel.value, targetLevel, dt)
  if (displayLevel.value === targetLevel) {
    frame = null
    lastFrameAt = 0
    return
  }
  frame = requestAnimationFrame(tick)
}

function pump(): void {
  if (reducedMotion || frame !== null) return
  lastFrameAt = 0
  frame = requestAnimationFrame(tick)
}

function stopLoop(): void {
  if (frame !== null) cancelAnimationFrame(frame)
  frame = null
  lastFrameAt = 0
}

function clearBloomHold(): void {
  if (bloomHold === null) return
  clearTimeout(bloomHold)
  bloomHold = null
}

function setTarget(next: number): void {
  targetLevel = next
  pump()
}

/** The whole mark's glow, driven by the same eased level as its bars.
 *
 *  ⚠ IT LIVES ON THIS WRAPPER, NOT ON THE `<rect>`s. An outer `<svg>` clips to
 *  its own viewport, and the lead bar spans the full height of the viewBox
 *  (y=0, h=76) — a drop-shadow on it would be sliced flat top and bottom. */
const bloom = computed(() => ({
  '--bloom-radius': `${(5 + 23 * displayLevel.value).toFixed(1)}px`,
  '--bloom-alpha': (0.1 + 0.5 * displayLevel.value).toFixed(3)
}))

/* ── The drag ──────────────────────────────────────────────────────────────
 *
 * ⚠ NOT `-webkit-app-region: drag`, AND THAT IS A MEASUREMENT RATHER THAN A
 * PREFERENCE. The titlebar's idiom — let Windows run the move loop — was tried
 * first and does not move this window: it is `focusable: false`
 * (`WS_EX_NOACTIVATE`), and DefWindowProc will not run an HTCAPTION move on
 * one. Driven with real OS mouse input (`_verify/d181/win.ps1`), the press
 * lands on the overlay and nothing happens. So the pointer gesture is read
 * here and main does the moving.
 *
 * ⚠ SCREEN COORDINATES, NOT CLIENT ONES. The window moves under the cursor
 * while the gesture runs, so anything measured relative to the page would feed
 * back into itself. `screenX/screenY` are fixed to the desktop, and what is
 * sent is the pointer's travel from where the gesture began — never a position.
 */
const dragFrom = ref<{ x: number; y: number } | null>(null)

function onDragStart(e: PointerEvent): void {
  if (e.button !== 0) return
  dragFrom.value = { x: e.screenX, y: e.screenY }
  // Capture on the panel, so the drag survives the pointer outrunning a window
  // that is being moved to catch up with it.
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  bridge().moveVoiceOverlay(0, 0, true)
}

function onDragMove(e: PointerEvent): void {
  const from = dragFrom.value
  if (from === null) return
  bridge().moveVoiceOverlay(e.screenX - from.x, e.screenY - from.y, false)
}

function onDragEnd(e: PointerEvent): void {
  if (dragFrom.value === null) return
  dragFrom.value = null
  const el = e.currentTarget as HTMLElement
  if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
}

onMounted(() => {
  // Reduced motion is read live rather than once: the OS setting can change
  // under a running app, and this window lives for the life of the process.
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
  const applyMotion = (): void => {
    reducedMotion = motion.matches
    if (!reducedMotion) {
      pump()
      return
    }
    stopLoop()
    clearBloomHold()
    displayLevel.value = REDUCED_MOTION_LEVEL
  }
  applyMotion()
  motion.addEventListener('change', applyMotion)
  offs.push(() => motion.removeEventListener('change', applyMotion))

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

      if (reducedMotion) return
      clearBloomHold()
      if (e.state === 'listening') {
        setTarget(displayLevelFromRms(e.level))
      } else if (e.state === 'inserted') {
        // A successful dictation ends on a lit mark that then falls away over
        // the overlay's linger — the same "answer with the mark" idiom as
        // SavedFlash. A failure or a held transcript gets no bloom; the amber
        // outcome line is the news there.
        setTarget(1)
        bloomHold = setTimeout(() => {
          bloomHold = null
          setTarget(0)
        }, INSERTED_BLOOM_MS)
      } else {
        setTarget(0)
      }
    })
  )
  offs.push(bridge().onVoiceTarget((t) => (target.value = t)))
})

onUnmounted(() => {
  // F13: release every subscription, and the clock and the animation with them.
  for (const off of offs) off()
  if (timer) clearInterval(timer)
  clearBloomHold()
  stopLoop()
})
</script>

<template>
  <!-- ⚠ THE WHOLE PANEL IS THE DRAG HANDLE. There are no controls in here to
       collide with it, and the window is deliberately small; a dedicated grip
       would be a smaller target for no gain. -->
  <div
    class="overlay"
    :class="{ 'is-listening': listening, 'is-dragging': dragFrom !== null }"
    @pointerdown="onDragStart"
    @pointermove="onDragMove"
    @pointerup="onDragEnd"
    @pointercancel="onDragEnd"
  >
    <div class="row">
      <span class="dot" :class="{ live: listening }" aria-hidden="true"></span>
      <!-- The textual status the requirements ask for alongside the animation,
           and the only live region here — the clock must never be announced. -->
      <span class="label" role="status">{{ label }}</span>
      <span class="elapsed" aria-hidden="true">{{ elapsed }}</span>
    </div>

    <!-- aria-hidden: a level read aloud eight times a second is noise, and the
         label above already says what is happening. -->
    <div class="stage" aria-hidden="true">
      <div class="mark-stage" :style="bloom">
        <ChorusMark :height="72" :level="displayLevel" />
      </div>
    </div>

    <div class="row sub">
      <span v-if="outcomeLine" class="target outcome">{{ outcomeLine }}</span>
      <span v-else class="target">{{ targetName }}</span>
      <span v-if="!keepingUp" class="warn">dropping {{ dropped }}</span>
    </div>
  </div>
</template>

<style scoped>
/* The window itself is transparent; this is the whole visible surface. */
.overlay {
  box-sizing: border-box;
  height: 100vh;
  padding: 12px 14px;
  border-radius: 12px;
  /* Opaque enough to read over any application underneath. */
  background: rgba(13, 15, 18, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #e6e8eb;
  font: 12px/1.35 system-ui, sans-serif;
  display: flex;
  flex-direction: column;
  gap: 6px;
  user-select: none;
  /* ⚠ D181: the panel is draggable, which is why the window no longer calls
     setIgnoreMouseEvents. The drag itself is the pointer handlers above, NOT
     `-webkit-app-region: drag` — see their note; that idiom does not move a
     non-focusable window, and setting it here would additionally stop the
     pointer events the real implementation needs from ever arriving. */
  cursor: grab;
}
.is-dragging {
  cursor: grabbing;
}
/* Jade, not red. The mark carries the level and the brand at once; the word
   "Listening" and the running clock carry the state textually, which is what
   "do not rely on colour alone" actually asks for. */
.is-listening {
  border-color: rgb(59 207 174 / 0.45);
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
  background: var(--color-accent-jade);
}
.label {
  font-weight: 600;
  letter-spacing: 0.01em;
}
.elapsed {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
  opacity: 0.75;
}

/* The mark sits in whatever height is left between the two text rows, so the
   panel can be resized in one place (OVERLAY_HEIGHT) without re-tuning this. */
.stage {
  flex: 1;
  display: grid;
  place-items: center;
  min-height: 0;
}
.mark-stage {
  line-height: 0;
  filter: drop-shadow(
    0 0 var(--bloom-radius, 5px)
      color-mix(in srgb, var(--color-accent-jade) calc(var(--bloom-alpha, 0.1) * 100%), transparent)
  );
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
/* A fallback or failure line: amber, so "original inserted" is not mistaken
   for the ordinary target line at a glance. */
.outcome {
  color: #f59e0b;
}
</style>
