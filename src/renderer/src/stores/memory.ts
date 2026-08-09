import { defineStore } from 'pinia'
import type { MemoryAuthModeWire, MemoryModeWire, MemoryStatusWire } from '../../../shared/ipc'

/**
 * Task 6-3: per-project memory configuration, for the settings surface and the
 * status chip.
 *
 * ⚠ THERE IS NO PASSWORD IN THIS STATE AND THERE NEVER WILL BE. Pinia state is
 * devtools-inspectable, which is the exposure D33 clause 3 exists to prevent —
 * the same reason `settings.ts` has no `key` field. It does not arise here by
 * construction: `memory:get` carries no password and no bolt URI, only a host
 * and a port, and the key-set assertion in `ipc.test.ts` is what keeps that
 * true.
 *
 * ⚠ `connection` IS SESSION-LIFETIME AND DELIBERATELY NOT PERSISTED. D126's
 * state model earns `Connected` from an OBSERVED read, never from a written
 * file or a stored flag — so it lives here, is seeded as `unknown`, and is set
 * only by a `memory:test` the user asked for. It resets when the app restarts,
 * which is correct: the app has not observed a connection since it started.
 */

/** The Stage-2 reachable subset of D126's model. `pending-approval` is about a
 *  CLI's MCP approval and arrives at Task 6-5; it cannot be reached from here,
 *  so it is not in the type. */
export type MemoryConnection = 'unknown' | 'connected' | 'failed'

interface MemoryState {
  /** Keyed by project id — one row per project, or absent when never loaded. */
  statusByProject: Record<string, MemoryStatusWire>
  /**
   * ⚠ PER-PROJECT SUPERSEDE TOKENS, NOT A SINGLE GLOBAL `loadSeq`, and the
   * difference is a bug rather than a style choice. `settings.ts` records this
   * lesson in its own state (`modelSeqByProvider`): a single global token lets
   * one key's response cancel another key's still-valid load. Here the status
   * chip loads the ACTIVE project while the settings screen loads the project
   * being EDITED, and those are routinely different — a global token would let
   * whichever landed second discard the other.
   */
  seqByProject: Record<string, number>
  connectionByProject: Record<string, MemoryConnection>
  /** The value `RETURN 1` actually answered, kept so the surface can say what
   *  was observed rather than merely that something was. */
  lastProbeByProject: Record<string, number | null>
  loadingByProject: Record<string, boolean>
  testingByProject: Record<string, boolean>
  /** The latest refusal or load failure, renderable verbatim beside the form. */
  error: string | null
}

export const useMemoryStore = defineStore('memory', {
  state: (): MemoryState => ({
    statusByProject: {},
    seqByProject: {},
    connectionByProject: {},
    lastProbeByProject: {},
    loadingByProject: {},
    testingByProject: {},
    error: null
  }),

  getters: {
    /** The status for a project, or null when it has never been loaded. ⚠ NULL
     *  IS NOT "unconfigured" — an unconfigured project has a real status whose
     *  `configured` is false. The chip must not render for either, but the
     *  settings form must only show its state once it knows one. */
    statusFor:
      (state) =>
      (projectId: string | null): MemoryStatusWire | null =>
        projectId ? (state.statusByProject[projectId] ?? null) : null,

    connectionFor:
      (state) =>
      (projectId: string | null): MemoryConnection =>
        projectId ? (state.connectionByProject[projectId] ?? 'unknown') : 'unknown',

    isTesting:
      (state) =>
      (projectId: string | null): boolean =>
        projectId ? (state.testingByProject[projectId] ?? false) : false
  },

  actions: {
    /** Record a refusal and hand it back verbatim, so the caller can render it
     *  inline next to the form that caused it. The `settings.ts` idiom. */
    refuse(reason: string): string {
      this.error = reason
      return reason
    },

    /**
     * Load one project's memory status.
     *
     * ⚠ THE SUPERSEDE GUARD IS PER PROJECT AND COVERS THE `loading` FLAG TOO.
     * An unguarded `loading = false` lets a stale load clear a live one's
     * spinner — the trap `settings.ts` names in its own `load()`.
     */
    async load(projectId: string): Promise<void> {
      const seq = (this.seqByProject[projectId] ?? 0) + 1
      this.seqByProject[projectId] = seq
      this.loadingByProject[projectId] = true
      try {
        const res = await window.chorus.getMemory(projectId)
        if (seq !== this.seqByProject[projectId]) return // superseded — drop it
        this.statusByProject[projectId] = res.memory
      } catch (e) {
        if (seq !== this.seqByProject[projectId]) return
        this.error = e instanceof Error ? e.message : String(e)
      } finally {
        if (seq === this.seqByProject[projectId]) this.loadingByProject[projectId] = false
      }
    },

    /**
     * The chip's read. Same shape, different channel — the `model:list` split.
     *
     * ⚠ IT IS SAFE TO CALL REPEATEDLY BECAUSE MAIN'S HANDLER IS A PURE READ,
     * AND THAT IS NOT A REASON TO POLL IT. There is no container in Stage 2, so
     * the configured state cannot change behind the app's back; the callers read
     * on project switch and after configure / disable / test, and nothing here
     * sets a timer.
     */
    async refreshStatus(projectId: string): Promise<void> {
      const seq = (this.seqByProject[projectId] ?? 0) + 1
      this.seqByProject[projectId] = seq
      try {
        const res = await window.chorus.memoryStatus(projectId)
        if (seq !== this.seqByProject[projectId]) return
        this.statusByProject[projectId] = res.memory
      } catch {
        if (seq !== this.seqByProject[projectId]) return
        // A failed status read must not take the chip's host surface with it —
        // drop the fact rather than rendering a wrong one (the `worktreeCount`
        // posture in StatusBar.vue).
        delete this.statusByProject[projectId]
      }
    },

    /**
     * Point a project at a Neo4j. Returns null on success, or the refusal
     * VERBATIM — components render it inline and must never enrich it with form
     * values.
     *
     * ⚠ EVERY ARGUMENT IS A PRIMITIVE READ OUT OF A COMPONENT REF. Passing a
     * reactive object across the bridge fails structured clone with "An object
     * could not be cloned" and no compile-time signal (D14).
     */
    async configure(
      projectId: string,
      mode: MemoryModeWire,
      authMode: MemoryAuthModeWire,
      boltUri: string,
      databaseName: string
    ): Promise<string | null> {
      this.error = null
      try {
        const res = await window.chorus.configureMemory(
          projectId,
          mode,
          authMode,
          boltUri,
          databaseName
        )
        if (!res.ok) return this.refuse(res.reason)
        this.statusByProject[projectId] = res.memory
        // ⚠ RE-POINTING AT A DIFFERENT DATABASE INVALIDATES THE OBSERVED
        // CONNECTION. Keeping the old `connected` would let the chip claim a
        // reachable database at an address nobody has tested.
        this.connectionByProject[projectId] = 'unknown'
        this.lastProbeByProject[projectId] = null
        return null
      } catch (e) {
        return this.refuse(e instanceof Error ? e.message : String(e))
      }
    },

    /** ⚠ REMOVES THE CONFIG, NOT THE GRAPH. No Neo4j data is destroyed, and the
     *  surface says so beside the button. */
    async disable(projectId: string): Promise<string | null> {
      this.error = null
      try {
        const res = await window.chorus.disableMemory(projectId)
        if (!res.ok) return this.refuse(res.reason)
        delete this.statusByProject[projectId]
        delete this.connectionByProject[projectId]
        delete this.lastProbeByProject[projectId]
        await this.refreshStatus(projectId)
        return null
      } catch (e) {
        return this.refuse(e instanceof Error ? e.message : String(e))
      }
    },

    /**
     * ONE live connect, from a click and nowhere else (D58).
     *
     * ⚠ THIS IS THE ONLY THING THAT MAY SET `connected`. D126: the state is
     * earned by an observed read. A successful `configure` does not set it, a
     * boot does not set it, and no timer sets it.
     */
    async test(projectId: string): Promise<string | null> {
      this.error = null
      this.testingByProject[projectId] = true
      try {
        const res = await window.chorus.testMemory(projectId)
        if (!res.ok) {
          this.connectionByProject[projectId] = 'failed'
          this.lastProbeByProject[projectId] = null
          return this.refuse(res.reason)
        }
        this.connectionByProject[projectId] = 'connected'
        this.lastProbeByProject[projectId] = res.probe
        return null
      } catch (e) {
        this.connectionByProject[projectId] = 'failed'
        return this.refuse(e instanceof Error ? e.message : String(e))
      } finally {
        this.testingByProject[projectId] = false
      }
    }
  }
})
