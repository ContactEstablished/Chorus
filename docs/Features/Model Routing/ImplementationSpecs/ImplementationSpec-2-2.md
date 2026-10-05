# Implementation specification 2-2 — Routing store and settings

Paired [task](../Tasks/Task-2-2.md). Decisions: [roadmap](../roadmap.md) MR-D9, MR-D10; user decisions MR-D19, MR-D20; [overview](../Tasks/Phase-2-Overview.md) K1, K5, K6 and clarifications C11–C14. Phase 1 contracts from [ImplementationSpec-1-1](ImplementationSpec-1-1.md). **Not started.**

## Files and insertion points

Verified 2026-10-02 at `a9842a5`.

| File | Action |
|---|---|
| `src/shared/routing.ts` | Append the "Phase 2 — store and settings" block below, after Task 2-1's block. Nothing above it changes. |
| `src/shared/routing.test.ts` | Append `describe('Table S3 — store and settings schemas')`. |
| `src/main/routing/storeCore.ts`, `storeCore.test.ts` | New. Pure. Table C. |
| `src/main/services/routingStore.ts`, `routingStore.test.ts` | New. File I/O. Table F. |
| `src/main/services/storage.ts` | Two keys after `APPEARANCE_SETTINGS_KEY` (:1103); two imports beside the other shared imports (:29–31); a "Routing settings" section with four methods after `writeAppearanceSettings` (:3911–3918). Nothing else changes; no migration (MR-D20). |

`storeCore.ts` imports only `zod`, `../../shared/routing` and `./endpointsCore` (`byCodeUnit`). `routingStore.ts` imports `node:fs`, `node:path`, `./logger`, `../routing/storeCore`, `../routing/registryCore` and shared contracts; it never imports `storage.ts` or `electron`, so its test runs under plain vitest.

## Normative contracts — `src/shared/routing.ts` (appended block)

```ts
// ── Phase 2 — store and settings (Task 2-2) ──

export const ROUTING_STORE_VERSION = 1

/** Credential profile ids are randomUUID() (vault.ts:144); shared/ipc.ts already validates them with z.uuid(). */
export const credentialProfileIdSchema = z.uuid()

/** MR-D19: background observation consent and the designated credential. */
export const routingObservationSettingsSchema = z.strictObject({
  enabled: z.boolean(),
  credentialProfileId: credentialProfileIdSchema.nullable()
})
export type RoutingObservationSettings = z.infer<typeof routingObservationSettingsSchema>
export const DEFAULT_ROUTING_OBSERVATION_SETTINGS: RoutingObservationSettings = { enabled: true, credentialProfileId: null }

// MR-D20 store files. Strict envelopes; the snapshot's rows reuse the non-strict rawEndpointSchema.
export const routingSnapshotFileSchema = z.strictObject({
  version: z.literal(1),
  model: z.string().min(1),
  fetchedAt: isoTime,
  endpoints: z.array(rawEndpointSchema).min(1)
})
export const routingObservationsFileSchema = z.strictObject({
  version: z.literal(1),
  model: z.string().min(1),
  observations: z.array(routingObservationSchema)
})
export const routingCacheFileSchema = z.strictObject({
  version: z.literal(1),
  model: z.string().min(1),
  verifications: cacheVerificationSchema
})
export const routingAccountFileSchema = z.strictObject({
  version: z.literal(1),
  model: z.string().min(1),
  credentialProfileId: credentialProfileIdSchema,
  eligibility: accountEligibilitySchema
})
export type RoutingSnapshotFile = z.infer<typeof routingSnapshotFileSchema>
export type RoutingObservationsFile = z.infer<typeof routingObservationsFileSchema>
export type RoutingCacheFile = z.infer<typeof routingCacheFileSchema>
export type RoutingAccountFile = z.infer<typeof routingAccountFileSchema>
```

`isoTime` is the module-private `z.iso.datetime()` at :29; the block reuses it.

## Store layout (K5)

```text
<userData>/routing/
  <modelDirName(slug)>/              one per registry model, e.g. deepseek%2Fdeepseek-v4.1-flash
    snapshot.json                    { version: 1, model, fetchedAt, endpoints }       latest only
    observations.json                { version: 1, model, observations }               pruned, bounded
    cache.json                       { version: 1, model, verifications }              CacheVerification
    account-<credentialProfileId>.json  { version: 1, model, credentialProfileId, eligibility }
```

`endpoints` are the validated rows from `parseEndpointsResponse` (unknown keys already stripped), never the raw response body. No file holds a key, a fingerprint, a label, a prompt or a provider error text.

## `storeCore.ts`

```ts
export const ROUTING_STORE_FILES = { snapshot: 'snapshot.json', observations: 'observations.json', cache: 'cache.json' } as const
export const OBSERVATIONS_MAX_PER_TAG = 400 // C13: 7 days × 48 ticks = 336, plus refresh headroom
export const CACHE_RECORDS_MAX = 500
export const STORE_FILE_CAP_BYTES = 16_000_000
export const MODEL_DIR_MAX_LENGTH = 120

export function modelDirName(slug: string): string // throws Error on an empty slug or an over-long result
export function accountFileName(credentialProfileId: string): string // `account-${id}.json`; throws unless z.uuid() accepts the id

export type StoreFileKind = 'snapshot' | 'observations' | 'cache' | 'account'
export interface StoreParse<T> { value: T | null; warning: string | null } // value null = read as empty
export function parseSnapshotFile(text: string | null, model: string): StoreParse<EndpointSnapshot>
export function parseObservationsFile(text: string | null, model: string): StoreParse<RoutingObservation[]>
export function parseCacheFile(text: string | null, model: string): StoreParse<CacheVerification>
export function parseAccountFile(text: string | null, model: string, credentialProfileId: string): StoreParse<AccountEligibility>
export function storeWarning(kind: StoreFileKind, model: string, problem: 'json' | 'schema' | 'size' | 'read'): string

export function snapshotFileText(model: string, snapshot: EndpointSnapshot): string
export function observationsFileText(model: string, observations: readonly RoutingObservation[]): string
export function cacheFileText(model: string, verifications: CacheVerification): string
export function accountFileText(model: string, credentialProfileId: string, eligibility: AccountEligibility): string

export function mergeObservations(
  existing: readonly RoutingObservation[], added: readonly RoutingObservation[], now: string, maxAgeDays: number, maxPerTag?: number
): RoutingObservation[]
export function mergeCacheVerifications(existing: CacheVerification, added: CacheVerification): CacheVerification

export interface ParsedSetting<T> { value: T; warning: string | null }
export function parseRoutingSettingsValue(raw: string | null): ParsedSetting<RoutingSettings>
export function parseRoutingObservationValue(raw: string | null): ParsedSetting<RoutingObservationSettings>
```

**`modelDirName` (C14).** Encode the slug as UTF-8. A byte that is `a`–`z`, `0`–`9` or `-` is kept. A `.` is kept unless it is the first or last byte. Every other byte, `%` included, becomes `%` plus two upper-case hex digits. An empty slug, or a result longer than `MODEL_DIR_MAX_LENGTH`, throws `Error('routing store: unusable model slug')`. The mapping is injective because every encoded byte starts with `%` and `%` itself is always encoded. The store calls it only for registry slugs.

**Parsing a file.** `text === null` (missing file) → `{ value: null, warning: null }`. `JSON.parse` throws → `{ value: null, warning: storeWarning(kind, model, 'json') }`. The schema rejects it, or its `model` differs from the requested slug, or (account) its `credentialProfileId` differs from the requested id → `{ value: null, warning: storeWarning(kind, model, 'schema') }`. Otherwise the value: `{ fetchedAt, endpoints }` for a snapshot, the arrays and records as stored for the others.

**Warnings (exact).** `storeWarning(kind, model, problem)` returns `` `${kind} file for ${model} ${text}; reading it as empty` `` with `text` = `is not valid JSON` (`json`), `does not match its schema` (`schema`), `exceeds ${STORE_FILE_CAP_BYTES} bytes` (`size`) or `could not be read` (`read`). A warning never contains file content, a path or an exception message.

**Serialising.** Each `*FileText` builds the envelope `{ version: 1, model, … }`, parses it with its schema (throwing on an invalid value, so the store can never write what it would refuse to read), and returns `JSON.stringify(parsed)` (compact, no trailing newline).

**`mergeObservations` (K5, C13).**

1. `nowMs = Date.parse(now)` after `z.iso.datetime()` accepts it; otherwise throw `RangeError('Invalid time: now')`.
2. Concatenate `existing` then `added`. Deduplicate on `` `${tag}|${Date.parse(observedAt)}` ``, keeping the later entry (so `added` wins, and `…09:05:00Z` equals `…09:05:00.000Z`).
3. Drop every observation with `Date.parse(observedAt) < nowMs − maxAgeDays × 86_400_000`. Exactly `maxAgeDays` old is kept. Observations after `now` are kept.
4. Per tag, keep the newest `maxPerTag` (default `OBSERVATIONS_MAX_PER_TAG`) by `observedAt`.
5. Sort by `Date.parse(observedAt)` ascending, then tag with `byCodeUnit`. Inputs are not mutated.

**`mergeCacheVerifications`.** Start from `existing`; each tag in `added` replaces its record. If more than `CACHE_RECORDS_MAX` remain, keep the newest by `checkedAt` (ties by tag). Return a plain object built with `Object.fromEntries`, keys sorted with `byCodeUnit`.

**Settings values (K6, the voice pattern at `storage.ts:3856`).** `parseRoutingSettingsValue(raw)`:

| `raw` | Result |
|---|---|
| `null` (no row) | `{ value: routingSettingsSchema.parse(DEFAULT_ROUTING_SETTINGS), warning: null }` |
| `JSON.parse` throws | defaults, warning `stored routing settings were not JSON; using defaults` |
| Parses to `null`, an array or a primitive | defaults, warning `stored routing settings did not validate; using defaults` |
| Object `o`: `routingSettingsSchema.safeParse({ ...DEFAULT_ROUTING_SETTINGS, ...o })` fails | defaults, the same "did not validate" warning |
| Otherwise | `{ value: parsed.data, warning: null }` (defaults underneath, so a row written before a field existed still reads) |

`parseRoutingObservationValue(raw)` is identical with `routingObservationSettingsSchema`, `DEFAULT_ROUTING_OBSERVATION_SETTINGS` and the words `stored routing observation setting` in place of `stored routing settings`. Every returned value is a fresh object produced by the schema's `parse`, so mutating it never changes the defaults.

## `routingStore.ts`

```ts
export interface RoutingStoreDeps { warn?: (message: string) => void } // default: (m) => logger.warn(`[routing] ${m}`)
export class RoutingStore {
  constructor(rootDir: string, deps?: RoutingStoreDeps)
  readSnapshot(model: string): EndpointSnapshot | null
  writeSnapshot(model: string, snapshot: EndpointSnapshot): void
  readObservations(model: string): RoutingObservation[]
  appendObservations(model: string, added: readonly RoutingObservation[], now: string, maxAgeDays: number): RoutingObservation[]
  readCache(model: string): CacheVerification
  mergeCache(model: string, added: CacheVerification): CacheVerification
  readAccount(model: string, credentialProfileId: string): AccountEligibility | null
  writeAccount(model: string, credentialProfileId: string, eligibility: AccountEligibility): void
}
```

**Rules.**

- **Registry models only.** The constructor records the slugs of `bundledModelRegistry()`. Every method first checks the slug is one of them, else throws `Error('routing store: unknown model')` before touching the disk.
- **Paths.** `join(rootDir, modelDirName(model), name)`; nothing is written outside `rootDir`.
- **Reads.** `statSync`; `ENOENT` → empty, no warning. Size above `STORE_FILE_CAP_BYTES` → empty plus a `size` warning, without reading. `readFileSync(path, 'utf8')`; any other error → empty plus a `read` warning. Otherwise parse with `storeCore`. Empty means `null` (snapshot, account), `[]` (observations) or `{}` (cache). A read never throws for file problems and never deletes, renames or rewrites a file (C12).
- **One warning per file.** Warnings go through `deps.warn`, at most once per absolute path per store instance (a `Set`). A successful write to that path clears it, so a later corruption warns again.
- **Writes (atomic).** `mkdirSync(dir, { recursive: true })`; text from the `*FileText` function; ``temp = `${target}.${process.pid}.tmp` ``; `writeFileSync(temp, text, 'utf8')`; `renameSync(temp, target)` (the `mcpConfigWrite.ts:79` shape). On any error, `rmSync(temp, { force: true })` best-effort, then throw ``Error(`routing store: could not write the ${kind} file for ${model}`)``; the original error is not attached (it can carry a path, not a key, but the message stays fixed). A write replaces an invalid file (C12).
- **`appendObservations`** reads (empty on any problem), merges with `mergeObservations(existing, added, now, maxAgeDays)`, writes, and returns the merged list. **`mergeCache`** reads, merges with `mergeCacheVerifications`, writes, returns.
- Single-writer-per-model is the service's job (Task 2-3); the store adds no locks.

## `storage.ts` additions

```ts
// beside VOICE_SETTINGS_KEY (:1101) and APPEARANCE_SETTINGS_KEY (:1103)
/** Model Routing (MR-D20): the whole `RoutingSettings` object, as one JSON value. */
const ROUTING_SETTINGS_KEY = 'routing_settings'
/** Model Routing (MR-D19): `{ enabled, credentialProfileId }`, as one JSON value. */
const ROUTING_OBSERVATION_KEY = 'routing_observation'

// imports, beside the other shared imports (:29–31)
import { routingObservationSettingsSchema, routingSettingsSchema, type RoutingObservationSettings, type RoutingSettings } from '../../shared/routing'
import { parseRoutingObservationValue, parseRoutingSettingsValue } from '../routing/storeCore'

// after writeAppearanceSettings (:3911–3918)
readRoutingSettings(): RoutingSettings {
  const row = this.d.select().from(settings).where(eq(settings.key, ROUTING_SETTINGS_KEY)).get()
  const parsed = parseRoutingSettingsValue(row ? row.value : null)
  if (parsed.warning) logger.warn(`[routing] ${parsed.warning}`)
  return parsed.value
}

writeRoutingSettings(value: RoutingSettings): void {
  // Parsed BEFORE the write so a caller cannot store a shape the reader would throw away.
  const json = JSON.stringify(routingSettingsSchema.parse(value))
  this.d
    .insert(settings)
    .values({ key: ROUTING_SETTINGS_KEY, value: json })
    .onConflictDoUpdate({ target: settings.key, set: { value: json } })
    .run()
}
```

`readRoutingObservation(): RoutingObservationSettings` and `writeRoutingObservation(value: RoutingObservationSettings): void` follow the same shape with `ROUTING_OBSERVATION_KEY`, `parseRoutingObservationValue` and `routingObservationSettingsSchema`. These four methods cannot be unit-tested (vitest cannot load `better-sqlite3`); their logic lives in the tested pure helpers, and they are exercised at runtime by Task 2-3's live script (designation on a throwaway database) and Task 2-4's CDP drive (settings round trip).

## Test cases

Tests import `{ describe, it, expect }` from `vitest`. `routingStore.test.ts` uses a fresh `mkdtempSync(join(tmpdir(), 'chorus-routing-store-'))` per test, removed in `afterEach`. No test imports `storage.ts`.

**Table S3 — `src/shared/routing.test.ts`.**

| # | Case | Expect |
|---|---|---|
| S3-1 | `DEFAULT_ROUTING_OBSERVATION_SETTINGS` | Parses; equals `{ enabled: true, credentialProfileId: null }`. |
| S3-2 | Observation settings with `credentialProfileId: 'x'`; with an extra key | Fail both. |
| S3-3 | A snapshot file built from the golden fixture's rows, with `version: 2`; with `endpoints: []`; with an extra top-level key | The valid one parses; the other three fail. |
| S3-4 | Account file with `eligibility: { guardrailRemoved: null, dataPolicyRemoved: null, checkedAt: null }` | Parses (unknown is storable). |

**Table C — `storeCore.test.ts`.**

| # | Case | Expect |
|---|---|---|
| C1 | `modelDirName` of `deepseek/deepseek-v4.1-flash`, `A/b`, `.x`, `x.`, `a%b`, `qwen/qwen3:free`, `é` | `deepseek%2Fdeepseek-v4.1-flash`, `%41%2Fb`, `%2Ex`, `x%2E`, `a%25b`, `qwen%2Fqwen3%3Afree`, `%C3%A9` |
| C2 | Twelve slugs differing only in `/`, `%`, `.`, `:` and case | Twelve distinct names. |
| C3 | `''`; a 200-character slug | Both throw. |
| C4 | `accountFileName('5f0c1a2e-8a3b-4c5d-9e6f-0123456789ab')`; `'not-a-uuid'`; `'../x'` | `account-5f0c1a2e-8a3b-4c5d-9e6f-0123456789ab.json`; throws; throws. |
| C5 | `parseSnapshotFile(null, m)`; `('{', m)`; a valid file; a valid file with another `model`; `version: 2` | `{ null, null }`; `null` + `snapshot file for deepseek/deepseek-v4.1-flash is not valid JSON; reading it as empty`; the snapshot; `null` + the schema warning; `null` + the schema warning. No warning contains the file text. |
| C6 | `parseSnapshotFile(snapshotFileText(m, s), m)` for the golden snapshot (33 rows) | Strictly equals `s`. `snapshotFileText(m, { fetchedAt, endpoints: [] })` throws. |
| C7 | The same three cases for observations, cache and account files; an account file read with a different credential id | As C5/C6; the mismatched id gives the schema warning. |
| C8 | `mergeObservations`: the same tag and instant written as `2026-10-02T09:05:00Z` (existing) and `2026-10-02T09:05:00.000Z` (added) | One observation, the added one. |
| C9 | `now` 2026-10-09T09:05:00Z, `maxAgeDays` 7; observations at 2026-10-02T09:05:00Z and 2026-10-02T09:04:59Z | The first kept, the second dropped. |
| C10 | 450 observations for one tag, 30 minutes apart | The newest 400 kept, sorted ascending. |
| C11 | Two tags at the same instant, added in reverse order | Sorted by tag within the instant; inputs unchanged (deep-frozen inputs do not throw). |
| C12 | `mergeObservations(…, 'not a date', 7)` | Throws `RangeError`. |
| C13 | `mergeCacheVerifications`: existing `{ b: false@t1, a: true@t1 }`, added `{ b: true@t2 }` | `{ a: true@t1, b: true@t2 }`, keys in order `a`, `b`. 501 records → the newest 500. |
| C14 | `parseRoutingSettingsValue(null)` | Defaults, no warning; mutating `value.tierWeights.fast` leaves `DEFAULT_ROUTING_SETTINGS.tierWeights.fast` at 1. |
| C15 | `'{"minUptimePct":99.4}'`; `'{}'` | Defaults with `minUptimePct` 99.4, no warning; defaults, no warning. |
| C16 | `'{"bogus":1}'`; `'nope'`; `'[1]'`; `'5'`; `'null'`; `'{"readmitUptimePct":99}'` | Defaults each, with the "did not validate" warning (the "were not JSON" warning for `'nope'`). |
| C17 | `parseRoutingObservationValue`: `null`; `'{"enabled":false}'`; `'{"credentialProfileId":"x"}'`; a valid UUID | Defaults; `{ enabled: false, credentialProfileId: null }`; defaults + warning; stored. |

**Table F — `routingStore.test.ts`.**

| # | Case | Expect |
|---|---|---|
| F1 | `writeSnapshot` then `readSnapshot` | Round trip; the file is `<root>/deepseek%2Fdeepseek-v4.1-flash/snapshot.json`; no `*.tmp` remains anywhere under root. |
| F2 | The golden snapshot (33 parsed rows) | Strictly equal after the round trip. |
| F3 | `snapshot.json` containing `garbage`; read twice | `null` both times; `warn` called exactly once; the file's bytes are unchanged and it still exists. |
| F4 | After F3, `writeSnapshot`; then corrupt it again and read | The write replaces it and reads back; the new corruption warns once more. |
| F5 | `appendObservations` with the golden snapshot's 32 observations, twice | 32 stored, no duplicates; the returned list equals the file's content. |
| F6 | `readObservations`, `readCache`, `readAccount` with nothing on disk | `[]`, `{}`, `null`; no warning. |
| F7 | `mergeCache` twice with overlapping tags | The file holds the merged record; returned value equals it. |
| F8 | `writeAccount` for two credential ids | Two files `account-<id>.json`; each reads back its own eligibility; a third id reads `null`. |
| F9 | Every method with `other/model` | Throws `routing store: unknown model`; nothing created under root. |
| F10 | `snapshot.json` truncated to 16,000,001 bytes | `null` and one `size` warning. |
| F11 | A directory named `snapshot.json` in the model directory | `writeSnapshot` throws `routing store: could not write the snapshot file for deepseek/deepseek-v4.1-flash`; no `*.tmp` remains; the directory is untouched. |
| F12 | After writing all four kinds | Every file under root passes `scrubSecrets(text) === text`. |

## Invariants

- `storeCore.ts` is pure: no clock, randomness or I/O; `now` and texts are parameters. The purity and layering greps stay empty.
- Reads never throw for file problems, never delete or rewrite a file, and warn at most once per file per store instance. Writes are temp file plus rename, and leave no temp file on failure.
- Every file is validated on the way in and on the way out. The store writes only for registry models, only under its root, and never receives a key.
- Settings read as defaults underneath the stored value, validated; a bad row reads as the defaults with a warning; writes are validated before they reach SQLite. No migration.

## Verification

```powershell
npm run typecheck
npx vitest run src/main/routing/storeCore.test.ts src/main/services/routingStore.test.ts src/shared/routing.test.ts
npm test
Get-ChildItem -Path src/main/routing, src/shared/routing.ts -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern 'Date\.now\(|Math\.random\(|new Date\(\)|from ''(node:|fs''|path''|electron|better-sqlite3)|require\('
Get-ChildItem -Path src/main/routing -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern "from '\.\./(services|db|adapters)/"
node scripts/verify-routing-ranker.mjs
npm run grep:secrets
git diff --check
git status --short
```

Both `Select-String` lines must print nothing. The runtime evidence for this task is real file I/O against temp directories (F1–F12), including the golden snapshot round trip; the `storage.ts` methods get their runtime check in Tasks 2-3 and 2-4. Record the vitest summary and `git diff --stat src/main/services/storage.ts` (only the two keys, two imports and four methods).
