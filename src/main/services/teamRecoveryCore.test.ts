import { describe, expect, it } from 'vitest'
import { recoveryDisposition, interruptedAtBoot } from './teamRecoveryCore'
import { teamFixtureRun, teamFixtureTask, teamFixtureId, TEAM_FIXTURE_TIME } from './teamTestFixtures'
import { reserveNextAttempt } from './teamCore'

describe('Team boot recovery decisions', () => {
  it('pauses clean runs and directs ordinary dirty work to explicit Recover', () => {
    expect(recoveryDisposition(teamFixtureRun(), { writersStopped: true, ordinaryDirty: false, blockers: [] })).toEqual({ status: 'paused', blocker: null })
    expect(recoveryDisposition(teamFixtureRun(), { writersStopped: true, ordinaryDirty: true, blockers: [] })).toMatchObject({ status: 'paused', blocker: expect.stringContaining('Recover') })
  })
  it('blocks uncertain writers and ambiguous Git evidence, preserving terminal history', () => {
    expect(recoveryDisposition(teamFixtureRun(), { writersStopped: false, ordinaryDirty: true, blockers: [] }).status).toBe('blocked')
    expect(recoveryDisposition(teamFixtureRun(), { writersStopped: true, ordinaryDirty: false, blockers: ['Missing ref.'] })).toEqual({ status: 'blocked', blocker: 'Missing ref.' })
    expect(recoveryDisposition({ ...teamFixtureRun(), status: 'completed' }, { writersStopped: true, ordinaryDirty: false, blockers: [] }).status).toBe('completed')
  })
  it('retains attempt identity/count and interrupts without inventing a result', () => {
    const attempt = reserveNextAttempt(teamFixtureRun(), [teamFixtureTask()], [], teamFixtureId(20), TEAM_FIXTURE_TIME)!.attempt
    const interrupted = interruptedAtBoot(attempt, false, TEAM_FIXTURE_TIME)
    expect(interrupted).toMatchObject({ id: attempt.id, number: 1, status: 'interrupted', cessation: 'unknown', result: null, artifact: null })
    const confirmed = interruptedAtBoot(interrupted, true, TEAM_FIXTURE_TIME)
    expect(confirmed.cessation).toBe('confirmed')
    expect(interruptedAtBoot(confirmed, true, TEAM_FIXTURE_TIME)).toBe(confirmed)
  })
})
