import http from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAgentEventListener, type AgentEventListener } from './agentEvents'

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
