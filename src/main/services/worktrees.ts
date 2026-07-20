import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { basename, dirname, join, win32 } from 'node:path'
import type { WorktreeRow } from '../db/schema'
import type { StorageService } from './storage'
import {
  GitError,
  listWorktrees,
  statusPorcelain,
  worktreeAdd,
  worktreeRemove,
  type GitWorktreeEntry
} from './git'

/**
 * Worktrees data layer (Task 2-1): path/branch derivation (D23/D26h) and the
 * PURE boot-reconcile core `computeWorktreeReconcile` — no Electron, no fs,
 * no DB, no git, in the `computeRestoreSet` style (structurally typed rows,
 * exhaustively unit-tested). All effects live in GitWorktreeManager (below).
 *
 * The lifecycle contract is D26 (CR-2.0 + coordinator resolutions a–j):
 * DB-first journaled creation, evidence-first classification (git entry ×
 * directory, journal status second — resolution b), adoption born detached
 * (c), no "session alive" branch (d), `removing` re-classified by evidence
 * (e), never auto-prune, never auto-delete an orphan directory, `--force`
 * only behind the adapter's dormant flag (i).
 */

/* ------------------------------------------------------------------------ */
/* Derivation helpers (D23 + D26h): worktrees live OUTSIDE the repo at      */
/* <repo-parent>\.chorus\<repo-name>\wt-<shortId>, branches are             */
/* chorus/<repo-name>/<shortId>, short id = first 8 hex chars of the        */
/* WORKTREE row UUID (not the session id — worktrees outlive sessions).     */
/* ------------------------------------------------------------------------ */

export function shortIdFrom(uuid: string): string {
  return uuid.replace(/-/g, '').slice(0, 8)
}

export function worktreeRootFor(repoRoot: string): string {
  return join(dirname(repoRoot), '.chorus', basename(repoRoot))
}

export function worktreePathFor(repoRoot: string, shortId: string): string {
  return join(worktreeRootFor(repoRoot), `wt-${shortId}`)
}

export function branchFor(repoRoot: string, shortId: string): string {
  return `chorus/${basename(repoRoot)}/${shortId}`
}

/* ------------------------------------------------------------------------ */
/* The pure reconcile core (ImplementationSpec-2-1 §6 — the normative        */
/* evidence matrix).                                                         */
/* ------------------------------------------------------------------------ */

export interface WorktreeReconcileRow {
  id: string
  sessionId: string | null
  status: string
  path: string
}

export type WorktreeReconcileAction =
  | { type: 'none'; id: string }
  | { type: 'promote'; id: string; to: 'active' | 'detached' } // creating/provisioning + evidence (b)
  | { type: 'detach'; id: string; surface: boolean } // stale/removing-with-remnant (e)
  | { type: 'delete-row'; id: string } // no durable evidence
  | { type: 'surface-prune'; id: string } // population 2 / 4b (git meta for vanished dir) (d)
  | { type: 'adopt'; path: string; branch: string | null; repoRoot: string } // population 4 → detached (c)
  | { type: 'surface-orphan-dir'; path: string } // population 5 — never auto-delete

/**
 * Canonical match key for a path. Git reports forward-slash paths
 * (`worktree C:/...`) while rows store join()-produced backslash paths, and
 * Windows paths are case-insensitive — all matching goes through this key.
 * Original-cased strings are preserved in emitted actions. Windows-only app:
 * win32 normalization is correct here, not a portability bug.
 */
function pathKey(p: string): string {
  return win32.normalize(p).toLowerCase()
}

const JOURNAL_STATUSES = new Set(['creating', 'provisioning'])

/**
 * Classify every row / git entry / managed directory into typed actions.
 * Evidence first (git entry × directory), journal status second (b).
 *
 * `repoRoot` is a parameter (the spec sketch elided it) because the `adopt`
 * action must carry it and the pure core cannot derive it — the caller
 * iterates one repo at a time. `gitEntries` and `managedDirs` must already
 * be scoped to this repo's managed root (the caller filters/scans).
 *
 * Idempotency: rows already in their converged state report `none`. In
 * particular an already-`detached` row facing P3 evidence (git link lost)
 * is the identity case of the matrix's detach transition — collapsing it to
 * `none` is what makes "run twice → only none/surface-* actions" exact.
 * Unknown statuses fall into the active/detached branch (conservative:
 * never delete-row, never promote).
 */
export function computeWorktreeReconcile(
  repoRoot: string,
  rows: WorktreeReconcileRow[],
  gitEntries: { path: string; branch: string | null }[],
  managedDirs: string[],
  sessionRowIds: Set<string>
): WorktreeReconcileAction[] {
  const entryByKey = new Map(gitEntries.map((e) => [pathKey(e.path), e]))
  const dirKeys = new Set(managedDirs.map(pathKey))
  const rowKeys = new Set(rows.map((r) => pathKey(r.path)))

  const actions: WorktreeReconcileAction[] = []

  for (const row of rows) {
    const hasEntry = entryByKey.has(pathKey(row.path))
    const hasDir = dirKeys.has(pathKey(row.path))
    const journal = JOURNAL_STATUSES.has(row.status)
    const promoteTarget = (): 'active' | 'detached' =>
      row.sessionId !== null && sessionRowIds.has(row.sessionId) ? 'active' : 'detached'

    if (hasEntry && hasDir) {
      // P1a healthy · P1b journal promote (b) · P1c removing-with-remnant (e)
      if (row.status === 'removing') actions.push({ type: 'detach', id: row.id, surface: true })
      else if (journal) actions.push({ type: 'promote', id: row.id, to: promoteTarget() })
      else actions.push({ type: 'none', id: row.id })
    } else if (hasEntry) {
      // dir gone — P2a/P2b prune candidate (d: no "still alive" branch) · P2c (e)
      if (row.status === 'removing') actions.push({ type: 'detach', id: row.id, surface: true })
      else actions.push({ type: 'surface-prune', id: row.id })
    } else if (hasDir) {
      // no git entry — P3a link lost · P3d orphan dir from a journal row · P3f (e)
      if (row.status === 'removing') actions.push({ type: 'detach', id: row.id, surface: true })
      else if (journal) {
        actions.push({ type: 'surface-orphan-dir', path: row.path })
        actions.push({ type: 'detach', id: row.id, surface: false })
      } else if (row.status === 'detached') actions.push({ type: 'none', id: row.id })
      else actions.push({ type: 'detach', id: row.id, surface: true })
    } else {
      // nothing left — P3b stale · P3c journal never reified · P3e removal done (e)
      if (row.status === 'removing' || journal) actions.push({ type: 'delete-row', id: row.id })
      else if (row.status === 'detached') actions.push({ type: 'none', id: row.id })
      else actions.push({ type: 'detach', id: row.id, surface: true })
    }
  }

  // Population 4: git entries under the managed root with no row.
  for (const entry of gitEntries) {
    if (rowKeys.has(pathKey(entry.path))) continue
    if (dirKeys.has(pathKey(entry.path))) {
      // P4: adopt born DETACHED (c), surfaced as "found untracked worktree".
      actions.push({
        type: 'adopt',
        path: win32.normalize(entry.path),
        branch: entry.branch,
        repoRoot
      })
    } else {
      // P4b: git metadata for a vanished dir, no row — `id` carries the path.
      actions.push({ type: 'surface-prune', id: entry.path })
    }
  }

  // Population 5: managed directories with no git entry and no row — surface,
  // NEVER auto-delete (may be agent output, not workspace debris).
  for (const dir of managedDirs) {
    if (entryByKey.has(pathKey(dir)) || rowKeys.has(pathKey(dir))) continue
    actions.push({ type: 'surface-orphan-dir', path: dir })
  }

  return actions
}

/* ------------------------------------------------------------------------ */
/* GitWorktreeManager — every effect lives here: DB-first journaled          */
/* creation, Windows-safe removal, and the reconcile wrapper that feeds the  */
/* pure core above. Nothing in 2-1 calls createWorktree/removeWorktree —     */
/* their first callers land in 2-2 (launch) and 2-3 (cleanup flows).         */
/* ------------------------------------------------------------------------ */

export interface ReconcileReport {
  /** Findings logged at boot, never actioned: surface-prune /
   *  surface-orphan-dir / surfaced detach / adopt ("found untracked
   *  worktree"). 2-3's panel recomputes surfaceable populations live on
   *  open, so transient findings get no persistent store in 2-1. */
  surfaced: WorktreeReconcileAction[]
}

/** git worktree add refusing because the path or branch already exists —
 *  the D23/D26h retry-with-a-fresh-short-id trigger. */
function isCollision(err: unknown): boolean {
  return err instanceof GitError && /already exists|already used/i.test(err.stderr)
}

/** Windows open-handle constraint (D26 clause 8): a just-killed agent's
 *  ConPTY/CWD handles release asynchronously, so removal retries lock
 *  failures with backoff. git's dirty-tree refusal ("contains modified or
 *  untracked files") deliberately does NOT match — that is not a lock. */
const LOCK_RETRY_DELAYS_MS = [250, 500, 1000]

function isLockFailure(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code
  if (code === 'EBUSY' || code === 'EPERM') return true
  return (
    err instanceof GitError && /busy|being used|permission denied|EBUSY|EPERM/i.test(err.stderr)
  )
}

async function withLockRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (!isLockFailure(err) || attempt >= LOCK_RETRY_DELAYS_MS.length) throw err
      await new Promise((r) => setTimeout(r, LOCK_RETRY_DELAYS_MS[attempt]))
    }
  }
}

/** Direct-child check, separator/case-insensitive (git reports fwd-slash). */
function isUnderManagedRoot(path: string, managedRoot: string): boolean {
  const p = win32.normalize(path).toLowerCase()
  const root = win32.normalize(managedRoot).toLowerCase().replace(/\\+$/, '')
  return p.startsWith(`${root}\\`)
}

export class GitWorktreeManager {
  constructor(private storage: StorageService) {}

  /** DB-first journaled creation (D26 Q2): the `creating` row lands BEFORE
   *  any fs/git op, with the path derived deterministically from the row
   *  UUID; `provisioning` after `git worktree add` succeeds. The caller
   *  (2-2's launch) then runs activateWorktreeForSession to reach 'active'.
   *  Retries with a fresh short id on a `git worktree add` path/branch
   *  collision (D23); a handled failure deletes its own journal row —
   *  reconcile's delete-row rule covers only unobserved crashes. */
  async createWorktree(
    sessionId: string,
    repoRoot: string,
    baseBranch: string
  ): Promise<WorktreeRow> {
    const session = this.storage.getSessionById(sessionId)
    if (!session) throw new Error(`createWorktree: unknown session ${sessionId}`)
    for (let attempt = 0; attempt < 5; attempt++) {
      const id = randomUUID()
      const shortId = shortIdFrom(id)
      const path = worktreePathFor(repoRoot, shortId)
      const branch = branchFor(repoRoot, shortId)
      const row = this.storage.createWorktreeRow({
        id,
        projectId: session.projectId,
        sessionId,
        path,
        branch,
        baseBranch,
        repoRoot,
        status: 'creating',
        createdAt: new Date().toISOString()
      })
      try {
        fs.mkdirSync(worktreeRootFor(repoRoot), { recursive: true }) // parents only, NOT the wt dir
        await worktreeAdd(repoRoot, path, branch, baseBranch) // git creates wt-<id>
        this.storage.updateWorktreeStatus(id, 'provisioning')
        return { ...row, status: 'provisioning' }
      } catch (err) {
        this.storage.deleteWorktreeRow(id)
        if (!isCollision(err) || attempt === 4) throw err
      }
    }
    throw new Error('worktree add: exhausted collision retries')
  }

  /** Removal sequences AFTER the owning session's process tree has exited
   *  (the caller guarantees the session is not live — D26 clause 8). The row
   *  is journaled 'removing' first so a crash mid-removal re-classifies by
   *  evidence at the next boot (resolution e). Clean → `git worktree remove`
   *  (no --force; a dirty refusal propagates as a GitError, the expected
   *  path). `forceDirty` maps straight onto the adapter's dormant force flag
   *  (D26(i)) — its sole legal caller is 2-3's typed-confirmation path, and
   *  NOTHING in 2-1 sets it. Branch deletion is 2-3 scope (D26(j)). */
  async removeWorktree(
    worktreeId: string,
    opts: { deleteBranch?: boolean; forceDirty?: boolean } = {}
  ): Promise<void> {
    if (opts.deleteBranch) {
      throw new Error('removeWorktree: branch deletion is Task 2-3 scope (D26(j))')
    }
    const row = this.storage.getWorktreeById(worktreeId)
    if (!row) return
    this.storage.updateWorktreeStatus(worktreeId, 'removing')
    await withLockRetry(() => worktreeRemove(row.repoRoot, row.path, opts.forceDirty ?? false))
    this.storage.deleteWorktreeRow(worktreeId)
  }

  /** D26 Q4: clean-enough-to-auto-remove ⇔ empty git status --porcelain. */
  async isClean(worktreePath: string): Promise<boolean> {
    return (await statusPorcelain(worktreePath)).length === 0
  }

  /** The dirty file list shown by 2-3's typed-confirmation gate. */
  async getDirtyFiles(worktreePath: string): Promise<string[]> {
    return statusPorcelain(worktreePath)
  }

  /** The 2-3 retained-worktree panel's listing. */
  list(projectId: string): WorktreeRow[] {
    return this.storage.getWorktreesForProject(projectId)
  }

  /** Boot reconcile (D26 Q3, findings risk 4): classify every repo known to
   *  the worktrees table against `git worktree list` + the managed-root scan,
   *  apply only NON-destructive actions, log and return surfaced findings.
   *  Awaited BEFORE session restore; idempotent; never runs git worktree
   *  prune; never deletes a directory. A repo whose git/fs evidence cannot
   *  be read is SKIPPED, not classified on missing evidence. */
  async reconcileAll(): Promise<ReconcileReport> {
    const rows = this.storage.getAllWorktrees()
    const byRepo = new Map<string, WorktreeRow[]>()
    for (const row of rows) {
      const group = byRepo.get(row.repoRoot)
      if (group) group.push(row)
      else byRepo.set(row.repoRoot, [row])
    }

    const surfaced: WorktreeReconcileAction[] = []
    for (const [repoRoot, repoRows] of byRepo) {
      const managedRoot = worktreeRootFor(repoRoot)
      let gitEntries: GitWorktreeEntry[]
      let managedDirs: string[]
      try {
        gitEntries = (await listWorktrees(repoRoot)).filter((e) =>
          isUnderManagedRoot(e.path, managedRoot)
        )
        managedDirs = fs.existsSync(managedRoot)
          ? fs
              .readdirSync(managedRoot, { withFileTypes: true })
              .filter((d) => d.isDirectory())
              .map((d) => join(managedRoot, d.name))
          : []
      } catch (err) {
        console.warn(`[worktrees] reconcile: evidence read failed for ${repoRoot}; skipping`, err)
        continue
      }
      // Resolution (b)'s promote target: session ids whose ROW still stands.
      const sessionRowIds = new Set<string>()
      for (const r of repoRows) {
        if (r.sessionId !== null && this.storage.getSessionById(r.sessionId) !== null) {
          sessionRowIds.add(r.sessionId)
        }
      }
      const actions = computeWorktreeReconcile(repoRoot, repoRows, gitEntries, managedDirs, sessionRowIds)
      for (const a of actions) {
        if (this.applyReconcileAction(a, repoRows[0].projectId)) surfaced.push(a)
      }
    }
    // One summary line per boot: positive evidence the reconcile ran, even
    // when inert on an empty worktrees table.
    console.log(
      `[worktrees] reconcile: ${rows.length} row(s) across ${byRepo.size} repo(s); ${surfaced.length} surfaced`
    )
    return { surfaced }
  }

  /** Applies one action with NON-destructive DB writes only; returns the
   *  action when it is a finding the boot log should surface. surface-prune
   *  and surface-orphan-dir are logged, NEVER actioned (D26 Q3). */
  private applyReconcileAction(a: WorktreeReconcileAction, projectId: string): boolean {
    switch (a.type) {
      case 'none':
        return false
      case 'promote':
        // Spec §7: promote → updateWorktreeStatus only. The worktrees-side
        // pointer (session_id) is already set and is authoritative (a);
        // reconcile never writes session rows — restore owns sessions
        // healing, and a crash-window-lagged sessions.worktree_id is
        // cosmetic (the row link is the durable record).
        this.storage.updateWorktreeStatus(a.id, a.to)
        console.log(`[worktrees] reconcile: promoted ${a.id} → ${a.to}`)
        return false
      case 'detach':
        this.storage.detachWorktree(a.id)
        if (a.surface) console.log(`[worktrees] reconcile: detached stale worktree ${a.id}`)
        return a.surface
      case 'delete-row':
        // Only P3c/P3e reach here — provably nothing durable (no entry, no dir).
        this.storage.deleteWorktreeRow(a.id)
        console.log(`[worktrees] reconcile: deleted row ${a.id} (nothing durable)`)
        return false
      case 'adopt':
        // Population 4 (c): born detached, session NULL; surfaced as "found
        // untracked worktree". branch/baseBranch unknown → '' (NOT NULL cols).
        this.storage.createWorktreeRow({
          id: randomUUID(),
          projectId,
          sessionId: null,
          path: a.path,
          branch: a.branch ?? '',
          baseBranch: '',
          repoRoot: a.repoRoot,
          status: 'detached',
          createdAt: new Date().toISOString()
        })
        console.log(`[worktrees] reconcile: found untracked worktree ${a.path}; adopted as detached`)
        return true
      case 'surface-prune':
        console.log(`[worktrees] reconcile: prune candidate ${a.id} (user-confirmed prune is 2-3)`)
        return true
      case 'surface-orphan-dir':
        console.log(`[worktrees] reconcile: orphan directory ${a.path} (never auto-deleted)`)
        return true
    }
  }
}
