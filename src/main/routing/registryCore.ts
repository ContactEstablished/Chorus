import {
  modelRegistryFileSchema,
  type ModelRegistry,
  type ModelRegistryEntry,
  type VerificationRecord
} from '../../shared/routing'
import registryJson from './model-registry.json'

/**
 * Model Routing Task 1-1: the bundled model registry and verification-record
 * activity (MR-D7). Pure: no clock, no file system; the registry ships as a
 * JSON module import. `now` is a parameter that must be a UTC ISO instant
 * ending in `Z` (a string without an offset is read as local time by
 * `Date.parse`; the entry-point check for that lands in Task 1-3's
 * `computeTiers`). An unparseable `now` throws `RangeError`.
 */

/** `<path>: <message>` for the first Zod issue; the root path prints as `(root)`. */
function issueText(issue: { readonly path: readonly PropertyKey[]; readonly message: string } | undefined): string {
  if (!issue) return '(root): invalid'
  const path = issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)'
  return `${path}: ${issue.message}`
}

/** Validates a registry file. Throws `Error('Invalid model registry: <path>: <message>')` on the first issue. */
export function parseModelRegistry(json: unknown): ModelRegistry {
  const parsed = modelRegistryFileSchema.safeParse(json)
  if (!parsed.success) throw new Error(`Invalid model registry: ${issueText(parsed.error.issues[0])}`)
  return parsed.data
}

/** The registry shipped with the app. Parsed on every call, so callers get a fresh value. */
export function bundledModelRegistry(): ModelRegistry {
  return parseModelRegistry(registryJson)
}

export function findModel(registry: ModelRegistry, slug: string): ModelRegistryEntry | null {
  return Object.hasOwn(registry.models, slug) ? registry.models[slug] : null
}

/**
 * Active when `verifiedAt <= now < expiresAt`. `now` must be a UTC ISO instant
 * ending in `Z`; an unparseable `now` throws `RangeError('Invalid time: now')`.
 */
export function isVerificationActive(record: VerificationRecord, now: string): boolean {
  const t = Date.parse(now)
  if (Number.isNaN(t)) throw new RangeError('Invalid time: now')
  return Date.parse(record.verifiedAt) <= t && t < Date.parse(record.expiresAt)
}

/**
 * The active record for exactly this model and this routable tag (never a
 * provider name or a tag prefix). The latest `verifiedAt` wins; ties keep
 * registry order. `null` when none is active.
 */
export function activeVerification(entry: ModelRegistryEntry, tag: string, now: string): VerificationRecord | null {
  let best: VerificationRecord | null = null
  for (const record of entry.verified) {
    if (record.model !== entry.slug || record.tag !== tag || !isVerificationActive(record, now)) continue
    if (best === null || Date.parse(record.verifiedAt) > Date.parse(best.verifiedAt)) best = record
  }
  return best
}
