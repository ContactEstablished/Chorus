import { teamRunConfigSchema, type TeamRun, type TeamTask, type TeamIntegration } from '../../shared/team'
export const teamFixtureId = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
export const TEAM_FIXTURE_TIME = '2026-09-20T19:00:00.000Z'
export function teamFixtureRun(): TeamRun {
  const config = teamRunConfigSchema.parse({ schemaVersion: 1, baseRevision: 'HEAD', lead: { id: teamFixtureId(2), label: 'Lead', harness: 'claude', authMode: 'subscription', providerId: null, credentialProfileId: null, model: 'claude-sonnet-5', effort: null, installedVersion: '2.1.278 (Claude Code)' }, helpers: [{ id: teamFixtureId(3), label: 'Helper', harness: 'codex', authMode: 'subscription', providerId: null, credentialProfileId: null, model: 'gpt-6-astra', effort: 'low', installedVersion: 'codex-cli 0.155.1' }] })
  return { id: teamFixtureId(1), projectId: teamFixtureId(4), leadSessionId: null, config, status: 'active', generation: 1, version: 1, policyVersion: 1, baseSha: 'a'.repeat(40), integrationWorktreeId: teamFixtureId(5), integrationHead: 'a'.repeat(40), createdAt: TEAM_FIXTURE_TIME, updatedAt: TEAM_FIXTURE_TIME, blocker: null }
}
export function teamFixtureTask(n = 10): TeamTask {
  const run = teamFixtureRun()
  return { id: teamFixtureId(n), runId: run.id, command: { clientRequestId: `request-${n}`, memberId: run.config.helpers[0].id, kind: 'code', title: 'Fix fixture', brief: 'Preserve these exact brief bytes.\n', context: '', acceptance: ['The fixture test passes.'], paths: [`fixture-${n}.txt`], dependsOn: [] }, status: 'queued', version: 1, currentAttemptId: null, attemptCount: 0, readyAt: TEAM_FIXTURE_TIME, createdAt: TEAM_FIXTURE_TIME, updatedAt: TEAM_FIXTURE_TIME, blocker: null }
}
export function teamFixtureIntegration(): TeamIntegration {
  return { id: teamFixtureId(40), runId: teamFixtureId(1), taskId: teamFixtureId(10), attemptId: teamFixtureId(20), preparationId: teamFixtureId(41), artifactSha: 'b'.repeat(40), expectedHead: 'a'.repeat(40), resultSha: 'c'.repeat(40), stagingWorktreeId: teamFixtureId(42), status: 'prepared', version: 1, policyVersion: 1, preparedReviewId: teamFixtureId(43), approval: null, createdAt: TEAM_FIXTURE_TIME, updatedAt: TEAM_FIXTURE_TIME, blocker: null }
}
