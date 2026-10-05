# Task 4b-1 — Helper routing contracts, resolution and the helper's OpenCode content

**Status:** Not started.\
**Depends on:** Phase 4a complete; releases 0.9.1 (`85274a2`) and 0.9.2 (`ca889d8`) merged into `feature/model-routing` (`70d5dda`).\
**Paired specification:** [ImplementationSpec-4b-1](../ImplementationSpecs/ImplementationSpec-4b-1.md)

## Source Of Truth

[Feature roadmap](../roadmap.md) (MR-D3, MR-D4, MR-D10, MR-D11, MR-D15, MR-D26, MR-D31, MR-D32; gates MR-G1–MR-G5, MR-G8), the [Phase 4b overview](Phase-4b-Overview.md) (K1–K7, K15, K16 and clarifications C1–C6, C17; it is normative for names, texts, order and ownership), the paired specification, [ImplementationSpec-4a-1](../ImplementationSpecs/ImplementationSpec-4a-1.md) (`resolveLaunch`, the selection schema, `LAUNCH_TIER_LABELS`), [ImplementationSpec-4a-2](../ImplementationSpecs/ImplementationSpec-4a-2.md) (the body script), [Phase-0-Findings](../Phase-0-Findings.md) rows (a) and (b), and repository CLAUDE.md (Zod on every IPC boundary, in main; keys only as env vars into the child; verify CLI behaviour against the installed tool).

## Initial Starting Point

Branch `feature/model-routing` at `70d5dda`, verified 2026-10-05 by opening each file. `npm test`: 144 files, 4,236 tests, all passing.

- `src/shared/routing.ts` (CRLF, 668 lines) imports only `zod` (:1). `ROUTING_PROFILE_IDS` is `['interactive', 'helper']` (:25) and `routingProfileIdSchema` (:26); the helper profile (:196–203) has `minMaxCompletion` 64000. `routingBaseModelId` (:604–606). `routingLaunchRequestSchema` (:619–624) is strict `{ model, tier, effort, credentialProfileId }` with no profile. `routingLaunchSelectionSchema` (:634–661) is strict with 4a's cross-field refines. S7-4 (`routing.test.ts:422–435`) refuses `{ extra: 1 }`; the file ends at :493.
- `src/shared/team.ts` (CRLF, 227 lines; 0.9.2 shifted it by three lines) imports only `zod` and `./teamProfiles` (:1–2). `memberFields` (:26–32) has no routing field; `teamMemberSchema` is strict with a `superRefine` (:33–36); the lead refine excludes OpenCode (:40); `teamAttemptSchema` is strict (:149–158), its last line `artifact … blocker` at :157. **No `src/shared/team.test.ts` exists.**
- `src/main/services/routingService.ts` (CRLF): `LAUNCH_PROFILE = 'interactive'` (:186–187); `resolveLaunch` (:382–400) parses (:384), reads settings and one clock value (:387–388) and ranks a ranked tier with `profile: LAUNCH_PROFILE` (:392). Table V4 (`routingService.test.ts:1645–2046`) ends at V59; `GOLDEN_TIERS.helper` (:85–89, inside `GOLDEN_TIERS` :79–90) already holds the helper orders.
- `src/main/routing/launchCore.ts`: `LAUNCH_TIER_LABELS` (:34), `LAUNCH_MESSAGES` (:37), `resolveLaunchSelection` (:59–91; Nitro always ok :67–73). Unchanged by this task.
- `src/main/adapters/helpers/types.ts` (**LF**): `HelperExecutionInput` (:21–43), `allowedCommands` (:41), `signal` (:42); no routing field.
- `src/main/adapters/helpers/opencode.ts` (CRLF, 50 lines): `modelId = normalizeTeamModel(input.model)` (:16); `modelOptions` declares `variants.low` only when that id is `defaultTeamHelperModel` on a measured version (:21–23); `measuredCodeHelper` reads `isDeepSeekFlashHelperModel(input.model)` (:24); `--model` (:25), `--agent build` (:26), `--variant` (:27–30), the 64k cap (:41), `OPENCODE_CONFIG_CONTENT` with `provider.openrouter.models[modelId] = modelOptions` (:42). No provider-object path.
- `src/main/adapters/helpers/common.ts` (**mixed**: 95 CRLF, lone LF on lines 21 and 22, 9,363 bytes): `probeHelper` (:65–97); `run` resolves stdout only (:82–84); the help call (:86) therefore reads nothing for OpenCode 1.18.34, whose `run --help` prints 0 bytes on stdout and 3,053 on stderr (measured at `0666f58`; same binary today). Its only consumer, `applyVerifiedHelperEvidence` (`evidence.ts:46–59`), promotes only `VERIFIED_HELPER_VERSIONS` (OpenCode 1.18.31).
- `src/main/adapters/helpers/helpers.test.ts` (CRLF) ends at :210; its DeepSeek budget test (:18–39) pins today's helper request. No probe test exists.
- `scripts/verify-routing-body.mjs` (CRLF, 294 lines): the helper half builds through `opencodeHelper.buildExecution` (`helperRequest` :88–98) and then patches a hand-picked provider object (`ROUTE` :64) into the model entry (:95); two helper runs (:238–239); checks 1–4 (:256–259); `PASS (${checks.length} checks)` = 16 (:293).
- `OPENCODE_DISABLE_AUTOUPDATE=true opencode --version` prints `1.18.34` (2026-10-05).
- The worktree has the pre-existing changes listed in the overview.

## Goal

Give main everything a routed Team helper needs except the wiring (K1): a helper-profile resolution (`resolveLaunch` with `profile: 'helper'`, K5), the tier name on a member and the selection on an attempt with their schema rules (K2, K3), the pure rules for eligibility, refusals, the helper's model entry and the failure note (C1–C4), and an OpenCode helper builder that sends the selection's id with its provider object while keeping every measured option and leaving an unrouted request byte-identical (K6, K7, C6). Fix the probe's stderr blind spot (K15). Prove the helper content against the real OpenCode at a loopback stand-in with the real builder (MR-G2, C17).

## Exact Scope

- `src/shared/routing.ts`: `routingLaunchRequestSchema.profile` (one line and a comma).
- `src/shared/routing.test.ts`: append Table S8.
- `src/shared/team.ts`: the `./routing` import, `memberFields.routingTier`, the member refine line, `teamAttemptSchema.routing`.
- New `src/shared/team.test.ts` (Table TS).
- New `src/main/routing/helperRoutingCore.ts` (exact code in the specification) and `helperRoutingCore.test.ts` (Table HR).
- `src/main/services/routingService.ts`: `profile: q.profile ?? LAUNCH_PROFILE` and two doc comments.
- `src/main/services/routingService.test.ts`: append Table V5.
- `src/main/adapters/helpers/types.ts`: `HelperExecutionInput.routing?`.
- `src/main/adapters/helpers/opencode.ts`: the sent id, the mismatch refusal, the routed model entry.
- `src/main/adapters/helpers/common.ts`: the probe reads stderr for the help call (byte-wise edit).
- `src/main/adapters/helpers/helpers.test.ts`: append Table HO.
- New `src/main/adapters/helpers/probe.test.ts` (Table PR).
- `scripts/verify-routing-body.mjs`: the helper half on the real builder with real helper-profile selections and an unrouted control; `PASS (18 checks)`.

## Non-Goals

- No wiring: no `teamService.ts`, `teamStorage.ts`, `teamRuntime.ts`, `src/main/index.ts` or `teamRouting.ts` (Task 4b-2). Until 4b-2 lands nothing sets `HelperExecutionInput.routing` or writes `teamAttemptSchema.routing`, and nothing checks `routingTier` at launch.
- No renderer change: no `routingView.ts`, store, `HelperTierSelect.vue`, `TeamLaunchDialog.vue` or Settings note (Task 4b-3); no UI drive (Task 4b-4).
- No `launchCore.ts`, `evidence.ts`, `parser.ts` or `teamProfiles.ts` change; no admission change (MR-D31: the allow-lists grow only by measurement).
- No new IPC channel, preload change, migration or dependency (K16). No change to any Phase 1–4a golden value.
- No paid run; the body script stays loopback-only with a placeholder key. No real lead or helper CLI session; `opencode` runs only inside the body script, isolated.
- No edits to the roadmap, Plan_1 or the Phase 0–4a documents.
- Do not touch, stage or revert the pre-existing modified and untracked files.

## Dependencies

Phase 4a (`resolveLaunch`, `resolveLaunchSelection`, `routingLaunchSelectionSchema`, `LAUNCH_TIER_LABELS`, the body script's TUI half) and the 0.9.1/0.9.2 hotfixes (OpenCode 1.18.34 measured; `OPENCODE_DISABLE_AUTOUPDATE`). Task 4b-2 consumes `routingLaunchRequestSchema.profile`, `memberFields.routingTier`, `teamAttemptSchema.routing`, `HelperExecutionInput.routing`, `HELPER_ROUTING_REFUSALS`, `planHelperRouting`, `helperAttemptRefusal` and `routedHelperFailureNote`; Task 4b-3 mirrors the eligibility rules in C4's order (as reason codes, not texts), and Task 4b-4 copies C1's `unknownModel` text by hand. A correction needed downstream is made here, with a test, and recorded in that task's report.

## Step-by-step Work

1. Re-run `git status --short` and record the pre-existing entries. Run `npm test` (expect 144 files, 4,236 tests) and `$env:OPENCODE_DISABLE_AUTOUPDATE='true'; opencode --version` (expect `1.18.34`).
2. `src/shared/routing.ts`: the `profile` field; write Table S8. Run `routing.test.ts`: S7-4 passes unchanged.
3. `routingService.ts`: the one-expression change and the comments. Run the whole of `routingService.test.ts` before writing Table V5: every V, V3 and V4 test passes unchanged. Write Table V5.
4. `src/shared/team.ts`: the import, the two fields, the refine line. Run `teamCore.test.ts` and `teamIpc.test.ts` unchanged; write `team.test.ts` (Table TS).
5. Write `helperRoutingCore.ts` exactly as specified and Table HR. Run the purity and layering greps.
6. `helpers/types.ts` (LF) and `helpers/opencode.ts` (CRLF). Run `helpers.test.ts` before appending anything: every existing test passes unchanged. Append Table HO.
7. `helpers/common.ts` byte-wise with a scratch Node script that asserts the counts before and after (the specification gives both). Write `probe.test.ts` (Table PR).
8. `scripts/verify-routing-body.mjs`: the helper-half edits as specified; `node --check scripts/verify-routing-body.mjs`.
9. After every CRLF or mixed edit: `git diff --stat` shows only the intended lines, `git ls-files --eol` reports the same `w/…` as before, and the byte and CRLF counts match the specification. Restore the endings if an editor rewrote them.
10. Run the verification commands; the body script last but one (it takes a few minutes and needs no build), then `npx electron-vite build` and the IPC drive.

## Test Expectations

- **Request schema (Table S8):** `profile` is optional, takes exactly `'interactive'` and `'helper'`, and an absent profile stays absent.
- **Service (Table V5):** on the helper profile every ranked tier equals `routing:tiers`' helper computation (`GOLDEN_TIERS.helper`), an explicit `'interactive'` equals no profile, Nitro reads no store file, the refusals and their order are 4a's, an unknown profile is `INVALID_REQUEST`, one clock read, and the selection never records its profile. No request, event, decrypt or credential-row read.
- **Team contracts (Table TS):** four tier names on an OpenCode API-key helper, placed last, pre-4b members and attempts round-trip byte for byte; the C1 refine on any other member, the lead included; a member `routing` object rejected; an attempt `routing` parsed strictly.
- **Pure core (Table HR):** every eligibility row with its exact text and first-failure order; the C2 attempt texts (with the `maxAgeMinutes` fallback); the C3 note for one to four tags and Nitro; the K7 model entries exactly, `options` first, no shared objects.
- **Helper builder (Table HO):** unrouted requests unchanged; Balanced from a `:nitro` member sends the base slug with the golden provider object and keeps `--agent build`, `--variant low` and the 64k cap; Nitro from a standard member declares `variants.low` beside `data_collection: deny`; both DeepSeek members send the same request for the same tier; a mismatched selection is refused; Claude and Codex ignore routing.
- **Probe (Table PR):** help on stderr is found; `--version` never reads stderr; no admission changes.
- **Existing tests:** every test in the touched files passes unchanged (no recorded amendment changes a test in this task). Reference: a scratch mirror with these changes and tables reported 147 files and 4,273 tests (37 new) when each table row is one `it`.
- **MR-G2 runtime:** `node scripts/verify-routing-body.mjs` ends `PASS (18 checks)` against the installed OpenCode 1.18.34, `providerTraffic: false`, the helper Balanced provider object arriving exactly from a `:nitro` member, Nitro from a standard member keeping `low` with `data_collection: deny`, the unrouted control unchanged, the user's real `model.json` byte-identical, and no `%TEMP%\chorus-routing-body-*` left.

## Verification Commands

Run from the repository root.

```powershell
npm run typecheck
npx vitest run src/shared/routing.test.ts src/shared/team.test.ts src/main/routing/helperRoutingCore.test.ts src/main/services/routingService.test.ts src/main/adapters/helpers/helpers.test.ts src/main/adapters/helpers/probe.test.ts src/main/routing/launchCore.test.ts src/main/services/teamCore.test.ts
npm test
Get-ChildItem -Path src/main/routing, src/shared/routing.ts -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern 'Date\.now\(|Math\.random\(|new Date\(\)|from ''(node:|fs''|path''|electron|better-sqlite3)|require\('
Get-ChildItem -Path src/main/routing -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern "from '\.\./(services|db|adapters)/"
node scripts/verify-routing-ranker.mjs
$env:OPENCODE_DISABLE_AUTOUPDATE = 'true'; opencode --version
node scripts/verify-routing-body.mjs
npx electron-vite build
node scripts/verify-routing-ipc.mjs
npm run grep:secrets
git diff --check
git diff --stat -- src/shared/routing.ts src/shared/team.ts src/main/services/routingService.ts src/main/adapters/helpers/types.ts src/main/adapters/helpers/opencode.ts src/main/adapters/helpers/common.ts src/shared/routing.test.ts src/main/services/routingService.test.ts src/main/adapters/helpers/helpers.test.ts scripts/verify-routing-body.mjs
git ls-files --eol -- src/shared/routing.ts src/shared/team.ts src/main/services/routingService.ts src/main/adapters/helpers/types.ts src/main/adapters/helpers/opencode.ts src/main/adapters/helpers/common.ts src/shared/routing.test.ts src/main/services/routingService.test.ts src/main/adapters/helpers/helpers.test.ts scripts/verify-routing-body.mjs
git status --short
```

Both `Select-String` lines print nothing. The ranker prints `PASS (30 checks)`. `opencode --version` prints `1.18.34`. The body script's last line is `PASS (18 checks)` with exit code 0; paste its whole output. The IPC drive's last line is `PASS (20 checks)` (unchanged). `npm run grep:secrets` runs after the body script deleted its bundle. `git ls-files --eol` reports `w/crlf` for every listed file except `helpers/types.ts` (`w/lf`) and `helpers/common.ts` (`w/mixed`), exactly as before; `git diff --stat` shows only the specified lines (with `core.autocrlf` true it cannot see a whole-file rewrite, so compare byte counts too). `git status --short` shows ` M` for the owned files, `??` for `src/shared/team.test.ts`, `src/main/routing/helperRoutingCore.ts`, its test and `src/main/adapters/helpers/probe.test.ts`, and the pre-existing entries unchanged. Record actual exit codes and the vitest summary.

## Acceptance Criteria

- The `profile` field, the two Team fields with the refine, `HelperExecutionInput.routing`, the builder change and the probe change match the specification; `helperRoutingCore.ts` matches it exactly; both typechecks pass.
- S8-1–S8-2, V60–V66, HR1–HR7, TS1–TS7, HO1–HO8 and PR1–PR6 pass; every pre-existing test in the touched files passes unchanged; the purity and layering greps print nothing.
- An unrouted helper request is byte-identical to `70d5dda`'s (HO1, HO5, and the body script's check 6).
- `node scripts/verify-routing-body.mjs` prints `PASS (18 checks)`, exit 0, against OpenCode 1.18.34 at the loopback stand-in, every OpenCode run on isolated XDG state and data (MR-G3), the real state file unchanged.
- `npm test`, the ranker, the IPC drive and `npm run grep:secrets` pass; CRLF and mixed files keep their endings; the pre-existing worktree entries are untouched.

## Review Checklist

- [ ] `resolveLaunch` changed in one expression; its read order, refusals, single clock read and output parse are untouched; it still never decrypts, reads a credential row or fetches.
- [ ] `routingTier` and `routing` are the last keys; a pre-4b member, run config and attempt round-trip byte for byte (TS1, TS6), so `getRun`'s `configJson` comparison still holds.
- [ ] The member refine's message is exactly `HELPER_ROUTING_REFUSALS.notOpencode` (HR7); a member `routing` object is rejected, never stripped.
- [ ] `helperRoutingCore.ts` imports only shared modules and `./launchCore`; no clock, environment, file system or network; its texts match C1–C3 to the character, `→` included.
- [ ] The builder computes `--model`, the entry key and `variants.low` from the sent id; `measuredCodeHelper` reads `input.model` when unrouted (byte identity) and the sent id when routed; the provider object goes only into this process's `OPENCODE_CONFIG_CONTENT`; a mismatched selection throws.
- [ ] `common.ts` was edited byte-wise: 9,660 bytes, 97 CRLF, lone LF still on lines 21 and 22; `--version` reads stdout only.
- [ ] The body script's helper cases call the real builder with real helper-profile selections; its only harness patch is `provider.openrouter.options = { baseURL }`; checks 1–4 keep their names; the TUI half is untouched; it still deletes its bundle and evidence on every path.
- [ ] Changes are limited to owned files; pre-existing work is preserved and not committed.
