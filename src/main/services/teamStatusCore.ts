import type { TeamSnapshot, TeamEvent, TeamTestEvidence } from '../../shared/team'

export function compactTeamChecks(events: readonly TeamEvent[]) {
  const checks = new Map<string, { id: string; command: string | null; expectedSha: string | null; status: string; reason: string | null; exitCode: number | null }>()
  for (const event of events) {
    if (typeof event.payload.verificationId !== 'string') continue
    const id = event.payload.verificationId, evidence = event.payload.evidence as TeamTestEvidence | undefined
    const prior = checks.get(id)
    checks.set(id, { id, command: evidence?.command ?? String(event.payload.command ?? prior?.command ?? ''), expectedSha: evidence?.testedSha ?? String(event.payload.expectedSha ?? prior?.expectedSha ?? ''),
      status: evidence?.outcome ?? (event.operation === 'verification-failed' ? 'failed' : event.operation === 'verification-started' ? 'running' : prior?.status ?? 'queued'), reason: typeof event.payload.reason === 'string' ? event.payload.reason.slice(0, 500) : prior?.reason ?? null, exitCode: evidence?.exitCode ?? prior?.exitCode ?? null })
  }
  return [...checks.values()].slice(-8)
}

/** Lead-facing projection. Full briefs, activity, usage and review history remain on disk. */
export function compactTeamStatus(snapshot: TeamSnapshot, cursor: number, taskIds: readonly string[] = [], checks: ReturnType<typeof compactTeamChecks> = []) {
  const tasks = snapshot.tasks.filter(t => !taskIds.length || taskIds.includes(t.id))
  return {
    run: { id: snapshot.run.id, status: snapshot.run.status, integrationHead: snapshot.run.integrationHead, blocker: snapshot.run.blocker, finish: snapshot.run.finish ?? null },
    lastSequence: cursor,
    checks,
    tasks: tasks.map(task => {
      const attempt = snapshot.attempts.find(a => a.id === task.currentAttemptId)
      const integrations = snapshot.integrations.filter(i => i.taskId === task.id)
      return { id: task.id, title: task.command.title, status: task.status, blocker: task.blocker, attemptCount: task.attemptCount,
        currentAttemptId: task.currentAttemptId, memberId: task.command.memberId,
        attempt: attempt ? { id: attempt.id, status: attempt.status, blocker: attempt.blocker, artifactSha: attempt.artifact?.commitSha ?? null, worktreeId: attempt.worktreeId, summary: attempt.result?.summary.slice(0, 1200) ?? null, summaryTruncated: (attempt.result?.summary.length ?? 0) > 1200 } : null,
        integration: integrations.length ? (() => { const i = integrations.at(-1)!; return { id: i.id, status: i.status, artifactSha: i.artifactSha, expectedHead: i.expectedHead, resultSha: i.resultSha, stagingWorktreeId: i.stagingWorktreeId, blocker: i.blocker } })() : null,
        next: task.status === 'awaiting-review' ? 'Inspect team_detail, then review the exact artifact or prepared/integrated SHA.' : task.status === 'queued' || task.status === 'running' || task.status === 'integrating' ? 'Wait with this actionable cursor.' : ['failed', 'blocked', 'needs-revision'].includes(task.status) ? 'Inspect the blocker; do not retry unchanged permission failures.' : null }
    })
  }
}
