# Task 3a-3: Per-Dispatch Token & Cost Attribution — Execution Prompt

## Role

You are the Coordinator for Chorus — Foundation **Phase 3a, Task 3a-3** (Per-Dispatch Token & Cost Attribution, and the multi-turn proof).

Repo root: `C:\Projects\ContactEstablished\Chorus`

Expected branch: `main` — confirm with `git branch --show-current`; do NOT switch or create branches without instruction.

**Expected code HEAD for `src/` at start: `fd4c9e5`** (Task 3a-2 — attention capture). One docs-only commit sits on top (`53dea54`, the roadmap update) and may be followed by this prompt's own commit; **no production code has changed since `fd4c9e5`.**

Platform: Windows 11, PowerShell 7

Chorus is a local-first BYOK Electron + Vue 3 + TypeScript desktop app for running multiple AI coding agents in parallel terminal panes.

## ⚠ STOP — TWO PRECONDITIONS BEFORE ANY WORK

**1. A live OpenRouter Management key exists — but THERE IS NO WAY TO ENTER IT YET, and building that way in is part of your Step 3.**

**Matthew has already created the key** (2026-07-25, at `https://openrouter.ai/settings/management-keys`). He is holding it and will enter it himself, through the running app, **when you tell him Step 3's affordance is ready.** **You must never ask for its text in chat, never read it out of a file, never accept it in any form, and never write it to disk yourself.** It reaches Chorus exactly once, through the Settings UI, into the vault.

**⚠ SCOPE FINDING, verified 2026-07-25 at `fd4c9e5` — `Task-3a-3.md` Step 3 is WRONG on this point.** The task doc says the management key "is entered once through the Chorus Settings UI, exactly like a provider key". That is true at the DB and wire layers — `providerConfigs.authMode` is `text('auth_mode').notNull()` and the create/update wire schemas declare `auth_mode: z.string().min(1).max(60)`, so **no migration and no wire-schema change is needed** — but it is **NOT true of the UI**:

- `SettingsProviders.vue`'s auth-mode control is a `<select>` whose options are `authMethods` (`<option v-for="m in authMethods" :value="m.type">`), resolved from `adapter:list`.
- Those come from the adapters' static declarations; `claude.ts` and `codex.ts` each declare exactly **`subscription`** and **`api_key`**.
- `AuthMethodDefinition.type` is typed **`'subscription' | 'api_key'`** in `src/main/adapters/types.ts`, and `authMethodDefinitionSchema` in `src/shared/ipc.ts` mirrors it as **`z.enum(['subscription', 'api_key'])`**.
- The string `'management'` appears **nowhere** in `src/`.

So there is no reachable UI path that produces a `provider_configs` row with `auth_mode = 'management'`, and the real dev DB confirms it: two rows only — `OpenRouter` (`codex`/`api_key`) and `Anthropic direct` (`claude`/`api_key`).

**This is a scope decision, not a detail — flag it, choose deliberately, and record the choice in the commit narration.** The obvious-looking fix is the wrong one: widening `AuthMethodDefinition.type` to include `'management'` and having the adapters declare it would make "Management key" appear as **a way to launch codex** in the launch picker, which is semantically false and pushes a higher-privilege credential toward the launch path this task exists to keep it away from. Prefer an account-level credential affordance that is **not** an adapter auth method. **Whatever you choose, the two Step 3 guards are unchanged and non-negotiable: never launchable, and decrypt-per-use.**

**Note on D34 Q5:** its frozen-registry ruling governs the **agent registry** (`agentKindSchema` + which adapters exist) and is **not** what this touches — you are not adding an adapter. Do not use it as a reason to refuse, and do not treat widening an auth-method union as covered by it either; say which you did.

**Sequencing, therefore:** Steps 0, 1 and 2 (the multi-turn gate, the D4 verification pass, the pure core) need **no key at all** — do them first. Build Step 3's storage ruling and its entry affordance, then **pause and ask Matthew to enter the key through the running app.** Everything from Step 4 on depends on it. **Do not block the session at minute one over a key you cannot yet accept.**

**2. This task spends real money.** The dev vault holds Matthew's real, billable OpenRouter key ("OR milestone key", `last_verified_at 2026-07-24T17:04:26.840Z`, profile id `6a658a8f-b3a3-42f5-b318-f6efa11732ad`). Every verification run makes live calls. The cost envelope is **< $0.30 total**, with a **hard $0.50 ceiling per minted key**. If a run needs more, **stop and ask rather than raising it**.

## Goal

Make every dollar and every token a Chorus dispatch spends land on **that dispatch**, so Mission Control's estimator has honest actuals from day one — and make the part that **cannot** be attributed visible as a number rather than absent from the total.

Two things make this a task rather than an afternoon, and the first one is a gate:

1. **The route is only proven for ONE TURN.** A "dispatch" that cannot hold a conversation is not the unit Mission Control estimates over. **Step 0 settles this before any attribution code exists, and it is allowed to fail.**
2. **The obvious design is the broken one.** `metadata: {task_id}` fails because agent CLIs do not reliably forward arbitrary metadata. Attribution must hold *regardless of what the CLI sends* — which is what a per-dispatch key buys: the key **is** the label, and the provider does the accounting.

### One Commit in This Session

**ONE intentional narrated commit (G3).** The two-commit amendment was Task 3a-1's alone (D46/D54) and does not carry forward.

## Ground Yourself First

Read these before editing anything. All paths are relative to repo root:

- `CLAUDE.md` — locked architecture rules: **D1** Zod-in-main, **D14** plain-object IPC, secrets via safeStorage injected as env vars, **D4** verify vendor behaviour against the vendor's own docs at execution time.
- `docs/Features/Foundation/Tasks/Task-3a-3.md` — **GOVERNS SCOPE.** 326 lines; read all of it. The Exact Scope table, the Non-Goals, the eight D4 obligations, and the Review Checklist are binding.
- `docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-3a-3.md` — **GOVERNS EXACT CONTENTS.** 604 lines. Key sections: **§1** module shape · **§2** insertion points by symbol · **§3** the two credential rulings · **§4** the dispatch lifecycle in exact order · **§5** schema · **§6** orphan reconciliation incl. the EXACT classification matrix and the boot-ordering constraint · **§7** failure-mode matrix · **§8** the honest token path · **§9** the runtime proofs.
- `docs/Features/Foundation/roadmap.md` — §5 (Verified Ground Facts, incl. **F16**, **F20**, **F-36-1**), §6 (**D33, D41, D42, D47, D48, D49, D51, D55**), §7 Phase 3a.
- `docs/Features/Foundation/Tasks/Phase-3a-Overview.md` — phase contract, file-ownership matrix, standing conditions.
- `docs/Features/Mission Control/chorus-mission-control-spec.md` — **§5.1** (token/cost source, the naive-metadata failure, the cached-input warning) and **§9 Phase 0** (*"No UI. No board."*; acceptance = *"dispatches appear in the store with non-zero token counts attributed to the right agent and model"*).

### Code to Inspect

Anchor to **NAMED SYMBOLS**, never line numbers. All verified present 2026-07-25 at `fd4c9e5`:

- `src/main/ipc.ts` — `probeCredential` + its helper `probeFailure` (**the live-probe discipline this task inherits verbatim**: body cancelled unread, fixed failure vocabulary, every exception collapsed, everything through `scrubSecrets`); `resolveCredential` (nested in `registerIpc`, called from the `SessionLaunch` handler before any session row exists — the template for the mint insertion and the management-key refusal).
- `src/main/services/dispatches.ts` — `classifyOutcome`, `DispatchRecorder` (`healOrphansAtBoot` / `attach` / `closeOpenOnQuit`), and the **`safely` wrapper carrying the rule *telemetry may never fail a launch***. **This task does NOT open or close `dispatches` rows — it only ENRICHES them.**
- `src/main/services/vault.ts` + `src/main/services/vaultCore.ts` — `decryptForLaunch`; `vaultCore` is this task's module-shape precedent, with `computeRestoreSet` (`restore.ts`) and `computeWorktreeReconcile` (`worktrees.ts`, the reconcile-classifier precedent).
- `src/main/adapters/env.ts` — `composeChildEnv`, `BASELINE_ENV_VARS`, `resolveEnvVarName`.
- `src/main/adapters/types.ts` — `AuthMethodDefinition.type` (`'subscription' | 'api_key'`), **the attribution discriminator**. Not `base_url`, not "has a credential".
- `src/main/services/logger.ts` — `REDACT_PATHS`.
- `src/main/services/secret-patterns.json` — pattern #2 is `{"name":"openrouter","source":"sk-or-v1-[A-Za-z0-9_-]{20,}"}`, so a minted **inference** key is already covered. **Whether a Management key shares that prefix is UNVERIFIED — D4 obligation 8.**

### ⚠ The task doc's "Initial Starting Point" was written against `15a016e` and is now STALE in five places

Task-3a-3.md predates Tasks 3a-1 and 3a-2. Treat these as the corrected facts, all re-verified 2026-07-25 at `fd4c9e5`:

| Task doc says | Actually, now |
|---|---|
| Baseline `273/273 across 14 files` | **352/352 across 17 files**; typecheck 0 (node + web); `grep:secrets` clean (6 patterns) |
| "Two `sessions.onExit(...)` registrations already exist … a third listener" | **FOUR exist** — `ipc.ts` (event forward), `index.ts` (D11 status-persist), `dispatches.ts` (recorder close-on-exit), `index.ts` (3a-2 attention). **Yours is the FIFTH.** The `Set` idiom stands; order within it is not contractual. |
| `registerIpc(sessions, storage, worktrees, vault)` | **`registerIpc(sessions, storage, worktrees, vault, attention)`** — five params. If this task threads its service in, it becomes the **sixth** positional parameter (the `vault`→3-2, `attention`→3a-2 precedent). |
| Migration numbering "v8 or v9" hedge | **`MIGRATIONS.length` is 7. Your migration is v8.** Confirm `MIGRATIONS.length + 1 === 8` before appending; **stop and report divergence** rather than renumbering. |
| "read 3a-1's shipped schema FIRST and answer: do the mint-ledger columns already exist?" | **ANSWERED: NO.** Shipped `dispatches` columns are exactly `id · session_id · project_id · task_id · agent · model · provider_name · auth_mode · cwd · started_at · ended_at · outcome · closed_by · exit_code · tokens_in · tokens_out · tokens_cached · cost_usd`. **`minted_key_hash`, `minted_key_limit`, `minted_at`, `revoked_at`, `attribution_state`, `tokens_source` are ALL ABSENT → this task DOES author migration v8**, as nullable `ALTER TABLE` statements, **with the full three-dump protocol.** Re-confirm yourself before writing DDL. |

Also current: `IpcChannel` has **36** entries and `src/main/ipc.ts` has **33** `ipcMain.handle(` registrations — this task takes them to **37** and **34**. The real dev DB is at **v7** with **36 `dispatches` rows already accumulated** (3a-1's recorder is working) and **0 rows carrying token data** — which is exactly the gap this task closes.

### Git Checks to Run First

```
git branch --show-current
git status --porcelain
git log --oneline -3
```

### Decisions You Must Honour — all RESOLVED

- **D42 (2026-07-24)** — the contract this task implements. Normative: (1) `api_key` sessions get a **per-dispatch OpenRouter key** minted with a hard `limit`, revoked and read back at dispatch end; (2) **`subscription` sessions are NEVER gateway-routed**, metered from the CLI's own local logs at lower fidelity; (3) **"% of spend attributed" is surfaced** so the gap is visible rather than silently under-reported.
- **D41** — Mission Control's telemetry slice pulled into 3a; **`tokens_cached` tracked separately** is part of the admission, not a refinement.
- **D48** — no second competing home for a fact that already has one. Applied to tokens: **there is exactly ONE telemetry table, 3a-1's, and this task fills its columns.**
- **D33** — the vault contract, in full. Clauses 4, 5, 8 and resolution (a) bind a **minted** key exactly as hard as a user key.
- **D47 / D49 (F-36-1)** — *"single-turn is PROVEN end-to-end … multi-turn and compaction are UNPROVEN … whichever phase next ships conversational work over this route must prove multi-turn before depending on it."* **That phase is this one, and that task is Step 0.**
- **D55 (2026-07-25, from Task 3a-2)** — **no telemetry number ships without its denominator, enforced by schema rather than discipline.** 3a-2's `attention:summary` carries no bare `minutes` field and a denominator-less response fails the outbound `.parse`. **`attribution:summary` inherits this bar**: "% attributed" must travel with the counts it was computed from, and a response shape that lets a caller read a percentage alone is a review failure.
- **F16** — FKs are ENFORCED. 3a-1's `dispatches` deliberately carries **no `REFERENCES` clause** because a dispatch outlives its session row. **Your v8 columns must not add one.**
- **F20 (STANDING)** — the real dev DB (projects `985d547b…` Chorus / `f47ac10b…` Chorus-Second) lives at the Claude MSIX container's redirected Roaming: `C:\Users\matth\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\chorus\chorus.db`. A raw shell's `%APPDATA%\chorus\chorus.db` is a DIFFERENT scratch DB whose dumps discharge nothing. **Electron ignores the `APPDATA` env var but honours `--user-data-dir`** — boot with the `_verify/3a-2/start-realdb.ps1` pattern (copy it into `_verify/3a-3/`). **Quote the `projects` table in every dump**; the coordinator re-verifies regardless.

## Pre-Existing Changes — Do Not Touch

The working tree contains exactly two untracked files at repo root: `TASK-3-5-REVIEW-FABLE.md` and `TASK-3-6-REVIEW-FABLE.md`. **Do NOT** revert, stage, delete, or commit them. Also never stage or revert anything under `_verify/` or `docs/` unless a step explicitly says so. Do not remove the standing `wt-24b5c1fe` worktree row, directory, or branch.

## ⚠ STANDING CONDITION — the dev vault holds REAL credentials

1. **Never dump, echo, print, copy, or transmit `credential_profiles.encrypted_blob` or `fingerprint_hash`.** Dump scripts select non-secret columns explicitly and prove blob stability with `length(encrypted_blob)`.
2. **F27 bounds what you may claim about redaction.** Claude Code discloses a masked ≥8-char fragment of an injected key in its own auth prompt, which exact-value scrubbing cannot match by construction. The honest wording is *"Chorus redacts registered exact values on ingest; it cannot redact values an agent derives"* — never "agents cannot echo the key".
3. **A minted key is a REAL key with REAL spend attached.** Everything D33 says about a user's key applies to it undiluted, and two things apply only to it: **it can be orphaned, and it can be uncapped.** Neither is acceptable.

## Implementation Scope

**Fourteen files, exactly as `Task-3a-3.md`'s Exact Scope table.** Summarised — the table governs:

- **CREATE** `attributionCore.ts` (+ `.test.ts`) — the PURE core: strategy selection from auth mode, mint-request construction, response interpretation, the sanitized failure vocabulary, orphan-reconcile classification, "% attributed" arithmetic. **No `electron`, no `fetch`, no `node:fs`, no clock.**
- **CREATE** `openrouterKeys.ts` (+ `.test.ts`) — the **ONLY** module that calls `fetch` against `/api/v1/keys*` or `/api/v1/analytics/query`. Injectable `fetchImpl`, discriminated results, leaks nothing.
- **CREATE** `dispatchAttribution.ts` — the orchestrator: mint-before-launch, read-then-revoke at end, the write-ahead ledger, boot reconcile, deferred token backfill. **Method names deliberately distinct from `DispatchRecorder`'s** (`mintForDispatch` / `settleDispatch` / `reconcileOrphanedKeys`) so the two are never confused at a call site.
- **CREATE** `subscriptionMeter.ts` (+ `.test.ts`) — best-effort metering from the CLI's own local logs. **Never gateway-routes anything.** Fixtures contain no key material.
- **EDIT** `src/main/db/schema.ts` + `src/main/services/storage.ts` — the six mint-ledger columns on **3a-1's `dispatches` table** and **migration v8**, plus the accessors. **No new table.**
- **EDIT** `src/main/ipc.ts` · `src/shared/ipc.ts` · `src/shared/ipc.test.ts` · `src/preload/index.ts` · `src/main/index.ts` · `src/main/services/logger.ts` — per the Exact Scope table.

**No `.vue` file is touched.** If a change seems to require another file — **stop and raise it**; that is a scope signal, not a detail.

## Strict Non-Goals

- **No board, no dispatch panel, no Mission Control UI of any kind.** Spec §9 Phase 0: *"No UI. No board."* The "% attributed" number is exposed over IPC and logged; rendering it is a later phase's job.
- **⚠ NO GATEWAY ROUTING OF SUBSCRIPTION SESSIONS — not for a test, not behind a flag, not "just to see if it works."** A subscription session must never receive a minted key, a `base_url` override, or an `env_key` argument. Routing a flat-rate subscription through a gateway converts it to per-token billing — **a cost-tracking feature that increases cost.** This is the single worst outcome available and it is easy to reach by accident, because a subscription launch and an api-key launch differ in one field.
- **No second telemetry table** (D48's anti-goal). **No new npm dependency** — Node's built-in `fetch`, as in `probeCredential`.
- **No budget enforcement UI or policy engine** — the hard `limit` is a safety floor, not a feature.
- **No retry, no backoff, no queue** on any management call. One request, short timeout, a result — and the boot reconcile as the durable backstop.
- **No automatic verification of the user's own credentials** — D33 resolution (d)'s Test-key carve-out is not widened.
- **No renderer-visible key material, ever** — including the minted key, its `hash`, and the management key.
- **No `launch_profiles`, no `model_catalog`** (3a-4/3a-5 own those). **No api-mode execution** — `startApiSession` stays unimplemented.
- **Do not touch the two `TASK-*-REVIEW-FABLE.md` files, `_verify/` committed content, or the `wt-24b5c1fe` fixture.**

## Required Workflow

Work as coordinator. Implement → review the diff against the Implementation Spec → a code-quality pass → resolve findings → run the gates → narrate the commit. **Stage scope files EXPLICITLY by path** — never `git add -A` (D40). Do NOT push and do NOT open a pull request unless explicitly asked.

Ordered work steps (`Task-3a-3.md` §Step-by-step governs; the numbering below is its):

0. **THE MULTI-TURN GATE — FIRST, BEFORE ANY ATTRIBUTION CODE. It is allowed to fail.** See below.
1. **The D4 verification pass, reported.** Re-verify the eight obligations against OpenRouter's **live** documentation in this session, recording what you fetched, when, and what it said. **Obligation 1 — the exact `filters` field name for a per-API-key-hash filter on `POST /api/v1/analytics/query` — is the highest-risk one: verify it BEFORE designing the token path.** If no per-key filter exists, the tokens half has no source and this task's acceptance changes.
2. `attributionCore.ts` + tests (all logic lives here).
3. **The management key's storage ruling AND its entry affordance** — an ordinary `credential_profiles` row on a `provider_configs` row whose **`auth_mode` is `'management'`** (no migration, no wire-schema change: `auth_mode` is an unconstrained string on both sides — re-verify). **⚠ The UI cannot currently produce such a row — see the precondition section; deciding how it can is part of this step.** Two guards, both named tests: **never launchable** (`resolveCredential` refuses any profile whose provider `auth_mode === 'management'`, with a label-only message) and **never used for inference**. **Decrypt-per-use, never cached** — no module-level variable holds it. **When the affordance works, PAUSE and ask Matthew to enter the key**; do not proceed to Step 4 without it. **Tell him not to press "Test key"** — OpenRouter blocks management keys from the completion endpoints, so the probe fails *by design* and a failure there says nothing about the key.
4. **Mint at dispatch start.** **Write-ahead ordering is mandatory: mint → persist the ledger row → launch.** Every minted key carries a hard `limit` and an `expires_at`. **Mint failure DEGRADES, it does not refuse** — the launch proceeds on the user's own key with `attribution_state='mint-failed'`, counted against "% attributed". This is the one deliberate departure from D33's refuse-never-degrade, and the reason is that **D33 governs credentials, not meters**.
5. **Read then revoke at dispatch end** (the fifth `onExit` listener). **Read `usage` FIRST, revoke second** — `DELETE` returns only `{"deleted": true}` and whether usage survives deletion is undocumented (obligation 6).
6. **Boot reconciliation for orphans.** A pure classifier + a thin executor, the `computeWorktreeReconcile` shape. **One absolute prohibition — never revoke a key Chorus did not mint;** ownership is proven by the mint `name` prefix and nothing else. **Ordering is load-bearing: AFTER `dispatches.healOrphansAtBoot()`, BEFORE `sessions.restore(...)`.** In `src/main/index.ts` that is the block between the recorder's heal/attach and the awaited `worktrees.reconcileAll()`.
7. **Tokens** — fill `tokens_in`, `tokens_out`, **`tokens_cached`** and `cost_usd` on 3a-1's row. `agent`/`model`/`auth_mode` are already written by 3a-1 — **do not re-write them.** `tokens_cached` is its own column, **never folded into `tokens_in`**; if derived from `cache_hit_rate`, store it and label it via `tokens_source`.
8. **Subscription metering** — read-only, failure-tolerant, no network, no gateway, explicitly lower-fidelity.
9. **"% of spend attributed"** — two labelled numbers (a dollar figure over gateway spend, a dispatch-count figure), computed in main, exposed on `attribution:summary`, logged once per boot. **Subscription spend is NEVER imputed a dollar value.**
10. Tests, then the three gates.
11. **The runtime proof (G2)** — the full sequence below.

## Verification Commands

```powershell
npm run typecheck
```
```powershell
npx vitest run
```
```powershell
npm run grep:secrets
```

**Baseline to beat, coordinator-verified 2026-07-25 at `fd4c9e5`:**
- typecheck: **0 errors** (node + web)
- vitest: **352/352 across 17 files**
- grep:secrets: **clean (6 patterns over src/, scripts/, _verify/, package.json, root configs)**

### ⚠ Step 0 — the multi-turn gate, run FIRST, allowed to FAIL

Everything below Step 0 assumes a dispatch is a **multi-turn agent session**. If that assumption is false, building attribution on it produces a correct meter over the wrong unit.

**Run it through the shipped app — not curl, not a script.** Launch a real `codex` session from the real Launch dialog against the live OpenRouter provider row (`moonshotai/kimi-k3`, provider id `6c052ee6-1eb3-4d7c-8aa3-832bd19dfd13`) with the "OR milestone key" profile selected, then drive **three sequential turns** in the pane:

1. *"Remember this token: QUARTZ-7-MERIDIAN. Reply with just OK."*
2. *"What token did I ask you to remember?"*
3. *"Repeat the token, then tell me how many messages I have sent you."*

**Pass criterion, stated before the run so it cannot be adjusted afterwards:** turn 2 returns `QUARTZ-7-MERIDIAN`, **and** no turn produces a `400`, a `previous_response_id` error, a `store` error, or a config-load failure. **Anything less is a FAIL, including a partial pass** — a model that answers turn 2 but errors on turn 3 has proven two turns, not multi-turn.

**Capture for BOTH outcomes:** the exact prompts, the verbatim pane output (screenshot + scrubbed ring buffer), and the codex command line from `Get-CimInstance Win32_Process`. On failure, capture the **verbatim error text** — the failure mode is the finding, and "it didn't work" is not a finding.

**State this in the report either way, because it is what the result actually tells us:** a stateless `/responses` endpoint forbids **server-side** conversation state (`store: true`, `previous_response_id`). It says nothing about a client that resends the full history each turn. Whether codex 0.145.0 does the latter is precisely what this step measures.

**IF IT FAILS — RE-SCOPE, DO NOT FORCE.**
- **Survives unchanged:** per-dispatch minting, the hard `limit`, revocation, orphan reconciliation, the management-key ruling, the subscription prohibition, the telemetry schema. **None depends on conversational continuity** — a minted key meters whatever is spent under it.
- **Re-scoped:** attribution ships for **single-turn dispatches only**; `attribution_state` records the limit per row; the failure is written into the roadmap as a **numbered finding with its verbatim error**; and **nothing in 3a is built that assumes a dispatch can hold a conversation.**
- **NOT sanctioned:** switching `wire_api` back to `"chat"` (the binary rejects it), pointing the route at a different endpoint to make the test pass, or driving the proof through a raw HTTP call. **The thing being proven is the shipped route.** If a fix genuinely requires changing the route's mechanism, that is a scope decision — flag, brief, pause.

**Report the outcome before writing line one of Step 1.**

### The runtime proofs — six of them, all required

Boot against the **real DB** (`--user-data-dir` launcher — copy `_verify/3a-2/start-realdb.ps1` into `_verify/3a-3/`). Full detail in `Task-3a-3.md` §Verification Commands and spec §9:

1. **The attribution proof** (spec §9.1) — mint visible via `GET /api/v1/keys` (count +1, name carries the Chorus prefix + dispatch id); **the minted key, not the user's, reached the child** (read the descendant's environment block via WMI/CIM walking from the electron main PID — **never name-matching**, there are ~16 unrelated `claude.exe` on this machine); **no command line anywhere in the tree contains any ≥8-char substring of any key**; read-then-revoke with `{"deleted": true}` and count back to baseline; the row carries **non-zero `tokens_in`/`tokens_out`, a separately populated `tokens_cached`, a non-zero cost, and the right agent and model**.
2. **The subscription-safety proof** (§9.2) — six steps; the key-list snapshot must be **byte-identical** across a `claude` launch with no credential selected, and its command line must carry **no `-c model_provider…`, no `base_url`, no `env_key`**.
3. **The crash-reconciliation proof** (§9.3) — tree-kill mid-dispatch (`taskkill /PID <root> /T /F`), confirm the orphan is real and live, cold boot, confirm it was read-then-revoked and an orphan row recorded. **The negative half the proof is meaningless without: a hand-made key WITHOUT the Chorus prefix, present at the same boot, must be left untouched.** Then delete it by hand.
4. **The revocation-failure proof** and **the mint-failure proof** (§9.4) — both degrade safely and visibly, both counted against "% attributed", both cleaned by the next boot's reconcile where applicable.
5. **The management-key-is-not-launchable proof** — a real `management` profile through the real Settings UI, then attempt to launch naming it: inline refusal **by label**, no spawn, no session row, **no management key in any environment block**.
6. **The migration proof (v8)** — the full three-dump protocol on the **real** dev DB: pre / post / second boot; **v1–v7 `applied_at` byte-identical**; every pre-existing table row-identical (including the **36 existing `dispatches` rows** and 3a-2's `attention_spans` rows); new columns nullable and reading `NULL` on existing rows; **v8 not re-applied on boot 2**; `wt-24b5c1fe` intact.

### Dump discipline

**`sqlite3` is NOT installed.** Use the `ELECTRON_RUN_AS_NODE` pattern (precedent: `_verify/3a-1/dump-v7.js`, `_verify/3a-2/dump-attention.js`); write results to a file. **Known flake: no file on the first invocation — retry once.** **Quote the `projects` table in every dump (F20)** — the real pair is `985d547b…`/`f47ac10b…`; a dump showing `a43b395d…`/`b684e96e…` describes the scratch DB and discharges nothing. **Never dump `credential_profiles.encrypted_blob` or `fingerprint_hash`.**

### Harness Caveats — verified through 2026-07-25

- **electron-vite does NOT hot-restart the main process**; HMR covers the renderer only. **Every main-process change needs a real cold boot.**
- **Graceful quit:** `taskkill` WITHOUT `/F` (WM_CLOSE) does **not** terminate the dev app in this (NoMachine) session. Use a CDP `window.close()` evaluate — it takes the same close path (`window-all-closed` → `before-quit`). Kill process **TREES** with `taskkill /PID <root> /T /F` for the crash cases.
- **Boot against the real DB** with `--user-data-dir=C:\Users\matth\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\chorus`.
- CDP on `--remote-debugging-port=9222`; wrap every `Runtime.evaluate` body in an IIFE (top-level `const` collides across evaluates); CDP-driven Vue forms need a microtask tick between `input` and submit-click. Harness precedent: `_verify/3a-2/cdp.js`.
- **⚠ Never type into a CLI whose input mode you have not read first** — screenshot and read the pane before sending keystrokes. **This binds Step 0 directly:** you are typing three turns into a live codex TUI.
- **The dev window is NOT foregrounded by default** in a harness session, and other desktop apps steal foreground mid-run (F29). Irrelevant to attribution, but it will bite any screenshot-based check — foreground deliberately (`_verify/3a-2/focuswindow.ps1`) and verify.
- All artifacts under `_verify/3a-3/`.

## Failure Honesty Clause

If any verification command fails for an unrelated environment reason, capture the EXACT output, explain it, and DO NOT claim success. An indeterminate result is reported as indeterminate and the affected acceptance criterion is marked **FAILED** — never reasoned into a pass. An unproven claim is worse than an honest unknown because it will be cited later as evidence. **A remembered endpoint shape is a D4 violation regardless of whether it happens to be right.** Temporary instrumentation must be reverted and the review checks the COMMIT DIFF, not the worktree.

## Final Reporting Requirements

Report a status of exactly one of: **DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED**, plus:

- **Step 0's result, stated as a fact** — PASS or FAIL, the pass criterion as declared in advance, the verbatim transcript, and on failure the verbatim error text plus the re-scope you applied. *"We assumed it works"* is a FAIL of this criterion regardless of what the code does.
- **The eight D4 obligations**, each verified or explicitly recorded as still-unverified, with what was fetched and when. Obligation 1 (the analytics per-key filter field) called out separately — if it was not verified, say so plainly, because the token half then rests on a guess.
- The commit SHA and every file changed (only the Exact Scope files)
- Typecheck / vitest / grep:secrets results with **actual numbers**
- **`MIGRATIONS.length` before and after** (7 → 8), and the three-dump protocol results with `applied_at` values quoted
- The end-to-end attribution row, **dumped**, with non-zero tokens and the right agent and model
- Proof that **every** minted key carried a hard `limit` — from each create-response's `data.limit`
- The five-surface inspection for the minted key, **including the positive environment-block check** (an all-absence result is also what a completely broken injection looks like)
- The subscription-safety proof with the **byte-identical** key-list snapshot
- The crash-reconciliation proof **including the negative half** (a non-Chorus key left untouched)
- The management-key refusal, proven at runtime with a real profile
- The "% of spend attributed" numbers, both labelled, with subscription spend **not** imputed a dollar value
- **Actual spend**, against the < $0.30 envelope, and confirmation no run raised its own ceiling
- Confirmation: no second telemetry table; no `.vue` file touched; `IpcChannel` 37; `ipcMain.handle(` 34; the two `TASK-*-REVIEW-FABLE.md` files untracked and unmodified; `wt-24b5c1fe` intact
- Confirmation each non-goal held — **the subscription prohibition proven STRUCTURALLY** (exactly one mint call site, inside the `'minted-key'` branch, whose condition tests `AuthMethodDefinition.type`), not just behaviourally
- Residual risks and known gaps
