import { BrowserWindow, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { teamCapabilitiesSchema, teamProjectQuerySchema, teamSnapshotQuerySchema, teamSnapshotSchema, teamLaunchSchema, teamLifecycleSchema, teamIntegrationDecisionSchema, teamPresetSchema, teamPresetSaveSchema, teamPresetDeleteSchema, teamChangedSchema } from '../../shared/team'
import { TeamDomainError, teamAssert } from './teamCore'
import type { TeamRuntime } from './teamRuntime'
import type { StorageService } from './storage'
import { teamListSchema } from '../../shared/team'
import { teamMemberProfileSaveSchema, teamMemberProfileDeleteSchema, teamMemberProfileListSchema } from '../../shared/teamProfiles'
import { teamReviewQuerySchema, teamPreviewQuerySchema, teamReviewPacketSchema, teamFilePreviewSchema } from '../../shared/team'
import { readTeamReview, readTeamPreview } from './teamReviewService'

/** Registered by the main IPC owner. Actor identity comes only from this transport. */
export function registerTeamIpc(runtime: TeamRuntime, storage: StorageService): void {
  const project = (id: string) => { teamAssert(storage.getProjectById(id), 'PROJECT_UNAVAILABLE', 'Project is unavailable.') }
  const run = (id: string) => { const r = runtime.teams.getRun(id); project(r.projectId); return r }
  const ack = z.record(z.string(), z.json())
  function handle<I, O>(channel: string, input: z.ZodType<I>, output: z.ZodType<O>, action: (input: I, principal: string) => Promise<O> | O): void {
    ipcMain.handle(channel, async (event, raw: unknown) => {
      try {
        const window = BrowserWindow.fromWebContents(event.sender)
        teamAssert(window && !window.isDestroyed() && event.senderFrame === event.sender.mainFrame, 'UNAUTHORIZED', 'Team actions require an application window.')
        return { ok: true, value: output.parse(await action(input.parse(raw), `window:${event.sender.id}`)) }
      } catch (error) {
        return { ok: false, code: error instanceof TeamDomainError ? error.code : error instanceof z.ZodError ? 'INVALID_REQUEST' : 'OPERATION_FAILED', message: error instanceof TeamDomainError ? error.message : 'Team operation failed. Refresh the current state and retry.' }
      }
    })
  }
  handle('team:capabilities', teamProjectQuerySchema, teamCapabilitiesSchema, async q => { project(q.projectId); return runtime.capabilities() })
  handle('team:member-list', z.strictObject({}), teamMemberProfileListSchema, () => runtime.memberProfiles.list())
  // The API key is a write-only field. This handler never logs requests or includes them in history.
  handle('team:member-save', teamMemberProfileSaveSchema, teamMemberProfileListSchema, q => runtime.memberProfiles.save(q))
  handle('team:member-delete', teamMemberProfileDeleteSchema, teamMemberProfileListSchema, q => runtime.memberProfiles.delete(q.id, q.expectedVersion))
  handle('team:launch', teamLaunchSchema, ack, (q, principal) => { project(q.projectId); return runtime.service.createRun(q, { role: 'user', principal }) })
  handle('team:list', teamProjectQuerySchema, teamListSchema, q => {
    project(q.projectId)
    const result: z.infer<typeof teamListSchema> = { runs: [], unavailable: [] }
    for (const id of runtime.teams.listRunIds(q.projectId)) {
      try { result.runs.push(runtime.service.getSnapshot(id).run) }
      catch { result.unavailable.push({ runId: id, reason: 'Stored Team history or recovery evidence is unavailable. Its processes will not be restored automatically; workspaces and records are retained.' }) }
    }
    return result
  })
  handle('team:snapshot', teamSnapshotQuerySchema, teamSnapshotSchema, q => { run(q.runId); return runtime.service.getSnapshot(q.runId, q.afterSequence) })
  handle('team:review', teamReviewQuerySchema, teamReviewPacketSchema, q => { run(q.runId); return readTeamReview(runtime.teams, storage, q) })
  handle('team:preview', teamPreviewQuerySchema, teamFilePreviewSchema, q => { run(q.runId); return readTeamPreview(runtime.teams, storage, q) })
  handle('team:control', teamLifecycleSchema, ack, async (q, principal) => {
    const current = run(q.runId)
    if (q.action === 'complete' && (current.config.publicationPolicy || current.finish?.publishedAt)) {
      teamAssert(current.version === q.expectedVersion, 'STALE_VERSION', 'Run changed; refresh first.')
      if (current.finish?.publishedAt) return runtime.workspace.retryCleanup(current.id)
      teamAssert(current.status === 'active' && current.integrationHead, 'RUN_INACTIVE', 'Finish requires an active Team and current integration revision.')
      return runtime.workspace.finish(current, { clientRequestId: q.clientRequestId, expectedSha: current.integrationHead })
    }
    if (q.action === 'resume' || q.action === 'recover') {
      teamAssert(!current.finish?.publishedAt && !['cleaned', 'retained'].includes(current.finish?.status ?? ''), 'RUN_ARCHIVED', 'This Team is an archive. Start a new Team from its result.')
      teamAssert(current.version === q.expectedVersion, 'STALE_VERSION', 'Run changed; refresh first.')
      teamAssert((q.action === 'resume' ? ['paused', 'completed', 'recovering', 'blocked'] : ['paused', 'blocked']).includes(current.status), 'INVALID_STATE', 'Pause the team before replacing its lead.')
      const evidence = await runtime.workspace.inspectRecovery(current)
      teamAssert(!evidence.ambiguousIntegration && (q.action === 'recover' ? evidence.ordinaryDirty : !evidence.ordinaryDirty), 'RECOVERY_REQUIRED', q.action === 'resume' ? 'Resolve retained dirty work or ambiguous integration before Resume. The current lead is retained.' : 'Recover requires ordinary retained dirt and unambiguous integration evidence.')
      teamAssert(runtime.teams.getRun(q.runId).version === q.expectedVersion, 'STALE_VERSION', 'Run changed during inspection; refresh first.')
      teamAssert(await runtime.stopLead(current), 'LEAD_STILL_RUNNING', 'Previous lead cessation is unconfirmed; replacement is blocked.')
    }
    return runtime.service.lifecycle(q, { role: 'user', principal })
  })
  handle('team:decide-integration', teamIntegrationDecisionSchema, ack, q => { run(q.runId); throw new TeamDomainError('APPROVAL_REMOVED', 'Human approval is no longer required. Review outputs and request changes in the lead terminal.') })
  handle('team:preset-list', teamProjectQuerySchema, z.array(teamPresetSchema), q => { project(q.projectId); return runtime.teams.listPresets() })
  handle('team:preset-save', teamPresetSaveSchema, z.array(teamPresetSchema), q => { project(q.projectId); runtime.teams.savePresetVersioned(q.id ?? randomUUID(), q.expectedVersion, q.label, q.config, new Date().toISOString()); return runtime.teams.listPresets() })
  handle('team:preset-delete', teamPresetDeleteSchema, z.array(teamPresetSchema), q => { project(q.projectId); runtime.teams.deletePresetVersioned(q.id, q.expectedVersion); return runtime.teams.listPresets() })
  runtime.service.subscribe(snapshot => {
    const event = teamChangedSchema.parse({ runId: snapshot.run.id, version: snapshot.run.version, lastSequence: snapshot.lastSequence })
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('team:changed', event)
  })
}
