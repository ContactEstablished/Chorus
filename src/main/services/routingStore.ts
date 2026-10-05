import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import type { AccountEligibility, CacheVerification, EndpointSnapshot, RoutingLaunchPreferences, RoutingObservation } from '../../shared/routing'
import {
  LAUNCH_PREFERENCES_CAP_BYTES,
  LAUNCH_PREFERENCES_FILE,
  emptyLaunchPreferences,
  launchPreferencesFileText,
  launchPreferencesWarning,
  parseLaunchPreferencesFile
} from '../routing/launchCore'
import { bundledModelRegistry } from '../routing/registryCore'
import {
  ROUTING_STORE_FILES,
  STORE_FILE_CAP_BYTES,
  accountFileName,
  accountFileText,
  cacheFileText,
  mergeCacheVerifications,
  mergeObservations,
  modelDirName,
  observationsFileText,
  parseAccountFile,
  parseCacheFile,
  parseObservationsFile,
  parseSnapshotFile,
  snapshotFileText,
  storeWarning,
  type StoreFileKind,
  type StoreParse
} from '../routing/storeCore'
import { logger } from './logger'

/**
 * Model Routing Task 2-2: the routing store's I/O half (MR-D20, K5) — JSON
 * files under `<userData>/routing/`, one directory per registry model:
 *
 *   <modelDirName(slug)>/snapshot.json                 latest snapshot only
 *                        observations.json             pruned, bounded history
 *                        cache.json                    cache verifications
 *                        account-<credentialId>.json   eligibility per credential
 *
 *   launch-preferences.json (at the root, no model directory): the remembered last tier
 *   choice per model (Task 4a-1, K8). Its parse and text live in routing/launchCore.ts.
 *
 * Every rule lives in the pure routing/storeCore.ts; this class only reads,
 * writes and warns. It never receives a key: the files hold public endpoint
 * metadata and Chorus-owned records, nothing else.
 *
 * ⚠ READS NEVER THROW FOR A FILE PROBLEM, AND NEVER DELETE, RENAME OR REWRITE
 * (C12). A missing file is empty with no warning; a corrupt, oversized,
 * unreadable or mismatched file is empty with ONE warning per path per store
 * instance. The next successful write replaces it, and clears the warning so a
 * later corruption warns again. The snapshot, cache and account files are
 * re-fetchable, so a corrupt copy is not worth keeping. The observation
 * history is NOT re-fetchable (it is built up tick by tick over 7 days): an
 * append over a corrupt file starts it again from empty, which is why the
 * write below must never leave a corrupt file behind. (One exception, 0.9.1:
 * `readLaunchPreferencesForUpdate` answers `null`, not empty, for an UNREADABLE
 * launch preferences file, so its read-modify-write caller writes nothing.)
 *
 * ⚠ WRITES ARE ATOMIC AND DURABLE: a pid-suffixed temp file, written and
 * fsync'd, then a rename over the target (the mcpConfigWrite.ts shape plus the
 * fsync), so a crash leaves the old file or the new one, never half of either.
 * Without the fsync, a power loss can commit the rename before the data (NTFS
 * journals metadata, not contents) and leave a zero-filled target that reads
 * as corrupt. A failed write removes its temp file and throws a FIXED message;
 * the original error is not attached (it can carry a path).
 *
 * Registry models only: an unknown slug is refused before the disk is touched.
 * The launch preferences file belongs to no model, so which slugs it holds is
 * the service's rule (RoutingService.recordLaunchChoice, C7).
 * Single-writer-per-model is the caller's job (RoutingService, Task 2-3); the
 * store adds no locks.
 */

export interface RoutingStoreDeps {
  /** Default: `logger.warn('[routing] <message>')`. Receives fixed text only (storeCore.storeWarning, launchCore.launchPreferencesWarning). */
  warn?: (message: string) => void
}

function isMissing(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'ENOENT'
}

/** The fixed message a failed per-model write throws (no path, no cause). */
function writeFailure(kind: StoreFileKind, model: string): string {
  return `routing store: could not write the ${kind} file for ${model}`
}

export class RoutingStore {
  private readonly slugs: ReadonlySet<string>
  private readonly warn: (message: string) => void
  /** Absolute paths already warned about by this instance; a successful write removes its path. */
  private readonly warned = new Set<string>()

  constructor(
    private readonly rootDir: string,
    deps: RoutingStoreDeps = {}
  ) {
    this.slugs = new Set(Object.keys(bundledModelRegistry().models))
    this.warn = deps.warn ?? ((message) => logger.warn(`[routing] ${message}`))
  }

  readSnapshot(model: string): EndpointSnapshot | null {
    const path = join(this.modelDir(model), ROUTING_STORE_FILES.snapshot)
    return this.load('snapshot', model, path, (t) => parseSnapshotFile(t, model))
  }

  writeSnapshot(model: string, snapshot: EndpointSnapshot): void {
    const path = join(this.modelDir(model), ROUTING_STORE_FILES.snapshot)
    this.save(path, () => snapshotFileText(model, snapshot), writeFailure('snapshot', model))
  }

  readObservations(model: string): RoutingObservation[] {
    const path = join(this.modelDir(model), ROUTING_STORE_FILES.observations)
    return this.load('observations', model, path, (t) => parseObservationsFile(t, model)) ?? []
  }

  /** Read (empty on any problem), merge with retention relative to `now`, write, and return the merged list. */
  appendObservations(
    model: string,
    added: readonly RoutingObservation[],
    now: string,
    maxAgeDays: number
  ): RoutingObservation[] {
    const path = join(this.modelDir(model), ROUTING_STORE_FILES.observations)
    const merged = mergeObservations(this.readObservations(model), added, now, maxAgeDays)
    this.save(path, () => observationsFileText(model, merged), writeFailure('observations', model))
    return merged
  }

  readCache(model: string): CacheVerification {
    const path = join(this.modelDir(model), ROUTING_STORE_FILES.cache)
    return this.load('cache', model, path, (t) => parseCacheFile(t, model)) ?? {}
  }

  /** Read (empty on any problem), replace each added tag's record, write, and return the merged record. */
  mergeCache(model: string, added: CacheVerification): CacheVerification {
    const path = join(this.modelDir(model), ROUTING_STORE_FILES.cache)
    const merged = mergeCacheVerifications(this.readCache(model), added)
    this.save(path, () => cacheFileText(model, merged), writeFailure('cache', model))
    return merged
  }

  readAccount(model: string, credentialProfileId: string): AccountEligibility | null {
    const path = join(this.modelDir(model), accountFileName(credentialProfileId))
    return this.load('account', model, path, (t) => parseAccountFile(t, model, credentialProfileId))
  }

  writeAccount(model: string, credentialProfileId: string, eligibility: AccountEligibility): void {
    const path = join(this.modelDir(model), accountFileName(credentialProfileId))
    this.save(path, () => accountFileText(model, credentialProfileId, eligibility), writeFailure('account', model))
  }

  /** K8: the remembered choice per model. Missing, corrupt or oversize reads as empty, with one warning per path. */
  readLaunchPreferences(): RoutingLaunchPreferences {
    return this.loadLaunchPreferences() ?? emptyLaunchPreferences()
  }

  /**
   * 0.9.1: the read for a read-modify-write. As readLaunchPreferences, except that a file which exists but could not
   * be READ (an I/O failure, possibly transient) is `null`, not empty: a caller rewriting the file from "empty" would
   * erase every other model's remembered choice. Missing, corrupt, schema-invalid and oversize stay empty, so the next
   * write replaces them exactly as before.
   */
  readLaunchPreferencesForUpdate(): RoutingLaunchPreferences | null {
    return this.loadLaunchPreferences()
  }

  /** The preferences, or `null` for an unreadable file (warned once either way). */
  private loadLaunchPreferences(): RoutingLaunchPreferences | null {
    const path = join(this.rootDir, LAUNCH_PREFERENCES_FILE)
    const read = this.readText(path, LAUNCH_PREFERENCES_CAP_BYTES, launchPreferencesWarning)
    if (read.warning !== null) {
      this.warnOnce(path, read.warning)
      return read.unreadable ? null : emptyLaunchPreferences()
    }
    const parsed = parseLaunchPreferencesFile(read.text)
    if (parsed.warning !== null) this.warnOnce(path, parsed.warning)
    return parsed.value
  }

  writeLaunchPreferences(prefs: RoutingLaunchPreferences): void {
    this.save(join(this.rootDir, LAUNCH_PREFERENCES_FILE), () => launchPreferencesFileText(prefs), 'routing store: could not write the launch preferences file')
  }

  /** `<root>/<modelDirName(model)>`. Throws for a model outside the bundled registry, before any other check. */
  private modelDir(model: string): string {
    if (!this.slugs.has(model)) throw new Error('routing store: unknown model')
    return join(this.rootDir, modelDirName(model))
  }

  private warnOnce(path: string, message: string): void {
    const key = resolve(path)
    if (this.warned.has(key)) return
    this.warned.add(key)
    this.warn(message)
  }

  /**
   * The file's text, `null` when it is missing, or a fixed warning (from `warning`). Never throws. `unreadable` is
   * true for the `read` problem only — an I/O failure, as opposed to a file that was read and is too big.
   */
  private readText(
    path: string,
    cap: number,
    warning: (problem: 'size' | 'read') => string
  ): { text: string | null; warning: string | null; unreadable: boolean } {
    let size: number
    try {
      size = statSync(path).size
    } catch (err) {
      return isMissing(err) ? { text: null, warning: null, unreadable: false } : { text: null, warning: warning('read'), unreadable: true }
    }
    if (size > cap) return { text: null, warning: warning('size'), unreadable: false }
    try {
      return { text: readFileSync(path, 'utf8'), warning: null, unreadable: false }
    } catch (err) {
      // Removed between the stat and the read: missing, not a problem.
      return isMissing(err) ? { text: null, warning: null, unreadable: false } : { text: null, warning: warning('read'), unreadable: true }
    }
  }

  private load<T>(kind: StoreFileKind, model: string, path: string, parse: (text: string | null) => StoreParse<T>): T | null {
    const read = this.readText(path, STORE_FILE_CAP_BYTES, (problem) => storeWarning(kind, model, problem))
    if (read.warning !== null) {
      this.warnOnce(path, read.warning)
      return null
    }
    const parsed = parse(read.text)
    if (parsed.warning !== null) this.warnOnce(path, parsed.warning)
    return parsed.value
  }

  /**
   * Validate (the `*FileText` builder throws on a value the reader would
   * refuse), then write the temp file, fsync it, close it, and rename it over
   * the target. Any failure removes the temp file and throws the fixed `failure` message.
   */
  private save(target: string, text: () => string, failure: string): void {
    const temp = `${target}.${process.pid}.tmp`
    try {
      const bytes = Buffer.from(text(), 'utf8')
      mkdirSync(dirname(target), { recursive: true })
      const fd = openSync(temp, 'w')
      try {
        let offset = 0
        while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset)
        // The data reaches the disk BEFORE the rename can (see the header).
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
      renameSync(temp, target)
    } catch {
      try {
        rmSync(temp, { force: true })
      } catch {
        /* best-effort: the reported failure is the write's, not the cleanup's */
      }
      throw new Error(failure)
    }
    this.warned.delete(resolve(target))
  }
}
