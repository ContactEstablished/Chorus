# Model Routing Phase 4a — execution prompt

Paste everything below into a new Claude Code session opened at the repository root.

---

## Role

You are the Coordinator for Chorus Model Routing Phase 4a (interactive launches: the launch-dialog tier picker). Repository root `C:\Projects\ContactEstablished\Chorus`. Expected branch `feature/model-routing`. HEAD should be the commit that added this prompt and the Phase 4a kickoff documents, directly on top of `a57ef1b` ("Mark Model Routing Phase 3 complete"). Confirm with `git branch --show-current` and `git log --oneline -3`; do not switch branches without instruction. Chorus is a local-first Electron + Vue 3 + TypeScript desktop app. Read `CLAUDE.md` first: the stack is locked, ask before adding any dependency, all IPC is Zod-validated in main, renderer→main payloads must be plain objects (runtime-verify every new one), and keys never appear in args, logs, files or transcripts.

## Goal

Make a routing tier change what an interactive OpenCode session sends. When a user launches OpenCode on an OpenRouter API-key credential with a registry model, the launch dialog offers Budget, Balanced, Fast, Nitro and "OpenRouter default" as one choice, preselects the remembered choice, and sends only the tier's name. Main resolves the tier itself (K2), refuses an ineligible or stale one with a stated reason, carries the provider object and, for Nitro, the declared effort variants per process in `OPENCODE_CONFIG_CONTENT` (MR-D3, MR-D4), records the exact selection on the session row (migration v28, MR-D27), remembers the last choice per model (MR-D28), and Relaunch re-applies the selection unchanged. Every OpenCode effort an interactive launch sets now actually applies: Chorus keeps OpenCode's remembered TUI variant in step (MR-D25), and an unrouted `:nitro` launch declares its variants too (K13). **Prime constraints: zero cost throughout (no paid run, no Refresh pressed by any test or drive, no real OpenCode launched by the built-app drive, K11); nothing in Phase 4b's scope (no `TeamLaunchDialog.vue`, Team member or helper routing, re-rank, "Re-rank and relaunch", guardrail revalidation or failover messages, MR-D29).**

## Ground yourself first (read in this order)

1. `CLAUDE.md`.
2. `docs/Features/Model Routing/roadmap.md` — authoritative for MR-D1 to MR-D29 and gates MR-G1 to MR-G8. Read MR-D25–MR-D28, MR-D29 (Phase 4 is split), the Phase 4a section and gates MR-G1–MR-G8.
3. `docs/Features/Model Routing/Tasks/Phase-4a-Overview.md` — grounding table, user decisions MR-D25–MR-D29, kickoff decisions K1–K14, clarifications C1–C44, file ownership, gates, risks, verification commands, handoff.
4. `docs/Features/Model Routing/Tasks/Task-4a-1.md` … `Task-4a-5.md`, each with its paired `docs/Features/Model Routing/ImplementationSpecs/ImplementationSpec-4a-1.md` … `-4a-5.md`. **The specs are normative:** exact contracts, schemas, view models, field names, test tables and expected numbers.
5. Background (never edit): `docs/Features/Model Routing/Phase-0-Findings.md`, `Plan_1.md` §2 "User flow (UI)" and §12, and `ImplementationSpecs/ImplementationSpec-3-1.md` … `-3-4.md` for the Phase 3 contracts.

**Code conventions (verified 2026-10-03 at `a57ef1b`; re-verify, line numbers drift):**

- Tests: `vitest.config.ts` has no globals; import `{ describe, it, expect }` from `'vitest'`. Tests never import `storage.ts`, `vault.ts` or `better-sqlite3` (Electron ABI); use fakes and type-only imports. No `.vue` files are unit-tested, only type-checked (`typecheck:web`).
- Shared code: `src/shared/routingView.ts` is pure (no clock, randomness or I/O; the purity grep covers it, comments included) and imports only from `./routing`. Routing cores in `src/main/routing/*` (the new `launchCore.ts` included) are pure and import only `zod`, `../../shared/routing` and sibling cores. `src/main/adapters/opencodeVariantStateCore.ts` is pure too (no `fs`, clock or `process.env`).
- The preload never calls Zod (MR-G5); `src/preload/index.ts` is type-only for routing.
- The renderer store never calls `.parse` or `.safeParse` (Phase 3 C13), and every payload to main is built with `plainRoutingInput` (a JSON snapshot).
- Components are presentational (Phase 3 C15): they import nothing but Vue and types from `routingView`, read only their props, and emit only their declared events (`refresh`; in 4a-4 also `select` on `RoutingTierCards`, opt-in). No store, no `window.chorus`, no IPC.
- Drive precedents: `scripts/verify-routing-settings-ui.mjs` (built-app CDP drive, seeding, overlays, positive controls) and `scripts/verify-routing-ui.mjs` (isolated harness). `v-model` over CDP needs `.value` plus bubbling `input` and `change` (`scripts/team-member-ui-checks.mjs:7–10`).
- CSS: no new Tailwind utility classes; `settings.css` classes and `main.css` tokens only. `style src` for CSS imported unscoped by multiple SFCs is emitted once.
- Sessions live in main only; the renderer never spawns processes. IPC is Zod-validated in main; payloads are plain objects.

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

The four ` M` files have no content diff (line endings only). The repository is **public** on GitHub: always stage explicit paths, never `git add -A` or `git add .`. If the Phase 4a kickoff documents (`docs/Features/Model Routing/Tasks/Phase-4a-*.md`, `Task-4a-*.md`, `ImplementationSpecs/ImplementationSpec-4a-*.md`) or `roadmap.md` show as untracked or modified, they were meant to be committed with this prompt: stop and ask the user before doing anything else.

## Implementation scope

Execute the tasks in order: 4a-1, 4a-2, 4a-3, then 4a-4, then 4a-5.

### Task 4a-1 — Launch routing contracts and resolution

Files owned: `src/shared/routing.ts` (amendments + the "Phase 4a — launch routing (Task 4a-1)" block) and test; new `src/main/routing/launchCore.ts` and test; `routingService.ts`, `routingStore.ts`, `routingIpc.ts` and their tests; one line in `src/preload/index.ts`; `scripts/verify-routing-ipc.mjs` (D19).

Rules:

- **Amendments to Phase 2 contracts (C1).** `ROUTING_ERROR_CODES` gains `SNAPSHOT_STALE` and `TIER_EMPTY` with exact messages. `ROUTING_CHANNELS` gains `launchPreferences: 'routing:launch-preferences'`. `RoutingApi` gains `launchPreferences(input)`. The preload gains one pass-through line. Recorded amendments (Phase 4a overview table): S4-1 ten → twelve codes; S5-1 ten → eleven channel values; I1 and I4 nine → ten channels; the header "Nine → Ten"; one more `handle(…)` line.
- **Launch routing contracts (K2, K5, K8, C3–C4, C6).** `routingLaunchTierSchema`, `routingLaunchChoiceSchema`, `routingLaunchRequestSchema`, `routingLaunchSelectionSchema` (strict, with cross-field rules), `routingLaunchPreferencesSchema`; `resolveLaunchSelection` (pure, free resolution; Nitro always ok, ranked tiers check snapshot age and emptiness); `buildOpenCodeRoutingContent` and `unroutedNitroVariantsContent` (K6, K13, pure); the pure planners `planRoutingLaunch`, `planRoutingRelaunch`, `checkRoutedRoute` with exact refusal texts.
- **Service (K2, C2, C3, C5, C7).** `RoutingService.resolveLaunch` parses, checks the registry, calls `assertLive`, reads settings and the clock once (`computedAt`), then the stored inputs through `storedRankInputs` (the same read order as `tiers()`); it never reads a credential row, decrypts or fetches; Nitro reads no store file; ranked refusals in the order `NO_SNAPSHOT`, model mismatch, `SNAPSHOT_STALE` (`The endpoint snapshot for this model is more than 60 minutes old. Refresh first.`), `TIER_EMPTY` (`<Tier> has no eligible endpoints. Choose another tier or OpenRouter default.`). `launchPreferences()` and `recordLaunchChoice()` (never throws, writes only on a change, records only a registry slug and a valid choice).
- **Preferences file (K8, C6).** `routing/launch-preferences.json` carries `{"version":1,"lastChoiceByModel":{…}}` on disk; `RoutingStore.readLaunchPreferences` and `writeLaunchPreferences`; atomic write with sorted keys, 65,536-byte cap, missing/corrupt/oversize = empty with one fixed warning; never throws.
- **IPC drive.** `node scripts/verify-routing-ipc.mjs` gains D19 check and freshness strings, becomes `PASS (20 checks)`.
- **Phase 2 and 3 unchanged.** Every existing test passes with its expected values untouched except the recorded amendments. `node scripts/verify-routing-ranker.mjs` still prints `PASS (30 checks)`.

### Task 4a-2 — OpenCode interactive config and the remembered variant

Files owned: new `src/main/adapters/opencodeVariantStateCore.ts`, `opencodeVariantState.ts` and their tests; `src/main/adapters/types.ts` (new types), `opencode.ts` (one env line, one import, one hook); appended blocks in `adapters.test.ts` and `mcpConfigWrite.test.ts`; `scripts/verify-routing-body.mjs` (TUI half rebuilt from real builders, K13 case, MR-D25 case, no report file written).

Rules:

- **Per-process content (MR-D3, K6).** `spec.routing?.configContent` → `envAdditions.OPENCODE_CONFIG_CONTENT`; routed or (K13) unrouted `:nitro`. Never the shared `opencode.json`, argv or a log.
- **Remembered variant (MR-D25, C10–C12).** `writeMcpConfig` keeps OpenCode's `<state home>/opencode/model.json`'s `variant[modelKey]` in step with the effort block when `ctx.cliState` is present. Only 1.18.33, only an existing differing entry, atomic write, never throws. `opencodeStateHome` from `XDG_STATE_HOME` else `USERPROFILE` else `os.homedir()` (HOME ignored). State-home rule measured on 1.18.33.
- **Zero cost.** Real OpenCode 1.18.33 at loopback with isolated XDG state/data; placeholder key; real builders; the user's real `model.json` byte-identical before and after.
- **Script.** TUI cases from `opencodeAdapter.buildLaunch`, `writeMcpConfig`, `composeChildEnv`; only harness patch is loopback `baseURL` and `share: disabled`; helper half unchanged. Report to stdout, evidence directory deleted, new `PASS (16 checks)` convention.

### Task 4a-3 — Launch wiring, migration v28 and relaunch

Files owned: `storage.ts` (v28 migration entry, `createSession` normalisation); `db/schema.ts` (the `routing_json` column), `db/schema.test.ts` (v28 block, column count 19 → 20); `src/shared/ipc.ts` (the `routing_tier` field), `ipc.test.ts`; `src/main/ipc.ts` (the `routing` thunk parameter, `withMcpEnv` composes `cliState`, SessionLaunch plans/resolves/checks/carries/persists/records routing, SessionRelaunch re-applies persisted selection or recomputes K13 variant), `src/main/index.ts` (the thunk), `src/main/services/sessionManager.ts` (`LaunchOptions.routing`); new `sessionManager.routing.test.ts` (Table SM); the D16/freshness edit of `scripts/verify-routing-ipc.mjs`.

Rules:

- **Migration v28 (MR-D27, C18).** `sessions.routing_json` (text, nullable) stores the exact `RoutingLaunchSelection` JSON or NULL. Only a routed launch writes it (never a K13 unrouted `:nitro` launch, an OpenRouter default launch or a refusal); relaunch re-applies it unchanged and never rewrites it (C19). MR-G6: verified in the throwaway profile's own database by the IPC drive's D16 and in memory by the `schema.test.ts` v28 block.
- **Main authority (K2, K3, K7).** Plan and refusal before `resolveCredential`; gateway check after; no decrypt on refusal; `resolveLaunch` is free and deterministic; `recordLaunchChoice` only after `sessions.launch()` returned.
- **Content and variants (K6, K13).** `buildOpenCodeRoutingContent` for a selection; `unroutedNitroVariantsContent` for unrouted `:nitro` with effort (no provider, never persisted); both supplied to `buildLaunch` via `spec.routing?.configContent`.
- **Remembered choice (K8).** `recordLaunchChoice` called only for `'routed'` and `'default'` plans (never K7-blocked); never on relaunch, restart or restore.
- **Relaunch (K10).** Persisted selection parses strictly; credential still eligible; content rebuilt with current catalog efforts; or refused with stated reason, never silent unroute; no re-rank.
- **CLI state (C17, MR-D25).** `withMcpEnv` builds `cliState` only when an effort is set: state home from `composeChildEnv` with credential's name only (no key), version from `detectClis()`.

### Task 4a-4 — The launch-dialog tier picker

Files owned: `src/shared/routingView.ts` (the "Phase 4a — launch (Task 4a-4)" block) and test; new `src/renderer/src/stores/routingLaunch.ts` and test; `src/renderer/src/components/routing/RoutingTierCards.vue` (opt-in `selection` prop and `select` emit); `src/renderer/src/components/LaunchDialog.vue` (byte-safe edits: 7 insertions, 1 replacement); `scripts/verify-routing-ui.mjs` (H16–H20, `PASS (20 checks)`); `scripts/verify-routing-settings-ui.mjs` (the K14 note constant).

Rules:

- **Eligibility mirror (LV2; K3, K7, C29).** The section renders only for a routable launch, in main's order: opencode; a credential listed by `routing:credentials`; a registry model with no `:nitro` suffix; no launch-profile env that sets `OPENCODE_CONFIG_CONTENT`.
- **Launchability (LV3–LV8; MR-D26, C25).** Budget, Balanced and Fast are launchable only on a fresh, non-empty tier; stale reads `Refresh first: the numbers are older than N min.` (stale wins over empty); no snapshot or an empty tier shows the card's own reason; Nitro is always launchable.
- **Preselection (LV9–LV12; K9, MR-D28, C26–C27).** The remembered choice if launchable; Balanced with no memory; otherwise OpenRouter default with a hint (`Refresh to use <Tier>.`); Nitro is never preselected unless remembered; a clicked choice that stops being launchable falls back with `<Tier> can no longer be launched. <reason>`.
- **Store (LS1–LS15; K4, C28, C30, C32).** `useRoutingLaunchStore` ranks with profile `interactive`, the launch's effort and the launch's credential; plain payloads (`plainRoutingInput`, LS13 with a reactive negative control); no timer that calls IPC; never shares state with the Settings store (LS12). A cooldown `BUSY` shows main's message naming the seconds; the live countdown runs only after the dialog's own network-reaching refresh (Phase 3 C12).
- **Dialog (MR-D4, K13, C31, C33–C35).** `routing_tier` only on own-agent routable slots, and never `'default'`; "OpenRouter default" sends no tier; `modelEffortLevels` looks up `routingBaseModelId(model)`; Launch is disabled while routing data loads; `settings.css` is added once (`.set-card-protected` count 1); `LaunchDialog.vue` is edited byte-wise only (seven insertions and one replacement).
- **Cards (C23–C24; MR-D21 kept for Settings).** `RoutingTierCards` gains one opt-in `selection` prop and one `select` emit; "OpenRouter default" is its fifth radio; with no `selection` it renders the Phase 3 DOM exactly, so H1–H15 and the Settings drive keep every expected value. The harness adds H16–H20 (`select-golden.png`, `select-stale.png`).
- **K14 amendment (one string in three places).** `ROUTING_PREVIEW_NOTE` becomes `Launches use a tier only when you choose it in the launch dialog. Team helpers do not use tiers yet.`; RV21 and Settings drive's `PREVIEW_NOTE` constant; Settings drive still `PASS (16 checks)`.

### Task 4a-5 — The built-app launch drive

Files owned: new `scripts/verify-routing-launch.mjs` (L1–L19, `PASS (20 checks)`, stub opencode, zero cost).

Rules:

- **Zero cost and isolation (K11, MR-G3; C36–C38, C44).** No Refresh click; no real OpenCode: a stub `opencode.cmd` → `node <stub>.cjs` first on the app's `PATH` answers `--version` (`1.18.33`) and `run --help` without recording, otherwise records argv and env and stays alive; `requestsSinceStart` stays 0 (L14). The app gets a throwaway `--user-data-dir`, a throwaway `USERPROFILE`/`HOME`/`HOMEDRIVE`/`HOMEPATH` and decoy `XDG_STATE_HOME`/`XDG_DATA_HOME` that must stay empty; the user's real `%USERPROFILE%\.local\state\opencode\model.json` is byte-identical before and after (L17). Two app runs, with the catalog row seeded through `node:sqlite` between them (C36). The drive never opens the Team dialog, and the last-resort kill of a stub is by recorded pid only after `Win32_Process` confirms its command line (L15).
- **Dialog (L3–L5, L9).** The section appears only when eligible (a second, non-routable credential proves the mirror, C41); a directly picked `:nitro` id shows its base model's efforts (L4); Balanced is preselected on a fresh seed; a stale seed disables the ranked cards and falls back to OpenRouter default with `Refresh to use Balanced.`.
- **Launches (L6, L7, L10–L13).** Balanced on a bare credential (`-m openrouter/<slug>`, provider object equal to main's own `routing:tiers` reply, C42); a profile launch and the remembered choice (L7); main refuses a forced ranked tier on a stale snapshot with `The endpoint snapshot for this model is more than 60 minutes old. Refresh first.` (L10); Nitro with an effort (`…:nitro`, `{ data_collection: 'deny' }`, declared variants, MR-D25 patches only the seeded `:nitro` key, L11); OpenRouter default (no `OPENCODE_CONFIG_CONTENT`, remembered `'default'`, L12); a directly picked `:nitro` id with an effort and no tier (variants only, `routing_json` NULL, K13, L13).
- **Persistence (L8, L16).** Relaunch re-applies the stored selection on a stale snapshot with identical content and no re-rank (L8); after exit `schema_migrations` is at 28 and `routing_json` holds the routed selections and NULL elsewhere (L16).
- **Hygiene (L18, L19).** No key material outside the expected env var (positive control: each capture's `OPENROUTER_API_KEY` equals the fake key, C43); no renderer errors, with positive controls for its hooks.

## Fixed expectations

Spec values must match exactly. After Phase 4a:

- `npm run typecheck` and `npm test` pass.
- Ranker: `PASS (30 checks)`.
- IPC drive: `PASS (20 checks)` (with D16 v28 check).
- Body script: `PASS (16 checks)` (real OpenCode 1.18.33, zero cost, real builders).
- UI harness: `PASS (20 checks)` (13 PNGs: Phase 3's eleven plus `select-golden.png` and `select-stale.png`).
- Settings drive: `PASS (16 checks)` (unchanged count, K14 note).
- Launch drive: `PASS (20 checks)` (3 PNGs: fresh, nitro, stale).
- Test baseline before Phase 4a is 138 files and 4,089 tests.

Before Phase 4a the drives print: ranker `PASS (30 checks)`, IPC drive `PASS (19 checks)`, UI harness `PASS (15 checks)`, Settings drive `PASS (16 checks)`; `verify-routing-body.mjs` has no PASS line yet.

The only Phase 1–3 test expectations that change are the recorded amendments in the overview's table: S4-1 ten → twelve error codes; S5-1 ten → eleven channel values; I1 and I4 nine → ten (the channel tables gain the channel; new I12); the `routingIpc.ts` header "Nine" → "Ten"; `storeWith` gains two delegations; the IPC drive 19 → 20 (D19, plus 4a-3's D16 v28 detail); the `schema.test.ts` column count 19 → 20; `RoutingTierCards` gains an opt-in selection mode with the Settings DOM unchanged; `verify-routing-ui.mjs` 15 → 20 checks and 11 → 13 PNGs; K14's preview note in `routingView.ts:46`, RV21 (`routingView.test.ts:727`) and `verify-routing-settings-ui.mjs:68`; `verify-routing-body.mjs` rebuilt on the real builders with a new `PASS (16 checks)` line. If the code disagrees with any other spec value, re-check against the K- and C-rules and report; **never edit an expectation to make a test pass.**

## Strict non-goals

- No `TeamLaunchDialog.vue` change, no Team member or helper routing, helper re-rank, "Re-rank and relaunch", guardrail revalidation or failover messages (Phase 4b, MR-D29). `LaunchDialog.vue` changes only through Task 4a-4's byte-wise edits.
- No tier on launch profiles (MR-D27): `launch_profiles`, "Save as launch profile" and `launchProfileWireSchema` are unchanged.
- SessionRestart and boot restore are unchanged: restart still refuses credentialed sessions, restore still heals them to exited, and neither routes.
- No fix to relaunch's pre-existing use of `provider.model` for unrouted sessions (Phase 4b); only a routed relaunch sets its own sent id.
- No migration or schema change beyond v28.
- No change to any Phase 1–3 export, the golden fixture or golden expectations except recorded amendments; additions only.
- No edits to `Plan_1.md`, `Phase-0-Findings.md`, the council documents or Phase 0–3 docs (except the final docs-update paragraph).
- No new dependencies. No `.vue` unit tests. No network in unit tests.
- No paid run of any kind. MR-G3 for every OpenCode run in a script.
- MR-D17 stays open and untouched.
- Do not touch the pre-existing changes.

## Required workflow

Coordinator pattern for each task, in order 4a-1 → 4a-5: (1) dispatch an implementation worker subagent with the task doc and its spec; (2) spec-compliance review (contracts, schemas, view models, test tables, expected values); (3) code-quality review, with particular attention to IPC hygiene (plain-object payloads, no Zod parsing in the renderer, error codes kept), key handling (`resolveLaunch` reads no credential row, never decrypts and never fetches; the launch's single decrypt stays `resolveCredential`; no secret in the routing content or the state write; keys only as env vars to children), main as the only authority for a tier (K2: no renderer-built provider object crosses IPC), refusals before any decrypt or session row (C16), MR-D25 (only an existing, differing entry; atomic; only on 1.18.33; never the user's real `model.json` in any test or drive), process safety in the drives (own child only by pid, throwaway profile AND throwaway home, free port, no port 9222), byte-safe edits of CRLF and mixed files, and determinism of `launchCore.ts` and `routingView.ts`; (4) resolve findings; (5) run the task's verification commands yourself (re-run the worker's claims; do not accept them on trust); (6) one intentional commit per task, staging explicit paths, message = title, plain-language summary, technical bullets, ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push or open a PR unless explicitly asked.

**Notes for this Windows machine:**

- The Bash tool can collapse backslashes in quoted heredocs: write scripts with the file-write tool and run them by path.
- After editing an existing file, check `git diff --stat` for an unexpected whole-file line-ending rewrite. For the CRLF files (`src/preload/index.ts`, `src/main/services/storage.ts`, `src/shared/ipc.ts`, `src/main/ipc.ts`, `src/main/index.ts`, `src/main/adapters/opencode.ts`, `src/main/adapters/types.ts`, `src/main/adapters/adapters.test.ts`, `src/main/adapters/mcpConfigWrite.test.ts`, `src/main/db/schema.test.ts`, `src/shared/ipc.test.ts`), also `git ls-files --eol <file>` must still report `w/crlf` (with `core.autocrlf` true a CRLF→LF rewrite is invisible to the diff).
- Mixed-ending files: `LaunchDialog.vue` (2,088 CRLF and 7 lone LF at lines 33, 34, 35, 1102, 1103, 1117, 1118; 0 lone CR) is edited byte-wise only, by a scratch Node script that asserts the counts and anchors before writing and reports them after (C35); never with the Edit tool. `src/main/db/schema.ts` (LF only at lines 1–2 and 874–933) and `src/main/services/sessionManager.ts` (LF only at 1079–1085) take CRLF in their edited regions; `git ls-files --eol` must still report `w/mixed` for all three.
- Dev worktrees share one `%APPDATA%` profile; always use a throwaway `--user-data-dir`. Also, when a launch sets an effort, use a throwaway `USERPROFILE` (MR-D25 writes OpenCode state under `os.homedir()`, which follows `USERPROFILE`; OpenCode ignores `HOME`). Never kill `electron.exe` or `Chorus.exe` by name: the user's installed Chorus may be running. Drives kill only their own child by PID.
- Never use port 9222 (another instance may hold it). Dev never rebuilds MAIN on edit, so drives run against `npx electron-vite build` output with a freshness check.
- `verify-routing-body.mjs` launches the real installed OpenCode (must be exactly 1.18.33) against a loopback stand-in with a placeholder key and isolated XDG state and data: zero cost. `verify-routing-launch.mjs` never runs real OpenCode (a stub). Both take a few minutes. Never kill `opencode` by name either.
- Claude Code's auto mode blocks paid runs; no task needs one. No test or drive presses Refresh.

## Verification commands (repository root, PowerShell)

```powershell
npm run typecheck
npm test
Get-ChildItem -Path src/main/routing, src/shared/routing.ts, src/shared/routingView.ts -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern 'Date\.now\(|Math\.random\(|new Date\(\)|from ''(node:|fs''|path''|electron|better-sqlite3)|require\('
Get-ChildItem -Path src/main/routing -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern "from '\.\./(services|db|adapters)/"
Select-String -Path src/shared/routingView.ts -Pattern "from '(?!\./routing')"
Select-String -Path src/shared/routingView.ts, src/renderer/src/stores/routing.ts, src/renderer/src/stores/routingLaunch.ts -Pattern '(?<!Date|JSON)\.(safeParse|parse)\('
Select-String -Path src/main/adapters/opencodeVariantStateCore.ts -Pattern "from 'node:fs'|from 'fs'|Date\.now\(|new Date\(\)|process\.env"
Select-String -Path src/shared/routingView.ts, src/shared/routingView.test.ts, scripts/verify-routing-settings-ui.mjs -Pattern 'Preview only: launches do not use these tiers yet\.'
opencode --version
npx electron-vite build
node scripts/verify-routing-ranker.mjs
node scripts/verify-routing-ipc.mjs
node scripts/verify-routing-ui.mjs
node scripts/verify-routing-settings-ui.mjs
node scripts/verify-routing-body.mjs
node scripts/verify-routing-launch.mjs
Get-ChildItem _verify/routing-ui, _verify/routing-launch
(Select-String -Path out/renderer/assets/*.css -Pattern '\.set-card-protected\s*\{' -AllMatches).Matches.Count
node -e "const b=require('fs').readFileSync('src/renderer/src/components/LaunchDialog.vue');let c=0,l=0,r=0;for(let i=0;i<b.length;i++){if(b[i]===13){if(b[i+1]===10){c++;i++}else r++}else if(b[i]===10)l++}console.log(JSON.stringify({crlf:c,lf:l,cr:r}))"
npm run grep:secrets
git diff --check
git ls-files --eol -- src/main/index.ts src/preload/index.ts src/main/services/storage.ts src/shared/ipc.ts src/shared/ipc.test.ts src/main/ipc.ts src/main/adapters/opencode.ts src/main/adapters/types.ts src/main/adapters/adapters.test.ts src/main/adapters/mcpConfigWrite.test.ts src/main/db/schema.ts src/main/db/schema.test.ts src/main/services/sessionManager.ts src/renderer/src/components/LaunchDialog.vue
git status --short
```

- **Each task** also runs its own commands from its Task doc (Task 4a-1 adds the preload `git diff --stat`/`--eol` checks; 4a-2 adds `opencode --version` and the `--stat`/`--eol` checks of its four CRLF adapter files; 4a-3 adds the `--stat`/`--eol` checks of its eight CRLF and mixed files; 4a-4 adds the `LaunchDialog.vue` byte counts, its `--stat`/`--eol` checks and the CSS count).
- All six `Select-String` lines must print nothing (the last proves the old preview note is gone from all three K14 places). `opencode --version` prints `1.18.33`. The six scripts end `PASS (30 checks)`, `PASS (20 checks)`, `PASS (20 checks)`, `PASS (16 checks)`, `PASS (16 checks)`, `PASS (20 checks)` in order, exit code 0. `_verify/routing-ui` holds Phase 3's eleven PNGs plus `select-golden.png` and `select-stale.png`; `_verify/routing-launch` holds exactly `launch-fresh.png`, `launch-nitro.png`, `launch-stale.png`; no `%TEMP%\chorus-routing-body-*` or `chorus-routing-launch-*` directory remains. The CSS count prints `1`. The `LaunchDialog.vue` counts print 2,088 + inserted lines, 7 LF, 0 CR. `git ls-files --eol` reports `w/crlf` for the first ten files and `schema.test.ts`, and `w/mixed` for `schema.ts`, `sessionManager.ts` and `LaunchDialog.vue`. `npm run grep:secrets` scans `_verify/`, so run it after drives delete their bundles. Look at each screenshot and describe it in one sentence. `npm test` must pass the whole suite. `git status --short` shows the pre-existing entries unchanged.

**Optional user-run manual check (user only; spends well under 1 cent; not required by any gate). The session must not run this; offer it to the user at the end.** Leave the installed Chorus running and stop no process by name. Create a throwaway folder under `%TEMP%` with subfolders `profile` and `home`. Copy `%APPDATA%\chorus-app\chorus.db` (with its `-wal`/`-shm` files if present) and `%APPDATA%\chorus-app\Local State` into `profile`; first check the source database is the one that is growing (several copies exist on this machine). In a new PowerShell window: `$env:REMOTE_DEBUGGING_PORT='9333'; $env:USERPROFILE='<throwaway>\home'; npx electron-vite dev -- "--user-data-dir=<throwaway>\profile"`. Settings → Model routing: refresh DeepSeek V4.1 Flash with the copied OpenRouter credential (up to about $0.05, stated before it runs). Then open the launch dialog: OpenCode, the OpenRouter API-key credential, DeepSeek V4.1 Flash; Balanced is preselected; launch; in the session send `Reply OK`; check OpenRouter's activity page shows the request served by the Balanced primary endpoint. Close the dev app (its own window), then delete the throwaway folder: it holds a decryptable copy of the credential.

## Failure honesty

If a verification command fails for an unrelated environment reason, capture the exact output, explain it, and do not claim success. A passing subset is not a full-suite pass. Never weaken a test or an expectation to get a green result.

## Final report

Report:

- **Status:** DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT or BLOCKED.
- **Files changed** per task, with commit SHAs.
- **Check results:** typecheck result and vitest summary line.
- **The six drives:** full output and exit codes: `PASS (30)`, `PASS (20)`, `PASS (20)`, `PASS (16)`, `PASS (16)`, `PASS (20)`.
- **Screenshots:** one sentence per image from looking at it (13 harness PNGs + 3 launch-drive PNGs).
- **Purity, layering, import, no-parse, secret-scan** results, and the evidence that the user's real `model.json` stayed byte-identical (body script and launch drive).
- **Reviews:** spec-compliance and code-quality outcomes, each finding resolved.
- **Non-goals:** confirmation every one was respected.
- **Contract changes:** the recorded amendments table plus any correction made between tasks.
- **Residual risks.**
- **Final state:** output of `git status --short`.

Then, only if the evidence is present, update docs and commit them separately: `docs/Features/Model Routing/roadmap.md` (the Phase 4a row and section, with SHAs and gate evidence, decisions made, carry-overs to Phase 4b), Status line of `Tasks/Phase-4a-Overview.md` and of each `Task-4a-#.md`, and `Phase-0-Findings.md`'s "how to re-run" line for `verify-routing-body.mjs` (it no longer writes reports to `%TEMP%`; it prints the report and deletes its directory). No Foundation roadmap decision is needed: Phase 4a adds no key-bearing call.
