import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_ROUTING_SETTINGS,
  type ModelRegistryEntry,
  type RankInput,
  type RoutingCredential,
  type RoutingObservationSettings,
  type RoutingProgressEvent,
  type RoutingSettings,
  type RoutingStatus,
  type TierResult
} from './routing'
import {
  NITRO_CAVEATS,
  NITRO_CARD_LABEL,
  ROUTING_INSPECTOR_EFFORT,
  ROUTING_NO_CREDENTIAL_HINT,
  ROUTING_PREVIEW_NOTE,
  ROUTING_PROFILE_LABELS,
  ROUTING_REFRESH_COST_TEXT,
  ROUTING_TIER_LABELS,
  cooldownRemainingSeconds,
  credentialOptionLabel,
  defaultRefreshCredential,
  formatAgo,
  formatPerMillion,
  formatSeconds,
  formatTps,
  formatUptime,
  formatUsd,
  nitroCardView,
  observationView,
  providerTableView,
  refreshButtonView,
  refreshProgressView,
  resultNotes,
  snapshotAgeView,
  tierCardViews,
  type EndpointSummaryView,
  type RefreshPhase
} from './routingView'
import { truncatePct } from '../main/routing/eligibilityCore'
import { extractObservations, parseEndpointsResponse } from '../main/routing/endpointsCore'
import { bundledModelRegistry, findModel } from '../main/routing/registryCore'
import { computeTiers } from '../main/routing/routingCore'

/**
 * Model Routing Task 3-2, Table RV (ImplementationSpec-3-2). Every expected
 * string below is written by hand from the specification's tables; none is
 * computed with the view model. The TierResults come from the real Phase 1
 * cores over the golden input (as routingIpc.test.ts builds it).
 */

// ── Golden inputs ──
type Fixture = {
  fetchedAt: string
  guardrailRemoved: string[]
  dataPolicyDenyRemoved: string[]
  cacheVerified: Record<string, boolean>
  data: { endpoints: { tag: string; quantization?: string | null }[] }
}
const fixture = JSON.parse(
  readFileSync(new URL('../main/routing/__fixtures__/endpoints-deepseek-v4.1-flash-2026-10-02.json', import.meta.url), 'utf8')
) as Fixture

const SLUG = 'deepseek/deepseek-v4.1-flash'
const MODEL = findModel(bundledModelRegistry(), SLUG) as ModelRegistryEntry
const CHECKED_AT = '2026-10-02T09:15:39Z'
const NOW = '2026-10-02T09:20:00Z'
const NOW_MS = Date.parse(NOW)

function snapshotOf(json: Fixture): RankInput['snapshot'] {
  return { fetchedAt: json.fetchedAt, endpoints: parseEndpointsResponse(json).endpoints }
}
const SNAPSHOT = snapshotOf(fixture)
const CACHE = Object.fromEntries(Object.entries(fixture.cacheVerified).map(([tag, verified]) => [tag, { verified, checkedAt: CHECKED_AT }]))

function tiersFor(over: Partial<RankInput> = {}): TierResult {
  const snapshot = over.snapshot ?? SNAPSHOT
  return computeTiers({
    model: MODEL,
    snapshot,
    history: extractObservations(snapshot),
    account: { guardrailRemoved: fixture.guardrailRemoved, dataPolicyRemoved: fixture.dataPolicyDenyRemoved, checkedAt: CHECKED_AT },
    cache: CACHE,
    profile: 'interactive',
    effort: 'low',
    settings: DEFAULT_ROUTING_SETTINGS,
    now: NOW,
    ...over
  })
}

const S_EMPTY: RoutingSettings = { ...DEFAULT_ROUTING_SETTINGS, minUptimePct: 100, readmitUptimePct: 100 }
const S_FLOOR130: RoutingSettings = { ...DEFAULT_ROUTING_SETTINGS, budgetMinTps: 130 }
const S_FLOOR1000: RoutingSettings = { ...DEFAULT_ROUTING_SETTINGS, budgetMinTps: 1000 }

const golden = tiersFor()
const helper = tiersFor({ profile: 'helper' })
const unknown = tiersFor({ account: { guardrailRemoved: null, dataPolicyRemoved: null, checkedAt: null }, cache: {} })
const stale = tiersFor({ now: '2026-10-02T10:06:00Z' })
const empty = tiersFor({ settings: S_EMPTY })
const floor130 = tiersFor({ settings: S_FLOOR130 })
const floor1000 = tiersFor({ settings: S_FLOOR1000 })
const nitroPass = (() => {
  const json = structuredClone(fixture)
  const row = json.data.endpoints.find((e) => e.tag === 'together')
  if (row === undefined) throw new Error('fixture has no together row')
  row.quantization = 'fp8'
  return tiersFor({ snapshot: snapshotOf(json) })
})()
const oneBalanced = (() => {
  const r = structuredClone(golden)
  if (r.tiers.balanced === null) throw new Error('golden has no Balanced tier')
  r.tiers.balanced.endpoints = ['deepinfra/fp8']
  r.tiers.balanced.limitedFallbacks = true
  return r
})()
const noLikely = (() => {
  const r = structuredClone(golden)
  r.nitro.likely = null
  r.nitro.likelyFailsRules = []
  return r
})()

const LIMITED_14 = 'Limited history: 14 of 14 eligible endpoints have fewer than 3 speed observations.'
const W2 = 'Account guardrails were not checked; a pinned endpoint may be refused.'
const W3 = 'Data-policy removals were not checked.'

const DEEPINFRA: EndpointSummaryView = {
  tag: 'deepinfra/fp8',
  providerName: 'DeepInfra',
  quantization: 'fp8',
  priceText: '$0.0165/M blended',
  speedText: '63 tok/s',
  effectiveText: '48.5 effective tok/s',
  latencyText: '1.43 s',
  uptimeText: '99.96% uptime',
  cacheVerified: true,
  timeOfDayPrice: false
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.keys(value as object)) deepFreeze((value as Record<string, unknown>)[key])
  }
  return value
}

describe('Table RV — formatters', () => {
  it('RV1: formatUsd (C5)', () => {
    const cases: [number, string][] = [
      [0, '$0.00'], [0.00004, '<$0.0001'], [0.0001, '$0.0001'], [0.0028, '$0.0028'], [0.0045, '$0.0045'],
      [0.0049, '$0.0049'], [0.02, '$0.02'], [0.021, '$0.021'], [0.0493873956, '$0.0494'], [0.05, '$0.05'],
      [0.1, '$0.10'], [0.002497428, '$0.0025'], [0.017288676, '$0.0173'], [1.234, '$1.23'], [-1, '—'], [Number.NaN, '—']
    ]
    for (const [value, text] of cases) expect(formatUsd(value), String(value)).toBe(text)
  })

  it('RV2: formatPerMillion: three significant figures, never exponent notation', () => {
    const cases: [number, string][] = [
      [0, '$0/M'], [0.0165144, '$0.0165/M'], [0.30959010000000003, '$0.310/M'], [0.14, '$0.140/M'],
      [0.004200000000000001, '$0.00420/M'], [1.2, '$1.20/M'], [0.0000005, '<$0.000001/M'],
      [0.0021149999999999997, '$0.00211/M'], [Number.NaN, '—']
    ]
    for (const [value, text] of cases) {
      expect(formatPerMillion(value), String(value)).toBe(text)
      expect(formatPerMillion(value)).not.toContain('e')
    }
  })

  it('RV3: formatTps, formatSeconds, formatUptime; uptime truncates like truncatePct for all 32 golden candidates', () => {
    expect([null, 63, 48.462097639588144, 119.90871465593936, 45.25, 223].map(formatTps)).toEqual([
      '—', '63 tok/s', '48.5 tok/s', '119.9 tok/s', '45.3 tok/s', '223 tok/s'
    ])
    expect([null, 1.4285, 0.297, 2.52].map(formatSeconds)).toEqual(['—', '1.43 s', '0.30 s', '2.52 s'])
    expect([null, 99.96103059189728, 99.4951480572302, 99.6, 100, 97.18112731773334].map(formatUptime)).toEqual([
      '—', '99.96%', '99.49%', '99.60%', '100.00%', '97.18%'
    ])
    expect(golden.candidates).toHaveLength(32)
    for (const c of golden.candidates) {
      expect(c.uptime1d, c.tag).not.toBeNull()
      expect(formatUptime(c.uptime1d), c.tag).toBe(truncatePct(c.uptime1d as number, 2) + '%')
    }
  })

  it('formatAgo thresholds', () => {
    expect(formatAgo(-5000)).toBe('just now')
    expect(formatAgo(59_999)).toBe('just now')
    expect(formatAgo(60_000)).toBe('1 min ago')
    expect(formatAgo(119 * 60_000)).toBe('119 min ago')
    expect(formatAgo(120 * 60_000)).toBe('2 h ago')
    expect(formatAgo(2879 * 60_000)).toBe('47 h ago')
    expect(formatAgo(2880 * 60_000)).toBe('2 days ago')
  })
})

describe('Table RV — views', () => {
  it('RV4: snapshotAgeView mirrors routingCore (floored minutes; stale strictly beyond the limit; clock behind is 0)', () => {
    const view = (t: string): unknown => {
      const v = snapshotAgeView('2026-10-02T09:05:00Z', Date.parse(t), 60)
      return { minutes: v.minutes, stale: v.stale, text: v.text, staleText: v.staleText }
    }
    const STALE_TEXT = 'Older than 60 min. Refresh before relying on these numbers.'
    expect(view('2026-10-02T09:20:00Z')).toStrictEqual({ minutes: 15, stale: false, text: 'Updated 15 min ago', staleText: null })
    expect(view('2026-10-02T10:05:00Z')).toStrictEqual({ minutes: 60, stale: false, text: 'Updated 60 min ago', staleText: null })
    expect(view('2026-10-02T10:05:00.001Z')).toStrictEqual({ minutes: 60, stale: true, text: 'Updated 60 min ago', staleText: STALE_TEXT })
    expect(view('2026-10-02T11:05:00Z')).toStrictEqual({ minutes: 120, stale: true, text: 'Updated 2 h ago', staleText: STALE_TEXT })
    expect(view('2026-10-04T09:05:00Z')).toStrictEqual({ minutes: 2880, stale: true, text: 'Updated 2 days ago', staleText: STALE_TEXT })
    expect(view('2026-10-02T09:05:59.999Z')).toStrictEqual({ minutes: 0, stale: false, text: 'Updated just now', staleText: null })
    expect(view('2026-10-02T09:00:00Z')).toStrictEqual({ minutes: 0, stale: false, text: 'Updated just now', staleText: null })
  })

  it('RV5: golden cards, from numbers, never from rationale', () => {
    const [budget, balanced, fast] = tierCardViews(golden, DEFAULT_ROUTING_SETTINGS)
    expect(budget).toStrictEqual({
      tier: 'budget',
      label: 'Budget',
      state: 'ranked',
      primary: DEEPINFRA,
      fallbacks: ['streamlake/fp8', 'gmicloud/fp8'],
      fallbackText: 'Fallbacks: streamlake/fp8, gmicloud/fp8',
      reason: 'First of 12 endpoints at or above the 45.3 tok/s Budget floor, scored mostly on price.',
      limitedHistory: true,
      notes: []
    })
    expect(balanced).toMatchObject({ tier: 'balanced', label: 'Balanced', state: 'ranked', notes: [] })
    expect(balanced.primary).toStrictEqual(DEEPINFRA)
    expect(balanced.fallbackText).toBe('Fallbacks: streamlake/fp8, makora/fp8')
    expect(balanced.reason).toBe('First of 14 eligible endpoints, scored equally on price and speed.')
    expect(fast).toMatchObject({ tier: 'fast', label: 'Fast', state: 'ranked', notes: [] })
    expect(fast.primary).toMatchObject({
      tag: 'venice/fp8',
      priceText: '$0.0449/M blended',
      speedText: '186 tok/s',
      effectiveText: '119.9 effective tok/s',
      latencyText: '0.89 s',
      uptimeText: '99.83% uptime',
      cacheVerified: true
    })
    expect(fast.fallbackText).toBe('Fallbacks: baidu/fp8, parasail/fp8')
    expect(fast.reason).toBe('First of 14 eligible endpoints, scored on speed only.')

    const text = JSON.stringify([budget, balanced, fast])
    expect(text).not.toContain('effective tok/s, $')
    for (const sel of Object.values(golden.tiers)) {
      expect(sel).not.toBeNull()
      expect(text).not.toContain(sel?.rationale)
    }
  })

  it('RV6: helper', () => {
    const cards = tierCardViews(helper, DEFAULT_ROUTING_SETTINGS)
    expect(cards.map((c) => c.primary?.tag)).toEqual(['streamlake/fp8', 'streamlake/fp8', 'venice/fp8'])
    expect(cards.map((c) => c.fallbackText)).toEqual([
      'Fallbacks: deepinfra/fp8, gmicloud/fp8',
      'Fallbacks: venice/fp8, gmicloud/fp8',
      'Fallbacks: baidu/fp8, parasail/fp8'
    ])
    expect(cards.map((c) => c.reason)).toEqual([
      'First of 12 endpoints at or above the 45.3 tok/s Budget floor, scored mostly on price.',
      'First of 14 eligible endpoints, scored equally on price and speed.',
      'First of 14 eligible endpoints, scored on speed only.'
    ])
  })

  it('RV7: no snapshot', () => {
    const cards = tierCardViews(null, DEFAULT_ROUTING_SETTINGS)
    expect(cards.map((c) => [c.tier, c.label])).toEqual([['budget', 'Budget'], ['balanced', 'Balanced'], ['fast', 'Fast']])
    for (const card of cards) {
      expect(card).toMatchObject({
        state: 'no-snapshot',
        reason: 'No endpoint numbers for this model yet. Refresh to rank it.',
        primary: null,
        fallbacks: [],
        fallbackText: '',
        limitedHistory: false,
        notes: []
      })
    }
  })

  it('RV8: nothing eligible', () => {
    const cards = tierCardViews(empty, S_EMPTY)
    expect(cards.map((card) => card.tier)).toEqual(['budget', 'balanced', 'fast'])
    for (const card of cards) {
      expect(card).toMatchObject({ state: 'empty', reason: 'No provider meets the uptime and precision rules right now.', primary: null, notes: [] })
    }
    expect(resultNotes(empty)).toEqual(['Budget: no eligible endpoints.', 'Balanced: no eligible endpoints.', 'Fast: no eligible endpoints.'])
    const nitro = nitroCardView(empty, SLUG)
    expect(nitro.state).toBe('likely')
    expect(nitro.warning).toBe('Likely provider: Together (together), uptime 99.96% < 100%, quantization not declared.')
  })

  it('RV9: the Budget floor shortens and then empties Budget', () => {
    const [b130] = tierCardViews(floor130, S_FLOOR130)
    expect(b130).toMatchObject({
      state: 'ranked',
      fallbacks: ['baidu/fp8'],
      fallbackText: 'Fallbacks: baidu/fp8',
      reason: 'First of 2 endpoints at or above the 130 tok/s Budget floor, scored mostly on price.',
      notes: ['12 eligible endpoints are below the 130 tok/s Budget floor.']
    })
    expect(b130.primary?.tag).toBe('venice/fp8')
    expect(resultNotes(floor130)).toEqual(['Budget: only 2 eligible endpoints; limited fallbacks.', LIMITED_14])

    const [b1000, bal1000, fast1000] = tierCardViews(floor1000, S_FLOOR1000)
    expect(b1000).toMatchObject({
      state: 'empty',
      primary: null,
      reason: 'All 14 eligible endpoints are below the 1000 tok/s Budget floor.',
      notes: []
    })
    expect(bal1000.state).toBe('ranked')
    expect(fast1000.state).toBe('ranked')
    expect(resultNotes(floor1000)).toEqual(['Budget: no eligible endpoints.', LIMITED_14])
  })

  it('RV10: a tier with no fallback', () => {
    const balanced = tierCardViews(oneBalanced, DEFAULT_ROUTING_SETTINGS)[1]
    expect(balanced).toMatchObject({ state: 'ranked', fallbacks: [], fallbackText: 'No fallback available.', notes: [] })
  })

  it('RV11: Nitro', () => {
    expect(nitroCardView(golden, SLUG)).toStrictEqual({
      label: 'Nitro — unfiltered provider routing',
      model: 'deepseek/deepseek-v4.1-flash:nitro',
      state: 'likely',
      likely: { tag: 'together', providerName: 'Together', speedText: '223 tok/s' },
      warning: 'Likely provider: Together (together), quantization not declared.',
      failsRules: ['quantization not declared'],
      caveats: [
        'An estimate: OpenRouter chooses the endpoint for each request, so actual routing may differ.',
        "Requests may be billed at a provider's priority-tier price.",
        "Your account's guardrails still apply."
      ]
    })
    expect(nitroCardView(golden, SLUG).caveats).toEqual(NITRO_CAVEATS)
    expect(nitroCardView(nitroPass, SLUG)).toMatchObject({
      state: 'likely',
      warning: 'Unfiltered, but the likely provider currently passes the uptime and precision rules.',
      failsRules: []
    })
    expect(nitroCardView(null, SLUG)).toMatchObject({
      label: NITRO_CARD_LABEL,
      state: 'no-snapshot',
      model: 'deepseek/deepseek-v4.1-flash:nitro',
      likely: null,
      failsRules: [],
      warning: 'Unfiltered: OpenRouter picks the provider. Refresh to see which one is likely.'
    })
    expect(nitroCardView(noLikely, SLUG)).toMatchObject({
      state: 'no-likely',
      model: 'deepseek/deepseek-v4.1-flash:nitro',
      likely: null,
      warning: 'No endpoint in the snapshot passes the capability filters, so the likely provider is unknown.'
    })
  })

  it('RV12: notes are the warnings verbatim, W1 dropped only when stale', () => {
    expect(resultNotes(golden)).toEqual([LIMITED_14])
    expect(resultNotes(unknown)).toEqual([W2, W3, LIMITED_14])
    expect(stale.warnings).toEqual(['Snapshot is 61 minutes old (limit 60); refresh before launching.', LIMITED_14])
    expect(resultNotes(stale)).toEqual([LIMITED_14])
  })

  it('RV13: the all-providers table', () => {
    const table = providerTableView(golden)
    expect(table).toMatchObject({
      eligible: 14,
      excluded: 18,
      showText: 'Show all providers (14 eligible · 18 excluded)',
      hideText: 'Hide providers'
    })
    expect(table.rows.map((r) => r.tag)).toEqual([
      'atlas-cloud/fp8', 'baidu/fp8', 'baseten/fast', 'baseten/fp8', 'deepinfra/fp8', 'gmicloud/fp8', 'makora/fp8',
      'morph/fp8', 'nextbit/fp8', 'novita/fp8', 'parasail/fp8', 'siliconflow/fp8', 'streamlake/fp8', 'venice/fp8',
      'alibaba', 'coreweave/fp8', 'decart/fp4', 'deepseek', 'dekallm', 'digitalocean', 'fireworks', 'fireworks/us',
      'inference-net', 'io-net/fp8', 'ionstream', 'modal', 'open-inference/fp4', 'phala', 'relace', 'sail-research/fp4',
      'together', 'wafer'
    ])
    expect(table.rows.slice(0, 14).every((r) => r.eligible)).toBe(true)
    expect(table.rows.slice(14).every((r) => !r.eligible)).toBe(true)
    const row = (tag: string): (typeof table.rows)[number] => {
      const r = table.rows.find((x) => x.tag === tag)
      if (r === undefined) throw new Error(`no row ${tag}`)
      return r
    }
    expect(row('deepinfra/fp8')).toMatchObject({
      rowsText: null,
      uptimeText: '99.96%',
      inputText: '$0.140/M',
      outputText: '$0.420/M',
      cacheReadText: '$0.00420/M',
      blendedText: '$0.0165/M',
      speedText: '63 tok/s',
      latencyText: '1.43 s',
      statusText: 'Eligible',
      cacheVerified: true
    })
    expect(row('baseten/fp8')).toMatchObject({
      rowsText: '2 endpoints',
      inputText: '$0.300/M',
      outputText: '$1.20/M',
      cacheReadText: '$0.00700/M',
      blendedText: '$0.0368/M',
      speedText: '62 tok/s',
      latencyText: '0.30 s',
      statusText: 'Eligible'
    })
    expect(row('baseten/fast')).toMatchObject({
      quantization: 'fp32',
      blendedText: '$0.191/M',
      speedText: '31 tok/s',
      statusText: 'Eligible · below the Budget floor'
    })
    expect(row('morph/fp8')).toMatchObject({ speedText: '17 tok/s', statusText: 'Eligible · below the Budget floor' })
    expect(row('alibaba')).toMatchObject({
      uptimeText: '97.18%',
      blendedText: '$0.310/M',
      latencyText: '6.94 s',
      statusText: 'Excluded: uptime 97.18% < 99.5%; currently degraded (5m uptime 92.3%); status -2; quantization not declared',
      timeOfDayPrice: true
    })
    expect(row('deepseek')).toMatchObject({
      quantization: 'unknown (as fp8)',
      statusText: 'Excluded: uptime 99.34% < 99.5%; removed by account guardrail; removed by data policy'
    })
    expect(row('together')).toMatchObject({ speedText: '223 tok/s', statusText: 'Excluded: quantization not declared', cacheVerified: true })
    expect(row('decart/fp4')).toMatchObject({
      inputText: '$0.0900/M',
      outputText: '$0.180/M',
      cacheReadText: '$0.0180/M',
      blendedText: '$0.0910/M',
      statusText: 'Excluded: fp4 below native fp8'
    })
  })
})

// ── Table RV14 — progress fixtures ──
const R1 = '11111111-1111-4111-8111-111111111111'
const AT = '2026-10-02T09:20:00Z'
const base = { refreshId: R1, model: SLUG, at: AT }
/** routingService.test.ts Q1_ORDER: the golden plan's probe order. */
const Q1_ORDER = [
  'atlas-cloud/fp8', 'morph/fp8', 'makora/fp8', 'streamlake/fp8', 'deepinfra/fp8', 'venice/fp8', 'gmicloud/fp8',
  'baidu/fp8', 'parasail/fp8', 'nextbit/fp8', 'novita/fp8', 'baseten/fp8', 'siliconflow/fp8', 'baseten/fast'
]
const outcome = (removed: string[] | null): Extract<RoutingProgressEvent, { stage: 'preflight' }>['guardrails'] => ({
  attempted: true, removed, issue: null, failure: null
})
const E_ENDPOINTS: RoutingProgressEvent = { ...base, stage: 'endpoints', fetchedAt: '2026-10-02T09:20:00Z', endpointRows: 33, tags: 32, rejectedRows: 0 }
const E_PREFLIGHT: RoutingProgressEvent = { ...base, stage: 'preflight', checkedAt: AT, guardrails: outcome(['deepseek']), dataPolicy: outcome(['deepseek']) }
// The per-tag estimates are not read by the view; only `planned.length` and the totals are.
const E_PLAN: RoutingProgressEvent = {
  ...base, stage: 'probe-plan', planned: Q1_ORDER.map((tag) => ({ tag, estimateUsd: 0.0035 })),
  estimateUsd: 0.0493873956, capUsd: 0.05, fresh: [], notProbed: []
}
const E_PROBES: RoutingProgressEvent[] = Q1_ORDER.map((tag, index) => ({
  ...base, stage: 'probe', tag, outcome: 'verified', failure: null, calls: 3, costUsd: 0.0015,
  spentUsd: Number((0.0015 * (index + 1)).toFixed(6))
}))
const E_DONE: RoutingProgressEvent = {
  ...base, stage: 'done', estimateUsd: 0.0493873956, spentUsd: 0.021, probed: [...Q1_ORDER], notProbed: [], accountEligibility: 'checked'
}
const E_FAILED: RoutingProgressEvent = {
  ...base, stage: 'failed', code: 'FETCH_FAILED', failure: 'provider-error', message: 'OpenRouter returned an error.', spentUsd: 0
}
const E_PLAN_CAP: RoutingProgressEvent = {
  ...base, stage: 'probe-plan', planned: Q1_ORDER.slice(0, 7).map((tag) => ({ tag, estimateUsd: 0.0025 })),
  estimateUsd: 0.017288676, capUsd: 0.02, fresh: [], notProbed: Q1_ORDER.slice(7).map((tag) => ({ tag, reason: 'cap' as const }))
}
const E_PLAN_NONE: RoutingProgressEvent = {
  ...base, stage: 'probe-plan', planned: [], estimateUsd: 0, capUsd: 0.05, fresh: Q1_ORDER.slice(1), notProbed: []
}
const E_DONE_NONE: RoutingProgressEvent = {
  ...base, stage: 'done', estimateUsd: 0, spentUsd: 0, probed: [], notProbed: [], accountEligibility: 'checked'
}
const E_PREFLIGHT_UNKNOWN: RoutingProgressEvent = {
  ...base, stage: 'preflight', checkedAt: AT,
  guardrails: { attempted: true, removed: null, issue: 'unrecognized-body', failure: null },
  dataPolicy: { attempted: false, removed: null, issue: null, failure: null }
}
const FULL: RoutingProgressEvent[] = [E_ENDPOINTS, E_PREFLIGHT, E_PLAN, ...E_PROBES, E_DONE]

const L_ENDPOINTS = 'Endpoints: 33 rows, 32 tags'
const L_ACCOUNT = 'Account: guardrails removed deepseek; data policy removed deepseek'
const L_PLAN = 'Cache probe: 14 endpoints, estimated $0.0494 (cap $0.05)'

describe('Table RV — refresh progress, cooldown, button', () => {
  it('RV14: refreshProgressView over the event fixtures', () => {
    expect(refreshProgressView([], 'idle')).toBeNull()
    expect(refreshProgressView([], 'running')).toStrictEqual({ state: 'running', lines: ['Fetching endpoints…'], estimateText: null, spentText: null })
    expect(refreshProgressView([E_ENDPOINTS], 'running')).toStrictEqual({
      state: 'running', lines: [L_ENDPOINTS, 'Checking account eligibility…'], estimateText: null, spentText: null
    })
    expect(refreshProgressView([E_ENDPOINTS, E_PREFLIGHT, E_PLAN, ...E_PROBES.slice(0, 3)], 'running')).toStrictEqual({
      state: 'running',
      lines: [L_ENDPOINTS, L_ACCOUNT, L_PLAN, 'Probing caches: 3 of 14 (spent $0.0045 so far)'],
      estimateText: 'Estimated $0.0494',
      spentText: null
    })
    expect(refreshProgressView(FULL, 'done')).toStrictEqual({
      state: 'done',
      lines: [L_ENDPOINTS, L_ACCOUNT, L_PLAN, 'Probing caches: 14 of 14', 'Done. Spent $0.021 of an estimated $0.0494.'],
      estimateText: 'Estimated $0.0494',
      spentText: 'Spent $0.021'
    })
    expect(refreshProgressView([E_FAILED], 'failed')).toStrictEqual({
      state: 'failed', lines: ['Failed: OpenRouter returned an error. Spent $0.00.'], estimateText: null, spentText: 'Spent $0.00'
    })
    expect(refreshProgressView([], 'failed')).toStrictEqual({ state: 'failed', lines: [], estimateText: null, spentText: null })
    expect(refreshProgressView([E_ENDPOINTS, E_PREFLIGHT, E_PLAN_CAP], 'running')).toStrictEqual({
      state: 'running',
      lines: [
        L_ENDPOINTS, L_ACCOUNT,
        'Cache probe: 7 endpoints, estimated $0.0173 (cap $0.02); 7 left for a later refresh',
        'Probing caches: 0 of 7 (spent $0.00 so far)'
      ],
      estimateText: 'Estimated $0.0173',
      spentText: null
    })
    expect(refreshProgressView([E_ENDPOINTS, E_PREFLIGHT, E_PLAN_NONE, E_DONE_NONE], 'done')).toStrictEqual({
      state: 'done',
      lines: [L_ENDPOINTS, L_ACCOUNT, 'Cache probe: nothing due (13 checked within 14 days)', 'Done. Spent $0.00 of an estimated $0.00.'],
      estimateText: 'Estimated $0.00',
      spentText: 'Spent $0.00'
    })
    expect(refreshProgressView([E_ENDPOINTS, E_PREFLIGHT_UNKNOWN], 'running')).toStrictEqual({
      state: 'running',
      lines: [L_ENDPOINTS, 'Account: guardrails unknown; data policy not checked', 'Planning the cache probe…'],
      estimateText: null,
      spentText: null
    })
  })

  it('RV15: MR-G7 — the estimate precedes every probe; the spend appears only with a terminal event', () => {
    const planAt = FULL.indexOf(E_PLAN)
    const firstProbeAt = FULL.findIndex((e) => e.stage === 'probe')
    expect(planAt).toBeLessThan(firstProbeAt)
    for (let k = 0; k <= FULL.length; k++) {
      const prefix = FULL.slice(0, k)
      const view = refreshProgressView(prefix, 'running')
      expect(view, `prefix ${k}`).not.toBeNull()
      expect(view?.estimateText, `prefix ${k}`).toBe(k > planAt ? 'Estimated $0.0494' : null)
      if (!prefix.some((e) => e.stage === 'done')) expect(view?.spentText, `prefix ${k}`).toBeNull()
    }
    expect(refreshProgressView(FULL.slice(0, firstProbeAt + 1), 'running')?.estimateText).toBe('Estimated $0.0494')
  })

  it('RV16: cooldownRemainingSeconds', () => {
    expect(cooldownRemainingSeconds(null, 0)).toBe(0)
    expect(cooldownRemainingSeconds(1000, 1000)).toBe(60)
    expect(cooldownRemainingSeconds(1000, 43000)).toBe(18)
    expect(cooldownRemainingSeconds(1000, 60999)).toBe(1)
    expect(cooldownRemainingSeconds(1000, 61000)).toBe(0)
    expect(cooldownRemainingSeconds(1000, 500)).toBe(0)
  })

  it('RV17: refreshButtonView', () => {
    const view = (phase: RefreshPhase, cooldownSeconds: number, canRefresh: boolean): unknown =>
      refreshButtonView({ phase, cooldownSeconds, canRefresh })
    expect(view('running', 0, true)).toStrictEqual({ text: 'Refreshing…', disabled: true, title: 'A refresh is running.' })
    expect(view('idle', 0, false)).toStrictEqual({ text: 'Refresh', disabled: true, title: 'Choose a model and an OpenRouter API-key credential first.' })
    expect(view('done', 42, true)).toStrictEqual({ text: 'Refresh again in 42 s', disabled: true, title: 'Refreshes of one model are at least a minute apart.' })
    expect(view('done', 0, true)).toStrictEqual({ text: 'Refresh', disabled: false, title: ROUTING_REFRESH_COST_TEXT })
    expect(view('failed', 0, true)).toStrictEqual({ text: 'Refresh', disabled: false, title: ROUTING_REFRESH_COST_TEXT })
  })
})

// ── Credentials and observation ──
const A_ID = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a'
const B_ID = '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b'
const C_ID = '5f0c1a2e-8a3b-4c5d-9e6f-0123456789ab'
const X_ID = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f'
const A: RoutingCredential = { id: A_ID, label: 'Key A', providerName: 'OpenRouter' }
const B: RoutingCredential = { id: B_ID, label: 'Key B', providerName: 'OpenRouter' }
const C: RoutingCredential = { id: C_ID, label: 'OR key', providerName: 'OpenRouter' }

function status(observer: Partial<RoutingStatus['observer']>): RoutingStatus {
  return {
    observer: { state: 'scheduled', dormantReason: null, nextTickAt: null, lastTickAt: null, lastOutcome: null, lastFailure: null, ...observer },
    models: [],
    requestsSinceStart: 0
  }
}
const obs = (enabled: boolean, credentialProfileId: string | null): RoutingObservationSettings => ({ enabled, credentialProfileId })

describe('Table RV — credentials and observation', () => {
  it('RV18: defaultRefreshCredential and credentialOptionLabel', () => {
    expect(defaultRefreshCredential([A, B], obs(true, B_ID))).toBe(B_ID)
    expect(defaultRefreshCredential([A, B], obs(true, X_ID))).toBe(A_ID)
    expect(defaultRefreshCredential([A, B], null)).toBe(A_ID)
    expect(defaultRefreshCredential([], obs(true, B_ID))).toBeNull()
    expect(credentialOptionLabel({ id: C_ID, label: 'OR key', providerName: 'OpenRouter' })).toBe('OR key · OpenRouter')
  })

  it('RV19: observationView fixtures', () => {
    const off = observationView(obs(false, null), status({ state: 'dormant', dormantReason: 'disabled' }), [C], NOW_MS)
    expect(off).toMatchObject({
      enabled: false, designatedId: null, designatedUsable: true,
      stateText: 'Off. Chorus makes no background requests.', warning: null, nextText: null, credentialHint: null
    })

    const undesignated = observationView(obs(true, null), status({ state: 'dormant', dormantReason: 'undesignated' }), [], NOW_MS)
    expect(undesignated).toMatchObject({
      stateText: 'On, but nothing is recorded until you choose a credential.',
      credentialHint: 'Add an OpenRouter API-key credential under Providers & keys first.',
      lastText: null
    })
    expect(undesignated.credentialHint).toBe(ROUTING_NO_CREDENTIAL_HINT)

    const scheduled = observationView(
      obs(true, C_ID),
      status({ state: 'scheduled', nextTickAt: '2026-10-02T09:49:30Z', lastTickAt: '2026-10-02T08:49:30Z', lastOutcome: 'observed' }),
      [C],
      NOW_MS
    )
    expect(scheduled).toStrictEqual({
      enabled: true,
      designatedId: C_ID,
      designatedUsable: true,
      stateText: 'Every 30 minutes, one free request with OR key. No prompts are sent.',
      warning: null,
      lastText: 'Last check 30 min ago: recorded new numbers.',
      nextText: 'Next check in 30 min.',
      credentialHint: null
    })

    const unlisted = observationView(
      obs(true, X_ID),
      status({ state: 'scheduled', nextTickAt: '2026-10-02T09:48:00Z', lastTickAt: '2026-10-02T09:18:00Z', lastOutcome: 'refused' }),
      [C],
      NOW_MS
    )
    expect(unlisted).toMatchObject({
      designatedId: X_ID,
      designatedUsable: false,
      stateText: 'On, but the chosen credential can no longer be used.',
      warning:
        'The chosen credential is no longer an OpenRouter API-key credential that routing can use. Choose another, or turn background observation off.',
      lastText: 'Last check 2 min ago: refused, the credential cannot be used for routing.'
    })

    const running = observationView(
      obs(true, C_ID),
      status({ state: 'running', lastTickAt: '2026-10-02T09:20:00Z', lastOutcome: 'fetch-failed', lastFailure: 'rate-limited' }),
      [C],
      NOW_MS
    )
    expect(running).toMatchObject({
      lastText: 'Last check just now: could not fetch (Rate limited by OpenRouter).',
      nextText: 'Checking now.'
    })

    const due = observationView(obs(true, C_ID), status({ state: 'scheduled', nextTickAt: '2026-10-02T09:19:00Z' }), [C], NOW_MS)
    expect(due.nextText).toBe('Next check due now.')
  })

  it('RV19 (outcome table and the remaining observer states, from the specification)', () => {
    const last = (lastOutcome: RoutingStatus['observer']['lastOutcome'], lastFailure: RoutingStatus['observer']['lastFailure'] = null): string | null =>
      observationView(obs(true, C_ID), status({ lastTickAt: '2026-10-02T09:15:00Z', lastOutcome, lastFailure }), [C], NOW_MS).lastText
    expect(last('observed')).toBe('Last check 5 min ago: recorded new numbers.')
    expect(last('dormant')).toBe('Last check 5 min ago: dormant.')
    expect(last('skipped-fresh')).toBe('Last check 5 min ago: skipped, the numbers were fresh.')
    expect(last('busy')).toBe('Last check 5 min ago: skipped, a refresh was running.')
    expect(last('refused')).toBe('Last check 5 min ago: refused, the credential cannot be used for routing.')
    expect(last('decrypt-failed')).toBe('Last check 5 min ago: the credential could not be decrypted.')
    expect(last('fetch-failed')).toBe('Last check 5 min ago: could not fetch.')
    expect(last('fetch-failed', 'unreachable')).toBe('Last check 5 min ago: could not fetch (Could not reach OpenRouter).')
    expect(last('failed')).toBe('Last check 5 min ago: failed.')

    expect(observationView(obs(true, C_ID), status({ state: 'stopped' }), [C], NOW_MS).nextText).toBe('The observer is not running.')
    expect(observationView(obs(true, C_ID), status({ state: 'scheduled', nextTickAt: null }), [C], NOW_MS).nextText).toBeNull()
    const noStatus = observationView(obs(true, C_ID), null, [C], NOW_MS)
    expect(noStatus).toMatchObject({ lastText: null, nextText: null, warning: null, designatedUsable: true })
    // Off with an unusable designation: no warning (the warning is for an enabled observer).
    expect(observationView(obs(false, X_ID), null, [C], NOW_MS)).toMatchObject({ designatedUsable: false, warning: null })
  })
})

describe('Table RV — determinism, purity, constants', () => {
  it('RV20: every view function over deep-frozen golden inputs, called twice, is equal, plain JSON, and leaves the inputs unchanged', () => {
    const frozenResult = deepFreeze(structuredClone(golden))
    const frozenSettings = deepFreeze(structuredClone(DEFAULT_ROUTING_SETTINGS))
    const frozenEvents = deepFreeze(structuredClone(FULL))
    const frozenCredentials = deepFreeze([structuredClone(A), structuredClone(C)])
    const frozenObservation = deepFreeze(obs(true, C_ID))
    const frozenStatus = deepFreeze(
      status({ state: 'scheduled', nextTickAt: '2026-10-02T09:49:30Z', lastTickAt: '2026-10-02T08:49:30Z', lastOutcome: 'observed' })
    )
    const before = JSON.stringify([frozenResult, frozenSettings, frozenEvents, frozenCredentials, frozenObservation, frozenStatus])
    const calls: (() => unknown)[] = [
      () => snapshotAgeView(frozenResult.snapshotFetchedAt, NOW_MS, frozenSettings.snapshotMaxAgeMinutes),
      () => tierCardViews(frozenResult, frozenSettings),
      () => tierCardViews(null, frozenSettings),
      () => nitroCardView(frozenResult, SLUG),
      () => nitroCardView(null, SLUG),
      () => resultNotes(frozenResult),
      () => providerTableView(frozenResult),
      () => refreshProgressView(frozenEvents, 'done'),
      () => refreshProgressView(frozenEvents.slice(0, 6), 'running'),
      () => cooldownRemainingSeconds(1000, 43000),
      () => refreshButtonView(deepFreeze({ phase: 'idle' as const, cooldownSeconds: 0, canRefresh: true })),
      () => defaultRefreshCredential(frozenCredentials, frozenObservation),
      () => credentialOptionLabel(frozenCredentials[1]),
      () => observationView(frozenObservation, frozenStatus, frozenCredentials, NOW_MS)
    ]
    for (const [index, call] of calls.entries()) {
      const first = call()
      const second = call()
      expect(first, `call ${index}`).toStrictEqual(second)
      expect(JSON.parse(JSON.stringify(first)), `call ${index}`).toStrictEqual(first)
    }
    expect(JSON.stringify([frozenResult, frozenSettings, frozenEvents, frozenCredentials, frozenObservation, frozenStatus])).toBe(before)
    // Fresh results: a caller mutating one result cannot reach the next.
    const notes = resultNotes(frozenResult)
    expect(notes).not.toBe(frozenResult.warnings)
    expect(nitroCardView(frozenResult, SLUG).caveats).not.toBe(NITRO_CAVEATS)
  })

  it('RV21: constants', () => {
    expect(ROUTING_INSPECTOR_EFFORT).toBe('low')
    expect(ROUTING_PREVIEW_NOTE).toBe('Preview only: launches do not use these tiers yet.')
    expect(ROUTING_REFRESH_COST_TEXT).toBe(
      'A refresh fetches the endpoint list and checks account eligibility (both free), then may spend up to about $0.05 of OpenRouter credit verifying prompt caching. The estimate is shown before anything is spent.'
    )
    expect(ROUTING_PROFILE_LABELS).toStrictEqual({ interactive: 'Interactive', helper: 'Team helper' })
    expect(ROUTING_TIER_LABELS).toStrictEqual({ budget: 'Budget', balanced: 'Balanced', fast: 'Fast' })
    expect(NITRO_CARD_LABEL).toBe('Nitro — unfiltered provider routing')
    expect(ROUTING_NO_CREDENTIAL_HINT).toBe('Add an OpenRouter API-key credential under Providers & keys first.')
  })
})
