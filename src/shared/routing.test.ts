import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { z } from 'zod'

import {
  DEFAULT_ROUTING_OBSERVATION_SETTINGS,
  DEFAULT_ROUTING_SETTINGS,
  RANKED_TIERS,
  ROUTING_CHANNELS,
  ROUTING_ERROR_CODES,
  ROUTING_FAILURE_MESSAGES,
  ROUTING_FAILURES,
  ROUTING_LAUNCH_CHOICES,
  ROUTING_LAUNCH_TIERS,
  ROUTING_NITRO_SUFFIX,
  ROUTING_OBSERVER_OUTCOMES,
  ROUTING_PROFILES,
  ROUTING_REFRESH_COOLDOWN_MS,
  ROUTING_REFRESH_PROBE_CAP_USD,
  ROUTING_TIERS,
  modelRegistryEntrySchema,
  probeSkipSchema,
  rawEndpointSchema,
  routingAccountFileSchema,
  routingCredentialListSchema,
  routingEmptyRequestSchema,
  routingBaseModelId,
  routingErrorCodeSchema,
  routingLaunchChoiceSchema,
  routingLaunchPreferencesSchema,
  routingLaunchRequestSchema,
  routingLaunchSelectionSchema,
  routingLaunchTierSchema,
  routingModelListSchema,
  routingObservationSchema,
  routingObservationSettingsSchema,
  routingProfileSchema,
  routingProgressEventSchema,
  routingRefreshRequestSchema,
  routingSettingsSchema,
  routingSettingsSetRequestSchema,
  routingSnapshotFileSchema,
  routingStatusSchema,
  routingTagSchema,
  routingTiersRequestSchema,
  tierResultSchema,
  verificationRecordSchema,
  type TierResult
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

/** Model Routing Task 2-3, Table S4 (ImplementationSpec-2-3). */
describe('Table S4 — service contract', () => {
  const SLUG = 'deepseek/deepseek-v4.1-flash'
  const CREDENTIAL_ID = '5f0c1a2e-8a3b-4c5d-9e6f-0123456789ab'
  const REFRESH_ID = '11111111-1111-4111-8111-111111111111'
  const AT = '2026-10-02T09:20:00Z'

  it('S4-1: routingErrorCodeSchema accepts every code and rejects NOPE', () => {
    expect(ROUTING_ERROR_CODES).toHaveLength(12) // ten → twelve: the Task 4a-1 amendment (SNAPSHOT_STALE, TIER_EMPTY)
    for (const code of ROUTING_ERROR_CODES) expect(routingErrorCodeSchema.safeParse(code).success, code).toBe(true)
    expect(routingErrorCodeSchema.safeParse('NOPE').success).toBe(false)
  })

  it('S4-2: request schemas accept a valid request; extra key, LOW effort, non-UUID id, spaced model fail', () => {
    const tiers = { model: SLUG, profile: 'interactive', effort: 'low', credentialProfileId: CREDENTIAL_ID }
    const refresh = { model: SLUG, credentialProfileId: CREDENTIAL_ID, profile: 'interactive', effort: 'low' }
    for (const [name, schema, valid] of [
      ['tiers', routingTiersRequestSchema, tiers],
      ['refresh', routingRefreshRequestSchema, refresh]
    ] as const) {
      expect(schema.safeParse(valid).success, name).toBe(true)
      expect(schema.safeParse({ ...valid, effort: null }).success, `${name} null effort`).toBe(true)
      expect(schema.safeParse({ ...valid, extra: 1 }).success, `${name} extra`).toBe(false)
      expect(schema.safeParse({ ...valid, effort: 'LOW' }).success, `${name} LOW`).toBe(false)
      expect(schema.safeParse({ ...valid, credentialProfileId: 'x' }).success, `${name} id`).toBe(false)
      expect(schema.safeParse({ ...valid, model: 'deepseek/deepseek v4' }).success, `${name} space`).toBe(false)
    }
    // tiers takes a null credential (offline ranking without an account); refresh never does.
    expect(routingTiersRequestSchema.safeParse({ ...tiers, credentialProfileId: null }).success).toBe(true)
    expect(routingRefreshRequestSchema.safeParse({ ...refresh, credentialProfileId: null }).success).toBe(false)
    expect(routingModelListSchema.safeParse({ models: [{ slug: SLUG, displayName: 'DeepSeek V4.1 Flash' }] }).success).toBe(true)
  })

  it('S4-3: tierResultSchema and the TierResult interface are mutually assignable (checked by npm run typecheck)', () => {
    const toInterface = (x: z.infer<typeof tierResultSchema>): TierResult => x
    const toSchema = (x: TierResult): z.infer<typeof tierResultSchema> => x
    expect(typeof toInterface).toBe('function')
    expect(typeof toSchema).toBe('function')
  })

  const base = { refreshId: REFRESH_ID, model: SLUG, at: AT }
  const outcome = { attempted: true, removed: ['deepseek'], issue: null, failure: null }
  const validEvents = [
    { ...base, stage: 'endpoints', fetchedAt: AT, endpointRows: 33, tags: 32, rejectedRows: 0 },
    { ...base, stage: 'preflight', checkedAt: AT, guardrails: outcome, dataPolicy: { attempted: false, removed: null, issue: null, failure: null } },
    {
      ...base,
      stage: 'probe-plan',
      planned: [{ tag: 'atlas-cloud/fp8', estimateUsd: 0.001 }],
      estimateUsd: 0.001,
      capUsd: 0.05,
      fresh: [],
      notProbed: [{ tag: 'morph/fp8', reason: 'limit' }]
    },
    { ...base, stage: 'probe', tag: 'atlas-cloud/fp8', outcome: 'verified', failure: null, calls: 3, costUsd: 0.0015, spentUsd: 0.0015 },
    {
      ...base,
      stage: 'done',
      estimateUsd: 0.001,
      spentUsd: 0.0015,
      probed: ['atlas-cloud/fp8'],
      notProbed: [{ tag: 'morph/fp8', reason: 'limit' }],
      accountEligibility: 'checked'
    },
    { ...base, stage: 'failed', code: 'FETCH_FAILED', failure: 'provider-error', message: 'OpenRouter returned an error.', spentUsd: 0 }
  ]

  it('S4-4: one valid event per stage passes; extra key, unknown stage and a 501-character message fail', () => {
    expect(validEvents.map((e) => e.stage)).toEqual(['endpoints', 'preflight', 'probe-plan', 'probe', 'done', 'failed'])
    for (const event of validEvents) expect(routingProgressEventSchema.safeParse(event).success, event.stage).toBe(true)
    expect(routingProgressEventSchema.safeParse({ ...validEvents[2], extra: 1 }).success).toBe(false)
    expect(routingProgressEventSchema.safeParse({ ...validEvents[0], stage: 'other' }).success).toBe(false)
    expect(routingProgressEventSchema.safeParse({ ...validEvents[5], message: 'x'.repeat(500) }).success).toBe(true)
    expect(routingProgressEventSchema.safeParse({ ...validEvents[5], message: 'x'.repeat(501) }).success).toBe(false)
  })

  it('S4-5: a status value passes in every observer state', () => {
    const states = ['stopped', 'dormant', 'scheduled', 'running'] as const
    for (const state of states) {
      const status = {
        observer: {
          state,
          dormantReason: state === 'dormant' ? 'undesignated' : null,
          nextTickAt: state === 'stopped' ? null : AT,
          lastTickAt: state === 'stopped' ? null : AT,
          lastOutcome: state === 'stopped' ? null : ROUTING_OBSERVER_OUTCOMES[states.indexOf(state)],
          lastFailure: state === 'scheduled' ? 'rate-limited' : null
        },
        models: [
          { model: SLUG, displayName: 'DeepSeek V4.1 Flash', snapshotFetchedAt: state === 'stopped' ? null : AT, observations: 32, cacheVerified: 13, busy: state === 'running' }
        ],
        requestsSinceStart: 45
      }
      expect(routingStatusSchema.safeParse(status).success, state).toBe(true)
    }
    expect(ROUTING_OBSERVER_OUTCOMES).toEqual(['observed', 'dormant', 'skipped-fresh', 'busy', 'refused', 'decrypt-failed', 'fetch-failed', 'failed'])
  })
})

/** Model Routing Task 2-4, Table S5 (ImplementationSpec-2-4). */
describe('Table S5 — IPC contract', () => {
  it('S5-1: eleven unique channel names, each starting with routing: (nine → ten: Task 3-1; ten → eleven: Task 4a-1)', () => {
    const channels = Object.values(ROUTING_CHANNELS)
    expect(channels).toHaveLength(11)
    expect(new Set(channels).size).toBe(11)
    for (const channel of channels) expect(channel.startsWith('routing:'), channel).toBe(true)
  })

  it('S5-2: the empty request accepts only {}; settings-set accepts only the wrapped settings', () => {
    expect(routingEmptyRequestSchema.safeParse({}).success).toBe(true)
    expect(routingEmptyRequestSchema.safeParse({ a: 1 }).success).toBe(false)
    expect(routingSettingsSetRequestSchema.safeParse({ settings: DEFAULT_ROUTING_SETTINGS }).success).toBe(true)
    expect(routingSettingsSetRequestSchema.safeParse(DEFAULT_ROUTING_SETTINGS).success).toBe(false)
  })
})

/** Model Routing Task 3-1, Table S6 (ImplementationSpec-3-1). */
describe('Table S6 — Phase 3 UI support', () => {
  const C = '5f0c1a2e-8a3b-4c5d-9e6f-0123456789ab'
  const item = { id: C, label: 'OR key', providerName: 'OpenRouter' }

  it('S6-1: the cooldown, the probe cap and the credentials channel', () => {
    expect(ROUTING_REFRESH_COOLDOWN_MS).toBe(60000)
    expect(ROUTING_REFRESH_PROBE_CAP_USD).toBe(0.05)
    expect(ROUTING_CHANNELS.credentials).toBe('routing:credentials')
  })

  it('S6-2: routingCredentialListSchema accepts an empty list and a valid item; a non-UUID id and extra or missing keys fail', () => {
    expect(routingCredentialListSchema.safeParse({ credentials: [] }).success).toBe(true)
    expect(routingCredentialListSchema.safeParse({ credentials: [item] }).success).toBe(true)
    expect(routingCredentialListSchema.safeParse({ credentials: [{ ...item, id: 'x' }] }).success).toBe(false)
    expect(routingCredentialListSchema.safeParse({ credentials: [{ ...item, extra: 1 }] }).success).toBe(false)
    expect(routingCredentialListSchema.safeParse({ credentials: [item], extra: 1 }).success).toBe(false)
    const withoutProviderName: Record<string, unknown> = { ...item }
    delete withoutProviderName.providerName
    expect(routingCredentialListSchema.safeParse({ credentials: [withoutProviderName] }).success).toBe(false)
  })

  it('S6-3: an empty label passes (a stored row never fails the list)', () => {
    expect(routingCredentialListSchema.safeParse({ credentials: [{ ...item, label: '' }] }).success).toBe(true)
  })
})

/** Model Routing Task 4a-1, Table S7 (ImplementationSpec-4a-1). */
describe('Table S7 — Phase 4a launch routing', () => {
  const SLUG = 'deepseek/deepseek-v4.1-flash'
  const C = '5f0c1a2e-8a3b-4c5d-9e6f-0123456789ab'
  const AT = '2026-10-02T09:20:00Z'
  const FETCHED = '2026-10-02T09:05:00Z'
  const PROVIDER = (order: string[]) => ({
    order,
    allow_fallbacks: false as const,
    require_parameters: true as const,
    quantizations: ['fp8' as const],
    data_collection: 'deny' as const
  })
  const BALANCED = ['deepinfra/fp8', 'streamlake/fp8', 'makora/fp8']
  const BALANCED_SELECTION = {
    tier: 'balanced',
    model: SLUG,
    sentModelId: SLUG,
    provider: PROVIDER(BALANCED),
    endpoints: BALANCED,
    computedAt: AT,
    snapshotFetchedAt: FETCHED
  }
  const NITRO_SELECTION = {
    tier: 'nitro',
    model: SLUG,
    sentModelId: SLUG + ':nitro',
    provider: { data_collection: 'deny' },
    endpoints: [] as string[],
    computedAt: AT,
    snapshotFetchedAt: null
  }

  it('S7-1: the Nitro suffix, the launch tiers (equal to ROUTING_TIERS), the launch choices and the channel', () => {
    expect(ROUTING_NITRO_SUFFIX).toBe(':nitro')
    expect([...ROUTING_LAUNCH_TIERS]).toEqual([...ROUTING_TIERS])
    expect([...ROUTING_LAUNCH_TIERS]).toEqual(['budget', 'balanced', 'fast', 'nitro'])
    expect([...ROUTING_LAUNCH_CHOICES]).toEqual(['budget', 'balanced', 'fast', 'nitro', 'default'])
    expect(ROUTING_CHANNELS.launchPreferences).toBe('routing:launch-preferences')
  })

  it('S7-2: routingBaseModelId removes exactly one trailing :nitro and nothing else', () => {
    expect(routingBaseModelId(SLUG + ':nitro')).toBe(SLUG)
    expect(routingBaseModelId(SLUG)).toBe(SLUG)
    expect(routingBaseModelId(SLUG + ':nitro:nitro')).toBe(SLUG + ':nitro')
    expect(routingBaseModelId(':nitro')).toBe('')
    expect(routingBaseModelId(SLUG + ':Nitro')).toBe(SLUG + ':Nitro')
    expect(routingBaseModelId(SLUG + ':nitrox')).toBe(SLUG + ':nitrox')
  })

  it('S7-3: the tier schema takes nitro, not default; the choice schema takes default, not turbo', () => {
    expect(routingLaunchTierSchema.safeParse('nitro').success).toBe(true)
    expect(routingLaunchTierSchema.safeParse('default').success).toBe(false)
    expect(routingLaunchChoiceSchema.safeParse('default').success).toBe(true)
    expect(routingLaunchChoiceSchema.safeParse('turbo').success).toBe(false)
  })

  it('S7-4: the launch request: valid and null effort pass; a null or non-UUID credential, tier default, LOW effort and an extra key fail', () => {
    const valid = { model: SLUG, tier: 'balanced', effort: 'low', credentialProfileId: C }
    expect(routingLaunchRequestSchema.safeParse(valid).success).toBe(true)
    expect(routingLaunchRequestSchema.safeParse({ ...valid, effort: null }).success).toBe(true)
    for (const [label, input] of [
      ['null credential', { ...valid, credentialProfileId: null }],
      ['non-UUID credential', { ...valid, credentialProfileId: 'x' }],
      ['tier default', { ...valid, tier: 'default' }],
      ['LOW effort', { ...valid, effort: 'LOW' }],
      ['extra key', { ...valid, extra: 1 }]
    ] as const) {
      expect(routingLaunchRequestSchema.safeParse(input).success, label).toBe(false)
    }
  })

  it('S7-5: Balanced, Nitro and Nitro-allow selections pass, parse back strictly equal and survive a JSON round trip', () => {
    for (const selection of [BALANCED_SELECTION, NITRO_SELECTION, { ...NITRO_SELECTION, provider: null }]) {
      const parsed = routingLaunchSelectionSchema.safeParse(selection)
      expect(parsed.success, selection.tier).toBe(true)
      if (!parsed.success) continue
      expect(parsed.data).toStrictEqual(selection)
      expect(JSON.parse(JSON.stringify(selection))).toStrictEqual(selection)
    }
  })

  it('S7-6: every cross-field disagreement, an extra key, a non-ISO time and an unknown provider key fail', () => {
    const cases: [string, unknown][] = [
      ['Nitro sending the plain slug', { ...NITRO_SELECTION, sentModelId: SLUG }],
      ['Balanced sending :nitro', { ...BALANCED_SELECTION, sentModelId: SLUG + ':nitro' }],
      ['Balanced with no provider', { ...BALANCED_SELECTION, provider: null }],
      ['Balanced with no fetched time', { ...BALANCED_SELECTION, snapshotFetchedAt: null }],
      ['Balanced with endpoints reversed', { ...BALANCED_SELECTION, endpoints: [...BALANCED].reverse() }],
      ['Nitro with endpoints', { ...NITRO_SELECTION, endpoints: ['together'] }],
      ['Nitro with a fetched time', { ...NITRO_SELECTION, snapshotFetchedAt: AT }],
      ['Nitro on a suffixed model', { ...NITRO_SELECTION, model: SLUG + ':nitro', sentModelId: SLUG + ':nitro:nitro' }],
      ['Balanced plus an extra key', { ...BALANCED_SELECTION, extra: 1 }],
      ['Balanced with a non-ISO computedAt', { ...BALANCED_SELECTION, computedAt: '2026-10-02 09:20' }],
      ['Balanced whose provider sorts by price', { ...BALANCED_SELECTION, provider: { ...PROVIDER(BALANCED), sort: 'price' } }]
    ]
    expect(cases).toHaveLength(11)
    for (const [label, input] of cases) expect(routingLaunchSelectionSchema.safeParse(input).success, label).toBe(false)
  })

  it('S7-8 (coordinator, C4): a provider whose shape payloadCore never builds for the tier fails', () => {
    const { allow_fallbacks: _f, ...noFallbackPin } = PROVIDER(BALANCED)
    const { require_parameters: _r, ...noParameterPin } = PROVIDER(BALANCED)
    const { quantizations: _q, ...noQuantizations } = PROVIDER(BALANCED)
    const cases: [string, unknown][] = [
      ['Nitro whose provider pins an order', { ...NITRO_SELECTION, provider: PROVIDER(['deepinfra/fp8']) }],
      ['Nitro with an empty provider', { ...NITRO_SELECTION, provider: {} }],
      ['Balanced allowing fallbacks', { ...BALANCED_SELECTION, provider: noFallbackPin }],
      ['Balanced not requiring parameters', { ...BALANCED_SELECTION, provider: noParameterPin }],
      ['Balanced with no quantizations', { ...BALANCED_SELECTION, provider: noQuantizations }]
    ]
    for (const [label, input] of cases) expect(routingLaunchSelectionSchema.safeParse(input).success, label).toBe(false)
    // Positive control: dataCollection 'allow' drops only data_collection from a ranked provider.
    const { data_collection: _d, ...allowProvider } = PROVIDER(BALANCED)
    expect(routingLaunchSelectionSchema.safeParse({ ...BALANCED_SELECTION, provider: allowProvider }).success).toBe(true)
  })

  it('S7-7: launch preferences: empty and default pass; turbo and a bad key fail with one issue; an extra key fails', () => {
    expect(routingLaunchPreferencesSchema.safeParse({ lastChoiceByModel: {} }).success).toBe(true)
    expect(routingLaunchPreferencesSchema.safeParse({ lastChoiceByModel: { [SLUG]: 'default' } }).success).toBe(true)
    const turbo = routingLaunchPreferencesSchema.safeParse({ lastChoiceByModel: { [SLUG]: 'turbo' } })
    expect(turbo.success).toBe(false)
    expect(turbo.error?.issues).toHaveLength(1)
    const badKey = routingLaunchPreferencesSchema.safeParse({ lastChoiceByModel: { 'bad key': 'balanced' } })
    expect(badKey.success).toBe(false)
    expect(badKey.error?.issues).toHaveLength(1)
    expect(routingLaunchPreferencesSchema.safeParse({ lastChoiceByModel: {}, extra: 1 }).success).toBe(false)
  })
})

describe('Table S8 — Phase 4b: the launch request names a profile', () => {
  const valid = { model: 'deepseek/deepseek-v4.1-flash', tier: 'balanced', effort: 'low', credentialProfileId: '5f0c1a2e-8a3b-4c5d-9e6f-0123456789ab' }
  it('S8-1: both profiles parse exactly and an absent profile stays absent', () => {
    for (const profile of ['helper', 'interactive']) expect(routingLaunchRequestSchema.parse({ ...valid, profile })).toStrictEqual({ ...valid, profile })
    const parsed = routingLaunchRequestSchema.parse(valid)
    expect(parsed).toStrictEqual(valid)
    expect('profile' in parsed).toBe(false)
  })
  it('S8-2: invalid profiles and extra keys are rejected strictly', () => {
    for (const profile of ['team', null, 'Helper', '', 1]) expect(routingLaunchRequestSchema.safeParse({ ...valid, profile }).success).toBe(false)
    expect(routingLaunchRequestSchema.safeParse({ ...valid, profile: 'helper', extra: 1 }).success).toBe(false)
  })
})
