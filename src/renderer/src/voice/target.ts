import { ref, computed } from 'vue'
import type { VoiceStateEvent, VoiceTarget } from '../../../shared/ipc'
import { startCapture, stopCapture, activeCapture } from './capture'

/**
 * The dictation ring and click-to-talk, shared across panes (Task 5-3).
 *
 * ⚠ MODULE-LEVEL STATE RATHER THAN A PINIA STORE, DELIBERATELY. There is exactly
 * one dictation at a time in exactly one window, and every pane needs to know
 * whether the ring is on IT. A store would add a reactive object that D14 then
 * forbids from crossing the bridge — and nothing here ever should cross it, so
 * the simplest thing that cannot make that mistake is the right one.
 *
 * ⚠ THE RING IS RENDERED FROM WHAT **MAIN** SAYS, NOT FROM LOCAL FOCUS. Main
 * owns the target for the capture's lifetime; a ring drawn from the renderer's
 * own idea of focus would drift from the pane that actually receives the text at
 * exactly the moment it matters — the user dictates into another application, so
 * focus moves while they speak.
 */

const target = ref<VoiceTarget>({ sessionId: null, title: null })
const state = ref<VoiceStateEvent | null>(null)
let subscribed = false

function subscribe(): void {
  if (subscribed) return
  subscribed = true
  // ⚠ NEVER UNSUBSCRIBED, AND THAT IS CORRECT HERE. These are module-level
  // singletons for the lifetime of the window; a per-component unsubscribe would
  // tear them down for every other pane the moment one unmounts.
  window.chorus.onVoiceTarget((t) => (target.value = t))
  window.chorus.onVoiceState((e) => (state.value = e))
}

/** Whether this pane wears the dictation ring. */
export function useDictationRing(sessionId: string) {
  subscribe()
  return {
    /** The ring is shown BEFORE the user speaks (`Plan.md` §7, glanceability) —
     *  it tracks the target whether or not a capture is running. */
    ringed: computed(() => target.value.sessionId === sessionId),
    /** True only while this pane is actually receiving a dictation. */
    dictating: computed(
      () =>
        target.value.sessionId === sessionId &&
        (state.value?.state === 'listening' || state.value?.state === 'finalizing')
    ),
    listening: computed(() => state.value?.state === 'listening')
  }
}

/**
 * Click-to-talk: start dictating into this pane, or stop if already going.
 *
 * ⚠ A PEER OF PUSH-TO-TALK, NOT A FALLBACK, AND IT DOES NOT TOUCH `uiohook` AT
 * ALL. VoicePlan §7.2 makes this the ACCESSIBILITY path — "a sustained hold is
 * exactly the interaction a motor-impaired user cannot perform" — so it must
 * work when the native hook is missing, broken, or ABI-mismatched. Nothing on
 * this code path loads or consults it.
 *
 * ⚠ IT IS A TOGGLE, WHICH IS THE WHOLE POINT: click to start, click to stop, no
 * key held at any moment.
 */
export async function toggleDictation(sessionId: string): Promise<void> {
  if (activeCapture()) {
    await stopCapture()
    return
  }
  // Name the target BEFORE opening the device, so the ring is already on this
  // pane when the first frame arrives and main can never start a capture with no
  // target to aim at.
  await window.chorus.setVoiceTarget(sessionId, null)
  await startCapture()
}
