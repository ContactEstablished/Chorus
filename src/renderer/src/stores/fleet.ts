import { defineStore } from 'pinia'
import type { FleetAddressState, FleetSnapshotPayload } from '../../../shared/ipc'

/**
 * Who is reachable, and what each pane is CURRENTLY called (D182, spec §6.1).
 *
 * ─── WHY THIS HOLDS A SNAPSHOT AND NOT A MAP OF ADDRESSES ─────────────────
 * ⚠ THE SINGLE MOST LIKELY WAY TO REINTRODUCE THE BUG THIS PHASE EXISTS TO FIX
 * IS A WELL-MEANING `lastKnownAddress` THAT SURVIVES A BAD POLL "SO THE UI DOES
 * NOT FLICKER". The flicker IS the information. §6.1: the live registry name is
 * the only string shown as routable, and an address we cannot currently vouch
 * for must read `unknown` rather than the last one that worked.
 *
 * So the state is one replaceable snapshot, and `addressFor` resolves THROUGH
 * it on every read. There is deliberately no per-session field to go stale, and
 * no merge step where a previous value could survive a newer one.
 *
 * Phase 0 shipped no chip at all for the same reason: a chip drawn from the
 * name Chorus REQUESTED is a cached promise, and only a live registry read
 * makes one honest.
 */
export const useFleetStore = defineStore('fleet', {
  state: (): { snapshot: FleetSnapshotPayload | null } => ({ snapshot: null }),
  getters: {
    /**
     * This pane's address state. Never undefined — absence is a STATE, not a
     * gap, because a caller handed `undefined` will reach for a fallback and
     * the nearest fallback is the stale name we just refused to keep.
     */
    addressFor:
      (state) =>
      (chorusSessionId: string): FleetAddressState => {
        const snap = state.snapshot
        if (!snap) return { kind: 'unknown', reason: 'no fleet reading yet' }
        // ⚠ `readable: false` is NOT an empty fleet. It means the registry could
        // not be read at all, so nothing in `states` can be vouched for.
        if (!snap.readable) return { kind: 'unknown', reason: 'registry unreadable' }
        return snap.states[chorusSessionId] ?? { kind: 'unknown', reason: 'not in fleet' }
      },
    /** Live peers that are not Chorus panes. Task 1-4 renders these. */
    externalPeers: (state) => state.snapshot?.externalPeers ?? [],
    /** False whenever the fleet cannot be vouched for — distinct from "no peers". */
    readable: (state) => state.snapshot?.readable ?? false
  },
  actions: {
    /** Replaced WHOLESALE, never merged. A merge is where a previous address
     *  would survive a poll that no longer knows it. */
    received(payload: FleetSnapshotPayload): void {
      this.snapshot = payload
    }
  }
})
