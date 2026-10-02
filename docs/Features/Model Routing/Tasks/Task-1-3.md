# Task 1-3 — Payloads, the public entry point and the golden run

**Status:** Complete 2026-10-02 (`bd075ba`).\
**Depends on:** Task 1-2 passes (`rankCandidates` and the explanation records exist and match the fixture).  
**Paired specification:** [ImplementationSpec-1-3](../ImplementationSpecs/ImplementationSpec-1-3.md)

## Source Of Truth

[Feature roadmap](../roadmap.md) (MR-D4, MR-D5, MR-D10, MR-D11, MR-D12; gates MR-G1, MR-G4, MR-G5, MR-G8), [Phase 1 overview](Phase-1-Overview.md) (K2, K3, K7, K12, C8, C9 and the golden expectations), the paired specification, [Phase-0-Findings.md](../Phase-0-Findings.md) (`:nitro` with `data_collection: "deny"`; `order` takes tags) and the council's privacy and payload action items (§5 of the [council findings](../CouncilBrief-MR-1.0-RankerPolicy-Findings.md)).

## Initial Starting Point

Tasks 1-1 and 1-2 have landed the contracts, registry, endpoint and pricing cores, `eligibilityCore.ts` and `rankerCore.ts`, with the fixture at `src/main/routing/__fixtures__/`. `scripts/verify-routing-body.mjs:20` is the precedent for bundling TypeScript with esbuild into the git-ignored `_verify/` and deleting the bundle afterwards. The pre-existing worktree entries listed in the overview are still present and untouched.

## Goal

Turn the ranked candidates into OpenRouter `provider` objects for all four tiers, expose one public pure entry point, `computeTiers(input: RankInput): TierResult`, whose result is plain JSON with warnings and rationale, and prove it on the real 2026-10-02 fixture with a script that runs the code rather than only compiling it (MR-G1).

## Exact Scope

- `src/main/routing/payloadCore.ts` and test: `quantizationsFor`, `buildRankedProvider`, `buildNitroSelection`.
- `src/main/routing/routingCore.ts` and test: `computeTiers`, time validation (C9), staleness (K7), account state (K3), tier selections, Nitro, warnings, rationale; the golden end-to-end tests.
- `scripts/verify-routing-ranker.mjs`: bundles the routing cores with esbuild, runs `computeTiers` on the fixture for both profiles with effort `'low'`, prints a compact table, checks the golden expectations and exits non-zero on any failure.

## Non-Goals

No network, OpenCode config, `OPENCODE_CONFIG_CONTENT`, IPC, preload, renderer, storage, migrations, settings UI, adapter or launch changes (Phases 2–4). No Nitro warning copy for the UI beyond `likelyFailsRules` (Phase 3). No change to the golden expectations to fit the code. No new dependencies; esbuild is already used by `scripts/verify-routing-body.mjs`.

## Dependencies

Task 1-2. Phase 2 consumes `computeTiers` and the shared result types as delivered here.

## Step-by-step Work

1. Implement `payloadCore.ts` with the exact key order and omission rules in the specification. `data_collection` is omitted (not set to `undefined`) under `'allow'`.
2. Implement `computeTiers`: validate times, call `rankCandidates`, build `TierSelection`s, Nitro and warnings in the specified order, and return the `TierResult` keys in contract order.
3. Write `payloadCore.test.ts` and `routingCore.test.ts`, including the golden tests for both profiles, the JSON round-trip, the forbidden-key walk and the `'allow'` variant.
4. Write `scripts/verify-routing-ranker.mjs`. It deletes its bundle in a `finally` block and sets `process.exitCode = 1` on any failed check.
5. Run the verification commands. Paste the script's output into the task report.

## Test Expectations

- **Golden, both profiles:** tier orders exactly as in the overview; `medianEligibleTps` 90.5, `budgetFloorTps` 45.25, `snapshotAgeMinutes` 15, `stale` false, `accountEligibility` `'checked'`; every tier `limitedHistory: true`, `limitedFallbacks: false`; warnings exactly the one limited-history line; spot numbers to 1e-4 relative.
- **Payloads:** Budget/Balanced/Fast providers are exactly `{ order, allow_fallbacks: false, require_parameters: true, quantizations: ['fp8'], data_collection: 'deny' }` on the fixture; no `sort` or `preferred_*` key anywhere; Nitro is `deepseek/deepseek-v4.1-flash:nitro` with `{ data_collection: 'deny' }`. Under `dataCollection: 'allow'`, no `data_collection` key exists on any tier and Nitro's provider is `null`.
- **Plain JSON (K2):** `JSON.parse(JSON.stringify(result))` is `toStrictEqual` to `result` for both golden runs and for a stale, unknown-account, empty-tier result.
- **Edge cases:** stale at 61 minutes, not at 60; `guardrailRemoved: null` gives `'unknown'` and a warning but still ranks; all tiers `null` with one warning each when nothing is eligible; two eligible candidates give `limitedFallbacks: true`; an admitted first-party `unknown` adds `'unknown'` to `quantizations` (C8); `fetchedAt` after `now` throws `RangeError` (C9).
- **Determinism (MR-G8):** shuffled endpoints and history give a strictly equal result.

## Verification Commands

Run from the repository root.

```powershell
npm run typecheck
npx vitest run src/main/routing src/shared/routing.test.ts
npm test
node scripts/verify-routing-ranker.mjs
Get-ChildItem -Path src/main/routing, src/shared/routing.ts -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern 'Date\.now\(|Math\.random\(|new Date\(\)|from ''(node:|fs''|path''|electron|better-sqlite3)|require\('
npm run grep:secrets
git diff --check
git status --short
```

`node scripts/verify-routing-ranker.mjs` must print `PASS` and exit 0; the `Select-String` line prints nothing; no `_verify/routing-ranker-*.cjs` file remains. Record actual exit codes.

## Acceptance Criteria

- `computeTiers` is exported from `routingCore.ts`, takes only `RankInput`, and returns a `TierResult` that survives a JSON round-trip unchanged.
- On the fixture, both profiles produce exactly the golden tier orders, Nitro likely and failed rules, median, floor and warnings.
- Budget, Balanced and Fast payloads carry tags in `order`, `allow_fallbacks: false`, `require_parameters: true`, a `quantizations` list and `data_collection: 'deny'` by default; none carries `sort` or `preferred_*`.
- Nitro sends `<slug>:nitro` with `data_collection: 'deny'` by default and no provider object under `'allow'`.
- The verify script runs the real code on the real fixture, prints a readable table, exits non-zero on any mismatch and cleans up its bundle.
- `npm test`, typecheck and `npm run grep:secrets` pass; only owned files changed; pre-existing work is untouched.

## Review Checklist

- [ ] Key order and omission in provider objects match the specification; nothing is `undefined`.
- [ ] Warnings and rationale strings are exactly the specified templates.
- [ ] The verify script's expectations equal the overview's table and are not derived from the code under test.
- [ ] `computeTiers` adds no logic that belongs in Task 1-2; ranking disagreements are fixed in `rankerCore.ts` with a test.
- [ ] Every exclusion and tier choice in the golden output is explained by a recorded rule (roadmap Phase 1 exit).
- [ ] Changes are limited to owned files; pre-existing work is preserved and not committed.
