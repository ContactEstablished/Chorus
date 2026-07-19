# Task 1-5 — Project Tabs + Full Restore

_Sub-phase 1.4 of Phase 1 (Foundation). Windows-only. Serial after Task 1-4. Closes Phase 1._

> **CR-1.5 CLOSED (2026-07-19) — this task is finalized from the council's restore contract, recorded as roadmap D16.** Brief: `../CouncilBriefs/CouncilBrief-1.5-RestoreContract.md` · Findings: `../CouncilBriefs/CouncilFindings-1.5-RestoreContract.md` · Coordinator resolutions (a)–(d) Matthew-approved 2026-07-19 (see D16). Former `[CR-1.5 Qn]` fork markers below now cite the decided answers.

## Source Of Truth
- `CLAUDE.md` (locked architecture rules — now incl. the D14 plain-object IPC rule).
- `docs/PLAN.md` — architecture and roadmap; "sessions live in main" and restore semantics.
- Roadmap decisions binding here: D1 (Zod in main only), D3 (sessions in main), D7 (Drizzle), D8 (Tailwind), D9 (split-tree layout), D10 (store keyed by sessionId), D11 (status wiring), D14 (plain-object IPC payloads), **D15 (session-lifecycle contract: `respawn`-gated attach; manager map = sole liveness authority)**.
- Findings binding here: **F4** (row/leaf drift is normal in both directions), **F5** (panes remount on sibling close — attach is a view binding, never a lifecycle hook), **F6** (persisted `running` = "was running when last observed", never "is alive").
- This task governs scope; `ImplementationSpec-1-5.md` governs exact contents — **after** CR-1.5 findings are folded in.

## Initial Starting Point

**Re-verified 2026-07-19 against commit `c91aea1`** (Task 1-4 landed; `npm run typecheck` 0 errors; `npx vitest run` 38/38). Trust this over any older doc line.

- **SessionManager** supports N concurrent same-kind sessions (`findByAgent` deleted). Public surface: `launch(agent, cwd, sessionId)` — spawns under a **caller-minted row id** (the `session:launch` IPC handler creates the row via `storage.createSession` then calls `launch`); `attach({sessionId, agent, respawn?}, cwd)` — a **view binding** that never spawns unless `respawn: true` (sent only by the Restart chrome after kill + awaited exit; D15/F5); `kill`, `write`, `resize`, `getAgent`, `onData`/`onExit` (listener Sets), `dispose`. There is **no `restart()` method** — Restart is renderer chrome (kill → await exit → re-attach with `respawn: true`), and main flips the row back to `running`/null on that respawn attach. **Post-restart Restart is currently a deliberate no-op** (respawn on a manager-unknown id spawns nothing) — this task replaces the whole `respawn` mechanism with the unified `session:restart` path (D16 Q4).
- **IPC — 11 channels**, all Zod in main: `session:attach/launch/launch-context/write/resize/kill`, `session:data/exit`, `cli:detect`, `layout:get/set`. `session:launch` validates `cwd` (`path.isAbsolute` + `fs.existsSync`) before any row or PTY exists. `layout:set` accepts `layoutJsonSchema.nullable()` — null DELETEs the `pane_layouts` row (absence = empty). **`session:launch-context`** serves `{projectRoot, recentCwds}` to the dialog — it closes over the single project today and **must become project-aware in this task** (it was created in 1-4, after this task's docs were first authored).
- **First-run seeding** produces **nothing** (project row only — no layout row, no session rows). Legacy conversion for existing DBs is intact. Closing the last pane sets the tree null → row deleted → `EmptyState`.
- **LaunchDialog.vue** / **EmptyState.vue** exist; split buttons enabled, wired through the layout store's `insertLaunchedLeaf` (root on empty, `splitPane` at a target) + `layout:set`.
- **storage**: `getOrCreateProject`, `getPaneLayout(): LayoutJson | null`, `savePaneLayout`, `clearPaneLayout`, `getRecentCwds`/`pushRecentCwd` (inline-Drizzle settings, key `recent_cwds`), `createSession`, `getSessionsForProject`, `updateSessionStatus` (wired: exit listener in `main/index.ts` + `running`-flip on respawn attach), `getWindowBounds`/`saveWindowBounds`, `close`. **No `getProjectById`, no `listProjects`, no active-project settings yet.** **No delete-session API exists.**
- **`registerIpc(sessions, storage, project)`** still **closes over ONE project** — the main structural debt this task pays down.
- **main** `src/main/index.ts`: `whenReady` → storage init, `getOrCreateProject(DEV_WORKING_DIR)`, `registerIpc`, `watchSessionExits(sessions)` + the D11 exit listener, `createWindow`.
- **Renderer**: `App.vue` — one `layout:get` on mount, `LayoutRenderer` + `v-else` `EmptyState`, hosts `LaunchDialog`; session store keyed by `sessionId` (entries never pre-seeded, never removed on leaf close — restore must key off tree + rows, not the store); layout store `{tree, dirty}` with 500 ms plain-snapshot persist (D14).
- **`pane_layouts`** and **`sessions`** are already keyed by `project_id`; `projects` table: `id`, `name`, `root_path` UNIQUE, `created_at`. **No schema change anywhere in this task** — D16 Q1 chose reconcile-on-boot over a `desired_state` column (Gemini's dissent defers that migration to the phase that adds a "don't restore" toggle).
- **Known drift states this task inherits (F4):** rows outlive leaves (close-all leaves N exited rows, 0 leaves); leaves reference manager-unknown sessions (every restart); a failed `session:launch` spawn orphans a row stuck at `status='running'` with no PTY and no leaf; the F6 quit race leaves genuinely-running-at-quit rows at `running`. **All four are resolved by the D16 reconcile pass + close-flow deletion** — heal-before-spawn covers the orphans, and going forward close deletes rows so leafless accumulation stops.

## Goal
Turn Chorus from a single-project app into a multi-project one with a project tab bar and full session restore on boot. Add a directory-picker-backed `project:add` (Electron `dialog.showOpenDialog` in main), a `project:list` channel, a Pinia project store, and persistence of the active project. Rework `registerIpc` so handlers resolve the project from a `project_id` in each request payload instead of closing over one project — `DEV_WORKING_DIR` becomes only the first-run default seed. The window title shows the active project name.

**Restore behavior is governed by the D16 contract (CR-1.5, final):** at boot and on first tab activation, the restore set is **layout leaves ∩ `running` rows**; each member is cwd-validated then relaunched under its original row id with a fresh PTY, staggered 500 ms, wearing a transient "new conversation" badge. Exited rows under leaves show exited chrome + Restart. `running` rows with **no leaf are healed to `exited` before any spawn** (invisible-process guard). Restart — in-run and post-restart alike — routes through a new `session:restart` channel into the launch path (same row id, cwd re-validated); the 1-4 `respawn` attach flag is **removed** and `attach` becomes a pure view binding. A `session:delete` IPC ships; **pane close deletes the session row** after kill/exit completes. `status='running'` is written **only after** a spawn succeeds. Inactive projects restore lazily on tab activation.

## Exact Scope
Touch **only** these files:

| File | Change |
|---|---|
| `src/main/ipc.ts` | Rework `registerIpc(sessions, storage)` (drop the `project` closure); add `project:add`, `project:list`, `project:select` (persists active id, runs lazy restore, retitles window); add `project_id` to `layout:get/set`, `session:launch`, **and `session:launch-context`** handlers (Zod + FK-check); `layout:set` keeps its nullable-payload delete contract per project. Add **`session:restart`** (D16 Q4: read row → validate cwd → launch path under same id → `running` written **after** spawn success) and **`session:delete`** (reject live sessions). Remove the `respawn` handling from `session:attach`. |
| `src/shared/ipc.ts` | Add `projectAddRequest`(empty)/`projectAddResponse`, `projectsListSchema`, `projectSelectRequestSchema` (`{project_id}`); add `project_id: z.uuid()` to layout + launch + launch-context request schemas (repo convention: `z.uuid()`, not the deprecated `z.string().uuid()`); add `restartRequestSchema` / `deleteSessionRequestSchema` (`{sessionId}`); **drop `respawn` from `attachRequestSchema`**. |
| `src/preload/index.ts` | Add `addProject()`, `listProjects()`, `selectProject()`, `restartSession()`, `deleteSession()` forwarders; thread `project_id` through existing forwarders' typed args; remove the `respawn` pass-through. |
| `src/main/services/storage.ts` | Add `listProjects()`; active-project settings (`getActiveProjectId`/`setActiveProjectId`, key `active_project_id`); ensure `getSessionsForProject` is usable by the restore engine. |
| `src/main/services/sessionManager.ts` | Add `restore(projectId)` implementing the D16 contract (restore set = leaves ∩ running rows; heal-then-spawn; cwd validation; 500 ms stagger; `running` after spawn success); **remove the `respawn` branch from `attach`** — attach becomes a pure view binding with no spawn path. |
| `src/renderer/src/components/TerminalPane.vue` | Restart button switches from kill→attach-respawn to kill→await-exit→`restartSession()` (one path, in-run and post-restart); pane close calls `deleteSession()` after kill/exit completes; transient "Session restarted — new conversation" badge (~5 s) driven by the restore/restart events. |
| `src/main/index.ts` | Boot: resolve active project (or seed default from `DEV_WORKING_DIR`), call `registerIpc(sessions, storage)`, run restore for the active project, set window title. |
| `src/renderer/src/components/ProjectTabs.vue` | New Tailwind tab bar: tabs from `project:list`, active highlight, "Add Project" button → `project:add`. |
| `src/renderer/src/stores/project.ts` | New Pinia store: projects list, `activeProjectId`, add/select actions; persists active id via settings. |
| `src/renderer/src/App.vue` | Render `ProjectTabs`; render the active project's `LayoutRenderer`; on tab switch, load that project's layout + attach its sessions (lazy restore runs in main via `project:select`). |
| `src/renderer/src/components/LaunchDialog.vue` | Pass the active `project_id` on `launch` and `getLaunchContext` calls (both schemas gain it). No other dialog changes. |
| `src/renderer/src/stores/layout.ts` | Project-aware load/persist: `loadLayout` keyed to the active project; `layout:set` payloads carry `project_id`. |

Nothing else. If a change seems to require another file, raise it.

## Non-Goals
- **No project delete or rename UI** — edit the DB manually if needed (note this in the tab bar's absence of controls). Deferred.
- **No per-project colors / theming** — Phase 1b or later.
- **No cross-project session moves.**
- **No worktrees** — Phase 2.
- **No multi-window** — single BrowserWindow.
- **No filmstrip / command palette / auto-titling** — Phase 1b.
- **Do not revert, stage, or commit unrelated or untracked files, including anything under `docs/`.**

## Dependencies
- Task 1-4 landed (multi-session, `session:launch`, empty-state seeding, strict four-state lifecycle).
- Electron `dialog` available in main.
- `projects`, `sessions`, `pane_layouts` already keyed by `project_id` (schema ready — no migration needed).
- No new npm dependencies.

## Step-by-step Work
1. **Schemas.** In `src/shared/ipc.ts`: add `projectAddRequestSchema` (empty object), `projectAddResponseSchema` (`{ project } | { cancelled: true }`), `projectsListSchema` (array of `{id, name, root_path, active: boolean}`). Add `project_id: z.string().uuid()` to the `layout:get`, `layout:set`, and `session:launch` request schemas.
2. **storage.** Add `listProjects()` (all rows), `getActiveProjectId()` / `setActiveProjectId(id)` (settings key `active_project_id`). Confirm `getSessionsForProject(projectId)` returns rows with `status`, `agent`, `cwd`, `id`.
3. **registerIpc rework.** Change the signature to `registerIpc(sessions, storage)`. Every handler that used the closed-over `project` now reads `project_id` from its Zod-parsed request and FK-checks it against `projects` (reject unknown with a structured error). `project:add` → `dialog.showOpenDialog({properties:['openDirectory']})` in main; on a chosen path call `getOrCreateProject(path)` and return `{project}`; on cancel return `{cancelled:true}`. `project:list` → `listProjects()` with the `active` flag derived from `getActiveProjectId()`.
4. **SessionManager restore (D16, final).** Compute the restore set as a **pure, unit-tested helper** (`computeRestoreSet`: layout leaves ∩ rows → `{toRelaunch, toHeal, missingRows}`). Boot/activation sequence: **heal first** (`toHeal` → `status='exited'`, before any spawn — the invisible-process guard), then for each `toRelaunch` member: `fs.existsSync(cwd)` (missing → heal to exited, "Working directory not found" chrome), spawn under the same row id, write `status='running'` **only after** spawn succeeds, `await delay(500)` between spawns, emit a restored event so the pane wears the fresh-conversation badge. Ensure `launch` writes the correct `project_id` onto new rows.
5. **Boot sequence** (`src/main/index.ts`): after storage init, resolve the active project — `getActiveProjectId()` if set and still present, else `getOrCreateProject(DEV_WORKING_DIR)` and persist its id as active. `registerIpc(sessions, storage)`. Run `restore(activeProjectId)`. Set the window title to the active project name. `DEV_WORKING_DIR` is now **only** the first-run default seed, never a per-session cwd source.
6. **project store + tabs.** `src/renderer/src/stores/project.ts`: load `listProjects()`, hold `activeProjectId`, `addProject()` (invoke `project:add`, refresh list, select the returned project), `selectProject(id)` (persist active via settings, load that project's layout, attach/relaunch its sessions). `ProjectTabs.vue`: render tabs, highlight active, "Add Project" button.
7. **App wiring.** `App.vue` renders `ProjectTabs` above `LayoutRenderer`. On active-project change, fetch `layout:get` for that project and connect: **live** sessions (already running in main) attach + replay; the switch triggers restore for that project if it hasn't been activated yet this run (lazy relaunch). Window title updates on active change.
8. **Restore contract wiring (D16, final).** No schema change; quit and crash paths are identical by construction (neither writes anything at teardown; the reconcile pass resolves whatever state the DB holds). State the ImplementationSpec §1 contract **verbatim in the commit message**.
9. **Restart unification + session deletion (D16 Q4 + resolution d).** Implement `session:restart` (row → cwd re-validate → launch path, same id) and switch the Restart chrome to it — in-run and post-restart become one path. Remove `respawn` end-to-end (schema, preload, attach handler, manager branch, TerminalPane). Implement `session:delete` (reject live) and call it from pane close after kill/exit completes.

## Test Expectations
- **Unit (Vitest):** schema tests for `project_id` presence/format on layout + launch requests; `projectsListSchema` accept/reject; `active` flag derivation is pure and can be unit-tested if factored into a helper.
- **Restore logic**: if the relaunch selection (running → relaunch, exited → skip) is factored into a pure helper taking session rows and returning ids-to-relaunch, unit-test it. The actual spawn + `dialog.showOpenDialog` are **runtime-only** (G2) — filesystem, PTY, and native dialog cannot be unit-tested.

## Verification Commands
Run from repo root `C:\Projects\ContactEstablished\Chorus`:

```
npm run typecheck
npx vitest run
npm run dev
```

After a quit during the runtime script, to prove no orphans:

```
tasklist | Select-String -Pattern "claude|codex"
```

## Acceptance Criteria
- [ ] `npm run typecheck` — zero errors (G1).
- [ ] `npx vitest run` — green.
- [ ] Existing dev DB (one project row) opens as a **single tab**, zero migration.
- [ ] "Add Project" opens the native directory picker; choosing a folder adds a tab; cancelling is a no-op.
- [ ] Two projects, sessions launched in each; switching tabs swaps the rendered tree.
- [ ] After switching away and back, the previously-active project's TUIs show **continued output** (sessions kept running in main — the sessions-live-in-main proof).
- [ ] Quit with 3 running sessions, relaunch → the active project's sessions **auto-relaunch** (staggered, fresh TUIs) in the **restored layout shape**, each wearing the transient "new conversation" badge; exited sessions stay exited with Restart chrome.
- [ ] Inactive project's sessions do **not** relaunch until its tab is activated (lazy).
- [ ] **Orphan `running` rows (no leaf) spawn nothing** — seed one deliberately, restart, and prove via DB dump it was **healed to `exited` before any spawn** (D16 Q2, the invisible-process guard).
- [ ] A session whose `cwd` was deleted since last run does **not** spawn — its pane shows exited chrome with "Working directory not found" (D16 Q3 guard 1; no sentinel exit code).
- [ ] **Restart works through the unified path** both in-run (kill → Restart on a live-manager row) and post-restart (Restart on a manager-unknown row) — same `session:restart` channel, `running` written only after spawn success.
- [ ] Closing a pane **deletes its session row** (kill → exit → leaf removed → row gone, proved by DB dump); `session:delete` rejects a live session.
- [ ] `grep -ri respawn src/` returns nothing — the 1-4 flag is fully removed (schema, preload, handler, manager, renderer).
- [ ] Window title shows the active project name and updates on tab switch.
- [ ] `tasklist` after quit shows no lingering agent processes (`dispose()` owns cleanup).
- [ ] One narrated commit for this execution session (G3), touching only Exact Scope files.

## Review Checklist
- [ ] All Zod validation in **main**; `project_id` FK-checked before use; preload/renderer Zod-free (D1, CSP).
- [ ] `registerIpc` no longer closes over a single project; every handler resolves project per-request.
- [ ] `dialog.showOpenDialog` runs in **main**; renderer never touches `fs` or spawns processes (D3).
- [ ] Restore contract honored per **D16**: restore set = leaves ∩ running rows; heal-before-spawn; cwd-validated, staggered, badged relaunch; `running` written only after spawn success; quit/crash paths identical.
- [ ] `attach` has **no spawn path at all** (pure view binding — the F5 hazard class is gone at the root, not gated).
- [ ] Close-flow deletion ordering correct: kill → awaited exit (status write lands) → leaf removed → row deleted. No row deleted while its PTY lives.
- [ ] Lazy relaunch for inactive projects (resource-bounded — see spec cap).
- [ ] `DEV_WORKING_DIR` used only as first-run default seed.
- [ ] No secrets in args/logs/transcripts (unchanged).
- [ ] No untracked/`docs/` files staged or reverted.
