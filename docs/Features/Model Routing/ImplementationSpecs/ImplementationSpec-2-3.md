# Implementation specification 2-3 — RoutingService, observer and the live check

Paired [task](../Tasks/Task-2-3.md). Decisions: [roadmap](../roadmap.md) MR-D8 to MR-D12; user decisions MR-D18, MR-D19, MR-D20; [overview](../Tasks/Phase-2-Overview.md) K1, K3, K4, K7, K8, K10 and clarifications C6, C11, C15–C21. Builds on [ImplementationSpec-2-1](ImplementationSpec-2-1.md) and [ImplementationSpec-2-2](ImplementationSpec-2-2.md). **Not started.**

## Files and insertion points

Verified 2026-10-02 at `a9842a5`.

| File | Action |
|---|---|
| `src/shared/routing.ts` | Append the "Phase 2 — service contract" block below, after Task 2-2's block. Nothing above it changes. |
| `src/shared/routing.test.ts` | Append `describe('Table S4 — service contract')`. |
| `src/main/services/routingService.ts`, `routingService.test.ts` | New. Table V. |
| `src/main/services/routingObserver.ts`, `routingObserver.test.ts` | New. Table O. |
| `scripts/verify-routing-phase2-live.mjs` | New. Launcher (pattern: `scripts/verify-routing-live.mjs:6–28`). |
| `scripts/verify-routing-phase2-live.ts` | New. Windowless Electron main (pattern: `scripts/verify-routing-live.ts:1–34`). |

`routingService.ts` imports `node:crypto` (`randomUUID`), `./routingClient`, `./routingStore` (type), `./openrouterKeys` (`OPENROUTER_GATEWAY_BASE_URL`), `./logger`, the routing cores and shared contracts, and **only types** from `./storage` and `./vault` (both load native or Electron modules; `vault.ts:1` imports `safeStorage`). Its test therefore runs under plain vitest with fakes and a real `RoutingStore` over a temp directory.

## Normative contracts — `src/shared/routing.ts` (appended block)

```ts
// ── Phase 2 — service contract (Task 2-3) ──

export const ROUTING_ERROR_CODES = [
  'INVALID_REQUEST', // input failed its schema
  'UNAUTHORIZED', // IPC sender is not an application window's main frame (Task 2-4)
  'UNKNOWN_MODEL', // slug not in the bundled registry
  'NO_SNAPSHOT', // tiers(): nothing stored for the model
  'BUSY', // a refresh or observer tick is already running for the model
  'CREDENTIAL_REFUSED', // a pre-decrypt refusal, or an envelope base URL that is not the gateway
  'CREDENTIAL_UNAVAILABLE', // the vault could not decrypt (it marks the row itself)
  'FETCH_FAILED', // the endpoints GET failed
  'INVALID_TIME', // computeTiers threw RangeError (clock moved backwards)
  'OPERATION_FAILED' // anything else; fixed message
] as const
export const routingErrorCodeSchema = z.enum(ROUTING_ERROR_CODES)
export type RoutingErrorCode = z.infer<typeof routingErrorCodeSchema>

/** Mirrors MODEL_ID_PATTERN (modelCatalogCore.ts:151); the service then requires a registry slug. */
export const routingModelSlugSchema = z.string().regex(/^[A-Za-z0-9._:/@~-]{1,200}$/)
/** Mirrors MODEL_EFFORT_PATTERN (modelCatalogCore.ts:192). null = no effort (reasoning not required). */
export const routingEffortSchema = z.string().regex(/^[a-z0-9_-]{1,40}$/).nullable()

export const routingTiersRequestSchema = z.strictObject({
  model: routingModelSlugSchema,
  profile: routingProfileIdSchema,
  effort: routingEffortSchema,
  credentialProfileId: credentialProfileIdSchema.nullable()
})
export type RoutingTiersRequest = z.infer<typeof routingTiersRequestSchema>

export const routingRefreshRequestSchema = z.strictObject({
  model: routingModelSlugSchema,
  credentialProfileId: credentialProfileIdSchema,
  profile: routingProfileIdSchema,
  effort: routingEffortSchema
})
export type RoutingRefreshRequest = z.infer<typeof routingRefreshRequestSchema>

export const routingModelListSchema = z.strictObject({
  models: z.array(z.strictObject({ slug: z.string().min(1), displayName: z.string().min(1) }))
})
export type RoutingModelList = z.infer<typeof routingModelListSchema>

// ── A Zod mirror of the Phase 1 TierResult interface (:289), for main-side output validation ──
const usd = z.number().min(0)
const nullableNumber = z.number().nullable()
const candidateCostSchema = z.strictObject({
  blended: z.number(), fresh: z.number(), cached: z.number(), output: z.number(),
  cacheCredit: z.boolean(), overrideApplied: z.boolean(),
  promptPerM: z.number(), completionPerM: z.number(), cacheReadPerM: z.number()
})
const providerPrefsSchema = z.strictObject({
  order: z.array(z.string().min(1)).optional(),
  allow_fallbacks: z.literal(false).optional(),
  require_parameters: z.literal(true).optional(),
  quantizations: z.array(quantizationSchema).optional(),
  data_collection: z.literal('deny').optional()
})
const tierSelectionSchema = z.strictObject({
  tier: z.enum(RANKED_TIERS), model: z.string().min(1), provider: providerPrefsSchema,
  endpoints: z.array(z.string().min(1)), limitedHistory: z.boolean(), limitedFallbacks: z.boolean(), rationale: z.string()
})
const nitroSelectionSchema = z.strictObject({
  model: z.string().min(1),
  provider: providerPrefsSchema.nullable(),
  likely: z.strictObject({ tag: z.string().min(1), providerName: z.string().min(1), tpsP50: z.number() }).nullable(),
  likelyFailsRules: z.array(z.string())
})
const candidateExplanationSchema = z.strictObject({
  tag: z.string().min(1), providerName: z.string().min(1), rows: z.number().int().min(1),
  quantization: quantizationSchema, rowQuantizations: z.array(quantizationSchema), effectiveQuantization: quantizationSchema,
  uptime1d: nullableNumber, uptime5m: nullableNumber, status: z.number().int(),
  observations: z.number().int().min(0), limitedHistory: z.boolean(),
  tpsP50: nullableNumber, latencyP50S: nullableNumber, tpsP90: nullableNumber, latencyP90S: nullableNumber, effectiveTps: nullableNumber,
  cost: candidateCostSchema.nullable(), excludedBy: z.array(z.string()), budgetFloorExcluded: z.boolean(),
  scores: z.strictObject({ budget: z.number().optional(), balanced: z.number().optional(), fast: z.number().optional() })
})
export const tierResultSchema = z.strictObject({
  model: z.string().min(1), profile: routingProfileIdSchema, computedAt: isoTime, snapshotFetchedAt: isoTime,
  snapshotAgeMinutes: z.number().int().min(0), stale: z.boolean(), accountEligibility: z.enum(['checked', 'unknown']),
  medianEligibleTps: nullableNumber, budgetFloorTps: nullableNumber,
  tiers: z.strictObject({ budget: tierSelectionSchema.nullable(), balanced: tierSelectionSchema.nullable(), fast: tierSelectionSchema.nullable() }),
  nitro: nitroSelectionSchema, candidates: z.array(candidateExplanationSchema), warnings: z.array(z.string())
})

// ── Refresh result (C18) ──
export const routingRefreshResultSchema = z.strictObject({
  refreshId: z.uuid(),
  estimateUsd: usd,
  spentUsd: usd,
  probed: z.array(routingTagSchema),
  notProbed: z.array(probeSkipSchema),
  result: tierResultSchema
})
export type RoutingRefreshResult = z.infer<typeof routingRefreshResultSchema>

// ── Progress events (K8, MR-G7). Order: endpoints, preflight, probe-plan, probe*, then exactly one of done | failed ──
const preflightOutcomeSchema = z.strictObject({
  attempted: z.boolean(),
  removed: z.array(routingTagSchema).nullable(),
  issue: preflightIssueSchema.nullable(),
  failure: routingFailureSchema.nullable()
})
const progressBase = { refreshId: z.uuid(), model: routingModelSlugSchema, at: isoTime }
export const routingProgressEventSchema = z.discriminatedUnion('stage', [
  z.strictObject({ ...progressBase, stage: z.literal('endpoints'), fetchedAt: isoTime,
    endpointRows: z.number().int().min(1), tags: z.number().int().min(1), rejectedRows: z.number().int().min(0) }),
  z.strictObject({ ...progressBase, stage: z.literal('preflight'), checkedAt: isoTime,
    guardrails: preflightOutcomeSchema, dataPolicy: preflightOutcomeSchema }),
  z.strictObject({ ...progressBase, stage: z.literal('probe-plan'),
    planned: z.array(z.strictObject({ tag: routingTagSchema, estimateUsd: usd })), estimateUsd: usd, capUsd: usd,
    fresh: z.array(routingTagSchema), notProbed: z.array(probeSkipSchema) }),
  z.strictObject({ ...progressBase, stage: z.literal('probe'), tag: routingTagSchema, outcome: cacheProbeOutcomeSchema,
    failure: routingFailureSchema.nullable(), calls: z.number().int().min(0).max(3), costUsd: usd, spentUsd: usd }),
  z.strictObject({ ...progressBase, stage: z.literal('done'), estimateUsd: usd, spentUsd: usd,
    probed: z.array(routingTagSchema), notProbed: z.array(probeSkipSchema), accountEligibility: z.enum(['checked', 'unknown']) }),
  z.strictObject({ ...progressBase, stage: z.literal('failed'), code: routingErrorCodeSchema,
    failure: routingFailureSchema.nullable(), message: z.string().min(1).max(500), spentUsd: usd })
])
export type RoutingProgressEvent = z.infer<typeof routingProgressEventSchema>

// ── Status (C20) ──
export const ROUTING_OBSERVER_OUTCOMES = ['observed', 'dormant', 'skipped-fresh', 'busy', 'refused', 'decrypt-failed', 'fetch-failed', 'failed'] as const
export const routingObserverOutcomeSchema = z.enum(ROUTING_OBSERVER_OUTCOMES)
export type RoutingObserverOutcome = z.infer<typeof routingObserverOutcomeSchema>
export const routingStatusSchema = z.strictObject({
  observer: z.strictObject({
    state: z.enum(['stopped', 'dormant', 'scheduled', 'running']),
    dormantReason: z.enum(['disabled', 'undesignated']).nullable(),
    nextTickAt: isoTime.nullable(),
    lastTickAt: isoTime.nullable(),
    lastOutcome: routingObserverOutcomeSchema.nullable(),
    lastFailure: routingFailureSchema.nullable()
  }),
  models: z.array(z.strictObject({
    model: z.string().min(1), displayName: z.string().min(1), snapshotFetchedAt: isoTime.nullable(),
    observations: z.number().int().min(0), cacheVerified: z.number().int().min(0), busy: z.boolean()
  })),
  requestsSinceStart: z.number().int().min(0)
})
export type RoutingStatus = z.infer<typeof routingStatusSchema>
```

`tierResultSchema` adds validation only; it does not replace the `TierResult` interface, and `computeTiers` is unchanged. A compile-time test (S4-3) keeps the two mutually assignable.

## `routingService.ts`

```ts
export class RoutingError extends Error {
  constructor(readonly code: RoutingErrorCode, message: string) // name = 'RoutingError'
}

export type RoutingStorageLike = Pick<StorageService,
  'getCredentialProfileById' | 'getProviderConfigById' |
  'readRoutingSettings' | 'writeRoutingSettings' | 'readRoutingObservation' | 'writeRoutingObservation'>
export type RoutingStoreLike = Pick<RoutingStore,
  'readSnapshot' | 'writeSnapshot' | 'readObservations' | 'appendObservations' |
  'readCache' | 'mergeCache' | 'readAccount' | 'writeAccount'>
export interface RoutingLog { info(message: string): void; warn(message: string): void; error(message: string, err: unknown): void }

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

export class RoutingService {
  constructor(deps: RoutingServiceDeps)
  models(): RoutingModelList
  tiers(request: RoutingTiersRequest): TierResult
  refresh(request: RoutingRefreshRequest): Promise<RoutingRefreshResult>
  observe(options: { freshMs: number }): Promise<RoutingObserverTick> // never rejects
  status(): RoutingServiceStatus
  getSettings(): RoutingSettings
  setSettings(settings: RoutingSettings): RoutingSettings // returns what was stored
  getObservation(): RoutingObservationSettings
  setObservation(value: RoutingObservationSettings): RoutingObservationSettings // returns what was stored
  onProgress(listener: (event: RoutingProgressEvent) => void): () => void
  dispose(): void
}
```

**Common rules.**

- Every public method parses its input with the shared schema; a `ZodError` becomes `RoutingError('INVALID_REQUEST', 'Invalid routing request.')`.
- After `dispose()`, `refresh`, `tiers`, `setSettings` and `setObservation` throw `RoutingError('OPERATION_FAILED', 'Routing has stopped.')`; `observe` returns outcome `failed`.
- A registry check uses `findModel(bundledModelRegistry(), model)`; `null` → `RoutingError('UNKNOWN_MODEL', 'Model routing does not know this model.')`.
- `computeTiers` receives settings from `storage.readRoutingSettings()` re-parsed with `routingSettingsSchema`, a profile parsed with `routingProfileIdSchema`, and `now()`. Its `RangeError` becomes `RoutingError('INVALID_TIME', 'The stored snapshot is newer than the current time; refresh again.')` (Phase 1 carry-over).
- Any other unexpected error is logged with `log.error('<method> failed', err)` and rethrown as `RoutingError('OPERATION_FAILED', 'Routing operation failed.')`. Every message that leaves the service passes through `scrubSecrets`.
- **Single flight (K7).** A `Set<string>` of busy models, shared by `refresh` and `observe`. A refresh for a busy model throws `RoutingError('BUSY', 'A routing refresh or observation is already running for this model.')`. The slot is released in `finally`.
- **Request counter (C20).** Every call into `routingClient` goes through one wrapper of `fetchImpl` that increments `requestsSinceStart` before delegating.
- **Dispose signal.** One `AbortController` owned by the service; its `signal` is passed to every client call. `dispose()` aborts it and is idempotent.
- **Progress listeners.** `onProgress` adds to a `Set` and returns an unsubscribe. Emission calls each listener synchronously inside `try`/`catch`; a throwing listener is logged with `log.warn('progress listener failed')` and ignored. Events are plain objects in the contract's key order. The service does not Zod-parse its own events; the IPC broadcast does (Task 2-4), and the tests assert every event parses.

**Credential resolution (MR-D18, C10).** Used by `refresh` and `observe`; it is the only code that calls `vault.decryptForLaunch`.

1. `profile = storage.getCredentialProfileById(id)`; `provider = profile ? storage.getProviderConfigById(profile.providerId) : null`.
2. `checkRoutingCredential(profile, provider, OPENROUTER_GATEWAY_BASE_URL)`; a refusal throws `CREDENTIAL_REFUSED` with its message. **No decrypt has happened.**
3. `dec = await vault.decryptForLaunch(id)`, exactly once. `!dec.ok` → `CREDENTIAL_UNAVAILABLE` with `dec.message` (the vault has already marked the row unavailable and logged; `vault.ts:256`).
4. `checkEnvelopeBaseUrl(dec.value.baseUrl, profile.label, OPENROUTER_GATEWAY_BASE_URL)`; a refusal throws `CREDENTIAL_REFUSED`, and the key is never used.
5. The key is a `const` local to the calling method. It is never assigned to `this`, a module variable, a closure that outlives the call, an event, a store file, a log call or an error. `extraHeaders` from the envelope are ignored (C9).

**`refresh(request)` (K8, C15–C18).**

1. Parse the request; registry check; dispose check; acquire the model's slot (or `BUSY`).
2. `settings` = validated routing settings.
3. Resolve the credential (above). Steps 1–3 emit **no** progress event (C17).
4. `refreshId = randomId()`, `spent = 0`. From here every exit emits exactly one terminal event (`done` or `failed`).
5. **Endpoints.** `fetchRoutingEndpoints({ key, model, fetchImpl, signal })`. A failure emits `failed { code: 'FETCH_FAILED', failure, message: ROUTING_FAILURE_MESSAGES[failure], spentUsd: 0 }` and throws `RoutingError('FETCH_FAILED', same message)`; nothing is stored. On success: `fetchedAt = now()`, `snapshot = { fetchedAt, endpoints }`, `store.writeSnapshot(model, snapshot)`, `store.appendObservations(model, extractObservations(snapshot), fetchedAt, settings.observationMaxAgeDays)`, then emit `endpoints { fetchedAt, endpointRows, tags, rejectedRows }`.
6. **Preflights.** `rows = rowsPerTag(endpoints)`. Send `guardrails`, then, unless the first failed with `auth-failed` or `rate-limited`, `dataPolicy` (C16). Each outcome is `{ attempted, removed, issue, failure }`: a sent call that returned `ok` gives `{ true, removed, issue, null }`; a transport failure gives `{ true, null, null, failure }`; an unsent call gives `{ false, null, null, null }`. `checkedAt = now()`. `account = { guardrailRemoved, dataPolicyRemoved, checkedAt }` with `null` for every list that did not parse; `store.writeAccount(model, credentialProfileId, account)` replaces the previous record (C15). Emit `preflight`. `abort` is set when either preflight failed with `auth-failed` or `rate-limited`.
7. **First ranking.** `first = computeTiers({ model: entry, snapshot, history: store.readObservations(model), account, cache: store.readCache(model), profile, effort, settings, now: now() })`.
8. **Plan.** `plan = planCacheProbe({ result: first, cache: store.readCache(model), now: now(), capUsd: probeCapUsd, tagLimit: probeTagLimit })`. If `abort`, every planned tag moves to `notProbed` with reason `aborted` and `planned` becomes empty. Emit `probe-plan { planned, estimateUsd, capUsd, fresh, notProbed }` (with `estimateUsd` = the sum of what remains planned). **No probe request is sent before this event is emitted** (MR-G7).
9. **Probe** (only when `planned` is non-empty). `runNonce = randomId()`. A pool runs at most `probeConcurrency` tags at once, starting them in plan order. Before starting a tag: if `abort` or disposed, it and every unstarted tag are skipped with `aborted`; else if `spent >= probeCapUsd`, it and every unstarted tag are skipped with `cap`. Per tag, up to three calls with `sendRoutingProbeCall({ key, model, tag, runNonce, fetchImpl, signal })`, awaiting `sleep(CACHE_PROBE_GAP_MS)` before calls 2 and 3. After each call, add `probeCallSpendUsd(record, tagEstimate / 3)` to `spent` (so the next start check sees it). A call failing with `auth-failed` or `rate-limited` sets `abort` and ends that tag. When the tag ends: `outcome = evaluateProbe(records)`; `verified` or `not-cached` → `store.mergeCache(model, { [tag]: { verified: outcome === 'verified', checkedAt: now() } })`; `inconclusive` writes nothing. Emit `probe { tag, outcome, failure (the first failure among its calls, else null), calls, costUsd, spentUsd: spent }`.
10. **Final ranking.** `result = computeTiers({ …, cache: store.readCache(model), now: now() })` with the same snapshot, history and account.
11. Emit `done { estimateUsd, spentUsd: spent, probed, notProbed, accountEligibility: result.accountEligibility }`, where `probed` lists tags with at least one call (in start order) and `notProbed` is the plan's skips followed by the runtime skips. Return `{ refreshId, estimateUsd, spentUsd: spent, probed, notProbed, result }`.
12. An error thrown after step 4 (a store write, an `INVALID_TIME`, anything unexpected) emits `failed { code, failure: null, message, spentUsd: spent }` and rethrows. The slot is released in `finally`.

**`tiers(request)` (K8).** Parse; registry check; `snapshot = store.readSnapshot(model)`, `null` → `RoutingError('NO_SNAPSHOT', 'No endpoint snapshot is stored for this model yet. Refresh first.')`. `account` = `{ guardrailRemoved: null, dataPolicyRemoved: null, checkedAt: null }` when `credentialProfileId` is `null` or `store.readAccount` returns `null`; otherwise the stored record. Then `computeTiers` with stored observations and cache, validated settings and `now()`. It never reads a credential row, never decrypts and never sends a request.

**`observe({ freshMs })` (K7, C19).** Never rejects; an unexpected error gives outcome `failed`, logged.

1. `at = now()`. Disposed → `{ at, outcome: 'failed', failure: null, models: [] }`.
2. `obs = storage.readRoutingObservation()`. `!obs.enabled` or `obs.credentialProfileId === null` → outcome `dormant`, `models: []`. **No credential row is read and nothing is decrypted.**
3. For each registry model (sorted by slug): `skipped-fresh` when a stored snapshot exists and `Date.parse(at) − Date.parse(snapshot.fetchedAt) < freshMs`; `busy` when its slot is taken; otherwise due. Acquire every due model's slot. No due model → overall outcome `skipped-fresh` if any model was fresh, else `busy`.
4. Resolve the credential once for all due models. A refusal → those models `refused`; a decrypt failure → `decrypt-failed`. Nothing is sent.
5. For each due model in order: `fetchRoutingEndpoints`. Success → `fetchedAt = now()`, write the snapshot, append observations with `settings.observationMaxAgeDays`, outcome `observed`. Failure → `fetch-failed` with its failure; `auth-failed` or `rate-limited` marks every remaining due model the same way without sending. No preflight, no probe, no progress events.
6. Release the slots. Overall outcome: `observed` if any model was observed; otherwise the first model outcome by precedence `refused`, `decrypt-failed`, `fetch-failed`, `busy`, `skipped-fresh`. `failure` is the first failure among the models, else `null`. Record the tick as `lastTick` and return it.

**Settings and observation.** `getSettings()` = validated `storage.readRoutingSettings()`. `setSettings(s)`: parse with `routingSettingsSchema`, `storage.writeRoutingSettings(s)`, return `getSettings()`. `getObservation()` = `storage.readRoutingObservation()`. `setObservation(v)` (MR-D19): parse; when `v.credentialProfileId !== null`, run steps 1–2 of credential resolution (no decrypt) and throw `CREDENTIAL_REFUSED` on a refusal **without writing**; otherwise `storage.writeRoutingObservation(v)` and return `getObservation()`.

**`models()`** lists the registry's `{ slug, displayName }` sorted by slug. **`status()`** returns, per registry model, `snapshotFetchedAt` (or `null`), the stored observation count, the number of cache records with `verified: true`, and whether its slot is busy; plus `lastTick` and `requestsSinceStart`.

## `routingObserver.ts`

```ts
export const OBSERVER_FIRST_TICK_MS = 120_000 // 2 minutes after start
export const OBSERVER_INTERVAL_MS = 1_800_000 // 30 minutes
export const OBSERVER_FRESH_MS = 1_500_000 // skip a model whose snapshot is younger than 25 minutes

export interface ObserverTimerHandle { unref(): unknown }
export interface ObserverTimers {
  setTimeout(fn: () => void, ms: number): ObserverTimerHandle
  clearTimeout(handle: ObserverTimerHandle): void
}
export interface RoutingObserverDeps {
  service: Pick<RoutingService, 'observe' | 'status' | 'getObservation'>
  timers?: ObserverTimers // default: the globals
  now?: () => string
  log?: RoutingLog
}
export class RoutingObserver {
  constructor(deps: RoutingObserverDeps)
  start(): void // idempotent; arms the first tick
  stop(): void // idempotent; clears the timer; an in-flight tick finishes but arms nothing
  tick(): Promise<RoutingObserverTick> // one tick now; single-flight; never rejects
  status(): RoutingStatus
}
```

**Rules (K7, C19).**

- At most one timer handle exists. Arming calls `timers.setTimeout(cb, ms)`, then `handle.unref()`, and sets `nextTickAt = new Date(Date.parse(now()) + ms).toISOString()`.
- `start()`: if started, return; mark started and arm `OBSERVER_FIRST_TICK_MS`.
- When the timer fires: clear the handle; if no longer started, return; **arm `OBSERVER_INTERVAL_MS` first** (at the tick's start, so tick duration never drifts the schedule), then `await this.tick()`.
- `tick()`: if a tick is running, return its promise; otherwise call `service.observe({ freshMs: OBSERVER_FRESH_MS })`. A rejection (which the service contract forbids) is logged and becomes `{ at: now(), outcome: 'failed', failure: null, models: [] }`.
- `stop()`: mark stopped, clear and drop the handle, set `nextTickAt = null`.
- `status()`: `state` = `stopped` when not started, else `running` while a tick runs, else `dormant` when the observation setting is disabled or undesignated, else `scheduled`. `dormantReason` = `disabled` when `!enabled`, else `undesignated` when the id is `null`, else `null`. `lastTickAt`, `lastOutcome`, `lastFailure` come from `service.status().lastTick`; `models` and `requestsSinceStart` from `service.status()`. The result satisfies `routingStatusSchema`.

The timer keeps running while dormant; a dormant tick reads only the observation setting (C19). Designation therefore takes effect at the next tick, within 30 minutes; Phase 3 may add a "observe now" action through `tick()` if wanted.

## Live check — `scripts/verify-routing-phase2-live.mjs` and `.ts`

Spends real OpenRouter credit: at most 3 cents (user decision). Run it once, from the repository root, after Tasks 2-1 to 2-3 pass their tests.

**Launcher (`.mjs`)**, following `verify-routing-live.mjs:6–28`:

1. Header comment: what it spends, that it reads the installed database read-only and copies only the OpenRouter API credential plus `Local State` into a throwaway profile, and that the key is never printed or written.
2. Source profile: `--profile <dir>` or `%APPDATA%\chorus-app`; refuse to run without `chorus.db` there.
3. `evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'chorus-routing-phase2-'))`; create `evidence/profile`; copy `Local State` into it when present.
4. Bundle `scripts/verify-routing-phase2-live.ts` with esbuild into `_verify/routing-phase2-live-<pid>.cjs` (`bundle: true, platform: 'node', format: 'cjs', packages: 'external'`).
5. Spawn `require('electron')` with `[bundle, --user-data-dir=<evidence>/profile]`, `cwd` = repository root, env with `CHORUS_ROUTING_EVIDENCE` and `CHORUS_ROUTING_SOURCE_DB` and without `ELECTRON_RUN_AS_NODE`, `windowsHide: true`, stdout and stderr **piped and echoed live** (so the estimate line appears before probing) and also written to `evidence/probe.log`.
6. In `finally`: delete the bundle; delete the decryptable copy (`evidence/profile` and `evidence/routing-live.db*`; it holds a credential blob and the OSCrypt key). Keep `report.json`, `probe.log` and `evidence/routing/` (public endpoint metadata only).
7. Print `{ evidence, passed, estimateUsd, spentUsd, checks }` from `report.json`; `process.exitCode = report.passed ? 0 : 1`.

**Electron main (`.ts`)**, following `verify-routing-live.ts:1–34`:

1. `app.setPath('userData', <evidence>/profile)`; on `whenReady`: `storage = new StorageService(<evidence>/routing-live.db)`; `credentialProfileId = copyFixtureCredential(<source db>, storage)` (`team-fixture-credential.ts:9`); `vault = new CredentialVault(storage)`.
2. A counting vault (`decryptForLaunch` wrapper that counts calls) and a recording `fetchImpl` that records `{ seq, method, path, order, dataCollection, maxTokens }` per request from the URL and the parsed body, then delegates to the global `fetch`. It never records headers or message contents. One `seq` counter is shared with the progress listener.
3. `service = new RoutingService({ storage, vault: counting, store: new RoutingStore(<evidence>/routing), fetchImpl: recording, probeTagLimit: 2, probeCapUsd: 0.025 })` (C21). The progress listener records `{ seq, …event }`, prints `probe estimate: $<4 dp> for <n> tag(s), cap $0.025` on `probe-plan` and `actual spend: $<6 dp>` on `done`.
4. `service.setObservation({ enabled: true, credentialProfileId })` (the throwaway database only).
5. **Tick first:** the store is empty, so the model is due; a tick after the refresh would be skipped as fresh. `tick = await new RoutingObserver({ service }).tick()`.
6. **Refresh:** `res = await service.refresh({ model: 'deepseek/deepseek-v4.1-flash', credentialProfileId, profile: 'interactive', effort: 'low' })`.
7. **Offline tiers:** `again = service.tiers({ model, profile: 'interactive', effort: 'low', credentialProfileId })`.
8. Run the checks below; write `report.json` (it never contains the key or the credential id); `app.exit(0)` in `finally`.

**Checks** (each recorded as `{ name, ok }`; `passed` = all ok):

| # | Check |
|---|---|
| L1 | `tick.outcome === 'observed'`; exactly one request so far, `GET /api/v1/models/deepseek/deepseek-v4.1-flash/endpoints`; one decrypt. |
| L2 | After the refresh, two decrypts in total (one per tick, one per refresh). |
| L3 | Refresh requests in order: one GET; one POST with `order ['chorus-preflight-none']`, `max_tokens` 1, no `dataCollection`; one POST the same with `dataCollection: 'deny'`; then at most 6 POSTs with `max_tokens` 64, each `order` a single tag, at most 2 distinct tags. |
| L4 | Events in order `endpoints`, `preflight`, `probe-plan`, `probe` × k (k ≤ 2), `done`; every event passes `routingProgressEventSchema`. |
| L5 | The `probe-plan` event's `seq` is lower than the first probe request's `seq`, and its `estimateUsd ≤ 0.025` (MR-G7). |
| L6 | `res.spentUsd ≤ 0.03`, and equals the `done` event's `spentUsd`. |
| L7 | Both preflight outcomes have `removed !== null`: today's live message still parses. (On this account both were `['deepseek']` on 2026-10-02; print them, do not assert the values.) |
| L8 | `routingRefreshResultSchema.safeParse(res).success`; `res.result.accountEligibility === 'checked'`; `JSON.parse(JSON.stringify(res))` deep-equals `res`; at least one ranked tier is non-null. |
| L9 | `again` has the same tier endpoint orders as `res.result` and makes no request (the request count did not change). |
| L10 | Every file under `<evidence>/routing` and the report text pass `scrubSecrets(text) === text`. |

## Test cases

Tests import `{ describe, it, expect, vi }` from `vitest`, use a temp directory per test with a real `RoutingStore`, and never touch the network. Every key-shaped string is assembled by concatenation (`FAKE_KEY = 'sk-or-v1-' + '0123…'`, as `modelCatalog.test.ts:25`).

**Harness.** `storage` is an in-memory fake implementing `RoutingStorageLike` with spies: one OpenRouter API provider (`authMode: 'api_key'`, `baseUrl: 'https://openrouter.ai/api/v1'`), one profile `{ label: 'OR key', unavailableSince: null }` with id `C = '5f0c1a2e-8a3b-4c5d-9e6f-0123456789ab'`, default settings, and observation settings it stores as given. `vault` counts calls and returns `{ ok: true, value: { key: FAKE_KEY } }`. The stub `fetchImpl` answers by URL and body: the endpoints GET with the golden fixture text (200); a preflight POST with the guardrails fixture body (404) or, when `provider.data_collection` is `'deny'`, the data-policy fixture's `withDeny` body; a probe POST with 200 and usage `prompt_tokens` 4460, `cached_tokens` `[0, 4352, 4352]` by call index (`[0, 0, 0]` for `baidu/fp8`), `cost` 0.0005. It honours `init.signal` and records a global sequence number shared with a progress listener. `now` returns `'2026-10-02T09:20:00Z'` unless a test changes it; `sleep` resolves at once; `randomId` returns `11111111-1111-4111-8111-111111111111`, then `22222222-2222-4222-8222-222222222222`. Money compares to 1e-12.

**Table V — `routingService.test.ts`.**

| # | Case | Expect |
|---|---|---|
| V1 | `refresh({ model: slug, credentialProfileId: C, profile: 'interactive', effort: 'low' })` | 45 requests (1 GET, 2 preflights, 42 probe calls); 1 decrypt. Final tiers equal the Phase 1 golden interactive orders: Budget deepinfra/fp8, streamlake/fp8, gmicloud/fp8; Balanced deepinfra/fp8, streamlake/fp8, makora/fp8; Fast venice/fp8, baidu/fp8, parasail/fp8; Nitro likely `together`. `accountEligibility` `checked`; `snapshotAgeMinutes` 0; warnings exactly the golden limited-history warning. `estimateUsd` 0.0493873956, `spentUsd` 0.021, 14 probed, `notProbed: []`, `refreshId` the first id. |
| V2 | V1's events | `endpoints` (`endpointRows` 33, `tags` 32, `rejectedRows` 0), `preflight` (both `{ attempted: true, removed: ['deepseek'], issue: null, failure: null }`), `probe-plan` (Q1's 14 tags in order, `capUsd` 0.05, `fresh: []`), 14 `probe` (13 `verified`, `baidu/fp8` `not-cached`, each `calls` 3, `costUsd` 0.0015), `done` (`spentUsd` 0.021, `accountEligibility` `checked`). Every event passes `routingProgressEventSchema`. The `probe-plan` event's sequence number is below every probe request's. |
| V3 | V1's store afterwards | Snapshot `fetchedAt` 09:20:00Z with 33 rows; 32 observations; 14 cache records at 09:20:00Z (13 `true`, `baidu/fp8` `false`); `account-<C>.json` = `{ guardrailRemoved: ['deepseek'], dataPolicyRemoved: ['deepseek'], checkedAt: '2026-10-02T09:20:00Z' }`. |
| V4 | `probeTagLimit: 2` | 9 requests; probed atlas-cloud/fp8, morph/fp8; 12 `limit`; `estimateUsd` 0.002497428. |
| V5 | `probeCapUsd: 0.02` | 7 tags planned (24 requests); 7 `cap`; `estimateUsd` 0.017288676. |
| V6 | `probeConcurrency: 1`, probe cost 0.01 per call | Two tags run (0.03 each; the second starts at 0.03 < 0.05); 12 `cap` at runtime; `spentUsd` 0.06; 9 requests. |
| V7 | `probeConcurrency: 1`, probe POSTs answer 401 | One probe request; that tag `inconclusive` with failure `auth-failed`; 13 `aborted`; `done` emitted; tiers returned. |
| V8 | First preflight answers 401 | The second preflight is not sent (`attempted: false`); account `{ null, null, checkedAt }` stored; `probe-plan` has `planned: []` and 14 `aborted`; no probe request; result `accountEligibility` `unknown` with W2 and W3. |
| V9 | First preflight answers 404 with `{}` | Guardrails outcome `{ true, null, 'unrecognized-body', null }`; the refresh continues and probes. |
| V10 | Refusals: no profile row; `unavailableSince` set; `authMode: 'management'`; `'subscription'`; `baseUrl: 'https://example.invalid/api/v1'` | `CREDENTIAL_REFUSED` each (the unavailable message names `OR key`); 0 decrypts, 0 requests, 0 events; a following valid refresh succeeds (slot released). |
| V11 | Envelope `baseUrl: 'https://proxy.invalid/v1'` | `CREDENTIAL_REFUSED`; 1 decrypt; 0 requests; 0 events. |
| V12 | Vault returns `{ ok: false, kind: 'undecryptable', message: "Credential profile 'OR key' is unavailable: decryption failed. Re-enter the credential in Settings." }` | `CREDENTIAL_UNAVAILABLE` with that message; 0 requests. |
| V13 | Endpoints GET answers 503 | `FETCH_FAILED`, message `OpenRouter returned an error.`; events exactly `[failed { code: 'FETCH_FAILED', failure: 'provider-error', spentUsd: 0 }]`; 1 request; no snapshot, observation or account file. |
| V14 | The GET held pending; a second refresh for the same model; an `observe` | Second refresh `BUSY` at once (still 1 request, 1 decrypt); `observe` reports that model `busy` with no decrypt; after release a third refresh runs. |
| V15 | `model: 'other/model'`; an extra request key; `credentialProfileId: 'x'`; `effort: 'LOW'` | `UNKNOWN_MODEL` (no credential read); `INVALID_REQUEST` × 3. |
| V16 | `tiers` on an empty store; then after V1 with `C`, with `null`, with an unknown UUID | `NO_SNAPSHOT`; V1's tier orders with `checked`; `unknown` with W2 and W3; `unknown`. No request, no decrypt, `getCredentialProfileById` never called. |
| V17 | Settings `{ ...DEFAULT_ROUTING_SETTINGS, dataCollection: 'allow' }` | No `data_collection` key anywhere in the result; `nitro.provider` `null`. |
| V18 | Snapshot stored at 09:20:00Z; `now` 09:00:00Z; `tiers` | `INVALID_TIME`. |
| V19 | Across V1–V18 | `FAKE_KEY` never appears in any event, result, thrown error, log call argument, store file or `status()`; it appears only as `Bearer <key>` in recorded `authorization` headers, and in no recorded URL. |
| V20 | Two refreshes | 2 decrypts (no memo). No enumerable property reachable from the service instance (depth 3) holds a string containing `FAKE_KEY`. |
| V21 | `observe` with `{ enabled: false, credentialProfileId: C }`; with `{ enabled: true, credentialProfileId: null }` | `dormant` both; `getCredentialProfileById` not called; 0 decrypts; 0 requests. |
| V22 | `observe` designated, empty store | `observed`; 1 decrypt; exactly 1 request (the GET); snapshot and 32 observations stored; no POST; no progress events. |
| V23 | Again at the same `now`; at `fetchedAt` + 24 min 59 s; at + 25 min | `skipped-fresh` (no decrypt); `skipped-fresh`; `observed`. |
| V24 | Designated credential with `authMode: 'management'`; GET 429; vault failure; `writeSnapshot` throwing | `refused` (0 decrypts); `fetch-failed` with `rate-limited`; `decrypt-failed`; `failed` (and `observe` resolves). |
| V25 | `setObservation({ enabled: true, credentialProfileId: null })`; with `C`; with a non-OpenRouter credential; with an unknown UUID | Stored; stored, 0 decrypts; `CREDENTIAL_REFUSED` and `writeRoutingObservation` not called; `CREDENTIAL_REFUSED`. |
| V26 | `status()` after V1 | `models[0]` = `{ model: slug, displayName: 'DeepSeek V4.1 Flash', snapshotFetchedAt: '2026-10-02T09:20:00Z', observations: 32, cacheVerified: 13, busy: false }`; `requestsSinceStart` 45. |
| V27 | `dispose()` while the GET is pending; then `refresh`, `observe`, `dispose()` again | The pending refresh ends with `FETCH_FAILED` (`unreachable`); then `OPERATION_FAILED` (`Routing has stopped.`); `failed` without a decrypt; no error. |
| V28 | V1's result, and `computeTiers` of the golden input for both profiles | Each passes `tierResultSchema`, and `tierResultSchema.parse(x)` strictly equals `x`. |
| V29 | A progress listener that throws | The refresh completes; `log.warn('progress listener failed')`; unsubscribe stops delivery. |

**Table O — `routingObserver.test.ts`.** `timers` is a fake recording `setTimeout(fn, ms)` calls (each handle has an `unref` spy) and `clearTimeout(handle)` calls; tests fire callbacks by hand. `service` is a fake with `observe`, `status` and `getObservation` spies.

| # | Case | Expect |
|---|---|---|
| O1 | `start()` | One `setTimeout` with 120,000 ms; its `unref` called; `observe` not called. |
| O2 | Fire it | A new `setTimeout(…, 1_800_000)` is armed **before** `observe` resolves; `observe` called once with `{ freshMs: 1_500_000 }`. |
| O3 | `start()` twice; `stop()` twice; fire a stale callback after `stop()` | One timer; `clearTimeout` once; no error; `observe` not called. |
| O4 | `observe` rejects | `tick()` resolves `{ outcome: 'failed', failure: null, models: [] }`; the next timer is still armed. |
| O5 | `status()`: before start; started with `{ enabled: true, credentialProfileId: null }`; with an id; during a pending `observe`; after a tick | `stopped` (`nextTickAt` null); `dormant`/`undesignated` with `nextTickAt` = now + 2 min; `scheduled`; `running`; `lastTickAt`/`lastOutcome` from `service.status().lastTick`. Each passes `routingStatusSchema`. |
| O6 | Two concurrent `tick()` calls | One `observe` call; both resolve to the same tick. |
| O7 | `stop()` while a scheduled tick is pending | The handle armed at that tick's start is cleared; after it resolves no timer is armed. |
| O8 | `enabled: false` | `dormantReason` `disabled`. |

**Table S4 — `src/shared/routing.test.ts`.**

| # | Case | Expect |
|---|---|---|
| S4-1 | `routingErrorCodeSchema` on each code; on `NOPE` | Pass; fail. |
| S4-2 | Request schemas: valid; extra key; `effort: 'LOW'`; `credentialProfileId: 'x'`; model with a space | Pass; fail × 4. |
| S4-3 | `const a = (x: z.infer<typeof tierResultSchema>): TierResult => x` and the reverse | Both compile (checked by `npm run typecheck`). |
| S4-4 | One valid event per stage; a `probe-plan` with an extra key; `stage: 'other'`; a `failed` with a 501-character message | Pass; fail × 3. |
| S4-5 | A status value with every observer state | Pass. |

## Invariants

- One decrypt per refresh and per non-dormant, non-refused tick; none for `tiers`, `setObservation`, `status` or a dormant tick. Every refusal that does not need the envelope happens before the decrypt.
- The key lives in one method's scope, from the decrypt to the method's end. It is never stored, logged, emitted, returned, thrown or written; it leaves only in the `Authorization` header.
- A refresh sends at most 1 GET, 2 preflights and `3 × planned` probe calls; a tick sends at most one GET per due model; nothing retries.
- The probe estimate is emitted before the first probe request; no tag starts once actual spend reaches the cap; actual spend is returned and emitted.
- `computeTiers` receives validated settings and profile, and its `RangeError` is caught. The ranker is never re-implemented.
- Progress events are plain JSON, follow the fixed order, and end with exactly one terminal event; pre-network refusals emit none.

## Verification

```powershell
npm run typecheck
npx vitest run src/main/services/routingService.test.ts src/main/services/routingObserver.test.ts src/shared/routing.test.ts
npm test
Get-ChildItem -Path src/main/routing, src/shared/routing.ts -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern 'Date\.now\(|Math\.random\(|new Date\(\)|from ''(node:|fs''|path''|electron|better-sqlite3)|require\('
Get-ChildItem -Path src/main/routing -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern "from '\.\./(services|db|adapters)/"
node scripts/verify-routing-ranker.mjs
node scripts/verify-routing-phase2-live.mjs
npm run grep:secrets
git diff --check
git status --short
```

Both `Select-String` lines must print nothing. The live script is the runtime check (MR-G1, MR-G7): run it once, paste its full output (the estimate line printed before the probe, the spend line, the summary) and exit code into the report, and confirm `_verify/` holds no `routing-phase2-live-*.cjs` and the evidence directory holds no `profile` or `routing-live.db*` afterwards. Run `npm run grep:secrets` after the script has cleaned up. If the live script fails L7 (the message no longer parses), stop and report: it means OpenRouter changed the format, and the parser, not the check, needs attention.
