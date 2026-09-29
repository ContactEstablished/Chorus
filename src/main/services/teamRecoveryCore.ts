import type { TeamAttempt, TeamRun } from '../../shared/team'

export interface TeamRecoveryEvidence {
  writersStopped: boolean
  ordinaryDirty: boolean
  blockers: string[]
}
/** Boot can change metadata and retire verified writers; it never grants execution authority. */
export function recoveryDisposition(run: TeamRun, evidence: TeamRecoveryEvidence): { status: TeamRun['status']; blocker: string | null } {
  const reasons = [...evidence.blockers]
  if (!evidence.writersStopped) reasons.unshift('A previous writer could not be proven stopped. Workspace reuse is blocked.')
  if (['completed', 'stopped'].includes(run.status)) return { status: run.status, blocker: reasons.length ? reasons.join(' ').slice(0, 4096) : run.blocker }
  if (reasons.length) return { status: 'blocked', blocker: reasons.join(' ').slice(0, 4096) }
  return { status: 'paused', blocker: evidence.ordinaryDirty ? 'Retained lead work is dirty. Use Recover to inspect and checkpoint it before Resume.' : null }
}
export function interruptedAtBoot(attempt: TeamAttempt, stopped: boolean, now: string): TeamAttempt {
  const terminal = ['succeeded', 'failed', 'interrupted', 'timed-out', 'cancelled', 'permission-blocked'].includes(attempt.status)
  const cessation = stopped ? 'confirmed' : 'unknown'
  if (terminal && attempt.cessation === cessation) return attempt
  return { ...attempt, status: terminal ? attempt.status : 'interrupted', cessation, version: attempt.version + 1,
    endedAt: attempt.endedAt ?? now, blocker: stopped ? (terminal ? attempt.blocker : 'Application restart interrupted this attempt. An explicit counted revision is required.') : 'Writer cessation is unknown; retain this workspace.' }
}
