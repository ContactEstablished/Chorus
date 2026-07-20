# Task 2-2 — Workspace Modes + Auto-Worktree Launch Flow

_Second task of Phase 2 (Foundation). Windows-only. Serial after Task 2-1 (it consumes `git.ts`, `worktrees.ts`, the `worktrees` table, and `sessions.worktree_id`). This task governs scope; `ImplementationSpec-2-2.md` governs exact contents._

## Source Of Truth

- `CLAUDE.md` (D1 Zod-in-main; D14 plain payloads; D4 verify git flags at execution; no new deps).
- Roadmap §6: **D22** (three workspace modes; read-only deferred; mode always explicit in the payload, main never silently overrides), **D23/D26h** (location + branch convention), **D26(a)** (both pointers, one transaction), **D26(f)** (the auto-worktree trigger: DEFAULT flips when ≥1 other LIVE session's cwd resolves to the same repo root, computed in main, delivered via `session:launch-context`).
- Council findings action 4 (launch-flow modification) — **as patched by D26(f): main computes the SUGGESTION and validates the chosen mode; it never silently creates a worktree the user did not pick.** Findings risk 3 (non-git cwd → return null, surface "not a git repo").
- `docs/PLAN.md` §5 (workspace modes), §7 (pane header shows worktree branch).
- Style precedent: `sessionInfoSchema`/`attachResponseSchema` `title` was added **required-nullable** in 1b-1 (roadmap F-note) — house discipline is required-nullable over optional.

## Initial Starting Point

**Verified 2026-07-20 against commit `59e7909`**, plus Task 2-1 landed (git adapter, `worktrees.ts`, migration v4, reconcile awaited at boot).

- **`launchRequestSchema`** = `{project_id, agent, cwd}`. **`launchContextResponseSchema`** = `{projectRoot, recentCwds}`.
- **`session:launch`** (`src/main/ipc.ts`): FK-checks the project, validates cwd (absolute + exists — the security boundary), enforces the 16-pane cap, `storage.createSession(...)`, `sessions.launch(agent, cwd, row.id)`, `pushRecentCwd`, returns `{...snap, title: row.title}`.
- **`session:launch-context`**: FK-checks the project, returns `{projectRoot: p.rootPath, recentCwds}` (outbound-parsed). It is currently **synchronous**.
- **`SessionManager.isRunning(id)`** exists — enough to count live sessions per repo without a new enumerator.
- **`LaunchDialog.vue`** fetches `detectClis()` + `getLaunchContext(projectId)` in `onMounted`, defaults cwd to `projectRoot`, offers recent-cwd chips, launches via `window.chorus.launch({project_id, agent, cwd})`, renders `{ok:false}` inline.
- **`TerminalPane.vue`** header renders the status dot + agent label + (nullable) title + badge. No branch label today.
- **`GitWorktreeManager.createWorktree(sessionId, repoRoot, baseBranch)`**, `resolveRepoRoot(cwd)`, `list`, and the transactional storage ops (`activateWorktreeForSession`, `detachWorktree`) exist from 2-1.

## Goal

Ship the three workspace modes (D22) on the launch path. `session:launch-context` grows repo context computed in main — the resolved repo root, the count of other **live** sessions in that repo, a suggested mode, and the list of pickable retained/active-unowned worktrees — so the dialog can default correctly and offer the existing-worktree picker. `launchRequestSchema` grows an explicit `workspace_mode` (+ optional `worktree_id`). `session:launch` executes the chosen mode: **new-worktree** creates a DB-first-journaled worktree and spawns with cwd = the worktree path, writing both pointers transactionally; **existing-worktree** re-owns an attachable worktree; **current-tree** is today's behavior. The pane header (and filmstrip cards, via `layout:get`) gain a **branch label** for worktree sessions. **The mode always travels explicitly in the payload; main validates but never silently overrides.**

## Exact Scope

Touch **only** these files:

| File | Change |
|---|---|
| `src/shared/ipc.ts` | `workspaceModeSchema = z.enum(['current-tree','new-worktree','existing-worktree'])`; grow `launchRequestSchema` with `workspace_mode` + optional `worktree_id` (`z.uuid().optional()`; the required-when-existing semantics are enforced in **main**, not by schema gymnastics); grow `launchContextResponseSchema` with `repoRoot: z.string().nullable()`, `liveSessionsInRepo: z.number().int()`, `suggestedMode: workspaceModeSchema`, and `worktrees: z.array(pickableWorktreeSchema)` (id, branch, path, status); add **required-nullable `branch`** to `sessionInfoSchema` and `attachResponseSchema` (justified below). |
| `src/main/ipc.ts` | `session:launch-context` becomes async: resolve `repoRoot` for the project root, count other live sessions whose cwd resolves to it, compute `suggestedMode`, list pickable worktrees. `session:launch` dispatches on `workspace_mode`: **new-worktree** → `createWorktree` (DB-first) → session row cwd updated to the worktree path → `activateWorktreeForSession` (transactional) → spawn; **existing-worktree** → validate + re-own → spawn; **current-tree** → today's path. Populate `branch` on attach/`layout:get`. |
| `src/preload/index.ts` | No signature change needed for `launch`/`getLaunchContext` (they already forward request/response objects) — confirm the grown types flow through `ChorusApi`. |
| `src/renderer/src/components/LaunchDialog.vue` | Mode selector defaulting to `suggestedMode`; existing-worktree picker (over `ctx.worktrees`); inline "not a git repo" state when `repoRoot === null` (only current-tree offered — findings risk 3). |
| `src/renderer/src/components/TerminalPane.vue` | Branch label in the header next to the title for worktree sessions, same `max-w-… truncate` idiom + `:title` tooltip. |
| `src/shared/ipc.test.ts` | Schema cases: the three modes; `worktree_id` present/absent paths; `launchContextResponseSchema` accepts a null `repoRoot`; `sessionInfoSchema`/`attachResponseSchema` require `branch` (nullable). Plus a pure `suggestMode` helper test if factored (recommended). |

Nothing else. If a change seems to require another file, raise it.

## Non-Goals

- **No read-only mode** (D22 — deferred to Phase 3).
- **Main never silently overrides the chosen mode** — it computes the *suggestion* and *validates* the choice; if validation fails (e.g. existing-worktree with a stale/unattachable id, or new-worktree in a non-git cwd) it returns `{ok:false, reason}` inline, never a silent fallback.
- **No cleanup / removal / retained-worktree panel** — that is 2-3. 2-2 creates and attaches worktrees; it never removes one.
- **No `git worktree remove`, no prune, no branch deletion, no auto-merge.**
- **No `--force`.**
- **No new restart driver** (D25/F14 — the existing restart path is untouched).
- **No SessionManager enumerator** — live-session counting iterates the project's session rows and calls `isRunning`.
- **Do not revert, stage, or commit unrelated or untracked files, including `_verify/` and anything under `docs/`.**

## Dependencies

- Task 2-1 landed: `git.ts`, `worktrees.ts` (`createWorktree`, `resolveRepoRoot`, `list`), the `worktrees` table, `sessions.worktree_id`, transactional storage ops.
- No new npm dependencies.

## Step-by-step Work

1. **Schemas** (`ipc.ts`): add `workspaceModeSchema` and `pickableWorktreeSchema`; grow `launchRequestSchema` and `launchContextResponseSchema`; add `branch` (required-nullable) to `sessionInfoSchema` and `attachResponseSchema`.
2. **launch-context handler**: make it `async`; `repoRoot = await git.resolveRepoRoot(p.rootPath)`; if null → `suggestedMode='current-tree'`, `liveSessionsInRepo=0`, `worktrees=[]`; else count live same-repo sessions and set `suggestedMode = liveSessionsInRepo >= 1 ? 'new-worktree' : 'current-tree'` (D26f); list pickable worktrees (`detached`, or `active` with no live owning session).
3. **launch handler**: keep the existing cwd security boundary and pane cap for current-tree; branch on `workspace_mode`. Wire the new-worktree DB-first sequence and the existing-worktree re-own path per the spec. Populate `branch` on every returned attach shape and on `layout:get` rows.
4. **Branch on `layout:get`**: the handler maps session rows → `SessionInfo`; resolve each row's `worktree_id` → `worktrees.branch` (or null). Keep it a single pass.
5. **LaunchDialog**: render the mode selector, default to `suggestedMode`, show the picker for existing-worktree, and the "not a git repo" inline state. Thread `workspace_mode` (+ `worktree_id` when existing) into the launch payload.
6. **TerminalPane**: render the branch label when present.
7. **Tests** per Test Expectations.

## Test Expectations

- **Unit (Vitest), `src/shared/ipc.test.ts`:** `launchRequestSchema` accepts all three modes; accepts `existing-worktree` with a uuid `worktree_id` and (schema-level) without one (main enforces the requirement); `launchContextResponseSchema` accepts `repoRoot:null` with `suggestedMode:'current-tree'` and a populated `worktrees` array; `sessionInfoSchema`/`attachResponseSchema` reject a missing `branch` and accept `branch:null`.
- **Pure helper (recommended):** factor `suggestMode(repoRoot, liveSessionsInRepo)` (or similar) into a testable function — unit-test: null repo → current-tree; 0 live → current-tree; ≥1 live → new-worktree.
- The mode selection, worktree creation, and re-attach are **runtime-verified** (G2).

## Verification Commands

Run from repo root (PowerShell):

```
npm run typecheck
npx vitest run
npm run dev
```

After launching two agents in the same repo and cross-checking:

```
git -C "<repo-root>" worktree list
sqlite3 "$env:APPDATA\chorus\chorus.db" "SELECT id, session_id, path, branch, base_branch, repo_root, status FROM worktrees;"
sqlite3 "$env:APPDATA\chorus\chorus.db" "SELECT id, agent, cwd, worktree_id FROM sessions ORDER BY created_at DESC LIMIT 4;"
```

## Acceptance Criteria

- [ ] `npm run typecheck` — zero errors (G1).
- [ ] `npx vitest run` — green (existing + new schema/helper cases).
- [ ] Launching a **lone** agent in a git repo defaults to **current tree**; launching a **second** agent whose cwd resolves to the same repo root **defaults to new isolated worktree** (D22/D26f).
- [ ] A non-git cwd shows the inline **"not a git repo"** state and offers **only** current-tree (findings risk 3).
- [ ] A new-worktree launch creates `<repo-parent>\.chorus\<repo-name>\wt-<shortId>` on branch `chorus/<repo-name>/<shortId>`, DB-first journaled (`creating`→`provisioning`→`active`), with `worktrees.session_id` **and** `sessions.worktree_id` written **transactionally** (resolution a); `git worktree list` shows the linked worktree; the agent's cwd is the worktree path.
- [ ] The **existing-worktree** picker re-attaches a retained/active-unowned worktree (re-owns it, spawns with cwd = its path); an unattachable/stale id returns `{ok:false}` inline (no silent override).
- [ ] The pane header shows the **branch label** for worktree sessions; current-tree sessions show none.
- [ ] The chosen mode always travels **explicitly** in the launch payload; main never silently substitutes a mode.
- [ ] One narrated commit for this session (G3), touching only Exact Scope files.

## Review Checklist

- [ ] All Zod in **main**; `launch`/`launch-context` FK-check `project_id`; responses outbound-parsed; preload/renderer Zod-free (D1, CSP).
- [ ] `branch` is **required-nullable** (not `.optional()`) on both `sessionInfoSchema` and `attachResponseSchema` — the 1b-1 title precedent; a producer that forgets it fails the outbound parse.
- [ ] `workspace_mode` is authoritative; `worktree_id` requiredness for existing-worktree is enforced in main, not via schema branching.
- [ ] New-worktree activation writes both pointer columns in one transaction (resolution a); the session row's cwd becomes the worktree path (so restore relaunches into it — and cwd-missing healing still converges if the worktree later vanishes).
- [ ] Live-session-in-repo counting iterates the project's session rows and calls `isRunning` — no SessionManager API growth; excludes exited rows.
- [ ] DB-first journaling and the D23/D26h path/branch derivation come from `worktrees.ts` (2-1) — 2-2 does not re-implement them.
- [ ] No removal/prune/branch-deletion/`--force`/auto-merge anywhere; no restart-driver change (D25).
- [ ] No untracked / `_verify/` / `docs/` files staged or reverted.
