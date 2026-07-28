import { describe, expect, it } from 'vitest'
import type { ApiLaunchSpec, ApiSessionHandle } from '../adapters/types'
import {
  createApiSession,
  RESPONSE_CAP_BYTES,
  RESPONSE_TIMEOUT_MS,
  type ApiSessionDeps
} from './apiSession'
import type { FetchInitLike, FetchLike, FetchResponseLike } from './modelCatalog'

/**
 * Task 3b-1: the api-mode transport's unit table, against a stub `fetchImpl`.
 * NO NETWORK — every case here is a decoder or a lifecycle assertion; the
 * things a fake fetch structurally cannot prove (that the streaming is real,
 * that `dispose()` terminates a live HTTP request, that the scrub seam is in
 * the path) are the live G2 drives, not these.
 *
 * ⚠ THE CASE THAT MATTERS IS 12. Everything above it can be right while the
 * credential leaks into a refusal, and a refusal is the string a user sees.
 */

/** A realistic-SHAPED fake, assembled by concatenation so this file never
 *  contains a complete key shape for scripts/secret-grep.mjs (G4 scans src/). */
const FAKE_KEY = 'sk-or-v1-' + '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

const SPEC: ApiLaunchSpec = {
  sessionId: '11111111-2222-3333-4444-555555555555',
  modelId: 'moonshotai/kimi-k3',
  credential: { envVarName: 'OPENROUTER_API_KEY', value: FAKE_KEY, isSecret: true }
}

const BASE_URL = 'https://example.invalid/api/v1'

function frame(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`
}

interface StubState {
  cancelled: boolean
  reads: number
  init: FetchInitLike | null
  url: string | null
}

/**
 * A response whose reader replays `chunks` in order, one per `read()`.
 *
 * `hangAfter` makes the reader block once that many chunks have been served,
 * rejecting only when the request's own signal aborts — which is how cases 8
 * and 9 get a stream that is genuinely in flight rather than merely slow.
 */
function stubFetch(
  chunks: readonly (string | Uint8Array)[],
  opts: { status?: number; hangAfter?: number; noBody?: boolean } = {}
): { fetchImpl: FetchLike; state: StubState } {
  const state: StubState = { cancelled: false, reads: 0, init: null, url: null }
  const encoder = new TextEncoder()
  const bytes = chunks.map((c) => (typeof c === 'string' ? encoder.encode(c) : c))
  let index = 0

  const fetchImpl: FetchLike = async (url, init) => {
    state.url = url
    state.init = init
    const signal = init.signal
    const res: FetchResponseLike = {
      status: opts.status ?? 200,
      body: opts.noBody
        ? null
        : {
            cancel: async () => {
              state.cancelled = true
            },
            getReader: () => ({
              read: async () => {
                if (opts.hangAfter !== undefined && index >= opts.hangAfter) {
                  // In flight and going nowhere until the caller aborts.
                  return new Promise<{ done: boolean; value?: Uint8Array }>((_resolve, reject) => {
                    if (signal.aborted) {
                      reject(new Error('aborted'))
                      return
                    }
                    signal.addEventListener('abort', () => reject(new Error('aborted')))
                  })
                }
                if (index >= bytes.length) return { done: true }
                state.reads++
                return { done: false, value: bytes[index++] }
              },
              cancel: async () => {
                state.cancelled = true
              }
            })
          }
    }
    return res
  }
  return { fetchImpl, state }
}

interface Run {
  handle: ApiSessionHandle
  yields: string[]
  refusals: string[]
  usages: unknown[]
}

function start(fetchImpl: FetchLike, extra: Partial<ApiSessionDeps> = {}): Run {
  const refusals: string[] = []
  const usages: unknown[] = []
  const deps: ApiSessionDeps = {
    baseUrl: BASE_URL,
    fetchImpl,
    onRefusal: (r) => refusals.push(r),
    onUsage: (u) => usages.push(u),
    ...extra
  }
  return { handle: createApiSession(SPEC, deps), yields: [], refusals, usages }
}

async function drive(run: Run): Promise<Run> {
  await run.handle.send('hello')
  for await (const chunk of run.handle.receive()) run.yields.push(chunk)
  return run
}

describe('createApiSession — SSE decoding', () => {
  it('case 1: frames arriving one per read yield each delta in order', async () => {
    const { fetchImpl } = stubFetch([frame('Hel'), frame('lo, '), frame('world'), 'data: [DONE]\n\n'])
    const run = await drive(start(fetchImpl))
    expect(run.yields).toEqual(['Hel', 'lo, ', 'world'])
    expect(run.refusals).toEqual([])
  })

  it('case 2: ONE frame split across two reads yields once, correctly assembled', async () => {
    const whole = frame('split-frame-payload')
    const cut = Math.floor(whole.length / 2)
    const { fetchImpl } = stubFetch([whole.slice(0, cut), whole.slice(cut), 'data: [DONE]\n\n'])
    const run = await drive(start(fetchImpl))
    expect(run.yields).toEqual(['split-frame-payload'])
  })

  it('case 3: two frames in ONE read yield twice', async () => {
    const { fetchImpl } = stubFetch([frame('alpha') + frame('beta'), 'data: [DONE]\n\n'])
    const run = await drive(start(fetchImpl))
    expect(run.yields).toEqual(['alpha', 'beta'])
  })

  it('case 4: a multi-byte UTF-8 character split across reads is not corrupted', async () => {
    // An em-dash is three UTF-8 bytes, and the split lands INSIDE it. Decoding
    // each Uint8Array independently would emit U+FFFD here and pass every
    // ASCII test in this file.
    const whole = new TextEncoder().encode(frame('an — em dash 日本語'))
    const emDashStart = whole.indexOf(0xe2)
    expect(emDashStart).toBeGreaterThan(0)
    const { fetchImpl } = stubFetch(
      [whole.slice(0, emDashStart + 1), whole.slice(emDashStart + 1), 'data: [DONE]\n\n'],
      {}
    )
    const run = await drive(start(fetchImpl))
    expect(run.yields.join('')).toBe('an — em dash 日本語')
    expect(run.yields.join('')).not.toContain('�')
  })

  it('case 5: keep-alive / comment lines are ignored and produce no empty yield', async () => {
    // ⚠ The literal OpenRouter emits (D4-verified 2026-07-26).
    const { fetchImpl } = stubFetch([
      ': OPENROUTER PROCESSING\n\n',
      frame('after'),
      ': OPENROUTER PROCESSING\n\n',
      // A frame whose delta is an empty string must not surface either.
      `data: ${JSON.stringify({ choices: [{ delta: { content: '' } }] })}\n\n`,
      // A usage-only final frame carries `choices: []`.
      `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 7, completion_tokens: 3 } })}\n\n`,
      'data: [DONE]\n\n'
    ])
    const run = await drive(start(fetchImpl))
    expect(run.yields).toEqual(['after'])
    expect(run.yields.every((y) => y.length > 0)).toBe(true)
    expect(run.usages).toEqual([{ tokensIn: 7, tokensOut: 3, tokensCached: null }])
  })

  it('case 6: the [DONE] sentinel completes the iteration and stops the read loop', async () => {
    const { fetchImpl, state } = stubFetch([
      frame('one'),
      'data: [DONE]\n\n',
      // Never reached: [DONE] ends the loop, so this read is never issued.
      frame('never')
    ])
    const run = await drive(start(fetchImpl))
    expect(run.yields).toEqual(['one'])
    expect(state.reads).toBe(2)
    expect(run.refusals).toEqual([])
  })
})

describe('createApiSession — the two caps (D63(e))', () => {
  it('case 7: the BYTE cap ends the iteration, cancels the reader and surfaces a refusal', async () => {
    const { fetchImpl, state } = stubFetch([frame('a'.repeat(200)), frame('b'.repeat(200)), frame('c')])
    const run = await drive(start(fetchImpl, { maxResponseBytes: 250 }))
    expect(run.yields).toEqual(['a'.repeat(200)])
    expect(run.refusals).toEqual(['The response exceeded its size limit and was stopped.'])
    expect(state.cancelled).toBe(true)
  })

  it('case 8: the WALL-CLOCK cap ends the iteration, cancels the reader and surfaces a refusal', async () => {
    // One chunk, then the stream hangs — the shape a byte cap cannot catch.
    const { fetchImpl, state } = stubFetch([frame('slow')], { hangAfter: 1 })
    const run = await drive(start(fetchImpl, { maxWallClockMs: 30 }))
    expect(run.yields).toEqual(['slow'])
    expect(run.refusals).toEqual(['The response exceeded its time limit and was stopped.'])
    expect(state.cancelled).toBe(true)
  })

  // ── D96 / Task 3e-1: the F39 instrument ─────────────────────────────────
  // These do not test a bound; they test that the bound REPORTS what it saw.
  // F39 asks whether one member is pathological or the cap is too small, and
  // the two answers have opposite fixes. Before this hook the byte count was
  // compared to the cap and discarded, so the question could not be answered
  // from outside the process at all.

  it('D96: a CAPPED cycle reports its byte count and the cap it was measured against', async () => {
    const seen: { bytes: number; capBytes: number; capped: boolean }[] = []
    const { fetchImpl } = stubFetch([frame('a'.repeat(200)), frame('b'.repeat(200)), frame('c')])
    const run = await drive(
      start(fetchImpl, { maxResponseBytes: 250, onStreamBytes: (i) => seen.push(i) })
    )
    // The refusal is UNCHANGED — this is a diagnostic, not a behaviour change.
    expect(run.refusals).toEqual(['The response exceeded its size limit and was stopped.'])
    expect(seen).toHaveLength(1)
    expect(seen[0].capped).toBe(true)
    expect(seen[0].capBytes).toBe(250)
    // Strictly past the cap: the frame that crossed the line is counted, which
    // is what makes "how far past" answerable.
    expect(seen[0].bytes).toBeGreaterThan(250)
  })

  // ⚠ THE HALF THAT MAKES IT A MEASUREMENT. A capped figure alone is
  // compatible with BOTH of F39's hypotheses; it is only meaningful read
  // against the turns that succeeded, so those must report too.
  it('D96: a COMPLETED cycle reports its byte count, so the capped one has a comparison', async () => {
    const seen: { bytes: number; capBytes: number; capped: boolean }[] = []
    const { fetchImpl } = stubFetch([frame('Hello'), 'data: [DONE]\n\n'])
    const run = await drive(start(fetchImpl, { onStreamBytes: (i) => seen.push(i) }))
    expect(run.refusals).toEqual([])
    expect(seen).toHaveLength(1)
    expect(seen[0].capped).toBe(false)
    expect(seen[0].bytes).toBeGreaterThan(0)
    expect(seen[0].capBytes).toBe(RESPONSE_CAP_BYTES)
  })

  // ⚠ THE PROPERTY THAT IS EASIEST TO LOSE IN A LATER EDIT, ASSERTED
  // EXPLICITLY. Model output can carry a credential — the scrub seam exists
  // for exactly that reason — so a diagnostic that carried any of the streamed
  // body would be a worse defect than the one it was added to measure.
  it('D96: the diagnostic carries NO stream content — byte counts only', async () => {
    const seen: unknown[] = []
    const secret = 'sk-or-v1-NEVER-IN-A-LOG-LINE'
    const { fetchImpl } = stubFetch([frame(secret), 'data: [DONE]\n\n'])
    await drive(start(fetchImpl, { onStreamBytes: (i) => seen.push(i) }))
    expect(seen).toHaveLength(1)
    expect(JSON.stringify(seen[0])).not.toContain(secret)
    expect(JSON.stringify(seen[0])).not.toContain('sk-')
    // And nothing but the three declared numeric/boolean facts.
    expect(Object.keys(seen[0] as object).sort()).toEqual(['bytes', 'capBytes', 'capped'])
  })

  it('D96: the instrument is OPTIONAL — a consumer that does not measure is unaffected', async () => {
    const { fetchImpl } = stubFetch([frame('Hello'), 'data: [DONE]\n\n'])
    const run = await drive(start(fetchImpl))
    expect(run.yields).toEqual(['Hello'])
    expect(run.refusals).toEqual([])
  })

  it('the two defaults are the argued numbers, not modelCatalog\'s', async () => {
    expect(RESPONSE_CAP_BYTES).toBe(4_000_000)
    expect(RESPONSE_TIMEOUT_MS).toBe(120_000)
  })
})

describe('createApiSession — lifecycle and failure', () => {
  it('case 9: dispose() mid-stream aborts the request, ends iteration, and yields nothing further', async () => {
    const { fetchImpl, state } = stubFetch([frame('first')], { hangAfter: 1 })
    const run = start(fetchImpl)
    await run.handle.send('hello')
    const iterator = run.handle.receive()[Symbol.asyncIterator]()

    const first = await iterator.next()
    expect(first.done).toBe(false)
    expect(first.value).toBe('first')

    const pending = iterator.next() // blocked on a read that will never resolve
    await run.handle.dispose()
    const after = await pending

    expect(after.done).toBe(true)
    expect(after.value).toBeUndefined()
    expect(state.init?.signal.aborted).toBe(true)
    expect(state.cancelled).toBe(true)
    // An abort is the caller's own decision, not a provider failure.
    expect(run.refusals).toEqual([])

    // And nothing arrives afterwards.
    expect((await iterator.next()).done).toBe(true)
  })

  it('case 10: a non-2xx response refuses, and the body is cancelled UNREAD', async () => {
    const { fetchImpl, state } = stubFetch([frame('never read')], { status: 401 })
    const run = await drive(start(fetchImpl))
    expect(run.yields).toEqual([])
    expect(run.refusals).toEqual(['Authentication failed — the credential was rejected.'])
    expect(state.cancelled).toBe(true)
    expect(state.reads).toBe(0)
  })

  it('case 10b: each mapped status gets its own fixed string, and an unmapped one names only the number', async () => {
    const expected: ReadonlyArray<readonly [number, string]> = [
      [402, 'The provider refused the request for insufficient credit.'],
      [429, 'Rate limited by the provider.'],
      [503, 'The provider returned an error.'],
      [418, 'Unexpected response (418).']
    ]
    for (const [status, reason] of expected) {
      const { fetchImpl } = stubFetch([], { status })
      const run = await drive(start(fetchImpl))
      expect(run.refusals).toEqual([reason])
    }
  })

  it('case 11: malformed JSON in a frame REFUSES rather than throwing', async () => {
    const { fetchImpl, state } = stubFetch([frame('ok so far'), 'data: {"choices":[{"delta"\n\n', frame('never')])
    // The assertion is that this whole drive resolves — a throw would reject it.
    const run = await drive(start(fetchImpl))
    expect(run.yields).toEqual(['ok so far'])
    expect(run.refusals).toEqual(['The provider returned an unrecognized response stream.'])
    expect(state.cancelled).toBe(true)
  })

  it('an in-band mid-stream error on a 200 refuses instead of reading as a short answer', async () => {
    // D4-verified: once the status is committed the error must arrive in-band.
    const { fetchImpl } = stubFetch([
      frame('partial'),
      `data: ${JSON.stringify({ error: { code: 502, message: 'upstream exploded' }, choices: [{ finish_reason: 'error', delta: {} }] })}\n\n`
    ])
    const run = await drive(start(fetchImpl))
    expect(run.yields).toEqual(['partial'])
    expect(run.refusals).toEqual(['The provider reported an error partway through the response.'])
    // The provider's own message never travels.
    expect(run.refusals.join('')).not.toContain('upstream exploded')
  })

  it('a stream that drops mid-frame refuses rather than reporting a truncated answer as complete', async () => {
    const { fetchImpl } = stubFetch(['data: {"choices":[{"delta":{"content":"trun'])
    const run = await drive(start(fetchImpl))
    expect(run.refusals).toEqual(['The provider returned an unrecognized response stream.'])
  })

  it('a 200 with no body refuses', async () => {
    const { fetchImpl } = stubFetch([], { noBody: true })
    const run = await drive(start(fetchImpl))
    expect(run.refusals).toEqual(['The provider returned no response stream.'])
  })

  it('a fetch that throws collapses to one fixed string — the cause chain is discarded WHOLESALE', async () => {
    // A real `TypeError: fetch failed` carries a cause chain that can include
    // the request AND ITS HEADERS, which here means the credential.
    const fetchImpl: FetchLike = async () => {
      throw new Error(`connect ECONNREFUSED while sending Bearer ${FAKE_KEY}`)
    }
    const run = await drive(start(fetchImpl))
    expect(run.refusals).toEqual(['Could not reach the provider.'])
    expect(run.refusals.join('')).not.toContain(FAKE_KEY)
  })
})

describe('createApiSession — the request it actually builds', () => {
  it('POSTs to ${baseUrl}/chat/completions with stream:true and the credential ONLY in the header', async () => {
    const { fetchImpl, state } = stubFetch(['data: [DONE]\n\n'])
    const run = start(fetchImpl, { maxOutputTokens: 64, extraHeaders: { 'x-extra': 'non-secret' } })
    await run.handle.send('hello')
    for await (const chunk of run.handle.receive()) run.yields.push(chunk)

    expect(state.url).toBe('https://example.invalid/api/v1/chat/completions')
    expect(state.url).not.toContain(FAKE_KEY)
    expect(state.init?.method).toBe('POST')
    expect(state.init?.headers.authorization).toBe(`Bearer ${FAKE_KEY}`)
    expect(state.init?.headers['x-extra']).toBe('non-secret')

    const body = JSON.parse((state.init as unknown as { body: string }).body)
    expect(body.model).toBe('moonshotai/kimi-k3')
    expect(body.stream).toBe(true)
    expect(body.max_tokens).toBe(64)
    expect(body.messages).toEqual([{ role: 'user', content: 'hello' }])
  })

  it('omits max_tokens entirely when unset — an absent field, not a guessed default', async () => {
    const { fetchImpl, state } = stubFetch(['data: [DONE]\n\n'])
    await drive(start(fetchImpl))
    const body = JSON.parse((state.init as unknown as { body: string }).body)
    expect('max_tokens' in body).toBe(false)
  })

  it('a systemPrompt becomes the LEADING system message', async () => {
    const { fetchImpl, state } = stubFetch(['data: [DONE]\n\n'])
    const handle = createApiSession(
      { ...SPEC, systemPrompt: 'You are terse.' },
      { baseUrl: BASE_URL, fetchImpl }
    )
    await handle.send('hi')
    for await (const _ of handle.receive()) void _
    const body = JSON.parse((state.init as unknown as { body: string }).body)
    expect(body.messages).toEqual([
      { role: 'system', content: 'You are terse.' },
      { role: 'user', content: 'hi' }
    ])
  })

  it('a trailing slash on baseUrl does not produce a double slash', async () => {
    const { fetchImpl, state } = stubFetch(['data: [DONE]\n\n'])
    const handle = createApiSession(SPEC, { baseUrl: `${BASE_URL}///`, fetchImpl })
    await handle.send('hi')
    for await (const _ of handle.receive()) void _
    expect(state.url).toBe('https://example.invalid/api/v1/chat/completions')
  })

  it('receive() is single-consumption: a second iterator gets nothing rather than interleaving', async () => {
    const { fetchImpl } = stubFetch([frame('only'), 'data: [DONE]\n\n'])
    const run = start(fetchImpl)
    await run.handle.send('hello')
    const first: string[] = []
    for await (const chunk of run.handle.receive()) first.push(chunk)
    const second: string[] = []
    for await (const chunk of run.handle.receive()) second.push(chunk)
    expect(first).toEqual(['only'])
    expect(second).toEqual([])
  })

  it('an external signal aborts the session, and its listener is removed on dispose', async () => {
    const owner = new AbortController()
    const { fetchImpl, state } = stubFetch([frame('first')], { hangAfter: 1 })
    const run = start(fetchImpl, { signal: owner.signal })
    await run.handle.send('hello')
    const iterator = run.handle.receive()[Symbol.asyncIterator]()
    expect((await iterator.next()).value).toBe('first')
    const pending = iterator.next()
    owner.abort()
    expect((await pending).done).toBe(true)
    expect(state.init?.signal.aborted).toBe(true)
    await run.handle.dispose()
  })

  it('send() after dispose() refuses instead of issuing a request', async () => {
    const { fetchImpl, state } = stubFetch(['data: [DONE]\n\n'])
    const run = start(fetchImpl)
    await run.handle.dispose()
    await run.handle.send('hello')
    expect(state.url).toBeNull()
    expect(run.refusals).toEqual(['This session has been disposed.'])
  })
})

describe('createApiSession — case 12: the credential appears in NO output', () => {
  /**
   * ⚠ THE ONE THAT MATTERS. Every string the module can produce — every
   * yielded delta, every refusal, and every thrown message — is checked
   * against the planted key across the whole failure surface at once. A
   * refusal is the string a user sees, and it is built from a FIXED table
   * with zero interpolation of anything that arrived over the wire, which is
   * what makes this structural rather than a hope.
   */
  it('over the whole run: no yield, refusal, or thrown message contains the credential', async () => {
    const emitted: string[] = []
    const record = (s: string): void => {
      emitted.push(s)
    }

    // Every path that can produce a string, including the ones whose provider
    // payload deliberately ECHOES the key back — the leakage shape D58 exists
    // for. A real 401 body from a key-bearing endpoint is the body most likely
    // of all to echo the submitted key.
    const echoBody = JSON.stringify({
      error: { code: 401, message: `No auth credentials found for ${FAKE_KEY}`, metadata: { flagged_input: FAKE_KEY } }
    })
    const scenarios: ReadonlyArray<readonly [string, () => { fetchImpl: FetchLike }]> = [
      ['401 whose body echoes the key', () => stubFetch([`data: ${echoBody}\n\n`], { status: 401 })],
      ['200 whose in-band error echoes the key', () => stubFetch([`data: ${echoBody}\n\n`])],
      ['a frame that is not JSON at all', () => stubFetch([`data: not-json ${FAKE_KEY}\n\n`])],
      ['no body at all', () => stubFetch([], { noBody: true })],
      [
        'a fetch exception whose message carries the key',
        () => ({
          fetchImpl: (async () => {
            throw new Error(`fetch failed: authorization: Bearer ${FAKE_KEY}`)
          }) as FetchLike
        })
      ],
      [
        'the byte cap tripped by a body full of the key',
        () => stubFetch([frame(FAKE_KEY), frame(FAKE_KEY)], {})
      ]
    ]

    for (const [, build] of scenarios) {
      const { fetchImpl } = build()
      const refusals: string[] = []
      const handle = createApiSession(SPEC, {
        baseUrl: BASE_URL,
        fetchImpl,
        maxResponseBytes: 80,
        onRefusal: (r) => refusals.push(r)
      })
      try {
        await handle.send('hello')
        for await (const chunk of handle.receive()) record(chunk)
      } catch (e) {
        record(e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e))
      }
      refusals.forEach(record)
      await handle.dispose()
    }

    // The scenarios really did produce output — an all-empty run would pass
    // this test while proving nothing.
    expect(emitted.length).toBeGreaterThan(0)
    for (const s of emitted) {
      expect(s).not.toContain(FAKE_KEY)
      // And not a recognisable fragment of it either.
      expect(s).not.toContain(FAKE_KEY.slice(0, 16))
      expect(s).not.toContain(FAKE_KEY.slice(-16))
    }
  })
})

/**
 * D63 risk 1's mitigation, restated at the point of use.
 *
 * The binding assertion lives in `src/main/adapters/types.ts`
 * (`_StartApiSessionIsDelegable`), where BOTH the dormant declaration and the
 * factory are in scope; importing it here would only re-check the same thing.
 * What this file adds is the OTHER direction — that the delegation D63 Q1
 * describes actually compiles and actually runs — because a type alias can be
 * satisfied by a signature nobody could call.
 */
describe('the dormant startApiSession delegation (D63 Q1 / risk 1)', () => {
  it('compiles and runs as the one-line delegation the registry lift will use', async () => {
    const { fetchImpl } = stubFetch([frame('delegated'), 'data: [DONE]\n\n'])
    const deps: ApiSessionDeps = { baseUrl: BASE_URL, fetchImpl }

    // Verbatim the body Phase 3d will put on ApiAgentAdapter.startApiSession.
    const startApiSession = async (spec: ApiLaunchSpec): Promise<ApiSessionHandle> =>
      createApiSession(spec, deps)

    const handle = await startApiSession(SPEC)
    await handle.send('hello')
    const out: string[] = []
    for await (const chunk of handle.receive()) out.push(chunk)
    expect(out).toEqual(['delegated'])
    expect(handle.sessionId).toBe(SPEC.sessionId)
  })
})
