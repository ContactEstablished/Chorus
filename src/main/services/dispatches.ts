import { randomUUID } from 'crypto'
import { logger } from './logger'
import type { SessionManager, SessionStartInfo } from './sessionManager'
import type { StorageService } from './storage'

/**
 * The dispatch telemetry spine (Phase 3a / Task 3a-1, migration v7) — Mission
 * Control spec §5.2 + §9 Phase 0: record, for every agent run, the facts that
 * cannot be reconstructed later. Capture hangs off the lifecycle main already
 * owns (spawn success, the onExit announcement, the boot heal, app quit) and
 * off nothing the renderer says — there is no IPC channel in this feature.
 *
 * Electron-free and node-pty-free, so the recorder is unit-testable and the
 * same recorder can serve an api-mode session later without a second wiring
 * point (the D45(1)/F26 failure shape, one layer up).
 */

export type DispatchOutcome = 'completed' | 'abandoned' | 'failed'
export type DispatchClosedBy = 'exit' | 'kill' | 'dispose' | 'boot-heal'

/**
 * The ONE place an observable becomes an outcome. Pure and exported so the
 * mapping is a unit-test table rather than three scattered `if`s — the
 * computeRestoreSet / composeChildEnv precedent.
 *
 * ⚠ `killRequested` DOMINATES the exit code, and that is the whole reason this
 * function exists. On Windows a killed PTY reports a non-zero code (this
 * machine's recorded shape is -1073741510 = STATUS_CONTROL_C_EXIT), so code
 * alone cannot distinguish "the user closed the pane" from "the agent
 * crashed". Classifying by code would make `failed` the dominant outcome and
 * poison the only quality signal the estimator has (spec §5.4).
 */
export function classifyOutcome(input: {
  readonly reason: 'exit' | 'dispose' | 'boot-heal'
  readonly exitCode: number | null
  readonly killRequested: boolean
}): { outcome: DispatchOutcome; closedBy: DispatchClosedBy } {
  // Boot heal: the dispatch was still open at boot — the previous run crashed
  // or was tree-killed. ended_at stays NULL (handled by the caller): "it
  // ended, we never saw when" is a VALUE, not a gap.
  if (input.reason === 'boot-heal') return { outcome: 'abandoned', closedBy: 'boot-heal' }
  // App quit: dispose() killed the PTY and no exit event was delivered before
  // teardown.
  if (input.reason === 'dispose') return { outcome: 'abandoned', closedBy: 'dispose' }
  // reason 'exit': a user-initiated kill (pane ✕, the Kill control, Restart's
  // kill step) dominates any exit code — see the warning above.
  if (input.killRequested) return { outcome: 'abandoned', closedBy: 'kill' }
  // A PTY exit always delivers a code; a missing one is an anomaly and must
  // not read as success.
  if (input.exitCode === 0) return { outcome: 'completed', closedBy: 'exit' }
  return { outcome: 'failed', closedBy: 'exit' }
}

export interface DispatchRecorder {
  /** Close every dispatch left open by a previous run. MUST run before
   *  restore(): restore opens new dispatches, and a heal running afterwards
   *  would close them on their first millisecond. Same reasoning as the
   *  worktree reconcile running awaited before restore. */
  healOrphansAtBoot(): void
  /** Subscribe to the manager's start/exit announcements. */
  attach(sessions: SessionManager): void
  /** app 'before-quit': close whatever survived dispose(). Idempotent. */
  closeOpenOnQuit(): void
}

/** The wall-clock start of one run, captured once. */
function nowIso(): string {
  return new Date().toISOString()
}

class DispatchRecorderImpl implements DispatchRecorder {
  constructor(private readonly storage: StorageService) {}

  healOrphansAtBoot(): void {
    this.safely('boot heal', () => {
      for (const row of this.storage.listOpenDispatches()) {
        this.safely(`boot heal ${row.id}`, () => {
          const { outcome, closedBy } = classifyOutcome({
            reason: 'boot-heal',
            exitCode: null,
            killRequested: false
          })
          // endedAt NULL ON PURPOSE: this run ended and nobody observed when.
          // Wall-clock consumers filter ended_at IS NOT NULL; outcome-rate
          // consumers do not. Inventing a plausible end time at boot is spec
          // §11's first risk ("confident-looking numbers from thin data").
          this.storage.closeDispatch(row.id, { outcome, closedBy, endedAt: null, exitCode: null })
          logger.info(`[dispatch] healed orphan ${row.id} (session ${row.sessionId}) -> abandoned/boot-heal`)
        })
      }
    })
  }

  attach(sessions: SessionManager): void {
    sessions.onStart((info) => this.openDispatch(info))
    sessions.onExit((sessionId, exitCode) => this.closeOnExit(sessions, sessionId, exitCode))
  }

  closeOpenOnQuit(): void {
    this.safely('quit close', () => {
      for (const row of this.storage.listOpenDispatches()) {
        this.safely(`quit close ${row.id}`, () => {
          const { outcome, closedBy } = classifyOutcome({
            reason: 'dispose',
            exitCode: null,
            killRequested: true
          })
          this.storage.closeDispatch(row.id, { outcome, closedBy, endedAt: nowIso(), exitCode: null })
        })
      }
    })
  }

  /** Open on the onStart announcement, which fires only after pty.spawn has
   *  returned — so a throwing spawn leaves no permanently-open row. */
  private openDispatch(info: SessionStartInfo): void {
    this.safely('open', () => {
      // project_id comes from the sessions ROW (minted by the IPC layer before
      // launch, pre-existing for restore/restart), keeping SessionStartInfo a
      // plain fact bundle about the spawn itself. Opaque string, no FK.
      const projectId = this.storage.getSessionById(info.sessionId)?.projectId ?? null
      this.storage.createDispatch({
        id: randomUUID(),
        sessionId: info.sessionId,
        projectId,
        taskId: null,
        agent: info.agent,
        model: info.model,
        providerName: info.providerName,
        authMode: info.authMode,
        cwd: info.cwd,
        startedAt: nowIso(),
        endedAt: null,
        outcome: null,
        closedBy: null,
        exitCode: null,
        tokensIn: null,
        tokensOut: null,
        tokensCached: null,
        costUsd: null
      })
    })
  }

  private closeOnExit(sessions: SessionManager, sessionId: string, exitCode: number): void {
    this.safely('close', () => {
      const open = this.storage.getOpenDispatchForSession(sessionId)
      // No open dispatch is a no-op, not an error — sessions launched before
      // this feature shipped have none, and a double-close is a no-write by
      // the accessor's WHERE clause anyway.
      if (!open) return
      const { outcome, closedBy } = classifyOutcome({
        reason: 'exit',
        exitCode,
        killRequested: sessions.wasKilledByChorus(sessionId)
      })
      this.storage.closeDispatch(open.id, { outcome, closedBy, endedAt: nowIso(), exitCode })
    })
  }

  // Telemetry may LOSE a data point. It may never FAIL A LAUNCH. A dispatch
  // row that fails to insert costs one sample; a dispatch row whose insert
  // propagates costs the user a dead agent session. The trade is structured
  // here, once, rather than trusted to SQLite never erroring.
  private safely(what: string, fn: () => void): void {
    try {
      fn()
    } catch (err) {
      logger.error({ err }, `[dispatch] ${what} failed; continuing`)
    }
  }
}

export function createDispatchRecorder(storage: StorageService): DispatchRecorder {
  return new DispatchRecorderImpl(storage)
}
