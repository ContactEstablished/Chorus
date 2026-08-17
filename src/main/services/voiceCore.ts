import {
  VOICE_FRAME_SAMPLES,
  VOICE_SAMPLE_RATE,
  type VoiceFrame,
  type VoiceDropReason
} from '../../shared/ipc'

/**
 * The pure half of voice capture (Task 5-1).
 *
 * ⚠ NO `electron`, NO `fs`, NO `child_process`, NO CLOCK, NO RANDOMNESS. Every
 * decision the capture path makes that CAN be proven is made here, and it is
 * proven in `voiceCore.test.ts`. The impure half — the single-owner session, the
 * queue itself, the state fan-out — lives in `voice.ts` with every effect
 * injected. `Phase-5-Overview.md` lists the permission handlers, `getUserMedia`,
 * the `AudioWorklet` and the real sample rate as things unit tests cannot reach;
 * this file is deliberately everything that is left.
 *
 * The two wire constants are re-exported rather than redeclared. They have ONE
 * home, in `shared/ipc.ts`, because the renderer needs them too and a renderer
 * may not import from `src/main/` — and because the sample rate is the literal
 * the frame schema asserts. Two declarations of a number that must agree across
 * three processes is how they stop agreeing.
 */
export { VOICE_SAMPLE_RATE, VOICE_FRAME_SAMPLES } from '../../shared/ipc'

/**
 * How many frames the sink will hold before it starts dropping.
 *
 * ⚠ THIS IS A DURATION, NOT A ROUND NUMBER, AND THE DERIVATION IS WRITTEN DOWN
 * BECAUSE A BARE `1875` IS EXACTLY THE KIND OF CONSTANT A LATER READER "TIDIES"
 * TO 2000. It is **120 seconds** of 16 kHz mono at 1024 samples per frame:
 *
 *     16000 samples/s ÷ 1024 samples/frame = 15.625 frames/s
 *     15.625 frames/s × 120 s              = 1875 frames
 *
 * At 2 bytes per sample that is 1875 × 1024 × 2 ≈ **3.84 MB** of resident audio
 * — the real ceiling this bound exists to state. Two minutes is chosen as
 * comfortably longer than any dictation a person gives a coding agent in one
 * breath, so reaching it means the consumer has genuinely stopped rather than
 * that the speaker was verbose.
 *
 * Unlike `VOICE_SAMPLE_RATE` this is main's own queue policy and not a wire
 * fact: the renderer neither needs it nor is allowed to assume it, which is why
 * it lives here and the other two do not.
 */
export const VOICE_QUEUE_MAX_FRAMES = 1_875

/** The bound restated as the duration it was derived from, for logs and tests. */
export const VOICE_QUEUE_MAX_SECONDS = Math.round(
  (VOICE_QUEUE_MAX_FRAMES * VOICE_FRAME_SAMPLES) / VOICE_SAMPLE_RATE
)

/* ─────────────────────────── the origin predicate ─────────────────────────── */

/**
 * Which origins may hold the microphone. Injected rather than read from
 * `process.env` inside this module, for the reason the file header gives: a
 * "pure" function that reaches for the environment is neither pure nor testable,
 * and this one guards a security boundary, so it has to be both.
 */
export interface OwnOriginPolicy {
  /**
   * The dev server's URL (`ELECTRON_RENDERER_URL`), or null when the app is not
   * loading from one. Only its ORIGIN is used — the path and query are ignored,
   * because `createWindow` appends the splash's boot facts as a query string.
   */
  readonly devRendererUrl: string | null
  /**
   * The packaged renderer's own directory as a `file://` URL, or null when the
   * app is not loading from disk. **Null in dev is the point**: with a dev
   * server serving the app, a `file://` requester is by definition not the app,
   * so it is refused outright rather than measured against a root nobody loaded.
   */
  readonly appRootFileUrl: string | null
}

function normalizedDirHref(fileUrl: string): string | null {
  let url: URL
  try {
    url = new URL(fileUrl)
  } catch {
    return null
  }
  if (url.protocol !== 'file:') return null
  // Windows paths are case-insensitive and `__dirname` casing does not have to
  // match what Chromium reports, so the comparison is lowercased. The trailing
  // slash is what makes this a DIRECTORY prefix rather than a string prefix:
  // without it, a root of `…/renderer` would also admit `…/renderer-evil/`.
  const href = url.href.toLowerCase()
  return href.endsWith('/') ? href : `${href}/`
}

/**
 * Build the predicate both permission handlers ask.
 *
 * ⚠ IT IS NOT `() => true`, AND THAT IS THE WHOLE REASON IT EXISTS. A handler
 * that returns true for `'media'` without checking who is asking is the
 * pre-task behaviour with extra steps (`ImplementationSpec-5-1.md` §5, "what a
 * reviewer should distrust"). Exactly two things are the app: the dev server's
 * origin, and the packaged renderer's own directory. Everything else — any
 * origin an agent could cause to be loaded, any other `file://` path on the
 * disk, anything unparseable — is false.
 */
export function createOwnOriginCheck(
  policy: OwnOriginPolicy
): (details: { requestingUrl?: string }) => boolean {
  let devOrigin: string | null = null
  if (policy.devRendererUrl) {
    try {
      devOrigin = new URL(policy.devRendererUrl).origin
    } catch {
      devOrigin = null
    }
  }
  const rootHref = policy.appRootFileUrl ? normalizedDirHref(policy.appRootFileUrl) : null

  return (details: { requestingUrl?: string }): boolean => {
    const raw = details.requestingUrl
    if (typeof raw !== 'string' || raw.length === 0) return false

    // ⚠ THE CHECK HANDLER IS HANDED AN ORIGIN, NOT A URL, AND A `file://` PAGE'S
    // ORIGIN IS THE OPAQUE STRING `file://`. There is no path in it to compare,
    // so it is accepted only when the app itself is loaded from disk — i.e.
    // only when a packaged root was supplied above. What bounds it there is
    // that a packaged build loads exactly one local page and
    // `setWindowOpenHandler` (index.ts) denies every window open, sending links
    // to the OS browser instead: there is no route by which other `file://`
    // content becomes a renderer in this app. In dev `rootHref` is null and
    // this returns false.
    if (raw === 'file://' || raw === 'file:///') return rootHref !== null

    let url: URL
    try {
      url = new URL(raw)
    } catch {
      return false
    }
    if (url.protocol === 'file:') {
      if (rootHref === null) return false
      // `new URL()` has already resolved `..` segments, so a traversal out of
      // the app root cannot survive to be compared here.
      return url.href.toLowerCase().startsWith(rootHref)
    }
    // ⚠ THE SCHEME IS GATED EXPLICITLY RATHER THAN LEFT TO `url.origin`, AND A
    // TEST CAUGHT THIS RATHER THAN A REVIEW. `new URL('blob:http://localhost:5173/x')`
    // reports `.origin === 'http://localhost:5173'` — a blob URL INHERITS the
    // origin of the URL inside it, per the WHATWG spec — so an origin comparison
    // alone accepts `blob:` as the app. The platform is not wrong (such a blob
    // genuinely is same-origin) and the shipped CSP blocks `blob:` documents
    // anyway (F80), but "the CSP would have stopped it" is defence in the wrong
    // place for a permission boundary. Only the two schemes this app is ever
    // loaded over get to reach the origin comparison.
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    return devOrigin !== null && url.origin === devOrigin
  }
}

/* ──────────────────────────── PCM conversion ──────────────────────────────── */

/**
 * Float32 [-1, 1] → signed 16-bit PCM.
 *
 * ⚠ CLAMP RATHER THAN WRAP. Web Audio nominally yields [-1, 1] but does NOT
 * guarantee it — a gain stage or a hot microphone overshoots, and `x * 32768` on
 * an overshoot wraps a loud sample to the OPPOSITE sign. That is audible as a
 * click and, worse, it is audible to a transcriber as a consonant. The
 * asymmetric scale is deliberate: negative full scale is -32768 and positive
 * full scale is 32767, so multiplying both by 32768 would overflow the positive
 * end by exactly one count.
 */
export function toInt16(samples: Float32Array): Int16Array<ArrayBuffer> {
  const out = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]))
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff
  }
  return out
}

/* ────────────────────────── the queue admission policy ────────────────────── */

/**
 * Everything `admitFrame` needs to know, and nothing it could mutate.
 */
export interface QueueState {
  /** The live capture, or null when nothing is being captured. */
  readonly captureId: string | null
  /** Frames currently held by the sink and not yet consumed. */
  readonly queued: number
  /** The sequence number this capture expects to see next. */
  readonly nextSeq: number
}

export type AdmitResult = { readonly admit: true } | { readonly admit: false; readonly reason: VoiceDropReason }

/**
 * Decide one frame's fate.
 *
 * ⚠ IT NEVER THROWS, AND THAT IS A CONTRACT RATHER THAN AN OVERSIGHT. A dropped
 * frame is a NORMAL outcome on this path: `voice:capture-frame` is send-shaped,
 * so there is no reply a caller could read and nothing for an exception to
 * unwind into except an `ipcMain.on` callback, where a throw becomes a process
 * warning triggered by ordinary speech. Every rejection is a counted, named,
 * surfaced drop instead.
 *
 * ⚠ THE ORDER OF THE CHECKS IS THE ORDER OF THE DIAGNOSIS, cheapest and most
 * specific first, so the reason a caller is told is the most useful true one. A
 * frame from a finished capture is stale no matter what else is wrong with it,
 * and a queue-full report is only meaningful once the frame is known to be
 * well-formed and in sequence — otherwise a malformed producer would read as
 * backpressure.
 */
export function admitFrame(state: QueueState, frame: VoiceFrame): AdmitResult {
  if (state.captureId === null || frame.captureId !== state.captureId) {
    return { admit: false, reason: 'stale-session' }
  }
  if (frame.sampleRate !== VOICE_SAMPLE_RATE) {
    // Belt and braces beside the schema's `z.literal(16_000)`. The literal is
    // what actually refuses a wrong rate on the wire; this makes the rule
    // provable without a Zod round trip, and keeps it true for Task 5-2, which
    // will feed this function from somewhere other than the bridge.
    return { admit: false, reason: 'bad-sample-rate' }
  }
  if (frame.sampleCount !== frame.samples.length) {
    // The cross-check the schema deliberately cannot do (see the payload note
    // in `shared/ipc.ts`): Zod validates the two fields separately and has no
    // opinion on whether they agree.
    return { admit: false, reason: 'length-mismatch' }
  }
  if (frame.seq !== state.nextSeq) {
    return { admit: false, reason: 'bad-sequence' }
  }
  if (state.queued >= VOICE_QUEUE_MAX_FRAMES) {
    return { admit: false, reason: 'queue-full' }
  }
  return { admit: true }
}

/**
 * The state transition that goes with the decision above.
 *
 * ⚠ `nextSeq` ADVANCES ON A QUEUE-FULL DROP, AND GETTING THAT WRONG MAKES
 * BACKPRESSURE UNREADABLE. `nextSeq` means "the next sequence number this
 * capture expects to SEE", not "the next one it will keep". A producer that is
 * being dropped for a full queue keeps counting — so if the expectation only
 * moved on admission, the very next frame would be refused as `bad-sequence`
 * and every frame after it too. The sink would still bound, but it would report
 * a malformed producer instead of a stalled consumer, which is the opposite of
 * the diagnosis.
 *
 * A frame rejected for being stale, out of sequence, misdeclared or at the
 * wrong rate does NOT advance anything: none of those is evidence about where
 * the producer's counter is.
 */
export function advanceQueueState(
  state: QueueState,
  frame: VoiceFrame,
  result: AdmitResult
): QueueState {
  if (result.admit) {
    return { ...state, queued: state.queued + 1, nextSeq: frame.seq + 1 }
  }
  if (result.reason === 'queue-full') {
    return { ...state, nextSeq: frame.seq + 1 }
  }
  return state
}
