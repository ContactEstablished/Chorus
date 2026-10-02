import { describe, expect, it, vi } from 'vitest'

import { routingStatusSchema, type RoutingObservationSettings } from '../../shared/routing'
import {
  OBSERVER_FIRST_TICK_MS,
  OBSERVER_FRESH_MS,
  OBSERVER_INTERVAL_MS,
  RoutingObserver,
  type ObserverTimerHandle,
  type ObserverTimers
} from './routingObserver'
import type { RoutingLog, RoutingObserverTick, RoutingServiceStatus } from './routingService'

/**
 * Model Routing Task 2-3, Table O (ImplementationSpec-2-3): the observer's
 * schedule against fake timers (callbacks fired by hand) and a fake service.
 */

const SLUG = 'deepseek/deepseek-v4.1-flash'
const C = '5f0c1a2e-8a3b-4c5d-9e6f-0123456789ab'
const NOW = '2026-10-02T09:20:00Z'

interface Armed {
  fn: () => void
  ms: number
  handle: ObserverTimerHandle & { unref: ReturnType<typeof vi.fn> }
}

function fakeTimers() {
  const armed: Armed[] = []
  const cleared: ObserverTimerHandle[] = []
  const timers: ObserverTimers = {
    setTimeout: (fn, ms) => {
      const handle = { unref: vi.fn() }
      armed.push({ fn, ms, handle })
      return handle
    },
    clearTimeout: (handle) => {
      cleared.push(handle)
    }
  }
  return { timers, armed, cleared }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const OBSERVED: RoutingObserverTick = {
  at: NOW,
  outcome: 'observed',
  failure: null,
  models: [{ model: SLUG, outcome: 'observed', failure: null }]
}

function fakeService(observation: RoutingObservationSettings = { enabled: true, credentialProfileId: C }) {
  const state: { lastTick: RoutingObserverTick | null; observation: RoutingObservationSettings } = { lastTick: null, observation }
  const service = {
    observe: vi.fn(async (_options: { freshMs: number }): Promise<RoutingObserverTick> => {
      state.lastTick = OBSERVED
      return OBSERVED
    }),
    status: vi.fn(
      (): RoutingServiceStatus => ({
        lastTick: state.lastTick,
        models: [
          {
            model: SLUG,
            displayName: 'DeepSeek V4.1 Flash',
            snapshotFetchedAt: state.lastTick === null ? null : NOW,
            observations: state.lastTick === null ? 0 : 32,
            cacheVerified: 0,
            busy: false
          }
        ],
        requestsSinceStart: state.lastTick === null ? 0 : 1
      })
    ),
    getObservation: vi.fn(() => ({ ...state.observation }))
  }
  return { service, state }
}

function makeObserver(observation?: RoutingObservationSettings) {
  const t = fakeTimers()
  const s = fakeService(observation)
  const log: RoutingLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const observer = new RoutingObserver({ service: s.service, timers: t.timers, now: () => NOW, log })
  return { observer, ...t, ...s, log }
}

function expectValidStatus(observer: RoutingObserver) {
  const status = observer.status()
  expect(routingStatusSchema.safeParse(status).success).toBe(true)
  return status
}

describe('Table O — RoutingObserver', () => {
  it('the constants: first tick 2 minutes, then every 30, fresh for 25', () => {
    expect(OBSERVER_FIRST_TICK_MS).toBe(120_000)
    expect(OBSERVER_INTERVAL_MS).toBe(1_800_000)
    expect(OBSERVER_FRESH_MS).toBe(1_500_000)
  })

  it('O1: start() arms one 120,000 ms timer, unref()ed; observe not called', () => {
    const o = makeObserver()
    o.observer.start()
    expect(o.armed).toHaveLength(1)
    expect(o.armed[0].ms).toBe(120_000)
    expect(o.armed[0].handle.unref).toHaveBeenCalledTimes(1)
    expect(o.service.observe).not.toHaveBeenCalled()
  })

  it('O2: firing arms the next 1,800,000 ms timer BEFORE observe resolves; observe gets { freshMs: 1_500_000 }', async () => {
    const o = makeObserver()
    const pending = deferred<RoutingObserverTick>()
    o.service.observe.mockImplementationOnce(() => pending.promise)
    o.observer.start()
    o.armed[0].fn()
    expect(o.armed).toHaveLength(2)
    expect(o.armed[1].ms).toBe(1_800_000)
    expect(o.armed[1].handle.unref).toHaveBeenCalledTimes(1)
    expect(o.service.observe).toHaveBeenCalledTimes(1)
    expect(o.service.observe).toHaveBeenCalledWith({ freshMs: 1_500_000 })
    expect(expectValidStatus(o.observer).observer.nextTickAt).toBe('2026-10-02T09:50:00.000Z')
    pending.resolve(OBSERVED)
    await o.observer.tick()
    expect(o.armed).toHaveLength(2) // the tick itself arms nothing more
    expect(o.cleared).toEqual([])
  })

  it('O3: start twice → one timer; stop twice → one clearTimeout; a stale callback after stop does nothing', () => {
    const o = makeObserver()
    o.observer.start()
    o.observer.start()
    expect(o.armed).toHaveLength(1)
    o.observer.stop()
    o.observer.stop()
    expect(o.cleared).toEqual([o.armed[0].handle])
    expect(() => o.armed[0].fn()).not.toThrow()
    expect(o.service.observe).not.toHaveBeenCalled()
    expect(o.armed).toHaveLength(1)
  })

  it('O4: a rejecting observe resolves as a failed tick (logged) and the next timer is still armed', async () => {
    const o = makeObserver()
    o.service.observe.mockRejectedValueOnce(new Error('observe broke its contract'))
    o.observer.start()
    o.armed[0].fn()
    const tick = await o.observer.tick()
    expect(tick).toStrictEqual({ at: NOW, outcome: 'failed', failure: null, models: [] })
    expect(o.log.error).toHaveBeenCalledWith('observer tick failed', expect.any(Error))
    expect(o.armed).toHaveLength(2)
    expect(o.cleared).toEqual([])
    expect(expectValidStatus(o.observer).observer.state).toBe('scheduled')
  })

  it('O5: status — stopped; dormant/undesignated at now + 2 min; scheduled; running; then the last tick', async () => {
    const o = makeObserver({ enabled: true, credentialProfileId: null })
    const stopped = expectValidStatus(o.observer)
    expect(stopped.observer).toStrictEqual({
      state: 'stopped',
      dormantReason: 'undesignated',
      nextTickAt: null,
      lastTickAt: null,
      lastOutcome: null,
      lastFailure: null
    })
    o.observer.start()
    const dormant = expectValidStatus(o.observer)
    expect(dormant.observer.state).toBe('dormant')
    expect(dormant.observer.dormantReason).toBe('undesignated')
    expect(dormant.observer.nextTickAt).toBe('2026-10-02T09:22:00.000Z')

    o.state.observation = { enabled: true, credentialProfileId: C }
    const scheduled = expectValidStatus(o.observer)
    expect(scheduled.observer.state).toBe('scheduled')
    expect(scheduled.observer.dormantReason).toBeNull()

    const pending = deferred<RoutingObserverTick>()
    o.service.observe.mockImplementationOnce(() => pending.promise)
    const running = o.observer.tick()
    expect(expectValidStatus(o.observer).observer.state).toBe('running')
    o.state.lastTick = { ...OBSERVED, outcome: 'fetch-failed', failure: 'rate-limited', models: [{ model: SLUG, outcome: 'fetch-failed', failure: 'rate-limited' }] }
    pending.resolve(o.state.lastTick)
    await running
    const after = expectValidStatus(o.observer)
    expect(after.observer.state).toBe('scheduled')
    expect(after.observer.lastTickAt).toBe(NOW)
    expect(after.observer.lastOutcome).toBe('fetch-failed')
    expect(after.observer.lastFailure).toBe('rate-limited')
    expect(after.models).toStrictEqual(o.service.status().models)
    expect(after.requestsSinceStart).toBe(1)
  })

  it('O6: two concurrent tick() calls → one observe; both resolve to the same tick', async () => {
    const o = makeObserver()
    const pending = deferred<RoutingObserverTick>()
    o.service.observe.mockImplementationOnce(() => pending.promise)
    const a = o.observer.tick()
    const b = o.observer.tick()
    expect(a).toBe(b)
    pending.resolve(OBSERVED)
    const [ta, tb] = await Promise.all([a, b])
    expect(ta).toBe(tb)
    expect(o.service.observe).toHaveBeenCalledTimes(1)
    // Once settled, the next tick() runs a fresh observe.
    await o.observer.tick()
    expect(o.service.observe).toHaveBeenCalledTimes(2)
  })

  it('O7: stop() during a scheduled tick clears the handle armed at its start; nothing is armed after it resolves', async () => {
    const o = makeObserver()
    const pending = deferred<RoutingObserverTick>()
    o.service.observe.mockImplementationOnce(() => pending.promise)
    o.observer.start()
    o.armed[0].fn()
    expect(o.armed).toHaveLength(2)
    o.observer.stop()
    expect(o.cleared).toEqual([o.armed[1].handle])
    pending.resolve(OBSERVED)
    await o.observer.tick()
    expect(o.armed).toHaveLength(2)
    expect(expectValidStatus(o.observer).observer).toMatchObject({ state: 'stopped', nextTickAt: null })
  })

  it('O8: enabled false → dormantReason disabled', () => {
    const o = makeObserver({ enabled: false, credentialProfileId: C })
    o.observer.start()
    const status = expectValidStatus(o.observer)
    expect(status.observer.state).toBe('dormant')
    expect(status.observer.dormantReason).toBe('disabled')
  })

  it('a dormant observer keeps its timer: the tick still runs observe (which reads only the setting) and re-arms', async () => {
    const o = makeObserver({ enabled: false, credentialProfileId: null })
    o.observer.start()
    o.armed[0].fn()
    await o.observer.tick()
    expect(o.service.observe).toHaveBeenCalledTimes(1)
    expect(o.armed.map((a) => a.ms)).toEqual([120_000, 1_800_000])
  })

  it('the default timers are real, unref()ed timers that stop() clears', () => {
    const { service } = fakeService()
    const unref = vi.fn()
    const realSetTimeout = globalThis.setTimeout
    const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
      const handle = realSetTimeout(fn, ms)
      const original = handle.unref.bind(handle)
      handle.unref = () => {
        unref()
        return original()
      }
      return handle
    }) as typeof setTimeout)
    const clear = vi.spyOn(globalThis, 'clearTimeout')
    try {
      const observer = new RoutingObserver({ service })
      observer.start()
      expect(spy).toHaveBeenCalledWith(expect.any(Function), 120_000)
      expect(unref).toHaveBeenCalledTimes(1)
      observer.stop()
      expect(clear).toHaveBeenCalledTimes(1)
      expect(service.observe).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
      clear.mockRestore()
    }
  })
})
