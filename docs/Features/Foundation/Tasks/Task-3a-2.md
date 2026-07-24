# Task 3a-2 — Attention Capture (Focus + Idle)

_Second task of Phase 3a (Profiles & Catalog), and the second half of Mission Control's spec-Phase-0 telemetry capture (**D41**, **D50**). **One narrated commit (G3).** Depends on Task 3a-1, which owns the migration and the table this task writes into. This task governs scope; `ImplementationSpecs/ImplementationSpec-3a-2.md` governs exact contents._

## Source Of Truth

- `docs/Features/Mission Control/chorus-mission-control-spec.md` **§5.3** — the four requirement clauses this task implements, quoted in full in the spec doc's §1. Also **§10 Q3** (_"Is focus-plus-idle a good enough attention proxy…? Worth a week of shadow measurement in phase 0 before committing to the design"_) and **§11**, whose risk row reads: _"Attention measurement is unreliable but drives the headline output → Auto-measure with one-tap correction; validate against shadow measurement in phase 0."_ **The spec names this the "most valuable output and the least reliable input."** Honesty about the second half is a deliverable, not a caveat.
- Roadmap §6 **D41** (Mission Control admitted as provisional Phase 8; its telemetry slice pulled forward into Phase 3a) and **D50** (3a runs next on asymmetric decay — _"every week 3a waits is a week of data permanently lost"_; telemetry is the phase's **opening** work, not its closing work).
- Roadmap §7 Phase 8 note **(c)**: _"pane close / `session:delete` **deletes the row** (D16 resolution d), so dispatch records must tolerate their session id disappearing rather than assuming referential integrity."_ This single line dictates the FK ruling in Dependencies below.
- Roadmap §5 **F16** — `PRAGMA foreign_keys` reads `1`; FKs are **enforced**. Any `REFERENCES` clause is a real constraint.
- Roadmap §5 **F4** — `focusedSessionId` is deliberately **not** FK-checked; a stale value is normal drift. The precedent for storing a session id without a constraint.
- `CLAUDE.md` — **D1** (all Zod in main), **D14** (plain-object IPC payloads; a Pinia proxy fails structured clone at runtime with no compile-time signal), secrets discipline.
- Precedent for the pure/impure split: `src/main/services/restore.ts` (`computeRestoreSet`) and `src/main/services/vaultCore.ts` — Electron-free, DB-free modules with real unit tests. **`vitest.config.ts` makes this mandatory, not stylistic:** its header states tests _never_ import `storage.ts` or `better-sqlite3`, because the native binding is built for the Electron ABI (148) while Vitest runs under Node 22 (127).
- Precedent for the one-clock rule: `FilmstripRenderer.vue` — _"ONE shared clock at 60 s granularity: every card derives its elapsed label from this single ref — never a per-card or per-second timer."_ (Task 1b-2.)
- Precedent for BrowserWindow event wiring: `createWindow`'s `persistBounds` on `'resized'`/`'moved'`, writing through `StorageService.saveWindowBounds`.

## Initial Starting Point

**Verified 2026-07-24 against commit `15a016e`** (code HEAD for `src/`; `e233e33` is a roadmap-only commit on top). Re-verify against Task 3a-1's commit before starting — 3a-1 lands the migration this task depends on.

- **Baseline, independently re-run this session:** `npm run typecheck` exits 0 · `npx vitest run` = **273 passed across 14 test files** · `npm run grep:secrets` clean. Task 3a-1 grows this; the implementer confirms the then-current numbers, not these.
- **`powerMonitor` is imported nowhere in the repo.** Verified by grep over `src/` and `_verify/`: zero hits. This task is its first use. `powerMonitor.getSystemIdleTime(): number` and `getSystemIdleState(idleThreshold): 'active' | 'idle' | 'locked' | 'unknown'` both exist in the Electron 43.1.1 typings, documented as **seconds**; the `'lock-screen'` / `'unlock-screen'` events are typed `@platform darwin,win32`, so Windows is in scope.
- **No focus tracking of any kind exists today.** No timer in main. No attention concept anywhere.
- **`src/main/index.ts`** is a single `app.whenReady().then(async () => { … })` block: it constructs `StorageService`, `SessionManager`, `GitWorktreeManager`, `CredentialVault`, calls `registerIpc(sessions, storage, worktrees, vault)`, then `watchSessionExits(sessions)` and a second independent `sessions.onExit((sessionId, exitCode) => …)` (the D11 status-persist listener — `exitListeners` is a `Set`, so adding a third is the established idiom). `app.on('before-quit')` calls `sessions.dispose()` and `storage.close()`.
- **`createWindow` already owns window-event wiring.** `persistBounds` is registered on `'resized'` and `'moved'` with a comment noting both _"fire once after the interaction ends (Windows), so no debounce"_. This is the precedent to follow for `'focus'`/`'blur'`/`'minimize'`/`'restore'` — and the reason no new architecture is needed to observe window state.
- **`focusedSessionId` already exists — and is the wrong instrument.** Per-project view state lives in `settings` under `view_state:<projectId>` as `{mode, focusedSessionId}`, via `StorageService.getViewState`/`setViewState`, exposed as `view:get`/`view:set` and held by `useViewStore`. Three verified facts disqualify it as an attention input:
  1. **It survives blur, minimize, and quit.** It is persisted state describing which pane the filmstrip should render full-size — a *view* fact, deliberately durable. Attention needs an *instantaneous* fact.
  2. **In grid mode it is never updated by clicking a pane.** `TerminalPane` emits `focus` from a real `terminal.textarea` `'focus'` listener (`onTextareaFocus`), and `FilmstripRenderer` forwards it — but **`LayoutRenderer` declares only `defineEmits<{ split: … }>()` and binds no `@focus` on its `<TerminalPane>`**, so the emit is dropped on the floor in grid mode. A tracker keyed on `focusedSessionId` would attribute an entire grid-mode working session to whichever pane was last focused in the filmstrip.
  3. It is **nullable and never FK-checked** (F4), so it legitimately names a deleted session.
- **`src/shared/ipc.ts`** exports the `IpcChannel` map (**34 entries** as of `15a016e`, counted this session) and every schema; **`src/main/ipc.ts`** exports `registerIpc(sessions, storage, worktrees, vault)` with **31 `ipcMain.handle(` registrations**. The `ViewGet`/`ViewSet` handlers are the closest model for this task's pair: parse in, `requireProject(...)`, storage call, outbound `.parse` on the way back.
- **`src/preload/index.ts` is a Zod-free typed forwarder** (D1 — the page CSP forbids the `eval` Zod compiles parsers with). `src/preload/index.d.ts` is never hand-edited; `ChorusApi` is inferred.
- **`StorageService` settings-table idiom is established and copyable**: `getWindowBounds`/`saveWindowBounds`, `getRecentCwds`/`pushRecentCwd`, `getCredentialedSessionIds`/`markSessionCredentialed`, `getViewState`/`setViewState` — all inline Drizzle `insert(...).onConflictDoUpdate({target: settings.key, ...})`, all with a defensive read that collapses a corrupt row to a default rather than throwing.
- **`SessionManager`** exposes `onData`/`onExit` (both `Set`-backed, additive), `isRunning(sessionId)`, `getAgent(sessionId)`, and drives `createSessionOutput` (`sessionOutput.ts`) for the scrub → ring-buffer → broadcast pipeline. **This task touches none of it except to add a third `onExit` listener.**
- **`App.vue`** already holds every renderer-side fact this task needs except one: `activeView` (`'workspace' | 'settings'`), `anyOverlayOpen` (a computed over `dialogOpen`/`paletteOpen`/`worktreePanelOpen`), and `projectStore.activeId`. It already runs a capture-phase `window.addEventListener('keydown', onGlobalKey, true)` and a `window.addEventListener('chorus:worktree-notice', …)` — so a window-level listener at App scope is the house idiom, not a novelty. **The missing fact is which terminal currently holds DOM focus**, and that is renderer-only knowledge main cannot derive.
- **Two untracked files sit at the repo root**: `TASK-3-5-REVIEW-FABLE.md` and `TASK-3-6-REVIEW-FABLE.md`. They are **not yours**. See Non-Goals.

## Goal

Make Chorus able to answer *"how many minutes of human attention did this actually cost?"* without ever asking the human to press start.

The spec is blunt about why this matters and why it is dangerous in the same breath: attention-minutes is _"the most valuable output and the least reliable input"_, and §11 lists it as one of two top risks precisely because an unreliable input drives the headline number. Anything requiring manual entry _"will be abandoned within a week"_ — so a timer is not a fallback, it is the failure mode the design exists to avoid.

The interesting engineering problem is not the timer. It is that **every available signal is a proxy for something it cannot actually see.** `BrowserWindow.isFocused()` knows the window has keyboard focus, not that a human is looking at it. `powerMonitor.getSystemIdleTime()` knows the machine has been untouched, not that the user has left — and it is OS-wide, so it cannot tell "reading a diff in Chorus" from "reading the same diff in GitKraken". The persisted `focusedSessionId` knows which pane the *view* considers focused, which is a different question with a different lifetime.

So this task ships two things, and the second is not optional decoration:

1. A measurement that is **cheap, crash-safe, and never asks the user for anything**.
2. The measurement's **own uncertainty, carried alongside every number it produces** — sample counts, classification histogram, and coverage. The roadmap's estimator-honesty rule (_"always surface the sample count"_) is not a Phase-2 concern to bolt on later; if the capture layer does not record the denominator, no later layer can invent it.

A number without its denominator is worse than no number here, because it will be believed.

## Exact Scope

| File | Change |
|---|---|
| `src/main/services/attentionCore.ts` | **Create.** The **pure** core: `AttentionClass`, `AttentionInputs`, `classify()`, `slotFor()`, `sameSlot()`, `advance()`, `coverage()`, `TICK_SECONDS`, `IDLE_THRESHOLD_SECONDS`. **No `electron` import, no `better-sqlite3` import, no `Date.now()` inside** — time arrives as a parameter. The `restore.ts` / `vaultCore.ts` pattern. |
| `src/main/services/attentionCore.test.ts` | **Create.** The focus-state table below becomes one test case per row, plus the tick-accounting and coverage suites. |
| `src/main/services/attention.ts` | **Create.** The Electron seam: `createAttentionTracker({...}) → AttentionTracker`. Owns **the one `setInterval`**, reads `powerMonitor`, holds the last renderer report, calls the pure core, writes runs through storage. `dispose()` flushes and clears. |
| `src/main/services/storage.ts` | **Edit.** Attention accessors only, over 3a-1's `attention_spans` — `openAttentionSpan(row)`, `extendAttentionSpan(id, endedAt, seconds)`, `readAttentionSpans(projectId, fromIso, toIso)`. **NO migration, no `MIGRATIONS` entry, no `schema.ts` table; 3a-1 owns the schema.** |
| `src/main/index.ts` | **Edit.** Construct the tracker after `storage`/`sessions`; wire `'focus'`/`'blur'`/`'minimize'`/`'restore'` on the main window and `webContents.on('did-finish-load')` inside `createWindow`; wire `powerMonitor` lock/unlock/suspend/resume; add a third `sessions.onExit` listener; `dispose()` in `before-quit`. |
| `src/main/ipc.ts` | **Edit.** `registerIpc` gains a fifth parameter (`attention`) — the 3-2 `vault` precedent — plus **two** `ipcMain.handle` registrations. Nothing else in the file changes. |
| `src/shared/ipc.ts` | **Edit.** Two `IpcChannel` entries (`AttentionReport`, `AttentionSummary`) and their request/response schemas. |
| `src/shared/ipc.test.ts` | **Edit.** Schema cases (see Test Expectations). |
| `src/preload/index.ts` | **Edit.** Two typed forwarders. Zod-free. |
| `src/renderer/src/attention/reporter.ts` | **Create.** Pure: `buildReport()` and `shouldReport(prev, next)` — the edge-trigger/dedupe logic, DOM-free so Vitest's `environment: 'node'` can test it. |
| `src/renderer/src/attention/reporter.test.ts` | **Create.** |
| `src/renderer/src/App.vue` | **Edit.** One `focusin` window listener, one `watch` on the three state facts it already owns, one initial report in `onMounted`. Removed on unmount. |
| `src/renderer/src/components/TerminalPane.vue` | **Edit.** **One attribute** — `:data-attention-session="sessionId"` on the terminal host element. Nothing else. |

Nothing else. **No migration, no new npm dependency, no UI component, no store.**

## Non-Goals

- **No board, no dispatch panel, no projection UI.** No seed loader, no graph validation, no readiness/fan-out/critical-path/float, no Monte Carlo, no ship-date card, no PM report, no pane task chip. Those are Mission Control spec phases 1–4 and roadmap Phase 8. This task ends at "the numbers are in SQLite and one channel can read them back".
- **No attention number may ship anywhere — UI, IPC response, log line, or export — without its sample count and its coverage figure travelling in the same object.** This is a hard bar, not a preference. `attention:summary` must make it structurally impossible to obtain minutes without the denominator: minutes are **derived from** `samples × tickSeconds`, and the response carries `samples`, `byClass`, `expectedSamples`, and `coveragePct` in the same record. A response shape that lets a caller read `minutes` alone is a review failure.
- **No timer UI, no start/stop control, no "am I still working?" prompt — ever.** §5.3: _"Do not ask the user to run a timer — that is the failure mode this is designed to avoid."_ A confirmation dialog is a timer wearing a hat.
- **No correction UI in this task.** §5.3's one-tap correction control needs a *task completion moment*, and Chorus has no tasks, no dispatches-with-outcomes, and no completion surface until the board ships. Building one here would mean building a fake completion screen to hang it on — the "dead UI" bar from Task 3-4. What this task owes the correction control instead is a **schema and read shape that make it purely additive later**: corrections are new rows with `source='correction'`, never edits to measured rows (see Dependencies). Name its home in the commit message.
- **No per-pane timer, no per-second tick, no renderer-side clock.** One `setInterval` in main, full stop — the 1b-2 `FilmstripRenderer` rule, one process further in. Ten panes must cost exactly the same as one.
- **No keystroke capture, no keystroke timing, no window titles of other applications, no process enumeration, no screenshots, no clipboard, no app-usage tracking outside Chorus.** `getSystemIdleTime()` returns an integer and tells us nothing about what was typed or where; nothing in this task may go looking for more.
- **Nothing leaves the machine.** No `fetch`, no telemetry endpoint, no analytics, no crash-reporter attachment, no sync. Grep-verifiable: the new modules contain no network call. The roadmap already fixes this — _"the plan is shared, the telemetry is personal"_, actuals are machine-local and gitignored.
- **Nothing is written into a transcript, ring buffer, or PTY.** This task does not touch `sessionOutput.ts`, `scrubber.ts`, or `SessionManager.spawn`'s data path. Attention records must never be visible to an agent.
- **No per-tick logging.** One boot line naming the cadence and the enabled state; nothing every 15 seconds. A per-tick log turns the log file into a second, unredacted behavioural record of the operator's day.
- **No migration, and no v8.** Task 3a-1 owns migration v7 and the attention table. If a column this task needs is absent, **raise it as a dependency finding and stop** — do not add a migration, do not widen 3a-1's DDL, do not "just add one column". The Phase-3 lesson (D48 putting a migration into the phase's most security-critical session) is the reason this boundary is drawn hard.
- **No FK from the attention table to `sessions`.** See Dependencies — this is a correctness ruling, not a shortcut.
- **No change to `focusedSessionId`, `view:get`/`view:set`, `viewStateSchema`, or `useViewStore`.** In particular: **do not "fix" `LayoutRenderer` to forward `TerminalPane`'s `focus` emit.** It is a real gap (see Initial Starting Point), but fixing it changes what gets *persisted* as the filmstrip's remembered pane, and that is a behaviour change to a shipped feature belonging in its own commit. Record it as a finding.
- **No `<KeepAlive>`, no change to the workspace ⇄ settings `v-if`.** Panes unmounting when settings opens is by design (3-4 spec §1); the tracker must classify that state, not prevent it.
- **No credential surface is read, dumped, echoed, or transmitted.** The real dev vault holds a real, billable OpenRouter key. `credential_profiles` is not touched by this task and must not appear in any dump, log, or `_verify/` artifact.
- **Do not revert, stage, delete, or commit the two untracked root files `TASK-3-5-REVIEW-FABLE.md` and `TASK-3-6-REVIEW-FABLE.md`.** They are not part of this task. Leave them exactly as found — untracked and unmodified.
- **Do not revert, stage, or commit any other unrelated or untracked file, including `_verify/` and anything under `docs/`.**
- **Do not remove the standing `wt-24b5c1fe` worktree row, directory, or branch `chorus/Chorus/24b5c1fe`.**

## Dependencies

### Task 3a-1 — the migration and the table (hard dependency)

3a-1 creates migration **v7** with the dispatch-telemetry tables, including `attention_spans` — **created empty, with 3a-2 named as its only writer.** Its schema is given; this task adopts it and **authors no migration of its own.**

**3a-1's drafted DDL, read 2026-07-24 from `ImplementationSpec-3a-1.md` §2.1** (re-read the *shipped* version before starting — a draft is not a commit):

```sql
CREATE TABLE attention_spans (
  id          TEXT PRIMARY KEY,
  dispatch_id TEXT,
  session_id  TEXT,
  project_id  TEXT,
  started_at  TEXT NOT NULL,
  ended_at    TEXT NOT NULL,
  seconds     INTEGER NOT NULL,
  source      TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
```

**Three things it already gets right, and they are the load-bearing ones:**

- **No FK anywhere.** 3a-1 states the rule outright — _"Opaque string, **no FK**… dangling afterwards, by design"_ — which is exactly what this task needs and for exactly the right reasons. **F16** makes foreign keys *enforced* on this DB (`PRAGMA foreign_keys` = 1); **D16 resolution d** makes pane close / `session:delete` **delete the session row**; and roadmap §7's Phase 8 note (c) spells out the consequence — telemetry _"must tolerate their session id disappearing rather than assuming referential integrity."_ With an FK, closing a pane would either throw or (with `ON DELETE CASCADE`) erase the very history the feature exists to accumulate. `focusedSessionId` is the standing precedent for a session id stored without a constraint (F4). **⚠ Verify the shipped DDL still carries no `REFERENCES` clause. If it does, that is a blocker — raise it, do not work around it.**
- **`session_id` and `project_id` are nullable**, so the per-project overhead bucket (`session_id` NULL, `project_id` set) has a home, per §5.3.
- **`source` already exists** with the vocabulary `'measured' | 'corrected'` — which is what makes §5.3's deferred one-tap correction purely additive later. **Adopt 3a-1's spelling `'corrected'`**; every row this task writes is `'measured'`.

### ⚠ Dependency finding — two columns this task needs that 3a-1's draft does not have

> **✅ RESOLVED BY THE COORDINATOR, 2026-07-24 — before v7 shipped, which is exactly what this boundary was drawn to make possible.** Both columns were added to `attention_spans` in `ImplementationSpec-3a-1.md`: **`class TEXT NOT NULL`** (the attention class the span was credited to — without it there is no denominator and the accounting identity below is uncomputable) and **`tick_seconds INTEGER NOT NULL`** (the cadence the span was accumulated at, so a later tick change cannot silently corrupt rows written under the old one). **This task therefore proceeds as written — do not raise it again, and still do not author a migration.** The finding is preserved below because the reasoning is what earned the amendment.

**Raise these against Task 3a-1 before either task is implemented. Do NOT author a v8, and do not work around them.** 3a-1 has not shipped, so amending its v7 DDL costs one line each and zero migrations; discovering the gap after v7 is on the real dev DB costs a second migration in a phase that has already paid that price once (D48).

| Column wanted | Why this task cannot do its job without it |
|---|---|
| `class TEXT NOT NULL` — `pane` \| `overhead` \| `blurred` \| `idle` \| `locked` | **This is the denominator.** Without it, only `pane` and `overhead` spans are representable, so the blurred / idle / locked ticks — the ones that say *how much of the window was not attention* — have nowhere to go. A measurement that records only its numerator cannot state its own uncertainty, and the Non-Goals bar on shipping a number without its sample count becomes unmeetable. The accounting identity in the focus-state table below is likewise unverifiable without it. |
| `tick_seconds INTEGER NOT NULL` | `seconds` is credited as `samples × 15`; a later cadence change would silently alter what historical rows mean. Recording the cadence per row makes a cadence change visible in the data instead of retroactively rewriting it. **Acceptable fallback if 3a-1 declines it:** keep the cadence a hard constant and bar changing it without a migration — say so in the module header rather than leaving it implicit. |

**`seconds` rather than `samples` is 3a-1's call and this task accepts it.** The two are the same fact in different units (`samples = seconds / TICK_SECONDS`), and 3a-1's rationale is sound: a correction changes the number without changing the interval, so the number must be stored rather than derived from `ended_at - started_at`. This task therefore credits **`seconds += TICK_SECONDS`** per tick and derives sample counts on read — **never** from `ended_at - started_at`, whose divergence from `seconds` is the coverage signal (§6 of the spec doc).

- **`dispatch_id` is left NULL by this task.** The sampler records `(project_id, session_id, class)` and **never a task id or dispatch id.** Resolving session → dispatch → task is a **read-time join**, consistent with Mission Control's organising principle (_"derived, never stored"_) and with the fact that a restored session is a genuinely fresh conversation under the same row id. This keeps 3a-2 buildable against whatever shape 3a-1's dispatch records finally took, and it means an attention span is never orphaned by a dispatch that closed early.
- **No new npm dependency.** `powerMonitor` and `BrowserWindow` are Electron; the rest is Node timers and existing Drizzle accessors.
- **Electron 43.1.1 typings verified this session** for `getSystemIdleTime`, `getSystemIdleState`, and the `@platform darwin,win32` lock events. Per **D4**, re-confirm behaviour at execution time — typings are a contract, not evidence that Windows populates `'locked'`.

## Step-by-step Work

1. **Reconcile with 3a-1's shipped schema first, and settle the two-column finding.** Read the v7 DDL as committed (not as drafted). Confirm no `REFERENCES` clause on `session_id`. Confirm whether `class` and `tick_seconds` were added per the Dependencies finding — **if `class` is absent, stop and raise it**; the honesty guarantees this task is built on are not implementable without it, and a v8 is not the answer.
2. **Pre-flight the instrument before building on it (see Verification Commands, "Step 0").** Establish, on this machine, (a) whether CDP-injected input resets the Windows idle timer, and (b) whether `getSystemIdleState()` reports `'locked'` here. Both answers change how the runtime proof is driven, and guessing either one invalidates every later measurement. Record the answers in the commit narration.
3. **`attentionCore.ts`** — the pure core, written to the focus-state table below and the tick-accounting rules in the spec doc §4. Write its tests alongside; this is the only part of the feature that unit tests can reach, so it must carry all the logic worth testing.
4. **`attention.ts`** — the Electron seam. One `setInterval`. One `powerMonitor` read per tick. The last renderer report held in a field, with a `stale` flag. Every decision delegated to the core.
5. **Storage accessors** in `storage.ts`, following the `saveWindowBounds` / `setViewState` inline-Drizzle idiom, with the same defensive-read discipline (a corrupt row yields a default, never a throw).
6. **IPC** — two channels, schemas in `src/shared/ipc.ts`, handlers in `registerIpc`, forwarders in preload. **D14**: the renderer's report is built from primitives into a fresh object literal; if any field ever becomes store-sourced it needs `JSON.parse(JSON.stringify(...))`.
7. **`reporter.ts`** — the pure dedupe, then the ~15 lines of App.vue wiring and the one `TerminalPane` attribute.
8. **Kill switch** — an `attention_capture_enabled` key in `settings` (default on, read at boot and honoured live). This records how long a human sat at a screen; it gets an off switch, and the off switch is ten lines.
9. **Tests**, then `npm run typecheck` / `npx vitest run` / `npm run grep:secrets`.
10. **Runtime-verify (G2)** per Verification Commands. The scripted sequence with expected attributed minutes is this task's acceptance gate — **this is behaviour that cannot be verified by compiling.**

## The Focus-State Table — what counts as "focused on a pane"

Every state below is separately observable, and each gets one ruling. **This table is the specification of `classify()` and it maps one-to-one onto test cases.**

Precedence is evaluated **top to bottom, first match wins**: `locked` → `idle` → `blurred` → `overhead` → `pane`.

| # | Observable state | How it is observed | Class | Counts toward | Why |
|---|---|---|---|---|---|
| 1 | Workstation locked | `powerMonitor` `'lock-screen'` (win32-typed) latched, cross-checked by `getSystemIdleState()` | `locked` | **nothing** | Unambiguous absence. Ranked above `idle` because it is a *stronger* statement than "untouched", and separating them makes "walked away" distinguishable from "locked up and left". |
| 2 | System suspended / resuming | `powerMonitor` `'suspend'` / `'resume'` | `locked` | **nothing** | Same category, and the resume tick is additionally flagged as a **gap** so wall-time and sample-time divergence is visible. |
| 3 | OS idle ≥ 60 s | `getSystemIdleTime() >= 60` | `idle` | **nothing** | §5.3's mandated threshold, verbatim. Beats blur so that `blurred` retains its precise meaning: *machine in active use, elsewhere*. |
| 4 | Window blurred — another app on top | `BrowserWindow` `'blur'` | `blurred` | **nothing — not even overhead** | §5.3 scopes the overhead bucket to _"time spent **in Chorus**"_. Another app on top is not in Chorus. Recorded (not dropped) so the histogram can show how much of the day happened elsewhere. |
| 5 | Window minimized | `'minimize'` (and `'restore'`) | `blurred` | nothing | Same ruling as 4; minimize is blur with the window gone. |
| 6 | Window focused · workspace view · a terminal host holds DOM focus | renderer report, from a `focusin` walk to `[data-attention-session]` | **`pane`** | **that session** | The one state that counts. Requires *both* halves: main knows the window has focus, the renderer knows which terminal has DOM focus. Neither alone is sufficient. |
| 7 | Window focused · workspace view · focus on chrome (tab bar, header buttons, filmstrip cards, splitter, `<body>`) | renderer reports `activeSessionId: null` | `overhead` | **project overhead** | §5.3's _"reviewing the board, reading diffs"_ bucket. The `data-attention-session` attribute sits on the **terminal host**, not the pane card, so header/split-button clicks land here by construction. |
| 8 | Window focused · settings view open (`activeView === 'settings'`) | renderer reports `view: 'settings'` | `overhead` | project overhead | Configuring Chorus is Chorus work, not task work. It is also the state where every `TerminalPane` is unmounted (3-4 spec §1), so there is no pane to attribute to even if we wanted one. |
| 9 | Window focused · an overlay is open (launch dialog / palette / worktree panel) | renderer reports `overlayOpen: true` (App's existing `anyOverlayOpen`) | `overhead` | project overhead | The overlay owns the keyboard; no pane is being worked in. Note the trap: an overlay can be open **while** a terminal still holds DOM focus underneath, so `overlayOpen` must be checked **before** `activeSessionId`. |
| 10 | Window focused, but the focused pane's session has **exited** | third `sessions.onExit` listener clears `activeSessionId` when it matches | `overhead` | project overhead | Reading a dead pane's scrollback is real work, but it is not work *the agent is doing*; crediting it to the session would inflate that dispatch's cost after the dispatch ended. Ruled to overhead **knowingly**, and named as a known bias in the spec doc. |
| 11 | Window focused, but the renderer report is **stale** (reload / HMR / pre-mount) | main clears its report on `webContents` `'did-finish-load'` | `overhead` | project overhead | Fail toward the bucket that cannot corrupt a per-task number. At most one or two ticks. |
| 12 | No active project | `projectStore.activeId === null` | `overhead` with `project_id` unresolved → **row suppressed** | nothing | There is no bucket to put it in. Suppress rather than invent a project. |
| 13 | Capture disabled by the user | `attention_capture_enabled = false` | — | nothing | The tick still fires (so the setting is live) but writes nothing. |

**The accounting identity that falls out of this table — and the single best correctness check in the whole task:**

```
samples(pane) + samples(overhead) + samples(blurred) + samples(idle) + samples(locked)
  == total ticks the tracker fired in the window
```

Every tick lands in exactly one class. No tick is silently dropped. This identity is checkable at any scale, in a unit test and against the real DB, and it catches the entire family of "the number looks plausible but something is quietly vanishing" bugs.

## Test Expectations

**Unit (Vitest), `src/main/services/attentionCore.test.ts`** — the pure core carries all the logic, so it carries all the tests:

- **One case per row of the focus-state table**, asserting both the class and the resolved slot (`projectId`, `sessionId`). Thirteen rows, thirteen cases, named after the row.
- **Precedence cases** — states that satisfy several rows at once resolve to the higher one: locked *and* idle → `locked`; idle *and* blurred → `idle`; blurred *and* a pane focused → `blurred`; overlay open *and* a pane focused → `overhead` (row 9's trap).
- **Idle boundary is exact:** 59 → counts, 60 → `idle`. The threshold is `>=`; assert the seam rather than a value comfortably either side of it.
- **Tick accounting — the crash-safety and sleep properties:**
  - Same slot on consecutive firings **extends** one run (`samples + 1`, `ended_at` advances); a changed slot **closes** the run and opens a new one.
  - A firing that arrives 10 minutes late (laptop lid, suspended timer) credits **exactly one** sample and sets the gap flag. **Never credit wall-clock deltas.**
  - Property: over any sequence of firings, `credited seconds == samples × TICK_SECONDS`, exactly. This is the invariant that makes suspend, sleep, and clock skew unable to inflate the number.
- **The accounting identity** holds over a synthesized firing sequence covering every class.
- **`coverage()`** reports `expectedSamples` from the run span, `missingSamples` from the difference, and a `coveragePct` that is honest for a window with a crash-shaped hole in it.
- **No retro-debit:** an inactive stretch credits its first ≤60 s and the credit is **never revoked** by later ticks. Assert the exact expected sample count for a 3-minute no-input stretch at a 15 s cadence (4 counted, 8 idle) — this is the biggest known bias and it must be pinned by a test so it cannot drift silently.

**Unit (Vitest), `src/renderer/src/attention/reporter.test.ts`:**

- `shouldReport` is **edge-triggered**: identical consecutive reports produce no send; any field change produces exactly one.
- `buildReport` emits a **plain object literal of primitives** — assert `Object.getPrototypeOf(r) === Object.prototype` and that every value is a primitive or `null`. This is the D14 trap made into a test rather than a comment.

**Unit (Vitest), `src/shared/ipc.test.ts`:**

- The two new channel strings are present and unique in `IpcChannel`.
- The report schema rejects a non-uuid `sessionId` and **accepts `null`**; the summary response schema **requires** `samples`, `byClass`, `expectedSamples`, and `coveragePct` — i.e. a response carrying minutes without its denominator fails to parse. Write this as a negative test: construct a denominator-less object and assert the parse throws. That is the Non-Goals bar made structural.

**No test may contain real credential material**, and `npm run grep:secrets` must still pass.

**Runtime (G2)** carries everything unit tests structurally cannot: that `getSystemIdleTime` behaves as documented on this machine, that window focus events fire in the order assumed, that the renderer's DOM-focus walk resolves the right pane in **both** filmstrip and grid, and that the attribution is *correct* rather than merely self-consistent.

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
powershell -File _verify/launch.ps1 -Log _verify/3a-2/boot1.log
```

`_verify/launch.ps1` restores `ComSpec`/`PATH` from the registry (the harness strips them) and starts electron-vite dev with `--remote-debugging-port=9222`, printing the root PID. Drive the window with the `_verify/3-6/cdp35.js` harness pattern (`node cdp35.js eval <expr-file> [out.json]` · `shot` · `typefile` · `enter` · `watch`); wrap every `Runtime.evaluate` body in an IIFE (top-level `const` collides across evaluates).

### ⚠ Step 0 — pre-flight the instrument, before measuring anything with it

**This measures the measuring device, and skipping it invalidates every number after it.**

1. **Does CDP-injected input reset the Windows idle timer?** `Input.insertText` and `Input.dispatchKeyEvent` deliver events into Chromium, not through the OS input stack — so `GetLastInputInfo` (which `getSystemIdleTime()` wraps) **may not see them at all**. If it does not, a CDP-driven "user typing" phase will classify as `idle` and every attribution phase below will read zero. **Probe:** with the app focused, drive CDP input every 10 s for 90 s while sampling `getSystemIdleTime()`; if it climbs past 60, CDP input is invisible to the OS timer and **all "typing" phases below must be driven with real OS input** (the `user32` `SendInput` helper pattern) rather than CDP. **Record the answer as a verified fact either way — do not assume it.**
2. **Independent oracle.** Read the same OS counter from *outside* Electron with a small PowerShell `GetLastInputInfo` P/Invoke (`_verify/3a-2/idle.ps1`). Agreement between it and `getSystemIdleTime()` is what proves the Electron reading is the OS reading and not something Electron computes about its own window.
3. **Does `getSystemIdleState()` report `'locked'` on this machine?** The typings say `'locked'` is _"available on supported systems only"_. Lock the workstation (`rundll32 user32.dll,LockWorkStation`), read after unlock. If it never reports `'locked'`, say so — row 1 then rests on the `'lock-screen'` event alone, which is a smaller claim and must be documented as such.

### The scripted focus/idle sequence — this task's acceptance gate

Boot with **two panes** (A and B) in one project, note the wall-clock start, and run the phases below back to back. At a 15 s cadence each 75 s phase is **5 ticks ±1**. Dump the attention rows afterwards and compare against the expected column. **"It looks right" is not a result; the table below with real numbers in it is.**

| Phase | Duration | Action | Expected rows |
|---|---|---|---|
| 1 | 75 s | Focus pane **A**'s terminal; real input every ~10 s | `class=pane`, `session_id=A`, **5 ±1** samples |
| 2 | 75 s | Focus pane **B**'s terminal; real input every ~10 s | `class=pane`, `session_id=B`, **5 ±1**; A does **not** grow |
| 3 | 75 s | Click the top bar / open **Settings**; keep the machine active | `class=overhead`, `session_id=NULL`, **5 ±1** |
| 4 | 75 s | Focus **another application** and type in it | `class=blurred`, **5 ±1**; A, B and overhead all **frozen** |
| 5 | 180 s | Focus pane **A**, then touch nothing at all | `class=pane` A **4 ±1** (the first ≤60 s), then `class=idle` **8 ±1**. *The ruling-3 proof — quote the real counts.* |
| 6 | — | Repeat phase 1 in **grid** view instead of filmstrip | attribution identical; **this is the `LayoutRenderer` gap proof** |
| 7 | — | `taskkill /PID <root> /T /F` mid-run, then cold boot | the open run's `ended_at` is within **one tick (15 s)** of the kill instant — quote the delta in seconds |
| 8 | — | Lock the workstation ~60 s, unlock (run **last**) | `class=locked`; or a recorded "not observable on this machine" per Step 0.3 |

**Then assert, against the dumped rows:**

- **The accounting identity holds** across the whole drive: every tick the tracker fired is in exactly one class, and the total matches elapsed wall time minus the recorded gaps.
- **A ≈ 2.25 min, B ≈ 1.25 min, overhead ≈ 1.25 min**, each within one tick. State the actual figures.
- **`attention:summary` returns minutes and the denominator together** — dump the full JSON and confirm `samples`, `byClass`, `expectedSamples`, `coveragePct` are all present and internally consistent.
- **Cost:** with two panes, then with four, the tick count per minute is **identical** (one clock, not one per pane). Prove it by row count, not by reading the code.
- **Privacy:** grep the whole drive's boot logs for any per-tick line, any session content, any window title, and any key material — zero hits. Confirm no `fetch`/network call exists in the new modules.

**⚠ The `sqlite3` CLI is NOT installed.** Dump with the `ELECTRON_RUN_AS_NODE` pattern (`_verify/2-1-dump.js` / `_verify/3-6/dump-v6.js`); write results to a file (these scripts print nothing to a console); **known flake: no file on first invocation — retry once**; and **quote the `projects` table in every dump (F20)** so the coordinator can tell the real dev DB from a redirected one. **Never dump `credential_profiles`.**

**Harness reminders:** electron-vite HMR covers the **renderer only** — this task's clock lives in main, so **every timing check needs a real cold boot**. Kill process **trees** (`taskkill /PID <root> /T /F`). Write all artifacts under `_verify/3a-2/`.

## Acceptance Criteria

- [ ] `npm run typecheck` — zero errors (G1).
- [ ] `npx vitest run` — green; the then-current baseline intact and grown by the two new test files.
- [ ] `npm run grep:secrets` — clean (G4).
- [ ] **The focus-state table is implemented exactly as written**, with one passing test per row and the precedence cases green.
- [ ] **The accounting identity holds** in a unit test *and* against the real dev DB after the scripted drive.
- [ ] **The scripted sequence produces the expected attributed minutes** within one tick per phase, with the actual numbers quoted — including the grid-view repeat (phase 6).
- [ ] **Crash-safety is demonstrated, not argued:** a tree-kill mid-run loses at most one tick, with the measured delta in seconds quoted.
- [ ] **No attention number is obtainable without its sample count** — proven structurally (the schema negative test) and at runtime (the full `attention:summary` dump).
- [ ] **One clock:** exactly one `setInterval` exists in the new code, and the per-minute row rate is independent of pane count.
- [ ] **Idle semantics are stated in the code, not just in this doc** — the module header says plainly what `getSystemIdleTime()` measures, what it cannot distinguish, and in which direction the number is biased.
- [ ] **Step 0's three pre-flight answers are recorded as verified facts**, including "CDP input does/does not reset the OS idle timer" and whether `'locked'` is observable here.
- [ ] **Privacy holds:** local-only, no network call, no per-tick log line, nothing in any transcript or ring buffer, and a working off switch.
- [ ] **No migration in the diff.** No `MIGRATIONS` entry, no DDL, no schema.ts table.
- [ ] **The two untracked `TASK-*-REVIEW-FABLE.md` files are still untracked and unmodified** — confirm with `git status` in the commit narration.
- [ ] The standing `wt-24b5c1fe` worktree row, directory, and branch are **untouched**.
- [ ] **One** narrated commit (G3), touching only the Exact Scope files.

## Review Checklist

- [ ] **Read `classify()` against the table row by row.** A ruling silently changed in code (blur counted as overhead; the overlay check placed after the pane check) produces numbers that still look plausible — which is exactly why it needs reading rather than testing alone.
- [ ] **Confirm nothing derives credited time from a wall-clock delta.** Search the new modules for subtraction of two timestamps feeding a duration. Credited time must be `samples × tickSeconds` and nothing else; a single `now - lastTick` accumulator reintroduces the sleep-inflation bug the property test exists to prevent.
- [ ] **Confirm the run row is written on every tick, not on transition.** Extend-in-place is what makes the tree-kill lose 15 s instead of an hour. A design that only writes on slot change passes every unit test and fails the one thing that matters.
- [ ] **Check for an FK on `session_id`** in 3a-1's shipped DDL, and check that closing a pane with attention history recorded does not throw and does not erase rows. Do this with a real pane close, not by reading the schema.
- [ ] **Verify the pure core imports nothing from `electron`, `better-sqlite3`, `drizzle-orm`, or `../db/schema`** — grep the import block. The `restore.ts`/`vaultCore.ts` bar, enforced by `vitest.config.ts`'s ABI constraint.
- [ ] **Check the `data-attention-session` attribute is on the terminal host, not the pane card** — otherwise row 7 collapses into row 6 and every header click becomes task attention.
- [ ] **Check the renderer report is edge-triggered**, not sent on a timer or on every render, and that the listener is removed on unmount.
- [ ] **Check `LayoutRenderer` was NOT modified.** The grid-mode focus-emit gap is a recorded finding for its own commit; a drive-by fix here changes persisted view state.
- [ ] Read the summary response shape asking: *can a caller get minutes without the denominator?* If yes, it is not done.
- [ ] Confirm the uncertainty is surfaced in the **data**, not only in a comment — `byClass` and `coveragePct` are fields, and the idle-bias direction is stated where a consumer will read it.
- [ ] No untracked / `_verify/` / `docs/` files staged or reverted; `TASK-3-5-REVIEW-FABLE.md` and `TASK-3-6-REVIEW-FABLE.md` still untracked.
- [ ] No `credential_profiles` content anywhere in the diff, the logs, or `_verify/3a-2/`.
