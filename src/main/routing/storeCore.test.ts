import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_ROUTING_OBSERVATION_SETTINGS,
  DEFAULT_ROUTING_SETTINGS,
  type AccountEligibility,
  type CacheVerification,
  type EndpointSnapshot,
  type RoutingObservation
} from '../../shared/routing'
import { extractObservations, parseEndpointsResponse } from './endpointsCore'
import {
  CACHE_RECORDS_MAX,
  MODEL_DIR_MAX_LENGTH,
  OBSERVATIONS_MAX_PER_TAG,
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
  parseRoutingObservationValue,
  parseRoutingSettingsValue,
  parseSnapshotFile,
  snapshotFileText,
  storeWarning
} from './storeCore'

/** Model Routing Task 2-2, Table C (ImplementationSpec-2-2). */

const M = 'deepseek/deepseek-v4.1-flash'
const CREDENTIAL_ID = '5f0c1a2e-8a3b-4c5d-9e6f-0123456789ab'
const OTHER_CREDENTIAL_ID = '0b6d2c4e-1f3a-4b5c-8d7e-9f0a1b2c3d4e'

const FIXTURE_TEXT = readFileSync(join(__dirname, '__fixtures__/endpoints-deepseek-v4.1-flash-2026-10-02.json'), 'utf8')
const fixture = JSON.parse(FIXTURE_TEXT) as { fetchedAt: string }
const golden: EndpointSnapshot = { fetchedAt: fixture.fetchedAt, endpoints: parseEndpointsResponse(JSON.parse(FIXTURE_TEXT)).endpoints }
const goldenObservations = extractObservations(golden)

const jsonWarning = (kind: string): string => `${kind} file for ${M} is not valid JSON; reading it as empty`
const schemaWarning = (kind: string): string => `${kind} file for ${M} does not match its schema; reading it as empty`

function obs(tag: string, observedAt: string, over: Partial<RoutingObservation> = {}): RoutingObservation {
  return {
    tag,
    observedAt,
    uptime1d: 99.9,
    uptime5m: 100,
    status: 0,
    tpsP50: 60,
    tpsP90: 80,
    latencyP50Ms: 900,
    latencyP90Ms: 1800,
    ...over
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

/** Replaces one top-level field of a serialised store file. */
function withField(text: string, key: string, value: unknown): string {
  return JSON.stringify({ ...(JSON.parse(text) as object), [key]: value })
}

describe('Table C — store core', () => {
  it('C1: modelDirName percent-encodes every byte outside [a-z0-9-.] and an edge dot', () => {
    const cases: [string, string][] = [
      ['deepseek/deepseek-v4.1-flash', 'deepseek%2Fdeepseek-v4.1-flash'],
      ['A/b', '%41%2Fb'],
      ['.x', '%2Ex'],
      ['x.', 'x%2E'],
      ['a%b', 'a%25b'],
      ['qwen/qwen3:free', 'qwen%2Fqwen3%3Afree'],
      ['é', '%C3%A9']
    ]
    for (const [slug, name] of cases) expect(modelDirName(slug), slug).toBe(name)
  })

  it('C2: twelve slugs differing only in /, %, ., : and case map to twelve distinct names', () => {
    const slugs = ['a/b', 'a%b', 'a.b', 'a:b', 'A/b', 'A%b', 'A.b', 'A:b', 'a/B', 'a%B', 'a.B', 'a:B']
    const names = slugs.map(modelDirName)
    expect(new Set(names).size).toBe(12)
    // Windows folds case in file names: the names stay distinct case-insensitively too.
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(12)
    for (const name of names) expect(name).toMatch(/^([a-z0-9.-]|%[0-9A-F]{2})+$/)
    // An already-encoded slug cannot collide with the slug it looks like.
    // (`%` → `%25`, and the upper-case `F` is itself encoded as `%46`.)
    expect(modelDirName('a%2Fb')).toBe('a%252%46b')
    expect(modelDirName('a%2Fb')).not.toBe(modelDirName('a/b'))
  })

  it('C3: an empty slug and a 200-character slug both throw', () => {
    expect(() => modelDirName('')).toThrow('routing store: unusable model slug')
    expect(() => modelDirName('a'.repeat(200))).toThrow('routing store: unusable model slug')
    // The limit applies to the encoded result.
    expect(modelDirName('a'.repeat(MODEL_DIR_MAX_LENGTH))).toHaveLength(MODEL_DIR_MAX_LENGTH)
    expect(() => modelDirName('a'.repeat(MODEL_DIR_MAX_LENGTH + 1))).toThrow('routing store: unusable model slug')
    expect(() => modelDirName('/'.repeat(41))).toThrow('routing store: unusable model slug') // 123 characters encoded
    // A lone surrogate has no UTF-8 encoding; refusing it keeps the mapping injective.
    expect(() => modelDirName('a\uD800')).toThrow('routing store: unusable model slug')
  })

  it('C4: accountFileName accepts a UUID and refuses anything else', () => {
    expect(accountFileName(CREDENTIAL_ID)).toBe(`account-${CREDENTIAL_ID}.json`)
    expect(() => accountFileName('not-a-uuid')).toThrow()
    expect(() => accountFileName('../x')).toThrow()
  })

  it('C5: parseSnapshotFile — missing, not JSON, valid, another model, version 2', () => {
    expect(parseSnapshotFile(null, M)).toEqual({ value: null, warning: null })
    expect(parseSnapshotFile('{', M)).toEqual({ value: null, warning: jsonWarning('snapshot') })
    expect(jsonWarning('snapshot')).toBe(
      'snapshot file for deepseek/deepseek-v4.1-flash is not valid JSON; reading it as empty'
    )

    const valid = snapshotFileText(M, golden)
    expect(parseSnapshotFile(valid, M)).toEqual({ value: golden, warning: null })

    const otherModel = withField(valid, 'model', 'other/model')
    const version2 = withField(valid, 'version', 2)
    for (const text of [otherModel, version2]) {
      const parsed = parseSnapshotFile(text, M)
      expect(parsed).toEqual({ value: null, warning: schemaWarning('snapshot') })
    }
    // No warning quotes the file: not its text, not the model it names.
    for (const text of ['{', otherModel, version2]) {
      const warning = parseSnapshotFile(text, M).warning as string
      expect(warning.includes(text)).toBe(false)
      expect(warning.includes('other/model')).toBe(false)
      expect(warning).not.toMatch(/[{}"]/)
    }
  })

  it('C5 (warnings): the size and read texts are exact and fixed', () => {
    expect(STORE_FILE_CAP_BYTES).toBe(16_000_000)
    expect(storeWarning('snapshot', M, 'size')).toBe(
      'snapshot file for deepseek/deepseek-v4.1-flash exceeds 16000000 bytes; reading it as empty'
    )
    expect(storeWarning('account', M, 'read')).toBe(
      'account file for deepseek/deepseek-v4.1-flash could not be read; reading it as empty'
    )
    expect(storeWarning('observations', M, 'schema')).toBe(schemaWarning('observations'))
    expect(ROUTING_STORE_FILES).toEqual({ snapshot: 'snapshot.json', observations: 'observations.json', cache: 'cache.json' })
  })

  it('C6: the golden snapshot (33 rows) round-trips strictly; an empty snapshot cannot be serialised', () => {
    expect(golden.endpoints).toHaveLength(33)
    const text = snapshotFileText(M, golden)
    expect(text.endsWith('\n')).toBe(false)
    expect(JSON.parse(text)).toMatchObject({ version: 1, model: M, fetchedAt: golden.fetchedAt })
    expect(parseSnapshotFile(text, M).value).toStrictEqual(golden)
    expect(() => snapshotFileText(M, { fetchedAt: golden.fetchedAt, endpoints: [] })).toThrow()
  })

  it('C7: observations, cache and account files — the same cases, and a mismatched credential id', () => {
    // Observations: the golden snapshot's 32.
    expect(goldenObservations).toHaveLength(32)
    expect(parseObservationsFile(null, M)).toEqual({ value: null, warning: null })
    expect(parseObservationsFile('{', M)).toEqual({ value: null, warning: jsonWarning('observations') })
    const obsText = observationsFileText(M, goldenObservations)
    expect(parseObservationsFile(obsText, M).value).toStrictEqual(goldenObservations)
    expect(parseObservationsFile(withField(obsText, 'model', 'other/model'), M)).toEqual({
      value: null,
      warning: schemaWarning('observations')
    })
    expect(parseObservationsFile(withField(obsText, 'version', 2), M).warning).toBe(schemaWarning('observations'))
    expect(() => observationsFileText(M, [{ ...goldenObservations[0], observedAt: 'yesterday' }])).toThrow()

    // Cache.
    const cache: CacheVerification = {
      'baseten/fp8': { verified: true, checkedAt: '2026-10-02T09:15:39Z' },
      'baidu/fp8': { verified: false, checkedAt: '2026-10-02T09:15:39Z' }
    }
    expect(parseCacheFile(null, M)).toEqual({ value: null, warning: null })
    expect(parseCacheFile('{', M)).toEqual({ value: null, warning: jsonWarning('cache') })
    const cacheText = cacheFileText(M, cache)
    expect(parseCacheFile(cacheText, M).value).toStrictEqual(cache)
    expect(parseCacheFile(withField(cacheText, 'model', 'other/model'), M).warning).toBe(schemaWarning('cache'))
    expect(parseCacheFile(withField(cacheText, 'version', 2), M).warning).toBe(schemaWarning('cache'))
    expect(() => cacheFileText(M, { 'x/y': { verified: true, checkedAt: 'later' } })).toThrow()

    // Account.
    const eligibility: AccountEligibility = { guardrailRemoved: ['deepseek'], dataPolicyRemoved: [], checkedAt: '2026-10-02T09:15:39Z' }
    expect(parseAccountFile(null, M, CREDENTIAL_ID)).toEqual({ value: null, warning: null })
    expect(parseAccountFile('{', M, CREDENTIAL_ID)).toEqual({ value: null, warning: jsonWarning('account') })
    const accountText = accountFileText(M, CREDENTIAL_ID, eligibility)
    expect(parseAccountFile(accountText, M, CREDENTIAL_ID).value).toStrictEqual(eligibility)
    expect(parseAccountFile(withField(accountText, 'model', 'other/model'), M, CREDENTIAL_ID).warning).toBe(schemaWarning('account'))
    expect(parseAccountFile(withField(accountText, 'version', 2), M, CREDENTIAL_ID).warning).toBe(schemaWarning('account'))
    expect(parseAccountFile(accountText, M, OTHER_CREDENTIAL_ID)).toEqual({ value: null, warning: schemaWarning('account') })
    expect(() => accountFileText(M, 'not-a-uuid', eligibility)).toThrow()
  })

  it('C8: the same tag and instant in two spellings collapse to one, and the added one wins', () => {
    const existing = obs('deepinfra/fp8', '2026-10-02T09:05:00Z', { tpsP50: 10 })
    const added = obs('deepinfra/fp8', '2026-10-02T09:05:00.000Z', { tpsP50: 20 })
    const merged = mergeObservations([existing], [added], '2026-10-02T09:30:00Z', 7)
    expect(merged).toEqual([added])
  })

  it('C9: exactly maxAgeDays old is kept; one second older is dropped; after now is kept', () => {
    const merged = mergeObservations(
      [obs('a', '2026-10-02T09:05:00Z'), obs('a', '2026-10-02T09:04:59Z')],
      [obs('a', '2026-10-09T09:10:00Z')],
      '2026-10-09T09:05:00Z',
      7
    )
    expect(merged.map((o) => o.observedAt)).toEqual(['2026-10-02T09:05:00Z', '2026-10-09T09:10:00Z'])
  })

  it('C10: 450 observations for one tag, 30 minutes apart — the newest 400 survive, ascending', () => {
    expect(OBSERVATIONS_MAX_PER_TAG).toBe(400)
    const start = Date.parse('2026-10-01T00:00:00Z')
    const all = Array.from({ length: 450 }, (_, i) => obs('a', new Date(start + i * 1_800_000).toISOString()))
    // maxAgeDays 10 covers all 450 (9.35 days), so the per-tag bound is what cuts.
    const now = all[449].observedAt
    const merged = mergeObservations([], all, now, 10)
    expect(merged).toHaveLength(400)
    expect(merged).toEqual(all.slice(50))
    // The bound is a parameter too.
    expect(mergeObservations(all.slice(0, 10), [], now, 10, 3)).toEqual(all.slice(7, 10))
  })

  it('C11: two tags at one instant are sorted by tag; deep-frozen inputs are not mutated', () => {
    const existing = deepFreeze([obs('m/x', '2026-10-02T09:00:00Z')])
    const added = deepFreeze([obs('z/y', '2026-10-02T09:05:00Z'), obs('a/y', '2026-10-02T09:05:00Z')])
    const before = JSON.stringify([existing, added])
    const merged = mergeObservations(existing, added, '2026-10-02T09:30:00Z', 7)
    expect(merged.map((o) => `${o.observedAt} ${o.tag}`)).toEqual([
      '2026-10-02T09:00:00Z m/x',
      '2026-10-02T09:05:00Z a/y',
      '2026-10-02T09:05:00Z z/y'
    ])
    expect(JSON.stringify([existing, added])).toBe(before)
    // Fresh objects: mutating the result cannot reach the inputs.
    expect(merged[0]).not.toBe(existing[0])
  })

  it('C12: a now that is not an ISO instant throws RangeError', () => {
    expect(() => mergeObservations([], [], 'not a date', 7)).toThrow(RangeError)
    expect(() => mergeObservations([], [], 'not a date', 7)).toThrow('Invalid time: now')
    expect(() => mergeObservations([], [], '2026-10-02T09:05:00+01:00', 7)).toThrow(RangeError)
  })

  it('C12 (retention limits): maxAgeDays must be finite and positive; maxPerTag a positive integer', () => {
    const now = '2026-10-02T09:30:00Z'
    const one = [obs('a', '2026-10-02T09:05:00Z')]
    for (const maxAgeDays of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
      expect(() => mergeObservations(one, [], now, maxAgeDays), String(maxAgeDays)).toThrow(RangeError)
      expect(() => mergeObservations(one, [], now, maxAgeDays), String(maxAgeDays)).toThrow('Invalid retention: maxAgeDays')
    }
    for (const maxPerTag of [0, Number.NaN, 1.5]) {
      expect(() => mergeObservations(one, [], now, 7, maxPerTag), String(maxPerTag)).toThrow(RangeError)
      expect(() => mergeObservations(one, [], now, 7, maxPerTag), String(maxPerTag)).toThrow('Invalid retention: maxPerTag')
    }
    // Positive controls: a fractional age and a limit of 1 are valid.
    expect(mergeObservations(one, [], now, 0.5, 1)).toEqual(one)
  })

  it('C13: mergeCacheVerifications replaces per tag, sorts keys, and keeps the newest 500', () => {
    const t1 = '2026-10-01T00:00:00Z'
    const t2 = '2026-10-02T00:00:00Z'
    const existing: CacheVerification = deepFreeze({ b: { verified: false, checkedAt: t1 }, a: { verified: true, checkedAt: t1 } })
    const added: CacheVerification = deepFreeze({ b: { verified: true, checkedAt: t2 } })
    const merged = mergeCacheVerifications(existing, added)
    expect(merged).toStrictEqual({ a: { verified: true, checkedAt: t1 }, b: { verified: true, checkedAt: t2 } })
    expect(Object.keys(merged)).toEqual(['a', 'b'])

    expect(CACHE_RECORDS_MAX).toBe(500)
    const start = Date.parse('2026-09-01T00:00:00Z')
    const many: CacheVerification = {}
    for (let i = 0; i < 501; i++) {
      // Tag order is the reverse of age order, so a tag-order cut would keep the wrong one.
      many[`t${String(500 - i).padStart(3, '0')}`] = { verified: true, checkedAt: new Date(start + i * 60_000).toISOString() }
    }
    const kept = mergeCacheVerifications(many, {})
    expect(Object.keys(kept)).toHaveLength(500)
    expect('t500' in kept).toBe(false) // the oldest
    expect(Object.keys(kept)).toEqual(Object.keys(many).filter((k) => k !== 't500').sort())

    // Ties on checkedAt keep the code-unit-first tag.
    const tied: CacheVerification = {}
    for (let i = 0; i < 501; i++) tied[`t${String(i).padStart(3, '0')}`] = { verified: false, checkedAt: t1 }
    expect('t500' in mergeCacheVerifications(tied, {})).toBe(false)
  })

  it('C14: no row reads as fresh defaults; mutating the value never reaches DEFAULT_ROUTING_SETTINGS', () => {
    const parsed = parseRoutingSettingsValue(null)
    expect(parsed).toEqual({ value: DEFAULT_ROUTING_SETTINGS, warning: null })
    expect(parsed.value).not.toBe(DEFAULT_ROUTING_SETTINGS)
    parsed.value.tierWeights.fast = 0.25
    expect(DEFAULT_ROUTING_SETTINGS.tierWeights.fast).toBe(1)
    expect(parseRoutingSettingsValue(null).value.tierWeights.fast).toBe(1)
  })

  it('C15: a partial row reads with defaults underneath; {} reads as the defaults', () => {
    expect(parseRoutingSettingsValue('{"minUptimePct":99.4}')).toEqual({
      value: { ...DEFAULT_ROUTING_SETTINGS, minUptimePct: 99.4 },
      warning: null
    })
    expect(parseRoutingSettingsValue('{}')).toEqual({ value: DEFAULT_ROUTING_SETTINGS, warning: null })
  })

  it('C16: unknown keys, non-JSON, arrays, primitives, null and refine failures read as defaults with a warning', () => {
    const notValid = 'stored routing settings did not validate; using defaults'
    for (const raw of ['{"bogus":1}', '[1]', '5', 'null', '{"readmitUptimePct":99}']) {
      expect(parseRoutingSettingsValue(raw), raw).toEqual({ value: DEFAULT_ROUTING_SETTINGS, warning: notValid })
    }
    expect(parseRoutingSettingsValue('nope')).toEqual({
      value: DEFAULT_ROUTING_SETTINGS,
      warning: 'stored routing settings were not JSON; using defaults'
    })
  })

  it('C17: parseRoutingObservationValue — no row, partial, a bad id, a valid UUID', () => {
    expect(parseRoutingObservationValue(null)).toEqual({ value: DEFAULT_ROUTING_OBSERVATION_SETTINGS, warning: null })
    expect(parseRoutingObservationValue('{"enabled":false}')).toEqual({
      value: { enabled: false, credentialProfileId: null },
      warning: null
    })
    const bad = parseRoutingObservationValue('{"credentialProfileId":"x"}')
    expect(bad.value).toEqual(DEFAULT_ROUTING_OBSERVATION_SETTINGS)
    expect(bad.warning).toBe('stored routing observation setting did not validate; using defaults')
    expect(parseRoutingObservationValue(`{"credentialProfileId":"${CREDENTIAL_ID}"}`)).toEqual({
      value: { enabled: true, credentialProfileId: CREDENTIAL_ID },
      warning: null
    })
    expect(parseRoutingObservationValue(`{"enabled":false,"credentialProfileId":"${CREDENTIAL_ID}"}`).value).toEqual({
      enabled: false,
      credentialProfileId: CREDENTIAL_ID
    })
    // Fresh objects here too.
    const fresh = parseRoutingObservationValue(null).value
    expect(fresh).not.toBe(DEFAULT_ROUTING_OBSERVATION_SETTINGS)
    fresh.enabled = false
    expect(DEFAULT_ROUTING_OBSERVATION_SETTINGS.enabled).toBe(true)
  })
})
