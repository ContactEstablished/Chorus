# Phase 6 — The Graph Identity Model

**Status:** settled 2026-08-08, at `5ec6fc5`, as the prerequisite to Task 6-4's constraints.
**Normative for:** `graphSchemaCore.ts`, `provenanceCore.ts`, and every constraint in the seed list.

> **⚠ THIS DOCUMENT EXISTS BECAUSE THE KEY HAS BEEN WRONG TWICE, AND BOTH TIMES IT LOOKED RIGHT.**
> `Plan.md` §10 keyed `:File` on a bare `path`. **D94(a)** corrected that to `(repo, path)` because a
> bare path breaks on git worktrees — Chorus's own core feature. **CR-6.0 (D126)** found the correction
> *still* insufficient: *"a repository identity shared by multiple simultaneously represented
> worktrees, combined with a worktree-relative path, can still collide."* This is the **third** version
> of the key and the first one grounded in a field Chorus actually owns.
>
> **Task 6-4's action item 1 is a prerequisite, not a step: no constraint may be written until this is
> settled.** It is checkable against Phase 2's tables rather than invented, which is the whole reason
> the council's ruling could be improved on rather than merely obeyed.

---

## 1. The rule

**Identity is a stable, Chorus-owned workspace-instance identifier plus a normalized
repository-relative path.**

**⚠ ABSOLUTE PATHS ARE NEVER KEY MATERIAL.** They are machine-specific and mutable; they survive as
fallback metadata under names that say so (§5).

## 2. `workspaceInstanceId` — and why it carries a prefix

`worktrees.id` (`src/main/db/schema.ts:112`) is the stable worktree-instance identifier D126 asked
for, and **Chorus already had it**: TEXT PRIMARY KEY, Chorus-assigned, DB-first journaled (`creating`
is written before any filesystem or git operation), it survives a move on disk, and it outlives its
owning session (D26 Q1). It is opaque and independent of the path — precisely the property `path`
lacks.

**⚠ BUT IT DOES NOT COVER EVERY CHECKOUT AN AGENT WRITES FROM (HOLE 1).** `sessions.worktree_id`
(`schema.ts:88`) is **nullable**, and it is NULL for a session running in the project's own checkout
— which is the *most common* case, not an edge case. A model that assumed a worktree id would key the
commonest case to `null`.

```
workspaceInstanceId := 'wt:' + worktrees.id     when the session owns a worktree
                    := 'pj:' + projects.id      otherwise (the project's own root)
```

**⚠ THE PREFIX IS NOT DECORATION.** Two id spaces stored in one property must be un-collidable **by
construction**, not by the assumption that two UUID generators never produce the same value. The
prefix also makes the property self-describing in a graph browser, where the reader has no schema to
consult.

Both halves are Chorus-owned, opaque, and stable across a move on disk.

## 3. `repoId` — the `:Commit` ruling (HOLE 2)

**Commits are shared by every worktree of one repository**, so keying them to a workspace instance
would duplicate the same commit N times and break `SUPPORTED_BY` corroboration across worktrees.
`:Commit` needs a **repository** identity. The only repository identifier in this schema is
`worktrees.repo_root` — an absolute path, which D126 demotes.

### RULING — `repoId` is the repository's ROOT-COMMIT SHA

Spec §0 option (a), **taken and measured on this machine 2026-08-08:**

| Property | Measurement |
|---|---|
| Stable across worktrees of one repo | `git rev-list --max-parents=0 HEAD` returned **`a92099d9…`** from both `C:\Projects\ContactEstablished\Chorus` and its worktree `wt-910e111a` — **identical** |
| Distinct across repositories | Chorus `a92099d9…` · Aerie `f42f44d0…` · JobScout `8a97dee7…` — **three repos, three values** |
| Cost | **42 ms**, on a path that has no git call today |
| Machine-independent | It is content-addressed history; it survives clones, moves and renames |

Options (b) the remote URL and (c) `sha` alone are **rejected** as spec §0 states: a remote is absent
for a repo that has none, is mutable, and encodes a host; `sha` alone is wrong the moment a project
holds two repositories — the exact case D94(a) corrected for `:File`.

### ⚠ Two sub-rulings the spec left open, taken here

**(i) Multiple root commits — take the LEXICOGRAPHICALLY SMALLEST, not the "earliest".** Spec §0 says
*"take the earliest and say so"*. **Taking it by date is the wrong tie-break and this is a deliberate
deviation:** committer and author dates are user-settable, can be identical to the second across two
roots, and `git rev-list --max-parents=0` does not document its output order. A date-based rule is
therefore not guaranteed to give two machines the same answer, which is the *one* property this
identifier exists to have. **Sorting the root SHAs as strings is total, deterministic and
machine-independent**, and costs no second git call. Measured: all three repositories on this machine
have exactly one root, so the tie-break is untriggered here and is written down before it is needed
rather than after it has silently diverged.

**(ii) A project need not be a git repository at all, and that is a real state rather than an error.**
`projects.root_path` is a folder the user picked; nothing requires `.git`. A repo with no commits
(freshly `git init`) likewise yields no root commit. **In both cases there is no `repoId`, so no
`:Commit` node may be written** — `:Commit` nodes only arise where there is history to cite. The
refusal is authored, not a crash, and it is not a degraded mode: a project with no git has nothing
for a commit citation to point at.

## 4. Normalization rules

Pure, and tested as a function (`normalizeRelPath`).

1. Compute **relative to the instance's own root** — `worktrees.path` for `wt:`, `projects.root_path`
   for `pj:`.
2. Separators → `/`.
3. Strip a leading `./`; no trailing slash.
4. **Refuse `..` escapes and absolute inputs with an authored reason.** A path that leaves its
   instance root is not repository-relative, and **silently clamping it invents an identity**.
5. Unicode → **NFC**. Low-risk on a Windows-only v1, but *"a rule that is unstated is a rule that
   changes silently"*.

### ⚠ CASE IS PRESERVED, NOT FOLDED — a declared limit, not an oversight

git is case-sensitive; NTFS is case-insensitive by default. **Folding would merge two files git
considers distinct — a silent data loss.** **Preserving means two spellings of one file on Windows
can create two `:File` nodes.** Both are wrong in some direction, and this project's standing rule is
that **a declared limit beats a hidden one**, so: preserve, and state it here and in the UI's own
copy where it matters.

## 5. Fallback metadata — carried, never keyed

`absPathAtWrite`, `repoRootAtWrite`.

**The `AtWrite` suffix is load-bearing naming**, so no future reader mistakes a machine-specific
snapshot for an identity. **They must not appear in any constraint**, and a `grep` for them in
`graphSchemaCore.ts` is a review step in Task 6-4's own checklist.

## 6. What "sourced" means — the denominator's definition

D126 item 4: state exactly which fields make a memory count as sourced, **or the validator's
denominator is meaningless**.

A `:Memory` counts as **sourced** iff **both** hold:

- it has **≥ 1 outgoing `:SUPPORTED_BY`** to a `:File` or `:Commit` **that exists in the graph**; and
- it has an incoming **`(:AgentSession)-[:PRODUCED]->`** edge.

**⚠ THE SESSION EDGE ALONE DOES NOT COUNT.** D126's third unasked finding: *"a Chorus-written session
node is not provenance"* — if agents can ignore, relabel or delete it, counting it as a source
**manufactures a false denominator**. `SUPPORTED_BY` is the load-bearing half; `PRODUCED` is
attribution.

**The denominator is CURRENT memories only** — `chorusProjectId = $pid` **and `validTo IS NULL`**. A
superseded memory's provenance is history and cannot be repaired, so including it would inflate the
denominator with rows no action can move. **This must be stated in the UI copy**, because *"43 of
512"* is a different claim depending on what 512 counts (D55).

## 7. The limits this model does not remove

- **Provenance is advisory and measured, never enforced (D126 Q2).** Agents write via MCP with a
  Cypher tool; nothing stops one creating a `:Memory` with no source and no session.
- **⚠ AND THE VALIDATOR CANNOT DEFEND ITSELF (F49).** The write tool takes arbitrary Cypher, so the
  same tool can bulk-modify, poison, relabel or `DETACH DELETE` memories **and the provenance edges
  the validator counts**. *"43 of 512"* is computed from data that tool can rewrite, so **a corrupted
  graph can report itself healthy.** Per-container isolation bounds the blast radius to one project
  and does nothing inside it. Backup/export/restore is Stage 5 and **F49 gates it**: no project graph
  may be presented as durable memory until export and restore exist and have been exercised.
- **Phase 6 ships the measurement and not yet the consequence (D128(c)).** In scope: numerator and
  denominator, the ratio, the affected-node list. Deferred as a unit: trend, new-vs-backlog split,
  per-agent breakdown, the repair workflow, context re-weighting. **No UI element may hint that the
  repair workflow exists.**

---

## Appendix — measured against `neo4j:5-community` (5.26.29), 2026-08-08

Run: `_verify/6-4-probe-constraints.mjs`. **The syntax was verified rather than recalled**, per
CLAUDE.md's standing rule, because composite-property constraint syntax changed across Neo4j majors.

- **All ten seed statements parse and apply**, and **re-applying all ten produced zero failures** —
  idempotence observed on the real server, not argued from `IF NOT EXISTS`.
- `SHOW CONSTRAINTS` reports `file_identity` as `UNIQUENESS` over `["workspaceInstanceId","relPath"]`
  and `commit_identity` over `["repoId","sha"]`, i.e. the composite key landed as intended.
- **The constraint bites, and bites the right way:** `wt:A + src/index.ts` and `wt:B + src/index.ts`
  **both** succeed — that is the worktree case D94(a) was about — while a second `wt:A +
  src/index.ts` is refused with `Neo.ClientError.Schema.ConstraintValidationFailed`.

### ⚠ `file_workspace` IS NOT REDUNDANT — measured, and the guess was wrong

The obvious simplification is to drop the `file_workspace` index because `file_identity` already
creates a backing RANGE index whose **leading** property is `workspaceInstanceId`. **`EXPLAIN` refutes
it.** With `file_workspace` present, `MATCH (f:File) WHERE f.workspaceInstanceId = $x` plans as a
`NodeIndexSeek`; after dropping it, the same query plans as **`NodeByLabelScan` + `Filter`** — Neo4j
did not use the composite constraint index for a leading-property-only lookup here.

**Keep it.** Removing it would have turned every per-workspace query into a full label scan, and the
change would have looked like a tidy-up in review.
