import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_ROUTING_SETTINGS,
  routingLaunchSelectionSchema,
  type ModelRegistryEntry,
  type RankInput,
  type RoutingLaunchPreferences,
  type RoutingLaunchSelection,
  type RoutingSettings,
  type TierResult
} from '../../shared/routing'
import { extractObservations, parseEndpointsResponse } from './endpointsCore'
import {
  LAUNCH_PREFERENCES_CAP_BYTES,
  LAUNCH_PREFERENCES_FILE,
  LAUNCH_TIER_LABELS,
  ROUTING_LAUNCH_REFUSALS,
  buildOpenCodeNitroVariantsContent,
  buildOpenCodeRoutingContent,
  checkRoutedRoute,
  emptyLaunchPreferences,
  emptyTierMessage,
  launchPreferencesFileText,
  launchPreferencesWarning,
  parseLaunchPreferencesFile,
  parseStoredRoutingSelection,
  planRoutingLaunch,
  planRoutingRelaunch,
  resolveLaunchSelection,
  routingVariantEfforts,
  staleSnapshotMessage,
  unroutedNitroVariantsContent,
  type LaunchResolution,
  type NitroVariantsFacts,
  type RoutingLaunchFacts,
  type RoutingRelaunchFacts
} from './launchCore'
import { bundledModelRegistry, findModel } from './registryCore'
import { computeTiers } from './routingCore'

/** Model Routing Task 4a-1, Table L (ImplementationSpec-4a-1): the pure launch core. */

const SLUG = 'deepseek/deepseek-v4.1-flash'
const C = '5f0c1a2e-8a3b-4c5d-9e6f-0123456789ab'
const D = '0b6d2c4e-1f3a-4b5c-8d7e-9f0a1b2c3d4e'
const AT = '2026-10-02T09:20:00Z'
const FETCHED = '2026-10-02T09:05:00Z'
const CHECKED_AT = '2026-10-02T09:15:39Z'
const GATEWAY = 'https://openrouter.ai/api/v1'

const PROVIDER = (order: string[]) => ({
  order,
  allow_fallbacks: false as const,
  require_parameters: true as const,
  quantizations: ['fp8' as const],
  data_collection: 'deny' as const
})
const BUDGET = ['deepinfra/fp8', 'streamlake/fp8', 'gmicloud/fp8']
const BALANCED = ['deepinfra/fp8', 'streamlake/fp8', 'makora/fp8']
const FAST = ['venice/fp8', 'baidu/fp8', 'parasail/fp8']

const BALANCED_SELECTION: RoutingLaunchSelection = {
  tier: 'balanced',
  model: SLUG,
  sentModelId: SLUG,
  provider: PROVIDER(BALANCED),
  endpoints: BALANCED,
  computedAt: AT,
  snapshotFetchedAt: FETCHED
}
const NITRO_SELECTION: RoutingLaunchSelection = {
  tier: 'nitro',
  model: SLUG,
  sentModelId: SLUG + ':nitro',
  provider: { data_collection: 'deny' },
  endpoints: [],
  computedAt: AT,
  snapshotFetchedAt: null
}

// ── The golden result: routingIpc.test.ts's recipe (the Phase 1 golden input through the pure core) ──
const fixture = JSON.parse(readFileSync(join(__dirname, '__fixtures__/endpoints-deepseek-v4.1-flash-2026-10-02.json'), 'utf8')) as {
  fetchedAt: string
  guardrailRemoved: string[]
  dataPolicyDenyRemoved: string[]
  cacheVerified: Record<string, boolean>
}
const MODEL = findModel(bundledModelRegistry(), SLUG) as ModelRegistryEntry
const snapshot = { fetchedAt: fixture.fetchedAt, endpoints: parseEndpointsResponse(fixture).endpoints }

function golden(over: Partial<RankInput> = {}): TierResult {
  return computeTiers({
    model: MODEL,
    snapshot,
    history: extractObservations(snapshot),
    account: { guardrailRemoved: fixture.guardrailRemoved, dataPolicyRemoved: fixture.dataPolicyDenyRemoved, checkedAt: CHECKED_AT },
    cache: Object.fromEntries(Object.entries(fixture.cacheVerified).map(([tag, verified]) => [tag, { verified, checkedAt: CHECKED_AT }])),
    profile: 'interactive',
    effort: 'low',
    settings: DEFAULT_ROUTING_SETTINGS,
    now: AT,
    ...over
  })
}

type ResolveInput = Parameters<typeof resolveLaunchSelection>[0]
function resolve(over: Partial<ResolveInput>): LaunchResolution {
  return resolveLaunchSelection({ tier: 'balanced', model: SLUG, result: golden(), settings: DEFAULT_ROUTING_SETTINGS, computedAt: AT, ...over })
}

/** The ok selection, or a failed expectation. */
function selected(resolution: LaunchResolution): RoutingLaunchSelection {
  expect(resolution.ok, JSON.stringify(resolution)).toBe(true)
  if (!resolution.ok) throw new Error('not ok')
  return resolution.selection
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

const MESSAGE_NO_SNAPSHOT = 'No endpoint snapshot is stored for this model yet. Refresh first.'
const MESSAGE_STALE_60 = 'The endpoint snapshot for this model is more than 60 minutes old. Refresh first.'
const MESSAGE_STALE_30 = 'The endpoint snapshot for this model is more than 30 minutes old. Refresh first.'
const STALE_NOW = '2026-10-02T10:05:00.001Z'

const ROUTED_BALANCED =
  '{"provider":{"openrouter":{"models":{"deepseek/deepseek-v4.1-flash":{"options":{"provider":{"order":["deepinfra/fp8","streamlake/fp8","makora/fp8"],"allow_fallbacks":false,"require_parameters":true,"quantizations":["fp8"],"data_collection":"deny"}}}}}}}'
const ROUTED_NITRO_3 =
  '{"provider":{"openrouter":{"models":{"deepseek/deepseek-v4.1-flash:nitro":{"options":{"provider":{"data_collection":"deny"}},"variants":{"low":{"reasoning":{"effort":"low"}},"medium":{"reasoning":{"effort":"medium"}},"high":{"reasoning":{"effort":"high"}}}}}}}}'
const ROUTED_NITRO_NONE = '{"provider":{"openrouter":{"models":{"deepseek/deepseek-v4.1-flash:nitro":{"options":{"provider":{"data_collection":"deny"}}}}}}}'
const ROUTED_NITRO_ALLOW_LOW = '{"provider":{"openrouter":{"models":{"deepseek/deepseek-v4.1-flash:nitro":{"variants":{"low":{"reasoning":{"effort":"low"}}}}}}}}'
const ROUTED_NITRO_ALLOW_NONE = '{"provider":{"openrouter":{"models":{"deepseek/deepseek-v4.1-flash:nitro":{}}}}}'
const ROUTED_NITRO_CLEANED =
  '{"provider":{"openrouter":{"models":{"deepseek/deepseek-v4.1-flash:nitro":{"options":{"provider":{"data_collection":"deny"}},"variants":{"high":{"reasoning":{"effort":"high"}},"low":{"reasoning":{"effort":"low"}}}}}}}}'

const VARIANTS_3 =
  '{"provider":{"openrouter":{"models":{"deepseek/deepseek-v4.1-flash:nitro":{"variants":{"low":{"reasoning":{"effort":"low"}},"medium":{"reasoning":{"effort":"medium"}},"high":{"reasoning":{"effort":"high"}}}}}}}}'
const VARIANTS_LOW = '{"provider":{"openrouter":{"models":{"deepseek/deepseek-v4.1-flash:nitro":{"variants":{"low":{"reasoning":{"effort":"low"}}}}}}}}'
const VARIANTS_CLEANED =
  '{"provider":{"openrouter":{"models":{"deepseek/deepseek-v4.1-flash:nitro":{"variants":{"high":{"reasoning":{"effort":"high"}},"low":{"reasoning":{"effort":"low"}}}}}}}}'
const VARIANTS_GLM = '{"provider":{"openrouter":{"models":{"z-ai/glm-5.3:nitro":{"variants":{"high":{"reasoning":{"effort":"high"}}}}}}}}'
const VARIANTS_HIGH_XHIGH =
  '{"provider":{"openrouter":{"models":{"deepseek/deepseek-v4.1-flash:nitro":{"variants":{"high":{"reasoning":{"effort":"high"}},"xhigh":{"reasoning":{"effort":"xhigh"}}}}}}}}'

describe('Table L — launch resolution', () => {
  it('L1: Balanced on the golden result is BALANCED_SELECTION exactly', () => {
    expect(resolve({})).toStrictEqual({ ok: true, selection: BALANCED_SELECTION })
  })

  it('L2: Budget and Fast take their golden orders, providers and times', () => {
    expect(resolve({ tier: 'budget' })).toStrictEqual({
      ok: true,
      selection: { ...BALANCED_SELECTION, tier: 'budget', provider: PROVIDER(BUDGET), endpoints: BUDGET }
    })
    expect(resolve({ tier: 'fast' })).toStrictEqual({
      ok: true,
      selection: { ...BALANCED_SELECTION, tier: 'fast', provider: PROVIDER(FAST), endpoints: FAST }
    })
    for (const tier of ['budget', 'fast'] as const) {
      const s = selected(resolve({ tier }))
      expect(s.sentModelId).toBe(SLUG)
      expect(s.computedAt).toBe(AT)
      expect(s.snapshotFetchedAt).toBe(FETCHED)
    }
  })

  it('L3: Nitro ignores the result (golden, none, stale); under allow its provider is null', () => {
    for (const result of [golden(), null, golden({ now: STALE_NOW })]) {
      expect(resolve({ tier: 'nitro', result })).toStrictEqual({ ok: true, selection: NITRO_SELECTION })
    }
    expect(resolve({ tier: 'nitro', settings: { ...DEFAULT_ROUTING_SETTINGS, dataCollection: 'allow' } })).toStrictEqual({
      ok: true,
      selection: { ...NITRO_SELECTION, provider: null }
    })
  })

  it('L4: no snapshot, stale, the 60-minute boundary, a mismatched model, and a 30-minute setting', () => {
    expect(resolve({ result: null })).toStrictEqual({ ok: false, code: 'NO_SNAPSHOT', message: MESSAGE_NO_SNAPSHOT })
    expect(resolve({ result: golden({ now: STALE_NOW }) })).toStrictEqual({ ok: false, code: 'SNAPSHOT_STALE', message: MESSAGE_STALE_60 })
    expect(selected(resolve({ result: golden({ now: '2026-10-02T10:05:00Z' }) })).endpoints).toEqual(BALANCED)
    expect(resolve({ result: { ...golden(), model: 'other/model' } })).toStrictEqual({
      ok: false,
      code: 'OPERATION_FAILED',
      message: 'Routing operation failed.'
    })
    const S30: RoutingSettings = { ...DEFAULT_ROUTING_SETTINGS, snapshotMaxAgeMinutes: 30 }
    expect(resolve({ result: golden({ settings: S30, now: '2026-10-02T09:35:00.001Z' }), settings: S30 })).toStrictEqual({
      ok: false,
      code: 'SNAPSHOT_STALE',
      message: MESSAGE_STALE_30
    })
  })

  it('L5: an empty tier is TIER_EMPTY with its label; staleness is checked first', () => {
    const F: RoutingSettings = { ...DEFAULT_ROUTING_SETTINGS, budgetMinTps: 100000 }
    expect(resolve({ tier: 'budget', result: golden({ settings: F }), settings: F })).toStrictEqual({
      ok: false,
      code: 'TIER_EMPTY',
      message: 'Budget has no eligible endpoints. Choose another tier or OpenRouter default.'
    })
    expect(selected(resolve({ tier: 'balanced', result: golden({ settings: F }), settings: F })).endpoints).toEqual(BALANCED)
    const U: RoutingSettings = { ...DEFAULT_ROUTING_SETTINGS, minUptimePct: 100, readmitUptimePct: 100 }
    expect(resolve({ tier: 'balanced', result: golden({ settings: U }), settings: U })).toStrictEqual({
      ok: false,
      code: 'TIER_EMPTY',
      message: 'Balanced has no eligible endpoints. Choose another tier or OpenRouter default.'
    })
    expect(resolve({ tier: 'fast', result: golden({ settings: U }), settings: U })).toStrictEqual({
      ok: false,
      code: 'TIER_EMPTY',
      message: 'Fast has no eligible endpoints. Choose another tier or OpenRouter default.'
    })
    expect(resolve({ tier: 'budget', result: golden({ settings: F, now: STALE_NOW }), settings: F })).toStrictEqual({
      ok: false,
      code: 'SNAPSHOT_STALE',
      message: MESSAGE_STALE_60
    })
  })

  it('L6: the selection shares nothing with the result, and a deep-frozen result resolves without throwing', () => {
    const result = golden()
    const s = selected(resolve({ result }))
    s.provider!.order!.push('x')
    s.provider!.quantizations!.push('fp16')
    s.endpoints.push('x')
    expect(s.provider?.order).toHaveLength(4)
    expect(result.tiers.balanced?.provider.order).toEqual(BALANCED)
    expect(result.tiers.balanced?.provider.quantizations).toEqual(['fp8'])
    expect(result.tiers.balanced?.endpoints).toEqual(BALANCED)
    const frozen = deepFreeze(structuredClone(golden()))
    let resolution: LaunchResolution | null = null
    expect(() => {
      resolution = resolve({ result: frozen })
    }).not.toThrow()
    expect(resolution).toStrictEqual({ ok: true, selection: BALANCED_SELECTION })
  })

  it('L7: every ok selection from L1–L3 parses back strictly equal and survives a JSON round trip', () => {
    const resolutions = [
      resolve({}),
      resolve({ tier: 'budget' }),
      resolve({ tier: 'fast' }),
      resolve({ tier: 'nitro' }),
      resolve({ tier: 'nitro', result: null }),
      resolve({ tier: 'nitro', result: golden({ now: STALE_NOW }) }),
      resolve({ tier: 'nitro', settings: { ...DEFAULT_ROUTING_SETTINGS, dataCollection: 'allow' } })
    ]
    for (const resolution of resolutions) {
      const s = selected(resolution)
      expect(routingLaunchSelectionSchema.parse(s), s.tier).toStrictEqual(s)
      expect(JSON.parse(JSON.stringify(s)), s.tier).toStrictEqual(s)
    }
  })
})

describe('Table L — OpenCode config content', () => {
  it('L8: the exact routed contents (Balanced, Nitro with and without efforts, Nitro-allow, cleaned efforts)', () => {
    const allow: RoutingLaunchSelection = { ...NITRO_SELECTION, provider: null }
    expect(buildOpenCodeRoutingContent(BALANCED_SELECTION, ['low', 'medium', 'high'])).toBe(ROUTED_BALANCED)
    expect(ROUTED_BALANCED).toHaveLength(253)
    expect(buildOpenCodeRoutingContent(NITRO_SELECTION, ['low', 'medium', 'high'])).toBe(ROUTED_NITRO_3)
    expect(ROUTED_NITRO_3).toHaveLength(261)
    expect(buildOpenCodeRoutingContent(NITRO_SELECTION, [])).toBe(ROUTED_NITRO_NONE)
    expect(buildOpenCodeRoutingContent(allow, ['low'])).toBe(ROUTED_NITRO_ALLOW_LOW)
    expect(buildOpenCodeRoutingContent(allow, [])).toBe(ROUTED_NITRO_ALLOW_NONE)
    expect(buildOpenCodeRoutingContent(NITRO_SELECTION, ['high', 'HIGH', 'high', 'x y', 'low'])).toBe(ROUTED_NITRO_CLEANED)
  })

  it('L9: a ranked tier never declares variants', () => {
    expect(buildOpenCodeRoutingContent(BALANCED_SELECTION, [])).toBe(ROUTED_BALANCED)
  })

  it('L10: routingVariantEfforts — catalog efforts, else the launch effort, else none; cleaned', () => {
    expect(routingVariantEfforts(['low', 'medium', 'high'], 'low')).toEqual(['low', 'medium', 'high'])
    expect(routingVariantEfforts(null, 'high')).toEqual(['high'])
    expect(routingVariantEfforts([], 'high')).toEqual(['high'])
    expect(routingVariantEfforts(null, null)).toEqual([])
    expect(routingVariantEfforts(['high', 'HIGH', 'high', 'x y', 'low'], null)).toEqual(['high', 'low'])
    expect(routingVariantEfforts(['HIGH'], 'low')).toEqual(['low'])
    expect(routingVariantEfforts(null, 'LOW')).toEqual([])
  })

  it('L17: K13 variants-only content for a :nitro id, never options or data_collection', () => {
    const results = [
      buildOpenCodeNitroVariantsContent(SLUG + ':nitro', ['low', 'medium', 'high']),
      buildOpenCodeNitroVariantsContent(SLUG + ':nitro', ['low']),
      buildOpenCodeNitroVariantsContent(SLUG + ':nitro', []),
      buildOpenCodeNitroVariantsContent(SLUG, ['low']),
      buildOpenCodeNitroVariantsContent(SLUG + ':nitro', ['high', 'HIGH', 'high', 'x y', 'low']),
      buildOpenCodeNitroVariantsContent('z-ai/glm-5.3:nitro', ['high'])
    ]
    expect(results).toEqual([VARIANTS_3, VARIANTS_LOW, null, null, VARIANTS_CLEANED, VARIANTS_GLM])
    expect(VARIANTS_3).toHaveLength(211)
    expect(VARIANTS_LOW).toHaveLength(129)
    for (const text of results) {
      if (text === null) continue
      expect(text).not.toContain('options')
      expect(text).not.toContain('data_collection')
    }
  })

  it('L18: K13 unroutedNitroVariantsContent applies only to an opencode :nitro launch with an effort on the gateway', () => {
    const NBASE: NitroVariantsFacts = {
      agent: 'opencode',
      baseUrl: GATEWAY,
      gatewayBaseUrl: GATEWAY,
      sentModelId: SLUG + ':nitro',
      launchEffort: 'low',
      catalogEfforts: ['low', 'medium', 'high'],
      profileEnvKeys: []
    }
    const content = (over: Partial<NitroVariantsFacts>): string | null => unroutedNitroVariantsContent({ ...NBASE, ...over })
    expect(content({})).toBe(VARIANTS_3)
    expect(content({ catalogEfforts: null })).toBe(VARIANTS_LOW)
    expect(content({ catalogEfforts: ['high', 'xhigh'], launchEffort: 'high' })).toBe(VARIANTS_HIGH_XHIGH)
    expect(content({ baseUrl: GATEWAY + '/' })).toBe(VARIANTS_3)
    const nulls: [string, Partial<NitroVariantsFacts>][] = [
      ['no effort', { launchEffort: null }],
      ['LOW effort', { launchEffort: 'LOW' }],
      ['claude', { agent: 'claude' }],
      ['another base URL', { baseUrl: 'https://proxy.invalid/v1' }],
      ['no base URL', { baseUrl: null }],
      ['plain slug', { sentModelId: SLUG }],
      ['no model', { sentModelId: null }],
      ['profile sets the content', { profileEnvKeys: ['opencode_config_content'] }]
    ]
    for (const [label, over] of nulls) expect(content(over), label).toBeNull()
  })
})

describe('Table L — launch planning', () => {
  const R = ROUTING_LAUNCH_REFUSALS
  const BASE: RoutingLaunchFacts = {
    agent: 'opencode',
    tier: 'balanced',
    credentialProfileId: C,
    model: SLUG,
    routingAvailable: true,
    routingCredentialIds: [C],
    registrySlugs: [SLUG],
    profileEnvKeys: []
  }
  const plan = (over: Partial<RoutingLaunchFacts>) => planRoutingLaunch({ ...BASE, ...over })

  it('L11: routed, Nitro, default; each refusal with its exact text; without a tier every refused row is unrouted', () => {
    expect(plan({})).toStrictEqual({ kind: 'routed', model: SLUG, tier: 'balanced', credentialProfileId: C })
    expect(plan({ tier: 'nitro' })).toStrictEqual({ kind: 'routed', model: SLUG, tier: 'nitro', credentialProfileId: C })
    expect(plan({ tier: null })).toStrictEqual({ kind: 'default', model: SLUG })
    const refusals: [Partial<RoutingLaunchFacts>, string][] = [
      [{ agent: 'claude' }, R.notOpencode],
      [{ routingAvailable: false }, R.unavailable],
      [{ credentialProfileId: null }, R.noCredential],
      [{ credentialProfileId: D }, R.credentialRefused],
      [{ model: null }, R.noModel],
      [{ model: SLUG + ':nitro', registrySlugs: [SLUG, SLUG + ':nitro'] }, R.nitroModel],
      [{ model: 'z-ai/glm-5.3' }, R.unknownModel],
      [{ profileEnvKeys: ['OPENCODE_CONFIG_CONTENT'] }, R.profileEnv],
      [{ profileEnvKeys: ['opencode_config_content'] }, R.profileEnv]
    ]
    for (const [over, reason] of refusals) {
      expect(plan(over), JSON.stringify(over)).toStrictEqual({ kind: 'refused', reason })
      // C8: a K7-blocked or ineligible launch with no tier is today's launch and records nothing; never 'default'.
      expect(plan({ ...over, tier: null }), `${JSON.stringify(over)} without a tier`).toStrictEqual({ kind: 'unrouted' })
    }
    expect(plan({ agent: 'claude', routingAvailable: false, credentialProfileId: null })).toStrictEqual({ kind: 'refused', reason: R.notOpencode })
    expect(plan({ routingAvailable: false, credentialProfileId: null })).toStrictEqual({ kind: 'refused', reason: R.unavailable })
    // The exact texts.
    expect(R).toStrictEqual({
      notOpencode: 'Routing tiers apply only to OpenCode launches.',
      unavailable: 'Model routing is not available right now. Launch with OpenRouter default instead.',
      noCredential: 'Routing tiers need an OpenRouter API-key credential.',
      credentialRefused:
        'This credential cannot be used for model routing. Routing needs an OpenRouter API-key credential for the OpenRouter gateway.',
      noModel: 'Choose a model to use a routing tier.',
      nitroModel: 'This model already ends in :nitro. Choose the base model and the Nitro tier instead.',
      unknownModel: 'Model routing does not know this model.',
      profileEnv:
        'The launch profile sets OPENCODE_CONFIG_CONTENT, which a routed launch also needs. Remove it from the profile, or launch with OpenRouter default.',
      storedInvalid: "This session's saved routing could not be read. Start a new session from the launch dialog.",
      relaunchUnavailable: 'Model routing is not available right now, so this routed session cannot be relaunched.',
      relaunchCredential: "This session was routed, but its launch profile's credential can no longer be used for model routing."
    })
  })

  it('L12: relaunch re-applies a stored selection; an unreadable row, agent, service, credential or profile env refuses', () => {
    const RBASE: RoutingRelaunchFacts = {
      agent: 'opencode',
      routingJson: JSON.stringify(BALANCED_SELECTION),
      credentialProfileId: C,
      routingAvailable: true,
      routingCredentialIds: [C],
      profileEnvKeys: []
    }
    const relaunch = (over: Partial<RoutingRelaunchFacts>) => planRoutingRelaunch({ ...RBASE, ...over })
    expect(relaunch({})).toStrictEqual({ kind: 'routed', selection: BALANCED_SELECTION })
    expect(relaunch({ routingJson: null })).toStrictEqual({ kind: 'unrouted' })
    expect(relaunch({ routingJson: null, agent: 'claude', routingAvailable: false })).toStrictEqual({ kind: 'unrouted' })
    for (const routingJson of [
      '',
      'not json',
      JSON.stringify({ ...BALANCED_SELECTION, extra: 1 }),
      JSON.stringify({ ...BALANCED_SELECTION, sentModelId: SLUG + ':nitro' })
    ]) {
      expect(relaunch({ routingJson }), routingJson).toStrictEqual({ kind: 'refused', reason: R.storedInvalid })
    }
    expect(relaunch({ agent: 'codex' })).toStrictEqual({ kind: 'refused', reason: R.notOpencode })
    expect(relaunch({ routingAvailable: false })).toStrictEqual({ kind: 'refused', reason: R.relaunchUnavailable })
    expect(relaunch({ credentialProfileId: null })).toStrictEqual({ kind: 'refused', reason: R.relaunchCredential })
    expect(relaunch({ credentialProfileId: D })).toStrictEqual({ kind: 'refused', reason: R.relaunchCredential })
    expect(relaunch({ profileEnvKeys: ['OPENCODE_CONFIG_CONTENT'] })).toStrictEqual({ kind: 'refused', reason: R.profileEnv })
    expect(parseStoredRoutingSelection(null)).toStrictEqual({ kind: 'none' })
    expect(parseStoredRoutingSelection(JSON.stringify(NITRO_SELECTION))).toStrictEqual({ kind: 'selection', selection: NITRO_SELECTION })
  })

  it('L13: checkRoutedRoute — the gateway passes (trailing slash too); no base URL and another base URL refuse', () => {
    expect(checkRoutedRoute('https://openrouter.ai/api/v1/', 'OR key', GATEWAY)).toStrictEqual({ ok: true })
    expect(checkRoutedRoute(null, 'OR key', GATEWAY)).toStrictEqual({ ok: false, reason: 'Routing needs a credential for the OpenRouter gateway.' })
    expect(checkRoutedRoute('https://proxy.invalid/v1', 'OR key', GATEWAY)).toStrictEqual({
      ok: false,
      reason: "Credential profile 'OR key' points at a different base URL; routing only calls the OpenRouter gateway."
    })
  })
})

describe('Table L — the launch-preferences file', () => {
  const TEXT = '{"version":1,"lastChoiceByModel":{"a/b":"nitro","deepseek/deepseek-v4.1-flash":"balanced"}}'
  const EMPTY = { lastChoiceByModel: {} }
  const SCHEMA_WARNING = 'launch preferences file does not match its schema; reading it as empty'

  it('L14: the file text is versioned with sorted keys; a value the reader would refuse throws', () => {
    expect(launchPreferencesFileText({ lastChoiceByModel: { [SLUG]: 'balanced', 'a/b': 'nitro' } })).toBe(TEXT)
    expect(launchPreferencesFileText(emptyLaunchPreferences())).toBe('{"version":1,"lastChoiceByModel":{}}')
    expect(() => launchPreferencesFileText({ lastChoiceByModel: { [SLUG]: 'turbo' } } as unknown as RoutingLaunchPreferences)).toThrow()
  })

  it('L15: missing, not JSON, unversioned, version 2, a bad choice and an extra key read as empty; a valid file reads back', () => {
    expect(parseLaunchPreferencesFile(null)).toStrictEqual({ value: EMPTY, warning: null })
    expect(parseLaunchPreferencesFile('garbage')).toStrictEqual({
      value: EMPTY,
      warning: 'launch preferences file is not valid JSON; reading it as empty'
    })
    for (const text of [
      '{"lastChoiceByModel":{}}',
      '{"version":2,"lastChoiceByModel":{}}',
      '{"version":1,"lastChoiceByModel":{"deepseek/deepseek-v4.1-flash":"turbo"}}',
      '{"version":1,"lastChoiceByModel":{},"x":1}'
    ]) {
      expect(parseLaunchPreferencesFile(text), text).toStrictEqual({ value: EMPTY, warning: SCHEMA_WARNING })
    }
    expect(parseLaunchPreferencesFile(TEXT)).toStrictEqual({ value: { lastChoiceByModel: { 'a/b': 'nitro', [SLUG]: 'balanced' } }, warning: null })
  })

  it('L16: the labels, messages, warnings, file name and cap', () => {
    expect(LAUNCH_TIER_LABELS).toStrictEqual({ budget: 'Budget', balanced: 'Balanced', fast: 'Fast', nitro: 'Nitro' })
    expect(emptyTierMessage('fast')).toBe('Fast has no eligible endpoints. Choose another tier or OpenRouter default.')
    expect(staleSnapshotMessage(60)).toBe(MESSAGE_STALE_60)
    expect(launchPreferencesWarning('size')).toBe('launch preferences file exceeds 65536 bytes; reading it as empty')
    expect(launchPreferencesWarning('read')).toBe('launch preferences file could not be read; reading it as empty')
    expect(LAUNCH_PREFERENCES_FILE).toBe('launch-preferences.json')
    expect(LAUNCH_PREFERENCES_CAP_BYTES).toBe(65536)
  })
})
