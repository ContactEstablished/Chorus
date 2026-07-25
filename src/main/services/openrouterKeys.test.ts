import { describe, expect, it } from 'vitest'
import { createOpenRouterKeyClient } from './openrouterKeys'
import { MINT_NAME_PREFIX, type MintBody } from './attributionCore'

// Task 3a-3: transport tests against a stub fetchImpl. No network, ever.
//
// Synthetic keys of realistic SHAPE only, assembled by concatenation so no
// literal here forms a complete key shape for scripts/secret-grep.mjs.
const fakeManagementKey = 'sk-or-v1-' + 'Ch0rusMgmt42x'.repeat(4)
const fakeMintedKey = 'sk-or-v1-' + 'Ch0rusMinted7'.repeat(4)

const DISPATCH_ID = '3f7c1e2a-9b04-4d5e-8a11-6c2d0e9f4b73'
const HASH = 'a'.repeat(64)
const MINT: MintBody = {
  name: `${MINT_NAME_PREFIX}${DISPATCH_ID}`,
  limit: 0.5,
  expires_at: '2026-07-26T00:00:00.000Z'
}

interface Recorded {
  url: string
  init: RequestInit
}

/** A Response-like stub whose body records whether it was READ or CANCELLED —
 *  the failure-path discipline is only provable if the stub can tell them
 *  apart. */
function stubFetch(options: {
  status: number
  json?: unknown
  throws?: boolean
}): { fetchImpl: typeof fetch; calls: Recorded[]; bodyRead: () => boolean; bodyCancelled: () => boolean } {
  const calls: Recorded[] = []
  let read = false
  let cancelled = false
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} })
    if (options.throws) throw new TypeError('fetch failed')
    return {
      status: options.status,
      body: {
        cancel: async (): Promise<void> => {
          cancelled = true
        }
      },
      json: async (): Promise<unknown> => {
        read = true
        return options.json
      }
    } as unknown as Response
  }) as unknown as typeof fetch
  return { fetchImpl, calls, bodyRead: () => read, bodyCancelled: () => cancelled }
}

function clientFor(stub: { fetchImpl: typeof fetch }, key: string | null = fakeManagementKey) {
  return createOpenRouterKeyClient({
    getManagementKey: async () => key,
    fetchImpl: stub.fetchImpl,
    timeoutMs: 1_000
  })
}

/** Everything about a recorded request EXCEPT the Authorization header, as one
 *  searchable string — the "and nowhere else" assertion, done over the whole
 *  object rather than by spot-check. */
function everywhereButAuth(call: Recorded): string {
  const headers = { ...((call.init.headers as Record<string, string>) ?? {}) }
  delete headers.authorization
  delete headers.Authorization
  return JSON.stringify({ url: call.url, headers, body: call.init.body, method: call.init.method })
}

describe('the management key appears in the Authorization header and NOWHERE else', () => {
  it.each([
    ['mint', async (c: ReturnType<typeof clientFor>) => c.mint(MINT)],
    ['readUsage', async (c: ReturnType<typeof clientFor>) => c.readUsage(HASH)],
    ['revoke', async (c: ReturnType<typeof clientFor>) => c.revoke(HASH)],
    ['list', async (c: ReturnType<typeof clientFor>) => c.list()],
    ['meta', async (c: ReturnType<typeof clientFor>) => c.meta()],
    [
      'queryTokens',
      async (c: ReturnType<typeof clientFor>) =>
        c.queryTokens(HASH, new Date('2026-07-25T00:00:00Z'), new Date('2026-07-25T01:00:00Z'))
    ],
    [
      'queryGatewayTotal',
      async (c: ReturnType<typeof clientFor>) =>
        c.queryGatewayTotal(new Date('2026-07-25T00:00:00Z'), new Date('2026-07-25T01:00:00Z'))
    ]
  ])('%s', async (_name, invoke) => {
    const stub = stubFetch({ status: 200, json: { data: [] } })
    await invoke(clientFor(stub))
    expect(stub.calls.length).toBeGreaterThan(0)
    for (const call of stub.calls) {
      const headers = (call.init.headers as Record<string, string>) ?? {}
      expect(headers.authorization).toBe(`Bearer ${fakeManagementKey}`)
      // The whole rest of the request, as one string.
      expect(everywhereButAuth(call)).not.toContain(fakeManagementKey)
      // And no ≥8-char fragment of it either.
      for (let i = 0; i + 8 <= fakeManagementKey.length; i++) {
        expect(everywhereButAuth(call)).not.toContain(fakeManagementKey.slice(i, i + 8))
      }
    }
  })

  it('never places the key in the URL or a query string', async () => {
    const stub = stubFetch({ status: 200, json: { data: [] } })
    await clientFor(stub).list()
    expect(stub.calls[0].url).not.toContain('sk-or')
    expect(stub.calls[0].url).toContain('/api/v1/keys')
  })
})

describe('the response body is NEVER read on a failure path', () => {
  it.each([[401], [403], [404], [429], [500], [418]])('status %i: cancelled, not read', async (status) => {
    const stub = stubFetch({ status, json: { error: `echoed back: ${fakeManagementKey}` } })
    const result = await clientFor(stub).mint(MINT)
    expect(result.ok).toBe(false)
    expect(stub.bodyRead()).toBe(false)
    expect(stub.bodyCancelled()).toBe(true)
  })

  it('returns the fixed vocabulary, carrying no fragment of the key the body echoed', async () => {
    const stub = stubFetch({ status: 401, json: { error: `bad key ${fakeManagementKey}` } })
    const result = await clientFor(stub).mint(MINT)
    expect(result).toEqual({ ok: false, reason: 'The OpenRouter management key was rejected.' })
    if (result.ok) return
    for (let i = 0; i + 8 <= fakeManagementKey.length; i++) {
      expect(result.reason).not.toContain(fakeManagementKey.slice(i, i + 8))
    }
  })

  it.each([
    [404, 'That OpenRouter key no longer exists.'],
    [429, 'Rate limited by OpenRouter.'],
    [500, 'OpenRouter returned an error.'],
    [418, 'Unexpected response (418).']
  ])('status %i maps to the fixed string', async (status, expected) => {
    const stub = stubFetch({ status, json: {} })
    const result = await clientFor(stub).revoke(HASH)
    expect(result).toEqual({ ok: false, reason: expected })
  })
})

describe('every exception collapses to one fixed string', () => {
  it('a thrown fetch becomes "Could not reach OpenRouter."', async () => {
    const stub = stubFetch({ status: 0, throws: true })
    const result = await clientFor(stub).mint(MINT)
    expect(result).toEqual({ ok: false, reason: 'Could not reach OpenRouter.' })
  })

  it('a fetch whose cause chain would carry the request headers leaks nothing', async () => {
    const calls: Recorded[] = []
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {} })
      // The real shape of the leak: a TypeError whose cause carries the request.
      throw new TypeError('fetch failed', { cause: { headers: init?.headers } })
    }) as unknown as typeof fetch
    const result = await clientFor({ fetchImpl }).list()
    expect(result).toEqual({ ok: false, reason: 'Could not reach OpenRouter.' })
  })

  it('a 200 whose body is not JSON becomes an unexpected-response string, not a parse error', async () => {
    const fetchImpl = (async () =>
      ({
        status: 200,
        body: { cancel: async (): Promise<void> => undefined },
        json: async (): Promise<unknown> => {
          throw new SyntaxError(`Unexpected token in ${fakeManagementKey}`)
        }
      }) as unknown as Response) as unknown as typeof fetch
    const result = await clientFor({ fetchImpl }).meta()
    expect(result).toEqual({ ok: false, reason: 'Unexpected response (200).' })
  })
})

describe('no management key configured', () => {
  it('refuses without making a request at all', async () => {
    const stub = stubFetch({ status: 200, json: { data: [] } })
    const result = await clientFor(stub, null).mint(MINT)
    expect(result).toEqual({ ok: false, reason: 'No OpenRouter management key is configured.' })
    expect(stub.calls).toHaveLength(0)
  })
})

describe('mint', () => {
  it('extracts the top-level key and data.hash by explicit field access', async () => {
    const stub = stubFetch({
      status: 201,
      json: { key: fakeMintedKey, data: { hash: HASH, limit: 0.5, name: MINT.name, extra: 'ignored' } }
    })
    const result = await clientFor(stub).mint(MINT)
    expect(result).toEqual({ ok: true, value: { key: fakeMintedKey, hash: HASH, limit: 0.5 } })
  })

  it('sends the mint body verbatim, including the hard limit', async () => {
    const stub = stubFetch({ status: 201, json: { key: fakeMintedKey, data: { hash: HASH, limit: 0.5 } } })
    await clientFor(stub).mint(MINT)
    expect(JSON.parse(String(stub.calls[0].init.body))).toEqual(MINT)
    expect(stub.calls[0].init.method).toBe('POST')
  })

  it('fails cleanly when the response omits the key or the hash', async () => {
    for (const json of [{ data: { hash: HASH } }, { key: fakeMintedKey, data: {} }, {}]) {
      const stub = stubFetch({ status: 201, json })
      const result = await clientFor(stub).mint(MINT)
      expect(result.ok).toBe(false)
    }
  })
})

describe('revoke', () => {
  it('accepts {deleted:true}', async () => {
    const stub = stubFetch({ status: 200, json: { deleted: true } })
    expect(await clientFor(stub).revoke(HASH)).toEqual({ ok: true, value: undefined })
    expect(stub.calls[0].init.method).toBe('DELETE')
  })

  it('treats a 200 without {deleted:true} as unexpected rather than as success', async () => {
    const stub = stubFetch({ status: 200, json: { deleted: false } })
    expect((await clientFor(stub).revoke(HASH)).ok).toBe(false)
  })

  it('url-encodes the hash into the path', async () => {
    const stub = stubFetch({ status: 200, json: { deleted: true } })
    await clientFor(stub).revoke('has/slash')
    expect(stub.calls[0].url).toContain('/keys/has%2Fslash')
  })
})

describe('readUsage', () => {
  it('extracts usage and limit_remaining, tolerating string counts', async () => {
    const stub = stubFetch({ status: 200, json: { data: { usage: '0.0123', limit_remaining: 0.4877 } } })
    const result = await clientFor(stub).readUsage(HASH)
    expect(result).toEqual({ ok: true, value: { usageUsd: 0.0123, limitRemaining: 0.4877 } })
  })

  it('reports a missing usage as NULL rather than 0', async () => {
    const stub = stubFetch({ status: 200, json: { data: { limit_remaining: null } } })
    const result = await clientFor(stub).readUsage(HASH)
    expect(result).toEqual({ ok: true, value: { usageUsd: null, limitRemaining: null } })
  })
})

describe('list', () => {
  it('projects hash and name, and stops when a page comes back empty', async () => {
    let page = 0
    const fetchImpl = (async () =>
      ({
        status: 200,
        body: { cancel: async (): Promise<void> => undefined },
        json: async (): Promise<unknown> =>
          page++ === 0
            ? { data: [{ hash: 'h1', name: `${MINT_NAME_PREFIX}d1`, limit: 0.5 }, { hash: 'h2', name: null }] }
            : { data: [] }
      }) as unknown as Response) as unknown as typeof fetch
    const result = await clientFor({ fetchImpl }).list()
    expect(result).toEqual({
      ok: true,
      value: [
        { hash: 'h1', name: `${MINT_NAME_PREFIX}d1` },
        { hash: 'h2', name: null }
      ]
    })
  })

  it('drops entries with no hash rather than fabricating one', async () => {
    let page = 0
    const fetchImpl = (async () =>
      ({
        status: 200,
        body: { cancel: async (): Promise<void> => undefined },
        json: async (): Promise<unknown> =>
          page++ === 0 ? { data: [{ name: 'no hash here' }, { hash: 'h1', name: 'x' }] } : { data: [] }
      }) as unknown as Response) as unknown as typeof fetch
    const result = await clientFor({ fetchImpl }).list()
    expect(result).toEqual({ ok: true, value: [{ hash: 'h1', name: 'x' }] })
  })
})

describe('queryTokens', () => {
  it('filters on api_key_id with the key HASH (D4 obligation 1)', async () => {
    const stub = stubFetch({ status: 200, json: { data: { data: [], metadata: { truncated: false } } } })
    await clientFor(stub).queryTokens(HASH, new Date('2026-07-25T00:00:00Z'), new Date('2026-07-25T01:00:00Z'))
    const body = JSON.parse(String(stub.calls[0].init.body))
    expect(body.filters).toEqual([{ field: 'api_key_id', operator: 'eq', value: HASH }])
    expect(body.time_range).toEqual({ start: '2026-07-25T00:00:00.000Z', end: '2026-07-25T01:00:00.000Z' })
    expect(body.metrics).toContain('tokens_prompt')
    expect(body.metrics).toContain('cache_hit_rate')
    // The live schema's direct cached-token metric, absent from the docs.
    expect(body.metrics).toContain('cached_tokens')
  })

  it('unwraps the DOUBLE-nested response and derives cached tokens', async () => {
    const stub = stubFetch({
      status: 200,
      json: {
        data: {
          data: [{ tokens_prompt: '10000', tokens_completion: '2000', cache_hit_rate: 0.25 }],
          metadata: { truncated: false }
        }
      }
    })
    const result = await clientFor(stub).queryTokens(HASH, new Date(0), new Date(1))
    expect(result).toEqual({
      ok: true,
      value: { tokensIn: 10000, tokensOut: 2000, tokensCached: 2500, source: 'analytics-derived' }
    })
  })

  it('returns ok/null — "not available yet", not a transport failure — on a truncated result', async () => {
    const stub = stubFetch({
      status: 200,
      json: { data: { data: [{ tokens_prompt: 1 }], metadata: { truncated: true } } }
    })
    expect(await clientFor(stub).queryTokens(HASH, new Date(0), new Date(1))).toEqual({ ok: true, value: null })
  })

  it('returns ok/null on an empty row set rather than zeros', async () => {
    const stub = stubFetch({ status: 200, json: { data: { data: [], metadata: { truncated: false } } } })
    expect(await clientFor(stub).queryTokens(HASH, new Date(0), new Date(1))).toEqual({ ok: true, value: null })
  })
})

describe('queryGatewayTotal', () => {
  it('asks for total_usage with no dimensions and returns it', async () => {
    const stub = stubFetch({
      status: 200,
      json: { data: { data: [{ total_usage: 1.25 }], metadata: { truncated: false } } }
    })
    const result = await clientFor(stub).queryGatewayTotal(new Date(0), new Date(1))
    expect(result).toEqual({ ok: true, value: 1.25 })
    const body = JSON.parse(String(stub.calls[0].init.body))
    expect(body.metrics).toEqual(['total_usage'])
    expect(body.dimensions).toBeUndefined()
  })

  it('returns null rather than 0 when the window has no rows', async () => {
    const stub = stubFetch({ status: 200, json: { data: { data: [], metadata: {} } } })
    expect(await clientFor(stub).queryGatewayTotal(new Date(0), new Date(1))).toEqual({ ok: true, value: null })
  })
})

describe('meta — the live schema, so obligation 2 is re-checked rather than remembered', () => {
  it('projects the four name lists', async () => {
    const stub = stubFetch({
      status: 200,
      json: {
        data: {
          metrics: [{ name: 'tokens_prompt' }, { name: 'cache_hit_rate' }, { notAName: 1 }],
          dimensions: [{ name: 'api_key_id' }],
          operators: [{ name: 'eq' }, { name: 'in' }],
          granularities: [{ name: 'day' }]
        }
      }
    })
    expect(await clientFor(stub).meta()).toEqual({
      ok: true,
      value: {
        metrics: ['tokens_prompt', 'cache_hit_rate'],
        dimensions: ['api_key_id'],
        operators: ['eq', 'in'],
        granularities: ['day']
      }
    })
  })
})
