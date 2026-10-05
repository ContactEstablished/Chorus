import {
  RANKED_TIERS,
  ROUTING_PROFILES,
  type CandidateExplanation,
  type NitroSelection,
  type RankedTier,
  type RankInput,
  type RoutingSettings
} from '../../shared/routing'
import {
  evaluateGates,
  median,
  mergeHistory,
  selectWindow,
  smoothSpeed,
  type GateContext,
  type GateReason
} from './eligibilityCore'
import { byCodeUnit, collapseEndpoints, extractObservations } from './endpointsCore'
import { blendedCost, collapsePricing, resolvePricing } from './pricingCore'

/**
 * Model Routing Task 1-2: ranking (ImplementationSpec-1-2). Effective
 * throughput (MR-D6), tier scores, the Budget floor (K10), the deterministic
 * K9 tie-break, and `rankCandidates`, which explains every candidate.
 *
 * Pure: the clock is never read; `input.now` is the only time source (MR-G8).
 * The result is plain JSON and independent of the order of
 * `snapshot.endpoints` and `history`. Tags compare by code unit, never by locale.
 */

/** MR-D6: tokens/s over a whole turn of `n` output tokens, first-token latency included. */
export function effectiveTps(n: number, latencyS: number, tpsP50: number): number {
  return n / (latencyS + n / tpsP50)
}

/** weight·ln(tpsEff) − (1 − weight)·ln(blended). `+ 0` keeps -0 out of the JSON result. */
export function tierScore(weight: number, tpsEff: number, blended: number): number {
  return weight * Math.log(tpsEff) - (1 - weight) * Math.log(blended) + 0
}

/** K10: `null` for an empty set, else max(budgetMinTps, budgetMedianFraction × median). `+ 0` keeps -0 out. */
export function budgetFloor(eligibleTps: number[], settings: RoutingSettings): number | null {
  const m = median(eligibleTps)
  return m === null ? null : Math.max(settings.budgetMinTps, settings.budgetMedianFraction * m) + 0
}

export interface OrderEntry {
  tag: string
  score: number
  uptime1d: number
  latencyP50S: number
  blended: number
}

/** Higher `uptime1d`, lower `latencyP50S`, lower `blended`, then tag ascending: lexicographic, hence transitive. */
function byClusterKeys(a: OrderEntry, b: OrderEntry): number {
  if (a.uptime1d !== b.uptime1d) return a.uptime1d > b.uptime1d ? -1 : 1
  if (a.latencyP50S !== b.latencyP50S) return a.latencyP50S < b.latencyP50S ? -1 : 1
  if (a.blended !== b.blended) return a.blended < b.blended ? -1 : 1
  return byCodeUnit(a.tag, b.tag)
}

/**
 * K9. Sort by score descending (equal scores by tag). Repeatedly take the
 * highest remaining score `s`; the cluster is every remaining entry with a
 * score of at least `s − ln(tieRatio)` (a prefix of the sorted list); order it
 * by the cluster keys, append it, continue. The output never depends on the
 * input order. Returns a new array; entries are not copied.
 */
export function orderByScore<T extends OrderEntry>(entries: T[], tieRatio: number): T[] {
  const sorted = [...entries].sort((a, b) => (a.score !== b.score ? (a.score > b.score ? -1 : 1) : byCodeUnit(a.tag, b.tag)))
  const margin = Math.log(tieRatio)
  const out: T[] = []
  let start = 0
  while (start < sorted.length) {
    const threshold = sorted[start].score - margin
    let end = start + 1
    while (end < sorted.length && sorted[end].score >= threshold) end++
    out.push(...sorted.slice(start, end).sort(byClusterKeys))
    start = end
  }
  return out
}

export interface RankedCandidates {
  candidates: CandidateExplanation[] // sorted by tag
  selections: Record<RankedTier, string[]> // ≤ 1 + fallbackCount tags each, in order
  medianEligibleTps: number | null
  budgetFloorTps: number | null
  nitroLikely: NitroSelection['likely']
  nitroFailsRules: string[]
}

/**
 * An eligible candidate's ranking inputs. It passed rules 1, 12 and 13, so its
 * current uptime, both smoothed speeds and its cost are non-null (C5: the
 * blended cost is positive and finite).
 */
interface EligibleRecord {
  tag: string
  uptime1d: number
  tpsP50: number
  latencyP50S: number
  blended: number
  tpsEff: number
  budgetFloorExcluded: boolean
  scores: Partial<Record<RankedTier, number>>
}

/**
 * Ranks every routable tag of the latest snapshot (ImplementationSpec-1-2
 * steps 1-7): gates and smoothed speeds per candidate, the eligible median and
 * Budget floor, scores per tier, K9 selections, and Nitro's likely endpoint
 * (guardrail- and capability-filtered only, with the reliability and precision
 * rules it fails).
 */
export function rankCandidates(input: RankInput): RankedCandidates {
  const { settings, now } = input
  const profile = ROUTING_PROFILES[input.profile]
  const ctx: GateContext = { model: input.model, profile, effort: input.effort, account: input.account, settings, now }

  // 1. Candidates and the merged history.
  const collapsed = collapseEndpoints(input.snapshot.endpoints)
  const history = mergeHistory(input.history, extractObservations(input.snapshot))

  // 2. Window, smoothed speed, cost and gates per candidate.
  const evaluated = collapsed.map((c) => {
    const window = selectWindow(history, c.tag, now, settings)
    const speed = smoothSpeed(window, settings)
    const prices = collapsePricing(c.pricing.map((p) => resolvePricing(p, now, profile.typicalPromptTokens)))
    const cacheVerified = Object.hasOwn(input.cache, c.tag) && input.cache[c.tag].verified === true
    const cost = blendedCost(prices, profile.tokenShares, cacheVerified)
    const gates = evaluateGates(c, window, speed, cost, ctx)
    const tpsEff =
      speed.tpsP50 !== null && speed.latencyP50S !== null
        ? effectiveTps(profile.expectedOutputTokens, speed.latencyP50S, speed.tpsP50)
        : null
    // No reasons implies every value below is non-null; the checks only narrow the types.
    const eligible: EligibleRecord | null =
      gates.reasons.length === 0 && c.uptime1d !== null && speed.tpsP50 !== null && speed.latencyP50S !== null && cost !== null && tpsEff !== null
        ? {
            tag: c.tag,
            uptime1d: c.uptime1d,
            tpsP50: speed.tpsP50,
            latencyP50S: speed.latencyP50S,
            blended: cost.blended,
            tpsEff,
            budgetFloorExcluded: false,
            scores: {}
          }
        : null
    return { c, speed, cost, gates, tpsEff, eligible }
  })

  // 3. Eligible set, its median speed and the Budget floor (K10).
  const eligible = evaluated.flatMap((e) => (e.eligible === null ? [] : [e.eligible]))
  const eligibleTps = eligible.map((r) => r.tpsP50)
  const medianEligibleTps = median(eligibleTps)
  const budgetFloorTps = budgetFloor(eligibleTps, settings)

  // 4. Scores (the floor is null only when nothing is eligible). Equal to the floor passes.
  const weights = settings.tierWeights
  if (budgetFloorTps !== null) {
    for (const r of eligible) {
      r.budgetFloorExcluded = r.tpsP50 < budgetFloorTps
      if (!r.budgetFloorExcluded) r.scores.budget = tierScore(weights.budget, r.tpsEff, r.blended)
      r.scores.balanced = tierScore(weights.balanced, r.tpsEff, r.blended)
      r.scores.fast = tierScore(weights.fast, r.tpsEff, r.blended)
    }
  }

  // 5. K9 selections per tier.
  const selections = {} as Record<RankedTier, string[]>
  for (const tier of RANKED_TIERS) {
    const entries: OrderEntry[] = eligible.flatMap((r) => {
      const score = r.scores[tier]
      return score === undefined ? [] : [{ tag: r.tag, score, uptime1d: r.uptime1d, latencyP50S: r.latencyP50S, blended: r.blended }]
    })
    selections[tier] = orderByScore(entries, settings.tieRatio)
      .slice(0, 1 + settings.fallbackCount)
      .map((entry) => entry.tag)
  }

  // 6. Nitro likely (K12, C3): passes account and capability filters, has a smoothed speed.
  const filteredOut = (r: GateReason): boolean => r.family === 'account' || r.family === 'capability'
  let nitro: { tag: string; providerName: string; tpsP50: number; reasons: GateReason[] } | null = null
  for (const e of evaluated) {
    const tps = e.speed.tpsP50
    if (tps === null || e.gates.reasons.some(filteredOut)) continue
    if (nitro === null || tps > nitro.tpsP50 || (tps === nitro.tpsP50 && e.c.tag < nitro.tag)) {
      nitro = { tag: e.c.tag, providerName: e.c.providerName, tpsP50: tps, reasons: e.gates.reasons }
    }
  }
  const nitroLikely: NitroSelection['likely'] =
    nitro === null ? null : { tag: nitro.tag, providerName: nitro.providerName, tpsP50: nitro.tpsP50 }
  const nitroFailsRules =
    nitro === null ? [] : nitro.reasons.filter((r) => r.family === 'reliability' || r.family === 'precision').map((r) => r.text)

  // 7. Explanations, in contract key order, sorted by tag.
  const candidates: CandidateExplanation[] = evaluated
    .map((e) => ({
      tag: e.c.tag,
      providerName: e.c.providerName,
      rows: e.c.rows,
      quantization: e.c.quantization,
      rowQuantizations: [...e.c.rowQuantizations],
      effectiveQuantization: e.gates.effectiveQuantization,
      uptime1d: e.c.uptime1d,
      uptime5m: e.c.uptime5m,
      status: e.c.status,
      observations: e.speed.observations,
      limitedHistory: e.speed.limitedHistory,
      tpsP50: e.speed.tpsP50,
      latencyP50S: e.speed.latencyP50S,
      tpsP90: e.speed.tpsP90,
      latencyP90S: e.speed.latencyP90S,
      effectiveTps: e.tpsEff,
      cost: e.cost,
      excludedBy: e.gates.reasons.map((r) => r.text),
      budgetFloorExcluded: e.eligible?.budgetFloorExcluded ?? false,
      scores: e.eligible?.scores ?? {}
    }))
    .sort((a, b) => byCodeUnit(a.tag, b.tag))

  return { candidates, selections, medianEligibleTps, budgetFloorTps, nitroLikely, nitroFailsRules }
}
