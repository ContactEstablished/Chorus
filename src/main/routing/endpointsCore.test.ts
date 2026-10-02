import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { routingObservationSchema, type RawEndpoint } from '../../shared/routing'
import {
  collapseEndpoints,
  collapseStatus,
  extractObservations,
  maxOrNull,
  minOrNull,
  normalizeQuantization,
  parseEndpointsResponse
} from './endpointsCore'

/** Model Routing Task 1-1, Table E (ImplementationSpec-1-1). */

const FIXTURE_TEXT = readFileSync(join(__dirname, '__fixtures__/endpoints-deepseek-v4.1-flash-2026-10-02.json'), 'utf8')
const freshFixture = (): { fetchedAt: string; data: { endpoints: Record<string, unknown>[] } } => JSON.parse(FIXTURE_TEXT)
const fixture = freshFixture()
const parsed = parseEndpointsResponse(fixture)
const endpoints = parsed.endpoints

/** A minimal valid row; tests name only the fields they mean. */
function row(over: Partial<RawEndpoint> = {}): RawEndpoint {
  return {
    tag: 'x/y',
    provider_name: 'X',
    quantization: 'fp8',
    context_length: 262144,
    max_completion_tokens: 65536,
    pricing: { prompt: '0.0000001', completion: '0.0000004', input_cache_read: '0.00000001' },
    supported_parameters: ['tools', 'tool_choice', 'max_tokens', 'reasoning'],
    status: 0,
    uptime_last_1d: 99.9,
    uptime_last_5m: 100,
    throughput_last_30m: { p50: 80, p90: 120 },
    latency_last_30m: { p50: 900, p90: 1800 },
    ...over
  }
}

const one = (rows: RawEndpoint[]) => {
  const out = collapseEndpoints(rows)
  expect(out).toHaveLength(1)
  return out[0]
}

describe('Table E — endpoint parsing, normalisation and collapse', () => {
  it('E1: the fixture parses to 33 rows with no rejections', () => {
    expect(parsed.modelId).toBe('deepseek/deepseek-v4.1-flash')
    expect(parsed.endpoints).toHaveLength(33)
    expect(parsed.rejected).toEqual([])
    // Valid rows keep input order.
    expect(parsed.endpoints.map((e) => e.tag)).toEqual(fixture.data.endpoints.map((e) => e.tag))
  })

  it('E2: a malformed row is rejected by index without dropping the others', () => {
    const broken = freshFixture()
    delete broken.data.endpoints[5].tag
    const result = parseEndpointsResponse(broken)
    expect(result.endpoints).toHaveLength(32)
    expect(result.rejected).toHaveLength(1)
    expect(result.rejected[0].index).toBe(5)
    expect(result.rejected[0].tag).toBeNull()
    expect(result.rejected[0].issue).toMatch(/^tag: /)
    expect(result.endpoints.map((e) => e.tag)).not.toContain('sail-research/fp4')
  })

  it('E2: a rejected row whose tag is a string reports that tag', () => {
    const broken = freshFixture()
    ;(broken.data.endpoints[10].pricing as Record<string, unknown>).prompt = 'abc'
    const result = parseEndpointsResponse(broken)
    expect(result.endpoints).toHaveLength(32)
    expect(result.rejected).toEqual([{ index: 10, tag: 'deepinfra/fp8', issue: expect.stringMatching(/^pricing\.prompt: /) }])
  })

  it('E3: an invalid envelope throws', () => {
    expect(() => parseEndpointsResponse({})).toThrow()
    expect(() => parseEndpointsResponse({ data: { id: 'x' } })).toThrow()
    expect(() => parseEndpointsResponse(null)).toThrow()
  })

  it('E4: normalizeQuantization', () => {
    expect(normalizeQuantization('fp8')).toBe('fp8')
    expect(normalizeQuantization('FP8')).toBe('fp8')
    expect(normalizeQuantization('fp6e3')).toBe('unknown')
    expect(normalizeQuantization(null)).toBe('unknown')
    expect(normalizeQuantization(undefined)).toBe('unknown')
    expect(normalizeQuantization('unknown')).toBe('unknown')
    expect(normalizeQuantization('BF16')).toBe('bf16')
  })

  it('E5: the fixture collapses to 32 groups; baseten/fp8 combines its two rows', () => {
    const collapsed = collapseEndpoints(endpoints)
    expect(collapsed).toHaveLength(32)
    const baseten = collapsed.find((c) => c.tag === 'baseten/fp8')
    expect(baseten).toBeDefined()
    if (!baseten) return
    // Each value is selected (min/max) from an input row, so exact equality is the right assertion.
    expect(baseten.rows).toBe(2)
    expect(baseten.providerName).toBe('BaseTen')
    expect(baseten.quantization).toBe('fp8')
    expect(baseten.mixedQuantization).toBe(false)
    expect(baseten.rowQuantizations).toEqual(['fp8'])
    expect(baseten.tpsP50).toBe(62)
    expect(baseten.tpsP90).toBe(293)
    expect(baseten.latencyP50Ms).toBe(305)
    expect(baseten.latencyP90Ms).toBe(1456.5000000000027)
    expect(baseten.uptime1d).toBe(99.92966632878922)
    expect(baseten.uptime5m).toBe(99.2)
    expect(baseten.status).toBe(0)
    expect(baseten.pricing).toHaveLength(2)
    // Single-row groups pass through.
    expect(collapsed.filter((c) => c.tag !== 'baseten/fp8').every((c) => c.rows === 1)).toBe(true)
  })

  it('E5: groups are sorted by tag with a code-unit compare, not locale order', () => {
    const tags = collapseEndpoints(endpoints).map((c) => c.tag)
    expect(tags).toEqual([...new Set(tags)].sort())
    const mixedCase = collapseEndpoints([row({ tag: 'a/x' }), row({ tag: 'B/x' })]).map((c) => c.tag)
    expect(mixedCase).toEqual(['B/x', 'a/x'])
  })

  it('E6: mixed quantization becomes unknown; row values are listed in QUANTIZATIONS order', () => {
    const c = one([row({ quantization: 'fp16' }), row({ quantization: 'fp8' })])
    expect(c.quantization).toBe('unknown')
    expect(c.mixedQuantization).toBe(true)
    expect(c.rowQuantizations).toEqual(['fp8', 'fp16'])
  })

  it('E6: an undeclared row next to a declared one is mixed too', () => {
    const c = one([row({ quantization: 'fp8' }), row({ quantization: null })])
    expect(c.quantization).toBe('unknown')
    expect(c.mixedQuantization).toBe(true)
    expect(c.rowQuantizations).toEqual(['fp8', 'unknown'])
  })

  it('E7: any non-zero status wins (the smallest non-zero value)', () => {
    expect(one([row({ status: 0 }), row({ status: -2 })]).status).toBe(-2)
    expect(one([row({ status: 1 }), row({ status: -2 }), row({ status: 0 })]).status).toBe(-2)
    expect(one([row({ status: 0 }), row({ status: 0 })]).status).toBe(0)
  })

  it('E8: a null uptime or speed in any row makes the tag value null (C7)', () => {
    const uptime = one([row({ uptime_last_1d: null }), row({ uptime_last_1d: 99.9 })])
    expect(uptime.uptime1d).toBeNull()
    expect(uptime.uptime5m).toBe(100)

    const speed = one([row({ throughput_last_30m: null }), row()])
    expect(speed.tpsP50).toBeNull()
    expect(speed.tpsP90).toBeNull()
    expect(speed.latencyP50Ms).toBe(900)

    const missingPercentile = one([row({ latency_last_30m: { p50: 700 } }), row()])
    expect(missingPercentile.latencyP50Ms).toBe(900)
    expect(missingPercentile.latencyP90Ms).toBeNull()

    const absent: RawEndpoint = row()
    delete absent.uptime_last_5m
    expect(one([absent, row()]).uptime5m).toBeNull()
  })

  it('E8: otherwise uptime and tps take the minimum, latency the maximum, context the minimum', () => {
    const c = one([
      row({ uptime_last_1d: 99.7, uptime_last_5m: 98, throughput_last_30m: { p50: 50, p90: 200 }, latency_last_30m: { p50: 400, p90: 900 }, context_length: 300000 }),
      row({ uptime_last_1d: 99.9, uptime_last_5m: 99, throughput_last_30m: { p50: 70, p90: 100 }, latency_last_30m: { p50: 300, p90: 1200 }, context_length: 262144 })
    ])
    expect(c).toMatchObject({ uptime1d: 99.7, uptime5m: 98, tpsP50: 50, tpsP90: 100, latencyP50Ms: 400, latencyP90Ms: 1200, contextLength: 262144 })
  })

  it('E9: supported parameters are intersected and sorted ascending', () => {
    const c = one([
      row({ supported_parameters: ['tools', 'tool_choice', 'reasoning'] }),
      row({ supported_parameters: ['tools', 'reasoning', 'max_tokens'] })
    ])
    expect(c.supportedParameters).toEqual(['reasoning', 'tools'])
  })

  it('E10: null max_completion_tokens is ignored; all null stays null', () => {
    expect(one([row({ max_completion_tokens: null }), row({ max_completion_tokens: 131072 })]).maxCompletion).toBe(131072)
    expect(one([row({ max_completion_tokens: null }), row({ max_completion_tokens: null })]).maxCompletion).toBeNull()
    expect(one([row({ max_completion_tokens: 200000 }), row({ max_completion_tokens: 131072 })]).maxCompletion).toBe(131072)
  })

  it('E11: reversed and rotated rows give strictly equal collapse and observation output', () => {
    const snapshot = { fetchedAt: fixture.fetchedAt, endpoints }
    const baseCollapse = collapseEndpoints(endpoints)
    const baseObs = extractObservations(snapshot)
    const reversed = [...endpoints].reverse()
    const rotated = [...endpoints.slice(13), ...endpoints.slice(0, 13)]
    const baseten26First = [...endpoints.slice(26), ...endpoints.slice(0, 26)] // the second baseten/fp8 row leads
    for (const shuffled of [reversed, rotated, baseten26First]) {
      expect(collapseEndpoints(shuffled)).toStrictEqual(baseCollapse)
      expect(extractObservations({ fetchedAt: fixture.fetchedAt, endpoints: shuffled })).toStrictEqual(baseObs)
    }
  })

  it('E12: 32 observations at fetchedAt, each a valid strict observation, sorted by tag', () => {
    const obs = extractObservations({ fetchedAt: fixture.fetchedAt, endpoints })
    expect(obs).toHaveLength(32)
    expect(obs.every((o) => o.observedAt === '2026-10-02T09:05:00Z')).toBe(true)
    for (const o of obs) expect(routingObservationSchema.safeParse(o).success, o.tag).toBe(true)
    const tags = obs.map((o) => o.tag)
    expect(tags).toEqual([...tags].sort())
    expect(obs.find((o) => o.tag === 'baseten/fp8')).toEqual({
      tag: 'baseten/fp8',
      observedAt: '2026-10-02T09:05:00Z',
      uptime1d: 99.92966632878922,
      uptime5m: 99.2,
      status: 0,
      tpsP50: 62,
      tpsP90: 293,
      latencyP50Ms: 305,
      latencyP90Ms: 1456.5000000000027
    })
  })

  it('E11: a group with differing provider names and pricing is order-free', () => {
    const zeta = row({
      tag: 'x/y',
      provider_name: 'Zeta',
      pricing: { prompt: '0.0000003', completion: '0.0000012', input_cache_read: '0.000000006' },
      uptime_last_1d: 99.7,
      throughput_last_30m: { p50: 70, p90: 110 },
      latency_last_30m: { p50: 600, p90: 1500 }
    })
    const alpha = row({
      tag: 'x/y',
      provider_name: 'Alpha',
      pricing: { prompt: '0.0000001', completion: '0.0000004' },
      uptime_last_1d: 99.9,
      throughput_last_30m: { p50: 90, p90: 100 },
      latency_last_30m: { p50: 400, p90: 1800 }
    })
    const forward = one([zeta, alpha])
    expect(forward.providerName).toBe('Alpha')
    const keys = forward.pricing.map((p) => JSON.stringify(p))
    expect(keys).toEqual([...keys].sort())
    // Input order is [zeta, alpha]; alpha's JSON sorts first ("0.0000001" < "0.0000003").
    expect(forward.pricing).toEqual([alpha.pricing, zeta.pricing])
    expect(forward.pricing[0]).toBe(alpha.pricing) // shared references, as documented
    expect(forward).toMatchObject({ uptime1d: 99.7, tpsP50: 70, tpsP90: 100, latencyP50Ms: 600, latencyP90Ms: 1800 })

    expect(collapseEndpoints([alpha, zeta])).toStrictEqual(collapseEndpoints([zeta, alpha]))
    const at = '2026-10-02T09:05:00Z'
    expect(extractObservations({ fetchedAt: at, endpoints: [alpha, zeta] })).toStrictEqual(
      extractObservations({ fetchedAt: at, endpoints: [zeta, alpha] })
    )
  })

  it('outputs are plain JSON (K2)', () => {
    const collapsed = collapseEndpoints(endpoints)
    expect(JSON.parse(JSON.stringify(collapsed))).toStrictEqual(collapsed)
    const obs = extractObservations({ fetchedAt: fixture.fetchedAt, endpoints })
    expect(JSON.parse(JSON.stringify(obs))).toStrictEqual(obs)
  })

  it('a -0 uptime or speed collapses to 0, so the observation survives JSON', () => {
    const c = one([row({ uptime_last_5m: -0, throughput_last_30m: { p50: -0, p90: 1 } }), row()])
    expect(Object.is(c.uptime5m, 0)).toBe(true)
    expect(Object.is(c.tpsP50, 0)).toBe(true)
    const obs = extractObservations({ fetchedAt: '2026-10-02T09:05:00Z', endpoints: [row({ latency_last_30m: { p50: -0, p90: -0 } })] })
    expect(JSON.parse(JSON.stringify(obs))).toStrictEqual(obs)
  })
})

describe('C7 collapse primitives (shared with Task 1-2)', () => {
  it('minOrNull: minimum, null if any value is null or absent, null for an empty list', () => {
    expect(minOrNull([3, 1, 2])).toBe(1)
    expect(minOrNull([5])).toBe(5)
    expect(minOrNull([3, null, 1])).toBeNull()
    expect(minOrNull([3, undefined])).toBeNull()
    expect(minOrNull([])).toBeNull()
    expect(Object.is(minOrNull([-0]), 0)).toBe(true)
    expect(Object.is(minOrNull([0, -0]), 0)).toBe(true)
  })

  it('maxOrNull: maximum, null if any value is null or absent, null for an empty list', () => {
    expect(maxOrNull([3, 1, 2])).toBe(3)
    expect(maxOrNull([5])).toBe(5)
    expect(maxOrNull([null, 3])).toBeNull()
    expect(maxOrNull([3, undefined])).toBeNull()
    expect(maxOrNull([])).toBeNull()
    expect(Object.is(maxOrNull([-0]), 0)).toBe(true)
    expect(Object.is(maxOrNull([-0, -1]), 0)).toBe(true)
  })

  it('collapseStatus: all 0 gives 0 (also for an empty list), else the smallest non-zero value', () => {
    expect(collapseStatus([0, 0])).toBe(0)
    expect(collapseStatus([])).toBe(0)
    expect(collapseStatus([0, -2])).toBe(-2)
    expect(collapseStatus([-2, 0])).toBe(-2)
    expect(collapseStatus([1, 0, -2])).toBe(-2)
    expect(collapseStatus([3, 1])).toBe(1)
    expect(Object.is(collapseStatus([-0]), 0)).toBe(true)
  })
})
