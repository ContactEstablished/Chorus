import { z } from 'zod'

import {
  RANKED_TIERS,
  type CandidateExplanation,
  type RankedTier,
  type RankInput,
  type TierResult,
  type TierSelection
} from '../../shared/routing'
import { buildNitroSelection, buildRankedProvider } from './payloadCore'
import { rankCandidates } from './rankerCore'

/**
 * Model Routing Task 1-3: the public entry point (ImplementationSpec-1-3).
 * `computeTiers` validates the times (C9), ranks (Task 1-2), and returns the
 * four tier selections with snapshot staleness (K7), account state (K3),
 * warnings and rationale. It is the only routing module Phase 2 calls.
 *
 * Pure: the clock is never read; `input.now` is the only time source (MR-G8).
 * The result is plain JSON (K2, MR-G5): strings, finite numbers, booleans,
 * null, arrays and plain objects, with no key holding `undefined`.
 */

/**
 * A UTC ISO instant ending in `Z`, the same `z.iso.datetime()` the shared
 * schemas use. `Date.parse` reads a string without an offset as local time,
 * which would shift pricing windows and verification activity with the
 * machine's timezone, so such a string is rejected at the entry point.
 */
const utcInstant = z.iso.datetime()

const LABELS: Record<RankedTier, string> = { budget: 'Budget', balanced: 'Balanced', fast: 'Fast' }

/** Milliseconds since the epoch of a UTC ISO instant; anything else throws `RangeError`. */
function instantMs(value: string): number {
  const ms = utcInstant.safeParse(value).success ? Date.parse(value) : Number.NaN
  if (Number.isNaN(ms)) throw new RangeError('Invalid time in RankInput')
  return ms
}

/**
 * `<tag> first: <tps> effective tok/s, $<cost>/M blended; then <rest>` (or
 * `; no fallbacks`), plus ` (limited history)` when the tier has it.
 */
function rationale(primary: CandidateExplanation, rest: string[], limitedHistory: boolean): string {
  // A selected candidate is eligible, so both values exist; the guard only narrows the contract types.
  if (primary.effectiveTps === null || primary.cost === null) {
    throw new Error(`Selected candidate ${primary.tag} has no effective throughput or cost`)
  }
  return (
    `${primary.tag} first: ${primary.effectiveTps.toFixed(1)} effective tok/s, $${primary.cost.blended.toPrecision(3)}/M blended` +
    (rest.length ? `; then ${rest.join(', ')}` : '; no fallbacks') +
    (limitedHistory ? ' (limited history)' : '')
  )
}

/**
 * Ranks the snapshot for one profile and effort and returns every tier,
 * Nitro, the explanation of each candidate and the warnings
 * (ImplementationSpec-1-3 steps 1-7). Throws `RangeError` when `now` or
 * `snapshot.fetchedAt` is not a UTC ISO instant, or when the snapshot was
 * fetched after `now` (C9).
 *
 * Only those two times are validated here. `input.settings` and
 * `input.profile` are trusted: callers (Phase 2) must parse them with
 * `routingSettingsSchema` and `routingProfileIdSchema` at the IPC and
 * settings boundary before calling.
 */
export function computeTiers(input: RankInput): TierResult {
  const S = input.settings

  // 1. Times (C9).
  const nowMs = instantMs(input.now)
  const fetchedMs = instantMs(input.snapshot.fetchedAt)
  if (fetchedMs > nowMs) throw new RangeError('snapshot.fetchedAt is after now')

  // 2. Ranking (Task 1-2).
  const ranked = rankCandidates(input)

  // 3. Snapshot age (K7). The ranker still computes when stale; launch enforcement is Phase 4.
  const ageMs = nowMs - fetchedMs
  const snapshotAgeMinutes = Math.floor(ageMs / 60_000)
  const stale = ageMs > S.snapshotMaxAgeMinutes * 60_000

  // 4. Account (K3): an unparsed guardrail preflight is never reported as checked.
  const accountEligibility: TierResult['accountEligibility'] = input.account.guardrailRemoved === null ? 'unknown' : 'checked'

  // 5. Tier selections, in RANKED_TIERS order.
  const byTag = new Map(ranked.candidates.map((c) => [c.tag, c]))
  const tiers = {} as Record<RankedTier, TierSelection | null>
  for (const tier of RANKED_TIERS) {
    const tags = ranked.selections[tier]
    if (tags.length === 0) {
      tiers[tier] = null
      continue
    }
    const selected = tags.map((tag) => {
      const c = byTag.get(tag)
      if (c === undefined) throw new Error(`Selected tag ${tag} has no candidate`)
      return c
    })
    const limitedHistory = selected.some((c) => c.limitedHistory)
    tiers[tier] = {
      tier,
      model: input.model.slug,
      provider: buildRankedProvider(selected, S),
      endpoints: [...tags],
      limitedHistory,
      limitedFallbacks: tags.length < 1 + S.fallbackCount,
      rationale: rationale(selected[0], tags.slice(1), limitedHistory)
    }
  }

  // 6. Nitro: never ranked; `likely` is a labelled preview.
  const nitro = buildNitroSelection(input.model.slug, ranked.nitroLikely, ranked.nitroFailsRules, S)

  // Warnings W1-W7, in order, each only when its condition holds.
  const warnings: string[] = []
  if (stale) {
    warnings.push(`Snapshot is ${snapshotAgeMinutes} minutes old (limit ${S.snapshotMaxAgeMinutes}); refresh before launching.`)
  }
  if (accountEligibility === 'unknown') {
    warnings.push('Account guardrails were not checked; a pinned endpoint may be refused.')
  }
  if (S.dataCollection === 'deny' && input.account.dataPolicyRemoved === null) {
    warnings.push('Data-policy removals were not checked.')
  }
  for (const tier of RANKED_TIERS) {
    const n = ranked.selections[tier].length
    if (n === 0) warnings.push(`${LABELS[tier]}: no eligible endpoints.`)
    else if (n < 1 + S.fallbackCount) {
      warnings.push(`${LABELS[tier]}: only ${n} eligible endpoint${n === 1 ? '' : 's'}; limited fallbacks.`)
    }
  }
  const eligible = ranked.candidates.filter((c) => c.excludedBy.length === 0)
  const limited = eligible.filter((c) => c.limitedHistory).length
  if (limited > 0) {
    warnings.push(
      `Limited history: ${limited} of ${eligible.length} eligible endpoints have fewer than ${S.stableMinObservations} speed observations.`
    )
  }
  if (nitro.likely === null) warnings.push('Nitro: no endpoint in the snapshot passes the capability filters.')

  // 7. Result, keys in TierResult contract order.
  return {
    model: input.model.slug,
    profile: input.profile,
    computedAt: input.now,
    snapshotFetchedAt: input.snapshot.fetchedAt,
    snapshotAgeMinutes,
    stale,
    accountEligibility,
    medianEligibleTps: ranked.medianEligibleTps,
    budgetFloorTps: ranked.budgetFloorTps,
    tiers: { budget: tiers.budget, balanced: tiers.balanced, fast: tiers.fast },
    nitro,
    candidates: ranked.candidates,
    warnings
  }
}
