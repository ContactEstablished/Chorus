# Task 3a-4 — `model_catalog` + Refresh, and Effort Normalization

_Fourth task of Phase 3a (Profiles & Catalog). Windows-only. **ONE narrated commit (G3).** This task governs **scope**; `ImplementationSpecs/ImplementationSpec-3a-4.md` governs exact contents, DDL, insertion points, and rationale._

> **⚠ COORDINATOR RULING — migration numbering, 2026-07-24. This supersedes every conditional "v8 or v9" phrasing below.** The five task docs were authored in parallel and each hedged its own migration number against the others. Because Phase 3a executes **strictly serially**, the numbers are deterministic and are fixed here: **3a-1 → v7 · 3a-3 → v8 · 3a-4 → v9 · 3a-5 → v10.** Task 3a-3 **does** take a migration (its mint ledger is durable crash-reconciliation state), so **this task is v9**. **Standing check for every implementer:** confirm `MIGRATIONS.length + 1` equals your expected number before appending, and if it does not, **stop and report the divergence** rather than renumbering silently — a mismatch means a prior task shipped something its doc did not describe.

**⚠ THE MOST IMPORTANT OUTPUT OF THIS TASK IS NOT CODE — IT IS THE MODEL-PRECEDENCE RULING.** D48 was written because "which model" briefly had two competing homes and the cost was a migration in the phase's most security-critical session. This task introduces a **third** artefact that talks about models, and the entire reason the roadmap flagged it (_"three roles, one precedence order, and the kickoff must write that order down explicitly"_) is that a catalog is the single most natural place for a second authority to grow back. **`model_catalog` is a list of what exists. It is not an authority, it has no position in the precedence order, and it never writes to either home.** The normative table is in Goal; the worked examples are in the spec §3.

## Source Of Truth

- `docs/Features/Foundation/roadmap.md` §7 **Phase 3a** — the phase entry. Three bullets bind here, and the first is the one this task exists to discharge:
  - _"**`model_catalog` is a list of what exists**, `provider_configs.model` is *this route's default*, `launch_profiles.model` is *the choice for this launch* — three roles, one precedence order, and the kickoff must write that order down explicitly."_
  - _"Phase 3's non-goal barring catalogs/caching/refresh applied **to Phase 3**; `model_catalog` is this phase's declared scope, so the kickoff should record the lift explicitly rather than assume it."_ **§"The lift, stated" below is that record.** It is not assumed.
  - The scope line itself: _"`model_catalog` table + refresh (the "list models" call doubling as Test key); **effort normalization** (one app-level Fast/Balanced/Deep/Max slider mapped per adapter, raw override in `extra_args` — PLAN §4)."_ **This task rules AGAINST the "doubling as Test key" merge, on evidence — see Goal.**
- Roadmap §6 **D48** — `provider_configs.model` is the ROUTE's default model, and the one-home anti-goal. The governing decision for half this task.
- Roadmap §6 **D47 / D49**, and **F-36-4** — the shipped OpenRouter route and the wrong-model-slug failure that this task's staleness policy is designed around. `moonshotai/kimi-k2.7` was not a real slug; `probeCredential` surfaced the provider's 400 as the sanitized `Unexpected response (400).`, which correctly proved auth passed and the model id was wrong.
- Roadmap §6 **D33**, in full — in particular **clause 3** (write-only inbound IPC), **clause 8** (refuse, never degrade), and **resolution (d)**, whose Test-key carve-out this task **widens by one call and must narrate as such** (see the ⚠ under Exact Scope).
- Roadmap §6 **D45(4)** — api mode is **declared-only**. `ApiAgentAdapter.getModels` has zero implementations and gains none here.
- Roadmap §6 **D7** — Drizzle is types + queries only; migrations stay in the hand-rolled `MIGRATIONS` array. Never drizzle-kit.
- Roadmap §5 **F16** — FKs are **ENFORCED**. The reason `model_catalog` carries no `REFERENCES` clause; see Exact Scope.
- Roadmap §5 **F20** — verification provenance. The coordinator re-verifies every DB claim against the real `%APPDATA%\chorus\chorus.db`.
- `docs/PLAN.md` **§4** (Adapter Abstraction → "Concrete mappings (verify flags at build time — CLIs move fast)" and **"Effort normalization"**: _"One app-level slider — **Fast / Balanced / Deep / Max** — mapped per adapter; raw override always available in `extra_args`."_) and **§13** (the data model's `model_catalog (provider_id, model_id, display_name, tier, refreshed_at)`). **Read §4 before writing any effort code.**
- `docs/Features/Foundation/Tasks/Phase-3-Overview.md` — the cross-cutting rules survive the phase boundary unchanged: all Zod in main (D1/CSP), plain-object IPC (D14), secrets never in argv/logs/transcripts, **never widen the blast radius to prove a feature**, and **D4**: verify CLI flags against the installed tool's own `--help`/config reference **at execution time**.
- `Tasks/Task-3a-1.md` + `ImplementationSpecs/ImplementationSpec-3a-1.md` — migration **v7**, the three-dump protocol reproduced below, the `dump-v7.js` harness shape, and the **no-`REFERENCES`** precedent. Consumed, not relitigated.
- `Tasks/Task-3a-3.md` — the sibling that **conditionally** takes migration v8. **This is a live numbering hazard; see Dependencies.** Its `probeCredential`-discipline paragraph is inherited verbatim here.
- `Tasks/Task-3-6.md` + `ImplementationSpec-3-6.md` — the shipped route, `probeCredential`, and the `_verify/3-6/` harness (`cdp35.js`, `dump-v6.js`, `read-env.ps1`).
- `CLAUDE.md` — locked stack; **D4**; secrets never in CLI args.

## Initial Starting Point

**Verified by the coordinator 2026-07-24 against `15a016e`** (Task 3-6, code HEAD for `src/`). Anchored to **named symbols, never line numbers** (standing house rule). **Re-verify at execution: Tasks 3a-1, 3a-2 and 3a-3 all land between this doc and its execution, and 3a-1 and possibly 3a-3 move the schema underneath it.**

- **Baseline:** `npm run typecheck` exits 0 (node + web) · `npx vitest run` = **273/273 across 14 files** · `npm run grep:secrets` clean (6 patterns). 3a-1 … 3a-3 grow this; confirm the then-current figures rather than these.
- **The working tree carries two untracked files at repo root: `TASK-3-5-REVIEW-FABLE.md` and `TASK-3-6-REVIEW-FABLE.md`.** They are not yours. **Do not commit them, do not delete them, do not revert them.**
- **Migrations.** `const MIGRATIONS: string[]` in `src/main/services/storage.ts`, **six entries at `15a016e`**; v6 is `ALTER TABLE provider_configs ADD COLUMN model TEXT;`. The runner is the private `migrate()` method over `schema_migrations` — hand-rolled, applied in order, each version in its own transaction.
- **`provider_configs` columns:** `id, name, adapter_type, auth_mode, env_var_name, base_url, extra_headers_json, model, created_at`. **`model` shipped in v6 (D48) and is the ROUTE'S DEFAULT — a default, not an authority.** It is nullable because a subscription route has no model to name. **Live row on the real dev DB:** OpenRouter / `codex` / `https://openrouter.ai/api/v1` / `moonshotai/kimi-k3`.
- **`credential_profiles` columns:** `id, provider_id, label, encrypted_blob, fingerprint_hash, created_at, last_verified_at, unavailable_since, reencrypted_at`, `UNIQUE(provider_id,label)`. One live row: **"OR milestone key"**.
- **`auth_mode` is an UNCONSTRAINED string on both sides** — `text('auth_mode').notNull()` in `schema.ts`, `z.string().min(1).max(60)` on the wire. Task 3a-3 adds the `'management'` value with no migration; this task must **refuse to refresh** against it (Exact Scope).
- **The live-probe precedent is `probeCredential` in `src/main/ipc.ts`**, with its helper `probeFailure`. **Read both before designing any network call.** It POSTs `${baseUrl}/chat/completions`, **cancels the response body without reading it**, maps status codes to a **fixed vocabulary**, collapses every exception to `'Could not reach the provider.'`, and passes every outbound string through `scrubSecrets`. That discipline is inherited verbatim — **with one deliberate, dangerous difference this task must handle explicitly: a refresh has to READ the body on success.** See Exact Scope and spec §5.
- **`credential:test` is the ONLY existing live-call channel** (`IpcChannel.CredentialTest`), user-initiated only per D33 resolution (d) — _"never at boot, launch, on a timer, or on profile creation"_, as its own channel comment says. This task adds the second such channel and inherits every word of that constraint.
- **Adapters.** `src/main/adapters/types.ts` declares `BaseAgentAdapter.getCapabilities()`, `AgentCapabilities`, `AuthMethodDefinition`, `ModelInfo`, `EffortDescriptor`, `EffortOption`, and `ApiAgentAdapter.getModels(credential?, signal?)` **with ZERO implementations**. `mergeCapabilities` (`src/main/adapters/capabilities.ts`) merges static + detected. Registry: `src/main/adapters/registry.ts`; channel `adapter:list` returns `{id, displayName, executionMode, authMethods[], capabilities}`.
- **⚠ `EffortOption`/`EffortDescriptor` EXIST AND ARE UNPOPULATED.** `EffortOption` is `{id, label, cliFlag}`; `EffortDescriptor` is `{mode: 'static'|'dynamic', levels}`. **Both `claudeAdapter` and `codexAdapter` declare `reasoningEffort: null` today, with a comment naming Phase 3a as the owner** — `claude.ts`: _"reasoningEffort: NULL even though --help shows `--effort (low|medium|high|xhigh|max)` — effort normalization is Phase 3a's job, and guessing its descriptor here would put unverified shape on a seam 3a builds on."_ **That seam is this task.** `PtyLaunchSpec.effortOptionId?: string` is already declared and unread. Reuse all four names; invent no parallel ones.
- **`cliFlag` has ZERO producers.** Grep-verified 2026-07-24: `cliFlag` appears only in `src/main/adapters/types.ts`, the `effortOptionSchema` in `src/shared/ipc.ts`, and two test files (`src/shared/ipc.test.ts`, `src/main/adapters/adapters.test.ts`) — always as a fixture. **No adapter emits one and no consumer reads one.** That is what makes §"the `args` ruling" below free today and expensive after 3a-5.
- **The launch seam:** `SessionManager.launch(agent, cwd, sessionId, opts: LaunchOptions)` → private `spawn(...)`, which calls `composeChildEnv` (`src/main/adapters/env.ts`) and builds `PtyLaunchSpec` for `adapter.buildLaunch`. `LaunchOptions` already carries `secrets`, `credential`, `route` (3-6). `buildLaunch` is **SYNCHRONOUS by necessity** (`SessionManager.launch()` is sync) — do not make effort resolution async.
- **`codexAdapter.buildLaunch` already emits `-c` dotted-path overrides** through its local `tomlString` quoter and `-m <model>` from `spec.route.modelId`. The effort override is the same mechanism, one line down. **Reuse `tomlString`; do not write a second quoter.**
- **Settings UI:** `src/renderer/src/views/SettingsProviders.vue` (provider cards with nested credential rows; `fModel` is a **free-text** input added in 3-6/D48), `SettingsCredentials.vue` (the Test-key button, `testingId`/`testResult`), store `src/renderer/src/stores/settings.ts` (`useSettingsStore`, flat `providers`/`profiles`/`adapters` lists, `loadSeq` supersede guard, `refuse(reason)` helper).
- **Harness precedent:** `_verify/3-6/dump-v6.js` (read-only dump under `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe`), `_verify/3-6/cdp35.js` (the CDP driver, port 9222), `_verify/3-6/read-env.ps1` (external environment-block read). **Read `dump-v6.js` before writing `dump-v8.js`, and apply 3a-1's mandatory change: it `SELECT *`s from `credential_profiles` and yours must not.**

### ⚠ Standing condition — the dev vault holds a REAL, BILLABLE credential

Coordinator-established 2026-07-24 and recorded in roadmap §5: **Matthew's real OpenRouter key lives in the real dev vault** under the credential profile **"OR milestone key"** (provider "OpenRouter", model `moonshotai/kimi-k3`, `last_verified_at 2026-07-24T17:04:26.840Z`). His key, his vault, his machine, deliberately left in place.

Binding consequences:

- **Never dump, echo, print, copy, or transmit `credential_profiles.encrypted_blob` or `fingerprint_hash`.** Select non-secret columns explicitly and prove blob stability with `length(encrypted_blob)` — a byte count is not key material and is sufficient evidence that a migration did not touch the blob.
- **Do not press Test key on "OR milestone key".** Nothing in this task needs it, and this task's own refresh is a different call.
- **Cost envelope — see Verification Commands. It is $0.00, and that is a verified fact, not an optimism.**

### The lift, stated — Phase 3's catalog non-goal is discharged here, not assumed

`Phase-3-Overview.md` § Phase Non-Goals says, verbatim: _"**No `model_catalog` table, no catalog caching or refresh** — Phase 3a. Task 3-6's test-key is a single live probe returning ok/fail, not a cached catalog."_ and _"**No effort normalization, no Fast/Balanced/Deep/Max slider, no `launch_profiles`** — Phase 3a."_

**Both non-goals were scoped to Phase 3 and both are lifted by this task, deliberately and on the record.** The roadmap's Phase 3a entry names `model_catalog` and effort normalization as declared scope; D28 deferred them rather than rejecting them. Nothing else in either non-goal list is lifted — in particular **`launch_profiles` stays deferred to Task 3a-5**, and **api-mode execution stays barred by D45(4)**.

**⚠ One artefact from Task 3-6 is relevant and must not be treated as data.** OpenRouter's catalog was queried once during 3-6 and the returned list was **deliberately discarded** under the then-standing non-goal. It showed `kimi-k3`, `kimi-k2.7-code`, `kimi-k2.6` and others, and **no `kimi-k2.7`** — which is exactly the fact F-36-4 needed and did not have at the time. **That observation is a motivation for this task, not a seed for its table.** The catalog this task ships starts **empty** and is populated only by a real refresh run through the shipped app.

## Goal

Give Chorus an honest, cached answer to _"what models does this route actually offer?"_ — and make the app-level **Fast / Balanced / Deep / Max** slider a real, per-adapter-mapped launch control instead of a PLAN paragraph.

Four rulings define the work. Each is a way this can be built wrong while looking right, and each is normative for every later phase.

### 1. ⚠ THE MODEL-PRECEDENCE ORDER — normative

There is **exactly one** order in which a model id is resolved for a launch, and `model_catalog` is not in it.

| Rank | Home | Role | Written by | May be NULL? |
|:--:|---|---|---|:--:|
| **1 (wins)** | `launch_profiles.model` | **the choice for THIS launch** | Task **3a-5** | yes — a profile need not pin a model |
| **2** | `provider_configs.model` (v6, D48) | **this route's DEFAULT** | the user, in Settings | yes — a subscription route has no model to name |
| **3 (floor)** | *nothing* | the agent CLI's own default — **no `-m` is emitted at all** | — | — |
| **— (not in the order)** | **`model_catalog`** | **a LIST OF WHAT EXISTS** | this task's refresh | the whole table may be empty |

**Normative sentences, to be reproduced verbatim in the code comment above the `model_catalog` DDL and in the commit message:**

- **`model_catalog` is NOT authoritative over either other home, and never writes to them.** No code path in this task issues an `UPDATE provider_configs`, and none may issue an `UPDATE launch_profiles` when that table exists. Grep the diff.
- **A catalog miss never blocks, clears, defaults, or rewrites a saved model.** The catalog is a cache of a third party's opinion, taken at one instant, and it can be wrong: a partial refresh, a provider-side blip, a beta endpoint, a model visible only to certain accounts. **The provider is the authority on whether a model id resolves — F-36-4 is precisely that lesson**, and turning a stale cache into a launch gate would convert a warning into an outage.
- **The catalog's entire job is to make the F-36-4 failure legible EARLY** — at the moment the user picks a model, rather than at launch when a sanitized `Unexpected response (400).` is all anyone gets.
- **The UI expression of non-authority is that the model field stays free-text-capable.** `SettingsProviders.vue`'s `fModel` gains a picker sourced from the catalog; it does **not** become a closed `<select>`. A user must always be able to type an id the catalog has never heard of. **A closed select would make the catalog authoritative by construction, without anyone deciding to.**

Worked examples for every combination, including the nulls, are in **spec §3** and are required reading before the first line of code.

### 2. ⚠ The staleness policy — because a silently stale cache reproduces F-36-4 with a friendlier face

A cached list that quietly goes stale is worse than no list: the user picks from it, believes they chose something real, and finds out at launch. So freshness is a **first-class, rendered fact**, and the design carries three distinct states that must never collapse into one:

| State | Definition | What the provider card shows | Effect on launch |
|---|---|---|---|
| **never refreshed** | no `model_catalog` row for this provider | _"No model list yet · Refresh"_ | **none** |
| **fresh** | newest `refreshed_at` for this provider is **< 24 h** old | the list, plus _"updated 12 minutes ago"_ | **none** |
| **stale** | newest `refreshed_at` is **≥ 24 h** old | the list, plus _"⚠ last updated 3 days ago · Refresh"_ | **none** |

- **The threshold has ONE home: main.** `model:list`'s response carries `refreshedAt` and a computed `stale: boolean`; the renderer does **no date arithmetic**. A renderer-side threshold is a second home for the policy and would drift the first time someone changes it.
- **Nothing auto-refreshes. Ever.** Not at boot, not on opening Settings, not on a timer, not on provider create, not on credential create. This is D33 resolution (d)'s discipline applied to the second live call in the app, and it is also what keeps the cost envelope at zero and the user's key un-decrypted unless they asked.
- **A stale catalog is still shown.** A stale list is more useful than an empty one, and hiding it would push the user back to typing ids from memory — the exact behaviour that produced `kimi-k2.7`.
- **A model that DISAPPEARS is marked, never deleted.** The refresh sets `missing_since` on the first refresh that does not see a previously-catalogued id, and **never removes the row**: deleting it would destroy the only evidence that the id was ever real, which is precisely the fact a user staring at a failing saved route needs. A model that reappears has `missing_since` cleared.
- **A missing model is not offered for NEW selections**, but is rendered — struck through, with its `missing_since` date — wherever it is already named.
- **⚠ THE CASE THAT MATTERS: a saved route still names a model the catalog now reports missing.** Ruling, in full:
  - The route **still launches**, unchanged. Nothing is cleared, nothing is substituted, no dialog blocks.
  - The provider card renders a warning naming the model and the date: _"`moonshotai/kimi-k2.7` was not in the last refresh (2026-07-24). It may have been retired — launches naming it will fail at the provider."_
  - The same warning appears in the launch dialog next to the resolved model, so the user meets it **before** spending a launch, not after.
  - **No automatic remediation, of any kind.** Not clearing the column, not falling back to the newest sibling, not picking `openrouter/auto`. Every one of those silently changes which model the user's work runs on — a strictly worse failure than a legible error, and unrecoverable after the fact.
  - **`expires_at`** (OpenRouter publishes `expiration_date` per model — D4-verified 2026-07-24, see below) is captured so this warning can fire **before** the model disappears rather than after.

### 3. ⚠ Refresh does NOT replace Test key — and this is an evidence-backed reversal of the roadmap's phrasing

The roadmap's scope line reads _"`model_catalog` table + refresh (the "list models" call doubling as Test key)"_. **The merge is argued and REJECTED.**

**The case FOR merging is genuinely good, and is the reason the roadmap wrote it that way:** one live call instead of two; one failure vocabulary; a list-models call costs nothing where a chat-completions probe spends a token; and — the sharp argument — a list call **cannot be confused by a bad model id**, whereas `probeCredential` sends `provider.model` and a wrong slug produces a 400 that *looks* like a failure. That is F-36-4 exactly: `moonshotai/kimi-k2.7` surfaced as `Unexpected response (400).` and only careful reading established that auth had in fact passed.

**The case AGAINST is decisive, and it is a measured fact rather than a worry.** **⚠ D4-verified by the author, 2026-07-24: `GET https://openrouter.ai/api/v1/models` returns HTTP 200 with the full model list and NO `Authorization` header at all.** A "Test key" implemented as a list-models call would therefore report **success for a garbage key, an empty key, or no key** — on the one provider route the app actually ships. That is not a weaker test; it is a test that cannot fail, presented to the user as proof their credential works. Shipping it would be worse than shipping nothing.

**The ruling:**

1. **`credential:test` and `probeCredential` are UNTOUCHED.** Not refactored, not re-pointed, not "shared". The Test-key button keeps doing exactly what 3-6 shipped.
2. **`model:refresh` sits BESIDE it** and inherits its discipline verbatim — sanitized fixed-vocabulary failures, no provider body echoed to the renderer, no key in any log, one call, no retry, no backoff, no timer.
3. **A successful refresh does NOT write `last_verified_at`.** It is not evidence of authentication, because it demonstrably is not.
4. **The credential is OPTIONAL on refresh.** With a profile selected the key travels in the `Authorization` header (most OpenAI-compatible `/v1/models` endpoints do require it); with none selected the call goes out unauthenticated (which, verified above, works for OpenRouter). **One code path, one conditional header** — and the pleasant consequence is that a user can populate a catalog *before* storing any key.
5. **What the roadmap actually wanted is delivered by a different route:** the catalog is what stops a `kimi-k2.7` from ever being typed. That is the F-36-4 remedy, and it does not require pretending a public endpoint authenticates anybody.
6. **If, at execution, D4 re-verification shows the provider's `/models` endpoint DOES reject an invalid key (401/403),** the implementer records that as a finding — **and still does not merge**, because the merge would then hold for one provider and silently not for another, which is a worse contract than two honest calls.

### 4. ⚠ Effort normalization — one order, same philosophy as the model table

PLAN §4: _"One app-level slider — **Fast / Balanced / Deep / Max** — mapped per adapter; raw override always available in `extra_args`."_ The precedence ruling mirrors the model table's, deliberately, so the app has **one philosophy** rather than two:

| Rank | Source | Role |
|:--:|---|---|
| **1 (wins)** | the raw override in `extra_args` | the user has said what they want in the CLI's own vocabulary |
| **2** | the app-level **Fast / Balanced / Deep / Max** level, mapped per adapter | the normalized control |
| **3 (floor)** | nothing emitted | the CLI's own default |

**And the rule that makes rank 1 mean something:** when `extra_args` contains a token Chorus recognises as **that adapter's effort knob**, Chorus emits **no effort argument of its own at all** — it does not emit both and rely on the CLI's last-wins parsing. Last-wins is per-CLI, unverified, and differs between an argv flag (`claude --effort`) and a config override (`codex -c model_reasoning_effort=`). **One authority per launch, decided in one pure function, is the whole point.** (This is the same shape as `composeChildEnv`'s ordering under D54 — inherited < pins < `envAdditions` < `secretEnv` — and it should read as familiar.)

**When an adapter has no meaningful effort axis, the slider is ABSENT — not disabled.** `getCapabilities().reasoningEffort === null` means the control does not render. Rationale, and it is a house rule rather than a preference: PLAN §4 already says _"LaunchDialog renders only what the selected adapter's capabilities allow"_, and Task 3-4's non-goals barred exactly this shape — _"A disabled placeholder button is also out — do not ship dead UI."_ A greyed slider invites the user to wonder what they did wrong. **Do not add explanatory text either; absence is the message.**

## Exact Scope

**ONE commit.** No chore commit is sanctioned for this session — if a pre-existing defect surfaces, raise it rather than folding it in.

| File | Change |
|---|---|
| `src/main/db/schema.ts` | **Edit.** The `modelCatalog` Drizzle table + `$inferSelect`/`$inferInsert` types, matching the migration's DDL column for column. |
| `src/main/services/storage.ts` | **Edit.** The migration (**version number — see Dependencies**) plus the catalog accessors named in spec §4, **and the provider-delete purge** (below). |
| `src/main/services/modelCatalogCore.ts` | **Create.** The PURE core: response parsing + per-row validation, the refresh **diff** computation, the staleness predicate, and the sanitized failure vocabulary. **No `electron`, no `fetch`, no `node:fs`, no clock** — time is a parameter. Precedent: `vaultCore.ts`, `restore.ts`, `attributionCore.ts` (3a-3). |
| `src/main/services/modelCatalogCore.test.ts` | **Create.** Unit tests for every branch in Test Expectations. |
| `src/main/services/modelCatalog.ts` | **Create.** The **ONLY** module in the repo that fetches `${baseUrl}/models`. Thin transport with an injectable `fetchImpl`; decrypts through the vault at the moment of the call and drops it; delegates every decision to the core. |
| `src/main/services/modelCatalog.test.ts` | **Create.** Transport tests against a stub `fetchImpl` — status mapping, body-read-only-on-2xx, size cap, exception collapse, timeout, header key-set. |
| `src/main/adapters/effort.ts` | **Create.** The pure `resolveEffortArgs(descriptor, level, extraArgs)` and the recognised-knob predicate. Sits beside `env.ts`, the same shape of module. |
| `src/main/adapters/effort.test.ts` | **Create.** The mapping table + the precedence cases. |
| `src/main/adapters/types.ts` | **Edit.** `EffortOption.cliFlag: string` → **`args: readonly string[]`** (the ruling below), and the doc comment on `EffortDescriptor` naming the app-level level ids as `EffortOption.id`'s vocabulary. |
| `src/main/adapters/claude.ts` | **Edit.** Populate `reasoningEffort` with the D4-verified descriptor; `buildLaunch` consumes `spec.effortOptionId` + `spec.extraArgs` via `resolveEffortArgs`. |
| `src/main/adapters/codex.ts` | **Edit.** Same, through the existing local `tomlString` quoter. **Do not write a second quoter.** |
| `src/shared/ipc.ts` | **Edit.** `ModelList` + `ModelRefresh` channels and their request/response schemas; `effortLevelSchema`; `effortOptionSchema.cliFlag` → `args`; `session:launch`'s request gains an optional `effort`. **No payload may carry key material.** |
| `src/main/ipc.ts` | **Edit.** The two `model:*` handlers, and threading `effort` from the parsed launch request into `LaunchOptions`. |
| `src/preload/index.ts` | **Edit.** Two typed forwarders: `listModels`, `refreshModels`. Zod-free (D1). |
| `src/main/services/sessionManager.ts` | **Edit.** `LaunchOptions` gains `effort?`/`extraArgs?`; both are passed into the `PtyLaunchSpec` handed to `buildLaunch`. **No other behaviour change.** |
| `src/renderer/src/stores/settings.ts` | **Edit.** `modelsByProvider` state + `loadModels` / `refreshModels` actions, on the existing `loadSeq`/`refuse` idiom. |
| `src/renderer/src/views/SettingsProviders.vue` | **Edit.** The catalog section on the provider card: freshness label, Refresh button, the model **picker that does not replace the free-text input**, and the missing-model warning. |
| `src/renderer/src/components/LaunchDialog.vue` | **Edit.** The Fast/Balanced/Deep/Max control, **rendered only when the selected adapter declares a descriptor**, plus the missing-model warning beside the resolved model. |
| `src/shared/ipc.test.ts` | **Edit.** Cases for the two new channels, including the key-set assertion that no response field can carry key material. |
| `src/main/adapters/adapters.test.ts` | **Edit.** The `cliFlag` → `args` fixture change and a capability-honesty case for the populated descriptors. |
| `_verify/3a-4/dump-v8.js` | **Create (untracked harness, not committed).** The three-dump script, adapted from `_verify/3-6/dump-v6.js` **with 3a-1's mandatory credential-blob change**. |

Nothing else. **No `.vue` file beyond the two named.** If a change seems to require another file — especially `src/main/services/vault.ts`, `vaultCore.ts`, or anything 3a-1/3a-3 created — **stop and raise it**; that is a scope signal, not a detail.

### ⚠ `model_catalog` carries NO `REFERENCES` clause, and the provider-delete purge is explicit

FKs are **ENFORCED** (F16). A `provider_id TEXT REFERENCES provider_configs(id)` would default to RESTRICT, so the first `provider:delete` on a provider that had ever been refreshed would **throw** — breaking a flow that has worked since Task 3-4, for a table that is a cache. That is 3a-1's `dispatches` reasoning applied to a different table, and the conclusion is the same: **no `REFERENCES`, anywhere in this migration.**

The consequence is handled rather than ignored: **`StorageService`'s provider-delete accessor purges that provider's `model_catalog` rows inside the same transaction, before deleting the provider row.** A cache that outlived its route is not dangerous, but it is untrue, and the purge costs one statement. **The existing count-and-refuse on `credential_profiles` is untouched** — profiles still block a delete; a catalog never does.

### ⚠ This task WIDENS D33 resolution (d)'s carve-out by exactly one call — narrate it, do not slip it in

D33 resolution (d) gave the honest "your key never leaves this machine" guarantee a **Test-key carve-out**, and its channel comment makes the constraint explicit: user-initiated only, _"never at boot, launch, on a timer, or on profile creation."_ Task 3a-3's non-goals restate it: _"This task adds no new path that sends a user's stored key anywhere."_

**`model:refresh` is a second such path, and the commit message must say so in those words.** It is admitted on the same terms, and the terms are what make it admissible:

- **User-initiated only.** One button, one call, no retry, no backoff, no timer, no boot hook, no on-open hook.
- **Decrypt at the moment of the call, drop immediately.** No module-level variable, no memo, no "hold it for the session" — the `resolveCredential` discipline.
- **Refused for a profile carrying `unavailable_since`** (D33 clause 8: refuse without re-attempting decryption), by label only.
- **Refused outright when the provider's `auth_mode === 'management'`** (Task 3a-3's higher-privilege class) — a management key must never be sent to an inference-adjacent endpoint, and Chorus enforces that at its own boundary rather than trusting the provider to.
- **Optional.** With no profile selected the call carries no key at all, which is the safest default and demonstrably sufficient for the shipped route.

### ⚠ The `args` ruling — `EffortOption.cliFlag` becomes `args: readonly string[]`

`cliFlag: string` cannot express what either installed CLI actually needs:

- claude 2.1.218 wants **two argv tokens**: `['--effort', 'high']`.
- codex 0.145.0 wants **two argv tokens** of a different shape: `['-c', 'model_reasoning_effort="high"']`.

A single string forces either a whitespace split (which breaks the moment a value needs quoting — and codex's values *are* TOML-quoted) or a per-adapter `switch` in `buildLaunch` that duplicates the mapping the descriptor already holds. **The second is the real danger: it puts the mapping in two homes, in the same task whose headline output is a one-home ruling.**

So the field is **replaced, not supplemented** — `args: readonly string[]`, one home, no `cliFlag` left behind to drift. This is free **today** and expensive after 3a-5: grep-verified 2026-07-24, `cliFlag` has **zero producers and zero real consumers** — it appears only in the type, the wire schema, and two test fixtures. **If, at execution, that grep returns a real producer, stop and raise it** rather than doing a mechanical rename over live code.

## Non-Goals

- **Do not revert, stage, delete, or commit the two untracked `TASK-3-5-REVIEW-FABLE.md` and `TASK-3-6-REVIEW-FABLE.md` files at repo root.** They belong to prior sessions' review record. Leave them exactly as found.
- **No api-mode implementation — `getModels` stays declared-only (D45(4)).** The refresh is a standalone main-process service, **not** an `ApiAgentAdapter.getModels` implementation. It looks like the natural home and it is barred: `getModels` lives on `ApiAgentAdapter`, both shipped adapters are `PtyAgentAdapter`, and implementing it would require an api-mode adapter instance. `startApiSession` stays unimplemented; `ApiAgentAdapter` keeps zero instances; `SessionManager` stays PTY-only.
- **No `launch_profiles` — that is Task 3a-5.** No table, no migration column, no schema.ts definition, no IPC channel, no "temporary" place to persist a chosen effort level or model. The effort level chosen in the launch dialog is **per-launch and unpersisted** in this task, deliberately: persisting it anywhere else would create a second home for a launch choice, which is D48's anti-goal in a new costume.
- **No raw-`extra_args` INPUT SURFACE.** This task ships the **precedence rule and its pure resolver**, plumbed through `PtyLaunchSpec`. The text field and its storage arrive with `launch_profiles` in 3a-5 — and 3a-5 must carry the warning this task records: **`extra_args` becomes argv, and argv is world-readable** (`Get-CimInstance Win32_Process`). Shipping a free-text argv field in the same task that adds a second key-bearing network call is a blast-radius decision nobody has made.
- **No board, no dispatch panel, no Mission Control UI.** Mission Control spec §9 Phase 0 is _"No UI. No board."_ and nothing here changes that.
- **No `tier` column.** PLAN §13 names `model_catalog (provider_id, model_id, display_name, tier, refreshed_at)`. **`tier` is deliberately omitted**: no provider response field maps to it, so it could only be filled by a hardcoded classification of third-party model names that would rot within weeks. **This is a conscious deviation from PLAN §13 and must be narrated in the commit message**, not left for a later reader to discover.
- **No auto-refresh of any kind** — not at boot, on Settings open, on provider create, on credential create, on launch, or on a timer. See the staleness policy.
- **No write from the catalog to `provider_configs.model`.** No `UPDATE provider_configs` statement exists anywhere in this diff. No clearing, no defaulting, no "helpful" substitution of a retired model.
- **No pricing, no context-window-driven behaviour, no model recommendation, no cost estimation.** The refresh may **store** `context_length` (it is free and it is the one field a user genuinely reads when choosing) but nothing in the app reasons over it, and **pricing is not stored at all** — a cached price is a number that will one day be wrong in a way that costs money, and 3a-3 already reads real spend from the provider.
- **No model-capability probing** (whether a given model supports reasoning effort, tool use, or a given modality). OpenRouter publishes `supported_parameters`; **capturing it is out of scope** and the `EffortDescriptor`'s existing `mode: 'dynamic'` is the declared seam for a later phase. Do not populate it dynamically here.
- **No change to `credential:test` / `probeCredential`.** Not a refactor, not a shared helper extraction, not a re-point. See Goal §3.
- **No new npm dependency.** Node's built-in `fetch`, as in `probeCredential`.
- **No second migration.** One migration, one version. If you find yourself wanting two, the design is wrong — raise it.
- **No new agent kind, no registry widening.** `agentKindSchema` stays `'claude' | 'codex'`.
- **Do not dump, echo, log, or transmit `credential_profiles.encrypted_blob` or `fingerprint_hash`**, and do not press Test key against "OR milestone key".
- **Do not remove the standing `wt-24b5c1fe` worktree row, its directory, or branch `chorus/Chorus/24b5c1fe`.** It is the standing regression fixture.
- **Do not revert, stage, or commit unrelated or untracked files, including anything under `_verify/` or `docs/`.**

## Dependencies

- **⚠ MIGRATION NUMBERING IS NOT SETTLED AT AUTHORING — READ THE SHIPPED `MIGRATIONS` ARRAY BEFORE WRITING A LINE OF DDL.** The facts, as of 2026-07-24:
  - `15a016e` has **six** entries; v6 is the D48 `model` column.
  - **Task 3a-1 takes v7** and its own non-goals forbid it a second: _"No second migration. v7 is the only one this task adds. If you find yourself wanting v8, the design is wrong."_
  - **Task 3a-2 takes none** — explicitly: _"No migration, and no v8."_
  - **Task 3a-3 CONDITIONALLY takes v8** — only _"if 3a-1's v7 does not already carry these columns"_ (the mint-ledger columns). Its own doc leaves the answer open until execution.
  - **Therefore this task's migration is v8 if 3a-3 added none, and v9 if it did.** The DDL text does not change; only the index does. **State the number you took in the commit message, with the evidence (`SELECT version FROM schema_migrations`).** The docs below say **"v8"** throughout for readability; read it as "the next unused index".
  - **This is a conflict flagged rather than guessed.** If, at execution, the array's length does not match any of the three predicted shapes, **stop and raise it** — a mis-numbered migration on the real dev DB is not recoverable by editing a string.
- **Task 3a-1 — HARD.** It supplies the three-dump protocol, the `dump-v7.js` shape, the no-`REFERENCES` precedent, and (via D54) the `composeChildEnv` precedence idiom this task's effort ordering mirrors.
- **Task 3a-3 — ORDERING ONLY.** No functional dependency in either direction. It contributes the `auth_mode === 'management'` value this task must refuse to refresh against; **if 3a-3 has not landed, that refusal is written anyway** (the check costs one line and is correct in advance — `auth_mode` is an unconstrained string, so the value can exist in the database before any code produces it).
- **Task 3-6 (`15a016e`)** — the route, the vault, `probeCredential`, the scrubber seam, and `_verify/3-6/`. All consumed unchanged.
- **Task 3a-5 depends on THIS task** — `launch_profiles.model` sits at rank 1 of a precedence order this task defines, and its effort field consumes this task's level vocabulary.
- **No new npm dependency.**

### ⚠ D4 obligations — what was verified at authoring, and what is still owed

Recorded so the implementer starts from evidence rather than memory, and so the **execution-time re-verification has a diff to make**. **Verification at authoring narrows the obligation; it does not discharge it.** Both CLIs have moved twice in three days.

**Verified by the author on 2026-07-24, against the installed binaries and the live endpoint:**

| Fact | Verified value | How |
|---|---|---|
| `claude` version | **2.1.218** | `claude --version` |
| claude effort flag | **`--effort <level>`**, help text verbatim: `Effort level for the current session (low, medium, high, xhigh, max)` | `claude --help` |
| `codex` version | **codex-cli 0.145.0** | `codex --version` |
| codex effort flag | **none** — `codex --help` exposes only `-c/--config` and `-m/--model`; there is **no `--effort`** | `codex --help` |
| codex effort config key | **`model_reasoning_effort`** is a real config key in the installed 0.145.0 binary (22 occurrences), alongside `plan_mode_reasoning_effort` and `model_reasoning_summary` | binary string inspection of `codex.exe` |
| codex effort vocabulary | the enum's serialized variants appear as the contiguous run **`none minimal low medium high xhigh max ultra`** | binary string inspection |
| **codex effort is PER-MODEL, not global** | the binary carries `supportedReasoningEfforts` / `defaultReasoningEffort` **per model** in its model catalog, and a `ReasoningEffortOption` type — so a level valid for one model may be rejected for another | binary string inspection |
| OpenRouter `/models` auth | **`GET https://openrouter.ai/api/v1/models` returns 200 with the full list and NO `Authorization` header** | live unauthenticated request |
| OpenRouter model fields | `id`, `canonical_slug`, `name`, `created`, `description`, `context_length`, `architecture`, `pricing`, `top_provider`, `supported_parameters`, `default_parameters`, `knowledge_cutoff`, **`expiration_date`**, `links`, `reasoning`; top-level key **`data`** | same request |

**Left EXPLICITLY as execution-time D4 obligations — verify and record each, with what you ran and when:**

1. **Re-run `claude --help` and confirm `--effort` and its five levels still read as above.** The flag is one release away from moving and the descriptor hardcodes it.
2. **Confirm `model_reasoning_effort`'s accepted values against 0.145.0 (or whatever is installed) by ACTUALLY SETTING ONE** — `-c model_reasoning_effort="high"` on a real launch — rather than trusting the author's binary-string reading. **A string in a binary is evidence of a symbol, not proof of an accepted value.** This is the single weakest fact in the authoring set and it is load-bearing for the codex half.
3. **Establish what codex does with a level the selected MODEL does not support** — silent clamp, config-load rejection, or runtime error. This determines whether the collapsed mapping in spec §7 is safe or needs a per-model guard, and it cannot be reasoned out.
4. **Re-verify `GET <base_url>/models` is reachable and unauthenticated for the live route**, and record the response's top-level shape. If it has become auth-gated, that is a finding — **and per Goal §3 it still does not merge the two calls.**
5. **Confirm whether `expiration_date` is populated on any live model** and in what format. If it is universally null, capture it anyway (the column is free) but do not build the pre-emptive warning on it.
6. **Confirm the response size** so the transport's size cap is set from a measurement, not a guess.

## Step-by-step Work

1. **The D4 pass, first and reported.** Run obligations 1–6 above **before writing code**, and record what you ran, when, and what it said. Obligation 2 is the highest-risk: if `model_reasoning_effort` is not accepted as an argv `-c` override on the installed codex, the codex half of the effort mapping has no mechanism and that changes this task's acceptance.
2. **Read the shipped `MIGRATIONS` array and settle the version number.** Write it down. See Dependencies.
3. **Migration + Drizzle mirror**, exactly as spec §2 gives both texts. One entry, applied atomically in the runner's existing transaction. **Grep the string for `REFERENCES`: zero hits.**
4. **Storage accessors** (spec §4), in the same rows-in-rows-out style as the worktree and credential accessors — **including the provider-delete purge, in one transaction.** Every policy decision lives in the core, not here.
5. **`modelCatalogCore.ts` — the pure half first.** Row validation, the diff (`added` / `updated` / `missing` / `returned`), the staleness predicate, the failure vocabulary. **Write its unit table before the transport exists.**
6. **`modelCatalog.ts` — the transport.** One `fetch`, an injectable `fetchImpl`, a timeout, a size cap, **body read ONLY on 2xx and cancelled on every other path**, every outbound string through `scrubSecrets`. Decrypt at the call, drop immediately.
7. **The two IPC handlers + preload forwarders + store actions + the provider-card UI.** All Zod in main (D1); plain objects across the bridge (D14).
8. **`effort.ts` — the pure resolver**, then the two adapter descriptors, then `buildLaunch` consuming them, then the `LaunchOptions`/`PtyLaunchSpec` plumbing, then the dialog control. **In that order** — the mapping is a fact about the CLIs and should be tested before any UI can obscure it.
9. **Tests**, then `npm run typecheck` / `npx vitest run` / `npm run grep:secrets`.
10. **The three-dump migration protocol** (Verification Commands) and the runtime drives (G2) — the refresh drive, the staleness drive, the missing-model drive, and the effort drive with a real command-line read.

## Test Expectations

**Unit (Vitest), `src/main/services/modelCatalogCore.test.ts`** — every function pure, time injected:

- **The diff, all four populations, each its own named test:** a model seen for the first time → `added` with `first_seen_at` set; a model seen again → `updated` with a new `refreshed_at`; a previously-catalogued model **not** seen → `missing_since` set **once** (a second refresh that still does not see it must not rewrite the date — that would make "missing since" a lie that resets on every refresh); a missing model seen again → `missing_since` **cleared**.
- **⚠ THE ANTI-AUTHORITY TEST.** The diff's output contains **no instruction to write `provider_configs` or `launch_profiles`**, for any input — including the input where the route's default model is the one that just went missing. Assert over the whole returned action object's key set, so a future added field cannot smuggle a write in. **This is the unit-level statement of the precedence ruling and it is the most important test in the catalog half.**
- **Row validation rejects hostile input without throwing:** a model id containing a space, a quote, a newline, an ANSI escape, or exceeding the length cap is **dropped from the result with a count**, not stored and not thrown on. A response whose `data` is absent, is not an array, or contains non-objects yields the fixed unrecognized-shape refusal.
- **Provider-controlled display text is sanitized:** control characters stripped, length capped. These strings render in the DOM and are authored by a third party.
- **The staleness predicate** — `< 24 h` → fresh, `≥ 24 h` → stale, no rows → **a third state, not "stale"**. Assert the three states are distinguishable, because collapsing "never refreshed" into "stale" is exactly how an empty catalog gets rendered as a broken one.
- **Failure vocabulary never echoes a body.** Given a 401 whose body contains a realistic fake key, the returned reason is the fixed string and contains **no substring ≥ 8 characters** of that key. Same for 403 / 429 / 5xx / unexpected status / exception. Mirror `probeCredential`'s vocabulary exactly.

**Unit (Vitest), `src/main/services/modelCatalog.test.ts`** — against a stub `fetchImpl`:

- **The body is read ONLY on 2xx**, and on every non-2xx path the stub's reader was **cancelled and never read**. This is the one place this task deliberately departs from `probeCredential`, so it gets its own named test in both directions.
- A thrown `fetch` and a timeout both collapse to the fixed unreachable message.
- **The credential appears in the `Authorization` header and NOWHERE else** — not in a URL, not in a query string, not in a log call. Assert over the recorded request object's full key set.
- **With no credential supplied, no `Authorization` header is sent at all** — and the call still succeeds against a stub 200. The optional-credential path is a shipped behaviour, not a fallback.
- An oversized response is refused at the cap rather than buffered.

**Unit (Vitest), `src/main/adapters/effort.test.ts`:**

- **The full mapping table**, one case per (adapter × level) cell of spec §7, asserting the **exact argv token arrays** — `['--effort','high']`, `['-c','model_reasoning_effort="high"']`. Assert tokens, not a joined string; a whitespace-joined assertion would pass against the broken single-string design this task replaced.
- **A null descriptor yields an empty array** for every level, and never throws.
- **⚠ The raw override beats the slider, and suppresses it entirely.** With `extraArgs` containing that adapter's effort knob, `resolveEffortArgs` returns **zero** effort tokens — assert the array is empty, not that the override merely comes last.
- **An unrelated `extraArgs` token does NOT suppress the slider.** The knob predicate must be specific: assert that `--effortless`, `model_reasoning_effort_summary`, and a token merely *containing* the knob's name as a substring do **not** trigger suppression. A loose predicate silently disables the feature and looks like it works.
- **A collapsed mapping is legal and visible** — two app levels resolving to the same adapter value is asserted as intended behaviour, with the descriptor as the single source of that fact.
- **`effortOptionId` values outside the four-level vocabulary** yield no tokens and no throw. A database or a stale renderer can hand over anything.

**Unit (Vitest), `src/shared/ipc.test.ts`:**

- Both new channels' request/response schemas parse, and **the response parse output's key set contains no field capable of carrying key material** (the 3-2 discipline).
- `effortOptionSchema` accepts `args` and **rejects** the old `cliFlag` shape, so a stale producer fails loudly.
- The launch request's `effort` field is optional and constrained to the four-level vocabulary.

**Unit (Vitest), `src/main/adapters/adapters.test.ts`:** the capability-honesty case extended — a populated `reasoningEffort` descriptor must carry a non-empty `levels` array, and every level's `args` must be non-empty.

**No test may contain a real credential, a real key fragment, or a copy of anything from the dev vault**, and `npm run grep:secrets` must pass afterwards.

**Runtime (G2) carries the migration proof, the live refresh, the staleness/missing-model behaviour, and the effort proof.** No unit test can establish any of them.

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

### ⚠ Cost envelope — verified, and it is zero

| Run | Endpoint | Expected cost |
|---|---|---|
| Every catalog refresh in every verification run | `GET https://openrouter.ai/api/v1/models` | **$0.00** — verified 2026-07-24 as a public, unauthenticated, non-metered list endpoint |
| Effort runtime drive (codex launch, no prompt submitted) | — | **$0.00** — the proof is the child's **command line**, read externally; **do not submit a prompt** |
| **Total expected** | | **$0.00** |

**A launch that submits a prompt over the OpenRouter route DOES spend money.** The effort proof does not require one: the acceptance evidence is the argv of the live child process. **If a run seems to need a real completion, stop and ask** — and note that Task 3a-3's multi-turn gate already owns the paid conversational proof.

**Do not press Test key on "OR milestone key" at any point.** It is a live billable call on Matthew's account and nothing here needs it.

### ⚠ The migration proof — the FULL three-dump protocol, exactly as Tasks 3-2, 3-6 and 3a-1 ran it

A short DDL does not earn a short proof: the risk lives in the runner and the real database, not in the statements.

```
New-Item -ItemType Directory -Force _verify\3a-4 | Out-Null
$env:ELECTRON_RUN_AS_NODE = '1'
& node_modules\electron\dist\electron.exe _verify\3a-4\dump-v8.js "$env:APPDATA\chorus\chorus.db" _verify\3a-4\pre.json
```

Then boot the app once (**cold** — electron-vite does not hot-restart main), tree-kill it, and dump to `post.json`; then boot a second time, tree-kill, and dump to `boot2.json`. Assert, **quoting the evidence**:

1. `schema_migrations` shows **N → N+1**, applied **in place**; the `applied_at` timestamps for **every prior version are byte-identical** pre and post. That is the proof it migrated rather than recreated. Known-good values to check against: v4 `2026-07-20T16:57:49.534Z`, v5 `2026-07-23T13:04:06.301Z`, v6 `2026-07-24T15:52:22.591Z`.
2. Every pre-existing table is **row-identical** across pre / post / boot-2 — `projects`, `sessions`, `worktrees`, `pane_layouts`, `settings`, `provider_configs`, `dispatches`, `attention_spans`, and `credential_profiles` **over its non-secret columns plus `length(encrypted_blob)`**. Zero data loss.
3. `model_catalog` exists with the exact column list and types the spec gives, and is **empty** immediately after the migrating boot.
4. **Boot 2 does not re-apply the migration** — its `applied_at` is byte-identical between `post.json` and `boot2.json`.
5. The standing `wt-24b5c1fe` worktree row is intact.

**⚠ Provenance (F20).** **Quote the `projects` table in every dump.** The coordinator re-verifies on the real dev DB and needs to see the real pair — `985d547b…` (Chorus) and `f47ac10b…` (Chorus-Second). A dump showing `a43b395d…`/`b684e96e…` is the redirected DB and does **not** discharge this criterion.

**⚠ The `sqlite3` CLI is NOT installed.** Use the `ELECTRON_RUN_AS_NODE` script pattern only. **Known flake: the script intermittently writes no file on its first invocation — retry once.**

### The catalog runtime drive (G2) — through the real Settings UI

1. **Empty state.** Before any refresh: the OpenRouter provider card renders the *never refreshed* state — not a spinner, not an empty list styled as stale. Screenshot.
2. **Refresh, unauthenticated.** Press Refresh with **no credential profile selected**. Expect success, a populated list, and a fresh timestamp. Dump `model_catalog` and quote the row count plus three rows. **Confirm `moonshotai/kimi-k3` is present and `moonshotai/kimi-k2.7` is ABSENT** — that pairing is the F-36-4 fact this table exists to surface.
3. **Refresh, authenticated.** Repeat with "OR milestone key" selected. Expect the same result. **Then dump the main log and confirm no key, no fragment, no `Authorization` header value appears anywhere**, and confirm **`last_verified_at` on that profile is UNCHANGED** — the refresh is not a Test key and must not pretend to be.
4. **The idempotence proof.** Refresh twice in a row and confirm the second refresh **adds no duplicate rows** and updates `refreshed_at` in place. A composite-key table that grows on every refresh is a bug that only shows on the second press.
5. **The staleness proof.** Hand-edit `refreshed_at` on the provider's rows to 48 h ago (via a dedicated `_verify/3a-4/` script — never by hand-editing production code paths), cold-boot, and confirm the card renders **stale** with an age, the list is **still shown**, and **nothing about launching changed**.
6. **⚠ THE MISSING-MODEL PROOF — the most important runtime check in the catalog half.** Insert a fabricated catalog row for a model id that OpenRouter does not serve (e.g. `chorus-test/does-not-exist`), **set `provider_configs.model` to that id**, then press Refresh. Confirm, quoting each:
   - the row's `missing_since` is set, and the row is **not deleted**;
   - **`provider_configs.model` is UNCHANGED** — dump the row before and after and show them byte-identical;
   - the provider card renders the warning naming the model and the date;
   - the launch dialog renders the same warning beside the resolved model;
   - **a launch is still permitted** and is not blocked by the app (it will fail at the provider, which is the correct owner of that failure — do not spend a completion proving it; the argv read is sufficient);
   - a second refresh does **not** move `missing_since`.
   - Then **restore `provider_configs.model` to `moonshotai/kimi-k3` and remove the fabricated row**, and prove the restoration with a dump.
7. **The provider-delete purge.** Create a throwaway provider, refresh it against a stub or leave it empty, then delete it. Confirm `provider:delete` **does not throw**, the provider row is gone, and **its catalog rows are gone with it**. Then confirm deleting a provider that still has credential profiles is still **refused** by the pre-existing count-and-refuse.
8. **The failure paths.** Point a throwaway provider's `base_url` at an unreachable host and at a host returning a non-JSON 200. Confirm both produce the **fixed sanitized reason** inline, no crash, no provider body in the DOM, and no change to the existing catalog.

### The effort runtime drive (G2) — the argv read is the proof

1. **Absence.** With an adapter whose `reasoningEffort` is null (use a temporarily-nulled descriptor if both adapters end up populated), confirm the control **does not render** — no greyed slider, no explanatory text. Screenshot.
2. **Presence and mapping.** Launch `codex` from the real dialog at each of the four levels in turn. For each, read the live child's command line with `Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, CommandLine` **walking the descendant tree from the electron main PID — never name-matching** (there are ~16 unrelated `claude.exe` on this machine). Confirm the expected `-c model_reasoning_effort="…"` token appears, and **quote all four command lines**.
3. **Claude's half.** Same for `claude` and `--effort`, quoting at least two levels.
4. **⚠ The suppression proof.** Launch with an `extraArgs` value containing the adapter's effort knob (supply it through the pure resolver's test seam, since there is no input surface in this task) and confirm the resulting argv carries the override **once** and Chorus's own effort token **zero times**. Then confirm an unrelated extra arg does **not** suppress it.
5. **No secret in argv, still.** Over every command line captured above: **no key, no fragment ≥ 8 characters of any key.** The effort work adds argv tokens for the first time since 3-6 and that is exactly when this check earns its keep.
6. **The behaviour-neutrality check.** A launch with **no** effort chosen produces a command line **byte-identical** to the pre-change launch for the same inputs. Capture one before the change and one after, and diff them.

**Harness reminders.** CDP on `--remote-debugging-port=9222` is the proven driver (`_verify/3-6/cdp35.js`); wrap `Runtime.evaluate` bodies in IIFEs (top-level `const` collides across evaluates). Kill process **trees** (`taskkill /PID <root> /T /F`); the graceful-quit test is `taskkill` **without** `/F`. electron-vite HMR covers the **renderer only** — every main-process check needs a real cold boot. `_verify/3-6/read-env.ps1` is the kept external environment reader.

## Acceptance Criteria

- [ ] `npm run typecheck` — zero errors, node and web (G1).
- [ ] `npx vitest run` — green, the then-current baseline **intact and grown**.
- [ ] `npm run grep:secrets` — clean (G4), including over any new `_verify/3a-4/` artifacts.
- [ ] **⚠ THE MODEL-PRECEDENCE ORDER IS WRITTEN DOWN AS A NORMATIVE TABLE** — in `Task-3a-4.md` (Goal §1), in `ImplementationSpec-3a-4.md` §3 with a worked example for every combination including the nulls, and **in a code comment above the `model_catalog` DDL**. The commit message states plainly that `model_catalog` is not authoritative over either other home and never writes to them.
- [ ] **No `UPDATE provider_configs` and no write to any model column exists anywhere in the diff** — grep-verified, and proven at runtime by the missing-model drive's before/after row dump.
- [ ] **The staleness policy is implemented as three distinct states** (never refreshed / fresh / stale), the threshold lives **only** in main, and **nothing auto-refreshes** — no boot hook, no timer, no on-open hook. Grep-verified.
- [ ] **A model that disappears is marked and kept, never deleted**, `missing_since` does not move on subsequent refreshes, and the warning renders on **both** the provider card and the launch dialog. **The saved-route-names-a-missing-model case ran at runtime with the route's model column proven unchanged.**
- [ ] **Refresh does NOT replace the test-key probe** — `credential:test` and `probeCredential` are byte-identical in the diff, a successful refresh leaves `last_verified_at` unchanged, and the evidence for the ruling (an unauthenticated 200 from the live `/models` endpoint) is re-verified this session and quoted.
- [ ] **The refresh's widening of D33 resolution (d) is narrated in the commit message** as a second key-bearing call, with its five constraints (user-initiated only · decrypt-at-use · refuse `unavailable_since` · refuse `auth_mode = 'management'` · credential optional) each proven or asserted.
- [ ] **No key material reached any log, any IPC response, the DOM, or the DB** — the refresh's outputs swept the way 3-4 and 3-6 swept theirs, with results quoted.
- [ ] **Migration applied IN PLACE on the real dev DB with zero data loss** — the three-dump protocol, with all prior `applied_at` byte-identical, every pre-existing table row-identical across pre/post/boot-2, `model_catalog` created empty, and the version not re-applied on boot 2. **The version number taken is stated with evidence**, and **the coordinator re-verifies on the real DB** (F20) — a dump that does not quote `985d547b…` does not discharge this.
- [ ] **`model_catalog` carries no `REFERENCES` clause** (grep the migration string), and the provider-delete purge ran at runtime: the delete did not throw and the catalog rows went with the provider.
- [ ] **The four-level slider works end to end for both adapters**, proven by **quoted live command lines** for all four codex levels and at least two claude levels, and the control is **absent** for a null descriptor.
- [ ] **The raw-override precedence is implemented and proven** — the override suppresses Chorus's own effort token entirely, and an unrelated extra arg does not.
- [ ] **A launch with no effort chosen is byte-identical to the pre-change launch** — the behaviour-neutrality diff is quoted.
- [ ] **Every effort flag in the shipped descriptors was verified against the INSTALLED CLI this session (D4)** — including the codex `model_reasoning_effort` acceptance test, which is an actual launch and not a binary-string reading. **A remembered flag is a D4 violation regardless of whether it happens to be right.**
- [ ] **No `launch_profiles`, no `extra_args` input surface, no api-mode implementation** — `getModels` still has zero implementations, `ApiAgentAdapter` still has zero instances, and no effort or model choice is persisted anywhere.
- [ ] **The `tier` omission and the `cliFlag` → `args` replacement are both narrated in the commit message**, the latter with its zero-producers evidence.
- [ ] **Cost was $0.00** and Test key was never pressed against "OR milestone key". Quoted.
- [ ] **ONE** narrated commit (G3), touching only the Exact Scope rows.
- [ ] **The two untracked `TASK-*-REVIEW-FABLE.md` files are still present, unmodified, and unstaged**, and no `_verify/` or `docs/` file was staged or reverted.
- [ ] The standing `wt-24b5c1fe` worktree row, directory, and branch are **untouched**.

## Review Checklist

- [ ] **Look for the second authority.** Grep the whole diff for `UPDATE provider_configs`, for any assignment to a `model` field outside the catalog's own rows, and for any code path where a refresh result influences what a launch sends. One hit is the failure this task exists to prevent, and it will look like a helpful convenience at the call site ("clear the model if it's gone", "default to the first catalog entry").
- [ ] **Confirm the model input is still free-text.** If `fModel` became a closed `<select>` bound to catalog rows, the catalog became authoritative by UI construction, without a decision being made. The picker must be additive.
- [ ] **Check the three catalog states are actually three.** An implementation that renders "never refreshed" through the stale branch will look right on a populated database and wrong on a fresh install — which is every new user.
- [ ] **Read the body-handling in `modelCatalog.ts` line by line.** This is the ONE place the repo deliberately departs from `probeCredential`'s cancel-always rule, and the departure is what a 401 body needs to leak. Confirm: read on 2xx only, cancelled on every other path, size-capped, and the parsed value never interpolated into an error message.
- [ ] **Check the missing-model predicate cannot rewrite `missing_since`.** If it is set unconditionally on every refresh that does not see the model, the column reads "missing since today" forever and the user can never tell whether a model vanished this morning or last month. Confirm a unit test would catch it.
- [ ] **Check the effort-knob suppression predicate for looseness.** A substring match, a case-insensitive match, or a match on the knob's name without its `-c`/flag context will silently disable the slider the first time a user passes an unrelated arg. The named unit test must fail against each of those.
- [ ] **Confirm the effort mapping lives in ONE place.** If `buildLaunch` carries a `switch` on the level *and* the descriptor carries the levels, the mapping has two homes — in the task whose headline output is a one-home ruling. The descriptor is the home; `buildLaunch` reads it.
- [ ] **Confirm `buildLaunch` is still synchronous** and that nothing in the effort path introduced an await. `SessionManager.launch()` is sync and returns a snapshot synchronously; that constraint is recorded on the type and is easy to break in a diff that reads fine.
- [ ] **Confirm the refresh is genuinely user-initiated.** Grep for the service being called from `index.ts`, from a `whenReady`, from an `onMounted`, or from any watcher. A refresh on Settings-open would be convenient, would send the user's key without them asking, and would quietly convert an admitted carve-out into a background behaviour.
- [ ] **Confirm the credential is decrypted per use and never cached** — no module-level variable, no memo, no "hold it while the settings view is open".
- [ ] **Check the `auth_mode = 'management'` refusal exists** even if Task 3a-3 has not landed. It costs one line, it is correct in advance, and adding it later means a window where a higher-privilege key can be sent to a model-list endpoint.
- [ ] **Read the dump script before it is run.** It must not `SELECT *` from `credential_profiles`. The vault holds a real billable key and a careless `*` puts an encrypted blob into a JSON artifact that then gets quoted into a summary.
- [ ] **Check the migration string for `REFERENCES`** — zero hits — and then confirm the provider-delete purge actually ran against a **deleted** provider, not merely a reasoned-about one.
- [ ] **Check the summary for an unproven migration claim.** A dump quoting `a43b395d…` is the F20-redirected database and proves nothing about the real one; send it back rather than reasoning around it.
- [ ] **Check the summary for a remembered CLI flag.** "codex uses `model_reasoning_effort`" sourced from this doc's authoring table is not execution-time verification. Obligation 2 requires a real launch that a real binary accepted.
- [ ] **Confirm the free-text argv risk was not shipped.** No `extra_args` text input, anywhere. If one appears, it is an argv surface added in the same commit as a second key-bearing network call, and it needs its own decision.
- [ ] No untracked / `_verify/` / `docs/` files staged or reverted; both `TASK-3-*-REVIEW-FABLE.md` untouched.
