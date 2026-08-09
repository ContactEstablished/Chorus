import type { NewProjectMemoryRow, ProjectMemoryRow } from '../db/schema'
import {
  DEFAULT_DATABASE_NAME,
  boltHostOf,
  boltPortOf,
  supportedAuthMode,
  supportedMode,
  validateBoltUri,
  type MemoryAuthMode,
  type MemoryMode
} from './memoryConfigCore'
import type { Neo4jClient } from './neo4jClient'

/**
 * Task 6-3 (Phase 6 Stage 2) — per-project memory configuration, and the one
 * user-initiated connection test.
 *
 * ⚠ THIS MODULE DOES NOT IMPORT `vault`, AND THE ABSENCE IS THE DESIGN. The
 * design plan calls it *"the ONLY module that decrypts"* — in a future where
 * something decrypts. In THIS phase nothing does: D128(a) took credentialed
 * mode out of Phase 6 entirely after CR-6.0 returned `REVISE` on Q3, so
 * `auth_mode` is always `'none'` and `credential_profile_id` is always NULL.
 * Importing `vault.decryptForLaunch` speculatively would be the stub D76
 * forbids, one layer down. When credentialed mode does arrive it REUSES
 * `decryptForLaunch` and never forks it (D33 clause 2, D58's admission terms).
 *
 * ⚠ THE `status` / `test` SPLIT IS THE MOST DANGEROUS LINE IN THIS TASK.
 * `status` is a PURE READ: it decrypts nothing and opens no bolt session, which
 * is what makes it safe for a status chip to call. `test` is ONE live connect,
 * user-initiated only — no boot hook, no timer, no restore path, no retry
 * (D58, verbatim). Getting that split wrong turns a chip into an unattended
 * loop against a database, and in a credentialed future into an unattended
 * DECRYPT loop, which D33/D53/D58 forbid outright. The `driver` below is
 * reachable from exactly one method, and a test asserts it by handing this
 * service a factory that throws if called.
 */

/**
 * The storage surface this service needs — declared structurally rather than
 * importing `StorageService`, for the reason plan §9 gives: tests cannot import
 * `storage.ts` (Electron ABI 148 vs Node 127). The `modelCatalog.ts` precedent.
 */
export interface MemoryStore {
  getProjectMemory(projectId: string): ProjectMemoryRow | null
  upsertProjectMemory(row: NewProjectMemoryRow): ProjectMemoryRow
  deleteProjectMemory(projectId: string): boolean
}

/**
 * What the renderer is told about a project's memory.
 *
 * ⚠ THERE IS NO PASSWORD FIELD AND NO BOLT URI HERE, AND BOTH ABSENCES ARE
 * DELIBERATE. The URI is withheld even though this phase refuses to store one
 * carrying credentials: a normalised string is still a string, and the day
 * somebody relaxes `validateBoltUri` the payload would start carrying userinfo
 * without a single line of this file changing. Host and port are what the UI
 * actually renders, and neither can embed a secret. The key-set assertion in
 * `ipc.test.ts` is what keeps this true in 2027.
 */
export interface MemoryStatus {
  readonly configured: boolean
  readonly mode: MemoryMode | null
  readonly authMode: MemoryAuthMode | null
  readonly host: string | null
  readonly port: number | null
  readonly databaseName: string | null
  /** A CACHE of the graph's own answer (plan §8); 0 until Task 6-4's seeder. */
  readonly schemaVersion: number
  readonly lastSeededAt: string | null
  readonly updatedAt: string | null
}

export interface ConfigureInput {
  readonly projectId: string
  readonly mode: MemoryMode
  readonly authMode: MemoryAuthMode
  readonly boltUri: string
  readonly databaseName: string
}

export type MemoryResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string }

/** The unconfigured answer, stated once. A project with no memory is a real
 *  state rather than a missing one — and the chip renders NOTHING for it
 *  (D76), which is why every field is null rather than zero. */
const UNCONFIGURED: MemoryStatus = {
  configured: false,
  mode: null,
  authMode: null,
  host: null,
  port: null,
  databaseName: null,
  schemaVersion: 0,
  lastSeededAt: null,
  updatedAt: null
}

export interface MemoryService {
  /** ⚠ PURE READ. Decrypts nothing, opens no bolt session. */
  status(projectId: string): MemoryStatus
  configure(input: ConfigureInput): MemoryResult<MemoryStatus>
  disable(projectId: string): MemoryResult<{ removed: boolean }>
  /** ⚠ ONE live connect + `RETURN 1`, user-initiated only (D58). */
  test(projectId: string): Promise<MemoryResult<{ probe: number }>>
  /** Called at `before-quit`, and on config change from `configure`. */
  dispose(): Promise<void>
}

export function createMemoryService(store: MemoryStore, driver: Neo4jClient): MemoryService {
  function toStatus(row: ProjectMemoryRow | null): MemoryStatus {
    if (!row) return UNCONFIGURED
    return {
      configured: true,
      mode: row.mode as MemoryMode,
      authMode: row.authMode as MemoryAuthMode,
      // Derived through the tested pure extractors rather than by slicing the
      // string here — and null rather than a guess when a hand-edited row
      // cannot be parsed, so the chip omits the port instead of claiming one.
      host: boltHostOf(row.boltUri),
      port: boltPortOf(row.boltUri),
      databaseName: row.databaseName,
      schemaVersion: row.schemaVersion,
      lastSeededAt: row.lastSeededAt,
      updatedAt: row.updatedAt
    }
  }

  return {
    /**
     * ⚠ THE WHOLE BODY IS ONE STORAGE READ AND A PROJECTION. `driver` is not
     * named in this function, and that is the invariant the structural test
     * pins: it constructs this service with a factory that throws if called and
     * asserts `status` still answers.
     */
    status(projectId) {
      return toStatus(store.getProjectMemory(projectId))
    },

    configure(input) {
      // Refusals are authored HERE rather than by narrowing the Zod enum on the
      // boundary — a parse failure is a stack trace where a sentence belongs,
      // and a one-value enum would have to be widened at Stage 5 anyway. The
      // `resolveLaunchProfile` precedent.
      const mode = supportedMode(input.mode)
      if (!mode.ok) return { ok: false, reason: mode.reason }

      const authMode = supportedAuthMode(input.authMode)
      if (!authMode.ok) return { ok: false, reason: authMode.reason }

      // ⚠ THE GUARD THAT KEEPS A PASSWORD OUT OF THE ONE FREE-TEXT COLUMN.
      const endpoint = validateBoltUri(input.boltUri)
      if (!endpoint.ok) return { ok: false, reason: endpoint.reason }

      const databaseName = input.databaseName.trim() || DEFAULT_DATABASE_NAME

      const now = new Date().toISOString()
      const saved = store.upsertProjectMemory({
        projectId: input.projectId,
        mode: mode.value,
        // The NORMALISED uri — port explicit, host lower-cased, no userinfo.
        boltUri: endpoint.value.uri,
        databaseName,
        authMode: authMode.value,
        // ⚠ ALWAYS NULL IN THIS PHASE (D128(a)). Stated rather than omitted, so
        // the write site says what the column holds.
        credentialProfileId: null,
        // Stage 5's, and untouched here.
        containerId: null,
        containerName: null,
        volumeName: null,
        boltPort: null,
        httpPort: null,
        schemaVersion: 0,
        lastSeededAt: null,
        createdAt: now,
        updatedAt: now
      })
      // ⚠ DISPOSE ON CONFIG CHANGE. `probe` also drops a driver whose URI no
      // longer matches, so this is belt and braces — but it is the difference
      // between a pool for a discarded address closing NOW and closing whenever
      // somebody next clicks Test, which might be never. Not awaited: this
      // method's answer is the saved row, and a socket teardown must not hold
      // the form open behind it.
      void driver.dispose()
      return { ok: true, value: toStatus(saved) }
    },

    /**
     * ⚠ DELETES THE CONFIG. IT DOES NOT DESTROY GRAPH DATA — nothing in this
     * method speaks bolt, and the UI must say which. Returns whether a row
     * actually went, so disabling an unconfigured project reports honestly
     * rather than claiming a removal that did not happen.
     */
    disable(projectId) {
      return { ok: true, value: { removed: store.deleteProjectMemory(projectId) } }
    },

    async test(projectId) {
      const row = store.getProjectMemory(projectId)
      if (!row) {
        return { ok: false, reason: 'This project has no memory configured yet.' }
      }
      // Re-validated on the way OUT as well as on the way in: the row could
      // have been hand-edited, and this is the last point before a string is
      // handed to a driver.
      const endpoint = validateBoltUri(row.boltUri)
      if (!endpoint.ok) {
        return { ok: false, reason: `The saved address is not usable. ${endpoint.reason}` }
      }
      const probe = await driver.probe(endpoint.value.uri, row.databaseName)
      if (!probe.ok) return { ok: false, reason: probe.reason }
      return { ok: true, value: { probe: probe.value } }
    },

    dispose() {
      return driver.dispose()
    }
  }
}
