import { randomUUID } from 'node:crypto'
import { win32 } from 'node:path'
import type { TeamAttempt, TeamRun, TeamTask, TeamIntegration, TeamReview, TeamIntegrate, TeamToolName } from '../../shared/team'
import { TeamStorage, type TeamAcknowledgment, type TeamJson } from './teamStorage'
import type { StorageService } from './storage'
import { GitWorktreeManager } from './worktrees'
import { currentBranch, resolveMainRepoRoot, teamCreateArtifactObjects, teamIsAncestor, teamPublishArtifactRef, teamResolveCommit, teamStatus, teamPrepareIntegrationObjects, teamPublishIntegrationRef, teamPromoteIntegration, teamReadCommit, teamDiff, teamIntegrationRef } from './git'
import { teamAssert, type TeamActor } from './teamCore'
import { assertCaptureReady, acceptPreparedReview, recordIntegrationDecision, beginPromotion, verifyIntegratedReview, classifyPromotionRecovery, type TeamWorkspaceObservation } from './teamWorkspaceCore'
import type { TeamGeneratedConfiguration } from './git'
import { scrubSecrets } from './logger'

const pathKey = (value: string) => win32.normalize(value).toLowerCase().replace(/\\+$/, '')
export interface TeamWorkspaceDependencies {
  storage: StorageService
  teams: TeamStorage
  worktrees: GitWorktreeManager
  /** Supplied by main composition; no workspace method can grant itself a lease. */
  assertAuthorized(runId: string, generation: number): void
  writersStopped(attempt: TeamAttempt): Promise<boolean>
  generatedConfiguration?(attempt: TeamAttempt): readonly TeamGeneratedConfiguration[]
  authorizeLead?(actor: Extract<TeamActor, { role: 'lead' }>, operation: TeamToolName): void
  withLeadWriteLease?<T>(run: TeamRun, work: () => Promise<T>): Promise<T>
  leadStopped?(run: TeamRun): Promise<boolean>
  now?: () => string
  id?: () => string
}

/** Main-owned workspace protocol. Git and database boundaries are journaled separately. */
export class TeamWorkspaceService {
  private readonly now: () => string
  private readonly id: () => string
  private readonly capturing = new Map<string, Promise<void>>()
  private readonly queues = new Map<string, Promise<unknown>>()
  private readonly effects = new Set<Promise<unknown>>()
  private readonly listeners = new Set<(runId: string) => void>()
  constructor(private readonly deps: TeamWorkspaceDependencies) { this.now = deps.now ?? (() => new Date().toISOString()); this.id = deps.id ?? randomUUID }
  private operation(run: TeamRun, operation: string, request: string) { return { runId: run.id, generation: run.generation, operation, clientRequestId: request, actor: 'system' as const, eventId: this.id(), now: this.now() } }
  subscribe(listener: (runId: string) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  private changed(runId: string): void { for (const listener of this.listeners) try { listener(runId) } catch { /* committed state survives view errors */ } }
  async settle(): Promise<void> { await Promise.allSettled([...this.effects, ...this.capturing.values()]) }
  private serial<T>(runId: string, work: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(runId) ?? Promise.resolve()).catch(() => undefined).then(work)
    this.queues.set(runId, next)
    void next.then(() => { if (this.queues.get(runId) === next) this.queues.delete(runId) }, () => { if (this.queues.get(runId) === next) this.queues.delete(runId) })
    return next
  }
  private effect(runId: string, work: () => Promise<void>): void {
    const pending = this.serial(runId, work); this.effects.add(pending)
    void pending.then(() => { this.effects.delete(pending); this.changed(runId) }, () => { this.effects.delete(pending); this.changed(runId) })
  }
  private authorize(run: TeamRun, actor: TeamActor, operation: TeamToolName): TeamRun {
    const current = this.deps.teams.getRun(run.id)
    teamAssert(actor.role === 'lead' && actor.runId === current.id && actor.generation === current.generation && current.generation === run.generation && current.status === 'active', 'WORKSPACE_REVOKED', 'This workspace operation needs its current active lead.')
    teamAssert(this.deps.authorizeLead, 'AUTHORIZATION_UNAVAILABLE', 'Production lead authorization is required.')
    this.deps.authorizeLead(actor, operation); this.deps.assertAuthorized(current.id, current.generation)
    return current
  }
  private integrationRow(run: TeamRun) {
    const row = run.integrationWorktreeId ? this.deps.storage.getWorktreeById(run.integrationWorktreeId) : null
    teamAssert(row && row.projectId === run.projectId, 'WORKSPACE_UNAVAILABLE', 'Run-owned integration workspace is unavailable.')
    return row
  }
  private async observeIntegration(run: TeamRun, objects: string[] = [], writersStopped = true): Promise<TeamWorkspaceObservation> {
    const row = this.integrationRow(run)
    const [head, root, branch, status] = await Promise.all([teamResolveCommit(row.path, 'HEAD'), resolveMainRepoRoot(row.path), currentBranch(row.path), teamStatus(row.path)])
    let objectsPresent = true
    for (const sha of objects) try { await teamReadCommit(row.path, sha) } catch { objectsPresent = false }
    return { head, clean: status.clean, expectedRepository: !!root && pathKey(root) === pathKey(row.repoRoot), expectedBranch: branch === row.branch, writersStopped, objectsPresent }
  }
  async refreshIntegrationHead(run: TeamRun): Promise<void> {
    await this.serial(run.id, async () => {
      const observed = await this.observeIntegration(run)
      teamAssert(observed.clean && observed.expectedBranch && observed.expectedRepository && observed.head, 'WORKSPACE_CHANGED', 'Checkpoint and clean the integration workspace before dispatching helpers.')
      teamAssert(!run.integrationHead || await teamIsAncestor(this.integrationRow(run).path, run.integrationHead, observed.head), 'WORKSPACE_CHANGED', 'Integration history no longer contains the recorded checkpoint.')
      const current = this.deps.teams.getRun(run.id)
      teamAssert(current.status === 'active' && current.generation === run.generation, 'WORKSPACE_REVOKED', 'Dispatch preparation was revoked.')
      this.deps.assertAuthorized(run.id, run.generation)
      if (current.integrationHead !== observed.head) this.deps.teams.command({ ...this.operation(current, 'integration-checkpoint', this.id()), payload: { head: observed.head } }, tx => { tx.updateRun(current.version, { ...current, integrationHead: observed.head, version: current.version + 1, updatedAt: this.now() }); return { acknowledgment: {}, event: { head: observed.head } } })
    })
  }
  async review(run: TeamRun, command: TeamReview, actor: TeamActor): Promise<TeamAcknowledgment> {
    return this.serial(run.id, async () => {
      this.authorize(run, actor, 'team_review')
      const replay = this.deps.teams.acknowledgment(run.id, 'review', command.clientRequestId, command)
      if (replay) return replay
      let snapshot = this.deps.teams.snapshot(run.id), task = snapshot.tasks.find(t => t.id === command.taskId)!, attempt = snapshot.attempts.find(a => a.id === command.attemptId)!
      teamAssert(task && attempt && task.currentAttemptId === attempt.id && attempt.taskId === task.id && attempt.status === 'succeeded' && attempt.cessation === 'confirmed', 'NOT_REVIEWABLE', 'Review requires the current stopped successful attempt.')
      let nextTask = task, nextIntegration: TeamIntegration | undefined
      const decisionId = this.id()
      if (command.phase === 'artifact') {
        teamAssert(task.status === 'awaiting-review', 'NOT_REVIEWABLE', 'Artifact review is unavailable in this task state.')
        if (attempt.artifact) teamAssert(command.reviewedSha === attempt.artifact.commitSha, 'STALE_REVIEW', 'Artifact review must identify its exact immutable commit.')
        else {
          teamAssert(this.deps.teams.noChangesCapture(run.id, attempt.id), 'NO_ARTIFACT', 'The attempt has neither an artifact nor a verified no-change result.')
          const observed = await this.observeIntegration(run)
          teamAssert(observed.clean && observed.expectedBranch && observed.expectedRepository && command.reviewedSha === observed.head, 'STALE_REVIEW', 'No-change acceptance requires the current clean integration revision.')
          if (command.decision === 'accept') teamAssert(command.tests.length > 0 && command.tests.every(t => t.outcome === 'passed' && t.exitCode === 0 && t.executionContext === 'integration' && t.testedSha === observed.head && t.provenance !== 'helper-reported' && t.testSource !== 'unknown' && ((t.sourcePaths?.length ?? 0) > 0 || !!t.sourceDiffSha)), 'UNVERIFIED_TESTS', 'No-change completion requires verified passing evidence at the current integration revision.')
        }
        nextTask = { ...task, status: command.decision === 'revise' ? 'needs-revision' : attempt.artifact ? 'awaiting-review' : 'completed', version: task.version + 1, updatedAt: this.now(), blocker: null }
      } else {
        const integration = snapshot.integrations.find(i => i.id === command.integrationId)
        teamAssert(integration && integration.taskId === task.id && integration.attemptId === attempt.id, 'WRONG_INTEGRATION', 'Review integration does not belong to this attempt.')
        if (command.phase === 'prepared') {
          const observed = await this.observeIntegration(run, [integration.artifactSha, integration.resultSha!])
          teamAssert(observed.head === integration.expectedHead && observed.clean && observed.expectedBranch && observed.expectedRepository && observed.objectsPresent, 'STALE_PREPARATION', 'Integration changed before prepared review.')
          nextIntegration = acceptPreparedReview(snapshot.run, integration, command, decisionId, this.now())
          nextTask = { ...task, status: command.decision === 'revise' ? 'needs-revision' : nextIntegration.status === 'awaiting-approval' ? 'awaiting-approval' : 'awaiting-review', version: task.version + 1, updatedAt: this.now() }
        } else {
          const observed = await this.observeIntegration(run, [integration.resultSha!])
          const ancestor = await teamIsAncestor(this.integrationRow(run).path, integration.resultSha!, observed.head!)
          nextTask = verifyIntegratedReview(snapshot.run, task, integration, command, observed, ancestor, this.now())
        }
      }
      const currentRun = this.authorize(run, actor, 'team_review')
      const acknowledgment = this.deps.teams.command({ ...this.operation(currentRun, 'review', command.clientRequestId), actor: 'lead', eventId: decisionId, entityId: task.id, payload: command }, tx => {
        tx.writeTask(nextTask, task.version)
        if (nextIntegration) tx.writeIntegration(nextIntegration, nextIntegration.version - 1)
        return { acknowledgment: { decisionId, taskId: task.id, status: nextTask.status }, event: { review: command as unknown as TeamJson } }
      })
      this.changed(run.id); return acknowledgment
    })
  }
  async decideIntegration(run: TeamRun, command: { clientRequestId: string; runId: string; integrationId: string; expectedVersion: number; decision: 'approve' | 'reject' }, actor: TeamActor): Promise<TeamAcknowledgment> {
    teamAssert(actor.role === 'user', 'USER_REQUIRED', 'Only the registered user transport may approve integration.')
    return this.serial(run.id, async () => {
      const replay = this.deps.teams.acknowledgment(run.id, 'integration-decision', command.clientRequestId, command)
      if (replay) return replay
      const snapshot = this.deps.teams.snapshot(run.id), integration = snapshot.integrations.find(i => i.id === command.integrationId)
      teamAssert(integration, 'UNKNOWN_INTEGRATION', 'Integration does not belong to this run.')
      const observed = await this.observeIntegration(snapshot.run, [integration.artifactSha, integration.resultSha!])
      teamAssert(observed.clean && observed.expectedBranch && observed.expectedRepository && observed.objectsPresent && observed.head === integration.expectedHead, 'STALE_APPROVAL', 'Prepared integration content is no longer current.')
      const current = this.deps.teams.getRun(run.id), next = recordIntegrationDecision(current, integration, command.expectedVersion, actor.principal, command.decision, this.now())
      const task = this.deps.teams.tasks(run.id).find(t => t.id === integration.taskId)!
      const acknowledgment = this.deps.teams.command({ ...this.operation(current, 'integration-decision', command.clientRequestId), actor: 'user', payload: command }, tx => {
        tx.writeIntegration(next, integration.version); tx.writeTask({ ...task, status: command.decision === 'approve' ? 'awaiting-review' : 'needs-revision', version: task.version + 1, updatedAt: this.now() }, task.version)
        return { acknowledgment: { integrationId: integration.id, status: next.status }, event: { integrationId: integration.id, decision: command.decision, binding: next.approval!.binding, principal: actor.principal } }
      })
      this.changed(run.id); return acknowledgment
    })
  }
  async integrate(run: TeamRun, command: TeamIntegrate, actor: TeamActor): Promise<TeamAcknowledgment> {
    return this.serial(run.id, async () => {
      const current = this.authorize(run, actor, 'team_integrate')
      const replay = this.deps.teams.acknowledgment(run.id, 'integrate', command.clientRequestId, command)
      if (replay) return replay
      const snapshot = this.deps.teams.snapshot(run.id), task = snapshot.tasks.find(t => t.id === command.taskId), attempt = snapshot.attempts.find(a => a.id === command.attemptId)
      teamAssert(task && attempt && task.currentAttemptId === attempt.id && attempt.taskId === task.id && attempt.artifact && attempt.status === 'succeeded' && attempt.cessation === 'confirmed', 'NOT_INTEGRATABLE', 'Integration requires the current immutable stopped artifact.')
      const accepted = this.deps.teams.latestReview(run.id, task.id, attempt.id, 'artifact')
      teamAssert(accepted?.review.decision === 'accept' && accepted.review.reviewedSha === attempt.artifact.commitSha && command.reviewedHead === attempt.artifact.commitSha, 'ARTIFACT_REVIEW_REQUIRED', 'Accept the exact helper artifact, then set reviewedHead to attempt.artifact.commitSha for both prepare and apply. The prepared result SHA belongs to its prepared review.')
      let integration: TeamIntegration
      if (command.action === 'prepare') {
        const recoverable = task.status === 'blocked' && snapshot.integrations.some(i => i.taskId === task.id && i.attemptId === attempt.id && i.status === 'interrupted')
        teamAssert((task.status === 'awaiting-review' || recoverable) && !snapshot.integrations.some(i => i.taskId === task.id && ['preparing', 'applying'].includes(i.status)), 'INTEGRATION_PENDING', 'This task already has integration work in progress.')
        const ahead = snapshot.integrations.find(i => i.taskId !== task.id && (['preparing', 'applying', 'recovery-required'].includes(i.status) || (['prepared', 'approved', 'awaiting-approval'].includes(i.status) && i.expectedHead === current.integrationHead)))
        teamAssert(!ahead, 'INTEGRATION_BUSY', `Finish the pending integration for task ${ahead?.taskId} before preparing another. Keep this helper artifact; no new helper attempt is needed.`)
        teamAssert(command.expectedIntegrationHead === current.integrationHead, 'STALE_PREPARATION', 'Read the current integration HEAD and prepare this same helper artifact again; do not delegate a carry task.')
        const now = this.now()
        integration = { id: this.id(), runId: run.id, taskId: task.id, attemptId: attempt.id, preparationId: this.id(), artifactSha: attempt.artifact.commitSha, expectedHead: command.expectedIntegrationHead, resultSha: null, stagingWorktreeId: null, status: 'preparing', version: 1, policyVersion: current.policyVersion, preparedReviewId: null, approval: null, createdAt: now, updatedAt: now, blocker: null }
      } else {
        const existing = snapshot.integrations.find(i => i.id === command.integrationId)
        teamAssert(existing && existing.taskId === task.id && existing.attemptId === attempt.id && existing.expectedHead === command.expectedIntegrationHead, 'WRONG_INTEGRATION', 'Apply must name its exact prepared integration.')
        integration = existing
        // Full Git evidence is rechecked under the write lease before applying is journaled.
        beginPromotion(current, integration, { head: integration.expectedHead, clean: true, expectedBranch: true, expectedRepository: true, writersStopped: true, objectsPresent: true }, this.now())
        teamAssert(['awaiting-review', 'awaiting-approval'].includes(task.status), 'INTEGRATION_PENDING', 'Task is not available for promotion.')
      }
      const acknowledgment = this.deps.teams.command({ ...this.operation(current, 'integrate', command.clientRequestId), actor: 'lead', payload: command }, tx => {
        if (command.action === 'prepare') {
          for (const previous of snapshot.integrations.filter(i => i.taskId === task.id && !['applied', 'applying', 'preparing', 'rejected'].includes(i.status))) tx.writeIntegration({ ...previous, status: 'rejected', blocker: 'Superseded by a new immutable preparation; prior decisions remain historical.', version: previous.version + 1, updatedAt: this.now() }, previous.version)
          tx.writeIntegration(integration)
        }
        tx.writeTask({ ...task, status: 'integrating', version: task.version + 1, updatedAt: this.now() }, task.version)
        return { acknowledgment: { integrationId: integration.id, preparationId: integration.preparationId, action: command.action, status: command.action === 'prepare' ? 'preparing' : 'apply-requested' }, event: { integrationId: integration.id, action: command.action } }
      })
      queueMicrotask(() => this.effect(run.id, async () => {
        try { if (command.action === 'prepare') await this.prepareIntegration(run, integration.id, attempt.baseSha!, actor); else await this.applyIntegration(run, integration.id, actor) }
        catch (error) { this.integrationFailed(run.id, integration.id, error) }
      }))
      this.changed(run.id); return acknowledgment
    })
  }
  private integrationFailed(runId: string, integrationId: string, error: unknown): void {
    const snapshot = this.deps.teams.snapshot(runId), integration = snapshot.integrations.find(i => i.id === integrationId)!
    if (['applied', 'conflict', 'recovery-required'].includes(integration.status)) return
    const task = snapshot.tasks.find(t => t.id === integration.taskId)!
    const reason = Buffer.from(scrubSecrets(error instanceof Error ? error.message : 'Integration was interrupted.')).subarray(0, 4000).toString('utf8')
    this.deps.teams.command({ ...this.operation(snapshot.run, 'integration-failed', this.id()), payload: { integrationId } }, tx => {
      tx.writeIntegration({ ...integration, status: integration.status === 'applying' ? 'recovery-required' : 'interrupted', blocker: reason, version: integration.version + 1, updatedAt: this.now() }, integration.version)
      if (integration.status === 'applying') tx.updateRun(snapshot.run.version, { ...snapshot.run, status: snapshot.run.status === 'stopping' ? 'stopping' : 'blocked', blocker: 'An integration may have changed Git state; reconcile its recorded identities before more work.', version: snapshot.run.version + 1, updatedAt: this.now() })
      if (task.currentAttemptId === integration.attemptId && task.status === 'integrating') tx.writeTask({ ...task, status: 'blocked', blocker: 'Integration interrupted; work was retained.', version: task.version + 1, updatedAt: this.now() }, task.version)
      return { acknowledgment: {}, event: { integrationId, reason } }
    })
  }
  private async prepareIntegration(run: TeamRun, integrationId: string, artifactBase: string, actor: TeamActor): Promise<void> {
    let current = this.authorize(run, actor, 'team_integrate'), integration = this.deps.teams.integrations(run.id).find(i => i.id === integrationId)!
    const observed = await this.observeIntegration(current, [integration.artifactSha])
    teamAssert(observed.clean && observed.expectedBranch && observed.expectedRepository && observed.objectsPresent && observed.head === integration.expectedHead, 'STALE_PREPARATION', 'Integration changed before staging.')
    current = this.authorize(run, actor, 'team_integrate')
    const request = this.id(), controller = new AbortController(), timer = setTimeout(() => controller.abort(), 300000)
    try {
      const row = await this.deps.worktrees.createManagedWorktree({ projectId: run.projectId, repoRoot: this.integrationRow(current).repoRoot, baseSha: integration.expectedHead, signal: controller.signal,
        assertAuthorized: () => { this.authorize(run, actor, 'team_integrate') },
        reserve: row => { const latest = this.deps.teams.integrations(run.id).find(i => i.id === integrationId)!; this.deps.teams.reserveWorkspace(this.operation(this.deps.teams.getRun(run.id), 'workspace-reserved', request), { kind: 'integration', id: integrationId, worktreeId: row.id, expectedVersion: latest.version }) }
      })
      integration = this.deps.teams.integrations(run.id).find(i => i.id === integrationId)!
      this.deps.teams.completeWorkspace(this.operation(this.deps.teams.getRun(run.id), 'workspace-completed', request), { worktreeId: row.id, head: integration.expectedHead })
      const objects = await teamPrepareIntegrationObjects(row.path, integration, artifactBase, () => { controller.signal.throwIfAborted(); this.authorize(run, actor, 'team_integrate') })
      current = this.authorize(run, actor, 'team_integrate')
      if (objects.status === 'conflict') {
        this.deps.teams.command({ ...this.operation(current, 'integration-conflict', this.id()), payload: { integrationId } }, tx => {
          const snapshot = tx.snapshot(), latest = snapshot.integrations.find(i => i.id === integrationId)!, task = snapshot.tasks.find(t => t.id === latest.taskId)!
          tx.writeIntegration({ ...latest, status: 'conflict', version: latest.version + 1, updatedAt: this.now(), blocker: 'Staging has retained conflicts.' }, latest.version)
          tx.writeTask({ ...task, status: 'needs-revision', version: task.version + 1, updatedAt: this.now(), blocker: 'Staging conflict; revise the helper result.' }, task.version)
          return { acknowledgment: {}, event: { integrationId, paths: objects.paths } }
        }); return
      }
      const intended = { ...integration, resultSha: objects.resultSha, version: integration.version + 1, updatedAt: this.now() }
      this.deps.teams.command({ ...this.operation(current, 'integration-objects', integration.preparationId), payload: { integrationId, treeSha: objects.treeSha, resultSha: objects.resultSha } }, tx => { tx.writeIntegration(intended, integration.version); return { acknowledgment: { integrationId, resultSha: objects.resultSha }, event: { integrationId, treeSha: objects.treeSha, resultSha: objects.resultSha, ref: teamIntegrationRef(intended) } } })
      await teamPublishIntegrationRef(row.path, intended)
      const [artifactDiff, preparedDiff] = await Promise.all([teamDiff(row.path, artifactBase, integration.artifactSha), teamDiff(row.path, integration.expectedHead, objects.resultSha)])
      current = this.authorize(run, actor, 'team_integrate')
      this.deps.teams.command({ ...this.operation(current, 'integration-prepared', this.id()), payload: { integrationId } }, tx => {
        const snapshot = tx.snapshot(), latest = snapshot.integrations.find(i => i.id === integrationId)!, task = snapshot.tasks.find(t => t.id === latest.taskId)!
        tx.writeIntegration({ ...latest, status: 'prepared', version: latest.version + 1, updatedAt: this.now() }, latest.version)
        tx.writeTask({ ...task, status: 'awaiting-review', version: task.version + 1, updatedAt: this.now() }, task.version)
        return { acknowledgment: {}, event: { integrationId, artifactSha: integration.artifactSha, expectedHead: integration.expectedHead, resultSha: objects.resultSha, artifactDiff, preparedDiff } }
      })
    } finally { clearTimeout(timer) }
  }
  private async applyIntegration(run: TeamRun, integrationId: string, actor: TeamActor): Promise<void> {
    teamAssert(this.deps.withLeadWriteLease, 'WRITE_LEASE_UNAVAILABLE', 'Promotion requires cooperative lead write coordination.')
    await this.deps.withLeadWriteLease(run, async () => {
      let current = this.authorize(run, actor, 'team_integrate'), integration = this.deps.teams.integrations(run.id).find(i => i.id === integrationId)!
      const row = this.integrationRow(current), observed = await this.observeIntegration(current, [integration.artifactSha, integration.resultSha!])
      beginPromotion(current, integration, observed, this.now())
      await teamPromoteIntegration(row.path, row.branch, integration.expectedHead, integration.resultSha!, () => {
        current = this.authorize(run, actor, 'team_integrate'); integration = this.deps.teams.integrations(run.id).find(i => i.id === integrationId)!
        const next = beginPromotion(current, integration, observed, this.now())
        this.deps.teams.command({ ...this.operation(current, 'integration-applying', this.id()), payload: { integrationId } }, tx => { tx.writeIntegration(next, integration.version); return { acknowledgment: {}, event: { integrationId, expectedHead: integration.expectedHead, resultSha: integration.resultSha } } })
      })
      const after = await this.observeIntegration(this.deps.teams.getRun(run.id), [integration.resultSha!])
      const classification = classifyPromotionRecovery({ ...integration, status: 'applying' }, after)
      const snapshot = this.deps.teams.snapshot(run.id), latest = snapshot.integrations.find(i => i.id === integrationId)!, task = snapshot.tasks.find(t => t.id === latest.taskId)!
      this.deps.teams.command({ ...this.operation(snapshot.run, 'integration-settled', this.id()), payload: { integrationId } }, tx => {
        tx.writeIntegration({ ...latest, status: classification.status, blocker: classification.status === 'applied' ? null : classification.reason, version: latest.version + 1, updatedAt: this.now() }, latest.version)
        if (classification.status === 'applied') tx.updateRun(snapshot.run.version, { ...snapshot.run, integrationHead: after.head, version: snapshot.run.version + 1, updatedAt: this.now() })
        else tx.updateRun(snapshot.run.version, { ...snapshot.run, status: snapshot.run.status === 'stopping' ? 'stopping' : 'blocked', blocker: classification.reason, version: snapshot.run.version + 1, updatedAt: this.now() })
        tx.writeTask({ ...task, status: classification.status === 'applied' ? 'awaiting-review' : 'blocked', blocker: classification.status === 'applied' ? null : classification.reason, version: task.version + 1, updatedAt: this.now() }, task.version)
        return { acknowledgment: {}, event: { integrationId, status: classification.status, head: after.head } }
      })
    })
  }
  async inspectRecovery(run: TeamRun): Promise<{ writersStopped: boolean; ordinaryDirty: boolean; ambiguousIntegration: boolean }> {
    const snapshot = this.deps.teams.snapshot(run.id)
    const knownStopped = await Promise.all(snapshot.attempts.map(a => a.cessation === 'not-started' ? Promise.resolve(true) : this.deps.writersStopped(a)))
    const writersStopped = knownStopped.every(Boolean) && await this.deps.leadStopped?.(run) === true
    let observed: TeamWorkspaceObservation
    try { observed = await this.observeIntegration(run) } catch { return { writersStopped, ordinaryDirty: false, ambiguousIntegration: true } }
    return { writersStopped, ordinaryDirty: !observed.clean, ambiguousIntegration: !observed.expectedBranch || !observed.expectedRepository || snapshot.integrations.some(i => ['applying', 'recovery-required', 'preparing'].includes(i.status)) || this.deps.teams.unfinishedOperations(run.id).length > 0 || await this.recoveryInspection?.(run.id) === true }
  }
  private recoveryInspection?: (runId: string) => Promise<boolean>
  bindRecoveryInspection(inspect: (runId: string) => Promise<boolean>): void { this.recoveryInspection = inspect }
  private assertPreparation(run: TeamRun, attemptId?: string): void {
    const snapshot = this.deps.teams.snapshot(run.id)
    teamAssert(snapshot.run.generation === run.generation && snapshot.run.status === (attemptId ? 'active' : 'preparing'), 'WORKSPACE_REVOKED', 'Workspace preparation authorization changed.')
    if (attemptId) { const attempt = snapshot.attempts.find(a => a.id === attemptId); teamAssert(attempt && attempt.status === 'preparing' && !attempt.terminalIntent, 'WORKSPACE_REVOKED', 'Attempt preparation was cancelled.') }
    this.deps.assertAuthorized(run.id, run.generation)
  }
  async prepareRun(run: TeamRun, signal: AbortSignal): Promise<{ baseSha: string; head: string; worktreeId: string }> {
    this.assertPreparation(run)
    const project = this.deps.storage.getProjectById(run.projectId)
    teamAssert(project, 'PROJECT_UNAVAILABLE', 'Team project no longer exists.')
    const repoRoot = await resolveMainRepoRoot(project.rootPath)
    teamAssert(repoRoot, 'REPOSITORY_UNAVAILABLE', 'Team project must have a committed Git repository.')
    const baseSha = await teamResolveCommit(repoRoot, run.config.baseRevision)
    signal.throwIfAborted(); this.assertPreparation(run)
    const request = this.id()
    const row = await this.deps.worktrees.createManagedWorktree({ projectId: run.projectId, repoRoot, baseSha, signal,
      assertAuthorized: () => this.assertPreparation(run),
      reserve: row => { const current = this.deps.teams.getRun(run.id); this.deps.teams.reserveWorkspace(this.operation(current, 'workspace-reserved', request), { kind: 'run', id: run.id, worktreeId: row.id, expectedVersion: current.version }) }
    })
    const head = await teamResolveCommit(row.path, 'HEAD')
    const status = await teamStatus(row.path)
    signal.throwIfAborted(); this.assertPreparation(run)
    teamAssert(head === baseSha && status.clean, 'WORKSPACE_CHANGED', 'New integration workspace is not at the selected clean base.')
    this.deps.teams.completeWorkspace(this.operation(this.deps.teams.getRun(run.id), 'workspace-completed', request), { worktreeId: row.id, head })
    return { baseSha, head, worktreeId: row.id }
  }
  async prepareAttempt(run: TeamRun, attempt: TeamAttempt, signal: AbortSignal): Promise<{ cwd: string; baseSha: string; worktreeId: string }> {
    this.assertPreparation(run, attempt.id)
    const integration = run.integrationWorktreeId ? this.deps.storage.getWorktreeById(run.integrationWorktreeId) : null
    teamAssert(integration && integration.projectId === run.projectId && attempt.baseSha, 'WORKSPACE_UNAVAILABLE', 'Attempt needs its run-owned integration workspace and reserved commit.')
    const request = this.id()
    const row = await this.deps.worktrees.createManagedWorktree({ projectId: run.projectId, repoRoot: integration.repoRoot, baseSha: attempt.baseSha, signal,
      assertAuthorized: () => this.assertPreparation(run, attempt.id),
      reserve: row => { const current = this.deps.teams.attempts(run.id).find(a => a.id === attempt.id)!; this.deps.teams.reserveWorkspace(this.operation(this.deps.teams.getRun(run.id), 'workspace-reserved', request), { kind: 'attempt', id: attempt.id, worktreeId: row.id, expectedVersion: current.version }) }
    })
    const head = await teamResolveCommit(row.path, 'HEAD')
    const status = await teamStatus(row.path)
    signal.throwIfAborted(); this.assertPreparation(run, attempt.id)
    teamAssert(head === attempt.baseSha && status.clean, 'WORKSPACE_CHANGED', 'New helper workspace is not at the reserved clean base.')
    this.deps.teams.completeWorkspace(this.operation(this.deps.teams.getRun(run.id), 'workspace-completed', request), { worktreeId: row.id, head })
    return { cwd: row.path, baseSha: head, worktreeId: row.id }
  }
  validateResult(run: TeamRun, task: TeamTask, attempt: TeamAttempt): Promise<void> {
    const existing = this.capturing.get(attempt.id)
    if (existing) return existing
    const work = this.captureResult(run, task, attempt)
    this.capturing.set(attempt.id, work)
    void work.then(() => this.capturing.delete(attempt.id), () => this.capturing.delete(attempt.id))
    return work
  }
  private async captureResult(run: TeamRun, task: TeamTask, original: TeamAttempt): Promise<void> {
    let attempt = this.deps.teams.attempts(run.id).find(a => a.id === original.id)!
    if (attempt.artifact || this.deps.teams.noChangesCapture(run.id, attempt.id)) return
    const row = attempt.worktreeId ? this.deps.storage.getWorktreeById(attempt.worktreeId) : null
    teamAssert(row && row.projectId === run.projectId && attempt.baseSha, 'WORKSPACE_UNAVAILABLE', 'Attempt workspace ownership is unavailable.')
    const [head, root, branch, status, writersStopped] = await Promise.all([teamResolveCommit(row.path, 'HEAD'), resolveMainRepoRoot(row.path), currentBranch(row.path), teamStatus(row.path), this.deps.writersStopped(attempt)])
    const observed = { head, expectedRepository: !!root && pathKey(root) === pathKey(row.repoRoot), expectedBranch: branch === row.branch, clean: status.clean, objectsPresent: true, writersStopped }
    const baseIsAncestor = await teamIsAncestor(row.path, attempt.baseSha, head)
    const fresh = this.deps.teams.snapshot(run.id)
    attempt = fresh.attempts.find(a => a.id === original.id)!
    const currentTask = fresh.tasks.find(t => t.id === task.id)!
    assertCaptureReady(fresh.run, currentTask, attempt, observed, baseIsAncestor)
    if (task.command.kind === 'analysis') return
    const reservation = this.deps.teams.captureReservation(run.id, attempt.id) ?? { runId: run.id, attemptId: attempt.id, captureId: this.id(), baseSha: attempt.baseSha!, ref: `refs/chorus/teams/${run.id}/artifacts/${attempt.id}`, authorName: 'Chorus' as const, authorEmail: 'chorus@localhost' as const, at: this.now() }
    this.deps.teams.reserveCapture(reservation, attempt.version, this.id())
    const objects = await teamCreateArtifactObjects(row.path, reservation, this.deps.generatedConfiguration?.(attempt) ?? [])
    teamAssert(await this.deps.writersStopped(attempt) && await currentBranch(row.path) === row.branch, 'WORKSPACE_CHANGED', 'Writer or branch changed during capture; retain the reservation.')
    if (objects.noChanges) {
      this.deps.teams.completeNoChangesCapture(reservation, objects.treeSha, this.id(), this.now())
      return
    }
    const artifact = { id: attempt.id, captureId: reservation.captureId, baseSha: objects.baseSha, finalHelperHead: objects.finalHelperHead, treeSha: objects.treeSha, commitSha: objects.commitSha!, ref: reservation.ref, manifest: objects.manifest, capturedAt: reservation.at }
    this.deps.teams.recordCaptureObjects(reservation, objects.treeSha, objects.commitSha!, this.id(), this.now(), artifact)
    await teamPublishArtifactRef(row.path, reservation, objects.commitSha!)
    attempt = this.deps.teams.attempts(run.id).find(a => a.id === attempt.id)!
    this.deps.teams.publishArtifact(run.id, artifact, attempt.version, this.id(), this.now())
  }
}
