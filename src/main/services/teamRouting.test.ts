import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_ROUTING_SETTINGS, type RoutingLaunchRequest, type RoutingLaunchSelection } from '../../shared/routing'
import type { TeamMember } from '../../shared/team'
import { HELPER_ROUTING_REFUSALS } from '../routing/helperRoutingCore'
import { RoutingError } from './routingService'
import { createTeamRoutingPort, type TeamRoutingServiceLike } from './teamRouting'

const SLUG = 'deepseek/deepseek-v4.1-flash', NITRO = SLUG + ':nitro'
const C = '5f0c1a2e-8a3b-4c5d-9e6f-0123456789ab', D = '0b6d2c4e-1f3a-4b5c-8d7e-9f0a1b2c3d4e'
const MEMBER: TeamMember = { id: C, label: 'Helper Balanced', harness: 'opencode', authMode: 'api_key', providerId: D, credentialProfileId: C, model: NITRO, effort: 'low', installedVersion: '1.18.34', customModel: true, routingTier: 'balanced' }
const SELECTION: RoutingLaunchSelection = { tier: 'balanced', model: SLUG, sentModelId: SLUG, provider: { order: ['streamlake/fp8', 'venice/fp8', 'gmicloud/fp8'], allow_fallbacks: false, require_parameters: true, quantizations: ['fp8'], data_collection: 'deny' }, endpoints: ['streamlake/fp8', 'venice/fp8', 'gmicloud/fp8'], computedAt: '2026-10-02T09:20:00Z', snapshotFetchedAt: '2026-10-02T09:05:00Z' }
const UNAVAILABLE = 'Model routing is not available right now. Launch this helper with OpenRouter default instead.'

/** A deliberately small fake: property access outside the four port methods fails. */
function fake() {
  const calls: string[] = [], requests: RoutingLaunchRequest[] = []
  const methods = {
    credentials: vi.fn(() => { calls.push('credentials'); return { credentials: [{ id: C }] } }),
    models: vi.fn(() => { calls.push('models'); return { models: [{ slug: SLUG }] } }),
    resolveLaunch: vi.fn((request: RoutingLaunchRequest) => { calls.push('resolveLaunch'); requests.push(request); return SELECTION }),
    getSettings: vi.fn(() => { calls.push('getSettings'); return { ...DEFAULT_ROUTING_SETTINGS, snapshotMaxAgeMinutes: 45 } })
  }
  const service = new Proxy(methods, { get(target, property) {
    if (!Object.prototype.hasOwnProperty.call(target, property)) throw new Error(`Unexpected service property ${String(property)}.`)
    return Reflect.get(target, property)
  } }) as unknown as TeamRoutingServiceLike
  return { methods, service, calls, requests, port: createTeamRoutingPort(() => service) }
}

describe('Table TR — Team routing port', () => {
  it('TR1: an unrouted member never reaches the service thunk', () => {
    const thunk = vi.fn(() => { throw new Error('Must not be read.') }), port = createTeamRoutingPort(thunk)
    const { routingTier: _tier, ...member } = MEMBER
    expect(port.check(member)).toStrictEqual({ ok: true })
    expect(port.resolve(member)).toStrictEqual({ ok: true, selection: null })
    expect(thunk).not.toHaveBeenCalled()
  })
  it('TR2: check reads only the two eligibility lists', () => {
    const h = fake()
    expect(h.port.check(MEMBER)).toStrictEqual({ ok: true })
    expect(h.calls).toEqual(['credentials', 'models'])
  })
  it('TR3: resolution sends the exact helper-profile request with the member effort and credential', () => {
    const h = fake()
    expect(h.port.resolve(MEMBER)).toStrictEqual({ ok: true, selection: SELECTION })
    expect(h.port.resolve({ ...MEMBER, model: 'openrouter/' + NITRO, effort: null, routingTier: 'nitro' })).toStrictEqual({ ok: true, selection: SELECTION })
    expect(h.requests).toStrictEqual([
      { model: SLUG, tier: 'balanced', effort: 'low', credentialProfileId: C, profile: 'helper' },
      { model: SLUG, tier: 'nitro', effort: null, credentialProfileId: C, profile: 'helper' }
    ])
    expect(h.calls).toEqual(['credentials', 'models', 'resolveLaunch', 'credentials', 'models', 'resolveLaunch'])
  })
  it('TR4: missing or throwing service and list reads are unavailable', () => {
    for (const failure of ['null', 'thunk', 'credentials', 'models']) {
      const h = fake()
      if (failure === 'credentials' || failure === 'models') h.methods[failure].mockImplementation(() => { throw new Error('Private failure.') })
      const port = createTeamRoutingPort(() => { if (failure === 'thunk') throw new Error('Private failure.'); return failure === 'null' ? null : h.service })
      expect(port.check(MEMBER)).toStrictEqual({ ok: false, reason: UNAVAILABLE })
      expect(port.resolve(MEMBER)).toStrictEqual({ ok: false, reason: UNAVAILABLE })
      expect(h.methods.resolveLaunch).not.toHaveBeenCalled()
    }
  })
  it('TR5: eligibility failures are exact and never reach resolution', () => {
    const rows: [TeamMember, string][] = [
      [{ ...MEMBER, harness: 'codex', authMode: 'subscription', providerId: null, credentialProfileId: null }, HELPER_ROUTING_REFUSALS.notOpencode],
      [{ ...MEMBER, credentialProfileId: D }, HELPER_ROUTING_REFUSALS.credentialRefused],
      [{ ...MEMBER, model: 'z-ai/glm-5.3' }, HELPER_ROUTING_REFUSALS.unknownModel]
    ]
    for (const [member, reason] of rows) {
      const h = fake()
      expect(h.port.check(member)).toStrictEqual({ ok: false, reason })
      expect(h.port.resolve(member)).toStrictEqual({ ok: false, reason })
      expect(h.methods.resolveLaunch).not.toHaveBeenCalled()
    }
  })
  it('TR6: RoutingError maps to the exact refusal and reads settings only for stale numbers', () => {
    const rows: [RoutingError, boolean, string, number][] = [
      [new RoutingError('NO_SNAPSHOT', 'No endpoint snapshot is stored for this model yet. Refresh first.'), false, 'Balanced routing refused this helper attempt: no endpoint numbers are stored for deepseek/deepseek-v4.1-flash. Refresh them in Settings → Model routing, then revise the task.', 0],
      [new RoutingError('SNAPSHOT_STALE', 'The endpoint snapshot for this model is more than 60 minutes old. Refresh first.'), false, 'Balanced routing refused this helper attempt: the endpoint numbers for deepseek/deepseek-v4.1-flash are more than 45 minutes old. Refresh them in Settings → Model routing, or turn on background observation there to keep them fresh, then revise the task.', 1],
      [new RoutingError('SNAPSHOT_STALE', 'The endpoint snapshot for this model is more than 60 minutes old. Refresh first.'), true, 'Balanced routing could not be resolved for this helper attempt: The endpoint snapshot for this model is more than 60 minutes old. Refresh first.', 1],
      [new RoutingError('TIER_EMPTY', 'Balanced has no eligible endpoints. Choose another tier or OpenRouter default.'), false, 'Balanced routing refused this helper attempt: no endpoint for deepseek/deepseek-v4.1-flash meets the Balanced rules right now. Revise the task to a helper on another tier, or refresh later.', 0],
      [new RoutingError('OPERATION_FAILED', 'Routing has stopped.'), false, 'Balanced routing could not be resolved for this helper attempt: Routing has stopped.', 0]
    ]
    for (const [error, settingsFail, reason, settingsReads] of rows) {
      const h = fake()
      h.methods.resolveLaunch.mockImplementation(() => { throw error })
      if (settingsFail) h.methods.getSettings.mockImplementation(() => { throw new Error('Private settings failure.') })
      expect(h.port.resolve(MEMBER)).toStrictEqual({ ok: false, reason })
      expect(h.methods.getSettings).toHaveBeenCalledTimes(settingsReads)
    }
  })
  it('TR7: arbitrary error text never reaches the refusal', () => {
    const h = fake()
    h.methods.resolveLaunch.mockImplementation(() => { throw new Error('C:\\secret\\path exploded') })
    expect(h.port.resolve(MEMBER)).toStrictEqual({ ok: false, reason: 'Balanced routing could not be resolved for this helper attempt: Routing operation failed.' })
    expect(h.methods.getSettings).not.toHaveBeenCalled()
  })
  it('TR8: every call reads the current thunk value', () => {
    const h = fake()
    let current: TeamRoutingServiceLike | null = null
    const thunk = vi.fn(() => current), port = createTeamRoutingPort(thunk)
    expect(port.resolve(MEMBER)).toStrictEqual({ ok: false, reason: UNAVAILABLE })
    current = h.service
    expect(port.resolve(MEMBER)).toStrictEqual({ ok: true, selection: SELECTION })
    current = null
    expect(port.check(MEMBER)).toStrictEqual({ ok: false, reason: UNAVAILABLE })
    expect(thunk).toHaveBeenCalledTimes(3)
  })
})
