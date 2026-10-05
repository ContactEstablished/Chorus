import { describe, expect, it } from 'vitest'
import { routingLaunchSelectionSchema, type RoutingLaunchSelection } from '../../shared/routing'
import { teamMemberSchema } from '../../shared/team'
import { HELPER_ROUTING_REFUSALS, helperAttemptRefusal, helperRoutedModelEntry, planHelperRouting, routedHelperFailureNote, type HelperRoutingFacts } from './helperRoutingCore'

const SLUG = 'deepseek/deepseek-v4.1-flash', NITRO = SLUG + ':nitro'
const C = '5f0c1a2e-8a3b-4c5d-9e6f-0123456789ab', D = '0b6d2c4e-1f3a-4b5c-8d7e-9f0a1b2c3d4e'
const AT = '2026-10-02T09:20:00Z', FETCHED = '2026-10-02T09:05:00Z'
const BALANCED: RoutingLaunchSelection = { tier: 'balanced', model: SLUG, sentModelId: SLUG, provider: { order: ['streamlake/fp8', 'venice/fp8', 'gmicloud/fp8'], allow_fallbacks: false, require_parameters: true, quantizations: ['fp8'], data_collection: 'deny' }, endpoints: ['streamlake/fp8', 'venice/fp8', 'gmicloud/fp8'], computedAt: AT, snapshotFetchedAt: FETCHED }
const NITRO_SELECTION: RoutingLaunchSelection = { tier: 'nitro', model: SLUG, sentModelId: NITRO, provider: { data_collection: 'deny' }, endpoints: [], computedAt: AT, snapshotFetchedAt: null }
const NITRO_ALLOW: RoutingLaunchSelection = { ...NITRO_SELECTION, provider: null }
const LOW = { variants: { low: { reasoning: { effort: 'low' } } } }
const BASE: HelperRoutingFacts = { harness: 'opencode', authMode: 'api_key', tier: 'balanced', credentialProfileId: C, model: NITRO, routingAvailable: true, routingCredentialIds: [C], registrySlugs: [SLUG] }
const TAIL = " with no fallback. If those providers were unavailable, refresh the numbers in Settings → Model routing and revise the task: each attempt resolves its tier again. A helper on another tier can also take the revision. Chorus never changes a helper's tier on its own."

describe('Table HR — pure helper routing', () => {
  it('HR1: refusal texts are exact', () => {
    expect(HELPER_ROUTING_REFUSALS).toStrictEqual({
      notOpencode: 'A routing tier applies only to an OpenCode helper on an OpenRouter API key.',
      unavailable: 'Model routing is not available right now. Launch this helper with OpenRouter default instead.',
      credentialRefused: "This helper's credential cannot be used for model routing. Routing needs an OpenRouter API-key credential for the OpenRouter gateway.",
      unknownModel: "Model routing does not know this helper's model."
    })
  })
  it('HR2: both model forms route, while no tier always leaves the helper unrouted', () => {
    for (const model of [NITRO, SLUG, 'openrouter/' + NITRO, '  ' + NITRO + ' ']) expect(planHelperRouting({ ...BASE, model })).toStrictEqual({ kind: 'routed', model: SLUG, tier: 'balanced', credentialProfileId: C })
    expect(planHelperRouting({ ...BASE, tier: 'nitro' })).toStrictEqual({ kind: 'routed', model: SLUG, tier: 'nitro', credentialProfileId: C })
    expect(planHelperRouting({ ...BASE, tier: null })).toStrictEqual({ kind: 'unrouted' })
    expect(planHelperRouting({ ...BASE, tier: null, harness: 'codex', routingAvailable: false })).toStrictEqual({ kind: 'unrouted' })
  })
  it('HR3: first eligibility failure wins in the specified order', () => {
    const rows: [Partial<HelperRoutingFacts>, keyof typeof HELPER_ROUTING_REFUSALS][] = [
      [{ harness: 'codex' }, 'notOpencode'], [{ harness: 'claude' }, 'notOpencode'], [{ authMode: 'subscription' }, 'notOpencode'],
      [{ routingAvailable: false }, 'unavailable'], [{ credentialProfileId: null }, 'credentialRefused'], [{ credentialProfileId: D }, 'credentialRefused'],
      ...['z-ai/glm-5.3', NITRO + ':nitro', SLUG + ':free', 'openrouter/openrouter/' + SLUG].map(model => [{ model }, 'unknownModel'] as [Partial<HelperRoutingFacts>, 'unknownModel']),
      [{ harness: 'codex', routingAvailable: false, credentialProfileId: null }, 'notOpencode'],
      [{ routingAvailable: false, credentialProfileId: null, model: 'z-ai/glm-5.3' }, 'unavailable'],
      [{ credentialProfileId: D, model: 'z-ai/glm-5.3' }, 'credentialRefused']
    ]
    for (const [over, key] of rows) expect(planHelperRouting({ ...BASE, tier: 'fast', ...over })).toStrictEqual({ kind: 'refused', reason: HELPER_ROUTING_REFUSALS[key] })
  })
  it('HR4: attempt refusal texts name the tier, model and freshness limit exactly', () => {
    const missing = 'Balanced routing refused this helper attempt: no endpoint numbers are stored for deepseek/deepseek-v4.1-flash. Refresh them in Settings → Model routing, then revise the task.'
    expect(helperAttemptRefusal('balanced', SLUG, 'NO_SNAPSHOT', 'ignored', null)).toBe(missing)
    expect(helperAttemptRefusal('balanced', SLUG, 'NO_SNAPSHOT', 'x', 45)).toBe(missing)
    expect(helperAttemptRefusal('balanced', SLUG, 'SNAPSHOT_STALE', 'ignored', 60)).toBe('Balanced routing refused this helper attempt: the endpoint numbers for deepseek/deepseek-v4.1-flash are more than 60 minutes old. Refresh them in Settings → Model routing, or turn on background observation there to keep them fresh, then revise the task.')
    expect(helperAttemptRefusal('fast', SLUG, 'SNAPSHOT_STALE', 'ignored', 45)).toBe('Fast routing refused this helper attempt: the endpoint numbers for deepseek/deepseek-v4.1-flash are more than 45 minutes old. Refresh them in Settings → Model routing, or turn on background observation there to keep them fresh, then revise the task.')
    expect(helperAttemptRefusal('balanced', SLUG, 'SNAPSHOT_STALE', 'The endpoint snapshot for this model is more than 60 minutes old. Refresh first.', null)).toBe('Balanced routing could not be resolved for this helper attempt: The endpoint snapshot for this model is more than 60 minutes old. Refresh first.')
    expect(helperAttemptRefusal('budget', SLUG, 'TIER_EMPTY', 'ignored', null)).toBe('Budget routing refused this helper attempt: no endpoint for deepseek/deepseek-v4.1-flash meets the Budget rules right now. Revise the task to a helper on another tier, or refresh later.')
    expect(helperAttemptRefusal('nitro', SLUG, 'OPERATION_FAILED', 'Routing has stopped.', null)).toBe('Nitro routing could not be resolved for this helper attempt: Routing has stopped.')
    expect(helperAttemptRefusal('balanced', SLUG, 'INVALID_TIME', 'The stored snapshot is newer than the current time; refresh again.', null)).toBe('Balanced routing could not be resolved for this helper attempt: The stored snapshot is newer than the current time; refresh again.')
    expect(helperAttemptRefusal('fast', SLUG, 'INVALID_REQUEST', 'Invalid routing request.', null)).toBe('Fast routing could not be resolved for this helper attempt: Invalid routing request.')
  })
  it('HR5: provider-error notes list one to four tags and handle both Nitro policies', () => {
    expect(routedHelperFailureNote(BALANCED)).toBe('This attempt used the Balanced tier, pinned to streamlake/fp8, venice/fp8 and gmicloud/fp8' + TAIL)
    expect(routedHelperFailureNote({ ...BALANCED, endpoints: ['venice/fp8'] })).toBe('This attempt used the Balanced tier, pinned to venice/fp8' + TAIL)
    expect(routedHelperFailureNote({ ...BALANCED, tier: 'budget', endpoints: ['streamlake/fp8', 'deepinfra/fp8'] })).toBe('This attempt used the Budget tier, pinned to streamlake/fp8 and deepinfra/fp8' + TAIL)
    expect(routedHelperFailureNote({ ...BALANCED, tier: 'fast', endpoints: ['a/fp8', 'b/fp8', 'c/fp8', 'd/fp8'] })).toBe('This attempt used the Fast tier, pinned to a/fp8, b/fp8, c/fp8 and d/fp8' + TAIL)
    for (const selection of [NITRO_SELECTION, NITRO_ALLOW]) expect(routedHelperFailureNote(selection)).toBe("This attempt used the Nitro tier, which leaves the provider to OpenRouter. Chorus never changes a helper's tier on its own.")
  })
  it('HR6: golden model entries keep key order and share no mutable inputs', () => {
    expect(JSON.stringify(helperRoutedModelEntry(BALANCED, {}))).toBe('{"options":{"provider":{"order":["streamlake/fp8","venice/fp8","gmicloud/fp8"],"allow_fallbacks":false,"require_parameters":true,"quantizations":["fp8"],"data_collection":"deny"}}}')
    expect(JSON.stringify(helperRoutedModelEntry(NITRO_SELECTION, LOW))).toBe('{"options":{"provider":{"data_collection":"deny"}},"variants":{"low":{"reasoning":{"effort":"low"}}}}')
    expect(JSON.stringify(helperRoutedModelEntry(NITRO_ALLOW, LOW))).toBe('{"variants":{"low":{"reasoning":{"effort":"low"}}}}')
    expect(JSON.stringify(helperRoutedModelEntry(NITRO_ALLOW, {}))).toBe('{}')
    const beforeSelection = JSON.stringify(BALANCED), beforeMeasured = JSON.stringify(LOW)
    const entry = helperRoutedModelEntry(BALANCED, LOW) as { options: { provider: { order: string[] } }; variants: typeof LOW.variants }
    expect(Object.keys(entry)).toEqual(['options', 'variants'])
    entry.options.provider.order.push('changed/fp8'); entry.variants.low.reasoning.effort = 'high'
    expect(JSON.stringify(BALANCED)).toBe(beforeSelection)
    expect(JSON.stringify(LOW)).toBe(beforeMeasured)
    expect(() => helperRoutedModelEntry(BALANCED, { options: {} })).toThrow('A measured helper model entry already declares options.')
  })
  it('HR7: the member refine matches the core and selections parse strictly', () => {
    const r = teamMemberSchema.safeParse({ id: C, label: 'Codex', harness: 'codex', authMode: 'subscription', providerId: null, credentialProfileId: null, model: 'gpt-6-astra', effort: null, installedVersion: 'codex-cli 0.155.1', routingTier: 'balanced' })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues.map(i => i.message)).toEqual([HELPER_ROUTING_REFUSALS.notOpencode])
    for (const selection of [BALANCED, NITRO_SELECTION, NITRO_ALLOW]) expect(routingLaunchSelectionSchema.parse(selection)).toStrictEqual(selection)
  })
})
