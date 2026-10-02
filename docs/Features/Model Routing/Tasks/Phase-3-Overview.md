# Phase 3 — UI (the routing inspector in Settings) overview

Created 2026-10-02. **Status: Not started.** User decisions MR-D21 to MR-D24 are resolved (user, 2026-10-02) and are recorded in the roadmap by the coordinator. Kickoff decisions K1–K10 are resolved (coordinator, 2026-10-02). Clarifications C1–C20 were made while drafting the specifications; the coordinator reviewed and accepted them on 2026-10-02.

## Phase contract

Give Phase 2 a screen. Settings gains a **Model routing** section that inspects one registry model: the four tier cards (Budget, Balanced, Fast, Nitro), the all-providers table with exclusion reasons, the snapshot's age, a Refresh action that states its cost before it runs and its spend after, the background-observation consent (MR-D19) and the data-collection opt-in (MR-D11). The cards, the table and the refresh status are reusable presentational components, so Phase 4 can place them in the launch dialog unchanged.

Nothing reaches a launch, and nothing is selectable. Phase 3 does not touch `LaunchDialog.vue` or `TeamLaunchDialog.vue`, adds no migration and changes no OpenCode config (MR-D21). The [feature roadmap](../roadmap.md) is authoritative for MR-D1 to MR-D20 and gates MR-G1 to MR-G8; MR-D21 to MR-D24 are the user decisions below. Where [Plan_1](../Plan_1.md) §2 and §12 differ from this document (the launch-dialog placement, `ModelPicker.vue`, "remember the last tier", the channel names), this document wins. Phase 2's contracts are in the [Phase 2 overview](Phase-2-Overview.md).

**Exit:** MR-G1, MR-G4, MR-G5, MR-G7 (as display) and MR-G8 pass. The inspector renders every state from the golden `TierResult` and its variants in an isolated harness, and a zero-cost drive of the built app opens Settings → Model routing in a throwaway profile, round-trips both settings through main, renders a seeded snapshot, and makes no OpenRouter request.

## Grounding

Verified 2026-10-02 at `5079b5d` on branch `feature/model-routing` (by opening each file this session). Line numbers drift; recheck at execution.

| Location | Fact |
|---|---|
| `src/shared/routing.ts:535` | `ROUTING_CHANNELS`: eight request channels and the broadcast `progress` (:544). `RoutingApi` (:554) ends with `observationSet` (:562) and `onProgress` (:563). `routingStatusSchema` (:516) has no cooldown field. `ROUTING_ERROR_CODES` (:393) has `BUSY` (:398). `credentialProfileIdSchema` (:353). `TierResult` (:289) is mirrored by `tierResultSchema` (:468). The file imports only `zod` (:1). |
| `src/main/services/routingService.ts:329` | `refresh()`: parse (:333), registry (:334), `assertLive` (:335), in-flight `BUSY` (:336, message :154), then `withRoutingKey` (:342), whose `checkCredential` (:452) runs before the one decrypt (:472). No progress event before the first network step (C17 of Phase 2). `models()` (:294) and `status()` (:372) do not call `assertLive`. `setObservation` (:423) checks the credential whenever an id is set (:427). `RoutingStorageLike` (:97–105) picks six storage methods. The C21 knobs are validated in the constructor (:264–272). |
| `src/main/services/routingIpc.ts:102` | Eight `handle(…)` registrations (:102–110); the header says "Eight request channels" (:25); `RoutingIpcDeps.service` is a `Pick` (:48–51). |
| `src/main/services/routingIpc.test.ts:176` | I1 asserts eight request channels (:178); I4 asserts eight responses (:248); the per-channel tables `VALID` (:96), `WRONG_TYPE` (:107) and `actions` (:143). |
| `src/shared/routing.test.ts:310` | S5-1 asserts nine channel values (:312–313). |
| `src/main/services/routingService.test.ts:199` | `makeHarness` runs on a fixed clock (`NOW` :54). V14 (:782), V20 (:875) and V29 (:1141) refresh the same model twice at the same instant, so a 60 s cooldown would refuse their second refresh. The harness `deps` is a `Pick` of the C21 knobs (:193); the storage fake has no list methods (:207–218). |
| `src/main/routing/routingCredentialCore.ts:64` | `checkRoutingCredential(profile, provider, gateway)`: pure, refuses not-found, provider-missing, management, not-api-key, not-openrouter, unavailable, in that order. |
| `src/main/services/storage.ts:2304` | `listProviderConfigs()` (:2304); `listCredentialProfiles()` (:2354, ordered by `createdAt`). |
| `src/main/services/teamMemberProfiles.ts:11` | The gateway URL is already written out in four files besides `openrouterKeys.ts`: here (:11), `teamRuntime.ts:108`, `adapters/helpers/opencode.ts:12`, `adapters/helpers/evidence.ts:31` and :36. The team list (:14–18) returns labels unscrubbed. |
| `src/preload/index.ts:161` | The `routing:` block (:161–171): `observationSet` (:169), `} as RoutingApi,` (:171); "no Zod here" (:138); type-only import (:3). |
| `src/main/index.ts:1416` | `routing = new RoutingService({ storage: store, vault, store: routingStore })` passes the whole `StorageService`, so widening `RoutingStorageLike` needs no edit here. |
| `scripts/verify-routing-ipc.mjs:64` | 18 checks (:64–70); a freshness check (:88–107); launches its own built app with a throwaway profile and a free port (:116–131); kills only its own child, by pid (:149–156). |
| `src/renderer/src/views/SettingsView.vue:30` | `SettingsSection` (:30), the `section` ref (:35), the nav (:75–126; `data-settings-nav` at :96, :105, :112), the content `v-if` chain (:129–135), and the no-dead-entries rule (:17–28): a row and its section land in the same change. 139 lines. |
| `src/renderer/src/views/SettingsAppearance.vue:21` | The apply-immediately precedent: "NO SAVE BUTTON" (:21–24), `commit` (:43–55) adopts what main returns (:49). It imports a value from `shared/ipc` (:3), so a shared Zod module already loads in the renderer. |
| `src/renderer/src/views/SettingsVoice.vue:181` | `save()` (:181) calls `flashSaved()` (:203) only after a write main accepted (`composables/savedFlash.ts:33`). |
| `src/renderer/src/assets/settings.css:213` | `.set-card-protected` (:213–217): the amber edge from `--color-state-attention` (`main.css:135`). Chips `.set-chip-ok/idle/warn/err` (:423–463), `.set-row` (:469), `.set-pill` (:566), `.set-select` (:630), `.set-btn-primary` (:688), `.set-hint-warn` (:321). |
| `src/renderer/src/stores/team.ts:4` | `plainTeamInput` (:4); `teamValue` (:5) throws a plain `Error` and loses the code; the ref-counted `connect()` (:14–23). Its test uses `setActivePinia(createPinia())` (`team.test.ts:8`) and `vi.stubGlobal('window', …)` (:12). |
| `src/renderer/src/stores/council.ts:259` | `subscribe()` (:259): adopts a broadcast run id only while its own run is in flight and none is bound (:292–297). |
| `src/renderer/src/components/EngineUsagePanel.vue:190` | CSS-grid rows (`.eu-metric` :190–196). No `<table>` element exists under `src/renderer/src`. |
| `src/renderer/src/App.vue:378` | `activeView` (:378); `openSettings` (:909), emitted by the rail button `aria-label="Open settings"` (`ProjectRail.vue:899–900`); `SettingsView` mounts under `v-if` (:1038). |
| `vitest.config.ts:11` | `environment: 'node'`, `include: ['src/**/*.test.ts']` (:12). `package.json` has no `@vue/test-utils`, `happy-dom` or `jsdom`; `.vue` files are only type-checked (`typecheck:web`, :14). |
| `scripts/verify-team-review-ui.mjs:37` | The isolated-harness precedent: a vite build of a fixture that mounts real `.vue` files (:37), an offscreen Electron runner with `capturePage()` (:38–47), output under `_verify/` (:8), which is gitignored (`.gitignore:165`). |
| `scripts/team-member-ui-checks.mjs:7` | Filling a v-model field over CDP: set `.value`, dispatch `input` and `change` (:7–10). |
| `scripts/verify-routing-body.mjs:20` | esbuild (a transitive dependency, 0.25.12 installed) bundles TypeScript into `_verify/` for a script. |
| `src/main/routing/storeCore.ts:65` | `modelDirName` (:65), `snapshotFileText` (:150), `observationsFileText` (:161); `endpointsCore.ts` `parseEndpointsResponse` (:75), `extractObservations` (:176). |
| `src/main/routing/__fixtures__/endpoints-deepseek-v4.1-flash-2026-10-02.json` | `fetchedAt` 2026-10-02T09:05:00Z, 33 rows for 32 tags, `guardrailRemoved` and `dataPolicyDenyRemoved` both `['deepseek']`, 15 `cacheVerified` entries. |
| `src/main/routing/model-registry.json` | One model: `deepseek/deepseek-v4.1-flash`, "DeepSeek V4.1 Flash". |
| `src/main/routing/routingCore.ts:82` | Age is floored minutes and `stale = ageMs > snapshotMaxAgeMinutes × 60,000` (:82–84). W1 is pushed first, and only when stale (:120–122); W2–W7 follow in order (:123–143). |
| `src/main/routing/eligibilityCore.ts:50` | `truncatePct` (:50–52): uptime reasons truncate, never round. |
| `src/main/routing/rankerCore.ts:43` | `budgetFloor` (:43); the floor applies to raw p50 throughput (:166). |
| `src/main/routing/cacheProbeCore.ts:22` | `CACHE_PROBE_CAP_USD = 0.05`. |
| `src/main/services/routingObserver.ts:91` | `status()` derives `dormantReason` and `state` (:91–119). |
| `src/renderer/src/components/LaunchDialog.vue` | 2,095 lines, mixed line endings; `modelEffortLevels` looks up the exact id (:288). `TeamLaunchDialog.vue` is 118 lines. Neither is touched. |
| `docs/design/v2/` | Nine D73 mocks and `support.js`; none mentions routing, tiers or Nitro, so the section follows the settings anatomy in `settings.css`. |

**Line endings.** `git ls-files --eol` reports `w/crlf` for `src/main/index.ts`, `src/preload/index.ts`, `src/main/services/storage.ts`, `src/renderer/src/views/SettingsView.vue`, `src/renderer/src/components/EngineUsagePanel.vue` and `ProjectRail.vue`; `w/lf` for `SettingsVoice.vue`, `SettingsAppearance.vue`, `settings.css`, the routing services and tests, `stores/team.ts`; `w/mixed` for `LaunchDialog.vue`. `core.autocrlf` is `true` and there is no `.gitattributes`. Phase 3 edits two CRLF files (`src/preload/index.ts`, `SettingsView.vue`); each task checks that `git diff --stat` shows only its insertions and that `git ls-files --eol <file>` still reports `w/crlf`. The second check matters: with `core.autocrlf` true, `git diff` normalises line endings, so a whole-file CRLF→LF rewrite can be invisible to the first.

**Golden view values.** Every expected string in the 3-2 and 3-3 tables was computed on 2026-10-02 by bundling the Phase 1 cores at `5079b5d` with esbuild in a scratch directory, running the golden input of [ImplementationSpec-1-3](../ImplementationSpecs/ImplementationSpec-1-3.md) ("Golden input") and its variants through `computeTiers`, and then through a scratch prototype of the ImplementationSpec-3-2 rules. The prototype is not committed. Raw `TierResult` numbers come from `computeTiers` directly and match the Phase 1 golden table.

## Preserved state

Pre-existing worktree state at kickoff: ` M .mcp.json`, ` M docs/Features/Engine/chorus-engine-spec.md`, ` M electron-builder.yml`, ` M package.json`, and seven untracked files under `docs/troubleshooting/`. Do not revert, stage, commit or overwrite any of them. Stage explicit paths only; the repository is public.

Phase 1 and Phase 2 contracts are frozen except for the amendments recorded below. The golden fixture and every golden expectation stay as they are, and `node scripts/verify-routing-ranker.mjs` must keep printing `PASS (30 checks)`.

### Recorded contract amendments to Phase 2 (Task 3-1)

These are contract changes, made on purpose and listed here so that no test edit reads as "changing an expectation to make a test pass".

| Amendment | Phase 2 test or script that changes with it |
|---|---|
| `ROUTING_CHANNELS` gains `credentials: 'routing:credentials'`; `RoutingApi` gains `credentials(input)` | S5-1: nine unique values → ten. I1: eight request channels → nine. I4: eight responses → nine. `VALID`, `WRONG_TYPE` and `actions` gain the channel, so I2, I3, I5 and I6 cover it. |
| `RoutingIpcDeps.service` picks `credentials` too; one more `handle(…)` line | `routingIpc.ts` header: "Eight request channels" → "Nine". |
| `RoutingStorageLike` gains `listCredentialProfiles` and `listProviderConfigs` | The `routingService.test.ts` storage fake gains both methods over its existing maps. |
| `RoutingServiceDeps` gains `refreshCooldownMs`; `refresh()` can now answer `BUSY` with a cooldown message | `makeHarness` passes `refreshCooldownMs: 0` unless a test asks otherwise, so V14, V20 and V29 keep their second refresh and every existing clock-call sequence is unchanged (C3). |
| The preload `routing:` block gains one line | I9 reads every channel literal, the new one included. |
| `verify-routing-ipc.mjs` gains check `D18 credentials empty` and a preload freshness string | Its last line becomes `PASS (19 checks)`. |

## User decisions (resolved 2026-10-02)

| # | Decision |
|---|---|
| MR-D21 | **Phase 3 is the Settings inspector; the launch-dialog picker and the Team per-slot dropdown move to Phase 4.** Phase 3 ships a fully working Settings → Model routing section: observation consent, the data-collection opt-in, a Refresh action that states its cost, the four tier cards and the all-providers table. The cards and the table are reusable components. Phase 4 places them in `LaunchDialog` and adds the `TeamLaunchDialog` per-slot dropdown (MR-D15) in the same phase that makes a tier affect a launch. *Why:* nothing selectable-but-ignored ever exists. `LaunchDialog.vue` and `TeamLaunchDialog.vue` are not touched in Phase 3. |
| MR-D22 | **Main-side refresh cooldown: 60 s per model.** `RoutingService.refresh` refuses a refresh of the same model within 60 s of the end of the previous refresh that reached the network, with `RoutingError('BUSY', …)` and a message naming the seconds remaining (`This model was refreshed less than a minute ago. Try again in 42 s.`). Pre-network refusals and observer ticks do not start the cooldown. The check is itself a pre-network refusal: no event, no credential read, no decrypt. The UI counts down after its own refresh and shows the `BUSY` message otherwise. The length is a constructor knob (`refreshCooldownMs`, default 60,000) like C21's, never reachable from IPC. *Why:* a renderer bug cannot loop spend. |
| MR-D23 | **Turning observation off clears the designation.** The UI sends `{ enabled: false, credentialProfileId: null }`; turning it on needs a credential chosen again. No main-side change; this resolves the Phase 2 carry-over. |
| MR-D24 | **The UI exposes only background observation and the data-collection opt-in.** Ranking knobs stay at their defaults until Phase 5. The opt-in writes the whole `RoutingSettings` object, read-modify-write (`settingsSet` takes the whole strict object), flipping only `dataCollection` between `'deny'` (default) and `'allow'`. |

No Foundation `D` number is needed: Phase 3 adds no key-bearing call. `routing:credentials` never decrypts, and MR-D22 only narrows MR-D18's class 1 (D214).

## Kickoff decisions (resolved 2026-10-02, coordinator)

| # | Decision |
|---|---|
| K1 | **Tasks, disjoint by file.** 3-1 main support: `RoutingService.credentials()` and the `routing:credentials` channel (credential profiles that pass `checkRoutingCredential`, never decrypted, as `{ credentials: [{ id, label, providerName }] }` in a deterministic order; the renderer never re-implements the gateway predicate), `RoutingStorageLike` widened, and the MR-D22 cooldown; the amendments above; no status field for the cooldown (`routingStatusSchema` unchanged). 3-2 the pure view model `src/shared/routingView.ts` (imports only `./routing`; `now` is a parameter) and the Pinia store `stores/routing.ts`. 3-3 presentational components under `src/renderer/src/components/routing/` and the isolated harness `scripts/verify-routing-ui.mjs`. 3-4 `SettingsRouting.vue`, the `SettingsView.vue` row and section, and the built-app drive `scripts/verify-routing-settings-ui.mjs`. |
| K2 | **No new dependencies; no `.vue` unit tests.** Every decision lives in tested pure helpers (`routingView.ts`) and the store (tested with a stubbed `window.chorus` and `setActivePinia(createPinia())`, as `team.test.ts`). Components are verified by the isolated harness (3-3) and the built-app drive (3-4). |
| K3 | **Refresh is explicit only:** never on mount, never on a timer. The `probe-plan` estimate shows as soon as it arrives and the `done` spend after (MR-G7), with per-stage progress (`endpoints`, `preflight`, `probe-plan`, `probe` n of N, `done` or `failed`). One exact money rule (C5). |
| K4 | **IPC hygiene (D14, MR-G5).** Every payload is a JSON snapshot (`plainRoutingInput`). `routingValue` throws an error that keeps `code` and `message` (unlike `teamValue`). The progress subscription is reference-counted like `stores/team.ts`, and adopts the `refreshId` of events for the model it is refreshing, ignoring others. |
| K5 | **Inspector inputs:** the model (from `routing:models`; today only DeepSeek V4.1 Flash), the profile (Interactive / Team helper → `interactive` / `helper`), effort fixed to `'low'` with a caption saying so, and a "Refresh with" credential from `routing:credentials` (the designated credential if usable, else the first). `routing:tiers` uses that credential for account eligibility; with none, `credentialProfileId: null` (eligibility unknown). Tiers load on section open and after every refresh or setting change (free; no network). |
| K6 | **Text from numbers (Phase 1 carry-over).** Never reuse `TierSelection.rationale` or W1's text. Explain the Budget floor from `budgetFloorExcluded` and `budgetFloorTps`. Show the snapshot age from `snapshotFetchedAt` and `now` (stale beyond `snapshotMaxAgeMinutes`). Show `TierResult.warnings` verbatim in a notes list (W3 still has no structured field). The Nitro card per Plan_1 and MR-D11: "Nitro — unfiltered provider routing", amber border, the likely endpoint and the rules it fails, softened text when it fails none, and a no-snapshot state. |
| K7 | **Providers table:** CSS-grid rows (no `<table>` in the repo); columns per Plan_1 (provider/tag, quant, uptime 1d, input, output, cache read, blended, TPS, latency, status); status `Eligible` or `Excluded: <reason>` from `excludedBy`; limited-history and cache-verified indicators; collapsed behind "Show all providers (n eligible · m excluded)". |
| K8 | **Observation UI (MR-D19, MR-D23):** a toggle and a credential select; on → `observationSet({ enabled: true, credentialProfileId })` (a refusal shows `CREDENTIAL_REFUSED`'s message); off → `{ enabled: false, credentialProfileId: null }`. Show the observer status from `routing:status` and warn when the designated id is not in the `routing:credentials` list. |
| K9 | **Apply immediately** for both settings (the Appearance pattern), with `flashSaved()` and the returned stored value as the new state. |
| K10 | **Zero cost throughout.** No paid check is required (Phase 2 proved the refresh's spend and ordering live). An optional, user-run manual check is described in Task 3-4 and marked as such; Claude Code's auto mode blocks paid runs. |

## Clarifications made while drafting

Each fills a gap the K-rules leave, or corrects a premise against the code. Each is stated normatively in the named specification.

| # | Clarification | Spec |
|---|---|---|
| C1 | **The credentials list.** Rows whose id is not a UUID are omitted (a refresh request could never name them); `label` and `providerName` pass through `scrubSecrets` (they are user text, as the refusal messages are); order is `label`, then `id`, by code unit; the call works after `dispose()`, like `models()` and `status()`. | 3-1 |
| C2 | **The cooldown's boundary is Phase 2's C17 boundary.** A refresh "reached the network" once it got past every pre-network refusal (the decrypt succeeded and the envelope base URL passed), which is exactly where its progress events begin. Its end is the service clock in `refresh`'s `finally`. A refresh is refused when `0 ≤ elapsed < refreshCooldownMs`; a negative elapsed (the clock moved back) is not refused. Seconds remaining are `ceil((cooldown − elapsed) / 1000)`. Order: parse, registry, `assertLive`, in-flight `BUSY`, cooldown. | 3-1 |
| C3 | **The knob.** `refreshCooldownMs` is an integer from 0 to 60,000, validated in the constructor with `RangeError` like C21; 0 disables the cooldown and reads no clock for it. The bound keeps "less than a minute ago" true. The Phase 2 harness passes 0 unless a test opts in. | 3-1 |
| C4 | **Two shared constants.** `ROUTING_REFRESH_COOLDOWN_MS = 60_000` (main's default and the renderer's countdown) and `ROUTING_REFRESH_PROBE_CAP_USD = 0.05` (so the renderer can state the cost without importing main), the second pinned equal to `CACHE_PROBE_CAP_USD` by a main test. | 3-1 |
| C5 | **Money.** Spend and estimates: `—` for a negative or non-finite value; `$0.00` for 0; `<$0.0001` below 0.0001; below $1, four decimals with up to two trailing zeros removed (`$0.0494`, `$0.021`, `$0.05`); from $1, two decimals. This extends K3's "four decimals below $0.01" to keep an estimate and its cap comparable (`$0.0494` against `$0.05`). Per-million prices: three significant figures, never exponent notation. | 3-2 |
| C6 | **Uptime display truncates** exactly as `truncatePct` (`eligibilityCore.ts:50`), so a failing endpoint never displays at or above the threshold (99.4951 → `99.49%`, matching its exclusion reason). | 3-2 |
| C7 | **Notes.** The notes list is `warnings` verbatim, except that W1 (the first warning, present exactly when `stale`) is dropped in favour of the live age line computed from `now`. No warning is parsed or rewritten; W3 still has no structured field. | 3-2 |
| C8 | **Nitro's softened text** reads "passes the uptime and precision rules", not Plan_1's "passes your rules", because `likelyFailsRules` lists only reliability and precision reasons (Phase 1 decision); speed and price gates are never checked for Nitro. | 3-2 |
| C9 | **Card text** is a fixed template over counts, the floor and `tierWeights` (e.g. `First of 12 endpoints at or above the 45.3 tok/s Budget floor, scored mostly on price.`). The Budget-floor note appears only when the floor alone empties or shortens Budget. | 3-2 |
| C10 | **Table order** is eligible rows then excluded rows, each in `candidates` order (by tag). Not by score: tie-breaks make score order differ from tier order (Balanced scores streamlake/fp8 above deepinfra/fp8, but deepinfra/fp8 leads on the uptime tie-break). | 3-2 |
| C11 | **Observation semantics.** The toggle shows `enabled`; the select designates. Turning on sends `{ enabled: true, credentialProfileId: <the select's value or null> }`; choosing in the select while on designates; turning off sends `{ false, null }` and clears the select. While off, the select is a local draft. A credential is never designated unless the user chose it in the select. | 3-2, 3-4 |
| C12 | **The renderer's countdown** starts only when its own refresh reached the network (an `ok` reply, or at least one adopted event), mirroring C2, from `Date.now()` when the reply arrives; that is after main's end, so the countdown never reaches 0 before main would accept. | 3-2 |
| C13 | **No Zod parsing in the renderer.** The store and `routingView.ts` never call `.parse` or `.safeParse`; main is the authority (MR-G5). Value imports of `shared/routing` only construct schemas, as `shared/ipc` already does in the renderer (`SettingsAppearance.vue:3`). | 3-2 |
| C14 | **Errors keep their code.** `routingValue` throws `RoutingReplyError(code, message)`; any other rejection (a bridge "could not be cloned", for example) becomes `OPERATION_FAILED` carrying its own message, so a D14 regression is visible, never swallowed. | 3-2 |
| C15 | **Components are presentational and not selectable.** Props in, `refresh` and the table toggle the only interactions; no store, no `window.chorus`, no IPC. Cards emit nothing (MR-D21). The harness proves it by mounting them with `window.chorus` undefined. | 3-3 |
| C16 | **The harness computes `TierResult`s in Node** (bundled cores) and hands them to the page as JSON, so the browser bundle never runs `computeTiers` or a Zod parse under the harness CSP. It leaves only PNGs in `_verify/routing-ui/`. | 3-3 |
| C17 | **Placement.** The row is "Model routing", directly after "Providers & keys", `data-settings-nav="routing"`; the section is under the existing `v-if` chain, so each visit remounts it and reloads. | 3-4 |
| C18 | **The built-app drive checks consistency, not golden tier orders.** With a seeded snapshot, no credential and no cache file, the order depends on time-of-day price overrides (MR-D13) at the wall-clock time of the drive. It asserts each card against the app's own `routing:tiers` reply, and asserts exactly what is clock-independent: 14 eligible · 18 excluded, Nitro likely `together`, the three notes. | 3-4 |
| C19 | **A display clock only.** `SettingsRouting.vue` keeps a 1 s `nowMs` ticker for the age line and the countdown; it never triggers IPC (K3). | 3-4 |
| C20 | **Honest framing.** The section says `Preview only: launches do not use these tiers yet.` (MR-D21). | 3-2, 3-4 |

## Sequence and file ownership

Execute 3-1 → 3-2 → 3-3 → 3-4. Each depends on the one before. Ownership is disjoint by file; within `src/shared/routing.ts`, Task 3-1 owns the two amendment lines in the Phase 2 IPC block and the appended "Phase 3 — UI support" block. A downstream task that needs an upstream change records it in its report and makes it in the upstream file with a test; it does not work around it.

| Task | Deliverable | Depends on | Files owned |
|---|---|---|---|
| [3-1](Task-3-1.md) / [spec](../ImplementationSpecs/ImplementationSpec-3-1.md) | Main support for the UI | Phase 2 | `src/main/services/routingService.ts` and test; `routingIpc.ts` and test; `src/shared/routing.ts` (two amendments, one appended block) and `src/shared/routing.test.ts` (S5-1, Table S6); one line in `src/preload/index.ts`; `scripts/verify-routing-ipc.mjs` |
| [3-2](Task-3-2.md) / [spec](../ImplementationSpecs/ImplementationSpec-3-2.md) | Renderer data layer and pure view model | 3-1 | `src/shared/routingView.ts` and test; `src/renderer/src/stores/routing.ts` and test |
| [3-3](Task-3-3.md) / [spec](../ImplementationSpecs/ImplementationSpec-3-3.md) | Presentational components and the isolated visual harness | 3-2 | `src/renderer/src/components/routing/RoutingTierCards.vue`, `RoutingProviderTable.vue`, `RoutingRefreshStatus.vue`; `scripts/verify-routing-ui.mjs` |
| [3-4](Task-3-4.md) / [spec](../ImplementationSpecs/ImplementationSpec-3-4.md) | Settings → Model routing and the built-app drive | 3-1 to 3-3 | `src/renderer/src/views/SettingsRouting.vue`; `src/renderer/src/views/SettingsView.vue`; `scripts/verify-routing-settings-ui.mjs` |

No new dependencies. No roadmap, Plan_1 or Phase 0–2 document edits (the coordinator records MR-D21–MR-D24 and the outcome). Each task commits only its own files.

## Gates

| Gate | In Phase 3 |
|---|---|
| MR-G1 | Every task: `npm run typecheck` and `npm test` pass. Real checks: 3-1 re-runs the zero-cost IPC drive on a fresh build (`PASS (19 checks)`); 3-3 runs the isolated harness (screenshots plus DOM assertions); 3-4 drives the built app through Settings → Model routing. |
| MR-G4 | `routing:credentials` reads rows and never decrypts, never reads a key or fingerprint; labels and provider names are scrubbed (C1). Tests prove 0 decrypts and 0 requests. Both drives check every response and the page text against `secret-patterns.json`. `npm run grep:secrets` is clean after the scripts delete their bundles. |
| MR-G5 | `routing:credentials` is parsed in and out in main. Every renderer-to-main payload is a `plainRoutingInput` snapshot; the store test asserts no argument is a Proxy and every argument survives `structuredClone` (with a reactive negative control); the built-app drive performs the observation and data-collection writes through the real UI with zero clone errors. The preload stays Zod-free. |
| MR-G7 | As display: the estimate line appears on `probe-plan`, before any `probe` event, and the spend line on `done` or `failed` (view tests over event sequences, harness screenshots). The optional user-run check shows it live. |
| MR-G8 | `routingView.ts` is pure (no clock, randomness or I/O; the purity grep covers it) and deterministic over deep-frozen inputs. The ranker is untouched; `node scripts/verify-routing-ranker.mjs` prints `PASS (30 checks)`. |

Not applicable: MR-G2 (no change to OpenCode config generation), MR-G3 (no script launches OpenCode), MR-G6 (no migration; v28 stays reserved for Phase 4).

## Risks

- **Phase 2 tests change on purpose.** The channel amendment moves S5-1, I1 and I4; the cooldown would refuse three existing second refreshes. Both are listed above as contract amendments, and the harness default (C3) keeps every Phase 2 expected value as it was. A reviewer should see only counts and fixtures change, never a golden value.
- **Credential labels are user text shown in the UI.** They are scrubbed in main (C1) and rendered by text interpolation only; nothing uses `v-html`.
- **The golden fixture is in the past.** `fetchedAt` is 2026-10-02T09:05:00Z, so a seeded drive must rewrite it to a few minutes before now, or every tier reads stale and the age reads in days; and never after now, or `routing:tiers` answers `INVALID_TIME`.
- **Stale tiers on an open page.** Tiers are recomputed on open, refresh, selection and setting changes, not on a timer. The age line ticks (C19), but time-of-day prices are evaluated at `computedAt`; a page left open across a price window shows the old order until the next action.
- **The cooldown lives in memory.** A main-process restart resets it. A renderer loop cannot restart main, so MR-D22's purpose holds.
- **Two windows.** Progress is broadcast to every window; adoption (K4) binds the store to the first event for its model while its own refresh is in flight. A second window's simultaneous refresh of the same model gets `BUSY` before any event, so it cannot be adopted by mistake, except in the instant between its call and the refusal; the reply then replaces the adopted state.
- **Unusable designated credential.** A designation whose provider later changes keeps ticking every 30 minutes as `refused` (Phase 2 carry-over); the section warns (K8) and turning off clears it (MR-D23).
- **CRLF files.** `src/preload/index.ts` and `SettingsView.vue` are CRLF in the working tree, and an editor may rewrite their line endings. Check `git diff --stat` and `git ls-files --eol` after every edit (see "Line endings" above).
- **The 2,095-line `LaunchDialog.vue` is untouched** (mixed line endings), and so is `TeamLaunchDialog.vue`. Phase 4 inherits both.
- **The isolated harness and Tailwind.** `main.css` imports Tailwind, so the harness build needs `@tailwindcss/vite` (already a dev dependency). Components use scoped CSS and `settings.css` classes, not utility classes, so their look does not depend on Tailwind's source scanning in a foreign vite root.
- **The purity grep matches comments.** `routingView.ts` must not contain `Date.now(`, `Math.random(`, `new Date()`, `require(` or `from 'node:` even in a comment.

## Handoff to Phase 4

- **Placement.** `RoutingTierCards`, `RoutingProviderTable` and `RoutingRefreshStatus` go into `LaunchDialog.vue` when the agent is OpenCode with an OpenRouter API-key credential. Only then do the cards become selectable (a selection prop and event added in Phase 4, never before; MR-D21). The store's `startRefresh` serves a launch-time refresh with the launch's own credential (MR-D19).
- **MR-D4.** `modelEffortLevels` looks up the exact model id (`LaunchDialog.vue:288`), so a `:nitro` id finds no efforts; strip the suffix there. The inspector's fixed `'low'` effort (`ROUTING_INSPECTOR_EFFORT`) gives way to the launch's real effort.
- **MR-D15.** The Team per-slot tier dropdown in `TeamLaunchDialog.vue`, with an optional field on the strict `teamMemberSchema` (`src/shared/team.ts:30`).
- **Persistence.** Migration v28 for the routing selection on sessions and launch profiles (MR-G6, against a throwaway `--user-data-dir`). Remember the last tier per model (Plan_1 §2).
- **Freshness.** MR-D10's "a launch needs a snapshot ≤ 60 minutes old" conflicts with Plan_1's "Nitro works without a fetch" (Plan_1 §2, empty states): Nitro's payload needs no snapshot, only its preview does. Resolve at Phase 4 kickoff. A launch-time refresh is subject to the MR-D22 cooldown; a launch within a minute of a refresh finds a fresh snapshot, but Phase 4 must handle the `BUSY` cooldown reply explicitly.
- **Still open.** W3 has no structured field; MR-D16 (remembered TUI variant) and MR-D17 (real primary outage); guardrail revalidation after an access failure (MR-D12); a way for launch handlers to reach `RoutingService` (constructed in `src/main/index.ts`).

## Verification and completion

Each task runs its own commands. At phase end, from the repository root:

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

All three `Select-String` lines must print nothing. The three drives must end with `PASS (n checks)` and exit code 0: `PASS (19 checks)`, `PASS (15 checks)` and `PASS (16 checks)`. `npm run grep:secrets` scans `_verify/`, so run it after the scripts have deleted their bundles. `git status --short` must still show the pre-existing entries above, unchanged. Record actual exit codes and output; a passing subset is not a full-suite pass.

**Driving the dev app by hand** (not required by any gate): `$env:REMOTE_DEBUGGING_PORT='9333'; npx electron-vite dev -- "--user-data-dir=<throwaway>"`. Never point a drive at `%APPDATA%\chorus*` or at port 9222 while another instance holds it, and never stop `electron.exe` or `Chorus.exe` by name; the installed Chorus is running. Dev never rebuilds MAIN on edit, so kill your own dev instance by its pid and relaunch before measuring a main-process change.
