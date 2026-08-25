/**
 * The agent-activity derivation, factored PURE so Vitest's `environment:
 * 'node'` covers it without an HTTP server, a PTY, or Electron — the same
 * shape as `attentionCore` / `councilDocketCore`.
 *
 * ⚠ THIS MODULE IS WHAT MAKES D78 FALSE, DELIBERATELY. D78 ruled that "the
 * renderer can derive exactly THREE session states, not four", because
 * `sessionStatusSchema` is `running | exited` and NOTHING read an agent's own
 * account of what it was doing. That premise — not the ruling's reasoning — is
 * what this module removes: Claude Code's hook bus reports the agent's
 * lifecycle directly, so `needs-you` now has a SOURCE rather than a guess.
 * D83's lesson applied exactly as D83 states it: the answer to "the mock draws
 * data that does not exist" is omit it OR GIVE IT A SOURCE — never fake it.
 *
 * ⚠ AND THE HONESTY BAR IS THE WHOLE REASON THE MAP BELOW IS SHORT. An event
 * this module does not RECOGNISE returns `null`, which leaves the session's
 * activity exactly as it was — it never guesses, never defaults to
 * `needs-you`, and never invents a transition to look responsive. A false
 * amber is worse than no amber (D78's durable half), because amber is the one
 * state in Chorus allowed to interrupt.
 */

import { CHORUS_MEMORY_SERVER } from './memoryService'

/**
 * What the agent itself says it is doing. Deliberately NOT a session status:
 * `sessions.status` stays `running | exited` and remains the DB's business.
 * This is a SECOND, orthogonal fact that only exists while a session is live.
 */
export type AgentActivity = 'working' | 'needs-you'

/**
 * WHY a session needs a human. Orthogonal to `AgentActivity`, and deliberately
 * NOT a fourth activity: the filmstrip and the project rail derive their lights
 * from `activity`, and neither should have to learn a new enum member to keep
 * working. `docs/PLAN.md:184` names two states — `waiting-for-user` and
 * `waiting-for-permission` — and this is the field that makes that distinction
 * expressible; `permission` is the second, the other two are the first.
 *
 * ⚠ THE GROUPING IS A JUDGEMENT AND IT IS CHEAP TO CHANGE, WHICH IS WHY IT IS
 * MADE NOW RATHER THAN DEFERRED. The reason is derived from the event name at
 * classification time and never stored, so regrouping later is a one-line edit
 * with no migration and no data to reinterpret. Getting it wrong costs a label.
 */
export type NeedsYouReason = 'permission' | 'stopped' | 'notice'

/**
 * Claude Code 2.1.225's hook event vocabulary, verified 2026-08-07 against a
 * shipping plugin's `hooks.json` (`gitkraken-hooks`) rather than from memory —
 * CLAUDE.md's D4 rule ("CLI agent flags move fast") applies to hook names for
 * exactly the same reason. The lifecycle was then OBSERVED end to end against
 * the installed CLI:
 *
 *   SessionStart -> UserPromptSubmit -> PreToolUse -> PostToolUse -> Stop -> SessionEnd
 *
 * Every name below appeared in that vocabulary. Names NOT listed here are
 * recognised-as-unknown by design (see `classifyHookEvent`).
 */
const WORKING_EVENTS: readonly string[] = [
  // The user pressed enter — the agent is now the one with the ball. This is
  // the transition that clears an amber left by the previous turn.
  'UserPromptSubmit',
  // Tool traffic: unambiguous evidence of an agent mid-turn. Both edges are
  // mapped so a LONG tool call (a build, a test run) cannot decay into amber
  // while it is genuinely running.
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  // A denial is not a stop: the agent receives the refusal and keeps going.
  'PermissionDenied',
  // Sub-agent lifecycle (D39's read-only awareness, used here only as
  // liveness): a parent with a child running is working by definition.
  'SubagentStart',
  'SubagentStop',
  // Compaction is the agent working on its own context, not waiting on a human.
  'PreCompact',
  'PostCompact',
  // The user answered an elicitation, so the ball is back with the agent.
  'ElicitationResult'
]

/**
 * The amber set — every one of these means "stopped, and cannot continue
 * without a human", which is `Chorus Needs Attention.html`'s definition of the
 * state verbatim.
 *
 * ⚠ `Stop` IS THE LOAD-BEARING ONE, and it is the reason this feature is worth
 * building rather than approximating. It fires when the agent finishes its
 * turn — the exact moment a human's attention is required and the exact moment
 * a filmstrip of eight panes is useless without a signal. `Notification` and
 * `PermissionRequest` cover the mid-turn asks (a permission prompt), which are
 * MORE urgent but strictly rarer.
 *
 * ⚠ A MAP RATHER THAN A LIST SINCE D145, because "stopped" and "asking you a
 * question" are not the same interruption and the Inbox has to be able to say
 * which. The VALUE is the reason (see `NeedsYouReason`); the KEY SET is
 * unchanged, so nothing that derived from membership alone has moved.
 *
 * ⚠ THE KEY ORDER IS PART OF THE CONTRACT, NOT COSMETIC. `classifiedHookEventNames`
 * is the adapter's hook subscription list and its order is observable in the
 * written settings file; `Object.keys` on a string-keyed literal preserves
 * insertion order, so this order matches the array it replaced name for name.
 *
 * ⚠ `Notification` IS `permission`, AND THAT IS A MEASUREMENT RATHER THAN A
 * READING OF THE NAME. Grouped as a mild "notice" first, it was observed during
 * the Task 4-1 runtime gate arriving ~6 s AFTER a `PermissionRequest`, while the
 * pane was still visibly blocked on "Do you want to proceed?" — so the live
 * reason DOWNGRADED from `permission` to `notice` purely because the agent
 * nagged, leaving a session that is blocking on a question labelled as one that
 * merely mentioned something. The honest bound is stated rather than hidden:
 * Claude Code also fires `Notification` for plain idle-waiting-for-input, so
 * this mapping can over-state urgency on an idle pane. That is the safe
 * direction — `needs-you` is already the interrupting state either way, and a
 * blocked agent under-reported is a human who never comes back.
 */
const NEEDS_YOU_EVENTS: Readonly<Record<string, NeedsYouReason>> = {
  Stop: 'stopped',
  StopFailure: 'stopped',
  Notification: 'permission',
  PermissionRequest: 'permission',
  Elicitation: 'permission',
  TeammateIdle: 'notice'
}

/* ───────────────────────────────────────────────────────────────────────────
 * Task 6b-1 (D168, amended by D173): the memory-usage classifiers.
 *
 * Five FIXED sets and four pure predicates over one untrusted string — the
 * tool's NAME off a `PostToolUse` body. Every name an agent calls passes
 * through these comparisons and is DROPPED in the same expression; the only
 * outputs are booleans and a three-way `'read' | 'write' | null`. Nothing here
 * retains, logs or returns a name for any purpose other than the comparison.
 * ─────────────────────────────────────────────────────────────────────────── */

/**
 * Claude's tool-name prefix for an MCP server's tools, DERIVED rather than
 * typed: measured 2026-08-19 on claude 2.1.235 as
 * `mcp__chorus-memory__read_neo4j_cypher` (re-measured by Task 6b-1 the same
 * day, on `PreToolUse`, `PostToolUse` and `PostToolUseFailure` alike). A second
 * spelling here would classify a tool the config does not produce, and the
 * failure would be a counter that stays at zero while the agent is using the
 * graph — the 6a-1 rule, applied one module over.
 */
const CHORUS_MEMORY_TOOL_PREFIX = `mcp__${CHORUS_MEMORY_SERVER}__`

/** The server's read tools. `get_neo4j_schema` counts as a read because it is
 *  the agent asking the graph what it holds — the behaviour the milestone is
 *  measuring — even though it returns no data rows. */
const MEMORY_READ_TOOLS: readonly string[] = ['read_neo4j_cypher', 'get_neo4j_schema']

/** The server's one write tool. `write_neo4j_cypher` had been called ZERO
 *  times in this machine's entire transcript history at the Phase 6b kickoff
 *  (384 files) — which is the finding this counter exists to make visible
 *  rather than archaeological. */
const MEMORY_WRITE_TOOLS: readonly string[] = ['write_neo4j_cypher']

/**
 * Claude's built-in tools that mean "the agent has started looking at the
 * filesystem". FIXED, and D4-verified against the installed CLI at execution:
 * Task 6b-1's census on claude 2.1.235 (2026-08-19, `_verify/6b-1/hookprobe/`)
 * observed `Read`, `Glob`, `Grep` and `Agent` arriving as `PostToolUse` names.
 *
 * ⚠ `ToolSearch` IS DELIBERATELY ABSENT, AND THIS IS THE SINGLE MOST
 * LOAD-BEARING OMISSION IN THIS FILE. F92: claude 2.1.235 DEFERS MCP tools
 * behind `ToolSearch`, so an agent must call `ToolSearch` before it can call
 * `mcp__chorus-memory__read_neo4j_cypher` at all (re-measured by 6b-1: every
 * probe that reached the MCP tool fired `ToolSearch` first). Counting
 * `ToolSearch` as exploration would put an exploration ordinal in front of
 * EVERY memory read that has ever happened — `memory_read_first` would be 0
 * for every session forever, the phase's binary milestone could never pass,
 * and every unit test here would still be green. It is excluded by
 * MEASUREMENT, not by taste.
 *
 * ⚠ `WebFetch` / `WebSearch` are absent for a smaller reason: they are the
 * network, not the filesystem. ⚠ `Write` and `Edit` are absent because they are
 * not exploration; an agent that edits before reading the graph has a different
 * problem. D173 REFUSED to add them: doing so would silently change the
 * milestone from "before filesystem exploration" to "before repository
 * interaction".
 *
 * ⚠ `Bash` IS ABSENT, AND THIS REVERSES AN EARLIER DRAFT OF THIS FILE (D173,
 * CR-6b.0 Q3). The earlier argument was that including `Bash` makes the bar
 * STRICTER, which is the safe direction. The council's counter is decisive and
 * turns THIS TASK'S OWN LIMIT against it: because Chorus deliberately never
 * reads `tool_input`, `npm test`, `git status`, `docker ps` and `ls` are the
 * SAME EVENT here. Treating every shell call as exploration would depress the
 * metric for work that never explored anything — and because this metric GATES
 * 6b-4's escalation decision, a depressed metric does not merely misreport, it
 * triggers an intervention nobody's behaviour warranted. `Bash` lives in
 * SHELL_TOOLS below and feeds a DIAGNOSTIC, never a pass/fail input.
 *
 * `LS` is kept although claude 2.1.235 was not observed emitting it (neither by
 * the kickoff nor by 6b-1's census): a name that never arrives costs one string
 * comparison, and one that comes back would otherwise be missed in silence.
 *
 * ⚠ THE DELEGATION TOOL'S NAME IS MEASURED, NOT QUOTED. `Agent` is what both
 * the kickoff and 6b-1's census observed on 2.1.235; the council flagged that
 * the same tool was `Task` within living memory. If the installed CLI renames
 * it again, the old name falls out of every set below and the session turns
 * INCONCLUSIVE rather than silently passing — which is the honest failure.
 */
const EXPLORATION_TOOLS: readonly string[] = ['Read', 'Glob', 'Grep', 'LS', 'Agent']

/**
 * The shell. A SET RATHER THAN A BARE `=== 'Bash'`, and the census proved why
 * on the first run: claude 2.1.235 on Windows ALSO ships a `PowerShell` tool,
 * observed by 6b-1 on 2026-08-19 (`_verify/6b-1/hookprobe/probeA-bodies.jsonl`)
 * completing a directory listing where a `Bash` attempt had not. One shell
 * under two names lands in one place.
 *
 * ⚠ THIS SET FEEDS THE DIAGNOSTIC AND NOTHING ELSE. It must not be reachable
 * from the pass/fail derivation in `agentEvents.ts`'s `toUsage`, and a reviewer
 * should be able to prove that by grepping every use of `isShellTool`. A shell
 * call before the first memory read is INTERESTING — it is D173's
 * acknowledgement that a shell really is a filesystem escape hatch — but it is
 * shown as an aggregate diagnostic and never decides whether a session passed.
 */
const SHELL_TOOLS: readonly string[] = ['Bash', 'PowerShell']

/**
 * Names this build HAS SEEN and has deliberately decided are not exploration.
 * Seeded from Task 6b-1's census on the installed CLI (claude 2.1.235,
 * 2026-08-19, `_verify/6b-1/hookprobe/probeA2-bodies.jsonl` and
 * `probeA3-bodies.jsonl`): a todo list (`TaskCreate`, `TaskList`,
 * `TaskUpdate`), a file write and edit, a web fetch and a web search, and the
 * `ToolSearch` call that precedes every deferred tool.
 *
 * ⚠ THIS SET EXISTS SO THAT "UNKNOWN" IS A DECIDABLE CATEGORY. Without it, the
 * only way to be unknown is to fall through an `if` chain, and every ordinary
 * tool would silently read as "not exploration" — which is precisely the
 * fail-open D173 removed: a RENAMED `Read` would become a free pass on this
 * phase's headline number.
 *
 * ⚠ ERR NARROW, NOT BROAD. A name missing from here costs an INCONCLUSIVE
 * session — visible, honest, and recoverable by adding the name. A name wrongly
 * added here costs a SILENT PASS, which is not recoverable because nothing
 * reports it. `ToolSearch` belongs here rather than in EXPLORATION_TOOLS for
 * F92's reason above, and its membership here is what stops it from making
 * every MCP-using session inconclusive instead.
 */
const KNOWN_NON_EXPLORATION_TOOLS: readonly string[] = [
  'ToolSearch',
  'WebFetch',
  'WebSearch',
  'Write',
  'Edit',
  'TaskCreate',
  'TaskList',
  'TaskUpdate'
]

/**
 * One hook event name -> the activity it proves, or `null` for "this event
 * says nothing about who holds the ball".
 *
 * ⚠ `SessionStart` IS DELIBERATELY UNMAPPED, and this is a judgement, not an
 * omission. A freshly launched agent IS sitting at a prompt waiting for you,
 * so the literal reading is `needs-you` — but amber is the only state allowed
 * to interrupt, and a card that pulses the instant you launch it interrupts
 * you about something you just did on purpose. A session stays plain `running`
 * until it has actually been asked something and come back.
 *
 * ⚠ `SessionEnd` is likewise unmapped: the PTY exit is the authority on a
 * session ending (it always fires, hooks or no hooks), and a second source for
 * one fact is how the two drift apart.
 */
export function classifyHookEvent(eventName: string): AgentActivity | null {
  if (WORKING_EVENTS.includes(eventName)) return 'working'
  // ⚠ `hasOwnProperty`, NOT `eventName in NEEDS_YOU_EVENTS` AND NOT A BARE
  // TRUTHY LOOKUP. The event name is untrusted input (the bootInfo.ts
  // precedent, D83), and `in` walks the prototype chain — a body claiming
  // `hook_event_name: "constructor"` or `"toString"` would classify as
  // `needs-you` and light a card for an event that does not exist. The flat
  // array this replaced had no such hole; the map is what introduces it, so it
  // is closed in the same edit.
  if (Object.prototype.hasOwnProperty.call(NEEDS_YOU_EVENTS, eventName)) return 'needs-you'
  return null
}

/**
 * How long a session may show NO SIGN OF LIFE before `working` stops being a
 * claim Chorus is entitled to make.
 *
 * ⚠ WITHOUT THIS, `working` IS A LATCH, AND THE LATCH IS A MEASURED BUG RATHER
 * THAN A THEORETICAL ONE. Nothing in `classifyHookEvent` can leave the working
 * state: only a `NEEDS_YOU_EVENTS` name clears it. So ANY lost `Stop` — an
 * interrupt, a turn that ended in an API error, a `/compact` at an idle
 * prompt, a hook command that failed to deliver — pins the session as
 * "working" until its PTY dies or the app quits. `agent_turns` on the
 * installed 0.7.5 database records exactly that population (read 2026-08-23):
 * against 734 turns closed by an observed `Stop` with a MEDIAN LENGTH OF 1.8
 * MINUTES, 46 were closed only by session exit or app quit, including runs of
 * 547, 660, 752 and 4,157 minutes. Every one of those was a project rail
 * running its activity bar for an agent that had stopped hours earlier.
 *
 * ⚠ THE THRESHOLD IS SHORT BECAUSE THE SIGN OF LIFE IS NOT ONLY THE HOOK BUS.
 * `agentEvents.noteOutput` also refreshes it from the session's PTY, and the
 * two together are what make 45 s safe. Measured 2026-08-23 against the
 * installed claude 2.1.241 (`_verify/rail-activity/`):
 *   · IDLE at its prompt, the TUI wrote ONCE in 90 seconds — the tail of its
 *     startup paint at t=11 s — and then nothing for 79 s. A second run saw
 *     92 s of silence after the answer finished. An idle agent is SILENT, so
 *     silence is a usable signal at all.
 *   · WORKING, it repaints its spinner and streams its answer: 199 writes over
 *     one turn, median gap 24 ms, p95 199 ms, and a WORST GAP OF 435 ms.
 * 45 s is ~100× that worst working gap, so a working agent has to fall silent
 * on BOTH channels for a hundred times longer than it has ever been observed
 * to pause before this can fire.
 *
 * ⚠ AND THE FAILURE DIRECTION IS THE SAFE ONE. If this ever fires on an agent
 * that IS working, the bar goes dark and the NEXT hook event or byte of output
 * turns it back on — the signal under-reports for a few seconds. The state it
 * expires into is "unknown", never `needs-you`: expiring into amber would
 * manufacture an interruption for an agent nobody needs to look at, which is
 * the one thing `agentEventsCore`'s header forbids.
 */
export const WORKING_STALE_MS = 45_000

/**
 * Has a `working` claim outlived its evidence?
 *
 * Pure, and taking `now` as an argument rather than reading the clock, so the
 * sweep that calls it is testable without fake timers — the same rule
 * `turnsCore.actionForTransition` states for the same reason.
 *
 * ⚠ ONLY `working` CAN GO STALE. `needs-you` is a session waiting for a human
 * and it is SUPPOSED to sit there unchanged for hours — ageing it out would
 * delete the one state the Inbox exists to show, and the escalation ladder
 * already reads its age directly.
 */
export function isWorkingStale(
  record: { activity: AgentActivity; lastSignAt: number },
  now: number
): boolean {
  if (record.activity !== 'working') return false
  return now - record.lastSignAt >= WORKING_STALE_MS
}

/**
 * WHY this session needs a human, or `null` for every event that does not put
 * it there. Deliberately a SECOND function over the SAME map rather than a
 * widened return from `classifyHookEvent`: the existing signature has callers
 * and a test suite pinned to it, and the value of this change does not justify
 * moving them.
 *
 * Every `WORKING_EVENTS` name returns `null` here, so a working session gets
 * `reason: null` BY CONSTRUCTION rather than by a branch at the call site.
 */
export function needsYouReasonFor(eventName: string): NeedsYouReason | null {
  if (!Object.prototype.hasOwnProperty.call(NEEDS_YOU_EVENTS, eventName)) return null
  return NEEDS_YOU_EVENTS[eventName]
}

/**
 * Every event name this module can classify — and therefore exactly the set an
 * adapter should subscribe to in its hook config.
 *
 * ⚠ ONE HOME, for the reason the effort descriptors have one: a subscription
 * list written separately in the adapter would drift from the classification
 * map above, and the failure is SILENT IN BOTH DIRECTIONS — subscribing to an
 * unclassified event costs a wasted process spawn per occurrence, and
 * classifying an unsubscribed one means a light that never lights.
 */
export function classifiedHookEventNames(): readonly string[] {
  return [...WORKING_EVENTS, ...Object.keys(NEEDS_YOU_EVENTS)]
}

/**
 * The listener's URL contract: `POST /hook/<token>`, and nothing else exists.
 * Returns the token, or `null` for any shape that is not exactly that — a
 * miss is never a partial match, so a probe cannot walk the surface.
 *
 * Kept here (pure) rather than inline in the server so the rejection cases are
 * unit-testable without binding a port.
 */
export function parseHookPath(url: string | undefined): string | null {
  if (!url) return null
  // Query strings and fragments are not part of the contract; a URL carrying
  // one is rejected outright rather than trimmed, so there is exactly one
  // accepted spelling of a valid request.
  if (url.includes('?') || url.includes('#')) return null
  const prefix = '/hook/'
  if (!url.startsWith(prefix)) return null
  const token = url.slice(prefix.length)
  // Token shape is fixed by the minting side (32 bytes -> 64 lowercase hex).
  // Checking it HERE means a malformed token never reaches the token map at
  // all, so the map's own timing profile cannot be probed with junk.
  if (!/^[0-9a-f]{64}$/.test(token)) return null
  return token
}

/**
 * The event name. Returns `null` when the body is not an object or carries no
 * usable one — a hook payload is UNTRUSTED INPUT (the bootInfo.ts precedent,
 * D83), so nothing here assumes a shape it has not checked.
 *
 * ⚠ THIS USED TO SAY "ONLY `hook_event_name` IS READ", AND THAT IS NO LONGER
 * TRUE — see `readTranscriptPath` directly below, added for the context ring.
 * The claim is corrected rather than quietly left standing, because the
 * listener's header cited it as a security property.
 *
 * ⚠ AND IT NOW READS A THIRD, `tool_name` — see `readToolName` below, added for
 * the memory-usage counters (D168, amended by D173). The NAME only: it is
 * compared against fixed sets and dropped in the same expression, and no name
 * is stored, logged, broadcast or persisted anywhere in this application. The
 * honest statement is the broad one — EVERY completed tool call's name is
 * classified and discarded, not only memory ones (D173 Q1).
 *
 * Everything else in the payload is still deliberately NOT extracted:
 * `tool_input` (the arguments — the agent's own Cypher, a file path, a shell
 * command), `tool_response` (what the tool returned), `prompt`,
 * `last_assistant_message`, `tool_use_id`. That is the user's source code and
 * conversation content; it would have to be scrubbed and stored to be useful,
 * and nothing here needs it. What is not taken cannot leak.
 */
export function readHookEventName(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  const name = (body as Record<string, unknown>).hook_event_name
  if (typeof name !== 'string' || name.length === 0 || name.length > 64) return null
  return name
}

/**
 * The transcript path, for the context ring (v16).
 *
 * Claude Code puts `transcript_path` on every hook body — the absolute path of
 * the session's JSONL, whose newest assistant line carries the exact token
 * counters the ring divides by the model's window. It WAS the only new field
 * this module read until Task 6b-1 added `tool_name` (`readToolName`, below);
 * `contextUsage.ts` documents in full what is done with the file (three
 * integers taken; no content retained, logged or sent).
 *
 * ⚠ A LENGTH CAP RATHER THAN A PATH VALIDATION, AND THE REASON IS THAT
 * VALIDATION HERE WOULD BE THEATRE. This is a Windows-only app (CLAUDE.md) whose
 * transcripts live under the user's profile, but a hook body is authenticated by
 * a per-session capability token that only a same-user process can hold — and
 * such a process can read any of those files directly, without going through
 * Chorus. So a prefix check would exclude nothing an attacker could not already
 * reach, while breaking legitimate setups (a redirected home, a UNC profile
 * path, a future WSL runtime). The real bounds are the token, the size-capped
 * read, and the fact that no byte of the file reaches an output.
 *
 * 4096 is the practical ceiling on a Windows path with long paths enabled; the
 * cap exists so a hostile body cannot hand `fs.open` a megabyte-long string.
 */
export function readTranscriptPath(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  const p = (body as Record<string, unknown>).transcript_path
  if (typeof p !== 'string' || p.length === 0 || p.length > 4096) return null
  return p
}

/**
 * The tool's NAME off a `PostToolUse` body, and nothing else from the tool call
 * (D168, amended by D173).
 *
 * ⚠ WHAT THIS DOES NOT READ IS THE POINT. `tool_input` is the Cypher the agent
 * wrote and `tool_response` is graph content; both are user/agent content and
 * neither is touched here or anywhere else. `tool_use_id` is not read either —
 * it would let a name be correlated across events, which is a capability this
 * feature has no use for.
 *
 * ⚠ A LENGTH CAP AND NO CHARSET CHECK, for the reason `readTranscriptPath`
 * gives directly above: validation beyond the cap would be theatre. The value's
 * only fate is a comparison against the fixed sets and then the garbage
 * collector — a name that matches nothing does nothing. 128 is far above every
 * observed name (the longest measured is 36 characters) and far below anything
 * that could pressure main's heap.
 *
 * ⚠ THE VALUE THIS RETURNS MAY REACH `classifyMemoryTool`, `isExplorationTool`,
 * `isShellTool` and `isKnownTool`, AND NOTHING ELSE — no field, no array, no
 * template literal, no logger call. A reviewer can prove that by grepping every
 * call site of `readToolName`.
 */
export function readToolName(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  // ⚠ OWN PROPERTY ONLY — the `classifyHookEvent` / `hasOwnProperty` rule. A
  // plain property read would walk the prototype chain, so a body whose
  // `tool_name` lives on `Object.prototype` (or any prototype a hostile sender
  // could shape) would be read as a real name.
  if (!Object.prototype.hasOwnProperty.call(body, 'tool_name')) return null
  const name = (body as Record<string, unknown>).tool_name
  if (typeof name !== 'string' || name.length === 0 || name.length > 128) return null
  return name
}

/**
 * A `chorus-memory` tool call, classified — or `null` for every other tool on
 * earth, including an unrecognised tool under the same server prefix.
 *
 * ⚠ AN UNKNOWN CHORUS-MEMORY TOOL RETURNS `null` RATHER THAN A THIRD CATEGORY,
 * and that is `classifyHookEvent`'s honesty bar applied one module over: a name
 * this function does not RECOGNISE moves no counter, rather than being guessed
 * into one. The bound is stated rather than hidden — if the server ever gains a
 * second read tool, reads will UNDER-count until this list is widened. That is
 * the safe direction: a milestone that reads "the agent queried the graph"
 * must not be satisfiable by a tool nobody has read the name of.
 *
 * Case-sensitive by design, exactly as `classifyHookEvent` is.
 */
export function classifyMemoryTool(name: string): 'read' | 'write' | null {
  if (!name.startsWith(CHORUS_MEMORY_TOOL_PREFIX)) return null
  const tool = name.slice(CHORUS_MEMORY_TOOL_PREFIX.length)
  if (MEMORY_READ_TOOLS.includes(tool)) return 'read'
  if (MEMORY_WRITE_TOOLS.includes(tool)) return 'write'
  return null
}

/** Membership in the PASS/FAIL exploration set above. Case-sensitive by
 *  design, exactly as `classifyHookEvent` is (`agentEventsCore.test.ts` pins
 *  `'stop'`). `Bash` is NOT in this set — see `EXPLORATION_TOOLS`. */
export function isExplorationTool(name: string): boolean {
  return EXPLORATION_TOOLS.includes(name)
}

/** D173: the shell-before-first-read DIAGNOSTIC's input, and nothing else.
 *  Never called from the pass/fail derivation. */
export function isShellTool(name: string): boolean {
  return SHELL_TOOLS.includes(name)
}

/**
 * D173: does this build recognise the name at all? `false` is what makes a
 * session INCONCLUSIVE when it arrives before the first memory read.
 *
 * ⚠ THE MEMORY PREFIX COUNTS AS KNOWN EVEN WHEN `classifyMemoryTool` RETURNS
 * `null`. A future `chorus-memory` tool is not counted as a read (that is
 * `classifyMemoryTool`'s honesty bar, unchanged) but it is not tool-set DRIFT
 * either — Chorus ships the server, so it is not an unknown VENDOR tool and it
 * must not make every session inconclusive.
 */
export function isKnownTool(name: string): boolean {
  return (
    name.startsWith(CHORUS_MEMORY_TOOL_PREFIX) ||
    EXPLORATION_TOOLS.includes(name) ||
    SHELL_TOOLS.includes(name) ||
    KNOWN_NON_EXPLORATION_TOOLS.includes(name)
  )
}
