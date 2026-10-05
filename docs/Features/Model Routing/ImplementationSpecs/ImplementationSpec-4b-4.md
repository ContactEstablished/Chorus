# Implementation specification 4b-4 — The built-app Team dialog drive

Paired [task](../Tasks/Task-4b-4.md). Decisions: [roadmap](../roadmap.md) MR-D15, MR-D18, MR-D26, MR-D31, MR-D32; gates MR-G1, MR-G3, MR-G4, MR-G5, MR-G6; [overview](../Tasks/Phase-4b-Overview.md) K2, K4, K10, K11, K14 (c), clarifications C1, C8, C12, C13, C19, answers Q3 and Q8. Builds on ImplementationSpecs [4b-1](ImplementationSpec-4b-1.md) to [4b-3](ImplementationSpec-4b-3.md); the drive pattern of [ImplementationSpec-4a-5](ImplementationSpec-4a-5.md). **Not started.**

Check IDs: **TU1–TU15** (15 checks; TU15 is the cleanup). The `T` keeps them apart from the Settings drive's U1–U15 (overview C19).

## Files and insertion points

Verified 2026-10-05 at `70d5dda`.

| File | Action |
|---|---|
| `scripts/verify-routing-team-ui.mjs` | New (LF). Pattern: `scripts/verify-routing-launch.mjs` — freshness :129–188, seed bundle :190–229, throwaway root :231–255, `deleteTmp` :257–270, stub :272–308, env helpers :310–334, `abortDrive` :339–347, preflight :349–363, baselines :365–406, `isAlive`/`stubProcessState`/`lastResortKill` :421–486, `freePort`/`startRun`/`waitExit`/`killOwnChild`/`closeLog`/`onInterrupt` :488–581, CDP :583–706, `stopRun` :708–736, DOM helpers :738–792, assertion helpers :964–985, guarded click :1051–1089, watchers :1154–1185, bootstrap :1187–1224, seed between runs :1226–1259, run sequence :1620–1664, key scan :1756–1793, cleanup :1819–1835. |

No other file changes. Nothing here launches a team, a real CLI or a paid call (K14 (c)).

## Ground facts the drive rests on

Each was opened or measured this session at `70d5dda`. Task 4b-2 moves lines in `teamService.ts` and Task 4b-3 in `TeamLaunchDialog.vue`; recheck those at execution.

| Fact | Where |
|---|---|
| `pickSpawnable` takes the first `.exe` anywhere in `where.exe`'s output, else the first `.cmd`/`.bat`; an npm-shaped `.cmd` whose target is a script is spawned as `node <target>` with no `cmd.exe`. | `cliDetect.ts:36–52`, `resolveShim` :63–81, `nodeInterpreter` :94–107, `resolveCli` :117–133 |
| Agent detection probes `claude`, `codex`, `kimi`, `opencode`, `grok` (plus `git`, `docker`, `node` and the shell adapter) with `--version`; opening the launch dialog runs it twice (memoized, then fresh). | `DETECTED_TOOLS` :153–163, `probeCli` :174–202; `LaunchDialog.vue:786–795`, :822 |
| The Team dialog opens only from the launch dialog's `Team session` button and is mounted afresh on each open; `Back` emits `cancel` and the launch dialog returns. | `LaunchDialog.vue:1241`, :1257; `TeamLaunchDialog.vue:87` |
| `team:capabilities` probes every helper adapter (Claude, Codex, OpenCode); `probeHelper` runs `--version`, then `claude --help` / `codex exec --help` / `opencode run --help`; it refuses a raw `.cmd`. After Task 4b-1 (K15) the help call reads stdout and stderr. | `teamRuntime.ts:95–132`, :96; `common.ts:65–97`, :80, :85, :86 |
| Options: `claude-opus` and `claude` (`sonnet`) leads, `codex` and `codex-sol` leads, then per OpenRouter API-key credential `<credId>` (GLM-5.3), `<credId>-deepseek` (`deepseek/deepseek-v4.1-flash:nitro`, `customModel: true`, effort from `defaultHelperEffort`) and `<credId>-deepseek-standard` (`deepseek/deepseek-v4.1-flash`); an absent CLI reports `installedVersion: 'unavailable'`. The dialog's helper list drops `claude-opus` and `codex-sol` and uses `helperEnabled`. | `teamRuntime.ts:98–104`, :105–114, :116–119; `TeamLaunchDialog.vue:22` |
| `2.1.278 (Claude Code)` is `VERIFIED_HELPER_VERSIONS.claude`: an admitted lead (`sonnet`, `claude-opus-5-5`) and an admitted `sonnet` helper; not a focused version, so no `leadContext` and a `medium`-effort lead fails `validateMember`. `1.18.34` is a measured OpenCode helper version. | `evidence.ts:6–8`, :13, :22–25, :40–45, :60–62; `team.ts:5`; `teamRuntime.ts:154` |
| `team:launch` parses strictly in main; a schema failure answers `{ ok: false, code: 'INVALID_REQUEST', message: 'Team operation failed. Refresh the current state and retry.' }`; a `TeamDomainError` answers its own code and message. `createRun` validates the lead (:245–246), then each helper (:247), then (Task 4b-2, C8) the routing check, then stores. | `teamIpc.ts:18–28`, :25, :34; `teamService.ts:238–258` |
| Presets: `team:preset-list` and `team:preset-save` are not project-scoped and parse `teamRunConfigSchema` strictly. | `teamIpc.ts:67–68`; `team.ts:192–193` |
| The active project is `settings.active_project_id`; boot seeds this repository only when no active project exists; `project:add` needs a native picker. `projects` columns: `id, name, root_path, created_at`, `color, description` (v13), `status, sort_order, color_seed` (v15). | `index.ts:977–988`; `storage.ts:1641–1652`, :183–188, :627–628, :693–700 |
| A Team run's worktrees live at `<parent of the repository>\.chorus\<repository name>`. | `worktrees.ts:44–46` |
| The database is `<userData>/chorus.db`; Team rows are in `team_presets`, `team_runs`, `team_members`, `team_tasks`, `team_attempts`, `team_events` and `team_integrations`; credentials in `credential_profiles.encrypted_blob`. | `index.ts:606`; `teamStorageMigration.ts:4–57`; `storage.ts:246–254` |
| A fixture repository: `git init -q -b main`, `core.autocrlf false`, a commit with `-c user.name -c user.email`. | `verify-team-app.ts:17–20` (init, add, commit), `verify-team-dependability.ts:19–23` (`-b main`) and :201 (`core.autocrlf false`) |
| `where.exe` (this session): `claude` → `%USERPROFILE%\.local\bin\claude.exe`; `codex`, `opencode` → `%APPDATA%\npm` (extensionless and `.cmd`); `kimi` → `%USERPROFILE%\.kimi-code\bin\kimi.exe` and `%APPDATA%\npm`; `grok` → `%USERPROFILE%\.grok\bin\grok.exe`; `node` → `C:\Program Files\nodejs\node.exe`; `git` → `C:\Program Files\Git`. The real `%USERPROFILE%\.local\state\opencode\model.json` is 1,157 bytes; no `XDG_*` is set. | measured 2026-10-05 |

## Layout of the throwaway root

`TMP = mkdtemp(<os tmpdir>/chorus-routing-team-ui-)` holds everything the drive creates outside `_verify/`:

| Path | Purpose |
|---|---|
| `TMP/profile` | `--user-data-dir` for both runs. |
| `TMP/home` (with empty `AppData\Roaming`, `AppData\Local`) | `USERPROFILE` and `HOME` of the app. |
| `TMP/xdg-state`, `TMP/xdg-data` | Decoy `XDG_STATE_HOME`, `XDG_DATA_HOME` (MR-G3); must stay empty. |
| `TMP/stub` | `claude.cmd`, `claude-stub.cjs`, `opencode.cmd`, `opencode-stub.cjs`, `captures/`. |
| `TMP/repo` | The throwaway git repository, the run-2 project. |
| `TMP/app-run1.log`, `TMP/app-run2.log` | The app's stdout and stderr. |

`OUT = <ROOT>/_verify/routing-team-ui`, emptied first; at the end it holds only `team-tiers-fresh.png` and `team-tiers-stale.png`. The seed bundle is `OUT/seed-<pid>.cjs`, loaded and deleted at once (as :190–229).

## The stubs (C19)

Each shim is written byte-exact with CRLF line endings (the shape `parseNpmShim` reads):

```bat
@ECHO off
node "%~dp0\claude-stub.cjs" %*
```

and the same for `opencode.cmd` → `opencode-stub.cjs`. Each script (CommonJS) first records, then answers:

- **Record**, for every call: write `captures/<name>-<pid>-<Date.now()>-<8 random hex>.json` atomically (temp name, then rename) as `{ name, pid, argv: process.argv.slice(2), at: <ISO> }` — **argv only, never the environment**, and a name unique per process (`verify-routing-launch.mjs:294–296`).
- **`claude-stub.cjs`:** `argv` exactly `['--version']` → stdout `2.1.278 (Claude Code)\n`, exit 0; exactly `['--help']` → stdout `Usage: claude [options] [command] [prompt]\n  --output-format <format>  (stub)\n`, exit 0; anything else → no output, exit 1.
- **`opencode-stub.cjs`:** `['--version']` → stdout `1.18.34\n`, exit 0; `['run', '--help']` → **stderr** `opencode run [message..]\n\n  --format  (stub)\n`, nothing on stdout, exit 0 (the real 1.18.34 prints its run help on stderr only, so the probe exercises K15); anything else → no output, exit 1.

No stub stays alive: each answers and exits. A call Chorus should never make (a lead launch, a helper run) records its argv and exits 1, so it can touch nothing and TU12 sees it.

**Stub self-test** (part of TU1): `execFileSync(process.execPath, [<stub script>, '--version'])` for both prints exactly the versions above and `[… 'run', '--help']` prints nothing on stdout; then `captures/` is emptied, so TU12 counts only calls the app made.

## The app environment and the composed PATH (C19)

`appEnv = { ...process.env }`, then, as `verify-routing-launch.mjs:321–334`: delete `ELECTRON_RUN_AS_NODE`, `ELECTRON_RENDERER_URL`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`; set `USERPROFILE = HOME = TMP/home`, `HOMEDRIVE`/`HOMEPATH` from it, `XDG_STATE_HOME = TMP/xdg-state`, `XDG_DATA_HOME = TMP/xdg-data`. Then compose the PATH under **its own key** (`Object.keys(appEnv).find((k) => k.toUpperCase() === 'PATH')`):

```js
const AGENT_CLIS = ['claude', 'codex', 'kimi', 'opencode', 'grok'] // cliDetect.ts DETECTED_TOOLS agents; helperRegistry probes claude, codex, opencode
const SHIM_EXTS = ['', '.exe', '.cmd', '.bat', '.com', '.ps1']
const holdsAgentCli = (dir) => AGENT_CLIS.some((name) => SHIM_EXTS.some((ext) => fs.existsSync(path.join(dir, name + ext))))
const entries = appEnv[PATH_KEY].split(';').filter((d) => d.trim() !== '')
appEnv[PATH_KEY] = [STUB_DIR, ...entries.filter((d) => !holdsAgentCli(d))].join(';')
```

Every directory that holds any agent CLI is dropped, not only those holding a `claude.exe`: `team:capabilities` probes Codex too, and opening the launch dialog — the Team dialog's only entry point — probes all five, so a kept directory would start a real `codex`, `kimi` or `grok` (and a real `claude.exe` would beat the stub). `git`, `docker` and `node` stay resolvable (their `--version` is not an agent and spends nothing; the stubs need `node`). Print `# composed PATH: removed <n> of <m> directories that hold an agent CLI`.

**Preflight** (part of TU1; a failure ends the drive with every check failed, as `abortDrive`): with `execFileSync('where.exe', [name], { env: appEnv, cwd: ROOT })`:

| Name | Required |
|---|---|
| `claude` | Every candidate is inside `TMP/stub`; no `.exe`; the first `.cmd`/`.bat` is `TMP/stub/claude.cmd`. |
| `opencode` | The same with `TMP/stub/opencode.cmd`. |
| `codex`, `kimi`, `grok` | `where.exe` fails (not found). |
| `node`, `git` | At least one `.exe`. |

**Baselines** (before run 1, with the drive's own real environment): the bytes of `<os.homedir()>/.local/state/opencode/model.json` (and of `<XDG_STATE_HOME>/opencode/model.json` when that variable is set), or "absent"; `git -C ROOT worktree list --porcelain`, `git -C ROOT status --porcelain=v1 -z --untracked-files=all` and the SHA-256 of every path it names (as :365–406, with `GIT_OPTIONAL_LOCKS=0`).

**The throwaway repository** (part of TU1), as `verify-team-app.ts:17–20`: `git init -q -b main TMP/repo`; `git -C TMP/repo config core.autocrlf false`; write `README.md` (`routing team drive fixture\n`); `git -C TMP/repo add README.md`; `git -C TMP/repo -c user.name=Chorus Fixture -c user.email=fixture@localhost commit -qm Fixture`; `git -C TMP/repo rev-parse HEAD` is 40 hex digits.

## Fixtures and constants (hand-written; never computed by the code under test)

```js
const SLUG = 'deepseek/deepseek-v4.1-flash', NITRO_ID = SLUG + ':nitro', GLM = 'z-ai/glm-5.3'
const GATEWAY = 'https://openrouter.ai/api/v1'
const KEY = 'sk-or-v1-' + randomBytes(32).toString('hex') // built at run time; no key-shaped literal in the file
const PROVIDER = { name: 'OpenRouter (team drive)', adapter_type: 'opencode', auth_mode: 'api_key', base_url: GATEWAY, model: SLUG }
const CREDENTIAL_LABEL = 'Routing team drive key'
const PROJECT_NAME = 'routing-team-ui-repo'
const CLAUDE_STUB_VERSION = '2.1.278 (Claude Code)' // VERIFIED_HELPER_VERSIONS.claude (evidence.ts:7); not a focused version (team.ts:5)
const OPENCODE_STUB_VERSION = '1.18.34' // MEASURED_OPENCODE_HELPER_VERSIONS (evidence.ts:13)
const PRESET_LABEL = 'Routing team drive preset'
const PRE4B_LABEL = 'Pre-4b preset'
// ImplementationSpec-4b-3, copied by hand.
const TIER_VALUES = ['budget', 'balanced', 'fast', 'nitro', 'default']
const TIER_TEXTS = ['Budget', 'Balanced', 'Fast', 'Nitro — unfiltered provider routing', 'OpenRouter default']
const DEFAULT_DESC = 'Chorus sends no routing: OpenRouter picks the provider for each request, as before. The data-collection setting is not sent.'
const STALE_REASON = 'Refresh first: the numbers are older than 60 min.'
const BALANCED_HINT = 'Refresh to use Balanced.'
const CAPTION_LOW = 'Ranked for a Team helper at reasoning effort "low". Each attempt checks its tier again on the latest numbers.'
const tierLabel = (n) => `Routing tier for helper ${n}`
// ImplementationSpec-4b-1 (C1 unknownModel) with ImplementationSpec-4b-2's team:launch prefix, copied by hand.
const GLM_REFUSAL = 'Helper "GLM helper": Model routing does not know this helper\'s model.'
const LAUNCH_REFUSAL_CODE = 'ROUTING_REFUSED' // ImplementationSpec-4b-2 (overview C8): createRun's TeamDomainError code, copied by hand
// teamIpc.ts:25: how the bridge reports the strict schema's rejection.
const INVALID = { ok: false, code: 'INVALID_REQUEST', message: 'Team operation failed. Refresh the current state and retry.' }
```

## Flow

1. **Freshness** (TU1), as :129–188. `out/main/index.js` is not older than `src/main/services/team*.ts`, `src/main/services/routing*.ts`, `src/main/routing/*.ts` (and `model-registry.json`), `src/main/adapters/helpers/*.ts`, `src/shared/team.ts`, `src/shared/teamProfiles.ts`, `src/shared/routing.ts`, `src/main/ipc.ts`, `src/main/index.ts`, `src/preload/index.ts`; it contains `helper-routing-resolved` and `Model routing does not know this helper's model.`; the newest `out/renderer/assets/*.js` is not older than `TeamLaunchDialog.vue`, `LaunchDialog.vue`, `components/routing/*.vue`, `stores/routingTeam.ts`, `stores/team.ts`, `src/shared/routingView.ts`, `src/shared/routing.ts`, `src/shared/team.ts`, `src/shared/teamProfiles.ts`, and some asset contains `Ranked for a Team helper at reasoning effort` and `Routing tier for helper `. Otherwise print `FAIL TU1 …: build is stale: run npx electron-vite build` and `FAIL (15 of 15 checks)`, exit 1.
2. **Seed bundle**, as :190–229.
3. Create `TMP` and its layout; the stubs and their self-test; the composed PATH and the preflight; the throwaway repository; the baselines (all TU1).
4. **Run 1 (bootstrap, TU2's first half):** launch, connect, the in-page calls below, shutdown (as :708–736). Two runs because the credential needs the app's `safeStorage`, and the throwaway repository can become the project only by a database write while the app is not running (`project:add` needs a native picker).
5. **Between runs (TU2):** open `TMP/profile/chorus.db` with `node:sqlite`; `SELECT COUNT(*), MAX(version) FROM schema_migrations` → 28, 28 (MR-G6); `UPDATE projects SET status = 'archived' WHERE id = ?` (the seeded project) changes 1 row; `INSERT INTO projects (id, name, root_path, created_at, status, sort_order, color_seed) VALUES (?, ?, ?, ?, 'active', 1, 1)` with `PROJECT = randomUUID()`, `PROJECT_NAME`, `REPO = path.resolve(TMP, 'repo')` and now changes 1 row; `INSERT INTO settings (key, value) VALUES ('active_project_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value` changes 1 row; close. Write the fresh snapshot (`FRESH_AT` = whole seconds, five minutes ago) and observations, as :1249–1253.
6. **Run 2 (checks):** launch, connect, install the error watchers with positive controls (:1154–1185), TU2's second half, TU3–TU11, TU13, shutdown.
7. **After exit:** TU12, TU14, TU15, then `PASS (15 checks)` (exit 0) or `FAIL (k of 15 checks)` (exit 1).

Each run launches `require('electron')` with `['.', '--user-data-dir=TMP/profile', '--remote-debugging-port=<free port>', '--remote-debugging-address=127.0.0.1']`, `cwd: ROOT`, `env: appEnv`, `windowsHide: true`, stdout and stderr to that run's log; the port from `net.createServer().listen(0)`, never 9222. The CDP target is this checkout's `out/renderer/index.html` (as `isOwnRenderer`, :636–648). Renderer errors come from CDP `Runtime.exceptionThrown` and `Runtime.consoleAPICalled` (:587–596): Electron 43's `console-message` is event-first, and a `(_e, d) => d.level` hook never fires.

### In-page calls

`page(body)` evaluates `body` inside an async IIFE with `chorus = window.chorus`, `routing = window.chorus.routing` and `team = window.chorus.team` bound, pushes `JSON.stringify(value)` onto `responseTexts`, and returns the value (as :619–626). Payloads are object literals written in the page. `T()` = `routing.tiers({ model: SLUG, profile: 'helper', effort: 'low', credentialProfileId: CA })`, taken immediately before the dialog reading it is compared with (Phase 3 C18: compared with main's reply, never a golden order).

### Dialog helpers (run in the page)

- **`guardedClick(scope, text)`** — the only way the drive clicks. In **one** evaluation: find the first element matching `scope` whose trimmed text is exactly `text`; refuse (return `{ clicked: false, why }`, click nothing) when there is none, when it is disabled, when its text is `Launch team` or `Preparing lead…`, when it matches `.launch-foot .overlay-btn-primary` or lies inside `.launch-foot`; otherwise click it and return `{ clicked: true }`. A refusal throws in the drive. The drive's clicks are exactly: `('.empty-cta', 'Launch an Agent')` (or `button[aria-label="New agent"]` by its aria-label when the project shows panes; never the case here), `('.overlay-panel.launch .launch-head button', 'Team session')`, `('[aria-labelledby="team-launch-title"] fieldset button', 'Add helper')`, `('[aria-labelledby="team-launch-title"] details button', 'Save preset')`, `('[aria-labelledby="team-launch-title"] header button', 'Back')`.
- **`choose(selector, value)`** — in one evaluation: the element exists; for a `select`, an option with that value exists and is not disabled; set `.value`, dispatch bubbling `input` and `change` (v-model needs the event, `team-member-ui-checks.mjs:7–10`); return the element's value, which must equal `value`. Used for `select[aria-label="Helper N"]`, `select[aria-label="Routing tier for helper N"]`, `select[aria-label="Team preset"]` and `input[aria-label="Preset name"]`.
- **`openTeam()`** — unless the Team dialog is open: open the launch dialog with `guardedClick` when it is not open, wait for `.overlay-panel.launch`; `guardedClick` `Team session`; wait up to 30 s for `[aria-labelledby="team-launch-title"]`, no `p[role="status"]` inside it, at least one `select[aria-label="Helper 1"]` and `fieldset[data-routing-helpers-busy="false"]`.
- **`closeTeam()`** — `guardedClick` `Back`; wait for the Team dialog to be gone and `.overlay-panel.launch` to be back.
- **`readTeam()`** — a plain-JSON reading: `loading` (a `p[role="status"]`), `busy` (the fieldset's `data-routing-helpers-busy`), and per `fieldset[data-routing-helpers-busy] > .row`: the helper select's `aria-label` and `value`, and, when the row holds `[data-routing-helper-tier]`, its `data-routing-helper-selected`, `data-routing-helper-busy`, the `select[data-routing-helper-select]`'s `value`, `disabled` and `aria-label`, every option's `{ value, text (trimmed), disabled, title }`, and the `[data-routing-helper-hint]` text or null; plus `captions` (`[data-routing-helper-caption]` texts), `unavailable` (`[data-routing-helper-unavailable]` text or null), `helperSelects` (the count of `select[aria-label^="Helper "]`), the `Save preset` and `Launch team` buttons' `disabled`, the dialog's `p.error[role="alert"]` text or null, and whether a `Lead context` select exists.
- **`shot(name)`** — wait for the app's overlays (`[data-testid="startup-splash"], [data-testid="saved-flash"]`) to go, scroll `fieldset[data-routing-helpers-busy]` into view at the top, wait for fonts and 400 ms, `Page.captureScreenshot` into `OUT/<name>`.

## Checks

"Strictly equals" is `isDeepStrictEqual`. `samePath(a, b)` compares resolved paths case-insensitively. `row(n)` is `readTeam().rows[n - 1]`.

| # | Check | Expect |
|---|---|---|
| TU1 | Setup: fresh build, isolation, stubs first | The build is fresh (Flow 1). `TMP` and its layout exist. The stub self-test prints `2.1.278 (Claude Code)` and `1.18.34`, `run --help` writes nothing to stdout, and `captures/` is empty afterwards. The composed PATH starts with `TMP/stub`; the preflight table holds. `TMP/repo` has one commit. The baselines are recorded. Any failure aborts the drive (every check failed, `TMP` and the bundle deleted, exit 1). |
| TU2 | Bootstrap: credential, project, snapshot, capabilities | **Run 1:** `chorus.listProjects()` has exactly one active project, whose root is `ROOT` (`SEED_PROJECT`, the boot seed); `createProvider(PROVIDER)` → ok (`PA`); `createCredential({ providerId: PA, label: CREDENTIAL_LABEL, key: KEY })` → `{ ok: true, id }` (`CA`); `routing.credentials({})` strictly `{ ok: true, value: { credentials: [{ id: CA, label: CREDENTIAL_LABEL, providerName: PROVIDER.name }] } }`; `routing.status({}).value.requestsSinceStart` 0. **Between runs:** Flow 5's four statements with their counts. **Run 2:** `listProjects()` has exactly one active project, `PROJECT`, whose root `samePath`s `REPO`, and the seeded project's status is `archived`; `getLaunchContext(PROJECT).projectRoot` `samePath`s `REPO`. `team.capabilities({ projectId: PROJECT })` → ok with: `claude` `{ lead: true, enabled: true, helperEnabled: true }`, member `{ model: 'sonnet', effort: null, installedVersion: CLAUDE_STUB_VERSION }`; `codex` and `codex-sol` `enabled: false` with `installedVersion` `unavailable`; `CA` enabled, member `{ harness: 'opencode', model: GLM, authMode: 'api_key', credentialProfileId: CA, effort: null, installedVersion: OPENCODE_STUB_VERSION }`; `CA + '-deepseek'` enabled, member model `NITRO_ID`, `customModel: true`, effort `low`; `CA + '-deepseek-standard'` enabled, member model `SLUG`, effort `low`; every option's `installedVersion` is `CLAUDE_STUB_VERSION`, `OPENCODE_STUB_VERSION` or `unavailable` (no real CLI answered). `T()` → ok with `stale: false`, `profile: 'helper'` and non-null `tiers.budget`, `tiers.balanced`, `tiers.fast`. |
| TU3 | Dropdowns only on routable slots | `openTeam()` (the first open; renderer errors are cleared just before it). Two rows, both `CA-deepseek`, each with a tier element; `helperSelects` 2; row 1's tier select `aria-label` `tierLabel(1)`, option values strictly `TIER_VALUES`, texts strictly `TIER_TEXTS`, the default option's title `DEFAULT_DESC`, Nitro and default never disabled. `guardedClick` `Add helper` → three rows, row 3 `CA-deepseek` with a tier element. `choose('select[aria-label="Helper 3"]', 'claude')` → row 3 has no tier element; `choose(…, CA)` (GLM-5.3) → row 3 has no tier element and is not busy; `helperSelects` 3 (the tier selects do not match `^="Helper "`); no `[data-routing-helper-unavailable]`; the Lead context select is present (the dialog shows it for any Claude lead, `TeamLaunchDialog.vue:94`), but 2.1.278 is not a focused version, so `config()` adds no `leadContext` (:31), which TU7 asserts on the saved preset. |
| TU4 | K10 defaults | Recorded from TU3's readings: rows 1 and 2 `selected` `nitro` and select `value` `nitro` at the first open, and row 3 `nitro` right after Add helper. `choose('select[aria-label="Helper 2"]', CA + '-deepseek-standard')` → row 2 `selected` and `value` `default`, no hint; row 1 still `nitro`. |
| TU5 | Fresh numbers enable the ranked tiers | `T()` → `stale: false` and all three ranked tiers non-null. Rows 1 and 2: every option `disabled: false`, texts strictly `TIER_TEXTS` (no reason suffix), tier `busy` `false`, select not disabled, hint null. `captions` strictly `[CAPTION_LOW]`; fieldset `busy` `false`; `Launch team` not disabled (read only; never clicked). Screenshot `team-tiers-fresh.png`. |
| TU6 | Balanced through the real select | `choose('select[aria-label="Routing tier for helper 1"]', 'balanced')` → row 1 `selected` and `value` `balanced`, hint null; row 2 `default`; row 3 has no tier element. |
| TU7 | Save preset carries tier names only (MR-G5) | `choose('input[aria-label="Preset name"]', PRESET_LABEL)`; `guardedClick` `Save preset`; wait up to 10 s for `select[aria-label="Team preset"]` to list an option whose text starts with `PRESET_LABEL + ' · v1'`; no dialog `p.error[role="alert"]`. `team.presetList({ projectId: PROJECT })` → ok with exactly one preset labelled `PRESET_LABEL`, version 1, whose `config` has: `helpers.map((h) => h.routingTier ?? null)` strictly `['balanced', null, null]`; `Object.hasOwn(helpers[i], 'routingTier')` false for `i` 1 and 2; `helpers.map((h) => h.model)` strictly `[NITRO_ID, SLUG, GLM]`; every helper's `credentialProfileId` `CA`; no own key named `routing` at any depth; `lead.harness` `claude`, `lead.installedVersion` `CLAUDE_STUB_VERSION`; no `leadContext`. The three watcher controls were caught, and no renderer error or unhandled rejection has occurred since the first open; none mentions `could not be cloned`. |
| TU8 | Presets restore tiers (K10, C13, Q8) | In the page, from `team.capabilities`: `team.presetSave({ projectId: PROJECT, expectedVersion: null, label: PRE4B_LABEL, config: { schemaVersion: 1, baseRevision: 'HEAD', lead: { ...<claude>.member, id: crypto.randomUUID() }, helpers: [{ ...<CA-deepseek>.member, id: crypto.randomUUID(), label: 'DeepSeek Flash Nitro - helper 1' }], concurrency: 2, executionMinutes: 30, integrationPolicy: 'lead-integrates' } })` → ok (a preset with no `routingTier`, as every pre-4b preset). `closeTeam()`, `openTeam()`. `choose('select[aria-label="Team preset"]', <PRE4B id>)` → one row, `CA-deepseek`, `selected` `default` (not `nitro`), hint null. `choose(…, <PRESET id>)` → rows `[CA-deepseek, CA-deepseek-standard, CA]`; row 1 `selected` and `value` `balanced`, row 2 `default`, row 3 no tier element; no hint; fieldset `busy` `false`. |
| TU9 | Stale numbers fall back with a hint (MR-D26) | Re-seed `snapshot.json` with `STALE_AT` (whole seconds, two hours ago). `T()` → `stale: true`. `closeTeam()`, `openTeam()`, `choose('select[aria-label="Team preset"]', <PRESET id>)`. Row 1: `selected` and `value` `default`, hint `BALANCED_HINT`; options Budget, Balanced, Fast `disabled: true` with texts `Budget — ` + `STALE_REASON` (and Balanced, Fast likewise) and title `STALE_REASON`; Nitro and default enabled with their plain texts. Row 2: `default`, no hint, the same option states. Row 3 no tier element. `captions` `[CAPTION_LOW]`; fieldset `busy` `false`. Screenshot `team-tiers-stale.png`. |
| TU10 | Main refuses a tier on GLM-5.3 (C1, C8, K4) | In the page, from `team.capabilities`: `team.launch({ projectId: PROJECT, clientRequestId: 'routing-team-ui-tu10', config: { schemaVersion: 1, baseRevision: 'HEAD', lead: { ...<claude>.member, id }, helpers: [{ ...<CA>.member, id, label: 'GLM helper', routingTier: 'balanced' }], concurrency: 2, executionMinutes: 30, integrationPolicy: 'lead-integrates' } })` → strictly `{ ok: false, code: LAUNCH_REFUSAL_CODE, message: GLM_REFUSAL }`, that is `{ ok: false, code: 'ROUTING_REFUSED', message: 'Helper "GLM helper": Model routing does not know this helper\'s model.' }` (ImplementationSpec-4b-2's `createRun` refusal, C8, with C1's `unknownModel`). The lead (`sonnet`, effort null) and the helper pass `validateMember` on the stubs, so the refusal can only be the routing check's. Then `team.list({ projectId: PROJECT })` strictly `{ ok: true, value: { runs: [], unavailable: [] } }`. |
| TU11 | Main rejects a routing object and a tier on a Claude member (K2, MR-G5) | The same lead with (a) a helper `{ ...<CA-deepseek>.member, id, label: 'Nitro helper', routing: { tier: 'balanced', model: SLUG, sentModelId: SLUG, provider: { order: ['streamlake/fp8'], allow_fallbacks: false }, endpoints: ['streamlake/fp8'], snapshotFetchedAt: FRESH_AT, computedAt: FRESH_AT } }` and (b) a helper `{ ...<claude>.member, id, label: 'Claude helper', routingTier: 'balanced' }`, each with its own `clientRequestId` → each strictly `INVALID`. `team.list` still has no run. |
| TU12 | Nothing launched (after exit) | `node:sqlite` on `TMP/profile/chorus.db`: `schema_migrations` 28, 28; `COUNT(*)` 0 in `team_runs`, `team_tasks`, `team_attempts`, `team_events` and `sessions`; `team_presets` 2 rows, and `PRESET_LABEL`'s `config_json` parses to helpers whose `routingTier ?? null` is `['balanced', null, null]` (stored as JSON text, no migration: MR-G6). Captures: every `claude` record's `argv` is `['--version']` or `['--help']`, with at least one of each (the Team probe reached the stub, not a real CLI); every `opencode` record's `argv` is `['--version']` or `['run', '--help']`, at least one of each; every recorded pid is gone (`stubProcessState` by `ProcessId`; a reused pid counts as gone; a live stub is killed only by the pid-targeted, command-line-confirmed last resort, and the check fails). No `TMP/.chorus` (no Team worktree); `git -C TMP/repo worktree list --porcelain` names one worktree. The user's repository: `worktree list`, `status` and content hashes equal the baselines (as :1735–1754). |
| TU13 | No OpenRouter request, no renderer error | `routing.status({}).value.requestsSinceStart` 0 (no check presses Refresh). Read `document.body.innerText` for TU14. The console, exception and unhandled-rejection controls were caught; the watcher survived (no reload); no renderer error and no unhandled rejection since the first open; none mentions `could not be cloned`. |
| TU14 | No key material (MR-G4, after exit) | Positive controls: a concatenated `sk-or-v1-` sample matches `secret-patterns.json`; the scan reports `KEY` planted in a scratch string, by name and by pattern; `length(encrypted_blob)` of `CA`'s `credential_profiles` row is > 0 (the key exists, encrypted). Then neither `KEY` nor any secret pattern appears in: the page text (TU13), every in-page response (at least 15), both app logs, every capture file, every `team_presets.config_json`; and the bytes of `chorus.db` and any `chorus.db-wal`/`-shm` contain `KEY` neither as UTF-8 nor as UTF-16LE. A hit names where and which pattern, never the value. |
| TU15 | Cleanup and MR-G3 | `TMP/xdg-state` and `TMP/xdg-data` are empty; the user's real `model.json` (and the `XDG_STATE_HOME` one when set) has the same bytes as at the start, or is still absent. Then `TMP` is deleted (retrying as :257–270), the seed bundle is gone, and `OUT` holds exactly `team-tiers-fresh.png` and `team-tiers-stale.png`. |

On a failure, print the last 30 lines of each app log as :1810–1817 does, after replacing every secret-pattern match and `KEY` with `[redacted]`.

## Process safety

- Its own app child only: stopped by `Browser.close`, then `child.kill()`, then `taskkill /pid <its pid> /F` (:708–736), never by name, never port 9222, never `%APPDATA%\chorus*` or the installed Chorus.
- The stubs answer and exit; none is long-lived. The only direct kill of a stub is TU12's last resort, pid-targeted and confirmed by `Win32_Process` queried **by `ProcessId`** (a `CommandLine`-substring filter matches the query itself).
- No click can reach a Launch button (`guardedClick`), and every direct `team.launch` payload is one main must refuse. Should main wrongly accept one, the run would use the throwaway repository (worktrees under `TMP/.chorus`) and the stub `claude`, which records the lead's argv and exits 1; TU10–TU12 fail.
- Ctrl+C / Ctrl+Break: kill the app child by pid, delete `TMP` and the bundle, exit 1 (as :556–581).
- The fake key exists only in the drive's memory and the throwaway profile's encrypted row; both are deleted at the end, also on interrupt.

## Invariants

- Zero cost: no Refresh click, no `model:refresh`, no key test, no OpenRouter request (`requestsSinceStart` 0), no real CLI, no Team launch (K14 (c), MR-D18).
- The app can resolve only the two stubs as agent CLIs; every option it reports carries a stub version or `unavailable`.
- Every ranked-tier expectation is compared with main's own `routing:tiers` reply (Phase 3 C18).
- The user's real OpenCode state and repository are byte-identical; the decoy XDG directories stay empty (MR-G3).
- The drive tests a fresh build in a throwaway profile, home and project, stops only what it started, and leaves only two PNGs.

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

Expected: `npm test` passes unchanged from Task 4b-3 (reference: 149 files and 4,304 tests; this task adds none). `PASS (30 checks)`, `PASS (20 checks)` (IPC), `PASS (20 checks)` (UI harness), `PASS (16 checks)` (Settings), `PASS (18 checks)` (body script), `PASS (20 checks)` (launch drive), `PASS (16 checks)` (Team harness) and `PASS (15 checks)` for this drive, each with exit code 0; `verify-team-storage.mjs` prints a report with `"passed": true` and `verify-team-review-ui.mjs` a line with `"passed":true`, each exit 0 (overview MR-G1: every earlier check). `_verify/routing-team-ui` holds exactly `team-tiers-fresh.png` and `team-tiers-stale.png`; the `%TEMP%` listing is empty. `npm run grep:secrets` scans `_verify/`, so it runs after the drives. Paste the drive's full output and one sentence per screenshot: the fresh one shows slot 1 on Nitro, slot 2 on OpenRouter default, slot 3 (GLM-5.3) with no dropdown and the caption; the stale one shows slot 1 on OpenRouter default with `Refresh to use Balanced.` under it.
