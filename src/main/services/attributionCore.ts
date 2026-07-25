/**
 * Task 3a-3 (D42): the PURE core of per-dispatch token & cost attribution.
 *
 * Every DECISION lives here — strategy selection, mint-request construction,
 * the sanitized failure vocabulary, orphan classification, defensive numeric
 * parsing, and the "% attributed" arithmetic. Nothing here imports `electron`,
 * calls `fetch`, touches `node:fs`, or reads a clock: time arrives as a
 * parameter. The house precedent is `vaultCore.ts` ↔ `vault.ts`,
 * `computeRestoreSet` ↔ `sessionManager.ts`, and `computeWorktreeReconcile` ↔
 * `GitWorktreeManager`.
 *
 * The reason the split matters HERE more than anywhere else in the repo: the
 * dangerous decision in this task is "revoke something", and revoking the wrong
 * key destroys a credential a user created by hand, silently and with no undo.
 * Deciding it in a function with no network access is what makes every branch
 * unit-testable and lets the destructive one be asserted ABSENT.
 */

/* ------------------------------------------------------------------------ */
/* Vocabulary                                                                */
/* ------------------------------------------------------------------------ */

/**
 * The lifecycle of attribution for one dispatch row. NOT NULL in the schema
 * with a default, because a row whose state is unknown is a row nobody can
 * reason about later.
 */
export type AttributionState =
  /** A key was minted and the ledger row is OPEN (`revoked_at IS NULL`). */
  | 'minted'
  /** Read, revoked, and settled normally. */
  | 'closed'
  /** Minting failed; the launch went ahead on the user's own key. Counts
   *  AGAINST "% attributed" rather than hiding. */
  | 'mint-failed'
  /** Revocation failed at close. Ledger stays open; boot reconcile is the
   *  backstop, bounded by the hard `limit`. */
  | 'revoke-failed'
  /** Closed by the boot reconcile after a crash (matrix row 1). */
  | 'orphan-reconciled'
  /** A subscription session: metered from the CLI's own logs, never routed. */
  | 'cli-logs'
  /** No attribution was attempted — no management key, or no route. NOT an
   *  error: the app works, attribution does not. */
  | 'none'

export const ATTRIBUTION_STATES: readonly AttributionState[] = [
  'minted',
  'closed',
  'mint-failed',
  'revoke-failed',
  'orphan-reconciled',
  'cli-logs',
  'none'
]

/**
 * Where a row's token numbers came from. NULL (absent) means unknown, and
 * unknown is a real and frequent answer — see §8's rule that `0` and `unknown`
 * must never be confused.
 */
export type TokensSource =
  /** Read directly from an analytics metric. */
  | 'analytics'
  /** `tokens_cached` computed as `tokens_prompt × cache_hit_rate` because no
   *  cached-TOKEN metric exists (D4 obligation 2, verified 2026-07-25). A
   *  derived number labelled as derived is fine; labelled as measured it is not. */
  | 'analytics-derived'
  /** Parsed from a subscription CLI's own local session logs — explicitly
   *  lower fidelity than anything the gateway reports. */
  | 'cli-logs'

/* ------------------------------------------------------------------------ */
/* Strategy: keyed on AUTH MODE, and on nothing else (D42)                   */
/* ------------------------------------------------------------------------ */

/** Tunables for a minted key. Both are hard requirements, not preferences:
 *  `limitUsd` is the blast-radius bound that makes a failed revocation
 *  survivable, and `ttlMs` sets `expires_at`. */
export interface AttributionPolicy {
  readonly limitUsd: number
  readonly ttlMs: number
}

/** The three honest answers. `'minted-key'` is full fidelity; `'cli-logs'` is
 *  deliberately lower fidelity and KEEPS THE FLAT RATE; `'none'` is what an
 *  api_key session gets when there is no management key or no route — it is
 *  NOT a silent fallback to minting, and it is NOT an error. */
export type AttributionStrategy =
  | { readonly kind: 'minted-key'; readonly limitUsd: number; readonly ttlMs: number }
  | { readonly kind: 'cli-logs' }
  | { readonly kind: 'none'; readonly reason: 'no-management-key' | 'no-route' }

/**
 * ⚠ THE MOST IMPORTANT FUNCTION IN THE TASK.
 *
 * The discriminator is `AuthMethodDefinition.type` (D42), which has existed
 * per-adapter since Task 3-3. It is NOT `provider.baseUrl`, NOT "does this
 * launch carry a credential", and NOT "is this the OpenRouter provider".
 *
 * Routing a subscription-authenticated agent through ANY gateway converts a
 * flat-rate subscription into per-token billing, so a cost-TRACKING feature
 * would INCREASE cost. That is the single worst outcome available here, and it
 * is easy to reach by accident because a subscription launch and an api-key
 * launch differ in one field.
 *
 * Hence the subscription branch returns FIRST, unconditionally, and reads
 * NOTHING else from the input — a branch that never looks at a base URL cannot
 * accidentally route on one. The unit test asserts the WHOLE returned object,
 * so a future field cannot smuggle a route in behind the tag.
 */
export function chooseAttributionStrategy(input: {
  readonly authType: 'subscription' | 'api_key'
  readonly hasManagementKey: boolean
  readonly hasRoute: boolean
  readonly policy: AttributionPolicy
}): AttributionStrategy {
  // ── THE BILLING SEPARATION. Do not add a condition to this line. ────────
  if (input.authType === 'subscription') return { kind: 'cli-logs' }

  // Minting an OpenRouter key for a launch that will never talk to OpenRouter
  // buys nothing and leaves a live funded key behind, so the route is checked
  // before the key.
  if (!input.hasRoute) return { kind: 'none', reason: 'no-route' }
  if (!input.hasManagementKey) return { kind: 'none', reason: 'no-management-key' }
  return { kind: 'minted-key', limitUsd: input.policy.limitUsd, ttlMs: input.policy.ttlMs }
}

/* ------------------------------------------------------------------------ */
/* Minting                                                                   */
/* ------------------------------------------------------------------------ */

/**
 * The ownership marker. It is the ONLY thing that distinguishes a key Chorus
 * may revoke from a key the user made by hand, so it is a constant, it is
 * exact-matched at the START of the name, and it is never user-configurable.
 */
export const MINT_NAME_PREFIX = 'chorus-dispatch-'

/**
 * The mint `name` is sent to a THIRD PARTY, so the only thing allowed into it
 * besides the prefix is the dispatch id. This guard is what makes that literal
 * rather than aspirational: a label, a project name, a cwd or a branch cannot
 * pass it even if a future caller tries.
 */
const DISPATCH_ID_SHAPE = /^[A-Za-z0-9-]{1,64}$/

/** D4-verified 2026-07-25 against
 *  openrouter.ai/docs/api/api-reference/api-keys/create-a-new-api-key:
 *  `name` is required (minLength 1); `limit`, `expires_at`, `limit_reset` and
 *  `include_byok_in_limit` are optional; `expires_at` "Must be UTC, other
 *  timezones will be rejected". */
export interface MintBody {
  readonly name: string
  /** USD, > 0, ALWAYS present. */
  readonly limit: number
  /** ISO-8601 UTC. The third orphan defence — and the WEAKEST of the three:
   *  D4 obligation 5 could not confirm that OpenRouter stops honouring a key at
   *  this instant, so nothing in §6 leans on it. */
  readonly expires_at: string
}

/**
 * `limit` is NOT optional here even though the API treats it as optional. A key
 * without a cap is a key that can spend the account, and the whole reason a
 * failed revocation is survivable is that the cap bounds it. This function
 * REFUSES a non-positive limit — there is deliberately no code path to an
 * uncapped key, including for exploration.
 */
export function buildMintRequest(input: {
  readonly dispatchId: string
  readonly limitUsd: number
  readonly now: Date
  readonly ttlMs: number
}): { ok: true; body: MintBody } | { ok: false; reason: string } {
  if (!DISPATCH_ID_SHAPE.test(input.dispatchId)) {
    return { ok: false, reason: 'Refusing to mint: the dispatch id is not a plain identifier.' }
  }
  if (!Number.isFinite(input.limitUsd) || input.limitUsd <= 0) {
    return { ok: false, reason: 'Refusing to mint an OpenRouter key without a positive spend limit.' }
  }
  if (!Number.isFinite(input.ttlMs) || input.ttlMs <= 0) {
    return { ok: false, reason: 'Refusing to mint an OpenRouter key without a positive expiry.' }
  }
  const startedMs = input.now.getTime()
  if (!Number.isFinite(startedMs)) {
    return { ok: false, reason: 'Refusing to mint an OpenRouter key without a valid clock.' }
  }
  return {
    ok: true,
    body: {
      name: `${MINT_NAME_PREFIX}${input.dispatchId}`,
      limit: input.limitUsd,
      // toISOString() is always UTC with a trailing Z, which is what the API
      // requires; a local-offset string is documented to be rejected.
      expires_at: new Date(startedMs + input.ttlMs).toISOString()
    }
  }
}

/* ------------------------------------------------------------------------ */
/* Response interpretation: the probeCredential discipline, reused            */
/* ------------------------------------------------------------------------ */

/**
 * The fixed vocabulary. Mirrors `probeFailure` in `ipc.ts` exactly, for the
 * identical reason and then one more: a 401 body from a KEY-MANAGEMENT endpoint
 * is the body most likely of all to echo a key back. Nothing from a response
 * body or an exception ever reaches a caller — status codes map to fixed
 * strings, and the transport passes every outbound string through
 * `scrubSecrets` as a final net.
 */
export type ManagementFailureKind =
  | 'unauthorized' // 401 / 403
  | 'not-found' // 404
  | 'rate-limited' // 429 — no retry, no backoff (Non-Goal); boot reconcile is the backstop
  | 'provider-error' // 5xx
  | 'unexpected' // any other non-2xx
  | 'unreachable' // threw, aborted, or timed out

export function managementFailure(kind: ManagementFailureKind, status?: number): string {
  switch (kind) {
    case 'unauthorized':
      return 'The OpenRouter management key was rejected.'
    case 'not-found':
      return 'That OpenRouter key no longer exists.'
    case 'rate-limited':
      return 'Rate limited by OpenRouter.'
    case 'provider-error':
      return 'OpenRouter returned an error.'
    case 'unexpected':
      // The STATUS is admitted; nothing else about the response ever is.
      return `Unexpected response (${status ?? 0}).`
    case 'unreachable':
      return 'Could not reach OpenRouter.'
  }
}

/** Map an HTTP status onto the vocabulary. `null` means success — the caller
 *  may then parse the body by EXPLICIT FIELD EXTRACTION, never by spreading. */
export function classifyManagementStatus(status: number): ManagementFailureKind | null {
  if (status >= 200 && status < 300) return null
  if (status === 401 || status === 403) return 'unauthorized'
  if (status === 404) return 'not-found'
  if (status === 429) return 'rate-limited'
  if (status >= 500) return 'provider-error'
  return 'unexpected'
}

/* ------------------------------------------------------------------------ */
/* Defensive numeric parsing (D4-verified: counts may arrive as STRINGS)     */
/* ------------------------------------------------------------------------ */

/**
 * ⚠ `0` AND `unknown` MUST NEVER BE CONFUSED. A fabricated zero calibrates the
 * estimator on data that never existed and every projection downstream is
 * quietly wrong; a NULL is merely missing. So: a non-numeric value yields
 * `null`, never `NaN` and never `0`.
 *
 * Strings are accepted because OpenRouter's own cookbook documents count
 * metrics coming back as strings (`"request_count": "6"`) beside numbers
 * (`"total_usage": 0.005`) in the SAME row — verified 2026-07-25.
 *
 * `Number('')` is 0 in JavaScript, which is exactly the fabricated zero this
 * function exists to prevent, hence the explicit empty check.
 */
export function parseCount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return null
    const n = Number(trimmed)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** A 0–1 ratio (`cache_hit_rate`). Out-of-range values are REJECTED rather than
 *  clamped: a rate above 1 means the field does not mean what we think, and
 *  deriving cached tokens from it would be worse than admitting ignorance. */
export function parseRate(value: unknown): number | null {
  const n = parseCount(value)
  if (n === null) return null
  return n >= 0 && n <= 1 ? n : null
}

/* ------------------------------------------------------------------------ */
/* Tokens — the honest data path (§8)                                        */
/* ------------------------------------------------------------------------ */

export interface TokenBreakdown {
  readonly tokensIn: number | null
  readonly tokensOut: number | null
  /** ⚠ ITS OWN FIELD, NEVER FOLDED INTO `tokensIn`. Cached input is priced
   *  roughly an order of magnitude below fresh input and a PTY agent against a
   *  large CLAUDE.md hits cache constantly, so folding it in projects badly
   *  wrong in the EXPENSIVE direction — and no later migration recovers data
   *  that was never captured. */
  readonly tokensCached: number | null
  readonly source: TokensSource | null
}

/** One row of `POST /api/v1/analytics/query`'s `data.data[]`. Every field is
 *  `unknown` on purpose: the API is in beta, its own docs say the schema may
 *  drift, and the parse is where that is absorbed. */
export interface AnalyticsRow {
  readonly tokens_prompt?: unknown
  readonly tokens_completion?: unknown
  readonly cache_hit_rate?: unknown
  /**
   * ⚠ A DIRECT CACHED-TOKEN METRIC EXISTS, AND THE DOCUMENTATION DOES NOT LIST IT.
   *
   * The published metric list (cookbook, 2026-07-25) has `cache_hit_rate` and
   * `usage_cache` — a ratio and a dollar figure — and no cached-TOKEN metric, so
   * the design was built to DERIVE. Querying the live `GET /api/v1/analytics/meta`
   * at execution returned **35 metrics including `cached_tokens`**.
   *
   * This is exactly the drift OpenRouter's own docs warn about ("query what's
   * actually there instead of trusting a doc snapshot") and precisely why the
   * D4 obligation was to VERIFY rather than to read. Both spellings are accepted:
   * `cached_tokens` is what the live API returns today, `tokens_cached` is the
   * symmetric name a future rename would plausibly use.
   */
  readonly cached_tokens?: unknown
  readonly tokens_cached?: unknown
}

/**
 * Turn an analytics result into the three token numbers, or into an honest
 * "not yet".
 *
 * `truncated` is fatal by design: `metadata.truncated === true` means the query
 * hit the row limit and the totals are PARTIAL. Writing a partial total as if
 * it were complete is the same class of error as writing a fabricated zero.
 */
export function interpretTokenRow(input: {
  readonly row: AnalyticsRow | null | undefined
  readonly truncated: boolean
}): { ok: true; tokens: TokenBreakdown } | { ok: false; reason: 'truncated' | 'no-data' } {
  if (input.truncated) return { ok: false, reason: 'truncated' }
  if (!input.row) return { ok: false, reason: 'no-data' }

  const tokensIn = parseCount(input.row.tokens_prompt)
  const tokensOut = parseCount(input.row.tokens_completion)

  // Prefer the DIRECT cached-token metric — which the live API has and the docs
  // do not mention — and fall back to the derivation only when it is absent.
  // The label is the whole point: a measured number says 'analytics', a derived
  // one says 'analytics-derived', and no reader has to guess which they hold.
  const direct = parseCount(input.row.cached_tokens ?? input.row.tokens_cached)
  if (direct !== null) {
    return { ok: true, tokens: { tokensIn, tokensOut, tokensCached: direct, source: 'analytics' } }
  }

  const rate = parseRate(input.row.cache_hit_rate)
  if (rate === null || tokensIn === null) {
    // Cached tokens are unknown — which is NOT zero. Fresh in/out may still be
    // known and are still worth writing.
    const source: TokensSource | null = tokensIn === null && tokensOut === null ? null : 'analytics'
    return { ok: true, tokens: { tokensIn, tokensOut, tokensCached: null, source } }
  }
  return {
    ok: true,
    tokens: {
      tokensIn,
      tokensOut,
      // ⚠ Derived, and NOT subtracted from tokensIn. tokens_prompt is the total
      // prompt tokens; the cached portion is a SUBSET reported separately so a
      // consumer can price the two tiers. Reducing tokensIn here would make the
      // two columns non-additive and silently under-report prompt volume.
      tokensCached: Math.round(tokensIn * rate),
      source: 'analytics-derived'
    }
  }
}

/* ------------------------------------------------------------------------ */
/* Orphan reconciliation — the pure classifier (§6.1's EXACT matrix)         */
/* ------------------------------------------------------------------------ */

/** One live key as `GET /api/v1/keys` reports it. */
export interface LiveKeySummary {
  readonly hash: string
  readonly name: string | null
}

/** One OPEN ledger row: a dispatch we minted for and have not revoked. */
export interface OpenLedgerRow {
  readonly dispatchId: string
  readonly hash: string
}

export type ReconcileAction =
  /** Ours, live, its dispatch is not running: read usage, then revoke, then
   *  close the row `attribution_state='orphan-reconciled'`. */
  | { readonly kind: 'read-and-revoke'; readonly hash: string; readonly dispatchId: string }
  /** Ours by NAME PREFIX but absent from the ledger — minted, then the record
   *  was lost (a crash in the window between the mint returning and the
   *  write-ahead persist committing). Revoke it: a key we cannot account for is
   *  a key we must not keep. */
  | { readonly kind: 'revoke-unattributed'; readonly hash: string }
  /** Ledger row open, key gone (hand-deleted, or expired). Close the row and
   *  mark spend UNKNOWN. NEVER write 0. */
  | { readonly kind: 'close-unknown'; readonly dispatchId: string }

/**
 * ⚠ THE ABSOLUTE PROHIBITION: a live key whose name does not start with
 * MINT_NAME_PREFIX produces NO ACTION. Not a warning that becomes an action,
 * not a "probably ours". The user's own keys, their other tools' keys, and
 * anything created in the dashboard are INVISIBLE to this function.
 *
 * The test is `name.startsWith(MINT_NAME_PREFIX)` — case-SENSITIVE, anchored at
 * index 0, and a missing or empty name is NOT ours:
 *  - `.includes()` would match a user key named "backup of chorus-dispatch- experiment";
 *  - a case-insensitive test would match "Chorus-Dispatch-…" made by hand;
 *  - treating a nameless key as ours would delete anything the API omits a name for.
 *
 * A false positive deletes a credential the user created and depends on, with
 * no notification and no undo.
 */
export function isChorusMintedName(name: string | null | undefined): boolean {
  return typeof name === 'string' && name.startsWith(MINT_NAME_PREFIX)
}

/**
 * The §6.1 matrix, whole:
 *
 * | # | Live | In ledger | Our prefix | Running | Action                |
 * |---|------|-----------|------------|---------|-----------------------|
 * | 1 | yes  | yes       | yes        | no      | read-and-revoke       |
 * | 2 | yes  | yes       | yes        | yes     | none (it owns its key)|
 * | 3 | yes  | no        | yes        | —       | revoke-unattributed   |
 * | 4 | yes  | —         | NO         | —       | ⚠ NONE — NOT OURS     |
 * | 5 | no   | yes       | —          | —       | close-unknown         |
 *
 * NOTE ON THE SIGNATURE: the spec sketched a `now: Date` parameter. It is
 * deliberately ABSENT. The only thing a clock could contribute is expiry-based
 * classification, and D4 obligation 5 could not confirm that OpenRouter stops
 * honouring a key at `expires_at` — so classifying on it would be leaning on an
 * unverified guarantee to decide whether to destroy a credential. An unused
 * parameter would be worse than none; an unverified one would be worse still.
 */
export function computeKeyReconcile(input: {
  readonly liveKeys: readonly LiveKeySummary[]
  readonly openLedger: readonly OpenLedgerRow[]
  readonly runningDispatchIds: ReadonlySet<string>
}): readonly ReconcileAction[] {
  const actions: ReconcileAction[] = []
  const ledgerByHash = new Map(input.openLedger.map((r) => [r.hash, r]))
  const liveHashes = new Set(input.liveKeys.map((k) => k.hash))

  for (const key of input.liveKeys) {
    // ── Row 4, FIRST and unconditional. Everything below this line has already
    //    proven ownership; nothing below may re-open the question. ───────────
    if (!isChorusMintedName(key.name)) continue

    const ledger = ledgerByHash.get(key.hash)
    if (!ledger) {
      actions.push({ kind: 'revoke-unattributed', hash: key.hash }) // row 3
      continue
    }
    // Row 2: a live dispatch owns its key. Leave it alone.
    if (input.runningDispatchIds.has(ledger.dispatchId)) continue
    actions.push({ kind: 'read-and-revoke', hash: key.hash, dispatchId: ledger.dispatchId }) // row 1
  }

  for (const row of input.openLedger) {
    // Row 5: we hold an open ledger row for a key OpenRouter no longer lists —
    // hand-deleted, or expired. There is nothing to revoke and nothing to read;
    // the row is closed with spend UNKNOWN rather than 0.
    if (!liveHashes.has(row.hash)) actions.push({ kind: 'close-unknown', dispatchId: row.dispatchId })
  }

  return actions
}

/* ------------------------------------------------------------------------ */
/* "% of spend attributed" (D42) — with its denominators (D55)               */
/* ------------------------------------------------------------------------ */

/** The subset of a `dispatches` row the summary reasons over. */
export interface TelemetryRowSummary {
  readonly attributionState: AttributionState
  /** The row's own `auth_mode` column — 3a-1 writes it, this task never does. */
  readonly authMode: string
  readonly costUsd: number | null
  /** §8: how this row's tokens were obtained, so the DERIVED share is visible
   *  in the summary rather than implied. NULL = unknown. */
  readonly tokensSource?: TokensSource | null
}

/** How many rows' tokens were measured versus derived versus unknown. Sums to
 *  the row count, so the derived share is checkable rather than asserted. */
export interface TokensSourceBreakdown {
  readonly analytics: number
  readonly analyticsDerived: number
  readonly cliLogs: number
  readonly unknown: number
}

/**
 * ⚠ D55, INHERITED FROM 3a-2 AND BINDING: no telemetry number ships without its
 * denominator, enforced by SCHEMA rather than by discipline.
 *
 * 3a-2 discharged that by removing the derived number entirely (`attention:
 * summary` has no `minutes` field). Here it cannot be removed — D42 names "% of
 * spend attributed" as the deliverable metric — so the equivalent move is that
 * every ratio travels with the counts it was computed from, and the outbound
 * `.parse` in main REQUIRES all of them. A response that lets a caller read a
 * percentage alone does not parse.
 *
 * TWO ratios, both labelled, because neither alone is honest:
 *  - `spendPct` answers "of the dollars I spent through the gateway, what
 *    fraction landed on a dispatch?" It cannot see subscription work at all.
 *  - `dispatchPct` answers "of the sessions I ran, what fraction got full
 *    fidelity?" It counts subscription sessions, but has no dollars.
 */
export interface AttributionSummary {
  /** null when the gateway total is unknown OR zero — never 0, never NaN. */
  readonly spendPct: number | null
  /** null on a zero-dispatch window — never 0. */
  readonly dispatchPct: number | null
  readonly attributedUsd: number
  /**
   * Gateway dollars that did NOT land on a dispatch. Deliberately derived from
   * the ACCOUNT total rather than summed from our own rows, which is what makes
   * it able to see spend we have no row for at all — a key minted whose ledger
   * write never landed, or spend from another tool on the same account.
   *
   * `number | null` rather than the spec's `number`: without a gateway total
   * there is no honest value, and 0 would claim everything was attributed.
   */
  readonly unattributedUsd: number | null
  readonly gatewayTotalUsd: number | null
  readonly totalDispatches: number
  readonly attributedDispatches: number
  /** ⚠ COUNTED, NEVER PRICED. Inventing a $/token rate for a flat-rate
   *  subscription would fabricate exactly the number D42 wants made VISIBLE. */
  readonly subscriptionDispatches: number
  readonly tokensSourceBreakdown: TokensSourceBreakdown
}

/** A dispatch is FULLY attributed when its spend is known and it is tied to a
 *  dispatch. `orphan-reconciled` qualifies: the crash cost us the clean close,
 *  not the identity or the number. Everything else — mint-failed, revoke-failed,
 *  none, cli-logs, and still-open `minted` — does not. */
function isFullyAttributed(row: TelemetryRowSummary): boolean {
  if (row.costUsd === null || !Number.isFinite(row.costUsd)) return false
  return row.attributionState === 'closed' || row.attributionState === 'orphan-reconciled'
}

export function computeAttributionSummary(input: {
  readonly rows: readonly TelemetryRowSummary[]
  /** Total OpenRouter account spend over the window, from the analytics API.
   *  `null` when it could not be read — which stays null all the way out. */
  readonly gatewayTotalUsd: number | null
}): AttributionSummary {
  let attributedUsd = 0
  let attributedDispatches = 0
  let subscriptionDispatches = 0
  const tokensSourceBreakdown = { analytics: 0, analyticsDerived: 0, cliLogs: 0, unknown: 0 }

  for (const row of input.rows) {
    if (row.authMode === 'subscription') subscriptionDispatches++
    switch (row.tokensSource) {
      case 'analytics':
        tokensSourceBreakdown.analytics++
        break
      case 'analytics-derived':
        tokensSourceBreakdown.analyticsDerived++
        break
      case 'cli-logs':
        tokensSourceBreakdown.cliLogs++
        break
      default:
        tokensSourceBreakdown.unknown++
    }
    if (!isFullyAttributed(row)) continue
    attributedDispatches++
    // Subscription rows can never reach here with dollars: nothing writes
    // cost_usd on a cli-logs row, and the state check above excludes them.
    attributedUsd += row.costUsd as number
  }

  const totalDispatches = input.rows.length
  const gatewayTotalUsd =
    input.gatewayTotalUsd !== null && Number.isFinite(input.gatewayTotalUsd)
      ? input.gatewayTotalUsd
      : null

  return {
    // A zero denominator yields null, NOT 0 and NOT NaN — "I spent nothing" and
    // "I attributed none of what I spent" are different facts.
    spendPct: gatewayTotalUsd === null || gatewayTotalUsd === 0 ? null : attributedUsd / gatewayTotalUsd,
    dispatchPct: totalDispatches === 0 ? null : attributedDispatches / totalDispatches,
    attributedUsd,
    // Clamped at 0: our sum can exceed the account total mid-window (a key read
    // after the analytics window closed), and a negative "unattributed" figure
    // would read as a bug rather than as rounding.
    unattributedUsd: gatewayTotalUsd === null ? null : Math.max(0, gatewayTotalUsd - attributedUsd),
    gatewayTotalUsd,
    totalDispatches,
    attributedDispatches,
    subscriptionDispatches,
    tokensSourceBreakdown
  }
}
