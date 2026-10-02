import { TEAM_LIMITS, type TeamRun, type TeamTask, type TeamAttempt, type TeamIntegration, type TeamApprovalBinding, type TeamToolName } from '../../shared/team'

export class TeamDomainError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'TeamDomainError' }
}
export function teamAssert(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new TeamDomainError(code, message)
}
export type TeamActor = { role: 'user'; principal: string } | { role: 'lead'; runId: string; generation: number; epoch: string } | { role: 'system' }
export interface TeamCredentialFence { credentialId: string; fingerprint: string; providerId: string; authMode: string; routeIdentity: string }
export interface TeamLease { runId: string; generation: number; epoch: string; mode: 'normal' | 'recovery'; credentials: readonly TeamCredentialFence[]; leadCredentialId: string | null; revoked: boolean }
const inspection = new Set<TeamToolName>(['team_roster', 'team_status', 'team_wait', 'team_detail'])
export const terminalAttempt = (attempt: TeamAttempt): boolean => !['preparing', 'running', 'cancelling'].includes(attempt.status)
export const holdsSlot = (attempt: TeamAttempt): boolean => !terminalAttempt(attempt) || attempt.cessation === 'unknown' || attempt.cessation === 'live'
export function assertLeadAuthority(run: TeamRun, lease: TeamLease | undefined, actor: TeamActor, operation: TeamToolName): void {
  teamAssert(actor.role === 'lead' && actor.runId === run.id && actor.generation === run.generation, 'UNAUTHORIZED', 'Lead identity is stale or belongs to another run.')
  teamAssert(lease && !lease.revoked && lease.runId === run.id && lease.generation === run.generation && actor.epoch === lease.epoch, 'LEASE_REVOKED', 'Team authorization is unavailable.')
  teamAssert(['preparing', 'active', 'finishing', 'pausing', 'recovering'].includes(run.status), 'RUN_INACTIVE', 'The run is not accepting lead operations.')
  if (lease.mode === 'recovery' || run.status !== 'active') teamAssert(inspection.has(operation), 'INSPECTION_ONLY', 'This run currently allows inspection only.')
}
export function assertDispatchFence(run: TeamRun, lease: TeamLease | undefined, expected: { generation: number; epoch: string; credential?: TeamCredentialFence }, currentCredential?: TeamCredentialFence): void {
  teamAssert(run.status === 'active' && lease && !lease.revoked && lease.mode === 'normal' && lease.runId === run.id && lease.generation === run.generation && expected.generation === run.generation && expected.epoch === lease.epoch, 'LEASE_REVOKED', 'Dispatch authorization changed.')
  if (expected.credential) {
    const matches = (a: TeamCredentialFence | undefined, b: TeamCredentialFence) => a !== undefined && a.credentialId === b.credentialId && a.fingerprint === b.fingerprint && a.providerId === b.providerId && a.authMode === b.authMode && a.routeIdentity === b.routeIdentity
    teamAssert(matches(currentCredential, expected.credential) && lease.credentials.some(c => matches(c, expected.credential!)), 'CREDENTIAL_CHANGED', 'The selected credential relationship changed.')
  } else teamAssert(currentCredential === undefined, 'AUTH_MODE_CHANGED', 'Subscription dispatch cannot receive an API credential.')
}

export function assertDependencies(runId: string, dependencies: readonly string[], tasks: readonly TeamTask[]): void {
  for (const id of dependencies) teamAssert(tasks.some(t => t.id === id && t.runId === runId), 'INVALID_DEPENDENCY', 'Dependencies must be existing tasks in this run.')
}
export function dependencyState(task: TeamTask, tasks: readonly TeamTask[]): 'ready' | 'waiting' | 'blocked' {
  const dependencies = task.command.dependsOn.map(id => tasks.find(t => t.id === id && t.runId === task.runId))
  if (dependencies.some(t => !t || ['failed', 'cancelled', 'blocked', 'needs-revision'].includes(t.status))) return 'blocked'
  return dependencies.every(t => t?.status === 'completed') ? 'ready' : 'waiting'
}
export function refreshTaskReadiness(task: TeamTask, tasks: readonly TeamTask[], now: string): TeamTask {
  const state = dependencyState(task, tasks)
  if (task.status === 'queued' && state === 'blocked') return { ...task, status: 'blocked', blocker: 'Dependency blocked.', readyAt: null, version: task.version + 1, updatedAt: now }
  if ((task.status === 'queued' && task.readyAt === null || task.status === 'blocked' && task.blocker === 'Dependency blocked.') && state === 'ready') return { ...task, status: 'queued', blocker: null, readyAt: now, version: task.version + 1, updatedAt: now }
  return task
}
export interface AttemptReservation { task: TeamTask; attempt: TeamAttempt; effect: { type: 'prepare-workspace'; runId: string; attemptId: string; generation: number } }
/** Windows paths are case insensitive. Unknown/glob scopes conservatively own the whole workspace. */
export function teamPathsOverlap(left: readonly string[], right: readonly string[]): boolean {
  const normalize = (value: string) => value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '').toLowerCase()
  const unknown = (paths: readonly string[]) => !paths.length || paths.some(p => !normalize(p) || normalize(p) === '.' || /[*?\[\]{}:]/.test(p) || p.split(/[\\/]/).includes('..'))
  if (unknown(left) || unknown(right)) return true
  return left.some(a => right.some(b => { const x = normalize(a), y = normalize(b); return x === y || x.startsWith(y + '/') || y.startsWith(x + '/') }))
}
export function taskScopeBusy(task: TeamTask, tasks: readonly TeamTask[], attempts: readonly TeamAttempt[]): boolean {
  if (task.command.kind === 'analysis') return false
  return tasks.some(other => other.id !== task.id && other.runId === task.runId && other.command.kind === 'code'
    && (['running', 'awaiting-review', 'awaiting-approval', 'integrating', 'needs-revision'].includes(other.status) || attempts.some(a => a.taskId === other.id && holdsSlot(a)))
    && teamPathsOverlap(task.command.paths, other.command.paths))
}
/** Unknown scopes remain legacy-compatible; explicit ownership is enforced at capture. */
export function assertArtifactScope(paths: readonly string[], changed: readonly string[]): void {
  const normalize = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '').toLowerCase()
  if (!paths.length || paths.some(p => !normalize(p) || normalize(p) === '.' || /[*?\[\]{}:]/.test(p) || p.split(/[\\/]/).includes('..'))) return
  const outside = changed.filter(p => !paths.some(scope => normalize(p) === normalize(scope) || normalize(p).startsWith(normalize(scope) + '/')))
  teamAssert(!outside.length, 'OUT_OF_SCOPE', `Helper changed files outside its declared ownership: ${outside.slice(0, 12).join(', ')}`)
}
/** Caller commits this reservation and its event before starting the returned effect. */
export function reserveNextAttempt(run: TeamRun, tasks: readonly TeamTask[], attempts: readonly TeamAttempt[], attemptId: string, now: string): AttemptReservation | null {
  if (run.status !== 'active' || attempts.filter(a => a.runId === run.id && holdsSlot(a)).length >= run.config.concurrency) return null
  const task = tasks.filter(t => t.runId === run.id && t.status === 'queued' && dependencyState(t, tasks) === 'ready' && !taskScopeBusy(t, tasks, attempts))
    .sort((a, b) => (a.readyAt ?? a.createdAt).localeCompare(b.readyAt ?? b.createdAt) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))[0]
  if (!task) return null
  teamAssert(task.attemptCount < TEAM_LIMITS.attempts, 'ATTEMPTS_EXHAUSTED', 'This task has used all three attempts.')
  teamAssert(run.config.helpers.some(m => m.id === task.command.memberId), 'UNKNOWN_MEMBER', 'The selected helper is not in this run.')
  teamAssert(run.integrationHead !== null, 'WORKSPACE_NOT_READY', 'The integration workspace is not ready.')
  // Only immutable, successfully captured work is eligible. A failed retry's
  // partial files never become a seed; the last captured implementation remains.
  const prior = task.command.kind === 'code' ? attempts.filter(a => a.runId === run.id && a.taskId === task.id && a.status === 'succeeded' && a.cessation === 'confirmed' && a.artifact).sort((a, b) => b.number - a.number)[0] : undefined
  const attempt: TeamAttempt = {
    id: attemptId, taskId: task.id, runId: run.id, number: task.attemptCount + 1, memberId: task.command.memberId,
    generation: run.generation, status: 'preparing', version: 1, baseSha: run.integrationHead, worktreeId: null,
    ...(prior?.artifact ? { revisionSeed: { attemptId: prior.id, artifactSha: prior.artifact.commitSha, artifactBaseSha: prior.artifact.baseSha } } : {}),
    brief: task.command.brief, context: task.command.context, acceptance: [...task.command.acceptance],
    process: null, descendants: [], cessation: 'not-started', preparationDeadline: new Date(Date.parse(now) + TEAM_LIMITS.preparationMs).toISOString(),
    executionDeadline: null, startedAt: null, endedAt: null, terminalIntent: null, result: null, artifact: null, usage: [], blocker: null
  }
  return { task: { ...task, status: 'running', currentAttemptId: attemptId, attemptCount: attempt.number, version: task.version + 1, updatedAt: now, blocker: null }, attempt, effect: { type: 'prepare-workspace', runId: run.id, attemptId, generation: run.generation } }
}
export function startAttempt(run: TeamRun, attempt: TeamAttempt, process: NonNullable<TeamAttempt['process']>, now: string): TeamAttempt {
  teamAssert(run.status === 'active' && attempt.generation === run.generation && attempt.status === 'preparing' && attempt.terminalIntent === null && Date.parse(now) < Date.parse(attempt.preparationDeadline), 'STALE_ATTEMPT', 'Attempt preparation is no longer authorized.')
  teamAssert(attempt.worktreeId !== null, 'WORKSPACE_NOT_READY', 'Attempt workspace is not ready.')
  return { ...attempt, status: 'running', version: attempt.version + 1, process, cessation: 'live', startedAt: now, executionDeadline: new Date(Date.parse(now) + run.config.executionMinutes * 60000).toISOString() }
}
export function requestAttemptTermination(attempt: TeamAttempt, intent: 'cancelled' | 'timed-out'): TeamAttempt {
  if (terminalAttempt(attempt)) return attempt
  return { ...attempt, status: 'cancelling', terminalIntent: attempt.terminalIntent ?? intent, version: attempt.version + 1 }
}
export interface AttemptExit { generation: number; attemptId: string; exitCode: number | null; cessation: 'confirmed' | 'unknown'; result: TeamAttempt['result']; permissionBlocked: boolean; protocolError: boolean; now: string }
export function settleAttempt(run: TeamRun, task: TeamTask, attempt: TeamAttempt, exit: AttemptExit): { task: TeamTask; attempt: TeamAttempt; changed: boolean } {
  teamAssert(exit.attemptId === attempt.id && exit.generation === attempt.generation, 'WRONG_ATTEMPT', 'Process callback identity does not match its attempt.')
  if (terminalAttempt(attempt)) return { task, attempt, changed: false }
  const status = attempt.terminalIntent ?? (exit.permissionBlocked ? 'permission-blocked' : exit.exitCode === 0 && exit.result && !exit.result.isError && !exit.protocolError && exit.cessation === 'confirmed' ? 'succeeded' : 'failed')
  const next: TeamAttempt = { ...attempt, status, version: attempt.version + 1, endedAt: exit.now, cessation: exit.cessation, result: exit.result,
    blocker: exit.cessation === 'unknown' ? 'Owned process cessation could not be confirmed; workspace and slot remain reserved.' : status === 'succeeded' ? null : `Attempt ended: ${status}.` }
  if (attempt.generation !== run.generation || task.currentAttemptId !== attempt.id) return { task, attempt: next, changed: true }
  return { attempt: next, changed: true, task: { ...task, version: task.version + 1, updatedAt: exit.now,
    status: exit.cessation === 'unknown' ? 'blocked' : status === 'succeeded' ? 'awaiting-review' : status === 'cancelled' ? 'cancelled' : status === 'permission-blocked' ? 'blocked' : 'failed', blocker: next.blocker } }
}
// Blockers are limited in UTF-8 bytes; a UTF-16 slice lets non-ASCII errors overflow them.
export function fitUtf8(text: string, bytes: number): string {
  const encoded = new TextEncoder().encode(text)
  return encoded.byteLength <= bytes ? text : new TextDecoder().decode(encoded.subarray(0, bytes)).replace(/�+$/, '')
}
export function failPreparation(run: TeamRun, task: TeamTask, attempt: TeamAttempt, now: string, reason: string): { task: TeamTask; attempt: TeamAttempt } {
  teamAssert(attempt.status === 'preparing' || (attempt.status === 'cancelling' && attempt.process === null), 'STALE_ATTEMPT', 'Only an unspawned preparation can fail here.')
  const result = settleAttempt(run, task, attempt, { attemptId: attempt.id, generation: attempt.generation, exitCode: null, cessation: 'confirmed', result: null, permissionBlocked: false, protocolError: false, now })
  return { task: attempt.generation === run.generation && task.currentAttemptId === attempt.id ? { ...result.task, blocker: reason } : result.task, attempt: { ...result.attempt, blocker: reason } }
}
export function reviseTask(run: TeamRun, task: TeamTask, attempts: readonly TeamAttempt[], memberId: string, brief: string, now: string): TeamTask {
  teamAssert(run.status === 'active', 'RUN_INACTIVE', 'Revisions require an active run.')
  teamAssert(['needs-revision', 'failed', 'blocked', 'awaiting-review'].includes(task.status), 'NOT_REVISABLE', 'This task is not ready for revision.')
  teamAssert(task.attemptCount < TEAM_LIMITS.attempts && !attempts.some(a => a.taskId === task.id && holdsSlot(a)), 'ATTEMPTS_UNAVAILABLE', 'Attempts are exhausted or prior processes remain unaccounted for.')
  teamAssert(run.config.helpers.some(m => m.id === memberId), 'UNKNOWN_MEMBER', 'The selected helper is not in this run.')
  return { ...task, command: { ...task.command, memberId, brief }, status: 'queued', readyAt: now, version: task.version + 1, updatedAt: now, blocker: null }
}
export function canFinishDraining(run: TeamRun, attempts: readonly TeamAttempt[], integrations: readonly TeamIntegration[]): boolean {
  return !attempts.some(a => a.runId === run.id && holdsSlot(a)) && !integrations.some(i => i.runId === run.id && i.status === 'applying')
}
export function transitionRun(run: TeamRun, action: 'activate' | 'pause' | 'drained' | 'stop' | 'stopped' | 'resume' | 'recover' | 'complete' | 'boot', evidence: { now: string; bridgeReady?: boolean; priorLeadStopped?: boolean; writersStopped?: boolean; ordinaryDirty?: boolean; ambiguousIntegration?: boolean; drained?: boolean; unfinished?: boolean }): TeamRun {
  let status = run.status, generation = run.generation
  switch (action) {
    case 'activate': teamAssert(run.status === 'preparing' && evidence.bridgeReady === true, 'BRIDGE_NOT_READY', 'Activate requires the existing lead bridge handshake.'); status = 'active'; break
    case 'pause': teamAssert(['active', 'preparing'].includes(status), 'INVALID_STATE', 'Only a preparing or active run can pause.'); status = evidence.drained ? 'paused' : 'pausing'; break
    case 'drained': teamAssert(status === 'pausing' && evidence.drained, 'NOT_DRAINED', 'The run still owns active work.'); status = 'paused'; break
    case 'stop': teamAssert(status !== 'stopped', 'INVALID_STATE', 'Run is already stopped.'); status = 'stopping'; break
    case 'stopped': teamAssert(status === 'stopping' && evidence.drained && evidence.priorLeadStopped, 'NOT_STOPPED', 'Owned processes or integration effects remain active.'); status = 'stopped'; break
    case 'resume': teamAssert(['paused', 'completed', 'recovering', 'blocked'].includes(status) && evidence.priorLeadStopped && evidence.writersStopped && !evidence.ordinaryDirty && !evidence.ambiguousIntegration, 'RECOVERY_REQUIRED', 'Resume needs confirmed cessation and clean, unambiguous workspace evidence.'); status = 'preparing'; generation++; break
    case 'recover': teamAssert(['paused', 'blocked'].includes(status) && evidence.priorLeadStopped && evidence.writersStopped && evidence.ordinaryDirty && !evidence.ambiguousIntegration, 'RECOVERY_REQUIRED', 'Recovery inspection requires known stopped writers and ordinary retained dirt.'); status = 'recovering'; generation++; break
    case 'complete': teamAssert(status === 'active' && evidence.drained && !evidence.unfinished, 'UNFINISHED_WORK', 'Complete requires no unfinished tasks or integration.'); status = 'completed'; break
    case 'boot': if (!['stopped', 'completed'].includes(status)) status = 'paused'; break
  }
  return { ...run, status, generation, blocker: ['activate', 'resume', 'recover'].includes(action) ? null : run.blocker, version: run.version + 1, updatedAt: evidence.now }
}
export function approvalMatches(binding: TeamApprovalBinding, integration: TeamIntegration): boolean {
  return binding.integrationId === integration.id && binding.preparationId === integration.preparationId && binding.artifactSha === integration.artifactSha && binding.integrationHead === integration.expectedHead && binding.resultSha === integration.resultSha && binding.policyVersion === integration.policyVersion
}
export function assertIntegrationApply(run: TeamRun, integration: TeamIntegration, currentHead: string, clean: boolean): void {
  teamAssert(run.status === 'active' && integration.runId === run.id && integration.resultSha && integration.preparedReviewId && ['prepared', 'approved', 'awaiting-approval'].includes(integration.status), 'NOT_PREPARED', 'Apply requires accepted prepared content in an active run.')
  teamAssert(clean && currentHead === integration.expectedHead && run.policyVersion === integration.policyVersion, 'STALE_PREPARATION', 'The integration workspace or policy changed.')
  // Legacy ask-policy records remain readable, but human approval is no longer an execution gate.
}
