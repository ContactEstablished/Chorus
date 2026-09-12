import { defineStore } from 'pinia'
import type { LedgerSnapshot } from '../../../shared/ipc'
import { buildUsageView, type UsageView } from '../../../shared/engineUsageView'

/**
 * Engine 10.1-4: the usage panel's data, keyed by project.
 *
 * ⚠ NO ARITHMETIC LIVES HERE. Main computes the numbers, `engineUsageView.ts`
 * decides what they mean, and this store holds the result — so what Chorus is
 * claiming is decided in a module that has tests, not in a component that has
 * none (D186).
 *
 * ⚠ SESSION-LIFETIME, NEVER PERSISTED. The ledger main keeps is in-memory and
 * per-run, so caching a snapshot across app runs would show a number whose
 * source no longer exists.
 */
interface State {
  snapshotByProject: Record<string, LedgerSnapshot | undefined>
  loadingByProject: Record<string, boolean>
  seqByProject: Record<string, number>
  error: string | null
}

export const useEngineLedgerStore = defineStore('engineLedger', {
  state: (): State => ({
    snapshotByProject: {},
    loadingByProject: {},
    seqByProject: {},
    error: null
  }),

  getters: {
    viewFor:
      (state) =>
      (projectId: string): UsageView | null => {
        const snapshot = state.snapshotByProject[projectId]
        return snapshot ? buildUsageView(snapshot) : null
      },
    isLoading:
      (state) =>
      (projectId: string): boolean =>
        state.loadingByProject[projectId] === true
  },

  actions: {
    /**
     * ⚠ THE SUPERSEDE GUARD IS PER PROJECT AND COVERS THE `loading` FLAG TOO —
     * `memory.ts`'s rule, for the same reason. An unguarded `loading = false`
     * lets a stale load clear a live one's spinner, so the panel reads as
     * finished while its real request is still in flight.
     *
     * ⚠ AND A FAILED LOAD LEAVES THE LAST GOOD ROWS ALONE. Replacing them with
     * nothing would turn a transient IPC error into "this project has no usage
     * data", which is a claim rather than an absence.
     */
    async load(projectId: string): Promise<void> {
      const seq = (this.seqByProject[projectId] ?? 0) + 1
      this.seqByProject[projectId] = seq
      this.loadingByProject[projectId] = true
      try {
        const snapshot = await window.chorus.getEngineLedgerSnapshot(projectId)
        if (seq !== this.seqByProject[projectId]) return // superseded — drop it
        this.snapshotByProject[projectId] = snapshot
        this.error = null
      } catch (e) {
        if (seq !== this.seqByProject[projectId]) return
        this.error = e instanceof Error ? e.message : String(e)
      } finally {
        if (seq === this.seqByProject[projectId]) this.loadingByProject[projectId] = false
      }
    }
  }
})
