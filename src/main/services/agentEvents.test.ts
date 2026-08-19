import http from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAgentEventListener, type AgentEventListener } from './agentEvents'
// Task 6b-1: the memory-usage counters' cases (second describe, below).
import { logger } from './logger'
import { CHORUS_MEMORY_SERVER } from './memoryService'
import type { SessionMemoryUsage } from '../../shared/ipc'

/**
 * The hook listener's EDGE TRIGGER (Task 4-1 / D145).
 *
 * ⚠ DRIVEN THROUGH THE REAL SURFACE — a bound ephemeral port and POSTed hook
 * bodies — rather than by exporting `record`. The trigger is only worth testing
 * if the classification gate is wired to it: a unit test over an exported
 * `record()` would have passed just as happily with `needsYouReasonFor` never
 * called at all, which is exactly the dead-code failure F66 is in the roadmap
 * for. `127.0.0.1:0` is fast and it is what the module already does in
 * production.
 *
 * ⚠ `Date.now` IS STUBBED so `since` can be asserted as an EXACT number. The
 * whole task turns on `since` NOT moving on a reason-only transition, and a
 * test that compared two real clock reads would pass by accident whenever both
 * landed in the same millisecond — which, over localhost, is most of the time.
 */

const WORKING_BODY = { hook_event_name: 'PreToolUse' }

function post(url: string, body: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: 'POST',
        headers: { 'content-type': 'application/json' }
      },
      (res) => {
        res.resume()
        // ⚠ The listener answers BEFORE it derives (it must never stall the
        // agent), so the response alone does not mean the record was written.
        // The derivation is synchronous in the same tick as the reply, so one
        // turn of the loop after `end` is enough — and is what makes this
        // deterministic rather than a sleep.
        res.on('end', () => setImmediate(resolve))
      }
    )
    req.on('error', reject)
    req.end(JSON.stringify(body))
  })
}

describe('agentEvents — the widened edge trigger (Task 4-1)', () => {
  let listener: AgentEventListener
  let url: string
  let seen: Array<{ sessionId: string; activity: string; since: number; reason: string | null }>
  let clock: number

  beforeEach(async () => {
    clock = Date.parse('2026-08-13T10:00:00.000Z')
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    listener = createAgentEventListener()
    await listener.start()
    url = listener.register('sess-1')
    seen = []
    listener.onActivity((sessionId, activity, since, reason) => {
      seen.push({ sessionId, activity, since, reason })
    })
  })

  afterEach(async () => {
    await listener.dispose()
    vi.restoreAllMocks()
  })

  it('fires once for a first classified event, carrying activity, since and reason', async () => {
    await post(url, { hook_event_name: 'PermissionRequest' })
    expect(seen).toEqual([
      { sessionId: 'sess-1', activity: 'needs-you', since: clock, reason: 'permission' }
    ])
  })

  it('⚠ does NOT fire when activity AND reason are both unchanged (F56 — still edge-triggered)', async () => {
    // The load-bearing half. A working agent fires PreToolUse/PostToolUse pairs
    // continuously; broadcasting each would put a stream of no-op IPC messages
    // behind every tool call. Widening the condition must not cost this.
    await post(url, WORKING_BODY)
    expect(seen).toHaveLength(1)
    await post(url, WORKING_BODY)
    await post(url, { hook_event_name: 'PostToolUse' })
    await post(url, WORKING_BODY)
    expect(seen).toHaveLength(1)
  })

  it('⚠ fires on a REASON-ONLY change, and `since` keeps its ORIGINAL value', async () => {
    // The case the old trigger swallowed: a session that stopped and then
    // raised a permission prompt would sit labelled "stopped" while it is in
    // fact BLOCKING ON A QUESTION.
    await post(url, { hook_event_name: 'Stop' })
    const firstSince = seen[0].since
    expect(seen[0].reason).toBe('stopped')

    clock += 90_000 // 90 s of waiting passes before it asks its question
    await post(url, { hook_event_name: 'PermissionRequest' })

    expect(seen).toHaveLength(2)
    expect(seen[1].activity).toBe('needs-you')
    expect(seen[1].reason).toBe('permission')
    // ⚠ THE ASSERTION THE WHOLE TASK EXISTS FOR, as an EXACT number: this
    // session has been waiting since it STOPPED. Re-stamping here would make it
    // permanently one second old, the escalation ladder could never climb, and
    // the Inbox's "oldest first" would silently become "most recently
    // re-classified first".
    expect(seen[1].since).toBe(firstSince)
    expect(seen[1].since).not.toBe(clock)
  })

  it('⚠ a Notification nag DURING a permission prompt is suppressed, not relabelled', async () => {
    // The sequence the runtime gate actually produced: PermissionRequest, then
    // Notification ~6 s later while the pane was still blocked on "Do you want
    // to proceed?". With `Notification` grouped as `permission`, both facts are
    // unchanged, so the widened early return swallows the second event — the
    // session stays correctly labelled AND costs one IPC message instead of two.
    await post(url, { hook_event_name: 'PermissionRequest' })
    const firstSince = seen[0].since
    clock += 6_000
    await post(url, { hook_event_name: 'Notification' })

    expect(seen).toHaveLength(1)
    expect(listener.recordFor('sess-1')).toEqual({
      activity: 'needs-you',
      reason: 'permission',
      since: firstSince
    })
  })

  it('re-stamps `since` when the ACTIVITY changes', async () => {
    await post(url, { hook_event_name: 'Stop' })
    const stoppedAt = seen[0].since

    clock += 30_000
    await post(url, WORKING_BODY)

    expect(seen).toHaveLength(2)
    expect(seen[1].activity).toBe('working')
    expect(seen[1].since).toBe(clock)
    expect(seen[1].since).not.toBe(stoppedAt)
  })

  it('⚠ a working agent carries reason null — there is no path that sets one', async () => {
    await post(url, { hook_event_name: 'Stop' })
    expect(seen[0].reason).toBe('stopped')
    clock += 1000
    await post(url, { hook_event_name: 'UserPromptSubmit' })
    expect(seen[1].activity).toBe('working')
    expect(seen[1].reason).toBeNull()
  })

  it('a full stop -> answer -> stop cycle reports all three transitions', async () => {
    // The sequence the runtime gate drives by hand, pinned here so a regression
    // shows up in CI rather than in a pane.
    await post(url, { hook_event_name: 'PermissionRequest' })
    clock += 5_000
    await post(url, { hook_event_name: 'PreToolUse' })
    clock += 5_000
    await post(url, { hook_event_name: 'Stop' })

    expect(seen.map((e) => [e.activity, e.reason])).toEqual([
      ['needs-you', 'permission'],
      ['working', null],
      ['needs-you', 'stopped']
    ])
    // Every one of those is a real activity change, so all three stamps differ.
    expect(new Set(seen.map((e) => e.since)).size).toBe(3)
  })

  it('an unclassified event leaves the record — and the reason — exactly as they were', async () => {
    await post(url, { hook_event_name: 'PermissionRequest' })
    clock += 10_000
    await post(url, { hook_event_name: 'SessionStart' })
    await post(url, { hook_event_name: 'SomeFutureEventName' })
    expect(seen).toHaveLength(1)
    expect(listener.recordFor('sess-1')).toEqual({
      activity: 'needs-you',
      reason: 'permission',
      since: seen[0].since
    })
  })

  it('⚠ snapshot() carries the reason — the cold read must not disagree with the stream', async () => {
    // D143(f) in its other half: a missed field here would show every waiting
    // session as reasonless on reload while the live stream showed reasons — a
    // discrepancy that looks like a race and is not one.
    const second = listener.register('sess-2')
    await post(url, { hook_event_name: 'Elicitation' })
    await post(second, { hook_event_name: 'Stop' })
    expect(listener.snapshot()).toEqual([
      { sessionId: 'sess-1', activity: 'needs-you', reason: 'permission', since: clock },
      { sessionId: 'sess-2', activity: 'needs-you', reason: 'stopped', since: clock }
    ])
  })

  it('revoke forgets the reason along with the record', async () => {
    await post(url, { hook_event_name: 'Stop' })
    listener.revoke('sess-1')
    expect(listener.recordFor('sess-1')).toBeNull()
    expect(listener.snapshot()).toEqual([])
  })

  it('a listener that throws does not stop the others, reason included', async () => {
    // Unchanged behaviour, re-pinned because the callback gained a parameter:
    // this runs inside the hook request Claude Code is waiting on.
    const after: string[] = []
    listener.onActivity(() => {
      throw new Error('bad listener')
    })
    listener.onActivity((_id, _a, _s, reason) => after.push(String(reason)))
    await expect(post(url, { hook_event_name: 'PermissionRequest' })).resolves.toBeUndefined()
    expect(after).toEqual(['permission'])
  })
})

/* ═══════════════════════════════════════════════════════════════════════════
 * Task 6b-1 (D168, amended by D173): the memory-usage counters, driven through
 * the SAME bound port as everything above. The three invariants a reviewer is
 * told to test hardest (ImplementationSpec-6b-1 §9) are each proven
 * behaviourally here, not asserted from a summary:
 *   1. no tool name reaches any output — on the success, ERROR and EXCEPTION
 *      paths (the canary tests);
 *   2. the count is taken BEFORE `record()`'s edge filter and only the
 *      BROADCAST is gated (twenty reads → 20 with ONE onActivity; twenty
 *      `Read`s → zero onMemoryUsage);
 *   3. the ordering result has THREE disjoint outcomes, and `Bash` feeds the
 *      diagnostic and never the pass/fail branch.
 * ═══════════════════════════════════════════════════════════════════════════ */


const MEM_READ = `mcp__${CHORUS_MEMORY_SERVER}__read_neo4j_cypher`
const MEM_WRITE = `mcp__${CHORUS_MEMORY_SERVER}__write_neo4j_cypher`

/** A `PostToolUse` body — the SUCCESSFUL-tool-result edge (measured). */
const ptu = (tool_name: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  hook_event_name: 'PostToolUse',
  tool_name,
  ...extra
})

/** Like `post`, but returns the response body so a test can prove the listener
 *  answered `{}` and never echoed anything. Raw string payloads are sent as-is
 *  so the malformed-body path can be exercised with a non-JSON body. */
function postRaw(url: string, raw: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: 'POST',
        headers: { 'content-type': 'application/json' }
      },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (c: string) => (body += c))
        res.on('end', () => setImmediate(() => resolve(body)))
      }
    )
    req.on('error', reject)
    req.end(raw)
  })
}

describe('agentEvents — the memory-usage counters (Task 6b-1 / D168 / D173)', () => {
  let listener: AgentEventListener
  let url: string
  let activitySeen: number
  let usageSeen: Array<{ sessionId: string; usage: SessionMemoryUsage }>

  beforeEach(async () => {
    vi.spyOn(Date, 'now').mockImplementation(() => Date.parse('2026-08-19T10:00:00.000Z'))
    listener = createAgentEventListener()
    await listener.start()
    url = listener.register('sess-m')
    activitySeen = 0
    usageSeen = []
    listener.onActivity(() => {
      activitySeen += 1
    })
    listener.onMemoryUsage((sessionId, usage) => {
      usageSeen.push({ sessionId, usage })
    })
  })

  afterEach(async () => {
    await listener.dispose()
    vi.restoreAllMocks()
  })

  /* ── invariant 2: counted before the edge filter; only the broadcast gated ── */

  it('⚠ twenty memory-read receipts -> reads === 20 and TWENTY onMemoryUsage, while onActivity fires ONCE (F55/F56)', async () => {
    // The collapse point is `record()`'s `if (prev?.activity === next …) return`
    // — twenty `PostToolUse` events are ONE activity callback. A count taken
    // after that filter would report "1 read" for a session that made twenty,
    // and a unit test over the counter's own API would still pass. So this is
    // proven through the port: the activity stream must collapse AND the
    // counter must not.
    for (let i = 0; i < 20; i++) await post(url, ptu(MEM_READ))
    expect(listener.memoryUsageFor('sess-m')?.reads).toBe(20)
    expect(usageSeen).toHaveLength(20)
    expect(usageSeen[19].usage.reads).toBe(20)
    expect(activitySeen).toBe(1)
  })

  it('⚠ twenty `Read` receipts -> reads 0, writes 0, ZERO onMemoryUsage — yet the ordinals advanced', async () => {
    // The count is not gated; the BROADCAST is. Twenty `Read`s move no counted
    // fact, so nothing is forwarded — and the record still exists and still
    // advanced its ordinal twenty times, which the 21st receipt proves: a memory
    // read AFTER twenty `Read`s cannot be "read first".
    for (let i = 0; i < 20; i++) await post(url, ptu('Read'))
    expect(usageSeen).toHaveLength(0)
    const u = listener.memoryUsageFor('sess-m')
    expect(u).toEqual({
      reads: 0,
      writes: 0,
      readBeforeExplore: false,
      readInconclusive: false,
      shellFirst: false
    })
    await post(url, ptu(MEM_READ))
    expect(usageSeen).toHaveLength(1)
    expect(usageSeen[0].usage).toEqual({
      reads: 1,
      writes: 0,
      readBeforeExplore: false, // the first `Read` sat at ordinal 1; the read is at 21
      readInconclusive: false,
      shellFirst: false
    })
  })

  it('⚠ a memory read is counted even when the activity stream is ALREADY collapsed', async () => {
    // Establish `working` first (so the activity filter is in its suppressing
    // state), then read. The activity callback count must not move; the memory
    // counter must.
    await post(url, { hook_event_name: 'PreToolUse' })
    expect(activitySeen).toBe(1)
    await post(url, ptu(MEM_READ))
    await post(url, ptu(MEM_READ))
    expect(activitySeen).toBe(1)
    expect(listener.memoryUsageFor('sess-m')?.reads).toBe(2)
  })

  /* ── the counted edge: PostToolUse only, by === ─────────────────────────── */

  it('⚠ PreToolUse with the memory-read name does NOT count (an attempt the user may deny)', async () => {
    await post(url, { hook_event_name: 'PreToolUse', tool_name: MEM_READ })
    expect(listener.memoryUsageFor('sess-m')).toBeNull()
    expect(usageSeen).toHaveLength(0)
  })

  it('⚠ PostToolUseFailure with the memory-read name does NOT count (a failed call read nothing — measured)', async () => {
    // `PostToolUseFailure` shares the prefix; a `startsWith` would count it and
    // destroy the word "successful" in every label this task ships.
    await post(url, { hook_event_name: 'PostToolUseFailure', tool_name: MEM_READ, error: 'Neo.ClientError.Statement.SyntaxError' })
    expect(listener.memoryUsageFor('sess-m')).toBeNull()
    expect(usageSeen).toHaveLength(0)
  })

  it('a write is counted separately and never moves the read ordinal', async () => {
    await post(url, ptu(MEM_WRITE))
    await post(url, ptu('Read'))
    await post(url, ptu(MEM_READ))
    expect(listener.memoryUsageFor('sess-m')).toEqual({
      reads: 1,
      writes: 1,
      readBeforeExplore: false, // the write at 1 is not a read; `Read` at 2 precedes the read at 3
      readInconclusive: false,
      shellFirst: false
    })
  })

  it('a future chorus-memory tool moves nothing and does not make the session inconclusive', async () => {
    await post(url, ptu(`mcp__${CHORUS_MEMORY_SERVER}__some_future_tool`))
    await post(url, ptu(MEM_READ))
    expect(listener.memoryUsageFor('sess-m')).toEqual({
      reads: 1,
      writes: 0,
      readBeforeExplore: true,
      readInconclusive: false,
      shellFirst: false
    })
  })

  /* ── the ordering result: the original cases ───────────────────────────── */

  it('a memory read before any exploration tool -> readBeforeExplore true', async () => {
    await post(url, ptu('ToolSearch')) // F92: the deferred-tool load, NOT exploration
    await post(url, ptu(MEM_READ))
    await post(url, ptu('Read'))
    expect(listener.memoryUsageFor('sess-m')?.readBeforeExplore).toBe(true)
  })

  it('a `Read` first, then a memory read -> readBeforeExplore false', async () => {
    await post(url, ptu('Read'))
    await post(url, ptu(MEM_READ))
    expect(listener.memoryUsageFor('sess-m')?.readBeforeExplore).toBe(false)
    expect(listener.memoryUsageFor('sess-m')?.readInconclusive).toBe(false)
  })

  it('a memory read with NO exploration at all -> readBeforeExplore true', async () => {
    await post(url, ptu(MEM_READ))
    expect(listener.memoryUsageFor('sess-m')?.readBeforeExplore).toBe(true)
  })

  it('⚠ no memory read at all -> readBeforeExplore false (the completed-read requirement, original)', async () => {
    // A session that explored nothing AND read nothing must not read as "read
    // first" — that would make the milestone's first clause pass on a session
    // that did nothing at all. This clause predates D173 and is cited unchanged.
    await post(url, ptu('ToolSearch'))
    expect(listener.memoryUsageFor('sess-m')?.readBeforeExplore).toBe(false)
    await post(url, ptu('Read'))
    expect(listener.memoryUsageFor('sess-m')?.readBeforeExplore).toBe(false)
  })

  /* ── ⚠ THE D173 ORDERING CASES, ALL FIVE — the three outcomes proven DISJOINT ── */

  it('⚠ D173 (1): `Bash` then a memory read -> readBeforeExplore TRUE, readInconclusive FALSE, shellFirst TRUE', async () => {
    // THIS IS THE CASE D173 CHANGED, and the one that silently reverts if
    // someone puts `Bash` back in the exploration set: the pass flag would flip
    // to false while every other assertion here stayed green.
    await post(url, ptu('Bash'))
    await post(url, ptu(MEM_READ))
    expect(listener.memoryUsageFor('sess-m')).toEqual({
      reads: 1,
      writes: 0,
      readBeforeExplore: true,
      readInconclusive: false,
      shellFirst: true
    })
  })

  it('D173 (1b): `PowerShell` is the same diagnostic — measured on 2.1.235 for Windows', async () => {
    await post(url, ptu('PowerShell'))
    await post(url, ptu(MEM_READ))
    expect(listener.memoryUsageFor('sess-m')).toEqual({
      reads: 1,
      writes: 0,
      readBeforeExplore: true,
      readInconclusive: false,
      shellFirst: true
    })
  })

  it('D173 (2): a memory read then `Bash` -> shellFirst false', async () => {
    await post(url, ptu(MEM_READ))
    await post(url, ptu('Bash'))
    expect(listener.memoryUsageFor('sess-m')?.shellFirst).toBe(false)
    expect(listener.memoryUsageFor('sess-m')?.readBeforeExplore).toBe(true)
  })

  it('⚠ D173 (3): an UNKNOWN name then a memory read -> readInconclusive TRUE, readBeforeExplore FALSE — and not a failure', async () => {
    // A renamed vendor tool before the first read: the instrument says "we
    // cannot say" rather than failing open in the agent's favour.
    await post(url, ptu('SomeFutureTool'))
    await post(url, ptu(MEM_READ))
    const u = listener.memoryUsageFor('sess-m') as SessionMemoryUsage
    expect(u.readInconclusive).toBe(true)
    expect(u.readBeforeExplore).toBe(false)
    expect(u.shellFirst).toBe(false)
    // "Not a failure" is structural: the wire shape has no failure field, and
    // the two flags are mutually exclusive — exactly one of the three outcomes.
    expect([u.readBeforeExplore, u.readInconclusive].filter(Boolean)).toHaveLength(1)
  })

  it('D173 (4): a memory read then an unknown name -> readInconclusive false, readBeforeExplore true', async () => {
    // The unknown arrived too late to cast doubt on the ordering.
    await post(url, ptu(MEM_READ))
    await post(url, ptu('SomeFutureTool'))
    expect(listener.memoryUsageFor('sess-m')).toEqual({
      reads: 1,
      writes: 0,
      readBeforeExplore: true,
      readInconclusive: false,
      shellFirst: false
    })
  })

  it('D173 (5): `Read` then an unknown then a memory read -> BOTH flags false — a known call already decided it', async () => {
    await post(url, ptu('Read'))
    await post(url, ptu('SomeFutureTool'))
    await post(url, ptu(MEM_READ))
    const u = listener.memoryUsageFor('sess-m') as SessionMemoryUsage
    expect(u.readBeforeExplore).toBe(false)
    expect(u.readInconclusive).toBe(false)
  })

  it('⚠ the three outcomes are DISJOINT: no sequence yields both flags true', async () => {
    // Every ordering of the four kinds of receipt around one memory read, and
    // in none of them do PASS and INCONCLUSIVE hold together.
    const kinds = ['Read', 'Bash', 'SomeFutureTool', 'ToolSearch']
    for (const before of kinds) {
      for (const after of kinds) {
        const l = createAgentEventListener()
        await l.start()
        const u = l.register('s')
        await post(u, ptu(before))
        await post(u, ptu(MEM_READ))
        await post(u, ptu(after))
        const got = l.memoryUsageFor('s') as SessionMemoryUsage
        expect(got.readBeforeExplore && got.readInconclusive, `${before} → read → ${after}`).toBe(false)
        await l.dispose()
      }
    }
  })

  /* ── set-once ──────────────────────────────────────────────────────────── */

  it('⚠ the three flags are SET-ONCE: later receipts of any kind leave a true flag true', async () => {
    // readBeforeExplore
    await post(url, ptu(MEM_READ))
    expect(listener.memoryUsageFor('sess-m')?.readBeforeExplore).toBe(true)
    for (const name of ['Bash', 'Read', 'SomeFutureTool', MEM_READ, 'ToolSearch']) await post(url, ptu(name))
    expect(listener.memoryUsageFor('sess-m')?.readBeforeExplore).toBe(true)
    expect(listener.memoryUsageFor('sess-m')?.readInconclusive).toBe(false)

    // readInconclusive, on a fresh session
    const u2 = listener.register('sess-n')
    await post(u2, ptu('SomeFutureTool'))
    await post(u2, ptu(MEM_READ))
    expect(listener.memoryUsageFor('sess-n')?.readInconclusive).toBe(true)
    for (const name of ['Read', 'Bash', MEM_READ, 'SomeFutureTool']) await post(u2, ptu(name))
    expect(listener.memoryUsageFor('sess-n')?.readInconclusive).toBe(true)
    expect(listener.memoryUsageFor('sess-n')?.readBeforeExplore).toBe(false)

    // shellFirst, on a fresh session
    const u3 = listener.register('sess-o')
    await post(u3, ptu('Bash'))
    await post(u3, ptu(MEM_READ))
    expect(listener.memoryUsageFor('sess-o')?.shellFirst).toBe(true)
    for (const name of ['Read', MEM_READ, 'SomeFutureTool', 'Bash']) await post(u3, ptu(name))
    expect(listener.memoryUsageFor('sess-o')?.shellFirst).toBe(true)
  })

  /* ── cleanup ───────────────────────────────────────────────────────────── */

  it('revoke(sessionId) clears the usage record as it clears activity', async () => {
    await post(url, ptu(MEM_READ))
    expect(listener.memoryUsageFor('sess-m')?.reads).toBe(1)
    listener.revoke('sess-m')
    expect(listener.memoryUsageFor('sess-m')).toBeNull()
    expect(listener.activityFor('sess-m')).toBeNull()
  })

  it('a re-registered session starts its in-memory record from zero (the lower-bound limit, stated)', async () => {
    // This is the restart under-count `setSessionMemoryUsage`'s MAX() write and
    // MEMORY_USAGE_LOWER_BOUND_NOTE exist for: main's record restarts; the row
    // keeps the highest registration's numbers.
    await post(url, ptu(MEM_READ))
    listener.revoke('sess-m')
    const fresh = listener.register('sess-m')
    await post(fresh, ptu(MEM_READ))
    expect(listener.memoryUsageFor('sess-m')?.reads).toBe(1)
  })

  it('dispose() clears the map and the listener set', async () => {
    await post(url, ptu(MEM_READ))
    await listener.dispose()
    expect(listener.memoryUsageFor('sess-m')).toBeNull()
    // A listener added before dispose never fires again; one added after is a
    // fresh set on a listener that will be restarted by the next test's
    // beforeEach (dispose is idempotent for afterEach).
    await listener.start()
    const again = listener.register('sess-m')
    await post(again, ptu(MEM_READ))
    expect(usageSeen).toHaveLength(1) // only the pre-dispose receipt reached it
  })

  it('a bad onMemoryUsage listener does not stop the others and does not fail the HTTP request', async () => {
    listener.onMemoryUsage(() => {
      throw new Error('bad memory listener')
    })
    const after: number[] = []
    listener.onMemoryUsage((_s, u) => {
      after.push(u.reads)
    })
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined)
    const body = await postRaw(url, JSON.stringify(ptu(MEM_READ)))
    expect(body).toBe('{}')
    expect(after).toEqual([1])
    expect(errorSpy).toHaveBeenCalled()
  })

  /* ── ⚠ invariant 1: NO TOOL NAME REACHES ANY OUTPUT — success, ERROR and EXCEPTION paths (D173 Q1) ── */

  describe('⚠ the canary: no name, no input, no response reaches a log, a payload or the HTTP reply', () => {
    const CANARY = 'CANARY-9f3a7c1e-TOOLNAME'
    const INPUT_CANARY = 'CANARY-INPUT-MATCH (m:Memory) RETURN m'
    const RESPONSE_CANARY = 'CANARY-RESPONSE-graph-content'
    let logCalls: unknown[][]

    /** Every log level spied, every argument captured — `{ err }` objects
     *  included, because `logger.error({ err, body })` is the exact line that
     *  would undo the posture. */
    function spyLogger(): void {
      logCalls = []
      for (const level of ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const) {
        vi.spyOn(logger, level).mockImplementation(((...args: unknown[]) => {
          logCalls.push(args)
        }) as never)
      }
    }

    function everythingObserved(responses: string[]): string {
      // Errors do not JSON.stringify their message/stack, so serialise them by
      // hand as well — a canary inside an Error message is still a leak.
      const logs = logCalls.map((args) =>
        args
          .map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : JSON.stringify(a)))
          .join(' ')
      )
      const payloads = usageSeen.map((u) => JSON.stringify(u))
      return [...logs, ...payloads, ...responses].join('\n')
    }

    function expectNoCanary(observed: string): void {
      expect(observed).not.toContain(CANARY)
      expect(observed).not.toContain(INPUT_CANARY)
      expect(observed).not.toContain(RESPONSE_CANARY)
      expect(observed).not.toContain('chorus-memory') // the real name must not surface either
    }

    const withContent = (tool_name: string): Record<string, unknown> =>
      ptu(tool_name, {
        tool_input: { query: INPUT_CANARY },
        tool_response: RESPONSE_CANARY,
        tool_use_id: 'toolu_CANARY',
        prompt: 'prompt-' + CANARY
      })

    beforeEach(() => spyLogger())

    it('a VALID memory name — the broadcast carries five primitives and no string', async () => {
      const r = await postRaw(url, JSON.stringify(withContent(MEM_READ)))
      expect(usageSeen).toHaveLength(1)
      // Structural: the wire shape has NO string field at all.
      for (const v of Object.values(usageSeen[0].usage)) expect(typeof v).not.toBe('string')
      expectNoCanary(everythingObserved([r]))
    })

    it('an EXPLORATION name — nothing forwarded, nothing logged', async () => {
      const r = await postRaw(url, JSON.stringify(withContent('Read')))
      expect(usageSeen).toHaveLength(0)
      expectNoCanary(everythingObserved([r]))
    })

    it('an UNKNOWN name — the canary IS the name, and only an ordinal is kept', async () => {
      const r1 = await postRaw(url, JSON.stringify(withContent(CANARY)))
      const r2 = await postRaw(url, JSON.stringify(ptu(MEM_READ)))
      const u = listener.memoryUsageFor('sess-m') as SessionMemoryUsage
      expect(u.readInconclusive).toBe(true) // the unknown was classified…
      expectNoCanary(everythingObserved([r1, r2])) // …and its name went nowhere
      expect(JSON.stringify(u)).not.toContain(CANARY)
    })

    it('a MALFORMED body — a bare string, an array, a non-JSON body, a `__proto__` key (an OWN property after JSON.parse, carrying the canary), a non-string name — the rejection path', async () => {
      const r1 = await postRaw(url, JSON.stringify(CANARY))
      const r2 = await postRaw(url, JSON.stringify([{ tool_name: CANARY }]))
      const r3 = await postRaw(url, `{ this is not json ${CANARY}`)
      const r4 = await postRaw(url, `{"hook_event_name":"PostToolUse","__proto__":{"tool_name":"${CANARY}"}}`)
      const r5 = await postRaw(url, JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 42, tool_input: INPUT_CANARY }))
      expect(usageSeen).toHaveLength(0)
      expectNoCanary(everythingObserved([r1, r2, r3, r4, r5]))
      // The well-formed PostToolUse bodies still advanced an ordinal each (r4,
      // r5): a later memory read is therefore NOT inconclusive (no unknown was
      // classified — an unreadable name is not an unknown tool) but IS still
      // counted. Proven rather than assumed:
      await post(url, ptu(MEM_READ))
      expect(listener.memoryUsageFor('sess-m')).toEqual({
        reads: 1,
        writes: 0,
        readBeforeExplore: true,
        readInconclusive: false,
        shellFirst: false
      })
    })

    it('an OVERSIZED name (129+ chars, canary embedded) — the cap\u2019s rejection path', async () => {
      const huge = 'A'.repeat(100) + CANARY + 'B'.repeat(100)
      expect(huge.length).toBeGreaterThan(128)
      const r = await postRaw(url, JSON.stringify(withContent(huge)))
      expect(usageSeen).toHaveLength(0)
      expectNoCanary(everythingObserved([r]))
    })

    it('⚠ a LISTENER THAT THROWS — the catch runs with the receipt in scope and logs `{ err }` ONLY', async () => {
      // This is the exact place a `logger.error({ err, body })` would dump the
      // agent's Cypher and the graph's answer into the log while every other
      // test stayed green. The error message itself is clean; the only way the
      // canary can appear is if the catch logged the body.
      listener.onMemoryUsage(() => {
        throw new Error('listener exploded')
      })
      const r = await postRaw(url, JSON.stringify(withContent(MEM_READ)))
      expect(r).toBe('{}')
      const errorCalls = logCalls.filter((args) => JSON.stringify(args).includes('listener threw'))
      expect(errorCalls.length).toBeGreaterThan(0)
      expectNoCanary(everythingObserved([r]))
    })

    it('⚠ a TRANSCRIPT listener that throws on a memory receipt — the sibling catch is clean too', async () => {
      // The transcript block runs on the same receipt, before the counting
      // block; its catch must not log the body either.
      listener.onTranscriptPath(() => {
        throw new Error('transcript listener exploded')
      })
      const r = await postRaw(
        url,
        JSON.stringify({ ...withContent(MEM_READ), transcript_path: 'C:/x/' + CANARY + '.jsonl' })
      )
      expect(r).toBe('{}')
      expect(listener.memoryUsageFor('sess-m')?.reads).toBe(1) // still counted after the throw
      expectNoCanary(everythingObserved([r]))
    })
  })
})
