# Task 3a-2: Attention Capture (Focus + Idle) — Execution Prompt

## Role

You are the Coordinator for Chorus — Foundation **Phase 3a, Task 3a-2** (Attention Capture — Focus + Idle).

Repo root: `C:\Projects\ContactEstablished\Chorus`

Expected branch: `main` — confirm with `git branch --show-current`; do NOT switch or create branches without instruction.

**Expected code HEAD for `src/` at start: `8a2e8c3`** (Task 3a-1 — TERM pin + the dispatch telemetry spine). One docs commit (this prompt) may sit on top; no production code has changed since.

Platform: Windows 11, PowerShell 7

Chorus is a local-first BYOK Electron + Vue 3 + TypeScript desktop app for running multiple AI coding agents in parallel terminal panes.

## Goal

Make Chorus able to answer *"how many minutes of human attention did this actually cost?"* without ever asking the human to press start — the second half of Mission Control's spec-Phase-0 telemetry capture (D41, D50), writing into the `attention_spans` table Task 3a-1 created and named this task the only writer of.

The Mission Control spec is blunt: attention-minutes is *"the most valuable output and the least reliable input"*, and §11 ranks it a top risk precisely because an unreliable input drives the headline number. So this task ships two things, and the second is not decoration: (1) a measurement that is cheap, crash-safe, and never asks the user for anything; (2) **the measurement's own uncertainty, carried alongside every number** — sample counts, classification histogram, coverage. A number without its denominator is worse than no number here, because it will be believed.

### One Commit in This Session

**ONE intentional narrated commit (G3).** The two-commit amendment was Task 3a-1's alone (D46/D54) and does not carry forward.

## Ground Yourself First

Read these before editing anything. All paths are relative to repo root:

- `CLAUDE.md` (locked architecture rules — D1 Zod-in-main, D14 plain-object IPC, secrets discipline)
- `docs/Features/Foundation/roadmap.md` — §5 (Verified Ground Facts, incl. **F4, F16, F20**), §6 (**D41, D50, D51**), §7 (Phase 3a)
- `docs/Features/Foundation/Tasks/Phase-3a-Overview.md` (phase contract, file-ownership matrix, standing conditions)
- `docs/Features/Foundation/Tasks/Task-3a-2.md` (GOVERNS SCOPE — the focus-state table lives here, thirteen rows, one test case each)
- `docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-3a-2.md` (GOVERNS EXACT CONTENTS — sampling ruling, tick accounting, classify(), insertion points, privacy header, Step-0 pre-flight)
- `docs/Features/Mission Control/chorus-mission-control-spec.md` — **§5.3** (the four requirement clauses), **§10 Q3** (the proxy question this task does NOT answer), **§11** (the risk row)
- **Task 3a-1's shipped artifacts** (commit `8a2e8c3`): `src/main/services/dispatches.ts` (the recorder + `classifyOutcome` — the closest sibling pattern), the v7 DDL in `src/main/services/storage.ts`'s `MIGRATIONS`, and the `attentionSpans` Drizzle table in `src/main/db/schema.ts`

### Code to Inspect

Anchor to **NAMED SYMBOLS**, never line numbers. Current as of `8a2e8c3`:

- `src/main/db/schema.ts` — the **`attentionSpans` table is SHIPPED**, with `class TEXT NOT NULL` and `tickSeconds INTEGER NOT NULL` included (the coordinator's pre-ship amendment resolving 3a-2's dependency finding). **No `schema.ts` edit in this task.**
- `src/main/services/storage.ts` — `MIGRATIONS` has **seven entries** (v7 = dispatches + attention_spans). The dispatch accessors block (`createDispatch` / `getOpenDispatchForSession` / `listOpenDispatches` / `closeDispatch`) is the rows-in-rows-out idiom to match; the `saveWindowBounds` / `setViewState` inline-Drizzle settings idiom is the model for the kill-switch key.
- `src/main/index.ts` — after Task 3a-1, the boot block constructs storage → `sessions.bindStorage` → `GitWorktreeManager` → `CredentialVault` → **the dispatch recorder (`createDispatchRecorder`, heal, attach)** → `registerIpc(sessions, storage, worktrees, vault)` → `watchSessionExits(sessions)` → the D11 status-persist `onExit` listener → awaited `worktrees.reconcileAll()` → `void sessions.restore(...)`. The `before-quit` handler is `sessions.dispose()` → `dispatches?.closeOpenOnQuit()` → `storage?.close()`. The attention tracker slots in beside the recorder (construct after the vault, before `registerIpc`); `attention.dispose()` goes in `before-quit` **before `storage?.close()`**.
- `src/main/services/sessionManager.ts` — the `exitListeners` Set now holds **three** listeners (notifications' `watchSessionExits`, the D11 status-persist, the dispatch recorder's close-on-exit). Task 3a-2's doc says "a third `onExit` listener" — **post-3a-1 it is the fourth**; the Set idiom stands and order within it is not contractual. Also note `onStart` (Task 3a-1) and `wasKilledByChorus` — **this task touches none of them.**
- `src/shared/ipc.ts` — the `IpcChannel` map (**34 entries**; Task 3a-1 added none) and every schema. `ViewGet`/`ViewSet` are the closest model for this task's pair.
- `src/main/ipc.ts` — **31 `ipcMain.handle(` registrations** (3a-1 added none). This task takes it to **33**. `registerIpc` gains a fifth positional parameter (`attention`) — the 3-2 `vault` precedent.
- `src/preload/index.ts` — Zod-free typed forwarder; `index.d.ts` never hand-edited.
- `src/renderer/src/App.vue` — holds `activeView`, `anyOverlayOpen`, `projectStore.activeId`; already runs a capture-phase window `keydown` and a window CustomEvent listener (the house idiom this task's `focusin` listener follows).
- `src/renderer/src/components/TerminalPane.vue` — gains ONE attribute, `:data-attention-session`, on the **terminal host** element (not the pane card — the placement is a design decision, spec §3.1).
- `vitest.config.ts` — its header is binding: **tests never import `storage.ts` or `better-sqlite3`** (the native binding is built for the Electron ABI 148; Vitest runs Node 22/ABI 127 and `new Database()` throws). Re-verified 2026-07-25: `require('better-sqlite3')` under plain node fails with `NODE_MODULE_VERSION 148 vs 127`.

### Git Checks to Run First

```
git branch --show-current
git status --porcelain
git log --oneline -3
```

### Decisions You Must Honour — all RESOLVED

- **D1** — all Zod in main; the preload is a Zod-free forwarder (the page CSP forbids the `eval` Zod compiles with).
- **D4** — verify CLI flags and API behaviour against the tool itself at execution time. For this task that means `powerMonitor`'s **observed** behaviour on this machine (Step 0), not its typings.
- **D14** — IPC payloads are plain objects; a Pinia proxy fails structured clone at runtime with no compile-time signal. The renderer's report is a fresh object literal of primitives, with the prototype assertion in `reporter.test.ts`.
- **D41 / D50 / D51** — telemetry lands in full, sequenced first on asymmetric decay. This task is the attention third of D51.
- **F4** — a session id stored without an FK is the standing precedent (`focusedSessionId`); the `attention:report` handler deliberately does NOT FK-check `sessionId`.
- **F16** — FKs are ENFORCED. The shipped `attention_spans` carries **no `REFERENCES` clause** (verified at `8a2e8c3`) — re-verify at execution; if one appears, stop and raise it.
- **F20 (STANDING, mechanism now DIAGNOSED 2026-07-25)** — the real dev DB (projects `985d547b…` Chorus / `f47ac10b…` Chorus-Second, migrations v1–v7) lives at the **Claude MSIX container's redirected Roaming**: `C:\Users\matth\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\chorus\chorus.db`. A raw shell's `%APPDATA%\chorus\chorus.db` is a DIFFERENT, scratch DB (pair `a43b395d…`/`b684e96e…`) whose dumps discharge nothing. Electron **ignores** the `APPDATA` env var but **honours `--user-data-dir`** — proven 2026-07-25. Boot the dev app against the real DB with the `_verify/3a-1/start-realdb.ps1` pattern (copy it into `_verify/3a-2/`); **quote the `projects` table in every dump**; the coordinator re-verifies regardless.
- **⚠ NO MIGRATION IN THIS TASK. NO v8.** `MIGRATIONS.length` is **7** and stays 7. The `class` and `tick_seconds` columns 3a-2's dependency finding raised are **already shipped in v7** — confirmed at `8a2e8c3`. If you find a needed column absent, that is a dependency finding to raise, not a migration to write.
- **Channel counts:** `IpcChannel` 34 → **36**; `ipcMain.handle(` 31 → **33**. Nothing else in those files changes.
- **vitest constraint (ABI)** — the pure core (`attentionCore.ts`) and the renderer dedupe (`reporter.ts`) carry all unit-testable logic. No test imports `storage.ts`, `better-sqlite3`, `electron`, or `../db/schema`.

## Pre-Existing Changes — Do Not Touch

The working tree contains exactly two untracked files at repo root: `TASK-3-5-REVIEW-FABLE.md` and `TASK-3-6-REVIEW-FABLE.md`. **Do NOT** revert, stage, delete, or commit them. Also never stage or revert anything under `_verify/` or `docs/` unless a step explicitly says so. Do not remove the standing `wt-24b5c1fe` worktree row, directory, or branch.

## ⚠ STANDING CONDITION — the dev vault holds REAL credentials

The real dev vault (the MSIX-container DB above) holds Matthew's **real, billable OpenRouter key** ("OR milestone key") and a leftover fake ("Claude fake key"). Binding on this task:

1. **Never dump, echo, print, copy, or transmit `credential_profiles.encrypted_blob` or `fingerprint_hash`.** Attention dump scripts select from `attention_spans` (+ `projects` for F20 provenance) — nothing else.
2. **Do not press Test key** on any profile.
3. This task's privacy bar is higher than usual: it records **how long a human sat at a screen**. The `attention.ts` module header carries the spec §8 statement verbatim; honour every clause — local-only, no network call, nothing into any transcript/ring-buffer/PTY, no per-tick log line, an off switch honoured live.

## Implementation Scope

Thirteen files, exactly as `Task-3a-2.md`'s Exact Scope table:

- **CREATE** `src/main/services/attentionCore.ts` — the pure core: `AttentionClass`, `AttentionInputs`, `classify()`, `slotFor()`, `sameSlot()`, `advance()`, `coverage()`, `TICK_SECONDS` (15), `IDLE_THRESHOLD_SECONDS` (60). No `electron`, no `better-sqlite3`, no `Date.now()` — time arrives as a parameter.
- **CREATE** `src/main/services/attentionCore.test.ts` — one case per focus-state-table row, precedence cases, idle boundary exact (59 counts, 60 idle), tick accounting (late firing credits ONE sample and sets the gap flag — never wall-clock deltas), the accounting identity, `coverage()`, and the no-retro-debit pin (3-minute no-input stretch = **4 pane samples then 8 idle** at 15 s).
- **CREATE** `src/main/services/attention.ts` — the Electron seam: `createAttentionTracker({storage, readIdleSeconds, now, tickMs?})`. **ONE `setInterval`**, one `powerMonitor` read per tick, the last renderer report held with a `stale` flag, every decision delegated to the core. `dispose()` flushes and clears.
- **EDIT** `src/main/services/storage.ts` — attention accessors ONLY: `openAttentionSpan(row)`, `extendAttentionSpan(id, endedAt, seconds)`, `readAttentionSpans(projectId, fromIso, toIso)` over the shipped `attentionSpans` table. Every row written `source: 'measured'`, `dispatch_id: null`. **No `MIGRATIONS` entry, no `schema.ts` change.**
- **EDIT** `src/main/index.ts` — construct the tracker after the vault/before `registerIpc`; wire `'focus'`/`'blur'`/`'minimize'`/`'restore'` + `webContents.on('did-finish-load')` in `createWindow` (initialise latches from `isFocused()`/`isMinimized()` — do not wait for events); `powerMonitor` `'lock-screen'`/`'unlock-screen'`/`'suspend'`/`'resume'`; the fourth `sessions.onExit` listener; `dispose()` in `before-quit` before `storage?.close()`. **One boot log line only:** `[attention] capture on|off · tick 15s · local-only`.
- **EDIT** `src/main/ipc.ts` — `registerIpc(sessions, storage, worktrees, vault, attention)` + two handlers beside `ViewGet`/`ViewSet`. `AttentionReport` is write-only inbound, `sessionId` deliberately NOT FK-checked (F4). `AttentionSummary` outbound-parses the response — the denominator rule made structural.
- **EDIT** `src/shared/ipc.ts` — two `IpcChannel` entries + schemas. The summary response **requires** `samples`, `byClass`, `expectedSamples`, `coveragePct`; minutes are derived from `samples × tickSeconds`, never stored alone.
- **EDIT** `src/shared/ipc.test.ts` — channel uniqueness; report schema rejects non-uuid, accepts `null`; the **negative test**: a denominator-less summary fails to parse.
- **EDIT** `src/preload/index.ts` — two typed forwarders, Zod-free.
- **CREATE** `src/renderer/src/attention/reporter.ts` — pure `buildReport()` / `shouldReport(prev, next)` (edge-triggered; DOM-free).
- **CREATE** `src/renderer/src/attention/reporter.test.ts` — edge-trigger cases; the plain-prototype/primitives assertion (the D14 trap as a test).
- **EDIT** `src/renderer/src/App.vue` — one `focusin` window listener (the `data-attention-session` walk), one `watch` on the four report facts, one initial report in `onMounted`, removed on unmount.
- **EDIT** `src/renderer/src/components/TerminalPane.vue` — `:data-attention-session="sessionId"` on the terminal host div. **One attribute, nothing else.**

**The focus-state table in `Task-3a-2.md` is the specification of `classify()`** — thirteen rows, precedence `locked → idle → blurred → overhead → pane`, first match wins. Read it against the implementation row by row in review; a silently changed ruling produces numbers that still look plausible.

**Kill switch:** `attention_capture_enabled` in `settings`, default on, read at boot and honoured live (the tick still fires when off; it writes nothing).

**Nothing else.** If a change seems to require another file — especially `sessionManager.ts`, `sessionOutput.ts`, `scrubber.ts`, `LayoutRenderer.vue`, or `useViewStore` — **stop and raise it**; that is a scope signal, not a detail. In particular: **do NOT "fix" the `LayoutRenderer` grid-mode focus-emit gap** — it is a recorded finding for its own commit (fixing it changes persisted view state, a shipped behaviour).

## Strict Non-Goals

- **No board, panel, projection UI, timer UI, start/stop control, or "still working?" prompt — ever.** No correction UI: corrections arrive later as new `source='correction'` rows, purely additive; name that home in the commit message.
- **No attention number without its denominator** — not in UI, IPC, logs, or exports. A response shape that lets a caller read minutes alone is a review failure.
- **No per-pane timer, no per-second tick, no renderer-side clock.** One `setInterval` in main; ten panes cost the same as one, proven by row rate.
- **No keystroke capture/timing, no window titles of other apps, no process enumeration, no screenshots, no clipboard, no app-usage tracking.** `getSystemIdleTime()` returns an integer; nothing in this task goes looking for more.
- **Nothing leaves the machine; nothing enters a transcript, ring buffer, or PTY.** Attention records must never be visible to an agent.
- **No per-tick logging** — one boot line naming cadence and enabled state.
- **No migration, no v8, no `schema.ts` table, no FK on `attention_spans`, no change to `focusedSessionId`/`view:get`/`view:set`/`useViewStore`, no `<KeepAlive>`, no new npm dependency, no retro-debit.**
- **No dump, echo, or transmission of `credential_profiles`** in any artifact.
- **Do not touch the two `TASK-*-REVIEW-FABLE.md` files, `_verify/` committed content, or the `wt-24b5c1fe` fixture.**

## Required Workflow

Work as coordinator. Implement → review the diff against the Implementation Spec → a code-quality pass → resolve findings → run the gates → narrate the commit. **Stage scope files EXPLICITLY by path** — never `git add -A` (D40). Do NOT push and do NOT open a pull request unless explicitly asked.

Ordered work steps (Task-3a-2.md §Step-by-step governs):

1. **Reconcile with the shipped v7 schema** (it matches the amendment — `class` + `tick_seconds` present, no `REFERENCES`; confirm anyway).
2. **Step 0 pre-flight** (below) — measure the measuring device BEFORE building on it; record all three answers as verified facts in the commit narration.
3. `attentionCore.ts` + its tests (the logic lives here).
4. `attention.ts` (the seam).
5. Storage accessors.
6. IPC + preload + shared schemas.
7. `reporter.ts` + App.vue + the one `TerminalPane` attribute.
8. The kill switch.
9. Tests, then the three gates.
10. **Runtime verification (G2, load-bearing here)** — the scripted sequence with expected attributed minutes. This behaviour cannot be verified by compiling.

## Verification Commands

```powershell
npm run typecheck
npx vitest run
npm run grep:secrets
```

**Baseline to beat, coordinator-verified 2026-07-25 at `8a2e8c3`:**
- typecheck: 0 errors (node + web)
- vitest: **292/292 across 15 files**
- grep:secrets: "clean (6 patterns over src/, scripts/, _verify/, package.json, root configs)"

### ⚠ Step 0 — pre-flight the instrument (Task-3a-2.md governs; three answers recorded as facts)

1. **Does CDP-injected input reset the Windows idle timer?** Probe with CDP input every 10 s for 90 s while sampling `getSystemIdleTime()`. If it climbs past 60, CDP input is invisible to the OS timer and every "typing" phase below must be driven with **real OS input** (a `user32` `SendInput` helper), not CDP.
2. **Independent oracle:** a PowerShell `GetLastInputInfo` P/Invoke (`_verify/3a-2/idle.ps1`) read from outside Electron must AGREE with `getSystemIdleTime()` read inside.
3. **Does `getSystemIdleState()` report `'locked'` on this machine?** Lock (`rundll32 user32.dll,LockWorkStation`), unlock, read. If not observable, row 1 rests on the `'lock-screen'` event alone — documented as the smaller claim.

### The scripted focus/idle sequence — the acceptance gate

Boot against the **real DB** (`--user-data-dir` launcher — copy `_verify/3a-1/start-realdb.ps1` into `_verify/3a-2/`). Two panes (A, B) in one project; wall-clock noted; phases per `Task-3a-2.md`'s table (75 s phases = **5 ticks ±1**): pane A typing · pane B typing (A frozen) · Settings overhead · another app on top (`blurred`, everything else frozen) · 180 s focus-A-then-hands-off (**4 ±1 pane, then 8 ±1 idle** — the no-retro-debit proof) · phase-1 repeat in **grid view** (identical attribution — the `LayoutRenderer` gap proof) · `taskkill /PID <root> /T /F` mid-run then cold boot (open run's `ended_at` within **one tick** of the kill — quote the delta in seconds) · lock ~60 s, unlock, run last.

**Then assert with real numbers:** A ≈ 2.25 min, B ≈ 1.25 min, overhead ≈ 1.25 min (each within one tick); the accounting identity holds across the whole drive; `attention:summary`'s full JSON dumped with `samples`/`byClass`/`expectedSamples`/`coveragePct` internally consistent; the one-minute row rate with 2 panes equals the rate with 4; the privacy sweep (no per-tick line, no session content, no window titles, no key material, no network call in the new modules) is clean.

**Test the test (spec §9.3):** temporarily invert the overlay/pane ordering in `classify()` and confirm the phase-3 overhead assertion goes **red**; temporarily switch the extend-in-place write to write-on-transition and confirm phase 7's delta blows out. **Revert both and prove the reverts against the COMMIT DIFF, not the worktree** (the Task 2-4 / 3a-1 step-7 precedent).

### Dump discipline

`sqlite3` is NOT installed — the `ELECTRON_RUN_AS_NODE` pattern only (precedent: `_verify/3a-1/dump-v7.js`; write a `_verify/3a-2/` script dumping `attention_spans` + `projects`, nothing else). **Known flake: no file on the first invocation — retry once.** **Quote `projects` in every dump (F20)** — the real pair is `985d547b…`/`f47ac10b…`; a dump showing `a43b395d…`/`b684e96e…` describes the scratch DB and discharges nothing. **Never dump `credential_profiles`.**

### Harness Caveats — updated 2026-07-25

- **electron-vite does NOT hot-restart the main process**; HMR covers the renderer only. This task's clock lives in main — every timing check needs a real cold boot.
- **Graceful quit:** `taskkill` WITHOUT `/F` (WM_CLOSE) does **not** terminate the dev app in this (NoMachine) session — observed 2026-07-25. Use a CDP `window.close()` evaluate; it takes the same close path (`window-all-closed` → `before-quit`). Kill process **TREES** with `taskkill /PID <root> /T /F` for the crash cases.
- **Boot against the real DB** with `--user-data-dir=C:\Users\matth\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\chorus` (Electron ignores `env:APPDATA`; this switch it honours — proven 2026-07-25). Launcher precedent: `_verify/3a-1/start-realdb.ps1`.
- CDP on `--remote-debugging-port=9222`; wrap every `Runtime.evaluate` body in an IIFE (top-level `const` collides across evaluates); CDP-driven Vue forms need a microtask tick between `input` and submit-click.
- **Never type into a CLI whose input mode you have not read first** — screenshot and read the pane before sending keystrokes. (And see Step 0.1: CDP input may not count as OS input at all.)
- All artifacts under `_verify/3a-2/`.

## Failure Honesty Clause

If any verification command fails for an unrelated environment reason, capture the EXACT output, explain it, and DO NOT claim success. An indeterminate result is reported as indeterminate and the affected acceptance criterion is marked **FAILED** — never reasoned into a pass. An unproven claim is worse than an honest unknown because it will be cited later as evidence. Temporary instrumentation must be reverted and the review checks the COMMIT DIFF.

## Final Reporting Requirements

Report a status of exactly one of: **DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED**, plus:

- The commit SHA and every file changed (only the thirteen scope files)
- Typecheck / vitest / grep:secrets results with **actual numbers**
- Step 0's three answers, recorded as verified facts
- The focus-state table: thirteen rows implemented, one passing test each, precedence cases green
- The scripted-sequence table with **real numbers** (per-phase samples, A/B/overhead minutes, the 180-s split, the grid repeat, the phase-7 delta in seconds, the lock result)
- The accounting identity, in a unit test AND against the real dev DB after the drive (projects quoted)
- The full `attention:summary` JSON, internally consistent
- The one-clock proof by row rate (2 panes vs 4)
- The no-retro-debit split (4 pane then 8 idle) pinned by test and observed at runtime
- The two test-the-test inversions, reverted and proven against the commit diff
- The privacy sweep results and the working off switch
- Confirmation: no migration in the diff; `MIGRATIONS.length` still 7; `IpcChannel` 36; `ipcMain.handle(` 33; `LayoutRenderer.vue` unmodified; the two `TASK-*-REVIEW-FABLE.md` files untracked and unmodified; `wt-24b5c1fe` intact
- Confirmation each non-goal held
- Residual risks and known gaps — including the stated-known-limits list (spec §10) confirmed present in the code, not just the docs
