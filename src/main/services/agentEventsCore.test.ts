import { describe, it, expect } from 'vitest'
import {
  classifiedHookEventNames,
  classifyHookEvent,
  needsYouReasonFor,
  parseHookPath,
  readHookEventName
} from './agentEventsCore'

/**
 * The hook-listener core. Everything here is reachable without binding a port,
 * which is the whole reason the module was split this way — `vitest` runs
 * `environment: 'node'` and this repo has no HTTP test harness.
 */

const VALID_TOKEN = 'a'.repeat(64)

describe('classifyHookEvent — the lifecycle observed against claude 2.1.225', () => {
  /* The exact sequence a real `claude -p` run produced on 2026-08-07, with the
     activity each event proves. SessionStart and SessionEnd deliberately prove
     NOTHING — see the module note on why a freshly launched agent must not
     pulse, and on the PTY exit being the sole authority for a session ending. */
  it.each([
    ['SessionStart', null],
    ['UserPromptSubmit', 'working'],
    ['PreToolUse', 'working'],
    ['PostToolUse', 'working'],
    ['Stop', 'needs-you'],
    ['SessionEnd', null]
  ])('%s -> %s', (event, expected) => {
    expect(classifyHookEvent(event)).toBe(expected)
  })

  it('treats a permission ask as needs-you and a permission DENIAL as working', () => {
    // Not symmetry for its own sake: the ask blocks on a human, the denial is
    // an answer the agent carries on from. Getting this backwards would leave
    // a card amber for the rest of a turn that is actively running.
    expect(classifyHookEvent('PermissionRequest')).toBe('needs-you')
    expect(classifyHookEvent('PermissionDenied')).toBe('working')
  })

  it('keeps a long tool call green rather than letting it decay to amber', () => {
    // Both edges are mapped, so a multi-minute build between them cannot be
    // mistaken for a stopped agent.
    expect(classifyHookEvent('PreToolUse')).toBe('working')
    expect(classifyHookEvent('PostToolUseFailure')).toBe('working')
  })

  it('⚠ returns null for an unknown event rather than guessing', () => {
    // The honesty bar: an unrecognised event leaves the session's activity
    // exactly as it was. Defaulting to needs-you would make every future
    // Claude Code release a source of false amber — the one state allowed to
    // interrupt, fired by an event nobody has read.
    expect(classifyHookEvent('SomeFutureEventName')).toBeNull()
    expect(classifyHookEvent('')).toBeNull()
    expect(classifyHookEvent('stop')).toBeNull() // case-sensitive by design
  })
})

describe('needsYouReasonFor — WHY a session needs a human (Task 4-1 / D145)', () => {
  /* All six stopping events collapsed to one undifferentiated state before
     D145. The grouping is a JUDGEMENT recorded in Task-4-1.md: getting it wrong
     costs a LABEL, not data, because the reason is derived from the event name
     at classification time and never stored. */
  it.each([
    ['PermissionRequest', 'permission'],
    ['Elicitation', 'permission'],
    ['Stop', 'stopped'],
    ['StopFailure', 'stopped'],
    ['Notification', 'notice'],
    ['TeammateIdle', 'notice']
  ])('%s -> %s', (event, expected) => {
    expect(needsYouReasonFor(event)).toBe(expected)
  })

  it('⚠ gives every WORKING event a null reason — by construction, not by a branch', () => {
    // `record()` passes this function's result straight through, so a working
    // session cannot carry a reason unless this returns one. Derived from the
    // one home rather than a second hand-written list.
    const working = classifiedHookEventNames().filter((n) => classifyHookEvent(n) === 'working')
    expect(working).toHaveLength(10)
    for (const name of working) expect(needsYouReasonFor(name)).toBeNull()
  })

  it('returns null for an unknown event, exactly as classifyHookEvent does', () => {
    for (const name of ['SomeFutureEventName', '', 'stop', 'SessionStart', 'SessionEnd']) {
      expect(needsYouReasonFor(name)).toBeNull()
      expect(classifyHookEvent(name)).toBeNull()
    }
  })

  it('⚠ does NOT walk the prototype chain — a body claiming "constructor" lights nothing', () => {
    // The map restructure is what introduced this hole: the flat array it
    // replaced had none. A hook body is untrusted input (D83), so an `in` check
    // or a bare truthy lookup would classify `constructor`/`toString` as
    // needs-you and pulse a card for an event that does not exist.
    for (const name of ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf']) {
      expect(classifyHookEvent(name)).toBeNull()
      expect(needsYouReasonFor(name)).toBeNull()
    }
  })

  it('every needs-you event has a reason, and no working event does', () => {
    // The invariant the two functions must satisfy together: `reason !== null`
    // if and only if the activity is `needs-you`.
    for (const name of classifiedHookEventNames()) {
      const isNeedsYou = classifyHookEvent(name) === 'needs-you'
      expect(needsYouReasonFor(name) !== null).toBe(isNeedsYou)
    }
  })
})

describe('classifiedHookEventNames — one home for the subscription list', () => {
  it('⚠ returns the SAME 16 names in the SAME order as before the map restructure', () => {
    // The drift guard for Task 4-1. `NEEDS_YOU_EVENTS` became a name->reason
    // map, and `Object.keys` on a string-keyed literal preserves insertion
    // order — so this array is a CONTRACT rather than a hope. The order is
    // observable in the written hook settings file, and the drift it guards is
    // silent in both directions.
    expect(classifiedHookEventNames()).toEqual([
      'UserPromptSubmit',
      'PreToolUse',
      'PostToolUse',
      'PostToolUseFailure',
      'PermissionDenied',
      'SubagentStart',
      'SubagentStop',
      'PreCompact',
      'PostCompact',
      'ElicitationResult',
      'Stop',
      'StopFailure',
      'Notification',
      'PermissionRequest',
      'Elicitation',
      'TeammateIdle'
    ])
  })

  it('is exactly the set classifyHookEvent can classify', () => {
    // The drift this guards is silent in BOTH directions: subscribing to an
    // unclassified event burns a process spawn per occurrence, and classifying
    // an unsubscribed one means a light that never lights.
    for (const name of classifiedHookEventNames()) {
      expect(classifyHookEvent(name)).not.toBeNull()
    }
  })

  it('contains the two events the lights actually depend on', () => {
    expect(classifiedHookEventNames()).toContain('Stop')
    expect(classifiedHookEventNames()).toContain('UserPromptSubmit')
  })

  it('names no duplicates — a repeat would double-write the hook config', () => {
    const names = classifiedHookEventNames()
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('parseHookPath — the listener has exactly one route', () => {
  it('accepts POST /hook/<64 hex> and returns the token', () => {
    expect(parseHookPath(`/hook/${VALID_TOKEN}`)).toBe(VALID_TOKEN)
  })

  it.each([
    ['undefined', undefined],
    ['root', '/'],
    ['another path', '/hooks/' + VALID_TOKEN],
    ['no token', '/hook/'],
    ['short token', '/hook/abc'],
    ['uppercase hex', '/hook/' + 'A'.repeat(64)],
    ['non-hex', '/hook/' + 'z'.repeat(64)],
    ['too long', '/hook/' + 'a'.repeat(65)],
    ['trailing slash', `/hook/${VALID_TOKEN}/`],
    ['query string', `/hook/${VALID_TOKEN}?x=1`],
    ['fragment', `/hook/${VALID_TOKEN}#x`],
    ['traversal', `/hook/../hook/${VALID_TOKEN}`]
  ])('rejects %s', (_label, url) => {
    expect(parseHookPath(url)).toBeNull()
  })

  it('⚠ rejects a malformed token BEFORE any map lookup', () => {
    // The shape check is what keeps junk away from the token map entirely, so
    // the map's timing profile cannot be probed with garbage. Asserted as a
    // property of the parser because that is where the guarantee lives.
    expect(parseHookPath('/hook/' + '%'.repeat(64))).toBeNull()
  })
})

describe('readHookEventName — a hook body is untrusted input', () => {
  it('reads hook_event_name off a well-formed body', () => {
    expect(readHookEventName({ hook_event_name: 'Stop', session_id: 'x' })).toBe('Stop')
  })

  it.each([
    ['null', null],
    ['a string', '"Stop"'],
    ['a number', 42],
    ['an array', ['Stop']],
    ['an empty object', {}],
    ['a non-string name', { hook_event_name: 7 }],
    ['an empty name', { hook_event_name: '' }],
    ['an over-long name', { hook_event_name: 'x'.repeat(65) }]
  ])('returns null for %s', (_label, body) => {
    expect(readHookEventName(body)).toBeNull()
  })

  it('⚠ extracts ONLY the event name, never conversation content', () => {
    // The payload really does carry the user's prompt and the assistant's last
    // message. Nothing here should be able to return them: what is not taken
    // cannot leak into a log, a card, or a database.
    const body = {
      hook_event_name: 'Stop',
      prompt: 'my secret prompt',
      last_assistant_message: 'sensitive answer',
      transcript_path: 'C:\\Users\\someone\\.claude\\projects\\x.jsonl'
    }
    expect(readHookEventName(body)).toBe('Stop')
  })
})
