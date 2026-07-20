# Task 2-1 — Git Adapter, Worktrees Data Layer, Reconcile Engine (+ F15 chore)

_First task of Phase 2 (Foundation). Windows-only. Everything downstream (2-2/2-3/2-4) consumes what this task builds. This task governs scope; `ImplementationSpec-2-1.md` governs exact contents._

## Source Of Truth

- `CLAUDE.md` (locked rules: sessions in main; all Zod in main; D14 plain payloads; **verify git flags against `git worktree -h` / `git status -h` at execution time — D4**; ask before new deps — there are none here).
- Roadmap `docs/Features/Foundation/roadmap.md` §6: **D23/D26h** (location + branch convention), **D24** (F15 chore), **D26** (lifecycle contract + resolutions a–h — especially (a) transactional pointers, (b) evidence-first classification, (c) adoption born detached, (d) vacuous alive-branch, (e) `removing` crash rule).
- Council findings `CouncilBriefs/CouncilBrief-2.0-Findings.md` — action items 1/2/3/6/9/10; Q2 (DB-first journaling), Q3 (five-population reconcile), risks 2/3/4. **D26 (a)–(h) patch these where they conflict.**
- `docs/PLAN.md` §13 (`worktrees` table shape).
- Style precedent: `restore.ts::computeRestoreSet` is the pattern for the pure reconcile core (Electron-free, structurally typed, exhaustively unit-tested).

## Initial Starting Point

**Verified 2026-07-20 against commit `59e7909`** (Phase 1b complete; `npm run typecheck` exits 0; `npx vitest run` = 84/84 across 6 files).

- **Nothing git-aware exists anywhere in `src/`** — no git service, no `worktrees` table, no workspace-mode concept. `launchRequestSchema` is `{project_id, agent, cwd}`.
- **`MIGRATIONS`** in `storage.ts` has **3 entries** (v1 base tables, v2 `sessions`, v3 `title`). The migration engine is a hand-rolled `MIGRATIONS` array + a `schema_migrations` runner (`migrate()` applies `applied+1 … MIGRATIONS.length` inside a transaction). Drizzle is typed queries only (D7).
- ~~**SQLite foreign keys are NOT enabled** (no `PRAGMA foreign_keys`) — `REFERENCES` clauses are **documentation**~~ — **INCORRECT; corrected 2026-07-20 (F16).** better-sqlite3 12.11.1 sets `PRAGMA foreign_keys=ON` on every connection, so `REFERENCES` clauses are **enforced** (inserts must reference existing rows; deleting a referenced parent throws — RESTRICT). Existence checks still live in code (the `requireProject` pattern in `ipc.ts`) because FKs constrain existence only, not liveness/attachability.
- **Boot sequence** (`src/main/index.ts`, inside `app.whenReady().then(() => {...})`): storage init → active-project resolution → `registerIpc(sessions, storage)` → `watchSessionExits(sessions)` + the D11 `sessions.onExit` status-writer → `void sessions.restore(project.id)` (**not awaited**) → `createWindow()`. The callback is currently **not `async`**.
- **`restore()`** validates `fs.existsSync(row.cwd)` per spawn and heals missing-cwd rows to `exited` with the pane's "Working directory not found" chrome. A session whose cwd was a vanished worktree already converges — reconcile must not fight this.
- **`SessionManager`** exposes `isRunning(sessionId)`, `restore(projectId)`, `bindStorage(storage)`. It does **not** expose a live-session enumerator (2-1 does not need one; 2-2 will use `isRunning`).
- **`main.css`** carries the F15 unlayered reset (`*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0 }`) after `@import 'tailwindcss'`.
- The dev DB at `%APPDATA%\chorus\chorus.db` has 3 applied migrations, a second project `Chorus-Second`, and `view_state:` rows — **legitimate; do not clean up**.

## Goal

Build the foundation every later Phase-2 task stands on, with **zero user-visible change except the F15 chore**: a controlled git process adapter (`git.ts`), a `worktrees` data layer (migration v4 + Drizzle defs + storage accessors), a `GitWorktreeManager` with DB-first journaled creation and Windows-safe removal sequencing, and a **pure, exhaustively-tested reconcile core** (`computeWorktreeReconcile`) plus its manager wrapper, awaited at boot **before** session restore. The reconcile is **inert on an empty `worktrees` table** (the case on every existing DB until 2-2 creates the first worktree). No IPC, no UI, no launch-flow changes.

## Exact Scope

Touch **only** these files:

| File | Change |
|---|---|
| `src/main/services/git.ts` | **New.** Controlled git adapter over promisified `execFile` from `node:child_process` — never a shell, never string-concatenated commands; explicit `cwd` per call; a sane timeout; stdout/stderr capture; typed results. Functions: `resolveRepoRoot(cwd)`, `listWorktrees(repoRoot)` (parse `git worktree list --porcelain`), `worktreeAdd(repoRoot, path, branch, baseBranch)`, `worktreeRemove(repoRoot, path, force = false)` (**`--force` only via the D26(i)-gated flag; nothing in 2-1 sets it**), `worktreePrune(repoRoot)`, `statusPorcelain(worktreePath)`, `currentBranch(repoRoot)`, `aheadBehind(repoRoot, branch, baseBranch)`. |
| `src/main/services/worktrees.ts` | **New.** `GitWorktreeManager` (createWorktree DB-first journal, removeWorktree, isClean, getDirtyFiles, list, reconcileAll) + the **pure** `computeWorktreeReconcile(...)` core in `computeRestoreSet` style (Electron-free, structurally typed). Path/branch derivation helpers (`worktreeRootFor`, `worktreePathFor`, `branchFor`, `shortIdFrom`). |
| `src/main/db/schema.ts` | **Edit.** New `worktrees` Drizzle table (per PLAN §13 / findings action 1) + `worktreeId: text('worktree_id')` (nullable) on the `sessions` table. Export `WorktreeRow` / `NewWorktreeRow`. |
| `src/main/services/storage.ts` | **Edit.** Migration v4 (4th `MIGRATIONS` entry — runner untouched): `CREATE TABLE worktrees (...)` + `ALTER TABLE sessions ADD COLUMN worktree_id TEXT;`. Accessors: `createWorktreeRow`, `getWorktreesForProject`, `getAllWorktrees`, `getWorktreeById`, `updateWorktreeStatus`, `activateWorktreeForSession` (transactional — resolution a), `detachWorktree` (transactional — resolution a), `deleteWorktreeRow`. |
| `src/main/index.ts` | **Edit.** Construct a `GitWorktreeManager` after storage init; make the `whenReady` callback `async` and **`await` the reconcile (all repos in the worktrees table) after storage init, BEFORE `void sessions.restore(...)`** (D26 Q3, findings risk 4). |
| `src/renderer/src/assets/main.css` | **Edit — F15 CHORE, SEPARATE FIRST COMMIT (D24).** Remove the unlayered `*, *::before, *::after` reset (or move it into an `@layer`); Tailwind preflight already resets. |
| `src/main/services/worktrees.test.ts` | **New.** Vitest over `computeWorktreeReconcile`: all five populations, the (b)/(c)/(d)/(e) resolution cases, idempotency (run twice → same end state), crash-simulation at each creation seam, and the path/branch derivation helpers. |

Nothing else. **No IPC changes, no UI changes, no launch-flow changes.** If a change seems to require another file, raise it.

## Non-Goals

- **No IPC channels, no preload forwarders, no renderer components.** Those are 2-2/2-3/2-4. `git.ts` and `worktrees.ts` are pure main-process modules with no `ipcMain` registration in this task.
- **No launch-flow change.** `session:launch` is untouched; no worktree is ever created in 2-1 (the reconcile only heals existing rows, of which there are none on current DBs).
- **No auto-merge, ever.**
- **No un-gated `--force`** — `worktreeRemove` carries a `force` flag whose ONLY legal caller is 2-3's typed-confirmation dirty-removal path (D26 clause 7 as amended by D26(i)); **nothing in 2-1 passes `force: true`**.
- **No automatic `git worktree prune` at boot** — prune is only ever surfaced as a user-confirmed action (2-3). Reconcile never prunes on its own (D26 Q3).
- **No branch deletion** in 2-1.
- **No settings screen** (none exists; not this phase).
- **No SessionManager API growth** — reconcile is headless and needs neither the window nor a live-session enumerator.
- **Migration runner untouched** — only a 4th array entry is added.
- **Do not revert, stage, or commit unrelated or untracked files, including `_verify/` and anything under `docs/`.**

## Dependencies

- Phase 1b landed (`59e7909`); git 2.50.0.windows.1 on the dev machine; `git worktree list` works.
- No new npm dependencies (git via `node:child_process`).

## Step-by-step Work

0. **F15 chore, FIRST and SEPARATE (D24).** Edit `main.css` — remove the unlayered reset (or wrap it in `@layer base`). Verify the app renders with restored margins/paddings (G2). **Commit this alone** with a chore-style message (precedent: `de98679`). Everything below is the second commit.
1. **`git.ts` adapter.** Implement a single private `runGit(repoRoot, args, {timeoutMs})` over `promisify(execFile)('git', args, {cwd, timeout, windowsHide, maxBuffer})`. Never build a shell string; arguments are always an array. Capture `{stdout, stderr, code}`; map non-zero exits to a typed error carrying stderr. Build the named functions on top of it. **Re-verify every flag against `git worktree -h` / `git status -h` at execution (D4).**
2. **Derivation helpers** in `worktrees.ts`: `shortIdFrom(uuid)` = first 8 hex chars (`uuid.replace(/-/g,'').slice(0,8)`); `worktreeRootFor(repoRoot)` = `<dirname(repoRoot)>\.chorus\<basename(repoRoot)>`; `worktreePathFor(repoRoot, shortId)` = `<root>\wt-<shortId>`; `branchFor(repoRoot, shortId)` = `chorus/<basename(repoRoot)>/<shortId>` (D23/D26h).
3. **Schema + migration v4.** Add the `worktrees` Drizzle table and `sessions.worktreeId`; append the v4 DDL string to `MIGRATIONS` (matching the Drizzle column names/types exactly, as the header comment already requires). Runner untouched.
4. **Storage accessors.** Add the CRUD + the two transactional ops (`activateWorktreeForSession`, `detachWorktree`) using `this.d.transaction(...)` (better-sqlite3 is synchronous). `getAllWorktrees` powers the boot reconcile; `getWorktreesForProject` powers the 2-3 panel.
5. **`GitWorktreeManager`.** `createWorktree(sessionId, repoRoot, baseBranch)` — DB-first journal (`creating` row → mkdir → `git worktree add` → `provisioning`), retry with a fresh short id on `git worktree add` collision (D23). `removeWorktree`, `isClean`, `getDirtyFiles`, `list`. Removal sequences **after** the owning session's process tree has exited and **never** uses `--force` (see the spec for clean-vs-dirty mechanics).
6. **Pure reconcile core.** `computeWorktreeReconcile(rows, gitEntries, managedDirs, sessionRowIds)` → typed actions, per the evidence matrix in the spec (the single normative table). `reconcileAll()` wraps it: enumerate distinct repo roots from `getAllWorktrees()`, run `listWorktrees` + scan the managed root per repo, call the pure core, apply non-destructive actions, log surfaced populations. Idempotent.
7. **Boot wiring.** In `index.ts`, construct the manager, make the callback `async`, `await worktrees.reconcileAll()` after storage init and **before** `void sessions.restore(project.id)`.
8. **Tests.** `worktrees.test.ts` per the Test Expectations below.

## Test Expectations

- **Unit (Vitest), `src/main/services/worktrees.test.ts`:**
  - `computeWorktreeReconcile` over each of the five populations (1: healthy; 2: row+entry, dir gone; 3: row, no entry; 4: entry, no row; 5: dir, no entry, no row) returns the matrix-specified action.
  - Resolution cases: **(b)** a `creating`/`provisioning` row with entry+dir promotes to `active` (session row present) and to `detached` (session row absent); **(c)** a population-4 adoption action is `detached`, never `active`; **(d)** a population-2 row surfaces as a prune candidate (no "still alive" branch); **(e)** a `removing` row with nothing left → delete row, with anything remaining → detached+surface.
  - **Idempotency:** feeding the post-action state back through the core yields only no-op/`none` actions.
  - **Crash-simulation seams:** `creating` row, no entry, no dir → delete row; `provisioning` row, dir present, no entry → surface orphan directory + detach (never delete the dir).
  - **Derivation helpers:** `shortIdFrom`, `worktreePathFor`, `branchFor` produce the D23/D26h strings for known inputs.
- The git adapter and the manager's live filesystem/git effects are **runtime-verified** (G2), not unit-tested (they spawn real `git`).

## Verification Commands

Run from repo root `C:\Projects\ContactEstablished\Chorus` (PowerShell):

```
npm run typecheck
npx vitest run
git --version
git worktree -h
git status -h
npm run dev
```

Confirm migration v4 applied and the table exists (sqlite3 on PATH, else use the harness `ELECTRON_RUN_AS_NODE` better-sqlite3 dump script — retry once if it produces no file):

```
sqlite3 "$env:APPDATA\chorus\chorus.db" "SELECT version FROM schema_migrations ORDER BY version;"
sqlite3 "$env:APPDATA\chorus\chorus.db" ".schema worktrees"
sqlite3 "$env:APPDATA\chorus\chorus.db" "PRAGMA table_info(sessions);"
```

Cross-check no worktrees were created by boot (reconcile is inert on an empty table):

```
git worktree list
sqlite3 "$env:APPDATA\chorus\chorus.db" "SELECT count(*) FROM worktrees;"
```

## Acceptance Criteria

- [ ] **F15 chore landed as its own commit first** (D24); the app renders with restored margins/paddings (a visible G2 check — e.g. LaunchDialog `p-5`, palette `pt-24`).
- [ ] `npm run typecheck` — zero errors (G1).
- [ ] `npx vitest run` — green, including the new `worktrees.test.ts` (all five populations + (b)/(c)/(d)/(e) + idempotency + crash seams + derivation helpers).
- [ ] Migration v4 applies in place on the existing dev DB (3 → 4) with zero manual steps and zero data loss; `worktrees` exists with the full column set; `sessions.worktree_id` exists.
- [ ] `git.ts` uses `execFile` with argument arrays only — **no shell, no string concatenation** — and `worktreeRemove` emits `--force` only when its `force` flag is set; **`force: true` has zero callers in 2-1** (grep-verifiable).
- [ ] Boot **awaits** `reconcileAll()` before `void sessions.restore(...)`; on the current (empty-worktrees) DB the reconcile is a **no-op** (zero worktrees created, `git worktree list` unchanged, no spurious heals of session rows).
- [ ] Reconcile never runs `git worktree prune` automatically.
- [ ] One narrated commit for the task (G3), plus the separate F15 chore commit — both touching only Exact Scope files.

## Review Checklist

- [ ] `git.ts`: promisified `execFile`, explicit `cwd`, timeout, `windowsHide`, `maxBuffer`; typed non-zero-exit error carrying stderr; `--force` only behind `worktreeRemove`'s flag, with zero `force: true` callers in this task.
- [ ] All flags re-verified against `git worktree -h` / `git status -h` at execution (D4) — note the verification in the commit.
- [ ] `computeWorktreeReconcile` is pure: no Electron, no fs, no DB, no git — structurally typed like `computeRestoreSet`. All effects live in the manager wrapper.
- [ ] Migration v4 DDL matches the Drizzle definitions exactly (column names, types, nullability); `REFERENCES` clauses are **enforced** (F16 — FKs are ON by driver default), with liveness/attachability additionally enforced in code.
- [ ] `activateWorktreeForSession` and `detachWorktree` write both pointer columns in **one** `this.d.transaction(...)` (resolution a).
- [ ] Reconcile runs **before** restore (awaited); it does not double-heal session rows (it touches only `worktrees` rows; `restore()` still owns cwd healing of `sessions`).
- [ ] Reconcile is idempotent and never auto-prunes / never auto-deletes an orphan directory (populations 2 and 5 are surfaced, not destroyed).
- [ ] DB-first journaling: the `worktrees` row is inserted `creating` **before** any fs/git op; `active` only after success; the path derives deterministically from the worktree UUID.
- [ ] No IPC/preload/renderer/launch changes in this task; SessionManager API unchanged.
- [ ] No untracked / `_verify/` / `docs/` files staged or reverted.
