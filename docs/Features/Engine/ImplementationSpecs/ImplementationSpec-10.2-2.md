# Implementation Spec 10.2-2 — graph migration v3, the `:Symbol` layer

Companion to `Tasks/Task-10.2-2.md`. Everything below was applied against a real
`neo4j:5-community` **5.26.29** before being written here — `_verify/10.2-2/probe-v3.sh` and
`probe-v3b.sh`, outputs beside them. Nothing in this file is recalled syntax.

---

## Why this is a task and not a line in 10.2-3

The parser is the expensive half and the schema is the half that is hard to change later. A
`:Symbol` written under the wrong key cannot be re-keyed without deleting nodes, and **D149(b)
forbids the indexer from deleting anything** — so the identity decision has to be right before the
first symbol exists, not after. Separating them also means 10.2-3 is reviewed as "does the extractor
produce correct rows", not "and also, is this the right graph".

---

## 1. The v3 migration

Append to `GRAPH_MIGRATIONS` in `graphSchemaCore.ts`, after the v2 entry and before the closing `]`.
`LATEST_GRAPH_VERSION` is derived and needs no edit.

```ts
  /**
   * v3 (Task 10.2-2) — the symbol layer. Reverses the `:Class`/`:Method`/`CALLS`
   * exclusion D149 made for `index-codebase` v1, on the evidence of D201: given a
   * question the graph can answer completely, codex used the index and did not
   * search the repository at all.
   *
   * ⚠ ALL SEVEN STATEMENTS WERE APPLIED AGAINST A REAL `neo4j:5-community`
   * BEFORE BEING HARDCODED, as v1's ten and v2's four were — composite
   * constraint AND relationship-property-index syntax both changed across Neo4j
   * majors and CLAUDE.md forbids trusting recall for them. Probe:
   * `_verify/10.2-2/probe-v3.sh`, measured against **5.26.29** on 2026-09-13.
   * All seven applied; re-applying all seven produced **zero** failures;
   * `symbol_identity` was proven to BITE (a repeated `(wid, symbolId)` is
   * refused, the same `symbolId` under a second workspace instance is accepted,
   * and three `MERGE`s of one symbol produced one node).
   *
   * ⚠ `(:Class)`'s `class_identity` constraint FROM v1 IS LEFT EXACTLY AS IT IS —
   * dormant, never written to, neither revived nor dropped. `:Symbol` carries
   * `kind: 'class'` instead. A future reader who sees `class_identity` and
   * assumes `:Class` is live will write nodes nothing queries.
   *
   * ⚠ THE KEY IS `symbolId`, NOT `fqn` (D202). A TypeScript `fqn` is ambiguous
   * across overloads and anonymous default exports, and would have to embed the
   * path to be unique anyway — at which point it is `symbolId` with a worse name.
   */
  {
    version: 3,
    name: 'symbol-layer-identity',
    statements: [
      // Same shape as :File and :Directory — per workspace instance, and the
      // path-bearing half is repository-relative. Proven to bite; see above.
      `CREATE CONSTRAINT symbol_identity IF NOT EXISTS FOR (s:Symbol) REQUIRE (s.workspaceInstanceId, s.symbolId) IS UNIQUE`,
      // Not redundant with the constraint's backing index, for the reason
      // `file_workspace` records: Neo4j will not use a composite index for a
      // leading-property-only lookup, and "everything in this instance" is a
      // per-instance question.
      `CREATE INDEX symbol_workspace IF NOT EXISTS FOR (s:Symbol) ON (s.workspaceInstanceId)`,
      // ⚠ THE ENTRY POINT FOR `find_callers`, AND IT IS LOAD-BEARING — MEASURED.
      // EXPLAIN with this index plans `NodeIndexSeek RANGE INDEX s:Symbol(name)`;
      // dropped, the same query degenerates to a Filter on `s.name`. Removing it
      // would look like a tidy-up in review and would turn every callers lookup
      // into a scan. (`_verify/10.2-2/probe-v3b-output.txt`.)
      `CREATE INDEX symbol_name IF NOT EXISTS FOR (s:Symbol) ON (s.name)`,
      `CREATE INDEX symbol_project IF NOT EXISTS FOR (s:Symbol) ON (s.chorusProjectId)`,
      // "Every symbol defined in this file" — `impact_of`'s first hop.
      `CREATE INDEX symbol_file IF NOT EXISTS FOR (s:Symbol) ON (s.workspaceInstanceId, s.relPath)`,
      // ⚠ RELATIONSHIP property indexes. D203 filters every read on the edge's
      // run stamp, so the stamp is a predicate on the hot path rather than
      // decoration. The `FOR ()-[r:TYPE]-() ON (r.prop)` form was probed: both
      // created as RANGE / RELATIONSHIP indexes on 5.26.29.
      `CREATE INDEX calls_run IF NOT EXISTS FOR ()-[r:CALLS]-() ON (r.lastIndexedAt)`,
      `CREATE INDEX references_run IF NOT EXISTS FOR ()-[r:REFERENCES]-() ON (r.lastIndexedAt)`
    ]
  }
```

⚠ **`DEFINED_IN` gets no run-stamp index**, and the reason should be in the review: `symbolId`
embeds `relPath`, so a symbol that moves file is a **different node**, not the same node with a
different edge. `DEFINED_IN` therefore cannot go stale independently of the symbol that owns it.

---

## 2. `symbolId` — the exact grammar

```
symbolId  ::=  relPath "#" qualifiedName ":" kind [ "@" ordinal ]

relPath        the SAME normalized value :File.relPath carries — repository-relative,
               forward slashes, produced by normalizeRelPath(). This is what lets
               LINK_DEFINED_IN match a file without a second lookup key.
qualifiedName  dot-joined container chain, outermost first: "SessionManager.write",
               "Namespace.Klass.method". A top-level symbol is just its name.
kind           a CLOSED set — function | method | class | interface | type | enum |
               const | variable. 10.2-3 must not widen it silently; a test pins it.
ordinal        omitted for the first symbol with a given id; "@2", "@3" … for
               subsequent ones in SOURCE ORDER.
```

⚠ **Two honest limits, to be written into the code comment rather than discovered later:**

1. **The ordinal is positional, so deleting overload #1 renumbers #2.** That is identity churn: the
   old node goes stale and a new one appears. Acceptable because `missingSince` marks rather than
   deletes, and because overloads are rare — but it is a real edge and must not be presented as
   stable.
2. **A `relPath` containing `#` would split ambiguously.** Reject such paths in 10.2-3 rather than
   escaping them; a repository file named with `#` is vanishingly rare and a silent mis-parse is
   worse than a skipped file. The count of skipped paths belongs in the index report.

---

## 3. The Cypher constants

Add to `codeIndexCore.ts` after `LINK_MODIFIED` and before `MARK_MISSING`. Every one is a `MERGE`
or a `SET` — no `DELETE`, no `DETACH`, no `REMOVE` (D149(b)).

```ts
export const UPSERT_SYMBOLS = `
UNWIND $rows AS row
MERGE (s:Symbol {workspaceInstanceId: $workspaceInstanceId, symbolId: row.symbolId})
  SET s.name            = row.name,
      s.kind            = row.kind,
      s.relPath         = row.relPath,
      s.containerName   = row.containerName,
      s.line            = row.line,
      s.chorusProjectId = $projectId,
      s.lastIndexedAt   = $runId,
      s.missingSince    = null
`.trim()

export const LINK_DEFINED_IN = `
UNWIND $rows AS row
MATCH (s:Symbol {workspaceInstanceId: $workspaceInstanceId, symbolId: row.symbolId})
MATCH (f:File   {workspaceInstanceId: $workspaceInstanceId, relPath: row.relPath})
MERGE (s)-[:DEFINED_IN]->(f)
`.trim()

export const LINK_CALLS = `
UNWIND $rows AS row
MATCH (caller:Symbol {workspaceInstanceId: $workspaceInstanceId, symbolId: row.callerId})
MATCH (callee:Symbol {workspaceInstanceId: $workspaceInstanceId, symbolId: row.calleeId})
MERGE (caller)-[r:CALLS]->(callee)
  SET r.lastIndexedAt = $runId
`.trim()

export const LINK_REFERENCES = `
UNWIND $rows AS row
MATCH (src:Symbol {workspaceInstanceId: $workspaceInstanceId, symbolId: row.srcId})
MATCH (dst:Symbol {workspaceInstanceId: $workspaceInstanceId, symbolId: row.dstId})
MERGE (src)-[r:REFERENCES]->(dst)
  SET r.lastIndexedAt = $runId
`.trim()

export const MARK_MISSING_SYMBOLS = `
MATCH (s:Symbol {workspaceInstanceId: $workspaceInstanceId})
WHERE s.lastIndexedAt <> $runId AND s.missingSince IS NULL
  SET s.missingSince = $runId
RETURN count(s) AS marked
`.trim()
```

Then extend the list — **a constant not in it is a constant the no-deletion test does not walk**:

```ts
export const ALL_INDEX_STATEMENTS: readonly string[] = [
  UPSERT_PROJECT,
  UPSERT_FILES,
  UPSERT_DIRECTORIES,
  LINK_CONTAINS,
  UPSERT_COMMITS,
  LINK_MODIFIED,
  MARK_MISSING,
  UPSERT_SYMBOLS,
  LINK_DEFINED_IN,
  LINK_CALLS,
  LINK_REFERENCES,
  MARK_MISSING_SYMBOLS
]
```

⚠ `SET r.lastIndexedAt = $runId` sits on the **relationship**, not the node. A `MERGE` that forgets
it creates an edge with a null stamp, which **no read filter can ever exclude** — a permanent false
positive in `find_callers`, which is precisely the failure that would make the tool worse than
`rg`. Pin it with a test.

---

## 4. The read shape 10.2-4 will use — recorded now so it is not re-derived

Not shipped by this task. Written down because the stamp only means something if every reader
filters on it the same way.

```cypher
// find_callers
MATCH (c:Symbol)-[r:CALLS]->(s:Symbol {workspaceInstanceId: $wid, name: $name})
WHERE r.lastIndexedAt = s.lastIndexedAt
RETURN c.relPath AS path, c.name AS caller, c.kind AS kind
ORDER BY path LIMIT 50
```

⚠ **`r.lastIndexedAt = s.lastIndexedAt`, never `= p.lastIndexedAt`.** Measured, one project with two
workspace instances indexed in different runs: the project-wide form returned **1 of 2** live
callers and silently dropped the second instance; the callee-stamp form returned **2 of 2** and
still excluded the stale edge. Today `workspaceInstanceIdFor` yields one instance per project so the
project form cannot bite yet — which is exactly why it would survive review and detonate later.

---

## 5. The two tests that must move deliberately

`graphSchemaCore.test.ts` holds two assertions pinned to version 2. Everything else derives from
`LATEST_GRAPH_VERSION` and adapts on its own — which is the payoff of the "derived, not restated"
rule, and worth saying in the commit.

| line | now | becomes | note |
|---|---|---|---|
| `:78` | `expect(LATEST_GRAPH_VERSION).toBe(2)` | `toBe(3)` | the test's name says `6a-2`; retitle or add a v3 sibling rather than silently editing a named historical case |
| `:87` | `expect(r.pending.map(m => m.version)).toEqual([2])` | `toEqual([2, 3])` | a graph at v1 is now owed two steps |

⚠ **Change them because the schema moved, not because they were red.** A pinned assertion edited to
make a suite green is how a guard becomes decoration.

---

## 6. Verification

```bash
npm run typecheck
npx vitest run
bash _verify/10.2-2/probe-v3.sh     # re-run against the FINAL statement text
bash _verify/10.2-2/probe-v3b.sh
docker ps --filter name=chorus-memory --format '{{.Names}} {{.Status}}'   # F122
```

**Runtime gate.** No wiring is needed — `memoryService.ts:1361` (`seed`) and `:1478` (`index`) both
apply whatever `pendingMigrations` returns.

⚠ **BUT LAUNCHING THE APP DOES NOT APPLY IT, AND AN EARLIER DRAFT OF THIS SECTION SAID IT WOULD.**
Measured 2026-09-13: after a dev launch the graph still read `ChorusSchema.version = 2` with no v3
row. **Graph migrations are USER-INITIATED by design (D58)** — they run on *Project settings →
Memory → Seed*, or on an index run. Boot-time graph work was explicitly **refused** by D177 (F97),
so an implementer who "fixes" this by seeding at startup would be reversing a settled decision.

Trigger it the way a user does, then read the graph:

```js
// renderer console, or over CDP
await window.chorus.seedMemory('<projectId>')
// measured: {"ok":true,"from_version":2,"to_version":3,"applied":["symbol-layer-identity"]}
```

```cypher
MATCH (s:ChorusSchema {id:'chorus'}) RETURN s.version              // 2 -> 3
MATCH (m:ChorusMigration) RETURN m.version, m.name ORDER BY m.version
SHOW CONSTRAINTS YIELD name WHERE name = 'symbol_identity' RETURN name
MATCH (s:Symbol) RETURN count(s)                                   // 0 — nothing writes yet
```

⚠ **`count(s) = 0` is the acceptance criterion, not a disappointment.** A non-zero count after this
task means something is writing symbols that no reviewed extractor produced.

**Non-goals to re-check before reporting done:** runtime dependencies still **9**, `typescript`
still a devDependency, contract line count still **21**, `GRAPH_MIGRATIONS` length **3**.
