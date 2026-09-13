# Task 10.2-2 — Graph migration v3: the `:Symbol` layer

**Phase:** Engine 10.2 — Code index: the symbol layer
**Status:** authored 2026-09-13, unexecuted
**Estimated:** ~1 day (schema and Cypher only; no parser)

---

## Source Of Truth

- `docs/Features/Engine/Tasks/Phase-10.2-Overview.md` — the phase contract and the six inherited gates
- `docs/Features/Engine/chorus-engine-spec.md` §5 Phase 10.2
- `docs/Features/Foundation/roadmap.md` — **D94(a)**, **D126** (the identity model), **D147(c)** (the
  label boundary), **D149** and **D149(b)** (what v1 excluded, and never-delete), **D198**,
  **D201** (the adoption result this task proceeds on), and **D202–D204** (resolved below)
- `docs/Features/Foundation/Phase-6-IdentityModel.md`
- Code under change: `src/main/services/graphSchemaCore.ts`, `src/main/services/codeIndexCore.ts`
  and their tests

---

## Initial Starting Point (verified 2026-09-13 at `89876fd`, measured not recalled)

| fact | value | how it was verified |
|---|---|---|
| `GRAPH_MIGRATIONS` | `[v1 identity-constraints-and-indexes, v2 code-structure-identity]` | read from source |
| `LATEST_GRAPH_VERSION` | **2**, derived via `reduce`, not restated | source |
| live graph ledger | `ChorusMigration` 1.0 and 2.0; `ChorusSchema {id:'chorus'}.version = 2.0` | `cypher-shell` against the running `chorus-memory` |
| Neo4j kernel | **5.26.29** | `CALL dbms.components()` |
| **v3 is free** | both halves read 2 | gate 2 of the phase, satisfied |
| `class_identity` on `(:Class)` `(workspaceInstanceId, fqn)` | **exists in v1 and has never been written to** — zero `:Class` nodes | `graphSchemaCore.ts:62`; label census on the live graph |
| D149 exclusion | *"no `:Class`, no `:Method`, no `CALLS`, no source text, no embeddings"* | `codeIndexCore.ts:22` |
| no-DELETE sweep | `ALL_INDEX_STATEMENTS` asserted free of `DELETE`/`DETACH`/`REMOVE`, and every statement is `MERGE`/`SET`/`UNWIND`/`MATCH`/`RETURN` | `codeIndexCore.test.ts:263-267`, `:281` |
| the seeder | `memoryService.ts:1361` and `:1478` both call `pendingMigrations` and write `VERSION_NODE_CYPHER` | source |
| tests pinned to `2` | **exactly two**: `graphSchemaCore.test.ts:78` (`toBe(2)`) and `:87` (`toEqual([2])`) | grep + read |
| suite baseline | 95 files / 3305 tests at `0248041` | roadmap |

⚠ **Every statement this task hardcodes has already been applied against a real
`neo4j:5-community`** — v1 and v2 both did this, and CLAUDE.md forbids trusting training-data
recall for constraint syntax. Evidence: `_verify/10.2-2/probe-v3-output.txt` and
`probe-v3b-output.txt`, run 2026-09-13 on a throwaway container, torn down by exact name. **The
live `chorus-memory` graph was never written to** — creating a v3 constraint there would leave the
graph carrying a schema its own `ChorusSchema.version` does not claim.

---

## Goal

Add graph migration **v3** — the `:Symbol` node and the `DEFINED_IN` / `CALLS` / `REFERENCES`
edges — together with the Cypher constants that will write them, so that 10.2-3 has a schema and a
write contract to fill and nothing else to design. **This task parses nothing and writes no
symbols.** Its output is a schema the extractor targets, proven to apply and to bite against the
real image.

---

## Decisions resolved for this task (2026-09-13, Matthew)

**D202 — `:Symbol` is keyed `(workspaceInstanceId, symbolId)`**, where `symbolId` is a
deterministic, human-readable string:

```
<relPath>#<qualifiedName>:<kind>[@<ordinal>]

src/main/services/launchOptionsCore.ts#composeLaunchOptions:function
src/main/services/sessionManager.ts#SessionManager.write:method
src/main/x.ts#overloaded:function@2          <- 2nd overload, source order
```

The dormant `class_identity` constraint stays **dormant and unused**; v3 neither revives nor drops
it. ⚠ Say so in the migration's comment, or the next reader will assume `:Class` is live.

**D203 — stale edges are stamped and filtered, never deleted.** Every `CALLS` and `REFERENCES` edge
carries `lastIndexedAt`; read templates exclude anything whose stamp is not current. D149(b) is
untouched and the no-DELETE sweep stays green.

⚠ **CORRECTED DURING THIS KICKOFF — A LATENT FLAW, NOT A LIVE BUG, AND THE DISTINCTION IS STATED SO
NOBODY "FIXES" IT BACK.** The filter as originally drafted compared the edge stamp to
**`Project.lastIndexedAt`**, which is one value per project. The identity model and
`symbol_identity` both key per **workspace instance**, and the graph accepts two instances of one
project side by side — measured, `probe-v3-output.txt` BITE 2.

✅ **Today that cannot bite**, and this was checked rather than assumed:
`workspaceInstanceIdFor` (`codeIndexCore.ts`, `'pj:' + projectId`) returns **exactly one instance
per project** — its own comment says a worktree *"is a short-lived view of the same repository"* and
is deliberately not indexed. One instance means the project stamp and the instance stamp always move
together.

⚠ **But it breaks the moment a worktree is indexed**, which is the obvious next step for a product
whose core feature is worktrees. Measured on a real graph with one project and two instances indexed
in different runs (`probe-v3b-output.txt`):

| filter | result |
|---|---|
| `r.lastIndexedAt = p.lastIndexedAt` (project-wide) | returns **1 of 2** live callers — silently drops the whole second instance |
| `r.lastIndexedAt = s.lastIndexedAt` (the callee's own stamp) | returns **2 of 2** live callers, and still excludes the stale `run-5` edge |

**Implement the callee-stamp form.** It is correct under both regimes, costs no extra node and no
extra hop, and removes a trap that would otherwise be armed by an unrelated future change.

**D204 — scope is the migration plus the Cypher constants.** No parser, no `typescript` promotion,
no contract lines. See Non-Goals.

---

## Exact Scope

**Edit:**

- `src/main/services/graphSchemaCore.ts` — append the v3 entry. `LATEST_GRAPH_VERSION` needs no
  edit: it is derived.
- `src/main/services/graphSchemaCore.test.ts` — v3 cases, plus the **two** pinned assertions that
  must move deliberately (`:78` `toBe(2)` → `toBe(3)`; `:87` `toEqual([2])` → `toEqual([2, 3])`).
- `src/main/services/codeIndexCore.ts` — `UPSERT_SYMBOLS`, `LINK_DEFINED_IN`, `LINK_CALLS`,
  `LINK_REFERENCES`, `MARK_MISSING_SYMBOLS`; each added to `ALL_INDEX_STATEMENTS`.
- `src/main/services/codeIndexCore.test.ts` — assertions for the new constants.

**Create:**

- `_verify/10.2-2/` — already holds this kickoff's probe and its output; re-run it if any statement
  changes.

**Touch nothing else.**

---

## Non-Goals

- ❌ **No parser and no `typescript` promotion.** That is 10.2-3, and D198 scopes it to OpenAI
  agents only. `typescript` stays a devDependency and runtime dependencies stay at **9**.
- ❌ **No contract lines, no new templates in `instructionsCore.ts`.** The contract's line count
  stays **21**. ⚠ A `find_callers` template shipped now would answer zero rows until 10.2-3 exists,
  which is the precise failure F122 records.
- ❌ **No symbol is written by this task.** `MATCH (s:Symbol) RETURN count(s)` stays 0.
- ❌ **No `DELETE`, `DETACH` or `REMOVE`** anywhere — D149(b), and the sweep enforces it.
- ❌ **No revival and no removal of `class_identity`.**
- ❌ **No memory-namespace label or edge** (`:Memory`, `SUPPORTED_BY`) — D147(c)'s label boundary is
  the safety argument for one graph rather than two databases.
- ❌ **No seeder wiring.** `memoryService.ts:1361`/`:1478` already apply whatever
  `pendingMigrations` returns; v3 ships by existing.
- ❌ **No source text, no signatures, no embeddings** on `:Symbol` — D149's posture.
- ❌ **Do not revert, stage or commit the pre-existing dirty files:** `package.json`,
  `package-lock.json` (**both staged**), `TerminalPane.vue`, `.claude/`, `.procoder/`.

---

## Dependencies

- **10.2-1** — the adoption gate, ✅ passed (D200 as amended, and **D201**, which is the
  substitution observation this task proceeds on).
- ⚠ **The `chorus-memory` container has `RestartPolicy=no` and has been down unnoticed before
  (F122).** Any verification step touching the graph must check it is up and say so in its report.

---

## Step-by-step Work

1. **Re-confirm v3 is free** before writing it — parse `GRAPH_MIGRATIONS` *and* read
   `ChorusMigration` from the store. Both halves read 2 today; a second Chorus install may have
   moved one.
2. **Write the v3 entry** in `graphSchemaCore.ts` with the statements listed in the Implementation
   Spec, each carrying `IF NOT EXISTS`, and a comment recording that they were probed against
   5.26.29 with the probe's path.
3. **Update the two pinned tests** and add the v3 cases.
4. **Add the five Cypher constants** to `codeIndexCore.ts` and to `ALL_INDEX_STATEMENTS`.
5. **Re-run `_verify/10.2-2/probe-v3.sh`** against the final statement text — if the text changed at
   all, the earlier evidence does not cover it.
6. **Runtime gate:** ⚠ **launching the app is NOT enough — measured.** Graph migrations are
   user-initiated by design (D58): run *Project settings → Memory → Seed* (or
   `window.chorus.seedMemory('<projectId>')`), then confirm `ChorusSchema.version` moves 2 → 3 and a
   `ChorusMigration {version: 3}` row appears. ⚠ Do **not** "fix" a quiet boot by seeding at
   startup — D177 (F97) refused boot-time graph work deliberately.

---

## Test Expectations

New cases in `graphSchemaCore.test.ts`:

- v3 exists, is named `symbol-layer-identity`, and `LATEST_GRAPH_VERSION` is **3**
- a graph at v2 is offered **exactly** `[3]`; a graph at v1 is offered `[2, 3]`
- every v3 statement carries `IF NOT EXISTS` (already covered by the list-wide assertion — assert it
  again for v3 specifically, as v2 does)
- v3 keys `:Symbol` on `(s.workspaceInstanceId, s.symbolId)` and **contains no `fqn`**
- v3 introduces **no** `:Memory` / `SUPPORTED_BY` reference, and no `confidence` property
- ⚠ v3 does **not** mention `:Class` — the dormant constraint is neither revived nor dropped

New cases in `codeIndexCore.test.ts`:

- the five new constants are in `ALL_INDEX_STATEMENTS`, so the no-DELETE and verb sweeps cover them
- `LINK_CALLS` and `LINK_REFERENCES` **set `lastIndexedAt` on the relationship** — a `MERGE` that
  forgets the stamp produces an edge that can never be filtered out, so assert the `SET r.` shape
- `UPSERT_SYMBOLS` sets `missingSince = null`, mirroring `UPSERT_FILES`
- ⚠ **no constant compares an edge stamp to `Project.lastIndexedAt`** — pin D203's correction as a
  test, so the worktree-breaking form cannot come back in review

---

## Verification Commands

```bash
npm run typecheck                    # expect 0 errors
npx vitest run                       # expect 3305 + new, 0 failures
npx vitest run src/main/services/graphSchemaCore.test.ts
npx vitest run src/main/services/codeIndexCore.test.ts

# the statements, against a REAL image — never trust recall for Cypher syntax
bash _verify/10.2-2/probe-v3.sh
bash _verify/10.2-2/probe-v3b.sh

# the graph is up before believing anything that reads it (F122)
docker ps --filter name=chorus-memory --format '{{.Names}} {{.Status}}'
```

Runtime gate — ⚠ **after triggering a seed, not merely after launching the app** (D58; measured
2026-09-13, a bare launch leaves the graph at version 2):

```cypher
MATCH (s:ChorusSchema {id:'chorus'}) RETURN s.version          // expect 3
MATCH (m:ChorusMigration) RETURN m.version, m.name ORDER BY m.version
MATCH (s:Symbol) RETURN count(s)                                // expect 0 — nothing writes yet
```

---

## Acceptance Criteria

- [ ] `LATEST_GRAPH_VERSION` is **3**, derived rather than restated
- [ ] Every v3 statement carries `IF NOT EXISTS` and applies twice with zero failures against
      `neo4j:5-community` 5.26.29
- [ ] `symbol_identity` **bites**: a repeated `(wid, symbolId)` is refused; the same `symbolId` under
      a different workspace instance is accepted; three `MERGE`s produce one node
- [ ] `ALL_INDEX_STATEMENTS` contains the five new constants and the no-DELETE sweep passes
- [ ] `LINK_CALLS` / `LINK_REFERENCES` stamp `lastIndexedAt` on the relationship
- [ ] No constant or test compares an edge stamp to `Project.lastIndexedAt`
- [ ] Contract line count still **21**; runtime dependencies still **9**; `typescript` still a
      devDependency
- [ ] `MATCH (s:Symbol) RETURN count(s)` returns **0** after the runtime gate
- [ ] The pre-existing dirty files are untouched

---

## Review Checklist

1. Was v3 re-confirmed free from **both** the source array and the live store, or only one?
2. Was the probe re-run against the **final** statement text, or does the evidence predate an edit?
3. Does any new Cypher contain `DELETE`, `DETACH` or `REMOVE`? (D149(b))
4. Does any read shape filter on `Project.lastIndexedAt`? ⚠ That form is measured to drop a whole
   worktree's live edges — see D203's correction and `probe-v3b-output.txt`.
5. Are the two pinned assertions moved **deliberately**, with a comment saying why, rather than
   patched until green?
6. Does the migration comment state that `class_identity` remains dormant?
7. ⚠ Were any grep-based gates written so the prose documenting a rule matches the gate itself?
   Five such gates have landed across 10.1 and 10.2 (F120, F123) — strip comments or assert on
   structure.
