import { execFile } from 'node:child_process'
import { win32 } from 'node:path'
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
 * `rev-parse --path-format=absolute --show-toplevel --git-dir --git-common-dir`
 * (one spawn, three lines — the linked-worktree probe behind
 * `resolveMainRepoRoot`; --path-format needs git >= 2.31),
 * `rev-list --left-right --count <a>...<b>`, `branch -d|-D <branch>` (2-3),
 * `diff --shortstat HEAD` (2-4 — read-only).
 *
 * Destruction discipline (D26 clause 7 as amended by D26(i)): `worktreeRemove`
 * is the ONLY function that may emit `--force`, and only when its caller has
 * passed main's typed-confirmation gate (Task 2-3's worktree:remove handler).
 * Nothing in 2-1 ever sets `force` — the flag ships dormant; a force-less
 * `worktree remove` refusing a dirty tree (GitError) is the normal path.
 */

const pExecFile = promisify(execFile)

/** Cheap, near-instant queries (rev-parse, status, worktree list, branch -d).
 *  Runtime is git's own latency and does not scale with repo size, so a
 *  process still alive after this is wedged rather than slow. */
const GIT_TIMEOUT_MS = 15_000

/** Bulk-checkout commands. `worktree add` writes EVERY tracked file into a new
 *  directory and `worktree remove` deletes them again, so their runtime scales
 *  with REPO SIZE, not with git's latency: a ~7k-file repo on Windows (with
 *  Defender in the path) runs well past 15s cold. Sharing the query budget
 *  killed those mid-checkout, leaving a half-populated directory and a leaked
 *  branch — and because Node reports a timeout kill as code=null, the failure
 *  surfaced as `failed (null)` with a truncated progress dump and no stated
 *  cause. The ceiling stays finite: a backstop against a wedged process, not a
 *  budget any real checkout is expected to approach. */
const GIT_CHECKOUT_TIMEOUT_MS = 10 * 60_000

/** Canonical Windows path comparison key: git emits forward slashes
 *  (`C:/x/y`), node's join emits backslashes, and Windows paths are
 *  case-insensitive. Mirrors the private helper of the same name in
 *  worktrees.ts — kept local so this module stays dependency-free. */
function pathKey(p: string): string {
  return win32.normalize(p).toLowerCase().replace(/\\+$/, '')
}

/** The tail of git's progress stream, for a timeout message. git separates
 *  progress updates with \r, so the last segment is the informative one. */
function lastOutputSuffix(stderr: string): string {
  const parts = stderr
    .split(/[\r\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  const last = parts[parts.length - 1]
  return last === undefined ? '' : ` (last output: ${last})`
}

export class GitError extends Error {
  constructor(
    readonly args: string[],
    readonly code: number | null,
    readonly stderr: string,
    /** The elapsed budget when the per-call timeout killed the child; null
     *  when git exited on its own. Node reports a timeout kill as code=null
     *  with killed=true, so `code` alone cannot distinguish the two — git's
     *  own fatal exit is 128, and conflating them is what made the original
     *  "Filename too long" failure read as an unexplained `failed (null)`. */
    readonly timedOutAfterMs: number | null = null
  ) {
    super(
      timedOutAfterMs === null
        ? `git ${args.join(' ')} failed (${code}): ${stderr.trim()}`
        : `git ${args.join(' ')} timed out after ${Math.round(timedOutAfterMs / 1000)}s ` +
          `and was terminated${lastOutputSuffix(stderr)}`
    )
  }

  get timedOut(): boolean {
    return this.timedOutAfterMs !== null
  }
}

async function runGit(cwd: string, args: string[], timeoutMs = GIT_TIMEOUT_MS): Promise<string> {
  try {
    const { stdout } = await pExecFile('git', args, {
      cwd,
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024
    })
    return stdout
  } catch (err) {
    const e = err as { code?: number; stderr?: string; killed?: boolean; signal?: string | null }
    // Node's timeout path SIGTERMs the child: `killed` is set and `signal` is
    // non-null, while a plain non-zero git exit carries neither.
    const timedOut = e.killed === true || (e.signal !== undefined && e.signal !== null)
    throw new GitError(args, e.code ?? null, e.stderr ?? String(err), timedOut ? timeoutMs : null)
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

export interface RepoRootProbe {
  toplevel: string
  gitDir: string
  commonDir: string
}

/** Parse `rev-parse --path-format=absolute --show-toplevel --git-dir
 *  --git-common-dir` — three absolute forward-slash lines in that order.
 *  `--path-format=absolute` is load-bearing: without it `--git-dir` reports a
 *  bare relative `.git` at the repo root and the comparison below is
 *  meaningless. Pure — exported for unit test. Null unless all three landed. */
export function parseRepoRootProbe(out: string): RepoRootProbe | null {
  const lines = out
    .split('\n')
    .map((l) => l.replace(/\r$/, '').trim())
    .filter((l) => l.length > 0)
  if (lines.length < 3) return null
  return { toplevel: lines[0], gitDir: lines[1], commonDir: lines[2] }
}

/** True when the probed cwd sits in a LINKED worktree: its git dir is
 *  `<common>/worktrees/<name>`, whereas a main worktree's git dir IS the
 *  common dir. Pure — exported for unit test. */
export function isLinkedWorktree(probe: RepoRootProbe): boolean {
  return pathKey(probe.gitDir) !== pathKey(probe.commonDir)
}

/**
 * The MAIN worktree's root for `cwd` — the anchor for WHERE Chorus stores its
 * worktrees. That is a different question from the one `resolveRepoRoot`
 * answers, and the two must NOT be merged.
 *
 * `resolveRepoRoot` (--show-toplevel) answers "which tree does a session in
 * this cwd write?", and inside a linked worktree the honest answer is that
 * worktree — the D22 semantics the live-session count in the launch-context
 * handler depends on (see its own "do not fix with --git-common-dir" note).
 *
 * Placement needs the opposite answer. Deriving `<parent>\.chorus\<name>` from
 * a linked worktree nests a second managed root inside the first: launching
 * from `…\Repo.worktrees\feature\Some-Long-Feature-Name` targeted
 * `…\Repo.worktrees\feature\.chorus\Some-Long-Feature-Name\wt-xxxxxxxx`, an
 * 87-character prefix that pushed the repo's longest tracked path to 262 and
 * made `git worktree add` die with "Filename too long" (git's own exit 128)
 * partway through the checkout. Anchoring to the main repo yields one
 * `.chorus` root per repo and the shortest prefix available — the same launch
 * lands at 45 characters.
 *
 * Degrades to the plain toplevel whenever the main root cannot be established
 * (git < 2.31 has no --path-format), and null for a non-repo.
 */
export async function resolveMainRepoRoot(cwd: string): Promise<string | null> {
  let probe: RepoRootProbe | null
  try {
    probe = parseRepoRootProbe(
      await runGit(cwd, [
        'rev-parse',
        '--path-format=absolute',
        '--show-toplevel',
        '--git-dir',
        '--git-common-dir'
      ])
    )
  } catch (err) {
    if (err instanceof GitError && /not a git repository/i.test(err.stderr)) return null
    return resolveRepoRoot(cwd) // unsupported flag on an ancient git, etc.
  }
  if (probe === null) return resolveRepoRoot(cwd)
  if (!isLinkedWorktree(probe)) return probe.toplevel
  // Linked worktree: `git worktree list` documents the MAIN worktree first.
  // Preferred over dirname(--git-common-dir), which is simpler but WRONG for a
  // submodule (its common dir is `<super>/.git/modules/<name>`). A bare main
  // repo has no working tree to anchor to, so the toplevel stands.
  try {
    const main = (await listWorktrees(cwd))[0]
    return main !== undefined && !main.bare ? main.path : probe.toplevel
  } catch {
    return probe.toplevel
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
  await runGit(repoRoot, ['worktree', 'add', '-b', branch, path, baseBranch], GIT_CHECKOUT_TIMEOUT_MS)
}

/** git worktree remove [--force] <path>. A set `force` flag is legal ONLY on
 *  the confirmed dirty-removal path (D26 clause 7 AS AMENDED by D26(i)) —
 *  every other caller passes false. Without force, git refusing a dirty tree
 *  throws (GitError) — that refusal is the normal, expected path. */
export async function worktreeRemove(repoRoot: string, path: string, force = false): Promise<void> {
  await runGit(
    repoRoot,
    ['worktree', 'remove', ...(force ? ['--force'] : []), path],
    GIT_CHECKOUT_TIMEOUT_MS
  )
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

/** git status --porcelain (v1). Empty output ⇒ clean (D26 Q4).
 *
 *  `untrackedAll` adds `-uall`, and it DEFAULTS OFF so every pre-D153 caller
 *  runs the identical command it always has. git's default collapses an
 *  untracked directory to a single entry with a trailing slash — measured:
 *  `src/TaxApp.Domain/Entities/TaxSubmissionAndProcessing/` stood for a whole
 *  new folder of C# entities. That is the right answer for "is this tree
 *  dirty?" (D26 Q4's question) and the wrong one for "what did I work on?",
 *  which needs the filenames. */
export async function statusPorcelain(
  worktreePath: string,
  untrackedAll = false
): Promise<string[]> {
  const out = await runGit(
    worktreePath,
    untrackedAll ? ['status', '--porcelain', '-uall'] : ['status', '--porcelain']
  )
  return out
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.length > 0)
}

/** git rev-parse --abbrev-ref HEAD → the base branch for a new worktree. */
export async function currentBranch(repoRoot: string): Promise<string> {
  return (await runGit(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
}

/** Task 2-4: a parsed `git diff --shortstat` summary (tracked changes only —
 *  untracked files are counted separately via statusPorcelain). */
export interface ShortstatSummary {
  filesChanged: number
  insertions: number
  deletions: number
}

/** Pure parser for a `git diff --shortstat` line, e.g.
 *  " 3 files changed, 12 insertions(+), 4 deletions(-)".
 *  TOTAL, never throws: singular and plural on all three segments ("1 file
 *  changed", "1 insertion(+)", "1 deletion(-)"), missing segments default to
 *  0, and an empty/garbage line yields all zeros. Exported for unit test.
 *  Shapes re-verified live against git 2.50.0.windows.1 (D4, Task 2-4). */
export function parseShortstat(line: string): ShortstatSummary {
  const files = /(\d+) files? changed/.exec(line)
  const ins = /(\d+) insertions?\(\+\)/.exec(line)
  const del = /(\d+) deletions?\(-\)/.exec(line)
  return {
    filesChanged: files ? Number(files[1]) : 0,
    insertions: ins ? Number(ins[1]) : 0,
    deletions: del ? Number(del[1]) : 0
  }
}

/** git diff --shortstat HEAD, cwd = the worktree — tracked staged+unstaged
 *  changes relative to HEAD. (Untracked files are counted separately via
 *  statusPorcelain; a missing segment in the line just parses as 0.) */
export async function diffShortstat(worktreePath: string): Promise<ShortstatSummary> {
  const out = await runGit(worktreePath, ['diff', '--shortstat', 'HEAD'])
  return parseShortstat(out.trim())
}

/**
 * The repository's COMMON git dir — the shared object/ref store that every
 * linked worktree of one repo points at (D153). `null` when cwd is not a
 * repository at all, which is a normal answer: a project in the rail need not
 * be under git (measured — the `Mission Map` project is not).
 *
 * ⚠ THIS IS THE DEDUPLICATION KEY FOR THE DAY REPORT, and it answers a third
 * question distinct from the two `resolveRepoRoot` and `resolveMainRepoRoot`
 * already answer above. Not "which tree does this session write" and not
 * "where do Chorus worktrees go", but "are these two projects the same
 * repository?". Measured on this machine: the `TR-Integration` and
 * `CCH-integration` projects are two worktrees of ONE repo and both report
 * `C:/Projects/TaxApp/TaxApp/.git` — so a sweep keyed on the working tree
 * counts every TaxApp commit twice, once under each project name.
 */
export async function gitCommonDir(cwd: string): Promise<string | null> {
  try {
    const out = await runGit(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
    return out.trim() || null
  } catch {
    return null // not a repository — expected, not exceptional
  }
}

/**
 * Every email address this repository would let you commit under — `git config
 * --get-all user.email`, which returns the value at EVERY level (global, then
 * repo-local) rather than just the effective one (D153, F76).
 *
 * ⚠ `--get-all` AND NOT A PLAIN `config user.email`, and the difference is the
 * whole point. A plain read returns only the most specific value; measured in
 * `C:/Projects/TaxApp/TaxApp` it answers `mwilson@taxapp.com` alone, while the
 * repository actually contains 136 commits under that address AND 21 under the
 * global `mwilson29072@gmail.com`. Filtering on the effective identity would
 * silently drop 21 real days' work.
 *
 * Empty when git has no identity configured at all — a real state, and the
 * caller must not treat it as "match everything".
 */
export async function configuredIdentities(cwd: string): Promise<string[]> {
  try {
    const out = await runGit(cwd, ['config', '--get-all', 'user.email'])
    return [
      ...new Set(
        out
          .split('\n')
          .map((l) => l.replace(/\r$/, '').trim())
          .filter((l) => l.length > 0)
      )
    ]
  } catch {
    return [] // no identity configured, or not a repository
  }
}

/** A read-only history query whose argument list was assembled elsewhere.
 *
 *  ⚠ THE GUARD IS THE POINT. This is the only function in this module that
 *  accepts a caller-supplied argument list, so it verifies the subcommand
 *  itself rather than trusting the caller: `log` and `diff` only, both
 *  read-only, and no `--force` may appear under any spelling. The day report
 *  builds its own flags (they are data, so they can be unit-tested), and this
 *  keeps that convenience from widening what git can be asked to do. */
export async function readOnlyHistory(
  repoRoot: string,
  args: readonly string[],
  timeoutMs = GIT_TIMEOUT_MS
): Promise<string> {
  const sub = args[0]
  if (sub !== 'log' && sub !== 'diff') {
    throw new GitError([...args], null, `readOnlyHistory refuses the '${String(sub)}' subcommand`)
  }
  if (args.some((a) => a === '-f' || a.startsWith('--force'))) {
    throw new GitError([...args], null, 'readOnlyHistory refuses a force flag')
  }
  return runGit(repoRoot, [...args], timeoutMs)
}

/* ─────────────── Task 6a-2: what `index-codebase` reads ─────────────── */

/** Pure parser for `git ls-files -z` — NUL-separated, with a trailing empty
 *  element. Exported for unit test.
 *
 *  ⚠ `-z` IS NOT A PREFERENCE. Without it git QUOTES any path containing a
 *  non-ASCII byte and escapes it in octal — measured on a fixture repo:
 *  `src/café.ts` comes back as `"src/caf\303\251.ts"`, quotes and all. A
 *  newline-split parser would then hand that string to `normalizeRelPath` as
 *  an identity, and the node would be wrong for exactly the files whose
 *  identity is hardest to get right. With `-z` git emits the raw bytes and the
 *  quoting question disappears rather than being handled. */
export function parseLsFilesZ(out: string): string[] {
  return out.split('\0').filter((p) => p.length > 0)
}

/** git ls-files -z — every tracked path, repo-relative. */
export async function lsFiles(cwd: string): Promise<string[]> {
  return parseLsFilesZ(await runGit(cwd, ['ls-files', '-z']))
}

/**
 * git rev-list --max-parents=0 HEAD — the repository's root commit(s), sorted
 * LEXICOGRAPHICALLY.
 *
 * ⚠ THE SORT IS THE CONTRACT, AND IT IS NOT BY DATE (identity model §3(i)).
 * Committer and author dates are user-settable, and `rev-list` does not
 * document its output order — so a date-based tie-break is not guaranteed to
 * give two machines the same answer, which is the one property `repoId` exists
 * to have. The caller takes `[0]`.
 *
 * An empty array is a NORMAL answer, not an error: a repository with no
 * commits has no root, and then no `:Commit` may be written while files still
 * index.
 */
export async function rootCommitShas(cwd: string): Promise<string[]> {
  try {
    const out = await runGit(cwd, ['rev-list', '--max-parents=0', 'HEAD'])
    return out
      .split('\n')
      .map((l) => l.replace(/\r$/, '').trim())
      .filter((l) => l.length > 0)
      .sort()
  } catch {
    // "does not have any commits yet" / not a repository — both mean "no
    // repoId", which the caller handles as a stated limit rather than a fault.
    return []
  }
}

/**
 * The bounded commit window `index-codebase` links.
 *
 * ⚠ `core.quotepath=false` RATHER THAN `-z`, AND THE CHOICE IS MEASURED. `-z`
 * changes `--name-only`'s record framing — the header and the file list end up
 * NUL-separated together, with a zero-file commit indistinguishable from the
 * next record's start without a sentinel. `core.quotepath=false` leaves the
 * framing as lines and simply stops git escaping non-ASCII: verified on a
 * fixture repo, `src/café.ts` and `src/日本語.ts` come back literal where the
 * default emits `"src/caf\303\251.ts"`. A path git STILL quotes (one holding a
 * `"` or a newline — both illegal on NTFS) is skipped and counted by the
 * parser, never guessed at.
 *
 * `--no-renames` because a rename is two paths and the index records where a
 * file IS, not where it was.
 */
export async function logNameOnly(cwd: string, limit: number): Promise<string> {
  return runGit(cwd, [
    '-c',
    'core.quotepath=false',
    'log',
    `-n`,
    String(limit),
    '--no-renames',
    '--name-only',
    '--pretty=format:C%x1f%H%x1f%aI%x1f%s'
  ])
}

/** How many commits exist in the window the log was capped to — the
 *  denominator that turns a cap into a reported truncation rather than a
 *  silent one (`IndexReport.commitsSkippedBeyondLimit`). */
export async function countCommits(cwd: string): Promise<number> {
  try {
    const out = await runGit(cwd, ['rev-list', '--count', 'HEAD'])
    const n = Number(out.trim())
    return Number.isFinite(n) ? n : 0
  } catch {
    return 0
  }
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
