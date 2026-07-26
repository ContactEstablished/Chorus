import { MANAGEMENT_AUTH_MODE } from '../../shared/ipc'
import type { CredentialProfileRow, ProviderConfigRow } from '../db/schema'
import { scrubSecrets } from './logger'
import {
  noBaseUrlFailure,
  parseModelsResponse,
  refreshFailure,
  REFRESH_FAILURE,
  unexpectedStatusFailure,
  type CatalogModel,
  type RefreshRefusal
} from './modelCatalogCore'
import { failureMessage } from './vaultCore'
import type { CredentialVault } from './vault'

/**
 * Task 3a-4: the ONLY module in the repo that fetches `${baseUrl}/models`.
 *
 * Thin by design — an injectable `fetchImpl`, a timeout, a size cap, and
 * delegation to `modelCatalogCore.ts` for every decision. It inherits
 * `probeCredential`'s discipline verbatim (fixed failure vocabulary, no
 * provider body echoed anywhere, every outbound string through `scrubSecrets`,
 * one call, no retry, no backoff, no timer) with ONE deliberate departure,
 * marked below.
 *
 * ⚠ THIS IS THE SECOND KEY-BEARING CALL IN THE APP, and it widens D33
 * resolution (d)'s Test-key carve-out by exactly one. It is admitted on the
 * same terms, and the terms are what make it admissible:
 *   - USER-INITIATED ONLY. One button, one call, no retry, no backoff, no
 *     timer, no boot hook, no settings-open hook.
 *   - DECRYPT AT THE MOMENT OF THE CALL, DROP IMMEDIATELY. The plaintext key
 *     exists in one function's scope and nowhere else — no module-level
 *     variable, no memo, no "hold it while the settings view is open".
 *   - REFUSED for a profile carrying `unavailable_since` (D33 clause 8),
 *     by LABEL only, WITHOUT re-attempting decryption.
 *   - REFUSED outright when the provider's auth_mode is 'management'.
 *   - OPTIONAL. With no profile selected the call carries no key at all —
 *     a first-class shipped path, not a fallback (D4-verified 2026-07-25:
 *     OpenRouter's /models answers 200 unauthenticated).
 *
 * ⚠ AND WHAT IT IS NOT: a successful refresh is NOT proof of authentication
 * and does NOT write `last_verified_at`. A list-models call that succeeds with
 * no key cannot test a key. See Task 3a-4 Goal §3.
 */

/** Structural minimum of a fetch Response. Declared rather than reusing the
 *  DOM lib's `Response` so a test stub is a plain object — the body-handling
 *  assertions below are the point of this module's tests and must not require
 *  a live network primitive to express. */
export interface FetchResponseLike {
  readonly status: number
  readonly body: {
    cancel(): Promise<void>
    getReader(): {
      read(): Promise<{ done: boolean; value?: Uint8Array }>
      cancel(): Promise<void>
    }
  } | null
}

export interface FetchInitLike {
  readonly method: string
  readonly headers: Record<string, string>
  readonly signal: AbortSignal
}

export type FetchLike = (url: string, init: FetchInitLike) => Promise<FetchResponseLike>

export interface RefreshOk {
  readonly ok: true
  readonly models: readonly CatalogModel[]
  readonly droppedCount: number
}

export type RefreshResult = RefreshOk | RefreshRefusal

/** D4-MEASURED, not guessed (obligation 6, 2026-07-25): the live OpenRouter
 *  list is 535,821 bytes for 345 models. 8 MB is ~15x headroom and still a
 *  hard bound — an oversized response is refused AT the cap rather than
 *  buffered whole. */
export const MODELS_RESPONSE_CAP_BYTES = 8_000_000

const REFRESH_TIMEOUT_MS = 10_000

export interface RefreshModelsInput {
  readonly provider: ProviderConfigRow
  /** null = the unauthenticated path, which is a SHIPPED behaviour. */
  readonly profile: CredentialProfileRow | null
  readonly vault: Pick<CredentialVault, 'decryptForLaunch'>
  readonly fetchImpl?: FetchLike
}

/** Sanitize on the way out, always — the final net, exactly as `probeFailure`
 *  applies it in ipc.ts. */
function refuse(message: string): RefreshRefusal {
  return refreshFailure(scrubSecrets(message))
}

/** Provider-level headers are documented NON-SECRET (D33 resolution e); the
 *  envelope's own extraHeaders override them. A hand-edited headers column
 *  degrades to no extra headers rather than breaking the refresh — the same
 *  defensive parse `probeCredential` performs. */
function parseProviderHeaders(extraHeadersJson: string | null): Record<string, string> {
  const out: Record<string, string> = {}
  if (!extraHeadersJson) return out
  try {
    const parsed: unknown = JSON.parse(extraHeadersJson)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'string') out[k] = v
      }
    }
  } catch {
    return {}
  }
  return out
}

/**
 * Read a 2xx body with a hard byte ceiling. Returns null when the cap is
 * exceeded (the reader is cancelled at that point, so the remainder is never
 * pulled) or when the stream errors.
 */
async function readCapped(res: FetchResponseLike, capBytes: number): Promise<string | null> {
  const reader = res.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > capBytes) {
        void reader.cancel().catch(() => undefined)
        return null
      }
      chunks.push(value)
    }
  } catch {
    void reader.cancel().catch(() => undefined)
    return null
  }
  const buf = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    buf.set(c, offset)
    offset += c.byteLength
  }
  return new TextDecoder().decode(buf)
}

/**
 * ONE live `GET ${baseUrl}/models`. User-initiated only.
 *
 * THREE REFUSALS HAPPEN BEFORE ANY DECRYPTION IS ATTEMPTED. That ordering is
 * the point: on any of these paths the plaintext key never exists in this
 * function's scope at all.
 */
export async function refreshProviderModels(input: RefreshModelsInput): Promise<RefreshResult> {
  const { provider, profile, vault } = input
  const fetchImpl = input.fetchImpl ?? (fetch as unknown as FetchLike)

  // Refusal 1 — the higher-privilege credential class (Task 3a-3's
  // 'management' auth_mode). A management key mints and revokes keys and
  // cannot do inference; it must never reach an inference-adjacent endpoint,
  // and Chorus enforces that at its OWN boundary rather than trusting the
  // provider to. Checked FIRST, before the base-URL check, so a class-level
  // refusal cannot be masked by an unrelated configuration error.
  //
  // ⚠ Written even though the UI does not offer it: auth_mode is an
  // unconstrained TEXT column, so the value can exist in the database before
  // any code produces it, and main never trusts the renderer.
  if (provider.authMode === MANAGEMENT_AUTH_MODE) {
    return refuse(REFRESH_FAILURE.management)
  }

  // Refusal 2 — nowhere to call.
  if (!provider.baseUrl) {
    return refuse(noBaseUrlFailure(provider.name))
  }

  // Refusal 3 — a KNOWN-BAD row is refused by LABEL only, WITHOUT
  // re-attempting decryption (D33 clause 8: a retry only widens the window).
  if (profile && profile.unavailableSince) {
    return refuse(failureMessage('undecryptable', profile.label))
  }

  // ── Everything below may touch a plaintext key. It exists in THIS scope and
  //    nowhere else, and it is dropped when this function returns.
  let key: string | null = null
  let envelopeBaseUrl: string | null = null
  let envelopeHeaders: Record<string, string> | undefined
  if (profile) {
    const dec = await vault.decryptForLaunch(profile.id)
    // A decrypt failure marks the row unavailable through the vault's own
    // existing path — this one neither duplicates nor second-guesses it.
    if (!dec.ok) return refuse(dec.message)
    key = dec.value.key
    envelopeBaseUrl = dec.value.baseUrl ?? null
    envelopeHeaders = dec.value.extraHeaders
  }

  // A trailing slash is a KNOWN failure mode on this route (recorded in
  // codexAdapter.buildLaunch). The envelope's own baseUrl wins, as it does for
  // probeCredential.
  const baseUrl = (envelopeBaseUrl ?? provider.baseUrl).replace(/\/+$/, '')
  const providerHeaders = parseProviderHeaders(provider.extraHeadersJson)

  let res: FetchResponseLike
  try {
    res = await fetchImpl(`${baseUrl}/models`, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        // ⚠ The credential is OPTIONAL. With no profile selected NO
        // Authorization header is sent at all — one code path, one conditional
        // entry. The key appears HERE and nowhere else: not in the URL, not in
        // a query string, not in a log call.
        ...(key !== null ? { authorization: `Bearer ${key}` } : {}),
        ...providerHeaders,
        ...(envelopeHeaders ?? {})
      },
      signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS)
    })
  } catch {
    // Leakage path 2 (probeCredential's words): a fetch exception's cause
    // chain can carry the request, headers included. Discard it wholesale.
    // A timeout arrives here too.
    return refuse(REFRESH_FAILURE.unreachable)
  }

  // ⚠ THE ONE DELIBERATE DEPARTURE FROM probeCredential, SPLIT EXPLICITLY.
  // probeCredential cancels the body ALWAYS — "a 401 body can echo the
  // submitted key (leakage path 1)". A refresh must READ the body on success,
  // so the rule is split rather than implied:
  //
  //   non-2xx -> CANCELLED UNREAD, exactly as probeCredential does it. This is
  //              the path most likely to echo a key.
  //   2xx     -> read, size-capped, and the parsed value is NEVER interpolated
  //              into an error message.
  if (res.status < 200 || res.status >= 300) {
    void res.body?.cancel().catch(() => undefined)
    if (res.status === 401 || res.status === 403) return refuse(REFRESH_FAILURE.authFailed)
    if (res.status === 429) return refuse(REFRESH_FAILURE.rateLimited)
    if (res.status >= 500) return refuse(REFRESH_FAILURE.providerError)
    return refuse(unexpectedStatusFailure(res.status))
  }

  const text = await readCapped(res, MODELS_RESPONSE_CAP_BYTES)
  if (text === null) return refuse(REFRESH_FAILURE.unrecognized)

  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    // The parse error names the offending byte offset and can quote content.
    // Fixed string only.
    return refuse(REFRESH_FAILURE.unrecognized)
  }

  const parsed = parseModelsResponse(body)
  if (!parsed.ok) return refuse(parsed.reason)
  return { ok: true, models: parsed.models, droppedCount: parsed.droppedCount }
}
