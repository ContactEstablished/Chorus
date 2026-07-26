import type { ModelCatalogRow } from '../db/schema'

/**
 * Task 3a-4: the PURE half of the model catalog — response parsing, per-row
 * validation, the refresh diff, the freshness predicate, and the fixed failure
 * vocabulary.
 *
 * No `electron`, no `fetch`, no `node:fs`, NO CLOCK — `now` is a parameter.
 * Precedent: vaultCore.ts, computeRestoreSet (restore.ts),
 * computeWorktreeReconcile (worktrees.ts), attributionCore.ts (3a-3).
 *
 * ⚠ THE ONE THING THIS MODULE MAY NEVER LEARN TO DO. A catalog is a list of
 * what exists — it is not authoritative over `provider_configs.model` or
 * `launch_profiles.model`, it has no position in the precedence order, and it
 * never writes to either home. `CatalogDiff` is deliberately incapable of
 * expressing "clear the route's model" or "default the route to X"; the unit
 * test asserts over its KEY SET so a future field cannot smuggle one in. See
 * the v9 migration comment in storage.ts for the full ruling.
 */

/** One validated model, as it will be stored. Provider text is already
 *  sanitized and capped by the time a value of this type exists. */
export interface CatalogModel {
  readonly modelId: string
  readonly displayName: string
  readonly contextLength: number | null
  readonly expiresAt: string | null
}

/** A catalog row as the storage layer will write it. `firstSeenAt` is consumed
 *  by the INSERT branch only — the upsert's UPDATE branch deliberately omits
 *  it (and `missing_since`), which is what makes "first seen" an audit fact
 *  rather than a synonym for "last refreshed". */
export interface StoredModel extends CatalogModel {
  readonly firstSeenAt: string
  readonly refreshedAt: string
}

/**
 * The whole outcome of one refresh, as INSTRUCTIONS TO STORAGE.
 *
 * ⚠ There is deliberately NO field here that names provider_configs or
 * launch_profiles. The diff cannot express "clear the route's model" or
 * "default the route to X" because those instructions must not exist.
 *
 * `addedCount`/`updatedCount` are computed HERE rather than by the IPC
 * handler: the handler is dumb by contract (spec §6.2, "it contains no
 * policy"), and this module is the one that already knows which upserts were
 * new. They are counts, never ids — D42/D55's telemetry rule.
 */
export interface CatalogDiff {
  /** The ONE instant this whole refresh is stamped with. Carried here so the
   *  storage layer needs no clock of its own and cannot straddle two. */
  readonly nowIso: string
  /** Seen this refresh. Never touches missing_since — that is the two lists
   *  below, so a "seen" row cannot silently clear a mark it never carried. */
  readonly upserts: readonly StoredModel[]
  /** Catalogued, not seen this refresh, and NOT ALREADY MARKED. */
  readonly markMissing: readonly string[]
  /** Marked missing, seen again. */
  readonly clearMissing: readonly string[]
  readonly addedCount: number
  readonly updatedCount: number
  /** Rows the provider sent that failed validation. Reported, never silently
   *  swallowed: a provider that suddenly fails validation on half its list is
   *  a finding. */
  readonly droppedCount: number
}

export type CatalogFreshness = 'never' | 'fresh' | 'stale'

export interface ParsedModels {
  readonly ok: true
  readonly models: readonly CatalogModel[]
  readonly droppedCount: number
}

export interface RefreshRefusal {
  readonly ok: false
  readonly reason: string
}

/* ─── The fixed failure vocabulary ───────────────────────────────────── */

/**
 * Every reason this module or its transport can return, as FIXED strings.
 * No provider body, no header, no exception message, no URL, no key, ever —
 * `probeCredential`'s discipline, and the four shared strings are verbatim
 * copies of its vocabulary so the app speaks with one voice about a provider
 * that said no.
 *
 * ⚠ These are COPIES, not a shared helper. `probeCredential` is untouched by
 * this task (Goal §3): two call shapes with two vocabularies that happen to
 * agree, and a shared helper would make the next change to one silently
 * change the other.
 */
export const REFRESH_FAILURE = {
  /** 2xx whose body is not `{data: [...]}`, is unparseable, or exceeds the cap.
   *  ⚠ The received shape is NEVER named — that is a body echo wearing a
   *  diagnostic hat. */
  unrecognized: 'The provider returned an unrecognized model list.',
  authFailed: 'Authentication failed — the credential was rejected.',
  rateLimited: 'Rate limited by the provider.',
  providerError: 'The provider returned an error.',
  unreachable: 'Could not reach the provider.',
  management: 'Model refresh is not available for a management credential.'
} as const

export function noBaseUrlFailure(providerName: string): string {
  return `Provider '${providerName}' has no base URL to refresh models from.`
}

export function unexpectedStatusFailure(status: number): string {
  return `Unexpected response (${status}).`
}

/** Mirrors `probeFailure` in ipc.ts. The transport passes every message
 *  through `scrubSecrets` as the final net (spec §5.3) — this module stays
 *  pure and imports nothing. */
export function refreshFailure(message: string): RefreshRefusal {
  return { ok: false, reason: message }
}

/* ─── Response parsing and per-row validation ────────────────────────── */

/**
 * ⚠ THIS STRING REACHES ARGV AS `-m <id>`. A space, a quote, a newline or an
 * ANSI escape in a model id is a third party writing into a command line, and
 * the fact that `-m` takes its own argv token is not a reason to accept it.
 *
 * `~` is admitted deliberately. D4-measured against the live OpenRouter list
 * on 2026-07-25: the complete set of non-alphanumeric characters across all
 * 345 published ids is exactly `- . / : ~`, and 10 of them use the `~` "latest
 * alias" prefix (`~anthropic/claude-opus-latest`, `~openai/gpt-latest`, …).
 * Spec §4.2's charset omitted `~` and would drop all ten on EVERY refresh of
 * the one route the app ships — which is precisely how a real `droppedCount`
 * signal gets trained into noise. `~` is not a shell metacharacter risk here:
 * node-pty is handed an argv ARRAY, never a shell string, and the guardrail
 * this pattern exists for is untouched.
 */
export const MODEL_ID_PATTERN = /^[A-Za-z0-9._:/@~-]{1,200}$/

/** Provider-authored display text renders in the DOM. Cap measured against the
 *  live list (longest published name: 56 chars) with room to spare. */
export const DISPLAY_NAME_CAP = 200

/** Strip C0 controls + DEL from provider-authored text, then trim and cap.
 *  Same treatment `sanitizeTitle` gives raw terminal output. */
export function sanitizeDisplayName(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, DISPLAY_NAME_CAP)
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** A finite, non-negative integer, or null. ⚠ A non-numeric value yields
 *  `null`, never `NaN` and never `0` — `0` and "unknown" must stay
 *  distinguishable (3a-3's rule, same reasoning). */
function toContextLength(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null
  return Math.floor(v)
}

/** An ISO-parseable date string, or null. OpenRouter publishes
 *  `expiration_date` as a bare `YYYY-MM-DD` (D4-measured 2026-07-25: populated
 *  on 7 of 345 models), which Date.parse handles. */
function toExpiresAt(v: unknown): string | null {
  if (typeof v !== 'string' || v.length === 0 || v.length > 64) return null
  return Number.isNaN(Date.parse(v)) ? null : v
}

/**
 * Parse a provider's `/models` response. The expected shape is `{data: [...]}`
 * (D4-verified 2026-07-25 against the live OpenRouter endpoint, whose top
 * level is `data` + `total_count` + `links` — extra keys are ignored, not
 * rejected). Anything else yields the fixed unrecognized-shape refusal.
 *
 * A malformed ROW is DROPPED WITH A COUNT, never thrown on: one bad entry in a
 * list of hundreds must not cost the user the whole catalog.
 */
export function parseModelsResponse(body: unknown): ParsedModels | RefreshRefusal {
  if (!isPlainObject(body) || !Array.isArray(body.data)) {
    return refreshFailure(REFRESH_FAILURE.unrecognized)
  }
  const models: CatalogModel[] = []
  const seenIds = new Set<string>()
  let droppedCount = 0
  for (const raw of body.data) {
    if (!isPlainObject(raw)) {
      droppedCount++
      continue
    }
    const id = raw.id
    if (typeof id !== 'string' || !MODEL_ID_PATTERN.test(id)) {
      droppedCount++
      continue
    }
    // A duplicate id in ONE response would double-apply through the upsert.
    // First occurrence wins; the rest are dropped and counted.
    if (seenIds.has(id)) {
      droppedCount++
      continue
    }
    seenIds.add(id)
    const named = typeof raw.name === 'string' ? sanitizeDisplayName(raw.name) : ''
    models.push({
      modelId: id,
      // An all-control-character name sanitizes to empty; the id is a truthful
      // label and is never itself empty (the pattern requires >= 1 char).
      displayName: named.length > 0 ? named : id,
      contextLength: toContextLength(raw.context_length),
      expiresAt: toExpiresAt(raw.expiration_date)
    })
  }
  return { ok: true, models, droppedCount }
}

/* ─── The diff ───────────────────────────────────────────────────────── */

/**
 * Four populations, four rules:
 *
 *  | in `seen`, not in `existing`                          | upsert; first_seen = refreshed = now |
 *  | in `seen`, in `existing`                              | upsert; first_seen PRESERVED; mark cleared if set |
 *  | in `existing`, not in `seen`, missing_since NULL      | markMissing — set it to now, ONCE |
 *  | in `existing`, not in `seen`, missing_since ALREADY SET | NO ACTION |
 *
 * ⚠ The fourth rule is the easiest one to get wrong, because setting the date
 * unconditionally reads as simpler code. If it moved, "missing since" would
 * read as "today" forever and the user could never tell whether a model
 * vanished this morning or last month.
 *
 * ⚠ And the fifth population that does not exist: there is no rule here that
 * touches a provider's default model, under ANY input — including the input
 * where the route's default is the id that just went missing.
 */
export function computeCatalogDiff(
  existing: readonly ModelCatalogRow[],
  seen: readonly CatalogModel[],
  nowIso: string,
  droppedCount = 0
): CatalogDiff {
  const byId = new Map(existing.map((r) => [r.modelId, r]))
  const seenIds = new Set(seen.map((m) => m.modelId))

  const upserts: StoredModel[] = []
  const clearMissing: string[] = []
  let addedCount = 0
  let updatedCount = 0

  for (const m of seen) {
    const prior = byId.get(m.modelId)
    if (prior) {
      updatedCount++
      // firstSeenAt is carried through for completeness; the UPDATE branch of
      // the upsert does not write it.
      upserts.push({ ...m, firstSeenAt: prior.firstSeenAt, refreshedAt: nowIso })
      if (prior.missingSince !== null) clearMissing.push(m.modelId)
    } else {
      addedCount++
      upserts.push({ ...m, firstSeenAt: nowIso, refreshedAt: nowIso })
    }
  }

  const markMissing: string[] = []
  for (const row of existing) {
    if (seenIds.has(row.modelId)) continue
    // ⚠ ONLY when it is not already marked. A still-missing model is left
    // exactly as it is.
    if (row.missingSince === null) markMissing.push(row.modelId)
  }

  return { nowIso, upserts, markMissing, clearMissing, addedCount, updatedCount, droppedCount }
}

/* ─── Freshness ──────────────────────────────────────────────────────── */

export const CATALOG_STALE_AFTER_MS = 24 * 60 * 60 * 1000

/**
 * ⚠ `'never'` IS A THIRD STATE, NOT A FLAVOUR OF `'stale'`. An implementation
 * that folds them looks right on a populated database and wrong on every fresh
 * install — which is every new user.
 *
 * THE THRESHOLD LIVES HERE AND NOWHERE ELSE. `model:list` sends the renderer a
 * computed value; the renderer does no date arithmetic, because a
 * renderer-side threshold is a second home for the policy and would drift the
 * first time someone changed it.
 */
export function catalogFreshness(refreshedAt: string | null, nowIso: string): CatalogFreshness {
  if (refreshedAt === null) return 'never'
  const then = Date.parse(refreshedAt)
  const now = Date.parse(nowIso)
  // An undateable timestamp on a table that HAS rows is not "never" — rows
  // exist. Warn rather than claim freshness we cannot establish.
  if (Number.isNaN(then) || Number.isNaN(now)) return 'stale'
  return now - then < CATALOG_STALE_AFTER_MS ? 'fresh' : 'stale'
}
