# Task 3a-5: `launch_profiles`, the Dialog Default, and One-Click Relaunch — Execution Prompt

## Role

You are the Coordinator for Chorus — Foundation **Phase 3a, Task 3a-5** (`launch_profiles`, the dialog default, and one-click relaunch). **This task CLOSES Phase 3a.**

Repo root: `C:\Projects\ContactEstablished\Chorus`

Expected branch: `main` — confirm with `git branch --show-current`; do **NOT** switch or create branches without instruction.

**Expected code HEAD for `src/` at start: `3433c91`** (Task 3a-4 — `model_catalog` + refresh, effort normalization). One docs-only commit sits on top (`2c0f44a`, the roadmap update) and may be followed by this prompt's own commit; **no production code has changed since `3433c91`.** Confirm this yourself — if `src/` has moved, stop and report before writing a line.

Platform: Windows 11, PowerShell 7.

Chorus is a local-first, BYOK Electron + Vue 3 + TypeScript desktop app for running multiple AI coding agents in parallel terminal panes. Windows-only v1.

---

## ⚠⚠ STOP — the task's central invariant is ALREADY FALSE AS LITERALLY WRITTEN

**This is the single most important thing in this prompt. Read it twice before you read anything else.**

`Task-3a-5.md` §Step 6 and `ImplementationSpec-3a-5.md` §9.2 state the hard invariant like this:

> *"No code path reachable without a user gesture may call `vault.decryptForLaunch` … At `15a016e` there are exactly **two** call sites, both inside `registerIpc`. After this task there are exactly **three**, all inside `registerIpc`."*

and prescribe this structural check:

> *"`grep -rn "vault\|decrypt" src/main/index.ts` shows the vault **constructed and passed to `registerIpc`, and nothing else**."*

**Both statements are false at `3433c91`, before you write a line.** Verified by the coordinator 2026-07-26:

```
src/main/index.ts:171          const decrypted = await vault.decryptForLaunch(id)
src/main/ipc.ts:371            resolveCredential      (launch)
src/main/ipc.ts:1110           credential:test
src/main/services/modelCatalog.ts:196   model:refresh  (3a-4)
```

**Four production call sites, and one of them is in `src/main/index.ts`.** Trace it yourself — the chain is real and it fires at boot:

```
app.whenReady()
  └─ await attribution.reconcileOrphanedKeys()        src/main/index.ts:278
       └─ if (!this.deps.hasManagementKey()) return   dispatchAttribution.ts:390   ← TRUE on the real DB
       └─ await this.deps.keys.list()
            └─ await this.deps.getManagementKey()     openrouterKeys.ts:239
                 └─ await vault.decryptForLaunch(id)  src/main/index.ts:171
```

The real dev DB **has** a management credential (`OR Management Key` on provider `OpenRouter admin`, `unavailable_since` null), so `hasManagementKey()` returns **true** and **a cold boot decrypts a credential today, before the window exists, with no user present.**

### What this means for you, concretely — four consequences, none optional

**1. Do NOT "fix" this.** Task 3a-3 introduced it deliberately and argued it at length (read the comment at `src/main/index.ts:140–164`: *"resolved per use and never cached … nothing is decrypted at boot"* — that last clause is about *caching*, and the thunk genuinely does fire at boot). It is **out of scope**. Ripping out boot reconciliation to make a grep pass would break 3a-3's crash-reconciliation contract to satisfy a sentence written before 3a-3 existed.

**2. Restate the invariant precisely, and put the restatement in the commit message.** The distinction 3a-3 relies on is **credential class**, not user gesture. The honest invariant for this task is:

> **No code path reachable without a user gesture may resolve a LAUNCH credential** — an inference credential used to spawn a PTY. `SessionManager` contains **zero** vault references; `restore()` never decrypts anything; the credentialed session heals rather than relaunching. The **management** credential (`auth_mode = 'management'`) is a separate, higher-privilege class that cannot do inference, is refused by `resolveCredential` **before** decryption (`src/main/ipc.ts:339–356`), never reaches a child PTY, and is resolved at boot by 3a-3's attribution reconcile — deliberately, separately argued, and untouched here.

**If you find you cannot state the invariant in a way that is both true and strong, that is a §4 CR trigger — flag, brief, pause.** Do not weaken it silently to make a check pass. **An invariant restated to fit the code is not an invariant.**

**3. The runtime proof as specified WILL FAIL, and not because you broke anything.** Spec §9.2 says *"assert **ZERO** decrypt lines"* across the migrating boot. On the real DB that boot performs a management decrypt, so a naive counter reads ≥ 1 and you would be forced to either report FAIL or fudge it. **Redesign the instrumentation so it discriminates:** log the profile id **and its provider's `auth_mode`** at the top of `vault.decryptForLaunch` — e.g. `[probe] decryptForLaunch id=<id> authMode=<mode>`. Then the assertion becomes the one that actually matters:

- across a cold boot that **heals a credentialed session**: **zero** decrypts where `authMode !== 'management'`;
- after **one Relaunch click**: **exactly one**, with `authMode = 'api_key'`.

Quote both counts *and* the discriminated lines. **The instrumentation logs an id and a mode — never a plaintext, never a fragment, never the envelope.** Revert it before the commit and prove the revert against the **COMMIT DIFF**, not the worktree.

**4. There is no `running` session to heal — you must create one.** See correction #4 below. Without it the boot half of the proof is vacuous, and spec §9.2 explicitly warns that *"a boot log is defeated by a boot that had nothing to decrypt."*

---

## ⚠ STOP — two more preconditions before writing code

**1. The relaunch proof needs a credential that decrypts IN YOUR BOOT CONTEXT, and it may not (F31).**

`--user-data-dir` reaches the real database but **not the DPAPI context**. Task 3a-3 lost an hour to this: it booted from a raw harness shell, opened the right DB, and found that **credential blobs written the previous day failed to decrypt** — `[vault] decrypt failed; profile marked unavailable` — while a profile created in that same boot decrypted fine. `safeStorage.isEncryptionAvailable()` was `true` throughout. The mechanism is recorded as **UNPROVEN**; do not repeat a guess as fact.

- **Probe decryptability EARLY** — before building anything that depends on it — via `_verify/3a-3/eval-vault-diagnose.js` or `_verify/3a-4/eval-vault-probe.js`, or by observing whether a boot marks a profile `unavailable_since`.
- **This task needs TWO working credentials**, and that is more exposure than any prior task: `OR milestone key` (the real relaunch drive) **and** `OR Management Key` (or the boot half of the invariant proof is vacuous for a different reason — `hasManagementKey()` would short-circuit at `dispatchAttribution.ts:390` and no management decrypt would occur, which *also* makes the discrimination untestable).
- **If either does not decrypt: STOP and ask Matthew to re-enter it through the running app's Settings UI.** That is a **human** step. **Never ask for a key's text in chat, never read it from a file, never accept it in any form, never write it to disk yourself.** D33 clause 8 will already have marked the row `unavailable_since`; `replaceProfile` → `updateCredentialBlob` clears the mark on re-entry (proven in anger in 3a-3).
- **Tell him NOT to press "Test key"** while he is in there unless a step calls for it — it is a live billable call.

**2. This task SPENDS REAL MONEY. Task 3a-4's $0.00 envelope does NOT carry forward.**

The end-to-end drive launches a real agent on Matthew's OpenRouter account and **submits a prompt** — that is the point; a launch that answers nothing proves the argv, not the credential. **Envelope: one short prompt per launch, expected well under $0.05 total.**

Budget discipline, because Task 3a-3 overran its own envelope ($0.533 against `< $0.30`):
- **One** short prompt per drive that genuinely needs a completion. The five-surface check, the argv reads, the delete guards, the scoping proof, the dangling-profile drive and the legacy-sentinel refusal are **all free** — none needs a completion.
- **The relaunch drive needs exactly two completions**: one at launch, one after relaunch. Anything beyond that, stop and ask.
- **Do not press "Test key" on `OR milestone key`.**
- Report actual cost against the envelope.

---

## Goal

Make **one saved, user-named row** reproduce a whole agent launch — and make the session that ran under it relaunchable in one click, **with the user at the keyboard**, without ever teaching the app to decrypt a launch credential while nobody is there.

`Task-3a-5.md` §Goal gives five properties, each a way this can be built wrong while looking right. They are binding; read them there in full. In one line each:

1. **The label is not the identity** (D43) — every pointer stores the **id**; a rename has zero downstream consequences, and the drive proves it by renaming mid-flight.
2. **Two routes to one model are two rows**, not one row with a flag. Nothing may dedupe them.
3. **Referential fragility is designed for** — `launch_profiles` carries **real `REFERENCES`**, the deliberate inverse of 3a-1's `dispatches` ruling, with count-and-refuse authored in main.
4. **The retirement is a body swap, not a call-site rewrite** — `restore()`'s credentialed branch changes by one line. If it needs more, the design is wrong.
5. **No unattended boot-time decryption of a launch credential. Ever.** See the STOP section — the invariant is real, but it must be stated in the form that is *true at `3433c91`*.

**⚠ THE MOST IMPORTANT OUTPUT OF THIS TASK IS THE INVARIANT AND ITS PROOF, NOT THE FEATURE.** A summary that reports "relaunch works" without the discriminated zero-decrypt boot log has proven the feature and not the invariant, and `Task-3a-5.md`'s Review Checklist item 1 says to send it back.

### One Commit in This Session

**ONE intentional narrated commit (G3).** The two-commit amendment was Task 3a-1's alone (D54) and does not carry forward. If a pre-existing defect surfaces, **raise it rather than folding it in**.

---

## Ground Yourself First

Read these before editing anything. Paths are relative to repo root.

- `CLAUDE.md` — locked stack; **D1** Zod-in-main; **D14** plain-object IPC; secrets via safeStorage injected as env vars, never in argv/logs/transcripts; **D4** verify CLI flags against the tool's own `--help` at execution time.
- `docs/Features/Foundation/Tasks/Task-3a-5.md` — **GOVERNS SCOPE.** 424 lines; read all of it. The five Goal properties, the Exact Scope table, the Non-Goals, the nine Step-by-step items, the Test Expectations, the Acceptance Criteria and the Review Checklist are binding **except where the correction table below overrides them**.
- `docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-3a-5.md` — **GOVERNS EXACT CONTENTS.** 774 lines. Key sections: **§2** the migration (EXACT DDL, the column-by-column nullability argument, the `agent`-is-its-own-column reasoning, the JSON1-free data migration and the rejected `json_each` alternative) · **§3** `launchProfiles.ts`'s pure surface and the fail-safe predicate · **§4** storage accessors · **§5** IPC by symbol · **§6** `ipc.ts` insertion points · **§7** the one-line body swap · **§8** renderer · **§9** the runtime proofs · **§10** the grep gates.
- `docs/Features/Foundation/Tasks/Phase-3a-Overview.md` — the phase contract, the file-ownership matrix, the gates (G1–G5), and the standing conditions. **This task is the phase's last row.**
- `docs/Features/Foundation/roadmap.md` — §5 (**F16**, **F20**, **F26**, **F27**, **F29**, **F31**), §6 (**D7, D14, D16, D33, D40, D43, D45(4), D48, D49, D50, D53, D54, D55**), §7 Phase 3a.
- `docs/PLAN.md` §4 (adapter abstraction), §6 (credentials/providers/BYOK), §13 (the target data model).
- **`docs/Features/Foundation/Tasks/Task-3a-4-ExecutionPrompt.md`** — the immediately prior session's prompt. Its correction table and harness caveats are the closest thing to current, and its *format* is the house style for the report you owe.

### Code to Inspect — anchored to NAMED SYMBOLS, never line numbers

All verified present by the coordinator **2026-07-26 at `3433c91`**. (Line numbers appear only where this prompt is quoting a specific fact; anchor your edits to symbols.)

- **`src/main/index.ts` — `app.whenReady()`, and specifically the `managementProfileId` / `getManagementKey` thunk and the `attribution.reconcileOrphanedKeys()` call.** Read this **first**. It is the STOP section's subject and you cannot restate the invariant honestly without having read it.
- `src/main/ipc.ts` — the nested **`resolveCredential(profileId, agent)`** inside `registerIpc`: five ordered refusals, label-only messages, the management-mode refusal that sits **before** decryption, and the decrypt-at-use discipline. **You add a caller, never a second decrypt path.**
- `src/main/ipc.ts` — the **`IpcChannel.SessionLaunch`** handler: `LAUNCH_PANE_CAP = 16`, the absolute-path/`fs.existsSync` cwd **security boundary**, the existing `if (req.credential_profile_id)` block you extend, and **all three `storage.createSession({…})` call sites** (one per workspace mode — a missed branch is a session that silently loses its credentialed mark). Also `SessionRestart`, `SessionDelete`, `SessionLaunchContext`, `ProviderDelete`'s count-and-refuse, and `CredentialDelete` (**which has no guard at all today**).
- `src/main/services/storage.ts` — `const MIGRATIONS: string[]`, the private `migrate()` runner over `schema_migrations`, `getViewState`/`setViewState` (the `view_state:<projectId>` scoping precedent your last-used pair copies), `getSessionById`, `countCredentialProfilesForProvider`, `getProviderConfigById`, `getCredentialProfileById`, and the four symbols you **delete**: `getCredentialedSessionIds` (re-implemented, signature changes), `writeCredentialedSessionIds`, `markSessionCredentialed`, `unmarkSessionCredentialed`.
- `src/main/services/sessionManager.ts` — `restore(projectId)`'s credentialed branch (**the one line that changes**), `launch(agent, cwd, sessionId, opts)`, `isRunning`, and **`LaunchOptions`** — which already carries `effort?: EffortLevel` and `extraArgs?: readonly string[]` from 3a-4, with a comment naming **`launch_profiles` (3a-5) as effort's home**. That seam is this task. **`vault` appears ZERO times in this file and must still appear zero times after you finish.**
- **Pure-core precedents** (the module shape for `launchProfiles.ts`): `vaultCore.ts`, `computeRestoreSet` in `restore.ts`, `computeWorktreeReconcile` in `worktrees.ts`, 3a-3's `attributionCore.ts`, and 3a-4's `modelCatalogCore.ts`. **No `electron`, no `fetch`, no `node:fs`, no clock — time is a parameter.**
- `src/main/adapters/effort.ts` — **`resolveEffortArgs`** and `overridesEffort`. **Import; never re-declare.** `src/shared/ipc.ts` — **`effortLevelSchema`**, and note its values (see correction #10).
- `src/main/services/vault.ts` — `decryptForLaunch` (where the temporary probe line goes). `src/main/services/vaultCore.ts` — `failureMessage(kind, label)`, the label-only vocabulary. `src/main/services/logger.ts` — `scrubSecrets`.
- `src/renderer/src/components/LaunchDialog.vue` — `AuthChoice`, `authChoice`, **`selectedProfile`** (⚠ see correction #9 — this already means *credential* profile), `eligibleProfiles`, the `watch([selected, authChoice], …)`, the `watch(selectedProfile, …)` catalog fetch, `effort` / `effortLevels` (3a-4), `onMounted`'s `Promise.all`, and **`submit()`'s fresh-literal-of-primitives payload (the D14 defence, commented as such)**.
- `src/renderer/src/components/TerminalPane.vue` — `onRestart()`, `waitForExit`, `paneMessage`, `store.setBusy`, and the header button row. This is where **Relaunch** lands, beside Restart.
- `src/renderer/src/stores/settings.ts` — `SettingsState`, the store-level `loadSeq` supersede token, the `refuse(reason)` helper. **The existing deep-scan unit test over `$state` proving the store holds no key material must still pass.**

### Git checks to run first

```powershell
git branch --show-current
```
```powershell
git status --porcelain
```
```powershell
git log --oneline -3
```

---

## ⚠ The task doc and spec were authored against `15a016e` and are STALE in TWELVE places

Tasks 3a-1, 3a-2, 3a-3 and 3a-4 have all landed since. **These are the corrected facts, re-verified by the coordinator 2026-07-26 at `3433c91` and against the real dev DB.** Where a doc and this table disagree, **this table wins** — but confirm each yourself before acting on it.

| # | The docs say | Actually, now |
|:--:|---|---|
| **1** | The hard invariant: two `decryptForLaunch` sites, both in `registerIpc`; `index.ts` shows the vault "constructed and passed to `registerIpc`, and nothing else" | **FALSE at `3433c91` — see the STOP section.** Four production sites; one is in `src/main/index.ts` inside a boot-reachable path. **After your task: five.** Restate the invariant by credential class, redesign the probe to discriminate, and narrate it. |
| **2** | Migration is **v9**; MIGRATIONS has 6 entries | **`MIGRATIONS.length` is 9 → your migration is `v10`.** `schema_migrations` reads v1–v9 on the real DB. Confirm `MIGRATIONS.length + 1 === 10` before appending; **stop and report divergence** rather than renumbering silently. Everywhere the docs say "v9", read **v10**. |
| **3** | `settings['credentialed_sessions']` holds **two** ids | **NINE.** Verbatim, and all nine exist in `sessions`: `1099b5d4-9df9-4c02-ad7d-6d1b239c2f63`, `246c087b-897c-4b8e-84c1-72528a5c08b4`, `8d3ec643-ce9c-49be-bdaf-207ef31ee021`, `0ea93f67-17de-4d02-8273-a288d56c9929`, `377a240d-3e94-42d6-ba76-647dc520569a`, `330d0ee0-4ebf-437a-b257-36a86412bfac`, `70119249-755f-43cd-b4f2-4db89e9de101`, `0ae75c9d-6d06-4718-8c4c-f996471f8aeb`, `d3b6d863-ed52-423d-8f2d-170d307dea87`. **The migration must mark exactly these nine**, every other session row NULL. All nine belong to project `985d547b…`. |
| **4** | *"the real DB has a credentialed `running` row today (`246c087b…`)"* — the boot-heal proof's subject | **WRONG, AND IT SILENTLY VOIDS THE PROOF.** `246c087b…` is now `status='exited'`, and **all 20 session rows are `exited`. There are ZERO `running` sessions.** A boot with nothing to heal proves nothing. **You must plant one**: flip a credentialed session to `'running'` via a dedicated `_verify/3a-5/` script (never by hand-editing production code paths), and it needs a **layout leaf** to be in the restore set (`computeRestoreSet` = layout leaves ∩ persisted `'running'` rows) — read `restore.ts` before planting, or the row will be ignored and you will conclude the wrong thing. Restore the DB state afterwards and dump the restoration. |
| **5** | Verify against `%APPDATA%\chorus\chorus.db` | **WRONG, and this is F20 + F31.** The real dev DB is `C:\Users\matth\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\chorus\chorus.db`. Electron ignores the `APPDATA` env var but honours `--user-data-dir`. **Copy `_verify/3a-4/start-realdb.ps1` into `_verify/3a-5/`** and boot with it. A dump quoting projects `a43b395d…`/`b684e96e…` is the scratch DB and **discharges nothing**. |
| **6** | Baseline `273/273 across 14 files` | **644/644 across 23 files**; typecheck **0** (node + web); `grep:secrets` **clean (6 patterns)**. Coordinator-verified 2026-07-26 at `3433c91`. |
| **7** | `ipcMain.handle(` goes **31 → 36** | **36 → 41**, and `IpcChannel` goes **39 → 44**. State both in the commit message. |
| **8** | `provider_configs` has two rows; `credential_profiles` has two | **THREE each.** See the real-DB table below. The third provider is `OpenRouter admin` (`auth_mode = 'management'`) and its `OR Management Key` is what makes the boot decrypt fire. |
| **9** | `LaunchDialog.vue` gains `selectedProfileId` for the launch-profile picker | **⚠ NAME COLLISION.** `selectedProfile` **already exists** in that file and means the **credential** profile (3-6). Two refs one character apart, in the same component, meaning different things, is a defect waiting to happen. **Name yours unambiguously** (e.g. `selectedLaunchProfileId`) and say so in the commit message. |
| **10** | The effort vocabulary | `effortLevelSchema = z.enum([**'fast', 'balanced', 'deep', 'max'**])` — **not** `low/medium/high/max` (those are claude's *CLI* values, which `resolveEffortArgs` maps to). **`launchRequestSchema.effort` ALREADY EXISTS** (3a-4). Do **not** add a second field — spec §5.3 already warns this, and it is correct. |
| **11** | The dump precedent is `_verify/3-6/dump-v6.js` | Still readable, but **`_verify/3a-4/dump-v9.js` is the current, fuller shape** and already excludes the credential blob. Adapt **that**, name yours `dump-v10.js`, and extend it: the DB now has **eleven** tables including **`model_catalog` (345 rows)**, which must be row-identical across pre/post/boot-2. |
| **12** | `_verify/3-6/` is the harness precedent | Superseded and much better: **`_verify/3a-4/cdp.js`** (the proven CDP driver), **`_verify/3a-4/start-realdb.ps1`**, **`_verify/3a-3/find-child-pids.ps1`** (the proven process-tree walker), **`_verify/3a-3/focuswindow.ps1`**. `_verify/3-6/read-env.ps1` is still the environment-block reader and **is still required** for the five-surface check's positive half. |

**Installed CLI versions, coordinator-checked 2026-07-25:** `claude --version` → **2.1.218**; `codex --version` → **codex-cli 0.145.0**. **A starting point, not a discharge.** This task changes no adapter and maps nothing onto a flag, so the D4 surface is small — but if you touch anything flag-shaped, re-verify it against `--help` this session.

### The real dev DB, dumped read-only by the coordinator 2026-07-26

- **`schema_migrations`: v1–v9.** Known-good `applied_at` values your three-dump protocol must show **byte-identical** pre and post: v4 `2026-07-20T16:57:49.534Z` · v5 `2026-07-23T13:04:06.301Z` · v6 `2026-07-24T15:52:22.591Z` · v7 `2026-07-25T12:50:53.246Z` · v8 `2026-07-25T20:46:53.759Z` · **v9 `2026-07-26T00:51:47.145Z`**.
- **Eleven tables**: `attention_spans`, `credential_profiles`, `dispatches`, `model_catalog`, `pane_layouts`, `projects`, `provider_configs`, `schema_migrations`, `sessions`, `settings`, `worktrees`. **`launch_profiles` does not exist** (confirmed).
- **`sessions`: 20 rows, `sessions_cols` = `id, project_id, agent, cwd, status, exit_code, created_at, title, worktree_id`** — no `launch_profile_id`. **All 20 are `status='exited'`.** All 20 belong to project `985d547b…`; **`Chorus-Second` has zero sessions** (relevant to the two-project scoping drive — an empty dialog is still a valid "no profile preselected" observation, but say so honestly).
- **`settings` keys**: `active_project_id` · **`credentialed_sessions` (352 B, nine ids)** · `recent_cwds` · `view_state:985d547b…` · `view_state:f47ac10b…` · `window_bounds`. **This is Step 3's scoping evidence — read it off your own dump, do not cite this line.**
- **`projects` (F20's provenance pair):** `985d547b-d152-4a07-9094-ddb8da56ef8f` Chorus · `f47ac10b-58cc-4372-a567-0e02b2c3d479` Chorus-Second. **Quote this table in every dump.**
- **`provider_configs`:**
  - `6c052ee6-1eb3-4d7c-8aa3-832bd19dfd13` — **OpenRouter** · `codex` · `api_key` · `https://openrouter.ai/api/v1` · model **`moonshotai/kimi-k3`**
  - `fb5fb8dc-fad6-44ce-a336-506ccb932e24` — Anthropic direct · `claude` · `api_key` · no base URL · no model
  - `e947ee75-3482-43d2-97bd-f9a802f44213` — **OpenRouter admin** · `claude` · **`management`** · `https://openrouter.ai/api/v1` · no model
- **`credential_profiles`** (non-secret columns + `length(encrypted_blob)` only):
  - `6a658a8f-b3a3-42f5-b318-f6efa11732ad` — **`OR milestone key`** on OpenRouter · blob 114 B · `last_verified_at` **`2026-07-25T20:13:22.131Z`** · `unavailable_since` **null**
  - `7c5cf34e-1f75-40b2-ac76-80f4abd46277` — **`Claude fake key`** on Anthropic direct · blob 104 B · **`unavailable_since` `2026-07-26T00:23:27.471Z`** — a real D33-clause-8 row, and a **free live fixture** for your unavailable-credential refusal
  - `eb14b013-a889-4363-9aa0-1582aaae00a4` — **`OR Management Key`** on OpenRouter admin · blob 114 B · `unavailable_since` **null** ← **this is what makes the boot decrypt fire**
- **`dispatches` 83 rows · `attention_spans` 75 rows · `model_catalog` 345 rows** — all three must be row-identical across pre / post / boot-2.
- **The standing worktree fixture:** id `9ba9b0da-cecd-4960-815d-f36166cf8c00`, branch `chorus/Chorus/24b5c1fe`, `session_id` null. **Do not remove the row, the directory, or the branch.**

`_verify/` is **entirely gitignored**, so nothing you put there can be staged.

---

## Decisions You Must Honour — all RESOLVED, none open

- **D43 (2026-07-24)** — the launchable unit: *"anything that stores a reference stores the **id**, while the label — defaulted to `<provider name>/<model display name>` — stays freely renameable."* The governing decision for this task.
- **D49 / F26** — restore decision **(b)** as shipped; option (a) declined because it *"needs unattended boot-time decryption."* **Re-ratified here, not reversed.**
- **D53 (2026-07-24)** — *"Restore stays decision (b); a one-click relaunch is added"* — resolving the credential **with the user present at the keyboard**.
- **D33 (in full)** — clauses 4, 8 and 9 and resolution (a). Clause 8: a row carrying `unavailable_since` is refused **without re-attempting decryption**. **D33 never sanctioned decrypting with no user present** — and see the STOP section for how that sentence now interacts with 3a-3.
- **D48 / 3a-4's normative precedence table** — `launch_profiles.model` (rank 1) > `provider_configs.model` (rank 2, the route's *default*) > nothing emitted. **`model_catalog` is never in the order.** A profile with a NULL model **inherits the route default at resolve time and is NEVER back-written** — back-writing is how the second home gets created by accident.
- **3a-4's effort order, unchanged and unextended** — raw `extra_args` (rank 1) > the app-level level (rank 2) > nothing. **A profile supplies a rank-2 value; it does not create a rank 0.** Import `effortLevelSchema` and `resolveEffortArgs`; declare no second enum, union, or literal set.
- **D45(4)** — api mode is declared-only. `startApiSession` stays unimplemented; `SessionManager` stays PTY-only.
- **D7** — Drizzle is types + queries only; migrations stay in the hand-rolled `MIGRATIONS` array. **Never drizzle-kit.**
- **D14** — plain-object IPC. A Pinia object is a Vue reactive **Proxy**; structured clone rejects it with **no compile-time signal**.
- **D16 resolution (d)** — sessions are deleted on pane close. This is *why* `sessions.launch_profile_id` is a soft pointer.
- **F16** — FKs are **ENFORCED**. That is precisely why `launch_profiles` **does** carry `REFERENCES` and the delete guards must count **before** SQLite throws.
- **D52** — no new adapters; `agentKindSchema` stays `'claude' | 'codex'`; D34 Q5 is not lifted here.
- **F27** — the honest redaction wording is *"Chorus redacts registered exact values on ingest; it cannot redact values an agent derives"* — **never** "agents cannot echo the key".
- **D40** — **stage scope files EXPLICITLY by path; never `git add -A`.**

---

## Pre-Existing Changes — Do Not Touch

The working tree contains these untracked files at repo root / in docs:

```
?? TASK-3-5-REVIEW-FABLE.md
?? TASK-3-6-REVIEW-FABLE.md
?? docs/Features/Foundation/Tasks/Task-3a-5-ExecutionPrompt.md   (this file)
```

**Do NOT revert, stage, delete, or commit the two `TASK-*-REVIEW-FABLE.md` files.** They belong to prior sessions' review record. (`TASK-3-4-REVIEW-FABLE.md` is tracked and committed — leave it alone too.) Never stage or revert anything under `_verify/` or `docs/` unless a step explicitly says so.

---

## ⚠ Standing condition — the dev vault holds REAL, BILLABLE credentials

Matthew's real OpenRouter keys live in the real dev vault under **`OR milestone key`** (inference) and **`OR Management Key`** (management). His keys, his vault, his machine, deliberately left in place.

1. **Never dump, echo, print, copy, or transmit `credential_profiles.encrypted_blob` or `fingerprint_hash`.** Select non-secret columns explicitly and prove blob stability with `length(encrypted_blob)`. **The 3-6 dump script `SELECT *`s from `credential_profiles`; yours must not.**
2. **Do not press "Test key" on `OR milestone key`.**
3. **No test, fixture, `_verify/` artifact, or probe log line may contain a real credential or key fragment.** `npm run grep:secrets` must pass over `_verify/3a-5/` too. **This applies with force to your temporary `decryptForLaunch` probe — it logs an id and an `auth_mode`, nothing else.**
4. Anything beyond the single real relaunch proof, create with a **planted fake key** and remove afterwards.

---

## Implementation Scope

**Exactly as `Task-3a-5.md`'s Exact Scope table** (which governs; this is the summary):

- **CREATE** `src/main/services/launchProfiles.ts` (+ `.test.ts`) — the **PURE** core: `resolveLaunchProfile`, **`sessionIsCredentialed`** (the fail-safe predicate), `defaultProfileLabel`, `validateProfileShape`, and `LEGACY_CREDENTIALED_PROFILE_ID`. Electron-free, storage-free, `fetch`-free, clock-injected.
- **EDIT** `src/main/services/storage.ts` — **migration v10** (spec §2.2's DDL + data migration as **ONE atomic entry**), the launch-profile accessors, the derived credentialed predicates, the per-project last-used pair, and `countLaunchProfilesForProvider` / `countLaunchProfilesForCredential`. **Deletes `markSessionCredentialed`, `unmarkSessionCredentialed`, `writeCredentialedSessionIds`** and the `'credentialed_sessions'` literal.
- **EDIT** `src/main/db/schema.ts` — the `launchProfiles` Drizzle table + inferred types (spec §2.5, matching v10 column for column), and `launchProfileId` on `sessions`.
- **EDIT** `src/main/ipc.ts` — four `launch-profile:*` handlers, the `session:relaunch` handler, profile resolution inside `SessionLaunch` + the last-used write, `launchContextResponse`'s two new fields, the two delete guards, `SessionDelete`'s unmark removal, `SessionRestart`'s switch to the derived predicate.
- **EDIT** `src/shared/ipc.ts` — five channels and their schemas, `savedWorkspaceModeSchema`, `launchProfileWireSchema`, `launchRequestSchema.launch_profile_id`, the two `launchContextResponseSchema` fields.
- **EDIT** `src/preload/index.ts` — five Zod-free typed forwarders. `index.d.ts` is never hand-edited.
- **EDIT** `src/main/services/sessionManager.ts` — **ONE line** (the set's source) plus its comment. **Nothing else, and `vault` stays at zero occurrences.**
- **EDIT** `src/renderer/src/components/LaunchDialog.vue` · `TerminalPane.vue` · `src/renderer/src/stores/settings.ts` · `src/renderer/src/views/SettingsProviders.vue` (or a sibling settings surface — list/rename/delete only).
- **EDIT** `src/shared/ipc.test.ts`.
- **CREATE (untracked harness)** `_verify/3a-5/dump-v10.js`, `_verify/3a-5/rehearse-v10.js`, and the drive scripts.

**No `.vue` file beyond the three named.** If a change seems to require another file — **especially `vault.ts`, `vaultCore.ts`, any adapter file, or anything 3a-1/3a-3/3a-4 created — stop and raise it.** That is a scope signal, not a detail.

---

## Strict Non-Goals

- **⚠ NO UNATTENDED BOOT-TIME DECRYPTION OF A LAUNCH CREDENTIAL.** Restore option (a) stays declined (D49/D53). No new call to `vault.decryptForLaunch` may become reachable from `app.whenReady`, `SessionManager.restore`, `SessionManager.spawn`, a `DispatchRecorder` path, a timer, or any boot reconcile. **A helper shared between relaunch and restore is the shape this fails in** — it will look like sensible reuse and it will decrypt at boot. Any design that "just needs the key at restore for a moment" is a **§4 CR trigger** — flag, brief, pause.
- **Do NOT touch 3a-3's management-key boot path** to make a grep pass. Out of scope. See the STOP section.
- **No change to the restore contract's observable behaviour** — same healed status, the **verbatim** title `Credential not re-supplied — relaunch from the dialog to re-enter it`, the verbatim log line `[restore] credentialed session healed -> exited (no keyless restore): <id>`, same `session:restart` refusal semantics.
- **No `UPDATE provider_configs` and no back-writing the route default into a profile row.** The rank-2 fallback is resolved at launch, never persisted.
- **No effort→flag and no permission-mode→flag mapping**, and **NO adapter file changes** — `src/main/adapters/` must be byte-identical across this commit. `permission_mode` is **stored and consumed by nothing**.
- **No `model_catalog` work** — no list, no fetch, no refresh. 3a-4 owns it; you consume its precedence table and create no second home.
- **No new adapters, no registry widening** — `agentKindSchema` stays `'claude' | 'codex'`; D34 Q5 not lifted (D52).
- **No api-mode implementation** (D45(4)) — `startApiSession` stays unimplemented, no session-type split, `SessionManager` stays PTY-only.
- **No board, no panel, no dashboard, no Mission Control UI.** A picker in the dialog and a list/rename/delete affordance in Settings. Nothing renders dispatch data, spend, or telemetry.
- **No second telemetry table and no telemetry writes.** No launch-profile id smuggled onto a `dispatches` row.
- **No `existing-worktree` in a saved profile** — refused at create and update.
- **No credential material anywhere new.** A profile stores a credential **profile id**, never a key, never a fingerprint. The renderer sends and receives ids only.
- **No auto-creation of provider rows.** A profile with no route is first-class (D33 clause 9).
- **No retention, pruning, or aging-out of profiles.**
- **No second migration**, **no new npm dependency**.
- **Do not touch the two `TASK-*-REVIEW-FABLE.md` files or the `wt-24b5c1fe` fixture.**

---

## Required Workflow

Work as coordinator: implement → review the diff against the Implementation Spec → a code-quality pass → resolve findings → run the gates → narrate the commit. **Do NOT push and do NOT open a pull request unless explicitly asked.**

Ordered work steps (`Task-3a-5.md` §Step-by-step governs; this is its numbering, amended by the corrections above):

1. **Read `src/main/index.ts`'s `whenReady` block and settle the invariant's wording — FIRST, and REPORTED.** Before any code. Write down the restated invariant; you will quote it in the commit message. **Probe both credentials' decryptability in the same pass** (precondition 1).
2. **Read the shipped `MIGRATIONS` array and settle the version number.** Expected `MIGRATIONS.length + 1 === 10`. State it in the commit message with `SELECT version FROM schema_migrations` as evidence.
3. **Migration v10 + Drizzle mirror**, exactly as spec §2.2 / §2.5, as **ONE atomic entry**. **Grep the entry: exactly 2 `REFERENCES`, both on `launch_profiles`; zero on `sessions.launch_profile_id`.** Getting this backwards produces two distinct bugs, both surfacing as `SQLITE_CONSTRAINT_FOREIGNKEY` in flows that have worked since Task 1-5.
4. **⚠ REHEARSE ON A COPY before the first real boot.** `_verify/3a-5/rehearse-v10.js` against a copy of the real DB: assert **all nine** ids came out marked, every other session row NULL, the settings row gone, and `length(encrypted_blob)` unchanged for all three credential rows. **A data migration that mutates the live `sessions` table does not get to be tested in production.**
5. **`launchProfiles.ts` — the pure half first**, and **write its unit table before anything consumes it**. The **fail-safe** row (`launch_profile_id` set, profile does not resolve → **`true`**) is the most important test in the task.
6. **Storage accessors** (spec §4), rows-in-rows-out. Every policy decision lives in the core.
7. **The five IPC handlers + preload forwarders + store actions + the two renderer surfaces.** All Zod in main (D1); plain objects across the bridge (D14); every handler **outbound-`.parse`**es its response. **Reuse `resolveCredential`; do not fork it.**
8. **The one-line body swap in `sessionManager.ts`.** If it needs more than the line and its comment, **stop and raise it**.
9. **Tests**, then the three gates.
10. **The three-dump migration protocol, the discriminated no-boot-decrypt proof, and the runtime drives (G2).**

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

**Baseline to beat, coordinator-verified 2026-07-26 at `3433c91`:**
- typecheck: **0 errors** (node + web)
- vitest: **644/644 across 23 files**
- grep:secrets: **clean (6 patterns over `src/`, `scripts/`, `_verify/`, `package.json`, root configs)**

### The migration proof — the FULL three-dump protocol, on the REAL DB

**Rehearse on a copy first (step 4).** Then:

```powershell
New-Item -ItemType Directory -Force _verify\3a-5 | Out-Null
$env:ELECTRON_RUN_AS_NODE = '1'
& node_modules\electron\dist\electron.exe _verify\3a-5\dump-v10.js "C:\Users\matth\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\chorus\chorus.db" _verify\3a-5\pre.json
```

Then boot the app once (**cold** — electron-vite does not hot-restart main) via your copy of `start-realdb.ps1`, tree-kill it, dump to `post.json`; then boot a second time, tree-kill, dump to `boot2.json`. Assert, **quoting the evidence**:

1. `schema_migrations` shows **9 → 10**, applied **in place**; **every prior version's `applied_at` is byte-identical** pre and post (known-good values listed above).
2. Every pre-existing table is **row-identical** across pre / post / boot-2 — `projects`, `sessions` (**except** the nine migrated `launch_profile_id` cells and any documented boot-heal), `worktrees`, `pane_layouts`, `settings` (**except** the deleted `credentialed_sessions` row), `provider_configs`, **`dispatches` (83)**, **`attention_spans` (75)**, **`model_catalog` (345)**, and `credential_profiles` **over its non-secret columns plus `length(encrypted_blob)`**. **Every exception enumerated in advance — an unlisted difference is a failure, not a surprise.**
3. **The data migration landed exactly:** `launch_profile_id = 'legacy-credentialed'` for **all nine** ids in correction #3, **NULL for every other session row**, and **no `settings` row with key `credentialed_sessions` exists** post-migration.
4. **`launch_profiles` exists, is empty**, and its `sqlite_master` DDL carries **two** `REFERENCES` clauses and the `UNIQUE(label)` constraint.
5. **Boot 2 does not re-apply v10** — `applied_at` byte-identical between `post.json` and `boot2.json`.
6. The `wt-24b5c1fe` worktree row is intact.
7. **Provenance (F20): quote the `projects` table in every dump.** `985d547b…`/`f47ac10b…` or it discharges nothing.

**`sqlite3` is NOT installed** — use the `ELECTRON_RUN_AS_NODE` pattern only. **Known flake: the script writes no file on its first invocation — retry once.**

### ⚠ THE HARD INVARIANT — the discriminated no-boot-decrypt proof

**Both halves, both quoted. Neither alone is sufficient** — a grep is defeated by an indirection; a boot log is defeated by a boot that had nothing to decrypt.

**Structural (offline):**

```powershell
Select-String -Path src -Include *.ts -Recurse -Pattern "decryptForLaunch|safeStorage"
```
```powershell
Select-String -Path src\main\services\sessionManager.ts -Pattern "vault"
```

Expected: **zero** hits in `sessionManager.ts`. **Five** production `decryptForLaunch` call sites — `resolveCredential`, `credential:test`, your `session:relaunch`, all three inside `registerIpc`; plus `modelCatalog.ts` (3a-4, user-initiated) and `index.ts`'s management thunk (3a-3, boot-reachable, **management class**). **Enumerate all five in the report with their class and their gesture status.** Do not report "three, all in registerIpc" — that sentence is now false.

**Runtime (instrumented cold boot, then reverted):**

1. Add one probe line at the top of `vault.decryptForLaunch` logging **the profile id and its provider's `auth_mode`** — never a plaintext, never a fragment.
2. **Plant a credentialed `running` session with a layout leaf** (correction #4) so the boot genuinely has something to heal.
3. Cold-boot. Assert the log shows `[restore] credentialed session healed -> exited (no keyless restore): <id>` **and ZERO decrypt lines where `authMode !== 'management'`**. Quote the management line(s) that *do* appear and name them as 3a-3's, expected.
4. Click **Relaunch**. Assert **exactly one** additional decrypt, with `authMode = 'api_key'`.
5. **Revert the instrumentation and prove the revert against the COMMIT DIFF, not the worktree** (Task 2-4 precedent). Restore the planted session state and dump the restoration.

### The runtime drives (G2)

Full detail in `Task-3a-5.md` §Verification Commands and spec §9.3. In short, with the ones that carry the acceptance marked:

1. **The behaviour-preservation proof** — on the migrating boot: the healed session gets the **verbatim** title and log line; a **non-credentialed `running` row with a layout leaf still relaunches normally in the same boot** (the negative control, without which check 1 is consistent with restore being broken entirely); `session:restart` on a healed session still refuses inline with its existing message.
2. **⚠ The end-to-end profile drive** — save `OR/Kimi K3` over the live route (agent `codex`, provider OpenRouter, credential `OR milestone key`, **model NULL** so precedence rank 2 supplies `moonshotai/kimi-k3`); launch from it; **the agent answers one short prompt**; `sessions.launch_profile_id` holds the profile id.
3. **The five-surface check, abbreviated but not skipped** — walk the process tree from the electron main PID via `ParentProcessId` (**never name-matching** — ~16 unrelated `claude.exe` on this machine; `_verify/3a-3/find-child-pids.ps1` is the proven walker). **No command line holds the key or any ≥ 8-character substring of it**, while the child's **environment block does** carry it under `OPENROUTER_API_KEY` (`_verify/3-6/read-env.ps1`). **The positive half is not optional** — absence everywhere is also what a completely broken injection looks like.
4. **⚠ The relaunch drive** — cold-boot, the session heals, click **Relaunch**: the agent returns **on the same row id**, answers again, and the discriminated log shows **exactly one** `api_key` decrypt.
5. **⚠ The rename proof (D43)** — rename the profile mid-flight to `OR/Kimi (renamed)`; confirm the live session, the last-used default, and `sessions.launch_profile_id` are **all unaffected**. This is the id-vs-label property proven rather than asserted.
6. **The default-scoping proof** — launch from a profile in **Chorus**; switch to **Chorus-Second**; confirm **no profile is preselected**; return to Chorus and confirm the default survives. Dump `settings`: exactly one `last_launch_profile:985d547b…` key, **no global `last_launch_profile` key**. (Note Chorus-Second has zero sessions — report what you actually observe.)
7. **The referential-fragility proof** — with the profile saved, attempt `credential:delete` on `OR milestone key` → **inline refusal naming the count**, no throw, **no `SQLITE_CONSTRAINT_FOREIGNKEY` anywhere in the log**. Same for `provider:delete` on `OpenRouter`. Delete the launch profile, then confirm both deletes proceed. **Then re-create both** — the OR route and its key are standing fixtures.
8. **The dangling-profile proof** — save a second profile with a **planted fake key**, launch from it, kill the session, **delete the profile**, cold-boot. Confirm the session's `launch_profile_id` still holds the deleted id, the **fail-safe** predicate classifies it credentialed, restore heals it rather than relaunching keyless, and **Relaunch refuses** with the use-the-dialog message. Then remove the planted credential and provider.
9. **The legacy-sentinel proof** — on a healed sentinel row (any of the nine), click **Relaunch** and confirm the refusal points at the launch dialog. **That is the only real evidence the retirement preserved the legacy population's behaviour.**
10. **The disabled-not-hidden proof** — a profile whose credential is unavailable (`Claude fake key` is a live fixture) is **shown, disabled, and explained**, with the reason naming the credential **by label only** — no URL, no env var value, no key fragment.

### Grep gates — run before the commit, quote the counts

- **zero** `credentialed_sessions` / `markSessionCredentialed` / `unmarkSessionCredentialed` / `writeCredentialedSessionIds` over `src/`;
- **zero** `vault` in `src/main/services/sessionManager.ts`;
- **exactly 2** `REFERENCES` in the v10 migration entry, both on `launch_profiles`; **zero** on `sessions.launch_profile_id`;
- **`ipcMain.handle(` = 41** in `src/main/ipc.ts`; **`IpcChannel` = 44**;
- **zero** second effort enum / union / literal set over `src/` — 3a-4's `effortLevelSchema` is imported;
- **`src/main/adapters/` diff for this commit is EMPTY** — no adapter file changed;
- **zero** `UPDATE launch_profiles` outside the `launch-profile:update` handler, and **zero** `UPDATE provider_configs` anywhere;
- `agentKindSchema` still `'claude' | 'codex'`; `startApiSession` still unimplemented;
- **exactly 3** `.vue` files touched, the three in Exact Scope;
- `TASK-3-5-REVIEW-FABLE.md` / `TASK-3-6-REVIEW-FABLE.md` present, unmodified, **unstaged**.

### Harness caveats — verified through 2026-07-26

- **electron-vite does NOT hot-restart the main process**; HMR covers the renderer only. **Every main-process change needs a real cold boot.**
- **Boot against the real DB** with `--user-data-dir=C:\Users\matth\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\chorus` — copy `_verify/3a-4/start-realdb.ps1`.
- **Graceful quit:** `taskkill` **without** `/F` (WM_CLOSE) does **not** terminate the dev app in this session. Use a CDP `window.close()` evaluate. Kill process **TREES** with `taskkill /PID <root> /T /F` for the crash cases.
- **CDP on `--remote-debugging-port=9222`** is the proven driver (`_verify/3a-4/cdp.js`). **Wrap every `Runtime.evaluate` body in an IIFE** — top-level `const` collides across evaluates.
- **⚠ The Task 3-4 lesson, still binding and still the most common way these drives fail:** CDP-driven Vue forms need a **microtask tick** between `input` and the submit click, or the click lands on a stale `:disabled` — a silent no-op that reads exactly like a broken feature.
- **⚠ Vite's SPA fallback poisons CDP-driven file reads:** `fetch('some.txt')` inside the page returns `index.html`. Use `fetch('/@fs/C:/absolute/path')`.
- **The dev window is NOT foregrounded by default** and other desktop apps steal foreground mid-run (F29). Foreground deliberately (`_verify/3a-3/focuswindow.ps1`) and verify before any screenshot-based check.
- **Never type into a CLI whose input mode you have not read first** — screenshot and read the pane before sending keystrokes.
- All artifacts under `_verify/3a-5/`.

---

## Failure Honesty Clause

If any verification command fails for an unrelated environment reason, **capture the EXACT output, explain it, and DO NOT claim success.** An indeterminate result is reported as indeterminate and the affected acceptance criterion is marked **FAILED** — never reasoned into a pass. An unproven claim is worse than an honest unknown, because it will be cited later as evidence. **An unproven invariant is a FAIL, not a pass with a caveat.** Temporary instrumentation must be reverted, and the review checks the **COMMIT DIFF**, not the worktree.

---

## Final Reporting Requirements

Report a status of exactly one of **DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED**, plus:

- **⚠ THE INVARIANT, RESTATED AND PROVEN.** The wording you settled on; **all five `decryptForLaunch` call sites enumerated** with credential class and gesture status; the discriminated boot log quoted showing **zero non-management decrypts across a boot that genuinely healed a credentialed session** (say how you planted it); **exactly one `api_key` decrypt after the Relaunch click**; and the instrumentation revert proven **against the commit diff**. If any part is unproven, say so plainly — this is the task's headline output.
- **The commit SHA and every file changed** (only the Exact Scope files), with `MIGRATIONS.length` before and after (**9 → 10**) and the `SELECT version FROM schema_migrations` evidence.
- **Typecheck / vitest / grep:secrets results with actual numbers**, against the 0 / 644-across-23 / clean-6-patterns baseline.
- **The rehearsal output**, quoted, from the copy-DB run — before any real boot.
- **The three-dump protocol results**, with prior `applied_at` values quoted, the `projects` pair quoted, `dispatches` / `attention_spans` / `model_catalog` row counts shown identical, `launch_profiles` shown created empty with its two `REFERENCES` and `UNIQUE(label)`, and v10 not re-applied on boot 2.
- **The data migration's exactness**: **all nine** ids carrying the sentinel (list them), every other session row NULL, and the `credentialed_sessions` settings row gone — quoted from the dumps.
- **The behaviour-preservation evidence** — the verbatim healed title and log line, **plus the non-credentialed negative control** that still relaunched in the same boot, plus `session:restart`'s unchanged refusal.
- **The end-to-end drive**: the profile saved, the agent's answer, `sessions.launch_profile_id`, and the **five-surface check with BOTH halves** — no key in any command line (≥ 8-char substrings checked), key present in the child's environment block.
- **The relaunch drive** — same row id, agent answered, one decrypt.
- **The rename proof (D43)** — what was unaffected, shown not asserted.
- **The default-scoping proof** — the `settings` dump showing `last_launch_profile:985d547b…` and no global key.
- **Both delete guards driven**, with **no `SQLITE_CONSTRAINT_FOREIGNKEY` in the log**, and confirmation the OR route and key were re-created afterwards.
- **The dangling-profile and legacy-sentinel drives**, and the disabled-not-hidden rendering with its label-only reason.
- **The grep gate counts**, each quoted, including `ipcMain.handle(` = 41 and `IpcChannel` = 44, and the **empty `src/main/adapters/` diff**.
- **Confirmation of the narration requirements in the commit message:** the version read from the array; the **restated invariant** and why the original wording no longer holds; the retirement of the global list and why; the **`REFERENCES`-vs-`dispatches` inversion** and why; the per-project scoping ruling; the JSON1-free `LIKE` data migration and the rejected `json_each` alternative; the renamed dialog ref (correction #9); and **that restore option (a) remains declined**.
- **Actual cost**, against the **< $0.05** envelope, with the number of completions submitted, and confirmation Test key was never pressed against `OR milestone key`.
- **Confirmation each non-goal held:** no adapter file changed; no `UPDATE provider_configs`; no back-written route default; no second effort vocabulary; no `model_catalog` work; no board/panel; `getModels` still zero implementations; `startApiSession` still unimplemented; `agentKindSchema` unchanged; no second migration; no new dependency; only the three named `.vue` files touched.
- **Confirmation the two `TASK-*-REVIEW-FABLE.md` files are still untracked and unmodified**, nothing under `_verify/` or `docs/` was staged or reverted, the planted session/credential/provider fixtures were removed and the restoration dumped, and the `wt-24b5c1fe` worktree row, directory and branch are intact.
- **Residual risks and known gaps**, and the **final `git status --porcelain`**.
