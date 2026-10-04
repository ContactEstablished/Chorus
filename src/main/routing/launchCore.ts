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

/**
 * Model Routing Task 4a-1: launch routing (ImplementationSpec-4a-1; K2-K10, K13, C1-C9).
 *
 * The single authority for what a routing tier means at launch: the resolution of a
 * tier into the exact selection a session uses, OpenCode's per-process config
 * content (routed, and K13's unrouted `:nitro` variants), the launch and relaunch
 * planners, and the launch-preferences file's parse and text.
 *
 * Pure: no clock, no randomness, no environment, no file system, no network. Every
 * result is a fresh plain-JSON value that shares no array or object with its input.
 */

// ── Resolution (K2, K5, MR-D26) ──

export const LAUNCH_TIER_LABELS: Record<RoutingLaunchTier, string> = { budget: 'Budget', balanced: 'Balanced', fast: 'Fast', nitro: 'Nitro' }

/** Exact texts; `noSnapshot` and `failed` equal routingService.ts MESSAGES.noSnapshot and MESSAGES.failed. */
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

/** Exact refusal texts. `unknownModel` equals routingService.ts MESSAGES.unknownModel. */
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
