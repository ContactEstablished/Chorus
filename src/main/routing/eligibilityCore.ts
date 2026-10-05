import type {
  AccountEligibility,
  CandidateCost,
  ModelRegistryEntry,
  Quantization,
  RoutingObservation,
  RoutingProfile,
  RoutingSettings
} from '../../shared/routing'
import { byCodeUnit, collapseStatus, maxOrNull, minOrNull, type CollapsedEndpoint } from './endpointsCore'
import { activeVerification } from './registryCore'

/**
 * Model Routing Task 1-2: eligibility (ImplementationSpec-1-2). Merges the
 * observation history with the latest snapshot, selects each tag's window
 * (K6, K7), smooths its speed, and evaluates the hard gates in canonical order
 * with exact reason strings (MR-D7, K3, K5, K6, C1-C3, C5, C6, C11).
 *
 * Pure: the clock is never read; `now` is a parameter, parsed with `Date.parse`.
 * Gates read the current values of the collapsed latest snapshot; speeds come
 * from the smoothed window. Tags compare by code unit, never by locale.
 */

export const PRECISION_RANK: Record<Exclude<Quantization, 'unknown'>, number> = {
  fp32: 6,
  bf16: 5,
  fp16: 5,
  fp8: 4,
  int8: 3,
  fp6: 2,
  fp4: 1,
  int4: 1
}

export const BASE_REQUIRED_PARAMETERS = ['tools', 'tool_choice', 'max_tokens'] as const

const DAY_MS = 86_400_000

/** K5: the base parameters, plus `reasoning` when an effort is set (non-null). */
export function requiredParameters(effort: string | null): string[] {
  return effort !== null ? [...BASE_REQUIRED_PARAMETERS, 'reasoning'] : [...BASE_REQUIRED_PARAMETERS]
}

/**
 * C1: a percentage truncated (never rounded) to `decimals` places, so a failing
 * value can never print as meeting its threshold. The `1e-9` absorbs binary
 * representation error: 0.29 × 100 is 28.999999999999996 in floating point,
 * and must still print 0.29, not 0.28.
 */
export function truncatePct(value: number, decimals: number): string {
  const scale = 10 ** decimals
  return (Math.floor(value * scale + 1e-9) / scale).toFixed(decimals)
}

/** Median of a sorted copy; an even count gives the mean of the middle two; empty gives null. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Instant of an observation; an unparseable `observedAt` is NaN and never enters a window. */
function instantOf(o: RoutingObservation): number {
  return Date.parse(o.observedAt)
}

/** Newest first; NaN instants last; equal instants by `observedAt` string (code unit). */
function byInstantDesc(a: RoutingObservation, b: RoutingObservation): number {
  const ia = instantOf(a)
  const ib = instantOf(b)
  const na = Number.isNaN(ia)
  const nb = Number.isNaN(ib)
  if (na !== nb) return na ? 1 : -1
  if (!na && ia !== ib) return ib - ia
  return byCodeUnit(a.observedAt, b.observedAt)
}

/** Duplicate observations of one tag at one instant collapse with the K8/C7 rules. */
function collapseObservations(group: RoutingObservation[]): RoutingObservation {
  return {
    tag: group[0].tag,
    observedAt: group.map((o) => o.observedAt).sort(byCodeUnit)[0],
    uptime1d: minOrNull(group.map((o) => o.uptime1d)),
    uptime5m: minOrNull(group.map((o) => o.uptime5m)),
    status: collapseStatus(group.map((o) => o.status)),
    tpsP50: minOrNull(group.map((o) => o.tpsP50)),
    tpsP90: minOrNull(group.map((o) => o.tpsP90)),
    latencyP50Ms: maxOrNull(group.map((o) => o.latencyP50Ms)),
    latencyP90Ms: maxOrNull(group.map((o) => o.latencyP90Ms))
  }
}

/**
 * Stored history plus the snapshot's own observations. Observations with the
 * same tag and the same instant (`Date.parse`, so `…:00Z` and `…:00.000Z`
 * match) collapse with the K8/C7 rules and keep the smallest `observedAt`
 * string, so the snapshot is counted once even when it is already stored.
 * Sorted by tag ascending, then instant descending.
 */
export function mergeHistory(history: RoutingObservation[], fromSnapshot: RoutingObservation[]): RoutingObservation[] {
  const groups = new Map<string, RoutingObservation[]>()
  for (const o of [...history, ...fromSnapshot]) {
    const instant = instantOf(o)
    // An unparseable time keys by its own string: identical strings merge, two different ones never do.
    const key = `${o.tag}\u0000${Number.isNaN(instant) ? `raw:${o.observedAt}` : String(instant)}`
    const group = groups.get(key)
    if (group) group.push(o)
    else groups.set(key, [o])
  }
  return [...groups.values()].map(collapseObservations).sort((a, b) => byCodeUnit(a.tag, b.tag) || byInstantDesc(a, b))
}

/**
 * K6/K7 window: the tag's observations at or before `now` and no older than
 * `observationMaxAgeDays`, newest first, at most `smoothingWindow` of them.
 * Expects merged history (one observation per tag and instant). An
 * unparseable `now` throws `RangeError('Invalid time: now')`.
 */
export function selectWindow(
  observations: RoutingObservation[],
  tag: string,
  now: string,
  settings: RoutingSettings
): RoutingObservation[] {
  const nowMs = Date.parse(now)
  if (Number.isNaN(nowMs)) throw new RangeError('Invalid time: now')
  const oldestMs = nowMs - settings.observationMaxAgeDays * DAY_MS
  return observations
    .filter((o) => {
      if (o.tag !== tag) return false
      const t = instantOf(o)
      return t <= nowMs && t >= oldestMs
    })
    .sort(byInstantDesc)
    .slice(0, settings.smoothingWindow)
}

export interface SmoothedSpeed {
  observations: number
  limitedHistory: boolean
  tpsP50: number | null
  latencyP50S: number | null
  tpsP90: number | null
  latencyP90S: number | null
}

/** The positive, finite values of one field (zero, null and missing speeds carry no information). */
function positives(values: (number | null)[]): number[] {
  return values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0)
}

/** Median of the positive values divided by 1000 (ms to s), or null. */
function medianSeconds(valuesMs: number[]): number | null {
  const m = median(valuesMs)
  return m === null ? null : m / 1000
}

/**
 * K7: medians of the window's positive values, tps and latency counted
 * separately. `observations` is the smaller count; fewer than
 * `stableMinObservations` marks the candidate `limitedHistory` (it is still
 * fully gated). p90 values are carried for display only.
 */
export function smoothSpeed(window: RoutingObservation[], settings: RoutingSettings): SmoothedSpeed {
  const tps = positives(window.map((o) => o.tpsP50))
  const latency = positives(window.map((o) => o.latencyP50Ms))
  const observations = Math.min(tps.length, latency.length)
  return {
    observations,
    limitedHistory: observations < settings.stableMinObservations,
    tpsP50: median(tps),
    latencyP50S: medianSeconds(latency),
    tpsP90: median(positives(window.map((o) => o.tpsP90))),
    latencyP90S: medianSeconds(positives(window.map((o) => o.latencyP90Ms)))
  }
}

export type GateFamily = 'reliability' | 'account' | 'precision' | 'capability' | 'speed' | 'price'
export interface GateReason {
  family: GateFamily
  text: string
}
export interface GateContext {
  model: ModelRegistryEntry
  profile: RoutingProfile
  effort: string | null
  account: AccountEligibility
  settings: RoutingSettings
  now: string
}

/**
 * Every failing hard gate, in the canonical order of ImplementationSpec-1-2
 * (rules 1-13), with exact reason texts. Rules 1-3 are mutually exclusive.
 * Current values come from `candidate` (the collapsed latest snapshot); the
 * hysteresis look-back uses `window`; speeds come from `speed`.
 */
export function evaluateGates(
  candidate: CollapsedEndpoint,
  window: RoutingObservation[],
  speed: SmoothedSpeed,
  cost: CandidateCost | null,
  ctx: GateContext
): { reasons: GateReason[]; effectiveQuantization: Quantization } {
  const S = ctx.settings
  const reasons: GateReason[] = []
  const fail = (family: GateFamily, text: string): void => {
    reasons.push({ family, text })
  }

  // ── Reliability (K6, C1, C2) ──
  const u = candidate.uptime1d
  if (u === null) fail('reliability', 'no uptime data')
  else if (u < S.minUptimePct) fail('reliability', `uptime ${truncatePct(u, 2)}% < ${S.minUptimePct}%`)
  else if (u < S.readmitUptimePct && window.some((o) => o.uptime1d !== null && o.uptime1d < S.minUptimePct)) {
    fail('reliability', `readmission needs ${S.readmitUptimePct}% (now ${truncatePct(u, 2)}%)`)
  }
  const u5 = candidate.uptime5m
  if (u5 !== null && u5 < S.outageGuard5mPct) fail('reliability', `currently degraded (5m uptime ${truncatePct(u5, 1)}%)`)
  if (candidate.status !== 0) fail('reliability', `status ${candidate.status}`)

  // ── Account (K3, C3) ──
  if (ctx.account.guardrailRemoved?.includes(candidate.tag)) fail('account', 'removed by account guardrail')
  if (S.dataCollection === 'deny' && ctx.account.dataPolicyRemoved?.includes(candidate.tag)) {
    fail('account', 'removed by data policy')
  }

  // ── Precision (MR-D7, C6, C11) ──
  const native = ctx.model.nativePrecision
  const q = candidate.quantization
  let effectiveQuantization: Quantization = q
  if (native !== null) {
    // C11 (coordinator ruling) enforces the product-owner rule "exclude endpoints quantized below the
    // model's native precision": a mixed tag with a declared row below native is never admitted, not
    // by the first party and not by a verification record. The first such row, in QUANTIZATIONS order, is named.
    const belowNative = candidate.mixedQuantization
      ? candidate.rowQuantizations.find((r) => r !== 'unknown' && PRECISION_RANK[r] < PRECISION_RANK[native])
      : undefined
    if (belowNative !== undefined) {
      effectiveQuantization = 'unknown'
      fail('precision', `${belowNative} below native ${native}`)
    } else if (q === 'unknown') {
      const admitted =
        S.unknownQuantPolicy === 'firstPartyAndVerified' &&
        (ctx.model.firstPartyProviders.includes(candidate.providerName) ||
          activeVerification(ctx.model, candidate.tag, ctx.now) !== null)
      if (admitted) effectiveQuantization = native
      else {
        effectiveQuantization = 'unknown'
        fail('precision', candidate.mixedQuantization ? 'quantization differs across rows sharing this tag' : 'quantization not declared')
      }
    } else if (PRECISION_RANK[q] < PRECISION_RANK[native]) {
      fail('precision', `${q} below native ${native}`)
    }
  }

  // ── Capability (K5) ──
  for (const p of requiredParameters(ctx.effort)) {
    if (!candidate.supportedParameters.includes(p)) fail('capability', `missing parameter: ${p}`)
  }
  if (candidate.contextLength < ctx.model.minContext) {
    fail('capability', `context ${candidate.contextLength} < ${ctx.model.minContext}`)
  }
  if (candidate.maxCompletion !== null && candidate.maxCompletion < ctx.profile.minMaxCompletion) {
    fail('capability', `max output ${candidate.maxCompletion} < ${ctx.profile.minMaxCompletion}`)
  }

  // ── Speed (K7) ──
  if (speed.tpsP50 === null || speed.latencyP50S === null) fail('speed', 'no speed data')

  // ── Price (C5) ──
  if (cost === null) fail('price', 'no usable price')

  return { reasons, effectiveQuantization }
}
