# Task 2-3 — RoutingService, observer and the live check

**Status:** Complete 2026-10-02 (`a2f7226`; live check passed 2026-10-02, spend $0.0028).\
**Depends on:** Tasks 2-1 and 2-2 pass (transport, parsers, store and settings exist and are tested).\
**Paired specification:** [ImplementationSpec-2-3](../ImplementationSpecs/ImplementationSpec-2-3.md)

## Source Of Truth

[Feature roadmap](../roadmap.md) (MR-D8 to MR-D12; gates MR-G1, MR-G4, MR-G7, MR-G8), user decisions MR-D18, MR-D19 and MR-D20 as recorded in the [Phase 2 overview](Phase-2-Overview.md) (with K1, K3, K4, K7, K8, K10 and C6, C11, C15–C21), the paired specification, Foundation roadmap D33, D58 and D60, [Phase-0-Findings.md](../Phase-0-Findings.md), and repository CLAUDE.md.

## Initial Starting Point

Branch `feature/model-routing`; Tasks 2-1 and 2-2 landed on top of `a9842a5`. Facts verified 2026-10-02 at `a9842a5`:

- `computeTiers` (`src/main/routing/routingCore.ts:70`) trusts `settings` and `profile` (:65–68) and throws `RangeError` on bad or inverted times (:38, :76). `rankCandidates` merges stored history with the snapshot's own observations (`rankerCore.ts:125`) and credits cache only for `verified === true` (:132).
- `vault.decryptForLaunch` (`vault.ts:244`) neither checks `unavailableSince` nor caches; it marks the row unavailable on failure (:256, :266). `vault.ts` imports `safeStorage` (:1), so the service imports only its type and tests use a fake.
- `StorageService` cannot load under vitest (`vitest.config.ts:3`); `teamIpc.test.ts` imports only `type StorageService`.
- Timer precedents: one `setInterval` per service (`fleetRegistry.ts:233`), `.unref()` on a service timer (`teamRuntime.ts:82`).
- Live-harness precedent: `scripts/verify-routing-live.mjs:6–28` (temp evidence directory, `Local State` copy at :18, esbuild bundle at :20, `ELECTRON_RUN_AS_NODE` removed at :21, windowless Electron with `--user-data-dir` at :23) and `scripts/verify-routing-live.ts:19–34` (`app.setPath('userData', …)`, `StorageService` on a throwaway database, `copyFixtureCredential` from `scripts/team-fixture-credential.ts:9`, `CredentialVault`).
- From Tasks 2-1 and 2-2 (check their reports for any recorded deviation): `routingClient` (`fetchRoutingEndpoints`, `sendRoutingPreflight`, `sendRoutingProbeCall`), `preflightCore.rowsPerTag`, `cacheProbeCore` (`planCacheProbe`, `evaluateProbe`, `probeCallSpendUsd`), `routingCredentialCore`, `RoutingStore`, and the four `storage.ts` routing-settings methods.
- The worktree has the pre-existing changes listed in the overview.

## Goal

Assemble the Phase 2 behaviour in main: a `RoutingService` that owns every decrypt, request, store write and `computeTiers` call for routing, with a fixed progress-event stream; a `RoutingObserver` that runs the free endpoint observation every 30 minutes for the designated credential; and a live check that proves both against OpenRouter for at most 3 cents.

## Exact Scope

- `src/shared/routing.ts`: append the "Phase 2 — service contract" block (error codes, request schemas, model list, `tierResultSchema`, refresh result, progress events, observer outcomes, status). `src/shared/routing.test.ts`: append table S4.
- `src/main/services/routingService.ts` and test: `RoutingError`, `RoutingService` (`models`, `tiers`, `refresh`, `observe`, `status`, settings and observation get/set, `onProgress`, `dispose`).
- `src/main/services/routingObserver.ts` and test: `RoutingObserver` (`start`, `stop`, `tick`, `status`).
- `scripts/verify-routing-phase2-live.mjs` and `scripts/verify-routing-phase2-live.ts`.

## Non-Goals

No IPC, preload or `index.ts` wiring (Task 2-4); nothing constructs the service in the app yet. No renderer, launch, OpenCode config, adapter or Team changes (Phases 3–4). No migration or schema change. No edits to Task 2-1 or 2-2 files except a recorded, tested correction. No edit to an existing export of `src/shared/routing.ts` or `src/main/routing/*`, or to the golden fixture. No p90, EWMA or diversity work (Phase 5); MR-D16 and MR-D17 untouched. No new dependencies. Live spend only in the live script, at most 3 cents, run once. Do not touch, stage or revert the pre-existing modified and untracked files.

## Dependencies

Tasks 2-1 and 2-2. Task 2-4 consumes `RoutingService`, `RoutingObserver`, `RoutingError` and the service-contract schemas.

## Step-by-step Work

1. Re-run `git status --short` and record the pre-existing entries. Read the Task 2-1 and 2-2 reports for deviations.
2. Append the service-contract block to `src/shared/routing.ts`; write S4, including the compile-time mutual-assignability check between `tierResultSchema` and `TierResult`.
3. Write `routingService.ts`: input parsing, registry check, single-flight slots, the request-counting fetch wrapper, the dispose signal, credential resolution (the only `decryptForLaunch` call), then `refresh`, `tiers`, `observe`, status and settings, each following the specification's numbered steps.
4. Write `routingObserver.ts` with an injectable timer pair; arm the next tick at each tick's start.
5. Write the tests in tables V and O against the specified harness (a real `RoutingStore` in a temp directory, stub fetch, fake vault, fixed clock).
6. Run the unit verification commands until green.
7. Write the live script pair. Read both files in full before running them. Run `node scripts/verify-routing-phase2-live.mjs` **once**; it spends at most 3 cents. Paste its full output.
8. Confirm `_verify/` holds no `routing-phase2-live-*.cjs`, and the evidence directory holds `report.json`, `probe.log` and `routing/` but no `profile` or `routing-live.db*`. Then run `npm run grep:secrets`.

## Test Expectations

- **Refresh over stubs** (V1–V3) reproduces the Phase 1 golden interactive tiers from a fetched snapshot, parsed preflights and probed cache: 45 requests, 1 decrypt, estimate $0.0493873956, spend $0.021, and the specified store files.
- **Events** follow the fixed order, all pass the schema, and the estimate precedes every probe request.
- **Probe controls:** tag limit, estimate cap, actual-spend stop, and abort on `auth-failed` behave as V4–V8 specify.
- **Refusals** happen before any decrypt and emit nothing; the envelope check refuses after the one decrypt without sending; vault and GET failures map to fixed codes.
- **Single flight** across refresh and observe; `tiers` never reads a credential, decrypts or sends.
- **Observer** dormant without reading the credential; fresh snapshots skipped at the 25-minute boundary; one decrypt and one GET when due; never rejects. Timer armed at 2 minutes, re-armed for 30 minutes at each tick's start, `unref`ed, cleared by `stop`.
- **Key discipline:** the fake key appears only in `authorization` headers, never in a URL, event, result, error, log call, file, status or reachable service property.

## Verification Commands

Run from the repository root after creating the task's files.

```powershell
npm run typecheck
npx vitest run src/main/services/routingService.test.ts src/main/services/routingObserver.test.ts src/shared/routing.test.ts
npm test
Get-ChildItem -Path src/main/routing, src/shared/routing.ts -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern 'Date\.now\(|Math\.random\(|new Date\(\)|from ''(node:|fs''|path''|electron|better-sqlite3)|require\('
Get-ChildItem -Path src/main/routing -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern "from '\.\./(services|db|adapters)/"
node scripts/verify-routing-ranker.mjs
node scripts/verify-routing-phase2-live.mjs
npm run grep:secrets
git diff --check
git status --short
```

Both `Select-String` lines must print nothing. The live script spends real credit: run it once, only after the unit tests pass, and record its estimate line (printed before the probe), its spend line, its checks and its exit code. `git status --short` must show ` M src/shared/routing.ts`, ` M src/shared/routing.test.ts`, the new files, and the pre-existing entries unchanged. Record actual exit codes.

## Acceptance Criteria

- The shared block exports every name in the specification; no existing export changed; both typechecks pass, including S4-3.
- V1–V29 and O1–O8 pass with the stated values.
- `routingService.ts` is the only caller of `vault.decryptForLaunch` added in this phase, and imports `storage.ts` and `vault.ts` as types only.
- The live script prints its estimate before any probe request, reports actual spend, passes L1–L10, spends at most $0.03, writes only to `%TEMP%`, and leaves no decryptable copy or bundle behind.
- `npm test` and `npm run grep:secrets` pass; both greps print nothing; the ranker script still prints `PASS (30 checks)`; the pre-existing worktree entries are untouched.

## Review Checklist

- [ ] Every refusal that does not need the envelope precedes the decrypt; there is exactly one decrypt per refresh or tick (MR-D18).
- [ ] The key is a method-local `const`; nothing stores, logs, emits, returns or throws it.
- [ ] The `probe-plan` event is emitted before the first probe request, and no tag starts once spend reaches the cap (MR-G7).
- [ ] A dormant tick reads only the observation setting (MR-D19); the observer never preflights or probes.
- [ ] `computeTiers` gets validated settings and profile, and its `RangeError` becomes `INVALID_TIME`.
- [ ] Progress listeners cannot break a refresh; every refresh that reaches the network ends with exactly one terminal event.
- [ ] Changes are limited to owned files; pre-existing work is preserved and not committed.
