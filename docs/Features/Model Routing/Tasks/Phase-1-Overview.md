# Phase 1 — Pure ranker overview

Created 2026-10-02. **Status: Not started.** Kickoff decisions K1–K12 are resolved (coordinator, 2026-10-02). Clarifications C1–C10 were made while drafting the specifications; the coordinator reviewed and accepted them on 2026-10-02.

## Phase contract

Build a pure TypeScript ranker. Its input is the observation history, the latest endpoints snapshot, the model registry entry, account eligibility, cache verification, a workload profile, the reasoning effort, settings and the current time. Its output is a plain-JSON value: four tier results (Budget, Balanced, Fast, Nitro) and an explanation of every candidate, including each exclusion and its reason.

Nothing is wired into the app. No network, IPC, UI, storage, migrations or launch changes; those are Phases 2–4. The [feature roadmap](../roadmap.md) is authoritative for decisions MR-D1 to MR-D17 and gates MR-G1 to MR-G8; where [Plan_1](../Plan_1.md) differs, the roadmap wins. Measured evidence is in [Phase-0-Findings.md](../Phase-0-Findings.md); the council's action items are §5 of the [council findings](../CouncilBrief-MR-1.0-RankerPolicy-Findings.md).

**Exit:** the roadmap's Phase 1 exit (MR-G1, MR-G4 and MR-G8 pass; on the 2026-10-02 fixture every exclusion and tier choice is explained by a recorded rule), plus MR-G5 through K2.

## Grounding and preserved state

Verified 2026-10-02 on branch `feature/model-routing` at `40b37bb` (coordinator). Line numbers drift; recheck at execution.

| Location | Fact |
|---|---|
| `vitest.config.ts` | `include: ['src/**/*.test.ts']`, environment `node`, `testTimeout: 20_000`. No globals: tests import `{ describe, it, expect }` from `'vitest'`. Tests must not import `storage.ts` or `better-sqlite3` (Electron ABI). |
| `src/main/services/codeIndexCore.test.ts:64` | Fixture convention: `src/main/services/__fixtures__/`, read with `readFileSync(join(__dirname, '__fixtures__/<file>'), 'utf8')`. |
| `src/main/services/logger.ts:2` | JSON import precedent in main: `import secretPatterns from './secret-patterns.json'` (`resolveJsonModule` via `@electron-toolkit/tsconfig`). |
| `src/main/services/*Core.ts` | Pure logic lives in `*Core.ts` modules with colocated `*.test.ts` (e.g. `modelCatalogCore.ts`, `teamCore.ts`). `src/main` has `adapters/`, `db/`, `services/`, `constants.ts`, `index.ts`, `ipc.ts`; no `routing/` folder yet. |
| `src/shared/team.ts` | Shared contracts use Zod 4.4.3 (`import { z } from 'zod'`, `z.strictObject`, `z.iso.datetime()`). `src/shared/**` is in both `tsconfig.node.json` and `tsconfig.web.json`, so shared files must not import Node modules. |
| `package.json` scripts | `npm run typecheck` (node + web), `npm test` (`vitest run`), `npm run grep:secrets` (slow; also scans `_verify/`), `npm run build`. |
| `scripts/verify-routing-body.mjs:20` | Script precedent: bundle TS with `require('esbuild').build({ stdin: { contents, resolveDir: process.cwd(), loader: 'ts' }, outfile, bundle: true, platform: 'node', format: 'cjs', packages: 'external' })` into `_verify/` (git-ignored), run it under node, delete it afterwards. |
| `docs/Features/Model Routing/fixtures/endpoints-deepseek-v4.1-flash-2026-10-02.json` | Tracked golden fixture (64 KB): `_note`, `fetchedAt` (`2026-10-02T09:05:00Z`), `speedFetchedAt`, `model`, `guardrailRemoved: ['deepseek']`, `dataPolicyDenyRemoved: ['deepseek']`, `cacheVerified` (15 tags, all `true` except `baidu/fp8`), `data.endpoints` (33 raw rows). Two rows share `baseten/fp8`; `deepseek` and `alibaba` carry `pricing.overrides`. Prices are per-token decimal strings; throughput is tokens/s; latency is milliseconds. Only `roadmap.md:134` and `:158` link to it. |

Pre-existing worktree state at kickoff: ` M .mcp.json`, ` M docs/Features/Engine/chorus-engine-spec.md`, ` M electron-builder.yml`, ` M package.json` (stat-only, no content diff) and untracked `docs/troubleshooting/*`. Do not revert, stage, commit or overwrite any of them.

## Kickoff decisions (resolved 2026-10-02, coordinator)

| # | Decision |
|---|---|
| K1 | **Placement.** Contracts and Zod schemas in `src/shared/routing.ts` (Phase 2 IPC and Phase 3 renderer will import them). Pure logic in a new `src/main/routing/`: `registryCore.ts`, `endpointsCore.ts`, `pricingCore.ts`, `eligibilityCore.ts`, `rankerCore.ts`, `payloadCore.ts`, `routingCore.ts`, plus `model-registry.json`, each with a colocated test. The fixture moves by `git mv` to `src/main/routing/__fixtures__/endpoints-deepseek-v4.1-flash-2026-10-02.json`; the two roadmap links become `../../../src/main/routing/__fixtures__/endpoints-deepseek-v4.1-flash-2026-10-02.json`. |
| K2 | **Plain JSON output.** ISO strings for times; no `Date`, `Map`, `Set`, class instances or `undefined`-valued keys. A test asserts `JSON.parse(JSON.stringify(result))` strictly equals `result` (MR-G5). |
| K3 | **Unknown account eligibility.** When the preflight failed to parse (`guardrailRemoved: null`), rank anyway, set `accountEligibility: 'unknown'` and warn; never claim the set was checked (MR-D12). Justified because a removed `order` entry was measured to fall through to the next (Phase 0). |
| K4 | **Profiles** (MR-D6, MR-D9; measured 2026-10-02 from local OpenCode history). Interactive: `expectedOutputTokens` 300, token shares fresh 0.057 / cached 0.932 / output 0.011, `typicalPromptTokens` 113651, `minMaxCompletion` 65536. Helper: 460, 0.038 / 0.957 / 0.005, 178058, 64000. `typicalPromptTokens` exists to evaluate `min_prompt_tokens` overrides. Each profile records its source. |
| K5 | **Capabilities.** Required parameters `tools`, `tool_choice`, `max_tokens`, plus `reasoning` when an effort is set (non-null). Context ≥ registry `minContext` (262144). Forced tool choice is not required, so `supports_tool_choice` is not checked. |
| K6 | **Hysteresis window = smoothing window:** the ≤ 6 most recent observations for the tag (by `observedAt`, at or before `now`, including the latest snapshot's). If any has `uptime1d` < 99.5, the candidate needs ≥ 99.6 now. 5-minute uptime < 95, `status` ≠ 0, missing uptime and guardrail removal exclude immediately. |
| K7 | **Smoothing.** `tpsP50` and `latencyP50` are medians of the positive values in the window (latency ms → s). Fewer than 3 → `limitedHistory: true`, still fully gated. No valid speed value → excluded `no speed data`. p90 is carried for display only, never scored. Observations older than 7 days are ignored. Snapshot age > 60 min → `stale: true` plus a warning; the ranker still computes (launch enforcement is Phase 4). |
| K8 | **Tag collapse** (MR-D5). Rows sharing a tag become one candidate: minimum `uptime1d` and `uptime5m`; any non-zero status → that status; minimum tps; maximum latency; maximum of each price; minimum context and `max_completion`; intersection of `supported_parameters`; more than one distinct quantization → treated as undeclared. `rows` is recorded. Collapse also applies per observation, so history is keyed by tag. |
| K9 | **Deterministic tie-break** (replaces Plan_1 §13's non-transitive comparator). Sort by score descending. Repeatedly take the highest remaining score `s`; the cluster is every remaining candidate with score ≥ `s − ln(1.01)`; order it by higher `uptime1d`, lower `latencyP50S`, lower blended cost, then tag ascending (code-unit compare); append it; continue. Take the first `1 + fallbackCount` (= 3). |
| K10 | **Budget floor** uses smoothed raw p50 tps: `max(30, 0.5 × median of the eligible set's tpsP50)`; the median of an even count is the mean of the middle two. Budget only. |
| K11 | **Cost** (MR-D9, MR-D13). Resolve pricing overrides at `now` with `typicalPromptTokens`: HHMM UTC, start inclusive, end exclusive, end ≤ start wraps midnight, `utc_days` scopes the window (or, without a window, whole days), `min_prompt_tokens` applies when prompt tokens strictly exceed it, later applicable entries win per key, absent keys inherit; keys `prompt`, `completion`, `input_cache_read`, `input_cache_write`. Blended $/M = fresh × prompt + cached × (`cacheVerified[tag] === true` ? cache-read, falling back to prompt : prompt) + output × completion. Prices are per-token strings × 1e6. |
| K12 | **Payloads** (MR-D4, MR-D5, MR-D11). Budget/Balanced/Fast: `{ model: slug, provider: { order, allow_fallbacks: false, require_parameters: true, quantizations, data_collection: 'deny' } }`; `data_collection` omitted under `'allow'`; never `sort` or `preferred_*`. Nitro: `{ model: slug + ':nitro', provider: { data_collection: 'deny' } }`, provider `null` under `'allow'`. Nitro "likely" = the highest smoothed `tpsP50` candidate that passes guardrails and capability filters only, tag-ascending tie-break; `likelyFailsRules` lists the hard gates it fails. A tier with no eligible candidate is `null` with a warning; one or two candidates → `limitedFallbacks: true`. |

## Clarifications made while drafting (accepted 2026-10-02)

These fill gaps the K-rules leave; each is stated normatively in the named specification.

| # | Clarification | Spec |
|---|---|---|
| C1 | Percentages in reason strings are **truncated**, not rounded, so a failing value never prints as meeting its threshold (`inference-net` 99.4951 prints `99.49%`, not `99.50%`). Alibaba's 5-minute reason therefore reads `92.3%`. | 1-2 |
| C2 | "Missing uptime" means missing 1-day uptime (`no uptime data`). A missing 5-minute uptime is no evidence of an outage and does not exclude (Plan_1 §13). | 1-2 |
| C3 | With `dataCollection: 'deny'`, tags in `account.dataPolicyRemoved` are excluded (`removed by data policy`) and are not eligible as Nitro "likely". | 1-2 |
| C4 | `utc_days` is tested against the UTC weekday of `now`, also inside a window that wrapped past midnight. Day names compare case-insensitively; an unrecognised name never matches. | 1-1 |
| C5 | A candidate whose blended cost is not finite or is ≤ 0 is excluded (`no usable price`), so every score is finite and survives JSON. | 1-1, 1-2 |
| C6 | An unrecognised or null `quantization` string normalises to `unknown`. Mixed-quantization tags take the undeclared path with the reason `quantization differs across rows sharing this tag`. | 1-1, 1-2 |
| C7 | In a collapse, a null uptime or speed value in any row makes the tag's value null (conservative). Duplicate observations for one tag and `observedAt` collapse the same way. A null `max_completion_tokens` is ignored (Plan_1 §6.4). | 1-1, 1-2 |
| C8 | Payload `quantizations` are the declared row values OpenRouter filters on, not the effective values. An admitted first-party `unknown` therefore sends `unknown`, never `fp8`. | 1-3 |
| C9 | `snapshot.fetchedAt` later than `now` is a programming error: `computeTiers` throws `RangeError`. | 1-3 |
| C10 | Additive result fields beyond the kickoff shapes: `CandidateExplanation.rowQuantizations`, `effectiveTps`, price fields inside `cost` (`cost` is `null` when unusable), and `TierResult.medianEligibleTps` / `budgetFloorTps`, so the Budget-floor exclusion can be explained. | 1-1 |

## Sequence and file ownership

Execute 1-1 → 1-2 → 1-3. Ownership is disjoint. A downstream task that needs an upstream contract change records it in its report and makes it in the upstream file with a test; it does not work around it.

| Task | Deliverable | Depends on | Files owned |
|---|---|---|---|
| [1-1](Task-1-1.md) / [spec](../ImplementationSpecs/ImplementationSpec-1-1.md) | Contracts, registry, endpoint normalisation, pricing | None | `src/shared/routing.ts`, `src/shared/routing.test.ts`; `src/main/routing/model-registry.json`, `registryCore.ts`, `endpointsCore.ts`, `pricingCore.ts` and their tests; the fixture move; the two link targets in `roadmap.md` |
| [1-2](Task-1-2.md) / [spec](../ImplementationSpecs/ImplementationSpec-1-2.md) | Eligibility, smoothing and ranking | 1-1 | `src/main/routing/eligibilityCore.ts`, `rankerCore.ts` and their tests |
| [1-3](Task-1-3.md) / [spec](../ImplementationSpecs/ImplementationSpec-1-3.md) | Payloads, `computeTiers`, golden run | 1-2 | `src/main/routing/payloadCore.ts`, `routingCore.ts` and their tests; `scripts/verify-routing-ranker.mjs` |

No new dependencies. Each task commits only its own files (and, for 1-1, the rename and roadmap link change).

## Gates

| Gate | In Phase 1 |
|---|---|
| MR-G1 | Every task: `npm run typecheck` and `npm test` pass. Task 1-3 adds the real check: `node scripts/verify-routing-ranker.mjs` runs `computeTiers` on the fixture and exits non-zero on any golden mismatch. |
| MR-G4 | The phase handles no keys. `npm run grep:secrets` still runs and is clean. |
| MR-G5 | `TierResult` round-trips through JSON unchanged (K2). Zod lives in shared schemas used by main only. |
| MR-G8 | Purity and determinism. No `Date.now()`, `Math.random()`, argument-less `new Date()` or I/O in non-test routing files; `now` is an input. Shuffling endpoints and history yields a strictly equal result. Golden fixtures come from the 2026-10-02 data. |

Not applicable here: MR-G2 (no OpenCode config change), MR-G3 (no OpenCode launch), MR-G6 (no migration), MR-G7 (no live probes).

## Golden expectations

Computed independently by the coordinator at kickoff and re-derived independently while drafting; both agree. Input: the fixture; history = the one observation extracted from the snapshot at `fetchedAt`; `now = 2026-10-02T09:20:00Z` (a Friday); effort `'low'`; account `{ guardrailRemoved: ['deepseek'], dataPolicyRemoved: ['deepseek'], checkedAt: '2026-10-02T09:15:39Z' }`; cache from `fixture.cacheVerified`; default settings.

| | Interactive | Helper |
|---|---|---|
| Candidates / eligible / excluded | 32 / 14 / 18 | 32 / 14 / 18 |
| Median eligible tpsP50; Budget floor | 90.5; 45.25 (`morph/fp8` 17 and `baseten/fast` 31 below) | same |
| Budget | deepinfra/fp8 → streamlake/fp8 → gmicloud/fp8 | streamlake/fp8 → deepinfra/fp8 → gmicloud/fp8 |
| Balanced | deepinfra/fp8 → streamlake/fp8 → makora/fp8 | streamlake/fp8 → venice/fp8 → gmicloud/fp8 |
| Fast | venice/fp8 → baidu/fp8 → parasail/fp8 | venice/fp8 → baidu/fp8 → parasail/fp8 |
| Nitro likely | together, 223 tps, fails `quantization not declared` | same |

Every candidate has `limitedHistory: true` (one observation). The specifications carry the per-candidate numbers. A mismatch means re-checking the implementation against the K-rules first; the expectations are never edited to match the code.

## Risks

- **Speed data is noisy.** The 30-minute windows moved Morph from 57 to 17 tps in a day. Golden numbers are a regression snapshot of 2026-10-02, not truth about providers.
- **Calibration assumptions.** `N` (300 / 460) and the token shares are measured from one machine's history and will be re-measured (MR-D6). Interactive Balanced and helper Budget/Balanced contain sub-1% ties, so small calibration changes reorder them; that is expected.
- **Unversioned guardrail message.** Phase 2's preflight parses an unversioned error message. K3 keeps a parse failure visible (`'unknown'`) instead of trusting it.
- **Pricing rules rest on documentation.** HHMM and override semantics were not observed live (Phase 0 "Bounds not proven"). C4 is an interpretation; a wrapped window scoped to days is the case most likely to differ.
- **`pricing.discount` is ignored.** It is 0 on every fixture row. A non-zero value would make Chorus overstate cost, which is the conservative direction.
- **Cache verification age.** The ranker trusts `verified: true` regardless of `checkedAt`; refreshing results older than 14 days is Phase 2's probe policy (MR-D9).

## Handoff to Phase 2

Phase 2 must supply, in the Phase 1 shapes from `src/shared/routing.ts`:

- **Snapshots:** a keyed `/endpoints` fetch parsed with `parseEndpointsResponse`, as `{ fetchedAt, endpoints }`.
- **Observations:** `extractObservations(snapshot)` every 30 minutes, stored per tag with 7-day retention (MR-D10).
- **Account eligibility:** the guardrail and data-policy preflights as `AccountEligibility`, `null` lists on a parse failure (MR-D12).
- **Cache verification:** the capped probe's results as `CacheVerification` (MR-D9).
- **Time and settings:** `now` from the caller's clock, and persisted `RoutingSettings` validated by `routingSettingsSchema`.

Phase 2 calls `computeTiers` in main and sends the `TierResult` across IPC as-is (it is already plain JSON).

## Verification and completion

Each task runs its own commands. At phase end, from the repository root:

```powershell
npm run typecheck
npm test
node scripts/verify-routing-ranker.mjs
npm run grep:secrets
git diff --check
git status --short
```

`git status --short` must still show the pre-existing entries above, unchanged. Record actual exit codes and output; a passing subset is not a full-suite pass.
