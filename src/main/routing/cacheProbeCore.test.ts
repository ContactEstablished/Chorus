import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { DEFAULT_ROUTING_SETTINGS, type CacheVerification, type CandidateExplanation, type TierResult } from '../../shared/routing'
import {
  CACHE_PROBE_CALLS,
  CACHE_PROBE_CAP_USD,
  CACHE_PROBE_CONCURRENCY,
  CACHE_PROBE_FILLER_LINES,
  CACHE_PROBE_GAP_MS,
  CACHE_PROBE_MAX_AGE_MS,
  CACHE_PROBE_MAX_TOKENS,
  CACHE_PROBE_PROMPT_TOKENS,
  CACHE_PROBE_USER_TEXT,
  evaluateProbe,
  extractProbeUsage,
  planCacheProbe,
  probeCallSpendUsd,
  probeFiller,
  probeRequestBody,
  probeSystemText,
  probeTagEstimateUsd,
  type ProbeCallRecord,
  type ProbePlan,
  type ProbePlanInput
} from './cacheProbeCore'
import { extractObservations, parseEndpointsResponse } from './endpointsCore'
import { bundledModelRegistry, findModel } from './registryCore'
import { computeTiers } from './routingCore'

/** Model Routing Task 2-1, Tables Q, E and B (ImplementationSpec-2-1). */

/** Money compares to 1e-12 absolute, as the specification prescribes. */
function money(actual: number, expected: number, label = ''): void {
  expect(Math.abs(actual - expected) < 1e-12, `${label}: ${actual} vs ${expected}`).toBe(true)
}

// ── The Phase 1 golden input (ImplementationSpec-1-3), but with `cache: {}` ──

const SLUG = 'deepseek/deepseek-v4.1-flash'
const NOW = '2026-10-02T09:20:00Z'
const CHECKED_AT = '2026-10-02T09:15:39Z'

const found = findModel(bundledModelRegistry(), SLUG)
if (!found) throw new Error(`bundled registry has no ${SLUG}`)

const fixture = JSON.parse(readFileSync(join(__dirname, '__fixtures__/endpoints-deepseek-v4.1-flash-2026-10-02.json'), 'utf8')) as {
  fetchedAt: string
  guardrailRemoved: string[]
  dataPolicyDenyRemoved: string[]
  cacheVerified: Record<string, boolean>
}
const snapshot = { fetchedAt: fixture.fetchedAt, endpoints: parseEndpointsResponse(fixture).endpoints }

const result: TierResult = computeTiers({
  model: found,
  snapshot,
  history: extractObservations(snapshot),
  account: { guardrailRemoved: fixture.guardrailRemoved, dataPolicyRemoved: fixture.dataPolicyDenyRemoved, checkedAt: CHECKED_AT },
  cache: {},
  profile: 'interactive',
  effort: 'low',
  settings: DEFAULT_ROUTING_SETTINGS,
  now: NOW
})

const Q1_ORDER = [
  'atlas-cloud/fp8',
  'morph/fp8',
  'makora/fp8',
  'streamlake/fp8',
  'deepinfra/fp8',
  'venice/fp8',
  'gmicloud/fp8',
  'baidu/fp8',
  'parasail/fp8',
  'nextbit/fp8',
  'novita/fp8',
  'baseten/fp8',
  'siliconflow/fp8',
  'baseten/fast'
]
const ELIGIBLE_SORTED = [...Q1_ORDER].sort()

/** The fixture's `cacheVerified`, each record checked at `checkedAt`. */
function fixtureCache(checkedAt: string): CacheVerification {
  return Object.fromEntries(Object.entries(fixture.cacheVerified).map(([tag, verified]) => [tag, { verified, checkedAt }]))
}

function plan(over: Partial<ProbePlanInput> = {}): ProbePlan {
  return planCacheProbe({ result, cache: {}, now: NOW, capUsd: 0.05, tagLimit: null, ...over })
}

function candidate(tag: string): CandidateExplanation {
  const c = result.candidates.find((x) => x.tag === tag)
  if (!c) throw new Error(`no candidate ${tag}`)
  return c
}

describe('Table Q — planning on the golden fixture with an empty cache', () => {
  it('the base result has the 14 eligible tags of the golden run', () => {
    expect(result.candidates.filter((c) => c.excludedBy.length === 0).map((c) => c.tag)).toEqual(ELIGIBLE_SORTED)
  })

  it('Q1: cap 0.05, no limit → all 14 in Balanced order for $0.0493873956', () => {
    const p = plan()
    expect(p.planned.map((x) => x.tag)).toEqual(Q1_ORDER)
    money(p.estimateUsd, 0.0493873956, 'Q1 estimate')
    expect(p.notProbed).toEqual([])
    expect(p.fresh).toEqual([])
    expect(p.capUsd).toBe(0.05)
    // The total is the sum of the planned estimates, in plan order.
    expect(p.estimateUsd).toBe(p.planned.reduce((sum, x) => sum + x.estimateUsd, 0))
    // Balanced-score order, descending.
    const scores = p.planned.map((x) => candidate(x.tag).scores.balanced as number)
    for (let i = 1; i < scores.length; i++) expect(scores[i - 1] >= scores[i]).toBe(true)
  })

  it('Q2: cap 0.02 → the first seven for $0.017288676; the other seven are cut by the cap', () => {
    const p = plan({ capUsd: 0.02 })
    expect(p.planned.map((x) => x.tag)).toEqual(Q1_ORDER.slice(0, 7))
    money(p.estimateUsd, 0.017288676, 'Q2 estimate')
    expect(p.notProbed).toEqual(Q1_ORDER.slice(7).map((tag) => ({ tag, reason: 'cap' })))
    // baidu/fp8 would bring the total over the cap.
    const baidu = probeTagEstimateUsd(candidate('baidu/fp8').cost as NonNullable<CandidateExplanation['cost']>)
    money(p.estimateUsd + baidu, 0.0215647956, 'Q2 with baidu')
  })

  it('C7: the cap cut is a prefix — a cheaper later tag that would fit is still cut', () => {
    // Three synthetic candidates in Balanced order: $0.01, $0.05, then $0.001 per tag.
    const base = candidate('atlas-cloud/fp8')
    const priced = (tag: string, balanced: number, promptPerM: number): CandidateExplanation => ({
      ...base,
      tag,
      scores: { balanced },
      cost: { ...(base.cost as NonNullable<CandidateExplanation['cost']>), promptPerM, completionPerM: 0 }
    })
    const perTag = (usd: number): number => (usd * 1_000_000) / (3 * 4500)
    const synthetic: TierResult = {
      ...result,
      candidates: [priced('a/fp8', 3, perTag(0.01)), priced('b/fp8', 2, perTag(0.05)), priced('c/fp8', 1, perTag(0.001))]
    }
    const p = planCacheProbe({ result: synthetic, cache: {}, now: NOW, capUsd: 0.02, tagLimit: null })
    expect(p.planned.map((x) => x.tag)).toEqual(['a/fp8'])
    expect(p.notProbed).toEqual([
      { tag: 'b/fp8', reason: 'cap' },
      { tag: 'c/fp8', reason: 'cap' }
    ])
  })

  it('C7: a tag limit cuts the same way, and a cap cut after the limit is still reported as limit', () => {
    const p = plan({ capUsd: 0.02, tagLimit: 7 })
    expect(p.planned.map((x) => x.tag)).toEqual(Q1_ORDER.slice(0, 7))
    // The limit is reached first, so the remaining tags are 'limit', never 'cap'.
    expect(p.notProbed).toEqual(Q1_ORDER.slice(7).map((tag) => ({ tag, reason: 'limit' })))
  })

  it('Q3: cap 0.05 with tagLimit 2 → atlas-cloud/fp8 and morph/fp8 for $0.002497428; 12 limit', () => {
    const p = plan({ tagLimit: 2 })
    expect(p.planned.map((x) => x.tag)).toEqual(['atlas-cloud/fp8', 'morph/fp8'])
    money(p.estimateUsd, 0.002497428, 'Q3 estimate')
    expect(p.notProbed).toEqual(Q1_ORDER.slice(2).map((tag) => ({ tag, reason: 'limit' })))
  })

  it('Q4: every eligible tag has a fresh record → nothing planned', () => {
    const p = plan({ cache: fixtureCache(CHECKED_AT) })
    expect(p.planned).toEqual([])
    expect(p.estimateUsd).toBe(0)
    expect(p.fresh).toEqual(ELIGIBLE_SORTED)
    expect(p.notProbed).toEqual([])
  })

  it('Q5: exactly 14 days old is fresh; one second more is due', () => {
    const cache = fixtureCache(CHECKED_AT)
    const atBoundary = plan({ cache, now: '2026-10-16T09:15:39Z' })
    expect(atBoundary.fresh).toEqual(ELIGIBLE_SORTED)
    expect(atBoundary.planned).toEqual([])

    const past = plan({ cache, now: '2026-10-16T09:15:40Z' })
    expect(past.fresh).toEqual([])
    expect(past.planned.map((x) => x.tag)).toEqual(Q1_ORDER)
    money(past.estimateUsd, 0.0493873956, 'Q5 estimate')
    expect(CACHE_PROBE_MAX_AGE_MS).toBe(14 * 24 * 60 * 60 * 1000)
  })

  it('Q6: a record for an excluded tag (together, deepseek) is never planned and never fresh', () => {
    for (const checkedAt of [CHECKED_AT, '2026-01-01T00:00:00Z']) {
      const cache: CacheVerification = {
        together: { verified: true, checkedAt },
        deepseek: { verified: false, checkedAt }
      }
      const p = plan({ cache })
      const named = [...p.planned.map((x) => x.tag), ...p.fresh, ...p.notProbed.map((x) => x.tag)]
      expect(named).not.toContain('together')
      expect(named).not.toContain('deepseek')
      expect(p.planned.map((x) => x.tag)).toEqual(Q1_ORDER)
    }
  })

  it('Q7: per-tag estimates', () => {
    const expected: [string, number][] = [
      ['atlas-cloud/fp8', 0.002011788],
      ['morph/fp8', 0.00048564],
      ['venice/fp8', 0.0053505],
      ['baidu/fp8', 0.0042761196],
      ['baseten/fast', 0.0085608]
    ]
    for (const [tag, usd] of expected) {
      const cost = candidate(tag).cost
      if (cost === null) throw new Error(`${tag} has no cost`)
      money(probeTagEstimateUsd(cost), usd, tag)
    }
    // The planned estimate is the same number.
    const planned = plan().planned
    for (const [tag, usd] of expected) money((planned.find((x) => x.tag === tag) as { estimateUsd: number }).estimateUsd, usd, `planned ${tag}`)
  })

  it('Q8: a now without a zone throws RangeError', () => {
    expect(() => plan({ now: '2026-10-02 09:20' })).toThrow(RangeError)
    expect(() => plan({ now: '2026-10-02 09:20' })).toThrow('Invalid time: now')
    expect(() => plan({ now: '2026-10-02T09:20:00' })).toThrow(RangeError)
  })

  it('Q9: reversed candidates give a strictly equal plan', () => {
    const reversed: TierResult = { ...result, candidates: [...result.candidates].reverse() }
    expect(planCacheProbe({ result: reversed, cache: {}, now: NOW, capUsd: 0.05, tagLimit: null })).toStrictEqual(plan())
  })

  it('review minor 2: a NaN, infinite or negative cap throws RangeError("Invalid cap")', () => {
    for (const capUsd of [Number.NaN, Number.POSITIVE_INFINITY, -0.01]) {
      expect(() => plan({ capUsd }), String(capUsd)).toThrow(new RangeError('Invalid cap'))
    }
    // A zero cap is valid: it plans nothing and cuts every due tag with 'cap'.
    const zero = plan({ capUsd: 0 })
    expect(zero.planned).toEqual([])
    expect(zero.notProbed).toEqual(Q1_ORDER.map((tag) => ({ tag, reason: 'cap' })))
  })

  it('review minor 2: a tag limit that is not a non-negative integer throws RangeError', () => {
    for (const tagLimit of [Number.NaN, -1, 1.5, Number.POSITIVE_INFINITY]) {
      expect(() => plan({ tagLimit }), String(tagLimit)).toThrow(RangeError)
    }
    // Zero is valid: every due tag is cut with 'limit'.
    expect(plan({ tagLimit: 0 }).notProbed).toEqual(Q1_ORDER.map((tag) => ({ tag, reason: 'limit' })))
  })

  it('review minor 2: a record whose checkedAt does not parse is due, never fresh', () => {
    const cache = fixtureCache(CHECKED_AT)
    cache['morph/fp8'] = { verified: true, checkedAt: 'not a time' }
    const p = plan({ cache })
    expect(p.planned.map((x) => x.tag)).toEqual(['morph/fp8'])
    expect(p.fresh).toEqual(ELIGIBLE_SORTED.filter((tag) => tag !== 'morph/fp8'))
  })

  it('the plan is plain JSON', () => {
    const p = plan({ capUsd: 0.02 })
    expect(JSON.parse(JSON.stringify(p))).toStrictEqual(p)
  })
})

// ── Table E — evaluation and spend ──

type Sample = [number, number, number, number] // [status, prompt, cached, cost]

const call = (s: Sample): ProbeCallRecord =>
  s[0] === 200 ? { ok: true, usage: { promptTokens: s[1], cachedTokens: s[2], costUsd: s[3] } } : { ok: false }

function spend(calls: ProbeCallRecord[], perCall = 0): number {
  return calls.reduce((sum, c) => sum + probeCallSpendUsd(c, perCall), 0)
}

const okCached = (cachedTokens: number | null): ProbeCallRecord => ({ ok: true, usage: { promptTokens: 4460, cachedTokens, costUsd: 0.0001 } })

describe('Table E — evaluation and spend', () => {
  it('E1: atlas-cloud/fp8 → verified; spend 0.0008525424', () => {
    const calls = ([[200, 4460, 0, 0.000656496], [200, 4460, 4352, 0.0000833592], [200, 4460, 4352, 0.0001126872]] as Sample[]).map(call)
    expect(evaluateProbe(calls)).toBe('verified')
    money(spend(calls), 0.0008525424, 'E1')
  })

  it('E2: baidu/fp8 → not-cached; spend 0.0041604354', () => {
    const calls = ([[200, 4462, 0, 0.0013564422], [200, 4462, 0, 0.0013900086], [200, 4462, 0, 0.0014139846]] as Sample[]).map(call)
    expect(evaluateProbe(calls)).toBe('not-cached')
    money(spend(calls), 0.0041604354, 'E2')
  })

  it('E3: baseten/fp8 → verified on call 3', () => {
    const calls = ([[200, 4462, 0, 0.0014154], [200, 4462, 0, 0.0013542], [200, 4462, 4352, 0.000079064]] as Sample[]).map(call)
    expect(evaluateProbe(calls)).toBe('verified')
    expect(evaluateProbe(calls.slice(0, 2))).toBe('inconclusive')
  })

  it('E4: morph/fp8 → verified; spend 0.000344626', () => {
    const calls = ([[200, 4459, 0, 0.00014049], [200, 4459, 0, 0.00013923], [200, 4459, 4352, 0.000064906]] as Sample[]).map(call)
    expect(evaluateProbe(calls)).toBe('verified')
    money(spend(calls), 0.000344626, 'E4')
  })

  it('E5: a failed call in the middle → inconclusive', () => {
    expect(evaluateProbe([okCached(0), { ok: false }, okCached(0)])).toBe('inconclusive')
  })

  it('E6: a missing cached_tokens → inconclusive (C6)', () => {
    expect(evaluateProbe([okCached(0), okCached(null), okCached(0)])).toBe('inconclusive')
  })

  it('E7: a hit on call 1 only is not evidence → inconclusive', () => {
    expect(evaluateProbe([okCached(4352), okCached(0), okCached(0)])).toBe('inconclusive')
  })

  it('E8: two calls (an aborted refresh) with a hit on call 2 → verified', () => {
    expect(evaluateProbe([okCached(0), okCached(4352)])).toBe('verified')
  })

  it('E9: spend of an ok call without cost is the per-call estimate; of a failed call 0', () => {
    expect(probeCallSpendUsd({ ok: true, usage: { promptTokens: 4460, cachedTokens: 0, costUsd: null } }, 0.003)).toBe(0.003)
    expect(probeCallSpendUsd({ ok: false }, 0.003)).toBe(0)
  })

  it('E10: usage extraction from a real-shaped body', () => {
    expect(
      extractProbeUsage({ usage: { prompt_tokens: 4460, prompt_tokens_details: { cached_tokens: 4352 }, cost: 0.0000833592 } })
    ).toStrictEqual({ promptTokens: 4460, cachedTokens: 4352, costUsd: 0.0000833592 })
  })

  it('E11: missing or malformed usage → all null', () => {
    const none = { promptTokens: null, cachedTokens: null, costUsd: null }
    expect(extractProbeUsage({})).toStrictEqual(none)
    expect(extractProbeUsage(null)).toStrictEqual(none)
    expect(extractProbeUsage({ usage: { cost: 'x', prompt_tokens: -1 } })).toStrictEqual(none)
  })

  it('fields are independent: each one present on its own is read alone', () => {
    expect(extractProbeUsage({ usage: { prompt_tokens: 10 } })).toStrictEqual({ promptTokens: 10, cachedTokens: null, costUsd: null })
    expect(extractProbeUsage({ usage: { prompt_tokens_details: { cached_tokens: 0 } } })).toStrictEqual({
      promptTokens: null,
      cachedTokens: 0,
      costUsd: null
    })
    expect(extractProbeUsage({ usage: { cost: 0 } })).toStrictEqual({ promptTokens: null, cachedTokens: null, costUsd: 0 })
    expect(extractProbeUsage({ usage: { prompt_tokens: 1.5, cost: Number.POSITIVE_INFINITY } })).toStrictEqual({
      promptTokens: null,
      cachedTokens: null,
      costUsd: null
    })
  })
})

// ── Table B — bodies ──

describe('Table B — prompt and request bodies', () => {
  it('B1: the filler is Phase 0’s, byte for byte', () => {
    const filler = probeFiller()
    const lines = filler.split('\n')
    expect(lines).toHaveLength(CACHE_PROBE_FILLER_LINES)
    expect(lines[0]).toBe('export function step0(value: number): number { return value * 3 + 0; }')
    expect(lines[219]).toBe('export function step219(value: number): number { return value * 222 + 4; }')
    expect(filler).toHaveLength(16305)
    expect(createHash('sha256').update(filler, 'utf8').digest('hex')).toBe('e0832703a43d98fc68a4809d982df851025aab4cb4f1cc8fc64a884d9cbca08c')
  })

  it('B2: the probe body, keys in exact order, no data_collection anywhere', () => {
    const body = probeRequestBody('deepseek/deepseek-v4.1-flash', 'atlas-cloud/fp8', 'N')
    expect(Object.keys(body)).toEqual(['model', 'provider', 'messages', 'reasoning', 'max_tokens'])
    expect(body.model).toBe('deepseek/deepseek-v4.1-flash')
    expect(body.provider).toStrictEqual({ order: ['atlas-cloud/fp8'], allow_fallbacks: false })
    expect(Object.keys(body.provider)).toEqual(['order', 'allow_fallbacks'])
    expect(body.messages).toHaveLength(2)
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[0].content.startsWith('Session N atlas-cloud/fp8. Reference module follows.\n')).toBe(true)
    expect(body.messages[0].content).toBe(probeSystemText('N', 'atlas-cloud/fp8'))
    expect(body.messages[0].content).toBe(`Session N atlas-cloud/fp8. Reference module follows.\n${probeFiller()}`)
    expect(body.messages[1]).toStrictEqual({ role: 'user', content: 'Reply with the single word OK.' })
    expect(body.reasoning).toStrictEqual({ effort: 'low' })
    expect(body.max_tokens).toBe(64)
    expect(JSON.stringify(body)).not.toContain('data_collection')
  })

  it('B3: one nonce, two tags → different system content (C5)', () => {
    const a = probeRequestBody(SLUG, 'atlas-cloud/fp8', 'N').messages[0].content
    const b = probeRequestBody(SLUG, 'morph/fp8', 'N').messages[0].content
    expect(a).not.toBe(b)
  })

  it('constants', () => {
    expect(CACHE_PROBE_CAP_USD).toBe(0.05)
    expect(CACHE_PROBE_CALLS).toBe(3)
    expect(CACHE_PROBE_MAX_TOKENS).toBe(64)
    expect(CACHE_PROBE_PROMPT_TOKENS).toBe(4500)
    expect(CACHE_PROBE_CONCURRENCY).toBe(5)
    expect(CACHE_PROBE_GAP_MS).toBe(1500)
    expect(CACHE_PROBE_USER_TEXT).toBe('Reply with the single word OK.')
  })
})
