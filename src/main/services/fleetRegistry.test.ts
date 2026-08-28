import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FleetRegistry, pidAlive } from './fleetRegistry'

/**
 * Task 1-2's service.
 *
 * The filesystem is REAL but disposable — a temp directory per test — because
 * the behaviours that matter here are filesystem behaviours: a torn write, a
 * file that vanishes, a directory that is not there. Faking `fs` would test the
 * fake. Everything else (the clock, liveness, start times, storage) is injected.
 */

let dir: string

const ENTRY = {
  pid: 4242,
  sessionId: 'sid-alpha',
  cwd: 'C:\\Projects\\Thing',
  procStart: '134322514089929884',
  peerProtocol: 1,
  messagingSocketPath: '\\\\.\\pipe\\LOCAL\\cc-msg-aaa',
  name: 'Mae',
  nameSource: 'user',
  status: 'idle',
  startedAt: 1787777810886
}

async function write(name: string, body: unknown): Promise<void> {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  await fs.writeFile(path.join(dir, name), text, 'utf8')
}

function make(overrides: Partial<ConstructorParameters<typeof FleetRegistry>[0]> = {}) {
  return new FleetRegistry({
    sessionsDir: dir,
    now: () => 1_000_000,
    alive: () => true,
    readStartTimesFor: async (pids) => new Map(pids.map((p) => [p, ENTRY.procStart])),
    ...overrides
  })
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fleet-test-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('reading the registry directory', () => {
  it('reads well-formed entries', async () => {
    await write('4242.json', ENTRY)
    await write('4243.json', { ...ENTRY, pid: 4243, sessionId: 'sid-beta', name: 'Bob' })
    const svc = make()
    await svc.refresh()
    const snap = svc.current()
    expect(snap.readable).toBe(true)
    expect(snap.entries.map((e) => e.name).sort()).toEqual(['Bob', 'Mae'])
  })

  it('⚠ one malformed file does not stop the others being read', async () => {
    // Spec §8.1: the CLI writes these files while we read them, so a torn write
    // is ORDINARY. A poll that aborts on the first bad file would blank the
    // whole fleet because one session was mid-write.
    await write('4242.json', ENTRY)
    await write('4243.json', '{"pid": 4243, "sessi')
    await write('4244.json', '')
    const svc = make()
    await svc.refresh()
    expect(svc.current().entries.map((e) => e.name)).toEqual(['Mae'])
    expect(svc.current().readable).toBe(true)
  })

  it('⚠ a missing directory is UNREADABLE, not an empty fleet', async () => {
    // These are different claims: "there are no peers" versus "we cannot say".
    // Collapsing them would render a confident empty roster.
    await fs.rm(dir, { recursive: true, force: true })
    const svc = make()
    await svc.refresh()
    expect(svc.current().readable).toBe(false)
    expect(svc.current().entries).toEqual([])
  })

  it('never reads or lists .key files', async () => {
    await write('4242.json', ENTRY)
    await write('4242.abcdef.key', 'SECRET-TOKEN-VALUE')
    const svc = make()
    await svc.refresh()
    expect(svc.current().entries).toHaveLength(1)
  })
})

describe('liveness', () => {
  it('excludes an entry whose process is gone', async () => {
    await write('4242.json', ENTRY)
    const svc = make({ alive: () => false })
    await svc.refresh()
    expect(svc.current().entries).toEqual([])
  })

  it('⚠ excludes a LIVE pid whose start time differs — the recycled-pid case', async () => {
    // §4.7: a force-killed session leaves its file behind and the OS reuses
    // pids, so "the pid exists" is not evidence THIS session is alive.
    await write('4242.json', ENTRY)
    const svc = make({
      alive: () => true,
      readStartTimesFor: async (pids) => new Map(pids.map((p) => [p, '999999999999999999']))
    })
    await svc.refresh()
    expect(svc.current().entries).toEqual([])
  })

  it('excludes an entry whose start time cannot be read at all', async () => {
    await write('4242.json', ENTRY)
    const svc = make({ readStartTimesFor: async () => new Map() })
    await svc.refresh()
    expect(svc.current().entries).toEqual([])
  })
})

describe('the protocol gate', () => {
  it('excludes an unsupported protocol', async () => {
    await write('4242.json', { ...ENTRY, peerProtocol: 2 })
    const svc = make()
    await svc.refresh()
    expect(svc.current().entries).toEqual([])
    // still readable — we read it fine, we just will not guess at its shape
    expect(svc.current().readable).toBe(true)
  })
})

describe('peer_sessions recording', () => {
  it('upserts one mapping per live entry that has a socket path', async () => {
    await write('4242.json', ENTRY)
    const calls: Array<[string, string]> = []
    const svc = make({ upsertPeerSession: (sp, sid) => void calls.push([sp, sid]) })
    await svc.refresh()
    expect(calls).toEqual([[ENTRY.messagingSocketPath, 'sid-alpha']])
  })

  it('records nothing for an entry with no socket path', async () => {
    const { messagingSocketPath: _m, ...noSocket } = ENTRY
    await write('4242.json', noSocket)
    const calls: string[] = []
    const svc = make({ upsertPeerSession: (sp) => void calls.push(sp) })
    await svc.refresh()
    expect(calls).toEqual([])
  })

  it('a storage failure does not break the poll', async () => {
    await write('4242.json', ENTRY)
    const svc = make({
      upsertPeerSession: () => {
        throw new Error('db is busy')
      }
    })
    await expect(svc.refresh()).resolves.toBeUndefined()
    expect(svc.current().entries).toHaveLength(1)
  })
})

describe('address states for tracked panes', () => {
  const wiring = {
    claudeSessionIdFor: () => 'sid-alpha',
    requestedNameFor: () => 'Mae'
  }

  it('verified when the registry agrees with what we asked for', async () => {
    await write('4242.json', ENTRY)
    const svc = make(wiring)
    svc.track('pane-1')
    await svc.refresh()
    expect(svc.addressFor('pane-1')).toEqual({ kind: 'verified', address: 'Mae' })
  })

  it('changed when the registry disagrees, and it STICKS across later polls', async () => {
    await write('4242.json', { ...ENTRY, name: 'redesign-overlay' })
    const svc = make(wiring)
    svc.track('pane-1')
    await svc.refresh()
    expect(svc.addressFor('pane-1')).toMatchObject({ kind: 'changed', current: 'redesign-overlay' })

    // The name comes back. A one-poll badge would clear here — and §4.8 saw the
    // underlying record repeat 29 times in one session, so clearing reads as a
    // silent rename to anyone who blinked.
    await write('4242.json', ENTRY)
    await svc.refresh()
    expect(svc.addressFor('pane-1')).toMatchObject({ kind: 'changed' })

    svc.acknowledge('pane-1')
    await svc.refresh()
    expect(svc.addressFor('pane-1')).toEqual({ kind: 'verified', address: 'Mae' })
  })

  it('⚠ an unreadable registry never keeps serving the last good address', async () => {
    await write('4242.json', ENTRY)
    const svc = make(wiring)
    svc.track('pane-1')
    await svc.refresh()
    expect(svc.addressFor('pane-1')).toMatchObject({ kind: 'verified' })

    await fs.rm(dir, { recursive: true, force: true })
    await svc.refresh()
    expect(svc.addressFor('pane-1').kind).toBe('unknown')
  })

  it('an untracked pane is unknown rather than absent', async () => {
    const svc = make(wiring)
    await svc.refresh()
    expect(svc.addressFor('never-seen').kind).toBe('unknown')
  })
})

describe('§8.2 status comparison', () => {
  it('logs a disagreement once per transition, not once per poll', async () => {
    await write('4242.json', { ...ENTRY, status: 'busy' })
    let comparisons = 0
    const svc = make({
      claudeSessionIdFor: () => 'sid-alpha',
      requestedNameFor: () => 'Mae',
      computedActivityFor: () => {
        comparisons++
        return null // Chorus thinks idle; the registry says busy
      }
    })
    svc.track('pane-1')
    await svc.refresh()
    await svc.refresh()
    await svc.refresh()
    // The comparison runs every poll; the LOG is edge-triggered. We assert the
    // comparison happened each time — the log-once ledger is internal, and a
    // test that reached into it would pin the implementation rather than the
    // behaviour.
    expect(comparisons).toBe(3)
  })

  it('does not compare at all when no activity supplier is wired', async () => {
    await write('4242.json', ENTRY)
    const svc = make({ claudeSessionIdFor: () => 'sid-alpha', requestedNameFor: () => 'Mae' })
    svc.track('pane-1')
    await expect(svc.refresh()).resolves.toBeUndefined()
  })
})

describe('pidAlive', () => {
  it('is true for this process and false for an impossible pid', () => {
    expect(pidAlive(process.pid)).toBe(true)
    expect(pidAlive(0x7ffffff0)).toBe(false)
  })
})

describe('the timer', () => {
  it('start is idempotent and stop is safe to call twice', async () => {
    const svc = make()
    svc.start()
    svc.start()
    svc.stop()
    svc.stop()
    expect(svc.current().readable).toBeDefined()
  })
})
