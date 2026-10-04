# Task 4a-1 — Launch routing contracts and resolution

**Status:** Not started.\
**Depends on:** Phase 3 complete (`176a83b`, `f307b4d`, `bfa7eaf`, `4167fba`; marked complete `a57ef1b`).\
**Paired specification:** [ImplementationSpec-4a-1](../ImplementationSpecs/ImplementationSpec-4a-1.md)

## Source Of Truth

[Feature roadmap](../roadmap.md) (MR-D3, MR-D4, MR-D10, MR-D11, MR-D18–MR-D20, MR-D22; gates MR-G1, MR-G4, MR-G5, MR-G8), user decisions MR-D25–MR-D28 as recorded in the [Phase 4a overview](Phase-4a-Overview.md) (with K1–K13 and the clarifications this specification states), the paired specification, the [Phase 3 overview](Phase-3-Overview.md) and [ImplementationSpec-3-1](../ImplementationSpecs/ImplementationSpec-3-1.md) (the channel-amendment precedent), [ImplementationSpec-2-3](../ImplementationSpecs/ImplementationSpec-2-3.md) (the service's refusal order and key discipline), [Phase-0-Findings](../Phase-0-Findings.md) rows (b) and (f), and repository CLAUDE.md (Zod on every IPC boundary, in main; plain-object payloads; keys never logged or returned).

## Initial Starting Point

Branch `feature/model-routing` at `a57ef1b`, verified 2026-10-03 by opening each file.

- `src/shared/routing.ts` (LF, 591 lines) imports only `zod` (:1). `ROUTING_TIERS` (:20) already lists the four tier names; `ROUTING_ERROR_CODES` (:393–404) has ten codes, `NO_SNAPSHOT` (:397) among them; `routingModelSlugSchema` (:409); `routingEffortSchema` (:411, nullable); `credentialProfileIdSchema` (:353); the non-exported `providerPrefsSchema` (:442–448); `ROUTING_CHANNELS` (:535–546) ends with `credentials` (:544) and `progress` (:545); `RoutingApi` (:555–567) ends with `credentials` (:565) and `onProgress` (:566). No launch or selection type exists in `src/`.
- `RoutingService.tiers` (`src/main/services/routingService.ts:341–365`) parses (:344), resolves the registry entry (:345), calls `assertLive` (:346), reads the snapshot (:347, `NO_SNAPSHOT` :348), the account file only for a non-null credential (:349–350), then ranks with `readObservations` (:354), `readCache` (:356), `readSettings` (:359) and `now` (:360). It never reads a credential row. `RoutingStoreLike` (:112–115) picks eight store methods. `MESSAGES` (:156–164); `unexpected` (:907–911) maps anything that is not a `RoutingError` to `OPERATION_FAILED`.
- `buildRankedProvider` (`src/main/routing/payloadCore.ts:41`) and `buildNitroSelection` (:57) build every `provider` object; `computeTiers` (`routingCore.ts:70`) computes `stale = ageMs > snapshotMaxAgeMinutes × 60,000` (:84).
- `RoutingStore` (`src/main/services/routingStore.ts`, 208 lines) writes per-model files only; `readText` (:151–165), `load` (:167–176) and `save` (:183–207) are tied to a model's `StoreFileKind`. It is constructed on `<userData>/routing` (`src/main/index.ts:1415`).
- `registerRoutingIpc` (`src/main/services/routingIpc.ts:64`) registers nine channels (:103–112); its header says "Nine request channels" (:26). Tests pin the counts: S5-1 ten channel values (`src/shared/routing.test.ts:313–318`), S4-1 ten error codes (:219–223), I1 and I4 nine (`routingIpc.test.ts:180–186`, :251–276).
- The preload `routing:` block is `src/preload/index.ts:161–172` (CRLF; `credentials` at :170).
- `scripts/verify-routing-ipc.mjs` passes 19 checks (`CHECKS` :65–71; D18 :401–407; freshness :86–110).
- The worktree has the pre-existing changes listed in the overview.

## Goal

Give main the single authority for what a routing tier means at launch (K2): a free resolution of a tier into the exact selection a session will use (MR-D26 freshness, MR-D11 data collection, MR-D4 Nitro), the pure content builder for OpenCode's per-process config (K6) and the variant declaration every unrouted `:nitro` launch with an effort needs (K13, MR-D4), the pure eligibility rules the launch handlers apply (K3, K7, K10), and the remembered last choice per model (MR-D28, K8) with one read-only channel for the renderer. The preferences file carries `"version": 1` beside `lastChoiceByModel` on disk, an accepted deviation from K8's shape for parity with the other routing files (C6).

## Exact Scope

- `src/shared/routing.ts`: amend `ROUTING_ERROR_CODES` (two codes), `ROUTING_CHANNELS` and `RoutingApi` (`launchPreferences`); append the "Phase 4a — launch routing (Task 4a-1)" block with the fixed names.
- `src/shared/routing.test.ts`: amend S4-1 and S5-1; append Table S7.
- New `src/main/routing/launchCore.ts` and `launchCore.test.ts` (Table L), including K13's `buildOpenCodeNitroVariantsContent` and `unroutedNitroVariantsContent`.
- `src/main/services/routingService.ts`: widen `RoutingStoreLike`; extract the stored-input read shared by `tiers()` and `resolveLaunch()`; add `resolveLaunch`, `launchPreferences`, `recordLaunchChoice`.
- `src/main/services/routingService.test.ts`: `storeWith` gains two delegations; append Table V4.
- `src/main/services/routingStore.ts`: generalise the private read and write helpers; add `readLaunchPreferences` and `writeLaunchPreferences`.
- `src/main/services/routingStore.test.ts`: append Table F2.
- `src/main/services/routingIpc.ts` and test: the tenth channel; amend I1 and I4; add I12.
- `src/preload/index.ts`: one line.
- `scripts/verify-routing-ipc.mjs`: check `D19 launch preferences empty`, a freshness string, the header.

## Non-Goals

- No launch wiring: no change to `src/main/ipc.ts`, `src/main/index.ts`, `sessionManager.ts`, `storage.ts`, `db/schema.ts` or `src/shared/ipc.ts` (Task 4a-3).
- No adapter change: no `opencode.ts`, `types.ts` or `verify-routing-body.mjs` edit, and no state-file write (Task 4a-2).
- No renderer change: no `LaunchDialog.vue`, `RoutingTierCards.vue`, `routingView.ts` or store (Task 4a-4).
- No `TeamLaunchDialog.vue`, Team member routing, helper re-rank, "Re-rank and relaunch" or guardrail revalidation (Phase 4b).
- No migration, no settings-table row, no `storeCore.ts` edit; the preferences file is a routing-store JSON file (K8).
- No change to any Phase 1–3 golden value; only the counts and fixtures listed under "Recorded amendments" change.
- No network in tests, no paid run, no new dependency.
- No edits to the roadmap, Plan_1 or the Phase 0–3 documents.
- Do not touch, stage or revert the pre-existing modified and untracked files.

## Dependencies

Phase 3. Tasks 4a-2 to 4a-5 consume `RoutingLaunchSelection`, `buildOpenCodeRoutingContent`, `unroutedNitroVariantsContent` (K13), `resolveLaunchSelection`, the planners, `RoutingService.resolveLaunch` / `launchPreferences` / `recordLaunchChoice` and the `routing:launch-preferences` channel. A correction needed downstream is made here, with a test, and recorded in that task's report.

## Step-by-step Work

1. Re-run `git status --short` and record the pre-existing entries.
2. Amend the Phase 2 blocks and append the Phase 4a block to `src/shared/routing.ts`; amend S4-1 and S5-1; write Table S7.
3. Write `launchCore.ts` and Table L. Run the purity and layering greps.
4. Generalise `RoutingStore`'s private helpers; run `routingStore.test.ts` before adding anything: Table F must pass unchanged. Add the two methods and Table F2.
5. In `routingService.ts`, extract `storedRankInputs` from `tiers()` with the identical read order, then run the whole of `routingService.test.ts` (with the `storeWith` amendment only): every existing test must pass unchanged. Add the three methods and Table V4.
6. Add the handler in `routingIpc.ts`; extend the test tables; amend I1 and I4; write I12.
7. Add the preload line after `credentials` (:170). Check `git diff --stat src/preload/index.ts` shows `1 insertion(+)` and `git ls-files --eol src/preload/index.ts` still reports `w/crlf`.
8. Update `scripts/verify-routing-ipc.mjs`.
9. Run the verification commands; `npx electron-vite build` before the drive (it refuses a stale build).

## Test Expectations

- **Contracts (Table S7):** the constants, `routingBaseModelId`, the request, selection and preferences schemas (strict, with the selection's cross-field rules), and the two new error codes.
- **Pure core (Table L):** the golden Balanced, Budget, Fast and Nitro selections exactly; the refusal codes and messages for no snapshot, stale, empty and mismatched results; the exact `OPENCODE_CONFIG_CONTENT` strings, routed and (K13) unrouted `:nitro`; the variant-effort fallback; every planner row with its exact refusal text, a K7-blocked launch never `'default'`; the gateway check; the preferences file parse and text (`"version": 1` on disk).
- **Service (Table V4):** `resolveLaunch` returns the same provider objects as `routing:tiers` for the launch's own credential, profile `interactive`, reads no credential row, decrypts nothing, sends nothing, reads the clock once; Nitro reads no store file; stale and empty tiers refuse; the preferences round-trip, skip unchanged writes and never throw.
- **Store (Table F2):** missing, corrupt, oversize and schema-invalid files read as empty with one fixed warning; writes are atomic with sorted keys.
- **IPC:** ten request channels; the new one through the full envelope; an invalid output is `OPERATION_FAILED`.
- **Phase 1–3 unchanged:** every existing test passes with only the recorded amendments; `node scripts/verify-routing-ranker.mjs` prints `PASS (30 checks)`.
- **Runtime (CDP):** in a throwaway profile `routing:launch-preferences` returns `{ lastChoiceByModel: {} }` and refuses an extra key; the drive ends `PASS (20 checks)` with `requestsSinceStart` 0.

## Verification Commands

Run from the repository root.

```powershell
npm run typecheck
npx vitest run src/shared/routing.test.ts src/main/routing/launchCore.test.ts src/main/services/routingService.test.ts src/main/services/routingStore.test.ts src/main/services/routingIpc.test.ts
npm test
Get-ChildItem -Path src/main/routing, src/shared/routing.ts -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern 'Date\.now\(|Math\.random\(|new Date\(\)|from ''(node:|fs''|path''|electron|better-sqlite3)|require\('
Get-ChildItem -Path src/main/routing -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern "from '\.\./(services|db|adapters)/"
node scripts/verify-routing-ranker.mjs
npx electron-vite build
node scripts/verify-routing-ipc.mjs
npm run grep:secrets
git diff --check
git diff --stat src/preload/index.ts
git ls-files --eol src/preload/index.ts
git status --short
```

Both `Select-String` lines must print nothing. The ranker script prints `PASS (30 checks)`. The drive's last line is `PASS (20 checks)` with exit code 0. `git diff --stat src/preload/index.ts` shows one insertion and no deletion, and `git ls-files --eol` still reports `w/crlf` (with `core.autocrlf` true, a CRLF→LF rewrite does not show in the diff). `git status --short` shows ` M` for the owned files, `??` for `src/main/routing/launchCore.ts` and its test, and the pre-existing entries unchanged; `out/` is build output and is not committed. Record actual exit codes and the vitest summary.

## Acceptance Criteria

- The amendments and the Phase 4a block match the specification and use exactly the fixed names; no other export of `src/shared/routing.ts` changed; both typechecks pass.
- S4-1 and S5-1 (amended) and S7-1 to S7-7 pass.
- L1–L18 pass; the purity and layering greps print nothing.
- F1–F12 pass unchanged; F13–F19 pass.
- Every pre-existing Table V, V3 and coordinator-decision test passes with its expected values untouched; V43–V58 pass.
- I1 and I4 (amended), I2–I3 and I5–I10 (now over ten channels), I11 and I12 pass.
- The preload has one new line and no Zod; `src/main/index.ts` and `storage.ts` are unchanged.
- `node scripts/verify-routing-ipc.mjs` passes 20 checks against a fresh build and a throwaway profile.
- `npm test` and `npm run grep:secrets` pass; the ranker script passes; the pre-existing worktree entries are untouched.

## Review Checklist

- [ ] `resolveLaunch` reads no credential row, never decrypts and never fetches; it calls `assertLive` after the registry check, as `tiers()` does; the clock is read once and is the selection's `computedAt`.
- [ ] `tiers()` reads the store in exactly its old order (snapshot, account, observations, cache, settings, clock) after the extraction, and every Phase 2/3 test passed before Table V4 was written.
- [ ] Ranked selections take `provider` and `endpoints` from `TierResult.tiers[tier]` (deep copies); Nitro takes `buildNitroSelection`'s provider and never reads a store file.
- [ ] The selection output is parsed with `routingLaunchSelectionSchema` before it leaves the service; a failure is `OPERATION_FAILED`.
- [ ] `recordLaunchChoice` can never throw, records only a registry slug and a valid choice, and does not write when nothing changed; `planRoutingLaunch` never answers `'default'` for a K7-blocked launch.
- [ ] K13: `unroutedNitroVariantsContent` declares only `variants` (no `options.provider`), only for a `:nitro` id with a valid effort on the gateway, and nothing when the profile sets its own content.
- [ ] The preferences file is atomic (temp, fsync, rename), its keys sorted, its warnings fixed text with no path or content.
- [ ] `launchCore.ts` imports only `zod`, `../../shared/routing` and sibling cores; no clock, no I/O.
- [ ] Each Phase 2/3 test change is one of the recorded amendments; no golden value moved.
- [ ] The drive launched its own built app on a free port with a throwaway profile and killed only its own child, by pid.
- [ ] Changes are limited to owned files; pre-existing work is preserved and not committed.
