/**
 * `index-codebase` — the pure half (Task 6a-2, D149).
 *
 * ⚠ PURE. No `fs`, no `child_process`, no driver, no `electron`. Path rules,
 * directory derivation, batching, the git-log parser, and the Cypher as
 * constants. The impure half — spawning git, opening a session, writing — is
 * `memoryService.index`.
 *
 * ⚠ THE TWO RULES THAT OUTRANK EVERYTHING ELSE IN THIS FILE:
 *
 * **1. NOTHING HERE DELETES.** Every statement is a `MERGE` or a `SET`. A
 * `:Memory` counts as sourced only while its `SUPPORTED_BY` target still
 * exists (identity model §6), so deleting a `:File` would drop a memory out of
 * `memory:validate`'s numerator — and the project's trust ratio would fall
 * **because a refresh ran**. That is a corruption wearing the costume of a
 * measurement. A file that leaves the tree is MARKED (`missingSince`), never
 * removed, and neither is any edge pointing at it. `codeIndexCore.test.ts`
 * asserts the absence of `DELETE`/`DETACH`/`REMOVE` over the exported
 * constants, so the rule is enforced rather than remembered.
 *
 * **2. THIS INDEXES CODE; IT DOES NOT UNDERSTAND CODE.** No symbols, no
 * `:Class`, no `:Method`, no `CALLS`, no source text, no embeddings (D149).
 * *"What calls this method"* is not answerable after this task. The UI says so
 * in plain words, because a user expecting comprehension will conclude the
 * feature is broken rather than that it is honest.
 */

/* ───────────────────────── path identity ───────────────────────── */

export type NormalizedPath =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly reason: string }

/**
 * Identity model §4, exactly. This is the ONLY place a path becomes an
 * identity, and it REFUSES rather than clamps.
 *
 * ⚠ REFUSE, NEVER CLAMP. A path that leaves its instance root is not
 * repository-relative, and silently clamping it INVENTS an identity that will
 * collide with a real file's — a wrong node that answers queries.
 *
 * ⚠ NFC, AND CASE IS PRESERVED, NOT FOLDED. git is case-sensitive and NTFS is
 * not; folding would MERGE two files git considers distinct, which is silent
 * data loss. Preserving means `SRC/App.vue` and `src/app.vue` can produce two
 * nodes on Windows. Both directions are wrong somewhere, and a DECLARED limit
 * beats a hidden one — the test asserts this rather than leaving it for
 * someone to "fix" into a fold.
 */
export function normalizeRelPath(raw: string): NormalizedPath {
  const slashed = raw.replace(/\\/g, '/')
  const trimmed = slashed.replace(/^\.\//, '').replace(/\/+$/, '')
  if (trimmed === '') {
    return { ok: false, reason: 'An empty path is not a file in this repository.' }
  }
  if (/^[A-Za-z]:/.test(trimmed) || trimmed.startsWith('/')) {
    return {
      ok: false,
      reason: `"${raw}" is an absolute path; only repository-relative paths are indexed.`
    }
  }
  if (trimmed.split('/').some((seg) => seg === '..')) {
    return {
      ok: false,
      reason: `"${raw}" escapes the repository root and cannot be given an identity.`
    }
  }
  return { ok: true, value: trimmed.normalize('NFC') }
}

/**
 * `'a/b/c.ts'` → `['a', 'a/b']`, in that order.
 *
 * ⚠ THE REPOSITORY ROOT IS NOT A `:Directory`. Its relPath would be the empty
 * string, and an empty-string identity collides across every workspace
 * instance in the graph — one node every project would claim.
 */
export function directoryChain(relPath: string): readonly string[] {
  const segments = relPath.split('/')
  const chain: string[] = []
  for (let i = 1; i < segments.length; i++) {
    chain.push(segments.slice(0, i).join('/'))
  }
  return chain
}

/** The final segment of a path — a file's or directory's display name. */
export function baseName(relPath: string): string {
  const at = relPath.lastIndexOf('/')
  return at === -1 ? relPath : relPath.slice(at + 1)
}

/**
 * The dotted extension, lowercased, or `''` when there is none.
 *
 * ⚠ LOWERCASED, WHICH IS THE OPPOSITE OF THE `relPath` RULE ABOVE, AND
 * DELIBERATELY SO. `relPath` is IDENTITY and folding it would merge two real
 * files; `ext` is an ATTRIBUTE used for filtering ("show me the .ts files"),
 * where `.TS` and `.ts` being two answers is a nuisance with no upside. The
 * two fields are treated differently because they are different KINDS of
 * value, not by oversight.
 */
export function extensionOf(name: string): string {
  const at = name.lastIndexOf('.')
  // A leading dot is a dotfile (`.gitignore`), not an extension.
  if (at <= 0) return ''
  return name.slice(at).toLowerCase()
}

/* ───────────────────────── batching ───────────────────────── */

export const INDEX_BATCH_SIZE = 200

/** ⚠ A REPORTED CAP, NEVER A SILENT ONE. See `IndexReport.commitsSkippedBeyondLimit`
 *  — a truncation nobody is told about reads as "we covered everything". */
export const INDEX_COMMIT_LIMIT = 200

export function batched<T>(
  rows: readonly T[],
  size: number = INDEX_BATCH_SIZE
): readonly (readonly T[])[] {
  if (size <= 0) throw new Error('batch size must be positive')
  const out: T[][] = []
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size))
  return out
}

/* ───────────────────────── row builders ───────────────────────── */

export interface FileRow {
  readonly relPath: string
  readonly name: string
  readonly ext: string
  readonly absPathAtWrite: string
}

export interface DirectoryRow {
  readonly relPath: string
  readonly name: string
}

export interface ContainsRow {
  readonly parent: string
  readonly child: string
}

export interface BuiltRows {
  readonly files: readonly FileRow[]
  readonly directories: readonly DirectoryRow[]
  readonly contains: readonly ContainsRow[]
  /** Paths `normalizeRelPath` refused, with their reasons. Counted and
   *  surfaced — never silently dropped. */
  readonly refused: readonly { readonly raw: string; readonly reason: string }[]
}

/**
 * Turn a flat list of tracked paths into everything the upserts need.
 *
 * `repoRootAtWrite` is joined with `/` rather than the platform separator: the
 * value is a diagnostic recorded alongside the node ("where this was when we
 * saw it"), not an identity, and a forward-slash form is what git itself
 * reports.
 */
export function buildRows(rawPaths: readonly string[], repoRootAtWrite: string): BuiltRows {
  const files: FileRow[] = []
  const refused: { raw: string; reason: string }[] = []
  const directories = new Map<string, DirectoryRow>()
  const contains = new Map<string, ContainsRow>()
  const root = repoRootAtWrite.replace(/\\/g, '/').replace(/\/+$/, '')

  for (const raw of rawPaths) {
    const norm = normalizeRelPath(raw)
    if (!norm.ok) {
      refused.push({ raw, reason: norm.reason })
      continue
    }
    const relPath = norm.value
    const name = baseName(relPath)
    files.push({ relPath, name, ext: extensionOf(name), absPathAtWrite: `${root}/${relPath}` })

    const chain = directoryChain(relPath)
    for (const dir of chain) {
      if (!directories.has(dir)) directories.set(dir, { relPath: dir, name: baseName(dir) })
    }
    // Parent→child edges: directory to directory along the chain, then the
    // deepest directory to the file itself. The root is not a node, so a
    // top-level file gets no CONTAINS edge — correct, not a gap.
    //
    // The de-duplication key joins the pair with a NUL rather than a space or
    // a slash, because both of those are legal in a path and would let two
    // different pairs collide into one key.
    for (let i = 1; i < chain.length; i++) {
      const key = `${chain[i - 1]}\u0000${chain[i]}`
      if (!contains.has(key)) contains.set(key, { parent: chain[i - 1], child: chain[i] })
    }
    const deepest = chain[chain.length - 1]
    if (deepest !== undefined) {
      const key = `${deepest}\u0000${relPath}`
      if (!contains.has(key)) contains.set(key, { parent: deepest, child: relPath })
    }
  }

  return {
    files,
    directories: [...directories.values()],
    contains: [...contains.values()],
    refused
  }
}

/* ───────────────────────── the git log parser ───────────────────────── */

/** ASCII US (0x1f), the field separator inside a log record's header. Written
 *  as an ESCAPE rather than as a literal byte: a raw control character makes the
 *  source file "binary" to grep and can be silently eaten by an editor or a
 *  reformat. `dayReportCore.ts` keeps the same rule for the same reason. */
export const LOG_FIELD_SEP = '\u001f'

/** Each record of the §0 log invocation opens with this sentinel. `\x1f` (US)
 *  cannot occur in a Windows filename, so a path can never be mistaken for a
 *  record header. */
export const LOG_RECORD_PREFIX = `C${LOG_FIELD_SEP}`

export interface IndexedCommit {
  readonly sha: string
  readonly authoredAt: string
  readonly subject: string
  readonly paths: readonly string[]
}

export interface ParsedLog {
  readonly commits: readonly IndexedCommit[]
  /** Paths git still quoted despite `core.quotepath=false` — one containing a
   *  `"` or a newline. SKIPPED AND COUNTED, never guessed at, and the count
   *  reaches the renderer.
   *
   *  ⚠ UNREACHABLE ON WINDOWS AND KEPT ANYWAY: NTFS forbids both characters in
   *  a filename, so this is 0 on the only platform v1 supports. It is a guard
   *  for the repository cloned from elsewhere, and it costs one branch. */
  readonly skippedPaths: number
}

/**
 * Parse `git -c core.quotepath=false log --no-renames --name-only
 * --pretty=format:"C%x1f%H%x1f%aI%x1f%s"`.
 *
 * ⚠ WRITTEN AGAINST CAPTURED BYTES (`_verify/6a-2/log-name-only.txt`, 200
 * records from this repository), not against recall. Two framing facts came
 * out of that capture and neither is guessable:
 *
 *   · a commit that touches NO files has NO blank line after it — the next
 *     record's sentinel follows immediately. Ten merges and four empty commits
 *     in the newest 200 here, so this is the common case, not a curiosity.
 *   · records that DO have files are separated by a blank line.
 *
 * Driving off the sentinel rather than off blank lines handles both without a
 * special case.
 *
 * TOTAL: a malformed record is skipped rather than thrown on. One odd commit
 * must not cost the whole index.
 */
export function parseGitLogNameOnly(out: string): ParsedLog {
  const commits: IndexedCommit[] = []
  let skippedPaths = 0
  let current: { sha: string; authoredAt: string; subject: string; paths: string[] } | null = null

  const flush = (): void => {
    if (current !== null) commits.push({ ...current, paths: current.paths })
    current = null
  }

  for (const rawLine of out.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (line.startsWith(LOG_RECORD_PREFIX)) {
      flush()
      const [sha, authoredAt, ...subjectParts] = line.slice(LOG_RECORD_PREFIX.length).split(LOG_FIELD_SEP)
      if (sha === undefined || authoredAt === undefined || subjectParts.length === 0) continue
      current = { sha, authoredAt, subject: subjectParts.join(LOG_FIELD_SEP), paths: [] }
      continue
    }
    if (line === '' || current === null) continue
    // A quoted path is one git could not emit literally. Counted, not parsed:
    // un-escaping git's octal form by hand is exactly the kind of guess that
    // produces a wrong identity.
    if (line.startsWith('"')) {
      skippedPaths++
      continue
    }
    const norm = normalizeRelPath(line)
    if (!norm.ok) {
      skippedPaths++
      continue
    }
    current.paths.push(norm.value)
  }
  flush()

  return { commits, skippedPaths }
}

/* ───────────────────────── the Cypher ───────────────────────── */

/**
 * ⚠ EVERY STATEMENT BELOW IS A `MERGE` OR A `SET`. There is no `DELETE`, no
 * `DETACH` and no `REMOVE` in this file, and `codeIndexCore.test.ts` asserts
 * that over these exported constants. See this module's header for why.
 *
 * ⚠ AND EVERY LABEL BELOW IS STRUCTURAL. `:File`, `:Directory`, `:Commit`,
 * `:Project` and two edge types — nothing from the memory namespace
 * (`:Memory`, `:Decision`, `:Observation`, `:Risk`, `SUPPORTED_BY`). That
 * label boundary is the entire safety argument for keeping one graph rather
 * than two databases (D147(c)).
 */
export const UPSERT_PROJECT = `
MERGE (p:Project {id: $projectId})
  SET p.name = $projectName, p.lastIndexedAt = $runId
`.trim()

export const UPSERT_FILES = `
UNWIND $rows AS row
MERGE (f:File {workspaceInstanceId: $workspaceInstanceId, relPath: row.relPath})
  SET f.name             = row.name,
      f.ext              = row.ext,
      f.chorusProjectId  = $projectId,
      f.absPathAtWrite   = row.absPathAtWrite,
      f.repoRootAtWrite  = $repoRootAtWrite,
      f.lastIndexedAt    = $runId,
      f.missingSince     = null
`.trim()

export const UPSERT_DIRECTORIES = `
UNWIND $rows AS row
MERGE (d:Directory {workspaceInstanceId: $workspaceInstanceId, relPath: row.relPath})
  SET d.name = row.name, d.chorusProjectId = $projectId, d.lastIndexedAt = $runId
`.trim()

export const LINK_CONTAINS = `
UNWIND $rows AS row
MATCH (parent:Directory {workspaceInstanceId: $workspaceInstanceId, relPath: row.parent})
MATCH (child            {workspaceInstanceId: $workspaceInstanceId, relPath: row.child})
WHERE child:File OR child:Directory
MERGE (parent)-[:CONTAINS]->(child)
`.trim()

export const UPSERT_COMMITS = `
UNWIND $rows AS row
MERGE (c:Commit {repoId: $repoId, sha: row.sha})
  SET c.message = row.subject, c.authoredAt = row.authoredAt, c.chorusProjectId = $projectId
`.trim()

export const LINK_MODIFIED = `
UNWIND $rows AS row
MATCH (c:Commit {repoId: $repoId, sha: row.sha})
MATCH (f:File {workspaceInstanceId: $workspaceInstanceId, relPath: row.relPath})
MERGE (c)-[:MODIFIED]->(f)
`.trim()

/**
 * ⚠ MARK, NEVER DELETE — and mark by the RUN STAMP rather than by a list of
 * present paths. Passing every path back as a parameter would send the whole
 * tree over the wire a second time and grow without bound on a large repo.
 * Every file this run touched already carries `lastIndexedAt = $runId`, so
 * "everything this run did not touch" is a cheap, exact complement.
 *
 * A file that comes back is un-marked for free: `UPSERT_FILES` sets
 * `missingSince = null` on every path it writes.
 */
export const MARK_MISSING = `
MATCH (f:File {workspaceInstanceId: $workspaceInstanceId})
WHERE f.lastIndexedAt <> $runId AND f.missingSince IS NULL
  SET f.missingSince = $runId
RETURN count(f) AS marked
`.trim()

/** Every statement this module can execute — the surface the no-deletion test
 *  walks. A statement added without being listed here is one the test does not
 *  cover, so the list is part of the guard rather than a convenience. */
export const ALL_INDEX_STATEMENTS: readonly string[] = [
  UPSERT_PROJECT,
  UPSERT_FILES,
  UPSERT_DIRECTORIES,
  LINK_CONTAINS,
  UPSERT_COMMITS,
  LINK_MODIFIED,
  MARK_MISSING
]

/** `'pj:' + projectId` — the project's OWN checkout, and only that. A worktree
 *  is a short-lived view of the same repository; indexing each would multiply
 *  every node by the number of live worktrees and make `MODIFIED` edges
 *  ambiguous. The report carries this value so the UI can say which tree was
 *  indexed. */
export function workspaceInstanceIdFor(projectId: string): string {
  return `pj:${projectId}`
}

/**
 * The repository identifier: the root-commit SHA, lexicographically smallest
 * when a repository has more than one root.
 *
 * ⚠ THE TIE-BREAK IS LEXICOGRAPHIC AND NOT BY DATE (identity model §3(i)).
 * Committer and author dates are user-settable and `rev-list` does not
 * document its output order, so a date rule is not guaranteed to give two
 * machines the same answer — which is the one property this identifier exists
 * to have.
 *
 * `null` for a repository with no commits, which is NOT an error: a project
 * need not be a git repository at all. Then no `:Commit` may be written, and
 * files still index.
 */
export function repoIdFrom(rootCommitShas: readonly string[]): string | null {
  if (rootCommitShas.length === 0) return null
  return [...rootCommitShas].sort()[0]
}
