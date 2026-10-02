# Implementation specification 1-1 — Contracts, registry, endpoints and pricing

Paired [task](../Tasks/Task-1-1.md). Decisions: [roadmap](../roadmap.md) MR-D5, MR-D7, MR-D9, MR-D13; [overview](../Tasks/Phase-1-Overview.md) K1, K2, K4, K8, K11 and clarifications C4–C7, C10. **Not started.**

## Files and insertion points

| File | Action |
|---|---|
| `src/shared/routing.ts` | New. The normative block below, verbatim apart from comments. Imports only `zod`. |
| `src/shared/routing.test.ts` | New. Schema tests (table S). |
| `src/main/routing/model-registry.json` | New. Content below. |
| `src/main/routing/registryCore.ts`, `registryCore.test.ts` | New. Table R. |
| `src/main/routing/endpointsCore.ts`, `endpointsCore.test.ts` | New. Table E. |
| `src/main/routing/pricingCore.ts`, `pricingCore.test.ts` | New. Tables P, D and B. |
| `src/main/routing/__fixtures__/endpoints-deepseek-v4.1-flash-2026-10-02.json` | `git mv` from `docs/Features/Model Routing/fixtures/`. Content unchanged. |
| `docs/Features/Model Routing/roadmap.md` | Change the link targets at `:134` and `:158` to `../../../src/main/routing/__fixtures__/endpoints-deepseek-v4.1-flash-2026-10-02.json`; at `:134` the visible link text becomes `src/main/routing/__fixtures__/endpoints-deepseek-v4.1-flash-2026-10-02.json`. Nothing else in the file changes. |

Tests read the fixture with `readFileSync(join(__dirname, '__fixtures__/endpoints-deepseek-v4.1-flash-2026-10-02.json'), 'utf8')`, as `codeIndexCore.test.ts:64` does. Non-test routing files never touch the file system, the clock or randomness: times are parsed with `Date.parse(iso)`, and `new Date(ms)` is used only to read UTC fields.

## Normative contracts — `src/shared/routing.ts`

```ts
import { z } from 'zod'

// ── Vocabulary ──
export const QUANTIZATIONS = ['int4', 'int8', 'fp4', 'fp6', 'fp8', 'fp16', 'bf16', 'fp32', 'unknown'] as const
export const quantizationSchema = z.enum(QUANTIZATIONS)
export type Quantization = z.infer<typeof quantizationSchema>
export const nativePrecisionSchema = quantizationSchema.exclude(['unknown'])

export const ROUTING_TIERS = ['budget', 'balanced', 'fast', 'nitro'] as const
export type RoutingTier = (typeof ROUTING_TIERS)[number]
export const RANKED_TIERS = ['budget', 'balanced', 'fast'] as const
export type RankedTier = Exclude<RoutingTier, 'nitro'>

export const ROUTING_PROFILE_IDS = ['interactive', 'helper'] as const
export const routingProfileIdSchema = z.enum(ROUTING_PROFILE_IDS)
export type RoutingProfileId = z.infer<typeof routingProfileIdSchema>

const isoTime = z.iso.datetime()
/** OpenRouter per-token USD price as a decimal string, e.g. "0.0000003". */
const priceString = z.string().regex(/^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/)

// ── Raw OpenRouter rows: non-strict (OpenRouter adds fields; unknown keys are stripped) ──
const percentilesSchema = z.object({ p50: z.number().nullish(), p90: z.number().nullish() })

export const rawPricingOverrideSchema = z.object({
  utc_start: z.number().int().min(0).max(2400).optional(),
  utc_end: z.number().int().min(0).max(2400).optional(),
  utc_days: z.array(z.string()).optional(),
  min_prompt_tokens: z.number().int().nonnegative().optional(),
  prompt: priceString.optional(),
  completion: priceString.optional(),
  input_cache_read: priceString.optional(),
  input_cache_write: priceString.optional()
})
export type RawPricingOverride = z.infer<typeof rawPricingOverrideSchema>

export const rawPricingSchema = z.object({
  prompt: priceString,
  completion: priceString,
  input_cache_read: priceString.optional(),
  input_cache_write: priceString.optional(),
  discount: z.number().optional(), // ignored in Phase 1 (0 on every fixture row)
  overrides: z.array(rawPricingOverrideSchema).optional()
})
export type RawPricing = z.infer<typeof rawPricingSchema>

export const rawEndpointSchema = z.object({
  tag: z.string().min(1),
  provider_name: z.string().min(1),
  quantization: z.string().nullish(),
  context_length: z.number().int().positive(),
  max_completion_tokens: z.number().int().positive().nullish(),
  max_prompt_tokens: z.number().int().positive().nullish(),
  pricing: rawPricingSchema,
  supported_parameters: z.array(z.string()),
  supports_tool_choice: z.record(z.string(), z.boolean()).nullish(),
  status: z.number().int(),
  uptime_last_1d: z.number().nullish(),
  uptime_last_5m: z.number().nullish(),
  uptime_last_30m: z.number().nullish(),
  supports_implicit_caching: z.boolean().nullish(),
  throughput_last_30m: percentilesSchema.nullish(), // tokens/s
  latency_last_30m: percentilesSchema.nullish() // milliseconds
})
export type RawEndpoint = z.infer<typeof rawEndpointSchema>

/** Envelope of GET /api/v1/models/{slug}/endpoints. Rows are validated one at a time. */
export const endpointsResponseSchema = z.object({
  data: z.object({ id: z.string().min(1), endpoints: z.array(z.unknown()) })
})

export interface EndpointSnapshot { fetchedAt: string; endpoints: RawEndpoint[] }

// ── Chorus records: strict ──
export const routingObservationSchema = z.strictObject({
  tag: z.string().min(1),
  observedAt: isoTime,
  uptime1d: z.number().nullable(),
  uptime5m: z.number().nullable(),
  status: z.number().int(),
  tpsP50: z.number().nullable(),
  tpsP90: z.number().nullable(),
  latencyP50Ms: z.number().nullable(),
  latencyP90Ms: z.number().nullable()
})
export type RoutingObservation = z.infer<typeof routingObservationSchema>

/** MR-D7. Applies to exactly one model and one routable tag; an expired record does not count. */
export const verificationRecordSchema = z
  .strictObject({
    model: z.string().min(1),
    tag: z.string().min(1),
    referenceTag: z.string().min(1),
    suiteVersion: z.string().min(1),
    score: z.number(),
    verifiedAt: isoTime,
    expiresAt: isoTime,
    reviewer: z.string().min(1)
  })
  .refine((r) => Date.parse(r.expiresAt) > Date.parse(r.verifiedAt), { message: 'expiresAt must be after verifiedAt' })
export type VerificationRecord = z.infer<typeof verificationRecordSchema>

export const modelRegistryEntrySchema = z
  .strictObject({
    slug: z.string().min(1),
    displayName: z.string().min(1),
    nativePrecision: nativePrecisionSchema.nullable(), // null = closed weights: precision filter skipped
    nativePrecisionSource: z.string().min(1),
    firstPartyProviders: z.array(z.string().min(1)), // provider_name values
    verified: z.array(verificationRecordSchema),
    minContext: z.number().int().positive()
  })
  .refine((e) => e.verified.every((v) => v.model === e.slug), { message: 'verification record names another model' })
export type ModelRegistryEntry = z.infer<typeof modelRegistryEntrySchema>

export const modelRegistryFileSchema = z
  .strictObject({ version: z.literal(1), models: z.record(z.string(), modelRegistryEntrySchema) })
  .refine((f) => Object.entries(f.models).every(([key, e]) => key === e.slug), { message: 'registry key differs from slug' })
export type ModelRegistry = z.infer<typeof modelRegistryFileSchema>

const pct = z.number().min(0).max(100)
const weight = z.number().min(0).max(1)
export const routingSettingsSchema = z
  .strictObject({
    minUptimePct: pct,
    readmitUptimePct: pct,
    outageGuard5mPct: pct,
    unknownQuantPolicy: z.enum(['strict', 'firstPartyAndVerified']),
    smoothingWindow: z.number().int().min(1),
    stableMinObservations: z.number().int().min(1),
    observationMaxAgeDays: z.number().positive(),
    snapshotMaxAgeMinutes: z.number().positive(),
    budgetMinTps: z.number().nonnegative(),
    budgetMedianFraction: weight,
    tierWeights: z.strictObject({ budget: weight, balanced: weight, fast: weight }),
    tieRatio: z.number().min(1),
    fallbackCount: z.number().int().min(0),
    dataCollection: z.enum(['deny', 'allow'])
  })
  .refine((s) => s.readmitUptimePct >= s.minUptimePct, { message: 'readmitUptimePct below minUptimePct' })
  .refine((s) => s.stableMinObservations <= s.smoothingWindow, { message: 'stableMinObservations exceeds smoothingWindow' })
export type RoutingSettings = z.infer<typeof routingSettingsSchema>

export const DEFAULT_ROUTING_SETTINGS: RoutingSettings = {
  minUptimePct: 99.5,
  readmitUptimePct: 99.6,
  outageGuard5mPct: 95,
  unknownQuantPolicy: 'firstPartyAndVerified',
  smoothingWindow: 6,
  stableMinObservations: 3,
  observationMaxAgeDays: 7,
  snapshotMaxAgeMinutes: 60,
  budgetMinTps: 30,
  budgetMedianFraction: 0.5,
  tierWeights: { budget: 0.3, balanced: 0.5, fast: 1.0 },
  tieRatio: 1.01,
  fallbackCount: 2,
  dataCollection: 'deny'
}

export const routingProfileSchema = z
  .strictObject({
    id: routingProfileIdSchema,
    expectedOutputTokens: z.number().int().positive(), // N in tps_eff, reasoning included
    tokenShares: z.strictObject({ fresh: z.number().min(0), cached: z.number().min(0), output: z.number().min(0) }),
    typicalPromptTokens: z.number().int().nonnegative(), // evaluates min_prompt_tokens overrides
    minMaxCompletion: z.number().int().positive(),
    source: z.string().min(1)
  })
  .refine((p) => Math.abs(p.tokenShares.fresh + p.tokenShares.cached + p.tokenShares.output - 1) <= 1e-6, {
    message: 'token shares must sum to 1'
  })
export type RoutingProfile = z.infer<typeof routingProfileSchema>
export type TokenShares = RoutingProfile['tokenShares']

export const ROUTING_PROFILES: Record<RoutingProfileId, RoutingProfile> = {
  interactive: {
    id: 'interactive',
    expectedOutputTokens: 300,
    tokenShares: { fresh: 0.057, cached: 0.932, output: 0.011 },
    typicalPromptTokens: 113651,
    minMaxCompletion: 65536,
    source: 'Local OpenCode history, interactive DeepSeek V4.1 Flash turns 2026-08-07 to 2026-10-02 (285 turns for N); measured 2026-10-02 (MR-D6, MR-D9).'
  },
  helper: {
    id: 'helper',
    expectedOutputTokens: 460,
    tokenShares: { fresh: 0.038, cached: 0.957, output: 0.005 },
    typicalPromptTokens: 178058,
    minMaxCompletion: 64000,
    source: 'Local OpenCode history, Team helper worktree DeepSeek V4.1 Flash turns 2026-08-07 to 2026-10-02 (881 turns for N); measured 2026-10-02 (MR-D6, MR-D9).'
  }
}

export const accountEligibilitySchema = z.strictObject({
  guardrailRemoved: z.array(z.string().min(1)).nullable(), // null = preflight not parsed: unknown, never "allowed"
  dataPolicyRemoved: z.array(z.string().min(1)).nullable(),
  checkedAt: isoTime.nullable()
})
export type AccountEligibility = z.infer<typeof accountEligibilitySchema>

export const cacheVerificationSchema = z.record(z.string().min(1), z.strictObject({ verified: z.boolean(), checkedAt: isoTime }))
export type CacheVerification = z.infer<typeof cacheVerificationSchema>

export interface RankInput {
  model: ModelRegistryEntry
  snapshot: EndpointSnapshot
  history: RoutingObservation[]
  account: AccountEligibility
  cache: CacheVerification
  profile: RoutingProfileId
  effort: string | null
  settings: RoutingSettings
  now: string // ISO; the only source of time
}

// ── Results: plain JSON (K2) ──
export interface OpenRouterProviderPrefs {
  order?: string[]
  allow_fallbacks?: false
  require_parameters?: true
  quantizations?: Quantization[]
  data_collection?: 'deny'
}

export interface TierSelection {
  tier: RankedTier
  model: string // slug, no suffix
  provider: OpenRouterProviderPrefs
  endpoints: string[] // the order tags
  limitedHistory: boolean
  limitedFallbacks: boolean
  rationale: string
}

export interface NitroSelection {
  model: string // slug + ':nitro'
  provider: OpenRouterProviderPrefs | null
  likely: { tag: string; providerName: string; tpsP50: number } | null
  likelyFailsRules: string[]
}

export interface CandidateCost {
  blended: number // $/M at the profile's token mix
  fresh: number // fresh share × prompt price
  cached: number // cached share × (cache price when credited, else prompt price)
  output: number // output share × completion price
  cacheCredit: boolean
  overrideApplied: boolean
  promptPerM: number
  completionPerM: number
  cacheReadPerM: number // cache price used when credited (prompt price when a row lists none)
}

export interface CandidateExplanation {
  tag: string
  providerName: string
  rows: number
  quantization: Quantization // declared; 'unknown' when rows disagree
  rowQuantizations: Quantization[] // distinct declared row values, QUANTIZATIONS order
  effectiveQuantization: Quantization // native for an admitted undeclared candidate
  uptime1d: number | null
  uptime5m: number | null
  status: number
  observations: number // speed observations used for smoothing
  limitedHistory: boolean
  tpsP50: number | null
  latencyP50S: number | null
  tpsP90: number | null
  latencyP90S: number | null
  effectiveTps: number | null
  cost: CandidateCost | null // null = no usable price
  excludedBy: string[] // empty = eligible
  budgetFloorExcluded: boolean
  scores: Partial<Record<RankedTier, number>>
}

export interface TierResult {
  model: string
  profile: RoutingProfileId
  computedAt: string // = input.now
  snapshotFetchedAt: string
  snapshotAgeMinutes: number
  stale: boolean
  accountEligibility: 'checked' | 'unknown'
  medianEligibleTps: number | null
  budgetFloorTps: number | null
  tiers: Record<RankedTier, TierSelection | null>
  nitro: NitroSelection
  candidates: CandidateExplanation[] // sorted by tag
  warnings: string[]
}
```

`DEFAULT_ROUTING_SETTINGS` and `ROUTING_PROFILES` live in shared so Phase 3 can show defaults without importing main. Routing code never mutates them; tests derive variants with spreads.

## `src/main/routing/model-registry.json`

```json
{
  "version": 1,
  "models": {
    "deepseek/deepseek-v4.1-flash": {
      "slug": "deepseek/deepseek-v4.1-flash",
      "displayName": "DeepSeek V4.1 Flash",
      "nativePrecision": "fp8",
      "nativePrecisionSource": "HF model card tagged fp8; dominant tensor type F8_E4M3 (also BF16/F32/I8 present). Verified 2026-10-01.",
      "firstPartyProviders": ["DeepSeek"],
      "verified": [],
      "minContext": 262144
    }
  }
}
```

## `registryCore.ts`

```ts
import registryJson from './model-registry.json'
export function parseModelRegistry(json: unknown): ModelRegistry // throws Error('Invalid model registry: <path>: <message>') on the first issue
export function bundledModelRegistry(): ModelRegistry // parseModelRegistry(registryJson)
export function findModel(registry: ModelRegistry, slug: string): ModelRegistryEntry | null
export function isVerificationActive(record: VerificationRecord, now: string): boolean // verifiedAt <= now < expiresAt
export function activeVerification(entry: ModelRegistryEntry, tag: string, now: string): VerificationRecord | null
```

`activeVerification` matches `record.model === entry.slug` and `record.tag === tag` exactly (never a provider name or a tag prefix), keeps active records, and returns the one with the latest `verifiedAt` (ties: registry order), or `null`.

## `endpointsCore.ts`

```ts
export interface EndpointsParseResult {
  modelId: string
  endpoints: RawEndpoint[] // valid rows, input order
  rejected: { index: number; tag: string | null; issue: string }[]
}
export function parseEndpointsResponse(json: unknown): EndpointsParseResult // throws Error when the envelope is invalid
export function normalizeQuantization(raw: string | null | undefined): Quantization
export interface CollapsedEndpoint {
  tag: string
  providerName: string
  rows: number
  quantization: Quantization
  rowQuantizations: Quantization[]
  mixedQuantization: boolean
  uptime1d: number | null
  uptime5m: number | null
  status: number
  contextLength: number
  maxCompletion: number | null
  supportedParameters: string[]
  pricing: RawPricing[]
  tpsP50: number | null
  tpsP90: number | null
  latencyP50Ms: number | null
  latencyP90Ms: number | null
}
export function collapseEndpoints(endpoints: RawEndpoint[]): CollapsedEndpoint[] // sorted by tag
export function extractObservations(snapshot: EndpointSnapshot): RoutingObservation[] // one per tag, sorted by tag
```

**Parsing.** The envelope must match `endpointsResponseSchema`; each `data.endpoints[i]` is `safeParse`d with `rawEndpointSchema`. A failing row goes to `rejected` with its index, its `tag` if it is a string, and the first issue as `<path>: <message>`. Valid rows are kept.

**Quantization.** Lower-case the raw value; a member of `QUANTIZATIONS` maps to itself; anything else, `null` or absent maps to `'unknown'` (C6).

**Collapse (K8, C7).** Group by `tag`. For each group:

| Field | Rule |
|---|---|
| `providerName` | Smallest `provider_name` by code-unit compare (rows sharing a tag normally agree). |
| `rows` | Group size. |
| `rowQuantizations` | Distinct normalised values, in `QUANTIZATIONS` order. |
| `quantization`, `mixedQuantization` | One distinct value → that value, `false`. More → `'unknown'`, `true`. |
| `uptime1d`, `uptime5m` | Any row null/absent → `null`; else minimum. |
| `status` | All 0 → 0; else the smallest non-zero value. |
| `contextLength` | Minimum. |
| `maxCompletion` | Minimum of non-null values; `null` when every row is null. |
| `supportedParameters` | Intersection, sorted ascending. |
| `pricing` | Every row's `pricing`, sorted by `JSON.stringify` (prices are maximised later by `collapsePricing`). |
| `tpsP50`, `tpsP90` | Any row null/absent → `null`; else minimum of that percentile. |
| `latencyP50Ms`, `latencyP90Ms` | Any row null/absent → `null`; else maximum. |

**Observations.** `extractObservations` collapses `snapshot.endpoints` and maps each group to `{ tag, observedAt: snapshot.fetchedAt, uptime1d, uptime5m, status, tpsP50, tpsP90, latencyP50Ms, latencyP90Ms }`. Output order and values do not depend on row order.

## `pricingCore.ts`

```ts
export interface ResolvedPricing {
  promptPerM: number
  completionPerM: number
  cacheReadPerM: number | null
  cacheWritePerM: number | null
  overrideApplied: boolean
}
export interface CollapsedPricing { promptPerM: number; completionPerM: number; cachePricePerM: number; overrideApplied: boolean }
export function perTokenToPerMillion(price: string): number // Number(price) * 1_000_000
export function overrideApplies(override: RawPricingOverride, now: string, promptTokens: number): boolean
export function resolvePricing(pricing: RawPricing, now: string, promptTokens: number): ResolvedPricing
export function collapsePricing(rows: ResolvedPricing[]): CollapsedPricing
export function blendedCost(prices: CollapsedPricing, shares: TokenShares, cacheVerified: boolean): CandidateCost | null
```

**`overrideApplies` (K11, MR-D13, C4).** Let `d = new Date(Date.parse(now))`, `day` = the lower-case English UTC weekday of `d`, and `t = d.getUTCHours() * 100 + d.getUTCMinutes()` (seconds ignored).

1. If `min_prompt_tokens` is present and `promptTokens > min_prompt_tokens` is false → `false`.
2. If `utc_days` is present and no entry equals `day` case-insensitively → `false`. An empty array never matches.
3. If both `utc_start` and `utc_end` are absent → `true` (whole day, or whole listed days).
4. `start = utc_start ?? 0`, `end = utc_end ?? 0`. If `end > start` → `start <= t && t < end`; otherwise (wraps midnight, including `end = 0` and `start = end`) → `t >= start || t < end`.

**`resolvePricing`.** Start from the base `prompt`, `completion`, `input_cache_read`, `input_cache_write` strings. Walk `overrides` in array order; for each that applies, set `overrideApplied` and copy every price key it carries (later entries win per key; absent keys keep the earlier value, ultimately the base). Convert each final string with `perTokenToPerMillion`; an absent cache key is `null`. This is the only place per-token strings become $/M.

**`collapsePricing`.** Over the rows: `promptPerM` and `completionPerM` are maxima; `cachePricePerM` is the maximum of `cacheReadPerM ?? promptPerM`; `overrideApplied` is true if any row's is.

**`blendedCost` (K11, MR-D9, C5).** `cachedPrice = cacheVerified ? cachePricePerM : promptPerM`. `fresh = shares.fresh × promptPerM`, `cached = shares.cached × cachedPrice`, `output = shares.output × completionPerM`, `blended = fresh + cached + output`, `cacheCredit = cacheVerified`, `cacheReadPerM = cachePricePerM`. Return `null` when any of `promptPerM`, `completionPerM`, `cachePricePerM` is negative or not finite, or `blended <= 0`. The caller passes `cacheVerified = input.cache[tag]?.verified === true`.

## Test cases

**Table S — `routing.test.ts`.**

| # | Case | Expect |
|---|---|---|
| S1 | Every fixture row through `rawEndpointSchema` | All succeed; `native_tools` and other unlisted keys are stripped. |
| S2 | Row without `tag`; row with `pricing.prompt: 'abc'` | Both fail. |
| S3 | `DEFAULT_ROUTING_SETTINGS`, both `ROUTING_PROFILES` | Parse with their schemas. |
| S4 | Settings with an extra key; `readmitUptimePct` 99.4; profile shares 0.5/0.5/0.1 | Each fails. |
| S5 | Observation with `observedAt: '2026-10-02 09:05'` or an extra key | Fails. |
| S6 | Verification record with `expiresAt` equal to `verifiedAt` | Fails. |
| S7 | `RANKED_TIERS` | Equals `['budget', 'balanced', 'fast']`. |

**Table R — `registryCore.test.ts`.**

| # | Case | Expect |
|---|---|---|
| R1 | `bundledModelRegistry()` | Parses; one model, `deepseek/deepseek-v4.1-flash`, native `fp8`, `firstPartyProviders: ['DeepSeek']`, `verified: []`, `minContext` 262144. |
| R2 | Key `a/b` holding an entry with `slug: 'c/d'`; `version: 2`; `nativePrecision: 'unknown'` | Each throws `Invalid model registry`. |
| R3 | `nativePrecision: null` | Accepted. |
| R4 | `findModel` with an unknown slug | `null`. |
| R5 | Record `verifiedAt 2026-10-01T00:00:00Z`, `expiresAt 2026-11-01T00:00:00Z` | Active at both 2026-10-01T00:00:00Z and 2026-10-31T23:59:59Z; inactive at 2026-11-01T00:00:00Z and 2026-09-30T23:59:59Z. |
| R6 | Record for tag `together` | `activeVerification(entry, 'together/fp8', now)` and `(entry, 'Together', now)` are `null`. |
| R7 | Two active records for one tag | The later `verifiedAt` is returned. |

**Table E — `endpointsCore.test.ts`.**

| # | Case | Expect |
|---|---|---|
| E1 | `parseEndpointsResponse(fixture)` | `modelId` `deepseek/deepseek-v4.1-flash`, 33 endpoints, `rejected: []`. |
| E2 | Fixture with row 5's `tag` deleted | 32 endpoints; `rejected` = one entry, `index: 5`, `tag: null`. |
| E3 | `{}` and `{ data: { id: 'x' } }` | Throw. |
| E4 | `normalizeQuantization` of `'fp8'`, `'FP8'`, `'fp6e3'`, `null`, `undefined` | `fp8`, `fp8`, `unknown`, `unknown`, `unknown`. |
| E5 | `collapseEndpoints(fixture rows)` | 32 groups; `baseten/fp8`: `rows` 2, `tpsP50` 62, `tpsP90` 293, `latencyP50Ms` 305, `latencyP90Ms` 1456.5000000000027, `uptime1d` 99.92966632878922, `uptime5m` 99.2, `status` 0. |
| E6 | Two rows `x/y`, quantizations `fp8` and `fp16` | `quantization` `unknown`, `mixedQuantization` true, `rowQuantizations` `['fp8', 'fp16']`. |
| E7 | Two rows, statuses 0 and -2 | `status` -2. |
| E8 | Two rows, one `uptime_last_1d: null`; one `throughput_last_30m: null` | Collapsed `uptime1d` / `tpsP50` null. |
| E9 | Parameters `[tools, tool_choice, reasoning]` and `[tools, reasoning, max_tokens]` | `['reasoning', 'tools']`. |
| E10 | `max_completion_tokens` null and 131072; both null | 131072; `null`. |
| E11 | Fixture rows reversed and rotated | `collapseEndpoints` and `extractObservations` strictly equal to the unshuffled result. |
| E12 | `extractObservations({ fetchedAt: fixture.fetchedAt, endpoints })` | 32 observations, all `observedAt` `2026-10-02T09:05:00Z`, each passes `routingObservationSchema`. |

**Table P — synthetic overrides.** Base prices: prompt `0.0000001` (0.10/M), completion `0.0000004` (0.40/M), cache read `0.00000001` (0.01/M). Override price `0.0000002` (0.20/M) unless stated. Days: 2026-10-02 Friday, 2026-10-03 Saturday, 2026-10-04 Sunday.

| # | Override(s) | `now` (UTC) | Prompt tokens | Expect prompt $/M; applied |
|---|---|---|---|---|
| P1 | `{utc_start: 100, utc_end: 400, utc_days: [monday…friday], prompt}` | Fri 01:00 / 03:59:59 / 04:00 / 00:59 | 0 | 0.20 true / 0.20 true / 0.10 false / 0.10 false |
| P2 | same | Sat 02:00 | 0 | 0.10 false |
| P3 | `{utc_days: ['saturday', 'sunday'], prompt}` | Sat 00:00 / Sun 23:59 / Fri 12:00 | 0 | 0.20 / 0.20 / 0.10 |
| P4 | `{utc_start: 2200, utc_end: 200, prompt}` | 22:00 / 23:30 / 01:59 / 02:00 / 21:59 | 0 | in / in / in / out / out |
| P5 | `{utc_start: 1400, utc_end: 0, prompt}` | 14:00 / 23:59 / 00:00 / 13:59 | 0 | in / in / out / out |
| P6 | `{utc_start: 0, utc_end: 0, prompt}` | 00:00 / 12:34 | 0 | in / in |
| P7 | `{min_prompt_tokens: 128000, prompt}` | any | 128000 / 128001 | 0.10 false / 0.20 true |
| P8 | `[{prompt: 0.0000003, completion: 0.0000009}, {prompt}]`, both all-day | any | 0 | prompt 0.20, completion 0.90 (later wins per key) |
| P9 | `[{prompt}]` all-day | any | 0 | completion 0.40 and cache read 0.01 inherited |
| P10 | `[{input_cache_write: '0.00000005'}]`; no overrides | any | 0 | `cacheWritePerM` 0.05; `null` |
| P11 | `{utc_days: ['Saturday'], prompt}`; `{utc_days: ['caturday'], prompt}` | Sat 10:00 | 0 | applies; never applies |
| P12 | `{utc_start: 2200, utc_end: 200, utc_days: ['friday'], prompt}` | Fri 23:00 / Sat 01:00 | 0 | in / out (C4) |
| P13 | No `overrides` | any | 0 | Base prices; `overrideApplied` false |

**Table D — real schedules from the fixture** (`typicalPromptTokens` 113651).

| Row | `now` | prompt / completion / cache read $/M | Applied |
|---|---|---|---|
| `deepseek` | 2026-10-02T02:00:00Z (Fri) | 0.30 / 1.20 / 0.006 | true |
| `deepseek` | 2026-10-02T04:30:00Z | 0.15 / 0.60 / 0.003 | true |
| `deepseek` | 2026-10-03T02:00:00Z and 2026-10-03T12:00:00Z (Sat) | 0.15 / 0.60 / 0.003 | true |
| `deepseek` | 2026-10-02T09:20:00Z | 0.30 / 1.20 / 0.006 | true |
| `alibaba` | 2026-10-02T09:20:00Z | 0.30 / 1.20 / 0.03 | true |
| `alibaba` | 2026-10-02T15:00:00Z | 0.15 / 0.60 / 0.015 | true |
| `deepinfra/fp8` | any | 0.14 / 0.42 / 0.0042 | false |

**Table B — blended cost** (interactive shares 0.057 / 0.932 / 0.011; relative tolerance 1e-4).

| # | Case | Expect |
|---|---|---|
| B1 | `deepinfra/fp8`, verified | `blended` 0.0165144 (`fresh` 0.00798, `cached` 0.0039144, `output` 0.00462), `cacheCredit` true. |
| B2 | `deepinfra/fp8`, not verified | `blended` 0.14308, `cacheCredit` false. |
| B3 | `baidu/fp8`, `cache['baidu/fp8'].verified` false | `blended` 0.309590. |
| B4 | A row without `input_cache_read`, verified | Cached share priced at the prompt price. |
| B5 | Two `baseten/fp8` rows through `collapsePricing` | Equal to one row's prices. |
| B6 | Prompt `-1`; all prices `0` | `null`. |

Numbers are compared with a helper asserting `Math.abs(actual / expected - 1) < 1e-4`. A mismatch is investigated against K11 and the documented rules before any expectation changes.

## Invariants

- Shared code imports only `zod`; main routing code imports only `zod`, `../../shared/routing` and sibling routing modules (`model-registry.json` included).
- No routing function reads the clock, randomness, environment or file system; `now` and `promptTokens` are parameters.
- Outputs are independent of input row order (sorted by tag; rows inside a group handled order-free).
- Every exported result type is plain data; nothing returned contains `Date`, `Map`, `Set` or `undefined` values that matter.

## Verification

```powershell
npm run typecheck
npx vitest run src/main/routing src/shared/routing.test.ts
npm test
Get-ChildItem -Path src/main/routing, src/shared/routing.ts -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern 'Date\.now\(|Math\.random\(|new Date\(\)|from ''(node:|fs''|path''|electron|better-sqlite3)|require\('
npm run grep:secrets
git diff --check
git status --short
```

The `Select-String` line must print nothing; it also matches comments, so state the purity rule in comments without those literal tokens. Runtime evidence for this task is the test run over the real fixture (E1, E5, E12, Table D). Record the vitest summary line, the `git status --short` output showing the `R` rename and the untouched pre-existing entries, and `git diff --stat` for `roadmap.md` (2 lines changed).
