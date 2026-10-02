# Implementation specification 1-2 — Eligibility, smoothing and ranking

Paired [task](../Tasks/Task-1-2.md). Decisions: [roadmap](../roadmap.md) MR-D5 to MR-D12; [overview](../Tasks/Phase-1-Overview.md) K3, K5–K10 and clarifications C1–C3, C5, C7. Contracts come from [ImplementationSpec-1-1](ImplementationSpec-1-1.md). **Not started.**

## Files and insertion points

| File | Action |
|---|---|
| `src/main/routing/eligibilityCore.ts`, `eligibilityCore.test.ts` | New. Imports `../../shared/routing`, `./endpointsCore` (types), `./registryCore` (`activeVerification`). |
| `src/main/routing/rankerCore.ts`, `rankerCore.test.ts` | New. Imports shared contracts, `endpointsCore`, `pricingCore`, `eligibilityCore`. |

No other file changes, except a recorded correction to a Task 1-1 export.

## `eligibilityCore.ts`

```ts
export const PRECISION_RANK: Record<Exclude<Quantization, 'unknown'>, number> =
  { fp32: 6, bf16: 5, fp16: 5, fp8: 4, int8: 3, fp6: 2, fp4: 1, int4: 1 }
export const BASE_REQUIRED_PARAMETERS = ['tools', 'tool_choice', 'max_tokens'] as const
export function requiredParameters(effort: string | null): string[] // base, plus 'reasoning' when effort !== null (K5)
export function truncatePct(value: number, decimals: number): string // (Math.floor(value * 10 ** d + 1e-9) / 10 ** d).toFixed(d)  (C1)
export function median(values: number[]): number | null // sorted copy; even count = mean of the middle two; empty = null
export function mergeHistory(history: RoutingObservation[], fromSnapshot: RoutingObservation[]): RoutingObservation[]
export function selectWindow(observations: RoutingObservation[], tag: string, now: string, settings: RoutingSettings): RoutingObservation[]
export interface SmoothedSpeed {
  observations: number
  limitedHistory: boolean
  tpsP50: number | null
  latencyP50S: number | null
  tpsP90: number | null
  latencyP90S: number | null
}
export function smoothSpeed(window: RoutingObservation[], settings: RoutingSettings): SmoothedSpeed
export type GateFamily = 'reliability' | 'account' | 'precision' | 'capability' | 'speed' | 'price'
export interface GateReason { family: GateFamily; text: string }
export interface GateContext {
  model: ModelRegistryEntry
  profile: RoutingProfile
  effort: string | null
  account: AccountEligibility
  settings: RoutingSettings
  now: string
}
export function evaluateGates(
  candidate: CollapsedEndpoint, window: RoutingObservation[], speed: SmoothedSpeed, cost: CandidateCost | null, ctx: GateContext
): { reasons: GateReason[]; effectiveQuantization: Quantization }
```

**`mergeHistory`.** Concatenate both lists. Observations with the same `tag` and the same instant (`Date.parse(observedAt)`, so `…:00Z` and `…:00.000Z` match) collapse with the K8/C7 rules (null if any is null, else minimum uptime and tps, maximum latency, smallest non-zero status) and keep the smallest `observedAt` string. Output sorted by tag ascending, then instant descending. The snapshot's own observation is therefore counted once even when Phase 2 has already stored it.

**`selectWindow` (K6, K7).** Keep observations for `tag` whose instant is `<= now` and `>= now − observationMaxAgeDays × 86 400 000 ms`; sort newest first; take the first `smoothingWindow` (6).

**`smoothSpeed` (K7).** From the window take the positive `tpsP50` values and the positive `latencyP50Ms` values separately. `tpsP50` = median of the first; `latencyP50S` = median of the second ÷ 1000. `tpsP90` and `latencyP90S` are medians of the positive p90 values the same way (display only). `observations` = the smaller of the two positive-value counts; `limitedHistory = observations < stableMinObservations` (3).

### Gates and reason strings

`evaluateGates` evaluates every rule and returns every failing reason, in this order. Current values (`uptime1d`, `uptime5m`, `status`, parameters, limits) come from the collapsed latest snapshot; speeds come from `speed`. `S` is `ctx.settings`.

| # | Family | Rule | Reason text (exact) |
|---|---|---|---|
| 1 | reliability | `uptime1d === null` | `no uptime data` |
| 2 | reliability | `uptime1d < S.minUptimePct` | `uptime ${truncatePct(u, 2)}% < ${S.minUptimePct}%` |
| 3 | reliability | else, current `uptime1d < S.readmitUptimePct` and some window observation has a non-null `uptime1d < S.minUptimePct` (K6) | `readmission needs ${S.readmitUptimePct}% (now ${truncatePct(u, 2)}%)` |
| 4 | reliability | `uptime5m !== null && uptime5m < S.outageGuard5mPct` (C2: null passes) | `currently degraded (5m uptime ${truncatePct(u5, 1)}%)` |
| 5 | reliability | `status !== 0` | `status ${status}` |
| 6 | account | `account.guardrailRemoved?.includes(tag)` | `removed by account guardrail` |
| 7 | account | `S.dataCollection === 'deny' && account.dataPolicyRemoved?.includes(tag)` (C3) | `removed by data policy` |
| 8 | precision | see below | `quantization not declared`, `quantization differs across rows sharing this tag`, or `${q} below native ${native}` |
| 9 | capability | each `p` of `requiredParameters(effort)` not in `supportedParameters`, in that order | `missing parameter: ${p}` |
| 10 | capability | `contextLength < model.minContext` | `context ${contextLength} < ${model.minContext}` |
| 11 | capability | `maxCompletion !== null && maxCompletion < profile.minMaxCompletion` | `max output ${maxCompletion} < ${profile.minMaxCompletion}` |
| 12 | speed | `speed.tpsP50 === null \|\| speed.latencyP50S === null` | `no speed data` |
| 13 | price | `cost === null` (C5) | `no usable price` |

Rules 1–3 are exclusive: at most one of them fires. Numbers in rules 10–11 print as plain integers.

**Precision (rule 8, MR-D7).** If `model.nativePrecision === null`, skip the rule; `effectiveQuantization = quantization`. Otherwise, when `quantization === 'unknown'` (including a mixed tag): it is admitted, with `effectiveQuantization = nativePrecision`, only when `S.unknownQuantPolicy === 'firstPartyAndVerified'` and either `model.firstPartyProviders` contains `providerName` or `activeVerification(model, tag, now)` is non-null. If not admitted, the reason is `quantization differs across rows sharing this tag` for a mixed tag, else `quantization not declared`, and `effectiveQuantization = 'unknown'`. A declared value with `PRECISION_RANK[q] < PRECISION_RANK[native]` fails with `${q} below native ${native}`; `effectiveQuantization = q` either way.

## `rankerCore.ts`

```ts
export function effectiveTps(n: number, latencyS: number, tpsP50: number): number // n / (latencyS + n / tpsP50)  (MR-D6)
export function tierScore(weight: number, tpsEff: number, blended: number): number // weight·ln(tpsEff) − (1 − weight)·ln(blended)
export function budgetFloor(eligibleTps: number[], settings: RoutingSettings): number | null
// null when empty; else max(budgetMinTps, budgetMedianFraction × median(eligibleTps))  (K10)
export interface OrderEntry { tag: string; score: number; uptime1d: number; latencyP50S: number; blended: number }
export function orderByScore<T extends OrderEntry>(entries: T[], tieRatio: number): T[] // K9
export interface RankedCandidates {
  candidates: CandidateExplanation[] // sorted by tag
  selections: Record<RankedTier, string[]> // ≤ 1 + fallbackCount tags each, in order
  medianEligibleTps: number | null
  budgetFloorTps: number | null
  nitroLikely: NitroSelection['likely']
  nitroFailsRules: string[]
}
export function rankCandidates(input: RankInput): RankedCandidates
```

**`orderByScore` (K9).** Copy and sort by score descending (equal scores by tag, code-unit). Then loop: `s` = score of the first remaining entry; the cluster is every remaining entry with `score >= s − Math.log(tieRatio)` (a prefix of the sorted list); sort the cluster by `uptime1d` descending, then `latencyP50S` ascending, then `blended` ascending, then tag ascending with `a < b`; append it; remove it. The cluster comparator is lexicographic over fixed keys, so it is transitive; the result does not depend on input order.

**`rankCandidates`.** With `profile = ROUTING_PROFILES[input.profile]` and `ctx` built from the input:

1. `collapsed = collapseEndpoints(input.snapshot.endpoints)`; `history = mergeHistory(input.history, extractObservations(input.snapshot))`.
2. For each collapsed candidate: `window = selectWindow(history, tag, now, settings)`; `speed = smoothSpeed(window, settings)`; `prices = collapsePricing(c.pricing.map(p => resolvePricing(p, now, profile.typicalPromptTokens)))`; `cost = blendedCost(prices, profile.tokenShares, input.cache[tag]?.verified === true)`; `gates = evaluateGates(...)`; `effectiveTps` from `profile.expectedOutputTokens` when both smoothed speeds are non-null, else `null`.
3. Eligible = candidates with no reasons. `medianEligibleTps = median(eligible tpsP50)`; `budgetFloorTps = budgetFloor(...)`.
4. For each eligible candidate: `budgetFloorExcluded = tpsP50 < budgetFloorTps` (equal passes). `scores.budget` is set only when not floor-excluded; `scores.balanced` and `scores.fast` always, with `settings.tierWeights`. Excluded candidates have `scores: {}` and `budgetFloorExcluded: false`.
5. `selections[tier] = orderByScore(eligible with scores[tier], settings.tieRatio).slice(0, 1 + settings.fallbackCount).map(tag)`.
6. **Nitro likely (K12, C3).** Pool = candidates with no `account` or `capability` reason and a non-null smoothed `tpsP50`. Pick the highest `tpsP50`, ties by tag ascending; `null` when the pool is empty. `nitroFailsRules` = its `reliability` and `precision` reason texts, in order.
7. Build each `CandidateExplanation` (shape in ImplementationSpec-1-1): `excludedBy` = reason texts; `uptime1d`/`uptime5m`/`status` current; speeds smoothed; `cost` as returned. Sort by tag.

`uptime1d` used by the tie-break is the current value, which is non-null for every eligible candidate.

## Test cases

Synthetic tests build rows with a helper `row(tag, overrides)` that starts from a valid fp8 row (uptime 99.9 / 99.9, status 0, 100 tps, 500 ms, all parameters, context 1 048 576, max completion 131 072, prices 0.0000001 / 0.0000004 / 0.00000001) and observations with `obs(tag, minutesBeforeNow, overrides)`. `now` is `2026-10-02T09:20:00Z` unless stated.

**Table G — gates (`eligibilityCore.test.ts`).**

| # | Setup | Expect |
|---|---|---|
| G1 | History has the tag at 99.49 30 min ago; snapshot 99.55 | `readmission needs 99.6% (now 99.55%)` |
| G2 | Same history; snapshot 99.60 | Eligible. |
| G3 | History: 99.49, then five newer observations at 99.9; with the snapshot's own observation the 99.49 one is 7th-newest; snapshot 99.55 | Eligible. |
| G4 | The 99.49 observation is 8 days old; snapshot 99.55 | Eligible. |
| G5 | Snapshot 99.49 | `uptime 99.49% < 99.5%` only (no readmission reason). |
| G6 | Clean history; snapshot `uptime_last_5m` 94.9 | `currently degraded (5m uptime 94.9%)` |
| G7 | Clean history; snapshot status -2 | `status -2` |
| G8 | `uptime_last_1d` null; `uptime_last_5m` null (separately) | `no uptime data`; eligible. |
| G9 | `inference-net` value 99.4951 | `uptime 99.49% < 99.5%` (truncated, C1). |
| G10 | Tag in `guardrailRemoved`; `guardrailRemoved: null` | `removed by account guardrail`; eligible. |
| G11 | Tag in `dataPolicyRemoved` under `deny`; under `allow` | `removed by data policy`; eligible. |
| G12 | `unknown`, provider not first party | `quantization not declared` |
| G13 | `unknown`, provider `DeepSeek` | Eligible, `effectiveQuantization` `fp8`. |
| G14 | `unknown`, active record for this exact tag; expired record; record for another tag | Eligible; excluded; excluded. |
| G15 | `unknown`, first party, `unknownQuantPolicy: 'strict'` | `quantization not declared` |
| G16 | Two rows `fp8` + `fp16` under one tag, not first party | `quantization differs across rows sharing this tag` |
| G17 | `fp4`; `int8`; `fp32` | `fp4 below native fp8`; `int8 below native fp8`; eligible. |
| G18 | `fp4` with `nativePrecision: null` | Eligible, `effectiveQuantization` `fp4`. |
| G19 | No `reasoning`, effort `'low'`; effort `null` | `missing parameter: reasoning`; eligible. |
| G20 | Context 131072 | `context 131072 < 262144` |
| G21 | Max completion 32768 (interactive); 64000 (helper); null | `max output 32768 < 65536`; eligible; eligible. |
| G22 | Throughput p50 0; latency null; both objects null | `no speed data` each. |
| G23 | Prompt price `-1` | `no usable price` |
| G24 | Alibaba-like row: 97.18 / 92.366 / status -2 / `unknown` | Reasons exactly `['uptime 97.18% < 99.5%', 'currently degraded (5m uptime 92.3%)', 'status -2', 'quantization not declared']`. |

**Table M — smoothing.**

| # | Setup | Expect |
|---|---|---|
| M1 | Window tps `[100, 50, 80, 0, 90, 70]`, all six latencies positive | `tpsP50` 80 (zero ignored), `observations` 5, not limited. |
| M2 | `median([62, 63, 67, 88])`; `median([])` | 65; `null`. |
| M3 | Two observations | `limitedHistory` true; a failing gate still excludes. |
| M4 | Eight observations, all within 7 days | Only the six newest are used. |
| M5 | An observation after `now`; one 7 days + 1 min old | Both ignored. |
| M6 | Latency `[1428.5]` ms | `latencyP50S` 1.4285 |
| M7 | History duplicate of the snapshot observation (same instant, `.000Z` spelling) | Counted once. |

**Table K — scoring (`rankerCore.test.ts`).**

| # | Setup | Expect |
|---|---|---|
| K-a | `effectiveTps(300, 1.4285, 63)` | 48.4621 |
| K-b | `w` 0.3: A blended 1.0, eff 50; B blended 1.1, eff 100 | B scores higher (1.31483 vs 1.17361). |
| K-c | `w` 0.3: A as above; B blended 2.0, eff 100 | A scores higher (B 0.89635). |
| K-d | Eligible tps median 90; cheapest candidate 17 tps | Floor 45; `budgetFloorExcluded` true, no `scores.budget`, has `balanced` and `fast`; absent from Budget selection. |
| K-e | Candidate exactly at the floor | Not floor-excluded. |
| K-f | A 1.000 / 99.6, B 0.992 / 99.7, C 0.984 / 99.8 (score / uptime) | `orderByScore` → B, A, C for all six permutations (Plan_1's pairwise comparator is cyclic here). |
| K-g | Equal score, uptime, latency and cost | Tag ascending. |
| K-h | Fixture input with endpoints reversed and history shuffled | `rankCandidates` strictly equal to the unshuffled run. |
| K-i | Only two eligible candidates | Selections of length 2. |

**Table F — the 2026-10-02 fixture** (history = `extractObservations(snapshot)`, `now` `2026-10-02T09:20:00Z`, effort `'low'`, account `{ guardrailRemoved: ['deepseek'], dataPolicyRemoved: ['deepseek'], checkedAt: '2026-10-02T09:15:39Z' }`, cache = every `fixture.cacheVerified` entry as `{ verified, checkedAt: '2026-10-02T09:15:39Z' }`, default settings, registry entry from `bundledModelRegistry()`).

Both profiles: 32 candidates; eligible exactly `atlas-cloud/fp8, baidu/fp8, baseten/fast, baseten/fp8, deepinfra/fp8, gmicloud/fp8, makora/fp8, morph/fp8, nextbit/fp8, novita/fp8, parasail/fp8, siliconflow/fp8, streamlake/fp8, venice/fp8`; `medianEligibleTps` 90.5; `budgetFloorTps` 45.25; `budgetFloorExcluded` only for `morph/fp8` (17) and `baseten/fast` (31); every candidate `limitedHistory: true`, `observations` 1; Nitro likely `{ tag: 'together', providerName: 'Together', tpsP50: 223 }`, `nitroFailsRules: ['quantization not declared']`.

Exclusion table (both profiles):

| Tag | `excludedBy` |
|---|---|
| alibaba | `uptime 97.18% < 99.5%`, `currently degraded (5m uptime 92.3%)`, `status -2`, `quantization not declared` |
| coreweave/fp8 | `uptime 98.34% < 99.5%` |
| decart/fp4 | `fp4 below native fp8` |
| deepseek | `uptime 99.34% < 99.5%`, `removed by account guardrail`, `removed by data policy` |
| dekallm | `uptime 99.18% < 99.5%`, `quantization not declared` |
| digitalocean, fireworks, fireworks/us, ionstream, modal, phala, together | `quantization not declared` |
| inference-net | `uptime 99.49% < 99.5%`, `quantization not declared` |
| io-net/fp8 | `uptime 98.22% < 99.5%` |
| open-inference/fp4 | `uptime 99.28% < 99.5%`, `fp4 below native fp8` |
| relace | `uptime 99.30% < 99.5%`, `quantization not declared` |
| sail-research/fp4 | `fp4 below native fp8` |
| wafer | `uptime 99.41% < 99.5%`, `quantization not declared` |

Selections and spot values (relative tolerance 1e-4):

| Profile | Tier | Selection | Values |
|---|---|---|---|
| interactive | budget | deepinfra/fp8, streamlake/fp8, gmicloud/fp8 | deepinfra 4.03670, streamlake 4.03282 (one cluster; uptime 99.96 beats 99.60) |
| interactive | balanced | deepinfra/fp8, streamlake/fp8, makora/fp8 | streamlake 3.99985, deepinfra 3.99215 (one cluster; uptime puts deepinfra first) |
| interactive | fast | venice/fp8, baidu/fp8, parasail/fp8 | venice 4.78673 |
| helper | budget | streamlake/fp8, deepinfra/fp8, gmicloud/fp8 | streamlake 4.36728, deepinfra 4.31882 |
| helper | balanced | streamlake/fp8, venice/fp8, gmicloud/fp8 | venice 4.23081, gmicloud 4.22583 (one cluster) |
| helper | fast | venice/fp8, baidu/fp8, parasail/fp8 | — |

Interactive `effectiveTps`: venice 119.909, deepinfra 48.4621, baidu 89.7453. Interactive `cost.blended`: deepinfra 0.0165144, streamlake 0.0168692, gmicloud 0.0215352, baidu 0.309590 (`cacheCredit` false), venice 0.0448650.

These values were derived twice, independently, from the K-rules. If the implementation disagrees, re-check it against the K-rules first and report; never edit an expectation to match.

## Invariants

- Every snapshot tag yields exactly one `CandidateExplanation`; `excludedBy` is empty if and only if the candidate has `scores.balanced` and `scores.fast`.
- All numbers in the output are finite (C5 guarantees `ln` never sees 0).
- Output is independent of the order of `snapshot.endpoints` and `history`.
- No clock, randomness, environment or I/O; `now` is the only time source (MR-G8).

## Verification

```powershell
npm run typecheck
npx vitest run src/main/routing src/shared/routing.test.ts
npm test
Get-ChildItem -Path src/main/routing, src/shared/routing.ts -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern 'Date\.now\(|Math\.random\(|new Date\(\)|from ''(node:|fs''|path''|electron|better-sqlite3)|require\('
npm run grep:secrets
git diff --check
git status --short
```

The `Select-String` line prints nothing. Runtime evidence for this task is Table F running over the real fixture; record the vitest summary and the per-profile selections from the test output.
