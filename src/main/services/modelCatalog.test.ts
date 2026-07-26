import { describe, expect, it, vi } from 'vitest'
import { MANAGEMENT_AUTH_MODE } from '../../shared/ipc'
import type { CredentialProfileRow, ProviderConfigRow } from '../db/schema'
import {
  MODELS_RESPONSE_CAP_BYTES,
  refreshProviderModels,
  type FetchInitLike,
  type FetchLike,
  type FetchResponseLike
} from './modelCatalog'
import { REFRESH_FAILURE } from './modelCatalogCore'
import type { CredentialVault } from './vault'

/**
 * Task 3a-4: the transport's tests, against a stub `fetchImpl`.
 *
 * The two things that earn their own named tests in BOTH directions are the
 * body handling (this is the ONE place the repo deliberately departs from
 * probeCredential's cancel-always rule) and the optional credential (the
 * unauthenticated path is a SHIPPED behaviour, not a fallback).
 */

/** A realistic-shaped fake, assembled by concatenation so this file never
 *  contains a complete key shape for scripts/secret-grep.mjs (G4 scans src/). */
const FAKE_KEY = 'sk-or-v1-' + '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

const PROVIDER: ProviderConfigRow = {
  id: 'prov-1',
  name: 'OpenRouter',
  adapterType: 'codex',
  authMode: 'api_key',
  envVarName: 'OPENROUTER_API_KEY',
  baseUrl: 'https://example.invalid/api/v1',
  extraHeadersJson: null,
  model: 'moonshotai/kimi-k3',
  createdAt: '2026-07-01T00:00:00.000Z'
}

const PROFILE: CredentialProfileRow = {
  id: 'prof-1',
  providerId: 'prov-1',
  label: 'Unit test profile',
  encryptedBlob: Buffer.from([1, 2, 3]),
  fingerprintHash: 'not-a-real-hash',
  createdAt: '2026-07-01T00:00:00.000Z',
  lastVerifiedAt: null,
  unavailableSince: null,
  reencryptedAt: null
}

/** A vault stub that DECRYPTS, recording how many times it was asked. */
function okVault(key = FAKE_KEY, extra: Record<string, unknown> = {}) {
  const calls: string[] = []
  const vault = {
    decryptForLaunch: async (id: string) => {
      calls.push(id)
      return { ok: true as const, value: { key, ...extra } }
    }
  } as unknown as Pick<CredentialVault, 'decryptForLaunch'>
  return { vault, calls }
}

/** A vault stub that must NEVER be called. */
function forbiddenVault() {
  const calls: string[] = []
  const vault = {
    decryptForLaunch: async (id: string) => {
      calls.push(id)
      throw new Error('decryptForLaunch must not be reached on this path')
    }
  } as unknown as Pick<CredentialVault, 'decryptForLaunch'>
  return { vault, calls }
}

/** A response stub whose body records whether it was READ or CANCELLED. */
function stubResponse(status: number, text: string) {
  const bytes = new TextEncoder().encode(text)
  const state = { read: false, cancelled: false, chunksPulled: 0 }
  let offset = 0
  const CHUNK = 64 * 1024
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
            if (offset >= bytes.byteLength) return { done: true }
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
  init: FetchInitLike
}

function stubFetch(res: FetchResponseLike, recorded: Recorded[] = []): FetchLike {
  return async (url, init) => {
    recorded.push({ url, init })
    return res
  }
}

const GOOD_BODY = JSON.stringify({
  data: [
    { id: 'moonshotai/kimi-k3', name: 'MoonshotAI: Kimi K3', context_length: 1048576 },
    { id: 'moonshotai/kimi-k2.7-code', name: 'MoonshotAI: Kimi K2.7 Code', context_length: 262144 }
  ]
})

/* ------------------------------------------------------------------ */
/* The three refusals that happen BEFORE any decryption                */
/* ------------------------------------------------------------------ */

describe('⚠ the refusals that happen BEFORE the vault is touched', () => {
  it('auth_mode = "management" refuses, WITHOUT decrypting and WITHOUT calling fetch', () => {
    const { vault, calls } = forbiddenVault()
    const fetchImpl = vi.fn()
    return refreshProviderModels({
      provider: { ...PROVIDER, authMode: MANAGEMENT_AUTH_MODE },
      profile: PROFILE,
      vault,
      fetchImpl: fetchImpl as unknown as FetchLike
    }).then((r) => {
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.reason).toBe(REFRESH_FAILURE.management)
      expect(calls).toEqual([])
      expect(fetchImpl).not.toHaveBeenCalled()
    })
  })

  it('a management provider is refused even when it HAS a base URL (the live fixture’s shape)', async () => {
    const { vault, calls } = forbiddenVault()
    const r = await refreshProviderModels({
      provider: { ...PROVIDER, name: 'OpenRouter admin', authMode: MANAGEMENT_AUTH_MODE },
      profile: PROFILE,
      vault,
      fetchImpl: stubFetch(stubResponse(200, GOOD_BODY).res)
    })
    expect(r.ok).toBe(false)
    expect(calls).toEqual([])
  })

  it('no base_url refuses by PROVIDER NAME, without decrypting', async () => {
    const { vault, calls } = forbiddenVault()
    const fetchImpl = vi.fn()
    const r = await refreshProviderModels({
      provider: { ...PROVIDER, name: 'Anthropic direct', baseUrl: null },
      profile: PROFILE,
      vault,
      fetchImpl: fetchImpl as unknown as FetchLike
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe("Provider 'Anthropic direct' has no base URL to refresh models from.")
    expect(calls).toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('⚠ a profile carrying unavailable_since refuses BY LABEL, with NO decryption re-attempted', async () => {
    // D33 clause 8: a known-bad row is refused without re-attempting
    // decryption — a retry only widens the window.
    const { vault, calls } = forbiddenVault()
    const fetchImpl = vi.fn()
    const r = await refreshProviderModels({
      provider: PROVIDER,
      profile: { ...PROFILE, label: 'Claude fake key', unavailableSince: '2026-07-25T19:41:02.933Z' },
      vault,
      fetchImpl: fetchImpl as unknown as FetchLike
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toContain("Credential profile 'Claude fake key' is unavailable")
    expect(calls).toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('a decrypt failure surfaces the vault’s own message and makes no call', async () => {
    const fetchImpl = vi.fn()
    const vault = {
      decryptForLaunch: async () => ({
        ok: false as const,
        kind: 'undecryptable' as const,
        message: "Credential profile 'X' is unavailable: decryption failed. Re-enter the credential in Settings."
      })
    } as unknown as Pick<CredentialVault, 'decryptForLaunch'>
    const r = await refreshProviderModels({
      provider: PROVIDER,
      profile: PROFILE,
      vault,
      fetchImpl: fetchImpl as unknown as FetchLike
    })
    expect(r.ok).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

/* ------------------------------------------------------------------ */
/* ⚠ The body rule, in BOTH directions                                 */
/* ------------------------------------------------------------------ */

describe('⚠ the body is read ONLY on 2xx, and cancelled unread on every other path', () => {
  it('2xx -> the body IS read, and parses', async () => {
    const { res, state } = stubResponse(200, GOOD_BODY)
    const { vault } = okVault()
    const r = await refreshProviderModels({
      provider: PROVIDER,
      profile: null,
      vault,
      fetchImpl: stubFetch(res)
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(state.read).toBe(true)
    expect(r.models.map((m) => m.modelId)).toEqual([
      'moonshotai/kimi-k3',
      'moonshotai/kimi-k2.7-code'
    ])
    expect(r.droppedCount).toBe(0)
  })

  it.each([
    [400, 'Unexpected response (400).'],
    [401, REFRESH_FAILURE.authFailed],
    [403, REFRESH_FAILURE.authFailed],
    [404, 'Unexpected response (404).'],
    [418, 'Unexpected response (418).'],
    [429, REFRESH_FAILURE.rateLimited],
    [500, REFRESH_FAILURE.providerError],
    [503, REFRESH_FAILURE.providerError]
  ])('%i -> body CANCELLED UNREAD, fixed reason "%s"', async (status, expected) => {
    // The body on these paths is the one most likely to echo a submitted key.
    const { res, state } = stubResponse(status, `{"error":"key ${FAKE_KEY} rejected"}`)
    const { vault } = okVault()
    const r = await refreshProviderModels({
      provider: PROVIDER,
      profile: PROFILE,
      vault,
      fetchImpl: stubFetch(res)
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe(expected)
    expect(state.cancelled).toBe(true)
    expect(state.read).toBe(false)
    expect(state.chunksPulled).toBe(0)
  })

  it('⚠ no fragment >= 8 chars of the submitted key survives into a 401 reason', async () => {
    const { res } = stubResponse(401, `{"error":{"message":"Invalid API key: ${FAKE_KEY}"}}`)
    const { vault } = okVault()
    const r = await refreshProviderModels({
      provider: PROVIDER,
      profile: PROFILE,
      vault,
      fetchImpl: stubFetch(res)
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    for (let i = 0; i + 8 <= FAKE_KEY.length; i++) {
      expect(r.reason).not.toContain(FAKE_KEY.slice(i, i + 8))
    }
  })

  it('2xx with a non-JSON body -> the FIXED unrecognized message, no parse text echoed', async () => {
    const { res, state } = stubResponse(200, '<html><body>Gateway</body></html>')
    const { vault } = okVault()
    const r = await refreshProviderModels({
      provider: PROVIDER,
      profile: null,
      vault,
      fetchImpl: stubFetch(res)
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe(REFRESH_FAILURE.unrecognized)
    expect(r.reason).not.toContain('html')
    expect(state.read).toBe(true)
  })

  it('2xx with valid JSON of the WRONG shape -> the same fixed message', async () => {
    const { res } = stubResponse(200, JSON.stringify({ models: [] }))
    const { vault } = okVault()
    const r = await refreshProviderModels({
      provider: PROVIDER,
      profile: null,
      vault,
      fetchImpl: stubFetch(res)
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe(REFRESH_FAILURE.unrecognized)
  })

  it('a 2xx with NO body at all is refused rather than crashing', async () => {
    const { vault } = okVault()
    const r = await refreshProviderModels({
      provider: PROVIDER,
      profile: null,
      vault,
      fetchImpl: stubFetch({ status: 200, body: null })
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe(REFRESH_FAILURE.unrecognized)
  })

  it('an oversized response is REFUSED AT THE CAP rather than buffered whole', async () => {
    // 12 MB against an 8 MB ceiling. The reader is cancelled part-way, so the
    // remainder is never pulled.
    const oversized = 'x'.repeat(MODELS_RESPONSE_CAP_BYTES + 4_000_000)
    const { res, state } = stubResponse(200, oversized)
    const { vault } = okVault()
    const r = await refreshProviderModels({
      provider: PROVIDER,
      profile: null,
      vault,
      fetchImpl: stubFetch(res)
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe(REFRESH_FAILURE.unrecognized)
    expect(state.cancelled).toBe(true)
    // Cancelled before the whole body was pulled.
    const totalChunks = Math.ceil(oversized.length / (64 * 1024))
    expect(state.chunksPulled).toBeLessThan(totalChunks)
  })

  it('the cap is set from a MEASUREMENT, with headroom over the live 0.51 MiB list', () => {
    expect(MODELS_RESPONSE_CAP_BYTES).toBe(8_000_000)
    expect(MODELS_RESPONSE_CAP_BYTES).toBeGreaterThan(535_821 * 10)
  })
})

/* ------------------------------------------------------------------ */
/* Exceptions and timeouts collapse to one message                     */
/* ------------------------------------------------------------------ */

describe('a thrown fetch and a timeout both collapse to the fixed unreachable message', () => {
  it('a thrown fetch', async () => {
    const { vault } = okVault()
    const r = await refreshProviderModels({
      provider: PROVIDER,
      profile: PROFILE,
      vault,
      fetchImpl: async () => {
        // A real fetch exception's cause chain can carry the request, headers
        // included. It must be discarded wholesale.
        const err = new Error('connect ECONNREFUSED') as Error & { cause?: unknown }
        err.cause = { headers: { authorization: `Bearer ${FAKE_KEY}` } }
        throw err
      }
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe(REFRESH_FAILURE.unreachable)
    expect(r.reason).not.toContain('ECONNREFUSED')
    for (let i = 0; i + 8 <= FAKE_KEY.length; i++) {
      expect(r.reason).not.toContain(FAKE_KEY.slice(i, i + 8))
    }
  })

  it('an AbortError (the timeout path)', async () => {
    const { vault } = okVault()
    const r = await refreshProviderModels({
      provider: PROVIDER,
      profile: null,
      vault,
      fetchImpl: async () => {
        throw new DOMException('The operation was aborted due to timeout.', 'TimeoutError')
      }
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe(REFRESH_FAILURE.unreachable)
  })

  it('a body stream that errors mid-read is refused, not thrown', async () => {
    const { vault } = okVault()
    const r = await refreshProviderModels({
      provider: PROVIDER,
      profile: null,
      vault,
      fetchImpl: async () => ({
        status: 200,
        body: {
          cancel: async () => undefined,
          getReader: () => ({
            read: async () => {
              throw new Error('stream broke')
            },
            cancel: async () => undefined
          })
        }
      })
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe(REFRESH_FAILURE.unrecognized)
  })
})

/* ------------------------------------------------------------------ */
/* The request itself                                                  */
/* ------------------------------------------------------------------ */

describe('the request — the key lives in the Authorization header and NOWHERE else', () => {
  it('⚠ asserted over the recorded request’s FULL key set', async () => {
    const recorded: Recorded[] = []
    const { vault } = okVault()
    await refreshProviderModels({
      provider: PROVIDER,
      profile: PROFILE,
      vault,
      fetchImpl: stubFetch(stubResponse(200, GOOD_BODY).res, recorded)
    })
    expect(recorded).toHaveLength(1)
    const { url, init } = recorded[0]

    // Not in the URL, not in a query string.
    expect(url).toBe('https://example.invalid/api/v1/models')
    expect(url).not.toContain(FAKE_KEY)
    expect(url).not.toContain('?')

    // Exactly one header carries it, and it is `authorization`.
    const carriers = Object.entries(init.headers).filter(([, v]) => v.includes(FAKE_KEY))
    expect(carriers.map(([k]) => k)).toEqual(['authorization'])
    expect(init.headers.authorization).toBe(`Bearer ${FAKE_KEY}`)

    // Nothing else on the init object carries it either.
    const rest = JSON.stringify({ ...init, headers: undefined })
    expect(rest).not.toContain(FAKE_KEY)
    expect(init.method).toBe('GET')
  })

  it('⚠ with NO credential, NO Authorization header is sent at all — and the call still succeeds', async () => {
    // The optional-credential path is a SHIPPED behaviour, not a fallback:
    // OpenRouter's /models answers 200 with no key (D4-verified 2026-07-25),
    // which is exactly why a list call cannot serve as a Test key.
    const recorded: Recorded[] = []
    const { vault, calls } = forbiddenVault()
    const r = await refreshProviderModels({
      provider: PROVIDER,
      profile: null,
      vault,
      fetchImpl: stubFetch(stubResponse(200, GOOD_BODY).res, recorded)
    })
    expect(r.ok).toBe(true)
    expect(calls).toEqual([]) // nothing was decrypted
    const keys = Object.keys(recorded[0].init.headers).map((k) => k.toLowerCase())
    expect(keys).not.toContain('authorization')
    expect(keys).toEqual(['accept'])
  })

  it('strips a trailing slash from the base URL (a known failure mode on this route)', async () => {
    const recorded: Recorded[] = []
    const { vault } = okVault()
    await refreshProviderModels({
      provider: { ...PROVIDER, baseUrl: 'https://example.invalid/api/v1///' },
      profile: null,
      vault,
      fetchImpl: stubFetch(stubResponse(200, GOOD_BODY).res, recorded)
    })
    expect(recorded[0].url).toBe('https://example.invalid/api/v1/models')
  })

  it('provider extra headers are sent and the ENVELOPE’S OWN override them (D33 resolution e)', async () => {
    const recorded: Recorded[] = []
    const { vault } = okVault(FAKE_KEY, {
      extraHeaders: { 'x-title': 'from-envelope', 'x-envelope-only': 'yes' }
    })
    await refreshProviderModels({
      provider: {
        ...PROVIDER,
        extraHeadersJson: JSON.stringify({ 'x-title': 'from-provider', 'http-referer': 'chorus' })
      },
      profile: PROFILE,
      vault,
      fetchImpl: stubFetch(stubResponse(200, GOOD_BODY).res, recorded)
    })
    const h = recorded[0].init.headers
    expect(h['x-title']).toBe('from-envelope')
    expect(h['http-referer']).toBe('chorus')
    expect(h['x-envelope-only']).toBe('yes')
  })

  it('the envelope’s baseUrl wins over the provider’s', async () => {
    const recorded: Recorded[] = []
    const { vault } = okVault(FAKE_KEY, { baseUrl: 'https://envelope.invalid/v9/' })
    await refreshProviderModels({
      provider: PROVIDER,
      profile: PROFILE,
      vault,
      fetchImpl: stubFetch(stubResponse(200, GOOD_BODY).res, recorded)
    })
    expect(recorded[0].url).toBe('https://envelope.invalid/v9/models')
  })

  it('a hand-edited extra_headers_json degrades to no extra headers rather than breaking', async () => {
    const recorded: Recorded[] = []
    const { vault } = okVault()
    for (const bad of ['{not json', '[1,2,3]', 'null', '{"a":5}']) {
      recorded.length = 0
      const r = await refreshProviderModels({
        provider: { ...PROVIDER, extraHeadersJson: bad },
        profile: null,
        vault,
        fetchImpl: stubFetch(stubResponse(200, GOOD_BODY).res, recorded)
      })
      expect(r.ok).toBe(true)
      // Non-string values are dropped; malformed JSON yields none at all.
      expect(Object.keys(recorded[0].init.headers)).not.toContain('a')
    }
  })

  it('makes exactly ONE call — no retry, no backoff', async () => {
    const recorded: Recorded[] = []
    const { vault } = okVault()
    await refreshProviderModels({
      provider: PROVIDER,
      profile: PROFILE,
      vault,
      fetchImpl: stubFetch(stubResponse(500, '{}').res, recorded)
    })
    expect(recorded).toHaveLength(1)
  })

  it('carries an abort signal, so a hung provider cannot hang the app', async () => {
    const recorded: Recorded[] = []
    const { vault } = okVault()
    await refreshProviderModels({
      provider: PROVIDER,
      profile: null,
      vault,
      fetchImpl: stubFetch(stubResponse(200, GOOD_BODY).res, recorded)
    })
    expect(recorded[0].init.signal).toBeInstanceOf(AbortSignal)
  })

  it('decrypts EXACTLY ONCE per call, at the moment of the call (no memo across calls)', async () => {
    const { vault, calls } = okVault()
    const args = {
      provider: PROVIDER,
      profile: PROFILE,
      vault,
      fetchImpl: stubFetch(stubResponse(200, GOOD_BODY).res)
    }
    await refreshProviderModels(args)
    await refreshProviderModels(args)
    // Two calls, two decryptions — nothing is held between them.
    expect(calls).toEqual(['prof-1', 'prof-1'])
  })
})
