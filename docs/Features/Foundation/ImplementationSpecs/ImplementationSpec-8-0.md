# Implementation Spec 8-0 — Turn Boundary Capture

_Governs exact contents. `Tasks/Task-8-0.md` governs scope; where they disagree, the task doc wins on **what** and this doc wins on **how**._

> **⚠ BLOCKED ON A MIGRATION NUMBER, AND THIS SPEC DELIBERATELY NAMES NONE.** `MIGRATIONS.length` was **15** on `main` at `fd41f98` (2026-08-08). **v16 is Phase 6's** — its roadmap entry reserves it explicitly — so this task takes the next free number afterwards, **expected to be v17 and not to be assumed**. Compute `MIGRATIONS.length + 1` at the moment of writing and **stop on divergence**; do not renumber, do not "just append". Below, `vNN` means that computed number.

---

## 1. The unit, stated precisely

A **turn** is the interval between an agent taking the ball and giving it back:

```
UserPromptSubmit ────────────────────────────────► Stop
   (classifies 'working')                      (classifies 'needs-you')
   turn OPENS                                     turn CLOSES
```

The recorder never sees those event names. It sees `agentEvents.onActivity(sessionId, activity)` with `activity ∈ {'working', 'needs-you'}`, already classified by `agentEventsCore.classifyHookEvent` — which is what keeps D130's read surface unchanged.

**⚠ The alternation is guaranteed by `record()`'s edge trigger, and the code must depend on that rather than re-deriving it.** `agentEvents.ts:109` returns early when `activity.get(sessionId) === next`, so a turn's twenty `PreToolUse`/`PostToolUse` events produce **one** `'working'` callback, not twenty. This is why the core is a two-state machine and not an event buffer.

---

## 2. Schema — migration vNN

Appended to `MIGRATIONS` in `src/main/services/storage.ts`, with a comment block in the established v7/v8 register:

```sql
CREATE TABLE agent_turns (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL,
  project_id  TEXT,
  agent       TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  ended_at    TEXT,
  outcome     TEXT,
  closed_by   TEXT,
  source      TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX agent_turns_open    ON agent_turns (outcome, session_id);
CREATE INDEX agent_turns_session ON agent_turns (session_id, started_at);
```

Column rulings, each with its reason:

| Column | Ruling |
|---|---|
| `session_id` | **`NOT NULL`, but no `REFERENCES`.** FKs are enforced (F16) and pane close deletes the sessions row (D16 resolution d) — a `REFERENCES` would make the next pane close throw inside `session:delete`. Opaque string, exactly as on `dispatches`. |
| `project_id` | Nullable. Read from the sessions row **at open time**; a session whose row has already gone yields NULL rather than blocking the write. |
| `agent` | Denormalised on purpose. The sessions row can disappear, and a turn that cannot say which agent produced it is useless to an estimator keyed on `(kind, size, owner)` (spec §6.3). |
| `ended_at` | **NULL means the end was never OBSERVED** — the `dispatches` convention verbatim (`schema.ts:228`). Duration consumers filter `ended_at IS NOT NULL`; count consumers do not. |
| `outcome` | **NULL means OPEN.** `'completed'` (a `Stop` was seen) \| `'abandoned'` (healed or quit). The `dispatches` §4.3 property, reused so one predicate finds open rows in both tables. |
| `closed_by` | `'stop'` \| `'session-exit'` \| `'boot-heal'` \| `'quit'`. |
| `source` | `'hooks'` today. Present so a future producer cannot be mistaken for this one — the `attention_spans.source` precedent that makes 3a-2's deferred correction control purely additive. |
| **absent:** `dispatch_id`, `task_id` | Read-time join (`attention.ts:312-315`). A stored pointer orphans a turn whose dispatch closed first. |
| **absent:** tool counts, prompt text, message content | D130. What is not taken cannot leak. |

**⚠ The D55 coverage obligation is discharged by `session_id` + `started_at` alone.** "Turns exist for N of M dispatches" is answerable without a new column:

```sql
SELECT COUNT(*) AS m,
       SUM(EXISTS (SELECT 1 FROM agent_turns t
                    WHERE t.session_id = d.session_id
                      AND t.started_at >= d.started_at
                      AND (d.ended_at IS NULL OR t.started_at <= d.ended_at))) AS n
FROM dispatches d;
```

This query is the acceptance criterion 7 artifact. It must be run and its output kept.

---

## 3. `turnsCore.ts` — the pure core

Electron-free, `better-sqlite3`-free, `Date.now()`-free. `vitest.config.ts` makes this mandatory, not stylistic.

```ts
export type TurnOutcome = 'completed' | 'abandoned'
export type TurnClosedBy = 'stop' | 'session-exit' | 'boot-heal' | 'quit'
export type TurnAction =
  | { kind: 'open' }
  | { kind: 'close'; outcome: TurnOutcome; closedBy: TurnClosedBy }
  | { kind: 'none' }

/**
 * The ONE place an activity transition becomes a turn action. Pure and
 * exported so the mapping is a unit-test table rather than scattered ifs —
 * the `classifyOutcome` / `computeRestoreSet` precedent.
 */
export function actionForTransition(input: {
  readonly next: 'working' | 'needs-you'
  readonly hasOpenTurn: boolean
}): TurnAction

/** Boot heal and quit close, so both callers share one mapping. */
export function actionForShutdown(reason: 'boot-heal' | 'quit' | 'session-exit'): {
  outcome: TurnOutcome
  closedBy: TurnClosedBy
}
```

Behaviour table — this **is** the test table:

| `next` | `hasOpenTurn` | Action | Why |
|---|---|---|---|
| `working` | `false` | `open` | The agent took the ball. |
| `working` | `true` | `open` after an implicit `close` | Defensive only. `record()`'s edge trigger makes this unreachable; if it ever fires, a lost `Stop` must not fuse two turns into one long fake turn. **Close as `abandoned/session-exit`, then open.** |
| `needs-you` | `true` | `close` → `completed/stop` | The `Stop` that is the whole point of the feature (D129). |
| `needs-you` | `false` | `none` | A `Stop` with no open turn — a session that was already amber at boot. **Not an error, and not a zero-length turn.** |

`actionForShutdown`: `boot-heal → abandoned/boot-heal`, `quit → abandoned/quit`, `session-exit → abandoned/session-exit`.

---

## 4. `turns.ts` — the seam

Modelled on `dispatches.ts`, including its error discipline.

```ts
export interface TurnRecorder {
  /** Close every turn left open by a previous run. MUST run BEFORE restore(),
   *  for the identical reason DispatchRecorder.healOrphansAtBoot does: restore
   *  opens new rows, and a heal running afterwards closes them on their first
   *  millisecond. */
  healOrphansAtBoot(): void
  attach(events: AgentEventListener, sessions: SessionManager): void
  closeOpenOnQuit(): void
}
export function createTurnRecorder(storage: StorageService): TurnRecorder
```

- `attach` registers **two** listeners and owns both:
  - `events.onActivity((sessionId, activity) => …)` — the transition path.
  - `sessions.onExit((sessionId) => …)` — closes an open turn when the PTY dies mid-turn. **`onExit` is the authority on a session ending**, exactly as `agentEventsCore` says of `SessionEnd`; without this, every killed mid-turn session leaks a row to the next boot's heal.
- **Open-turn state is read from storage, not held in a `Map`.** The recorder must survive its own process restart with no in-memory reconstruction, and `agent_turns_open` exists to make `getOpenTurnForSession` an index hit. A `Map` would also drift from the DB after a `safely()`-swallowed write failure.
- **`safely(what, fn)` wraps every write**, copied verbatim in intent from `dispatches.ts:165`: _"Telemetry may LOSE a data point. It may never FAIL a launch."_ A throw here must never reach the hook HTTP handler — `agentEvents.record()` already guards its listeners (`agentEvents.ts:117`), and this is the second belt.
- **⚠ The `onActivity` callback runs inside the hook request's `req.on('end')` path.** The HTTP response is already sent by then (`agentEvents.ts:159` answers before any derivation), so a slow write cannot stall the agent — **but it must stay a synchronous, single-statement write.** No `await`, no batching, no queue.

---

## 5. `index.ts` wiring — four edits, all beside existing ones

| Where | Edit |
|---|---|
| Module scope, beside `let dispatches` (line ~89) | `let turns: TurnRecorder | null = null` |
| Boot, beside `dispatches = createDispatchRecorder(storage)` (line ~398) | `turns = createTurnRecorder(storage)`; then `turns.healOrphansAtBoot()` **before restore**, beside the dispatch heal. |
| After `agentEvents.start()` / `sessions.bindHooks(...)` (line ~334) | `turns.attach(agentEvents, sessions)`. **Inside the same `try`**, or a listener-less boot silently produces no turns while the lights still work. |
| `app.on('before-quit')` (line ~624) | `turns?.closeOpenOnQuit()` beside `dispatches?.closeOpenOnQuit()`, **before `storage?.close()`**. |

Nothing else in `index.ts` moves.

---

## 6. Verification — driven, not reasoned

The dev instance writes to `%APPDATA%\chorus\chorus.db`; **if launched from inside the Claude desktop app it writes to the app-container redirect** at `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\chorus\chorus.db`. Confirm which file is growing before reading it — this is the trap that scattered the existing telemetry across five stores.

1. **Migration:** three-dump protocol (pre / post / post-restart) on the real dev DB, dumps under `_verify/8-0/`.
2. **One turn:** launch `claude`, send one prompt, wait for amber. Expect exactly one row, `outcome='completed'`, `closed_by='stop'`, duration matching the observed turn within 1 s.
3. **Two turns:** a second prompt in the same session yields a second row. Proves per-turn, not per-session.
4. **No hook bus:** a `codex` session produces zero rows. Show the query returning 0.
5. **Mid-turn kill:** kill the pane mid-turn → row closes `abandoned/session-exit` (not left open). Then tree-kill the app mid-turn → next boot heals to `abandoned/boot-heal` with `ended_at` NULL.
6. **Coverage query** from §2 run against the real DB, output kept.
7. **Falsification:** temporarily invert `actionForTransition`'s `needs-you` branch to `none`, confirm turns never close, revert, and prove the revert against the commit diff. (The 3a-2 §9.3 idiom.)

---

## 7. Recorded findings this task must not fix

- **`LayoutRenderer` binds no `@focus`**, so grid mode never updates `focusedSessionId` — 3a-2's recorded finding, still open, still out of scope.
- **Tool counts are unobservable from `onActivity`** (§1). Record; do not fix here.
- **Five scattered telemetry stores.** Consolidation is `_verify/mission-control/merge-telemetry.py`, a separate concern from capture.
