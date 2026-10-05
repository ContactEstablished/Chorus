import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { ROUTING_PROFILES, type RawPricing, type RawPricingOverride } from '../../shared/routing'
import { collapseEndpoints, parseEndpointsResponse } from './endpointsCore'
import {
  blendedCost,
  collapsePricing,
  overrideApplies,
  perTokenToPerMillion,
  resolvePricing,
  type CollapsedPricing,
  type ResolvedPricing
} from './pricingCore'

/** Model Routing Task 1-1, Tables P, D and B (ImplementationSpec-1-1). */

/** Relative tolerance 1e-4, as the specification prescribes. */
function close(actual: number | null | undefined, expected: number, label = ''): void {
  expect(typeof actual, label).toBe('number')
  expect(Math.abs((actual as number) / expected - 1) < 1e-4, `${label}: ${actual} vs ${expected}`).toBe(true)
}

const fixture = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__/endpoints-deepseek-v4.1-flash-2026-10-02.json'), 'utf8')
) as { fetchedAt: string; cacheVerified: Record<string, boolean>; data: unknown }
const collapsed = collapseEndpoints(parseEndpointsResponse(fixture).endpoints)
const pricingOf = (tag: string): RawPricing[] => {
  const c = collapsed.find((e) => e.tag === tag)
  if (!c) throw new Error(`no ${tag} in fixture`)
  return c.pricing
}

// Table P base: prompt 0.10/M, completion 0.40/M, cache read 0.01/M; override price 0.20/M.
const BASE = { prompt: '0.0000001', completion: '0.0000004', input_cache_read: '0.00000001' } as const
const OVR = '0.0000002'
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
const withOverrides = (overrides: RawPricingOverride[]): RawPricing => ({ ...BASE, overrides })

/** Expect the resolved prompt price (0.20 when the override applies, else 0.10) and the applied flag. */
function expectPrompt(pricing: RawPricing, now: string, applied: boolean, promptTokens = 0): void {
  const r = resolvePricing(pricing, now, promptTokens)
  close(r.promptPerM, applied ? 0.2 : 0.1, now)
  expect(r.overrideApplied, now).toBe(applied)
}

describe('perTokenToPerMillion', () => {
  it('scales per-token strings to $/M', () => {
    close(perTokenToPerMillion('0.0000003'), 0.3)
    close(perTokenToPerMillion('0.000000002115'), 0.002115)
    close(perTokenToPerMillion('3e-7'), 0.3)
  })

  it('normalises -0 to 0, so a cost built from it survives a JSON round trip', () => {
    expect(Object.is(perTokenToPerMillion('-0'), 0)).toBe(true)
    const prices = collapsePricing([resolvePricing({ prompt: '-0', completion: '0.0000004' }, '2026-10-02T12:00:00Z', 0)])
    const cost = blendedCost(prices, ROUTING_PROFILES.interactive.tokenShares, true)
    expect(cost).not.toBeNull()
    expect(Object.is(cost?.fresh, 0)).toBe(true)
    expect(JSON.parse(JSON.stringify(cost))).toStrictEqual(cost)
  })
})

describe('invalid now fails loudly', () => {
  it('overrideApplies throws RangeError on an unparseable now, even for an unscoped override', () => {
    expect(() => overrideApplies({ prompt: '0.0000002' }, 'garbage', 0)).toThrow(RangeError)
    expect(() => overrideApplies({ prompt: '0.0000002' }, 'garbage', 0)).toThrow('Invalid time: now')
    expect(() => overrideApplies({ utc_days: ['friday'], prompt: '0.0000002' }, 'garbage', 0)).toThrow(RangeError)
  })

  it('resolvePricing throws RangeError when it has overrides to evaluate', () => {
    expect(() => resolvePricing(withOverrides([{ prompt: OVR }]), 'garbage', 0)).toThrow(RangeError)
  })
})

describe('Table P — synthetic overrides', () => {
  const p1 = withOverrides([{ utc_start: 100, utc_end: 400, utc_days: WEEKDAYS, prompt: OVR }])

  it('P1: weekday window, start inclusive, end exclusive, seconds ignored', () => {
    expectPrompt(p1, '2026-10-02T01:00:00Z', true)
    expectPrompt(p1, '2026-10-02T03:59:59Z', true)
    expectPrompt(p1, '2026-10-02T04:00:00Z', false)
    expectPrompt(p1, '2026-10-02T00:59:00Z', false)
  })

  it('P2: the weekday window does not apply on Saturday', () => {
    expectPrompt(p1, '2026-10-03T02:00:00Z', false)
  })

  it('P3: days without a window cover the whole listed days', () => {
    const p = withOverrides([{ utc_days: ['saturday', 'sunday'], prompt: OVR }])
    expectPrompt(p, '2026-10-03T00:00:00Z', true)
    expectPrompt(p, '2026-10-04T23:59:00Z', true)
    expectPrompt(p, '2026-10-02T12:00:00Z', false)
  })

  it('P4: a window with end <= start wraps midnight', () => {
    const p = withOverrides([{ utc_start: 2200, utc_end: 200, prompt: OVR }])
    expectPrompt(p, '2026-10-02T22:00:00Z', true)
    expectPrompt(p, '2026-10-02T23:30:00Z', true)
    expectPrompt(p, '2026-10-02T01:59:00Z', true)
    expectPrompt(p, '2026-10-02T02:00:00Z', false)
    expectPrompt(p, '2026-10-02T21:59:00Z', false)
  })

  it('P5: utc_end 0 means until midnight', () => {
    const p = withOverrides([{ utc_start: 1400, utc_end: 0, prompt: OVR }])
    expectPrompt(p, '2026-10-02T14:00:00Z', true)
    expectPrompt(p, '2026-10-02T23:59:00Z', true)
    expectPrompt(p, '2026-10-02T00:00:00Z', false)
    expectPrompt(p, '2026-10-02T13:59:00Z', false)
  })

  it('P6: start equal to end covers the whole day', () => {
    const p = withOverrides([{ utc_start: 0, utc_end: 0, prompt: OVR }])
    expectPrompt(p, '2026-10-02T00:00:00Z', true)
    expectPrompt(p, '2026-10-02T12:34:00Z', true)
  })

  it('P7: min_prompt_tokens applies only when prompt tokens strictly exceed it', () => {
    const p = withOverrides([{ min_prompt_tokens: 128000, prompt: OVR }])
    expectPrompt(p, '2026-10-02T12:00:00Z', false, 128000)
    expectPrompt(p, '2026-10-02T12:00:00Z', true, 128001)
  })

  it('P8: later applicable entries win per key', () => {
    const p = withOverrides([{ prompt: '0.0000003', completion: '0.0000009' }, { prompt: OVR }])
    const r = resolvePricing(p, '2026-10-02T12:00:00Z', 0)
    close(r.promptPerM, 0.2)
    close(r.completionPerM, 0.9)
    expect(r.overrideApplied).toBe(true)
  })

  it('P9: keys an override does not carry inherit the base', () => {
    const r = resolvePricing(withOverrides([{ prompt: OVR }]), '2026-10-02T12:00:00Z', 0)
    close(r.promptPerM, 0.2)
    close(r.completionPerM, 0.4)
    close(r.cacheReadPerM, 0.01)
    expect(r.cacheWritePerM).toBeNull()
  })

  it('P10: input_cache_write is resolved; absent stays null', () => {
    const r = resolvePricing(withOverrides([{ input_cache_write: '0.00000005' }]), '2026-10-02T12:00:00Z', 0)
    close(r.cacheWritePerM, 0.05)
    close(r.promptPerM, 0.1)
    expect(resolvePricing({ ...BASE }, '2026-10-02T12:00:00Z', 0).cacheWritePerM).toBeNull()
  })

  it('P11: day names compare case-insensitively; an unrecognised name never matches', () => {
    expectPrompt(withOverrides([{ utc_days: ['Saturday'], prompt: OVR }]), '2026-10-03T10:00:00Z', true)
    const caturday = withOverrides([{ utc_days: ['caturday'], prompt: OVR }])
    for (const day of ['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']) {
      expectPrompt(caturday, `${day}T10:00:00Z`, false)
    }
    expect(overrideApplies({ utc_days: [], prompt: OVR }, '2026-10-03T10:00:00Z', 0)).toBe(false)
  })

  it('P12: utc_days is tested against the UTC weekday of now, also after a wrap (C4)', () => {
    const p = withOverrides([{ utc_start: 2200, utc_end: 200, utc_days: ['friday'], prompt: OVR }])
    expectPrompt(p, '2026-10-02T23:00:00Z', true)
    expectPrompt(p, '2026-10-03T01:00:00Z', false)
  })

  it('P13: no overrides gives the base prices and overrideApplied false', () => {
    const r = resolvePricing({ ...BASE }, '2026-10-02T12:00:00Z', 0)
    close(r.promptPerM, 0.1)
    close(r.completionPerM, 0.4)
    close(r.cacheReadPerM, 0.01)
    expect(r.cacheWritePerM).toBeNull()
    expect(r.overrideApplied).toBe(false)
  })

  it('a non-applying override leaves overrideApplied false; a window with only utc_start runs to midnight', () => {
    const r = resolvePricing(withOverrides([{ utc_start: 100, utc_end: 400, prompt: OVR }]), '2026-10-02T12:00:00Z', 0)
    expect(r.overrideApplied).toBe(false)
    const onlyStart = withOverrides([{ utc_start: 1800, prompt: OVR }])
    expectPrompt(onlyStart, '2026-10-02T18:00:00Z', true)
    expectPrompt(onlyStart, '2026-10-02T17:59:00Z', false)
  })
})

describe('Table D — real schedules from the fixture', () => {
  const TOKENS = ROUTING_PROFILES.interactive.typicalPromptTokens

  const cases: { tag: string; now: string; prices: [number, number, number]; applied: boolean }[] = [
    { tag: 'deepseek', now: '2026-10-02T02:00:00Z', prices: [0.3, 1.2, 0.006], applied: true },
    { tag: 'deepseek', now: '2026-10-02T04:30:00Z', prices: [0.15, 0.6, 0.003], applied: true },
    { tag: 'deepseek', now: '2026-10-03T02:00:00Z', prices: [0.15, 0.6, 0.003], applied: true },
    { tag: 'deepseek', now: '2026-10-03T12:00:00Z', prices: [0.15, 0.6, 0.003], applied: true },
    { tag: 'deepseek', now: '2026-10-02T09:20:00Z', prices: [0.3, 1.2, 0.006], applied: true },
    { tag: 'alibaba', now: '2026-10-02T09:20:00Z', prices: [0.3, 1.2, 0.03], applied: true },
    { tag: 'alibaba', now: '2026-10-02T15:00:00Z', prices: [0.15, 0.6, 0.015], applied: true },
    { tag: 'deepinfra/fp8', now: '2026-10-02T09:20:00Z', prices: [0.14, 0.42, 0.0042], applied: false },
    { tag: 'deepinfra/fp8', now: '2026-10-03T03:00:00Z', prices: [0.14, 0.42, 0.0042], applied: false }
  ]

  it.each(cases)('$tag at $now', ({ tag, now, prices, applied }) => {
    const rows = pricingOf(tag)
    expect(rows).toHaveLength(1)
    const r = resolvePricing(rows[0], now, TOKENS)
    close(r.promptPerM, prices[0], 'prompt')
    close(r.completionPerM, prices[1], 'completion')
    close(r.cacheReadPerM, prices[2], 'cache read')
    expect(r.overrideApplied).toBe(applied)
  })
})

describe('Table B — blended cost', () => {
  const NOW = '2026-10-02T09:20:00Z'
  const interactive = ROUTING_PROFILES.interactive
  const pricesFor = (tag: string): CollapsedPricing =>
    collapsePricing(pricingOf(tag).map((p) => resolvePricing(p, NOW, interactive.typicalPromptTokens)))

  it('B1: deepinfra/fp8 with a verified cache earns the cache credit', () => {
    const cost = blendedCost(pricesFor('deepinfra/fp8'), interactive.tokenShares, fixture.cacheVerified['deepinfra/fp8'] === true)
    expect(cost).not.toBeNull()
    if (!cost) return
    close(cost.blended, 0.0165144, 'blended')
    close(cost.fresh, 0.00798, 'fresh')
    close(cost.cached, 0.0039144, 'cached')
    close(cost.output, 0.00462, 'output')
    expect(cost.cacheCredit).toBe(true)
    expect(cost.overrideApplied).toBe(false)
    close(cost.promptPerM, 0.14)
    close(cost.completionPerM, 0.42)
    close(cost.cacheReadPerM, 0.0042)
  })

  it('B2: deepinfra/fp8 without verification prices the cached share at the prompt price', () => {
    const cost = blendedCost(pricesFor('deepinfra/fp8'), interactive.tokenShares, false)
    close(cost?.blended, 0.14308, 'blended')
    expect(cost?.cacheCredit).toBe(false)
    close(cost?.cacheReadPerM, 0.0042, 'cacheReadPerM still reports the cache price')
  })

  it('B3: baidu/fp8, whose cache is recorded as not verified', () => {
    expect(fixture.cacheVerified['baidu/fp8']).toBe(false)
    const cost = blendedCost(pricesFor('baidu/fp8'), interactive.tokenShares, fixture.cacheVerified['baidu/fp8'] === true)
    close(cost?.blended, 0.30959, 'blended')
    expect(cost?.cacheCredit).toBe(false)
  })

  it('B4: a row without input_cache_read, verified, prices the cached share at the prompt price', () => {
    const resolved = resolvePricing({ prompt: '0.0000001', completion: '0.0000004' }, NOW, 0)
    expect(resolved.cacheReadPerM).toBeNull()
    const prices = collapsePricing([resolved])
    close(prices.cachePricePerM, 0.1)
    const cost = blendedCost(prices, interactive.tokenShares, true)
    close(cost?.cached, 0.932 * 0.1, 'cached')
    close(cost?.blended, 0.057 * 0.1 + 0.932 * 0.1 + 0.011 * 0.4, 'blended')
    expect(cost?.cacheCredit).toBe(true)
    close(cost?.cacheReadPerM, 0.1)
  })

  it('B5: the two baseten/fp8 rows collapse to the prices of a single row', () => {
    const rows = pricingOf('baseten/fp8')
    expect(rows).toHaveLength(2)
    const resolved = rows.map((p) => resolvePricing(p, NOW, interactive.typicalPromptTokens))
    expect(collapsePricing(resolved)).toEqual(collapsePricing([resolved[0]]))
    expect(collapsePricing(resolved)).toEqual(collapsePricing([resolved[1]]))
  })

  it('collapsePricing takes the maximum of each price and ORs overrideApplied', () => {
    const a: ResolvedPricing = { promptPerM: 0.1, completionPerM: 0.5, cacheReadPerM: 0.02, cacheWritePerM: null, overrideApplied: false }
    const b: ResolvedPricing = { promptPerM: 0.2, completionPerM: 0.4, cacheReadPerM: null, cacheWritePerM: null, overrideApplied: true }
    expect(collapsePricing([a, b])).toEqual({ promptPerM: 0.2, completionPerM: 0.5, cachePricePerM: 0.2, overrideApplied: true })
    expect(collapsePricing([b, a])).toEqual(collapsePricing([a, b]))
  })

  it('B6: a negative price or an all-zero price gives null (C5)', () => {
    const negative = collapsePricing([resolvePricing({ prompt: '-1', completion: '0.0000004', input_cache_read: '0.00000001' }, NOW, 0)])
    expect(blendedCost(negative, interactive.tokenShares, true)).toBeNull()
    expect(blendedCost({ promptPerM: -1, completionPerM: 0.4, cachePricePerM: 0.01, overrideApplied: false }, interactive.tokenShares, false)).toBeNull()
    const zero = collapsePricing([resolvePricing({ prompt: '0', completion: '0', input_cache_read: '0' }, NOW, 0)])
    expect(blendedCost(zero, interactive.tokenShares, true)).toBeNull()
    expect(blendedCost(zero, interactive.tokenShares, false)).toBeNull()
    expect(blendedCost(collapsePricing([]), interactive.tokenShares, false)).toBeNull()
    expect(blendedCost({ promptPerM: Number.NaN, completionPerM: 0.4, cachePricePerM: 0.01, overrideApplied: false }, interactive.tokenShares, false)).toBeNull()
  })

  it('results are plain JSON (K2)', () => {
    const cost = blendedCost(pricesFor('deepinfra/fp8'), interactive.tokenShares, true)
    expect(JSON.parse(JSON.stringify(cost))).toStrictEqual(cost)
  })
})
