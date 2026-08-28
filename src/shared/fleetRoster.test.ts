import { describe, expect, it } from 'vitest'
import {
  buildRoster,
  describeAddress,
  ROSTER_PARTIALITY_NOTE,
  type RosterPane
} from './fleetRoster'
import type { FleetSnapshotPayload } from './ipc'

/**
 * Task 1-4's rules, tested where they can be — this repository has no `.vue`
 * tests (D186), so the roster's claims live in a pure module and are asserted
 * here rather than in a render.
 */

const PANES: RosterPane[] = [
  { sessionId: 'pane-claude', agent: 'claude', label: 'Mae' },
  { sessionId: 'pane-codex', agent: 'codex', label: 'Rita' }
]

function snap(over: Partial<FleetSnapshotPayload> = {}): FleetSnapshotPayload {
  return {
    readable: true,
    observedAt: 1,
    states: { 'pane-claude': { kind: 'verified', address: 'Mae' } },
    statuses: { 'pane-claude': 'idle' },
    externalPeers: [],
    ...over
  }
}

describe('every pane gets a row', () => {
  it('⚠ INCLUDING ONE THAT CANNOT PARTICIPATE — omitting it would claim there are no agents', () => {
    // §7.2 verbatim: "an absent row reads as 'no agents', which is a different
    // and wrong claim."
    const roster = buildRoster(PANES, snap())
    expect(roster.panes.map((r) => r.sessionId)).toEqual(['pane-claude', 'pane-codex'])
  })

  it('⚠ keeps the two non-participation reasons APART', () => {
    // `not-claude` is permanent and a property of the tool. `no-entry` is
    // probably temporary. One label for both would tell the operator to stop
    // waiting for something that is about to arrive.
    const roster = buildRoster(PANES, snap({ states: {}, statuses: {} }))
    const claude = roster.panes.find((r) => r.sessionId === 'pane-claude')
    const codex = roster.panes.find((r) => r.sessionId === 'pane-codex')
    expect(codex?.reason).toBe('not-claude')
    expect(claude?.reason).toBe('no-entry')
    expect(codex?.addressable).toBe(false)
    expect(claude?.addressable).toBe(false)
  })

  it('a non-claude pane never carries a fleet status', () => {
    const codex = buildRoster(PANES, snap()).panes.find((r) => r.sessionId === 'pane-codex')
    expect(codex?.status).toBeNull()
  })
})

describe('unreadable is not empty', () => {
  it('⚠ reports readable:false rather than an empty fleet', () => {
    // The two are different claims. An empty list says "there are no peers";
    // unreadable says "we cannot say", and only one of them is honest here.
    const roster = buildRoster(PANES, snap({ readable: false }))
    expect(roster.readable).toBe(false)
    expect(roster.panes).toHaveLength(2)
  })

  it('never serves a status or an address it cannot vouch for', () => {
    // The snapshot still CARRIES a verified state and an idle status; being
    // unreadable must override both.
    const roster = buildRoster(PANES, snap({ readable: false }))
    const claude = roster.panes.find((r) => r.sessionId === 'pane-claude')
    expect(claude?.address.kind).toBe('unknown')
    expect(claude?.status).toBeNull()
  })

  it('drops external peers when the registry cannot be read', () => {
    const roster = buildRoster(PANES, snap({ readable: false, externalPeers: [{ name: 'x', cwd: 'c', status: 'idle' }] }))
    expect(roster.external).toEqual([])
  })

  it('a null snapshot — before the first poll — behaves like unreadable', () => {
    const roster = buildRoster(PANES, null)
    expect(roster.readable).toBe(false)
    expect(roster.panes.every((r) => r.address.kind === 'unknown')).toBe(true)
  })
})

describe('external peers', () => {
  it('are carried through when the registry is readable', () => {
    const roster = buildRoster(
      PANES,
      snap({ externalPeers: [{ name: 'trupanionde-ca', cwd: 'C:\\X', status: 'idle' }] })
    )
    expect(roster.external.map((e) => e.name)).toEqual(['trupanionde-ca'])
  })
})

describe('describeAddress', () => {
  it('shows both names when the address has drifted, and names a collision', () => {
    expect(describeAddress({ kind: 'verified', address: 'Mae' })).toBe('Mae')
    expect(
      describeAddress({ kind: 'changed', requested: 'Mae', current: 'other', cause: null })
    ).toBe('other (requested Mae)')
    expect(
      describeAddress({ kind: 'changed', requested: 'Mae', current: 'other', cause: 'collision' })
    ).toBe('other (requested Mae — taken)')
    expect(describeAddress({ kind: 'unknown', reason: 'whatever' })).toBe('Address unknown')
  })
})

describe('the non-goals, made executable', () => {
  it('⚠ NO ROW CARRIES UNREAD STATE OF ANY KIND', () => {
    // Council FC-1.0 Q3 prohibited unread state outright: it is the mechanism
    // that turns a consulted view into an activity feed, which is Phase 8's
    // standing non-goal. A field added here is the first step of that drift, so
    // the shape itself is asserted rather than trusted.
    const roster = buildRoster(PANES, snap())
    const forbidden = ['unread', 'count', 'badge', 'notify', 'notification', 'pending', 'seen']
    for (const row of roster.panes) {
      for (const key of Object.keys(row)) {
        expect(forbidden.some((f) => key.toLowerCase().includes(f))).toBe(false)
      }
    }
    for (const row of roster.external) {
      for (const key of Object.keys(row)) {
        expect(forbidden.some((f) => key.toLowerCase().includes(f))).toBe(false)
      }
    }
  })

  it('the partiality note says both directions the view is incomplete', () => {
    // §4.5: the fleet is larger than Chorus BOTH ways — other agents cannot
    // participate, and sessions elsewhere are invisible. A note that admits
    // only one of those still implies completeness about the other.
    expect(ROSTER_PARTIALITY_NOTE).toMatch(/cannot participate/i)
    expect(ROSTER_PARTIALITY_NOTE).toMatch(/other machines/i)
  })
})
