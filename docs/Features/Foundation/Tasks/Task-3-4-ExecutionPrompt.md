# Chorus Phase 3, Task 3-4 Execution Prompt — First Real Settings View

_Generated 2026-07-23 against HEAD `62fc236`. Every ground fact in §3–§4 was verified at that commit by direct coordinator inspection: `npm run typecheck` exits 0, `npx vitest run` = **224/224 across 10 files**, `npm run grep:secrets` clean, the real dev DB holds migrations 1–5 with the standing fixture intact, and the working tree carries **docs-only** changes (§5)._

## §1 Role

You are the implementation engineer for Chorus **Phase 3, Task 3-4**. Repo root: `C:\Projects\ContactEstablished\Chorus`. Expected branch `main` — confirm with `git branch --show-current`; **do not switch or create branches**. Expected HEAD: `62fc236` ("Task 3-3: AgentAdapter interface + capabilities + launch-path refactor") or a descendant.

Planning was done by a separate coordinator. Your final summary will be reviewed against the task docs, and **the reviewer WILL re-run your verification independently** — including the no-leak sweep with their own planted key.

**⚠ THIS SESSION MAKES EXACTLY TWO COMMITS** — a ratified exception to G3, recorded as **D37** (precedent: D24, D32, D36):

1. **Commit 1 — chore:** the **F25** fix — `layout:get` tolerates unknown-agent rows instead of blanking the whole project. One main-process file.
2. **Commit 2 — task:** the Settings view — **renderer-only; no main-process, shared, or preload file is touched in this commit.**

Do them in that order, each self-contained, each with its own verification pass. Do not squash them.

**⚠ THIS IS THE ONLY TASK IN THE PHASE WHERE A HUMAN TYPES A REAL KEY INTO A FORM.** D33 clause 3 (write-only inbound IPC) meets a text input here. The security bar is not "the CRUD works" — it is that the key is **unrecoverable through every surface a renderer can reach**, proven six ways (§10).

## §2 Goal

**The chore (F25, found by the 3-3 implementer, coordinator-confirmed in code):** `sessionInfoSchema.agent` is the two-value enum and `layout:get` outbound-parses its whole `{layout, sessions[]}` aggregate — so ONE session row whose `agent` column holds an unknown value rejects the entire invoke, `App.vue`'s load watcher has no catch, and the project renders the **empty state** on an uncaught rejection despite having a real layout. Pre-existing at `a0b6a5e`; latent (nothing writes non-enum agents today); fixed now because this session opens the renderer anyway and Phase 6's registration seam will eventually make it live. **The fix filters the projection, not the schema:** unknown-agent rows are dropped from the *response* via a registry lookup (never from the DB, never from the tree), one pino warn each; the affected leaf renders `LayoutRenderer`'s existing leaf-without-row placeholder. D34(c)'s degrade-don't-crash rule, extended to the layout-view layer.

**The task (D29):** give Chorus a place to configure providers and credentials, and make the write-only rule **visible in the UI** rather than merely true in the IPC layer. The interesting constraint: **this screen can never show the user what they typed.** Clause 3 admits no read path, and D33(b) removed fingerprints from IPC, so there is not even a hash to show. A credential profile renders as a label, a provider, a creation date, and a health state — that is the complete set of facts the renderer is permitted to know. A user who forgets which key they stored cannot check, only replace; the mandatory label carries that weight, so the form should push toward descriptive labels.

`App.vue` gains Chorus's **first navigation concept** — a workspace ⇄ settings view switch that Phase 3b's council UI later inherits. The overlay idiom is not abandoned: `LaunchDialog`/`CommandPalette`/`WorktreePanel` stay overlays; only durable configuration moves into the view.

## §3 Project Context

Architecture: local-first, Windows-only Electron 43.1.1 + Vue 3 + TypeScript + Vite + Pinia; agent CLIs as live TUIs in xterm.js panes; PTYs in MAIN owned by `SessionManager`; renderer attaches by session id over typed IPC; `contextIsolation: true`, `nodeIntegration: false`; SQLite via better-sqlite3 (WAL); all Zod in main (D1 — the page CSP forbids Zod's eval, so preload and renderer are Zod-free). Phase 3 tasks 3-1 (redacting logger), 3-2 (DPAPI vault + eight write-only channels), 3-3 (adapters + `adapter:list`) have landed. **The vault channels have never had a UI caller — you are their first.**

Dev machine: Windows 11, PowerShell 7, Node 22.14.0, git 2.50.0.windows.1. CLIs drift (claude self-updated mid-phase to 2.1.218) — irrelevant to this task beyond the launch dialog continuing to work.

Environment quirks — all expected, none a bug you caused:

- **(a)** OS toasts disabled system-wide; `[notify] toast failed:` lines are normal.
- **(b)** Codex TUI first-run prompts — update prompt (press **2 to Skip, never 1**); `TERM is set to "dumb"` `[y/N]`.
- **(c)** `node-pty` logs `AttachConsole failed` on teardown. Noise.
- **(d)** The automation harness strips `ComSpec` and modifies PATH — restore before launching:
  `$env:ComSpec = "$env:SystemRoot\System32\cmd.exe"` and
  `$env:PATH = "$((Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment').Path);$((Get-ItemProperty 'HKCU:\Environment').Path)"`.
- **(e)** `TaskStop` kills only the wrapper shell. Find the root (`node.exe` with `electron-vite*dev` in its command line) and `taskkill /PID <pid> /T /F`; confirm port 9222 free. **electron-vite hot-reloads the RENDERER only** — commit 2's Vue/store edits HMR nicely, but **commit 1 is a main-process edit and every check of it needs a real tree-kill cold boot**, as does any check involving boot behavior (restore, reconcile).
- **(f)** Launch: restore ComSpec/PATH, then `node node_modules/electron-vite/bin/electron-vite.js dev -- --remote-debugging-port=9222` from repo root.
- **(g)** Orphan checks walk the electron main PID's **descendant tree**, never `tasklist` name-matching.
- **(h)** Verification driver: **CDP** on 9222 (`Runtime.evaluate` in IIFEs — top-level `const` collides across evaluates; `Page.captureScreenshot`; `Page.reload` for the reload check; network-conditions throttling for the F13 fast-switch test). `ws` in the session scratchpad, never the repo.
- **(i)** **`sqlite3` CLI NOT installed.** DB inspection = better-sqlite3 by absolute repo path via `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe dump.js out.json`. **Flake: no output file on first run — retry once.** `_verify/` is gitignored; see `_verify/2-1-dump.js`.
- **(j)** CDP reaches `window.chorus` AND the DOM — the no-leak sweep drives both.
- **(k) G4 + `_verify/`:** `scripts/secret-grep.mjs` scans `_verify/`. Your planted fake key will land in dumps there. **Purge those artifacts before the final `npm run grep:secrets`** — and do not "fix" the gate by editing `SCAN_DIRS`; that edit is a reportable regression.

### Dev-machine baseline — coordinator-verified 2026-07-23, do NOT "clean up"

- Migrations **1–5** (v5 `2026-07-23T13:04:06.301Z`). **No migration this task — still 5 at the end.**
- Projects `985d547b-…` ("Chorus") / `f47ac10b-…` ("Chorus-Second", root `C:\Projects\ContactEstablished` — the parent, not a git repo; F22). Two sessions (`claude`, `codex`), both `exited`. `provider_configs` / `credential_profiles` **empty** — your form-driven rows should be **deleted through the UI at the end**, which is itself a test of your delete flow.
- **`worktrees` fixture:** `9ba9b0da-…`, `detached`, branch `chorus/Chorus/24b5c1fe`, `base_branch ''`, path `…\.chorus\Chorus\wt-24b5c1fe`. **⚠ Row, directory, and branch are a retained regression fixture — do not remove any of the three.**
- **F20, stated as fact:** execution sessions run with a **redirected AppData but a real `C:\Projects`** (three implementer sessions in a row saw project ids `a43b395d…`/`b684e96e…`). Filesystem/git evidence is trustworthy; DB evidence describes a different DB and the coordinator re-verifies. **Quote the `projects` table ids in every dump.**

## §4 Ground Yourself First (Read BEFORE Editing)

Docs, in this order:

- `CLAUDE.md` — locked rules. **No new dependency** (a routing library is explicitly out — the switch is a `ref` + `v-if`).
- `docs/Features/Foundation/roadmap.md` — §6 **D29** (this view's charter), **D33 clause 3 + resolution (b)** (what the renderer may know), **D36/D37** (the chore chain), §5 **F13** (the async-`onMounted` bail rule — found and fixed at `de98679`, and this task's components are its next real exposure), **F20**, **F25**.
- `docs/Features/Foundation/Tasks/Phase-3-Overview.md` — phase contract, file-ownership matrix.
- `docs/Features/Foundation/Tasks/Task-3-4.md` — **THE task contract, including the D37 chore table. THIS GOVERNS.**
- `docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-3-4.md` — exact contents: §1 the navigation shape (where the `v-if` goes and why the header stays mounted — **amended 2026-07-23: the settings shell is a left-nav skeleton per D38, with Esc-to-close**), §2 the store, **§4 the credential component — the security-sensitive one, build it against this**, §5 providers (**amended: grouped provider cards with nested credential rows**), §6 the palette command, §7 verification incl. **test-the-test**.
- **`docs/design/Chorus Settings Providers.dc.html` — the D38 layout skeleton.** Open it in a browser and match the STRUCTURE: left settings nav (one live entry + back-to-workspace·esc), provider cards, nested credential rows, per-provider "+ credential". **Skeleton ONLY:** keep the app's existing neutral Tailwind idiom — no Archivo/JetBrains Mono, no design-token colors, no titlebar/status-bar/project-rail (all Phase 3c). **One hard override: the mock's masked key hints (`sk-ant-…Xq4F`) are FORBIDDEN by D33 clause 3 — render the auth method in that column.** The mock's future-phase content (model catalog, "make default", "logged in as", re-login/log-in, Google/OpenRouter cards) is not built — render only what the channels actually serve.

**⚠ One spec correction (the spec predates 3-2/3-3 landing):** the spec's sketches call `window.chorus.listCredentialProfiles()`. **The shipped preload name is `listCredentials`** (§4 below lists the full real surface). Where the spec's names and the shipped preload disagree, **the shipped preload wins** — it is the typed reality, and inventing a second name means a preload edit, which commit 2 forbids.

### Code state — verified 2026-07-23 at `62fc236`; trust this over any older doc line

- Baseline: typecheck 0; **224/224 across 10 files** — `src/shared/ipc.test.ts` (76), `worktrees.test.ts` (30), `layout.test.ts` (26), `adapters.test.ts` (23), `vaultCore.test.ts` (21), `palette/commands.test.ts` (17), `logger.test.ts` (13), `stores/layout.test.ts` (7), `restore.test.ts` (6), `stores/view.test.ts` (5); `grep:secrets` clean.
- **The preload surface you consume** (`src/preload/index.ts`, exact names and lines): `listAdapters` (**70**), `listProviders` (**117**), `createProvider` (**120**), `updateProvider` (**123**), `deleteProvider` (**126**), **`listCredentials` (129)**, `createCredential` (**132**), `replaceCredential` (**135**), `deleteCredential` (**138**). All typed; no Zod in preload.
- **Wire shapes** (`src/shared/ipc.ts`): `adapterDescriptorSchema` at **613** → `{id, displayName, executionMode, authMethods[{type,label,requiredEnvVar,helpUrl}], capabilities}`; `AdapterListResponse` at **626**. `credentialProfileMetaSchema` at **414** (now **`.strict()`** per D36) → `{id, providerId, label, createdAt, lastVerifiedAt, unavailableSince}` — **that object is the complete set of facts the renderer will ever have about a credential.** Provider create/update/delete responses are the `{ok:true,…} | {ok:false, reason}` union — render `reason` inline, never throw.
- **`unavailableSince` semantics (F-5a, contract-literal):** the mark is set on decrypt failure and clears **only** on a successful replace — a profile can show unavailable until the user re-enters the key. Your UI renders it as a distinct, actionable state ("Re-enter the credential"), reusing the red-dot vocabulary pane headers use for `exited`.
- **`src/renderer/src/App.vue`** (289 lines) — stores at **18–22** (`sessions` ref at 22); the project-load watcher at **39–56** (**no catch — the F25 symptom's renderer half; your chore fixes main, so this stays untouched**); `effectiveFocused` at **61**; `openLaunchDialog` at **70**; `paletteOpen` at **79**; the capture-phase `onGlobalKey` at **85** with its `onMounted`/`onUnmounted` at **91–92**; `paletteCommands` computed at **173**; template from **233** — top bar at **236** (`ProjectTabs` + the view toggle), main region **251–268** (`FilmstripRenderer` 251 / `LayoutRenderer` 260 / `EmptyState` 268), overlays **270–277+**. **Your `v-if` wraps the main region only; the top bar stays mounted in both views** (spec §1 — this is what makes it a view switch, not a fourth overlay).
- **`src/renderer/src/palette/commands.ts`** (148 lines) — `PaletteCommand` at **10**, `PaletteContext` at **21**, `buildCommands` at **37**. Pure module: no store imports, no `window.chorus`, no Zod (the 1b-3 discipline). `fuzzyFilter` **omits disabled commands**. `PaletteContext` gains `openSettings: () => void`; `App.vue`'s computed supplies it.
- **`src/renderer/src/stores/view.ts`** (63 lines) — **the model for your settings store**: module-level `loadSeq` at **20**, the guard inside `loadFor` at **36–42**. Copy the shape, including the guarded `finally` (spec §2 shows the trap: an unguarded `loading = false` lets a stale load clear a live one's spinner).
- **There is no `src/renderer/src/views/` directory and no settings store** — you create them.
- **Chore target** (`src/main/ipc.ts`, 918 lines): the `layout:get` handler at **827** — it builds `branchBySession` at 835–838 and returns `layoutGetResponseSchema.parse({...})` at **839**. `getAdapter` is **already imported** in this file (the 3-3 restart path uses it); your filter reuses it. `sessionInfoSchema` (`src/shared/ipc.ts:669`, `agent: agentKindSchema` at 671) is **not modified** — the whole point is projection-side tolerance.
- **F13, concretely:** `de98679` fixed a `TerminalPane` continuation that ran after unmount and leaked three bridge listeners for the app's lifetime. Your `SettingsView` has three concurrent loads behind one `await` and an obvious trigger (open settings, immediately click back). Register the `alive` flag **before** the first await; bail after **every** await.
- **D14, concretely:** every payload you send must be a plain object. Your form inputs are component-local `ref`s of primitives — a fresh object literal suffices. If any field ever comes from store state, snapshot it (`JSON.parse(JSON.stringify(...))`). Structured clone failures throw at runtime with **no compile-time signal**.

### Git checks (run first)

```powershell
git branch --show-current   # expect: main
git status --porcelain      # expect: docs-only entries (see §5)
git log --oneline -1        # expect: 62fc236 or descendant
git config user.email       # expect: mwilson29072@gmail.com
git worktree list           # expect: main tree + .chorus\Chorus\wt-24b5c1fe
```

## §5 Pre-existing Changes Warning

**The working tree carries docs-only changes from the 3-3 completion review and this kickoff:**

```
 M docs/Features/Foundation/Tasks/Phase-3-Overview.md
 M docs/Features/Foundation/Tasks/Task-3-4.md
 M docs/Features/Foundation/roadmap.md
```

Plus this prompt itself (`docs/Features/Foundation/Tasks/Task-3-4-ExecutionPrompt.md`). **These may or may not be committed by the time you start** — either way: **do not revert, stage, or commit anything under `docs/`.** Your two commits contain only source files. If `git status` shows anything outside `docs/` at session start, **stop and ask**. `_verify/` is gitignored — but see §3(k) about planted keys there.

## §6 Resolved Decisions and Findings That Bind This Task

Quote; do not relitigate.

- **D1** (locked): Zod in main only — your store and components parse nothing; they trust the typed preload surface. **D3** (locked): renderer never spawns processes. **D14** (locked): plain-object payloads.
- **D21** (RESOLVED 2026-07-19): the palette is an extensible registry — the "Open settings" command goes in `buildCommands`, not bolted onto `App.vue`.
- **D26(g) / D29** (2026-07-20 / 2026-07-21): D26(g)'s overlay-not-settings-panel ruling was correct *for Phase 2* and is not a precedent against this view — PLAN §14 places provider/credential settings in Phase 3, so this arrives on schedule. `App.vue` gains the workspace ⇄ settings switch; Phase 3b inherits it.
- **D33 clause 3 + resolution (b)** (RESOLVED 2026-07-22): write-only inbound IPC; fingerprints never cross; the **label** is the only user-facing handle on a stored key. Clause 8 / F-5a: unavailable profiles stay marked until replaced — render that state honestly.
- **D36** (RESOLVED 2026-07-23, landed `46ad9b7`): `credentialProfileMetaSchema` is `.strict()`; `replaceProfile` has duplicate detection with the own-row exemption — your replace form may receive a `duplicate` refusal naming another profile's label; render it inline.
- **D37** (RESOLVED 2026-07-23): **your commit 1.** The `layout:get` projection filter, warn-logged, tree untouched, row untouched. **Rejected alternative recorded:** widening `sessionInfoSchema.agent` to `z.string()` — do not resurrect it.
- **F13** (found 1b-2, fixed `de98679`): the async-`onMounted` bail rule. Binds every new component here.
- **F20**: redirected AppData — quote project ids in dumps.
- **F25** (found by the 3-3 implementer, coordinator-confirmed): the defect your chore closes. Its runtime proof doubles as the regression test for D34(c) at the layout layer.
- **Phase prime directive:** a key never reaches a log, a transcript, the renderer, or disk in plaintext. **This task is where "the renderer" is most at risk — a `v-model` bound to store state, a success toast interpolating the submitted value, or one debug `console.log` is a clause-3 breach.**

## §7 Implementation Scope

Follow the two Exact Scope tables in `Task-3-4.md` and the near-final contents in `ImplementationSpec-3-4.md`. Summary:

### Commit 1 — chore (D37: F25)

One file: `src/main/ipc.ts`. In the `layout:get` handler (827), filter the rows fed to the outbound parse:

- keep a row ⇔ `getAdapter(row.agent)` returns an adapter;
- one `logger.warn` per dropped row naming the row id and the bogus agent value (the logger's two-layer redaction already covers it; the agent value is not secret);
- the **tree** passes through untouched; the **row** stays in the DB; nothing is healed, deleted, or rewritten here — projection only.

### Commit 2 — task (renderer-only)

| File | Change |
|------|--------|
| `src/renderer/src/views/SettingsView.vue` | **Create.** Shell per the D38 skeleton: left settings nav (one live entry "Providers & keys"; bottom-pinned "back to workspace" → `close`, also on **Esc**, which must yield to open overlays) beside the content region; F13-disciplined loads; no dead nav entries. |
| `src/renderer/src/views/SettingsProviders.vue` | **Create.** The content region: **one card per provider with its credential rows nested inside** (D38; grouping is a computed over the store's flat lists). Provider create/edit/delete; adapter + auth-mode selects driven by `listAdapters()`; `env_var_name` as an **empty input with the adapter default as placeholder** (spec §5). Delete refusals render inline; do not pre-disable by counting profiles renderer-side — main is the authority. |
| `src/renderer/src/views/SettingsCredentials.vue` | **Create.** The credential rows + add/replace form, rendered per provider card. The write-only surface — build against spec §4 exactly: `type="password"` + `autocomplete="off"` + `spellcheck="false"`; `keyValue` component-local; cleared on success **and** `onBeforeUnmount`, **not** on failure; `error.value = res.reason` verbatim — **never** interpolate the submitted value. A row renders label · auth method · `lastVerifiedAt`("never verified") · `unavailableSince`(distinct actionable state) · actions. **No key-hint column — the mock's mask is D33-forbidden.** |
| `src/renderer/src/stores/settings.ts` | **Create.** Model on `view.ts`: `{providers, profiles, adapters, loading, error, loadSeq}`; `load()` with the supersede guard incl. the guarded `finally`; create/replace/delete actions that pass the key **through as a parameter, never into state**, refresh on success, surface `{ok:false}` without corrupting the list. **There is no `key` field in state and never will be — say so in a comment.** |
| `src/renderer/src/stores/settings.test.ts` | **Create.** §10's table — including the deep-scan test. |
| `src/renderer/src/App.vue` | **Edit.** `const activeView = ref<'workspace' \| 'settings'>('workspace')`; `v-if` around the **main region only** (251–268), top bar stays mounted; a top-bar Settings ⇄ Workspace control beside the view toggle; `paletteCommands` supplies `openSettings`. **The load watcher (39–56) is untouched.** |
| `src/renderer/src/palette/commands.ts` | **Edit.** `settings.open` command — `enabled: () => true` (settings are not project-scoped), keywords incl. `providers`, `credentials`, `keys`. Module stays pure. |
| `src/renderer/src/palette/commands.test.ts` | **Edit.** Presence, group, enabled-without-project, fuzzy `'set'` surfaces it. |

**Explicitly do NOT touch (commit 2):** anything under `src/main/` or `src/preload/`, `src/shared/*`, `LaunchDialog.vue`, `WorktreePanel.vue`, `TerminalPane.vue`, `FilmstripRenderer.vue`, `LayoutRenderer.vue`, the layout/view/project/session stores. If a change seems to require one, raise it loudly.

### Key invariants

- **No plaintext key in Pinia, the DOM, an error string, a log line, or a `console.*` — at any moment, including transiently.**
- **The store's deep-scan test and the runtime DOM scan are both shown to FAIL when a key is deliberately retained** (test-the-test, spec §7.2), then revert the sabotage.
- **Switching views does not destroy sessions:** panes unmount (expected — PTYs live in main; `attach()` replays), and a session **survives the round trip with scrollback intact**. Do not reach for `<KeepAlive>` (invisible live xterm instances — the leak class `de98679` killed).
- **Every list the UI renders comes from the wire** (`listAdapters`/`listProviders`/`listCredentials`) — no hardcoded adapter names, auth modes, or env-var strings in the new files.
- **The chore filters the projection only** — DB rows and the layout tree are not modified by `layout:get`, ever.

## §8 Strict Non-Goals

- **No new IPC channel, no schema change; commit 2 makes no main/preload/shared edit.** Commit 1's filter is the one sanctioned main edit (D37).
- **No key display of any kind** — no masked preview, no character count, no "key set ✓" derived from the value. **This overrides the design mock**, which shows `sk-ant-…Xq4F`-style hints; D33 clause 3 wins, and the review greps the diff for hint-shaped rendering.
- **No Test-key button** (Task 3-6) — and no disabled placeholder button either; do not ship dead UI.
- **No launch-dialog change, no injection** (3-6). **No scrubber work** (3-5).
- **No settings beyond providers + credentials** — no theme/font/keybindings/general tab, and **no disabled placeholder nav entries** for the mock's future sections (the jump-ahead bar + the no-dead-UI rule). **No visual-system adoption** — no fonts, no design-token colors, no titlebar/status-bar/project-rail; Phase 3c owns the restyle.
- **No vue-router or any new dependency.**
- **No change to the overlay components or to `unavailable_since` semantics** (F-5a stays contract-literal; the UI renders what the wire says).
- **No `window.confirm`** (blocks the renderer thread — the house rule since 2-3); destructive confirmations follow the `WorktreePanel` inline idiom.
- **Do not delete the `wt-24b5c1fe` fixture. Do not revert/stage/commit `docs/`. Do not push, open a PR, amend, or rebase.**

## §9 Required Workflow

1. **Ground per §4.** Read `Task-3-4.md` + `ImplementationSpec-3-4.md` in full; skim spec §4 twice — it is the component the review will read line by line.
2. **Commit 1 — chore.** Implement the filter; cold-boot; run the F25 runtime proof (§10 item 1); **restore the hand-edited row and prove it**. Typecheck + vitest + grep:secrets. **Commit**, narrated as a flagged D37 chore.
3. **Commit 2 — task.** Store first (its shape drives the components), then SettingsView shell, then the two panels, then App.vue switch, then the palette command. Renderer HMR makes this loop fast; remember any *boot-flow* check still needs a cold start.
4. **Unit tests**, then all three gates.
5. **Runtime verification (§10 items 2–9)** — the six-way no-leak sweep is the acceptance gate; do it with care and keep the artifacts (then purge planted keys per §3(k) and re-run `grep:secrets`).
6. **Self-review the diff** against `Task-3-4.md`'s Review Checklist — especially: read `SettingsCredentials.vue` hunting for a read path (a bound `v-model` on store state, a success message interpolating the value, a stray `console.log`).
7. **Commit**, narration style of `a0b6a5e`/`62fc236`: plain-English paragraph a non-technical reader can follow, then `Technical notes:` bullets — state the six-way sweep result, the F13 discipline, the test-the-test demonstrations, and any spec deviation (the `listCredentials` naming is already known and is not a deviation — the spec is what drifted). Verify `git config user.email` = `mwilson29072@gmail.com`. `Co-Authored-By:` trailer naming the model that did the work.
8. **Do not push, do not open a PR, do not amend or rebase.**

## §10 Verification Commands

```powershell
npm run typecheck          # zero errors (G1)
npx vitest run             # green — 224 baseline + your new cases
npm run grep:secrets       # (G4) exit 0 — AFTER purging planted keys from _verify/
```

Grep gates — run and report hit counts:

```powershell
git diff --name-only 62fc236 -- src/main src/preload src/shared   # expect: ONLY src/main/ipc.ts (commit 1)
git grep -n "console\." -- src/renderer/src/views src/renderer/src/stores/settings.ts   # expect: NOTHING
git grep -nE "sk-ant|sk-or|sk-proj|AKIA" -- src/renderer          # expect: NOTHING (no key-shaped fixture in renderer tests)
git grep -n "KeepAlive" -- src/renderer                            # expect: NOTHING
```

App launch: restore ComSpec/PATH (§3d), then:

```powershell
node node_modules/electron-vite/bin/electron-vite.js dev -- --remote-debugging-port=9222
```

### New unit tests

`src/renderer/src/stores/settings.test.ts` — stub `window.chorus` (the `view.test.ts` precedent):

| Case | Expected |
|---|---|
| **deep scan:** after `createProfile({... key: FAKE})`, `JSON.stringify($state)` contains no substring of FAKE | **the no-retention proof — written as a scan, not two field checks, so a future added field cannot quietly hold one** |
| supersede: two overlapping `load()`s resolving in reverse order | store holds the **later** call's data; `loading` ends false |
| create / replace / delete each trigger exactly one reload | as stated |
| a `{ok:false, reason}` mutation | error exposed renderable; existing list **not** cleared or corrupted |
| a rejected invoke (bridge throw) | caught; error surfaced; no unhandled rejection |

`src/renderer/src/palette/commands.test.ts`: `settings.open` present, expected group, `enabled()` true with and without an active project, fuzzy `'set'` surfaces it.

**Fixtures:** obviously-fake values whose shape does NOT match `secret-patterns.json` (stay under the length floors) — the renderer test tree must stay grep-clean without needing purges.

### RUN the app, don't just compile (G2)

1. **F25 chore proof (commit 1, cold boot).** Hand-edit a session row's `agent` to `'gemini'` (dump-script pattern). Boot: `layout:get` **succeeds** (drive it over CDP and dump the response — `sessions[]` omits the row), the pino **warn** names the row id + value, **no uncaught rejection in the renderer console**, the affected leaf renders the placeholder — **in filmstrip AND grid** — and the healthy session is unaffected. Then **restore the row** and prove it with a dump quoting the `projects` table (F20).
2. **The view switch.** Workspace → settings → workspace — via the top-bar control, the palette, **and Esc from within settings**; also confirm Esc with the palette open ABOVE settings closes the palette, not the view. A **running session survives the round trip with scrollback intact** (type a marker line into a TUI before switching, confirm it after returning — the attach-replay proof).
3. **Provider CRUD** through the real form: create (adapter + auth-mode options visibly sourced from `adapter:list`), edit, delete-with-profiles → inline structured refusal, delete-after-profiles-gone → succeeds.
4. **Credential CRUD**: create (with a **planted fake key of realistic shape**, generated for this session), replace (incl. a `duplicate` refusal against a second profile — D36's check, rendered inline), delete. `unavailableSince` state: corrupt a blob via the dump-script (the 3-2 pattern), reload the list, confirm the distinct unavailable rendering; then replace through the form and confirm it clears.
5. **THE SIX-WAY NO-LEAK SWEEP** — after a real form submission of the planted key, via CDP:
   (a) `document.documentElement.outerHTML` contains no substring of the key (checked **after** the success state renders);
   (b) the input's live `value` is empty post-success;
   (c) the settings store's `$state`, serialized, contains no substring (if you expose a temporary debug accessor to reach it, **remove it before commit** — the reviewer checks the commit diff);
   (d) every IPC response dumped (`provider:*`, `credential:*`, `adapter:list`) — no key material, no 64-hex run;
   (e) the main-process log — same assertions;
   (f) **`Page.reload`**, then confirm the profile still lists AND the key is still unrecoverable (persistence and secrecy coexist).
6. **Test the test:** temporarily retain the key in the store (one line), watch the unit deep-scan AND runtime scan (c) go red, revert, watch them go green. Report both runs.
7. **F13 fast-switch proof:** throttle via CDP network conditions (or click fast on a cold boot), open settings, switch back **before** loads resolve: no unhandled rejection, no null-access error, no leaked listener behavior on repeated cycles.
8. **Empty-state proof:** with zero providers and zero profiles, the view renders a sensible empty state, not a broken list or endless spinner. (Your session starts in this state — capture it before creating anything.)
9. **Palette:** Ctrl+K → `'set'` → Enter opens settings; works from both view modes; console hygiene throughout (zero clone errors, zero uncaught, zero unhandled rejections).

**Cleanup:** delete your test providers/profiles **through the UI** (item 3/4 double-duty), purge planted-key artifacts from `_verify/`, re-run `grep:secrets`.

## §11 Failure Honesty Clause

Capture exact output on any failure, explain it, report it. **Never claim success you did not directly observe.**

**Specifically may NOT be reported as success:**

- a no-leak claim from reading the code rather than from **executing the six-way sweep** and keeping its artifacts;
- sweep item (c) via an exposed accessor that is **still in the committed diff**;
- a test-the-test claim without showing the checks **fail** under deliberate retention — a scan that cannot go red proves nothing;
- the F25 proof without **both view modes**, or without the row-restoration dump;
- the scrollback-survival claim without the typed-marker check (an empty replay also "renders a terminal");
- the F13 proof by reasoning ("the bail flag is there") instead of by the fast-switch run;
- `grep:secrets` passing because artifacts were purged **before** the sweep ran rather than after;
- an empty-state claim when the state was never actually observed empty.

**F20:** DB evidence describes the redirected DB; quote project ids; the coordinator re-verifies the row restoration and runs their own sweep. **If something fails, report DONE_WITH_CONCERNS or BLOCKED with exact evidence** — the F25 finding came from exactly this kind of honesty, and it improved the phase. Known environment conditions (§3 quirks) are not failures.

## §12 Final Reporting Requirements

Write a detailed summary for coordinator review containing:

- **Status:** DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED.
- **BOTH commit SHAs** + one-line descriptions, unsquashed (D37).
- **Environment statement** — project ids seen (F20); confirmation the hand-edited row was restored with the dump filename.
- **Chore evidence** — the F25 proof: response dump, warn line, both view modes, no uncaught rejection, restoration.
- **The six-way sweep** — each of (a)–(f) with what was actually observed and artifact filenames; the planted key's shape (never its value in the report if it matched a real pattern — describe it).
- **Test-the-test evidence** — both red runs and both green runs.
- **F13 evidence** — the fast-switch observations.
- **Round-trip evidence** — the typed-marker scrollback proof.
- **CRUD walk-through** — provider and credential flows incl. the inline refusals actually rendered (`duplicate`, delete-with-profiles, unavailable state and its clearing).
- **Grep gate results** with hit counts (all four §10 gates).
- **Files changed** per commit with one-line rationales; anything beyond §7's tables flagged loudly.
- **Verification transcript** — typecheck, vitest (new names + total), grep:secrets (run AFTER the sweep + purge), runtime items 1–9 individually.
- **Acceptance criteria** from `Task-3-4.md` restated pass/fail, plus Phase-3-Overview's Settings box.
- **Non-goals confirmation** — each §8 item, explicitly including: no main/preload/shared edit in commit 2 (quote the `git diff --name-only` gate), no Test-key button, no new dependency, no `KeepAlive`, no `window.confirm`.
- **Fixture end-state** — worktree fixture intact; migrations still 5; `provider_configs`/`credential_profiles` **empty again** via UI deletion; `_verify/` purged.
- **Residual risks / notes for 3-5 and 3-6** — anything learned about the view switch or store patterns that the scrubber's non-interference checks or 3-6's Settings additions (Test-key button, `lastVerifiedAt` updates) should know.
- **Final git output**, fenced: `git status --porcelain` and `git log --oneline -5`.
