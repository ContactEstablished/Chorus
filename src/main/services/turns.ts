import { randomUUID } from 'crypto'
import { logger } from './logger'
import type { AgentEventListener } from './agentEvents'
import type { SessionManager } from './sessionManager'
import type { StorageService } from './storage'
import { actionForShutdown, actionForTransition } from './turnsCore'

/**
 * The turn recorder (Task 8-0, migration v18) — Mission Control spec §9
 * Phase 0, continued. `turnsCore.ts` carries the argument for why a TURN is a
 * unit of work and a DISPATCH is not; this file is the seam that puts turns on
 * disk.
 *
 * Modelled line-for-line on `dispatches.ts` (open on an announcement, close on
 * an announcement, heal orphans at boot, swallow every write error), because
 * the two recorders have the same job at two granularities and a second shape
 * would be a second set of bugs.
 *
 * ⚠ IT SUBSCRIBES; IT DOES NOT REACH INTO THE HOOK PATH. `agentEvents.ts` and
 * `agentEventsCore.ts` are untouched by this feature — `onActivity` is
 * `Set`-backed and additive, so a second listener is the established idiom.
 * This recorder therefore sees `('working' | 'needs-you')` and NEVER a hook
 * body: no prompt text, no transcript path, no tool input, no event name
 * (D130). A turn row holds no content of any kind.
 *
 * ⚠ AGENTS WITH NO HOOK BUS PRODUCE NO ROWS, AND THAT IS THE DESIGN (D129).
 * `sessions.bindHooks` is Claude-only, so a codex/kimi/opencode session never
 * fires `onActivity` and this file writes nothing for it. There is deliberately
 * no PTY-derived fallback: an interpolated turn is a fabricated number wearing
 * a real column.
 */

export interface TurnRecorder {
  /** Close every turn left open by a previous run. MUST run BEFORE restore(),
   *  for the identical reason `DispatchRecorder.healOrphansAtBoot` does:
   *  restore relaunches sessions which open new rows, and a heal running
   *  afterwards would close them on their first millisecond. */
  healOrphansAtBoot(): void
  /** Subscribe to the two announcements a turn is bounded by. */
  attach(events: AgentEventListener, sessions: SessionManager): void
  /** app 'before-quit': close whatever is still open. Idempotent. */
  closeOpenOnQuit(): void
}

function nowIso(): string {
  return new Date().toISOString()
}

class TurnRecorderImpl implements TurnRecorder {
  constructor(private readonly storage: StorageService) {}

  healOrphansAtBoot(): void {
    this.safely('boot heal', () => {
      const open = this.storage.listOpenAgentTurns()
      for (const row of open) {
        this.safely(`boot heal ${row.id}`, () => {
          const { outcome, closedBy } = actionForShutdown('boot-heal')
          // endedAt NULL ON PURPOSE: this turn ended and nobody observed when.
          // Duration consumers filter `ended_at IS NOT NULL`; count consumers
          // do not. Inventing a plausible end at boot is spec §11's first risk
          // — confident-looking numbers from thin data.
          this.storage.closeAgentTurn(row.id, { outcome, closedBy, endedAt: null })
        })
      }
      // ⚠ ONE BOOT LINE, AND NOTHING PER TURN, ANYWHERE IN THIS FILE. A
      // per-turn log line would be a second, unredacted record of exactly when
      // the operator was working — a privacy surface the table itself is
      // careful not to be.
      if (open.length > 0) {
        logger.info(`[turns] healed ${open.length} orphan turn(s) -> abandoned/boot-heal`)
      }
    })
  }

  attach(events: AgentEventListener, sessions: SessionManager): void {
    // The transition path. `since` is the instant `agentEvents` observed the
    // CHANGE (its own `Date.now()`, not anything off the wire), so using it
    // rather than a fresh clock read here keeps a turn's boundaries the same
    // instants the filmstrip's lights are showing — and it stays D130-clean,
    // because no timestamp is taken from the hook body.
    events.onActivity((sessionId, activity, since) => {
      // A NULL activity is the stale sweep retiring a `working` claim that
      // outlived its evidence, and it closes the turn for the same reason the
      // PTY exit below does: the agent stopped and nobody observed it stop.
      //
      // ⚠ THIS IS THE OTHER HALF OF THE BUG THE SWEEP FIXES, AND THE TURN
      // TABLE IS WHERE IT WAS MEASURED. Without it, a lost `Stop` left the turn
      // open until the session died — 46 of the installed 0.7.5 database's
      // turns closed that way on 2026-08-23, four of them longer than nine
      // hours, against a 1.8-minute median for turns an observed `Stop` closed.
      // Those rows are not long turns; they are one turn plus however long the
      // pane sat idle afterwards, and they are exactly what an estimator built
      // on this table would learn from.
      if (activity === null) return this.closeOnStale(sessionId)
      this.onTransition(sessionId, activity, new Date(since).toISOString())
    })
    // ⚠ AND THE PTY EXIT, WITHOUT WHICH EVERY SESSION KILLED MID-TURN LEAKS A
    // ROW TO THE NEXT BOOT'S HEAL. `onExit` is the authority on a session
    // ending — it fires hooks or no hooks, which is exactly why
    // `agentEventsCore` refuses to classify `SessionEnd`.
    sessions.onExit((sessionId) => this.closeOnSessionExit(sessionId))
  }

  closeOpenOnQuit(): void {
    this.safely('quit close', () => {
      for (const row of this.storage.listOpenAgentTurns()) {
        this.safely(`quit close ${row.id}`, () => {
          const { outcome, closedBy } = actionForShutdown('quit')
          // A real ended_at here, unlike the boot heal: quit is observed, so
          // "now" is the truth rather than a guess.
          this.storage.closeAgentTurn(row.id, { outcome, closedBy, endedAt: nowIso() })
        })
      }
    })
  }

  private onTransition(sessionId: string, activity: 'working' | 'needs-you', atIso: string): void {
    this.safely('transition', () => {
      // ⚠ OPEN-TURN STATE IS READ FROM STORAGE, NOT HELD IN A MAP. The
      // recorder must survive its own process restart with no in-memory
      // reconstruction, and a Map would drift from the DB the moment a
      // `safely()`-swallowed write failed — after which every later decision
      // would be made against a state that never reached disk.
      // `agent_turns_open` is what makes this an index hit.
      const open = this.storage.getOpenTurnForSession(sessionId)
      const action = actionForTransition({ next: activity, hasOpenTurn: open !== null })
      switch (action.kind) {
        case 'none':
          return
        case 'close':
          if (open) {
            this.storage.closeAgentTurn(open.id, {
              outcome: action.outcome,
              closedBy: action.closedBy,
              endedAt: atIso
            })
          }
          return
        case 'reopen':
          // Defensive: a lost `Stop` must not fuse two turns into one long
          // fake turn. Close the stale row, then fall through to open.
          if (open) {
            this.storage.closeAgentTurn(open.id, {
              outcome: action.outcome,
              closedBy: action.closedBy,
              endedAt: atIso
            })
          }
          this.open(sessionId, atIso)
          return
        case 'open':
          this.open(sessionId, atIso)
          return
      }
    })
  }

  private open(sessionId: string, atIso: string): void {
    // project_id and agent come from the sessions ROW, the same source
    // `DispatchRecorder.openDispatch` uses. A session whose row has already
    // gone yields NULL / 'unknown' rather than blocking the write: a turn with
    // an unnamed agent is a weaker sample, but a lost turn is no sample at all
    // and cannot be recovered later.
    const session = this.storage.getSessionById(sessionId)
    this.storage.openAgentTurn({
      id: randomUUID(),
      sessionId,
      projectId: session?.projectId ?? null,
      agent: session?.agent ?? 'unknown',
      startedAt: atIso,
      endedAt: null,
      outcome: null,
      closedBy: null,
      // The only producer today. Present so a future one cannot be mistaken
      // for this one.
      source: 'hooks',
      createdAt: nowIso()
    })
  }

  /**
   * The stale sweep retired this session's `working` claim.
   *
   * ⚠ `endedAt: null`, THE BOOT HEAL'S RULE AND NOT THE QUIT CLOSE'S. What is
   * known is that the turn ended somewhere between its last sign of life and
   * the sweep that noticed — a window up to `WORKING_STALE_MS` wide. Writing
   * either end of that window as `ended_at` would put a confident number on
   * top of an interval, which is spec §11's first named risk; `closed_by`
   * carries how we found out, and duration consumers already filter
   * `ended_at IS NOT NULL`.
   */
  private closeOnStale(sessionId: string): void {
    this.safely('stale close', () => {
      const open = this.storage.getOpenTurnForSession(sessionId)
      if (!open) return
      const { outcome, closedBy } = actionForShutdown('stale')
      this.storage.closeAgentTurn(open.id, { outcome, closedBy, endedAt: null })
    })
  }

  private closeOnSessionExit(sessionId: string): void {
    this.safely('session exit', () => {
      const open = this.storage.getOpenTurnForSession(sessionId)
      // No open turn is a no-op, not an error: most sessions exit while amber,
      // and a double-close is a no-write by the accessor's WHERE clause anyway.
      if (!open) return
      const { outcome, closedBy } = actionForShutdown('session-exit')
      this.storage.closeAgentTurn(open.id, { outcome, closedBy, endedAt: nowIso() })
    })
  }

  // Telemetry may LOSE a data point. It may never FAIL A SESSION. This one is
  // sharper than the dispatch recorder's: `onActivity` runs inside the hook
  // request's handler, so a throw escaping here would surface in the path
  // Claude Code's hook command is waiting on. `agentEvents.record()` already
  // guards its listeners; this is the second belt, structured once rather than
  // trusted to SQLite never erroring.
  private safely(what: string, fn: () => void): void {
    try {
      fn()
    } catch (err) {
      logger.error({ err }, `[turns] ${what} failed; continuing`)
    }
  }
}

export function createTurnRecorder(storage: StorageService): TurnRecorder {
  return new TurnRecorderImpl(storage)
}
