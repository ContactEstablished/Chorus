# Task 3a-4: `model_catalog` + Refresh, and Effort Normalization — Execution Prompt

## Role

You are the Coordinator for Chorus — Foundation **Phase 3a, Task 3a-4** (`model_catalog` + refresh, and effort normalization).

Repo root: `C:\Projects\ContactEstablished\Chorus`

Expected branch: `main` — confirm with `git branch --show-current`; do **NOT** switch or create branches without instruction.

**Expected code HEAD for `src/` at start: `f56dcaf`** (Task 3a-3 — per-dispatch token & cost attribution). One docs-only commit sits on top (`c3d8ec4`, the roadmap update) and may be followed by this prompt's own commit; **no production code has changed since `f56dcaf`.**

Platform: Windows 11, PowerShell 7.

Chorus is a local-first, BYOK Electron + Vue 3 + TypeScript desktop app for running multiple AI coding agents in parallel terminal panes. Windows-only v1.

## ⚠ STOP — read these two preconditions before writing code

**1. The authenticated-refresh proof needs a credential that decrypts IN YOUR BOOT CONTEXT, and it may not (F31).**

`--user-data-dir` reaches the real database but **not the DPAPI context**. Task 3a-3 lost an hour to this: it booted the dev app from a raw harness shell, opened the right DB, and then found that **both credential blobs written the previous day failed to decrypt** — `[vault] decrypt failed; profile marked unavailable` — while a profile created in the same boot decrypted fine. `safeStorage.isEncryptionAvailable()` was `true` throughout. The mechanism is recorded as **UNPROVEN**; do not repeat a guess as fact.

**What this means for you, concretely:**

- The **unauthenticated** refresh path needs no credential at all and is a **first-class shipped behaviour**, not a fallback — verified 2026-07-24 that `GET https://openrouter.ai/api/v1/models` answers 200 with no `Authorization` header. **Do that half first.** It carries most of the catalog acceptance.
- The **authenticated** refresh drive (catalog drive step 3) needs `OR milestone key` to decrypt. **Probe decryptability EARLY** — before you have built anything that depends on it — by observing whether a boot marks the profile `unavailable_since`, or by the diagnose pattern in `_verify/3a-3/eval-vault-diagnose.js`.
- **If it does not decrypt: STOP and ask Matthew to re-enter the key through the running app's Settings UI.** That is a **human** step. **Never ask for the key's text in chat, never read it from a file, never accept it in any form, never write it to disk yourself.** D33 clause 8 will already have marked the row `unavailable_since`; `replaceProfile` → `updateCredentialBlob` clears the mark on re-entry (proven in anger in 3a-3).
- **Tell him NOT to press "Test key"** while he is in there — it is a live billable call on his account and nothing in this task needs it.

**2. This task's cost envelope is $0.00, and that is a verified figure, not an optimism.**

`GET https://openrouter.ai/api/v1/models` is a public, unauthenticated, non-metered list endpoint (verified 2026-07-24). The effort proof's evidence is the **argv of the live child process**, read externally — **do not submit a prompt to any agent** over the OpenRouter route. **If a step seems to require a real completion, stop and ask.** Task 3a-3 already owns the paid conversational proof, and it overran its own envelope ($0.533 against `< $0.30`) — do not add to that on a task whose proofs are free.

## Goal

Give Chorus an honest, cached answer to *"what models does this route actually offer?"* — and turn the app-level **Fast / Balanced / Deep / Max** slider from a PLAN §4 paragraph into a real, per-adapter-mapped launch control.

**⚠ THE MOST IMPORTANT OUTPUT OF THIS TASK IS NOT CODE — IT IS THE MODEL-PRECEDENCE RULING.** D48 exists because "which model" briefly had two competing homes, and the cost was a migration in the phase's most security-critical session. This task introduces a **third** artefact that talks about models, and a catalog is the single most natural place for a second authority to grow back.

| Rank | Home | Role | May be NULL? |
|:--:|---|---|:--:|
| **1 (wins)** | `launch_profiles.model` | the choice for THIS launch (Task 3a-5) | yes |
| **2** | `provider_configs.model` (v6, D48) | this route's DEFAULT | yes |
| **3 (floor)** | *nothing* | the CLI's own default — **no `-m` emitted at all** | — |
| **— (not in the order)** | **`model_catalog`** | **a LIST OF WHAT EXISTS** | the whole table may be empty |

**`model_catalog` is not authoritative over either other home and never writes to them.** A catalog miss **warns**; it never blocks, clears, defaults, or substitutes. The provider is the authority on whether a model id resolves — **F-36-4 is exactly that lesson** — and a stale cache used as a gate turns a warning into an outage. These sentences are reproduced verbatim in the code comment above the DDL and in the commit message.

### One Commit in This Session

**ONE intentional narrated commit (G3).** The two-commit amendment was Task 3a-1's alone (D54) and does not carry forward. No chore commit is sanctioned here — if a pre-existing defect surfaces, **raise it rather than folding it in**.

## Ground Yourself First

Read these before editing anything. Paths are relative to repo root.

- `CLAUDE.md` — locked stack; **D1** Zod-in-main; **D14** plain-object IPC; secrets via safeStorage injected as env vars, never in argv/logs/transcripts; **D4** verify CLI flags against the tool's own `--help` **at execution time**.
- `docs/Features/Foundation/Tasks/Task-3a-4.md` — **GOVERNS SCOPE.** 447 lines; read all of it. The four Goal rulings, the Exact Scope table, the Non-Goals, the D4 obligation list, the Acceptance Criteria and the Review Checklist are binding.
- `docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-3a-4.md` — **GOVERNS EXACT CONTENTS.** 599 lines. Key sections: **§1** the migration (EXACT DDL + the Drizzle mirror) · **§2** storage accessors and the provider-delete purge · **§3** the precedence order worked for all twelve combinations · **§4** `modelCatalogCore.ts`'s normative surface · **§5** the transport and the EXACT sanitized-failure matrix · **§6** IPC by symbol · **§7** effort normalization and the `args` ruling · **§8** renderer · **§9** the runtime proofs.
- `docs/Features/Foundation/Tasks/Phase-3a-Overview.md` — the phase contract, the file-ownership matrix, the gates (G1–G5), and the standing conditions.
- `docs/Features/Foundation/roadmap.md` — §5 (**F16**, **F20**, **F27**, **F29**, **F31**, F-36-4), §6 (**D33, D42, D45(4), D47, D48, D49, D50, D55**), §7 Phase 3a.
- `docs/PLAN.md` **§4** (adapter abstraction; *"One app-level slider — Fast / Balanced / Deep / Max — mapped per adapter; raw override always available in `extra_args`"*; *"LaunchDialog renders only what the selected adapter's capabilities allow"*) and **§13** (the target data model's `model_catalog`).

### Code to Inspect — anchored to NAMED SYMBOLS, never line numbers

All verified present by the coordinator **2026-07-25 at `f56dcaf`**:

- `src/main/ipc.ts` — **`probeCredential` and its helper `probeFailure`.** Read both line by line before designing any network call. The discipline you inherit verbatim: trailing-slash-stripped `baseUrl`; provider `extra_headers_json` parsed defensively and overridden by the envelope's; **the response body cancelled without being read** (*"a 401 body can echo the submitted key"*); status codes mapped to a **fixed vocabulary**; every exception collapsed to `'Could not reach the provider.'`; every outbound string through `scrubSecrets`. **`credential:test` / `probeCredential` are UNTOUCHED by this task** — not refactored, not re-pointed, not made to share a helper.
- `src/main/ipc.ts` — `resolveCredential` (nested in `registerIpc`): the decrypt-at-use discipline, and the pattern for a refusal that happens **before** any decryption is attempted.
- `src/main/services/storage.ts` — `const MIGRATIONS: string[]`, the private `migrate()` runner over `schema_migrations`, `deleteProviderConfig` (its comment directs callers to `countCredentialProfilesForProvider` rather than reverse-engineering an FK throw), and the two existing `this.d.transaction((tx) => …)` sites.
- `src/main/db/schema.ts` — the Drizzle mirrors. **`primaryKey` is NOT currently imported**; add it to the `drizzle-orm/sqlite-core` import.
- `src/main/services/vaultCore.ts` — `failureMessage(kind, label)`, the label-only vocabulary. `src/main/services/vault.ts` — `decryptForLaunch`.
- `src/main/services/logger.ts` — `scrubSecrets`.
- **Pure-core precedents** (this is the module shape for `modelCatalogCore.ts` and `effort.ts`): `vaultCore.ts`, `computeRestoreSet` in `restore.ts`, `computeWorktreeReconcile` in `worktrees.ts`, and 3a-3's `attributionCore.ts`. **No `electron`, no `fetch`, no `node:fs`, no clock — time is a parameter.**
- `src/main/adapters/types.ts` — `AgentCapabilities`, **`EffortOption` (`{id, label, cliFlag}`)**, `EffortDescriptor` (`{mode, levels}`), `PtyLaunchSpec.effortOptionId` (**already declared, never read**), and `PtyAgentAdapter.buildLaunch`'s comment: ***"SYNCHRONOUS by necessity: SessionManager.launch() is synchronous."***
- `src/main/adapters/claude.ts` / `codex.ts` — `getCapabilities()` declares `reasoningEffort: null` in both, with a comment naming Phase 3a as the owner. **That seam is this task.** `codex.ts`'s `buildLaunch` already emits `-c` dotted-path overrides through its local `tomlString` quoter and `-m <model>` from `spec.route.modelId` — **reuse `tomlString`; do not write a second quoter.**
- `src/main/adapters/env.ts` — `composeChildEnv`; its D54 ordering (inherited < pins < `envAdditions` < `secretEnv`) is the precedence idiom your effort resolver mirrors deliberately.
- `src/main/services/sessionManager.ts` — `LaunchOptions` (`secrets` / `credential` / `route`) and the private `spawn(...)` that builds `PtyLaunchSpec`.
- `src/renderer/src/stores/settings.ts` — `SettingsState` (flat `providers` / `profiles` / `adapters`), the store-level `loadSeq` supersede token, and the `refuse(reason)` helper. **There is an existing deep-scan unit test over `$state` proving the store holds no key material — it must still pass.**
- `src/renderer/src/views/SettingsProviders.vue` — `fModel` (a **free-text** input, added in 3-6/D48) and `fBaseUrl`. `src/renderer/src/views/SettingsCredentials.vue` — the Test-key button with `testingId` / `testResult`, the idiom your Refresh button follows.
- `src/renderer/src/components/LaunchDialog.vue` — renders from the **wire** (`adapter:list`), per D34(f).

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

## ⚠ The task doc and spec were authored against `15a016e` and are STALE in eight places

Tasks 3a-1, 3a-2 and 3a-3 all landed in between. **These are the corrected facts, all re-verified by the coordinator 2026-07-25 at `f56dcaf` and against the real dev DB.** Where a doc and this table disagree, **this table wins** — but confirm each yourself before acting on it.

| The docs say | Actually, now |
|---|---|
| Baseline `273/273 across 14 files` | **513/513 across 20 files**; typecheck **0** (node + web); `grep:secrets` **clean (6 patterns)** |
| Migration is *"v8 if 3a-3 added none, v9 if it did"*; the docs say "v8" throughout for readability | **3a-3 DID take v8** (the mint ledger). **`MIGRATIONS.length` is 8 → your migration is `v9`.** Confirm `MIGRATIONS.length + 1 === 9` before appending; **stop and report divergence** rather than renumbering silently. |
| Harness script named `_verify/3a-4/dump-v8.js` | Name it **`dump-v9.js`**. Cosmetic, but a `dump-v8.js` in a v9 session is a trap for the reviewer. |
| Verify against `%APPDATA%\chorus\chorus.db` | **WRONG, and this is F20 + F31.** The real dev DB is `C:\Users\matth\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\chorus\chorus.db`. Electron ignores the `APPDATA` env var but honours `--user-data-dir`. **Copy `_verify/3a-3/start-realdb.ps1` into `_verify/3a-4/`** and boot with it. A dump quoting projects `a43b395d…`/`b684e96e…` is the scratch DB and **discharges nothing**. |
| *"Write the `auth_mode === 'management'` refusal even if 3a-3 has not landed"* | 3a-3 landed, and **a real management row now exists**: provider `OpenRouter admin` (id `e947ee75-3482-43d2-97bd-f9a802f44213`, `adapter_type` `claude`, `auth_mode` `management`, **`base_url` `https://openrouter.ai/api/v1`**) with credential `OR Management Key`. **The refusal has a live runtime fixture — drive it, do not merely assert it.** Note the base URL is set, so without your check a refresh against that row would genuinely fire. |
| `provider_configs` has one live row | **THREE.** See the real-DB table below. |
| *"`credential:test` is the ONLY existing live-call channel"* | Stale. 3a-3 added automatic management-key calls (`openrouterKeys.ts` → `/api/v1/keys*`, `/api/v1/analytics/*`). The honest narration is: **`model:refresh` is the second USER-INITIATED channel that sends a user's stored INFERENCE credential**, and it is admitted on D33 resolution (d)'s terms. Do not repeat the stale sentence in the commit message. |
| Spec §9.5 grep gate: *"zero `cliFlag` remaining anywhere in `src/`"* | **WRONG AS WRITTEN — do not chase it to zero.** `ResumeDescriptor.cliFlag` (`src/main/adapters/types.ts`) and `resumeDescriptorSchema.cliFlag` (`src/shared/ipc.ts`) are a **different field on a different descriptor** and are out of scope. Current: **6** hits. **Expected after your change: exactly 2**, both `ResumeDescriptor`-related, and **zero** inside `EffortOption` / `effortOptionSchema` / any test fixture. |

**Also current** (these move every task, so confirm rather than cite): `registerIpc` now takes **six** positional parameters — `(sessions, storage, worktrees, vault, attention, attribution)`; `IpcChannel` has **37** entries and `src/main/ipc.ts` has **34** `ipcMain.handle(` registrations. **This task takes them to 39 and 36.**

**Installed CLI versions, coordinator-checked 2026-07-25 at prompt authoring:** `claude --version` → **2.1.218 (Claude Code)**; `codex --version` → **codex-cli 0.145.0**. **These are a starting point, not a discharge — D4 requires you to re-run them yourself this session.** Both CLIs moved twice in three days during Phase 3.

### The real dev DB, dumped read-only by the coordinator 2026-07-25 (`_verify/3a-4/real.json`)

- **`schema_migrations`: v1–v8.** Known-good `applied_at` values your three-dump protocol must show **byte-identical** pre and post: v4 `2026-07-20T16:57:49.534Z` · v5 `2026-07-23T13:04:06.301Z` · v6 `2026-07-24T15:52:22.591Z` · **v7 `2026-07-25T12:50:53.246Z`** · **v8 `2026-07-25T20:46:53.759Z`**.
- **Ten tables**: `attention_spans`, `credential_profiles`, `dispatches`, `pane_layouts`, `projects`, `provider_configs`, `schema_migrations`, `sessions`, `settings`, `worktrees`. **`model_catalog` does not exist** (confirmed: `no such table`).
- **`projects` (F20's provenance pair):** `985d547b-d152-4a07-9094-ddb8da56ef8f` Chorus · `f47ac10b-58cc-4372-a567-0e02b2c3d479` Chorus-Second. **Quote this table in every dump.**
- **`provider_configs`** (column order after v6's in-place ALTER: `id, name, adapter_type, auth_mode, env_var_name, base_url, extra_headers_json, created_at, model`):
  - `6c052ee6-1eb3-4d7c-8aa3-832bd19dfd13` — **OpenRouter** · `codex` · `api_key` · `OPENROUTER_API_KEY` · `https://openrouter.ai/api/v1` · model **`moonshotai/kimi-k3`**
  - `fb5fb8dc-fad6-44ce-a336-506ccb932e24` — Anthropic direct · `claude` · `api_key` · no base URL · no model
  - `e947ee75-3482-43d2-97bd-f9a802f44213` — **OpenRouter admin** · `claude` · **`management`** · `https://openrouter.ai/api/v1` · no model
- **`credential_profiles`** (non-secret columns + `length(encrypted_blob)` only): `OR milestone key` (blob 114 B, `last_verified_at` **`2026-07-25T20:13:22.131Z`**, `unavailable_since` **null**) · `Claude fake key` (blob 104 B, **`unavailable_since` `2026-07-25T19:41:02.933Z`** — a real D33-clause-8 row, and therefore a **free live fixture** for your refuse-by-label path) · `OR Management Key` (blob 114 B, on the management provider).
- **72 `dispatches` rows** and **65 `attention_spans` rows** — both must be row-identical across pre / post / boot-2.
- **The standing worktree fixture:** id `9ba9b0da-cecd-4960-815d-f36166cf8c00`, branch `chorus/Chorus/24b5c1fe`, `session_id` null. **Do not remove the row, the directory, or the branch.**

`_verify/` is **entirely gitignored**, so nothing you put there can be staged. The coordinator's `_verify/3a-4/dump-coord.js` and `real.json` are there already — read or adapt them, but your `dump-v9.js` owes the fuller three-dump shape (`PRAGMA table_info`, all pre-existing tables, `model_catalog`).

## Decisions You Must Honour — all RESOLVED, none open

- **D48 (2026-07-24)** — `provider_configs.model` is the **route's DEFAULT**, "a default, not an authority", and the one-home anti-goal. The governing decision for half this task.
- **D33 (in full)** — clause 3 (write-only inbound IPC), clause 8 (**refuse, never degrade** — a row carrying `unavailable_since` is refused **without re-attempting decryption**), resolution (d) (the Test-key carve-out: user-initiated only, *"never at boot, launch, on a timer, or on profile creation"*), resolution (e) (provider `extra_headers_json` is documented **non-secret**).
- **D45(4)** — api mode is **declared-only**. `ApiAgentAdapter.getModels` has zero implementations and **gains none here**. Your refresh is a standalone main-process service. `getModels` looks like the natural home and is barred.
- **D7** — Drizzle is types + queries only; migrations stay in the hand-rolled `MIGRATIONS` array. **Never drizzle-kit.**
- **D42 / D55** — a telemetry number never ships without its denominator, enforced by the outbound schema. Your refresh response carries **counts** (`added` / `updated` / `missing` / `dropped`), never lists of ids in the failure path, and never a field capable of carrying key material.
- **F16** — FKs are **ENFORCED**. That is precisely why `model_catalog` carries **no `REFERENCES` clause** and the provider-delete purge is explicit. Same reasoning 3a-1 reached independently for `dispatches`.
- **F20 + F31 (standing)** — see the correction table. Every DB claim is re-verified by the coordinator against the real path.
- **F27** — the honest wording about redaction is *"Chorus redacts registered exact values on ingest; it cannot redact values an agent derives"* — **never** "agents cannot echo the key".
- **F-36-4** — `moonshotai/kimi-k2.7` was never a real OpenRouter slug; `probeCredential` surfaced the provider's 400 as the sanitized `Unexpected response (400).`, which correctly proved auth passed and the model id was wrong. **That failure is the reason this table exists** — the catalog's job is to make it legible at pick-time rather than at launch-time.

## Pre-Existing Changes — Do Not Touch

The working tree contains exactly **two** untracked files at repo root:

```
?? TASK-3-5-REVIEW-FABLE.md
?? TASK-3-6-REVIEW-FABLE.md
```

**Do NOT revert, stage, delete, or commit them.** They belong to prior sessions' review record. (`TASK-3-4-REVIEW-FABLE.md` is tracked and committed — leave it alone too.) Never stage or revert anything under `_verify/` or `docs/` unless a step explicitly says so. **Stage scope files EXPLICITLY by path — never `git add -A` (D40).**

## ⚠ Standing condition — the dev vault holds a REAL, BILLABLE credential

Matthew's real OpenRouter key lives in the real dev vault under **"OR milestone key"**. His key, his vault, his machine, deliberately left in place.

1. **Never dump, echo, print, copy, or transmit `credential_profiles.encrypted_blob` or `fingerprint_hash`.** Select non-secret columns explicitly and prove blob stability with `length(encrypted_blob)` — a byte count is not key material and is sufficient evidence that a migration did not touch the blob. **The 3-6 dump script `SELECT *`s from `credential_profiles`; yours must not.**
2. **Do not press "Test key" on "OR milestone key" at any point.** It is a live billable call and this task's refresh is a different call.
3. **No test, fixture, or `_verify/` artifact may contain a real credential or a real key fragment.** `npm run grep:secrets` must pass over `_verify/3a-4/` too.

## Implementation Scope

**Nineteen files, exactly as `Task-3a-4.md`'s Exact Scope table** (which governs; this is the summary):

- **CREATE** `src/main/services/modelCatalogCore.ts` (+ `.test.ts`) — the **PURE** core: response parsing, per-row validation, the refresh diff, the staleness predicate, the sanitized failure vocabulary. No `electron`, no `fetch`, no `node:fs`, no clock.
- **CREATE** `src/main/services/modelCatalog.ts` (+ `.test.ts`) — the **ONLY** module in the repo that fetches `${baseUrl}/models`. Thin transport, injectable `fetchImpl`, timeout, size cap; decrypts at the moment of the call and drops it; delegates every decision to the core.
- **CREATE** `src/main/adapters/effort.ts` (+ `.test.ts`) — the pure `resolveEffortArgs(descriptor, level, extraArgs)` and the recognised-knob predicate. Sits beside `env.ts`.
- **EDIT** `src/main/db/schema.ts` — the `modelCatalog` table + inferred types (spec §1.4, EXACT).
- **EDIT** `src/main/services/storage.ts` — **migration v9** (spec §1.2, EXACT), the four accessors (spec §2), and the **provider-delete purge** inside `deleteProviderConfig`'s own transaction.
- **EDIT** `src/main/adapters/types.ts` — `EffortOption.cliFlag: string` → **`args: readonly string[]`**, `id` tightened to the four-level vocabulary.
- **EDIT** `src/main/adapters/claude.ts` · `codex.ts` — populate `reasoningEffort` with the **D4-verified-this-session** descriptors; `buildLaunch` consumes `spec.effortOptionId` + `spec.extraArgs` via `resolveEffortArgs`.
- **EDIT** `src/shared/ipc.ts` — `ModelList` + `ModelRefresh` channels and their schemas; `effortLevelSchema`; `effortOptionSchema.cliFlag` → `args`; `session:launch`'s request gains optional `effort`.
- **EDIT** `src/main/ipc.ts` — the two handlers (registered **immediately after** the `CredentialTest` handler), and threading `effort` into `LaunchOptions`.
- **EDIT** `src/preload/index.ts` — two Zod-free typed forwarders (`listModels`, `refreshModels`). `index.d.ts` is never hand-edited.
- **EDIT** `src/main/services/sessionManager.ts` — `LaunchOptions` gains `effort?` / `extraArgs?`, both passed into `PtyLaunchSpec`. **No other behaviour change, and `buildLaunch` stays synchronous.**
- **EDIT** `src/renderer/src/stores/settings.ts` · `views/SettingsProviders.vue` · `components/LaunchDialog.vue`.
- **EDIT** `src/shared/ipc.test.ts` · `src/main/adapters/adapters.test.ts`.
- **CREATE (untracked harness)** `_verify/3a-4/dump-v9.js` and the drive scripts.

**No `.vue` file beyond the two named.** If a change seems to require another file — **especially `vault.ts`, `vaultCore.ts`, or anything 3a-1/3a-3 created — stop and raise it.** That is a scope signal, not a detail.

## Strict Non-Goals

- **No `UPDATE provider_configs`, anywhere in the diff.** No clearing, no defaulting, no "helpful" substitution of a retired model. This is the failure the whole task exists to prevent, and it will look like a convenience at the call site.
- **No `launch_profiles` — that is Task 3a-5.** No table, no column, no schema definition, no IPC channel, no "temporary" place to persist a chosen effort level or model. **The effort level chosen in the dialog is per-launch and unpersisted, deliberately.**
- **No raw-`extra_args` INPUT SURFACE.** You ship the precedence rule and its pure resolver, plumbed through `PtyLaunchSpec`. The text field arrives in 3a-5, which must carry the warning this task records: **`extra_args` becomes argv, and argv is world-readable** (`Get-CimInstance Win32_Process`). A free-text argv field in the same commit as a second key-bearing network call is a blast-radius decision nobody has made.
- **No api-mode implementation** — `getModels` keeps zero implementations, `ApiAgentAdapter` keeps zero instances, `startApiSession` stays unimplemented, `SessionManager` stays PTY-only (D45(4)).
- **No auto-refresh of any kind** — not at boot, on Settings open, on provider create, on credential create, on launch, or on a timer.
- **No `tier` column**, though PLAN §13 names one — nothing can fill it honestly. **Narrate the deviation in the commit message.**
- **No pricing, no cost estimation, no model recommendation, no context-window-driven behaviour.** `context_length` is **stored and displayed**, never reasoned over. Pricing is not stored at all.
- **No model-capability probing** (`supported_parameters`, modalities, tool support). `EffortDescriptor.mode: 'dynamic'` is the declared seam for a later phase; **do not populate it dynamically here.**
- **No change to `credential:test` / `probeCredential`** — not a refactor, not a shared-helper extraction, not a re-point.
- **No second migration**, **no new npm dependency** (Node's built-in `fetch`), **no new agent kind** (`agentKindSchema` stays `'claude' | 'codex'`), **no board / dispatch panel / Mission Control UI**.
- **Do not touch the two `TASK-*-REVIEW-FABLE.md` files or the `wt-24b5c1fe` fixture.**

## Required Workflow

Work as coordinator: implement → review the diff against the Implementation Spec → a code-quality pass → resolve findings → run the gates → narrate the commit. **Do NOT push and do NOT open a pull request unless explicitly asked.**

Ordered work steps (`Task-3a-4.md` §Step-by-step governs; this is its numbering):

1. **The D4 pass, FIRST and REPORTED** — obligations 1–6 below, before any code. Obligation 2 is the highest-risk.
2. **Read the shipped `MIGRATIONS` array and settle the version number.** Expected `MIGRATIONS.length + 1 === 9`. Write it down; state it in the commit message with `SELECT version FROM schema_migrations` as evidence.
3. **Migration + Drizzle mirror**, exactly as spec §1.2 / §1.4. One entry, applied atomically in the runner's existing per-version transaction. **Grep the migration string for `REFERENCES`: zero hits.**
4. **Storage accessors** (spec §2), rows-in-rows-out, **including the provider-delete purge in one transaction**. Every policy decision lives in the core, not here. **The existing count-and-refuse on `credential_profiles` is untouched** — profiles still block a delete; a catalog never does.
5. **`modelCatalogCore.ts` — the pure half first.** Row validation, the four-population diff, the three-state freshness predicate, the fixed failure vocabulary. **Write its unit table before the transport exists.**
6. **`modelCatalog.ts` — the transport.** One `fetch`, injectable `fetchImpl`, timeout, size cap, **body read ONLY on 2xx and cancelled unread on every other path**, every outbound string through `scrubSecrets`. Decrypt at the call, drop immediately — **no module-level variable, no memo**. Three refusals happen **before** any decryption: no `base_url`; the profile carries `unavailable_since` (refuse **by label only**); the provider's `auth_mode === 'management'`.
7. **The two IPC handlers + preload forwarders + store actions + the provider-card UI.** All Zod in main (D1); plain objects across the bridge (D14); both handlers **outbound-`.parse`** their response.
8. **`effort.ts` — the pure resolver**, then the two adapter descriptors, then `buildLaunch` consuming them, then the `LaunchOptions` / `PtyLaunchSpec` plumbing, then the dialog control. **In that order** — the mapping is a fact about the CLIs and should be tested before any UI can obscure it.
9. **Tests**, then the three gates.
10. **The three-dump migration protocol and the runtime drives (G2).**

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

**Baseline to beat, coordinator-verified 2026-07-25 at `f56dcaf`:**
- typecheck: **0 errors** (node + web)
- vitest: **513/513 across 20 files**
- grep:secrets: **clean (6 patterns over `src/`, `scripts/`, `_verify/`, `package.json`, root configs)**

### ⚠ The D4 obligations — six, each verified and recorded with what you ran and when

**A remembered flag is a D4 violation regardless of whether it happens to be right.** The authoring-time values are in `Task-3a-4.md` and spec §7.2 — they narrow the obligation, they do not discharge it.

1. **Re-run `claude --help`** and confirm `--effort <level>` and its five levels (`low, medium, high, xhigh, max`) still read as recorded.
2. **⚠ THE WEAKEST FACT IN THE AUTHORING SET, AND IT IS LOAD-BEARING.** Confirm `model_reasoning_effort` is **actually accepted** by the installed codex **by SETTING ONE** — `-c model_reasoning_effort="high"` on a real launch — not by trusting the author's binary-string reading. **A string in a binary is evidence of a symbol, not proof of an accepted value.** If it is not accepted as an argv `-c` override, **the codex half of the mapping has no mechanism and this task's acceptance changes — stop and report before building on it.**
3. **Establish what codex does with a level the selected MODEL does not support** — silent clamp, config-load rejection, or runtime error. codex 0.145.0 carries `supportedReasoningEfforts` / `defaultReasoningEffort` **per model**. This decides whether the collapsed mapping is safe or needs a per-model guard, and it cannot be reasoned out.
4. **Re-verify `GET <base_url>/models` is reachable and unauthenticated** for the live route, and record the response's top-level shape. **If it has become auth-gated, that is a finding — and per Goal §3 it still does not merge refresh with Test key**, because the merge would then hold for one provider and silently not for another.
5. **Confirm whether `expiration_date` is populated on any live model** and in what format. If universally null, capture the column anyway (it is free) but do not build the pre-emptive warning on it.
6. **Measure the response size** so the transport's cap is set from a measurement, not a guess. Leave generous headroom — the list is hundreds of models.

### The migration proof — the FULL three-dump protocol, on the REAL DB

A short DDL does not earn a short proof: the risk lives in the runner and the real database, not in the statements.

```powershell
New-Item -ItemType Directory -Force _verify\3a-4 | Out-Null
$env:ELECTRON_RUN_AS_NODE = '1'
& node_modules\electron\dist\electron.exe _verify\3a-4\dump-v9.js "C:\Users\matth\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\chorus\chorus.db" _verify\3a-4\pre.json
```

Then boot the app once (**cold** — electron-vite does not hot-restart main) via your copy of `start-realdb.ps1`, tree-kill it, dump to `post.json`; then boot a second time, tree-kill, dump to `boot2.json`. Assert, **quoting the evidence**:

1. `schema_migrations` shows **8 → 9**, applied **in place**; **every prior version's `applied_at` is byte-identical** pre and post (the known-good values are listed above). That is the proof it migrated rather than recreated.
2. Every pre-existing table is **row-identical** across pre / post / boot-2 — `projects`, `sessions`, `worktrees`, `pane_layouts`, `settings`, `provider_configs`, **`dispatches` (72 rows)**, **`attention_spans` (65 rows)**, and `credential_profiles` **over its non-secret columns plus `length(encrypted_blob)`**. Zero data loss.
3. `model_catalog` exists with the exact column list and types spec §1.2 gives, and is **empty** immediately after the migrating boot.
4. **Boot 2 does not re-apply the migration** — its `applied_at` is byte-identical between `post.json` and `boot2.json`.
5. The `wt-24b5c1fe` worktree row is intact.
6. **Provenance (F20): quote the `projects` table in every dump.** `985d547b…`/`f47ac10b…` or it discharges nothing.

**`sqlite3` is NOT installed** — use the `ELECTRON_RUN_AS_NODE` pattern only. **Known flake, confirmed live during prompt authoring: the script writes no file on its first invocation — retry once.**

### The catalog runtime drive (G2) — through the real Settings UI

Full detail in `Task-3a-4.md` §"The catalog runtime drive". The eight steps in short, with the three that carry the acceptance marked:

1. **Empty state** — the *never refreshed* state renders as its own thing, not a spinner and not an empty list styled as stale. Screenshot.
2. **Refresh, unauthenticated** (no credential profile selected) — success, populated list, fresh timestamp. Dump `model_catalog`; quote the row count and three rows. **Confirm `moonshotai/kimi-k3` is present and `moonshotai/kimi-k2.7` is ABSENT** — that pairing is the F-36-4 fact this table exists to surface.
3. **Refresh, authenticated** with "OR milestone key" — same result; then sweep the main log for any key, fragment, or `Authorization` value, and confirm **`last_verified_at` is UNCHANGED** (`2026-07-25T20:13:22.131Z` as of now). A refresh is not a Test key and must not pretend to be. *(Needs a decryptable credential — see precondition 1.)*
4. **⚠ The idempotence proof** — refresh twice; the second adds **no duplicate rows** and updates `refreshed_at` in place. The composite PK is what makes this work and it is invisible in a single-press test.
5. **The staleness proof** — hand-edit `refreshed_at` to 48 h ago via a dedicated `_verify/3a-4/` script (**never by hand-editing production code paths**), cold-boot, confirm the card renders **stale** with an age, the list is **still shown**, and nothing about launching changed.
6. **⚠ THE MISSING-MODEL PROOF — the most important runtime check in the catalog half.** Insert a fabricated row for an id OpenRouter does not serve (e.g. `chorus-test/does-not-exist`), **set `provider_configs.model` to it**, press Refresh, and confirm, quoting each: `missing_since` set and the row **not deleted**; **`provider_configs.model` UNCHANGED — dump the row before and after and show them byte-identical** (this is the runtime statement of the precedence ruling); the warning renders on the provider card **and** in the launch dialog; a launch is **still permitted**; a second refresh does **not** move `missing_since`. **Then restore `provider_configs.model` to `moonshotai/kimi-k3`, remove the fabricated row, and prove the restoration with a dump.**
7. **The provider-delete purge** — create a throwaway provider, give it catalog rows, delete it: `provider:delete` **does not throw**, the provider row is gone, **its catalog rows went with it**. Then confirm deleting a provider that still has credential profiles is **still refused** by the pre-existing count-and-refuse.
8. **The failure paths** — a throwaway provider pointed at an unreachable host, and at a host returning a non-JSON 200: both produce the **fixed sanitized reason** inline, no crash, no provider body in the DOM, no change to the existing catalog. **Plus the two refusals you now have live fixtures for:** a refresh naming `Claude fake key` (carries `unavailable_since`) must refuse **by label** with **no decryption attempted**, and a refresh against **`OpenRouter admin`** (`auth_mode = 'management'`, and it *has* a base URL) must refuse **before any call goes out**.

### The effort runtime drive (G2) — the argv read is the proof

1. **Absence** — with an adapter whose `reasoningEffort` is null, the control **does not render**: no greyed slider, **no explanatory text**. Screenshot.
2. **Presence and mapping** — launch `codex` from the real dialog at each of the four levels. Read the live child's command line with `Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, CommandLine`, **walking the descendant tree from the electron main PID — never name-matching** (there are ~16 unrelated `claude.exe` on this machine; `_verify/3a-3/find-child-pids.ps1` is the proven walker). **Quote all four command lines.**
3. **Claude's half** — same for `claude` and `--effort`, quoting at least two levels.
4. **⚠ The suppression proof** — with an `extraArgs` value containing the adapter's effort knob, the argv carries the override **once** and Chorus's own effort token **zero times**. Then confirm an unrelated extra arg does **not** suppress it. (Supply it through the resolver's test seam — there is no input surface in this task.)
5. **No secret in argv, still** — over every command line captured: **no key, no fragment ≥ 8 characters of any key.** This task adds argv tokens for the first time since 3-6, which is exactly when this check earns its keep.
6. **The behaviour-neutrality check** — a launch with **no** effort chosen produces a command line **byte-identical** to the pre-change launch for the same inputs. **Capture one before the change and one after, and diff them.** This is the check that proves you did not quietly alter every launch in the app.

**⚠ Do not submit a prompt in any of these launches.** The argv read is the whole proof.

### Grep gates — run before the commit, quote the counts

- **zero** `UPDATE provider_configs` and zero writes to any model column outside `model_catalog`'s own rows;
- **zero** `REFERENCES` in the new migration string;
- **exactly 2** `cliFlag` hits in `src/`, both `ResumeDescriptor`-related — **zero** in `EffortOption` / `effortOptionSchema` / any fixture (see the correction table; do **not** chase this to zero);
- **zero** hardcoded effort-level labels (`'Fast'` / `'Balanced'` / `'Deep'` / `'Max'`) driving choices in `.vue` files — levels and labels come from the descriptor via `adapter:list`;
- **zero** calls to the refresh service from `src/main/index.ts`, a `whenReady`, an `onMounted`, or any watcher — **the refresh is user-initiated only**, and a convenience call at Settings-open would send the user's key without them asking;
- **zero** `switch` on the effort level inside either `buildLaunch` — if one appears, the mapping has two homes, in the task whose headline output is a one-home ruling.

### Harness caveats — verified through 2026-07-25

- **electron-vite does NOT hot-restart the main process**; HMR covers the renderer only. **Every main-process change needs a real cold boot.**
- **Boot against the real DB** with `--user-data-dir=C:\Users\matth\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\chorus` — copy `_verify/3a-3/start-realdb.ps1`.
- **Graceful quit:** `taskkill` **without** `/F` (WM_CLOSE) does **not** terminate the dev app in this session. Use a CDP `window.close()` evaluate — same close path. Kill process **TREES** with `taskkill /PID <root> /T /F` for the crash cases.
- **CDP on `--remote-debugging-port=9222`** is the proven driver (`_verify/3a-3/cdp.js`). **Wrap every `Runtime.evaluate` body in an IIFE** — top-level `const` collides across evaluates. CDP-driven Vue forms need a microtask tick between `input` and submit-click.
- **⚠ Vite's SPA fallback poisons CDP-driven file reads:** `fetch('some.txt')` inside the page returns `index.html`. The correct pattern is `fetch('/@fs/C:/absolute/path')`. This once caused a full launch to run on an HTML "credential".
- **The dev window is NOT foregrounded by default** in a harness session, and other desktop apps steal foreground mid-run (F29). Foreground deliberately (`_verify/3a-3/focuswindow.ps1`) and verify before any screenshot-based check.
- **Never type into a CLI whose input mode you have not read first** — screenshot and read the pane before sending keystrokes.
- All artifacts under `_verify/3a-4/`.

## Failure Honesty Clause

If any verification command fails for an unrelated environment reason, **capture the EXACT output, explain it, and DO NOT claim success.** An indeterminate result is reported as indeterminate and the affected acceptance criterion is marked **FAILED** — never reasoned into a pass. An unproven claim is worse than an honest unknown, because it will be cited later as evidence. **A remembered CLI flag is a D4 violation regardless of whether it happens to be right.** Temporary instrumentation must be reverted, and the review checks the **COMMIT DIFF**, not the worktree.

## Final Reporting Requirements

Report a status of exactly one of **DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED**, plus:

- **The six D4 obligations**, each verified or explicitly recorded as still-unverified, with what you ran and when. **Obligation 2 called out separately** — if `model_reasoning_effort` was not proven accepted by a real launch, say so plainly, because the codex half then rests on a binary-string reading.
- **The commit SHA and every file changed** (only the Exact Scope files), with the `MIGRATIONS.length` before and after (**8 → 9**) and the `SELECT version FROM schema_migrations` evidence.
- **Typecheck / vitest / grep:secrets results with actual numbers**, against the 0 / 513-across-20 / clean-6-patterns baseline.
- **The three-dump protocol results**, with prior `applied_at` values quoted, the `projects` pair quoted, `dispatches` and `attention_spans` row counts shown identical, and `model_catalog` shown created empty and not re-applied on boot 2.
- **The missing-model drive's before/after `provider_configs` row dump, shown byte-identical** — the runtime statement of the precedence ruling — plus confirmation the fabricated state was restored and the restoration dumped.
- **The idempotence result** (second refresh: zero new rows, `refreshed_at` updated in place) and **the three freshness states** shown as three distinguishable renderings.
- **The two live refusals driven, not asserted:** `Claude fake key` refused by label with no decryption attempted; `OpenRouter admin` (`auth_mode = 'management'`) refused before any call went out.
- **The provider-delete purge, driven against a genuinely deleted provider** — the delete did not throw, the catalog rows went with it, and a provider with credential profiles is still refused.
- **All four codex command lines and at least two claude command lines, quoted**, plus the suppression proof (override once, Chorus's token zero times) and the unrelated-arg non-suppression.
- **The behaviour-neutrality diff, quoted** — no-effort launch byte-identical before and after.
- **The log sweep after the authenticated refresh** — no key, no fragment, no `Authorization` value — and **`last_verified_at` shown unchanged**.
- **The grep gate counts**, each quoted, including the `cliFlag` count with its two legitimate `ResumeDescriptor` hits named.
- **Confirmation of the narration requirements in the commit message:** the precedence ruling in the words above; the `tier` omission and its reason; the `cliFlag` → `args` replacement with its zero-producers evidence; and **the widening of D33 resolution (d) by exactly one user-initiated key-bearing call**, with its five constraints (user-initiated only · decrypt-at-use · refuse `unavailable_since` · refuse `auth_mode = 'management'` · credential optional) each proven or asserted.
- **Actual cost**, against the **$0.00** envelope, and confirmation that Test key was never pressed against "OR milestone key" and no completion was submitted.
- **Confirmation each non-goal held:** no `UPDATE provider_configs` anywhere; no `launch_profiles`; no `extra_args` input surface; `getModels` still zero implementations and `ApiAgentAdapter` still zero instances; no `tier` column; no second migration; no new dependency; `IpcChannel` 39 and `ipcMain.handle(` 36; only the two named `.vue` files touched.
- **Confirmation the two `TASK-*-REVIEW-FABLE.md` files are still untracked and unmodified**, nothing under `_verify/` or `docs/` was staged or reverted, and the `wt-24b5c1fe` worktree row, directory and branch are intact.
- **Residual risks and known gaps**, and the **final `git status --porcelain`**.
