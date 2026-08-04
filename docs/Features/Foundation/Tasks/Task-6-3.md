# Task 6-3 — Connect to an Existing Neo4j (Stage 2)

**Phase:** 6 · **Task 3 of 5** · **Depends on:** **6-2 — hard.**

## Source Of Truth

- [`Phase-6-Overview.md`](Phase-6-Overview.md) — the purity contract; **D100** approves
  `neo4j-driver` **here and only here**.
- [`../Phase-6-MemoryPlan.md`](../Phase-6-MemoryPlan.md) **§6 (schema), §7 (IPC), §9 (cores vs
  shells)** — this task's specification.
- `../ImplementationSpecs/ImplementationSpec-6-3.md`.
- **`Investigations/6-1-D4-Pass.md`** — **if its item-2 finding says the MCP server refuses an
  auth-disabled Neo4j, `auth_mode` handling changes and this doc should already have been amended by
  6-1. Check.**
- Roadmap §6 **D33** (vault clauses), **D53**, **D58** (the one-live-call terms), **D55**, **D62**
  (FK rulings), **D76** (omit rather than stub), **D85** (the split-table precedent), **D92**.

## Initial Starting Point (verified 2026-07-28 at `3fa295d`)

- `storage.ts:75` — `const MIGRATIONS: string[]`, **length 12**, last entry `model_shortlist`.
- `src/main/db/schema.ts` — **`sqliteTable(` × 16.**
- `src/main/ipc.ts:1515–1516` — `credential:delete` counts **exactly two** dependents:
  `countLaunchProfilesForCredential` (`storage.ts:1655`) and `countCouncilMembersForCredential`
  (`storage.ts:1750`). **The refusal names them distinctly**, because *"used by 2 things"* does not
  tell a user what to delete.
- `IpcChannel` **58** · `ipcMain.handle(` **53 / 0**.
- `src/renderer/src/stores/` — `council · layout · project · session · settings · view`. **No
  `memory.ts`.**
- `src/renderer/src/views/` — `SettingsView.vue · SettingsCredentials.vue · SettingsProviders.vue ·
  CouncilView.vue`.
- Runtime deps: **8**. No `neo4j-driver`.
- Baseline: typecheck **0** · vitest **1055 / 1055 across 30 files**.

## Goal

A project can be pointed at **an existing Neo4j**, Chorus can prove it reaches it on one
user-initiated click, and the status chip D76 deliberately omitted from Phase 3c comes back **because
it finally has a data source.** No container, no provisioner, no graph schema yet — **Stage 2 exists
so Stage 3's schema work can be proven against a real graph without simultaneously debugging
container lifecycle** (D91's load-bearing ordering choice).

## Exact Scope

**Create:**
- `src/main/services/memoryConfigCore.ts` + `.test.ts` — **pure.**
- `src/main/services/neo4jClient.ts` — the driver shell.
- `src/main/services/memoryService.ts` — **the only module that decrypts.**
- `src/renderer/src/stores/memory.ts` + `.test.ts`
- `src/renderer/src/views/SettingsMemory.vue`

**Edit:**
- `src/main/db/schema.ts` — `project_memory` (**16 → 17**).
- `src/main/services/storage.ts` — migration **v14** (**13 → 14**, ⚠ **corrected from v13 on
  2026-08-01 — see Step 1**), the accessors, and **`countProjectMemoryForCredential`**.
- `src/shared/ipc.ts` + `.test.ts` — the `memory:*` channels and their Zod pairs.
- `src/main/ipc.ts` — the handlers, **and the third count in `credential:delete`**.
- `src/preload/index.ts` — the forwarders (**no Zod — CSP**).
- `src/renderer/src/views/SettingsView.vue` — the nav entry.
- The status chip's host component (**read the 3c code before choosing it**).
- `package.json` — `neo4j-driver`, **the only dependency this phase adds.**

## Non-Goals

- **⚠ NO PASSWORD COLUMN ON `project_memory`, IN ANY FORM, EVER.** A credentialed mode **names** a
  `credential_profiles` row; the secret stays in the DPAPI envelope. **A `password`, `secret`,
  `token` or `auth_value` column is an instant stop-and-report.**
- **⚠ NO CONTAINER WORK.** No `dockerode`, no `docker` CLI call, no provisioning, no ports allocated.
  `container_id`/`container_name`/`volume_name`/`bolt_port`/`http_port` columns exist and stay
  **NULL** — they are Stage 5's, and the column is here only because `MIGRATIONS.length` moves once.
- **⚠ NO GRAPH SCHEMA.** No constraints, no indexes, no `:ChorusSchema` node. `memory:seed` and
  `memory:validate` are **Task 6-4**. `schema_version` stays **0**.
- **⚠ `memory:status` MUST NOT DECRYPT AND MUST NOT OPEN A BOLT SESSION.** It is pollable by a chip.
  Getting this wrong turns the chip into a **15-second unattended-decrypt loop**, which D33/D53/D58
  forbid outright. **This is the single most dangerous line in the task.**
- **`memory:test` is ONE live connect, user-initiated only** — no boot hook, no timer, no restore
  path, no retry (D58's terms verbatim).
- **Do not render a number without its denominator** (D55), and **do not stub the chip** for a
  project with no memory — render **nothing at all** (D76).
- **Do not touch `env.ts` speculatively.** H3 is real; add to `BASELINE_ENV_VARS` **only** if a
  measured failure demands it, and then record what broke without it (D88's three-lists trap).
- **Do not add a second read path** over anything `storage.ts` already reads.
- **Do not revert or commit unrelated changes.**

## Dependencies

**6-2, hard.** `assertNoSecretInRendered` must exist before anything can be written, and this task
introduces the first real secret into the MCP story.

## Step-by-step Work

1. **Assert `MIGRATIONS.length + 1 === 14` before appending. STOP on divergence** — do not renumber
   (spec §1). **⚠ THIS NUMBER WAS `13` UNTIL 2026-08-01 AND WAS CORRECTED BEFORE EXECUTION, NOT
   DURING IT.** `v13` was spent while this phase waited — `projects.color` + `projects.description`,
   named as such at `schema.ts:20` — so `MIGRATIONS.length` is now **13** and the next free version
   is **14**. **⚠ THAT v13 IS UNCOMMITTED AS OF THE CORRECTION, WHICH IS WHY THE ASSERTION, NOT THIS
   SENTENCE, IS THE AUTHORITY:** if that work is reverted before this task runs, the assertion fails
   at 12 and you **stop and report** exactly as you would for any other divergence. The rule outranks
   the recorded number in both directions.
2. `project_memory`, with the FK rulings spelled out (spec §1).
3. **`countProjectMemoryForCredential`, and the third count in `credential:delete`** (spec §2).
   **⚠ Prove it on a route where no pre-existing guard can mask it.**
4. `memoryConfigCore.ts` — pure (spec §3).
5. `neo4jClient.ts` and `memoryService.ts` (spec §4).
6. The six channels (spec §5).
7. The store, the Settings surface, the chip (spec §6).
8. **G2 against a real Neo4j** (spec §7).

## Test Expectations

- **`memoryConfigCore` exhaustively** — it is pure, so it is cheap: mode vocabulary, bolt-URI
  validation and normalisation, port ranges, **Docker-legal container/volume naming from a project
  slug** (`[a-zA-Z0-9][a-zA-Z0-9_.-]*`), and the launchability predicate with its authored
  `disabledReason` (the `resolveLaunchProfile` precedent).
- **`ipc.test.ts`'s key-set assertion extended for `memory:get`.** ⚠ **That assertion is the
  discipline that catches a password field being added later** — it is why D85's headcount test was
  *updated* rather than relaxed.
- A store case: a superseded load does not overwrite a newer one (the `loadSeq` idiom).
- **A test that `memory:status`'s handler calls neither the vault nor the driver.** Assert the
  absence structurally — an injected dep that must not be touched.
- **Never fewer than 1055 across 30 files.**

## Verification Commands

```bash
npm run typecheck && npx vitest run && npm run grep:secrets
```

```bash
grep -c "sqliteTable(" src/main/db/schema.ts                          # 17
grep -oE "^\s+[A-Za-z]+: '[a-z0-9:-]+'" src/shared/ipc.ts | wc -l    # 58 + the memory channels
grep -c "ipcMain.handle(" src/main/index.ts                           # 0
grep -riE "password|secret|token" src/main/db/schema.ts               # NOTHING in project_memory
grep -n "countProjectMemoryForCredential" src/main/ipc.ts             # present in credential:delete
git diff -- package.json                                              # neo4j-driver ONLY
```

## Acceptance Criteria

- [ ] Gates green; vitest **≥ 1055**; `sqliteTable(` **17**; `MIGRATIONS.length` **14**;
      `ipcMain.handle(` in `index.ts` still **0**.
- [ ] **`project_memory` has no password-shaped column**, and the migration SQL carries the comment
      saying why.
- [ ] **`credential:delete` counts THREE dependents and names all three distinctly in the refusal.**
- [ ] **The third guard is proven on a route where the other two cannot fire first.** ⚠ An earlier
      3a-5 run proved nothing because the 3-2 guard fired first; do not repeat it.
- [ ] `memory:status` **provably** decrypts nothing and opens no session.
- [ ] **G2: `memory:test` reaches a REAL Neo4j and returns `RETURN 1`.** *"A memory chip that renders
      is not a memory graph that answers."*
- [ ] The chip renders **nothing** for an unconfigured project, and its reason strings use the
      `vaultCore.failureMessage` vocabulary — **never a URI, never a driver stack trace.**
- [ ] `neo4j-driver` is the **only** dependency added, with its resolved version in the commit.
- [ ] **Restore parity CHECKED, not assumed:** a session credentialed *only* by way of memory is a
      case `launchProfiles.sessionIsCredentialed` has never seen. Verify it classifies (the F26 shape).

## Review Checklist

1. **`grep` the schema for password-shaped columns.** First thing, every time.
2. **Three counts in `credential:delete`, three distinct names in the refusal.**
3. **`memory:status` touches neither vault nor driver** — read the handler and the test.
4. **`MIGRATIONS.length` is 14 and nothing was renumbered.** Diff the existing 13 entries: byte-identical.
5. **No URI in any log line or reason string.** `neo4jClient.ts` never logs one — plan §9 says so and
   a bolt URI can carry credentials inline.
6. **The chip is absent, not empty, when there is no config** (D76).
7. **`package.json` gained exactly one runtime dep.**
