# Task 6a-2 — `index-codebase`

_Phase 6a, task 2 of 4. Authored 2026-08-14 against `47f633c`._

> **⚠ THIS IS THE TASK THE PHASE EXISTS FOR.** The stated goal is *"agents can manage project memory
> as well as documenting code structure so that the models don't have to constantly re-discover a
> project"* (Matthew, 2026-08-14). Everything else in Phase 6a serves this or protects it.

## Source Of Truth

| Document | Owns |
|---|---|
| [`../Phase-6a-Proposal.md`](../Phase-6a-Proposal.md) §3 (6a-2) | Why this task exists, and the honesty rule it must state |
| [`../Phase-6-IdentityModel.md`](../Phase-6-IdentityModel.md) | **NORMATIVE** on `workspaceInstanceId`, `repoId`, path normalization, and what "sourced" means |
| [`Phase-6a-Overview.md`](Phase-6a-Overview.md) | Verified ground facts, and **the provenance trap** |
| `roadmap.md` §6 — **D149**, D147(c), D126, D128(c), **F49** | The scope cut, the one-graph ruling, and the durability gate |
| [`../ImplementationSpecs/ImplementationSpec-6a-2.md`](../ImplementationSpecs/ImplementationSpec-6a-2.md) | Cypher, batching, the git parsers, runtime checks |

## Initial Starting Point — verified 2026-08-14 at `47f633c`

| Fact | Where | Value |
|---|---|---|
| `GRAPH_MIGRATIONS` | `graphSchemaCore.ts:51` | **one** entry (v1, `identity-constraints-and-indexes`, ten statements) |
| `LATEST_GRAPH_VERSION` | `graphSchemaCore.ts:88` | **1** — this task makes it **2** |
| `:File` constraint | `graphSchemaCore.ts:61` | `(f.workspaceInstanceId, f.relPath) IS UNIQUE` |
| `:Commit` constraint | `graphSchemaCore.ts:67` | `(c.repoId, c.sha) IS UNIQUE` — **`repoId` is the root-commit SHA**, not a path |
| **No `:Directory` anywhere** | `graphSchemaCore.ts` | the label does not exist yet |
| `pendingMigrations` | `graphSchemaCore.ts:107` | already refuses a graph from the future — **the version-skew case is solved and must not be re-solved** |
| `memoryService.seed` | `memoryService.ts:364` | re-reads the graph first, applies one statement at a time, **not in a transaction** (Neo4j refuses schema commands inside one) |
| `memoryService.validate` | `memoryService.ts:425` | the ratio this task must not move |
| `PROVENANCE_QUERIES` | `provenanceCore.ts` | what "sourced" counts — `SUPPORTED_BY` to a node **that exists** |
| `asInt` | `neo4jClient.ts` | ⚠ **required for every integer parameter** — the driver sends a plain `50` as a FLOAT and `LIMIT`/`SKIP` refuse it |
| Neo4j `Integer` returns | roadmap Phase 6 note (3) | a returned count is an `Integer` object, **never `=== 1`** |
| `git.ts` surface | `services/git.ts:112`–`:347` | worktree/status/branch/diff — **no `ls-files`, no `log`, no root-commit probe** |
| `pExecFile` runner | `git.ts:31` | never a shell, arguments always an array, cwd explicit |
| `GIT_TIMEOUT_MS` | `git.ts:34` | 15 s for cheap queries — **`ls-files` and `log` belong to this budget, not the checkout one** |
| `getWorktreesForProject` | `storage.ts:1782` | the worktree rows, if a later task ever wants them |
| Memory IPC handlers | `ipc.ts:3842`–`:3933` | seven, contiguous — the eighth joins them |
| Memory store | `renderer/src/stores/memory.ts` | `seedByProject` / `validationByProject` are the shape the index report copies |
| Memory settings UI | `views/ProjectSettingsView.vue:655` onward | where the button goes |
| `IpcChannel` keys | `shared/ipc.ts:14` | **86** — this task makes it **87** |
| Repo scale, measured | `git ls-files \| wc -l` | **447 tracked files** — the index is small, and the design must not pretend otherwise |
| `git` version | probed 2026-08-14 | **2.50.0.windows.1** |
| This repo's root commit | `git rev-list --max-parents=0 HEAD` | `a92099d934dd95548e59525b7231fd4b5f5d5f6f` — matches the identity model's own measurement |

## Goal

Give a project's graph a structural map of its own code, so an agent can answer *"where does this
live"*, *"what is in this directory"* and *"which files did that commit touch"* from memory instead
of by walking the tree. The walker upserts `:File`, `:Directory` and `:Commit` nodes with
`CONTAINS` and `MODIFIED` edges, keyed by the identity model's `workspaceInstanceId` + repo-relative
path, and it is **run by a person pressing a button** — never by a watcher, never on a timer, never
at boot.

## ⚠ The two rules that outrank everything else in this task

**1. THE INDEXER NEVER DELETES A NODE OR AN EDGE.** `memory:validate` counts a `:Memory` as sourced
only if its `SUPPORTED_BY` target **exists in the graph** (identity model §6). A re-index that wiped
the structural namespace would delete provenance targets and **the trust ratio would fall because a
refresh ran** — a corruption that looks like a measurement. A file that has left the tree is marked
with `missingSince`; it is never removed, and neither is any edge pointing at it.

**2. IT INDEXES CODE, AND IT MUST NOT BE SOLD AS UNDERSTANDING CODE.** No symbols, no `Class`, no
`Method`, no `CALLS`, no source text, no embeddings (**D149**). *"What calls this method"* is
**not** answerable after this task, and the UI copy says so in plain words rather than leaving the
user to discover it. The roadmap's own `Class`/`Method`/`CALLS` list is cut, deliberately, and the
cut is recorded rather than quietly unshipped.

## Exact Scope

**Create**

- `src/main/services/codeIndexCore.ts` — **pure**: path normalization, directory-chain derivation,
  batching, the Cypher statements as constants, the `git log` parser. No `fs`, no driver, no
  `electron`.
- `src/main/services/codeIndexCore.test.ts`

**Edit**

- `src/main/services/graphSchemaCore.ts` — **graph migration v2**: the `:Directory` identity
  constraint and the project-scoped `:File` index.
- `src/main/services/git.ts` — `lsFiles`, `rootCommitShas`, `logNameOnly` (+ their pure parsers, which
  live in `git.ts` beside `parseWorktreePorcelain`, matching the file's existing shape).
- `src/main/services/memoryService.ts` — an `index(projectId)` method on the interface and the
  implementation, sharing `withSession` and the pending-migration apply.
- `src/shared/ipc.ts` — `MemoryIndex: 'memory:index'` + request/response schemas.
- `src/preload/index.ts` + `src/preload/index.d.ts` — the invoke wrapper.
- `src/main/ipc.ts` — the eighth memory handler.
- `src/renderer/src/stores/memory.ts` — `indexByProject`, `indexingByProject`, the action.
- `src/renderer/src/views/ProjectSettingsView.vue` — one button, one report line, **and the honest
  limit sentence**.

**Nothing else.**

## Non-Goals

- **No symbol extraction of any kind**, and **no new dependency** — `typescript` stays a
  devDependency (D149). Runtime deps stay at **8**.
- **No `CALLS` edges.** A cross-file call graph needs a type checker and is a phase, not a task.
- **No file watcher, no post-commit hook, no boot hook, no timer.** *"A watcher that re-indexes on
  every save will fight the agents for the database"* — and D58's user-initiated-only rule already
  governs every live connection this app opens.
- **No deletion, ever** — no `DELETE`, no `DETACH DELETE`, no `REMOVE` in any statement this task
  writes. Grep is the check.
- **No worktree indexing.** Only the project's own checkout is indexed, as `pj:<projectId>`. A
  worktree is a short-lived view of the same repository and would multiply every node; the UI states
  which tree was indexed.
- **No file CONTENT is read, hashed, chunked or stored.** The indexer reads *names* from git and
  never opens a file.
- **No SQLite migration.** `MIGRATIONS.length` stays **19**.
- **No `:Memory`, `:Decision`, `:Observation`, `:Risk` or `:SUPPORTED_BY` write.** The label boundary
  of D147(c) is the whole safety argument for one graph.
- **Do not revert, stage, commit or delete unrelated working-tree changes.**

## Dependencies

**Task 6a-1 must have landed** — it shares `src/main/ipc.ts`, and the usage contract is what makes an
agent look at the index at all.

## Step-by-step Work

1. **Capture real git output before writing a parser.** Run `git ls-files -z` and the chosen
   `git log` invocation in this repo, save both to `_verify/6a-2/`, and write the parser against the
   captured bytes. **⚠ `-z` IS NOT OPTIONAL:** without it git *quotes* paths containing non-ASCII or
   special characters, so a plain split on newline silently produces a wrong `relPath` for exactly
   the files whose identity is hardest to get right.
2. **Write `codeIndexCore.ts`.** `normalizeRelPath` implements identity model §4 **exactly**:
   separators to `/`, strip leading `./`, no trailing slash, **refuse `..` and absolute inputs with
   an authored reason**, NFC, **case preserved and never folded**. Directory chains derive from the
   normalized path. Batching is a pure function over the list.
3. **Add graph migration v2** to `GRAPH_MIGRATIONS` — `directory_identity` as a composite uniqueness
   constraint mirroring `file_identity`, plus `CREATE INDEX file_project … ON (f.chorusProjectId)`.
   **Every statement idempotent** (the list-level assertion in the existing test enforces it), and
   **applied against a real container before being hardcoded** — the Phase 6 precedent, because
   constraint syntax has changed across Neo4j majors and CLAUDE.md forbids trusting recall for it.
4. **Extend `git.ts`** with `lsFiles`, `rootCommitShas` and `logNameOnly`, each a thin typed wrapper
   over the existing runner at the **query** timeout, plus their pure parsers.
5. **`repoId`**: identity model §3 — the root-commit SHA, **lexicographically smallest** when there
   is more than one. **A project with no git, or a repo with no commits, has no `repoId`, and then no
   `:Commit` node may be written** — an authored refusal for the commit half only; files still index.
6. **`memoryService.index(projectId)`**: re-validate the bolt URI on the way out (as `seed`, `test`
   and `validate` all do), apply pending graph migrations in the same session, then run the upserts in
   batches, then the missing-marking pass, and return a report.
7. **The report is a "N of M"-shaped honest object** (D55's rule): files seen, files upserted,
   directories, commits linked, **commits skipped beyond the limit**, files newly marked missing, and
   elapsed ms. **A cap that is not reported is a silent truncation** — the commit window is bounded
   and the report says by how much.
8. **Wire the channel** — schema in `shared/ipc.ts`, validation in **main only** (never in preload:
   Zod in preload throws `EvalError` under CSP), handler beside the other seven.
9. **UI**: an `Index code` button in the Memory section, enabled only when memory is configured; the
   report rendered as a sentence; and **the limit sentence, verbatim in intent**: *this records where
   code lives, not what it does — Chorus indexes file, folder and commit structure only.*

## Test Expectations

`codeIndexCore.test.ts`:

- `normalizeRelPath` — backslashes converted; `./` stripped; `..` **refused with a reason**; an
  absolute path refused; NFC applied; **`SRC/App.vue` and `src/app.vue` remain two distinct
  identities** (the declared Windows limit, asserted so nobody "fixes" it into a fold);
- directory chains — `a/b/c.ts` yields `a` and `a/b`, in that order, and the repo root is not a
  `:Directory`;
- batching — an exact batch size, a remainder batch, and an empty input producing **no** statement;
- the `git log` parser — driven by the **captured real output**, including a merge commit and a
  commit touching zero files;
- **a grep-style assertion over the exported Cypher constants: none contains `DELETE`, `DETACH` or
  `REMOVE`.** This is the provenance trap turned into a test.

`graphSchemaCore.test.ts` (existing suite, extended):

- `LATEST_GRAPH_VERSION` is **2** and `pendingMigrations(1)` returns exactly the v2 entry;
- the existing list-level idempotence assertion still passes over both entries;
- `pendingMigrations(3)` still refuses with the newer-Chorus sentence.

`git.ts` parsers: NUL-separated output, a path with a space, a path with a non-ASCII character.

## Verification Commands

```
npm run typecheck
npx vitest run
npm run grep:secrets

# the provenance trap, as a command
grep -nE "DETACH|DELETE|REMOVE " src/main/services/codeIndexCore.ts   # must print nothing

# counters
node -e "const s=require('fs').readFileSync('src/shared/ipc.ts','utf8');console.log('IpcChannel keys:',(s.match(/^\s+[A-Za-z]+: '/gm)||[]).length)"  # 87
node -e "console.log('runtime deps:',Object.keys(require('./package.json').dependencies).length)"  # 8
```

**Runtime drive — against a real Neo4j, and the middle step is the one that matters:**

```
docker run -d --name chorus-6a2 -p 7688:7687 -e NEO4J_AUTH=none neo4j:5-community
```

1. Configure this project's memory at `bolt://127.0.0.1:7688`, seed, then **index**. Record the
   report and the elapsed time for 447 files.
2. **The provenance-trap proof.** Hand-create a `:Memory` with a `SUPPORTED_BY` edge to an indexed
   `:File` and a `PRODUCED` edge from an `:AgentSession`; run `memory:validate` and record the ratio;
   **run the index twice more**; re-run `memory:validate`. **The ratio and the edge must be
   unchanged.** If either moved, the indexer is deleting something and the task is not done.
3. Delete a file from the working tree, re-index, and confirm its `:File` node **still exists** and
   now carries `missingSince`. Restore the file, re-index, confirm `missingSince` is cleared.
4. **The goal, driven.** In a `claude` pane in this project — with 6a-1's contract in place and
   **without naming `chorus-memory` in the prompt** — ask *"which files did the latest commit touch,
   according to this project's memory?"* and record the transcript.
5. Run the index against a project that is **not** a git repository and confirm the authored refusal,
   not a stack trace.

Evidence under `_verify/6a-2/`.

## Acceptance Criteria

- [ ] Graph version **2**; the v2 statements were applied against a real container before being
      hardcoded, and re-applying them produced zero failures.
- [ ] `git ls-files -z` and the `git log` invocation were **captured from this machine** and the
      parsers were written against the captured bytes.
- [ ] Indexing this repo produces `:File` nodes for **447** tracked files (or the number `git
      ls-files` reports on the day), the directory chain above each, and `MODIFIED` edges for the
      bounded commit window — **with the skipped-commit count reported, not hidden**.
- [ ] `memory:validate`'s ratio is **byte-for-byte unchanged** across three consecutive indexes, with
      a hand-seeded sourced memory present.
- [ ] A removed file is **marked, not deleted**, and re-appearing clears the mark.
- [ ] No `DELETE`/`DETACH`/`REMOVE` anywhere in the task's Cypher.
- [ ] `IpcChannel` **87**; `MIGRATIONS.length` **19**; runtime deps **8**.
- [ ] The UI states the limit — *finds code, does not read it* — in the Memory section, not in a
      tooltip.
- [ ] typecheck **0** · vitest **≥ 2012 + the new cases** · `grep:secrets` clean.

## Review Checklist

1. **The `asInt` obligation is honoured for every integer parameter** — batch sizes, limits, skips.
   A plain JS number reaches Neo4j as a float and `LIMIT` refuses it; this bit Phase 6 at G2 and not
   in a unit test.
2. **Every count read back from the driver is normalised** (`Number(...)` / `asInt`) — a Neo4j
   `Integer` compared with `===` reports failure against a database that answered correctly.
3. **`normalizeRelPath` is the only place a path becomes an identity**, and it refuses rather than
   clamps. A silently clamped `..` invents an identity.
4. **The indexer writes only `:File`, `:Directory`, `:Commit`, `:Project` and the two edge types.**
   Read every `MERGE` in the diff and confirm no memory-namespace label appears.
5. **`repoId` is the root-commit SHA, sorted lexicographically on a tie** — not the remote URL, not
   `worktrees.repo_root`, not the HEAD sha.
6. **The commit window is bounded AND reported.** Confirm the number reaches the renderer, not just a
   log line.
7. **Nothing runs unattended.** Grep for the new service method's callers: exactly one, the IPC
   handler, reached by a button.
