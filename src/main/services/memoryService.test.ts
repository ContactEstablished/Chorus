import { describe, it, expect, vi } from 'vitest'
import type { NewProjectMemoryRow, ProjectMemoryRow } from '../db/schema'
import { createMemoryService, type MemoryStore } from './memoryService'
import { createNeo4jClient, type DriverFactory, type Neo4jClient } from './neo4jClient'

/**
 * Task 6-3. The headline case here is the STRUCTURAL assertion that
 * `memory:status` opens no bolt session — made with an injected driver that
 * throws if touched, never with a comment.
 */

const PID = '11111111-1111-4111-8111-111111111111'

function row(over: Partial<ProjectMemoryRow> = {}): ProjectMemoryRow {
  return {
    projectId: PID,
    mode: 'existing',
    boltUri: 'bolt://127.0.0.1:7688',
    databaseName: 'neo4j',
    authMode: 'none',
    credentialProfileId: null,
    containerId: null,
    containerName: null,
    volumeName: null,
    boltPort: null,
    httpPort: null,
    schemaVersion: 0,
    lastSeededAt: null,
    createdAt: '2026-08-08T00:00:00.000Z',
    updatedAt: '2026-08-08T00:00:00.000Z',
    ...over
  }
}

function fakeStore(initial: ProjectMemoryRow | null = null): MemoryStore & { row: ProjectMemoryRow | null } {
  const store = {
    row: initial,
    getProjectMemory(): ProjectMemoryRow | null {
      return store.row
    },
    upsertProjectMemory(next: NewProjectMemoryRow): ProjectMemoryRow {
      store.row = { ...row(), ...next } as ProjectMemoryRow
      return store.row
    },
    deleteProjectMemory(): boolean {
      const had = store.row !== null
      store.row = null
      return had
    }
  }
  return store
}

/**
 * ⚠ THE DRIVER THAT MUST NEVER BE CALLED. Anything that reaches for a
 * connection through this fails loudly with a message naming the rule it broke,
 * rather than quietly succeeding against a stub.
 */
const forbiddenDriver: Neo4jClient = {
  probe() {
    throw new Error('memory:status opened a bolt session — D33/D53/D58 forbid it')
  },
  withSession() {
    throw new Error('memory:status opened a bolt session — D33/D53/D58 forbid it')
  },
  dispose() {
    throw new Error('memory:status disposed a driver it should never have made')
  },
  isOpen() {
    return false
  }
}

/** A driver that answers `RETURN 1` without a network. */
function stubDriver(value: unknown = 1): { client: Neo4jClient; factory: ReturnType<typeof vi.fn> } {
  const close = vi.fn(async () => {})
  const factory = vi.fn((_uri: string) => ({
    session: () => ({
      run: async () => ({ records: [{ get: () => value }] }),
      close
    }),
    close
  }))
  return { client: createNeo4jClient(factory as unknown as DriverFactory), factory }
}

describe('memoryService — status is a PURE READ', () => {
  /**
   * ⚠ AND HERE IS THIS TEST'S OWN LIMIT, STATED SO IT IS NOT READ AS STRONGER
   * THAN IT IS. The original instruction was to assert that the handler touches
   * "neither the vault nor the driver". IN THIS PHASE THE VAULT HALF IS
   * VACUOUS: `memoryService.ts` does not import `vault` at all (D128(a) took
   * credentialed mode out of Phase 6), so there is no vault to forbid touching
   * and asserting it would prove nothing. The DRIVER half is what is asserted
   * below, and it is real.
   *
   * The vault half becomes load-bearing the moment credentialed mode arrives —
   * at which point `status` could plausibly want to resolve a credential, and
   * this is the test that must stop it. Whoever ships that mode should add the
   * vault arm here rather than writing a new test.
   */
  it('answers without ever reaching for a driver', () => {
    const svc = createMemoryService(fakeStore(row()), forbiddenDriver)
    const status = svc.status(PID)
    expect(status.configured).toBe(true)
    expect(status.host).toBe('127.0.0.1')
    expect(status.port).toBe(7688)
  })

  it('answers for an UNCONFIGURED project without reaching for a driver either', () => {
    const svc = createMemoryService(fakeStore(null), forbiddenDriver)
    expect(svc.status(PID).configured).toBe(false)
  })

  it('carries no password field and no bolt URI', () => {
    const svc = createMemoryService(fakeStore(row()), forbiddenDriver)
    const keys = Object.keys(svc.status(PID)).sort()
    expect(keys).toEqual(
      [
        'authMode',
        'configured',
        'databaseName',
        'host',
        'lastSeededAt',
        'mode',
        'port',
        'schemaVersion',
        'updatedAt'
      ].sort()
    )
    for (const k of keys) {
      expect(k).not.toMatch(/key|secret|token|blob|fingerprint|password|value|uri/i)
    }
  })

  it('omits a port it cannot derive rather than guessing one', () => {
    // A hand-edited row. D76 one field down: the chip renders nothing rather
    // than a plausible-looking 7687 that is not what the row says.
    const svc = createMemoryService(fakeStore(row({ boltUri: 'garbage' })), forbiddenDriver)
    expect(svc.status(PID).port).toBeNull()
    expect(svc.status(PID).host).toBeNull()
  })

  it('an unconfigured project reports zero schema version, not null', () => {
    const svc = createMemoryService(fakeStore(null), forbiddenDriver)
    expect(svc.status(PID).schemaVersion).toBe(0)
  })
})

describe('memoryService — configure', () => {
  it('normalises the stored URI', () => {
    const store = fakeStore(null)
    const { client } = stubDriver()
    const svc = createMemoryService(store, client)
    const r = svc.configure({
      projectId: PID,
      mode: 'existing',
      authMode: 'none',
      boltUri: '  BOLT://LocalHost  ',
      databaseName: 'neo4j'
    })
    expect(r.ok).toBe(true)
    expect(store.row?.boltUri).toBe('bolt://localhost:7687')
  })

  it('⚠ REFUSES A URI CARRYING INLINE CREDENTIALS, and stores nothing', () => {
    const store = fakeStore(null)
    const { client } = stubDriver()
    const svc = createMemoryService(store, client)
    const r = svc.configure({
      projectId: PID,
      mode: 'existing',
      authMode: 'none',
      boltUri: 'bolt://neo4j:hunter2@127.0.0.1:7687',
      databaseName: 'neo4j'
    })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toMatch(/Remove the username and password/)
    // The whole point: nothing reached the table.
    expect(store.row).toBeNull()
  })

  it('refuses the two unsupported modes with their own reasons (D128(a))', () => {
    const store = fakeStore(null)
    const { client } = stubDriver()
    const svc = createMemoryService(store, client)
    for (const mode of ['local-docker', 'aura'] as const) {
      const r = svc.configure({
        projectId: PID,
        mode,
        authMode: 'none',
        boltUri: 'bolt://127.0.0.1:7687',
        databaseName: 'neo4j'
      })
      expect(r.ok).toBe(false)
      expect(store.row).toBeNull()
    }
  })

  it('refuses credentialed auth — it left the phase with eight preconditions', () => {
    const store = fakeStore(null)
    const { client } = stubDriver()
    const r = createMemoryService(store, client).configure({
      projectId: PID,
      mode: 'existing',
      authMode: 'credential',
      boltUri: 'bolt://127.0.0.1:7687',
      databaseName: 'neo4j'
    })
    expect(r.ok).toBe(false)
    expect(store.row).toBeNull()
  })

  it('never writes a credential id, a container id or a port', () => {
    const store = fakeStore(null)
    const { client } = stubDriver()
    createMemoryService(store, client).configure({
      projectId: PID,
      mode: 'existing',
      authMode: 'none',
      boltUri: 'bolt://127.0.0.1:7688',
      databaseName: 'neo4j'
    })
    // Stage 5's columns stay NULL, and credentialed mode's stays NULL for good.
    expect(store.row?.credentialProfileId).toBeNull()
    expect(store.row?.containerId).toBeNull()
    expect(store.row?.containerName).toBeNull()
    expect(store.row?.volumeName).toBeNull()
    expect(store.row?.boltPort).toBeNull()
    expect(store.row?.httpPort).toBeNull()
    // Task 6-4 owns this.
    expect(store.row?.schemaVersion).toBe(0)
  })

  it('defaults an empty database name to the one Community Edition has', () => {
    const store = fakeStore(null)
    const { client } = stubDriver()
    createMemoryService(store, client).configure({
      projectId: PID,
      mode: 'existing',
      authMode: 'none',
      boltUri: 'bolt://127.0.0.1:7688',
      databaseName: '   '
    })
    expect(store.row?.databaseName).toBe('neo4j')
  })
})

describe('memoryService — disable', () => {
  it('removes the row and says that it did', () => {
    const store = fakeStore(row())
    const svc = createMemoryService(store, forbiddenDriver)
    expect(svc.disable(PID)).toEqual({ ok: true, value: { removed: true } })
    expect(store.row).toBeNull()
  })

  it('reports honestly when there was nothing to remove', () => {
    const svc = createMemoryService(fakeStore(null), forbiddenDriver)
    expect(svc.disable(PID)).toEqual({ ok: true, value: { removed: false } })
  })

  it('⚠ OPENS NO BOLT SESSION — it deletes a config, not graph data', () => {
    // `forbiddenDriver` throws on any use, so this passing IS the assertion
    // that disable destroys nothing in Neo4j.
    const svc = createMemoryService(fakeStore(row()), forbiddenDriver)
    expect(() => svc.disable(PID)).not.toThrow()
  })
})

describe('memoryService — test is ONE live connect that ASSERTS THE VALUE', () => {
  it('succeeds and returns what RETURN 1 actually answered', async () => {
    const { client, factory } = stubDriver(1)
    const svc = createMemoryService(fakeStore(row()), client)
    await expect(svc.test(PID)).resolves.toEqual({ ok: true, value: { probe: 1 } })
    // ONE connect. Not two, not a retry.
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('⚠ FAILS WHEN THE ANSWER IS NOT 1 — a record is not a correct answer', async () => {
    // The D4 pass's lesson one layer down: a handshake, and even a response,
    // is not evidence the database can be read.
    const { client } = stubDriver(42)
    const svc = createMemoryService(fakeStore(row()), client)
    const r = await svc.test(PID)
    expect(r.ok).toBe(false)
  })

  it('normalises a Neo4j Integer', async () => {
    const { client } = stubDriver({ toNumber: () => 1 })
    const svc = createMemoryService(fakeStore(row()), client)
    await expect(svc.test(PID)).resolves.toEqual({ ok: true, value: { probe: 1 } })
  })

  it('normalises a bigint', async () => {
    const { client } = stubDriver(1n)
    const svc = createMemoryService(fakeStore(row()), client)
    await expect(svc.test(PID)).resolves.toEqual({ ok: true, value: { probe: 1 } })
  })

  it('refuses when the project has no memory configured', async () => {
    const { client, factory } = stubDriver()
    const svc = createMemoryService(fakeStore(null), client)
    const r = await svc.test(PID)
    expect(r.ok).toBe(false)
    // And it did not connect to find that out.
    expect(factory).not.toHaveBeenCalled()
  })

  it('re-validates the stored address before handing it to a driver', async () => {
    const { client, factory } = stubDriver()
    const svc = createMemoryService(fakeStore(row({ boltUri: 'bolt://n:p@h:7687' })), client)
    const r = await svc.test(PID)
    expect(r.ok).toBe(false)
    expect(factory).not.toHaveBeenCalled()
  })
})

describe('neo4jClient — refusals carry no URI, no stack trace, no Neo4j code', () => {
  const cases = [
    { code: 'Neo.ClientError.Security.Unauthorized', label: 'unauthorized' },
    { code: 'ServiceUnavailable', label: 'unreachable' },
    { code: 'ETIMEDOUT', label: 'timeout' },
    { code: 'Neo.ClientError.Database.DatabaseNotFound', label: 'no such database' },
    { code: '', label: 'unclassified' }
  ]

  it.each(cases)('$label: the reason is a sentence, not the failure', async ({ code }) => {
    const uri = 'bolt://secret-host.internal:7688'
    const err = Object.assign(new Error(`connection to ${uri} failed`), { code })
    const client = createNeo4jClient(() => ({
      session: () => ({
        run: async () => {
          throw err
        },
        close: async () => {}
      }),
      close: async () => {}
    }))
    const svc = createMemoryService(fakeStore(row({ boltUri: uri })), client)
    const r = await svc.test(PID)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).not.toContain(uri)
    expect(r.reason).not.toContain('secret-host')
    expect(r.reason).not.toContain('bolt://')
    // Never a raw Neo4j error code.
    expect(r.reason).not.toContain('Neo.')
    if (code) expect(r.reason).not.toContain(code)
    // It is a sentence.
    expect(r.reason).toMatch(/\.$/)
  })

  it('drops the driver after a failure rather than keeping a dead pool warm', async () => {
    const client = createNeo4jClient(() => ({
      session: () => ({
        run: async () => {
          throw Object.assign(new Error('nope'), { code: 'ServiceUnavailable' })
        },
        close: async () => {}
      }),
      close: async () => {}
    }))
    const svc = createMemoryService(fakeStore(row()), client)
    await svc.test(PID)
    expect(client.isOpen()).toBe(false)
  })
})

describe('neo4jClient — driver lifetime', () => {
  it('is lazy: nothing is opened until somebody tests', () => {
    const { client } = stubDriver()
    createMemoryService(fakeStore(row()), client)
    expect(client.isOpen()).toBe(false)
  })

  it('holds one driver across repeated tests of the same address', async () => {
    const { client, factory } = stubDriver()
    const svc = createMemoryService(fakeStore(row()), client)
    await svc.test(PID)
    await svc.test(PID)
    expect(factory).toHaveBeenCalledTimes(1)
    expect(client.isOpen()).toBe(true)
  })

  it('disposes the old driver when the address changes', async () => {
    const closed: string[] = []
    const factory = vi.fn((uri: string) => ({
      session: () => ({
        run: async () => ({ records: [{ get: () => 1 }] }),
        close: async () => {}
      }),
      close: async () => {
        closed.push(uri)
      }
    }))
    const client = createNeo4jClient(factory as unknown as DriverFactory)
    const store = fakeStore(row())
    const svc = createMemoryService(store, client)
    await svc.test(PID)
    store.row = row({ boltUri: 'bolt://127.0.0.1:7999' })
    await svc.test(PID)
    expect(factory).toHaveBeenCalledTimes(2)
    expect(closed).toEqual(['bolt://127.0.0.1:7688'])
  })

  it('dispose() closes the held driver — the before-quit contract', async () => {
    const close = vi.fn(async () => {})
    const client = createNeo4jClient(
      (() => ({
        session: () => ({
          run: async () => ({ records: [{ get: () => 1 }] }),
          close: async () => {}
        }),
        close
      })) as unknown as DriverFactory
    )
    const svc = createMemoryService(fakeStore(row()), client)
    await svc.test(PID)
    expect(client.isOpen()).toBe(true)
    await svc.dispose()
    expect(close).toHaveBeenCalledTimes(1)
    expect(client.isOpen()).toBe(false)
  })

  it('dispose() on a service that never connected is a no-op, not a throw', async () => {
    const { client } = stubDriver()
    const svc = createMemoryService(fakeStore(null), client)
    await expect(svc.dispose()).resolves.toBeUndefined()
  })
})
