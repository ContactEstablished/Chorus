import { describe, expect, it } from 'vitest'
import { createTurnRecorder } from './turns'
import type { AgentTurnRow, NewAgentTurnRow } from '../db/schema'
import type { AgentEventListener } from './agentEvents'
import type { SessionManager } from './sessionManager'
import type { StorageService } from './storage'

// Task 8-0: the recorder over a stub storage, following dispatches.test.ts's
// pattern exactly. The stub models the ACCESSOR CONTRACT — "OPEN" means
// outcome IS NULL, and a close writes only while open — so these are real
// sequencing tests rather than a mock's imagination.
//
// ⚠ Nothing here imports storage.ts: better-sqlite3 is built for the Electron
// ABI (NODE_MODULE_VERSION 148) and cannot load under plain-node vitest.

type ClosePatch = {
  outcome: 'completed' | 'abandoned'
  closedBy: 'stop' | 'session-exit' | 'boot-heal' | 'quit' | 'stale'
  endedAt: string | null
}

function makeStubStorage(
  opts: { throwing?: boolean; session?: { projectId: string; agent: string } | null } = {}
) {
  const rows = new Map<string, AgentTurnRow>()
  const calls = { open: 0, close: [] as Array<{ id: string; patch: ClosePatch }> }
  const boom = (): never => {
    throw new Error('stub storage failure')
  }
  const storage = {
    openAgentTurn(row: NewAgentTurnRow): void {
      if (opts.throwing) boom()
      calls.open++
      rows.set(row.id, { ...row } as AgentTurnRow)
    },
    getOpenTurnForSession(sessionId: string): AgentTurnRow | null {
      if (opts.throwing) boom()
      const open = [...rows.values()].filter((r) => r.sessionId === sessionId && r.outcome === null)
      return open.at(-1) ?? null
    },
    listOpenAgentTurns(): AgentTurnRow[] {
      if (opts.throwing) boom()
      return [...rows.values()].filter((r) => r.outcome === null)
    },
    closeAgentTurn(id: string, patch: ClosePatch): void {
      if (opts.throwing) boom()
      calls.close.push({ id, patch })
      const row = rows.get(id)
      // The accessor's WHERE clause: writes nothing when already closed.
      if (row && row.outcome === null) Object.assign(row, patch)
    },
    getSessionById(id: string) {
      if (opts.throwing) boom()
      return opts.session === undefined
        ? { id, projectId: 'proj-1', agent: 'claude' }
        : opts.session === null
          ? null
          : { id, ...opts.session }
    },
    rows
  }
  return { storage: storage as unknown as StorageService, calls, rows }
}

/** The two announcements a turn is bounded by, captured so tests can fire
 *  them in sequence. `onActivity` is Set-backed and additive in the real
 *  listener; this records only that the recorder subscribes. */
/** ⚠ `reason` IS OPTIONAL AND IGNORED HERE ON PURPOSE (Task 4-1). The real
 *  listener now passes a fourth argument; `turns.ts` takes three and must keep
 *  behaving identically, so the stub models the trailing parameter as something
 *  a caller MAY supply and the recorder never reads. */
type FiredReason = 'permission' | 'stopped' | 'notice' | null
/** ⚠ `a` IS NULLABLE SINCE THE STALE SWEEP. Null is the listener retiring a
 *  `working` claim that showed no sign of life for `WORKING_STALE_MS`, and the
 *  recorder has to close the turn on it — otherwise a lost `Stop` leaves the
 *  row open until the session dies, which is what the sweep exists to stop. */
type ActivityFn = (
  id: string,
  a: 'working' | 'needs-you' | null,
  since: number,
  reason?: FiredReason,
  /** ⚠ WHICH CHANNEL CLAIMED IT (2026-08-24). Optional here on purpose: the
   *  cases written before this parameter existed pass three arguments, and the
   *  recorder must still file those as `hooks` — which is both the old
   *  behaviour and the safe default, since a hook claim is the stronger one. */
  source?: 'hook' | 'output'
) => void

function makeSources() {
  const fired: {
    activity: ActivityFn | null
    exit: ((id: string, code: number) => void) | null
  } = { activity: null, exit: null }
  const events = {
    onActivity: (l: ActivityFn) => {
      fired.activity = l
      return () => {}
    }
  } as unknown as AgentEventListener
  const sessions = {
    onExit: (l: (id: string, code: number) => void) => {
      fired.exit = l
    }
  } as unknown as SessionManager
  return { events, sessions, fired }
}

const T0 = Date.parse('2026-08-10T10:00:00.000Z')
const SEC = 1000

describe('TurnRecorder (Task 8-0)', () => {
  it('opens on the working edge: one row, outcome/ended NULL, facts from the sessions row', () => {
    const { storage, rows } = makeStubStorage()
    const recorder = createTurnRecorder(storage)
    const { events, sessions, fired } = makeSources()
    recorder.attach(events, sessions)
    fired.activity!('sess-1', 'working', T0)
    const row = [...rows.values()][0]
    expect(row.sessionId).toBe('sess-1')
    expect(row.projectId).toBe('proj-1') // resolved from the sessions row
    expect(row.agent).toBe('claude')
    expect(row.source).toBe('hooks') // the only producer today
    expect(row.startedAt).toBe('2026-08-10T10:00:00.000Z') // agentEvents' own transition instant
    expect(row.outcome).toBeNull() // NULL means OPEN — never ended_at
    expect(row.endedAt).toBeNull()
    expect(row.closedBy).toBeNull()
  })

  it('a Stop closes the open turn completed/stop, with the transition instant as ended_at', () => {
    const { storage, rows } = makeStubStorage()
    const recorder = createTurnRecorder(storage)
    const { events, sessions, fired } = makeSources()
    recorder.attach(events, sessions)
    fired.activity!('sess-1', 'working', T0)
    fired.activity!('sess-1', 'needs-you', T0 + 42 * SEC)
    const row = [...rows.values()][0]
    expect(row.outcome).toBe('completed')
    expect(row.closedBy).toBe('stop')
    expect(row.endedAt).toBe('2026-08-10T10:00:42.000Z')
    // The whole point of the unit: a real start and a real end, 42 s apart.
    expect(Date.parse(row.endedAt!) - Date.parse(row.startedAt)).toBe(42 * SEC)
  })

  it('a SECOND prompt in the same session opens a SECOND row — per-turn, not per-session', () => {
    const { storage, rows } = makeStubStorage()
    const recorder = createTurnRecorder(storage)
    const { events, sessions, fired } = makeSources()
    recorder.attach(events, sessions)
    fired.activity!('sess-1', 'working', T0)
    fired.activity!('sess-1', 'needs-you', T0 + 10 * SEC)
    fired.activity!('sess-1', 'working', T0 + 60 * SEC)
    fired.activity!('sess-1', 'needs-you', T0 + 75 * SEC)
    const all = [...rows.values()]
    expect(all).toHaveLength(2)
    expect(all.every((r) => r.outcome === 'completed' && r.closedBy === 'stop')).toBe(true)
    // Two turns of 10 s and 15 s — NOT one 75 s turn. This is the distinction
    // a dispatch cannot make.
    const durations = all.map((r) => Date.parse(r.endedAt!) - Date.parse(r.startedAt))
    expect(durations).toEqual([10 * SEC, 15 * SEC])
  })

  it('a session that never reported an activity produces zero rows, exit included', () => {
    const { storage, rows, calls } = makeStubStorage()
    const recorder = createTurnRecorder(storage)
    const { events, sessions, fired } = makeSources()
    recorder.attach(events, sessions)
    // ⚠ THIS TEST WAS "an agent with NO hook bus produces zero rows (D129)"
    // UNTIL 2026-08-24, and the retitle is the honest half of that change: a
    // hook-less agent now DOES report activity, from its PTY output, so the old
    // title asserted a rule the app had stopped following. The property worth
    // keeping is the narrower one it was really testing — an exit on its own is
    // not a turn. Nothing is invented for a session nobody ever saw working.
    fired.exit!('sess-codex', 0)
    expect(rows.size).toBe(0)
    expect(calls.open).toBe(0)
    expect(calls.close).toHaveLength(0)
  })

  it('⚠ an OUTPUT-driven working edge is filed as `pty-output`, not as `hooks`', () => {
    // `agent_turns.source` was given a value rather than a default precisely so
    // that "the only producer today cannot be mistaken for a future one". This
    // is that future producer: a codex pane claiming `working` from its own
    // terminal output. Mislabelling it would silently pollute the one table a
    // duration estimator learns from — with a BIAS, not noise, because an
    // output-driven turn's end is only ever seen by the stale sweep.
    const { storage, rows } = makeStubStorage()
    const recorder = createTurnRecorder(storage)
    const { events, sessions, fired } = makeSources()
    recorder.attach(events, sessions)
    fired.activity!('sess-codex', 'working', T0, null, 'output')
    const row = [...rows.values()][0]
    expect(row.source).toBe('pty-output')
    expect(row.startedAt).toBe('2026-08-10T10:00:00.000Z')
    expect(row.outcome).toBeNull()
    expect(row.endedAt).toBeNull()
  })

  it('an explicit `hook` source is still filed as `hooks` — the two do not swap', () => {
    const { storage, rows } = makeStubStorage()
    const recorder = createTurnRecorder(storage)
    const { events, sessions, fired } = makeSources()
    recorder.attach(events, sessions)
    fired.activity!('sess-1', 'working', T0, null, 'hook')
    expect([...rows.values()][0].source).toBe('hooks')
  })

  it('⚠ an output-driven turn closes with a NULL ended_at — a real start, an honest end', () => {
    // The answer to the objection this file's header used to make ("an
    // interpolated turn is a fabricated number wearing a real column"). The
    // start is observed; the end is an INTERVAL, so it is written as NULL and
    // `closed_by` carries how we found out. No confident number is invented,
    // and duration consumers already filter `ended_at IS NOT NULL`.
    const { storage, rows, calls } = makeStubStorage()
    const recorder = createTurnRecorder(storage)
    const { events, sessions, fired } = makeSources()
    recorder.attach(events, sessions)
    fired.activity!('sess-codex', 'working', T0, null, 'output')
    fired.activity!('sess-codex', null, T0 + 10 * SEC)
    const row = [...rows.values()][0]
    expect(row.source).toBe('pty-output')
    expect(row.outcome).toBe('abandoned')
    expect(row.closedBy).toBe('stale')
    expect(row.endedAt).toBeNull()
    expect(calls.close).toHaveLength(1)
  })

  it('a needs-you with nothing open writes nothing — no zero-length turn', () => {
    const { storage, rows, calls } = makeStubStorage()
    const recorder = createTurnRecorder(storage)
    const { events, sessions, fired } = makeSources()
    recorder.attach(events, sessions)
    fired.activity!('sess-1', 'needs-you', T0)
    expect(rows.size).toBe(0)
    expect(calls.close).toHaveLength(0)
  })

  it('⚠ a REASON-ONLY needs-you re-fire writes NOTHING (Task 4-1 pinning test)', () => {
    // D145 widened `agentEvents.record()` to fire when the activity OR the
    // REASON changes, so this recorder now sees a second `needs-you` it never
    // saw before: an agent that stopped and then raised a permission prompt.
    // `since` is deliberately NOT re-stamped on that transition, so the two
    // calls carry the SAME instant.
    //
    // This is the one behavioural risk the widened trigger creates for an
    // existing consumer, and it is PINNED rather than reasoned about: the turn
    // was already closed by the first needs-you, so the second must not close a
    // second row, must not re-close the same row, and must not open one.
    const { storage, rows, calls } = makeStubStorage()
    const recorder = createTurnRecorder(storage)
    const { events, sessions, fired } = makeSources()
    recorder.attach(events, sessions)
    fired.activity!('sess-1', 'working', T0)
    fired.activity!('sess-1', 'needs-you', T0 + 10 * SEC, 'stopped')
    const closesAfterStop = calls.close.length
    expect(closesAfterStop).toBe(1)

    // The re-fire: same activity, same `since`, different reason only.
    fired.activity!('sess-1', 'needs-you', T0 + 10 * SEC, 'permission')

    expect(calls.close.length).toBe(closesAfterStop) // no second close
    expect(calls.open).toBe(1) // no new turn opened
    expect(rows.size).toBe(1)
    const row = [...rows.values()][0]
    expect(row.outcome).toBe('completed') // history not rewritten
    expect(row.closedBy).toBe('stop')
    expect(row.endedAt).toBe('2026-08-10T10:00:10.000Z') // the FIRST end, unmoved
  })

  it('a PTY death mid-turn closes the row abandoned/session-exit rather than leaking it to the next boot', () => {
    const { storage, rows } = makeStubStorage()
    const recorder = createTurnRecorder(storage)
    const { events, sessions, fired } = makeSources()
    recorder.attach(events, sessions)
    fired.activity!('sess-1', 'working', T0)
    fired.exit!('sess-1', -1073741510) // the Windows killed-PTY code
    const row = [...rows.values()][0]
    expect(row.outcome).toBe('abandoned')
    expect(row.closedBy).toBe('session-exit')
    expect(row.endedAt).toBeTruthy() // observed: a real end time, unlike a heal
  })

  it('an exit with no open turn is a no-op, not an error', () => {
    const { storage, calls } = makeStubStorage()
    const recorder = createTurnRecorder(storage)
    const { events, sessions, fired } = makeSources()
    recorder.attach(events, sessions)
    expect(() => fired.exit!('never-seen', 0)).not.toThrow()
    expect(calls.close).toHaveLength(0)
  })

  it('boot heal closes orphans abandoned/boot-heal with ended_at NULL — and a second heal does NOT re-touch them', () => {
    const { storage, rows, calls } = makeStubStorage()
    const recorder = createTurnRecorder(storage)
    const { events, sessions, fired } = makeSources()
    recorder.attach(events, sessions)
    fired.activity!('sess-1', 'working', T0) // left open: the previous run was tree-killed
    recorder.healOrphansAtBoot()
    let row = [...rows.values()][0]
    expect(row.outcome).toBe('abandoned')
    expect(row.closedBy).toBe('boot-heal')
    expect(row.endedAt).toBeNull() // "it ended, we never saw when" — a VALUE
    const closesAfterFirstHeal = calls.close.length
    // OPEN means outcome IS NULL. A boot-healed row keeps ended_at NULL
    // forever, so an ended_at-based predicate would re-select and re-close it
    // on every boot — the quiet-fiction failure. Run it twice:
    recorder.healOrphansAtBoot()
    expect(calls.close.length).toBe(closesAfterFirstHeal) // no re-close
    row = [...rows.values()][0]
    expect(row.closedBy).toBe('boot-heal') // history not rewritten
  })

  it('quit close abandons what is still open, with a real ended_at — and is idempotent', () => {
    const { storage, rows } = makeStubStorage()
    const recorder = createTurnRecorder(storage)
    const { events, sessions, fired } = makeSources()
    recorder.attach(events, sessions)
    fired.activity!('sess-1', 'working', T0)
    fired.activity!('sess-2', 'working', T0)
    recorder.closeOpenOnQuit()
    for (const row of rows.values()) {
      expect(row.outcome).toBe('abandoned')
      expect(row.closedBy).toBe('quit')
      expect(row.endedAt).toBeTruthy()
    }
    const endedAts = [...rows.values()].map((r) => r.endedAt)
    recorder.closeOpenOnQuit() // a second quit path must not rewrite history
    expect([...rows.values()].map((r) => r.endedAt)).toEqual(endedAts)
    for (const row of rows.values()) expect(row.closedBy).toBe('quit')
  })

  it('a lost Stop does not FUSE two turns: the stale row is abandoned and a fresh one opens', () => {
    // Defensive path — unreachable through the real edge-triggered onActivity,
    // and asserted here so it stays correct if that ever changes.
    const { storage, rows } = makeStubStorage()
    const recorder = createTurnRecorder(storage)
    const { events, sessions, fired } = makeSources()
    recorder.attach(events, sessions)
    fired.activity!('sess-1', 'working', T0)
    fired.activity!('sess-1', 'working', T0 + 300 * SEC)
    const all = [...rows.values()]
    expect(all).toHaveLength(2)
    expect(all[0].outcome).toBe('abandoned') // NOT stretched to cover both
    expect(all[0].closedBy).toBe('session-exit')
    expect(all[1].outcome).toBeNull() // the new turn, open
    expect(all[1].startedAt).toBe('2026-08-10T10:05:00.000Z')
  })

  it('a turn whose session row has already gone still gets written — no FK, no blocked write', () => {
    // Pane close DELETES the sessions row (D16 resolution d). project_id falls
    // to NULL rather than the write failing: a weaker sample beats no sample,
    // and a turn cannot be recovered later.
    const { storage, rows } = makeStubStorage({ session: null })
    const recorder = createTurnRecorder(storage)
    const { events, sessions, fired } = makeSources()
    recorder.attach(events, sessions)
    fired.activity!('orphan-sess', 'working', T0)
    const row = [...rows.values()][0]
    expect(row.projectId).toBeNull()
    expect(row.agent).toBe('unknown')
    expect(row.sessionId).toBe('orphan-sess') // reads back regardless
  })

  it('never fails a session: every recorder path swallows a throwing storage and only logs', () => {
    // Sharper than the dispatch recorder's version — onActivity runs inside the
    // hook request handler Claude Code is waiting on.
    const { storage } = makeStubStorage({ throwing: true })
    const recorder = createTurnRecorder(storage)
    const { events, sessions, fired } = makeSources()
    expect(() => recorder.healOrphansAtBoot()).not.toThrow()
    expect(() => recorder.attach(events, sessions)).not.toThrow()
    expect(() => fired.activity!('sess-1', 'working', T0)).not.toThrow()
    expect(() => fired.activity!('sess-1', 'needs-you', T0 + SEC)).not.toThrow()
    expect(() => fired.exit!('sess-1', 0)).not.toThrow()
    expect(() => recorder.closeOpenOnQuit()).not.toThrow()
  })

  it('parses no hook body: the recorder only ever receives a classified activity and a session id', () => {
    // D130 as an executable assertion. The listener signature the recorder
    // subscribes to carries no event name, no prompt, no transcript path — so
    // there is nothing for this module to extract even if it wanted to.
    const { storage, rows } = makeStubStorage()
    const recorder = createTurnRecorder(storage)
    const { events, sessions, fired } = makeSources()
    recorder.attach(events, sessions)
    fired.activity!('sess-1', 'working', T0)
    fired.activity!('sess-1', 'needs-you', T0 + SEC)
    const row = [...rows.values()][0]
    // Every column is a fact about WHEN and WHO, never about WHAT was said.
    expect(Object.keys(row).sort()).toEqual(
      [
        'agent',
        'closedBy',
        'createdAt',
        'endedAt',
        'id',
        'outcome',
        'projectId',
        'sessionId',
        'source',
        'startedAt'
      ].sort()
    )
  })
})

describe('TurnRecorder — the stale sweep closes the turn a lost Stop left open', () => {
  it('closes it abandoned/stale, with NO ended_at', () => {
    // ⚠ `ended_at` NULL IS THE BOOT HEAL'S RULE, NOT THE QUIT CLOSE'S. What is
    // known is that the turn ended somewhere between its last sign of life and
    // the sweep that noticed — an interval up to WORKING_STALE_MS wide. Writing
    // either end of it as a fact is spec §11's first named risk (confident
    // numbers from thin data); duration consumers filter `ended_at IS NOT NULL`.
    const { storage, rows } = makeStubStorage()
    const recorder = createTurnRecorder(storage)
    const { events, sessions, fired } = makeSources()
    recorder.attach(events, sessions)
    fired.activity!('sess-1', 'working', T0)
    fired.activity!('sess-1', null, T0 + 45 * SEC)
    const row = [...rows.values()][0]
    expect(row.outcome).toBe('abandoned')
    expect(row.closedBy).toBe('stale')
    expect(row.endedAt).toBeNull()
  })

  it('is the difference between a 1.8-minute turn and a nine-hour phantom', () => {
    // The bug in its measured shape: without this path, the row stayed open
    // through however long the pane then sat idle and was closed by the PTY
    // exit hours later — 46 such rows on the installed 0.7.5 database on
    // 2026-08-23, four of them past nine hours, against a 1.8-minute median for
    // turns an observed Stop closed.
    const { storage, rows } = makeStubStorage()
    const recorder = createTurnRecorder(storage)
    const { events, sessions, fired } = makeSources()
    recorder.attach(events, sessions)
    fired.activity!('sess-1', 'working', T0)
    fired.activity!('sess-1', null, T0 + 45 * SEC)
    fired.exit!('sess-1', 0) // hours later; there is nothing left to close
    expect([...rows.values()]).toHaveLength(1)
    expect([...rows.values()][0].closedBy).toBe('stale')
  })

  it('a retirement with no open turn is a no-op, not an error', () => {
    const { storage, rows, calls } = makeStubStorage()
    const recorder = createTurnRecorder(storage)
    const { events, sessions, fired } = makeSources()
    recorder.attach(events, sessions)
    expect(() => fired.activity!('sess-1', null, T0)).not.toThrow()
    expect(rows.size).toBe(0)
    expect(calls.close).toEqual([])
  })

  it('the next real turn opens cleanly rather than reopening the retired one', () => {
    const { storage, rows } = makeStubStorage()
    const recorder = createTurnRecorder(storage)
    const { events, sessions, fired } = makeSources()
    recorder.attach(events, sessions)
    fired.activity!('sess-1', 'working', T0)
    fired.activity!('sess-1', null, T0 + 45 * SEC)
    fired.activity!('sess-1', 'working', T0 + 600 * SEC)
    fired.activity!('sess-1', 'needs-you', T0 + 660 * SEC)
    const all = [...rows.values()]
    expect(all).toHaveLength(2)
    expect(all[0].closedBy).toBe('stale')
    // The second is a normal completed turn — NOT a 'reopen', which is what
    // would have happened had the retirement left the first row open.
    expect(all[1].outcome).toBe('completed')
    expect(all[1].closedBy).toBe('stop')
    expect(all[1].endedAt).toBe('2026-08-10T10:11:00.000Z')
  })

  it('a throwing storage cannot take down the sweep that called it', () => {
    // Telemetry may LOSE a data point; it may never fail a session. The sweep
    // runs on a timer in main and fans out to every listener.
    const { storage } = makeStubStorage({ throwing: true })
    const recorder = createTurnRecorder(storage)
    const { events, sessions, fired } = makeSources()
    recorder.attach(events, sessions)
    expect(() => fired.activity!('sess-1', null, T0)).not.toThrow()
  })
})
