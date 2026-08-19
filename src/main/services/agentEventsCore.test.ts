import { describe, it, expect } from 'vitest'
import {
  classifiedHookEventNames,
  classifyHookEvent,
  classifyMemoryTool,
  isExplorationTool,
  isKnownTool,
  isShellTool,
  needsYouReasonFor,
  parseHookPath,
  readHookEventName,
  readToolName
} from './agentEventsCore'
import { CHORUS_MEMORY_SERVER } from './memoryService'

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
    ['Notification', 'permission'],
    ['Stop', 'stopped'],
    ['StopFailure', 'stopped'],
    ['TeammateIdle', 'notice']
  ])('%s -> %s', (event, expected) => {
    expect(needsYouReasonFor(event)).toBe(expected)
  })

  it('⚠ Notification does NOT downgrade a blocked session — the measured case', () => {
    // Task 4-1's runtime gate observed `Notification` arriving ~6 s after a
    // `PermissionRequest`, while the pane was still blocked on "Do you want to
    // proceed?". Grouped as `notice` it flipped the live reason DOWNWARD, so a
    // session blocking on a question read as one that merely mentioned
    // something. Same reason means the widened edge trigger now SUPPRESSES the
    // nag entirely rather than broadcasting a worse label.
    expect(needsYouReasonFor('Notification')).toBe(needsYouReasonFor('PermissionRequest'))
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

/* ═══════════════════════════════════════════════════════════════════════════
 * Task 6b-1 (D168, amended by D173): the tool-name reader and the four
 * classifiers. Every name below is either one the census measured on claude
 * 2.1.235 on 2026-08-19 (`_verify/6b-1/hookprobe/`) or a deliberately
 * plausible future name, and the comment beside each assertion says which.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** The prefix DERIVED from the import, exactly as the module derives it. */
const MEM = `mcp__${CHORUS_MEMORY_SERVER}__`

describe('readToolName — the one new field, read like readHookEventName (D168)', () => {
  it('reads tool_name off a well-formed PostToolUse body', () => {
    expect(
      readToolName({ hook_event_name: 'PostToolUse', tool_name: `${MEM}read_neo4j_cypher` })
    ).toBe(`${MEM}read_neo4j_cypher`)
  })

  it.each([
    ['null', null],
    ['a string', '"Read"'],
    ['a number', 42],
    ['an array', ['Read']],
    ['an empty object', {}],
    ['a non-string name', { tool_name: 7 }],
    ['an empty name', { tool_name: '' }],
    ['a 129-character name', { tool_name: 'x'.repeat(129) }]
  ])('returns null for %s', (_label, body) => {
    expect(readToolName(body)).toBeNull()
  })

  it('⚠ the cap is 128, asserted at the boundary in both directions', () => {
    // 128 passes, 129 fails — the spec's number, not "about a hundred". The
    // longest measured name is 36 characters; the cap exists so a hostile body
    // cannot hand a megabyte to `startsWith`.
    expect(readToolName({ tool_name: 'x'.repeat(128) })).toBe('x'.repeat(128))
    expect(readToolName({ tool_name: 'x'.repeat(129) })).toBeNull()
  })

  it('⚠ extracts ONLY the name, never the input, the response or the ids', () => {
    // The payload really does carry the agent's Cypher (`tool_input`) and the
    // graph's answer (`tool_response`). Nothing here can return them: what is
    // not taken cannot leak into a log, a card, or a database.
    const body = {
      hook_event_name: 'PostToolUse',
      tool_name: 'Read',
      tool_input: { query: 'MATCH (m:Memory) RETURN m' },
      tool_response: { rows: [{ secret: 'graph content' }] },
      tool_use_id: 'toolu_01',
      prompt: 'my secret prompt'
    }
    expect(readToolName(body)).toBe('Read')
  })

  it('⚠ a hostile body yields null and touches nothing', () => {
    // Prototype-shaped keys, a megabyte-long name, and a name that lives on the
    // PROTOTYPE CHAIN rather than on the body — `JSON.parse` never produces the
    // last one, but the reader is the boundary and it checks own-property-ness
    // the way `classifyHookEvent` does (D83: a hook body is untrusted input).
    expect(readToolName({ constructor: 'Read', toString: 'Read' })).toBeNull()
    expect(readToolName({ tool_name: 'R'.repeat(1024 * 1024) })).toBeNull()
    expect(readToolName(Object.create({ tool_name: 'Read' }))).toBeNull()
    expect(readToolName({ __proto__: { tool_name: 'Read' } })).toBeNull()
  })
})

describe('classifyMemoryTool — the chorus-memory server\'s three tools, by DERIVED prefix', () => {
  it('⚠ the prefix equals `mcp__${CHORUS_MEMORY_SERVER}__` — asserted against the import', () => {
    // A server rename cannot leave a stale literal here: the test spells the
    // prefix from the same constant the module does, and then proves the
    // module honours exactly that spelling and no other.
    expect(MEM).toBe('mcp__chorus-memory__')
    expect(classifyMemoryTool(`${MEM}read_neo4j_cypher`)).toBe('read')
    expect(classifyMemoryTool('mcp__other-server__read_neo4j_cypher')).toBeNull()
  })

  it.each([
    [`${MEM}read_neo4j_cypher`, 'read'], // measured on PreToolUse, PostToolUse, PostToolUseFailure
    [`${MEM}get_neo4j_schema`, 'read'], // asking the graph what it holds is a read
    [`${MEM}write_neo4j_cypher`, 'write']
  ])('%s -> %s', (name, expected) => {
    expect(classifyMemoryTool(name)).toBe(expected)
  })

  it('⚠ an unrecognised tool under the SAME prefix is null — not counted rather than guessed', () => {
    // `classifyHookEvent`'s honesty bar, one module over: a future chorus-memory
    // tool moves no counter until someone has read its name. Under-count is
    // the safe direction for a milestone that reads "the agent queried the graph".
    expect(classifyMemoryTool(`${MEM}delete_everything`)).toBeNull()
    expect(classifyMemoryTool(`${MEM}`)).toBeNull()
  })

  it('the right suffix under a different server prefix is null', () => {
    expect(classifyMemoryTool('mcp__memory__read_neo4j_cypher')).toBeNull()
    expect(classifyMemoryTool('read_neo4j_cypher')).toBeNull()
  })

  it('case-sensitive by design — the `stop` precedent', () => {
    expect(classifyMemoryTool(`${MEM}READ_NEO4J_CYPHER`)).toBeNull()
    expect(classifyMemoryTool(`MCP__chorus-memory__read_neo4j_cypher`)).toBeNull()
  })
})

describe('isExplorationTool — the PASS/FAIL exploration set (D168, membership fixed by D173)', () => {
  it.each(['Read', 'Glob', 'Grep', 'LS', 'Agent'])('%s is exploration', (name) => {
    // `Read`, `Glob`, `Grep`, `Agent` were all observed as `PostToolUse` names in
    // the 6b-1 census on 2.1.235; `LS` was NOT observed and is kept on purpose.
    // `Agent` is the installed CLI's delegation tool — measured, not quoted
    // (it was `Task` within living memory).
    expect(isExplorationTool(name)).toBe(true)
  })

  it('⚠ ToolSearch is NOT exploration — F92, and this assertion exists to stop a "fix"', () => {
    // Measured again by 6b-1: claude 2.1.235 DEFERS MCP tools, so EVERY probe
    // that reached `mcp__chorus-memory__read_neo4j_cypher` fired `ToolSearch`
    // first. If `ToolSearch` counted as exploration, the first exploration
    // ordinal would ALWAYS precede the first memory read, `memory_read_first`
    // would be 0 on every session forever, and the phase's binary milestone
    // could never pass — while every other test here stayed green.
    expect(isExplorationTool('ToolSearch')).toBe(false)
  })

  it('⚠ Bash is NOT exploration — D173 (CR-6b.0 Q3), and this is the twin of the ToolSearch case', () => {
    // Without `tool_input` — which this feature will never read — `npm test`
    // and `ls` are the SAME EVENT, and this metric gates 6b-4's escalation, so
    // counting every shell call as exploration would depress the number and
    // trigger an intervention nobody's behaviour warranted. `Bash` (and its
    // Windows twin `PowerShell`) lives in the shell set and feeds a DIAGNOSTIC.
    // A reviewer should treat the deletion of this assertion as a scope change.
    expect(isExplorationTool('Bash')).toBe(false)
    expect(isExplorationTool('PowerShell')).toBe(false)
  })

  it.each(['WebFetch', 'WebSearch', 'Write', 'Edit', 'TaskCreate', 'TaskList', 'TaskUpdate', ''])(
    '%s is not exploration',
    (name) => {
      // Network, mutation and todo tools — all measured by the census, none of
      // them "looking at the filesystem". D173 refused to broaden the milestone
      // from "before filesystem exploration" to "before repository interaction".
      expect(isExplorationTool(name)).toBe(false)
    }
  )

  it('case-sensitive by design — `read` and `glob` classify as nothing', () => {
    expect(isExplorationTool('read')).toBe(false)
    expect(isExplorationTool('glob')).toBe(false)
    expect(isExplorationTool('GREP')).toBe(false)
  })
})

describe('isShellTool — the shell-before-first-read DIAGNOSTIC\'s input (D173)', () => {
  it('is true for Bash and for PowerShell — the census found the second on Windows', () => {
    // `PowerShell` was observed completing a directory listing on 2.1.235
    // (`_verify/6b-1/hookprobe/probeA-bodies.jsonl`) where a `Bash` attempt had
    // not. A set rather than `=== 'Bash'` is what lets one shell under two names
    // land in one place.
    expect(isShellTool('Bash')).toBe(true)
    expect(isShellTool('PowerShell')).toBe(true)
  })

  it('⚠ the shell set and the exploration set are DISJOINT — asserted directly', () => {
    // No name may reach both the pass/fail branch and the diagnostic. Every
    // exploration name, every memory name and `ToolSearch` is not a shell.
    for (const name of ['Read', 'Glob', 'Grep', 'LS', 'Agent']) {
      expect(isShellTool(name)).toBe(false)
      expect(isExplorationTool(name) && isShellTool(name)).toBe(false)
    }
    for (const name of ['Bash', 'PowerShell']) {
      expect(isExplorationTool(name)).toBe(false)
    }
    for (const name of [`${MEM}read_neo4j_cypher`, `${MEM}write_neo4j_cypher`, `${MEM}get_neo4j_schema`]) {
      expect(isShellTool(name)).toBe(false)
    }
    expect(isShellTool('ToolSearch')).toBe(false)
    expect(isShellTool('bash')).toBe(false) // case-sensitive, like everything here
  })
})

describe('isKnownTool — "unknown" is a DECIDABLE category (D173)', () => {
  it('is true for every name the 6b-1 census measured on claude 2.1.235', () => {
    // The full observed list, in the order it arrived across probes A, A2, A3,
    // B and C — plus `LS`, kept by decision. A name here that stopped being
    // known would make ordinary work INCONCLUSIVE, which is why the list is
    // pinned rather than trusted.
    const measured = [
      'Bash',
      'PowerShell',
      'Read',
      'ToolSearch',
      'TaskCreate',
      'Write',
      'Edit',
      'Agent',
      'WebFetch',
      'WebSearch',
      'Grep',
      'Glob',
      'TaskList',
      'TaskUpdate',
      'LS',
      `${MEM}read_neo4j_cypher`
    ]
    for (const name of measured) expect(isKnownTool(name), name).toBe(true)
  })

  it('⚠ the memory prefix counts as known even when classifyMemoryTool returns null', () => {
    // A future chorus-memory tool is not a read (that bar is unchanged) but it
    // is not vendor DRIFT either — Chorus ships the server, so it must not make
    // every session inconclusive.
    expect(classifyMemoryTool(`${MEM}some_future_tool`)).toBeNull()
    expect(isKnownTool(`${MEM}some_future_tool`)).toBe(true)
  })

  it('⚠ is false for a name this build has NOT measured — the case that produces INCONCLUSIVE', () => {
    // A renamed `Read`, the delegation tool's OLD name, a tool this build has
    // never heard of — and `NotebookEdit`, which DOES ship on claude 2.1.235
    // but was not observed by the census and is therefore unknown here BY
    // DESIGN ("err narrow, not broad"): a name missing from the known set costs
    // an inconclusive session, which is honest and recoverable by measuring it;
    // a name wrongly added costs a silent pass. Guessing "not exploration" for
    // any of these would fail open in the agent's favour; the module instead
    // lets `agentEvents.ts` mark the session inconclusive, which fails toward
    // "we cannot say" — the only direction a milestone may fail in.
    for (const name of ['Read2', 'FileRead', 'Task', 'Delegate', 'NotebookEdit', 'SomeFutureTool', '']) {
      expect(isKnownTool(name), name).toBe(false)
    }
  })

  it('case-sensitive by design', () => {
    expect(isKnownTool('read')).toBe(false)
    expect(isKnownTool('toolsearch')).toBe(false)
  })
})
