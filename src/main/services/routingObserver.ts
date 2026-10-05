import type { RoutingStatus } from '../../shared/routing'
import { DEFAULT_ROUTING_LOG, type RoutingLog, type RoutingObserverTick, type RoutingService } from './routingService'

/**
 * Model Routing Task 2-3: the background observer (MR-D10, MR-D18 class 2,
 * MR-D19, K7, C19). One re-armed `setTimeout`, `unref()`ed so it never keeps
 * the process alive: the first tick 2 minutes after `start()`, then every 30
 * minutes, re-armed at each tick's START so a slow tick never drifts the
 * schedule. Each tick is `service.observe`, which records the free endpoints
 * list for every registry model whose snapshot is older than 25 minutes, with
 * the credential the user designated, and nothing else: no preflight, no
 * probe, no progress event.
 *
 * The timer keeps running while observation is dormant (disabled or
 * undesignated); a dormant tick reads only the observation setting, so
 * designation takes effect at the next tick. This class holds no key and
 * reads no credential; the service does both, once per non-dormant tick.
 */

export const OBSERVER_FIRST_TICK_MS = 120_000 // 2 minutes after start
export const OBSERVER_INTERVAL_MS = 1_800_000 // 30 minutes
export const OBSERVER_FRESH_MS = 1_500_000 // skip a model whose snapshot is younger than 25 minutes

export interface ObserverTimerHandle {
  unref(): unknown
}
export interface ObserverTimers {
  setTimeout(fn: () => void, ms: number): ObserverTimerHandle
  clearTimeout(handle: ObserverTimerHandle): void
}
export interface RoutingObserverDeps {
  service: Pick<RoutingService, 'observe' | 'status' | 'getObservation'>
  timers?: ObserverTimers // default: the globals
  now?: () => string
  log?: RoutingLog
}

const GLOBAL_TIMERS: ObserverTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
}

export class RoutingObserver {
  private readonly service: RoutingObserverDeps['service']
  private readonly timers: ObserverTimers
  private readonly now: () => string
  private readonly log: RoutingLog
  private started = false
  /** At most one handle exists. */
  private handle: ObserverTimerHandle | null = null
  private nextTickAt: string | null = null
  /** The running tick, shared by concurrent callers (single flight). */
  private running: Promise<RoutingObserverTick> | null = null

  constructor(deps: RoutingObserverDeps) {
    this.service = deps.service
    this.timers = deps.timers ?? GLOBAL_TIMERS
    this.now = deps.now ?? (() => new Date().toISOString())
    this.log = deps.log ?? DEFAULT_ROUTING_LOG
  }

  /** Idempotent; arms the first tick. */
  start(): void {
    if (this.started) return
    this.started = true
    this.arm(OBSERVER_FIRST_TICK_MS)
  }

  /** Idempotent; clears the timer. An in-flight tick finishes but arms nothing. */
  stop(): void {
    this.started = false
    if (this.handle !== null) {
      this.timers.clearTimeout(this.handle)
      this.handle = null
    }
    this.nextTickAt = null
  }

  /** One tick now. Single flight: a second caller gets the running tick. Never rejects. */
  tick(): Promise<RoutingObserverTick> {
    if (this.running !== null) return this.running
    const run = this.runTick()
    this.running = run
    // Registered before any caller's continuation, so `running` is cleared first.
    void run.then(() => {
      if (this.running === run) this.running = null
    })
    return run
  }

  status(): RoutingStatus {
    const service = this.service.status()
    const observation = this.service.getObservation()
    const dormantReason: RoutingStatus['observer']['dormantReason'] = !observation.enabled
      ? 'disabled'
      : observation.credentialProfileId === null
        ? 'undesignated'
        : null
    const state: RoutingStatus['observer']['state'] = !this.started
      ? 'stopped'
      : this.running !== null
        ? 'running'
        : dormantReason !== null
          ? 'dormant'
          : 'scheduled'
    const last = service.lastTick
    return {
      observer: {
        state,
        dormantReason,
        nextTickAt: this.nextTickAt,
        lastTickAt: last === null ? null : last.at,
        lastOutcome: last === null ? null : last.outcome,
        lastFailure: last === null ? null : last.failure
      },
      models: service.models.map((m) => ({ ...m })),
      requestsSinceStart: service.requestsSinceStart
    }
  }

  private arm(ms: number): void {
    if (this.handle !== null) this.timers.clearTimeout(this.handle)
    const handle = this.timers.setTimeout(() => {
      void this.fire(handle)
    }, ms)
    handle.unref()
    this.handle = handle
    this.nextTickAt = new Date(Date.parse(this.now()) + ms).toISOString()
  }

  private async fire(handle: ObserverTimerHandle): Promise<void> {
    // A stale callback (cleared, or replaced) does nothing.
    if (this.handle !== handle) return
    this.handle = null
    if (!this.started) return
    // Arm the next tick FIRST, at this tick's start, so tick duration never drifts the schedule.
    this.arm(OBSERVER_INTERVAL_MS)
    await this.tick()
  }

  private async runTick(): Promise<RoutingObserverTick> {
    try {
      return await this.service.observe({ freshMs: OBSERVER_FRESH_MS })
    } catch (err) {
      // The service contract forbids a rejection; if one happens anyway, it is a failed tick.
      this.log.error('observer tick failed', err)
      let at: string
      try {
        at = this.now()
      } catch {
        at = new Date().toISOString()
      }
      return { at, outcome: 'failed', failure: null, models: [] }
    }
  }
}
