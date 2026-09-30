import { describe, expect, it } from 'vitest'
import { assertArtifactScope } from './teamCore'
import { compactTeamStatus } from './teamStatusCore'
import { teamFixtureRun, teamFixtureTask, teamFixtureId } from './teamTestFixtures'
import { teamRunConfigSchema, teamToolSchemas, type TeamSnapshot } from '../../shared/team'
import { allowedLeadCombination, allowedHelperCombination, verifiedHelperCombination } from '../adapters/helpers/evidence'
import { helperCheckCommands, teamCheckSpec } from './teamChecks'
import { TeamVerificationService } from './teamVerificationService'
import { canonicalTeamPayload } from './teamStorage'
import type { TeamTestEvidence } from '../../shared/team'

describe('Team dependability contracts', () => {
  it('enforces changed paths, including deletions and both sides of renames', () => {
    expect(() => assertArtifactScope(['src/a.ts'], ['src/a.ts', 'src/b.ts'])).toThrow(/outside/)
    expect(() => assertArtifactScope(['src/new.ts'], ['src/old.ts', 'src/new.ts'])).toThrow(/old.ts/)
    expect(() => assertArtifactScope(['src'], ['SRC\\a.ts', 'src/tests/test.ts'])).not.toThrow()
    expect(() => assertArtifactScope(['src'], ['src-other/file.ts'])).toThrow()
    expect(() => assertArtifactScope([], ['legacy.txt'])).not.toThrow()
  })
  it('keeps historical launch records unchanged while exposing explicit new policies', () => {
    const old = teamRunConfigSchema.parse(teamFixtureRun().config)
    expect(old.publicationPolicy).toBeUndefined(); expect(old.verificationProfile).toBeUndefined()
    expect(old.leadContext).toBeUndefined()
    expect(teamRunConfigSchema.parse({ ...old, publicationPolicy: 'auto-clean', verificationProfile: 'npm-project' }).publicationPolicy).toBe('auto-clean')
    expect(Object.keys(teamToolSchemas)).toEqual(expect.arrayContaining(['team_detail', 'team_verify', 'team_finish']))
  })
  it('accepts recorded evidence despite database JSON key order and rejects fabricated results', () => {
    const test: TeamTestEvidence = { verificationId: teamFixtureId(99), command: 'npm test', outcome: 'passed', exitCode: 0, executionContext: 'integration', testedSha: 'a'.repeat(40), testSource: 'tracked', provenance: 'independent', sourcePaths: ['package.json'], sourceDiffSha: 'a'.repeat(40), output: 'Independent acceptance passed' }
    const checks = new TeamVerificationService({ teams: {} as never, assertAuthorized() {}, changed() {}, workspaceId: () => null })
    checks.evidence = () => JSON.parse(canonicalTeamPayload(test))
    const run = teamFixtureRun(); run.config.verificationProfile = 'npm-project'
    expect(() => checks.assertEvidence(run, [test])).not.toThrow()
    expect(() => checks.assertEvidence(run, [{ ...test, output: 'Invented result' }])).toThrow(/exact evidence/)
    expect(() => checks.assertEvidence(run, [{ ...test, testedSha: 'b'.repeat(40) }])).toThrow()
  })
  it('separates Opus lead eligibility and explicit pilot versions from historical verification', () => {
    const lead = { id: 'claude' as const, version: '2.1.285 (Claude Code)', model: 'claude-opus-5-5', authMode: 'subscription' as const }
    expect(allowedLeadCombination(lead)).toBe(true)
    expect(verifiedHelperCombination(lead)).toBe(false)
    expect(allowedLeadCombination({ ...lead, version: '9.99.99' })).toBe(false)
    expect(allowedHelperCombination({ id: 'opencode', version: '1.18.33', model: 'deepseek/deepseek-v4.1-flash', authMode: 'api_key', baseUrl: 'https://openrouter.ai/api/v1' })).toBe(true)
    expect(allowedHelperCombination({ id: 'opencode', version: '1.18.33', model: 'deepseek/deepseek-v4.1-flash', authMode: 'api_key', baseUrl: 'https://example.com' })).toBe(false)
  })
  it('makes compact lead state independent of briefs and noisy history', () => {
    const task = teamFixtureTask(); task.command.brief = 'private-long-brief'.repeat(1000)
    const snapshot: TeamSnapshot = { run: teamFixtureRun(), members: [], tasks: [task, teamFixtureTask(11)], attempts: [], integrations: [], events: [], lastSequence: 999, hasMoreEvents: false }
    const compact = compactTeamStatus(snapshot, 2, [teamFixtureId(10)])
    expect(compact.lastSequence).toBe(2); expect(compact.tasks).toHaveLength(1)
    expect(JSON.stringify(compact)).not.toContain('private-long-brief')
    expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(snapshot).length / 10)
  })
  it('restricts helper checks to the selected project profile and fixed commands', () => {
    expect(helperCheckCommands('npm-project')).toEqual(['node --test', 'npm test', 'npm run typecheck', 'npm run build'])
    expect(helperCheckCommands(undefined)).toEqual(['node --test'])
    expect(teamCheckSpec('npm-project', 'test').args).toEqual(['test'])
    expect(() => teamCheckSpec('node-test', 'build')).toThrow(/npm/)
  })
})
