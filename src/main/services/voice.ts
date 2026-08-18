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
import { concatFrames, peakWindowRms } from './whisperCore'
import {
  VOICE_QUEUE_MAX_FRAMES,
  VOICE_QUEUE_MAX_SECONDS,
  admitFrame,
  advanceQueueState,
  type QueueState
} from './voiceCore'
import { nextTarget } from './hotkeyCore'
import { describeFallback, type RefineOutcome, type RefinementMode } from './voiceRefineCore'

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
   * Write the transcript into a pane.
   *
   * ⚠ THIS IS `SessionManager.write` — THE ONE PATH EVERY OTHER WRITE TAKES,
   * injected rather than imported so this file never holds a PTY. It is called
   * EXACTLY ONCE per dictation, with NO trailing newline, ever. A trailing
   * "\r" or "\n" IS pressing Enter, and Enter in an agent pane starts an
   * autonomous process that edits files and runs commands on a sentence that may
   * have been misheard. `Plan.md` §9's no-auto-Enter default is a SAFETY RULE
   * here, not a UX preference.
   */
  readonly writeToTarget: (targetId: string, text: string) => void
  /**
   * Task 5-4: turn the ORIGINAL transcript into what gets written.
   *
   * ⚠ INJECTED, AND THE ORIGINAL IS PASSED IN AND HELD HERE REGARDLESS OF WHAT
   * COMES BACK. `voiceRefine.ts` owns the call; this file owns the rule that
   * the original is never overwritten (D161, in memory) and never lost. On ANY
   * failure — transport, timeout, refusal, empty, invention-check rejection —
   * the outcome's `text` IS the original and the user is told refinement
   * failed. Verbatim never enters the network: the refiner returns
   * synchronously-equivalent `verbatim` and no state change to `refining`
   * happens for it.
   */
  readonly refine: (req: {
    readonly original: string
    readonly mode: RefinementMode
    readonly targetSessionId: string | null
  }) => Promise<RefineOutcome>
  /** Which mode a dictation finishing NOW uses. Read at transcription time, so a
   *  settings change applies to the next dictation without a restart. */
  readonly refinementMode: () => RefinementMode
  /**
   * Is this pane still alive and writable?
   *
   * ⚠ CHECKED AT WRITE TIME, BUT THE ID IS NEVER RE-RESOLVED. The target can be
   * killed, exited, closed, or have its project archived while transcription is
   * still running. Validating is how the transcript avoids being written into a
   * dead pane; RE-RESOLVING would be how it gets written into somebody else's.
   */
  readonly targetExists: (targetId: string) => boolean
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
  /** The pane a capture started now would aim at, reported by the renderer. */
  setFocusedTarget(sessionId: string | null): void
  /** The pane wearing the ring: the live capture's target, else the focused one. */
  ringTarget(): string | null
  /** Tab, during a capture. Cycles the target among the panes given. */
  cycleTarget(targets: ReadonlyArray<string>): string | null
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
  /**
   * Task 5-4: what happened to the last dictation's text before the write.
   * A closed pair for the wire; the fallback's fixed sentence rides `message`.
   */
  let refinement: { mode: RefinementMode; outcome: 'verbatim' | 'refined' | 'fallback' } | null = null
  /**
   * The pane the renderer last reported as DOM-focused — the pane a capture
   * started RIGHT NOW would aim at. Not the target; the seed for one.
   */
  let focusedTarget: string | null = null
  /**
   * The dictation target, owned by this feature for the capture's lifetime.
   *
   * ⚠ RESOLVED ONCE, AT CAPTURE START, AND HELD. Never re-read from focus
   * mid-capture and never re-resolved at write time. Re-resolving is precisely
   * how a user's words get written into a DIFFERENT agent than the one they were
   * looking at — the worst outcome this feature can produce — because focus
   * moves while they speak into another application.
   */
  let captureTarget: string | null = null
  /** The live input level, 0..1, refreshed every other admitted frame. */
  let level = 0

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
      level,
      message: failureMessage,
      refinement
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
        // ⚠ EVERY OTHER FRAME, NOT EVERY FRAME — ~8 pushes/second at 15.6 fps,
        // and only while a capture is open. The meter is the one continuous
        // thing on this event, so it is bounded by frame count rather than by a
        // clock, which keeps the service free of one.
        if (capturedFrames % 2 === 0) {
          level = peakWindowRms(frame.samples)
          emit()
        }
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
    level = 0
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
      failureMessage = null
      logger.info(
        {
          audioSeconds: Math.round((samples.length / VOICE_SAMPLE_RATE) * 10) / 10,
          // ⚠ A LENGTH, NOT THE TEXT.
          characters: text.length
        },
        '[voice] capture transcribed'
      )
      if (text.length === 0) {
        deliver(text)
        return
      }
      /**
       * Task 5-4: `transcribed → (verbatim ? inject : refine) → inject`.
       *
       * ⚠ THE ORIGINAL IS `originalTranscript` FROM THE LINE ABOVE AND STAYS
       * THERE. `refined` is a SEPARATE value; nothing below assigns to
       * `originalTranscript`. The mode is read HERE, once, so a settings change
       * mid-refinement cannot switch the rules under a call in flight.
       *
       * ⚠ THE TARGET IS NOT RE-RESOLVED FOR THE REFINEMENT EITHER. The held id
       * is handed over for the spend row's session column and nothing else.
       */
      const mode = deps.refinementMode()
      const isNetwork = mode !== 'verbatim'
      if (isNetwork) {
        stateName = 'refining'
        emit()
      }
      let outcome: RefineOutcome
      try {
        outcome = await deps.refine({ original: text, mode, targetSessionId: captureTarget })
      } catch (err) {
        // The refiner's contract is to never throw — every failure is an
        // outcome — but a contract is not a guarantee, and a throw here would
        // otherwise cost the user their words. Original inserted, told why.
        logger.error({ mode, code: (err as { code?: string }).code ?? 'unknown' }, '[voice] refiner threw; original inserted')
        outcome = { text, refined: false, mode, fallback: 'transport', failure: null }
      }
      if (disposed) return
      // ⚠ BELT AND BRACES: whatever the refiner returned, a non-refined outcome
      // writes the ORIGINAL — never a partial, never an empty string.
      const toWrite = outcome.refined ? outcome.text : text
      refinement = {
        mode,
        outcome: outcome.refined ? 'refined' : outcome.fallback === 'verbatim' ? 'verbatim' : 'fallback'
      }
      // The user is TOLD when the original went in instead of a refinement —
      // a fixed sentence from a closed vocabulary, never a provider message,
      // never the transcript. Verbatim says nothing: it is the floor working.
      failureMessage =
        outcome.refined || outcome.fallback === null || outcome.fallback === 'verbatim'
          ? null
          : describeFallback(outcome.fallback, outcome.failure)
      deliver(toWrite)
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

  /**
   * Hand the transcript to the pane the user was looking at when they started.
   *
   * ⚠ ONE WRITE, NO NEWLINE, AND NO REDIRECTION. The three rules this function
   * exists to hold:
   *
   *  1. **Exactly one `write`.** Not chunked, not retried — a retry after a
   *     partial write would duplicate half a sentence into a live prompt.
   *  2. **No trailing "\r" or "\n".** A trailing newline IS pressing Enter, and
   *     Enter starts an autonomous process on a possibly mis-transcribed
   *     sentence. There is no flag, setting or default that turns this on.
   *  3. **The held id, validated — never re-resolved.** If the pane is gone the
   *     transcript is KEPT and surfaced for recovery; it is never written to
   *     whichever pane inherited focus. Silently redirecting a user's words into
   *     a different agent is the worst thing this feature could do, and it is
   *     the DEFAULT behaviour of any implementation that resolves the target at
   *     write time.
   */
  function deliver(text: string): void {
    const target = captureTarget
    captureTarget = null

    if (text.length === 0) {
      // Nothing was said. Not an error, and nothing to write.
      stateName = 'ready'
      emit()
      return
    }
    if (target === null || !deps.targetExists(target)) {
      // ⚠ RECOVERY, NOT LOSS. VoicePlan §7.3/§9: losing the target does not
      // cancel the capture, it moves the result to recovery. The transcript
      // stays in `originalTranscript` and the state says a transcript is held.
      // ⚠ AND NOT VIA A TOAST — toasts are proven dead on this machine
      // (ToastEnabled=0, every one failing HRESULT -2143420140).
      stateName = 'ready-for-review'
      logger.info(
        { hadTarget: target !== null, characters: text.length },
        '[voice] dictation target is gone; transcript held for recovery'
      )
      emit()
      return
    }

    try {
      // ⚠ THE PAYLOAD IS THE TRANSCRIPT VERBATIM. No newline is appended here or
      // anywhere downstream. `assertNoSubmit` is the belt to this brace.
      deps.writeToTarget(target, text)
      stateName = 'inserted'
      logger.info({ characters: text.length }, '[voice] transcript written to the dictation target')
    } catch (err) {
      // A failed write keeps the transcript rather than dropping it.
      stateName = 'ready-for-review'
      failureMessage = 'could not write to the dictation target'
      logger.error({ err }, '[voice] write to the dictation target failed; transcript held')
    }
    emit()
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

    setFocusedTarget(sessionId: string | null): void {
      focusedTarget = sessionId
      // ⚠ A FOCUS CHANGE DOES NOT MOVE A LIVE CAPTURE'S TARGET. That is the
      // whole point of holding it: the user is dictating INTO another
      // application, so focus is expected to be elsewhere.
      if (stateName === 'listening') return
      emitIfChanged()
    },

    ringTarget: (): string | null => (captureTarget !== null ? captureTarget : focusedTarget),

    cycleTarget(targets: ReadonlyArray<string>): string | null {
      // Tab is only meaningful during a capture; outside one it is an ordinary
      // Tab (see hotkey.ts, which does not even forward it).
      if (stateName !== 'listening' || captureTarget === null) return captureTarget
      captureTarget = nextTarget(targets, captureTarget)
      emit()
      return captureTarget
    },

    startCapture(): VoiceCaptureStartResponse {
      if (disposed || stateName === 'listening' || stateName === 'finalizing' || stateName === 'refining') {
        // ⚠ A REFUSAL, NOT A REPLACEMENT. See the file header: this is what makes
        // "one capture at a time" structural. `finalizing` refuses too — a
        // capture whose tail is still draining is still this capture — and so
        // does `refining` (5-4): a dictation whose text is still being refined
        // has not been written yet, and a second capture would clear the
        // original the first one is about to fall back to.
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
      // ⚠ THE TARGET IS SNAPSHOTTED HERE AND NOWHERE ELSE. From this line until
      // the write, the pane is fixed no matter where focus goes.
      captureTarget = focusedTarget
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
      refinement = null
      level = 0
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
      captureTarget = null
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
