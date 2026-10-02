import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_ROUTING_SETTINGS,
  RANKED_TIERS,
  type AccountEligibility,
  type CandidateExplanation,
  type ModelRegistryEntry,
  type RankedTier,
  type RankInput,
  type RawEndpoint,
  type RoutingProfileId,
  type RoutingSettings,
  type TierResult
} from '../../shared/routing'
import { extractObservations, parseEndpointsResponse } from './endpointsCore'
import { bundledModelRegistry, findModel } from './registryCore'
import { computeTiers } from './routingCore'

/** Model Routing Task 1-3, Table Z and the golden run (ImplementationSpec-1-3). */

/** Relative tolerance 1e-4, as the specification prescribes. */
function close(actual: number | null | undefined, expected: number, label = ''): void {
  expect(typeof actual, label).toBe('number')
  expect(Math.abs((actual as number) / expected - 1) < 1e-4, `${label}: ${actual} vs ${expected}`).toBe(true)
}

const SLUG = 'deepseek/deepseek-v4.1-flash'
const NOW = '2026-10-02T09:20:00Z'
const FETCHED_AT = '2026-10-02T09:05:00Z'
const CHECKED_AT = '2026-10-02T09:15:39Z'

const found = findModel(bundledModelRegistry(), SLUG)
if (!found) throw new Error(`bundled registry has no ${SLUG}`)
const MODEL: ModelRegistryEntry = found

const RESULT_KEYS = [
  'model',
  'profile',
  'computedAt',
  'snapshotFetchedAt',
  'snapshotAgeMinutes',
  'stale',
  'accountEligibility',
  'medianEligibleTps',
  'budgetFloorTps',
  'tiers',
  'nitro',
  'candidates',
  'warnings'
]
const SELECTION_KEYS = ['tier', 'model', 'provider', 'endpoints', 'limitedHistory', 'limitedFallbacks', 'rationale']
const PROVIDER_KEYS = ['order', 'allow_fallbacks', 'require_parameters', 'quantizations', 'data_collection']
const FORBIDDEN = ['sort', 'ignore', 'only', 'max_price']

const LIMITED_14 = 'Limited history: 14 of 14 eligible endpoints have fewer than 3 speed observations.'
const W2 = 'Account guardrails were not checked; a pinned endpoint may be refused.'
const W3 = 'Data-policy removals were not checked.'
const W7 = 'Nitro: no endpoint in the snapshot passes the capability filters.'

// ── The golden input, built exactly as the specification shows ──

const fixture = JSON.parse(readFileSync(join(__dirname, '__fixtures__/endpoints-deepseek-v4.1-flash-2026-10-02.json'), 'utf8')) as {
  fetchedAt: string
  guardrailRemoved: string[]
  dataPolicyDenyRemoved: string[]
  cacheVerified: Record<string, boolean>
  data: unknown
}
const { endpoints } = parseEndpointsResponse(fixture)
const snapshot = { fetchedAt: fixture.fetchedAt, endpoints }

function input(profile: RoutingProfileId, settings: RoutingSettings = DEFAULT_ROUTING_SETTINGS): RankInput {
  return {
    model: MODEL,
    snapshot,
    history: extractObservations(snapshot),
    account: { guardrailRemoved: fixture.guardrailRemoved, dataPolicyRemoved: fixture.dataPolicyDenyRemoved, checkedAt: CHECKED_AT },
    cache: Object.fromEntries(Object.entries(fixture.cacheVerified).map(([tag, verified]) => [tag, { verified, checkedAt: CHECKED_AT }])),
    profile,
    effort: 'low',
    settings,
    now: NOW
  }
}

// ── Golden expectations (ImplementationSpec-1-3; never edited to fit the code) ──

const GOLDEN_TIERS: Record<RoutingProfileId, Record<RankedTier, string[]>> = {
  interactive: {
    budget: ['deepinfra/fp8', 'streamlake/fp8', 'gmicloud/fp8'],
    balanced: ['deepinfra/fp8', 'streamlake/fp8', 'makora/fp8'],
    fast: ['venice/fp8', 'baidu/fp8', 'parasail/fp8']
  },
  helper: {
    budget: ['streamlake/fp8', 'deepinfra/fp8', 'gmicloud/fp8'],
    balanced: ['streamlake/fp8', 'venice/fp8', 'gmicloud/fp8'],
    fast: ['venice/fp8', 'baidu/fp8', 'parasail/fp8']
  }
}

const GOLDEN_NITRO = {
  model: 'deepseek/deepseek-v4.1-flash:nitro',
  provider: { data_collection: 'deny' },
  likely: { tag: 'together', providerName: 'Together', tpsP50: 223 },
  likelyFailsRules: ['quantization not declared']
}

const ELIGIBLE = [
  'atlas-cloud/fp8',
  'baidu/fp8',
  'baseten/fast',
  'baseten/fp8',
  'deepinfra/fp8',
  'gmicloud/fp8',
  'makora/fp8',
  'morph/fp8',
  'nextbit/fp8',
  'novita/fp8',
  'parasail/fp8',
  'siliconflow/fp8',
  'streamlake/fp8',
  'venice/fp8'
]

const UNDECLARED = ['quantization not declared']
const EXCLUSIONS: Record<string, string[]> = {
  alibaba: ['uptime 97.18% < 99.5%', 'currently degraded (5m uptime 92.3%)', 'status -2', 'quantization not declared'],
  'coreweave/fp8': ['uptime 98.34% < 99.5%'],
  'decart/fp4': ['fp4 below native fp8'],
  deepseek: ['uptime 99.34% < 99.5%', 'removed by account guardrail', 'removed by data policy'],
  dekallm: ['uptime 99.18% < 99.5%', 'quantization not declared'],
  digitalocean: UNDECLARED,
  fireworks: UNDECLARED,
  'fireworks/us': UNDECLARED,
  ionstream: UNDECLARED,
  modal: UNDECLARED,
  phala: UNDECLARED,
  together: UNDECLARED,
  'inference-net': ['uptime 99.49% < 99.5%', 'quantization not declared'],
  'io-net/fp8': ['uptime 98.22% < 99.5%'],
  'open-inference/fp4': ['uptime 99.28% < 99.5%', 'fp4 below native fp8'],
  relace: ['uptime 99.30% < 99.5%', 'quantization not declared'],
  'sail-research/fp4': ['fp4 below native fp8'],
  wafer: ['uptime 99.41% < 99.5%', 'quantization not declared']
}

// ── Helpers ──

function candidate(result: TierResult, tag: string): CandidateExplanation {
  const c = result.candidates.find((x) => x.tag === tag)
  if (!c) throw new Error(`no candidate ${tag}`)
  return c
}

function tierOrders(result: TierResult): Record<RankedTier, string[] | null> {
  return {
    budget: result.tiers.budget?.endpoints ?? null,
    balanced: result.tiers.balanced?.endpoints ?? null,
    fast: result.tiers.fast?.endpoints ?? null
  }
}

/** Every key at any depth of a JSON value. */
function keysDeep(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysDeep)
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([k, v]) => [k, ...keysDeep(v)])
  }
  return []
}

/** The provider objects of every tier, Nitro included, that exist. */
function providers(result: TierResult): object[] {
  const out: object[] = []
  for (const tier of RANKED_TIERS) {
    const selection = result.tiers[tier]
    if (selection) out.push(selection.provider)
  }
  if (result.nitro.provider) out.push(result.nitro.provider)
  return out
}

/** Deterministic Fisher-Yates with a small LCG, so a failing shuffle reproduces. */
function shuffled<T>(items: T[], seed: number): T[] {
  const out = [...items]
  let s = seed >>> 0
  for (let i = out.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    const j = s % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** The fixture with every eligible tag except `keep` removed (excluded rows stay). */
function reducedInput(keep: string[], profile: RoutingProfileId = 'interactive'): RankInput {
  const kept = endpoints.filter((r) => !ELIGIBLE.includes(r.tag) || keep.includes(r.tag))
  const reduced = { fetchedAt: fixture.fetchedAt, endpoints: kept }
  return { ...input(profile), snapshot: reduced, history: extractObservations(reduced) }
}

/** A valid fp8 row: 100 tps, 500 ms, $0.1/M prompt, $0.4/M completion, $0.01/M cache read. */
function row(tag: string, over: Partial<RawEndpoint> = {}): RawEndpoint {
  return {
    tag,
    provider_name: 'Provider',
    quantization: 'fp8',
    context_length: 1_048_576,
    max_completion_tokens: 131_072,
    pricing: { prompt: '0.0000001', completion: '0.0000004', input_cache_read: '0.00000001' },
    supported_parameters: ['tools', 'tool_choice', 'max_tokens', 'reasoning'],
    status: 0,
    uptime_last_1d: 99.9,
    uptime_last_5m: 99.9,
    throughput_last_30m: { p50: 100, p90: 150 },
    latency_last_30m: { p50: 500, p90: 900 },
    ...over
  }
}

const CLEAN_ACCOUNT: AccountEligibility = { guardrailRemoved: [], dataPolicyRemoved: [], checkedAt: CHECKED_AT }

/** A synthetic input over `rows`: the snapshot is 15 minutes old, every tag cache-verified. */
function synthetic(rows: RawEndpoint[], over: Partial<RankInput> = {}): RankInput {
  const snap = { fetchedAt: FETCHED_AT, endpoints: rows }
  return {
    model: MODEL,
    snapshot: snap,
    history: extractObservations(snap),
    account: CLEAN_ACCOUNT,
    cache: Object.fromEntries(rows.map((r) => [r.tag, { verified: true, checkedAt: CHECKED_AT }])),
    profile: 'interactive',
    effort: 'low',
    settings: DEFAULT_ROUTING_SETTINGS,
    now: NOW,
    ...over
  }
}

const golden: Record<RoutingProfileId, TierResult> = {
  interactive: computeTiers(input('interactive')),
  helper: computeTiers(input('helper'))
}

// ── Z1 — the golden run ──

describe.each(['interactive', 'helper'] as const)('Z1 — golden (%s)', (profile) => {
  const result = golden[profile]

  it('header fields, in TierResult contract order', () => {
    expect(Object.keys(result)).toEqual(RESULT_KEYS)
    expect(result.model).toBe(SLUG)
    expect(result.profile).toBe(profile)
    expect(result.computedAt).toBe(NOW)
    expect(result.snapshotFetchedAt).toBe(FETCHED_AT)
    expect(result.snapshotAgeMinutes).toBe(15)
    expect(result.stale).toBe(false)
    expect(result.accountEligibility).toBe('checked')
    close(result.medianEligibleTps, 90.5, 'median')
    close(result.budgetFloorTps, 45.25, 'floor')
  })

  it('32 candidates: 14 eligible, 18 excluded by the Table F reasons', () => {
    expect(result.candidates).toHaveLength(32)
    expect(result.candidates.filter((c) => c.excludedBy.length === 0).map((c) => c.tag)).toEqual(ELIGIBLE)
    const excluded = Object.fromEntries(result.candidates.filter((c) => c.excludedBy.length > 0).map((c) => [c.tag, c.excludedBy]))
    expect(Object.keys(excluded)).toHaveLength(18)
    expect(excluded).toEqual(EXCLUSIONS)
  })

  it('tier orders and payloads', () => {
    expect(Object.keys(result.tiers)).toEqual(['budget', 'balanced', 'fast'])
    expect(tierOrders(result)).toEqual(GOLDEN_TIERS[profile])
    for (const tier of RANKED_TIERS) {
      const selection = result.tiers[tier]
      if (!selection) throw new Error(`${tier} is null`)
      expect(Object.keys(selection), tier).toEqual(SELECTION_KEYS)
      expect(selection.tier).toBe(tier)
      expect(selection.model).toBe(SLUG)
      expect(Object.keys(selection.provider), tier).toEqual(PROVIDER_KEYS)
      expect(selection.provider, tier).toStrictEqual({
        order: GOLDEN_TIERS[profile][tier],
        allow_fallbacks: false,
        require_parameters: true,
        quantizations: ['fp8'],
        data_collection: 'deny'
      })
      expect(selection.limitedHistory, tier).toBe(true)
      expect(selection.limitedFallbacks, tier).toBe(false)
    }
  })

  it('Nitro and warnings', () => {
    expect(result.nitro).toStrictEqual(GOLDEN_NITRO)
    expect(result.warnings).toEqual([LIMITED_14])
  })
})

describe('Z1 — golden objects, rationale and spot values', () => {
  const interactive = golden.interactive
  const helper = golden.helper
  const ic = (tag: string): CandidateExplanation => candidate(interactive, tag)
  const hc = (tag: string): CandidateExplanation => candidate(helper, tag)

  it('interactive Budget, in full', () => {
    expect(interactive.tiers.budget).toStrictEqual({
      tier: 'budget',
      model: 'deepseek/deepseek-v4.1-flash',
      provider: {
        order: ['deepinfra/fp8', 'streamlake/fp8', 'gmicloud/fp8'],
        allow_fallbacks: false,
        require_parameters: true,
        quantizations: ['fp8'],
        data_collection: 'deny'
      },
      endpoints: ['deepinfra/fp8', 'streamlake/fp8', 'gmicloud/fp8'],
      limitedHistory: true,
      limitedFallbacks: false,
      rationale: 'deepinfra/fp8 first: 48.5 effective tok/s, $0.0165/M blended; then streamlake/fp8, gmicloud/fp8 (limited history)'
    })
  })

  it('interactive Fast rationale', () => {
    expect(interactive.tiers.fast?.rationale).toBe(
      'venice/fp8 first: 119.9 effective tok/s, $0.0449/M blended; then baidu/fp8, parasail/fp8 (limited history)'
    )
  })

  it('interactive spot values', () => {
    close(ic('deepinfra/fp8').scores.budget, 4.0367, 'budget deepinfra')
    close(ic('streamlake/fp8').scores.budget, 4.03282, 'budget streamlake')
    close(ic('streamlake/fp8').scores.balanced, 3.99985, 'balanced streamlake')
    close(ic('deepinfra/fp8').scores.balanced, 3.99215, 'balanced deepinfra')
    close(ic('venice/fp8').scores.fast, 4.78673, 'fast venice')
    close(ic('venice/fp8').effectiveTps, 119.909, 'tps venice')
    close(ic('deepinfra/fp8').effectiveTps, 48.4621, 'tps deepinfra')
    close(ic('baidu/fp8').effectiveTps, 89.7453, 'tps baidu')
    close(ic('deepinfra/fp8').cost?.blended, 0.0165144, 'cost deepinfra')
    close(ic('streamlake/fp8').cost?.blended, 0.0168692, 'cost streamlake')
    close(ic('gmicloud/fp8').cost?.blended, 0.0215352, 'cost gmicloud')
    close(ic('baidu/fp8').cost?.blended, 0.30959, 'cost baidu')
    expect(ic('baidu/fp8').cost?.cacheCredit).toBe(false)
    close(ic('venice/fp8').cost?.blended, 0.044865, 'cost venice')
  })

  it('helper spot values', () => {
    close(hc('streamlake/fp8').scores.budget, 4.36728, 'budget streamlake')
    close(hc('deepinfra/fp8').scores.budget, 4.31882, 'budget deepinfra')
    close(hc('venice/fp8').scores.balanced, 4.23081, 'balanced venice')
    close(hc('gmicloud/fp8').scores.balanced, 4.22583, 'balanced gmicloud')
  })
})

// ── Z3, Z4 — payload keys and the 'allow' variant ──

const ALLOW: RoutingSettings = { ...DEFAULT_ROUTING_SETTINGS, dataCollection: 'allow' }
const allowed: Record<RoutingProfileId, TierResult> = {
  interactive: computeTiers(input('interactive', ALLOW)),
  helper: computeTiers(input('helper', ALLOW))
}

describe('Z3 — no live sort or preference in any provider object (MR-D5)', () => {
  it.each(['interactive', 'helper'] as const)('%s, deny and allow', (profile) => {
    for (const result of [golden[profile], allowed[profile]]) {
      const all = providers(result)
      expect(all.length).toBeGreaterThan(0)
      for (const key of all.flatMap(keysDeep)) {
        expect(key === 'sort' || key.startsWith('preferred_') || FORBIDDEN.includes(key), key).toBe(false)
      }
    }
  })

  it("every tier, Nitro included, sends data_collection 'deny' by default (MR-D11)", () => {
    for (const result of [golden.interactive, golden.helper]) {
      const all = providers(result)
      expect(all).toHaveLength(4)
      for (const p of all) expect((p as { data_collection?: string }).data_collection).toBe('deny')
    }
  })
})

describe.each(['interactive', 'helper'] as const)("Z4 — dataCollection 'allow' (%s)", (profile) => {
  const result = allowed[profile]

  it('same tier orders; no data_collection key anywhere; Nitro provider null; no W3', () => {
    expect(tierOrders(result)).toEqual(GOLDEN_TIERS[profile])
    expect(keysDeep(result)).not.toContain('data_collection')
    for (const tier of RANKED_TIERS) {
      const provider = result.tiers[tier]?.provider
      expect(provider && Object.keys(provider), tier).toEqual(PROVIDER_KEYS.slice(0, 4))
    }
    expect(result.nitro.provider).toBeNull()
    expect(result.nitro.model).toBe(GOLDEN_NITRO.model)
    expect(result.warnings).toEqual([LIMITED_14])
  })

  it('W3 needs deny: an unchecked data policy under allow is not a warning', () => {
    const base = input(profile, ALLOW)
    const unchecked = computeTiers({ ...base, account: { ...base.account, dataPolicyRemoved: null } })
    expect(unchecked.warnings).toEqual([LIMITED_14])
    const denied = computeTiers({ ...input(profile), account: { ...base.account, dataPolicyRemoved: null } })
    expect(denied.accountEligibility).toBe('checked')
    expect(denied.warnings).toEqual([W3, LIMITED_14])
  })
})

// ── Z5 — staleness (K7) ──

const at = (now: string): TierResult => computeTiers({ ...input('interactive'), now })
const stale61 = at('2026-10-02T10:06:00Z')
const fresh60 = at('2026-10-02T10:05:00Z')

describe('Z5 — staleness', () => {
  it('61 minutes is stale, with W1 first', () => {
    expect(stale61.snapshotAgeMinutes).toBe(61)
    expect(stale61.stale).toBe(true)
    expect(stale61.computedAt).toBe('2026-10-02T10:06:00Z')
    expect(stale61.warnings).toEqual(['Snapshot is 61 minutes old (limit 60); refresh before launching.', LIMITED_14])
    // The ranker still computes when stale (launch enforcement is Phase 4).
    expect(tierOrders(stale61)).toEqual(GOLDEN_TIERS.interactive)
  })

  it('60 minutes is not stale; one millisecond more is', () => {
    expect(fresh60.snapshotAgeMinutes).toBe(60)
    expect(fresh60.stale).toBe(false)
    expect(fresh60.warnings).toEqual([LIMITED_14])
    const justOver = at('2026-10-02T10:05:00.001Z')
    expect(justOver.stale).toBe(true)
    expect(justOver.snapshotAgeMinutes).toBe(60)
    expect(justOver.warnings[0]).toBe('Snapshot is 60 minutes old (limit 60); refresh before launching.')
  })

  it('a snapshot fetched at now is zero minutes old', () => {
    const same = computeTiers({ ...input('interactive'), now: '2026-10-02T09:05:00.000Z' })
    expect(same.snapshotAgeMinutes).toBe(0)
    expect(Object.is(same.snapshotAgeMinutes, 0)).toBe(true)
    expect(same.stale).toBe(false)
  })
})

// ── Z6 — unknown account eligibility (K3) ──

const UNKNOWN_ACCOUNT: AccountEligibility = { guardrailRemoved: null, dataPolicyRemoved: null, checkedAt: null }
const unknownAccount: Record<RoutingProfileId, TierResult> = {
  interactive: computeTiers({ ...input('interactive'), account: UNKNOWN_ACCOUNT }),
  helper: computeTiers({ ...input('helper'), account: UNKNOWN_ACCOUNT })
}

describe.each(['interactive', 'helper'] as const)('Z6 — unparsed preflights (%s)', (profile) => {
  const result = unknownAccount[profile]

  it("'unknown', W2 and W3; deepseek still excluded by uptime alone; tiers still computed", () => {
    expect(result.accountEligibility).toBe('unknown')
    expect(result.warnings).toEqual([W2, W3, LIMITED_14])
    expect(candidate(result, 'deepseek').excludedBy).toEqual(['uptime 99.34% < 99.5%'])
    expect(tierOrders(result)).toEqual(GOLDEN_TIERS[profile])
  })
})

// ── Z7 — nothing eligible ──

const NONE_SETTINGS: RoutingSettings = { ...DEFAULT_ROUTING_SETTINGS, minUptimePct: 100, readmitUptimePct: 100 }
const none = computeTiers(input('interactive', NONE_SETTINGS))

describe('Z7 — minUptimePct 100', () => {
  it('all three tiers null with W4 each; Nitro likely still together', () => {
    expect(none.tiers).toStrictEqual({ budget: null, balanced: null, fast: null })
    expect(none.warnings).toEqual(['Budget: no eligible endpoints.', 'Balanced: no eligible endpoints.', 'Fast: no eligible endpoints.'])
    expect(none.medianEligibleTps).toBeNull()
    expect(none.budgetFloorTps).toBeNull()
    expect(none.nitro.likely).toEqual({ tag: 'together', providerName: 'Together', tpsP50: 223 })
    expect(none.nitro.likelyFailsRules).toEqual(['uptime 99.96% < 100%', 'quantization not declared'])
    expect(none.nitro.provider).toEqual({ data_collection: 'deny' })
  })
})

// ── Z8 — limited fallbacks ──

const two = computeTiers(reducedInput(['deepinfra/fp8', 'streamlake/fp8']))
const one = computeTiers(reducedInput(['venice/fp8']))

describe('Z8 — fewer eligible endpoints than 1 + fallbackCount', () => {
  it('two eligible tags: limitedFallbacks true and W5 per tier', () => {
    expect(two.candidates.filter((c) => c.excludedBy.length === 0).map((c) => c.tag)).toEqual(['deepinfra/fp8', 'streamlake/fp8'])
    for (const tier of RANKED_TIERS) {
      const selection = two.tiers[tier]
      if (!selection) throw new Error(`${tier} is null`)
      expect([...selection.endpoints].sort(), tier).toEqual(['deepinfra/fp8', 'streamlake/fp8'])
      expect(selection.provider.order, tier).toEqual(selection.endpoints)
      expect(selection.limitedFallbacks, tier).toBe(true)
    }
    expect(two.warnings).toEqual([
      'Budget: only 2 eligible endpoints; limited fallbacks.',
      'Balanced: only 2 eligible endpoints; limited fallbacks.',
      'Fast: only 2 eligible endpoints; limited fallbacks.',
      'Limited history: 2 of 2 eligible endpoints have fewer than 3 speed observations.'
    ])
  })

  it('one eligible tag: the singular W5 and a rationale with no fallbacks', () => {
    expect(tierOrders(one)).toEqual({ budget: ['venice/fp8'], balanced: ['venice/fp8'], fast: ['venice/fp8'] })
    expect(one.tiers.fast?.limitedFallbacks).toBe(true)
    expect(one.tiers.fast?.rationale).toBe('venice/fp8 first: 119.9 effective tok/s, $0.0449/M blended; no fallbacks (limited history)')
    expect(one.warnings).toEqual([
      'Budget: only 1 eligible endpoint; limited fallbacks.',
      'Balanced: only 1 eligible endpoint; limited fallbacks.',
      'Fast: only 1 eligible endpoint; limited fallbacks.',
      'Limited history: 1 of 1 eligible endpoints have fewer than 3 speed observations.'
    ])
  })

  it('fallbackCount 0: a single endpoint is not a limited fallback', () => {
    const result = computeTiers({ ...reducedInput(['venice/fp8']), settings: { ...DEFAULT_ROUTING_SETTINGS, fallbackCount: 0 } })
    expect(result.tiers.fast?.limitedFallbacks).toBe(false)
    expect(result.warnings).toEqual(['Limited history: 1 of 1 eligible endpoints have fewer than 3 speed observations.'])
  })
})

// ── Z9 — time validation (C9) ──

describe('Z9 — invalid times throw RangeError', () => {
  const base = input('interactive')
  const withFetchedAt = (fetchedAt: string): RankInput => ({ ...base, snapshot: { ...base.snapshot, fetchedAt } })

  it('fetchedAt one minute after now', () => {
    expect(() => computeTiers(withFetchedAt('2026-10-02T09:21:00Z'))).toThrow(RangeError)
    expect(() => computeTiers(withFetchedAt('2026-10-02T09:21:00Z'))).toThrow('snapshot.fetchedAt is after now')
  })

  it("now: 'not a date'", () => {
    expect(() => computeTiers({ ...base, now: 'not a date' })).toThrow(RangeError)
    expect(() => computeTiers({ ...base, now: 'not a date' })).toThrow('Invalid time in RankInput')
  })

  it('an ISO string without an offset (read as local time by Date.parse) is rejected', () => {
    expect(() => computeTiers({ ...base, now: '2026-10-02T09:20:00' })).toThrow(new RangeError('Invalid time in RankInput'))
    expect(() => computeTiers(withFetchedAt('2026-10-02T09:05:00'))).toThrow(new RangeError('Invalid time in RankInput'))
  })

  it('hour 24, which Date.parse reads as the next midnight, is rejected by the Zod check', () => {
    expect(Number.isNaN(Date.parse('2026-10-02T24:00:00Z'))).toBe(false)
    expect(() => computeTiers({ ...base, now: '2026-10-02T24:00:00Z' })).toThrow(RangeError)
    expect(() => computeTiers({ ...base, now: '2026-10-02T24:00:00Z' })).toThrow(new RangeError('Invalid time in RankInput'))
  })

  it("only UTC instants ending in Z pass, as the shared schemas' z.iso.datetime() accepts them", () => {
    expect(() => computeTiers({ ...base, now: '2026-10-02T09:20:00+00:00' })).toThrow(RangeError)
    expect(() => computeTiers(withFetchedAt('2026-10-02'))).toThrow(RangeError)
    expect(() => computeTiers(withFetchedAt(''))).toThrow(RangeError)
    expect(computeTiers({ ...base, now: '2026-10-02T09:20:00.000Z' }).snapshotAgeMinutes).toBe(15)
  })
})

// ── Z10 — determinism (MR-G8) ──

describe.each(['interactive', 'helper'] as const)('Z10 — order independence (%s)', (profile) => {
  it('reversed endpoints and shuffled history give a strictly equal result', () => {
    const base = input(profile)
    for (const seed of [1, 7, 42]) {
      const result = computeTiers({
        ...base,
        snapshot: { ...base.snapshot, endpoints: [...base.snapshot.endpoints].reverse() },
        history: shuffled(base.history, seed)
      })
      expect(result).toStrictEqual(golden[profile])
    }
  })
})

// ── Z11 — an admitted first-party unknown in a payload (C8) ──

const firstParty = computeTiers(
  synthetic([
    row('a/fp8', { throughput_last_30m: { p50: 200, p90: 250 } }),
    row('b/fp8', { throughput_last_30m: { p50: 200, p90: 250 } }),
    row('c/fp8', { throughput_last_30m: { p50: 200, p90: 250 } }),
    row('deepseek', {
      provider_name: 'DeepSeek',
      quantization: null,
      throughput_last_30m: { p50: 150, p90: 200 },
      pricing: { prompt: '0.00000001', completion: '0.00000004', input_cache_read: '0.000000001' }
    })
  ])
)

describe('Z11 — first-party unknown at the top of Budget', () => {
  it("the tier's quantizations include 'unknown' (declared), not only its effective fp8", () => {
    const deepseek = candidate(firstParty, 'deepseek')
    expect(deepseek.excludedBy).toEqual([])
    expect(deepseek.rowQuantizations).toEqual(['unknown'])
    expect(deepseek.effectiveQuantization).toBe('fp8')
    expect(firstParty.tiers.budget?.endpoints[0]).toBe('deepseek')
    expect(firstParty.tiers.budget?.provider.quantizations).toEqual(['fp8', 'unknown'])
    // A tier that does not select it filters on fp8 only.
    expect(firstParty.tiers.fast?.endpoints).toEqual(['a/fp8', 'b/fp8', 'c/fp8'])
    expect(firstParty.tiers.fast?.provider.quantizations).toEqual(['fp8'])
  })
})

// ── Rationale and warning templates beyond the fixture ──

describe('templates', () => {
  it('a tier with stable history has no limited-history suffix and no W6', () => {
    const rows = [100, 150, 200].map((p50, i) => row(['a/fp8', 'b/fp8', 'c/fp8'][i], { throughput_last_30m: { p50, p90: p50 } }))
    // Three observations per tag: the snapshot plus two earlier ones.
    const history = ['2026-10-02T09:05:00Z', '2026-10-02T08:35:00Z', '2026-10-02T08:05:00Z'].flatMap((fetchedAt) =>
      extractObservations({ fetchedAt, endpoints: rows })
    )
    const result = computeTiers(synthetic(rows, { history }))
    expect(result.candidates.every((c) => !c.limitedHistory && c.observations === 3)).toBe(true)
    // c: 300 / (0.5 + 300 / 200) = 150 tok/s; 0.057 × 0.1 + 0.932 × 0.01 + 0.011 × 0.4 = $0.01942/M.
    expect(result.tiers.fast?.rationale).toBe('c/fp8 first: 150.0 effective tok/s, $0.0194/M blended; then b/fp8, a/fp8')
    expect(result.tiers.fast?.limitedHistory).toBe(false)
    expect(result.warnings).toEqual([])
  })

  it('W1, W2, W3, W4 per tier and W7, in that order', () => {
    const rows = [row('a/fp8', { supported_parameters: ['tool_choice', 'max_tokens', 'reasoning'] })]
    const result = computeTiers(synthetic(rows, { account: UNKNOWN_ACCOUNT, now: '2026-10-02T11:05:00Z' }))
    expect(result.nitro.likely).toBeNull()
    expect(result.nitro.likelyFailsRules).toEqual([])
    expect(result.warnings).toEqual([
      'Snapshot is 120 minutes old (limit 60); refresh before launching.',
      W2,
      W3,
      'Budget: no eligible endpoints.',
      'Balanced: no eligible endpoints.',
      'Fast: no eligible endpoints.',
      W7
    ])
  })

  it('W1, W2, W3, W5 per tier and W6, in that order', () => {
    const result = computeTiers(synthetic([row('a/fp8')], { account: UNKNOWN_ACCOUNT, now: '2026-10-02T11:05:00Z' }))
    expect(result.warnings).toEqual([
      'Snapshot is 120 minutes old (limit 60); refresh before launching.',
      W2,
      W3,
      'Budget: only 1 eligible endpoint; limited fallbacks.',
      'Balanced: only 1 eligible endpoint; limited fallbacks.',
      'Fast: only 1 eligible endpoint; limited fallbacks.',
      'Limited history: 1 of 1 eligible endpoints have fewer than 3 speed observations.'
    ])
  })
})

// ── Z2 — plain JSON (K2, MR-G5) ──

describe('Z2 — every result survives a JSON round trip unchanged', () => {
  const results: [string, TierResult][] = [
    ['golden interactive', golden.interactive],
    ['golden helper', golden.helper],
    ['allow interactive', allowed.interactive],
    ['stale 61', stale61],
    ['fresh 60', fresh60],
    ['unknown account interactive', unknownAccount.interactive],
    ['unknown account helper', unknownAccount.helper],
    ['nothing eligible', none],
    ['two eligible', two],
    ['first-party unknown', firstParty]
  ]

  it.each(results)('%s', (_label, result) => {
    expect(JSON.parse(JSON.stringify(result))).toStrictEqual(result)
  })
})
