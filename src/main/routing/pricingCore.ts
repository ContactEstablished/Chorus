import type { CandidateCost, RawPricing, RawPricingOverride, TokenShares } from '../../shared/routing'

/**
 * Model Routing Task 1-1: time-of-day pricing overrides (K11, MR-D13, C4),
 * row-price collapse (K8) and blended cost (K11, MR-D9, C5).
 *
 * Pure: the clock is never read. `now` is a parameter that must be a UTC ISO
 * instant ending in `Z` (a string without an offset is read as local time by
 * `Date.parse`; the entry-point check for that lands in Task 1-3's
 * `computeTiers`). It is parsed with `Date.parse`, an unparseable value throws
 * `RangeError`, and a Date is constructed only from the parsed number to read
 * its UTC fields. `resolvePricing` is the one place a per-token string becomes $/M.
 */

export interface ResolvedPricing {
  promptPerM: number
  completionPerM: number
  cacheReadPerM: number | null
  cacheWritePerM: number | null
  overrideApplied: boolean
}

export interface CollapsedPricing { promptPerM: number; completionPerM: number; cachePricePerM: number; overrideApplied: boolean }

/** Index = `getUTCDay()`. */
const UTC_WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const

/** OpenRouter per-token USD string to USD per million tokens. */
export function perTokenToPerMillion(price: string): number {
  // `+ 0` normalises -0 to 0, so results survive a JSON round trip unchanged.
  return Number(price) * 1_000_000 + 0
}

/**
 * Whether one override entry applies at `now` (K11, C4). Times are HHMM UTC
 * with seconds ignored: start inclusive, end exclusive, `end <= start` wraps
 * midnight. `utc_days` is tested against the UTC weekday of `now`
 * (case-insensitive; an unrecognised name or an empty list never matches).
 * `min_prompt_tokens` applies only when `promptTokens` strictly exceeds it.
 *
 * `now` must be a UTC ISO instant ending in `Z`; an unparseable `now` throws
 * `RangeError('Invalid time: now')` rather than half-applying the schedule.
 */
export function overrideApplies(override: RawPricingOverride, now: string, promptTokens: number): boolean {
  const ms = Date.parse(now)
  if (Number.isNaN(ms)) throw new RangeError('Invalid time: now')
  const d = new Date(ms)
  const day: string | undefined = UTC_WEEKDAYS[d.getUTCDay()]
  const t = d.getUTCHours() * 100 + d.getUTCMinutes()

  if (override.min_prompt_tokens !== undefined && !(promptTokens > override.min_prompt_tokens)) return false
  if (override.utc_days !== undefined && !override.utc_days.some((name) => name.toLowerCase() === day)) return false
  if (override.utc_start === undefined && override.utc_end === undefined) return true

  const start = override.utc_start ?? 0
  const end = override.utc_end ?? 0
  if (end > start) return start <= t && t < end
  return t >= start || t < end
}

/**
 * Base prices with every applicable override applied in array order: later
 * entries win per key, absent keys inherit the earlier value (ultimately the
 * base). An absent cache key resolves to `null`. An unparseable `now` throws
 * `RangeError` as soon as an override has to be evaluated.
 */
export function resolvePricing(pricing: RawPricing, now: string, promptTokens: number): ResolvedPricing {
  let prompt = pricing.prompt
  let completion = pricing.completion
  let cacheRead = pricing.input_cache_read
  let cacheWrite = pricing.input_cache_write
  let overrideApplied = false
  for (const override of pricing.overrides ?? []) {
    if (!overrideApplies(override, now, promptTokens)) continue
    overrideApplied = true
    if (override.prompt !== undefined) prompt = override.prompt
    if (override.completion !== undefined) completion = override.completion
    if (override.input_cache_read !== undefined) cacheRead = override.input_cache_read
    if (override.input_cache_write !== undefined) cacheWrite = override.input_cache_write
  }
  return {
    promptPerM: perTokenToPerMillion(prompt),
    completionPerM: perTokenToPerMillion(completion),
    cacheReadPerM: cacheRead === undefined ? null : perTokenToPerMillion(cacheRead),
    cacheWritePerM: cacheWrite === undefined ? null : perTokenToPerMillion(cacheWrite),
    overrideApplied
  }
}

/**
 * The prices of rows sharing a tag (K8: maximum of each price). A row without
 * a cache-read price contributes its prompt price. An empty list yields
 * non-finite prices, which `blendedCost` rejects.
 */
export function collapsePricing(rows: ResolvedPricing[]): CollapsedPricing {
  return {
    promptPerM: Math.max(...rows.map((r) => r.promptPerM)),
    completionPerM: Math.max(...rows.map((r) => r.completionPerM)),
    cachePricePerM: Math.max(...rows.map((r) => r.cacheReadPerM ?? r.promptPerM)),
    overrideApplied: rows.some((r) => r.overrideApplied)
  }
}

/**
 * Blended $/M at a profile's token mix (K11, MR-D9). The cached share earns the
 * cache price only when the tag's cache discount was verified; otherwise it is
 * priced as fresh prompt. `null` (C5: no usable price) when any price is
 * negative or not finite, or the blend is not positive.
 */
export function blendedCost(prices: CollapsedPricing, shares: TokenShares, cacheVerified: boolean): CandidateCost | null {
  const { promptPerM, completionPerM, cachePricePerM } = prices
  if (![promptPerM, completionPerM, cachePricePerM].every((p) => Number.isFinite(p) && p >= 0)) return null
  const cachedPrice = cacheVerified ? cachePricePerM : promptPerM
  const fresh = shares.fresh * promptPerM
  const cached = shares.cached * cachedPrice
  const output = shares.output * completionPerM
  const blended = fresh + cached + output
  if (!Number.isFinite(blended) || blended <= 0) return null
  return {
    blended,
    fresh,
    cached,
    output,
    cacheCredit: cacheVerified,
    overrideApplied: prices.overrideApplied,
    promptPerM,
    completionPerM,
    cacheReadPerM: cachePricePerM
  }
}
