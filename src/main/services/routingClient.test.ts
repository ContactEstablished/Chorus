import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { probeRequestBody } from '../routing/cacheProbeCore'
import { rowsPerTag } from '../routing/preflightCore'
import { parseEndpointsResponse } from '../routing/endpointsCore'
import type { FetchLike, FetchResponseLike } from './modelCatalog'
import {
  ENDPOINTS_RESPONSE_CAP_BYTES,
  PREFLIGHT_BODY_CAP_BYTES,
  PROBE_RESPONSE_CAP_BYTES,
  ROUTING_REQUEST_TIMEOUT_MS,
  endpointsUrl,
  failureForStatus,
  fetchRoutingEndpoints,
  sendRoutingPreflight,
  sendRoutingProbeCall,
  type RoutingFetchInit,
  type RoutingFetchLike
} from './routingClient'

/**
 * Model Routing Task 2-1, Table T (ImplementationSpec-2-1): the routing
 * transport against a stub `fetchImpl`. No test touches the network.
 */

/** A realistic-shaped fake, assembled by concatenation so this file never
 *  contains a complete key shape for scripts/secret-grep.mjs (G4 scans src/). */
const FAKE_KEY = 'sk-or-v1-' + '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

const MODEL = 'deepseek/deepseek-v4.1-flash'
const ENDPOINTS_URL = 'https://openrouter.ai/api/v1/models/deepseek/deepseek-v4.1-flash/endpoints'
const COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions'
const GUARDRAILS_BODY =
  '{"model":"deepseek/deepseek-v4.1-flash","provider":{"order":["chorus-preflight-none"],"allow_fallbacks":false},"messages":[{"role":"user","content":"OK"}],"max_tokens":1}'
const DENY_BODY =
  '{"model":"deepseek/deepseek-v4.1-flash","provider":{"order":["chorus-preflight-none"],"allow_fallbacks":false,"data_collection":"deny"},"messages":[{"role":"user","content":"OK"}],"max_tokens":1}'

const fixtureText = (name: string): string => readFileSync(join(__dirname, '../routing/__fixtures__', name), 'utf8')
const GOLDEN_TEXT = fixtureText('endpoints-deepseek-v4.1-flash-2026-10-02.json')
const ROWS = rowsPerTag(parseEndpointsResponse(JSON.parse(GOLDEN_TEXT)).endpoints)
const GUARDRAILS_404 = JSON.stringify((JSON.parse(fixtureText('preflight-guardrails-2026-10-02.json')) as { body: unknown }).body)
const DENY_404 = JSON.stringify(
  (JSON.parse(fixtureText('preflight-data-policy-2026-10-02.json')) as { withDeny: { body: unknown } }).withDeny.body
)

const CHUNK = 64 * 1024

/** A response stub whose body records whether it was READ or CANCELLED (modelCatalog.test.ts:76). */
function stubResponse(status: number, text: string) {
  const bytes = new TextEncoder().encode(text)
  const state = { read: false, cancelled: false, chunksPulled: 0, doneSeen: false }
  let offset = 0
  const res: FetchResponseLike = {
    status,
    body: {
      cancel: async () => {
        state.cancelled = true
      },
      getReader: () => {
        state.read = true
        return {
          read: async () => {
            if (offset >= bytes.byteLength) {
              state.doneSeen = true
              return { done: true }
            }
            const slice = bytes.slice(offset, offset + CHUNK)
            offset += slice.byteLength
            state.chunksPulled++
            return { done: false, value: slice }
          },
          cancel: async () => {
            state.cancelled = true
          }
        }
      }
    }
  }
  return { res, state }
}

interface Recorded {
  url: string
  init: RoutingFetchInit
}

/** Records `(url, init)` and answers with `res`; rejects, as a real fetch does, on an aborted signal. */
function stubFetch(res: FetchResponseLike, recorded: Recorded[] = []): RoutingFetchLike {
  return async (url, init) => {
    recorded.push({ url, init })
    if (init.signal.aborted) throw new DOMException('This operation was aborted', 'AbortError')
    return res
  }
}

/** Asserts the reader was cancelled at the cap: the end of the stream was never reached. */
function expectCancelledAtCap(state: { cancelled: boolean; doneSeen: boolean; chunksPulled: number }, capBytes: number): void {
  expect(state.cancelled).toBe(true)
  expect(state.doneSeen).toBe(false)
  expect(state.chunksPulled).toBeLessThanOrEqual(Math.ceil((capBytes + 1) / CHUNK))
}

function expectUnread(state: { read: boolean; cancelled: boolean; chunksPulled: number }): void {
  expect(state.cancelled).toBe(true)
  expect(state.read).toBe(false)
  expect(state.chunksPulled).toBe(0)
}

const base = { key: FAKE_KEY, model: MODEL }

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Table T — endpoints GET', () => {
  it('T1: one GET to the exact URL, headers exactly { accept, authorization }, no body; 33 rows', async () => {
    const recorded: Recorded[] = []
    const { res, state } = stubResponse(200, GOLDEN_TEXT)
    const r = await fetchRoutingEndpoints({ ...base, fetchImpl: stubFetch(res, recorded) })
    expect(recorded).toHaveLength(1)
    const { url, init } = recorded[0]
    expect(url).toBe(ENDPOINTS_URL)
    expect(endpointsUrl(MODEL)).toBe(ENDPOINTS_URL)
    expect(init.method).toBe('GET')
    expect(Object.keys(init.headers)).toEqual(['accept', 'authorization'])
    expect(init.headers).toStrictEqual({ accept: 'application/json', authorization: `Bearer ${FAKE_KEY}` })
    expect('body' in init).toBe(false)
    expect(state.read).toBe(true)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.endpoints).toHaveLength(33)
    expect(r.rejectedRows).toBe(0)
  })

  it('T2: endpoints for another model → model-mismatch', async () => {
    const other = JSON.parse(GOLDEN_TEXT) as { data: { id: string } }
    other.data.id = 'other/model'
    const r = await fetchRoutingEndpoints({ ...base, fetchImpl: stubFetch(stubResponse(200, JSON.stringify(other)).res) })
    expect(r).toStrictEqual({ ok: false, failure: 'model-mismatch', status: 200 })
  })

  it('T3: a 2,000,001-byte body → unrecognized; the reader is cancelled at the cap', async () => {
    const { res, state } = stubResponse(200, 'x'.repeat(ENDPOINTS_RESPONSE_CAP_BYTES + 1))
    const r = await fetchRoutingEndpoints({ ...base, fetchImpl: stubFetch(res) })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.failure).toBe('unrecognized')
    expectCancelledAtCap(state, ENDPOINTS_RESPONSE_CAP_BYTES)
  })

  it('T3b: a far larger body is cancelled part-way, never pulled whole', async () => {
    const text = 'x'.repeat(ENDPOINTS_RESPONSE_CAP_BYTES * 2)
    const { res, state } = stubResponse(200, text)
    const r = await fetchRoutingEndpoints({ ...base, fetchImpl: stubFetch(res) })
    expect(r.ok).toBe(false)
    expect(state.chunksPulled).toBeLessThan(Math.ceil(text.length / CHUNK))
  })

  it('T4: "{" and an empty endpoint list → unrecognized', async () => {
    for (const text of ['{', JSON.stringify({ data: { id: MODEL, endpoints: [] } })]) {
      const r = await fetchRoutingEndpoints({ ...base, fetchImpl: stubFetch(stubResponse(200, text).res) })
      expect(r.ok, text).toBe(false)
      if (r.ok) continue
      expect(r.failure, text).toBe('unrecognized')
    }
  })

  it('T4b: an invalid envelope and a body-less 2xx → unrecognized; a rejected row is only counted', async () => {
    const bad = await fetchRoutingEndpoints({ ...base, fetchImpl: stubFetch(stubResponse(200, '{"data":{}}').res) })
    expect(bad.ok ? null : bad.failure).toBe('unrecognized')
    const empty = await fetchRoutingEndpoints({ ...base, fetchImpl: stubFetch({ status: 200, body: null }) })
    expect(empty.ok ? null : empty.failure).toBe('unrecognized')

    const withBadRow = JSON.parse(GOLDEN_TEXT) as { data: { endpoints: unknown[] } }
    withBadRow.data.endpoints.push({ tag: 'broken', note: `row carrying ${FAKE_KEY}` })
    const r = await fetchRoutingEndpoints({ ...base, fetchImpl: stubFetch(stubResponse(200, JSON.stringify(withBadRow)).res) })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.endpoints).toHaveLength(33)
    expect(r.rejectedRows).toBe(1)
    expect(JSON.stringify(r)).not.toContain(FAKE_KEY)
  })

  it('review minor 1: rows whose tag fails ROUTING_TAG_PATTERN or scrubSecrets are rejected rows, counted, never returned', async () => {
    const keyTag = 'sk-or-v1-' + 'a'.repeat(20)
    const body = JSON.parse(GOLDEN_TEXT) as { data: { endpoints: Record<string, unknown>[] } }
    const valid = body.data.endpoints[0]
    body.data.endpoints.push({ ...valid, tag: 'deep seek' }, { ...valid, tag: keyTag })
    const r = await fetchRoutingEndpoints({ ...base, fetchImpl: stubFetch(stubResponse(200, JSON.stringify(body)).res) })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.endpoints).toHaveLength(33)
    expect(r.rejectedRows).toBe(2)
    expect(r.endpoints.map((e) => e.tag)).not.toContain('deep seek')
    expect(JSON.stringify(r)).not.toContain(keyTag)
  })

  it('review minor 1: when no row has a usable tag → unrecognized', async () => {
    const body = JSON.parse(GOLDEN_TEXT) as { data: { endpoints: Record<string, unknown>[] } }
    body.data.endpoints = [{ ...body.data.endpoints[0], tag: 'deep seek' }]
    const r = await fetchRoutingEndpoints({ ...base, fetchImpl: stubFetch(stubResponse(200, JSON.stringify(body)).res) })
    expect(r).toStrictEqual({ ok: false, failure: 'unrecognized', status: 200 })
  })

  it.each([
    [401, 'auth-failed'],
    [403, 'auth-failed'],
    [429, 'rate-limited'],
    [500, 'provider-error'],
    [503, 'provider-error'],
    [418, 'unexpected-status']
  ] as const)('T5: %i whose body echoes the key → %s, cancelled unread', async (status, failure) => {
    const { res, state } = stubResponse(status, `{"error":{"message":"Invalid API key: ${FAKE_KEY}"}}`)
    const r = await fetchRoutingEndpoints({ ...base, fetchImpl: stubFetch(res) })
    expect(r).toStrictEqual({ ok: false, failure, status })
    expectUnread(state)
    expect(JSON.stringify(r)).not.toContain(FAKE_KEY)
  })

  it('T6: a rejecting fetch whose message and cause carry the key → unreachable, status null', async () => {
    const r = await fetchRoutingEndpoints({
      ...base,
      fetchImpl: async () => {
        const err = new Error(`connect ECONNREFUSED with ${FAKE_KEY}`) as Error & { cause?: unknown }
        err.cause = { headers: { authorization: `Bearer ${FAKE_KEY}` } }
        throw err
      }
    })
    expect(r).toStrictEqual({ ok: false, failure: 'unreachable', status: null })
    expect(JSON.stringify(r)).not.toContain(FAKE_KEY)
    expect(JSON.stringify(r)).not.toContain('ECONNREFUSED')
  })

  it('T6b: a timeout arrives as unreachable too', async () => {
    const r = await fetchRoutingEndpoints({
      ...base,
      fetchImpl: async () => {
        throw new DOMException('The operation was aborted due to timeout.', 'TimeoutError')
      }
    })
    expect(r).toStrictEqual({ ok: false, failure: 'unreachable', status: null })
  })

  it('T7: an empty key → auth-failed, and fetch is never called (all three calls)', async () => {
    const fetchImpl = vi.fn()
    const stub = fetchImpl as unknown as RoutingFetchLike
    expect(await fetchRoutingEndpoints({ key: '', model: MODEL, fetchImpl: stub })).toStrictEqual({ ok: false, failure: 'auth-failed', status: null })
    expect(await sendRoutingPreflight({ key: '', model: MODEL, fetchImpl: stub, step: 'guardrails', rowsPerTag: ROWS })).toStrictEqual({
      ok: false,
      failure: 'auth-failed',
      status: null
    })
    expect(await sendRoutingProbeCall({ key: '', model: MODEL, fetchImpl: stub, tag: 'atlas-cloud/fp8', runNonce: 'N' })).toStrictEqual({
      ok: false,
      failure: 'auth-failed',
      status: null
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('Table T — preflight POST', () => {
  it('T8: guardrails, 404 with the real body → deepseek; one POST, exact headers and body; body read', async () => {
    const recorded: Recorded[] = []
    const { res, state } = stubResponse(404, GUARDRAILS_404)
    const r = await sendRoutingPreflight({ ...base, fetchImpl: stubFetch(res, recorded), step: 'guardrails', rowsPerTag: ROWS })
    expect(recorded).toHaveLength(1)
    const { url, init } = recorded[0]
    expect(url).toBe(COMPLETIONS_URL)
    expect(init.method).toBe('POST')
    expect(Object.keys(init.headers)).toEqual(['accept', 'authorization', 'content-type'])
    expect(init.headers).toStrictEqual({
      accept: 'application/json',
      authorization: `Bearer ${FAKE_KEY}`,
      'content-type': 'application/json'
    })
    expect(init.body).toBe(GUARDRAILS_BODY)
    expect(r).toStrictEqual({ ok: true, removed: ['deepseek'], issue: null })
    expect(state.read).toBe(true)
  })

  it('T9: dataPolicy, 404 with the withDeny body → deepseek; the exact deny body', async () => {
    const recorded: Recorded[] = []
    const r = await sendRoutingPreflight({
      ...base,
      fetchImpl: stubFetch(stubResponse(404, DENY_404).res, recorded),
      step: 'dataPolicy',
      rowsPerTag: ROWS
    })
    expect(recorded[0].init.body).toBe(DENY_BODY)
    expect(r).toStrictEqual({ ok: true, removed: ['deepseek'], issue: null })
  })

  it('T10: a 65,537-byte 404 → unrecognized-body; the reader is cancelled at the cap', async () => {
    const { res, state } = stubResponse(404, 'x'.repeat(PREFLIGHT_BODY_CAP_BYTES + 1))
    const r = await sendRoutingPreflight({ ...base, fetchImpl: stubFetch(res), step: 'guardrails', rowsPerTag: ROWS })
    expect(r).toStrictEqual({ ok: true, removed: null, issue: 'unrecognized-body' })
    expectCancelledAtCap(state, PREFLIGHT_BODY_CAP_BYTES)
  })

  it('T10b: a 404 that is not JSON, or has no body → unrecognized-body', async () => {
    for (const res of [stubResponse(404, '<html>Not found</html>').res, { status: 404, body: null }]) {
      const r = await sendRoutingPreflight({ ...base, fetchImpl: stubFetch(res), step: 'guardrails', rowsPerTag: ROWS })
      expect(r).toStrictEqual({ ok: true, removed: null, issue: 'unrecognized-body' })
    }
  })

  it.each([401, 403])('T11: %i whose body echoes the key → auth-failed, cancelled unread', async (status) => {
    const { res, state } = stubResponse(status, `{"error":{"message":"Invalid API key: ${FAKE_KEY}"}}`)
    const r = await sendRoutingPreflight({ ...base, fetchImpl: stubFetch(res), step: 'guardrails', rowsPerTag: ROWS })
    expect(r).toStrictEqual({ ok: false, failure: 'auth-failed', status })
    expectUnread(state)
    expect(JSON.stringify(r)).not.toContain(FAKE_KEY)
  })

  it('T12: a 200 → unexpected-status issue, cancelled unread', async () => {
    const { res, state } = stubResponse(200, `{"choices":[{"message":{"content":"OK"}}],"note":"${FAKE_KEY}"}`)
    const r = await sendRoutingPreflight({ ...base, fetchImpl: stubFetch(res), step: 'guardrails', rowsPerTag: ROWS })
    expect(r).toStrictEqual({ ok: true, removed: null, issue: 'unexpected-status' })
    expectUnread(state)
  })

  it.each([
    [429, 'rate-limited'],
    [500, 'provider-error'],
    [400, 'unexpected-status']
  ] as const)('a preflight %i → %s, cancelled unread', async (status, failure) => {
    const { res, state } = stubResponse(status, `{"error":"${FAKE_KEY}"}`)
    const r = await sendRoutingPreflight({ ...base, fetchImpl: stubFetch(res), step: 'dataPolicy', rowsPerTag: ROWS })
    expect(r).toStrictEqual({ ok: false, failure, status })
    expectUnread(state)
  })

  it('T13: a 404 whose Guardrails clause lists a 29-character key shape → bad-tag (C3)', async () => {
    const keyTag = 'sk-or-v1-' + 'a'.repeat(20)
    expect(keyTag).toHaveLength(29)
    const body = {
      error: {
        message: `No endpoints found for ${MODEL}. Every candidate endpoint was removed during routing: Filter by Guardrails removed ${keyTag} (r); Filter by Fallback removed c.`,
        metadata: {
          routing_funnel: [
            { step: 'Initial Endpoints', endpoint_count: 2 },
            { step: 'Filter by Guardrails', endpoint_count: 1 },
            { step: 'Filter by Fallback', endpoint_count: 0 }
          ]
        }
      }
    }
    const r = await sendRoutingPreflight({ ...base, fetchImpl: stubFetch(stubResponse(404, JSON.stringify(body)).res), step: 'guardrails', rowsPerTag: {} })
    expect(r).toStrictEqual({ ok: true, removed: null, issue: 'bad-tag' })
    expect(JSON.stringify(r)).not.toContain(keyTag)
  })

  it('a parse issue passes through as an issue, never as a list', async () => {
    const r = await sendRoutingPreflight({
      ...base,
      fetchImpl: stubFetch(stubResponse(404, '{"error":{"message":"No endpoints found","metadata":{"routing_funnel":[{"step":"Initial Endpoints","endpoint_count":1}]}}}').res),
      step: 'guardrails',
      rowsPerTag: ROWS
    })
    expect(r).toStrictEqual({ ok: true, removed: null, issue: 'unrecognized-message' })
  })
})

describe('Table T — probe POST', () => {
  const PROBE_OK = JSON.stringify({
    id: 'gen-1',
    provider: 'AtlasCloud',
    choices: [{ message: { role: 'assistant', content: 'COMPLETION-TEXT-NEVER-RETURNED' } }],
    usage: { prompt_tokens: 4460, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 4352 }, cost: 0.0000833592 }
  })

  it('T14: a 200 with a real-shaped usage body → the usage numbers only; the exact request body', async () => {
    const recorded: Recorded[] = []
    const { res, state } = stubResponse(200, PROBE_OK)
    const r = await sendRoutingProbeCall({ ...base, fetchImpl: stubFetch(res, recorded), tag: 'atlas-cloud/fp8', runNonce: 'run-1' })
    expect(recorded).toHaveLength(1)
    expect(recorded[0].url).toBe(COMPLETIONS_URL)
    expect(recorded[0].init.method).toBe('POST')
    expect(Object.keys(recorded[0].init.headers)).toEqual(['accept', 'authorization', 'content-type'])
    expect(recorded[0].init.body).toBe(JSON.stringify(probeRequestBody(MODEL, 'atlas-cloud/fp8', 'run-1')))
    expect(r).toStrictEqual({ ok: true, usage: { promptTokens: 4460, cachedTokens: 4352, costUsd: 0.0000833592 } })
    expect(JSON.stringify(r)).not.toContain('COMPLETION-TEXT')
    expect(state.read).toBe(true)
  })

  it('T15: a 262,145-byte 200 → unrecognized; the reader is cancelled at the cap', async () => {
    const { res, state } = stubResponse(200, 'x'.repeat(PROBE_RESPONSE_CAP_BYTES + 1))
    const r = await sendRoutingProbeCall({ ...base, fetchImpl: stubFetch(res), tag: 'atlas-cloud/fp8', runNonce: 'N' })
    expect(r).toStrictEqual({ ok: false, failure: 'unrecognized', status: 200 })
    expectCancelledAtCap(state, PROBE_RESPONSE_CAP_BYTES)
  })

  it('a 200 that is not JSON → unrecognized', async () => {
    const r = await sendRoutingProbeCall({ ...base, fetchImpl: stubFetch(stubResponse(200, 'not json').res), tag: 'atlas-cloud/fp8', runNonce: 'N' })
    expect(r).toStrictEqual({ ok: false, failure: 'unrecognized', status: 200 })
  })

  it.each([
    [404, 'unexpected-status'],
    [401, 'auth-failed'],
    [429, 'rate-limited']
  ] as const)('T16: a probe %i → %s, cancelled unread', async (status, failure) => {
    const { res, state } = stubResponse(status, `{"error":{"message":"${FAKE_KEY}"}}`)
    const r = await sendRoutingProbeCall({ ...base, fetchImpl: stubFetch(res), tag: 'atlas-cloud/fp8', runNonce: 'N' })
    expect(r).toStrictEqual({ ok: false, failure, status })
    expectUnread(state)
  })
})

describe('Table T — the key, the signal and the types', () => {
  /** One of each call against a stub, recording every request. */
  async function everyCall(fetchImplFor: (recorded: Recorded[]) => RoutingFetchLike, signal?: AbortSignal) {
    const recorded: Recorded[] = []
    const fetchImpl = fetchImplFor(recorded)
    const results = [
      await fetchRoutingEndpoints({ ...base, fetchImpl, signal }),
      await sendRoutingPreflight({ ...base, fetchImpl, signal, step: 'guardrails', rowsPerTag: ROWS }),
      await sendRoutingPreflight({ ...base, fetchImpl, signal, step: 'dataPolicy', rowsPerTag: ROWS }),
      await sendRoutingProbeCall({ ...base, fetchImpl, signal, tag: 'atlas-cloud/fp8', runNonce: 'N' })
    ]
    return { recorded, results }
  }

  it('T17: the key is never in a URL, is in exactly one header value, and init.signal is an AbortSignal', async () => {
    const bodies = [GOLDEN_TEXT, GUARDRAILS_404, DENY_404, '{"usage":{"prompt_tokens":1}}']
    const statuses = [200, 404, 404, 200]
    let i = 0
    const { recorded, results } = await everyCall((rec) => async (url, init) => {
      rec.push({ url, init })
      const n = i++
      return stubResponse(statuses[n], bodies[n]).res
    })
    expect(recorded).toHaveLength(4)
    for (const { url, init } of recorded) {
      expect(url).not.toContain(FAKE_KEY)
      expect(url).not.toContain('?')
      const carriers = Object.entries(init.headers).filter(([, v]) => v.includes(FAKE_KEY))
      expect(carriers).toEqual([['authorization', `Bearer ${FAKE_KEY}`]])
      expect(init.signal).toBeInstanceOf(AbortSignal)
      // Review minor 3: a redirect is a rejection, never a second destination.
      expect(init.redirect).toBe('error')
      expect(JSON.stringify({ ...init, headers: undefined })).not.toContain(FAKE_KEY)
    }
    for (const r of results) {
      expect(r.ok).toBe(true)
      expect(JSON.stringify(r)).not.toContain(FAKE_KEY)
    }
  })

  it('T18: an external signal already aborted → unreachable on every call', async () => {
    const controller = new AbortController()
    controller.abort()
    const { recorded, results } = await everyCall((rec) => stubFetch(stubResponse(200, GOLDEN_TEXT).res, rec), controller.signal)
    expect(recorded).toHaveLength(4)
    for (const { init } of recorded) expect(init.signal.aborted).toBe(true)
    for (const r of results) expect(r).toStrictEqual({ ok: false, failure: 'unreachable', status: null })
  })

  it('the external signal is combined with the timeout, not replaced by it', async () => {
    const controller = new AbortController()
    const recorded: Recorded[] = []
    await fetchRoutingEndpoints({ ...base, signal: controller.signal, fetchImpl: stubFetch(stubResponse(200, GOLDEN_TEXT).res, recorded) })
    const signal = recorded[0].init.signal
    expect(signal).not.toBe(controller.signal)
    expect(signal.aborted).toBe(false)
    controller.abort()
    expect(signal.aborted).toBe(true)
    expect(ROUTING_REQUEST_TIMEOUT_MS).toBe(10_000)
  })

  it('T19: a FetchLike-typed stub (modelCatalog.ts) is accepted as fetchImpl (C8, compile-time)', async () => {
    const stub: FetchLike = async () => stubResponse(200, GOLDEN_TEXT).res
    const r = await fetchRoutingEndpoints({ ...base, fetchImpl: stub })
    expect(r.ok).toBe(true)
  })

  it('one request per call, no retry', async () => {
    for (const status of [500, 429, 401]) {
      const recorded: Recorded[] = []
      await fetchRoutingEndpoints({ ...base, fetchImpl: stubFetch(stubResponse(status, '{}').res, recorded) })
      await sendRoutingPreflight({ ...base, fetchImpl: stubFetch(stubResponse(status, '{}').res, recorded), step: 'guardrails', rowsPerTag: ROWS })
      await sendRoutingProbeCall({ ...base, fetchImpl: stubFetch(stubResponse(status, '{}').res, recorded), tag: 'atlas-cloud/fp8', runNonce: 'N' })
      expect(recorded).toHaveLength(3)
    }
  })

  it('review minor 5(d): the module source imports only scrubSecrets from ./logger and makes no log call', () => {
    const source = readFileSync(join(__dirname, 'routingClient.ts'), 'utf8')
    const loggerImports = [...source.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*'\.\/logger'/g)].map((m) => m[1].trim())
    expect(loggerImports).toEqual(['scrubSecrets'])
    expect(source).not.toMatch(/\bconsole\s*\./)
    // With the import path removed, the identifier `logger` must not appear at all.
    expect(source.split("'./logger'").join('')).not.toMatch(/\blogger\b/)
  })

  it('review minor 5(a): AbortSignal.timeout(10_000) is created once per request, and never without one', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    let n = 0
    const bodies = [GOLDEN_TEXT, GUARDRAILS_404, DENY_404, '{"usage":{"prompt_tokens":1}}']
    const statuses = [200, 404, 404, 200]
    const { recorded } = await everyCall((rec) => async (url, init) => {
      rec.push({ url, init })
      const i = n++
      return stubResponse(statuses[i], bodies[i]).res
    })
    expect(recorded).toHaveLength(4)
    expect(timeout).toHaveBeenCalledTimes(4)
    for (const args of timeout.mock.calls) expect(args).toEqual([ROUTING_REQUEST_TIMEOUT_MS])
    expect(ROUTING_REQUEST_TIMEOUT_MS).toBe(10_000)

    // An empty key makes no request, so no timeout is created.
    await fetchRoutingEndpoints({ key: '', model: MODEL, fetchImpl: stubFetch(stubResponse(200, GOLDEN_TEXT).res) })
    expect(timeout).toHaveBeenCalledTimes(4)
  })

  it('review minor 5(b): a body stream that rejects mid-read is refused, and the reader cancelled', async () => {
    /** One chunk, then `read()` rejects with text that echoes the key. */
    function brokenStream(status: number) {
      const state = { cancelled: false, reads: 0 }
      const res: FetchResponseLike = {
        status,
        body: {
          cancel: async () => {
            state.cancelled = true
          },
          getReader: () => ({
            read: async () => {
              state.reads++
              if (state.reads === 1) return { done: false, value: new TextEncoder().encode('{"error":') }
              throw new Error(`stream broke near ${FAKE_KEY}`)
            },
            cancel: async () => {
              state.cancelled = true
            }
          })
        }
      }
      return { res, state }
    }

    const endpoints = brokenStream(200)
    const e = await fetchRoutingEndpoints({ ...base, fetchImpl: stubFetch(endpoints.res) })
    expect(e).toStrictEqual({ ok: false, failure: 'unrecognized', status: 200 })
    expect(endpoints.state.cancelled).toBe(true)

    const preflight = brokenStream(404)
    const p = await sendRoutingPreflight({ ...base, fetchImpl: stubFetch(preflight.res), step: 'guardrails', rowsPerTag: ROWS })
    expect(p).toStrictEqual({ ok: true, removed: null, issue: 'unrecognized-body' })
    expect(preflight.state.cancelled).toBe(true)

    const probe = brokenStream(200)
    const q = await sendRoutingProbeCall({ ...base, fetchImpl: stubFetch(probe.res), tag: 'atlas-cloud/fp8', runNonce: 'N' })
    expect(q).toStrictEqual({ ok: false, failure: 'unrecognized', status: 200 })
    expect(probe.state.cancelled).toBe(true)

    for (const r of [e, p, q]) expect(JSON.stringify(r)).not.toContain(FAKE_KEY)
  })

  it('failureForStatus and the caps', () => {
    expect([401, 403, 429, 500, 503, 599, 400, 404, 418].map(failureForStatus)).toEqual([
      'auth-failed',
      'auth-failed',
      'rate-limited',
      'provider-error',
      'provider-error',
      'provider-error',
      'unexpected-status',
      'unexpected-status',
      'unexpected-status'
    ])
    expect(ENDPOINTS_RESPONSE_CAP_BYTES).toBe(2_000_000)
    expect(PREFLIGHT_BODY_CAP_BYTES).toBe(65_536)
    expect(PROBE_RESPONSE_CAP_BYTES).toBe(262_144)
    // The fixture is 64,233 bytes for 33 rows: the cap leaves about 30x headroom.
    expect(Buffer.byteLength(GOLDEN_TEXT, 'utf8')).toBeLessThan(ENDPOINTS_RESPONSE_CAP_BYTES / 30)
  })

  it('a slug is encoded per path segment', () => {
    expect(endpointsUrl('a b/c?d')).toBe('https://openrouter.ai/api/v1/models/a%20b/c%3Fd/endpoints')
  })
})
