import { describe, expect, it } from 'vitest'
import {
  addressStateFor,
  duplicateNames,
  isLive,
  isProtocolSupported,
  normaliseAddress,
  nextStickyState,
  parseRegistryEntry,
  SUPPORTED_PEER_PROTOCOL,
  type AddressState,
  type FleetEntry,
  type ProcessProbe
} from './fleetRegistryCore'

/**
 * Task 1-1's pure core.
 *
 * ⚠ THE FIXTURE IS A REAL REGISTRY ENTRY, COPIED FROM SPEC §4.1, which in turn
 * came from `~/.claude/sessions/` on this machine. Hand-inventing the shape
 * would test our idea of the file rather than the file — and two of this
 * phase's decisions (the `procStart` liveness check, the three-state union)
 * exist only because the real shape was measured first.
 */
const REAL_ENTRY = {
  pid: 112060,
  sessionId: '25f6b24c-109d-4356-8232-8c30aeb9a567',
  cwd: 'C:\\Projects\\ContactEstablished\\Chorus',
  startedAt: 1787765601168,
  procStart: '134322392003434636',
  version: '2.1.246',
  peerProtocol: 1,
  peerFeatures: ['notify_idle', 'artifact_yield'],
  kind: 'interactive',
  entrypoint: 'cli',
  pidDomain: 'win32:ironman',
  messagingSocketPath: '\\\\.\\pipe\\LOCAL\\cc-msg-75ad72d014e79b32e1a712f615f53ef5',
  name: 'chorus-2a',
  nameSource: 'derived',
  nameSince: 1787765601168,
  status: 'idle',
  updatedAt: 1787766123664,
  statusUpdatedAt: 1787766123664
}

/** A minimal valid entry, for tests that vary one field. */
function entry(overrides: Partial<FleetEntry> = {}): FleetEntry {
  const parsed = parseRegistryEntry(REAL_ENTRY)
  if (!parsed.ok) throw new Error('fixture must parse')
  return { ...parsed.entry, ...overrides }
}

function probe(alive: boolean, startTime: string | null): ProcessProbe {
  return { alive: () => alive, startTimeOf: () => startTime }
}

describe('parseRegistryEntry', () => {
  it('parses a real registry entry and discards keys we never validated', () => {
    const r = parseRegistryEntry(REAL_ENTRY)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.entry.pid).toBe(112060)
    expect(r.entry.name).toBe('chorus-2a')
    expect(r.entry.status).toBe('idle')
    expect(r.entry.messagingSocketPath).toContain('cc-msg-')
    // Carried through untouched, never interpreted.
    expect(r.entry.procStart).toBe('134322392003434636')
    // `peerFeatures`, `pidDomain`, `updatedAt` etc. are NOT on the entry — a
    // passthrough object invites a consumer to reach for an unvalidated field.
    expect(Object.keys(r.entry).sort()).toEqual([
      'cwd',
      'messagingSocketPath',
      'name',
      'nameSource',
      'peerProtocol',
      'pid',
      'procStart',
      'sessionId',
      'startedAt',
      'status'
    ])
  })

  it('⚠ NEVER THROWS — every malformed shape is a value', () => {
    // Spec §8.1: torn writes, deleted files and empty files are ORDINARY. One
    // bad file must not be able to end a poll over the others.
    for (const bad of [null, undefined, 42, 'nope', [], {}, { pid: 1 }]) {
      const r = parseRegistryEntry(bad)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(typeof r.reason).toBe('string')
    }
  })

  it('rejects an entry missing a load-bearing field', () => {
    const { sessionId: _s, ...noSession } = REAL_ENTRY
    expect(parseRegistryEntry(noSession).ok).toBe(false)

    const { procStart: _p, ...noProcStart } = REAL_ENTRY
    // Without procStart there is no honest liveness check, so it is required.
    expect(parseRegistryEntry(noProcStart).ok).toBe(false)
  })

  it('⚠ an UNKNOWN status does not delete the session from the fleet', () => {
    // A strict enum would fail the whole parse on a status claude added later,
    // dropping a live, reachable peer over a word we had not seen.
    const r = parseRegistryEntry({ ...REAL_ENTRY, status: 'compacting' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.entry.status).toBe('unrecognised')
  })

  it('tolerates a missing optional socket path', () => {
    const { messagingSocketPath: _m, ...noSocket } = REAL_ENTRY
    const r = parseRegistryEntry(noSocket)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.entry.messagingSocketPath).toBeNull()
  })
})

describe('isProtocolSupported', () => {
  it('accepts 1 and refuses anything else', () => {
    expect(SUPPORTED_PEER_PROTOCOL).toBe(1)
    expect(isProtocolSupported(entry({ peerProtocol: 1 }))).toBe(true)
    expect(isProtocolSupported(entry({ peerProtocol: 2 }))).toBe(false)
    expect(isProtocolSupported(entry({ peerProtocol: 0 }))).toBe(false)
  })
})

describe('isLive', () => {
  it('is false when the process is gone', () => {
    expect(isLive(entry(), probe(false, '134322392003434636'))).toBe(false)
  })

  it('⚠ is false when the pid EXISTS but the start time differs — the recycled-pid case', () => {
    // This is the assertion that stops a pid-only check being "simplified" back
    // in. Spec §4.7: a force-killed session leaves its file behind, and the OS
    // reuses pids — so a live pid is not evidence that THIS session is alive.
    expect(isLive(entry(), probe(true, '999999999999999999'))).toBe(false)
  })

  it('is false when the start time cannot be read at all', () => {
    expect(isLive(entry(), probe(true, null))).toBe(false)
  })

  it('is true only when both the pid and the start time match', () => {
    expect(isLive(entry(), probe(true, '134322392003434636'))).toBe(true)
  })
})

describe('duplicateNames', () => {
  it('reports a name held by two live entries', () => {
    // Measured live during the Phase 0 drive: two sessions were observed
    // simultaneously named Zeta after the first holder exited (spec §4.7).
    const dupes = duplicateNames([
      entry({ pid: 1, name: 'Zeta' }),
      entry({ pid: 2, name: 'Zeta' }),
      entry({ pid: 3, name: 'Mae' })
    ])
    expect(dupes.has('zeta')).toBe(true)
    expect(dupes.has('mae')).toBe(false)
  })

  it('is not fooled by case or surrounding whitespace', () => {
    const dupes = duplicateNames([entry({ pid: 1, name: '  zETA ' }), entry({ pid: 2, name: 'Zeta' })])
    expect(dupes.has('zeta')).toBe(true)
  })

  it('normalises the same way the name suggester does', () => {
    expect(normaliseAddress('  Bob ')).toBe('bob')
  })
})

describe('addressStateFor', () => {
  const none: ReadonlySet<string> = new Set()

  it('verified when the live name equals what we asked for', () => {
    const s = addressStateFor({ requestedName: 'Mae', entry: entry({ name: 'Mae' }), duplicates: none })
    expect(s).toEqual({ kind: 'verified', address: 'Mae' })
  })

  it('verified, not changed, for a pane Chorus never named', () => {
    // Otherwise every pane launched before Phase 0 would light a warning.
    const s = addressStateFor({ requestedName: null, entry: entry({ name: 'chorus-2a' }), duplicates: none })
    expect(s).toEqual({ kind: 'verified', address: 'chorus-2a' })
  })

  it('changed, carrying BOTH names, when the registry disagrees', () => {
    const s = addressStateFor({
      requestedName: 'Mae',
      entry: entry({ name: 'redesign-dictation-overlay' }),
      duplicates: none
    })
    expect(s).toEqual({
      kind: 'changed',
      requested: 'Mae',
      current: 'redesign-dictation-overlay',
      cause: null
    })
  })

  it('names the cause ONLY when another live entry holds what we asked for', () => {
    const s = addressStateFor({
      requestedName: 'Zeta',
      entry: entry({ name: 'wt-e27d8654-6a' }),
      duplicates: new Set(['zeta'])
    })
    expect(s.kind).toBe('changed')
    if (s.kind === 'changed') expect(s.cause).toBe('collision')
  })

  it('unknown when there is no live entry for the session', () => {
    const s = addressStateFor({ requestedName: 'Mae', entry: null, duplicates: none })
    expect(s.kind).toBe('unknown')
  })
})

describe('nextStickyState', () => {
  const changed: AddressState = { kind: 'changed', requested: 'Mae', current: 'other', cause: null }
  const verified: AddressState = { kind: 'verified', address: 'Mae' }
  const unknown: AddressState = { kind: 'unknown', reason: 'registry unreadable' }

  it('⚠ a changed state SURVIVES a later verified — it is not a one-poll badge', () => {
    // The whole point: spec §4.8 saw the agent-name record repeat 29 times, so
    // a badge that clears on the next poll reads as a silent rename.
    expect(nextStickyState(changed, verified, false)).toEqual(changed)
  })

  it('⚠ an unknown does not clear a remembered change', () => {
    // Losing the registry is not evidence the old name came back.
    expect(nextStickyState(changed, unknown, false)).toEqual(changed)
  })

  it('an acknowledgement collapses to whatever is current', () => {
    expect(nextStickyState(changed, verified, true)).toEqual(verified)
  })

  it('a newer divergence supersedes an older one', () => {
    const newer: AddressState = { kind: 'changed', requested: 'Mae', current: 'third', cause: null }
    expect(nextStickyState(changed, newer, false)).toEqual(newer)
  })

  it('passes everything through when there is nothing remembered', () => {
    expect(nextStickyState(null, verified, false)).toEqual(verified)
    expect(nextStickyState(verified, unknown, false)).toEqual(unknown)
  })
})

describe('the state union is closed', () => {
  it('⚠ has exactly three kinds — the council proposed six', () => {
    // The UI in Task 1-3 is built on this being three. `unconfirmed` and
    // `unavailable` are one sentence to an operator; `collided` and `renamed`
    // are usually indistinguishable in the data (a real collision wrote
    // nameSource "derived"). Cause is an enrichment on `changed`, not a state.
    const kinds = new Set<string>()
    kinds.add(addressStateFor({ requestedName: 'a', entry: entry({ name: 'a' }), duplicates: new Set() }).kind)
    kinds.add(addressStateFor({ requestedName: 'a', entry: entry({ name: 'b' }), duplicates: new Set() }).kind)
    kinds.add(addressStateFor({ requestedName: 'a', entry: null, duplicates: new Set() }).kind)
    expect([...kinds].sort()).toEqual(['changed', 'unknown', 'verified'])
  })
})
