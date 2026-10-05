import { readFileSync } from 'node:fs'
import { types } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { reactive } from 'vue'
import { DEFAULT_ROUTING_SETTINGS, type ModelRegistryEntry, type RoutingApi, type RoutingCredential, type RoutingReply, type TierResult } from '../../../shared/routing'
import { extractObservations, parseEndpointsResponse } from '../../../main/routing/endpointsCore'
import { bundledModelRegistry, findModel } from '../../../main/routing/registryCore'
import { computeTiers } from '../../../main/routing/routingCore'
import { plainRoutingInput, useRoutingStore } from './routing'
import { useRoutingLaunchStore } from './routingLaunch'
import { routingTeamKey, useRoutingTeamStore } from './routingTeam'

vi.mock('./routing', async importOriginal => {
  const actual = await importOriginal<typeof import('./routing')>()
  return { ...actual, plainRoutingInput: vi.fn(actual.plainRoutingInput) }
})

const fixture = JSON.parse(readFileSync(new URL('../../../main/routing/__fixtures__/endpoints-deepseek-v4.1-flash-2026-10-02.json', import.meta.url), 'utf8')) as { fetchedAt: string; guardrailRemoved: string[]; dataPolicyDenyRemoved: string[]; cacheVerified: Record<string, boolean> }
const SLUG = 'deepseek/deepseek-v4.1-flash', CHECKED_AT = '2026-10-02T09:15:39Z'
const snapshot = { fetchedAt: fixture.fetchedAt, endpoints: parseEndpointsResponse(fixture).endpoints }
const helper = (now: string): TierResult => computeTiers({
  model: findModel(bundledModelRegistry(), SLUG) as ModelRegistryEntry, snapshot, history: extractObservations(snapshot),
  account: { guardrailRemoved: fixture.guardrailRemoved, dataPolicyRemoved: fixture.dataPolicyDenyRemoved, checkedAt: CHECKED_AT },
  cache: Object.fromEntries(Object.entries(fixture.cacheVerified).map(([tag, verified]) => [tag, { verified, checkedAt: CHECKED_AT }])),
  profile: 'helper', effort: 'low', settings: DEFAULT_ROUTING_SETTINGS, now
})
const HELPER = helper('2026-10-02T09:20:00Z'), HELPER_STALE = helper('2026-10-02T10:06:00Z')
const A_ID = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a', C_ID = '5f0c1a2e-8a3b-4c5d-9e6f-0123456789ab'
const A: RoutingCredential = { id: A_ID, label: 'Key A', providerName: 'OpenRouter' }, C: RoutingCredential = { id: C_ID, label: 'OR key', providerName: 'OpenRouter' }
const MODELS = { models: [{ slug: SLUG, displayName: 'DeepSeek V4.1 Flash' }] }
const RANK = { model: SLUG, effort: 'low', credentialProfileId: C_ID }, RANK_A = { model: SLUG, effort: null, credentialProfileId: A_ID }
const KEY = '5f0c1a2e-8a3b-4c5d-9e6f-0123456789ab|deepseek/deepseek-v4.1-flash|low'
const KEY_A = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a|deepseek/deepseek-v4.1-flash|'
const TIERS_REQUEST = { model: SLUG, profile: 'helper', effort: 'low', credentialProfileId: C_ID }
const TIERS_REQUEST_A = { model: SLUG, profile: 'helper', effort: null, credentialProfileId: A_ID }
const NO_SNAPSHOT_MESSAGE = 'No endpoint snapshot is stored for this model yet. Refresh first.'
const ok = <T>(value: T): RoutingReply<T> => ({ ok: true, value })
const fail = (code: Extract<RoutingReply<unknown>, { ok: false }>['code'], message: string): RoutingReply<never> => ({ ok: false, code, message })
type StubApi = { [K in keyof RoutingApi]: Mock<RoutingApi[K]> }
const REQUEST_METHODS = ['models', 'credentials', 'settingsGet', 'tiers', 'refresh', 'status', 'settingsSet', 'observationGet', 'observationSet', 'launchPreferences'] as const
const NEVER = ['refresh', 'status', 'settingsSet', 'observationGet', 'observationSet', 'launchPreferences', 'onProgress'] as const
function stubRouting(): StubApi {
  const api: StubApi = {
    models: vi.fn(async () => ok(structuredClone(MODELS))),
    credentials: vi.fn(async () => ok({ credentials: structuredClone([A, C]) })),
    settingsGet: vi.fn(async () => ok(structuredClone(DEFAULT_ROUTING_SETTINGS))),
    tiers: vi.fn(async () => ok(structuredClone(HELPER))),
    refresh: vi.fn(async () => fail('OPERATION_FAILED', 'Unexpected refresh.')),
    status: vi.fn(async () => fail('OPERATION_FAILED', 'Unexpected status.')),
    settingsSet: vi.fn(async () => fail('OPERATION_FAILED', 'Unexpected settings write.')),
    observationGet: vi.fn(async () => fail('OPERATION_FAILED', 'Unexpected observation read.')),
    observationSet: vi.fn(async () => fail('OPERATION_FAILED', 'Unexpected observation write.')),
    launchPreferences: vi.fn(async () => fail('OPERATION_FAILED', 'Unexpected preferences read.')),
    onProgress: vi.fn(() => () => {})
  }
  vi.stubGlobal('window', { chorus: { routing: api } })
  return api
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}
beforeEach(() => setActivePinia(createPinia()))
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('Table HS — Team routing store (Task 4b-3)', () => {
  it('HS1: keys distinguish credential, base model and effort', () => {
    expect(routingTeamKey(RANK)).toBe(KEY)
    expect(routingTeamKey(RANK_A)).toBe(KEY_A)
    expect(routingTeamKey({ ...RANK, effort: 'medium' })).toBe('5f0c1a2e-8a3b-4c5d-9e6f-0123456789ab|deepseek/deepseek-v4.1-flash|medium')
  })
  it('HS2: load makes exactly three free reads and assigns the complete data', async () => {
    const api = stubRouting(), store = useRoutingTeamStore()
    await store.load()
    for (const method of ['models', 'credentials', 'settingsGet'] as const) { expect(api[method]).toHaveBeenCalledTimes(1); expect(api[method]).toHaveBeenCalledWith({}) }
    for (const method of ['tiers', ...NEVER] as const) expect(api[method]).not.toHaveBeenCalled()
    expect(store.loaded).toBe(true); expect(store.loading).toBe(false); expect(store.loadError).toBeNull()
    expect(store.models).toStrictEqual(MODELS.models); expect(store.credentials).toStrictEqual([A, C]); expect(store.settings).toStrictEqual(DEFAULT_ROUTING_SETTINGS)
  })
  it('HS3: the first failure in request order wins without half-assigned state', async () => {
    const api = stubRouting(), store = useRoutingTeamStore()
    api.credentials.mockResolvedValue(fail('OPERATION_FAILED', 'x')); api.settingsGet.mockResolvedValue(fail('INVALID_REQUEST', 'y'))
    await store.load()
    expect(store.loadError).toStrictEqual({ code: 'OPERATION_FAILED', message: 'x' })
    expect(store.loaded).toBe(false); expect(store.loading).toBe(false)
    expect(store.models).toStrictEqual([]); expect(store.credentials).toStrictEqual([]); expect(store.settings).toBeNull()
  })
  it('HS4: rank marks loading before the first await and ranks the helper profile', async () => {
    const api = stubRouting(), store = useRoutingTeamStore(), work = store.rank(RANK)
    expect(store.results).toStrictEqual({ [KEY]: { input: RANK, loading: true, tiers: null, error: null } })
    await work
    expect(api.tiers).toHaveBeenCalledTimes(1); expect(api.tiers).toHaveBeenCalledWith(TIERS_REQUEST)
    expect(store.results).toStrictEqual({ [KEY]: { input: RANK, loading: false, tiers: HELPER, error: null } })
  })
  it('HS5: separate slot keys retain their own rankings and arguments', async () => {
    const api = stubRouting(), store = useRoutingTeamStore()
    api.tiers.mockResolvedValueOnce(ok(HELPER)).mockResolvedValueOnce(ok(HELPER_STALE))
    await Promise.all([store.rank(RANK), store.rank(RANK_A)])
    expect(api.tiers.mock.calls.map(args => args[0])).toStrictEqual([TIERS_REQUEST, TIERS_REQUEST_A])
    expect(Object.keys(store.results).sort()).toEqual([KEY_A, KEY])
    expect(store.results[KEY].tiers).toStrictEqual(HELPER); expect(store.results[KEY_A].tiers).toStrictEqual(HELPER_STALE)
  })
  it('HS6: stale replies are dropped per key while other keys remain independent', async () => {
    const api = stubRouting(), store = useRoutingTeamStore()
    const first = deferred<RoutingReply<TierResult>>(), second = deferred<RoutingReply<TierResult>>(), third = deferred<RoutingReply<TierResult>>()
    api.tiers.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise)
    const one = store.rank(RANK), two = store.rank(RANK), three = store.rank(RANK_A)
    second.resolve(ok(HELPER_STALE)); third.resolve(ok(HELPER)); await Promise.all([two, three])
    first.resolve(ok(HELPER)); await one
    expect(store.results[KEY]).toStrictEqual({ input: RANK, loading: false, tiers: HELPER_STALE, error: null })
    expect(store.results[KEY_A]).toStrictEqual({ input: RANK_A, loading: false, tiers: HELPER, error: null })
  })
  it('HS7: no snapshot is retained as the view’s explicit entry state', async () => {
    const api = stubRouting(), store = useRoutingTeamStore()
    api.tiers.mockResolvedValue(fail('NO_SNAPSHOT', NO_SNAPSHOT_MESSAGE))
    await store.rank(RANK)
    expect(store.results[KEY]).toStrictEqual({ input: RANK, loading: false, tiers: null, error: { code: 'NO_SNAPSHOT', message: NO_SNAPSHOT_MESSAGE } })
  })
  it('HS8: reset drops late load and rank replies and accepts a new rank', async () => {
    const api = stubRouting(), store = useRoutingTeamStore()
    const models = deferred<Awaited<ReturnType<RoutingApi['models']>>>(), tiers = deferred<RoutingReply<TierResult>>()
    api.models.mockReturnValueOnce(models.promise); api.tiers.mockReturnValueOnce(tiers.promise)
    const load = store.load(), rank = store.rank(RANK)
    store.reset(); models.resolve(ok(MODELS)); tiers.resolve(ok(HELPER)); await Promise.all([load, rank])
    expect(store.$state).toStrictEqual({ loaded: false, loading: false, loadError: null, models: [], credentials: [], settings: null, results: {} })
    await store.rank(RANK)
    expect(store.results[KEY]).toStrictEqual({ input: RANK, loading: false, tiers: HELPER, error: null })
  })
  it('HS9: every argument is a plain snapshot with a real reactive negative control', async () => {
    const api = stubRouting(), store = useRoutingTeamStore(), snapshotSpy = vi.mocked(plainRoutingInput)
    snapshotSpy.mockClear()
    await store.load(); await store.rank(reactive({ ...RANK }))
    let count = 0
    for (const method of REQUEST_METHODS) for (const args of api[method].mock.calls) for (const arg of args) {
      expect(types.isProxy(arg), method).toBe(false)
      expect(() => structuredClone(arg), method).not.toThrow(); count++
    }
    expect(count).toBe(4)
    for (const method of ['models', 'credentials', 'settingsGet'] as const) expect(api[method]).toHaveBeenCalledWith({})
    expect(snapshotSpy).toHaveBeenCalledTimes(1)
    expect(api.tiers.mock.calls[0][0]).toBe(snapshotSpy.mock.results[0].value)
    expect(api.tiers).toHaveBeenCalledWith(TIERS_REQUEST)
    expect(types.isProxy(store.results[KEY].input)).toBe(true)
    expect(() => structuredClone(store.results[KEY].input)).toThrow(/could not be cloned/)
  })
  it('HS10: bridge failures resolve to state and reset remains safe without a bridge', async () => {
    const api = stubRouting(), store = useRoutingTeamStore()
    api.tiers.mockRejectedValue(new Error('An object could not be cloned.'))
    await expect(store.rank(RANK)).resolves.toBeUndefined()
    expect(store.results[KEY].error).toStrictEqual({ code: 'OPERATION_FAILED', message: 'An object could not be cloned.' })
    vi.stubGlobal('window', {}); setActivePinia(createPinia())
    const absent = useRoutingTeamStore()
    await expect(absent.load()).resolves.toBeUndefined()
    expect(absent.loadError?.code).toBe('OPERATION_FAILED'); expect(absent.loading).toBe(false)
    await expect(absent.rank(RANK)).resolves.toBeUndefined()
    expect(absent.results[KEY].error?.code).toBe('OPERATION_FAILED'); expect(absent.results[KEY].loading).toBe(false)
    expect(() => absent.reset()).not.toThrow()
  })
  it('HS11: helper actions create no timers, subscriptions, writes or changes in other stores', async () => {
    vi.useFakeTimers()
    const api = stubRouting(), team = useRoutingTeamStore(), launch = useRoutingLaunchStore(), settings = useRoutingStore()
    const beforeLaunch = JSON.stringify(launch.$state), beforeSettings = JSON.stringify(settings.$state)
    await team.load(); expect(vi.getTimerCount()).toBe(0)
    await team.rank(RANK); expect(vi.getTimerCount()).toBe(0)
    team.reset(); expect(vi.getTimerCount()).toBe(0)
    for (const method of NEVER) expect(api[method]).not.toHaveBeenCalled()
    expect(JSON.stringify(launch.$state)).toBe(beforeLaunch); expect(JSON.stringify(settings.$state)).toBe(beforeSettings)
  })
})
