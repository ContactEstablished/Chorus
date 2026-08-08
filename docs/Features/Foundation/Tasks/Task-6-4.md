# Task 6-4 — Graph Schema, Provenance and the Validator (Stage 3)

**Phase:** 6 · **Task 4 of 5** · **Depends on:** **6-3 — hard.**

> ## ⚠ AMENDED 2026-08-08 BY TASK 6-1 — READ THIS BEFORE THE BODY
>
> **CR-6.0 changed this task more than any other** (D126 / D128). **Where this block and the body disagree, this block wins.**
>
> **1. ⚠ `(repo, path)` IS NOT SUFFICIENT — D94(a) IS ITSELF REVISED.** The council's sharpest schema finding: *"A repository identity shared by multiple simultaneously represented worktrees, combined with a worktree-relative path, can still collide."* Identity must be a **stable worktree-instance identifier plus a NORMALIZED repository-relative path**. **⚠ ABSOLUTE PATHS ARE DEMOTED TO FALLBACK METADATA AND MUST NOT BE PRIMARY KEY MATERIAL** — they are machine-specific and mutable. **Document the exact fields and the normalization rules before writing a single constraint** (action item 1), then verify the constraints against that model (item 2). This is checkable against Phase 2's worktree tables rather than invented.
>
> **2. ⚠ APOC IS ABSENT AND MUST NOT BE A DEPENDENCY — MEASURED, NOT ASSUMED.** `SHOW PROCEDURES … STARTS WITH 'apoc'` returned **0** on `neo4j:5-community`. **The seed, the validator, every constraint and any cleanup must be plain Cypher.** Acceptance criterion: **zero required APOC procedures**, stated explicitly.
>
> **3. NO AGENT-AUTHORED `confidence` FIELD, ANYWHERE.** Ratified by CR-6.0 Q1: uncalibrated self-report must not be represented — or rendered — as evidence.
>
> **4. PROVENANCE IS RELATIONSHIPS, AND "SOURCED" NEEDS A WRITTEN DEFINITION.** Document the source, authoring agent, session, timestamp and evidence model, **and state exactly which fields are required for a memory to COUNT as sourced** — the validator's denominator is meaningless otherwise. **⚠ A CHORUS-WRITTEN SESSION NODE IS NOT PROVENANCE:** if an agent can ignore, relabel or delete it, counting it as a source manufactures a false denominator. It counts only when an agent establishes a **meaningful source edge** to it.
>
> **5. `memory:validate` SHIPS THE MEASUREMENT; THE CONSEQUENCE IS DEFERRED, AND THE PHASE SAYS SO (D128(c)).** In scope: **numerator and denominator** (*"43 of 512"*, never a bare count — D55), the ratio, and the **affected-node list**. **Deferred as a unit (items 7–9):** trend history, the new-unsourced-vs-backlog split, per-agent breakdown, the repair workflow, and any context re-weighting or labelling. **⚠ DO NOT SHIP A PARTIAL VERSION OF THE DEFERRED HALF** — the council's own ruling is that a measurement without consequence is decoration, so a half-built trend is worse than none. **And do not let any UI imply the repair workflow exists.**
>
> **6. ⚠ THE VALIDATOR CANNOT DEFEND ITSELF — SEE F49.** The write tool takes arbitrary Cypher, so the same tool can rewrite the provenance the validator counts, and **a corrupted graph can report itself healthy**. Backup/restore is **Stage 5** and **F49 gates it**. State this limit in the task's own output rather than letting the number imply an integrity guarantee it does not have.

## Source Of Truth

- [`Phase-6-Overview.md`](Phase-6-Overview.md) — the purity contract.
- [`../Phase-6-MemoryPlan.md`](../Phase-6-MemoryPlan.md) **§4 (where `Plan.md` §10 is wrong), §8
  (graph schema versioning), §9 (cores)** — this task's specification.
- `../ImplementationSpecs/ImplementationSpec-6-4.md`.
- **The CR decision recorded by Task 6-1.** ⚠ **Question 2 — advisory-and-measured vs enforced
  app-side — is THIS TASK'S central design input. If the council ruled for app-mediated writes, the
  scope below changes and 6-1 should already have amended it. Check before starting.**
- Roadmap §6 **D55**, **D76**, **D94**, **D102**.

## Initial Starting Point

**Verified at `3fa295d`; re-verify the 6-3 half at execution time.**

- Task 6-3 has landed: `project_memory` exists with `schema_version` **0**, `neo4jClient.ts` can
  reach a real Neo4j, and `memory:test` proves it on one user-initiated click.
- **`Plan.md` §10's schema is superseded on six points (D94 + D102)** and the corrections are the
  design here, not a variation on it.
- No graph constraints, no indexes, no `:ChorusSchema` node exist anywhere.
- `MIGRATIONS.length` **13** after 6-3 — **and it does not move in this task.**

## Goal

Give the graph a **versioned, idempotent schema** and make provenance **measurable** — because it
cannot be made mandatory. Agents write via MCP with a Cypher tool, so nothing stops one creating a
`:Memory` with no source and no session. **The answer is a number with its denominator, not a
promise.**

## Exact Scope

**Create:**
- `src/main/services/graphSchemaCore.ts` + `.test.ts` — **pure.**
- `src/main/services/provenanceCore.ts` + `.test.ts` — **pure.**

**Edit:**
- `src/shared/ipc.ts` + `.test.ts` — `memory:seed`, `memory:validate`.
- `src/main/ipc.ts` — their two handlers.
- `src/preload/index.ts` — two forwarders.
- `src/main/services/memoryService.ts` — apply-migrations and run-validator.
- `src/renderer/src/stores/memory.ts` + `.test.ts`
- `src/renderer/src/views/SettingsMemory.vue` — the seed control and the completeness report.

## Non-Goals

- **⚠ NO SQLITE MIGRATION.** `MIGRATIONS.length` stays **13**, `sqliteTable(` stays **17**. The graph
  has its own ledger; **`project_memory.schema_version` is a CACHE, not the authority.**
- **⚠ DO NOT MAKE `schema_version` THE AUTHORITY.** The same graph can be restored from a dump or
  reached by a second Chorus install, so **the seeder always re-reads the graph first** and writes the
  cache **only after success** (plan §8).
- **⚠ DO NOT SHIP A NON-IDEMPOTENT STATEMENT.** Every statement is `IF NOT EXISTS`, asserted by a
  pure test over the list — **not by having run it once.**
- **⚠ DO NOT RENDER A COMPLETENESS FIGURE WITHOUT ITS DENOMINATOR** (D55). *"43 of 512"*, never
  *"43"*, and never a percentage alone.
- **⚠ DO NOT IMPLY PROVENANCE IS ENFORCED.** It is not, and saying so plainly is the deliverable. The
  UI copy must not read as a guarantee.
- **Do not add APOC** unless a seed statement genuinely requires it — plan §10 item 1 asks the
  question and 6-1 answers it. **Drop it otherwise.**
- **Do not write any CLI config file.** That is Task 6-5.
- **Do not add a `confidence` property in any form** (D94.3 — uncalibrated self-report that *"will be
  read as rigor"*).
- **Do not revert or commit unrelated changes.**

## Dependencies

**6-3, hard.** Plan §8's whole argument is that the seeder must be provable **against a real graph**,
which 6-3 is what opens.

## Step-by-step Work

1. **Re-read 6-1's CR decision on question 2** and quote its ruling in the report.
2. `graphSchemaCore.ts` — the ordered list, `pendingMigrations(current)`, the version-node Cypher, and
   the all-`IF NOT EXISTS` assertion (spec §1).
3. `provenanceCore.ts` — `MemoryRecord` → Cypher parameters, the validator queries, and the ratio
   **with its denominator** (spec §2).
4. `memory:seed` and `memory:validate` (spec §3).
5. The UI: a seed control and the completeness report (spec §4).
6. **G2 against the real graph, twice — seed, then seed again** (spec §5).

## Test Expectations

- **Every statement in the seed list is `IF NOT EXISTS`** — asserted over the list, so a later
  addition that forgets it fails in CI rather than on a half-migrated graph.
- `pendingMigrations(current)` for every boundary: `0`, mid-list, the last version, and **a version
  HIGHER than the code knows** — that last one is a graph written by a newer Chorus, and the honest
  answer is a refusal, not an empty list.
- **The completeness ratio carries its denominator, and 0-of-0 does not divide by zero** — an empty
  graph is *"0 of 0"*, not `NaN` and not 100%.
- The provenance queries are asserted **as strings** against their expected Cypher, since a pure core
  cannot execute them.
- **Never fewer than the 6-3 figure.**

## Verification Commands

```bash
npm run typecheck && npx vitest run && npm run grep:secrets
```

```bash
grep -c "sqliteTable(" src/main/db/schema.ts     # 17 — UNCHANGED
grep -n "MIGRATIONS" src/main/services/storage.ts | head -2   # still 13 entries
grep -rn "IF NOT EXISTS" src/main/services/graphSchemaCore.ts | wc -l   # == the statement count
grep -rn "confidence" src/main/services/provenanceCore.ts     # NOTHING
```

## Acceptance Criteria

- [ ] Gates green; vitest **≥ 6-3's figure**; **`sqliteTable(` 17 and `MIGRATIONS.length` 13, both
      unchanged.**
- [ ] **The graph is the authority on its own version** — the seeder re-reads it before acting, and
      the report says what happens when the cache and the graph disagree.
- [ ] **Seeding twice is a no-op the second time**, demonstrated on the real graph, not argued.
- [ ] `memory:validate` returns **`{withSource, total}`** and the UI renders *"N of M"*.
- [ ] **The four D94 corrections are all present**: composite `(repo, path)` / `(repo, fqn)`
      uniqueness · no `confidence` · `SUPERSEDES` / `SUPPORTED_BY` / `PRODUCED` as **edges** ·
      `validTo` indexed so *"current facts"* is `WHERE m.validTo IS NULL`.
- [ ] **Every node carries `chorusProjectId` and `writtenVia: 'mcp'|'app'|'skill'`** — *"which path
      wrote this"* is the first question a provenance audit asks and it cannot be reconstructed later.
- [ ] **The report states plainly that provenance is advisory and measured, not enforced**, and quotes
      the CR's ruling.

## Review Checklist

1. **Every seed statement is `IF NOT EXISTS`.** Count them against the assertion.
2. **`schema_version` is written only after a successful apply**, and read from the graph first.
3. **No `confidence` anywhere.** `grep` for it.
4. **`sqliteTable(` and `MIGRATIONS.length` did not move.**
5. **The completeness figure never appears without its denominator** — check the Vue template, not
   only the core.
6. **A version from the future is refused, not ignored.** This is the case a reviewer will skip and it
   is the one that corrupts a graph.
