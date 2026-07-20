# Implementation Spec 2-3 — Cleanup Flows, Retained-Worktree Panel, Reconcile Surfacing

_Deep spec for Task 2-3. Read `Task-2-3.md` first. Insertion points are anchored to **named symbols**, never line numbers. Git flags per git 2.50 — re-verify at execution (D4)._

## 1. The contract (D26 clauses 5–8, Q4, resolutions a/d/e/g)

> Closing a session with a **clean** worktree offers auto-removal; closing with a **dirty** worktree transitions it to `detached` (session link cleared), retained, never destroyed. `session:delete` detaches rather than cascades. Explicit removal of a worktree requires typed confirmation naming the path **if dirty**; main **re-checks cleanliness at execution time**. Branches are never auto-deleted (opt-in checkbox only). **`--force` reaches git only inside the single typed-confirmation dirty-removal path** (clause 7 as amended by D26(i) — a targeted `git worktree remove --force <path>` on the confirmed worktree only). Removal sequences after the owning process tree has exited, retrying on lock with backoff. The retained-worktree list is a **minimal overlay + palette command** (resolution g), not a settings panel.

## 2. IPC schema additions (`src/shared/ipc.ts`)

```ts
// Channels
WorktreeList: 'worktree:list',
WorktreeRemove: 'worktree:remove',
WorktreeDirtyFiles: 'worktree:dirty-files',

export const worktreeListRequestSchema = z.object({ project_id: z.uuid() })

/** One row for the retained-worktree panel (risk 6 columns + prune surfacing). */
export const worktreeSummarySchema = z.object({
  id: z.uuid(),
  path: z.string(),
  branch: z.string(),
  status: z.string(),
  clean: z.boolean(),
  dirtyCount: z.number().int(),
  ahead: z.number().int(),
  behind: z.number().int(),
  /** population 2/5 surfaced live at list time (git registered but directory
   *  gone, or directory present with no git entry) — offers prune/delete. */
  isPruneCandidate: z.boolean()
})
export const worktreeListResponseSchema = z.array(worktreeSummarySchema)

export const worktreeRemoveRequestSchema = z.object({
  worktreeId: z.uuid(),
  deleteBranch: z.boolean().optional(),   // opt-in only (D26 Q4) — default false
  confirmation: z.string().optional()     // required to equal the path for a DIRTY removal
})
export const worktreeRemoveResponseSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), reason: z.string() })
])

export const worktreeDirtyFilesRequestSchema = z.object({ worktreeId: z.uuid() })
export const worktreeDirtyFilesResponseSchema = z.array(z.string())
```

**Pure confirmation-gate predicate** (exported for the unit test; the handler and the panel both reason about it):

```ts
/** Clean worktrees remove without confirmation; a dirty worktree removes only
 *  when the typed token exactly matches its path (D26 Q4/clause 6). */
export function dirtyRemovalAllowed(
  wt: { path: string; clean: boolean },
  confirmation: string | undefined
): boolean {
  if (wt.clean) return true
  return confirmation === wt.path
}
```

## 3. Handlers (`src/main/ipc.ts`)

**`worktree:list`** — FK-check the project; build summaries via `GitWorktreeManager` + `git.ts`. `isPruneCandidate` is recomputed **live** here (2-1's reconcile did not persist surface findings — see IS-2-1 §7):

```ts
ipcMain.handle(IpcChannel.WorktreeList, async (_e, payload): Promise<WorktreeSummary[]> => {
  const { project_id } = worktreeListRequestSchema.parse(payload)
  const p = requireProject(project_id)
  const out: WorktreeSummary[] = []
  for (const w of storage.getWorktreesForProject(p.id)) {
    const dirGone = !fs.existsSync(w.path)
    const dirty = dirGone ? [] : await getDirtyFiles(w.path)
    const { ahead, behind } = dirGone ? { ahead: 0, behind: 0 } : await aheadBehind(w.repoRoot, w.branch, w.baseBranch).catch(() => ({ ahead: 0, behind: 0 }))
    out.push({
      id: w.id, path: w.path, branch: w.branch, status: w.status,
      clean: !dirGone && dirty.length === 0, dirtyCount: dirty.length,
      ahead, behind, isPruneCandidate: dirGone      // population-2 surfacing (dir gone, git meta remains)
    })
  }
  return worktreeListResponseSchema.parse(out)
})
```

**`worktree:dirty-files`** — return the porcelain lines for the confirmation dialog (path resolved from the row):

```ts
ipcMain.handle(IpcChannel.WorktreeDirtyFiles, async (_e, payload): Promise<string[]> => {
  const { worktreeId } = worktreeDirtyFilesRequestSchema.parse(payload)
  const w = storage.getWorktreeById(worktreeId)
  if (!w || !fs.existsSync(w.path)) return []
  return worktreeDirtyFilesResponseSchema.parse(await getDirtyFiles(w.path))
})
```

**`worktree:remove`** — the destructive gate. **Re-checks cleanliness at execution** (never trusts the renderer's stale read); blocks a live owning session; requires the typed token for a dirty removal; `deleteBranch` opt-in; **never `--force`**:

```ts
ipcMain.handle(IpcChannel.WorktreeRemove, async (_e, payload): Promise<WorktreeRemoveResponse> => {
  const req = worktreeRemoveRequestSchema.parse(payload)
  const w = storage.getWorktreeById(req.worktreeId)
  if (!w) return { ok: false, reason: 'Worktree not found' }
  if (w.sessionId && sessions.isRunning(w.sessionId)) {
    return { ok: false, reason: 'Kill the owning session before removing its worktree' }
  }
  const dirGone = !fs.existsSync(w.path)
  const clean = dirGone || (await getDirtyFiles(w.path)).length === 0        // LIVE re-check
  if (!dirtyRemovalAllowed({ path: w.path, clean }, req.confirmation)) {
    return { ok: false, reason: 'Type the worktree path to confirm removing uncommitted work' }
  }
  storage.updateWorktreeStatus(w.id, 'removing')                             // journal
  try {
    await worktrees.removeWorktree(w.id, { deleteBranch: req.deleteBranch, forceDirty: !clean })
  } catch (err) {
    storage.updateWorktreeStatus(w.id, 'detached')                          // revert on failure
    return { ok: false, reason: `Removal failed: ${errMsg(err)}` }
  }
  storage.deleteWorktreeRow(w.id)
  return { ok: true }
})
```

`removeWorktree` (2-1) does: clean → `git worktree remove <path>`; dirty-and-authorized (`forceDirty`) → **targeted `git worktree remove --force <path>`** — the ONE `--force` path permitted under clause 7 as amended (D26(i)), reached only after `dirtyRemovalAllowed` passed on this handler's LIVE re-check; `deleteBranch` → `git branch -d <branch>`, with `-D` escalation only behind the same typed acknowledgment (D26(j)). All with the Windows lock retry/backoff (clause 8). Both mechanics were **RESOLVED at the doc review** — see IS-2-1 §5.

**`session:delete`** — grow the existing handler with the detach step (resolution a — transactional). The handler still refuses a live session; the *offer* to remove-if-clean is renderer UX (below), so the handler only ever **detaches**:

```ts
ipcMain.handle(IpcChannel.SessionDelete, (_e, payload): void => {
  const { sessionId } = deleteSessionRequestSchema.parse(payload)
  if (sessions.isRunning(sessionId)) throw new Error(`Refusing to delete live session: ${sessionId} (kill it first)`)
  const row = storage.getSessionById(sessionId)
  if (row?.worktreeId) storage.detachWorktree(row.worktreeId)   // transactional; clears both pointers
  storage.deleteSession(sessionId)
})
```

Clean-removal at close is driven by the renderer calling `worktree:remove` **before** `session:delete` (below), so the handler's only worktree responsibility is the safe detach.

## 4. Preload (`src/preload/index.ts`)

```ts
listWorktrees: (projectId: string): Promise<WorktreeSummary[]> =>
  ipcRenderer.invoke(IpcChannel.WorktreeList, { project_id: projectId }),
removeWorktree: (req: WorktreeRemoveRequest): Promise<WorktreeRemoveResponse> =>
  ipcRenderer.invoke(IpcChannel.WorktreeRemove, req),
getWorktreeDirtyFiles: (worktreeId: string): Promise<string[]> =>
  ipcRenderer.invoke(IpcChannel.WorktreeDirtyFiles, { worktreeId }),
```

## 5. `TerminalPane.vue` — close flow

The current `onClose` does: (if running) `window.confirm` → kill → awaited exit → `layoutStore.removeLeaf` → `deleteSession`. 2-3 inserts the worktree decision **after the awaited exit, before `deleteSession`**, and uses **inline UI, never `window.confirm`** for the worktree offer (the running-kill `window.confirm` guard predates the harness caveat; do not add new blocking confirms).

**How the pane knows and decides (coordinator-resolved at doc review):**

- **Identity at attach:** add `worktreeId: z.string().nullable()` (required-nullable, alongside 2-2's `branch`) to `attachResponseSchema`, populated in every attach producer from `sessions.worktree_id`. This is 2-3's one schema touch beyond the channels — justified because the close flow is renderer-driven and must act by `worktreeId`. No `projectId` prop is added to `TerminalPane`, and no `worktree:list` round-trip is needed.
- **Cleanliness at CLOSE time, never at attach time:** an attach-time cleanliness snapshot would be **stale by close** (the agent may have worked for an hour since mount) — a stale "clean" would show a removal offer that main's live re-check then refuses, a confusing dead end. The close flow instead reads cleanliness **fresh** via the existing `worktree:dirty-files` channel: empty list ⇒ clean ⇒ inline offer; non-empty ⇒ dirty ⇒ silent detach + transient notice. Main's `worktree:remove` still re-checks again at execution (defense in depth — the fresh read narrows the race window; the handler's re-check closes it).

Close-flow shape:

```ts
async function onClose(): Promise<void> {
  if (pane.value.busy) return
  if (pane.value.status === 'running') { /* existing kill + awaited-exit guard */ }
  const wtId = worktreeId.value  // from attach response (2-3 addition, required-nullable)
  if (wtId) {
    const dirty = await window.chorus.getWorktreeDirtyFiles(wtId)   // FRESH read at close
    if (dirty.length === 0) {
      // Inline offer (a small in-pane prompt component / two buttons) — NOT window.confirm.
      const remove = await offerCleanRemoval()   // resolves boolean from inline UI
      if (remove) await window.chorus.removeWorktree({ worktreeId: wtId })
    } else {
      // Dirty: silent detach is the contract default; session:delete detaches.
      showTransientNotice('Worktree kept (uncommitted work) — see Manage worktrees')
    }
  }
  layoutStore.removeLeaf(props.sessionId)
  try { await window.chorus.deleteSession(props.sessionId) } catch (err) { /* existing drift log */ }
}
```

Declining the offer takes the same path as dirty: no removal call — `session:delete`'s detach step retains the worktree (`detached`, listed in the panel).

## 6. `WorktreePanel.vue` (new)

Overlay on the LaunchDialog focus-trap idiom (fixed inset, `bg-black/50`, `role="dialog" aria-modal="true"`, Tab-trap, Esc-cancel). **F13:** `onMounted` awaits `listWorktrees`; bail if unmounted after the await.

- **Props:** `{ projectId: string }`. **Emits:** `close`.
- **On mount:** `rows.value = await window.chorus.listWorktrees(props.projectId)`.
- **Row:** path (truncated, `:title`), branch, a clean/dirty badge (`dirtyCount` when dirty), ahead/behind (`↑{ahead} ↓{behind}`), status; a **Remove** button; prune-candidate rows (`isPruneCandidate`) get a distinct "Prune" affordance (offers `git worktree prune` + row delete on explicit click — still user-confirmed, never automatic).
- **Remove flow (inline gate):** clicking Remove expands an inline confirmation region:
  - clean → a single "Remove" confirm button;
  - dirty → fetch `getWorktreeDirtyFiles(id)`, list them, require the user to **type the exact path** into an input; the confirm button is disabled until `dirtyRemovalAllowed({path, clean:false}, typed)` is true;
  - a **"Also delete branch `<branch>`"** checkbox, **unchecked by default** (D26 Q4);
  - confirm → `window.chorus.removeWorktree({ worktreeId, deleteBranch, confirmation })`; on `{ok:false}` show the reason inline; on success remove the row from the list.
- **No `window.confirm` anywhere** (renderer-thread block — harness caveat).

## 7. Palette + `App.vue`

**`commands.ts`** — add `manageWorktrees: () => void` to `PaletteContext`, and a sixth command in `buildCommands`:

```ts
cmds.push({
  id: 'manage-worktrees',
  label: 'Manage worktrees…',
  keywords: ['worktree', 'worktrees', 'git', 'branch', 'cleanup', 'remove'],
  enabled: () => true,
  run: () => ctx.manageWorktrees()
})
```

**`App.vue`** — a `worktreePanelOpen` ref; pass `manageWorktrees: () => (worktreePanelOpen.value = true)` into the `paletteCommands` context; mount `<WorktreePanel v-if="worktreePanelOpen && projectStore.activeId" :project-id="projectStore.activeId" @close="worktreePanelOpen = false" />` next to the existing `CommandPalette` mount.

## 8. Invariants recap (2-3)

- `session:delete` **detaches** a referenced worktree transactionally (resolution a) — never cascades; still refuses a live session.
- Close: clean → inline removal offer; dirty → silent detach + transient notice (clause 5). No `window.confirm` for the worktree decision.
- `worktree:remove` re-checks cleanliness **live**; dirty requires `confirmation === path`; branch deletion opt-in (`-d`, gated `-D` — D26(j)); owning session must not be live; **`--force` reaches git ONLY on this gated path** (clause 7 as amended, D26(i)) — nowhere else in the codebase.
- The retained list is an **overlay + palette command** (resolution g), not a settings panel; columns per risk 6; prune candidates surfaced live.
- All Zod in main; payloads plain; no auto-merge; no restart-driver change (D25).

## 9. Verification (including RUNTIME — G2)

**Static:**
- `npm run typecheck` (G1).
- `npx vitest run` — `ipc.test.ts`: the three request/response schemas; `dirtyRemovalAllowed` (clean→true regardless; dirty+match→true; dirty+mismatch/undefined→false). `commands.test.ts`: "Manage worktrees" present/enabled, `run()` calls `manageWorktrees`, survives `fuzzyFilter('worktree')`.

**Runtime script (drive the real app; prefer Codex — Claude Code unauthenticated; screenshot each step):**
1. Launch a new-worktree session (2-2). Make **no** edits → **close** the pane → the inline **clean-removal offer** appears; accept → `git worktree list` no longer shows it, the row is gone.
2. Launch another new-worktree session; **make an edit** in it (Codex writes a file, or edit on disk) → **close** → it **detaches silently** with a transient notice; `git worktree list` still shows it; the DB row is `detached`, `session_id` NULL; the file edit is intact on disk.
3. `Ctrl+K` → "Manage worktrees" → the panel lists the detached worktree with path, branch, a **dirty** badge + count, ahead/behind, status.
4. Click **Remove** on the dirty row → the dirty file list shows; the confirm button stays disabled until the exact path is typed; type it → confirm → removed (dir gone, row gone). Verify the handler **re-checked** cleanliness (dirty a file after the panel opened, then remove → still gated).
5. Repeat with **"Also delete branch"** checked → `git branch --list 'chorus/*'` no longer shows the branch; unchecked (default) → the branch remains.
6. `session:delete` detach path: kill + close a worktree session, confirm via DB the worktree row is `detached` with `session_id` NULL and `sessions.worktree_id` cleared (transactional).
7. **Prune candidate:** delete a worktree directory by hand (leaving git metadata), open the panel → the row shows `isPruneCandidate`; the Prune affordance offers cleanup on explicit click only (never automatic).
8. Confirm **no** `window.confirm` blocks the renderer during any of the above (CDP click-through works without a native dialog).
