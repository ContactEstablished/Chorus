import { afterEach, describe, expect, it, vi } from 'vitest'
import { TeamService } from './teamService'
import { teamFixtureRun, teamFixtureId as id } from './teamTestFixtures'
import { TEAM_LIMITS, type TeamRun } from '../../shared/team'

function fixture() {
  let run: TeamRun
  let complete!: (result: { baseSha: string; head: string; worktreeId: string }) => void
  const workspace = new Promise<{ baseSha: string; head: string; worktreeId: string }>(resolve => { complete = resolve })
  let signal!: AbortSignal
  const launch = vi.fn(async () => ({ sessionId: id(50) }))
  const storage = {
    launchAcknowledgment: () => undefined,
    createRun: (input: TeamRun) => { run = input; return { runId: run.id } },
    getRun: () => run,
    snapshot: () => ({ run, members: [], tasks: [], attempts: [], integrations: [], events: [], lastSequence: 1, hasMoreEvents: false }),
    command: (_operation: unknown, work: (tx: unknown) => unknown) => work({ updateRun: (_version: number, next: TeamRun) => { run = next } })
  }
  const service = new TeamService({ storage: storage as never, executor: {} as never,
    workspace: { prepareRun: async (_run, inputSignal) => {
      signal = inputSignal
      return Promise.race([workspace, new Promise<never>((_resolve, reject) => inputSignal.addEventListener('abort', () => reject(inputSignal.reason), { once: true }))])
    }, prepareAttempt: async () => { throw Error('No tasks') }, validateResult: async () => {}, inspectRecovery: async () => ({ writersStopped: true, ordinaryDirty: false, ambiguousIntegration: false }) },
    credentials: { inspect: () => undefined, resolve: async () => { throw Error('Subscription only') }, route: () => undefined },
    lead: { launch, stopped: async () => true, stop: async () => true }, validateMember: async () => {}, validateProject: () => {} })
  return { service, launch, signal: () => signal, complete: () => complete({ baseSha: 'a'.repeat(40), head: 'a'.repeat(40), worktreeId: id(5) }), run: () => run }
}
afterEach(() => vi.useRealTimers())

describe('Team workspace preparation deadline', () => {
  it('allows an eight-and-a-half-minute checkout to finish before launching the lead', async () => {
    vi.useFakeTimers()
    const f = fixture()
    await f.service.createRun({ projectId: id(4), clientRequestId: 'slow-checkout', config: teamFixtureRun().config }, { role: 'user', principal: 'fixture' })
    await vi.advanceTimersByTimeAsync(510000)
    expect(f.signal().aborted).toBe(false)
    expect(f.launch).not.toHaveBeenCalled()
    f.complete(); await vi.advanceTimersByTimeAsync(0)
    expect(f.launch).toHaveBeenCalledOnce()
    expect(f.run().leadSessionId).toBe(id(50))
  })
  it('ends a genuinely stalled preparation with an actionable retained-workspace error', async () => {
    vi.useFakeTimers()
    const f = fixture()
    await f.service.createRun({ projectId: id(4), clientRequestId: 'stalled-checkout', config: teamFixtureRun().config }, { role: 'user', principal: 'fixture' })
    await vi.advanceTimersByTimeAsync(TEAM_LIMITS.preparationMs)
    expect(f.signal().aborted).toBe(true)
    expect(f.run().status).toBe('blocked')
    expect(f.run().blocker).toContain('timed out after 15 minutes')
    expect(f.launch).not.toHaveBeenCalled()
  })
})
