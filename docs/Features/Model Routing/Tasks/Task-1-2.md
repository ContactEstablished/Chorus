# Task 1-2 — Eligibility, smoothing and ranking

**Status:** Complete 2026-10-02 (`9c6bb9e`).\
**Depends on:** Task 1-1 passes (contracts, registry, endpoints and pricing exist and are tested).  
**Paired specification:** [ImplementationSpec-1-2](../ImplementationSpecs/ImplementationSpec-1-2.md)

## Source Of Truth

[Feature roadmap](../roadmap.md) (MR-D5 to MR-D12; gates MR-G1, MR-G4, MR-G8), [Phase 1 overview](Phase-1-Overview.md) (K3, K5–K10, C1–C3, C5, C7), the paired specification, the council's action items (§5 of the [council findings](../CouncilBrief-MR-1.0-RankerPolicy-Findings.md)) and [Phase-0-Findings.md](../Phase-0-Findings.md). Where [Plan_1](../Plan_1.md) §6–§8 differs, the roadmap and the K-rules win; in particular Plan_1 §13's comparator is replaced by K9.

## Initial Starting Point

Task 1-1 has landed `src/shared/routing.ts`, `registryCore.ts`, `endpointsCore.ts`, `pricingCore.ts`, the bundled registry and the fixture at `src/main/routing/__fixtures__/endpoints-deepseek-v4.1-flash-2026-10-02.json`. Re-read those exports before starting; if a contract you need is missing or wrong, correct it in the Task 1-1 file with a test and record the change. The pre-existing worktree entries listed in the overview are still present and untouched.

## Goal

Decide, for every routable tag in the latest snapshot, whether it may be ranked and why not; smooth its speed over the observation window; score the eligible ones for Budget, Balanced and Fast; select the top three per tier with a deterministic tie-break; and find Nitro's likely endpoint. Everything is recorded in `CandidateExplanation` records.

## Exact Scope

- `src/main/routing/eligibilityCore.ts` and test: precision ranks, required parameters, reason formatting, history merge, window selection, speed smoothing, hard gates with hysteresis (K6), account, quantization and capability filters, Nitro filters.
- `src/main/routing/rankerCore.ts` and test: effective throughput, tier score, Budget floor (K10), K9 ordering, `rankCandidates(input)` returning candidates, per-tier selections, the median and floor, and Nitro's likely endpoint with the rules it fails.

## Non-Goals

No payload objects, warnings, rationale text, `TierResult` or verify script (Task 1-3). No network, IPC, renderer, storage, settings UI or launch wiring. No p90 scoring, EWMA smoothing or region diversity (Phase 5). No edits outside the two owned files and their tests, except a recorded Task 1-1 contract correction. No new dependencies.

## Dependencies

Task 1-1. Task 1-3 consumes `rankCandidates` and the explanation records unchanged.

## Step-by-step Work

1. Implement `eligibilityCore.ts` helpers: `PRECISION_RANK`, `requiredParameters`, `truncatePct`, `median`, `mergeHistory`, `selectWindow`, `smoothSpeed`.
2. Implement `evaluateGates` producing reasons in the canonical order and family of the specification, with the exact reason strings. Percentages are truncated (C1).
3. Implement `rankerCore.ts`: `effectiveTps`, `tierScore`, `budgetFloor`, `orderByScore` (K9) and `rankCandidates`.
4. Write the council-item tests and the fixture tests in the specification's tables. Assert reason strings exactly.
5. Prove determinism: shuffle endpoints and history and compare results with `toStrictEqual`.
6. Run the verification commands, including the purity check.

## Test Expectations

- **Reliability (council §5):** excluded at 99.49 stays excluded at 99.55 while the low observation is inside the six-observation window, and is readmitted at 99.60; the same 99.55 is admitted once the low observation is the seventh-newest or older than 7 days; a 5-minute failure or non-zero status excludes immediately despite a clean history; missing 1-day uptime excludes, missing 5-minute uptime does not (C2).
- **Account:** guardrail removal excludes; data-policy removal excludes under `deny` only (C3); `guardrailRemoved: null` excludes nothing.
- **Quantization:** undeclared is excluded unless first party or an unexpired verification for that exact tag; `strict` excludes even first party; below-native is excluded with `fp4 below native fp8`; above-native (`fp32`) passes; `nativePrecision: null` skips the filter.
- **Capabilities:** `reasoning` is required only when effort is non-null; context and max-output limits use the registry and profile.
- **Speed:** ms → s conversion (`deepinfra/fp8` interactive `effectiveTps` 48.4621); zero, null or missing speed excludes `no speed data`; median of positive values in the window; fewer than 3 → `limitedHistory` while every gate still applies.
- **Scoring:** a Morph-like 17 tps candidate is Budget-floor excluded at a 45 tps floor but still scored for Balanced and Fast; at `w` 0.30, 10% pricier and 2× faster wins, 2× pricier and 2× faster loses.
- **Tie-break:** the specification's non-transitive triple orders identically under all six input permutations.
- **Fixture:** 32 candidates, 14 eligible, the exact 18-row exclusion table, median 90.5, floor 45.25, golden selections for both profiles, Nitro likely `together` failing `quantization not declared`.

## Verification Commands

Run from the repository root.

```powershell
npm run typecheck
npx vitest run src/main/routing src/shared/routing.test.ts
npm test
Get-ChildItem -Path src/main/routing, src/shared/routing.ts -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern 'Date\.now\(|Math\.random\(|new Date\(\)|from ''(node:|fs''|path''|electron|better-sqlite3)|require\('
npm run grep:secrets
git diff --check
git status --short
```

The `Select-String` line must print nothing (MR-G8). It also matches comments, so describe the purity rule in comments without those literal tokens. Record actual exit codes and the vitest summary.

## Acceptance Criteria

- Every council §5 reliability, quantization, scoring and smoothing item named above has a passing test with exact reason strings.
- The fixture's eligible set, exclusion table, median, floor and golden selections match for both profiles; numbers match to 1e-4 relative.
- `orderByScore` is deterministic and transitive: permutations and shuffles of input give strictly equal output.
- Every candidate in the snapshot appears exactly once in `candidates`, sorted by tag, with either a non-empty `excludedBy` or scores.
- No routing file outside tests reads the clock, randomness, environment or file system; `npm test` and `npm run grep:secrets` pass.
- Only the owned files changed (plus any recorded Task 1-1 correction); pre-existing work is untouched.

## Review Checklist

- [ ] Gates read current values from the latest snapshot, speeds from the smoothed window; nothing mixes the two.
- [ ] Hysteresis looks only inside the window (≤ 6 newest, ≤ 7 days old, not after `now`).
- [ ] Reason strings and their order match the specification; percentages are truncated, never rounded up.
- [ ] Budget floor uses smoothed raw `tpsP50`, applies to Budget only, and a value equal to the floor passes.
- [ ] Tags compare by code unit (`<`), never `localeCompare`.
- [ ] No mismatch was resolved by editing an expectation; any disagreement is reported with the K-rule it concerns.
