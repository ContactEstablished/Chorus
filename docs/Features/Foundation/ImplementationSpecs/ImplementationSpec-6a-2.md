# Implementation Spec 6a-2 — `index-codebase`

_Pairs with [`../Tasks/Task-6a-2.md`](../Tasks/Task-6a-2.md). Authored 2026-08-14 against `47f633c`._

**Read the task doc first**, and read [`../Phase-6-IdentityModel.md`](../Phase-6-IdentityModel.md)
before writing a single `MERGE`. This document carries the Cypher, the git invocations, and the
checks that prove the indexer did not damage provenance.

---

## §0 — Capture before you parse

**Two git invocations must be run and saved before their parsers are written.** Format strings are
exactly the kind of fact CLAUDE.md forbids trusting recall for, and git's path quoting is the trap
that will not show up until a file with an accented character exists.

```powershell
git ls-files -z > _verify\6a-2\ls-files.bin
git -c core.quotepath=false log -n 200 --no-renames --name-only --pretty=format:"C%x1f%H%x1f%aI%x1f%s" > _verify\6a-2\log-name-only.txt
git rev-list --max-parents=0 HEAD > _verify\6a-2\root-commits.txt
```

Measured on this machine 2026-08-14: **447 tracked files**, root commit
`a92099d934dd95548e59525b7231fd4b5f5d5f6f` — which matches the identity model's own independent
measurement, so the `repoId` rule is confirmed rather than assumed.

**Why `core.quotepath=false` and not `-z` for the log:** `-z` changes the record framing of
`--name-only` output in a way that has to be discovered empirically, while `core.quotepath=false`
leaves the framing as lines and simply stops git from escaping non-ASCII bytes. A path that git
still quotes (one containing `"` or a newline — vanishingly rare on Windows) is **skipped and
counted**, never guessed at. `ls-files` keeps `-z` because a flat NUL-separated list has no framing
question at all.

---

## §1 — Graph migration v2 (`graphSchemaCore.ts`)

Appended to `GRAPH_MIGRATIONS` (`:51`). **Every statement must be applied against a real
`neo4j:5-community` before it is hardcoded** — the file's own docblock says composite-constraint
syntax changed across Neo4j majors and that all ten v1 statements were probed first. Do the same;
extend `_verify/6-4-probe-constraints.mjs` rather than writing a new probe.

```ts
  {
    version: 2,
    name: 'code-structure-identity',
    statements: [
      // Same key as :File, for the same reason — a directory exists per
      // workspace instance, and an absolute path is never key material.
      `CREATE CONSTRAINT directory_identity IF NOT EXISTS FOR (d:Directory) REQUIRE (d.workspaceInstanceId, d.relPath) IS UNIQUE`,
      // The structural namespace is queried per project far more often than per
      // instance ("what is in this project"), and `file_workspace`'s own
      // measurement (identity model, appendix) showed Neo4j will NOT use a
      // composite constraint index for a leading-property-only lookup here.
      `CREATE INDEX file_project IF NOT EXISTS FOR (f:File) ON (f.chorusProjectId)`,
      `CREATE INDEX directory_workspace IF NOT EXISTS FOR (d:Directory) ON (d.workspaceInstanceId)`,
      // "Which files has this repo's history touched" is the second question the
      // index exists to answer, and it scans without this.
      `CREATE INDEX commit_repo IF NOT EXISTS FOR (c:Commit) ON (c.repoId)`
    ]
  }
```

`LATEST_GRAPH_VERSION` derives itself (`:88`) — **do not hardcode 2 anywhere.**

**⚠ The version-skew case is already solved.** `pendingMigrations` (`:107`) refuses a graph written
by a newer Chorus with an authored sentence. Nothing in this task re-implements it, and the existing
test for `pendingMigrations(current > LATEST)` must keep passing with the new value.

---

## §2 — `src/main/services/codeIndexCore.ts` (new, pure)

### Path normalization — identity model §4, exactly

```ts
export type NormalizedPath =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly reason: string }

export function normalizeRelPath(raw: string): NormalizedPath {
  const slashed = raw.replace(/\\/g, '/')
  const trimmed = slashed.replace(/^\.\//, '').replace(/\/+$/, '')
  if (trimmed === '') return { ok: false, reason: 'An empty path is not a file in this repository.' }
  // ⚠ REFUSE, NEVER CLAMP. A path that leaves its instance root is not
  // repository-relative, and silently clamping it INVENTS AN IDENTITY that
  // will collide with a real file's.
  if (/^[A-Za-z]:/.test(trimmed) || trimmed.startsWith('/')) {
    return { ok: false, reason: `"${raw}" is an absolute path; only repository-relative paths are indexed.` }
  }
  if (trimmed.split('/').some((seg) => seg === '..')) {
    return { ok: false, reason: `"${raw}" escapes the repository root and cannot be given an identity.` }
  }
  // ⚠ NFC, AND CASE IS PRESERVED, NOT FOLDED. git is case-sensitive and NTFS is
  // not; folding would MERGE two files git considers distinct — a silent data
  // loss. Preserving means two spellings can produce two nodes on Windows.
  // Both are wrong in some direction and a DECLARED limit beats a hidden one
  // (identity model §4).
  return { ok: true, value: trimmed.normalize('NFC') }
}
```

### Directory chains

```ts
/** 'a/b/c.ts' -> ['a', 'a/b'], in that order. The repository ROOT is not a
 *  :Directory — it has no relPath that is not the empty string, and an
 *  empty-string identity would collide across every instance. */
export function directoryChain(relPath: string): readonly string[]
```

### Batching

```ts
export const INDEX_BATCH_SIZE = 200
export const INDEX_COMMIT_LIMIT = 200
export function batched<T>(rows: readonly T[], size = INDEX_BATCH_SIZE): readonly (readonly T[])[]
```

`INDEX_COMMIT_LIMIT` is a **reported** cap, never a silent one — see §4's report shape. At 447 files
this repo indexes in three file batches.

### The Cypher, as exported constants

**⚠ EVERY STATEMENT IS A `MERGE` OR A `SET`. There is no `DELETE`, no `DETACH`, no `REMOVE` in this
file, and a test asserts that over the exported constants.** The reason is the provenance trap: a
`:Memory` counts as sourced only while its `SUPPORTED_BY` target exists, so deleting a `:File` would
drop a memory out of the numerator and the trust ratio would fall **because a refresh ran**.

```ts
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
```

### Marking what has gone — **the design detail worth the most**

```ts
/** ⚠ MARK, NEVER DELETE — and mark by the RUN STAMP rather than by a list of
 *  present paths. Passing every path as a parameter would send the whole tree
 *  over the wire a second time and would grow without bound on a large repo;
 *  every file the run touched already carries `lastIndexedAt = $runId`, so
 *  "everything this run did not touch" is a cheap, exact complement.
 *
 *  A file that comes back is un-marked for free: UPSERT_FILES sets
 *  `missingSince = null` on every path it writes. */
export const MARK_MISSING = `
MATCH (f:File {workspaceInstanceId: $workspaceInstanceId})
WHERE f.lastIndexedAt <> $runId AND f.missingSince IS NULL
  SET f.missingSince = $runId
RETURN count(f) AS marked
`.trim()
```

### The git log parser

```ts
export interface IndexedCommit {
  readonly sha: string
  readonly authoredAt: string
  readonly subject: string
  readonly paths: readonly string[]
}
export interface ParsedLog {
  readonly commits: readonly IndexedCommit[]
  /** Lines git quoted (a path with `"` or a newline) — SKIPPED AND COUNTED,
   *  never guessed at. Reaches the renderer; see §4. */
  readonly skippedPaths: number
}
export function parseGitLogNameOnly(out: string): ParsedLog
```

A record starts with `C\x1f`; the three `\x1f`-separated fields are `%H`, `%aI`, `%s`; every
subsequent non-empty line until the next record is a path. **Write this against the captured file
from §0**, and include in the suite a merge commit and a commit that touches no files (both exist in
this repo's history — measured 2026-08-14 over the newest 200 commits: **9 merges and 4 commits that
touch no file at all**).

---

## §3 — `src/main/services/git.ts`

Three wrappers, at the **query** timeout (`GIT_TIMEOUT_MS`, `:34`) — none of these scale with repo
size the way `worktree add` does.

```ts
export async function lsFiles(cwd: string): Promise<string[]>          // git ls-files -z
export async function rootCommitShas(cwd: string): Promise<string[]>   // git rev-list --max-parents=0 HEAD
export async function logNameOnly(cwd: string, limit: number): Promise<string>
```

- `lsFiles` splits on `\0` and drops the trailing empty element.
- `rootCommitShas` returns them **sorted lexicographically**; the caller takes `[0]`. Identity model
  §3(i) is explicit that the tie-break is *not* by date: committer and author dates are user-settable
  and `rev-list` does not document its output order, so a date rule is not guaranteed to give two
  machines the same `repoId` — the one property the identifier exists to have.
- A repository with **no commits** yields `[]` and **is not an error** (§3(ii)): a project need not be
  a git repository at all, and then there is no `repoId` and **no `:Commit` node may be written**.
  Files still index.
- All three inherit the module's rules: never a shell, args always an array, `cwd` explicit.

---

## §4 — `memoryService.index(projectId)`

Interface addition (beside `seed` and `validate`, `memoryService.ts:169`):

```ts
  /** ⚠ WRITES THE STRUCTURAL NAMESPACE ONLY. User-initiated; never a boot hook,
   *  never a watcher, never a timer (D58). */
  index(projectId: string): Promise<MemoryResult<IndexReport>>
```

```ts
export interface IndexReport {
  readonly workspaceInstanceId: string
  /** Null for a project with no git history — then `commitsLinked` is 0 and the
   *  UI says why rather than showing a zero that looks like a failure. */
  readonly repoId: string | null
  readonly filesSeen: number
  readonly directories: number
  readonly commitsLinked: number
  /** ⚠ THE CAP, REPORTED. A truncation nobody is told about reads as
   *  "we covered everything". */
  readonly commitsSkippedBeyondLimit: number
  readonly pathsSkippedUnparseable: number
  readonly filesMarkedMissing: number
  readonly elapsedMs: number
}
```

**Order of operations, and why:**

1. read the row; refuse if absent (same sentence shape as `seed`/`validate`);
2. `validateBoltUri` **on the way out** — every other method does, because the row could have been
   hand-edited and this is the last point before a string reaches a driver;
3. inside **one** `withSession`: read the graph version, apply pending migrations (reusing `seed`'s
   own path — indexing is user-initiated, so this satisfies D58 exactly as seeding does), then the
   upserts in batches, then `MARK_MISSING`;
4. never write `project_memory` except `updatedAt` — **`lastSeededAt` belongs to seeding** and
   overloading it would make two facts share one column.

**⚠ `asInt` FOR EVERY INTEGER PARAMETER.** JavaScript has one number type and the driver sends `200`
as a FLOAT; `LIMIT`/`SKIP` refuse it outright with
`Neo.ClientError.Statement.ArgumentError`. Phase 6 hit this at G2, not in a unit test
(`memoryService.ts:441`). **And every count read back is a Neo4j `Integer`** — normalise with
`Number(...)`, never compare with `===`.

**`workspaceInstanceId` is `'pj:' + projectId`.** The project's own checkout, and only that. A
worktree is a short-lived view of the same repository; indexing each one would multiply every node
by the number of live worktrees and make `MODIFIED` edges ambiguous. The report carries the value so
the UI can say which tree was indexed.

---

## §5 — The wire

`src/shared/ipc.ts`, beside `MemoryValidate` (`:527`):

```ts
  /** invoke: walk this project's tracked files and recent commits into the
   *  graph's STRUCTURAL namespace. User-initiated only. */
  MemoryIndex: 'memory:index'
```

Request `{ project_id }`; response the same discriminated `ok` / refusal union the other memory
channels use, carrying a snake_case projection of `IndexReport`.

**⚠ VALIDATION IN MAIN ONLY.** Preload invokes and does nothing else — Zod in the preload throws
`EvalError` under the app's CSP and silently drops events. Follow the seven existing memory
channels exactly (`preload/index.ts:211`–`:247`).

Handler in `ipc.ts`, immediately after `MemoryValidate` (`:3933`), matching its shape: parse, call,
map a refusal to `{ ok: false, reason }`, never throw for a refusal.

---

## §6 — The UI

`ProjectSettingsView.vue`, inside the existing `v-if="memoryStatus?.configured"` block (`:706`
onward) — **nothing renders for an unconfigured project** (D76).

- A button, `Index code`, disabled while `memoryBusy || indexing`.
- The report as one sentence: *"Indexed 447 files in 63 folders, and 200 commits."* plus, **only when
  non-zero**, *"12 files are no longer in the tree and are marked, not deleted."* and *"History
  beyond the newest 200 commits was not indexed."*
- **The limit, stated at the control and not in a tooltip:**

  > This records **where** code lives — file, folder and commit names. It does not read your code:
  > it cannot say what a function does or what calls it.

That sentence is a **requirement of D149**, not copy polish. The feature's honest value is finding,
and a user who expects understanding will conclude the feature is broken.

---

## §7 — Verification

### Build

```
npm run typecheck
npx vitest run
npm run grep:secrets
grep -nE "DETACH|DELETE|REMOVE " src/main/services/codeIndexCore.ts    # must print nothing
```

### Runtime — against a real container

```powershell
docker run -d --name chorus-6a2 -p 127.0.0.1:7688:7687 -e NEO4J_AUTH=none neo4j:5-community
```

(**Note the loopback binding** — a plain `-p 7688:7687` publishes an auth-disabled database on every
interface. 6a-4 makes that binding the app's, not the operator's.)

1. Configure, seed (**expect v1 → v2 applied**), index. Record the report and the elapsed time.
2. Re-index twice. **Expect an identical node count** — `MERGE` is idempotent and a growing count
   means the key is wrong.
3. **The provenance-trap proof — run this exactly:**

```cypher
// after the first index
MATCH (f:File {relPath:'src/main/services/memoryService.ts'})
MERGE (s:AgentSession {id:'probe-session'})
CREATE (m:Memory {id:'probe-memory', content:'probe', chorusProjectId:$pid, validTo:null, writtenVia:'probe'})
CREATE (m)-[:SUPPORTED_BY]->(f)
CREATE (s)-[:PRODUCED]->(m)
```

   Run `memory:validate` and record the ratio. **Index twice more.** Re-run `memory:validate`.
   **The ratio and the edge must be identical.** If either moved, stop: something is deleting, and
   that is the one failure this task must not ship.
4. Delete a tracked file from the working tree, re-index: its `:File` node **still exists** and has
   `missingSince`. Restore it, re-index: `missingSince` is null.
5. **The goal, driven.** In a `claude` pane with 6a-1's contract active and **without naming
   `chorus-memory` in the prompt**, ask *"which files did the latest commit touch, according to this
   project's memory?"*. Save the transcript. This is the phase milestone's second half.
6. Index a non-git folder: an authored refusal for the commit half, files still indexed — **not a
   stack trace**.

Save everything under `_verify/6a-2/`, including the two captured git outputs from §0.

### What a reviewer should distrust

- **A green suite proves nothing about idempotence** — the unit tests assert query *strings*. Node
  counts across three real runs are the evidence.
- **A count that "looks right"** is a Neo4j `Integer` away from being wrong. Check the normalisation.
- **`workspaceInstanceId` typos are silent**: a wrong prefix produces a perfectly valid second
  namespace that answers no query and shows up as an empty result, not an error.
