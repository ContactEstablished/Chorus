# ImplementationSpec 6-3 — Connect to an Existing Neo4j

**Normative for:** [`../Tasks/Task-6-3.md`](../Tasks/Task-6-3.md). **Design input:
[`../Phase-6-MemoryPlan.md`](../Phase-6-MemoryPlan.md) §6, §7, §9.** The plan's DDL is reproduced
there in full and is **normative on its CONTENT** — this spec adds the ordering, the guard and the
verification the plan left to a kickoff.

**⚠ THE PLAN CALLS THAT DDL "v13" THROUGHOUT AND IS SUPERSEDED ON THE NUMBER ONLY (see §1); it is
annotated rather than rewritten, the D42/D94/D102 precedent — the roadmap wins on current status, the
plan stands on design.**

**⚠ THIS SPEC HAS BEEN AMENDED THREE TIMES AND THE AMENDMENTS ARE FOLDED INTO THE BODY.** Current as
of **2026-08-08 at `842a7cc`**; the record is in
[`../Tasks/Task-6-3.md`](../Tasks/Task-6-3.md) § Amendment provenance.

---

## 1. Migration v16 and `project_memory`

**⚠ FIRST, BEFORE WRITING ANYTHING: assert `MIGRATIONS.length + 1 === 16` in the code path itself.**
`src/main/services/storage.ts:171` (array closes at `:690`), verified **15** on 2026-08-08 at
`842a7cc`; the last entry is `// v15 (Phase 3h / D120)` at `:640`. **If it is not 15, STOP AND
REPORT** — another phase appended and every number in this phase is wrong. **Do not renumber to make
it fit**; that is the standing rule and it exists because a renumbered migration silently re-runs
against an already-migrated database.

**⚠ THIS NUMBER HAS DECAYED TWICE — 12→13 (2026-08-01) and 13→15 (2026-08-08) — AND BOTH TIMES THE
ASSERTION IS WHAT CAUGHT IT.** `v13` was spent by `projects.color` + `projects.description`; `v15` by
Phase 3h. **The rule outranks the number in both directions**, including the 15 written above. Full
history in the task doc's provenance table.

**Take the plan §6 DDL verbatim, including its comment.** The comment is not decoration:

```sql
-- ⚠ THERE IS NO PASSWORD COLUMN HERE, IN ANY FORM, AND THERE MUST NEVER BE ONE.
--   A credentialed mode NAMES a credential_profiles row; the secret stays in the
--   DPAPI envelope and is resolved per launch by vault.decryptForLaunch (D93).
```

**Three additions to the DDL's comments, all required:**

1. The `-- v16 (Phase 6 / Task 6-3)` header.
2. **The credentialed-mode debt note** (§2) on `credential_profile_id`.
3. A line recording that `container_id` / `container_name` / `volume_name` / `bolt_port` /
   `http_port` are **Stage 5's and stay NULL**, present now only because `MIGRATIONS.length` moves
   exactly once in this phase — a second migration to add five columns would be churn for nothing.
   `schema_version` stays **0**; Task 6-4 owns it.

**Why a separate table rather than four columns on `projects` (which `Plan.md` §13 prescribes):** the
**D85 precedent** — `model_shortlist` was split off `model_catalog` because *"a `favourite` column on
a cache row would make one table mean two things."* Here the argument is stronger: **`mode` is durable
user intent; `container_id` and the ports are OBSERVED runtime facts about a resource that vanishes
behind the app's back** — and D92 makes that the **expected** case, not an error. Different writers,
different lifetimes. `projects` is also the app's hottest table, and *"turn memory off"* should be a
`DELETE` rather than four coordinated `NULL`s.

**FK rulings, in the D62 idiom — these rows are LIVE INSTRUCTIONS, not history, so they carry real
`REFERENCES`, the inverse of `dispatches` / `model_catalog` / `model_shortlist`:**

| Column | Ruling |
|---|---|
| `project_id` → `projects(id)` | **Enforced.** A memory config naming a deleted project is a lie, not a historical fact. |
| `credential_profile_id` → `credential_profiles(id)` | **Enforced, RESTRICT** — ⚠ **and in this phase it is a LOADED, UNGUARDED trap. See §2.** |
| `container_id` | **No constraint.** Reconcilable, like `worktrees`. |

Follow `credentialProfiles` (`src/main/db/schema.ts:171`) for the Drizzle table style; column names
and types must match the DDL exactly.

## 2. ⚠ The third dependent count is CUT — and the debt has a home

**This section previously required `countProjectMemoryForCredential` and a third count in
`credential:delete`. D128(a) removed its subject.** With credentialed mode out of Phase 6,
`project_memory.credential_profile_id` is **always NULL**: the FK cannot be violated, the guard cannot
be reached, and the function would have **no caller**. **Do not write it.**

**⚠ THE COUNTER-PRECEDENT IS ANSWERED, NOT IGNORED.** `storage.ts:2378–2384` records the
`attention_spans` precedent — a table and its accessors deliberately shipped **one task before** their
only writer, so a phase's schema churn stays in one migration. **It does not reach this case:** there
the writer was one task away *inside the same phase*; here it left the phase entirely with eight
preconditions attached. Shipping the guard now means shipping a refusal message nobody can read, in a
phase that cannot test it.

**⚠ AND HERE IS WHAT THE CUT LEAVES BEHIND.** `src/main/ipc.ts:1760–1797` counts **two** dependents
(`:1779–1780`), and its comment already records the shape: *"Task 3b-2 adds ONE COUNT to this guard;
it does NOT add a second guard."* That instruction is now **deferred, not discharged**. The migration
SQL must say so, in these terms:

> Whoever ships credentialed memory **MUST** add `countProjectMemoryForCredential` to
> `credential:delete`'s existing guard at `ipc.ts:1779` — **beside** its two siblings, not as a second
> guard — and extend the refusal's `parts[]` so it reads *"used by 1 launch profile and 2 memory
> configurations"*, **BEFORE** the first credentialed row can be written.

**⚠ WITHOUT IT, THE FIRST DELETE OF A MEMORY CREDENTIAL SURFACES A RAW
`SQLITE_CONSTRAINT_FOREIGNKEY` THROUGH A FLOW THAT HAS WORKED SINCE TASK 3-2.** This is the defect
**D62** records and **3a-5 already paid for once**. The FK's job is to make the refusal **mandatory**,
not to author it; the count is what lets somebody author it. **⚠ AND THE DISTINCT NAMING IS THE
POINT** — the existing comment says *"used by 2 things" does not tell a user what to go and delete.*

**⚠ WHOEVER DOES BUILD IT INHERITS 3b-2's TRAP TOO, so it is recorded here rather than rediscovered.**
An earlier 3a-5 run proved nothing because the 3-2 guard fired first. To prove the new count:

1. Create a credential used **only** by a `project_memory` row — **no launch profile, no council
   member** on it.
2. Delete it. The refusal must name **memory configurations** and nothing else.
3. **Then** delete a credential used by all three and confirm all three are named.

**Step 1 is the test that means something.** A credential held by two things proves only that some
guard fired.

## 3. `memoryConfigCore.ts` — pure, and therefore exhaustively tested

Plan §9: *"logic that is not in a pure core is logic that cannot be tested"* — tests cannot import
`storage.ts` (Electron ABI 148 vs Node 127). **No electron, no dockerode, no neo4j-driver, no
storage.**

- **Mode vocabulary** — `'local-docker' | 'existing' | 'aura'`, matching the column comment, plus a
  **supported-modes predicate with an authored reason** for the two this phase does not ship. In
  Phase 6 only **`existing`** is admitted; `local-docker` arrives at Stage 5 and `aura` is inherently
  credentialed, so it travels with D128(a). `auth_mode` admits **`'none'` only.**
  - **⚠ KEEP THE FULL VOCABULARY IN THE ZOD INPUT AND REFUSE IN THE SERVICE, rather than narrowing
    the enum to a single value.** A Zod parse failure is not an authored refusal — it is a stack
    trace where a sentence belongs — and a one-value enum has to be widened at Stage 5 anyway. The
    refusal belongs where it can carry a reason a user reads. This is the `resolveLaunchProfile`
    precedent (`src/main/services/launchProfiles.ts:185`, `ProfileResolution` at `:158–168`), whose
    own comment explains why a disabled thing must say why: *"a named entry that silently vanishes is
    worse than one that says why it cannot launch."*
- **Bolt-URI validation and normalisation.** Accept `bolt://`, `bolt+s://`, `neo4j://`, `neo4j+s://`.
  **⚠ REFUSE A URI CARRYING INLINE CREDENTIALS** (`bolt://user:pass@host`) with an authored reason —
  that is a password arriving through the one field this design left as free text, and it is exactly
  how a secret ends up in a table that has no password column.
- **A port extractor.** The chip renders `:7688`; that port must come from a tested pure function,
  never from string-slicing inside a `.vue` file.
- **Port-range checks.**
- **Docker-legal container and volume naming from a project slug** — `[a-zA-Z0-9][a-zA-Z0-9_.-]*`,
  producing `chorus-neo4j-<slug>` and `chorus-neo4j-<slug>-data` (**D92 — and note `Plan.md:214`'s
  `agentdesk-` prefix is superseded, D102**). Stage 5 consumes it; **it is written and tested here
  because it is pure and Stage 5 is where the expensive debugging lives.**

**⚠ AND IT IS THE SWAP SEAM.** The roadmap's Phase 6 entry records that if the storage engine is ever
revisited, *"the swap seam is `memoryConfigCore.ts` plus the MCP descriptor, not the architecture."*
Write it as if something other than Neo4j might one day arrive behind it.

## 4. `neo4jClient.ts` and `memoryService.ts` — the shells

**The dependency.** `neo4j-driver` is the phase's only addition (**D100**; runtime deps **7 → 8**).
`npm view neo4j-driver version` on 2026-08-08 returned **6.2.0** on `latest`, with **5.28.3** on the
`latest-5.28` line. **D100 approved the package, not a version.** Install, **record the resolved
version in the commit**, and verify it against Neo4j **5.26.29** (the measured resolution of
`neo4j:5-community`). If 6.x's API shape costs real time, 5.28.3 is a defensible fallback — **but say
which line was taken and why.** ⚠ If it turns out to need a native build or an `electron-rebuild`,
**D100's stated premise ("pure JS, no native build") has failed — stop and report** rather than
reaching for the rebuild.

**`neo4jClient.ts`** owns the driver. One per config, **lazily created**, disposed on config change
**and on `before-quit`** (`src/main/index.ts:619`). **⚠ IT NEVER LOGS A URI** — a bolt URI can carry
credentials inline, which is also why §3 refuses one on the way in.

**`memoryService.ts`** owns config read/write and the test path. **⚠ IT DOES NOT IMPORT `vault`.** The
plan calls it *"the ONLY module that decrypts"*; **in this phase nothing decrypts** (D128(a)), so
importing `vault.decryptForLaunch` speculatively is the stub D76 forbids, one layer down. When
credentialed mode arrives it reuses `decryptForLaunch` and **never forks it** — D33 clause 2 and D58's
admission terms both.

**⚠ WIRING POSITION IN `src/main/index.ts` IS LOAD-BEARING (plan §9).** Any memory boot reconcile
belongs in the same band as `worktrees.reconcileAll()` (`:546`) and `dispatches.healOrphansAtBoot()`
(`:403`), i.e. **before `sessions.restore(...)` (`:595`)** — otherwise restore can launch a session
whose MCP config points at a container the reconcile is about to mark dead. **Stage 2 has no
container, so there may be nothing to reconcile yet. Do not invent a no-op to occupy the slot** —
leave a comment in that band naming the position Stage 5 must use, and say in the report that you
did. A no-op call site is a stub; a comment is a note to the next person.

## 5. The channels — five, not six

**⚠ Task-6-3.md once said "six". The table below is the authority: there are FIVE.** `IpcChannel`
**71 → 76**.

Four layers, as always: schema in `src/shared/ipc.ts` → `ipcMain.handle` in `src/main/ipc.ts` parsing
**in and out** → thin forwarder in `src/preload/index.ts` (**no Zod — it throws `EvalError` under this
app's CSP and silently drops events**) → `stores/memory.ts`. Refusals are `{ok:false, reason}` unions,
**never thrown**. Snapshot reactive payloads before sending (**D14**).

| Channel | Contract |
|---|---|
| `memory:get` | **No password field, and no bolt URI in the payload** — send the normalised host/port facts the UI needs, not a string that can embed credentials. ⚠ **Extend `ipc.test.ts`'s key-set assertion** in the `src/shared/ipc.test.ts:2132–2165` shape, **including its `/key\|secret\|token\|blob\|fingerprint\|password\|value/i` loop.** That assertion is what catches a password field being added in 2027. |
| `memory:configure` / `memory:disable` | Takes a credential **id**, never a key (D33 clause 2) — and in this phase, never a credential at all. **`disable` deletes the row; it does NOT destroy graph data, and the UI must say which.** |
| `memory:status` | **⚠ PURE READ. DECRYPTS NOTHING. OPENS NO BOLT SESSION.** Pollable by the chip. This is the `model:list` vs `model:refresh` split. |
| `memory:test` | **ONE live connect + `RETURN 1`. USER-INITIATED ONLY** — no boot hook, no timer, no restore path, no retry (D58, verbatim). Reason strings use the `vaultCore.failureMessage` vocabulary (`src/main/services/vaultCore.ts`; callers at `ipc.ts:580`, `councilMembers.ts:171`, `modelCatalog.ts:187`). |

**`memory:seed` and `memory:validate` are Task 6-4's** — do not add them here, even as stubs. A stub
channel is a channel the count has to explain.

**⚠ `memory:test` MUST ISSUE A REAL QUERY — A HANDSHAKE IS A FALSE GREEN, AND THIS IS MEASURED, NOT
FEARED.** The 6-1 D4 pass found `initialize` **and** `tools/list` succeeding against an
unreachable/unauthorised database on **every** failing row of the connect matrix; the error surfaced
only on `tools/call`. The analogue here is **`driver.verifyConnectivity()`: it is not sufficient
evidence.** Open a session, run **`RETURN 1`**, and assert the returned value. A test that stops
earlier reports success on a database it cannot read.

**⚠ THE `memory:status` / `memory:test` SPLIT IS THE MOST DANGEROUS LINE IN THIS TASK.** A chip that
polls a channel which decrypts is an unattended-decrypt loop on a 15-second timer. **Assert the
absence with an injected dep the test forbids touching**, not with a comment — and **state in the test
that the vault half of that assertion is vacuous in this phase** (nothing decrypts) so it is not read
as stronger than it is.

## 6. The store, the surface, and the chip

- **`stores/memory.ts`** follows `stores/settings.ts`. **Supersede token** on every load (`loadSeq` —
  `settings.ts:37, 83, 91`; `council.ts:239–245`), with a test that a superseded load does not
  overwrite a newer one.
- **The surface goes in `src/renderer/src/views/ProjectSettingsView.vue`, NOT a new Settings route.**
  ⚠ **This supersedes this spec's original instruction**, which said *"a new Settings route beside
  Credentials and Providers"* — **that structure does not exist**: `SettingsView.vue` is 78 lines with
  one nav entry (`:55–58`) and no routing, and `SettingsCredentials.vue` is a child of
  `SettingsProviders.vue` (`:11`, `:1004`), not a route. `ProjectSettingsView.vue` arrived in Phase 3h
  (`882dec3`) and **`project_memory` is keyed by `project_id`.** Rationale and the ratification note
  are in the task doc's ruling. **3c-1 tokens only — no raw hex, no stock Tailwind palette utility**;
  read `SettingsProviders.vue` for the established form/row anatomy rather than inventing one.
- **The chip: `● neo4j :7688`, in `src/renderer/src/components/StatusBar.vue`.** That is the host —
  `ImplementationSpec-3c-3.md:72` and `Task-3c-3.md:113` both record the omission there, and the
  file's own header comment at `:17` reads *"the graph-database chip ❌ that database is Phase 6 and
  does not exist."* **Update that comment when the chip lands.**
  - **⚠ D76 GOVERNS IT AND THE RULE IS "OMIT, DO NOT STUB".** It was *omitted* from Phase 3c because
    it had no data source; it returns **now** because `memory:status` gives it one, and for a project
    with **no memory configured it renders nothing at all** — no placeholder, no zero, no skeleton.
    Follow the `worktreeCount` pattern at `:69–91`, which already does exactly this for a fact the app
    could not obtain.
  - **⚠ NO POLLING TIMER.** `memory:status` is *pollable* because it is a pure read; that is not a
    reason to poll it. In Stage 2 there is no container, so the configured state cannot change behind
    the app's back. Read on **project switch** and after **configure / disable / test**. Adding a
    15-second loop for a fact that cannot change is inventing machinery — and it is one refactor away
    from the unattended-decrypt loop D33/D53/D58 forbid outright.
  - **⚠ WHAT THE CHIP MAY CLAIM.** D126's state model is `Configured → Pending approval → Connected →
    Failed`, and **`Connected` is earned by an observed read, never by a written file.** The Stage-2
    subset is **`Configured` / `Connected` / `Failed`** — `Pending approval` concerns a CLI's MCP
    approval and arrives at 6-5. **`Connected` is a session-lifetime fact held in the store from the
    last `memory:test`, not a persisted column.** ⚠ **Do not add `last_tested_at` or `last_test_ok`:**
    a persisted `Connected` would claim connectivity the app has not observed since restart, which is
    precisely what that rule forbids. The port comes from §3's extractor.
- **⚠ NO H3 DISCLOSURE.** This spec once required one. **D128(a) removed its subject:** `secretEnv`
  stays empty, so the `composeChildEnv` policy flip (`src/main/adapters/env.ts:142` — **re-verified
  unchanged at `842a7cc`**) cannot fire. Disclosing an impossible event is a placeholder. **The
  standing prohibition survives the cut and still applies to whoever ships credentialed mode: DO NOT
  "FIX" H3 BY ROUTING THE PASSWORD THROUGH `envAdditions`** — that puts a secret in the channel D33
  defines as non-secret and destroys the invariant D89 repaired.

## 7. Verification

```bash
npm run typecheck && npx vitest run && npm run grep:secrets
grep -c "sqliteTable(" src/main/db/schema.ts                          # 17
grep -riE "password|secret|token|auth_value|blob" src/main/db/schema.ts   # nothing in project_memory
grep -rn "countProjectMemoryForCredential" src/                        # nothing — cut; the debt is in the migration COMMENT
grep -rn "memory:seed\|memory:validate" src/                           # nothing — Task 6-4's
git diff -- package.json                                               # neo4j-driver only
```

Baseline at `842a7cc`: typecheck **0** (node + web) · vitest **1476 / 41 files** · `grep:secrets`
clean (6 patterns) · `IpcChannel` **71** · `ipcMain.handle(` **63 / 0** · `sqliteTable(` **16** ·
`MIGRATIONS.length` **15** · runtime deps **7**. ⚠ **F50: `adapters.test.ts` flickers in full-suite
runs** — re-run before diagnosing a regression.

**Runtime (G2) — and it needs a real Neo4j, which is the point of this stage.**

**⚠ THE NEO4J ALREADY RUNNING ON THIS MACHINE IS THE WRONG ONE.** `docker ps` at `842a7cc` shows
`taxapp-neo4j`, image `neo4j:latest`, published on `0.0.0.0:7474` and `0.0.0.0:7687`. **Do not point
G2 at it:** it holds **another project's data**; it is **not loopback-bound**, so it is not the shape
D93's exposure argument is about; and it almost certainly has **auth enabled**, which local mode
cannot authenticate against. The result would be `Neo.ClientError.Security.Unauthorized` — **row 4 of
the D4 pass connect matrix, not a defect in the code** — and diagnosing that from scratch is the time
this paragraph exists to save.

Start a disposable, auth-disabled, loopback-bound instance instead:

```bash
docker run -d --name chorus-g2-neo4j -e NEO4J_AUTH=none -p 127.0.0.1:7688:7687 neo4j:5-community
```

Port **7688** is deliberate: it is the port the v2 mock's chip draws, and it does not collide with
`taxapp-neo4j`. **Remove the container when G2 is done and say so in the report.**

- [ ] `memory:configure` persists, `memory:get` reads it back, **and the payload has no password
      field and no bolt URI.**
- [ ] **`memory:test` returns success against the real instance, with `RETURN 1`'s value observed**,
      and a deliberately wrong port returns an authored refusal with **no URI, no driver stack trace
      and no raw Neo4j error code in it.**
- [ ] The chip appears for the configured project and **is absent** for another project.
- [ ] **`before-quit` disposes the driver** — confirm no lingering handle keeps the process alive.
- [ ] **No timer is polling `memory:status`** — check the code, not the behaviour.

### Two G2 items deleted by D128(a), recorded so they are not silently dropped

- **~~`credential:delete` refuses on a credential held only by a memory config~~** — no credentialed
  row can exist; the guard was cut (§2) and the debt lives in the migration comment.
- **~~Restore parity: launch a session credentialed only by way of memory and confirm
  `sessionIsCredentialed` classifies it (the F26 shape)~~** — no such session can exist in local mode.
  **Both travel with credentialed mode**, and whoever ships it inherits them along with the council's
  eight preconditions.
