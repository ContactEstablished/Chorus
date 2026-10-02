import { describe, expect, it } from 'vitest'

import { DEFAULT_ROUTING_SETTINGS, type CandidateExplanation, type Quantization, type RoutingSettings } from '../../shared/routing'
import { buildNitroSelection, buildRankedProvider, quantizationsFor } from './payloadCore'

/** Model Routing Task 1-3, Table Y (ImplementationSpec-1-3). */

const DENY: RoutingSettings = DEFAULT_ROUTING_SETTINGS
const ALLOW: RoutingSettings = { ...DEFAULT_ROUTING_SETTINGS, dataCollection: 'allow' }
const SLUG = 'deepseek/deepseek-v4.1-flash'
const RANKED_KEYS = ['order', 'allow_fallbacks', 'require_parameters', 'quantizations', 'data_collection']
const FORBIDDEN = ['sort', 'ignore', 'only', 'max_price']

/** An eligible explanation record; tests name only the fields they mean. */
function explained(tag: string, rowQuantizations: Quantization[], over: Partial<CandidateExplanation> = {}): CandidateExplanation {
  const quantization: Quantization = rowQuantizations.length === 1 ? rowQuantizations[0] : 'unknown'
  return {
    tag,
    providerName: 'Provider',
    rows: rowQuantizations.length,
    quantization,
    rowQuantizations,
    effectiveQuantization: quantization,
    uptime1d: 99.9,
    uptime5m: 99.9,
    status: 0,
    observations: 1,
    limitedHistory: true,
    tpsP50: 100,
    latencyP50S: 0.5,
    tpsP90: 150,
    latencyP90S: 0.9,
    effectiveTps: 85.7142857,
    cost: {
      blended: 0.01942,
      fresh: 0.0057,
      cached: 0.00932,
      output: 0.0044,
      cacheCredit: true,
      overrideApplied: false,
      promptPerM: 0.1,
      completionPerM: 0.4,
      cacheReadPerM: 0.01
    },
    excludedBy: [],
    budgetFloorExcluded: false,
    scores: {},
    ...over
  }
}

const A = explained('a/fp8', ['fp8'])
const B = explained('b/fp8', ['fp8'])
const C = explained('c/fp32', ['fp32'])
/** An admitted first-party candidate that declares no quantization: OpenRouter sees `unknown`. */
const FIRST_PARTY = explained('deepseek', ['unknown'], { providerName: 'DeepSeek', effectiveQuantization: 'fp8' })
const MIXED = explained('mixed/fp8', ['fp8', 'fp16'])

/** Every key at any depth of a JSON value. */
function keysDeep(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysDeep)
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([k, v]) => [k, ...keysDeep(v)])
  }
  return []
}

function expectNoForbiddenKeys(value: unknown): void {
  for (const key of keysDeep(value)) {
    expect(FORBIDDEN.includes(key) || key.startsWith('preferred_'), key).toBe(false)
  }
}

describe('Table Y — quantizationsFor (K12, C8)', () => {
  it('Y1: rows fp8, fp8, fp32 give the distinct union in QUANTIZATIONS order', () => {
    expect(quantizationsFor([A, B, C])).toEqual(['fp8', 'fp32'])
    expect(quantizationsFor([C, B, A])).toEqual(['fp8', 'fp32'])
  })

  it('Y2: an admitted first-party unknown adds its declared unknown, never its effective fp8', () => {
    expect(quantizationsFor([A, B, C, FIRST_PARTY])).toEqual(['fp8', 'fp32', 'unknown'])
    expect(quantizationsFor([FIRST_PARTY, C, A])).toEqual(['fp8', 'fp32', 'unknown'])
    expect(quantizationsFor([FIRST_PARTY])).toEqual(['unknown'])
  })

  it('Y3: a mixed tag contributes every declared row value', () => {
    expect(quantizationsFor([MIXED])).toEqual(['fp8', 'fp16'])
    expect(quantizationsFor([C, MIXED, A])).toEqual(['fp8', 'fp16', 'fp32'])
  })

  it('returns a fresh array and an empty one for no selection', () => {
    expect(quantizationsFor([])).toEqual([])
    expect(quantizationsFor([A])).not.toBe(A.rowQuantizations)
  })
})

describe('Table Y — buildRankedProvider (MR-D5, MR-D11)', () => {
  it("Y4: 'deny' gives keys in exactly the contract order and the full payload", () => {
    const provider = buildRankedProvider([B, A, C], DENY)
    expect(Object.keys(provider)).toEqual(RANKED_KEYS)
    expect(provider).toStrictEqual({
      order: ['b/fp8', 'a/fp8', 'c/fp32'],
      allow_fallbacks: false,
      require_parameters: true,
      quantizations: ['fp8', 'fp32'],
      data_collection: 'deny'
    })
    expectNoForbiddenKeys(provider)
  })

  it("Y5: 'allow' omits the data_collection key (absent, not undefined)", () => {
    const provider = buildRankedProvider([A, FIRST_PARTY], ALLOW)
    expect('data_collection' in provider).toBe(false)
    expect(Object.keys(provider)).toEqual(RANKED_KEYS.slice(0, 4))
    expect(provider).toStrictEqual({
      order: ['a/fp8', 'deepseek'],
      allow_fallbacks: false,
      require_parameters: true,
      quantizations: ['fp8', 'unknown']
    })
    expect(JSON.stringify(provider)).not.toContain('data_collection')
    expectNoForbiddenKeys(provider)
  })

  it('order carries tags, never provider display names', () => {
    const provider = buildRankedProvider([FIRST_PARTY, A], DENY)
    expect(provider.order).toEqual(['deepseek', 'a/fp8'])
    expect(provider.order).not.toContain('DeepSeek')
  })
})

describe('Table Y — buildNitroSelection (MR-D4, MR-D11)', () => {
  const likely = { tag: 'together', providerName: 'Together', tpsP50: 223 }
  const rules = ['quantization not declared']

  it("Y6: 'deny' sends { data_collection: 'deny' } with the :nitro slug", () => {
    const nitro = buildNitroSelection(SLUG, likely, rules, DENY)
    expect(Object.keys(nitro)).toEqual(['model', 'provider', 'likely', 'likelyFailsRules'])
    expect(nitro).toStrictEqual({
      model: 'deepseek/deepseek-v4.1-flash:nitro',
      provider: { data_collection: 'deny' },
      likely: { tag: 'together', providerName: 'Together', tpsP50: 223 },
      likelyFailsRules: ['quantization not declared']
    })
    expect(nitro.model.endsWith(':nitro')).toBe(true)
    expectNoForbiddenKeys(nitro)
  })

  it("Y6: 'allow' sends no provider object", () => {
    const nitro = buildNitroSelection(SLUG, likely, rules, ALLOW)
    expect(nitro.provider).toBeNull()
    expect(nitro.model).toBe(`${SLUG}:nitro`)
    expect(nitro.likely).toStrictEqual(likely)
    expect(nitro.likelyFailsRules).toStrictEqual(rules)
  })

  it('copies likely and the failed rules unchanged; null likely stays null', () => {
    const nitro = buildNitroSelection(SLUG, likely, rules, DENY)
    expect(nitro.likely).not.toBe(likely)
    expect(nitro.likelyFailsRules).not.toBe(rules)
    expect(Object.keys(nitro.likely ?? {})).toEqual(['tag', 'providerName', 'tpsP50'])
    expect(buildNitroSelection(SLUG, null, [], DENY)).toStrictEqual({
      model: `${SLUG}:nitro`,
      provider: { data_collection: 'deny' },
      likely: null,
      likelyFailsRules: []
    })
  })
})
