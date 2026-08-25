/**
 * The turn derivation, factored PURE so Vitest's `environment: 'node'` covers
 * it without an HTTP server, a PTY, Electron or SQLite — the same shape as
 * `attentionCore` / `agentEventsCore` / `councilDocketCore`. `vitest.config.ts`
 * makes that mandatory rather than stylistic: the native binding is built for
 * the Electron ABI and cannot load under plain-node Vitest.
 *
 * ─── WHAT A TURN IS, AND WHY IT IS A NEW UNIT ────────────────────────────────
 * A DISPATCH is one PTY lifetime, and an interactive agent pane has no natural
 * completion event — the human closes it, kills it, or quits the app. Measured
 * over 172 real dispatches (roadmap F52): FIVE ever reached `completed`, the
 * closed ones averaged 74–134 minutes, and the longest ran 557. `ended_at -
 * started_at` was measuring how long a terminal was open. `classifyOutcome`
 * (`dispatches.ts:33`) is not wrong; the UNIT is.
 *
 * A TURN is the interval between an agent taking the ball and giving it back:
 *
 *   UserPromptSubmit ───────────────────────────────────► Stop
 *      (classifies 'working')                      (classifies 'needs-you')
 *      turn OPENS                                      turn CLOSES
 *
 * ⚠ THIS MODULE NEVER SEES THOSE EVENT NAMES, AND THAT IS THE POINT (D130).
 * It consumes `agentEvents.onActivity`'s ALREADY-CLASSIFIED activity, so the
 * hook listener's read surface does not widen by one field to make turns
 * exist. No hook body is parsed here, and a turn row carries no content of any
 * kind — what is not taken cannot leak.
 *
 * ⚠ THE ALTERNATION IS GUARANTEED BY `record()`'s EDGE TRIGGER, AND THIS CODE
 * DEPENDS ON THAT RATHER THAN RE-DERIVING IT. `agentEvents.ts:169` returns
 * early when the session's activity already equals the next value, so a turn's
 * twenty `PreToolUse`/`PostToolUse` events produce ONE `'working'` callback,
 * not twenty. That is why this is a two-state machine and not an event buffer
 * — and it is also why a TOOL-CALL COUNT is unobservable from here. Obtaining
 * one means touching the hook path, which is precisely the surface D130 closes;
 * it is recorded as a finding and deliberately not smuggled in.
 */

/** NULL means OPEN on the row; these are the two ways a turn can end. */
export type TurnOutcome = 'completed' | 'abandoned'

export type TurnClosedBy = 'stop' | 'session-exit' | 'boot-heal' | 'quit' | 'stale'

/**
 * What one activity transition means for the turn table.
 *
 * ⚠ `reopen` IS A FOURTH VARIANT THE IMPLEMENTATION SPEC'S SKETCH DID NOT
 * NAME, and it exists because the spec's own behaviour table needs it: the
 * `working`-while-already-open cell is written "`open` after an implicit
 * `close`", which is two writes and cannot be carried by a bare `{ kind:
 * 'open' }`. Spelling it as its own variant keeps every case a flat record the
 * caller switches on exhaustively — the `classifyOutcome` shape — rather than
 * hiding a second write inside an optional field on `open`.
 */
export type TurnAction =
  | { kind: 'open' }
  | { kind: 'close'; outcome: TurnOutcome; closedBy: TurnClosedBy }
  | { kind: 'reopen'; outcome: TurnOutcome; closedBy: TurnClosedBy }
  | { kind: 'none' }

/**
 * The ONE place an activity transition becomes a turn action. Pure and
 * exported so the mapping is a unit-test TABLE rather than scattered `if`s —
 * the `classifyOutcome` / `computeRestoreSet` precedent.
 *
 * ⚠ TIME IS NOT AN INPUT HERE. The caller stamps it, so this function has no
 * `Date.now()` and its tests need no clock injection.
 */
export function actionForTransition(input: {
  readonly next: 'working' | 'needs-you'
  readonly hasOpenTurn: boolean
}): TurnAction {
  if (input.next === 'working') {
    // The agent took the ball. Nothing was open, so this is the clean case and
    // the overwhelmingly common one.
    if (!input.hasOpenTurn) return { kind: 'open' }
    // DEFENSIVE ONLY — `record()`'s edge trigger makes this unreachable
    // through `onActivity`, and `turnsCore.test.ts` asserts as much so a later
    // change to `record()` breaks a test rather than silently changing the
    // data. If it ever does fire, a LOST `Stop` must not fuse two turns into
    // one long fake turn: the stale one is closed as abandoned before the new
    // one opens. `session-exit` rather than a new vocabulary word, because
    // that is what actually happened as far as anything can tell — the turn
    // ended without an observed end.
    return { kind: 'reopen', outcome: 'abandoned', closedBy: 'session-exit' }
  }
  // 'needs-you' with a turn open: the `Stop` that is the whole point of the
  // feature (D129 — `Stop` is the load-bearing event).
  if (input.hasOpenTurn) return { kind: 'close', outcome: 'completed', closedBy: 'stop' }
  // A `Stop` with no open turn — a session that was already amber at boot, or
  // one whose first observed event is a `Notification`. NOT an error, and NOT
  // a zero-length turn: inventing one would put a fabricated duration into the
  // estimator's only honest sample set.
  return { kind: 'none' }
}

/**
 * Boot heal, quit close, PTY exit and the stale sweep share ONE mapping, so
 * the four callers cannot drift into four different vocabularies for the same
 * fact.
 *
 * Every one is `abandoned`: `completed` means a `Stop` was OBSERVED, and none
 * of these four observed one. `closed_by` is what distinguishes them, which
 * is exactly the `dispatches` §4.3 split between "what happened" and "how we
 * found out".
 *
 * ⚠ `stale` IS THE NEWEST AND THE MOST INFORMATIVE OF THE FOUR. The other
 * three say the process or the app went away with a turn open; `stale` says
 * the agent went quiet on both the hook bus and its own terminal for
 * `WORKING_STALE_MS` while everything was still running — i.e. a `Stop` was
 * LOST rather than never reached. Counting them is how the hook bus's real
 * loss rate becomes visible instead of being absorbed into `session-exit`.
 */
export function actionForShutdown(
  reason: 'boot-heal' | 'quit' | 'session-exit' | 'stale'
): {
  outcome: TurnOutcome
  closedBy: TurnClosedBy
} {
  return { outcome: 'abandoned', closedBy: reason }
}
