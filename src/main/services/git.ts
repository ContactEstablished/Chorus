import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

/**
 * Controlled git process adapter (Task 2-1). One private runner over
 * promisified execFile — NEVER a shell, NEVER a string-concatenated command;
 * arguments are always an array, cwd is explicit per call. Every public
 * function is a thin typed wrapper.
 *
 * Flags verified against the installed git 2.50.0.windows.1's own
 * `git worktree -h` / `git status -h` / `git rev-list -h` / `git branch -h`
 * plus live probes (D4): `worktree add -b <branch> <path> <base>`,
 * `worktree list --porcelain`, `worktree remove [-f] <worktree>`
 * (`--force` accepted for `-f`), `worktree prune`, `status --porcelain` (v1),
 * `rev-parse --show-toplevel`, `rev-parse --abbrev-ref HEAD`,
 * `rev-list --left-right --count <a>...<b>`, `branch -d|-D <branch>` (2-3).
 *
 * Destruction discipline (D26 clause 7 as amended by D26(i)): `worktreeRemove`
 * is the ONLY function that may emit `--force`, and only when its caller has
 * passed main's typed-confirmation gate (Task 2-3's worktree:remove handler).
 * Nothing in 2-1 ever sets `force` — the flag ships dormant; a force-less
 * `worktree remove` refusing a dirty tree (GitError) is the normal path.
 */

const pExecFile = promisify(execFile)

const GIT_TIMEOUT_MS = 15_000

export class GitError extends Error {
  constructor(
    readonly args: string[],
    readonly code: number | null,
    readonly stderr: string
  ) {
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
  branch: string | null // 'refs/heads/x' → 'x'; null when detached/bare
  head: string | null
  detached: boolean
  bare: boolean
}

/** Parse `git worktree list --porcelain`: blank-line-separated records of
 *  `worktree <path>` / `HEAD <sha>` / `branch <ref>` | `detached` | `bare`.
 *  Pure — exported for unit tests. Unknown attribute lines (`locked`,
 *  `prunable`, …) are skipped. */
export function parseWorktreePorcelain(out: string): GitWorktreeEntry[] {
  const entries: GitWorktreeEntry[] = []
  let current: Partial<GitWorktreeEntry> | null = null
  const flush = (): void => {
    if (current && typeof current.path === 'string') {
      entries.push({
        path: current.path,
        branch: current.branch ?? null,
        head: current.head ?? null,
        detached: current.detached ?? false,
        bare: current.bare ?? false
      })
    }
    current = null
  }
  for (const rawLine of out.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (line === '') {
      flush()
      continue
    }
    if (line.startsWith('worktree ')) {
      flush()
      current = { path: line.slice('worktree '.length) }
      continue
    }
    if (!current) continue
    if (line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length)
    } else if (line.startsWith('branch ')) {
      const ref = line.slice('branch '.length)
      current.branch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref
    } else if (line === 'detached') {
      current.detached = true
    } else if (line === 'bare') {
      current.bare = true
    }
  }
  flush()
  return entries
}

/** git worktree list --porcelain, parsed. */
export async function listWorktrees(repoRoot: string): Promise<GitWorktreeEntry[]> {
  const out = await runGit(repoRoot, ['worktree', 'list', '--porcelain'])
  return parseWorktreePorcelain(out)
}

/** git worktree add -b <branch> <path> <base>. Never passes -f/--force. */
export async function worktreeAdd(
  repoRoot: string,
  path: string,
  branch: string,
  baseBranch: string
): Promise<void> {
  await runGit(repoRoot, ['worktree', 'add', '-b', branch, path, baseBranch])
}

/** git worktree remove [--force] <path>. A set `force` flag is legal ONLY on
 *  the confirmed dirty-removal path (D26 clause 7 AS AMENDED by D26(i)) —
 *  every other caller passes false. Without force, git refusing a dirty tree
 *  throws (GitError) — that refusal is the normal, expected path. */
export async function worktreeRemove(repoRoot: string, path: string, force = false): Promise<void> {
  await runGit(repoRoot, ['worktree', 'remove', ...(force ? ['--force'] : []), path])
}

/** git worktree prune — only ever called after explicit user confirmation (2-3). */
export async function worktreePrune(repoRoot: string): Promise<void> {
  await runGit(repoRoot, ['worktree', 'prune'])
}

/** git branch -d|-D <branch> (Task 2-3, D26(j)). `-d` is the safe form: git
 *  itself refuses an unmerged branch ("not fully merged"), and that refusal
 *  is a normal, surfaced outcome — never retried. `-D` force-deletes and is
 *  legal ONLY behind the typed-confirmation acknowledgment (the
 *  worktree:remove handler's forceBranch). Callers remove the worktree FIRST:
 *  git refuses to delete a branch that is checked out in any worktree. */
export async function branchDelete(repoRoot: string, branch: string, force = false): Promise<void> {
  await runGit(repoRoot, ['branch', force ? '-D' : '-d', branch])
}

/** git status --porcelain (v1). Empty output ⇒ clean (D26 Q4). */
export async function statusPorcelain(worktreePath: string): Promise<string[]> {
  const out = await runGit(worktreePath, ['status', '--porcelain'])
  return out
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.length > 0)
}

/** git rev-parse --abbrev-ref HEAD → the base branch for a new worktree. */
export async function currentBranch(repoRoot: string): Promise<string> {
  return (await runGit(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
}

/** git rev-list --left-right --count <base>...<branch> → { ahead, behind }
 *  (ahead = commits on branch not on base). Cheap; used by 2-3's panel. */
export async function aheadBehind(
  repoRoot: string,
  branch: string,
  baseBranch: string
): Promise<{ ahead: number; behind: number }> {
  const out = await runGit(repoRoot, [
    'rev-list',
    '--left-right',
    '--count',
    `${baseBranch}...${branch}`
  ])
  const [behind, ahead] = out.trim().split(/\s+/).map(Number)
  return { ahead: ahead || 0, behind: behind || 0 }
}
