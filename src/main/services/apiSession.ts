import type { ApiLaunchSpec, ApiSessionHandle } from '../adapters/types'
import type { FetchInitLike, FetchLike, FetchResponseLike } from './modelCatalog'

/**
 * Task 3b-1: the api-mode session primitive — the ONE place Chorus holds a
 * conversation with a model over HTTP.
 *
 * ⚠ A STANDALONE FACTORY, OUTSIDE THE AGENT REGISTRY (D63 Q1, CR-3b.0, Option
 * D, 3-of-3 unanimous). It is not an adapter, is not registered, and does not
 * appear in `agentKindSchema`. `ApiAgentAdapter.startApiSession` stays declared
 * and DORMANT; implementing it *is* the D34-Q5 registry lift, and D52 gives
 * that to Phase 3d. When the lift happens the adapter method becomes a one-line
 * delegation to this function — which is why `types.ts` carries a compile-time
 * assertion tying the two signatures together.
 *
 * ⚠ THIS MODULE HOLDS NO SCRUBBER, AND MUST NOT GROW ONE (D63(d)).
 * The findings' §6 sketch put a `Pick<Scrubber, …>` on the deps; that
 * contradicts their own Q4 ruling, which puts scrubbing at the CONSUMER —
 * `createSessionOutput().ingest()`, driven from `for await (… of
 * handle.receive())`. It is not merely redundant: `createSessionOutput` builds
 * its own scrubber, and a scrubber HOLDS A CARRY across chunk boundaries.
 * `scrubber.ts:50-51` proves its ordering invariant for ONE scrubber, not for a
 * chain — two carries in series is unproven behaviour on the app's only
 * redaction path, and a second scrub path inside the producer is precisely the
 * shape `sessionOutput.ts` was extracted (D46) to prevent.
 *
 *   THE FACTORY EMITS RAW TEXT. THE CONSUMER SCRUBS. ONE SEAM (D45(1)).
 *
 * Deliberately free of electron, of storage, and of Zod — the type imports
 * above are `import type` and erase completely, so this module pulls in no
 * runtime edge to either. It is a pure transport with an injected `fetch`,
 * exactly as `modelCatalog.ts` and `openrouterKeys.ts` are.
 *
 * ⚠ THE CREDENTIAL APPEARS IN EXACTLY ONE PLACE: the `Authorization` header
 * built inside `send()`. Never a URL, never a query string, never a body field,
 * never a log line, and never an error message. The refusal vocabulary below is
 * a FIXED TABLE with zero interpolation of anything that arrived over the wire
 * — which is what makes "the credential is in no output" a structural property
 * rather than a hope (unit case 12).
 *
 * D4-verified 2026-07-26 against OpenRouter's own documentation (full record in
 * `_verify/3b-1/D4-VERIFICATION.md`):
 *   · POST `${baseUrl}/chat/completions`, body `{model, messages, stream:true}`
 *   · SSE framing: `data: ` prefix, `data: [DONE]` sentinel, and keep-alive
 *     COMMENT lines — OpenRouter emits `: OPENROUTER PROCESSING` — which a hand
 *     parser must skip before JSON.parse
 *   · `usage` arrives on the FINAL SSE message and needs NO request flag;
 *     `usage:{include:true}` / `stream_options:{include_usage:true}` are
 *     documented as deprecated and inert, so neither is sent
 *   · a 200 can carry an error IN-BAND mid-stream (top-level `error`,
 *     `finish_reason:'error'`), because the status is already committed — a
 *     decoder that reads only `choices[].delta.content` would render that as a
 *     silent truncation
 */

/** Token counts as reported by the provider. All fields nullable: "not
 *  reported" and "zero" are different facts, and D55's denominator rule applies
 *  here too — a confident-looking zero is worse than a null. */
export interface TokenUsage {
  readonly tokensIn: number | null
  readonly tokensOut: number | null
  readonly tokensCached: number | null
  /**
   * ⚠ THE DOLLARS, OFF THE SAME FRAME AS THE TOKENS — AND ITS ABSENCE HERE WAS
   * EXACTLY WHAT F42 WAS. (Task 5-4, ported from the unmerged F42 fix on
   * `27dc928` so voice refinement can meter itself honestly; the council's own
   * settle path is NOT changed here.)
   *
   * Until now this field's wire value (`usage.cost`) was parsed past and
   * discarded, and a council run's `cost_usd` came instead from the MINTED
   * KEY's own spend counter, read the instant the last stream closed and
   * immediately before the key was deleted. That counter is the gateway's
   * eventually-consistent aggregate — a generation joins it only after
   * accounting finalises, i.e. AFTER the SSE stream ends — so the read races
   * the last turn and the very next call destroys the key, so the number can
   * never be corrected. Measured on run `7dda3482`: `cost_usd` $0.413684 vs a
   * bill of $0.66, within 1.1% of "every turn EXCEPT the last".
   *
   * This field cannot race: it rides the frame that ENDS the generation it
   * prices. If the answer arrived, its price arrived with it.
   *
   * ⚠ AND IT IS DELIBERATELY NOT A LOCAL CALCULATION. Multiplying stored tokens
   * by a published rate needs a price table; `storage.ts` refused to cache one
   * (*"a cached price is a number that is one day wrong in a way that costs
   * money"*) and `model_catalog` has no price columns. The refusal was right —
   * `glm-5.2` moved $0.67/$2.10 → $0.72/$2.25 in six days. The gateway prices
   * its own generation; nothing local can.
   *
   * Null when the provider reported no `cost` (a non-OpenRouter endpoint, or a
   * frame with no usage at all). NULL AND ZERO ARE DIFFERENT FACTS.
   */
  readonly costUsd: number | null
}

export interface ApiSessionDeps {
  /** Absolute endpoint base, e.g. `https://openrouter.ai/api/v1`. Required —
   *  there is no default, because a silent default is how a request reaches a
   *  provider the user did not choose. */
  readonly baseUrl: string
  /** Injected for testability, exactly as openrouterKeys.ts and modelCatalog.ts
   *  do. Defaults to global fetch. */
  readonly fetchImpl?: FetchLike
  /** Non-secret provider headers (D33 resolution e). */
  readonly extraHeaders?: Readonly<Record<string, string>>
  /** Hard ceiling on total streamed bytes. Default RESPONSE_CAP_BYTES. */
  readonly maxResponseBytes?: number
  /** Hard ceiling on wall-clock for one send/receive cycle. Default
   *  RESPONSE_TIMEOUT_MS. */
  readonly maxWallClockMs?: number
  /** ⚠ THE THIRD BOUND, and the only one that bounds SPEND rather than volume
   *  or time — `max_tokens` on the request. Deliberately OPTIONAL and
   *  deliberately WITHOUT a default: a silent output cap would truncate a
   *  council member's answer mid-sentence and look like a model behaviour, and
   *  a silent default is the same failure `baseUrl` refuses to have. Absent
   *  means the model's own default applies. D64(2)'s per-run minted-key cap is
   *  a different instrument at a different layer and belongs to Task 3b-3. */
  readonly maxOutputTokens?: number
  /** Session-scoped external abort. NOT per-operation cancellation (D63 Q3):
   *  it lets an owner — e.g. a council run — abort every member at once without
   *  tracking each handle. Linked to the same internal controller `dispose()`
   *  aborts. */
  readonly signal?: AbortSignal
  /**
   * ⚠ THE F39 INSTRUMENT (D96, Task 3e-1) — a DIAGNOSTIC, not a control. It
   * changes no bound and no behaviour; it reports what the bound saw.
   *
   * F39 asks whether `moonshotai/kimi-k3` is pathological or whether
   * RESPONSE_CAP_BYTES is simply too small for a model that streams its chain
   * of thought. The two answers have OPPOSITE fixes — drop the member, versus
   * raise the cap — and until this hook existed the question was unanswerable
   * from outside: `totalBytes` was accumulated, compared to the cap, and then
   * discarded, so a refusal said "too large" and nothing else.
   *
   * ⚠ ITS FIRST USE ANSWERED A DIFFERENT QUESTION THAN EXPECTED, AND THE LESSON
   * BELONGS NEXT TO THE HOOK. Run `4c17069c` measured 4,000,372 capped bytes
   * against a 692,858-byte largest COMPLETED turn, and that 5.8× was first read
   * as "pathological". The reading was retracted: bytes/token differs 20× ACROSS
   * MODELS here (9.9 for opus-5, 205.1 for qwen3-coder), so a byte ratio between
   * two models is not a ratio of how much they said. **A ratio is only
   * meaningful when both measurements share a unit.** Divide by `onUsage`'s
   * `tokens_out` before comparing anything this hook reports.
   *
   * ⚠ ONE CALL PER SEND/RECEIVE CYCLE, ON EVERY EXIT PATH — it fires from the
   * `finally`, so a capped turn, a completed turn, a timeout and an interrupted
   * read all report. That is deliberate: a refusal figure ALONE cannot
   * distinguish F39's two hypotheses. "4 MB capped, largest completed turn
   * 180 KB" says pathological; "4 MB capped, largest completed turn 3.6 MB"
   * says the cap is too small. THE COMPARISON IS THE MEASUREMENT, so the
   * successful turns must report too.
   *
   * ⚠ IT CARRIES NO STREAM CONTENT AND MUST NEVER BE WIDENED TO. Model output
   * can contain a credential — that is why the scrub seam exists — and a
   * diagnostic that leaked one would be a worse defect than the one it
   * diagnoses. Byte counts only.
   */
  readonly onStreamBytes?: (info: {
    /** Bytes received this cycle, including the frame that crossed the cap. */
    readonly bytes: number
    /** The cap in force, emitted alongside so the line stays readable after
     *  the constant moves. */
    readonly capBytes: number
    /** True when the cap fired and refused this cycle. */
    readonly capped: boolean
  }) => void
  /** D63(g). Optional because a consumer that does not meter must not be
   *  obliged to carry it. NEVER routed through receive(): a final text yield
   *  would flow through the scrubber and the ring buffer and be rendered in the
   *  transcript as though the model had said it. Fires at most once per cycle,
   *  and only when the provider actually reported usage. */
  readonly onUsage?: (usage: TokenUsage) => void
  /**
   * How a failure becomes visible.
   *
   * ⚠ ON THE DEPS FOR THE SAME REASON `onUsage` IS (D63(g)), and the reasoning
   * is worth stating because the tempting fix is again the wrong one.
   * `ApiSessionHandle` is the SHARED primitive D45(2) binds the future
   * interactive chat pane to, and D63 Q3 ratified it AS DECLARED — four
   * members, no failure channel. But `receive()` yields `string`, so a refusal
   * has nowhere to go: throwing out of the iteration is what unit case 11
   * forbids, and a refusal yielded as text would be rendered as model output.
   * `ApiSessionDeps` is the FACTORY's own contract, so the refusal lives here
   * and the shared handle is untouched.
   *
   * A consumer that omits it sees a stream that simply ends. Every real
   * consumer passes it — `api:probe` does, and that is how its `reason` field
   * is filled. Fires AT MOST ONCE per cycle.
   */
  readonly onRefusal?: (reason: string) => void
  /**
   * Task 5-4 follow-up: the provider's `finish_reason` for the cycle, when a
   * frame carried one — `'stop'`, `'length'`, `'content_filter'`, … as the
   * provider spells it, forwarded verbatim and never interpreted here.
   *
   * ⚠ ON THE DEPS, LIKE `onUsage`, AND FOR THE SAME REASON: a consumer that
   * does not care carries nothing, and it never travels as text through the
   * stream. Fires at most once per cycle, from the same `finally` as
   * `onUsage`, so a capped or timed-out cycle still reports what it saw.
   *
   * WHY IT EXISTS: voice refinement caps output tokens from the dictation's
   * length. A model that spends the cap thinking returns a reply cut off
   * mid-sentence with `finish_reason: 'length'`, and a cut-off tail can pass a
   * length-ratio check. Without this signal a truncated refinement is
   * indistinguishable from a complete one — and the user has already stopped
   * proof-reading. The council does not consume it; nothing else changes.
   */
  readonly onFinishReason?: (reason: string) => void
}

/**
 * ⚠ MEASURED, NOT JUDGED — AND THE PREVIOUS VALUE WAS THE OTHER WAY ROUND.
 *
 * It was 4_000_000, argued as HALF `modelCatalog`'s `MODELS_RESPONSE_CAP_BYTES`
 * on the reasoning that *"4 MB is roughly a million tokens of prose"*. **That
 * arithmetic was about TEXT and this bound counts SSE FRAMES**, and the F39
 * instrument measured the difference across two real runs:
 *
 * | model | bytes per OUTPUT TOKEN (worst observed) |
 * |---|---|
 * | `anthropic/claude-opus-5` | 13.7 |
 * | `z-ai/glm-5.2` | 134.0 |
 * | `qwen/qwen3-coder` | 213.3 |
 * | `moonshotai/kimi-k3` | **407.2** |
 *
 * A 30× spread, and it is a property of each model's chunking granularity — not
 * of how much it said. At 407 bytes/token, 4 MB is ~9,800 tokens, not a million:
 * the cap was ~100× tighter than its own comment believed, for the one member
 * that kept hitting it.
 *
 * **THE NUMBER, DERIVED PER MEMBER — each model's own worst ratio × its OWN
 * allowance, never one model's ratio against another's allowance:**
 *
 *   kimi    407.2 × 16,000 = **6,515,200**  ← the binding case
 *   qwen    213.3 × 16,000 =   3,412,800
 *   glm     134.0 × 16,000 =   2,144,000
 *   arbiter  13.7 × 32,000 =     438,400
 *
 * 8_000_000 is **1.23× the binding case**, and tolerates up to **500
 * bytes/token** at a 16,000-token allowance.
 *
 * ⚠ THE FIRST VERSION OF THIS COMMENT DERIVED THE SAME NUMBER THE WRONG WAY —
 * qwen's 205.1 ratio × the ARBITER's 32,000 allowance — which is a cross-model
 * product, the exact unit error the 3e-1 retraction was filed for. It happened
 * to land within 1% of the correct figure, which is precisely why it is called
 * out here instead of quietly replaced.
 *
 * ⚠ AND IT IS LOAD-BEARING ON A REAL TURN, NOT ONLY ON ARITHMETIC. In run
 * `c06874ad` kimi's critique streamed **4,168,377 bytes — 104% of the old
 * cap** — and completed. Under 4_000_000 that turn refuses and the run is
 * partial again. Its positions turn in the same run streamed 2,446,913, which
 * the old cap would have passed: kimi's streams straddle the old line, and that
 * variance is why the bound is derived from the allowance rather than from any
 * single observation.
 *
 * ⚠ THIS DISSOLVES THE DELIBERATE ASYMMETRY WITH `modelCatalog`, AND THE
 * DISSOLUTION IS THE POINT RATHER THAN AN OVERSIGHT. The asymmetry rested on a
 * premise the measurement refuted — that a council answer over 4 MB is a
 * runaway. Kimi's 4.17 MB critique was a 10,237-token answer inside a
 * 16,000-token budget. The two caps are equal now because nobody has yet
 * measured a reason for them to differ.
 *
 * ⚠ AND IT IS STILL THE WRONG SHAPE, WHICH IS RECORDED HERE RATHER THAN FIXED
 * OUT OF SCOPE. A byte cap and a token allowance bounding the same stream
 * without ever being reconciled is the actual defect F39 exposed; the honest fix
 * is a PER-TURN bound derived from that turn's own allowance
 * (`maxOutputTokens × a ratio ceiling`), which `maxResponseBytes` already
 * accepts as a dep. That is a councilService change and 3e-2's scope does not
 * reach it. **If a member ever exceeds 500 bytes/token, that fix is the answer —
 * not another global raise.**
 */
export const RESPONSE_CAP_BYTES = 8_000_000

/**
 * ⚠ NOT `openrouterKeys`' 10 s, and the difference is the point: a management
 * API call is one round trip, while a reasoning model's FIRST token can
 * legitimately take a minute.
 *
 * This bounds THE WHOLE CYCLE — the fetch round trip plus every read — not the
 * gap between chunks. An idle-gap timeout is the more precise instrument and is
 * deliberately NOT built here: it needs a measured idle distribution that
 * nobody has yet, and guessing one would silently kill slow-but-healthy
 * streams. Stated rather than silently chosen.
 */
export const RESPONSE_TIMEOUT_MS = 120_000

/**
 * The fixed refusal vocabulary. NOTHING FROM THE WIRE IS EVER INTERPOLATED
 * INTO ONE OF THESE — not the response body, not an exception message, not a
 * `cause` chain.
 *
 * That is not caution for its own sake. D4-verified 2026-07-26: OpenRouter's
 * error `metadata` can carry provider-returned content including
 * `flagged_input`, which is an echo of the request; and a `TypeError: fetch
 * failed` carries a `cause` chain that can include the request AND ITS HEADERS,
 * which here means the credential. Both are discarded wholesale, exactly as
 * `openrouterKeys.call` and `refreshProviderModels` discard them.
 */
/** Exported (Task 5-4) so a consumer can CLASSIFY a refusal — timeout versus
 *  transport versus provider refusal — by identity against this table rather
 *  than by matching prose. The strings themselves stay the contract. */
export const API_SESSION_FAILURE = {
  unreachable: 'Could not reach the provider.',
  authFailed: 'Authentication failed — the credential was rejected.',
  paymentRequired: 'The provider refused the request for insufficient credit.',
  rateLimited: 'Rate limited by the provider.',
  providerError: 'The provider returned an error.',
  noStream: 'The provider returned no response stream.',
  /** A frame that is not JSON, is not an object, or is a truncated tail. The
   *  received shape is NEVER named — that is a body echo wearing a diagnostic
   *  hat. */
  unrecognized: 'The provider returned an unrecognized response stream.',
  /** D4 obligation 3: a 200 whose stream carries an in-band `error`. */
  midStream: 'The provider reported an error partway through the response.',
  interrupted: 'The response stream ended unexpectedly.',
  tooLarge: 'The response exceeded its size limit and was stopped.',
  timedOut: 'The response exceeded its time limit and was stopped.',
  busy: 'This session already has a request in flight.',
  disposed: 'This session has been disposed.'
} as const

function unexpectedStatusFailure(status: number): string {
  return `Unexpected response (${status}).`
}

/** `FetchInitLike` describes modelCatalog's GET and therefore has no `body`.
 *  Extended rather than re-declared, per the spec's reuse instruction. */
interface ApiFetchInit extends FetchInitLike {
  readonly body: string
}

type BodyReader = ReturnType<NonNullable<FetchResponseLike['body']>['getReader']>

interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant'
  readonly content: string
}

/** Distinguishes "the wall clock won the race" from a real read result. A
 *  symbol, so no response value can ever impersonate it. */
const DEADLINE = Symbol('api-session-deadline')

export function createApiSession(spec: ApiLaunchSpec, deps: ApiSessionDeps): ApiSessionHandle {
  const fetchImpl = deps.fetchImpl ?? (fetch as unknown as FetchLike)
  const maxResponseBytes = deps.maxResponseBytes ?? RESPONSE_CAP_BYTES
  const maxWallClockMs = deps.maxWallClockMs ?? RESPONSE_TIMEOUT_MS
  // A trailing slash is a KNOWN failure mode on this route (recorded in
  // codexAdapter.buildLaunch and inherited by modelCatalog).
  const baseUrl = deps.baseUrl.replace(/\/+$/, '')

  // ⚠ ONE controller for the whole session. `dispose()` aborts it, and D63 Q3
  // ruled that dispose() is the SOLE cancellation mechanism — there is no
  // per-operation cancel, deliberately.
  const controller = new AbortController()

  const messages: ChatMessage[] = spec.systemPrompt
    ? [{ role: 'system', content: spec.systemPrompt }]
    : []

  // ⚠ The live reader stays visible to dispose() for as long as the request is
  // in flight. An earlier shape had the iterator take ownership of it, which
  // left dispose() with nothing to cancel the moment iteration began — i.e.
  // exactly during the window dispose() exists for. `claimed` carries the
  // single-consumption contract instead.
  let stream: BodyReader | null = null
  let claimed = false
  let disposed = false
  let aborted = false
  let refused = false
  let deadlineTimer: ReturnType<typeof setTimeout> | null = null
  let deadlinePromise: Promise<typeof DEADLINE> | null = null

  // An external signal is LINKED, not adopted: the listener is removed on
  // dispose so a long-lived owner signal (a council run outliving one member)
  // cannot retain a dead session through its listener list.
  const onExternalAbort = (): void => {
    aborted = true
    controller.abort()
  }
  if (deps.signal) {
    if (deps.signal.aborted) onExternalAbort()
    else deps.signal.addEventListener('abort', onExternalAbort)
  }

  /** At most once per cycle (see `onRefusal`'s docstring). */
  function refuse(reason: string): void {
    if (refused) return
    refused = true
    deps.onRefusal?.(reason)
  }

  function armDeadline(): void {
    clearDeadline()
    deadlinePromise = new Promise<typeof DEADLINE>((resolve) => {
      deadlineTimer = setTimeout(() => resolve(DEADLINE), maxWallClockMs)
    })
  }

  function clearDeadline(): void {
    if (deadlineTimer !== null) {
      clearTimeout(deadlineTimer)
      deadlineTimer = null
    }
    deadlinePromise = null
  }

  async function cancelReader(r: BodyReader): Promise<void> {
    await r.cancel().catch(() => undefined)
  }

  /**
   * ⚠ THE DANGEROUS PART. Three things a naive decoder gets wrong, each of
   * which produces a bug invisible in a happy-path test:
   *
   *  1. A FRAME SPLIT ACROSS READS. `data: {"choi` / `ces":[…]}\n\n` must yield
   *     once — so a partial line is buffered and NEVER parsed.
   *  2. MULTIPLE FRAMES IN ONE READ. Split on the delimiter, not on the read
   *     boundary.
   *  3. A MULTI-BYTE CHARACTER SPLIT ACROSS READS. `TextDecoder` is used in
   *     STREAMING mode; decoding each Uint8Array independently corrupts any
   *     character straddling a boundary, and the failure is data-dependent —
   *     it passes every ASCII test and appears the first time a council member
   *     writes an em-dash.
   *
   * Single-consumption: the first iterator to start claims the reader, so a
   * second `receive()` yields nothing rather than interleaving two consumers
   * over one stream.
   */
  async function* drain(): AsyncGenerator<string, void, undefined> {
    const active = stream
    if (active === null || claimed) return
    claimed = true

    const decoder = new TextDecoder()
    const deadline = deadlinePromise
    let lineBuffer = ''
    let totalBytes = 0
    // D96: set by the cap branch so the diagnostic emitted from `finally` can
    // say WHICH bound ended the cycle. A plain flag rather than a richer
    // outcome enum — the only distinction F39 needs is capped vs not.
    let capped = false
    let assistant = ''
    let usage: TokenUsage | null = null
    let finishReason: string | null = null

    // Set by the frame processor to end the stream; checked after each read so
    // the yields below stay inside one loop body.
    let sawDone = false
    let failure: string | null = null

    /** Complete lines only. Returns the deltas this line contributed. */
    const processLine = (rawLine: string): string | null => {
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
      // Event separator.
      if (line.length === 0) return null
      // ⚠ D4-verified: OpenRouter emits `: OPENROUTER PROCESSING` keep-alives.
      // Per the SSE spec a comment is ignorable, and JSON.parse would throw on
      // one — which is how a keep-alive becomes a spurious refusal.
      if (line.startsWith(':')) return null
      // `event:` / `id:` / `retry:` fields are not used by this transport.
      if (!line.startsWith('data:')) return null
      // SSE strips ONE optional leading space from a field value.
      const raw = line.slice('data:'.length)
      const payload = raw.startsWith(' ') ? raw.slice(1) : raw
      if (payload === '[DONE]') {
        sawDone = true
        return null
      }
      let frame: unknown
      try {
        frame = JSON.parse(payload)
      } catch {
        // The parse error names a byte offset and can quote content. Fixed
        // string only — and a refusal, never a throw (unit case 11).
        failure = API_SESSION_FAILURE.unrecognized
        return null
      }
      const record = asRecord(frame)
      if (record === null) {
        failure = API_SESSION_FAILURE.unrecognized
        return null
      }
      // D4 obligation 3: the status was already committed, so a mid-stream
      // failure arrives here rather than as a non-2xx. Without this the stream
      // would render as a silent truncation.
      if (record.error !== undefined && record.error !== null) {
        failure = API_SESSION_FAILURE.midStream
        return null
      }
      const reported = readUsage(record)
      if (reported !== null) usage = reported
      const finished = readFinishReason(record)
      if (finished !== null) finishReason = finished
      return readDelta(record)
    }

    try {
      for (;;) {
        if (aborted) return
        // The deadline bounds the WHOLE cycle, so it is raced here as well as
        // around the fetch in send().
        const raced = deadline === null ? await active.read() : await Promise.race([active.read(), deadline])
        if (raced === DEADLINE) {
          // Cancel BEFORE abort so the underlying connection is released
          // rather than left to GC (modelCatalog.readCapped's precedent).
          await cancelReader(active)
          controller.abort()
          refuse(API_SESSION_FAILURE.timedOut)
          return
        }
        if (raced.done) break
        const value = raced.value
        if (!value) continue

        totalBytes += value.byteLength
        if (totalBytes > maxResponseBytes) {
          // D96: record that the cap is what ended this cycle. The figure is
          // emitted once, from the `finally` below, on every exit path.
          capped = true
          await cancelReader(active)
          controller.abort()
          refuse(API_SESSION_FAILURE.tooLarge)
          return
        }

        lineBuffer += decoder.decode(value, { stream: true })
        const lines = lineBuffer.split('\n')
        // The tail is a PARTIAL line and is held, never parsed.
        lineBuffer = lines.pop() ?? ''
        for (const rawLine of lines) {
          // ⚠ Re-checked INSIDE the frame loop, not only at the top of the read
          // loop. One read can carry several frames, so a dispose() between two
          // yields would otherwise keep draining an already-received buffer —
          // and a consumer counting "chunks after dispose" would read that as
          // the request having run on, which is the opposite of the truth.
          if (aborted) return
          const delta = processLine(rawLine)
          if (delta !== null && delta.length > 0) {
            assistant += delta
            yield delta
          }
          if (failure !== null || sawDone) break
        }
        if (failure !== null) {
          await cancelReader(active)
          controller.abort()
          refuse(failure)
          return
        }
        if (sawDone) break
      }

      // Flush the streaming decoder and process a residual complete-looking
      // line. A server that ended without its final newline would otherwise
      // drop its last frame silently; a residual that does NOT parse is a
      // truncation, and saying so beats reporting a short answer as complete.
      if (!sawDone && !aborted) {
        lineBuffer += decoder.decode()
        const residual = lineBuffer.trim()
        if (residual.length > 0 && residual.startsWith('data:')) {
          const delta = processLine(residual)
          if (delta !== null && delta.length > 0) {
            assistant += delta
            yield delta
          }
        }
        if (failure !== null) {
          refuse(failure)
          return
        }
      }
    } catch {
      // A read rejects when the controller aborts (dispose, external signal, or
      // one of the caps) and when the connection drops. Discarded WHOLESALE —
      // an abort exception's cause chain can carry the request and its headers.
      if (!aborted) refuse(API_SESSION_FAILURE.interrupted)
      return
    } finally {
      // ⚠ D96 — EMITTED HERE, AND THE PLACEMENT IS THE POINT. `finally` is the
      // one place every exit path passes through: capped, completed, timed
      // out, interrupted, disposed. Reporting only at the refusal would give
      // F39 a number with nothing to compare it against, which is the state
      // that made the question unanswerable in the first place.
      deps.onStreamBytes?.({ bytes: totalBytes, capBytes: maxResponseBytes, capped })
      clearDeadline()
      // The cycle is over: release the reader reference so a later send() is
      // not refused as busy and dispose() has nothing stale to cancel.
      if (stream === active) stream = null
      // In-memory conversation state only; NO persistence (a non-goal — 3b-3
      // decides what a council run stores). It is what makes a second send()
      // on this handle a real second turn rather than an amnesiac first one.
      if (assistant.length > 0) messages.push({ role: 'assistant', content: assistant })
      if (usage !== null) deps.onUsage?.(usage)
      if (finishReason !== null) deps.onFinishReason?.(finishReason)
    }
  }

  return {
    sessionId: spec.sessionId,

    async send(message: string): Promise<void> {
      if (disposed) {
        refuse(API_SESSION_FAILURE.disposed)
        return
      }
      if (stream !== null) {
        refuse(API_SESSION_FAILURE.busy)
        return
      }
      messages.push({ role: 'user', content: message })

      // The cycle's clock starts HERE, before the round trip — a provider that
      // never answers is bounded by the same instrument as one that streams
      // forever.
      armDeadline()
      const deadline = deadlinePromise

      const init: ApiFetchInit = {
        method: 'POST',
        headers: {
          // ⚠ THE ONLY PLACE THE CREDENTIAL APPEARS.
          authorization: `Bearer ${spec.credential.value}`,
          'content-type': 'application/json',
          accept: 'text/event-stream',
          ...(deps.extraHeaders ?? {})
        },
        body: JSON.stringify({
          model: spec.modelId,
          messages,
          stream: true,
          // Omitted entirely when unset — an absent field is the model's own
          // default, which is not the same as a guessed one.
          ...(deps.maxOutputTokens === undefined ? {} : { max_tokens: deps.maxOutputTokens })
        }),
        signal: controller.signal
      }

      let res: FetchResponseLike
      try {
        const raced =
          deadline === null
            ? await fetchImpl(`${baseUrl}/chat/completions`, init)
            : await Promise.race([fetchImpl(`${baseUrl}/chat/completions`, init), deadline])
        if (raced === DEADLINE) {
          controller.abort()
          clearDeadline()
          refuse(API_SESSION_FAILURE.timedOut)
          return
        }
        res = raced
      } catch {
        // Leakage path 2 (probeCredential's words): a fetch exception's cause
        // chain can carry the request, headers included. Discard it wholesale.
        clearDeadline()
        if (aborted) return
        refuse(API_SESSION_FAILURE.unreachable)
        return
      }

      // ⚠ A NON-2xx BODY IS CANCELLED UNREAD AND THE STATUS ALONE IS MAPPED
      // (D58). This is the path most likely of all to echo a key, and
      // D4-verified 2026-07-26 the error `metadata` can carry provider content
      // including `flagged_input` — an echo of the request.
      if (res.status < 200 || res.status >= 300) {
        void res.body?.cancel().catch(() => undefined)
        clearDeadline()
        if (res.status === 401 || res.status === 403) refuse(API_SESSION_FAILURE.authFailed)
        else if (res.status === 402) refuse(API_SESSION_FAILURE.paymentRequired)
        else if (res.status === 429) refuse(API_SESSION_FAILURE.rateLimited)
        else if (res.status >= 500) refuse(API_SESSION_FAILURE.providerError)
        else refuse(unexpectedStatusFailure(res.status))
        return
      }

      const body = res.body
      if (!body) {
        clearDeadline()
        refuse(API_SESSION_FAILURE.noStream)
        return
      }
      stream = body.getReader()
      claimed = false
    },

    receive(): AsyncIterable<string> {
      return drain()
    },

    /**
     * The SOLE cancellation mechanism (D63 Q3) — and NOT OPTIONAL, even on a
     * cycle that already ended cleanly. Two things outlive a session that is
     * merely finished, and both are released only here:
     *
     *  1. ⚠ THE DEADLINE TIMER. `send()` arms it before the round trip, so a
     *     `send()` whose stream is never consumed leaves a `setTimeout` armed
     *     for up to `maxWallClockMs` — 120 s by default — holding this closure,
     *     and with it the credential-bearing request state, past any point the
     *     caller still cares about. A NORMAL DRAIN clears it (drain's `finally`
     *     calls `clearDeadline()`); an un-drained `send()` does not. Measured,
     *     not assumed: instrumenting `setTimeout`/`clearTimeout` shows exactly
     *     one timer still armed after `send()` with no `receive()`.
     *
     *  2. ⚠ THE EXTERNAL SIGNAL LISTENER. `deps.signal` is LINKED, not adopted,
     *     and the listener is removed HERE and nowhere else — deliberately, but
     *     it means a session that drained normally and was never disposed stays
     *     on its owner's listener list. That matters precisely where the option
     *     exists to be used: a council run holds ONE owner signal across every
     *     member, so members that finished but were never disposed accumulate
     *     on it for the life of the run.
     *
     * Neither is a correctness bug — both are bounded and neither can affect
     * output — and neither is reachable except by skipping `dispose()`. They
     * are the reason skipping it is a contract violation rather than a
     * harmless shortcut. **Call it in a `finally`.**
     *
     * Idempotent: a second call is a no-op, so the `finally` costs nothing on
     * a path that already disposed.
     */
    async dispose(): Promise<void> {
      if (disposed) return
      disposed = true
      aborted = true
      if (deps.signal) deps.signal.removeEventListener('abort', onExternalAbort)
      clearDeadline()
      // Abort first — the user asked to stop NOW — then AWAIT teardown, so a
      // caller that awaits dispose() knows the reader is released rather than
      // merely scheduled for release. (The cap paths cancel-then-abort instead:
      // there the goal is to release a healthy connection cleanly.)
      controller.abort()
      const active = stream
      stream = null
      if (active !== null) await cancelReader(active)
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/** `choices[0].delta.content`, defensively — every level may be absent on a
 *  legitimate frame (the final usage-only frame carries `choices: []`). */
function readDelta(frame: Record<string, unknown>): string | null {
  if (!Array.isArray(frame.choices)) return null
  const choice = asRecord(frame.choices[0])
  if (choice === null) return null
  const delta = asRecord(choice.delta)
  if (delta === null) return null
  return typeof delta.content === 'string' ? delta.content : null
}

/** `choices[0].finish_reason`, defensively. Null on every frame but the one
 *  that ends the choice — and null, not '', when a provider omits it. Read
 *  from every frame rather than only the last: OpenRouter's usage-only final
 *  frame carries `choices: []`, so the reason arrives on the frame BEFORE it. */
function readFinishReason(frame: Record<string, unknown>): string | null {
  if (!Array.isArray(frame.choices)) return null
  const choice = asRecord(frame.choices[0])
  if (choice === null) return null
  const reason = choice.finish_reason
  return typeof reason === 'string' && reason.length > 0 ? reason : null
}

/** D63(g) / D64(2). Null when the frame reports no usage — which is every
 *  frame but the last. Each field is independently nullable: "not reported"
 *  and "zero" are different facts (D55). */
function readUsage(frame: Record<string, unknown>): TokenUsage | null {
  const usage = asRecord(frame.usage)
  if (usage === null) return null
  const promptDetails = asRecord(usage.prompt_tokens_details)
  return {
    tokensIn: numberOrNull(usage.prompt_tokens),
    tokensOut: numberOrNull(usage.completion_tokens),
    tokensCached: promptDetails === null ? null : numberOrNull(promptDetails.cached_tokens),
    // ⚠ `usage.cost`, AND POINTEDLY NOT `cost_details.upstream_inference_cost`.
    // D4-verified 2026-08-01 against OpenRouter's usage-accounting docs: `cost`
    // is "the total amount charged to your account" and needs no request flag,
    // arriving on the last SSE message — the same finding that put `usage` on
    // this frame at all (3b-1 D4 obligation 2). The `upstream_inference_cost`
    // sibling is what a BYOK provider billed DIRECTLY, i.e. the one part of the
    // bill that is NOT on the OpenRouter invoice — adding it would over-report
    // by exactly the amount the account was never charged.
    costUsd: numberOrNull(usage.cost)
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
