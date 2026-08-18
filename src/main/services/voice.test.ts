import { describe, it, expect, vi } from 'vitest'
import { createVoiceService, type VoiceService } from './voice'
import { VOICE_QUEUE_MAX_FRAMES } from './voiceCore'
import { VOICE_FRAME_SAMPLES, VOICE_SAMPLE_RATE, type VoiceFrame, type VoiceStateEvent } from '../../shared/ipc'

/**
 * Every effect is injected, so nothing here touches a clock, a window, a
 * database or `randomUUID`. The drain is a MANUAL PUMP — which is the whole
 * reason the queue can be observed holding frames at all.
 */
function harness(
  opts: {
    autoDrain?: boolean
    /** What the injected transcriber returns, or throws. */
    text?: string
    transcribeError?: Error
    /** Panes that exist. Anything else reads as a dead target. */
    livePanes?: string[]
    writeThrows?: boolean
  } = {}
) {
  const autoDrain = opts.autoDrain ?? true
  let nextId = 0
  const ids: string[] = []
  const states: VoiceStateEvent[] = []
  /** Every batch of samples handed to the transcriber — Task 5-2's real seam,
   *  and the only place a completed capture's audio becomes observable. */
  const transcribed: Int16Array[] = []
  /** Every write to a pane — Task 5-3's safety surface. */
  const writes: Array<{ targetId: string; text: string }> = []
  const live = new Set(opts.livePanes ?? ['pane-1', 'pane-2', 'pane-3'])
  let pendingDrain: (() => void) | null = null

  const service: VoiceService = createVoiceService({
    newCaptureId: () => {
      // Deterministic, and shaped as a real uuid so the wire schemas accept it.
      const id = `00000000-0000-4000-8000-00000000000${++nextId}`
      ids.push(id)
      return id
    },
    transcribe: async (samples) => {
      transcribed.push(samples)
      if (opts.transcribeError) throw opts.transcribeError
      return { text: opts.text ?? 'refactor the parser please' }
    },
    writeToTarget: (targetId, text) => {
      if (opts.writeThrows) throw new Error('pty is gone')
      writes.push({ targetId, text })
    },
    targetExists: (id) => live.has(id),
    scheduleDrain: (run) => {
      if (autoDrain) run()
      else pendingDrain = run
    }
  })
  service.onState((e) => states.push(e))

  return {
    service,
    ids,
    states,
    transcribed,
    writes,
    live,
    /** Frames' worth of audio the transcriber was given, for the frame-count
     *  assertions that used to read the per-frame consumer. */
    transcribedFrames: (): number =>
      transcribed.reduce((n, s) => n + s.length / VOICE_FRAME_SAMPLES, 0),
    /** Run the one drain the service scheduled, if any. */
    pump(): void {
      const run = pendingDrain
      pendingDrain = null
      run?.()
    },
    /** Let the async transcription settle. `finishCapture` is awaited inside the
     *  service but reached from a scheduled drain, so tests must yield. */
    settle: (): Promise<void> => new Promise((r) => setTimeout(r, 0)),
    hasPendingDrain: (): boolean => pendingDrain !== null
  }
}

/** Widened from the schema's literal for the reason `voiceCore.test.ts` gives:
 *  `VoiceFrame` infers `sampleRate: 16000`, so a wrong-rate frame cannot be
 *  constructed in this app's types — and must still be refused at runtime. */
type FrameOverride = Partial<Omit<VoiceFrame, 'sampleRate'>> & { sampleRate?: number }

function frame(captureId: string, seq: number, over: FrameOverride = {}): VoiceFrame {
  const sampleCount = over.sampleCount ?? VOICE_FRAME_SAMPLES
  return {
    captureId,
    seq,
    sampleRate: VOICE_SAMPLE_RATE,
    sampleCount,
    samples: new Int16Array(sampleCount),
    ...over
  } as VoiceFrame
}

describe('voice service — start and the single owner (VoicePlan §7.2)', () => {
  it('starts ready and reports the bound it will apply', () => {
    const h = harness()
    expect(h.service.state().state).toBe('ready')
    expect(h.service.state().captureId).toBeNull()
    expect(h.service.state().queueMax).toBe(VOICE_QUEUE_MAX_FRAMES)
    expect(h.service.state().keepingUp).toBe(true)
  })

  it('mints a capture id and echoes the rate and frame size main expects', () => {
    const h = harness()
    const res = h.service.startCapture()
    expect(res.started).toBe(true)
    expect(res.captureId).toBe(h.ids[0])
    expect(res.sampleRate).toBe(VOICE_SAMPLE_RATE)
    expect(res.frameSamples).toBe(VOICE_FRAME_SAMPLES)
    expect(res.refusal).toBeNull()
    expect(h.service.state().state).toBe('listening')
  })

  it('REFUSES a second concurrent capture rather than queueing or replacing it', () => {
    const h = harness()
    const first = h.service.startCapture()
    const second = h.service.startCapture()
    expect(second.started).toBe(false)
    expect(second.captureId).toBeNull()
    expect(second.refusal).toBe('already-capturing')
    // The refusal must not disturb the live capture in any way.
    expect(h.service.state().captureId).toBe(first.captureId)
    expect(h.service.state().state).toBe('listening')
    // And no second id was minted.
    expect(h.ids).toHaveLength(1)
  })

  it('refuses while a stopped capture is still finalizing', () => {
    // A capture whose tail is still draining is still THIS capture.
    const h = harness({ autoDrain: false })
    const first = h.service.startCapture()
    h.service.acceptFrame(frame(first.captureId!, 0))
    h.service.stopCapture(first.captureId!)
    expect(h.service.state().state).toBe('finalizing')
    expect(h.service.startCapture().refusal).toBe('already-capturing')
  })

  it('allows a fresh capture once the previous one has fully finalized', async () => {
    const h = harness({ autoDrain: false })
    const first = h.service.startCapture()
    h.service.acceptFrame(frame(first.captureId!, 0))
    h.service.stopCapture(first.captureId!)
    h.pump()
    await h.settle()
    // Task 5-2: a capture that produced audio ends at ready-for-review,
    // holding its transcript, and a fresh capture is allowed from there.
    expect(h.service.state().state).toBe('ready-for-review')
    const second = h.service.startCapture()
    expect(second.started).toBe(true)
    expect(second.captureId).not.toBe(first.captureId)
  })

  it('resets the accounting on a new capture so the previous one cannot bleed in', async () => {
    const h = harness()
    const first = h.service.startCapture()
    h.service.acceptFrame(frame(first.captureId!, 0))
    h.service.acceptFrame(frame(first.captureId!, 99)) // dropped: bad sequence
    h.service.stopCapture(first.captureId!)
    await h.settle()
    const second = h.service.startCapture()
    expect(second.started).toBe(true)
    expect(h.service.state().framesAdmitted).toBe(0)
    expect(h.service.state().framesDropped).toBe(0)
    expect(h.service.state().lastDropReason).toBeNull()
    expect(h.service.state().keepingUp).toBe(true)
    // ...and the PREVIOUS transcript is gone rather than lingering under a
    // new capture that has not produced one yet.
    expect(h.service.transcript()).toBeNull()
    expect(h.service.state().transcriptChars).toBe(0)
  })
})

describe('voice service — frame accounting', () => {
  it('admits a run of frames and hands every one of them to the transcriber', async () => {
    const h = harness()
    const id = h.service.startCapture().captureId!
    for (let i = 0; i < 40; i++) {
      expect(h.service.acceptFrame(frame(id, i))).toEqual({ admitted: true, reason: null })
    }
    expect(h.service.state().framesAdmitted).toBe(40)
    expect(h.service.state().framesDropped).toBe(0)
    h.service.stopCapture(id)
    await h.settle()
    // ⚠ ONE CALL WITH ONE BUFFER, NOT 40 CALLS. Task 5-2 concatenates once at the
    // end; a per-frame hand-off would be the O(n^2) copying the spec warns about.
    expect(h.transcribed).toHaveLength(1)
    expect(h.transcribed[0].length).toBe(40 * VOICE_FRAME_SAMPLES)
  })

  it('accounts for EVERY frame as admitted or dropped — none is ever lost', () => {
    // The round-trip the task's test expectations ask for: N in, N accounted for.
    const h = harness()
    const id = h.service.startCapture().captureId!
    const sent: VoiceFrame[] = [
      frame(id, 0),
      frame(id, 1),
      frame(id, 99), // bad sequence
      { ...frame(id, 2), sampleCount: 512 }, // length mismatch
      frame(id, 2, { sampleRate: 48_000 }), // bad rate
      frame('00000000-0000-4000-8000-0000000000ff', 2), // stale
      frame(id, 2)
    ]
    let admitted = 0
    let dropped = 0
    for (const f of sent) {
      const r = h.service.acceptFrame(f)
      r.admitted ? admitted++ : dropped++
    }
    expect(admitted + dropped).toBe(sent.length)
    expect(h.service.state().framesAdmitted).toBe(admitted)
    expect(h.service.state().framesDropped).toBe(dropped)
    expect(h.service.state().framesAdmitted + h.service.state().framesDropped).toBe(sent.length)
  })

  it('counts a malformed frame that never parsed, and names it as such', () => {
    const h = harness()
    h.service.startCapture()
    h.service.noteMalformedFrame()
    expect(h.service.state().framesDropped).toBe(1)
    expect(h.service.state().lastDropReason).toBe('malformed')
    // A payload that could not be read is not evidence the consumer is slow.
    expect(h.service.state().keepingUp).toBe(true)
  })

  it('drops frames arriving with no capture open', () => {
    const h = harness()
    const r = h.service.acceptFrame(frame('00000000-0000-4000-8000-000000000001', 0))
    expect(r).toEqual({ admitted: false, reason: 'stale-session' })
  })

  it('emits at the METER cadence, not once per admitted frame', () => {
    // ⚠ TASK 5-3 CHANGED THIS DELIBERATELY. 5-1 asserted ZERO events during a
    // healthy capture, because the state event was fully edge-triggered. The
    // overlay needs a live input level, and a VU meter is inherently continuous
    // — it cannot ride "fire only on a real change".
    //
    // The compromise is a cadence bounded by FRAME COUNT rather than by a clock:
    // every other admitted frame, i.e. ~8 pushes/second at 15.6 fps, and only
    // while a capture is open. Still an order of magnitude below one-per-frame,
    // and exactly zero when idle.
    const h = harness()
    const id = h.service.startCapture().captureId!
    const afterStart = h.states.length
    for (let i = 0; i < 30; i++) h.service.acceptFrame(frame(id, i))
    expect(h.states.length - afterStart).toBe(15)
  })

  it('the level is a NUMBER derived from the audio, never the audio', () => {
    const h = harness()
    const id = h.service.startCapture().captureId!
    // Silence reads as zero; the field is bounded to 0..1 by the schema.
    h.service.acceptFrame(frame(id, 0))
    h.service.acceptFrame(frame(id, 1))
    const lvl = h.service.state().level
    expect(typeof lvl).toBe('number')
    expect(lvl).toBeGreaterThanOrEqual(0)
    expect(lvl).toBeLessThanOrEqual(1)
  })

  it('the level resets to zero between captures', () => {
    const h = harness()
    const id = h.service.startCapture().captureId!
    h.service.acceptFrame(frame(id, 0))
    h.service.acceptFrame(frame(id, 1))
    h.service.cancel('reload')
    h.service.startCapture()
    expect(h.service.state().level).toBe(0)
  })
})

describe('voice service — the bound and the backpressure signal', () => {
  it('bounds the queue at VOICE_QUEUE_MAX_FRAMES with the consumer stalled', () => {
    const h = harness({ autoDrain: false })
    const id = h.service.startCapture().captureId!
    for (let i = 0; i < VOICE_QUEUE_MAX_FRAMES + 500; i++) h.service.acceptFrame(frame(id, i))

    // ⚠ THE MEMORY CLAIM, ASSERTED: the queue holds the bound and NOT the 500
    // extra frames. This is the unit-test half of the runtime gate that watches
    // memory stay flat while dropping.
    expect(h.service.state().queued).toBe(VOICE_QUEUE_MAX_FRAMES)
    expect(h.service.state().framesAdmitted).toBe(VOICE_QUEUE_MAX_FRAMES)
    expect(h.service.state().framesDropped).toBe(500)
  })

  it('SURFACES the drop rather than swallowing it', () => {
    const h = harness({ autoDrain: false })
    const id = h.service.startCapture().captureId!
    for (let i = 0; i < VOICE_QUEUE_MAX_FRAMES; i++) h.service.acceptFrame(frame(id, i))
    expect(h.service.state().keepingUp).toBe(true)

    const before = h.states.length
    h.service.acceptFrame(frame(id, VOICE_QUEUE_MAX_FRAMES))
    // A state event fired, and it says the sink stopped keeping up.
    expect(h.states.length).toBeGreaterThan(before)
    const last = h.states[h.states.length - 1]
    expect(last.keepingUp).toBe(false)
    expect(last.lastDropReason).toBe('queue-full')
    expect(last.queued).toBe(VOICE_QUEUE_MAX_FRAMES)
    expect(last.queueMax).toBe(VOICE_QUEUE_MAX_FRAMES)
  })

  it('keeps reporting queue-full while stalled, never degrading to bad-sequence', () => {
    // The failure this guards is subtle: if the sequence expectation did not
    // advance on a queue-full drop, every subsequent frame would be refused as a
    // malformed producer and the diagnosis would invert.
    const h = harness({ autoDrain: false })
    const id = h.service.startCapture().captureId!
    const reasons: Array<string | null> = []
    for (let i = 0; i < VOICE_QUEUE_MAX_FRAMES + 200; i++) {
      const r = h.service.acceptFrame(frame(id, i))
      if (!r.admitted) reasons.push(r.reason)
    }
    expect(reasons).toHaveLength(200)
    expect(new Set(reasons)).toEqual(new Set(['queue-full']))
  })

  it('emits ONCE for a sustained stall, not once per dropped frame', () => {
    // ⚠ A MEASUREMENT PUT THIS TEST HERE. Driving the backpressure gate against
    // the real process with a stalled sink and 100,000 frames produced 97,500
    // state events — one Zod parse plus an IPC send to every window per frame,
    // all repeating what the first one already said. The drop path is not
    // rate-limited by anything main controls, so the emit has to be
    // edge-triggered, exactly as `session:activity` and `session:context` are.
    const h = harness({ autoDrain: false })
    const id = h.service.startCapture().captureId!
    for (let i = 0; i < VOICE_QUEUE_MAX_FRAMES; i++) h.service.acceptFrame(frame(id, i))
    const before = h.states.length

    for (let i = 0; i < 5000; i++) {
      h.service.acceptFrame(frame(id, VOICE_QUEUE_MAX_FRAMES + i))
    }

    // Exactly one event for five thousand identical drops.
    expect(h.states.length - before).toBe(1)
    expect(h.states[h.states.length - 1].keepingUp).toBe(false)
    expect(h.states[h.states.length - 1].lastDropReason).toBe('queue-full')
    // The COUNT is still exact in main, it is simply not re-broadcast.
    expect(h.service.state().framesDropped).toBe(5000)
  })

  it('emits again when the drop REASON changes, because that is new information', () => {
    const h = harness({ autoDrain: false })
    const id = h.service.startCapture().captureId!
    for (let i = 0; i < VOICE_QUEUE_MAX_FRAMES + 3; i++) h.service.acceptFrame(frame(id, i))
    const afterQueueFull = h.states.length
    // A different fault is a different diagnosis and must reach the renderer.
    h.service.noteMalformedFrame()
    expect(h.states.length).toBe(afterQueueFull + 1)
    expect(h.states[h.states.length - 1].lastDropReason).toBe('malformed')
  })

  it('still reports the exact totals on stop after a stall', () => {
    // What makes the staleness above acceptable: the totals are never lost.
    const h = harness({ autoDrain: false })
    const id = h.service.startCapture().captureId!
    for (let i = 0; i < VOICE_QUEUE_MAX_FRAMES + 250; i++) h.service.acceptFrame(frame(id, i))
    expect(h.service.stopCapture(id)).toEqual({
      stopped: true,
      framesAdmitted: VOICE_QUEUE_MAX_FRAMES,
      framesDropped: 250
    })
  })

  it('recovers and keeps admitting once the consumer catches up', () => {
    const h = harness({ autoDrain: false })
    const id = h.service.startCapture().captureId!
    for (let i = 0; i < VOICE_QUEUE_MAX_FRAMES + 10; i++) h.service.acceptFrame(frame(id, i))
    expect(h.service.state().keepingUp).toBe(false)

    h.pump()
    expect(h.service.state().queued).toBe(0)

    // The next in-sequence frame is admitted again — the drop was transient.
    const next = VOICE_QUEUE_MAX_FRAMES + 10
    expect(h.service.acceptFrame(frame(id, next))).toEqual({ admitted: true, reason: null })
    // ⚠ `keepingUp` STAYS FALSE for the rest of the capture, deliberately: the
    // user needs to know audio was lost, and a flag that cleared itself would
    // hide it the moment the queue drained.
    expect(h.service.state().keepingUp).toBe(false)
    expect(h.service.state().framesDropped).toBe(10)
  })

  it('BOUNDS THE ACCUMULATED CAPTURE TOO, not just the queue', () => {
    // 3000 frames is ~192 s of audio, well past the 120 s bound. With a
    // consumer that keeps up perfectly the QUEUE never grows — which is
    // exactly why the accumulated audio needs its own ceiling, and why the
    // 5-1-era version of this test asserted framesDropped === 0 here: it was
    // asserting the ABSENCE of a bound that Task 5-2 had to add.
    const h = harness()
    const id = h.service.startCapture().captureId!
    for (let i = 0; i < 3000; i++) h.service.acceptFrame(frame(id, i))
    // The queue is empty: the consumer never fell behind.
    expect(h.service.state().queued).toBe(0)
    expect(h.service.state().keepingUp).toBe(true)
    // But the capture stopped accumulating at the bound...
    expect(h.service.state().framesAdmitted).toBe(3000)
    expect(h.service.state().framesDropped).toBe(3000 - VOICE_QUEUE_MAX_FRAMES)
    // ...and says so with the reason meaning "you have said enough", NOT the
    // one meaning "the machine fell behind".
    expect(h.service.state().lastDropReason).toBe('capture-full')
  })

  it('hands the transcriber at most the bounded amount of audio', async () => {
    const h = harness()
    const id = h.service.startCapture().captureId!
    for (let i = 0; i < 3000; i++) h.service.acceptFrame(frame(id, i))
    h.service.stopCapture(id)
    await h.settle()
    expect(h.transcribed[0].length).toBe(VOICE_QUEUE_MAX_FRAMES * VOICE_FRAME_SAMPLES)
  })
})

describe('voice service — stop, cancel and teardown', () => {
  it('finalizes, drains what is queued, transcribes, then settles', async () => {
    const h = harness({ autoDrain: false })
    const id = h.service.startCapture().captureId!
    for (let i = 0; i < 5; i++) h.service.acceptFrame(frame(id, i))
    expect(h.service.state().queued).toBe(5)

    const res = h.service.stopCapture(id)
    expect(res).toEqual({ stopped: true, framesAdmitted: 5, framesDropped: 0 })
    expect(h.service.state().state).toBe('finalizing')

    h.pump()
    await h.settle()
    // Task 5-2: a capture that produced audio settles at ready-for-review with a
    // transcript held, not at ready.
    expect(h.service.state().state).toBe('ready-for-review')
    expect(h.service.state().captureId).toBeNull()
    expect(h.service.state().queued).toBe(0)
    // The tail reached the transcriber, not discarded on the way out.
    expect(h.transcribed[0].length).toBe(5 * VOICE_FRAME_SAMPLES)
    expect(h.service.transcript()).toBe('refactor the parser please')
  })

  it('is idempotent, and a stop for an unknown capture is a state rather than an error', () => {
    const h = harness()
    const id = h.service.startCapture().captureId!
    expect(h.service.stopCapture(id).stopped).toBe(true)
    expect(() => h.service.stopCapture(id)).not.toThrow()
    expect(h.service.stopCapture(id).stopped).toBe(false)
    expect(h.service.stopCapture('00000000-0000-4000-8000-0000000000aa').stopped).toBe(false)
  })

  it('ignores a stop naming a DIFFERENT capture than the live one', () => {
    // The renderer's teardown races the window close; a stale id must not end a
    // capture that a later activation legitimately started.
    const h = harness()
    const id = h.service.startCapture().captureId!
    expect(h.service.stopCapture('00000000-0000-4000-8000-0000000000bb').stopped).toBe(false)
    expect(h.service.state().state).toBe('listening')
    expect(h.service.state().captureId).toBe(id)
  })

  it('cancel abandons a live capture and frees the sink for the next one', () => {
    const h = harness({ autoDrain: false })
    const id = h.service.startCapture().captureId!
    for (let i = 0; i < 3; i++) h.service.acceptFrame(frame(id, i))
    h.service.cancel('renderer reload')
    expect(h.service.state().state).toBe('ready')
    expect(h.service.state().captureId).toBeNull()
    expect(h.service.state().queued).toBe(0)
    // The queue was dropped, not handed to the transcriber: a cancelled
    // capture's audio is not wanted.
    expect(h.transcribed).toHaveLength(0)
    expect(h.service.startCapture().started).toBe(true)
  })

  it('cancel with nothing live is a no-op that emits nothing', () => {
    const h = harness()
    const before = h.states.length
    h.service.cancel('window closed')
    expect(h.states.length).toBe(before)
  })

  it('a reload while a capture is live cannot wedge the feature', () => {
    // The regression this guards: without a cancel on teardown the sink stays
    // `listening` on a capture id nothing is feeding, and every later start is
    // refused as "already capturing" until the app restarts.
    const h = harness({ autoDrain: false })
    const id = h.service.startCapture().captureId!
    h.service.acceptFrame(frame(id, 0))
    h.service.cancel('renderer reload')
    const after = h.service.startCapture()
    expect(after.started).toBe(true)
    expect(after.refusal).toBeNull()
  })

  it('dispose stops emitting and refuses further work', () => {
    const h = harness()
    const id = h.service.startCapture().captureId!
    h.service.dispose()
    const before = h.states.length
    expect(h.service.acceptFrame(frame(id, 0))).toEqual({ admitted: false, reason: 'stale-session' })
    h.service.noteMalformedFrame()
    expect(h.states.length).toBe(before)
    expect(h.service.startCapture().started).toBe(false)
  })
})

describe('voice service — robustness of the effect seams', () => {
  it('one throwing state listener does not stop the others', () => {
    // The house rule from `contextUsage.record`: a bad listener must never take
    // down the ipcMain.on callback that led here.
    const h = harness()
    const seen: number[] = []
    h.service.onState(() => {
      throw new Error('bad listener')
    })
    h.service.onState(() => seen.push(1))
    expect(() => h.service.startCapture()).not.toThrow()
    expect(seen.length).toBeGreaterThan(0)
  })

  it('⚠ A FAILING TRANSCRIBER ENDS AS `failed`, NOT AS AN UNHANDLED REJECTION', async () => {
    // `finishCapture` is reached from a scheduled drain callback, where there is
    // nobody to catch — a throw would become a process-level error raised by an
    // ordinary dictation.
    const err = Object.assign(new Error('whisper exit-nonzero: the engine exited with code 3'), {
      name: 'WhisperError',
      code: 'exit-nonzero'
    })
    const h = harness({ transcribeError: err })
    const id = h.service.startCapture().captureId!
    h.service.acceptFrame(frame(id, 0))
    h.service.stopCapture(id)
    await h.settle()
    expect(h.service.state().state).toBe('failed')
    expect(h.service.state().message).toContain('exit-nonzero')
    expect(h.service.transcript()).toBeNull()
    // And the sink is free again rather than wedged.
    expect(h.service.startCapture().started).toBe(true)
  })

  it('reports a NON-WhisperError generically rather than leaking its message', async () => {
    // Only WhisperError guarantees a sanitized message; an arbitrary throw could
    // carry anything, including transcript text.
    const h = harness({ transcribeError: new Error('secret dictation text leaked here') })
    const id = h.service.startCapture().captureId!
    h.service.acceptFrame(frame(id, 0))
    h.service.stopCapture(id)
    await h.settle()
    expect(h.service.state().state).toBe('failed')
    expect(h.service.state().message).toBe('transcription failed')
    expect(h.service.state().message).not.toContain('secret dictation')
  })

  it('unsubscribing a state listener actually detaches it', () => {
    const h = harness()
    const seen: VoiceStateEvent[] = []
    const off = h.service.onState((e) => seen.push(e))
    h.service.startCapture()
    const count = seen.length
    off()
    h.service.noteMalformedFrame()
    expect(seen.length).toBe(count)
  })

  it('schedules at most one drain per batch of arrivals', () => {
    // N scheduled callbacks for N frames would be pure scheduler overhead; the
    // consumer is synchronous by contract, so one pass drains the batch.
    const schedule = vi.fn()
    const service = createVoiceService({
      newCaptureId: () => '00000000-0000-4000-8000-000000000001',
      transcribe: async () => ({ text: '' }),
      writeToTarget: () => {},
      targetExists: () => true,
      scheduleDrain: schedule
    })
    const id = service.startCapture().captureId!
    for (let i = 0; i < 10; i++) service.acceptFrame(frame(id, i))
    expect(schedule).toHaveBeenCalledTimes(1)
    expect(service.state().queued).toBe(10)
  })
})

describe('voice service — no audio content anywhere it could leak', () => {
  it('the state event carries counts and closed tokens only', () => {
    const h = harness()
    const id = h.service.startCapture().captureId!
    h.service.acceptFrame(frame(id, 0))
    h.service.acceptFrame(frame(id, 77))
    const event = h.service.state()
    expect(Object.keys(event).sort()).toEqual(
      [
        'captureId',
        'framesAdmitted',
        'framesDropped',
        'keepingUp',
        'lastDropReason',
        'message',
        'queueMax',
        'level',
        'queued',
        'state',
        'transcriptChars'
      ].sort()
    )
    // ⚠ NO FIELD ON THIS EVENT HOLDS SAMPLES, and nothing on it is a string main
    // composed from a payload. The only string fields are a state token, a drop
    // reason from a closed enum, a uuid, and a null message.
    expect(JSON.stringify(event)).not.toContain('Int16Array')
    expect(event.message).toBeNull()
  })

  it('never hands the transcriber anything but the frames it was sent', async () => {
    const h = harness()
    const id = h.service.startCapture().captureId!
    const samples = new Int16Array(VOICE_FRAME_SAMPLES)
    samples[0] = 1234
    h.service.acceptFrame({ ...frame(id, 0), samples })
    h.service.stopCapture(id)
    await h.settle()
    // Exactly the samples that were sent, and nothing else.
    expect(h.transcribed).toHaveLength(1)
    expect(h.transcribed[0].length).toBe(VOICE_FRAME_SAMPLES)
    expect(h.transcribed[0][0]).toBe(1234)
  })
})


describe('voice service — the dictation target (Task 5-3)', () => {
  it('rings the focused pane when nothing is being dictated', () => {
    const h = harness()
    h.service.setFocusedTarget('pane-2')
    expect(h.service.ringTarget()).toBe('pane-2')
  })

  it('⚠ SNAPSHOTS THE TARGET AT CAPTURE START AND HOLDS IT', async () => {
    // The whole point: the user dictates INTO ANOTHER APPLICATION, so focus is
    // expected to move while they speak. The ring must not follow it.
    const h = harness()
    h.service.setFocusedTarget('pane-1')
    const id = h.service.startCapture().captureId!
    h.service.setFocusedTarget('pane-3') // focus moved mid-capture
    expect(h.service.ringTarget()).toBe('pane-1')

    h.service.acceptFrame(frame(id, 0))
    h.service.stopCapture(id)
    await h.settle()
    // ...and the text went to the pane that was ringed, not the focused one.
    expect(h.writes).toEqual([{ targetId: 'pane-1', text: 'refactor the parser please' }])
  })

  it('Tab cycles the target during a capture, in the given order', () => {
    const h = harness()
    h.service.setFocusedTarget('pane-1')
    h.service.startCapture()
    const panes = ['pane-1', 'pane-2', 'pane-3']
    expect(h.service.cycleTarget(panes)).toBe('pane-2')
    expect(h.service.cycleTarget(panes)).toBe('pane-3')
    expect(h.service.cycleTarget(panes)).toBe('pane-1')
  })

  it('Tab outside a capture is inert', () => {
    const h = harness()
    h.service.setFocusedTarget('pane-1')
    expect(h.service.cycleTarget(['pane-1', 'pane-2'])).toBeNull()
  })

  it('⚠ THE TEXT LANDS IN THE RINGED PANE WHEN RING AND FOCUS DIFFER', async () => {
    const h = harness()
    h.service.setFocusedTarget('pane-1')
    const id = h.service.startCapture().captureId!
    h.service.cycleTarget(['pane-1', 'pane-2', 'pane-3']) // ring -> pane-2
    h.service.setFocusedTarget('pane-3') // focus -> pane-3
    h.service.acceptFrame(frame(id, 0))
    h.service.stopCapture(id)
    await h.settle()
    expect(h.writes.map((w) => w.targetId)).toEqual(['pane-2'])
  })
})

describe('voice service — the write, and the safety rule around it', () => {
  it('writes EXACTLY ONCE', async () => {
    const h = harness()
    h.service.setFocusedTarget('pane-1')
    const id = h.service.startCapture().captureId!
    h.service.acceptFrame(frame(id, 0))
    h.service.stopCapture(id)
    await h.settle()
    expect(h.writes).toHaveLength(1)
  })

  it('⚠ NEVER APPENDS A NEWLINE — a trailing \\r or \\n IS pressing Enter', async () => {
    // Enter in an agent pane starts an autonomous process that edits files and
    // runs commands, on a sentence that may have been misheard. There is no
    // flag, setting or default that turns this on.
    const h = harness({ text: 'run the tests' })
    h.service.setFocusedTarget('pane-1')
    const id = h.service.startCapture().captureId!
    h.service.acceptFrame(frame(id, 0))
    h.service.stopCapture(id)
    await h.settle()
    const written = h.writes[0].text
    expect(written).toBe('run the tests')
    expect(written.endsWith('\n')).toBe(false)
    expect(written.endsWith('\r')).toBe(false)
    expect(written).not.toMatch(/[\r\n]/)
  })

  it('preserves a transcript that itself contains no submit characters', async () => {
    const h = harness({ text: 'add a test for the parser, then run it' })
    h.service.setFocusedTarget('pane-1')
    const id = h.service.startCapture().captureId!
    h.service.acceptFrame(frame(id, 0))
    h.service.stopCapture(id)
    await h.settle()
    expect(h.writes[0].text).toBe('add a test for the parser, then run it')
    expect(h.service.state().state).toBe('inserted')
  })

  it('an empty transcript writes nothing at all', async () => {
    const h = harness({ text: '' })
    h.service.setFocusedTarget('pane-1')
    const id = h.service.startCapture().captureId!
    h.service.acceptFrame(frame(id, 0))
    h.service.stopCapture(id)
    await h.settle()
    expect(h.writes).toHaveLength(0)
    expect(h.service.state().state).toBe('ready')
  })
})

describe('voice service — target death (VoicePlan §7.3, §9)', () => {
  it('⚠ PRESERVES THE TRANSCRIPT AND WRITES TO NOBODY', async () => {
    const h = harness({ text: 'the words that must not be lost' })
    h.service.setFocusedTarget('pane-1')
    const id = h.service.startCapture().captureId!
    h.service.acceptFrame(frame(id, 0))
    h.service.stopCapture(id)
    // The pane dies while transcription is running.
    h.live.delete('pane-1')
    await h.settle()

    expect(h.writes).toHaveLength(0)
    expect(h.service.transcript()).toBe('the words that must not be lost')
    expect(h.service.state().state).toBe('ready-for-review')
    expect(h.service.state().transcriptChars).toBe(31)
  })

  it('⚠ NEVER REDIRECTS TO THE PANE THAT INHERITED FOCUS', async () => {
    // The worst outcome this feature can produce, and the DEFAULT behaviour of
    // any implementation that re-resolves the target at write time.
    const h = harness()
    h.service.setFocusedTarget('pane-1')
    const id = h.service.startCapture().captureId!
    h.service.acceptFrame(frame(id, 0))
    h.service.stopCapture(id)
    h.live.delete('pane-1')
    h.service.setFocusedTarget('pane-2') // focus falls to a live pane
    await h.settle()
    expect(h.writes).toHaveLength(0)
  })

  it('a capture started with NO target holds the transcript rather than guessing', async () => {
    const h = harness()
    // No setFocusedTarget: nothing was focused.
    const id = h.service.startCapture().captureId!
    h.service.acceptFrame(frame(id, 0))
    h.service.stopCapture(id)
    await h.settle()
    expect(h.writes).toHaveLength(0)
    expect(h.service.state().state).toBe('ready-for-review')
    expect(h.service.transcript()).toBe('refactor the parser please')
  })

  it('a failed write keeps the transcript instead of dropping it', async () => {
    const h = harness({ writeThrows: true })
    h.service.setFocusedTarget('pane-1')
    const id = h.service.startCapture().captureId!
    h.service.acceptFrame(frame(id, 0))
    h.service.stopCapture(id)
    await h.settle()
    expect(h.service.state().state).toBe('ready-for-review')
    expect(h.service.transcript()).toBe('refactor the parser please')
    expect(h.service.state().message).toContain('could not write')
  })

  it('the sink is free for the next dictation after a recovery', async () => {
    const h = harness()
    h.service.setFocusedTarget('pane-1')
    const id = h.service.startCapture().captureId!
    h.service.acceptFrame(frame(id, 0))
    h.service.stopCapture(id)
    h.live.delete('pane-1')
    await h.settle()
    h.service.setFocusedTarget('pane-2')
    expect(h.service.startCapture().started).toBe(true)
  })
})
