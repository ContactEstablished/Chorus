import { describe, expect, it } from 'vitest'
import type { TeamReview } from '../../shared/team'
import { reserveNextAttempt } from './teamCore'
import { acceptPreparedReview, assertCaptureReady, beginPromotion, classifyPromotionRecovery, integrationBinding, recordIntegrationDecision, restoredApprovalUsable, verifyIntegratedReview, type TeamWorkspaceObservation } from './teamWorkspaceCore'
import { teamFixtureRun, teamFixtureTask, teamFixtureIntegration, teamFixtureId as id, TEAM_FIXTURE_TIME as now } from './teamTestFixtures'
const observation = (): TeamWorkspaceObservation => ({ head: 'a'.repeat(40), clean: true, expectedRepository: true, expectedBranch: true, writersStopped: true, objectsPresent: true })
const preparedReview = (): TeamReview => ({ clientRequestId: 'prepared-review', taskId: id(10), attemptId: id(20), integrationId: id(40), phase: 'prepared', reviewedSha: 'c'.repeat(40), decision: 'accept', explanation: 'Inspected exact staged change.', tests: [] })

describe('workspace authority and exact-content decisions', () => {
  it('requires the stopped current attempt and rejects committed analysis changes', () => {
    const run = teamFixtureRun(), reserved = reserveNextAttempt(run, [teamFixtureTask()], [], id(20), now)!
    const attempt = { ...reserved.attempt, status: 'succeeded' as const, cessation: 'confirmed' as const }
    expect(() => assertCaptureReady(run, reserved.task, attempt, observation(), true)).not.toThrow()
    expect(() => assertCaptureReady(run, reserved.task, attempt, { ...observation(), writersStopped: false }, true)).toThrow(/cessation/)
    const analysis = { ...reserved.task, command: { ...reserved.task.command, kind: 'analysis' as const } }
    expect(() => assertCaptureReady(run, analysis, attempt, { ...observation(), head: 'b'.repeat(40) }, true)).toThrow(/Analysis changed/)
    expect(() => assertCaptureReady(run, analysis, attempt, { ...observation(), clean: false }, true)).toThrow(/Analysis changed/)
  })
  it('retains historical approval bindings without gating lead integration', () => {
    const run = teamFixtureRun(), integration = teamFixtureIntegration(); run.config.integrationPolicy = 'ask'
    const reviewed = acceptPreparedReview(run, integration, preparedReview(), id(51), now)
    expect(reviewed.status).toBe('prepared')
    const approved = recordIntegrationDecision(run, { ...reviewed, status: 'awaiting-approval' }, reviewed.version, 'renderer-user', 'approve', now)
    expect(approved.version).toBe(reviewed.version + 1)
    expect(approved.approval?.binding).toEqual(integrationBinding(integration))
    expect(beginPromotion(run, approved, observation(), now).status).toBe('applying')
    expect(restoredApprovalUsable(run, approved, observation())).toBe(true)
    for (const change of [{ resultSha: 'd'.repeat(40) }, { preparationId: id(52) }, { artifactSha: 'd'.repeat(40) }, { expectedHead: 'd'.repeat(40) }, { policyVersion: 2 }]) {
      expect(restoredApprovalUsable(run, { ...approved, ...change }, observation())).toBe(false)
    }
    expect(() => recordIntegrationDecision(run, { ...reviewed, status: 'awaiting-approval' }, reviewed.version - 1, 'renderer-user', 'approve', now)).toThrow(/version changed/)
    expect(() => beginPromotion(run, reviewed, observation(), now)).not.toThrow()
  })
  it('requires prepared acceptance under lead-integrates and preserves rejected results', () => {
    const run = teamFixtureRun(); run.config.integrationPolicy = 'lead-integrates'
    const reviewed = acceptPreparedReview(run, teamFixtureIntegration(), preparedReview(), id(51), now)
    expect(beginPromotion(run, reviewed, observation(), now).status).toBe('applying')
    expect(() => beginPromotion(run, { ...reviewed, preparedReviewId: null }, observation(), now)).toThrow(/accepted prepared/)
    expect(acceptPreparedReview(run, reviewed, { ...preparedReview(), decision: 'revise' }, id(52), now)).toMatchObject({ status: 'rejected', resultSha: reviewed.resultSha, approval: null })
    expect(() => beginPromotion(run, reviewed, { ...observation(), clean: false }, now)).toThrow(/changed/)
    expect(() => beginPromotion(run, reviewed, { ...observation(), expectedBranch: false }, now)).toThrow(/expected repository/)
  })
})

describe('promotion evidence recovery', () => {
  it('classifies only exact clean pre/post states without replay', () => {
    const integration = { ...teamFixtureIntegration(), status: 'applying' as const }
    expect(classifyPromotionRecovery(integration, observation())).toMatchObject({ status: 'interrupted', action: 'retain' })
    const applied = { ...observation(), head: integration.resultSha }
    expect(classifyPromotionRecovery(integration, applied)).toMatchObject({ status: 'applied', action: 'record-applied' })
    expect(classifyPromotionRecovery({ ...integration, status: 'applied' }, applied)).toEqual(classifyPromotionRecovery(integration, applied))
    expect(classifyPromotionRecovery({ ...integration, status: 'applied' }, observation()).status).toBe('recovery-required')
    for (const change of [{ head: 'd'.repeat(40) }, { clean: false }, { writersStopped: false }, { objectsPresent: false }, { expectedRepository: false }, { expectedBranch: false }]) expect(classifyPromotionRecovery(integration, { ...applied, ...change }).status).toBe('recovery-required')
  })
})

describe('integrated verification provenance', () => {
  function fixture() {
    const integration = { ...teamFixtureIntegration(), status: 'applied' as const }
    const task = { ...teamFixtureTask(), currentAttemptId: integration.attemptId, status: 'awaiting-review' as const }
    const observed = { ...observation(), head: integration.resultSha }
    const review: TeamReview = { ...preparedReview(), phase: 'integrated', originalResultSha: integration.resultSha!, verifiedHead: integration.resultSha!, tests: [{ command: 'node --test', outcome: 'passed', exitCode: 0, executionContext: 'integration', testedSha: integration.resultSha, testSource: 'tracked', sourcePaths: ['value.txt'], provenance: 'lead-verified', output: 'Passed' }] }
    return { integration, task, observed, review }
  }
  it('releases dependents only after exact revision and passing independently observed commands', () => {
    const { integration, task, observed, review } = fixture(), run = teamFixtureRun()
    expect(verifyIntegratedReview(run, task, integration, review, observed, true, now).status).toBe('completed')
    for (const change of [{ provenance: 'helper-reported' as const }, { testSource: 'unknown' as const }, { testedSha: 'd'.repeat(40) }, { executionContext: 'helper' as const }]) expect(() => verifyIntegratedReview(run, task, integration, { ...review, tests: [{ ...review.tests[0], ...change }] }, observed, true, now)).toThrow(/Final evidence/)
    expect(() => verifyIntegratedReview(run, task, integration, review, observed, false, now)).toThrow(/containing/)
    expect(() => verifyIntegratedReview(run, task, integration, review, { ...observed, head: 'd'.repeat(40) }, true, now)).toThrow(/current verified HEAD/)
    const failed = { ...review, tests: [{ ...review.tests[0], outcome: 'failed' as const, exitCode: 1 }] }
    expect(() => verifyIntegratedReview(run, task, integration, failed, observed, true, now)).toThrow(/passing commands/)
    expect(verifyIntegratedReview(run, task, integration, { ...failed, decision: 'revise' }, observed, true, now)).toMatchObject({ status: 'needs-revision', currentAttemptId: integration.attemptId })
  })
})
