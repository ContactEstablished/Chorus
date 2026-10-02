import { z } from 'zod'

import {
  DEFAULT_ROUTING_OBSERVATION_SETTINGS,
  DEFAULT_ROUTING_SETTINGS,
  ROUTING_STORE_VERSION,
  credentialProfileIdSchema,
  routingAccountFileSchema,
  routingCacheFileSchema,
  routingObservationSettingsSchema,
  routingObservationsFileSchema,
  routingSettingsSchema,
  routingSnapshotFileSchema,
  type AccountEligibility,
  type CacheVerification,
  type EndpointSnapshot,
  type RoutingObservation,
  type RoutingObservationSettings,
  type RoutingSettings
} from '../../shared/routing'
import { byCodeUnit } from './endpointsCore'

/**
 * Model Routing Task 2-2: the pure half of the routing store (MR-D20, K5, K6)
 * — directory and file names, file parsing and serialising, the observation
 * merge with its retention, the cache merge, and the two settings parsers.
 *
 * Pure: no clock, no randomness, no file system. `now` and every file's text
 * are parameters, so the I/O half (services/routingStore.ts) and the settings
 * methods in storage.ts are thin, and all of the rules are testable here.
 *
 * ⚠ WARNINGS NEVER QUOTE. A warning names the file kind, the model slug and a
 * fixed problem word; never file content, a path or an exception message.
 */

export const ROUTING_STORE_FILES = { snapshot: 'snapshot.json', observations: 'observations.json', cache: 'cache.json' } as const
export const OBSERVATIONS_MAX_PER_TAG = 400 // C13: 7 days × 48 ticks = 336, plus refresh headroom
export const CACHE_RECORDS_MAX = 500
export const STORE_FILE_CAP_BYTES = 16_000_000
export const MODEL_DIR_MAX_LENGTH = 120

const DAY_MS = 86_400_000
const isoInstant = z.iso.datetime()

// ── Names (C14) ──

/** True for a lone (unpaired) UTF-16 surrogate, which has no UTF-8 encoding. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

function hexByte(byte: number): string {
  return `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
}

/**
 * The directory name for a model slug (C14). Each UTF-8 byte that is `a`–`z`,
 * `0`–`9` or `-` is kept; a `.` is kept unless it is the first or last byte;
 * every other byte, `%` included, becomes `%XX` (upper-case hex). Injective,
 * because every encoded byte starts with `%` and `%` itself is always encoded.
 *
 * Throws `Error('routing store: unusable model slug')` for an empty slug or a
 * result longer than `MODEL_DIR_MAX_LENGTH`; also for a slug with a lone
 * surrogate, which has no UTF-8 encoding (the encoder would map every one to
 * U+FFFD, and the mapping would stop being injective).
 */
export function modelDirName(slug: string): string {
  if (slug.length === 0 || LONE_SURROGATE.test(slug)) throw new Error('routing store: unusable model slug')
  const bytes = new TextEncoder().encode(slug)
  const last = bytes.length - 1
  let out = ''
  bytes.forEach((byte, index) => {
    const ch = String.fromCharCode(byte)
    const plain = (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch === '-'
    const innerDot = ch === '.' && index !== 0 && index !== last
    out += plain || innerDot ? ch : hexByte(byte)
  })
  if (out.length > MODEL_DIR_MAX_LENGTH) throw new Error('routing store: unusable model slug')
  return out
}

/** `account-<id>.json`. Throws unless the id is a UUID (credential ids are randomUUID(), vault.ts:144). */
export function accountFileName(credentialProfileId: string): string {
  if (!credentialProfileIdSchema.safeParse(credentialProfileId).success) {
    throw new Error('routing store: unusable credential profile id')
  }
  return `account-${credentialProfileId}.json`
}

// ── Files: parse ──

export type StoreFileKind = 'snapshot' | 'observations' | 'cache' | 'account'
export interface StoreParse<T> { value: T | null; warning: string | null } // value null = read as empty

const WARNING_TEXT: Record<'json' | 'schema' | 'size' | 'read', string> = {
  json: 'is not valid JSON',
  schema: 'does not match its schema',
  size: `exceeds ${STORE_FILE_CAP_BYTES} bytes`,
  read: 'could not be read'
}

/** `<kind> file for <model> <problem text>; reading it as empty`. Never content, a path or an exception message. */
export function storeWarning(kind: StoreFileKind, model: string, problem: 'json' | 'schema' | 'size' | 'read'): string {
  return `${kind} file for ${model} ${WARNING_TEXT[problem]}; reading it as empty`
}

/**
 * The shared read rule: missing → empty with no warning; not JSON → `json`;
 * rejected by the schema, or naming another model (or credential) → `schema`.
 */
function parseFile<F extends { model: string }, T>(
  kind: StoreFileKind,
  text: string | null,
  model: string,
  schema: z.ZodType<F>,
  project: (file: F) => T | null
): StoreParse<T> {
  if (text === null) return { value: null, warning: null }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { value: null, warning: storeWarning(kind, model, 'json') }
  }
  const parsed = schema.safeParse(json)
  const value = parsed.success && parsed.data.model === model ? project(parsed.data) : null
  return value === null ? { value: null, warning: storeWarning(kind, model, 'schema') } : { value, warning: null }
}

export function parseSnapshotFile(text: string | null, model: string): StoreParse<EndpointSnapshot> {
  return parseFile('snapshot', text, model, routingSnapshotFileSchema, (f) => ({ fetchedAt: f.fetchedAt, endpoints: f.endpoints }))
}

export function parseObservationsFile(text: string | null, model: string): StoreParse<RoutingObservation[]> {
  return parseFile('observations', text, model, routingObservationsFileSchema, (f) => f.observations)
}

export function parseCacheFile(text: string | null, model: string): StoreParse<CacheVerification> {
  return parseFile('cache', text, model, routingCacheFileSchema, (f) => f.verifications)
}

export function parseAccountFile(text: string | null, model: string, credentialProfileId: string): StoreParse<AccountEligibility> {
  return parseFile('account', text, model, routingAccountFileSchema, (f) =>
    f.credentialProfileId === credentialProfileId ? f.eligibility : null
  )
}

// ── Files: serialise ──
// Each envelope is parsed with its own schema before it is stringified, so the
// store can never write a file it would refuse to read (throws on a bad value).

export function snapshotFileText(model: string, snapshot: EndpointSnapshot): string {
  return JSON.stringify(
    routingSnapshotFileSchema.parse({
      version: ROUTING_STORE_VERSION,
      model,
      fetchedAt: snapshot.fetchedAt,
      endpoints: snapshot.endpoints
    })
  )
}

export function observationsFileText(model: string, observations: readonly RoutingObservation[]): string {
  return JSON.stringify(routingObservationsFileSchema.parse({ version: ROUTING_STORE_VERSION, model, observations }))
}

export function cacheFileText(model: string, verifications: CacheVerification): string {
  return JSON.stringify(routingCacheFileSchema.parse({ version: ROUTING_STORE_VERSION, model, verifications }))
}

export function accountFileText(model: string, credentialProfileId: string, eligibility: AccountEligibility): string {
  return JSON.stringify(
    routingAccountFileSchema.parse({ version: ROUTING_STORE_VERSION, model, credentialProfileId, eligibility })
  )
}

// ── Merges ──

/**
 * Observation history with retention (K5, C13). Relative to the `now` passed
 * in, never a clock:
 *  1. `now` must be an ISO instant, else `RangeError('Invalid time: now')`;
 *     `maxAgeDays` must be finite and > 0 and `maxPerTag` a positive integer,
 *     else `RangeError('Invalid retention: maxAgeDays' | '… maxPerTag')`.
 *  2. `existing` then `added`, deduplicated on (tag, instant) — the later entry
 *     wins, so `added` replaces, and `…:00Z` equals `…:00.000Z`.
 *  3. Older than `maxAgeDays` before `now` is dropped; exactly `maxAgeDays` old
 *     is kept, and so is anything after `now`.
 *  4. The newest `maxPerTag` per tag survive.
 *  5. Sorted by instant ascending, then tag (code units). Inputs are not mutated.
 */
export function mergeObservations(
  existing: readonly RoutingObservation[],
  added: readonly RoutingObservation[],
  now: string,
  maxAgeDays: number,
  maxPerTag: number = OBSERVATIONS_MAX_PER_TAG
): RoutingObservation[] {
  if (!isoInstant.safeParse(now).success) throw new RangeError('Invalid time: now')
  // A NaN or non-positive limit would silently keep everything or drop everything.
  if (!Number.isFinite(maxAgeDays) || maxAgeDays <= 0) throw new RangeError('Invalid retention: maxAgeDays')
  if (!Number.isInteger(maxPerTag) || maxPerTag <= 0) throw new RangeError('Invalid retention: maxPerTag')
  const cutoffMs = Date.parse(now) - maxAgeDays * DAY_MS

  const unique = new Map<string, RoutingObservation>()
  for (const o of [...existing, ...added]) unique.set(`${o.tag}|${Date.parse(o.observedAt)}`, o)

  const byTag = new Map<string, RoutingObservation[]>()
  for (const o of unique.values()) {
    if (Date.parse(o.observedAt) < cutoffMs) continue
    const group = byTag.get(o.tag)
    if (group) group.push(o)
    else byTag.set(o.tag, [o])
  }

  const kept: RoutingObservation[] = []
  for (const group of byTag.values()) {
    group.sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))
    kept.push(...group.slice(0, maxPerTag))
  }
  return kept
    .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt) || byCodeUnit(a.tag, b.tag))
    .map((o) => ({ ...o }))
}

/**
 * Each tag in `added` replaces its record in `existing`. Above
 * `CACHE_RECORDS_MAX`, the newest by `checkedAt` survive (ties by tag). A
 * fresh plain object with keys in code-unit order.
 */
export function mergeCacheVerifications(existing: CacheVerification, added: CacheVerification): CacheVerification {
  const merged = new Map<string, CacheVerification[string]>()
  for (const [tag, record] of Object.entries(existing)) merged.set(tag, record)
  for (const [tag, record] of Object.entries(added)) merged.set(tag, record)

  let entries = [...merged.entries()]
  if (entries.length > CACHE_RECORDS_MAX) {
    entries = entries
      .sort(([tagA, a], [tagB, b]) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt) || byCodeUnit(tagA, tagB))
      .slice(0, CACHE_RECORDS_MAX)
  }
  return Object.fromEntries(
    entries
      .sort(([tagA], [tagB]) => byCodeUnit(tagA, tagB))
      .map(([tag, record]) => [tag, { verified: record.verified, checkedAt: record.checkedAt }])
  )
}

// ── Settings values (K6, the voice pattern at storage.ts readVoiceSettings) ──

export interface ParsedSetting<T> { value: T; warning: string | null }

/**
 * One JSON value from the `settings` table. Defaults UNDERNEATH the stored
 * object, so a row written before a field existed still reads; a row that is
 * not JSON, not an object, or does not validate reads as the defaults with a
 * warning. Every value is a fresh object from the schema's `parse`, so
 * mutating it can never change the defaults.
 */
function parseSettingValue<T extends object>(
  raw: string | null,
  schema: z.ZodType<T>,
  defaults: T,
  subject: string
): ParsedSetting<T> {
  const fallback = (warning: string | null): ParsedSetting<T> => ({ value: schema.parse(defaults), warning })
  if (raw === null) return fallback(null)
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return fallback(`${subject} were not JSON; using defaults`)
  }
  const invalid = `${subject} did not validate; using defaults`
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return fallback(invalid)
  const parsed = schema.safeParse({ ...defaults, ...json })
  return parsed.success ? { value: parsed.data, warning: null } : fallback(invalid)
}

export function parseRoutingSettingsValue(raw: string | null): ParsedSetting<RoutingSettings> {
  return parseSettingValue(raw, routingSettingsSchema, DEFAULT_ROUTING_SETTINGS, 'stored routing settings')
}

export function parseRoutingObservationValue(raw: string | null): ParsedSetting<RoutingObservationSettings> {
  return parseSettingValue(
    raw,
    routingObservationSettingsSchema,
    DEFAULT_ROUTING_OBSERVATION_SETTINGS,
    'stored routing observation setting'
  )
}
