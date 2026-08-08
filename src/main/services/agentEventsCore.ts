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

/**
 * What the agent itself says it is doing. Deliberately NOT a session status:
 * `sessions.status` stays `running | exited` and remains the DB's business.
 * This is a SECOND, orthogonal fact that only exists while a session is live.
 */
export type AgentActivity = 'working' | 'needs-you'

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
 */
const NEEDS_YOU_EVENTS: readonly string[] = [
  'Stop',
  'StopFailure',
  'Notification',
  'PermissionRequest',
  'Elicitation',
  'TeammateIdle'
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
  if (NEEDS_YOU_EVENTS.includes(eventName)) return 'needs-you'
  return null
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
  return [...WORKING_EVENTS, ...NEEDS_YOU_EVENTS]
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
 * The one fact the listener needs out of a hook body. Returns `null` when the
 * body is not an object or carries no usable event name — a hook payload is
 * UNTRUSTED INPUT (the bootInfo.ts precedent, D83), so nothing here assumes a
 * shape it has not checked.
 *
 * Only `hook_event_name` is read. The rest of the payload — `transcript_path`,
 * `prompt`, `last_assistant_message`, tool inputs — is deliberately NOT
 * extracted: it is the user's source code and conversation content, it would
 * have to be scrubbed and stored to be useful, and the lights need none of it.
 * What is not taken cannot leak.
 */
export function readHookEventName(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  const name = (body as Record<string, unknown>).hook_event_name
  if (typeof name !== 'string' || name.length === 0 || name.length > 64) return null
  return name
}
