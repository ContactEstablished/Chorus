# Task 10.2-2 — Execution Prompt (paste into a fresh session)

You are the **Coordinator** for **Task 10.2-2 — Graph migration v3: the `:Symbol` layer**, the schema foundation that 10.2-3 will fill.

**Repo root:** `C:\Projects\ContactEstablished\Chorus`
**Expected branch:** `main`, at **`8514ee3`**. Confirm with `git branch --show-current` and `git log --oneline -1`. **Do not switch branches.**

---

## ⚠ GATE 0 — EVERY CYPHER STATEMENT MUST BE PROBED AGAINST A REAL IMAGE BEFORE HARDCODING

Standing rule: CLAUDE.md forbids trusting training-data recall for constraint syntax. v1 and v2 both did this.

Run 2026-09-13 against a throwaway `neo4j:5-community` 5.26.29: **7 of 7 statements applied, twice, zero failures; `symbol_identity` proven to bite; `symbol_name` measured load-bearing** (NodeIndexSeek with it, a degenerate Filter without).

⚠ **THE PROBE SCRIPTS ARE NOT IN THE REPOSITORY.** `_verify/` is gitignored (`.gitignore:165`), so `_verify/10.2-2/probe-v3.sh`, `probe-v3b.sh` and their `.txt` outputs exist only on the machine that authored this task. **Check for them first:**

```bash
ls _verify/10.2-2/ 2>/dev/null || echo "ABSENT — build the probe from the statement list below"
```

**If they are absent, GATE 0 still binds.** Write a probe from the seven statements reproduced in the Implementation scope section below: start a throwaway `neo4j:5-community` on a spare port, apply all seven **twice** (the second pass is what proves `IF NOT EXISTS` makes re-apply a no-op), then prove the constraint bites — a repeated `(workspaceInstanceId, symbolId)` must be REFUSED, the same `symbolId` under a second `workspaceInstanceId` must be ACCEPTED, and three `MERGE`s of one symbol must produce ONE node. Do not skip the bite test: a constraint that parses but does not bite is the failure that looks like success.

⚠ **IF THE STATEMENT TEXT CHANGES AT ALL, THE EXISTING EVIDENCE NO LONGER COVERS IT — re-run.** ⚠ **NEVER probe against the live `chorus-memory` graph.** Creating a v3 constraint there would leave the graph carrying a schema its own `ChorusSchema.version` does not claim. Use a throwaway container, torn down by exact name (never `docker prune` — it has cost this repo 3.2 GB of unrelated orphans before).

---

## ⚠ GATE 1 — PRE-EXISTING DIRTY TREE. DO NOT REVERT, STAGE, OR COMMIT THESE

```
MM package-lock.json     <- ALREADY STAGED before you started; leave the index alone
MM package.json          <- ALREADY STAGED before you started; leave the index alone
 M src/renderer/src/components/TerminalPane.vue
?? .claude/
?? .procoder/
```

⚠ `package.json` / `package-lock.json` are **staged**, not merely modified — unstaging discards a staging intent that is not yours. Commit by naming your files: `git commit ... -- <paths>`.

⚠ **`TerminalPane.vue` holds a lone CR byte** that the `Edit` tool rewrites as LF, producing a phantom multi-thousand-line diff. **This task must not touch it.** Check `git diff --stat` after every edit anyway; TerminalPane must not appear.

---

## ⚠ GATE 2 — TWO ASSERTIONS ARE PINNED TO VERSION 2 AND MUST MOVE DELIBERATELY

**Line 78** of `src/main/services/graphSchemaCore.test.ts`:
```ts
expect(LATEST_GRAPH_VERSION).toBe(2)     // CHANGE TO: toBe(3)
```
The test's name says `6a-2` — retitle it or add a v3 sibling rather than silently editing a named historical case.

**Line 87** of `src/main/services/graphSchemaCore.test.ts`:
```ts
expect(r.pending.map((m) => m.version)).toEqual([2])     // CHANGE TO: toEqual([2, 3])
```

⚠ **Change them because the schema moved, NOT because they were red.** A pinned assertion edited to make a suite green is how a guard becomes decoration. Every other version assertion derives from `LATEST_GRAPH_VERSION` and adapts itself.

---

## ⚠ GATE 3 — v3 MUST BE RE-CONFIRMED FREE BEFORE IT IS WRITTEN, FROM BOTH HALVES

**(a) Parse source:** read `GRAPH_MIGRATIONS` in `src/main/services/graphSchemaCore.ts`. Expected: `[1, 2]` as of 2026-09-13.

**(b) Read the live store:** run this against the running `chorus-memory`:
```cypher
MATCH (m:ChorusMigration) RETURN m.version
```
Expected: 1.0, 2.0 as of 2026-09-13.

A second Chorus install may have moved one. Both halves read 2 today; confirm they still do before writing v3.

---

## ⚠ GATE 4 — THE CHORUS-MEMORY CONTAINER HAS RESTARTPOLICY=NO AND WAS DOWN FIVE DAYS UNNOTICED

Roadmap finding F122. Any step that reads the graph must first prove it is up:

```bash
docker ps --filter name=chorus-memory --format '{{.Names}} {{.Status}}'
```

Say so in the report when you run this.

---

## ⚠ GATE 5 — GREP GATES MUST NOT MATCH THE PROSE THAT DOCUMENTS THE RULE

Five self-matching gates landed across Phases 10.1 and 10.2 (roadmap F120, F123). Strip comments before grepping, or assert on structure. If you write a gate like `grep -r "NO DELETE"`, the matching prose `⚠ **NO DELETE**` matches itself and produces false confidence. Use structure: `grep '^[ ]*DELETE'` or inspect the statement list directly.

---

## Goal

Add graph migration **v3** — the `:Symbol` node, the `DEFINED_IN` / `CALLS` / `REFERENCES` edges, and five Cypher constants that will write them — so that 10.2-3 has a schema and a write contract to fill and nothing else to design. **This task parses nothing and writes no symbols.** Its output is **a schema proven to apply and to bite against the real image**.

---

## Ground yourself first — read before editing

- `docs/Features/Engine/ImplementationSpecs/ImplementationSpec-10.2-2.md` — §1 the v3 migration, §2 the `symbolId` grammar, §3 the five Cypher constants, §4 the `find_callers` read shape, §5 the two test assertions.
- `docs/Features/Engine/Tasks/Task-10.2-2.md` — the exact scope, decisions D202–D204, acceptance criteria, review checklist, and step-by-step work.
- `docs/Features/Engine/Tasks/Phase-10.2-Overview.md` — the phase contract and the six inherited gates.
- `src/main/services/graphSchemaCore.ts:1-70` — where `GRAPH_MIGRATIONS` lives; line 62 shows the dormant `class_identity` constraint.
- `src/main/services/codeIndexCore.ts:1-50` — where the Cypher constants go; the D149 exclusion comment is at line 22.
- `src/main/services/codeIndexCore.test.ts:263-281` — the no-DELETE sweep and the verb assertions.
- `src/main/services/memoryService.ts:1361` and `:1478` — the seeder applies `pendingMigrations`, so v3 ships by existing; no wiring needed.

---

## Implementation scope

**Edit these and nothing else:**

1. **`src/main/services/graphSchemaCore.ts`** — append the v3 entry to `GRAPH_MIGRATIONS`, after the v2 entry and before the closing `]`. `LATEST_GRAPH_VERSION` is derived by `reduce` and needs no edit.

**These are the seven statements, exactly as probed. Do not retype them from memory — every one of them was applied against a real 5.26.29 and re-typing is the failure GATE 0 exists to prevent.**

```ts
  /**
   * v3 (Task 10.2-2) — the symbol layer. Reverses the `:Class`/`:Method`/`CALLS`
   * exclusion D149 made for `index-codebase` v1, on the evidence of D201.
   *
   * ⚠ ALL SEVEN STATEMENTS WERE APPLIED AGAINST A REAL `neo4j:5-community`
   * BEFORE BEING HARDCODED, as v1's ten and v2's four were — composite
   * constraint AND relationship-property-index syntax both changed across Neo4j
   * majors and CLAUDE.md forbids trusting recall for them. Measured against
   * 5.26.29 on 2026-09-13: all seven applied, re-applying all seven produced
   * ZERO failures, and `symbol_identity` was proven to BITE.
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
      // leading-property-only lookup.
      `CREATE INDEX symbol_workspace IF NOT EXISTS FOR (s:Symbol) ON (s.workspaceInstanceId)`,
      // ⚠ THE ENTRY POINT FOR `find_callers`, AND IT IS LOAD-BEARING — MEASURED.
      // EXPLAIN with this index plans `NodeIndexSeek RANGE INDEX s:Symbol(name)`;
      // dropped, the same query degenerates to a Filter on `s.name`. Removing it
      // would look like a tidy-up in review and would turn every callers lookup
      // into a scan.
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

⚠ **`DEFINED_IN` deliberately gets no run-stamp index**, and the reason belongs in the review: `symbolId` embeds `relPath`, so a symbol that moves file is a **different node**, not the same node with a different edge. `DEFINED_IN` therefore cannot go stale independently of the symbol that owns it.

2. **`src/main/services/graphSchemaCore.test.ts`** — update the two pinned assertions (lines 78 and 87), and add v3 cases:
   - v3 exists, named `symbol-layer-identity`, `LATEST_GRAPH_VERSION` is **3**
   - a graph at v2 is offered **exactly** `[3]`; a graph at v1 is offered `[2, 3]`
   - every v3 statement carries `IF NOT EXISTS` (assert it again for v3 specifically, as v2 does)
   - v3 keys `:Symbol` on `(s.workspaceInstanceId, s.symbolId)` and **contains no `fqn`**
   - v3 introduces **no** `:Memory` / `SUPPORTED_BY` reference, and no `confidence` property
   - ⚠ v3 does **not** mention `:Class` — the dormant constraint is neither revived nor dropped

3. **`src/main/services/codeIndexCore.ts`** — add these five constants after `LINK_MODIFIED` and before `MARK_MISSING`. **Add each to `ALL_INDEX_STATEMENTS`.**

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

Then extend `ALL_INDEX_STATEMENTS`:

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

⚠ **`SET r.lastIndexedAt = $runId` sits on the relationship, not the node.** A `MERGE` that forgets it creates an edge with a null stamp, which **no read filter can ever exclude** — a permanent false positive in `find_callers`. Pin it with a test.

4. **`src/main/services/codeIndexCore.test.ts`** — assert:
   - the five new constants are in `ALL_INDEX_STATEMENTS`, so the no-DELETE and verb sweeps cover them
   - `LINK_CALLS` and `LINK_REFERENCES` **set `lastIndexedAt` on the relationship** — assert the `SET r.` shape
   - `UPSERT_SYMBOLS` sets `missingSince = null`, mirroring `UPSERT_FILES`
   - ⚠ **no constant compares an edge stamp to `Project.lastIndexedAt`** — pin D203's correction as a test, so the worktree-breaking form cannot come back in review

---

## The three resolved decisions

**D202 (SETTLED 2026-09-13, Matthew): `:Symbol` is keyed `(workspaceInstanceId, symbolId)`, NOT `fqn`.**

`symbolId` is deterministic, human-readable:
```
symbolId  ::=  relPath "#" qualifiedName ":" kind [ "@" ordinal ]

Example:
  src/main/services/launchOptionsCore.ts#composeLaunchOptions:function
  src/main/services/sessionManager.ts#SessionManager.write:method
  src/main/x.ts#overloaded:function@2          <- 2nd overload, source order
```

The dormant `class_identity` constraint on `(:Class)` stays **dormant and unused**; v3 neither revives nor drops it. ⚠ **State so in the migration comment**, or the next reader will assume `:Class` is live.

**D203 (SETTLED 2026-09-13, Matthew): stale `CALLS` / `REFERENCES` edges are STAMPED and FILTERED at read, NEVER deleted.**

Every such edge carries `lastIndexedAt`; read templates exclude anything whose stamp is not current. ⚠ **THE FILTER IS `r.lastIndexedAt = s.lastIndexedAt` (the CALLEE's own stamp), NEVER `r.lastIndexedAt = p.lastIndexedAt` (Project-wide).**

**Measured correction during this kickoff:** Project-wide form tested on one project with two workspace instances indexed in different runs — returned **1 of 2** live callers and silently dropped the second instance. The callee-stamp form returned **2 of 2** and still excluded the stale edge.

**Today that cannot bite** — `workspaceInstanceIdFor` yields **exactly one instance per project** — which is exactly why the wrong form would survive review and detonate later. **Implement the callee-stamp form.** It is correct under both regimes, costs no extra node and no extra hop, and removes a trap that would otherwise be armed by an unrelated future change.

⚠ **The read shape this stamp exists for. NOT shipped by this task** — Task 10.2-4 ships it — **and reproduced here only so the stamp is written to match the reader that will consume it.** A stamp only means something if every reader filters on it the same way:

```cypher
// find_callers — the shape 10.2-4 will deliver. Do not add it to any contract now.
MATCH (c:Symbol)-[r:CALLS]->(s:Symbol {workspaceInstanceId: $wid, name: $name})
WHERE r.lastIndexedAt = s.lastIndexedAt
RETURN c.relPath AS path, c.name AS caller, c.kind AS kind
ORDER BY path LIMIT 50
```

⚠ If a test or comment written by this task states the read shape, it must state **this** one. A second, drifted copy of the filter is how the project-wide form gets reintroduced by someone reading the wrong example.

**D204 (SETTLED 2026-09-13, Matthew): scope is the migration plus the Cypher constants.** No parser, no `typescript` promotion, no contract lines. See Non-Goals.

---

## Strict non-goals

- ❌ **No parser and no `typescript` promotion.** That is 10.2-3. `typescript` stays a devDependency, runtime dependencies stay at **9**.
- ❌ **No contract lines, no new templates in `instructionsCore.ts`.** Contract line count stays **21**. ⚠ A `find_callers` template shipped now would answer zero rows until 10.2-3 exists (roadmap F122).
- ❌ **No symbol is written by this task.** `MATCH (s:Symbol) RETURN count(s)` stays **0**.
- ❌ **No `DELETE`, `DETACH` or `REMOVE` anywhere** — D149(b), and `codeIndexCore.test.ts:263-267` enforces it.
- ❌ **No revival and no removal of `class_identity`.**
- ❌ **No `:Memory` / `SUPPORTED_BY` reference** (D147(c)'s label boundary — the safety argument for one graph rather than two databases).
- ❌ **No seeder wiring.** `memoryService.ts:1361`/`:1478` already apply whatever `pendingMigrations` returns; v3 ships by existing.
- ❌ **No source text, no signatures, no embeddings on `:Symbol`** (D149's posture).
- ❌ Do not revert, stage or commit the pre-existing dirty files from GATE 1.

---

## Required workflow

Coordinator pattern: implement → spec review against `ImplementationSpec-10.2-2.md` → code-quality review → resolve findings → verification → narrate the commit.

**One intentional commit**, by explicit pathspec — never `git add -A`. **Do NOT PUSH and do NOT open a PR unless explicitly asked.**

Commit message house style: concise imperative title, **What this does** in plain language, **Decisions** quoting D202–D204 with dates, **Verification** with the actual command outputs and the actual count(s:Symbol) before and after, and **Scope** listing the four files.

---

## Verification commands — run these, do not reason about them

```bash
npm run typecheck                                   # expect 0 errors
npx vitest run                                      # baseline 3305 tests / 95 files, 0 failures.
                                                    # This task ADDS tests: the number must go UP.
npx vitest run src/main/services/graphSchemaCore.test.ts
npx vitest run src/main/services/codeIndexCore.test.ts

# The statements, against a REAL image — if statement text changed, evidence is void
bash _verify/10.2-2/probe-v3.sh
bash _verify/10.2-2/probe-v3b.sh

# F122: the graph must be up
docker ps --filter name=chorus-memory --format '{{.Names}} {{.Status}}'
```

**Runtime gate** — launch dev Chorus once against the live graph, then:

```cypher
MATCH (s:ChorusSchema {id:'chorus'}) RETURN s.version          -- expect: 2 -> 3
MATCH (m:ChorusMigration) RETURN m.version, m.name ORDER BY m.version
SHOW CONSTRAINTS YIELD name WHERE name = 'symbol_identity' RETURN name
MATCH (s:Symbol) RETURN count(s)                                -- expect: 0
```

⚠ **`count(s) = 0` is an ACCEPTANCE CRITERION, not a disappointment.** A non-zero count means something is writing symbols no reviewed extractor produced.

**Non-goals re-check before reporting done:**
- ✅ runtime dependencies still **9**
- ✅ `typescript` still a devDependency
- ✅ contract line count still **21**
- ✅ `GRAPH_MIGRATIONS` length **3** (v1, v2, v3)

---

## Failure honesty

If a verification command fails for an unrelated environment reason (Docker not running, a port in use, Neo4j down), capture the **EXACT output**, explain it plainly, and **do not claim success**. A skipped gate must be reported as skipped, never as passed.

If the `symbol_identity` constraint does not bite when re-probed, or if `count(s:Symbol)` is non-zero after the runtime gate, those are the failures the acceptance criteria exist to catch — state them plainly.

⚠ **Never report a negative from an instrument you have not validated.** Validate a probe script against a known-good image before reporting a constraint missing.

---

## Final report — required structure

**Status:** `DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED`

**Files changed:** each with a one-line reason. Call out the Cypher constants added and the test assertions moved.

**Build results:** typecheck exit code · test counts before/after · `git diff --stat`.

**Probe results:** statements applied / failed; `symbol_identity` bite confirmed; `symbol_name` load-bearing confirmed; re-run against final text or note if text is unchanged from the probed version.

**Docker status:** the output of the `docker ps` command when you ran it.

**Runtime gate:** ChorusSchema.version before and after; actual `count(s:Symbol)` observed; `symbol_identity` constraint present; migration rows present.

**Non-goals confirmation:**
- ✅ no parser, no `typescript` promotion
- ✅ no contract lines, no templates
- ✅ no symbols written
- ✅ no DELETE/DETACH/REMOVE
- ✅ no `class_identity` revival
- ✅ no `:Memory` / `SUPPORTED_BY`
- ✅ no seeder wiring
- ✅ no source text or embeddings
- ✅ pre-existing dirty files untouched

**Residual risks:** anything found and deliberately not fixed, with reasoning.

**Final state:** `git status --porcelain`, commit hash and title.
