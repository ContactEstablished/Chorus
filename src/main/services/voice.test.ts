import { describe, it, expect, vi } from 'vitest'
import { createVoiceService, type VoiceService } from './voice'
import { VOICE_QUEUE_MAX_FRAMES } from './voiceCore'
import { VOICE_FRAME_SAMPLES, VOICE_SAMPLE_RATE, type VoiceFrame, type VoiceStateEvent } from '../../shared/ipc'

/**
 * Every effect is injected, so nothing here touches a clock, a window, a
 * database or `randomUUID`. The drain is a MANUAL PUMP — which is the whole
 * reason the queue can be observed holding frames at all.
 */
function harness(opts: { autoDrain?: boolean } = {}) {
  const autoDrain = opts.autoDrain ?? true
  let nextId = 0
  const ids: string[] = []
  const consumed: Array<{ captureId: string; seq: number; length: number }> = []
  const states: VoiceStateEvent[] = []
  let pendingDrain: (() => void) | null = null

  const service: VoiceService = createVoiceService({
    newCaptureId: () => {
      // Deterministic, and shaped as a real uuid so the wire schemas accept it.
      const id = `00000000-0000-4000-8000-00000000000${++nextId}`
      ids.push(id)
      return id
    },
    consumeFrame: (captureId, seq, samples) => {
      consumed.push({ captureId, seq, length: samples.length })
    },
    scheduleDrain: (run) => {
      if (autoDrain) run()
      else pendingDrain = run
    }
  })
  service.onState((e) => states.push(e))

  return {
    service,
    ids,
    consumed,
    states,
    /** Run the one drain the service scheduled, if any. */
    pump(): void {
      const run = pendingDrain
      pendingDrain = null
      run?.()
    },
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

  it('allows a fresh capture once the previous one has fully finalized', () => {
    const h = harness({ autoDrain: false })
    const first = h.service.startCapture()
    h.service.acceptFrame(frame(first.captureId!, 0))
    h.service.stopCapture(first.captureId!)
    h.pump()
    expect(h.service.state().state).toBe('ready')
    const second = h.service.startCapture()
    expect(second.started).toBe(true)
    expect(second.captureId).not.toBe(first.captureId)
  })

  it('resets the accounting on a new capture so the previous one cannot bleed in', () => {
    const h = harness()
    const first = h.service.startCapture()
    h.service.acceptFrame(frame(first.captureId!, 0))
    h.service.acceptFrame(frame(first.captureId!, 99)) // dropped: bad sequence
    h.service.stopCapture(first.captureId!)
    const second = h.service.startCapture()
    expect(second.started).toBe(true)
    expect(h.service.state().framesAdmitted).toBe(0)
    expect(h.service.state().framesDropped).toBe(0)
    expect(h.service.state().lastDropReason).toBeNull()
    expect(h.service.state().keepingUp).toBe(true)
  })
})

describe('voice service — frame accounting', () => {
  it('admits a run of frames and passes each to the consumer exactly once', () => {
    const h = harness()
    const id = h.service.startCapture().captureId!
    for (let i = 0; i < 40; i++) {
      expect(h.service.acceptFrame(frame(id, i))).toEqual({ admitted: true, reason: null })
    }
    expect(h.service.state().framesAdmitted).toBe(40)
    expect(h.service.state().framesDropped).toBe(0)
    expect(h.consumed).toHaveLength(40)
    expect(h.consumed.map((c) => c.seq)).toEqual([...Array(40).keys()])
    expect(h.consumed.every((c) => c.length === VOICE_FRAME_SAMPLES)).toBe(true)
    expect(h.consumed.every((c) => c.captureId === id)).toBe(true)
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

  it('does not emit a state event per admitted frame', () => {
    // At ~16 frames/second that would be 16 IPC messages a second describing a
    // counter. State is pushed on transitions and on drops.
    const h = harness()
    const id = h.service.startCapture().captureId!
    const afterStart = h.states.length
    for (let i = 0; i < 30; i++) h.service.acceptFrame(frame(id, i))
    expect(h.states.length).toBe(afterStart)
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
    expect(h.consumed).toHaveLength(VOICE_QUEUE_MAX_FRAMES)

    // The next in-sequence frame is admitted again — the drop was transient.
    const next = VOICE_QUEUE_MAX_FRAMES + 10
    expect(h.service.acceptFrame(frame(id, next))).toEqual({ admitted: true, reason: null })
    // ⚠ `keepingUp` STAYS FALSE for the rest of the capture, deliberately: the
    // user needs to know audio was lost, and a flag that cleared itself would
    // hide it the moment the queue drained.
    expect(h.service.state().keepingUp).toBe(false)
    expect(h.service.state().framesDropped).toBe(10)
  })

  it('holds no frames after a drain, so a long capture cannot grow without limit', () => {
    const h = harness()
    const id = h.service.startCapture().captureId!
    // 3000 frames is ~192 s of audio — well past the 120 s bound — and with a
    // keeping-up consumer the queue never grows at all.
    for (let i = 0; i < 3000; i++) h.service.acceptFrame(frame(id, i))
    expect(h.service.state().queued).toBe(0)
    expect(h.service.state().framesDropped).toBe(0)
    expect(h.service.state().framesAdmitted).toBe(3000)
  })
})

describe('voice service — stop, cancel and teardown', () => {
  it('finalizes, drains what is queued, then settles to ready', () => {
    const h = harness({ autoDrain: false })
    const id = h.service.startCapture().captureId!
    for (let i = 0; i < 5; i++) h.service.acceptFrame(frame(id, i))
    expect(h.service.state().queued).toBe(5)

    const res = h.service.stopCapture(id)
    expect(res).toEqual({ stopped: true, framesAdmitted: 5, framesDropped: 0 })
    expect(h.service.state().state).toBe('finalizing')

    h.pump()
    expect(h.service.state().state).toBe('ready')
    expect(h.service.state().captureId).toBeNull()
    expect(h.service.state().queued).toBe(0)
    // The tail was consumed, not discarded on the way out.
    expect(h.consumed).toHaveLength(5)
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
    // The queue was dropped, not handed to the consumer: a cancelled capture's
    // audio is not wanted.
    expect(h.consumed).toHaveLength(0)
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

  it('a throwing consumer costs one frame, not the capture', () => {
    let calls = 0
    const service = createVoiceService({
      newCaptureId: () => '00000000-0000-4000-8000-000000000001',
      consumeFrame: () => {
        calls++
        throw new Error('consumer exploded')
      },
      scheduleDrain: (run) => run()
    })
    const id = service.startCapture().captureId!
    expect(() => service.acceptFrame(frame(id, 0))).not.toThrow()
    expect(() => service.acceptFrame(frame(id, 1))).not.toThrow()
    expect(calls).toBe(2)
    expect(service.state().state).toBe('listening')
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
      consumeFrame: () => {},
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
        'queued',
        'state'
      ].sort()
    )
    // ⚠ NO FIELD ON THIS EVENT HOLDS SAMPLES, and nothing on it is a string main
    // composed from a payload. The only string fields are a state token, a drop
    // reason from a closed enum, a uuid, and a null message.
    expect(JSON.stringify(event)).not.toContain('Int16Array')
    expect(event.message).toBeNull()
  })

  it('never hands the consumer anything but the frame it was sent', () => {
    const h = harness()
    const id = h.service.startCapture().captureId!
    const samples = new Int16Array(VOICE_FRAME_SAMPLES)
    samples[0] = 1234
    h.service.acceptFrame({ ...frame(id, 0), samples })
    expect(h.consumed).toEqual([{ captureId: id, seq: 0, length: VOICE_FRAME_SAMPLES }])
  })
})
