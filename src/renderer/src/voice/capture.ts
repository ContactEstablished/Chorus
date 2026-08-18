import { VOICE_FRAME_SAMPLES, VOICE_SAMPLE_RATE, type VoiceFrame } from '../../../shared/ipc'
/**
 * ⚠ `?url` IS WHAT MAKES THE WORKLET A REAL ASSET IN BOTH DEV AND BUILD (F80).
 * The processor may not be inlined, bundled into this chunk, or generated as a
 * `blob:` — `default-src 'self'` carries no `blob:` and
 * `addModule(URL.createObjectURL(...))` fails with a bare `AbortError` naming
 * neither the CSP nor the directive. `?url` asks Vite to emit the file and hand
 * back a same-origin URL, which is the one form `addModule` accepts here.
 */
import pcmWorkletUrl from './pcm-worklet.js?url'

/**
 * Renderer-side microphone capture (Phase 5, Task 5-1).
 *
 * ⚠ CAPTURE IS IN THE RENDERER BECAUSE IT CANNOT BE ANYWHERE ELSE.
 * `getUserMedia` is a Chromium API and the main process has no microphone access
 * at all — there is no Node or Electron API that opens an audio device
 * (VoicePlan §4.1). Meanwhile CLAUDE.md forbids the renderer from spawning
 * processes and the CSP forbids it reaching the network, so transcription can
 * only live in main. The split is forced, not chosen.
 *
 * ⚠ THIS MODULE NEVER TOUCHES A PINIA STORE, AND THAT IS D14. Every frame's
 * `Int16Array` is built fresh here and handed straight to `sendVoiceFrame`.
 * Parking a frame in a store and forwarding it from there hands Electron a Vue
 * reactive Proxy, which structured clone refuses with "An object could not be
 * cloned" — at runtime, with NO compile-time signal. Voice is the first feature
 * in which the renderer is a bulk binary producer, so D14 is being met in a
 * direction it has never been tested in.
 */

export type CaptureFailureReason =
  | 'permission-denied'
  | 'no-device'
  | 'already-capturing'
  | 'refused-by-main'
  | 'sample-rate-not-honoured'
  | 'worklet-failed'
  | 'unknown'

export interface CaptureFailure {
  readonly reason: CaptureFailureReason
  /** A short, non-identifying description. ⚠ NEVER the device label — F79
   *  recorded that Electron hands it out, and nothing here passes it on. */
  readonly detail: string
}

export interface CaptureHandle {
  readonly captureId: string
  /** What the live `AudioContext` actually reports. Read from the running
   *  context, never assumed — see `assertRate`. */
  readonly sampleRate: number
  /** The device's own native rate, for the record. */
  readonly deviceSampleRate: number
  stop(): Promise<void>
}

export type CaptureResult =
  | { readonly ok: true; readonly handle: CaptureHandle }
  | { readonly ok: false; readonly failure: CaptureFailure }

/** The bridge surface this module needs. Declared structurally so the capture
 *  logic can be reasoned about (and later tested) without `window.chorus`. */
export interface CaptureBridge {
  startVoiceCapture(): Promise<{
    started: boolean
    captureId: string | null
    sampleRate: number
    frameSamples: number
    refusal: string | null
  }>
  sendVoiceFrame(frame: VoiceFrame): void
  stopVoiceCapture(captureId: string): Promise<unknown>
  onVoiceState(callback: (event: { state: string; captureId: string | null }) => void): () => void
  /** Task 5-4: which microphone the user chose, or null for the default. */
  getVoiceSettings(): Promise<{ settings: { inputDeviceId: string | null } }>
}

function bridge(): CaptureBridge {
  // `window.chorus` is the frozen contextBridge surface. Never monkey-patched
  // and never wrapped — a hook on it is invisible to the real caller.
  return (window as unknown as { chorus: CaptureBridge }).chorus
}

/** Only one capture may exist per renderer, mirroring main's single owner. The
 *  refusal here is a fast path, not the guarantee — main refuses too, and main
 *  is the side a renderer cannot skip. */
let live: CaptureHandle | null = null

export function activeCapture(): CaptureHandle | null {
  return live
}

/**
 * Float32 [-1, 1] → signed 16-bit PCM.
 *
 * ⚠ CLAMPS RATHER THAN WRAPS, and it is a deliberate twin of `toInt16` in
 * `main/services/voiceCore.ts` rather than an import. A renderer may not import
 * from `src/main/`; the alternative would be putting a hot per-sample loop into
 * the wire contract module that every process loads. Both copies clamp, both are
 * unit-tested, and the reason is the same in both: Web Audio does not guarantee
 * [-1, 1], and `x * 32768` on an overshoot flips a loud sample to the opposite
 * sign — audible as a click, and audible to a transcriber as a consonant.
 */
// ⚠ THE RETURN TYPE NAMES ITS BUFFER (`Int16Array<ArrayBuffer>`, TS 5.7+
// generic typed arrays) RATHER THAN LEAVING IT AS THE DEFAULT
// `Int16Array<ArrayBufferLike>`. `voiceFrameSchema` infers the narrow form, so
// the bare alias fails to assign into `VoiceFrame` — and the error is a type
// mismatch on a field whose runtime value is already correct, which reads as a
// puzzle rather than a bug the first time it appears.
export function toInt16(samples: Float32Array): Int16Array<ArrayBuffer> {
  const out = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]))
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff
  }
  return out
}

/**
 * ⚠ ASSERT THE HONOURED RATE, DO NOT ASSUME IT — AND FAIL LOUDLY.
 *
 * F80's retired half: `new AudioContext({ sampleRate: 16000 })` is honoured
 * EXACTLY on this machine (device native rate 48000, default context 48000), so
 * Chromium resamples for us and the VoicePlan's expectation that "resampling
 * from the device rate is the likely real work" does not hold. That is a
 * measurement of one Electron on one machine, not a guarantee. If a future
 * Electron stops honouring it, shipping 48 kHz audio to a transcriber expecting
 * 16 kHz does NOT error — it just transcribes badly, which is the failure mode
 * most likely to be blamed on the model.
 */
function assertRate(ctx: AudioContext): CaptureFailure | null {
  if (ctx.sampleRate !== VOICE_SAMPLE_RATE) {
    return {
      reason: 'sample-rate-not-honoured',
      detail: `AudioContext reports ${ctx.sampleRate} Hz; this build requires ${VOICE_SAMPLE_RATE} Hz`
    }
  }
  return null
}

/**
 * Release the device, on every exit path.
 *
 * ⚠ "ENDED" IS THE ONLY OBSERVABLE PROOF THE MICROPHONE IS ACTUALLY SHUT. The
 * source document's rule is that microphone access ends the moment recording
 * does; a `stop()` that was never reached leaves the OS recording indicator lit
 * and the device held. Called from stop, from every failure branch, and from the
 * page's own teardown — not from the happy path only, which is the thing the
 * task's review checklist says to distrust.
 */
function releaseDevice(stream: MediaStream | null): string[] {
  if (!stream) return []
  const states: string[] = []
  for (const track of stream.getTracks()) {
    track.stop()
    states.push(track.readyState)
  }
  return states
}

/**
 * A capture this renderer is in the middle of opening — either its own
 * (`startCapture`) or one main started (`adoptCapture`). Set BEFORE the first
 * await and cleared when `live` is set or the attempt fails, so the state
 * listener below cannot open a second device for a capture that is already
 * being opened: main pushes `listening` ~8 times a second while a capture is
 * live (the level meter), and every one of those would otherwise be an
 * invitation.
 */
let opening: string | null = null

export async function startCapture(): Promise<CaptureResult> {
  if (live || opening !== null) {
    return { ok: false, failure: { reason: 'already-capturing', detail: 'a capture is already live' } }
  }

  // Claimed before the handshake: main's `listening` event for OUR capture
  // arrives before the invoke below resolves, and the adopt path must know it
  // is ours.
  opening = 'own'
  let started: Awaited<ReturnType<CaptureBridge['startVoiceCapture']>>
  try {
    // ⚠ MAIN IS ASKED FIRST, BEFORE THE DEVICE IS OPENED. If main refuses (one
    // capture at a time), no microphone is ever opened — so a refused second
    // activation cannot light the recording indicator for a capture that will
    // not happen.
    started = await bridge().startVoiceCapture()
  } catch (err) {
    opening = null
    throw err
  }
  if (!started.started || !started.captureId) {
    opening = null
    return {
      ok: false,
      failure: { reason: 'refused-by-main', detail: started.refusal ?? 'main refused the capture' }
    }
  }
  return openDevice(started.captureId, started.frameSamples)
}

/**
 * ⚠ THE PUSH-TO-TALK HALF OF THE PHASE MILESTONE, AND IT WAS MISSING (F86).
 *
 * The global hotkey lives in MAIN (`uiohook`), and main's `voice.startCapture()`
 * opens the capture STATE — but only this renderer can open the MICROPHONE
 * (`getUserMedia` is a Chromium API; VoicePlan §4.1). Task 5-3 wired the
 * hotkey to main and proved the frame path from the renderer, and nothing
 * joined the two: a hotkey press showed the overlay, admitted zero frames, and
 * settled to `ready` with an empty transcript. Click-to-talk worked because it
 * starts HERE and walks the same path main's capture never reached.
 *
 * So this renderer watches main's state: a `listening` capture that it did not
 * start, and is not already opening, is main's hotkey capture — and it opens
 * the device for it, attaching to main's capture id rather than asking for a
 * new one. Everything after the handshake is the same code, on purpose.
 */
export async function adoptCapture(captureId: string): Promise<CaptureResult> {
  if (live?.captureId === captureId) return { ok: true, handle: live }
  if (live || opening !== null) {
    return { ok: false, failure: { reason: 'already-capturing', detail: 'a capture is already live' } }
  }
  opening = captureId
  return openDevice(captureId, VOICE_FRAME_SAMPLES)
}

async function openDevice(captureId: string, frameSamples: number): Promise<CaptureResult> {
  // `opening` is set by both callers and released on EVERY exit below.
  const release = (): void => {
    opening = null
  }

  // ⚠ MAIN'S FRAME SIZE IS ASSERTED AGAINST THE WORKLET'S, because the worklet
  // cannot import the constant (it has no module resolution) and therefore
  // carries its own copy. This is what turns that forced duplication into a loud
  // failure instead of a silent one.
  if (frameSamples !== VOICE_FRAME_SAMPLES) {
    release()
    await bridge().stopVoiceCapture(captureId)
    return {
      ok: false,
      failure: {
        reason: 'worklet-failed',
        detail: `main expects ${frameSamples} samples/frame; this renderer emits ${VOICE_FRAME_SAMPLES}`
      }
    }
  }

  // Task 5-4: the chosen microphone. Read per capture, so a change in Settings
  // applies to the next dictation. `ideal` rather than `exact`: a device that
  // was unplugged since it was chosen falls back to the default rather than
  // failing the dictation, and the settings page says when that is happening.
  let inputDeviceId: string | null = null
  try {
    inputDeviceId = (await bridge().getVoiceSettings()).settings.inputDeviceId
  } catch {
    // Settings unreadable is not a reason to refuse the microphone.
  }

  let stream: MediaStream | null = null
  let ctx: AudioContext | null = null
  let node: AudioWorkletNode | null = null
  let offState: (() => void) | null = null

  /** One teardown, used by every failure branch below and by `stop()`. */
  const teardown = async (): Promise<string[]> => {
    offState?.()
    offState = null
    try {
      node?.port.postMessage({ type: 'stop' })
    } catch {
      // A closed port is not a failure — the point is that the processor stops.
    }
    node?.disconnect()
    const states = releaseDevice(stream)
    if (ctx && ctx.state !== 'closed') await ctx.close()
    return states
  }

  try {
    // ⚠ AUDIO ONLY. Asking for video would request a second permission the app
    // has no use for and, under the policy installed in `index.ts`, would be
    // granted as part of `'media'` — the allow-list cannot distinguish them, so
    // the restraint has to be here.
    stream = await navigator.mediaDevices.getUserMedia({
      audio: inputDeviceId === null ? true : { deviceId: { ideal: inputDeviceId } }
    })
  } catch (err) {
    release()
    await bridge().stopVoiceCapture(captureId)
    const name = err instanceof Error ? err.name : 'unknown'
    // ⚠ THE ERROR'S MESSAGE IS NOT FORWARDED. Chromium's getUserMedia messages
    // can name the device; the NAME is a closed DOMException vocabulary and is
    // all that is needed to tell "you said no" from "there is no microphone".
    return {
      ok: false,
      failure: {
        reason: name === 'NotAllowedError' ? 'permission-denied' : name === 'NotFoundError' ? 'no-device' : 'unknown',
        detail: name
      }
    }
  }

  const deviceSampleRate =
    stream.getAudioTracks()[0]?.getSettings().sampleRate ?? 0

  try {
    ctx = new AudioContext({ sampleRate: VOICE_SAMPLE_RATE })
    const rateFailure = assertRate(ctx)
    if (rateFailure) {
      release()
      await teardown()
      await bridge().stopVoiceCapture(captureId)
      return { ok: false, failure: rateFailure }
    }

    await ctx.audioWorklet.addModule(pcmWorkletUrl)
    const source = ctx.createMediaStreamSource(stream)
    node = new AudioWorkletNode(ctx, 'pcm-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1
    })

    let seq = 0
    node.port.onmessage = (event: MessageEvent): void => {
      const samples = event.data as Float32Array
      if (!(samples instanceof Float32Array)) return
      /**
       * ⚠ BUILT FRESH, HANDED STRAIGHT ACROSS, NEVER STORED (D14). This object
       * exists for the duration of one `send` and is then garbage. It is not
       * assigned to a store, a `ref`, or a module-level array — the failure that
       * would cause has no compile-time signal.
       */
      const frame: VoiceFrame = {
        captureId,
        seq: seq++,
        sampleRate: VOICE_SAMPLE_RATE,
        sampleCount: samples.length,
        samples: toInt16(samples)
      }
      bridge().sendVoiceFrame(frame)
    }

    // ⚠ NOT CONNECTED TO `ctx.destination`. The node has zero outputs, and
    // routing microphone audio to the speakers would be a feedback loop rather
    // than a monitor. `numberOfOutputs: 0` is what keeps the graph pulling
    // without producing anything.
    source.connect(node)
  } catch (err) {
    release()
    await teardown()
    await bridge().stopVoiceCapture(captureId)
    return {
      ok: false,
      failure: {
        reason: 'worklet-failed',
        // ⚠ A `blob:` worklet fails here with a bare `AbortError` (F80). This
        // build loads a file, so an AbortError on this line means the ASSET did
        // not resolve — the packaged-build failure mode, not the CSP one.
        detail: err instanceof Error ? `${err.name}: ${err.message}` : 'unknown'
      }
    }
  }

  const handle: CaptureHandle = {
    captureId,
    sampleRate: ctx.sampleRate,
    deviceSampleRate,
    stop: async (): Promise<void> => {
      if (live?.captureId !== captureId) return
      live = null
      const states = await teardown()
      // ⚠ THE RELEASE IS ASSERTED, NOT ASSUMED. Task 5-1's runtime gate is that
      // every track reads `ended` after a stop; a track that did not is a held
      // microphone and must be visible rather than silent.
      const held = states.filter((s) => s !== 'ended')
      if (held.length > 0) {
        console.error('[voice] a track did not end after stop:', held)
      }
      await bridge().stopVoiceCapture(captureId)
    }
  }
  live = handle
  release()

  /**
   * ⚠ MAIN CAN END A CAPTURE WITHOUT THE RENDERER HAVING ASKED, AND WITHOUT THIS
   * THE DEVICE WOULD STAY OPEN. `voice.cancel()` fires on a reload, a window
   * close and 'before-quit'; today all three also destroy this page, so
   * `pagehide` happens to cover them. That is a coincidence of the current call
   * sites, not a property of the design — Task 5-3 adds cancels that come from a
   * hotkey and an overlay, with the page very much alive.
   *
   * So the renderer watches for main no longer tracking this capture and
   * releases the microphone itself. Without it, "release the device on every exit
   * path" would be true only for the paths that happen to kill the renderer,
   * which is exactly the "happy path only" release the task's review checklist
   * says to distrust.
   *
   * Our OWN stop is not affected: it sets `live = null` before tearing down, so
   * the guard below has already stopped matching by the time main's `finalizing`
   * and `ready` events arrive.
   */
  offState = bridge().onVoiceState((event) => {
    if (live?.captureId !== captureId) return
    if (event.captureId === captureId) return
    void handle.stop()
  })

  return { ok: true, handle }
}

export async function stopCapture(): Promise<void> {
  await live?.stop()
}

/**
 * ⚠ THE DEVICE MUST BE RELEASED WHEN THE PAGE GOES, TOO. A reload or a window
 * close tears down this module's JS without running any `stop()` — and the OS
 * recording indicator would stay lit on a stream nothing owns. `pagehide` fires
 * for both, where `beforeunload` is unreliable.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    void live?.stop()
  })

  /**
   * ⚠ F86: A CAPTURE MAIN STARTED (THE HOTKEY) IS ADOPTED HERE, OR NO
   * MICROPHONE EVER OPENS FOR IT. See `adoptCapture`. Guarded by `live` and
   * `opening` so our own captures, and captures already being opened, are
   * left alone — main pushes `listening` many times per second.
   *
   * ⚠ ONLY THE MAIN WINDOW IMPORTS THIS MODULE. The overlay window's bundle
   * (`overlay.ts`) never does, and must not: two windows both calling
   * `getUserMedia` would be two captures.
   */
  const chorus = (window as unknown as { chorus?: CaptureBridge }).chorus
  if (chorus) {
    chorus.onVoiceState((event) => {
      if (event.state !== 'listening' || event.captureId === null) return
      if (live !== null || opening !== null) return
      void adoptCapture(event.captureId).then((result) => {
        if (!result.ok) {
          // A name from a closed vocabulary — never a device label.
          console.warn('[voice] could not open the microphone for a hotkey capture:', result.failure.reason)
        }
      })
    })
  }
}

/**
 * ⚠ THE TEMPORARY DEV-ONLY TRIGGER, AND IT IS THE WHOLE ACTIVATION STORY IN
 * TASK 5-1. The hotkey (`uiohook-napi`), the overlay and the dictation target
 * are Task 5-3, and D76 forbids shipping a settings row or a nav entry with
 * nothing behind it — so there is deliberately NO user-facing way to start a
 * capture yet. This handle is how the task's runtime gates are driven, and it is
 * stripped from a production build by `import.meta.env.DEV`.
 *
 * Task 5-3 deletes this block and calls `startCapture` / `stopCapture` from the
 * hotkey instead.
 */
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__chorusVoice = {
    startCapture,
    stopCapture,
    activeCapture
  }
}
