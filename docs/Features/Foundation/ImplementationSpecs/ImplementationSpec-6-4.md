# ImplementationSpec 6-4 — Graph Schema, Provenance and the Validator

**Normative for:** [`../Tasks/Task-6-4.md`](../Tasks/Task-6-4.md). **Design input:
[`../Phase-6-MemoryPlan.md`](../Phase-6-MemoryPlan.md) §4 and §8.**

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

**Seed v1 — plan §8's list, and ⚠ D4-VERIFY THE NEO4J 5 SYNTAX AGAINST THE ACTUAL IMAGE BEFORE
HARDCODING IT** (composite-property constraint syntax changed across Neo4j majors; 6-1 item 1
establishes which major the tag resolves to):

```cypher
CREATE CONSTRAINT project_id_unique  IF NOT EXISTS FOR (p:Project)      REQUIRE p.id IS UNIQUE;
CREATE CONSTRAINT file_path_unique   IF NOT EXISTS FOR (f:File)         REQUIRE (f.repo, f.path) IS UNIQUE;
CREATE CONSTRAINT class_fqn_unique   IF NOT EXISTS FOR (c:Class)        REQUIRE (c.repo, c.fqn)  IS UNIQUE;
CREATE CONSTRAINT commit_sha_unique  IF NOT EXISTS FOR (c:Commit)       REQUIRE (c.repo, c.sha)  IS UNIQUE;
CREATE CONSTRAINT memory_id_unique   IF NOT EXISTS FOR (m:Memory)       REQUIRE m.id IS UNIQUE;
CREATE CONSTRAINT session_id_unique  IF NOT EXISTS FOR (s:AgentSession) REQUIRE s.id IS UNIQUE;
CREATE INDEX memory_current          IF NOT EXISTS FOR (m:Memory) ON (m.validTo);
CREATE INDEX memory_project          IF NOT EXISTS FOR (m:Memory) ON (m.chorusProjectId);
CREATE FULLTEXT INDEX memory_text    IF NOT EXISTS FOR (m:Memory) ON EACH [m.content];
```

**⚠ THE COMPOSITE KEYS ARE D94.1 AND THEY ARE NOT A REFINEMENT.** `Plan.md` §10's bare `File.path`
uniqueness **breaks on git worktrees — Chorus's own core feature — and on any project with more than
one repository.** `(repo, path)` is the correction.

**The all-idempotent property is asserted over `GRAPH_MIGRATIONS`**, so a statement added in 2027 that
forgets `IF NOT EXISTS` fails in CI rather than on a half-migrated graph. **That is the correct failure
mode for something that runs before the feature is usable.**

**APOC: drop it unless a seed statement above genuinely requires it.** Plan §10 item 1 asks; 6-1
answers. `Plan.md` §10's provision flow installs it reflexively — do not inherit that.

## 2. `provenanceCore.ts` — advisory, and therefore measured

**⚠ STATE THE LIMIT BEFORE BUILDING THE ANSWER: CHORUS CANNOT ENFORCE PROVENANCE.** Agents write via
MCP with a Cypher tool; nothing stops one creating a `:Memory` with no source and no session. **Do not
imply otherwise in code comments or UI copy.** What ships instead is the same move `attributionCore`'s
*"% of spend attributed"* already makes: **convert an unenforceable rule into a measured one.**

The record shape, with D94's corrections **built in rather than layered on**:

- **NO `confidence` FIELD, IN ANY FORM (D94.3).** Self-reported LLM confidence is uncalibrated, not
  comparable across models, and **will be read as rigor** — the failure D55 legislated against.
  Replace with `assertedBy` (model id + adapter id) and a **derived** `corroborations` count of
  independent `:SUPPORTED_BY` sources.
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

Exports:

```ts
export function memoryWriteParams(record: MemoryRecord): Record<string, unknown>
export const PROVENANCE_QUERIES: { readonly withoutSource: string; readonly total: string; /* … */ }
export function completeness(withSource: number, total: number): { withSource: number; total: number; text: string }
```

**⚠ `completeness` RETURNS THE PAIR, NOT A PERCENTAGE, AND `text` IS `"N of M"`** (D55). **0-of-0 is
`"0 of 0"` — not `NaN`, not 100%.** An empty graph is not fully attributed; it is empty, and those are
different facts.

The queries are asserted **as strings** in the pure test — a pure core cannot execute Cypher, and
pretending otherwise is how a core stops being pure.

## 3. The two channels

| Channel | Contract |
|---|---|
| `memory:seed` | Applies pending graph migrations. Returns `{fromVersion, toVersion, applied: string[]}`. **Re-reads the graph first**; writes `project_memory.schema_version` **only after success**. Refuses `{ok:false, reason}` on a future version. |
| `memory:validate` | Returns the completeness pair **and its denominator, always** — `{withSource, total}`. Never a bare count, never a lone percentage. |

Same four layers as 6-3, same rules: Zod **in main only** (no Zod in preload — `EvalError` under CSP),
plain objects across the bridge (D14), refusals as unions rather than throws.

**Both are user-initiated.** Neither belongs on a timer, and `memory:seed` in particular must not be
called from a boot hook — it writes.

## 4. The UI

In `SettingsMemory.vue`, beside 6-3's config form:

- **A seed control** showing `schema_version` **from the graph**, not from the cache, and what is
  pending. If they disagree, **say so** — that disagreement is a real diagnostic, not a glitch to
  paper over.
- **The completeness report, rendering `"N of M memories carry a source"`.** ⚠ **And copy that does
  not imply enforcement.** Something like *"Chorus measures provenance; it cannot require it — agents
  write to the graph directly."* **The honest sentence is the feature here.**
- 3c-1 tokens only. No raw hex, no stock Tailwind palette utility.

## 5. Verification

```bash
npm run typecheck && npx vitest run && npm run grep:secrets
grep -c "sqliteTable(" src/main/db/schema.ts             # 17 — unchanged
grep -rn "confidence" src/main/services/provenanceCore.ts   # nothing
```

**Runtime (G2), against the real Neo4j 6-3 opened — and the second run is the one that matters:**

- [ ] `memory:seed` on a **fresh** graph applies every statement and sets the version.
- [ ] **`memory:seed` AGAIN is a no-op** — `applied` is empty, no error, version unchanged. Idempotence
      demonstrated on the real graph, not argued from `IF NOT EXISTS`.
- [ ] Constraints and indexes are **actually present** — `SHOW CONSTRAINTS` / `SHOW INDEXES`, output
      recorded.
- [ ] `memory:validate` on a graph with **zero** memories renders *"0 of 0"*, and on one with a
      hand-written `:Memory` lacking a source renders *"0 of 1"*.
- [ ] **Hand-set the cache to a version the graph does not have, then seed.** The graph must win and
      the disagreement must surface. **This is the case that proves which one is the authority.**
