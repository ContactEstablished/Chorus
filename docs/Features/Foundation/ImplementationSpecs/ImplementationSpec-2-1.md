# Implementation Spec 2-1 — Git Adapter, Worktrees Data Layer, Reconcile Engine (+ F15 chore)

_Deep spec for Task 2-1. Read `Task-2-1.md` first. Insertion points are anchored to **named symbols**, never line numbers. All git flags are cited from git 2.50.0.windows.1's own `-h` and **must be re-verified at execution (D4)**._

## 1. The contract (D23/D26)

> A worktree is DB-first journaled: a `worktrees` row is inserted `status='creating'` before any filesystem or git operation; its path is deterministic from the worktree UUID; `git worktree add` follows; the row is promoted to `active` only after success. Boot reconcile runs **before** session restore, classifying every combination of `worktrees` row × `git worktree list --porcelain` entry × filesystem directory across five populations, applying keep/heal/promote/surface/delete rules; it never auto-prunes, never `--force`, and is idempotent. All destructive intent is deferred to later tasks — 2-1 heals and adopts, never destroys user work.

**Worktree identity & derivation (D23/D26h).** The short id is the first 8 hex chars of the worktree row UUID (**not** the session id — worktrees outlive sessions). Given `repoRoot`:

```
shortIdFrom(uuid)        = uuid.replace(/-/g, '').slice(0, 8)
worktreeRootFor(repoRoot)= join(dirname(repoRoot), '.chorus', basename(repoRoot))
worktreePathFor(root, id)= join(worktreeRootFor(root), `wt-${id}`)
branchFor(repoRoot, id)  = `chorus/${basename(repoRoot)}/${id}`
```

e.g. `repoRoot = C:\Source\Bryk`, short id `a1b2c3d4` → path `C:\Source\.chorus\Bryk\wt-a1b2c3d4`, branch `chorus/Bryk/a1b2c3d4`.

## 2. F15 chore (`src/renderer/src/assets/main.css`) — FIRST, SEPARATE COMMIT (D24)

Current head of the file:

```css
@import 'tailwindcss';

*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}
```

Unlayered rules beat every `@layer` rule, so this nullifies **all** Tailwind margin/padding utilities app-wide. **Fix:** delete the reset (Tailwind v4 preflight already sets `box-sizing: border-box` and zeroes margins). If a belt-and-braces reset is wanted, wrap it in `@layer base { … }` so utilities win — but the plain deletion is preferred and sufficient.

```css
@import 'tailwindcss';

html,
body,
#app {
  height: 100%;
  overflow: hidden;
  background: #1e1e1e;
}
```

**Commit this alone** (chore style, precedent `de98679`) and verify at runtime (G2) that `LaunchDialog`'s `p-5`/`mt-3` and the palette's `pt-24` now render with real spacing. Everything below is the second, task commit.

## 3. The git adapter (`src/main/services/git.ts`, new)

A single private runner; every public function is a thin typed wrapper. **Never a shell, never a concatenated command string** — arguments are always an array.

```ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const pExecFile = promisify(execFile)

const GIT_TIMEOUT_MS = 15_000

export class GitError extends Error {
  constructor(readonly args: string[], readonly code: number | null, readonly stderr: string) {
    super(`git ${args.join(' ')} failed (${code}): ${stderr.trim()}`)
  }
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await pExecFile('git', args, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024
    })
    return stdout
  } catch (err) {
    const e = err as { code?: number; stderr?: string }
    throw new GitError(args, e.code ?? null, e.stderr ?? String(err))
  }
}
```

**Public functions** (flags per `git worktree -h` / `git status -h`, git 2.50 — re-verify D4):

```ts
/** git rev-parse --show-toplevel; null when cwd is not inside a repo (findings
 *  risk 3 — a non-git cwd is normal, never an error). */
export async function resolveRepoRoot(cwd: string): Promise<string | null> {
  try {
    const out = await runGit(cwd, ['rev-parse', '--show-toplevel'])
    return out.trim() || null
  } catch {
    return null // "fatal: not a git repository" — expected, not exceptional
  }
}

export interface GitWorktreeEntry {
  path: string
  branch: string | null   // 'refs/heads/x' → 'x'; null when detached/bare
  head: string | null
  detached: boolean
  bare: boolean
}

/** Parse `git worktree list --porcelain`: blank-line-separated records of
 *  `worktree <path>` / `HEAD <sha>` / `branch <ref>` | `detached` | `bare`. */
export async function listWorktrees(repoRoot: string): Promise<GitWorktreeEntry[]> {
  const out = await runGit(repoRoot, ['worktree', 'list', '--porcelain'])
  return parseWorktreePorcelain(out) // pure; exported for unit test
}

/** git worktree add -b <branch> <path> <base>. Never passes -f/--force. */
export async function worktreeAdd(
  repoRoot: string, path: string, branch: string, baseBranch: string
): Promise<void> {
  await runGit(repoRoot, ['worktree', 'add', '-b', branch, path, baseBranch])
}

/** git worktree remove [--force] <path>. `force: true` is legal ONLY on the
 *  confirmed dirty-removal path (D26 clause 7 AS AMENDED by D26(i)) — every
 *  other caller passes false. Without force, git refusing a dirty tree throws
 *  (GitError) — that refusal is the normal, expected path. */
export async function worktreeRemove(repoRoot: string, path: string, force = false): Promise<void> {
  await runGit(repoRoot, ['worktree', 'remove', ...(force ? ['--force'] : []), path])
}

/** git worktree prune — only ever called after explicit user confirmation (2-3). */
export async function worktreePrune(repoRoot: string): Promise<void> {
  await runGit(repoRoot, ['worktree', 'prune'])
}

/** git status --porcelain (v1). Empty output ⇒ clean (D26 Q4). */
export async function statusPorcelain(worktreePath: string): Promise<string[]> {
  const out = await runGit(worktreePath, ['status', '--porcelain'])
  return out.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.length > 0)
}

/** git rev-parse --abbrev-ref HEAD → the base branch for a new worktree. */
export async function currentBranch(repoRoot: string): Promise<string> {
  return (await runGit(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
}

/** git rev-list --left-right --count <base>...<branch> → { ahead, behind }
 *  (ahead = commits on branch not on base). Cheap; used by 2-3's panel. */
export async function aheadBehind(
  repoRoot: string, branch: string, baseBranch: string
): Promise<{ ahead: number; behind: number }> {
  const out = await runGit(repoRoot, ['rev-list', '--left-right', '--count', `${baseBranch}...${branch}`])
  const [behind, ahead] = out.trim().split(/\s+/).map(Number)
  return { ahead: ahead || 0, behind: behind || 0 }
}
```

**Invariant (clause 7 as amended — D26(i)):** `worktreeRemove` is the ONLY function that may emit `--force`, and only when its caller has passed main's typed-confirmation gate (2-3's `worktree:remove` handler). Nothing in 2-1 calls it with `force: true` — the flag ships dormant; `worktreeRemove` without force refusing a dirty tree is the normal path.

## 4. Schema + migration v4 (`src/main/db/schema.ts`, `src/main/services/storage.ts`)

**Drizzle table** (per PLAN §13 / findings action 1).

> **⚠ CORRECTED 2026-07-20 (F16).** This spec originally stated "`REFERENCES` clauses are documentation (FKs off — no `PRAGMA foreign_keys`)". **That was wrong.** better-sqlite3 12.11.1 sets `PRAGMA foreign_keys=ON` on every connection (coordinator-verified: a fresh connection's pragma reads `1`; an insert with a fabricated FK throws `SQLITE_CONSTRAINT_FOREIGNKEY`; **and deleting a referenced parent row also throws** — default RESTRICT). The `REFERENCES` clauses below are **enforced constraints**. Attachability/liveness checks still live in code, because FKs constrain existence only.

```ts
export const worktrees = sqliteTable('worktrees', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  // Nullable, NO cascade (docs only): a detached worktree has session_id = NULL
  // and survives the owning session's deletion (D26 Q1).
  sessionId: text('session_id').references(() => sessions.id),
  path: text('path').notNull().unique(),
  branch: text('branch').notNull(),
  baseBranch: text('base_branch').notNull(),
  repoRoot: text('repo_root').notNull(),
  // 'creating' | 'provisioning' | 'active' | 'detached' | 'removing'
  status: text('status').notNull(),
  createdAt: text('created_at').notNull()
})
export type WorktreeRow = typeof worktrees.$inferSelect
export type NewWorktreeRow = typeof worktrees.$inferInsert
```

Add the pointer column to `sessions` (after `title`, before `createdAt`):

```ts
  worktreeId: text('worktree_id'), // nullable; set when a session owns a worktree (D26 Q1/(a))
```

**Migration v4** — append a **4th** string to the `MIGRATIONS` array (runner untouched; `migrate()` applies `applied+1 … MIGRATIONS.length`). DDL must match the Drizzle names/types exactly:

```ts
  // v4 (Phase 2 / D26 action 1): worktrees table + sessions.worktree_id.
  `CREATE TABLE worktrees (
     id          TEXT PRIMARY KEY,
     project_id  TEXT NOT NULL REFERENCES projects(id),
     session_id  TEXT REFERENCES sessions(id),
     path        TEXT NOT NULL UNIQUE,
     branch      TEXT NOT NULL,
     base_branch TEXT NOT NULL,
     repo_root   TEXT NOT NULL,
     status      TEXT NOT NULL,
     created_at  TEXT NOT NULL
   );
   ALTER TABLE sessions ADD COLUMN worktree_id TEXT;`
```

The runner execs the whole string in one transaction, so both statements apply atomically and record version 4.

**Storage accessors** (Drizzle typed queries; `this.d` is the drizzle handle). The two pointer-writing ops are transactional per resolution (a):

```ts
createWorktreeRow(row: NewWorktreeRow): WorktreeRow { this.d.insert(worktrees).values(row).run(); return { ...row, sessionId: row.sessionId ?? null } as WorktreeRow }

getWorktreesForProject(projectId: string): WorktreeRow[] {
  return this.d.select().from(worktrees).where(eq(worktrees.projectId, projectId)).orderBy(asc(worktrees.createdAt)).all()
}
getAllWorktrees(): WorktreeRow[] { return this.d.select().from(worktrees).all() } // boot reconcile
getWorktreeById(id: string): WorktreeRow | null { return this.d.select().from(worktrees).where(eq(worktrees.id, id)).get() ?? null }
updateWorktreeStatus(id: string, status: string): void { this.d.update(worktrees).set({ status }).where(eq(worktrees.id, id)).run() }

/** Resolution (a): both pointers + status='active' + session cwd → worktree path,
 *  in ONE synchronous transaction. Called by 2-2's new-worktree launch. */
activateWorktreeForSession(worktreeId: string, sessionId: string, worktreePath: string): void {
  this.d.transaction((tx) => {
    tx.update(worktrees).set({ sessionId, status: 'active' }).where(eq(worktrees.id, worktreeId)).run()
    tx.update(sessions).set({ worktreeId, cwd: worktreePath }).where(eq(sessions.id, sessionId)).run()
  })
}

/** Resolution (a): clear both pointers + status='detached', one transaction.
 *  Called by 2-3's close flow / session:delete. */
detachWorktree(worktreeId: string): void {
  this.d.transaction((tx) => {
    const wt = tx.select().from(worktrees).where(eq(worktrees.id, worktreeId)).get()
    tx.update(worktrees).set({ sessionId: null, status: 'detached' }).where(eq(worktrees.id, worktreeId)).run()
    if (wt?.sessionId) tx.update(sessions).set({ worktreeId: null }).where(eq(sessions.id, wt.sessionId)).run()
  })
}

deleteWorktreeRow(id: string): void { this.d.delete(worktrees).where(eq(worktrees.id, id)).run() }
```

`activateWorktreeForSession` / `detachWorktree` are defined in 2-1 (the data layer) even though their first callers land in 2-2/2-3 — this keeps the transactional invariant (resolution a) in one place.

## 5. `GitWorktreeManager` (`src/main/services/worktrees.ts`, new)

Holds `StorageService` + the git adapter. DB-first journaled creation, Windows-safe removal, and the reconcile wrapper.

```ts
export class GitWorktreeManager {
  constructor(private storage: StorageService) {}

  /** DB-first journaled creation (D26 Q2). Retries with a fresh short id on a
   *  `git worktree add` path/branch collision (D23). The session row already
   *  exists (2-2's launch handler creates it); this returns the provisioned
   *  worktree — the caller runs activateWorktreeForSession to go 'active'. */
  async createWorktree(sessionId: string, repoRoot: string, baseBranch: string): Promise<WorktreeRow> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const id = randomUUID()
      const shortId = shortIdFrom(id)
      const path = worktreePathFor(repoRoot, shortId)
      const branch = branchFor(repoRoot, shortId)
      const row = this.storage.createWorktreeRow({
        id, projectId: /* from session row */ …, sessionId, path, branch,
        baseBranch, repoRoot, status: 'creating', createdAt: new Date().toISOString()
      })
      try {
        fs.mkdirSync(worktreeRootFor(repoRoot), { recursive: true }) // parents only, NOT the wt dir
        await worktreeAdd(repoRoot, path, branch, baseBranch)         // git creates wt-<id>
        this.storage.updateWorktreeStatus(id, 'provisioning')
        return { ...row, status: 'provisioning' }
      } catch (err) {
        // git add failed: delete the journal row and retry with a fresh id, UNLESS
        // this was a genuine git failure (not a collision) — then rethrow.
        this.storage.deleteWorktreeRow(id)
        if (!isCollision(err) || attempt === 4) throw err
      }
    }
    throw new Error('worktree add: exhausted collision retries')
  }

  /** Removal sequences AFTER the owning session's process tree has exited
   *  (the caller guarantees the session is not live). Clean → git worktree
   *  remove (no --force). Dirty (post typed-confirmation, decided by the
   *  caller) → filesystem-remove the dir + git worktree prune — NEVER --force.
   *  Retries on Windows lock (EBUSY/EPERM) with backoff (D26 clause 8). */
  async removeWorktree(worktreeId: string, opts: { deleteBranch?: boolean; forceDirty?: boolean }): Promise<void> { … }

  async isClean(worktreePath: string): Promise<boolean> { return (await statusPorcelain(worktreePath)).length === 0 }
  async getDirtyFiles(worktreePath: string): Promise<string[]> { return statusPorcelain(worktreePath) }
  async reconcileAll(): Promise<ReconcileReport> { … } // §7
}
```

**Removal mechanics (RESOLVED at doc review — D26(i), Matthew, 2026-07-20).** **Clean** worktrees go through `git worktree remove <path>` (no force). **Dirty** worktrees, ONLY after main has verified the typed confirmation token (2-3's handler), are removed with a **targeted `git worktree remove --force <path>`** — the ONE code path permitted to pass `--force` under the amended clause 7. git itself validates the path is a registered worktree and removes exactly that one. The drafting-stage workaround (`fs.rm(path, {recursive})` + `git worktree prune`) is **REJECTED**: `prune` is repo-wide and would silently sweep metadata for other vanished-dir worktrees still awaiting their own confirmation in the panel, and bespoke recursive deletion is a worse data-loss surface than git's own validated removal. `removeWorktree(worktreeId, {deleteBranch?, forceDirty?})` maps `forceDirty` straight onto the adapter's `force` flag; nothing in 2-1 sets it.

**Branch deletion (RESOLVED — D26(j)).** When `deleteBranch` is set (opt-in, 2-3), delete via `git branch -d <branch>` (safe: refuses unmerged). If `-d` refuses because the branch is unmerged, surface the refusal; `-D` escalation requires the same typed-confirmation acknowledgment the user gave for a dirty removal (2-3 owns that UX).

## 6. The evidence-matrix reconcile core (`computeWorktreeReconcile`) — THE normative table

Pure, Electron-free, structurally typed (the `computeRestoreSet` pattern). It classifies by **evidence first** (git entry × directory), journal status second (resolution b), and returns typed actions. Populations 4/5 (no row) are discovered by iterating git entries and managed directories.

```ts
export interface WorktreeReconcileRow { id: string; sessionId: string | null; status: string; path: string }
export type WorktreeReconcileAction =
  | { type: 'none'; id: string }
  | { type: 'promote'; id: string; to: 'active' | 'detached' }   // creating/provisioning + evidence (b)
  | { type: 'detach'; id: string; surface: boolean }             // stale/removing-with-remnant (e)
  | { type: 'delete-row'; id: string }                           // no durable evidence
  | { type: 'surface-prune'; id: string }                        // population 2 / 4b (git meta for vanished dir) (d)
  | { type: 'adopt'; path: string; branch: string | null; repoRoot: string } // population 4 → detached (c)
  | { type: 'surface-orphan-dir'; path: string }                 // population 5 — never auto-delete

export function computeWorktreeReconcile(
  rows: WorktreeReconcileRow[],
  gitEntries: GitWorktreeEntry[],   // filtered to under the managed root
  managedDirs: string[],            // directories found under the managed root (fs scan, done by caller)
  sessionRowIds: Set<string>        // session ids that still have a sessions row (for promote target; resolution b)
): WorktreeReconcileAction[]
```

**Normative classification.** Let `hasEntry(path)` = a managed git entry exists for `path`; `hasDir(path)` = `path ∈ managedDirs`. For each **row**:

| # | `row.status` | git entry | dir | Action | Source |
|---|---|:---:|:---:|---|---|
| P1a | `active`/`detached` | ✓ | ✓ | `none` (healthy) | Q3(1) |
| P1b | `creating`/`provisioning` | ✓ | ✓ | `promote` → `active` if `sessionRowIds.has(row.sessionId)` else `detached` | **(b)** — closes the crash gap |
| P1c | `removing` | ✓ | ✓ | `detach` (surface) — a remnant remains | **(e)** |
| P2a | `active`/`detached` | ✓ | ✗ | `surface-prune` (offer `git worktree prune` + delete row, user-confirmed) | Q3(2) + **(d)** |
| P2b | `creating`/`provisioning` | ✓ | ✗ | `surface-prune` (git registered, dir removed by hand) | Q2 + **(b)/(d)** |
| P2c | `removing` | ✓ | ✗ | `detach` (surface) — git entry remains | **(e)** |
| P3a | `active`/`detached` | ✗ | ✓ | `detach` (surface) — dir present, git link lost; never auto-delete the dir | Q3(3) |
| P3b | `active`/`detached` | ✗ | ✗ | `detach` (surface) — stale row, both gone | Q3(3) |
| P3c | `creating`/`provisioning` | ✗ | ✗ | `delete-row` — nothing durable was created | Q3(3) + risk 2 |
| P3d | `creating`/`provisioning` | ✗ | ✓ | `surface-orphan-dir(row.path)` + `detach` — mkdir/agent output survives, git never registered; never auto-delete | risk 2 |
| P3e | `removing` | ✗ | ✗ | `delete-row` — removal completed/crashed, nothing remains | **(e)** |
| P3f | `removing` | ✗ | ✓ | `detach` (surface) — dir remnant remains | **(e)** |

For each **git entry under the managed root with no matching row**:

| # | dir | Action | Source |
|---|:---:|---|---|
| P4 | ✓ | `adopt` (insert row `status='detached'`, `session_id=NULL`; surface "found untracked worktree") | Q3(4) + **(c)** |
| P4b | ✗ | `surface-prune` (git metadata for a vanished dir) | edge of Q3(2) |

For each **managed directory with no git entry and no row**:

| # | Action | Source |
|---|---|---|
| P5 | `surface-orphan-dir(path)` — surface, **never auto-delete** (may be agent output) | Q3(5) |

**Idempotency (invariant):** feeding the post-action state back through the core yields only `none`/`surface-*` actions (the surface-only populations recur because nothing destructive was done to them — that is correct; the "action" is UI-side and requires user confirmation).

**Resolution (d) is baked in:** there is no "session still alive" branch — reconcile runs pre-restore when nothing is live, so P2 collapses to `surface-prune` unconditionally.

## 7. Reconcile wrapper + boot wiring

> **⚠ KNOWN GAP IN THIS SKETCH — F19 (found 2026-07-20, fix assigned to Task 2-3).** The repo enumeration below is **row-derived**: `getAllWorktrees()` grouped by `repoRoot`. A repo with **zero** worktree rows therefore produces zero groups, `listWorktrees` is never called for it, and the pure core never receives the evidence that would trigger **population 4 (`adopt`)** or **population 5 (`surface-orphan-dir`)** — the two populations that exist precisely to discover worktrees Chorus does *not* have rows for. The core handles them correctly; it is simply never invoked. **Proven live:** an untracked worktree + branch on disk with an empty `worktrees` table produced `reconcile: 0 row(s) across 0 repo(s); 0 surfaced` and no adoption. **The fix (Task 2-3):** enumerate candidate repos from the **union** of (a) distinct `repoRoot` values across worktree rows and (b) `resolveRepoRoot(project.rootPath)` for every project, deduped by the `pathKey` normalization (F17); a null repo root just contributes nothing. Task 2-1's implementation followed this sketch faithfully — the defect is the sketch's, not the implementer's.

```ts
async reconcileAll(): Promise<ReconcileReport> {
  const rows = this.storage.getAllWorktrees()
  const byRepo = groupBy(rows, (r) => r.repoRoot)   // ⚠ F19: row-derived — see the note above
  const surfaced: WorktreeReconcileAction[] = []
  for (const [repoRoot, repoRows] of byRepo) {
    const managedRoot = worktreeRootFor(repoRoot)
    const gitEntries = (await listWorktrees(repoRoot)).filter((e) => isUnder(e.path, managedRoot))
    const managedDirs = fs.existsSync(managedRoot)
      ? fs.readdirSync(managedRoot).map((d) => join(managedRoot, d)).filter(isDir)
      : []
    const sessionRowIds = new Set(/* session ids that still exist */ …)
    const actions = computeWorktreeReconcile(repoRows, gitEntries, managedDirs, sessionRowIds)
    for (const a of actions) this.applyReconcileAction(a) // non-destructive only; surface-* collected
  }
  return { surfaced }
}
```

`applyReconcileAction` performs only **non-destructive DB writes**: `promote`→`updateWorktreeStatus`; `detach`→`detachWorktree`; `delete-row`→`deleteWorktreeRow` (only for P3c/P3e — provably nothing durable); `adopt`→`createWorktreeRow(status:'detached', sessionId:null)`. `surface-prune` / `surface-orphan-dir` are **logged and returned in the report, never actioned** (D26 Q3: never auto-prune, never auto-delete a dir). 2-3's `WorktreePanel` **recomputes** surfaceable populations live on open (re-cross-checking `git worktree list` + the managed dir scan), so 2-1 needs no persistent store for transient surface findings — this keeps 2-1 UI-free. **(Flag for coordinator: this "reconcile heals structurally at boot; the panel recomputes orphans/prune-candidates on open" split is a design decision, chosen because 2-1 has no UI and population 5 has no row to persist.)**

**Boot wiring (`src/main/index.ts`).** Construct the manager after `sessions.bindStorage(storage)`; make the `app.whenReady().then(...)` callback `async`; await the reconcile **after** the active-project resolution + `registerIpc` + the exit-listener wiring and **before** `void sessions.restore(project.id)`:

```ts
const worktrees = new GitWorktreeManager(storage)
// … registerIpc, watchSessionExits, sessions.onExit(...) …
await worktrees.reconcileAll()          // D26 Q3 / findings risk 4: BEFORE restore, awaited
void sessions.restore(project.id)
const win = createWindow()
```

**Invariant (no double-heal):** reconcile writes only `worktrees` rows; `restore()` still owns `sessions` cwd healing. A session whose cwd is a vanished worktree gets its worktree row marked `detached`/surfaced by reconcile, and its session row healed to `exited` by restore — two independent, converging paths.

## 8. Invariants recap (2-1)

- The `worktrees` row is inserted `creating` **before** any fs/git op; `active` only after success; the path is deterministic from the worktree UUID (D26 Q2).
- Both pointer columns are written in **one transaction** at activation and cleared in one at detach (resolution a).
- `computeWorktreeReconcile` is pure (no Electron/fs/git/DB); it classifies by evidence first, journal second (resolution b); adoption is `detached` (c); no "alive" branch (d); the `removing` rule is (e).
- Reconcile is idempotent, never auto-prunes, never auto-deletes an orphan directory, and runs **awaited before** restore.
- `git.ts` uses `execFile` with argument arrays only; `--force` exists solely behind `worktreeRemove`'s `force` flag, whose only legal caller is 2-3's typed-confirmation path (D26(i)) — **nothing in 2-1 sets it**; a non-git cwd yields `null`, not an error (findings risk 3).
- Migration v4 is the 4th `MIGRATIONS` entry; the runner is untouched; DDL matches the Drizzle defs; the reconcile is inert on the current empty-worktrees DB.

## 9. Verification (including RUNTIME — G2)

**Static:**
- `npm run typecheck` (G1).
- `npx vitest run` — `worktrees.test.ts`: the pure core over every matrix row (P1a…P5), the (b)/(c)/(d)/(e) cases, idempotency (post-action state → only `none`/`surface-*`), crash seams (P3c delete, P3d surface-orphan), and `shortIdFrom`/`worktreePathFor`/`branchFor`/`parseWorktreePorcelain`.

**Runtime script (drive the real app; CDP where headless; screenshot each step):**
1. **F15 chore first:** boot after the chore commit → confirm restored spacing (LaunchDialog `p-5`, palette `pt-24`) via screenshot. (Separate commit already made.)
2. `npm run dev` on the existing dev DB → boot log shows migration v4 applied (or already-applied on a second run); the app opens normally; existing sessions/projects intact (zero data loss).
3. DB dump: `schema_migrations` has version 4; `.schema worktrees` matches; `PRAGMA table_info(sessions)` shows `worktree_id`.
4. **Reconcile is inert:** `SELECT count(*) FROM worktrees` = 0; `git worktree list` unchanged; no worktree rows created; session rows not spuriously healed (compare `sessions.status` before/after boot).
5. **Manual population probe (harness, no UI needed):** hand-insert a `worktrees` row via the `ELECTRON_RUN_AS_NODE` better-sqlite3 script (retry once if no output file), pointing at a real repo, in each status/evidence combination; run a headless `reconcileAll()` (or reboot); confirm the row lands in the matrix-specified end state and that a second run changes nothing (idempotency). Clean up the probe rows afterward.
6. Confirm **no** `git worktree prune` ran automatically (populations 2/5 are logged in the report, not actioned).
