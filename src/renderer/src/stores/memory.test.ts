import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useMemoryStore } from './memory'
import type { MemoryStatusWire } from '../../../shared/ipc'

/**
 * Memory store unit tests (Task 6-3). `window.chorus` is stubbed — test the
 * logic, not the bridge (the `stores/settings.test.ts` precedent).
 *
 * The headline cases are the SUPERSEDE guard and the rule that `connected` can
 * only ever be earned by an observed read (D126).
 */

const PID_A = '11111111-1111-4111-8111-111111111111'
const PID_B = '22222222-2222-4222-8222-222222222222'

function status(over: Partial<MemoryStatusWire> = {}): MemoryStatusWire {
  return {
    configured: true,
    mode: 'existing',
    auth_mode: 'none',
    host: '127.0.0.1',
    port: 7688,
    database_name: 'neo4j',
    schema_version: 0,
    last_seeded_at: null,
    updated_at: '2026-08-08T00:00:00.000Z',
    ...over
  }
}

const UNCONFIGURED: MemoryStatusWire = {
  configured: false,
  mode: null,
  auth_mode: null,
  host: null,
  port: null,
  database_name: null,
  schema_version: 0,
  last_seeded_at: null,
  updated_at: null
}

interface ChorusStub {
  getMemory: ReturnType<typeof vi.fn>
  memoryStatus: ReturnType<typeof vi.fn>
  configureMemory: ReturnType<typeof vi.fn>
  disableMemory: ReturnType<typeof vi.fn>
  testMemory: ReturnType<typeof vi.fn>
}

function stubChorus(): ChorusStub {
  const stub: ChorusStub = {
    getMemory: vi.fn().mockResolvedValue({ memory: status() }),
    memoryStatus: vi.fn().mockResolvedValue({ memory: status() }),
    configureMemory: vi.fn().mockResolvedValue({ ok: true, memory: status() }),
    disableMemory: vi.fn().mockResolvedValue({ ok: true, removed: true }),
    testMemory: vi.fn().mockResolvedValue({ ok: true, probe: 1 })
  }
  ;(globalThis as Record<string, unknown>).window = { chorus: stub }
  return stub
}

/** A promise a test can resolve by hand, so two loads can be interleaved
 *  deterministically rather than by racing timers. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('memory store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window
  })

  it('loads a project status', async () => {
    stubChorus()
    const store = useMemoryStore()
    await store.load(PID_A)
    expect(store.statusFor(PID_A)?.port).toBe(7688)
    expect(store.statusFor(PID_B)).toBeNull()
  })

  /**
   * ⚠ THE SUPERSEDE CASE. A slow first load must not overwrite a fast second
   * one — the `loadSeq` idiom, and the bug it exists to prevent is a settings
   * form showing the previous project's database.
   */
  it('a superseded load does not overwrite a newer one', async () => {
    const stub = stubChorus()
    const slow = deferred<{ memory: MemoryStatusWire }>()
    const fast = deferred<{ memory: MemoryStatusWire }>()
    stub.getMemory.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise)

    const store = useMemoryStore()
    const first = store.load(PID_A)
    const second = store.load(PID_A)

    // The SECOND load lands first and wins.
    fast.resolve({ memory: status({ port: 7999 }) })
    await second
    expect(store.statusFor(PID_A)?.port).toBe(7999)

    // The first now returns stale data, and it must be dropped on the floor.
    slow.resolve({ memory: status({ port: 7000 }) })
    await first
    expect(store.statusFor(PID_A)?.port).toBe(7999)
  })

  it('a superseded load does not clear the live one’s spinner', async () => {
    const stub = stubChorus()
    const slow = deferred<{ memory: MemoryStatusWire }>()
    const fast = deferred<{ memory: MemoryStatusWire }>()
    stub.getMemory.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise)

    const store = useMemoryStore()
    // Both are started before either resolves, so the second is genuinely still
    // in flight when the first returns — which is the case the guard is for.
    const first = store.load(PID_A)
    const second = store.load(PID_A)

    slow.resolve({ memory: status() })
    await first
    // The first (superseded) load has returned, but the SECOND is still in
    // flight, so the spinner must still be up. An UNGUARDED `loading = false`
    // here lets a stale load clear a live one's spinner — the trap.
    expect(store.loadingByProject[PID_A]).toBe(true)

    fast.resolve({ memory: status() })
    await second
    expect(store.loadingByProject[PID_A]).toBe(false)
  })

  /**
   * ⚠ THE TOKENS ARE PER PROJECT, NOT GLOBAL — the `modelSeqByProvider` lesson
   * `settings.ts` already records. The chip loads the ACTIVE project while the
   * settings screen loads the project being EDITED; a single global token would
   * let whichever landed second discard the other's still-valid result.
   */
  it('one project’s load cannot cancel another project’s', async () => {
    const stub = stubChorus()
    const a = deferred<{ memory: MemoryStatusWire }>()
    const b = deferred<{ memory: MemoryStatusWire }>()
    stub.getMemory.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)

    const store = useMemoryStore()
    const loadA = store.load(PID_A)
    const loadB = store.load(PID_B)

    b.resolve({ memory: status({ port: 7002 }) })
    await loadB
    a.resolve({ memory: status({ port: 7001 }) })
    await loadA

    // Both survive. With a global token, A would have been dropped.
    expect(store.statusFor(PID_A)?.port).toBe(7001)
    expect(store.statusFor(PID_B)?.port).toBe(7002)
  })

  it('an unconfigured project is a real answer, not an absence', async () => {
    const stub = stubChorus()
    stub.getMemory.mockResolvedValue({ memory: UNCONFIGURED })
    const store = useMemoryStore()
    await store.load(PID_A)
    expect(store.statusFor(PID_A)?.configured).toBe(false)
    expect(store.statusFor(PID_A)?.port).toBeNull()
  })

  it('a failed status read drops the fact rather than keeping a stale one', async () => {
    const stub = stubChorus()
    const store = useMemoryStore()
    await store.refreshStatus(PID_A)
    expect(store.statusFor(PID_A)).not.toBeNull()

    stub.memoryStatus.mockRejectedValueOnce(new Error('boom'))
    await store.refreshStatus(PID_A)
    // The chip then renders nothing, rather than a figure it can no longer
    // vouch for (the `worktreeCount` posture).
    expect(store.statusFor(PID_A)).toBeNull()
  })
})

describe('memory store — Connected is EARNED by an observed read (D126)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window
  })

  it('starts unknown, even for a configured project', async () => {
    stubChorus()
    const store = useMemoryStore()
    await store.load(PID_A)
    expect(store.statusFor(PID_A)?.configured).toBe(true)
    // Configured is not connected. The app has observed nothing yet.
    expect(store.connectionFor(PID_A)).toBe('unknown')
  })

  it('configuring successfully does NOT make it connected', async () => {
    stubChorus()
    const store = useMemoryStore()
    expect(await store.configure(PID_A, 'existing', 'none', 'bolt://127.0.0.1:7688', 'neo4j')).toBeNull()
    // A written config is not an observed read — the whole point of the rule.
    expect(store.connectionFor(PID_A)).toBe('unknown')
  })

  it('only a successful test sets connected, and it carries the probed value', async () => {
    stubChorus()
    const store = useMemoryStore()
    expect(await store.test(PID_A)).toBeNull()
    expect(store.connectionFor(PID_A)).toBe('connected')
    expect(store.lastProbeByProject[PID_A]).toBe(1)
  })

  it('a refused test sets failed and renders the reason verbatim', async () => {
    const stub = stubChorus()
    stub.testMemory.mockResolvedValue({ ok: false, reason: 'Nothing answered at that address.' })
    const store = useMemoryStore()
    const reason = await store.test(PID_A)
    expect(reason).toBe('Nothing answered at that address.')
    expect(store.error).toBe('Nothing answered at that address.')
    expect(store.connectionFor(PID_A)).toBe('failed')
    expect(store.lastProbeByProject[PID_A]).toBeNull()
  })

  it('re-pointing at a different database invalidates the observed connection', async () => {
    stubChorus()
    const store = useMemoryStore()
    await store.test(PID_A)
    expect(store.connectionFor(PID_A)).toBe('connected')

    await store.configure(PID_A, 'existing', 'none', 'bolt://127.0.0.1:7999', 'neo4j')
    // Otherwise the chip would claim a reachable database at an address nobody
    // has tested.
    expect(store.connectionFor(PID_A)).toBe('unknown')
    expect(store.lastProbeByProject[PID_A]).toBeNull()
  })

  it('disabling clears the status and the observed connection', async () => {
    const stub = stubChorus()
    stub.memoryStatus.mockResolvedValue({ memory: UNCONFIGURED })
    const store = useMemoryStore()
    await store.test(PID_A)
    await store.disable(PID_A)
    expect(store.connectionFor(PID_A)).toBe('unknown')
    expect(store.statusFor(PID_A)?.configured).toBe(false)
  })

  it('a configure refusal is returned verbatim and changes no state', async () => {
    const stub = stubChorus()
    stub.configureMemory.mockResolvedValue({
      ok: false,
      reason: 'Remove the username and password from the address.'
    })
    const store = useMemoryStore()
    const reason = await store.configure(PID_A, 'existing', 'none', 'bolt://u:p@h:7687', 'neo4j')
    expect(reason).toBe('Remove the username and password from the address.')
    expect(store.statusFor(PID_A)).toBeNull()
  })
})

describe('memory store — nothing capable of holding a key reaches the state', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window
  })

  /**
   * The deep-scan discipline `settings.ts` established for keys, applied to the
   * one string in this design that could carry one. Pinia state is
   * devtools-inspectable; a URI with `user:pass@` sitting in it would be
   * readable by anyone with the window open.
   */
  it('deep scan of $state after configure holds no credential-shaped string', async () => {
    const stub = stubChorus()
    // Main would refuse this URI; the test proves that even if a future main
    // returned one, the store would not be the place it came to rest.
    stub.configureMemory.mockResolvedValue({ ok: true, memory: status() })
    const store = useMemoryStore()
    await store.configure(PID_A, 'existing', 'none', 'bolt://neo4j:hunter2@127.0.0.1:7688', 'neo4j')
    const serialized = JSON.stringify(store.$state)
    expect(serialized).not.toContain('hunter2')
    expect(serialized).not.toContain('bolt://')
    expect(serialized).not.toMatch(/password|secret|token/i)
  })
})
