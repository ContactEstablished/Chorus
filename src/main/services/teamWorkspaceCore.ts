import type { TeamApprovalBinding, TeamAttempt, TeamIntegration, TeamReview, TeamRun, TeamTask } from '../../shared/team'
import { approvalMatches, assertIntegrationApply, teamAssert } from './teamCore'

/** Pure workspace decisions. Observations must be gathered again under the per-run write lease. */
export interface TeamWorkspaceObservation {
  head: string | null
  clean: boolean
  expectedRepository: boolean
  expectedBranch: boolean
  writersStopped: boolean
  objectsPresent: boolean
}
export function assertCaptureReady(run: TeamRun, task: TeamTask, attempt: TeamAttempt, observed: TeamWorkspaceObservation, baseIsAncestor: boolean): void {
  teamAssert(task.runId === run.id && attempt.runId === run.id && attempt.taskId === task.id && task.currentAttemptId === attempt.id, 'CAPTURE_IDENTITY', 'Capture must belong to the current task attempt.')
  teamAssert(attempt.status === 'succeeded' && attempt.cessation === 'confirmed' && observed.writersStopped, 'PROCESS_LIVE', 'Capture requires confirmed cessation of every known writer.')
  teamAssert(observed.expectedRepository && observed.expectedBranch && observed.objectsPresent && observed.head && baseIsAncestor, 'WORKSPACE_CHANGED', 'Repository, branch or attempt ancestry changed; preserve the workspace for inspection.')
  if (task.command.kind === 'analysis') teamAssert(observed.clean && observed.head === attempt.baseSha, 'ANALYSIS_CHANGED_FILES', 'Analysis changed its tracked or nonignored workspace content or committed revision.')
}
export function integrationBinding(integration: TeamIntegration): TeamApprovalBinding {
  teamAssert(integration.resultSha, 'NOT_PREPARED', 'Integration has no immutable prepared result.')
  return { integrationId: integration.id, preparationId: integration.preparationId, artifactSha: integration.artifactSha, integrationHead: integration.expectedHead, resultSha: integration.resultSha, policyVersion: integration.policyVersion }
}
export function acceptPreparedReview(run: TeamRun, integration: TeamIntegration, review: TeamReview, reviewId: string, now: string): TeamIntegration {
  teamAssert(run.status === 'active' && integration.runId === run.id && integration.policyVersion === run.policyVersion, 'RUN_INACTIVE', 'Prepared review requires the current active run and policy.')
  teamAssert(['prepared', 'awaiting-approval', 'approved'].includes(integration.status) && review.phase === 'prepared' && review.integrationId === integration.id && review.taskId === integration.taskId && review.attemptId === integration.attemptId && review.reviewedSha === integration.resultSha, 'STALE_REVIEW', 'Review must identify this exact prepared result.')
  return { ...integration, version: integration.version + 1, updatedAt: now, preparedReviewId: review.decision === 'accept' ? reviewId : null, approval: null,
    status: review.decision === 'revise' ? 'rejected' : 'prepared', blocker: review.decision === 'revise' ? 'Lead requested a revised result.' : null }
}
export function recordIntegrationDecision(run: TeamRun, integration: TeamIntegration, expectedVersion: number, principal: string, decision: 'approve' | 'reject', now: string): TeamIntegration {
  teamAssert(run.status === 'active' && integration.runId === run.id && run.config.integrationPolicy === 'ask', 'USER_APPROVAL_UNAVAILABLE', 'User approval requires an active ask-policy run.')
  teamAssert(integration.version === expectedVersion && integration.status === 'awaiting-approval' && integration.preparedReviewId && integration.policyVersion === run.policyVersion, 'STALE_APPROVAL', 'Prepared review, policy or approval version changed.')
  teamAssert(principal.trim().length > 0, 'USER_REQUIRED', 'Approval must identify the authenticated user principal.')
  return { ...integration, approval: { binding: integrationBinding(integration), principal, decision, at: now }, status: decision === 'approve' ? 'approved' : 'rejected', version: integration.version + 1, updatedAt: now, blocker: decision === 'reject' ? 'User rejected this prepared result.' : null }
}
export function beginPromotion(run: TeamRun, integration: TeamIntegration, observed: TeamWorkspaceObservation, now: string): TeamIntegration {
  teamAssert(observed.expectedRepository && observed.expectedBranch && observed.writersStopped && observed.objectsPresent && observed.head, 'WORKSPACE_UNSAFE', 'Promotion requires the expected repository/branch, available objects and stopped writers.')
  assertIntegrationApply(run, integration, observed.head, observed.clean)
  return { ...integration, status: 'applying', version: integration.version + 1, updatedAt: now, blocker: null }
}
export type TeamPromotionRecovery =
  | { status: 'interrupted'; action: 'retain'; reason: string }
  | { status: 'applied'; action: 'record-applied'; reason: string }
  | { status: 'recovery-required'; action: 'block'; reason: string }
/** Matching content is deliberately not input: recovery requires exact recorded Git identity. */
export function classifyPromotionRecovery(integration: TeamIntegration, observed: TeamWorkspaceObservation): TeamPromotionRecovery {
  if (!['applying', 'applied'].includes(integration.status) || !integration.resultSha || !observed.writersStopped || !observed.expectedRepository || !observed.expectedBranch || !observed.objectsPresent || !observed.clean) return { status: 'recovery-required', action: 'block', reason: 'Promotion evidence is incomplete or the workspace has changed.' }
  if (observed.head === integration.resultSha) return { status: 'applied', action: 'record-applied', reason: 'The exact prepared result is present and clean; final verification remains required.' }
  if (integration.status === 'applying' && observed.head === integration.expectedHead) return { status: 'interrupted', action: 'retain', reason: 'Promotion did not advance HEAD; retain the operation without replay.' }
  return { status: 'recovery-required', action: 'block', reason: 'Observed HEAD matches neither the permitted pre-promotion state nor the prepared result.' }
}
export function restoredApprovalUsable(run: TeamRun, integration: TeamIntegration, observed: TeamWorkspaceObservation): boolean {
  return integration.status === 'approved' && !!integration.preparedReviewId && integration.policyVersion === run.policyVersion && observed.writersStopped && observed.expectedRepository && observed.expectedBranch && observed.objectsPresent && observed.clean && observed.head === integration.expectedHead && integration.approval?.decision === 'approve' && approvalMatches(integration.approval.binding, integration)
}
export function verifyIntegratedReview(run: TeamRun, task: TeamTask, integration: TeamIntegration, review: TeamReview, observed: TeamWorkspaceObservation, resultIsAncestor: boolean, now: string): TeamTask {
  teamAssert(run.status === 'active' && task.runId === run.id && integration.runId === run.id && task.id === integration.taskId && task.currentAttemptId === integration.attemptId && integration.status === 'applied', 'NOT_APPLIED', 'Final verification requires the current applied attempt.')
  teamAssert(review.phase === 'integrated' && review.taskId === task.id && review.attemptId === integration.attemptId && review.integrationId === integration.id && review.originalResultSha === integration.resultSha && review.verifiedHead === observed.head && review.reviewedSha === observed.head, 'STALE_REVIEW', 'Final verification must identify the applied result and current verified HEAD.')
  teamAssert(observed.expectedRepository && observed.expectedBranch && observed.writersStopped && observed.objectsPresent && observed.clean && resultIsAncestor, 'WORKSPACE_CHANGED', 'Final verification requires a clean current revision containing the applied result.')
  teamAssert(review.tests.length > 0 && review.tests.every(test => test.executionContext === 'integration' && test.testedSha === observed.head && test.provenance !== 'helper-reported' && test.testSource !== 'unknown' && ((test.sourcePaths?.length ?? 0) > 0 || !!test.sourceDiffSha)), 'UNVERIFIED_TESTS', 'Final evidence must identify integration commands, tested revision, test source paths/diff identity and independent or lead verification.')
  if (review.decision === 'accept') teamAssert(review.tests.every(test => test.outcome === 'passed' && test.exitCode === 0), 'TESTS_NOT_PASSED', 'Acceptance requires passing commands at the verified integration revision.')
  return { ...task, status: review.decision === 'accept' ? 'completed' : 'needs-revision', blocker: review.decision === 'accept' ? null : 'Integrated verification requested a counted helper revision; applied output is retained.', version: task.version + 1, updatedAt: now }
}
