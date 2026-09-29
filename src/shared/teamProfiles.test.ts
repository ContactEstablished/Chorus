import { describe, expect, it } from 'vitest'
import { teamModelSchema, teamMemberProfileSaveSchema } from './teamProfiles'
import { allowedHelperCombination, verifiedHelperCombination } from '../main/adapters/helpers/evidence'

describe('named team member inputs', () => {
  it('accepts exact vendor/model IDs and normalizes only a redundant harness prefix', () => {
    expect(teamModelSchema.parse(' openrouter/z-ai/glm-5.3 ')).toBe('z-ai/glm-5.3')
    expect(teamModelSchema.parse('openrouter/auto')).toBe('openrouter/auto')
    expect(teamModelSchema.parse('vendor/model:free')).toBe('vendor/model:free')
    for (const value of ['model', 'https://openrouter.ai/models', 'vendor/model;run', 'vendor/model\n--flag', 'vendor/model name']) expect(teamModelSchema.safeParse(value).success).toBe(false)
  })
  it('requires exactly one credential source and versioned updates', () => {
    const value = { label: 'Reviewer', model: 'vendor/model', expectedVersion: null, credentialProfileId: null, apiKey: 'fixture-only' }
    expect(teamMemberProfileSaveSchema.safeParse(value).success).toBe(true)
    expect(teamMemberProfileSaveSchema.safeParse({ ...value, apiKey: undefined }).success).toBe(false)
    expect(teamMemberProfileSaveSchema.safeParse({ ...value, credentialProfileId: '00000000-0000-4000-8000-000000000001' }).success).toBe(false)
    expect(teamMemberProfileSaveSchema.safeParse({ ...value, expectedVersion: 1 }).success).toBe(false)
    expect(teamMemberProfileSaveSchema.safeParse({ ...value, unexpected: 'field' }).success).toBe(false)
  })
  it('allows explicitly selected custom models without granting other routes or versions support', () => {
    const input = { id: 'opencode' as const, model: 'vendor/new-model', authMode: 'api_key' as const, baseUrl: 'https://openrouter.ai/api/v1', version: '1.18.31', customModel: true }
    expect(verifiedHelperCombination(input)).toBe(false)
    expect(allowedHelperCombination(input)).toBe(true)
    expect(allowedHelperCombination({ ...input, customModel: false })).toBe(false)
    expect(allowedHelperCombination({ ...input, version: 'unknown' })).toBe(false)
    expect(allowedHelperCombination({ ...input, baseUrl: 'https://other.invalid' })).toBe(false)
    expect(allowedHelperCombination({ ...input, id: 'codex' })).toBe(false)
  })
})
