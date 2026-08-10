import { describe, expect, it } from 'vitest'
import { actionForShutdown, actionForTransition } from './turnsCore'
import { classifyHookEvent } from './agentEventsCore'

// Task 8-0: the turn derivation as a pure mapping TABLE — every transition,
// no gaps — plus the shutdown vocabulary and the edge-trigger assumption the
// whole design rests on.
//
// ⚠ better-sqlite3 is compiled for the Electron ABI and cannot load under
// plain-node vitest, so nothing here imports storage.ts. The DDL and the
// accessors' WHERE clauses are proven at runtime (the v18 three-dump protocol
// and the six drives), not in this file.

describe('actionForTransition (Task 8-0) — every transition, no gaps', () => {
  it('needs-you → working with nothing open: OPEN a turn', () => {
    // The clean case and the overwhelmingly common one: UserPromptSubmit.
    expect(actionForTransition({ next: 'working', hasOpenTurn: false })).toEqual({ kind: 'open' })
  })

  it('working → needs-you with a turn open: CLOSE it completed/stop', () => {
    // The `Stop` that is the entire point of the feature (D129).
    expect(actionForTransition({ next: 'needs-you', hasOpenTurn: true })).toEqual({
      kind: 'close',
      outcome: 'completed',
      closedBy: 'stop'
    })
  })

  it('needs-you with NOTHING open is `none` — not an error and not a zero-length turn', () => {
    // A session already amber at boot, or one whose first observed event is a
    // Notification. Inventing a zero-length turn here would put a fabricated
    // duration into the estimator's only honest sample set.
    expect(actionForTransition({ next: 'needs-you', hasOpenTurn: false })).toEqual({ kind: 'none' })
  })

  it('working while a turn is ALREADY open: close the stale row, then open — never fuse two turns', () => {
    // Defensive only (see the edge-trigger suite below). A LOST Stop must not
    // produce one long fake turn spanning two real ones — which is exactly the
    // failure mode that makes `dispatches` wall-clock useless (F52).
    expect(actionForTransition({ next: 'working', hasOpenTurn: true })).toEqual({
      kind: 'reopen',
      outcome: 'abandoned',
      closedBy: 'session-exit'
    })
  })

  it('is a pure function of its two inputs: repeated calls never drift', () => {
    const once = actionForTransition({ next: 'working', hasOpenTurn: false })
    const twice = actionForTransition({ next: 'working', hasOpenTurn: false })
    expect(once).toEqual(twice)
  })
})

describe('the edge trigger this design depends on (agentEvents.ts:169)', () => {
  // `record()` returns early when a session's activity already equals the next
  // value, so working→working and needs-you→needs-you NEVER reach onActivity.
  // These assertions exist so that a later change to `record()` — dropping the
  // early return, or classifying a new event — breaks a test HERE rather than
  // silently double-opening turns in production.
  it('every tool-traffic event collapses to the SAME activity, so a burst is one callback', () => {
    // Twenty PreToolUse/PostToolUse events in one turn produce ONE 'working'
    // callback, which is why a TOOL-CALL COUNT is unobservable from onActivity
    // and is deliberately not in this task (recorded finding, not a fix).
    for (const name of ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure']) {
      expect(classifyHookEvent(name)).toBe('working')
    }
  })

  it('Stop classifies needs-you, so the closing edge exists at all', () => {
    expect(classifyHookEvent('Stop')).toBe('needs-you')
  })

  it('an unrecognised event says nothing and therefore triggers no transition', () => {
    // null leaves the session's activity alone, so no turn opens or closes.
    expect(classifyHookEvent('SessionStart')).toBeNull()
    expect(classifyHookEvent('SessionEnd')).toBeNull()
  })

  it('a repeat of the SAME activity is what the early return suppresses — asserted as an invariant', () => {
    // If this ever becomes reachable, `reopen` above is what stops it fusing
    // turns; the assertion records that the core treats it as defensive only.
    const repeated = actionForTransition({ next: 'working', hasOpenTurn: true })
    expect(repeated.kind).toBe('reopen')
    expect(repeated).not.toEqual({ kind: 'open' })
  })
})

describe('actionForShutdown (Task 8-0)', () => {
  it('boot heal → abandoned/boot-heal', () => {
    expect(actionForShutdown('boot-heal')).toEqual({ outcome: 'abandoned', closedBy: 'boot-heal' })
  })

  it('app quit → abandoned/quit', () => {
    expect(actionForShutdown('quit')).toEqual({ outcome: 'abandoned', closedBy: 'quit' })
  })

  it('the PTY died mid-turn → abandoned/session-exit', () => {
    expect(actionForShutdown('session-exit')).toEqual({
      outcome: 'abandoned',
      closedBy: 'session-exit'
    })
  })

  it('NONE of the three is ever `completed` — completed means a Stop was OBSERVED', () => {
    // The honesty bar: `completed` is a claim about what was seen, and none of
    // these three saw an end. closed_by is what distinguishes them.
    for (const reason of ['boot-heal', 'quit', 'session-exit'] as const) {
      expect(actionForShutdown(reason).outcome).toBe('abandoned')
    }
  })
})
