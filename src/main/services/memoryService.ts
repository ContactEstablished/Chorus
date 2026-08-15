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
import type { McpServerRef } from '../adapters/types'

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

/** What main owns and this service is handed, rather than computing. */
export interface MemoryServiceOptions {
  /** Absolute path to the Chorus-owned directory for adapter MCP configs.
   *  ⚠ PASSED IN, NOT DERIVED. It is `app.getPath('userData')`-relative and
   *  this module must stay importable under plain node (tests cannot load
   *  `electron`), which is the same reason `MemoryStore` is structural. */
  readonly mcpConfigDir: string
  /** Task 6a-2 — see `CodeIndexSource`. */
  readonly codeIndex: CodeIndexSource
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
