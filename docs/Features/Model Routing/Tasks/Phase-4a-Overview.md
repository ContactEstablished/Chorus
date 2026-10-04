# Phase 4a — Interactive launches (the launch-dialog tier picker) overview

Created 2026-10-03. **Status: Complete 2026-10-04** (`12984b2`, `b6a1eff`, `349d373`, `50c29d8`, `279953f`, `eb8ee80`); the outcome, gate evidence, execution decisions and carry-overs are in the [roadmap's Phase 4a section](../roadmap.md#phase-4a--interactive-launches-the-launch-dialog-tier-picker-complete-2026-10-04). User decisions MR-D25 to MR-D29 are resolved (user, 2026-10-03) and recorded in the roadmap by the coordinator; MR-D25 resolves MR-D16. Kickoff decisions K1–K14 are resolved (coordinator, 2026-10-03). Clarifications C1–C44 were made while drafting the specifications; the coordinator reviewed and accepted them on 2026-10-03. **C-numbers in this document are Phase 4a's own** (Phase 2 also used C23 and C24, and Phase 3 used C1–C20); a Phase 3 clarification is always cited as "Phase 3 C\<n\>".

## Phase contract

Make a routing tier change what an interactive OpenCode session sends. When a user launches OpenCode on an OpenRouter API-key credential with a registry model, the launch dialog offers Budget, Balanced, Fast, Nitro and "OpenRouter default" as one choice, preselects the remembered choice, and sends only the tier's name. Main resolves the tier itself (K2), refuses an ineligible or stale one with a stated reason, carries the provider object and, for Nitro, the declared effort variants per process in `OPENCODE_CONFIG_CONTENT` (MR-D3, MR-D4), records the exact selection on the session row (migration v28, MR-D27), remembers the last choice per model (MR-D28), and Relaunch re-applies the selection unchanged. Every OpenCode effort an interactive launch sets now actually applies: Chorus keeps OpenCode's remembered TUI variant in step (MR-D25), and an unrouted `:nitro` launch declares its variants too (K13).

**Prime constraints.** Zero cost throughout: no paid run, no Refresh pressed by any test or drive, no real OpenCode launched by the built-app drive (K11). Nothing in Phase 4b's scope: no `TeamLaunchDialog.vue`, Team member or helper routing, helper re-rank, "Re-rank and relaunch", guardrail revalidation or failover messages (MR-D29). Launch profiles store no tier ("Save as launch profile" still stores no model; MR-D27).

The [feature roadmap](../roadmap.md) is authoritative for MR-D1 to MR-D29 and gates MR-G1 to MR-G8. Where [Plan_1](../Plan_1.md) §2 and §12 differ from this document (placement, "remember the last tier", re-rank wording), this document wins. Phase 3's contracts are in the [Phase 3 overview](Phase-3-Overview.md).

**Exit:** MR-G1 to MR-G6 and MR-G8 pass through zero-cost checks: the IPC drive `PASS (20 checks)`; `verify-routing-body.mjs` `PASS (16 checks)` on Chorus's real builders against the real OpenCode 1.18.33 at a loopback stand-in; the isolated UI harness `PASS (20 checks)` with 13 PNGs; the Settings drive `PASS (16 checks)` (count unchanged); the built-app launch drive `verify-routing-launch.mjs` `PASS (20 checks)` with 3 PNGs; and the ranker `PASS (30 checks)`.

## Grounding

Verified 2026-10-03 at `a57ef1b` on branch `feature/model-routing`, by opening each file this session (the drafters of 4a-1 to 4a-3 and of 4a-4 and 4a-5; the renderer rows were re-opened for this overview). Line numbers drift; Task 4a-3 moves lines in `src/main/ipc.ts`, `index.ts` and `storage.ts`, so later tasks recheck at execution.

| Location | Fact |
|---|---|
| `src/shared/routing.ts:393` | `ROUTING_ERROR_CODES` (:393–404) has ten codes, pinned only by S4-1 (`src/shared/routing.test.ts:220`). `ROUTING_CHANNELS` (:535–546): nine request channels, `credentials` (:544), then `progress` (:545); `RoutingApi` (:555–567). `providerPrefsSchema` (:442) is module-private. The file imports only `zod` (:1). `ROUTING_TIERS` (:20) already names the four tiers. No launch or selection type exists in `src/`. |
| `src/main/services/routingService.ts:341` | `tiers()` reads the snapshot (:347, `NO_SNAPSHOT` :348), the account file only for a credential (:349–350), then observations (:354), cache (:356), settings (:359) and the clock (:360); it never reads a credential row. `RoutingStoreLike` (:112–115). `MESSAGES` (:156–164). |
| `src/main/services/routingService.test.ts:384` | `storeWith` (:384–396) enumerates every `RoutingStoreLike` method, so widening the `Pick` widens it. Table V3 is :1389–1634 (V30–V42). |
| `src/main/services/routingStore.ts:151` | `readText`, `load` and `save` (:151–207) are tied to a model's `StoreFileKind`; the store root is `<userData>/routing` (`src/main/index.ts:1415`). |
| `src/main/services/routingIpc.ts:26` | The header says "Nine request channels". I1 (`routingIpc.test.ts:180–186`) and I4 (:251–276) assert nine; S5-1 (`src/shared/routing.test.ts:313–318`) asserts ten channel values. |
| `src/preload/index.ts:170` | The `routing:` block (:161–172) ends `credentials` (:170), `onProgress` (:171), `} as RoutingApi,` (:172); type-only import (:3). |
| `scripts/verify-routing-ipc.mjs:65` | `CHECKS` (:65–71), 19 checks; freshness `sources` (:93–99) list no `storage.ts` or `ipc.ts`; D16 (:499–509) checks only that the throwaway `chorus.db` exists. |
| `src/main/adapters/opencode.ts:217` | `writeMcpConfig` (:217–227) writes the shared `<userData>/mcp/opencode.json` with the private `agentBlockFor` (:323–329); `buildLaunch` returns `envAdditions: {}` (:260); `qualifyModel` (:391) is exported. |
| `src/main/adapters/types.ts:433` | `PtyLaunchSpec` (:433–558) has no routing field; `McpWriteContext` (:833–882, `agentDefaults` :876–880). |
| `src/main/adapters/mcpConfigWrite.ts:236` | opencode's file is `custom`, so `wireMcpForLaunch` calls `writeMcpConfig` on every call (:236–238, :291). |
| `src/main/adapters/env.ts:131` | `composeChildEnv`'s credential branch copies only `BASELINE_ENV_VARS` (:10–20; no `XDG_*`), then `envAdditions` (:177), then `secretEnv` (:178). |
| `scripts/verify-routing-body.mjs:96` | Requires OpenCode exactly 1.18.33 (:96–97); TUI cases hand-built (:76–80); isolated XDG per run (:52–57); no PASS line, exit code from `report.passed` (:119–120); writes a report into `%TEMP%\chorus-routing-body-*`. |
| OpenCode 1.18.33 (measured, zero cost) | `opencode --version` is `1.18.33`. `opencode debug paths` under seven environments: the state directory is `<XDG_STATE_HOME>\opencode`, else `<USERPROFILE>\.local\state\opencode`; `HOME` is ignored. The real `model.json` is one line of compact JSON (1,157 bytes, no newline; keys `recent`, `favorite`, `variant`; the `:nitro` key holds `"default"`). |
| Scratch bundle (measured) | `opencodeAdapter.buildLaunch`, `opencodeAdapter.writeMcpConfig` and `composeChildEnv` run under plain Node from an esbuild bundle with `packages: 'external'`; no new exported seam is needed. |
| `src/main/services/launchOptionsCore.ts:53` | Never composes `route`, so only credentialed launches (SessionLaunch, SessionRelaunch) can write an opencode effort and reach MR-D25. |
| `src/main/ipc.ts:617` | `registerIpc` takes nineteen required positional parameters ending `fleet` (:719) and the optional `teamRuntime?` (:720). `src/main/index.ts` calls it at :1363–1409 and constructs `routing` afterwards (:1414–1427), resetting it to null on failure (:1425–1426): the handlers need a thunk. |
| `src/main/ipc.ts:938` | `withMcpEnv`: `agentDefaults` (:970–974); the no-memory, no-effort return (:989); `wireMcpForLaunch` (:990, :1151); every return spreads `opts` (:989, :1010, :1174, :1182, :1197 via :1243). |
| `src/main/ipc.ts:1747` | SessionLaunch: `composeLaunchOptions` (:1897–1909); `resolveCredential` (:1919) then `mintForDispatch` (:1925); `chosenModel` (:1949); `createSession` at :2051, :2126, :2157 (also `teamRuntime.ts:183` and `storage.ts:3702`). `src/main/ipc.ts:1250` notes there is no `src/main/ipc.test.ts`. |
| `src/main/ipc.ts:3302` | SessionRelaunch requires a launch profile (:3332–3339) and keeps the route's `provider.model` (a pre-existing gap outside routing). |
| `src/main/services/sessionManager.ts:1017` | The only `buildLaunch` call (:1017–1049); `composeChildEnv` (:1065–1077) lets a profile's env beat the adapter's additions; `launchModelId` (:276–278) is `opts.route?.modelId`. |
| `src/main/services/storage.ts:1075` | v27 is the last entry (:1075–1080), no trailing comma; `]` at :1081; `createSession` (:1790–1829); `migrate()` (:3984–4002). v28 is free on this branch, `main` and `origin/main`; the installed database (a copy) reports 27. |
| `src/main/db/schema.test.ts:134` | Pins the `sessions` column count at 19 (:134–141); slices a migration from source and applies it to an in-memory `node:sqlite` database (:282–287). |
| `src/shared/ipc.ts:1296` | `launchRequestSchema` is a plain `z.object` (`model` :1374); `sessionInfoSchema` (:3381) is a plain `z.object`, so a new session column never reaches the renderer. |
| `src/main/services/cliDetect.ts:36` | `pickSpawnable` takes the first `.exe` anywhere, else the first `.cmd`/`.bat` (:36–52); `detectClis()` memoises versions (:249–252), `refreshClis()` re-probes (:274–277); the Team helper probe also runs `<file> run --help` (`helpers/common.ts:85–86`); `parseNpmShim` (`cliShimCore.ts:67`). |
| Installed catalog (a copy) | No `model_catalog` row for `deepseek/deepseek-v4.1-flash`; every DeepSeek row's `reasoning_efforts` is NULL, so Nitro variants on this machine fall back to the launch's own effort. |
| `src/renderer/src/components/LaunchDialog.vue:288` | 2,095 lines; `modelEffortLevels` looks up the exact id (:288), so a `:nitro` id finds no efforts; `submit()` guard (:917); `own` (:966); the payload literal (:998–1041); the Launch button's `busy \|\|` (:1661); `overlays.css` (:1685). |
| `src/renderer/src/components/routing/RoutingTierCards.vue:20` | Props `{ cards, nitro, notes }`, no emits; the comment (:10–13) says Phase 4 adds a selection prop and event; `SettingsRouting.vue:233` is its only app user. 224 lines. |
| `src/shared/routingView.ts:46` | `ROUTING_PREVIEW_NOTE` reads `Preview only: launches do not use these tiers yet.`, shown first in Settings (`SettingsRouting.vue:168`) and pinned by RV21 (`routingView.test.ts:727`) and `PREVIEW_NOTE` (`scripts/verify-routing-settings-ui.mjs:68`, read by its freshness check :159 and U1 :592). |
| `src/renderer/src/stores/routing.ts:146` | The Settings singleton ranks and refreshes at the fixed inspector effort (:146, :195). |
| `scripts/verify-routing-ui.mjs:761` | Prints `PASS (15 checks)`; 762 lines. |
| `src/renderer/src/App.vue:1091` | The dialog mounts under `v-if="dialogOpen && projectStore.activeId"` (:1091–1098): every open is a fresh component. |
| User environment (measured) | The real `%USERPROFILE%\.local\state\opencode\model.json` exists; no `XDG_*` or `HOME` is set. `os.homedir()` follows `USERPROFILE` (Node 22.14, Electron 43.1.1); Electron's `app.getPath('home')` does not. |

**Line endings.** `git ls-files --eol` reports `w/crlf` for `src/main/index.ts`, `src/preload/index.ts`, `src/main/services/storage.ts`, `src/shared/ipc.ts`, `src/main/ipc.ts`, `src/main/adapters/opencode.ts`, `src/main/adapters/types.ts`, `src/main/adapters/adapters.test.ts`, `src/main/adapters/mcpConfigWrite.test.ts`, `src/main/db/schema.test.ts` and `src/shared/ipc.test.ts`; `w/mixed` for `LaunchDialog.vue` (2,088 CRLF and 7 lone LF at lines 33, 34, 35, 1102, 1103, 1117, 1118; 0 lone CR), `src/main/db/schema.ts` (LF only at lines 1–2 and 874–933; the `sessions` block is CRLF), `src/main/services/sessionManager.ts` (LF only at 1079–1085; the edited regions are CRLF) and `env.ts` (not edited); `w/lf` for the routing services and tests, `src/shared/routing.ts`, `routingView.ts`, the stores, `components/routing/*` and every script. `core.autocrlf` is `true` and there is no `.gitattributes`. Rule for every edit: an inserted line takes its neighbours' ending; after each edit `git diff --stat` shows only the intended lines and `git ls-files --eol` still reports the same `w/…` value (with `core.autocrlf` true, `git diff` cannot see a whole-file rewrite). `LaunchDialog.vue` is edited byte-wise only, by a scratch Node script that asserts the 2,088/7/0 counts and the anchor lines before writing and reports them after (C35); the `Edit` tool and editors have rewritten line endings in this repository.

**Golden values.** Every expected value in Tables S7, L, V4, F2 (4a-1) and VS, OA, MW and the body-script expectations (4a-2) was computed on 2026-10-03 by bundling the cores at `a57ef1b` with esbuild in a scratch directory and running prototypes of the specified functions; the K13 strings were recomputed the same way after K13 was decided. Tables LV and LS (4a-4) were computed the same way from the Phase 1 cores and `routingView.ts`. No prototype is committed. Built-app drives compare with main's own replies and rows, never a golden order (Phase 3 C18, C42).

## Preserved state

Pre-existing worktree state at kickoff: ` M .mcp.json`, ` M docs/Features/Engine/chorus-engine-spec.md`, ` M electron-builder.yml`, ` M package.json`, and seven untracked files under `docs/troubleshooting/`. Do not revert, stage, commit or overwrite any of them. Stage explicit paths only; the repository is public.

Phase 1–3 contracts are frozen except for the amendments recorded below. The golden fixture and every golden expectation stay as they are, and `node scripts/verify-routing-ranker.mjs` must keep printing `PASS (30 checks)`.

### Recorded contract amendments to Phases 1–3

These are contract changes, made on purpose and listed here so that no test edit reads as "changing an expectation to make a test pass".

| Amendment | Task | Test or script that changes with it |
|---|---|---|
| `ROUTING_ERROR_CODES` gains `SNAPSHOT_STALE` and `TIER_EMPTY` (C1); `routingProgressEventSchema`'s `failed.code` accepts them too | 4a-1 | S4-1: ten codes → twelve. |
| `ROUTING_CHANNELS` gains `launchPreferences: 'routing:launch-preferences'`; `RoutingApi` gains `launchPreferences(input)` | 4a-1 | S5-1: ten values → eleven. I1: nine request channels → ten. I4: nine responses → ten. `VALID`, `WRONG_TYPE`, the `setup` fake and `actions` gain the channel (I2, I3, I5, I6 cover it); new I12 (invalid output). |
| `RoutingIpcDeps.service` picks `launchPreferences`; one more `handle(…)` | 4a-1 | `routingIpc.ts` header: "Nine request channels" → "Ten". |
| `RoutingStoreLike` gains `readLaunchPreferences`, `writeLaunchPreferences` | 4a-1 | `storeWith` (`routingService.test.ts:384–396`) gains two delegations (a fixture). |
| `tiers()` reads through `storedRankInputs` (same calls, same order); `RoutingStore`'s private read/write helpers are generalised (same messages) | 4a-1 | None: every Table V, V3 and F test passes unchanged. |
| The preload `routing:` block gains one line | 4a-1 | I9 reads every channel literal, the new one included. |
| `verify-routing-ipc.mjs` gains `D19 launch preferences empty` and a preload freshness string | 4a-1 | Its last line becomes `PASS (20 checks)`. |
| `verify-routing-ipc.mjs` D16 also proves v28 in the throwaway `chorus.db` (`node:sqlite`, after exit); its freshness list gains `storage.ts` and `ipc.ts` (C18) | 4a-3 (sequenced cross-task edit) | D16's detail only; still `PASS (20 checks)`. |
| `sessions` gains a twentieth column, `routing_json` (v28) | 4a-3 | `schema.test.ts:134–141`: column count 19 → 20; a new v28 block. |
| `verify-routing-body.mjs` is rebuilt: TUI cases from Chorus's real builders; the K13 and MR-D25 cases; a real-state guard; the evidence directory deleted on every exit path; no report file (stdout only); a new `PASS (16 checks)` last line (C14) | 4a-2 | The Phase 0 script's nine checks become sixteen; the helper half is unchanged. |
| `RoutingTierCards` gains an opt-in `selection` prop and `select` emit; with no `selection` it renders the Phase 3 DOM exactly (C23) | 4a-4 | None: H1–H15 and the Settings drive's U1–U15 keep every expected value; MR-D21 holds wherever the mode is off. |
| `verify-routing-ui.mjs` gains the selectable states and H16–H20 | 4a-4 | `PASS (15 checks)` → `PASS (20 checks)`; `_verify/routing-ui` 11 → 13 PNGs. |
| K14: `ROUTING_PREVIEW_NOTE` (`routingView.ts:46`) becomes `Launches use a tier only when you choose it in the launch dialog. Team helpers do not use tiers yet.` | 4a-4 | RV21 (`routingView.test.ts:727`); `PREVIEW_NOTE` (`verify-routing-settings-ui.mjs:68`, read by its freshness check :159 and U1 :592). The Settings drive still ends `PASS (16 checks)`. |

## User decisions (resolved 2026-10-03)

| # | Decision |
|---|---|
| MR-D25 | **Chorus sets OpenCode's remembered variant before an interactive launch** (resolves MR-D16). Before an interactive OpenCode launch that sets an effort, routed or not, Chorus rewrites only that model's entry in `<state home>/opencode/model.json` (the `variant` map, keyed by the model id as sent) to the chosen effort, only when such an entry exists and differs; atomically, every other key kept, only on the verified OpenCode 1.18.33. Nothing is written on another version, an unreadable file or without an effort. The state home is the child's: `XDG_STATE_HOME`, else `USERPROFILE`. *Caveat:* it writes another application's state file, and a running TUI may rewrite it. |
| MR-D26 | **Fresh numbers for ranked tiers; Nitro always; no refresh at launch.** Budget, Balanced and Fast need a snapshot no older than `snapshotMaxAgeMinutes` (60) and a non-empty tier, or the card is not launchable and main refuses too. Nitro is always launchable (its payload needs no snapshot). A launch never refreshes on its own; the dialog's Refresh is explicit and uses the launch's credential (MR-D19). A cooldown `BUSY` means the numbers were just refreshed: the launch proceeds on them and the dialog shows main's message. |
| MR-D27 | **The selection persists on the session row only.** Migration v28 adds `sessions.routing_json`; Relaunch re-applies it unchanged (re-ranking is Phase 4b). Launch profiles store no tier. Restart still refuses credentialed sessions; boot restore still heals them to exited. |
| MR-D28 | **Preselect Balanced, then remember.** The dialog preselects the last choice used for the model, else Balanced; "OpenRouter default" stays a choice; a remembered choice that is not launchable falls back to OpenRouter default with a hint; Nitro is never preselected unless it was the last choice. |
| MR-D29 | **Phase 4 is split** into 4a (interactive launches, this phase) and 4b (Teams and re-ranking, provisional). |

MR-D18/D214 is unchanged: Phase 4a adds no key-bearing call. `resolveLaunch` never decrypts, the launch path's single decrypt is the existing `resolveCredential`, and no drive presses Refresh.

## Kickoff decisions (resolved 2026-10-03, coordinator)

| # | Decision |
|---|---|
| K1 | **Tasks, disjoint by file, sequential.** 4a-1 launch routing contracts and resolution: `src/shared/routing.ts` (+ test), new `src/main/routing/launchCore.ts` (+ test), `routingService.ts`, `routingStore.ts`, `routingIpc.ts` (+ tests), one preload line, `verify-routing-ipc.mjs` (D19). 4a-2 the OpenCode adapter: `types.ts`, `opencode.ts`, new `opencodeVariantStateCore.ts` and `opencodeVariantState.ts` (+ tests), `adapters.test.ts` and `mcpConfigWrite.test.ts` (appended blocks), `verify-routing-body.mjs`. 4a-3 launch wiring: `storage.ts`, `db/schema.ts` (+ `schema.test.ts`), `src/shared/ipc.ts` (+ test), `src/main/ipc.ts`, `src/main/index.ts`, `sessionManager.ts`, new `sessionManager.routing.test.ts`, and the sequenced D16 edit of `verify-routing-ipc.mjs`. 4a-4 the dialog: `routingView.ts` (+ test), new `stores/routingLaunch.ts` (+ test), `RoutingTierCards.vue`, `LaunchDialog.vue`, `verify-routing-ui.mjs`, and K14's constant in `verify-routing-settings-ui.mjs`. 4a-5 new `scripts/verify-routing-launch.mjs`. |
| K2 | **Main is the authority for what a tier means.** The renderer sends only `routing_tier?: 'budget' \| 'balanced' \| 'fast' \| 'nitro'` (absent = OpenRouter default); main resolves it at launch with `RoutingService.resolveLaunch` — free, the computation of `routing:tiers` — never from a renderer-built provider object. |
| K3 | **Routing eligibility** (main checks; the dialog mirrors it to decide whether the section renders): agent `opencode`; a credential listed by `RoutingService.credentials()`; the chosen model (`req.model ?? profileModel ?? provider.model`) a registry slug with no `:nitro` suffix; the routing service available; and (K7) a profile env that does not set `OPENCODE_CONFIG_CONTENT`. A `routing_tier` on an ineligible launch is refused with a stated reason, never ignored. |
| K4 | **Ranking inputs at launch:** profile `interactive`, effort = the launch's `model_effort` (payload, else profile, else null), credential = the launch credential. The dialog ranks with the same inputs, not the inspector's fixed `'low'`. |
| K5 | **A selection** (`RoutingLaunchSelection`, persisted as `routing_json`) is strict: `{ tier, model, sentModelId, provider, endpoints, computedAt, snapshotFetchedAt }`, with cross-field rules (C4). Ranked tiers take `provider`/`endpoints` from `TierResult.tiers[tier]`; Nitro takes `buildNitroSelection`'s provider, `endpoints: []`, `snapshotFetchedAt: null`. |
| K6 | **The interactive config content** (pure, `launchCore.ts`): `{ provider: { openrouter: { models: { [sentModelId]: { options: { provider }, variants? } } } } }`; Nitro declares a variant per effort of the base model's catalog row, else the launch's own effort. Carried per process (MR-D3), never in the shared `opencode.json`. `-m` and D179's `agent.build.model` name the SENT id (`route.modelId = sentModelId`). |
| K7 | **Profile-env collision:** a launch whose profile env sets `OPENCODE_CONFIG_CONTENT` refuses a routed launch with a stated reason; such a launch is not routing-eligible, so without a tier it records nothing. |
| K8 | **Remembered choice** in `<userData>/routing/launch-preferences.json` through `RoutingStore` (atomic; missing or corrupt reads as empty). The channel value is `{ lastChoiceByModel: { [slug]: tier \| 'default' } }`; on disk the file also carries `"version": 1` (accepted deviation, for parity with the other routing files; C6). Main records after a successful eligible launch (`'default'` with no tier); the renderer only reads `routing:launch-preferences`. No migration. |
| K9 | **Default in the dialog:** the remembered choice if launchable; with no memory, Balanced if launchable; otherwise "OpenRouter default" with a hint. Nitro is never preselected unless remembered. |
| K10 | **Relaunch** (profile-based sessions only, unchanged precondition): a present `routing_json` must parse strictly; the profile's credential must still be routing-eligible; the content is rebuilt from the persisted selection; `route.modelId = sentModelId`. Anything else refuses with a stated reason, never a silent unrouted relaunch. No re-rank. |
| K11 | **Zero cost; MR-G3 for every OpenCode run in a script.** `verify-routing-body.mjs` stays loopback-only (real OpenCode 1.18.33, isolated XDG state and data, placeholder key). The built-app drive never launches real OpenCode: a stub `opencode` first on the app's `PATH` records argv and env and stays alive, and the app gets a throwaway `USERPROFILE`/`HOME` so MR-D25 writes land there; the user's real `model.json` must be byte-identical before and after. |
| K12 | **Recorded amendments only** (the table above). The Phase 3 Settings drive passes unchanged in count. |
| K13 | **An unrouted `:nitro` launch with an effort declares its variants** (completes MR-D4). Any credentialed OpenCode launch or relaunch on the OpenRouter gateway whose sent id ends in `:nitro` and that carries an effort gets `OPENCODE_CONFIG_CONTENT` with only that id's `variants` (catalog efforts of the base slug, else the launch's own) — no `options.provider`, because no tier was chosen. It is never a tier, never persisted (`routing_json` stays NULL) and never recorded; a relaunch recomputes it. MR-D25 then keeps the `:nitro` key in step. |
| K14 | **The Settings preview note** becomes `Launches use a tier only when you choose it in the launch dialog. Team helpers do not use tiers yet.` — a recorded amendment owned by 4a-4. |

## Clarifications made while drafting

Each fills a gap the K-rules leave, or corrects a premise against the code. Each is stated normatively in the named specification.

| # | Clarification | Spec |
|---|---|---|
| C1 | Two new codes, `SNAPSHOT_STALE` and `TIER_EMPTY` (S4-1 10 → 12), with exact messages: `The endpoint snapshot for this model is more than ${snapshotMaxAgeMinutes} minutes old. Refresh first.` and `${Label} has no eligible endpoints. Choose another tier or OpenRouter default.` | 4a-1 |
| C2 | `resolveLaunch` order: parse, registry, `assertLive`, settings, one clock read (= `computedAt`), then the stored inputs through `storedRankInputs` (the same read order as `tiers()`), then the output parse. No credential row, decrypt or network. | 4a-1 |
| C3 | Nitro reads no store file: provider from `buildNitroSelection`, `snapshotFetchedAt` null, `endpoints` `[]`; launchable with no, a stale or a future snapshot. | 4a-1 |
| C4 | The strict selection schema has cross-field rules (tier ⇔ sent id, endpoints, fetched time, provider; endpoints = `provider.order`; no `:nitro` on the base model), so a tampered `routing_json` cannot relaunch. | 4a-1 |
| C5 | Ranked refusal order: `NO_SNAPSHOT`, a model mismatch (`OPERATION_FAILED`), `SNAPSHOT_STALE`, `TIER_EMPTY`. | 4a-1 |
| C6 | The preferences file: `{"version":1,"lastChoiceByModel":{…}}` (accepted deviation from K8's shape), keys sorted, 65,536-byte cap, missing/corrupt/oversize = empty with one fixed warning; atomic store write; pure parse and text in `launchCore`. | 4a-1 |
| C7 | `recordLaunchChoice` records only a registry slug and a valid choice, writes only on a change, never throws and works after `dispose`; callers record only `'routed'` and `'default'` plans, so a K7-blocked launch records nothing; neither preferences method calls `assertLive`. | 4a-1 |
| C8 | Pure planners `planRoutingLaunch`, `planRoutingRelaunch`, `parseStoredRoutingSelection`, `checkRoutedRoute` and `routingVariantEfforts`, with exact `ROUTING_LAUNCH_REFUSALS`; a profile env that sets `OPENCODE_CONFIG_CONTENT` (case-insensitive) makes a launch never routing-eligible (refused with a tier, `'unrouted'` without one). | 4a-1 |
| C9 | Content shape: `options` then `variants`; efforts cleaned (pattern, dedupe, order kept); ranked tiers declare no variants; a catalog `[]` lists none; the same cleaning for K13's variants-only content. | 4a-1 |
| C10 | The MR-D25 hook sits in `opencodeAdapter.writeMcpConfig`, after the file write, only with an effort block and `ctx.cliState`, keyed by `agent.model`; `McpWriteResult` is unchanged. | 4a-2 |
| C11 | Optional `McpWriteContext.cliState { stateHome, installedVersion }`, composed by main; absent means nothing outside `chorusConfigDir` is written. | 4a-2 |
| C12 | The patch writes only an existing, differing `variant[modelKey]`; plain-object root and `variant`; compact 1.18.33 output; 1 MB cap; temp-fsync-rename; invalid input is skipped. | 4a-2 |
| C13 | The state-home rule, measured with `opencode debug paths`: `XDG_STATE_HOME`, else `USERPROFILE`, else `os.homedir()`; `HOME` ignored; case-insensitive lookup. | 4a-2 |
| C14 | `verify-routing-body.mjs`: TUI cases from the real builders (routed and K13 content, `buildLaunch`, `writeMcpConfig`, `composeChildEnv`); the only harness patch is the loopback `baseURL` plus `share: 'disabled'`; the K13 and MR-D25 cases and a real-state guard; the evidence directory deleted on every exit path, the report on stdout only; only XDG state and data isolated (config and cache stay the user's); a new `PASS (16 checks)` convention for this script. | 4a-2 |
| C15 | The script's TUI environment uses `composeChildEnv`'s credential branch, as production does, with the XDG isolation passed as profile env. | 4a-2 |
| C16 | The plan and `resolveLaunch` run before `resolveCredential` (no decrypt, no row on a refusal); the gateway check after the decrypt and before `mintForDispatch`; multi-slot batches resolve per slot. | 4a-3 |
| C17 | `withMcpEnv` builds `cliState` only when an effort is set: the state home from `composeChildEnv` with the credential's name only (no key value), the version from `detectClis()`; both `wireMcpForLaunch` calls receive it. | 4a-3 |
| C18 | MR-G6 via the IPC drive's D16 (`node:sqlite` read of the throwaway `chorus.db`; freshness gains `storage.ts` and `ipc.ts`; still 20 checks; a sequenced cross-task edit) plus a v28 block in `schema.test.ts` (count 19 → 20). | 4a-3 |
| C19 | Relaunch records no choice and never rewrites `routing_json`; an unreadable row, a non-opencode agent, an ineligible credential or K7 refuses; K13 content is recomputed, never stored; restart and restore are unchanged. | 4a-3 |
| C20 | `registerIpc` gains `routing: () => RoutingService \| null` after `fleet`, before the optional `teamRuntime`; the thunk is read once per handler call. | 4a-3 |
| C21 | `launchModelId` (the `:AgentSession` MERGE, the memory contract's `modelId`, `SessionStartInfo.model`) becomes the sent id on routed launches (`…:nitro` for Nitro); unrouted launches are unchanged. | 4a-3 |
| C22 | Nitro and K13 variant efforts come from the credential provider's `model_catalog` row for the base slug (`catalogEffortsFor`, `routingBaseModelId`), else the launch's own effort; on this machine no such row exists, so the fallback applies. | 4a-3 |
| C23 | One opt-in `selection` prop and one `select` emit on `RoutingTierCards`; without a selection it renders the Phase 3 DOM exactly; every string comes from the view model (Phase 3 C15). | 4a-4 |
| C24 | "OpenRouter default" is the fifth radio inside `RoutingTierCards`: one group, one accessible name, native arrow keys. | 4a-4 |
| C25 | Disabled reasons: the card's own reason for no snapshot or an empty tier; `Refresh first: the numbers are older than N min.` when stale; stale wins over empty; the extra line only when it differs from the card's own. | 4a-4 |
| C26 | A remembered tier that is not launchable falls back to OpenRouter default with a hint (`Refresh to use <Tier>.` / `<Tier> has no endpoint that meets the rules right now.`), not to Balanced. | 4a-4 |
| C27 | A clicked choice is kept only while launchable; otherwise the K9 default with `<Tier> can no longer be launched. <reason>`. | 4a-4 |
| C28 | Ranking mirrors main: the profile's credential, else the api-key pick; effort = `modelEffort ?? profile.model_effort ?? null`; profile `interactive`. | 4a-4 |
| C29 | K7 mirror: a launch profile whose env sets `OPENCODE_CONFIG_CONTENT` hides the section (`envJsonKeys`, reason `profile-env`), in main's order. | 4a-4 |
| C30 | The store loads once per open when OpenCode and a credential are chosen, ranks only when fully eligible; `reset()` keeps the refresh state; `loadSeq`/`tiersSeq` drop late replies. | 4a-4 |
| C31 | Launch is disabled and Enter guarded while routing data loads. | 4a-4 |
| C32 | A cooldown `BUSY` means the numbers were just refreshed, so the launch proceeds on them; the dialog shows main's message naming the seconds; the live countdown runs only after the dialog's own network-reaching refresh (Phase 3 C12). | 4a-4 |
| C33 | `LaunchDialog` adds `<style src="../assets/settings.css">`, emitted once (`.set-card-protected` count 1). | 4a-4 |
| C34 | A display-only 1 s ticker (Phase 3 C19); the providers table is included, collapsed, scrolling inside its box at 640 px. | 4a-4 |
| C35 | `LaunchDialog.vue` is edited byte-wise only (I1–I7 + R1): CRLF = 2,088 + inserted, 7 lone LF, 0 CR, `w/mixed`. | 4a-4 |
| C36 | Two app runs; the catalog row with efforts is seeded with `node:sqlite` between them (only `model:refresh`, a live call, writes it); the shortlist via the real IPC. | 4a-5 |
| C37 | Stub: an npm-shaped `opencode.cmd` → `node <stub>.cjs`; it answers `--version` (`1.18.33`) and `run --help` without recording; otherwise it records argv and env beside itself and stays alive. | 4a-5 |
| C38 | The app gets a throwaway `USERPROFILE`/`HOME`/`HOMEDRIVE`/`HOMEPATH` and decoy `XDG_STATE_HOME`/`XDG_DATA_HOME` that must stay empty. | 4a-5 |
| C39 | Every launch is Solo, one slot, Current tree; `git worktree list` and `git status` are unchanged (L17). | 4a-5 |
| C40 | Relaunch is proven on a stale snapshot with identical content; the row's `computedAt` is earlier than the relaunch. | 4a-5 |
| C41 | A second, non-routable OpenCode credential (provider B) proves the K3 mirror on real data. | 4a-5 |
| C42 | Providers are compared with main's `routing:tiers` reply and `routing_json`, never a golden order (Phase 3 C18). | 4a-5 |
| C43 | Key-scan positive control: each capture's `OPENROUTER_API_KEY` equals the fake key; keys are built at run time. | 4a-5 |
| C44 | The last-resort stub kill uses the recorded pid only after `Win32_Process` (by `ProcessId`) confirms the stub's command line. | 4a-5 |

## Sequence and file ownership

Execute 4a-1 → 4a-2 → 4a-3 → 4a-4 → 4a-5. Each depends on the ones before. Ownership is disjoint by file, with one sequenced exception: `scripts/verify-routing-ipc.mjs` is 4a-1's (D19), and 4a-3 then edits its D16 detail and freshness list for MR-G6 without changing the count (C18). A downstream task that needs an upstream change records it in its report and makes it in the upstream file with a test; it does not work around it.

| Task | Deliverable | Depends on | Files owned |
|---|---|---|---|
| [4a-1](Task-4a-1.md) / [spec](../ImplementationSpecs/ImplementationSpec-4a-1.md) | Launch routing contracts and resolution | Phase 3 | `src/shared/routing.ts` (amendments + the "Phase 4a — launch routing (Task 4a-1)" block) and test; new `src/main/routing/launchCore.ts` and test; `routingService.ts`, `routingStore.ts`, `routingIpc.ts` and their tests; one line in `src/preload/index.ts`; `scripts/verify-routing-ipc.mjs` (D19) |
| [4a-2](Task-4a-2.md) / [spec](../ImplementationSpecs/ImplementationSpec-4a-2.md) | OpenCode interactive config and the remembered variant | 4a-1 | `src/main/adapters/types.ts`, `opencode.ts`; new `opencodeVariantStateCore.ts`, `opencodeVariantState.ts` and their tests; appended blocks in `adapters.test.ts` and `mcpConfigWrite.test.ts`; `scripts/verify-routing-body.mjs` |
| [4a-3](Task-4a-3.md) / [spec](../ImplementationSpecs/ImplementationSpec-4a-3.md) | Launch wiring, migration v28 and relaunch | 4a-1, 4a-2 | `storage.ts`; `db/schema.ts`, `db/schema.test.ts`; `src/shared/ipc.ts`, `ipc.test.ts`; `src/main/ipc.ts`; `src/main/index.ts`; `sessionManager.ts`; new `sessionManager.routing.test.ts`; the D16/freshness edit of `verify-routing-ipc.mjs` |
| [4a-4](Task-4a-4.md) / [spec](../ImplementationSpecs/ImplementationSpec-4a-4.md) | The launch-dialog tier picker | 4a-1 to 4a-3 | `src/shared/routingView.ts` and test; new `stores/routingLaunch.ts` and test; `components/routing/RoutingTierCards.vue`; `components/LaunchDialog.vue`; `scripts/verify-routing-ui.mjs`; `scripts/verify-routing-settings-ui.mjs` (one line, K14) |
| [4a-5](Task-4a-5.md) / [spec](../ImplementationSpecs/ImplementationSpec-4a-5.md) | The built-app launch drive | 4a-1 to 4a-4 | new `scripts/verify-routing-launch.mjs` |

No new dependencies. No roadmap, Plan_1 or Phase 0–3 document edits (the coordinator records the outcome, and updates `Phase-0-Findings.md`'s "how to re-run" line at phase end). Each task commits only its own files.

## Gates

| Gate | In Phase 4a |
|---|---|
| MR-G1 | Every task: `npm run typecheck` and `npm test` pass. Real checks: 4a-1 the IPC drive (`PASS (20 checks)`); 4a-2 the body script (`PASS (16 checks)`); 4a-3 the IPC drive with v28 in D16 and the body script; 4a-4 the harness (`PASS (20 checks)`), the IPC drive and the Settings drive (`PASS (16 checks)`); 4a-5 the launch drive (`PASS (20 checks)`) and every earlier drive. |
| MR-G2 | `verify-routing-body.mjs` runs on Chorus's real builders (4a-2) and is re-run by 4a-3 (which composes the content a launch carries) and at phase end; it proves the routed provider object, Nitro's declared variants, K13's variants-only content and MR-D25 against the real OpenCode 1.18.33. |
| MR-G3 | Every OpenCode run in the body script has its own `XDG_STATE_HOME` and `XDG_DATA_HOME`; the launch drive runs no real OpenCode and gives the app decoy XDG directories and a throwaway home; both prove the user's real `model.json` byte-identical. |
| MR-G4 | `resolveLaunch` never decrypts; the routing content and the state write carry no secret; `cliStateFor` uses only the credential's name; both app drives scan responses, logs and captures against `secret-patterns.json` with positive controls; `npm run grep:secrets` is clean after the drives. |
| MR-G5 | `routing:launch-preferences` is parsed in and out in main (I12); `routing_tier` is parsed in main by `launchRequestSchema`; the dialog's payload stays a literal of primitives and the launch store's arguments are snapshots (LS13, with a reactive negative control); the preload stays Zod-free (it only constructs schemas through its existing `shared/ipc` import). |
| MR-G6 | Migration v28 is verified against a throwaway `--user-data-dir` by the IPC drive's D16 (4a-3) and the launch drive (L1, L16), and in-memory by the `schema.test.ts` v28 block. |
| MR-G7 | Not applicable: no probe and no paid call; no drive presses Refresh. |
| MR-G8 | `launchCore.ts` and `routingView.ts` are pure (the purity, layering, import and no-parse greps print nothing); the ranker is untouched and prints `PASS (30 checks)`. |

## Risks

- **MR-D25 writes another application's state file.** It touches one existing key, atomically, only on 1.18.33; but a running OpenCode TUI may rewrite the file afterwards (a lost update either way), and a stale `detectClis()` memo can let one write through for a newer binary until the next detection.
- **The shared `opencode.json` is still one per app.** `agent.build` is rewritten at every launch, so two concurrent OpenCode launches with different efforts race (the D179 trap, unchanged by this phase); routing itself is per process and does not race.
- **No unit test exists for the SessionLaunch and SessionRelaunch handlers** (there is no `src/main/ipc.test.ts`). The post-decrypt gateway refusal and the relaunch refusals are covered only by the pure planner tables (L11–L13, L18) and the drive's happy and stale paths; review must check the call order against ImplementationSpec-4a-3.
- **Relaunch's pre-existing use of `provider.model` for unrouted sessions is untouched** (Phase 4b); a routed relaunch sets its own sent id, and K13 on relaunch uses whatever the route names.
- **The two screens can show different orders.** The dialog ranks at the launch's effort, Settings at the fixed `'low'`.
- **Time-of-day prices can change an order** between the dialog's display and main's resolution at launch; main's resolution wins and is what `routing_json` records.
- **A profile env that sets `XDG_STATE_HOME` or `USERPROFILE`** moves the child's state home; `cliStateFor` follows it through `composeChildEnv`, but a K7-style collision on those names is not refused.
- **`Phase-0-Findings.md` goes stale** when 4a-2 lands: its "Reports go to `%TEMP%/chorus-routing-body-*`" no longer holds (the script prints its report and deletes its directory). The coordinator updates it at phase end.
- **The launch drive relies on OpenCode's state-path behaviour measured on 1.18.33** and on `os.homedir()` following `USERPROFILE`; an OpenCode upgrade must re-measure before the drive is trusted.
- **`shared/ipc.ts` now value-imports `./routing`**, so the preload bundle also constructs routing's schemas. Nothing parses there (Zod compiles on the first parse), but a future parse in the preload would break under the CSP.
- **CRLF and mixed files.** Eleven CRLF and three edited mixed files; `LaunchDialog.vue` is edited only by a byte-wise script. Check `git diff --stat` and `git ls-files --eol` after every edit.

## Handoff to Phase 4b

- **MR-D15.** The TeamLaunchDialog per-slot tier dropdown, with an optional field on the strict team member schema flowing through `HelperExecutionInput` to the helper's per-model options.
- **Re-ranking (MR-D10).** Helper re-rank between attempts; "Re-rank and relaunch" for interactive sessions (a plain relaunch keeps the persisted selection, MR-D27).
- **Guardrail revalidation after access errors (MR-D12)** and runtime failover messages (Plan_1 §12).
- **MR-D17**, a real outage of a pinned primary.
- **The relaunch `provider.model` gap** for unrouted sessions, if still open.
- **Whether launch profiles should ever carry a tier** (MR-D27 says no for 4a).
- **Still open from Phase 3:** W3 has no structured field; the providers grid scrolls inside its box; any window passes the IPC sender check.

## Verification and completion

Each task runs its own commands. At phase end, from the repository root:

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

All six `Select-String` lines print nothing (the last proves the old preview note is gone from all three K14 places). `opencode --version` prints `1.18.33`. The six scripts end, in order, `PASS (30 checks)`, `PASS (20 checks)`, `PASS (20 checks)`, `PASS (16 checks)`, `PASS (16 checks)` and `PASS (20 checks)`, each with exit code 0. `_verify/routing-ui` holds the eleven Phase 3 PNGs plus `select-golden.png` and `select-stale.png`; `_verify/routing-launch` holds exactly `launch-fresh.png`, `launch-nitro.png` and `launch-stale.png`; no `%TEMP%\chorus-routing-body-*` or `chorus-routing-launch-*` directory remains. The CSS count prints `1`. The `LaunchDialog.vue` counts print `crlf` 2,088 + the inserted lines, `lf` 7, `cr` 0. `git ls-files --eol` reports `w/crlf` for the first ten files, `w/mixed` for `schema.ts`, `sessionManager.ts` and `LaunchDialog.vue`, and `w/crlf` for `schema.test.ts`. `npm run grep:secrets` scans `_verify/`, so run it after the drives have deleted their bundles. `git status --short` must still show the pre-existing entries above, unchanged. Record actual exit codes and output; a passing subset is not a full-suite pass.

**Driving the dev app by hand** (not required by any gate): in a separate PowerShell window, `$env:REMOTE_DEBUGGING_PORT='9333'; $env:USERPROFILE='<throwaway home>'; npx electron-vite dev -- "--user-data-dir=<throwaway profile>"`. The throwaway `USERPROFILE` matters whenever a launch sets an effort, because MR-D25 then writes OpenCode's state under that home (OpenCode ignores `HOME`; main uses `os.homedir()`, which follows `USERPROFILE`). A launch with a real OpenRouter key runs real OpenCode against OpenRouter and spends; the gates never do. Never point a drive at `%APPDATA%\chorus*` or at port 9222 while another instance holds it, and never stop `electron.exe` or `Chorus.exe` by name; the installed Chorus is running. Dev never rebuilds MAIN on edit, so kill your own dev instance by its pid and relaunch before measuring a main-process change.
