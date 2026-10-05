# Task 2-4 — IPC, preload and app wiring

**Status:** Complete 2026-10-02 (`21c65ff`).\
**Depends on:** Task 2-3 passes (`RoutingService`, `RoutingObserver` and the service-contract schemas exist and are tested; the live check passed).\
**Paired specification:** [ImplementationSpec-2-4](../ImplementationSpecs/ImplementationSpec-2-4.md)

## Source Of Truth

[Feature roadmap](../roadmap.md) (MR-D10; gates MR-G1, MR-G4, MR-G5), user decisions MR-D18 and MR-D19 as recorded in the [Phase 2 overview](Phase-2-Overview.md) (with K7, K9, K10 and C11, C20, C22–C24), the paired specification, Foundation roadmap D14, D33 and D60, and repository CLAUDE.md (Zod on every IPC boundary, in main; plain-object payloads; runtime-verify every new renderer-to-main payload). Where [Plan_1](../Plan_1.md) §12's IPC sketch differs (`routing:listModels`, `routing:getCached`, `routing:select`), the overview wins.

## Initial Starting Point

Branch `feature/model-routing`; Tasks 2-1 to 2-3 landed on top of `a9842a5`. Facts verified 2026-10-02 at `a9842a5`:

- The modular IPC pattern is `registerTeamIpc` (`src/main/services/teamIpc.ts:14`): `handle()` (:18) refuses a sender that is not an app window's main frame (:22), parses input and output with Zod, returns `{ ok, value }` or `{ ok: false, code, message }`, and broadcasts with `BrowserWindow.getAllWindows()` (:70–73). Its test mocks `electron` (`teamIpc.test.ts:2–4`) and imports only `type StorageService`.
- `registerIpc` (`src/main/ipc.ts:617`) takes 19 positional parameters, `teamRuntime?` last (:720), and calls `registerTeamIpc` (:722). Council's `emitProgress` (:3503) parses in main, then sends to every window.
- The preload's `team:` bridge (`src/preload/index.ts:143–159`) is a set of `ipcRenderer.invoke` pass-throughs cast `as TeamApi`; "no Zod here" (:137). `ChorusApi = typeof chorusApi` (:919), and `src/preload/index.d.ts:5` declares `chorus: ChorusApi`, so `index.d.ts` needs no edit.
- `src/main/index.ts`: `const store = storage` (:595), `const vault` (:809), module-scope `let fleet` (:149) and `let council` (:153), `council = registerIpc(` (:1356–1402), `watchSessionExits` (:1403), `createWindow` (:1487), `before-quit` (:1510) with the Team-shutdown branch first (:1511) and `fleet?.stop()` (:1520). An explicit `--user-data-dir` wins over the packaged default (:125).
- CDP precedent: `scripts/verify-team-packaged-ui.mjs:28–62` (free port, `--user-data-dir`, `--remote-debugging-port`, page target `renderer/index.html`, Node's global `WebSocket`, `Runtime.evaluate`). `package.json` `main` is `./out/main/index.js`; the build writes `out/main/index.js` and `out/preload/index.js`.
- The worktree has the pre-existing changes listed in the overview.

## Goal

Expose Phase 2 to the renderer safely: eight validated `routing:*` request channels and one validated broadcast, a thin preload bridge, and app wiring that constructs the service, starts the observer after the app is ready and stops it as soon as quitting begins; then prove, at zero cost against the built app, that every channel works with plain-object payloads and that no OpenRouter request is made.

## Exact Scope

- `src/shared/routing.ts`: append the "Phase 2 — IPC" block (`ROUTING_CHANNELS`, `routingEmptyRequestSchema`, `routingSettingsSetRequestSchema`, `RoutingReply`, `RoutingApi`). `src/shared/routing.test.ts`: append table S5.
- `src/main/services/routingIpc.ts` and test: `registerRoutingIpc`.
- `src/preload/index.ts`: the type import and the `routing:` block.
- `src/main/index.ts`: four imports, two module-scope variables, construction and registration after `registerIpc(…)`, and the two stop calls at the top of `before-quit`.
- `scripts/verify-routing-ipc.mjs`.

## Non-Goals

No renderer components, stores, settings screens or launch-dialog changes (Phase 3). No launch, OpenCode config, `OPENCODE_CONFIG_CONTENT`, adapter or Team wiring (Phase 4). No edit to `src/main/ipc.ts` or `src/preload/index.d.ts` (C22). No migration or schema change. No edits to Task 2-1 to 2-3 files except a recorded, tested correction. No edit to an existing export of `src/shared/routing.ts` or `src/main/routing/*`. No live spend: the drive uses no credential. No new dependencies (no `ws`). Do not touch, stage or revert the pre-existing modified and untracked files.

## Dependencies

Task 2-3. Phase 3 consumes `window.chorus.routing` and the shared types.

## Step-by-step Work

1. Re-run `git status --short` and record the pre-existing entries. Read the Task 2-3 report for deviations.
2. Append the IPC block to `src/shared/routing.ts`; write S5.
3. Write `routingIpc.ts` with the six-step handler envelope, the channel table and the broadcast; write table I with the `electron` mock.
4. Add the preload block after `} as TeamApi,` with literal channel strings and a type-only import.
5. Wire `src/main/index.ts` as specified, including the D60 comment at the construction site. Check `git diff --stat src/main/index.ts` shows only those insertions.
6. Run the unit verification commands until green.
7. `npx electron-vite build`, then `node scripts/verify-routing-ipc.mjs`. Never point the drive at the real profile or an already-running instance; it launches its own and kills only that child.
8. Confirm the throwaway profile was deleted and no Electron process from the drive remains (check by the child's pid, never by process name).

## Test Expectations

- **Authority:** subframes, destroyed windows and missing windows are refused on every channel before any service call.
- **Validation:** every input is parsed in main; a malformed request never reaches the service; an invalid service output becomes `OPERATION_FAILED` without logging the payload; progress events are parsed before broadcast and invalid ones are dropped.
- **Errors:** `RoutingError` codes pass through with scrubbed messages; other errors become a fixed `OPERATION_FAILED` message.
- **Preload:** literal channels, `as RoutingApi`, no Zod import.
- **Runtime (CDP):** models listed; status dormant and undesignated with zero requests; settings round-trip through `storage.ts` and reject unknown keys and refine failures; designation of an unknown credential refused and not stored; `NO_SNAPSHOT` and `UNKNOWN_MODEL`; a refresh with an unknown credential refused with no progress events; a Proxy payload rejected by the bridge with "could not be cloned"; no clone errors otherwise; zero OpenRouter requests and no snapshot file at the end.

## Verification Commands

Run from the repository root after creating the task's files.

```powershell
npm run typecheck
npx vitest run src/main/services/routingIpc.test.ts src/shared/routing.test.ts
npm test
Get-ChildItem -Path src/main/routing, src/shared/routing.ts -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern 'Date\.now\(|Math\.random\(|new Date\(\)|from ''(node:|fs''|path''|electron|better-sqlite3)|require\('
Get-ChildItem -Path src/main/routing -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern "from '\.\./(services|db|adapters)/"
node scripts/verify-routing-ranker.mjs
npx electron-vite build
node scripts/verify-routing-ipc.mjs
npm run grep:secrets
git diff --check
git status --short
```

Both `Select-String` lines must print nothing. The drive's last line must be `PASS (n checks)` with exit code 0. `git status --short` must show ` M src/main/index.ts`, ` M src/preload/index.ts`, ` M src/shared/routing.ts`, ` M src/shared/routing.test.ts`, the new files, and the pre-existing entries unchanged; `out/` is build output and is not committed. Record actual exit codes.

## Acceptance Criteria

- The shared block exports every name in the specification; no existing export changed; both typechecks pass.
- I1–I10 and S5 pass.
- `src/main/ipc.ts` and `src/preload/index.d.ts` are unchanged; the preload has no Zod.
- `index.ts` constructs one `RoutingService` and one `RoutingObserver`, registers the IPC once, starts the observer after `registerIpc`, and stops it and disposes the service before the Team-shutdown branch of `before-quit`.
- `node scripts/verify-routing-ipc.mjs` passes D1–D17 against a fresh build and a throwaway profile, with `requestsSinceStart` 0 at the end.
- `npm test` and `npm run grep:secrets` pass; both greps print nothing; the ranker script still prints `PASS (30 checks)`; the pre-existing worktree entries are untouched.

## Review Checklist

- [ ] Sender-frame check, then input parse, then the action, then output parse, on every channel (MR-G5).
- [ ] No response, event or log line carries a key, fingerprint, envelope, raw provider body or exception text.
- [ ] The broadcast parses before sending and never throws.
- [ ] The preload is a pass-through with literal channel names and a type-only import.
- [ ] The observer's stop and the service's dispose are idempotent and run before the Team-shutdown branch (C22).
- [ ] The CDP drive launched its own built app on a free port with a throwaway profile, killed only its own child and deleted the profile (C24).
- [ ] Changes are limited to owned files; pre-existing work is preserved and not committed.
