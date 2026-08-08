# Task 6-4 — Graph Schema, Provenance and the Validator (Stage 3)

**Phase:** 6 · **Task 4 of 5** · **Depends on:** **6-3 — hard, and 6-3 has NOT landed.**

**⚠ THE 2026-08-08 AMENDMENT IS FOLDED INTO THIS BODY.** CR-6.0 changed this task more than any other:
it **revised the identity model D94(a) had already corrected once**, answered two questions this
document was written to leave open, and split the validator into a half that ships and a half that
does not. The record is in § Amendment provenance at the bottom.

**⚠ EVERY POST-6-3 NUMBER BELOW IS A PREDICTION, NOT A MEASUREMENT.** `MIGRATIONS.length` **16**,
`sqliteTable(` **17**, `IpcChannel` **76** and the test floor all describe *what 6-3 is specified to
leave behind*. 6-3 has not run. **Re-measure every one of them at execution time**; this phase has
lost time three times to exactly this class of number.

## Source Of Truth

- [`Phase-6-Overview.md`](Phase-6-Overview.md) — the purity contract.
- [`../Phase-6-MemoryPlan.md`](../Phase-6-MemoryPlan.md) **§4 (where `Plan.md` §10 is wrong), §8
  (graph schema versioning), §9 (cores)**.
- [`../ImplementationSpecs/ImplementationSpec-6-4.md`](../ImplementationSpecs/ImplementationSpec-6-4.md)
  — **read §0 (the identity model) before anything else. No constraint may be written until it is
  settled.**
- [`../CouncilBriefs/CouncilBrief-6.0-MemorySchemaProvenance-Findings.md`](../CouncilBriefs/CouncilBrief-6.0-MemorySchemaProvenance-Findings.md)
  — run `41c80955`, closed as **D126**.
- Roadmap §6 **D55**, **D76**, **D94**, **D102**, **D126**, **D128(c)**, and **F49**.

## ⚠ The two open questions this document was written to defer are now ANSWERED

**Do not "check before starting" — the answers are here.**

**Q2 — advisory-and-measured, NOT app-mediated writes (D126).** The council approved the architecture
this task assumes, **on the condition that the measurement is consequential** — *"a bare count is
decorative."* They asked for numerator and denominator, ratio, trend, a new-unsourced-versus-backlog
split, a per-agent breakdown, an affected-node list and a repair action.

**⚠ AND D128(c) STATES THE HONEST LIMIT: PHASE 6 SHIPS THE MEASUREMENT AND NOT YET THE CONSEQUENCE.**
In scope here: **numerator and denominator** (*"43 of 512"* — D55), the ratio, and the **affected-node
list**. **Deferred as a unit (council items 7–9):** trend history, the new-versus-backlog split, the
per-agent breakdown, the repair workflow, and any context re-weighting or labelling. **⚠ DO NOT SHIP
A PARTIAL VERSION OF THE DEFERRED HALF** — the council's own ruling is that a measurement without
consequence is decoration, so a half-built trend is worse than none. **And no UI copy may imply the
repair workflow exists.**

**APOC — measured ABSENT, so drop it (6-1 D4 pass, item 1).** `SHOW PROCEDURES … STARTS WITH 'apoc'`
returned **0** on `neo4j:5-community`, which resolves to **Neo4j 5.26.29 Community**. **The seed, the
validator, every constraint and any cleanup must be plain Cypher**, and *"zero required APOC
procedures"* is an acceptance criterion, not an assumption. `Plan.md` §10's provision flow installs it
reflexively — **do not inherit that.** Requiring it would mean an extra `NEO4J_PLUGINS` variable and a
download at container start.

## ⚠ The identity model was revised AGAIN — and the seed's own constraints are wrong on both halves

**This is the single largest change to this task, and it blocks every constraint.**

D94(a) corrected `Plan.md`'s bare `File.path` uniqueness to `(repo, path)` because a bare path
**breaks on git worktrees — Chorus's own core feature.** CR-6.0 found that correction **still
insufficient**: *"a repository identity shared by multiple simultaneously represented worktrees,
combined with a worktree-relative path, can still collide."*

**The ruling:** identity is a **stable worktree-instance identifier plus a NORMALIZED
repository-relative path**, and **⚠ ABSOLUTE PATHS ARE DEMOTED TO FALLBACK METADATA AND MUST NEVER BE
KEY MATERIAL** — they are machine-specific and mutable.

**⚠ AND THE CONSEQUENCE NOBODY HAS WRITTEN DOWN YET: the seed list in the spec uses `f.repo`, which in
this codebase can only mean `worktrees.repo_root` (`src/main/db/schema.ts:124`) — an ABSOLUTE PATH.**
So `(f.repo, f.path)` is wrong on **both** halves: an absolute path on one, a worktree-ambiguous
relative path on the other. **The constraints cannot be copied forward.**

**Action item 1 is a prerequisite, not a step:** document the exact fields and normalization rules
**before writing a single constraint** (item 2 then verifies the constraints against that model). It
is **checkable against Phase 2's worktree tables rather than invented** — see spec §0, which grounds
it in `worktrees.id`, `worktrees.path`, `projects.root_path` and the nullable
`sessions.worktree_id`, and which **surfaces two holes the council could not see** (the project root
has no `worktrees` row, and `:Commit` has no stable repository identity in this schema at all).

## Goal

Give the graph a **versioned, idempotent schema** and make provenance **measurable** — because it
cannot be made mandatory. Agents write via MCP with a Cypher tool, so nothing stops one creating a
`:Memory` with no source and no session. **The answer is a number with its denominator, not a
promise.**

## ⚠ And the validator cannot defend itself (F49)

The MCP write tool takes **arbitrary Cypher**, so an agent — confused, prompt-injected, or merely
wrong — can bulk-modify, poison, relabel or `DETACH DELETE` memories **and the provenance
relationships the validator counts**. *"43 of 512"* is computed **from data the same tool can
rewrite**, so **a corrupted graph can report itself healthy.**

**This is mitigated by nothing decided so far.** Per-container isolation bounds the blast radius to
one project's graph and does nothing inside it. Backup/export/restore is **Stage 5**, and **F49 gates
it**: no project graph may be presented as durable memory until export and restore exist and have been
exercised. **State this limit in this task's own output** rather than letting the number imply an
integrity guarantee it does not have.

## Exact Scope

**Create:**
- `src/main/services/graphSchemaCore.ts` + `.test.ts` — **pure.**
- `src/main/services/provenanceCore.ts` + `.test.ts` — **pure.**
- **The identity-model document** (spec §0) — prose, in this repo, before any constraint.

**Edit:**
- `src/shared/ipc.ts` + `.test.ts` — `memory:seed`, `memory:validate` (**76 → 78**).
- `src/main/ipc.ts` — their two handlers.
- `src/preload/index.ts` — two forwarders.
- `src/main/services/memoryService.ts` — apply-migrations and run-validator.
- `src/renderer/src/stores/memory.ts` + `.test.ts`
- `src/renderer/src/views/ProjectSettingsView.vue` — the seed control and the completeness report,
  beside 6-3's config section. **⚠ NOT `SettingsMemory.vue`** — that file does not exist and is not
  planned; see Task 6-3's ruling on why the surface is per-project.

## Non-Goals

- **⚠ NO SQLITE MIGRATION.** `MIGRATIONS.length` stays at whatever 6-3 left (**specified: 16**),
  `sqliteTable(` stays **17**. The graph has its own ledger; **`project_memory.schema_version` is a
  CACHE, not the authority.**
- **⚠ DO NOT MAKE `schema_version` THE AUTHORITY.** The same graph can be restored from a dump or
  reached by a second Chorus install, so **the seeder always re-reads the graph first** and writes the
  cache **only after success** (plan §8).
- **⚠ DO NOT SHIP A NON-IDEMPOTENT STATEMENT.** Every statement is `IF NOT EXISTS`, asserted by a
  pure test over the list — **not by having run it once.**
- **⚠ DO NOT RENDER A COMPLETENESS FIGURE WITHOUT ITS DENOMINATOR** (D55). *"43 of 512"*, never
  *"43"*, and never a percentage alone.
- **⚠ DO NOT IMPLY PROVENANCE IS ENFORCED.** It is not, and saying so plainly is the deliverable.
- **⚠ NO APOC.** Measured absent; zero required APOC procedures.
- **⚠ NO `confidence` PROPERTY, IN ANY FORM** (D94.3, ratified by CR-6.0 Q1) — uncalibrated
  self-report that *"will be read as rigor"*.
- **⚠ NO ABSOLUTE PATH AS KEY MATERIAL** (D126). Fallback metadata only.
- **⚠ NO DEFERRED-HALF PARTIALS** — no trend, no per-agent breakdown, no new-vs-backlog split, no
  repair workflow, not even a disabled control hinting at one.
- **Do not write any CLI config file.** That is Task 6-5.
- **Do not revert or commit unrelated changes.**

## Dependencies

**6-3, hard, and it has not landed.** Plan §8's whole argument is that the seeder must be provable
**against a real graph**, which 6-3 is what opens. **An execution prompt for this task cannot be
grounded until 6-3 lands** — every count above would be fiction.

## Step-by-step Work

1. **Settle the identity model and write it down (spec §0). No constraint before this.** Resolve the
   two open holes it names, or record them as decisions with a ruling.
2. `graphSchemaCore.ts` — the ordered list, `pendingMigrations(current)`, the version-node Cypher, and
   the all-`IF NOT EXISTS` assertion (spec §1). **⚠ Verify Neo4j 5 composite-constraint syntax against
   the actual image (5.26.29) before hardcoding it.**
3. `provenanceCore.ts` — `MemoryRecord` → Cypher parameters, the validator queries, the ratio **with
   its denominator**, and the **affected-node list** (spec §2).
4. `memory:seed` and `memory:validate` (spec §3).
5. The UI: a seed control and the completeness report, **with the honest sentence** (spec §4).
6. **G2 against the real graph, twice — seed, then seed again** (spec §5).

## Test Expectations

- **Every statement in the seed list is `IF NOT EXISTS`** — asserted over the list, so a later
  addition that forgets it fails in CI rather than on a half-migrated graph.
- `pendingMigrations(current)` for every boundary: `0`, mid-list, the last version, and **a version
  HIGHER than the code knows** — that last one is a graph written by a newer Chorus, and the honest
  answer is a refusal, not an empty list.
- **The identity model's normalization rules, tested as a pure function** — separator normalization,
  leading `./`, `..` escape refusal, the project-root case, and the documented Windows case-folding
  limit.
- **The completeness ratio carries its denominator, and 0-of-0 does not divide by zero** — an empty
  graph is *"0 of 0"*, not `NaN` and not 100%.
- The provenance queries are asserted **as strings** against their expected Cypher, since a pure core
  cannot execute them.
- **Never fewer than 6-3's measured figure** (≥ **1476 / 41 files** as the absolute floor from
  `842a7cc`). ⚠ **F50: the baseline flickers** — re-run before diagnosing a regression.

## Verification Commands

```bash
npm run typecheck && npx vitest run && npm run grep:secrets
```

```bash
grep -c "sqliteTable(" src/main/db/schema.ts                            # 17 — UNCHANGED
grep -n "// v16" src/main/services/storage.ts                           # present, and NO v17
grep -rn "IF NOT EXISTS" src/main/services/graphSchemaCore.ts | wc -l   # == the statement count
grep -rn "confidence" src/main/services/provenanceCore.ts               # NOTHING
grep -rn "apoc" src/main/services/ -i                                   # NOTHING
grep -rn "repo_root\|repoRoot" src/main/services/provenanceCore.ts      # NOTHING as key material
```

## Acceptance Criteria

- [ ] Gates green; vitest **≥ 6-3's figure**; **`sqliteTable(` 17 and `MIGRATIONS.length` 16, both
      unchanged.**
- [ ] **The identity model is WRITTEN DOWN before any constraint exists**, names its exact fields and
      normalization rules, and **resolves or records the two holes in spec §0.**
- [ ] **No absolute path is key material anywhere** — `grep` for it.
- [ ] **Zero required APOC procedures**, stated explicitly.
- [ ] **The graph is the authority on its own version** — the seeder re-reads it before acting, and
      the report says what happens when the cache and the graph disagree.
- [ ] **Seeding twice is a no-op the second time**, demonstrated on the real graph, not argued.
- [ ] `memory:validate` returns **`{withSource, total, affected[]}`** and the UI renders *"N of M"*.
- [ ] **The D94 corrections that survive D126 are present**: no `confidence` · `SUPERSEDES` /
      `SUPPORTED_BY` / `PRODUCED` as **edges** · `validTo` indexed so *"current facts"* is
      `WHERE m.validTo IS NULL`. ⚠ **The `(repo, path)` / `(repo, fqn)` composite is SUPERSEDED by
      D126 — do not tick it as written.**
- [ ] **Every node carries `chorusProjectId` and `writtenVia: 'mcp'|'app'|'skill'`** — *"which path
      wrote this"* is the first question a provenance audit asks and it cannot be reconstructed later.
- [ ] **A Chorus-written session node is NOT counted as provenance** unless an agent established a
      meaningful source edge to it — counting it otherwise manufactures a false denominator (D126).
- [ ] **The report states plainly that provenance is advisory and measured, not enforced**, quotes
      D126's ruling, **and states F49's limit: the validator cannot defend itself.**

## Review Checklist

1. **The identity model exists as prose and predates the constraints.** Check the commit order.
2. **No absolute path in any key.** `grep` for `repo_root`, `repoRoot`, drive letters.
3. **Every seed statement is `IF NOT EXISTS`.** Count them against the assertion.
4. **`schema_version` is written only after a successful apply**, and read from the graph first.
5. **No `confidence` anywhere.** **No `apoc` anywhere.**
6. **`sqliteTable(` and `MIGRATIONS.length` did not move.**
7. **The completeness figure never appears without its denominator** — check the Vue template, not
   only the core.
8. **A version from the future is refused, not ignored.** This is the case a reviewer will skip and it
   is the one that corrupts a graph.
9. **Nothing in the UI hints at the deferred half.**

---

## Amendment provenance

| When | What changed | Why it matters |
|---|---|---|
| **2026-07-28** (`3fa295d`) | Authored, with Q2 (advisory vs app-mediated) and the APOC question deliberately left open for the CR gate. | The gate had not fired; leaving them open was correct. |
| **2026-08-08** (6-1 D4 pass) | **APOC measured absent** on `neo4j:5-community` → 5.26.29 Community. **Drop it.** | An assumption became a measurement, and it went the way that removes work. |
| **2026-08-08** (CR-6.0 → **D126**) | **Q2 answered: advisory-and-measured, on condition the measurement is CONSEQUENTIAL.** **The identity model revised a second time** — worktree-instance id + normalized relative path; absolute paths demoted. **A Chorus-written session node is not provenance.** **No agent-authored `confidence`.** | **D94(a) had already corrected this once and was still wrong.** The council found it; nothing in the repo would have. |
| **2026-08-08** (**D128(c)**) | The 26 action items **triaged, not absorbed** — roughly triple the phase's scope. Items 7–9 deferred **as a unit**. | *"Phase 6 ships the measurement and NOT yet the consequence, and the roadmap says so rather than letting `memory:validate` imply otherwise."* |
| **2026-08-08** (**F49**) | **Raised by the council, asked by no question, and the strongest output of the run.** Arbitrary Cypher is a graph-integrity risk; a corrupted graph can report itself healthy. **Gates Stage 5.** | The validator's number is computed from data the write tool can rewrite. |
| **2026-08-08** (at `842a7cc`) | **Amendment folded into the body.** Stale facts corrected: `MIGRATIONS.length` **13 → 16**, `IpcChannel` **→ 76 → 78**, `SettingsMemory.vue` → **`ProjectSettingsView.vue`**, and the *"check the CR before starting"* instructions replaced with the answers. **Added: the seed's `f.repo` is `worktrees.repo_root`, an absolute path — so the constraints are wrong on BOTH halves.** | The document told its reader to go and check things that had already been decided eight days earlier. |
