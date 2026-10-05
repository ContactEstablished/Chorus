import {
  ROUTING_FAILURE_MESSAGES,
  ROUTING_LAUNCH_CHOICES,
  ROUTING_REFRESH_COOLDOWN_MS,
  ROUTING_REFRESH_PROBE_CAP_USD,
  routingBaseModelId,
  type CandidateExplanation,
  type Quantization,
  type RankedTier,
  type RoutingCredential,
  type RoutingFailure,
  type RoutingLaunchChoice,
  type RoutingLaunchPreferences,
  type RoutingLaunchTier,
  type RoutingObservationSettings,
  type RoutingObserverOutcome,
  type RoutingProfileId,
  type RoutingProgressEvent,
  type RoutingSettings,
  type RoutingStatus,
  type TierResult
} from './routing'

/**
 * Model Routing Task 3-2: the pure view model of the routing inspector
 * (ImplementationSpec-3-2, Table RV). Every string the screen shows is built
 * here from numeric fields, never from `TierSelection.rationale` or W1 (K6).
 *
 * Pure and deterministic (MR-G8): no clock, no randomness, no I/O and no Zod
 * parsing (C13). Time arrives as a `nowMs` parameter; ISO strings are read
 * with `Date.parse`, which reads a string, not the clock. Inputs are never
 * mutated and every result is fresh plain JSON. This file is compiled by both
 * tsconfigs and imports only the shared routing contracts.
 */

// Declared first: ROUTING_REFRESH_COST_TEXT calls formatUsd while the module loads.
const DASH = '—'
const MINUTE_MS = 60_000
const RANKED_ORDER: readonly RankedTier[] = ['budget', 'balanced', 'fast']

// ── Constants ──
export const ROUTING_INSPECTOR_EFFORT = 'low' // K5: fixed in the Phase 3 inspector
export const ROUTING_PROFILE_LABELS: Record<RoutingProfileId, string> = { interactive: 'Interactive', helper: 'Team helper' }
export const ROUTING_TIER_LABELS: Record<RankedTier, string> = { budget: 'Budget', balanced: 'Balanced', fast: 'Fast' }
export const NITRO_CARD_LABEL = 'Nitro — unfiltered provider routing' // MR-D11
export const NITRO_CAVEATS: readonly string[] = [
  'An estimate: OpenRouter chooses the endpoint for each request, so actual routing may differ.',
  "Requests may be billed at a provider's priority-tier price.",
  "Your account's guardrails still apply."
]
export const ROUTING_PREVIEW_NOTE = 'Launches use a tier only when you choose one: in the launch dialog, or for each helper in the Team dialog.' // C20; Phase 4a K14; Phase 4b K13
export const ROUTING_NO_CREDENTIAL_HINT = 'Add an OpenRouter API-key credential under Providers & keys first.'
export const ROUTING_REFRESH_COST_TEXT =
  `A refresh fetches the endpoint list and checks account eligibility (both free), then may spend up to about ${formatUsd(ROUTING_REFRESH_PROBE_CAP_USD)} of OpenRouter credit verifying prompt caching. The estimate is shown before anything is spent.`

export type RefreshPhase = 'idle' | 'running' | 'done' | 'failed'

// ── View shapes (all plain JSON) ──
export interface SnapshotAgeView { minutes: number; stale: boolean; text: string; staleText: string | null }
export interface EndpointSummaryView {
  tag: string; providerName: string; quantization: Quantization // effectiveQuantization
  priceText: string; speedText: string; effectiveText: string; latencyText: string; uptimeText: string
  cacheVerified: boolean; timeOfDayPrice: boolean
}
export interface TierCardView {
  tier: RankedTier; label: string; state: 'ranked' | 'empty' | 'no-snapshot'
  primary: EndpointSummaryView | null; fallbacks: string[]; fallbackText: string
  reason: string; limitedHistory: boolean; notes: string[]
}
export interface NitroCardView {
  label: string; model: string; state: 'likely' | 'no-likely' | 'no-snapshot'
  likely: { tag: string; providerName: string; speedText: string } | null
  warning: string; failsRules: string[]; caveats: string[]
}
export interface ProviderRowView {
  tag: string; providerName: string; rowsText: string | null; quantization: string
  uptimeText: string; inputText: string; outputText: string; cacheReadText: string; blendedText: string
  speedText: string; latencyText: string
  eligible: boolean; statusText: string; limitedHistory: boolean; cacheVerified: boolean; timeOfDayPrice: boolean
}
export interface ProviderTableView { eligible: number; excluded: number; showText: string; hideText: string; rows: ProviderRowView[] }
export interface RefreshProgressView { state: 'running' | 'done' | 'failed'; lines: string[]; estimateText: string | null; spentText: string | null }
export interface RefreshButtonView { text: string; disabled: boolean; title: string }
export interface ObservationView {
  enabled: boolean; designatedId: string | null; designatedUsable: boolean
  stateText: string; warning: string | null; lastText: string | null; nextText: string | null; credentialHint: string | null
}

// ── Formatters ──

/** C5: spend and estimates. Four decimals below $1 with up to two trailing zeros removed, two from $1. */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value < 0) return DASH
  if (value === 0) return '$0.00'
  if (value < 0.0001) return '<$0.0001'
  if (value < 1) return '$' + value.toFixed(4).replace(/0{1,2}$/, '')
  return '$' + value.toFixed(2)
}

/** $/M prices: three significant figures below $1, two decimals from $1, never exponent notation. */
export function formatPerMillion(value: number): string {
  if (!Number.isFinite(value)) return DASH
  if (value === 0) return '$0/M'
  const sign = value < 0 ? '-' : ''
  const a = Math.abs(value)
  if (a >= 1) return `${sign}$${a.toFixed(2)}/M`
  if (a < 0.000001) return `${sign}<$0.000001/M`
  const decimals = 2 - Math.floor(Math.log10(a))
  return `${sign}$${a.toFixed(decimals)}/M`
}

/** One decimal with a trailing `.0` removed; the caller adds the unit. */
function tpsNumber(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '')
}

export function formatTps(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return DASH
  return tpsNumber(value) + ' tok/s'
}

export function formatSeconds(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return DASH
  return value.toFixed(2) + ' s'
}

/** C6: truncated exactly as `truncatePct(v, 2)` in eligibilityCore, so a failing value never prints as passing. */
export function formatUptime(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return DASH
  return (Math.floor(value * 100 + 1e-9) / 100).toFixed(2) + '%'
}

export function formatAgo(ageMs: number): string {
  const m = Math.floor(Math.max(0, ageMs) / MINUTE_MS)
  if (m === 0) return 'just now'
  if (m < 120) return `${m} min ago`
  if (m < 2880) return `${Math.floor(m / 60)} h ago`
  return `${Math.floor(m / 1440)} days ago`
}

// ── Views ──

/** Mirrors routingCore's age and staleness (floored minutes; stale strictly beyond the limit). */
export function snapshotAgeView(fetchedAt: string, nowMs: number, maxAgeMinutes: number): SnapshotAgeView {
  const ageMs = nowMs - Date.parse(fetchedAt)
  const minutes = Math.floor(Math.max(0, ageMs) / MINUTE_MS)
  const stale = ageMs > maxAgeMinutes * MINUTE_MS
  return {
    minutes,
    stale,
    text: 'Updated ' + formatAgo(ageMs),
    staleText: stale ? `Older than ${maxAgeMinutes} min. Refresh before relying on these numbers.` : null
  }
}

function endpointSummary(c: CandidateExplanation): EndpointSummaryView {
  return {
    tag: c.tag,
    providerName: c.providerName,
    quantization: c.effectiveQuantization,
    priceText: c.cost === null ? DASH : formatPerMillion(c.cost.blended) + ' blended',
    speedText: formatTps(c.tpsP50),
    effectiveText: c.effectiveTps === null || !Number.isFinite(c.effectiveTps) ? DASH : tpsNumber(c.effectiveTps) + ' effective tok/s',
    latencyText: formatSeconds(c.latencyP50S),
    uptimeText: c.uptime1d === null || !Number.isFinite(c.uptime1d) ? DASH : formatUptime(c.uptime1d) + ' uptime',
    cacheVerified: c.cost?.cacheCredit === true,
    timeOfDayPrice: c.cost?.overrideApplied === true
  }
}

function weightPhrase(w: number): string {
  if (w === 1) return 'on speed only'
  if (w === 0) return 'on price only'
  if (w === 0.5) return 'equally on price and speed'
  return w < 0.5 ? 'mostly on price' : 'mostly on speed'
}

/** `1 endpoint` / `n endpoints`. */
function endpointCount(n: number): string {
  return `${n} ${n === 1 ? 'endpoint' : 'endpoints'}`
}

/** K6, C9: one card per ranked tier (Budget, Balanced, Fast), text from counts, the floor and the weights. */
export function tierCardViews(result: TierResult | null, settings: RoutingSettings): TierCardView[] {
  if (result === null) {
    return RANKED_ORDER.map((tier) => ({
      tier,
      label: ROUTING_TIER_LABELS[tier],
      state: 'no-snapshot',
      primary: null,
      fallbacks: [],
      fallbackText: '',
      reason: 'No endpoint numbers for this model yet. Refresh to rank it.',
      limitedHistory: false,
      notes: []
    }))
  }
  const eligible = result.candidates.filter((c) => c.excludedBy.length === 0)
  const floorOut = eligible.filter((c) => c.budgetFloorExcluded).length
  const floor = result.budgetFloorTps
  return RANKED_ORDER.map((tier): TierCardView => {
    const label = ROUTING_TIER_LABELS[tier]
    const sel = result.tiers[tier]
    if (sel === null) {
      let reason: string
      if (eligible.length === 0) reason = 'No provider meets the uptime and precision rules right now.'
      else if (tier === 'budget' && floor !== null && floorOut === eligible.length) {
        const n = eligible.length
        reason = `All ${n} eligible ${n === 1 ? 'endpoint is' : 'endpoints are'} below the ${formatTps(floor)} Budget floor.`
      } else reason = 'No endpoint could be ranked for this tier.'
      return { tier, label, state: 'empty', primary: null, fallbacks: [], fallbackText: '', reason, limitedHistory: false, notes: [] }
    }
    const first = result.candidates.find((c) => c.tag === sel.endpoints[0])
    const fallbacks = sel.endpoints.slice(1)
    const phrase = weightPhrase(settings.tierWeights[tier])
    const reason =
      tier === 'budget' && floor !== null
        ? `First of ${endpointCount(eligible.length - floorOut)} at or above the ${formatTps(floor)} Budget floor, scored ${phrase}.`
        : `First of ${eligible.length} eligible ${eligible.length === 1 ? 'endpoint' : 'endpoints'}, scored ${phrase}.`
    const notes =
      tier === 'budget' && floor !== null && floorOut > 0 && sel.limitedFallbacks
        ? [`${floorOut} eligible ${floorOut === 1 ? 'endpoint is' : 'endpoints are'} below the ${formatTps(floor)} Budget floor.`]
        : []
    return {
      tier,
      label,
      state: 'ranked',
      primary: first === undefined ? null : endpointSummary(first),
      fallbacks,
      fallbackText: fallbacks.length === 0 ? 'No fallback available.' : 'Fallbacks: ' + fallbacks.join(', '),
      reason,
      limitedHistory: sel.limitedHistory,
      notes
    }
  })
}

/** MR-D11, C8: unfiltered routing, its likely endpoint and the uptime and precision rules that endpoint fails. */
export function nitroCardView(result: TierResult | null, model: string): NitroCardView {
  const base = { label: NITRO_CARD_LABEL, caveats: [...NITRO_CAVEATS] }
  if (result === null) {
    return {
      ...base,
      model: model + ':nitro',
      state: 'no-snapshot',
      likely: null,
      warning: 'Unfiltered: OpenRouter picks the provider. Refresh to see which one is likely.',
      failsRules: []
    }
  }
  const nitro = result.nitro
  if (nitro.likely === null) {
    return {
      ...base,
      model: nitro.model,
      state: 'no-likely',
      likely: null,
      warning: 'No endpoint in the snapshot passes the capability filters, so the likely provider is unknown.',
      failsRules: []
    }
  }
  const { tag, providerName, tpsP50 } = nitro.likely
  const fails = [...nitro.likelyFailsRules]
  return {
    ...base,
    model: nitro.model,
    state: 'likely',
    likely: { tag, providerName, speedText: formatTps(tpsP50) },
    warning:
      fails.length > 0
        ? `Likely provider: ${providerName} (${tag}), ${fails.join(', ')}.`
        : 'Unfiltered, but the likely provider currently passes the uptime and precision rules.',
    failsRules: fails
  }
}

/** C7: the warnings verbatim, except W1 (first exactly when stale), which the live age line replaces. */
export function resultNotes(result: TierResult): string[] {
  return result.stale ? result.warnings.slice(1) : [...result.warnings]
}

function providerRow(c: CandidateExplanation): ProviderRowView {
  const eligible = c.excludedBy.length === 0
  const price = (pick: (cost: NonNullable<CandidateExplanation['cost']>) => number): string =>
    c.cost === null ? DASH : formatPerMillion(pick(c.cost))
  return {
    tag: c.tag,
    providerName: c.providerName,
    rowsText: c.rows > 1 ? `${c.rows} endpoints` : null,
    quantization: c.quantization === c.effectiveQuantization ? c.quantization : `${c.quantization} (as ${c.effectiveQuantization})`,
    uptimeText: formatUptime(c.uptime1d),
    inputText: price((cost) => cost.promptPerM),
    outputText: price((cost) => cost.completionPerM),
    cacheReadText: price((cost) => cost.cacheReadPerM),
    blendedText: price((cost) => cost.blended),
    speedText: formatTps(c.tpsP50),
    latencyText: formatSeconds(c.latencyP50S),
    eligible,
    statusText: !eligible
      ? 'Excluded: ' + c.excludedBy.join('; ')
      : c.budgetFloorExcluded
        ? 'Eligible · below the Budget floor'
        : 'Eligible',
    limitedHistory: c.limitedHistory,
    cacheVerified: c.cost?.cacheCredit === true,
    timeOfDayPrice: c.cost?.overrideApplied === true
  }
}

/** K7, C10: eligible rows, then excluded rows, each in `candidates` order (by tag), never by score. */
export function providerTableView(result: TierResult): ProviderTableView {
  const eligible = result.candidates.filter((c) => c.excludedBy.length === 0)
  const excluded = result.candidates.filter((c) => c.excludedBy.length > 0)
  return {
    eligible: eligible.length,
    excluded: excluded.length,
    showText: `Show all providers (${eligible.length} eligible · ${excluded.length} excluded)`,
    hideText: 'Hide providers',
    rows: [...eligible, ...excluded].map(providerRow)
  }
}

type PreflightOutcome = Extract<RoutingProgressEvent, { stage: 'preflight' }>['guardrails']

function preflightText(outcome: PreflightOutcome): string {
  if (!outcome.attempted) return 'not checked'
  if (outcome.removed === null) return 'unknown'
  if (outcome.removed.length === 0) return 'none removed'
  return 'removed ' + outcome.removed.join(', ')
}

/**
 * K3, MR-G7: the per-stage lines of one refresh. The estimate exists from the
 * `probe-plan` event on, so it precedes every probe; the spend only once a
 * terminal event arrived. `null` while idle.
 */
export function refreshProgressView(events: readonly RoutingProgressEvent[], phase: RefreshPhase): RefreshProgressView | null {
  if (phase === 'idle') return null
  let endpoints: Extract<RoutingProgressEvent, { stage: 'endpoints' }> | null = null
  let preflight: Extract<RoutingProgressEvent, { stage: 'preflight' }> | null = null
  let plan: Extract<RoutingProgressEvent, { stage: 'probe-plan' }> | null = null
  let terminal: Extract<RoutingProgressEvent, { stage: 'done' | 'failed' }> | null = null
  let probes = 0
  let lastProbeSpent: number | null = null
  for (const e of events) {
    if (e.stage === 'endpoints') endpoints ??= e
    else if (e.stage === 'preflight') preflight ??= e
    else if (e.stage === 'probe-plan') plan ??= e
    else if (e.stage === 'probe') {
      probes++
      lastProbeSpent = e.spentUsd
    } else terminal ??= e
  }

  const lines: string[] = []
  let estimateText: string | null = null
  let spentText: string | null = null
  if (endpoints !== null) {
    lines.push(
      `Endpoints: ${endpoints.endpointRows} rows, ${endpoints.tags} tags` +
        (endpoints.rejectedRows > 0 ? `, ${endpoints.rejectedRows} rejected` : '')
    )
  }
  if (preflight !== null) {
    lines.push(`Account: guardrails ${preflightText(preflight.guardrails)}; data policy ${preflightText(preflight.dataPolicy)}`)
  }
  if (plan !== null) {
    const p = plan.planned.length
    if (p === 0) {
      lines.push(`Cache probe: nothing due (${plan.fresh.length} checked within 14 days)`)
    } else {
      const k = plan.notProbed.filter((s) => s.reason === 'cap').length
      lines.push(
        `Cache probe: ${endpointCount(p)}, estimated ${formatUsd(plan.estimateUsd)} (cap ${formatUsd(plan.capUsd)})` +
          (k > 0 ? `; ${k} left for a later refresh` : '')
      )
      lines.push(
        `Probing caches: ${probes} of ${p}` + (terminal === null ? ` (spent ${formatUsd(lastProbeSpent ?? 0)} so far)` : '')
      )
    }
    estimateText = 'Estimated ' + formatUsd(plan.estimateUsd)
  }
  if (terminal !== null) {
    lines.push(
      terminal.stage === 'done'
        ? `Done. Spent ${formatUsd(terminal.spentUsd)} of an estimated ${formatUsd(terminal.estimateUsd)}.`
        : `Failed: ${terminal.message} Spent ${formatUsd(terminal.spentUsd)}.`
    )
    spentText = 'Spent ' + formatUsd(terminal.spentUsd)
  } else if (phase === 'running') {
    if (endpoints === null) lines.push('Fetching endpoints…')
    else if (preflight === null) lines.push('Checking account eligibility…')
    else if (plan === null) lines.push('Planning the cache probe…')
  }

  const state: RefreshProgressView['state'] = terminal !== null ? terminal.stage : phase
  return { state, lines, estimateText, spentText }
}

/** C2, C12: seconds until main would accept another refresh of the model; 0 when none ended or the clock moved back. */
export function cooldownRemainingSeconds(endedAtMs: number | null, nowMs: number, cooldownMs: number = ROUTING_REFRESH_COOLDOWN_MS): number {
  if (endedAtMs === null) return 0
  const elapsed = nowMs - endedAtMs
  if (elapsed < 0 || elapsed >= cooldownMs) return 0
  return Math.ceil((cooldownMs - elapsed) / 1000)
}

export function refreshButtonView(input: { phase: RefreshPhase; cooldownSeconds: number; canRefresh: boolean }): RefreshButtonView {
  if (input.phase === 'running') return { text: 'Refreshing…', disabled: true, title: 'A refresh is running.' }
  if (!input.canRefresh) {
    return { text: 'Refresh', disabled: true, title: 'Choose a model and an OpenRouter API-key credential first.' }
  }
  if (input.cooldownSeconds > 0) {
    return {
      text: `Refresh again in ${input.cooldownSeconds} s`,
      disabled: true,
      title: 'Refreshes of one model are at least a minute apart.'
    }
  }
  return { text: 'Refresh', disabled: false, title: ROUTING_REFRESH_COST_TEXT }
}

/** K5: the designated credential when it is listed, else the first listed, else none. */
export function defaultRefreshCredential(
  credentials: readonly RoutingCredential[],
  observation: RoutingObservationSettings | null
): string | null {
  const designated = observation?.credentialProfileId ?? null
  if (designated !== null && credentials.some((c) => c.id === designated)) return designated
  return credentials.length > 0 ? credentials[0].id : null
}

export function credentialOptionLabel(credential: RoutingCredential): string {
  return `${credential.label} · ${credential.providerName}`
}

function withoutFinalPeriod(text: string): string {
  return text.endsWith('.') ? text.slice(0, -1) : text
}

function outcomeText(outcome: RoutingObserverOutcome, failure: RoutingFailure | null): string {
  switch (outcome) {
    case 'observed':
      return 'recorded new numbers'
    case 'dormant':
      return 'dormant'
    case 'skipped-fresh':
      return 'skipped, the numbers were fresh'
    case 'busy':
      return 'skipped, a refresh was running'
    case 'refused':
      return 'refused, the credential cannot be used for routing'
    case 'decrypt-failed':
      return 'the credential could not be decrypted'
    case 'fetch-failed':
      return 'could not fetch' + (failure === null ? '' : ` (${withoutFinalPeriod(ROUTING_FAILURE_MESSAGES[failure])})`)
    case 'failed':
      return 'failed'
  }
}

/** K8, C11, MR-D19, MR-D23: the background-observation consent and the observer's last and next check. */
export function observationView(
  observation: RoutingObservationSettings,
  status: RoutingStatus | null,
  credentials: readonly RoutingCredential[],
  nowMs: number
): ObservationView {
  const designatedId = observation.credentialProfileId
  const designated = designatedId === null ? null : (credentials.find((c) => c.id === designatedId) ?? null)
  const designatedUsable = designatedId === null || designated !== null

  let stateText: string
  if (!observation.enabled) stateText = 'Off. Chorus makes no background requests.'
  else if (designatedId === null) stateText = 'On, but nothing is recorded until you choose a credential.'
  else if (designated !== null) stateText = `Every 30 minutes, one free request with ${designated.label}. No prompts are sent.`
  else stateText = 'On, but the chosen credential can no longer be used.'

  const warning =
    observation.enabled && designatedId !== null && !designatedUsable
      ? 'The chosen credential is no longer an OpenRouter API-key credential that routing can use. Choose another, or turn background observation off.'
      : null

  const observer = status?.observer ?? null
  const lastText =
    observer === null || observer.lastTickAt === null || observer.lastOutcome === null
      ? null
      : `Last check ${formatAgo(nowMs - Date.parse(observer.lastTickAt))}: ${outcomeText(observer.lastOutcome, observer.lastFailure)}.`

  let nextText: string | null = null
  if (observer !== null) {
    if (observer.state === 'running') nextText = 'Checking now.'
    else if (observer.state === 'scheduled' && observer.nextTickAt !== null) {
      const m = Math.ceil((Date.parse(observer.nextTickAt) - nowMs) / MINUTE_MS)
      nextText = m <= 0 ? 'Next check due now.' : `Next check in ${m} min.`
    } else if (observer.state === 'stopped') nextText = 'The observer is not running.'
  }

  return {
    enabled: observation.enabled,
    designatedId,
    designatedUsable,
    stateText,
    warning,
    lastText,
    nextText,
    credentialHint: credentials.length === 0 ? ROUTING_NO_CREDENTIAL_HINT : null
  }
}

// ── Phase 4a — launch (Task 4a-4) ──
//
// The launch dialog's tier picker (ImplementationSpec-4a-4, Table LV). Main is
// the authority for what a tier means (K2): these functions decide only what the
// dialog shows and which tier NAME it sends. Pure, like the block above.

/** Re-exported so the presentational components keep their type-only routingView import (Phase 3 C15). */
export type { RoutingLaunchChoice, RoutingLaunchTier }

/** K3: the one agent kind whose interactive launches can be routed. LaunchDialog never writes the literal. */
export const ROUTING_LAUNCH_AGENT = 'opencode'
/** K4: a launch always ranks for the interactive profile (never the inspector's chosen profile). */
export const ROUTING_LAUNCH_PROFILE: RoutingProfileId = 'interactive'
export const ROUTING_LAUNCH_SECTION_LABEL = 'Routing'
export const ROUTING_LAUNCH_GROUP_LABEL = 'Routing tier'
export const ROUTING_LAUNCH_CHOICE_LABELS: Record<RoutingLaunchChoice, string> = {
  budget: 'Budget', balanced: 'Balanced', fast: 'Fast', nitro: 'Nitro', default: 'OpenRouter default'
}
export const ROUTING_DEFAULT_CHOICE_LABEL = 'OpenRouter default'
export const ROUTING_DEFAULT_CHOICE_DESCRIPTION =
  'Chorus sends no routing: OpenRouter picks the provider for each request, as before. The data-collection setting is not sent.'

/** K7: the environment name a routed launch carries its content in; main compares it ignoring case (Windows). */
const OPENCODE_CONFIG_CONTENT = 'OPENCODE_CONFIG_CONTENT'

export type RoutingLaunchIneligibility =
  'not-opencode' | 'no-credential' | 'credential-not-routable' | 'no-model' | 'model-not-routable' | 'profile-env'
export interface RoutingLaunchEligibility { eligible: boolean; reason: RoutingLaunchIneligibility | null }
export interface LaunchTierView { tier: RoutingLaunchTier; launchable: boolean; reason: string | null; refreshable: boolean }
export interface LaunchChoiceView { selected: RoutingLaunchChoice; hint: string | null }
/** RoutingTierCards' opt-in selection mode: present = a radio group; absent/null = the Phase 3 read-out. */
export interface RoutingCardSelection {
  groupLabel: string
  selected: RoutingLaunchChoice | null
  disabledReasons: Partial<Record<RoutingLaunchTier, string>>
  defaultOption: { label: string; description: string }
}

/**
 * K3, K7 (C29): main's routing eligibility, mirrored only to decide whether the
 * dialog renders the section (absent, not disabled). First match, in main's
 * order (`planRoutingLaunch`); main repeats every check and refuses an
 * ineligible `routing_tier`.
 */
export function routingLaunchEligibility(input: {
  agent: string | null; credentialProfileId: string | null; model: string | null
  credentials: readonly RoutingCredential[]; models: readonly { slug: string }[]
  profileEnvKeys: readonly string[]
}): RoutingLaunchEligibility {
  const no = (reason: RoutingLaunchIneligibility): RoutingLaunchEligibility => ({ eligible: false, reason })
  const { agent, credentialProfileId, model } = input
  if (agent !== ROUTING_LAUNCH_AGENT) return no('not-opencode')
  if (credentialProfileId === null) return no('no-credential')
  if (!input.credentials.some((c) => c.id === credentialProfileId)) return no('credential-not-routable')
  if (model === null) return no('no-model')
  if (routingBaseModelId(model) !== model || !input.models.some((m) => m.slug === model)) return no('model-not-routable')
  if (input.profileEnvKeys.some((key) => key.toUpperCase() === OPENCODE_CONFIG_CONTENT)) return no('profile-env')
  return { eligible: true, reason: null }
}

/** The names a launch profile's `env_json` sets; anything that is not a JSON object has none. */
export function envJsonKeys(envJson: string | null): string[] {
  if (envJson === null) return []
  let value: unknown
  try {
    value = JSON.parse(envJson)
  } catch {
    return []
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.keys(value)
}

/**
 * MR-D26, C25: whether each tier can be launched now, in the order Budget,
 * Balanced, Fast, Nitro. A ranked tier needs fresh numbers and an endpoint;
 * staleness is checked before emptiness. Nitro needs no snapshot.
 */
export function launchTierViews(result: TierResult | null, settings: RoutingSettings): LaunchTierView[] {
  const ranked = tierCardViews(result, settings).map((card): LaunchTierView => {
    if (card.state === 'no-snapshot') return { tier: card.tier, launchable: false, reason: card.reason, refreshable: true }
    if (result !== null && result.stale) {
      return {
        tier: card.tier,
        launchable: false,
        reason: `Refresh first: the numbers are older than ${settings.snapshotMaxAgeMinutes} min.`,
        refreshable: true
      }
    }
    if (card.state === 'empty') return { tier: card.tier, launchable: false, reason: card.reason, refreshable: false }
    return { tier: card.tier, launchable: true, reason: null, refreshable: false }
  })
  return [...ranked, { tier: 'nitro', launchable: true, reason: null, refreshable: false }]
}

export function launchDisabledReasons(views: readonly LaunchTierView[]): Partial<Record<RoutingLaunchTier, string>> {
  const reasons: Partial<Record<RoutingLaunchTier, string>> = {}
  for (const view of views) if (!view.launchable && view.reason !== null) reasons[view.tier] = view.reason
  return reasons
}

/** C23, C24: everything RoutingTierCards needs for its radio group, as strings. */
export function routingCardSelection(selected: RoutingLaunchChoice | null, views: readonly LaunchTierView[]): RoutingCardSelection {
  return {
    groupLabel: ROUTING_LAUNCH_GROUP_LABEL,
    selected,
    disabledReasons: launchDisabledReasons(views),
    defaultOption: { label: ROUTING_DEFAULT_CHOICE_LABEL, description: ROUTING_DEFAULT_CHOICE_DESCRIPTION }
  }
}

/** MR-D28, K8: the last choice main recorded for this model; own keys only, so a prototype key is never a memory. */
export function rememberedLaunchChoice(preferences: RoutingLaunchPreferences | null, model: string | null): RoutingLaunchChoice | null {
  if (preferences === null || model === null) return null
  return Object.hasOwn(preferences.lastChoiceByModel, model) ? preferences.lastChoiceByModel[model] : null
}

function launchViewOf(views: readonly LaunchTierView[], tier: RoutingLaunchTier): LaunchTierView | null {
  return views.find((v) => v.tier === tier) ?? null
}

function choiceLaunchable(choice: RoutingLaunchChoice, views: readonly LaunchTierView[]): boolean {
  return choice === 'default' || launchViewOf(views, choice)?.launchable === true
}

/** C26: why a remembered (or the Balanced) tier cannot be preselected. */
function unavailableHint(choice: RoutingLaunchChoice, views: readonly LaunchTierView[]): string {
  const label = ROUTING_LAUNCH_CHOICE_LABELS[choice]
  const view = choice === 'default' ? null : launchViewOf(views, choice)
  return view?.refreshable === true ? `Refresh to use ${label}.` : `${label} has no endpoint that meets the rules right now.`
}

/**
 * K9, MR-D28 (C26): the remembered choice if launchable; with no memory,
 * Balanced if launchable; otherwise OpenRouter default with a hint. Nitro is
 * never preselected unless remembered.
 */
export function defaultLaunchChoice(remembered: RoutingLaunchChoice | null, views: readonly LaunchTierView[]): LaunchChoiceView {
  if (remembered !== null) {
    return choiceLaunchable(remembered, views)
      ? { selected: remembered, hint: null }
      : { selected: 'default', hint: unavailableHint(remembered, views) }
  }
  if (choiceLaunchable('balanced', views)) return { selected: 'balanced', hint: null }
  return { selected: 'default', hint: unavailableHint('balanced', views) }
}

/** C27: a choice clicked in this dialog wins while it stays launchable; otherwise the K9 default, and the hint says why. */
export function launchChoiceView(input: {
  userChoice: RoutingLaunchChoice | null; remembered: RoutingLaunchChoice | null; views: readonly LaunchTierView[]
}): LaunchChoiceView {
  const { userChoice, remembered, views } = input
  if (userChoice !== null && choiceLaunchable(userChoice, views)) return { selected: userChoice, hint: null }
  const fallback = defaultLaunchChoice(remembered, views)
  if (userChoice === null) return fallback
  const lost = `${ROUTING_LAUNCH_CHOICE_LABELS[userChoice]} can no longer be launched.`
  const reason = userChoice === 'default' ? null : (launchViewOf(views, userChoice)?.reason ?? null)
  return { selected: fallback.selected, hint: reason === null ? lost : `${lost} ${reason}` }
}

/** K4: what the dialog ranked for (the launch's own effort, the interactive profile). */
export function routingLaunchCaption(effort: string | null): string {
  return effort === null
    ? 'Ranked for an interactive session with no reasoning effort set.'
    : `Ranked for an interactive session at reasoning effort "${effort}".`
}

/** K2: the payload's `routing_tier`, and the only routing value the renderer sends; null = send nothing. */
export function routingLaunchTierToSend(eligible: boolean, choice: RoutingLaunchChoice): RoutingLaunchTier | null {
  return eligible && choice !== 'default' ? choice : null
}

export function routingUnavailableText(message: string): string {
  return `Routing is unavailable: ${message}`
}

// ── Phase 4b — Team helpers (Task 4b-3) ──
//
// The Team dialog's per-slot tier (ImplementationSpec-4b-3, Table HV). Main is
// the authority for what a tier means (K2): `team:launch` refuses a tier it
// cannot serve, and main resolves the tier again before EVERY helper attempt,
// on the numbers it holds then (MR-D32). These functions decide only which
// slots show a dropdown, what it offers and which tier NAME a slot sends. Pure,
// like the blocks above.

/** K5: a helper slot ranks for the helper profile (never the interactive one). */
export const ROUTING_HELPER_PROFILE: RoutingProfileId = 'helper'

/** K4: the one harness and the one auth mode whose helpers can be routed. The Team dialog never writes the literals. */
const HELPER_ROUTING_HARNESS = 'opencode'
const HELPER_ROUTING_AUTH_MODE = 'api_key'

export type HelperRoutingIneligibility = 'not-opencode' | 'credential-not-routable' | 'model-not-routable'
/** `baseModel`: the registry slug the slot ranks on and main resolves on (K5, K6); null when not eligible. */
export interface HelperRoutingEligibility { eligible: boolean; reason: HelperRoutingIneligibility | null; baseModel: string | null }
export interface HelperTierOptionView { choice: RoutingLaunchChoice; label: string; text: string; disabled: boolean; title: string | null }
export interface HelperTierSelectView { options: HelperTierOptionView[]; selected: RoutingLaunchChoice; hint: string | null; busy: boolean }

/** K4: the rule the dialog knows before loading anything (main's `notOpencode`). */
export function helperRoutingWanted(member: { harness: string; authMode: string }): boolean {
  return member.harness === HELPER_ROUTING_HARNESS && member.authMode === HELPER_ROUTING_AUTH_MODE
}

/**
 * K4, C4: main's helper eligibility, mirrored only to decide whether a slot
 * shows a dropdown (absent, not disabled). First match, in main's order
 * (`planHelperRouting`, less `unavailable`, which the dialog learns from its
 * load). `model` is the member's model as `normalizeTeamModel` returns it (this
 * file imports only ./routing). Unlike a launch (4a K3), the `:nitro` form is
 * eligible: it ranks, and main resolves, on its base slug.
 */
export function helperRoutingEligibility(input: {
  harness: string; authMode: string; credentialProfileId: string | null; model: string
  credentials: readonly RoutingCredential[]; models: readonly { slug: string }[]
}): HelperRoutingEligibility {
  const no = (reason: HelperRoutingIneligibility): HelperRoutingEligibility => ({ eligible: false, reason, baseModel: null })
  if (!helperRoutingWanted(input)) return no('not-opencode')
  const { credentialProfileId } = input
  if (credentialProfileId === null || !input.credentials.some((c) => c.id === credentialProfileId)) return no('credential-not-routable')
  const baseModel = routingBaseModelId(input.model)
  if (!input.models.some((m) => m.slug === baseModel)) return no('model-not-routable')
  return { eligible: true, reason: null, baseModel }
}

/** K10, MR-D15: a slot whose option is chosen starts on Nitro for the `:nitro` model, else on OpenRouter default. */
export function helperDefaultChoice(model: string): RoutingLaunchChoice {
  return routingBaseModelId(model) !== model ? 'nitro' : 'default'
}

/**
 * K10: the slot's stored choice (null = its option's default) while it can be
 * launched; otherwise OpenRouter default with 4a's hint. Unlike a launch
 * (4a K9) nothing falls back to Balanced and nothing is remembered.
 */
export function helperChoiceView(input: { stored: RoutingLaunchChoice | null; model: string; views: readonly LaunchTierView[] }): LaunchChoiceView {
  const choice = input.stored ?? helperDefaultChoice(input.model)
  return choiceLaunchable(choice, input.views) ? { selected: choice, hint: null } : { selected: 'default', hint: unavailableHint(choice, input.views) }
}

/**
 * K11, C10: the slot's one dropdown, in ROUTING_LAUNCH_CHOICES order: Budget,
 * Balanced, Fast, Nitro, OpenRouter default. A ranked option that cannot be
 * launched now is disabled and says why in its own text (MR-D26, 4a's
 * reasons); Nitro carries its meaning in its label (MR-D11); the default
 * option's title says what it sends. While the slot's ranking is in flight the
 * select is busy and shows no hint; a ranking failure other than NO_SNAPSHOT
 * shows main's message in place of the hint.
 */
export function helperTierSelectView(input: {
  views: readonly LaunchTierView[]; choice: LaunchChoiceView; busy: boolean; error: string | null
}): HelperTierSelectView {
  const options = ROUTING_LAUNCH_CHOICES.map((choice): HelperTierOptionView => {
    if (choice === 'nitro') return { choice, label: NITRO_CARD_LABEL, text: NITRO_CARD_LABEL, disabled: false, title: null }
    if (choice === 'default') {
      return { choice, label: ROUTING_DEFAULT_CHOICE_LABEL, text: ROUTING_DEFAULT_CHOICE_LABEL, disabled: false, title: ROUTING_DEFAULT_CHOICE_DESCRIPTION }
    }
    const label = ROUTING_LAUNCH_CHOICE_LABELS[choice]
    const view = launchViewOf(input.views, choice)
    if (view?.launchable === true) return { choice, label, text: label, disabled: false, title: null }
    const reason = view?.reason ?? null
    return { choice, label, text: reason === null ? label : `${label} — ${reason}`, disabled: true, title: reason }
  })
  const hint = input.busy ? null : input.error !== null ? routingUnavailableText(input.error) : input.choice.hint
  return { options, selected: input.choice.selected, hint, busy: input.busy }
}

/** K2: the member's `routingTier`; null = send none (OpenRouter default, or a slot routing cannot serve). */
export function helperTierToSend(eligible: boolean, choice: RoutingLaunchChoice): RoutingLaunchTier | null {
  return routingLaunchTierToSend(eligible, choice)
}

/** A slot's accessible name. Never starts with "Helper ": the Team drives count helper slots by that prefix. */
export function helperTierSelectLabel(index: number): string {
  return `Routing tier for helper ${index + 1}`
}

/** K11, C10: what the dialog ranked for, and that each attempt checks again (MR-D32). */
export function routingHelperCaption(effort: string | null): string {
  const again = 'Each attempt checks its tier again on the latest numbers.'
  return effort === null
    ? `Ranked for a Team helper with no reasoning effort set. ${again}`
    : `Ranked for a Team helper at reasoning effort "${effort}". ${again}`
}
