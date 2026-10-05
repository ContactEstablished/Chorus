import { readFileSync } from 'node:fs'
import { types } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { reactive } from 'vue'

import {
  DEFAULT_ROUTING_SETTINGS,
  type ModelRegistryEntry,
  type RoutingCredential,
  type RoutingCredentialList,
  type RoutingLaunchPreferences,
  type RoutingModelList,
  type RoutingObservationSettings,
  type RoutingProgressEvent,
  type RoutingRefreshResult,
  type RoutingReply,
  type RoutingSettings,
  type RoutingStatus,
  type TierResult
} from '../../../shared/routing'
import { extractObservations, parseEndpointsResponse } from '../../../main/routing/endpointsCore'
import { bundledModelRegistry, findModel } from '../../../main/routing/registryCore'
import { computeTiers } from '../../../main/routing/routingCore'
import { plainRoutingInput, useRoutingStore } from './routing'
import { useRoutingLaunchStore } from './routingLaunch'

/*
 * A pass-through spy on the snapshot helper the launch store imports (behaviour
 * unchanged), so LS13 can prove every `tiers` and `refresh` argument IS the
 * object a `plainRoutingInput` call returned, not a literal built beside it: a
 * literal of primitives would pass the isProxy and structuredClone checks just as
 * well, and so could not catch a dropped snapshot.
 */
vi.mock('./routing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./routing')>()
  return { ...actual, plainRoutingInput: vi.fn(actual.plainRoutingInput) }
})

/**
 * Model Routing Task 4a-4, Table LS (ImplementationSpec-4a-4): the launch
 * dialog's routing store over a stubbed `window.chorus.routing` whose every
 * method is a `vi.fn` recording its argument. Real `structuredClone` and real
 * Vue reactivity stand in for the bridge (D14, MR-G5). Nothing here reaches
 * the network: the stub answers every call.
 */

// ── The golden TierResult (as routing.test.ts builds it) ──
const fixture = JSON.parse(
  readFileSync(new URL('../../../main/routing/__fixtures__/endpoints-deepseek-v4.1-flash-2026-10-02.json', import.meta.url), 'utf8')
) as { fetchedAt: string; guardrailRemoved: string[]; dataPolicyDenyRemoved: string[]; cacheVerified: Record<string, boolean> }
const SLUG = 'deepseek/deepseek-v4.1-flash'
const CHECKED_AT = '2026-10-02T09:15:39Z'
const snapshot = { fetchedAt: fixture.fetchedAt, endpoints: parseEndpointsResponse(fixture).endpoints }
const GOLDEN: TierResult = computeTiers({
  model: findModel(bundledModelRegistry(), SLUG) as ModelRegistryEntry,
  snapshot,
  history: extractObservations(snapshot),
  account: { guardrailRemoved: fixture.guardrailRemoved, dataPolicyRemoved: fixture.dataPolicyDenyRemoved, checkedAt: CHECKED_AT },
  cache: Object.fromEntries(Object.entries(fixture.cacheVerified).map(([tag, verified]) => [tag, { verified, checkedAt: CHECKED_AT }])),
  profile: 'interactive',
  effort: 'low',
  settings: DEFAULT_ROUTING_SETTINGS,
  now: '2026-10-02T09:20:00Z'
})

const A_ID = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a'
const C_ID = '5f0c1a2e-8a3b-4c5d-9e6f-0123456789ab'
const A: RoutingCredential = { id: A_ID, label: 'Key A', providerName: 'OpenRouter' }
const C: RoutingCredential = { id: C_ID, label: 'OR key', providerName: 'OpenRouter' }
const R1 = '11111111-1111-4111-8111-111111111111'
const R2 = '22222222-2222-4222-8222-222222222222'
const AT = '2026-10-02T09:20:00Z'

const MODELS: RoutingModelList = { models: [{ slug: SLUG, displayName: 'DeepSeek V4.1 Flash' }] }
const PREFERENCES: RoutingLaunchPreferences = { lastChoiceByModel: { [SLUG]: 'nitro' } }
const DORMANT: RoutingStatus = {
  observer: { state: 'dormant', dormantReason: 'undesignated', nextTickAt: null, lastTickAt: null, lastOutcome: null, lastFailure: null },
  models: [{ model: SLUG, displayName: 'DeepSeek V4.1 Flash', snapshotFetchedAt: null, observations: 0, cacheVerified: 0, busy: false }],
  requestsSinceStart: 0
}
const RANK = { model: SLUG, effort: 'high', credentialProfileId: C_ID }
const TIERS_REQUEST = { model: SLUG, profile: 'interactive', effort: 'high', credentialProfileId: C_ID }
const REFRESH_REQUEST = { model: SLUG, credentialProfileId: C_ID, profile: 'interactive', effort: 'high' }
const NO_SNAPSHOT_MESSAGE = 'No endpoint snapshot is stored for this model yet. Refresh first.'

const ok = <T>(value: T): RoutingReply<T> => ({ ok: true, value })
const fail = (code: Extract<RoutingReply<unknown>, { ok: false }>['code'], message: string): RoutingReply<never> => ({ ok: false, code, message })
function refreshResult(refreshId = R1): RoutingRefreshResult {
  return { refreshId, estimateUsd: 0.0493873956, spentUsd: 0.021, probed: ['deepinfra/fp8'], notProbed: [], result: structuredClone(GOLDEN) }
}
const progress = {
  endpoints: (refreshId: string, model = SLUG): RoutingProgressEvent => ({
    refreshId, model, at: AT, stage: 'endpoints', fetchedAt: AT, endpointRows: 33, tags: 32, rejectedRows: 0
  }),
  preflight: (refreshId: string): RoutingProgressEvent => ({
    refreshId, model: SLUG, at: AT, stage: 'preflight', checkedAt: AT,
    guardrails: { attempted: true, removed: ['deepseek'], issue: null, failure: null },
    dataPolicy: { attempted: true, removed: ['deepseek'], issue: null, failure: null }
  })
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

type Call<T> = Mock<(input: any) => Promise<RoutingReply<T>>>
interface StubApi {
  models: Call<RoutingModelList>
  tiers: Call<TierResult>
  refresh: Call<RoutingRefreshResult>
  status: Call<RoutingStatus>
  settingsGet: Call<RoutingSettings>
  settingsSet: Call<RoutingSettings>
  observationGet: Call<RoutingObservationSettings>
  observationSet: Call<RoutingObservationSettings>
  credentials: Call<RoutingCredentialList>
  launchPreferences: Call<RoutingLaunchPreferences>
  onProgress: Mock<(listener: (event: RoutingProgressEvent) => void) => () => void>
}
/** onProgress is left out: its argument is the store's local listener function, never an IPC payload. */
const REQUEST_METHODS = [
  'models', 'tiers', 'refresh', 'status', 'settingsGet', 'settingsSet', 'observationGet', 'observationSet', 'credentials', 'launchPreferences'
] as const

/**
 * One vi.fn per RoutingApi member. onProgress keeps every listener and returns
 * one dispose spy per subscription, so two stores' subscriptions are told apart.
 */
function stubRouting(): {
  api: StubApi
  emit: (event: RoutingProgressEvent) => void
  listeners: ((event: RoutingProgressEvent) => void)[]
  disposes: Mock<() => void>[]
} {
  const listeners: ((event: RoutingProgressEvent) => void)[] = []
  const disposes: Mock<() => void>[] = []
  const api: StubApi = {
    models: vi.fn(async () => ok(structuredClone(MODELS))),
    tiers: vi.fn(async () => ok(structuredClone(GOLDEN))),
    refresh: vi.fn(async () => ok(refreshResult())),
    status: vi.fn(async () => ok(structuredClone(DORMANT))),
    settingsGet: vi.fn(async () => ok(structuredClone(DEFAULT_ROUTING_SETTINGS))),
    settingsSet: vi.fn(async (input: { settings: RoutingSettings }) => ok(structuredClone(input.settings))),
    observationGet: vi.fn(async () => ok({ enabled: true, credentialProfileId: C_ID })),
    observationSet: vi.fn(async (input: RoutingObservationSettings) => ok(structuredClone(input))),
    credentials: vi.fn(async () => ok({ credentials: structuredClone([A, C]) })),
    launchPreferences: vi.fn(async () => ok(structuredClone(PREFERENCES))),
    onProgress: vi.fn((listener: (event: RoutingProgressEvent) => void) => {
      listeners.push(listener)
      const dispose = vi.fn(() => {
        const at = listeners.indexOf(listener)
        if (at >= 0) listeners.splice(at, 1)
      })
      disposes.push(dispose)
      return dispose
    })
  }
  vi.stubGlobal('window', { chorus: { routing: api } })
  return { api, emit: (event) => { for (const l of [...listeners]) l(event) }, listeners, disposes }
}

/** Every argument a request method received: plain (not a Proxy) and cloneable (D14, MR-G5). */
function expectPlainArguments(api: StubApi): number {
  let checked = 0
  for (const name of REQUEST_METHODS) {
    for (const args of api[name].mock.calls) {
      for (const arg of args) {
        expect(types.isProxy(arg), name).toBe(false)
        expect(() => structuredClone(arg), name).not.toThrow()
        checked++
      }
    }
  }
  return checked
}

/** Both stores' subscription counts are module state: release what is opened, again in afterEach (idempotent). */
const opened: (() => void)[] = []
function track(release: () => void): () => void {
  opened.push(release)
  return release
}

beforeEach(() => setActivePinia(createPinia()))
afterEach(() => {
  for (const release of opened.splice(0)) release()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('Table LS — launch routing store (Task 4a-4)', () => {
  it('LS1: its own progress subscription, independent of the Settings store', () => {
    const { api, disposes } = stubRouting()
    const launch = useRoutingLaunchStore()
    const settings = useRoutingStore()
    const releaseLaunch = track(launch.connect())
    const releaseSettings = track(settings.connect())
    expect(api.onProgress).toHaveBeenCalledTimes(2)
    const [first, second] = api.onProgress.mock.calls.map((c) => c[0])
    expect(typeof first).toBe('function')
    expect(first).not.toBe(second)
    // A second consumer of the launch store shares its subscription (its own reference count).
    const releaseAgain = track(launch.connect())
    expect(api.onProgress).toHaveBeenCalledTimes(2)
    releaseAgain()
    expect(disposes[0]).not.toHaveBeenCalled()

    releaseLaunch()
    releaseLaunch()
    expect(disposes[0]).toHaveBeenCalledTimes(1)
    expect(disposes[1]).not.toHaveBeenCalled()
    releaseSettings()
    expect(disposes[0]).toHaveBeenCalledTimes(1)
    expect(disposes[1]).toHaveBeenCalledTimes(1)
  })

  it('LS2: load reads the four free sources with {} and never ranks', async () => {
    const { api } = stubRouting()
    const store = useRoutingLaunchStore()
    await expect(store.load()).resolves.toBeUndefined()
    for (const name of ['models', 'credentials', 'settingsGet', 'launchPreferences'] as const) {
      expect(api[name], name).toHaveBeenCalledTimes(1)
      expect(api[name], name).toHaveBeenCalledWith({})
    }
    expect(api.status).not.toHaveBeenCalled()
    expect(api.observationGet).not.toHaveBeenCalled()
    expect(api.tiers).not.toHaveBeenCalled()
    expect(api.refresh).not.toHaveBeenCalled()
    expect(store.loaded).toBe(true)
    expect(store.loading).toBe(false)
    expect(store.loadError).toBeNull()
    expect(store.preferences).toStrictEqual({ lastChoiceByModel: { [SLUG]: 'nitro' } })
    expect(store.credentials).toStrictEqual([A, C])
    expect(store.models).toStrictEqual(MODELS.models)
    expect(store.settings).toStrictEqual(DEFAULT_ROUTING_SETTINGS)
  })

  it('LS2 (guard): a load while one is running returns at once', async () => {
    const { api } = stubRouting()
    const pending = deferred<RoutingReply<RoutingModelList>>()
    api.models.mockReturnValueOnce(pending.promise)
    const store = useRoutingLaunchStore()
    const first = store.load()
    await expect(store.load()).resolves.toBeUndefined()
    expect(api.models).toHaveBeenCalledTimes(1)
    pending.resolve(ok(structuredClone(MODELS)))
    await first
    expect(store.loaded).toBe(true)
  })

  it('LS3: the first failure in request order wins', async () => {
    const { api } = stubRouting()
    api.credentials.mockResolvedValueOnce(fail('OPERATION_FAILED', 'x'))
    api.launchPreferences.mockResolvedValueOnce(fail('INVALID_REQUEST', 'y'))
    const store = useRoutingLaunchStore()
    await expect(store.load()).resolves.toBeUndefined()
    expect(store.loadError).toStrictEqual({ code: 'OPERATION_FAILED', message: 'x' })
    expect(store.loaded).toBe(false)
    expect(store.loading).toBe(false)
  })

  it('LS4: rank uses interactive, the launch effort and the launch credential (K4)', async () => {
    const { api } = stubRouting()
    const store = useRoutingLaunchStore()
    await store.rank(RANK)
    expect(api.tiers).toHaveBeenNthCalledWith(1, TIERS_REQUEST)
    await store.rank({ ...RANK, effort: null })
    expect(api.tiers).toHaveBeenNthCalledWith(2, { ...TIERS_REQUEST, effort: null })
    expect(api.tiers).toHaveBeenCalledTimes(2)
    for (const [arg] of api.tiers.mock.calls) expect(arg.effort).not.toBe('low')
    expect(store.input).toStrictEqual({ model: SLUG, effort: null, credentialProfileId: C_ID })
    expect(store.tiers).toStrictEqual(GOLDEN)
    expect(store.tiersError).toBeNull()
    expect(store.tiersLoading).toBe(false)
  })

  it('LS5: of two overlapping ranks, the first reply arriving last is dropped', async () => {
    const { api } = stubRouting()
    const first = deferred<RoutingReply<TierResult>>()
    const second = deferred<RoutingReply<TierResult>>()
    api.tiers.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const store = useRoutingLaunchStore()
    const p1 = store.rank(RANK)
    const p2 = store.rank({ ...RANK, effort: 'low' })
    expect(store.tiersLoading).toBe(true)
    second.resolve(ok(structuredClone(GOLDEN)))
    await p2
    expect(store.tiers).toStrictEqual(GOLDEN)
    expect(store.tiersLoading).toBe(false)
    first.resolve(fail('NO_SNAPSHOT', NO_SNAPSHOT_MESSAGE))
    await p1
    expect(store.tiers).toStrictEqual(GOLDEN)
    expect(store.tiersError).toBeNull()
    expect(store.tiersLoading).toBe(false)
    expect(store.input).toStrictEqual({ ...RANK, effort: 'low' })
  })

  it('LS6: NO_SNAPSHOT keeps its code and is the no-snapshot state', async () => {
    const { api } = stubRouting()
    api.tiers.mockResolvedValueOnce(fail('NO_SNAPSHOT', NO_SNAPSHOT_MESSAGE))
    const store = useRoutingLaunchStore()
    await expect(store.rank(RANK)).resolves.toBeUndefined()
    expect(store.tiers).toBeNull()
    expect(store.tiersError).toStrictEqual({ code: 'NO_SNAPSHOT', message: NO_SNAPSHOT_MESSAGE })
    expect(store.tiersLoading).toBe(false)
  })

  it('LS7: clearTiers drops a pending rank', async () => {
    const { api } = stubRouting()
    const pending = deferred<RoutingReply<TierResult>>()
    api.tiers.mockReturnValueOnce(pending.promise)
    const store = useRoutingLaunchStore()
    const run = store.rank(RANK)
    store.clearTiers()
    expect(store.tiersLoading).toBe(false)
    pending.resolve(ok(structuredClone(GOLDEN)))
    await run
    expect(store.tiers).toBeNull()
    expect(store.input).toBeNull()
    expect(store.tiersError).toBeNull()
    expect(store.tiersLoading).toBe(false)
  })

  it('LS8: a refresh uses the launch credential and effort, adopts only its own events, then re-ranks', async () => {
    vi.useFakeTimers({ now: 2_000_000 })
    const { api, emit } = stubRouting()
    const store = useRoutingLaunchStore()
    track(store.connect())
    await store.rank(RANK)
    const pending = deferred<RoutingReply<RoutingRefreshResult>>()
    api.refresh.mockReturnValueOnce(pending.promise)
    const run = store.startRefresh()
    expect(api.refresh).toHaveBeenCalledTimes(1)
    expect(api.refresh).toHaveBeenCalledWith(REFRESH_REQUEST)

    emit(progress.endpoints(R1))
    emit(progress.endpoints(R2, 'other/model'))
    emit(progress.endpoints(R2))
    emit(progress.preflight(R1))
    expect(store.refresh.phase).toBe('running')
    expect(store.refresh.refreshId).toBe(R1)
    pending.resolve(ok(refreshResult(R1)))
    await run
    expect(store.refresh.events.map((e) => [e.refreshId, e.stage])).toStrictEqual([[R1, 'endpoints'], [R1, 'preflight']])
    expect(store.refresh.phase).toBe('done')
    expect(store.refresh.model).toBe(SLUG)
    expect(store.refresh.result).toStrictEqual(refreshResult(R1))
    expect(store.refresh.error).toBeNull()
    expect(store.refresh.endedAtMs).toBe(2_000_000)
    expect(api.tiers).toHaveBeenCalledTimes(2)
    for (const [arg] of api.tiers.mock.calls) expect(arg).toStrictEqual(TIERS_REQUEST)
    expect(store.tiers).toStrictEqual(GOLDEN)
  })

  it('LS9: no refresh without an input; a second refresh while one runs is ignored', async () => {
    const { api } = stubRouting()
    const store = useRoutingLaunchStore()
    await expect(store.startRefresh()).resolves.toBeUndefined()
    expect(api.refresh).not.toHaveBeenCalled()
    expect(store.refresh.phase).toBe('idle')

    await store.rank(RANK)
    const pending = deferred<RoutingReply<RoutingRefreshResult>>()
    api.refresh.mockReturnValueOnce(pending.promise)
    const first = store.startRefresh()
    await expect(store.startRefresh()).resolves.toBeUndefined()
    expect(api.refresh).toHaveBeenCalledTimes(1)
    pending.resolve(ok(refreshResult()))
    await first
    expect(api.refresh).toHaveBeenCalledTimes(1)
    expect(store.refresh.phase).toBe('done')
  })

  it('LS10: a cooldown BUSY keeps main\'s message, starts no countdown, and re-ranks (MR-D26)', async () => {
    const message = 'This model was refreshed less than a minute ago. Try again in 42 s.'
    const { api } = stubRouting()
    const store = useRoutingLaunchStore()
    await store.rank(RANK)
    api.refresh.mockResolvedValueOnce(fail('BUSY', message))
    await expect(store.startRefresh()).resolves.toBeUndefined()
    expect(store.refresh.phase).toBe('failed')
    expect(store.refresh.error).toStrictEqual({ code: 'BUSY', message })
    expect(store.refresh.error?.message).toBe(message)
    expect(store.refresh.endedAtMs).toBeNull()
    expect(api.tiers).toHaveBeenCalledTimes(2)
    expect(api.tiers).toHaveBeenLastCalledWith(TIERS_REQUEST)
    expect(store.tiers).toStrictEqual(GOLDEN)
  })

  it('LS11: reset restores every field but the refresh, and drops late rank and load replies', async () => {
    vi.useFakeTimers({ now: 2_000_000 })
    const { api } = stubRouting()
    const store = useRoutingLaunchStore()
    await store.load()
    await store.rank(RANK)
    await store.startRefresh()
    expect(store.refresh.phase).toBe('done')
    expect(store.refresh.endedAtMs).toBe(2_000_000)
    const refreshBefore = JSON.parse(JSON.stringify(store.refresh))

    const pendingTiers = deferred<RoutingReply<TierResult>>()
    api.tiers.mockReturnValueOnce(pendingTiers.promise)
    const pendingModels = deferred<RoutingReply<RoutingModelList>>()
    api.models.mockReturnValueOnce(pendingModels.promise)
    const ranking = store.rank(RANK)
    const loading = store.load()
    store.reset()
    pendingTiers.resolve(ok(structuredClone(GOLDEN)))
    pendingModels.resolve(ok(structuredClone(MODELS)))
    await ranking
    await loading
    // Not vacuous: the pre-reset load and rank really sent their requests.
    expect(api.models).toHaveBeenCalledTimes(2)
    expect(api.tiers).toHaveBeenCalledTimes(3)

    expect(store.loaded).toBe(false)
    expect(store.loading).toBe(false)
    expect(store.loadError).toBeNull()
    expect(store.models).toStrictEqual([])
    expect(store.credentials).toStrictEqual([])
    expect(store.settings).toBeNull()
    expect(store.preferences).toBeNull()
    expect(store.input).toBeNull()
    expect(store.tiers).toBeNull()
    expect(store.tiersError).toBeNull()
    expect(store.tiersLoading).toBe(false)
    expect(store.refresh.phase).toBe('done')
    expect(store.refresh.endedAtMs).toBe(2_000_000)
    expect(JSON.parse(JSON.stringify(store.refresh))).toStrictEqual(refreshBefore)
  })

  it('LS12: isolation: the Settings store is untouched and no launch request carries the inspector effort', async () => {
    vi.useFakeTimers({ now: 2_000_000 })
    const { api, emit } = stubRouting()
    const settings = useRoutingStore()
    const launch = useRoutingLaunchStore()
    track(settings.connect())
    track(launch.connect())
    await launch.load() // LS2
    await launch.rank(RANK) // LS4
    await launch.rank({ ...RANK, effort: null })
    await launch.rank(RANK)
    const pending = deferred<RoutingReply<RoutingRefreshResult>>()
    api.refresh.mockReturnValueOnce(pending.promise)
    const run = launch.startRefresh() // LS8
    emit(progress.endpoints(R1))
    emit(progress.preflight(R1))
    pending.resolve(ok(refreshResult(R1)))
    await run
    expect(launch.refresh.phase).toBe('done')
    expect(launch.refresh.events).toHaveLength(2)

    expect(settings.tiers).toBeNull()
    expect(settings.refresh.phase).toBe('idle')
    expect(settings.refresh.events).toStrictEqual([])
    expect(settings.loaded).toBe(false)
    expect(settings.models).toStrictEqual([])
    expect(settings.credentials).toStrictEqual([])
    expect(api.tiers.mock.calls.length).toBeGreaterThanOrEqual(4)
    for (const [arg] of api.tiers.mock.calls) {
      expect(arg.effort).not.toBe('low')
      expect(arg.profile).toBe('interactive')
    }
    for (const [arg] of api.refresh.mock.calls) expect(arg.effort).toBe('high')
  })

  it('LS13: every recorded argument is plain and cloneable, even from a reactive input; the negative control proves why', async () => {
    const { api } = stubRouting()
    const snapshot = vi.mocked(plainRoutingInput)
    snapshot.mockClear()
    const store = useRoutingLaunchStore()
    await store.load()
    const input = reactive({ ...RANK })
    expect(types.isProxy(input)).toBe(true)
    await store.rank(input)
    await store.startRefresh()
    for (const name of ['models', 'credentials', 'settingsGet', 'launchPreferences', 'tiers', 'refresh'] as const) {
      expect(api[name].mock.calls.length, name).toBeGreaterThan(0)
    }
    expect(expectPlainArguments(api)).toBeGreaterThanOrEqual(7)
    expect(api.tiers).toHaveBeenCalledWith(TIERS_REQUEST)
    // Each tiers/refresh argument is the very object a plainRoutingInput call returned, in call
    // order (rank, refresh, re-rank). Drop the snapshot from either call and this fails.
    const snapshots = snapshot.mock.results.map((r) => r.value)
    const sent = [api.tiers.mock.calls[0][0], api.refresh.mock.calls[0][0], api.tiers.mock.calls[1][0]]
    expect(api.tiers).toHaveBeenCalledTimes(2)
    expect(api.refresh).toHaveBeenCalledTimes(1)
    expect(snapshots).toHaveLength(3)
    sent.forEach((arg, i) => expect(arg, `IPC argument ${i}`).toBe(snapshots[i]))
    // load's four arguments are the literal {} (no snapshot needed, none taken).
    for (const name of ['models', 'credentials', 'settingsGet', 'launchPreferences'] as const) expect(api[name]).toHaveBeenCalledWith({})
    // Negative control (D14): the store's own state is a Proxy the bridge would refuse without the snapshot.
    expect(types.isProxy(store.input)).toBe(true)
    expect(() => structuredClone(store.input)).toThrow(/could not be cloned/)
  })

  it('LS14: a bridge clone error does not escape; with no bridge every action resolves and records OPERATION_FAILED', async () => {
    const { api } = stubRouting()
    const store = useRoutingLaunchStore()
    await store.rank(RANK)
    api.refresh.mockRejectedValueOnce(new Error('An object could not be cloned.'))
    await expect(store.startRefresh()).resolves.toBeUndefined()
    expect(store.refresh.phase).toBe('failed')
    expect(store.refresh.error).toStrictEqual({ code: 'OPERATION_FAILED', message: 'An object could not be cloned.' })
    expect(store.refresh.endedAtMs).toBeNull()

    vi.stubGlobal('window', {})
    setActivePinia(createPinia())
    const bare = useRoutingLaunchStore()
    expect(() => track(bare.connect())).not.toThrow()
    await expect(bare.load()).resolves.toBeUndefined()
    expect(bare.loadError?.code).toBe('OPERATION_FAILED')
    expect(bare.loading).toBe(false)
    await expect(bare.rank(RANK)).resolves.toBeUndefined()
    expect(bare.tiersError?.code).toBe('OPERATION_FAILED')
    expect(bare.tiersLoading).toBe(false)
    await expect(bare.startRefresh()).resolves.toBeUndefined()
    expect(bare.refresh.phase).toBe('failed')
    expect(bare.refresh.error?.code).toBe('OPERATION_FAILED')
    expect(() => bare.clearTiers()).not.toThrow()
    expect(() => bare.reset()).not.toThrow()
  })

  it('LS15: the store starts no timer', async () => {
    vi.useFakeTimers()
    stubRouting()
    const store = useRoutingLaunchStore()
    track(store.connect())
    expect(vi.getTimerCount()).toBe(0)
    await store.load()
    expect(vi.getTimerCount()).toBe(0)
    await store.rank(RANK)
    expect(vi.getTimerCount()).toBe(0)
    await store.startRefresh()
    expect(vi.getTimerCount()).toBe(0)
    store.clearTiers()
    expect(vi.getTimerCount()).toBe(0)
    store.reset()
    expect(vi.getTimerCount()).toBe(0)
  })
})
