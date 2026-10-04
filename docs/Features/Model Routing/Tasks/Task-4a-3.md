# Task 4a-3 — Launch wiring, migration v28 and relaunch

**Status:** Complete 2026-10-04 (`50c29d8`). Coordinator addition: W2.\
**Depends on:** Tasks 4a-1 and 4a-2.\
**Paired specification:** [ImplementationSpec-4a-3](../ImplementationSpecs/ImplementationSpec-4a-3.md)

## Source Of Truth

[Feature roadmap](../roadmap.md) (MR-D3, MR-D4, MR-D10, MR-D18–MR-D20; gates MR-G1, MR-G2, MR-G4, MR-G5, MR-G6), user decisions MR-D25–MR-D28 as recorded in the [Phase 4a overview](Phase-4a-Overview.md) (with K1–K13 and the clarifications this specification states), the paired specification, [ImplementationSpec-4a-1](../ImplementationSpecs/ImplementationSpec-4a-1.md) (`resolveLaunch`, the planners, the content builders, K13's `unroutedNitroVariantsContent`) and [ImplementationSpec-4a-2](../ImplementationSpecs/ImplementationSpec-4a-2.md) (`PtyLaunchRouting`, `McpWriteContext.cliState`, `opencodeStateHome`), Foundation decisions D33 (credential handling, no orphan rows), D43/D56 (launch precedence), D49 (session credential pointer), D179 (opencode's effort file), and repository CLAUDE.md (sessions live in main; Zod on every IPC boundary; keys only as env vars into the child).

## Initial Starting Point

Branch `feature/model-routing` at `a57ef1b`, verified 2026-10-03 by opening each file.

- `src/shared/ipc.ts` (CRLF): `launchRequestSchema` (:1296–1390) is a plain `z.object` (unknown keys stripped) with `credential_profile_id` (:1311), `model_effort` (:1332), `launch_profile_id` (:1351) and `model` (:1374); it imports only `zod` and three sibling shared modules (:1–9).
- `src/main/ipc.ts` (CRLF): `registerIpc(` (:617) takes nineteen positional parameters ending `fleet` (:719) and the optional `teamRuntime?` (:720). `withMcpEnv` (:938–1198) builds `agentDefaults` from `opts.route?.modelId` and `opts.modelEffort` (:970–974), returns early with no memory and no effort (:989), and otherwise calls `wireMcpForLaunch` (:990, :1151); every return spreads `opts`. `mergeWiringEnv` (:1229–1244) lets the profile's env win a collision. `resolveCredential` (:1355–1458) decrypts (:1442) and builds the route `{ providerKey: 'chorus', providerName, baseUrl, modelId: provider.model }` (:1453–1456).
- SessionLaunch (:1747–2188): parse (:1748); profile + credential refused (:1785–1787); profile resolution (:1851–1874, `profileEnv` :1872, `profileModel` :1873); `composeLaunchOptions` (:1897–1909); the credentialed branch (:1915–1962: `resolveCredential` :1919, `mintForDispatch` :1925–1929, `chosenModel` :1949, route override :1950–1953, `launchOpts` :1957–1962); `sessionProfilePointer` (:1999–2000); `storage.createSession` in the three workspace modes (:2051, :2126, :2157); `withMcpEnv` (:2088, :2142, :2172); `linkAttribution` (:2090, :2144, :2174). There is no unit test for this handler (`src/main/ipc.ts:1250` notes `src/main/ipc.test.ts` does not exist).
- SessionRelaunch (:3302–3415): requires a launch profile (:3332–3339); `resolveLaunchProfile` (:3340–3349); `composeLaunchOptions(resolution.plan)` (:3356); `resolveCredential` (:3363); opts (:3365–3370); `withMcpEnv` (:3386). The route keeps `provider.model` (a pre-existing gap outside routing).
- `src/main/index.ts` (CRLF): `let routing: RoutingService | null = null` (:159); the `registerIpc(...)` call (:1363–1409, `fleet` :1407, `teamRuntime` :1408); `routing` is constructed after it (:1414–1427) and reset to null on a startup failure (:1425–1426).
- `src/main/services/sessionManager.ts` (mixed: CRLF except lines 1079–1085): `LaunchOptions` (:165–269); the only `buildLaunch` call (:1017–1049, `mcpServers` :1043); `composeChildEnv` with `envAdditions: { ...request.envAdditions, ...opts.envAdditions }` (:1065–1077): a profile's env beats the adapter's additions.
- `src/main/services/storage.ts` (CRLF): `MIGRATIONS` (:182); the last entry is v27 (:1075–1080), the array closes at :1081; `migrate()` (:3984–4002) applies `MIGRATIONS[version - 1]` for each version above `MAX(version)` of `schema_migrations`. `createSession` (:1790–1829) normalises every optional column; it is also called by `findOrCreateSession` (:3702) and `teamRuntime.ts:183`, neither of which routes. `getSessionById` (`storage.ts:1868–1870`) selects whole rows.
- `src/main/db/schema.ts` (mixed: CRLF except lines 1–2 and 874–933): `sessions` (:69–180, last column `memoryShellFirst` :179); `SessionRow`/`NewSessionRow` (:209–210). `src/main/db/schema.test.ts` (CRLF) pins the column count at 19 (:134–141) and tests DDL against an in-memory `node:sqlite` database (:236–313).
- v28 is free: the array holds 27 entries on this branch, `main` and `origin/main` (other local branches stop at v24 or below, one at v27), and the installed database (a copy, read 2026-10-03) reports `MAX(version)` 27.
- `layout:get` sends session rows through `sessionInfoSchema` (`src/shared/ipc.ts:3381`, a plain `z.object`), which strips unknown keys, so a new column never reaches the renderer.
- The installed catalog (same copy) has no `model_catalog` row for `deepseek/deepseek-v4.1-flash`, and every DeepSeek row's `reasoning_efforts` is NULL, so on this machine a Nitro launch, routed or (K13) not, takes its variants from its own effort (K6's fallback).
- `scripts/verify-routing-ipc.mjs` (Task 4a-1: `PASS (20 checks)`) launches the built app with a throwaway `--user-data-dir`; D16 checks the profile's `chorus.db` exists after exit.
- The worktree has the pre-existing changes listed in the overview.

## Goal

Make a routing tier change what an interactive OpenCode launch sends, and make it last: main checks eligibility and resolves the tier itself before any decrypt or row (K2, K3, K7), carries the content per process with `-m` and `agent.build.model` naming the sent id (K6), keeps OpenCode's remembered variant in step (MR-D25), records the exact selection on the session row (MR-D27, migration v28) and the last choice per model (MR-D28), and relaunches a routed session with its selection unchanged (K10). Every credentialed OpenCode launch or relaunch on the gateway that sends a `:nitro` id with an effort declares that id's variants, routed or not (K13, MR-D4).

## Exact Scope

- `src/main/services/storage.ts`: migration v28; `createSession` normalises `routingJson`.
- `src/main/db/schema.ts`: `routingJson: text('routing_json')`.
- `src/main/db/schema.test.ts`: the v28 block; the column-count pin 19 → 20 (recorded amendment).
- `src/shared/ipc.ts`: `routing_tier: routingLaunchTierSchema.optional()` on `launchRequestSchema`; one import.
- `src/shared/ipc.test.ts`: one test in the `launchRequestSchema` block.
- `src/main/ipc.ts`: the `routing` thunk parameter; `withMcpEnv` composes `cliState`; SessionLaunch plans, resolves, checks, carries, persists and records routing; SessionRelaunch re-applies a persisted selection; both carry K13's variant declaration for an unrouted `:nitro` launch with an effort (`launchConfigContent`).
- `src/main/index.ts`: pass `() => routing`.
- `src/main/services/sessionManager.ts`: `LaunchOptions.routing`; pass it into the spec.
- New `src/main/services/sessionManager.routing.test.ts` (Table SM).
- `scripts/verify-routing-ipc.mjs`: D16 also checks v28 in the throwaway database; the freshness list gains `storage.ts` and `ipc.ts` (a recorded cross-task edit; the check count stays 20).

## Non-Goals

- No renderer change: no `LaunchDialog.vue`, `RoutingTierCards.vue`, `routingView.ts`, store or preload edit (Task 4a-4). The dialog's `routing_tier`, its launchability and its default are 4a-4's.
- No built-app launch drive (Task 4a-5); no change to `launchCore.ts`, the routing services or the adapters beyond what 4a-1 and 4a-2 delivered (a needed fix is made there with a test and recorded).
- No `TeamLaunchDialog.vue`, Team member or helper routing, helper re-rank, "Re-rank and relaunch" or guardrail revalidation (Phase 4b).
- No tier on launch profiles (MR-D27): `launch_profiles`, "Save as launch profile" and `launchProfileWireSchema` are unchanged.
- SessionRestart and boot restore are unchanged: restart still refuses credentialed sessions, restore still heals them to exited, and neither ever routes.
- No fix to relaunch's pre-existing use of `provider.model` for unrouted sessions; only a routed relaunch sets its own `route.modelId` (K10).
- No paid run, no network in tests, no new dependency.
- No edits to the roadmap, Plan_1 or the Phase 0–3 documents.
- Do not touch, stage or revert the pre-existing modified and untracked files.

## Dependencies

Tasks 4a-1 (`RoutingService.resolveLaunch`, `recordLaunchChoice`, `planRoutingLaunch`, `planRoutingRelaunch`, `checkRoutedRoute`, `routingVariantEfforts`, `buildOpenCodeRoutingContent`, the selection schema) and 4a-2 (`PtyLaunchRouting`, `McpWriteContext.cliState`, `opencodeStateHome`, the adapter changes). Tasks 4a-4 and 4a-5 consume `launchRequestSchema.routing_tier`, the refusal texts and `sessions.routing_json`.

## Step-by-step Work

1. Re-run `git status --short`; record the pre-existing entries. Re-check that v28 is free: `git grep -n "// v2[89]" main -- src/main/services/storage.ts` prints nothing, and the newest entry on this branch is still v27.
2. `storage.ts` (CRLF): append the v28 entry (one comma on the v27 line, then the new lines) and the `createSession` normalisation. `schema.ts` (mixed; the `sessions` block is CRLF): the column. Write the schema.test.ts v28 block and amend the count. After each CRLF edit: `git diff --stat` shows only the intended lines and `git ls-files --eol` reports the same `w/…` as before.
3. `src/shared/ipc.ts` (CRLF): the import and the field; the `ipc.test.ts` test.
4. `sessionManager.ts`: the option and the pass-through; write Table SM.
5. `src/main/ipc.ts` (CRLF): the parameter, the helpers, `withMcpEnv`, SessionLaunch, SessionRelaunch, exactly as specified. `src/main/index.ts` (CRLF): the thunk.
6. `scripts/verify-routing-ipc.mjs`: the D16 migration check and the freshness list.
7. Run the verification commands: `npx electron-vite build` before the drive, and `node scripts/verify-routing-body.mjs` (MR-G2: this task composes the content the launch carries).

## Test Expectations

- **Schema (schema.test.ts):** `routing_json` is declared under its exact DDL name, nullable with no default, added once as the last migration, with no FK or index; a pre-existing row reads NULL and a selection JSON round-trips; `createSession` normalises it; the column count is 20.
- **Wire (ipc.test.ts):** `routing_tier` accepts exactly the four tiers and is optional; `'default'`, unknown names and non-strings fail.
- **Spawn (Table SM):** `LaunchOptions.routing` reaches `PtyLaunchSpec.routing` unchanged and its content reaches the child env; a launch without it (restore, restart) passes none; a profile env that sets `OPENCODE_CONFIG_CONTENT` wins in `sessionManager` — the reason main refuses that launch (K7).
- **Rules:** every eligibility, refusal, relaunch and content rule — K13's unrouted `:nitro` declaration included (Table L17/L18) — is a pure function from Task 4a-1 and is covered there (Tables L and V4); this task's handler code only gathers facts and calls them, so review checks the call order against the specification. OpenCode's reaction to K13's content is `verify-routing-body.mjs` check 16.
- **Runtime:** `node scripts/verify-routing-ipc.mjs` ends `PASS (20 checks)` with D16 proving v28 in the throwaway profile's own database (MR-G6); `node scripts/verify-routing-body.mjs` ends `PASS (16 checks)` (MR-G2). The routed launch end to end, the relaunch and the remembered choice in a built app are Task 4a-5's drive.
- **Everything else unchanged:** `npm test` passes; the ranker prints `PASS (30 checks)`.

## Verification Commands

Run from the repository root.

```powershell
npm run typecheck
npx vitest run src/main/db/schema.test.ts src/shared/ipc.test.ts src/main/services/sessionManager.routing.test.ts src/main/services/sessionManager.team.test.ts src/main/routing/launchCore.test.ts src/main/services/routingService.test.ts
npm test
node scripts/verify-routing-ranker.mjs
npx electron-vite build
node scripts/verify-routing-ipc.mjs
node scripts/verify-routing-body.mjs
npm run grep:secrets
git diff --check
git diff --stat -- src/main/services/storage.ts src/main/db/schema.ts src/main/db/schema.test.ts src/shared/ipc.ts src/shared/ipc.test.ts src/main/ipc.ts src/main/index.ts src/main/services/sessionManager.ts
git ls-files --eol -- src/main/services/storage.ts src/main/db/schema.ts src/main/db/schema.test.ts src/shared/ipc.ts src/shared/ipc.test.ts src/main/ipc.ts src/main/index.ts src/main/services/sessionManager.ts
git status --short
```

The IPC drive's last line is `PASS (20 checks)` and the body script's `PASS (16 checks)`, both exit 0; paste both outputs. `git ls-files --eol` must report `w/crlf` for `storage.ts`, `schema.test.ts`, `src/shared/ipc.ts`, `ipc.test.ts`, `src/main/ipc.ts` and `index.ts`, and `w/mixed` for `schema.ts` and `sessionManager.ts`, exactly as before (with `core.autocrlf` true the diff cannot see a line-ending rewrite; restore the original endings if one changed). `git diff --stat` shows only the specified lines (`index.ts`: three insertions). `git status --short` shows ` M` for the owned files, `??` for `sessionManager.routing.test.ts`, and the pre-existing entries unchanged. Record actual exit codes.

## Acceptance Criteria

- Migration v28, the Drizzle column, the `createSession` normalisation, the wire field, the thunk and the `sessionManager` pass-through match the specification; both typechecks pass.
- The schema.test.ts v28 block and the amended count pass; the `routing_tier` test passes; SM1–SM4 pass; every other existing test passes unchanged.
- SessionLaunch: a routed launch is refused before the decrypt (and before any row) when the plan refuses or `resolveLaunch` throws; refused after the decrypt and before any minted key when the route is not the gateway; otherwise it carries `routing.configContent`, `route.modelId = selection.sentModelId`, persists `routing_json`, and records the choice after `sessions.launch` returns. An eligible launch with no tier records `'default'` and persists NULL; a K7-blocked launch records nothing; an ineligible launch with no tier is unchanged, except K13: an `opencode` launch on the gateway whose sent id ends in `:nitro` and that carries an effort carries that id's variants (no provider object, no `routing_json`, no record).
- SessionRelaunch: a row with `routing_json` relaunches with the persisted selection unchanged or is refused with the stated reason; a row without it relaunches as before, plus K13's recomputed variant declaration when its route names a `:nitro` id and the profile carries an effort.
- `withMcpEnv` passes `cliState` to both `wireMcpForLaunch` calls exactly when a model effort is set.
- `node scripts/verify-routing-ipc.mjs` (with v28 in D16) and `node scripts/verify-routing-body.mjs` pass; `npm test` and `npm run grep:secrets` pass; line endings are unchanged; the pre-existing worktree entries are untouched.

## Review Checklist

- [ ] The routing plan and `resolveLaunch` run after `composeLaunchOptions` and before `resolveCredential`: a refusal decrypts nothing and creates no row (D33).
- [ ] The gateway check runs after `resolveCredential` and before `attribution.mintForDispatch`: no key is minted for a refused launch.
- [ ] `route.modelId` is `selection.sentModelId` on routed launches only, so `-m`, `agent.build.model` and the remembered-variant key all name the sent id (K6, MR-D25); `launchModelId` therefore records the sent id (`…:nitro` for Nitro).
- [ ] `routing.configContent` comes from `launchConfigContent`: `buildOpenCodeRoutingContent` for a selection, else (K13) `unroutedNitroVariantsContent` for a `:nitro` sent id with an effort; Nitro's efforts from the credential provider's catalog row for the base slug, else the launch's own effort; no catalog read for any other launch; it never reaches the shared file, argv or a log, and K13's content is never persisted.
- [ ] `routingJson` is passed on all three `createSession` calls, `JSON.stringify(selection)` or `null`; `teamRuntime.ts:183` and `findOrCreateSession` are untouched and write NULL.
- [ ] `recordLaunchChoice` is called only after `sessions.launch(...)` returned, in all three branches, only for `'routed'` and `'default'` plans (never K7-blocked), and never on relaunch, restart or restore.
- [ ] SessionRelaunch refuses, never silently unroutes, a row whose `routing_json` is unreadable or whose credential is no longer routing-eligible (K10); no re-rank.
- [ ] The thunk is read once per handler call; with routing unavailable an unrouted launch proceeds exactly as today.
- [ ] `withMcpEnv`'s `cliState` uses `composeChildEnv` with only the credential's name (no key value) and `detectClis()`'s recorded version.
- [ ] CRLF and mixed files keep their endings; only the specified lines changed.
- [ ] The IPC drive launched its own built app with a throwaway profile and killed only its own child; D16 read the throwaway `chorus.db` after the app exited.
- [ ] Changes are limited to owned files (and the recorded D16 edit); pre-existing work is preserved and not committed.
