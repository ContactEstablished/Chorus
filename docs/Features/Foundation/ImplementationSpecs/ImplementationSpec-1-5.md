# Implementation Spec 1-5 — Project Tabs + Full Restore

_Deep spec for Task 1-5. Read `Task-1-5.md` first. Insertion points anchored to **named symbols**._

> **FINALIZED from CR-1.5 (2026-07-19, roadmap D16).** Findings: `../CouncilBriefs/CouncilFindings-1.5-RestoreContract.md`, with four Matthew-approved coordinator resolutions folded in: (a) `status='running'` written **only after** spawn success (supersedes the findings' Q4 step 3, per their own Risk 1); (b) no PID-based orphan scanning; (c) cwd-missing renders a message, no re-homing flow (Phase 2); (d) pane close deletes the session row — no context-menu/session-list UI. Channels are singular: `session:restart`, `session:delete`.

## 1. The restore contract (D16 — state this verbatim in the commit)
> 1. At boot or first project-tab activation this run, flatten the layout tree's leaves and intersect their `sessionId`s with `sessions` rows where `status='running'`. This intersection is the **restore set**.
> 2. Before any spawn, every `running` row **not** referenced by a layout leaf is healed to `status='exited'` — the invisible-process guard: no PTY may exist that no pane can reach.
> 3. For each restore-set member: validate `cwd` exists; if missing, heal the row to `exited` and render exited chrome with "Working directory not found". If present, spawn a fresh PTY under the row's `id`/`agent`/`cwd`, write `status='running'` **only after the spawn succeeds**, stagger spawns by 500 ms, and show a transient "Session restarted — new conversation" badge (~5 s) on the pane.
> 4. Restart — in-run and post-restart alike — goes through `session:restart`: read the row, re-validate `cwd`, spawn via the launch path under the same row id (no row creation), `running` after success. `attach` has no spawn path.
> 5. Pane close deletes the session row after kill/exit completes; `session:delete` rejects live sessions. Quit and crash write nothing at teardown — both paths converge on the same reconcile at next boot.

**Why no graceful-shutdown flip to `exited`:** if `before-quit` marked running sessions `exited`, a crash (no `before-quit`) and a clean quit would diverge, and crash recovery would silently lose panes. Treating `running` as "was live, bring it back" makes both paths identical and crash-safe. `kill` and natural exit are the only observed-state transitions to `exited`; the reconcile pass is the only *other* writer (healing).

**Preserved dissents (revisit triggers):** Gemini — a `desired_state` intent column is the cleaner model; adopt when a user-facing "don't restore" toggle lands (Phase 2+). GPT — affordance-driven restore ("Relaunch all" over exited chrome) is more honest; if auto-relaunch confuses in practice, the revert is **renderer-only** (the restore-set computation is identical).

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
export const layoutGetRequestSchema     = z.object({ project_id: z.uuid() });
export const layoutSetRequestSchema     = z.object({ project_id: z.uuid(), layout: layoutJsonSchema.nullable() });  // KEEP the 1-4 null-delete contract
export const launchRequestSchema        = z.object({ project_id: z.uuid(), agent: agentKindSchema, cwd: z.string().min(1) });
export const launchContextRequestSchema = z.object({ project_id: z.uuid() });   // 1-4 channel; today it closes over the single project
```

_(Amended 2026-07-19: `z.uuid()` per repo convention; `layout` **must stay nullable** — 1-4's `layout:set(null)` deletes the row per-project; `session:launch-context` exists since 1-4 and needs `project_id` too — it serves `{projectRoot, recentCwds}` to the dialog.)_

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

## 4. Restore engine (D16-final): pure selection + heal-then-spawn
- **`launch`** stays as 1-4 built it: the **IPC handler** mints the row via `storage.createSession({projectId, …})` and calls `launch(agent, cwd, row.id)` — the manager never touches storage. Thread `project_id` through the handler's `createSession` payload, not into the manager.
- **Selection is a pure, unit-tested function** (new module or exported from the manager's file — implementer's call, name it `computeRestoreSet`):

```ts
export interface RestoreSet {
  toRelaunch: SessionRow[]   // leaf ∈ layout AND row.status === 'running' AND not live in the manager
  toHeal: SessionRow[]       // row.status === 'running' AND no leaf references it
  missingRows: string[]      // leaf sessionIds with no row (renderer placeholder; nothing to do in main)
}
export function computeRestoreSet(
  layout: LayoutJson | null,
  rows: SessionRow[],
  live: Set<string>          // manager's in-memory map keys — the lazy re-activation guard
): RestoreSet
```

Unit-test all four populations plus the failed-spawn orphan and the already-live (tab re-activation) case. A null layout → every `running` row is `toHeal`.

- **Execution order (in the boot/activation path, main):**

```ts
async restoreProject(projectId: string): Promise<void> {
  const set = computeRestoreSet(storage.getPaneLayout(projectId),
                                storage.getSessionsForProject(projectId),
                                new Set(this.sessions.keys()))
  for (const row of set.toHeal) storage.updateSessionStatus(row.id, 'exited', row.exitCode ?? null)  // HEAL FIRST — before any spawn
  for (const row of set.toRelaunch) {
    if (!fs.existsSync(row.cwd)) { storage.updateSessionStatus(row.id, 'exited', row.exitCode ?? null); /* mark cwd-missing for chrome */ continue }
    const pty = this.spawn(row.agent, row.cwd, row.id)    // SAME row id, fresh PTY
    this.sessions.set(row.id, pty)
    storage.updateSessionStatus(row.id, 'running', null)  // AFTER spawn success — resolution (a)
    emitRestored(row.id)                                   // renderer badge: "Session restarted — new conversation"
    await delay(500)                                       // stagger — drop to 250 ms only if ConPTY proves tolerant
  }
}
```

  - The cwd-missing case is surfaced as its **own pane state** (message: "Working directory not found") — not a sentinel exit code, and no re-homing UI (resolution (c); Phase 2 owns re-homing when worktrees make it routine).
  - No PID scanning anywhere (resolution (b)) — the after-success `running` write is the zombie guard: a crash between spawn and write leaves the row `exited`, which is self-consistent at next boot.

## 4b. `session:restart` + `session:delete` (D16 Q4 + resolution d)
- **`session:restart`** `{sessionId}` — handler: read the row (unknown id → structured error); `fs.existsSync(row.cwd)` (missing → error, chrome shows it); spawn via the launch path under the same row id (**no row creation**); `updateSessionStatus(id, 'running', null)` after success; emit the restored event (badge). The Restart chrome (in-run *and* post-restart) becomes: kill if live → await exit → `restartSession(sessionId)`. **Remove `respawn` end-to-end** — `attachRequestSchema`, preload pass-through, the attach handler's flip branch, the manager's `if (!respawn)` branch, and TerminalPane's usage. `attach` ends up with no spawn path at all (F5 hazard gone at the root).
- **`session:delete`** `{sessionId}` — handler: reject if the id is live in the manager (structured error: kill first); else `DELETE FROM sessions WHERE id = ?`. Called from pane close **after** kill/exit completes (ordering: kill → awaited exit → leaf removed → row deleted). No context-menu or session-list UI (deferred 1b+). Going forward this stops leafless-row accumulation; the heal pass covers what history already left behind.

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

**D16 contract checks (append to the runtime script):**

8. **Heal proof:** with the app closed, hand-edit the DB to give the active project a `running` row referenced by **no** leaf. Boot → nothing extra spawns; DB dump shows the row healed to `exited` **and** main's log shows the heal happened before the first spawn.
9. **cwd-missing:** delete (or rename) one restored session's `cwd` directory while the app is closed. Boot → that pane shows exited chrome + "Working directory not found"; the other sessions restore normally; no sentinel exit code written.
10. **Badge:** each auto-restored pane shows "Session restarted — new conversation" for ~5 s, then auto-dismisses. Screenshot during the window.
11. **Restart unification:** kill a live session → Restart → fresh TUI (in-run path). Then quit, relaunch, and Restart an exited pane → fresh TUI under the same row id (post-restart path). DB shows `running` only after each successful spawn.
12. **Close deletes:** close a pane → confirm → DB dump shows the `sessions` row **gone** (not merely `exited`).
13. **Respawn gone:** `grep -ri respawn src/` → no matches.

## 12. Invariants recap (D16-final)
- Restore set = **layout leaves ∩ `running` rows**; `running` rows without a leaf are healed to `exited` **before any spawn** — no PTY may exist that no pane can reach.
- `status='running'` is written **only after** a spawn succeeds; quit and crash write nothing at teardown and converge on the same boot reconcile.
- `attach` has **no spawn path**; all respawn goes through `session:restart` → the launch path under the existing row id, cwd re-validated.
- Pane close deletes the session row (kill → awaited exit → leaf removed → row deleted); `session:delete` rejects live sessions.
- Spawns staggered 500 ms; restored panes wear the transient fresh-conversation badge; cwd-missing is its own chrome state.
- Every IPC handler resolves + FK-checks `project_id` per-request; `registerIpc` closes over nothing project-specific.
- `dialog.showOpenDialog`, `fs`, and spawning stay in main; renderer sends empty/typed requests only.
- Active project restores eagerly at boot; inactive projects restore **lazily** on tab activation; switching away never kills sessions.
- Soft cap 16 panes/project bounds process count (beyond-cap members get exited chrome, not spawns).
- `DEV_WORKING_DIR` is only the first-run default project seed.
- Window title = `getProjectById(activeId).name`, updated on every active change.
