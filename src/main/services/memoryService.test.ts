import { describe, it, expect, vi } from 'vitest'
import type { NewProjectMemoryRow, ProjectMemoryRow } from '../db/schema'
import {
  createMemoryService,
  MERGE_AGENT_SESSION,
  READ_SESSION_FACTS,
  type DockerSource,
  type MemoryStore
} from './memoryService'
import { createNeo4jClient, type DriverFactory, type Neo4jClient } from './neo4jClient'
import { CONTAINER_NAME_MISMATCH, type ContainerState } from './dockerCore'

/**
 * Task 6-3. The headline case here is the STRUCTURAL assertion that
 * `memory:status` opens no bolt session — made with an injected driver that
 * throws if touched, never with a comment.
 */

const PID = '11111111-1111-4111-8111-111111111111'

/** Task 6-5's third constructor argument: main's chosen directory for the
 *  config files Chorus writes. A LITERAL here rather than a real path — this
 *  suite writes nothing, and the value only has to travel through
 *  `mcpLaunchInput` unchanged, which is what the assertion below checks. */
/** Task 6a-2's injected git reads. Every method THROWS by default: no test in
 *  this file indexes, and a stub that quietly returned an empty list would let
 *  an accidental call look like a clean empty repository. */
const FORBIDDEN_INDEX_SOURCE = {
  rootPathFor: (): string | null => {
    throw new Error('rootPathFor must not be called by this test')
  },
  lsFiles: async (): Promise<string[]> => {
    throw new Error('lsFiles must not be called by this test')
  },
  rootCommitShas: async (): Promise<string[]> => {
    throw new Error('rootCommitShas must not be called by this test')
  },
  logNameOnly: async (): Promise<string> => {
    throw new Error('logNameOnly must not be called by this test')
  },
  countCommits: async (): Promise<number> => {
    throw new Error('countCommits must not be called by this test')
  },
  /** Task 6b-3. Throws for the same reason as its five siblings: a stub that
   *  quietly returned null would let an accidental call read as "this project
   *  has no git history" — the exact value that makes `isIndexStale` answer
   *  "not stale" and so hides a wrong call behind a plausible result. */
  headSha: async (): Promise<string | null> => {
    throw new Error('headSha must not be called by this test')
  }
}
/** Task 6a-4's injected docker, on exactly the same principle as the git reads
 *  above: every method THROWS, so any existing method that quietly grew a docker
 *  call would fail loudly here instead of silently spawning a daemon command in
 *  a unit test. The provisioner's own suite supplies a recording double. */
const FORBIDDEN_DOCKER: DockerSource = {
  available: async (): Promise<boolean> => {
    throw new Error('docker.available must not be called by this test')
  },
  inspect: async (): Promise<never> => {
    throw new Error('docker.inspect must not be called by this test')
  },
  run: async (): Promise<string> => {
    throw new Error('docker.run must not be called by this test')
  },
  start: async (): Promise<void> => {
    throw new Error('docker.start must not be called by this test')
  },
  stop: async (): Promise<void> => {
    throw new Error('docker.stop must not be called by this test')
  },
  remove: async (): Promise<void> => {
    throw new Error('docker.remove must not be called by this test')
  },
  findFreePort: async (): Promise<number | null> => {
    throw new Error('docker.findFreePort must not be called by this test')
  }
}
const MCP_OPTIONS = {
  mcpConfigDir: 'C:\\Users\\test\\AppData\\Roaming\\chorus\\mcp',
  codeIndex: FORBIDDEN_INDEX_SOURCE,
  docker: FORBIDDEN_DOCKER,
  projectNameFor: (): string | null => 'Test Project'
}

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
    const svc = createMemoryService(fakeStore(row()), forbiddenDriver, MCP_OPTIONS)
    const status = svc.status(PID)
    expect(status.configured).toBe(true)
    expect(status.host).toBe('127.0.0.1')
    expect(status.port).toBe(7688)
  })

  it('answers for an UNCONFIGURED project without reaching for a driver either', () => {
    const svc = createMemoryService(fakeStore(null), forbiddenDriver, MCP_OPTIONS)
    expect(svc.status(PID).configured).toBe(false)
  })

  it('carries no password field and no bolt URI', () => {
    const svc = createMemoryService(fakeStore(row()), forbiddenDriver, MCP_OPTIONS)
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
    const svc = createMemoryService(fakeStore(row({ boltUri: 'garbage' })), forbiddenDriver, MCP_OPTIONS)
    expect(svc.status(PID).port).toBeNull()
    expect(svc.status(PID).host).toBeNull()
  })

  it('an unconfigured project reports zero schema version, not null', () => {
    const svc = createMemoryService(fakeStore(null), forbiddenDriver, MCP_OPTIONS)
    expect(svc.status(PID).schemaVersion).toBe(0)
  })
})

describe('memoryService — configure', () => {
  it('normalises the stored URI', () => {
    const store = fakeStore(null)
    const { client } = stubDriver()
    const svc = createMemoryService(store, client, MCP_OPTIONS)
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
    const svc = createMemoryService(store, client, MCP_OPTIONS)
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

  it('refuses `aura` — still credentialed, still out (D128(a))', () => {
    const store = fakeStore(null)
    const { client } = stubDriver()
    const svc = createMemoryService(store, client, MCP_OPTIONS)
    const r = svc.configure({
      projectId: PID,
      mode: 'aura',
      authMode: 'none',
      boltUri: 'bolt://127.0.0.1:7687',
      databaseName: 'neo4j'
    })
    expect(r.ok).toBe(false)
    // ⚠ AND NOTHING WAS WRITTEN. A refused mode must not leave a half-configured
    // row behind for the next read to find.
    expect(store.row).toBeNull()
  })

  it('⚠ ACCEPTS `local-docker` as of 6a-4, writing the row like any other mode', () => {
    // The provisioner normally calls this itself, but the mode is admitted at
    // the configure boundary rather than only inside `provision` — so a project
    // pointed at a Chorus-started container by any route is stored as
    // `local-docker`, and `row.mode` stays the single answer to "is this ours".
    const store = fakeStore(null)
    const { client } = stubDriver()
    const svc = createMemoryService(store, client, MCP_OPTIONS)
    const r = svc.configure({
      projectId: PID,
      mode: 'local-docker',
      authMode: 'none',
      boltUri: 'bolt://127.0.0.1:7699',
      databaseName: 'neo4j'
    })
    expect(r.ok).toBe(true)
    expect(store.row?.mode).toBe('local-docker')
  })

  it('refuses credentialed auth — it left the phase with eight preconditions', () => {
    const store = fakeStore(null)
    const { client } = stubDriver()
    const r = createMemoryService(store, client, MCP_OPTIONS).configure({
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
    createMemoryService(store, client, MCP_OPTIONS).configure({
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
    createMemoryService(store, client, MCP_OPTIONS).configure({
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
    const svc = createMemoryService(store, forbiddenDriver, MCP_OPTIONS)
    expect(svc.disable(PID)).toEqual({ ok: true, value: { removed: true } })
    expect(store.row).toBeNull()
  })

  it('reports honestly when there was nothing to remove', () => {
    const svc = createMemoryService(fakeStore(null), forbiddenDriver, MCP_OPTIONS)
    expect(svc.disable(PID)).toEqual({ ok: true, value: { removed: false } })
  })

  it('⚠ OPENS NO BOLT SESSION — it deletes a config, not graph data', () => {
    // `forbiddenDriver` throws on any use, so this passing IS the assertion
    // that disable destroys nothing in Neo4j.
    const svc = createMemoryService(fakeStore(row()), forbiddenDriver, MCP_OPTIONS)
    expect(() => svc.disable(PID)).not.toThrow()
  })
})

describe('memoryService — test is ONE live connect that ASSERTS THE VALUE', () => {
  it('succeeds and returns what RETURN 1 actually answered', async () => {
    const { client, factory } = stubDriver(1)
    const svc = createMemoryService(fakeStore(row()), client, MCP_OPTIONS)
    await expect(svc.test(PID)).resolves.toEqual({ ok: true, value: { probe: 1 } })
    // ONE connect. Not two, not a retry.
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('⚠ FAILS WHEN THE ANSWER IS NOT 1 — a record is not a correct answer', async () => {
    // The D4 pass's lesson one layer down: a handshake, and even a response,
    // is not evidence the database can be read.
    const { client } = stubDriver(42)
    const svc = createMemoryService(fakeStore(row()), client, MCP_OPTIONS)
    const r = await svc.test(PID)
    expect(r.ok).toBe(false)
  })

  it('normalises a Neo4j Integer', async () => {
    const { client } = stubDriver({ toNumber: () => 1 })
    const svc = createMemoryService(fakeStore(row()), client, MCP_OPTIONS)
    await expect(svc.test(PID)).resolves.toEqual({ ok: true, value: { probe: 1 } })
  })

  it('normalises a bigint', async () => {
    const { client } = stubDriver(1n)
    const svc = createMemoryService(fakeStore(row()), client, MCP_OPTIONS)
    await expect(svc.test(PID)).resolves.toEqual({ ok: true, value: { probe: 1 } })
  })

  it('refuses when the project has no memory configured', async () => {
    const { client, factory } = stubDriver()
    const svc = createMemoryService(fakeStore(null), client, MCP_OPTIONS)
    const r = await svc.test(PID)
    expect(r.ok).toBe(false)
    // And it did not connect to find that out.
    expect(factory).not.toHaveBeenCalled()
  })

  it('re-validates the stored address before handing it to a driver', async () => {
    const { client, factory } = stubDriver()
    const svc = createMemoryService(fakeStore(row({ boltUri: 'bolt://n:p@h:7687' })), client, MCP_OPTIONS)
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
    const svc = createMemoryService(fakeStore(row({ boltUri: uri })), client, MCP_OPTIONS)
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
    const svc = createMemoryService(fakeStore(row()), client, MCP_OPTIONS)
    await svc.test(PID)
    expect(client.isOpen()).toBe(false)
  })
})

describe('neo4jClient — driver lifetime', () => {
  it('is lazy: nothing is opened until somebody tests', () => {
    const { client } = stubDriver()
    createMemoryService(fakeStore(row()), client, MCP_OPTIONS)
    expect(client.isOpen()).toBe(false)
  })

  it('holds one driver across repeated tests of the same address', async () => {
    const { client, factory } = stubDriver()
    const svc = createMemoryService(fakeStore(row()), client, MCP_OPTIONS)
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
    const svc = createMemoryService(store, client, MCP_OPTIONS)
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
    const svc = createMemoryService(fakeStore(row()), client, MCP_OPTIONS)
    await svc.test(PID)
    expect(client.isOpen()).toBe(true)
    await svc.dispose()
    expect(close).toHaveBeenCalledTimes(1)
    expect(client.isOpen()).toBe(false)
  })

  it('dispose() on a service that never connected is a no-op, not a throw', async () => {
    const { client } = stubDriver()
    const svc = createMemoryService(fakeStore(null), client, MCP_OPTIONS)
    await expect(svc.dispose()).resolves.toBeUndefined()
  })
})

/**
 * Task 6-5: the MCP server ref this service assembles for the launch path.
 *
 * ⚠ IT IS THE ONE PLACE THE SERVER IS DESCRIBED, and every value in it is
 * non-secret by construction — which is what makes it safe for an adapter to
 * write into another tool's config file.
 */
describe('Task 6-5: mcpLaunchInput — what an agent is told about the graph', () => {
  it('⚠ is a PURE READ, like status — it never reaches for a driver', () => {
    const svc = createMemoryService(fakeStore(row()), forbiddenDriver, MCP_OPTIONS)
    expect(svc.mcpLaunchInput(PID)).not.toBeNull()
  })

  it('names the measured server: uvx mcp-neo4j-cypher, NEO4J_URL, NEO4J_DATABASE', () => {
    const svc = createMemoryService(fakeStore(row()), forbiddenDriver, MCP_OPTIONS)
    const input = svc.mcpLaunchInput(PID)
    expect(input?.servers).toEqual([
      {
        name: 'chorus-memory',
        command: 'uvx',
        args: ['mcp-neo4j-cypher'],
        // ⚠ `NEO4J_URL`, NOT `NEO4J_URI`: 6-1 measured that the server reads URL
        // first (utils.py:68) and confirmed the precedence live. And NO
        // username, NO password — local mode connects to an auth-disabled
        // database, so there is nothing to name.
        env: { NEO4J_URL: 'bolt://127.0.0.1:7688', NEO4J_DATABASE: 'neo4j' }
      }
    ])
  })

  it('⚠ carries NO known secrets in this phase, and that is D128(a) rather than an omission', () => {
    const svc = createMemoryService(fakeStore(row()), forbiddenDriver, MCP_OPTIONS)
    expect(svc.mcpLaunchInput(PID)?.knownSecrets).toEqual([])
  })

  it('hands main’s directory straight through — the adapter never computes one', () => {
    const svc = createMemoryService(fakeStore(row()), forbiddenDriver, MCP_OPTIONS)
    expect(svc.mcpLaunchInput(PID)?.chorusConfigDir).toBe(MCP_OPTIONS.mcpConfigDir)
  })

  it('returns null for an unconfigured project — write nothing, rather than write empty', () => {
    const svc = createMemoryService(fakeStore(null), forbiddenDriver, MCP_OPTIONS)
    expect(svc.mcpLaunchInput(PID)).toBeNull()
  })

  it('⚠ returns null for an unparseable stored URI rather than writing a bad address', () => {
    // The row is re-validated on the way OUT, exactly as `test` and `seed` do:
    // this is the last point before a string is written into another program's
    // config file.
    const svc = createMemoryService(fakeStore(row({ boltUri: 'garbage' })), forbiddenDriver, MCP_OPTIONS)
    expect(svc.mcpLaunchInput(PID)).toBeNull()
  })

  it('⚠ emits the NORMALISED uri — the same one `test` would connect to', () => {
    const svc = createMemoryService(
      fakeStore(row({ boltUri: 'bolt://LOCALHOST' })),
      forbiddenDriver,
      MCP_OPTIONS
    )
    expect(svc.mcpLaunchInput(PID)?.servers[0].env?.NEO4J_URL).toBe('bolt://localhost:7687')
  })
})

/* ─────────────────── Task 6a-4: the provisioner ────────────────────────── */

/**
 * A recording docker double. Unlike `FORBIDDEN_DOCKER` above it answers, because
 * these tests are ABOUT the docker path — but every call is recorded so a test
 * can assert what was NOT done, which is where F49 lives.
 */
function fakeDocker(
  over: Partial<{
    available: boolean
    inspect: ContainerState | null
    inspectSequence: (ContainerState | null)[]
    freePort: number | null
  }> = {}
): DockerSource & { calls: string[] } {
  const calls: string[] = []
  let inspectCount = 0
  return {
    calls,
    available: async () => {
      calls.push('available')
      return over.available ?? true
    },
    inspect: async (name: string) => {
      calls.push(`inspect:${name}`)
      if (over.inspectSequence) return over.inspectSequence[inspectCount++] ?? null
      return over.inspect ?? null
    },
    run: async (o: { containerName: string; volumeName: string; boltPort: number }) => {
      calls.push(`run:${o.containerName}:${o.volumeName}:${o.boltPort}`)
      return 'sha256deadbeef'
    },
    start: async (name: string) => {
      calls.push(`start:${name}`)
    },
    stop: async (name: string) => {
      calls.push(`stop:${name}`)
    },
    remove: async (name: string) => {
      calls.push(`remove:${name}`)
    },
    findFreePort: async () => {
      calls.push('findFreePort')
      return over.freePort === undefined ? 7690 : over.freePort
    }
  }
}

const RUNNING: ContainerState = {
  id: 'abc123456789',
  name: 'chorus-test-project-11111111',
  state: 'running',
  status: 'Up 3 seconds',
  ports: '127.0.0.1:7690->7687/tcp'
}

const PROVISIONED_NAME = 'chorus-test-project-11111111'

function opts(docker: DockerSource): typeof MCP_OPTIONS {
  return { ...MCP_OPTIONS, docker }
}

describe('memoryService — provision', () => {
  it('⚠ refuses without docker, naming what STILL WORKS', async () => {
    const docker = fakeDocker({ available: false })
    const svc = createMemoryService(fakeStore(null), stubDriver().client, opts(docker))
    const r = await svc.provision(PID)
    expect(r.ok).toBe(false)
    if (r.ok) return
    // A refusal that only says "no" reads as "the feature is broken". Memory
    // against a hand-started database is exactly what Phase 6 shipped.
    expect(r.reason).toContain('Docker is not available')
    expect(r.reason).toMatch(/yourself/)
    // ⚠ AND IT STOPPED THERE. Nothing was created, nothing was written.
    expect(docker.calls).toEqual(['available'])
  })

  it('creates a container, waits for bolt, and stores what docker gave back', async () => {
    const docker = fakeDocker({ freePort: 7690 })
    const store = fakeStore(null)
    const svc = createMemoryService(store, stubDriver().client, opts(docker))
    const r = await svc.provision(PID)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.adopted).toBe(false)
    expect(r.value.boltPort).toBe(7690)
    expect(r.value.containerName).toBe(PROVISIONED_NAME)
    expect(r.value.volumeName).toBe(`${PROVISIONED_NAME}-data`)
    // The row carries the container columns v16 created and left NULL until now.
    expect(store.row?.mode).toBe('local-docker')
    // ⚠ SHORTENED: the create path now normalises through shortContainerId so a
    // created container and an adopted one store the same format.
    expect(store.row?.containerId).toBe('sha256deadbe')
    expect(store.row?.boltPort).toBe(7690)
    expect(store.row?.volumeName).toBe(`${PROVISIONED_NAME}-data`)
    // ⚠ THE BROWSER PORT IS NEVER PUBLISHED, so there is nothing to record.
    expect(store.row?.httpPort).toBeNull()
    expect(store.row?.boltUri).toBe('bolt://127.0.0.1:7690')
  })

  it('⚠ ADOPTS an existing container instead of creating a second one', async () => {
    // The second provision of the same project — after a machine restart — is
    // the ordinary case. Creating a duplicate is near-invisible: everything
    // works, twice, against two different databases.
    const docker = fakeDocker({ inspect: RUNNING })
    const store = fakeStore(null)
    const svc = createMemoryService(store, stubDriver().client, opts(docker))
    const r = await svc.provision(PID)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.adopted).toBe(true)
    expect(docker.calls.some((c) => c.startsWith('run:'))).toBe(false)
    // The port comes from what docker PUBLISHED, not from the stored row.
    expect(r.value.boltPort).toBe(7690)
  })

  it('starts an adopted container that was stopped, then re-reads its port', async () => {
    const stopped: ContainerState = { ...RUNNING, state: 'exited', ports: '' }
    const docker = fakeDocker({ inspectSequence: [stopped, RUNNING] })
    const svc = createMemoryService(fakeStore(null), stubDriver().client, opts(docker))
    const r = await svc.provision(PID)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(docker.calls).toContain(`start:${PROVISIONED_NAME}`)
    // A stopped container publishes nothing, so the port is only knowable after
    // starting it — reading before would have stored null.
    expect(r.value.boltPort).toBe(7690)
  })

  it('refuses with the authored sentence when no port is free', async () => {
    const docker = fakeDocker({ freePort: null })
    const svc = createMemoryService(fakeStore(null), stubDriver().client, opts(docker))
    const r = await svc.provision(PID)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toContain('7688')
    expect(docker.calls.some((c) => c.startsWith('run:'))).toBe(false)
  })

  it('⚠ never asks docker to touch a volume, on any provision path', async () => {
    const docker = fakeDocker()
    const svc = createMemoryService(fakeStore(null), stubDriver().client, opts(docker))
    await svc.provision(PID)
    expect(docker.calls.some((c) => /volume/i.test(c))).toBe(false)
  })
})

describe('memoryService — container lifecycle', () => {
  const provisioned = row({
    mode: 'local-docker',
    containerName: PROVISIONED_NAME,
    volumeName: `${PROVISIONED_NAME}-data`,
    containerId: 'abc123456789',
    boltPort: 7690
  })

  it('⚠ reports a row naming NO container as a real state, not an error', async () => {
    // The project is pointed at a database somebody else started; the UI renders
    // no lifecycle controls for it (D76).
    const svc = createMemoryService(fakeStore(row()), stubDriver().client, opts(fakeDocker()))
    const r = await svc.containerStatus(PID)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.containerName).toBeNull()
    expect(r.value.exists).toBe(false)
  })

  it('⚠ HEALS A STALE ROW: a container removed behind Chorus’ back reads as gone', async () => {
    const docker = fakeDocker({ inspect: null })
    const svc = createMemoryService(fakeStore(provisioned), stubDriver().client, opts(docker))
    const r = await svc.containerStatus(PID)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // The row still claims a container; docker is the authority and says no.
    expect(r.value.exists).toBe(false)
    expect(r.value.running).toBe(false)
    expect(r.value.publishedAt).toBeNull()
  })

  it('reports a running container with what docker actually published', async () => {
    const docker = fakeDocker({ inspect: RUNNING })
    const svc = createMemoryService(fakeStore(provisioned), stubDriver().client, opts(docker))
    const r = await svc.containerStatus(PID)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.running).toBe(true)
    expect(r.value.state).toBe('running')
    expect(r.value.publishedAt).toBe('127.0.0.1:7690')
  })

  it('stop reports the state docker reports AFTER the action, not the intent', async () => {
    const stopped: ContainerState = { ...RUNNING, state: 'exited', ports: '' }
    const docker = fakeDocker({ inspectSequence: [stopped] })
    const svc = createMemoryService(fakeStore(provisioned), stubDriver().client, opts(docker))
    const r = await svc.containerStop(PID)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(docker.calls).toContain(`stop:${PROVISIONED_NAME}`)
    expect(r.value.running).toBe(false)
    // ⚠ AND A STOPPED CONTAINER PUBLISHES NOTHING — measured on docker 29.7.2.
    expect(r.value.publishedAt).toBeNull()
  })
})

describe('⚠ memoryService — removal is gated, and the volume survives', () => {
  const provisioned = row({
    mode: 'local-docker',
    containerName: PROVISIONED_NAME,
    volumeName: `${PROVISIONED_NAME}-data`,
    containerId: 'abc123456789',
    boltPort: 7690
  })

  it('REFUSES a wrong typed name, and touches nothing', async () => {
    const docker = fakeDocker({ inspect: RUNNING })
    const store = fakeStore(provisioned)
    const svc = createMemoryService(store, stubDriver().client, opts(docker))
    const r = await svc.containerRemove(PID, 'chorus-test-project-WRONG')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe(CONTAINER_NAME_MISMATCH)
    // ⚠ THE GATE IS BEFORE THE FIRST DOCKER CALL. A refusal that had already
    // stopped the container would be a refusal in name only.
    expect(docker.calls).toEqual([])
    expect(store.row?.containerId).toBe('abc123456789')
  })

  it('removes on the exact name, stopping first for a clean flush', async () => {
    const docker = fakeDocker({ inspect: RUNNING })
    const store = fakeStore(provisioned)
    const svc = createMemoryService(store, stubDriver().client, opts(docker))
    const r = await svc.containerRemove(PID, PROVISIONED_NAME)
    expect(r.ok).toBe(true)
    // Neo4j flushes its store on SIGTERM, and that store is the volume this
    // whole task exists to preserve.
    expect(docker.calls).toContain(`stop:${PROVISIONED_NAME}`)
    expect(docker.calls).toContain(`remove:${PROVISIONED_NAME}`)
  })

  it('⚠ KEEPS `volume_name` ON THE ROW after removing the container', async () => {
    // The volume outlives the container (F49). Forgetting its name would leave
    // the user unable to name the thing they own — and the copy tells them to
    // remove it by hand if they mean to, which needs the name.
    const store = fakeStore(provisioned)
    const svc = createMemoryService(
      store,
      stubDriver().client,
      opts(fakeDocker({ inspect: RUNNING }))
    )
    await svc.containerRemove(PID, PROVISIONED_NAME)
    expect(store.row?.volumeName).toBe(`${PROVISIONED_NAME}-data`)
    // The container is gone, so its id is no longer claimed.
    expect(store.row?.containerId).toBeNull()
  })

  it('⚠ NEVER asks docker to touch a volume, on any removal path', async () => {
    const docker = fakeDocker({ inspect: RUNNING })
    const svc = createMemoryService(fakeStore(provisioned), stubDriver().client, opts(docker))
    await svc.containerRemove(PID, PROVISIONED_NAME)
    expect(docker.calls.some((c) => /volume/i.test(c))).toBe(false)
  })

  it('⚠ `disable` still removes ONLY the config, and speaks to no container', async () => {
    // The sentence this method's docblock has carried since Phase 6 must stay
    // true now that containers exist: it destroys no graph data, and after this
    // task it must not stop the container either.
    const docker = fakeDocker({ inspect: RUNNING })
    const store = fakeStore(provisioned)
    const svc = createMemoryService(store, stubDriver().client, opts(docker))
    const r = svc.disable(PID)
    expect(r.ok).toBe(true)
    expect(store.row).toBeNull()
    expect(docker.calls).toEqual([])
  })
})

/* ══ Task 6b-2 — the :AgentSession MERGE and the reachable gate (D169) ══ */

/**
 * A driver whose statements are RECORDED, so the test can assert what Cypher
 * actually crossed the wire rather than that a method was called.
 *
 * `results` is consumed in order, one entry per `run`. A `throw` marker makes
 * that statement reject, which is how the "the read can never fail the gate"
 * case is built without a second driver shape.
 */
function recordingDriver(results: readonly unknown[]): {
  client: Neo4jClient
  statements: string[]
  params: Record<string, unknown>[]
} {
  const statements: string[] = []
  const params: Record<string, unknown>[] = []
  let i = 0
  const close = vi.fn(async () => {})
  const factory = vi.fn((_uri: string) => ({
    session: () => ({
      run: async (cypher: string, p?: Record<string, unknown>) => {
        statements.push(cypher)
        params.push(p ?? {})
        const next = results[i++]
        if (next === 'throw') throw new Error('the read failed')
        return { records: (next as { records?: unknown[] })?.records ?? [] }
      },
      close
    }),
    close
  }))
  return {
    client: createNeo4jClient(factory as unknown as DriverFactory),
    statements,
    params
  }
}

/** One record, in the shape `neo4jClient` normalises from. */
function rec(obj: Record<string, unknown>): { get: (k: string) => unknown; keys: string[] } {
  return { get: (k: string) => obj[k], keys: Object.keys(obj) }
}

const REGISTRATION = {
  sessionId: '22222222-2222-4222-8222-222222222222',
  agent: 'claude',
  model: null,
  startedAt: '2026-08-20T10:00:00.000Z'
}

describe('memoryService.registerAgentSession — the MERGE IS the reachability probe', () => {
  it('MERGEs first, with exactly the five SET properties plus the id', async () => {
    const d = recordingDriver([{ records: [] }, { records: [rec({ files: 468, repoId: 'a92099d9' })] }])
    const svc = createMemoryService(fakeStore(row()), d.client, MCP_OPTIONS)
    const out = await svc.registerAgentSession(PID, REGISTRATION)

    expect(out.ok).toBe(true)
    // ⚠ THE ORDER IS THE DESIGN, not an implementation detail. The MERGE runs
    // FIRST and alone decides the gate; the facts read runs second and may not.
    expect(d.statements[0]).toContain('MERGE (s:AgentSession {id: $sessionId})')
    for (const prop of ['chorusProjectId', 'agent', 'model', 'startedAt', 'writtenVia']) {
      expect(d.statements[0]).toContain(prop)
    }
    // ⚠ `writtenVia = 'app'`, NOT 'mcp'. Chorus wrote this node; an agent did
    // not. The distinction is what keeps :AgentSession out of the provenance
    // question it is only the attribution half of.
    expect(d.statements[0]).toContain("s.writtenVia      = 'app'")
    expect(d.params[0]).toMatchObject({
      sessionId: REGISTRATION.sessionId,
      projectId: PID,
      agent: 'claude',
      model: null,
      startedAt: REGISTRATION.startedAt
    })
  })

  it('returns the repoId and file count the graph itself answered', async () => {
    const d = recordingDriver([
      { records: [] },
      { records: [rec({ files: 468, repoId: 'a92099d9', lastIndexedHead: 'deadbee' })] }
    ])
    const svc = createMemoryService(fakeStore(row()), d.client, MCP_OPTIONS)
    const out = await svc.registerAgentSession(PID, REGISTRATION)

    // Task 6b-3 added `lastIndexedHead` to this SAME statement rather than
    // opening a second connection: the reachability gate, the attribution node
    // and the freshness read are one round trip.
    expect(out).toEqual({
      ok: true,
      value: { repoId: 'a92099d9', indexedFiles: 468, lastIndexedHead: 'deadbee' }
    })
    // ⚠ `OPTIONAL MATCH` ON :Project, NEVER A PLAIN MATCH. A project that has
    // never been indexed has no :Project node, and a plain MATCH would return
    // zero rows and take the MERGE's result with it — a failure that looks
    // exactly like an unreachable graph, hit by every never-indexed project.
    expect(d.statements[1]).toContain('OPTIONAL MATCH (p:Project {id: $projectId})')
    // Every mention of the :Project match is the OPTIONAL one — a bare
    // `MATCH (p:Project` anywhere in this statement is the defect above.
    expect(d.statements[1].split('MATCH (p:Project').length - 1).toBe(1)
    expect(d.statements[1].split('OPTIONAL MATCH (p:Project').length - 1).toBe(1)
    // ⚠ IT READS THE repoId THE GRAPH HOLDS RATHER THAN COMPUTING ONE. A
    // `git rev-list` at launch would be a process spawn on the launch path and
    // could disagree with what the :Commit nodes carry.
    expect(d.statements[1]).toContain('MATCH (f:File {workspaceInstanceId: $wid})')
    // ⚠ `pj:<projectId>`, ALWAYS. A `wt:` id would match no structural node.
    expect(d.params[1].wid).toBe(`pj:${PID}`)
  })

  it('⚠ the FACTS READ can never fail the gate — a throwing second statement still returns ok', async () => {
    // The MERGE already succeeded, so the graph IS reachable. Letting a failed
    // read of two optional facts withhold the contract would gate the feature on
    // something it does not need. It degrades to `unknown` instead.
    const d = recordingDriver([{ records: [] }, 'throw'])
    const svc = createMemoryService(fakeStore(row()), d.client, MCP_OPTIONS)
    const out = await svc.registerAgentSession(PID, REGISTRATION)

    // 6b-3's head degrades with the other two: a head the launch could not read
    // makes the contract say `unknown` and schedules NO index, which is honest
    // rather than a re-index on a guess.
    expect(out).toEqual({
      ok: true,
      value: { repoId: null, indexedFiles: 0, lastIndexedHead: null }
    })
  })

  it('an empty facts row degrades to unknown rather than throwing', async () => {
    const d = recordingDriver([{ records: [] }, { records: [] }])
    const svc = createMemoryService(fakeStore(row()), d.client, MCP_OPTIONS)
    const out = await svc.registerAgentSession(PID, REGISTRATION)

    expect(out).toEqual({
      ok: true,
      value: { repoId: null, indexedFiles: 0, lastIndexedHead: null }
    })
  })

  it('⚠ an unreachable graph refuses, and the reason carries NO bolt URI', async () => {
    // `withSession` classifies its error and never forwards it — a driver
    // message carries the URI on several paths, and a refusal string is a
    // surface that gets pasted into bug reports.
    const boom = vi.fn((_uri: string) => ({
      session: () => ({
        run: async () => {
          throw new Error('Could not perform discovery on bolt://127.0.0.1:7688')
        },
        close: async () => {}
      }),
      close: async () => {}
    }))
    const client = createNeo4jClient(boom as unknown as DriverFactory)
    const svc = createMemoryService(fakeStore(row()), client, MCP_OPTIONS)
    const out = await svc.registerAgentSession(PID, REGISTRATION)

    expect(out.ok).toBe(false)
    const reason = out.ok ? '' : out.reason
    expect(reason).not.toContain('bolt://')
    expect(reason).not.toContain('7688')
    expect(reason).not.toContain('127.0.0.1')
  })

  it('⚠ an UNCONFIGURED project refuses WITHOUT TOUCHING THE DRIVER', async () => {
    // Asserted with the file's own forbidden double rather than by inspecting
    // call counts: the launch path runs for every project, and most projects
    // have no memory, so a bolt connect here would be a connect on nearly every
    // launch in the app.
    const svc = createMemoryService(fakeStore(null), forbiddenDriver, MCP_OPTIONS)
    const out = await svc.registerAgentSession(PID, REGISTRATION)
    expect(out.ok).toBe(false)
  })

  it('⚠ NEITHER statement contains a deletion verb — :AgentSession is append-only', async () => {
    // Walked over the exported constants the way codeIndexCore.test.ts walks the
    // indexer's. PRODUCED edges hang off these nodes; deleting one would
    // silently un-source every memory it produced.
    for (const cypher of [MERGE_AGENT_SESSION, READ_SESSION_FACTS]) {
      expect(cypher).not.toMatch(/\bDELETE\b/)
      expect(cypher).not.toMatch(/\bDETACH\b/)
      expect(cypher).not.toMatch(/\bREMOVE\b/)
    }
  })

  it('the MERGE is idempotent by construction — same id, no CREATE', () => {
    // A restart, a session:restart and the restore relaunch all pass the SAME
    // sessions.id, so they land on the same node instead of orphaning it. That
    // is the whole reason the identity is sessions.id and not a fresh UUID.
    expect(MERGE_AGENT_SESSION).toContain('MERGE (s:AgentSession {id: $sessionId})')
    expect(MERGE_AGENT_SESSION).not.toMatch(/\bCREATE\b/)
  })
})

/* ───────────── Task 6b-3: the launch's container start (D170(a)) ───────────── */

const LOCAL_DOCKER = {
  mode: 'local-docker' as const,
  containerName: PROVISIONED_NAME,
  volumeName: `${PROVISIONED_NAME}-data`,
  boltPort: 7690,
  boltUri: 'bolt://127.0.0.1:7690'
}

const STOPPED: ContainerState = {
  id: 'abc123456789',
  name: PROVISIONED_NAME,
  state: 'exited',
  status: 'Exited (0) 2 minutes ago',
  ports: ''
}

/**
 * A driver whose `probe` THROWS IF IT IS CALLED AT ALL.
 *
 * ⚠ THIS IS THE INSTRUMENT FOR D173 Q6's FAIL-FAST, and it is structural rather
 * than a `calls`-array read: "not one bolt poll" is asserted by making a poll
 * impossible, so the test cannot pass because somebody forgot to check a
 * counter.
 */
const forbiddenProbeDriver: Neo4jClient = {
  probe() {
    throw new Error('a bolt probe was made after a start that never succeeded — D173 Q6 forbids it')
  },
  withSession() {
    throw new Error('withSession must not be called by ensureStartedForLaunch')
  },
  dispose: async () => {},
  isOpen: () => false
}

/** A driver whose probe fails `failures` times and then answers. Counts its own
 *  calls so a test can assert the NUMBER of probes rather than only the outcome. */
function countingProbeDriver(failures: number): { client: Neo4jClient; probes: () => number } {
  let n = 0
  const client: Neo4jClient = {
    async probe() {
      n += 1
      return n > failures
        ? { ok: true as const, value: 1 }
        : { ok: false as const, reason: 'the database did not answer' }
    },
    withSession() {
      throw new Error('withSession must not be called by ensureStartedForLaunch')
    },
    dispose: async () => {},
    isOpen: () => false
  }
  return { client, probes: () => n }
}

describe('6b-3: ensureStartedForLaunch — the guard order IS the feature', () => {
  it('an unconfigured project does nothing, and makes NOT ONE docker call', async () => {
    const svc = createMemoryService(fakeStore(null), forbiddenProbeDriver, opts(FORBIDDEN_DOCKER))
    expect(await svc.ensureStartedForLaunch(PID)).toEqual({
      started: false,
      ready: false,
      waitedMs: 0,
      reason: null
    })
  })

  it('⚠ mode `existing` MAKES NOT ONE DOCKER CALL — the headline non-goal of this task', async () => {
    // D170: Chorus does not own an `existing` container and NEVER starts one.
    // Asserted against the THROWING double, so the guarantee is structural: if
    // the mode test ever moves below `docker.available()`, this throws rather
    // than quietly passing with an empty calls array.
    const svc = createMemoryService(
      fakeStore(row({ mode: 'existing', containerName: PROVISIONED_NAME })),
      forbiddenProbeDriver,
      opts(FORBIDDEN_DOCKER)
    )
    expect(await svc.ensureStartedForLaunch(PID)).toEqual({
      started: false,
      ready: false,
      waitedMs: 0,
      reason: null
    })
  })

  it('⚠ mode `aura` makes not one docker call either — the rule is the mode, not the name', async () => {
    const svc = createMemoryService(
      fakeStore(row({ mode: 'aura', containerName: PROVISIONED_NAME })),
      forbiddenProbeDriver,
      opts(FORBIDDEN_DOCKER)
    )
    expect((await svc.ensureStartedForLaunch(PID)).started).toBe(false)
  })

  it('a `local-docker` row with no container name does nothing, and makes no docker call', async () => {
    // A container removed by hand. A launch reports it; it does NOT re-provision,
    // because provisioning is a click and may pull ~600 MB.
    const svc = createMemoryService(
      fakeStore(row({ ...LOCAL_DOCKER, containerName: null })),
      forbiddenProbeDriver,
      opts(FORBIDDEN_DOCKER)
    )
    expect((await svc.ensureStartedForLaunch(PID)).reason).toBeNull()
  })

  it('docker unavailable is REPORTED, and nothing is started', async () => {
    const docker = fakeDocker({ available: false })
    const svc = createMemoryService(
      fakeStore(row(LOCAL_DOCKER)),
      forbiddenProbeDriver,
      opts(docker)
    )
    const out = await svc.ensureStartedForLaunch(PID)
    expect(out.started).toBe(false)
    expect(out.reason).toBeTruthy()
    expect(out.waitedMs).toBe(0)
    expect(docker.calls.filter((c) => c.startsWith('start:'))).toEqual([])
  })

  it('a container docker says is GONE is reported, and is never re-provisioned', async () => {
    const docker = fakeDocker({ inspect: null })
    const svc = createMemoryService(
      fakeStore(row(LOCAL_DOCKER)),
      forbiddenProbeDriver,
      opts(docker)
    )
    const out = await svc.ensureStartedForLaunch(PID)
    expect(out.started).toBe(false)
    expect(out.reason).toContain('no longer on this machine')
    // ⚠ NO `run`, EVER. Provisioning is a click (D58).
    expect(docker.calls.filter((c) => c.startsWith('run:'))).toEqual([])
    expect(docker.calls.filter((c) => c.startsWith('start:'))).toEqual([])
  })

  it('⚠ THE COMMON CASE COSTS NOTHING: already running -> no start AND NO PROBE', async () => {
    // The probe double throws, so "no probe" is proved rather than counted. A
    // probe here would add milliseconds to every launch of an already-running
    // graph for an answer D169's MERGE is about to give anyway.
    const docker = fakeDocker({ inspect: RUNNING })
    const svc = createMemoryService(
      fakeStore(row(LOCAL_DOCKER)),
      forbiddenProbeDriver,
      opts(docker)
    )
    expect(await svc.ensureStartedForLaunch(PID)).toEqual({
      started: false,
      ready: true,
      waitedMs: 0,
      reason: null
    })
    expect(docker.calls.filter((c) => c.startsWith('start:'))).toEqual([])
  })

  it('not running -> start called EXACTLY ONCE, then bolt polled until it answers', async () => {
    const docker = fakeDocker({ inspect: STOPPED })
    const probe = countingProbeDriver(2)
    const svc = createMemoryService(fakeStore(row(LOCAL_DOCKER)), probe.client, opts(docker))
    const out = await svc.ensureStartedForLaunch(PID)

    expect(out.started).toBe(true)
    expect(out.ready).toBe(true)
    // ⚠ EXACTLY ONE START. A retry loop is a timer wearing a different hat.
    expect(docker.calls.filter((c) => c.startsWith('start:'))).toEqual([`start:${PROVISIONED_NAME}`])
    // Two refusals then an answer — the number of probes is the assertion.
    expect(probe.probes()).toBe(3)
  })

  it('⚠ A FAILED `docker start` COSTS NOT ONE BOLT PROBE (D173 Q6) — waitedMs 0, started false', async () => {
    // The whole point of the fail-fast: a container that never started will
    // never answer, and polling it would spend the entire 15 s budget proving
    // so. Asserted with the THROWING probe double, so a poll cannot happen
    // silently — and this is what makes such a launch cost under 2 s of wall
    // time, which the runtime drive measures end to end.
    const docker = fakeDocker({ inspect: STOPPED })
    docker.start = async () => {
      throw new Error('docker daemon is not running')
    }
    const svc = createMemoryService(
      fakeStore(row(LOCAL_DOCKER)),
      forbiddenProbeDriver,
      opts(docker)
    )
    const out = await svc.ensureStartedForLaunch(PID)

    expect(out.started).toBe(false)
    expect(out.ready).toBe(false)
    expect(out.waitedMs).toBe(0)
    expect(out.reason).toBeTruthy()
    // ⚠ AND THE REASON IS AN AUTHORED SENTENCE, NEVER DOCKER'S STDERR.
    expect(out.reason).not.toContain('daemon')
  })

  it('the timeout path reports failure, still started exactly once, and never retries', async () => {
    // Driven on a fake clock so the 15 s budget costs no wall time here. The
    // BOUND itself is not provable by any unit test — only a stopwatch against
    // a dead port proves that, which is why the runtime drive times it.
    vi.useFakeTimers()
    try {
      const docker = fakeDocker({ inspect: STOPPED })
      // Never answers.
      const never: Neo4jClient = {
        async probe() {
          return { ok: false as const, reason: 'the database did not answer' }
        },
        withSession() {
          throw new Error('withSession must not be called by ensureStartedForLaunch')
        },
        dispose: async () => {},
        isOpen: () => false
      }
      const svc = createMemoryService(fakeStore(row(LOCAL_DOCKER)), never, opts(docker))
      const pending = svc.ensureStartedForLaunch(PID)
      await vi.advanceTimersByTimeAsync(30_000)
      const out = await pending

      expect(out.started).toBe(true)
      expect(out.ready).toBe(false)
      expect(out.reason).toContain('memory contract')
      // ⚠ ONE START, NO RETRY, even after the budget expired.
      expect(docker.calls.filter((c) => c.startsWith('start:'))).toEqual([
        `start:${PROVISIONED_NAME}`
      ])
      // The elapsed time is the fake clock's, and it stays inside
      // budget + one in-flight probe (15 s + 5 s) rather than attempts x interval.
      expect(out.waitedMs).toBeLessThanOrEqual(20_000)
    } finally {
      vi.useRealTimers()
    }
  })
})

/* ───────────── Task 6b-3: the index writes the head (D170(b)) ───────────── */

/** The git reads `index` needs, answering rather than throwing. */
function indexSource(head: string | null): typeof FORBIDDEN_INDEX_SOURCE {
  return {
    rootPathFor: () => 'C:\\Projects\\Test',
    lsFiles: async () => ['src/a.ts'],
    rootCommitShas: async () => ['a92099d934dd95548e59525b7231fd4b5f5d5f6f'],
    logNameOnly: async () => '',
    countCommits: async () => 1,
    headSha: async () => head
  }
}

describe('6b-3: index writes :Project.lastIndexedHead', () => {
  const HEAD = '1c146036edcec92aae29cbc0b146ffd6d2db5305'

  it('passes the head git reported into UPSERT_PROJECT, and reports it', async () => {
    const d = recordingDriver([])
    const svc = createMemoryService(fakeStore(row()), d.client, {
      ...MCP_OPTIONS,
      codeIndex: indexSource(HEAD)
    })
    const out = await svc.index(PID)

    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.value.headSha).toBe(HEAD)

    const i = d.statements.findIndex((s) => s.includes('MERGE (p:Project {id: $projectId})'))
    expect(i).toBeGreaterThanOrEqual(0)
    expect(d.statements[i]).toContain('p.lastIndexedHead = $headSha')
    expect(d.params[i].headSha).toBe(HEAD)
  })

  it('⚠ `headSha` IS PRESENT IN THE PARAMETER MAP EVEN WHEN NULL', async () => {
    // Neo4j raises ParameterMissing for a `$name` with no entry, while a null
    // VALUE sets the property to null — which is what "no head" should mean. A
    // permissive fake runner cannot tell those apart at runtime, so the KEY's
    // presence is asserted here explicitly.
    const d = recordingDriver([])
    const svc = createMemoryService(fakeStore(row()), d.client, {
      ...MCP_OPTIONS,
      codeIndex: indexSource(null)
    })
    const out = await svc.index(PID)

    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.value.headSha).toBeNull()

    const i = d.statements.findIndex((s) => s.includes('MERGE (p:Project {id: $projectId})'))
    expect(Object.keys(d.params[i])).toContain('headSha')
    expect(d.params[i].headSha).toBeNull()
  })
})

/* ───────────── Task 6b-3: freshness is its own read (D170(b)) ───────────── */

describe('6b-3: freshness', () => {
  const HEAD = '1c146036edcec92aae29cbc0b146ffd6d2db5305'
  const OLD = '78c0893aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

  it('reports the graph head, the checkout head, and stale when they differ', async () => {
    const d = recordingDriver([
      { records: [rec({ lastIndexedHead: OLD, lastIndexedAt: '2026-08-15T21:50:01.651Z' })] }
    ])
    const svc = createMemoryService(fakeStore(row()), d.client, {
      ...MCP_OPTIONS,
      codeIndex: indexSource(HEAD)
    })
    const out = await svc.freshness(PID)

    expect(out).toEqual({
      ok: true,
      value: {
        lastIndexedHead: OLD,
        lastIndexedAt: '2026-08-15T21:50:01.651Z',
        headSha: HEAD,
        stale: true
      }
    })
  })

  it('the same head is not stale', async () => {
    const d = recordingDriver([{ records: [rec({ lastIndexedHead: HEAD, lastIndexedAt: 'x' })] }])
    const svc = createMemoryService(fakeStore(row()), d.client, {
      ...MCP_OPTIONS,
      codeIndex: indexSource(HEAD)
    })
    const out = await svc.freshness(PID)
    expect(out.ok && out.value.stale).toBe(false)
  })

  it('⚠ ZERO ROWS IS THE NEVER-INDEXED ANSWER, NOT AN ERROR', async () => {
    // :Project does not exist until UPSERT_PROJECT has run once.
    const d = recordingDriver([{ records: [] }])
    const svc = createMemoryService(fakeStore(row()), d.client, {
      ...MCP_OPTIONS,
      codeIndex: indexSource(HEAD)
    })
    const out = await svc.freshness(PID)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.value.lastIndexedHead).toBeNull()
    expect(out.value.stale).toBe(true)
  })

  it('⚠ A PROJECT WITH NO GIT HISTORY IS NOT STALE — it would otherwise re-index forever', async () => {
    const d = recordingDriver([{ records: [] }])
    const svc = createMemoryService(fakeStore(row()), d.client, {
      ...MCP_OPTIONS,
      codeIndex: indexSource(null)
    })
    const out = await svc.freshness(PID)
    expect(out.ok && out.value.stale).toBe(false)
  })
})
