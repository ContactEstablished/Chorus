import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useEngineLedgerStore } from './engineLedger'
import type { LedgerSnapshot } from '../../../shared/ipc'

/**
 * Engine 10.1-4 store tests. `window.chorus` is stubbed — test the logic, not
 * the bridge (`stores/memory.test.ts`'s precedent).
 *
 * The headline cases are the SUPERSEDE guard, including that it covers the
 * spinner, and the rule that a failed load leaves the last good rows alone.
 */

const PID_A = '11111111-1111-4111-8111-111111111111'
const PID_B = '22222222-2222-4222-8222-222222222222'

const snapshot = (projectId: string, total = 1): LedgerSnapshot => ({
  projectId,
  rows: [
    {
      sessionId: `s-${projectId}`,
      agent: 'claude',
      title: 'A session',
      startedAt: '2026-09-12T10:00:00.000Z',
      hasSource: true,
      ce: { total: 100, main: 60, subagent: 40 },
      rlit: { total: 50, main: 30, subagent: 20 },
      naive: { total: 500, main: 300, subagent: 200 },
      output: { total: 10, main: 6, subagent: 4 }
    }
  ],
  dispatchesWithTokens: 1,
  dispatchesTotal: total
})

let getEngineLedgerSnapshot: ReturnType<typeof vi.fn>

beforeEach(() => {
  setActivePinia(createPinia())
  getEngineLedgerSnapshot = vi.fn()
  ;(globalThis as unknown as { window: unknown }).window = { chorus: { getEngineLedgerSnapshot } }
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useEngineLedgerStore', () => {
  it('loads a project and exposes a built view', async () => {
    getEngineLedgerSnapshot.mockResolvedValue(snapshot(PID_A, 467))
    const store = useEngineLedgerStore()
    await store.load(PID_A)

    const view = store.viewFor(PID_A)!
    expect(view.rows).toHaveLength(1)
    expect(view.rows[0].state).toBe('measured')
    expect(view.coverageText).toContain('of 467')
    expect(store.isLoading(PID_A)).toBe(false)
  })

  it('returns null for a project never loaded, rather than an empty view', () => {
    const store = useEngineLedgerStore()
    // ⚠ Absent, not an empty table: "we have not asked" and "there is nothing"
    // are different claims, the same distinction the panel draws per row.
    expect(store.viewFor(PID_B)).toBeNull()
  })

  /**
   * ⚠ THE SUPERSEDE GUARD. A slow load for A must not overwrite a fast load for
   * B, and — the half that is easy to miss — must not clear B's spinner either.
   */
  it('does not let a superseded load overwrite a newer one', async () => {
    let resolveSlow: (v: LedgerSnapshot) => void = () => {}
    const slow = new Promise<LedgerSnapshot>((r) => {
      resolveSlow = r
    })
    getEngineLedgerSnapshot.mockReturnValueOnce(slow)
    getEngineLedgerSnapshot.mockResolvedValueOnce(snapshot(PID_A, 99))

    const store = useEngineLedgerStore()
    const first = store.load(PID_A)
    await store.load(PID_A) // the newer one lands first
    expect(store.viewFor(PID_A)!.coverageText).toContain('of 99')

    resolveSlow(snapshot(PID_A, 1))
    await first
    // Still the newer result.
    expect(store.viewFor(PID_A)!.coverageText).toContain('of 99')
  })

  it('does not let a superseded load clear a live one’s spinner', async () => {
    let resolveSlow: (v: LedgerSnapshot) => void = () => {}
    const slow = new Promise<LedgerSnapshot>((r) => {
      resolveSlow = r
    })
    getEngineLedgerSnapshot.mockReturnValueOnce(slow)
    getEngineLedgerSnapshot.mockReturnValueOnce(new Promise<LedgerSnapshot>(() => {}))

    const store = useEngineLedgerStore()
    const first = store.load(PID_A)
    void store.load(PID_A) // supersedes; never settles
    expect(store.isLoading(PID_A)).toBe(true)

    resolveSlow(snapshot(PID_A))
    await first
    // ⚠ The stale load finished, but the live one has not — the spinner stays.
    expect(store.isLoading(PID_A)).toBe(true)
  })

  it('keeps projects independent', async () => {
    getEngineLedgerSnapshot.mockImplementation((pid: string) =>
      Promise.resolve(snapshot(pid, pid === PID_A ? 10 : 20))
    )
    const store = useEngineLedgerStore()
    await Promise.all([store.load(PID_A), store.load(PID_B)])
    expect(store.viewFor(PID_A)!.coverageText).toContain('of 10')
    expect(store.viewFor(PID_B)!.coverageText).toContain('of 20')
  })

  /** ⚠ A transient IPC failure must not read as "this project has no usage". */
  it('leaves the last good rows intact when a load fails', async () => {
    getEngineLedgerSnapshot.mockResolvedValueOnce(snapshot(PID_A, 42))
    const store = useEngineLedgerStore()
    await store.load(PID_A)
    expect(store.viewFor(PID_A)!.coverageText).toContain('of 42')

    getEngineLedgerSnapshot.mockRejectedValueOnce(new Error('bridge died'))
    await store.load(PID_A)
    expect(store.error).toBe('bridge died')
    expect(store.viewFor(PID_A)!.coverageText).toContain('of 42')
    expect(store.isLoading(PID_A)).toBe(false)
  })

  it('clears a previous error on a later success', async () => {
    getEngineLedgerSnapshot.mockRejectedValueOnce(new Error('nope'))
    const store = useEngineLedgerStore()
    await store.load(PID_A)
    expect(store.error).toBe('nope')

    getEngineLedgerSnapshot.mockResolvedValueOnce(snapshot(PID_A))
    await store.load(PID_A)
    expect(store.error).toBeNull()
  })
})
