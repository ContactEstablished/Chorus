import { describe, expect, it } from 'vitest'

import {
  DEFAULT_ROUTING_SETTINGS,
  ROUTING_PROFILES,
  type AccountEligibility,
  type ModelRegistryEntry,
  type RawEndpoint,
  type RoutingObservation,
  type RoutingProfileId,
  type RoutingSettings,
  type VerificationRecord
} from '../../shared/routing'
import {
  BASE_REQUIRED_PARAMETERS,
  PRECISION_RANK,
  evaluateGates,
  median,
  mergeHistory,
  requiredParameters,
  selectWindow,
  smoothSpeed,
  truncatePct,
  type GateFamily
} from './eligibilityCore'
import { collapseEndpoints, extractObservations } from './endpointsCore'
import { blendedCost, collapsePricing, resolvePricing } from './pricingCore'
import { bundledModelRegistry, findModel } from './registryCore'

/** Model Routing Task 1-2, Tables G and M (ImplementationSpec-1-2). */

/** Relative tolerance 1e-4, as the specification prescribes. */
function close(actual: number | null | undefined, expected: number, label = ''): void {
  expect(typeof actual, label).toBe('number')
  expect(Math.abs((actual as number) / expected - 1) < 1e-4, `${label}: ${actual} vs ${expected}`).toBe(true)
}

const NOW = '2026-10-02T09:20:00Z'
const NOW_MS = Date.parse(NOW)
const FETCHED_AT = '2026-10-02T09:05:00Z' // the snapshot's own observation is 15 minutes old
const CHECKED_AT = '2026-10-02T09:15:39Z'
const MINUTE = 60_000
const DAY_MINUTES = 24 * 60

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
    supported_parameters: ['tools', 'tool_choice', 'max_tokens', 'reasoning', 'temperature'],
    status: 0,
    uptime_last_1d: 99.9,
    uptime_last_5m: 99.9,
    throughput_last_30m: { p50: 100, p90: 150 },
    latency_last_30m: { p50: 500, p90: 900 },
    ...over
  }
}

/** A clean observation `minutesBeforeNow` before NOW (negative = after NOW). */
function obs(tag: string, minutesBeforeNow: number, over: Partial<RoutingObservation> = {}): RoutingObservation {
  return {
    tag,
    observedAt: new Date(NOW_MS - minutesBeforeNow * MINUTE).toISOString(),
    uptime1d: 99.9,
    uptime5m: 99.9,
    status: 0,
    tpsP50: 100,
    tpsP90: 150,
    latencyP50Ms: 500,
    latencyP90Ms: 900,
    ...over
  }
}

const ACCOUNT: AccountEligibility = { guardrailRemoved: [], dataPolicyRemoved: [], checkedAt: CHECKED_AT }

interface Setup {
  history?: RoutingObservation[]
  model?: ModelRegistryEntry
  profile?: RoutingProfileId
  effort?: string | null
  account?: AccountEligibility
  settings?: Partial<RoutingSettings>
}

/** The rankCandidates step-2 pipeline for a snapshot holding one tag. */
function evaluate(rows: RawEndpoint[], setup: Setup = {}) {
  const settings: RoutingSettings = { ...DEFAULT_ROUTING_SETTINGS, ...setup.settings }
  const profile = ROUTING_PROFILES[setup.profile ?? 'interactive']
  const snapshot = { fetchedAt: FETCHED_AT, endpoints: rows }
  const collapsed = collapseEndpoints(rows)
  expect(collapsed).toHaveLength(1)
  const candidate = collapsed[0]
  const history = mergeHistory(setup.history ?? [], extractObservations(snapshot))
  const window = selectWindow(history, candidate.tag, NOW, settings)
  const speed = smoothSpeed(window, settings)
  const prices = collapsePricing(candidate.pricing.map((p) => resolvePricing(p, NOW, profile.typicalPromptTokens)))
  const cost = blendedCost(prices, profile.tokenShares, true)
  const gates = evaluateGates(candidate, window, speed, cost, {
    model: setup.model ?? MODEL,
    profile,
    effort: setup.effort === undefined ? 'low' : setup.effort,
    account: setup.account ?? ACCOUNT,
    settings,
    now: NOW
  })
  return {
    reasons: gates.reasons.map((r) => r.text),
    families: gates.reasons.map((r) => r.family),
    effectiveQuantization: gates.effectiveQuantization,
    window,
    speed
  }
}

const reasonsOf = (rows: RawEndpoint[], setup: Setup = {}): string[] => evaluate(rows, setup).reasons

function verification(tag: string, verifiedAt: string, expiresAt: string): VerificationRecord {
  return {
    model: MODEL.slug,
    tag,
    referenceTag: 'deepseek',
    suiteVersion: '1',
    score: 0.98,
    verifiedAt,
    expiresAt,
    reviewer: 'test'
  }
}

describe('helpers', () => {
  it('PRECISION_RANK orders the declared precisions', () => {
    expect(PRECISION_RANK).toEqual({ fp32: 6, bf16: 5, fp16: 5, fp8: 4, int8: 3, fp6: 2, fp4: 1, int4: 1 })
  })

  it('requiredParameters: the base three, plus reasoning when an effort is set (K5)', () => {
    expect(BASE_REQUIRED_PARAMETERS).toEqual(['tools', 'tool_choice', 'max_tokens'])
    expect(requiredParameters(null)).toEqual(['tools', 'tool_choice', 'max_tokens'])
    expect(requiredParameters('low')).toEqual(['tools', 'tool_choice', 'max_tokens', 'reasoning'])
    expect(requiredParameters('')).toEqual(['tools', 'tool_choice', 'max_tokens', 'reasoning'])
    // A fresh array each call: mutating it cannot change the next result.
    requiredParameters(null).push('x')
    expect(requiredParameters(null)).toHaveLength(3)
  })

  it('truncatePct truncates, never rounds, and survives binary representation error (C1)', () => {
    expect(truncatePct(99.4951480572302, 2)).toBe('99.49')
    expect(truncatePct(99.55, 2)).toBe('99.55')
    expect(truncatePct(94.9, 1)).toBe('94.9')
    expect(truncatePct(92.36641221374046, 1)).toBe('92.3')
    expect(truncatePct(99.999, 2)).toBe('99.99')
    expect(truncatePct(99.6, 2)).toBe('99.60')
    // 0.29 × 100 and 2.3 × 100 land just below the integer in floating point; the epsilon keeps them exact.
    expect(truncatePct(0.29, 2)).toBe('0.29')
    expect(truncatePct(2.3, 2)).toBe('2.30')
    expect(truncatePct(100, 1)).toBe('100.0')
    expect(truncatePct(0, 2)).toBe('0.00')
  })

  it('selectWindow throws RangeError on an unparseable now', () => {
    expect(() => selectWindow([obs('x/fp8', 15)], 'x/fp8', 'garbage', DEFAULT_ROUTING_SETTINGS)).toThrow(RangeError)
  })
})

describe('Table G — gates', () => {
  const TAG = 'x/fp8'

  it('G1: a low observation in the window demands readmission at 99.6', () => {
    const history = [obs(TAG, 30, { uptime1d: 99.49 })]
    expect(reasonsOf([row(TAG, { uptime_last_1d: 99.55 })], { history })).toEqual(['readmission needs 99.6% (now 99.55%)'])
  })

  it('G2: the same history, now at 99.60, is readmitted', () => {
    const history = [obs(TAG, 30, { uptime1d: 99.49 })]
    expect(reasonsOf([row(TAG, { uptime_last_1d: 99.6 })], { history })).toEqual([])
  })

  it('G3: the low observation as the 7th-newest is outside the window', () => {
    const newer = [150, 120, 90, 60, 30].map((m) => obs(TAG, m, { uptime1d: 99.9 }))
    const low = obs(TAG, 180, { uptime1d: 99.49 })
    const result = evaluate([row(TAG, { uptime_last_1d: 99.55 })], { history: [low, ...newer] })
    expect(result.window).toHaveLength(6)
    expect(result.window.map((o) => o.uptime1d)).not.toContain(99.49)
    expect(result.reasons).toEqual([])
    // Control: with only four newer observations it is the 6th-newest, inside the window.
    expect(reasonsOf([row(TAG, { uptime_last_1d: 99.55 })], { history: [low, ...newer.slice(1)] })).toEqual([
      'readmission needs 99.6% (now 99.55%)'
    ])
  })

  it('G4: a low observation 8 days old is outside the window', () => {
    const history = [obs(TAG, 8 * DAY_MINUTES, { uptime1d: 99.49 })]
    expect(reasonsOf([row(TAG, { uptime_last_1d: 99.55 })], { history })).toEqual([])
    // Control: 6 days 23 hours old is inside.
    const recent = [obs(TAG, 7 * DAY_MINUTES - 60, { uptime1d: 99.49 })]
    expect(reasonsOf([row(TAG, { uptime_last_1d: 99.55 })], { history: recent })).toEqual([
      'readmission needs 99.6% (now 99.55%)'
    ])
  })

  it('rule 3 ignores a null uptime in the window', () => {
    const history = [obs(TAG, 30, { uptime1d: null })]
    expect(reasonsOf([row(TAG, { uptime_last_1d: 99.55 })], { history })).toEqual([])
  })

  it('rule 3 is triggered only by a window value strictly below the minimum', () => {
    const history = [obs(TAG, 30, { uptime1d: 99.5 })]
    expect(reasonsOf([row(TAG, { uptime_last_1d: 99.55 })], { history })).toEqual([])
  })

  it('rule 2 boundary: exactly 99.5 now passes on a clean history, and needs readmission after a low one', () => {
    expect(reasonsOf([row(TAG, { uptime_last_1d: 99.5 })], { history: [obs(TAG, 30)] })).toEqual([])
    expect(reasonsOf([row(TAG, { uptime_last_1d: 99.5 })], { history: [obs(TAG, 30, { uptime1d: 99.49 })] })).toEqual([
      'readmission needs 99.6% (now 99.50%)'
    ])
  })

  it('G5: a current value below the minimum gives only the uptime reason', () => {
    const history = [obs(TAG, 30, { uptime1d: 99.4 })]
    const result = evaluate([row(TAG, { uptime_last_1d: 99.49 })], { history })
    expect(result.reasons).toEqual(['uptime 99.49% < 99.5%'])
    expect(result.families).toEqual(['reliability'])
  })

  it('G6: a 5-minute outage excludes immediately despite a clean history', () => {
    const history = [30, 60, 90, 120, 150].map((m) => obs(TAG, m))
    expect(reasonsOf([row(TAG, { uptime_last_5m: 94.9 })], { history })).toEqual(['currently degraded (5m uptime 94.9%)'])
    expect(reasonsOf([row(TAG, { uptime_last_5m: 95 })], { history })).toEqual([])
  })

  it('G7: a non-zero status excludes immediately despite a clean history', () => {
    const history = [30, 60, 90, 120, 150].map((m) => obs(TAG, m))
    expect(reasonsOf([row(TAG, { status: -2 })], { history })).toEqual(['status -2'])
  })

  it('G8: missing 1-day uptime excludes; missing 5-minute uptime does not (C2)', () => {
    expect(reasonsOf([row(TAG, { uptime_last_1d: null })])).toEqual(['no uptime data'])
    // Rules 1-3 are exclusive: a low observation in the window adds nothing.
    expect(reasonsOf([row(TAG, { uptime_last_1d: null })], { history: [obs(TAG, 30, { uptime1d: 99 })] })).toEqual([
      'no uptime data'
    ])
    const absent = row(TAG)
    delete absent.uptime_last_1d
    expect(reasonsOf([absent])).toEqual(['no uptime data'])
    expect(reasonsOf([row(TAG, { uptime_last_5m: null })])).toEqual([])
  })

  it('G9: 99.4951 prints truncated as 99.49% (C1)', () => {
    expect(reasonsOf([row('inference-net', { uptime_last_1d: 99.4951480572302 })])).toEqual(['uptime 99.49% < 99.5%'])
  })

  it('G10: guardrail removal excludes; an unparsed guardrail list excludes nothing', () => {
    const removed = { ...ACCOUNT, guardrailRemoved: [TAG] }
    const result = evaluate([row(TAG)], { account: removed })
    expect(result.reasons).toEqual(['removed by account guardrail'])
    expect(result.families).toEqual(['account'])
    expect(reasonsOf([row(TAG)], { account: { ...ACCOUNT, guardrailRemoved: null } })).toEqual([])
    expect(reasonsOf([row(TAG)], { account: { ...ACCOUNT, guardrailRemoved: ['x'] } })).toEqual([]) // a prefix never matches
  })

  it('G11: data-policy removal excludes under deny only (C3)', () => {
    const account = { ...ACCOUNT, dataPolicyRemoved: [TAG] }
    expect(reasonsOf([row(TAG)], { account })).toEqual(['removed by data policy'])
    expect(reasonsOf([row(TAG)], { account, settings: { dataCollection: 'allow' } })).toEqual([])
    expect(reasonsOf([row(TAG)], { account: { ...ACCOUNT, dataPolicyRemoved: null } })).toEqual([])
  })

  it('G12: undeclared quantization from a non-first-party provider is excluded', () => {
    const result = evaluate([row('together', { provider_name: 'Together', quantization: null })])
    expect(result.reasons).toEqual(['quantization not declared'])
    expect(result.families).toEqual(['precision'])
    expect(result.effectiveQuantization).toBe('unknown')
    expect(reasonsOf([row('together', { provider_name: 'Together', quantization: 'unknown' })])).toEqual([
      'quantization not declared'
    ])
  })

  it('G13: undeclared quantization from the first party is admitted at native precision', () => {
    const result = evaluate([row('deepseek', { provider_name: 'DeepSeek', quantization: null })])
    expect(result.reasons).toEqual([])
    expect(result.effectiveQuantization).toBe('fp8')
  })

  it('G14: a verification record admits only its exact tag while active', () => {
    const undeclared = [row('wafer', { provider_name: 'Wafer', quantization: null })]
    const active = { ...MODEL, verified: [verification('wafer', '2026-09-01T00:00:00Z', '2026-12-01T00:00:00Z')] }
    const admitted = evaluate(undeclared, { model: active })
    expect(admitted.reasons).toEqual([])
    expect(admitted.effectiveQuantization).toBe('fp8')

    const expired = { ...MODEL, verified: [verification('wafer', '2026-08-01T00:00:00Z', '2026-10-02T09:20:00Z')] }
    expect(reasonsOf(undeclared, { model: expired })).toEqual(['quantization not declared'])

    const otherTag = { ...MODEL, verified: [verification('wafer/fp8', '2026-09-01T00:00:00Z', '2026-12-01T00:00:00Z')] }
    expect(reasonsOf(undeclared, { model: otherTag })).toEqual(['quantization not declared'])
  })

  it('G15: strict policy excludes undeclared quantization even from the first party', () => {
    const rows = [row('deepseek', { provider_name: 'DeepSeek', quantization: null })]
    const result = evaluate(rows, { settings: { unknownQuantPolicy: 'strict' } })
    expect(result.reasons).toEqual(['quantization not declared'])
    expect(result.effectiveQuantization).toBe('unknown')
  })

  it('G16: rows that disagree on quantization take the undeclared path with their own reason (C6)', () => {
    const result = evaluate([row(TAG, { quantization: 'fp8' }), row(TAG, { quantization: 'fp16' })])
    expect(result.reasons).toEqual(['quantization differs across rows sharing this tag'])
    expect(result.effectiveQuantization).toBe('unknown')
    // fp8 + undeclared is mixed too.
    expect(reasonsOf([row(TAG, { quantization: 'fp8' }), row(TAG, { quantization: null })])).toEqual([
      'quantization differs across rows sharing this tag'
    ])
    // A first-party mixed tag is admitted like any undeclared one.
    const firstParty = evaluate([
      row('deepseek', { provider_name: 'DeepSeek', quantization: 'fp8' }),
      row('deepseek', { provider_name: 'DeepSeek', quantization: 'fp16' })
    ])
    expect(firstParty.reasons).toEqual([])
    expect(firstParty.effectiveQuantization).toBe('fp8')
  })

  it('G17: below native precision is excluded; above native passes', () => {
    const fp4 = evaluate([row(TAG, { quantization: 'fp4' })])
    expect(fp4.reasons).toEqual(['fp4 below native fp8'])
    expect(fp4.effectiveQuantization).toBe('fp4')
    expect(reasonsOf([row(TAG, { quantization: 'int8' })])).toEqual(['int8 below native fp8'])
    const fp32 = evaluate([row(TAG, { quantization: 'fp32' })])
    expect(fp32.reasons).toEqual([])
    expect(fp32.effectiveQuantization).toBe('fp32')
    expect(reasonsOf([row(TAG, { quantization: 'bf16' })])).toEqual([])
  })

  it('G18: nativePrecision null skips the precision filter', () => {
    const closed = { ...MODEL, nativePrecision: null }
    const result = evaluate([row(TAG, { quantization: 'fp4' })], { model: closed })
    expect(result.reasons).toEqual([])
    expect(result.effectiveQuantization).toBe('fp4')
    const undeclared = evaluate([row(TAG, { quantization: null })], { model: closed })
    expect(undeclared.reasons).toEqual([])
    expect(undeclared.effectiveQuantization).toBe('unknown')
  })

  describe('C11: a mixed tag with a declared row below native is never admitted', () => {
    const deepseekRows = (...quants: (string | null)[]) =>
      quants.map((q) => row('deepseek', { provider_name: 'DeepSeek', quantization: q }))

    it('(a) first-party fp4 + int4 names the first below-native row in QUANTIZATIONS order', () => {
      const result = evaluate(deepseekRows('fp4', 'int4'))
      expect(result.reasons).toEqual(['int4 below native fp8'])
      expect(result.families).toEqual(['precision'])
      expect(result.effectiveQuantization).toBe('unknown')
    })

    it('(b) first-party fp8 + fp4', () => {
      const result = evaluate(deepseekRows('fp8', 'fp4'))
      expect(result.reasons).toEqual(['fp4 below native fp8'])
      expect(result.effectiveQuantization).toBe('unknown')
    })

    it('(c) non-first-party fp8 + fp4 gets the below-native reason, not the mixed one', () => {
      const result = evaluate([row(TAG, { quantization: 'fp8' }), row(TAG, { quantization: 'fp4' })])
      expect(result.reasons).toEqual(['fp4 below native fp8'])
      expect(result.effectiveQuantization).toBe('unknown')
    })

    it('(d) first-party fp8 + fp16 has no below-native row and is still admitted at native', () => {
      const result = evaluate(deepseekRows('fp8', 'fp16'))
      expect(result.reasons).toEqual([])
      expect(result.effectiveQuantization).toBe('fp8')
      // An undeclared row is not a below-native row either.
      expect(evaluate(deepseekRows('fp8', null)).reasons).toEqual([])
    })

    it('(e) an active verification does not admit fp8 + fp4', () => {
      const verified = { ...MODEL, verified: [verification(TAG, '2026-09-01T00:00:00Z', '2026-12-01T00:00:00Z')] }
      const rows = [row(TAG, { quantization: 'fp8' }), row(TAG, { quantization: 'fp4' })]
      const result = evaluate(rows, { model: verified })
      expect(result.reasons).toEqual(['fp4 below native fp8'])
      expect(result.effectiveQuantization).toBe('unknown')
      // Control: the same record admits fp8 + fp16.
      expect(evaluate([row(TAG, { quantization: 'fp8' }), row(TAG, { quantization: 'fp16' })], { model: verified }).reasons).toEqual([])
    })

    it('(f) nativePrecision null skips the rule', () => {
      const closed = { ...MODEL, nativePrecision: null }
      const result = evaluate(deepseekRows('fp4', 'int4'), { model: closed })
      expect(result.reasons).toEqual([])
      expect(result.effectiveQuantization).toBe('unknown')
    })
  })

  it('G19: reasoning is required only when an effort is set (K5)', () => {
    const noReasoning = [row(TAG, { supported_parameters: ['tools', 'tool_choice', 'max_tokens'] })]
    const result = evaluate(noReasoning, { effort: 'low' })
    expect(result.reasons).toEqual(['missing parameter: reasoning'])
    expect(result.families).toEqual(['capability'])
    expect(reasonsOf(noReasoning, { effort: null })).toEqual([])
    // Several missing parameters are listed in requiredParameters order.
    expect(reasonsOf([row(TAG, { supported_parameters: ['max_tokens'] })])).toEqual([
      'missing parameter: tools',
      'missing parameter: tool_choice',
      'missing parameter: reasoning'
    ])
  })

  it('G20: context below the registry minimum', () => {
    expect(reasonsOf([row(TAG, { context_length: 131072 })])).toEqual(['context 131072 < 262144'])
    expect(reasonsOf([row(TAG, { context_length: 262144 })])).toEqual([])
  })

  it('G21: max output below the profile minimum; null is ignored', () => {
    expect(reasonsOf([row(TAG, { max_completion_tokens: 32768 })], { profile: 'interactive' })).toEqual([
      'max output 32768 < 65536'
    ])
    expect(reasonsOf([row(TAG, { max_completion_tokens: 64000 })], { profile: 'helper' })).toEqual([])
    expect(reasonsOf([row(TAG, { max_completion_tokens: 64000 })], { profile: 'interactive' })).toEqual([
      'max output 64000 < 65536'
    ])
    expect(reasonsOf([row(TAG, { max_completion_tokens: null })])).toEqual([])
  })

  it('G22: zero, null or missing speed gives no speed data', () => {
    const zeroTps = evaluate([row(TAG, { throughput_last_30m: { p50: 0, p90: 10 } })])
    expect(zeroTps.reasons).toEqual(['no speed data'])
    expect(zeroTps.families).toEqual(['speed'])
    expect(zeroTps.speed.tpsP50).toBeNull()
    expect(reasonsOf([row(TAG, { latency_last_30m: null })])).toEqual(['no speed data'])
    expect(reasonsOf([row(TAG, { latency_last_30m: { p50: null, p90: 900 } })])).toEqual(['no speed data'])
    expect(reasonsOf([row(TAG, { throughput_last_30m: null, latency_last_30m: null })])).toEqual(['no speed data'])
  })

  it('G23: an unusable price excludes (C5)', () => {
    const result = evaluate([row(TAG, { pricing: { prompt: '-1', completion: '0.0000004', input_cache_read: '0.00000001' } })])
    expect(result.reasons).toEqual(['no usable price'])
    expect(result.families).toEqual(['price'])
  })

  it('G24: an Alibaba-like row lists every failing rule in canonical order', () => {
    const result = evaluate([
      row('alibaba', { provider_name: 'Alibaba', quantization: null, uptime_last_1d: 97.18, uptime_last_5m: 92.366, status: -2 })
    ])
    expect(result.reasons).toEqual([
      'uptime 97.18% < 99.5%',
      'currently degraded (5m uptime 92.3%)',
      'status -2',
      'quantization not declared'
    ])
    expect(result.families).toEqual<GateFamily[]>(['reliability', 'reliability', 'reliability', 'precision'])
  })

  it('every family in canonical order when everything fails', () => {
    const result = evaluate(
      [
        row(TAG, {
          quantization: 'fp4',
          uptime_last_1d: null,
          uptime_last_5m: 50,
          status: 1,
          supported_parameters: [],
          context_length: 1000,
          max_completion_tokens: 1000,
          throughput_last_30m: null,
          pricing: { prompt: '0', completion: '0', input_cache_read: '0' }
        })
      ],
      { account: { guardrailRemoved: [TAG], dataPolicyRemoved: [TAG], checkedAt: CHECKED_AT } }
    )
    expect(result.reasons).toEqual([
      'no uptime data',
      'currently degraded (5m uptime 50.0%)',
      'status 1',
      'removed by account guardrail',
      'removed by data policy',
      'fp4 below native fp8',
      'missing parameter: tools',
      'missing parameter: tool_choice',
      'missing parameter: max_tokens',
      'missing parameter: reasoning',
      'context 1000 < 262144',
      'max output 1000 < 65536',
      'no speed data',
      'no usable price'
    ])
    expect(result.families).toEqual<GateFamily[]>([
      'reliability',
      'reliability',
      'reliability',
      'account',
      'account',
      'precision',
      'capability',
      'capability',
      'capability',
      'capability',
      'capability',
      'capability',
      'speed',
      'price'
    ])
  })
})

describe('Table M — smoothing', () => {
  const TAG = 'x/fp8'
  const settings = DEFAULT_ROUTING_SETTINGS

  it('M1: medians of the positive values; a zero speed is ignored', () => {
    const tps = [100, 50, 80, 0, 90, 70]
    const window = tps.map((t, i) => obs(TAG, 10 * (i + 1), { tpsP50: t, latencyP50Ms: 400 + 100 * i }))
    const speed = smoothSpeed(window, settings)
    expect(speed.tpsP50).toBe(80)
    expect(speed.observations).toBe(5)
    expect(speed.limitedHistory).toBe(false)
    close(speed.latencyP50S, 0.65) // median of 400..900 ms
  })

  it('M2: median', () => {
    expect(median([62, 63, 67, 88])).toBe(65)
    expect(median([88, 62, 67, 63])).toBe(65)
    expect(median([3, 1, 2])).toBe(2)
    expect(median([7])).toBe(7)
    expect(median([])).toBeNull()
    // The input is not mutated.
    const input = [3, 1, 2]
    median(input)
    expect(input).toEqual([3, 1, 2])
  })

  it('M3: two observations mark limited history, and every gate still applies', () => {
    const failing = evaluate([row(TAG, { status: -2 })], { history: [obs(TAG, 45)] })
    expect(failing.speed.observations).toBe(2)
    expect(failing.speed.limitedHistory).toBe(true)
    expect(failing.reasons).toEqual(['status -2'])
    // Limited history is not itself a reason.
    const passing = evaluate([row(TAG)], { history: [obs(TAG, 45)] })
    expect(passing.speed.limitedHistory).toBe(true)
    expect(passing.reasons).toEqual([])
    // Three observations are stable.
    expect(evaluate([row(TAG)], { history: [obs(TAG, 45), obs(TAG, 75)] }).speed.limitedHistory).toBe(false)
  })

  it('observations is the smaller of the positive tps and latency counts', () => {
    const window = [
      obs(TAG, 10, { tpsP50: 100, latencyP50Ms: null }),
      obs(TAG, 20, { tpsP50: 100, latencyP50Ms: 500 }),
      obs(TAG, 30, { tpsP50: 100, latencyP50Ms: 0 })
    ]
    const speed = smoothSpeed(window, settings)
    expect(speed.observations).toBe(1)
    expect(speed.limitedHistory).toBe(true)
    expect(speed.tpsP50).toBe(100)
    close(speed.latencyP50S, 0.5)
  })

  it('M4: only the six newest observations are used', () => {
    const history = [
      ...[60, 120, 180, 240, 300, 360].map((m, i) => obs(TAG, m, { tpsP50: 100 * (i + 1) })),
      obs(TAG, 420, { tpsP50: 1 }),
      obs(TAG, 480, { tpsP50: 2 })
    ]
    const window = selectWindow(mergeHistory(history, []), TAG, NOW, settings)
    expect(window).toHaveLength(6)
    expect(window.map((o) => o.tpsP50)).toEqual([100, 200, 300, 400, 500, 600])
    expect(smoothSpeed(window, settings).tpsP50).toBe(350)
  })

  it('M5: an observation after now and one older than 7 days are ignored; both boundaries are inside', () => {
    const history = [
      obs(TAG, -1, { tpsP50: 1 }),
      obs(TAG, 7 * DAY_MINUTES + 1, { tpsP50: 2 }),
      obs(TAG, 0, { tpsP50: 10 }),
      obs(TAG, 7 * DAY_MINUTES, { tpsP50: 20 })
    ]
    const window = selectWindow(mergeHistory(history, []), TAG, NOW, settings)
    expect(window.map((o) => o.tpsP50)).toEqual([10, 20])
    // Other tags never enter the window.
    expect(selectWindow([obs('other', 10)], TAG, NOW, settings)).toEqual([])
  })

  it('M6: latency converts from milliseconds to seconds', () => {
    const speed = smoothSpeed([obs(TAG, 15, { latencyP50Ms: 1428.5, latencyP90Ms: 3794.9 })], settings)
    close(speed.latencyP50S, 1.4285)
    close(speed.latencyP90S, 3.7949)
  })

  it('M7: a stored copy of the snapshot observation is counted once', () => {
    const snapshotObs = extractObservations({ fetchedAt: FETCHED_AT, endpoints: [row(TAG)] })
    const stored = { ...snapshotObs[0], observedAt: '2026-10-02T09:05:00.000Z' }
    const merged = mergeHistory([stored], snapshotObs)
    expect(merged).toHaveLength(1)
    expect(merged[0].observedAt).toBe('2026-10-02T09:05:00.000Z') // the smaller string
    const window = selectWindow(merged, TAG, NOW, settings)
    expect(smoothSpeed(window, settings).observations).toBe(1)
    // Through the gate pipeline as well.
    expect(evaluate([row(TAG)], { history: [stored] }).speed.observations).toBe(1)
  })
})

describe('mergeHistory', () => {
  it('collapses duplicates with the K8/C7 rules', () => {
    const at = '2026-10-02T09:05:00Z'
    const a = { ...obs('t', 0), observedAt: at, uptime1d: 99.8, uptime5m: 99, status: 0, tpsP50: 80, tpsP90: 120, latencyP50Ms: 400, latencyP90Ms: 900 }
    const b = { ...obs('t', 0), observedAt: '2026-10-02T09:05:00.000Z', uptime1d: 99.9, uptime5m: 98, status: -2, tpsP50: 90, tpsP90: 110, latencyP50Ms: 500, latencyP90Ms: 800 }
    expect(mergeHistory([a], [b])).toEqual([
      { tag: 't', observedAt: '2026-10-02T09:05:00.000Z', uptime1d: 99.8, uptime5m: 98, status: -2, tpsP50: 80, tpsP90: 110, latencyP50Ms: 500, latencyP90Ms: 900 }
    ])
    const withNull = mergeHistory([{ ...a, uptime1d: null, latencyP50Ms: null }], [b])
    expect(withNull[0].uptime1d).toBeNull()
    expect(withNull[0].latencyP50Ms).toBeNull()
    expect(withNull[0].tpsP50).toBe(80)
  })

  it('sorts by tag (code unit), then newest first, independent of input order', () => {
    const list = [obs('b', 30), obs('a', 60), obs('B', 10), obs('a', 15), obs('b', 90)]
    const merged = mergeHistory(list, [])
    expect(merged.map((o) => [o.tag, o.observedAt])).toEqual([
      ['B', obs('B', 10).observedAt],
      ['a', obs('a', 15).observedAt],
      ['a', obs('a', 60).observedAt],
      ['b', obs('b', 30).observedAt],
      ['b', obs('b', 90).observedAt]
    ])
    expect(mergeHistory([...list].reverse(), [])).toStrictEqual(merged)
    expect(mergeHistory(list.slice(2), list.slice(0, 2))).toStrictEqual(merged)
  })

  it('output is plain JSON (K2)', () => {
    const merged = mergeHistory([obs('a', 30, { uptime5m: -0 }), obs('a', 30, { uptime5m: 0 })], [])
    expect(Object.is(merged[0].uptime5m, 0)).toBe(true)
    expect(JSON.parse(JSON.stringify(merged))).toStrictEqual(merged)
  })
})
