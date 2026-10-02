import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_ROUTING_OBSERVATION_SETTINGS,
  DEFAULT_ROUTING_SETTINGS,
  RANKED_TIERS,
  ROUTING_FAILURE_MESSAGES,
  ROUTING_FAILURES,
  ROUTING_PROFILES,
  modelRegistryEntrySchema,
  probeSkipSchema,
  rawEndpointSchema,
  routingAccountFileSchema,
  routingObservationSchema,
  routingObservationSettingsSchema,
  routingProfileSchema,
  routingSettingsSchema,
  routingSnapshotFileSchema,
  routingTagSchema,
  verificationRecordSchema
} from './routing'

/** Model Routing Task 1-1, Table S (ImplementationSpec-1-1). */

const fixture = JSON.parse(
  readFileSync(new URL('../main/routing/__fixtures__/endpoints-deepseek-v4.1-flash-2026-10-02.json', import.meta.url), 'utf8')
) as { fetchedAt: string; data: { endpoints: Record<string, unknown>[] } }
const rows = fixture.data.endpoints

const RAW_ENDPOINT_KEYS = Object.keys(rawEndpointSchema.shape)

const observation = {
  tag: 'deepinfra/fp8',
  observedAt: '2026-10-02T09:05:00Z',
  uptime1d: 99.9,
  uptime5m: 100,
  status: 0,
  tpsP50: 63,
  tpsP90: 80,
  latencyP50Ms: 1428.5,
  latencyP90Ms: 2000
}

const verification = {
  model: 'deepseek/deepseek-v4.1-flash',
  tag: 'together',
  referenceTag: 'deepinfra/fp8',
  suiteVersion: '1',
  score: 0.98,
  verifiedAt: '2026-10-01T00:00:00Z',
  expiresAt: '2026-11-01T00:00:00Z',
  reviewer: 'coordinator'
}

describe('Table S — shared routing schemas', () => {
  it('S1: every fixture row parses; native_tools and other unlisted keys are stripped', () => {
    expect(rows).toHaveLength(33)
    for (const row of rows) {
      const parsed = rawEndpointSchema.safeParse(row)
      expect(parsed.success, String(row.tag)).toBe(true)
      if (!parsed.success) continue
      expect('native_tools' in row).toBe(true)
      expect('native_tools' in parsed.data).toBe(false)
      expect('name' in parsed.data).toBe(false)
      expect('model_id' in parsed.data).toBe(false)
      for (const key of Object.keys(parsed.data)) expect(RAW_ENDPOINT_KEYS).toContain(key)
      // Nested non-strict objects strip too: p75/p99 are not part of the contract.
      if (parsed.data.latency_last_30m) expect(Object.keys(parsed.data.latency_last_30m).sort()).toEqual(['p50', 'p90'])
    }
  })

  it('S2: a row without tag and a row with an unparseable prompt price both fail', () => {
    const withoutTag: Record<string, unknown> = { ...rows[0] }
    delete withoutTag.tag
    expect(rawEndpointSchema.safeParse(withoutTag).success).toBe(false)

    const badPrice = { ...rows[0], pricing: { ...(rows[0].pricing as object), prompt: 'abc' } }
    expect(rawEndpointSchema.safeParse(badPrice).success).toBe(false)
  })

  it('S3: the default settings and both profiles parse with their schemas', () => {
    expect(routingSettingsSchema.safeParse(DEFAULT_ROUTING_SETTINGS).success).toBe(true)
    expect(routingProfileSchema.safeParse(ROUTING_PROFILES.interactive).success).toBe(true)
    expect(routingProfileSchema.safeParse(ROUTING_PROFILES.helper).success).toBe(true)
    expect(ROUTING_PROFILES.interactive.id).toBe('interactive')
    expect(ROUTING_PROFILES.helper.id).toBe('helper')
  })

  it('S4: settings with an extra key, readmit below min, and shares not summing to 1 each fail', () => {
    expect(routingSettingsSchema.safeParse({ ...DEFAULT_ROUTING_SETTINGS, extra: 1 }).success).toBe(false)
    expect(routingSettingsSchema.safeParse({ ...DEFAULT_ROUTING_SETTINGS, readmitUptimePct: 99.4 }).success).toBe(false)
    const badShares = { ...ROUTING_PROFILES.interactive, tokenShares: { fresh: 0.5, cached: 0.5, output: 0.1 } }
    expect(routingProfileSchema.safeParse(badShares).success).toBe(false)
  })

  it('S5: an observation with a non-ISO observedAt or an extra key fails', () => {
    expect(routingObservationSchema.safeParse(observation).success).toBe(true)
    expect(routingObservationSchema.safeParse({ ...observation, observedAt: '2026-10-02 09:05' }).success).toBe(false)
    expect(routingObservationSchema.safeParse({ ...observation, extra: true }).success).toBe(false)
  })

  it('S6: a verification record whose expiresAt equals verifiedAt fails', () => {
    expect(verificationRecordSchema.safeParse(verification).success).toBe(true)
    expect(verificationRecordSchema.safeParse({ ...verification, expiresAt: verification.verifiedAt }).success).toBe(false)
  })

  it('S7: RANKED_TIERS', () => {
    expect(RANKED_TIERS).toEqual(['budget', 'balanced', 'fast'])
  })

  it('strict records reject unknown keys (verification record, registry entry)', () => {
    expect(verificationRecordSchema.safeParse({ ...verification, extra: 1 }).success).toBe(false)
    const entry = {
      slug: 'deepseek/deepseek-v4.1-flash',
      displayName: 'DeepSeek V4.1 Flash',
      nativePrecision: 'fp8',
      nativePrecisionSource: 'test',
      firstPartyProviders: ['DeepSeek'],
      verified: [],
      minContext: 262144
    }
    expect(modelRegistryEntrySchema.safeParse(entry).success).toBe(true)
    expect(modelRegistryEntrySchema.safeParse({ ...entry, extra: 1 }).success).toBe(false)
  })
})

/** Model Routing Task 2-1, Table S2 (ImplementationSpec-2-1). */
describe('Table S2 — transport vocabulary', () => {
  it('S2-1: routingTagSchema accepts real tags and rejects spaces, a leading dash, 65 characters and a key shape', () => {
    for (const tag of ['deepinfra/fp8', 'together', 'baseten/fast']) {
      expect(routingTagSchema.safeParse(tag).success, tag).toBe(true)
    }
    // Assembled at runtime so this file never holds a complete key shape (npm run grep:secrets).
    const keyShaped = 'sk-or-v1-' + '0123456789abcdef'.repeat(4)
    expect(keyShaped).toHaveLength(73)
    for (const tag of ['deep seek', '-x', 'a'.repeat(65), keyShaped]) {
      expect(routingTagSchema.safeParse(tag).success, tag).toBe(false)
    }
    expect(routingTagSchema.safeParse('a'.repeat(64)).success).toBe(true)
  })

  it('S2-2: one message per failure, in ROUTING_FAILURES order, none empty or templated', () => {
    expect(Object.keys(ROUTING_FAILURE_MESSAGES)).toEqual([...ROUTING_FAILURES])
    for (const failure of ROUTING_FAILURES) {
      const message = ROUTING_FAILURE_MESSAGES[failure]
      expect(message.length, failure).toBeGreaterThan(0)
      expect(message.includes('${'), failure).toBe(false)
    }
  })

  it('S2-3: probeSkipSchema accepts a known reason and rejects an unknown reason or an extra key', () => {
    expect(probeSkipSchema.safeParse({ tag: 'atlas-cloud/fp8', reason: 'cap' }).success).toBe(true)
    expect(probeSkipSchema.safeParse({ tag: 'atlas-cloud/fp8', reason: 'later' }).success).toBe(false)
    expect(probeSkipSchema.safeParse({ tag: 'atlas-cloud/fp8', reason: 'cap', extra: 1 }).success).toBe(false)
  })
})

/** Model Routing Task 2-2, Table S3 (ImplementationSpec-2-2). */
describe('Table S3 — store and settings schemas', () => {
  const SLUG = 'deepseek/deepseek-v4.1-flash'
  const CREDENTIAL_ID = '5f0c1a2e-8a3b-4c5d-9e6f-0123456789ab'

  it('S3-1: DEFAULT_ROUTING_OBSERVATION_SETTINGS parses and is enabled with no credential', () => {
    expect(routingObservationSettingsSchema.safeParse(DEFAULT_ROUTING_OBSERVATION_SETTINGS).success).toBe(true)
    expect(DEFAULT_ROUTING_OBSERVATION_SETTINGS).toEqual({ enabled: true, credentialProfileId: null })
  })

  it('S3-2: observation settings with a non-UUID credential id, or with an extra key, fail', () => {
    // Positive control: a UUID is accepted, so the failures below are about the id and the key.
    expect(routingObservationSettingsSchema.safeParse({ enabled: true, credentialProfileId: CREDENTIAL_ID }).success).toBe(true)
    expect(routingObservationSettingsSchema.safeParse({ enabled: true, credentialProfileId: 'x' }).success).toBe(false)
    expect(routingObservationSettingsSchema.safeParse({ ...DEFAULT_ROUTING_OBSERVATION_SETTINGS, extra: 1 }).success).toBe(false)
  })

  it('S3-3: a snapshot file from the golden rows parses; version 2, no endpoints and an extra key fail', () => {
    const file = { version: 1, model: SLUG, fetchedAt: fixture.fetchedAt, endpoints: rows }
    expect(routingSnapshotFileSchema.safeParse(file).success).toBe(true)
    expect(routingSnapshotFileSchema.safeParse({ ...file, version: 2 }).success).toBe(false)
    expect(routingSnapshotFileSchema.safeParse({ ...file, endpoints: [] }).success).toBe(false)
    expect(routingSnapshotFileSchema.safeParse({ ...file, extra: 1 }).success).toBe(false)
  })

  it('S3-4: an account file with unknown eligibility (all null) parses', () => {
    const file = {
      version: 1,
      model: SLUG,
      credentialProfileId: CREDENTIAL_ID,
      eligibility: { guardrailRemoved: null, dataPolicyRemoved: null, checkedAt: null }
    }
    expect(routingAccountFileSchema.safeParse(file).success).toBe(true)
  })
})
