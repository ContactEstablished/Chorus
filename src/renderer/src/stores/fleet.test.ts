import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useFleetStore } from './fleet'
import { fleetSnapshotSchema, type FleetSnapshotPayload } from '../../../shared/ipc'

/**
 * Task 1-3: the fleet store and the wire schema it consumes.
 *
 * ⚠ THE HEADLINE CASE IS THAT A GOOD ADDRESS NEVER SURVIVES A BAD POLL. Every
 * other test here is scaffolding for that one. Spec §6.1: the live registry
 * name is the only string shown as routable, and the whole reason Phase 0
 * shipped without a chip is that a remembered name is a promise Chorus cannot
 * keep.
 *
 * The schema assertions live here rather than in `shared/ipc.test.ts` to keep
 * this task's file set disjoint from the others in the phase; they are about
 * the same payload this store receives.
 */

function snapshot(over: Partial<FleetSnapshotPayload> = {}): FleetSnapshotPayload {
  return {
    readable: true,
    observedAt: 1_000,
    states: { 'pane-1': { kind: 'verified', address: 'Mae' } },
    externalPeers: [],
    ...over
  }
}

beforeEach(() => setActivePinia(createPinia()))

describe('the wire schema', () => {
  it('accepts all three address kinds', () => {
    for (const state of [
      { kind: 'verified', address: 'Mae' },
      { kind: 'changed', requested: 'Mae', current: 'other', cause: null },
      { kind: 'changed', requested: 'Mae', current: 'other', cause: 'collision' },
      { kind: 'unknown', reason: 'registry unreadable' }
    ]) {
      expect(fleetSnapshotSchema.safeParse(snapshot({ states: { p: state } as never })).success).toBe(true)
    }
  })

  it('⚠ REJECTS a fourth kind — the union is the contract the UI is built on', () => {
    const bad = snapshot({ states: { p: { kind: 'collided', requested: 'a', current: 'b' } } as never })
    expect(fleetSnapshotSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects a state with no kind at all', () => {
    expect(fleetSnapshotSchema.safeParse(snapshot({ states: { p: { address: 'Mae' } } as never })).success).toBe(
      false
    )
  })
})

describe('addressFor', () => {
  it('resolves a known pane', () => {
    const store = useFleetStore()
    store.received(snapshot())
    expect(store.addressFor('pane-1')).toEqual({ kind: 'verified', address: 'Mae' })
  })

  it('is unknown before any snapshot has arrived', () => {
    // Not undefined: a caller handed undefined reaches for a fallback, and the
    // nearest fallback is the stale name we just refused to keep.
    expect(useFleetStore().addressFor('pane-1').kind).toBe('unknown')
  })

  it('is unknown for a pane that is not in the fleet', () => {
    const store = useFleetStore()
    store.received(snapshot())
    expect(store.addressFor('pane-999').kind).toBe('unknown')
  })

  it('⚠ NEVER serves the last good address once the registry is unreadable', () => {
    const store = useFleetStore()
    store.received(snapshot())
    expect(store.addressFor('pane-1')).toMatchObject({ kind: 'verified' })

    // The poll comes back unable to read. Even though `states` still carries a
    // verified entry, the answer must be `unknown`.
    store.received(snapshot({ readable: false }))
    expect(store.addressFor('pane-1').kind).toBe('unknown')
  })

  it('⚠ an unreadable snapshot is DIFFERENT from an empty fleet', () => {
    const store = useFleetStore()
    store.received(snapshot({ readable: true, states: {} }))
    expect(store.readable).toBe(true) // "there are no peers"
    store.received(snapshot({ readable: false, states: {} }))
    expect(store.readable).toBe(false) // "we cannot say"
  })

  it('replaces wholesale rather than merging', () => {
    // A merge is where a previous address survives a poll that no longer knows
    // it — the same bug as the unreadable case, arriving by a quieter route.
    const store = useFleetStore()
    store.received(snapshot({ states: { 'pane-1': { kind: 'verified', address: 'Mae' } } }))
    store.received(snapshot({ states: { 'pane-2': { kind: 'verified', address: 'Bob' } } }))
    expect(store.addressFor('pane-1').kind).toBe('unknown')
    expect(store.addressFor('pane-2')).toMatchObject({ kind: 'verified', address: 'Bob' })
  })
})

describe('externalPeers', () => {
  it('is empty before a snapshot and carries peers after one', () => {
    const store = useFleetStore()
    expect(store.externalPeers).toEqual([])
    store.received(
      snapshot({ externalPeers: [{ name: 'trupanionde-ca', cwd: 'C:\\Projects\\X', status: 'idle' }] })
    )
    expect(store.externalPeers.map((p) => p.name)).toEqual(['trupanionde-ca'])
  })
})
