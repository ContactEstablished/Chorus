import { ROUTING_TAG_PATTERN, type PreflightIssue, type PreflightStep, type RawEndpoint, type RoutingFailure } from '../../shared/routing'
import { extractProbeUsage, probeRequestBody, type ProbeUsage } from '../routing/cacheProbeCore'
import { parseEndpointsResponse } from '../routing/endpointsCore'
import { parsePreflight, preflightRequestBody } from '../routing/preflightCore'
import { scrubSecrets } from './logger'
import { readCapped, type FetchInitLike, type FetchResponseLike } from './modelCatalog'
import { OPENROUTER_GATEWAY_BASE_URL } from './openrouterKeys'

/**
 * Model Routing Task 2-1: the ONLY module in the app that sends a routing
 * request to OpenRouter — the keyed `GET /models/{slug}/endpoints`, the two
 * zero-cost account preflights, and one cache-probe call.
 *
 * Thin by design — an injectable `fetchImpl`, a timeout, a size cap per
 * request, and delegation to the pure routing cores for every decision. It
 * inherits `refreshProviderModels`' discipline (modelCatalog.ts): a fixed
 * failure vocabulary (`ROUTING_FAILURES`), no provider body echoed anywhere,
 * one request per call, no retry, no backoff, no timer of its own, no log
 * call. It holds no state: a key arrives as a parameter, is placed in one
 * header, and is gone when the call returns.
 *
 * ⚠ THIS IS THE THIRD KEY-BEARING CALL CLASS IN THE APP. D33 resolution (d)
 * admitted one carve-out (the Test-key probe); D58 widened it by exactly one
 * call (`model:refresh`). MR-D18 admits routing as a third class, and its
 * constraints are what make it admissible. They are split between this
 * module and its caller, and stated here so neither half is mistaken for the
 * whole:
 *   - TWO SUB-CLASSES. (1) A USER-INITIATED REFRESH — one IPC call, one user
 *     action — for one (model, credential): the endpoints GET, two
 *     preflights, and the automatic cache probe capped at $0.05 per refresh.
 *     (2) An UNATTENDED OBSERVER: every 30 minutes, the free endpoints GET
 *     only, with the credential the user DESIGNATED (MR-D19). This is the
 *     first unattended decrypt of an `api_key`-class credential; D60's
 *     launch-credential guarantee holds with that one designated exception,
 *     and the key never reaches a child process.
 *   - DECRYPT AT THE MOMENT OF USE AND DROP IT (the caller, RoutingService):
 *     no module-level variable, no memo; one decrypt per refresh or per tick.
 *     Nothing here decrypts, and nothing here keeps the key.
 *   - REFUSED BEFORE ANY DECRYPT (the caller, through routingCredentialCore):
 *     an unknown profile, `unavailable_since` (by label, no decrypt attempt),
 *     an auth mode other than 'api_key' ('management' outright), or a
 *     provider whose base URL is not the gateway. An envelope `baseUrl` that
 *     differs from the gateway is refused after the decrypt, before any call.
 *   - ONE DESTINATION. Every URL is built from OPENROUTER_GATEWAY_BASE_URL;
 *     no base URL is accepted from a row, an envelope or a caller. Every
 *     request carries `redirect: 'error'`, so a redirect can never carry the
 *     Authorization header to another host: fetch rejects instead, and a
 *     rejected fetch is `unreachable`. One destination holds by construction.
 *   - THE KEY IN ONE PLACE. Headers are exactly `accept`, `authorization`
 *     and, on POST, `content-type` (C9). Provider and envelope
 *     `extraHeaders` are not sent. The key is never in a URL, a returned
 *     value, a thrown error or a log call.
 *   - EMPTY KEY: `auth-failed`, and fetch is never called.
 *
 * ⚠ THE BODY RULE, SPLIT EXPLICITLY (modelCatalog.ts splits it in two; this
 * splits it in three, because a preflight's answer IS its error body):
 *
 *   request    status    body                       result
 *   ---------  --------  -------------------------  --------------------------------
 *   any        thrown    (no response)              unreachable, status null; the
 *                                                   exception is discarded wholesale
 *   any        401, 403  CANCELLED UNREAD, always   auth-failed
 *   endpoints  2xx       read, capped 2,000,000     rows, or unrecognized /
 *                                                   model-mismatch; a row whose tag
 *                                                   fails ROUTING_TAG_PATTERN or
 *                                                   scrubSecrets is a rejected row
 *   preflight  404       read, capped 65,536        parsed tags or a preflight issue;
 *                                                   only tags that pass
 *                                                   ROUTING_TAG_PATTERN and survive
 *                                                   scrubSecrets leave (C3)
 *   preflight  2xx       CANCELLED UNREAD           issue 'unexpected-status'
 *   probe      2xx       read, capped 262,144       usage numbers only; the
 *                                                   completion text is never read
 *   any        other     CANCELLED UNREAD           failureForStatus(status)
 *
 * A non-2xx body is the one most likely to echo a submitted key, which is why
 * the preflight's expected 404 is the only one read: it is capped, parsed, and
 * only tags, numbers and fixed vocabulary cross this module's boundary.
 */

/**
 * FetchInitLike (modelCatalog.ts:61) has no body; POST needs one (C8). `redirect`
 * is always 'error' here (one destination by construction). Both fields are
 * optional additions, so a FetchLike stub stays assignable.
 */
export type RoutingFetchInit = FetchInitLike & { readonly body?: string; readonly redirect?: 'error' }
export type RoutingFetchLike = (url: string, init: RoutingFetchInit) => Promise<FetchResponseLike>

export const ENDPOINTS_RESPONSE_CAP_BYTES = 2_000_000 // fixture: 64,233 bytes for 33 rows
export const PREFLIGHT_BODY_CAP_BYTES = 65_536
export const PROBE_RESPONSE_CAP_BYTES = 262_144
export const ROUTING_REQUEST_TIMEOUT_MS = 10_000

export interface RoutingCallFailure { readonly ok: false; readonly failure: RoutingFailure; readonly status: number | null }
export interface RoutingCallBase {
  readonly key: string // decrypted by the caller for this one use
  readonly model: string // a registry slug
  readonly fetchImpl?: RoutingFetchLike // default: the global fetch
  readonly signal?: AbortSignal // the service's dispose signal; combined with the timeout
}

const COMPLETIONS_URL = `${OPENROUTER_GATEWAY_BASE_URL}/chat/completions`

/** Each path segment of the slug is encoded; no query string, and never the key. */
export function endpointsUrl(model: string): string {
  return `${OPENROUTER_GATEWAY_BASE_URL}/models/${model.split('/').map(encodeURIComponent).join('/')}/endpoints`
}

export function failureForStatus(status: number): RoutingFailure {
  if (status === 401 || status === 403) return 'auth-failed'
  if (status === 429) return 'rate-limited'
  if (status >= 500) return 'provider-error'
  return 'unexpected-status'
}

export type EndpointsCallResult = { readonly ok: true; readonly endpoints: RawEndpoint[]; readonly rejectedRows: number } | RoutingCallFailure

export type PreflightCallResult =
  | { readonly ok: true; readonly removed: string[] | null; readonly issue: PreflightIssue | null }
  | RoutingCallFailure

export type ProbeCallResult = { readonly ok: true; readonly usage: ProbeUsage } | RoutingCallFailure

function failure(kind: RoutingFailure, status: number | null): RoutingCallFailure {
  return { ok: false, failure: kind, status }
}

function is2xx(status: number): boolean {
  return status >= 200 && status < 300
}

/** Everything not read is cancelled, never drained. */
function cancelUnread(res: FetchResponseLike): void {
  void res.body?.cancel().catch(() => undefined)
}

/**
 * ONE request. Returns `null` when `fetchImpl` throws or rejects (a timeout and
 * an abort included): a fetch exception's cause chain can carry the request,
 * headers included, so it is discarded wholesale and never inspected.
 */
async function send(input: RoutingCallBase, url: string, body?: string): Promise<FetchResponseLike | null> {
  const fetchImpl = input.fetchImpl ?? (fetch as unknown as RoutingFetchLike)
  // C9: exactly these headers, in this order. The key appears HERE and nowhere
  // else: not in the URL, not in a query string, not in a result.
  const headers: Record<string, string> = { accept: 'application/json', authorization: `Bearer ${input.key}` }
  if (body !== undefined) headers['content-type'] = 'application/json'
  try {
    const signal = AbortSignal.any([AbortSignal.timeout(ROUTING_REQUEST_TIMEOUT_MS), ...(input.signal ? [input.signal] : [])])
    // `redirect: 'error'`: a redirect is a rejection (unreachable), never a second destination.
    return await fetchImpl(
      url,
      body !== undefined
        ? { method: 'POST', headers, signal, redirect: 'error', body }
        : { method: 'GET', headers, signal, redirect: 'error' }
    )
  } catch {
    return null
  }
}

/** A body through the shared cap, then JSON. `undefined` when over the cap, unreadable or not JSON. */
async function readJson(res: FetchResponseLike, capBytes: number): Promise<{ value: unknown } | undefined> {
  const text = await readCapped(res, capBytes)
  if (text === null) return undefined
  try {
    return { value: JSON.parse(text) as unknown }
  } catch {
    // The parse error names a byte offset and can quote content. Discarded.
    return undefined
  }
}

/** The keyed endpoints list for one model (MR-D18 classes 1 and 2). */
export async function fetchRoutingEndpoints(input: RoutingCallBase): Promise<EndpointsCallResult> {
  if (!input.key) return failure('auth-failed', null)
  const res = await send(input, endpointsUrl(input.model))
  if (res === null) return failure('unreachable', null)
  if (!is2xx(res.status)) {
    cancelUnread(res)
    return failure(failureForStatus(res.status), res.status)
  }
  const json = await readJson(res, ENDPOINTS_RESPONSE_CAP_BYTES)
  if (json === undefined) return failure('unrecognized', res.status)
  let parsed: ReturnType<typeof parseEndpointsResponse>
  try {
    parsed = parseEndpointsResponse(json.value)
  } catch {
    // The envelope error quotes a Zod path and message; fixed vocabulary only.
    return failure('unrecognized', res.status)
  }
  if (parsed.modelId !== input.model) return failure('model-mismatch', res.status)
  // Only tags that pass ROUTING_TAG_PATTERN and survive scrubSecrets cross this
  // boundary (Spec 2-1 invariants); any other row is a rejected row.
  const endpoints = parsed.endpoints.filter((row) => ROUTING_TAG_PATTERN.test(row.tag) && scrubSecrets(row.tag) === row.tag)
  const unusableTags = parsed.endpoints.length - endpoints.length
  if (endpoints.length === 0) return failure('unrecognized', res.status)
  // Only the count of rejected rows leaves; their issue text and tags do not.
  return { ok: true, endpoints, rejectedRows: parsed.rejected.length + unusableTags }
}

/** One zero-cost preflight (MR-D12, MR-D18). Its expected answer is a 404 whose body lists the removals. */
export async function sendRoutingPreflight(
  input: RoutingCallBase & { readonly step: PreflightStep; readonly rowsPerTag: Readonly<Record<string, number>> }
): Promise<PreflightCallResult> {
  if (!input.key) return failure('auth-failed', null)
  const res = await send(input, COMPLETIONS_URL, JSON.stringify(preflightRequestBody(input.model, input.step)))
  if (res === null) return failure('unreachable', null)
  if (res.status === 404) {
    // The one non-2xx body that is read: capped, parsed, and reduced to tags.
    const json = await readJson(res, PREFLIGHT_BODY_CAP_BYTES)
    if (json === undefined) return { ok: true, removed: null, issue: 'unrecognized-body' }
    const parsed = parsePreflight({ status: 404, body: json.value, step: input.step, rowsPerTag: input.rowsPerTag })
    // C3: a tag that the scrubber would change is a key shape; the whole list is unknown.
    if (parsed.removed !== null && parsed.removed.some((tag) => scrubSecrets(tag) !== tag)) {
      return { ok: true, removed: null, issue: 'bad-tag' }
    }
    return { ok: true, removed: parsed.removed, issue: parsed.issue }
  }
  cancelUnread(res)
  // A 2xx means the nonexistent tag was served: the preflight learned nothing.
  if (is2xx(res.status)) return { ok: true, removed: null, issue: 'unexpected-status' }
  return failure(failureForStatus(res.status), res.status)
}

/** One cache-probe call (MR-D9, MR-D18), pinned to `tag`. Only the usage numbers leave. */
export async function sendRoutingProbeCall(
  input: RoutingCallBase & { readonly tag: string; readonly runNonce: string }
): Promise<ProbeCallResult> {
  if (!input.key) return failure('auth-failed', null)
  const res = await send(input, COMPLETIONS_URL, JSON.stringify(probeRequestBody(input.model, input.tag, input.runNonce)))
  if (res === null) return failure('unreachable', null)
  if (!is2xx(res.status)) {
    // A 404 here (an endpoint gone since the snapshot) is free and unexpected.
    cancelUnread(res)
    return failure(failureForStatus(res.status), res.status)
  }
  const json = await readJson(res, PROBE_RESPONSE_CAP_BYTES)
  if (json === undefined) return failure('unrecognized', res.status)
  return { ok: true, usage: extractProbeUsage(json.value) }
}
