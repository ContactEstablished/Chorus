import type { ProjectAttention, ProjectAttentionState } from '../../shared/ipc'

/**
 * The per-project roll-up: the join that turns N session states into the one
 * light — and the one activity bar — the rail can show for a project you are
 * not currently looking at.
 *
 * ⚠ IT DERIVES TWO DIFFERENT KINDS OF FACT, AND THEY ARE NOT THE SAME KIND OF
 * THING. `state` is ATTENTION: something here wants a human, and it earns a
 * marker. `working` is ACTIVITY: agents are mid-turn, which wants nothing and
 * earns only motion. They share this function because they share every input
 * and every trigger — one sweep of the sessions table, one `activityFor`, one
 * push — not because they are the same signal. A project can report either,
 * both, or (the usual case) neither, and neither is allowed to imply the other:
 * a busy project raises no marker, and a blocked one stops the bar because its
 * agent is by definition no longer working.
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

/** One project's half-built entry: its lights, and how many agents are busy. */
interface ProjectBucket {
  /** state -> { count, oldest since (null = predates this run) } */
  states: Map<ProjectAttentionState, { count: number; since: number | null }>
  /** Live sessions whose agent says it is mid-turn. See `isWorking`. */
  working: number
}

/**
 * Fold every session into at most one entry per project.
 *
 * Projects with NOTHING TO REPORT — no light and no busy agent — are ABSENT
 * from the result rather than present with an empty entry. Absence is the clear
 * signal, and it is what lets the renderer replace its whole map on each push
 * and have both the lights and the activity bars turn off for free (see
 * `projectAttentionListSchema`).
 */
export function rollUpAttention(inputs: RollupInputs): ProjectAttention[] {
  const { sessions, activityFor, exitedAt } = inputs

  const byProject = new Map<string, ProjectBucket>()
  const bucketFor = (projectId: string): ProjectBucket => {
    let bucket = byProject.get(projectId)
    if (!bucket) {
      bucket = { states: new Map(), working: 0 }
      byProject.set(projectId, bucket)
    }
    return bucket
  }

  for (const session of sessions) {
    // ⚠ COUNTED BEFORE `classify`, AND NOT INSIDE IT. The two are independent
    // readings of the same session and the second one returns null for a
    // healthy agent by design — folding activity into that return would force
    // `classify` to answer two questions with one value, which is exactly the
    // collapse its own header refuses.
    if (isWorking(session, activityFor)) bucketFor(session.projectId).working += 1

    const contribution = classify(session, activityFor, exitedAt)
    if (!contribution) continue

    const states = bucketFor(session.projectId).states
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
  for (const [projectId, bucket] of byProject) {
    const winner = PRECEDENCE.find((s) => bucket.states.has(s)) ?? null
    // ⚠ THE GUARD IS LOAD-BEARING NOW, WHERE IT USED TO BE UNREACHABLE. A
    // bucket used to exist only because `classify` had put a state in it, so
    // "no winner" could not happen; `working` can now open a bucket on its own,
    // and a project whose only working agent has since been counted elsewhere
    // must not emit an entry that says nothing.
    if (!winner && bucket.working === 0) continue
    out.push({
      projectId,
      state: winner,
      // ⚠ NULL WHEN THERE IS NO WINNER, never the age of some other fact.
      // `since` is the escalation clock for the STATE — a working project has
      // no state, so it has no clock, and a number here would climb a ladder
      // nothing is standing on.
      since: winner ? (bucket.states.get(winner)?.since ?? null) : null,
      needsYou: bucket.states.get('needs-you')?.count ?? 0,
      errors: bucket.states.get('error')?.count ?? 0,
      working: bucket.working
    })
  }
  return out
}

/**
 * Is this session an agent that is CURRENTLY MID-TURN?
 *
 * ⚠ BOTH HALVES ARE REQUIRED, and the `running` half is the one that matters.
 * Activity lives in main's memory and is never cleared on exit, so a session
 * that died mid-turn keeps a `working` record forever; without the status check
 * its project's bar would run for an agent that is not there any more. This is
 * the same nesting, for the same reason, as `classify` below — the persisted
 * row's status always wins over the in-memory account of it.
 *
 * ⚠ AND A LIVE SESSION WITH NO ACTIVITY AT ALL IS NOT WORKING. `activityFor`
 * returns null for every agent without a hook bus (codex, kimi, opencode) and
 * for a Claude Code session that has not yet taken its first turn. Reading that
 * silence as "working" would leave the bar running on every open project from
 * launch — the honest answer is that Chorus cannot see those agents think, and
 * the bar stays dark rather than guessing.
 */
function isWorking(session: RollupSession, activityFor: RollupInputs['activityFor']): boolean {
  if (session.status !== 'running') return false
  return activityFor(session.id)?.activity === 'working'
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
    // `working`, or no hook bus at all: healthy, so it raises NO MARKER. Green
    // is the absence of a signal here, never a signal — a rail that lit for
    // every running agent would spend its salience on the case that needs none.
    //
    // ⚠ `working` STILL LEAVES BY A DIFFERENT DOOR: `isWorking` counted it
    // above, and it drives the rail's activity bar. That is motion, not a
    // marker, and it is why this return can stay null without the busy case
    // becoming invisible.
    return null
  }
  // ⚠ A RECORDED NUMBER IS REQUIRED, AND `exitCode !== 0` ALONE WAS THE BUG.
  // `exit_code` is NULL for every session the app TIDIED AWAY rather than
  // watched fail: all five heal paths in `SessionManager.restore` write
  // `('exited', row.exitCode ?? null)` — no layout leaf, credential not
  // re-supplied, beyond the restore cap, cwd missing, spawn failed — and the
  // cwd-missing one says so in its own comment ("no sentinel exit code"). So a
  // session that was merely ALIVE when you last quit comes back NULL, and
  // `null !== 0` is true. Observed as three of four projects flying a red
  // triangle on a cold start with nothing crashed, which is the one thing this
  // light must never do: a marker that cries wolf at launch is a marker the
  // user learns to stop reading.
  //
  // Requiring a number costs no genuine failure. A real PTY exit always carries
  // one — `ExitListener` types `exitCode` as `number`, and `index.ts` persists
  // exactly what node-pty reported.
  if (session.status === 'exited' && typeof session.exitCode === 'number' && session.exitCode !== 0) {
    // undefined -> exited before this app run -> no honest age -> null, which
    // the renderer renders calm. See `projectAttentionSchema`.
    return { state: 'error', since: exitedAt(session.id) ?? null }
  }
  return null
}
