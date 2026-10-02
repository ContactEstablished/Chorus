import { z } from 'zod'

import type { CacheProbeOutcome, CacheVerification, CandidateCost, ProbeSkip, TierResult } from '../../shared/routing'
import { byCodeUnit } from './endpointsCore'

/**
 * Model Routing Task 2-1: the automatic prompt-cache probe (MR-D9, MR-D18, K4,
 * C4-C7). Phase 0 showed that `supports_implicit_caching` does not predict
 * whether an endpoint serves cached reads, so caching is verified by sending
 * the same long prefix three times, pinned to one endpoint, and reading
 * `cached_tokens`. This module plans which tags to probe within the $ cap,
 * builds the request body, and turns the three responses into an outcome and
 * a spend.
 *
 * The prompt is Phase 0's measured shape (C4), never user content. The run
 * nonce, `now` and the stored cache are parameters: the service draws the
 * nonce and reads the clock.
 *
 * Pure: no clock, no randomness, no environment, no file system, no network.
 */

export const CACHE_PROBE_CAP_USD = 0.05 // MR-D18
export const CACHE_PROBE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000 // MR-D9: re-probe a record older than 14 days
export const CACHE_PROBE_CALLS = 3
export const CACHE_PROBE_MAX_TOKENS = 64
export const CACHE_PROBE_PROMPT_TOKENS = 4500 // measured 4,457–4,464 (C4)
export const CACHE_PROBE_FILLER_LINES = 220
export const CACHE_PROBE_CONCURRENCY = 5
export const CACHE_PROBE_GAP_MS = 1500
export const CACHE_PROBE_USER_TEXT = 'Reply with the single word OK.'

/** Phase 0's filler, byte for byte (verify-routing-live.ts:78): 16,305 characters. */
const FILLER = Array.from(
  { length: CACHE_PROBE_FILLER_LINES },
  (_, i) => `export function step${i}(value: number): number { return value * ${i + 3} + ${(i * 7) % 11}; }`
).join('\n')

export function probeFiller(): string {
  return FILLER
}

/** C5: the nonce is per run and the tag is part of the prefix, so two tags never share a cached prefix. */
export function probeSystemText(runNonce: string, tag: string): string {
  return `Session ${runNonce} ${tag}. Reference module follows.\n${probeFiller()}`
}

export interface ProbeRequestBody {
  model: string
  provider: { order: string[]; allow_fallbacks: false }
  messages: { role: 'system' | 'user'; content: string }[]
  reasoning: { effort: 'low' }
  max_tokens: 64
}

/** Exact key order. No `data_collection`: the probe carries no user content, and Phase 0 measured this shape. */
export function probeRequestBody(model: string, tag: string, runNonce: string): ProbeRequestBody {
  return {
    model,
    provider: { order: [tag], allow_fallbacks: false },
    messages: [
      { role: 'system', content: probeSystemText(runNonce, tag) },
      { role: 'user', content: CACHE_PROBE_USER_TEXT }
    ],
    reasoning: { effort: 'low' },
    max_tokens: CACHE_PROBE_MAX_TOKENS
  }
}

/** Worst case for one tag: three calls at uncached prices, 4,500 prompt tokens and 64 output tokens each. */
export function probeTagEstimateUsd(cost: Pick<CandidateCost, 'promptPerM' | 'completionPerM'>): number {
  return (
    (CACHE_PROBE_CALLS * (cost.promptPerM * CACHE_PROBE_PROMPT_TOKENS + cost.completionPerM * CACHE_PROBE_MAX_TOKENS)) / 1_000_000
  )
}

export interface ProbePlanInput {
  result: TierResult // the refresh's own computeTiers result
  cache: CacheVerification // as stored
  now: string // UTC ISO instant
  capUsd: number
  tagLimit: number | null // verification-only (C21)
}
export interface ProbePlan {
  planned: { tag: string; estimateUsd: number }[] // Balanced-score order
  estimateUsd: number // sum of planned, in plan order
  capUsd: number
  fresh: string[] // eligible tags with a record at most 14 days old, sorted by tag
  notProbed: ProbeSkip[] // reasons 'cap' or 'limit' only, in Balanced-score order
}

/** The same UTC-instant check `computeTiers` applies: a string without an offset would be read as local time. */
const utcInstant = z.iso.datetime()

interface Due { tag: string; balanced: number; estimateUsd: number }

/**
 * Plans the probe (K4, C7). Eligible candidates are walked in Balanced-score
 * order; a tag is due when it has no cache record or its record is older than
 * 14 days. The cap cut is a prefix: the first due tag that would push the
 * cumulative estimate over the cap, and every later one, is skipped with `cap`,
 * never skipping ahead to a cheaper tag. Throws `RangeError` on an invalid
 * `now`, a cap that is not a finite non-negative number, or a tag limit that is
 * neither null nor a non-negative integer (review minor 2): a NaN cap would
 * otherwise plan nothing and a NaN limit would plan everything, both silently.
 */
export function planCacheProbe(input: ProbePlanInput): ProbePlan {
  // 1. Time, cap and limit.
  const nowMs = utcInstant.safeParse(input.now).success ? Date.parse(input.now) : Number.NaN
  if (Number.isNaN(nowMs)) throw new RangeError('Invalid time: now')
  if (!Number.isFinite(input.capUsd) || input.capUsd < 0) throw new RangeError('Invalid cap')
  if (input.tagLimit !== null && !(Number.isInteger(input.tagLimit) && input.tagLimit >= 0)) {
    throw new RangeError('Invalid tag limit')
  }

  // 2-3. Eligible candidates, by Balanced score descending, ties by tag.
  const eligible: Due[] = []
  for (const c of input.result.candidates) {
    const balanced = c.scores.balanced
    if (c.excludedBy.length !== 0 || c.cost === null || balanced === undefined) continue
    eligible.push({ tag: c.tag, balanced, estimateUsd: probeTagEstimateUsd(c.cost) })
  }
  eligible.sort((a, b) => (a.balanced !== b.balanced ? (a.balanced > b.balanced ? -1 : 1) : byCodeUnit(a.tag, b.tag)))

  // 4. Due or fresh. Written as "not at most 14 days old" so a record whose
  // checkedAt does not parse (a NaN age) is due, never fresh; exactly 14 days
  // old is still fresh.
  const due: Due[] = []
  const fresh: string[] = []
  for (const e of eligible) {
    const record = Object.hasOwn(input.cache, e.tag) ? input.cache[e.tag] : undefined
    if (record === undefined || !(nowMs - Date.parse(record.checkedAt) <= CACHE_PROBE_MAX_AGE_MS)) due.push(e)
    else fresh.push(e.tag)
  }
  fresh.sort(byCodeUnit)

  // 5. Walk the due tags.
  const planned: ProbePlan['planned'] = []
  const notProbed: ProbeSkip[] = []
  let capCut = false
  let cum = 0
  for (const d of due) {
    if (capCut) notProbed.push({ tag: d.tag, reason: 'cap' })
    else if (input.tagLimit !== null && planned.length >= input.tagLimit) notProbed.push({ tag: d.tag, reason: 'limit' })
    else if (cum + d.estimateUsd > input.capUsd) {
      capCut = true
      notProbed.push({ tag: d.tag, reason: 'cap' })
    } else {
      planned.push({ tag: d.tag, estimateUsd: d.estimateUsd })
      cum += d.estimateUsd
    }
  }

  // 6. Total.
  return { planned, estimateUsd: cum, capUsd: input.capUsd, fresh, notProbed }
}

export interface ProbeUsage { promptTokens: number | null; cachedTokens: number | null; costUsd: number | null }

/** An own property of a plain object, else `undefined`. */
function member(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined
}

function countOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

/**
 * The three usage numbers, field by field and each independently; any missing
 * level gives `null`. The completion text is never read.
 */
export function extractProbeUsage(body: unknown): ProbeUsage {
  const usage = member(body, 'usage')
  const cost = member(usage, 'cost')
  return {
    promptTokens: countOrNull(member(usage, 'prompt_tokens')),
    cachedTokens: countOrNull(member(member(usage, 'prompt_tokens_details'), 'cached_tokens')),
    costUsd: typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : null
  }
}

export type ProbeCallRecord = { ok: true; usage: ProbeUsage } | { ok: false }

/**
 * K4, C6. `verified` when call 2 or 3 reports cached tokens (a hit on call 1 is
 * not evidence: the nonce makes it cold). `not-cached` only when all three calls
 * succeeded and each reported exactly 0. Anything else is `inconclusive`.
 */
export function evaluateProbe(calls: readonly ProbeCallRecord[]): CacheProbeOutcome {
  const hit = (call: ProbeCallRecord | undefined): boolean =>
    call !== undefined && call.ok && call.usage.cachedTokens !== null && call.usage.cachedTokens > 0
  if (hit(calls[1]) || hit(calls[2])) return 'verified'
  if (calls.length === CACHE_PROBE_CALLS && calls.every((call) => call.ok && call.usage.cachedTokens === 0)) return 'not-cached'
  return 'inconclusive'
}

/**
 * C6: a 2xx without a numeric cost counts its per-call worst case. A call with
 * no 2xx response (`{ ok: false }`) is counted as 0 here. A 2xx whose body could
 * not be read may still have been billed, so the caller (Task 2-3) records it as
 * `{ ok: true, usage: all-null }`, and this function then charges its estimate.
 */
export function probeCallSpendUsd(call: ProbeCallRecord, perCallEstimateUsd: number): number {
  if (!call.ok) return 0
  return call.usage.costUsd !== null ? call.usage.costUsd : perCallEstimateUsd
}
