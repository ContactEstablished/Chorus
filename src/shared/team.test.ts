import { describe, expect, it } from 'vitest'
import { teamAttemptSchema, teamLaunchSchema, teamMemberSchema, teamRunConfigSchema, type TeamAttempt, type TeamMember, type TeamRunConfig } from './team'
import type { RoutingLaunchSelection } from './routing'

const SLUG = 'deepseek/deepseek-v4.1-flash', NITRO = SLUG + ':nitro'
const C = '5f0c1a2e-8a3b-4c5d-9e6f-0123456789ab'
const D = '0b6d2c4e-1f3a-4b5c-8d7e-9f0a1b2c3d4e'
const AT = '2026-10-02T09:20:00Z', FETCHED = '2026-10-02T09:05:00Z'
const NOT_OPENCODE = 'A routing tier applies only to an OpenCode helper on an OpenRouter API key.'
const HELPER: TeamMember = { id: C, label: 'DeepSeek Flash Nitro', harness: 'opencode', authMode: 'api_key', providerId: D, credentialProfileId: C, model: NITRO, effort: 'low', installedVersion: '1.18.34', customModel: true }
const LEAD: TeamMember = { id: D, label: 'Lead', harness: 'claude', authMode: 'subscription', providerId: null, credentialProfileId: null, model: 'sonnet', effort: null, installedVersion: '2.1.278 (Claude Code)' }
const CODEX: TeamMember = { ...LEAD, harness: 'codex', model: 'gpt-6-astra', installedVersion: 'codex-cli 0.155.1' }
const BALANCED: RoutingLaunchSelection = { tier: 'balanced', model: SLUG, sentModelId: SLUG, provider: { order: ['streamlake/fp8', 'venice/fp8', 'gmicloud/fp8'], allow_fallbacks: false, require_parameters: true, quantizations: ['fp8'], data_collection: 'deny' }, endpoints: ['streamlake/fp8', 'venice/fp8', 'gmicloud/fp8'], computedAt: AT, snapshotFetchedAt: FETCHED }
const NITRO_SELECTION: RoutingLaunchSelection = { tier: 'nitro', model: SLUG, sentModelId: NITRO, provider: { data_collection: 'deny' }, endpoints: [], computedAt: AT, snapshotFetchedAt: null }
const ATTEMPT: TeamAttempt = {
  id: C, taskId: D, runId: C, number: 1, memberId: C,
  generation: 1, status: 'preparing', version: 1, baseSha: 'a'.repeat(40), worktreeId: null,
  brief: 'Implement the task.', context: '', acceptance: ['Checks pass.'],
  process: null, descendants: [], cessation: 'not-started', preparationDeadline: AT,
  executionDeadline: null, startedAt: null, endedAt: null, terminalIntent: null, result: null, artifact: null, usage: [], blocker: null
}
const config = (helpers: TeamMember[], lead = LEAD): TeamRunConfig => ({ schemaVersion: 1, baseRevision: 'HEAD', lead, helpers, concurrency: 2, executionMinutes: 30, integrationPolicy: 'lead-integrates' })

describe('Table TS — Phase 4b Team routing contracts', () => {
  it('TS1: tier names are last; pre-4b members round-trip byte for byte', () => {
    for (const routingTier of ['budget', 'balanced', 'fast', 'nitro'] as const) expect(teamMemberSchema.parse({ ...HELPER, routingTier }).routingTier).toBe(routingTier)
    expect(Object.keys(teamMemberSchema.parse({ routingTier: 'nitro', ...HELPER })).at(-1)).toBe('routingTier')
    const old = teamMemberSchema.parse(HELPER)
    expect('routingTier' in old).toBe(false)
    expect(JSON.stringify(old)).toBe(JSON.stringify(HELPER))
    expect(JSON.stringify(teamRunConfigSchema.parse(config([HELPER])))).toBe(JSON.stringify(config([HELPER])))
  })
  it('TS2: invalid tier names fail on the tier field', () => {
    for (const routingTier of ['default', 'turbo', null, '', 'Balanced']) {
      const r = teamMemberSchema.safeParse({ ...HELPER, routingTier })
      expect(r.success).toBe(false)
      if (!r.success) expect(r.error.issues.map(i => i.path)).toEqual([['routingTier']])
    }
  })
  it('TS3: only OpenCode API-key members may carry tiers', () => {
    for (const member of [CODEX, LEAD, { ...LEAD, harness: 'opencode', model: NITRO }]) {
      const r = teamMemberSchema.safeParse({ ...member, routingTier: 'balanced' })
      expect(r.success).toBe(false)
      if (!r.success) expect(r.error.issues.map(i => i.message)).toEqual([NOT_OPENCODE])
    }
  })
  it('TS4: a member rejects a renderer-built selection', () => {
    const r = teamMemberSchema.safeParse({ ...HELPER, routing: BALANCED })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues.map(i => i.code)).toEqual(['unrecognized_keys'])
  })
  it('TS5: runs and launches keep helper tiers and locate refine failures', () => {
    const helpers: TeamMember[] = [{ ...HELPER, routingTier: 'balanced' }, { ...HELPER, id: '11111111-1111-4111-8111-111111111111', model: SLUG, routingTier: 'nitro' }, { ...HELPER, id: '22222222-2222-4222-8222-222222222222' }]
    expect(teamRunConfigSchema.parse(config(helpers)).helpers.map(m => m.routingTier ?? null)).toEqual(['balanced', 'nitro', null])
    const lead = teamRunConfigSchema.safeParse(config([HELPER], { ...LEAD, routingTier: 'balanced' }))
    expect(lead.success).toBe(false)
    if (!lead.success) expect(lead.error.issues.map(i => [i.path, i.message])).toEqual([[['lead'], NOT_OPENCODE]])
    const launch = teamLaunchSchema.safeParse({ projectId: C, clientRequestId: 'launch', config: config([{ ...CODEX, id: C, routingTier: 'fast' }]) })
    expect(launch.success).toBe(false)
    if (!launch.success) expect(launch.error.issues.map(i => [i.path, i.message])).toEqual([[['config', 'helpers', 0], NOT_OPENCODE]])
  })
  it('TS6: attempts keep exact selections last and old attempts byte-identical', () => {
    const old = teamAttemptSchema.parse(ATTEMPT)
    expect('routing' in old).toBe(false)
    expect(JSON.stringify(old)).toBe(JSON.stringify(ATTEMPT))
    for (const routing of [BALANCED, NITRO_SELECTION]) {
      const value = { ...ATTEMPT, routing }, parsed = teamAttemptSchema.parse(value)
      expect(parsed.routing).toStrictEqual(routing)
      expect(Object.keys(parsed).at(-1)).toBe('routing')
      expect(JSON.stringify(parsed)).toBe(JSON.stringify(value))
    }
  })
  it('TS7: attempt selections are strict and agree with the tier', () => {
    for (const [routing, expected] of [[null, 'invalid_type'], [{ ...BALANCED, extra: 1 }, 'unrecognized_keys'], [{ ...BALANCED, sentModelId: NITRO }, 'selection fields disagree with its tier']] as const) {
      const r = teamAttemptSchema.safeParse({ ...ATTEMPT, routing })
      expect(r.success).toBe(false)
      if (!r.success) expect(r.error.issues.map(i => i.code === 'custom' ? i.message : i.code)).toEqual([expected])
    }
  })
})
