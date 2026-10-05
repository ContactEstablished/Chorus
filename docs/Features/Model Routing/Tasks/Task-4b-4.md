# Task 4b-4 — The built-app Team dialog drive

**Status:** Complete 2026-10-05 (`4929234`); independent reviews and coordinator verification passed.\
**Depends on:** Tasks 4b-1 to 4b-3 pass (`verify-routing-body.mjs` prints `PASS (18 checks)`; `verify-routing-team.mjs` prints `PASS (16 checks)`; `team:launch` refuses a tier it cannot serve with code `ROUTING_REFUSED` and message `Helper "<label>": <reason>` before anything is stored; the Team dialog shows the per-slot tier dropdown of ImplementationSpec-4b-3; the Settings drive passes 16 checks with the K13 note).\
**Paired specification:** [ImplementationSpec-4b-4](../ImplementationSpecs/ImplementationSpec-4b-4.md)

## Source Of Truth

[Feature roadmap](../roadmap.md) (MR-D15, MR-D18, MR-D26, MR-D31, MR-D32; gates MR-G1, MR-G3, MR-G4, MR-G5, MR-G6), kickoff decisions K2, K4, K10, K11 and K14 (c), clarifications C1, C8, C12, C13 and C19, and answers Q3 and Q8, as recorded in the [Phase 4b overview](Phase-4b-Overview.md); the paired specification; ImplementationSpecs [4b-1](../ImplementationSpecs/ImplementationSpec-4b-1.md) (the C1 texts, the strict member schema, the K15 probe), [4b-2](../ImplementationSpecs/ImplementationSpec-4b-2.md) (the `team:launch` refusal and its code) and [4b-3](../ImplementationSpecs/ImplementationSpec-4b-3.md) (every string, attribute and accessible name the drive asserts); [ImplementationSpec-4a-5](../ImplementationSpecs/ImplementationSpec-4a-5.md) and `scripts/verify-routing-launch.mjs` for the drive pattern; Foundation D14 and D33; repository CLAUDE.md (verify the real app; keys never in argv, logs or plain files).

## Initial Starting Point

Branch `feature/model-routing` with Tasks 4b-1 to 4b-3 landed. Facts verified 2026-10-05 at `70d5dda` (each file opened, `where.exe` and file stats run this session; no CLI was started). Tasks 4b-2 and 4b-3 move lines in `teamService.ts` and `TeamLaunchDialog.vue`; recheck those at execution.

- **The pattern.** `scripts/verify-routing-launch.mjs` (1,835 lines, `w/crlf`): freshness :129–188, the esbuild seed bundle :190–229, the throwaway root :231–255 (the throwaway home needs `AppData\Roaming` and `AppData\Local`, :250–254), `deleteTmp` :257–270, the npm-shaped stub :272–308 (capture names unique per process, never the pid alone, :294–296), environment helpers :310–334, `abortDrive` :339–347, the preflight :349–363, baselines :365–406, `stubProcessState` and the pid-only, command-line-confirmed last resort :421–486, runs and interrupt :488–581, CDP :583–706 (renderer errors from `Runtime.exceptionThrown`/`Runtime.consoleAPICalled` :587–596, not Electron's `console-message`), shutdown :708–736, DOM helpers :738–792 (`choose` sets `.value` and dispatches `input` and `change` :765–771), a click asserted in the same evaluation :1051–1089, positive-control watchers :1154–1185, the run-1 bootstrap :1187–1224, the between-runs seed :1226–1259, the run sequence :1620–1664, the key scan :1756–1793, cleanup :1819–1835.
- **CLI resolution.** `pickSpawnable` takes the first `.exe` anywhere in `where.exe`'s output, else the first `.cmd`/`.bat` (`cliDetect.ts:36–52`); an npm-shaped shim becomes `node <script>` (`resolveShim` :63–81, `nodeInterpreter` :94–107); `resolveCli` :117–133. Agent detection probes `claude`, `codex`, `kimi`, `opencode` and `grok` with `--version` (`DETECTED_TOOLS` :153–163, `probeCli` :174–202), and **opening the launch dialog runs it** (`LaunchDialog.vue:786–795`, :822). The Team dialog opens only from the launch dialog's `Team session` button (`LaunchDialog.vue:1257`, mounted at :1241).
- **The Team probe.** `TeamRuntime.capabilities()` probes **every** helper adapter, Claude, Codex and OpenCode (`teamRuntime.ts:95–132`, :96); `probeHelper` runs `<cli> --version` (`common.ts:85`) and then `claude --help`, `codex exec --help` or `opencode run --help` (`common.ts:86`), and refuses a raw `.cmd` (:80). `validateMember` probes again (`teamRuntime.ts:147–155`), and `createRun` validates the lead before the helpers (`teamService.ts:245–247`). So a stub `claude` sees `--help` as well as `--version`.
- **Measured locations (`where.exe`, this session).** `claude` → `%USERPROFILE%\.local\bin\claude.exe`; `codex` and `opencode` → `%APPDATA%\npm` (an extensionless file and a `.cmd`); `kimi` → `%USERPROFILE%\.kimi-code\bin\kimi.exe` and `%APPDATA%\npm`; `grok` → `%USERPROFILE%\.grok\bin\grok.exe`; `node` → `C:\Program Files\nodejs\node.exe`; `git` → `C:\Program Files\Git`. A real `.exe` anywhere on the app's PATH beats a stub `.cmd`.
- **Admitted versions.** `VERIFIED_HELPER_VERSIONS.claude` is `2.1.278 (Claude Code)` (`evidence.ts:6–8`); `verifiedLeadVersion` admits it (:60–62), `allowedLeadCombination` admits `sonnet` and `claude-opus-5-5` (:22–25), and `allowedHelperCombination` admits `sonnet` as a Claude helper (:40–45). It is **not** a focused version (`team.ts:5`: 2.1.285, 2.1.286, 2.1.289), so the dialog sends no `leadContext` (`TeamLaunchDialog.vue:31`; it still shows the Lead context select for any Claude lead, :94) and a lead with effort `medium` would fail `validateMember` (`teamRuntime.ts:154`). `MEASURED_OPENCODE_HELPER_VERSIONS` is `1.18.33`, `1.18.34` (`evidence.ts:13`). The installed CLIs are Claude Code 2.1.289 (admitted as a lead since 0.9.2) and OpenCode 1.18.34; the drive depends on neither.
- **The Team IPC.** `team:launch` parses `teamLaunchSchema` strictly in main; a schema failure answers `{ ok: false, code: 'INVALID_REQUEST', message: 'Team operation failed. Refresh the current state and retry.' }`, a `TeamDomainError` its own code and message (`teamIpc.ts:18–28`, :25, :34); `team:capabilities` :29; presets are not project-scoped (:67–68) and parse strictly (`team.ts:192–193`).
- **The project.** A fresh profile seeds this repository as the active project (`index.ts:977–988`); `project:add` needs a native picker; the active project is the `settings` row `active_project_id` (`storage.ts:1641–1652`); `projects` columns are `id, name, root_path, created_at` (:183–188), `color, description` (v13, :627–628) and `status, sort_order, color_seed` (v15, :693–700). A Team run's worktrees go next to the repository, `<parent>\.chorus\<name>` (`worktrees.ts:44–46`). Team rows live in `team_presets`, `team_runs`, `team_members`, `team_tasks`, `team_attempts`, `team_events` and `team_integrations` (`teamStorageMigration.ts:4–57`). The fixture-repository precedent is `verify-team-app.ts:17–20`.
- **MR-G3 baseline.** The user's real `%USERPROFILE%\.local\state\opencode\model.json` exists (1,157 bytes); no `XDG_*` variable is set. The installed Chorus runs from `%LOCALAPPDATA%\Programs\Chorus` with data in `%APPDATA%\chorus-app`; the drive touches neither.
- The worktree has the pre-existing changes listed in the overview.

## Goal

Prove on the built app, at zero cost, in a throwaway profile, home and project, with stub `claude` and `opencode` as the only agent CLIs the app can reach, that the Team dialog offers a tier dropdown exactly on routable OpenCode helper slots, presets it per K10, enables ranked tiers only on fresh numbers, sends only `routingTier` through the same `config()` a launch sends (proved through Save preset), restores tiers from presets with 4a's fallback hint, and that main refuses a tier it cannot serve and a renderer-built routing object at `team:launch` before anything is stored — **without ever launching a team**.

## Exact Scope

- New `scripts/verify-routing-team-ui.mjs`: two app runs (bootstrap, then checks), stub `claude` and `opencode`, checks TU1–TU15, `PASS (15 checks)`, and two PNGs, `team-tiers-fresh.png` and `team-tiers-stale.png`, in `_verify/routing-team-ui/`.

## Non-Goals

- No production code change; a defect found is reported and fixed in its owning task's files with a test.
- No Team launch: no click on `Launch team` or the launch dialog's own Launch, and no `team.launch` payload that main could accept (K14 (c)). No full end-to-end Team drive.
- No real CLI: no real `claude`, `codex`, `kimi`, `grok` or `opencode` can be resolved by the app, and the drive never starts one (`never claude help …`: it is a prompt).
- No Refresh click, no `model:refresh`, no key test, no paid run of any kind.
- No drive against the user's profile, the installed Chorus, port 9222 or the user's real OpenCode state; nothing stopped by process name.
- No new dependency (`node:sqlite`, esbuild, Electron and the CDP pattern are already used).
- No edits to the roadmap, Plan_1 or the Phase 0–4a documents. Do not touch, stage or revert the pre-existing modified and untracked files.

## Dependencies

Tasks 4b-1 (the strict member schema with `routingTier`, the C1 texts, the K15 probe that reads the help call's stderr), 4b-2 (main's `team:launch` refusal, its code and its `Helper "<label>": ` prefix) and 4b-3 (the dialog). The drive copies by hand the refusal text and code from ImplementationSpecs 4b-1 and 4b-2 and every dialog string and attribute from ImplementationSpec-4b-3.

## Step-by-step Work

1. Re-run `git status --short` and record the pre-existing entries. Read the Task 4b-1 to 4b-3 reports; confirm the final `team:launch` refusal code (`ROUTING_REFUSED`) and message (`Helper "<label>": <reason>`) that the drive copies by hand, and confirm the dialog's attributes and accessible names as shipped.
2. Re-run `where.exe claude codex kimi grok opencode node git` and record the result; confirm `VERIFIED_HELPER_VERSIONS.claude` is still `2.1.278 (Claude Code)` (`evidence.ts`). If either moved, update the drive's constants and say so in the report.
3. Write `scripts/verify-routing-team-ui.mjs` as specified: freshness, seed bundle, throwaway root, stubs, composed PATH, preflight, baselines, run 1, the database step, run 2, after-exit checks, cleanup.
4. `npx electron-vite build`, then run the drive. On a failure, fix the drive only if the drive is wrong; a product defect goes back to its task.
5. Look at both screenshots.
6. Run the verification commands.

## Test Expectations

- **Isolation:** the app resolves only the stub `claude` and `opencode`; `codex`, `kimi` and `grok` are not on its PATH; every option it reports carries a stub version or `unavailable`; the decoy XDG directories stay empty and the user's real `model.json` and repository are unchanged.
- **Dropdowns:** none on a Claude or GLM-5.3 slot; one on each DeepSeek slot, five options in order with their labels; Nitro on the default `:nitro` slots and on Add helper; OpenRouter default on a slot switched to the standard model.
- **Numbers:** fresh numbers enable the ranked options and show one caption; stale numbers disable them with 4a's reason, and a preset's Balanced falls back to OpenRouter default with `Refresh to use Balanced.`; both compared with main's own `routing:tiers` reply.
- **Payload:** Save preset stores `routingTier` `balanced` on slot 1 and no tier and no routing object anywhere else; a pre-4b preset on `:nitro` restores OpenRouter default (Q8); no clone error.
- **Main:** a tier on GLM-5.3 is refused with `ROUTING_REFUSED` and `Helper "GLM helper": ` followed by the C1 `unknownModel` text (C8); a member `routing` object and a tier on a Claude member are rejected as invalid; no run, task, attempt, event or session row exists; the stubs saw only probe arguments.
- **Hygiene:** no OpenRouter request, no key material outside the encrypted credential row, no renderer error (with positive controls), only two PNGs left.

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
node scripts/verify-routing-team.mjs
node scripts/verify-routing-team-ui.mjs
node scripts/verify-team-storage.mjs
node scripts/verify-team-review-ui.mjs
Get-ChildItem _verify/routing-team-ui
Get-ChildItem $env:TEMP -Directory -Filter 'chorus-routing-team*'
npm run grep:secrets
git diff --check
git status --short
```

`npm test` passes as after Task 4b-3 (reference: 149 files and 4,304 tests; this task adds no test). The drives end `PASS (30 checks)`, `PASS (20 checks)` (IPC), `PASS (20 checks)` (UI harness), `PASS (16 checks)` (Settings), `PASS (18 checks)` (body script), `PASS (20 checks)` (launch drive), `PASS (16 checks)` (Team harness) and `PASS (15 checks)` for this drive, each with exit code 0; `verify-team-storage.mjs` prints a report with `"passed": true` and `verify-team-review-ui.mjs` a line with `"passed":true`, each exit 0 (the overview's MR-G1: every earlier check). `_verify/routing-team-ui` holds exactly `team-tiers-fresh.png` and `team-tiers-stale.png`; no `%TEMP%\chorus-routing-team*` directory remains. `git status --short` shows the new script and the pre-existing entries unchanged; `out/` and `_verify/` are not committed. Record actual exit codes, the drive's full output and one sentence per screenshot.

## Acceptance Criteria

- `node scripts/verify-routing-team-ui.mjs` passes TU1–TU15 (`PASS (15 checks)`) against a fresh build, and every earlier drive still passes.
- The drive launched only its own app, in a throwaway profile, home and project, on a free port; it stopped only that app, by its pid; no stub process outlived its call; it deleted the throwaway root.
- Nothing was launched or spent: no click on a Launch button, no run row, `requestsSinceStart` 0, no real CLI.
- `npm test` and `npm run grep:secrets` pass; the pre-existing worktree entries are untouched.

## Review Checklist

- [ ] The stubs are npm's two-line shim shape; `claude` answers `--version` with `2.1.278 (Claude Code)` and `--help`, `opencode` answers `--version` with `1.18.34` and `run --help` on stderr; both record argv only (never the environment) before answering, exit 1 silently on anything else, and never stay alive.
- [ ] The composed PATH drops every directory holding a `claude`, `codex`, `kimi`, `opencode` or `grok` executable or shim and puts the stub directory first; the preflight proves `where.exe` resolves `claude` and `opencode` to the stubs only, finds no `codex`, `kimi` or `grok`, and still finds `node` and `git`.
- [ ] The project is a throwaway git repository made active between the runs; the seeded repository row is archived; nothing in run 2 resolves to the user's repository.
- [ ] Every click is asserted in the same evaluation, by its text, and the guard refuses `Launch team`, `Preparing lead…` and anything in `.launch-foot`.
- [ ] Ranked-tier expectations are compared with main's own `routing:tiers` reply, never a golden order (Phase 3 C18).
- [ ] The direct `team.launch` payloads can only be refused: a tier on a model routing does not know, a routing object, a tier on a Claude member.
- [ ] The fake key is built at run time; no key-shaped literal is in the script; nothing prints it.
- [ ] The renderer-error watchers use CDP with positive controls (not Electron's `console-message`, which is event-first on Electron 43).
- [ ] Changes are limited to the one new file; pre-existing work is preserved and not committed.
