import { stat } from 'node:fs/promises'
import { win32 } from 'node:path'
import {
  buildLogArgs,
  buildPatchArgs,
  canonicalRepoKey,
  dayWindowBounds,
  filterDirtyByMtime,
  harvestSymbols,
  isEmptyRepo,
  parseCommitLog,
  parseStatusLine,
  type DayEvidence,
  type DayRepoEvidence,
  type DaySkippedProject
} from './dayReportCore'

/**
 * The day report's impure half (D153): spawn git, stat files, assemble the
 * evidence. Every rule it applies lives in `dayReportCore.ts`; this module
 * only feeds it.
 *
 * ⚠ EVERY EXTERNAL EFFECT ARRIVES AS AN INJECTED DEP, which is what lets the
 * whole sweep — six projects, shared repositories, a non-git project, stale
 * dirt — be driven in a unit test with no repository on disk.
 */

/** The subset of a project row this needs. Deliberately not `ProjectRow`: the
 *  report has no business knowing about colour seeds or sort order. */
export interface DayProjectInput {
  readonly id: string
  readonly name: string
  readonly rootPath: string
}

export interface DayReportDeps {
  /** Active projects, in rail order. */
  readonly listProjects: () => Promise<readonly DayProjectInput[]>
  readonly commonDir: (cwd: string) => Promise<string | null>
  readonly history: (repoRoot: string, args: readonly string[]) => Promise<string>
  readonly listWorktrees: (repoRoot: string) => Promise<readonly { path: string }[]>
  readonly statusPorcelain: (worktreePath: string) => Promise<readonly string[]>
  /** Epoch ms of a file's last write, or null when it cannot be stat-ed — a
   *  deleted-but-still-listed path is normal, never an error. */
  readonly mtimeMs: (absolutePath: string) => Promise<number | null>
  readonly now: () => Date
}

/** Node's `fs.stat`, with the "it vanished between listing and stat-ing"
 *  race treated as the ordinary event it is. */
export async function statMtimeMs(absolutePath: string): Promise<number | null> {
  try {
    return (await stat(absolutePath)).mtimeMs
  } catch {
    return null
  }
}

/** One repository and every project that points at it. */
interface RepoGroup {
  repoKey: string
  /** The working tree git commands run from. Any worktree of the repo sees the
   *  same refs, so the first project's root is as good as any. */
  cwd: string
  projectNames: string[]
}

/**
 * Group projects by the repository behind them, recording why anything was
 * left out.
 *
 * ⚠ THE GROUPING IS THE CORRECTNESS-CRITICAL STEP. Two projects can be two
 * worktrees of one repo (`TR-Integration` and `CCH-integration` are), and
 * `--branches --tags --remotes` from either one sees the SAME refs. Without
 * this, every TaxApp commit appears twice under two different headings, and
 * the day looks twice as productive as it was.
 */
export async function groupProjectsByRepo(
  projects: readonly DayProjectInput[],
  commonDir: (cwd: string) => Promise<string | null>
): Promise<{ groups: RepoGroup[]; skipped: DaySkippedProject[] }> {
  const byKey = new Map<string, RepoGroup>()
  const skipped: DaySkippedProject[] = []

  for (const project of projects) {
    const dir = await commonDir(project.rootPath)
    if (dir === null) {
      // Measured: the `Mission Map` project is a real, active project with no
      // git repository at all. Saying so is the point — a project silently
      // absent from the report reads as "nothing happened there".
      skipped.push({ projectName: project.name, reason: 'not a git repository' })
      continue
    }
    const key = canonicalRepoKey(dir)
    const existing = byKey.get(key)
    if (existing) existing.projectNames.push(project.name)
    else byKey.set(key, { repoKey: key, cwd: project.rootPath, projectNames: [project.name] })
  }

  return { groups: [...byKey.values()], skipped }
}

/** Dirty files across every worktree of one repository, bounded to the day by
 *  file mtime. */
async function collectDirty(
  group: RepoGroup,
  windowStartMs: number,
  windowEndMs: number,
  deps: DayReportDeps
): Promise<DayRepoEvidence['dirty']> {
  let worktrees: readonly { path: string }[]
  try {
    worktrees = await deps.listWorktrees(group.cwd)
  } catch {
    // A repo whose worktree list cannot be read still has commits worth
    // reporting; losing the in-flight half is better than losing the day.
    worktrees = [{ path: group.cwd }]
  }

  const entries: { status: string; path: string; mtimeMs: number }[] = []
  for (const wt of worktrees) {
    let lines: readonly string[]
    try {
      lines = await deps.statusPorcelain(wt.path)
    } catch {
      continue
    }
    for (const line of lines) {
      const parsed = parseStatusLine(line)
      if (parsed === null) continue
      const abs = win32.join(wt.path, parsed.path)
      const mtime = await deps.mtimeMs(abs)
      if (mtime === null) continue
      // The path is reported RELATIVE to its worktree — an absolute Windows
      // path in a timesheet is noise, and the worktree is already named by the
      // project heading.
      entries.push({ status: parsed.status, path: parsed.path, mtimeMs: mtime })
    }
  }

  return filterDirtyByMtime(entries, windowStartMs, windowEndMs)
}

/**
 * Assemble one day's evidence across every active project.
 *
 * `utcOffsetMinutes` is the reporting zone — pass `-new Date().getTimezoneOffset()`
 * for "this machine, right now". It is a parameter rather than read from the
 * environment so a stored report regenerates identically in December.
 */
export async function collectDayEvidence(
  date: string,
  utcOffsetMinutes: number,
  deps: DayReportDeps
): Promise<DayEvidence> {
  const window = dayWindowBounds(date, utcOffsetMinutes)
  const windowStartMs = Date.parse(window.since)
  const windowEndMs = Date.parse(window.until)

  const projects = await deps.listProjects()
  const { groups, skipped } = await groupProjectsByRepo(projects, deps.commonDir)

  const repos: DayRepoEvidence[] = []
  for (const group of groups) {
    let commits: DayRepoEvidence['commits'] = []
    let symbols: readonly string[] = []
    let tests: readonly string[] = []

    try {
      commits = parseCommitLog(await deps.history(group.cwd, buildLogArgs(window)))
    } catch {
      skipped.push({
        projectName: group.projectNames.join(' · '),
        reason: 'git history could not be read'
      })
      continue
    }

    // The patch is only worth fetching when something was actually committed —
    // it is by far the most expensive call in the sweep, and on a quiet day in
    // a quiet repo it would return nothing.
    if (commits.length > 0) {
      try {
        const harvest = harvestSymbols(await deps.history(group.cwd, buildPatchArgs(window)))
        symbols = harvest.symbols
        tests = harvest.tests
      } catch {
        // A patch too large for the buffer costs the API/test lists, not the
        // commit list. Degrade, never fail.
        symbols = []
        tests = []
      }
    }

    const dirty = await collectDirty(group, windowStartMs, windowEndMs, deps)

    repos.push({
      repoKey: group.repoKey,
      projectNames: group.projectNames,
      commits,
      dirty,
      symbols,
      tests
    })
  }

  return {
    date,
    generatedAt: deps.now().toISOString(),
    // Quiet repositories are dropped here rather than in the render so that
    // every consumer — markdown, the model prompt, the stored snapshot — sees
    // the same day.
    repos: repos.filter((r) => !isEmptyRepo(r)),
    skipped
  }
}
