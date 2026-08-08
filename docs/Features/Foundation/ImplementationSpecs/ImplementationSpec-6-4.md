# ImplementationSpec 6-4 — Graph Schema, Provenance and the Validator

**Normative for:** [`../Tasks/Task-6-4.md`](../Tasks/Task-6-4.md). **Design input:
[`../Phase-6-MemoryPlan.md`](../Phase-6-MemoryPlan.md) §4 and §8**, as revised by **D126 / D128(c)**.

**⚠ THE 2026-08-08 AMENDMENT IS FOLDED IN.** The largest change is **§0, which did not exist before**:
CR-6.0 revised the identity model a second time, and **no constraint in §1 may be written until §0 is
settled.** §0 is grounded in this repo's actual `worktrees` / `projects` / `sessions` tables, measured
at `842a7cc`.

---

## 0. ⚠ The identity model — settle this BEFORE any constraint

**D126's ruling:** identity is a **stable worktree-instance identifier plus a NORMALIZED
repository-relative path**, with **absolute paths demoted to fallback metadata and never used as key
material.** D94(a)'s `(repo, path)` correction is **superseded** — the council found that *"a
repository identity shared by multiple simultaneously represented worktrees, combined with a
worktree-relative path, can still collide."*

**⚠ AND THE SEED LIST IN §1 IS WRONG ON BOTH HALVES, WHICH IS WHY THIS SECTION COMES FIRST.** `f.repo`
can only mean `worktrees.repo_root` (`src/main/db/schema.ts:124`) — **an absolute path**, exactly what
D126 demotes — and `f.path` is worktree-ambiguous. **The constraints cannot be copied forward.**

### What this repo already has (measured at `842a7cc`)

| Field | Where | Property |
|---|---|---|
| `worktrees.id` | `schema.ts:112` | **TEXT PRIMARY KEY, Chorus-assigned, DB-first journaled** (`creating` before any fs/git op), survives a move on disk, **outlives its owning session** (D26 Q1) |
| `worktrees.path` | `schema.ts:121` | absolute, `UNIQUE` — the checkout root |
| `worktrees.repo_root` | `schema.ts:124` | absolute — the repository the worktree came from |
| `projects.root_path` | `schema.ts:15` block | absolute — the project's own checkout |
| `sessions.worktree_id` | `schema.ts:88` | **NULLABLE** — *"set when a session owns a worktree"* |

**✅ `worktrees.id` IS the stable worktree-instance identifier the council asked for, and Chorus
already has it.** It is opaque, Chorus-owned, and independent of the path — precisely the property
`path` lacks. **The council could not see this; it is checkable rather than invented, which is what
Task-6-4's action item 1 says.**

### ⚠ HOLE 1 — the project's own root has no `worktrees` row

`sessions.worktree_id` is **nullable** and is NULL for a session running in the project's own
checkout. **A worktree-instance id therefore does not cover every checkout an agent writes from**, and
a model that assumes it does will key the most common case to `null`.

**Ruling — prefix two id spaces into one property:**

```
workspaceInstanceId := 'wt:' + worktrees.id     when the session has a worktree
                    := 'pj:' + projects.id      otherwise (the project's own root)
```

Both halves are Chorus-owned opaque ids, both stable across a move on disk. **The prefix is not
decoration:** two id spaces stored in one property must be un-collidable **by construction**, not by
the assumption that two UUID generators never meet.

### ⚠ HOLE 2 — `:Commit` has no stable repository identity available, and this needs a RULING

Commits are shared by **every worktree of one repository**. Keying them to a workspace instance would
duplicate the same commit N times and break `SUPPORTED_BY` corroboration across worktrees — so
`:Commit` needs a **repository** identity, not an instance one. **The only repository identifier in
this schema is `worktrees.repo_root`, an absolute path, which D126 demotes.**

| Option | Verdict |
|---|---|
| **(a) the repository's ROOT-COMMIT SHA** (`git rev-list --max-parents=0 HEAD`) | **RECOMMENDED.** Machine-independent, survives clones and moves, reachable through the existing git seam. **⚠ It costs a git call on a path that has none today, and a repo with several root commits returns more than one — take the earliest and say so.** |
| (b) the remote URL | Absent for a repo with no remote; mutable; encodes a host. **Rejected.** |
| (c) `sha` alone | Wrong the moment a project holds two repositories — **the exact case D94(a) corrected for `:File`.** **Rejected.** |

**Take (a) or record a different ruling — but do not write `commit_identity` until one is taken.** It
is a decision, not an implementation detail.

### Normalization rules — pure, and tested as a function

1. Compute **relative to the instance's own root**: `worktrees.path`, or `projects.root_path` for the
   `pj:` case.
2. Separators → `/`.
3. Strip a leading `./`; no trailing slash.
4. **Refuse `..` escapes and absolute inputs** with an authored reason. A path that leaves its
   instance root is not repository-relative, and **silently clamping it invents an identity.**
5. **⚠ CASE IS PRESERVED, NOT FOLDED — AND THAT IS A DOCUMENTED LIMIT, NOT AN OVERSIGHT.** git is
   case-sensitive; NTFS is case-insensitive by default. **Folding would merge two files git considers
   distinct** — a silent data loss. **Preserving means two spellings of one file on Windows can create
   two `:File` nodes.** Both are wrong in some direction; **preserve, and state the limit**, because
   this project's standing rule is that a declared limit beats a hidden one.
6. Unicode: normalize to **NFC**, and say so. Low-risk on a Windows-only v1, but a rule that is
   unstated is a rule that changes silently.

### Fallback metadata — carried, never keyed

`absPathAtWrite`, `repoRootAtWrite`. **Named with the `AtWrite` suffix deliberately**, so no future
reader mistakes a machine-specific snapshot for an identity. **They must not appear in any constraint,
and a `grep` for them in `provenanceCore.ts`'s key material is a review step.**

### What "sourced" MEANS — the denominator's definition

**D126 item 4: state exactly which fields make a memory COUNT as sourced, or the validator's
denominator is meaningless.**

A `:Memory` counts as **sourced** iff **both** hold:

- it has **≥ 1 outgoing `:SUPPORTED_BY`** edge to a `:File` or `:Commit` **that exists in the graph**;
  **and**
- it has an incoming **`(:AgentSession)-[:PRODUCED]->`** edge.

**⚠ THE SESSION EDGE ALONE DOES NOT COUNT, AND THIS IS D126's THIRD UNASKED FINDING.** *"A
Chorus-written session node is not provenance"* — if agents can ignore, relabel or delete it, counting
it as a source **manufactures a false denominator**. `SUPPORTED_BY` is the load-bearing half;
`PRODUCED` is attribution.

**The denominator is CURRENT memories only** — `chorusProjectId = $pid` **and `validTo IS NULL`.** A
superseded memory's provenance is history and cannot be repaired, so including it would inflate the
denominator with rows no action can move. **State this in the UI copy**, because *"43 of 512"* is a
different claim depending on what 512 counts (D55).

---

## 1. `graphSchemaCore.ts` — the ledger lives in the graph

**The rule, and it is not a preference: the graph is the authority on its own version;
`project_memory.schema_version` is a CACHE.** The same graph can be restored from a dump or reached by
a second Chorus install, and **a version kept only in SQLite would claim a schema the graph does not
have.** The seeder therefore **always re-reads the graph first** and writes the cache **only after a
successful apply**.

The in-graph ledger deliberately mirrors `schema_migrations` so there is **one mental model**:

- `(:ChorusSchema {id:'chorus', version})` — a singleton.
- `(:ChorusMigration {version, name, appliedAt, checksum})` — one per applied step.

Exports, all pure — **no driver, no storage, no electron:**

```ts
export interface GraphMigration {
  readonly version: number
  readonly name: string
  /** Every statement idempotent. Asserted over the list, not per-call. */
  readonly statements: readonly string[]
}
export const GRAPH_MIGRATIONS: readonly GraphMigration[]
export function pendingMigrations(current: number): readonly GraphMigration[]
export function versionNodeCypher(version: number, name: string, checksum: string): string
```

**⚠ `pendingMigrations` MUST REFUSE A VERSION FROM THE FUTURE.** A graph at v4 read by code that knows
v1–v3 is **a graph written by a newer Chorus**, and returning `[]` silently pretends compatibility.
Return a refusal the caller renders — the reviewer will skip this case, and it is the one that
corrupts a graph.

**Seed v1 — REWRITTEN AGAINST §0. ⚠ VERIFY NEO4J 5 COMPOSITE-CONSTRAINT SYNTAX AGAINST THE ACTUAL
IMAGE (measured: `neo4j:5-community` → 5.26.29 Community) BEFORE HARDCODING IT** — composite-property
constraint syntax changed across Neo4j majors.

```cypher
CREATE CONSTRAINT project_id_unique IF NOT EXISTS FOR (p:Project)      REQUIRE p.id IS UNIQUE;
CREATE CONSTRAINT file_identity     IF NOT EXISTS FOR (f:File)         REQUIRE (f.workspaceInstanceId, f.relPath) IS UNIQUE;
CREATE CONSTRAINT class_identity    IF NOT EXISTS FOR (c:Class)        REQUIRE (c.workspaceInstanceId, c.fqn)     IS UNIQUE;
CREATE CONSTRAINT commit_identity   IF NOT EXISTS FOR (c:Commit)       REQUIRE (c.repoId, c.sha)                  IS UNIQUE;
CREATE CONSTRAINT memory_id_unique  IF NOT EXISTS FOR (m:Memory)       REQUIRE m.id IS UNIQUE;
CREATE CONSTRAINT session_id_unique IF NOT EXISTS FOR (s:AgentSession) REQUIRE s.id IS UNIQUE;
CREATE INDEX memory_current         IF NOT EXISTS FOR (m:Memory) ON (m.validTo);
CREATE INDEX memory_project         IF NOT EXISTS FOR (m:Memory) ON (m.chorusProjectId);
CREATE INDEX file_workspace         IF NOT EXISTS FOR (f:File)   ON (f.workspaceInstanceId);
CREATE FULLTEXT INDEX memory_text   IF NOT EXISTS FOR (m:Memory) ON EACH [m.content];
```

**⚠ `commit_identity` DEPENDS ON §0 HOLE 2 AND MUST NOT SHIP BEFORE THAT RULING.** `repoId` has no
definition until then.

**⚠ `(repo, path)` AND `(repo, fqn)` ARE GONE, AND THE REASON IS WORTH KEEPING.** D94.1 corrected
`Plan.md` §10's bare `File.path` uniqueness because it **breaks on git worktrees — Chorus's own core
feature — and on any project with more than one repository.** That reasoning was right and its fix was
still insufficient: the repository half was an absolute path and the path half was worktree-ambiguous.
**§0 is the third version of this key, and the first one grounded in a field Chorus actually owns.**

**The all-idempotent property is asserted over `GRAPH_MIGRATIONS`**, so a statement added in 2027 that
forgets `IF NOT EXISTS` fails in CI rather than on a half-migrated graph. **That is the correct failure
mode for something that runs before the feature is usable.**

**⚠ APOC IS MEASURED ABSENT — DROP IT.** `SHOW PROCEDURES … STARTS WITH 'apoc'` returned **0** on the
image (6-1 D4 pass, item 1). Requiring it would mean an extra `NEO4J_PLUGINS` variable and a download
at container start. `Plan.md` §10's provision flow installs it reflexively — **do not inherit that.**
*"Zero required APOC procedures"* is an acceptance criterion.

## 2. `provenanceCore.ts` — advisory, and therefore measured

**⚠ STATE THE LIMIT BEFORE BUILDING THE ANSWER: CHORUS CANNOT ENFORCE PROVENANCE.** Agents write via
MCP with a Cypher tool; nothing stops one creating a `:Memory` with no source and no session. **Do not
imply otherwise in code comments or UI copy.** What ships instead is the same move `attributionCore`'s
*"% of spend attributed"* already makes: **convert an unenforceable rule into a measured one.**

**⚠ AND STATE F49's LIMIT TOO, WHICH IS SHARPER.** The write tool takes arbitrary Cypher, so **the
same tool can rewrite the provenance this core counts** — a corrupted graph can report itself healthy.
Backup/restore is Stage 5 and **F49 gates it.** The number is a measurement, not an integrity
guarantee, and the code should say so where someone reading it will see it.

The record shape, with the corrections **built in rather than layered on**:

- **NO `confidence` FIELD, IN ANY FORM (D94.3, ratified by CR-6.0 Q1).** Self-reported LLM confidence
  is uncalibrated, not comparable across models, and **will be read as rigor** — the failure D55
  legislated against. Replace with `assertedBy` (model id + adapter id) and a **derived**
  `corroborations` count of independent `:SUPPORTED_BY` sources.
- **Three fields are EDGES, not string properties (D94.4):**
  - `(:Memory)-[:SUPERSEDES]->(:Memory)` with `validTo` set on the superseded node — so *"what do we
    currently believe"* is the indexable `WHERE m.validTo IS NULL` rather than **a scan**.
  - `(:Memory)-[:SUPPORTED_BY]->(:File|:Commit)`, keeping the human-readable citation **as well** —
    without the edge, **provenance is unverifiable by construction**.
  - `(:AgentSession)-[:PRODUCED]->(:Memory)` — **attribution is the whole point of this phase, and an
    optional field is the one that gets omitted.**
- **Every node carries `chorusProjectId` and `writtenVia: 'mcp'|'app'|'skill'`.** The second because
  *"which path wrote this"* is the first question a provenance audit asks **and cannot be
  reconstructed later.**
- **`:File` and `:Class` carry `workspaceInstanceId` + `relPath` / `fqn` as identity, and
  `absPathAtWrite` / `repoRootAtWrite` as metadata** (§0).

Exports:

```ts
export function memoryWriteParams(record: MemoryRecord): Record<string, unknown>
export function workspaceInstanceId(input: { worktreeId: string | null; projectId: string }): string
export function normalizeRelPath(absPath: string, instanceRoot: string): { ok: true; relPath: string } | { ok: false; reason: string }
export const PROVENANCE_QUERIES: { readonly withoutSource: string; readonly total: string; /* … */ }
export function completeness(withSource: number, total: number): { withSource: number; total: number; text: string }
```

**⚠ `completeness` RETURNS THE PAIR, NOT A PERCENTAGE, AND `text` IS `"N of M"`** (D55). **0-of-0 is
`"0 of 0"` — not `NaN`, not 100%.** An empty graph is not fully attributed; it is empty, and those are
different facts.

The queries are asserted **as strings** in the pure test — a pure core cannot execute Cypher, and
pretending otherwise is how a core stops being pure.

### ⚠ What ships, and what is deferred as a unit (D128(c))

| In scope | Deferred (council items 7–9) |
|---|---|
| numerator **and** denominator (*"43 of 512"*) | trend history |
| the ratio | the new-unsourced-vs-backlog split |
| **the affected-node list** | the per-agent breakdown |
| | the repair workflow |
| | context re-weighting / labelling |

**⚠ DO NOT SHIP A PARTIAL VERSION OF THE DEFERRED HALF.** The council's own ruling is that a
measurement without consequence is decoration — **a half-built trend is worse than none**, and no UI
element may hint that a repair workflow exists.

**⚠ AND THE AFFECTED-NODE LIST NEEDS ITS OWN DENOMINATOR WHEN TRUNCATED.** If it is bounded, it renders
*"showing 50 of 469"* — never a bare list that looks complete. D55 applies one level down.

## 3. The two channels

`IpcChannel` **76 → 78** (6-3 leaves 76 — **re-measure**).

| Channel | Contract |
|---|---|
| `memory:seed` | Applies pending graph migrations. Returns `{fromVersion, toVersion, applied: string[]}`. **Re-reads the graph first**; writes `project_memory.schema_version` **only after success**. Refuses `{ok:false, reason}` on a future version. |
| `memory:validate` | Returns `{withSource, total, affected[]}` — **the pair and its denominator, always**. Never a bare count, never a lone percentage, and **`affected[]` carries its own total when bounded.** |

Same four layers as 6-3, same rules: Zod **in main only** (no Zod in preload — `EvalError` under CSP),
plain objects across the bridge (D14), refusals as unions rather than throws.

**Both are user-initiated.** Neither belongs on a timer, and `memory:seed` in particular must not be
called from a boot hook — **it writes.**

## 4. The UI

**In `src/renderer/src/views/ProjectSettingsView.vue`, beside 6-3's memory section.** ⚠ **NOT
`SettingsMemory.vue`** — that file does not exist and is not planned; Task 6-3's ruling records why the
surface is per-project (`project_memory` is keyed by `project_id`, and `SettingsView.vue` has one nav
entry and no routing).

- **A seed control** showing `schema_version` **from the graph**, not from the cache, and what is
  pending. If they disagree, **say so** — that disagreement is a real diagnostic, not a glitch to
  paper over.
- **The completeness report, rendering `"N of M memories carry a source"`**, with **M defined in the
  copy** (current memories — §0).
- **⚠ COPY THAT DOES NOT IMPLY ENFORCEMENT.** Something like *"Chorus measures provenance; it cannot
  require it — agents write to the graph directly."* **The honest sentence is the feature here.**
- **Nothing that hints at the deferred half** — no greyed-out trend, no "coming soon", no disabled
  repair button.
- 3c-1 tokens only. No raw hex, no stock Tailwind palette utility.

## 5. Verification

```bash
npm run typecheck && npx vitest run && npm run grep:secrets
grep -c "sqliteTable(" src/main/db/schema.ts                          # 17 — unchanged
grep -n "// v16" src/main/services/storage.ts                         # present, and NO v17
grep -rn "confidence" src/main/services/provenanceCore.ts             # nothing
grep -rni "apoc" src/main/services/                                   # nothing
grep -rn "absPathAtWrite\|repoRootAtWrite" src/main/services/graphSchemaCore.ts   # nothing — metadata is never keyed
```

**Runtime (G2), against the real Neo4j 6-3 opened — and the second run is the one that matters:**

- [ ] `memory:seed` on a **fresh** graph applies every statement and sets the version.
- [ ] **`memory:seed` AGAIN is a no-op** — `applied` is empty, no error, version unchanged. Idempotence
      demonstrated on the real graph, not argued from `IF NOT EXISTS`.
- [ ] Constraints and indexes are **actually present** — `SHOW CONSTRAINTS` / `SHOW INDEXES`, output
      recorded.
- [ ] **The identity constraint actually bites:** write two `:File` nodes with the same `relPath` under
      **different** `workspaceInstanceId`s (both must succeed — that is the worktree case D94(a) was
      about), then the same pair twice (the second must be refused).
- [ ] `memory:validate` on a graph with **zero** memories renders *"0 of 0"*; on one with a
      hand-written `:Memory` lacking a source, *"0 of 1"*; and on one with a `PRODUCED` edge but **no
      `SUPPORTED_BY`**, still *"0 of 1"* — **that last case is the one that proves the session node is
      not being counted as provenance** (D126).
- [ ] **Hand-set the cache to a version the graph does not have, then seed.** The graph must win and
      the disagreement must surface. **This is the case that proves which one is the authority.**
- [ ] **Zero required APOC procedures**, stated explicitly.
