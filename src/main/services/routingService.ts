import { randomUUID } from 'node:crypto'
import type { z } from 'zod'

import {
  ROUTING_FAILURE_MESSAGES,
  ROUTING_REFRESH_COOLDOWN_MS,
  credentialProfileIdSchema,
  routingObservationSettingsSchema,
  routingRefreshRequestSchema,
  routingSettingsSchema,
  routingTiersRequestSchema,
  type AccountEligibility,
  type EndpointSnapshot,
  type ModelRegistryEntry,
  type PreflightIssue,
  type ProbeSkip,
  type RankInput,
  type RoutingCredential,
  type RoutingCredentialList,
  type RoutingErrorCode,
  type RoutingFailure,
  type RoutingModelList,
  type RoutingObservationSettings,
  type RoutingObserverOutcome,
  type RoutingProgressEvent,
  type RoutingRefreshRequest,
  type RoutingRefreshResult,
  type RoutingSettings,
  type RoutingStatus,
  type RoutingTiersRequest,
  type TierResult
} from '../../shared/routing'
import {
  CACHE_PROBE_CALLS,
  CACHE_PROBE_CAP_USD,
  CACHE_PROBE_CONCURRENCY,
  CACHE_PROBE_GAP_MS,
  evaluateProbe,
  planCacheProbe,
  probeCallSpendUsd,
  type ProbeCallRecord
} from '../routing/cacheProbeCore'
import { byCodeUnit, extractObservations } from '../routing/endpointsCore'
import { rowsPerTag } from '../routing/preflightCore'
import { bundledModelRegistry, findModel } from '../routing/registryCore'
import { checkEnvelopeBaseUrl, checkRoutingCredential, credentialRefusalMessage } from '../routing/routingCredentialCore'
import { computeTiers } from '../routing/routingCore'
import { logger, scrubSecrets } from './logger'
import type { FetchResponseLike } from './modelCatalog'
import { OPENROUTER_GATEWAY_BASE_URL } from './openrouterKeys'
import {
  fetchRoutingEndpoints,
  sendRoutingPreflight,
  sendRoutingProbeCall,
  type PreflightCallResult,
  type ProbeCallResult,
  type RoutingFetchLike
} from './routingClient'
import type { RoutingStore } from './routingStore'
import type { StorageService } from './storage'
import type { CredentialVault } from './vault'

/**
 * Model Routing Task 2-3: the routing service (ImplementationSpec-2-3, K8). It
 * owns, for routing, every decrypt, every OpenRouter request, every store
 * write and every `computeTiers` call, and it emits the fixed progress stream
 * (endpoints, preflight, probe-plan, probe*, then exactly one of done | failed).
 *
 * ⚠ KEY DISCIPLINE (MR-D18, MR-G4). Read this before changing anything below.
 *   - `withRoutingKey` is the ONLY code in the app that calls
 *     `vault.decryptForLaunch` for routing, and it calls it EXACTLY ONCE per
 *     refresh and per non-dormant, non-refused observer tick. There is no memo.
 *   - Every refusal that does not need the envelope (not found, provider
 *     missing, management, not an API key, not the gateway, unavailable) is
 *     made by `checkCredential` BEFORE the decrypt, so on a refused path the
 *     plaintext never exists here. The envelope base-URL check runs after the
 *     decrypt and before any request. Envelope `extraHeaders` are ignored (C9).
 *   - The key is the `const key` in `withRoutingKey`. It leaves that frame only
 *     as the argument of the per-call `use` callback, which hands it, as a
 *     parameter, to `runRefresh`/`runProbes` or `observeDue`; those pass it
 *     only to routingClient, which places it in the Authorization header. It is
 *     never assigned to `this`, a module variable, a closure that outlives the
 *     call, an event, a store file, a log call, an error or a return value.
 *   - This file imports `storage.ts` and `vault.ts` as TYPES only (both load
 *     native or Electron modules), so its tests run under plain vitest.
 *
 * Every message that leaves the service is built by `routingError`, which
 * passes it through `scrubSecrets`. Nothing here retries or backs off.
 */

export class RoutingError extends Error {
  constructor(
    readonly code: RoutingErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'RoutingError'
  }
}

export type RoutingStorageLike = Pick<
  StorageService,
  | 'getCredentialProfileById'
  | 'getProviderConfigById'
  | 'readRoutingSettings'
  | 'writeRoutingSettings'
  | 'readRoutingObservation'
  | 'writeRoutingObservation'
  | 'listCredentialProfiles'
  | 'listProviderConfigs'
>
export type RoutingStoreLike = Pick<
  RoutingStore,
  'readSnapshot' | 'writeSnapshot' | 'readObservations' | 'appendObservations' | 'readCache' | 'mergeCache' | 'readAccount' | 'writeAccount'
>
export interface RoutingLog {
  info(message: string): void
  warn(message: string): void
  error(message: string, err: unknown): void
}

export interface RoutingServiceDeps {
  storage: RoutingStorageLike
  vault: Pick<CredentialVault, 'decryptForLaunch'>
  store: RoutingStoreLike
  fetchImpl?: RoutingFetchLike // default: the global fetch
  now?: () => string // default: () => new Date().toISOString()
  sleep?: (ms: number) => Promise<void> // default: a setTimeout promise
  randomId?: () => string // default: randomUUID; refreshId and the probe run nonce
  log?: RoutingLog // default: logger, messages prefixed '[routing] ', errors through { err }
  probeTagLimit?: number | null // C21; default null
  probeCapUsd?: number // C21; default CACHE_PROBE_CAP_USD (0.05)
  probeConcurrency?: number // C21; default CACHE_PROBE_CONCURRENCY (5)
  refreshCooldownMs?: number // MR-D22, C3; default ROUTING_REFRESH_COOLDOWN_MS; 0 disables. Never reachable from IPC.
}

export interface RoutingObserverTick {
  at: string
  outcome: RoutingObserverOutcome
  failure: RoutingFailure | null
  models: { model: string; outcome: RoutingObserverOutcome; failure: RoutingFailure | null }[]
}
export interface RoutingServiceStatus {
  lastTick: RoutingObserverTick | null
  models: RoutingStatus['models']
  requestsSinceStart: number
}

/** The default log: the app logger, `[routing] `-prefixed; errors go through pino's scrubbing `{ err }` serializer. */
export const DEFAULT_ROUTING_LOG: RoutingLog = {
  info: (message) => logger.info(`[routing] ${message}`),
  warn: (message) => logger.warn(`[routing] ${message}`),
  error: (message, err) => logger.error({ err }, `[routing] ${message}`)
}

const MESSAGES = {
  invalid: 'Invalid routing request.',
  stopped: 'Routing has stopped.',
  unknownModel: 'Model routing does not know this model.',
  noSnapshot: 'No endpoint snapshot is stored for this model yet. Refresh first.',
  busy: 'A routing refresh or observation is already running for this model.',
  invalidTime: 'The stored snapshot is newer than the current time; refresh again.',
  failed: 'Routing operation failed.'
} as const

/** MR-D22. Exact text; `seconds` is 1..60. */
function cooldownMessage(seconds: number): string {
  return `This model was refreshed less than a minute ago. Try again in ${seconds} s.`
}

/** Every RoutingError the service throws is built here, so every outgoing message is scrubbed. */
function routingError(code: RoutingErrorCode, message: string): RoutingError {
  return new RoutingError(code, scrubSecrets(message))
}

/** C16: these two failures stop every further key-bearing call (a refresh) or GET (a tick). */
function stopsFurtherCalls(failure: RoutingFailure | null): boolean {
  return failure === 'auth-failed' || failure === 'rate-limited'
}

interface PreflightOutcome {
  attempted: boolean
  removed: string[] | null
  issue: PreflightIssue | null
  failure: RoutingFailure | null
}
const NOT_SENT: PreflightOutcome = { attempted: false, removed: null, issue: null, failure: null }

/** Spec step 6: a sent call that returned is `{ true, removed, issue, null }`; a transport failure `{ true, null, null, failure }`. */
function preflightOutcome(result: PreflightCallResult): PreflightOutcome {
  return result.ok
    ? { attempted: true, removed: result.removed, issue: result.issue, failure: null }
    : { attempted: true, removed: null, issue: null, failure: result.failure }
}

/**
 * C6 (coordinator decision 1). A 2xx whose body could not be read may still
 * have been billed, so it is recorded as a success with no usage: spend then
 * charges its per-call estimate, and the outcome can only be inconclusive. Any
 * other failure had no 2xx and is `{ ok: false }` (spend 0).
 */
function probeRecord(result: ProbeCallResult): ProbeCallRecord {
  if (result.ok) return { ok: true, usage: result.usage }
  if (result.failure === 'unrecognized' && result.status !== null && result.status >= 200 && result.status < 300) {
    return { ok: true, usage: { promptTokens: null, cachedTokens: null, costUsd: null } }
  }
  return { ok: false }
}

/**
 * The default `sleep` (the probe gap): resolves early when `signal` aborts, so
 * dispose() never waits out a 1.5 s gap, and its timer is `unref()`ed, so a
 * quitting process is never kept alive by it.
 */
function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const done = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    timer.unref()
    signal.addEventListener('abort', done, { once: true })
  })
}

/**
 * Overall tick outcome when no model was observed: the first present, in this
 * order. Spec step 6 lists refused, decrypt-failed, fetch-failed, busy,
 * skipped-fresh and omits `failed` (a model whose store write threw,
 * coordinator decision 4). It is inserted between fetch-failed and busy, so a
 * store failure is never hidden behind another model's busy or fresh.
 */
const OBSERVER_PRECEDENCE: readonly RoutingObserverOutcome[] = ['refused', 'decrypt-failed', 'fetch-failed', 'failed', 'busy', 'skipped-fresh']

/** Mutable state of one refresh, shared by its probe workers. */
interface RefreshRun {
  spent: number
  abort: boolean
  terminal: boolean
}

interface ModelOutcome {
  outcome: RoutingObserverOutcome
  failure: RoutingFailure | null
}

export class RoutingService {
  private readonly storage: RoutingStorageLike
  private readonly vault: Pick<CredentialVault, 'decryptForLaunch'>
  private readonly store: RoutingStoreLike
  private readonly now: () => string
  private readonly sleep: (ms: number) => Promise<void>
  private readonly randomId: () => string
  private readonly log: RoutingLog
  private readonly probeTagLimit: number | null
  private readonly probeCapUsd: number
  private readonly probeConcurrency: number
  private readonly refreshCooldownMs: number
  /** C20: the ONE wrapper every routingClient call goes through; it counts before delegating. */
  private readonly countingFetch: RoutingFetchLike
  /** K7: single flight per model, shared by refresh and observe. */
  private readonly busy = new Set<string>()
  /** MR-D22: per model slug, when the last refresh that reached the network ended (epoch ms, service clock). */
  private readonly refreshEndedAt = new Map<string, number>()
  private readonly listeners = new Set<(event: RoutingProgressEvent) => void>()
  /** Its signal goes to every client call; dispose() aborts it. */
  private readonly controller = new AbortController()
  private disposed = false
  private requests = 0
  private lastTick: RoutingObserverTick | null = null

  constructor(deps: RoutingServiceDeps) {
    // C21 knobs (coordinator decision 2): refused here rather than discovered mid-refresh.
    const probeTagLimit = deps.probeTagLimit ?? null
    const probeCapUsd = deps.probeCapUsd ?? CACHE_PROBE_CAP_USD
    const probeConcurrency = deps.probeConcurrency ?? CACHE_PROBE_CONCURRENCY
    if (probeTagLimit !== null && !(Number.isInteger(probeTagLimit) && probeTagLimit >= 0)) {
      throw new RangeError('Invalid probeTagLimit')
    }
    if (!(Number.isFinite(probeCapUsd) && probeCapUsd >= 0)) throw new RangeError('Invalid probeCapUsd')
    if (!(Number.isInteger(probeConcurrency) && probeConcurrency >= 1)) throw new RangeError('Invalid probeConcurrency')
    this.probeTagLimit = probeTagLimit
    this.probeCapUsd = probeCapUsd
    this.probeConcurrency = probeConcurrency
    // MR-D22, C3: an integer from 0 (off) to 60,000, so "less than a minute ago" stays true.
    const refreshCooldownMs = deps.refreshCooldownMs ?? ROUTING_REFRESH_COOLDOWN_MS
    if (!(Number.isInteger(refreshCooldownMs) && refreshCooldownMs >= 0 && refreshCooldownMs <= ROUTING_REFRESH_COOLDOWN_MS)) {
      throw new RangeError('Invalid refreshCooldownMs')
    }
    this.refreshCooldownMs = refreshCooldownMs

    this.storage = deps.storage
    this.vault = deps.vault
    this.store = deps.store
    this.now = deps.now ?? (() => new Date().toISOString())
    this.sleep = deps.sleep ?? ((ms) => abortableSleep(ms, this.controller.signal))
    this.randomId = deps.randomId ?? (() => randomUUID())
    this.log = deps.log ?? DEFAULT_ROUTING_LOG
    const fetchImpl: RoutingFetchLike =
      deps.fetchImpl ?? ((url, init) => fetch(url, init) as unknown as Promise<FetchResponseLike>)
    this.countingFetch = (url, init) => {
      this.requests += 1
      return fetchImpl(url, init)
    }
  }

  // ── Public API ──

  models(): RoutingModelList {
    try {
      return { models: this.registryEntries().map((e) => ({ slug: e.slug, displayName: e.displayName })) }
    } catch (err) {
      throw this.unexpected('models', err)
    }
  }

  /** Phase 3 (K1, C1): the credentials a refresh or a designation would accept. The pre-decrypt predicate only; never decrypts. */
  credentials(): RoutingCredentialList {
    try {
      const providers = new Map(this.storage.listProviderConfigs().map((p) => [p.id, p] as const))
      const credentials: RoutingCredential[] = []
      for (const profile of this.storage.listCredentialProfiles()) {
        if (!credentialProfileIdSchema.safeParse(profile.id).success) continue // a refresh could never name it
        const provider = providers.get(profile.providerId) ?? null
        if (provider === null || !checkRoutingCredential(profile, provider, OPENROUTER_GATEWAY_BASE_URL).ok) continue
        credentials.push({ id: profile.id, label: scrubSecrets(profile.label), providerName: scrubSecrets(provider.name) })
      }
      credentials.sort((a, b) => byCodeUnit(a.label, b.label) || byCodeUnit(a.id, b.id))
      return { credentials }
    } catch (err) {
      throw this.unexpected('credentials', err)
    }
  }

  /** K8: ranks what is stored. Never reads a credential row, never decrypts, never sends a request. */
  tiers(request: RoutingTiersRequest): TierResult {
    try {
      const q = this.parseInput(routingTiersRequestSchema, request)
      const entry = this.registryEntry(q.model)
      this.assertLive()
      const snapshot = this.store.readSnapshot(q.model)
      if (snapshot === null) throw routingError('NO_SNAPSHOT', MESSAGES.noSnapshot)
      const stored = q.credentialProfileId === null ? null : this.store.readAccount(q.model, q.credentialProfileId)
      const account: AccountEligibility = stored ?? { guardrailRemoved: null, dataPolicyRemoved: null, checkedAt: null }
      return this.rank({
        model: entry,
        snapshot,
        history: this.store.readObservations(q.model),
        account,
        cache: this.store.readCache(q.model),
        profile: q.profile,
        effort: q.effort,
        settings: this.readSettings(),
        now: this.now()
      })
    } catch (err) {
      throw this.unexpected('tiers', err)
    }
  }

  /** K8, C15–C18: one user action. Fetch, store, preflight ×2, store, rank, plan and run the probe, store, rank again. */
  async refresh(request: RoutingRefreshRequest): Promise<RoutingRefreshResult> {
    let slot: string | null = null
    let reached = false // C2: true once every pre-network refusal has passed
    try {
      // 1. Parse; registry; dispose; slot. Steps 1–3 emit no progress event (C17).
      const q = this.parseInput(routingRefreshRequestSchema, request)
      const entry = this.registryEntry(q.model)
      this.assertLive()
      if (this.busy.has(q.model)) throw routingError('BUSY', MESSAGES.busy)
      this.assertCooledDown(q.model) // MR-D22: pre-network; no event, no credential read, no decrypt
      this.busy.add(q.model)
      slot = q.model
      // 2. Settings, validated (computeTiers trusts them).
      const settings = this.readSettings()
      // 3. Credential resolution; 4–12 run inside it with the key as a parameter.
      return await this.withRoutingKey(q.credentialProfileId, (key) => {
        reached = true // the decrypt succeeded and the envelope passed; C17's events begin in runRefresh
        return this.runRefresh(key, q, entry, settings)
      })
    } catch (err) {
      throw this.unexpected('refresh', err)
    } finally {
      if (slot !== null) {
        if (reached) this.recordRefreshEnd(slot)
        this.busy.delete(slot)
      }
    }
  }

  /**
   * K7, C19: one observer tick. Never rejects. Dormant reads only the
   * observation setting; a due model gets one GET; no preflight, no probe, no
   * progress event. One decrypt covers every due model.
   */
  async observe(options: { freshMs: number }): Promise<RoutingObserverTick> {
    let at: string | null = null
    const acquired: string[] = []
    let tick: RoutingObserverTick
    try {
      at = this.now()
      tick = await this.observeTick(at, options.freshMs, acquired)
    } catch (err) {
      this.log.error('observe failed', err)
      tick = { at: at ?? new Date().toISOString(), outcome: 'failed', failure: null, models: [] }
    } finally {
      for (const model of acquired) this.busy.delete(model)
    }
    this.lastTick = tick
    return tick
  }

  status(): RoutingServiceStatus {
    try {
      const models = this.registryEntries().map((e) => {
        const snapshot = this.store.readSnapshot(e.slug)
        const cache = this.store.readCache(e.slug)
        return {
          model: e.slug,
          displayName: e.displayName,
          snapshotFetchedAt: snapshot === null ? null : snapshot.fetchedAt,
          observations: this.store.readObservations(e.slug).length,
          cacheVerified: Object.values(cache).filter((record) => record.verified === true).length,
          busy: this.busy.has(e.slug)
        }
      })
      const last = this.lastTick
      const lastTick = last === null ? null : { ...last, models: last.models.map((m) => ({ ...m })) }
      return { lastTick, models, requestsSinceStart: this.requests }
    } catch (err) {
      throw this.unexpected('status', err)
    }
  }

  getSettings(): RoutingSettings {
    try {
      return this.readSettings()
    } catch (err) {
      throw this.unexpected('getSettings', err)
    }
  }

  /** Returns what was stored. */
  setSettings(settings: RoutingSettings): RoutingSettings {
    try {
      const s = this.parseInput(routingSettingsSchema, settings)
      this.assertLive()
      this.storage.writeRoutingSettings(s)
      return this.readSettings()
    } catch (err) {
      throw this.unexpected('setSettings', err)
    }
  }

  getObservation(): RoutingObservationSettings {
    try {
      return routingObservationSettingsSchema.parse(this.storage.readRoutingObservation())
    } catch (err) {
      throw this.unexpected('getObservation', err)
    }
  }

  /** MR-D19: designation is the consent. It runs the pre-decrypt checks only, and writes nothing on a refusal. */
  setObservation(value: RoutingObservationSettings): RoutingObservationSettings {
    try {
      const v = this.parseInput(routingObservationSettingsSchema, value)
      this.assertLive()
      if (v.credentialProfileId !== null) this.checkCredential(v.credentialProfileId)
      this.storage.writeRoutingObservation(v)
      return routingObservationSettingsSchema.parse(this.storage.readRoutingObservation())
    } catch (err) {
      throw this.unexpected('setObservation', err)
    }
  }

  onProgress(listener: (event: RoutingProgressEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Idempotent. Aborts every in-flight request; later refresh/tiers/set* throw, observe returns `failed`. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.controller.abort()
  }

  // ── Credential resolution (MR-D18, C10) ──

  /** Steps 1–2: every refusal that does not need the envelope. NEVER decrypts. */
  private checkCredential(credentialProfileId: string): { label: string } {
    const profile = this.storage.getCredentialProfileById(credentialProfileId)
    const provider = profile === null ? null : this.storage.getProviderConfigById(profile.providerId)
    const check = checkRoutingCredential(profile, provider, OPENROUTER_GATEWAY_BASE_URL)
    if (!check.ok) throw routingError('CREDENTIAL_REFUSED', check.message)
    // Unreachable (a missing profile is refused above); narrows the type.
    if (profile === null) throw routingError('CREDENTIAL_REFUSED', credentialRefusalMessage('not-found', null))
    return { label: profile.label }
  }

  /**
   * Steps 1–5, the ONLY caller of `vault.decryptForLaunch`, exactly once per
   * call. Throws CREDENTIAL_REFUSED (before the decrypt, or for an envelope
   * base URL that is not the gateway, before any request) or
   * CREDENTIAL_UNAVAILABLE (the vault has already marked the row and logged).
   * On success the key is handed to `use`, which runs inside this call; the
   * key is not returned and not kept.
   */
  private async withRoutingKey<T>(credentialProfileId: string, use: (key: string) => Promise<T>): Promise<T> {
    const { label } = this.checkCredential(credentialProfileId)
    const dec = await this.vault.decryptForLaunch(credentialProfileId)
    if (!dec.ok) throw routingError('CREDENTIAL_UNAVAILABLE', dec.message)
    const envelope = checkEnvelopeBaseUrl(dec.value.baseUrl, label, OPENROUTER_GATEWAY_BASE_URL)
    if (!envelope.ok) throw routingError('CREDENTIAL_REFUSED', envelope.message)
    // C9: the envelope's extraHeaders are never read. The key is this const, and nothing else.
    const key = dec.value.key
    return await use(key)
  }

  // ── Refresh, steps 4–12 ──

  private async runRefresh(
    key: string,
    q: RoutingRefreshRequest,
    entry: ModelRegistryEntry,
    settings: RoutingSettings
  ): Promise<RoutingRefreshResult> {
    const model = q.model
    const signal = this.controller.signal
    // 4. From here every exit emits exactly one terminal event.
    const refreshId = this.randomId()
    const run: RefreshRun = { spent: 0, abort: false, terminal: false }
    try {
      // 5. Endpoints.
      const fetched = await fetchRoutingEndpoints({ key, model, fetchImpl: this.countingFetch, signal })
      if (!fetched.ok) {
        const message = scrubSecrets(ROUTING_FAILURE_MESSAGES[fetched.failure])
        // The event is built BEFORE `terminal` is set: if building it throws (now()), the catch below still emits one.
        const failed: RoutingProgressEvent = {
          refreshId,
          model,
          at: this.now(),
          stage: 'failed',
          code: 'FETCH_FAILED',
          failure: fetched.failure,
          message,
          spentUsd: 0
        }
        run.terminal = true
        this.emit(failed)
        throw routingError('FETCH_FAILED', message)
      }
      const fetchedAt = this.now()
      const snapshot: EndpointSnapshot = { fetchedAt, endpoints: fetched.endpoints }
      this.store.writeSnapshot(model, snapshot)
      this.store.appendObservations(model, extractObservations(snapshot), fetchedAt, settings.observationMaxAgeDays)
      const rows = rowsPerTag(fetched.endpoints)
      this.emit({
        refreshId,
        model,
        at: this.now(),
        stage: 'endpoints',
        fetchedAt,
        endpointRows: fetched.endpoints.length,
        tags: Object.keys(rows).length,
        rejectedRows: fetched.rejectedRows
      })

      // 6. Preflights (C16): the second is not sent after an auth-failed or rate-limited first.
      // Beyond the spec (recorded, Task 2-3 review): nor once disposed, so no request starts after dispose().
      const guardrails = preflightOutcome(
        await sendRoutingPreflight({ key, model, fetchImpl: this.countingFetch, signal, step: 'guardrails', rowsPerTag: rows })
      )
      const dataPolicy =
        stopsFurtherCalls(guardrails.failure) || this.disposed
          ? NOT_SENT
          : preflightOutcome(
              await sendRoutingPreflight({ key, model, fetchImpl: this.countingFetch, signal, step: 'dataPolicy', rowsPerTag: rows })
            )
      const checkedAt = this.now()
      const account: AccountEligibility = { guardrailRemoved: guardrails.removed, dataPolicyRemoved: dataPolicy.removed, checkedAt }
      this.store.writeAccount(model, q.credentialProfileId, account) // C15: replaced, nulls included
      this.emit({ refreshId, model, at: this.now(), stage: 'preflight', checkedAt, guardrails, dataPolicy })
      run.abort = stopsFurtherCalls(guardrails.failure) || stopsFurtherCalls(dataPolicy.failure)

      // 7. First ranking, on what is now stored.
      const history = this.store.readObservations(model)
      const base = { model: entry, snapshot, history, account, profile: q.profile, effort: q.effort, settings }
      const first = this.rank({ ...base, cache: this.store.readCache(model), now: this.now() })

      // 8. Plan. The estimate is emitted BEFORE any probe request (MR-G7).
      const plan = planCacheProbe({
        result: first,
        cache: this.store.readCache(model),
        now: this.now(),
        capUsd: this.probeCapUsd,
        tagLimit: this.probeTagLimit
      })
      const planned = run.abort ? [] : plan.planned.map((p) => ({ tag: p.tag, estimateUsd: p.estimateUsd }))
      const planSkips: ProbeSkip[] = run.abort
        ? [...plan.notProbed, ...plan.planned.map((p): ProbeSkip => ({ tag: p.tag, reason: 'aborted' }))]
        : [...plan.notProbed]
      const estimateUsd = run.abort ? 0 : plan.estimateUsd
      this.emit({
        refreshId,
        model,
        at: this.now(),
        stage: 'probe-plan',
        planned: planned.map((p) => ({ ...p })),
        estimateUsd,
        capUsd: this.probeCapUsd,
        fresh: [...plan.fresh],
        notProbed: planSkips.map((s) => ({ ...s }))
      })

      // 9. Probe.
      const runtime = planned.length > 0 ? await this.runProbes(key, model, refreshId, planned, run) : { probed: [], skips: [] }

      // 10. Final ranking, with the probed cache.
      const result = this.rank({ ...base, cache: this.store.readCache(model), now: this.now() })

      // 11. Done. Built before `terminal` is set, so a throw while building still reaches the failed path.
      const notProbed = [...planSkips, ...runtime.skips]
      const done: RoutingProgressEvent = {
        refreshId,
        model,
        at: this.now(),
        stage: 'done',
        estimateUsd,
        spentUsd: run.spent,
        probed: [...runtime.probed],
        notProbed: notProbed.map((s) => ({ ...s })),
        accountEligibility: result.accountEligibility
      }
      run.terminal = true
      this.emit(done)
      return { refreshId, estimateUsd, spentUsd: run.spent, probed: runtime.probed, notProbed, result }
    } catch (err) {
      // 12. Exactly one terminal event, then rethrow.
      const error = this.unexpected('refresh', err)
      if (!run.terminal) {
        const failed: RoutingProgressEvent = {
          refreshId,
          model,
          at: this.now(),
          stage: 'failed',
          code: error.code,
          failure: null,
          message: error.message,
          spentUsd: run.spent
        }
        run.terminal = true
        this.emit(failed)
      }
      throw error
    }
  }

  /**
   * Step 9 (K4, C16, MR-G7). At most `probeConcurrency` tags in flight, started
   * in plan order. Before a tag starts: an abort (or dispose, or an earlier
   * error) skips it and every unstarted tag with `aborted`; else actual spend
   * at the cap skips them with `cap`. Up to three calls per tag; before calls 2
   * and 3 the gap is awaited and the abort re-checked, so an auth-failed or
   * rate-limited answer stops every further key-bearing call (C16).
   */
  private async runProbes(
    key: string,
    model: string,
    refreshId: string,
    planned: readonly { tag: string; estimateUsd: number }[],
    run: RefreshRun
  ): Promise<{ probed: string[]; skips: ProbeSkip[] }> {
    const runNonce = this.randomId()
    const signal = this.controller.signal
    const probed: string[] = []
    const skips: ProbeSkip[] = []
    const errors: unknown[] = []
    let next = 0
    const stopped = (): boolean => run.abort || this.disposed || errors.length > 0

    const probeTag = async (tag: string, tagEstimateUsd: number): Promise<void> => {
      const perCallUsd = tagEstimateUsd / CACHE_PROBE_CALLS
      const records: ProbeCallRecord[] = []
      let failure: RoutingFailure | null = null
      let costUsd = 0
      for (let call = 0; call < CACHE_PROBE_CALLS; call++) {
        if (call > 0) {
          if (stopped()) break
          await this.sleep(CACHE_PROBE_GAP_MS)
          if (stopped()) break
        }
        const answer = await sendRoutingProbeCall({ key, model, tag, runNonce, fetchImpl: this.countingFetch, signal })
        if (!answer.ok && failure === null) failure = answer.failure
        const record = probeRecord(answer)
        records.push(record)
        // Spend is the SERVICE'S accounting: usage.cost, or the per-call estimate for a 2xx without
        // one (C6). A call that times out or is aborted after it was sent may still be billed by
        // OpenRouter but counts 0 here (no 2xx was seen), so `spentUsd` can under-count; it stays
        // bounded by the estimate-capped plan, since no tag starts once spend reaches the cap.
        const callUsd = probeCallSpendUsd(record, perCallUsd)
        costUsd += callUsd
        run.spent += callUsd // the next start check sees it
        if (!answer.ok && stopsFurtherCalls(answer.failure)) {
          run.abort = true
          break
        }
      }
      const outcome = evaluateProbe(records)
      if (outcome !== 'inconclusive') {
        this.store.mergeCache(model, { [tag]: { verified: outcome === 'verified', checkedAt: this.now() } })
      }
      this.emit({ refreshId, model, at: this.now(), stage: 'probe', tag, outcome, failure, calls: records.length, costUsd, spentUsd: run.spent })
    }

    const worker = async (): Promise<void> => {
      while (next < planned.length) {
        const reason: ProbeSkip['reason'] | null = stopped() ? 'aborted' : run.spent >= this.probeCapUsd ? 'cap' : null
        if (reason !== null) {
          for (const p of planned.slice(next)) skips.push({ tag: p.tag, reason })
          next = planned.length
          return
        }
        const item = planned[next++]
        probed.push(item.tag)
        try {
          await probeTag(item.tag, item.estimateUsd)
        } catch (err) {
          errors.push(err)
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(this.probeConcurrency, planned.length) }, () => worker()))
    if (errors.length > 0) throw errors[0]
    return { probed, skips }
  }

  // ── Observe ──

  private async observeTick(at: string, freshMs: number, acquired: string[]): Promise<RoutingObserverTick> {
    // 1. Disposed.
    if (this.disposed) return { at, outcome: 'failed', failure: null, models: [] }
    if (!(Number.isFinite(freshMs) && freshMs >= 0)) throw new RangeError('Invalid freshMs')

    // 2. Dormant: the observation setting is the ONLY read (MR-D19); no credential row, no decrypt.
    const obs = routingObservationSettingsSchema.parse(this.storage.readRoutingObservation())
    if (!obs.enabled || obs.credentialProfileId === null) return { at, outcome: 'dormant', failure: null, models: [] }
    const credentialProfileId = obs.credentialProfileId

    // 3. Fresh, busy or due, per registry model in slug order.
    const atMs = Date.parse(at)
    const slugs = this.registryEntries().map((e) => e.slug)
    const outcomes = new Map<string, ModelOutcome>()
    const due: string[] = []
    let anyFresh = false
    for (const slug of slugs) {
      const snapshot = this.store.readSnapshot(slug)
      if (snapshot !== null && atMs - Date.parse(snapshot.fetchedAt) < freshMs) {
        outcomes.set(slug, { outcome: 'skipped-fresh', failure: null })
        anyFresh = true
      } else if (this.busy.has(slug)) {
        outcomes.set(slug, { outcome: 'busy', failure: null })
      } else {
        due.push(slug)
      }
    }
    for (const slug of due) {
      this.busy.add(slug)
      acquired.push(slug)
    }
    const listed = (): RoutingObserverTick['models'] =>
      slugs.map((slug) => {
        const o = outcomes.get(slug) ?? { outcome: 'failed', failure: null }
        return { model: slug, outcome: o.outcome, failure: o.failure }
      })
    if (due.length === 0) return { at, outcome: anyFresh ? 'skipped-fresh' : 'busy', failure: null, models: listed() }

    // 4–5. One credential resolution for every due model.
    const settings = this.readSettings()
    const progress = { keyed: false }
    try {
      await this.withRoutingKey(credentialProfileId, async (key) => {
        progress.keyed = true
        await this.observeDue(key, due, outcomes, settings)
      })
    } catch (err) {
      if (progress.keyed || !(err instanceof RoutingError)) throw err
      const outcome: RoutingObserverOutcome | null =
        err.code === 'CREDENTIAL_REFUSED' ? 'refused' : err.code === 'CREDENTIAL_UNAVAILABLE' ? 'decrypt-failed' : null
      if (outcome === null) throw err
      for (const slug of due) outcomes.set(slug, { outcome, failure: null })
    }

    // 6. Overall outcome (slots are released by observe's finally).
    const models = listed()
    const overall: RoutingObserverOutcome = models.some((m) => m.outcome === 'observed')
      ? 'observed'
      : (OBSERVER_PRECEDENCE.find((o) => models.some((m) => m.outcome === o)) ?? 'failed')
    const failure = models.find((m) => m.failure !== null)?.failure ?? null
    return { at, outcome: overall, failure, models }
  }

  /** Step 5: one GET per due model, in order. Never throws for a model; a store failure is that model's `failed`. */
  private async observeDue(key: string, due: readonly string[], outcomes: Map<string, ModelOutcome>, settings: RoutingSettings): Promise<void> {
    const signal = this.controller.signal
    let stop: RoutingFailure | null = null
    for (const model of due) {
      if (stop !== null) {
        // auth-failed or rate-limited: every remaining due model the same way, without sending.
        outcomes.set(model, { outcome: 'fetch-failed', failure: stop })
        continue
      }
      if (this.disposed) {
        // Beyond the spec (recorded, Task 2-3 review): once disposed, a remaining due model is
        // `failed` without sending, so no request starts after dispose().
        outcomes.set(model, { outcome: 'failed', failure: null })
        continue
      }
      try {
        const fetched = await fetchRoutingEndpoints({ key, model, fetchImpl: this.countingFetch, signal })
        if (!fetched.ok) {
          outcomes.set(model, { outcome: 'fetch-failed', failure: fetched.failure })
          if (stopsFurtherCalls(fetched.failure)) stop = fetched.failure
          continue
        }
        const fetchedAt = this.now()
        const snapshot: EndpointSnapshot = { fetchedAt, endpoints: fetched.endpoints }
        this.store.writeSnapshot(model, snapshot)
        this.store.appendObservations(model, extractObservations(snapshot), fetchedAt, settings.observationMaxAgeDays)
        outcomes.set(model, { outcome: 'observed', failure: null })
      } catch (err) {
        this.log.error('observe failed', err)
        outcomes.set(model, { outcome: 'failed', failure: null })
      }
    }
  }

  // ── Helpers ──

  /** The registry's entries, sorted by slug (code units). */
  private registryEntries(): ModelRegistryEntry[] {
    return Object.values(bundledModelRegistry().models).sort((a, b) => byCodeUnit(a.slug, b.slug))
  }

  private registryEntry(model: string): ModelRegistryEntry {
    const entry = findModel(bundledModelRegistry(), model)
    if (entry === null) throw routingError('UNKNOWN_MODEL', MESSAGES.unknownModel)
    return entry
  }

  /** Input only: a failed parse is the caller's error. Any other ZodError is the service's own (OPERATION_FAILED). */
  private parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
    const parsed = schema.safeParse(input)
    if (!parsed.success) throw routingError('INVALID_REQUEST', MESSAGES.invalid)
    return parsed.data
  }

  private assertLive(): void {
    if (this.disposed) throw routingError('OPERATION_FAILED', MESSAGES.stopped)
  }

  /** computeTiers trusts its settings (Phase 1 carry-over), so they are re-validated on every read. */
  private readSettings(): RoutingSettings {
    return routingSettingsSchema.parse(this.storage.readRoutingSettings())
  }

  /** MR-D22, C2. Refused iff 0 <= elapsed < cooldown; NaN or a clock that moved back is not refused. */
  private assertCooledDown(model: string): void {
    if (this.refreshCooldownMs === 0) return // C3: no clock read at all
    const endedAt = this.refreshEndedAt.get(model)
    if (endedAt === undefined) return
    const elapsed = Date.parse(this.now()) - endedAt
    if (!(elapsed >= 0 && elapsed < this.refreshCooldownMs)) return
    throw routingError('BUSY', cooldownMessage(Math.ceil((this.refreshCooldownMs - elapsed) / 1000)))
  }

  /** Called from refresh's finally only when the refresh reached the network. Never throws. */
  private recordRefreshEnd(model: string): void {
    if (this.refreshCooldownMs === 0) return
    try {
      const endedAt = Date.parse(this.now())
      if (Number.isFinite(endedAt)) this.refreshEndedAt.set(model, endedAt)
    } catch {
      // A failing clock records nothing; the refresh's own result or error stands.
    }
  }

  /** Only computeTiers' RangeError is INVALID_TIME (coordinator decision 3); any other RangeError is unexpected. */
  private rank(input: RankInput): TierResult {
    try {
      return computeTiers(input)
    } catch (err) {
      if (err instanceof RangeError) throw routingError('INVALID_TIME', MESSAGES.invalidTime)
      throw err
    }
  }

  /** A RoutingError passes through; anything else is logged once and becomes the fixed OPERATION_FAILED. */
  private unexpected(method: string, err: unknown): RoutingError {
    if (err instanceof RoutingError) return err
    this.log.error(`${method} failed`, err)
    return routingError('OPERATION_FAILED', MESSAGES.failed)
  }

  /** Synchronous, to every listener; a throwing listener is logged and ignored. */
  private emit(event: RoutingProgressEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event)
      } catch {
        this.log.warn('progress listener failed')
      }
    }
  }
}
