# Task 6-3 Execution Prompt: Connect to an Existing Neo4j (Stage 2)

**Status**: Not started. Working tree is clean of this task's code; the only uncommitted files belong
to other workstreams (section 4).

---

## 1. Role

You are the **Coordinator for the Foundation feature, Phase 6 (Neo4j Project Memory + Skills),
Task 6-3 — Stage 2**.

- **Repo root:** `C:\Projects\ContactEstablished\Chorus`
- **Expected branch:** `main` — **confirm it; do not switch without instruction.**
- **Expected HEAD at start:** `842a7cc` ("Record the brief that Task 6-2 was built from")

You are opening the first bolt connection this application has ever made, and adding the phase's only
dependency.

**Ground every fact against the code before you act on it.** Section 5's table was measured at
`842a7cc` on 2026-08-08; if the tree has moved, **the code wins and you say so.** This phase has now
lost time three times to task docs built on stale facts — the migration number alone has decayed
twice — which is why this prompt re-measures rather than quoting its own governing documents.

---

## 2. Goal

A project can be pointed at a **real, already-running Neo4j**; Chorus proves it reaches it by issuing
a query on one user-initiated click; and the `● neo4j :7688` status chip that D76 deliberately
*omitted* from Phase 3c comes back **because it finally has a data source.**

No container. No provisioner. No graph schema. **Stage 2 exists so Stage 3's schema work can be
proven against a real graph without simultaneously debugging container lifecycle** — D91's
load-bearing ordering choice.

**PRIME CONSTRAINT:** `project_memory` has **no password-shaped column, in any form, ever**, and
`memory:status` **decrypts nothing and opens no bolt session.** Both are stop-and-report if violated.

---

## 3. Ground yourself first

Read these in this order before editing any code:

1. **`CLAUDE.md`** (repo root) — non-negotiable architecture rules.
2. **`docs/Features/Foundation/Tasks/Task-6-3.md`** — **read the "⚠ AMENDED 2026-08-08 BY TASK 6-1"
   block at the top FIRST. It wins over the body, and this prompt wins over both on every number.**
3. **`docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-6-3.md`** — §1–§7. **Its body
   still says `v14` throughout; that is stale (section 5.1).**
4. **`docs/Features/Foundation/Tasks/Phase-6-Overview.md`** — the amended block, then the purity
   contract.
5. **`docs/Features/Foundation/Phase-6-MemoryPlan.md` §6 (DDL), §7 (IPC), §9 (cores vs shells)** —
   **authoritative on design.** The §6 DDL is normative on its content; take it verbatim including
   its comment.
6. **`docs/Features/Foundation/Investigations/6-1-D4-Pass.md`** — the measured evidence. Sections
   "⭐ ITEM 2" (the connect matrix, and the false-green finding) and "⭐ ITEM 4" are the two this task
   rests on.
7. **`docs/Features/Foundation/roadmap.md`** — decisions **D33, D53, D55, D58, D62, D76, D85, D88,
   D92, D93, D100, D126, D127, D128(a)**, and findings **F48, F49, F50**.
8. **Code, at the line numbers in section 5.2** — do not use the line numbers printed in Task-6-3.md
   or ImplementationSpec-6-3.md; three of the four have drifted.

---

## 4. ⚠ Pre-existing changes — do not revert, stage, or commit these

These belong to other workstreams and are untracked at `842a7cc`:

```
?? CLAUDE-PROJECT-MARKER.txt
?? docs/Features/Foundation/CouncilBriefs/CouncilBrief-3g.0-ReasoningSpend-Findings.md
?? docs/Features/Foundation/CouncilBriefs/CouncilBrief-3g.0-ReasoningSpend.md
?? docs/Features/Foundation/Investigations/3f-0-SizeCost/case-C.md
?? docs/Features/Foundation/Investigations/3f-0-SizeCost/case-D.md
?? docs/Features/Foundation/Tasks/Phase-3h-ExecutionPrompt.md
?? docs/Features/Foundation/Tasks/Phase-3h-Overview.md
```

Plus **this prompt itself** (`Task-6-3-ExecutionPrompt.md`), which may be committed with your work.

---

## 5. Ground truth, re-measured at `842a7cc` on 2026-08-08

### 5.1 Baselines — **every number in Task-6-3.md AND in its own amendment block is stale**

The amendment block was written against `84dcf54`. Task 6-2 and part of Phase 3h have landed since.

| Fact | Task-6-3.md body says | Its amendment says (`84dcf54`) | **Actually now (`842a7cc`)** |
|---|---|---|---|
| `MIGRATIONS.length` | 13 (→ assert `=== 14`) | 15 (→ assert `=== 16`) | **15 — assert `+1 === 16` ✅ holds** |
| `sqliteTable(` | 16 → 17 | 16 → 17 | **16 → 17 ✅ holds** |
| vitest | 1055 / 30 files | 1305 / 39 files | **1476 passed / 41 files** |
| `IpcChannel` keys | 58 | 68 | **71** |
| `ipcMain.handle(` (`ipc.ts` / `index.ts`) | 53 / 0 | 62 / 0 | **63 / 0** |
| Runtime deps | 8 | 7 | **7** |
| typecheck | 0 | 0 | **0 (node + web)** |
| `grep:secrets` | clean | clean | **clean, 6 patterns** |

**⚠ THE MIGRATION ASSERTION HOLDS TODAY, AND YOU RE-RUN IT ANYWAY.** `MIGRATIONS.length` is **15**,
so **v16 is the next free version**. Assert `MIGRATIONS.length + 1 === 16` **in the code path itself
before appending** and **STOP AND REPORT on divergence** — do not renumber. This number has decayed
twice (12→13, 13→15); the rule outranks the number in both directions, including this line.

### 5.2 ⚠ Four citations in the governing docs have drifted — use these

| Doc says | **Actually** |
|---|---|
| `storage.ts:75` / `storage.ts:95` for `MIGRATIONS` | **`src/main/services/storage.ts:171`**, array closes at **`:690`**; last entry is `// v15 (Phase 3h / D120)` at **`:640`** |
| `ipc.ts:1515–1516` for the `credential:delete` counts | **`src/main/ipc.ts:1779–1780`**, whole guard **`:1760–1797`** |
| `types.ts:170` **and the amendment's `types.ts:174`** for the argv-is-world-readable note | **`src/main/adapters/types.ts:199`** — and **Task 6-2 added a second one at `:238–239`**, so the citation has now drifted twice. `env.ts:142` (the policy flip) **is unchanged and re-verified.** |
| `ipc.ts:1350` for `headersContainSecret` | defined **`src/main/ipc.ts:252`**, called **`:1375`**, **`:1400`** |

### 5.3 Anchors you will copy from — verified present

| Thing | Where | Why you want it |
|---|---|---|
| `countLaunchProfilesForCredential` | `storage.ts:2273` | the accessor idiom |
| `countCouncilMembersForCredential` | `storage.ts:2368` | **and its doc comment at `:2356–2367`, which is the one to imitate** |
| The "written now, first called later" precedent | `storage.ts:2378–2384` | **⚠ read it before section 6.3 — it argues the OPPOSITE of what you are about to do, and section 6.3 explains why it does not apply** |
| Key-set assertion (the 3-2 discipline) | `src/shared/ipc.test.ts:2132–2165` (`launchProfileWireSchema`), again at `:2357` | **the exact shape `memory:get`'s assertion must take** |
| `IpcChannel` object | `src/shared/ipc.ts:14–422`, 71 keys | |
| `failureMessage` | `src/main/services/vaultCore.ts`; callers `ipc.ts:580`, `councilMembers.ts:171`, `modelCatalog.ts:187` | the refusal vocabulary |
| `resolveLaunchProfile` + `ProfileResolution` | `src/main/services/launchProfiles.ts:185`, type at `:158–168` | **the authored-reason precedent, including the comment at `:160–167` on why a disabled thing says why** |
| `loadSeq` supersede token | `src/renderer/src/stores/settings.ts:37, 83, 91`; `stores/council.ts:239–245` | |
| Boot band | `src/main/index.ts:403` (`healOrphansAtBoot`), `:546` (`worktrees.reconcileAll()`), `:595` (`sessions.restore(...)`), `:619` (`before-quit`) | |
| `mcpConfigCore.ts` + `assertNoSecretInRendered` | `src/main/adapters/mcpConfigCore.ts` | **6-2 landed. Not exercised by this task — see 6.2.** |
| `neo4j:5-community` facts | D4 pass "⭐ ITEM 1" / "⭐ ITEM 4" | 5.26.29 Community, APOC absent, `CREATE DATABASE` refused |

### 5.4 ⚠ Three discoveries that change the work in the task docs

**DISCOVERY 1 — there is no "Credentials route" to sit beside.** ImplementationSpec §6 says
*"`SettingsMemory.vue` is a new Settings route beside Credentials and Providers."* **That structure
does not exist.** `src/renderer/src/views/SettingsView.vue` is 78 lines with **exactly one** nav
entry ("Providers & keys", `:55–58`), no router and no switching; `SettingsCredentials.vue` is not a
route at all — it is a child component of `SettingsProviders.vue` (`:11`, `:1004`). Building "a new
route" means first building route switching that no phase has built.

**DISCOVERY 2 — `ProjectSettingsView.vue` now exists, and memory config is per-project.** It arrived
in Phase 3h (`882dec3`, "You can now hide, archive and delete a project"): 1045 lines, a full-window
per-project view reached two ways — the rail's per-project gear, and immediately after `Add project`.
**`project_memory` is keyed by `project_id`.**

→ **RULING (deviation from ImplementationSpec §6 — take it, and record it):** put the memory surface
in **`ProjectSettingsView.vue`** as a section, **not** in a global Settings route. A global route
would have to own a project selector that duplicates the rail, and `SettingsView`'s nav has no
switching to extend, so the spec's instruction costs a new navigation mechanism to reach a
per-project fact from a global screen. **The spec predates `ProjectSettingsView.vue` — it is not
wrong, it is stale.** Read both files before you accept this; if the code contradicts it, the code
wins. **Record it as a numbered decision for Matthew's ratification** — D128 is the highest at
`842a7cc`, so **D129 is the next free number; re-check before using it.**

**DISCOVERY 3 — "the six channels" is wrong; there are five.** Task-6-3.md step 6 says six;
ImplementationSpec §5's table lists four rows covering **five** channels: `memory:get`,
`memory:configure`, `memory:disable`, `memory:status`, `memory:test`. **Five. `IpcChannel` 71 → 76.**
`memory:seed` and `memory:validate` are Task 6-4's and **must not appear, even as stubs.**

### 5.5 ⚠ The Neo4j already running on this machine is the WRONG one for G2

`docker ps` at `842a7cc` shows:

```
taxapp-neo4j   neo4j:latest   0.0.0.0:7474->7474/tcp, 7473/tcp, 0.0.0.0:7687->7687/tcp
```

**Do not point G2 at it.** Three reasons, each sufficient: it holds **another project's data**; it is
published on **`0.0.0.0`**, not loopback, so it is not the shape D93's exposure argument is about; and
`neo4j:latest` almost certainly has **auth enabled**, which local mode — the only mode this phase
ships — cannot authenticate against. Pointing at it and getting `Neo.ClientError.Security.Unauthorized`
would be **row 4 of the D4 pass connect matrix**, not a defect in your code, and diagnosing that from
scratch is the time this section exists to save.

**Start your own, disposable, auth-disabled, loopback-bound instance:**

```bash
docker run -d --name chorus-g2-neo4j -e NEO4J_AUTH=none -p 127.0.0.1:7688:7687 neo4j:5-community
```

Port **7688** is deliberate: it is the port the v2 mock's chip draws (`● neo4j :7688`), and it does
not collide with `taxapp-neo4j` on 7687. **Remove the container when G2 is done** and say so in the
report.

---

## 6. ⚠ What D128(a) DELETED from this task — read before writing anything

**Phase 6 ships LOCAL-MODE ONLY.** CR-6.0 returned `REVISE` on Q3 and attached eight preconditions to
credentialed memory; D128(a) took the honest consequence and moved credentialed mode **out of the
phase**. Local mode is measured working (D4 pass) and needs none of them.

**Task-6-3.md's body and acceptance criteria were written before that cut. Where they demand
credentialed-mode work, they are superseded.** State each of these in your report.

### 6.1 Do not build

- **No `auth_mode: 'credential'` code path** in the service, the client, or the UI.
- **No confirmation gate, no restricted-profile indicator, no executable-resolution verification** —
  those are the council's eight preconditions and they travel with the mode.
- **No H3 disclosure.** `secretEnv` stays empty, so the `composeChildEnv` policy flip
  (`src/main/adapters/env.ts:142`) **cannot fire**. A UI disclosure of an impossible event is a
  placeholder, and D76 forbids it.
- **Do not touch `env.ts` at all.** D128(b) refuses the `APPDATA`/`LOCALAPPDATA` addition on D88's
  three-lists rule; F48 holds the evidence for whoever eventually needs it.
- **No restore-parity check.** Task-6-3.md's last acceptance criterion asks whether
  `sessionIsCredentialed` classifies "a session credentialed only by way of memory". **In local mode
  no such session can exist**, so the check has no subject. Say that; do not fabricate one.
- **`memoryService.ts` does not import `vault`.** It is described as "the only module that decrypts";
  in this phase **nothing decrypts.** Importing `decryptForLaunch` speculatively is the stub D76
  forbids, one layer down.

### 6.2 `assertNoSecretInRendered` is not exercised here

6-2 shipped it. This task writes **no CLI config file and emits no MCP argv** — that is 6-5. There is
no secret in local mode and nothing rendered to assert over. **Say so rather than inventing a call
site**, and note it as the reason G4's blind spot (`~/.codex/`, `.mcp.json`) is still uncovered by
anything in this task.

### 6.3 ⚠ CUT `countProjectMemoryForCredential` and the third count in `credential:delete`

**This reverses Task-6-3.md's step 3, its verification grep, and two of its acceptance criteria. Take
the cut, and justify it in the report.**

With credentialed mode out of the phase, `project_memory.credential_profile_id` is **always NULL**.
The FK can therefore never be violated, the guard can never be reached, and the function would have
**no caller** — which is exactly what the amendment block says to cut rather than ship.

**⚠ AND THE COUNTER-PRECEDENT IS REAL, SO DEAL WITH IT EXPLICITLY.** `storage.ts:2378–2384` records
the `attention_spans` precedent: a table and its accessors deliberately shipped **one task before**
their only writer, so the phase's schema churn stays in one migration. **That precedent does not
reach this case** — there the writer was one task away inside the same phase; here the writer left
the phase entirely and carries eight preconditions with it. Shipping the guard now would mean
shipping a refusal message nobody can ever read, in a phase that cannot test it.

**⚠ BUT THE DEBT MUST BE CARRIED, NOT DROPPED — THIS IS THE PART THAT MATTERS.** The migration's
comment on `credential_profile_id` must state, in the SQL, that **whoever ships credentialed memory
MUST add `countProjectMemoryForCredential` to `credential:delete`'s existing guard (`ipc.ts:1779`)
BEFORE the first credentialed row can be written** — or the first delete of a memory credential
surfaces a raw `SQLITE_CONSTRAINT_FOREIGNKEY` through a flow that has worked since Task 3-2. That is
the defect **D62** records and **3a-5 already paid for once**. A column with an enforced FK and no
counterpart guard is a loaded trap; the comment is what disarms it.

---

## 7. Work to complete, in order (the order is load-bearing)

### STEP 1 — migration **v16** and the `project_memory` table

- **Assert `MIGRATIONS.length + 1 === 16` before appending. STOP on divergence.** Do not renumber.
- **Diff the existing 15 entries after your change: byte-identical.**
- Take **plan §6's DDL verbatim**, including its comment block, with three additions:
  the `-- v16 (Phase 6 / Task 6-3)` header; the credentialed-mode debt note from **6.3**; and a line
  recording that `container_id` / `container_name` / `volume_name` / `bolt_port` / `http_port` are
  **Stage 5's and stay NULL**, present now only because `MIGRATIONS.length` moves exactly once in
  this phase.
- `schema_version` stays **0** — Task 6-4 owns it.
- `src/main/db/schema.ts`: add `projectMemory` (**16 → 17**), column names and types matching the DDL
  exactly, in the style of `credentialProfiles` at `:171`.
- **FK rulings (D62 idiom — these rows are live instructions, not history, so they carry real
  `REFERENCES`):** `project_id → projects(id)` **enforced**; `credential_profile_id →
  credential_profiles(id)` **enforced**; `container_id` **no constraint** (reconcilable, like
  `worktrees`).
- **⚠ NO PASSWORD-SHAPED COLUMN.** No `password`, `secret`, `token`, `auth_value`, `key`, `blob`.
  Instant stop-and-report.

### STEP 2 — `src/main/services/memoryConfigCore.ts` + `.test.ts` (**pure**)

No electron, no storage, no `neo4j-driver`, no dockerode. Plan §9: *"logic that is not in a pure core
is logic that cannot be tested."* Test it exhaustively — it is pure, so it is cheap.

- **Mode vocabulary** `'local-docker' | 'existing' | 'aura'` (matching the column comment) plus a
  **supported-modes predicate with an authored reason** for the two this phase does not ship — the
  `resolveLaunchProfile` precedent (`launchProfiles.ts:158–168`): *a reason the user can act on,
  never a boolean.*
  - **⚠ Keep the full vocabulary in the Zod input and refuse in the SERVICE, not by narrowing the
    enum to one value.** A Zod parse failure is not an authored refusal, and a one-value enum would
    have to be widened at Stage 5 anyway. If you disagree after reading the code, say why and choose.
  - `auth_mode` admits **`'none'` only** in this phase.
- **Bolt-URI validation and normalisation.** Accept `bolt://`, `bolt+s://`, `neo4j://`, `neo4j+s://`.
  **⚠ REFUSE A URI CARRYING INLINE CREDENTIALS (`bolt://user:pass@host`) with an authored reason** —
  that is a password arriving through the one free-text field this design has, and it is precisely
  how a secret reaches a table that has no password column.
- **A port extractor** — the chip renders `:7688`, and it must come from a tested pure function, not
  from string-slicing in a `.vue` file.
- **Port-range checks.**
- **Docker-legal container and volume naming from a project slug** — `[a-zA-Z0-9][a-zA-Z0-9_.-]*`,
  producing `chorus-neo4j-<slug>` and `chorus-neo4j-<slug>-data` (**D92**; `Plan.md:214`'s
  `agentdesk-` prefix is superseded by **D102**). Stage 5 consumes it; it is written here **because
  it is pure and Stage 5 is where the expensive debugging lives.**

### STEP 3 — `neo4jClient.ts` and `memoryService.ts` (the shells)

- Add **`neo4j-driver`** — the phase's only dependency (**D100**). `npm view neo4j-driver version` on
  2026-08-08 returned **6.2.0** (`latest`), with **5.28.3** on the `latest-5.28` line. D100 approved
  the *package*, not a version. **Install, record the resolved version, and verify it against Neo4j
  5.26.29.** If 6.x's API shape costs real time, 5.28.3 is a defensible fallback — **but say which you
  took and why, in the commit.** Runtime deps **7 → 8**, and **nothing else.**
- **`neo4jClient.ts`** owns the driver: one per config, **lazily created**, disposed on config change
  **and on `before-quit`** (`index.ts:619`). **⚠ IT NEVER LOGS A URI** — a bolt URI can carry
  credentials inline, which is why STEP 2 refuses one on the way in.
- **`memoryService.ts`** owns config read/write and the test path. **It does not import `vault`
  (6.1).**
- **⚠ WIRING POSITION IN `src/main/index.ts` IS LOAD-BEARING.** Any memory boot reconcile belongs in
  the same band as `worktrees.reconcileAll()` (`:546`) and `dispatches.healOrphansAtBoot()` (`:403`),
  i.e. **before `sessions.restore(...)` (`:595`)**. **Stage 2 has no container, so there may be
  nothing to reconcile** — if there is genuinely nothing to call, **do not invent a no-op**; instead
  put a comment in that band naming the position Stage 5 must use, and say in the report that you did.

### STEP 4 — the five channels

Four layers as always: schema in `src/shared/ipc.ts` → `ipcMain.handle` in `src/main/ipc.ts` parsing
**in and out** → thin forwarder in `src/preload/index.ts` (**no Zod — it throws `EvalError` under this
app's CSP and silently drops events**) → `stores/memory.ts`. Refusals are `{ok:false, reason}` unions,
**never thrown**. Snapshot reactive payloads before sending (**D14**).

| Channel | Contract |
|---|---|
| `memory:get` | **No password field. No bolt URI in the payload** — send the normalised host/port facts the UI needs, not a string that can embed credentials. **⚠ Extend `ipc.test.ts`'s key-set assertion in the `:2132–2165` shape, including the `/key\|secret\|token\|blob\|fingerprint\|password\|value/i` loop.** That assertion is what catches a password field being added in 2027. |
| `memory:configure` / `memory:disable` | Takes a credential **id**, never a key (D33 clause 2) — and in this phase never a credential at all. **`disable` deletes the row; it does NOT destroy graph data, and the UI must say which.** |
| `memory:status` | **⚠ PURE READ. DECRYPTS NOTHING. OPENS NO BOLT SESSION.** |
| `memory:test` | **ONE live connect, USER-INITIATED ONLY** — no boot hook, no timer, no restore path, no retry (**D58**, verbatim). |

**⚠ `memory:test` MUST ISSUE A REAL QUERY — a handshake is a false green.** The D4 pass measured
`initialize` and `tools/list` succeeding on **every failing row** of the connect matrix; the failure
surfaced only on `tools/call`. The analogue here is `driver.verifyConnectivity()`: **it is not
sufficient evidence.** Open a session, run **`RETURN 1`**, and assert the returned value. A test that
stops earlier reports success on a database it cannot read.

**Reason strings use the `vaultCore.failureMessage` vocabulary — never a URI, never a driver stack
trace, never a Neo4j error code verbatim.**

### STEP 5 — the store, the surface, and the chip

- **`stores/memory.ts` + `.test.ts`**, following `stores/settings.ts`. **Supersede token (`loadSeq`)
  on every load**, and a test that a superseded load does not overwrite a newer one.
- **The memory surface in `ProjectSettingsView.vue`** (per **DISCOVERY 2** — confirm before
  committing to it). **3c-1 tokens only — no raw hex, no stock Tailwind palette utility.** Read
  `SettingsProviders.vue` for the established form/row anatomy rather than inventing one.
- **The chip: `● neo4j :7688`, in `src/renderer/src/components/StatusBar.vue`.** That is the host —
  `ImplementationSpec-3c-3.md:72` and `Task-3c-3.md:113` both record the omission there, and the
  file's own header comment (`:17`) says *"the graph-database chip ❌ that database is Phase 6 and
  does not exist."* **Update that comment when you add it.**
  - **⚠ D76: OMIT, DO NOT STUB.** For a project with no memory configured it renders **nothing at
    all** — no placeholder, no zero, no skeleton. Follow the `worktreeCount` pattern at `:69–91`,
    which already does exactly this for a fact the app could not obtain.
  - **⚠ NO POLLING TIMER.** `memory:status` is *pollable* because it is a pure read; that is not a
    reason to poll it. In Stage 2 there is no container, so the configured state cannot change behind
    the app's back. Read on **project switch** and after **configure / disable / test** — the
    `worktreeCount` watch is the precedent. Adding a 15-second loop for a fact that cannot change is
    inventing machinery, and it is one refactor away from the unattended-decrypt loop D33/D53/D58
    forbid outright.
  - **⚠ WHAT THE CHIP MAY CLAIM.** D126's state model is `Configured → Pending approval → Connected →
    Failed`, and **`Connected` is earned by an observed read, never by a written file.** In Stage 2
    the reachable subset is **`Configured` / `Connected` / `Failed`** — `Pending approval` is about a
    CLI's MCP approval and arrives at 6-5. **`Connected` is a session-lifetime fact held in the store
    from the last `memory:test`, not a persisted column.** Do not add `last_tested_at` or
    `last_test_ok`: a persisted `Connected` would claim connectivity the app has not observed since
    restart, which is the thing that rule exists to forbid. The port comes from STEP 2's extractor.

### STEP 6 — G2 against a real Neo4j (last; run the actual app)

Per section 5.5. Method is the established CDP harness (`_verify/2-1-cdp.js` is the existing driver;
remote debugging on **9222**). **Screenshots and dumps go in `_verify/` with a `6-3-` prefix.**

---

## 8. Test expectations

- **`memoryConfigCore` exhaustively** — mode vocabulary and the authored unsupported-mode reasons,
  bolt-URI validation and normalisation, **the inline-credentials refusal**, the port extractor, port
  ranges, Docker-legal naming from a slug.
- **`ipc.test.ts`'s key-set assertion extended for `memory:get`**, in the `:2132–2165` shape.
- **A store case: a superseded load does not overwrite a newer one** (`loadSeq`).
- **A structural test that `memory:status`'s handler opens no bolt session** — an **injected driver
  factory that throws if called**, not a comment.
  - **⚠ AND STATE THE TEST'S OWN LIMIT IN ITS COMMENT.** The spec asks you to assert that the handler
    touches "neither the vault nor the driver". **In this phase the vault half is vacuous** —
    `memoryService` does not import `vault` at all (6.1), so there is nothing to forbid. Assert the
    driver half, and say in the test that the vault half is vacuous **until credentialed mode
    arrives, at which point it becomes load-bearing.** A test that looks stronger than it is, is the
    false green this phase has already been burned by once.
- **Never fewer than 1476 across 41 files.** No test may be weakened to accommodate a change; if one
  has to, **stop and report.**

---

## 9. Strict non-goals

- **⚠ NO PASSWORD COLUMN ON `project_memory`, IN ANY FORM, EVER.**
- **⚠ NO CONTAINER WORK.** No `dockerode`, no `docker` CLI call from `src/`, no provisioning, no port
  allocation. (`dockerode` is **not** approved by D100.) The container in section 5.5 is started **by
  you, by hand, in a shell** — not by Chorus.
- **⚠ NO GRAPH SCHEMA.** No constraints, no indexes, no `:ChorusSchema` node, no `memory:seed`, no
  `memory:validate`. `schema_version` stays 0. **No APOC anywhere** — measured absent from the image.
- **⚠ `memory:status` MUST NOT DECRYPT AND MUST NOT OPEN A BOLT SESSION.**
- **No second read path** over anything `storage.ts` already reads.
- **No `BASELINE_ENV_VARS` change; no `env.ts` change at all.**
- **Exactly one dependency added.** If you find yourself needing a second, **stop and report.**
- **Do not revert or commit unrelated changes** (section 4).

---

## 10. Required workflow

1. Confirm branch `main` and HEAD `842a7cc`. If HEAD has moved, **re-measure section 5.1 and say so.**
2. Run the three gates **before** touching anything, to establish your own baseline.
3. Work the steps in order. Steps 1–5 keep the suite green at every commit-shaped boundary.
4. **G2 last**, against your own container.
5. **One narrated commit (G3)**, in the house style: a layman-readable title and body first,
   technical detail second. Name **D62, D76, D92, D93, D100, D126, D128(a)** and the **resolved
   `neo4j-driver` version** in it, and state **G4's blind spot** (`grep:secrets` reaches `src/`,
   `scripts/`, `_verify/`, `package.json` and root configs — **not** `~/.codex/` or a project's
   `.mcp.json`).
6. Do **not** push unless asked.

---

## 11. Verification commands

```bash
npm run typecheck && npx vitest run && npm run grep:secrets
```

```bash
# MIGRATIONS moved by exactly one, and nothing was renumbered
git diff -- src/main/services/storage.ts | grep -c "^-"        # expect: only additions in MIGRATIONS
grep -n "// v16" src/main/services/storage.ts                  # expect: present

grep -c "sqliteTable(" src/main/db/schema.ts                   # expect 17
grep -riE "password|secret|token|auth_value|blob" src/main/db/schema.ts   # expect NOTHING in project_memory
grep -c "ipcMain.handle(" src/main/index.ts                    # expect 0
node -e "console.log(Object.keys(require('./package.json').dependencies).length)"   # expect 8
git diff -- package.json                                       # expect neo4j-driver ONLY
grep -rn "memory:seed\|memory:validate" src/                   # expect NOTHING
grep -rn "countProjectMemoryForCredential" src/                # expect NOTHING (6.3) — the debt is in the migration COMMENT
grep -rn "decryptForLaunch" src/main/services/memoryService.ts # expect NOTHING (6.1)
grep -rn "neo4j" src/main/services/neo4jClient.ts | grep -i "log\|console\|logger"  # expect no URI reaching a log
```

Channel count (expect **76**):

```bash
node -e "const s=require('fs').readFileSync('src/shared/ipc.ts','utf8').split('\n');const a=s.findIndex(l=>l.startsWith('export const IpcChannel'));let b=a;for(let i=a+1;i<s.length;i++){if(/^\}/.test(s[i])){b=i;break}}console.log(s.slice(a+1,b).filter(l=>/^\s+[A-Za-z]\w*:\s*'/.test(l)).length)"
```

---

## 12. Acceptance criteria

- [ ] Gates green; vitest **≥ 1476 across 41 files**; `sqliteTable(` **17**; `MIGRATIONS.length`
      **16**; `ipcMain.handle(` in `index.ts` still **0**; `IpcChannel` **76**.
- [ ] **`project_memory` has no password-shaped column**, and the migration SQL carries both the
      no-password comment and the **credentialed-mode debt note** from 6.3.
- [ ] **The 15 pre-existing migration entries are byte-identical.**
- [ ] `memory:status` **provably** opens no bolt session, and the test states which half of its
      assertion is vacuous and why.
- [ ] **G2: `memory:test` reaches a REAL Neo4j and returns `RETURN 1`** — *"a memory chip that renders
      is not a memory graph that answers."*
- [ ] **A deliberately wrong port returns an authored refusal with no URI, no driver stack trace and
      no raw Neo4j error code.**
- [ ] The chip renders for the configured project and **is absent — not empty — for another.**
- [ ] **`before-quit` disposes the driver** — confirm no lingering handle keeps the process alive.
- [ ] `neo4j-driver` is the **only** dependency added, with its resolved version in the commit.
- [ ] **Every D128(a) deletion in section 6 is named in the report as taken, not silently skipped.**

---

## 13. Review checklist

1. **`grep` the schema for password-shaped columns.** First thing, every time.
2. **`MIGRATIONS.length` is 16 and nothing was renumbered.** Diff the existing 15: byte-identical.
3. **`memory:status` touches no driver** — read the handler and the test, not the comment.
4. **No URI in any log line or reason string.** `neo4jClient.ts` never logs one.
5. **The chip is absent, not empty, when there is no config** (D76), and there is **no polling timer.**
6. **`package.json` gained exactly one runtime dep.**
7. **No `memory:seed` / `memory:validate`, not even as stubs.**

---

## 14. Failure honesty

- **Unrelated environment failures:** capture exact output, explain it, **do not claim success.**
- **⚠ Known flaky test (F50):** `src/main/adapters/adapters.test.ts` has failed intermittently in
  full-suite runs (once in nine at `84dcf54`) while passing 5/5 in isolation. It is cross-file
  interference and pre-existing. **Re-run before diagnosing a regression.**
- **If `MIGRATIONS.length + 1 !== 16`: STOP AND REPORT.** Do not renumber. This has already happened
  twice and the rule is what caught it both times.
- **If `neo4j-driver` needs a native build or an Electron rebuild**, the D100 premise ("pure JS, no
  native build") has failed — **stop and report** rather than reaching for `electron-rebuild`.
- **If the D4 pass's local-mode finding does not reproduce** — an auth-disabled `neo4j:5-community`
  refusing an unauthenticated `RETURN 1` — **stop and report.** That premise is what D128(a) rests on,
  and working around it silently would make the phase's scope cut unsound.

---

## 15. Final reporting requirements

Report as status enum: **DONE** / **DONE_WITH_CONCERNS** / **NEEDS_CONTEXT** / **BLOCKED**.

Include:

1. **Files changed** (git paths).
2. **Build and test results** — full `npm run typecheck`, `npx vitest run` (last 50 lines if long),
   `npm run grep:secrets`, and **each** verification command in section 11 with its actual output.
3. **The migration assertion** — what `MIGRATIONS.length` actually read, and the diff proving the
   existing entries are unchanged.
4. **G2 runtime observation — what was OBSERVED, not summarised.** The `docker run` line, the
   container id, the `memory:configure` round trip, the `memory:test` success **with the returned
   value**, the wrong-port refusal **quoted verbatim**, the chip present for one project and absent
   for another, `before-quit` disposal, and the cleanup of `chorus-g2-neo4j`.
5. **The resolved `neo4j-driver` version**, and why that line was taken.
6. **Every D128(a) deletion (section 6) named, with the consequence stated** — especially the
   `countProjectMemoryForCredential` cut (6.3) and where the debt now lives.
7. **DISCOVERY 2's ruling** — whether you put the surface in `ProjectSettingsView.vue`, what the code
   said when you checked, and the proposed decision number for ratification.
8. **Which assertions were widened and which were left alone.** No test weakened.
9. **Residual risks** for Task 6-4.
10. **Final `git status --porcelain`.**

---

## Summary of decisions this task rests on

- **D33 / D53 / D58** — no unattended decryption; `memory:test` is **one** user-initiated connect.
- **D55** — never a number without its denominator.
- **D62** — enforced FKs make a refusal mandatory; the count is what lets someone author it. **The
  reason 6.3's debt note exists.**
- **D76** — omit, do not stub. The chip was omitted from 3c because it had no data source.
- **D85** — the split-table precedent (`model_shortlist` off `model_catalog`).
- **D88** — the three-lists trap; no `BASELINE_ENV_VARS` addition without observed necessity.
- **D92** — the container is the isolation boundary, `chorus-neo4j-<slug>`; **ratified by measurement
  at CR-6.0 Q1** (`CREATE DATABASE` refused on Community).
- **D93** — no secret value in any CLI config file, in any mode, ever.
- **D100** — `neo4j-driver` approved **here and only here**. `dockerode` is **not**.
- **D126** — CR-6.0 closed; G5 discharged.
- **D128(a)** — **Phase 6 ships LOCAL-MODE ONLY**; credentialed mode left the phase with its eight
  preconditions attached. **This is the decision that shrinks this task.**
- **D128(b)** — no `BASELINE_ENV_VARS` addition in this phase.
- **F48 / F49 / F50** — the `npx` downgrade (deferred), the graph-integrity gate on Stage 5, and the
  flickering test baseline.
