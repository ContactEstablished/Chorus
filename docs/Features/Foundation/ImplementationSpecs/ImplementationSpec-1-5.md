# Implementation Spec 1-5 — Project Tabs + Full Restore

_Deep spec for Task 1-5. Read `Task-1-5.md` first. Insertion points anchored to **named symbols**; no invented line numbers for post-1-3 state._

## 1. The restore contract (state this verbatim in the commit)
> On quit (and on crash), running sessions **keep** `status='running'` in the DB — the PTYs die with the app, but the row records intent. On boot, and on the first activation of a project's tab this run, every session row with `status='running'` for that project is **relaunched** under its original row id with the row's `agent`+`cwd` and a fresh PTY. Rows with `status='exited'` are left exited (pane shows exited chrome with Restart). There is no separate "should relaunch" flag — `status='running'` **is** the relaunch signal.

**Why no graceful-shutdown flip to `exited`:** if `before-quit` marked running sessions `exited`, a crash (no `before-quit`) and a clean quit would diverge, and crash recovery would silently lose panes. Treating `running` as "was live, bring it back" makes both paths identical and crash-safe. `kill` and natural exit are the only transitions to `exited`.

## 2. IPC schema additions (`src/shared/ipc.ts`)
```ts
export const projectAddRequestSchema = z.object({});          // renderer sends nothing
export const projectAddResponseSchema = z.union([
  z.object({ project: projectSchema }),                        // reuse existing project row schema
  z.object({ cancelled: z.literal(true) }),
]);

export const projectSelectRequestSchema = z.object({ project_id: z.string().uuid() });

export const projectsListSchema = z.array(z.object({
  id: z.string().uuid(),
  name: z.string(),
  root_path: z.string(),
  active: z.boolean(),
}));

// add project_id to existing request schemas (union/merge with what 1-3/1-4 defined):
export const layoutGetRequestSchema  = z.object({ project_id: z.string().uuid() });
export const layoutSetRequestSchema  = z.object({ project_id: z.string().uuid(), layout: layoutJsonSchema });
export const launchRequestSchema     = z.object({ project_id: z.string().uuid(), agent: agentKindSchema, cwd: z.string().min(1) });
```

If `projectSchema` / `agentKindSchema` / `layoutJsonSchema` already exist under those (or adjacent) names, reuse them — do not redefine.

**Invariant:** `project_id` is `uuid()` at the schema layer **and** FK-checked in main (§3) — schema validity ≠ existence. Both gates run before any handler touches sessions or layout.

## 3. `registerIpc` rework (`src/main/ipc.ts`)
**Signature change:** `registerIpc(sessions, storage)` — drop the `project` parameter and the closure over it. Add a small helper at the top of `registerIpc`:

```ts
function requireProject(project_id: string) {
  const p = storage.getProjectById(project_id);   // add if absent; else reuse listProjects().find
  if (!p) throw new Error(`Unknown project_id: ${project_id}`);
  return p;
}
```

**Per-handler diffs (conceptual):**

| Channel | Before (1-4) | After (1-5) |
|---|---|---|
| `layout:get` | used closed-over `project.id` | `const p = requireProject(req.project_id)`; return layout+sessions for `p.id` |
| `layout:set` | closed-over project | `requireProject(req.project_id)`; persist under `p.id` (clamp + re-validate `layoutJsonSchema` as today) |
| `session:launch` | `sessions.launch(agent, cwd)` on the one project | `const p = requireProject(req.project_id); sessions.launch(p.id, req.agent, req.cwd)` (row gets `p.id`) |
| `project:add` | — | `const r = await dialog.showOpenDialog({properties:['openDirectory']}); if (r.canceled || !r.filePaths[0]) return {cancelled:true}; const project = storage.getOrCreateProject(r.filePaths[0]); return {project};` |
| `project:list` | — | `const active = storage.getActiveProjectId(); return storage.listProjects().map(p => ({...p, active: p.id === active}))` |

`session:launch` keeps its 1-4 `cwd` validation (`path.isAbsolute` + `fs.existsSync`) — that check is **in addition to** the new `project_id` FK-check.

**Invariant:** `dialog.showOpenDialog` and all `fs`/`getOrCreateProject` calls stay in main. The renderer sends an empty request and receives a validated path/row; it never enumerates directories itself.

## 4. SessionManager: project-aware launch + restore (`src/main/services/sessionManager.ts`)
- **`launch`** gains `projectId`: `launch(projectId, agent, cwd)`. The created row carries `project_id: projectId`. (Anchor: the `storage.createSession({...})` call added in 1-4 — add `projectId` to its payload.)
- **`restore(projectId)`** (new, adjacent to `launch`):

```ts
restore(projectId: string): void {
  for (const row of storage.getSessionsForProject(projectId)) {
    if (row.status !== 'running') continue;      // exited rows stay exited
    if (this.sessions.has(row.id)) continue;     // already live this run (lazy re-activation guard)
    const pty = this.spawn(row.agent, row.cwd, row.id);   // SAME row id, fresh PTY
    this.sessions.set(row.id, pty);
  }
}
```

**Restore selection is a pure function** — factor it out so Vitest can cover it without spawning:

```ts
export function sessionsToRelaunch(rows: {id:string; status:string}[], live: Set<string>): string[] {
  return rows.filter(r => r.status === 'running' && !live.has(r.id)).map(r => r.id);
}
```

`restore` calls `sessionsToRelaunch` then spawns each id. Unit-test the helper (running→relaunch, exited→skip, already-live→skip).

## 5. Boot sequence (`src/main/index.ts`)
Replace the current single-project `getOrCreateProject(DEV_WORKING_DIR)` + `registerIpc(..., project)` block (anchored at the `whenReady` handler) with:

```
whenReady:
  storage.init()
  let activeId = storage.getActiveProjectId()
  if (!activeId || !storage.getProjectById(activeId)) {
    const seed = storage.getOrCreateProject(DEV_WORKING_DIR)   // first-run default ONLY
    activeId = seed.id
    storage.setActiveProjectId(activeId)
  }
  registerIpc(sessions, storage)          // no project closure (§3)
  watchSessionExits(...)                  // unchanged
  sessions.restore(activeId)              // §4 — relaunch running rows for the active project
  createWindow(...)                       // bounds restore unchanged
  win.setTitle(storage.getProjectById(activeId).name)   // §7
  detectClis().then(log)
before-quit:
  sessions.dispose(); storage.close()     // unchanged — dispose owns PTY teardown; running rows stay 'running'
```

**Do not** relaunch inactive projects here. Only the active project restores at boot.

## 6. Lazy relaunch on tab switch + the sessions-live-in-main proof
When the renderer activates a project tab:
1. project store calls `storage.setActiveProjectId(id)` (via a settings IPC) and `layout:get({project_id:id})`.
2. Main, on the first activation of that project this run, runs `sessions.restore(id)` (idempotent — the `this.sessions.has` guard means already-live sessions are untouched; only never-yet-restored `running` rows spawn).
3. The renderer's `LayoutRenderer` mounts leaves and each `TerminalPane` **attaches** (view-connect + replay) to the already-live PTY.

**Resource rationale / cap:** inactive projects keep whatever sessions were live from a prior activation this run, but a **never-activated** project's `running` rows are not spawned until its tab is opened — this bounds process count. Enforce a soft **cap of 12–16 panes per project** (reject the split/launch in main beyond the cap with a structured error) so a pathological layout cannot fork dozens of agent processes on activation. Switching **away** does **not** kill sessions — that is the whole point: PTYs keep running in main. The runtime script proves this by switching back and observing continued output.

## 7. Window title
Set on: (a) boot (§5), and (b) every active-project change. Use the existing main↔renderer signal pattern — either the `project:list`/select invoke returns the active name and main calls `BrowserWindow.getFocusedWindow()?.setTitle(name)`, or a dedicated `window:setTitle` is unnecessary if the select handler in main already knows the new active id. Prefer: the renderer's `selectProject` persists active id via a settings IPC whose main handler also calls `win.setTitle(project.name)`. Single source of truth = `getProjectById(activeId).name`.

## 8. `ProjectTabs.vue` + project store sketch
**Store (`src/renderer/src/stores/project.ts`):**
```ts
state: { projects: [] as ProjectTab[], activeId: null as string|null }
actions:
  async load()   { this.projects = await window.chorus.listProjects();
                   this.activeId = this.projects.find(p => p.active)?.id ?? null }
  async add()    { const r = await window.chorus.addProject();
                   if ('cancelled' in r) return;
                   await this.load(); await this.select(r.project.id) }
  async select(id) { this.activeId = id;
                     await window.chorus.selectProject(id);      // project:select — persists active id, lazy-restores, retitles (main)
                     await useLayoutStore().loadFor(id) }        // layout:get + attach sessions
```

**Tabs (Tailwind):**
```html
<div class="flex items-center gap-1 border-b border-neutral-800 px-2">
  <button v-for="p in store.projects" :key="p.id"
          :class="p.id===store.activeId ? 'border-b-2 border-sky-500 text-neutral-100'
                                        : 'text-neutral-400 hover:text-neutral-200'"
          class="px-3 py-1.5 text-sm" @click="store.select(p.id)">
    {{ p.name }}
  </button>
  <button class="ml-auto px-2 text-neutral-400 hover:text-neutral-200" title="Add project"
          @click="store.add()">+ Add Project</button>
</div>
```
No rename/delete controls — deferred (state in a code comment: "edit DB manually to rename/remove; UI is Phase 1b+").

## 9. `App.vue` wiring
- Render `<ProjectTabs />` above `<LayoutRenderer />`.
- On mount: `projectStore.load()`, then the layout store loads the active project. The active project's sessions were already restored by boot (§5); the renderer just attaches.
- Watch `projectStore.activeId`: on change, load that project's layout and attach its (possibly lazily-restored) sessions.

## 10. Migration note
The existing dev `chorus.db` already has exactly one `projects` row. On first 1-5 boot: `getActiveProjectId()` is unset → the boot sequence seeds/persists that existing row as active (it is returned by `getOrCreateProject(DEV_WORKING_DIR)` since `root_path` is UNIQUE and already matches). Result: **one tab, zero migration**. Its sessions restore per the contract. No schema change — `project_id` columns already exist.

## 11. Verification (including RUNTIME)
**Static:** `npm run typecheck` (G1); `npx vitest run` — schema tests (`project_id` uuid presence/reject; `projectsListSchema`) + `sessionsToRelaunch` helper.

**Runtime script (G2 — screenshot each step; use a second real directory that also has `claude` available):**
1. `npm run dev` on the existing dev DB → **one tab** (repo project), sessions restore (or empty state if none were running). Confirm zero-migration.
2. Click **+ Add Project** → native directory picker → choose the second directory → a **second tab** appears and becomes active.
3. In project B, Launch Claude; switch to project A, Launch Codex. Both projects now have live sessions.
4. In project B's TUI, start something that emits continuous output (e.g. a `ping -t` or a long build). Switch to **A**, wait, switch **back to B** → the output **continued while B was hidden** (screenshot — the sessions-live-in-main proof: PTYs never stopped).
5. With **3 running sessions total**, quit the app. Run `tasklist | Select-String "claude|codex"` → **no agent processes** remain (`dispose()` cleanup).
6. `npm run dev` again → the **active project's** sessions **auto-relaunch** with fresh TUIs in the **restored layout shape**. Sessions that had exited before quit show exited chrome + Restart. The inactive project's sessions are **not** yet spawned.
7. Switch to the inactive project's tab → its `running` rows **now** relaunch (lazy). Screenshot.

**Orphan/cleanup:** step 5's `tasklist` check is the acceptance gate for `dispose()` still owning quit cleanup after the multi-project rework.

## 12. Invariants recap
- `status='running'` in the DB is the sole relaunch signal; quit and crash paths are identical and crash-safe.
- Every IPC handler resolves + FK-checks `project_id` per-request; `registerIpc` closes over nothing project-specific.
- `dialog.showOpenDialog`, `fs`, and spawning stay in main; renderer sends empty/typed requests only.
- Active project restores eagerly at boot; inactive projects restore **lazily** on tab activation; switching away never kills sessions.
- Soft cap 12–16 panes/project bounds process count.
- `DEV_WORKING_DIR` is only the first-run default project seed.
- Window title = `getProjectById(activeId).name`, updated on every active change.
