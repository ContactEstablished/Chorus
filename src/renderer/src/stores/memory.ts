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

  /* ---- Task 6-4 ---------------------------------------------------- */
  /** The last seed's report, per project. Session-lifetime, like `connection`:
   *  it describes something the app observed, not something it stored. */
  seedByProject: Record<string, MemorySeedReport>
  validationByProject: Record<string, MemoryValidation>
  /** Task 6b-1 (D168): the project's memory-usage roll-up, recorded from
   *  `memory:validate` on BOTH branches — the counters are a local read and are
   *  just as true when the graph refused. Session-lifetime, like the rest. */
  usageByProject: Record<string, MemoryUsage>
  seedingByProject: Record<string, boolean>
  validatingByProject: Record<string, boolean>

  /* ---- Task 6a-2 --------------------------------------------------- */
  /** The last index run's report, per project. Session-lifetime, like the two
   *  above: it describes something the app observed, not something it stored. */
  indexByProject: Record<string, MemoryIndexReport>
  indexingByProject: Record<string, boolean>
  /** Task 6a-4: what docker last said about each project's container. */
  containerByProject: Record<string, MemoryContainerStatus>
  containerBusyByProject: Record<string, boolean>
}

/**
 * What docker says about a project's container.
 *
 * ⚠ NONE OF THIS MAY COLOUR THE STATUS CHIP. A running container is not a
 * connection — `Connected` is still earned by the Test button's observed read
 * (D126), and a dot that went green because a process exists is exactly the
 * dishonest signal CR-6.0 was convened to prevent. The chip reads
 * `connectionByProject`; nothing here writes to it.
 */
export interface MemoryContainerStatus {
  /** Null when the project points at a database somebody else started — then no
   *  lifecycle controls render at all (D76). */
  readonly containerName: string | null
  /** ⚠ FALSE WHEN THE ROW NAMES A CONTAINER THAT IS GONE. The read heals a
   *  stale row rather than echoing it. */
  readonly exists: boolean
  readonly running: boolean
  readonly state: string | null
  readonly status: string | null
  /** `127.0.0.1:7688`, or null when stopped — docker drops published ports the
   *  moment a container stops. */
  readonly publishedAt: string | null
}

/** One `index` run, camel-cased for the renderer.
 *
 *  ⚠ `commitsSkippedBeyondLimit` IS RENDERED, NOT MERELY STORED. The commit
 *  window is capped, and a truncation nobody is shown reads as full coverage. */
export interface MemoryIndexReport {
  readonly workspaceInstanceId: string
  /** Null when the project has no git history — then `commitsLinked` is 0 and
   *  the UI says WHY rather than showing a zero that looks like a failure. */
  readonly repoId: string | null
  readonly filesSeen: number
  readonly directories: number
  readonly commitsLinked: number
  readonly commitsSkippedBeyondLimit: number
  readonly pathsSkippedUnparseable: number
  readonly filesMarkedMissing: number
  readonly elapsedMs: number
}

export interface MemorySeedReport {
  readonly fromVersion: number
  readonly toVersion: number
  readonly applied: readonly string[]
  readonly cacheWasStale: boolean
  readonly cachedVersion: number
}

export interface MemoryValidation {
  readonly withSource: number
  readonly total: number
  /** `"N of M"`, built in main by the tested pure core — never assembled here. */
  readonly text: string
  readonly affected: readonly { id: string; content: string; writtenVia: string }[]
  readonly affectedTotal: number
}

/**
 * Task 6b-1 (D168, amended by D173): the project's memory-usage roll-up.
 *
 * ⚠ `text` AND `breakdownText` ARE BUILT IN MAIN by the tested core
 * (`shared/provenance.ts`) — the denominator, the words "successful" and
 * "Claude Code", and the ISO day are all already inside the sentence. This
 * store and every template that reads it do NO arithmetic and NO assembly.
 * `readFirst + inconclusive` need not equal `sessions`; nothing may render
 * `sessions - readFirst` as a failure count.
 */
export interface MemoryUsage {
  readonly reads: number
  readonly writes: number
  readonly sessions: number
  readonly since: string | null
  readonly readFirst: number
  readonly inconclusive: number
  readonly shellFirst: number
  readonly text: string
  readonly breakdownText: string | null
}

export const useMemoryStore = defineStore('memory', {
  state: (): MemoryState => ({
    statusByProject: {},
    seqByProject: {},
    connectionByProject: {},
    lastProbeByProject: {},
    loadingByProject: {},
    testingByProject: {},
    error: null,
    seedByProject: {},
    validationByProject: {},
    usageByProject: {},
    seedingByProject: {},
    validatingByProject: {},
    indexByProject: {},
    indexingByProject: {},
    containerByProject: {},
    containerBusyByProject: {}
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
    },

    /**
     * Apply the graph's pending schema migrations.
     *
     * ⚠ IT WRITES, SO IT IS ONLY EVER A CLICK (D58). Nothing here is called on
     * mount, on project switch, or on a timer — unlike `refreshStatus`, which is
     * a pure read and still is not polled.
     */
    async seed(projectId: string): Promise<string | null> {
      this.error = null
      this.seedingByProject[projectId] = true
      try {
        const res = await window.chorus.seedMemory(projectId)
        if (!res.ok) return this.refuse(res.reason)
        this.seedByProject[projectId] = {
          fromVersion: res.from_version,
          toVersion: res.to_version,
          applied: res.applied,
          cacheWasStale: res.cache_was_stale,
          cachedVersion: res.cached_version
        }
        // The seed writes `schema_version`, so the cached status is now stale.
        await this.refreshStatus(projectId)
        return null
      } catch (e) {
        return this.refuse(e instanceof Error ? e.message : String(e))
      } finally {
        this.seedingByProject[projectId] = false
      }
    },

    /** The provenance count. ⚠ The pair arrives already formatted by main — this
     *  store never assembles "N of M", so there is one place it can be got
     *  wrong rather than two (D55). */
    /** Task 6a-2. Slow by design — it spawns git and writes in batches — so the
     *  pending flag is per project rather than global. */
    async index(projectId: string): Promise<string | null> {
      this.error = null
      this.indexingByProject[projectId] = true
      try {
        const res = await window.chorus.indexMemory(projectId)
        if (!res.ok) return this.refuse(res.reason)
        this.indexByProject[projectId] = {
          workspaceInstanceId: res.workspace_instance_id,
          repoId: res.repo_id,
          filesSeen: res.files_seen,
          directories: res.directories,
          commitsLinked: res.commits_linked,
          commitsSkippedBeyondLimit: res.commits_skipped_beyond_limit,
          pathsSkippedUnparseable: res.paths_skipped_unparseable,
          filesMarkedMissing: res.files_marked_missing,
          elapsedMs: res.elapsed_ms
        }
        return null
      } catch (e) {
        return this.refuse(e instanceof Error ? e.message : String(e))
      } finally {
        this.indexingByProject[projectId] = false
      }
    },

    async validate(projectId: string): Promise<string | null> {
      this.error = null
      this.validatingByProject[projectId] = true
      try {
        const res = await window.chorus.validateMemory(projectId)
        // ⚠ RECORDED BEFORE THE REFUSAL BRANCH (Task 6b-1). The counters are a
        // local read and are just as true when the graph is unreachable — see
        // `memoryUsageSummarySchema` on why `usage` is on both branches.
        this.usageByProject[projectId] = {
          reads: res.usage.reads,
          writes: res.usage.writes,
          sessions: res.usage.sessions,
          since: res.usage.since,
          readFirst: res.usage.readFirst,
          inconclusive: res.usage.inconclusive,
          shellFirst: res.usage.shellFirst,
          text: res.usage.text,
          breakdownText: res.usage.breakdownText
        }
        if (!res.ok) return this.refuse(res.reason)
        this.validationByProject[projectId] = {
          withSource: res.with_source,
          total: res.total,
          text: res.text,
          affected: res.affected.map((a) => ({
            id: a.id,
            content: a.content,
            writtenVia: a.written_via
          })),
          affectedTotal: res.affected_total
        }
        return null
      } catch (e) {
        return this.refuse(e instanceof Error ? e.message : String(e))
      } finally {
        this.validatingByProject[projectId] = false
      }
    },

    /* ─────────────────── Task 6a-4: the provisioner ──────────────────── */

    /**
     * ⚠ SLOW ON FIRST USE: it may pull ~600 MB and then wait for the database to
     * answer. The pending flag is per project, and the caller must render it —
     * a click that looks instant and takes four minutes reads as a hang.
     */
    async provision(projectId: string): Promise<string | null> {
      this.error = null
      this.containerBusyByProject[projectId] = true
      try {
        const res = await window.chorus.provisionMemory(projectId)
        if (!res.ok) return this.refuse(res.reason)
        // Provision rewrites the project's memory config, so the form's own
        // status is stale the moment this returns.
        await this.refreshStatus(projectId)
        await this.refreshContainer(projectId)
        return null
      } catch (e) {
        return this.refuse(e instanceof Error ? e.message : String(e))
      } finally {
        this.containerBusyByProject[projectId] = false
      }
    },

    /**
     * ⚠ CALLED WHEN THE SCREEN OPENS AND AFTER EACH ACTION — NEVER ON A TIMER.
     * D58's rule ("one live connect, and only ever from a click") applied to a
     * second kind of connection. A poll here would spawn a docker process every
     * few seconds for a screen nobody is looking at.
     */
    async refreshContainer(projectId: string): Promise<string | null> {
      try {
        const res = await window.chorus.memoryContainerStatus(projectId)
        if (!res.ok) return this.refuse(res.reason)
        this.containerByProject[projectId] = {
          containerName: res.container_name,
          exists: res.exists,
          running: res.running,
          state: res.state,
          status: res.status,
          publishedAt: res.published_at
        }
        return null
      } catch (e) {
        return this.refuse(e instanceof Error ? e.message : String(e))
      }
    },

    async startContainer(projectId: string): Promise<string | null> {
      return this.containerAction(projectId, 'start')
    },

    async stopContainer(projectId: string): Promise<string | null> {
      return this.containerAction(projectId, 'stop')
    },

    /** Start and stop differ by one word, and both store what docker reports
     *  AFTER the action rather than what was asked for. */
    async containerAction(projectId: string, action: 'start' | 'stop'): Promise<string | null> {
      this.error = null
      this.containerBusyByProject[projectId] = true
      try {
        const res =
          action === 'start'
            ? await window.chorus.memoryContainerStart(projectId)
            : await window.chorus.memoryContainerStop(projectId)
        if (!res.ok) return this.refuse(res.reason)
        this.containerByProject[projectId] = {
          containerName: res.container_name,
          exists: res.exists,
          running: res.running,
          state: res.state,
          status: res.status,
          publishedAt: res.published_at
        }
        // ⚠ AND THE CHIP IS NOT TOUCHED. Stopping a container does not prove the
        // connection is dead any more than starting one proves it is alive; the
        // chip stays whatever the last observed READ made it (D126).
        return null
      } catch (e) {
        return this.refuse(e instanceof Error ? e.message : String(e))
      } finally {
        this.containerBusyByProject[projectId] = false
      }
    },

    /**
     * ⚠ `typedName` IS CARRIED, NOT ENFORCED. Main checks it against the row and
     * refuses on a mismatch — this store passing it is the user's typing being
     * delivered, and a disabled button here is an affordance rather than a
     * guard (the `project:delete` D123 precedent).
     */
    async removeContainer(projectId: string, typedName: string): Promise<string | null> {
      this.error = null
      this.containerBusyByProject[projectId] = true
      try {
        const res = await window.chorus.memoryContainerRemove(projectId, typedName)
        if (!res.ok) return this.refuse(res.reason)
        await this.refreshContainer(projectId)
        return null
      } catch (e) {
        return this.refuse(e instanceof Error ? e.message : String(e))
      } finally {
        this.containerBusyByProject[projectId] = false
      }
    }

  }
})
