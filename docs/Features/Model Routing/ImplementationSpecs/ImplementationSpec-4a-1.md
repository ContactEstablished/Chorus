# Implementation specification 4a-1 — Launch routing contracts and resolution

Paired [task](../Tasks/Task-4a-1.md). Decisions: [roadmap](../roadmap.md) MR-D3, MR-D4, MR-D10, MR-D11, MR-D18–MR-D20, MR-D22; user decisions MR-D25–MR-D28; gates MR-G1, MR-G4, MR-G5, MR-G8; [overview](../Tasks/Phase-4a-Overview.md) K1–K10, K12, K13 and clarifications C1–C9. Builds on [ImplementationSpec-2-3](ImplementationSpec-2-3.md) and [ImplementationSpec-3-1](ImplementationSpec-3-1.md). **Not started.**

## Files and insertion points

Verified 2026-10-03 at `a57ef1b`.

| File | Action |
|---|---|
| `src/shared/routing.ts` (LF) | In `ROUTING_ERROR_CODES` (:393–404) append two codes after `'OPERATION_FAILED'` (:403). In `ROUTING_CHANNELS` (:535–546) insert `launchPreferences` after `credentials` (:544), before `progress` (:545). In `RoutingApi` (:555–567) insert `launchPreferences(…)` after `credentials` (:565), before `onProgress` (:566). Append the "Phase 4a — launch routing (Task 4a-1)" block at the end of the file (after :591). Nothing else changes. |
| `src/shared/routing.test.ts` (LF) | Imports (:5–39); amend S4-1 (:219–223) and S5-1 (:313–318); append `describe('Table S7 — Phase 4a launch routing')` after :353. |
| `src/main/routing/launchCore.ts` | New (LF). |
| `src/main/routing/launchCore.test.ts` | New (LF), Table L. |
| `src/main/services/routingStore.ts` (LF) | Imports (:1–25); header (:27–61) gains one paragraph; `readText` (:151–165), `load` (:167–176) and `save` (:183–207) as below; the two new public methods after `writeAccount` (:132–135). |
| `src/main/services/routingStore.test.ts` (LF) | Append `describe('Table F2 — launch preferences')` after :280. |
| `src/main/services/routingService.ts` (LF) | Imports (:4–32, :33–47); `RoutingStoreLike` (:112–115); `tiers()` (:341–365) as below; `resolveLaunch`, `launchPreferences` and `recordLaunchChoice` after `tiers()`; `storedRankInputs` in the helpers section after `registryEntry` (:853–857). |
| `src/main/services/routingService.test.ts` (LF) | Imports (:6–41); `storeWith` (:384–396) gains two delegations; append `describe('Table V4 — Phase 4a additions')` after :1634. |
| `src/main/services/routingIpc.ts` (LF) | Header (:24–27); imports (:4–19); `RoutingIpcDeps.service` (:49–52); one `handle(…)` after the `credentials` line (:112). |
| `src/main/services/routingIpc.test.ts` (LF) | `VALID` (:96–106), `WRONG_TYPE` (:108–118), the `setup` fake (:123–136) and `actions` (:146–156); I1 (:180–186); `happyPaths` (:229–249); I4 (:251–276); append I12 after I11 (:433–441). |
| `src/preload/index.ts` (CRLF) | One line after `credentials` (:170), before `onProgress` (:171). |
| `scripts/verify-routing-ipc.mjs` (LF) | Header (:3); `CHECKS` (:65–71); freshness (:106–108); the D19 call after D18 (:401–407), before the D13 negative control. |

`src/main/index.ts`, `src/preload/index.d.ts`, `src/main/ipc.ts`, `storage.ts`, `storeCore.ts`, `routingObserver.ts`, `routingClient.ts` and every other `src/main/routing/*` file are unchanged: `index.ts:1415–1416` passes a whole `RoutingStore`, which gains both methods.

## Recorded contract amendments (to Phases 2 and 3)

Contract changes made on purpose, listed so that no test edit reads as "changing an expectation to make a test pass".

| Amendment | Test or script that changes with it |
|---|---|
| `ROUTING_ERROR_CODES` gains `SNAPSHOT_STALE` and `TIER_EMPTY` (C1) | S4-1 (`src/shared/routing.test.ts:219–223`): ten codes → twelve. |
| `ROUTING_CHANNELS` gains `launchPreferences: 'routing:launch-preferences'`; `RoutingApi` gains `launchPreferences(input)` | S5-1 (:313–318): ten unique values → eleven. I1 (`routingIpc.test.ts:180–186`): nine request channels → ten. I4 (:251–276): nine responses → ten. `VALID`, `WRONG_TYPE`, the `setup` fake and `actions` gain the channel, so I2, I3, I5 and I6 cover it. |
| `RoutingIpcDeps.service` picks `launchPreferences`; one more `handle(…)` line | `routingIpc.ts` header (:26): "Nine request channels" → "Ten". |
| `RoutingStoreLike` gains `readLaunchPreferences` and `writeLaunchPreferences` | `storeWith` (`routingService.test.ts:384–396`) delegates both (a fixture, not an expectation). |
| `tiers()` reads its stored inputs through `storedRankInputs` with the same calls in the same order | None: every Table V, V3 and coordinator-decision test passes unchanged. |
| `RoutingStore`'s private `readText` and `save` take the warning builder, the size cap and the failure message as parameters | None: Table F passes unchanged (identical warnings and messages). |
| The preload `routing:` block gains one line | I9 reads every channel literal, the new one included. |
| `verify-routing-ipc.mjs` gains check `D19 launch preferences empty` and a preload freshness string | Its last line becomes `PASS (20 checks)`. |

## Normative contracts — `src/shared/routing.ts`

**Amendments to the Phase 2 blocks:**

```ts
export const ROUTING_ERROR_CODES = [
  // … the ten existing codes, unchanged and in order …
  'OPERATION_FAILED', // anything else; fixed message
  'SNAPSHOT_STALE', // Phase 4a (Task 4a-1): resolveLaunch, a ranked tier on a snapshot older than snapshotMaxAgeMinutes (MR-D26)
  'TIER_EMPTY' // Phase 4a (Task 4a-1): resolveLaunch, a ranked tier with no eligible endpoint
] as const

export const ROUTING_CHANNELS = {
  // … the nine existing request channels, unchanged …
  credentials: 'routing:credentials', // Phase 3 (Task 3-1)
  launchPreferences: 'routing:launch-preferences', // Phase 4a (Task 4a-1)
  progress: 'routing:progress' // main -> renderer broadcast only
} as const

export interface RoutingApi {
  // … unchanged members …
  credentials(input: Record<string, never>): Promise<RoutingReply<RoutingCredentialList>>
  /** Phase 4a (Task 4a-1): the remembered last choice per model (MR-D28). Main writes it; the renderer only reads. */
  launchPreferences(input: Record<string, never>): Promise<RoutingReply<RoutingLaunchPreferences>>
  onProgress(listener: (event: RoutingProgressEvent) => void): () => void
}
```

**Appended block** (after :591):

```ts
// ── Phase 4a — launch routing (Task 4a-1) ──

/** MR-D4: Nitro is the OpenRouter `<slug>:nitro` suffix. */
export const ROUTING_NITRO_SUFFIX = ':nitro'

/** The base model id: one trailing `:nitro` removed, nothing else. Pure (MR-D4; the dialog's effort lookup uses it). */
export function routingBaseModelId(id: string): string {
  return id.endsWith(ROUTING_NITRO_SUFFIX) ? id.slice(0, id.length - ROUTING_NITRO_SUFFIX.length) : id
}

/** The tiers a launch can name (K2). The same four names as ROUTING_TIERS; S7-1 pins the equality. */
export const ROUTING_LAUNCH_TIERS = ['budget', 'balanced', 'fast', 'nitro'] as const
export const routingLaunchTierSchema = z.enum(ROUTING_LAUNCH_TIERS)
export type RoutingLaunchTier = z.infer<typeof routingLaunchTierSchema>

/** What a launch can remember (K8): a tier, or 'default' for an eligible launch that sent none (OpenRouter default). */
export const ROUTING_LAUNCH_CHOICES = [...ROUTING_LAUNCH_TIERS, 'default'] as const
export const routingLaunchChoiceSchema = z.enum(ROUTING_LAUNCH_CHOICES)
export type RoutingLaunchChoice = z.infer<typeof routingLaunchChoiceSchema>

/** RoutingService.resolveLaunch's input (K2, K4). Main-only: no IPC channel carries it. */
export const routingLaunchRequestSchema = z.strictObject({
  model: routingModelSlugSchema, // the base registry slug
  tier: routingLaunchTierSchema,
  effort: routingEffortSchema, // the launch's model_effort, or null
  credentialProfileId: credentialProfileIdSchema // the launch credential (account eligibility per credential, MR-D20)
})
export type RoutingLaunchRequest = z.infer<typeof routingLaunchRequestSchema>

/**
 * K5: the exact routing a session launched with, persisted as `sessions.routing_json` (MR-D27) and
 * re-applied unchanged by relaunch (K10). Strict, with cross-field rules (C4), so a stored row that
 * was edited by hand can never relaunch with a sent id, provider or order that disagree.
 */
export const routingLaunchSelectionSchema = z
  .strictObject({
    tier: routingLaunchTierSchema,
    model: routingModelSlugSchema, // base slug, never suffixed
    sentModelId: routingModelSlugSchema, // the model id OpenCode sends: the slug, or slug + ':nitro'
    provider: providerPrefsSchema.nullable(), // null only for Nitro under dataCollection 'allow'
    endpoints: z.array(z.string().min(1)), // the order tags; [] for Nitro
    computedAt: isoTime, // the service clock at resolution
    snapshotFetchedAt: isoTime.nullable() // null exactly for Nitro
  })
  .refine((s) => !s.model.endsWith(ROUTING_NITRO_SUFFIX), { message: 'model carries the Nitro suffix' })
  .refine(
    (s) =>
      s.tier === 'nitro'
        ? s.sentModelId === s.model + ROUTING_NITRO_SUFFIX && s.endpoints.length === 0 && s.snapshotFetchedAt === null
        : s.sentModelId === s.model &&
          s.provider !== null &&
          s.endpoints.length > 0 &&
          s.snapshotFetchedAt !== null &&
          JSON.stringify(s.provider.order ?? []) === JSON.stringify(s.endpoints),
    { message: 'selection fields disagree with its tier' }
  )
export type RoutingLaunchSelection = z.infer<typeof routingLaunchSelectionSchema>

/** K8: `routing:launch-preferences`' value. Keys are slugs; main records registry slugs only. */
export const routingLaunchPreferencesSchema = z.strictObject({
  lastChoiceByModel: z.record(routingModelSlugSchema, routingLaunchChoiceSchema)
})
export type RoutingLaunchPreferences = z.infer<typeof routingLaunchPreferencesSchema>
```

`providerPrefsSchema` (:442) and `isoTime` (:29) are module-scope constants above the block; nothing is exported in addition to the fixed names.

## Normative contracts — `src/main/routing/launchCore.ts`

Pure: imports only `zod`, `../../shared/routing` and the sibling cores `./payloadCore` and `./routingCredentialCore`. No clock, randomness, environment, file system or network; every result is a fresh plain-JSON value that shares no array or object with its input. The purity and layering greps cover it, so the words they match must not appear even in a comment.

```ts
import { z } from 'zod'

import {
  ROUTING_NITRO_SUFFIX,
  ROUTING_STORE_VERSION,
  routingEffortSchema,
  routingLaunchPreferencesSchema,
  routingLaunchSelectionSchema,
  type OpenRouterProviderPrefs,
  type RoutingErrorCode,
  type RoutingLaunchPreferences,
  type RoutingLaunchSelection,
  type RoutingLaunchTier,
  type RoutingSettings,
  type TierResult
} from '../../shared/routing'
import { buildNitroSelection } from './payloadCore'
import { checkEnvelopeBaseUrl, credentialRefusalMessage, normalizeBaseUrl } from './routingCredentialCore'

// ── Resolution (K2, K5, MR-D26) ──

export const LAUNCH_TIER_LABELS: Record<RoutingLaunchTier, string> = { budget: 'Budget', balanced: 'Balanced', fast: 'Fast', nitro: 'Nitro' }

/** Exact texts; `noSnapshot` and `failed` equal routingService.ts MESSAGES.noSnapshot (:160) and MESSAGES.failed (:163). */
export const LAUNCH_MESSAGES = {
  noSnapshot: 'No endpoint snapshot is stored for this model yet. Refresh first.',
  failed: 'Routing operation failed.'
} as const

export function staleSnapshotMessage(snapshotMaxAgeMinutes: number): string {
  return `The endpoint snapshot for this model is more than ${snapshotMaxAgeMinutes} minutes old. Refresh first.`
}

export function emptyTierMessage(tier: Exclude<RoutingLaunchTier, 'nitro'>): string {
  return `${LAUNCH_TIER_LABELS[tier]} has no eligible endpoints. Choose another tier or OpenRouter default.`
}

export type LaunchResolution =
  | { ok: true; selection: RoutingLaunchSelection }
  | { ok: false; code: RoutingErrorCode; message: string }

/**
 * Nitro (C3): always ok; `result` is ignored; provider from buildNitroSelection under `settings`.
 * Ranked (C5), first refusal wins: no result → NO_SNAPSHOT; a result for another model → OPERATION_FAILED;
 * stale → SNAPSHOT_STALE (before emptiness: a refresh may repopulate the tier); a null tier → TIER_EMPTY.
 */
export function resolveLaunchSelection(input: {
  tier: RoutingLaunchTier
  model: string
  result: TierResult | null
  settings: RoutingSettings
  computedAt: string
}): LaunchResolution {
  const { tier, model, result, settings, computedAt } = input
  if (tier === 'nitro') {
    const nitro = buildNitroSelection(model, null, [], settings)
    return {
      ok: true,
      selection: { tier, model, sentModelId: nitro.model, provider: nitro.provider, endpoints: [], computedAt, snapshotFetchedAt: null }
    }
  }
  if (result === null) return { ok: false, code: 'NO_SNAPSHOT', message: LAUNCH_MESSAGES.noSnapshot }
  if (result.model !== model) return { ok: false, code: 'OPERATION_FAILED', message: LAUNCH_MESSAGES.failed }
  if (result.stale) return { ok: false, code: 'SNAPSHOT_STALE', message: staleSnapshotMessage(settings.snapshotMaxAgeMinutes) }
  const chosen = result.tiers[tier]
  if (chosen === null) return { ok: false, code: 'TIER_EMPTY', message: emptyTierMessage(tier) }
  return {
    ok: true,
    selection: {
      tier,
      model,
      sentModelId: model,
      provider: copyProvider(chosen.provider),
      endpoints: [...chosen.endpoints],
      computedAt,
      snapshotFetchedAt: result.snapshotFetchedAt
    }
  }
}

/** A deep copy that keeps buildRankedProvider's key order. */
function copyProvider(provider: OpenRouterProviderPrefs): OpenRouterProviderPrefs {
  return JSON.parse(JSON.stringify(provider)) as OpenRouterProviderPrefs
}

// ── OpenCode's per-process config (K6, MR-D3, MR-D4) ──

function isEffort(value: unknown): value is string {
  return typeof value === 'string' && routingEffortSchema.safeParse(value).success
}

/** C9: tokens that pass routingEffortSchema, first occurrence kept, order kept. */
function cleanEfforts(efforts: readonly string[]): string[] {
  const out: string[] = []
  for (const e of efforts) if (isEffort(e) && !out.includes(e)) out.push(e)
  return out
}

/** K6: the base model's catalog efforts when it lists any (null and [] list none); else the launch's own effort; else none. */
export function routingVariantEfforts(catalogEfforts: readonly string[] | null, launchEffort: string | null): string[] {
  const listed = cleanEfforts(catalogEfforts ?? [])
  if (listed.length > 0) return listed
  return isEffort(launchEffort) ? [launchEffort] : []
}

type OpenCodeVariants = Record<string, { reasoning: { effort: string } }>

/** One `{ reasoning: { effort } }` per already-cleaned effort, in order. */
function variantsFor(efforts: readonly string[]): OpenCodeVariants {
  return Object.fromEntries(efforts.map((e) => [e, { reasoning: { effort: e } }]))
}

/**
 * K6: OPENCODE_CONFIG_CONTENT for one launch. `provider.openrouter.models[sentModelId]` carries `options.provider`
 * when the selection has one, then (Nitro only) `variants`, one per cleaned effort (C9). Ranked tiers never declare
 * variants: the plain id's variants are OpenCode's own (Phase-0-Findings row (a), `tui-routed`).
 */
export function buildOpenCodeRoutingContent(selection: RoutingLaunchSelection, variantEfforts: readonly string[]): string {
  const entry: { options?: { provider: OpenRouterProviderPrefs }; variants?: OpenCodeVariants } = {}
  if (selection.provider !== null) entry.options = { provider: copyProvider(selection.provider) }
  if (selection.tier === 'nitro') {
    const efforts = cleanEfforts(variantEfforts)
    if (efforts.length > 0) entry.variants = variantsFor(efforts)
  }
  return JSON.stringify({ provider: { openrouter: { models: { [selection.sentModelId]: entry } } } })
}

// ── K13: an UNROUTED `:nitro` launch still declares its variants (MR-D4) ──

/**
 * K13: OPENCODE_CONFIG_CONTENT that declares `sentModelId`'s variants and nothing else — no `options.provider`,
 * because no tier was chosen (no routing, no data_collection). Null when the id does not end in `:nitro` or no
 * effort survives cleaning. Without the declaration OpenCode drops a `:nitro` id's effort in silence
 * (Phase-0-Findings row (b), `tui-nitro-bare`).
 */
export function buildOpenCodeNitroVariantsContent(sentModelId: string, variantEfforts: readonly string[]): string | null {
  if (!sentModelId.endsWith(ROUTING_NITRO_SUFFIX)) return null
  const efforts = cleanEfforts(variantEfforts)
  if (efforts.length === 0) return null
  return JSON.stringify({ provider: { openrouter: { models: { [sentModelId]: { variants: variantsFor(efforts) } } } } })
}

export interface NitroVariantsFacts {
  readonly agent: string
  readonly baseUrl: string | null // the launch route's base URL, after the decrypt
  readonly gatewayBaseUrl: string // OPENROUTER_GATEWAY_BASE_URL, passed in (services/openrouterKeys.ts stays its home)
  readonly sentModelId: string | null // the route's model id exactly as `-m` will send it
  readonly launchEffort: string | null // the launch's model effort (payload > profile; the profile's on relaunch)
  readonly catalogEfforts: readonly string[] | null // the credential provider's catalog row for routingBaseModelId(sentModelId)
  readonly profileEnvKeys: readonly string[] // the launch profile's env names
}

/**
 * K13: the content an UNROUTED credentialed OpenCode launch (or relaunch) carries, or null. Applies only when the
 * agent is opencode, the route reaches the OpenRouter gateway, the sent id ends in `:nitro` and the launch carries a
 * valid effort; efforts come from `routingVariantEfforts` (catalog row, else the launch's own). A profile env that
 * sets OPENCODE_CONFIG_CONTENT keeps today's behaviour: its own content is used and nothing is added (no refusal —
 * the launch is not routed). Never persisted: it is not a routing selection.
 */
export function unroutedNitroVariantsContent(f: NitroVariantsFacts): string | null {
  if (f.agent !== 'opencode' || f.baseUrl === null || f.sentModelId === null || !isEffort(f.launchEffort)) return null
  if (normalizeBaseUrl(f.baseUrl) !== normalizeBaseUrl(f.gatewayBaseUrl)) return null
  if (setsConfigContent(f.profileEnvKeys)) return null
  return buildOpenCodeNitroVariantsContent(f.sentModelId, routingVariantEfforts(f.catalogEfforts, f.launchEffort))
}

// ── Launch planning (K3, K7, K10; C8) ──

/** Exact refusal texts. `unknownModel` equals routingService.ts MESSAGES.unknownModel (:159). */
export const ROUTING_LAUNCH_REFUSALS = {
  notOpencode: 'Routing tiers apply only to OpenCode launches.',
  unavailable: 'Model routing is not available right now. Launch with OpenRouter default instead.',
  noCredential: 'Routing tiers need an OpenRouter API-key credential.',
  credentialRefused:
    'This credential cannot be used for model routing. Routing needs an OpenRouter API-key credential for the OpenRouter gateway.',
  noModel: 'Choose a model to use a routing tier.',
  nitroModel: 'This model already ends in :nitro. Choose the base model and the Nitro tier instead.',
  unknownModel: 'Model routing does not know this model.',
  profileEnv:
    'The launch profile sets OPENCODE_CONFIG_CONTENT, which a routed launch also needs. Remove it from the profile, or launch with OpenRouter default.',
  storedInvalid: "This session's saved routing could not be read. Start a new session from the launch dialog.",
  relaunchUnavailable: 'Model routing is not available right now, so this routed session cannot be relaunched.',
  relaunchCredential: "This session was routed, but its launch profile's credential can no longer be used for model routing."
} as const

export interface RoutingLaunchFacts {
  readonly agent: string
  readonly tier: RoutingLaunchTier | null // the payload's routing_tier, or null (OpenRouter default)
  readonly credentialProfileId: string | null // the launch credential, from the payload or the profile
  readonly model: string | null // req.model ?? profileModel ?? provider.model
  readonly routingAvailable: boolean // false when the service is absent or its two lists could not be read
  readonly routingCredentialIds: readonly string[] // RoutingService.credentials() ids
  readonly registrySlugs: readonly string[] // RoutingService.models() slugs
  readonly profileEnvKeys: readonly string[] // the launch profile's env names
}

export type RoutingLaunchPlan =
  | { readonly kind: 'unrouted' }
  | { readonly kind: 'default'; readonly model: string }
  | { readonly kind: 'routed'; readonly model: string; readonly tier: RoutingLaunchTier; readonly credentialProfileId: string }
  | { readonly kind: 'refused'; readonly reason: string }

type Eligibility = { ok: true; model: string; credentialProfileId: string } | { ok: false; reason: string }

/** K3, first failure wins, in this order. */
function launchEligibility(f: RoutingLaunchFacts): Eligibility {
  const R = ROUTING_LAUNCH_REFUSALS
  if (f.agent !== 'opencode') return { ok: false, reason: R.notOpencode }
  if (!f.routingAvailable) return { ok: false, reason: R.unavailable }
  if (f.credentialProfileId === null) return { ok: false, reason: R.noCredential }
  if (!f.routingCredentialIds.includes(f.credentialProfileId)) return { ok: false, reason: R.credentialRefused }
  if (f.model === null) return { ok: false, reason: R.noModel }
  if (f.model.endsWith(ROUTING_NITRO_SUFFIX)) return { ok: false, reason: R.nitroModel }
  if (!f.registrySlugs.includes(f.model)) return { ok: false, reason: R.unknownModel }
  return { ok: true, model: f.model, credentialProfileId: f.credentialProfileId }
}

/** Windows environment names are case-insensitive, so the K7 collision is too. */
function setsConfigContent(keys: readonly string[]): boolean {
  return keys.some((k) => k.toUpperCase() === 'OPENCODE_CONFIG_CONTENT')
}

/**
 * K3, K7, K8 (C8). A profile env that sets OPENCODE_CONFIG_CONTENT makes a launch NOT routing-eligible (K7).
 * No tier: eligible and not K7-blocked → 'default' (recorded after the launch); otherwise 'unrouted' (today's launch,
 * nothing recorded). A tier: ineligible → 'refused' (never ignored); K7-blocked → 'refused'; else 'routed'.
 */
export function planRoutingLaunch(f: RoutingLaunchFacts): RoutingLaunchPlan {
  const e = launchEligibility(f)
  const blocked = setsConfigContent(f.profileEnvKeys)
  if (f.tier === null) return e.ok && !blocked ? { kind: 'default', model: e.model } : { kind: 'unrouted' }
  if (!e.ok) return { kind: 'refused', reason: e.reason }
  if (blocked) return { kind: 'refused', reason: ROUTING_LAUNCH_REFUSALS.profileEnv }
  return { kind: 'routed', model: e.model, tier: f.tier, credentialProfileId: e.credentialProfileId }
}

export type StoredRoutingSelection =
  | { readonly kind: 'none' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'selection'; readonly selection: RoutingLaunchSelection }

/** `sessions.routing_json`: null → none; anything that is not JSON or fails the strict schema → invalid. */
export function parseStoredRoutingSelection(text: string | null): StoredRoutingSelection {
  if (text === null) return { kind: 'none' }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { kind: 'invalid' }
  }
  const parsed = routingLaunchSelectionSchema.safeParse(json)
  return parsed.success ? { kind: 'selection', selection: parsed.data } : { kind: 'invalid' }
}

export interface RoutingRelaunchFacts {
  readonly agent: string
  readonly routingJson: string | null
  readonly credentialProfileId: string | null // the launch profile's credential
  readonly routingAvailable: boolean
  readonly routingCredentialIds: readonly string[]
  readonly profileEnvKeys: readonly string[]
}

export type RoutingRelaunchPlan =
  | { readonly kind: 'unrouted' }
  | { readonly kind: 'routed'; readonly selection: RoutingLaunchSelection }
  | { readonly kind: 'refused'; readonly reason: string }

/** K10, first failure wins: unreadable row; agent; service; credential; profile env. No re-rank. */
export function planRoutingRelaunch(f: RoutingRelaunchFacts): RoutingRelaunchPlan {
  const R = ROUTING_LAUNCH_REFUSALS
  const stored = parseStoredRoutingSelection(f.routingJson)
  if (stored.kind === 'none') return { kind: 'unrouted' }
  if (stored.kind === 'invalid') return { kind: 'refused', reason: R.storedInvalid }
  if (f.agent !== 'opencode') return { kind: 'refused', reason: R.notOpencode }
  if (!f.routingAvailable) return { kind: 'refused', reason: R.relaunchUnavailable }
  if (f.credentialProfileId === null || !f.routingCredentialIds.includes(f.credentialProfileId)) {
    return { kind: 'refused', reason: R.relaunchCredential }
  }
  if (setsConfigContent(f.profileEnvKeys)) return { kind: 'refused', reason: R.profileEnv }
  return { kind: 'routed', selection: stored.selection }
}

/**
 * After the decrypt: a routed launch's route must reach the OpenRouter gateway (the envelope may name its own base
 * URL). The gateway is a parameter, as in routingCredentialCore, so services/openrouterKeys.ts stays its only home.
 */
export function checkRoutedRoute(baseUrl: string | null, label: string, gatewayBaseUrl: string): { ok: true } | { ok: false; reason: string } {
  if (baseUrl === null) return { ok: false, reason: credentialRefusalMessage('not-openrouter', label) }
  const check = checkEnvelopeBaseUrl(baseUrl, label, gatewayBaseUrl)
  return check.ok ? { ok: true } : { ok: false, reason: check.message }
}

// ── The launch-preferences file (K8, C6) ──

export const LAUNCH_PREFERENCES_FILE = 'launch-preferences.json'
export const LAUNCH_PREFERENCES_CAP_BYTES = 65_536

const launchPreferencesFileSchema = z.strictObject({
  version: z.literal(ROUTING_STORE_VERSION),
  lastChoiceByModel: routingLaunchPreferencesSchema.shape.lastChoiceByModel
})

export type LaunchPreferencesProblem = 'json' | 'schema' | 'size' | 'read'

const PREFERENCES_WARNING: Record<LaunchPreferencesProblem, string> = {
  json: 'is not valid JSON',
  schema: 'does not match its schema',
  size: `exceeds ${LAUNCH_PREFERENCES_CAP_BYTES} bytes`,
  read: 'could not be read'
}

/** Fixed text: never content, a path or an exception message. */
export function launchPreferencesWarning(problem: LaunchPreferencesProblem): string {
  return `launch preferences file ${PREFERENCES_WARNING[problem]}; reading it as empty`
}

export function emptyLaunchPreferences(): RoutingLaunchPreferences {
  return { lastChoiceByModel: {} }
}

/** Missing → empty with no warning; not JSON → `json`; rejected by the strict file schema → `schema`. */
export function parseLaunchPreferencesFile(text: string | null): { value: RoutingLaunchPreferences; warning: string | null } {
  if (text === null) return { value: emptyLaunchPreferences(), warning: null }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { value: emptyLaunchPreferences(), warning: launchPreferencesWarning('json') }
  }
  const parsed = launchPreferencesFileSchema.safeParse(json)
  if (!parsed.success) return { value: emptyLaunchPreferences(), warning: launchPreferencesWarning('schema') }
  return { value: { lastChoiceByModel: { ...parsed.data.lastChoiceByModel } }, warning: null }
}

/** `{"version":1,"lastChoiceByModel":{…}}`, keys sorted by code unit. Throws (ZodError) on a value the reader would refuse. */
export function launchPreferencesFileText(prefs: RoutingLaunchPreferences): string {
  const valid = routingLaunchPreferencesSchema.parse(prefs)
  const keys = Object.keys(valid.lastChoiceByModel).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const lastChoiceByModel = Object.fromEntries(keys.map((k) => [k, valid.lastChoiceByModel[k]]))
  return JSON.stringify(launchPreferencesFileSchema.parse({ version: ROUTING_STORE_VERSION, lastChoiceByModel }))
}
```

**Accepted deviation from K8's shape (coordinator, 2026-10-03; C6).** K8 gives the shape `{ lastChoiceByModel: … }`. That is still exactly the value of `routing:launch-preferences` (`routingLaunchPreferencesSchema`), but the file on disk carries `"version": 1` beside `lastChoiceByModel`, for parity with the other routing store files (`ROUTING_STORE_VERSION`, MR-D20's strict envelopes). The version never crosses IPC.

**K13 in one paragraph.** MR-D4 requires every launch that sends `:nitro` to declare that id's effort variants. A routed Nitro launch does so through `buildOpenCodeRoutingContent`. An unrouted launch of a `:nitro` model picked directly (the dialog's model list, a profile's model) does so through `unroutedNitroVariantsContent`: only `variants`, never `options.provider` (no tier was chosen), only with an effort, only on the OpenRouter gateway, never persisted. Task 4a-3 wires it into SessionLaunch and SessionRelaunch; MR-D25 then keeps OpenCode's remembered variant for that `:nitro` key in step, as for any other effort.

## `routingStore.ts`

The two private helpers are generalised so the preferences file (which belongs to no model) reuses the same atomic, durable write and the same warn-once rule. Existing behaviour and messages are identical.

```ts
// imports: add
import { LAUNCH_PREFERENCES_CAP_BYTES, LAUNCH_PREFERENCES_FILE, emptyLaunchPreferences, launchPreferencesFileText, launchPreferencesWarning, parseLaunchPreferencesFile } from '../routing/launchCore'
import type { RoutingLaunchPreferences } from '../../shared/routing' // added to the existing type import (:4)

// header (:27–61), one paragraph after the file list:
//   launch-preferences.json (at the root, no model directory): the remembered last tier choice per model (K8).

// after writeAccount (:132–135)
/** K8: the remembered choice per model. Missing, corrupt or oversize reads as empty, with one warning per path. */
readLaunchPreferences(): RoutingLaunchPreferences {
  const path = join(this.rootDir, LAUNCH_PREFERENCES_FILE)
  const read = this.readText(path, LAUNCH_PREFERENCES_CAP_BYTES, launchPreferencesWarning)
  if (read.warning !== null) {
    this.warnOnce(path, read.warning)
    return emptyLaunchPreferences()
  }
  const parsed = parseLaunchPreferencesFile(read.text)
  if (parsed.warning !== null) this.warnOnce(path, parsed.warning)
  return parsed.value
}

writeLaunchPreferences(prefs: RoutingLaunchPreferences): void {
  this.save(join(this.rootDir, LAUNCH_PREFERENCES_FILE), () => launchPreferencesFileText(prefs), 'routing store: could not write the launch preferences file')
}

// readText (:151–165): (kind, model, path) → (path, cap, warning)
private readText(path: string, cap: number, warning: (problem: 'size' | 'read') => string): { text: string | null; warning: string | null }
//   body unchanged except: storeWarning(kind, model, X) → warning(X); STORE_FILE_CAP_BYTES → cap

// load (:167–176): signature unchanged; its first line becomes
const read = this.readText(path, STORE_FILE_CAP_BYTES, (problem) => storeWarning(kind, model, problem))

// save (:183–207): (kind, model, target, text) → (target, text, failure); the thrown message is `failure`.
// The four per-model write methods pass `routing store: could not write the ${kind} file for ${model}`.
```

The preferences file is not under a model directory, so `modelDir`'s registry check does not apply to it; which slugs it may hold is the service's rule (C7).

## `routingService.ts`

```ts
// imports from '../../shared/routing', added to the existing list (:4–32)
routingLaunchChoiceSchema, routingLaunchRequestSchema, routingLaunchSelectionSchema, routingModelSlugSchema,
type RoutingLaunchChoice, type RoutingLaunchPreferences, type RoutingLaunchRequest, type RoutingLaunchSelection, type RoutingProfileId
// and
import { resolveLaunchSelection } from '../routing/launchCore'

// RoutingStoreLike (:112–115) gains
| 'readLaunchPreferences' | 'writeLaunchPreferences'

/** K4: a launch is ranked as an interactive session. */
const LAUNCH_PROFILE: RoutingProfileId = 'interactive'
```

**`tiers()`** (:341–365) becomes, with identical reads in identical order (snapshot, account, observations, cache, settings, clock):

```ts
tiers(request: RoutingTiersRequest): TierResult {
  try {
    const q = this.parseInput(routingTiersRequestSchema, request)
    const entry = this.registryEntry(q.model)
    this.assertLive()
    const stored = this.storedRankInputs(q.model, q.credentialProfileId)
    if (stored === null) throw routingError('NO_SNAPSHOT', MESSAGES.noSnapshot)
    return this.rank({ model: entry, ...stored, profile: q.profile, effort: q.effort, settings: this.readSettings(), now: this.now() })
  } catch (err) {
    throw this.unexpected('tiers', err)
  }
}
```

**New public methods** (after `tiers()`):

```ts
/**
 * Phase 4a (K2, K4, MR-D26, C2): the selection one launch uses — routing:tiers' computation for the launch's own
 * credential, profile 'interactive' and effort. No network, no decrypt, no credential row. Nitro reads no store file.
 */
resolveLaunch(request: RoutingLaunchRequest): RoutingLaunchSelection {
  try {
    const q = this.parseInput(routingLaunchRequestSchema, request)
    const entry = this.registryEntry(q.model)
    this.assertLive()
    const settings = this.readSettings()
    const now = this.now() // the one clock read; the selection's computedAt
    let result: TierResult | null = null
    if (q.tier !== 'nitro') {
      const stored = this.storedRankInputs(q.model, q.credentialProfileId)
      if (stored !== null) result = this.rank({ model: entry, ...stored, profile: LAUNCH_PROFILE, effort: q.effort, settings, now })
    }
    const resolved = resolveLaunchSelection({ tier: q.tier, model: q.model, result, settings, computedAt: now })
    if (!resolved.ok) throw routingError(resolved.code, resolved.message)
    return routingLaunchSelectionSchema.parse(resolved.selection) // a failure here is the service's own: OPERATION_FAILED
  } catch (err) {
    throw this.unexpected('resolveLaunch', err)
  }
}

/** Phase 4a (K8): the remembered last choice per model. Read-only; answers after dispose(), like credentials(). */
launchPreferences(): RoutingLaunchPreferences {
  try {
    return this.store.readLaunchPreferences()
  } catch (err) {
    throw this.unexpected('launchPreferences', err)
  }
}

/**
 * Phase 4a (K8, MR-D28, C7): remember what an eligible launch used, after it started. NEVER throws. Records only a
 * registry slug and a valid choice; an unchanged value writes nothing. Works after dispose() (no network involved).
 */
recordLaunchChoice(model: string, choice: RoutingLaunchChoice): void {
  try {
    const m = routingModelSlugSchema.safeParse(model)
    const c = routingLaunchChoiceSchema.safeParse(choice)
    if (!m.success || !c.success || findModel(bundledModelRegistry(), m.data) === null) {
      this.log.warn('launch choice not recorded: not a registry model or not a launch choice')
      return
    }
    const current = this.store.readLaunchPreferences()
    if (current.lastChoiceByModel[m.data] === c.data) return
    this.store.writeLaunchPreferences({ lastChoiceByModel: { ...current.lastChoiceByModel, [m.data]: c.data } })
  } catch (err) {
    try {
      this.log.error('recordLaunchChoice failed', err)
    } catch {
      // Not even a failing logger may undo a launch that already started.
    }
  }
}
```

**Helper** (after `registryEntry`, :853–857):

```ts
/**
 * The stored inputs tiers() and resolveLaunch() rank, read in exactly this order: snapshot, the account file
 * (only for a credential), observations, cache. Null when no snapshot is stored. Never reads a credential row.
 */
private storedRankInputs(model: string, credentialProfileId: string | null): Pick<RankInput, 'snapshot' | 'account' | 'history' | 'cache'> | null {
  const snapshot = this.store.readSnapshot(model)
  if (snapshot === null) return null
  const stored = credentialProfileId === null ? null : this.store.readAccount(model, credentialProfileId)
  const account: AccountEligibility = stored ?? { guardrailRemoved: null, dataPolicyRemoved: null, checkedAt: null }
  return { snapshot, account, history: this.store.readObservations(model), cache: this.store.readCache(model) }
}
```

Rules (normative):

- **Order (C2).** Parse (`INVALID_REQUEST`), registry (`UNKNOWN_MODEL`, which also catches a `:nitro` model: the registry holds base slugs only), `assertLive` (`OPERATION_FAILED` "Routing has stopped."), settings, one clock read, then for a ranked tier the stored inputs and `rank` (`INVALID_TIME` when the snapshot is newer than the clock), then `resolveLaunchSelection`'s refusal, then the output parse.
- **Free.** No `getCredentialProfileById`, `getProviderConfigById`, decrypt, request or event. Whether the credential may route is the launch handler's check (`planRoutingLaunch` over `credentials()`, Task 4a-3); `resolveLaunch` uses the id only to read that credential's account file (MR-D20).
- **Nitro (C3).** No `readSnapshot`, `readAccount`, `readObservations` or `readCache` call; ok with no snapshot, a stale one, or one newer than the clock.
- **Never refreshes (MR-D26).** A launch never triggers a refresh; the cooldown (MR-D22) is irrelevant here.

## `routingIpc.ts`

```ts
// header (:24–27): "Ten request channels and one broadcast"
// imports (:4–19): add routingLaunchPreferencesSchema
// RoutingIpcDeps.service (:49–52): add 'launchPreferences' to the Pick
// after the credentials line (:112)
handle(ROUTING_CHANNELS.launchPreferences, routingEmptyRequestSchema, routingLaunchPreferencesSchema, () => service.launchPreferences())
```

The envelope (`routingIpc.ts:68–101`) is unchanged and applies to the new channel. `resolveLaunch` and `recordLaunchChoice` get no channel: they are main-only (K2, K8).

## Preload (`src/preload/index.ts`)

After `credentials: input => ipcRenderer.invoke('routing:credentials', input),` (:170):

```ts
    launchPreferences: input => ipcRenderer.invoke('routing:launch-preferences', input),
```

A literal channel string, no import change, no Zod. CRLF in the working tree: keep the new line CRLF, check `git diff --stat src/preload/index.ts` reports `1 insertion(+)`, and check `git ls-files --eol src/preload/index.ts` still reports `w/crlf`.

## `scripts/verify-routing-ipc.mjs`

- Header (:3): "(ImplementationSpec-2-4, D1-D17; ImplementationSpec-3-1, D18; ImplementationSpec-4a-1, D19)"; one sentence: "routing:launch-preferences is empty in the throwaway profile and refuses an extra key".
- Freshness (:106–108): also require `out/preload/index.js` to contain `routing:launch-preferences`, detail `out/preload/index.js has no routing:launch-preferences`.
- `CHECKS` (:65–71): add `'D19 launch preferences empty'` after `'D18 credentials empty'`, before `'cleanup'`.
- After D18 (:401–407), before the D13 negative control, so D14's zero-request check covers it:

```js
const d19 = await page(`
  const prefs = await routing.launchPreferences({})
  const extra = await routing.launchPreferences({ extra: 1 })
  return { prefs, extra }`)
record('D19 launch preferences empty', first(okValue(d19?.prefs, { lastChoiceByModel: {} }), refused(d19?.extra, 'INVALID_REQUEST')))
```

The last line becomes `PASS (20 checks)`.

## Test cases

Key-shaped strings are built by concatenation, as the existing files do. Shared literals:

- `SLUG = 'deepseek/deepseek-v4.1-flash'`; `C = '5f0c1a2e-8a3b-4c5d-9e6f-0123456789ab'`; `D = '0b6d2c4e-1f3a-4b5c-8d7e-9f0a1b2c3d4e'`; `AT = '2026-10-02T09:20:00Z'`; `FETCHED = '2026-10-02T09:05:00Z'`.
- `PROVIDER(order) = { order, allow_fallbacks: false, require_parameters: true, quantizations: ['fp8'], data_collection: 'deny' }`.
- `BUDGET = ['deepinfra/fp8', 'streamlake/fp8', 'gmicloud/fp8']`, `BALANCED = ['deepinfra/fp8', 'streamlake/fp8', 'makora/fp8']`, `FAST = ['venice/fp8', 'baidu/fp8', 'parasail/fp8']`.
- `BALANCED_SELECTION = { tier: 'balanced', model: SLUG, sentModelId: SLUG, provider: PROVIDER(BALANCED), endpoints: BALANCED, computedAt: AT, snapshotFetchedAt: FETCHED }`.
- `NITRO_SELECTION = { tier: 'nitro', model: SLUG, sentModelId: SLUG + ':nitro', provider: { data_collection: 'deny' }, endpoints: [], computedAt: AT, snapshotFetchedAt: null }`.
- The **golden result** `golden(over)` is `routingIpc.test.ts`'s recipe (:55–76): the fixture's rows and `fetchedAt` (`FETCHED`), history `extractObservations(snapshot)`, account from the fixture's `guardrailRemoved`/`dataPolicyDenyRemoved` with `checkedAt '2026-10-02T09:15:39Z'`, cache from `cacheVerified` with the same `checkedAt`, profile `interactive`, effort `'low'`, `DEFAULT_ROUTING_SETTINGS`, now `AT`; `over` replaces fields.

Every expected value below was computed on 2026-10-03 by bundling the cores at `a57ef1b` with esbuild in a scratch directory and running this specification's functions as a scratch prototype (not committed), the way the Phase 3 kickoff computed its golden view values.

**Table S7 — `src/shared/routing.test.ts`** (with S4-1 and S5-1 amended).

| # | Case | Expect |
|---|---|---|
| S4-1 (amended) | `ROUTING_ERROR_CODES` | Twelve codes (was ten); each passes `routingErrorCodeSchema`; `'NOPE'` fails. |
| S5-1 (amended) | `Object.values(ROUTING_CHANNELS)` | Eleven unique values (was ten), each starting with `routing:`. |
| S7-1 | `ROUTING_NITRO_SUFFIX`; `ROUTING_LAUNCH_TIERS`; `ROUTING_LAUNCH_CHOICES`; `ROUTING_CHANNELS.launchPreferences` | `':nitro'`; equal to `ROUTING_TIERS` (`['budget', 'balanced', 'fast', 'nitro']`); `['budget', 'balanced', 'fast', 'nitro', 'default']`; `'routing:launch-preferences'`. |
| S7-2 | `routingBaseModelId` on `SLUG + ':nitro'`, `SLUG`, `SLUG + ':nitro:nitro'`, `':nitro'`, `SLUG + ':Nitro'`, `SLUG + ':nitrox'` | `SLUG`, `SLUG`, `SLUG + ':nitro'`, `''`, `SLUG + ':Nitro'`, `SLUG + ':nitrox'`. |
| S7-3 | `routingLaunchTierSchema` on `'nitro'`, `'default'`; `routingLaunchChoiceSchema` on `'default'`, `'turbo'` | Pass, fail; pass, fail. |
| S7-4 | `routingLaunchRequestSchema` on `{ model: SLUG, tier: 'balanced', effort: 'low', credentialProfileId: C }`; with `effort: null`; `credentialProfileId: null`; `credentialProfileId: 'x'`; `tier: 'default'`; `effort: 'LOW'`; an extra key | Pass, pass, fail, fail, fail, fail, fail. |
| S7-5 | `routingLaunchSelectionSchema` on `BALANCED_SELECTION` and `NITRO_SELECTION`; on `NITRO_SELECTION` with `provider: null` | Each passes and parses back strictly equal; `JSON.parse(JSON.stringify(x))` strictly equals `x`. |
| S7-6 | `routingLaunchSelectionSchema` on: Nitro with `sentModelId: SLUG`; Balanced with `sentModelId: SLUG + ':nitro'`; Balanced with `provider: null`; Balanced with `snapshotFetchedAt: null`; Balanced with `endpoints` reversed; Nitro with `endpoints: ['together']`; Nitro with `snapshotFetchedAt: AT`; Nitro with `model: SLUG + ':nitro'`, `sentModelId: SLUG + ':nitro:nitro'`; Balanced plus `extra: 1`; Balanced with `computedAt: '2026-10-02 09:20'`; Balanced whose provider has `sort: 'price'` | All eleven fail. |
| S7-7 | `routingLaunchPreferencesSchema` on `{ lastChoiceByModel: {} }`; `{ lastChoiceByModel: { [SLUG]: 'default' } }`; choice `'turbo'`; key `'bad key'`; an extra top-level key | Pass, pass, fail (1 issue), fail (1 issue), fail. |

**Table L — `src/main/routing/launchCore.test.ts`.**

| # | Case | Expect |
|---|---|---|
| L1 | `resolveLaunchSelection({ tier: 'balanced', model: SLUG, result: golden(), settings: DEFAULT_ROUTING_SETTINGS, computedAt: AT })` | `{ ok: true, selection: BALANCED_SELECTION }` (strict). |
| L2 | Budget; Fast | Budget: `endpoints BUDGET`, `provider PROVIDER(BUDGET)`; Fast: `endpoints FAST`, `provider PROVIDER(FAST)`; both `sentModelId SLUG`, `computedAt AT`, `snapshotFetchedAt FETCHED`. |
| L3 | Nitro with `result` = `golden()`, `null`, and `golden({ now: '2026-10-02T10:05:00.001Z' })`; Nitro under `{ ...DEFAULT_ROUTING_SETTINGS, dataCollection: 'allow' }` | The first three strictly equal `{ ok: true, selection: NITRO_SELECTION }`; the last equals it with `provider: null`. |
| L4 | `result: null`; `golden({ now: '2026-10-02T10:05:00.001Z' })` (age 60, stale); `golden({ now: '2026-10-02T10:05:00Z' })` (age 60, not stale); `{ ...golden(), model: 'other/model' }`; `golden({ settings: S30, now: '2026-10-02T09:35:00.001Z' })` with `S30 = { ...DEFAULT_ROUTING_SETTINGS, snapshotMaxAgeMinutes: 30 }` and the same `settings` | `{ ok: false, code: 'NO_SNAPSHOT', message: 'No endpoint snapshot is stored for this model yet. Refresh first.' }`; `{ ok: false, code: 'SNAPSHOT_STALE', message: 'The endpoint snapshot for this model is more than 60 minutes old. Refresh first.' }`; ok with `endpoints BALANCED`; `{ ok: false, code: 'OPERATION_FAILED', message: 'Routing operation failed.' }`; `SNAPSHOT_STALE` with `… more than 30 minutes old. Refresh first.`. |
| L5 | `F = { ...DEFAULT_ROUTING_SETTINGS, budgetMinTps: 100000 }`: Budget and Balanced on `golden({ settings: F })`; `U = { ...DEFAULT_ROUTING_SETTINGS, minUptimePct: 100, readmitUptimePct: 100 }`: Balanced and Fast on `golden({ settings: U })`; Budget on `golden({ settings: F, now: '2026-10-02T10:05:00.001Z' })` | Budget `{ ok: false, code: 'TIER_EMPTY', message: 'Budget has no eligible endpoints. Choose another tier or OpenRouter default.' }`, Balanced ok `BALANCED`; `Balanced has no eligible endpoints. Choose another tier or OpenRouter default.` and `Fast has no eligible endpoints. Choose another tier or OpenRouter default.` (both `TIER_EMPTY`); `SNAPSHOT_STALE` (stale is checked first). |
| L6 | Push `'x'` onto L1's `selection.provider.order` and `selection.endpoints`; resolve again on a deep-frozen `structuredClone(golden())` | The result's `tiers.balanced.provider.order` and `endpoints` are still `BALANCED`; the frozen input yields `BALANCED_SELECTION` without throwing. |
| L7 | Every `ok` selection from L1–L3 | `routingLaunchSelectionSchema.parse(s)` strictly equals `s`; the JSON round trip strictly equals `s`. |
| L8 | `buildOpenCodeRoutingContent` on `BALANCED_SELECTION` with `['low','medium','high']`; `NITRO_SELECTION` with `['low','medium','high']`; with `[]`; Nitro-allow (`provider: null`) with `['low']`; with `[]`; `NITRO_SELECTION` with `['high','HIGH','high','x y','low']` | Exactly: `{"provider":{"openrouter":{"models":{"deepseek/deepseek-v4.1-flash":{"options":{"provider":{"order":["deepinfra/fp8","streamlake/fp8","makora/fp8"],"allow_fallbacks":false,"require_parameters":true,"quantizations":["fp8"],"data_collection":"deny"}}}}}}}` (253 characters); `{"provider":{"openrouter":{"models":{"deepseek/deepseek-v4.1-flash:nitro":{"options":{"provider":{"data_collection":"deny"}},"variants":{"low":{"reasoning":{"effort":"low"}},"medium":{"reasoning":{"effort":"medium"}},"high":{"reasoning":{"effort":"high"}}}}}}}}` (261); `{"provider":{"openrouter":{"models":{"deepseek/deepseek-v4.1-flash:nitro":{"options":{"provider":{"data_collection":"deny"}}}}}}}`; `{"provider":{"openrouter":{"models":{"deepseek/deepseek-v4.1-flash:nitro":{"variants":{"low":{"reasoning":{"effort":"low"}}}}}}}}`; `{"provider":{"openrouter":{"models":{"deepseek/deepseek-v4.1-flash:nitro":{}}}}}`; `{"provider":{"openrouter":{"models":{"deepseek/deepseek-v4.1-flash:nitro":{"options":{"provider":{"data_collection":"deny"}},"variants":{"high":{"reasoning":{"effort":"high"}},"low":{"reasoning":{"effort":"low"}}}}}}}}`. |
| L9 | `BALANCED_SELECTION` with `[]` | Identical to L8's first string (ranked tiers never declare variants). |
| L10 | `routingVariantEfforts` on `(['low','medium','high'], 'low')`, `(null, 'high')`, `([], 'high')`, `(null, null)`, `(['high','HIGH','high','x y','low'], null)`, `(['HIGH'], 'low')`, `(null, 'LOW')` | `['low','medium','high']`, `['high']`, `['high']`, `[]`, `['high','low']`, `['low']`, `[]`. |
| L11 | `planRoutingLaunch` from `BASE = { agent: 'opencode', tier: 'balanced', credentialProfileId: C, model: SLUG, routingAvailable: true, routingCredentialIds: [C], registrySlugs: [SLUG], profileEnvKeys: [] }`, each row changing one field; every refused row repeated with `tier: null` | `BASE` → `{ kind: 'routed', model: SLUG, tier: 'balanced', credentialProfileId: C }`; `tier: 'nitro'` → routed with `tier: 'nitro'`; `tier: null` → `{ kind: 'default', model: SLUG }`; `agent: 'claude'` → refused `notOpencode`; `routingAvailable: false` → `unavailable`; `credentialProfileId: null` → `noCredential`; `D` → `credentialRefused`; `model: null` → `noModel`; `model: SLUG + ':nitro'` (also in `registrySlugs`) → `nitroModel`; `model: 'z-ai/glm-5.3'` → `unknownModel`; `profileEnvKeys: ['OPENCODE_CONFIG_CONTENT']` and `['opencode_config_content']` → `profileEnv`. Each refused row with `tier: null` → `{ kind: 'unrouted' }`, the two `profileEnv` rows included (a K7-blocked launch is not routing-eligible and records nothing, C8). `{ agent: 'claude', routingAvailable: false, credentialProfileId: null }` → `notOpencode`; `{ routingAvailable: false, credentialProfileId: null }` → `unavailable` (first failure wins). Reasons are the exact `ROUTING_LAUNCH_REFUSALS` texts. |
| L12 | `planRoutingRelaunch` from `RBASE = { agent: 'opencode', routingJson: JSON.stringify(BALANCED_SELECTION), credentialProfileId: C, routingAvailable: true, routingCredentialIds: [C], profileEnvKeys: [] }`; `parseStoredRoutingSelection` alone | `RBASE` → `{ kind: 'routed', selection: BALANCED_SELECTION }`; `routingJson: null` (even with `agent: 'claude'`, `routingAvailable: false`) → `{ kind: 'unrouted' }`; `''`, `'not json'`, Balanced plus `extra: 1`, Balanced with `sentModelId: SLUG + ':nitro'` → `storedInvalid`; `agent: 'codex'` → `notOpencode`; `routingAvailable: false` → `relaunchUnavailable`; `credentialProfileId: null` and `D` → `relaunchCredential`; `profileEnvKeys: ['OPENCODE_CONFIG_CONTENT']` → `profileEnv`. `parseStoredRoutingSelection(null)` → `{ kind: 'none' }`; of the Nitro JSON → `{ kind: 'selection', selection: NITRO_SELECTION }`. |
| L13 | `checkRoutedRoute(x, 'OR key', 'https://openrouter.ai/api/v1')` for `'https://openrouter.ai/api/v1/'`, `null`, `'https://proxy.invalid/v1'` | `{ ok: true }`; `{ ok: false, reason: 'Routing needs a credential for the OpenRouter gateway.' }`; `{ ok: false, reason: "Credential profile 'OR key' points at a different base URL; routing only calls the OpenRouter gateway." }`. |
| L14 | `launchPreferencesFileText` on `{ lastChoiceByModel: { [SLUG]: 'balanced', 'a/b': 'nitro' } }`; on `emptyLaunchPreferences()`; on choice `'turbo'` | `{"version":1,"lastChoiceByModel":{"a/b":"nitro","deepseek/deepseek-v4.1-flash":"balanced"}}`; `{"version":1,"lastChoiceByModel":{}}`; throws. |
| L15 | `parseLaunchPreferencesFile` on `null`; `'garbage'`; `'{"lastChoiceByModel":{}}'`; `'{"version":2,"lastChoiceByModel":{}}'`; `'{"version":1,"lastChoiceByModel":{"deepseek/deepseek-v4.1-flash":"turbo"}}'`; `'{"version":1,"lastChoiceByModel":{},"x":1}'`; L14's first text | `{ value: { lastChoiceByModel: {} }, warning: null }`; empty with `launch preferences file is not valid JSON; reading it as empty`; empty with `launch preferences file does not match its schema; reading it as empty` (this and the next three); `{ value: { lastChoiceByModel: { 'a/b': 'nitro', [SLUG]: 'balanced' } }, warning: null }`. |
| L16 | `LAUNCH_TIER_LABELS`; `emptyTierMessage('fast')`; `staleSnapshotMessage(60)`; `launchPreferencesWarning('size')`, `('read')`; `LAUNCH_PREFERENCES_FILE`; `LAUNCH_PREFERENCES_CAP_BYTES` | `{ budget: 'Budget', balanced: 'Balanced', fast: 'Fast', nitro: 'Nitro' }`; `Fast has no eligible endpoints. Choose another tier or OpenRouter default.`; `The endpoint snapshot for this model is more than 60 minutes old. Refresh first.`; `launch preferences file exceeds 65536 bytes; reading it as empty`, `launch preferences file could not be read; reading it as empty`; `'launch-preferences.json'`; `65536`. |
| L17 | K13: `buildOpenCodeNitroVariantsContent` on `(SLUG + ':nitro', ['low','medium','high'])`; `(SLUG + ':nitro', ['low'])`; `(SLUG + ':nitro', [])`; `(SLUG, ['low'])`; `(SLUG + ':nitro', ['high','HIGH','high','x y','low'])`; `('z-ai/glm-5.3:nitro', ['high'])` | Exactly `{"provider":{"openrouter":{"models":{"deepseek/deepseek-v4.1-flash:nitro":{"variants":{"low":{"reasoning":{"effort":"low"}},"medium":{"reasoning":{"effort":"medium"}},"high":{"reasoning":{"effort":"high"}}}}}}}}` (211 characters); `{"provider":{"openrouter":{"models":{"deepseek/deepseek-v4.1-flash:nitro":{"variants":{"low":{"reasoning":{"effort":"low"}}}}}}}}` (129); `null`; `null`; `{"provider":{"openrouter":{"models":{"deepseek/deepseek-v4.1-flash:nitro":{"variants":{"high":{"reasoning":{"effort":"high"}},"low":{"reasoning":{"effort":"low"}}}}}}}}`; `{"provider":{"openrouter":{"models":{"z-ai/glm-5.3:nitro":{"variants":{"high":{"reasoning":{"effort":"high"}}}}}}}}`. No result contains `options` or `data_collection`. |
| L18 | K13: `unroutedNitroVariantsContent` from `NBASE = { agent: 'opencode', baseUrl: 'https://openrouter.ai/api/v1', gatewayBaseUrl: 'https://openrouter.ai/api/v1', sentModelId: SLUG + ':nitro', launchEffort: 'low', catalogEfforts: ['low','medium','high'], profileEnvKeys: [] }`, each row changing one field | `NBASE` → L17's first string; `catalogEfforts: null` → L17's second string (the launch's own effort); `{ catalogEfforts: ['high','xhigh'], launchEffort: 'high' }` → `{"provider":{"openrouter":{"models":{"deepseek/deepseek-v4.1-flash:nitro":{"variants":{"high":{"reasoning":{"effort":"high"}},"xhigh":{"reasoning":{"effort":"xhigh"}}}}}}}}`; `baseUrl: 'https://openrouter.ai/api/v1/'` → L17's first string; `null` for each of: `launchEffort: null`, `launchEffort: 'LOW'`, `agent: 'claude'`, `baseUrl: 'https://proxy.invalid/v1'`, `baseUrl: null`, `sentModelId: SLUG`, `sentModelId: null`, `profileEnvKeys: ['opencode_config_content']`. |

**Table F2 — `src/main/services/routingStore.test.ts`** (same `root`, `warn` and `store` as Table F).

| # | Case | Expect |
|---|---|---|
| F13 | Fresh store: `readLaunchPreferences()` twice | `{ lastChoiceByModel: {} }` both times; no warning; `readdirSync(root)` `[]`. |
| F14 | `writeLaunchPreferences({ lastChoiceByModel: { [M]: 'balanced' } })`; read; a second `RoutingStore` on `root` reads | File `<root>/launch-preferences.json` with text exactly `{"version":1,"lastChoiceByModel":{"deepseek/deepseek-v4.1-flash":"balanced"}}`; `filesUnder(root)` `['launch-preferences.json']` (no `.tmp`); both reads strictly equal the written value; no warning. |
| F15 | Write `{ 'z/z': 'fast', 'a/b': 'nitro' }` | Text exactly `{"version":1,"lastChoiceByModel":{"a/b":"nitro","z/z":"fast"}}`. |
| F16 | The file is `garbage`; read twice. Then `{"version":1,"lastChoiceByModel":{"deepseek/deepseek-v4.1-flash":"turbo"}}`, `{"lastChoiceByModel":{}}` and `{"version":2,"lastChoiceByModel":{}}`, each in a fresh store | Empty each time; `garbage` warns once with `launch preferences file is not valid JSON; reading it as empty` and is left byte-identical; each other file warns once with `launch preferences file does not match its schema; reading it as empty`; no warning contains `root`. |
| F17 | Corrupt, read (1 warning), write a valid value, read, corrupt again, read | 2 warnings in total: a successful write clears the path's warning. |
| F18 | A valid file truncated to 65,537 bytes (`truncateSync`) | Empty; one warning `launch preferences file exceeds 65536 bytes; reading it as empty`. |
| F19 | Write `{ lastChoiceByModel: { [M]: 'turbo' } }` (cast); then a directory at `<root>/launch-preferences.json` and a valid write | Both throw `Error('routing store: could not write the launch preferences file')` with no `cause`; nothing written for the first; for the second the directory is untouched and no `.tmp` file is left. |

**Harness amendment — `routingService.test.ts`** (a fixture): `storeWith` (:384–396) gains `readLaunchPreferences: () => real.readLaunchPreferences(), writeLaunchPreferences: (p) => real.writeLaunchPreferences(p)` before `...over`. Run the whole file after this change and after the `tiers()` extraction, before writing V43: every existing test must pass unchanged.

**Table V4 — `routingService.test.ts`.** `NOW = '2026-10-02T09:20:00Z'`; "after a refresh" means `await h.refresh()` at `NOW` (45 requests, 18 events, `decrypts [C]`). `launch(h, over)` calls `h.service.resolveLaunch({ model: SLUG, tier: 'balanced', effort: 'low', credentialProfileId: C, ...over })` and pushes the value to `h.results`, so the V19 audit covers it. `spy(real)` is `storeWith(real, {…})` with `vi.fn` wrappers that delegate.

| # | Case | Expect |
|---|---|---|
| V43 | After a refresh; clear the credential-read mocks; `launch(h)` | Strictly `{ tier: 'balanced', model: SLUG, sentModelId: SLUG, provider: PROVIDER(GOLDEN_TIERS.interactive.balanced), endpoints: GOLDEN_TIERS.interactive.balanced, computedAt: NOW, snapshotFetchedAt: NOW }`. `h.requests` still 45, `h.events` still 18, `h.decrypts` `[C]`; `getCredentialProfileById` and `getProviderConfigById` not called; `routingLaunchSelectionSchema.parse(v)` strictly equals `v`. |
| V44 | After a refresh: `launch(h, { tier: 'budget' })`, `{ tier: 'fast' }` | `endpoints` `GOLDEN_TIERS.interactive.budget` / `.fast`; each `provider` strictly equals `h.tiers().tiers[t].provider` (the routing:tiers computation, K2) and `PROVIDER(endpoints)`. |
| V45 | After a refresh: `h.tiers({ profile: 'helper' }).tiers.balanced?.endpoints`; `launch(h)`; `launch(h, { effort: null })` | `['streamlake/fp8', 'venice/fp8', 'gmicloud/fp8']`; `BALANCED` (a launch ranks `interactive`, K4); `BALANCED` (this fixture gives the same order for `null`). |
| V46 | Fresh harness: `launch` for `budget`, `balanced`, `fast` | Each `NO_SNAPSHOT`, message `No endpoint snapshot is stored for this model yet. Refresh first.`, equal to `h.throws(() => h.tiers()).message`; no credential read, no decrypt, no request. |
| V47 | After a refresh: `h.clock.now = '2026-10-02T10:20:00Z'`, `launch(h)`; `'2026-10-02T10:20:00.001Z'`, `launch(h)` and `launch(h, { tier: 'nitro' })` | Ok with `computedAt '2026-10-02T10:20:00Z'`, `snapshotFetchedAt NOW`, `endpoints BALANCED`; `SNAPSHOT_STALE`, `The endpoint snapshot for this model is more than 60 minutes old. Refresh first.`; Nitro ok with `computedAt '2026-10-02T10:20:00.001Z'`. |
| V48 | After a refresh, `h.state.settings = { ...DEFAULT_ROUTING_SETTINGS, budgetMinTps: 100000 }`: Budget, Balanced; then `{ ...DEFAULT_ROUTING_SETTINGS, minUptimePct: 100, readmitUptimePct: 100 }`: Balanced, Fast; then `budgetMinTps: 100000` at `'2026-10-02T10:20:00.001Z'`: Budget | `TIER_EMPTY` `Budget has no eligible endpoints. Choose another tier or OpenRouter default.`; ok `BALANCED`; `TIER_EMPTY` with the Balanced and Fast texts; `SNAPSHOT_STALE`. |
| V49 | Fresh harness with `spy` on the four reads: `launch(h, { tier: 'nitro' })`; then `dataCollection: 'allow'`; then a second harness: a refresh, `h.clock.now = '2026-10-02T09:00:00Z'`, Balanced and Nitro | `{ tier: 'nitro', model: SLUG, sentModelId: SLUG + ':nitro', provider: { data_collection: 'deny' }, endpoints: [], computedAt: NOW, snapshotFetchedAt: null }`; `readSnapshot`, `readAccount`, `readObservations`, `readCache` not called; `provider: null` under allow; Balanced `INVALID_TIME`, `The stored snapshot is newer than the current time; refresh again.`, `log.error` not called; Nitro ok, `computedAt '2026-10-02T09:00:00Z'`. |
| V50 | `spy` harness, after a refresh, clear the spies: `launch(h)`; `launch(h, { credentialProfileId: UNKNOWN_ID })` | `readAccount` called with `(SLUG, C)`, then `(SLUG, UNKNOWN_ID)`; the second selection's `endpoints` `BALANCED` (the unknown account yields the same order here); `getCredentialProfileById` never called. |
| V51 | `spy` harness, after a refresh, clear the spies: `model: 'other/model'`; `model: SLUG + ':nitro'`; `tier: 'turbo'`; an extra key; `credentialProfileId: null`; `credentialProfileId: 'x'`; `effort: 'LOW'` | `UNKNOWN_MODEL` `Model routing does not know this model.` (twice), then `INVALID_REQUEST` `Invalid routing request.` (five times); no spied read called. |
| V52 | After `dispose()`: Balanced, Nitro | Both `OPERATION_FAILED`, `Routing has stopped.`. |
| V53 | `storeWith(real, { readSnapshot: () => { throw boom } })`, `boom = new Error('disk')`: `launch(h)` | `OPERATION_FAILED`, `Routing operation failed.`; `log.error` once with `('resolveLaunch failed', boom)`. |
| V54 | `makeHarness({ now: counting })` where `counting` returns `NOW` and counts; after a refresh reset the count; `launch(h)`; reset; `launch(h, { tier: 'nitro' })` | The clock was read exactly once for each. |
| V55 | Fresh harness: `h.service.launchPreferences()` | `{ lastChoiceByModel: {} }`; `filesUnder(join(h.root, 'routing'))` `[]`. |
| V56 | `spy` on `writeLaunchPreferences`: `recordLaunchChoice(SLUG, 'balanced')`, `launchPreferences()`, `recordLaunchChoice(SLUG, 'default')`, `recordLaunchChoice(SLUG, 'default')`, `launchPreferences()` | The file `<root>/routing/launch-preferences.json` held `{"version":1,"lastChoiceByModel":{"deepseek/deepseek-v4.1-flash":"balanced"}}` after the first; reads `{ lastChoiceByModel: { [SLUG]: 'balanced' } }` then `{ lastChoiceByModel: { [SLUG]: 'default' } }`; `writeLaunchPreferences` called twice (the repeat writes nothing). |
| V57 | Harness A (real store): `recordLaunchChoice('other/model', 'balanced')`; `recordLaunchChoice(SLUG, 'turbo' as RoutingLaunchChoice)`; then `dispose()` and `recordLaunchChoice(SLUG, 'budget')`. Harness B (`storeWith(real, { writeLaunchPreferences: () => { throw boom } })`): `recordLaunchChoice(SLUG, 'fast')`; then `h.log.error.mockImplementation(() => { throw new Error('log down') })` and `recordLaunchChoice(SLUG, 'nitro')` | No call throws. A: `log.warn` twice with `launch choice not recorded: not a registry model or not a launch choice` and no file after the first two; after dispose the file reads `{ lastChoiceByModel: { [SLUG]: 'budget' } }`. B: `log.error` first called with `('recordLaunchChoice failed', boom)`; the second call returns normally although the logger throws. |
| V58 | `readLaunchPreferences` throwing `boom`: `launchPreferences()`; after `dispose()` with the real store: `launchPreferences()` | `OPERATION_FAILED`, `Routing operation failed.`, `log.error` with `('launchPreferences failed', boom)`; after dispose it answers `{ lastChoiceByModel: {} }`. |

**Table I amendments and I12 — `routingIpc.test.ts`.**

- `VALID['routing:launch-preferences'] = {}`; `WRONG_TYPE['routing:launch-preferences'] = []`; the `setup` fake gains `launchPreferences: vi.fn(() => ({ lastChoiceByModel: { [SLUG]: 'balanced' } }))`; `actions['routing:launch-preferences'] = service.launchPreferences`. With these, I2, I3, I5 and I6 run over ten channels.
- I1: title "ten request channels"; `expect(REQUEST_CHANNELS).toHaveLength(10)` (was 9; amendment).
- `happyPaths`: add `await run('routing:launch-preferences', {}, service.launchPreferences)` after the credentials call. I4: `expect(responses).toHaveLength(10)` (was 9; amendment); `expect(service.launchPreferences).toHaveBeenCalledWith()`; `service.launchPreferences` joins the called-once loop.

| # | Case | Expect |
|---|---|---|
| I12 | `launchPreferences` returns `{ lastChoiceByModel: { [SLUG]: 'turbo' } }` | `{ ok: false, code: 'OPERATION_FAILED', message: 'Routing operation failed.' }`; `log.warn` called once with `routing:launch-preferences produced an invalid response (1 issues)`; `log.error` not called. |

## Invariants

- `resolveLaunch` never decrypts, never reads a credential row, a blob or a fingerprint, never sends a request and never emits an event; its only time source is one `now()` read (MR-G4, MR-G8 for the pure part).
- A ranked selection's `provider` and `endpoints` are exactly `TierResult.tiers[tier]`'s for the launch's own credential and effort and profile `interactive` (K2, K4, K5); a Nitro selection never depends on the store (MR-D26).
- Every selection that leaves the service passes the strict selection schema, so whatever Task 4a-3 persists can be parsed back by relaunch (K10).
- Every content this core builds for a `:nitro` id with an effort declares that id's variants (MR-D4, K13): routed through `buildOpenCodeRoutingContent`, unrouted through `unroutedNitroVariantsContent`, which never carries `options.provider`.
- A launch whose profile env sets `OPENCODE_CONFIG_CONTENT` is never routing-eligible: refused with a tier, `'unrouted'` without one, so nothing is recorded (K7, C8).
- `recordLaunchChoice` never throws and never records a non-registry slug; the preferences file only ever holds what main wrote, written atomically (K8).
- The new channel is checked for its sender, parsed in and parsed out in main (MR-G5); the preload stays a Zod-free pass-through.
- `launchCore.ts` is pure; the purity and layering greps stay empty; no Phase 1–3 golden value changes; the ranker script passes.

## Verification

```powershell
npm run typecheck
npx vitest run src/shared/routing.test.ts src/main/routing/launchCore.test.ts src/main/services/routingService.test.ts src/main/services/routingStore.test.ts src/main/services/routingIpc.test.ts
npm test
Get-ChildItem -Path src/main/routing, src/shared/routing.ts -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern 'Date\.now\(|Math\.random\(|new Date\(\)|from ''(node:|fs''|path''|electron|better-sqlite3)|require\('
Get-ChildItem -Path src/main/routing -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern "from '\.\./(services|db|adapters)/"
node scripts/verify-routing-ranker.mjs
npx electron-vite build
node scripts/verify-routing-ipc.mjs
npm run grep:secrets
git diff --check
git diff --stat src/preload/index.ts
git ls-files --eol src/preload/index.ts
git status --short
```

Both `Select-String` lines must print nothing. The CDP drive is the runtime check (MR-G1, MR-G5): paste its full output and exit code; it must end `PASS (20 checks)`. It launches its own built app with a throwaway `--user-data-dir` and a free port, and stops only its own child by pid; never point it at `%APPDATA%\chorus*`, never at 9222, and never stop `electron.exe` or `Chorus.exe` by name (the installed Chorus is running). Dev never rebuilds MAIN on edit: run `npx electron-vite build` after the last main-process edit. Record the vitest summary, `git diff --stat src/preload/index.ts` (one insertion), and that every pre-existing Table V, V3 and F test passed before Tables V4 and F2 were written. MR-G2 does not apply yet: `buildOpenCodeRoutingContent` has no live caller until Task 4a-3, and Task 4a-2 makes `verify-routing-body.mjs` exercise it.
