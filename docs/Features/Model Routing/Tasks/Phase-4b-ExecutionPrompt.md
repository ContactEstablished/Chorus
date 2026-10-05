# Model Routing Phase 4b — execution prompt

Paste everything below into a new Claude Code session opened at the repository root.

---

## Role

You are the Coordinator for Chorus Model Routing Phase 4b (Team helper tiers: the per-slot tier dropdown and per-attempt resolution). Repository root `C:\Projects\ContactEstablished\Chorus`. Expected branch `feature/model-routing`. HEAD should be the commit that added this prompt, directly on top of `7ef7c1f` ("Kick off Model Routing Phase 4b: routing tiers for Team helpers"). Releases 0.9.0, 0.9.1 and 0.9.2 are on `main` (`ca889d8`) and were merged into this branch at `70d5dda`; Phase 4a is complete. Confirm with `git branch --show-current` and `git log --oneline -3`; do not switch branches without instruction. Chorus is a local-first Electron + Vue 3 + TypeScript desktop app. Read `CLAUDE.md` first: the stack is locked, ask before adding any dependency, all IPC is Zod-validated in main, renderer→main payloads must be plain objects (runtime-verify every new one), and keys never appear in args, logs, files or transcripts.

## Goal

Make a routing tier change what an OpenCode **Team helper** sends. In the Team dialog, every helper slot that routing can serve — OpenCode on an OpenRouter API-key credential that `routing:credentials` lists, with a registry model in its base or `:nitro` form — gets a tier dropdown: Budget, Balanced, Fast, Nitro or "OpenRouter default". Per MR-D15 a slot on the `:nitro` model starts on Nitro and any other slot on OpenRouter default. The renderer sends only the tier's name, as an optional `routingTier` on that Team member. Main refuses a tier it cannot serve when the team launches, with a stated reason. Before **every** helper attempt, main resolves the tier itself on the `helper` profile for that member's own credential and effort (MR-D32): a ranked tier on numbers older than 60 minutes refuses that attempt before any decrypt or spawn, and Nitro always resolves. Main records the exact selection on the attempt and carries the provider object (or Nitro's `data_collection: deny`) per process in the helper's `OPENCODE_CONFIG_CONTENT`, merged into the model entry the helper already declares, so its measured options (the `:nitro` low variant, the 64k cap, `--agent build`) are kept. A routed attempt that fails with OpenCode's generic provider error names its tier and suggests a refresh or another tier; Chorus never switches a tier on its own. The Settings preview note changes, because Team helpers now use tiers. **Prime constraints: zero cost throughout (no paid run, no Refresh pressed by any test, harness or drive, no OpenCode request beyond the loopback stand-in, and no real lead or helper CLI started by any check). No interactive re-rank: "Re-rank and relaunch" is Phase 5 (MR-D33). No launch-profile tiers (MR-D27). No automatic key-bearing guardrail revalidation: Phase 4b adds no key-bearing call at all (MR-D18/D214 unchanged; `resolveLaunch` never decrypts). MR-D17 stays open. No remembered tier for helpers.**

## Ground yourself first (read in this order)

1. `CLAUDE.md`.
2. `docs/Features/Model Routing/roadmap.md` — authoritative for MR-D1 to MR-D33 and gates MR-G1 to MR-G8. Read MR-D15, MR-D30–MR-D33, the Phase 4b section and gates MR-G1–MR-G8.
3. `docs/Features/Model Routing/Tasks/Phase-4b-Overview.md` — grounding table, user decisions MR-D15 and MR-D30–MR-D33, kickoff decisions K1–K16, clarifications C1–C22, questions Q1–Q8 and answers, file ownership, gates, risks, verification commands, handoff.
4. `docs/Features/Model Routing/Tasks/Task-4b-1.md` … `Task-4b-4.md`, each with its paired `docs/Features/Model Routing/ImplementationSpecs/ImplementationSpec-4b-1.md` … `-4b-4.md`. **The specs are normative:** exact contracts, schemas, view models, field names, test tables and expected numbers.
5. Background (never edit): Phase 4a (already complete), `docs/Features/Model Routing/Phase-0-Findings.md`, and `Plan_1.md` §12 "Runtime failover" (which this phase supersedes).

**Code conventions (verified 2026-10-05 at `70d5dda`; re-verify, line numbers drift):**

- Tests: `vitest.config.ts` has no globals; import `{ describe, it, expect }` from `'vitest'`. Tests never import `storage.ts`, `vault.ts` or `better-sqlite3` (Electron ABI); use fakes and type-only imports. No `.vue` files are unit-tested, only type-checked (`typecheck:web`).
- Shared code: `src/shared/routingView.ts` is pure (no clock, randomness or I/O; the purity grep covers it, comments included) and imports only from `./routing`. Routing cores in `src/main/routing/*`, the new `helperRoutingCore.ts` included, are pure and import only `zod`, `../../shared/routing` and sibling cores (the purity and layering greps cover them, comments included).
- The preload never calls Zod (MR-G5); `src/preload/index.ts` is type-only for routing.
- The renderer store never calls `.parse` or `.safeParse` (Phase 3 C13), and every payload to main is built with `plainRoutingInput` or `plainTeamInput` (a JSON snapshot).
- Components are presentational (Phase 3 C15): they import nothing but Vue and types from `routingView`, read only their props, and emit only their declared events. No store, no `window.chorus`, no IPC.
- Drive precedents: `scripts/verify-routing-launch.mjs` (built-app CDP drive with a stub CLI on a composed PATH, throwaway profile and home, two app runs around a `node:sqlite` seed, pid-only kills, unique capture names, positive controls, key scan) and `scripts/verify-team-storage.mjs` (an Electron-hosted harness over the real storage). `v-model` over CDP needs `.value` plus bubbling `input` and `change`.
- CSS: no new Tailwind utility classes; `settings.css` classes and `main.css` tokens only. `style src` for CSS imported unscoped by multiple SFCs is emitted once.
- Sessions live in main only; the renderer never spawns processes. IPC is Zod-validated in main; payloads are plain objects.

**Before any edit,** run `git status --porcelain` and `git log --oneline -3`.

## Pre-existing changes: do not revert, stage, commit or overwrite

At kickoff `git status --porcelain` showed exactly:

```
 M .mcp.json
 M docs/Features/Engine/chorus-engine-spec.md
 M electron-builder.yml
?? docs/troubleshooting/Codex-Lead-Troubleshooting-Handoff-2026-09-30.md
?? docs/troubleshooting/Compatibility-Report.md
?? docs/troubleshooting/Evaluation-Report.md
?? docs/troubleshooting/Implementation-Progress.md
?? docs/troubleshooting/Team-Nitro-Efficiency-Reboot-Handoff-2026-10-01.md
?? docs/troubleshooting/Team-Session-GPT-Troubleshooting-Plan-2026-10-01.md
?? docs/troubleshooting/Usage.md
```

The three ` M` files have no content diff (line endings only). The repository is **public** on GitHub: always stage explicit paths, never `git add -A` or `git add .`. If any Phase 4b kickoff document (`Tasks/Phase-4b-*.md`, `Task-4b-*.md`, `ImplementationSpecs/ImplementationSpec-4b-*.md`) or `roadmap.md` shows as modified or untracked, they were meant to be committed with this prompt: stop and ask the user before doing anything else.

## Implementation scope

Execute the tasks in order: 4b-1, 4b-2, 4b-3, then 4b-4.

### Task 4b-1 — Helper routing contracts, resolution and the helper's OpenCode content

Files owned: `src/shared/routing.ts` (the `profile` field only) and test; `src/shared/team.ts` (two fields and a refine) and new `src/shared/team.test.ts`; new `src/main/routing/helperRoutingCore.ts` and test; `src/main/services/routingService.ts` (one-expression change) and test; `src/main/adapters/helpers/types.ts` (`HelperExecutionInput.routing?`), `opencode.ts` (the sent id and the routed model entry), `common.ts` (the probe reads stderr, byte-wise), and appended block in `helpers.test.ts`; new `src/main/adapters/helpers/probe.test.ts`; `scripts/verify-routing-body.mjs` (the helper half rebuilt with the real builder and helper-profile selections, a third unrouted control run, `PASS (18 checks)`).

Rules:

- `routingLaunchRequestSchema.profile` (optional, absent = `'interactive'`).
- `memberFields.routingTier: routingLaunchTierSchema.optional()`, placed last; `teamMemberSchema`'s refine adds: a `routingTier` requires `harness === 'opencode'` and `authMode === 'api_key'`.
- `teamAttemptSchema.routing: routingLaunchSelectionSchema.optional()`, placed last.
- `resolveLaunch` ranks with `q.profile ?? 'interactive'`; no other change.
- Pure `helperRoutingCore.ts`: `HELPER_ROUTING_REFUSALS`, `planHelperRouting`, `helperAttemptRefusal`, `helperRoutedModelEntry`, `routedHelperFailureNote`.
- `HelperExecutionInput.routing?: RoutingLaunchSelection`, set by main only and read only by the OpenCode helper.
- The helper builder computes `--model` and its model entry from the sent id, keeps measured options, and refuses a mismatched selection. Unrouted requests are byte-identical to `70d5dda`'s.
- The body script runs the helper Balanced provider object exactly as computed from a `:nitro` member and Nitro from a standard member, plus an unrouted control.

### Task 4b-2 — Helper execution wiring and the main-process Team harness

Files owned: new `src/main/services/teamRouting.ts` (exact code in spec) and test; `src/main/services/teamService.ts` (the routing dependency, checks at `team:launch` and before each attempt, the K12 note); `src/main/services/teamStorage.ts` (one immutability rule); `src/main/services/teamRuntime.ts` (optional routing dependency and port); one property in `src/main/index.ts`; new `scripts/verify-routing-team.mjs` (launcher) and `scripts/verify-routing-team.ts` (driver; the harness; re-runs `verify-team-storage.mjs` unchanged).

Rules:

- Main checks a helper's tier at `team:launch` and refuses one it cannot serve before any storage with `ROUTING_REFUSED` code and `Helper "<label>": <reason>` message.
- Before every routed helper attempt: resolve after the fence checks and immediately before `credentials.resolve`, record `helper-routing-resolved` before the decrypt, a stale ranked tier refuses that attempt with stated reason and no spawn.
- A recorded `routing` never changes (`IMMUTABLE_ATTEMPT`).
- A routed provider-error attempt's blocker includes the C3 note naming the tier.
- `verify-routing-team.mjs` `PASS (16 checks)`: setup, refusals, tier names stored and returned, Balanced from `:nitro`, Nitro from standard, the `helper-routing-resolved` event, stale refusal, new numbers and revised task, unavailable routing, the K12 note, immutability and secret-free, key scan, cleanup.

### Task 4b-3 — The Team dialog's per-slot tier

Files owned: `src/shared/routingView.ts` (the K13 note, a "Phase 4b — Team helpers" block, `ROUTING_HELPER_PROFILE` and the helper view functions) and test; new `src/renderer/src/stores/routingTeam.ts` (the helper store) and test; new `src/renderer/src/components/routing/HelperTierSelect.vue` (presentational); `src/renderer/src/components/TeamLaunchDialog.vue` (byte-safe edits: six insertions, ten in-line replacements); `scripts/verify-routing-settings-ui.mjs` (one line: K13).

Rules:

- One tier dropdown per eligible OpenCode helper slot (OpenRouter API key; the base model is a registry slug).
- Five options: Budget, Balanced, Fast, Nitro, OpenRouter default, in that order.
- Default: Nitro for `:nitro` models, OpenRouter default otherwise (K10).
- Ranked tiers disabled with 4a's reasons when stale, empty or snapshot-missing; Nitro and OpenRouter default always enabled.
- The renderer sends only `routingTier` for a tier, never OpenRouter default, never a `routing` object.
- Presets restore tiers; a restored ranked tier now unlaunchable falls back to OpenRouter default with 4a's hint.
- Launch and Save preset wait for routing data; a load failure hides every dropdown.
- K13: `ROUTING_PREVIEW_NOTE` becomes `Launches use a tier only when you choose one: in the launch dialog, or for each helper in the Team dialog.`; it appears at `routingView.ts:50`, `routingView.test.ts:747` (RV21) and `verify-routing-settings-ui.mjs:68` (`PREVIEW_NOTE`).
- The store `useRoutingTeamStore`: per-key ranking, no preferences, no refresh, no writes.
- The select's accessible name: `Routing tier for helper N` (never `Helper …`), so it does not match existing slot-counting greps.
- `TeamLaunchDialog.vue` is edited byte-wise only: it starts at 118 CRLF / 0 lone LF / 0 lone CR and ends all-CRLF with the counts its spec states (179 CRLF, 0 LF, 0 CR); `git ls-files --eol` stays `w/crlf`.

### Task 4b-4 — The built-app Team dialog drive

Files owned: new `scripts/verify-routing-team-ui.mjs` (freshness, throwaway root, composed PATH, stubs, preflight, two runs around a database seed, checks TU1–TU15, `PASS (15 checks)`, 2 PNGs in `_verify/routing-team-ui/`).

Rules:

- Launch only the built app in a throwaway profile, home and git project; never launch a team or click Launch.
- Stub `claude` (answers `--version` with `2.1.278 (Claude Code)` and `--help`) and `opencode` (answers `--version` with `1.18.34` and `run --help` on stderr); they record argv only, never stay alive.
- Compose PATH dropping every directory holding `claude`, `codex`, `kimi`, `opencode` or `grok`; preflight proves stubs are first and `codex`, `kimi`, `grok` are not found.
- Dropdowns on routable OpenCode slots only, five options in order, presets per K10, ranked tiers disabled when stale or empty, Save preset stores only `routingTier`, direct `team.launch` refusals with `ROUTING_REFUSED` code and C1 texts before any run/task/attempt/event row.
- The user's real `model.json` and repository untouched; no key material in any capture, log or page text; `requestsSinceStart` 0.

## Fixed expectations

Spec values must match exactly. After Phase 4b:

- `npm run typecheck` and `npm test` pass.
- Test baseline: 144 files / 4,236 tests before 4b; 147 / 4,273 after 4b-1; 148 / 4,281 after 4b-2; 149 / 4,304 after 4b-3; 4b-4 adds none.
- Ranker: `PASS (30 checks)`.
- IPC drive: `PASS (20 checks)` (unchanged).
- UI harness: `PASS (20 checks)` (unchanged, 13 PNGs).
- Settings drive: `PASS (16 checks)` (unchanged count, K13 note).
- Launch drive: `PASS (20 checks)` (unchanged, 3 PNGs).
- Body script: `PASS (18 checks)` (after 4b-1; unchanged by 4b-2–4b-4).
- Team harness: `PASS (16 checks)` (new in 4b-2).
- Team regression verifier: `"passed": true` (runs before/after 4b-2; unchanged v28).
- Team dialog drive: `PASS (15 checks)` (new in 4b-4; 2 PNGs).
- Team review-UI harness: unchanged.

## Recorded contract amendments to Phases 1–4a

These are contract changes, made on purpose and listed here so that no test edit reads as "changing an expectation to make a test pass".

- `routingLaunchRequestSchema` gains `profile: routingProfileIdSchema.optional()`; absent means `'interactive'`.
- `RoutingService.resolveLaunch` ranks with `q.profile ?? 'interactive'`.
- `memberFields` gains `routingTier` (optional); the member refine limits it to OpenCode on an API key.
- `teamAttemptSchema` gains `routing` (optional).
- `HelperExecutionInput` gains `routing?`; the OpenCode helper computes the model entry from the sent id; an unrouted request is byte-identical.
- `probeHelper` reads stdout and stderr for the help call only.
- `verify-routing-body.mjs`'s helper half uses the real helper builder; checks become `PASS (18 checks)`.
- 4a K14's preview note is replaced (K13).

**Never edit an expectation to make a test pass.**

## Strict non-goals

- No `TeamLaunchDialog.vue` change beyond Task 4b-3's byte-wise edits.
- No "Re-rank and relaunch" for interactive sessions (Phase 5, MR-D33).
- Helpers re-rank only through each attempt's own resolution (MR-D32). There is no other automatic re-rank, and Chorus never switches a helper to Nitro or to default on its own.
- No automatic key-bearing guardrail revalidation (MR-D12; MR-D18/D214 unchanged).
- No Refresh in the Team dialog.
- No raw OpenCode error text for helpers (Phase 5).
- No tier shown in the Team panel.
- No tier on launch profiles (MR-D27): `launch_profiles` are unchanged.
- SessionRestart and boot restore are unchanged: restart still refuses credentialed sessions, restore still heals them.
- No fix to relaunch's pre-existing use of `provider.model` for unrouted sessions; only a routed relaunch sets its own sent id.
- No migration or schema change beyond v28 (Phase 4a).
- No change to any Phase 1–4a export, golden fixture or golden expectations except recorded amendments; additions only.
- No edits to `Plan_1.md`, `Phase-0-Findings.md`, the council documents or Phase 0–4a docs (except the final docs-update paragraph at phase end).
- No new dependencies. No `.vue` unit tests. No network in unit tests.
- No paid run of any kind. MR-G3 for every OpenCode run in a script.
- MR-D17 stays open and untouched.
- Do not touch the pre-existing changes.

## Required workflow

Coordinator pattern for each task, in order 4b-1 → 4b-2 → 4b-3 → 4b-4: (1) dispatch an implementation worker subagent with the task doc and its spec; (2) spec-compliance review (contracts, schemas, view models, test tables, expected values); (3) code-quality review, with particular attention to IPC hygiene (plain-object payloads, Zod only in main, `routingTier` the only renderer-sent routing field, the strict member schema rejecting a renderer `routing` object), key handling (routing resolution never decrypts; a refusal precedes `credentials.resolve`; no secret in attempt records, events or helper config), main as the only authority for a tier (K2: no renderer-built provider object crosses IPC), per-attempt freshness and refusal texts exact, attempt-record immutability, process safety in the harness and drive (own child by pid, throwaway profile AND home, free port, never 9222, stub CLIs on a composed PATH, no click on Launch), byte-safe edits of CRLF/mixed files, determinism of `helperRoutingCore.ts` and `routingView.ts`; (4) resolve findings; (5) run the task's verification yourself (re-run workers' claims); (6) one intentional commit per task, explicit paths, message = title + plain-language summary + technical bullets, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push or open a PR unless explicitly asked.

**Notes for this Windows machine:**

- The Bash tool can collapse backslashes in quoted heredocs: write scripts with the file-write tool and run them by path.
- Line endings: `core.autocrlf=true`, no `.gitattributes`; after the 0.9.x branch checkouts most files are CRLF in the working tree over an LF index. `src/main/adapters/helpers/common.ts` is mixed (95 CRLF, lone LF on lines 21 and 22, 0 lone CR, 9,363 bytes) and `TeamLaunchDialog.vue` is CRLF: edit both byte-wise with a scratch Node script that asserts anchors and counts before writing, exactly as their specs describe. After every edit check `git diff --stat` for whole-file rewrites and `git ls-files --eol` for an unchanged `w/…` value.
- Always use a throwaway `--user-data-dir`. Also, for anything that launches a CLI, use a throwaway `USERPROFILE` whose home contains empty `AppData\Roaming` and `AppData\Local` folders (Chorus aborts startup otherwise). Never kill `electron.exe`, `Chorus.exe`, `opencode`, `claude`, `codex` or `node` by name: the user's installed Chorus 0.9.2 may be running. Kill only your own child by pid, and a stub last-resort only after `Win32_Process` (by ProcessId) confirms its command line. Never use port 9222.
- Dev never rebuilds MAIN on edit, so drives run against `npx electron-vite build` output with freshness checks. Launch the built app with `.\node_modules\.bin\electron.cmd .` (PowerShell swallows the `--` in `npx electron-vite dev -- …`).
- Installed CLIs: OpenCode 1.18.34, Claude Code 2.1.289, Codex 0.160.0. Chorus gates on EXACT versions. Every OpenCode process a check starts must carry `OPENCODE_DISABLE_AUTOUPDATE=true` (its TUI upgrades the installed binary about a second after start otherwise). Run `claude` and `codex` only with `--version` / `--help` / `<subcommand> --help`: `claude help <x>` is treated as a PROMPT and spends a real subscription turn.
- `verify-routing-body.mjs` launches the real OpenCode 1.18.34 against a loopback stand-in with a placeholder key and isolated XDG state and data (zero cost, ~60 s); it waits for the `Ask anything` prompt before typing. The new harness and UI drive run no real CLI. The user's real `%USERPROFILE%\.local\state\opencode\model.json` must stay byte-identical: SHA-256 `1599A3F22B9BDCE3BD3538B42481FD20EA061DE40FB6C5F42872373472187948` before and after every check that starts OpenCode.
- `verify-team-storage.mjs` (~3 min, Electron-hosted, zero cost) leaves a `%TEMP%\chorus-team-storage-*` directory (pre-existing behaviour; dozens of old ones exist): list before, delete only the one your run creates.
- Claude Code's auto mode blocks paid runs; no task needs one. No check presses Refresh.

## Verification commands (repository root, PowerShell)

```powershell
npm run typecheck
npm test
Get-ChildItem -Path src/main/routing, src/shared/routing.ts, src/shared/routingView.ts -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern 'Date\.now\(|Math\.random\(|new Date\(\)|from ''(node:|fs''|path''|electron|better-sqlite3)|require\('
Get-ChildItem -Path src/main/routing -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern "from '\.\./(services|db|adapters)/"
Select-String -Path src/shared/routingView.ts -Pattern "from '(?!\./routing')"
Select-String -Path src/shared/routingView.ts, src/renderer/src/stores/routing.ts, src/renderer/src/stores/routingLaunch.ts, src/renderer/src/stores/routingTeam.ts -Pattern '(?<!Date|JSON)\.(safeParse|parse)\('
Select-String -Path src/shared/routingView.ts, src/shared/routingView.test.ts, scripts/verify-routing-settings-ui.mjs -Pattern 'Team helpers do not use tiers yet\.'
$env:OPENCODE_DISABLE_AUTOUPDATE = 'true'; opencode --version
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
Get-ChildItem _verify/routing-ui, _verify/routing-launch, _verify/routing-team-ui
npm run grep:secrets
git diff --check
git ls-files --eol -- src/shared/routing.ts src/shared/routing.test.ts src/shared/team.ts src/main/services/routingService.ts src/main/services/routingService.test.ts src/shared/routingView.test.ts src/main/adapters/helpers/types.ts src/main/adapters/helpers/opencode.ts src/main/adapters/helpers/common.ts src/main/adapters/helpers/helpers.test.ts src/main/services/teamService.ts src/main/services/teamStorage.ts src/main/services/teamRuntime.ts src/main/index.ts src/shared/routingView.ts src/renderer/src/components/TeamLaunchDialog.vue scripts/verify-routing-body.mjs scripts/verify-routing-settings-ui.mjs
git status --short
```

- All five `Select-String` lines print nothing (the last proves 4a K14's note is gone from all three places). `opencode --version` prints `1.18.34`. The eight routing scripts end, in order, `PASS (30 checks)`, `PASS (20 checks)`, `PASS (20 checks)`, `PASS (16 checks)`, `PASS (18 checks)`, `PASS (20 checks)`, `PASS (16 checks)` and `PASS (15 checks)`, each with exit code 0; `verify-team-storage.mjs` prints a report with `"passed": true` and exits 0; `verify-team-review-ui.mjs` passes as before the phase. `_verify/routing-ui` still holds its 13 PNGs, `_verify/routing-launch` its 3, and `_verify/routing-team-ui` exactly `team-tiers-fresh.png` and `team-tiers-stale.png`; no `%TEMP%\chorus-routing-body-*`, `chorus-routing-launch-*` or `chorus-routing-team-*` directory remains. `git ls-files --eol` reports `w/lf` for `helpers/types.ts`, `w/mixed` for `common.ts`, and `w/crlf` for the rest. `npm run grep:secrets` scans `_verify/`, so run it after the drives have deleted their bundles. `git status --short` must still show the pre-existing entries above, unchanged. Record actual exit codes and output; a passing subset is not a full-suite pass.

## Failure honesty

If a verification command fails for an unrelated environment reason, capture the exact output, explain it, and do not claim success. A passing subset is not a full-suite pass. Never weaken a test or an expectation to get a green result.

## Final report

Report:

- **Status:** DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT or BLOCKED.
- **Files changed** per task, with commit SHAs.
- **Check results:** typecheck result and vitest summary line.
- **The eight routing scripts:** full output and exit codes: `PASS (30)`, `PASS (20)`, `PASS (20)`, `PASS (16)`, `PASS (18)`, `PASS (20)`, `PASS (16)`, `PASS (15)`.
- **Team checks:** `verify-team-storage.mjs` result, `verify-team-review-ui.mjs` result.
- **Screenshots:** one sentence per image from looking at it (13 harness PNGs + 3 launch-drive PNGs + 2 team-UI PNGs).
- **Purity, layering, import, no-parse, secret-scan** results, and the evidence that the user's real `model.json` stayed byte-identical (body script and UI drive).
- **Reviews:** spec-compliance and code-quality outcomes, each finding resolved.
- **Non-goals:** confirmation every one was respected.
- **Contract amendments:** the recorded amendments table plus any correction made between tasks.
- **Residual risks.**
- **Final state:** output of `git status --short`.

Then, only if the evidence is present, update docs and commit them separately: `docs/Features/Model Routing/roadmap.md` (the Phase 4b row and section, with SHAs and gate evidence, decisions made, carry-overs to Phase 5), Status line of `Tasks/Phase-4b-Overview.md` and each `Task-4b-#.md`, and `Phase-0-Findings.md`'s "how to re-run" sentence for `verify-routing-body.mjs` (it now ends `PASS (18 checks)`). No Foundation roadmap decision is needed: Phase 4b adds no key-bearing call.

## Optional user-run manual check (user only; not required by any gate)

The session must not run this; offer it to the user at the end. It runs on the installed Chorus after this phase ships as a release, with the user's own profile.

1. Open Settings → Model routing. Refresh DeepSeek V4.1 Flash with the OpenRouter API-key credential. This can spend up to about $0.05, and the estimate is shown before anything is spent.
2. Open the Team dialog. On an OpenCode DeepSeek helper slot, choose Balanced, then launch a small Team task.
3. On OpenRouter's activity page, check that the helper's requests were served by the tier's primary endpoint.

The lead runs on the user's subscription. The helper's turns cost a few cents on OpenRouter.
