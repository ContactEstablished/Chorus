import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_ROUTING_SETTINGS,
  RANKED_TIERS,
  type AccountEligibility,
  type CandidateExplanation,
  type ModelRegistryEntry,
  type RankInput,
  type RawEndpoint,
  type RoutingObservation,
  type RoutingProfileId
} from '../../shared/routing'
import { extractObservations, parseEndpointsResponse } from './endpointsCore'
import { budgetFloor, effectiveTps, orderByScore, rankCandidates, tierScore, type OrderEntry } from './rankerCore'
import { bundledModelRegistry, findModel } from './registryCore'

/** Model Routing Task 1-2, Tables K and F (ImplementationSpec-1-2). */

/** Relative tolerance 1e-4, as the specification prescribes. */
function close(actual: number | null | undefined, expected: number, label = ''): void {
  expect(typeof actual, label).toBe('number')
  expect(Math.abs((actual as number) / expected - 1) < 1e-4, `${label}: ${actual} vs ${expected}`).toBe(true)
}

const NOW = '2026-10-02T09:20:00Z'
const NOW_MS = Date.parse(NOW)
const CHECKED_AT = '2026-10-02T09:15:39Z'
const TIE = Math.log(DEFAULT_ROUTING_SETTINGS.tieRatio)

const found = findModel(bundledModelRegistry(), 'deepseek/deepseek-v4.1-flash')
if (!found) throw new Error('bundled registry has no deepseek/deepseek-v4.1-flash')
const MODEL: ModelRegistryEntry = found

/** A valid fp8 row (spec defaults); tests name only the fields they mean. */
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

const ACCOUNT: AccountEligibility = { guardrailRemoved: [], dataPolicyRemoved: [], checkedAt: CHECKED_AT }

/** A synthetic input over `rows`; the snapshot is 15 minutes old and history is its own observations. */
function synthetic(rows: RawEndpoint[], over: Partial<RankInput> = {}): RankInput {
  const snapshot = { fetchedAt: '2026-10-02T09:05:00Z', endpoints: rows }
  return {
    model: MODEL,
    snapshot,
    history: extractObservations(snapshot),
    account: ACCOUNT,
    cache: Object.fromEntries(rows.map((r) => [r.tag, { verified: true, checkedAt: CHECKED_AT }])),
    profile: 'interactive',
    effort: 'low',
    settings: DEFAULT_ROUTING_SETTINGS,
    now: NOW,
    ...over
  }
}

function candidate(result: { candidates: CandidateExplanation[] }, tag: string): CandidateExplanation {
  const c = result.candidates.find((x) => x.tag === tag)
  if (!c) throw new Error(`no candidate ${tag}`)
  return c
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items]
  return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]))
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

describe('Table K — scoring', () => {
  it('K-a: effective throughput (ms already converted to s)', () => {
    close(effectiveTps(300, 1.4285, 63), 48.4621)
  })

  it('K-b: at w 0.3, 10% pricier and 2× faster wins', () => {
    const a = tierScore(0.3, 50, 1.0)
    const b = tierScore(0.3, 100, 1.1)
    close(a, 1.17361, 'A')
    close(b, 1.31483, 'B')
    expect(b).toBeGreaterThan(a)
  })

  it('K-c: at w 0.3, 2× pricier and 2× faster loses', () => {
    const a = tierScore(0.3, 50, 1.0)
    const b = tierScore(0.3, 100, 2.0)
    close(b, 0.89635, 'B')
    expect(a).toBeGreaterThan(b)
  })

  it('tierScore never returns -0', () => {
    expect(Object.is(tierScore(0, 0.5, 1), 0)).toBe(true)
    expect(Object.is(tierScore(1, 1, 0.5), 0)).toBe(true)
  })

  it('budgetFloor: max(budgetMinTps, fraction × median), null when empty (K10)', () => {
    expect(budgetFloor([], DEFAULT_ROUTING_SETTINGS)).toBeNull()
    expect(budgetFloor([17, 80, 90, 100, 110], DEFAULT_ROUTING_SETTINGS)).toBe(45)
    expect(budgetFloor([20, 40], DEFAULT_ROUTING_SETTINGS)).toBe(30)
    expect(budgetFloor([62, 63, 67, 88], DEFAULT_ROUTING_SETTINGS)).toBe(32.5)
    // -0 settings (the schema accepts them) never yield -0.
    const negativeZero = { ...DEFAULT_ROUTING_SETTINGS, budgetMinTps: -0, budgetMedianFraction: -0 }
    expect(Object.is(budgetFloor([10], negativeZero), 0)).toBe(true)
  })

  it('K-d: a cheap 17 tps candidate is Budget-floor excluded but still scored for Balanced and Fast', () => {
    const cheap = row('cheap/fp8', {
      throughput_last_30m: { p50: 17, p90: 30 },
      pricing: { prompt: '0.00000001', completion: '0.00000004', input_cache_read: '0.000000001' }
    })
    const rows = [cheap, ...[80, 90, 100, 110].map((t, i) => row(`p${i}/fp8`, { throughput_last_30m: { p50: t, p90: t } }))]
    const result = rankCandidates(synthetic(rows))
    expect(result.medianEligibleTps).toBe(90)
    expect(result.budgetFloorTps).toBe(45)
    const c = candidate(result, 'cheap/fp8')
    expect(c.excludedBy).toEqual([])
    expect(c.budgetFloorExcluded).toBe(true)
    expect(c.scores.budget).toBeUndefined()
    expect('budget' in c.scores).toBe(false)
    expect(typeof c.scores.balanced).toBe('number')
    expect(typeof c.scores.fast).toBe('number')
    expect(result.selections.budget).not.toContain('cheap/fp8')
    expect(result.selections.budget).toHaveLength(3)
    // Without the floor it would have won Budget: the floor is what removes it.
    const unfloored = tierScore(0.3, c.effectiveTps as number, c.cost?.blended as number)
    for (const other of result.candidates.filter((x) => x.scores.budget !== undefined)) {
      expect(unfloored).toBeGreaterThan(other.scores.budget as number)
    }
    // Only the cheap one is floor-excluded.
    expect(result.candidates.filter((x) => x.budgetFloorExcluded).map((x) => x.tag)).toEqual(['cheap/fp8'])
  })

  it('K-e: a candidate exactly at the floor is not floor-excluded', () => {
    const rows = [45, 90, 100].map((t, i) => row(`p${i}/fp8`, { throughput_last_30m: { p50: t, p90: t } }))
    const result = rankCandidates(synthetic(rows))
    expect(result.budgetFloorTps).toBe(45)
    const atFloor = candidate(result, 'p0/fp8')
    expect(atFloor.tpsP50).toBe(45)
    expect(atFloor.budgetFloorExcluded).toBe(false)
    expect(typeof atFloor.scores.budget).toBe('number')
    expect(result.selections.budget).toContain('p0/fp8')
  })

  const entry = (tag: string, score: number, uptime1d: number, latencyP50S = 1, blended = 0.02): OrderEntry => ({
    tag,
    score,
    uptime1d,
    latencyP50S,
    blended
  })

  it('K-f: the non-transitive triple orders B, A, C under all six permutations', () => {
    const a = entry('A', 1.0, 99.6)
    const b = entry('B', 0.992, 99.7)
    const c = entry('C', 0.984, 99.8)
    // The configuration Plan_1's pairwise comparator cycles on: A~B and B~C tie, A and C do not.
    expect(a.score - b.score).toBeLessThan(TIE)
    expect(b.score - c.score).toBeLessThan(TIE)
    expect(a.score - c.score).toBeGreaterThan(TIE)
    const perms = permutations([a, b, c])
    expect(perms).toHaveLength(6)
    for (const p of perms) expect(orderByScore(p, 1.01).map((e) => e.tag)).toEqual(['B', 'A', 'C'])
  })

  it('K-g: fully tied entries order by tag with a code-unit compare', () => {
    const items = ['b', 'B', 'a', 'A'].map((t) => entry(t, 1, 99.9))
    for (const p of permutations(items)) expect(orderByScore(p, 1.01).map((e) => e.tag)).toEqual(['A', 'B', 'a', 'b'])
  })

  it('K9: inside a cluster, higher uptime, then lower latency, then lower cost', () => {
    const items = [
      entry('cost-hi', 1.0, 99.9, 1.0, 0.03),
      entry('cost-lo', 1.0, 99.9, 1.0, 0.01),
      entry('lat-lo', 0.999, 99.9, 0.5, 0.05),
      entry('up-hi', 0.995, 99.95, 2.0, 0.05),
      entry('next', 0.98, 100, 0.1, 0.001) // outside the cluster: up-hi's better keys cannot lift it
    ]
    const expected = ['up-hi', 'lat-lo', 'cost-lo', 'cost-hi', 'next']
    for (const p of permutations(items)) expect(orderByScore(p, 1.01).map((e) => e.tag)).toEqual(expected)
  })

  it('K9: the cluster bound is inclusive; with tieRatio 1 exactly equal scores still order by uptime, not tag', () => {
    const items = [entry('a', 1, 99.6), entry('b', 1, 99.9)]
    for (const p of permutations(items)) expect(orderByScore(p, 1).map((e) => e.tag)).toEqual(['b', 'a'])
    // A strictly lower score is a cluster of its own.
    expect(orderByScore([entry('a', 1, 99.6), entry('b', 0.999999, 99.9)], 1).map((e) => e.tag)).toEqual(['a', 'b'])
  })

  it('K9: clusters are anchored on the highest remaining score, not chained', () => {
    const step = TIE * 0.6 // each neighbour ties, but the third is out of reach of the first
    const items = [entry('s0', 1, 99.5), entry('s1', 1 - step, 99.7), entry('s2', 1 - 2 * step, 99.9)]
    for (const p of permutations(items)) expect(orderByScore(p, 1.01).map((e) => e.tag)).toEqual(['s1', 's0', 's2'])
    expect(orderByScore([], 1.01)).toEqual([])
    // The input is not mutated.
    const input = [items[2], items[0], items[1]]
    orderByScore(input, 1.01)
    expect(input.map((e) => e.tag)).toEqual(['s2', 's0', 's1'])
  })

  it('K-i: only two eligible candidates give selections of length 2', () => {
    const rows = [row('a/fp8'), row('b/fp8', { throughput_last_30m: { p50: 150, p90: 200 } }), row('c/fp4', { quantization: 'fp4' })]
    const result = rankCandidates(synthetic(rows))
    for (const tier of RANKED_TIERS) expect(result.selections[tier]).toHaveLength(2)
    expect(result.selections.fast).toEqual(['b/fp8', 'a/fp8'])
  })

  it('a candidate without a verified cache entry gets no cache credit', () => {
    const none = rankCandidates(synthetic([row('a/fp8')], { cache: {} }))
    expect(candidate(none, 'a/fp8').cost?.cacheCredit).toBe(false)
    const unverified = rankCandidates(synthetic([row('a/fp8')], { cache: { 'a/fp8': { verified: false, checkedAt: CHECKED_AT } } }))
    expect(candidate(unverified, 'a/fp8').cost?.cacheCredit).toBe(false)
    // A tag that names an Object prototype key is not a cache entry.
    const proto = rankCandidates(synthetic([row('constructor')], { cache: {} }))
    expect(candidate(proto, 'constructor').cost?.cacheCredit).toBe(false)
    const verified = rankCandidates(synthetic([row('a/fp8')]))
    expect(candidate(verified, 'a/fp8').cost?.cacheCredit).toBe(true)
  })

  it('no eligible candidate: empty selections, null median and floor', () => {
    const result = rankCandidates(synthetic([row('a/fp4', { quantization: 'fp4' })]))
    expect(result.selections).toEqual({ budget: [], balanced: [], fast: [] })
    expect(result.medianEligibleTps).toBeNull()
    expect(result.budgetFloorTps).toBeNull()
    expect(result.nitroLikely).toEqual({ tag: 'a/fp4', providerName: 'Provider', tpsP50: 100 })
    expect(result.nitroFailsRules).toEqual(['fp4 below native fp8'])
  })
})

describe('Nitro likely (K12, C3)', () => {
  it('is the fastest candidate passing the account and capability filters; its reliability and precision failures are listed', () => {
    const rows = [
      row('fast-guarded', { throughput_last_30m: { p50: 400, p90: 500 } }),
      row('fast-no-tools', { throughput_last_30m: { p50: 350, p90: 500 }, supported_parameters: ['tool_choice', 'max_tokens', 'reasoning'] }),
      row('policy', { throughput_last_30m: { p50: 300, p90: 500 } }),
      row('flaky', { provider_name: 'Flaky', quantization: null, uptime_last_1d: 99.1, status: -2, throughput_last_30m: { p50: 250, p90: 500 } }),
      row('steady', { throughput_last_30m: { p50: 120, p90: 150 } })
    ]
    const account = { guardrailRemoved: ['fast-guarded'], dataPolicyRemoved: ['policy'], checkedAt: CHECKED_AT }
    const result = rankCandidates(synthetic(rows, { account }))
    expect(result.nitroLikely).toEqual({ tag: 'flaky', providerName: 'Flaky', tpsP50: 250 })
    expect(result.nitroFailsRules).toEqual(['uptime 99.10% < 99.5%', 'status -2', 'quantization not declared'])

    // Under 'allow' the data-policy list does not apply, so 'policy' is in the pool.
    const allow = rankCandidates(synthetic(rows, { account, settings: { ...DEFAULT_ROUTING_SETTINGS, dataCollection: 'allow' } }))
    expect(allow.nitroLikely).toEqual({ tag: 'policy', providerName: 'Provider', tpsP50: 300 })
    expect(allow.nitroFailsRules).toEqual([])
  })

  it('lists neither speed nor price reasons; ties go to the lower tag; null when the pool is empty', () => {
    const tied = [
      row('b', { latency_last_30m: null, pricing: { prompt: '0', completion: '0', input_cache_read: '0' } }),
      row('a', { latency_last_30m: null })
    ]
    const result = rankCandidates(synthetic([...tied].reverse()))
    expect(result.nitroLikely).toEqual({ tag: 'a', providerName: 'Provider', tpsP50: 100 })
    expect(candidate(result, 'a').excludedBy).toEqual(['no speed data'])
    expect(result.nitroFailsRules).toEqual([])

    const empty = rankCandidates(synthetic([row('a', { context_length: 1000 }), row('b', { throughput_last_30m: null })]))
    expect(empty.nitroLikely).toBeNull()
    expect(empty.nitroFailsRules).toEqual([])
  })
})

// ── Table F — the 2026-10-02 fixture ──

const fixture = JSON.parse(readFileSync(join(__dirname, '__fixtures__/endpoints-deepseek-v4.1-flash-2026-10-02.json'), 'utf8')) as {
  fetchedAt: string
  guardrailRemoved: string[]
  dataPolicyDenyRemoved: string[]
  cacheVerified: Record<string, boolean>
  data: unknown
}
const { endpoints } = parseEndpointsResponse(fixture)
const snapshot = { fetchedAt: fixture.fetchedAt, endpoints }

function goldenInput(profile: RoutingProfileId): RankInput {
  return {
    model: MODEL,
    snapshot,
    history: extractObservations(snapshot),
    account: { guardrailRemoved: fixture.guardrailRemoved, dataPolicyRemoved: fixture.dataPolicyDenyRemoved, checkedAt: CHECKED_AT },
    cache: Object.fromEntries(Object.entries(fixture.cacheVerified).map(([tag, verified]) => [tag, { verified, checkedAt: CHECKED_AT }])),
    profile,
    effort: 'low',
    settings: DEFAULT_ROUTING_SETTINGS,
    now: NOW
  }
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

const SELECTIONS: Record<RoutingProfileId, Record<'budget' | 'balanced' | 'fast', string[]>> = {
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

describe.each(['interactive', 'helper'] as const)('Table F — the 2026-10-02 fixture (%s)', (profile) => {
  const result = rankCandidates(goldenInput(profile))

  it('32 candidates, each tag once, sorted by tag (code unit)', () => {
    const tags = result.candidates.map((c) => c.tag)
    expect(tags).toHaveLength(32)
    expect(new Set(tags).size).toBe(32)
    expect(tags).toEqual([...tags].sort())
  })

  it('the 14 eligible candidates', () => {
    expect(result.candidates.filter((c) => c.excludedBy.length === 0).map((c) => c.tag)).toEqual(ELIGIBLE)
  })

  it('the 18-row exclusion table, exactly', () => {
    const excluded = Object.fromEntries(result.candidates.filter((c) => c.excludedBy.length > 0).map((c) => [c.tag, c.excludedBy]))
    expect(Object.keys(excluded)).toHaveLength(18)
    expect(excluded).toEqual(EXCLUSIONS)
  })

  it('median 90.5, Budget floor 45.25; only morph/fp8 (17) and baseten/fast (31) are below it', () => {
    close(result.medianEligibleTps, 90.5)
    close(result.budgetFloorTps, 45.25)
    expect(result.candidates.filter((c) => c.budgetFloorExcluded).map((c) => [c.tag, c.tpsP50])).toEqual([
      ['baseten/fast', 31],
      ['morph/fp8', 17]
    ])
    const morph = candidate(result, 'morph/fp8')
    expect(morph.scores.budget).toBeUndefined()
    expect(typeof morph.scores.balanced).toBe('number')
    expect(typeof morph.scores.fast).toBe('number')
  })

  it('every candidate has limited history from one observation', () => {
    for (const c of result.candidates) {
      expect(c.observations, c.tag).toBe(1)
      expect(c.limitedHistory, c.tag).toBe(true)
    }
  })

  it('Nitro likely is together, failing quantization not declared', () => {
    expect(result.nitroLikely).toEqual({ tag: 'together', providerName: 'Together', tpsP50: 223 })
    expect(result.nitroFailsRules).toEqual(['quantization not declared'])
  })

  it('golden selections', () => {
    expect(result.selections).toEqual(SELECTIONS[profile])
  })

  it('scores exist exactly for the eligible candidates; excluded ones carry {} and no floor flag', () => {
    for (const c of result.candidates) {
      const eligible = c.excludedBy.length === 0
      expect(eligible, c.tag).toBe(c.scores.balanced !== undefined && c.scores.fast !== undefined)
      if (!eligible) {
        expect(c.scores, c.tag).toEqual({})
        expect(c.budgetFloorExcluded, c.tag).toBe(false)
      } else {
        expect(c.scores.budget !== undefined, c.tag).toBe(!c.budgetFloorExcluded)
      }
    }
  })

  it('results are plain JSON: no undefined keys, no -0, every number finite (K2)', () => {
    expect(JSON.parse(JSON.stringify(result))).toStrictEqual(result)
  })

  it('K-h: reversed endpoints and shuffled history give a strictly equal result', () => {
    const base = goldenInput(profile)
    for (const seed of [1, 7, 42]) {
      const input = {
        ...base,
        snapshot: { ...base.snapshot, endpoints: [...base.snapshot.endpoints].reverse() },
        history: shuffled(base.history, seed)
      }
      expect(rankCandidates(input)).toStrictEqual(result)
    }
    const rotated = { ...base, snapshot: { ...base.snapshot, endpoints: shuffled(base.snapshot.endpoints, 99) } }
    expect(rankCandidates(rotated)).toStrictEqual(result)
  })
})

describe('Table F — spot values', () => {
  const interactive = rankCandidates(goldenInput('interactive'))
  const helper = rankCandidates(goldenInput('helper'))
  const ic = (tag: string) => candidate(interactive, tag)
  const hc = (tag: string) => candidate(helper, tag)

  it('interactive Budget: deepinfra and streamlake share a cluster; uptime 99.96 beats 99.60', () => {
    close(ic('deepinfra/fp8').scores.budget, 4.0367, 'deepinfra')
    close(ic('streamlake/fp8').scores.budget, 4.03282, 'streamlake')
    expect((ic('deepinfra/fp8').scores.budget as number) - (ic('streamlake/fp8').scores.budget as number)).toBeLessThan(TIE)
    expect(ic('deepinfra/fp8').uptime1d as number).toBeGreaterThan(ic('streamlake/fp8').uptime1d as number)
  })

  it('interactive Balanced: streamlake scores higher but deepinfra leads on uptime in one cluster', () => {
    close(ic('streamlake/fp8').scores.balanced, 3.99985, 'streamlake')
    close(ic('deepinfra/fp8').scores.balanced, 3.99215, 'deepinfra')
    expect((ic('streamlake/fp8').scores.balanced as number) - (ic('deepinfra/fp8').scores.balanced as number)).toBeLessThan(TIE)
  })

  it('interactive Fast: venice', () => {
    close(ic('venice/fp8').scores.fast, 4.78673, 'venice')
  })

  it('helper Budget and Balanced', () => {
    close(hc('streamlake/fp8').scores.budget, 4.36728, 'streamlake budget')
    close(hc('deepinfra/fp8').scores.budget, 4.31882, 'deepinfra budget')
    close(hc('venice/fp8').scores.balanced, 4.23081, 'venice balanced')
    close(hc('gmicloud/fp8').scores.balanced, 4.22583, 'gmicloud balanced')
    expect((hc('venice/fp8').scores.balanced as number) - (hc('gmicloud/fp8').scores.balanced as number)).toBeLessThan(TIE)
  })

  it('interactive effective throughput', () => {
    close(ic('venice/fp8').effectiveTps, 119.909, 'venice')
    close(ic('deepinfra/fp8').effectiveTps, 48.4621, 'deepinfra')
    close(ic('baidu/fp8').effectiveTps, 89.7453, 'baidu')
    close(ic('deepinfra/fp8').latencyP50S, 1.4285, 'deepinfra latency in seconds')
  })

  it('interactive blended cost', () => {
    close(ic('deepinfra/fp8').cost?.blended, 0.0165144, 'deepinfra')
    close(ic('streamlake/fp8').cost?.blended, 0.0168692, 'streamlake')
    close(ic('gmicloud/fp8').cost?.blended, 0.0215352, 'gmicloud')
    close(ic('baidu/fp8').cost?.blended, 0.30959, 'baidu')
    expect(ic('baidu/fp8').cost?.cacheCredit).toBe(false)
    expect(ic('deepinfra/fp8').cost?.cacheCredit).toBe(true)
    // wafer has no cache entry in the fixture, so it gets no credit.
    expect(Object.hasOwn(fixture.cacheVerified, 'wafer')).toBe(false)
    expect(ic('wafer').cost?.cacheCredit).toBe(false)
    close(ic('venice/fp8').cost?.blended, 0.044865, 'venice')
  })

  it('explanation records follow the contract', () => {
    const baseten = ic('baseten/fp8')
    expect(Object.keys(baseten)).toEqual([
      'tag',
      'providerName',
      'rows',
      'quantization',
      'rowQuantizations',
      'effectiveQuantization',
      'uptime1d',
      'uptime5m',
      'status',
      'observations',
      'limitedHistory',
      'tpsP50',
      'latencyP50S',
      'tpsP90',
      'latencyP90S',
      'effectiveTps',
      'cost',
      'excludedBy',
      'budgetFloorExcluded',
      'scores'
    ])
    // Collapsed current values (K8) and smoothed speeds (K7).
    expect(baseten).toMatchObject({
      providerName: 'BaseTen',
      rows: 2,
      quantization: 'fp8',
      rowQuantizations: ['fp8'],
      effectiveQuantization: 'fp8',
      uptime1d: 99.92966632878922,
      uptime5m: 99.2,
      status: 0,
      tpsP50: 62,
      tpsP90: 293
    })
    close(baseten.latencyP50S, 0.305)
    close(baseten.latencyP90S, 1.4565)
    expect(ic('baseten/fast').effectiveQuantization).toBe('fp32')
    // An excluded candidate still carries its cost and effective throughput.
    expect(ic('together').cost).not.toBeNull()
    expect(ic('together').effectiveTps).not.toBeNull()
    expect(ic('together').effectiveQuantization).toBe('unknown')
  })
})

describe('history drives the window', () => {
  it('a stored low observation keeps a recovering endpoint out until 99.6 (K6)', () => {
    const rows = [row('a/fp8'), row('b/fp8', { uptime_last_1d: 99.55 })]
    const base = synthetic(rows)
    const earlier: RoutingObservation = {
      ...base.history[1],
      observedAt: new Date(NOW_MS - 45 * 60_000).toISOString(),
      uptime1d: 99.4
    }
    const result = rankCandidates({ ...base, history: [...base.history, earlier] })
    expect(candidate(result, 'b/fp8').excludedBy).toEqual(['readmission needs 99.6% (now 99.55%)'])
    expect(candidate(result, 'b/fp8').observations).toBe(2)
    expect(result.selections.fast).toEqual(['a/fp8'])
  })

  it('a stored copy of the snapshot is counted once (M7 through rankCandidates)', () => {
    const base = synthetic([row('a/fp8')])
    const stored = { ...base.history[0], observedAt: '2026-10-02T09:05:00.000Z' }
    const result = rankCandidates({ ...base, history: [stored] })
    expect(candidate(result, 'a/fp8').observations).toBe(1)
    expect(rankCandidates({ ...base, history: [] })).toStrictEqual(rankCandidates(base))
  })
})

describe('K-h over a rich history: shuffles of endpoints and history give a strictly equal result (MR-G8)', () => {
  const TAGS = ['alpha/fp8', 'Beta/fp8', 'delta/fp8', 'eps/fp8', 'gamma/fp8']
  const rows: RawEndpoint[] = [
    ...TAGS.map((tag, i) =>
      row(tag, {
        uptime_last_1d: [99.55, 99.65, 99.58, 99.9, 99.52][i],
        throughput_last_30m: { p50: 60 + 25 * i, p90: 200 },
        latency_last_30m: { p50: 400 + 150 * i, p90: 2000 },
        pricing: { prompt: `0.000000${i + 1}`, completion: '0.0000004', input_cache_read: '0.00000001' }
      })
    ),
    // A second row sharing a tag, so collapse runs under shuffled endpoints too.
    row('gamma/fp8', { provider_name: 'Gamma', uptime_last_1d: 99.8, throughput_last_30m: { p50: 70, p90: 210 } })
  ]

  /** `minutesBeforeNow` as an ISO string, with or without the `.000` milliseconds. */
  const iso = (minutesBeforeNow: number, millis: boolean): string => {
    const s = new Date(NOW_MS - minutesBeforeNow * 60_000).toISOString()
    return millis ? s : s.replace('.000Z', 'Z')
  }

  /**
   * 12 observations per tag, every 3rd duplicated under the other spelling with
   * other values, plus a stored copy of the snapshot, one after now and one older
   * than 7 days. The window is the snapshot and k = 1..5. For the even-indexed
   * tags the only low uptime inside it is the k = 3 duplicate, so readmission
   * depends on that duplicate collapsing to the minimum, whatever the order.
   */
  function richHistory(): RoutingObservation[] {
    let s = 12345
    const next = (): number => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0
      return s / 2 ** 32
    }
    const sample = (tag: string, observedAt: string, k: number, low: boolean): RoutingObservation => {
      const tps = k % 5 === 0 ? 0 : k % 7 === 0 ? null : Math.round(40 + next() * 160)
      return {
        tag,
        observedAt,
        uptime1d: low ? 99.4 + next() * 0.09 : 99.5 + next() * 0.5,
        uptime5m: k % 11 === 0 ? null : 96 + next() * 4,
        status: 0,
        tpsP50: tps,
        tpsP90: tps === null ? null : tps * 2,
        latencyP50Ms: k % 6 === 0 ? null : Math.round(300 + next() * 2000),
        latencyP90Ms: Math.round(2500 + next() * 3000)
      }
    }
    const out: RoutingObservation[] = []
    TAGS.forEach((tag, i) => {
      for (let k = 1; k <= 12; k++) {
        const minutes = 15 + 30 * k + 7 * k * k // spread from 52 minutes to about 17 hours
        out.push(sample(tag, iso(minutes, false), k, k === 8)) // k = 8 is low but outside the 6-newest window
        if (k % 3 === 0) out.push(sample(tag, iso(minutes, true), k + 1, k === 3 && i % 2 === 0))
      }
      out.push(sample(tag, '2026-10-02T09:05:00.000Z', 2, false)) // the snapshot's own instant, other spelling
      out.push(sample(tag, iso(-10, false), 1, true)) // after now
      out.push(sample(tag, iso(7 * 24 * 60 + 30, true), 4, true)) // older than 7 days
    })
    return out
  }

  const history = richHistory()
  const base = rankCandidates(synthetic(rows, { history }))

  it('the history is actually used: smoothing, duplicates and hysteresis all take part', () => {
    expect(history).toHaveLength(TAGS.length * (12 + 4 + 3))
    expect(base.candidates).toHaveLength(TAGS.length)
    expect(Math.max(...base.candidates.map((c) => c.observations))).toBeGreaterThanOrEqual(3)
    // Readmission comes only from the low k = 3 duplicates (current uptime below 99.6 on all three).
    expect(Object.fromEntries(base.candidates.map((c) => [c.tag, c.excludedBy]))).toEqual({
      'Beta/fp8': [],
      'alpha/fp8': ['readmission needs 99.6% (now 99.55%)'],
      'delta/fp8': ['readmission needs 99.6% (now 99.58%)'],
      'eps/fp8': [],
      'gamma/fp8': ['readmission needs 99.6% (now 99.52%)']
    })
    expect(base.selections.fast).toHaveLength(2)
    expect(JSON.parse(JSON.stringify(base))).toStrictEqual(base)
  })

  it.each([1, 2, 3, 5, 8, 13])('seed %i', (seed) => {
    const input = synthetic(shuffled(rows, seed), { history: shuffled(history, seed * 31 + 7) })
    expect(rankCandidates(input)).toStrictEqual(base)
  })

  it('reversed endpoints and history', () => {
    expect(rankCandidates(synthetic([...rows].reverse(), { history: [...history].reverse() }))).toStrictEqual(base)
  })
})
