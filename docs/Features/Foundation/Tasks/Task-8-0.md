# Task 8-0 — Turn Boundary Capture

_Mission Control's spec-Phase-0 telemetry capture, **continued** — pulled forward on the same asymmetric-decay argument D50 used for Task 3a-1, and for the same reason: **this data cannot be backfilled.** **One narrated commit (G3).** **This task does NOT start Phase 8.** It ships no board, no seed, no estimate and no UI, exactly as 3a-1 and 3a-2 shipped none. This task governs scope; `ImplementationSpecs/ImplementationSpec-8-0.md` governs exact contents._

> **⚠ HELD ON A MIGRATION NUMBER — READ THIS FIRST, AND DO NOT ASSUME A NUMBER.**
>
> **This task is NOT v16. Phase 6 has v16 reserved** — its roadmap entry states outright: _"The next free version is `v16` and the assertion is `MIGRATIONS.length + 1 === 16`."_ `MIGRATIONS.length` was **15** on `main` at `fd41f98` (2026-08-08), so v16 belongs to Phase 6 and this task takes **whatever is free once Phase 6 lands — expect v17**.
>
> **The number written in this doc is deliberately not a number.** The Phase 6 entry records that its own pinned version has already decayed **twice** while it waited. The standing rule outranks any figure either doc quotes: **confirm `MIGRATIONS.length + 1` at the moment of writing and STOP ON DIVERGENCE rather than renumbering.**
>
> Ratified by Matthew 2026-08-08: docs now, implementation once Phase 6's schema position is settled.

## Source Of Truth

- `docs/Features/Mission Control/chorus-mission-control-spec.md` — **§4.1** (a **Dispatch** is _"one execution attempt of a task by one agent in one pane"_), **§5.2** (wall-clock from pane lifecycle), **§6.3** (estimation reads `(kind, size, owner)` against historical actuals), **§9 Phase 0** (_"No UI. No board. Just start recording…"_, and its rationale: _"historical actuals cannot be backfilled"_).
- Roadmap §6 **D41** (Mission Control admitted as provisional Phase 8; telemetry slice pulled forward), **D50** (asymmetric decay — telemetry is opening work, not closing work), **D55** (no number ships without its denominator), **D129** (the filmstrip's four states; the hook listener exists and `Stop` is load-bearing), **D130** (the listener's security model, and the **read-only-`hook_event_name`** rule this task must not widen).
- Roadmap §7 Phase 8 note **(c)** — pane close deletes the session row (D16 resolution d), so a telemetry row **must tolerate its session id disappearing**. No FK. Same ruling as 3a-1 and 3a-2.
- Precedent this task copies almost exactly: `src/main/services/dispatches.ts` (`DispatchRecorder`) — open on an announcement, close on an announcement, heal orphans at boot, `safely()` around every write.
- Precedent for the pure/impure split and the Vitest constraint: `attentionCore.ts` / `attention.ts`, and `vitest.config.ts`'s header (tests never import `storage.ts` or `better-sqlite3`; the native binding is built for the Electron ABI while Vitest runs under Node).

## Why this task exists — the finding that produced it

**Verified against the real telemetry stores, 2026-08-08.** Across 172 dispatches spanning 2026-07-27 → 2026-08-08 (9 distinct working days, projects Chorus / Chorus-Second / TR-Integration):

| Fact | Measured |
|---|---|
| Dispatches reaching `outcome='completed'` | **5 of 172** |
| Dispatches closed `abandoned/boot-heal` (end never observed) | **93** of the 131 in the largest store |
| Mean wall-clock of *closed* dispatches | **74–134 min** by agent; **max 557 min** |
| `task_id` populated | **0** (by design — no seed exists) |
| Pane-class attention spans joinable to a dispatch | **156** spans × 15 s = **~39 min**, total, across 12 days |

**The capture layer is not broken. The unit is wrong.** A dispatch is one PTY lifetime, and an interactive agent pane has no natural completion event — the human closes it, kills it, or quits the app, so `abandoned` is the honest and dominant outcome and `ended_at - started_at` measures *how long a terminal was open*, not how long work took. A 9.3-hour dispatch is a pane left open over lunch. **No amount of fixing `classifyOutcome` changes this**; it is already correct (`dispatches.ts:33`), and boot-heal's `ended_at = NULL` is deliberately an honest "we never saw when" rather than an invented timestamp.

**Meanwhile the right unit already arrives and is discarded.** `services/agentEvents.ts` receives Claude Code's own lifecycle hooks over the authenticated loopback listener D130 built, classifies them to `working` / `needs-you` (`agentEventsCore.ts:101`), and holds the result in an **in-memory `Map`** to drive the filmstrip lights. A `working → needs-you` transition is `Stop`; a `needs-you → working` transition is `UserPromptSubmit`. **That pair is exactly one turn: an observed start and an observed end.** Nothing persists it. Every day it stays unpersisted is a day of estimator calibration permanently lost — which is D50's argument, landing on a second table.

## Goal

Persist the boundaries of agent **turns**, so Mission Control's estimator has a unit of work with a real start and a real end — without widening what the hook listener reads, and without asking the human for anything.

The estimator's question is _"how long does a task of this kind and size take?"_. A turn is the smallest honest answer available today: bounded by two observed events, attributable to a session, and countable. A dispatch is not, and this task does not pretend otherwise — it **adds** a granularity rather than repairing one.

## Exact Scope

| File | Change |
|---|---|
| `src/main/db/schema.ts` | **Edit.** Add the `agentTurns` table. Same no-FK rule as `dispatches` and `attention_spans`, for the same D16-resolution-(d) reason. |
| `src/main/services/storage.ts` | **Edit.** One migration at **the next free version** — `MIGRATIONS.length + 1`, computed at the moment of writing, **not** a number copied from this table (see the banner) — plus accessors: `openAgentTurn(row)`, `closeAgentTurn(id, endedAt)`, `listOpenAgentTurns()`, `getOpenTurnForSession(sessionId)`, `readAgentTurns(projectId, fromIso, toIso)`. |
| `src/main/services/turnsCore.ts` | **Create.** The **pure** core: the activity-transition → turn-event mapping, and the boot-heal classification. No `electron`, no `better-sqlite3`, no `Date.now()` — time arrives as a parameter. |
| `src/main/services/turnsCore.test.ts` | **Create.** One case per transition, plus the orphan and idempotency suites. |
| `src/main/services/turns.ts` | **Create.** The seam: `createTurnRecorder(storage) → TurnRecorder` with `attach(agentEvents, sessions)`, `healOrphansAtBoot()`, `closeOpenOnQuit()`. Modelled line-for-line on `dispatches.ts`. |
| `src/main/services/turns.test.ts` | **Create.** The `dispatches.test.ts` fake-storage pattern. |
| `src/main/index.ts` | **Edit.** Construct the recorder beside `dispatches`; `healOrphansAtBoot()` **before** restore; `attach(agentEvents, sessions)`; `closeOpenOnQuit()` in `before-quit`. |

Nothing else. **No IPC channel, no preload forwarder, no renderer file, no npm dependency, no UI.**

## Non-Goals

- **No board, no dispatch panel, no seed loader, no readiness/critical-path/float, no Monte Carlo, no ship-date card, no PM report, no pane task chip.** Spec §9 Phase 0 is explicit: _"No UI. No board."_ This task ends at "turn rows are in SQLite".
- **⚠ THE HOOK LISTENER'S READ SURFACE DOES NOT WIDEN BY ONE FIELD.** D130's rule stands verbatim: _"only `hook_event_name` is read — no prompt text, no transcript path, no tool input is extracted, stored or logged, because what is not taken cannot leak."_ This task consumes the **already-classified** `onActivity` callback (`sessionId`, `activity`) and stamps its own timestamp. **It must not parse a hook body, must not add a field to `readHookEventName`, and must not store `last_assistant_message`.** A turn row contains no content of any kind.
- **No tool-call count in this task.** `record()` in `agentEvents.ts` is **edge-triggered** — consecutive `PreToolUse`/`PostToolUse` events all classify to `working`, so only the first fires a listener and a count is not observable from `onActivity`. Obtaining one means touching the hook path, which is the previous bullet. **Named home: whichever task first needs turn *size* rather than turn *duration*.** Record it as a finding; do not smuggle it in.
- **No change to `agentEvents.ts`, `agentEventsCore.ts`, the classification sets, or the filmstrip lights.** `onActivity` is `Set`-backed and additive — adding a second listener is the established idiom (`sessions.onExit` has three). If a turn cannot be derived without changing the classifier, **raise it and stop**.
- **No inference of turns for agents that have no hook bus.** `codex`, `kimi` and `opencode` get no hook config (`sessions.bindHooks` is Claude-only), so they produce no turns. **They must not be given estimated, interpolated or PTY-derived turns** — that is a fabricated number wearing a real column. D129 already enforces the same asymmetry for the lights: _"an agent with no hook bus keeps exactly three states"_.
- **⚠ No turn count, duration or rollup may ship anywhere without its coverage denominator (D55).** Any future reader must be able to say *"turn data covers N of M dispatches"*. This task ships no reader, so the obligation it carries forward is **schema-level**: the coverage figure must be computable from the rows alone. See the Implementation Spec.
- **No back-filling, no reconstruction from transcripts, ring buffers, or `~/.claude/projects` JSONL.** History before this commit does not exist and must not be invented. `subscriptionMeter.ts` reads those logs for *tokens* under an explicit `tokens_source='cli-logs'` label; turns get no such degraded path.
- **No writes to `dispatches` or `attention_spans`.** This task adds a table; it does not edit 3a-1's or 3a-2's.
- **No `dispatch_id` or `task_id` column written.** Resolving session → dispatch → task is a **read-time join**, exactly as `attention.ts:312` rules for spans ("derived, never stored"). A turn that outlives its dispatch must not be orphaned by a stored pointer.
- **Nothing leaves the machine.** No `fetch`, no endpoint, no analytics. The new modules must contain no network call, grep-verifiable.
- **No per-turn logging beyond one boot line.** A per-turn log line is a second, unredacted record of when the operator was working.
- **Do not revert, stage, or commit unrelated or untracked files**, including anything under `_verify/` and `docs/`.

## Dependencies

### The hook listener (hard dependency — already shipped)

`agentEvents.ts` is built, secured and runtime-verified (**D129**, **D130**). This task needs three things from it, all of which exist today:

1. `onActivity(listener): () => void` — edge-triggered, `Set`-backed, additive.
2. Per-session attribution **by capability token, never by payload** (D130), so a turn's `session_id` is trustworthy.
3. `revoke()` on every exit path, so a dead session stops producing transitions.

**It also imposes the task's sharpest constraint:** because `record()` fires only on *change*, the listener sees a clean alternation and never a burst. That is what makes turn derivation a two-state machine rather than an event parser — and it is why this task is small.

### Migration ordering (hard, and currently BLOCKING)

`MIGRATIONS.length` was **15** on `main` at `fd41f98` (2026-08-08). **Phase 6 has v16 reserved by its own roadmap entry**, so this task is **not** v16 — it takes the next free number once Phase 6 lands, which is **expected to be v17 and must not be assumed to be v17**. Phase 6's entry records its own version decaying twice while it waited; the same will happen here if the number is trusted rather than recomputed. **Confirm `MIGRATIONS.length + 1` before appending; stop on divergence.**

### What this task does NOT depend on

- **Not on the telemetry consolidation.** The five scattered stores (see the Phase 8 roadmap note and `_verify/mission-control/merge-telemetry.py`) are a *history* problem; this task is a *capture* problem. Either can land first.
- **Not on a task seed.** `task_id` stays unwritten until Phase 8 proper, exactly as it does on `dispatches`.

## Test Expectations

Pure-core cases (`turnsCore.test.ts`), each a table row:

| Transition | Expected |
|---|---|
| `null → working` | open a turn |
| `needs-you → working` | close nothing, open a turn |
| `working → needs-you` | close the open turn |
| `working → working` | unreachable via `onActivity` (edge-triggered) — asserted, so a later change to `record()` breaks a test rather than silently double-opening |
| `needs-you → needs-you` | as above |
| session revoked mid-turn | the open turn is closed by the session's exit, not left dangling |

Recorder cases (`turns.test.ts`, fake storage per `dispatches.test.ts`):

- A second `healOrphansAtBoot()` does **not** re-touch an already-healed row (history is not rewritten).
- `closeOpenOnQuit()` is idempotent.
- A storage throw is swallowed and logged, never propagated — telemetry may lose a data point, it may never fail a session.
- A turn whose session id no longer resolves still reads back (no FK).

## Acceptance Criteria

1. `npm run typecheck` exits 0; `npx vitest run` passes with the new files included; `npm run grep:secrets` clean.
2. The migration — **at whatever version `MIGRATIONS.length + 1` yielded**, recorded in the commit message — applied to the **real dev DB** through the full three-dump protocol (pre / post / post-restart), with the dumps kept under `_verify/8-0/`.
3. **Driven on the running app, not reasoned:** launch a `claude` session, send one prompt, wait for the amber `Stop`, and show **one** turn row with a non-null `started_at` and `ended_at` whose duration matches the observed turn to within one second.
4. A second prompt in the same session produces a **second** turn row, proving turns are per-turn and not per-session.
5. A `codex` (or other hookless) session produces **zero** turn rows, and this is shown rather than assumed.
6. A tree-kill mid-turn leaves an open row; the next boot heals it to a recorded outcome with `ended_at` NULL — the `dispatches` boot-heal shape, verified the same way.
7. The coverage figure is computable from the rows alone: for the dispatch window, "turns exist for N of M dispatches" can be answered by SQL with no extra column.

## Review Checklist

- [ ] No hook body is parsed anywhere in the new code; `hook_event_name` remains the only field read (D130).
- [ ] No `REFERENCES` clause on the new table (D16 resolution d).
- [ ] No `dispatch_id` / `task_id` column written (read-time join, `attention.ts:312`).
- [ ] No turn is produced for an agent without a hook bus.
- [ ] `MIGRATIONS.length + 1` confirmed before appending.
- [ ] Every write is wrapped in the `safely()` discipline.
- [ ] No network call in the new modules.
- [ ] `agentEvents.ts` and `agentEventsCore.ts` are byte-identical to HEAD.
