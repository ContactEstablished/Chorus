# Task 6-3 — Connect to an Existing Neo4j (Stage 2)

**Phase:** 6 · **Task 3 of 5** · **Depends on:** **6-2 — hard, and 6-2 has landed** (`53609c7`).

**⚠ THIS DOCUMENT HAS BEEN AMENDED THREE TIMES AND THE AMENDMENTS ARE NOW FOLDED INTO THE BODY.**
The migration number decayed twice, and CR-6.0 cut credentialed mode out of the phase entirely. **The
record of what changed, when, and why is at the bottom (§ Amendment provenance) — read it before
treating any number here as durable.** Everything above that section is current as of **2026-08-08 at
`842a7cc`**.

## Source Of Truth

- [`Phase-6-Overview.md`](Phase-6-Overview.md) — the purity contract; **D100** approves
  `neo4j-driver` **here and only here**.
- [`../Phase-6-MemoryPlan.md`](../Phase-6-MemoryPlan.md) **§6 (schema), §7 (IPC), §9 (cores vs
  shells)** — this task's design. **⚠ The plan calls the migration `v13` throughout and is superseded
  on the number only; it is annotated rather than rewritten (the D42/D94/D102 precedent).**
- [`../ImplementationSpecs/ImplementationSpec-6-3.md`](../ImplementationSpecs/ImplementationSpec-6-3.md)
  — normative on ordering, guards and verification.
- [`Task-6-3-ExecutionPrompt.md`](Task-6-3-ExecutionPrompt.md) — the session starter, with the
  re-measured ground facts and the three discoveries §"Exact scope" rests on.
- [`../Investigations/6-1-D4-Pass.md`](../Investigations/6-1-D4-Pass.md) — **the measured evidence.
  Its item-2 finding answered the open question: the MCP server DOES connect to an auth-disabled
  Neo4j, so local mode survives its measurement.**
- Roadmap §6 **D33** (vault clauses), **D53**, **D58** (the one-live-call terms), **D55**, **D62**
  (FK rulings), **D76** (omit rather than stub), **D85** (the split-table precedent), **D92**,
  **D126**, **D128(a)**.

## Verified ground facts — measured 2026-08-08 at `842a7cc`

**⚠ RE-CONFIRM THESE AT THE MOMENT OF WRITING. Do not trust this table either** — every earlier
version of it was true when written and false by execution.

| Fact | Where | Value |
|---|---|---|
| `MIGRATIONS` | `src/main/services/storage.ts:171`, closes `:690` | **length 15**; last entry `// v15 (Phase 3h / D120)` at `:640` |
| `sqliteTable(` | `src/main/db/schema.ts` | **16** |
| `credential:delete` guard | `src/main/ipc.ts:1760–1797`, counts at `:1779–1780` | **exactly TWO dependents** |
| `countLaunchProfilesForCredential` · `countCouncilMembersForCredential` | `storage.ts:2273` · `:2368` | the accessor idiom; **the doc comment at `:2356–2367` is the one to imitate** |
| Key-set assertion (the 3-2 discipline) | `src/shared/ipc.test.ts:2132–2165` | the shape `memory:get`'s assertion must take |
| `IpcChannel` | `src/shared/ipc.ts:14–422` | **71 keys** |
| `ipcMain.handle(` | `src/main/ipc.ts` · `src/main/index.ts` | **63 · 0** |
| `failureMessage` | `src/main/services/vaultCore.ts` | callers `ipc.ts:580`, `councilMembers.ts:171`, `modelCatalog.ts:187` |
| `resolveLaunchProfile` / `ProfileResolution` | `src/main/services/launchProfiles.ts:185` / `:158–168` | the authored-reason precedent |
| `loadSeq` | `stores/settings.ts:37, 83, 91` · `stores/council.ts:239–245` | the supersede idiom |
| Boot band | `index.ts:403`, `:546`, `:595`, `:619` | `healOrphansAtBoot` · `reconcileAll` · `sessions.restore` · `before-quit` |
| The chip's host | `src/renderer/src/components/StatusBar.vue:17` | *"the graph-database chip ❌ that database is Phase 6 and does not exist"* |
| Runtime deps | `package.json` | **7**; no `neo4j-driver` |
| Baseline | — | typecheck **0** (node + web) · vitest **1476 / 41 files** · `grep:secrets` clean (6 patterns) |

## Goal

A project can be pointed at **an existing, already-running Neo4j**, Chorus can prove it reaches it on
one user-initiated click, and the status chip D76 deliberately omitted from Phase 3c comes back
**because it finally has a data source.** No container, no provisioner, no graph schema yet — **Stage
2 exists so Stage 3's schema work can be proven against a real graph without simultaneously debugging
container lifecycle** (D91's load-bearing ordering choice).

## ⚠ Local mode only — what D128(a) deleted from this task

**CR-6.0 returned `REVISE` on Q3 and attached eight preconditions to credentialed memory. D128(a)
took the honest consequence: credentialed mode leaves Phase 6 entirely.** Local mode is **measured
working** (6-1's D4 pass) and needs none of them. **This task got smaller, and that is the gate
working.**

Consequences, each of which contradicts something an earlier draft of this document asked for:

- **No `auth_mode: 'credential'` code path**, no confirmation gate, no restricted-profile indicator,
  no executable-resolution verification.
- **`secretEnv` stays empty, so the H3 policy flip (`src/main/adapters/env.ts:142`) cannot fire.**
  **No H3 disclosure in the UI** — disclosing an impossible event is the placeholder D76 forbids.
  `LaunchOptions.secrets` is not exercised here either.
- **`countProjectMemoryForCredential` and the third count in `credential:delete` are CUT.** See
  §"The cut, and the debt it leaves" below — **the cut is not free and the debt has a home.**
- **No restore-parity check.** *"A session credentialed only by way of memory"* has no subject in
  local mode; the F26-shaped check travels with credentialed mode.
- **`memoryService.ts` does not import `vault`.** It is *"the only module that decrypts"* in a future
  where something decrypts; **in this phase nothing does.**
- **`assertNoSecretInRendered` (6-2) is not exercised.** This task writes no CLI config file and
  emits no MCP argv — that is 6-5. Say so rather than inventing a call site.

## Exact Scope

**Create:**
- `src/main/services/memoryConfigCore.ts` + `.test.ts` — **pure.**
- `src/main/services/neo4jClient.ts` — the driver shell.
- `src/main/services/memoryService.ts` — config read/write and the test path.
- `src/renderer/src/stores/memory.ts` + `.test.ts`

**Edit:**
- `src/main/db/schema.ts` — `project_memory` (**16 → 17**).
- `src/main/services/storage.ts` — migration **v16** (**15 → 16**) and the accessors.
- `src/shared/ipc.ts` + `.test.ts` — the **five** `memory:*` channels and their Zod pairs
  (**71 → 76**).
- `src/main/ipc.ts` — the handlers.
- `src/preload/index.ts` — the forwarders (**no Zod — CSP**).
- `src/renderer/src/views/ProjectSettingsView.vue` — the memory surface (see the ruling below).
- `src/renderer/src/components/StatusBar.vue` — the chip, **and its header comment at `:17`**.
- `package.json` — `neo4j-driver`, **the only dependency this phase adds** (**7 → 8**).

### ⚠ RULING — the surface goes in `ProjectSettingsView.vue`, not a new Settings route

**Pending ratification. D128 is the highest decision at `842a7cc`, so D129 is the next free number;
re-check before using it.**

The spec originally said *"`SettingsMemory.vue` is a new Settings route beside Credentials and
Providers."* **That structure does not exist.** `SettingsView.vue` is 78 lines with exactly one nav
entry (`:55–58`), no router and no switching; `SettingsCredentials.vue` is not a route but a child of
`SettingsProviders.vue` (`:11`, `:1004`). Meanwhile **`ProjectSettingsView.vue` arrived in Phase 3h**
(`882dec3`) as a per-project full-window view reached from the rail gear and from `Add project` — and
**`project_memory` is keyed by `project_id`.**

A global route would need a project selector duplicating the rail, and would cost a navigation
mechanism no phase has built, to reach a per-project fact from a global screen. **The spec is not
wrong, it is stale — it predates `ProjectSettingsView.vue`.** Read both files before accepting this;
**if the code contradicts it, the code wins.**

## Non-Goals

- **⚠ NO PASSWORD COLUMN ON `project_memory`, IN ANY FORM, EVER.** A credentialed mode **names** a
  `credential_profiles` row; the secret stays in the DPAPI envelope. **A `password`, `secret`,
  `token`, `auth_value`, `key` or `blob` column is an instant stop-and-report.**
- **⚠ NO CONTAINER WORK.** No `dockerode` (**not** approved by D100), no `docker` CLI call from
  `src/`, no provisioning, no ports allocated. `container_id`/`container_name`/`volume_name`/
  `bolt_port`/`http_port` columns exist and stay **NULL** — they are Stage 5's, and they are here only
  because `MIGRATIONS.length` moves once.
- **⚠ NO GRAPH SCHEMA.** No constraints, no indexes, no `:ChorusSchema` node. `memory:seed` and
  `memory:validate` are **Task 6-4** and must not appear **even as stubs**. `schema_version` stays
  **0**. **No APOC anywhere** — measured absent from `neo4j:5-community`.
- **⚠ `memory:status` MUST NOT DECRYPT AND MUST NOT OPEN A BOLT SESSION.** It is pollable by a chip.
  Getting this wrong turns the chip into a **15-second unattended-decrypt loop**, which D33/D53/D58
  forbid outright. **This is the single most dangerous line in the task.**
- **⚠ AND POLLABLE IS NOT A REASON TO POLL.** In Stage 2 there is no container, so the configured
  state cannot change behind the app's back. **No timer** — read on project switch and after
  configure / disable / test, following `StatusBar.vue`'s `worktreeCount` watch (`:69–91`).
- **`memory:test` is ONE live connect, user-initiated only** — no boot hook, no timer, no restore
  path, no retry (D58's terms verbatim).
- **Do not render a number without its denominator** (D55), and **do not stub the chip** for a
  project with no memory — render **nothing at all** (D76).
- **Do not touch `env.ts` at all.** D128(b) refuses the `APPDATA`/`LOCALAPPDATA` addition on D88's
  three-lists rule; **F48** holds the evidence for whoever eventually needs it.
- **Do not add a second read path** over anything `storage.ts` already reads.
- **Do not revert or commit unrelated changes.**

## Dependencies

**6-2, hard — and it has landed.** `assertNoSecretInRendered` exists at
`src/main/adapters/mcpConfigCore.ts`. This task does not exercise it (see above), but 6-5 does, and
the ordering premise stands.

## Step-by-step Work

1. **Assert `MIGRATIONS.length + 1 === 16` before appending. STOP on divergence** — do not renumber
   (spec §1). Measured **15** at `842a7cc`. **This number has decayed twice; the rule outranks it in
   both directions.**
2. `project_memory`, with the FK rulings spelled out and **the debt note in the SQL** (spec §1, §2).
3. `memoryConfigCore.ts` — pure (spec §3).
4. `neo4jClient.ts` and `memoryService.ts` (spec §4).
5. **The five channels** (spec §5).
6. The store, the surface, the chip (spec §6).
7. **G2 against a real Neo4j** (spec §7).

## The cut, and the debt it leaves

**`countProjectMemoryForCredential` is CUT, along with the third count in `credential:delete`.**
With credentialed mode out of the phase, `project_memory.credential_profile_id` is **always NULL**:
the FK can never be violated, the guard can never be reached, and the function would have **no
caller**.

**⚠ THE COUNTER-PRECEDENT IS REAL AND IS ANSWERED RATHER THAN IGNORED.** `storage.ts:2378–2384`
records the `attention_spans` precedent — a table and its accessors deliberately shipped **one task
before** their only writer, so the phase's schema churn stays in one migration. **That does not reach
this case:** there the writer was one task away inside the same phase; here it left the phase
entirely with eight preconditions attached. Shipping the guard now means shipping a refusal message
nobody can ever read, in a phase that cannot test it.

**⚠ BUT THE DEBT MUST BE CARRIED, AND ITS HOME IS THE MIGRATION COMMENT.** The SQL on
`credential_profile_id` must state that **whoever ships credentialed memory MUST add
`countProjectMemoryForCredential` to `credential:delete`'s existing guard (`ipc.ts:1779`) BEFORE the
first credentialed row can be written** — or the first delete of a memory credential surfaces a raw
`SQLITE_CONSTRAINT_FOREIGNKEY` through a flow that has worked since Task 3-2. That is the defect
**D62** records and **3a-5 already paid for once**. *A column with an enforced FK and no counterpart
guard is a loaded trap; the comment is what disarms it.*

## Test Expectations

- **`memoryConfigCore` exhaustively** — it is pure, so it is cheap: mode vocabulary and the authored
  unsupported-mode reasons, bolt-URI validation and normalisation, **the inline-credentials
  refusal**, the port extractor, port ranges, and **Docker-legal container/volume naming from a
  project slug** (`[a-zA-Z0-9][a-zA-Z0-9_.-]*`), all with the `resolveLaunchProfile` precedent's
  authored reasons rather than booleans.
- **`ipc.test.ts`'s key-set assertion extended for `memory:get`**, in the `:2132–2165` shape
  including the `/key|secret|token|blob|fingerprint|password|value/i` loop. ⚠ **That assertion is the
  discipline that catches a password field being added later** — it is why D85's headcount test was
  *updated* rather than relaxed.
- A store case: a superseded load does not overwrite a newer one (the `loadSeq` idiom).
- **A structural test that `memory:status`'s handler opens no bolt session** — an injected driver
  factory that throws if called, not a comment.
  - **⚠ AND THE TEST MUST STATE ITS OWN LIMIT.** The original instruction was to assert the handler
    touches *"neither the vault nor the driver"*. **In this phase the vault half is vacuous** —
    `memoryService` does not import `vault` at all — so assert the driver half and say in the test
    that the vault half becomes load-bearing only when credentialed mode arrives. **A test that looks
    stronger than it is, is a false green**, which is the failure this phase has already been burned
    by once.
- **Never fewer than 1476 across 41 files.** ⚠ **F50: `adapters.test.ts` flickers** — re-run before
  diagnosing a regression.

## Verification Commands

```bash
npm run typecheck && npx vitest run && npm run grep:secrets
```

```bash
grep -c "sqliteTable(" src/main/db/schema.ts                          # 17
grep -n "// v16" src/main/services/storage.ts                         # present
grep -c "ipcMain.handle(" src/main/index.ts                           # 0
grep -riE "password|secret|token|auth_value|blob" src/main/db/schema.ts  # NOTHING in project_memory
grep -rn "memory:seed\|memory:validate" src/                          # NOTHING — Task 6-4's
grep -rn "countProjectMemoryForCredential" src/                       # NOTHING — cut; the debt is in the migration COMMENT
grep -rn "decryptForLaunch" src/main/services/memoryService.ts        # NOTHING
node -e "console.log(Object.keys(require('./package.json').dependencies).length)"   # 8
git diff -- package.json                                              # neo4j-driver ONLY
```

`IpcChannel` count — expect **76**:

```bash
node -e "const s=require('fs').readFileSync('src/shared/ipc.ts','utf8').split('\n');const a=s.findIndex(l=>l.startsWith('export const IpcChannel'));let b=a;for(let i=a+1;i<s.length;i++){if(/^\}/.test(s[i])){b=i;break}}console.log(s.slice(a+1,b).filter(l=>/^\s+[A-Za-z]\w*:\s*'/.test(l)).length)"
```

## Acceptance Criteria

- [ ] Gates green; vitest **≥ 1476 across 41 files**; `sqliteTable(` **17**; `MIGRATIONS.length`
      **16**; `ipcMain.handle(` in `index.ts` still **0**; `IpcChannel` **76**.
- [ ] **`project_memory` has no password-shaped column**, and the migration SQL carries **both** the
      no-password comment and the credentialed-mode debt note.
- [ ] **The 15 pre-existing migration entries are byte-identical.**
- [ ] `memory:status` **provably** opens no bolt session, and its test states which half of the
      assertion is vacuous and why.
- [ ] **G2: `memory:test` reaches a REAL Neo4j and returns `RETURN 1`.** *"A memory chip that renders
      is not a memory graph that answers."* **⚠ `verifyConnectivity()` is NOT sufficient evidence** —
      the D4 pass measured a handshake succeeding on every failing row of the connect matrix.
- [ ] A deliberately wrong port returns an authored refusal using the `vaultCore.failureMessage`
      vocabulary — **never a URI, never a driver stack trace, never a raw Neo4j error code.**
- [ ] The chip renders **nothing** for an unconfigured project, and there is **no polling timer**.
- [ ] `neo4j-driver` is the **only** dependency added, **with its resolved version in the commit**.
      (`npm view` on 2026-08-08: **6.2.0** latest, **5.28.3** on the `latest-5.28` line. D100 approved
      the package, not a version — say which line was taken and why.)
- [ ] **`before-quit` disposes the driver** — confirm no lingering handle keeps the process alive.
- [ ] **Every D128(a) deletion is named in the report as taken, not silently skipped.**

## Review Checklist

1. **`grep` the schema for password-shaped columns.** First thing, every time.
2. **`MIGRATIONS.length` is 16 and nothing was renumbered.** Diff the existing 15: byte-identical.
3. **`memory:status` touches no driver** — read the handler and the test, not the comment.
4. **No URI in any log line or reason string.** `neo4jClient.ts` never logs one — plan §9 says so and
   a bolt URI can carry credentials inline.
5. **The chip is absent, not empty, when there is no config** (D76), and **no timer polls it**.
6. **`package.json` gained exactly one runtime dep.**
7. **No `memory:seed` / `memory:validate`, not even as stubs.**

---

## Amendment provenance

**⚠ THIS SECTION IS THE RECORD, AND IT IS KEPT RATHER THAN TIDIED AWAY.** The corrections above were
not cosmetic: two of them were caught by a rule rather than by a reader, and that is the whole
argument for the rule.

| When | What changed | Why it matters |
|---|---|---|
| **2026-07-28** (`3fa295d`) | Authored. `MIGRATIONS.length` **12**, migration **v13**, vitest **1055 / 30**. | The original ground state. |
| **2026-08-01** | **v13 → v14.** `v13` was spent by unrelated work (`projects.color` + `projects.description`, `schema.ts:20`) **while this phase waited**. | **The first time in the project's history that a waiting phase's fixed migration number decayed.** The stop-on-divergence rule fired at an architect pass instead of at execution — the cheaper of the two. |
| **2026-08-08** (Task 6-1, at `84dcf54`) | **v14 → v16.** Phase 3h spent v15. Baselines restated: vitest **1305 / 39**, `IpcChannel` **68**, `ipcMain.handle(` **62 / 0**, deps **8 → 7**. | **The number decayed a SECOND time.** Which is why the assertion, not any recorded number, is the authority. |
| **2026-08-08** (CR-6.0 → **D128(a)**) | **Credentialed mode left Phase 6.** The `auth_mode` credentialed branch, the confirmation gate, the restricted-profile indicator, executable-resolution verification, the H3 disclosure, the restore-parity check, and **`countProjectMemoryForCredential`** all deleted from this task. | **A scope cut taken because a council refused something — which is what a gate is for.** The eight preconditions travel with the mode. |
| **2026-08-08** (at `842a7cc`) | **Amendments folded into the body.** Baselines re-measured: vitest **1476 / 41**, `IpcChannel` **71**, `ipcMain.handle(` **63 / 0**, `MIGRATIONS.length` **15** (assertion **holds**). Citations corrected: `storage.ts:75/95` → **`:171`**; `ipc.ts:1515–1516` → **`:1779–1780`**; `types.ts:170/174` → **`:199`** (6-2 added a second at `:238–239`). Three discoveries added: **no Credentials route exists**, **`ProjectSettingsView.vue` is the right host**, and **"six channels" was five**. | The amendment block itself had gone stale in the eight days it existed. **Documents in this phase decay in days, not months.** |

**⚠ THE STANDING RULE, RESTATED BECAUSE IT HAS NOW BEEN LOAD-BEARING THREE TIMES:** assert
`MIGRATIONS.length + 1 === 16` in code before appending, and **STOP AND REPORT on divergence rather
than renumbering.** A renumbered migration silently re-runs against an already-migrated database. The
rule governs in both directions — if the tree has moved backwards and the assertion fails low, that
is still a stop, not an adjustment.
