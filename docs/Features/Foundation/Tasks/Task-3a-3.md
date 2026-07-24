# Task 3a-3 — Per-Dispatch Token & Cost Attribution (and the multi-turn proof)

_Third task of Phase 3a (Profiles & Catalog). Windows-only. **ONE narrated commit (G3).** This task governs **scope**; `ImplementationSpecs/ImplementationSpec-3a-3.md` governs exact contents, module shape, and insertion points. **G4 `npm run grep:secrets` is mandatory and LOAD-BEARING here** — this is the first task in the repo that **mints, stores, and revokes live credentials of its own**, so the Phase 3 prime directive binds it in full._

> **⚠ COORDINATOR RULING — migration numbering, 2026-07-24. This supersedes every conditional "v8 or v9" phrasing below.** The five task docs were authored in parallel and each hedged its own migration number against the others. Because Phase 3a executes **strictly serially**, the numbers are deterministic and are fixed here: **3a-1 → v7 · 3a-3 → v8 · 3a-4 → v9 · 3a-5 → v10.** **This task DOES take a migration.** The mint ledger is durable crash-reconciliation state — the whole point is that it survives the crash — so it is a table, not a `settings` JSON blob; putting it in `settings` would recreate the "second competing home" mistake D48 exists to prevent. **Standing check for every implementer:** confirm `MIGRATIONS.length + 1` equals your expected number before appending, and if it does not, **stop and report the divergence** rather than renumbering silently — a mismatch means a prior task shipped something its doc did not describe.

**⚠ THIS TASK SPENDS REAL MONEY.** The real dev vault holds Matthew's real, billable OpenRouter key ("OR milestone key", `last_verified_at 2026-07-24T17:04:26.840Z`). Every verification run below makes live calls. Cost envelope and the mandatory hard `limit` are specified in **Verification Commands**.

## Source Of Truth

- `docs/Features/Foundation/roadmap.md` §7 **Phase 3a** — the phase entry, in particular its three ⚠ bullets: *telemetry first* (D41/D50), *`usage_records`'s producer is OpenRouter, not LiteLLM* (D42), and *attribution is keyed on AUTH MODE* (D42).
- Roadmap §6 **D42** (2026-07-24) — the contract this task implements. Three clauses are normative here: (1) **`api_key` sessions get a per-dispatch OpenRouter key** minted via the Provisioning API with a hard `limit`, revoked and read back at dispatch end; (2) **`subscription` sessions are NEVER gateway-routed** and are metered from the CLI's own local session logs at lower fidelity; (3) **"% of spend attributed" is surfaced** so the gap is visible rather than silently under-reported. D42's closing operational note — *"OpenRouter's Management API key is a distinct, higher-privilege credential class … neither `provider_configs` nor `credential_profiles` has a slot for it today"* — is settled by this task (Step 3).
- Roadmap §6 **D41** — Mission Control admitted; its telemetry slice pulled forward into 3a. **`tokens_cached` tracked separately** is part of the admission, not a refinement of it.
- Roadmap §6 **D47 / D49 (F-36-1)** — the OpenRouter route as shipped, and the limit this task's Step 0 exists to remove: *"single-turn is PROVEN end-to-end … multi-turn and compaction are UNPROVEN … Whichever phase next ships conversational work over this route must prove multi-turn before depending on it."* **That phase is this one, and that task is this one.**
- Roadmap §6 **D48** — `provider_configs.model` is the ROUTE's default model, and **the anti-goal this task inherits**: no second competing home for a fact that already has one. Applied here to tokens: **there is exactly ONE telemetry table, 3a-1's, and this task fills its columns.**
- Roadmap §6 **D33** — the vault security contract, in full. Clauses 4, 5 and 8 and resolution (a) bind a **minted** key exactly as hard as a user key.
- `docs/Features/Mission Control/chorus-mission-control-spec.md` **§5.1** (the token/cost source, the naive-`metadata` failure, the three things per-dispatch keys buy, and the cached-input warning) and **§9 Phase 0** (*"No UI. No board."*; acceptance = *"dispatches appear in the store with non-zero token counts attributed to the right agent and model"*).
- `docs/Features/Foundation/Tasks/Phase-3-Overview.md` — the cross-cutting rules survive the phase boundary unchanged: all Zod in main (D1/CSP), plain-object IPC (D14), secrets never in argv/logs/transcripts, **never widen the blast radius to prove a feature**.
- `CLAUDE.md` — **D4**: verify vendor endpoints, request shapes and revocation semantics against the vendor's own current documentation at execution time. The verification already performed at authoring is recorded below; **it does not discharge the execution-time obligation**, it narrows it.
- Task **3a-1** (dispatch telemetry, migration v7) and Task **3-6** (`15a016e`, the shipped OpenRouter route) — both consumed.

## Initial Starting Point

**Verified by the coordinator 2026-07-24 against `15a016e`** (code HEAD for `src/`). Re-verify at execution; 3a-1 lands between this doc and its execution and **moves the schema underneath it**.

- **Baseline (coordinator-verified 2026-07-24):** `npm run typecheck` exits 0 · `npx vitest run` = **273/273 across 14 files** · `npm run grep:secrets` clean (**6 patterns**).
- **The working tree carries two untracked files — `TASK-3-5-REVIEW-FABLE.md` and `TASK-3-6-REVIEW-FABLE.md`.** They are **not** this task's business: do not commit them, do not delete them, do not revert them.
- **The OpenRouter route works and is proven end-to-end, for ONE TURN.** `codexAdapter.buildLaunch` (`src/main/adapters/codex.ts`) emits `-c model_provider=…`, `-c model_providers.<key>.name=…`, `.base_url=…`, `.env_key=…`, `.wire_api="responses"` and `-m <model>`, all through the `tomlString` quoter. **`wire_api` MUST be `"responses"`** — 0.145.0 hard-rejects `"chat"` at config load (`wire_api = "chat" is no longer supported`) — and **`model_providers.<id>.name` is REQUIRED** (`provider name must not be empty`).
- **⚠ THE LIMIT THAT GATES THIS TASK: OpenRouter's Responses endpoint (`https://openrouter.ai/api/v1/responses`) is BETA and STATELESS-ONLY.** It 400s on `store: true` and on `previous_response_id`. **Multi-turn and compaction over the shipped route are UNPROVEN.** Step 0 exists to settle it, and **Step 0 is allowed to fail**.
- **The live DB state this task builds on** (real dev DB `%APPDATA%\chorus\chorus.db`, projects `985d547b…` and `f47ac10b…`): one `provider_configs` row — OpenRouter / `codex` / `https://openrouter.ai/api/v1` / model `moonshotai/kimi-k3`; one `credential_profiles` row — "OR milestone key", `last_verified_at 2026-07-24T17:04:26.840Z`.
- **`provider_configs` columns:** `id, name, adapter_type, auth_mode, env_var_name, base_url, extra_headers_json, model, created_at`. **`credential_profiles` columns:** `id, provider_id, label, encrypted_blob, fingerprint_hash, created_at, last_verified_at, unavailable_since, reencrypted_at`, `UNIQUE(provider_id,label)`.
- **`auth_mode` is an UNCONSTRAINED string on both sides** — `providerConfigs.authMode` is `text('auth_mode').notNull()` in `src/main/db/schema.ts`, and the wire schemas in `src/shared/ipc.ts` declare `auth_mode: z.string().min(1).max(60)`. **No enum, no CHECK constraint.** This is load-bearing for Step 3: a new `auth_mode` value costs **no migration and no wire-schema change**.
- **The live-probe precedent is `probeCredential` in `src/main/ipc.ts`**, with its helper `probeFailure`. Read both before designing any network call. It POSTs to `${baseUrl}/chat/completions`, cancels the response body without reading it, maps status codes to a **fixed vocabulary**, collapses every exception to `'Could not reach the provider.'`, and passes every outbound string through `scrubSecrets`. A live 400 during Task 3-6 surfaced as `Unexpected response (400).` — deliberately not echoing the provider's body. **That discipline is inherited verbatim, not re-derived.**
- **The launch-time decrypt path is `resolveCredential`**, a nested helper inside `registerIpc` in `src/main/ipc.ts`, called from the `IpcChannel.SessionLaunch` handler **before any session row exists**. It returns `{ ok, credential, route }` and retains nothing. Its five ordered steps and their refusals are the template for Step 4's insertion.
- **The launch seam:** `SessionManager.launch(agent, cwd, sessionId, opts: LaunchOptions)` → `SessionManager.spawn(...)`, which calls `composeChildEnv` (`src/main/adapters/env.ts`, alongside `BASELINE_ENV_VARS` and `resolveEnvVarName`) and constructs the `SessionOutput` via `createSessionOutput({ secrets, … })` in the same synchronous block as `pty.spawn`. **`LaunchOptions` already carries `secrets`, `credential` and `route`** — this task adds no field to it.
- **Two `sessions.onExit(...)` registrations already exist** — one in `registerIpc` (`src/main/ipc.ts`, forwarding `sessionExitEventSchema` to the window) and one in `src/main/index.ts` (persisting exit state via `storage.updateSessionStatus`). `exitListeners` is a `Set`, so a third independent listener is the established pattern, not a new one.
- **`AuthMethodDefinition.type` (`'subscription' | 'api_key'`) in `src/main/adapters/types.ts` is the attribution discriminator** and has existed per-adapter since Task 3-3. It is **not** `base_url`, and it is **not** "does this launch carry a credential".
- **The vault:** `src/main/services/vault.ts` (`CredentialVault` over `safeStorage`/DPAPI; `createProfile`, `replaceProfile`, `deleteProfile`, `listProfiles`, `decryptForLaunch`) over the Electron-free `src/main/services/vaultCore.ts` (`encodeEnvelope`, `decodeEnvelope`, `fingerprint`, `failureMessage`, `toProfileMeta`, `VaultResult`). **`vaultCore.ts` is this task's module-shape precedent, together with `computeRestoreSet` in `restore.ts` and `computeWorktreeReconcile` in `worktrees.ts`.**
- **`src/main/services/secret-patterns.json` already carries `{"name": "openrouter", "source": "sk-or-v1-[A-Za-z0-9_-]{20,}"}` as pattern #2** — so a minted OpenRouter inference key is **already** covered by `scrubSecrets`, by pino's `hooks.logMethod`, and by the G4 gate, with no list change. **⚠ Whether an OpenRouter *Management* key carries the same prefix is UNVERIFIED — see Step 3's D4 obligation.** If it does not, the pattern list must be extended **before** the management key is ever handled.
- **Task 3a-1 owns migration v7 and the `dispatches` table** (its doc supersedes the roadmap's `usage_records` name), carrying wall-clock and outcome plus `auth_mode` — **D42's attribution discriminator, already promoted to a column there precisely so "% of spend attributed" is computable**. `tokens_in`, `tokens_out`, `tokens_cached` and `cost_usd` are **declared and always written NULL** by 3a-1; **filling them is this task's job**. 3a-1 also ships `src/main/services/dispatches.ts` with `classifyOutcome`, a `DispatchRecorder` (`openDispatch` / `closeDispatch` / `healOrphansAtBoot`), and the rule *telemetry may never fail a launch*. **Creating a second table for tokens is an explicit anti-goal** inherited from D48 and restated in 3a-1's own naming section.

### ⚠ Vendor facts verified at authoring — 2026-07-24, against OpenRouter's own documentation (D4)

Recorded so the implementer starts from evidence rather than memory, and so the **execution-time re-verification has a diff to make**. Sources: `https://openrouter.ai/docs/features/provisioning-api-keys`, `https://openrouter.ai/docs/guides/overview/auth/management-api-keys`, `https://openrouter.ai/docs/api/api-reference/api-keys/create-a-new-api-key`, `https://openrouter.ai/docs/api/api-reference/api-keys/delete-keys`, `https://openrouter.ai/docs/cookbook/administration/analytics-cost-control`.

| Fact | Verified value |
|---|---|
| Key endpoints | `GET /api/v1/keys` · `POST /api/v1/keys` · `GET /api/v1/keys/{hash}` · `PATCH /api/v1/keys/{hash}` · `DELETE /api/v1/keys/{hash}` |
| Auth | `Authorization: Bearer {MANAGEMENT_API_KEY}`. **"Management keys cannot be used to make API calls to OpenRouter's completion endpoints"** — administrative only. Created at `https://openrouter.ai/settings/management-keys`. |
| Create request | `name` (string, **required**, minLength 1) · `limit` (number\|null, optional, USD) · `include_byok_in_limit` (bool, optional) · `limit_reset` (`daily`\|`weekly`\|`monthly`\|null, optional) · **`expires_at`** (ISO-8601 UTC string\|null, optional) · `creator_user_id` · `workspace_id` |
| Create response (201) | A **top-level `key`** field — *"The actual API key string (only shown once)"* — **alongside** a `data` object carrying `hash`, `name`, `label`, `disabled`, `limit`, `limit_remaining`, `limit_reset`, `include_byok_in_limit`, `usage`, `usage_daily\|weekly\|monthly`, `byok_usage` (+ period variants), `created_at`, `updated_at`, `expires_at`, `workspace_id` |
| Delete | `DELETE /api/v1/keys/{hash}` → **`{"deleted": true}`**. Documented errors 401 / 404 / 429. **It does NOT return usage.** |
| Reading spend | `usage` / `limit_remaining` on the key object (`GET /api/v1/keys/{hash}`). **Cost only — no token breakdown.** |
| Tokens | **Not on the key object.** The Analytics API — `POST /api/v1/analytics/query`, *"Analytics queries need a management key"* — returns `total_usage`, `usage_cache`, `tokens_total`, `tokens_prompt`, `tokens_completion`, `reasoning_tokens`, `cache_hit_rate` (0–1), with `metrics` / `dimensions` (max 2) / `filters` (`field`, `operator`, `value`) / `time_range` / `granularity`. **Count fields may return as STRINGS — parse defensively.** `metadata.truncated` signals partial totals. **The API is in beta; the schema may shift.** |

**Left EXPLICITLY as execution-time D4 obligations — do not assume any of these; verify and record:**

1. **The exact `filters` field name for a per-API-key-hash filter** on `POST /api/v1/analytics/query`. The docs state activity can be filtered by API key hash; the literal field name was not confirmed at authoring. **Without it there is no token attribution and the whole tokens half degrades — verify this FIRST, in Step 2.**
2. **Whether `tokens_cached` is directly available**, or must be derived as `tokens_prompt × cache_hit_rate`. `usage_cache` (a dollar figure) and `cache_hit_rate` (a ratio) were confirmed; a cached-**token** metric was not. If derived, it is **stored as derived** and labelled so.
3. **Analytics freshness.** Whether a dispatch that ended seconds ago is queryable immediately, or whether the current UTC day is excluded. This determines whether tokens are written at dispatch close or backfilled.
4. **`PATCH {disabled: true}` semantics** — whether disabling is immediate. If unverified, **`DELETE` is the revocation** and `PATCH` is dropped from the sequence.
5. **Whether `expires_at` causes OpenRouter to stop honouring the key at that instant**, and whether a key past `expires_at` still appears in `GET /api/v1/keys`. This is the third layer of orphan defence and its strength must be measured, not assumed.
6. **Whether `usage` remains readable after `DELETE`.** The rotation guide is silent. Until proven otherwise, **read usage BEFORE deleting.**
7. **Rate limits on the management endpoints.** Undocumented at authoring; 429 is a documented delete error, so the client must handle it.
8. **The management key's literal prefix**, checked against `secret-patterns.json`'s `openrouter` pattern.

## Goal

Make every dollar and every token a Chorus dispatch spends land on **that dispatch**, so Mission Control's estimator has honest actuals from day one — and make the part that **cannot** be attributed visible as a number instead of absent from the total.

Two things stand between here and that, and they are why this is a task rather than an afternoon:

1. **The route is only proven for one turn.** A "dispatch" that cannot hold a conversation is not the unit Mission Control estimates over. Step 0 settles whether the shipped OpenRouter route survives multi-turn, **before** any attribution code exists — and if it does not, this task re-scopes rather than pretends.
2. **The obvious design is the broken one.** Injecting `metadata: {task_id}` fails because the agent CLIs do not reliably forward arbitrary metadata (spec §5.1). Attribution must hold **regardless of what the CLI chooses to send**, which is exactly what a per-dispatch key buys: the key *is* the label, and the provider does the accounting.

Three traps this task exists to avoid:

1. **Gateway-routing a subscription session.** Routing a flat-rate subscription through OpenRouter converts it to per-token billing — a cost-tracking feature that *increases* cost. This is the single worst outcome available and it is easy to reach by accident, because a subscription launch and an api-key launch differ only in one field.
2. **A minted key outliving its dispatch.** A minted key is a **real key with real spend attached**. Orphaned live keys with budget attached are the failure mode that matters, and a crash between mint and revoke is not hypothetical — it is Tuesday.
3. **Ignoring cached input.** Cached input is priced roughly an order of magnitude below fresh input, and a PTY agent against a large `CLAUDE.md` hits cache constantly. A schema that folds cache into `tokens_in` projects **badly wrong in the expensive direction**, and no later migration recovers data that was never captured.

## Exact Scope

| File | Change |
|---|---|
| `src/main/services/attributionCore.ts` | **Create.** The PURE core: strategy selection from auth mode, mint-request construction, response interpretation, the sanitized failure vocabulary, orphan-reconcile computation, and the "% attributed" arithmetic. **No `electron`, no `fetch`, no `node:fs`, no clock** — time is a parameter. Precedent: `vaultCore.ts`, `restore.ts`. |
| `src/main/services/attributionCore.test.ts` | **Create.** Unit tests for every branch listed in Test Expectations. |
| `src/main/services/openrouterKeys.ts` | **Create.** The **ONLY** module in the repo that calls `fetch` against `/api/v1/keys*` or `/api/v1/analytics/query`. Thin transport with an injectable `fetchImpl`; returns discriminated results; leaks nothing (the `probeCredential` discipline). |
| `src/main/services/openrouterKeys.test.ts` | **Create.** Transport tests against a stub `fetchImpl` — status mapping, body-never-read, exception collapse, timeout. |
| `src/main/services/dispatchAttribution.ts` | **Create.** The orchestrator: mint-before-launch, read-then-revoke at dispatch end, the write-ahead mint ledger, the boot key-reconcile, and the deferred token backfill. Owns Electron/storage/vault wiring; delegates every decision to `attributionCore`. **It does NOT open or close `dispatches` rows** — 3a-1's `DispatchRecorder` owns row lifecycle; this service only **enriches** an existing row. Method names are deliberately distinct (`mintForDispatch` / `settleDispatch` / `reconcileOrphanedKeys`) so the two are never confused at a call site. |
| `src/main/services/subscriptionMeter.ts` | **Create.** Best-effort metering of `subscription` sessions from the CLI's own local session logs. **Never gateway-routes anything.** Read-only, failure-tolerant, and explicitly lower-fidelity. |
| `src/main/services/subscriptionMeter.test.ts` | **Create.** Fixture-driven parse tests (fixtures contain **no** key material). |
| `src/main/db/schema.ts` | **Edit.** Mint-ledger columns on 3a-1's **`dispatches`** table — `minted_key_hash`, `minted_key_limit`, `minted_at`, `revoked_at`, `attribution_state`, `tokens_source`. **No new table.** |
| `src/main/services/storage.ts` | **Edit.** **Migration v8** (only if 3a-1's v7 does not already carry these columns — see Dependencies) plus the telemetry accessors this task needs: open-ledger query, ledger write-ahead, token/cost fill, attribution summary. |
| `src/main/ipc.ts` | **Edit.** Mint insertion in the `IpcChannel.SessionLaunch` handler; the **management-key refusal** inside `resolveCredential`; the `attribution:summary` handler; the third `sessions.onExit` listener. |
| `src/shared/ipc.ts` | **Edit.** The `attribution:summary` channel + request/response schemas. No payload may carry key material. |
| `src/preload/index.ts` | **Edit.** One forwarder for `attribution:summary`. |
| `src/main/index.ts` | **Edit.** Construct the attribution service beside `new CredentialVault(storage)`; run the boot reconcile in the same awaited block as `worktrees.reconcileAll()`. |
| `src/main/services/logger.ts` | **Edit.** New credential-bearing field names appended to `REDACT_PATHS` (`managementKey`, `mintedKey`, `key`). |
| `src/shared/ipc.test.ts` | **Edit.** Cases for the new channel, including the key-set assertion that no response field can carry key material. |

Nothing else. **No `.vue` file is touched.** If a change seems to require another file, raise it.

## Non-Goals

- **No board, no dispatch panel, no Mission Control UI of any kind.** Spec §9 Phase 0 is explicit: *"No UI. No board."* The "% attributed" number is exposed over IPC and written to the log; rendering it is a later phase's job.
- **⚠ NO GATEWAY ROUTING OF SUBSCRIPTION SESSIONS — not for a test, not behind a flag, not "just to see if it works."** A subscription session must never receive a minted key, a `base_url` override, or an `env_key` argument. This is a hard prohibition, not a preference, and the reviewer has a specific check for it (Review Checklist item 1).
- **No second telemetry table.** 3a-1's v7 table is the one home for dispatch actuals (D48's anti-goal, applied).
- **No new npm dependency.** Node's built-in `fetch`, as in `probeCredential`.
- **No budget *enforcement* UI or policy engine.** The hard `limit` on a minted key is a safety floor, not a feature: no cap editor, no per-project budget, no spend alerts. Mission Control spec Phase 3 owns routing policy and cap multipliers.
- **No retry, no backoff, no queue on any management call.** One request, a short timeout, a result — and the boot reconcile as the durable backstop.
- **No automatic verification of the user's own credentials.** This task adds no new path that sends a user's stored key anywhere; D33 resolution (d)'s Test-key carve-out is not widened.
- **No renderer-visible key material, ever** — including the minted key, its `hash`, and the management key. `hash` is an identifier, not a secret, and it still does not cross the bridge in this task.
- **No `launch_profiles`, no `model_catalog`** — 3a's other tasks own those. This task reads `provider_configs.model` and writes nothing to it.
- **No api-mode execution.** `startApiSession` stays unimplemented; `SessionManager` stays PTY-only.
- **Do not commit, delete, or revert the untracked `TASK-3-5-REVIEW-FABLE.md` and `TASK-3-6-REVIEW-FABLE.md`.** They are not this task's files.
- **Do not revert, stage, or commit unrelated or untracked files, including `_verify/` and anything under `docs/`.**
- **Do not remove the standing `wt-24b5c1fe` worktree row, directory, or branch.**

## Dependencies

- **Task 3a-1 — HARD.** It creates **migration v7**, the **`dispatches`** table (wall-clock, outcome, `agent`, `model`, `auth_mode`, and `tokens_in`/`tokens_out`/`tokens_cached`/`cost_usd` declared-but-always-NULL), and `src/main/services/dispatches.ts` (`classifyOutcome`, `DispatchRecorder`). This task fills the four NULL columns and adds the ledger columns beside them. **At execution, read 3a-1's shipped `MIGRATIONS` entry and `schema.ts` definition FIRST** and answer one question in writing: *do the mint-ledger columns already exist?*
  - **If yes** → this task adds **no migration**. Say so explicitly in the commit message.
  - **If no** → this task appends **migration v8** with those columns as nullable `ALTER TABLE` statements, and **carries the full Task 3-2 three-dump protocol** (pre / post / second boot) on the **real** dev DB. A short DDL does not earn a lighter proof; the risk lives in the runner and the real database.
- **Task 3a-2 is INDEPENDENT of this task.** No ordering constraint exists in either direction and neither reads the other's output. If 3a-2 has landed, its files are simply out of scope; if it has not, nothing here waits on it.
- **Task 3-6 (`15a016e`)** — the OpenRouter route, the vault, the scrubber seam, and `probeCredential`. All consumed unchanged.
- **A live OpenRouter Management key is required** and must be created by **Matthew**, in his own dashboard, at `https://openrouter.ai/settings/management-keys`. **The implementer must not create one, must not ask for its text in chat, and must not read it out of any file** — it is entered once through the Chorus Settings UI, exactly like a provider key. If it does not exist when execution begins, **stop and ask**; every step after Step 3 depends on it.

## Step-by-step Work

**0. THE MULTI-TURN GATE — FIRST, BEFORE ANY ATTRIBUTION CODE IS WRITTEN. It is allowed to fail.**

D49/F-36-1 recorded the limit and named the obligation: *multi-turn is unproven; whichever phase ships conversational work over this route must prove it first.* Everything below Step 0 assumes a dispatch is a **multi-turn agent session**. If that assumption is false, building attribution on top of it produces a correct meter over the wrong unit.

**The proof, run through the shipped app — not curl, not a script.** Launch a real `codex` session from the real Launch dialog against the live OpenRouter provider row (`moonshotai/kimi-k3`) with the "OR milestone key" profile selected, then drive **three sequential turns** in the pane:

1. Turn 1 establishes a fact the model cannot otherwise know: *"Remember this token: QUARTZ-7-MERIDIAN. Reply with just OK."*
2. Turn 2 asks for it back: *"What token did I ask you to remember?"*
3. Turn 3 asks for something that requires both turns: *"Repeat the token, then tell me how many messages I have sent you."*

**Pass criterion, stated before the run so it cannot be adjusted afterwards:** turn 2 returns `QUARTZ-7-MERIDIAN`, **and** no turn produces a `400`, a `previous_response_id` error, a `store` error, or a config-load failure. **Anything less is a FAIL, including a partial pass.** A model that answers turn 2 but errors on turn 3 has not proven multi-turn; it has proven two turns.

**Capture, for both outcomes:** the exact prompts, the verbatim pane output (screenshot plus the scrubbed ring buffer), and the codex command line from `Get-CimInstance Win32_Process`. If it fails, capture the **verbatim error text** — the failure mode is the finding, and "it didn't work" is not a finding.

**Why it might pass despite a stateless endpoint** — state this in the report either way, because it is what the result actually tells us: a stateless `/responses` endpoint forbids **server-side** conversation state (`store: true`, `previous_response_id`). It says nothing about a client that resends the full message history each turn. Whether codex 0.145.0 does the latter is precisely what this step measures.

**IF IT FAILS — RE-SCOPE, DO NOT FORCE.** The remaining scope contracts, deliberately, and the phase is told:

- **What survives unchanged:** per-dispatch key minting, the hard `limit`, revocation, orphan reconciliation, the management-key storage ruling, the subscription-side prohibition, and the telemetry schema. **None of these depends on conversational continuity** — a minted key meters whatever is spent under it, whether that is one turn or two hundred.
- **What is re-scoped:** attribution ships for **single-turn dispatches only**. `attribution_state` records the limit per row, the multi-turn failure is written into the roadmap as a numbered finding with its verbatim error, and **nothing in 3a is built that assumes a dispatch can hold a conversation** — specifically, no `launch_profiles` field, no estimator input, and no Mission Control seed field may presume it.
- **What is NOT sanctioned:** switching `wire_api` back to `"chat"` (the binary rejects it), pointing the route at a different OpenRouter endpoint to make the test pass, or driving the proof through a raw HTTP call instead of the shipped route. **The thing being proven is the shipped route.** If a fix genuinely requires changing the route's mechanism, that is a scope decision — flag, brief, pause.

**Report the outcome before writing line one of Step 1.**

1. **D4 verification pass, first and reported.** Re-verify the eight obligations listed in the Initial Starting Point against OpenRouter's live documentation **in this session**, and record what you fetched, when, and what it said. Obligation 1 (the analytics per-key filter field) is the highest-risk one: **verify it before designing the token path**, because if no per-key filter exists, the tokens half has no source and that changes this task's acceptance.

2. **The pure core (`attributionCore.ts`)** — strategy selection, mint-request construction, response interpretation, the failure vocabulary, reconcile computation, and the "% attributed" arithmetic, all as pure functions over injected time. Unit-tested before anything calls them.

3. **The management key gets a storage ruling and a home.** It is a **new credential class** (D42's operational note) and this task settles it:
   - It is stored **in the existing vault**, as an ordinary `credential_profiles` row on a `provider_configs` row whose **`auth_mode` is `'management'`**. This costs no migration and no wire-schema change (`auth_mode` is an unconstrained string on both sides — verified above), and it inherits DPAPI encryption, the salted fingerprint, `unavailable_since`, refuse-never-degrade, and write-only inbound IPC **for free**. Inventing a second credential store for a higher-privilege key would be strictly worse than reusing the one that has already been council-reviewed.
   - **Two guards make it not an ordinary credential**, and both are named tests:
     - **It is never launchable.** `resolveCredential` refuses any profile whose provider `auth_mode === 'management'`, with a label-only message. A management key must never reach a child PTY's environment.
     - **It is never used for inference.** OpenRouter enforces this server-side (*"Management keys cannot be used to make API calls to OpenRouter's completion endpoints"*); Chorus enforces it at the resolve boundary anyway, because a guarantee that depends on a third party is not a guarantee.
   - **Decrypt-per-use, never cached.** The management key is decrypted through `vault.decryptForLaunch` at the moment a management call is made and dropped immediately, exactly like a launch credential. No module-level variable holds it.

4. **Mint at dispatch start** — inserted in the `IpcChannel.SessionLaunch` handler, after `resolveCredential` succeeds and **before** `sessions.launch(...)`. **Write-ahead ordering is mandatory:** mint → **persist the ledger row** → launch. A crash between mint and persist creates an orphan the ledger cannot see; a crash between persist and launch creates a ledger row for an unused key, which reconciliation cleans harmlessly. There is exactly one safe order and this is it.
   - **Every minted key carries a hard `limit`.** No code path may mint without one. This is the budget guardrail D42 bought and the blast-radius bound that makes a failed revocation survivable.
   - **Every minted key also carries `expires_at`** (dispatch start + a bounded TTL), as the third layer of orphan defence — subject to obligation 5's verification.
   - **The minted key is injected instead of the user's key**, which means the user's long-lived key is **not decrypted at all** for an attributed launch. Say this out loud in the commit message: it is a genuine security improvement, and it is also a behaviour change a reader deserves to be told about.
   - **Mint failure DEGRADES, it does not refuse.** Attribution is telemetry, not security: a failed mint must not stop the user working. The launch proceeds on the user's own key and the row records `attribution_state='mint-failed'`, which counts against "% attributed". **This is the one place this task deliberately departs from D33's refuse-never-degrade, and the reason is that D33 governs credentials, not meters** — the user's key is still handled exactly as D33 requires.

5. **Read then revoke at dispatch end** — a third `sessions.onExit` listener. Ordering, and the reason for it: **read `usage` first, revoke second**, because `DELETE` returns only `{"deleted": true}` and whether usage survives deletion is undocumented (obligation 6). If `PATCH {disabled:true}` is verified immediate (obligation 4), it goes first, to stop spend while the read happens; if not, it is dropped and `DELETE` is the revocation.
   - **Revocation failure does not retry inline.** The ledger row stays open with `revoked_at` NULL, the failure is logged, and boot reconciliation is the backstop — together with the `limit` and `expires_at`, which bound the damage by construction.

6. **Boot reconciliation for orphans** — the failure mode that matters. Modelled on `GitWorktreeManager.reconcileAll` / `computeWorktreeReconcile`: a **pure classifier** over (live keys × open ledger rows), and a thin executor. Five populations, five rules, and **one absolute prohibition — never revoke a key Chorus did not mint.** Ownership is proven by the mint `name` prefix and nothing else. **Ordering is load-bearing: it runs AFTER 3a-1's `DispatchRecorder.healOrphansAtBoot()` and BEFORE `sessions.restore(...)`** — a dispatch must be marked closed before its key can be judged orphaned, or the "is this dispatch still running?" input is wrong for exactly the rows that matter. Full matrix in the spec.

7. **Tokens** — fill `tokens_in`, `tokens_out`, **`tokens_cached`** and `cost_usd` on 3a-1's `dispatches` row (`agent`, `model` and `auth_mode` are already written there by 3a-1 — do not re-write them). `cost` comes from the key's `usage` (verified, always available). Tokens come from the analytics query filtered by key hash (obligation 1). `tokens_cached` is captured **as its own column**, never folded into `tokens_in`; if it can only be derived from `cache_hit_rate`, it is stored **and labelled** as derived via `tokens_source`. **If analytics is not fresh enough at dispatch close (obligation 3), tokens are backfilled by a later pass** and `attribution_state` distinguishes *"pending backfill"* from *"no tokens available"*. A NULL that means two different things is a data-quality bug.

8. **Subscription metering** (`subscriptionMeter.ts`) — read the CLI's own local session logs, best-effort, lower fidelity, **no network call and no gateway involvement whatsoever**. Failure is normal and silent-in-the-UI (logged, not surfaced). Its output is explicitly marked lower-fidelity so no consumer can mistake it for gateway-grade data.

9. **"% of spend attributed"**, computed in main, exposed on `attribution:summary`, and logged once per boot. **Two numbers, both labelled, because neither alone is honest:** a **dollar** figure over gateway spend (attributed OpenRouter spend ÷ total account spend in the window) and a **dispatch-count** figure (fully-attributed dispatches ÷ all dispatches). **Subscription spend is never imputed a dollar value** — inventing a $/token rate for a flat-rate subscription would fabricate exactly the number D42 wants made visible.

10. **Tests**, then `npm run typecheck` / `npx vitest run` / `npm run grep:secrets`.

11. **The runtime proof (G2)** — the full sequence in Verification Commands, including a real end-to-end dispatch with **non-zero token counts attributed to the right agent and model** (Mission Control spec §9 Phase 0's own acceptance).

## Test Expectations

**Unit (Vitest), `attributionCore.test.ts`** — every function pure, time injected:

- **Strategy selection is keyed on auth mode and nothing else.** `type: 'subscription'` → `'cli-logs'`, **even when the provider row carries a `base_url` and a `model`**. This is the billing-separation test and it is the most important test in the task: a regression here silently converts a flat-rate subscription to per-token billing. Assert the *whole* returned strategy object, not just its tag, so a future field cannot smuggle a route in.
- **`type: 'api_key'` with a management key configured** → `'minted-key'`; **without one** → `'none'`, never `'minted-key'` with a null key.
- **A mint request always carries a positive `limit`.** Assert that constructing one with a null/zero/negative limit throws or returns a refusal — **there is no code path to an uncapped key.**
- **The mint `name` always carries the ownership prefix** and the dispatch id, and **never** the label, the project name, the cwd, or any free-form user text. It is sent to a third party.
- **Response interpretation never echoes a body.** Given a 401 with a body containing a realistic fake key, the returned reason is the fixed string and contains **no substring ≥ 8 characters** of that key. Same for 403/429/5xx/unexpected-status/exception. Mirror `probeCredential`'s vocabulary.
- **Reconcile classification — all four populations**, each its own named test: open-ledger + live + dispatch not running → revoke; live + not-in-ledger + **our prefix** → revoke and record unattributed; live + not-in-ledger + **not our prefix** → **NO ACTION** (assert the action list is empty — this is the "don't revoke the user's own keys" test and it must fail loudly against an over-eager implementation); ledger-open + not live → close the row, spend unknown.
- **`tokens_cached` is never folded into `tokens_in`.** Given an analytics result with prompt tokens and a cache hit rate, assert the three token fields independently and assert `tokens_in` is **not** reduced or inflated by the cached figure.
- **Defensive numeric parsing** — analytics count fields arriving as **strings** parse correctly, and a non-numeric value yields `null`, never `NaN` and never `0`. **`0` and `unknown` must never be confused**; a fabricated zero is worse than a NULL.
- **"% attributed" arithmetic**: a zero-dispatch window returns `null`, not `0` or `NaN`; subscription dispatches count in the dispatch-count figure and **contribute no dollars** to the spend figure.

**Unit (Vitest), `openrouterKeys.test.ts`** — against a stub `fetchImpl`:

- The response body is **never read** on a failure path (assert the stub's body reader was not called, or was cancelled).
- A thrown `fetch` collapses to the fixed unreachable message; a timeout does the same.
- The management key appears in the `Authorization` header **and nowhere else** — not in a URL, not in a query string, not in a log call. Assert over the recorded request object's full key set.

**Unit (Vitest), `subscriptionMeter.test.ts`** — fixture-driven; **fixtures contain no key material**; a malformed/absent log yields "unknown", never a fabricated number.

**Unit (Vitest), `src/shared/ipc.test.ts`** — `attribution:summary`'s response schema parses, and its **parse output's key set** contains no field capable of carrying key material (the 3-2 discipline).

**No test may contain a real credential**, and `npm run grep:secrets` must pass afterwards.

**Runtime (G2)** carries the acceptance. No unit test can establish that a real dispatch was metered.

## Verification Commands

Run from repo root (PowerShell).

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

### ⚠ Cost envelope — state it before spending it

These runs make **live, billable** calls on Matthew's real OpenRouter account.

| Run | Model | Expected cost |
|---|---|---|
| Step 0 multi-turn gate (3 turns) | `moonshotai/kimi-k3` | < $0.05 |
| Attributed dispatches (3–5 runs) | `moonshotai/kimi-k3` | < $0.20 total |
| Management calls (mint/list/get/patch/delete/analytics) | — | $0.00 (administrative) |
| **Total expected** | | **< $0.30** |
| **Hard ceiling enforced by the mechanism** | | **$0.50 per minted key** |

**Every minted key in every verification run carries a hard `limit` — no exceptions, including "just this one to see the shape."** If a run needs more than the ceiling, stop and ask rather than raising it.

**The multi-turn gate proof.** As specified in Step 0: three turns through the real dialog and the real pane, pass criterion stated in advance, verbatim transcript and error text captured either way.

**The attribution proof — Mission Control spec §9 Phase 0's own acceptance.** Run one real dispatch end to end and show, with quoted evidence:

1. A key was minted for it (`GET /api/v1/keys` before and after the launch: **count +1**, and the new key's `name` carries the Chorus prefix and the dispatch id).
2. The minted key — not the user's key — is what reached the child. Read the agent process's **environment block** from outside the app (WMI/CIM against the descendant PID, walking from the electron main PID; **never name-matching** — there are ~16 unrelated `claude.exe` on this machine) and confirm the injected value is the minted one.
3. `Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, CommandLine` over the whole descendant tree: **no command line contains the minted key, the user's key, the management key, or any ≥ 8-character substring of any of them.** `-c` carries only the base URL, the env-var **name**, `wire_api`, and the provider name.
4. At dispatch end the key was **read then revoked**: `usage` was captured non-zero, then `DELETE` returned `{"deleted": true}`, then `GET /api/v1/keys` shows **count back to baseline**.
5. The telemetry row carries **non-zero `tokens_in` and `tokens_out`**, a **separately populated `tokens_cached`** (or an explicit "no cache on this run" with the evidence), a non-zero `cost`, and the **right agent and model** — `codex` / `moonshotai/kimi-k3`. Dump the row.

**The subscription-safety proof — the reviewer's check that this task did not gateway-route a subscription session.** This is a required, separate run:

1. Snapshot `GET /api/v1/keys` (count and hashes).
2. Launch a **subscription** session — `claude`, no credential profile selected — through the real dialog.
3. Re-snapshot `GET /api/v1/keys`: the count and the hash set are **byte-identical**. **No key was minted.**
4. Read that child's environment block: **no `OPENROUTER_*` variable, no injected key of any kind**, and the full inherited `process.env` (3-6's resolution-(c) negative control, still holding).
5. Read its command line: **no `-c model_provider…`, no `base_url`, no `env_key`.**
6. Dump its telemetry row: `attribution_state` records the subscription path, and **no `minted_key_hash`**.

**The crash-reconciliation proof — the failure mode that matters.** Simulate it honestly:

1. Launch an attributed dispatch and let it run.
2. **Tree-kill the app mid-dispatch** (`taskkill /PID <electron main PID> /T /F`) — the key is now live, funded, and orphaned, exactly as a real crash leaves it.
3. Confirm the orphan is real: `GET /api/v1/keys` still lists it, un-revoked.
4. Cold-boot the app (electron-vite does **not** hot-restart main — a real boot is required).
5. Confirm boot reconciliation **read its usage, revoked it, and recorded an orphan-reconciled telemetry row**. Quote the log line and the key list before and after.
6. **The negative half, which the proof is meaningless without:** before that boot, create a key by hand in the OpenRouter dashboard whose name does **not** carry the Chorus prefix. Confirm that after the reconcile it is **still there, untouched**. Then delete it by hand.

**The revocation-failure proof.** Force a revoke failure (point the client at an unreachable host for one call, or use a bad hash) and confirm: the ledger row stays open, the message is sanitized, the app does not crash, the user's session is unaffected, and the **next boot's reconcile cleans it up**.

**The mint-failure proof.** Force a mint failure (invalid management key) and confirm the launch **still succeeds** on the user's own key, with `attribution_state='mint-failed'` and a sanitized message — and that the failure is **counted against "% attributed"** rather than hidden.

**The management-key-is-not-launchable proof.** Create a `management` provider row and a profile on it through the real Settings UI, then attempt to launch naming that profile. Expected: an inline refusal naming the profile **by label**, no spawn, no session row, and **no management key anywhere in the environment block**.

**The migration proof (only if migration v8 is created).** The full Task 3-2 three-dump protocol on the **real** dev DB: pre / post / second boot; v1–v7 `applied_at` **byte-identical**; every pre-existing table row-identical; new columns nullable and reading `NULL` on existing rows; v8 **not re-applied** on boot 2; the standing `wt-24b5c1fe` worktree row intact.

**⚠ The `sqlite3` CLI is NOT installed.** Use the `ELECTRON_RUN_AS_NODE` dump-script pattern (`_verify/2-1-dump.js`); write results to a file; **known flake: no file on first invocation, retry once**; **quote the `projects` table** (F20 — an implementer's DB evidence describes a redirected `AppData`, so the coordinator re-verifies on the real path).

**Harness reminders:** CDP on `--remote-debugging-port=9222`; kill process **trees**; every main-process change needs a cold boot.

## Acceptance Criteria

- [ ] `npm run typecheck` — zero errors (G1).
- [ ] `npx vitest run` — green, the then-current baseline (273/273 across 14 files at `15a016e`, plus whatever 3a-1 and 3a-2 added) intact and grown.
- [ ] `npm run grep:secrets` — clean (G4, mandatory and load-bearing).
- [ ] **THE MULTI-TURN GATE WAS RUN FIRST AND ITS RESULT IS STATED AS A FACT** — three turns through the shipped route, pass criterion declared in advance, verbatim transcript captured. A PASS unlocks the full scope; a FAIL re-scopes the task to single-turn attribution **and is recorded in the roadmap as a numbered finding with the verbatim error**. "We assumed it works" is a FAIL of this criterion regardless of what the code does.
- [ ] **A real end-to-end dispatch is recorded with NON-ZERO token counts attributed to the right agent and model** (Mission Control spec §9 Phase 0), with the row dumped.
- [ ] **`tokens_cached` is captured in its own column**, never folded into `tokens_in`; if derived from `cache_hit_rate`, `tokens_source` says so.
- [ ] **Every minted key carried a hard `limit`** — proven from the create-response `data.limit` of every key minted during verification. **No uncapped key was ever minted, at any point, including during exploration.**
- [ ] **A minted key never reached a command line, a log file, a transcript, the renderer, or disk in plaintext** — the five-surface inspection, with the **positive** environment-block check included. An all-absence result is also what a completely broken injection looks like.
- [ ] **The minted key went through the same vault/scrubber path as a user key** — registered with the session's `SessionOutput` match set, covered by `scrubSecrets` (the `openrouter` pattern in `secret-patterns.json`), and matched by the G4 gate. Proven by having the agent echo it and observing `[REDACTED-CREDENTIAL]`.
- [ ] **NO SUBSCRIPTION SESSION WAS GATEWAY-ROUTED** — the six-step subscription-safety proof, with the key-list snapshot **byte-identical** across the launch.
- [ ] **Orphan reconciliation works on a REAL simulated crash** — tree-kill mid-dispatch, cold boot, key read-then-revoked, orphan row recorded; **and a non-Chorus key present at the same boot was left untouched.**
- [ ] **Revocation failure and mint failure both degrade safely and visibly** — sanitized messages, no crash, no user-facing session loss, both counted against "% attributed", both cleaned by the next boot's reconcile where applicable.
- [ ] **The management key is stored in the vault, is never launchable, and never reaches a child PTY** — the refusal proven at runtime with a real profile.
- [ ] **"% of spend attributed" is a real computed number, exposed and logged, with subscription spend NOT imputed a dollar value.**
- [ ] **No second telemetry table was created** — grep the migrations; 3a-1's table is the only home for dispatch actuals.
- [ ] **If migration v8 was created**, it applied **in place** on the real dev DB with zero data loss, per the three-dump protocol; **coordinator re-verifies on the REAL DB** (`985d547b…`).
- [ ] **The eight D4 obligations were each verified or explicitly recorded as still-unverified**, with what was fetched and when. A remembered endpoint shape is a D4 violation regardless of whether it happens to be right.
- [ ] **ONE** narrated commit (G3), touching only the Exact Scope rows.
- [ ] **The two untracked `TASK-3-*-REVIEW-FABLE.md` files are still untracked and unmodified**, and the standing `wt-24b5c1fe` worktree row, directory and branch are untouched.

## Review Checklist

- [ ] **Prove the subscription prohibition STRUCTURALLY, not just behaviourally.** Grep for every call site of the mint function: there must be exactly one, and it must sit inside the `'minted-key'` branch. Then read the branch condition and confirm it tests **`AuthMethodDefinition.type`**, not `base_url`, not "has a credential", not "has a provider row". A condition that keys on the wrong field passes every happy-path test and converts a subscription to per-token billing the first time someone adds a `base_url` to a subscription route.
- [ ] **Read the mint→persist→launch ordering with a crash in mind at each line.** If the ledger write happens after the launch — or inside the same `await` chain in a way that can be skipped — an orphan becomes invisible. This is the one ordering bug in the task that costs real money.
- [ ] **Confirm reconciliation cannot revoke a key Chorus did not mint.** Read the ownership predicate. A prefix check that is case-insensitive, that matches a substring anywhere in the name, or that treats "no name" as ours, will one day delete a key the user made by hand. The named unit test must fail against each of those.
- [ ] **Trace the minted key's lifetime end to end**, the same read the 3-6 review did for a user key: create-response → one local variable → `secretEnv` → `composeChildEnv` → child env → scrubber match set → dropped. **No log line, no error message, no retained property, no `JSON.stringify` of any object containing it, and no vault write.**
- [ ] **Confirm the management key is decrypted per use and never cached.** A module-level variable, a memo, or a "we'll just hold it for the session" is a higher-privilege credential kept resident — strictly worse than what D33 sanctioned for a launch credential.
- [ ] **Check the failure vocabulary against `probeCredential`'s.** Every management-call failure must map to a fixed string, with the body cancelled unread and the exception discarded wholesale. An `err.message` that reaches the renderer is the leak this discipline exists to prevent — and a 401 body from a key-management endpoint is exactly the body most likely to echo a key.
- [ ] **Check that `0` and `unknown` are distinguishable everywhere.** A dispatch with unknown tokens must not read as a dispatch with zero tokens, or the estimator calibrates on fabricated data and every projection downstream is quietly wrong. Read the accessors, not just the schema.
- [ ] **Confirm `tokens_cached` has its own column and its own write**, and that nothing sums it into `tokens_in` "for convenience". Cached input is priced roughly an order of magnitude lower; folding it in is the single most expensive modelling error available here.
- [ ] **Confirm the analytics filter field name was VERIFIED this session**, not remembered. If it was not verified, the token half rests on a guess and the acceptance criterion is not met.
- [ ] **Confirm nothing new sends a user's stored credential anywhere.** The management calls use the management key; the inference calls use the minted key. If the user's own key is being transmitted somewhere new, D33 resolution (d)'s carve-out has been silently widened.
- [ ] **Confirm no `.vue` file was touched** and no board/panel snuck in — spec §9 Phase 0 is *"No UI. No board."*
- [ ] **Confirm no second telemetry table.** Read the migration diff. A second table for tokens is D48's anti-goal restated, and it is easiest to add at exactly this moment.
- [ ] **Confirm the cost envelope was respected and reported** — actual spend quoted, every minted key capped, and no run raised its own ceiling.
- [ ] No untracked / `_verify/` / `docs/` files staged or reverted; both `TASK-3-*-REVIEW-FABLE.md` untouched.
