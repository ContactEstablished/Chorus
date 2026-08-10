import type { ProjectAttention, ProjectAttentionState } from '../../shared/ipc'

/**
 * The per-project attention roll-up: the join that turns N session states into
 * the one light the rail can show for a project you are not currently looking
 * at.
 *
 * ─── WHY THIS IS A PURE FUNCTION IN ITS OWN FILE ──────────────────────────
 * It is the only piece of this feature with real branching — two states, a
 * precedence rule between them, an oldest-wins reduction and three sources of
 * truth that can disagree — and it is the piece with no way to see it working
 * from the outside: a wrong verdict here shows up as a light that is merely the
 * wrong colour, which is indistinguishable from a CSS mistake. Kept pure, with
 * its inputs passed in rather than reached for, it is testable without an
 * Electron host, without a database and without a running agent.
 *
 * ─── THE THREE INPUTS, AND WHY NONE OF THEM IS SUFFICIENT ALONE ───────────
 *  1. `sessions` — the persisted rows. Knows which project a session belongs
 *     to and whether its PTY is alive, and is the ONLY source that survives a
 *     restart. Knows nothing about whether a live agent is blocked.
 *  2. `activityFor` — main's in-memory hook state. The only source that can say
 *     `needs-you`, and it evaporates on restart by design (agentEvents.ts:20).
 *  3. `exitedAt` — in-memory exit instants. The sessions table records THAT a
 *     session exited, never WHEN, so this supplies the age of a red light for
 *     the current run only.
 */

/** The slice of a session row this roll-up reads. Deliberately narrow: passing
 *  the full row would couple the rule to a schema it does not care about. */
export interface RollupSession {
  id: string
  projectId: string
  status: string
  exitCode: number | null
}

export interface RollupInputs {
  sessions: readonly RollupSession[]
  /** In-memory activity, or null when this session never reported one. */
  activityFor: (sessionId: string) => { activity: string; since: number } | null
  /** When this session exited, or undefined if it exited before this app run. */
  exitedAt: (sessionId: string) => number | undefined
}

/**
 * ⚠ AMBER OUTRANKS RED, AND THE ORDER IS A DELIBERATE READING OF THE DESIGN
 * DOC RATHER THAN A SEVERITY GUESS.
 *
 * `docs/design/v2/Chorus Needs Attention.html` rules it directly: *"Reserve the
 * alert hue for the one state that BLOCKS PROGRESS UNTIL A HUMAN ACTS. Errors
 * are red and patient; waiting is amber and impatient."* A failed session is a
 * finished fact — it will be exactly as failed in an hour, and nothing is being
 * spent while it waits to be read. A blocked session is an agent standing still
 * with your work in its hands. When a project holds both, the one worth
 * clicking first is the one that is still costing you something.
 *
 * The count of the loser is NOT discarded — it rides along in `errors` so the
 * row can say so in words. A single marker is a single marker; the tooltip is
 * where the rest of the truth goes.
 */
const PRECEDENCE: readonly ProjectAttentionState[] = ['needs-you', 'error']

/**
 * Fold every session into at most one entry per project.
 *
 * Projects with nothing to report are ABSENT from the result rather than
 * present with a null state — absence is the clear signal, and it is what lets
 * the renderer replace its whole map on each push and have lights turn off for
 * free (see `projectAttentionListSchema`).
 */
export function rollUpAttention(inputs: RollupInputs): ProjectAttention[] {
  const { sessions, activityFor, exitedAt } = inputs

  /** projectId -> state -> { count, oldest since (null = predates this run) } */
  const byProject = new Map<string, Map<ProjectAttentionState, { count: number; since: number | null }>>()

  for (const session of sessions) {
    const contribution = classify(session, activityFor, exitedAt)
    if (!contribution) continue

    let states = byProject.get(session.projectId)
    if (!states) {
      states = new Map()
      byProject.set(session.projectId, states)
    }

    const existing = states.get(contribution.state)
    if (!existing) {
      states.set(contribution.state, { count: 1, since: contribution.since })
      continue
    }
    existing.count += 1
    // ⚠ OLDEST WINS, and null (predating this run) is older than any instant.
    // A project where someone has been blocked for 20 minutes must not have its
    // escalation reset to calm because a second agent stopped one second ago —
    // the rail's job is to surface the longest-ignored thing in the app.
    if (existing.since !== null) {
      existing.since =
        contribution.since === null ? null : Math.min(existing.since, contribution.since)
    }
  }

  const out: ProjectAttention[] = []
  for (const [projectId, states] of byProject) {
    const winner = PRECEDENCE.find((s) => states.has(s))
    if (!winner) continue
    out.push({
      projectId,
      state: winner,
      since: states.get(winner)?.since ?? null,
      needsYou: states.get('needs-you')?.count ?? 0,
      errors: states.get('error')?.count ?? 0
    })
  }
  return out
}

/**
 * One session's contribution, or null when it has nothing to say.
 *
 * ⚠ ACTIVITY IS READ ONLY INSIDE THE `running` BRANCH — the same nesting, for
 * the same reason, as `FilmstripRenderer.stateFor`. An exited session's amber
 * is meaningless and would light a project for an agent that is already gone;
 * the persisted row's status wins outright, so a stale in-memory activity entry
 * can never outrank it. Duplicating the rule here rather than sharing it is
 * deliberate: the renderer's version derives FOUR states for a card it can see,
 * this one derives the TWO worth interrupting for, and collapsing them would
 * force one caller to discard half the answer.
 */
function classify(
  session: RollupSession,
  activityFor: RollupInputs['activityFor'],
  exitedAt: RollupInputs['exitedAt']
): { state: ProjectAttentionState; since: number | null } | null {
  if (session.status === 'running') {
    const record = activityFor(session.id)
    if (record?.activity === 'needs-you') return { state: 'needs-you', since: record.since }
    // `working`, or no hook bus at all: healthy. Green is the absence of a
    // signal here, never a signal — a rail that lit for every running agent
    // would spend its salience on the case that needs none.
    return null
  }
  if (session.status === 'exited' && session.exitCode !== 0) {
    // undefined -> exited before this app run -> no honest age -> null, which
    // the renderer renders calm. See `projectAttentionSchema`.
    return { state: 'error', since: exitedAt(session.id) ?? null }
  }
  return null
}
