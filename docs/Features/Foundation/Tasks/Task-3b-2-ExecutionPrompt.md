# Task 3b-2: `council_members`, the Run Tables, and the Configuration UI — Execution Prompt

## Role

You are the Coordinator for Chorus — Foundation **Phase 3b, Task 3b-2** (the council's schema and its Settings surface). This is **Task 2 of 4** in the phase, and **the phase's only migration**.

Repo root: `C:\Projects\ContactEstablished\Chorus`

Expected branch: `main` — confirm with `git branch --show-current`; do **NOT** switch or create branches without instruction.

**Expected HEAD: `2a3d174`** (`Roadmap: Task 3b-1 is done…`). The last commit to touch `src/` is **`e7ca62a`** (Task 3b-1 — the api-mode session primitive), with `6d9ba2c` a comment-only docstring follow-up on top of it. Confirm both yourself:

```powershell
git log --oneline -5
```
```powershell
git log --oneline -3 -- src/
```

If `src/` has moved past `6d9ba2c`, **stop and report before writing a line.**

Platform: Windows 11, PowerShell 7.

Chorus is a local-first, BYOK Electron + Vue 3 + TypeScript desktop app for running multiple AI coding agents in parallel terminal panes. Windows-only v1.

---

## Goal

Give a council somewhere to live: **who its members are, what a run was, and what was said.** Three tables in one atomic migration (**v11**), the storage accessors and pure core that serve them, four IPC channels, and a Settings surface to manage the first table.

**Nothing orchestrates anything in this task.** `council_runs` and `council_messages` are created **empty** and get their first writer in Task 3b-3 — the `attention_spans` precedent, where a table shipped one task before its consumer.

**This task makes NO API call. Its cost envelope is $0.00, and any spend is a scope breach to report.**

### One Commit in This Session

**ONE intentional narrated commit (G3).** If a pre-existing defect surfaces, **raise it rather than folding it in**.

---

## ⚠⚠ STOP — the roadmap's own Phase 3b line describes this table WRONG, and it is the failure you are most likely to make

The roadmap's Phase 3b scope line and the Phase-3b-Overview's four-task table both say a council member is:

> *"credential profile + base URL + model id + role + params"*

**That phrasing predates D48 and D56 and it is superseded.** `provider_configs.base_url` is the route's one home (D48); `credential_profiles.provider_id` already points a credential at its route. **A `base_url` column on `council_members` would be a second home for the route** — precisely what D48 exists to prevent and what D56 made normative.

**Therefore, and this is binding:**

| The doc's phrasing says | Build instead | Why |
|---|---|---|
| `base_url` on the member | **NO `base_url` column** | The route is reached through `credential_profiles.provider_id → provider_configs.base_url`. D48's one-home rule. |
| *(implied)* a `provider_id` too | **NO `provider_id` column either** | Unlike `launch_profiles`, which needs both because **D33 clause 9** makes a route-without-credential first-class, **a council member always authenticates**. Storing both columns creates a class of row where they can disagree. |

**`council_members` stores `credential_profile_id` and derives everything else through it.** `ImplementationSpec-3b-2.md` §1 is the authority on the DDL and it already reflects this; the roadmap line does not.

This is **Review Checklist item 1** in `Task-3b-2.md` for a reason: *"it is the failure this task is most likely to make while looking reasonable."*

---

## ⚠ STOP — the FK ruling splits three ways and inverting it breaks flows that have worked for months

**F16 is a verified ground fact: SQLite foreign keys are ENFORCED on this machine.** better-sqlite3 12.11.1 sets `PRAGMA foreign_keys=ON` on every connection by default. Deleting a referenced parent row **throws `SQLITE_CONSTRAINT_FOREIGNKEY`**.

**D62 (RESOLVED 2026-07-26)** records why three tables in one phase took two opposite rulings:

| Table | FK | Reason |
|---|---|---|
| `council_members.credential_profile_id` | **real `REFERENCES credential_profiles(id)`**, RESTRICT | A member is a **live instruction**. The FK's job is to make the refusal **MANDATORY, not to author it** — main counts and refuses **before** the statement runs. |
| `council_runs` — every column | **NONE** | A run is a **historical fact**. `dispatches` (v7) and `model_catalog` (v9) took the same ruling. |
| `council_messages` — every column | **NONE** | A transcript stays true after its member is deleted. A FK here would make deleting a member **throw for every run it ever joined**. |

Because SQLite will not cascade a soft pointer, **`deleteCouncilRun(id)` purges its own `council_messages` inside one transaction** — the `deleteProviderConfig` → `model_catalog` precedent, where a cache must never break a user flow.

**Get this inverted and you produce two distinct bugs that both surface as `SQLITE_CONSTRAINT_FOREIGNKEY` in flows working since Task 3-2.**

---

## ⚠ STOP — F31 is SOLVED and its fix is MANDATORY for the rehearsal

**`--user-data-dir` reaches the real database but NOT the DPAPI context unless you bring the key with it.**

`safeStorage` blobs are wrapped with **Chromium's OSCrypt key, stored in `<user-data-dir>/Local State`**. Copy `chorus.db` without it and **every pre-existing credential blob is undecryptable** while blobs written in that same boot decrypt fine — an asymmetry that cost Task 3a-3 an hour.

**Copy `Local State` beside the database for every rehearsal or copy-DB run. Treat a credential blob as bound to the user-data DIRECTORY, not just the Windows user.**

**Probe decryptability EARLY.** Precedents: `_verify/3a-4/eval-vault-probe.js`, `_verify/3b-1/eval-vault-probe.js`. **If `OR milestone key` does not decrypt: STOP and ask Matthew to re-enter it through the running app's Settings UI.** That is a **human** step. **Never ask for a key's text in chat, never read it from a file, never accept it in any form, never write it to disk yourself.**

---

## Ground Yourself First

Read these before editing anything. Paths are relative to repo root.

- `CLAUDE.md` — locked stack; **D1** Zod-in-main; **D14** plain-object IPC; secrets via safeStorage, never in argv/logs/transcripts.
- `docs/Features/Foundation/Tasks/Task-3b-2.md` — **GOVERNS SCOPE.** Read all of it, including the five-item Review Checklist at the end.
- `docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-3b-2.md` — **GOVERNS EXACT CONTENTS.** §1 (the v11 DDL verbatim, plus §1.1's column-by-column nullability argument), §2 (the Drizzle mirror), §3 (the storage accessors), §4 + §4.1 (the pure core and the management refusal at both ends), §5 + §5.1 (IPC by symbol and the one added count), §6 (the renderer's two must-gets), §7 (verification specifics).
- `docs/Features/Foundation/Tasks/Phase-3b-Overview.md` — the phase contract, the file-ownership matrix, the gates, the standing conditions. **⚠ Its four-task table repeats the superseded "credential profile × base URL × model id" phrasing — see the STOP section above.**
- `docs/Features/Foundation/roadmap.md` — §5 (**F16**, **F20**, **F27**, **F31**, **F34**, **F35**), §6 (**D1, D7, D14, D33, D43, D48, D56, D57, D60, D62, D63, D64**), §7 Phase 3b.
- `docs/PLAN.md` §6 (credentials/providers/BYOK), §13 (target data model).
- **`docs/Features/Foundation/Tasks/Task-3b-1-ExecutionPrompt.md`** — the immediately prior session's prompt. Its harness caveats are the closest thing to current, and its **format is the house style for the report you owe**.
- **`docs/Features/Foundation/Tasks/Task-3a-5-ExecutionPrompt.md`** — the last session that shipped a migration **and** a credential-delete guard. Its rehearsal and three-dump procedure is the closest procedural precedent you have.

### Code to Inspect — anchored to NAMED SYMBOLS

All verified present by the coordinator **2026-07-26 at `6d9ba2c`**. Line numbers appear only where this prompt quotes a specific fact, and were current at authoring time — **re-locate by symbol, do not trust the number.**

**Migration + schema**

- **`src/main/services/storage.ts`** — `const MIGRATIONS: string[]` opens at **line 44**; the array currently holds **10** entries and closes just before the `SQLite-backed persistence` docblock. The **v10 `launch_profiles` entry** is the shape precedent you are mirroring: `id` PK, `label TEXT NOT NULL UNIQUE`, real `REFERENCES` on `provider_id` and `credential_profile_id`, nullable `model`, `created_at`/`updated_at`. Read the **comment block above v10 (around lines 213–270)** — it already narrates the D56 precedence order and the `dispatches / model_catalog | launch_profiles` FK split you are extending.
- **`src/main/services/storage.ts`** — the migration runner, `for (let version = applied + 1; version <= MIGRATIONS.length; version++)` at **line 1387**, applying `MIGRATIONS[version - 1]` inside a transaction. **This is why the migration is ONE entry:** splitting into three would let a partial failure leave the schema half-built with `schema_migrations` disagreeing.
- **`src/main/db/schema.ts`** (364 lines) — twelve `sqliteTable(` declarations, `launchProfiles` last at **line 322**. Mirror v11 **column for column**. **D7: Drizzle for types and queries only — never drizzle-kit, never a generated migration.**

**Storage accessors — the precedent set to mirror**

- **`src/main/services/storage.ts`** — `listLaunchProfiles` (**1259**), `getLaunchProfileById` (**1263**), `getLaunchProfileByLabel` (**1267**), `createLaunchProfile` (**1271**), `updateLaunchProfile` (**1280**), `deleteLaunchProfile` (**1287**), `countLaunchProfilesForProvider` (**1297**), **`countLaunchProfilesForCredential` (1307)**. Rows in, rows out; **every policy decision lives in the caller or in a pure core, never here.**
- **`src/main/services/storage.ts:275`** — the existing comment recording that `countLaunchProfilesForCredential` runs **BEFORE** the delete statement. Your new count joins it.
- `deleteProviderConfig` — purges `model_catalog` rows in its own transaction. **This is the precedent for `deleteCouncilRun` purging `council_messages`.**

**The pure core to mirror**

- **`src/main/services/launchProfiles.ts`** (404 lines) — Electron-free, storage-free, `fetch`-free, clock-injected. Read `ProfileRowLite` (**65**), `ProviderRowLite` (**78**), `CredentialRowLite` (**89**), `ShapeCheck` (**278**), **`validateProfileShape` (289)**, `defaultProfileLabel` (**364**). Your `src/main/services/councilMembers.ts` mirrors this file's shape exactly.
- **`src/main/services/launchProfiles.test.ts`** — the test-table style for the new core's tests.

**IPC**

- **`src/main/ipc.ts:339`** — the nested **`resolveCredential(profileId, agent)`** inside `registerIpc`: five ordered refusals, label-only messages, and the **management refusal that sits BEFORE decryption** (`ipc.ts:383–396`, the message reading `Credential profile '<label>' is an OpenRouter management key and cannot be used to launch an agent.`). **This is the wording and ordering your management refusal mirrors. You never fork this function.**
- **`src/main/ipc.ts:1278–1298`** — the **existing** `CredentialDelete` handler, with 3a-5's `const usedBy = storage.countLaunchProfilesForCredential(id)` at **1289** and the comment above it explaining why counting precedes the statement. **You add one count here. You do not add a new guard and you do not replace the existing one.**
- **`src/shared/ipc.ts`** — `export const IpcChannel` currently holds **45** keys; `CredentialDelete: 'credential:delete'` at **line 83**; `credentialDeleteRequestSchema` / `credentialDeleteResponseSchema` around **748–754**.
- **`src/preload/index.ts`** — Zod-free typed forwarders only. **⚠ Zod in preload throws `EvalError` under CSP and silently drops events — validate in main only (D1).** `index.d.ts` is never hand-edited.

**Renderer**

- **`src/renderer/src/views/SettingsProviders.vue`** (765 lines) — **this is where launch profiles already live**, not a separate file: `void settings.loadLaunchProfiles()` at **342**, `settings.renameLaunchProfile(...)` at **354**, `settings.deleteLaunchProfile(...)` at **364**. Add the council-members section here (or a sibling settings surface, your call — but do not invent a new route).
- **`src/renderer/src/stores/settings.ts`** (313 lines) — the **`loadSeq` supersede token** (declared **32**, used **75/83/88/151/154/157**) and the refusal convention: **every action returns `Promise<string | null>` — a refusal reason, or `null` on success** (`createProvider` 108, `deleteLaunchProfile` 181, `deleteProfile` 243). Follow both.
- **`src/renderer/src/views/SettingsCredentials.vue:190–196`** — the **disabled-not-hidden** precedent for `unavailableSince`, rendered as `unavailable since <rel> — re-enter the credential`, **naming the credential by label only**.
- **`src/main/services/vaultCore.ts:95`** — `failureMessage(kind, label)`, the **label-only vocabulary** your `unavailableReason` must use.
- **`src/renderer/src/stores/settings.test.ts:80`** — *"never retains a key: deep scan of `$state` after createProfile"*, which serializes `store.$state` and asserts no substring of a fake key survives. **This test must still pass.**

### Git checks to run first

```powershell
git branch --show-current
```
```powershell
git status --porcelain
```
```powershell
git log --oneline -3 -- src/
```

---

## Pre-Existing Changes — the tree is CLEAN, and two files the task docs warn about DO NOT EXIST

**`git status --porcelain` at prompt time returns EMPTY. The working tree is clean.**

There is nothing to preserve, nothing to avoid staging, and **any dirt you find is something you or a tool created — account for it.**

**⚠ Two corrections to the task docs, verified by the coordinator 2026-07-26:**

1. **`TASK-3-5-REVIEW-FABLE.md` and `TASK-3-6-REVIEW-FABLE.md` DO NOT EXIST.** `Task-3b-2.md`'s Non-Goals and `Phase-3b-Overview.md`'s Standing Conditions both say *"do not commit, delete, or revert them"* — that instruction is **stale**. `git log --all` shows they were never tracked; they are gone from the working tree. **Do not go looking for them and do not recreate them.** The only `*-REVIEW-FABLE.md` at the repo root is **`TASK-3-4-REVIEW-FABLE.md`, which IS tracked and committed** — leave it alone.
2. **`_verify/` is entirely gitignored** (last line of `.gitignore`). Your `_verify/3b-2/` artifacts will never appear in `git status`. That is expected — but it also means **`npm run grep:secrets` is the only thing standing between a `_verify/` artifact and a leaked key**, and that script does scan `_verify/`.

**Still true and still binding:** the `wt-24b5c1fe` worktree fixture — directory `C:\Projects\ContactEstablished\.chorus\Chorus\wt-24b5c1fe`, row id `9ba9b0da-cecd-4960-815d-f36166cf8c00`, branch `chorus/Chorus/24b5c1fe` (confirmed present). **Row, directory and branch all stay.**

**D40: stage scope files EXPLICITLY by path; never `git add -A`.** Your commit stages only `src/` files.

---

## Decisions You Must Honour — all RESOLVED, none open

- **D7 (RESOLVED 2026-07-18)** — Drizzle for **typed queries only**. Migrations stay a hand-rolled `MIGRATIONS` array + `schema_migrations` runner. **Never drizzle-kit. Never a generated migration file.**
- **D14 (RESOLVED 2026-07-19)** — **plain-object IPC.** A Pinia object is a Vue reactive Proxy; structured clone rejects it with **`Error: An object could not be cloned`** and **no compile-time signal**. Snapshot with `JSON.parse(JSON.stringify(x))` and runtime-verify every new renderer→main payload.
- **D33 clause 9 (RESOLVED 2026-07-22)** — makes a launch profile with a **route and no credential** first-class. **It does not reach `council_members`**, because a member that cannot authenticate cannot deliberate. This is why the member has no `provider_id`.
- **D43 (RESOLVED 2026-07-24)** — **the label is not the identity.** `council_members.label` is `UNIQUE` and freely renameable; **every pointer stores the id.** A rename must have zero downstream consequences, and drive 3 proves it rather than asserting it.
- **D48 (RESOLVED 2026-07-24)** — **the ROUTE carries its own default model** (`provider_configs.model`, migration v6). The route's home is `provider_configs`; a second home is the bug this decision exists to prevent.
- **D56 (RESOLVED 2026-07-25, Task 3a-4 `3433c91`)** — **THE MODEL-PRECEDENCE ORDER, NORMATIVE:** (1) the profile's own `model` — the choice for THIS use · (2) `provider_configs.model` — this route's DEFAULT · (3) nothing emitted. **`model_catalog` is NEVER authoritative.** `council_members.model` takes rank 1. **Never back-written** — copying rank 2 into rank 1 is how the second home gets created by accident. **D56 has a third enforcement site in the UI: the model input stays free text with an additive suggestion list, never a closed `<select>`.** A dropdown sourced from `model_catalog` would make the catalog authoritative by UI construction, with nobody deciding to.
- **D57 (RESOLVED 2026-07-25)** — refresh ≠ Test key. Relevant here only as the standing warning behind the **"no test-this-member button"** non-goal: a test that cannot fail is worse than no test.
- **D60 (RESOLVED 2026-07-26)** — the no-unattended-decryption guarantee is stated by **credential CLASS**, not by call-site count: *no code path reachable without a user gesture may resolve a **LAUNCH** credential.* **Never restate it as a count** — that is the standing lesson. **This task adds no decryption call site at all.**
- **D62 (RESOLVED 2026-07-26, Task 3a-5 `341ea5c`)** — the three-way FK ruling above, **and** the record of the defect this task must not repeat: *3a-5 shipped a `launch_profiles` row that could be saved against a **management** route, was rendered as launchable, and would have launched credential-less on a route that cannot do inference.*
- **D63 (RESOLVED 2026-07-26, coordinator resolutions (a)–(g) Matthew-ratified 2026-07-26)** — CR-3b.0's producer ruling. Relevant here as a **boundary**: the primitive exists and is Task 3b-1's; **you write no transport and call no factory.**
- **D64 (RESOLVED 2026-07-26)** — (1) the council surface is a **view/route**, not a layout pane, which keeps **D45(3) entirely out of this phase**; (2) **one minted key per RUN** bounds cost — **3b-3's job, not yours**; (3) the deliberation-protocol `[CR]` is **deferred to Task 3b-3's kickoff, not waived**.
- **F27 (2026-07-24)** — the only honest redaction wording any doc in this phase may use: *"Chorus redacts registered exact values on ingest; it cannot redact values an agent derives, and it cannot redact content it was asked to read."* **Never** "agents cannot echo the key".

---

## Implementation Scope

**`Task-3b-2.md`'s Exact Scope governs; `ImplementationSpec-3b-2.md` governs contents. This is the summary.**

| Action | File | What |
|---|---|---|
| **EDIT** | `src/main/services/storage.ts` | **Migration v11** — spec §1's DDL, **ONE atomic entry** appended to `MIGRATIONS`. Plus the accessors: member CRUD, **`countCouncilMembersForCredential`**, and the run/message accessors **written now, first called in 3b-3**. `deleteCouncilRun` purges its own messages in one transaction. |
| **EDIT** | `src/main/db/schema.ts` | Three Drizzle tables + inferred `CouncilMemberRow` / `CouncilRunRow` / `CouncilMessageRow`, matching v11 **column for column**. |
| **CREATE** | `src/main/services/councilMembers.ts` | The pure core: `defaultMemberLabel(providerName, modelDisplayName)`, **`resolveMemberModel(member, providerRow): string \| null`** (D56's order, **the only place it is expressed**), `validateMemberShape(input, existingLabels, credential, provider)`. Electron-free, storage-free, `fetch`-free, clock-injected. |
| **CREATE** | `src/main/services/councilMembers.test.ts` | The unit table. |
| **EDIT** | `src/main/ipc.ts` | `council-member:list` / `:create` / `:update` / `:delete`, **plus ONE added count** inside the **existing** `CredentialDelete` guard. |
| **EDIT** | `src/shared/ipc.ts` | The four channels and their schemas; **`councilRoleSchema = z.enum(['member','arbiter'])`**; `councilMemberWireSchema`. |
| **EDIT** | `src/preload/index.ts` | Zod-free typed forwarders. |
| **EDIT** | `src/renderer/src/views/SettingsProviders.vue` (or a sibling settings surface) | List / create / rename / delete. |
| **EDIT** | `src/renderer/src/stores/settings.ts` | The actions, following the existing `loadSeq` supersede token and the `Promise<string \| null>` refusal convention. |
| **EDIT** | `src/shared/ipc.test.ts` | Schema coverage. |
| **CREATE (untracked)** | `_verify/3b-2/` | `dump-v11.js`, `rehearse-v11.js`, drive scripts. Gitignored. |

### The wire schema carries ids and labels ONLY

`councilMemberWireSchema`: `id`, `label`, `credentialProfileId`, `credentialLabel`, `providerName`, `model` (nullable), `resolvedModel` (nullable, **computed**), `role`, `available` (boolean), `unavailableReason` (nullable, **label-only vocabulary**, `vaultCore.failureMessage`'s wording).

**No key. No fingerprint. No base URL. No env var name.** All Zod in main (**D1**); plain objects across the bridge (**D14**); **every handler outbound-`.parse`s its response.**

### The delete guard — ONE added count, not a new guard

Inside the **existing** `CredentialDelete` handler, beside 3a-5's `launch_profiles` count:

```
count = countLaunchProfilesForCredential(id) + countCouncilMembersForCredential(id)
```

Refuse inline, **naming both counts distinctly** so the message tells the user what to remove. **Count BEFORE the statement runs (F16/D62)** — the FK exists to make the refusal mandatory, not to be the refusal.

### The management refusal — at create AND at resolve

`validateMemberShape` refuses at **create**; `resolveMemberModel`'s path refuses again at **resolve**. **Both, not either.**

**`auth_mode` is an unconstrained TEXT column**, so a management value can exist in the database before any UI produces it, and main never trusts the renderer. **A create-time-only check is defeated by a hand-edited row; a resolve-time-only check renders a member as usable and fails at the worst moment.** One without the other is 3a-5's defect (D62) repeated.

If a change seems to require another file — **especially `sessionManager.ts`, `apiSession.ts`, `sessionOutput.ts`, `scrubber.ts`, `vault.ts`, `registry.ts`, or any adapter implementation — stop and raise it.** That is a scope signal, not a detail.

---

## Strict Non-Goals

- **NO orchestration, no protocol, no `CouncilService`, no `councilCore.ts`.** That is 3b-3.
- **NO API calls of any kind.** This task never spends a cent. **Envelope $0.00.** Any spend is a scope breach to report.
- **NO `base_url` column and NO `provider_id` column on `council_members`** — see the first STOP section.
- **NO back-writing a route default into a member row** (D56).
- **NO second migration.** One entry, v11. **No drizzle-kit (D7).** No generated migration file.
- **NO run/message writes.** Both tables are created **empty** for 3b-3 — the `attention_spans` precedent.
- **NO "test this member" button.** It would be a live billable call, and D57 is the standing warning about tests that cannot fail. If wanted, it belongs where the transport lives.
- **NO enable/disable flag, no ordering column, no retention policy.** Membership of a run is a run-assembly decision (3b-3), not persisted state.
- **NO changes to `provider_configs` or `credential_profiles`** — no schema change, no `UPDATE`.
- **NO `CHECK` constraint on `role`.** Validated by `councilRoleSchema` in main, matching how `auth_mode` and `status` are handled everywhere else. A CHECK would put the vocabulary in two places and make widening it a migration.
- **NO new npm dependency.**
- **NO council view, no palette entry, no new route** — 3b-4 owns those.
- **NO change to `agentKindSchema`, `staticRegistry`, or anything under `src/main/adapters/`.**
- **Do not touch** the `wt-24b5c1fe` worktree fixture or `TASK-3-4-REVIEW-FABLE.md`.

---

## Required Workflow

Work as coordinator: **ground → implement → review the diff against the Implementation Spec → a code-quality pass → resolve findings → run the gates → narrate the commit.** **Do NOT push and do NOT open a pull request unless explicitly asked.**

Ordered work steps (`Task-3b-2.md` §Step-by-step governs):

1. **Read the shipped `MIGRATIONS` array and settle the number.** Expected **`MIGRATIONS.length + 1 === 11`**. Quote `SELECT version FROM schema_migrations` from the real DB as evidence. **Stop and report any divergence rather than renumbering silently.**
2. **Migration v11 + the Drizzle mirror**, one atomic entry. **Grep the entry immediately: exactly ONE `REFERENCES`, on `council_members.credential_profile_id`; ZERO on any run or message column.**
3. **⚠ REHEARSE ON A COPY BEFORE THE FIRST REAL BOOT** — `_verify/3b-2/rehearse-v11.js` against a copy of the real DB **with `Local State` copied beside it (F31)**. Precedent: `_verify/3a-5/start-rehearsal.ps1` + `_verify/3a-5/rehearsal-userdata/`. Assert all three tables created empty, every pre-existing table untouched, and **`length(encrypted_blob)` unchanged for all three credential rows**. *A migration that creates tables in a live database does not get its first run in production.*
4. **Storage accessors** — rows in, rows out.
5. **The pure core + its tests** before wiring anything. It is the part most likely to be subtly wrong and the cheapest place to be wrong.
6. **IPC + preload + store + the Settings surface.**
7. **The added count in `CredentialDelete`** — beside 3a-5's count, not replacing it.
8. **Tests, then the gates, then the three-dump protocol, then the six drives.**

---

## Verification Commands

Run from repo root in PowerShell.

```powershell
npm run typecheck
```
```powershell
npx vitest run
```
```powershell
npm run grep:secrets
```
```powershell
npm run dev
```

**Baseline to beat — coordinator-verified 2026-07-26 at `6d9ba2c`, by running each command:**

| Gate | Value |
|---|---|
| typecheck | **0 errors** (node + web) |
| vitest | **728 passed / 728, across 25 files** |
| grep:secrets | **clean (6 patterns over `src/`, `scripts/`, `_verify/`, `package.json`, root configs)** |
| `MIGRATIONS.length` | **10** → must become **11** |
| `ipcMain.handle(` in `src/main/ipc.ts` | **42** → expect **46** (four `council-member:*` channels) |
| `IpcChannel` keys in `src/shared/ipc.ts` | **45** → expect **49** |
| `sqliteTable(` in `src/main/db/schema.ts` | **12** → expect **15** |

**⚠ These are NOT the numbers in `Phase-3b-Overview.md`'s standing conditions.** That table records **phase start** (702/24, 41, 44) and Task 3b-1 has landed since. The table above is current. If the four handler/channel counts land differently, that is fine — **quote what you actually get and explain the delta**; the point is that you counted, not that you hit a predicted number.

### Grep gates — run before the commit, quote every count

- **exactly 1** `REFERENCES` in the v11 entry, on `council_members.credential_profile_id`; **zero** on any `council_runs` or `council_messages` column;
- **zero** `base_url` and **zero** `provider_id` in the `council_members` DDL;
- **zero** `UPDATE provider_configs` and **zero** `UPDATE credential_profiles` anywhere in the diff;
- **zero** `drizzle-kit` anywhere;
- `agentKindSchema` still `z.enum(['claude','codex'])`; `staticRegistry` still **two** entries; **`git diff -- src/main/adapters/` EMPTY**;
- **`src/main/services/sessionManager.ts` and `src/main/services/apiSession.ts` byte-identical**;
- `MIGRATIONS.length` **10 → 11**.

### The migration proof — the full three-dump protocol on the REAL DB

**The real dev DB is `C:\Users\matth\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\chorus\chorus.db`.** Electron ignores `APPDATA` but honours `--user-data-dir` — copy `_verify/3b-1/start-realdb.ps1` into `_verify/3b-2/`. **A dump quoting projects `a43b395d…`/`b684e96e…` is the scratch DB and discharges NOTHING; the real pair is `985d547b…` (Chorus) / `f47ac10b…` (Chorus-Second)** (**F20** — every dump must quote it).

**Rehearse on a copy first.** Then pre / post / boot-2 dumps, asserting with quoted evidence:

1. **v10 → v11 applied IN PLACE**, and **every prior `applied_at` byte-identical** pre and post;
2. **every pre-existing table row-identical** — with `dispatches` and `attention_spans` **exempted in advance** as append-only live telemetry (assert **no existing row moved**; this is the exemption 3a-5 declared in advance, and declaring it *after* seeing a diff is not the same thing);
3. **all three new tables created EMPTY**;
4. `council_members`' **`sqlite_master` DDL** carrying **one** `REFERENCES` and **`UNIQUE(label)`**;
5. **v11 NOT re-applied on boot 2**;
6. the **`wt-24b5c1fe` row intact**;
7. the **`projects` pair quoted** (F20);
8. **`length(encrypted_blob)` unchanged for all three credential rows.**

### The runtime drives (G2) — six drives, all free, none needs a completion

Drive the real window over CDP (`_verify/3b-1/cdp.js`, port 9222) against the real DB.

1. **Create three members and an arbiter** through the real Settings UI, on the standing **OpenRouter** route. Confirm rows land with the right `role` and a **NULL `model`** where none was given.
2. **The D56 inheritance proof** — a member with NULL `model` **resolves to `moonshotai/kimi-k3` at read time while its `model` column stays NULL in the database**. Quote both: the resolved value from the wire payload, and the raw column from a DB dump. **Shown, not asserted** — the proof is a column.
3. **The rename proof (D43)** — rename a member; confirm its **id is unchanged** and nothing referencing it moved.
4. **The referential-fragility proof (D62)** — with a member saved, attempt `credential:delete` on **`OR milestone key`** → **inline refusal naming the count**, no throw, **no `SQLITE_CONSTRAINT_FOREIGNKEY` anywhere in the log**. Delete the member, confirm the delete then proceeds, **then re-create both** — the OR route and its key are standing fixtures and must be restored.
   **⚠ DRIVE THIS ISOLATED.** 3a-5's own review records that an earlier run **proved nothing because the pre-existing `launch_profiles` guard fired first.** Use a credential that has **a council member and ZERO launch profiles**, so only the new count can produce the refusal.
5. **The disabled-not-hidden proof** — a member whose credential is unavailable (**`Claude fake key` carries `unavailable_since` and is a free live fixture**) renders **shown, disabled and explained**, naming the credential **by label only — no URL, no env var, no key fragment**.
6. **The management refusal** — attempt to save a member against **`OpenRouter admin`** (`auth_mode = 'management'`); confirm **refusal by label with no row written**.

**Standing fixtures on the real DB** (confirm against the database rather than this sentence): providers **`OpenRouter`** (api_key, model `moonshotai/kimi-k3`), **`Anthropic direct`**, **`OpenRouter admin`** (management); credentials **`OR milestone key`**, **`Claude fake key`** (carries `unavailable_since`), **`OR Management Key`**.

### Harness caveats — verified through 2026-07-26

- **electron-vite does NOT hot-restart the main process**; HMR covers the renderer only. **Every main-process change needs a real cold boot** — and this task is almost entirely main-process.
- **`sqlite3` is NOT installed** — use the `ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe` pattern. **Known flake: a dump script writes no file on its first invocation — retry once.**
- **CDP on `--remote-debugging-port=9222`** is the proven driver. **Wrap every `Runtime.evaluate` body in an IIFE** — top-level `const` collides across evaluates.
- **⚠ CDP-driven Vue forms need a microtask tick between `input` and the submit click**, or the click lands on a stale `:disabled` — **a silent no-op that reads exactly like a broken feature. This has caused a failed drive in three separate tasks.**
- **⚠ Vite's SPA fallback poisons CDP-driven file reads:** `fetch('some.txt')` inside the page returns `index.html`. Use `fetch('/@fs/C:/absolute/path')`.
- **Graceful quit:** `taskkill` **without** `/F` (WM_CLOSE) does **not** terminate the dev app. Use a CDP `window.close()` evaluate. Kill process **TREES** with `taskkill /PID <root> /T /F` for crash cases.
- **The dev window is NOT foregrounded by default** and other desktop apps steal foreground mid-run (F29). Foreground deliberately (`_verify/3b-1/focuswindow.ps1`) and verify before any screenshot check.
- All artifacts under `_verify/3b-2/`.

### ⚠ Standing condition — the dev vault holds REAL, BILLABLE credentials

`OR milestone key` (inference) and `OR Management Key` (management). **Never dump, echo, print, copy, or transmit `credential_profiles.encrypted_blob` or `fingerprint_hash`** — select non-secret columns explicitly and prove blob stability with `length(encrypted_blob)`. **Do not press "Test key" on `OR milestone key`** — it is a live billable call and **nothing in this task calls for it.** **No test, fixture, `_verify/` artifact, or log line may contain a real credential or key fragment**; `npm run grep:secrets` must pass over `_verify/3b-2/` too.

---

## Failure Honesty Clause

If any verification command fails for an unrelated environment reason, **capture the EXACT output, explain it, and DO NOT claim success.** An indeterminate result is reported as indeterminate and the affected acceptance criterion is marked **FAILED** — never reasoned into a pass. **An unproven claim is worse than an honest unknown, because it will be cited later as evidence.** Temporary instrumentation must be reverted, and the review checks the **COMMIT DIFF**, not the worktree.

**This applies with force to drive 4.** A refusal that fires because the *old* `launch_profiles` guard caught it first is **not** evidence for the new count, and 3a-5's review is the recorded precedent for exactly that false pass. If you cannot isolate it, say so.

---

## Final Reporting Requirements

Report a status of exactly one of **DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED**, plus:

- **The commit SHA and every file changed**, confirming the scope table above and nothing beyond it.
- **`MIGRATIONS.length` 10 → 11**, evidenced by `SELECT version FROM schema_migrations` on the real DB with the v11 `applied_at` quoted.
- **Typecheck / vitest / grep:secrets with actual numbers**, against the **0 / 728-across-25 / clean-6-patterns** baseline. Vitest must be **above** 728.
- **The rehearsal output, quoted**, from a copy-DB run **with `Local State`**, **before** any real boot.
- **The three-dump protocol**, with all eight assertions above discharged and **every exception enumerated in advance**.
- **All six runtime drives, each quoted** — especially **2** (NULL model column alongside the resolved value), **4** (the refusal naming the count, **no `SQLITE_CONSTRAINT_FOREIGNKEY`**, and **confirmation it was driven isolated**), and **6** (the management refusal by label with no row written).
- **The grep gate counts, each quoted** — the single `REFERENCES`, the zero `base_url` / zero `provider_id`, the empty `src/main/adapters/` diff, and the byte-identical `sessionManager.ts` / `apiSession.ts`.
- **The unit table**, including the four refusals (empty label, duplicate label, unknown credential, **a credential on a `management` route**), `resolveMemberModel`'s three-rank order, and `countCouncilMembersForCredential`.
- **Explicit confirmation the management refusal exists at BOTH create and resolve**, with the two call sites named.
- **Confirmation the settings-store deep-scan test (`settings.test.ts:80`) still passes.**
- **Confirmation of the narration requirements in the commit message:** **why `council_members` carries no `base_url` and no `provider_id`** (the D48/D56 one-home lineage, and that the roadmap's own phrasing predates it); **why the FK ruling splits three ways** (D62 — member live instruction, run and message historical fact); and **that `council_runs` / `council_messages` ship empty for 3b-3.**
- **Confirmation each non-goal held:** no orchestration; no `councilCore.ts` / `councilService.ts`; **no API call and $0.00 spent**; one migration only; no drizzle-kit; no run/message writes; no test-member button; no enable/ordering/retention columns; no `provider_configs` or `credential_profiles` change; no `CHECK` on `role`; no new dependency; no council view or palette entry; `src/main/adapters/` untouched.
- **Confirmation the fixtures were restored** (the `OR milestone key` credential and its member/route state) **and the restoration dumped**, and that the **`wt-24b5c1fe` row, directory and branch are intact**.
- **Confirmation `TASK-3-4-REVIEW-FABLE.md` is unmodified and unstaged**, and that **nothing under `_verify/` or `docs/` was staged or reverted**.
- **Actual cost, against the $0.00 envelope**, and confirmation Test key was never pressed against `OR milestone key`.
- **Residual risks and known gaps**, and the **final `git status --porcelain`**.
