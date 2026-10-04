# Task 4a-5 — The built-app launch drive

**Status:** Complete 2026-10-04 (`eb8ee80`).\
**Depends on:** Tasks 4a-1 to 4a-4 pass (the IPC drive passes 20 checks; `verify-routing-body.mjs` prints `PASS (16 checks)`; migration v28 exists; `launchRequestSchema.routing_tier` is wired; the harness passes 20 checks).\
**Paired specification:** [ImplementationSpec-4a-5](../ImplementationSpecs/ImplementationSpec-4a-5.md)

## Source Of Truth

[Feature roadmap](../roadmap.md) (MR-D3, MR-D4, MR-D11, MR-D18, MR-D19, MR-D22; gates MR-G1, MR-G3, MR-G4, MR-G5, MR-G6), user decisions MR-D25 to MR-D28, kickoff decisions K2–K11 and K13, and clarifications C36–C44 as recorded in the [Phase 4a overview](Phase-4a-Overview.md), the paired specification, ImplementationSpecs [4a-1](../ImplementationSpecs/ImplementationSpec-4a-1.md) to [4a-4](../ImplementationSpecs/ImplementationSpec-4a-4.md) for every message, field and attribute the drive asserts, [ImplementationSpec-3-4](../ImplementationSpecs/ImplementationSpec-3-4.md) for the drive pattern, Foundation D14 and D33, and repository CLAUDE.md (verify the real app; keys never in argv, logs or plain files).

## Initial Starting Point

Branch `feature/model-routing` with Tasks 4a-1 to 4a-4 landed. Facts verified 2026-10-03 at `a57ef1b` (Task 4a-3 later moves lines in `src/main/ipc.ts`, `src/main/index.ts` and `src/main/services/storage.ts`; recheck at execution):

- `scripts/verify-routing-settings-ui.mjs` (909 lines) is the drive precedent: freshness (:112–167), an esbuild seed bundle (:169–207), its own child with a throwaway `--user-data-dir` and a free port (:209–237), kill by its own pid only (:243–250), interrupt cleanup (:276–291), CDP connect (:333–385), error watchers with positive controls (:536–566), the secret-pattern scan with a positive control (:824–838), shutdown (:850–872), cleanup (:894–909).
- CLI resolution is `where.exe` plus `pickSpawnable` (`cliDetect.ts:36–52`, `resolveCli` `cliDetect.ts:117–133`): the first `.exe` anywhere on `PATH` wins, else the first `.cmd`. An npm-shaped `.cmd` whose target is a `.cjs` is spawned as `node <target>`, no `cmd.exe` (`resolveShim`, `cliDetect.ts:63–81`; `parseNpmShim`, `cliShimCore.ts:67`). Detection runs `<file> --version` and keeps the first line (`probeCli`, `cliDetect.ts:174–202`); the Team helper probe also runs `<file> run --help` (`helpers/common.ts:85–86`). Measured 2026-10-03: a stub directory first on `PATH` resolves to the stub (`%APPDATA%\npm` holds only `opencode` and `opencode.cmd`, no `.exe`), and a two-line stub shim parses as `node-script` and answers `1.18.33`.
- A credentialed child gets only seven variables from the parent (`env.ts:10–20`, :166–178): no `XDG_*`. `os.homedir()` follows `USERPROFILE` (Node 22.14 and Electron 43.1.1); Electron's `app.getPath('home')` does not (measured 2026-10-03).
- Providers and credential profiles are created over IPC with no network call (`ipc.ts:2648–2670`, :2739–2757; the key test is button-only, :2815–2819). The model catalog is written only by `model:refresh`, a live call (`ipc.ts:2915`), so the drive seeds the catalog row with `node:sqlite` between two app runs; the shortlist has a local IPC write (`ipc.ts:2894–2913`).
- A fresh profile on this machine activates the repository itself as the project (`constants.ts:8`, `index.ts:968–977`); `project:add` needs a native picker (`ipc.ts:4133–4150`). `suggestMode` proposes `new-worktree` while a session is live (`shared/ipc.ts:1286–1289`).
- `session:relaunch` needs a stopped session with a launch profile (`ipc.ts:3309–3314`, :3332–3339); a profile launch becomes the project's preselected profile (`ipc.ts:2091`; `LaunchDialog.vue:712–713`).
- The user's real `%USERPROFILE%\.local\state\opencode\model.json` exists (1,157 bytes); no `XDG_*` or `HOME` variable is set here. The installed Chorus is running from `%LOCALAPPDATA%\Programs\Chorus` with its data in `%APPDATA%\chorus-app`; the drive touches neither.
- The worktree has the pre-existing changes listed in the overview.

## Goal

Prove on the built app, at zero cost, in a throwaway profile and a throwaway home, that the launch dialog's routing section appears exactly when a launch is routable, preselects and remembers as MR-D28 says, refuses stale ranked tiers in the dialog and in main, and that every launch reaches OpenCode — a stub that records its argv and environment — with the provider object, `-m` id, variants and remembered variant main itself computed, persisted in `sessions.routing_json` and re-applied by relaunch without a re-rank — and that a directly picked `:nitro` id with an effort declares its variants without any routing (K13).

## Exact Scope

- `scripts/verify-routing-launch.mjs`: two app runs (bootstrap, then checks), a stub `opencode`, checks L1–L19 and `cleanup`, `PASS (20 checks)`.

## Non-Goals

- No production code change; a defect found is reported and fixed in its owning task's files with a test.
- No real OpenCode launch, no Refresh click, no `model:refresh`, no key test, no paid run of any kind (K11).
- No `TeamLaunchDialog`, Team or helper routing (Phase 4b); the drive never opens the Team dialog or starts a Team run.
- No drive against the user's profile, the installed Chorus, port 9222 or the user's real OpenCode state; nothing stopped by process name.
- No new dependencies (`node:sqlite`, esbuild, Electron and the CDP pattern are already used).
- No edits to the roadmap, Plan_1 or the Phase 0–3 documents.
- Do not touch, stage or revert the pre-existing modified and untracked files.

## Dependencies

Tasks 4a-1 to 4a-4, including Task 4a-3's K13 path (a credentialed gateway launch of a `:nitro` id with an effort declares its variants without a tier). The drive copies by hand the stale-tier refusal message from ImplementationSpec-4a-1 and the strings of ImplementationSpec-4a-4.

## Step-by-step Work

1. Re-run `git status --short` and record the pre-existing entries. Read the Task 4a-1 to 4a-4 reports; copy the final refusal message and confirm the `OPENCODE_CONFIG_CONTENT` shape, the MR-D25 state-home rule and the variant source they shipped.
2. Write `scripts/verify-routing-launch.mjs` as specified: freshness, seed bundle, throwaway root and stub, preflight, baselines, run 1, the database step, run 2, after-exit checks, cleanup.
3. `npx electron-vite build`, then run the drive. On a failure, fix the drive only if the drive is wrong; a product defect goes back to its task.
4. Look at the three screenshots.
5. Run the verification commands.

## Test Expectations

- **Stub and isolation:** the app detects the stub as OpenCode 1.18.33; every child sees the throwaway home; the decoy XDG directories, the user's real state file and the repository's worktrees and status are unchanged.
- **Dialog:** no section for another agent, a subscription launch, a non-routable credential or a `:nitro` model; a `:nitro` model shows its base model's efforts; Balanced preselected on a fresh seed; the remembered choice preselected after each launch; stale ranked cards disabled with their reason and the fallback hint.
- **Launches:** Balanced (bare credential and profile) carries main's own Balanced provider object; Nitro with `Low` carries `:nitro`, the three declared variants, `data_collection: deny`, the sent-id agent block and the MR-D25 write; OpenRouter default carries no content and still gets the MR-D25 write; a directly picked `:nitro` id with `High` and no tier carries only its declared variants (no provider object) and gets the MR-D25 write (K13); main refuses a forced stale Balanced.
- **Persistence:** `routing_json` matches each routed launch and is `NULL` for the two untiered ones; relaunch re-applies it on a stale snapshot; `schema_migrations` is 28.
- **Hygiene:** no OpenRouter request, no key material outside `OPENROUTER_API_KEY`, no renderer error (with positive controls), every stub stopped, only three PNGs left.

## Verification Commands

Run from the repository root.

```powershell
npm run typecheck
npm test
npx electron-vite build
node scripts/verify-routing-ranker.mjs
node scripts/verify-routing-ipc.mjs
node scripts/verify-routing-ui.mjs
node scripts/verify-routing-settings-ui.mjs
node scripts/verify-routing-body.mjs
node scripts/verify-routing-launch.mjs
Get-ChildItem _verify/routing-launch
npm run grep:secrets
git diff --check
git status --short
```

The drives end `PASS (30 checks)`, `PASS (20 checks)`, `PASS (20 checks)`, `PASS (16 checks)` (Settings), `PASS (16 checks)` (body script), and `PASS (20 checks)` for this drive, each with exit code 0. `_verify/routing-launch` holds only `launch-fresh.png`, `launch-nitro.png` and `launch-stale.png`. `git status --short` shows the new script and the pre-existing entries unchanged; `out/` and `_verify/` are not committed. Record actual exit codes, the drive's full output and one sentence per screenshot.

## Acceptance Criteria

- `node scripts/verify-routing-launch.mjs` passes L1–L19 and `cleanup` (`PASS (20 checks)`) against a fresh build, and the five earlier drives still pass.
- The drive launched only its own app, in a throwaway profile and home, on a free port; stopped only that app and the stubs it caused, by pid; and deleted the throwaway root.
- Nothing was spent: no Refresh click, `requestsSinceStart` 0, no real OpenCode.
- `npm test` and `npm run grep:secrets` pass; the pre-existing worktree entries are untouched.

## Review Checklist

- [ ] The stub shim is the two-line npm shape; it answers `--version` with `1.18.33` and `run --help` with a short help text (both exit 0, neither recorded), records argv and env beside itself for any other call, and stays alive until killed (C37).
- [ ] The app environment overrides `USERPROFILE`, `HOME`, `HOMEDRIVE`, `HOMEPATH`, `XDG_STATE_HOME`, `XDG_DATA_HOME`, and prepends the stub to the existing `PATH` key; the preflight proves the stub wins.
- [ ] The fake keys are built at run time by concatenation; no key-shaped literal is in the script; nothing prints a key or a capture's env.
- [ ] Every launch is Solo, one slot, `Current tree`; L17 proves no worktree appeared (C39).
- [ ] Paths (`detectClis` path, `USERPROFILE`, `OPENCODE_CONFIG`, the session cwd) are compared with case and separators normalised.
- [ ] Provider objects are compared with main's own `routing:tiers` reply and `routing_json`, never with a golden order (Phase 3 C18, C42).
- [ ] Refusal and UI strings are copied by hand from ImplementationSpecs 4a-1 and 4a-4, never imported.
- [ ] Changes are limited to the one new file; pre-existing work is preserved and not committed.
