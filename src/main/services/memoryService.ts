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
import { asInt, type Neo4jClient } from './neo4jClient'
import {
  READ_VERSION_CYPHER,
  VERSION_NODE_CYPHER,
  pendingMigrations,
  versionNodeParams
} from './graphSchemaCore'
import { AFFECTED_LIMIT, PROVENANCE_QUERIES, completeness } from './provenanceCore'
import {
  INDEX_COMMIT_LIMIT,
  LINK_CONTAINS,
  LINK_MODIFIED,
  MARK_MISSING,
  UPSERT_COMMITS,
  UPSERT_DIRECTORIES,
  UPSERT_FILES,
  UPSERT_PROJECT,
  batched,
  buildRows,
  parseGitLogNameOnly,
  repoIdFrom,
  workspaceInstanceIdFor
} from './codeIndexCore'
import {
  CONTAINER_NAME_MISMATCH,
  DOCKER_NOT_AVAILABLE,
  LOOPBACK_HOST,
  containerNameFor,
  isRunning,
  noFreePort,
  publishedBoltEndpoint,
  shortContainerId,
  volumeNameFor,
  type ContainerState
} from './dockerCore'
import type { McpServerRef } from '../adapters/types'

/**
 * How long provision waits for a freshly started database to answer bolt.
 *
 * ⚠ BOUNDED, AND POLLED WITH THE REAL PROBE RATHER THAN SLEPT THROUGH. Neo4j
 * accepts TCP well before bolt is ready, so "the port is open" is not the
 * question; the graph answering is. 30 × 2 s covers a cold container start
 * comfortably while still failing in a minute rather than hanging a click.
 */
const BOLT_READY_ATTEMPTS = 30
const BOLT_READY_INTERVAL_MS = 2_000

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

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

export interface SeedReport {
  readonly fromVersion: number
  readonly toVersion: number
  readonly applied: readonly string[]
  /** ⚠ TRUE WHEN THE SQLITE CACHE DISAGREED WITH THE GRAPH. Surfaced rather than
   *  silently corrected: the disagreement is a real diagnostic (a graph restored
   *  from a dump, or reached by a second Chorus install), and papering over it
   *  hides the one fact that says which of the two is authoritative. */
  readonly cacheWasStale: boolean
  readonly cachedVersion: number
}

export interface ValidateReport {
  readonly withSource: number
  readonly total: number
  /** `"N of M"` — never a bare count, never a lone percentage (D55). */
  readonly text: string
  readonly affected: readonly { id: string; content: string; writtenVia: string }[]
  /** How many are unsourced in total, so a truncated list can say so. */
  readonly affectedTotal: number
}

/**
 * Task 6-5: everything an MCP-capable adapter needs to write ONE project's
 * config — assembled HERE and nowhere else.
 *
 * ⚠ `knownSecrets` COMES FROM THIS SERVICE BECAUSE THIS SERVICE IS THE ONE THAT
 * WOULD DECRYPT (spec §4). *"The adapter never resolves a credential itself"*,
 * and there is no code path on which an adapter holds a plaintext password for
 * any purpose other than being refused for holding it.
 *
 * ⚠ AND IT IS EMPTY IN THIS PHASE, WHICH IS A FACT RATHER THAN A GAP. D128(a)
 * ships local mode only — `NEO4J_AUTH=none` on loopback — so there is no
 * credential to name. The guard is not weakened by that: its SHAPE half runs
 * regardless, over bytes that should be clean by construction, which makes any
 * match a loud failure rather than a marginal one.
 */
export interface McpLaunchInput {
  readonly servers: readonly McpServerRef[]
  readonly knownSecrets: readonly string[]
  /** Where Chorus may write a config file it owns. Main's to choose — see
   *  `McpWriteContext.chorusConfigDir`. */
  readonly chorusConfigDir: string
}

/**
 * The MCP server Chorus writes, named once.
 *
 * ⚠ HYPHENATED, MATCHING 6-1 FINDING 1'S MEASURED OUTPUT (`chorus-memory`), and
 * it is the key the merge replaces — so renaming it would strand the old entry
 * in every `.mcp.json` Chorus has already written rather than updating it.
 */
export const CHORUS_MEMORY_SERVER = 'chorus-memory'

/**
 * The MCP server package, measured rather than remembered: `mcp-neo4j-cypher`
 * **0.6.0** from PyPI via `uvx` (6-1 ITEM 2, run against a real container).
 */
const MEMORY_MCP_COMMAND = 'uvx'
const MEMORY_MCP_PACKAGE = 'mcp-neo4j-cypher'

export interface MemoryService {
  /** ⚠ PURE READ. Decrypts nothing, opens no bolt session. */
  status(projectId: string): MemoryStatus
  /**
   * ⚠ PURE READ, exactly like `status` — one storage read and a projection.
   * Returns null when the project has no memory configured, which is the
   * ordinary case and means "write nothing", not "something went wrong".
   */
  mcpLaunchInput(projectId: string): McpLaunchInput | null
  /** ⚠ WRITES TO THE GRAPH. User-initiated only — never a boot hook (D58). */
  seed(projectId: string): Promise<MemoryResult<SeedReport>>
  /** Reads the provenance counts. User-initiated; no timer. */
  validate(projectId: string): Promise<MemoryResult<ValidateReport>>
  /** ⚠ WRITES THE STRUCTURAL NAMESPACE ONLY (`:File`, `:Directory`, `:Commit`,
   *  `:Project`). Never a memory label, never a delete. User-initiated: never a
   *  boot hook, never a watcher, never a timer (D58). */
  index(projectId: string): Promise<MemoryResult<IndexReport>>
  configure(input: ConfigureInput): MemoryResult<MemoryStatus>
  disable(projectId: string): MemoryResult<{ removed: boolean }>
  /**
   * Task 6a-4: give this project a working database in one press.
   *
   * ⚠ ADOPTS AN EXISTING CONTAINER RATHER THAN FAILING. Provisioning twice is
   * the ordinary case after a machine restart, and creating a second container
   * beside the first is the near-invisible failure this avoids.
   */
  provision(projectId: string): Promise<MemoryResult<ProvisionReport>>
  containerStatus(projectId: string): Promise<MemoryResult<ContainerStatusView>>
  containerStart(projectId: string): Promise<MemoryResult<ContainerStatusView>>
  containerStop(projectId: string): Promise<MemoryResult<ContainerStatusView>>
  /**
   * ⚠ REMOVES THE CONTAINER. NEVER THE VOLUME.
   *
   * `typedName` must equal the container's own name — main's typed-confirmation
   * gate (the `project:delete` D123 precedent), enforced HERE as well as at the
   * channel so a future caller cannot route around it.
   */
  containerRemove(
    projectId: string,
    typedName: string
  ): Promise<MemoryResult<{ removed: boolean }>>
  /** ⚠ ONE live connect + `RETURN 1`, user-initiated only (D58). */
  test(projectId: string): Promise<MemoryResult<{ probe: number }>>
  /** Called at `before-quit`, and on config change from `configure`. */
  dispose(): Promise<void>
}

/**
 * The git reads `index` needs, INJECTED rather than imported (Task 6a-2).
 *
 * ⚠ THIS MODULE MUST STAY LOADABLE UNDER PLAIN NODE — the same constraint that
 * made `MemoryStore` structural and `mcpConfigDir` a parameter. Importing
 * `git.ts` directly would pull `node:child_process` into every unit test of
 * this service and make the indexer un-stubbable, so main hands the four
 * functions over instead.
 */
export interface CodeIndexSource {
  /** Absolute path of the project's OWN checkout. Null when the project is
   *  unknown — a refusal, not a crash. */
  rootPathFor(projectId: string): string | null
  lsFiles(cwd: string): Promise<string[]>
  rootCommitShas(cwd: string): Promise<string[]>
  logNameOnly(cwd: string, limit: number): Promise<string>
  countCommits(cwd: string): Promise<number>
}

/**
 * What one `index` run did — a "N of M"-shaped honest object (D55).
 *
 * ⚠ `commitsSkippedBeyondLimit` IS THE FIELD THAT MATTERS MOST HERE. The
 * commit window is capped, and a cap nobody is told about reads as "we covered
 * everything". Measured on this repository: 241 commits exist and 200 are
 * linked, so 41 are skipped — a number the user SEES rather than one the code
 * merely knows.
 */
export interface IndexReport {
  readonly workspaceInstanceId: string
  /** Null for a project with no git history — then `commitsLinked` is 0 and
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

/**
 * The docker surface `provision` and the lifecycle methods need — declared
 * STRUCTURALLY and injected, exactly as `CodeIndexSource` is, so this module
 * stays loadable under plain node. `docker.ts` imports `child_process`; a test
 * that imported it transitively would spawn a daemon call to assert a refusal.
 *
 * ⚠ EVERY METHOD IS USER-INITIATED (D58). There is no reconciliation pass and no
 * timer behind any of them.
 */
export interface DockerSource {
  /** ⚠ "IS THE DAEMON RUNNING", not "is the binary installed" — Docker Desktop
   *  is routinely present with its daemon stopped. */
  available(): Promise<boolean>
  /** null is the ordinary unprovisioned case, not a failure. */
  inspect(containerName: string): Promise<ContainerState | null>
  run(o: {
    containerName: string
    volumeName: string
    boltPort: number
  }): Promise<string>
  start(containerName: string): Promise<void>
  stop(containerName: string): Promise<void>
  /** ⚠ THE CONTAINER. NEVER THE VOLUME (F49/D151). */
  remove(containerName: string): Promise<void>
  findFreePort(from?: number, tries?: number): Promise<number | null>
}

/** What `provision` did, reported rather than inferred by the caller. */
export interface ProvisionReport {
  readonly containerName: string
  readonly volumeName: string
  readonly boltPort: number
  readonly containerId: string
  /**
   * ⚠ TRUE WHEN AN EXISTING CONTAINER WAS REUSED RATHER THAN CREATED. The
   * second provision of the same project — after a machine restart, say — is
   * the ordinary case, and silently reporting it as a fresh create is how a
   * user ends up believing they have a clean database when they have their old
   * one. Surfaced because the difference matters to them, not to the code.
   */
  readonly adopted: boolean
  /** The graph's own answer over bolt, so readiness is an OBSERVED READ (D126)
   *  rather than a sleep that happened to be long enough. */
  readonly probe: number
  readonly status: MemoryStatus
}

/**
 * What the screen shows about the container.
 *
 * ⚠ NONE OF THIS MAY COLOUR THE STATUS CHIP. A running container is not a
 * connection; `Connected` is still earned by an observed read (D126), and a dot
 * that goes green because a process exists is exactly the dishonest signal
 * CR-6.0 was convened to prevent.
 */
export interface ContainerStatusView {
  /** null when this project's row names no container — i.e. it is pointed at a
   *  database somebody else started. */
  readonly containerName: string | null
  /** ⚠ FALSE WHEN THE ROW NAMES A CONTAINER THAT NO LONGER EXISTS. The status
   *  read is what heals a stale row; the row is never trusted on its own. */
  readonly exists: boolean
  readonly running: boolean
  /** docker's own lowercase state, or null when there is no container. */
  readonly state: string | null
  /** docker's human sentence, e.g. 'Exited (137) 2 minutes ago'. */
  readonly status: string | null
  /** `127.0.0.1:7688`, or null when stopped — docker drops the published ports
   *  once a container stops, measured. */
  readonly publishedAt: string | null
}

/** What main owns and this service is handed, rather than computing. */
export interface MemoryServiceOptions {
  /** Absolute path to the Chorus-owned directory for adapter MCP configs.
   *  ⚠ PASSED IN, NOT DERIVED. It is `app.getPath('userData')`-relative and
   *  this module must stay importable under plain node (tests cannot load
   *  `electron`), which is the same reason `MemoryStore` is structural. */
  readonly mcpConfigDir: string
  /** Task 6a-2 — see `CodeIndexSource`. */
  readonly codeIndex: CodeIndexSource
  /** Task 6a-4 — see `DockerSource`. */
  readonly docker: DockerSource
  /** How this project's container and volume are named. Injected as a function
   *  rather than computed here because the naming rule is pure and tested in
   *  `dockerCore.ts`, and this service must not grow a second copy of it. */
  readonly projectNameFor: (projectId: string) => string | null
}

export function createMemoryService(
  store: MemoryStore,
  driver: Neo4jClient,
  options: MemoryServiceOptions
): MemoryService {
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

  /**
   * ⚠ AUTHORED, AND IT NEVER FORWARDS DOCKER'S stderr WHOLESALE — the rule
   * `mergeMcpConfig` follows for a file it cannot parse. A tool's message can
   * contain a path, a mount point or an environment value, and this string is
   * rendered in the UI and pasted into bug reports.
   *
   * The timeout case is separated because it is the one a user can act on: a
   * first `run` pulls ~600 MB and a slow connection is not a broken daemon.
   */
  function dockerRefusal(action: string, err: unknown): string {
    const timedOut = err instanceof Error && 'timedOut' in err && Boolean(err.timedOut)
    return timedOut
      ? `Chorus timed out waiting for docker to ${action}. If this was the first run it may still be downloading the database image — try again in a few minutes.`
      : `Chorus could not ${action}. Check that Docker is running, then try again.`
  }

  /** The write half of `configure`, extracted so `provision` reuses it rather
   *  than growing a second row-writing path with its own normalisation. */
  function configureRow(input: ConfigureInput): MemoryResult<MemoryStatus> {
    const mode = supportedMode(input.mode)
    if (!mode.ok) return { ok: false, reason: mode.reason }

    const authMode = supportedAuthMode(input.authMode)
    if (!authMode.ok) return { ok: false, reason: authMode.reason }

    // ⚠ THE GUARD THAT KEEPS A PASSWORD OUT OF THE ONE FREE-TEXT COLUMN.
    const endpoint = validateBoltUri(input.boltUri)
    if (!endpoint.ok) return { ok: false, reason: endpoint.reason }

    const databaseName = input.databaseName.trim() || DEFAULT_DATABASE_NAME
    const now = new Date().toISOString()
    // ⚠ THE CONTAINER COLUMNS ARE CARRIED FORWARD, NOT RESET. Re-pointing a
    // provisioned project at a different address must not orphan the record of
    // the container Chorus started — the user still needs its name to manage it.
    const previous = store.getProjectMemory(input.projectId)
    const saved = store.upsertProjectMemory({
      projectId: input.projectId,
      mode: mode.value,
      // The NORMALISED uri — port explicit, host lower-cased, no userinfo.
      boltUri: endpoint.value.uri,
      databaseName,
      authMode: authMode.value,
      // ⚠ ALWAYS NULL IN THIS PHASE (D128(a)).
      credentialProfileId: null,
      containerId: previous?.containerId ?? null,
      containerName: previous?.containerName ?? null,
      volumeName: previous?.volumeName ?? null,
      boltPort: previous?.boltPort ?? null,
      httpPort: null,
      schemaVersion: previous?.schemaVersion ?? 0,
      lastSeededAt: previous?.lastSeededAt ?? null,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now
    })
    // ⚠ DISPOSE ON CONFIG CHANGE — see the original comment; not awaited,
    // because a socket teardown must not hold the form open behind it.
    void driver.dispose()
    return { ok: true, value: toStatus(saved) }
  }

  /**
   * ⚠ READINESS IS POLLED WITH THE REAL PROBE AND A BOUNDED ATTEMPT COUNT.
   *
   * A fixed sleep is a guess that fails on a cold image pull and wastes seconds
   * on a warm start. Neo4j accepts TCP well before bolt will answer, so only the
   * probe's own success means ready — the same standard the Test button is held
   * to (D126).
   */
  async function waitForBolt(uri: string, database: string): Promise<MemoryResult<number>> {
    let last = 'the database did not answer'
    for (let attempt = 0; attempt < BOLT_READY_ATTEMPTS; attempt++) {
      const probe = await driver.probe(uri, database)
      if (probe.ok) return { ok: true, value: probe.value }
      last = probe.reason
      await delay(BOLT_READY_INTERVAL_MS)
    }
    return {
      ok: false,
      reason:
        'The container started but its database did not answer in time. ' +
        `It may still be starting up — open this screen again in a moment. (${last})`
    }
  }

  /** One read of what docker says about this project's container. */
  async function readContainer(projectId: string): Promise<MemoryResult<ContainerStatusView>> {
    const row = store.getProjectMemory(projectId)
    // ⚠ `container_name` BEING NULL IS A REAL ANSWER, NOT AN ERROR: the project
    // is pointed at a database somebody else started, and the UI renders no
    // lifecycle controls for it (D76).
    if (!row?.containerName) {
      return {
        ok: true,
        value: {
          containerName: null,
          exists: false,
          running: false,
          state: null,
          status: null,
          publishedAt: null
        }
      }
    }
    if (!(await options.docker.available())) {
      return { ok: false, reason: DOCKER_NOT_AVAILABLE }
    }
    let state: ContainerState | null
    try {
      state = await options.docker.inspect(row.containerName)
    } catch (err) {
      return { ok: false, reason: dockerRefusal('read the container', err) }
    }
    // ⚠ THIS IS WHAT HEALS A STALE ROW. A container removed behind Chorus's back
    // reports `exists: false` here rather than the row's stored claim.
    return {
      ok: true,
      value: {
        containerName: row.containerName,
        exists: state !== null,
        running: isRunning(state),
        state: state?.state ?? null,
        status: state?.status ?? null,
        publishedAt: publishedBoltEndpoint(state)
      }
    }
  }

  async function actOnContainer(
    projectId: string,
    action: 'start' | 'stop'
  ): Promise<MemoryResult<ContainerStatusView>> {
    const row = store.getProjectMemory(projectId)
    if (!row?.containerName) {
      return { ok: false, reason: 'This project has no Chorus-managed container.' }
    }
    if (!(await options.docker.available())) {
      return { ok: false, reason: DOCKER_NOT_AVAILABLE }
    }
    try {
      if (action === 'start') await options.docker.start(row.containerName)
      else await options.docker.stop(row.containerName)
    } catch (err) {
      return { ok: false, reason: dockerRefusal(`${action} the container`, err) }
    }
    // Report what docker says AFTER the action rather than what was asked for —
    // the read is the fact, the request was only an intention.
    return readContainer(projectId)
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

    /**
     * Assemble the MCP server this project's agents should be given.
     *
     * ⚠ THE URI IS RE-VALIDATED ON THE WAY OUT, exactly as `test` and `seed`
     * re-validate it: the row could have been hand-edited, and this is the last
     * point before a string is written into another program's config file. An
     * unparseable row yields null — no config written — rather than a file
     * naming an address Chorus would refuse to connect to itself.
     *
     * ⚠ EVERY VALUE HERE IS NON-SECRET, AND IN THIS PHASE THAT IS STRUCTURAL
     * RATHER THAN CAREFUL. `validateBoltUri` refuses a URI carrying userinfo
     * (D93), so `bolt_uri` cannot hold `user:pass@host`; the database name is a
     * database name; and D128(a) means there is no password to name at all.
     *
     * ⚠ `NEO4J_URL`, NOT `NEO4J_URI` — measured. `mcp-neo4j-cypher` 0.6.0 reads
     * `NEO4J_URL` FIRST (`utils.py:68`) and only falls back to `NEO4J_URI`
     * (`utils.py:71`); 6-1 confirmed the precedence live by setting one correct
     * and the other deliberately wrong. `NEO4J_DATABASE` is read at
     * `utils.py:105`. No username and no password: 6-1 measured that the server
     * connects to an auth-disabled database with no credential env vars at all.
     */
    mcpLaunchInput(projectId) {
      const row = store.getProjectMemory(projectId)
      if (!row) return null
      const endpoint = validateBoltUri(row.boltUri)
      if (!endpoint.ok) return null
      return {
        servers: [
          {
            name: CHORUS_MEMORY_SERVER,
            command: MEMORY_MCP_COMMAND,
            args: [MEMORY_MCP_PACKAGE],
            env: {
              NEO4J_URL: endpoint.value.uri,
              NEO4J_DATABASE: row.databaseName
            }
          }
        ],
        // ⚠ EMPTY, AND SAYING SO IS THE POINT — see `McpLaunchInput`. The day a
        // credentialed mode arrives, the decrypted value is named HERE and the
        // guard's exact-value half starts biting without any adapter changing.
        knownSecrets: [],
        chorusConfigDir: options.mcpConfigDir
      }
    },

    /**
     * Refusals are authored in `configureRow` rather than by narrowing the Zod
     * enum on the boundary — a parse failure is a stack trace where a sentence
     * belongs. The `resolveLaunchProfile` precedent.
     *
     * ⚠ THE BODY MOVED TO `configureRow` IN TASK 6a-4 SO `provision` COULD REUSE
     * IT. That is what keeps URI normalisation, the userinfo refusal (D93) and
     * the driver dispose in ONE place instead of two that drift.
     */
    configure(input) {
      return configureRow(input)
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

    /**
     * ⚠ THE ORDER OF THESE STEPS IS THE DESIGN, AND EACH ONE IS WHERE IT IS FOR
     * A STATED REASON.
     */
    async provision(projectId) {
      // 1. Refuse before touching anything if docker cannot answer. The sentence
      //    names docker AND says what still works, because memory against a
      //    hand-started database is exactly what Phase 6 shipped.
      if (!(await options.docker.available())) {
        return { ok: false, reason: DOCKER_NOT_AVAILABLE }
      }

      const projectName = options.projectNameFor(projectId)
      if (projectName === null) {
        return { ok: false, reason: 'That project no longer exists.' }
      }

      // 2. Names are a PURE FUNCTION of the project, so the same project always
      //    resolves to the same container. This is what makes step 3 an adoption
      //    rather than a duplicate.
      const containerName = containerNameFor(projectId, projectName)
      const volumeName = volumeNameFor(containerName)

      let existing: ContainerState | null
      try {
        existing = await options.docker.inspect(containerName)
      } catch (err) {
        return { ok: false, reason: dockerRefusal('inspect the existing container', err) }
      }

      let containerId: string
      let boltPort: number
      const adopted = existing !== null

      if (existing) {
        // 3a. ADOPT. The port comes from what docker actually published, not
        //     from the stored row: a container recreated by hand may sit on a
        //     different port, and the row is the thing that should be corrected.
        const endpoint = publishedBoltEndpoint(existing)
        const storedPort = store.getProjectMemory(projectId)?.boltPort ?? null
        const observed = endpoint ? Number(endpoint.split(':')[1]) : null
        if (!isRunning(existing)) {
          try {
            await options.docker.start(containerName)
          } catch (err) {
            return { ok: false, reason: dockerRefusal('start the existing container', err) }
          }
        }
        // A stopped container publishes nothing, so re-read after starting it.
        let refreshed: ContainerState | null = existing
        if (!observed) {
          try {
            refreshed = await options.docker.inspect(containerName)
          } catch (err) {
            return { ok: false, reason: dockerRefusal('read the container back', err) }
          }
        }
        const finalEndpoint = publishedBoltEndpoint(refreshed)
        const finalPort = finalEndpoint ? Number(finalEndpoint.split(':')[1]) : storedPort
        if (finalPort === null || !Number.isFinite(finalPort)) {
          return {
            ok: false,
            reason:
              `A container called "${containerName}" already exists but Chorus cannot tell which port it publishes. ` +
              'Remove it yourself and provision again.'
          }
        }
        // Already short from `docker ps`, but normalised through the same
        // function as the create path so the two cannot drift apart again.
        containerId = shortContainerId(refreshed?.id ?? existing.id)
        boltPort = finalPort
      } else {
        // 3b. CREATE. The port probe binds loopback — the same interface the
        //     container will publish on — so a port free on one and taken on the
        //     other cannot slip through.
        const port = await options.docker.findFreePort()
        if (port === null) {
          return { ok: false, reason: noFreePort(7688, 40) }
        }
        boltPort = port
        try {
          containerId = shortContainerId(await options.docker.run({ containerName, volumeName, boltPort }))
        } catch (err) {
          return { ok: false, reason: dockerRefusal('create the container', err) }
        }
      }

      const boltUri = `bolt://${LOOPBACK_HOST}:${boltPort}`

      // 4. ⚠ READINESS IS AN OBSERVED READ, NOT A SLEEP (D126). A fixed delay is
      //    a guess that fails on a cold pull and wastes time on a warm start;
      //    the graph answering is the only fact worth acting on.
      const ready = await waitForBolt(boltUri, DEFAULT_DATABASE_NAME)
      if (!ready.ok) return ready

      // 5. Reuse `configure` rather than writing the row here, so URI
      //    normalisation, the userinfo refusal (D93) and the driver dispose all
      //    happen exactly once, in the method that already owns them.
      const configured = configureRow({
        projectId,
        mode: 'local-docker',
        authMode: 'none',
        boltUri,
        databaseName: DEFAULT_DATABASE_NAME
      })
      if (!configured.ok) return configured

      // 6. Persist what docker gave us, on the row `configure` just wrote.
      //    ⚠ `httpPort` STAYS NULL: the Neo4j browser port is deliberately not
      //    published, so there is no second exposure and nothing to record.
      const row = store.getProjectMemory(projectId)
      if (row) {
        store.upsertProjectMemory({
          ...row,
          containerId,
          containerName,
          volumeName,
          boltPort,
          httpPort: null,
          updatedAt: new Date().toISOString()
        })
      }

      return {
        ok: true,
        value: {
          containerName,
          volumeName,
          boltPort,
          containerId,
          adopted,
          probe: ready.value,
          status: toStatus(store.getProjectMemory(projectId))
        }
      }
    },

    async containerStatus(projectId) {
      return readContainer(projectId)
    },

    async containerStart(projectId) {
      return actOnContainer(projectId, 'start')
    },

    async containerStop(projectId) {
      return actOnContainer(projectId, 'stop')
    },

    /**
     * ⚠ THE TYPED NAME IS CHECKED HERE, NOT ONLY AT THE CHANNEL. A guard that
     * lives only at the boundary is walked past by the next caller; a guard in
     * two places that disagree is worse. This is the one that owns the rule, and
     * `ipc.ts` restates it so a bad payload never reaches a service call.
     */
    async containerRemove(projectId, typedName) {
      const row = store.getProjectMemory(projectId)
      if (!row?.containerName) {
        return { ok: false, reason: 'This project has no Chorus-managed container.' }
      }
      if (typedName !== row.containerName) {
        return { ok: false, reason: CONTAINER_NAME_MISMATCH }
      }
      if (!(await options.docker.available())) {
        return { ok: false, reason: DOCKER_NOT_AVAILABLE }
      }
      try {
        // Stopping first is what makes this a clean shutdown rather than a kill:
        // Neo4j flushes its store on SIGTERM, and that store is the volume this
        // task exists to preserve.
        const state = await options.docker.inspect(row.containerName)
        if (state && isRunning(state)) await options.docker.stop(row.containerName)
        await options.docker.remove(row.containerName)
      } catch (err) {
        return { ok: false, reason: dockerRefusal('remove the container', err) }
      }
      // ⚠ THE ROW KEEPS ITS `volume_name`. The volume outlives the container by
      // design (F49), and forgetting its name here would leave the user unable
      // to name the thing they own — the copy tells them to remove it by hand if
      // they mean to, and that instruction needs the name.
      store.upsertProjectMemory({
        ...row,
        containerId: null,
        updatedAt: new Date().toISOString()
      })
      return { ok: true, value: { removed: true } }
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

    /**
     * Apply pending graph migrations.
     *
     * ⚠ THE GRAPH IS RE-READ FIRST, EVERY TIME, AND THE SQLITE CACHE IS WRITTEN
     * ONLY AFTER A SUCCESSFUL APPLY (plan §8). The same graph can be restored
     * from a dump or reached by a second Chorus install, so a version taken from
     * `project_memory.schema_version` would claim a schema the graph does not
     * have. The cache is never an input to this decision — only an output.
     */
    async seed(projectId) {
      const row = store.getProjectMemory(projectId)
      if (!row) return { ok: false, reason: 'This project has no memory configured yet.' }
      const endpoint = validateBoltUri(row.boltUri)
      if (!endpoint.ok) return { ok: false, reason: `The saved address is not usable. ${endpoint.reason}` }

      type SeedWork =
        | { readonly seeded: false; readonly refusal: string }
        | {
            readonly seeded: true
            readonly graphVersion: number
            readonly toVersion: number
            readonly applied: string[]
          }

      const outcome = await driver.withSession<SeedWork>(endpoint.value.uri, row.databaseName, async (runner) => {
        const rows = await runner.run(READ_VERSION_CYPHER)
        // No :ChorusSchema node at all means a graph that has never been seeded.
        const graphVersion = rows.length > 0 && typeof rows[0].version === 'number' ? (rows[0].version as number) : 0

        const plan = pendingMigrations(graphVersion)
        if (!plan.ok) return { seeded: false, refusal: plan.reason }

        const applied: string[] = []
        for (const migration of plan.pending) {
          // ⚠ ONE STATEMENT AT A TIME, AND NOT IN A TRANSACTION. Neo4j refuses
          // schema commands (CREATE CONSTRAINT / INDEX) inside an explicit
          // transaction, so wrapping them would fail on the first one. Every
          // statement is idempotent — asserted over the list, not hoped for —
          // which is what makes a partial apply safe to re-run and is the
          // correct failure mode for something that runs before the feature is
          // usable.
          for (const statement of migration.statements) await runner.run(statement)
          await runner.run(VERSION_NODE_CYPHER, versionNodeParams(migration, new Date().toISOString()))
          applied.push(migration.name)
        }

        const after = await runner.run(READ_VERSION_CYPHER)
        const toVersion = after.length > 0 && typeof after[0].version === 'number' ? (after[0].version as number) : graphVersion
        return { seeded: true, graphVersion, toVersion, applied }
      })

      if (!outcome.ok) return { ok: false, reason: outcome.reason }
      if (!outcome.value.seeded) return { ok: false, reason: outcome.value.refusal }

      const { graphVersion, toVersion, applied } = outcome.value
      const cachedVersion = row.schemaVersion
      // Written only now, and only because the apply succeeded.
      store.upsertProjectMemory({ ...row, schemaVersion: toVersion, updatedAt: new Date().toISOString() })
      return {
        ok: true,
        value: {
          fromVersion: graphVersion,
          toVersion,
          applied,
          cacheWasStale: cachedVersion !== graphVersion,
          cachedVersion
        }
      }
    },

    /**
     * Walk this project's tracked files and recent commits into the graph's
     * STRUCTURAL namespace (Task 6a-2, D149).
     *
     * ⚠ NOTHING HERE DELETES. Every statement is a MERGE or a SET, and a file
     * that has left the tree is MARKED (`missingSince`), never removed —
     * because `validate` counts a `:Memory` as sourced only while its
     * `SUPPORTED_BY` target still exists, so a deleting refresh would drop the
     * project's trust ratio *because a refresh ran*.
     *
     * ⚠ THE ORDER MATTERS: directories before files before CONTAINS, because
     * the link statements MATCH nodes rather than creating them, and commits
     * before MODIFIED for the same reason. A link whose endpoints do not exist
     * yet silently matches nothing — no error, no edge.
     */
    async index(projectId) {
      const startedAt = Date.now()
      const row = store.getProjectMemory(projectId)
      if (!row) return { ok: false, reason: 'This project has no memory configured yet.' }
      const endpoint = validateBoltUri(row.boltUri)
      if (!endpoint.ok) return { ok: false, reason: `The saved address is not usable. ${endpoint.reason}` }

      const cwd = options.codeIndex.rootPathFor(projectId)
      if (cwd === null) {
        return { ok: false, reason: 'This project no longer has a folder on disk to index.' }
      }

      // ⚠ GIT FIRST, OUTSIDE THE SESSION. Spawning four git processes while
      // holding a bolt session would pin a connection open for the duration of
      // the walk for no reason; nothing here needs the database yet.
      let trackedPaths: string[]
      try {
        trackedPaths = await options.codeIndex.lsFiles(cwd)
      } catch {
        // The authored refusal the task asks for: a project that is not a git
        // repository is a normal state, not a stack trace.
        return {
          ok: false,
          reason: 'This project is not a git repository, so there is no file list to index.'
        }
      }

      const roots = await options.codeIndex.rootCommitShas(cwd)
      const repoId = repoIdFrom(roots)
      const totalCommits = await options.codeIndex.countCommits(cwd)

      // A repository with NO commits is not an error (identity model §3(ii)):
      // there is no repoId, so no :Commit may be written, and files still index.
      let commits: ReturnType<typeof parseGitLogNameOnly>['commits'] = []
      let skippedPaths = 0
      if (repoId !== null) {
        const parsed = parseGitLogNameOnly(
          await options.codeIndex.logNameOnly(cwd, INDEX_COMMIT_LIMIT)
        )
        commits = parsed.commits
        skippedPaths = parsed.skippedPaths
      }

      const workspaceInstanceId = workspaceInstanceIdFor(projectId)
      const rows = buildRows(trackedPaths, cwd)
      const runId = new Date().toISOString()
      const indexed = new Set(rows.files.map((f) => f.relPath))

      const outcome = await driver.withSession(endpoint.value.uri, row.databaseName, async (runner) => {
        // Same apply path as `seed` — indexing is user-initiated, so this
        // satisfies D58 exactly as seeding does. One statement at a time and
        // NOT in a transaction: Neo4j refuses schema commands inside one.
        const versionRows = await runner.run(READ_VERSION_CYPHER)
        const graphVersion =
          versionRows.length > 0 && typeof versionRows[0].version === 'number'
            ? (versionRows[0].version as number)
            : 0
        const plan = pendingMigrations(graphVersion)
        if (!plan.ok) return { refusal: plan.reason, marked: 0 }
        for (const migration of plan.pending) {
          for (const statement of migration.statements) await runner.run(statement)
          await runner.run(VERSION_NODE_CYPHER, versionNodeParams(migration, runId))
        }

        const base = { workspaceInstanceId, projectId, runId, repoRootAtWrite: cwd }
        await runner.run(UPSERT_PROJECT, { projectId, projectName: projectId, runId })

        for (const batch of batched(rows.directories)) {
          await runner.run(UPSERT_DIRECTORIES, { ...base, rows: batch })
        }
        for (const batch of batched(rows.files)) {
          await runner.run(UPSERT_FILES, { ...base, rows: batch })
        }
        for (const batch of batched(rows.contains)) {
          await runner.run(LINK_CONTAINS, { ...base, rows: batch })
        }

        if (repoId !== null && commits.length > 0) {
          const commitRows = commits.map((c) => ({
            sha: c.sha,
            subject: c.subject,
            authoredAt: c.authoredAt
          }))
          for (const batch of batched(commitRows)) {
            await runner.run(UPSERT_COMMITS, { ...base, repoId, rows: batch })
          }
          // ⚠ ONLY EDGES TO FILES THIS RUN ACTUALLY INDEXED. A commit touching
          // a path that has since left the tree would otherwise MATCH nothing
          // and quietly contribute no edge; filtering here makes the absence a
          // decision rather than a surprise.
          const modifiedRows = commits.flatMap((c) =>
            c.paths.filter((p) => indexed.has(p)).map((relPath) => ({ sha: c.sha, relPath }))
          )
          for (const batch of batched(modifiedRows)) {
            await runner.run(LINK_MODIFIED, { ...base, repoId, rows: batch })
          }
        }

        const markedRows = await runner.run(MARK_MISSING, { workspaceInstanceId, runId })
        // ⚠ A COUNT COMES BACK AS A NEO4J `Integer`, NEVER A JS NUMBER. Comparing
        // one with === reports failure against a database that answered
        // correctly; Phase 6 recorded this and it is normalised here.
        const marked = markedRows.length > 0 ? Number(markedRows[0].marked ?? 0) : 0
        return { refusal: null as string | null, marked }
      })

      if (!outcome.ok) return { ok: false, reason: outcome.reason }
      if (outcome.value.refusal !== null) return { ok: false, reason: outcome.value.refusal }

      // Only `updatedAt` — `lastSeededAt` belongs to seeding, and overloading it
      // would make two facts share one column.
      store.upsertProjectMemory({ ...row, updatedAt: new Date().toISOString() })

      return {
        ok: true,
        value: {
          workspaceInstanceId,
          repoId,
          filesSeen: rows.files.length,
          directories: rows.directories.length,
          commitsLinked: commits.length,
          commitsSkippedBeyondLimit: Math.max(0, totalCommits - commits.length),
          pathsSkippedUnparseable: rows.refused.length + skippedPaths,
          filesMarkedMissing: outcome.value.marked,
          elapsedMs: Date.now() - startedAt
        }
      }
    },

    async validate(projectId) {
      const row = store.getProjectMemory(projectId)
      if (!row) return { ok: false, reason: 'This project has no memory configured yet.' }
      const endpoint = validateBoltUri(row.boltUri)
      if (!endpoint.ok) return { ok: false, reason: `The saved address is not usable. ${endpoint.reason}` }

      const outcome = await driver.withSession(endpoint.value.uri, row.databaseName, async (runner) => {
        const params = { projectId }
        const totalRows = await runner.run(PROVENANCE_QUERIES.total, params)
        const withRows = await runner.run(PROVENANCE_QUERIES.withSource, params)
        const affectedRows = await runner.run(PROVENANCE_QUERIES.affected, {
          ...params,
          // ⚠ `asInt`, NOT A PLAIN NUMBER. JavaScript has one number type and the
          // driver sends `50` as a FLOAT, which `LIMIT` refuses outright
          // (Neo.ClientError.Statement.ArgumentError). Caught at G2, not by the
          // unit tests, which assert the query string rather than run it.
          limit: asInt(AFFECTED_LIMIT)
        })
        const total = Number(totalRows[0]?.total ?? 0)
        const withSource = Number(withRows[0]?.withSource ?? 0)
        return { total, withSource, affectedRows }
      })

      if (!outcome.ok) return { ok: false, reason: outcome.reason }
      const { total, withSource, affectedRows } = outcome.value
      const pair = completeness(withSource, total)
      return {
        ok: true,
        value: {
          withSource: pair.withSource,
          total: pair.total,
          text: pair.text,
          affected: affectedRows.map((r) => ({
            id: String(r.id ?? ''),
            content: String(r.content ?? ''),
            writtenVia: String(r.writtenVia ?? '')
          })),
          // Derived rather than queried: total - withSource is exactly the
          // unsourced count, so a fourth round trip would buy nothing and could
          // disagree with the other three if the graph moved between them.
          affectedTotal: pair.total - pair.withSource
        }
      }
    },

    dispose() {
      return driver.dispose()
    }
  }
}
