import { describe, expect, it, vi } from 'vitest'
import { teamFixtureRun } from '../../../main/services/teamTestFixtures'
import type { TeamEvent, TeamSnapshot } from '../../../shared/team'
import { teamPreparationMessage, waitForTeamLead } from './teamLaunch'

function snapshot(operations: string[], options: { session?: boolean; after?: number; more?: boolean; status?: TeamSnapshot['run']['status'] } = {}): TeamSnapshot {
  return { run: { ...teamFixtureRun(), status: options.status ?? 'preparing', leadSessionId: options.session ? 'lead-session' : null }, members: [], tasks: [], attempts: [], integrations: [],
    events: operations.map((operation, index) => ({ operation, sequence: (options.after ?? 0) + index + 1, generation: 1, payload: operation === 'verification-started' ? { command: 'npm ci' } : {} }) as TeamEvent), lastSequence: (options.after ?? 0) + operations.length, hasMoreEvents: options.more ?? false }
}
const waitOptions = (refresh: (runId: string, afterSequence: number) => Promise<TeamSnapshot>) => ({ runId: 'run', refresh, alive: () => true, progress: vi.fn(), delay: vi.fn(async () => {}) })

describe('Team launch preparation', () => {
  it('waits through eight minutes of checkout instead of reporting a CLI trust prompt', async () => {
    let elapsed = 0
    const refresh = vi.fn(async () => elapsed < 510000 ? snapshot(elapsed === 0 ? ['workspace-reserved'] : []) : snapshot(['lead-started'], { session: true }))
    const options = waitOptions(refresh)
    options.delay = vi.fn(async () => { elapsed += 30000 })
    expect(await waitForTeamLead(options)).toBe(true)
    expect(elapsed).toBe(510000)
    expect(options.progress.mock.calls.flat().filter(v => typeof v === 'string').join(' ')).not.toContain('trust')
    expect(options.progress.mock.calls[1][1]).toContain('Large projects')
  })
  it('opens a lead even when lead-started is on a later page of preparation history', async () => {
    const refresh = vi.fn().mockResolvedValueOnce(snapshot(Array(200).fill('workspace-progress'), { session: true, more: true }))
      .mockResolvedValueOnce(snapshot(['lead-started'], { session: true, after: 200 }))
    const options = waitOptions(refresh)
    expect(await waitForTeamLead(options)).toBe(true)
    expect(refresh.mock.calls).toEqual([['run', 0], ['run', 200]])
    expect(options.delay).not.toHaveBeenCalled()
  })
  it('does not attach the spawn-intent session before its process starts', async () => {
    const refresh = vi.fn().mockResolvedValueOnce(snapshot(['lead-spawn-intent'], { session: true }))
      .mockResolvedValueOnce(snapshot(['lead-started'], { session: true, after: 1 }))
    const options = waitOptions(refresh)
    expect(await waitForTeamLead(options)).toBe(true)
    expect(options.delay).toHaveBeenCalledOnce()
  })
  it('uses workspace and dependency stages instead of asking for an unavailable terminal', () => {
    expect(teamPreparationMessage(snapshot(['workspace-reserved']))).toContain('Git workspace')
    expect(teamPreparationMessage(snapshot(['workspace-completed', 'verification-started']))).toContain('Installing dependencies')
    const progress = snapshot(['workspace-progress']); progress.events[0].payload.message = 'Updating files: 65%'
    expect(teamPreparationMessage(progress)).toContain('65%')
  })
  it('surfaces the actual preparation error and exits cleanly on Stop or detach', async () => {
    const failed = snapshot([], { status: 'blocked' }); failed.run.blocker = 'Git checkout failed: filename too long.'
    await expect(waitForTeamLead(waitOptions(vi.fn().mockResolvedValue(failed)))).rejects.toThrow('filename too long')
    expect(await waitForTeamLead(waitOptions(vi.fn().mockResolvedValue(snapshot([], { status: 'stopping' }))))).toBe(false)
    const detached = waitOptions(vi.fn()); detached.alive = () => false
    expect(await waitForTeamLead(detached)).toBe(false)
    expect(detached.refresh).not.toHaveBeenCalled()
  })
})
