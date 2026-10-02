import { z } from 'zod'

/**
 * Model Routing Phase 1 contracts (ImplementationSpec-1-1, normative block).
 *
 * Shared by main (the pure ranker under src/main/routing/) and, from Phase 2/3,
 * by IPC and the renderer. This file is compiled by both the node and the web
 * tsconfig, so it imports only `zod`, never a Node module.
 *
 * Raw OpenRouter rows are non-strict (OpenRouter adds fields; unknown keys are
 * stripped). Chorus-owned records are strict. Results are plain JSON (K2).
 */

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

// ── Phase 2 — transport vocabulary (Task 2-1) ──

/** A routable endpoint tag as Chorus accepts it from an OpenRouter response (C2, C3). At most 64 characters. */
export const ROUTING_TAG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/
export const routingTagSchema = z.string().regex(ROUTING_TAG_PATTERN)

/** The only reasons a routing request can fail. Never a provider body, header, URL or exception text. */
export const ROUTING_FAILURES = [
  'unreachable', 'auth-failed', 'rate-limited', 'provider-error', 'unexpected-status', 'unrecognized', 'model-mismatch'
] as const
export const routingFailureSchema = z.enum(ROUTING_FAILURES)
export type RoutingFailure = z.infer<typeof routingFailureSchema>

export const ROUTING_FAILURE_MESSAGES: Record<RoutingFailure, string> = {
  unreachable: 'Could not reach OpenRouter.',
  'auth-failed': 'Authentication failed — the credential was rejected.',
  'rate-limited': 'Rate limited by OpenRouter.',
  'provider-error': 'OpenRouter returned an error.',
  'unexpected-status': 'Unexpected response from OpenRouter.',
  unrecognized: 'OpenRouter returned an unrecognized response.',
  'model-mismatch': 'OpenRouter returned endpoints for a different model.'
}

export const PREFLIGHT_STEPS = ['guardrails', 'dataPolicy'] as const
export type PreflightStep = (typeof PREFLIGHT_STEPS)[number]

/** Why a preflight body did not yield a list. Every one means "unknown" (MR-D12, Phase 1 K3). */
export const PREFLIGHT_ISSUES = [
  'unexpected-status', 'unrecognized-body', 'unrecognized-message', 'unbalanced-reason',
  'bad-tag', 'funnel-inconsistent', 'step-mismatch', 'count-mismatch'
] as const
export const preflightIssueSchema = z.enum(PREFLIGHT_ISSUES)
export type PreflightIssue = z.infer<typeof preflightIssueSchema>

export const CACHE_PROBE_OUTCOMES = ['verified', 'not-cached', 'inconclusive'] as const
export const cacheProbeOutcomeSchema = z.enum(CACHE_PROBE_OUTCOMES)
export type CacheProbeOutcome = z.infer<typeof cacheProbeOutcomeSchema>

/** Why an eligible, due tag was not probed: the $ cap, a verification-only tag limit, or an aborted refresh. */
export const PROBE_SKIP_REASONS = ['cap', 'limit', 'aborted'] as const
export const probeSkipSchema = z.strictObject({ tag: routingTagSchema, reason: z.enum(PROBE_SKIP_REASONS) })
export type ProbeSkip = z.infer<typeof probeSkipSchema>

// ── Phase 2 — store and settings (Task 2-2) ──

export const ROUTING_STORE_VERSION = 1

/** Credential profile ids are randomUUID() (vault.ts:144); shared/ipc.ts already validates them with z.uuid(). */
export const credentialProfileIdSchema = z.uuid()

/** MR-D19: background observation consent and the designated credential. */
export const routingObservationSettingsSchema = z.strictObject({
  enabled: z.boolean(),
  credentialProfileId: credentialProfileIdSchema.nullable()
})
export type RoutingObservationSettings = z.infer<typeof routingObservationSettingsSchema>
export const DEFAULT_ROUTING_OBSERVATION_SETTINGS: RoutingObservationSettings = { enabled: true, credentialProfileId: null }

// MR-D20 store files. Strict envelopes; the snapshot's rows reuse the non-strict rawEndpointSchema.
export const routingSnapshotFileSchema = z.strictObject({
  version: z.literal(1),
  model: z.string().min(1),
  fetchedAt: isoTime,
  endpoints: z.array(rawEndpointSchema).min(1)
})
export const routingObservationsFileSchema = z.strictObject({
  version: z.literal(1),
  model: z.string().min(1),
  observations: z.array(routingObservationSchema)
})
export const routingCacheFileSchema = z.strictObject({
  version: z.literal(1),
  model: z.string().min(1),
  verifications: cacheVerificationSchema
})
export const routingAccountFileSchema = z.strictObject({
  version: z.literal(1),
  model: z.string().min(1),
  credentialProfileId: credentialProfileIdSchema,
  eligibility: accountEligibilitySchema
})
export type RoutingSnapshotFile = z.infer<typeof routingSnapshotFileSchema>
export type RoutingObservationsFile = z.infer<typeof routingObservationsFileSchema>
export type RoutingCacheFile = z.infer<typeof routingCacheFileSchema>
export type RoutingAccountFile = z.infer<typeof routingAccountFileSchema>
