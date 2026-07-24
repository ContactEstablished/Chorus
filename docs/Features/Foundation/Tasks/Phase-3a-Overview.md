# Phase 3a — Profiles & Catalog

_Kicked off **2026-07-24**, immediately after Phase 3 closed (`e3d72c5` + `15a016e`). Sequenced ahead of Phases 3b and 3c by **D50** on asymmetric decay. Five tasks, executed **strictly serially**, each in its own session and each coordinator-reviewed before the next is prompted. This document governs the phase; each `Task-3a-#.md` governs its own scope; each paired `ImplementationSpec-3a-#.md` governs exact contents._

## Source Of Truth

- Roadmap: `docs/Features/Foundation/roadmap.md` — §5 (Verified Ground Facts, incl. **F27**, **F28**, and the verification-provenance row), §6 decisions **D33, D34, D41, D42, D43, D44, D45, D48, D49, D50** plus this phase's kickoff decisions **D51–D54**, and §7 Phase 3a.
- Feature spec: `docs/Features/Mission Control/chorus-mission-control-spec.md` — **§5.1** (tokens/cost), **§5.2** (wall-clock), **§5.3** (attention), **§9 Phase 0** (why telemetry cannot wait). **Authoritative on design; the roadmap wins on current status** (§2 authority split). Its §5.1 LiteLLM recommendation is **superseded by D42** — OpenRouter is the single gateway.
- `docs/PLAN.md` §4 (adapter abstraction, effort normalization), §6 (credentials/providers/BYOK), §13 (target data model).
- Project rules: `CLAUDE.md` — locked stack; **D1** Zod-in-main; **D14** plain-object IPC; secrets via safeStorage, injected as env vars into child PTYs, never in args/logs/transcripts; **D4** verify CLI flags against the tool's own `--help` at execution time.
- **Verified codebase state: 2026-07-24, `src/` at commit `15a016e`** (Task 3-6 landed; roadmap at `e233e33`). Every task doc anchors insertion points to **named symbols, never line numbers** (house rule).

## Goal

Phase 3 made a key injectable; Phase 3a makes a launch **reproducible and measurable**. It delivers the (agent × route × model) triple as saved `launch_profiles` with friendly names, a `model_catalog` and an app-level effort axis to populate them, and — first, because it is the only thing on the roadmap that decays — the **telemetry capture** that lets every later estimate be calibrated against what actually happened rather than against a guess.

## Why telemetry leads (D50)

The Mission Control spec puts telemetry capture in its **Phase 0** for one reason: **historical actuals cannot be backfilled.** Its projection phases are worthless without three to four weeks of data, so every week without capture is a week the estimator can never calibrate. Of the three candidate phases (3a, 3b, 3c), **only 3a has a clock running against it** — 3b and 3c cost calendar time and lose nothing. That is the whole sequencing argument, and it is why Tasks 3a-1 through 3a-3 come before the profile and catalog work a reader might expect to lead a phase named "Profiles & Catalog".

## Kickoff decisions (Matthew, 2026-07-24)

| ID | Decision |
|---|---|
| **D51** | **Telemetry lands in full: wall-clock + attention + tokens/cost.** The lighter options (wall-clock only; defer tokens) were rejected because token history is precisely what cannot be backfilled — deferring it defeats the reason the phase is sequenced first. Acceptance is the spec's own: dispatches appear with **non-zero token counts attributed to the right agent and model**. |
| **D52** | **The two new PTY adapters get their own later phase, not this one.** Kimi CLI (third native subscription adapter) and an OpenAI-compatible agent CLI move to a new provisional **Phase 3d**. The old argument that profiles are meaningless without an OpenAI-compatible CLI **no longer holds**: Task 3-6 proved codex-the-binary over OpenRouter end-to-end, so profiles already have a real vehicle. **D34 Q5's frozen-registry ruling travels with the adapters** and is lifted in Phase 3d, consciously and as a numbered decision. |
| **D53** | **Restore stays decision (b); a one-click relaunch is added.** Credentialed sessions still heal to `exited` — **no unattended boot-time decryption**, which D33 never sanctioned. What Task 3a-5 adds is a relaunch action resolving the credential from the session's `launch_profile` **with the user present at the keyboard**. Option (a) stays declined. |
| **D54** | **`TERM` is pinned at spawn, amending D33's seven-variable allow-list to eight.** Rationale is **F28**: an inherited `TERM=dumb` put codex 0.145.0 into a fallback renderer interleaving cursor-advance escapes between characters, leaving a secret legible on screen and invisible to the exact-match scrubber. `TERM=xterm-256color` (with `COLORTERM`) is pinned in `composeChildEnv` as a **flagged chore commit at the head of Task 3a-1** — narrated as an allow-list amendment, never slipped in. |

## The Five Tasks

| Task | One-line scope | Migration | Depends on |
|---|---|---|---|
| **3a-1** | **TERM pin (flagged chore, D54) + the dispatch telemetry spine.** Two commits. `dispatches` (wall-clock, agent, model, `auth_mode`, outcome, with token/cost columns declared and written NULL) and `attention_spans`, created empty for 3a-2. `DispatchRecorder` + `classifyOutcome`. **No UI, no IPC, no renderer file.** | **v7** | Phase 3 |
| **3a-2** | **Attention capture — focus + idle.** One clock in main, sampled runs, `powerMonitor.getSystemIdleTime()` with the 60 s threshold, per-project overhead bucket, one-tap correction. Writes `attention_spans`; **authors no migration.** | — | 3a-1 |
| **3a-3** | **Per-dispatch token & cost attribution — and the multi-turn proof, which is a GATE.** Per-dispatch OpenRouter keys minted with a hard limit, revoked and read back; attribution keyed on `AuthMethodDefinition.type` (**D42**); `tokens_cached` captured separately; "% of spend attributed" surfaced. Subscription sessions are **never** gateway-routed. | **v8** | 3a-1 |
| **3a-4** | **`model_catalog` + refresh, and effort normalization.** The catalog with an explicit staleness policy; the app-level Fast/Balanced/Deep/Max axis mapped per adapter with a raw `extra_args` override. **Produces the normative model-precedence table.** | **v9** | 3a-1 |
| **3a-5** | **`launch_profiles`, the dialog default, and one-click relaunch — closes the phase.** The (agent × route × model) triple with immutable id + renameable label (**D43**); dialog defaults to last-used; retires 3-6's global `credentialed_sessions` list; the D53 relaunch action. | **v10** | 3a-4 |

Dependency chain: **3a-1 → 3a-2 → 3a-3 → 3a-4 → 3a-5** (strictly serial).

### ⚠ Migration numbering is FIXED, not conditional

The five task docs were authored in parallel and each hedged its own migration number against the others ("v8 or v9", "v9 or v10"). **Serial execution makes the numbers deterministic, and they are fixed above.** Task 3a-3 **does** take a migration: its mint ledger is durable crash-reconciliation state, so it is a table — putting it in a `settings` JSON blob would recreate the second-competing-home mistake **D48** exists to prevent.

**Standing check for every implementer:** confirm `MIGRATIONS.length + 1` equals your expected number **before** appending. If it does not, **stop and report the divergence** rather than renumbering silently — a mismatch means a prior task shipped something its doc did not describe.

### Every migration carries the full three-dump protocol

Tasks 3a-1, 3a-3, 3a-4 and 3a-5 each add one. **A short DDL does not earn a short proof** — the risk lives in the runner and in the real database, not in the statements. Pre / post / second boot, proving prior `applied_at` values **byte-identical**, every pre-existing table **row-identical**, and the new version **not re-applied** on boot 2.

**⚠ F20 stands as a standing rule.** Task 3-6 happened to run on the real dev DB, but that was luck of configuration established post hoc, not a guaranteed condition. **The coordinator re-verifies every DB claim against `%APPDATA%\chorus\chorus.db`** (projects `985d547b…` / `f47ac10b…`), so every implementer dump **must quote the `projects` table** or it does not discharge the obligation. Harness precedent: `_verify/3-6/dump-v6.js`, run under `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe`.

## The one home rule (inherited from D48)

Phase 3 learned this the expensive way and Phase 3a is where it would be easiest to forget:

- **Tokens and cost live on the `dispatches` row**, beside wall-clock — not in a parallel `usage_records` table. Task 3a-1's naming section supersedes the roadmap's separate-table reading, with the argument stated.
- **"Which model" has exactly one precedence order**, written down in Task 3a-4 as a normative table: `launch_profiles.model` > `provider_configs.model` (v6/D48, the route's *default*, not an authority) > nothing emitted. **`model_catalog` is a list of what exists and is never authoritative over either** — it must never write to them.
- **Attention has one home** (`attention_spans`, created in v7), one writer (3a-2), and one cadence recorded per row.

## Standing conditions for every session in this phase

- **⚠ The dev vault holds a REAL, billable OpenRouter key** (profile "OR milestone key", route OpenRouter → `moonshotai/kimi-k3`). It is no longer fake-key-only. **Never dump, echo, copy, or transmit `credential_profiles.encrypted_blob` or `fingerprint_hash`** — dump scripts must select non-secret columns explicitly and prove blob stability with `length(encrypted_blob)`. Verification runs in Tasks 3a-3 and 3a-4 **spend real money**; every minted key carries a hard limit.
- **⚠ F27 bounds what any doc in this phase may claim about redaction.** Claude Code discloses a masked ≥8-char fragment of an injected key in its own auth prompt, which exact-value scrubbing cannot match by construction. The honest wording is *"Chorus redacts registered exact values on ingest; it cannot redact values an agent derives"* — never "agents cannot echo the key".
- **⚠ Only single-turn is proven on the OpenRouter Responses route** (F-36-1; the endpoint is beta and stateless-only). Task 3a-3's multi-turn proof is a **gate that is allowed to fail**, with a pre-declared re-scope branch. No task may assume conversational continuity before that gate passes.
- **Untracked files:** `TASK-3-5-REVIEW-FABLE.md` and `TASK-3-6-REVIEW-FABLE.md` sit at the repo root. **Do not commit, delete, or revert them.**
- **Baselines at phase start:** typecheck 0 (node + web) · **273/273 across 14 files** · `npm run grep:secrets` clean (6 patterns) · migrations v1–v6.

## Gates

| ID | Gate | Applies |
|---|---|---|
| **G1** | Typecheck: zero errors. | Every task |
| **G2** | **Run, don't just compile** — drive the real window; screenshots when headless. CDP harness precedent in `_verify/3-6/` (port 9222). | Every task; **load-bearing in 3a-2**, whose behaviour cannot be verified by compiling |
| **G3** | One intentional narrated commit per execution session. **Amended for 3a-1 only: two commits** (the D54 chore, then the task). | Every task |
| **G4** | **`npm run grep:secrets` before shipping.** | Every task; **load-bearing in 3a-3**, the first task that mints credentials of its own |
| **G5** | Council Review per D6 on **[CR]** phases. | **Not triggered by this phase** — see below |

**On G5:** Phase 3a carries no `[CR]` marker. Task 3a-3 is the closest thing to a trigger — it mints and revokes live credentials with real spend — and the coordinator's judgement is that it is **governed by the already-closed D33 contract** rather than opening a new question, provided the minted key travels the same vault/scrubber path as a user key and never persists. **If an implementer finds that constraint cannot be met, that is a §4 CR trigger and the task stops rather than improvising.**

## File-ownership matrix

Overlapping files across tasks are **legal only because execution is serial** — each later task starts only after the prior task's commit exists.

| File | 3a-1 | 3a-2 | 3a-3 | 3a-4 | 3a-5 |
|---|:--:|:--:|:--:|:--:|:--:|
| `src/main/services/storage.ts` (MIGRATIONS + accessors) | ✅ v7 | | ✅ v8 | ✅ v9 | ✅ v10 |
| `src/main/db/schema.ts` | ✅ | | ✅ | ✅ | ✅ |
| `src/main/adapters/env.ts` (+ `env.test.ts`) | ✅ chore | | | | |
| `src/main/services/dispatches.ts` | ✅ new | | ✅ | | |
| attention module (3a-2's, Electron-free core + wiring) | | ✅ new | | | |
| `src/main/index.ts` (boot wiring) | ✅ | ✅ | ✅ | | |
| `src/main/ipc.ts` / `src/shared/ipc.ts` | | ✅ | ✅ | ✅ | ✅ |
| `src/renderer/…` (Settings, LaunchDialog, stores) | | ✅ | | ✅ | ✅ |

## Milestone

**A saved launch profile reproduces an agent's full configuration in one click, and per-credential spend is recorded where a producer exists** — with the honesty requirements that make the numbers usable rather than merely present: **"% of spend attributed"** surfaced as a first-class metric, `tokens_cached` counted separately, attention reported as a lower bound with its sample count, and every unproven limit (multi-turn, subscription-session fidelity) stated rather than smoothed over.
