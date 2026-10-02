# Model Routing Phase 3 — execution prompt

Paste everything below into a new Claude Code session opened at the repository root.

---

## Role

You are the Coordinator for Chorus Model Routing Phase 3 (UI: the routing inspector in Settings). Repository root `C:\Projects\ContactEstablished\Chorus`. Expected branch `feature/model-routing`. HEAD should be the commit that added this prompt and the Phase 3 kickoff documents, directly on top of `5079b5d` ("Mark Model Routing Phase 2 complete and record D214"). Confirm with `git branch --show-current` and `git log --oneline -3`; do not switch branches without instruction. Chorus is a local-first Electron + Vue 3 + TypeScript desktop app. Read `CLAUDE.md` first: the stack is locked, ask before adding any dependency, all IPC is Zod-validated in main, renderer→main payloads must be plain objects (runtime-verify every new one), and keys never appear in args, logs, files or transcripts.

## Goal

Give Phase 2 a screen. Settings gains a **Model routing** section that inspects one registry model: the four tier cards (Budget, Balanced, Fast, Nitro), the all-providers table with exclusion reasons, the snapshot's age, a Refresh action that states its cost before it runs and its spend after, the background-observation consent (MR-D19) and the data-collection opt-in (MR-D11). The cards, the table and the refresh status are reusable presentational components, so Phase 4 can place them in the launch dialog unchanged. **Prime constraint: nothing reaches a launch, and nothing is selectable. Phase 3 does not touch `LaunchDialog.vue` or `TeamLaunchDialog.vue`, adds no migration and changes no OpenCode config (MR-D21). Every check is zero cost (no OpenRouter request, no paid run).**

## Ground yourself first (read in this order)

1. `CLAUDE.md`.
2. `docs/Features/Model Routing/roadmap.md` — authoritative for MR-D1 to MR-D24 and gates MR-G1 to MR-G8. Read MR-D11 (data collection), MR-D18 (key-bearing calls), MR-D19 (consent model), MR-D21–MR-D24 (Phase 3 user decisions, 2026-10-02), the Phase 2 section's "Carried to Phase 3" (two items now resolved by MR-D22 and MR-D23) and the "Phase 3 — UI: the routing inspector in Settings" section.
3. `docs/Features/Model Routing/Tasks/Phase-3-Overview.md` — grounding table (verified at `5079b5d`), the recorded Phase 2 amendments table, user decisions MR-D21–MR-D24, kickoff decisions K1–K10, clarifications C1–C20 (accepted 2026-10-02), file ownership, gates, risks, handoff.
4. `docs/Features/Model Routing/Tasks/Task-3-1.md` … `Task-3-4.md`, each with its paired `docs/Features/Model Routing/ImplementationSpecs/ImplementationSpec-3-1.md` … `-3-4.md`. **The specs are normative:** exact contracts, schemas, view models, field names, test tables and expected numbers.
5. Background (never edit): `docs/Features/Model Routing/Phase-0-Findings.md`, `Plan_1.md` §2 "User flow (UI)" and §12, `ImplementationSpec-2-3.md` and `ImplementationSpec-2-4.md` for the Phase 2 contracts.

**Code conventions (verified 2026-10-02 at `5079b5d`; re-verify, line numbers drift):**

- Tests: `vitest.config.ts` has no globals; import `{ describe, it, expect }` from `'vitest'`. Tests never import `storage.ts`, `vault.ts` or `better-sqlite3` (Electron ABI); use fakes and type-only imports. No `.vue` files are unit-tested, only type-checked (`typecheck:web`).
- Shared code: `src/shared/routingView.ts` is pure (no clock, randomness or I/O; the purity grep covers it: no `Date.now(`, `Math.random(`, `new Date()`, `require(` or `from 'node:` even in comments) and imports only from `./routing`.
- The preload never calls Zod (MR-G5, D14); `src/preload/index.ts` is type-only for routing.
- The renderer store never calls `.parse` or `.safeParse` (C13), and every payload to main is built with `plainRoutingInput` (a JSON snapshot; Pinia state is a Proxy, and `structured clone` rejects proxies without the snapshot; D14).
- Components are presentational (C15): they import nothing but Vue and types from `routingView`, read only their props, and emit only the `refresh` event from the Refresh button. No store, no `window.chorus`, no IPC.
- Settings sections live in `src/renderer/src/views/`; a section and its nav row land in the same change (D76). The isolated harness precedent `scripts/verify-team-review-ui.mjs`; the app-drive precedent `scripts/verify-routing-ipc.mjs`.
- `v-model` over CDP needs `.value` plus `input` and `change` events (scripts/team-member-ui-checks.mjs:7–10).
- CSS: no new Tailwind utility classes (no source scanning dependency in the harness); `settings.css` classes and `main.css` tokens only; the Nitro card's 2 px amber edge uses `--color-state-attention` (#F59E0B).
- The view-model tests build the golden `TierResult` and its variants with `computeTiers` by importing the Phase 1 cores, as `src/main/services/routingIpc.test.ts:55–76` does (ImplementationSpec-3-2 "Golden inputs"); the isolated harness instead bundles the cores in Node (C16). The store tests use `setActivePinia(createPinia())` and `vi.stubGlobal('window', …)` as `stores/team.test.ts`.

**Before any edit,** run `git status --porcelain` and `git log --oneline -3`.

## Pre-existing changes: do not revert, stage, commit or overwrite

At kickoff `git status --porcelain` showed exactly:

```
 M .mcp.json
 M docs/Features/Engine/chorus-engine-spec.md
 M electron-builder.yml
 M package.json
?? docs/troubleshooting/Codex-Lead-Troubleshooting-Handoff-2026-09-30.md
?? docs/troubleshooting/Compatibility-Report.md
?? docs/troubleshooting/Evaluation-Report.md
?? docs/troubleshooting/Implementation-Progress.md
?? docs/troubleshooting/Team-Nitro-Efficiency-Reboot-Handoff-2026-10-01.md
?? docs/troubleshooting/Team-Session-GPT-Troubleshooting-Plan-2026-10-01.md
?? docs/troubleshooting/Usage.md
```

The four ` M` files have no content diff (line endings only). The repository is **public** on GitHub: always stage explicit paths, never `git add -A` or `git add .`. If the Phase 3 kickoff documents (`docs/Features/Model Routing/Tasks/Phase-3-*.md`, `Task-3-*.md`, `ImplementationSpecs/ImplementationSpec-3-*.md`) or `roadmap.md` show as untracked or modified, they were meant to be committed with this prompt: stop and ask the user before doing anything else.

## Implementation scope

Execute the tasks in order: 3-1, 3-2, 3-3, then 3-4.

### Task 3-1 — Main support for the UI

Files owned: `src/main/services/routingService.ts` and test; `routingIpc.ts` and test; `src/shared/routing.ts` (two amendments, one appended block) and test; one line in `src/preload/index.ts`; `scripts/verify-routing-ipc.mjs`.

Rules:

- **Amendments to Phase 2 IPC (C1–C4, MR-D22).** `ROUTING_CHANNELS` gains `credentials: 'routing:credentials'` and `RoutingApi` gains `credentials(input)`. A new `routingCredentialSchema` and `routingCredentialListSchema` are appended to `src/shared/routing.ts` in the "Phase 3 — UI support (Task 3-1)" block. The channel is parsed in and out in main; the preload gains one pass-through line. Recorded amendments (the overview's table lists every one): S5-1 changes from nine to ten channel values; I1 and I4 from eight to nine request channels and responses; `VALID`, `WRONG_TYPE` and `actions` in `routingIpc.test.ts` gain the channel; `RoutingStorageLike` gains `listCredentialProfiles` and `listProviderConfigs`. The preload stays Zod-free. The IPC drive, `verify-routing-ipc.mjs`, gains check D18 and becomes `PASS (19 checks)`.
- **Credentials list (K1, C1).** `routing:credentials` returns `{ credentials: [{ id, label, providerName }] }` where rows pass the pre-decrypt `checkRoutingCredential` (never decrypted), UUIDs only, labels and names scrubbed through `scrubSecrets`, sorted by label then id, and ordered by code unit (`byCodeUnit`). Zero decrypts and zero OpenRouter requests. The channel works after `dispose()`. Its output parse failure is `OPERATION_FAILED`.
- **Cooldown (MR-D22, C2–C3).** `RoutingService.refresh` refuses a refresh of the same model within 60 s of when the previous refresh that reached the network ended, with message exactly `This model was refreshed less than a minute ago. Try again in <n> s.` The refusal is pre-network (no event, no credential read, no decrypt); it sits after the in-flight `BUSY` check. A constructor knob `refreshCooldownMs` (default 60,000, validated 0–60,000 like C21 knobs, never reached from IPC) and a `ROUTING_REFRESH_COOLDOWN_MS` export (C4). Pre-network refusals and observer ticks do not start the cooldown; an observer never reads or writes the cooldown map.
- **Phase 2 unchanged.** S5-1, I1 and I4 are amended only in counts; every other Phase 2 test passes with its expected values untouched. V14, V20, V29 run unchanged (they refresh the same model twice, but the harness passes `refreshCooldownMs: 0` by default).

### Task 3-2 — Renderer data layer and pure view model

Files owned: `src/shared/routingView.ts` and test; `src/renderer/src/stores/routing.ts` and test.

Rules:

- **Pure view model (K2–K9, C5–C14, C20).** Every displayed string is computed from numbers, not from `TierSelection.rationale` or `W1`. Money: `—` for non-finite; `$0.00` for 0; `<$0.0001` below 0.0001; below 1, four decimals with up to two trailing zeros removed; from 1, two decimals (C5). Uptime truncates as `truncatePct` (C6). Notes drop W1 when stale, keep W3 verbatim (C7). Card text is a template over counts, floor and tier weights (C9). Table rows are eligible first in tag order, then excluded in tag order (C10). Progress: estimate appears with `probe-plan` before any `probe` (K3, MR-G7); spend only with `done` or `failed` (K3).
- **Store (K4, C11–C14).** The store reference-counts its progress listener and adopts events only for the model being refreshed while a refresh is running. Every renderer-to-main payload is plain (survives `structuredClone`, with a reactive negative control). Error codes survive; non-reply rejections become `OPERATION_FAILED` with their own message (C14). `setObservation(false, …)` always sends `{ enabled: false, credentialProfileId: null }` (MR-D23).
- **No timer that refreshes or reloads (K3); no clock or I/O in `routingView.ts` (the purity grep covers it).**

### Task 3-3 — Presentational components and the isolated visual harness

Files owned: `src/renderer/src/components/routing/RoutingTierCards.vue`, `RoutingProviderTable.vue`, `RoutingRefreshStatus.vue`; `scripts/verify-routing-ui.mjs`.

Rules:

- **Presentational components (C15).** Props in, `refresh` event and the table toggle the only interactions. No store, no `window.chorus`, no IPC. Every string interpolated only, never `v-html`. Components import only Vue and types from `routingView`. Cards are not selectable (MR-D21). Nitro card has a 2 px amber left edge (`--color-state-attention`) and the label text carries the meaning.
- **Harness (C16).** Computes `TierResult`s in Node from the Phase 1 golden input and its variants, hands them as JSON to the page, and the page builds view models with the real functions. Isolates the build (Tailwind included), renders every state, asserts exact text and structure, saves PNGs, and leaves nothing but the images. Kills only its own child. `PASS (15 checks)`.

### Task 3-4 — Settings → Model routing and the built-app drive

Files owned: `src/renderer/src/views/SettingsRouting.vue`; `src/renderer/src/views/SettingsView.vue` (one import, one member, one nav row, one content line, two comment updates); `scripts/verify-routing-settings-ui.mjs`.

Rules:

- **SettingsRouting.vue (K3, K5, K8–K10, C11, C17–C20).** Mounts on Settings visit, loads the store, keeps a 1 s display clock (never calls IPC; K3). Shows the model (DeepSeek V4.1 Flash), profile, effort caption ("low" fixed; K5), "Refresh with" credential, refresh button with its cost statement and progress, three cards, table, observation toggle and credential select (MR-D19, MR-D23, C11), and data-collection checkbox (MR-D24). Both settings apply immediately with `flashSaved()` after a write main accepted (K9). The section says plainly `Preview only: launches do not use these tiers yet.` (C20).
- **SettingsView.vue edits (C17, D76).** The row and section land together. Six entries now (updated comment). The `v-if` remounts on visit (C17).
- **App drive (K10).** Zero cost, no credential, no key, no network. Builds the app, opens Settings → Model routing in a throwaway `--user-data-dir`, tests empty and seeded states, writes both settings through the real UI, asserts seeded tiers match main's own reply (C18: orders may shift by time-of-day prices, but 14 eligible · 18 excluded, Nitro likely `together` and the three notes are deterministic). Saves three PNGs, makes no OpenRouter request (`requestsSinceStart` stays 0), kills only its own child by pid, touches neither port 9222 nor `%APPDATA%\chorus*`. `PASS (16 checks)`.

## Fixed expectations

Spec values must match exactly. The drive counts `PASS (19 checks)`, `PASS (15 checks)`, `PASS (16 checks)`. The seeded built-app state asserts 14 eligible · 18 excluded, Nitro likely `together`, and exactly three notes: `Account guardrails were not checked; a pinned endpoint may be refused.`, `Data-policy removals were not checked.` and `Limited history: 14 of 14 eligible endpoints have fewer than 3 speed observations.` (the seeded profile has no credential and no cache file). `node scripts/verify-routing-ranker.mjs` must keep printing `PASS (30 checks)`. The test baseline before Phase 3 is 136 files and 4,029 tests.

The only Phase 2 test expectations that change are the recorded amendments: S5-1 nine → ten, I1 and I4 eight → nine, the IPC drive 18 → 19 checks, and the routingService harness default `refreshCooldownMs: 0`. If the code disagrees with any other spec value, re-check the code against the K- and C-rules and report; **never edit an expectation to make a test pass.**

## Strict non-goals

- No `LaunchDialog.vue` or `TeamLaunchDialog.vue` changes, no tier selection anywhere (Phase 4, MR-D21).
- No launch, adapter, OpenCode config or Team wiring (Phase 4).
- No migration or schema change (MR-D20).
- No change to any Phase 1 export, the golden fixture or golden expectations; additions only.
- No edits to `Plan_1.md`, `Phase-0-Findings.md`, the council documents, or Phase 0–2 docs.
- No new dependencies (K2), no `.vue` unit tests, no network in unit tests.
- No paid run of any kind (K10); the optional user-run manual check in Task 3-4 is for the user only.
- MR-D16 and MR-D17 stay open and untouched.
- Do not touch the pre-existing changes.

## Required workflow

Coordinator pattern for each task, in order: (1) dispatch an implementation worker subagent with the task doc and its spec; (2) spec-compliance review (contracts, schemas, view models, test tables, expected values); (3) code-quality review, with particular attention to IPC hygiene (plain-object payloads, no Zod parsing in the renderer, error codes kept), key handling (`routing:credentials` never decrypts; labels scrubbed), process safety in the drives (own child only, throwaway profile, no port 9222), and determinism of the pure view model; (4) resolve findings; (5) run the task's verification commands yourself (re-run the worker's claims; do not accept them on trust); (6) one intentional commit per task, staging explicit paths, message = title, plain-language summary, technical bullets, ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push or open a PR unless explicitly asked.

**Notes for this Windows machine:**

- The Bash tool can collapse backslashes in quoted heredocs: write scripts with the file-write tool and run them by path.
- After editing an existing file, check `git diff --stat` for an unexpected whole-file line-ending rewrite. For the CRLF files (`src/preload/index.ts`, `src/renderer/src/views/SettingsView.vue`), also `git ls-files --eol <file>` must still report `w/crlf` because `core.autocrlf` is true and a CRLF→LF rewrite is invisible to the diff.
- Dev worktrees share one `%APPDATA%` profile; always use a throwaway `--user-data-dir` for app runs. Never kill `electron.exe` or `Chorus.exe` by name: the user's installed Chorus may be running. Drives kill only their own child by PID.
- Never use port 9222 (another instance may hold it); drives pick a free port themselves.
- Dev never rebuilds MAIN on edit, so drives run against `npx electron-vite build` output with a freshness check.

## Verification commands (repository root, PowerShell)

```powershell
npm run typecheck
npm test
Get-ChildItem -Path src/main/routing, src/shared/routing.ts, src/shared/routingView.ts -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern 'Date\.now\(|Math\.random\(|new Date\(\)|from ''(node:|fs''|path''|electron|better-sqlite3)|require\('
Get-ChildItem -Path src/main/routing -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern "from '\.\./(services|db|adapters)/"
Select-String -Path src/shared/routingView.ts -Pattern "from '(?!\./routing')"
node scripts/verify-routing-ranker.mjs
npx electron-vite build
node scripts/verify-routing-ipc.mjs
node scripts/verify-routing-ui.mjs
node scripts/verify-routing-settings-ui.mjs
npm run grep:secrets
git diff --check
git status --short
```

- **Each task** runs its own commands from its Task doc as well (Task 3-1 adds `git diff --stat src/preload/index.ts` and `git ls-files --eol src/preload/index.ts`; Task 3-2 adds a no-Zod-parse grep over `src/shared/routingView.ts` and `src/renderer/src/stores/routing.ts`; Task 3-4 adds the same two checks for `SettingsView.vue`).

All three `Select-String` lines must print nothing. The three drives must end with `PASS (n checks)` and exit code 0: `PASS (19 checks)`, `PASS (15 checks)` and `PASS (16 checks)`. `_verify/routing-ui` holds only the eleven PNGs named in ImplementationSpec-3-3; `_verify/routing-settings-ui` holds only `empty-state.png`, `seeded-cards.png`, `seeded-providers.png`. Look at each screenshot and describe it in one sentence. `npm run grep:secrets` scans `_verify/`, so run it after the scripts delete their bundles. `npm test` must pass the whole suite. `git status --short` must still show the pre-existing entries unchanged.

**Optional user-run manual check (user only; spends up to about 5 cents; not required by any gate). The session must not run this; offer it to the user at the end.** From Task 3-4: leave the installed Chorus running, stop no process by name. Create a throwaway folder under `%TEMP%`. Copy the installed profile's database and Local State into it (`%APPDATA%\chorus-app\chorus.db` with its `-wal`/`-shm` files if present, and `%APPDATA%\chorus-app\Local State`); first check the source database is the one that is growing (several copies exist on this machine). `$env:REMOTE_DEBUGGING_PORT='9333'; npx electron-vite dev -- "--user-data-dir=<throwaway>"`. Settings → Model routing: choose the copied OpenRouter credential under "Refresh with", press Refresh, and watch the estimate line appear before any probe line, then the spend line after `Done` (at most about $0.05). The button then reads `Refresh again in n s` and counts down from about 60. Close the dev app, then delete the throwaway folder.

## Failure honesty

If a verification command fails for an unrelated environment reason, capture the exact output, explain it, and do not claim success. A passing subset is not a full-suite pass. Never weaken a test or an expectation to get a green result.

## Final report

Report:

- **Status:** DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT or BLOCKED.
- **Files changed** in each task, with commit SHAs.
- **Check results:** the typecheck result and the vitest summary line.
- **The three drives:** their full output and exit codes: `PASS (19 checks)`, `PASS (15 checks)`, `PASS (16 checks)`.
- **Screenshots:** one sentence per image from looking at it.
- **Purity, layering and secret-scan** results.
- **Reviews:** spec-review and code-quality outcomes, and how each finding was resolved.
- **Non-goals:** confirmation that every one was respected.
- **Contract changes:** the recorded amendments plus any correction made between tasks.
- **Residual risks.**
- **Final state:** the output of `git status --short`.

Then, only if the evidence is present, update docs and commit them separately: `docs/Features/Model Routing/roadmap.md` (the Phase 3 row and section, with SHAs and gate evidence, decisions made during execution, carry-overs to Phase 4), the Status line of `Tasks/Phase-3-Overview.md` and of each `Task-3-#.md`. No Foundation roadmap decision is needed: Phase 3 adds no key-bearing call, and MR-D22 only narrows MR-D18's class 1 (D214).
