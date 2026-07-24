# Task 3a-1: TERM Pin + The Dispatch Telemetry Spine — Execution Prompt

## Role

You are the Coordinator for Chorus — Foundation **Phase 3a, Task 3a-1** (TERM Pin + The Dispatch Telemetry Spine).

Repo root: `C:\Projects\ContactEstablished\Chorus`

Expected branch: `main` — confirm with `git branch --show-current`; do NOT switch or create branches without instruction.

**Expected HEAD at start: `f812f93`** (the Phase 3a kickoff docs commit). Code HEAD for `src/` is `15a016e` (Task 3-6) — no production code has changed since.

Platform: Windows 11, PowerShell 7

Chorus is a local-first BYOK Electron + Vue 3 + TypeScript desktop app for running multiple AI coding agents in parallel terminal panes.

## Goal

Task 3a-1 is the **FIRST task of Phase 3a** and starts the clock for a feature that decays every day it does not exist.

Make Chorus record, for every agent run, the facts that cannot be reconstructed later — when it started, when it ended, how it ended, which agent and model, under which auth mode — into a durable local table whose token and cost columns Task 3a-3 fills in on the **same row**. And, before that, pay off F28: stop letting the host shell's `TERM` decide how an agent renders and whether the scrubber can see what it renders.

**Why this is the phase's first task and not its last.** Mission Control's spec **Phase 0** is the only work item in the whole roadmap with a clock running against it. Its own rationale, verbatim from `docs/Features/Mission Control/chorus-mission-control-spec.md` §9: _"historical actuals cannot be backfilled. Every week without capture is a week the estimator cannot calibrate, and phases 2 onward are worthless without three to four weeks of data."_ D50 sequenced the whole phase on that asymmetry. Every day this task does not exist is a day of data that can never be recovered — so capture lands before the catalog, before profiles, before any UI.

### Two Commits in This Session

This session makes TWO commits (gate G3 amended for this session only by decision D46):

1. **COMMIT 1** = a flagged, BEHAVIOUR-SCOPED chore: pin `TERM` and `COLORTERM` in `composeChildEnv`, closing F28, narrated as an amendment to D33's seven-variable allow-list.
2. **COMMIT 2** = the telemetry spine: migration v7, the dispatch and attention tables, the recorder, and the dispatch runtime drive.

Commit 1 lands first and is proven at runtime before Commit 2 begins.

## Ground Yourself First

Read these before editing anything. All paths are relative to repo root:

- `CLAUDE.md` (locked architecture rules)
- `docs/Features/Foundation/roadmap.md` — sections 5 (Verified Ground Facts, incl. **F28**), 6 (Decisions D33, D34, D42, D48, D50, D51, D52, D53, D54, and Gates G1–G5), 7 (Phases and Phase 3a)
- `docs/Features/Foundation/Tasks/Phase-3a-Overview.md` (phase contract, file-ownership matrix, cross-cutting rules, standing conditions, phase non-goals)
- `docs/Features/Foundation/Tasks/Task-3a-1.md` (GOVERNS SCOPE and step-by-step work)
- `docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-3a-1.md` (GOVERNS EXACT CONTENTS — DDL, Drizzle schemas, insertion points, exact test expectations, exact dump script)
- `docs/Features/Mission Control/chorus-mission-control-spec.md` — **§5.1, §5.2, §5.3** (what a dispatch row must hold) and **§9 Phase 0** (the decay argument). **Read both before writing anything.**

### Code to Inspect

Anchor to **NAMED SYMBOLS**, never line numbers. Current as of `15a016e`:

- `src/main/adapters/env.ts` — `BASELINE_ENV_VARS` (seven entry list: `PATH`, `SystemRoot`, `TEMP`, `TMP`, `HOMEDRIVE`, `HOMEPATH`, `USERPROFILE`), `composeChildEnv` (pure, two branches: no-credential → return parent wholesale, credential → constructed allow-list), `resolveEnvVarName`.
- `src/main/adapters/env.test.ts` — unit tests for the identity case, key-set equality, and precedence.
- `src/main/services/storage.ts` — `const MIGRATIONS: string[]` (currently six entries, v6 is `ALTER TABLE provider_configs ADD COLUMN model TEXT;`), `StorageService` class, the migrate() private method over the `schema_migrations` table.
- `src/main/db/schema.ts` — `projects`, `paneLayouts`, `settings`, `schemaMigrations`, `sessions`, `worktrees`, `providerConfigs`, `credentialProfiles` tables and their types.
- `src/main/services/sessionManager.ts` — `SessionManager.spawn`, `launch`, `restore`, `attach`, `kill`, `dispose`, `onData`/`onExit`/`onRestored` listener Sets.
- `src/main/index.ts` — `app.whenReady().then(async () => {…})`, `worktrees.reconcileAll()`, `sessions.restore(project.id)`, the `before-quit` handler.

### Git Checks to Run First

```
git branch --show-current
git status --porcelain
git log --oneline -3
```

### Decisions You Must Honour — all RESOLVED, quoted with dates

Do not relitigate these. The decisions stand.

- **D4** (locked in `CLAUDE.md`) — verify CLI flags and env-var names against the tool's own `--help`/docs **at execution time**, never from training-data memory.
- **D33** (2026-07-22) — the vault security contract. **Clause 5:** the child's environment block is the injection surface. **Resolution (c):** a no-credential launch inherits `process.env` wholesale, exactly as today.
- **D42** (2026-07-24) — attribution is keyed on `AuthMethodDefinition.type` (`'subscription' | 'api_key'`), not on the gateway. That discriminator is a **column on the dispatch row** in this task.
- **D48** (2026-07-24) — the one-home rule: tokens and cost live on **the same row** that carries the wall-clock, not in a parallel `usage_records` table.
- **D50** (2026-07-24) — Phase 3a runs before 3b and 3c on asymmetric decay: historical actuals cannot be backfilled.
- **D51** (2026-07-24) — Phase 3a's telemetry lands in full (wall-clock + attention + tokens/cost). Acceptance is the Mission Control spec's own: dispatches appear with non-zero token counts attributed to the right agent and model. This task ships the wall-clock half and the empty columns; Task 3a-3 fills them.
- **D52** (2026-07-24) — The two new PTY adapters get their own later phase, not this one (moved to Phase 3d).
- **D53** (2026-07-24) — Restore stays decision (b); a one-click relaunch is added. Credentialed sessions heal to `exited` — no unattended boot-time decryption.
- **D54** (2026-07-24) — `TERM` is pinned at spawn, amending D33's seven-variable allow-list to eight. The chore commit lands at the head of this task, narrated as an allow-list amendment, not slipped in.
- **F16** — FKs are **ENFORCED** on this database (`PRAGMA foreign_keys=ON` by driver default).
- **F20 (STANDING)** — verification provenance: the coordinator re-verifies every DB claim against the real `%APPDATA%\chorus\chorus.db`. **Every dump must quote the `projects` table**; the real pair is `985d547b…` (Chorus) and `f47ac10b…` (Chorus-Second). A dump showing `a43b395d…`/`b684e96e…` is the redirected DB and discharges nothing.
- **F28** — the `TERM=dumb` finding that Commit 1 closes. An inherited `TERM=dumb` put codex 0.145.0 into a fallback renderer emitting cursor-advance escapes **between individual characters** (`-  a  p  i  0  3  -  K  7 …`). The secret was fully legible on screen and simultaneously invisible to substring matching, so exact-value scrubbing was defeated without any bug in the scrubber. This is a rendering-policy problem, not a scrubber problem.
- **Migration numbers are FIXED for the phase: 3a-1 → v7 · 3a-3 → v8 · 3a-4 → v9 · 3a-5 → v10.** Confirm `MIGRATIONS.length + 1` equals **7** before appending; if it does not, **stop and report the divergence** rather than renumbering.
- **Coordinator amendment 2026-07-24:** `attention_spans` gained `class TEXT NOT NULL` and `tick_seconds INTEGER NOT NULL` before v7 shipped, on a dependency finding Task 3a-2 raised. `ImplementationSpec-3a-1.md` §2.1/§2.2 is authoritative over any earlier column list.

## Pre-Existing Changes — Do Not Touch

The working tree contains exactly two untracked files at repo root: `TASK-3-5-REVIEW-FABLE.md` and `TASK-3-6-REVIEW-FABLE.md` (review artifacts).

**Do NOT** revert, stage, delete, or commit them.

Also **never** stage or revert anything under `_verify/` (untracked harness artifacts, gitignored) or anything under `docs/` unless a step explicitly says so.

## ⚠ STANDING CONDITION — the dev vault holds a REAL, BILLABLE credential

Coordinator-established 2026-07-24 and recorded in roadmap §5. **Matthew's real OpenRouter key lives in the real dev vault** under the credential profile **"OR milestone key"** (provider "OpenRouter", route `https://openrouter.ai/api/v1`, model `moonshotai/kimi-k3`). His key, his vault, his machine, deliberately left in place after Task 3-6. **The vault is no longer fake-key-only, and you must not assume its contents are fixtures.**

Four consequences, all binding on this task:

1. **Never dump, echo, print, copy, or transmit `credential_profiles.encrypted_blob` or `fingerprint_hash`** — not into a JSON artifact, not into a log, not into your final summary.
2. **⚠ THE CONCRETE TRAP: `_verify/3-6/dump-v6.js` — the script you are told to copy — does `SELECT *` from `credential_profiles`.** Read it before you adapt it. **`dump-v7.js` must NOT.** Select the non-secret columns explicitly, and prove the blob was untouched by the migration with **`length(encrypted_blob)`** — a byte count is not key material, and it is sufficient evidence. Copying the 3-6 script unchanged puts an encrypted real-key blob into a checked-in-adjacent JSON artifact that then gets quoted into a report.
3. **Do not press Test key against "OR milestone key".** It is a live, billable call on someone else's account and nothing in this task needs it.
4. **Anything you need to launch against, you create yourself** with a planted fake key, and you remove it afterwards. The fake-key fixtures from Task 3-6 were purged; do not go looking for them.

## Implementation Scope

### Commit 1 (Chore, Decision D54) — The TERM Pin, Closing F28

**Behaviour-scoped, not behaviour-neutral.** It deliberately changes what every child process sees in exactly two variables (`TERM` and `COLORTERM`), and it must be narrated as an **amendment to D33's seven-variable allow-list**.

**Files:**
- EDIT `src/main/adapters/env.ts`
- EDIT `src/main/adapters/env.test.ts`

**What:**

Add `PINNED_ENV_VARS` (a separate constant, NOT an addition to `BASELINE_ENV_VARS`) holding `TERM=xterm-256color` and `COLORTERM=truecolor`. Apply it in **both** branches of `composeChildEnv`:

- No-credential branch: return `{ ...parentEnv, ...PINNED_ENV_VARS }`
- Credential branch: apply pins AFTER inherited baseline/required vars but BEFORE `envAdditions` and `secretEnv` — so adapters can override, but the pins beat the host.

**Why the distinction from `BASELINE_ENV_VARS`.** BASELINE_ENV_VARS is a list of **names to copy from the parent** — every entry is a channel through which host state reaches the child. PINNED_ENV_VARS is a map of **values to impose**, carrying zero bytes of host state. Adding `TERM` to the array instead would compile, read as the fix, and inherit `TERM=dumb` — reproduce F28 exactly while looking right.

**Why both branches.** Pinning only on credential-bearing launches would leave the common path inheriting `TERM=dumb` and make the two policies render differently — the F28 shape. D33 resolution (c) protects the no-credential path so ambient provider keys are not stripped; it says nothing about rendering constants.

**Why `COLORTERM` travels with it.** Three reasons: (1) a pinned constant adds zero inherited variables; (2) without it a credential-bearing launch strips COLORTERM while TERM advertises 256-colour, so the two branches still disagree; (3) it removes the last host-shell variable from the render decision. F28 does not evidence COLORTERM on its own; it is admitted on consistency grounds.

**Test amendments:**

- The existing `NO credential → identity` case **will fail**. Amend it (do not delete it) to assert the new honest property: the result is the parent environment **plus exactly the pinned keys**, with every other key and value unchanged. Assert key-set equality so an accidental extra fails.
- Add two named tests that the pin beats an inherited `TERM=dumb` — one for the no-credential branch, one for the credential branch. Both must read `xterm-256color`. This is the D54 regression guard.
- Confirm `COLORTERM` is present and equals `truecolor` in both branches, even when the parent never defined it.
- Confirm `envAdditions` beats the pin (an adapter declaring `TERM` wins).
- Confirm `secretEnv` still beats everything.
- Update the credential-branch key-set equality test to include the two pinned names, and **verify by hand that it still fails against a `{...parentEnv, ...secretEnv}` implementation** — that test is the allow-list's only structural defence.

**Proof obligation for Commit 1:**

Two parts, both required:

1. **Launch the dev app from a shell that exports `TERM=dumb`**, launch codex through the real window, and observe a **correctly rendered TUI** (box drawing, unicode, colour). Then read the child's environment **from outside the app** and confirm it holds `TERM=xterm-256color`, not `dumb`. This is the direct F28 re-drive: same hostile input, opposite outcome.

2. **Re-drive at least one Task 3-5 scrubber item against the pinned seam**, using the existing `_verify/3-5/probe.js` harness (it reports booleans and counts only, never the value). Item 2 (ring buffer holds the placeholder, the value is absent) is the cheapest and most load-bearing. **Use a planted fake value, never the vault's real key.** A rendering change that alters how output reaches the scrubber is not proven safe by a compile.

---

### Commit 2 (The Task) — Files and Changes

- **EDIT** `src/main/db/schema.ts`: add `dispatches` and `attentionSpans` Drizzle table definitions, exactly matching v7's DDL column for column, plus their `$inferSelect`/`$inferInsert` types. Add `real` to the Drizzle import.
- **EDIT** `src/main/services/storage.ts`: append **migration v7** (both `CREATE TABLE`s + the one index, one string, applied atomically); add the dispatch accessors (`createDispatch`, `getOpenDispatchForSession`, `listOpenDispatches`, `closeDispatch`). No attention accessor, no usage accessor.
- **CREATE** `src/main/services/dispatches.ts`: the pure `classifyOutcome` + the `DispatchRecorder` (opens on start, closes on exit, heals orphans at boot). Electron-free and node-pty-free.
- **CREATE** `src/main/services/dispatches.test.ts`: unit tests for the classifier table and the never-propagate property.
- **EDIT** `src/main/services/sessionManager.ts`: three additive changes only: an `onStart` listener Set announced at the end of `spawn`; a `killRequested` flag on the internal `PtySession`; a public `wasKilledByChorus(sessionId)`. **No change to any existing code path's behaviour.**
- **EDIT** `src/main/index.ts`: construct the recorder after storage init, heal orphaned dispatches **before** `restore()`, attach it to the manager, and close open dispatches in `before-quit`.
- **CREATE** `_verify/3a-1/dump-v7.js` (untracked harness, not committed): the three-dump script, adapted from `_verify/3-6/dump-v6.js` **with the mandatory change** — no `SELECT *` from `credential_profiles` (the real dev vault holds Matthew's billable key); select non-secret columns explicitly and prove blob stability with `length(encrypted_blob)`.

**Nothing else.** If a change seems to require another file — especially `src/main/ipc.ts`, `src/shared/ipc.ts`, or anything under `src/renderer/` — **stop and raise it**; that is a scope signal, not a detail.

### Four Properties That Define the Work

Each is a way this can be built wrong while looking right.

1. **One home, not two.** D48's lesson, applied prospectively. The token and cost columns live on the **same row** that carries the wall-clock — not in a parallel `usage_records` table. See the naming note in §2: the roadmap's `usage_records` language is **superseded**, deliberately and explicitly.
2. **A dispatch is not a session.** Sessions are deleted on pane close (D16 resolution d), and a restored session is a **genuinely fresh conversation** (Phase 8 open question 1). So: one session id may own **many** dispatch rows over its life, and a dispatch row **must survive its session id disappearing**. ⚠ Therefore `dispatches` carries **NO `REFERENCES` clause of any kind.** FKs are ENFORCED (F16), and a `REFERENCES sessions(id)` would default to RESTRICT — which means the very first pane close after this ships would make `session:delete` **throw**, breaking a flow that has worked since Task 1-5. A telemetry table that can break a user flow is worse than no telemetry table.
3. **Free of the renderer.** Spec §8: main owns all ingestion. Capture hangs off the lifecycle main already owns — `spawn` success, the `onExit` announcement, the boot heal — and off nothing the renderer says. There is no IPC channel in this task.
4. **Telemetry may never fail a launch.** Every write is inside a `try` whose `catch` logs and returns. A dispatch row that fails to insert is a lost data point; a dispatch row whose insert propagates is a **dead agent session**. The first is acceptable and the second is not.

### Ordered Work Steps for Commit 2

1. **Unit tests first — Commit 1.** Amend `env.test.ts` as specified above. The failing test is the correct signal; fix it.

2. **Runtime proof — Commit 1.** The F28 re-drive and one Task 3-5 scrubber item, before Commit 2 begins. This is loaded-bearing and cannot be skipped.

3. **Commit 1 — narrate it as an amendment to D33's allow-list under D54**, with the "pinned constant ≠ inherited variable" argument stated. State that `COLORTERM` is a consistency decision, not an F28 finding.

4. **Migration v7 — append to `MIGRATIONS`** as a single entry, three statements, applied atomically (the v4/v5 multi-statement precedent). Confirm `MIGRATIONS.length + 1` equals 7 before appending.

5. **Drizzle mirror** — `src/main/db/schema.ts`, **exactly** matching the DDL. The types and the schema must not drift.

6. **Storage accessors** — rows-in-rows-out discipline, same style as the worktree and credential accessors. The dispatch open/close/read surface.

7. **`dispatches.ts` — the pure classifier first.** `classifyOutcome` takes plain facts and returns `{outcome, closedBy}`. Pure, exported, Electron-free. Write its unit table before the recorder exists.

8. **`dispatches.ts` — the recorder.** Open on start, close on exit, heal orphans at boot, close the remainder at quit. **Every storage call inside its own `try/catch` that logs through pino and returns.** No method on this object may throw.

9. **`sessionManager.ts` — three additive changes**, no more. The `onStart` announce loop must itself be defensive so a future listener cannot break a launch.

10. **`index.ts` — wiring and ORDER.** The boot heal must run **before** `sessions.restore(project.id)`. The quit close must run **after** `sessions.dispose()` and **before** `storage.close()`.

11. **The dump script.** Adapted from `_verify/3-6/dump-v6.js`, with the credential-blob change mandated above.

12. **Tests**, then `npm run typecheck` / `npx vitest run` / `npm run grep:secrets`.

13. **The three-dump migration protocol** (Verification Commands below) and the seven-step dispatch runtime drive (G2).

## Strict Non-Goals

- **No UI, no board, no dispatch panel, no pane task chip, no settings surface.** Spec §9 Phase 0 is explicit: _"No UI. No board."_ Not a debug view, not a temporary table dump in Settings, not "just a count in the status bar".

- **No IPC channel, no preload forwarder, no Zod schema.** The count of `ipcMain.handle(` registrations must still read **31** when this task ends.

- **No task graph, no seed loader, no validation, no readiness / fan-out / critical path / float / estimation / projection.** Those are spec phases 1 and 2 and belong to Phase 8.

- **No token or cost WRITER.** v7 declares `tokens_in`, `tokens_out`, `tokens_cached`, `cost_usd`; this task writes `NULL` to all four, always. The producer is Task 3a-3.

- **No attention WRITER, no focus tracking, no `powerMonitor` import, no `BrowserWindow` focus listener, no idle threshold.** v7 creates `attention_spans` and this task leaves it **empty**. Task 3a-2 owns every line that writes to it.

- **No second migration.** v7 is the only one this task adds. If you find yourself wanting v8, the design is wrong — raise it.

- **No `usage_records` table.** Superseded here; the dispatch row is the usage record.

- **No `REFERENCES` clause on either new table.** Not to `sessions`, not to `projects`, not to `provider_configs`. This is a hard rule, not a preference.

- **No change to session behaviour.** No new session status, no change to `launch` / `attach` / `restore` / `restart` / `delete` semantics, no change to what the renderer sees.

- **No adapter change, no new agent kind, no registry widening.** `agentKindSchema` stays `'claude' | 'codex'`.

- **No `launch_profiles`, no `model_catalog`, no effort normalization.** Later in this phase.

- **No retention policy, no pruning, no aging-out of dispatch rows.**

- **Do not dump, echo, log, or transmit `credential_profiles.encrypted_blob` or `fingerprint_hash`**, and do not run Test key against "OR milestone key".

- **Do not remove the standing `wt-24b5c1fe` worktree row, its directory, or branch `chorus/Chorus/24b5c1fe`.** It is the standing regression fixture.

- **Do not revert, stage, or commit unrelated or untracked files, including anything under `_verify/` or `docs/`.**

## Required Workflow

Work as coordinator.

For each commit:
1. Implement
2. Review the diff against the Implementation Spec
3. A code-quality pass
4. Resolve findings
5. Run the verification gates
6. Narrate the commit

**Two intentional narrated commits this session** (D46). **Commit 1 fully verified BEFORE Commit 2 begins.**

**Stage scope files EXPLICITLY by path** — never `git add -A` (decision D40's standing rule).

**Do NOT push and do NOT open a pull request** unless explicitly asked.

## Verification Commands

Runnable as written from repo root, PowerShell:

```powershell
npm run typecheck
```

```powershell
npx vitest run
```

```powershell
npm run grep:secrets
```

**Baseline to beat, coordinator-verified 2026-07-24 at `15a016e`:**
- typecheck: 0 errors (node + web)
- vitest: **273/273 across 14 files**
- grep:secrets: reports "clean (6 patterns over src/, scripts/, _verify/, package.json, root configs)"

### The F28 Re-Drive (Commit 1) — Launch from a Hostile Shell

In a fresh PowerShell:

```powershell
$env:TERM = 'dumb'; npm run dev
```

Then launch codex through the real window, screenshot the TUI, and read the child's environment **from outside the app** (`_verify/3-6/read-env.ps1` is the kept harness for exactly this — its PEB offsets were established on this Win11 build and are recorded in roadmap §5). Report: the value of `TERM` in the child, and whether the render shows the interleaved `-  a  p  i …` shape or a normal TUI.

Then re-drive **at least one Task 3-5 scrubber item** against the pinned seam using `_verify/3-5/probe.js` with a planted fake value. Item 2 is the cheapest and most load-bearing.

### The Migration v7 Proof — The FULL Three-Dump Protocol

```powershell
New-Item -ItemType Directory -Force _verify\3a-1 | Out-Null
$env:ELECTRON_RUN_AS_NODE = '1'
& node_modules\electron\dist\electron.exe _verify\3a-1\dump-v7.js "$env:APPDATA\chorus\chorus.db" _verify\3a-1\pre.json
```

Then: cold boot the app (v7 applies) → tree-kill → dump `post.json` → cold boot again → tree-kill → dump `boot2.json`. Assert, **quoting the evidence**:

1. `schema_migrations` shows **6 → 7**, applied **in place**; the `applied_at` timestamps for **v1–v6 are byte-identical** pre and post. Known-good values to check against: v4 `2026-07-20T16:57:49.534Z`, v5 `2026-07-23T13:04:06.301Z`, v6 `2026-07-24T15:52:22.591Z`.
2. Every pre-existing table is **row-identical** across pre / post / boot-2 — `projects`, `sessions`, `worktrees`, `pane_layouts`, `settings`, `provider_configs`, and `credential_profiles` **over its non-secret columns plus `length(encrypted_blob)`**. Zero data loss.
3. `dispatches` and `attention_spans` exist with the exact column list and types the spec gives, and both are **empty** immediately after the migrating boot.
4. **Boot 2 does not re-apply v7** — `applied_at` for v7 is byte-identical between `post.json` and `boot2.json`.
5. The standing `wt-24b5c1fe` worktree row is intact.

⚠ **Provenance (F20).** **Quote the `projects` table in every dump.** The coordinator re-verifies on the real dev DB and needs to see the real pair — `985d547b…` (Chorus) and `f47ac10b…` (Chorus-Second). A dump showing `a43b395d…`/`b684e96e…` is the redirected DB and does **not** discharge this criterion.

⚠ **The `sqlite3` CLI is NOT installed.** Use the `ELECTRON_RUN_AS_NODE` script pattern only. **Known flake: the script intermittently writes no file on its first invocation — retry once.**

### The Dispatch Runtime Drive (G2) — Seven Steps

With the app running, after each step dump `dispatches` and quote the row:

1. **Open.** Launch a session. One row appears: `session_id` matching, `agent` correct, `started_at` set, `ended_at` NULL, `outcome` NULL, all four token/cost columns NULL.
2. **Normal end.** Let a session exit on its own. The row closes with the code-derived outcome and a real `ended_at`.
3. **Kill.** Press the pane's Kill control. The row closes `abandoned` / `kill` — **not** `failed`, even though Windows reports a non-zero code for a killed PTY.
4. **THE DANGLING-ID PROOF.** Close a pane entirely (kill → awaited exit → leaf removed → `session:delete`). Confirm: `session:delete` **does not throw**, the `sessions` row is gone, and the dispatch row **survives** carrying a session id that no longer resolves. This is invariant 2 proven against the enforced-FK reality.
5. **Fresh conversation.** Restart the app so the restore engine relaunches a session. Confirm a **second** dispatch row under the **same** session id, with the first still closed and untouched.
6. **Crash heal.** Tree-kill the app (`taskkill /PID <root> /T /F`) while a session is live, leaving a dispatch open. Boot again. Confirm the orphan closes `abandoned` / `boot-heal` with `ended_at` **NULL**, and that a **third** boot does not touch it again.
7. **Never-fail-a-launch, at runtime.** Temporarily instrument the recorder to throw on open, cold-boot, and confirm a session still launches and attaches normally with the failure logged. **Then revert the instrumentation** and prove the revert against the **commit diff**, not the worktree — the Task 2-4 precedent.

### Installed CLIs — Re-Verify at Execution (D4)

`claude.exe` **2.1.218** and `codex-cli` **0.145.0**. Verify `requiredEnvVars` claims against the tools' own `--help` output.

### Harness Caveats

- **electron-vite does NOT hot-restart the main process.** Every main-process change needs a real tree-kill cold boot.
- Kill process **TREES**: `taskkill /PID <root> /T /F`. The graceful-quit test is `taskkill` **WITHOUT** `/F`.
- **`sqlite3` is NOT installed.** Use the `ELECTRON_RUN_AS_NODE` dump-script pattern in `_verify/3a-1/dump-v7.js`, write results to a file, and note the known flake: **no file on the first invocation — retry once.**
- CDP-driven Vue forms need a microtask tick between an `input` event and a submit click.
- **Never type into a CLI whose input mode you have not read first.** Screenshot and read the pane before sending keystrokes.

## Failure Honesty Clause

If any verification command fails for an unrelated environment reason, **capture the EXACT output**, explain it, and **DO NOT claim success**.

An indeterminate result is reported as indeterminate and the affected acceptance criterion is marked **FAILED** — never reasoned into a pass.

An unproven claim is worse than an honest unknown because it will be cited later as evidence.

**Temporary instrumentation must be reverted** and the review checks the **COMMIT DIFF**, not the worktree.

## Final Reporting Requirements

Report a status of exactly one of: **DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED**

Plus:

- Both commit SHAs and what each contains
- Every file changed (per commit)
- Typecheck / vitest / grep:secrets results with **actual numbers**
- The Commit 1 proof: the F28 re-drive evidence (TUI screenshot render quality, child's `TERM` value read from outside the app, at least one Task 3-5 scrubber item re-driven with planted value) and the exact prose naming it an amendment to D33's allow-list under D54
- **Migration v7 proof (D50)**: the three dumps (pre / post / boot-2) with the `projects` table quoted in each, v1–v6 `applied_at` shown byte-identical, every pre-existing table shown row-identical, `dispatches` and `attention_spans` confirmed empty after the migrating boot, and v7 confirmed not re-applied on boot 2 — **on the REAL dev DB (`985d547b…`)**, not an F20-redirected one
- The seven-step dispatch runtime drive with dispatch rows quoted after each step
- The classification mapping proven for all five observables (clean exit, non-zero exit, kill, quit, boot-heal)
- The four open-predicate and dangling-ID checks proven at runtime
- The never-fail-a-launch proof (throwing-storage unit test **and** reverted runtime instrumentation checked against the commit diff)
- Confirmation that no `credential_profiles` blob or fingerprint appears anywhere
- Confirmation that `dispatches` carries no `REFERENCES` clause
- The standing `wt-24b5c1fe` worktree row proven intact
- The final `git status --porcelain` and confirmation that the two `TASK-*-REVIEW-FABLE.md` files are still present and unmodified
- Confirmation each non-goal held
- Residual risks and known gaps
