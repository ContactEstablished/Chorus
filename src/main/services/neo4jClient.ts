import neo4j from 'neo4j-driver'
import { logger } from './logger'

/**
 * Task 6-3 (Phase 6 Stage 2) — the bolt shell. The FIRST module in this repo
 * that opens a connection to a graph database.
 *
 * A SHELL, not a core (plan §9): it owns the driver and does no deciding.
 * Every rule about what is a legal endpoint lives in `memoryConfigCore.ts`,
 * which is pure and therefore tested; this file is driven at G2.
 *
 * ⚠ IT NEVER LOGS A URI, AND THAT IS A HARD RULE RATHER THAN TIDINESS. A bolt
 * URI can carry inline credentials (`bolt://user:pass@host`), so a URI in a log
 * line is a password in a log file. `memoryConfigCore.validateBoltUri` refuses
 * that form on the way in, and this file refuses to print the string at all —
 * two independent guards, because the log is the copy that outlives the app and
 * gets pasted into bug reports.
 *
 * ⚠ AND IT NEVER RETRIES. D58's terms, verbatim: `memory:test` is ONE
 * user-initiated connect. No boot hook, no timer, no restore path, no retry,
 * no backoff. A driver configured to retry would turn one click into a
 * background loop, which is the shape D33/D53/D58 exist to forbid.
 */

/**
 * Structural minimum of the driver, declared rather than importing the
 * library's own type — the `FetchLike` precedent in `modelCatalog.ts:70`. It
 * exists so a test can pass a plain object, and more importantly so
 * `memoryService` can be handed a factory that THROWS IF CALLED, which is how
 * the "`memory:status` opens no bolt session" assertion is made structurally
 * rather than by a comment.
 */
export interface Neo4jSessionLike {
  run(query: string): Promise<{ records: Array<{ get(key: string): unknown }> }>
  close(): Promise<void>
}

export interface Neo4jDriverLike {
  session(config: { database: string }): Neo4jSessionLike
  close(): Promise<void>
}

/** How a driver is made. Injected everywhere, so nothing that must not connect
 *  can connect by accident. */
export type DriverFactory = (uri: string) => Neo4jDriverLike

/** A human is watching a button, not a server riding out a blip. */
const CONNECT_TIMEOUT_MS = 5000

/**
 * The real factory. NO AUTH TOKEN AT ALL — Phase 6 ships local mode only
 * (D128(a)), against a Neo4j started with `NEO4J_AUTH=none`.
 *
 * ⚠ NOT `neo4j.auth.none()`, AND THE REASON IS MEASURED RATHER THAN STYLISTIC.
 * That helper still EXISTS at runtime in 6.2.0 (`Object.keys(neo4j.auth)` lists
 * it) but is NOT in the package's own type declarations — `types/index.d.ts:133`
 * declares only `basic`, `kerberos`, `bearer` and `custom`. Reaching it would
 * take a cast, i.e. asserting a shape the library has stopped promising.
 * `authToken` is OPTIONAL in the declared signature (`:161–165`), so omitting
 * it is the supported way to say "no authentication" in 6.x, and it is what
 * G2 proved against the real 5.26.29 image.
 *
 * ⚠ THE TIMEOUTS ARE PINNED SHORT AND RETRIES ARE TURNED OFF, NOT SHORTENED.
 * The driver's defaults are tuned for a service that wants to survive a blip;
 * this call is a person waiting for a button to come back, so a 60-second
 * default would look like the app had hung. `maxTransactionRetryTime: 0` is
 * D58's "no retry" expressed in the one place that could otherwise reintroduce
 * one without anybody writing a loop.
 */
export const createRealDriver: DriverFactory = (uri) =>
  neo4j.driver(uri, undefined, {
    connectionAcquisitionTimeout: CONNECT_TIMEOUT_MS,
    connectionTimeout: CONNECT_TIMEOUT_MS,
    maxTransactionRetryTime: 0,
    // ⚠ THE DRIVER'S OWN LOGGING PRINTS THE URI. It is off, and this comment is
    // why it must stay off.
    logging: { level: 'error', logger: () => {} }
  }) as unknown as Neo4jDriverLike

/** The probe query. `RETURN 1` and nothing else — no schema read, no write, no
 *  APOC (measured absent from `neo4j:5-community`, D4 pass ITEM 1). */
const PROBE_QUERY = 'RETURN 1 AS probe'
const PROBE_KEY = 'probe'

export type ProbeResult =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly reason: string }

/**
 * Neo4j returns integers as its own `Integer` type by default (and as `bigint`
 * under some configurations), so the probe's value cannot simply be compared to
 * `1`. Normalising here is what lets the caller ASSERT THE VALUE rather than
 * merely assert that a record came back.
 */
function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return v
  if (typeof v === 'bigint') return Number(v)
  if (v !== null && typeof v === 'object' && 'toNumber' in v) {
    const n = (v as { toNumber(): number }).toNumber()
    return typeof n === 'number' ? n : null
  }
  return null
}

/**
 * Owns at most ONE driver at a time, keyed by the URI it was made for.
 *
 * ⚠ LAZY, AND SINGLE. No driver exists until somebody clicks Test; pointing the
 * project at a different address disposes the old one before making a new one,
 * so two pools can never be open at once. In Stage 2 that cache is populated
 * only by a user-initiated click and holds one entry — but the shape is the one
 * Stage 3's seeder and validator need, and building it now means the disposal
 * wiring is proven at G2 rather than added under a feature that depends on it.
 *
 * ⚠ DISPOSAL IS WIRED TO `before-quit` (`src/main/index.ts`). A driver holds a
 * connection pool with live sockets; left open it keeps handles alive past the
 * point the app has stopped.
 */
export interface Neo4jClient {
  probe(uri: string, database: string): Promise<ProbeResult>
  /** Drop the cached driver, if any. Called on config change and at quit. */
  dispose(): Promise<void>
  /** For assertions: is a driver currently held? */
  isOpen(): boolean
}

export function createNeo4jClient(factory: DriverFactory = createRealDriver): Neo4jClient {
  let held: { uri: string; driver: Neo4jDriverLike } | null = null

  async function dispose(): Promise<void> {
    const current = held
    held = null
    if (!current) return
    try {
      await current.driver.close()
    } catch {
      // A close that fails during teardown is noise, not news — and there is
      // nothing left to do about it either way.
    }
  }

  return {
    isOpen: () => held !== null,
    dispose,

    async probe(uri, database) {
      // Config change: a driver made for a different address is the wrong
      // driver, and keeping it would silently test the previous endpoint.
      if (held && held.uri !== uri) await dispose()

      let session: Neo4jSessionLike | null = null
      try {
        if (!held) held = { uri, driver: factory(uri) }
        session = held.driver.session({ database })
        const result = await session.run(PROBE_QUERY)
        const record = result.records[0]
        if (!record) {
          return {
            ok: false,
            reason: 'The database answered, but returned no result to the test query.'
          }
        }
        const value = toNumber(record.get(PROBE_KEY))
        if (value !== 1) {
          return {
            ok: false,
            reason: 'The database answered the test query with an unexpected result.'
          }
        }
        return { ok: true, value }
      } catch (err) {
        // ⚠ A FAILED PROBE DROPS THE DRIVER. A pool that could not answer is
        // not a pool worth keeping warm, and holding it would make the next
        // click reuse a connection to something that just failed.
        await dispose()
        // ⚠ THE ERROR IS CLASSIFIED, NEVER FORWARDED. A driver error carries
        // the URI in its message on several paths, and a Neo4j error code
        // (`Neo.ClientError.Security.Unauthorized`) is not a sentence a user
        // can act on.
        return { ok: false, reason: classify(err) }
      } finally {
        try {
          await session?.close()
        } catch {
          // The probe's answer is already decided.
        }
      }
    }
  }
}

/**
 * Map a driver failure onto one of a fixed set of sentences — the
 * `vaultCore.failureMessage` discipline, where the vocabulary is closed and
 * nothing from the failure itself reaches the string.
 *
 * ⚠ NOTHING HERE INTERPOLATES `err`. Not its message, not its `cause`, not the
 * URI. What the code IS gets logged for a developer (without the URI, the host
 * or the message); what the user sees is a sentence they can act on.
 */
function classify(err: unknown): string {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code: unknown }).code)
      : ''

  // The code alone is what distinguishes these cases, and it is the one part
  // that cannot carry a credential.
  logger.warn(`[memory] bolt probe failed (${code || 'no code'})`)

  if (code.includes('Unauthorized') || code.includes('Security')) {
    return 'The database refused the connection because it wants a username and password. This release can only use a Neo4j with authentication disabled.'
  }
  if (code.includes('ServiceUnavailable') || code.includes('ECONNREFUSED')) {
    return 'Nothing answered at that address. Check that the Neo4j is running and that the port is right.'
  }
  if (code.includes('SessionExpired') || code.includes('ETIMEDOUT') || code.includes('Timeout')) {
    return 'The database did not answer in time. Check the address and that the Neo4j is running.'
  }
  if (code.includes('DatabaseNotFound') || code.includes('DatabaseUnavailable')) {
    return 'The database is running but has no database by that name.'
  }
  return 'Chorus could not reach a Neo4j at that address.'
}
