# Implementation specification 4a-5 — The built-app launch drive

Paired [task](../Tasks/Task-4a-5.md). Decisions: [roadmap](../roadmap.md) MR-D3, MR-D4, MR-D11, MR-D18, MR-D19, MR-D22; user decisions MR-D25 to MR-D28; gates MR-G1, MR-G3, MR-G4, MR-G5, MR-G6; [overview](../Tasks/Phase-4a-Overview.md) K2–K11, K13 and clarifications C36–C44. Builds on ImplementationSpecs [4a-1](ImplementationSpec-4a-1.md) to [4a-4](ImplementationSpec-4a-4.md); process handling from [ImplementationSpec-3-4](ImplementationSpec-3-4.md). **Not started.**

Check IDs: **L1–L19** and `cleanup` (20 checks).

## Files and insertion points

Verified 2026-10-03 at `a57ef1b`.

| File | Action |
|---|---|
| `scripts/verify-routing-launch.mjs` | New (LF). Pattern: `scripts/verify-routing-settings-ui.mjs` — freshness :112–167, seed bundle :169–207, launch :209–237, `killOwnChild` :243–250, `deleteProfile` :262–274, interrupt :276–291, connect :333–385, DOM helpers :387–420, overlays :422, `shot` :427–438, positive controls :536–566, seed writes :711–724, key scan :824–838, shutdown :850–872, log tail :888–892, cleanup :894–909. Filling a v-model `<select>` over CDP: set `.value` and dispatch bubbling `input` and `change` (`team-member-ui-checks.mjs:7–10`). |

No other file changes. Nothing here launches real OpenCode and nothing spends (K11).

## Ground facts the drive rests on

Each was opened or measured this session, at `a57ef1b`. Task 4a-3 moves lines in `src/main/ipc.ts`, `src/main/index.ts` and `src/main/services/storage.ts`; recheck those at execution.

| Fact | Where |
|---|---|
| A launch resolves `opencode` with `where.exe` (`resolveCli`, `cliDetect.ts:117–133`); detection runs the same probe plus `<file> --version`, first line (`probeCli`, `cliDetect.ts:174–202`; opencode's `detectInstallation`, `opencode.ts:77–89`, calls it). `pickSpawnable` takes the first `.exe` anywhere in the `where` output, else the first `.cmd`/`.bat` (`cliDetect.ts:36–52`); an npm-shaped `.cmd` is read by `parseNpmShim` (`cliShimCore.ts:67`) and a `.cjs` target is spawned as `node <target>` with no `cmd.exe` (`resolveShim`, `cliDetect.ts:63–81`; `nodeInterpreter`, `cliDetect.ts:94–107`). The Team helper probe also runs `<file> run --help` (`helpers/common.ts:85–86`). | measured 2026-10-03: with a stub directory first on `PATH`, `where.exe opencode` listed the stub's `opencode.cmd`, then `%APPDATA%\npm\opencode` and `opencode.cmd` (no `.exe`); `parseNpmShim` returned `{ kind: 'node-script' }` for the stub; `node <stub> --version` printed `1.18.33` |
| OpenCode's API-key variable is `OPENROUTER_API_KEY` (`opencode.ts:112`); `buildLaunch` spawns `cli.file` with `-m <qualified id>` (:229–265). | |
| A credentialed child gets only `PATH`, `SystemRoot`, `TEMP`, `TMP`, `HOMEDRIVE`, `HOMEPATH`, `USERPROFILE` from the parent, case-insensitively, plus pins, `envAdditions` and the key (`env.ts:10–20`, :166–178): no `XDG_*`. | |
| `os.homedir()` reads `USERPROFILE` and ignores `HOME` (Node 22.14 and Electron 43.1.1 as node); Electron's `app.getPath('home')` ignores a `USERPROFILE` override and returns the real home. | measured 2026-10-03 with a windowless Electron script and a scratch `--user-data-dir` |
| `provider:create` writes one row (`ipc.ts:2648–2670`); `credential:create` encrypts with `safeStorage` and writes one row, never logged (`ipc.ts:2739–2757`, `vault.ts:97–155`); the key test runs only from its button, "never … on profile creation" (`ipc.ts:2815–2819`). Neither makes a network call. | |
| The model catalog is written only by `model:refresh`, a live GET (`ipc.ts:2915`); `model:list` is a pure read ordered by display name (`ipc.ts:2854–2880`, `storage.ts:2440–2447`); `reasoning_efforts` is JSON array text (`modelCatalogCore.ts:241–251`). `model:shortlist-set` is a local write with no network (`ipc.ts:2894–2913`; preload `setModelShortlisted`). | |
| With no management credential, attribution keeps the user's credential and mints nothing (`dispatchAttribution.ts:150–162`). | |
| The routing store reads `snapshot.json` from disk on every call (`routingStore.ts:86`, :160), so a re-seed is seen by the next `routing:tiers`. | |
| The database is `<userData>/chorus.db` (`index.ts:597`); migrations are recorded in `schema_migrations (version, applied_at)` (`storage.ts:3984–4002`). `node:sqlite` loads under the installed Node 22.14 (experimental warning only). | |
| A fresh profile on this machine activates the project `C:\Projects\ContactEstablished\Chorus` (`constants.ts:8`, `index.ts:968–977`); `project:add` needs a native picker (`ipc.ts:4133–4150`), so the drive uses that seeded project. | |
| `suggestMode` returns `new-worktree` when a live session exists in the repository (`shared/ipc.ts:1286–1289`, `ipc.ts:2254`). A careless second launch would create a git worktree in the user's repository. | |
| `session:relaunch` refuses a running session and needs the row's launch profile (`ipc.ts:3309–3314`, :3332–3339); a profile launch sets the project's last-profile pointer (`ipc.ts:2091`, :2145, :2175), which the dialog preselects on open (`LaunchDialog.vue:712–713`). | |
| The dialog opens from the empty state's `.empty-cta` (`EmptyState.vue:27`) or a pane's `button[aria-label="New agent"]` (`TerminalPane.vue:1497`); `getLayout(projectId)` returns `sessions[]` with `id` and `status` (`shared/ipc.ts:3410–3415`). | |
| The user's real OpenCode state file exists: `%USERPROFILE%\.local\state\opencode\model.json` (1,157 bytes, keys `recent`, `favorite`, `variant`). No `XDG_*` or `HOME` variable is set in this environment. | measured 2026-10-03 |

## Layout of the throwaway root

`TMP = mkdtemp(<os tmpdir>/chorus-routing-launch-)` holds everything the drive creates outside `_verify/`:

| Path | Purpose |
|---|---|
| `TMP/profile` | `--user-data-dir` for both app runs. |
| `TMP/home` | `USERPROFILE` and `HOME` of the app. Holds the seeded OpenCode state file `home/.local/state/opencode/model.json`. |
| `TMP/xdg-state`, `TMP/xdg-data` | `XDG_STATE_HOME`, `XDG_DATA_HOME` of the app (MR-G3); must stay empty. |
| `TMP/stub` | `opencode.cmd`, `opencode-stub.cjs`, `captures/`. |
| `TMP/app-run1.log`, `TMP/app-run2.log` | The app's stdout and stderr. |

`OUT = <ROOT>/_verify/routing-launch`, emptied first; at the end it holds only `launch-fresh.png`, `launch-stale.png` and `launch-nitro.png`.

## The stub `opencode` (K11, C37)

`TMP/stub/opencode.cmd`, written byte-exact with CRLF line endings (the shape `parseNpmShim` reads; measured above):

```bat
@ECHO off
node "%~dp0\opencode-stub.cjs" %*
```

`TMP/stub/opencode-stub.cjs` (CommonJS; the credentialed child env offers no channel for a capture path, so the stub writes beside itself):

- `argv` exactly `['--version']` → print `1.18.33\n`, exit 0. This satisfies detection and the MR-D25 version gate (`1.18.33`).
- `argv` exactly `['run', '--help']` → print `opencode stub: run [message..]\n`, exit 0, and record nothing, so a Team helper probe (`helpers/common.ts:85–86`) can never leave a capture. The drive never opens the Team dialog or starts a Team run.
- Otherwise: write `captures/<pid>.json` atomically (temp name, then rename) as `{ pid, argv: process.argv.slice(2), cwd: process.cwd(), env: { ...process.env }, at: <ISO> }`; print `opencode stub: recorded\r\n`; stay alive (`setInterval(() => {}, 60_000)`) until killed.

The capture holds the fake key in `OPENROUTER_API_KEY`; it lives only under `TMP` and is never printed.

## The app environment (C38)

`appEnv = { ...process.env }`, then: delete `ELECTRON_RUN_AS_NODE`, `ELECTRON_RENDERER_URL`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`; set `USERPROFILE = HOME = TMP/home`, `HOMEDRIVE` = its drive (`C:`), `HOMEPATH` = the rest (`\Users\…\home`); `XDG_STATE_HOME = TMP/xdg-state`, `XDG_DATA_HOME = TMP/xdg-data`; and prepend `TMP/stub;` to the existing path variable under **its own key** (`Object.keys(appEnv).find((k) => k.toUpperCase() === 'PATH')`; a second `PATH` key beside `Path` is ambiguous on Windows).

**Preflight** (before run 1; a failure prints `FAIL drive: …` and ends the drive with every check failed): `execFileSync('where.exe', ['opencode'], { env: appEnv, cwd: ROOT })` lists no `.exe` and its first `.cmd`/`.bat` is `TMP/stub/opencode.cmd` (otherwise a real `opencode.exe` would win, `cliDetect.ts:37`).

**Baselines** (before run 1): the drive's own `os.homedir()` (the user's real home; the drive process keeps the real environment) gives `REAL_STATE = <home>/.local/state/opencode/model.json` — read its bytes, or record "absent"; also the same path under `process.env.XDG_STATE_HOME` when that is set. `git -C ROOT worktree list --porcelain` and `git -C ROOT status --porcelain` outputs.

## Fixtures and constants (hand-written; never computed by the code under test)

```js
const SLUG = 'deepseek/deepseek-v4.1-flash', NITRO_ID = SLUG + ':nitro'
const GATEWAY = 'https://openrouter.ai/api/v1'
const EFFORTS = ['low', 'medium', 'high'] // seeded catalog efforts of SLUG
const VARIANTS = Object.fromEntries(EFFORTS.map((e) => [e, { reasoning: { effort: e } }]))
const KEY_A = 'sk-or-v1-' + randomBytes(32).toString('hex') // built at run time; no key-shaped literal in the file
const KEY_B = 'sk-or-v1-' + randomBytes(32).toString('hex')
const PROVIDER_A = { name: 'OpenRouter (routing drive)', adapter_type: 'opencode', auth_mode: 'api_key', base_url: GATEWAY, model: SLUG }
const PROVIDER_B = { name: 'Other gateway (routing drive)', adapter_type: 'opencode', auth_mode: 'api_key', base_url: 'https://gateway.example.invalid/api/v1', model: SLUG }
const PROFILE = { label: 'Routed drive profile', agent: 'opencode', model: null, effort: null, model_effort: null, permission_mode: null, workspace_mode: 'current-tree', env_json: null } // + provider_id, credential_profile_id
const STATE_SEED = { recent: [], favorite: [], variant: { ['openrouter/' + SLUG]: 'high', ['openrouter/' + NITRO_ID]: 'default', 'openrouter/z-ai/glm-5.3': 'high' } }
const STALE_REASON = 'Refresh first: the numbers are older than 60 min.'
const DEFAULT_DESC = 'Chorus sends no routing: OpenRouter picks the provider for each request, as before. The data-collection setting is not sent.'
// Copied verbatim from ImplementationSpec-4a-1 (`staleSnapshotMessage(60)`, code SNAPSHOT_STALE); as drafted at kickoff:
const STALE_REFUSAL = 'The endpoint snapshot for this model is more than 60 minutes old. Refresh first.'
```

`PROVIDER_B` exists to prove the dialog's K3 mirror on a real non-routable credential (C41): it targets OpenCode with an API key, so the dialog offers it, but `checkRoutingCredential` refuses its base URL (`routingCredentialCore.ts:64–74`). No request is ever sent to it.

## Flow

1. **Freshness**, as `verify-routing-settings-ui.mjs:112–167`: `out/main/index.js` not older than the routing services and cores (`src/main/routing/*.ts` includes `launchCore.ts`), `src/shared/routing.ts`, `src/shared/ipc.ts`, `src/main/ipc.ts`, `src/main/index.ts`, `src/main/services/storage.ts`, `src/main/services/sessionManager.ts`, `src/main/db/schema.ts`, `src/main/adapters/opencode.ts`, `src/main/adapters/opencodeVariantState.ts`, `src/main/adapters/opencodeVariantStateCore.ts`, `src/main/adapters/types.ts`, `src/preload/index.ts`; the main bundle contains `routing:launch-preferences`, `routing_tier`, `routing_json` and `OPENCODE_CONFIG_CONTENT`; the preload contains `routing:launch-preferences`; the newest `out/renderer/assets/*.js` is not older than `LaunchDialog.vue`, `components/routing/*.vue`, `stores/routingLaunch.ts`, `src/shared/routingView.ts`, `src/shared/routing.ts`, and some asset contains `DEFAULT_DESC`. Otherwise `FAIL build is stale: run npx electron-vite build`, exit 1.
2. **Seed bundle**, as :169–207: `parseEndpointsResponse`, `extractObservations`, `modelDirName`, `snapshotFileText`, `observationsFileText` into `OUT/seed-<pid>.cjs`, loaded, deleted at once.
3. Create `TMP` and its layout; write the stub; preflight; baselines.
4. **Run 1 (bootstrap)**: launch, connect, L1's in-page calls, shutdown (as :850–872). Two runs because the catalog row with efforts can only be written by `model:refresh`, a live call, so it is seeded between them (C36).
5. **Between runs**: open `TMP/profile/chorus.db` with `node:sqlite`; L1's database half; insert the catalog row; close. Write the fresh snapshot (`FRESH_AT` = whole seconds, five minutes ago; never in the future) and observations as :711–724. Write `STATE_SEED` to `TMP/home/.local/state/opencode/model.json` with `JSON.stringify(STATE_SEED)`; keep its bytes as `SEED_BYTES`.
6. **Run 2 (checks)**: launch, connect, install the error watchers with positive controls (:536–566), L2–L14 in order, kill every session the drive started, shutdown.
7. After exit: L15–L19, `cleanup`, and `PASS (20 checks)` (exit 0) or `FAIL (k of 20 checks)` (exit 1).

Each run launches `require('electron')` with `['.', '--user-data-dir=TMP/profile', '--remote-debugging-port=<free port>', '--remote-debugging-address=127.0.0.1']`, `cwd: ROOT`, `env: appEnv`, `windowsHide: true`, stdout and stderr to that run's log. A free port comes from `net.createServer().listen(0)`; never 9222.

### Dialog helpers (run in the page; the existing dialog markup has no test hooks for these, so they select by text)

- `openDialog()`: click `.empty-cta` when present, else the first `button[aria-label="New agent"]`; wait up to 10 s for `.overlay-panel.launch`.
- `pickAgent('opencode')`: click the `.launch-agent` whose `.launch-agent-name` text is `opencode`.
- `pickAuth('api key')`: click the `.launch .overlay-segment` whose trimmed text is `api key`.
- `pickCredential(id)`: the `select.launch-select` whose option values include `id`; `choose` it.
- `pickProfile(label)`: click the `.launch-chip` with that text (`No profile` for none); then wait for `[data-launch-model]`.
- `pickModel(value)`: `choose('[data-launch-model]', value)`; for the route-default option set `selectedIndex = 0` and dispatch `change` (its option value is `null`, which a string assignment cannot select).
- `pickEffort(label)`: click the `[data-launch-model-effort]` whose text is `label`.
- `pickTier(choice)`: click `input[data-routing-radio][value="<choice>"]`.
- `routingReady()`: wait up to 10 s for `[data-routing-launch][data-routing-launch-ready="true"]`.
- `readRouting()`: a plain-JSON reading of the section — present, `data-routing-choice-selected`, caption, hint, `[data-routing-stale]`, `[data-routing-age]`, the Refresh button's text/disabled/title, and per `[data-routing-choice]`: choice, radio checked/disabled, `data-routing-disabled`, `[data-routing-disabled-reason]` text, `[data-routing-primary]` text.
- `launchSolo()` (C39): before clicking, assert the selected `[data-launch-preset]` reads `Solo`, the selected `[data-launch-count]` reads `1`, exactly one `.launch-plan-row` whose `.launch-plan-target` reads `Current tree`, and — when a Workspace section exists — click its `Current tree` card first. Record `getLayout(projectId).sessions` ids and the capture count; click `.launch-foot .overlay-btn-primary`; wait up to 20 s for the dialog to close, one new session id and one new capture file. Return `{ sessionId, capture }`.
- `killAndConfirm(sessionId, pid)`: `window.chorus.killSession(sessionId)`; wait up to 10 s for that session's `status` to leave `running` and for `process.kill(pid, 0)` to throw (`ESRCH`).

### In-page calls

`page(body)` evaluates `body` inside an async IIFE with `chorus = window.chorus` and `routing = window.chorus.routing` bound, pushes `JSON.stringify(value)` onto `responseTexts`, and returns the value. Payloads are object literals written in the page.

## Checks

`T(effort)` = the in-page `routing.tiers({ model: SLUG, profile: 'interactive', effort, credentialProfileId: CA })`, taken immediately before the launch it is compared with (C42: provider objects are compared with main's own reply and main's own row, never a golden order, after Phase 3 C18). `content(capture)` = `JSON.parse(capture.env.OPENCODE_CONFIG_CONTENT)`. "Strictly equals" is `isDeepStrictEqual`. `samePath(a, b)` = `path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()` (separators and case normalised; Windows paths are case-insensitive).

| # | Check | Expect |
|---|---|---|
| L1 | Bootstrap (run 1, then the database) | `chorus.listProjects()` has one `active` project; `chorus.getLaunchContext(id).projectRoot` equals `ROOT` (kept as `PROJECT`, `PROJECT_ROOT`). `createProvider(PROVIDER_A)` and `(PROVIDER_B)` → `ok` (`PA`, `PB`); `createCredential({ providerId: PA, label: 'Routing drive key', key: KEY_A })` and `({ providerId: PB, label: 'Other drive key', key: KEY_B })` → `{ ok: true, id }` (`CA`, `CB`); `routing.credentials({})` → `{ ok: true, value: { credentials: [{ id: CA, label: 'Routing drive key', providerName: 'OpenRouter (routing drive)' }] } }` (`CB` refused); `createLaunchProfile({ ...PROFILE, provider_id: PA, credential_profile_id: CA })` → `ok` with wire `model` = `SLUG`, `credential_profile_id` = `CA`, `disabled_reason` `null` (`LP`); `setModelShortlisted(PA, SLUG, true)` then `(PA, NITRO_ID, true)` → shortlist `[SLUG, NITRO_ID]`; `routing.status({}).value.requestsSinceStart` 0. After exit: `SELECT COUNT(*), MAX(version) FROM schema_migrations` → 28, 28 (MR-G6 on a fresh profile); `PRAGMA table_info(sessions)` has `routing_json`; then `INSERT INTO model_catalog (provider_id, model_id, display_name, context_length, expires_at, first_seen_at, refreshed_at, missing_since, reasoning_efforts) VALUES (PA, SLUG, 'DeepSeek V4.1 Flash', NULL, NULL, now, now, NULL, '["low","medium","high"]')` changes one row. |
| L2 | The stub is OpenCode 1.18.33 | `chorus.detectClis(true)` row `opencode`: `found` true, `version` `1.18.33`, `samePath(path, TMP/stub/opencode.cmd)`. In the opened dialog the opencode card's `.launch-agent-ver` reads `1.18.33`. |
| L3 | The section appears only when eligible (K3) | `openDialog()` (no profile is preselected). With a found non-opencode agent card selected (skip this step when none is found): no `[data-routing-launch]`. `pickAgent('opencode')` (auth `subscription`): none. `pickAuth('api key')`, `pickCredential(CB)`: none and no `[data-routing-unavailable]`. `pickCredential(CA)`: the section appears and is ready. |
| L4 | MR-D4: a `:nitro` id takes its base model's efforts | `pickModel(NITRO_ID)`: no `[data-routing-launch]` (`model-not-routable`); the `[data-launch-model-effort]` texts are exactly `['Low', 'Medium', 'High']` (without the fix the `:nitro` id has no catalog row and the control is absent). `pickModel(route default)`: the section is back and ready. |
| L5 | Balanced is preselected on a fresh seed (K9, MR-D28) | `readRouting()`: `data-routing-choice-selected` `balanced`; only the `balanced` radio checked; all five radios enabled; no hint; caption `Ranked for an interactive session with no reasoning effort set.`; age matches `^Updated [5-9] min ago$`; no `[data-routing-stale]`; Refresh enabled with title = the Phase 3 cost text (never clicked: it would spend); `[data-routing-default-description]` = `DEFAULT_DESC`. `T(null)` → ok; for Budget, Balanced and Fast the card's `[data-routing-primary]` equals that reply's `tiers[t].endpoints[0]` (Phase 3 C18, C42: compared with main, not a golden order). Screenshot `launch-fresh.png` with the section scrolled to the top of the dialog body. |
| L6 | A Balanced launch (bare credential) | `T(null)` → `BAL`; `launchSolo()` → `S1`, capture `P1`. `P1.argv` strictly `['-m', 'openrouter/' + SLUG]`; `content(P1)` strictly equals `{ provider: { openrouter: { models: { [SLUG]: { options: { provider: BAL.value.tiers.balanced.provider } } } } } }` (K6; log both `computedAt`s); `P1.env.OPENROUTER_API_KEY === KEY_A`; `samePath(P1.env.USERPROFILE, TMP/home)`; no `XDG_STATE_HOME` in `P1.env` (the credentialed child resolves its state from home); no `OPENCODE_CONFIG` (no effort, no memory: `ipc.ts:988–989`); `samePath(P1.cwd, PROJECT_ROOT)`; the home state file's bytes equal `SEED_BYTES` (no effort: MR-D25 writes nothing). `killAndConfirm(S1, P1.pid)`. |
| L7 | The remembered choice, and a profile launch (MR-D28, K8) | `routing.launchPreferences({})` → `{ ok: true, value: { lastChoiceByModel: { [SLUG]: 'balanced' } } }`. `openDialog()`, `pickProfile('Routed drive profile')`: the section is ready with `balanced` preselected (the remembered choice). `T(null)` → `BAL2`; `launchSolo()` → `S2`, capture `P2`: argv as L6; `content(P2)` strictly equals L6's form with `BAL2.value.tiers.balanced.provider`. `killAndConfirm(S2, P2.pid)`. |
| L8 | Relaunch re-applies the persisted selection, with no re-rank (MR-D27, K10, C40) | Re-seed `snapshot.json` with `STALE_AT` (whole seconds, two hours ago). `T(null)` now reports `stale: true` (a fresh resolve would be refused). `RELAUNCH_AT = Date.now()`; `chorus.relaunchSession(S2)` → not `{ ok: false }`; one new capture `P2r` with a new pid: `P2r.argv` strictly equals `P2.argv`; `content(P2r)` strictly equals `content(P2)`; the home state file still equals `SEED_BYTES`. `killAndConfirm(S2, P2r.pid)`. |
| L9 | A stale seed in the dialog (MR-D26, K9) | `openDialog()`; ensure the `Routed drive profile` chip is on (click it when not). `readRouting()`: Budget, Balanced and Fast radios disabled, each `[data-routing-disabled-reason]` = `STALE_REASON`, `data-routing-disabled` `true`; Nitro and default radios enabled; `[data-routing-stale]` = `Older than 60 min. Refresh before relying on these numbers.`; `data-routing-choice-selected` `default` with hint `Refresh to use Balanced.` (remembered Balanced is not launchable). A click on the Balanced card's `[data-routing-reason]` changes nothing. Screenshot `launch-stale.png`. |
| L10 | Main refuses a forced ranked tier on a stale snapshot | In the page: `chorus.launch({ project_id: PROJECT, agent: 'opencode', cwd: PROJECT_ROOT, workspace_mode: 'current-tree', credential_profile_id: CA, routing_tier: 'balanced' })` → strictly `{ ok: false, reason: STALE_REFUSAL }`; `getLayout(PROJECT).sessions` ids unchanged; no new capture; the home state file still `SEED_BYTES`. |
| L11 | A Nitro launch with an effort (MR-D4, MR-D11, MR-D25, K6) | In the L9 dialog: `pickEffort('Low')`, `routingReady()`; caption `Ranked for an interactive session at reasoning effort "low".`; `pickTier('nitro')`; screenshot `launch-nitro.png`; `launchSolo()` → `S3`, capture `P3`. `P3.argv` strictly `['-m', 'openrouter/' + NITRO_ID]`; `content(P3)` strictly equals `{ provider: { openrouter: { models: { [NITRO_ID]: { options: { provider: { data_collection: 'deny' } }, variants: VARIANTS } } } } }`; `samePath(P3.env.OPENCODE_CONFIG, TMP/profile/mcp/opencode.json)`, and that file's parsed `agent.build` strictly equals `{ model: 'openrouter/' + NITRO_ID, variant: 'low' }` while the file has no top-level `provider` key (MR-D3); the home state file parses to `STATE_SEED` with `variant['openrouter/' + NITRO_ID]` = `low` and every other key and value unchanged; `TMP/xdg-state` and `TMP/xdg-data` are empty. `killAndConfirm(S3, P3.pid)`. |
| L12 | An OpenRouter default launch, and the remembered default | `routing.launchPreferences({})` value `{ lastChoiceByModel: { [SLUG]: 'nitro' } }`. `openDialog()` (profile chip on): `nitro` preselected, no hint. `pickEffort('Medium')`, `routingReady()`, `pickTier('default')`; `launchSolo()` → `S4`, capture `P4`: argv strictly `['-m', 'openrouter/' + SLUG]`; no `OPENCODE_CONFIG_CONTENT` in `P4.env`; `TMP/profile/mcp/opencode.json`'s `agent.build` strictly equals `{ model: 'openrouter/' + SLUG, variant: 'medium' }`; the state file now also has `variant['openrouter/' + SLUG]` = `medium` (MR-D25 applies to unrouted launches) and keeps `low` for the `:nitro` key. `killAndConfirm(S4, P4.pid)`. `launchPreferences` value `{ lastChoiceByModel: { [SLUG]: 'default' } }`; `openDialog()`: `default` preselected, no hint; close it with its Cancel button. |
| L13 | A directly picked `:nitro` id with an effort and no tier (K13, MR-D4, MR-D25) | `openDialog()` (profile chip on); `pickModel(NITRO_ID)`: no `[data-routing-launch]` (`model-not-routable`, so no tier can be sent); `pickEffort('High')`; `launchSolo()` → `S5`, capture `P5`. `P5.argv` strictly `['-m', 'openrouter/' + NITRO_ID]`; `content(P5)` strictly equals `{ provider: { openrouter: { models: { [NITRO_ID]: { variants: VARIANTS } } } } }` — variants and no `options` (no provider object); `TMP/profile/mcp/opencode.json`'s `agent.build` strictly equals `{ model: 'openrouter/' + NITRO_ID, variant: 'high' }`; the state file parses to `{ recent: [], favorite: [], variant: { ['openrouter/' + SLUG]: 'medium', ['openrouter/' + NITRO_ID]: 'high', 'openrouter/z-ai/glm-5.3': 'high' } }` (MR-D25 patches the `:nitro` key). `killAndConfirm(S5, P5.pid)`. `routing.launchPreferences({})` value still `{ lastChoiceByModel: { [SLUG]: 'default' } }` (an unrouted launch records nothing). |
| L14 | No OpenRouter request | `routing.status({}).value.requestsSinceStart` 0 (the drive never presses Refresh). Read `document.body.innerText` here for L18. |
| L15 | Stub processes (C44) | Exactly six capture files (`P1`, `P2`, `P2r`, `P3`, `P4`, `P5`; none from L10 and none from a `--version` or `run --help` probe); every capture pid is gone after the app exits. A pid still alive is the drive's last resort: query `Win32_Process` by that `ProcessId` and `taskkill /pid <pid> /F` only when its `CommandLine` names `TMP/stub/opencode-stub.cjs` (never by name, safe against pid reuse); the check fails either way. |
| L16 | The database after exit (MR-G6) | `schema_migrations`: `COUNT(*)` 28, `MAX(version)` 28. `routing_json` of `S1` to `S5`: `S1` and `S2` parse to objects with exactly the seven K5 keys, `tier` `balanced`, `model` and `sentModelId` `SLUG`, `provider` strictly equal to `content(P1)`'s and `content(P2)`'s provider respectively, `endpoints` strictly equal to that provider's `order`, `snapshotFetchedAt` = `FRESH_AT`, `computedAt` an ISO string between run 2's start and end; `S2`'s `computedAt` is earlier than `RELAUNCH_AT` (`Date.now()` recorded just before L8's `relaunchSession`), so the relaunch did not resolve or rewrite the selection. `S3`: `{ tier: 'nitro', model: SLUG, sentModelId: NITRO_ID, provider: { data_collection: 'deny' }, endpoints: [], snapshotFetchedAt: null }` plus an ISO `computedAt` (a Nitro selection never names a snapshot, ImplementationSpec-4a-1 `routingLaunchSelectionSchema`, even though one is stored). `S4` and `S5`: `NULL` (K13's variants for an untiered `:nitro` launch are not persisted). |
| L17 | The user's home and repository are untouched (C39) | `REAL_STATE` has the same bytes as at the start (or is still absent); `git -C ROOT worktree list --porcelain` and `git -C ROOT status --porcelain` equal their baselines. A difference fails with a hint that an OpenCode TUI running during the drive may have written its own state. |
| L18 | No key material (C43) | Positive controls: a concatenated `sk-or-v1-` sample matches `secret-patterns.json`, and every capture's `OPENROUTER_API_KEY` equals `KEY_A` (the scan can see the key where it is expected). Then neither `KEY_A`, `KEY_B` nor any secret pattern appears in: the page text (L14), every in-page response, both app logs, `TMP/profile/mcp/opencode.json`, and every capture's `argv`, `cwd` and every `env` value except `OPENROUTER_API_KEY`. A hit names where it was found and the pattern, never the value. |
| L19 | No renderer errors | As Phase 3's U14 (`verify-routing-settings-ui.mjs:536–566`, :875–883): the console, exception and unhandled-rejection controls were caught; no renderer error and no unhandled rejection after the dialog first opened; none mentions `could not be cloned`. |
| `cleanup` | | `TMP` is deleted (retrying as :262–274); the seed bundle is gone; `OUT` holds only the three PNGs. |

On a failure, print the last 30 lines of each app log as :888–892 does, after replacing every secret-pattern match and every occurrence of `KEY_A` or `KEY_B` with `[redacted]`.

## Process safety

- Its own app child only: stopped by `Browser.close`, then `child.kill()`, then `taskkill /pid <its pid> /F` (:850–872), never by name, never port 9222, never `%APPDATA%\chorus*` or the installed Chorus.
- Stubs are stopped through the app (`killSession`) and confirmed by pid; the L15 last resort is the only direct kill, pid-targeted and command-line-confirmed (C44).
- Ctrl+C / Ctrl+Break: kill the app child, run the stub last resort over the captures read so far, delete `TMP` and the bundle, exit 1 (as :276–291).
- Every launch is Solo, one slot, `Current tree`, in the seeded project root; the drive never chooses Swarm or a worktree, and L17 proves no worktree appeared (C39). It never opens the Team dialog or starts a Team run.
- The fake keys exist only in the drive's memory, the throwaway profile's encrypted rows and the captures under `TMP`; all are deleted at the end, also on interrupt.

## Invariants

- Zero cost: no Refresh click, no `model:refresh`, no key test, no real OpenCode; `requestsSinceStart` stays 0 (K11, MR-D18).
- MR-D25's write lands in the throwaway home and nowhere else; the user's real state file is byte-identical (K11).
- Every expectation about a tier's provider is compared with main's own reply or main's own row (Phase 3 C18, C42), never with a golden order.
- The drive tests a fresh build in a throwaway profile, stops only what it started, and leaves only three PNGs.

## Verification

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

Expected: `PASS (30 checks)`, `PASS (20 checks)` (IPC), `PASS (20 checks)` (harness), `PASS (16 checks)` (Settings), `PASS (16 checks)` for `verify-routing-body.mjs` (MR-G2, as amended by Task 4a-2), and `PASS (20 checks)` for this drive, each with exit code 0. `_verify/routing-launch` holds exactly `launch-fresh.png`, `launch-nitro.png`, `launch-stale.png`. `npm run grep:secrets` scans `_verify/`, so it runs after the drives. Paste the drive's full output and one sentence per screenshot.
