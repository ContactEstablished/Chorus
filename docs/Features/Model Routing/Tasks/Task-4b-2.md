# Task 4b-2 — Helper execution wiring and the main-process Team harness

**Status:** Not started.\
**Depends on:** Task 4b-1.\
**Paired specification:** [ImplementationSpec-4b-2](../ImplementationSpecs/ImplementationSpec-4b-2.md)

## Source Of Truth

[Feature roadmap](../roadmap.md) (MR-D10, MR-D18, MR-D26, MR-D32; MR-D18/D214 unchanged; gates MR-G1, MR-G2, MR-G4–MR-G6), the [Phase 4b overview](Phase-4b-Overview.md) (K1–K5, K8, K9, K12, K14(b) and clarifications C7–C9, C14–C16, C18; normative for names, texts, order and ownership), the paired specification, [ImplementationSpec-4b-1](../ImplementationSpecs/ImplementationSpec-4b-1.md) (every contract and pure rule this task wires), the Team Sessions design as built (`teamService.ts`, `teamStorage.ts`, `teamCore.ts`; the `verify-team-runtime.ts` fixture pattern), and repository CLAUDE.md (sessions and helpers live in main; Zod on every IPC boundary, in main; keys only as env vars into the child, never logged or written).

## Initial Starting Point

Branch `feature/model-routing` at `70d5dda` plus Task 4b-1, verified 2026-10-05 by opening each file at `70d5dda` (Task 4b-1 touches none of them; recheck the lines at execution).

- `src/main/services/teamService.ts` (CRLF, 748 lines): `TeamServiceDependencies` (:16–55; `validateProject` :48); `assertCombination` (:113–116); `createRun` (:238–258: parse :241, replay :242, the helper loop :247, `storage.createRun` :251); `team_roster` returns `run.config.helpers` (:171); `team_detail` returns whole attempt records (:202–213, :210). `executeAttempt` (:378–463): workspace (:392), second `validateMember` (:398), fence checks (:399–401), **the decrypt `credentials.resolve` (:403)**, `authorize` (:404–410), the combination check on `member.model` (:414), `buildExecution` (:416), `helper-spawn-intent` (:420), spawn (:422); any error before the spawn takes `preparation-failed` with ` This attempt was consumed.` (:453–461). `finishAttempt` (:464–490): a confirmed failure's blocker is `outcome.result.summary.slice(0, 3000)` (:472), written to the attempt and the task (:473–476).
- `src/main/services/teamStorage.ts` (CRLF, 384 lines): `json()` refuses a record `scrubSecrets` would change (`SECRET_IN_RECORD` :27–31); `getRun` compares `configJson` (:54); `updateRun` refuses a config change (`IMMUTABLE_RUN` :308); `writeAttempt` (:318–326) guards identity and instructions (`IMMUTABLE_ATTEMPT` :322) and nothing about routing.
- `src/main/services/teamRuntime.ts` (CRLF, 315 lines): `TeamRuntimeDependencies` (:28–32); `TeamService` built in the constructor (:65–79; `validateMember … autoActivate: true,` :75); `credentials.resolve` decrypts and checks the route (:66–73).
- `src/main/index.ts` (CRLF, 1,616 lines): `new TeamRuntime({ … })` (:1359–1370; `bridgeScript` :1361), `teamRuntime.start()` (:1371), `registerIpc` (:1372–1421, its routing thunk :1417–1419), `new RoutingService` (:1428 inside :1426–1439; reset to null :1438).
- `src/main/services/teamCore.ts` (LF): `reserveNextAttempt` (:65–85, attempts carry no routing), `failPreparation` (:111–115), `reviseTask` (:116–122). Unchanged.
- `src/main/services/teamIpc.ts:25` maps a `TeamDomainError` to `{ ok: false, code, message }` and a `ZodError` to `INVALID_REQUEST` with a generic message; `team:launch` (:34). Unchanged.
- There is no vitest test of `TeamService` or `TeamStorage`: both need `better-sqlite3` built for Electron. Their checks are Electron-hosted scripts; `scripts/verify-team-storage.mjs` (with `verify-team-runtime.ts`, `-workspace`, `-integration`, `-members`, `-dependability`) is the Team regression verifier. **Its v28 repair already shipped in 0.9.2 (`efabe9b`)**: it reported `"passed": true` there.
- After Task 4b-1: `HelperExecutionInput.routing`, `memberFields.routingTier`, `teamAttemptSchema.routing`, `routingLaunchRequestSchema.profile` and `helperRoutingCore.ts` exist; nothing uses them yet.
- The worktree has the pre-existing changes listed in the overview.

## Goal

Make a helper's routing tier reach its attempts (K1, K8, K9). Main checks every helper's tier at `team:launch` and refuses one it cannot serve before anything is stored (C8). Before **every** routed attempt it resolves the tier on the helper profile, immediately before the decrypt, records the exact selection on the attempt with a `helper-routing-resolved` event, and passes it into the helper builder (C9, MR-D32); a stale, empty or unavailable tier refuses that attempt with no decrypt and no spawn. A recorded selection never changes (C16). A routed attempt that ends with OpenCode's generic provider error names its tier (K12). Prove all of it, at zero cost, with the new Electron-hosted harness `verify-routing-team.mjs` (C18, K14(b)).

## Exact Scope

- New `src/main/services/teamRouting.ts` (exact code in the specification) and `teamRouting.test.ts` (Table TR).
- `src/main/services/teamService.ts`: the `routing` dependency, `routingRefusal`/`resolveRouting`, the `createRun` check, the `executeAttempt` resolution and record, the sent id in the combination check and the builder input, the K12 note in `finishAttempt`.
- `src/main/services/teamStorage.ts`: one `writeAttempt` rule (three lines).
- `src/main/services/teamRuntime.ts`: the optional `routing` dependency and the port.
- `src/main/index.ts`: one property (the thunk) and its comment.
- New `scripts/verify-routing-team.mjs` (launcher, exact code) and `scripts/verify-routing-team.ts` (driver; the specification gives a typechecked reference and normative checks T1–T16).

## Non-Goals

- **Not the Team regression verifier.** `scripts/verify-team-storage.ts` and `scripts/verify-team-members.ts` are not edited (their v28 repair shipped in 0.9.2, `efabe9b`); this task only re-runs `node scripts/verify-team-storage.mjs`.
- No change to anything Task 4b-1 owns (a needed fix is made there, with a test, and recorded in this task's report).
- No renderer, store, preload, IPC channel or Settings change (Tasks 4b-3, 4b-4); no `teamIpc.ts`, `teamCore.ts`, `teamStatusCore.ts` or `helperProcess.ts` change.
- No automatic re-rank, refresh, retry or tier switch: a refused attempt is consumed (Q1) and the lead revises; no Team panel display of tiers (Q6); no raw OpenCode error text (Q4).
- No migration (records are JSON TEXT), no new dependency, no new key-bearing call (MR-D18/D214).
- No paid run, no real lead or helper CLI session, no built-app Team drive (rejected in K14).
- No edits to the roadmap, Plan_1 or the Phase 0–4a documents.
- Do not touch, stage or revert the pre-existing modified and untracked files.

## Dependencies

Task 4b-1 (the contracts, `planHelperRouting`, `helperAttemptRefusal`, `routedHelperFailureNote`, `resolveLaunch` with `profile`, the builder's `routing` input). Task 4b-3's dialog sends `routingTier`; Task 4b-4's drive relies on `createRun`'s refusal code `ROUTING_REFUSED` and message `Helper "<label>": <reason>`. A correction needed downstream is made here, with a test, and recorded in that task's report.

## Step-by-step Work

1. Re-run `git status --short`; record the pre-existing entries. Run `npm test` (expect Task 4b-1's totals) and `node scripts/verify-team-storage.mjs` (expect `"passed": true`) **before** editing, so a later failure is attributable.
2. Write `teamRouting.ts` exactly as specified and Table TR.
3. `teamStorage.ts` (CRLF): the three lines after :322. Check `git diff --stat` (3 insertions) and the byte counts.
4. `teamService.ts` (CRLF): the edits in the specification, in file order. Check `git diff --stat` and the byte counts.
5. `teamRuntime.ts` and `src/main/index.ts` (CRLF): the dependency, the port and the thunk.
6. `npm run typecheck`; `npm test`; then `node scripts/verify-team-storage.mjs` again (unrouted Team flows unchanged).
7. Write `scripts/verify-routing-team.mjs` and `scripts/verify-routing-team.ts` (LF); run the harness until it ends `PASS (16 checks)`. If an expectation fails, find the cause in the code or the harness; never edit a hand-written expectation to match an output without recording why in the report.
8. Run the verification commands.

## Test Expectations

- **Port (Table TR):** an unrouted member never reaches the service; `check` reads only the two lists; `resolve` sends exactly the helper-profile request with the base slug and the member's own effort and credential; every refusal and every `RoutingError` maps to its exact C1/C2 text; settings are read only for `SNAPSHOT_STALE`; a non-routing error never leaks its text; the thunk is read on every call; nothing else on `RoutingService` is touched.
- **Wiring (harness T1–T16):** setup on a v28 throwaway database with a seeded store and a pinned clock (T1); launch refusals with exact codes and texts and no run row (T2, T3); tier names stored and returned to the lead (T4); Balanced from a `:nitro` member resolved before the decrypt, equal to main's own helper ranking and the golden order (T5); its request keeps every measured option (T6); Nitro from a standard member (T7); one ordered `helper-routing-resolved` event per routed attempt (T8); a stale ranked tier refused with no decrypt or spawn (T9) while Nitro resolves (T10); after new numbers the revised task resolves again (T11); unavailable routing refuses a routed attempt while an unrouted helper sends today's request (T12); the K12 note on routed provider errors only (T13); attempts read back identically and recorded routing is immutable and secret-free (T14); no key material anywhere and every routing call accounted for (T15); cleanup (T16).
- **Existing checks unchanged:** `npm test` passes (reference: 148 files and 4,281 tests when each Table TR row is one `it`); `node scripts/verify-team-storage.mjs` reports `"passed": true`; the ranker prints `PASS (30 checks)`; the body script `PASS (18 checks)`; the IPC drive `PASS (20 checks)`.

## Verification Commands

Run from the repository root.

```powershell
npm run typecheck
npx vitest run src/main/services/teamRouting.test.ts src/main/routing/helperRoutingCore.test.ts src/shared/team.test.ts src/main/services/routingService.test.ts src/main/adapters/helpers/helpers.test.ts src/main/services/teamCore.test.ts src/main/services/teamIpc.test.ts
npm test
node scripts/verify-routing-ranker.mjs
node scripts/verify-routing-team.mjs
node scripts/verify-team-storage.mjs
$env:OPENCODE_DISABLE_AUTOUPDATE = 'true'; opencode --version
node scripts/verify-routing-body.mjs
npx electron-vite build
node scripts/verify-routing-ipc.mjs
npm run grep:secrets
git diff --check
git diff --stat -- src/main/services/teamService.ts src/main/services/teamStorage.ts src/main/services/teamRuntime.ts src/main/index.ts
git ls-files --eol -- src/main/services/teamService.ts src/main/services/teamStorage.ts src/main/services/teamRuntime.ts src/main/index.ts
git status --short
```

The harness's last line is `PASS (16 checks)` with exit code 0; paste its whole output (it prints no key). `verify-team-storage.mjs` prints a report with `"passed": true` and exits 0 (about three minutes on Electron 43). The body script ends `PASS (18 checks)`, the IPC drive `PASS (20 checks)`, the ranker `PASS (30 checks)`. `npm run grep:secrets` runs after the drives deleted their bundles. `git ls-files --eol` reports `w/crlf` for all four edited files, with the byte counts in the specification (with `core.autocrlf` true the diff cannot see a whole-file rewrite). `git status --short` shows ` M` for the four owned files, `??` for `teamRouting.ts`, its test and the two harness scripts, and the pre-existing entries unchanged; no `%TEMP%\chorus-routing-team-*` or `_verify/routing-team-*.cjs` remains. Record actual exit codes.

## Acceptance Criteria

- `teamRouting.ts` matches the specification exactly; the `teamService.ts`, `teamStorage.ts`, `teamRuntime.ts` and `index.ts` edits match it; both typechecks pass.
- TR1–TR8 pass; every existing test passes unchanged.
- `executeAttempt` resolves after the fence checks and immediately before `credentials.resolve`, records the selection before the decrypt, and an unrouted member never reaches the port.
- `node scripts/verify-routing-team.mjs` prints `PASS (16 checks)`, exit 0, with every expectation as specified (T1–T16).
- `node scripts/verify-team-storage.mjs` reports `"passed": true`; the body script, IPC drive, ranker and `npm run grep:secrets` pass; line endings are unchanged; the pre-existing worktree entries are untouched.

## Review Checklist

- [ ] The call order in `executeAttempt` is exactly C9's; the resolve, re-read and record are synchronous (no `await` between them); a refusal throws before `credentials.resolve`.
- [ ] `createRun` refuses a tier it cannot serve after each helper's `validateMember` and `assertCombination` and before `storage.createRun`, with `ROUTING_REFUSED` and `Helper "<label>": <reason>` (label scrubbed); a missing port is `unavailable`, never unrouted; a replay still returns its acknowledgment first.
- [ ] The combination check uses the sent id; `buildExecution` receives `routing` only for a routed attempt and still receives the member's own `model`.
- [ ] The K12 note is added only for a recorded `routing` and a `provider-error` failure; `result.summary` is unchanged; the 3,000-character cut is unchanged.
- [ ] `writeAttempt` refuses a changed or dropped `routing`, a late first `routing` and an insert carrying one, with `IMMUTABLE_ATTEMPT`; every existing writer spreads the attempt it read.
- [ ] The port calls only `credentials`, `models`, `resolveLaunch` and `getSettings`, never throws, never decrypts; settings only for `SNAPSHOT_STALE`.
- [ ] The harness uses the real StorageService/TeamStorage, RoutingService, port, TeamService, builder and parser; fakes only for the executor, workspace, lead, `validateMember` and the decrypt; it starts no helper, lead or OpenCode process, sends no request, and deletes its bundle and evidence on every path.
- [ ] `verify-team-storage.ts` and `verify-team-members.ts` are untouched.
- [ ] Changes are limited to owned files; pre-existing work is preserved and not committed.
