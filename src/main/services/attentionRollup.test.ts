import { describe, expect, it } from 'vitest'
import { rollUpAttention, type RollupSession } from './attentionRollup'

/**
 * The rail's roll-up is the one piece of this feature with no way to see it
 * being wrong from the outside: a bad verdict renders as a light of the wrong
 * colour, which looks exactly like a CSS mistake. These are the rules stated as
 * assertions.
 */

const S = (over: Partial<RollupSession> & { id: string }): RollupSession => ({
  projectId: 'p1',
  status: 'running',
  exitCode: null,
  ...over
})

/** No hook bus / never reported — the common case for codex, kimi, opencode. */
const noActivity = () => null
const noExits = () => undefined

describe('rollUpAttention — what lights a project', () => {
  it('reports NOTHING for a project with no light and nothing running', () => {
    const out = rollUpAttention({
      sessions: [S({ id: 'a' }), S({ id: 'b' }), S({ id: 'c', status: 'exited', exitCode: 0 })],
      activityFor: noActivity,
      exitedAt: noExits
    })
    // ⚠ ABSENCE, not an entry that is present-but-empty. It is what lets the
    // renderer replace its whole map on every push and have both the lights and
    // the activity bars turn off for free.
    expect(out).toEqual([])
  })

  it('reports a WORKING agent with no attention state at all', () => {
    // ⚠ THIS TEST USED TO ASSERT THE OPPOSITE, and the change is the point. A
    // busy project was invisible on this channel because nothing consumed it;
    // the rail's activity bar does, so it now gets an entry — and the entry
    // carries a NULL state, because being busy is not a request for a human and
    // must never raise a marker. `ProjectRail.tierOf` reads exactly this null.
    const out = rollUpAttention({
      sessions: [S({ id: 'a' }), S({ id: 'b' }), S({ id: 'c', status: 'exited', exitCode: 0 })],
      activityFor: (id) => (id === 'b' ? { activity: 'working', since: 1000 } : null),
      exitedAt: noExits
    })
    expect(out).toEqual([
      { projectId: 'p1', state: null, since: null, needsYou: 0, errors: 0, working: 1 }
    ])
  })

  it('does NOT count a live pane that has never reported activity', () => {
    // The hook-less case (codex, kimi, opencode) and the not-yet-started case
    // are the same silence, and both read as not-working. Counting a live pane
    // would leave the bar running on every open project from launch.
    const out = rollUpAttention({
      sessions: [S({ id: 'a' }), S({ id: 'b' })],
      activityFor: noActivity,
      exitedAt: noExits
    })
    expect(out).toEqual([])
  })

  it('counts every working agent in the project, not just the first', () => {
    const out = rollUpAttention({
      sessions: [S({ id: 'a' }), S({ id: 'b' }), S({ id: 'c' })],
      activityFor: (id) => (id === 'c' ? null : { activity: 'working', since: 1000 }),
      exitedAt: noExits
    })
    expect(out[0]?.working).toBe(2)
  })

  it('stops counting a working agent the moment its session exits', () => {
    // ⚠ ACTIVITY IS NEVER CLEARED ON EXIT — main keeps the record — so this is
    // the check that the bar cannot outlive the PTY it describes. Same rule,
    // same reason, as the stale-`needs-you` test further down.
    const out = rollUpAttention({
      sessions: [S({ id: 'a', status: 'exited', exitCode: 0 })],
      activityFor: () => ({ activity: 'working', since: 1000 }),
      exitedAt: () => 9000
    })
    expect(out).toEqual([])
  })

  it('runs the bar alongside a light without either changing the other', () => {
    // A project can be both busy and blocked: two agents, one mid-turn and one
    // waiting on a human. The marker is the waiting one's; the bar is the
    // working one's; neither suppresses the other.
    const out = rollUpAttention({
      sessions: [S({ id: 'a' }), S({ id: 'b' })],
      activityFor: (id) =>
        id === 'a'
          ? { activity: 'working', since: 1000 }
          : { activity: 'needs-you', since: 5000 },
      exitedAt: noExits
    })
    expect(out).toEqual([
      { projectId: 'p1', state: 'needs-you', since: 5000, needsYou: 1, errors: 0, working: 1 }
    ])
  })

  it('lights amber for a running agent whose hook bus says it needs a human', () => {
    const out = rollUpAttention({
      sessions: [S({ id: 'a' }), S({ id: 'b' })],
      activityFor: (id) => (id === 'b' ? { activity: 'needs-you', since: 5000 } : null),
      exitedAt: noExits
    })
    expect(out).toEqual([
      { projectId: 'p1', state: 'needs-you', since: 5000, needsYou: 1, errors: 0, working: 0 }
    ])
  })

  it('lights red for a session that exited non-zero, and dates it from the exit', () => {
    const out = rollUpAttention({
      sessions: [S({ id: 'a', status: 'exited', exitCode: 1 })],
      activityFor: noActivity,
      exitedAt: (id) => (id === 'a' ? 9000 : undefined)
    })
    expect(out).toEqual([
      { projectId: 'p1', state: 'error', since: 9000, needsYou: 0, errors: 1, working: 0 }
    ])
  })

  it('reports a null instant for an error that predates this app run', () => {
    // No exit instant in memory => the failure happened before the last
    // restart. Null is rendered at the CALM end of the ladder rather than
    // substituting app-start time, which would make every boot look fresh.
    const out = rollUpAttention({
      sessions: [S({ id: 'a', status: 'exited', exitCode: 1 })],
      activityFor: noActivity,
      exitedAt: noExits
    })
    expect(out[0]?.since).toBeNull()
    expect(out[0]?.state).toBe('error')
  })

  it('stays DARK for a session that exited with no recorded exit code', () => {
    // ⚠ THE REGRESSION THIS FILE EXISTED TO CATCH AND DID NOT. Every error case
    // above passes an explicit number, so `exitCode !== 0` looked correct — but
    // `exit_code` is NULL for every session the app TIDIED AWAY at boot rather
    // than watched fail (all five heal paths in `SessionManager.restore` write
    // `('exited', row.exitCode ?? null)`), and `null !== 0` is true. Result: a
    // project went red at launch because a session was ALIVE when you last
    // quit. Observed on the real database as three of four projects flagged
    // with nothing crashed.
    const out = rollUpAttention({
      sessions: [S({ id: 'a', status: 'exited', exitCode: null })],
      activityFor: noActivity,
      exitedAt: noExits
    })
    expect(out).toEqual([])
  })

  it('still lights red when ONE session has a real code among tidied ones', () => {
    // The fix must not go so far the other way that a genuine failure is lost
    // among its healed neighbours.
    const out = rollUpAttention({
      sessions: [
        S({ id: 'a', status: 'exited', exitCode: null }),
        S({ id: 'b', status: 'exited', exitCode: null }),
        S({ id: 'c', status: 'exited', exitCode: 137 })
      ],
      activityFor: noActivity,
      exitedAt: (id) => (id === 'c' ? 9000 : undefined)
    })
    // ⚠ `errors: 1`, NOT 3 — the tooltip must count the real failure only, or
    // the words would restate the bug the marker no longer commits.
    expect(out).toEqual([
      { projectId: 'p1', state: 'error', since: 9000, needsYou: 0, errors: 1, working: 0 }
    ])
  })

  it('never lets an exited session’s stale activity outrank its row', () => {
    // The `Stop` hook fires just before a clean exit, so a dead session can
    // easily still have `needs-you` in main's memory. The persisted row wins:
    // a project must not glow amber for an agent that is already gone.
    const out = rollUpAttention({
      sessions: [S({ id: 'a', status: 'exited', exitCode: 0 })],
      activityFor: () => ({ activity: 'needs-you', since: 5000 }),
      exitedAt: () => 9000
    })
    expect(out).toEqual([])
  })
})

describe('rollUpAttention — precedence and reduction', () => {
  it('shows amber when a project holds BOTH waiting and failed agents', () => {
    // "Errors are red and patient; waiting is amber and impatient." A failed
    // session will be exactly as failed in an hour; a blocked one is standing
    // still with your work in its hands.
    const out = rollUpAttention({
      sessions: [
        S({ id: 'a', status: 'exited', exitCode: 1 }),
        S({ id: 'b' })
      ],
      activityFor: (id) => (id === 'b' ? { activity: 'needs-you', since: 5000 } : null),
      exitedAt: () => 1000
    })
    expect(out[0]?.state).toBe('needs-you')
    // ⚠ AND THE RED IS NOT LOST — it rides the counts so the row's tooltip can
    // say so in words. A single marker outranking the other state must never
    // mean the other state goes unreported.
    expect(out[0]).toMatchObject({ needsYou: 1, errors: 1 })
  })

  it('dates a project from its OLDEST waiting agent, not its newest', () => {
    const out = rollUpAttention({
      sessions: [S({ id: 'a' }), S({ id: 'b' }), S({ id: 'c' })],
      activityFor: (id) =>
        ({
          a: { activity: 'needs-you' as const, since: 50_000 },
          b: { activity: 'needs-you' as const, since: 10_000 },
          c: { activity: 'needs-you' as const, since: 90_000 }
        })[id] ?? null,
      exitedAt: noExits
    })
    // A 20-minute-old block must not be reset to calm because a second agent
    // stopped one second ago — the rail surfaces the longest-ignored thing.
    expect(out[0]).toMatchObject({ since: 10_000, needsYou: 3 })
  })

  it('treats an unknown instant as older than any known one', () => {
    const out = rollUpAttention({
      sessions: [
        S({ id: 'a', status: 'exited', exitCode: 1 }),
        S({ id: 'b', status: 'exited', exitCode: 2 })
      ],
      activityFor: noActivity,
      exitedAt: (id) => (id === 'a' ? 9000 : undefined)
    })
    // `b` failed before this run, so it is the older of the two and its null
    // wins the reduction — the project reads calm rather than freshly broken.
    expect(out[0]).toMatchObject({ since: null, errors: 2 })
  })

  it('keeps projects independent', () => {
    const out = rollUpAttention({
      sessions: [
        S({ id: 'a', projectId: 'p1' }),
        S({ id: 'b', projectId: 'p2', status: 'exited', exitCode: 1 }),
        S({ id: 'c', projectId: 'p3' })
      ],
      activityFor: (id) => (id === 'a' ? { activity: 'needs-you', since: 5000 } : null),
      exitedAt: () => 7000
    })
    const byId = Object.fromEntries(out.map((p) => [p.projectId, p]))
    expect(byId.p1?.state).toBe('needs-you')
    expect(byId.p2?.state).toBe('error')
    expect(byId.p3).toBeUndefined() // healthy — absent, not dark-but-present
  })

  it('emits at most one entry per project however many sessions contribute', () => {
    const out = rollUpAttention({
      sessions: Array.from({ length: 12 }, (_, i) => S({ id: `s${i}` })),
      activityFor: (id) => ({ activity: id === 's0' ? 'working' : 'needs-you', since: 1000 }),
      exitedAt: noExits
    })
    expect(out).toHaveLength(1)
    expect(out[0]?.needsYou).toBe(11)
  })
})
