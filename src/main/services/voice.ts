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
import { concatFrames } from './whisperCore'
import {
  VOICE_QUEUE_MAX_FRAMES,
  VOICE_QUEUE_MAX_SECONDS,
  admitFrame,
  advanceQueueState,
  type QueueState
} from './voiceCore'

/**
 * The main-side capture sink and dictation session (Tasks 5-1, 5-2).
 *
 * ⚠ 5-1 DELIBERATELY DISCARDED EVERY FRAME AFTER COUNTING IT; 5-2 REPLACED THE
 * DISCARD WITH ACCUMULATION AND TRANSCRIPTION. The discard existed so the
 * capture path, the queue bound and the backpressure signal could be proven ON
 * THEIR OWN, before a transcriber's latency was in the picture — and the seam it
 * left is why this file needed no restructuring to grow one. The microphone
 * permission boundary is still installed in `index.ts` rather than here, so
 * deleting this feature cannot delete the policy.
 *
 * ⚠ TWO BOUNDS, FOR TWO DIFFERENT FAILURES. The QUEUE bound survives a stalled
 * consumer (`queue-full`); the CAPTURE bound stops a person talking indefinitely
 * from growing memory (`capture-full`). Both are 120 s, and they are counted
 * separately because conflating them would report someone speaking as a
 * performance fault.
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
   * Turn a finished capture's audio into text.
   *
   * ⚠ INJECTED, SO THIS FILE NEVER TOUCHES A CHILD PROCESS OR THE FILESYSTEM.
   * `whisper.ts` owns the engine; this owns the session. It also means every
   * transcription outcome below — success, empty, and each typed failure — is
   * drivable in `voice.test.ts` with no binary and no model present.
   */
  readonly transcribe: (samples: Int16Array) => Promise<{ text: string }>
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
  /**
   * The transcript of the last completed capture, or null.
   *
   * ⚠ THE ORIGINAL, AND IT IS NEVER OVERWRITTEN BY A LATER REFINEMENT. That is
   * the source document's clearest rule and D161 keeps it — enforced in memory
   * for the life of a dictation rather than in SQLite, because Phase 5 v1 takes
   * no migration. Task 5-4's Clean up / Organize modes produce SEPARATE strings
   * beside this one; whatever they do, this is what the user actually said.
   *
   * ⚠ IT DOES NOT CROSS THE IPC BRIDGE IN TASK 5-2 — the transcript stops in
   * main, by this task's own non-goal. Task 5-3 reads it here and writes it to
   * the dictation target.
   */
  transcript(): string | null
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
  /**
   * Task 5-2: the capture's audio, in arrival order, awaiting transcription.
   *
   * ⚠ SEPARATE FROM `pending`, WHICH IS THE QUEUE. `pending` holds frames the
   * consumer has not taken yet and is bounded by `VOICE_QUEUE_MAX_FRAMES` to
   * survive a STALLED consumer. This holds frames the consumer HAS taken, and
   * needs its own bound for a different reason: a healthy consumer keeps up
   * perfectly while a person keeps talking, and nothing in the queue policy stops
   * that growing for as long as they do.
   */
  let captured: Int16Array[] = []
  let capturedFrames = 0
  /** The original transcript of the last completed capture. Never overwritten. */
  let originalTranscript: string | null = null

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
      // ⚠ A COUNT, NEVER THE TEXT. The transcript does not cross the bridge in
      // this task; see the field's note in `shared/ipc.ts`.
      transcriptChars: originalTranscript?.length ?? 0,
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
        /**
         * ⚠ TASK 5-2 REPLACED 5-1's DISCARD WITH THIS, AND THE BOUND IS NEW
         * RATHER THAN INHERITED. `VOICE_QUEUE_MAX_FRAMES` bounds the QUEUE, which
         * protects against a STALLED consumer. A healthy consumer keeps up
         * perfectly while a person keeps talking, so the accumulated audio needs
         * its own ceiling — otherwise a forgotten hotkey grows memory for as long
         * as the room is noisy.
         *
         * The bound is the same 120 s, and the drop reason is deliberately
         * DIFFERENT: `capture-full` says the speaker went past the limit, where
         * `queue-full` says the machine did. Conflating them would report a
         * person talking as a performance fault.
         */
        if (capturedFrames >= VOICE_QUEUE_MAX_FRAMES) {
          recordDrop('capture-full')
          continue
        }
        captured.push(frame.samples)
        capturedFrames += 1
      }
    }
    // Finalizing exists to let the queue empty after a stop. Once it has, the
    // capture's audio is complete and transcription can begin.
    if (stateName === 'finalizing' && pending.length === 0) {
      void finishCapture()
    }
  }

  /**
   * The capture is over and its audio is complete: transcribe it.
   *
   * ⚠ CONCATENATED ONCE, AT THE END. Growing a buffer per frame is O(n^2)
   * copying across a two-minute, 1,875-frame capture, and the spec names a
   * `Buffer.concat` inside the frame loop as something a reviewer should
   * distrust. `concatFrames` sums the lengths first and copies once.
   *
   * ⚠ NEVER THROWS INTO ITS CALLER. It is reached from `drain`, which runs on a
   * scheduled callback with nobody to catch — an unhandled rejection here would
   * be a process-level error raised by an ordinary dictation. Every failure ends
   * as the `failed` state with a sanitized message instead.
   */
  async function finishCapture(): Promise<void> {
    const samples = concatFrames(captured)
    captured = []
    capturedFrames = 0
    queue = { captureId: null, queued: 0, nextSeq: 0 }

    if (samples.length === 0) {
      // Nothing was captured at all — a tap, not a dictation. That is a state,
      // not an error, and it must not produce an error dialog.
      originalTranscript = ''
      stateName = 'ready'
      emit()
      return
    }

    try {
      const { text } = await deps.transcribe(samples)
      if (disposed) return
      // ⚠ THE ORIGINAL, WRITTEN ONCE. D161's rule, enforced in memory: whatever
      // 5-4's refinement modes later produce, they produce it BESIDE this, never
      // over it.
      originalTranscript = text
      stateName = 'ready-for-review'
      failureMessage = null
      logger.info(
        {
          audioSeconds: Math.round((samples.length / VOICE_SAMPLE_RATE) * 10) / 10,
          // ⚠ A LENGTH, NOT THE TEXT.
          characters: text.length
        },
        '[voice] capture transcribed'
      )
      emit()
    } catch (err) {
      if (disposed) return
      stateName = 'failed'
      // ⚠ THE MESSAGE IS THE TYPED ERROR'S OWN SANITIZED TEXT, WHICH BY
      // CONSTRUCTION CARRIES NO TRANSCRIPT AND NO CHILD OUTPUT (see
      // `WhisperError`). An `err.message` from an arbitrary throw would not have
      // that guarantee, so an unknown error is reported generically.
      failureMessage =
        err instanceof Error && err.name === 'WhisperError'
          ? err.message
          : 'transcription failed'
      originalTranscript = null
      logger.error(
        { code: (err as { code?: string }).code ?? 'unknown' },
        '[voice] transcription failed'
      )
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
    transcript: (): string | null => originalTranscript,

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
      // Task 5-2: a new dictation starts from nothing. The PREVIOUS transcript is
      // dropped here rather than at stop, so it stays readable until the moment a
      // replacement is actually being produced.
      captured = []
      capturedFrames = 0
      originalTranscript = null
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
      // A cancelled capture's audio is not wanted, and must not survive to be
      // transcribed by the next drain.
      captured = []
      capturedFrames = 0
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
      captured = []
      capturedFrames = 0
      originalTranscript = null
      queue = { captureId: null, queued: 0, nextSeq: 0 }
      stateName = 'ready'
      lastSignature = ''
      listeners.clear()
    }
  }
}
