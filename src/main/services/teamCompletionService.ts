import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { teamFinishSchema, type TeamRun } from '../../shared/team'
import type { TeamWorkspaceDependencies } from './teamWorkspaceService'
import type { TeamAcknowledgment, TeamJson } from './teamStorage'
import { TeamVerificationService } from './teamVerificationService'
import { teamAssert, canFinishDraining } from './teamCore'
import { currentBranch, resolveMainRepoRoot, teamResolveCommit, teamStatus, teamReadCommit, teamCreateArtifactObjects, teamCheckpointCaptured, teamPublishFinalRef, teamPublishDestination, teamIgnoredPaths, teamDeleteCapturedBranch, listWorktrees } from './git'
import { worktreeRootFor } from './worktrees'
import { scrubSecrets } from './logger'

type Dependencies = TeamWorkspaceDependencies & { checks: TeamVerificationService; changed(runId: string): void }
const samePath = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()

/** Never traverse npm's nested directory junctions: their targets may be tracked source. */
function removeDisposableTree(target: string, boundary: string = fs.realpathSync(target)): void {
  const stat = fs.lstatSync(target)
  if (stat.isSymbolicLink()) {
    try { fs.unlinkSync(target) }
    catch (error) {
      if (!['EPERM', 'EISDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
      fs.rmdirSync(target) // Nonrecursive: remove the junction itself, never its target.
    }
    return
  }
  if (!stat.isDirectory()) { fs.unlinkSync(target); return }
  const actual = fs.realpathSync(target).toLowerCase(), root = boundary.toLowerCase()
  teamAssert(actual === root || actual.startsWith(root + path.sep), 'INVALID_CLEANUP_PATH', 'Nested disposable directory escapes its recorded root.')
  for (const child of fs.readdirSync(target)) removeDisposableTree(path.join(target, child), boundary)
  fs.rmdirSync(target)
}

/** A completion is an exact Git publication, followed by independently journaled cleanup. */
export class TeamCompletionService {
  constructor(private readonly deps: Dependencies) {}
  private update(runId: string, patch: Partial<TeamRun>, operation: string, payload: Record<string, TeamJson> = {}): void {
    const run = this.deps.teams.getRun(runId)
    this.deps.teams.command({ runId, generation: run.generation, operation, actor: 'system', eventId: randomUUID(), now: new Date().toISOString() }, tx => {
      tx.updateRun(run.version, { ...run, ...patch, version: run.version + 1, updatedAt: new Date().toISOString() })
      return { acknowledgment: {}, event: payload }
    })
    this.deps.changed(runId)
  }
  async reserve(run: TeamRun, command: ReturnType<typeof teamFinishSchema.parse>): Promise<TeamAcknowledgment> {
    const replay = this.deps.teams.acknowledgment(run.id, 'finish', command.clientRequestId, command)
    if (replay) return { ...replay, status: 'already-requested' }
    this.deps.assertAuthorized(run.id, run.generation)
    this.deps.checks.assertQuiescent(run.id)
    const snapshot = this.deps.teams.snapshot(run.id)
    teamAssert(snapshot.run.status === 'active' && canFinishDraining(run, snapshot.attempts, snapshot.integrations)
      && snapshot.tasks.every(t => ['completed', 'cancelled'].includes(t.status)) && snapshot.integrations.every(i => ['applied', 'rejected'].includes(i.status)), 'UNFINISHED_WORK', 'Finish requires completed reviews and no unfinished helpers/integrations.')
    const row = run.integrationWorktreeId ? this.deps.storage.getWorktreeById(run.integrationWorktreeId) : null
    teamAssert(row && await teamResolveCommit(row.path, 'HEAD') === command.expectedSha && (await teamStatus(row.path)).clean, 'STALE_FINISH', 'Finish must name the current clean integration SHA.')
    this.deps.checks.preflight(row.path, run, run.config.verificationProfile === 'npm-project' ? 'test' : 'node-test')
    const finish: NonNullable<TeamRun['finish']> = { requestId: command.clientRequestId, sha: command.expectedSha, status: 'verifying', publishedAt: null, blocker: null, retainedWorktreeIds: [], removedWorktreeIds: [] }
    return this.deps.teams.command({ runId: run.id, generation: run.generation, operation: 'finish', actor: 'lead', eventId: randomUUID(), now: new Date().toISOString(), clientRequestId: command.clientRequestId, payload: command }, tx => {
      const current = tx.snapshot().run
      teamAssert(current.version === snapshot.run.version, 'STALE_FINISH', 'Run changed during finish inspection.')
      tx.updateRun(current.version, { ...current, status: 'finishing', finish, version: current.version + 1, updatedAt: new Date().toISOString() })
      return { acknowledgment: { status: 'finish-requested', runId: run.id, sha: command.expectedSha }, event: { sha: command.expectedSha } }
    })
  }
  async execute(runId: string): Promise<void> {
    let run = this.deps.teams.getRun(runId)
    const row = run.integrationWorktreeId ? this.deps.storage.getWorktreeById(run.integrationWorktreeId) : null
    try {
      teamAssert(row && run.finish && run.status === 'finishing', 'STALE_FINISH', 'Completion workspace is unavailable.')
      for (const command of run.config.verificationProfile === 'npm-project' ? ['test', 'typecheck', 'build'] as const : ['node-test'] as const) {
        const expectedCommand = command === 'node-test' ? 'node --test' : command === 'test' ? 'npm test' : `npm run ${command}`
        const latest = this.events(runId).filter(event => { const evidence = event.payload.evidence as Record<string, TeamJson> | undefined; return event.operation === 'verification-completed' && !event.payload.bootstrap && evidence?.command === expectedCommand && evidence.testedSha === run.finish!.sha }).at(-1)
        const evidence = latest?.payload.evidence as Record<string, TeamJson> | undefined
        const passed = latest?.payload.cessation === 'confirmed' && evidence?.outcome === 'passed' && evidence.exitCode === 0
        if (passed) continue // Reuse recorded execution at this exact immutable revision, never a helper claim.
        const executed = await this.deps.checks.run(run, row.path, run.finish.sha, command)
        teamAssert(executed.outcome === 'passed', 'FINAL_CHECK_FAILED', `Final ${executed.command} failed; output was retained.`)
      }
      this.deps.assertAuthorized(run.id, run.generation)
      this.deps.checks.assertQuiescent(run.id)
      teamAssert(await teamResolveCommit(row.path, 'HEAD') === run.finish.sha && (await teamStatus(row.path)).clean, 'STALE_FINISH', 'Integration changed after final verification.')
      await teamPublishFinalRef(row.path, run.id, run.finish.sha)
      if (run.config.publicationPolicy !== 'auto-clean') {
        teamAssert(this.deps.stopLead && await this.deps.stopLead(run), 'LEAD_STILL_RUNNING', 'Verified output was retained, but the lead is not confirmed stopped.')
        this.update(runId, { status: 'completed', finish: { ...run.finish, status: 'retained' } }, 'finish-retained', { sha: run.finish.sha, explanation: 'Verified output remains on the Team branch under the retained publication policy.' })
        this.deps.finalized?.(runId)
        return
      }
      const destination = run.destination
      teamAssert(destination && await resolveMainRepoRoot(destination.cwd) && samePath((await resolveMainRepoRoot(destination.cwd))!, destination.repoRoot) && samePath(destination.repoRoot, row.repoRoot), 'DESTINATION_CHANGED', 'Destination repository identity changed.')
      await teamPublishDestination(destination.cwd, destination.branch, destination.head, run.finish.sha, () => {
        this.deps.assertAuthorized(run.id, run.generation)
        this.update(runId, { finish: { ...run.finish!, status: 'publishing' } }, 'finish-publish-intent', { destination, sha: run.finish!.sha })
      })
      run = this.deps.teams.getRun(runId)
      this.update(runId, { finish: { ...run.finish!, status: 'published', publishedAt: new Date().toISOString() } }, 'finish-published', { sha: run.finish!.sha })
      // Retire the lead only after the durable published result is visible in the panel.
      teamAssert(this.deps.stopLead && await this.deps.stopLead(run), 'LEAD_STILL_RUNNING', 'Merged successfully, but lead cessation is unknown; worktrees were retained.')
      for (const attempt of this.deps.teams.attempts(runId)) teamAssert(attempt.cessation === 'not-started' || await this.deps.writersStopped(attempt), 'PROCESS_UNKNOWN', 'Merged successfully, but helper cessation is unknown; worktrees were retained.')
      await this.cleanup(runId)
      run = this.deps.teams.getRun(runId)
      this.update(runId, { status: 'completed', blocker: null, finish: { ...run.finish!, status: 'cleaned' } }, 'finish-completed', { sha: run.finish!.sha, retainedWorktreeIds: run.finish!.retainedWorktreeIds, removedWorktreeIds: run.finish!.removedWorktreeIds })
      this.deps.finalized?.(runId)
    } catch (error) {
      run = this.deps.teams.getRun(runId)
      if (run.finish) {
        const reason = scrubSecrets(error instanceof Error ? error.message : 'Team finish was interrupted.').slice(0, 3800)
        this.update(runId, { status: run.finish.publishedAt ? 'completed' : run.status === 'finishing' ? 'active' : run.status, blocker: reason, finish: { ...run.finish, status: 'blocked', blocker: reason } }, 'finish-blocked', { reason })
        if (run.finish.publishedAt) this.deps.finalized?.(runId)
      }
    }
  }
  async retryCleanup(runId: string): Promise<void> {
    let run = this.deps.teams.getRun(runId)
    teamAssert(run.finish?.publishedAt && run.destination, 'NOT_PUBLISHED', 'Cleanup retry requires a durably published Team result.')
    teamAssert(this.deps.stopLead && await this.deps.stopLead(run), 'LEAD_STILL_RUNNING', 'Previous lead cessation is unconfirmed.')
    for (const attempt of this.deps.teams.attempts(runId)) teamAssert(attempt.cessation === 'not-started' || await this.deps.writersStopped(attempt), 'PROCESS_UNKNOWN', 'Helper cessation is unconfirmed.')
    await this.cleanup(runId)
    run = this.deps.teams.getRun(runId)
    this.update(runId, { status: 'completed', blocker: null, finish: { ...run.finish!, status: 'cleaned', blocker: null } }, 'finish-cleanup-retried', { removedWorktreeIds: run.finish!.removedWorktreeIds, retainedWorktreeIds: run.finish!.retainedWorktreeIds })
    this.deps.finalized?.(runId)
  }
  private events(runId: string) {
    const events = this.deps.teams.events(runId), all = [...events]
    let cursor = events.at(-1)?.sequence ?? 0
    while (cursor) { const page = this.deps.teams.events(runId, cursor); if (!page.length) break; all.push(...page); cursor = page.at(-1)!.sequence }
    return all
  }
  private async cleanup(runId: string): Promise<void> {
    this.deps.checks.assertQuiescent(runId)
    const snapshot = this.deps.teams.snapshot(runId), events = this.events(runId)
    const ids = [...new Set([...snapshot.attempts.map(a => a.worktreeId), ...snapshot.integrations.map(i => i.stagingWorktreeId), snapshot.run.integrationWorktreeId].filter((v): v is string => !!v))]
    for (const id of ids) {
      let run = this.deps.teams.getRun(runId)
        if (run.finish!.removedWorktreeIds.includes(id)) continue
      const row = this.deps.storage.getWorktreeById(id)
      try {
        if (!row) {
          const intent = events.filter(e => e.operation === 'cleanup-intent' && e.payload.worktreeId === id).at(-1)
          const ownedPath = intent?.payload.path, repoRoot = intent?.payload.repoRoot
          teamAssert(typeof ownedPath === 'string' && typeof repoRoot === 'string' && samePath(path.dirname(ownedPath), worktreeRootFor(repoRoot)) && !fs.existsSync(ownedPath)
            && !(await listWorktrees(repoRoot)).some(entry => samePath(entry.path, ownedPath)), 'CLEANUP_AMBIGUOUS', 'Missing workspace lacks a completed removal identity.')
          this.update(runId, { finish: { ...run.finish!, removedWorktreeIds: [...run.finish!.removedWorktreeIds, id], retainedWorktreeIds: run.finish!.retainedWorktreeIds.filter(retained => retained !== id) } }, 'cleanup-removal-reconciled', { worktreeId: id })
          continue
        }
        teamAssert(row && row.projectId === run.projectId && samePath(path.dirname(row.path), worktreeRootFor(row.repoRoot)) && fs.existsSync(row.path) && !fs.lstatSync(row.path).isSymbolicLink(), 'WORKSPACE_CHANGED', 'Owned managed workspace is missing or changed.')
        teamAssert(await currentBranch(row.path) === row.branch && samePath((await resolveMainRepoRoot(row.path)) ?? '', row.repoRoot), 'WORKSPACE_CHANGED', 'Owned repository/branch changed.')
        const attempt = snapshot.attempts.find(a => a.worktreeId === id), integration = snapshot.integrations.find(i => i.stagingWorktreeId === id)
        if (attempt) {
          teamAssert(attempt.status === 'succeeded' && await this.deps.writersStopped(attempt), 'RETAIN_ATTEMPT', 'Unsuccessful or unconfirmed attempt is retained.')
          if (attempt.artifact && !(await teamStatus(row.path)).clean) {
            const reservation = this.deps.teams.captureReservation(runId, attempt.id)
            teamAssert(reservation, 'CAPTURE_MISSING', 'Captured artifact reservation is unavailable.')
            const current = await teamCreateArtifactObjects(row.path, reservation, this.deps.generatedConfiguration?.(attempt) ?? [])
            teamAssert(current.treeSha === attempt.artifact.treeSha && current.finalHelperHead === attempt.artifact.finalHelperHead, 'CAPTURE_CHANGED', 'Helper files changed after capture; retain them.')
            await teamCheckpointCaptured(row.path, row.branch, attempt.artifact.finalHelperHead, attempt.artifact.commitSha)
          }
        } else if (integration && !(await teamStatus(row.path)).clean) {
          teamAssert(integration.status === 'applied' && integration.resultSha, 'RETAIN_STAGING', 'Unapplied/conflicted staging is retained.')
          const head = await teamResolveCommit(row.path, 'HEAD')
          const reservation = { runId, attemptId: integration.attemptId, captureId: randomUUID(), baseSha: head, ref: `refs/chorus/teams/${runId}/artifacts/${integration.attemptId}`, authorName: 'Chorus' as const, authorEmail: 'chorus@localhost' as const, at: integration.createdAt }
          const captured = await teamCreateArtifactObjects(row.path, reservation)
          const expected = await teamReadCommit(row.path, integration.resultSha)
          teamAssert(captured.treeSha === expected.tree, 'STAGING_CHANGED', 'Staging files changed after preparation; retain them.')
          await teamCheckpointCaptured(row.path, row.branch, head, integration.resultSha, expected.tree)
        }
        teamAssert((await teamStatus(row.path)).clean, 'DIRTY_WORKSPACE', 'Additional files remain; retain the workspace.')
        const roots = new Set(events.filter(e => e.operation === 'workspace-disposable' && e.payload.worktreeId === id).flatMap(e => Array.isArray(e.payload.roots) ? e.payload.roots.filter((p): p is string => typeof p === 'string') : []))
        const ignored = await teamIgnoredPaths(row.path)
        teamAssert(ignored.every(p => roots.has(p.split('/')[0])), 'UNKNOWN_IGNORED_FILES', 'Unknown ignored files remain; retain the workspace.')
        const branchHead = await teamResolveCommit(row.path, 'HEAD')
        this.update(runId, {}, 'cleanup-intent', { worktreeId: id, path: row.path, repoRoot: row.repoRoot, branch: row.branch, branchHead, roots: [...roots] })
        for (const root of roots) {
          teamAssert(['node_modules', 'out', 'dist', '.cache'].includes(root), 'INVALID_CLEANUP_ROOT', 'Disposable root is not recognized.')
          const target = path.resolve(row.path, root)
          teamAssert(path.dirname(target) === path.resolve(row.path), 'INVALID_CLEANUP_PATH', 'Disposable root escapes the owned workspace.')
          if (fs.existsSync(target)) {
            teamAssert(!fs.lstatSync(target).isSymbolicLink() && fs.realpathSync(target).toLowerCase().startsWith(fs.realpathSync(row.path).toLowerCase() + path.sep), 'INVALID_CLEANUP_PATH', 'Disposable directory is redirected outside the owned workspace.')
            removeDisposableTree(target)
          }
        }
        await this.deps.worktrees.removeWorktree(id)
        try { await teamDeleteCapturedBranch(row.repoRoot, row.branch, branchHead, runId) }
        catch (error) { this.update(runId, {}, 'cleanup-branch-retained', { branch: row.branch, reason: scrubSecrets(error instanceof Error ? error.message : 'Branch retained.').slice(0, 2000) }) }
        run = this.deps.teams.getRun(runId)
        this.update(runId, { finish: { ...run.finish!, removedWorktreeIds: [...run.finish!.removedWorktreeIds, id], retainedWorktreeIds: run.finish!.retainedWorktreeIds.filter(retained => retained !== id) } }, 'cleanup-removed', { worktreeId: id })
      } catch (error) {
        run = this.deps.teams.getRun(runId)
        this.update(runId, { finish: { ...run.finish!, retainedWorktreeIds: [...new Set([...run.finish!.retainedWorktreeIds, id])] } }, 'cleanup-retained', { worktreeId: id, reason: scrubSecrets(error instanceof Error ? error.message : 'Workspace retained.').slice(0, 2000) })
      }
    }
  }
}
