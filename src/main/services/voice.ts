import { logger } from './logger'
import {
  VOICE_FRAME_SAMPLES,
  VOICE_SAMPLE_RATE,
  type VoiceCaptureStartResponse,
  type VoiceCaptureStopResponse,
  type VoiceDropReason,
  type VoiceFrame,
  type VoiceStateEvent,
  type VoiceStateName
} from '../../shared/ipc'
import {
  VOICE_QUEUE_MAX_FRAMES,
  VOICE_QUEUE_MAX_SECONDS,
  admitFrame,
  advanceQueueState,
  type QueueState
} from './voiceCore'

/**
 * The main-side capture sink (Task 5-1).
 *
 * ⚠ THIS TASK DELIBERATELY DISCARDS EVERY FRAME AFTER COUNTING IT.
 * The sink exists so the capture path, the queue bound and the backpressure
 * signal can be proven ON THEIR OWN, before a transcriber's latency is in the
 * picture. Task 5-2 replaces the discard with the WAV assembly by injecting a
 * real `consumeFrame`; nothing else here has to change for it. Reverting this
 * commit removes the microphone permission boundary too, which is why the two
 * ship together — and why the boundary is installed in `index.ts` rather than
 * here, so deleting the feature cannot delete the policy.
 *
 * ⚠ ONE CAPTURE AT A TIME, AND THE REFUSAL IS THE MECHANISM. `startCapture`
 * while a capture is live REFUSES; it does not queue and does not silently
 * replace. VoicePlan §7.2 requires overlapping activations to be structurally
 * impossible, and a refusal at the single owner is what makes it structural
 * rather than a guard every future caller has to remember.
 *
 * ⚠ NO AUDIO AND NO TRANSCRIPT REACHES A LOG, AT ANY LEVEL. Every log line in
 * this file carries counts, a state token, and a drop reason from a closed enum.
 * The device label Electron hands out (F79 recorded it) is never read here and
 * never forwarded. This is the phase's purity contract, and it has its own grep
 * in the task's verification list.
 */

export type VoiceStateListener = (event: VoiceStateEvent) => void

export interface VoiceServiceDeps {
  /**
   * Mint a capture id. Injected rather than calling `randomUUID` here so tests
   * are deterministic — the same reason every other service in this directory
   * takes its effects as parameters.
   */
  readonly newCaptureId: () => string
  /**
   * Consume one admitted frame.
   *
   * ⚠ TASK 5-1 INJECTS A DISCARD, AND THE SEAM IS THE POINT. The samples are
   * handed over and dropped; 5-2 will assemble a WAV here. Keeping it injected
   * means the queue policy above is proven against a consumer whose speed the
   * test controls, which is the only way to demonstrate the bound at all.
   */
  readonly consumeFrame: (captureId: string, seq: number, samples: Int16Array) => void
  /**
   * Schedule the drain.
   *
   * ⚠ INJECTED SO THE QUEUE IS REAL RATHER THAN NOTIONAL. With a synchronous
   * consumer the queue would never hold more than one frame and the bound could
   * never be observed. Production passes `queueMicrotask`; tests pass a manual
   * pump; the backpressure runtime gate passes one that never runs, which is how
   * a stalled consumer is simulated without faking the queue itself.
   */
  readonly scheduleDrain: (run: () => void) => void
}

export interface VoiceService {
  startCapture(): VoiceCaptureStartResponse
  /**
   * A frame arrived and parsed. Never throws — see `admitFrame`'s contract.
   * Returns the outcome so `ipc.ts` and the tests can assert on it without
   * reading private state.
   */
  acceptFrame(frame: VoiceFrame): { admitted: boolean; reason: VoiceDropReason | null }
  /**
   * A frame arrived and did NOT parse. Counted rather than thrown, because
   * `voice:capture-frame` is send-shaped: there is no reply an error could
   * travel on, and a throw in `ipcMain.on` becomes a process warning raised by
   * ordinary speech.
   */
  noteMalformedFrame(): void
  stopCapture(captureId: string): VoiceCaptureStopResponse
  /** Abandon whatever is live — window close, app quit, renderer reload. */
  cancel(reason: string): void
  state(): VoiceStateEvent
  onState(listener: VoiceStateListener): () => void
  dispose(): void
}

export function createVoiceService(deps: VoiceServiceDeps): VoiceService {
  const listeners = new Set<VoiceStateListener>()

  let stateName: VoiceStateName = 'ready'
  let queue: QueueState = { captureId: null, queued: 0, nextSeq: 0 }
  /**
   * The frames themselves, held separately from `QueueState`.
   *
   * ⚠ `QueueState.queued` AND `pending.length` MUST NOT BE ALLOWED TO DISAGREE —
   * the first is what the pure policy decides against, the second is what
   * actually occupies memory. They are updated together in `enqueue` and
   * `drain`, and `assertQueueInvariant` is what catches a future edit that
   * forgets one of the two.
   */
  let pending: Array<{ seq: number; samples: Int16Array }> = []
  let framesAdmitted = 0
  let framesDropped = 0
  let lastDropReason: VoiceDropReason | null = null
  /** Set the moment a frame is dropped for a full queue, cleared on the next
   *  start. This is the flag `keepingUp` is derived from. */
  let fellBehind = false
  /** The signature of the last event actually sent, for the edge trigger. */
  let lastSignature = ''
  let failureMessage: string | null = null
  let draining = false
  let disposed = false

  const keepingUp = (): boolean => !fellBehind

  function snapshot(): VoiceStateEvent {
    return {
      state: stateName,
      captureId: queue.captureId,
      framesAdmitted,
      framesDropped,
      queued: pending.length,
      queueMax: VOICE_QUEUE_MAX_FRAMES,
      lastDropReason,
      keepingUp: keepingUp(),
      message: failureMessage
    }
  }

  function emit(): void {
    if (disposed) return
    const event = snapshot()
    lastSignature = signature()
    for (const listener of listeners) {
      try {
        listener(event)
      } catch (err) {
        // One bad listener must not stop the others, and must never take down
        // the `ipcMain.on` callback that led here. The house pattern, same as
        // `contextUsage.record`.
        logger.error({ err }, '[voice] state listener threw')
      }
    }
  }

  /**
   * What makes a state event WORTH SENDING. Counters are deliberately excluded.
   */
  function signature(): string {
    return `${stateName}|${keepingUp()}|${lastDropReason}`
  }

  /**
   * ⚠ EDGE-TRIGGERED, AND A MEASUREMENT PUT IT HERE. Emitting on every drop is
   * fine at the 15.6 frames/second a worklet produces, but the drop path is not
   * rate-limited by anything main controls: driving the backpressure gate with a
   * stalled sink and 100,000 frames produced 97,500 state events, each one a Zod
   * parse plus an IPC send to every window, to describe a counter that had
   * already said "not keeping up".
   *
   * So this follows the same rule `session:activity` and `session:context`
   * already do — fire only on a REAL change. The first drop of a run is news
   * (`keepingUp` flips, or the reason changes); the ten thousandth identical one
   * is not.
   *
   * ⚠ THE RUNNING COUNTS THEREFORE GO STALE DURING A LONG STALL, AND THAT IS THE
   * ACCEPTED TRADE. Nothing is lost: `voice:capture-stop` answers with the final
   * `framesAdmitted` / `framesDropped`, and every transition re-sends the totals.
   * What the renderer needs live is "audio is being lost", which arrives on the
   * first drop.
   */
  function emitIfChanged(): void {
    if (disposed) return
    if (signature() === lastSignature) return
    emit()
  }

  function assertQueueInvariant(where: string): void {
    if (queue.queued !== pending.length) {
      // Not a throw: this is a diagnostic for a bug that would otherwise show up
      // as a bound that engages at the wrong depth, which is very hard to read
      // backwards from. The counts are resynced to the frames that actually
      // exist, because memory is the thing the bound is protecting.
      logger.error(
        { where, policyQueued: queue.queued, actualQueued: pending.length },
        '[voice] queue accounting drifted; resyncing to the real frame count'
      )
      queue = { ...queue, queued: pending.length }
    }
  }

  function drain(): void {
    draining = false
    if (disposed) return
    // Everything queued, in arrival order. A single pass rather than one frame
    // per scheduled callback: the consumer is synchronous by contract, and N
    // callbacks for N frames would be pure scheduler overhead.
    //
    // The id is read BEFORE the counters are reset, so the frames are attributed
    // to the capture that produced them rather than to whatever the queue says
    // afterwards. A null id here means `cancel` ran, and `cancel` empties
    // `pending` — so the loop below has nothing to attribute and does not run.
    const captureId = queue.captureId
    const batch = pending
    pending = []
    queue = { ...queue, queued: 0 }
    if (captureId !== null) {
      for (const frame of batch) {
        try {
          deps.consumeFrame(captureId, frame.seq, frame.samples)
        } catch (err) {
          // A consumer failure is the consumer's problem, not a reason to lose
          // the capture. 5-2's WAV assembly will have its own error path; losing
          // one frame is strictly better than unwinding a dictation.
          logger.error({ err }, '[voice] frame consumer threw; frame discarded')
        }
      }
    }
    // Finalizing exists to let the queue empty after a stop. Once it has, the
    // capture is genuinely over.
    if (stateName === 'finalizing' && pending.length === 0) {
      stateName = 'ready'
      queue = { captureId: null, queued: 0, nextSeq: 0 }
      emit()
    }
  }

  function scheduleDrain(): void {
    if (draining || disposed) return
    draining = true
    deps.scheduleDrain(drain)
  }

  function recordDrop(reason: VoiceDropReason): void {
    framesDropped += 1
    lastDropReason = reason
    if (reason === 'queue-full') fellBehind = true
  }

  return {
    startCapture(): VoiceCaptureStartResponse {
      if (disposed || stateName === 'listening' || stateName === 'finalizing') {
        // ⚠ A REFUSAL, NOT A REPLACEMENT. See the file header: this is what makes
        // "one capture at a time" structural. `finalizing` refuses too — a
        // capture whose tail is still draining is still this capture.
        logger.info({ state: stateName }, '[voice] capture start refused; one is already live')
        return {
          started: false,
          captureId: null,
          sampleRate: VOICE_SAMPLE_RATE,
          frameSamples: VOICE_FRAME_SAMPLES,
          refusal: 'already-capturing'
        }
      }
      const captureId = deps.newCaptureId()
      stateName = 'listening'
      queue = { captureId, queued: 0, nextSeq: 0 }
      pending = []
      framesAdmitted = 0
      framesDropped = 0
      lastDropReason = null
      fellBehind = false
      failureMessage = null
      logger.info(
        { sampleRate: VOICE_SAMPLE_RATE, frameSamples: VOICE_FRAME_SAMPLES, queueMax: VOICE_QUEUE_MAX_FRAMES, queueSeconds: VOICE_QUEUE_MAX_SECONDS },
        '[voice] capture started'
      )
      emit()
      return {
        started: true,
        captureId,
        sampleRate: VOICE_SAMPLE_RATE,
        frameSamples: VOICE_FRAME_SAMPLES,
        refusal: null
      }
    },

    acceptFrame(frame: VoiceFrame): { admitted: boolean; reason: VoiceDropReason | null } {
      if (disposed) return { admitted: false, reason: 'stale-session' }
      assertQueueInvariant('acceptFrame')
      const result = admitFrame(queue, frame)
      const nextQueue = advanceQueueState(queue, frame, result)
      if (result.admit) {
        // ⚠ THE ARRAY IS PUSHED AND THE POLICY STATE IS SET FROM THE PURE
        // TRANSITION IN THE SAME BREATH, so the two can only drift if someone
        // edits one of these two lines without the other.
        pending.push({ seq: frame.seq, samples: frame.samples })
        queue = nextQueue
        framesAdmitted += 1
        scheduleDrain()
        // No emit per admitted frame: at ~16 frames/second that is 16 IPC
        // messages a second describing a counter. The state is pushed on
        // transitions and on drops, and the renderer can read it cold.
        return { admitted: true, reason: null }
      }
      queue = nextQueue
      recordDrop(result.reason)
      // ⚠ DROPS ARE SURFACED RATHER THAN SWALLOWED — the acceptance criterion —
      // but on the EDGE rather than per frame. See `emitIfChanged`: the first
      // drop of a run is news, the ten thousandth identical one is 97,500 IPC
      // messages saying what the first already said.
      emitIfChanged()
      return { admitted: false, reason: result.reason }
    },

    noteMalformedFrame(): void {
      if (disposed) return
      recordDrop('malformed')
      // Edge-triggered for the same reason drops are: a producer sending garbage
      // sends it at its own rate, not at ours.
      emitIfChanged()
    },

    stopCapture(captureId: string): VoiceCaptureStopResponse {
      if (queue.captureId === null || queue.captureId !== captureId) {
        // Idempotent, and a stop for a capture that is already over is a STATE
        // rather than an error: the renderer's own teardown races the window
        // close and the app quit, and all three legitimately call this.
        return { stopped: false, framesAdmitted, framesDropped }
      }
      stateName = 'finalizing'
      logger.info({ framesAdmitted, framesDropped, queued: pending.length }, '[voice] capture stopping')
      emit()
      // Drain what is left, then settle to `ready`. Scheduled rather than run
      // inline so a stop cannot reenter the consumer from inside an IPC handler.
      scheduleDrain()
      return { stopped: true, framesAdmitted, framesDropped }
    },

    cancel(reason: string): void {
      if (queue.captureId === null && stateName === 'ready') return
      logger.info({ reason, framesAdmitted, framesDropped }, '[voice] capture cancelled')
      pending = []
      queue = { captureId: null, queued: 0, nextSeq: 0 }
      stateName = 'ready'
      emit()
    },

    state(): VoiceStateEvent {
      return snapshot()
    },

    onState(listener: VoiceStateListener): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    dispose(): void {
      disposed = true
      pending = []
      queue = { captureId: null, queued: 0, nextSeq: 0 }
      stateName = 'ready'
      lastSignature = ''
      listeners.clear()
    }
  }
}
