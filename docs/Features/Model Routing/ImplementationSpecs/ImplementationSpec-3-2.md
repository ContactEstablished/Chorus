# Implementation specification 3-2 — Renderer data layer and pure view model

Paired [task](../Tasks/Task-3-2.md). Decisions: [roadmap](../roadmap.md) MR-D10, MR-D11, MR-D19; user decisions MR-D21 to MR-D24; gates MR-G5, MR-G7, MR-G8; [overview](../Tasks/Phase-3-Overview.md) K2–K9 and clarifications C5–C14, C20. Contracts from [ImplementationSpec-3-1](ImplementationSpec-3-1.md) and [ImplementationSpec-2-4](ImplementationSpec-2-4.md). **Not started.**

## Files and insertion points

Verified 2026-10-02 at `5079b5d`.

| File | Action |
|---|---|
| `src/shared/routingView.ts`, `routingView.test.ts` | New. Pure. Table RV. Compiled by both tsconfigs (`src/shared/**/*`). |
| `src/renderer/src/stores/routing.ts`, `routing.test.ts` | New. Table RS. Pattern: `stores/team.ts:4–23` and `team.test.ts:8–12`; adoption as `stores/council.ts:292–297`. |

`routingView.ts` imports only from `./routing` (values and types). It never calls `.parse` or `.safeParse` (C13), and contains none of `Date.now(`, `Math.random(`, `new Date()`, `require(`, `from 'node:` (the purity grep reads comments too). `Date.parse` is allowed: it reads a string, not the clock, as `routingCore.ts:82` does.

## Normative contracts — `src/shared/routingView.ts`

```ts
import {
  ROUTING_FAILURE_MESSAGES, ROUTING_REFRESH_COOLDOWN_MS, ROUTING_REFRESH_PROBE_CAP_USD,
  type CandidateExplanation, type Quantization, type RankedTier, type RoutingCredential, type RoutingFailure,
  type RoutingObservationSettings, type RoutingObserverOutcome, type RoutingProfileId, type RoutingProgressEvent,
  type RoutingSettings, type RoutingStatus, type TierResult
} from './routing'

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
export const ROUTING_PREVIEW_NOTE = 'Preview only: launches do not use these tiers yet.' // C20
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
export function formatUsd(value: number): string
export function formatPerMillion(value: number): string
export function formatTps(value: number | null): string
export function formatSeconds(value: number | null): string
export function formatUptime(value: number | null): string
export function formatAgo(ageMs: number): string

// ── Views ──
export function snapshotAgeView(fetchedAt: string, nowMs: number, maxAgeMinutes: number): SnapshotAgeView
export function tierCardViews(result: TierResult | null, settings: RoutingSettings): TierCardView[] // budget, balanced, fast
export function nitroCardView(result: TierResult | null, model: string): NitroCardView
export function resultNotes(result: TierResult): string[]
export function providerTableView(result: TierResult): ProviderTableView
export function refreshProgressView(events: readonly RoutingProgressEvent[], phase: RefreshPhase): RefreshProgressView | null
export function cooldownRemainingSeconds(endedAtMs: number | null, nowMs: number, cooldownMs?: number): number // default ROUTING_REFRESH_COOLDOWN_MS
export function refreshButtonView(input: { phase: RefreshPhase; cooldownSeconds: number; canRefresh: boolean }): RefreshButtonView
export function defaultRefreshCredential(credentials: readonly RoutingCredential[], observation: RoutingObservationSettings | null): string | null
export function credentialOptionLabel(credential: RoutingCredential): string
export function observationView(
  observation: RoutingObservationSettings, status: RoutingStatus | null, credentials: readonly RoutingCredential[], nowMs: number
): ObservationView
```

`formatUsd` is a function declaration, so `ROUTING_REFRESH_COST_TEXT` can use it at module load. Every function returns fresh arrays and objects and never mutates its inputs.

## Rules

**`formatUsd(v)` (C5)**, for spend and estimates, in order: not finite or negative → `—`; `0` → `$0.00`; below 0.0001 → `<$0.0001`; below 1 → `'$' + v.toFixed(4).replace(/0{1,2}$/, '')` (four decimals, up to two trailing zeros removed); otherwise `'$' + v.toFixed(2)`.

**`formatPerMillion(v)`**, for $/M prices: not finite → `—`; `0` → `$0/M`; with `a = |v|` and a `-` sign prefix when `v < 0`: `a ≥ 1` → two decimals; `a < 0.000001` → `<$0.000001/M`; otherwise `d = 2 − floor(log10(a))` decimals (three significant figures, never exponent notation). Always suffixed `/M`.

**`formatTps(v)`**: `null` or not finite → `—`; else `v.toFixed(1)` with a trailing `.0` removed, plus ` tok/s`.

**`formatSeconds(v)`**: `null` or not finite → `—`; else `v.toFixed(2) + ' s'`.

**`formatUptime(v)` (C6)**: `null` or not finite → `—`; else `(Math.floor(v * 100 + 1e-9) / 100).toFixed(2) + '%'`, the same truncation as `truncatePct(v, 2)` (`eligibilityCore.ts:50–52`), which this module cannot import (it may import only `./routing`).

**`formatAgo(ageMs)`**: `m = floor(max(0, ageMs) / 60,000)`; `0` → `just now`; below 120 → `${m} min ago`; below 2,880 → `${floor(m / 60)} h ago`; otherwise `${floor(m / 1,440)} days ago`.

**`snapshotAgeView(fetchedAt, nowMs, maxAgeMinutes)`** mirrors `routingCore.ts:82–84`: `ageMs = nowMs − Date.parse(fetchedAt)`; `minutes = floor(max(0, ageMs) / 60,000)`; `stale = ageMs > maxAgeMinutes × 60,000`; `text = 'Updated ' + formatAgo(ageMs)`; `staleText = stale ? 'Older than ${maxAgeMinutes} min. Refresh before relying on these numbers.' : null`. A negative age (clock behind) is `0`, not stale. The caller passes `settings.snapshotMaxAgeMinutes`.

**Endpoint summary** (inside cards) from the candidate whose `tag` equals the tier's first endpoint: `quantization` = `effectiveQuantization`; `priceText` = `formatPerMillion(cost.blended) + ' blended'` (or `—` when `cost` is `null`); `speedText` = `formatTps(tpsP50)`; `effectiveText` = the `formatTps(effectiveTps)` number + ` effective tok/s` (or `—`); `latencyText` = `formatSeconds(latencyP50S)`; `uptimeText` = `formatUptime(uptime1d) + ' uptime'` (or `—`); `cacheVerified` = `cost?.cacheCredit === true`; `timeOfDayPrice` = `cost?.overrideApplied === true`.

**`tierCardViews(result, settings)` (K6, C9).** One card per ranked tier, in `budget`, `balanced`, `fast` order, `label` from `ROUTING_TIER_LABELS`.

- `result === null` → `state: 'no-snapshot'`, `reason: 'No endpoint numbers for this model yet. Refresh to rank it.'`, `primary: null`, `fallbacks: []`, `fallbackText: ''`, `limitedHistory: false`, `notes: []`.
- Let `eligible` be the candidates with an empty `excludedBy`, `floorOut` those of them with `budgetFloorExcluded`, `floor = result.budgetFloorTps`, `sel = result.tiers[tier]`.
- `sel === null` → `state: 'empty'` and `reason`: if `eligible` is empty, `No provider meets the uptime and precision rules right now.` (Plan_1 §2); else if the tier is Budget, `floor !== null` and every eligible candidate is floor-excluded, `All ${n} eligible endpoint(s) are below the ${formatTps(floor)} Budget floor.` (`endpoint is` for 1, `endpoints are` otherwise); else `No endpoint could be ranked for this tier.`
- `sel !== null` → `state: 'ranked'`; `fallbacks = sel.endpoints.slice(1)`; `fallbackText = fallbacks.length === 0 ? 'No fallback available.' : 'Fallbacks: ' + fallbacks.join(', ')`; `limitedHistory = sel.limitedHistory`. `reason`: for Budget with `floor !== null`, `First of ${n} endpoint(s) at or above the ${formatTps(floor)} Budget floor, scored ${phrase}.` with `n = eligible − floorOut`; otherwise `First of ${n} eligible endpoint(s), scored ${phrase}.` with `n = eligible`. `phrase` from `w = settings.tierWeights[tier]`: `1` → `on speed only`; `0` → `on price only`; `0.5` → `equally on price and speed`; below 0.5 → `mostly on price`; otherwise `mostly on speed`.
- **Budget-floor note** (the Phase 1 carry-over): Budget only, when `sel !== null`, `floor !== null`, `floorOut > 0` and `sel.limitedFallbacks`: `notes` is one string, exactly `` `${k} eligible ${k === 1 ? 'endpoint is' : 'endpoints are'} below the ${formatTps(floor)} Budget floor.` `` with `k = floorOut` (RV9). Otherwise `[]`.
- `TierSelection.rationale` is never read (K6).

**`nitroCardView(result, model)` (MR-D11, C8).** `label = NITRO_CARD_LABEL`; `caveats = [...NITRO_CAVEATS]`.

- `result === null` → `model: model + ':nitro'`, `state: 'no-snapshot'`, `likely: null`, `failsRules: []`, `warning: 'Unfiltered: OpenRouter picks the provider. Refresh to see which one is likely.'`
- `result.nitro.likely === null` → `model: result.nitro.model`, `state: 'no-likely'`, `warning: 'No endpoint in the snapshot passes the capability filters, so the likely provider is unknown.'`
- otherwise `state: 'likely'`, `likely: { tag, providerName, speedText: formatTps(tpsP50) }`, `failsRules: [...likelyFailsRules]`, and `warning`: with failing rules, `` `Likely provider: ${providerName} (${tag}), ${likelyFailsRules.join(', ')}.` ``; with none, `Unfiltered, but the likely provider currently passes the uptime and precision rules.`

**`resultNotes(result)` (C7):** `result.stale ? result.warnings.slice(1) : [...result.warnings]`. W1 is the first warning exactly when `stale` (`routingCore.ts:120–122`); the live age line replaces it. No warning is parsed, filtered by text or rewritten. W3 (`Data-policy removals were not checked.`) is shown verbatim because `TierResult` still has no structured field for it.

**`providerTableView(result)` (K7, C10).** Rows: the eligible candidates, then the excluded ones, each in `result.candidates` order (sorted by tag). Per row: `rowsText = rows > 1 ? '${rows} endpoints' : null`; `quantization = quantization === effectiveQuantization ? quantization : '${quantization} (as ${effectiveQuantization})'`; `uptimeText = formatUptime(uptime1d)`; `inputText`, `outputText`, `cacheReadText`, `blendedText` = `formatPerMillion` of `cost.promptPerM`, `completionPerM`, `cacheReadPerM`, `blended` (each `—` when `cost` is `null`); `speedText = formatTps(tpsP50)`; `latencyText = formatSeconds(latencyP50S)`; `statusText` = `'Excluded: ' + excludedBy.join('; ')` when excluded, else `'Eligible · below the Budget floor'` when `budgetFloorExcluded`, else `'Eligible'`; `limitedHistory`, `cacheVerified = cost?.cacheCredit === true`, `timeOfDayPrice = cost?.overrideApplied === true`. `showText = 'Show all providers (${eligible} eligible · ${excluded} excluded)'`; `hideText = 'Hide providers'`.

**`refreshProgressView(events, phase)` (K3, MR-G7).** `events` are the adopted events of one refresh, in arrival order. `phase === 'idle'` → `null`. Otherwise, with the first event of each stage:

1. `endpoints` → `Endpoints: ${endpointRows} rows, ${tags} tags` plus `, ${rejectedRows} rejected` when `rejectedRows > 0`.
2. `preflight` → `Account: guardrails ${g}; data policy ${d}`, each from its outcome: not `attempted` → `not checked`; `removed === null` → `unknown`; empty → `none removed`; else `removed ` + the tags joined by `, `.
3. `probe-plan` → with `planned.length === 0`, `Cache probe: nothing due (${fresh.length} checked within 14 days)`; otherwise `Cache probe: ${p} endpoint(s), estimated ${formatUsd(estimateUsd)} (cap ${formatUsd(capUsd)})` plus `; ${k} left for a later refresh` when `k` entries of `notProbed` have reason `cap`. `estimateText = 'Estimated ' + formatUsd(estimateUsd)`.
4. When a plan with `p > 0` exists: `Probing caches: ${n} of ${p}`, `n` = the number of `probe` events, plus ` (spent ${formatUsd(last probe's spentUsd, or 0)} so far)` while no terminal event has arrived.
5. `done` → `Done. Spent ${formatUsd(spentUsd)} of an estimated ${formatUsd(estimateUsd)}.`; `failed` → `Failed: ${message} Spent ${formatUsd(spentUsd)}.`; either sets `spentText = 'Spent ' + formatUsd(spentUsd)`.
6. While `phase === 'running'` and no terminal event: append the pending step — `Fetching endpoints…` before `endpoints`, `Checking account eligibility…` before `preflight`, `Planning the cache probe…` before `probe-plan`; nothing after.

`state` is the terminal event's stage when present, else `running` when `phase === 'running'`, else `phase` (a `failed` phase with no events is a pre-network refusal: `lines` is empty and the view shows the store's error instead). The estimate line and `estimateText` exist from the `probe-plan` event on, so they precede every probe; `spentText` exists only once a terminal event arrived (MR-G7).

**`cooldownRemainingSeconds(endedAtMs, nowMs, cooldownMs)`** mirrors main (C2, C12): `null` → 0; `elapsed = nowMs − endedAtMs`; `elapsed < 0` or `elapsed ≥ cooldownMs` → 0; else `ceil((cooldownMs − elapsed) / 1000)`.

**`refreshButtonView`**, first match: `phase === 'running'` → `{ text: 'Refreshing…', disabled: true, title: 'A refresh is running.' }`; `!canRefresh` → `{ text: 'Refresh', disabled: true, title: 'Choose a model and an OpenRouter API-key credential first.' }`; `cooldownSeconds > 0` → `` { text: `Refresh again in ${s} s`, disabled: true, title: 'Refreshes of one model are at least a minute apart.' } ``; else `{ text: 'Refresh', disabled: false, title: ROUTING_REFRESH_COST_TEXT }`.

**`defaultRefreshCredential(credentials, observation)` (K5):** the designated id when it is in `credentials`; else the first credential's id; else `null`. **`credentialOptionLabel(c)`:** `` `${c.label} · ${c.providerName}` ``.

**`observationView(observation, status, credentials, nowMs)` (K8, C11).** `designated` = the credential whose id is `observation.credentialProfileId`, or `null`.

| Field | Rule |
|---|---|
| `enabled`, `designatedId` | From `observation`. |
| `designatedUsable` | `designatedId === null` or `designated !== null`. |
| `stateText` | Not enabled → `Off. Chorus makes no background requests.`; no id → `On, but nothing is recorded until you choose a credential.`; usable → `` `Every 30 minutes, one free request with ${designated.label}. No prompts are sent.` ``; else `On, but the chosen credential can no longer be used.` |
| `warning` | Enabled, an id, and not usable → `The chosen credential is no longer an OpenRouter API-key credential that routing can use. Choose another, or turn background observation off.`; else `null`. |
| `lastText` | `status?.observer.lastTickAt` null → `null`; else `` `Last check ${formatAgo(nowMs − Date.parse(lastTickAt))}: ${outcome}.` `` with `outcome` from the table below. |
| `nextText` | State `running` → `Checking now.`; state `scheduled` with `nextTickAt` → `m = ceil((Date.parse(nextTickAt) − nowMs) / 60,000)`, `m ≤ 0` → `Next check due now.`, else `` `Next check in ${m} min.` ``; state `stopped` → `The observer is not running.`; otherwise `null`. |
| `credentialHint` | `credentials.length === 0` → `ROUTING_NO_CREDENTIAL_HINT`; else `null`. |

Outcome text (`lastOutcome`): `observed` → `recorded new numbers`; `dormant` → `dormant`; `skipped-fresh` → `skipped, the numbers were fresh`; `busy` → `skipped, a refresh was running`; `refused` → `refused, the credential cannot be used for routing`; `decrypt-failed` → `the credential could not be decrypted`; `fetch-failed` → `could not fetch`, plus ` (${ROUTING_FAILURE_MESSAGES[lastFailure]} without its final period)` when `lastFailure` is set; `failed` → `failed`.

## Normative contracts — `src/renderer/src/stores/routing.ts`

```ts
import { defineStore } from 'pinia'
import type {
  RoutingCredential, RoutingErrorCode, RoutingModelList, RoutingObservationSettings, RoutingProfileId,
  RoutingProgressEvent, RoutingRefreshResult, RoutingReply, RoutingSettings, RoutingStatus, TierResult
} from '../../../shared/routing'
import { ROUTING_INSPECTOR_EFFORT, defaultRefreshCredential, type RefreshPhase } from '../../../shared/routingView'

export interface RoutingFailureInfo { code: RoutingErrorCode; message: string }

/** D14, MR-G5: a JSON snapshot. Pinia state is a Proxy (nested objects too); structured clone rejects it. */
export function plainRoutingInput<T>(input: T): T { return JSON.parse(JSON.stringify(input)) as T }

/** K4, C14: unlike teamValue, the code survives. */
export class RoutingReplyError extends Error {
  constructor(readonly code: RoutingErrorCode, message: string) { super(message); this.name = 'RoutingReplyError' }
}
export function routingValue<T>(reply: RoutingReply<T>): T {
  if (!reply.ok) throw new RoutingReplyError(reply.code, reply.message)
  return reply.value
}
/** A RoutingReplyError keeps its code; an Error (a bridge rejection) is OPERATION_FAILED with its own message; anything else the fixed one. */
export function routingFailure(err: unknown): RoutingFailureInfo {
  if (err instanceof RoutingReplyError) return { code: err.code, message: err.message }
  if (err instanceof Error && err.message !== '') return { code: 'OPERATION_FAILED', message: err.message }
  return { code: 'OPERATION_FAILED', message: 'Routing operation failed.' }
}

export interface RoutingRefreshState {
  phase: RefreshPhase
  model: string | null
  refreshId: string | null
  events: RoutingProgressEvent[]
  result: RoutingRefreshResult | null
  error: RoutingFailureInfo | null
  endedAtMs: number | null // C12: set only when the refresh reached the network
}
```

**State.** `loaded` (false), `loading` (false), `loadError` (`RoutingFailureInfo | null`), `models` (`RoutingModelList['models']`, `[]`), `credentials` (`RoutingCredential[]`, `[]`), `settings`, `observation`, `status` (each `null`), `model` (`null`), `profile` (`'interactive'`), `credentialProfileId` (`null`; the "Refresh with" choice), `tiers` (`TierResult | null`), `tiersError` (`RoutingFailureInfo | null`), `refresh` (`{ phase: 'idle', model: null, refreshId: null, events: [], result: null, error: null, endedAtMs: null }`), `saving` (false), `actionError` (`RoutingFailureInfo | null`). Module scope: `let unsubscribe: (() => void) | null`, `let consumers = 0`, `let tiersSeq = 0`.

**Actions** (every one catches its own errors; none rejects to its caller):

| Action | Behaviour |
|---|---|
| `connect(): () => void` | As `team.ts:14–23`: increments `consumers`; subscribes once with `window.chorus.routing.onProgress((e) => this.ingestProgress(e))`; returns an idempotent release that unsubscribes when the count reaches 0. |
| `ingestProgress(event)` | Ignored unless `refresh.phase === 'running'` and `event.model === refresh.model`. If `refresh.refreshId === null`, adopt `event.refreshId`; else ignore an event with another id. Push the event. |
| `load()` | `loading = true`, `loadError = null`. `Promise.all` of `models({})`, `credentials({})`, `settingsGet({})`, `observationGet({})`, `status({})`, each through `routingValue`. On failure: `loadError = routingFailure(err)`, `loading = false`, stop. On success: assign the five; keep `model` if it is still listed, else the first slug or `null`; keep `credentialProfileId` if still listed, else `defaultRefreshCredential(credentials, observation)`; `loaded = true`, `loading = false`; then `await this.loadTiers()`. |
| `loadTiers()` | `seq = ++tiersSeq`. `model === null` → `tiers = null`, `tiersError = null`. Else `tiers(plainRoutingInput({ model, profile, effort: ROUTING_INSPECTOR_EFFORT, credentialProfileId }))`. A response whose `seq !== tiersSeq` is dropped. Success → `tiers`, `tiersError = null`. Failure → `tiers = null`, `tiersError = routingFailure(err)` (`NO_SNAPSHOT` is the no-snapshot state, not an error, for the view). |
| `loadStatus()` | `status = routingValue(await status({}))`; a failure leaves `status` unchanged. |
| `selectModel(slug)`, `selectProfile(p)`, `selectCredential(id \| null)` | Assign, then `await this.loadTiers()` (K5). |
| `startRefresh()` | Returns at once when `refresh.phase === 'running'`, `model === null` or `credentialProfileId === null`. Sets `refresh = { phase: 'running', model, refreshId: null, events: [], result: null, error: null, endedAtMs: null }`, then awaits `refresh(plainRoutingInput({ model, credentialProfileId, profile, effort: ROUTING_INSPECTOR_EFFORT }))`. Success → `refreshId = result.refreshId`, `events` filtered to that id, `result`, `phase = 'done'`, `endedAtMs = Date.now()`. Failure → `error = routingFailure(err)`, `phase = 'failed'`, `endedAtMs = events.length > 0 ? Date.now() : null` (C12). Then, either way, `await Promise.all([this.loadTiers(), this.loadStatus()])` (K5). |
| `setDataCollection(value): Promise<boolean>` | MR-D24. Returns `false` at once while `saving`. `saving = true`, `actionError = null`. Reads `current = routingValue(await settingsGet({}))`, then `stored = routingValue(await settingsSet(plainRoutingInput({ settings: { ...current, dataCollection: value } })))`; `settings = stored`; `saving = false`; `await this.loadTiers()`; returns `true`. On failure `actionError`, `saving = false`, `false`; `settings` unchanged. |
| `setObservation(enabled, credentialProfileId): Promise<boolean>` | MR-D23, C11. Sends `plainRoutingInput(enabled ? { enabled: true, credentialProfileId } : { enabled: false, credentialProfileId: null })` to `observationSet`. Success → `observation = stored`, `true`. Failure → `actionError = routingFailure(err)`; best-effort `observation = routingValue(await observationGet({}))`; `false`. Then `await this.loadStatus()` either way. `saving` guards it as above. |

`flashSaved()` is not called here; `SettingsRouting.vue` calls it when an action returns `true` (K9). Nothing here starts a timer.

## Test cases

**Golden inputs (`routingView.test.ts`).** Build the golden `TierResult` as `routingIpc.test.ts:55–76` does (the Phase 1 golden input of ImplementationSpec-1-3: fixture snapshot fetched 09:05:00Z, history from `extractObservations`, account `['deepseek']`/`['deepseek']` checked 09:15:39Z, the fixture's cache verifications, effort `'low'`, defaults, `now` 09:20:00Z), importing `computeTiers`, `parseEndpointsResponse`, `extractObservations`, `bundledModelRegistry`, `findModel` and `truncatePct` from `../main/routing/*` and reading the fixture with `readFileSync(new URL(…, import.meta.url))` as `routing.test.ts` does. Variants: **helper** (profile `helper`); **unknown** (account all `null`, cache `{}`); **stale** (`now` 10:06:00Z); **empty** (settings `minUptimePct` and `readmitUptimePct` 100); **floor130** and **floor1000** (`budgetMinTps` 130, 1000); **nitroPass** (the fixture rows with `together`'s `quantization` set to `'fp8'`). Hand-edited clones of golden: **oneBalanced** (`tiers.balanced.endpoints = ['deepinfra/fp8']`, `limitedFallbacks = true`); **noLikely** (`nitro.likely = null`, `likelyFailsRules = []`). Expected values were computed as described in the overview ("Golden view values"). `LIMITED_14` = `Limited history: 14 of 14 eligible endpoints have fewer than 3 speed observations.`

**Table RV — `src/shared/routingView.test.ts`.**

| # | Case | Expect |
|---|---|---|
| RV1 | `formatUsd` of 0, 0.00004, 0.0001, 0.0028, 0.0045, 0.0049, 0.02, 0.021, 0.0493873956, 0.05, 0.1, 0.002497428, 0.017288676, 1.234, −1, `NaN` | `$0.00`, `<$0.0001`, `$0.0001`, `$0.0028`, `$0.0045`, `$0.0049`, `$0.02`, `$0.021`, `$0.0494`, `$0.05`, `$0.10`, `$0.0025`, `$0.0173`, `$1.23`, `—`, `—` |
| RV2 | `formatPerMillion` of 0, 0.0165144, 0.30959010000000003, 0.14, 0.004200000000000001, 1.2, 0.0000005, 0.0021149999999999997, `NaN` | `$0/M`, `$0.0165/M`, `$0.310/M`, `$0.140/M`, `$0.00420/M`, `$1.20/M`, `<$0.000001/M`, `$0.00211/M`, `—`; none contains `e` |
| RV3 | `formatTps` of `null`, 63, 48.462097639588144, 119.90871465593936, 45.25, 223; `formatSeconds` of `null`, 1.4285, 0.297, 2.52; `formatUptime` of `null`, 99.96103059189728, 99.4951480572302, 99.6, 100, 97.18112731773334; and for every golden candidate | `—`, `63 tok/s`, `48.5 tok/s`, `119.9 tok/s`, `45.3 tok/s`, `223 tok/s`; `—`, `1.43 s`, `0.30 s`, `2.52 s`; `—`, `99.96%`, `99.49%`, `99.60%`, `100.00%`, `97.18%`; `formatUptime(c.uptime1d) === truncatePct(c.uptime1d, 2) + '%'` for all 32 |
| RV4 | `snapshotAgeView('2026-10-02T09:05:00Z', Date.parse(t), 60)` for `t` = 09:20:00Z, 10:05:00Z, 10:05:00.001Z, 11:05:00Z, 2026-10-04T09:05:00Z, 09:05:59.999Z, 09:00:00Z | `{ 15, false, 'Updated 15 min ago', null }`; `{ 60, false, 'Updated 60 min ago', null }`; `{ 60, true, 'Updated 60 min ago', 'Older than 60 min. Refresh before relying on these numbers.' }`; `{ 120, true, 'Updated 2 h ago', … }`; `{ 2880, true, 'Updated 2 days ago', … }`; `{ 0, false, 'Updated just now', null }`; `{ 0, false, 'Updated just now', null }` (as `{ minutes, stale, text, staleText }`) |
| RV5 | `tierCardViews(golden, DEFAULT_ROUTING_SETTINGS)` | Budget strictly equals `{ tier: 'budget', label: 'Budget', state: 'ranked', primary: { tag: 'deepinfra/fp8', providerName: 'DeepInfra', quantization: 'fp8', priceText: '$0.0165/M blended', speedText: '63 tok/s', effectiveText: '48.5 effective tok/s', latencyText: '1.43 s', uptimeText: '99.96% uptime', cacheVerified: true, timeOfDayPrice: false }, fallbacks: ['streamlake/fp8', 'gmicloud/fp8'], fallbackText: 'Fallbacks: streamlake/fp8, gmicloud/fp8', reason: 'First of 12 endpoints at or above the 45.3 tok/s Budget floor, scored mostly on price.', limitedHistory: true, notes: [] }`. Balanced: primary `deepinfra/fp8` (same summary), `Fallbacks: streamlake/fp8, makora/fp8`, `First of 14 eligible endpoints, scored equally on price and speed.`. Fast: primary `venice/fp8` with `$0.0449/M blended`, `186 tok/s`, `119.9 effective tok/s`, `0.89 s`, `99.83% uptime`, `cacheVerified` true; `Fallbacks: baidu/fp8, parasail/fp8`; `First of 14 eligible endpoints, scored on speed only.`. No card string contains `effective tok/s, $` (a `rationale` fragment). |
| RV6 | helper | Primaries `streamlake/fp8`, `streamlake/fp8`, `venice/fp8`; fallbacks `Fallbacks: deepinfra/fp8, gmicloud/fp8`, `Fallbacks: venice/fp8, gmicloud/fp8`, `Fallbacks: baidu/fp8, parasail/fp8`; reasons as RV5. |
| RV7 | `tierCardViews(null, defaults)` | Three cards, `state: 'no-snapshot'`, `reason: 'No endpoint numbers for this model yet. Refresh to rank it.'`, `primary: null`, `fallbackText: ''`. |
| RV8 | empty | Three cards `state: 'empty'`, `reason: 'No provider meets the uptime and precision rules right now.'`. `resultNotes`: `['Budget: no eligible endpoints.', 'Balanced: no eligible endpoints.', 'Fast: no eligible endpoints.']`. `nitroCardView`: `state: 'likely'`, warning `Likely provider: Together (together), uptime 99.96% < 100%, quantization not declared.` |
| RV9 | floor130; floor1000 | floor130 Budget: `ranked`, primary `venice/fp8`, `Fallbacks: baidu/fp8`, reason `First of 2 endpoints at or above the 130 tok/s Budget floor, scored mostly on price.`, notes `['12 eligible endpoints are below the 130 tok/s Budget floor.']`; its `resultNotes` `['Budget: only 2 eligible endpoints; limited fallbacks.', LIMITED_14]`. floor1000 Budget: `empty`, reason `All 14 eligible endpoints are below the 1000 tok/s Budget floor.`, notes `[]`; Balanced and Fast still `ranked`; `resultNotes` `['Budget: no eligible endpoints.', LIMITED_14]` (verbatim W4; the card explains it). |
| RV10 | oneBalanced | Balanced `fallbacks: []`, `fallbackText: 'No fallback available.'`, `notes: []`. |
| RV11 | `nitroCardView` of golden; nitroPass; `null`; noLikely (model `deepseek/deepseek-v4.1-flash`) | Golden: `{ label: 'Nitro — unfiltered provider routing', model: 'deepseek/deepseek-v4.1-flash:nitro', state: 'likely', likely: { tag: 'together', providerName: 'Together', speedText: '223 tok/s' }, warning: 'Likely provider: Together (together), quantization not declared.', failsRules: ['quantization not declared'], caveats: NITRO_CAVEATS }`. nitroPass: warning `Unfiltered, but the likely provider currently passes the uptime and precision rules.`, `failsRules: []`. `null`: `state: 'no-snapshot'`, model `deepseek/deepseek-v4.1-flash:nitro`, warning `Unfiltered: OpenRouter picks the provider. Refresh to see which one is likely.`. noLikely: `state: 'no-likely'`, warning `No endpoint in the snapshot passes the capability filters, so the likely provider is unknown.` |
| RV12 | `resultNotes` of golden; unknown; stale | `[LIMITED_14]`; `['Account guardrails were not checked; a pinned endpoint may be refused.', 'Data-policy removals were not checked.', LIMITED_14]`; stale's `warnings` are `['Snapshot is 61 minutes old (limit 60); refresh before launching.', LIMITED_14]` and its notes `[LIMITED_14]`. |
| RV13 | `providerTableView(golden)` | `eligible` 14, `excluded` 18, `showText` `Show all providers (14 eligible · 18 excluded)`, `hideText` `Hide providers`. Row tags in order: `atlas-cloud/fp8, baidu/fp8, baseten/fast, baseten/fp8, deepinfra/fp8, gmicloud/fp8, makora/fp8, morph/fp8, nextbit/fp8, novita/fp8, parasail/fp8, siliconflow/fp8, streamlake/fp8, venice/fp8, alibaba, coreweave/fp8, decart/fp4, deepseek, dekallm, digitalocean, fireworks, fireworks/us, inference-net, io-net/fp8, ionstream, modal, open-inference/fp4, phala, relace, sail-research/fp4, together, wafer`. Rows (uptime, input, output, cache read, blended, speed, latency, status): `deepinfra/fp8` `99.96%`, `$0.140/M`, `$0.420/M`, `$0.00420/M`, `$0.0165/M`, `63 tok/s`, `1.43 s`, `Eligible`, `cacheVerified` true. `baseten/fp8` `rowsText` `2 endpoints`, `$0.300/M`, `$1.20/M`, `$0.00700/M`, `$0.0368/M`, `62 tok/s`, `0.30 s`, `Eligible`. `baseten/fast` quant `fp32`, `$0.191/M`, `31 tok/s`, `Eligible · below the Budget floor`. `morph/fp8` `17 tok/s`, `Eligible · below the Budget floor`. `alibaba` `97.18%`, `$0.310/M`, `6.94 s`, `Excluded: uptime 97.18% < 99.5%; currently degraded (5m uptime 92.3%); status -2; quantization not declared`, `timeOfDayPrice` true. `deepseek` quant `unknown (as fp8)`, `Excluded: uptime 99.34% < 99.5%; removed by account guardrail; removed by data policy`. `together` `223 tok/s`, `Excluded: quantization not declared`, `cacheVerified` true. `decart/fp4` `$0.0900/M`, `$0.180/M`, `$0.0180/M`, `$0.0910/M`, `Excluded: fp4 below native fp8`. |
| RV14 | `refreshProgressView` over the event fixtures below | See Table RV14. |
| RV15 | MR-G7 ordering: for every prefix of the full sequence (endpoints, preflight, probe-plan, 14 probes, done) with phase `running` | `estimateText` is `null` before `probe-plan` and `Estimated $0.0494` from it on (so before the first probe); `spentText` is `null` for every prefix without `done`. |
| RV16 | `cooldownRemainingSeconds` of (`null`, 0), (1000, 1000), (1000, 43000), (1000, 60999), (1000, 61000), (1000, 500) | 0, 60, 18, 1, 0, 0. |
| RV17 | `refreshButtonView` of `{ running, 0, true }`, `{ idle, 0, false }`, `{ done, 42, true }`, `{ done, 0, true }`, `{ failed, 0, true }` | `Refreshing…`/disabled; `Refresh`/disabled/`Choose a model and an OpenRouter API-key credential first.`; `Refresh again in 42 s`/disabled; `Refresh`/enabled/`ROUTING_REFRESH_COST_TEXT`; the same. |
| RV18 | `defaultRefreshCredential` with `[A, B]` and designated `B`; designated `X` (not listed); `null` observation; `[]`. `credentialOptionLabel({ id, label: 'OR key', providerName: 'OpenRouter' })` | `B`; `A`; `A`; `null`. `OR key · OpenRouter`. |
| RV19 | `observationView` cases (Table RV19) | As listed. |
| RV20 | Determinism and purity: every view function over deep-frozen golden inputs, called twice | No throw; strictly equal results; `JSON.parse(JSON.stringify(r))` strictly equals `r`; the inputs are unchanged. |
| RV21 | Constants | `ROUTING_INSPECTOR_EFFORT` `'low'`; `ROUTING_PREVIEW_NOTE` `Preview only: launches do not use these tiers yet.`; `ROUTING_REFRESH_COST_TEXT` `A refresh fetches the endpoint list and checks account eligibility (both free), then may spend up to about $0.05 of OpenRouter credit verifying prompt caching. The estimate is shown before anything is spent.`; `ROUTING_PROFILE_LABELS` `{ interactive: 'Interactive', helper: 'Team helper' }`. |

**Table RV14 — progress fixtures.** Base `{ refreshId: R1, model: 'deepseek/deepseek-v4.1-flash', at: '2026-10-02T09:20:00Z' }`. `endpoints` `{ endpointRows: 33, tags: 32, rejectedRows: 0 }`; `preflight` with both outcomes `{ attempted: true, removed: ['deepseek'], issue: null, failure: null }`; `plan` planning the 14 tags of `routingService.test.ts`'s `Q1_ORDER` with `estimateUsd` 0.0493873956, `capUsd` 0.05, `fresh: []`, `notProbed: []`; probe events `i = 1..14` with `spentUsd` `0.0015 × i` (rounded to 6 places); `done` `{ estimateUsd: 0.0493873956, spentUsd: 0.021 }`; `failed` `{ code: 'FETCH_FAILED', failure: 'provider-error', message: 'OpenRouter returned an error.', spentUsd: 0 }`.

| Events, phase | `state` | `lines` | `estimateText` / `spentText` |
|---|---|---|---|
| `[]`, `idle` | — | `null` (no view) | — |
| `[]`, `running` | running | `Fetching endpoints…` | `null` / `null` |
| `[endpoints]`, `running` | running | `Endpoints: 33 rows, 32 tags`; `Checking account eligibility…` | `null` / `null` |
| `[endpoints, preflight, plan, probe×3]`, `running` | running | `Endpoints: 33 rows, 32 tags`; `Account: guardrails removed deepseek; data policy removed deepseek`; `Cache probe: 14 endpoints, estimated $0.0494 (cap $0.05)`; `Probing caches: 3 of 14 (spent $0.0045 so far)` | `Estimated $0.0494` / `null` |
| full sequence with `done`, `done` | done | the first three lines; `Probing caches: 14 of 14`; `Done. Spent $0.021 of an estimated $0.0494.` | `Estimated $0.0494` / `Spent $0.021` |
| `[failed]`, `failed` | failed | `Failed: OpenRouter returned an error. Spent $0.00.` | `null` / `Spent $0.00` |
| `[]`, `failed` | failed | `[]` | `null` / `null` |
| `[endpoints, preflight, plan']`, `running`, where `plan'` plans the first 7 tags for 0.017288676, cap 0.02, the other 7 `notProbed` with reason `cap` | running | the first two lines; `Cache probe: 7 endpoints, estimated $0.0173 (cap $0.02); 7 left for a later refresh`; `Probing caches: 0 of 7 (spent $0.00 so far)` | `Estimated $0.0173` / `null` |
| `[endpoints, preflight, plan'', done'']`, `done`, where `plan''` plans nothing with 13 `fresh` tags and `done''` has 0 spend and 0 estimate | done | the first two lines; `Cache probe: nothing due (13 checked within 14 days)`; `Done. Spent $0.00 of an estimated $0.00.` | `Estimated $0.00` / `Spent $0.00` |
| `[endpoints, preflight']`, `running`, where `preflight'` has guardrails `{ attempted: true, removed: null, issue: 'unrecognized-body', failure: null }` and data policy not attempted | running | `Endpoints: 33 rows, 32 tags`; `Account: guardrails unknown; data policy not checked`; `Planning the cache probe…` | `null` / `null` |

**Table RV19 — observation fixtures.** `NOW_MS = Date.parse('2026-10-02T09:20:00Z')`; credentials `C` (`OR key`, `OpenRouter`).

| Observation, credentials, status | Expect |
|---|---|
| `{ false, null }`, `[C]`, dormant `disabled` | `stateText` `Off. Chorus makes no background requests.`; `warning`, `nextText`, `credentialHint` `null`. |
| `{ true, null }`, `[]`, dormant `undesignated`, no ticks | `On, but nothing is recorded until you choose a credential.`; `credentialHint` `Add an OpenRouter API-key credential under Providers & keys first.`; `lastText` `null`. |
| `{ true, C }`, `[C]`, `scheduled`, `nextTickAt` 09:49:30Z, `lastTickAt` 08:49:30Z, `lastOutcome` `observed` | `Every 30 minutes, one free request with OR key. No prompts are sent.`; `designatedUsable` true; `lastText` `Last check 30 min ago: recorded new numbers.`; `nextText` `Next check in 30 min.` |
| `{ true, X }` (not listed), `[C]`, `lastTickAt` 09:18:00Z, `lastOutcome` `refused` | `On, but the chosen credential can no longer be used.`; `designatedUsable` false; `warning` `The chosen credential is no longer an OpenRouter API-key credential that routing can use. Choose another, or turn background observation off.`; `lastText` `Last check 2 min ago: refused, the credential cannot be used for routing.` |
| `{ true, C }`, `[C]`, `lastOutcome` `fetch-failed`, `lastFailure` `rate-limited`, `lastTickAt` 09:20:00Z; state `running` | `lastText` `Last check just now: could not fetch (Rate limited by OpenRouter).`; `nextText` `Checking now.` |
| state `scheduled`, `nextTickAt` 09:19:00Z | `nextText` `Next check due now.` |

**Table RS — `src/renderer/src/stores/routing.test.ts`.** `beforeEach(() => setActivePinia(createPinia()))`; `afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })`. A `stubRouting(overrides)` helper builds `api` with a `vi.fn` per `RoutingApi` member returning `{ ok: true, value }` (models: one DeepSeek entry; credentials `[A, C]`; settings: a clone of `DEFAULT_ROUTING_SETTINGS`; observation `{ enabled: true, credentialProfileId: C }`; status: a dormant status; tiers: the golden `TierResult`; `settingsSet` and `observationSet` echo their input), captures the `onProgress` listener, and installs `vi.stubGlobal('window', { chorus: { routing: api } })`. Every test releases every `connect()` it opens (the count is module state, as in `team.ts`).

| # | Case | Expect |
|---|---|---|
| RS1 | `plainRoutingInput(reactive({ settings: { tierWeights: { budget: 0.3 } } }))`; negative control `structuredClone(reactive({ a: { b: 1 } }))` | The result is not a Proxy (`types.isProxy` from `node:util`), survives `structuredClone`, equals the input, and mutating it leaves the reactive object unchanged. The control throws `could not be cloned`. |
| RS2 | `routingValue` of ok and of `{ ok: false, code: 'NO_SNAPSHOT', message: 'm' }`; `routingFailure` of that error, of `new Error('An object could not be cloned.')`, of `'x'` | The value; a `RoutingReplyError` (`instanceof Error`) with code `NO_SNAPSHOT` and message `m`; `{ NO_SNAPSHOT, 'm' }`; `{ OPERATION_FAILED, 'An object could not be cloned.' }`; `{ OPERATION_FAILED, 'Routing operation failed.' }`. |
| RS3 | `connect()` twice; release the first twice; release the second; `connect()` again | `onProgress` subscribed once; the dispose runs exactly once after the second release; the third `connect()` subscribes again (two subscriptions in total). |
| RS4 | `load()` | `models`, `credentials`, `settingsGet`, `observationGet`, `status` each called once with `{}`; then `tiers` once with `{ model: 'deepseek/deepseek-v4.1-flash', profile: 'interactive', effort: 'low', credentialProfileId: C }`. `loaded` true; `model`, `credentialProfileId` C; `tiers` strictly equals golden; `tiersError` null. |
| RS5 | Observation designates `X` (not listed); then credentials `[]` | `credentialProfileId` is `A` (the first); with `[]` it is `null` and `tiers` is requested with `credentialProfileId: null`. |
| RS6 | `tiers` answers `{ ok: false, code: 'NO_SNAPSHOT', message: 'No endpoint snapshot is stored for this model yet. Refresh first.' }`; then two overlapping `loadTiers()` whose first response arrives last | `tiers` null, `tiersError` `{ NO_SNAPSHOT, … }`. The late first response is dropped; state reflects the second. |
| RS7 | `selectProfile('helper')`; `selectCredential(null)` | `tiers` called with `profile: 'helper'`, then with `credentialProfileId: null`. |
| RS8 | Fake timers at 1,000,000 ms. `connect()`, `load()`, then `startRefresh()` with `refresh` pending; deliver through the listener: an event for `other/model`; `endpoints` with id `R1`; an event with id `R2`; `preflight` with `R1`; resolve with an ok result whose `refreshId` is `R1` | `refresh` called once with `{ model: 'deepseek/deepseek-v4.1-flash', credentialProfileId: C, profile: 'interactive', effort: 'low' }`. While pending: `phase` `running`, `refreshId` `R1`, two events (the other-model and `R2` events ignored). After: `phase` `done`, `result` set, `endedAtMs` 1,000,000; `tiers` and `status` each called twice in total (load + after the refresh). |
| RS9 | `startRefresh()` twice while the first is pending | `refresh` called once. |
| RS10 | `refresh` answers `CREDENTIAL_REFUSED`, `The routing credential was not found.`, with no event | `phase` `failed`; `error` `{ CREDENTIAL_REFUSED, 'The routing credential was not found.' }`; `endedAtMs` `null` (no countdown); tiers and status reloaded. |
| RS11 | `refresh` answers `BUSY`, `This model was refreshed less than a minute ago. Try again in 42 s.` | `error.message` exactly that; `endedAtMs` `null`. |
| RS12 | A `failed` event (`FETCH_FAILED`) is adopted, then `refresh` answers `FETCH_FAILED` | `phase` `failed`; `endedAtMs` = `Date.now()` (the refresh reached the network). |
| RS13 | Events delivered while `phase` is `idle` and after `done` | Ignored. |
| RS14 | `store.settings` set to a reactive copy with `minUptimePct` 99.4 (stale local state); `settingsGet` answers the defaults; `setDataCollection('allow')`. Then `settingsSet` answers `INVALID_REQUEST` | First: `settingsGet` called, then `settingsSet` with `{ settings: { ...DEFAULT_ROUTING_SETTINGS, dataCollection: 'allow' } }` (the fresh read, not local state); returns `true`; `settings` is the reply; `tiers` reloaded. Second: returns `false`, `actionError.code` `INVALID_REQUEST`, `settings` unchanged. |
| RS15 | `setObservation(false, C)`; `setObservation(true, C)`; `setObservation(true, null)`; then `observationSet` answers `CREDENTIAL_REFUSED` with `Routing needs a credential for the OpenRouter gateway.` | `observationSet` called with `{ enabled: false, credentialProfileId: null }`, `{ enabled: true, credentialProfileId: C }`, `{ enabled: true, credentialProfileId: null }`; the refusal returns `false`, sets `actionError.message` to that text, re-reads `observationGet`; `status` reloaded after every call. |
| RS16 | After running RS4, RS8, RS14 and RS15's calls in one store: every argument recorded by every `api` mock; and `refresh` rejecting with `new Error('An object could not be cloned.')` | Each argument: `types.isProxy(arg) === false` and `structuredClone(arg)` does not throw. The rejection does not escape `startRefresh`; `error` is `{ OPERATION_FAILED, 'An object could not be cloned.' }`. |

## Invariants

- `routingView.ts` is pure and deterministic: no clock, randomness, I/O or Zod parsing; `now` is a parameter; inputs are never mutated; outputs are plain JSON (MR-G8). It imports only `./routing`.
- No displayed string comes from `TierSelection.rationale` or W1; every number comes from a numeric field; uptime truncates like `truncatePct`; money follows C5 (K6).
- Every renderer-to-main argument is a `plainRoutingInput` snapshot or an object literal of primitives (D14, MR-G5); the store never parses a reply.
- Error codes survive to the view (C14). The store never throws out of an action.
- Progress is adopted only for the model being refreshed while that refresh runs (K4); the countdown starts only after a network-reaching refresh (C12).
- No timer, refresh-on-mount or selection exists in either file (K3, MR-D21).

## Verification

```powershell
npm run typecheck
npx vitest run src/shared/routingView.test.ts src/renderer/src/stores/routing.test.ts
npm test
Get-ChildItem -Path src/main/routing, src/shared/routing.ts, src/shared/routingView.ts -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern 'Date\.now\(|Math\.random\(|new Date\(\)|from ''(node:|fs''|path''|electron|better-sqlite3)|require\('
Get-ChildItem -Path src/main/routing -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern "from '\.\./(services|db|adapters)/"
Select-String -Path src/shared/routingView.ts -Pattern "from '(?!\./routing')"
Select-String -Path src/shared/routingView.ts, src/renderer/src/stores/routing.ts -Pattern '(?<!Date|JSON)\.(safeParse|parse)\('
node scripts/verify-routing-ranker.mjs
npm run grep:secrets
git diff --check
git status --short
```

All four `Select-String` lines must print nothing. The last one proves C13: it matches every `.parse(` and `.safeParse(` call except `Date.parse(` and `plainRoutingInput`'s `JSON.parse(` (the .NET lookbehind excludes both). The runtime evidence for this task is RS1 and RS16: real `structuredClone` over real Vue reactive state, with a negative control. The real bridge is exercised by Task 3-4's built-app drive.
