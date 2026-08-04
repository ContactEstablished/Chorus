# ImplementationSpec 6-3 — Connect to an Existing Neo4j

**Normative for:** [`../Tasks/Task-6-3.md`](../Tasks/Task-6-3.md). **Design input:
[`../Phase-6-MemoryPlan.md`](../Phase-6-MemoryPlan.md) §6, §7, §9.** The plan's DDL is reproduced
there in full and is **normative on its CONTENT** — this spec adds the ordering, the guard and the
verification the plan left to a kickoff. **⚠ THE PLAN CALLS THAT DDL "v13" THROUGHOUT AND IS
SUPERSEDED ON THE NUMBER ONLY (see §1); it is annotated rather than rewritten, the D42/D94/D102
precedent — the roadmap wins on current status, the plan stands on design.**

## 1. Migration v14 and `project_memory`

**⚠ FIRST, BEFORE WRITING ANYTHING: assert `MIGRATIONS.length + 1 === 14`.** `storage.ts:95`,
verified **13** on 2026-08-01. **If it is not 13, STOP AND REPORT** — another phase appended and the
number in every document in this phase is wrong. **Do not renumber to make it fit**; that is the
standing rule and it exists because a renumbered migration silently re-runs against an
already-migrated DB.

**⚠ THIS SPEC SAID `13` UNTIL 2026-08-01, AND THE CORRECTION IS RECORDED RATHER THAN APPLIED
SILENTLY — BECAUSE THE GUARD ABOVE IS THE THING THAT CAUGHT IT.** At the Phase 6 kickoff
(`3fa295d`, 2026-07-28) `MIGRATIONS.length` was **12** and v13 was genuinely free. `v13` has since
been spent by unrelated work — `projects.color` + `projects.description`, which names itself v13 at
`schema.ts:20` — making this **the first time in the project's history that a waiting phase's fixed
migration number has decayed.** The stop-on-divergence rule did exactly what it was written for; it
simply fired at an architect pass instead of at execution, which is the cheaper of the two.

**⚠ AND THE PREMISE IS UNCOMMITTED, WHICH IS WHY THE ASSERTION OUTRANKS THIS PARAGRAPH.** The v13
above lives in a working tree, not in a commit. If it is reverted or reworked before this task runs,
`MIGRATIONS.length` returns to **12**, the assertion fails, and the correct response is **stop and
report** — not "the spec said 14, so append 14". The rule governs in both directions; the number is
only ever this document's best current reading of it.

**`storage.ts:75` → `storage.ts:95`.** The `MIGRATIONS` array moved with the same working tree; the
line citation is corrected here so the first instruction in this spec does not send a reader to the
wrong place.

**Take the plan §6 DDL verbatim, including its comment.** The comment is not decoration:

```sql
-- ⚠ THERE IS NO PASSWORD COLUMN HERE, IN ANY FORM, AND THERE MUST NEVER BE ONE.
--   A credentialed mode NAMES a credential_profiles row; the secret stays in the
--   DPAPI envelope and is resolved per launch by vault.decryptForLaunch (D93).
```

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
| `credential_profile_id` → `credential_profiles(id)` | **Enforced, RESTRICT.** ⚠ **The FK's job is to make the refusal MANDATORY, not to author it** — see §2. |
| `container_id` | **No constraint.** Reconcilable, like `worktrees`. |

**Stage-2 columns that stay NULL:** `container_id`, `container_name`, `volume_name`, `bolt_port`,
`http_port`. `schema_version` stays **0** — Task 6-4 owns it. **They are created now only because
`MIGRATIONS.length` moves exactly once in this phase**, and a second migration to add five columns
would be churn for nothing.

## 2. The third dependent count — and the trap in proving it

`src/main/ipc.ts:1515–1516` counts **two** today, and the surrounding comment already records the
shape: *"Task 3b-2 adds ONE COUNT to this guard; it does NOT add a second guard."* **Follow that
instruction exactly — one more count in the same guard.**

Add `storage.countProjectMemoryForCredential(id)` beside its two siblings, and extend the refusal's
`parts[]` so it reads *"used by 1 launch profile and 2 memory configurations"*. **⚠ THE DISTINCT
NAMING IS THE POINT** — the existing comment says *"used by 2 things" does not tell a user what to go
and delete.*

**⚠ WITHOUT THIS, THE FIRST DELETE OF A MEMORY CREDENTIAL SURFACES A RAW
`SQLITE_CONSTRAINT_FOREIGNKEY` THROUGH A FLOW THAT HAS WORKED SINCE TASK 3-2.** This is the defect D62
records and 3a-5 already paid for once.

**⚠ AND HERE IS THE TRAP, WHICH IS 3b-2's OWN LESSON: an earlier 3a-5 run proved nothing because the
3-2 guard fired first.** To prove the new count:

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

- **Mode vocabulary** — `'local-docker' | 'existing' | 'aura'`, and the auth mode each admits.
- **Bolt-URI validation and normalisation.** Accept `bolt://`, `bolt+s://`, `neo4j://`, `neo4j+s://`.
  **⚠ REFUSE A URI CARRYING INLINE CREDENTIALS** (`bolt://user:pass@host`) with an authored reason —
  that is a password arriving through the one field this design left as free text, and it is exactly
  how a secret ends up in a column that has no password column.
- **Port-range checks.**
- **Docker-legal container and volume naming from a project slug** — `[a-zA-Z0-9][a-zA-Z0-9_.-]*`,
  producing `chorus-neo4j-<slug>` and `chorus-neo4j-<slug>-data` (**D92 — and note `Plan.md:214`'s
  `agentdesk-` prefix is superseded, D102**). Stage 5 consumes it; **it is written and tested here
  because it is pure and Stage 5 is where the expensive debugging lives.**
- **The launchability predicate + an authored `disabledReason`** — the `resolveLaunchProfile`
  precedent. A reason a user can act on, never a boolean.

## 4. `neo4jClient.ts` and `memoryService.ts` — the shells

**`neo4jClient.ts`** owns the driver. One per config, **lazily created**, disposed on config change
**and on `before-quit`**. **⚠ IT NEVER LOGS A URI** — a bolt URI can carry credentials inline, which
is also why §3 refuses one on the way in.

**`memoryService.ts` is the ONLY module that decrypts.** It reuses `vault.decryptForLaunch` and
**never forks it** — that is D33 clause 2 and D58's admission terms both.

**⚠ WIRING POSITION IN `src/main/index.ts` IS LOAD-BEARING (plan §9).** Any memory boot reconcile
belongs in the same band as `worktrees.reconcileAll()` and `dispatches.healOrphansAtBoot()`, i.e.
**before `sessions.restore(...)`** — otherwise restore can launch a session whose MCP config points at
a container the reconcile is about to mark dead. **Stage 2 has no container, so there may be nothing
to reconcile yet; put the call site in the right band anyway, or Stage 5 will put it in the wrong one.**

## 5. The channels

Four layers, as always: schema in `src/shared/ipc.ts` → `ipcMain.handle` in `src/main/ipc.ts` parsing
**in and out** → thin forwarder in `src/preload/index.ts` (**no Zod — it throws `EvalError` under this
app's CSP and silently drops events**) → `stores/memory.ts`. Refusals are `{ok:false, reason}` unions,
**never thrown**. Snapshot reactive payloads before sending (**D14**).

| Channel | Contract |
|---|---|
| `memory:get` | **No password field, and no bolt URI that could embed credentials.** ⚠ **Extend `ipc.test.ts`'s key-set assertion** — that assertion is what catches a password field being added in 2027. |
| `memory:configure` / `memory:disable` | Takes a credential **id**, never a key (D33 clause 2). **`disable` deletes the row; it does NOT destroy graph data**, and the UI must say which. |
| `memory:status` | **⚠ PURE READ. DECRYPTS NOTHING. OPENS NO BOLT SESSION.** Pollable by the chip. This is the `model:list` vs `model:refresh` split. |
| `memory:test` | **ONE live connect + `RETURN 1`. USER-INITIATED ONLY** — no boot hook, no timer, no restore path, no retry (D58, verbatim). Reason strings use the `vaultCore.failureMessage` vocabulary. |

**`memory:seed` and `memory:validate` are Task 6-4's** — do not add them here, even as stubs. A stub
channel is a channel the count has to explain.

**⚠ THE `memory:status` / `memory:test` SPLIT IS THE MOST DANGEROUS LINE IN THIS TASK.** A chip that
polls a channel which decrypts is an unattended-decrypt loop on a 15-second timer. **Assert the
absence with an injected dep the test forbids touching**, not with a comment.

## 6. The store, the Settings surface, and the chip

- `stores/memory.ts` follows `stores/settings.ts`. **Supersede token** on every load (`loadSeq`).
- `SettingsMemory.vue` is a new Settings route beside Credentials and Providers. **3c-1 tokens only —
  no raw hex, no stock Tailwind palette utility.** Read `SettingsProviders.vue` for the established
  form/row anatomy rather than inventing one.
- **The chip: `● neo4j :7688`.** **⚠ D76 GOVERNS IT AND THE RULE IS "OMIT, DO NOT STUB".** It was
  *omitted* from Phase 3c because it had no data source; it returns **now** because `memory:status`
  gives it one, and for a project with **no memory configured it renders nothing at all** — no
  placeholder, no zero, no skeleton.
- **The H3 disclosure.** If credentialed memory is enabled for a **subscription** session,
  `composeChildEnv` (`src/main/adapters/env.ts:142`) flips that pane from inherit-wholesale to the
  eight-variable allow-list **because `secretEnv` becomes non-empty for the first time** — the
  developer's ambient environment vanishes from a pane that worked yesterday. **Surface it in the UI.**
  **⚠ DO NOT "FIX" IT BY ROUTING THE PASSWORD THROUGH `envAdditions`** — that puts a secret in the
  channel D33 defines as non-secret and destroys the invariant D89 just repaired. **Local mode's
  `NEO4J_AUTH=none` makes H3 disappear entirely**, so the disclosure is conditional on the mode.

## 7. Verification

```bash
npm run typecheck && npx vitest run && npm run grep:secrets
grep -c "sqliteTable(" src/main/db/schema.ts                  # 17
grep -riE "password|secret|token|auth_value" src/main/db/schema.ts   # nothing in project_memory
git diff -- package.json                                      # neo4j-driver only
```

**Runtime (G2) — and it needs a real Neo4j, which is the point of this stage.** Any reachable
instance: a Docker container the *developer* starts by hand (not Chorus — that is Stage 5), a local
install, or an Aura free tier.

- [ ] `memory:configure` persists, `memory:get` reads it back, **and the payload has no password field.**
- [ ] **`memory:test` returns success against the real instance**, and a deliberately wrong port
      returns an authored refusal with **no URI and no driver stack trace in it.**
- [ ] The chip appears for the configured project and **is absent** for another project.
- [ ] `credential:delete` refuses on a credential held **only** by a memory config, naming it (§2).
- [ ] **`before-quit` disposes the driver** — confirm no lingering handle keeps the process alive.
- [ ] **Restore parity:** launch a session credentialed only by way of memory, restart, and confirm
      `sessionIsCredentialed` classifies it (the F26 shape).
