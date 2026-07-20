# Council Findings CR-2.0 — Worktree Lifecycle & Crash Reconciliation

_Issued 2026-07-20 · Status: COMPLETE · Verdict: REVISE · Confidence: 8/10_

Council convened: **Kimi (K2.7)**, **GLM (5.2)**, **Qwen (3.7 Max)** — Arbiter: **GPT 5.5**

---

## Per-model positions

**Kimi**: Q1 C (hybrid, owned-with-retention) / Q2 DB-first journal, `creating` state / Q3 Reconcile before restore, 5-population classify, auto-prune only confirmed-vanished / Q4 Auto-remove only clean `git status --porcelain`, dirty needs typed confirmation showing file list — Session-owned is the natural mental model (pane == workspace), but blind deletion on close is the data-loss hazard — the hybrid `detached` state is the minimum bar for the prime directive. Strongest counterargument: the detached-worktree UI surface is new scope Phase 2 might not have bandwidth for; a simpler block-on-dirty-close with explanation might ship faster.

**GLM**: Q1 C (hybrid, owned-with-retention) / Q2 DB-first journal with deterministic path / Q3 Idempotent reconcile pass after storage init, before D16 restore, classify all 5 populations / Q4 Clean = `git status --porcelain` empty AND no commits ahead of base; dirty removal blocked unless typed confirmation — The independent-resource model (B) is architecturally cleaner but creates an accumulation problem users won't manage. Hybrid retention gives the best of both: creation/attribution stays simple, and nothing is silently lost. Strongest counterargument: retention requires a UI list; if that list ships in Phase 3 instead of Phase 2, "retained" worktrees become invisible orphan directories.

**Qwen**: Q1 C (hybrid, owned-with-retention) / Q2 DB-first journal, idempotent reconcile completes partials / Q3 Reconcile pre-restore, auto-heal clean cases, surface dirty/stale to user / Q4 Auto-remove only fully clean; dirty requires explicit confirmation; branch kept by default — The prime directive demands retention. Option A (1:1) forces deletion to handle the close-flow, which violates data-loss safety. Option B (independent) abandons too much lifecycle coupling that keeps the system predictable. Option C is the only shape that satisfies all constraints. Strongest counterargument: it is the most complex of the three to implement, requiring both the ownership path AND the retention UI.

---

## Council synthesis

**Q1 — Coupling: Option C (hybrid, owned-with-retention)** — unanimous 3-of-3

A worktree is created by and attributed to a session, but closing the session never destroys a dirty worktree. When a session closes and its worktree is clean (empty `git status --porcelain`, see Q4), Chorus offers auto-removal. When dirty, the worktree row transitions to `detached` — it survives session deletion, is surfaced in a retained-worktree list, and cleanup is always an explicit, separate user act. `session:delete` must block if a live worktree references it, and detach (set `worktrees.session_id = NULL`, `worktrees.status = 'detached'`) rather than cascade-delete when the referenced session row is deleted. This preserves the pane==workspace mental model while ensuring uncommitted work always survives.

**Q2 — Lifecycle states & crash-safe creation** — unanimous 3-of-3

State set: `creating` → `provisioning` → `active` → `detached` → `removing` → (row deleted). Creation ordering is **DB-first journaling**: (1) insert `worktrees` row with `status = 'creating'`, path derived deterministically from worktree UUID (e.g. `<worktreeRoot>/wt-<shortId>`); (2) mkdir parents; (3) `git worktree add -b <branch> <path> <base>`, set `status = 'provisioning'` on success; (4) update `sessions.worktree_id`, set `status = 'active'`. Crash rules: a `creating` row with no git entry → delete row (nothing was created); a `provisioning` row with git entry + directory → promote to `active`; a `provisioning` row with git entry, directory absent → user deleted by hand, treat as population (2) prune candidate; a `provisioning` row with a directory but no git entry → treat as population (5), surface orphan directory to user, never auto-delete (git did not complete; files may be agent output, not workspace debris). The DB row is the authoritative record; git is reified state.

**Q3 — Boot reconcile contract** — unanimous 3-of-3

Reconcile runs **after storage init, before D16 session restore** to prevent the restore engine from spawning into a worktree the reconcile is about to act on. Per-population rules:
- **(1) row + git entry + directory**: healthy → no action.
- **(2) row + git entry, directory gone**: `status = 'detached'` if the session that created it is alive (user may have moved it), else prune candidate → surface to user, offer `git worktree prune` + delete row.
- **(3) row, no git entry**: stale row. If `status = 'creating'` or `'provisioning'` → delete row (crash recovery). If `status = 'active'` or `'detached'`, directory checked → if absent, mark `status = 'detached'` + surface; if present, re-verify git entry with `git worktree list`.
- **(4) git entry under managed root, no row**: crash between git op and row write → if directory exists and git entry is valid, create a `worktrees` row with `status = 'active'` and a `session_id = NULL`; surface as "found untracked worktree."
- **(5) directory under managed root, no git entry**: orphan directory → surface to user, offer manual deletion; never auto-delete.

`git worktree prune` is run only on population (2) after user confirmation — never automatically on boot, because it destroys metadata for vanished directories without asking. Reconcile is idempotent: running it twice produces the same end state.

**Q4 — Destruction semantics** — unanimous 3-of-3

Clean-enough-to-auto-remove: `git status --porcelain` returns empty (no modified, staged, or untracked files). Committed-but-unmerged commits on the branch do NOT block auto-removal — they survive in the shared object store and the branch ref is kept (see branch rule). `--force` is never used by Chorus; if `git worktree remove` refuses (dirty), Chorus shows the dirty file list and requires typed confirmation (the user types the worktree path or branch name). Branch retention rule: the branch is **never auto-deleted**. When the user explicitly removes a worktree via the retained-worktree list, they are offered a checkbox: "Also delete branch `<branch>`" — unchecked by default. A branch with unmerged commits into base shows the ahead/behind count. Fully merged branches may be cleaned up by a future manual "prune merged branches" action. The implementable rule set is: (a) close offers auto-removal only when `git status --porcelain` is empty; (b) dirty close always retains (worktree → `detached`); (c) explicit removal from the retained list requires typed confirmation naming the worktree path if dirty; (d) branches are kept unless the user explicitly opts to delete them; (e) `--force` is never used in any code path.

**Dissents**: none — unanimous on all four questions.

---

## The worktree lifecycle contract (verbatim, implementable)

1. A worktree is created by a session and attributed to it via `sessions.worktree_id`, but outlives its owning session by design.
2. Creation is DB-first journaled: a `worktrees` row is inserted with `status = 'creating'` before any filesystem or git operation; the path is deterministic from the worktree UUID; `git worktree add` follows; the row is promoted to `active` only after success.
3. Boot reconcile runs before session restore, classifying every combination of `worktrees` row, `git worktree list --porcelain` entry, and filesystem directory across five populations with keep/heal/promote/surface/delete rules per population.
4. A worktree is "clean enough to auto-remove" when `git status --porcelain` returns empty; committed-but-unmerged work on its branch survives in the object store and the branch is kept by default.
5. Closing a session with a clean worktree offers auto-removal; closing with a dirty worktree transitions it to `detached` status, decoupled from the session, surfaced in a retained-worktree list, never silently destroyed.
6. Explicit removal of a detached worktree requires typed confirmation naming the worktree path if dirty; branches are never auto-deleted and require a separate opt-in checkbox.
7. `git worktree remove --force` is never used by Chorus; all destructive operations are gated behind an explicit, informed user confirmation that names what will be lost.
8. Worktree directory removal sequences after the owning session's process tree has exited, respecting the Windows open-handle constraint; removal retries on lock failures with backoff.

---

## Risks & mitigations for the winner

1. **Detached-worktree accumulation** — users close dirty panes reflexively and the retained list grows without bound → surface the retained-worktree count in the project tab/chrome and add a "clean up worktrees" action that lists all detached worktrees with their status (branch, ahead/behind, dirty file count).

2. **DB-first journaling leaves rows on `git worktree add` failure** — a row in `creating` state after a hard crash where `git worktree add` never started → reconcile detects `creating` rows with no filesystem directory or git entry, deletes them safely (nothing was created). A `provisioning` row with a directory but no git entry (git add crashed mid-write) is surfaced to the user as an orphan directory (population 5) — never auto-deleted.

3. **`git rev-parse --show-toplevel` failure on every cwd lookup** — a session's cwd may not be inside a git repo → repo root resolution must handle non-git cwds gracefully (return null, skip worktree creation for that session, surface "not a git repo" in the launch dialog).

4. **Reconcile and D16 restore ordering race** — if reconcile delays and restore starts first, a session could launch into a worktree the reconcile was about to mark stale → enforce ordering at the boot-sequence level: await reconcile before void sessions.restore().

5. **Branch name collision on concurrent launches** — two agents launched simultaneously against the same repo with the same base branch generate the same derived branch name → incorporate a short random suffix (e.g. `chorus/<agent>-<shortId>`) and retry on `git worktree add` conflict with a new name.

6. **Retained-worktree UI scope creep** — the retained list becomes a full file-manager feature → ship the minimal version in Phase 2: a settings-panel list showing path, branch, status (clean/dirty), and a single "Remove" action. Rich diff/preview deferred to Phase 3.

7. **Detached worktrees and project deletion** — if a project is removed from Chorus while it has detached worktrees, those directories and branches persist on disk → document this as expected behavior (worktrees are git-managed directories; Chorus is a window into them, not their sole owner).

---

## Answer to question 5

**None load-bearing.** The trash-can/graveyard model adds complexity without improving safety over the hybrid-retention model: moving a directory is as failure-prone as deleting it (Windows handle locks apply equally), and a `git stash`/bundle snapshot before removal is an optimization, not a shape change — it can be added later as a feature in the removal confirmation flow ("save a stash before removing?") without affecting the lifecycle contract. The hybrid-retention model is the simplest shape that satisfies all constraints, and no failure mode was identified that requires a fundamentally different approach.

---

## Action items for implementation

1. Create migration v4: `worktrees` table with columns `id` (TEXT PK), `project_id` (TEXT FK → projects), `session_id` (TEXT FK → sessions, nullable, NO CASCADE), `path` (TEXT NOT NULL UNIQUE), `branch` (TEXT NOT NULL), `base_branch` (TEXT NOT NULL), `repo_root` (TEXT NOT NULL), `status` (TEXT NOT NULL — 'creating'|'provisioning'|'active'|'detached'|'removing'), `created_at` (TEXT NOT NULL); add `worktree_id` column (TEXT, nullable) to `sessions`.

2. Implement `GitWorktreeManager` service in `src/main/services/` with methods: `resolveRepoRoot(cwd): string | null`, `createWorktree(sessionId, repoRoot, baseBranch): WorktreeRecord`, `removeWorktree(worktreeId, deleteBranch?): void`, `isClean(worktreePath): boolean`, `getDirtyFiles(worktreePath): string[]`, `listWorktrees(repoRoot): GitWorktreeEntry[]`.

3. Implement `reconcileWorktrees()` function: runs before D16 restore in the boot sequence, classifies all five populations, returns `ReconcileReport` with actions taken; must be idempotent; must not auto-prune without user confirmation for populations (2) and (5).

4. Modify `session:launch` IPC handler to detect if cwd is inside a git repo; if so and another session already has a worktree for that repo, call `GitWorktreeManager.createWorktree()` with DB-first journaling; set the session's cwd to the worktree path after creation; set `sessions.worktree_id`.

5. Modify `session:delete` IPC handler to check `sessions.worktree_id`: if present and worktree is clean, offer auto-removal; if dirty, set `worktrees.status = 'detached'`, `worktrees.session_id = NULL`, then proceed with session row deletion; block deletion if worktree PTY is still live.

6. Modify boot sequence in `src/main/index.ts` to call `reconcileWorktrees()` after storage init and before `void sessions.restore(project.id)`; ensure ordering is enforced with `await`.

7. Add retained-worktree UI surface: a section in the project settings panel or a dedicated list showing detached worktrees with path, branch, status (clean/dirty), and "Remove" action with typed-confirmation gate for dirty worktrees.

8. Add worktree IPC channels: `worktree:list` (returns all worktrees for a project), `worktree:remove` (with `{worktreeId, deleteBranch?, confirmation}` payload), `worktree:get-dirty-files` (returns dirty file list for confirmation dialog).

9. Write unit tests: `reconcileWorktrees` with mocked git output for all 5 populations, `GitWorktreeManager.createWorktree` with crash-simulation at each seam, `session:delete` with worktree-attached session (clean, dirty, live), idempotency of reconcile when run twice.

10. Verify the migration upgrades the dev DB in place with zero manual steps: run the app against the existing dev DB with 3 applied migrations, confirm v4 applies and existing data is intact.