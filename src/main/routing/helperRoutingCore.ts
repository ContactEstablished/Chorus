import { routingBaseModelId, type OpenRouterProviderPrefs, type RoutingErrorCode, type RoutingLaunchSelection, type RoutingLaunchTier } from '../../shared/routing'
import { normalizeTeamModel } from '../../shared/teamProfiles'
import { LAUNCH_TIER_LABELS } from './launchCore'

/**
 * Model Routing Task 4b-1: Team helper routing (ImplementationSpec-4b-1; overview K3–K7, C1–C4).
 *
 * The pure rules main applies to a Team helper's routing tier: whether a helper can be
 * routed (K4), the exact refusal texts at team:launch and before each attempt (C1, C2),
 * the OpenCode model entry a routed helper declares (K7), and the note a routed
 * provider error carries (C3, K12). TeamService reaches them through teamRouting.ts.
 *
 * Pure: no clock, no randomness, no environment, no file system, no network. Every
 * result is a fresh plain-JSON value that shares no array or object with its input.
 */

// ── Eligibility (K4, C1, C4) ──

/** Exact texts (C1). `notOpencode` is also teamMemberSchema's refine message (shared/team.ts); HR7 pins the equality. */
export const HELPER_ROUTING_REFUSALS = {
  notOpencode: 'A routing tier applies only to an OpenCode helper on an OpenRouter API key.',
  unavailable: 'Model routing is not available right now. Launch this helper with OpenRouter default instead.',
  credentialRefused:
    "This helper's credential cannot be used for model routing. Routing needs an OpenRouter API-key credential for the OpenRouter gateway.",
  unknownModel: "Model routing does not know this helper's model."
} as const

export interface HelperRoutingFacts {
  readonly harness: string
  readonly authMode: string
  readonly tier: RoutingLaunchTier | null // the member's routingTier, or null (OpenRouter default)
  readonly credentialProfileId: string | null
  readonly model: string // member.model exactly as stored: an `openrouter/` prefix and a `:nitro` suffix are allowed
  readonly routingAvailable: boolean // false when the service is absent or one of its two lists could not be read
  readonly routingCredentialIds: readonly string[] // RoutingService.credentials() ids
  readonly registrySlugs: readonly string[] // RoutingService.models() slugs
}

export type HelperRoutingPlan =
  | { readonly kind: 'unrouted' }
  | { readonly kind: 'routed'; readonly model: string; readonly tier: RoutingLaunchTier; readonly credentialProfileId: string }
  | { readonly kind: 'refused'; readonly reason: string }

/**
 * K4 (C4). No tier → 'unrouted' (OpenRouter default: the member's model, unchanged). A tier: first failure wins, in the
 * order notOpencode, unavailable, credentialRefused, unknownModel. A routed plan's `model` is the BASE registry slug:
 * one `openrouter/` prefix and one `:nitro` suffix removed (K5, K6) — unlike 4a's launch planner, `:nitro` is eligible.
 */
export function planHelperRouting(f: HelperRoutingFacts): HelperRoutingPlan {
  if (f.tier === null) return { kind: 'unrouted' }
  const R = HELPER_ROUTING_REFUSALS
  if (f.harness !== 'opencode' || f.authMode !== 'api_key') return { kind: 'refused', reason: R.notOpencode }
  if (!f.routingAvailable) return { kind: 'refused', reason: R.unavailable }
  if (f.credentialProfileId === null || !f.routingCredentialIds.includes(f.credentialProfileId)) return { kind: 'refused', reason: R.credentialRefused }
  const model = routingBaseModelId(normalizeTeamModel(f.model))
  if (!f.registrySlugs.includes(model)) return { kind: 'refused', reason: R.unknownModel }
  return { kind: 'routed', model, tier: f.tier, credentialProfileId: f.credentialProfileId }
}

// ── Before each attempt (K8, C2) ──

/**
 * C2: why a routed helper attempt was refused, from main's own RoutingError (`code`, `message`). `model` is the base
 * slug. `maxAgeMinutes` is the settings' snapshotMaxAgeMinutes, read by the port only for SNAPSHOT_STALE; null (the
 * settings could not be read) falls back to the generic text, which carries main's own message.
 */
export function helperAttemptRefusal(
  tier: RoutingLaunchTier,
  model: string,
  code: RoutingErrorCode,
  message: string,
  maxAgeMinutes: number | null
): string {
  const label = LAUNCH_TIER_LABELS[tier]
  const refused = `${label} routing refused this helper attempt:`
  if (code === 'NO_SNAPSHOT') {
    return `${refused} no endpoint numbers are stored for ${model}. Refresh them in Settings → Model routing, then revise the task.`
  }
  if (code === 'SNAPSHOT_STALE' && maxAgeMinutes !== null) {
    return `${refused} the endpoint numbers for ${model} are more than ${maxAgeMinutes} minutes old. Refresh them in Settings → Model routing, or turn on background observation there to keep them fresh, then revise the task.`
  }
  if (code === 'TIER_EMPTY') {
    return `${refused} no endpoint for ${model} meets the ${label} rules right now. Revise the task to a helper on another tier, or refresh later.`
  }
  return `${label} routing could not be resolved for this helper attempt: ${message}`
}

// ── The helper's OpenCode model entry (K6, K7) ──

/**
 * K7: the `provider.openrouter.models[sentModelId]` entry a routed helper declares: `{ options: { provider }, ...measured }`
 * — the selection's provider object first, then the measured keys (today `variants.low` on the `:nitro` id) unchanged.
 * Nitro under dataCollection 'allow' (provider null) adds nothing. A measured entry that already declares `options`
 * throws (the adapter's never does) rather than silently replacing either half.
 */
export function helperRoutedModelEntry(
  selection: RoutingLaunchSelection,
  measuredEntry: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  if (Object.prototype.hasOwnProperty.call(measuredEntry, 'options')) throw new Error('A measured helper model entry already declares options.')
  const measured = JSON.parse(JSON.stringify(measuredEntry)) as Record<string, unknown>
  if (selection.provider === null) return measured
  const provider = JSON.parse(JSON.stringify(selection.provider)) as OpenRouterProviderPrefs
  return { options: { provider }, ...measured }
}

// ── A routed attempt's provider error (K12, C3) ──

/** `a`; `a and b`; `a, b and c` (no serial comma). */
function tagList(tags: readonly string[]): string {
  if (tags.length <= 1) return tags.join('')
  return `${tags.slice(0, -1).join(', ')} and ${tags[tags.length - 1]}`
}

/** C3: appended, after one space, to the parser's text when a routed attempt ends with OpenCode's generic provider error. */
export function routedHelperFailureNote(selection: RoutingLaunchSelection): string {
  const never = "Chorus never changes a helper's tier on its own."
  if (selection.tier === 'nitro') return `This attempt used the Nitro tier, which leaves the provider to OpenRouter. ${never}`
  return `This attempt used the ${LAUNCH_TIER_LABELS[selection.tier]} tier, pinned to ${tagList(selection.endpoints)} with no fallback. If those providers were unavailable, refresh the numbers in Settings → Model routing and revise the task: each attempt resolves its tier again. A helper on another tier can also take the revision. ${never}`
}
