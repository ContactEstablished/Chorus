# Task 3-1 — Main support for the UI

**Status:** Complete 2026-10-02 (`176a83b`).\
**Depends on:** Phase 2 complete (`17c7d72`, `353cd39`, `a2f7226`, `21c65ff`; roadmap updated `5079b5d`).\
**Paired specification:** [ImplementationSpec-3-1](../ImplementationSpecs/ImplementationSpec-3-1.md)

## Source Of Truth

[Feature roadmap](../roadmap.md) (MR-D18, MR-D19; gates MR-G1, MR-G4, MR-G5, MR-G8; the Phase 2 section's "Carried to Phase 3"), user decisions MR-D21 and MR-D22 as recorded in the [Phase 3 overview](Phase-3-Overview.md) (with K1, K4, K10 and C1–C4, and the "Recorded contract amendments to Phase 2" table), the paired specification, the [Phase 2 overview](Phase-2-Overview.md) (C17, C20, C21, C23, C24), Foundation roadmap D14, D58, D60 and D214, and repository CLAUDE.md (Zod on every IPC boundary, in main; plain-object payloads; keys never logged or returned).

## Initial Starting Point

Branch `feature/model-routing` at `5079b5d`, verified 2026-10-02 by opening each file.

- `RoutingService.refresh` (`src/main/services/routingService.ts:329`) parses (:333), resolves the registry entry (:334), calls `assertLive` (:335), refuses an in-flight model with `BUSY` (:336, message at :154), then enters `withRoutingKey` (:342), whose `checkCredential` (:452) refuses before the single decrypt (:472). Nothing limits how often a finished refresh may be repeated (the Phase 2 carry-over).
- `RoutingStorageLike` (:97–105) picks six `StorageService` methods; `StorageService` already has `listProviderConfigs()` (`storage.ts:2304`) and `listCredentialProfiles()` (:2354). `src/main/index.ts:1416` passes the whole `StorageService`, so widening the `Pick` needs no edit there.
- `checkRoutingCredential(profile, provider, gateway)` (`src/main/routing/routingCredentialCore.ts:64`) is the pure pre-decrypt predicate. The gateway URL is also written out in `teamMemberProfiles.ts:11`, `teamRuntime.ts:108`, `adapters/helpers/opencode.ts:12` and `adapters/helpers/evidence.ts:31`, :36; the renderer must not become another copy.
- `ROUTING_CHANNELS` (`src/shared/routing.ts:535`) has eight request channels and `progress` (:544); `RoutingApi` (:554) ends with `observationSet` (:562) and `onProgress` (:563).
- `registerRoutingIpc` (`src/main/services/routingIpc.ts:63`) registers eight handlers (:102–110); its header says "Eight request channels" (:25). Its test asserts eight (I1, `routingIpc.test.ts:178`) and eight responses (I4, :248); S5-1 asserts nine channel values (`src/shared/routing.test.ts:312`).
- The preload `routing:` block is `src/preload/index.ts:161–171` (CRLF in the working tree).
- `routingService.test.ts` runs every harness on a fixed clock (`NOW`, :54); V14 (:782), V20 (:875) and V29 (:1141) refresh the same model twice at the same instant.
- `scripts/verify-routing-ipc.mjs` passes with 18 checks (:64–70) against a fresh build.
- The worktree has the pre-existing changes listed in the overview.

## Goal

Give the renderer the two things it cannot safely do itself: list the credentials a routing refresh would accept, decided in main by the existing pre-decrypt predicate and never by decrypting; and stop any caller from repeating a paid refresh of one model within 60 seconds (MR-D22). Record both as deliberate amendments to the Phase 2 contract.

## Exact Scope

- `src/shared/routing.ts`: add `credentials: 'routing:credentials'` to `ROUTING_CHANNELS` and `credentials(input)` to `RoutingApi`; append the "Phase 3 — UI support (Task 3-1)" block (`ROUTING_REFRESH_COOLDOWN_MS`, `ROUTING_REFRESH_PROBE_CAP_USD`, `routingCredentialSchema`, `routingCredentialListSchema` and their types).
- `src/shared/routing.test.ts`: amend S5-1 (nine → ten); append Table S6.
- `src/main/services/routingService.ts`: widen `RoutingStorageLike`; add the `refreshCooldownMs` knob, `credentials()`, the cooldown check and the end-of-refresh record.
- `src/main/services/routingService.test.ts`: the harness amendments (storage list methods, `refreshCooldownMs: 0` by default, the `productionCooldown` option); Table V3 (V30–V42).
- `src/main/services/routingIpc.ts`: the `credentials` handler, the `Pick`, the header count.
- `src/main/services/routingIpc.test.ts`: the per-channel tables, I1 and I4 amended, I11 added.
- `src/preload/index.ts`: one line in the `routing:` block.
- `scripts/verify-routing-ipc.mjs`: check `D18 credentials empty`, the preload freshness string, the header comment.

## Non-Goals

- No renderer files: no store, view model, component, view or Settings change (Tasks 3-2 to 3-4).
- No launch-dialog, Team, adapter or OpenCode-config change (Phase 4). No migration or schema change.
- No change to `routingStatusSchema`: the cooldown has no status field (K1).
- No change to `storage.ts`, `src/main/index.ts`, `src/preload/index.d.ts`, `src/main/ipc.ts`, `routingObserver.ts`, `routingStore.ts`, `routingClient.ts` or any `src/main/routing/*` core.
- No change to any Phase 1 or Phase 2 golden value; only the counts and fixtures listed in the overview's amendment table change.
- No ranking-knob UI or IPC (MR-D24); `refreshCooldownMs` is never reachable from IPC.
- No live spend, no network in tests, no new dependencies.
- No edits to the roadmap, Plan_1 or the Phase 0–2 documents.
- Do not touch, stage or revert the pre-existing modified and untracked files.

## Dependencies

Phase 2. Tasks 3-2 to 3-4 consume `routing:credentials`, `RoutingCredential`, `ROUTING_REFRESH_COOLDOWN_MS` and `ROUTING_REFRESH_PROBE_CAP_USD`. A correction needed downstream is made here, with a test, and recorded in that task's report.

## Step-by-step Work

1. Re-run `git status --short` and record the pre-existing entries.
2. Amend the Phase 2 IPC block and append the Phase 3 block to `src/shared/routing.ts`; amend S5-1 and write Table S6.
3. In `routingService.ts`: widen `RoutingStorageLike`; add the knob with its constructor validation next to the C21 checks; add `credentials()`; insert the cooldown check after the in-flight `BUSY` check and the end-of-refresh record in the `finally`.
4. Amend the `routingService.test.ts` harness exactly as specified, then run the whole file before writing any new test: every existing test must pass unchanged.
5. Write Table V3.
6. Add the handler and widen the `Pick` in `routingIpc.ts`; extend the test's channel tables; amend I1 and I4; write I11.
7. Add the preload line after `observationSet` (:169). Check `git diff --stat src/preload/index.ts` shows `1 insertion(+)` and `git ls-files --eol src/preload/index.ts` still reports `w/crlf`.
8. Update `scripts/verify-routing-ipc.mjs`.
9. Run the verification commands. `npx electron-vite build` before the drive; the drive refuses a stale build.

## Test Expectations

- **Credentials:** only OpenRouter API-key credentials that pass the pre-decrypt check, ordered by label then id, with scrubbed labels and provider names; non-UUID ids omitted; zero decrypts and zero requests; a storage failure is the fixed `OPERATION_FAILED`.
- **Cooldown:** a second refresh within 60 s of a network-reaching refresh is `BUSY` with the exact seconds-remaining message and reads no credential, decrypts nothing, sends nothing and emits nothing; the boundary is exact (59.001 s → `1 s`, 60 s → runs); pre-network refusals do not start it; a failed network refresh does; observer ticks do not; a clock that moved back does not refuse; invalid and unknown requests keep their own codes; the knob is validated and 0 disables it; the production default is 60 s.
- **Phase 2 unchanged:** every existing test in `routingService.test.ts`, `routingIpc.test.ts` and `routing.test.ts` passes with only the amended counts and fixtures.
- **IPC:** nine request channels; the new one goes through the full envelope (sender check, input parse, output parse, error mapping); an invalid credentials output is `OPERATION_FAILED`.
- **Runtime (CDP):** in a throwaway profile `routing:credentials` returns `{ credentials: [] }` and refuses an extra key; the drive ends `PASS (19 checks)` with `requestsSinceStart` 0.

## Verification Commands

Run from the repository root.

```powershell
npm run typecheck
npx vitest run src/main/services/routingService.test.ts src/main/services/routingIpc.test.ts src/shared/routing.test.ts
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

Both `Select-String` lines must print nothing. The ranker script prints `PASS (30 checks)`. The drive's last line is `PASS (19 checks)` with exit code 0. `git diff --stat src/preload/index.ts` shows one insertion and no deletion, and `git ls-files --eol` still reports `w/crlf` (with `core.autocrlf` true, a CRLF→LF rewrite does not show in the diff; restore CRLF if it changed). `git status --short` shows ` M` for the six owned source files, ` M scripts/verify-routing-ipc.mjs`, and the pre-existing entries unchanged; `out/` is build output and is not committed. Record actual exit codes.

## Acceptance Criteria

- The two amendments and the Phase 3 block match the specification; no other export of `src/shared/routing.ts` changed; both typechecks pass.
- S5-1 (amended) and S6-1 to S6-3 pass.
- V30–V42 pass, and every pre-existing Table V test passes with its expected values untouched.
- I1 and I4 (amended), I2–I3 and I5–I10 (now covering nine channels) and I11 pass.
- The preload has one new line and no Zod; `src/main/index.ts`, `storage.ts` and `index.d.ts` are unchanged.
- `node scripts/verify-routing-ipc.mjs` passes 19 checks against a fresh build and a throwaway profile.
- `npm test` and `npm run grep:secrets` pass; both greps print nothing; the ranker script passes; the pre-existing worktree entries are untouched.

## Review Checklist

- [ ] `credentials()` calls only `listCredentialProfiles`, `listProviderConfigs` and the pure predicate: no `getCredentialProfileById` loop, no decrypt, no fingerprint, no envelope (MR-G4).
- [ ] Labels and provider names go through `scrubSecrets`; non-UUID ids are skipped, so the output parse can never fail on a legacy row (C1).
- [ ] The cooldown check sits after the in-flight `BUSY` check and before `this.busy.add`, `readSettings` and `withRoutingKey` (C2): no credential read, no decrypt, no event.
- [ ] The end time is recorded only when the `use` callback ran, only for a finite clock value, and a failing clock never masks the refresh's own outcome.
- [ ] `refreshCooldownMs` is validated in the constructor like C21 and is not in any IPC schema (C3).
- [ ] Each Phase 2 test change is one of the amendments listed in the overview, and no golden value moved.
- [ ] The drive launched its own built app on a free port with a throwaway profile and killed only its own child, by pid.
- [ ] Changes are limited to owned files; pre-existing work is preserved and not committed.
