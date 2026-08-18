import { describe, expect, it } from 'vitest'
import {
  ATTRIBUTION_STATES,
  COUNCIL_MINT_NAME_PREFIX,
  MINT_NAME_PREFIX,
  MINT_NAME_PREFIXES,
  buildMintRequest,
  chooseAttributionStrategy,
  classifyManagementStatus,
  computeAttributionSummary,
  computeKeyReconcile,
  interpretTokenRow,
  isChorusMintedName,
  managementFailure,
  parseCount,
  parseRate,
  type AttributionPolicy,
  type LiveKeySummary,
  type ManagementFailureKind,
  type OpenLedgerRow,
  type TelemetryRowSummary
} from './attributionCore'

// Task 3a-3 (D42): unit tests for the Electron-free, fetch-free attribution
// core. Plain Node, zero mocks, no network, no clock — every `now` is injected.
//
// Synthetic keys of realistic SHAPE only, assembled by concatenation so no
// literal in this file forms a complete key shape for scripts/secret-grep.mjs
// (the G4 gate scans src/, and G4 is load-bearing in this task). Never a real
// credential.
const fakeMintedKey = 'sk-or-v1-' + 'Ch0rusMinted7'.repeat(4)
const fakeManagementKey = 'sk-or-v1-' + 'Ch0rusMgmt42x'.repeat(4)

const POLICY: AttributionPolicy = { limitUsd: 0.5, ttlMs: 12 * 60 * 60 * 1000 }
const NOW = new Date('2026-07-25T12:00:00.000Z')
const DISPATCH_ID = '3f7c1e2a-9b04-4d5e-8a11-6c2d0e9f4b73'
/** D66(c): the ledger's owner is DISCRIMINATED BY KIND. The tag is the only
 *  change to every pre-existing case below — each one's inputs, expectations
 *  and name are otherwise what they were before the widening. */
const DISPATCH_OWNER = { kind: 'dispatch', dispatchId: DISPATCH_ID } as const
const RUN_ID = 'b2c8d41e-77a3-4f60-9d15-0ae53c7b8f92'
const COUNCIL_OWNER = { kind: 'council', runId: RUN_ID } as const

/** Every ≥8-character window of a string — the leak check the five-surface
 *  inspection uses at runtime, applied here to every sanitized message. */
function windows8(s: string): string[] {
  const out: string[] = []
  for (let i = 0; i + 8 <= s.length; i++) out.push(s.slice(i, i + 8))
  return out
}

function expectNoKeyFragment(message: string, ...keys: string[]): void {
  for (const key of keys) {
    for (const w of windows8(key)) expect(message).not.toContain(w)
  }
}

/* ------------------------------------------------------------------ */
/* Strategy selection — THE BILLING SEPARATION                         */
/* ------------------------------------------------------------------ */

describe('chooseAttributionStrategy — keyed on auth mode and nothing else (D42)', () => {
  // ⚠ THE MOST IMPORTANT TEST IN THE TASK. A regression here silently converts
  // a flat-rate subscription into per-token billing.
  it('returns cli-logs for subscription EVEN WITH a route and a management key', () => {
    const strategy = chooseAttributionStrategy({
      authType: 'subscription',
      hasManagementKey: true,
      hasRoute: true,
      policy: POLICY
    })
    // The WHOLE object, not just the tag: a future field cannot smuggle a route
    // in behind a matching discriminant.
    expect(strategy).toEqual({ kind: 'cli-logs' })
  })

  it('returns cli-logs for subscription in every combination of the other inputs', () => {
    for (const hasManagementKey of [true, false]) {
      for (const hasRoute of [true, false]) {
        expect(
          chooseAttributionStrategy({ authType: 'subscription', hasManagementKey, hasRoute, policy: POLICY })
        ).toEqual({ kind: 'cli-logs' })
      }
    }
  })

  it('never returns minted-key for a subscription session, whatever the policy', () => {
    const strategy = chooseAttributionStrategy({
      authType: 'subscription',
      hasManagementKey: true,
      hasRoute: true,
      policy: { limitUsd: 999, ttlMs: 1 }
    })
    expect(strategy.kind).not.toBe('minted-key')
  })

  it('returns minted-key for api_key WITH a management key and a route, carrying the policy', () => {
    expect(
      chooseAttributionStrategy({ authType: 'api_key', hasManagementKey: true, hasRoute: true, policy: POLICY })
    ).toEqual({ kind: 'minted-key', limitUsd: 0.5, ttlMs: 12 * 60 * 60 * 1000 })
  })

  it('returns none/no-management-key for api_key WITHOUT one — never minted-key with a null key', () => {
    expect(
      chooseAttributionStrategy({ authType: 'api_key', hasManagementKey: false, hasRoute: true, policy: POLICY })
    ).toEqual({ kind: 'none', reason: 'no-management-key' })
  })

  it('returns none/no-route for api_key with no route — minting for a launch that cannot use it is pure orphan risk', () => {
    expect(
      chooseAttributionStrategy({ authType: 'api_key', hasManagementKey: true, hasRoute: false, policy: POLICY })
    ).toEqual({ kind: 'none', reason: 'no-route' })
  })
})

/* ------------------------------------------------------------------ */
/* Mint-request construction                                           */
/* ------------------------------------------------------------------ */

describe('buildMintRequest — there is no code path to an uncapped key', () => {
  it('builds a body carrying a positive limit and a UTC expires_at', () => {
    const result = buildMintRequest({ owner: DISPATCH_OWNER, limitUsd: 0.5, now: NOW, ttlMs: 3_600_000 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.body.limit).toBe(0.5)
    expect(result.body.expires_at).toBe('2026-07-25T13:00:00.000Z')
    // The API rejects non-UTC timestamps (D4-verified 2026-07-25).
    expect(result.body.expires_at.endsWith('Z')).toBe(true)
  })

  it.each([
    ['null', null as unknown as number],
    ['zero', 0],
    ['negative', -1],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY]
  ])('REFUSES a %s limit', (_label, limitUsd) => {
    const result = buildMintRequest({ owner: DISPATCH_OWNER, limitUsd, now: NOW, ttlMs: 3_600_000 })
    expect(result.ok).toBe(false)
  })

  it.each([
    ['zero', 0],
    ['negative', -5],
    ['NaN', Number.NaN]
  ])('REFUSES a %s ttl', (_label, ttlMs) => {
    expect(buildMintRequest({ owner: DISPATCH_OWNER, limitUsd: 0.5, now: NOW, ttlMs }).ok).toBe(false)
  })

  it('refuses an invalid clock rather than emitting "Invalid Date"', () => {
    const result = buildMintRequest({
      owner: DISPATCH_OWNER,
      limitUsd: 0.5,
      now: new Date('not-a-date'),
      ttlMs: 3_600_000
    })
    expect(result.ok).toBe(false)
  })
})

describe('the mint name is sent to a third party', () => {
  it('is exactly the prefix plus the dispatch id', () => {
    const result = buildMintRequest({ owner: DISPATCH_OWNER, limitUsd: 0.5, now: NOW, ttlMs: 3_600_000 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.body.name).toBe(`${MINT_NAME_PREFIX}${DISPATCH_ID}`)
    expect(result.body.name.startsWith(MINT_NAME_PREFIX)).toBe(true)
  })

  it('carries no label, project name, cwd, branch or other free-form text', () => {
    const result = buildMintRequest({ owner: DISPATCH_OWNER, limitUsd: 0.5, now: NOW, ttlMs: 3_600_000 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Everything after the fixed prefix IS the dispatch id, nothing else.
    expect(result.body.name.slice(MINT_NAME_PREFIX.length)).toBe(DISPATCH_ID)
    expect(Object.keys(result.body).sort()).toEqual(['expires_at', 'limit', 'name'])
  })

  it.each([
    ['a cwd', 'C:\\Projects\\ContactEstablished\\Chorus'],
    ['a label', 'OR milestone key'],
    ['a branch', 'chorus/Chorus/24b5c1fe'],
    ['an empty id', ''],
    ['a newline injection', 'abc\ndef']
  ])('REFUSES %s as a dispatch id — the guard is what keeps free text out of the name', (_l, dispatchId) => {
    expect(buildMintRequest({ owner: { kind: 'dispatch', dispatchId }, limitUsd: 0.5, now: NOW, ttlMs: 3_600_000 }).ok).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* The failure vocabulary                                              */
/* ------------------------------------------------------------------ */

describe('managementFailure — a fixed vocabulary, never a response body', () => {
  it.each<[ManagementFailureKind]>([
    ['unauthorized'],
    ['not-found'],
    ['rate-limited'],
    ['provider-error'],
    ['unexpected'],
    ['unreachable']
  ])('%s leaks no ≥8-char fragment of any key', (kind) => {
    const message = managementFailure(kind, 418)
    expect(message.length).toBeGreaterThan(0)
    expectNoKeyFragment(message, fakeMintedKey, fakeManagementKey)
  })

  it('mirrors probeCredential — 401 and 403 collapse to ONE message', () => {
    expect(classifyManagementStatus(401)).toBe('unauthorized')
    expect(classifyManagementStatus(403)).toBe('unauthorized')
    expect(managementFailure('unauthorized')).toBe('The OpenRouter management key was rejected.')
  })

  it('admits the STATUS on an unexpected response and nothing else about it', () => {
    expect(managementFailure('unexpected', 418)).toBe('Unexpected response (418).')
  })

  it.each([
    [200, null],
    [201, null],
    [204, null],
    [400, 'unexpected'],
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [404, 'not-found'],
    [429, 'rate-limited'],
    [500, 'provider-error'],
    [503, 'provider-error']
  ])('classifies %i as %s', (status, expected) => {
    expect(classifyManagementStatus(status as number)).toBe(expected)
  })
})

/* ------------------------------------------------------------------ */
/* Defensive numeric parsing                                           */
/* ------------------------------------------------------------------ */

describe('parseCount — 0 and unknown must never be confused', () => {
  it('parses counts that arrive as STRINGS (documented OpenRouter behaviour)', () => {
    expect(parseCount('6331')).toBe(6331)
    expect(parseCount(' 42 ')).toBe(42)
    expect(parseCount('0')).toBe(0)
  })

  it('parses counts that arrive as numbers', () => {
    expect(parseCount(6331)).toBe(6331)
    expect(parseCount(0)).toBe(0)
  })

  it.each([
    ['a non-numeric string', 'n/a'],
    ['an EMPTY string — Number("") is 0, which is the fabricated zero this guards', ''],
    ['whitespace only', '   '],
    ['null', null],
    ['undefined', undefined],
    ['an object', {}],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY]
  ])('yields null for %s — never NaN, never 0', (_label, value) => {
    expect(parseCount(value)).toBeNull()
  })

  it('distinguishes a real zero from an unknown', () => {
    expect(parseCount('0')).toBe(0)
    expect(parseCount('')).toBeNull()
    expect(parseCount('0')).not.toBeNull()
  })
})

describe('parseRate — a 0..1 ratio or nothing', () => {
  it('accepts in-range values from both string and number', () => {
    expect(parseRate(0.176)).toBeCloseTo(0.176)
    expect(parseRate('0.5')).toBe(0.5)
    expect(parseRate(0)).toBe(0)
    expect(parseRate(1)).toBe(1)
  })

  it('REJECTS out-of-range values rather than clamping — the field would not mean what we think', () => {
    expect(parseRate(1.5)).toBeNull()
    expect(parseRate(-0.1)).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* Tokens — cached is its own number                                   */
/* ------------------------------------------------------------------ */

describe('interpretTokenRow — tokens_cached is NEVER folded into tokens_in', () => {
  it('reports the three token fields independently, with tokens_in untouched by the cached figure', () => {
    const result = interpretTokenRow({
      row: { tokens_prompt: 10_000, tokens_completion: 2_000, cache_hit_rate: 0.25 },
      truncated: false
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // tokens_in is the RAW prompt total — not reduced by the cached portion…
    expect(result.tokens.tokensIn).toBe(10_000)
    // …and not inflated by it either.
    expect(result.tokens.tokensIn).not.toBe(10_000 - 2_500)
    expect(result.tokens.tokensIn).not.toBe(10_000 + 2_500)
    expect(result.tokens.tokensOut).toBe(2_000)
    expect(result.tokens.tokensCached).toBe(2_500)
  })

  it('labels a derived cached figure as derived — never as measured', () => {
    const result = interpretTokenRow({
      row: { tokens_prompt: '10000', tokens_completion: '2000', cache_hit_rate: 0.25 },
      truncated: false
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.tokens.source).toBe('analytics-derived')
  })

  it('prefers the DIRECT `cached_tokens` metric the LIVE api returns, and labels it measured', () => {
    // The published metric list has no cached-token metric; GET /analytics/meta
    // at execution returned one named `cached_tokens`. Measured beats derived.
    const result = interpretTokenRow({
      row: { tokens_prompt: 10_000, tokens_completion: 2_000, cache_hit_rate: 0.25, cached_tokens: 1_234 },
      truncated: false
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.tokens.tokensCached).toBe(1_234)
    expect(result.tokens.source).toBe('analytics')
    // Still not folded into tokensIn.
    expect(result.tokens.tokensIn).toBe(10_000)
  })

  it('also accepts the symmetric `tokens_cached` spelling a rename would plausibly use', () => {
    const result = interpretTokenRow({
      row: { tokens_prompt: 10_000, tokens_completion: 2_000, cache_hit_rate: 0.25, tokens_cached: 999 },
      truncated: false
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.tokens.tokensCached).toBe(999)
    expect(result.tokens.source).toBe('analytics')
  })

  it('FALLS BACK to the derivation when the direct metric is absent, and relabels', () => {
    const result = interpretTokenRow({
      row: { tokens_prompt: 10_000, tokens_completion: 2_000, cache_hit_rate: 0.25 },
      truncated: false
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.tokens.tokensCached).toBe(2_500)
    expect(result.tokens.source).toBe('analytics-derived')
  })

  it('leaves cached NULL — not 0 — when the rate is missing or unusable', () => {
    for (const cache_hit_rate of [undefined, null, 'n/a', 1.5]) {
      const result = interpretTokenRow({
        row: { tokens_prompt: 10_000, tokens_completion: 2_000, cache_hit_rate },
        truncated: false
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.tokens.tokensCached).toBeNull()
      expect(result.tokens.tokensIn).toBe(10_000)
    }
  })

  it('REFUSES a truncated result — partial totals must not be written as complete', () => {
    const result = interpretTokenRow({
      row: { tokens_prompt: 10_000, tokens_completion: 2_000, cache_hit_rate: 0.25 },
      truncated: true
    })
    expect(result).toEqual({ ok: false, reason: 'truncated' })
  })

  it('reports no-data for an absent row rather than inventing zeros', () => {
    expect(interpretTokenRow({ row: null, truncated: false })).toEqual({ ok: false, reason: 'no-data' })
    expect(interpretTokenRow({ row: undefined, truncated: false })).toEqual({ ok: false, reason: 'no-data' })
  })

  it('leaves source NULL when nothing at all parsed — an empty row is not a zero-token dispatch', () => {
    const result = interpretTokenRow({ row: { tokens_prompt: 'n/a', tokens_completion: '' }, truncated: false })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.tokens).toEqual({ tokensIn: null, tokensOut: null, tokensCached: null, source: null })
  })
})

/* ------------------------------------------------------------------ */
/* Ownership — the predicate that decides whether to destroy a key     */
/* ------------------------------------------------------------------ */

describe('isChorusMintedName — the ONLY ownership marker', () => {
  it('accepts a name we minted', () => {
    expect(isChorusMintedName(`${MINT_NAME_PREFIX}${DISPATCH_ID}`)).toBe(true)
  })

  it('REJECTS a case variant — a hand-made "Chorus-Dispatch-…" is not ours', () => {
    expect(isChorusMintedName('Chorus-Dispatch-abc')).toBe(false)
    expect(isChorusMintedName('CHORUS-DISPATCH-abc')).toBe(false)
  })

  it('REJECTS the prefix appearing anywhere but index 0 — an includes() check would delete this key', () => {
    expect(isChorusMintedName('backup of chorus-dispatch- experiment')).toBe(false)
    expect(isChorusMintedName(` ${MINT_NAME_PREFIX}abc`)).toBe(false)
  })

  it('REJECTS a missing or empty name — "no name" is not ours', () => {
    expect(isChorusMintedName(null)).toBe(false)
    expect(isChorusMintedName(undefined)).toBe(false)
    expect(isChorusMintedName('')).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* Orphan reconciliation — the §6.1 matrix, row by row                 */
/* ------------------------------------------------------------------ */

const ours = (hash: string, id = DISPATCH_ID): LiveKeySummary => ({
  hash,
  name: `${MINT_NAME_PREFIX}${id}`
})

describe('computeKeyReconcile — row 1: ours, live, ledger open, dispatch NOT running', () => {
  it('reads and revokes', () => {
    const actions = computeKeyReconcile({
      liveKeys: [ours('h1')],
      openLedger: [{ kind: 'dispatch', dispatchId: DISPATCH_ID, hash: 'h1' }],
      runningDispatchIds: new Set(),
      runningCouncilRunIds: new Set()
    })
    expect(actions).toEqual([{ kind: 'read-and-revoke', hash: 'h1', dispatchId: DISPATCH_ID }])
  })
})

describe('computeKeyReconcile — row 2: ours, live, ledger open, dispatch IS running', () => {
  it('takes NO action — a live dispatch owns its key', () => {
    const actions = computeKeyReconcile({
      liveKeys: [ours('h1')],
      openLedger: [{ kind: 'dispatch', dispatchId: DISPATCH_ID, hash: 'h1' }],
      runningDispatchIds: new Set([DISPATCH_ID]),
      runningCouncilRunIds: new Set()
    })
    expect(actions).toEqual([])
  })
})

describe('computeKeyReconcile — row 3: ours by prefix, live, absent from the ledger', () => {
  it('revokes it as unattributed — a key we cannot account for is one we must not keep', () => {
    const actions = computeKeyReconcile({
      liveKeys: [ours('h-lost')],
      openLedger: [],
      runningDispatchIds: new Set(),
      runningCouncilRunIds: new Set()
    })
    expect(actions).toEqual([{ kind: 'revoke-unattributed', hash: 'h-lost' }])
  })
})

describe('computeKeyReconcile — ⚠ row 4: a live key that is NOT ours', () => {
  // This test must fail against an over-eager implementation, not merely pass
  // against a correct one — hence the three named near-misses below.
  it('produces an EMPTY action list for a hand-made key', () => {
    const actions = computeKeyReconcile({
      liveKeys: [{ hash: 'h-user', name: 'my personal key' }],
      openLedger: [],
      runningDispatchIds: new Set(),
      runningCouncilRunIds: new Set()
    })
    expect(actions).toEqual([])
  })

  it.each([
    ['a case variant', 'Chorus-Dispatch-abc'],
    ['a substring match', 'backup of chorus-dispatch- experiment'],
    ['a missing name', null]
  ])('produces an EMPTY action list for %s', (_label, name) => {
    const actions = computeKeyReconcile({
      liveKeys: [{ hash: 'h-user', name }],
      openLedger: [],
      runningDispatchIds: new Set(),
      runningCouncilRunIds: new Set()
    })
    expect(actions).toEqual([])
  })

  it('leaves a non-Chorus key alone even when a ledger row somehow names its hash', () => {
    // Only reachable through a hand-edited DB — and the answer is still "never
    // revoke a key we cannot prove is ours".
    const actions = computeKeyReconcile({
      liveKeys: [{ hash: 'h-user', name: 'my personal key' }],
      openLedger: [{ kind: 'dispatch', dispatchId: DISPATCH_ID, hash: 'h-user' }],
      runningDispatchIds: new Set(),
      runningCouncilRunIds: new Set()
    })
    expect(actions).toEqual([])
  })

  it('revokes ONLY our key when ours and a hand-made one are live together', () => {
    const actions = computeKeyReconcile({
      liveKeys: [{ hash: 'h-user', name: 'my personal key' }, ours('h1')],
      openLedger: [{ kind: 'dispatch', dispatchId: DISPATCH_ID, hash: 'h1' }],
      runningDispatchIds: new Set(),
      runningCouncilRunIds: new Set()
    })
    expect(actions).toEqual([{ kind: 'read-and-revoke', hash: 'h1', dispatchId: DISPATCH_ID }])
  })
})

describe('computeKeyReconcile — row 5: ledger row open, key gone', () => {
  it('closes the row with spend UNKNOWN, and emits no revoke for a key that is not there', () => {
    const actions = computeKeyReconcile({
      liveKeys: [],
      openLedger: [{ kind: 'dispatch', dispatchId: DISPATCH_ID, hash: 'h-gone' }],
      runningDispatchIds: new Set(),
      runningCouncilRunIds: new Set()
    })
    expect(actions).toEqual([{ kind: 'close-unknown', dispatchId: DISPATCH_ID }])
  })
})

describe('computeKeyReconcile — the whole matrix at once', () => {
  it('classifies five populations in one pass without cross-talk', () => {
    const liveKeys: LiveKeySummary[] = [
      ours('h1', 'd-1'), // row 1
      ours('h2', 'd-2'), // row 2 (running)
      ours('h3', 'd-3'), // row 3 (not in ledger)
      { hash: 'h4', name: 'user key' } // row 4
    ]
    const openLedger: OpenLedgerRow[] = [
      { kind: 'dispatch', dispatchId: 'd-1', hash: 'h1' },
      { kind: 'dispatch', dispatchId: 'd-2', hash: 'h2' },
      { kind: 'dispatch', dispatchId: 'd-5', hash: 'h5' } // row 5 (not live)
    ]
    const actions = computeKeyReconcile({
      liveKeys,
      openLedger,
      runningDispatchIds: new Set(['d-2']),
      runningCouncilRunIds: new Set()
    })
    expect(actions).toEqual([
      { kind: 'read-and-revoke', hash: 'h1', dispatchId: 'd-1' },
      { kind: 'revoke-unattributed', hash: 'h3' },
      { kind: 'close-unknown', dispatchId: 'd-5' }
    ])
  })

  it('is inert on empty inputs', () => {
    expect(
      computeKeyReconcile({
        liveKeys: [],
        openLedger: [],
        runningDispatchIds: new Set(),
        runningCouncilRunIds: new Set()
      })
    ).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* D66 — the SAME matrix, one table over                               */
/*                                                                     */
/* Every case above is a pre-D66 case whose ACTION EXPECTATIONS are    */
/* byte-identical to what they were before the widening; only the      */
/* ledger row's `kind` tag and the second running set were added,      */
/* which D66(c)'s required discriminant makes unavoidable. The cases   */
/* below are the new coverage: a council key at each matrix row, and   */
/* the false-positive guard re-asserted for the widened predicate.     */
/* ------------------------------------------------------------------ */

const oursCouncil = (hash: string, id = RUN_ID): LiveKeySummary => ({
  hash,
  name: `${COUNCIL_MINT_NAME_PREFIX}${id}`
})

describe('D66(b) — the ownership predicate is a widened SET, not a loosened test', () => {
  it('holds exactly two prefixes, both of them ours', () => {
    // A closed set: adding a member widens what Chorus is willing to destroy,
    // so the count is asserted rather than left to grow quietly.
    expect(MINT_NAME_PREFIXES).toEqual([MINT_NAME_PREFIX, COUNCIL_MINT_NAME_PREFIX])
    expect(MINT_NAME_PREFIXES).toHaveLength(2)
  })

  it('accepts a council name we minted', () => {
    expect(isChorusMintedName(`${COUNCIL_MINT_NAME_PREFIX}${RUN_ID}`)).toBe(true)
  })

  it('⚠ REJECTS a case variant of the COUNCIL prefix — "Chorus-Council-…" is hand-made', () => {
    expect(isChorusMintedName('Chorus-Council-abc')).toBe(false)
    expect(isChorusMintedName('CHORUS-COUNCIL-abc')).toBe(false)
  })

  it('⚠ REJECTS the council prefix anywhere but index 0 — an includes() check would delete this key', () => {
    expect(isChorusMintedName('backup of chorus-council-')).toBe(false)
    expect(isChorusMintedName(` ${COUNCIL_MINT_NAME_PREFIX}x`)).toBe(false)
  })

  it('⚠ REJECTS a nameless key, still — widening the set did not widen "no name"', () => {
    expect(isChorusMintedName(null)).toBe(false)
    expect(isChorusMintedName(undefined)).toBe(false)
    expect(isChorusMintedName('')).toBe(false)
  })

  it('rejects a plausible near-miss prefix that is in neither member of the set', () => {
    expect(isChorusMintedName('chorus-council')).toBe(false) // no trailing hyphen
    expect(isChorusMintedName('chorus-run-abc')).toBe(false)
    expect(isChorusMintedName('chorus-')).toBe(false)
  })
})

describe('buildMintRequest — the council name, under the SAME guard', () => {
  it('is exactly the council prefix plus the run id, and nothing else', () => {
    const result = buildMintRequest({ owner: COUNCIL_OWNER, limitUsd: 1, now: NOW, ttlMs: 3_600_000 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.body.name).toBe(`${COUNCIL_MINT_NAME_PREFIX}${RUN_ID}`)
    expect(result.body.name.slice(COUNCIL_MINT_NAME_PREFIX.length)).toBe(RUN_ID)
    expect(Object.keys(result.body).sort()).toEqual(['expires_at', 'limit', 'name'])
  })

  it('⚠ never emits the DISPATCH prefix for a council owner — the name is chosen from the tag', () => {
    const result = buildMintRequest({ owner: COUNCIL_OWNER, limitUsd: 1, now: NOW, ttlMs: 3_600_000 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.body.name.startsWith(MINT_NAME_PREFIX)).toBe(false)
  })

  it.each([
    ['a cwd', 'C:\\Projects\\ContactEstablished\\Chorus'],
    ['a label', 'OR milestone key'],
    ['an empty id', ''],
    ['a newline injection', 'abc\ndef']
  ])('REFUSES %s as a RUN id — the shape guard travelled with the prefix', (_l, runId) => {
    expect(buildMintRequest({ owner: { kind: 'council', runId }, limitUsd: 1, now: NOW, ttlMs: 3_600_000 }).ok).toBe(
      false
    )
  })

  it('still refuses an uncapped council key — there is no second path to one', () => {
    expect(buildMintRequest({ owner: COUNCIL_OWNER, limitUsd: 0, now: NOW, ttlMs: 3_600_000 }).ok).toBe(false)
  })
})

describe('computeKeyReconcile — a COUNCIL key at each matrix row', () => {
  it('row 1: ours, live, ledger open, run NOT running -> read-and-revoke-council', () => {
    const actions = computeKeyReconcile({
      liveKeys: [oursCouncil('hc1')],
      openLedger: [{ kind: 'council', runId: RUN_ID, hash: 'hc1' }],
      runningDispatchIds: new Set(),
      runningCouncilRunIds: new Set()
    })
    // ⚠ The COUNCIL arm, carrying `runId`. A `dispatchId` here would be an
    // UPDATE against `dispatches` that matches no row and reports success.
    expect(actions).toEqual([{ kind: 'read-and-revoke-council', hash: 'hc1', runId: RUN_ID }])
  })

  it('row 2: the run is still going -> NO ACTION, so a reordered boot heal cannot revoke a live run', () => {
    const actions = computeKeyReconcile({
      liveKeys: [oursCouncil('hc1')],
      openLedger: [{ kind: 'council', runId: RUN_ID, hash: 'hc1' }],
      runningDispatchIds: new Set(),
      runningCouncilRunIds: new Set([RUN_ID])
    })
    expect(actions).toEqual([])
  })

  it('row 3: ours by council prefix, absent from the ledger -> revoke-unattributed', () => {
    // The pre-D66 behaviour for a council key was row 4 (NO ACTION, forever) if
    // it carried its own prefix. This case is the whole reason the predicate
    // widened.
    const actions = computeKeyReconcile({
      liveKeys: [oursCouncil('hc-lost')],
      openLedger: [],
      runningDispatchIds: new Set(),
      runningCouncilRunIds: new Set()
    })
    expect(actions).toEqual([{ kind: 'revoke-unattributed', hash: 'hc-lost' }])
  })

  it('⚠ row 4: a hand-made key that merely LOOKS council-ish is still untouched', () => {
    const actions = computeKeyReconcile({
      liveKeys: [{ hash: 'h-user', name: 'Chorus-Council-my-experiment' }],
      openLedger: [{ kind: 'council', runId: RUN_ID, hash: 'h-user' }],
      runningDispatchIds: new Set(),
      runningCouncilRunIds: new Set()
    })
    // Row 4 is first and unconditional: not even a ledger row naming its hash
    // may re-open the ownership question. And row 5 cannot fire either — the
    // key IS live, it is simply not ours — so the honest answer is nothing at
    // all. (The dispatch analogue above asserts the same, deliberately.)
    expect(actions).toEqual([])
  })

  it('row 5: ledger row open, council key gone -> close-unknown-council with spend UNKNOWN', () => {
    const actions = computeKeyReconcile({
      liveKeys: [],
      openLedger: [{ kind: 'council', runId: RUN_ID, hash: 'hc-gone' }],
      runningDispatchIds: new Set(),
      runningCouncilRunIds: new Set()
    })
    expect(actions).toEqual([{ kind: 'close-unknown-council', runId: RUN_ID }])
  })
})

describe('computeKeyReconcile — both tables in one pass (D66(a): ONE mechanism)', () => {
  it('classifies dispatches and council runs together without cross-talk', () => {
    const actions = computeKeyReconcile({
      liveKeys: [
        ours('h1', 'd-1'), // dispatch row 1
        ours('h2', 'd-2'), // dispatch row 2 (running)
        oursCouncil('hc1', 'r-1'), // council row 1
        oursCouncil('hc2', 'r-2'), // council row 2 (running)
        oursCouncil('hc3', 'r-3'), // council row 3 (not in ledger)
        { hash: 'h9', name: 'my personal key' } // row 4
      ],
      openLedger: [
        { kind: 'dispatch', dispatchId: 'd-1', hash: 'h1' },
        { kind: 'dispatch', dispatchId: 'd-2', hash: 'h2' },
        { kind: 'council', runId: 'r-1', hash: 'hc1' },
        { kind: 'council', runId: 'r-2', hash: 'hc2' },
        { kind: 'council', runId: 'r-9', hash: 'hc9' } // council row 5
      ],
      runningDispatchIds: new Set(['d-2']),
      runningCouncilRunIds: new Set(['r-2'])
    })
    expect(actions).toEqual([
      { kind: 'read-and-revoke', hash: 'h1', dispatchId: 'd-1' },
      { kind: 'read-and-revoke-council', hash: 'hc1', runId: 'r-1' },
      { kind: 'revoke-unattributed', hash: 'hc3' },
      { kind: 'close-unknown-council', runId: 'r-9' }
    ])
  })

  it('⚠ a running DISPATCH id does not keep a council run alive, and vice versa', () => {
    // The two id spaces are separate inputs precisely so one cannot answer the
    // other's question. Feeding each set the other's id must change nothing.
    const actions = computeKeyReconcile({
      liveKeys: [oursCouncil('hc1', 'r-1')],
      openLedger: [{ kind: 'council', runId: 'r-1', hash: 'hc1' }],
      runningDispatchIds: new Set(['r-1']),
      runningCouncilRunIds: new Set()
    })
    expect(actions).toEqual([{ kind: 'read-and-revoke-council', hash: 'hc1', runId: 'r-1' }])
  })
})

/* ------------------------------------------------------------------ */
/* "% of spend attributed"                                             */
/* ------------------------------------------------------------------ */

const apiRow = (state: TelemetryRowSummary['attributionState'], costUsd: number | null): TelemetryRowSummary => ({
  attributionState: state,
  authMode: 'api_key',
  costUsd
})
const subRow = (): TelemetryRowSummary => ({
  attributionState: 'cli-logs',
  authMode: 'subscription',
  costUsd: null
})

describe('computeAttributionSummary — no number without its denominator (D55)', () => {
  it('returns NULL percentages on a zero-dispatch window — never 0, never NaN', () => {
    const summary = computeAttributionSummary({ rows: [], gatewayTotalUsd: null })
    expect(summary.dispatchPct).toBeNull()
    expect(summary.spendPct).toBeNull()
    expect(summary.totalDispatches).toBe(0)
    expect(summary.attributedDispatches).toBe(0)
  })

  it('returns a NULL spendPct when the gateway total is unknown, and keeps attributedUsd', () => {
    const summary = computeAttributionSummary({ rows: [apiRow('closed', 0.02)], gatewayTotalUsd: null })
    expect(summary.spendPct).toBeNull()
    expect(summary.unattributedUsd).toBeNull()
    expect(summary.attributedUsd).toBeCloseTo(0.02)
  })

  it('returns a NULL spendPct on a zero gateway total rather than dividing by zero', () => {
    const summary = computeAttributionSummary({ rows: [apiRow('closed', 0)], gatewayTotalUsd: 0 })
    expect(summary.spendPct).toBeNull()
    expect(Number.isNaN(summary.spendPct as number)).toBe(false)
  })

  it('computes both ratios and ships every denominator alongside them', () => {
    const summary = computeAttributionSummary({
      rows: [apiRow('closed', 0.03), apiRow('mint-failed', null), subRow(), subRow()],
      gatewayTotalUsd: 0.05
    })
    expect(summary.attributedUsd).toBeCloseTo(0.03)
    expect(summary.unattributedUsd).toBeCloseTo(0.02)
    expect(summary.spendPct).toBeCloseTo(0.6)
    expect(summary.attributedDispatches).toBe(1)
    expect(summary.totalDispatches).toBe(4)
    expect(summary.dispatchPct).toBeCloseTo(0.25)
    expect(summary.gatewayTotalUsd).toBeCloseTo(0.05)
  })

  it('⚠ counts subscription dispatches but prices NONE of them', () => {
    const summary = computeAttributionSummary({
      rows: [subRow(), subRow(), subRow()],
      gatewayTotalUsd: 1.0
    })
    expect(summary.subscriptionDispatches).toBe(3)
    expect(summary.totalDispatches).toBe(3)
    // They are in the dispatch denominator…
    expect(summary.dispatchPct).toBe(0)
    // …and contribute exactly zero dollars. Imputing a $/token rate for a
    // flat-rate subscription would fabricate the number D42 wants made visible.
    expect(summary.attributedUsd).toBe(0)
    expect(summary.unattributedUsd).toBeCloseTo(1.0)
  })

  it('counts orphan-reconciled rows as attributed — the crash cost the clean close, not the number', () => {
    const summary = computeAttributionSummary({
      rows: [apiRow('orphan-reconciled', 0.01)],
      gatewayTotalUsd: 0.01
    })
    expect(summary.attributedDispatches).toBe(1)
    expect(summary.spendPct).toBeCloseTo(1)
  })

  it.each<[TelemetryRowSummary['attributionState']]>([
    ['mint-failed'],
    ['revoke-failed'],
    ['none'],
    ['cli-logs'],
    ['minted']
  ])('does NOT count a %s row as attributed', (state) => {
    const summary = computeAttributionSummary({ rows: [apiRow(state, 0.05)], gatewayTotalUsd: 0.05 })
    expect(summary.attributedDispatches).toBe(0)
    expect(summary.attributedUsd).toBe(0)
    expect(summary.dispatchPct).toBe(0)
  })

  it('never reports a negative unattributed figure when our sum overruns the window', () => {
    const summary = computeAttributionSummary({ rows: [apiRow('closed', 0.09)], gatewayTotalUsd: 0.05 })
    expect(summary.unattributedUsd).toBe(0)
  })

  it('reports how many rows were MEASURED versus DERIVED, and the counts sum to the rows', () => {
    const summary = computeAttributionSummary({
      rows: [
        { ...apiRow('closed', 0.01), tokensSource: 'analytics' },
        { ...apiRow('closed', 0.01), tokensSource: 'analytics-derived' },
        { ...apiRow('closed', 0.01), tokensSource: 'analytics-derived' },
        { ...subRow(), tokensSource: 'cli-logs' },
        // Task 5-4: a voice refinement, metered from the provider's usage frame.
        { ...apiRow('none', 0.0002), tokensSource: 'api-usage' },
        // ⚠ A value this reader has NEVER heard of: counted as unknown, not
        // thrown on — F25's projection rule, which D164 restates for 'voice'.
        { ...apiRow('closed', 0.01), tokensSource: 'from-the-future' as unknown as 'analytics' },
        apiRow('mint-failed', null) // no source at all
      ],
      gatewayTotalUsd: 0.05
    })
    expect(summary.tokensSourceBreakdown).toEqual({
      analytics: 1,
      analyticsDerived: 2,
      cliLogs: 1,
      apiUsage: 1,
      unknown: 2
    })
    const b = summary.tokensSourceBreakdown
    expect(b.analytics + b.analyticsDerived + b.cliLogs + b.apiUsage + b.unknown).toBe(summary.totalDispatches)
  })

  it('treats a non-finite gateway total as unknown', () => {
    const summary = computeAttributionSummary({ rows: [apiRow('closed', 0.01)], gatewayTotalUsd: Number.NaN })
    expect(summary.gatewayTotalUsd).toBeNull()
    expect(summary.spendPct).toBeNull()
  })

  it('ignores a non-finite cost rather than poisoning the sum with NaN', () => {
    const summary = computeAttributionSummary({
      rows: [apiRow('closed', Number.NaN), apiRow('closed', 0.02)],
      gatewayTotalUsd: 0.04
    })
    expect(summary.attributedUsd).toBeCloseTo(0.02)
    expect(summary.attributedDispatches).toBe(1)
  })
})

describe('the attribution-state vocabulary', () => {
  it('is exactly the seven states the schema admits', () => {
    expect([...ATTRIBUTION_STATES].sort()).toEqual([
      'cli-logs',
      'closed',
      'mint-failed',
      'minted',
      'none',
      'orphan-reconciled',
      'revoke-failed'
    ])
  })
})
