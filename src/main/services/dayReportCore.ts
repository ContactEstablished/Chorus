/**
 * The day report: what was worked on, on one calendar day, across every
 * project — assembled from GIT rather than from agent telemetry (D153).
 *
 * ⚠ PURE. No `fs`, no `child_process`, no `electron`, no storage. Every
 * function here takes text that something else read and returns a value. The
 * impure half — spawning git, stat-ing files, calling a model, persisting the
 * snapshot — lives in `dayReport.ts`. The split is the same one `turnsCore.ts`
 * and `attentionCore.ts` keep, and for the same reason: the parsing rules are
 * where the bugs are, and a rule that needs a repository to test does not get
 * tested.
 *
 * ⚠ WHY GIT AND NOT `agent_turns`. The obvious source for "what did the agents
 * do today" is the hook spine, and it CANNOT answer the question: `bindHooks`
 * is Claude-only, so codex, kimi and opencode produce zero turns (D129), and
 * F64 says codex cannot even be discovered. Git has the opposite property —
 * it observes ARTIFACTS, not agents, so a commit looks identical whether
 * Claude, codex, or the user's own hands produced it. Agent-agnosticism is not
 * something this module implements; it is the source's default state, and that
 * is precisely why the source was chosen.
 *
 * ⚠ AND IT SIDESTEPS F51. Turn history is scattered across five SQLite stores
 * by the dev/installed split; git lives on disk, one copy per repo, and is the
 * same evidence no matter which Chorus instance asks.
 *
 * The honest limit, stated here because the UI must state it too: git sees
 * committed work and work still sitting in the working tree. Work that was
 * written and then discarded is invisible, and nothing in this module pretends
 * otherwise.
 */

/** One file touched by one commit. `status` is git's name-status letter —
 *  A(dded), M(odified), D(eleted), R(enamed)… kept RAW rather than mapped to
 *  a word, because a timesheet reader wants "added" vs "changed" and the
 *  renderer is the right place to decide the vocabulary. */
export interface DayFileChange {
  readonly status: string
  readonly path: string
}

export interface DayCommit {
  readonly sha: string
  /** Committer date, ISO-8601 with offset. COMMITTER, not author: a rebase or
   *  a cherry-pick moves work into today and the author date would still read
   *  as the day it was first written. For "what did I do today", the day it
   *  landed is the honest answer. */
  readonly at: string
  readonly subject: string
  readonly files: readonly DayFileChange[]
}

/** A file dirty in the working tree AND touched within the day's window.
 *  Both halves matter — see `filterDirtyByMtime`. */
export interface DayDirtyFile {
  readonly path: string
  readonly status: string
  readonly modifiedAt: string
}

export interface DayRepoEvidence {
  /** Canonical key for the underlying repository — the git COMMON dir, not the
   *  working tree. Two projects can be two worktrees of one repo (measured:
   *  `TR-Integration` and `CCH-integration` both resolve to
   *  `C:/Projects/TaxApp/TaxApp/.git`), and keying on the working tree would
   *  count every one of that repo's commits twice. */
  readonly repoKey: string
  /** Every project in the rail backed by this repo. Plural is the normal case,
   *  not an edge case. */
  readonly projectNames: readonly string[]
  readonly commits: readonly DayCommit[]
  readonly dirty: readonly DayDirtyFile[]
  /** Exported/public symbols introduced by the day's added lines. */
  readonly symbols: readonly string[]
  /** Test names introduced by the day's added lines. */
  readonly tests: readonly string[]
}

export interface DaySkippedProject {
  readonly projectName: string
  readonly reason: string
}

export interface DayEvidence {
  /** The local calendar date this covers, `YYYY-MM-DD`. */
  readonly date: string
  readonly generatedAt: string
  readonly repos: readonly DayRepoEvidence[]
  /** Projects that produced no evidence and WHY. A project missing from the
   *  report without explanation reads as "nothing happened there", which is a
   *  different claim from "this one is not a git repository at all" — and the
   *  second is real: the `Mission Map` project has no git common dir. */
  readonly skipped: readonly DaySkippedProject[]
}

/* ───────────────────────── window ───────────────────────── */

/** Two-digit pad for offset rendering. */
function pad2(n: number): string {
  return String(Math.floor(Math.abs(n))).padStart(2, '0')
}

/** `-240` → `-04:00`. Sign is git's/ISO's, not JavaScript's: note that
 *  `Date.prototype.getTimezoneOffset()` returns the OPPOSITE sign (+240 for
 *  UTC-4), so callers must negate it before calling here. Named `utcOffset`
 *  rather than `timezoneOffset` to make that mismatch visible at the call. */
export function formatUtcOffset(utcOffsetMinutes: number): string {
  const sign = utcOffsetMinutes < 0 ? '-' : '+'
  return `${sign}${pad2(utcOffsetMinutes / 60)}:${pad2(utcOffsetMinutes % 60)}`
}

export interface DayWindow {
  readonly since: string
  readonly until: string
}

/**
 * The `--since`/`--until` pair bounding one LOCAL calendar day.
 *
 * ⚠ THE OFFSET IS EXPLICIT AND THAT IS THE WHOLE POINT. git accepts bare
 * `2026-08-15 00:00` and interprets it in the machine's local zone, which is
 * usually right and silently wrong the moment a report is regenerated from a
 * stored snapshot on a different day of the year (DST) — a timesheet that
 * shifts by an hour when reprinted is worse than one that never existed.
 * Verified live against git 2.50.0.windows.1: an ISO-8601 string carrying an
 * offset is accepted by both flags.
 *
 * `until` is the NEXT day's midnight, and git's `--until` is inclusive of that
 * instant — a commit landing at exactly 00:00:00 tomorrow would be counted
 * twice across two adjacent reports. One second is subtracted to close that,
 * which is why the boundary reads 23:59:59.
 */
export function dayWindowBounds(date: string, utcOffsetMinutes: number): DayWindow {
  const off = formatUtcOffset(utcOffsetMinutes)
  return { since: `${date}T00:00:00${off}`, until: `${date}T23:59:59${off}` }
}

/* ───────────────────────── commit log ───────────────────────── */

/** Record and field separators used in the `--pretty=format:` string. ASCII
 *  RS/US: they cannot occur in a commit subject that any tool would produce,
 *  which a newline or a pipe emphatically can. Verified emitted correctly by
 *  git 2.50.0.windows.1 via `%x1e` / `%x1f`. */
export const LOG_RECORD_SEP = '\u001e'
export const LOG_FIELD_SEP = '\u001f'

/**
 * The argument list for the day's log. Exported as DATA rather than built
 * inside the runner so the test can assert the flags themselves — the three
 * that matter are load-bearing and were each established by running the
 * command against real repositories:
 *
 * ⚠ `--branches --tags --remotes` RATHER THAN `--all`. `--all` includes
 * `refs/stash`, and the first live run of this sweep returned
 * `"On main: Auto stash before merge of 'main' and 'origin/main'"` and
 * `"index on main: 3f364cd Phase 6 docs"` as though they were a morning's
 * work. A stash is a save point, not an accomplishment, and it must never
 * reach a timesheet.
 *
 * ⚠ `--no-merges`. A merge commit records integration, not authorship, and its
 * name-status against the first parent is either empty or the whole other
 * branch. Both readings mislead.
 *
 * ⚠ `--name-status` and NOT `--numstat`. Line counts invite exactly the
 * conclusion this report must not support — that 32,788 inserted lines is a
 * bigger day's work than 40. That number is real and it is a lockfile
 * (`CCH-integration`, measured); see `isGeneratedPath`.
 */
export function buildLogArgs(window: DayWindow): string[] {
  return [
    'log',
    '--branches',
    '--tags',
    '--remotes',
    '--no-merges',
    `--since=${window.since}`,
    `--until=${window.until}`,
    `--pretty=format:%x1e%H%x1f%cI%x1f%s`,
    '--name-status'
  ]
}

/**
 * The same window, as a PATCH, for symbol harvesting only.
 *
 * ⚠ `--unified=0` IS LOAD-BEARING, NOT AN OPTIMISATION. With any context at
 * all, unchanged lines arrive carrying a leading space and — more importantly
 * — a nearby `export function foo` would be read as new every time anything
 * beside it changed. Zero context means a `+` line is genuinely an added line.
 *
 * The output is never shown to anyone and never sent anywhere: it is consumed
 * by `harvestSymbols` and discarded. See `buildSummaryPrompt`, which sends the
 * harvested NAMES and never this text.
 */
export function buildPatchArgs(window: DayWindow): string[] {
  return [
    'log',
    '--branches',
    '--tags',
    '--remotes',
    '--no-merges',
    `--since=${window.since}`,
    `--until=${window.until}`,
    '--pretty=format:',
    '-p',
    '--unified=0'
  ]
}

/**
 * Parse the output of `buildLogArgs`. TOTAL: a malformed record is dropped
 * rather than thrown on, because one odd commit in one repository must not
 * cost the user the entire day's report.
 */
export function parseCommitLog(out: string): DayCommit[] {
  const commits: DayCommit[] = []
  for (const record of out.split(LOG_RECORD_SEP)) {
    if (record.trim() === '') continue
    const lines = record.split('\n').map((l) => l.replace(/\r$/, ''))
    const header = lines[0] ?? ''
    const [sha, at, ...subjectParts] = header.split(LOG_FIELD_SEP)
    if (sha === undefined || at === undefined || subjectParts.length === 0) continue
    // A subject cannot contain US, so re-joining is lossless and only ever
    // rejoins a subject that legitimately contained the separator we chose —
    // i.e. never. Kept as a rejoin rather than an index so a future format
    // gaining a field fails loudly at the destructure instead of silently
    // truncating the subject.
    const subject = subjectParts.join(LOG_FIELD_SEP).trim()
    const files: DayFileChange[] = []
    for (const line of lines.slice(1)) {
      if (line.trim() === '') continue
      // name-status is TAB-separated: `M\tpath`, and for renames
      // `R100\told\tnew`. The LAST field is the current path, which is the one
      // a reader can go and open.
      const parts = line.split('\t')
      const status = parts[0] ?? ''
      const path = parts[parts.length - 1] ?? ''
      if (status === '' || path === '' || parts.length < 2) continue
      files.push({ status, path })
    }
    commits.push({ sha: sha.slice(0, 7), at, subject, files })
  }
  return commits
}

/* ───────────────────────── generated files ───────────────────────── */

/**
 * Files whose changes say nothing about what a person worked on. Excluded from
 * symbol harvesting and de-emphasised in the render — never dropped outright,
 * because "regenerated the lockfile" is occasionally the actual work.
 *
 * ⚠ THE LIST IS DELIBERATELY SHORT AND PATH-BASED. A content heuristic
 * ("more than N lines changed") would classify a genuine large refactor as
 * noise, which is the one mistake this report cannot afford.
 */
const GENERATED_PATTERNS: readonly RegExp[] = [
  /(^|\/)package-lock\.json$/i,
  /(^|\/)pnpm-lock\.yaml$/i,
  /(^|\/)yarn\.lock$/i,
  /(^|\/)Cargo\.lock$/i,
  /(^|\/)poetry\.lock$/i,
  /(^|\/)packages\.lock\.json$/i,
  /(^|\/)node_modules\//i,
  /(^|\/)(dist|out|build|bin|obj)\//i,
  /\.min\.(js|css)$/i,
  /\.(snap|lock)$/i,
  /(^|\/)_verify\//i
]

export function isGeneratedPath(path: string): boolean {
  const p = path.replace(/\\/g, '/')
  return GENERATED_PATTERNS.some((re) => re.test(p))
}

/**
 * Extensions the symbol harvest is allowed to read.
 *
 * ⚠ AN ALLOWLIST, AND IT EXISTS BECAUSE THE FIRST REAL RUN FABRICATED AN API.
 * The `Phase 6 docs` commit added ten markdown specs containing TypeScript and
 * Cypher samples, and the harvest reported `INDEX_BATCH_SIZE`,
 * `UPSERT_COMMITS`, `ContainerState` and `IndexReport` as new API surface for
 * the day. Not one of them was written as code — they were illustrations
 * inside a design document. A timesheet naming work that never happened is the
 * worst failure this feature has, worse than naming nothing, so prose files
 * are excluded from the harvest entirely.
 *
 * They are NOT excluded from the commit list: "wrote ten spec documents" is a
 * real day's work and appears there, by filename.
 */
const HARVESTABLE_EXTENSIONS: readonly string[] = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte',
  '.cs', '.fs', '.vb',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift',
  '.c', '.h', '.cpp', '.hpp', '.cc', '.m', '.mm',
  '.php', '.scala', '.dart', '.sql'
]

export function isHarvestablePath(path: string): boolean {
  if (isGeneratedPath(path)) return false
  const p = path.replace(/\\/g, '/').toLowerCase()
  return HARVESTABLE_EXTENSIONS.some((ext) => p.endsWith(ext))
}

/* ───────────────────────── symbol harvest ───────────────────────── */

/**
 * What the day ADDED, in the vocabulary a timesheet actually uses: classes,
 * functions, interfaces, endpoints, tests. Filenames alone do not carry this —
 * "modified ipc.ts" is not a description of work, whereas "added
 * `memoryContractLines`" is.
 *
 * ⚠ ADDED LINES ONLY, and never `+++` (the diff's own file header). A symbol
 * harvested from a context line would be reported as new every day it happened
 * to sit near an edit.
 *
 * ⚠ TWO LANGUAGE FAMILIES ON PURPOSE. This machine's projects are TypeScript
 * (Chorus, InboxRail) and C#/.NET (TaxApp, TrupanionDE), so a TS-only harvest
 * would return nothing for half the rail and the report would quietly look
 * like the .NET work never happened. Python is included because it is cheap
 * and costs one pattern.
 */
const SYMBOL_PATTERNS: readonly RegExp[] = [
  // TypeScript / JavaScript — exported surface only. A non-exported local is
  // an implementation detail and belongs in nobody's timesheet.
  /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|enum|const)\s+([A-Za-z_$][\w$]*)/,
  // C# / .NET — type declarations. Access modifier required, so a local type
  // inside a method body is not harvested.
  /\b(?:public|internal|protected)\s+(?:static\s+|sealed\s+|abstract\s+|partial\s+|readonly\s+|async\s+)*(?:class|interface|record|struct|enum)\s+([A-Za-z_][\w]*)/,
  // ASP.NET route attributes — the closest thing to "an API was added".
  /\[(?:Http(?:Get|Post|Put|Delete|Patch)|Route)\("([^"]+)"\)/,
  // Python.
  /^\s*(?:async\s+)?def\s+([a-z_][\w]*)/
]

const TEST_PATTERNS: readonly RegExp[] = [
  // Vitest / Jest / Mocha. The name is truncated by the caller, not here.
  /^\s*(?:it|test)\s*(?:\.\w+)?\s*\(\s*['"`](.+)$/,
  // xUnit / NUnit / MSTest — the attribute marks the test, the NAME is on the
  // following line, so the method signature is matched instead.
  /\b(?:public|internal)\s+(?:async\s+)?(?:Task|void)\s+([A-Za-z_][\w]*)\s*\(/
]

/** A test name as written, trimmed to something a report can list. */
function tidyTestName(raw: string): string {
  // Strip the closing quote and everything after it, then cap. Test names in
  // this codebase run long by design ("⚠ codex with NO contract is
  // byte-identical to HEAD, jade pair included") and the full sentence is more
  // useful than a truncation, up to a point.
  const cut = raw.replace(/['"`]\s*[,)].*$/, '').replace(/['"`]$/, '')
  return cut.length > 120 ? `${cut.slice(0, 117)}…` : cut.trim()
}

export interface HarvestResult {
  readonly symbols: readonly string[]
  readonly tests: readonly string[]
}

/**
 * Harvest from a unified diff. Expects `-p --unified=0` output so that only
 * genuinely-added lines carry a `+`.
 *
 * `skipPath` lets the caller exclude generated files; it is passed rather than
 * assumed so the test can drive both halves.
 */
export function harvestSymbols(
  patch: string,
  skipPath: (path: string) => boolean = (p) => !isHarvestablePath(p)
): HarvestResult {
  const symbols = new Set<string>()
  const tests = new Set<string>()
  let skipping = false

  for (const rawLine of patch.split('\n')) {
    const line = rawLine.replace(/\r$/, '')

    // `diff --git a/x b/y` opens each file's section; decide once whether the
    // whole section is worth reading.
    if (line.startsWith('diff --git ')) {
      const to = line.split(' b/')[1]
      skipping = to !== undefined && skipPath(to)
      continue
    }
    if (skipping) continue
    // `+++ b/path` is the header, not content. Checked BEFORE the `+` test,
    // which it would otherwise satisfy.
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (!line.startsWith('+')) continue

    const added = line.slice(1)
    for (const re of SYMBOL_PATTERNS) {
      const m = re.exec(added)
      if (m && m[1]) symbols.add(m[1])
    }
    for (const re of TEST_PATTERNS) {
      const m = re.exec(added)
      if (m && m[1]) {
        const name = tidyTestName(m[1])
        if (name !== '') tests.add(name)
      }
    }
  }

  return { symbols: [...symbols].sort(), tests: [...tests].sort() }
}

/* ───────────────────────── dirty working tree ───────────────────────── */

/** One line of `git status --porcelain`, split into status and path. Handles
 *  the quoted form git uses for paths with spaces or non-ASCII bytes. */
export function parseStatusLine(line: string): { status: string; path: string } | null {
  if (line.length < 4) return null
  const status = line.slice(0, 2).trim()
  let path = line.slice(3)
  // Renames read `R  old -> new`; the destination is the file that exists now.
  const arrow = path.indexOf(' -> ')
  if (arrow !== -1) path = path.slice(arrow + 4)
  if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1)
  if (path === '') return null
  return { status: status === '' ? '?' : status, path }
}

/**
 * ⚠ THE FILTER THAT KEEPS THIS REPORT HONEST, AND IT WAS FOUND BY RUNNING THE
 * SWEEP RATHER THAN BY REASONING.
 *
 * `git status` answers "what is dirty NOW". It carries no timestamp, so a
 * report that listed everything dirty would credit today with however long a
 * branch has been sitting. Measured on this machine: `InboxRail` has 31 dirty
 * paths totalling 809 insertions, and every one of them was last written on
 * **August 9th and 10th**. Billing that to today is not a cosmetic bug — it is
 * a false timesheet.
 *
 * The file's mtime is the only timestamp available, and it is sufficient: a
 * file an agent edited today has today's mtime. It is not PERFECT — touching a
 * file without changing it moves the mtime, and a checkout rewrites mtimes
 * wholesale — which is why in-flight work is rendered as a separate,
 * clearly-labelled section rather than mixed in with commits.
 */
export function filterDirtyByMtime(
  entries: readonly { status: string; path: string; mtimeMs: number }[],
  windowStartMs: number,
  windowEndMs: number
): DayDirtyFile[] {
  return entries
    .filter((e) => e.mtimeMs >= windowStartMs && e.mtimeMs <= windowEndMs)
    .map((e) => ({
      path: e.path,
      status: e.status,
      modifiedAt: new Date(e.mtimeMs).toISOString()
    }))
    .sort((a, b) => a.path.localeCompare(b.path))
}

/* ───────────────────────── assembly ───────────────────────── */

/** Canonical comparison key for a repository. Windows paths are
 *  case-insensitive and git emits forward slashes while node emits
 *  backslashes — the same normalisation `git.ts:pathKey` performs, repeated
 *  here rather than imported so this module stays dependency-free. */
export function canonicalRepoKey(commonDir: string): string {
  return commonDir.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/** True when a repo contributed nothing to the day. Used to drop it from the
 *  report entirely — an empty heading per project is noise, and with six
 *  projects it would be most of the page. */
export function isEmptyRepo(repo: DayRepoEvidence): boolean {
  return repo.commits.length === 0 && repo.dirty.length === 0
}

/**
 * Fold a previously-stored day into a freshly-collected one.
 *
 * ⚠ THIS EXISTS BECAUSE REGENERATING A PAST DAY IS LOSSY IN ONE DIRECTION
 * ONLY. Commits are reproducible from git forever, so the fresh collection
 * always wins for those. In-flight work is not: it is bounded by file mtime,
 * and the moment those files are committed or touched again, the evidence that
 * they were being worked on *on that date* is gone from the machine. Re-running
 * Monday's report on Wednesday would therefore silently EMPTY its in-flight
 * section — the report would look complete and would have quietly lost the
 * half that no other system can rebuild.
 *
 * So dirty files are UNIONED by path and commits are REPLACED. A file that was
 * being edited on the 15th was being edited on the 15th; committing it on the
 * 16th does not undo that, and it may legitimately appear in both sections.
 *
 * Repositories present only in the stored copy are carried over whole, for the
 * same reason: a project removed from the rail must not erase the day it was
 * worked on.
 */
export function mergeDayEvidence(stored: DayEvidence, fresh: DayEvidence): DayEvidence {
  const byKey = new Map<string, DayRepoEvidence>()
  for (const repo of stored.repos) byKey.set(repo.repoKey, repo)

  const merged: DayRepoEvidence[] = []
  for (const repo of fresh.repos) {
    const prior = byKey.get(repo.repoKey)
    byKey.delete(repo.repoKey)
    if (prior === undefined) {
      merged.push(repo)
      continue
    }
    const seen = new Set(repo.dirty.map((d) => d.path))
    const carried = prior.dirty.filter((d) => !seen.has(d.path))
    merged.push({
      ...repo,
      // Names can grow: a repo gains a second project between captures.
      projectNames: [...new Set([...prior.projectNames, ...repo.projectNames])],
      dirty: [...repo.dirty, ...carried].sort((a, b) => a.path.localeCompare(b.path)),
      symbols: [...new Set([...prior.symbols, ...repo.symbols])].sort(),
      tests: [...new Set([...prior.tests, ...repo.tests])].sort()
    })
  }

  // Whatever the fresh sweep never saw at all.
  for (const orphan of byKey.values()) merged.push(orphan)

  return { ...fresh, repos: merged }
}

/* ───────────────────────── render ───────────────────────── */

function statusWord(status: string): string {
  if (status.startsWith('A') || status.startsWith('?')) return 'new'
  if (status.startsWith('D')) return 'deleted'
  if (status.startsWith('R')) return 'renamed'
  return 'changed'
}

/** Cap a list in the render and SAY that it was capped. A silent truncation
 *  reads as completeness — the same rule the workflow guidance applies to
 *  dropped work. */
function capped(items: readonly string[], limit: number): string {
  if (items.length <= limit) return items.join(', ')
  return `${items.slice(0, limit).join(', ')} (+${items.length - limit} more)`
}

/**
 * The timesheet artifact. Markdown, because it pastes into a ticket, a notes
 * app and a spreadsheet cell alike.
 *
 * `prose` is the model's tie-together sentence, or null when no summarizer is
 * configured or the call failed. **The report renders either way** — the
 * evidence is the durable part and the prose is a convenience over it, so a
 * missing key degrades the output rather than blocking it.
 */
export function renderMarkdown(evidence: DayEvidence, prose: string | null): string {
  const out: string[] = [`# Work summary — ${evidence.date}`, '']

  if (prose !== null && prose.trim() !== '') {
    out.push(prose.trim(), '')
  }

  const repos = evidence.repos.filter((r) => !isEmptyRepo(r))
  if (repos.length === 0) {
    out.push('_No commits and no in-flight changes were found for this date._', '')
  }

  for (const repo of repos) {
    out.push(`## ${repo.projectNames.join(' · ')}`, '')

    for (const commit of repo.commits) {
      const real = commit.files.filter((f) => !isGeneratedPath(f.path))
      const generated = commit.files.length - real.length
      const bits: string[] = []
      if (real.length > 0) {
        bits.push(`${real.length} file${real.length === 1 ? '' : 's'}`)
      }
      if (generated > 0) bits.push(`${generated} generated`)
      out.push(`- **${commit.subject}** — ${bits.join(', ')} \`${commit.sha}\``)

      // Name the NEW files explicitly. "Added instructionsCore.ts" is the kind
      // of line a timesheet can be written from; "modified 14 files" is not.
      const added = real.filter((f) => f.status.startsWith('A')).map((f) => f.path)
      if (added.length > 0) out.push(`  - New: ${capped(added, 6)}`)
    }

    if (repo.symbols.length > 0) {
      out.push('', `**New API surface:** ${capped(repo.symbols, 15)}`)
    }
    if (repo.tests.length > 0) {
      out.push(
        '',
        `**Tests added (${repo.tests.length}):** ${capped(
          repo.tests.map((t) => `“${t}”`),
          5
        )}`
      )
    }

    if (repo.dirty.length > 0) {
      out.push('', `**In flight (uncommitted, edited this day):**`)
      for (const f of repo.dirty.slice(0, 20)) {
        out.push(`- ${f.path} _(${statusWord(f.status)})_`)
      }
      if (repo.dirty.length > 20) {
        out.push(`- _…and ${repo.dirty.length - 20} more_`)
      }
    }
    out.push('')
  }

  if (evidence.skipped.length > 0) {
    out.push('---', '', '_Not included:_')
    for (const s of evidence.skipped) {
      out.push(`- ${s.projectName} — ${s.reason}`)
    }
    out.push('')
  }

  return out.join('\n')
}

/* ───────────────────────── summarizer prompt ───────────────────────── */

/**
 * ⚠ THE "DO NOT ENUMERATE" RULE IS THE LOAD-BEARING ONE, AND IT WAS WRITTEN
 * AFTER READING A REAL RESPONSE. The first live run returned two 75-word
 * sentences that walked every file in the evidence — `ICchTokenStore` via
 * `EfCchTokenStore` and `InMemoryCchTokenStore`, then `CchAccessTokenProvider`,
 * then the registration extension… — which is precisely the list rendered
 * directly beneath it. A summary that restates its own bullets is not a
 * summary; the reader has to read everything twice to discover they were the
 * same thing. The word ceiling is what makes the instruction enforceable,
 * because "1 to 3 sentences" alone permits one enormous sentence and that is
 * exactly what came back.
 */
export const SUMMARY_SYSTEM_PROMPT = [
  'You write the opening line of a developer’s daily work log, for their own timesheet and project notes.',
  '',
  'Rules:',
  '- 1 to 3 sentences, 60 words MAXIMUM. Shorter is better.',
  '- CHARACTERISE the day; do NOT enumerate it. A detailed list of every commit and file is rendered directly below your text — repeating it wastes the reader’s time.',
  '- Name at most two or three of the most significant things, and only to make the shape of the day concrete.',
  '- Say what KIND of work it was: a feature, a refactor, tests, docs, a bug hunt, wiring, planning.',
  '- If several projects were touched, give each one a clause. Name the projects.',
  '- No preamble, no heading, no bullets, no code fences.',
  '- Never mention which AI agent or tool produced anything — the reader does not care and the evidence does not say.',
  '- Never invent work that is not in the evidence, and never estimate hours or effort.',
  '- Plain past tense. No marketing adjectives, no "successfully", no "comprehensive".'
].join('\n')

/**
 * The evidence, compacted for the model. Deliberately NOT the raw markdown:
 * the render is shaped for a human reader and carries repetition (shas, file
 * counts) that costs tokens and adds nothing to the prose task.
 *
 * ⚠ NO FILE CONTENT AND NO DIFF TEXT LEAVES THE MACHINE — only paths, commit
 * subjects, and symbol NAMES already harvested. This is the same egress
 * discipline the council brief scanner enforces, and it matters more here
 * because this report can be generated against every project at once, without
 * the user reading it first.
 */
export function buildSummaryPrompt(evidence: DayEvidence): string {
  const lines: string[] = [`Date: ${evidence.date}`, '']
  for (const repo of evidence.repos.filter((r) => !isEmptyRepo(r))) {
    lines.push(`Project: ${repo.projectNames.join(' / ')}`)
    for (const c of repo.commits) {
      const real = c.files.filter((f) => !isGeneratedPath(f.path))
      lines.push(`  commit: ${c.subject}`)
      if (real.length > 0) {
        lines.push(`    files: ${capped(real.map((f) => f.path), 12)}`)
      }
    }
    if (repo.symbols.length > 0) lines.push(`  new symbols: ${capped(repo.symbols, 20)}`)
    if (repo.tests.length > 0) lines.push(`  tests added: ${repo.tests.length}`)
    if (repo.dirty.length > 0) {
      lines.push(`  uncommitted, edited this day: ${capped(repo.dirty.map((d) => d.path), 12)}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}
