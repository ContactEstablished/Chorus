# Implementation Spec 2-2 — Workspace Modes + Auto-Worktree Launch Flow

_Deep spec for Task 2-2. Read `Task-2-2.md` first. Insertion points are anchored to **named symbols**, never line numbers. Git flags per git 2.50 — re-verify at execution (D4)._

## 1. The contract (D22 + D26f + D23)

> The launch dialog offers three workspace modes: **current-tree** (default for a lone agent), **new-worktree** (default when ≥1 other LIVE session's cwd resolves to the same repo root), **existing-worktree** (picker over retained/active-unowned worktrees). The mode is computed as a *suggestion* in main and delivered on `session:launch-context`; the *chosen* mode always travels **explicitly** in the launch payload, and main validates it but **never silently overrides**. A new-worktree launch is DB-first journaled (2-1), spawns with cwd = the worktree path, and writes both pointers transactionally (resolution a). A non-git cwd offers only current-tree (findings risk 3).

## 2. IPC schema additions (`src/shared/ipc.ts`)

```ts
export const workspaceModeSchema = z.enum(['current-tree', 'new-worktree', 'existing-worktree'])
export type WorkspaceMode = z.infer<typeof workspaceModeSchema>

/** A worktree the existing-worktree picker can offer (detached, or active with
 *  no live owning session — main computes attachability). */
export const pickableWorktreeSchema = z.object({
  id: z.uuid(),
  branch: z.string(),
  path: z.string(),
  status: z.string()
})
export type PickableWorktree = z.infer<typeof pickableWorktreeSchema>
```

**Grow `launchRequestSchema`** — `workspace_mode` required; `worktree_id` optional at the schema layer (its required-when-existing semantics are enforced in **main**, not by schema branching — the task's explicit instruction):

```ts
export const launchRequestSchema = z.object({
  project_id: z.uuid(),
  agent: agentKindSchema,
  cwd: z.string().min(1),
  workspace_mode: workspaceModeSchema,
  /** Required semantics for existing-worktree — enforced in main. Absent/ignored
   *  for current-tree and new-worktree. */
  worktree_id: z.uuid().optional()
})
```

**Grow `launchContextResponseSchema`** with repo context computed in main (resolution f). `projectRoot`/`recentCwds` stay; `repoRoot` is the *git* toplevel of the project root (distinct from `projectRoot`, which may not be a repo):

```ts
export const launchContextResponseSchema = z.object({
  projectRoot: z.string().min(1),
  recentCwds: z.array(z.string()),
  repoRoot: z.string().nullable(),           // git toplevel of projectRoot; null when not a repo (risk 3)
  liveSessionsInRepo: z.number().int(),      // OTHER live sessions whose cwd resolves to repoRoot
  suggestedMode: workspaceModeSchema,        // main's default (D26f)
  worktrees: z.array(pickableWorktreeSchema) // for the existing-worktree picker
})
```

**Add `branch` (required-nullable) to `sessionInfoSchema` and `attachResponseSchema`** — the 1b-1 `title` precedent (required-nullable over optional; a producer that forgets it fails the outbound parse):

```ts
// sessionInfoSchema (rides layout:get — powers filmstrip card labels)
  branch: z.string().nullable(),   // 2-2: worktree branch, or null for current-tree sessions

// attachResponseSchema (rides session:attach/launch/restart — powers the focused pane header)
  branch: z.string().nullable(),   // 2-2
```

**Why `branch` on both:** the focused pane's header reads it from the attach/launch response; filmstrip cards read it from `layout:get` `sessions[]`. Both need it; required-nullable keeps the boundary honest. **Minimal justification (per the task's ask):** no other field is added — `worktree_id` is not surfaced to the renderer (the branch string is the only label the UI needs), keeping the wire shape tight.

**Ripple:** every producer of an `attachResponse` (the launch, restart, and attach handlers) must now spread `branch`. For current-tree/unknown sessions that is `null`; for worktree sessions it is the `worktrees.branch` resolved via `sessions.worktree_id`. This mirrors the 1b-1 `title` ripple exactly.

## 3. `session:launch-context` handler (`src/main/ipc.ts`)

Becomes `async` (it calls `git.resolveRepoRoot`). Live-session counting uses the existing `sessions.isRunning` — **no SessionManager enumerator is added**:

```ts
ipcMain.handle(IpcChannel.SessionLaunchContext, async (_event, payload): Promise<LaunchContextResponse> => {
  const req = launchContextRequestSchema.parse(payload)
  const p = requireProject(req.project_id)
  const repoRoot = await resolveRepoRoot(p.rootPath)

  let liveSessionsInRepo = 0
  let worktrees: PickableWorktree[] = []
  if (repoRoot) {
    // Count OTHER live sessions in this repo: iterate the project's rows, keep
    // the ones the manager still runs, resolve each row's cwd → repo root.
    for (const row of storage.getSessionsForProject(p.id)) {
      if (!sessions.isRunning(row.id)) continue
      if ((await resolveRepoRoot(row.cwd)) === repoRoot) liveSessionsInRepo++
    }
    // Pickable worktrees: detached, or active with no live owning session.
    worktrees = storage.getWorktreesForProject(p.id)
      .filter((w) => w.repoRoot === repoRoot)
      .filter((w) => w.status === 'detached' || (w.status === 'active' && !(w.sessionId && sessions.isRunning(w.sessionId))))
      .map((w) => ({ id: w.id, branch: w.branch, path: w.path, status: w.status }))
  }

  const suggestedMode: WorkspaceMode =
    repoRoot === null ? 'current-tree' : liveSessionsInRepo >= 1 ? 'new-worktree' : 'current-tree'

  return launchContextResponseSchema.parse({
    projectRoot: p.rootPath,
    recentCwds: storage.getRecentCwds(),
    repoRoot, liveSessionsInRepo, suggestedMode, worktrees
  })
})
```

**Design note (flag for coordinator):** repo context is computed against the **project root** (the dialog's default cwd), not the cwd the user might later type. If the user changes cwd to a *different* repo in the dialog, the suggestion is stale for that repo — an acceptable v1 limitation, since the mode still travels explicitly and main re-validates the chosen mode against the actual cwd at launch. A dialog-side re-fetch on cwd change is a possible later refinement, deliberately **out of scope** here (keeps the request shape `{project_id}`). Factor the suggestion into a pure `suggestMode(repoRoot, liveSessionsInRepo)` for the unit test.

## 4. `session:launch` handler — mode dispatch (`src/main/ipc.ts`)

Keep the existing cwd security boundary (`path.isAbsolute` + `fs.existsSync`) and the 16-pane cap for **current-tree**. Dispatch on `workspace_mode`. Main **validates** the chosen mode and returns `{ok:false, reason}` inline on any failure — it never silently substitutes a different mode.

```ts
const req = launchRequestSchema.parse(payload)
const p = requireProject(req.project_id)
if (!path.isAbsolute(req.cwd) || !fs.existsSync(req.cwd)) {
  return { ok: false, reason: `Directory not found or not absolute: ${req.cwd}` }
}
// pane cap (unchanged) …

if (req.workspace_mode === 'current-tree') {
  const row = storage.createSession({ …existing… })      // cwd = req.cwd, worktree null
  const snap = sessions.launch(req.agent, req.cwd, row.id)
  storage.pushRecentCwd(req.cwd)
  return { ...snap, title: row.title, branch: null }
}

if (req.workspace_mode === 'new-worktree') {
  const repoRoot = await resolveRepoRoot(req.cwd)
  if (!repoRoot) return { ok: false, reason: `Not a git repository: ${req.cwd}` }
  const baseBranch = await currentBranch(repoRoot)
  // Session row first (cwd starts as req.cwd; activate updates it to the wt path).
  const row = storage.createSession({ …, cwd: req.cwd, status: 'running', … })
  let wt: WorktreeRow
  try {
    wt = await worktrees.createWorktree(row.id, repoRoot, baseBranch)  // DB-first journal (2-1)
  } catch (err) {
    storage.deleteSession(row.id)   // undo entirely: the row never surfaced (no leaf, no pane) — pure debris
    return { ok: false, reason: `Worktree creation failed: ${errMsg(err)}` }
  }
  storage.activateWorktreeForSession(wt.id, row.id, wt.path)          // resolution (a): one txn, sets cwd
  const snap = sessions.launch(req.agent, wt.path, row.id)            // spawn IN the worktree
  storage.pushRecentCwd(req.cwd)
  return { ...snap, title: row.title, branch: wt.branch }
}

// existing-worktree
const wt = req.worktree_id ? storage.getWorktreeById(req.worktree_id) : null
if (!wt) return { ok: false, reason: 'Select an existing worktree to attach' }
if (wt.sessionId && sessions.isRunning(wt.sessionId)) {
  return { ok: false, reason: 'That worktree is in use by a live session' }
}
if (!fs.existsSync(wt.path)) return { ok: false, reason: `Worktree directory is gone: ${wt.path}` }
const row = storage.createSession({ …, cwd: wt.path, … })
storage.activateWorktreeForSession(wt.id, row.id, wt.path)            // re-own, one txn
const snap = sessions.launch(req.agent, wt.path, row.id)
return { ...snap, title: row.title, branch: wt.branch }
```

**Notes / invariants:**
- **Row-before-worktree ordering:** the session row is created first (findings action 4: "set the session's cwd to the worktree path after creation"); `activateWorktreeForSession` updates the session cwd to the worktree path in the same transaction that writes both pointers and flips the worktree to `active`. So `sessions.cwd` ends as the worktree path — restore relaunches into the worktree, and if the worktree later vanishes, restore's cwd-missing healing converges (no double-heal — the reconcile already independently detaches the worktree row).
- **New-worktree failure** deletes the never-surfaced session row outright (no leaf, no pane, no UI ever saw it) so a failed creation leaves no `running` ghost and no leafless debris (the reconcile also safely deletes the `creating`/`provisioning` journal row per P3c).
- **⚠ Live-count subtlety (do not "fix"):** `git rev-parse --show-toplevel` run inside a *worktree* returns the **worktree's own** toplevel, not the main repo root. So a live worktree session's cwd does NOT resolve to `repoRoot` and is correctly **excluded** from `liveSessionsInRepo` — an already-isolated agent must not flip the suggestion to new-worktree (only a live session writing the MAIN working tree creates the collision D22 guards against). Resolving via `--git-common-dir` instead would wrongly count isolated sessions; the `--show-toplevel` comparison is the intended semantics, not an accident.
- **Existing-worktree attachability** is enforced in code (FKs off): the row must exist, not be owned by a live session, and its directory must still be present.
- **`branch` on `layout:get`:** in the `LayoutGet` handler, map each `SessionInfo` with `branch = row.worktreeId ? storage.getWorktreeById(row.worktreeId)?.branch ?? null : null` (single pass; a small per-row lookup — the project's row count is bounded by the pane cap).

## 5. Preload (`src/preload/index.ts`)

`launch` and `getLaunchContext` already forward whole request/response objects, so **no signature change is required** — the grown `LaunchRequest`/`LaunchContextResponse` types flow through `ChorusApi` automatically. Confirm the imported types are the grown ones (they are — same module). No Zod (D1/CSP).

## 6. `LaunchDialog.vue`

**Extend `onMounted`** — `ctx` now carries repo context. Default the mode to `ctx.suggestedMode`; seed the picker from `ctx.worktrees`:

```ts
const ctx = await window.chorus.getLaunchContext(props.projectId)
repoRoot.value = ctx.repoRoot
mode.value = ctx.suggestedMode                 // ref<WorkspaceMode>
pickable.value = ctx.worktrees
selectedWorktree.value = ctx.worktrees[0]?.id ?? null
```

**Mode selector** — three radio-style buttons; disable new/existing when `repoRoot === null` and show the inline "not a git repo" note (risk 3):

```html
<div v-if="repoRoot === null" class="mt-3 text-xs text-neutral-500">
  Not a git repository — launching in the current working tree.
</div>
<div v-else class="mt-3 flex gap-2">
  <button :class="modeClass('current-tree')" @click="mode = 'current-tree'">Current tree</button>
  <button :class="modeClass('new-worktree')" @click="mode = 'new-worktree'">New worktree</button>
  <button :class="modeClass('existing-worktree')" :disabled="pickable.length === 0"
          @click="mode = 'existing-worktree'">Existing worktree</button>
</div>
<!-- existing-worktree picker -->
<select v-if="mode === 'existing-worktree'" v-model="selectedWorktree" class="mt-2 …">
  <option v-for="w in pickable" :key="w.id" :value="w.id">{{ w.branch }} — {{ w.path }}</option>
</select>
```

**Submit** — thread the explicit mode (+ `worktree_id` only for existing):

```ts
const res = await window.chorus.launch({
  project_id: props.projectId, agent: selected.value!, cwd: cwd.value,
  workspace_mode: mode.value,
  ...(mode.value === 'existing-worktree' ? { worktree_id: selectedWorktree.value! } : {})
})
```

Keep the existing `{ok:false}` inline error handling; a new-worktree failure or an unattachable existing pick surfaces there.

## 7. `TerminalPane.vue` — branch label

Seed a `branch` ref from the attach/launch response (mirror the 1b-1 `title` seed), and render it in the header's left group after the title span:

```ts
const branch = ref<string | null>(null)
// in attachToSession(), after store.attached(...):
if (branch.value === null && attach.branch !== null) branch.value = attach.branch
```

```html
<span v-if="branch" class="max-w-[12rem] truncate text-xs text-sky-400" :title="branch">
  {{ branch }}
</span>
```

The branch is static per session (a worktree's branch never changes under Chorus), so no live update path is needed — the attach seed suffices, and it survives F5 remounts the same way the title does.

## 8. Invariants recap (2-2)

- The chosen `workspace_mode` is authoritative and travels explicitly; main validates but never silently overrides (D22/D26f).
- `suggestedMode` is computed in main from `resolveRepoRoot(projectRoot)` + a live-session count via `isRunning` (no SessionManager growth); `repoRoot` null ⇒ current-tree only (risk 3).
- New-worktree activation writes both pointers + the session cwd in one transaction (resolution a); DB-first journaling and D23/D26h derivation come from `worktrees.ts` (2-1).
- `branch` is required-nullable on `sessionInfoSchema`/`attachResponseSchema` (1b-1 precedent) and rippled through every attach producer + `layout:get`.
- No removal / prune / branch-deletion / `--force` / auto-merge; no restart-driver change (D25); all Zod in main (D1); payloads plain (D14).

## 9. Verification (including RUNTIME — G2)

**Static:**
- `npm run typecheck` (G1).
- `npx vitest run` — `ipc.test.ts`: `launchRequestSchema` accepts all three modes and both `worktree_id` present/absent; `launchContextResponseSchema` accepts `repoRoot:null`/`suggestedMode:'current-tree'` and a populated `worktrees`; `sessionInfoSchema`/`attachResponseSchema` reject a missing `branch`, accept `branch:null`. `suggestMode(null,0)`/`(root,0)`→`current-tree`, `(root,1)`→`new-worktree`.

**Runtime script (drive the real app; prefer Codex since Claude Code is unauthenticated; screenshot each step):**
1. `npm run dev` in a git-repo project → open the launch dialog → mode defaults to **current-tree** (no other live session in the repo). Launch a Codex agent (current-tree).
2. Open the dialog again → mode now defaults to **new-worktree** (one live session resolves to the same repo root — D26f). Launch → cross-check: `git -C <repo> worktree list` shows `wt-<shortId>`; the DB `worktrees` row is `active` with both pointers set; the agent's cwd is the worktree path; the pane header shows the `chorus/<repo>/<shortId>` branch label.
3. Open the dialog in a **non-git** project (or point cwd outside any repo) → the "not a git repo" inline state; only current-tree is offered; launch works as before.
4. **Existing-worktree:** detach a worktree (kill its session; 2-3 detaches — or hand-set `status='detached'` for this probe), reopen the dialog, pick it → the new session re-owns it (cwd = its path, `worktrees.session_id` re-pointed, `status='active'`); an in-use worktree is rejected inline.
5. **Restart safety:** with a worktree session live, kill the process tree + reboot → the worktree row survives; the reconcile (2-1) leaves an `active`-with-live-entry as healthy or promotes correctly; restore relaunches the session into the worktree (cwd persisted).
6. Confirm **no** worktree is ever created for a mode the user did not pick (main never overrides): launch current-tree with another live session present and verify no `worktrees` row appears.
