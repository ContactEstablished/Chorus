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
export interface Neo4jRecordLike {
  get(key: string): unknown
  keys: ReadonlyArray<string | number>
}

export interface Neo4jSessionLike {
  run(query: string, params?: Record<string, unknown>): Promise<{ records: Neo4jRecordLike[] }>
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
/**
 * The narrow surface a caller gets INSIDE a session, so nothing outside this
 * file ever holds a driver or a session and no caller can leak one by forgetting
 * to close it. Rows come back as PLAIN objects with numbers already normalised —
 * see `toPlain`.
 */
export interface BoltRunner {
  run(cypher: string, params?: Record<string, unknown>): Promise<Array<Record<string, unknown>>>
}

export type SessionResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string }

export interface Neo4jClient {
  probe(uri: string, database: string): Promise<ProbeResult>
  /**
   * Run a unit of work against one session.
   *
   * ⚠ USER-INITIATED CALLERS ONLY (D58). This is a bigger door than `probe`, so
   * the rule is restated where the door is: `memory:seed` and `memory:validate`
   * are clicks. Nothing here may be reached from a boot hook, a timer, a restore
   * path or a retry.
   */
  withSession<T>(
    uri: string,
    database: string,
    fn: (runner: BoltRunner) => Promise<T>
  ): Promise<SessionResult<T>>
  /** Drop the cached driver, if any. Called on config change and at quit. */
  dispose(): Promise<void>
  /** For assertions: is a driver currently held? */
  isOpen(): boolean
}

/**
 * Neo4j hands back its own `Integer` type (and `bigint` under some configs), so
 * a record cannot be forwarded as-is: an `Integer` crossing IPC would fail
 * structured clone, and one reaching a template would render as `[object
 * Object]`. Normalised once, here, rather than at each call site.
 */
/**
 * Wrap a JS number as a Neo4j INTEGER for a parameter that must be one.
 *
 * ⚠ THIS EXISTS BECAUSE G2 CAUGHT A BUG THE UNIT TESTS COULD NOT. JavaScript has
 * one number type and the driver sends a plain `50` as a FLOAT, so
 * `LIMIT $limit` is refused with `Neo.ClientError.Statement.ArgumentError` —
 * "expected an integer". The pure test asserts the query STRING and passed
 * happily; the real server refused it. Any parameter used for `LIMIT`, `SKIP` or
 * a node property that must round-trip as an integer goes through here.
 */
export function asInt(n: number): unknown {
  return neo4j.int(n)
}

export function toPlainValue(v: unknown): unknown {
  if (typeof v === 'bigint') return Number(v)
  if (v !== null && typeof v === 'object' && 'toNumber' in v && typeof (v as { toNumber: unknown }).toNumber === 'function') {
    return (v as { toNumber(): number }).toNumber()
  }
  return v
}

function toPlain(record: Neo4jRecordLike): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of record.keys) {
    if (typeof k === 'string') out[k] = toPlainValue(record.get(k))
  }
  return out
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

  /** One driver per config, created lazily, replaced when the address changes. */
  function acquire(uri: string): Neo4jDriverLike {
    if (!held) held = { uri, driver: factory(uri) }
    return held.driver
  }

  return {
    isOpen: () => held !== null,
    dispose,

    async withSession(uri, database, fn) {
      if (held && held.uri !== uri) await dispose()
      let session: Neo4jSessionLike | null = null
      try {
        session = acquire(uri).session({ database })
        const runner: BoltRunner = {
          run: async (cypher, params) => {
            const result = await session!.run(cypher, params)
            return result.records.map(toPlain)
          }
        }
        return { ok: true, value: await fn(runner) }
      } catch (err) {
        // ⚠ SAME POSTURE AS `probe`: a pool that failed is dropped rather than
        // kept warm, and the error is CLASSIFIED, never forwarded — a driver
        // message carries the URI on several paths.
        await dispose()
        return { ok: false, reason: classify(err) }
      } finally {
        try {
          await session?.close()
        } catch {
          // The unit of work's answer is already decided.
        }
      }
    },

    async probe(uri, database) {
      // Config change: a driver made for a different address is the wrong
      // driver, and keeping it would silently test the previous endpoint.
      if (held && held.uri !== uri) await dispose()

      let session: Neo4jSessionLike | null = null
      try {
        session = acquire(uri).session({ database })
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
  // ⚠ A QUERY THE SERVER REFUSED IS NOT AN UNREACHABLE SERVER, AND SAYING SO
  // MATTERS. G2 hit `Neo.ClientError.Statement.ArgumentError` and the generic
  // fallback reported "could not reach a Neo4j at that address" — a confident,
  // wrong diagnosis that would have sent someone to check their port and their
  // container while the actual fault was in Chorus. A vague honest answer beats
  // a precise wrong one.
  if (code.includes('Statement.') || code.includes('Schema.')) {
    return 'The database rejected a query Chorus sent. The connection is fine; this is a fault in Chorus rather than in your Neo4j.'
  }
  return 'Chorus could not reach a Neo4j at that address.'
}
