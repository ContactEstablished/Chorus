import { logger, scrubSecrets } from './logger'
import {
  classifyManagementStatus,
  interpretTokenRow,
  managementFailure,
  parseCount,
  type AnalyticsRow,
  type LiveKeySummary,
  type MintBody,
  type TokenBreakdown
} from './attributionCore'

/**
 * Task 3a-3: the ONLY module in the repo that calls `fetch` against
 * `/api/v1/keys*` or `/api/v1/analytics/*`. Transport, headers, timeouts, and
 * the sanitize-on-the-way-out net. ZERO POLICY — every judgement is delegated
 * to `attributionCore`.
 *
 * ⚠ "Management keys cannot be used to make API calls to OpenRouter's
 * completion endpoints" (D4-verified 2026-07-25) — so this client is
 * STRUCTURALLY incapable of inference: there is no completion endpoint in it,
 * and there is no code path that sends the management key anywhere but the
 * `Authorization` header of the six administrative calls below.
 *
 * Endpoints, all D4-re-verified in this session (see _verify/3a-3/D4-VERIFICATION.md):
 *   GET    /api/v1/keys                → { data: [ { hash, name, … } ] }   (paginated by `offset`)
 *   POST   /api/v1/keys                → { key, data: { hash, limit, … } }
 *   GET    /api/v1/keys/{hash}         → { data: { usage, limit_remaining, … } }
 *   DELETE /api/v1/keys/{hash}         → { deleted: true }
 *   GET    /api/v1/analytics/meta      → { data: { metrics, dimensions, operators, granularities } }
 *   POST   /api/v1/analytics/query     → { data: { data: [ … ], metadata: { truncated, … } } }
 *
 * ⚠ `PATCH {disabled:true}` IS DELIBERATELY ABSENT. D4 obligation 4 could not
 * confirm that disabling takes effect immediately, and an unverified disable
 * that is BELIEVED to stop spend is worse than no disable — it licenses a
 * slower read. `DELETE` is the revocation.
 */

export type Result<T> = { ok: true; value: T } | { ok: false; reason: string }

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'
/** Matches probeCredential's 10 s. One request, one timeout, a result. */
const DEFAULT_TIMEOUT_MS = 10_000
/** Bounded pagination guard for GET /api/v1/keys. NOT a retry (Non-Goal):
 *  a retry re-asks the same question, this asks the next one. Completing the
 *  read matters because an orphan hidden behind a page boundary is a live,
 *  funded key that reconciliation would never see. */
const MAX_KEY_PAGES = 20

export interface AnalyticsMeta {
  readonly metrics: readonly string[]
  readonly dimensions: readonly string[]
  readonly operators: readonly string[]
  readonly granularities: readonly string[]
}

export interface OpenRouterKeyClient {
  mint(body: MintBody): Promise<Result<{ key: string; hash: string; limit: number | null }>>
  readUsage(hash: string): Promise<Result<{ usageUsd: number | null; limitRemaining: number | null }>>
  revoke(hash: string): Promise<Result<void>>
  list(): Promise<Result<readonly LiveKeySummary[]>>
  /** Tokens for ONE minted key over its own window. `null` inside an ok result
   *  means "not available yet" — truncated, or no row — which §8 distinguishes
   *  from "zero tokens" at every layer. */
  queryTokens(hash: string, from: Date, to: Date): Promise<Result<TokenBreakdown | null>>
  /** Total account spend over the window — the DENOMINATOR of "% attributed".
   *  Not per-key: it is what makes spend we hold no row for still visible. */
  queryGatewayTotal(from: Date, to: Date): Promise<Result<number | null>>
  /** The live schema. The API is beta and its own docs say to query this rather
   *  than trust a snapshot — it is how obligation 2 is re-checked for free. */
  meta(): Promise<Result<AnalyticsMeta>>
}

export interface OpenRouterKeyClientDeps {
  /**
   * ⚠ DECRYPT-PER-USE. A THUNK, not a string and not a cached value, so the
   * management key's plaintext exists only inside one `await` and dies with it.
   * Holding a higher-privilege credential resident for the app's lifetime is
   * strictly worse than what D33 sanctioned for a launch credential.
   */
  readonly getManagementKey: () => Promise<string | null>
  /** Injected so the whole module is testable without a network. */
  readonly fetchImpl?: typeof fetch
  readonly timeoutMs?: number
  readonly baseUrl?: string
}

class OpenRouterKeyClientImpl implements OpenRouterKeyClient {
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  private readonly baseUrl: string
  /** D4 obligation 8, settled at runtime without revealing anything: whether the
   *  management key matches the canonical key-shape list. Logged ONCE per run as
   *  a BOOLEAN. If it is ever false, `secret-patterns.json` must be extended
   *  before the key is handled further. */
  private scrubCoverageLogged = false

  constructor(private readonly deps: OpenRouterKeyClientDeps) {
    this.fetchImpl = deps.fetchImpl ?? fetch
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.baseUrl = (deps.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  }

  async mint(body: MintBody): Promise<Result<{ key: string; hash: string; limit: number | null }>> {
    return this.call('POST', '/keys', body, (json) => {
      // EXPLICIT FIELD EXTRACTION — never a spread. A spread would re-admit
      // every field a future API version adds into an object this code then
      // hands around, which is how a secret ends up somewhere it was never
      // meant to be.
      const key = typeof json.key === 'string' ? json.key : null
      const data = asRecord(json.data)
      const hash = data && typeof data.hash === 'string' ? data.hash : null
      if (!key || !hash) return null
      return { key, hash, limit: parseCount(data?.limit) }
    })
  }

  async readUsage(hash: string): Promise<Result<{ usageUsd: number | null; limitRemaining: number | null }>> {
    return this.call('GET', `/keys/${encodeURIComponent(hash)}`, undefined, (json) => {
      const data = asRecord(json.data)
      if (!data) return null
      return { usageUsd: parseCount(data.usage), limitRemaining: parseCount(data.limit_remaining) }
    })
  }

  async revoke(hash: string): Promise<Result<void>> {
    // DELETE returns only {"deleted": true} (D4-verified). Whether `usage`
    // survives deletion is UNDOCUMENTED, which is why every caller reads first.
    const result = await this.call('DELETE', `/keys/${encodeURIComponent(hash)}`, undefined, (json) =>
      json.deleted === true ? { deleted: true as const } : null
    )
    return result.ok ? { ok: true, value: undefined } : result
  }

  async list(): Promise<Result<readonly LiveKeySummary[]>> {
    const all: LiveKeySummary[] = []
    let offset = 0
    for (let page = 0; page < MAX_KEY_PAGES; page++) {
      const result = await this.call('GET', `/keys?offset=${offset}`, undefined, (json) => {
        if (!Array.isArray(json.data)) return null
        const rows: LiveKeySummary[] = []
        for (const entry of json.data) {
          const row = asRecord(entry)
          if (!row || typeof row.hash !== 'string') continue
          rows.push({ hash: row.hash, name: typeof row.name === 'string' ? row.name : null })
        }
        return { rows, raw: json.data.length }
      })
      if (!result.ok) return result
      all.push(...result.value.rows)
      if (result.value.raw === 0) return { ok: true, value: all }
      offset += result.value.raw
    }
    // Hitting the guard means the account has more keys than this walks. Say so
    // rather than silently reconciling against a partial truth — a reconcile
    // that cannot see a key cannot revoke it.
    logger.warn(`[attribution] key list stopped at the ${MAX_KEY_PAGES}-page guard (${all.length} keys)`)
    return { ok: true, value: all }
  }

  async queryTokens(hash: string, from: Date, to: Date): Promise<Result<TokenBreakdown | null>> {
    // D4 obligation 1, VERIFIED 2026-07-25: "filters must use the underlying
    // ID: api_key_id — numeric ID (from generation metadata) or key hash
    // (64-char hex from GET /api/v1/keys, resolved server-side)". The hash the
    // mint response returned is exactly what this filter wants.
    // `cached_tokens` is requested because the LIVE schema has it (verified via
    // GET /api/v1/analytics/meta at execution, 2026-07-25 — 35 metrics), even
    // though the published metric list does not mention it. It gives a MEASURED
    // cached-token count instead of one derived from cache_hit_rate; if a future
    // API version drops it, interpretTokenRow falls back to the derivation and
    // relabels the row automatically.
    const body = {
      metrics: ['tokens_prompt', 'tokens_completion', 'cached_tokens', 'cache_hit_rate'],
      filters: [{ field: 'api_key_id', operator: 'eq', value: hash }],
      time_range: { start: from.toISOString(), end: to.toISOString() }
    }
    return this.call('POST', '/analytics/query', body, (json) => {
      // ⚠ THE RESPONSE IS DOUBLE-NESTED: { data: { data: [...], metadata: {…} } }.
      // Unwrapping one level yields the wrong object and reads as an empty result.
      const outer = asRecord(json.data)
      if (!outer) return null
      const rows = Array.isArray(outer.data) ? outer.data : []
      const metadata = asRecord(outer.metadata)
      const interpreted = interpretTokenRow({
        row: (asRecord(rows[0]) as AnalyticsRow | null) ?? null,
        truncated: metadata?.truncated === true
      })
      // A refusal here is NOT a transport failure: "not available yet" is a
      // legitimate answer that the backfill path exists to revisit.
      return { tokens: interpreted.ok ? interpreted.tokens : null }
    }).then((r) => (r.ok ? { ok: true as const, value: r.value.tokens } : r))
  }

  async queryGatewayTotal(from: Date, to: Date): Promise<Result<number | null>> {
    const body = {
      metrics: ['total_usage'],
      time_range: { start: from.toISOString(), end: to.toISOString() }
    }
    return this.call('POST', '/analytics/query', body, (json) => {
      const outer = asRecord(json.data)
      if (!outer) return null
      const rows = Array.isArray(outer.data) ? outer.data : []
      const first = asRecord(rows[0])
      return { total: first ? parseCount(first.total_usage) : null }
    }).then((r) => (r.ok ? { ok: true as const, value: r.value.total } : r))
  }

  async meta(): Promise<Result<AnalyticsMeta>> {
    return this.call('GET', '/analytics/meta', undefined, (json) => {
      const data = asRecord(json.data)
      if (!data) return null
      return {
        metrics: names(data.metrics),
        dimensions: names(data.dimensions),
        operators: names(data.operators),
        granularities: names(data.granularities)
      }
    })
  }

  /**
   * The one place a request is made, so the three inherited rules hold for
   * every call by construction rather than by six copies of the same care:
   *
   *  1. The response body is NEVER read on a failure path — it is cancelled and
   *     discarded, then the STATUS alone is mapped. A 401 body from a
   *     key-management endpoint is the body most likely of all to echo a key.
   *  2. Every exception collapses to one fixed string. A `TypeError: fetch
   *     failed` carries a `cause` chain that can include the request AND ITS
   *     HEADERS — which here means the management key. Caught, discarded whole.
   *  3. Every outbound message passes through `scrubSecrets` as a final net.
   */
  private async call<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body: unknown,
    extract: (json: Record<string, unknown>) => T | null
  ): Promise<Result<T>> {
    const managementKey = await this.deps.getManagementKey()
    if (!managementKey) return fail('No OpenRouter management key is configured.')
    this.logScrubCoverageOnce(managementKey)
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          // ⚠ THE ONLY PLACE THE MANAGEMENT KEY APPEARS. Never a URL, never a
          // query string, never a body field, never a log line.
          authorization: `Bearer ${managementKey}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.timeoutMs)
      })
      const kind = classifyManagementStatus(res.status)
      if (kind !== null) {
        void res.body?.cancel().catch(() => undefined)
        return fail(managementFailure(kind, res.status))
      }
      let json: unknown
      try {
        json = await res.json()
      } catch {
        return fail(managementFailure('unexpected', res.status))
      }
      const record = asRecord(json)
      const value = record === null ? null : extract(record)
      if (value === null) return fail(managementFailure('unexpected', res.status))
      return { ok: true, value }
    } catch {
      // Rule 2: discard the exception WHOLESALE. Nothing from it — not its
      // message, not its cause, not its stack — reaches a caller or a log.
      return fail(managementFailure('unreachable'))
    }
  }

  /** D4 obligation 8. Logs a BOOLEAN and never a byte of the key. Runs on the
   *  first management call of a run, where the plaintext is already in hand —
   *  so it costs no extra decrypt and adds no boot-time credential access. */
  private logScrubCoverageOnce(managementKey: string): void {
    if (this.scrubCoverageLogged) return
    this.scrubCoverageLogged = true
    const covered = scrubSecrets(managementKey) !== managementKey
    logger.info(`[attribution] management key covered by the scrub pattern list: ${covered}`)
    if (!covered) {
      logger.warn(
        '[attribution] the management key does NOT match any pattern in secret-patterns.json — ' +
          'extend the list before relying on redaction for it'
      )
    }
  }
}

/** Every outbound reason goes through the scrubber. One call, costs nothing,
 *  and is the difference between "we thought about it" and "it cannot happen". */
function fail(reason: string): { ok: false; reason: string } {
  return { ok: false, reason: scrubSecrets(reason) }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/** `/analytics/meta` returns arrays of `{name, display_label, …}`. Only the
 *  names matter here; everything else is presentation for a UI this task does
 *  not have. */
function names(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const entry of value) {
    const record = asRecord(entry)
    if (record && typeof record.name === 'string') out.push(record.name)
  }
  return out
}

export function createOpenRouterKeyClient(deps: OpenRouterKeyClientDeps): OpenRouterKeyClient {
  return new OpenRouterKeyClientImpl(deps)
}
