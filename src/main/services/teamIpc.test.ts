import { beforeEach, describe, expect, it, vi } from 'vitest'
const handlers = vi.hoisted(() => new Map<string, (event: unknown, input: unknown) => Promise<unknown>>())
const windowLookup = vi.hoisted(() => vi.fn(() => ({ isDestroyed: () => false })))
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, handler: (event: unknown, input: unknown) => Promise<unknown>) => handlers.set(name, handler) }, BrowserWindow: { fromWebContents: windowLookup, getAllWindows: () => [] } }))
import { registerTeamIpc } from './teamIpc'
import { teamFixtureRun, teamFixtureId } from './teamTestFixtures'
import type { TeamRuntime } from './teamRuntime'
import type { StorageService } from './storage'
const frame = {}, event = { sender: { id: 12, mainFrame: frame }, senderFrame: frame }
beforeEach(() => { handlers.clear(); windowLookup.mockReturnValue({ isDestroyed: () => false }) })
function setup() {
  const run = teamFixtureRun(), service = { subscribe: vi.fn(), getSnapshot: vi.fn((_id: string) => ({ run })), createRun: vi.fn(async () => ({ runId: run.id })), lifecycle: vi.fn(async () => ({})), decideIntegration: vi.fn(async () => ({})) }
  const runtime = { service, memberProfiles: { list: vi.fn(() => ({ profiles: [], credentials: [] })), save: vi.fn(() => ({ profiles: [], credentials: [] })), delete: vi.fn(() => ({ profiles: [], credentials: [] })) }, teams: { getRun: () => run, listRunIds: vi.fn(() => [run.id]) }, workspace: { inspectRecovery: vi.fn(async () => ({ writersStopped: false, ordinaryDirty: false, ambiguousIntegration: false })) }, stopLead: vi.fn(async () => true) }
  registerTeamIpc(runtime as unknown as TeamRuntime, { getProjectById: () => ({ id: run.projectId }) } as unknown as StorageService)
  return { run, service, runtime }
}
describe('Team IPC authority', () => {
  it('retires the old approval endpoint without making an integration decision', async () => {
    const { run, service } = setup()
    expect(await handlers.get('team:decide-integration')!(event, { runId: run.id, integrationId: teamFixtureId(40), expectedVersion: 1, clientRequestId: 'obsolete-decision', decision: 'approve' })).toMatchObject({ ok: false, code: 'APPROVAL_REMOVED' })
    expect(service.decideIntegration).not.toHaveBeenCalled()
  })
  it('validates member writes and refuses subframes without reflecting write-only keys', async () => {
    const { runtime } = setup(), input = { expectedVersion: null, label: 'Reviewer', model: 'vendor/model', credentialProfileId: null, apiKey: 'fixture-write-only', instructions: '' }
    expect(await handlers.get('team:member-save')!(event, input)).toEqual({ ok: true, value: { profiles: [], credentials: [] } })
    expect(runtime.memberProfiles.save).toHaveBeenCalledWith(input)
    expect(await handlers.get('team:member-save')!({ ...event, senderFrame: {} }, input)).toMatchObject({ ok: false, code: 'UNAUTHORIZED' })
    expect(await handlers.get('team:member-save')!(event, { ...input, providerUrl: 'https://other.invalid' })).toMatchObject({ ok: false, code: 'INVALID_REQUEST' })
    expect(runtime.memberProfiles.save).toHaveBeenCalledTimes(1)
    runtime.memberProfiles.save.mockImplementation(() => { throw Error(input.apiKey) })
    const failure = await handlers.get('team:member-save')!(event, input)
    expect(JSON.stringify(failure)).not.toContain(input.apiKey)
    expect(failure).toMatchObject({ ok: false, code: 'OPERATION_FAILED' })
  })
  it('does not stop a lead when the run changes during asynchronous recovery inspection', async () => {
    const { run, runtime, service } = setup(); run.status = 'paused'
    const expectedVersion = run.version
    let finish!: (value: { writersStopped: boolean; ordinaryDirty: boolean; ambiguousIntegration: boolean }) => void
    runtime.workspace.inspectRecovery.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const pending = handlers.get('team:control')!(event, { runId: run.id, clientRequestId: 'racing-resume', expectedVersion, action: 'resume' })
    run.version++
    finish({ writersStopped: true, ordinaryDirty: false, ambiguousIntegration: false })
    expect(await pending).toMatchObject({ ok: false, code: 'STALE_VERSION' })
    expect(runtime.stopLead).not.toHaveBeenCalled()
    expect(service.lifecycle).not.toHaveBeenCalled()
  })
  it('does not authorize replacement when previous lead cessation remains unknown', async () => {
    const { run, runtime, service } = setup(); run.status = 'paused'
    runtime.stopLead.mockResolvedValue(false)
    expect(await handlers.get('team:control')!(event, { runId: run.id, clientRequestId: 'unknown-writer-resume', expectedVersion: run.version, action: 'resume' })).toMatchObject({ ok: false, code: 'LEAD_STILL_RUNNING' })
    expect(runtime.stopLead).toHaveBeenCalledTimes(1)
    expect(service.lifecycle).not.toHaveBeenCalled()
  })
  it('retains a recovery lead when Resume is requested before dirty work is resolved', async () => {
    const { run, runtime } = setup(); run.status = 'recovering'
    runtime.workspace.inspectRecovery.mockResolvedValue({ writersStopped: false, ordinaryDirty: true, ambiguousIntegration: false })
    expect(await handlers.get('team:control')!(event, { runId: run.id, clientRequestId: 'premature-resume', expectedVersion: run.version, action: 'resume' })).toMatchObject({ ok: false, code: 'RECOVERY_REQUIRED' })
    expect(runtime.stopLead).not.toHaveBeenCalled()
  })
  it('lists healthy runs alongside explicit corrupt-history blockers', async () => {
    const { run, runtime, service } = setup(), corrupt = teamFixtureId(99)
    runtime.teams.listRunIds.mockReturnValue([run.id, corrupt])
    service.getSnapshot.mockImplementation(id => { if (id === corrupt) throw Error('Corrupt private detail'); return { run } })
    expect(await handlers.get('team:list')!(event, { projectId: run.projectId })).toMatchObject({ ok: true, value: { runs: [run], unavailable: [{ runId: corrupt, reason: expect.stringContaining('retained') }] } })
  })
  it('constructs user authority in main and rejects caller-supplied actor fields', async () => {
    const { run, service } = setup(), input = { projectId: run.projectId, clientRequestId: 'launch', config: run.config }
    expect(await handlers.get('team:launch')!(event, input)).toEqual({ ok: true, value: { runId: run.id } })
    expect(service.createRun).toHaveBeenCalledWith(input, { role: 'user', principal: 'window:12' })
    expect(await handlers.get('team:launch')!(event, { ...input, actor: { role: 'lead' } })).toMatchObject({ ok: false, code: 'INVALID_REQUEST' })
    expect(service.createRun).toHaveBeenCalledTimes(1)
  })
  it('refuses subframes before any launch effect', async () => {
    const { run, service } = setup()
    expect(await handlers.get('team:launch')!({ ...event, senderFrame: {} }, { projectId: run.projectId, clientRequestId: 'launch', config: run.config })).toMatchObject({ ok: false, code: 'UNAUTHORIZED' })
    expect(service.createRun).not.toHaveBeenCalled()
  })
  it('does not stop a lead for a stale resume request', async () => {
    const { run, runtime } = setup()
    expect(await handlers.get('team:control')!(event, { runId: run.id, clientRequestId: 'resume', expectedVersion: 2, action: 'resume' })).toMatchObject({ ok: false, code: 'STALE_VERSION' })
    expect(runtime.stopLead).not.toHaveBeenCalled()
  })
})
