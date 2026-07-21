# Task 2-3 — Cleanup Flows, Retained-Worktree Panel, Reconcile Surfacing

_Third task of Phase 2 (Foundation). Windows-only. Serial after Task 2-2 (it consumes the worktree launch flow, the branch label, and the pickable-worktree list). This task governs scope; `ImplementationSpec-2-3.md` governs exact contents._

## Source Of Truth

- `CLAUDE.md` (D1 Zod-in-main; D14 plain payloads; D4 verify git flags; **no jumping ahead to settings screens** — the retained list is a minimal overlay, D26g).
- Roadmap §6: **D26** — the lifecycle contract clauses **5** (clean-close offers removal; dirty-close detaches, never destroyed), **6** (explicit removal needs typed confirmation naming the path if dirty; branches never auto-deleted, opt-in checkbox only), **7** (`--force` never used), **8** (removal sequences after process-tree exit, retries on lock with backoff); resolution **(a)** (transactional detach), **(d)/(e)** (reconcile surfacing), **(g)** (overlay dialog + palette command, columns per risk 6). Q4 destruction semantics.
- Council findings actions 5/7/8, risk 1 (accumulation → "clean up worktrees" action), risk 6 (minimal list columns) — **as patched by D26(g): overlay, not a settings panel.**
- `docs/PLAN.md` §5 (remove worktree on archive; never auto-merge).
- Harness caveat (roadmap §5): **`window.confirm` blocks the renderer thread** — the removal gate and the clean-removal offer must be **inline UI**, never `window.confirm`.

## Initial Starting Point

**Verified 2026-07-20 against commit `59e7909`**, plus Tasks 2-1 and 2-2 landed.

- **`session:delete`** (`src/main/ipc.ts`): refuses a live session (`sessions.isRunning` → throw), then `storage.deleteSession(sessionId)`. It does **not** yet consider a worktree pointer.
- **`TerminalPane.onClose`**: (if running) `window.confirm` → kill → awaited exit → `layoutStore.removeLeaf` → `window.chorus.deleteSession`. (The running-guard `window.confirm` predates the harness caveat; 2-3 replaces the worktree-related decisions with inline UI and should not introduce new blocking `window.confirm` calls.)
- **`GitWorktreeManager`** exposes `isClean`, `getDirtyFiles`, `removeWorktree(worktreeId, {deleteBranch?, forceDirty?})`, `list`, `reconcileAll`, plus `aheadBehind` via `git.ts` (2-1). **`removeWorktree` currently THROWS when `deleteBranch` is set** (a deliberate 2-1 tripwire, `'branch deletion is Task 2-3 scope (D26(j))'`) — this task must **replace** that throw with the real `git branch -d` implementation, not merely call it.
- **After Task 2-2 (`94f062c`):** the launch path creates and re-owns worktrees; `branchForSession(sessionId, projectId)` in `src/main/ipc.ts` resolves the branch from `worktrees.session_id` (**F18 resolved as option (a)** — row-side, never `sessions.worktree_id`). Re-owning leaves the PREVIOUS owner's `sessions.worktree_id` stale, which F18(a) renders harmless; **consider clearing it inside `activateWorktreeForSession`'s transaction** if you touch `storage.ts` (optional tidy-up, not required).
- **⚠ Live defect this task fixes (F16 consequence, reported from 2-2):** closing a pane whose session owns a worktree **fails today** — `session:delete` hits the enforced FK (RESTRICT) while `worktrees.session_id` references the row, the renderer logs `[pane] session:delete failed`, and the row is left as exited drift. It fails loudly, not silently. The detach-before-delete step below is the fix; **verify this specific case at runtime**.
- **⚠ F19 fixture on the dev machine:** `C:\Projects\ContactEstablished\.chorus\Chorus\wt-39b6f2fe` (branch `chorus/Chorus/39b6f2fe`, **clean**) exists in `git worktree list` with **no** `worktrees` row on this machine. It is a deliberate real-world test case for the F19 fix and the panel's adoption surfacing — **do not delete it before both work**.
- **Storage** has `getWorktreesForProject`, `getWorktreeById`, `detachWorktree` (transactional — resolution a), `deleteWorktreeRow`, `updateWorktreeStatus`.
- **`commands.ts`** is a pure registry (`buildCommands(ctx)` + `fuzzyFilter`); **`App.vue`** assembles the `PaletteContext` and mounts `CommandPalette`/`LaunchDialog`. `LaunchDialog.vue` is the focus-trap idiom to copy for the new panel.
- **The reconcile core** (`computeWorktreeReconcile`, 2-1) surfaces populations 2 (prune candidate) and 5 (orphan directory) but 2-1 has no UI — it only logged them. 2-3 recomputes surfaceable populations live when the panel opens.

## Goal

Close the loop on worktree cleanup, honoring the prime directive that uncommitted work is never silently destroyed. `session:delete` grows a **detach step** (via the transactional storage op) whenever a `worktrees` row references the session. The pane **close flow** queries cleanliness after the awaited exit: **clean → offer removal inline** (not `window.confirm`); **dirty → detach silently with a transient notice** (the contract's default). A new `WorktreePanel.vue` overlay (LaunchDialog focus-trap idiom) lists the project's worktrees (path, branch, clean/dirty badge, ahead/behind if cheap, status), removes only through a **typed-confirmation gate** (type the worktree path) with an unchecked-by-default **"Also delete branch"** checkbox, and surfaces **prune-candidate rows from reconcile** (population 2/5). A **"Manage worktrees"** palette command opens it. Three worktree IPC channels back it: `worktree:list`, `worktree:remove`, `worktree:dirty-files`. Main **always** re-checks cleanliness at execution time and requires the typed token for dirty removal; **`--force` reaches git only on that gated path (D26(i)); branches are never auto-deleted (`-d` opt-in, gated `-D` — D26(j)).**

## Exact Scope

Touch **only** these files:

| File | Change |
|---|---|
| `src/shared/ipc.ts` | `worktree:list` / `worktree:remove` / `worktree:dirty-files` channels + schemas. `worktreeRemoveRequestSchema` = `{worktreeId: z.uuid(), deleteBranch: z.boolean().optional(), confirmation: z.string().optional()}`. `worktreeSummarySchema` (id, path, branch, status, clean, ahead, behind, dirtyCount, isPruneCandidate) for the list. Plus **`worktreeId` (required-nullable) on `attachResponseSchema`** — the close flow acts by id; cleanliness is read FRESH at close via `worktree:dirty-files`, never carried from attach (see spec §5). |
| `src/main/ipc.ts` | Register the three handlers. `worktree:remove` re-checks cleanliness at execution and requires `confirmation === worktree.path` for dirty removal (**never `--force`**); `deleteBranch` opt-in only. Grow `session:delete` with the transactional detach step when a `worktrees` row references the session (the handler only ever **detaches or removes-when-clean-and-asked** — the offer itself is renderer UX). |
| `src/preload/index.ts` | `listWorktrees(projectId)`, `removeWorktree(req)`, `getWorktreeDirtyFiles(worktreeId)` forwarders. |
| `src/renderer/src/components/TerminalPane.vue` | Close flow: after kill + awaited exit, if the session has a worktree — **clean → offer removal inline**; **dirty → detach silently** with a transient notice. No new blocking `window.confirm`. |
| `src/renderer/src/components/WorktreePanel.vue` | **New.** Overlay on the LaunchDialog focus-trap idiom; lists the project's worktrees; Remove action with the typed-path gate + "Also delete branch" (unchecked default); prune-candidate rows surfaced (population 2/5). F13 async-`onMounted` bail rule applies. |
| `src/main/services/worktrees.ts` | **ADMITTED TO SCOPE 2026-07-20 for the F19 fix** (2-1's file; this is the one task allowed to edit it). `reconcileAll()` must enumerate candidate repos from the **union** of worktree-row `repoRoot`s AND `resolveRepoRoot(project.rootPath)` over `storage.listProjects()`, deduped by the F17 path key — otherwise reconcile populations 4 and 5 are unreachable for a repo with zero rows (proven live; see IS-2-3 §3). **`computeWorktreeReconcile` itself needs no change** — it already handles a zero-row group. Do not make other changes to this file. |
| `src/renderer/src/palette/commands.ts` | A sixth command: **"Manage worktrees"** (opens the panel via a `PaletteContext` callback). |
| `src/renderer/src/App.vue` | Mount `WorktreePanel`; add the `manageWorktrees` callback to the `PaletteContext` (resolution g). |
| `src/shared/ipc.test.ts` | Schema cases for the three channels; the pure **confirmation-gate predicate** (`dirtyRemovalAllowed(worktree, confirmation)`), unit-tested. |
| `src/renderer/src/palette/commands.test.ts` | Extend for the new "Manage worktrees" command (present, enabled, runs its callback). |

Nothing else. If a change seems to require another file, raise it.

## Non-Goals

- **Never auto-merge.**
- **`--force` only inside the ONE gated dirty-removal path (D26(i))** — a targeted `git worktree remove --force <path>`, reached only after main's live cleanliness re-check + the typed-confirmation token; it is never passed anywhere else, and never without the gate.
- **No branch auto-deletion** — "Also delete branch" is unchecked by default and only acts when explicitly checked (D26 Q4).
- **No `window.confirm`** for worktree decisions (it blocks the renderer thread — harness caveat); all gates are inline UI.
- **No settings panel / settings screen** — a minimal overlay + palette command only (D26g).
- **No rich diff/preview** in the panel (that is 2-4's shortstat, reused read-only; per-file diff is a v1-horizon exclusion).
- **The handler never removes a dirty worktree without the typed token, and never removes a worktree whose session is still live.**
- **No restart-driver change** (D25/F14).
- **Do not revert, stage, or commit unrelated or untracked files, including `_verify/` and anything under `docs/`.**

## Dependencies

- Tasks 2-1/2-2 landed: `GitWorktreeManager` (`isClean`, `getDirtyFiles`, `removeWorktree`, `list`), `git.ts` (`aheadBehind`, `worktreePrune`), storage detach/delete ops, the branch label, the launch modes.
- No new npm dependencies.

## Step-by-step Work

1. **Schemas** (`ipc.ts`): the three channels + request/response schemas + `worktreeSummarySchema`; factor `dirtyRemovalAllowed(worktree, confirmation)` as a pure predicate (exported for the unit test).
2. **Handlers** (`main/ipc.ts`): `worktree:list` (FK-check project → summaries via `GitWorktreeManager.list` + `git.ts` cleanliness/ahead-behind, marking prune candidates); `worktree:dirty-files`; `worktree:remove` (re-check cleanliness live; clean → remove; dirty → require `confirmation === path`, else `{ok:false}`; `deleteBranch` opt-in; block if the owning session is live). Grow `session:delete` to detach first when a worktree references the session.
3. **Preload**: three forwarders.
4. **TerminalPane close flow**: after the awaited exit, resolve the session's worktree; clean → inline removal offer; dirty → silent detach + transient notice. Keep the existing kill/exit/leaf-remove/delete ordering (D16 clause 5).
5. **WorktreePanel.vue**: LaunchDialog overlay/focus-trap idiom; list rows; typed-path gate; "Also delete branch" checkbox; prune-candidate rows. F13 bail after each `await` in `onMounted`.
6. **Palette + App**: add "Manage worktrees" to `buildCommands` and the `manageWorktrees` callback + panel mount in `App.vue`.
7. **Tests** per Test Expectations.

## Test Expectations

- **Unit (Vitest), `src/shared/ipc.test.ts`:** `worktreeRemoveRequestSchema` accepts `{worktreeId}` alone, `{worktreeId, deleteBranch:true}`, `{worktreeId, confirmation:'<path>'}`; rejects a non-uuid `worktreeId`. `worktreeSummarySchema` round-trips. **`dirtyRemovalAllowed`** predicate: clean worktree → allowed regardless of confirmation; dirty + matching `confirmation` → allowed; dirty + missing/mismatched → denied.
- **Unit (Vitest), `src/renderer/src/palette/commands.test.ts`:** "Manage worktrees" command is present and enabled; `run()` invokes the `manageWorktrees` callback; it survives `fuzzyFilter` for a query like `'worktree'`.
- The panel, close-flow offer/detach, and actual removal are **runtime-verified** (G2).

## Verification Commands

Run from repo root (PowerShell):

```
npm run typecheck
npx vitest run
npm run dev
```

Cross-check removal/detach against git and the DB:

```
git -C "<repo-root>" worktree list
sqlite3 "$env:APPDATA\chorus\chorus.db" "SELECT id, session_id, path, branch, status FROM worktrees;"
```

## Acceptance Criteria

- [ ] `npm run typecheck` — zero errors (G1).
- [ ] `npx vitest run` — green (schema + `dirtyRemovalAllowed` + palette cases).
- [ ] Closing a session with a **clean** worktree offers removal **inline** (no `window.confirm`); accepting removes it (`git worktree list` no longer shows it, row gone); declining detaches (row `detached`, `session_id` NULL).
- [ ] Closing a session with a **dirty** worktree **detaches silently** with a transient notice — the worktree survives (`git worktree list` still shows it; row `detached`); uncommitted work is intact on disk.
- [ ] `session:delete` **detaches** a referenced worktree (transactional — both pointers cleared) rather than cascading; it still refuses a live session. **Runtime-verify the F16 case specifically:** closing a worktree-owning pane succeeded end-to-end (before this task it threw `SQLITE_CONSTRAINT_FOREIGNKEY` and left exited drift).
- [ ] **F19 fixed and proven:** with a repo whose `worktrees` table has no rows for it, a cold boot logs the `found untracked worktree … adopted as detached` line for `wt-39b6f2fe`, the row lands `status='detached'` / `session_id=NULL`, the panel lists it, and a second boot changes nothing (idempotent).
- [ ] The **WorktreePanel** lists the project's worktrees with path, branch, clean/dirty badge, ahead/behind, status; opens via the **"Manage worktrees"** palette command.
- [ ] Removing a **dirty** worktree from the panel requires typing the exact worktree path; the handler **re-checks cleanliness at execution time** and refuses without the matching token; `--force` is passed **only** on this gated path (D26(i)) and nowhere else.
- [ ] **"Also delete branch"** is unchecked by default and only deletes the branch when explicitly checked.
- [ ] **Prune-candidate rows** (population 2/5) are surfaced in the panel and offer prune/delete only on explicit user action (never automatic).
- [ ] One narrated commit for this session (G3), touching only Exact Scope files.

## Review Checklist

- [ ] All Zod in **main**; worktree handlers FK-check `project_id` where project-scoped; responses outbound-parsed; preload/renderer Zod-free.
- [ ] `worktree:remove` re-checks `git status --porcelain` at execution — never trusts the renderer's stale cleanliness read; dirty path requires `confirmation === worktree.path`; branch deletion is opt-in only; the owning session must not be live.
- [ ] `--force` reaches git **only** via the gated dirty-removal call (D26(i)); every other `worktreeRemove` caller passes `force: false`; branch deletion is `-d`, with `-D` only behind the typed acknowledgment (D26(j)).
- [ ] `session:delete` detach is transactional (both pointers cleared — resolution a); the renderer offer is UX only; the handler only detaches or removes-when-clean-and-asked.
- [ ] No `window.confirm` for worktree decisions (renderer-thread block — harness caveat); all gates inline.
- [ ] `WorktreePanel.vue` copies the LaunchDialog focus-trap/overlay idiom and obeys the F13 async-`onMounted` bail rule.
- [ ] The panel is an overlay + palette command — **not** a settings panel (D26g).
- [ ] No auto-merge / auto-prune / auto-branch-delete; no restart-driver change (D25).
- [ ] No untracked / `_verify/` / `docs/` files staged or reverted.
