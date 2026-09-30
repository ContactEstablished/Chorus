import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { teamArtifactSchema, type TeamAttempt, type TeamRun, type TeamEvent } from '../../shared/team'
import { TeamStorage, hashTeamPayload } from './teamStorage'
import type { StorageService } from './storage'
import { teamAssert } from './teamCore'
import { interruptedAtBoot, recoveryDisposition, type TeamRecoveryEvidence } from './teamRecoveryCore'
import { classifyPromotionRecovery, type TeamWorkspaceObservation } from './teamWorkspaceCore'
import { currentBranch, resolveMainRepoRoot, teamStatus, teamResolveCommit, teamReadCommit, teamListPrivateRefs, teamIntegrationRef, teamTreePaths, teamDiff } from './git'

interface Dependencies {
  storage: StorageService; teams: TeamStorage
  stopLead(run: TeamRun): Promise<boolean>
  stopAttempt(attempt: TeamAttempt): Promise<boolean>
  unavailable(runId: string, reason: string): void
}
export interface TeamRecoveryReport { runs: Array<{ runId: string; status: string; blocker: string | null }>; unavailable: string[] }
const samePath = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()

/** Deliberately has no credential, lease, process-spawn, prompt or Git-mutation dependency. */
export class TeamRecoveryService {
  constructor(private readonly deps: Dependencies) {}
  private journal(run: TeamRun, operation: string, change: Parameters<TeamStorage['command']>[1]): void {
    this.deps.teams.command({ runId: run.id, generation: run.generation, operation, actor: 'system', eventId: randomUUID(), now: new Date().toISOString() }, change)
  }
  private events(runId: string): TeamEvent[] {
    const events: TeamEvent[] = []; let after = 0
    for (;;) { const page = this.deps.teams.events(runId, after); if (!page.length) return events; events.push(...page); after = page.at(-1)!.sequence }
  }
  /** Read-only inspection is also required immediately before an explicit replacement. */
  async inspectRun(runId: string): Promise<TeamRecoveryEvidence> { return this.inspectWorkspace(this.deps.teams.getRun(runId), false, false) }
  private async inspectWorkspace(run: TeamRun, writersStopped: boolean, heal: boolean): Promise<TeamRecoveryEvidence> {
    const { storage, teams } = this.deps, snapshot = teams.snapshot(run.id), blockers: string[] = [], events = this.events(run.id)
    const row = run.integrationWorktreeId ? storage.getWorktreeById(run.integrationWorktreeId) : null
    if (!row || row.projectId !== run.projectId) return { writersStopped, ordinaryDirty: false, blockers: ['Integration workspace ownership is missing. Retained launch requires inspection.'] }
    let observed: TeamWorkspaceObservation
    try {
      const [root, branch, status, head] = await Promise.all([resolveMainRepoRoot(row.path), currentBranch(row.path), teamStatus(row.path), teamResolveCommit(row.path, 'HEAD')])
      observed = { head, clean: status.clean, expectedRepository: !!root && samePath(root, row.repoRoot), expectedBranch: branch === row.branch, writersStopped, objectsPresent: true }
      if (!observed.expectedRepository || !observed.expectedBranch) blockers.push('Integration repository or branch identity changed.')
    } catch { return { writersStopped, ordinaryDirty: false, blockers: ['Integration workspace is missing or unreadable.'] } }
    const refs = new Map((await teamListPrivateRefs(row.path, run.id)).map(item => [item.ref, item.sha])), knownRefs = new Set<string>()
    if (run.finish) {
      for (const finish of events.filter(e => e.operation === 'finish' && typeof e.payload.sha === 'string')) knownRefs.add(`refs/chorus/teams/${run.id}/final/${finish.payload.sha}`)
      const finalRef = `refs/chorus/teams/${run.id}/final/${run.finish.sha}`; knownRefs.add(finalRef)
      if (refs.has(finalRef) && refs.get(finalRef) !== run.finish.sha) blockers.push('Final Team result ref changed; retained publication requires inspection.')
    }
    const checkWorkspace = async (id: string | null) => {
      if (!id) return
      const worktree = storage.getWorktreeById(id)
      try {
        teamAssert(worktree && worktree.projectId === run.projectId && samePath(worktree.repoRoot, row.repoRoot), 'WORKSPACE_IDENTITY', 'Workspace ownership changed.')
        const [root, branch] = await Promise.all([resolveMainRepoRoot(worktree.path), currentBranch(worktree.path)])
        teamAssert(root && samePath(root, row.repoRoot) && branch === worktree.branch, 'WORKSPACE_IDENTITY', 'Workspace repository or branch changed.')
      } catch { blockers.push(`Retained workspace ${id} is missing or its identity changed.`) }
    }
    for (const attempt of snapshot.attempts) {
      await checkWorkspace(attempt.worktreeId)
      const reservation = teams.captureReservation(run.id, attempt.id)
      const intended = reservation ? events.find(e => e.operation === 'capture-objects' && e.clientRequestId === reservation.captureId) : undefined
      const recovered = !attempt.artifact && intended?.payload.artifact ? teamArtifactSchema.parse(intended.payload.artifact) : null
      const artifact = attempt.artifact ?? recovered
      if (reservation) knownRefs.add(reservation.ref)
      if (!artifact) {
        if (reservation && teams.noChangesCapture(run.id, attempt.id) && refs.has(reservation.ref)) blockers.push(`No-change capture ${reservation.captureId} has an unexpected artifact ref.`)
        if (reservation && !teams.noChangesCapture(run.id, attempt.id)) blockers.push(`Capture ${reservation.captureId} has incomplete immutable metadata; retained objects were not replayed.`)
        continue
      }
      knownRefs.add(artifact.ref)
      try {
        teamAssert(reservation && artifact.ref === `refs/chorus/teams/${run.id}/artifacts/${attempt.id}` && refs.get(artifact.ref) === artifact.commitSha, 'ARTIFACT_REF', 'Artifact ref is missing or changed.')
        const commit = await teamReadCommit(row.path, artifact.commitSha)
        teamAssert(commit.tree === artifact.treeSha && commit.parents.length === 1 && commit.parents[0] === artifact.baseSha && commit.message.trim() === `Chorus team artifact\n\nRun: ${run.id}\nAttempt: ${attempt.id}\nCapture: ${artifact.captureId}`, 'ARTIFACT_IDENTITY', 'Artifact commit identity changed.')
        const manifest = await teamTreePaths(row.path, artifact.treeSha)
        teamAssert(JSON.stringify(manifest) === JSON.stringify(artifact.manifest), 'ARTIFACT_MANIFEST', 'Artifact manifest changed.')
        if (recovered && heal && writersStopped) teams.publishArtifact(run.id, recovered, attempt.version, randomUUID(), new Date().toISOString())
      } catch { blockers.push(`Artifact ${attempt.id} lacks exact journal/ref/object proof. Retained evidence requires inspection.`) }
    }
    for (const integration of snapshot.integrations) {
      await checkWorkspace(integration.stagingWorktreeId)
      const ref = teamIntegrationRef(integration); knownRefs.add(ref)
      let objectsPresent = !!integration.resultSha
      if (!integration.resultSha && refs.has(ref)) blockers.push(`Integration ${integration.id} has a ref without journaled result identity.`)
      if (integration.resultSha) {
        try {
          const commit = await teamReadCommit(row.path, integration.resultSha)
          const intent = events.find(e => e.operation === 'integration-objects' && e.payload.integrationId === integration.id && e.payload.resultSha === integration.resultSha)
          teamAssert(refs.get(ref) === integration.resultSha && intent?.payload.treeSha === commit.tree && commit.parents.length === 1 && commit.parents[0] === integration.expectedHead && commit.message.trim() === `Chorus team integration\n\nRun: ${run.id}\nIntegration: ${integration.id}\nPreparation: ${integration.preparationId}`, 'INTEGRATION_IDENTITY', 'Prepared identity is incomplete.')
        } catch { objectsPresent = false; blockers.push(`Prepared integration ${integration.id} lacks exact ref/object proof.`) }
      }
      if (['applying', 'recovery-required'].includes(integration.status)) {
        const intent = events.some(e => e.operation === 'integration-applying' && e.payload.integrationId === integration.id && e.payload.expectedHead === integration.expectedHead && e.payload.resultSha === integration.resultSha)
        const result = classifyPromotionRecovery({ ...integration, status: 'applying' }, { ...observed, objectsPresent: objectsPresent && intent })
        if (result.action === 'block') blockers.push(`Integration ${integration.id}: ${result.reason}`)
        else if (heal && writersStopped) this.journal(teams.getRun(run.id), 'recovery-integration', tx => {
          tx.writeIntegration({ ...integration, status: result.status, approval: null, blocker: result.reason, version: integration.version + 1, updatedAt: new Date().toISOString() }, integration.version)
          const task = tx.snapshot().tasks.find(t => t.id === integration.taskId)!
          if (task.currentAttemptId === integration.attemptId && task.status === 'integrating') tx.writeTask({ ...task, status: 'awaiting-review', version: task.version + 1, updatedAt: new Date().toISOString() }, task.version)
          const current = tx.snapshot().run
          if (result.status === 'applied' && current.integrationHead !== integration.resultSha) tx.updateRun(current.version, { ...current, integrationHead: integration.resultSha, version: current.version + 1, updatedAt: new Date().toISOString() })
          return { acknowledgment: {}, event: { integrationId: integration.id, status: result.status, head: observed.head } }
        })
        else if (!heal) blockers.push(`Integration ${integration.id} requires boot reconciliation before replacement.`)
      } else if (heal && writersStopped && ['prepared', 'awaiting-approval', 'approved'].includes(integration.status) && observed.head !== integration.expectedHead) {
        this.journal(teams.getRun(run.id), 'recovery-stale-preparation', tx => {
          tx.writeIntegration({ ...integration, status: 'rejected', approval: null, blocker: 'Integration HEAD changed; prior decisions remain historical. Prepare and review a new result.', version: integration.version + 1, updatedAt: new Date().toISOString() }, integration.version)
          return { acknowledgment: {}, event: { integrationId: integration.id, expectedHead: integration.expectedHead, actualHead: observed.head } }
        })
      } else if (integration.status === 'preparing') {
        if (heal && writersStopped && (!integration.resultSha || objectsPresent)) {
          const attempt = snapshot.attempts.find(a => a.id === integration.attemptId)
          const diffs = integration.resultSha && attempt?.baseSha ? {
            artifactDiff: await teamDiff(row.path, attempt.baseSha, integration.artifactSha),
            preparedDiff: await teamDiff(row.path, integration.expectedHead, integration.resultSha)
          } : null
          this.journal(teams.getRun(run.id), diffs ? 'integration-prepared' : 'recovery-preparation-interrupted', tx => {
            tx.writeIntegration({ ...integration, status: diffs ? 'prepared' : 'interrupted', approval: null, preparedReviewId: null, blocker: diffs ? null : 'Preparation was interrupted; staging is retained. The lead may request a new preparation.', version: integration.version + 1, updatedAt: new Date().toISOString() }, integration.version)
            const task = tx.snapshot().tasks.find(t => t.id === integration.taskId)!
            if (task.currentAttemptId === integration.attemptId && task.status === 'integrating') tx.writeTask({ ...task, status: 'awaiting-review', version: task.version + 1, updatedAt: new Date().toISOString() }, task.version)
            return { acknowledgment: {}, event: { integrationId: integration.id, artifactSha: integration.artifactSha, expectedHead: integration.expectedHead, resultSha: integration.resultSha, recovered: true, ...(diffs ?? {}) } }
          })
        } else blockers.push(`Preparation ${integration.id} was interrupted; staging is retained without replay.`)
      }
    }
    for (const ref of refs.keys()) if (!knownRefs.has(ref)) blockers.push(`Unowned private ref ${ref} is retained and blocks recovery.`)
    for (const operation of teams.unfinishedOperations(run.id)) {
      if (operation.operation === 'capture-reserved') continue // Classified above, including ref-published metadata recovery.
      let healed = false
      if (heal && writersStopped && typeof operation.payload.worktreeId === 'string' && operation.clientRequestId) {
        const retained = storage.getWorktreeById(operation.payload.worktreeId)
        try {
          teamAssert(retained && retained.projectId === run.projectId && samePath(retained.repoRoot, row.repoRoot), 'WORKSPACE_IDENTITY', 'Reserved workspace ownership changed.')
          const [root, branch, status, head] = await Promise.all([resolveMainRepoRoot(retained.path), currentBranch(retained.path), teamStatus(retained.path), teamResolveCommit(retained.path, 'HEAD')])
          teamAssert(root && samePath(root, row.repoRoot) && branch === retained.branch && status.clean && head === retained.baseBranch, 'WORKSPACE_IDENTITY', 'Reserved workspace is not at its clean recorded base.')
          const current = teams.getRun(run.id)
          teams.completeWorkspace({ runId: run.id, generation: current.generation, operation: 'workspace-completed', actor: 'system', eventId: randomUUID(), clientRequestId: operation.clientRequestId, now: new Date().toISOString() }, { worktreeId: retained.id, head })
          if (operation.payload.kind === 'run' && !current.baseSha && !current.integrationHead) this.journal(current, 'recovery-workspace-linked', tx => {
            tx.updateRun(current.version, { ...current, baseSha: head, integrationHead: head, version: current.version + 1, updatedAt: new Date().toISOString() })
            return { acknowledgment: {}, event: { worktreeId: retained.id, head } }
          })
          healed = true
        } catch { /* Retain the reservation unless every recorded identity matches. */ }
      }
      if (!healed) blockers.push(`Workspace reservation ${operation.clientRequestId} is incomplete; no Git operation was replayed.`)
    }
    return { writersStopped, ordinaryDirty: !observed.clean, blockers }
  }
  async reconcileAll(): Promise<TeamRecoveryReport> {
    const report: TeamRecoveryReport = { runs: [], unavailable: [] }, { teams } = this.deps
    for (const runId of teams.listRunIds()) {
      try {
        let snapshot = teams.snapshot(runId)
        const leadStopped = await this.deps.stopLead(snapshot.run), stopped = new Map<string, boolean>()
        for (const attempt of snapshot.attempts) stopped.set(attempt.id, await this.deps.stopAttempt(attempt))
        snapshot = teams.snapshot(runId) // Orphan intent may have persisted newly observed descendants.
        const writersStopped = leadStopped && [...stopped.values()].every(Boolean), now = new Date().toISOString()
        if (snapshot.run.finish?.publishedAt || snapshot.run.finish?.status === 'cleaned' || snapshot.run.finish?.status === 'retained') {
          // Archived snapshots keep removed workspace IDs as provenance, not as restore targets.
          const blocker = writersStopped ? snapshot.run.blocker : 'An archived Team process could not be proven stopped.'
          if (snapshot.run.status !== 'completed' || snapshot.run.blocker !== blocker) this.journal(snapshot.run, 'finish-archive-restored', tx => { tx.updateRun(snapshot.run.version, { ...snapshot.run, status: 'completed', blocker, version: snapshot.run.version + 1, updatedAt: now }); return { acknowledgment: {}, event: { writersStopped, archived: true } } })
          report.runs.push({ runId, status: 'completed', blocker }); continue
        }
        if (snapshot.run.finish?.status === 'publishing' && snapshot.run.destination) {
          const run = snapshot.run, destination = run.destination!, head = await teamResolveCommit(destination.cwd, 'HEAD')
          if (writersStopped && await currentBranch(destination.cwd) === destination.branch && (await teamStatus(destination.cwd)).clean && head === run.finish!.sha) {
            this.journal(run, 'finish-publication-reconciled', tx => { tx.updateRun(run.version, { ...run, status: 'completed', finish: { ...run.finish!, status: 'published', publishedAt: now, blocker: 'Publication recovered. Retry cleanup explicitly; no deletion was performed at boot.' }, blocker: 'Publication recovered. Retry cleanup explicitly.', version: run.version + 1, updatedAt: now }); return { acknowledgment: {}, event: { observedHead: head, replayed: false } } })
            report.runs.push({ runId, status: 'completed', blocker: 'Publication recovered. Retry cleanup explicitly.' }); continue
          }
          if (head !== destination.head) {
            const blocker = 'Destination matches neither the recorded base nor the verified publication. Inspect retained evidence.'
            if (run.status !== 'blocked' || run.blocker !== blocker || teams.latestEvent(runId, 'finish-publication-ambiguous')?.payload.observedHead !== head)
              this.journal(run, 'finish-publication-ambiguous', tx => { tx.updateRun(run.version, { ...run, status: 'blocked', blocker, version: run.version + 1, updatedAt: now }); return { acknowledgment: {}, event: { observedHead: head, replayed: false } } })
            report.runs.push({ runId, status: 'blocked', blocker }); continue
          }
        }
        const changed = snapshot.attempts.map(a => interruptedAtBoot(a, stopped.get(a.id) === true, now)).filter(a => a !== snapshot.attempts.find(old => old.id === a.id))
        if (changed.length) this.journal(snapshot.run, 'recovery-attempts', tx => {
          for (const attempt of changed) {
            tx.writeAttempt(attempt, attempt.version - 1)
            const task = snapshot.tasks.find(t => t.currentAttemptId === attempt.id)
            if (task && ['preparing', 'running'].includes(task.status)) tx.writeTask({ ...task, status: 'needs-revision', blocker: 'Previous attempt was interrupted. Review retained output before a counted revision.', version: task.version + 1, updatedAt: now }, task.version)
          }
          return { acknowledgment: {}, event: { attempts: changed.map(a => a.id), writersStopped } }
        })
        const evidence = await this.inspectWorkspace(teams.getRun(runId), writersStopped, true)
        snapshot = teams.snapshot(runId)
        const disposition = recoveryDisposition(snapshot.run, evidence)
        const fingerprint = hashTeamPayload({ ...evidence, ...disposition, attempts: snapshot.attempts.map(a => [a.id, a.status, a.cessation]), integrations: snapshot.integrations.map(i => [i.id, i.status, i.resultSha]) })
        if (teams.latestEvent(runId, 'recovery-reconciled')?.payload.fingerprint !== fingerprint || snapshot.run.status !== disposition.status || snapshot.run.blocker !== disposition.blocker) {
          const run = snapshot.run, terminal = ['completed', 'stopped'].includes(run.status)
          this.journal(run, 'recovery-reconciled', tx => {
            tx.updateRun(run.version, { ...run, ...disposition, generation: terminal ? run.generation : run.generation + 1, version: run.version + 1, updatedAt: now })
            return { acknowledgment: {}, event: { fingerprint, status: disposition.status, writersStopped, blockers: evidence.blockers, ordinaryDirty: evidence.ordinaryDirty } }
          })
        }
        report.runs.push({ runId, ...disposition })
      } catch {
        this.deps.unavailable(runId, 'Stored Team state or recovery evidence is unavailable. No lead, helper or credential was automatically started.')
        report.unavailable.push(runId)
      }
    }
    return report
  }
}
