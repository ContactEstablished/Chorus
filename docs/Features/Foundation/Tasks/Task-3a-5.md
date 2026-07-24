# Task 3a-5 — `launch_profiles`, the Dialog Default, and One-Click Relaunch

_Fifth and final task of Phase 3a (Profiles & Catalog). Windows-only. **ONE narrated commit (G3).** This task governs **scope**; `ImplementationSpecs/ImplementationSpec-3a-5.md` governs exact contents, DDL, insertion points and Zod shapes. **G4 `npm run grep:secrets` is mandatory.** **This task CLOSES Phase 3a** and pays off the debt Phase 3 knowingly took on._

> **⚠ COORDINATOR RULING — migration numbering, 2026-07-24. This supersedes every conditional "v9 or v10" phrasing below.** The five task docs were authored in parallel and each hedged its own migration number against the others. Because Phase 3a executes **strictly serially**, the numbers are deterministic and are fixed here: **3a-1 → v7 · 3a-3 → v8 · 3a-4 → v9 · 3a-5 → v10.** Task 3a-3 **does** take a migration (its mint ledger is durable crash-reconciliation state), so **this task is v10**. **Standing check for every implementer:** confirm `MIGRATIONS.length + 1` equals your expected number before appending, and if it does not, **stop and report the divergence** rather than renumbering silently — a mismatch means a prior task shipped something its doc did not describe.

**What closing the phase means here, concretely.** Three separate obligations converge on this one table:

1. **D43's launchable unit** — (agent × route × model) with a stable id and a renameable label — becomes a real row instead of a decision.
2. **D49/F26's deferred restore option (a)** — "re-resolve the credential at restore" — lands as a **user-initiated relaunch**, not as unattended boot-time decryption. The roadmap named `launch_profiles` as its natural home precisely because *a launch profile is the configuration that reproduces this launch*.
3. **Task 3-6's global `credentialed_sessions` settings list** — an explicitly-labelled **Phase-3-only expedient** — is retired into a per-session column and deleted from the database.

## Source Of Truth

- `docs/Features/Foundation/roadmap.md` §7 **Phase 3a** — the phase entry. Four of its bullets bind this task: the `launch_profiles` bullet (D43), the `provider_configs.model` bullet (D48's one-home rule), the restore-option-(a) bullet (D49/F26), and the kickoff question *"Does 3a implement restore option (a)?"*, which **this task answers: partially — the resolution, yes; the boot-time decryption, no.**
- Roadmap §6 **D43** (2026-07-24) — normative and quoted throughout. *"The route half already exists and needs no schema change: `provider_configs` … **is** the route, and `name` is already user-authored."* *"Stable id vs display label is load-bearing, not cosmetic … anything that stores a reference stores the **id**, while the label — defaulted to `<provider name>/<model display name>` — stays freely renameable."*
- Roadmap §6 **D48** — `provider_configs.model` is the **route's default model**, *"a DEFAULT, not an authority"*, and the anti-goal this task inherits: **no second competing home for a fact that already has one.**
- Roadmap §6 **D49 / F26** — restore decision **(b)** as shipped in `15a016e`, and the explicit statement that option (a) was declined because it *"needs **unattended boot-time decryption**"*. **That decline is re-ratified by this task, not reversed** (coordinator + Matthew, 2026-07-24).
- Roadmap §6 **D33** — the vault contract. Clauses 4, 8 and 9 and resolution (a) bind unchanged. **D33 never sanctioned decrypting with no user present**, and this task must not quietly introduce it.
- Roadmap §5 **F16** — FKs are **ENFORCED** (`PRAGMA foreign_keys=ON` by driver default). The count-and-refuse discipline established for `provider:delete` is extended here, not re-derived.
- Roadmap §5 **F20** — verification provenance: the coordinator re-verifies every DB claim against the real `%APPDATA%\chorus\chorus.db`.
- Roadmap §6 **D7** — Drizzle is types + queries only; migrations stay in the hand-rolled `MIGRATIONS` array. **Never drizzle-kit.**
- Roadmap §6 **D14** — plain-object IPC. Pinia state is a Vue reactive **Proxy** and structured clone rejects it with **no compile-time signal**; snapshot with `JSON.parse(JSON.stringify(x))` and runtime-verify every new renderer→main payload.
- Roadmap §6 **D1** — all Zod in **main**; the preload stays Zod-free (a preload Zod import throws `EvalError` under CSP and silently drops events).
- `Tasks/Task-3a-1.md` — migration **v7**, the `dispatches` spine, and the **no-`REFERENCES`** ruling for telemetry rows. Its FK reasoning is quoted and then **deliberately inverted** for this table; see Goal.
- `Tasks/Task-3a-4.md` — the **model-precedence table (normative)** and the **effort representation**. This task **reuses both and invents neither**. Its §1 places `launch_profiles.model` at **rank 1** and states that nothing *"may issue an `UPDATE launch_profiles` when that table exists"* — this task is the other side of that contract and honours it by resolving the route default at launch and **never back-writing it**. **⚠ See the numbering note in Dependencies: 3a-4 does not claim a fixed version either.**
- `Tasks/Task-3-6.md` + `ImplementationSpecs/ImplementationSpec-3-6.md` §6 — the restore decision as argued and as shipped; the three-dump migration protocol; the five-surface inspection vocabulary.
- `CLAUDE.md` — sessions live in **main**; the renderer never spawns and never owns lifecycle facts.

## Initial Starting Point

**Verified by the coordinator 2026-07-24 against `15a016e`** (code HEAD for `src/`), with a read-only query against the **real** dev DB `%APPDATA%\chorus\chorus.db`. Anchored to **named symbols, never line numbers** (standing house rule). **Tasks 3a-1 … 3a-4 land between this doc and its execution and move the schema underneath it — re-verify everything below before writing a line.**

- **Baseline:** `npm run typecheck` exits 0 (node + web) · `npx vitest run` = **273/273 across 14 files** · `npm run grep:secrets` clean (6 patterns).
- **The working tree carries two untracked files at repo root — `TASK-3-5-REVIEW-FABLE.md` and `TASK-3-6-REVIEW-FABLE.md`.** They are not yours. **Do not commit, delete, revert, or modify them.**
- **Migrations.** `const MIGRATIONS: string[]` in `src/main/services/storage.ts`, **six entries at `15a016e`**, applied by the private `migrate()` method over `schema_migrations`, each version in its own transaction. v6 is `ALTER TABLE provider_configs ADD COLUMN model TEXT;`. **3a-1 adds v7; 3a-4 adds v8; yours is v9 — see the ⚠ version-conflict warning in Dependencies.**
- **The route half of the triple ALREADY EXISTS and needs NO schema change.** `provider_configs` columns, verified on the real DB: `id, name, adapter_type, auth_mode, env_var_name, base_url, extra_headers_json, model, created_at`. **`name` is already user-authored** (D43), and `model` (v6/D48) is the route's **default**, not an authority.
- **`credential_profiles` columns:** `id, provider_id, label, encrypted_blob, fingerprint_hash, created_at, last_verified_at, unavailable_since, reencrypted_at`, with `UNIQUE (provider_id, label)` and `provider_id TEXT NOT NULL REFERENCES provider_configs(id)`.
- **The live route and credential (real DB, 2026-07-24):** provider `OpenRouter` / `codex` / `api_key` / `env_var_name=OPENROUTER_API_KEY` / `base_url=https://openrouter.ai/api/v1` / `model=moonshotai/kimi-k3`, with credential profile **"OR milestone key"** (`last_verified_at 2026-07-24T17:04:26.840Z`); plus provider `Anthropic direct` / `claude` / `api_key` with credential profile **"Claude fake key"**.
- **The mark this task retires — exact live contents.** `settings` holds one row keyed **`credentialed_sessions`** whose value is verbatim:
  ```
  ["1099b5d4-9df9-4c02-ad7d-6d1b239c2f63","246c087b-897c-4b8e-84c1-72528a5c08b4"]
  ```
  `1099b5d4…` is already `status='exited'` with title `Credential not re-supplied — relaunch from the dialog to re-enter it`. **`246c087b…` is still `status='running'`** (and is the `view_state:985d547b…` focused session) — it will be healed at the next boot. **Both must survive the migration with the credentialed fact intact.**
- **Storage symbols consumed and retired.** `StorageService.getCredentialedSessionIds()` (reads that settings row), the private `writeCredentialedSessionIds()`, `markSessionCredentialed()`, `unmarkSessionCredentialed()`. Neighbours to copy for style: `getViewState`/`setViewState` (the `view_state:<projectId>` inline-Drizzle settings pair), `countCredentialProfilesForProvider`, `getProviderConfigById`, `getCredentialProfileById`.
- **`SessionManager.restore(projectId)`** reads `storage.getCredentialedSessionIds()` and, for a member of that set, calls `updateSessionStatus(row.id,'exited',…)` + `updateSessionTitle(row.id, 'Credential not re-supplied — relaunch from the dialog to re-enter it')` and logs `[restore] credentialed session healed -> exited (no keyless restore): <id>`. **That title string and that log line are contract; they survive this task verbatim.**
- **`registerIpc` in `src/main/ipc.ts`** — **31 `ipcMain.handle(` registrations** at `15a016e`. Relevant symbols: the nested `resolveCredential(profileId, agent)` helper (five ordered steps, returns `{ok:true, credential, route}` / `{ok:false, reason}`, retains nothing, runs **before any session row exists**); the `IpcChannel.SessionLaunch` handler with its `LAUNCH_PANE_CAP = 16` soft cap and the absolute-path/`fs.existsSync` cwd **security boundary**; `IpcChannel.SessionRestart`'s inline refusal for credentialed rows; `IpcChannel.SessionDelete`'s `storage.unmarkSessionCredentialed(sessionId)` call; `IpcChannel.ProviderDelete`'s **count-and-refuse** via `countCredentialProfilesForProvider`; `IpcChannel.SessionLaunchContext` returning `launchContextResponseSchema`.
- **`vault.decryptForLaunch` has exactly TWO call sites in `src/` at `15a016e`**, both inside `registerIpc` in `src/main/ipc.ts`: `resolveCredential` (launch) and the `credential:test` handler. **`src/main/services/sessionManager.ts` contains ZERO occurrences of `vault`.** That is the structural fact the no-boot-decrypt invariant rests on, and Step 6's reviewer check re-proves it.
- **`LaunchDialog.vue`** (`src/renderer/src/components/`) — `AuthChoice = 'subscription' | 'api_key'` defaulting to `'subscription'`; refs `selected`, `cwd`, `mode`, `selectedWorktree`, `authChoice`, `selectedProfile`; the `eligibleProfiles` computed; the `watch([selected, authChoice], …)` re-anchor; `onMounted`'s four-way `Promise.all`; `submit()` building a **fresh object literal of primitives** (the D14 defence, commented as such); `modeClass`/`authClass`; the Tab focus trap.
- **Workspace modes** (Phase 2 / D22): `'current-tree' | 'new-worktree' | 'existing-worktree'`, always explicit in the payload, re-validated in main, **never silently overridden**.
- **`TerminalPane.vue`** — `onRestart()` (kill → awaited exit → `window.chorus.restartSession`), `paneMessage`, `store.setBusy`, and the header button row (`Split ⬌` / `Split ⬍` / `Restart` / `Kill`). This is where the relaunch control lands.
- **Settings scoping precedent, read off the real DB.** Per-project: `view_state:985d547b…`, `view_state:f47ac10b…`. Global: `active_project_id`, `window_bounds`, **`recent_cwds`** (one entry, `C:\Projects\ContactEstablished\Chorus`, visible to *both* projects' dialogs — an existing wart, observed and **not** fixed here). Step 3's ruling is argued against exactly this evidence.
- **Harness precedent:** `_verify/3-6/` — `dump-v6.js` (the three-dump script; **it `SELECT *`s `credential_profiles` and yours must not**), `read-env.ps1` (external environment-block read; its PEB offsets were established the hard way on this Win11 build), `probe.js` (booleans and counts only), and ~40 `eval-*.js` CDP drivers on `--remote-debugging-port=9222`.

### ⚠ Standing condition — the dev vault holds a REAL, BILLABLE credential

Coordinator-established 2026-07-24: **Matthew's real OpenRouter key lives in the real dev vault** as credential profile **"OR milestone key"** on the OpenRouter route (`moonshotai/kimi-k3`). His key, his vault, his machine, deliberately left in place. **This task's verification launches real agents on it.**

- **Never dump, echo, print, copy, or transmit `credential_profiles.encrypted_blob` or `fingerprint_hash.`** Select non-secret columns explicitly; prove blob stability with `length(encrypted_blob)` — a byte count is not key material and is sufficient evidence a migration did not touch the blob.
- **Do not press Test key on "OR milestone key"** unless a step below explicitly calls for it. It is a live, billable call.
- Anything you need beyond a single real relaunch proof, create yourself with a **planted fake key** and remove afterwards.

## Goal

Make **one saved, user-named row** reproduce a whole agent launch — and make the session that ran under it relaunchable in one click, **with the user at the keyboard**, without ever teaching the app to decrypt while nobody is there.

Five properties define the work. Each is a way this can be built wrong while looking right.

1. **The label is not the identity.** D43 is explicit: stored references store the **id**; the label is free to change. Every pointer this task creates — `sessions.launch_profile_id`, the last-used setting, the relaunch action's target — stores the **id**. A rename must be a pure UI event with **zero** downstream consequences, and the runtime proof renames a profile mid-flight to show it.
2. **Two routes to one model are two rows, not one row with a flag.** `OR/DeepSeek v4 Pro` and `Direct/DeepSeek` list as distinct, user-named entries; Claude Opus 4.8 by subscription CLI and by OpenRouter list as distinct entries. The picker is the table. Nothing in the renderer may collapse, dedupe, or "helpfully" merge rows that share a model id.
3. **Referential fragility is designed for, not discovered.** A profile names a provider and (optionally) a credential, and **both can be deleted** while the profile persists. FKs are **ENFORCED** here (F16) and Phase 3 already paid to learn that a `SQLITE_CONSTRAINT_FOREIGNKEY` reverse-engineered into a user message is a failure mode, not a feature. **This table therefore carries real `REFERENCES` clauses and real count-and-refuse guards** — the exact opposite of 3a-1's `dispatches` ruling, and for the exact opposite reason: a dispatch is an immutable historical fact that must outlive its subject, while a launch profile is a **live instruction** that is meaningless once its target is gone.
4. **The retirement must be a body swap, not a call-site rewrite.** `SessionManager.restore()`'s credentialed branch, its healed title and its log line are contract. The strongest possible evidence that behaviour did not regress is that **the restore branch's own source barely changes** — only where the set comes from. If retiring the settings list requires rewriting the restore engine, the design is wrong.
5. **No unattended boot-time decryption. Ever.** Restore stays decision **(b)**. What this task adds is a **relaunch action on the healed session** that resolves the credential from its profile *because a human clicked something*. The distance between those two is the whole security argument, and it is one careless `await` wide.

## Exact Scope

| File | Change |
|---|---|
| `src/main/services/storage.ts` | **Edit.** Append **migration v9** (see the version warning): `CREATE TABLE launch_profiles`, `ALTER TABLE sessions ADD COLUMN launch_profile_id TEXT;`, and the **pure-SQL data migration** that converts the `credentialed_sessions` settings row into per-session sentinels and then **deletes that row**. Plus the launch-profile accessors, the derived credentialed predicates, the last-used pair, and `countLaunchProfilesForProvider` / `countLaunchProfilesForCredential`. **Deletes `markSessionCredentialed`, `unmarkSessionCredentialed`, and the private `writeCredentialedSessionIds`.** |
| `src/main/db/schema.ts` | **Edit.** The `launchProfiles` Drizzle table + `$inferSelect`/`$inferInsert` types, matching v9's DDL column for column; `launchProfileId` added to `sessions`. |
| `src/main/services/launchProfiles.ts` | **Create.** The **pure** core: `resolveLaunchProfile` (profile + provider + credential rows → a resolved plan or a typed refusal), `sessionIsCredentialed`, `defaultProfileLabel`, and the create/update validators (agent↔route agreement, workspace-mode admissibility, env-map non-secrecy). **Electron-free, storage-free, `fetch`-free, clock-injected.** Precedent: `vaultCore.ts`, `restore.ts`'s `computeRestoreSet`, `env.ts`'s `composeChildEnv`. |
| `src/main/services/launchProfiles.test.ts` | **Create.** Unit tests for every branch in Test Expectations. |
| `src/main/ipc.ts` | **Edit.** Four `launch-profile:*` handlers; the `session:relaunch` handler; `launch_profile_id` resolution inside the `SessionLaunch` handler + the last-used write; `launchContextResponse` gains the profile list and the last-used id; **`ProviderDelete` and `CredentialDelete` gain count-and-refuse for launch profiles**; `SessionDelete` loses its `unmarkSessionCredentialed` call; `SessionRestart`'s refusal switches to the derived predicate. |
| `src/shared/ipc.ts` | **Edit.** Five channels, their request/response schemas, `launchRequestSchema.launch_profile_id`, and the two new `launchContextResponseSchema` fields. **No schema may carry key material.** |
| `src/preload/index.ts` | **Edit.** Five Zod-free forwarders. |
| `src/renderer/src/components/LaunchDialog.vue` | **Edit.** The profile picker, defaulting to the last-used profile; prefill of agent / workspace mode / credential from the chosen profile; "Save as launch profile" on a successful launch. |
| `src/renderer/src/components/TerminalPane.vue` | **Edit.** The **Relaunch** control on a healed credentialed session, and its inline result/refusal message. |
| `src/renderer/src/stores/settings.ts` | **Edit.** Launch-profile list/create/rename/delete actions for the picker's management affordance. |
| `src/renderer/src/views/SettingsProviders.vue` _or_ a sibling settings surface | **Edit.** The rename/delete affordance for saved profiles. **List, rename, delete only — no board, no panel, no dashboard.** |
| `src/shared/ipc.test.ts` | **Edit.** Cases for the five channels, the widened launch payload, and the key-set assertions. |
| `_verify/3a-5/dump-v9.js`, `_verify/3a-5/rehearse-v9.js` | **Create (untracked harness, not committed).** The three-dump script — adapted from `_verify/3-6/dump-v6.js` **with the credential-blob change mandated above** — and the **copy-DB migration rehearsal** required before the first real boot. |

Nothing else. If a change seems to require another file, **stop and raise it** — that is a scope signal, not a detail.

## Non-Goals

- **⚠ NO UNATTENDED BOOT-TIME DECRYPTION — restore option (a) was DECLINED and stays declined (D49).** No call to `vault.decryptForLaunch` (or anything reaching `safeStorage`) may become reachable from `app.whenReady`, `SessionManager.restore`, `SessionManager.spawn`, a `DispatchRecorder` path, a timer, or any boot reconcile. **This is the hard invariant of the task**, it has a dedicated reviewer check (Review Checklist item 1) and a dedicated runtime proof, and any design that "just needs the key at restore for a moment" is a **CR trigger** under roadmap §4 — flag, brief, pause.
- **No api-mode implementation (D45(4)).** `startApiSession` stays unimplemented; `SessionManager` stays PTY-only; no `ApiSessionHandle` implementation; no session-type split.
- **No new adapters.** **Kimi CLI and the OpenAI-compatible agent CLI are a separate later phase** (the roadmap's own kickoff question, unanswered here). `agentKindSchema` stays `'claude' | 'codex'`, the static registry stays frozen, and **D34 Q5 is not lifted by this task.** A launch profile of the shape "Aider × OpenRouter × DeepSeek" is not representable yet and that is correct.
- **No board, no panel, no dashboard, no Mission Control UI.** The profile surface is a **picker in the launch dialog** plus a **list/rename/delete affordance in Settings**. Nothing renders dispatch data, spend, or telemetry.
- **No `model_catalog` work, no model list, no fetch, no refresh.** 3a-4 owns the catalog; this task **consumes** its precedence table and its effort representation and creates **no** second home for either.
- **No effort→flag mapping and no permission-mode→flag mapping.** `launch_profiles.effort` is **passed to 3a-4's existing `LaunchOptions.effort` seam and resolved by ITS `resolveEffortArgs`** — this task maps nothing, quotes nothing, and **changes no adapter file**. `permission_mode` is **stored and consumed by nothing**: mapping it onto a CLI flag is D4 material *and* an adapter change, and neither is in scope. The column exists now so schema churn stays in one migration — the same argument 3a-1 used for `attention_spans`.
- **No second telemetry table and no telemetry writes.** 3a-1's `dispatches` row is the one home for dispatch actuals. If a launch-profile id belongs on a dispatch row, that is a follow-up, not a smuggled column here.
- **No change to the restore contract's observable behaviour.** Same healed status, same title string, same log line, same `session:restart` refusal semantics. The *source* of the credentialed fact changes; nothing a user can see does.
- **No credential material anywhere new.** A launch profile stores a credential **profile id**, never a key, never a fingerprint. The renderer sends and receives ids only.
- **No `existing-worktree` in a saved profile.** That mode names a specific transient worktree row; a saved profile may hold `current-tree` or `new-worktree` only, and create/update refuses the third.
- **No auto-creation of provider rows**, no migration of the ambient/subscription launch path into a mandatory route row. A profile with no route is first-class (D33 clause 9).
- **No retention, pruning, or aging-out of profiles.**
- **Do not revert, stage, delete, or commit the two untracked `TASK-3-5-REVIEW-FABLE.md` and `TASK-3-6-REVIEW-FABLE.md` files at repo root.** They belong to prior sessions' review record. Leave them exactly as found.
- **Do not revert, stage, or commit unrelated or untracked files, including anything under `_verify/` or `docs/`.**
- **Do not remove the standing `wt-24b5c1fe` worktree row, its directory, or branch `chorus/Chorus/24b5c1fe`.**

## Dependencies

- **Task 3a-1 — HARD.** Migration **v7**, the `dispatches` spine, and (per **D54**) `PINNED_ENV_VARS` in `composeChildEnv`. The pin's precedence position matters to Step 4's env chain; read the shipped `env.ts` before writing it.
- **Task 3a-4 — HARD.** This task consumes its **model-precedence table (normative, its §1)** and its **effort vocabulary** — `effortLevelSchema` (`src/shared/ipc.ts`), `EffortOption` / `EffortDescriptor` (`src/main/adapters/types.ts`), `resolveEffortArgs` (`src/main/adapters/effort.ts`), and the `LaunchOptions.effort` seam it threads through `SessionManager.launch`. It must **import** all of them rather than redeclare anything. 3a-4 states that *"the effort level chosen in the launch dialog is per-launch and unpersisted in this task, deliberately"* — **this task is where it becomes persistable, and `launch_profiles.effort` is its one home.**
- **Task 3a-2, Task 3a-3 — no ordering constraint in either direction.** Neither reads this task's output. If 3a-3 shipped its own migration, see the version warning.

### ⚠ MIGRATION VERSION CONFLICT — resolve by reading, never by assuming

**This doc claims v9 on the coordinator's stated sequence: 3a-1 = v7, 3a-4 = v8, this task = v9. NO TASK IN THE PHASE CAN ACTUALLY GUARANTEE ITS NUMBER, and 3a-4 says so itself.** Read the sibling docs' own words:

- **3a-1 takes v7** and forbids itself a second: *"No second migration. v7 is the only one this task adds."*
- **3a-2 takes none** — *"No migration, and no v8."*
- **3a-3 CONDITIONALLY takes v8**, *"only if 3a-1's v7 does not already carry these columns"* — left open until execution.
- **3a-4 declines to fix its own number:** *"this task's migration is v8 if 3a-3 added none, and v9 if it did … The docs below say v8 throughout for readability; read it as 'the next unused index'."*

**So this task is v9 or v10, and the only honest answer is read-first.**

**At execution, before writing any DDL:** read the shipped `MIGRATIONS` array in `src/main/services/storage.ts`, use `MIGRATIONS.length + 1` as this task's version, and **report any divergence from v9 as a finding**. Do not renumber another task's landed migration, and do not guess. Everywhere this doc and its spec say **v9**, read *"the next free version"*.

### ⚠ Effort and model precedence — adopt, do not invent

- **`launch_profiles.effort` stores an `EffortOption.id` drawn from 3a-4's `effortLevelSchema`**, imported, never re-declared. **Do not declare a second enum, a second union type, or a second set of string literals.** At launch the value is handed to 3a-4's existing `LaunchOptions.effort` seam and resolved by **its** `resolveEffortArgs`; this task maps nothing onto a CLI flag and touches no adapter. If 3a-4's vocabulary cannot be imported at execution, **stop and report** — a parallel effort vocabulary is precisely the two-homes failure D48 exists to prevent.
- **3a-4's effort precedence is unchanged and unextended:** raw `extra_args` override (rank 1) > the app-level level (rank 2) > nothing (rank 3). A profile supplies a **rank-2 value**; it does not create a rank 0.
- **The model-precedence order is 3a-4's table and it is normative.** Restated here for readers, subordinate to 3a-4 if the two ever differ:

  | Rank | Source | Role | Wins when |
  |---|---|---|---|
  | 1 | `launch_profiles.model` | **the choice for this launch** | non-NULL |
  | 2 | `provider_configs.model` (v6/D48) | **the route's default** | profile model is NULL |
  | 3 | _(nothing)_ | the adapter emits no `-m` | both NULL |
  | — | `model_catalog` (3a-4) | **a list of what exists** — never an authority, never a fallback | never |

  One order, no second home. A profile that names no model **inherits the route's default at resolve time and is not back-written** — copying the route default into the profile row would create the second home by another name.

- **No new npm dependency.** better-sqlite3 + Drizzle types + `randomUUID` + the existing pino logger + Node's built-ins.

## Step-by-step Work

### 1. Migration v9 — the table, the column, and the data migration, as ONE atomic entry

The DDL and the data conversion land in a **single `MIGRATIONS` entry**, applied inside the runner's existing per-version transaction (the v4 precedent: multiple statements, one entry). Splitting them into two versions would create a window in which the settings row and the new column both exist and disagree.

- **`launch_profiles` carries real `REFERENCES` clauses** — `provider_id` → `provider_configs(id)`, `credential_profile_id` → `credential_profiles(id)`, both **nullable**, both enforced. **This is the deliberate inverse of 3a-1's `dispatches` ruling** and the reasoning must appear in the commit message: a dispatch is an immutable historical fact that must survive its subject's deletion; a launch profile is a **live instruction** that becomes a lie the moment its target is gone. RESTRICT is the correct semantic *because* it forces the refusal to be authored in main.
- **`sessions.launch_profile_id` carries NO `REFERENCES` clause** — a **soft pointer**, deliberately. A session row is history in the same sense a dispatch is, and a FK here would make deleting a launch profile throw for every session that ever used it. See Step 2's fail-safe.
- **The data migration is pure SQL, JSON1-free.** It writes the sentinel `'legacy-credentialed'` into `sessions.launch_profile_id` for every id named in the `credentialed_sessions` settings value, then **deletes that settings row**. The exact statements, the `COALESCE` guard against an absent row, and the rejected `json_each` alternative are in the spec.
- **⚠ REHEARSE BEFORE YOU BOOT.** Copy the real DB to a scratch path, run v9 against the copy (`_verify/3a-5/rehearse-v9.js`), and assert the two known ids came out marked and the settings row gone — **before** the first real migrating boot. A data migration that touches the live `sessions` table on a database holding a real credential's neighbours does not get to be tested in production.

### 2. The derived credentialed predicate — fail-safe, and named

`sessionIsCredentialed` in `launchProfiles.ts`, pure and unit-tested:

| `sessions.launch_profile_id` | Profile resolves? | `profile.credential_profile_id` | Result |
|---|---|---|---|
| NULL | — | — | **false** — no profile, no credential, restorable |
| set | yes | NULL | **false** — a route-less or subscription profile holds no credential |
| set | yes | set | **true** |
| set | **no** (deleted profile, or the `'legacy-credentialed'` sentinel) | — | **TRUE — fail safe** |

**The fail-safe row is the load-bearing one.** An unresolvable pointer means Chorus *cannot prove* the session was keyless, and the only safe reading of "cannot prove" is "do not restore it keyless". It is also what makes the legacy migration honest: the retired settings list recorded session ids and **nothing else** — no profile id, no provider, no credential — so there is no data from which to synthesize a profile, and **inventing one would put a fake row in the user's picker.** The sentinel is a pointer that deliberately does not resolve.

`StorageService.getCredentialedSessionIds(projectId)` gains its project parameter here — the debt retirement made visible in the signature — and `isSessionCredentialed(sessionId)` serves `session:restart`. **`markSessionCredentialed`, `unmarkSessionCredentialed` and `writeCredentialedSessionIds` are deleted**, and `session:delete` loses its unmark call: the fact now dies with the row, structurally.

### 3. Rule the last-used scope — **PER-PROJECT**, keyed by id

**Ruling: the last-used pointer is per-project, stored in `settings` under `last_launch_profile:<projectId>`, and it stores the profile's immutable ID.**

The evidence, read off the real DB rather than asserted:

| Key | Scope | What it is |
|---|---|---|
| `view_state:985d547b…`, `view_state:f47ac10b…` | **per-project** | which pane arrangement and which focused session — a *working-context* fact |
| `active_project_id` | global | which project is on screen — a genuinely app-global fact |
| `window_bounds` | global | app chrome |
| `recent_cwds` | global | **an existing wart**: one entry, `C:\Projects\ContactEstablished\Chorus`, offered in *both* projects' launch dialogs. Observed, cited as the cautionary precedent, **not fixed here.** |
| `credentialed_sessions` | global | **the expedient this task deletes** |

A launch profile choice is a working-context fact of exactly the `view_state` kind: the profile you last used in *Chorus* tells you nothing about what you want in *Chorus-Second*, and defaulting the second project's dialog to the first project's choice is the same category error `recent_cwds` already commits. The roadmap criticised `credentialed_sessions` for being global; **retiring one global-by-default fact and creating another in the same commit would be indefensible**, and the per-project keying costs one string interpolation because `getViewState`/`setViewState` already established the pattern.

**It stores the id, and only the id, for the reason D43 gives:** *"anything that stores a reference stores the **id**, while the label … stays freely renameable."* A last-used pointer holding a label would silently lose its default the first time a user renamed `OR/DeepSeek v4 Pro` to something shorter — a rename must never have a downstream consequence. **A dangling pointer (the profile was deleted) resolves to "no default", never to a fuzzy label match**; main returns `null` and the dialog behaves exactly as it does today.

**Written by MAIN, on a successful launch only.** The renderer never computes or sends the default: main writes the pointer after `sessions.launch` returns, and returns it on `session:launch-context`. A failed launch leaves the previous default intact.

### 4. Resolve a profile at launch — the payload stays authoritative where it must

`launchRequestSchema` gains `launch_profile_id?: uuid`. The division of authority, stated once so it is not re-invented at the call site:

- **The profile supplies:** the credential (its `credential_profile_id`), the route (its `provider_id`), the model (precedence table above), the effort, the permission mode, and the env map.
- **The payload supplies:** `agent`, `cwd`, and `workspace_mode` — because the user can change all three in the dialog after picking a profile, and because `cwd` is the **security boundary** main validates itself (absolute + exists) and must never take from a stored row without re-validating.
- **`launch_profile_id` and `credential_profile_id` are MUTUALLY EXCLUSIVE.** Both present → inline refusal. One resolver, one source of truth for the credential.
- **`payload.agent` must equal the profile's `agent`** → otherwise an inline refusal. Main never trusts the renderer, and a mismatched pair is a renderer bug, not a user intent.
- **The credential resolution reuses `resolveCredential` unchanged**, including its five ordered refusals and its label-only messages. This task adds a caller, not a second decrypt path.

The profile's `env_json` merges into the child environment through `composeChildEnv`'s `envAdditions` channel, **main-side only**, after a non-secret refusal check reusing the `extra_headers_json` precedent (run it through `scrubSecrets` and **refuse** if it carries a known key shape). The full precedence chain — inherited → pins (D54) → adapter additions → profile env → `secretEnv` — is in the spec and **must be confirmed against 3a-1's shipped order** before it is written.

`sessions.launch_profile_id` is written on the **same** insert as the session row, so a crash cannot leave a credentialed session unmarked.

### 5. The dialog defaults to the last-used profile

The picker lists profiles by **label**, distinct rows for distinct routes, in the user's own words. Choosing one prefills agent, workspace mode and credential; the user may override anything before launching. **Selecting no profile is first-class** — a dialog with no saved profiles must behave exactly as it does today (the 3-6 discipline: no visible change unless you use the feature).

A profile whose target is **unavailable** is **shown, disabled, and explained** — never hidden. This deliberately departs from 3-6's `eligibleProfiles`, which hides `unavailableSince` credential profiles: a *credential* profile is plumbing, but a **launch profile is a thing the user named**, and a named entry that silently vanishes is worse than a named entry that says why it cannot launch. The disabled reason names the credential **by label** and nothing else.

### 6. One-click relaunch — the ratified restore ruling

**Restore stays decision (b), unchanged and unweakened.** Credentialed sessions heal to `exited`, keep the title `Credential not re-supplied — relaunch from the dialog to re-enter it`, and `session:restart` keeps refusing them inline. **There is NO unattended boot-time decryption**, because D33 never sanctioned decrypting with no user present and this task must not introduce it by the side door.

What is added is a **Relaunch** control on the healed session's pane, backed by a new `session:relaunch` channel:

- It is reachable **only** from a user gesture. No boot path, no timer, no restore path, no palette default, no auto-retry.
- It resolves the session's `launch_profile_id`, then `resolveCredential`, then spawns under the **same row id** (the `session:restart` shape: read the row, re-validate cwd, write `'running'` only after the spawn succeeds).
- **It refuses, inline, when:** the session is live; the cwd is gone; the agent is unknown; `launch_profile_id` is NULL or unresolvable (**including every legacy sentinel row** — those say "use the launch dialog", which is exactly today's flow and exactly what the healed title already tells the user); the credential is `unavailable_since`; or decryption fails.
- **`session:restart` keeps refusing credentialed rows with its existing message** — the two controls are different verbs and the refusal is what makes the difference legible. Restart means "same configuration, no credential"; Relaunch means "same configuration, credential re-resolved because you asked".

**The invariant, stated as an invariant:**

> **No code path reachable without a user gesture may call `vault.decryptForLaunch`, `safeStorage.decryptString`, or anything that resolves a credential's plaintext.** At `15a016e` there are exactly **two** call sites, both inside `registerIpc`. After this task there are exactly **three**, all inside `registerIpc`, all inside an `ipcMain.handle` body. `SessionManager` still contains **zero** references to the vault.

**The reviewer check that proves it** — two halves, both required, because either alone is defeatable:

1. **Structural (grep, offline).** `grep -rn "decryptForLaunch\|safeStorage" src/` returns call sites **only** inside `registerIpc` in `src/main/ipc.ts` (plus `vault.ts`'s own implementation). `grep -rn "vault" src/main/services/sessionManager.ts` returns **zero**. `grep -rn "vault\|decrypt" src/main/index.ts` shows the vault **constructed and passed to `registerIpc`, and nothing else**.
2. **Runtime (instrumented cold boot, then reverted).** Temporarily add one log line at the top of `vault.decryptForLaunch`. Cold-boot with **a credentialed `running` row present** (the real DB has one today — `246c087b…`). Assert the boot log shows the `[restore] credentialed session healed -> exited` line and **ZERO** decrypt lines. Then click **Relaunch** and assert **exactly one**. **Then revert the instrumentation and prove the revert against the COMMIT DIFF, not the worktree** (Task 2-4 precedent).

A structural check alone can be defeated by an indirection; a runtime check alone can be defeated by a boot that happened to have nothing to decrypt. **Both, or the invariant is unproven.**

### 7. Referential fragility — count and refuse BEFORE SQLite throws

Extend the `ProviderDelete` discipline rather than re-deriving it:

| Delete | Guard | Message shape |
|---|---|---|
| `provider:delete` | existing `countCredentialProfilesForProvider` **plus new `countLaunchProfilesForProvider`** | names the count and the profile word, as today |
| `credential:delete` | **new `countLaunchProfilesForCredential`** — today it has no guard at all and would throw | names the count and points at the profiles |
| `launch-profile:delete` | none needed — sessions hold a **soft** pointer; the fail-safe predicate absorbs the dangling result | — |

**Never reverse-engineer a caught `SQLITE_CONSTRAINT_FOREIGNKEY` into a user message.** The `UNIQUE(label)` constraint gets the same treatment: check first, and keep the catch only as a backstop that emits a fixed string (the vault's duplicate-label precedent).

### 8. Tests, then `npm run typecheck` / `npx vitest run` / `npm run grep:secrets`.

### 9. The three-dump migration protocol and the runtime drive (G2). Both below.

## Test Expectations

**Unit (Vitest), `src/main/services/launchProfiles.test.ts`** — every function pure, time injected, no storage, no Electron:

- **`sessionIsCredentialed` — one named test per row of Step 2's table.** The **fail-safe** row (`launch_profile_id` set, profile does not resolve → `true`) is **the most important test in the task**: it is what makes the retired settings list's two legacy ids behave identically to before, and it is exactly the branch a future refactor will "simplify" into `false`.
- **The `'legacy-credentialed'` sentinel is not special-cased anywhere.** Assert it flows through the ordinary unresolvable-pointer path, so deleting a real profile behaves identically to a legacy row.
- **`resolveLaunchProfile` model precedence — three named tests** matching the table: profile model wins; NULL profile model falls back to the route default; both NULL emits no model. **Assert the profile row is not mutated** — no back-writing of the route default.
- **Agent/route agreement.** A create/update whose `agent` disagrees with the provider's `adapter_type` is refused. A route-less profile (`provider_id` NULL) is accepted and keeps its own `agent`.
- **`existing-worktree` is refused** at create and update; `current-tree` and `new-worktree` are accepted.
- **A credential belonging to a different provider than the profile's route is refused.**
- **An `unavailable_since` credential yields a `disabled`-with-reason resolution, not a hidden one** — assert the resolution carries a reason naming the credential **by label**, and that the reason contains **no** provider URL, no env var value, and no substring of any key.
- **`defaultProfileLabel`** produces `<provider name>/<model display name>` per D43, and a route-less profile gets an honest label that names the agent instead. **Assert the label is never used as a key anywhere** in the returned resolution.
- **`env_json` validation:** a map containing a value matching a `secret-patterns.json` shape is **refused**; a normal map passes; a non-object, a nested object, and a non-string value are all refused.
- **The resolved plan carries no key material** — assert over the resolution object's **full key set**, the 3-2 discipline. `resolveLaunchProfile` never sees plaintext by construction; the test is what keeps it that way.

**Unit (Vitest), `src/shared/ipc.test.ts`:**

- `launchRequestSchema` accepts a payload with `launch_profile_id`, one with `credential_profile_id`, and one with neither (all three first-class); **the mutual exclusion is enforced in MAIN, not by schema branching** — assert the schema accepts both-present and that a main-side test refuses it, so the refusal is where the reason string can be authored.
- `launchContextResponseSchema` parses with the profile list and a `null` last-used id.
- Every new response schema's **parse output key set** contains no field capable of carrying key material — including `launchProfileWireSchema`, which carries a credential **profile id** and its **label** and nothing else.
- The relaunch response admits the snapshot shape and `{ok:false, reason}`.

**Unit (Vitest), storage-level (in whichever suite the repo keeps DB-touching tests, against a temp DB):**

- **The data migration converts a fixture settings row into per-session sentinels and deletes the row** — and is a **no-op** when the settings row is absent, when it is `'[]'`, when it is malformed JSON, and when it names an id no longer in `sessions`. Four named tests; the malformed case is the one that would otherwise take down a boot.

**No test may contain a real credential, a real key fragment, or anything copied out of the dev vault**, and `npm run grep:secrets` must pass afterwards.

**Runtime (G2) carries the migration proof, the no-boot-decrypt proof, and the real relaunch.** No unit test can establish any of the three.

## Verification Commands

Run from repo root in **PowerShell**.

```
npm run typecheck
```

```
npx vitest run
```

```
npm run grep:secrets
```

```
npm run dev
```

**The retirement greps — all four must be empty over `src/`:**

```
Select-String -Path src -Include *.ts,*.vue -Recurse -Pattern "credentialed_sessions"
Select-String -Path src -Include *.ts,*.vue -Recurse -Pattern "markSessionCredentialed"
Select-String -Path src -Include *.ts,*.vue -Recurse -Pattern "unmarkSessionCredentialed"
Select-String -Path src -Include *.ts,*.vue -Recurse -Pattern "writeCredentialedSessionIds"
```

**The no-boot-decrypt greps:**

```
Select-String -Path src -Include *.ts -Recurse -Pattern "decryptForLaunch|safeStorage"
Select-String -Path src\main\services\sessionManager.ts -Pattern "vault"
```

**⚠ The migration v9 proof — the FULL three-dump protocol, exactly as Tasks 3-2, 3-6 and 3a-1 ran it.** A short DDL does not earn a short proof: the risk lives in the runner and the real database, and **this migration is the only one in the phase that MUTATES existing rows.**

**Rehearse first, on a copy:**

```
New-Item -ItemType Directory -Force _verify\3a-5 | Out-Null
Copy-Item "$env:APPDATA\chorus\chorus.db" _verify\3a-5\rehearsal.db
$env:ELECTRON_RUN_AS_NODE = '1'
& node_modules\electron\dist\electron.exe _verify\3a-5\rehearse-v9.js _verify\3a-5\rehearsal.db
```

Then the real protocol:

```
$env:ELECTRON_RUN_AS_NODE = '1'
& node_modules\electron\dist\electron.exe _verify\3a-5\dump-v9.js "$env:APPDATA\chorus\chorus.db" _verify\3a-5\pre.json
```

Cold-boot the app (electron-vite does **not** hot-restart main), tree-kill it, dump to `post.json`; boot a second time, tree-kill, dump to `boot2.json`. Assert, **quoting the evidence**:

1. `schema_migrations` shows **8 → 9** (or whatever the read-first version turns out to be), applied **in place**; `applied_at` for **every prior version is byte-identical** pre and post. Known-good values to check against: v4 `2026-07-20T16:57:49.534Z`, v5 `2026-07-23T13:04:06.301Z`, v6 `2026-07-24T15:52:22.591Z`.
2. Every pre-existing table is **row-identical** across pre / post / boot-2 — `projects`, `sessions` (**except** the two migrated `launch_profile_id` cells and the documented boot-heal of `246c087b…`), `worktrees`, `pane_layouts`, `settings` (**except** the deleted `credentialed_sessions` row), `provider_configs`, and `credential_profiles` **over its non-secret columns plus `length(encrypted_blob)`**. **Every exception is enumerated in advance, above — an unlisted difference is a failure, not a surprise.**
3. **The data migration landed exactly:** `sessions.launch_profile_id = 'legacy-credentialed'` for **`1099b5d4-9df9-4c02-ad7d-6d1b239c2f63`** and **`246c087b-897c-4b8e-84c1-72528a5c08b4`**, `NULL` for **every other session row**, and **no `settings` row with key `credentialed_sessions` exists** post-migration.
4. **`launch_profiles` exists, is empty**, and its `sqlite_master` DDL carries the two `REFERENCES` clauses and the `UNIQUE(label)` constraint.
5. **Boot 2 does not re-apply v9** — its `applied_at` is byte-identical between `post.json` and `boot2.json`, and the `sessions` rows are unchanged from `post.json`.
6. The standing `wt-24b5c1fe` worktree row is intact.

**⚠ Provenance (F20).** **Quote the `projects` table in every dump.** The coordinator re-verifies on the real dev DB and needs to see the real pair — `985d547b-d152-4a07-9094-ddb8da56ef8f` (Chorus) and `f47ac10b-58cc-4372-a567-0e02b2c3d479` (Chorus-Second). A dump showing `a43b395d…`/`b684e96e…` is the redirected database and does **not** discharge this criterion.

**⚠ The `sqlite3` CLI is NOT installed.** Use the `ELECTRON_RUN_AS_NODE` script pattern only. **Known flake: the script intermittently writes no file on its first invocation — retry once.** **The dump script must NOT `SELECT *` from `credential_profiles`.**

**The behaviour-preservation proof — the retirement must be invisible.** On the migrating boot, confirm from the main log and a `sessions` dump:

1. `246c087b…` (credentialed, `running`) heals to `exited` with title `Credential not re-supplied — relaunch from the dialog to re-enter it` and logs `[restore] credentialed session healed -> exited (no keyless restore): 246c087b-897c-4b8e-84c1-72528a5c08b4`. **Byte-identical to 3-6's behaviour, from a different data source.**
2. A **non**-credentialed `running` row with a layout leaf still relaunches normally in the same boot — the negative control, without which check 1 is consistent with restore being broken entirely.
3. `session:restart` on a healed credentialed session still refuses inline with its existing message.

**The no-boot-decrypt proof (the hard invariant).** Both halves of Step 6's reviewer check, with the instrumented-boot log quoted: **zero** decrypt lines across a boot that healed a credentialed session, **exactly one** after a Relaunch click. Then **revert the instrumentation and prove the revert against the commit diff.**

**The end-to-end profile proof, driven through the REAL launch dialog.** ⚠ This spends real money on Matthew's OpenRouter account — a single short prompt, expected well under $0.05.

1. Save a launch profile over the live route: label `OR/Kimi K3`, agent `codex`, provider `OpenRouter`, credential `OR milestone key`, model left NULL so the route default (`moonshotai/kimi-k3`) applies by precedence rank 2.
2. Launch from it. Confirm the agent **answers a prompt** and that `sessions.launch_profile_id` holds the profile's id.
3. **The five-surface check, abbreviated but not skipped** (3-6's vocabulary): walk the process tree from the electron main PID via `ParentProcessId` — **never name-matching**, there are ~16 unrelated `claude.exe` on this machine — and confirm **no command line contains the key or any ≥ 8-character substring of it**, while the child's **environment block does** carry it under `OPENROUTER_API_KEY` (`_verify/3-6/read-env.ps1`). The **positive** half is not optional: absence everywhere is also what a completely broken injection looks like.
4. **Kill the app, cold-boot.** The session heals to `exited` with the contract title. **Click Relaunch.** Confirm: the agent comes back on the same row id, answers again, and the log shows exactly one decrypt.
5. **Rename the profile mid-flight** to `OR/Kimi (renamed)` and confirm the relaunched session, the last-used default, and `sessions.launch_profile_id` are **all unaffected** — the D43 id-vs-label property, proven rather than asserted.

**The default-scoping proof.** Launch from a profile in project **Chorus**; switch to **Chorus-Second**; open its launch dialog and confirm **no profile is preselected**. Return to Chorus and confirm the default is still there. Then dump `settings` and confirm exactly one `last_launch_profile:985d547b…` key exists and **no global `last_launch_profile` key** does.

**The referential-fragility proof.** With the profile saved: attempt `credential:delete` on `OR milestone key` → **inline refusal naming the count**, no throw, no `SQLITE_CONSTRAINT_FOREIGNKEY` in the log. Attempt `provider:delete` on `OpenRouter` → same. Delete the **launch profile** first, then confirm both deletes proceed. **Then re-create both**, because the OR route and its key are standing fixtures.

**The dangling-profile proof.** Save a second profile with a **planted fake key**, launch from it, kill the session, **delete the profile**, then cold-boot. Confirm: the session's `launch_profile_id` still holds the deleted id, the fail-safe predicate classifies it **credentialed**, restore heals it rather than relaunching it keyless, and **Relaunch refuses** with the use-the-dialog message. Then delete the planted credential and provider.

**The legacy-row proof.** On the healed `1099b5d4…` (sentinel) row, click **Relaunch** and confirm the refusal points at the launch dialog. That row is the only real evidence that the retirement preserved the legacy population's behaviour.

**Harness reminders.** CDP on `--remote-debugging-port=9222` is the proven driver; `_verify/3-6/eval-*.js` are the shapes to copy. **⚠ The Task 3-4 lesson, still binding: CDP-driven Vue forms need a microtask tick between `input` and the submit click, or the click lands on a stale `:disabled`.** Kill process **trees** (`taskkill /PID <root> /T /F`); the graceful-quit test is `taskkill` **without** `/F`. Every main-process change needs a real cold boot.

## Acceptance Criteria

- [ ] `npm run typecheck` — zero errors, node and web (G1).
- [ ] `npx vitest run` — green, the then-current baseline (273/273 across 14 files at `15a016e`, plus whatever 3a-1 … 3a-4 added) **intact and grown**.
- [ ] `npm run grep:secrets` — clean (G4, mandatory), including over any new `_verify/3a-5/` artifacts.
- [ ] **Migration v9 (or the read-first next free version) applied IN PLACE on the real dev DB with zero data loss** — the three-dump protocol, with all prior `applied_at` byte-identical, every pre-existing table row-identical **except the enumerated exceptions**, and v9 not re-applied on boot 2. **The coordinator re-verifies on the REAL DB (F20)**; a dump that does not quote `985d547b…` / `f47ac10b…` does not discharge this.
- [ ] **The migration version was READ from the shipped `MIGRATIONS` array, not assumed**, and any divergence from v9 is reported as a finding.
- [ ] **The two live `credentialed_sessions` ids migrated exactly** — `1099b5d4…` and `246c087b…` carry the sentinel, every other session row is NULL, and **the `credentialed_sessions` settings row no longer exists**. Quoted from the dumps.
- [ ] **The migration was REHEARSED on a copy of the real DB before the first real boot**, with the rehearsal output quoted.
- [ ] **THE HARD INVARIANT: no unattended boot-time decryption.** Both halves of the reviewer check pass — the structural greps, and the instrumented cold boot showing **zero** decrypts across a boot that healed a credentialed session and **exactly one** after a user's Relaunch click. **The instrumentation was reverted and the revert proven against the COMMIT DIFF, not the worktree.** An unproven invariant is a **FAIL**, not a pass with a caveat.
- [ ] **Restore behaviour did not regress** — same healed `exited` status, the **verbatim** title `Credential not re-supplied — relaunch from the dialog to re-enter it`, the verbatim log line, and `session:restart`'s inline refusal, all proven on the real migrating boot with the non-credentialed negative control alongside.
- [ ] **The global list is GONE** — all four retirement greps empty, `markSessionCredentialed` / `unmarkSessionCredentialed` / `writeCredentialedSessionIds` deleted, and the credentialed fact now per-session and project-scoped.
- [ ] **One-click relaunch works end to end on a REAL credentialed session** — healed by a real boot, relaunched by a real click, agent answered.
- [ ] **`launch_profiles` implements D43's triple** — immutable id, renameable label, distinct rows for distinct routes to the same model — and **the rename proof ran**: renaming a profile left the last-used default, `sessions.launch_profile_id` and a live relaunch all unaffected.
- [ ] **The last-used default is PER-PROJECT and stores the ID** — proven by the two-project drive and by a `settings` dump showing `last_launch_profile:<projectId>` and no global key.
- [ ] **Referential fragility is handled by count-and-refuse BEFORE SQLite throws** — both delete guards proven at runtime, with **no `SQLITE_CONSTRAINT_FOREIGNKEY` anywhere in the log**.
- [ ] **A profile pointing at a deleted or unavailable target is SHOWN, DISABLED and EXPLAINED, never hidden**, and its reason names the credential **by label only** — no URL, no env var value, no key fragment.
- [ ] **The model-precedence table was ADOPTED from 3a-4, not re-derived**, and no second home for "which model" was created — the profile's NULL model is resolved from the route at launch and **never back-written**.
- [ ] **The effort vocabulary was IMPORTED from 3a-4** (`effortLevelSchema` / `EffortOption`), with no second enum, union, or literal set anywhere in `src/`, and a profile's effort reaches the CLI **only** through 3a-4's `LaunchOptions.effort` → `resolveEffortArgs` seam. Grep-verified, and proven at runtime by launching from a profile carrying a non-default effort and reading the resulting **command line** (`Get-CimInstance Win32_Process`).
- [ ] **No key crosses IPC in either direction, and no new schema field can carry key material** — key-set assertions on every new response schema.
- [ ] **`permission_mode` is stored and consumed by nothing, and NO adapter file changed.** Grep-verified — `src/main/adapters/` is byte-identical across this commit.
- [ ] **No new adapters, no registry widening** — `agentKindSchema` still `'claude' | 'codex'`, D34 Q5 not lifted.
- [ ] **No api-mode code landed** — `startApiSession` still unimplemented, no session-type split, D45(4) intact.
- [ ] **No board or panel** — the only new surfaces are the dialog picker and a list/rename/delete affordance.
- [ ] **ONE** narrated commit (G3), touching only the Exact Scope rows, whose message states: the version read from the array, the retirement of the global list and why, the `REFERENCES`-vs-`dispatches` inversion and why, the per-project scoping ruling, and **that restore option (a) remains declined**.
- [ ] **The two untracked `TASK-3-*-REVIEW-FABLE.md` files are still present, unmodified and unstaged**, and no `_verify/` or `docs/` file was staged or reverted.
- [ ] The standing `wt-24b5c1fe` worktree row, directory and branch are **untouched**.

## Review Checklist

- [ ] **THE FIRST AND LAST CHECK: find the boot-time decrypt.** Read `src/main/index.ts`'s `app.whenReady` block, `SessionManager.restore`, `SessionManager.spawn`, and every boot reconcile, looking specifically for a path that reaches the vault. Then read the new `session:relaunch` handler and confirm it is reachable **only** from `ipcMain.handle`. A helper shared between relaunch and restore is the shape this fails in: it will look like sensible reuse and it will decrypt at boot. **If both halves of the proof are not in the summary, send it back** — a summary that reports "relaunch works" without the zero-decrypt boot log has proven the feature, not the invariant.
- [ ] **Read the fail-safe branch for an inversion.** `sessionIsCredentialed` returning `false` for an unresolvable pointer is a one-character change that compiles, passes every happy-path test, and **silently restores credentialed sessions keyless** — the exact F26 failure the phase already paid for. Confirm the named unit test would fail against it.
- [ ] **Check the data migration against an ABSENT and a MALFORMED settings row.** The live DB has a well-formed one, so the failure lands on a machine that never had the row — where a throw inside the runner's transaction **fails the boot outright**. Confirm the `COALESCE` guard and confirm the unit tests cover both.
- [ ] **Grep the migration entry for `REFERENCES` and check each one deliberately.** `launch_profiles` **must** have them (provider, credential); `sessions.launch_profile_id` **must not**. Getting this backwards produces two distinct bugs: a launch profile that cannot be deleted, and a session row that cannot be deleted. Both surface as `SQLITE_CONSTRAINT_FOREIGNKEY` in a flow that has worked since Task 1-5.
- [ ] **Read both delete guards for the count-then-delete race and the message shape.** They must count and refuse **before** the statement runs, and the message must be authored, never reverse-engineered from a caught constraint error (the failure Task 2-3 already paid for once).
- [ ] **Check every pointer for a label where an id belongs.** `sessions.launch_profile_id`, `last_launch_profile:<projectId>`, the relaunch target, the dialog's preselect. A label anywhere is D43 violated, and it will not fail until someone renames something.
- [ ] **Confirm the last-used key is interpolated with the project id.** A missing `:${projectId}` compiles, works perfectly in single-project testing, and recreates the exact global-scoping debt this task exists to retire. Confirm a `settings` dump was actually read.
- [ ] **Confirm `resolveCredential` was reused, not forked.** A second decrypt path — even one that looks identical — doubles the surface that must satisfy D33's clause 8 refusals, and the two will drift. There must be exactly **one** function that calls `vault.decryptForLaunch` for a launch.
- [ ] **Trace the decrypted value's lifetime end to end on the RELAUNCH path**, the same read the 3-6 review did for launch: `decryptForLaunch` → one local → `secretEnv` → `composeChildEnv` → child env → the `SessionOutput` match set → dropped. **No log line, no error message, no retained property, no `JSON.stringify` of any object containing it, no write back to any row.**
- [ ] **Confirm the scrubber registration still happens in the same synchronous block as `pty.spawn`** on the relaunch path. A relaunch that constructs its `SessionOutput` one tick later loses or fails to scrub the first chunk — which is exactly when a shell may echo its environment.
- [ ] **Read the launch handler for a profile that overrides `cwd`.** The cwd security boundary (absolute + exists, main-side) must be applied to whatever is launched, **every time**, and a stored profile is untrusted input like any other. A profile that supplies `cwd` at all is a scope escape.
- [ ] **Confirm `env_json` cannot deliver a secret or override a pin.** Read the precedence chain against 3a-1's shipped `composeChildEnv`, and confirm the non-secret refusal reuses `scrubSecrets` rather than a new pattern list.
- [ ] **Confirm unavailable profiles are shown-and-disabled, not filtered.** A `.filter(...)` copied from 3-6's `eligibleProfiles` is the likely implementation and it is wrong here for a named user row — check the template, not just the computed.
- [ ] **Read the dialog's `submit()` for a store-sourced payload (D14).** The existing fresh-literal-of-primitives comment is there because a Vue reactive Proxy fails structured clone **with no compile-time signal**. A profile object spread straight into the payload is the regression, and it will throw only at runtime.
- [ ] **Check that `sessions.launch_profile_id` is written on the SAME insert as the row**, not in a follow-up update. A crash between the two leaves a credentialed session unmarked — the silent-keyless-restore failure, reintroduced through the back door.
- [ ] **Read the dump script before it is run.** It must not `SELECT *` from `credential_profiles`: the vault holds a real billable key, and a careless `*` puts an encrypted blob into a JSON artifact that then gets quoted into a summary.
- [ ] **Check the summary for an unproven migration claim.** A dump quoting `a43b395d…` is the F20-redirected database and proves nothing about the real one. Send it back rather than reasoning around it.
- [ ] No untracked / `_verify/` / `docs/` files staged or reverted; both `TASK-3-*-REVIEW-FABLE.md` untouched.
