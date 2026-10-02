# Task 1-1 — Contracts, registry, endpoint normalisation and pricing

**Status:** Not started.  
**Depends on:** None.  
**Paired specification:** [ImplementationSpec-1-1](../ImplementationSpecs/ImplementationSpec-1-1.md)

## Source Of Truth

[Feature roadmap](../roadmap.md) (MR-D5, MR-D7, MR-D9, MR-D13; gates MR-G1, MR-G4, MR-G5, MR-G8), [Phase 1 overview](Phase-1-Overview.md) (K1, K2, K4, K8, K11, C4–C7, C10), the paired specification, [Phase-0-Findings.md](../Phase-0-Findings.md) (finding 4 on overrides) and repository CLAUDE.md. Where [Plan_1](../Plan_1.md) differs, the roadmap wins.

## Initial Starting Point

Branch `feature/model-routing` at `40b37bb`, verified 2026-10-02. No `src/main/routing/` folder and no `src/shared/routing.ts` exist. The golden fixture is tracked at `docs/Features/Model Routing/fixtures/endpoints-deepseek-v4.1-flash-2026-10-02.json` and linked only from `roadmap.md:134` and `:158`. Shared contracts follow `src/shared/team.ts` (Zod 4.4.3, `z.strictObject`, `z.iso.datetime()`); pure logic follows the `*Core.ts` convention. The worktree has pre-existing changes listed in the overview.

## Goal

Define every Phase 1 contract once, ship the DeepSeek V4.1 Flash registry entry with default settings and profiles, turn a raw `/endpoints` response into validated rows and tag-keyed observations, and resolve time-of-day pricing and blended cost exactly as documented.

## Exact Scope

- `src/shared/routing.ts` and `src/shared/routing.test.ts`: types, Zod schemas, `DEFAULT_ROUTING_SETTINGS`, `ROUTING_PROFILES`, and the result types other tasks fill.
- `src/main/routing/model-registry.json`: version 1, DeepSeek V4.1 Flash only.
- `src/main/routing/registryCore.ts` and test: registry parsing, model lookup, verification-record activity.
- `src/main/routing/endpointsCore.ts` and test: response parsing, quantization normalisation, tag collapse (K8), observation extraction.
- `src/main/routing/pricingCore.ts` and test: override resolution (K11), row-price collapse, blended cost.
- `git mv` of the fixture to `src/main/routing/__fixtures__/endpoints-deepseek-v4.1-flash-2026-10-02.json`, and the two link targets in `docs/Features/Model Routing/roadmap.md`.

## Non-Goals

No eligibility, scoring, payloads or `computeTiers` (Tasks 1-2, 1-3). No network, IPC, preload, renderer, storage, migrations, settings UI, adapter or launch changes. No edits to Plan_1, Phase-0-Findings or the council documents; the roadmap changes only by the two fixture links. No new dependencies. Do not revert, stage or commit the pre-existing modified and untracked files.

## Dependencies

None. Tasks 1-2 and 1-3 consume these exports; a later correction to them is made here, with a test, and recorded in that task's report.

## Step-by-step Work

1. Re-run `git status --short` and record the pre-existing entries before touching anything.
2. Write `src/shared/routing.ts` exactly as the specification's normative block. Import only `zod`; no Node modules (the file is in the web tsconfig too).
3. Write `model-registry.json` with the specified content, and `registryCore.ts` with `parseModelRegistry`, `bundledModelRegistry`, `findModel` and `activeVerification`.
4. Write `endpointsCore.ts`: `parseEndpointsResponse` (per-row validation, rejected rows reported), `normalizeQuantization`, `collapseEndpoints` and `extractObservations`. Every output is sorted by tag so input order cannot change it.
5. Write `pricingCore.ts`: `overrideApplies`, `resolvePricing`, `collapsePricing`, `blendedCost`. Parse times with `Date.parse`; never read the clock.
6. `git mv` the fixture into `src/main/routing/__fixtures__/`. Update the two link targets in `roadmap.md` to `../../../src/main/routing/__fixtures__/endpoints-deepseek-v4.1-flash-2026-10-02.json` (at `:134` also update the visible path text). Check `git diff --stat` shows only those two lines changed in the roadmap.
7. Write the tests in the specification's tables, then run the verification commands.

## Test Expectations

- **Schemas:** every fixture row parses; unknown extra fields are tolerated (stripped); a row without `tag` fails; the settings defaults and both profiles parse; token shares that do not sum to 1 are rejected; strict records (observation, verification, registry entry, settings) reject unknown keys.
- **Registry:** the bundled file parses; the DeepSeek entry has native `fp8`, first party `DeepSeek`, `verified: []`, `minContext` 262144; a key that differs from its entry's `slug` is rejected; `activeVerification` honours exact model, exact tag, `verifiedAt` inclusive and `expiresAt` exclusive.
- **Endpoints:** the fixture parses to 33 rows with no rejections; one malformed row is rejected by index without dropping the others; `extractObservations` returns 32 observations at `fetchedAt`; `baseten/fp8` collapses to `rows: 2`, tps 62, latency 305 ms, `uptime5m` 99.2; mixed quantization, non-zero status, null uptime and parameter intersection follow K8 and C7; shuffled rows give strictly equal output.
- **Pricing:** every synthetic override case in the specification; DeepSeek's real schedule (Friday 02:00 UTC → 0.30 / 1.20; Friday 04:30 → 0.15 / 0.60; Saturday any time → 0.15 / 0.60; Friday 09:20 → 0.30 / 1.20); blended cost for `deepinfra/fp8` (interactive, cache credit) 0.0165144 and `baidu/fp8` (no credit) 0.309590, to 1e-4 relative.

## Verification Commands

Run from the repository root after creating the task's files.

```powershell
npm run typecheck
npx vitest run src/main/routing src/shared/routing.test.ts
npm test
Get-ChildItem -Path src/main/routing, src/shared/routing.ts -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern 'Date\.now\(|Math\.random\(|new Date\(\)|from ''(node:|fs''|path''|electron|better-sqlite3)|require\('
npm run grep:secrets
git diff --check
git status --short
```

The `Select-String` line must print nothing (MR-G8; it also matches comments). `git status --short` must show the rename (`R`), the new files, ` M docs/Features/Model Routing/roadmap.md`, and the pre-existing entries unchanged. Record actual exit codes.

## Acceptance Criteria

- `src/shared/routing.ts` exports every name in the specification's normative block, with no Node imports, and both typecheck passes succeed.
- The bundled registry parses and contains only DeepSeek V4.1 Flash with the specified values.
- The fixture parses with zero rejected rows and yields 32 tag-keyed observations; `baseten/fp8` collapses as specified.
- Every override case and the DeepSeek schedule resolve to the expected prices; blended costs match to 1e-4 relative.
- No routing file outside tests reads the clock, randomness or the file system.
- The fixture lives only at its new path, the roadmap's two links resolve to it, and no other roadmap line changed.
- `npm test` and `npm run grep:secrets` pass; the pre-existing worktree entries are untouched.

## Review Checklist

- [ ] Contracts match the specification; any naming change is recorded for Tasks 1-2 and 1-3.
- [ ] Prices are converted from per-token strings to $/M once, in `resolvePricing`, and nowhere else.
- [ ] Collapse and observation output are sorted by tag and independent of row order.
- [ ] Override boundaries (start inclusive, end exclusive, wrap, strict `min_prompt_tokens`) each have a test.
- [ ] The fixture move is a rename in `git status`, not a delete plus add of different content.
- [ ] Changes are limited to owned files; pre-existing work is preserved and not committed.
