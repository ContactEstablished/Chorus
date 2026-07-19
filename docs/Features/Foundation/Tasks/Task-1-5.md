# Task 1-5 — Project Tabs + Full Restore

_Sub-phase 1.4 of Phase 1 (Foundation). Windows-only. Serial after Task 1-4. Closes Phase 1._

## Source Of Truth
- `CLAUDE.md` (locked architecture rules).
- `docs/PLAN.md` — architecture and roadmap; "sessions live in main" and restore semantics.
- Phase 1 decisions RESOLVED 2026-07-18: D1 (Zod in main only), D3 (sessions in main), D7 (Drizzle), D8 (Tailwind), D9 (split-tree layout).
- This task governs scope; `ImplementationSpec-1-5.md` governs exact contents.

## Initial Starting Point
State inherited from Task 1-4 (on top of the 1-3 baseline in the shared context):

- **SessionManager** supports N concurrent same-kind sessions. Lifecycle is a strict four-state machine: `launch(agent, cwd)` (new row + spawn), `attach({sessionId, agent}, cwd)` (view-connect + replay, **no respawn** of dead sessions), `restart(sessionId)` (respawn same row), `kill(sessionId)` (terminate, keep row).
- **`session:launch` IPC** exists (`{agent, cwd}` request; main validates `cwd` absolute + `fs.existsSync`; returns an attach-style snapshot or `{ok:false, reason}`).
- **First-run seeding** produces an **empty layout** (no `pane_layouts` row). Legacy conversion for existing DBs is intact. Closing the last pane deletes the `pane_layouts` row → empty state.
- **LaunchDialog.vue** / **EmptyState.vue** exist; split buttons enabled and wired through `splitPane` + `layout:set`.
- **storage** has `getRecentCwds()` / `pushRecentCwd()`; `getOrCreateProject(rootPath)` seeds a project (+ empty layout).
- **`registerIpc(sessions, storage, project)`** still **closes over ONE project** — this is the main structural debt this task pays down.
- **main** `src/main/index.ts` uses `DEV_WORKING_DIR` (`src/main/constants.ts`) as the working directory + only project.
- **Renderer**: `App.vue` renders `LayoutRenderer` for the single current project; Pinia session store (keyed by `sessionId`) and layout store (`{tree, dirty}`).
- **`pane_layouts`** and **`sessions`** are already keyed by `project_id`; `projects` table: `id`, `name`, `root_path` UNIQUE, `created_at`.

## Goal
Turn Chorus from a single-project app into a multi-project one with a project tab bar and full session restore on boot. Add a directory-picker-backed `project:add` (Electron `dialog.showOpenDialog` in main), a `project:list` channel, a Pinia project store, and persistence of the active project. Rework `registerIpc` so handlers resolve the project from a `project_id` in each request payload instead of closing over one project — `DEV_WORKING_DIR` becomes only the first-run default seed. On boot (and on tab switch), the active project's sessions that were `running` at last shutdown are **automatically relaunched** under their original row ids with fresh PTYs; sessions that had exited stay exited. Inactive projects' sessions are relaunched **lazily** when their tab is activated. The window title shows the active project name.

## Exact Scope
Touch **only** these files:

| File | Change |
|---|---|
| `src/main/ipc.ts` | Rework `registerIpc(sessions, storage)` (drop the `project` closure); add `project:add`, `project:list`, `project:select` (persists active id, runs lazy restore, retitles window); add `project_id` to `layout:get/set` and `session:launch` handlers (Zod + FK-check). |
| `src/shared/ipc.ts` | Add `projectAddRequest`(empty)/`projectAddResponse`, `projectsListSchema`, `projectSelectRequestSchema` (`{project_id}`); add `project_id: z.string().uuid()` to layout + launch request schemas. |
| `src/preload/index.ts` | Add `addProject()`, `listProjects()` forwarders; thread `project_id` through existing forwarders' typed args. |
| `src/main/services/storage.ts` | Add `listProjects()`; active-project settings (`getActiveProjectId`/`setActiveProjectId`, key `active_project_id`); ensure `getSessionsForProject` is usable by the restore engine. |
| `src/main/services/sessionManager.ts` | Add a `restore(projectId)` (or equivalent) that relaunches `running` rows for a project under their original ids; make `launch/attach` project-id aware (they already carry `cwd`; ensure the row's `project_id` is honored). |
| `src/main/index.ts` | Boot: resolve active project (or seed default from `DEV_WORKING_DIR`), call `registerIpc(sessions, storage)`, run restore for the active project, set window title. |
| `src/renderer/src/components/ProjectTabs.vue` | New Tailwind tab bar: tabs from `project:list`, active highlight, "Add Project" button → `project:add`. |
| `src/renderer/src/stores/project.ts` | New Pinia store: projects list, `activeProjectId`, add/select actions; persists active id via settings. |
| `src/renderer/App.vue` | Render `ProjectTabs`; render the active project's `LayoutRenderer`; on tab switch, load that project's layout + attach/relaunch its sessions. |

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
4. **SessionManager restore.** Add `restore(projectId)`: for each `getSessionsForProject(projectId)` row with `status === 'running'`, relaunch under the **same row id** with the row's `agent` + `cwd` (fresh PTY). Rows with `status === 'exited'` are left alone (renderer shows exited chrome + Restart). Ensure `launch` writes the correct `project_id` onto new rows.
5. **Boot sequence** (`src/main/index.ts`): after storage init, resolve the active project — `getActiveProjectId()` if set and still present, else `getOrCreateProject(DEV_WORKING_DIR)` and persist its id as active. `registerIpc(sessions, storage)`. Run `restore(activeProjectId)`. Set the window title to the active project name. `DEV_WORKING_DIR` is now **only** the first-run default seed, never a per-session cwd source.
6. **project store + tabs.** `src/renderer/src/stores/project.ts`: load `listProjects()`, hold `activeProjectId`, `addProject()` (invoke `project:add`, refresh list, select the returned project), `selectProject(id)` (persist active via settings, load that project's layout, attach/relaunch its sessions). `ProjectTabs.vue`: render tabs, highlight active, "Add Project" button.
7. **App wiring.** `App.vue` renders `ProjectTabs` above `LayoutRenderer`. On active-project change, fetch `layout:get` for that project and connect: **live** sessions (already running in main) attach + replay; the switch triggers restore for that project if it hasn't been activated yet this run (lazy relaunch). Window title updates on active change.
8. **Restore contract wiring.** Confirm `before-quit` leaves running sessions with `status='running'` in the DB (they were running; PTYs die with the app). Boot/tab-activate treats `status='running'` as "relaunch". Crash path is identical (crash leaves `running` → relaunch). Document this contract in the ImplementationSpec.

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
- [ ] Quit with 3 running sessions, relaunch → the active project's sessions **auto-relaunch** with fresh TUIs in the **restored layout shape**; exited sessions stay exited.
- [ ] Inactive project's sessions do **not** relaunch until its tab is activated (lazy).
- [ ] Window title shows the active project name and updates on tab switch.
- [ ] `tasklist` after quit shows no lingering agent processes (`dispose()` owns cleanup).
- [ ] One narrated commit for this execution session (G3), touching only Exact Scope files.

## Review Checklist
- [ ] All Zod validation in **main**; `project_id` FK-checked before use; preload/renderer Zod-free (D1, CSP).
- [ ] `registerIpc` no longer closes over a single project; every handler resolves project per-request.
- [ ] `dialog.showOpenDialog` runs in **main**; renderer never touches `fs` or spawns processes (D3).
- [ ] Restore contract honored: `running` at shutdown → relaunch on boot/activate; `exited` → stays exited; crash path identical.
- [ ] Lazy relaunch for inactive projects (resource-bounded — see spec cap).
- [ ] `DEV_WORKING_DIR` used only as first-run default seed.
- [ ] No secrets in args/logs/transcripts (unchanged).
- [ ] No untracked/`docs/` files staged or reverted.
