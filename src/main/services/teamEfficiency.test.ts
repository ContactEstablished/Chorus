import { describe, expect, it } from 'vitest'
import { TeamVerificationService } from './teamVerificationService'
import { teamReviewSchema, teamWaitSchema, teamDelegateManySchema, teamReviewManySchema, type TeamEvent, type TeamTestEvidence } from '../../shared/team'
import { teamFixtureId as id, teamFixtureRun } from './teamTestFixtures'
import { compactTeamChecks } from './teamStatusCore'
import { createRequire } from 'node:module'
const { callDecisionWait } = createRequire(import.meta.url)('../../../resources/teamBridge.cjs')

const sha = 'a'.repeat(40)
const evidence: TeamTestEvidence = { verificationId: id(99), command: 'npm test', outcome: 'passed', exitCode: 0, executionContext: 'integration', testedSha: sha, testSource: 'tracked', provenance: 'independent', sourcePaths: ['package.json'], sourceDiffSha: sha, output: 'long owned log'.repeat(500) }
const review = () => teamReviewSchema.parse({ clientRequestId: 'compact-review', taskId: id(10), attemptId: id(20), integrationId: id(40), phase: 'integrated', reviewedSha: sha, originalResultSha: sha, verifiedHead: sha, decision: 'accept', explanation: 'Inspected both modules against the committed specification.', verificationIds: [id(99)] })
function fixture(payload: Record<string, unknown> = { verificationId: id(99), evidence, cessation: 'confirmed' }) {
  const run = teamFixtureRun(); run.config.verificationProfile = 'npm-project'
  const checks = new TeamVerificationService({ teams: { verificationEvents: (runId: string, verificationId: string) => runId === run.id && verificationId === id(99) ? [{ operation: 'verification-completed', payload }] : [] } as never, assertAuthorized() {}, changed() {}, workspaceId: () => null })
  return { checks, run }
}
describe('compact Team verification references', () => {
  it('hydrates only owned proof and keeps logs out of the request', () => {
    const { checks, run } = fixture(), command = review(), hydrated = checks.resolveReview(run, command)
    expect(hydrated.tests).toEqual([evidence]); expect(hydrated.verificationIds).toBeUndefined()
    expect(command.tests).toEqual([]); expect(command.verificationIds).toEqual([id(99)])
    expect(JSON.stringify(command)).not.toContain('long owned log')
    expect(checks.resolveReview(run, { ...command, taskId: id(11) }).tests).toEqual([evidence])
  })
  it.each(['live', 'unknown', null])('rejects unconfirmed process cessation %s', cessation => {
    const { checks, run } = fixture({ evidence, cessation })
    expect(() => checks.resolveReview(run, review())).toThrow(/stopped check/)
  })
  it.each([{ outcome: 'failed' }, { exitCode: 1 }, { provenance: 'helper-reported' }, { executionContext: 'helper' }, { testedSha: 'b'.repeat(40) }, { verificationId: id(98) }, { command: 'npm ci' }])('rejects invalid proof %j', changed => {
    const { checks, run } = fixture({ evidence: { ...evidence, ...changed }, cessation: 'confirmed' })
    expect(() => checks.resolveReview(run, review())).toThrow(/passing independent/)
  })
  it('rejects another run, a missing ID, an unfinished check and dependency bootstrap', () => {
    const { checks, run } = fixture()
    expect(() => checks.resolveReview({ ...run, id: id(100) }, review())).toThrow()
    expect(() => checks.resolveReview(run, { ...review(), verificationIds: [id(98)] })).toThrow()
    const unfinished = fixture({ evidence, cessation: 'confirmed', bootstrap: true })
    expect(() => unfinished.checks.resolveReview(unfinished.run, review())).toThrow()
  })
  it('preserves legacy inline reviews and defaults artifact evidence to empty', () => {
    const command = review(), { verificationIds: _ids, ...inline } = command
    expect(teamReviewSchema.parse({ ...inline, tests: [evidence] }).tests).toEqual([evidence])
    expect(teamReviewSchema.parse({ ...inline, phase: 'artifact', tests: undefined }).tests).toEqual([])
    expect(() => teamReviewSchema.parse({ ...command, tests: [evidence] })).toThrow(/never both/)
    expect(() => teamReviewSchema.parse({ ...command, verificationIds: [id(99), id(99)] })).toThrow()
  })
  it('projects progress without logs and does not regress running status on process observations', () => {
    const events = [{ operation: 'verification-started', payload: { verificationId: id(99), command: 'npm test', expectedSha: sha } }, { operation: 'verification-process', payload: { verificationId: id(99) } }] as unknown as TeamEvent[]
    expect(compactTeamChecks(events)[0].status).toBe('running')
    events.push({ operation: 'verification-completed', payload: { verificationId: id(99), evidence } } as unknown as TeamEvent)
    expect(compactTeamChecks(events)[0]).toMatchObject({ id: id(99), expectedSha: sha, status: 'passed', exitCode: 0 })
    expect(JSON.stringify(compactTeamChecks(events))).not.toContain(evidence.output)
  })
})

describe('decision waits and bounded batches', () => {
  it('keeps legacy waits bounded and requires explicit decision identities', () => {
    expect(teamWaitSchema.parse({ taskIds: [] }).target).toBe('events')
    expect(() => teamWaitSchema.parse({ timeoutMs: 900000 })).toThrow(/Legacy/)
    expect(() => teamWaitSchema.parse({ target: 'checks' })).toThrow(/Select/)
    expect(() => teamWaitSchema.parse({ target: 'results' })).toThrow(/Select/)
    expect(teamWaitSchema.parse({ target: 'checks', verificationIds: [id(99)], timeoutMs: 900000 }).timeoutMs).toBe(900000)
  })
  it('holds one call through ten minutes of simulated work without returning routine timeouts', async () => {
    let elapsed = 0, calls = 0
    const signal = new AbortController().signal
    const payload = { method: 'tools/call', name: 'team_wait', arguments: { target: 'results', taskIds: [id(10)], afterSequence: 17, timeoutMs: 900000 } }
    const result = await callDecisionWait('endpoint', 'token', payload, signal, async (_e: unknown, _t: unknown, request: any) => {
      expect(request.arguments.timeoutMs).toBeLessThanOrEqual(20000)
      expect(request.arguments.afterSequence).toBe(17)
      calls++; elapsed += 20000
      return { ok: true, result: { wakeReason: elapsed >= 600000 ? 'ready' : 'timeout', lastSequence: calls } }
    }, () => elapsed)
    expect(calls).toBe(30); expect(result.result.wakeReason).toBe('ready')
    expect(result.result.wait).toEqual({ brokerSegments: 30, elapsedMs: 600000 })
  })
  it('returns once at the overall deadline and never extends the final segment', async () => {
    let elapsed = 0
    const result = await callDecisionWait('', '', { arguments: { target: 'finish', timeoutMs: 45001 } }, new AbortController().signal,
      async (_e: unknown, _t: unknown, p: any) => { elapsed += p.arguments.timeoutMs; return { ok: true, result: { wakeReason: 'timeout' } } }, () => elapsed)
    expect(elapsed).toBe(45001); expect(result.result.wait.brokerSegments).toBe(3)
  })
  it('does not retry authority refusal, transport failure or cancellation', async () => {
    const payload = { arguments: { target: 'finish', timeoutMs: 900000 } }
    let calls = 0
    const refused = await callDecisionWait('', '', payload, new AbortController().signal, async () => { calls++; return { ok: false, error: { code: 'LEASE_REVOKED' } } })
    expect(refused.error.code).toBe('LEASE_REVOKED'); expect(calls).toBe(1)
    await expect(callDecisionWait('', '', payload, new AbortController().signal, async () => { throw Error('offline') })).rejects.toThrow('offline')
    const controller = new AbortController()
    await expect(callDecisionWait('', '', payload, controller.signal, async () => { controller.abort(); return { ok: true, result: { wakeReason: 'timeout' } } })).rejects.toThrow('cancelled')
  })
  it('rejects ambiguous batches before any effects', () => {
    const task = { clientRequestId: 'task', memberId: id(3), kind: 'code', title: 'A', brief: 'Implement the assigned section.', acceptance: ['SPEC.md contracts pass.'], paths: ['a.cjs'], references: ['SPEC.md'] }
    expect(teamDelegateManySchema.parse({ clientRequestId: 'batch', tasks: [task] }).tasks).toHaveLength(1)
    expect(() => teamDelegateManySchema.parse({ clientRequestId: 'batch', tasks: [task, task] })).toThrow(/unique/)
    expect(() => teamDelegateManySchema.parse({ clientRequestId: 'batch', tasks: Array.from({ length: 9 }, (_, i) => ({ ...task, clientRequestId: `task-${i}` })) })).toThrow()
    const first = review(), second = { ...review(), clientRequestId: 'review-b', taskId: id(11) }
    expect(teamReviewManySchema.parse({ clientRequestId: 'batch', reviews: [first, second] }).reviews).toHaveLength(2)
    expect(() => teamReviewManySchema.parse({ clientRequestId: 'batch', reviews: [first, { ...second, verifiedHead: 'b'.repeat(40) }] })).toThrow(/one phase/)
  })
})
