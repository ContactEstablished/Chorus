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
import { RoutingReplyError, plainRoutingInput, routingFailure, routingValue, useRoutingStore } from './routing'

/**
 * Model Routing Task 3-2, Table RS (ImplementationSpec-3-2): the routing
 * store over a stubbed `window.chorus.routing` whose every method is a
 * `vi.fn` recording its argument. Real `structuredClone` and real Vue
 * reactivity stand in for the bridge (D14, MR-G5); the real bridge is
 * exercised by Task 3-4's built-app drive.
 */

// ── The golden TierResult (routingIpc.test.ts) ──
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
const X_ID = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f'
const A: RoutingCredential = { id: A_ID, label: 'Key A', providerName: 'OpenRouter' }
const C: RoutingCredential = { id: C_ID, label: 'OR key', providerName: 'OpenRouter' }
const R1 = '11111111-1111-4111-8111-111111111111'
const R2 = '22222222-2222-4222-8222-222222222222'
const R3 = '33333333-3333-4333-8333-333333333333'
const AT = '2026-10-02T09:20:00Z'

const MODELS: RoutingModelList = { models: [{ slug: SLUG, displayName: 'DeepSeek V4.1 Flash' }] }
const DORMANT: RoutingStatus = {
  observer: { state: 'dormant', dormantReason: 'undesignated', nextTickAt: null, lastTickAt: null, lastOutcome: null, lastFailure: null },
  models: [{ model: SLUG, displayName: 'DeepSeek V4.1 Flash', snapshotFetchedAt: null, observations: 0, cacheVerified: 0, busy: false }],
  requestsSinceStart: 0
}
const TIERS_REQUEST = { model: SLUG, profile: 'interactive', effort: 'low', credentialProfileId: C_ID }
const REFRESH_REQUEST = { model: SLUG, credentialProfileId: C_ID, profile: 'interactive', effort: 'low' }

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
  }),
  failed: (refreshId: string): RoutingProgressEvent => ({
    refreshId, model: SLUG, at: AT, stage: 'failed', code: 'FETCH_FAILED', failure: 'provider-error', message: 'OpenRouter returned an error.', spentUsd: 0
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
  onProgress: Mock<(listener: (event: RoutingProgressEvent) => void) => () => void>
}
/** onProgress is left out: its argument is the store's local listener function, never an IPC payload. */
const REQUEST_METHODS = [
  'models', 'tiers', 'refresh', 'status', 'settingsGet', 'settingsSet', 'observationGet', 'observationSet', 'credentials'
] as const

/** One vi.fn per RoutingApi member; settingsSet and observationSet echo their input. Returns the api, the captured listener and the dispose spy. */
function stubRouting(overrides: Partial<{ credentials: RoutingCredential[]; observation: RoutingObservationSettings }> = {}): {
  api: StubApi
  emit: (event: RoutingProgressEvent) => void
  dispose: Mock<() => void>
  settingsReplies: RoutingSettings[]
} {
  let listener: ((event: RoutingProgressEvent) => void) | null = null
  const dispose = vi.fn(() => { listener = null })
  const settingsReplies: RoutingSettings[] = []
  const api: StubApi = {
    models: vi.fn(async () => ok(structuredClone(MODELS))),
    tiers: vi.fn(async () => ok(structuredClone(GOLDEN))),
    refresh: vi.fn(async () => ok(refreshResult())),
    status: vi.fn(async () => ok(structuredClone(DORMANT))),
    settingsGet: vi.fn(async () => {
      const reply = structuredClone(DEFAULT_ROUTING_SETTINGS)
      settingsReplies.push(reply)
      return ok(reply)
    }),
    settingsSet: vi.fn(async (input: { settings: RoutingSettings }) => ok(structuredClone(input.settings))),
    observationGet: vi.fn(async () => ok(structuredClone(overrides.observation ?? { enabled: true, credentialProfileId: C_ID }))),
    observationSet: vi.fn(async (input: RoutingObservationSettings) => ok(structuredClone(input))),
    credentials: vi.fn(async () => ok({ credentials: structuredClone(overrides.credentials ?? [A, C]) })),
    onProgress: vi.fn((l: (event: RoutingProgressEvent) => void) => {
      listener = l
      return dispose
    })
  }
  vi.stubGlobal('window', { chorus: { routing: api } })
  return { api, emit: (event) => listener?.(event), dispose, settingsReplies }
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

/**
 * The subscription count is module state (as in team.ts). Tests release what
 * they open; afterEach releases it again (idempotent) so a failing test cannot
 * leave a subscription that hides the next test's listener.
 */
const opened: (() => void)[] = []
function connect(store: ReturnType<typeof useRoutingStore>): () => void {
  const release = store.connect()
  opened.push(release)
  return release
}

beforeEach(() => setActivePinia(createPinia()))
afterEach(() => {
  for (const release of opened.splice(0)) release()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('Table RS — routing store', () => {
  it('RS1: plainRoutingInput snapshots nested Vue proxies; the negative control proves structuredClone rejects them', () => {
    const state = reactive({ settings: { tierWeights: { budget: 0.3 } } })
    expect(types.isProxy(state)).toBe(true)
    expect(types.isProxy(state.settings.tierWeights)).toBe(true)
    const plain = plainRoutingInput(state)
    expect(types.isProxy(plain)).toBe(false)
    expect(types.isProxy(plain.settings)).toBe(false)
    expect(types.isProxy(plain.settings.tierWeights)).toBe(false)
    expect(() => structuredClone(plain)).not.toThrow()
    expect(plain).toEqual({ settings: { tierWeights: { budget: 0.3 } } })
    plain.settings.tierWeights.budget = 0.9
    expect(state.settings.tierWeights.budget).toBe(0.3)
    expect(() => structuredClone(reactive({ a: { b: 1 } }))).toThrow(/could not be cloned/)
  })

  it('RS2: routingValue keeps the code; routingFailure maps errors', () => {
    expect(routingValue(ok(42))).toBe(42)
    let thrown: unknown = null
    try {
      routingValue(fail('NO_SNAPSHOT', 'm'))
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(RoutingReplyError)
    expect(thrown).toBeInstanceOf(Error)
    expect(thrown).toMatchObject({ code: 'NO_SNAPSHOT', message: 'm', name: 'RoutingReplyError' })
    expect(routingFailure(thrown)).toStrictEqual({ code: 'NO_SNAPSHOT', message: 'm' })
    expect(routingFailure(new Error('An object could not be cloned.'))).toStrictEqual({
      code: 'OPERATION_FAILED',
      message: 'An object could not be cloned.'
    })
    expect(routingFailure('x')).toStrictEqual({ code: 'OPERATION_FAILED', message: 'Routing operation failed.' })
    expect(routingFailure(new Error(''))).toStrictEqual({ code: 'OPERATION_FAILED', message: 'Routing operation failed.' })
  })

  it('RS3: one shared, reference-counted progress subscription', () => {
    const { api, dispose } = stubRouting()
    const store = useRoutingStore()
    const first = connect(store)
    const second = connect(store)
    expect(api.onProgress).toHaveBeenCalledTimes(1)
    first()
    first()
    expect(dispose).not.toHaveBeenCalled()
    second()
    expect(dispose).toHaveBeenCalledTimes(1)
    const third = connect(store)
    expect(api.onProgress).toHaveBeenCalledTimes(2)
    third()
    expect(dispose).toHaveBeenCalledTimes(2)
  })

  it('RS4: load reads the five sources with {}, then the tiers for the chosen model and credential', async () => {
    const { api } = stubRouting()
    const store = useRoutingStore()
    await store.load()
    for (const name of ['models', 'credentials', 'settingsGet', 'observationGet', 'status'] as const) {
      expect(api[name], name).toHaveBeenCalledTimes(1)
      expect(api[name], name).toHaveBeenCalledWith({})
    }
    expect(api.tiers).toHaveBeenCalledTimes(1)
    expect(api.tiers).toHaveBeenCalledWith(TIERS_REQUEST)
    expect(api.refresh).not.toHaveBeenCalled() // K3: never a refresh on load
    expect(store.loaded).toBe(true)
    expect(store.loading).toBe(false)
    expect(store.loadError).toBeNull()
    expect(store.model).toBe(SLUG)
    expect(store.credentialProfileId).toBe(C_ID)
    expect(store.credentials).toEqual([A, C])
    expect(store.settings).toEqual(DEFAULT_ROUTING_SETTINGS)
    expect(store.observation).toEqual({ enabled: true, credentialProfileId: C_ID })
    expect(store.status).toEqual(DORMANT)
    expect(store.tiers).toStrictEqual(GOLDEN)
    expect(store.tiersError).toBeNull()
  })

  it('RS4 (failure): a failed source sets loadError with its code and loads no tiers', async () => {
    const { api } = stubRouting()
    api.settingsGet.mockResolvedValueOnce(fail('UNAUTHORIZED', 'Not allowed.'))
    const store = useRoutingStore()
    await expect(store.load()).resolves.toBeUndefined()
    expect(store.loadError).toStrictEqual({ code: 'UNAUTHORIZED', message: 'Not allowed.' })
    expect(store.loading).toBe(false)
    expect(store.loaded).toBe(false)
    expect(api.tiers).not.toHaveBeenCalled()
  })

  it('RS5: an unlisted designation falls back to the first credential; none listed means null', async () => {
    const { api } = stubRouting({ observation: { enabled: true, credentialProfileId: X_ID } })
    const store = useRoutingStore()
    await store.load()
    expect(store.credentialProfileId).toBe(A_ID)
    expect(api.tiers).toHaveBeenLastCalledWith({ ...TIERS_REQUEST, credentialProfileId: A_ID })

    api.credentials.mockResolvedValue(ok({ credentials: [] }))
    await store.load()
    expect(store.credentialProfileId).toBeNull()
    expect(api.tiers).toHaveBeenLastCalledWith({ ...TIERS_REQUEST, credentialProfileId: null })
  })

  it('RS6: NO_SNAPSHOT keeps its code; a late response to an older request is dropped', async () => {
    const message = 'No endpoint snapshot is stored for this model yet. Refresh first.'
    const { api } = stubRouting()
    api.tiers.mockResolvedValueOnce(fail('NO_SNAPSHOT', message))
    const store = useRoutingStore()
    await store.load()
    expect(store.tiers).toBeNull()
    expect(store.tiersError).toStrictEqual({ code: 'NO_SNAPSHOT', message })

    const first = deferred<RoutingReply<TierResult>>()
    const second = deferred<RoutingReply<TierResult>>()
    api.tiers.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const p1 = store.loadTiers()
    const p2 = store.loadTiers()
    second.resolve(ok(structuredClone(GOLDEN)))
    await p2
    expect(store.tiers).toStrictEqual(GOLDEN)
    expect(store.tiersError).toBeNull()
    first.resolve(fail('NO_SNAPSHOT', message))
    await p1
    expect(store.tiers).toStrictEqual(GOLDEN)
    expect(store.tiersError).toBeNull()

    // And the other way round: a late success does not overwrite a newer failure.
    const third = deferred<RoutingReply<TierResult>>()
    const fourth = deferred<RoutingReply<TierResult>>()
    api.tiers.mockReturnValueOnce(third.promise).mockReturnValueOnce(fourth.promise)
    const p3 = store.loadTiers()
    const p4 = store.loadTiers()
    fourth.resolve(fail('NO_SNAPSHOT', message))
    await p4
    third.resolve(ok(structuredClone(GOLDEN)))
    await p3
    expect(store.tiers).toBeNull()
    expect(store.tiersError).toStrictEqual({ code: 'NO_SNAPSHOT', message })
  })

  it('RS7: selections reload the tiers with the new inputs', async () => {
    const { api } = stubRouting()
    const store = useRoutingStore()
    await store.load()
    await store.selectProfile('helper')
    expect(api.tiers).toHaveBeenLastCalledWith({ ...TIERS_REQUEST, profile: 'helper' })
    await store.selectCredential(null)
    expect(api.tiers).toHaveBeenLastCalledWith({ ...TIERS_REQUEST, profile: 'helper', credentialProfileId: null })
    await store.selectModel(SLUG)
    expect(api.tiers).toHaveBeenCalledTimes(4)
    expect(store.profile).toBe('helper')
    expect(store.credentialProfileId).toBeNull()
  })

  it('RS8: a refresh adopts only its own model and id, then reloads tiers and status; the countdown starts', async () => {
    vi.useFakeTimers({ now: 1_000_000 })
    const { api, emit } = stubRouting()
    const store = useRoutingStore()
    const release = connect(store)
    await store.load()
    const pending = deferred<RoutingReply<RoutingRefreshResult>>()
    api.refresh.mockReturnValueOnce(pending.promise)
    const run = store.startRefresh()
    expect(api.refresh).toHaveBeenCalledTimes(1)
    expect(api.refresh).toHaveBeenCalledWith(REFRESH_REQUEST)

    emit(progress.endpoints(R3, 'other/model'))
    emit(progress.endpoints(R1))
    emit(progress.endpoints(R2))
    emit(progress.preflight(R1))
    expect(store.refresh.phase).toBe('running')
    expect(store.refresh.model).toBe(SLUG)
    expect(store.refresh.refreshId).toBe(R1)
    expect(store.refresh.events.map((e) => [e.refreshId, e.stage])).toEqual([[R1, 'endpoints'], [R1, 'preflight']])

    pending.resolve(ok(refreshResult(R1)))
    await run
    expect(store.refresh.phase).toBe('done')
    expect(store.refresh.result).toStrictEqual(refreshResult(R1))
    expect(store.refresh.error).toBeNull()
    expect(store.refresh.events).toHaveLength(2)
    expect(store.refresh.endedAtMs).toBe(1_000_000)
    expect(api.tiers).toHaveBeenCalledTimes(2)
    expect(api.status).toHaveBeenCalledTimes(2)
    release()
  })

  it('RS9: a second refresh while one runs is ignored', async () => {
    const { api } = stubRouting()
    const store = useRoutingStore()
    await store.load()
    const pending = deferred<RoutingReply<RoutingRefreshResult>>()
    api.refresh.mockReturnValueOnce(pending.promise)
    const first = store.startRefresh()
    await expect(store.startRefresh()).resolves.toBeUndefined()
    expect(api.refresh).toHaveBeenCalledTimes(1)
    pending.resolve(ok(refreshResult()))
    await first
    expect(store.refresh.phase).toBe('done')
  })

  it('RS9 (no model or credential): nothing is sent', async () => {
    const { api } = stubRouting({ credentials: [] })
    const store = useRoutingStore()
    await store.startRefresh() // model null
    await store.load() // no credential listed
    expect(store.credentialProfileId).toBeNull()
    await store.startRefresh()
    expect(api.refresh).not.toHaveBeenCalled()
    expect(store.refresh.phase).toBe('idle')
  })

  it('RS10: a pre-network refusal fails without a countdown and reloads tiers and status', async () => {
    const { api } = stubRouting()
    const store = useRoutingStore()
    await store.load()
    api.refresh.mockResolvedValueOnce(fail('CREDENTIAL_REFUSED', 'The routing credential was not found.'))
    await store.startRefresh()
    expect(store.refresh.phase).toBe('failed')
    expect(store.refresh.error).toStrictEqual({ code: 'CREDENTIAL_REFUSED', message: 'The routing credential was not found.' })
    expect(store.refresh.endedAtMs).toBeNull()
    expect(api.tiers).toHaveBeenCalledTimes(2)
    expect(api.status).toHaveBeenCalledTimes(2)
  })

  it('RS11: the main-side cooldown message reaches the view verbatim, without a countdown', async () => {
    const message = 'This model was refreshed less than a minute ago. Try again in 42 s.'
    const { api } = stubRouting()
    const store = useRoutingStore()
    await store.load()
    api.refresh.mockResolvedValueOnce(fail('BUSY', message))
    await store.startRefresh()
    expect(store.refresh.error?.code).toBe('BUSY')
    expect(store.refresh.error?.message).toBe(message)
    expect(store.refresh.endedAtMs).toBeNull()
  })

  it('RS12: a failure after an adopted event reached the network, so the countdown starts', async () => {
    vi.useFakeTimers({ now: 2_000_000 })
    const { api, emit } = stubRouting()
    const store = useRoutingStore()
    const release = connect(store)
    await store.load()
    const pending = deferred<RoutingReply<RoutingRefreshResult>>()
    api.refresh.mockReturnValueOnce(pending.promise)
    const run = store.startRefresh()
    emit(progress.failed(R1))
    expect(store.refresh.events).toHaveLength(1)
    pending.resolve(fail('FETCH_FAILED', 'OpenRouter returned an error.'))
    await run
    expect(store.refresh.phase).toBe('failed')
    expect(store.refresh.error).toStrictEqual({ code: 'FETCH_FAILED', message: 'OpenRouter returned an error.' })
    expect(store.refresh.endedAtMs).toBe(Date.now())
    expect(store.refresh.endedAtMs).toBe(2_000_000)
    release()
  })

  it('RS13: events outside a running refresh are ignored', async () => {
    const { emit } = stubRouting()
    const store = useRoutingStore()
    const release = connect(store)
    await store.load()
    emit(progress.endpoints(R1))
    expect(store.refresh.phase).toBe('idle')
    expect(store.refresh.refreshId).toBeNull()
    expect(store.refresh.events).toEqual([])

    await store.startRefresh()
    expect(store.refresh.phase).toBe('done')
    emit(progress.endpoints(R1))
    emit(progress.preflight(R1))
    expect(store.refresh.events).toEqual([])
    release()
  })

  it('RS14: the data-collection opt-in is a read-modify-write from a fresh read, never local state', async () => {
    const { api, settingsReplies } = stubRouting()
    const store = useRoutingStore()
    await store.load()
    store.settings = reactive({ ...structuredClone(DEFAULT_ROUTING_SETTINGS), minUptimePct: 99.4 })
    const tiersBefore = api.tiers.mock.calls.length
    const getsBefore = api.settingsGet.mock.calls.length

    await expect(store.setDataCollection('allow')).resolves.toBe(true)
    expect(api.settingsGet).toHaveBeenCalledTimes(getsBefore + 1)
    expect(api.settingsSet).toHaveBeenCalledTimes(1)
    expect(api.settingsGet.mock.invocationCallOrder[getsBefore]).toBeLessThan(api.settingsSet.mock.invocationCallOrder[0])
    const sent = api.settingsSet.mock.calls[0][0] as { settings: RoutingSettings }
    expect(sent).toStrictEqual({ settings: { ...DEFAULT_ROUTING_SETTINGS, dataCollection: 'allow' } })
    // A JSON snapshot: it shares no object with the reply it was built from (D14).
    expect(sent.settings.tierWeights).not.toBe(settingsReplies[settingsReplies.length - 1].tierWeights)
    expect(store.settings).toStrictEqual({ ...DEFAULT_ROUTING_SETTINGS, dataCollection: 'allow' })
    expect(store.saving).toBe(false)
    expect(store.actionError).toBeNull()
    expect(api.tiers).toHaveBeenCalledTimes(tiersBefore + 1)

    api.settingsSet.mockResolvedValueOnce(fail('INVALID_REQUEST', 'Invalid routing request.'))
    await expect(store.setDataCollection('deny')).resolves.toBe(false)
    expect(store.actionError?.code).toBe('INVALID_REQUEST')
    expect(store.settings).toStrictEqual({ ...DEFAULT_ROUTING_SETTINGS, dataCollection: 'allow' })
    expect(store.saving).toBe(false)
    expect(api.tiers).toHaveBeenCalledTimes(tiersBefore + 1)
  })

  it('RS14 (guard): a write while another is saving is refused at once', async () => {
    const { api } = stubRouting()
    const store = useRoutingStore()
    await store.load()
    const pending = deferred<RoutingReply<RoutingSettings>>()
    api.settingsGet.mockReturnValueOnce(pending.promise)
    const first = store.setDataCollection('allow')
    await expect(store.setDataCollection('allow')).resolves.toBe(false)
    await expect(store.setObservation(false, null)).resolves.toBe(false)
    expect(api.observationSet).not.toHaveBeenCalled()
    pending.resolve(ok(structuredClone(DEFAULT_ROUTING_SETTINGS)))
    await expect(first).resolves.toBe(true)
    expect(api.settingsSet).toHaveBeenCalledTimes(1)
  })

  it('RS15: observation off always clears the designation; a refusal keeps its message and re-reads', async () => {
    const { api } = stubRouting()
    const store = useRoutingStore()
    await store.load()
    const statusBefore = api.status.mock.calls.length

    await expect(store.setObservation(false, C_ID)).resolves.toBe(true)
    expect(store.observation).toStrictEqual({ enabled: false, credentialProfileId: null })
    await expect(store.setObservation(true, C_ID)).resolves.toBe(true)
    await expect(store.setObservation(true, null)).resolves.toBe(true)
    expect(api.observationSet.mock.calls.map((c) => c[0])).toStrictEqual([
      { enabled: false, credentialProfileId: null },
      { enabled: true, credentialProfileId: C_ID },
      { enabled: true, credentialProfileId: null }
    ])
    expect(api.status).toHaveBeenCalledTimes(statusBefore + 3)

    const message = 'Routing needs a credential for the OpenRouter gateway.'
    api.observationSet.mockResolvedValueOnce(fail('CREDENTIAL_REFUSED', message))
    const getsBefore = api.observationGet.mock.calls.length
    await expect(store.setObservation(true, A_ID)).resolves.toBe(false)
    expect(store.actionError).toStrictEqual({ code: 'CREDENTIAL_REFUSED', message })
    expect(api.observationGet).toHaveBeenCalledTimes(getsBefore + 1)
    expect(store.observation).toStrictEqual({ enabled: true, credentialProfileId: C_ID }) // the re-read
    expect(api.status).toHaveBeenCalledTimes(statusBefore + 4)
    expect(store.saving).toBe(false)
  })

  it('RS16: every recorded IPC argument is plain and cloneable; a bridge clone error does not escape', async () => {
    vi.useFakeTimers({ now: 3_000_000 })
    const { api, emit } = stubRouting()
    const store = useRoutingStore()
    const release = connect(store)
    await store.load() // RS4
    const pending = deferred<RoutingReply<RoutingRefreshResult>>()
    api.refresh.mockReturnValueOnce(pending.promise)
    const run = store.startRefresh() // RS8
    emit(progress.endpoints(R1))
    pending.resolve(ok(refreshResult(R1)))
    await run
    store.settings = reactive({ ...structuredClone(DEFAULT_ROUTING_SETTINGS), minUptimePct: 99.4 })
    await store.setDataCollection('allow') // RS14
    await store.setObservation(false, C_ID) // RS15
    await store.setObservation(true, C_ID)
    await store.setObservation(true, null)
    await store.selectProfile('helper')
    await store.selectCredential(A_ID)

    // Every request method was exercised, and every argument it saw is plain.
    for (const name of REQUEST_METHODS) expect(api[name].mock.calls.length, name).toBeGreaterThan(0)
    expect(expectPlainArguments(api)).toBeGreaterThanOrEqual(20)
    // Negative control (D14): the store's own state is a Proxy the bridge would refuse without the snapshot.
    expect(types.isProxy(store.settings)).toBe(true)
    expect(() => structuredClone(store.settings)).toThrow(/could not be cloned/)

    api.refresh.mockRejectedValueOnce(new Error('An object could not be cloned.'))
    await expect(store.startRefresh()).resolves.toBeUndefined()
    expect(store.refresh.phase).toBe('failed')
    expect(store.refresh.error).toStrictEqual({ code: 'OPERATION_FAILED', message: 'An object could not be cloned.' })
    expect(store.refresh.endedAtMs).toBeNull()
    release()
  })

  it('RS16 (no bridge): actions resolve and record OPERATION_FAILED instead of throwing', async () => {
    vi.stubGlobal('window', {})
    const store = useRoutingStore()
    await expect(store.load()).resolves.toBeUndefined()
    expect(store.loadError?.code).toBe('OPERATION_FAILED')
    store.model = SLUG
    store.credentialProfileId = C_ID
    await expect(store.loadTiers()).resolves.toBeUndefined()
    expect(store.tiersError?.code).toBe('OPERATION_FAILED')
    await expect(store.loadStatus()).resolves.toBeUndefined()
    await expect(store.startRefresh()).resolves.toBeUndefined()
    expect(store.refresh.error?.code).toBe('OPERATION_FAILED')
    await expect(store.setDataCollection('allow')).resolves.toBe(false)
    await expect(store.setObservation(true, C_ID)).resolves.toBe(false)
    expect(store.actionError?.code).toBe('OPERATION_FAILED')
    expect(store.saving).toBe(false)
  })
})
