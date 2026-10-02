import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'

import {
  DEFAULT_ROUTING_SETTINGS,
  routingProgressEventSchema,
  routingRefreshResultSchema,
  tierResultSchema,
  type RankedTier,
  type RoutingObservationSettings,
  type RoutingProfileId,
  type RoutingProgressEvent,
  type RoutingRefreshRequest,
  type RoutingRefreshResult,
  type RoutingSettings,
  type RoutingTiersRequest,
  type TierResult
} from '../../shared/routing'
import type { CredentialProfileRow, ProviderConfigRow } from '../db/schema'
import { extractObservations, parseEndpointsResponse } from '../routing/endpointsCore'
import { bundledModelRegistry, findModel } from '../routing/registryCore'
import { computeTiers } from '../routing/routingCore'
import type { FetchResponseLike } from './modelCatalog'
import type { RoutingFetchLike } from './routingClient'
import {
  RoutingError,
  RoutingService,
  type RoutingServiceDeps,
  type RoutingStorageLike,
  type RoutingStoreLike
} from './routingService'
import { RoutingStore } from './routingStore'
import type { CredentialVault } from './vault'

/**
 * Model Routing Task 2-3, Table V (ImplementationSpec-2-3): RoutingService over
 * a stub fetch, a fake vault, an in-memory storage fake and a REAL RoutingStore
 * in a temp directory per test. No test touches the network.
 */

/** A realistic-shaped fake, assembled by concatenation so this file never
 *  contains a complete key shape for scripts/secret-grep.mjs (G4 scans src/). */
const FAKE_KEY = 'sk-or-v1-' + '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

const SLUG = 'deepseek/deepseek-v4.1-flash'
const MODEL_DIR = 'deepseek%2Fdeepseek-v4.1-flash'
const C = '5f0c1a2e-8a3b-4c5d-9e6f-0123456789ab'
const D = '0b6d2c4e-1f3a-4b5c-8d7e-9f0a1b2c3d4e'
const UNKNOWN_ID = 'c1d2e3f4-a5b6-4c7d-8e9f-a0b1c2d3e4f5'
const ID1 = '11111111-1111-4111-8111-111111111111'
const ID2 = '22222222-2222-4222-8222-222222222222'
const NOW = '2026-10-02T09:20:00Z'
const ENDPOINTS_URL = 'https://openrouter.ai/api/v1/models/deepseek/deepseek-v4.1-flash/endpoints'
const COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions'
const FRESH_MS = 1_500_000

const fixtureText = (name: string): string => readFileSync(join(__dirname, '../routing/__fixtures__', name), 'utf8')
const GOLDEN_TEXT = fixtureText('endpoints-deepseek-v4.1-flash-2026-10-02.json')
const GUARDRAILS_404 = JSON.stringify((JSON.parse(fixtureText('preflight-guardrails-2026-10-02.json')) as { body: unknown }).body)
const DENY_404 = JSON.stringify(
  (JSON.parse(fixtureText('preflight-data-policy-2026-10-02.json')) as { withDeny: { body: unknown } }).withDeny.body
)

// ── Golden expectations (Phase 1, ImplementationSpec-1-3 and Spec 2-1 Q1; never edited to fit the code) ──

const GOLDEN_TIERS: Record<RoutingProfileId, Record<RankedTier, string[]>> = {
  interactive: {
    budget: ['deepinfra/fp8', 'streamlake/fp8', 'gmicloud/fp8'],
    balanced: ['deepinfra/fp8', 'streamlake/fp8', 'makora/fp8'],
    fast: ['venice/fp8', 'baidu/fp8', 'parasail/fp8']
  },
  helper: {
    budget: ['streamlake/fp8', 'deepinfra/fp8', 'gmicloud/fp8'],
    balanced: ['streamlake/fp8', 'venice/fp8', 'gmicloud/fp8'],
    fast: ['venice/fp8', 'baidu/fp8', 'parasail/fp8']
  }
}
const Q1_ORDER = [
  'atlas-cloud/fp8',
  'morph/fp8',
  'makora/fp8',
  'streamlake/fp8',
  'deepinfra/fp8',
  'venice/fp8',
  'gmicloud/fp8',
  'baidu/fp8',
  'parasail/fp8',
  'nextbit/fp8',
  'novita/fp8',
  'baseten/fp8',
  'siliconflow/fp8',
  'baseten/fast'
]
const LIMITED_14 = 'Limited history: 14 of 14 eligible endpoints have fewer than 3 speed observations.'
const W2 = 'Account guardrails were not checked; a pinned endpoint may be refused.'
const W3 = 'Data-policy removals were not checked.'

/** Money compares to 1e-12 absolute, as the specification prescribes. */
function money(actual: number, expected: number, label = ''): void {
  expect(Math.abs(actual - expected) < 1e-12, `${label}: ${actual} vs ${expected}`).toBe(true)
}

function tierOrders(result: TierResult): Record<RankedTier, string[] | null> {
  return {
    budget: result.tiers.budget?.endpoints ?? null,
    balanced: result.tiers.balanced?.endpoints ?? null,
    fast: result.tiers.fast?.endpoints ?? null
  }
}

/** Every key at any depth of a JSON value. */
function keysDeep(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysDeep)
  if (typeof value === 'object' && value !== null) return Object.entries(value).flatMap(([k, v]) => [k, ...keysDeep(v)])
  return []
}

// ── Harness ──

const OR_PROVIDER: ProviderConfigRow = {
  id: 'prov-or',
  name: 'OpenRouter',
  adapterType: 'opencode',
  authMode: 'api_key',
  envVarName: 'OPENROUTER_API_KEY',
  baseUrl: 'https://openrouter.ai/api/v1',
  extraHeadersJson: null,
  model: null,
  createdAt: '2026-07-01T00:00:00.000Z'
}
const OR_PROFILE: CredentialProfileRow = {
  id: C,
  providerId: 'prov-or',
  label: 'OR key',
  encryptedBlob: Buffer.from([1, 2, 3]),
  fingerprintHash: 'not-a-real-hash',
  createdAt: '2026-07-01T00:00:00.000Z',
  lastVerifiedAt: null,
  unavailableSince: null,
  reencryptedAt: null
}

interface Answer { status: number; text: string }
interface Net {
  endpoints: Answer
  holdEndpoints: boolean
  guardrails: Answer
  dataPolicy: Answer
  probeStatus: number
  probeText: string | null // a raw probe body instead of the usage JSON
  probeCost: number
  probeFailTag: { tag: string; status: number } | null // one tag answers this status; the rest answer normally
  onProbe: ((tag: string, index: number) => void) | null // called as each probe request arrives, before it is answered
}
interface Recorded {
  seq: number
  url: string
  method: string
  headers: Record<string, string>
  body: { max_tokens?: number; provider?: { order?: string[]; data_collection?: string } } | null
}
type VaultAnswer =
  | { ok: true; value: { key: string; baseUrl?: string; extraHeaders?: Record<string, string> } }
  | { ok: false; kind: string; message: string }

/** A minimal response whose body is read once. */
function response(status: number, text: string): FetchResponseLike {
  const bytes = new TextEncoder().encode(text)
  let sent = false
  return {
    status,
    body: {
      cancel: async () => undefined,
      getReader: () => ({
        read: async () => {
          if (sent || bytes.byteLength === 0) return { done: true }
          sent = true
          return { done: false, value: bytes }
        },
        cancel: async () => undefined
      })
    }
  }
}

function aborted(): DOMException {
  return new DOMException('This operation was aborted', 'AbortError')
}

interface HarnessOptions {
  deps?: Pick<RoutingServiceDeps, 'probeTagLimit' | 'probeCapUsd' | 'probeConcurrency'>
  store?: (real: RoutingStore) => RoutingStoreLike
  now?: () => string
  realSleep?: boolean // use the service's default (abortable, unref'd) sleep instead of the instant fake
}

function makeHarness(options: HarnessOptions = {}) {
  const root = mkdtempSync(join(tmpdir(), 'chorus-routing-service-'))
  const state = {
    providers: new Map<string, ProviderConfigRow>([[OR_PROVIDER.id, { ...OR_PROVIDER }]]),
    profiles: new Map<string, CredentialProfileRow>([[C, { ...OR_PROFILE }]]),
    settings: structuredClone(DEFAULT_ROUTING_SETTINGS) as RoutingSettings,
    observation: { enabled: true, credentialProfileId: null } as RoutingObservationSettings
  }
  const storage = {
    getCredentialProfileById: vi.fn((id: string) => state.profiles.get(id) ?? null),
    getProviderConfigById: vi.fn((id: string) => state.providers.get(id) ?? null),
    readRoutingSettings: vi.fn(() => structuredClone(state.settings)),
    writeRoutingSettings: vi.fn((value: RoutingSettings) => {
      state.settings = structuredClone(value)
    }),
    readRoutingObservation: vi.fn(() => ({ ...state.observation })),
    writeRoutingObservation: vi.fn((value: RoutingObservationSettings) => {
      state.observation = { ...value }
    })
  }
  const net: Net = {
    endpoints: { status: 200, text: GOLDEN_TEXT },
    holdEndpoints: false,
    guardrails: { status: 404, text: GUARDRAILS_404 },
    dataPolicy: { status: 404, text: DENY_404 },
    probeStatus: 200,
    probeText: null,
    probeCost: 0.0005,
    probeFailTag: null,
    onProbe: null
  }
  const counter = { seq: 0 }
  const requests: Recorded[] = []
  const events: { seq: number; event: RoutingProgressEvent }[] = []
  const decrypts: string[] = []
  const probeCalls = new Map<string, number>()
  const errors: unknown[] = []
  const results: unknown[] = []
  const held: { release: (() => void) | null } = { release: null }
  const clock = { now: NOW }

  const fetchImpl: RoutingFetchLike = async (url, init) => {
    const body = init.body === undefined ? null : (JSON.parse(init.body) as Recorded['body'])
    requests.push({ seq: ++counter.seq, url, method: init.method, headers: { ...init.headers }, body })
    if (init.signal.aborted) throw aborted()
    if (url === ENDPOINTS_URL && init.method === 'GET') {
      if (net.holdEndpoints) {
        return new Promise<FetchResponseLike>((resolve, reject) => {
          held.release = () => resolve(response(200, GOLDEN_TEXT))
          init.signal.addEventListener('abort', () => reject(aborted()), { once: true })
        })
      }
      return response(net.endpoints.status, net.endpoints.text)
    }
    if (url === COMPLETIONS_URL && init.method === 'POST' && body?.provider?.order) {
      const tag = body.provider.order[0]
      if (tag === 'chorus-preflight-none') {
        const answer = body.provider.data_collection === 'deny' ? net.dataPolicy : net.guardrails
        return response(answer.status, answer.text)
      }
      const index = probeCalls.get(tag) ?? 0
      probeCalls.set(tag, index + 1)
      net.onProbe?.(tag, index)
      if (net.probeFailTag !== null && tag === net.probeFailTag.tag) return response(net.probeFailTag.status, '')
      if (net.probeText !== null) return response(net.probeStatus, net.probeText)
      if (net.probeStatus !== 200) return response(net.probeStatus, '')
      const cached = tag === 'baidu/fp8' ? 0 : [0, 4352, 4352][index]
      return response(
        200,
        JSON.stringify({ usage: { prompt_tokens: 4460, prompt_tokens_details: { cached_tokens: cached }, cost: net.probeCost } })
      )
    }
    throw new Error('unexpected request in the stub')
  }

  // The vault holds no key as a property; it builds the answer per call.
  const vaultState: { answer: () => VaultAnswer } = { answer: () => ({ ok: true, value: { key: FAKE_KEY } }) }
  const vault = {
    decryptForLaunch: async (id: string) => {
      decrypts.push(id)
      return vaultState.answer()
    }
  } as unknown as Pick<CredentialVault, 'decryptForLaunch'>

  const storeWarn = vi.fn<(message: string) => void>()
  const realStore = new RoutingStore(join(root, 'routing'), { warn: storeWarn })
  const store = options.store ? options.store(realStore) : realStore
  const log = { info: vi.fn<(message: string) => void>(), warn: vi.fn<(message: string) => void>(), error: vi.fn<(message: string, err: unknown) => void>() }
  let ids = 0
  const randomId = (): string => {
    ids += 1
    if (ids === 1) return ID1
    if (ids === 2) return ID2
    return `${String(ids).padStart(8, '0')}-0000-4000-8000-000000000000`
  }

  const service = new RoutingService({
    storage: storage as RoutingStorageLike,
    vault,
    store,
    fetchImpl,
    now: options.now ?? (() => clock.now),
    ...(options.realSleep ? {} : { sleep: async () => undefined }),
    randomId,
    log,
    ...options.deps
  })
  service.onProgress((event) => {
    events.push({ seq: ++counter.seq, event })
  })

  const h = {
    service,
    root,
    realStore,
    state,
    storage,
    net,
    requests,
    events,
    decrypts,
    errors,
    results,
    held,
    clock,
    vaultState,
    log,
    storeWarn,
    stages: () => events.map((e) => e.event.stage),
    probes: () => requests.filter((r) => r.body?.max_tokens === 64),
    preflights: () => requests.filter((r) => r.body?.max_tokens === 1),
    gets: () => requests.filter((r) => r.method === 'GET'),
    async refresh(over: Partial<RoutingRefreshRequest> = {}): Promise<RoutingRefreshResult> {
      const res = await service.refresh({ model: SLUG, credentialProfileId: C, profile: 'interactive', effort: 'low', ...over })
      results.push(res)
      return res
    },
    tiers(over: Partial<RoutingTiersRequest> = {}): TierResult {
      const res = service.tiers({ model: SLUG, profile: 'interactive', effort: 'low', credentialProfileId: C, ...over })
      results.push(res)
      return res
    },
    async observe() {
      const tick = await service.observe({ freshMs: FRESH_MS })
      results.push(tick)
      return tick
    },
    async rejects(promise: Promise<unknown>): Promise<RoutingError> {
      try {
        await promise
      } catch (err) {
        errors.push(err)
        expect(err).toBeInstanceOf(RoutingError)
        return err as RoutingError
      }
      throw new Error('expected a rejection')
    },
    throws(fn: () => unknown): RoutingError {
      try {
        fn()
      } catch (err) {
        errors.push(err)
        expect(err).toBeInstanceOf(RoutingError)
        return err as RoutingError
      }
      throw new Error('expected a throw')
    }
  }
  live.push(h)
  return h
}
type Harness = ReturnType<typeof makeHarness>

/** A store whose named methods are replaced; the rest delegate to the real store. */
function storeWith(real: RoutingStore, over: Partial<RoutingStoreLike>): RoutingStoreLike {
  return {
    readSnapshot: (m) => real.readSnapshot(m),
    writeSnapshot: (m, s) => real.writeSnapshot(m, s),
    readObservations: (m) => real.readObservations(m),
    appendObservations: (m, added, now, days) => real.appendObservations(m, added, now, days),
    readCache: (m) => real.readCache(m),
    mergeCache: (m, added) => real.mergeCache(m, added),
    readAccount: (m, id) => real.readAccount(m, id),
    writeAccount: (m, id, e) => real.writeAccount(m, id, e),
    ...over
  }
}

// ── V19: key discipline, audited after EVERY test in this file ──

/** What the audit reads from a harness (declared, so `live` does not type itself through makeHarness). */
interface AuditTarget {
  service: RoutingService
  root: string
  requests: Recorded[]
  events: { seq: number; event: RoutingProgressEvent }[]
  errors: unknown[]
  results: unknown[]
  log: { info: Mock<(message: string) => void>; warn: Mock<(message: string) => void>; error: Mock<(message: string, err: unknown) => void> }
  storeWarn: Mock<(message: string) => void>
}

const live: AuditTarget[] = []
const audited = { harnesses: 0 }

function textOf(value: unknown): string {
  return (
    JSON.stringify(value, (_key, v: unknown) =>
      v instanceof Error ? { ...v, name: v.name, message: v.message, stack: v.stack } : v instanceof Map ? [...v] : v
    ) ?? String(value)
  )
}

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? filesUnder(join(dir, e.name)) : [join(dir, e.name)]
  )
}

/** FAKE_KEY appears only as `Bearer <key>` in recorded authorization headers: never in a URL, body, event, result, error, log call, file or status. */
function audit(h: AuditTarget): void {
  const leaks: string[] = []
  const check = (label: string, text: string): void => {
    if (text.includes(FAKE_KEY)) leaks.push(label)
  }
  check('events', textOf(h.events))
  check('results', textOf(h.results))
  h.errors.forEach((e, i) => check(`error ${i}`, `${textOf(e)} ${String(e)}`))
  check('log', textOf([h.log.info.mock.calls, h.log.warn.mock.calls, h.log.error.mock.calls]))
  check('store warnings', textOf(h.storeWarn.mock.calls))
  for (const file of filesUnder(h.root)) check(file, readFileSync(file, 'utf8'))
  check('status', textOf(h.service.status()))
  for (const r of h.requests) {
    check(`url ${r.seq}`, r.url)
    check(`body ${r.seq}`, textOf(r.body))
    for (const [name, value] of Object.entries(r.headers)) {
      if (value.includes(FAKE_KEY) && !(name === 'authorization' && value === `Bearer ${FAKE_KEY}`)) leaks.push(`header ${name}`)
    }
  }
  expect(leaks).toEqual([])
}

afterEach(() => {
  const harnesses = live.splice(0)
  try {
    for (const h of harnesses) {
      audit(h)
      audited.harnesses += 1
    }
  } finally {
    for (const h of harnesses) {
      h.service.dispose()
      rmSync(h.root, { recursive: true, force: true })
    }
    vi.restoreAllMocks()
  }
})

function expectEventsParse(h: Harness): void {
  for (const { event } of h.events) {
    const parsed = routingProgressEventSchema.safeParse(event)
    expect(parsed.success, `${event.stage} event`).toBe(true)
    expect(JSON.parse(JSON.stringify(event))).toStrictEqual(event)
  }
}

function terminalEvents(h: Harness): RoutingProgressEvent[] {
  return h.events.map((e) => e.event).filter((e) => e.stage === 'done' || e.stage === 'failed')
}

function eventsOf<S extends RoutingProgressEvent['stage']>(h: Harness, stage: S): Extract<RoutingProgressEvent, { stage: S }>[] {
  return h.events.map((e) => e.event).filter((e): e is Extract<RoutingProgressEvent, { stage: S }> => e.stage === stage)
}

function oneEvent<S extends RoutingProgressEvent['stage']>(h: Harness, stage: S): Extract<RoutingProgressEvent, { stage: S }> {
  const found = eventsOf(h, stage)
  expect(found, stage).toHaveLength(1)
  return found[0]
}

// ── Table V ──

describe('Table V — refresh', () => {
  it('V1: 45 requests, 1 decrypt, the golden interactive tiers, estimate 0.0493873956, spend 0.021', async () => {
    const h = makeHarness()
    const res = await h.refresh()
    expect(h.requests).toHaveLength(45)
    expect(h.gets()).toHaveLength(1)
    expect(h.preflights()).toHaveLength(2)
    expect(h.probes()).toHaveLength(42)
    expect(h.decrypts).toEqual([C])
    expect(tierOrders(res.result)).toEqual(GOLDEN_TIERS.interactive)
    expect(res.result.nitro.likely?.tag).toBe('together')
    expect(res.result.accountEligibility).toBe('checked')
    expect(res.result.snapshotAgeMinutes).toBe(0)
    expect(res.result.warnings).toEqual([LIMITED_14])
    money(res.estimateUsd, 0.0493873956, 'estimate')
    money(res.spentUsd, 0.021, 'spend')
    expect(res.probed).toEqual(Q1_ORDER)
    expect(res.notProbed).toEqual([])
    expect(res.refreshId).toBe(ID1)
    expect(routingRefreshResultSchema.safeParse(res).success).toBe(true)
  })

  it('V2: the event stream — order, values, schema, and the estimate before every probe request', async () => {
    const h = makeHarness()
    await h.refresh()
    expect(h.stages()).toEqual(['endpoints', 'preflight', 'probe-plan', ...Q1_ORDER.map(() => 'probe'), 'done'])
    expectEventsParse(h)
    for (const { event } of h.events) {
      expect(event.refreshId).toBe(ID1)
      expect(event.model).toBe(SLUG)
      expect(event.at).toBe(NOW)
    }
    expect(oneEvent(h, 'endpoints')).toMatchObject({ fetchedAt: NOW, endpointRows: 33, tags: 32, rejectedRows: 0 })
    const preflight = oneEvent(h, 'preflight')
    expect(preflight.checkedAt).toBe(NOW)
    expect(preflight.guardrails).toStrictEqual({ attempted: true, removed: ['deepseek'], issue: null, failure: null })
    expect(preflight.dataPolicy).toStrictEqual({ attempted: true, removed: ['deepseek'], issue: null, failure: null })
    const plan = oneEvent(h, 'probe-plan')
    expect(plan.planned.map((p) => p.tag)).toEqual(Q1_ORDER)
    money(plan.estimateUsd, 0.0493873956, 'plan estimate')
    expect(plan.capUsd).toBe(0.05)
    expect(plan.fresh).toEqual([])
    expect(plan.notProbed).toEqual([])
    const probes = eventsOf(h, 'probe')
    expect(probes.map((p) => p.tag).sort()).toEqual([...Q1_ORDER].sort())
    for (const p of probes) {
      expect(p.outcome, p.tag).toBe(p.tag === 'baidu/fp8' ? 'not-cached' : 'verified')
      expect(p.calls).toBe(3)
      expect(p.failure).toBeNull()
      money(p.costUsd, 0.0015, `${p.tag} cost`)
    }
    expect(probes.filter((p) => p.outcome === 'verified')).toHaveLength(13)
    const done = oneEvent(h, 'done')
    money(done.spentUsd, 0.021, 'done spend')
    money(done.estimateUsd, 0.0493873956, 'done estimate')
    expect(done.accountEligibility).toBe('checked')
    expect(done.probed).toEqual(Q1_ORDER)
    expect(done.notProbed).toEqual([])
    // MR-G7: the probe-plan event precedes every probe request.
    const planSeq = h.events.find((e) => e.event.stage === 'probe-plan')?.seq ?? Infinity
    for (const r of h.probes()) expect(planSeq).toBeLessThan(r.seq)
    // Spend only grows, and the last probe event's running total is the done spend.
    const totals = probes.map((p) => p.spentUsd)
    expect([...totals].sort((a, b) => a - b)).toEqual(totals)
    money(totals[totals.length - 1], done.spentUsd, 'last running total')
  })

  it('V3: the store afterwards — snapshot, 32 observations, 14 cache records, the account file', async () => {
    const h = makeHarness()
    await h.refresh()
    const snapshot = h.realStore.readSnapshot(SLUG)
    expect(snapshot?.fetchedAt).toBe(NOW)
    expect(snapshot?.endpoints).toHaveLength(33)
    const observations = h.realStore.readObservations(SLUG)
    expect(observations).toHaveLength(32)
    expect(new Set(observations.map((o) => o.observedAt))).toEqual(new Set([NOW]))
    const cache = h.realStore.readCache(SLUG)
    expect(Object.keys(cache).sort()).toEqual([...Q1_ORDER].sort())
    for (const [tag, record] of Object.entries(cache)) {
      expect(record, tag).toStrictEqual({ verified: tag !== 'baidu/fp8', checkedAt: NOW })
    }
    const file = JSON.parse(readFileSync(join(h.root, 'routing', MODEL_DIR, `account-${C}.json`), 'utf8')) as {
      credentialProfileId: string
      eligibility: unknown
    }
    expect(file.credentialProfileId).toBe(C)
    expect(file.eligibility).toStrictEqual({ guardrailRemoved: ['deepseek'], dataPolicyRemoved: ['deepseek'], checkedAt: NOW })
  })

  it('V4: probeTagLimit 2 → 9 requests; atlas-cloud/fp8 and morph/fp8 probed; 12 limit; estimate 0.002497428', async () => {
    const h = makeHarness({ deps: { probeTagLimit: 2 } })
    const res = await h.refresh()
    expect(h.requests).toHaveLength(9)
    expect(res.probed).toEqual(['atlas-cloud/fp8', 'morph/fp8'])
    expect(res.notProbed).toEqual(Q1_ORDER.slice(2).map((tag) => ({ tag, reason: 'limit' })))
    money(res.estimateUsd, 0.002497428, 'estimate')
    expect(oneEvent(h, 'probe-plan').notProbed).toEqual(res.notProbed)
  })

  it('V5: probeCapUsd 0.02 → 7 planned (24 requests); 7 cap; estimate 0.017288676', async () => {
    const h = makeHarness({ deps: { probeCapUsd: 0.02 } })
    const res = await h.refresh()
    const plan = oneEvent(h, 'probe-plan')
    expect(plan.planned.map((p) => p.tag)).toEqual(Q1_ORDER.slice(0, 7))
    expect(plan.capUsd).toBe(0.02)
    expect(h.requests).toHaveLength(24)
    expect(res.notProbed).toEqual(Q1_ORDER.slice(7).map((tag) => ({ tag, reason: 'cap' })))
    money(res.estimateUsd, 0.017288676, 'estimate')
    expect(res.probed).toEqual(Q1_ORDER.slice(0, 7))
  })

  it('V6: probeConcurrency 1 at 0.01 a call → two tags run (the second starts at 0.03 < 0.05); 12 cap at runtime; spend 0.06', async () => {
    const h = makeHarness({ deps: { probeConcurrency: 1 } })
    h.net.probeCost = 0.01
    const res = await h.refresh()
    expect(res.probed).toEqual(['atlas-cloud/fp8', 'morph/fp8'])
    expect(oneEvent(h, 'probe-plan').notProbed).toEqual([]) // the 12 are runtime skips, not plan skips
    expect(res.notProbed).toEqual(Q1_ORDER.slice(2).map((tag) => ({ tag, reason: 'cap' })))
    money(res.spentUsd, 0.06, 'spend')
    money(oneEvent(h, 'done').spentUsd, 0.06, 'done spend')
    expect(h.requests).toHaveLength(9)
    const probes = eventsOf(h, 'probe')
    money(probes[0].spentUsd, 0.03, 'after the first tag')
    money(probes[1].spentUsd, 0.06, 'after the second tag')
  })

  it('V7: probeConcurrency 1, probe POSTs answer 401 → one probe request; inconclusive auth-failed; 13 aborted; done; tiers returned', async () => {
    const h = makeHarness({ deps: { probeConcurrency: 1 } })
    h.net.probeStatus = 401
    const res = await h.refresh()
    expect(h.probes()).toHaveLength(1)
    const probe = oneEvent(h, 'probe')
    expect(probe).toMatchObject({ tag: 'atlas-cloud/fp8', outcome: 'inconclusive', failure: 'auth-failed', calls: 1, costUsd: 0, spentUsd: 0 })
    expect(res.probed).toEqual(['atlas-cloud/fp8'])
    expect(res.notProbed).toEqual(Q1_ORDER.slice(1).map((tag) => ({ tag, reason: 'aborted' })))
    expect(h.stages()).toEqual(['endpoints', 'preflight', 'probe-plan', 'probe', 'done'])
    expect(tierOrders(res.result).budget).not.toBeNull()
    expect(h.realStore.readCache(SLUG)).toEqual({})
    expectEventsParse(h)
  })

  it('C16: an auth-failed probe stops every further key-bearing call — the tags already in flight included', async () => {
    const h = makeHarness() // probeConcurrency 5: five tags start before any answer arrives
    h.net.probeFailTag = { tag: 'atlas-cloud/fp8', status: 401 }
    const res = await h.refresh()
    expect(h.probes()).toHaveLength(5) // one call per in-flight tag; none sends call 2 after the abort
    expect(res.probed).toEqual(Q1_ORDER.slice(0, 5))
    expect(res.notProbed).toEqual(Q1_ORDER.slice(5).map((tag) => ({ tag, reason: 'aborted' })))
    for (const p of eventsOf(h, 'probe')) {
      expect(p, p.tag).toMatchObject({ outcome: 'inconclusive', calls: 1, failure: p.tag === 'atlas-cloud/fp8' ? 'auth-failed' : null })
    }
    money(res.spentUsd, 4 * 0.0005, 'four answered calls')
    expect(h.realStore.readCache(SLUG)).toEqual({})
    expect(terminalEvents(h)).toMatchObject([{ stage: 'done' }])
  })

  it('a rate-limited preflight also stops the second preflight and every probe (C16)', async () => {
    const h = makeHarness()
    h.net.guardrails = { status: 429, text: '' }
    await h.refresh()
    expect(h.requests).toHaveLength(2)
    expect(oneEvent(h, 'preflight').guardrails.failure).toBe('rate-limited')
    expect(oneEvent(h, 'probe-plan').planned).toEqual([])
  })

  it('V8: the first preflight answers 401 → no second preflight, unknown account stored, every tag aborted at plan, no probe', async () => {
    const h = makeHarness()
    h.net.guardrails = { status: 401, text: '' }
    const res = await h.refresh()
    expect(h.requests).toHaveLength(2)
    expect(h.preflights()).toHaveLength(1)
    expect(h.probes()).toHaveLength(0)
    const preflight = oneEvent(h, 'preflight')
    expect(preflight.guardrails).toStrictEqual({ attempted: true, removed: null, issue: null, failure: 'auth-failed' })
    expect(preflight.dataPolicy).toStrictEqual({ attempted: false, removed: null, issue: null, failure: null })
    expect(h.realStore.readAccount(SLUG, C)).toStrictEqual({ guardrailRemoved: null, dataPolicyRemoved: null, checkedAt: NOW })
    const plan = oneEvent(h, 'probe-plan')
    expect(plan.planned).toEqual([])
    expect(plan.estimateUsd).toBe(0)
    expect(plan.notProbed).toEqual(Q1_ORDER.map((tag) => ({ tag, reason: 'aborted' })))
    expect(h.stages()).toEqual(['endpoints', 'preflight', 'probe-plan', 'done'])
    expect(res.result.accountEligibility).toBe('unknown')
    expect(res.result.warnings).toEqual([W2, W3, LIMITED_14])
    expect(res.probed).toEqual([])
    expect(res.spentUsd).toBe(0)
    expectEventsParse(h)
  })

  it('V9: the first preflight answers 404 with {} → guardrails unrecognized-body; the refresh continues and probes', async () => {
    const h = makeHarness()
    h.net.guardrails = { status: 404, text: '{}' }
    const res = await h.refresh()
    expect(oneEvent(h, 'preflight').guardrails).toStrictEqual({ attempted: true, removed: null, issue: 'unrecognized-body', failure: null })
    expect(h.preflights()).toHaveLength(2)
    expect(h.probes()).toHaveLength(42)
    expect(res.result.accountEligibility).toBe('unknown')
  })
})

describe('Table V — refusals, failures and single flight', () => {
  it('V10: five pre-decrypt refusals — 0 decrypts, 0 requests, 0 events — then a valid refresh succeeds', async () => {
    const h = makeHarness()
    const profile = (): CredentialProfileRow => h.state.profiles.get(C) as CredentialProfileRow
    const provider = (): ProviderConfigRow => h.state.providers.get('prov-or') as ProviderConfigRow
    const cases: [string, () => void, () => void, string][] = [
      ['no profile row', () => h.state.profiles.delete(C), () => h.state.profiles.set(C, { ...OR_PROFILE }), 'The routing credential was not found.'],
      [
        'unavailable',
        () => h.state.profiles.set(C, { ...profile(), unavailableSince: '2026-10-01T00:00:00.000Z' }),
        () => h.state.profiles.set(C, { ...OR_PROFILE }),
        "Credential profile 'OR key' is unavailable. Re-enter the credential in Settings."
      ],
      [
        'management',
        () => h.state.providers.set('prov-or', { ...provider(), authMode: 'management' }),
        () => h.state.providers.set('prov-or', { ...OR_PROVIDER }),
        'Routing is not available for a management credential.'
      ],
      [
        'subscription',
        () => h.state.providers.set('prov-or', { ...provider(), authMode: 'subscription' }),
        () => h.state.providers.set('prov-or', { ...OR_PROVIDER }),
        'Routing needs an OpenRouter API-key credential.'
      ],
      [
        'not the gateway',
        () => h.state.providers.set('prov-or', { ...provider(), baseUrl: 'https://example.invalid/api/v1' }),
        () => h.state.providers.set('prov-or', { ...OR_PROVIDER }),
        'Routing needs a credential for the OpenRouter gateway.'
      ]
    ]
    for (const [name, apply, restore, message] of cases) {
      apply()
      const err = await h.rejects(h.refresh())
      expect(err.code, name).toBe('CREDENTIAL_REFUSED')
      expect(err.message, name).toBe(message)
      restore()
    }
    expect(h.decrypts).toEqual([])
    expect(h.requests).toEqual([])
    expect(h.events).toEqual([])
    const res = await h.refresh()
    expect(tierOrders(res.result)).toEqual(GOLDEN_TIERS.interactive)
    expect(h.decrypts).toEqual([C])
  })

  it('V11: an envelope baseUrl that is not the gateway → CREDENTIAL_REFUSED after 1 decrypt; 0 requests; 0 events', async () => {
    const h = makeHarness()
    h.vaultState.answer = () => ({ ok: true, value: { key: FAKE_KEY, baseUrl: 'https://proxy.invalid/v1' } })
    const err = await h.rejects(h.refresh())
    expect(err.code).toBe('CREDENTIAL_REFUSED')
    expect(err.message).toBe("Credential profile 'OR key' points at a different base URL; routing only calls the OpenRouter gateway.")
    expect(h.decrypts).toEqual([C])
    expect(h.requests).toEqual([])
    expect(h.events).toEqual([])
  })

  it('envelope extraHeaders are never sent (C9)', async () => {
    const h = makeHarness({ deps: { probeTagLimit: 0 } })
    h.vaultState.answer = () => ({ ok: true, value: { key: FAKE_KEY, extraHeaders: { 'x-extra': 'leak' } } })
    await h.refresh()
    for (const r of h.requests) expect(Object.keys(r.headers).includes('x-extra')).toBe(false)
  })

  it('V12: the vault cannot decrypt → CREDENTIAL_UNAVAILABLE with its message; 0 requests', async () => {
    const h = makeHarness()
    const message = "Credential profile 'OR key' is unavailable: decryption failed. Re-enter the credential in Settings."
    h.vaultState.answer = () => ({ ok: false, kind: 'undecryptable', message })
    const err = await h.rejects(h.refresh())
    expect(err.code).toBe('CREDENTIAL_UNAVAILABLE')
    expect(err.message).toBe(message)
    expect(h.decrypts).toEqual([C])
    expect(h.requests).toEqual([])
    expect(h.events).toEqual([])
  })

  it('V13: the endpoints GET answers 503 → FETCH_FAILED; one failed event; nothing stored', async () => {
    const h = makeHarness()
    h.net.endpoints = { status: 503, text: '' }
    const err = await h.rejects(h.refresh())
    expect(err.code).toBe('FETCH_FAILED')
    expect(err.message).toBe('OpenRouter returned an error.')
    expect(h.events.map((e) => e.event)).toStrictEqual([
      {
        refreshId: ID1,
        model: SLUG,
        at: NOW,
        stage: 'failed',
        code: 'FETCH_FAILED',
        failure: 'provider-error',
        message: 'OpenRouter returned an error.',
        spentUsd: 0
      }
    ])
    expectEventsParse(h)
    expect(h.requests).toHaveLength(1)
    expect(filesUnder(h.root)).toEqual([])
    expect(h.log.error).not.toHaveBeenCalled()
  })

  it('V14: a pending GET makes a second refresh BUSY and the model busy for observe; after release a third refresh runs', async () => {
    const h = makeHarness()
    h.state.observation = { enabled: true, credentialProfileId: C }
    h.net.holdEndpoints = true
    const first = h.refresh()
    await vi.waitFor(() => expect(h.requests).toHaveLength(1))
    const busy = await h.rejects(h.refresh())
    expect(busy.code).toBe('BUSY')
    expect(busy.message).toBe('A routing refresh or observation is already running for this model.')
    expect(h.requests).toHaveLength(1)
    expect(h.decrypts).toEqual([C])
    const tick = await h.observe()
    expect(tick).toStrictEqual({ at: NOW, outcome: 'busy', failure: null, models: [{ model: SLUG, outcome: 'busy', failure: null }] })
    expect(h.decrypts).toEqual([C])
    expect(h.service.status().models[0].busy).toBe(true)
    h.net.holdEndpoints = false
    h.held.release?.()
    await first
    expect(h.service.status().models[0].busy).toBe(false)
    await h.refresh()
    expect(h.decrypts).toEqual([C, C])
  })

  it('V15: unknown model (no credential read); extra key, non-UUID id, LOW effort → INVALID_REQUEST', async () => {
    const h = makeHarness()
    const unknown = await h.rejects(h.refresh({ model: 'other/model' }))
    expect(unknown.code).toBe('UNKNOWN_MODEL')
    expect(unknown.message).toBe('Model routing does not know this model.')
    expect(h.storage.getCredentialProfileById).not.toHaveBeenCalled()
    const invalid = [
      { model: SLUG, credentialProfileId: C, profile: 'interactive', effort: 'low', extra: 1 },
      { model: SLUG, credentialProfileId: 'x', profile: 'interactive', effort: 'low' },
      { model: SLUG, credentialProfileId: C, profile: 'interactive', effort: 'LOW' }
    ]
    for (const request of invalid) {
      const err = await h.rejects(h.service.refresh(request as unknown as RoutingRefreshRequest))
      expect(err.code).toBe('INVALID_REQUEST')
      expect(err.message).toBe('Invalid routing request.')
    }
    expect(h.storage.getCredentialProfileById).not.toHaveBeenCalled()
    expect(h.decrypts).toEqual([])
    expect(h.requests).toEqual([])
    expect(h.events).toEqual([])
  })

  it('V16: tiers — NO_SNAPSHOT; after a refresh: checked with C, unknown with null or an unknown id; never a credential read', async () => {
    const h = makeHarness()
    const empty = h.throws(() => h.tiers())
    expect(empty.code).toBe('NO_SNAPSHOT')
    expect(empty.message).toBe('No endpoint snapshot is stored for this model yet. Refresh first.')
    expect(h.storage.getCredentialProfileById).not.toHaveBeenCalled()
    expect(h.storage.getProviderConfigById).not.toHaveBeenCalled()
    expect(h.decrypts).toEqual([])
    expect(h.requests).toEqual([])
    const refreshed = await h.refresh()
    h.storage.getCredentialProfileById.mockClear()
    h.storage.getProviderConfigById.mockClear()
    const requests = h.requests.length
    const withC = h.tiers()
    expect(tierOrders(withC)).toEqual(GOLDEN_TIERS.interactive)
    expect(withC.accountEligibility).toBe('checked')
    expect(tierOrders(withC)).toEqual(tierOrders(refreshed.result))
    const withNull = h.tiers({ credentialProfileId: null })
    expect(withNull.accountEligibility).toBe('unknown')
    expect(withNull.warnings).toEqual([W2, W3, LIMITED_14])
    expect(h.tiers({ credentialProfileId: UNKNOWN_ID }).accountEligibility).toBe('unknown')
    expect(h.requests).toHaveLength(requests)
    expect(h.decrypts).toEqual([C])
    expect(h.storage.getCredentialProfileById).not.toHaveBeenCalled()
    expect(h.storage.getProviderConfigById).not.toHaveBeenCalled()
  })

  it('V17: dataCollection allow → no data_collection key anywhere in the result; nitro.provider null', async () => {
    const h = makeHarness()
    h.state.settings = { ...DEFAULT_ROUTING_SETTINGS, dataCollection: 'allow' }
    const res = await h.refresh()
    expect(keysDeep(res)).not.toContain('data_collection')
    expect(res.result.nitro.provider).toBeNull()
    expect(keysDeep(h.tiers())).not.toContain('data_collection')
  })

  it('V18: a snapshot stored at 09:20 read at 09:00 → INVALID_TIME', async () => {
    const h = makeHarness()
    await h.refresh()
    h.clock.now = '2026-10-02T09:00:00Z'
    const err = h.throws(() => h.tiers())
    expect(err.code).toBe('INVALID_TIME')
    expect(err.message).toBe('The stored snapshot is newer than the current time; refresh again.')
    expect(h.log.error).not.toHaveBeenCalled()
  })
})

describe('Table V — key discipline', () => {
  it('V20: two refreshes decrypt twice (no memo); no property reachable from the service (depth 3) holds the key', async () => {
    const h = makeHarness()
    await h.refresh()
    await h.refresh()
    expect(h.decrypts).toEqual([C, C])
    // Positive control: the key really travelled, in the header only.
    expect(h.requests.every((r) => r.headers.authorization === `Bearer ${FAKE_KEY}`)).toBe(true)
    const strings: string[] = []
    const seen = new Set<unknown>()
    const walk = (value: unknown, depth: number): void => {
      if (typeof value === 'string') {
        strings.push(value)
        return
      }
      if (depth === 0 || value === null || (typeof value !== 'object' && typeof value !== 'function') || seen.has(value)) return
      seen.add(value)
      if (value instanceof Map) {
        for (const [k, v] of value) {
          walk(k, depth - 1)
          walk(v, depth - 1)
        }
      }
      if (value instanceof Set) for (const v of value) walk(v, depth - 1)
      for (const k of Object.keys(value)) walk((value as Record<string, unknown>)[k], depth - 1)
    }
    walk(h.service, 3)
    expect(strings).toContain(join(h.root, 'routing')) // the walk reaches the store's root (depth 2)
    expect(strings.filter((s) => s.includes(FAKE_KEY))).toEqual([])
  })
})

describe('Table V — observe', () => {
  it('V21: dormant when disabled or undesignated — no credential read, no decrypt, no request', async () => {
    const h = makeHarness()
    for (const observation of [
      { enabled: false, credentialProfileId: C },
      { enabled: true, credentialProfileId: null }
    ]) {
      h.state.observation = observation
      expect(await h.observe()).toStrictEqual({ at: NOW, outcome: 'dormant', failure: null, models: [] })
    }
    expect(h.storage.readRoutingObservation).toHaveBeenCalledTimes(2)
    expect(h.storage.getCredentialProfileById).not.toHaveBeenCalled()
    expect(h.storage.getProviderConfigById).not.toHaveBeenCalled()
    expect(h.storage.readRoutingSettings).not.toHaveBeenCalled()
    expect(h.decrypts).toEqual([])
    expect(h.requests).toEqual([])
    expect(filesUnder(h.root)).toEqual([])
    expect(h.service.status().lastTick?.outcome).toBe('dormant')
  })

  it('V22: designated, empty store → observed; 1 decrypt; exactly 1 GET; snapshot and 32 observations; no POST; no events', async () => {
    const h = makeHarness()
    h.state.observation = { enabled: true, credentialProfileId: C }
    const tick = await h.observe()
    expect(tick).toStrictEqual({ at: NOW, outcome: 'observed', failure: null, models: [{ model: SLUG, outcome: 'observed', failure: null }] })
    expect(h.decrypts).toEqual([C])
    expect(h.requests).toHaveLength(1)
    expect(h.requests[0]).toMatchObject({ url: ENDPOINTS_URL, method: 'GET' })
    expect(h.realStore.readSnapshot(SLUG)?.fetchedAt).toBe(NOW)
    expect(h.realStore.readSnapshot(SLUG)?.endpoints).toHaveLength(33)
    expect(h.realStore.readObservations(SLUG)).toHaveLength(32)
    expect(h.realStore.readCache(SLUG)).toEqual({})
    expect(h.realStore.readAccount(SLUG, C)).toBeNull()
    expect(h.events).toEqual([])
    expect(h.service.status().lastTick).toStrictEqual(tick)
  })

  it('V23: fresh until 25 minutes — same now and +24:59 skipped-fresh (no decrypt), +25:00 observed', async () => {
    const h = makeHarness()
    h.state.observation = { enabled: true, credentialProfileId: C }
    await h.observe()
    const fresh = await h.observe()
    expect(fresh).toStrictEqual({ at: NOW, outcome: 'skipped-fresh', failure: null, models: [{ model: SLUG, outcome: 'skipped-fresh', failure: null }] })
    h.clock.now = '2026-10-02T09:44:59Z'
    expect((await h.observe()).outcome).toBe('skipped-fresh')
    expect(h.decrypts).toEqual([C])
    h.clock.now = '2026-10-02T09:45:00Z'
    expect((await h.observe()).outcome).toBe('observed')
    expect(h.decrypts).toEqual([C, C])
    expect(h.requests).toHaveLength(2)
    expect(h.realStore.readObservations(SLUG)).toHaveLength(64)
  })

  it('V24: refused (0 decrypts); GET 429 fetch-failed rate-limited; vault failure decrypt-failed; writeSnapshot throwing failed', async () => {
    const refused = makeHarness()
    refused.state.observation = { enabled: true, credentialProfileId: C }
    refused.state.providers.set('prov-or', { ...OR_PROVIDER, authMode: 'management' })
    expect(await refused.observe()).toStrictEqual({ at: NOW, outcome: 'refused', failure: null, models: [{ model: SLUG, outcome: 'refused', failure: null }] })
    expect(refused.decrypts).toEqual([])
    expect(refused.requests).toEqual([])

    const limited = makeHarness()
    limited.state.observation = { enabled: true, credentialProfileId: C }
    limited.net.endpoints = { status: 429, text: '' }
    expect(await limited.observe()).toStrictEqual({
      at: NOW,
      outcome: 'fetch-failed',
      failure: 'rate-limited',
      models: [{ model: SLUG, outcome: 'fetch-failed', failure: 'rate-limited' }]
    })
    expect(limited.decrypts).toEqual([C])
    expect(filesUnder(limited.root)).toEqual([])

    const undecryptable = makeHarness()
    undecryptable.state.observation = { enabled: true, credentialProfileId: C }
    undecryptable.vaultState.answer = () => ({ ok: false, kind: 'undecryptable', message: "Credential profile 'OR key' is unavailable." })
    expect((await undecryptable.observe()).outcome).toBe('decrypt-failed')
    expect(undecryptable.requests).toEqual([])

    const failing = makeHarness({
      store: (real) =>
        storeWith(real, {
          writeSnapshot: () => {
            throw new Error('routing store: could not write the snapshot file for deepseek/deepseek-v4.1-flash')
          }
        })
    })
    failing.state.observation = { enabled: true, credentialProfileId: C }
    const tick = await failing.observe()
    expect(tick).toStrictEqual({ at: NOW, outcome: 'failed', failure: null, models: [{ model: SLUG, outcome: 'failed', failure: null }] })
    expect(failing.log.error).toHaveBeenCalledWith('observe failed', expect.any(Error))
    expect(failing.service.status().models[0].busy).toBe(false) // the slot was released
  })

  it('observe with an envelope base URL that is not the gateway → refused after exactly 1 decrypt; 0 requests', async () => {
    const h = makeHarness()
    h.state.observation = { enabled: true, credentialProfileId: C }
    h.vaultState.answer = () => ({ ok: true, value: { key: FAKE_KEY, baseUrl: 'https://proxy.invalid/v1' } })
    expect(await h.observe()).toStrictEqual({ at: NOW, outcome: 'refused', failure: null, models: [{ model: SLUG, outcome: 'refused', failure: null }] })
    expect(h.decrypts).toEqual([C])
    expect(h.requests).toEqual([])
    expect(filesUnder(h.root)).toEqual([])
    expect(h.service.status().models[0].busy).toBe(false)
  })

  it('observe never rejects, even when the vault throws or the observation setting cannot be read', async () => {
    const h = makeHarness()
    h.state.observation = { enabled: true, credentialProfileId: C }
    h.vaultState.answer = () => {
      throw new Error('vault exploded')
    }
    expect(await h.observe()).toStrictEqual({ at: NOW, outcome: 'failed', failure: null, models: [] })
    h.storage.readRoutingObservation.mockImplementation(() => {
      throw new Error('settings table unreadable')
    })
    expect((await h.observe()).outcome).toBe('failed')
    expect(h.log.error).toHaveBeenCalledWith('observe failed', expect.any(Error))
    expect(h.service.status().models[0].busy).toBe(false)
  })
})

describe('Table V — settings, observation, status, dispose, results, listeners', () => {
  it('V25: setObservation stores a null or valid designation without decrypting; refuses a non-OpenRouter or unknown id without writing', () => {
    const h = makeHarness()
    expect(h.service.setObservation({ enabled: true, credentialProfileId: null })).toStrictEqual({ enabled: true, credentialProfileId: null })
    expect(h.state.observation).toStrictEqual({ enabled: true, credentialProfileId: null })
    expect(h.storage.getCredentialProfileById).not.toHaveBeenCalled()
    expect(h.service.setObservation({ enabled: true, credentialProfileId: C })).toStrictEqual({ enabled: true, credentialProfileId: C })
    expect(h.state.observation).toStrictEqual({ enabled: true, credentialProfileId: C })
    expect(h.decrypts).toEqual([])

    h.state.providers.set('prov-other', { ...OR_PROVIDER, id: 'prov-other', baseUrl: 'https://example.invalid/api/v1' })
    h.state.profiles.set(D, { ...OR_PROFILE, id: D, providerId: 'prov-other', label: 'Other key' })
    const writes = h.storage.writeRoutingObservation.mock.calls.length
    const other = h.throws(() => h.service.setObservation({ enabled: true, credentialProfileId: D }))
    expect(other.code).toBe('CREDENTIAL_REFUSED')
    const unknown = h.throws(() => h.service.setObservation({ enabled: true, credentialProfileId: UNKNOWN_ID }))
    expect(unknown.code).toBe('CREDENTIAL_REFUSED')
    expect(h.storage.writeRoutingObservation.mock.calls.length).toBe(writes)
    expect(h.state.observation).toStrictEqual({ enabled: true, credentialProfileId: C })
    expect(h.decrypts).toEqual([])
    expect(h.requests).toEqual([])
    const invalid = h.throws(() => h.service.setObservation({ enabled: true, credentialProfileId: 'x' }))
    expect(invalid.code).toBe('INVALID_REQUEST')
  })

  it('settings round-trip: setSettings stores the parsed value and returns what was stored; invalid settings are refused', () => {
    const h = makeHarness()
    const allow: RoutingSettings = { ...DEFAULT_ROUTING_SETTINGS, dataCollection: 'allow' }
    expect(h.service.setSettings(allow)).toStrictEqual(allow)
    expect(h.service.getSettings()).toStrictEqual(allow)
    const bad = h.throws(() => h.service.setSettings({ ...DEFAULT_ROUTING_SETTINGS, readmitUptimePct: 1 }))
    expect(bad.code).toBe('INVALID_REQUEST')
    expect(h.service.getObservation()).toStrictEqual({ enabled: true, credentialProfileId: null })
    expect(h.service.models()).toStrictEqual({ models: [{ slug: SLUG, displayName: 'DeepSeek V4.1 Flash' }] })
  })

  it('V26: status() after a refresh', async () => {
    const h = makeHarness()
    expect(h.service.status()).toStrictEqual({
      lastTick: null,
      models: [{ model: SLUG, displayName: 'DeepSeek V4.1 Flash', snapshotFetchedAt: null, observations: 0, cacheVerified: 0, busy: false }],
      requestsSinceStart: 0
    })
    await h.refresh()
    const status = h.service.status()
    expect(status.models[0]).toStrictEqual({
      model: SLUG,
      displayName: 'DeepSeek V4.1 Flash',
      snapshotFetchedAt: '2026-10-02T09:20:00Z',
      observations: 32,
      cacheVerified: 13,
      busy: false
    })
    expect(status.requestsSinceStart).toBe(45)
  })

  it('V27: dispose() aborts a pending GET (FETCH_FAILED unreachable); then refresh stops, observe fails without decrypt, dispose is idempotent', async () => {
    const h = makeHarness()
    h.net.holdEndpoints = true
    const pending = h.refresh()
    await vi.waitFor(() => expect(h.requests).toHaveLength(1))
    h.service.dispose()
    const aborted = await h.rejects(pending)
    expect(aborted.code).toBe('FETCH_FAILED')
    expect(aborted.message).toBe('Could not reach OpenRouter.')
    expect(h.events.map((e) => e.event)).toMatchObject([{ stage: 'failed', code: 'FETCH_FAILED', failure: 'unreachable', spentUsd: 0 }])
    const stopped = await h.rejects(h.refresh())
    expect(stopped.code).toBe('OPERATION_FAILED')
    expect(stopped.message).toBe('Routing has stopped.')
    for (const call of [
      () => h.tiers(),
      () => h.service.setSettings(DEFAULT_ROUTING_SETTINGS),
      () => h.service.setObservation({ enabled: true, credentialProfileId: null })
    ]) {
      expect(h.throws(call).message).toBe('Routing has stopped.')
    }
    h.state.observation = { enabled: true, credentialProfileId: C }
    expect(await h.observe()).toStrictEqual({ at: NOW, outcome: 'failed', failure: null, models: [] })
    expect(h.decrypts).toEqual([C])
    expect(() => h.service.dispose()).not.toThrow()
    expect(h.requests).toHaveLength(1)
  })

  it('V28: the refresh result and the golden computeTiers results pass tierResultSchema and parse back strictly equal', async () => {
    const h = makeHarness()
    const res = await h.refresh()
    expect(tierResultSchema.parse(res.result)).toStrictEqual(res.result)
    expect(routingRefreshResultSchema.parse(res)).toStrictEqual(res)
    const fixture = JSON.parse(GOLDEN_TEXT) as {
      fetchedAt: string
      guardrailRemoved: string[]
      dataPolicyDenyRemoved: string[]
      cacheVerified: Record<string, boolean>
    }
    const entry = findModel(bundledModelRegistry(), SLUG)
    if (entry === null) throw new Error('no registry entry')
    const snapshot = { fetchedAt: fixture.fetchedAt, endpoints: parseEndpointsResponse(fixture).endpoints }
    for (const profile of ['interactive', 'helper'] as const) {
      const golden = computeTiers({
        model: entry,
        snapshot,
        history: extractObservations(snapshot),
        account: { guardrailRemoved: fixture.guardrailRemoved, dataPolicyRemoved: fixture.dataPolicyDenyRemoved, checkedAt: '2026-10-02T09:15:39Z' },
        cache: Object.fromEntries(Object.entries(fixture.cacheVerified).map(([tag, verified]) => [tag, { verified, checkedAt: '2026-10-02T09:15:39Z' }])),
        profile,
        effort: 'low',
        settings: DEFAULT_ROUTING_SETTINGS,
        now: NOW
      })
      expect(tierOrders(golden)).toEqual(GOLDEN_TIERS[profile])
      expect(tierResultSchema.parse(golden)).toStrictEqual(golden)
    }
  })

  it('V29: a throwing progress listener cannot break a refresh; unsubscribe stops delivery', async () => {
    const h = makeHarness()
    h.service.onProgress(() => {
      throw new Error('listener failed')
    })
    const counted: RoutingProgressEvent[] = []
    const off = h.service.onProgress((event) => counted.push(event))
    const res = await h.refresh()
    expect(tierOrders(res.result)).toEqual(GOLDEN_TIERS.interactive)
    expect(h.events).toHaveLength(18) // the harness listener saw every event despite the throwing one
    expect(counted).toHaveLength(18) // so did the counting listener: it received events while subscribed
    expect(h.log.warn).toHaveBeenCalledWith('progress listener failed')
    expect(h.log.warn).toHaveBeenCalledTimes(18)

    off()
    await h.refresh() // every tag is now fresh: endpoints, preflight, probe-plan, done
    expect(h.events).toHaveLength(22) // events were emitted...
    expect(counted).toHaveLength(18) // ...and none reached the unsubscribed listener
  })
})

describe('Coordinator decisions (Task 2-3)', () => {
  it('C6: a probe 2xx whose body is not JSON is charged its estimate, is inconclusive, writes no cache record', async () => {
    const h = makeHarness({ deps: { probeTagLimit: 1 } })
    h.net.probeText = 'this is not json'
    const res = await h.refresh()
    const tagEstimate = oneEvent(h, 'probe-plan').planned[0].estimateUsd
    const probe = oneEvent(h, 'probe')
    expect(probe).toMatchObject({ tag: 'atlas-cloud/fp8', outcome: 'inconclusive', failure: 'unrecognized', calls: 3 })
    money(probe.costUsd, tagEstimate, 'tag cost = its estimate')
    money(res.spentUsd, tagEstimate, 'refresh spend')
    expect(res.spentUsd).toBeGreaterThan(0)
    expect(h.realStore.readCache(SLUG)).toEqual({})
  })

  it('C6: a probe call with no 2xx (500) costs 0 and continues; the tag is inconclusive', async () => {
    const h = makeHarness({ deps: { probeTagLimit: 1 } })
    h.net.probeStatus = 500
    const res = await h.refresh()
    expect(oneEvent(h, 'probe')).toMatchObject({ outcome: 'inconclusive', failure: 'provider-error', calls: 3, costUsd: 0 })
    expect(res.spentUsd).toBe(0)
    expect(h.probes()).toHaveLength(3)
  })

  it('the C21 knobs are validated in the constructor', () => {
    const h = makeHarness()
    const base = { storage: h.storage as RoutingStorageLike, vault: {} as Pick<CredentialVault, 'decryptForLaunch'>, store: h.realStore }
    const bad: Pick<RoutingServiceDeps, 'probeTagLimit' | 'probeCapUsd' | 'probeConcurrency'>[] = [
      { probeTagLimit: -1 },
      { probeTagLimit: 1.5 },
      { probeTagLimit: Number.NaN },
      { probeCapUsd: -0.01 },
      { probeCapUsd: Number.NaN },
      { probeCapUsd: Number.POSITIVE_INFINITY },
      { probeConcurrency: 0 },
      { probeConcurrency: 1.5 },
      { probeConcurrency: Number.NaN }
    ]
    for (const knobs of bad) expect(() => new RoutingService({ ...base, ...knobs }), JSON.stringify(knobs)).toThrow(RangeError)
    for (const knobs of [{ probeTagLimit: null }, { probeTagLimit: 0 }, { probeCapUsd: 0 }, { probeConcurrency: 1 }, {}]) {
      expect(() => new RoutingService({ ...base, ...knobs }).dispose()).not.toThrow()
    }
  })

  it('a store write failure after the network starts → OPERATION_FAILED, logged once, exactly one failed event', async () => {
    const boom = new Error('routing store: could not write the account file for deepseek/deepseek-v4.1-flash')
    const h = makeHarness({
      store: (real) =>
        storeWith(real, {
          writeAccount: () => {
            throw boom
          }
        })
    })
    const err = await h.rejects(h.refresh())
    expect(err.code).toBe('OPERATION_FAILED')
    expect(err.message).toBe('Routing operation failed.')
    expect(h.log.error).toHaveBeenCalledTimes(1)
    expect(h.log.error).toHaveBeenCalledWith('refresh failed', boom)
    expect(h.stages()).toEqual(['endpoints', 'failed'])
    expect(oneEvent(h, 'failed')).toMatchObject({ code: 'OPERATION_FAILED', failure: null, message: 'Routing operation failed.', spentUsd: 0 })
    expect(h.probes()).toHaveLength(0)
    expectEventsParse(h)
  })

  it('a RangeError from the store (mergeObservations) is OPERATION_FAILED, never INVALID_TIME', async () => {
    const h = makeHarness({
      store: (real) =>
        storeWith(real, {
          appendObservations: () => {
            throw new RangeError('Invalid retention: maxAgeDays')
          }
        })
    })
    const err = await h.rejects(h.refresh())
    expect(err.code).toBe('OPERATION_FAILED')
    expect(h.stages()).toEqual(['failed'])
    expect(oneEvent(h, 'failed').code).toBe('OPERATION_FAILED')
    expect(h.log.error).toHaveBeenCalledWith('refresh failed', expect.any(RangeError))
  })

  it('a cache write failing mid-probe → one failed event (with the spend so far) last; nothing starts after it', async () => {
    const h = makeHarness({
      store: (real) =>
        storeWith(real, {
          mergeCache: () => {
            throw new Error('routing store: could not write the cache file for deepseek/deepseek-v4.1-flash')
          }
        })
    })
    const err = await h.rejects(h.refresh())
    expect(err.code).toBe('OPERATION_FAILED')
    const terminal = terminalEvents(h)
    expect(terminal).toHaveLength(1)
    expect(terminal[0]).toMatchObject({ stage: 'failed', code: 'OPERATION_FAILED' })
    expect(h.events[h.events.length - 1].event.stage).toBe('failed')
    const failedSeq = h.events[h.events.length - 1].seq
    expect(h.requests.every((r) => r.seq < failedSeq)).toBe(true)
    expect((terminal[0] as { spentUsd: number }).spentUsd).toBeGreaterThan(0)
    expect(h.probes().length).toBeLessThan(42)
    const settled = h.requests.length
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(h.requests).toHaveLength(settled)
  })

  it('computeTiers RangeError in a refresh → INVALID_TIME (not logged); the planner RangeError → OPERATION_FAILED (logged)', async () => {
    for (const [target, code] of [
      [1, 'INVALID_TIME'],
      [2, 'OPERATION_FAILED']
    ] as const) {
      // After the preflight event, now() call 1 is computeTiers' (step 7) and call 2 is planCacheProbe's (step 8).
      const counter: { afterPreflight: number | null } = { afterPreflight: null }
      const h = makeHarness({
        now: () => {
          if (counter.afterPreflight === null) return NOW
          counter.afterPreflight += 1
          return counter.afterPreflight === target ? '2026-10-02 09:20' : NOW
        }
      })
      h.service.onProgress((event) => {
        if (event.stage === 'preflight') counter.afterPreflight = 0
      })
      const err = await h.rejects(h.refresh())
      expect(err.code).toBe(code)
      expect(h.stages()).toEqual(['endpoints', 'preflight', 'failed'])
      expect(oneEvent(h, 'failed')).toMatchObject({ code, failure: null, message: err.message })
      expect(h.probes()).toHaveLength(0)
      if (code === 'INVALID_TIME') expect(h.log.error).not.toHaveBeenCalled()
      else expect(h.log.error).toHaveBeenCalledWith('refresh failed', expect.any(RangeError))
      expectEventsParse(h)
    }
  })

  it('dispose during the probe phase: no probe request after it, remaining tags aborted, exactly one terminal event', async () => {
    const h = makeHarness({ deps: { probeConcurrency: 1 } })
    const at: { seq: number | null } = { seq: null }
    h.net.onProbe = () => {
      if (at.seq !== null) return
      at.seq = h.requests[h.requests.length - 1].seq // this first probe request is answered normally
      h.service.dispose()
    }
    const res = await h.refresh()
    expect(at.seq).not.toBeNull()
    expect(h.probes()).toHaveLength(1)
    expect(h.requests.every((r) => r.seq <= (at.seq as number))).toBe(true)
    expect(res.probed).toEqual(['atlas-cloud/fp8'])
    expect(res.notProbed).toEqual(Q1_ORDER.slice(1).map((tag) => ({ tag, reason: 'aborted' })))
    expect(oneEvent(h, 'probe')).toMatchObject({ tag: 'atlas-cloud/fp8', outcome: 'inconclusive', calls: 1, failure: null })
    expect(terminalEvents(h)).toMatchObject([{ stage: 'done' }])
    expect(h.stages()).toEqual(['endpoints', 'preflight', 'probe-plan', 'probe', 'done'])
    expectEventsParse(h)
  })

  it('with the default sleep, dispose() during a probe gap settles the refresh at once (no 1.5 s wait); the gap timer is unref()ed', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    const h = makeHarness({ realSleep: true }) // probeConcurrency 5: five first calls, then five 1.5 s gaps
    const pending = h.refresh()
    await vi.waitFor(() => {
      expect(h.probes()).toHaveLength(5)
      expect(setTimeoutSpy.mock.calls.filter((call) => call[1] === 1500)).toHaveLength(5)
    })
    const gapTimers = setTimeoutSpy.mock.results
      .filter((_, i) => setTimeoutSpy.mock.calls[i][1] === 1500)
      .map((r) => r.value as { hasRef(): boolean })
    expect(gapTimers.every((t) => t.hasRef() === false)).toBe(true)
    const started = performance.now()
    h.service.dispose()
    const res = await pending
    expect(performance.now() - started).toBeLessThan(1000)
    expect(h.probes()).toHaveLength(5) // no call 2 for any tag, and no sixth tag
    expect(res.notProbed).toEqual(Q1_ORDER.slice(5).map((tag) => ({ tag, reason: 'aborted' })))
    expect(eventsOf(h, 'probe').every((p) => p.calls === 1)).toBe(true)
    expect(terminalEvents(h)).toMatchObject([{ stage: 'done' }])
  })

  it('a throw while building the done event still ends the refresh with exactly one terminal (failed) event', async () => {
    // probeTagLimit 0: after the probe-plan event, now() call 1 is the final ranking's and call 2 the done event's.
    const counter: { afterPlan: number | null } = { afterPlan: null }
    const h = makeHarness({
      deps: { probeTagLimit: 0 },
      now: () => {
        if (counter.afterPlan === null) return NOW
        counter.afterPlan += 1
        if (counter.afterPlan === 2) throw new Error('clock unavailable')
        return NOW
      }
    })
    h.service.onProgress((event) => {
      if (event.stage === 'probe-plan') counter.afterPlan = 0
    })
    const err = await h.rejects(h.refresh())
    expect(err.code).toBe('OPERATION_FAILED')
    expect(h.stages()).toEqual(['endpoints', 'preflight', 'probe-plan', 'failed'])
    expect(terminalEvents(h)).toHaveLength(1)
    expectEventsParse(h)
  })

  it('V19: the key-discipline audit ran after every earlier test and catches a planted leak (positive control)', () => {
    expect(audited.harnesses).toBeGreaterThanOrEqual(30)
    const h = makeHarness()
    h.events.push({
      seq: 0,
      event: { refreshId: ID1, model: SLUG, at: NOW, stage: 'failed', code: 'OPERATION_FAILED', failure: null, message: FAKE_KEY, spentUsd: 0 }
    })
    expect(() => audit(h)).toThrow()
    h.events.length = 0
    h.requests.push({ seq: 1, url: `${ENDPOINTS_URL}?k=${FAKE_KEY}`, method: 'GET', headers: {}, body: null })
    expect(() => audit(h)).toThrow()
    h.requests.length = 0
    h.requests.push({ seq: 1, url: ENDPOINTS_URL, method: 'GET', headers: { 'x-key': FAKE_KEY }, body: null })
    expect(() => audit(h)).toThrow()
    h.requests.length = 0
    expect(() => audit(h)).not.toThrow()
  })
})
