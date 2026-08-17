import { describe, it, expect } from 'vitest'
import {
  VOICE_FRAME_SAMPLES,
  VOICE_QUEUE_MAX_FRAMES,
  VOICE_QUEUE_MAX_SECONDS,
  VOICE_SAMPLE_RATE,
  admitFrame,
  advanceQueueState,
  createOwnOriginCheck,
  toInt16,
  type QueueState
} from './voiceCore'
import { voiceFrameSchema, type VoiceFrame } from '../../shared/ipc'

const CAPTURE = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'

/**
 * ⚠ `sampleRate` IS WIDENED FROM THE SCHEMA'S LITERAL ON PURPOSE. `VoiceFrame`
 * infers `sampleRate: 16000`, so TypeScript refuses to construct the 48 kHz
 * frame that several tests below exist to prove is REJECTED. The whole point of
 * those cases is that a wrong rate cannot be expressed in this app's types and
 * must still be refused at runtime — a renderer is not the only possible
 * producer, and 5-2 will feed `admitFrame` from elsewhere.
 */
type FrameOverride = Partial<Omit<VoiceFrame, 'sampleRate'>> & { sampleRate?: number }

function frame(over: FrameOverride = {}): VoiceFrame {
  const sampleCount = over.sampleCount ?? VOICE_FRAME_SAMPLES
  return {
    captureId: CAPTURE,
    seq: 0,
    sampleRate: VOICE_SAMPLE_RATE,
    sampleCount,
    samples: new Int16Array(sampleCount),
    ...over
  } as VoiceFrame
}

const live = (over: Partial<QueueState> = {}): QueueState => ({
  captureId: CAPTURE,
  queued: 0,
  nextSeq: 0,
  ...over
})

describe('voiceCore constants (Task 5-1)', () => {
  it('derives the queue bound from a duration rather than a round number', () => {
    // The comment on VOICE_QUEUE_MAX_FRAMES claims 120 s of 16 kHz mono at 1024
    // samples/frame. This asserts the arithmetic actually closes, so a later
    // "tidy" to 2000 fails here rather than silently changing the ceiling.
    expect(VOICE_QUEUE_MAX_FRAMES).toBe(
      Math.round((120 * VOICE_SAMPLE_RATE) / VOICE_FRAME_SAMPLES)
    )
    expect(VOICE_QUEUE_MAX_SECONDS).toBe(120)
  })

  it('states the resident-audio ceiling the bound implies', () => {
    // 1875 frames x 1024 samples x 2 bytes ~= 3.84 MB. If a future edit raises
    // the bound, this is where the memory cost of doing so becomes visible.
    const bytes = VOICE_QUEUE_MAX_FRAMES * VOICE_FRAME_SAMPLES * 2
    expect(bytes).toBeLessThan(4 * 1024 * 1024)
  })

  it('keeps the frame size a whole number of Web Audio render quanta', () => {
    // Web Audio delivers 128 samples per process() call and will not negotiate.
    expect(VOICE_FRAME_SAMPLES % 128).toBe(0)
  })
})

describe('isOwnOrigin (D162) — dev', () => {
  const check = createOwnOriginCheck({
    devRendererUrl: 'http://localhost:5173',
    appRootFileUrl: null
  })

  it('accepts the dev server origin, including the splash query createWindow appends', () => {
    expect(check({ requestingUrl: 'http://localhost:5173' })).toBe(true)
    expect(check({ requestingUrl: 'http://localhost:5173/' })).toBe(true)
    expect(
      check({ requestingUrl: 'http://localhost:5173/?v=0.6.0&platform=windows+x64&restoring=4' })
    ).toBe(true)
  })

  it('is NOT () => true — the whole reason the predicate exists', () => {
    expect(check({ requestingUrl: 'http://localhost:5174' })).toBe(false)
    expect(check({ requestingUrl: 'https://localhost:5173' })).toBe(false)
    expect(check({ requestingUrl: 'http://evil.example.com' })).toBe(false)
    // The near-miss an origin check exists to catch: a host that merely STARTS
    // with the dev origin's host.
    expect(check({ requestingUrl: 'http://localhost:5173.evil.com' })).toBe(false)
    expect(check({ requestingUrl: 'http://localhost.evil.com:5173' })).toBe(false)
  })

  it('refuses file:// outright in dev, where no file root was loaded', () => {
    // Nothing loaded the app from disk, so a file requester is by definition not
    // the app — it is not measured against a root nobody used.
    expect(check({ requestingUrl: 'file://' })).toBe(false)
    expect(check({ requestingUrl: 'file:///C:/Projects/x/out/renderer/index.html' })).toBe(false)
  })

  it('refuses an absent, empty or unparseable requester', () => {
    // MEASURED, not hypothetical: the check handler is called with an EMPTY
    // origin several times during startup, before the renderer commits a URL.
    expect(check({})).toBe(false)
    expect(check({ requestingUrl: '' })).toBe(false)
    expect(check({ requestingUrl: 'not a url' })).toBe(false)
    expect(check({ requestingUrl: 'null' })).toBe(false)
  })

  it('refuses every other scheme an agent could cause to be loaded', () => {
    expect(check({ requestingUrl: 'data:text/html,<script>1</script>' })).toBe(false)
    expect(check({ requestingUrl: 'blob:http://localhost:5173/abc' })).toBe(false)
    expect(check({ requestingUrl: 'chrome-extension://abcdef/page.html' })).toBe(false)
    expect(check({ requestingUrl: 'devtools://devtools/bundled/x.html' })).toBe(false)
  })
})

describe('isOwnOrigin (D162) — packaged', () => {
  const ROOT = 'file:///C:/Program%20Files/Chorus/resources/app.asar/out/renderer/'
  const check = createOwnOriginCheck({ devRendererUrl: null, appRootFileUrl: ROOT })

  it('accepts the app root and files under it', () => {
    expect(check({ requestingUrl: `${ROOT}index.html` })).toBe(true)
    expect(check({ requestingUrl: `${ROOT}assets/index-abc123.js` })).toBe(true)
  })

  it('accepts the opaque file:// origin the CHECK handler passes for a file page', () => {
    // A file:// page has no comparable origin — Chromium passes the bare scheme.
    // Accepted only because a packaged root was supplied, i.e. only when the app
    // itself is loaded from disk.
    expect(check({ requestingUrl: 'file://' })).toBe(true)
  })

  it('refuses other paths on the same disk', () => {
    expect(check({ requestingUrl: 'file:///C:/Users/matth/evil.html' })).toBe(false)
    expect(check({ requestingUrl: 'file:///C:/Program%20Files/Chorus/other/index.html' })).toBe(false)
  })

  it('refuses a sibling directory whose name merely extends the root', () => {
    // This is what the trailing slash in the root buys: without it, a plain
    // string prefix would admit `…/renderer-evil/`.
    const sibling = 'file:///C:/Program%20Files/Chorus/resources/app.asar/out/renderer-evil/x.html'
    expect(check({ requestingUrl: sibling })).toBe(false)
  })

  it('refuses a traversal out of the root', () => {
    // `new URL()` normalizes `..` before the comparison, so this resolves to a
    // path outside the root and is refused on its resolved form.
    expect(
      check({ requestingUrl: `${ROOT}../../../../../Users/matth/evil.html` })
    ).toBe(false)
  })

  it('is case-insensitive about the drive and path, as Windows is', () => {
    const shouty = 'FILE:///c:/PROGRAM%20FILES/Chorus/resources/app.asar/out/RENDERER/index.html'
    expect(check({ requestingUrl: shouty })).toBe(true)
  })

  it('refuses http origins when nothing is served over http', () => {
    expect(check({ requestingUrl: 'http://localhost:5173' })).toBe(false)
  })
})

describe('isOwnOrigin (D162) — a policy with nothing allowed', () => {
  it('refuses everything when neither origin is configured', () => {
    const check = createOwnOriginCheck({ devRendererUrl: null, appRootFileUrl: null })
    expect(check({ requestingUrl: 'http://localhost:5173' })).toBe(false)
    expect(check({ requestingUrl: 'file://' })).toBe(false)
    expect(check({ requestingUrl: 'file:///C:/x/index.html' })).toBe(false)
  })

  it('survives a malformed policy without admitting anything', () => {
    const check = createOwnOriginCheck({ devRendererUrl: 'not a url', appRootFileUrl: 'also not' })
    expect(check({ requestingUrl: 'http://localhost:5173' })).toBe(false)
    expect(check({ requestingUrl: 'not a url' })).toBe(false)
  })
})

describe('toInt16 — clamps, never wraps', () => {
  it('maps the nominal range to full scale', () => {
    const out = toInt16(new Float32Array([0, 1, -1, 0.5, -0.5]))
    expect(out[0]).toBe(0)
    expect(out[1]).toBe(32767)
    expect(out[2]).toBe(-32768)
    expect(out[3]).toBe(16383)
    expect(out[4]).toBe(-16384)
  })

  it('CLAMPS an overshoot rather than wrapping it to the opposite sign', () => {
    // The bug this exists to prevent: `x * 32768` on 1.5 yields 49152, which
    // wraps to -16384 in an Int16Array — a loud sample becomes a loud sample of
    // the OPPOSITE sign, audible as a click and to a transcriber as a consonant.
    const out = toInt16(new Float32Array([1.5, -1.5, 12, -12, 1.0001]))
    expect(out[0]).toBe(32767)
    expect(out[1]).toBe(-32768)
    expect(out[2]).toBe(32767)
    expect(out[3]).toBe(-32768)
    expect(out[4]).toBe(32767)
    // Explicitly: no sign flips anywhere.
    expect([...out].every((v, i) => Math.sign(v) === Math.sign([1.5, -1.5, 12, -12, 1.0001][i]))).toBe(true)
  })

  it('scales the two signs asymmetrically so positive full scale cannot overflow', () => {
    // Negative full scale is -32768 and positive is 32767; multiplying both by
    // 32768 would overflow the positive end by exactly one count.
    expect(toInt16(new Float32Array([1]))[0]).toBe(32767)
    expect(toInt16(new Float32Array([-1]))[0]).toBe(-32768)
  })

  it('preserves length and returns a real Int16Array', () => {
    const out = toInt16(new Float32Array(VOICE_FRAME_SAMPLES))
    expect(out).toBeInstanceOf(Int16Array)
    expect(out.length).toBe(VOICE_FRAME_SAMPLES)
  })

  it('handles an empty frame without throwing', () => {
    expect(toInt16(new Float32Array(0)).length).toBe(0)
  })

  it('treats NaN as silence rather than producing garbage', () => {
    // Math.min/Math.max propagate NaN, and `NaN | 0` in an Int16Array store is
    // 0. Asserted so the behaviour is known rather than incidental.
    expect(toInt16(new Float32Array([NaN]))[0]).toBe(0)
  })
})

describe('admitFrame — the queue admission policy', () => {
  it('admits a well-formed in-sequence frame', () => {
    expect(admitFrame(live(), frame())).toEqual({ admit: true })
  })

  it('admits right up to the bound and drops the frame beyond it', () => {
    const atLimit = live({ queued: VOICE_QUEUE_MAX_FRAMES - 1, nextSeq: 10 })
    expect(admitFrame(atLimit, frame({ seq: 10 }))).toEqual({ admit: true })

    const full = live({ queued: VOICE_QUEUE_MAX_FRAMES, nextSeq: 10 })
    expect(admitFrame(full, frame({ seq: 10 }))).toEqual({ admit: false, reason: 'queue-full' })
  })

  it('reports a frame from a finished or unknown capture as stale', () => {
    expect(admitFrame(live(), frame({ captureId: OTHER }))).toEqual({
      admit: false,
      reason: 'stale-session'
    })
    expect(admitFrame({ captureId: null, queued: 0, nextSeq: 0 }, frame())).toEqual({
      admit: false,
      reason: 'stale-session'
    })
  })

  it('rejects a wrong sample rate', () => {
    // Belt and braces beside the schema's z.literal(16_000) — the rule stays
    // provable without a Zod round trip, and stays true for Task 5-2, which will
    // feed this from somewhere other than the bridge.
    expect(admitFrame(live(), frame({ sampleRate: 48_000 }))).toEqual({
      admit: false,
      reason: 'bad-sample-rate'
    })
    expect(admitFrame(live(), frame({ sampleRate: 8_000 }))).toEqual({
      admit: false,
      reason: 'bad-sample-rate'
    })
  })

  it('rejects a payload whose length disagrees with its declared length', () => {
    // The cross-check Zod deliberately cannot do: it validates the two fields
    // independently and has no opinion on whether they agree.
    expect(
      admitFrame(live(), { ...frame(), sampleCount: 512, samples: new Int16Array(1024) })
    ).toEqual({ admit: false, reason: 'length-mismatch' })
    expect(
      admitFrame(live(), { ...frame(), sampleCount: 1024, samples: new Int16Array(512) })
    ).toEqual({ admit: false, reason: 'length-mismatch' })
  })

  it('rejects a non-monotonic or skipped sequence number', () => {
    const s = live({ nextSeq: 5 })
    expect(admitFrame(s, frame({ seq: 4 }))).toEqual({ admit: false, reason: 'bad-sequence' })
    expect(admitFrame(s, frame({ seq: 5 }))).toEqual({ admit: true })
    expect(admitFrame(s, frame({ seq: 6 }))).toEqual({ admit: false, reason: 'bad-sequence' })
  })

  it('diagnoses staleness ahead of everything else', () => {
    // A frame from a dead capture is stale no matter what else is wrong with it;
    // reporting the other fault would send a reader after the wrong bug.
    const full = live({ queued: VOICE_QUEUE_MAX_FRAMES, nextSeq: 3 })
    const bad = { ...frame({ captureId: OTHER, seq: 99, sampleRate: 8_000 }), sampleCount: 1 }
    expect(admitFrame(full, bad)).toEqual({ admit: false, reason: 'stale-session' })
  })

  it('does not report a malformed producer as backpressure', () => {
    // queue-full is only meaningful once the frame is known to be well-formed
    // and in sequence — otherwise a broken producer reads as a stalled consumer.
    const full = live({ queued: VOICE_QUEUE_MAX_FRAMES, nextSeq: 3 })
    expect(admitFrame(full, frame({ seq: 3, sampleRate: 44_100 }))).toEqual({
      admit: false,
      reason: 'bad-sample-rate'
    })
    expect(admitFrame(full, frame({ seq: 99 }))).toEqual({ admit: false, reason: 'bad-sequence' })
  })

  it('never throws, whatever it is handed', () => {
    // The contract: a dropped frame is a normal outcome on a send-shaped channel
    // where there is no reply for an exception to travel on.
    const nasty = [
      frame({ seq: -1 }),
      frame({ sampleCount: 0 }),
      { ...frame(), samples: new Int16Array(0), sampleCount: 0 },
      frame({ seq: Number.MAX_SAFE_INTEGER })
    ]
    for (const f of nasty) expect(() => admitFrame(live(), f)).not.toThrow()
  })
})

describe('advanceQueueState — the transition that makes backpressure readable', () => {
  it('counts an admitted frame and moves the expectation on', () => {
    const s = live({ queued: 3, nextSeq: 7 })
    const next = advanceQueueState(s, frame({ seq: 7 }), { admit: true })
    expect(next).toEqual({ captureId: CAPTURE, queued: 4, nextSeq: 8 })
  })

  it('ADVANCES the sequence on a queue-full drop', () => {
    // ⚠ THE BUG THIS PREVENTS: a producer being dropped for a full queue keeps
    // counting. If the expectation only moved on admission, the next frame would
    // be refused as `bad-sequence` and every frame after it too — the sink would
    // still bound, but it would report a malformed producer instead of a stalled
    // consumer, which is the opposite diagnosis.
    const s = live({ queued: VOICE_QUEUE_MAX_FRAMES, nextSeq: 7 })
    const next = advanceQueueState(s, frame({ seq: 7 }), { admit: false, reason: 'queue-full' })
    expect(next.nextSeq).toBe(8)
    expect(next.queued).toBe(VOICE_QUEUE_MAX_FRAMES)
  })

  it('keeps reporting queue-full for as long as the consumer is stalled', () => {
    // The end-to-end shape of the bug above: 50 consecutive drops must all read
    // `queue-full`, never degrade into `bad-sequence`.
    let s = live({ queued: VOICE_QUEUE_MAX_FRAMES, nextSeq: 0 })
    const reasons: string[] = []
    for (let i = 0; i < 50; i++) {
      const f = frame({ seq: i })
      const r = admitFrame(s, f)
      if (!r.admit) reasons.push(r.reason)
      s = advanceQueueState(s, f, r)
    }
    expect(reasons).toHaveLength(50)
    expect(new Set(reasons)).toEqual(new Set(['queue-full']))
  })

  it('advances nothing on a drop that is not evidence about the producer', () => {
    const s = live({ queued: 2, nextSeq: 7 })
    for (const reason of ['stale-session', 'bad-sequence', 'length-mismatch', 'bad-sample-rate'] as const) {
      expect(advanceQueueState(s, frame({ seq: 7 }), { admit: false, reason })).toEqual(s)
    }
  })

  it('never mutates the state it was given', () => {
    const s = live({ queued: 1, nextSeq: 1 })
    const copy = { ...s }
    advanceQueueState(s, frame({ seq: 1 }), { admit: true })
    expect(s).toEqual(copy)
  })
})

describe('the envelope schema — what Zod does and deliberately does not check', () => {
  it('accepts a well-formed frame', () => {
    expect(voiceFrameSchema.safeParse(frame()).success).toBe(true)
  })

  it('refuses a wrong sample rate on the wire', () => {
    expect(voiceFrameSchema.safeParse(frame({ sampleRate: 48_000 })).success).toBe(false)
  })

  it('refuses a negative or fractional sequence number', () => {
    expect(voiceFrameSchema.safeParse(frame({ seq: -1 })).success).toBe(false)
    expect(voiceFrameSchema.safeParse(frame({ seq: 1.5 })).success).toBe(false)
  })

  it('refuses a sampleCount beyond the declared ceiling', () => {
    // The guard against a hostile producer declaring 2^31 samples.
    const huge = { ...frame(), sampleCount: 999_999, samples: new Int16Array(0) }
    expect(voiceFrameSchema.safeParse(huge).success).toBe(false)
  })

  it('refuses a payload that is not an Int16Array', () => {
    const wrong = { ...frame(), samples: [1, 2, 3] as unknown as Int16Array }
    expect(voiceFrameSchema.safeParse(wrong).success).toBe(false)
    const floats = { ...frame(), samples: new Float32Array(1024) as unknown as Int16Array }
    expect(voiceFrameSchema.safeParse(floats).success).toBe(false)
  })

  it('refuses a non-uuid capture id and unknown extra fields', () => {
    expect(voiceFrameSchema.safeParse(frame({ captureId: 'nope' })).success).toBe(false)
    expect(voiceFrameSchema.safeParse({ ...frame(), extra: 1 }).success).toBe(false)
  })

  it('DOES NOT catch a length disagreement — which is why admitFrame must', () => {
    // ⚠ THIS IS THE DECLARED LIMIT OF THE ENVELOPE'S VALIDATION, asserted so it
    // is a stated position rather than something that merely happens to be true.
    // Zod validates `sampleCount` and `samples` independently; both are valid
    // here, and only the cross-check refuses the frame.
    const lying = { ...frame(), sampleCount: 512, samples: new Int16Array(1024) }
    expect(voiceFrameSchema.safeParse(lying).success).toBe(true)
    expect(admitFrame(live(), lying)).toEqual({ admit: false, reason: 'length-mismatch' })
  })
})
