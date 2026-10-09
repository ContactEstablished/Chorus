import type { TeamSnapshot } from '../../../shared/team'

export function teamPreparationMessage(snapshot: TeamSnapshot): string {
  const run = snapshot.run
  if (run.blocker) return run.blocker
  if (run.leadSessionId) return 'Starting the lead terminal…'
  for (const event of [...snapshot.events].reverse()) {
    if (event.operation === 'workspace-ready') return 'Preparing the lead terminal…'
    if (event.operation === 'verification-completed') return 'Finishing workspace preparation…'
    if (event.operation === 'verification-started' && event.payload.command === 'npm ci') return 'Installing dependencies in the isolated workspace…'
    if (event.operation === 'workspace-completed') return 'Preparing workspace dependencies…'
    if (event.operation === 'workspace-progress' && typeof event.payload.message === 'string') return `Creating the isolated workspace: ${event.payload.message}`
    if (event.operation === 'workspace-reserved') return 'Creating the isolated Git workspace. Large projects can take several minutes…'
  }
  return 'Preparing the isolated workspace…'
}

/** Main owns the finite preparation deadline; one minute is not a launch failure.
 * Follow paginated history so a long preparation cannot hide lead-started. */
export async function waitForTeamLead(options: {
  runId: string
  refresh(runId: string, afterSequence: number): Promise<TeamSnapshot>
  alive(): boolean
  progress(snapshot: TeamSnapshot, message: string): void
  delay(): Promise<void>
}): Promise<boolean> {
  let afterSequence = 0, generation = 0, message = 'Preparing the isolated workspace…'
  while (options.alive()) {
    const snapshot = await options.refresh(options.runId, afterSequence)
    if (generation && generation !== snapshot.run.generation) {
      afterSequence = 0; generation = snapshot.run.generation; continue
    }
    generation = snapshot.run.generation
    if (snapshot.events.length || snapshot.run.blocker || snapshot.run.leadSessionId) message = teamPreparationMessage(snapshot)
    options.progress(snapshot, message)
    if (snapshot.run.status === 'blocked') throw Error(snapshot.run.blocker ?? 'Team preparation failed. Its workspace and history are retained.')
    if (['stopping', 'stopped', 'pausing', 'paused'].includes(snapshot.run.status)) return false
    if (snapshot.run.leadSessionId && (snapshot.run.status === 'active' || snapshot.events.some(e => e.generation === generation && e.operation === 'lead-started'))) return true
    afterSequence = snapshot.events.at(-1)?.sequence ?? afterSequence
    if (!snapshot.hasMoreEvents) await options.delay()
  }
  return false
}
