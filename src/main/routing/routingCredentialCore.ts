/**
 * Model Routing Task 2-1: which stored credential a routing call may decrypt
 * (MR-D18, C10). Every refusal here happens BEFORE any decrypt, so on a
 * refused path the plaintext key never exists in the caller's scope.
 *
 * The order mirrors `refreshProviderModels` (modelCatalog.ts): the class
 * refusals come first, so a management key is refused as a management key
 * even when it is also unavailable or misconfigured; a profile carrying
 * `unavailable_since` is refused by label, without a decrypt attempt (D33
 * clause 8). The gateway URL is a parameter, so `openrouterKeys.ts` stays its
 * only home, and the rows are structural subsets, so this core imports neither
 * the database schema nor the vault.
 *
 * Pure: no clock, no randomness, no environment, no file system, no network.
 */

/** Structural subsets of CredentialProfileRow and ProviderConfigRow (db/schema.ts:248, :220); the rows are assignable. */
export interface RoutingCredentialRow { readonly id: string; readonly providerId: string; readonly label: string; readonly unavailableSince: string | null }
export interface RoutingProviderRow { readonly id: string; readonly authMode: string; readonly baseUrl: string | null }

export const CREDENTIAL_REFUSALS = ['not-found', 'provider-missing', 'management', 'not-api-key', 'not-openrouter', 'unavailable', 'envelope-mismatch'] as const
export type CredentialRefusal = (typeof CREDENTIAL_REFUSALS)[number]
export type CredentialCheck = { ok: true } | { ok: false; refusal: CredentialRefusal; message: string }

/** The management auth mode; equal to `MANAGEMENT_AUTH_MODE` in shared/ipc.ts (asserted by a test, not imported). */
const MANAGEMENT = 'management'
const API_KEY = 'api_key'

/** Trailing slashes removed, nothing else: no case folding (as teamMemberProfiles.ts:15). */
export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '')
}

/**
 * The fixed refusal messages. `label` is the profile label, the only variable
 * part, and is user text: the service passes every message through
 * `scrubSecrets` before it leaves. A `null` label renders as empty quotes; the
 * two checks below never produce a label-bearing refusal without a label.
 */
export function credentialRefusalMessage(refusal: CredentialRefusal, label: string | null): string {
  switch (refusal) {
    case 'not-found':
      return 'The routing credential was not found.'
    case 'provider-missing':
      return 'The routing credential has no provider.'
    case 'management':
      return 'Routing is not available for a management credential.'
    case 'not-api-key':
      return 'Routing needs an OpenRouter API-key credential.'
    case 'not-openrouter':
      return 'Routing needs a credential for the OpenRouter gateway.'
    case 'unavailable':
      return `Credential profile '${label ?? ''}' is unavailable. Re-enter the credential in Settings.`
    case 'envelope-mismatch':
      return `Credential profile '${label ?? ''}' points at a different base URL; routing only calls the OpenRouter gateway.`
  }
}

function refuse(refusal: CredentialRefusal, label: string | null): CredentialCheck {
  return { ok: false, refusal, message: credentialRefusalMessage(refusal, label) }
}

/** C10: the first refusal that applies wins; otherwise the credential may be decrypted for a routing call. */
export function checkRoutingCredential(
  profile: RoutingCredentialRow | null,
  provider: RoutingProviderRow | null,
  gatewayBaseUrl: string
): CredentialCheck {
  if (profile === null) return refuse('not-found', null)
  if (provider === null || provider.id !== profile.providerId) return refuse('provider-missing', profile.label)
  if (provider.authMode === MANAGEMENT) return refuse('management', profile.label)
  if (provider.authMode !== API_KEY) return refuse('not-api-key', profile.label)
  if (provider.baseUrl === null || normalizeBaseUrl(provider.baseUrl) !== normalizeBaseUrl(gatewayBaseUrl)) {
    return refuse('not-openrouter', profile.label)
  }
  if (profile.unavailableSince !== null) return refuse('unavailable', profile.label)
  return { ok: true }
}

/** After the decrypt: an envelope that names its own base URL must name the gateway. No base URL passes. */
export function checkEnvelopeBaseUrl(envelopeBaseUrl: string | undefined, label: string, gatewayBaseUrl: string): CredentialCheck {
  if (envelopeBaseUrl === undefined) return { ok: true }
  if (normalizeBaseUrl(envelopeBaseUrl) === normalizeBaseUrl(gatewayBaseUrl)) return { ok: true }
  return refuse('envelope-mismatch', label)
}
