import { describe, expect, it } from 'vitest'
import { teamAttemptSchema, teamDelegateSchema, teamMcpToolDescriptors, teamReviewSchema, teamRunConfigSchema } from '../../shared/team'
import { assertDispatchFence, assertLeadAuthority, assertIntegrationApply, approvalMatches, reserveNextAttempt, failPreparation, fitUtf8, requestAttemptTermination, settleAttempt, reviseTask, holdsSlot, transitionRun, type TeamLease } from './teamCore'
import { teamFixtureRun, teamFixtureTask, teamFixtureIntegration, teamFixtureId as id, TEAM_FIXTURE_TIME as now } from './teamTestFixtures'
const lease = (): TeamLease => ({ runId: id(1), generation: 1, epoch: 'epoch-one', mode: 'normal', credentials: [], leadCredentialId: null, revoked: false })
const reserve = () => reserveNextAttempt(teamFixtureRun(), [teamFixtureTask()], [], id(20), now)!

describe('strict common team contracts', () => {
  it('fits non-ASCII blocker text to its UTF-8 byte limit without splitting a character', () => {
    const reason = fitUtf8('\u8def\u5f84'.repeat(1500), 3500)
    expect(new TextEncoder().encode(reason).byteLength).toBeLessThanOrEqual(3500)
    expect(reason).not.toContain('\uFFFD')
    expect(reason.length).toBe(1166)
    expect(fitUtf8('ascii', 3500)).toBe('ascii')
    const run = teamFixtureRun(), first = reserve()
    const failed = failPreparation(run, first.task, first.attempt, now, `${reason} This attempt was consumed.`)
    expect(() => teamAttemptSchema.parse(failed.attempt)).not.toThrow()
  })
  it('preserves instruction bytes while normalizing identities/dependency sets', () => {
    const command = teamFixtureTask().command
    const parsed = teamDelegateSchema.parse({ ...command, title: ' title ', dependsOn: [id(8), id(7), id(8)] })
    expect(parsed.title).toBe('title'); expect(parsed.brief).toBe(command.brief); expect(parsed.dependsOn).toEqual([id(7), id(8)])
    expect(() => teamDelegateSchema.parse({ ...command, actor: 'user' })).toThrow()
    expect(() => teamDelegateSchema.parse({ ...command, brief: '🟢'.repeat(16385) })).toThrow()
    expect(() => teamDelegateSchema.parse({ ...command, dependsOn: Array(33).fill(id(7)) })).toThrow()
  })
  it('enforces defaults and requires integrated verification identities', () => {
    const config = teamFixtureRun().config
    expect(config).toMatchObject({ concurrency: 2, executionMinutes: 30, integrationPolicy: 'lead-integrates' })
    expect(() => teamRunConfigSchema.parse({ ...config, concurrency: 9 })).toThrow()
    expect(() => teamRunConfigSchema.parse({ ...config, helpers: [config.lead] })).toThrow()
    expect(() => teamReviewSchema.parse({ clientRequestId: 'r', taskId: id(10), attemptId: id(20), phase: 'integrated', decision: 'accept', explanation: 'Passed', tests: [] })).toThrow()
    expect(teamMcpToolDescriptors().map(t => t.name)).toHaveLength(13)
  })
})
describe('scheduler reservations and process outcomes', () => {
  it('runs independent deliverables together and defers overlapping Windows paths until integration finishes', () => {
    const run = teamFixtureRun(), firstTask = teamFixtureTask(), second = teamFixtureTask(11), third = teamFixtureTask(12)
    firstTask.command.paths = ['Geometry/practice.html', '_build/practice/']
    second.command.paths = ['geometry\\PRACTICE.html']
    third.command.paths = ['Geometry/cheat-sheet.html', '_build/cheat-sheet/']
    const first = reserveNextAttempt(run, [firstTask], [], id(20), now)!
    expect(reserveNextAttempt(run, [first.task, second, third], [first.attempt], id(21), now)?.task.id).toBe(third.id)
    const ended = { ...first.attempt, status: 'succeeded' as const, cessation: 'confirmed' as const }
    expect(reserveNextAttempt(run, [{ ...first.task, status: 'awaiting-review' }, second], [ended], id(22), now)).toBeNull()
    expect(reserveNextAttempt(run, [{ ...first.task, status: 'completed' }, second], [ended], id(22), now)?.task.id).toBe(second.id)
    second.command.paths = ['_build/practice/figures.svg']
    expect(reserveNextAttempt(run, [first.task, second], [first.attempt], id(23), now)).toBeNull()
    second.command.paths = []
    expect(reserveNextAttempt(run, [first.task, second], [first.attempt], id(23), now)).toBeNull()
    second.command.paths = ['Geometry/*.html']
    expect(reserveNextAttempt(run, [first.task, second], [first.attempt], id(23), now)).toBeNull()
  })
  it('reserves slots before preparation and counts failed preparation', () => {
    const run = teamFixtureRun(), first = reserve(), secondTask = teamFixtureTask(11)
    run.config.concurrency = 2
    const second = reserveNextAttempt(run, [first.task, secondTask], [first.attempt], id(21), now)!
    expect(reserveNextAttempt(run, [first.task, second.task, teamFixtureTask(12)], [first.attempt, second.attempt], id(22), now)).toBeNull()
    const failed = failPreparation(run, first.task, first.attempt, now, 'Git failed')
    expect(failed.task.attemptCount).toBe(1); expect(holdsSlot(failed.attempt)).toBe(false)
    const revised = reviseTask(run, failed.task, [failed.attempt], id(3), 'Try again.', now)
    expect(reserveNextAttempt(run, [revised], [failed.attempt], id(23), now)?.attempt.number).toBe(2)
    expect(() => reviseTask(run, { ...failed.task, attemptCount: 3 }, [failed.attempt], id(3), 'Again', now)).toThrow(/exhausted/)
  })
  it('waits for accepted dependencies and never uses a running/awaiting-review result', () => {
    const dependency = teamFixtureTask(11), child = teamFixtureTask()
    child.command.dependsOn = [dependency.id]
    for (const status of ['running', 'awaiting-review', 'integrating', 'failed'] as const) expect(reserveNextAttempt(teamFixtureRun(), [child, { ...dependency, status }], [], id(20), now)).toBeNull()
    expect(reserveNextAttempt(teamFixtureRun(), [child, { ...dependency, status: 'completed' }], [], id(20), now)?.task.id).toBe(child.id)
  })
  it('keeps cancellation intent and unknown process ownership despite a racing success', () => {
    const first = reserve(), cancelled = requestAttemptTermination(first.attempt, 'cancelled')
    const exit = { attemptId: id(20), generation: 1, exitCode: 0, cessation: 'unknown' as const, result: { summary: 'Done', isError: false, tests: [] }, permissionBlocked: false, protocolError: false, now }
    const settled = settleAttempt(teamFixtureRun(), first.task, cancelled, exit)
    expect(settled.attempt.status).toBe('cancelled'); expect(settled.task.status).toBe('blocked'); expect(holdsSlot(settled.attempt)).toBe(true)
    expect(settleAttempt(teamFixtureRun(), settled.task, settled.attempt, exit).changed).toBe(false)
  })
  it('does not let an old generation release or alter a replacement task', () => {
    const first = reserve(), replacement = { ...first.task, currentAttemptId: id(21), version: 7 }
    const settled = settleAttempt({ ...teamFixtureRun(), generation: 2 }, replacement, first.attempt, { attemptId: id(20), generation: 1, exitCode: 0, cessation: 'confirmed', result: { summary: 'Late', isError: false, tests: [] }, permissionBlocked: false, protocolError: false, now })
    expect(settled.task).toBe(replacement)
    expect(failPreparation({ ...teamFixtureRun(), generation: 2 }, replacement, first.attempt, now, 'Late preparation').task).toBe(replacement)
  })
})
describe('authority, lifecycle and approval identity', () => {
  it('denies mutations while pausing/recovering and rejects stale tokens', () => {
    const actor = { role: 'lead' as const, runId: id(1), generation: 1, epoch: 'epoch-one' }
    for (const status of ['pausing', 'recovering'] as const) {
      assertLeadAuthority({ ...teamFixtureRun(), status }, lease(), actor, 'team_status')
      for (const operation of ['team_delegate', 'team_review', 'team_cancel', 'team_integrate'] as const) expect(() => assertLeadAuthority({ ...teamFixtureRun(), status }, lease(), actor, operation)).toThrow(/inspection/)
    }
    expect(() => assertLeadAuthority(teamFixtureRun(), { ...lease(), epoch: 'new' }, actor, 'team_wait')).toThrow()
    expect(() => assertDispatchFence({ ...teamFixtureRun(), status: 'pausing' }, lease(), { generation: 1, epoch: 'epoch-one' })).toThrow()
  })
  it('fences credential rotation, route changes, lease revocation and subscription fallback', () => {
    const credential = { credentialId: id(50), fingerprint: 'original', providerId: id(51), authMode: 'api_key', routeIdentity: 'route' }
    const selected = { ...lease(), credentials: [credential] }, expected = { generation: 1, epoch: 'epoch-one', credential }
    assertDispatchFence(teamFixtureRun(), selected, expected, credential)
    for (const changed of [{ ...credential, fingerprint: 'rotated' }, { ...credential, routeIdentity: 'other' }, undefined]) expect(() => assertDispatchFence(teamFixtureRun(), selected, expected, changed)).toThrow()
    expect(() => assertDispatchFence(teamFixtureRun(), { ...selected, revoked: true }, expected, credential)).toThrow()
    expect(() => assertDispatchFence(teamFixtureRun(), selected, { generation: 1, epoch: 'epoch-one' }, credential)).toThrow()
  })
  it('requires explicit stopped-writer evidence for recovery/resume and keeps boot passive', () => {
    const run = teamFixtureRun(), paused = transitionRun(run, 'boot', { now })
    expect(paused.status).toBe('paused'); expect(paused.generation).toBe(run.generation)
    expect(() => transitionRun(paused, 'resume', { now, priorLeadStopped: true })).toThrow()
    const resumed = transitionRun(paused, 'resume', { now, priorLeadStopped: true, writersStopped: true })
    expect(resumed.generation).toBe(2); expect(resumed.status).toBe('preparing')
    expect(transitionRun(resumed, 'activate', { now, bridgeReady: true }).generation).toBe(2)
    expect(() => transitionRun(paused, 'recover', { now, priorLeadStopped: true, writersStopped: true, ordinaryDirty: true, ambiguousIntegration: true })).toThrow()
  })
  it('binds approval to exact prepared content while allowing the decision version increment', () => {
    const run = teamFixtureRun(), integration = teamFixtureIntegration()
    const binding = { integrationId: integration.id, preparationId: integration.preparationId, artifactSha: integration.artifactSha, integrationHead: integration.expectedHead, resultSha: integration.resultSha!, policyVersion: 1 }
    const approved = { ...integration, status: 'approved' as const, version: 2, approval: { binding, principal: 'renderer', decision: 'approve' as const, at: now } }
    expect(approvalMatches(binding, approved)).toBe(true); assertIntegrationApply(run, approved, integration.expectedHead, true)
    expect(approvalMatches(binding, { ...approved, resultSha: 'd'.repeat(40) })).toBe(false)
    expect(() => assertIntegrationApply(run, approved, integration.expectedHead, false)).toThrow()
    expect(() => assertIntegrationApply(run, integration, integration.expectedHead, true)).not.toThrow()
    run.config.integrationPolicy = 'ask'
    expect(() => assertIntegrationApply(run, { ...integration, status: 'awaiting-approval' }, integration.expectedHead, true)).not.toThrow()
    expect(() => assertIntegrationApply(run, { ...integration, preparedReviewId: null }, integration.expectedHead, true)).toThrow()
  })
})
