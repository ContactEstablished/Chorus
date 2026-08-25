import http from 'node:http'
import crypto from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { logger } from './logger'
import {
  classifyHookEvent,
  classifyMemoryTool,
  isExplorationTool,
  isKnownTool,
  isShellTool,
  isWorkingStale,
  needsYouReasonFor,
  parseHookPath,
  readHookEventName,
  readToolName,
  readTranscriptPath,
  type ActivitySource,
  type AgentActivity,
  type NeedsYouReason
} from './agentEventsCore'
// Type-only, exactly as `contextUsage.ts` imports `SessionContextUsage`: the
// broadcast shape is declared once, in `shared/ipc.ts`, so this tracker cannot
// drift from the schema that validates it in `main/ipc.ts`. Adds nothing at
// runtime.
import type { SessionMemoryUsage } from '../../shared/ipc'

/**
 * The localhost hook listener — Phase 4's spine, built here for its FIRST
 * consumer: the filmstrip's activity lights.
 *
 * An agent CLI that supports hooks is configured (per session, at launch) to
 * POST its lifecycle events here. That gives Chorus the one fact it could
 * never derive before: whether a live agent is WORKING or has STOPPED AND
 * NEEDS A HUMAN. See `agentEventsCore.ts` for why that retires D78's premise.
 *
 * ─── SCOPE, STATED SO IT IS NOT MISTAKEN FOR ALL OF PHASE 4 ───────────────
 * This is the listener and the activity derivation, and nothing else. Phase 4
 * also owns notification policies, toast -> focus-pane, the tray badge, the
 * notification center, the Attention Inbox and the per-session event timeline;
 * NONE of them are built here. In particular there is deliberately NO
 * `agent_events` TABLE: events are held in memory only, because the lights
 * need the CURRENT state and nothing yet reads history. The append-only bus
 * stays Phase 4's to add when a consumer exists — an unused table with a
 * migration behind it is a schema commitment made for nobody.
 *
 * ─── SECURITY: THE [CR] QUESTION THE ROADMAP PARKED ───────────────────────
 * The roadmap's open question is *"how do we secure the localhost hook
 * listener against local processes spoofing agent events?"*. The answer
 * implemented here, and its honest limit:
 *
 *  1. **Bound to 127.0.0.1, on an OS-assigned ephemeral port.** Nothing off
 *     this machine can reach it, and the port is not guessable from a
 *     well-known constant.
 *  2. **A per-session capability token** — 32 crypto-random bytes, minted at
 *     launch, mapped to exactly one sessionId, revoked on exit. An event is
 *     attributed by TOKEN, never by anything in the payload, so a body that
 *     claims someone else's `session_id` cannot cross sessions. This is also
 *     what makes attribution correct at all: Claude's own `session_id` is not
 *     Chorus's, and two sessions in one cwd would be indistinguishable.
 *  3. **The surface is one route.** POST `/hook/<64 hex>` and nothing else;
 *     every other method, path and token shape gets an identical 404 with an
 *     empty body, so the listener never confirms what exists.
 *  4. **Bounded input.** The body is capped and the connection destroyed past
 *     the cap, so a local process cannot grow main's heap through this port.
 *  5. **Three fields are read** off the body, and only three: `hook_event_name`
 *     (the lights), `transcript_path` (the context ring, v16) and `tool_name`
 *     (the memory-usage counters, v21 / D168, amended by D173). No prompt text,
 *     no `last_assistant_message`, no `tool_input` and no `tool_response` is
 *     extracted, stored or logged.
 *
 *     ⚠ POINT 5 HAS NOW BEEN NARROWED TWICE. It first read "**Only
 *     `hook_event_name` is read** … no transcript path"; v16 made that false and
 *     corrected it; D168 makes the two-field version false and corrects it
 *     here. The history is KEPT rather than tidied, because the recurrence is
 *     the finding: this surface widens roughly once a phase, and each widening
 *     was believed at the time to be the last. A stale security claim is worse
 *     than none — the next person to widen this surface would otherwise be
 *     measuring against a guarantee the code had already stopped honouring.
 *     `contextUsage.ts` carries the full argument for why reading the path is
 *     acceptable and what bounds it; the short version is that the token
 *     already implies same-user access, the read is size-capped, and no byte of
 *     the file reaches any output.
 *
 *     ⚠ WHAT `tool_name` COSTS, STATED PLAINLY. **What is taken:** the tool's
 *     NAME, `typeof === 'string'`, capped at 128 characters, off `PostToolUse`
 *     bodies only. **What is done with it: EVERY COMPLETED TOOL-CALL NAME IS
 *     CLASSIFIED AND DISCARDED** — compared against fixed sets (the
 *     `chorus-memory` server's three tools; claude's exploration tools; the
 *     shell; the names this build knows are not exploration) and DROPPED in the
 *     same expression. **That sentence is deliberately the broad one: EVERY tool
 *     call's name passes through the comparison, not only memory ones** (D173
 *     Q1 — the narrower wording was ruled misleading). **What is never taken:**
 *     `tool_input` (the agent's Cypher, a path, a shell command),
 *     `tool_response`, `prompt`, `last_assistant_message`, `tool_use_id` —
 *     **including on the error and exception paths, where a diagnostic dump of
 *     a raw body would undo everything above it.** The `catch` around a
 *     throwing listener, the malformed-body rejection and the over-cap
 *     rejection all run with the receipt in scope, and none of them logs it.
 *     **Where the result is stored:** two counters and four ordinals per
 *     session, in memory beside `activity` and cleared by the same `revoke`;
 *     and five integer columns on the session's row (`memory_reads`,
 *     `memory_writes`, `memory_read_first`, `memory_read_inconclusive`,
 *     `memory_shell_first`). **What can leak:** nothing new. A tool's name is
 *     not user content, no file is opened (the `transcript_path` widening does
 *     open one and was accepted), and the body is still authenticated by the
 *     per-session capability token — so a hostile local process can at most
 *     inflate ITS OWN session's counters, which is a subset of the named limit
 *     below. That bound is an INTEGRITY bound, not a confidentiality one, and
 *     these counters are not adversarially tamper-proof (D173 Q1). **Why it is
 *     acceptable:** the alternative is reading the user's JSONL transcript to
 *     answer "did this agent use the graph", which is strictly more content for
 *     strictly less certainty.
 *
 *     ⚠ WHAT `PostToolUse` MEANS, MEASURED. A tool call that FAILED fires
 *     `PostToolUseFailure` instead (measured 2026-08-19 on claude 2.1.235 by
 *     the kickoff and again by Task 6b-1: a broken Cypher produced
 *     `PostToolUseFailure` carrying an `error` key, the well-formed call
 *     produced `PostToolUse` — `_verify/6b-4/hookprobe/`, `_verify/6b-1/hookprobe/`).
 *     So these counters are SUCCESSFUL-tool-result counts, and they are
 *     labelled that way everywhere they surface. The residual limit is stated
 *     with them: a successful WRITE call is not yet a SOURCED memory — the
 *     validator is the write-side truth.
 *
 * ⚠ NAMED LIMIT, NOT A CLAIM OF PROOF: this defends against a local process
 * that does not already have the user's file access — a blind port-scanner
 * spraying JSON at localhost. It does NOT defend against a process running as
 * the same user, which can read the token out of the per-session settings file
 * (or the DB, or main's heap) and is therefore already inside the trust
 * boundary the vault assumes. Same-user code execution is an excluded threat
 * class here exactly as it is for `safeStorage`, and it is recorded rather
 * than papered over.
 */

/**
 * What main remembers about one session: the state, and the instant it began.
 *
 * ⚠ `since` IS STAMPED ONLY WHEN THE VALUE ACTUALLY CHANGES — see `record`.
 * Re-stamping on every hook event would make a waiting agent permanently one
 * second old and the escalation ladder above it could never climb.
 */
export interface AgentActivityRecord {
  activity: AgentActivity
  /** WHY, when `activity` is 'needs-you'. ALWAYS null while 'working' — it is
   *  derived from the event name at classification time, so there is no path
   *  that can set a reason on a working session. */
  reason: NeedsYouReason | null
  /** `Date.now()` at the transition into `activity`.
   *  ⚠ NOT re-stamped when only `reason` changes — see `record`. */
  since: number
  /**
   * The last moment this session showed ANY sign of life: a classified hook
   * event, or — while it is working — a byte of its own PTY output.
   *
   * ⚠ THIS IS THE EXACT OPPOSITE OF `since`, AND THE TWO MUST NOT BE MERGED.
   * `since` answers "how long has this been true" and is deliberately frozen
   * across repeat reports so an escalation ladder can climb it. This answers
   * "when did we last have evidence at all" and is re-stamped by EVERY report,
   * including the no-op ones the edge filter drops. One field cannot do both:
   * re-stamping `since` was the failure that filter exists to prevent, and
   * freezing this one would make a 3-hour turn look as stale as a dead one.
   */
  lastSignAt: number
  /**
   * WHICH CHANNEL PUT THIS CLAIM HERE — and the only thing that reads it is the
   * stale sweep, which owes the two channels different patience
   * (`staleAfterFor`).
   *
   * ⚠ IT IS NOT A CONFIDENCE SCORE AND NOTHING ELSE MAY BRANCH ON IT. A rail
   * bar, a filmstrip light and a turn row must mean the same thing whichever
   * channel reported it; the moment a surface renders `output` differently from
   * `hook`, this module has started publishing its own uncertainty instead of
   * an activity, and `AgentActivity` stops being one enum.
   */
  source: ActivitySource
}

/**
 * What main remembers about one session's use of the memory graph (D168,
 * amended by D173).
 *
 * ⚠ ORDINALS, NOT TIMESTAMPS. "Did a graph read happen before filesystem
 * exploration" is a question about ORDER, and a clock answers it worse: two
 * tool calls in the same millisecond are common over a hook bus, and `Date.now`
 * is already stubbed in this module's tests for exactly that reason. `ordinal`
 * counts `PostToolUse` RECEIPTS — every one, whatever the tool — so the four
 * "first" fields are directly comparable.
 *
 * ⚠ NO TOOL NAME IS IN THIS TYPE, AND THAT IS THE INVARIANT A REVIEWER SHOULD
 * TEST HARDEST. There is NO `string` field here at all, so the limit cannot be
 * crossed by this record even by accident. Note in particular that the
 * INCONCLUSIVE flag records only THAT an unknown tool ran, never WHICH — the
 * ordinal is the whole permitted output of that branch.
 *
 * ⚠ FOUR ORDINALS, NOT TWO (D173). `firstUnknownOrdinal` decides INCONCLUSIVE
 * and `firstShellOrdinal` feeds the shell diagnostic; all four are SET-ONCE, so
 * every flag derived from them is monotone and cannot oscillate as more
 * receipts arrive (D173 Q2's set-once requirement, enforced here at the source
 * and again by `MAX()` on the row).
 */
interface MemoryUsageRecord {
  reads: number
  writes: number
  /** `null` until the first one happens. Set-once, all four. */
  firstReadOrdinal: number | null
  /** The first tool in the PASS/FAIL exploration set — `Bash` is NOT one. */
  firstExploreOrdinal: number | null
  /** D173: the first completed tool this build does not recognise at all. */
  firstUnknownOrdinal: number | null
  /** D173: the first shell call. DIAGNOSTIC ONLY — never read by the pass rule. */
  firstShellOrdinal: number | null
  /** How many `PostToolUse` receipts this session has produced. */
  ordinal: number
}

/**
 * ⚠ `reason` GOES LAST, AND THAT IS A COMPATIBILITY DECISION RATHER THAN A
 * STYLE ONE. `turns.ts:81` takes `(sessionId, activity, since)` and must keep
 * compiling and behaving identically; a trailing parameter it ignores is free,
 * while inserting `reason` before `since` would hand it a `NeedsYouReason`
 * where it expects a millisecond stamp — a runtime corruption with NO compile
 * error, because that callback is written inline and would simply re-type.
 * Append; never insert.
 *
 * ⚠ `activity` IS NULLABLE, AND NULL IS A REAL TRANSITION RATHER THAN A GAP IN
 * THE TYPE. It means "this session HAD a state and no longer does" — today the
 * only producer is `sweepStale`, which retires a `working` claim that has
 * outlived its evidence (`agentEventsCore.WORKING_STALE_MS`). It is null and
 * not a third enum member on purpose: every consumer that asks
 * `activity === 'working'` or `=== 'needs-you'` stays correct as written,
 * where a new member would silently fall through their branches.
 */
export type AgentActivityListener = (
  sessionId: string,
  activity: AgentActivity | null,
  since: number,
  reason: NeedsYouReason | null,
  /**
   * WHICH CHANNEL REPORTED THIS — passed rather than looked up, because the
   * retirement announce fires AFTER the record is deleted and a listener that
   * asked `recordFor` would get `null` for exactly the transition it most needs
   * to attribute.
   *
   * ⚠ ONLY A RECORDER MAY READ IT. `turns.ts` stamps it on the row so a codex
   * turn is not filed as a hook observation (`agent_turns.source` exists for
   * precisely this — "the only producer today, present so a future one cannot be
   * mistaken for this one"). No RENDERING surface may branch on it: a rail bar
   * that drew an output-driven claim differently would be publishing Chorus's
   * confidence rather than the agent's activity.
   */
  source: ActivitySource
) => void

/**
 * v16: called with the transcript path off any hook body that carries one.
 *
 * ⚠ A CALLBACK RATHER THAN A DIRECT DEPENDENCY ON THE CONTEXT TRACKER, so this
 * module keeps knowing nothing about context, windows or token counters — its
 * job stays "authenticate a hook and read two fields". It is also what lets the
 * listener be constructed in tests with no tracker at all.
 *
 * ⚠ IT MUST NOT THROW AND MUST NOT BLOCK: it is invoked from inside the hook
 * request handler, which Claude Code waits on.
 */
export type TranscriptPathListener = (sessionId: string, transcriptPath: string) => void

/**
 * D168: called with this session's memory-usage snapshot whenever the snapshot
 * CHANGES.
 *
 * ⚠ THE DISTINCTION THAT MATTERS, AND THE ONE THIS PHASE WILL BE JUDGED ON:
 * the COUNTERS are incremented on EVERY `PostToolUse` receipt, unconditionally,
 * before `record()` and its edge filter can collapse anything — that is D168's
 * requirement and F55/F56 are why. What is edge-gated is only the
 * NOTIFICATION: a receipt that leaves all FIVE broadcast facts — `reads`,
 * `writes`, `readBeforeExplore`, `readInconclusive`, `shellFirst` — unchanged
 * (i.e. almost every tool call an agent makes) fires nothing, because
 * forwarding it would put an IPC message and a SQLite write behind every tool
 * call — the failure the activity stream's edge filter exists to prevent, in a
 * place where it would be much more expensive.
 *
 * ⚠ SAME CONTRACT AS `TranscriptPathListener`: it must not throw and must not
 * block. It is invoked from inside the hook request handler, which Claude Code
 * waits on.
 */
export type MemoryUsageListener = (sessionId: string, usage: SessionMemoryUsage) => void

/** A hook body past this is refused outright. Real payloads observed at
 *  launch are ~300–2000 bytes; `Stop` carries `last_assistant_message` and is
 *  the largest. 256 KB is far above any of them and far below anything that
 *  could pressure main's heap. */
const MAX_BODY_BYTES = 256 * 1024

/** A hook command that cannot deliver in this long has already lost its race
 *  with the next event; the socket is closed rather than held. */
const REQUEST_TIMEOUT_MS = 5_000

export interface AgentEventListener {
  /** Bind the server. Idempotent; resolves with the bound port. */
  start(): Promise<number>
  /**
   * Mint this session's capability token and return the URL its hook command
   * must POST to. Re-registering a session ROTATES the token (a restart gets a
   * fresh one and the old one stops working immediately).
   * Throws if called before `start()` — the URL needs the bound port.
   */
  register(sessionId: string): string
  /**
   * Declare that this session will NEVER have a hook bus — its adapter
   * implements none — so its PTY output is the only account of it anyone will
   * ever get, and `noteOutput` may therefore CREATE a `working` claim for it.
   *
   * ⚠ EXPLICIT, RATHER THAN "ABSENT FROM THE TOKEN MAP". The inverse test was
   * available and is wrong: a claude session whose `register` threw (the
   * listener never bound, port refused at boot) is also absent from that map,
   * and it would silently switch a hook-capable agent onto the weaker channel
   * at exactly the moment its lights were already degraded. Two different
   * facts — "has no hooks" and "should have had hooks and didn't get them" —
   * must not share one representation.
   *
   * Idempotent, and cleared by `revoke`.
   */
  registerOutputDriven(sessionId: string): void
  /** Revoke the token and forget the activity. Safe to call for an unknown id. */
  revoke(sessionId: string): void
  /**
   * A byte of this session's PTY output arrived — a SIGN OF LIFE, and nothing
   * more.
   *
   * ⚠ FOR A SESSION WITH A HOOK BUS IT CAN ONLY EXTEND A `working` CLAIM, NEVER
   * CREATE ONE, and that asymmetry is the original design. Terminal output is
   * not evidence that an AGENT is working: the user typing echoes and a resize
   * repaints. What output IS good for is the converse — claude 2.1.241 measured
   * SILENT at an idle prompt (79 s without a byte) and continuously repainting
   * while working — so it is a sound second channel for "the thing the hook bus
   * already told us is working has not gone quiet".
   *
   * ⚠ FOR A SESSION REGISTERED VIA `registerOutputDriven` IT MAY ALSO CREATE
   * ONE, and the asymmetry above is exactly why that took a separate gesture to
   * unlock. The rule the original comment stated — "Chorus does not guess at
   * agents it cannot see think" — was written when the alternative to guessing
   * was a hook bus. For codex there is no hook bus, so the real alternative is
   * A LIGHT THAT NEVER LIGHTS, and a signal that is right while a turn runs and
   * lingers ~10 s past its end beats a signal that is permanently dark. The
   * measurement that makes it more than a guess is in `OUTPUT_STALE_MS`: codex
   * 0.149.1 wrote 0 bytes in 80 s at an idle prompt and 702 times in one
   * working turn, worst gap 150 ms.
   *
   * ⚠ AND THE HONEST BOUND, STATED ONCE: on this channel the claim is "THIS
   * PANE IS PRODUCING OUTPUT", which is not quite "an agent is thinking".
   * Typing into a codex pane repaints it and will light the bar for the ~10 s
   * that follow. That is over-reporting in the `working` direction only — it
   * can never produce `needs-you`, the one state allowed to interrupt.
   *
   * Called from the hottest path in the app (every PTY chunk), so the common
   * case stays one map lookup and one field write; the create branch is reached
   * once per turn, on the first byte after silence.
   */
  noteOutput(sessionId: string): void
  /**
   * Retire every `working` claim that has shown no sign of life for
   * `WORKING_STALE_MS`, firing `onActivity` with a NULL activity for each.
   * Returns how many were retired, so the caller can skip work when nothing
   * moved.
   *
   * ⚠ `now` IS PASSED IN, not read here, so the sweep is testable without fake
   * timers and so one sweep judges every session against ONE instant.
   */
  sweepStale(now: number): number
  /** Current activity, or null when this session has never reported one. */
  activityFor(sessionId: string): AgentActivity | null
  /** Current activity AND when it began, or null if never reported. The
   *  project roll-up reads this rather than `activityFor` — it needs the age. */
  recordFor(sessionId: string): AgentActivityRecord | null
  /** Every session with a known activity — the renderer's cold-start read. */
  snapshot(): ReadonlyArray<{
    sessionId: string
    activity: AgentActivity
    since: number
    reason: NeedsYouReason | null
  }>
  /** Edge-triggered: fires only when a session's activity OR its reason
   *  actually CHANGES — never on every hook event. */
  onActivity(listener: AgentActivityListener): () => void
  /** v16: every hook body carrying a transcript path, NOT edge-triggered — the
   *  path is the same every time and the consumer throttles its own reads. */
  onTranscriptPath(listener: TranscriptPathListener): () => void
  /** D168: this session's memory-graph usage, or null when it has reported no
   *  completed tool call. ABSENT IS NOT ZERO — the same rule the context ring
   *  states in `stores/session.ts`. */
  memoryUsageFor(sessionId: string): SessionMemoryUsage | null
  /** D168: fired when a session's memory usage CHANGES. Not edge-gated on the
   *  activity map — see `MemoryUsageListener`. */
  onMemoryUsage(listener: MemoryUsageListener): () => void
  dispose(): Promise<void>
}

export function createAgentEventListener(): AgentEventListener {
  /** token -> sessionId. The ONLY attribution path (security note 2). */
  const tokens = new Map<string, string>()
  /** sessionId -> token, so a re-register can revoke the previous one. */
  const bySession = new Map<string, string>()
  const activity = new Map<string, AgentActivityRecord>()
  /**
   * Sessions whose adapter declares no hook bus, so PTY output is allowed to
   * CREATE their `working` claim (see `registerOutputDriven`). Deliberately
   * DISJOINT from `bySession` in practice — `sessionManager.spawn` takes one
   * branch or the other — but nothing here depends on that, because a session
   * that somehow held both would simply have its hook events win: `record`
   * writes `source: 'hook'` and `noteOutput`'s create branch only fires when
   * there is no record at all.
   */
  const outputDriven = new Set<string>()
  const listeners = new Set<AgentActivityListener>()
  const transcriptListeners = new Set<TranscriptPathListener>()
  /** D168: sessionId -> its memory-usage record. Cleared where `activity` is. */
  const memoryUsage = new Map<string, MemoryUsageRecord>()
  const memoryListeners = new Set<MemoryUsageListener>()

  let server: http.Server | null = null
  let port: number | null = null
  let starting: Promise<number> | null = null

  /**
   * Fan one transition out to the listeners. Extracted from `record` so the
   * stale sweep announces itself through the SAME path rather than growing a
   * second, subtly different one — a listener that threw on a null activity
   * must not be able to take down the sweep either.
   */
  function announce(
    sessionId: string,
    next: AgentActivity | null,
    since: number,
    reason: NeedsYouReason | null,
    source: ActivitySource
  ): void {
    for (const listener of listeners) {
      try {
        listener(sessionId, next, since, reason, source)
      } catch (err) {
        // One bad listener must not stop the others, and must never take down
        // the HTTP request that is mid-flight.
        logger.error({ err }, '[agent-events] activity listener threw')
      }
    }
  }

  function record(sessionId: string, next: AgentActivity, reason: NeedsYouReason | null): void {
    const prev = activity.get(sessionId)
    // ⚠ STAMPED BEFORE THE EDGE FILTER BELOW, WHICH IS THE ONLY PLACE IT CAN
    // GO. The no-op reports the filter drops — twenty PreToolUse/PostToolUse
    // pairs in one turn — are precisely the evidence that this session is
    // still alive; taking the stamp after the early return would leave
    // `lastSignAt` frozen at the first event of a turn and expire a busy agent
    // 45 seconds into a job it is very much still doing.
    if (prev) prev.lastSignAt = Date.now()
    // Edge-triggered, exactly like the renderer's attention reporter: a
    // working agent fires PreToolUse/PostToolUse pairs continuously, and
    // broadcasting each one would put a stream of no-op IPC messages behind
    // every tool call.
    //
    // ⚠ THE EARLY RETURN IS ALSO WHAT KEEPS `since` HONEST, which is a second
    // job it did not have before. A working agent re-reports `working` on every
    // tool pair; if those no-op reports re-stamped the clock, "how long has
    // this been true" would reset a few times a second and no surface above
    // could ever show an age or climb an escalation tier.
    //
    // ⚠ WIDENED TO BOTH FACTS BY D145, NOT REMOVED (F56 records that it is
    // load-bearing for three separate things). Keyed on activity alone, a
    // session that stopped and then raised a permission prompt would sit
    // labelled "stopped" while it is in fact BLOCKING ON A QUESTION.
    if (prev?.activity === next && prev.reason === reason) return

    // ⚠ `since` MOVES ONLY WHEN THE ACTIVITY DOES. A session that stopped and
    // then raised a permission prompt has been waiting since it STOPPED, and
    // re-stamping here would reset the escalation ladder every time the agent
    // re-classified itself — the exact failure the early return was widened to
    // fix, reintroduced one line lower down. The Inbox orders by this number.
    //
    // `activityChanged` is true whenever `prev` is undefined (`undefined` is
    // neither enum member), so the second branch is reachable only when `prev`
    // exists.
    const activityChanged = prev?.activity !== next
    const now = Date.now()
    const since = activityChanged ? now : (prev?.since ?? now)
    // ⚠ `source: 'hook'` UNCONDITIONALLY, AND `record` IS THE ONLY WRITER OF
    // THAT VALUE. This function is reached from exactly one place — a
    // classified hook event on an authenticated request — so a hook claim can
    // never be built anywhere else, and an output claim (`noteOutput`) can
    // never be built here. Two writers for one field is how a claim would end
    // up under the wrong expiry window.
    activity.set(sessionId, { activity: next, reason, since, lastSignAt: now, source: 'hook' })
    announce(sessionId, next, since, reason, 'hook')
  }

  /**
   * The wire projection of one record.
   *
   * ⚠ THE ORDINALS DO NOT CROSS THE BRIDGE: they are an internal mechanism, and
   * the three derived flags are the only things anyone outside this module
   * needs from them.
   *
   * ⚠ D173'S THREE-WAY ORDERING RESULT, WRITTEN OUT ONCE HERE SO IT CANNOT BE
   * RE-DERIVED DIFFERENTLY ANYWHERE ELSE:
   *   · PASS          — a COMPLETED memory read exists, AND it precedes the
   *                     first KNOWN exploration call (or none occurred), AND no
   *                     UNKNOWN tool preceded it;
   *   · INCONCLUSIVE  — a COMPLETED memory read exists, nothing in the known
   *                     exploration set preceded it, BUT an unknown tool did;
   *   · NOT PASSED    — everything else.
   * The two flags are mutually exclusive by construction (`unknownFirst` and
   * `!unknownFirst` cannot both hold), and the tests prove it.
   *
   * ⚠ ALL THREE FLAGS ARE MONOTONE, which is what makes the row's `MAX()` write
   * safe rather than merely convenient: each is built from set-once ordinals, so
   * once `true` no later receipt can make it `false`.
   */
  function toUsage(rec: MemoryUsageRecord): SessionMemoryUsage {
    // ⚠ TRUE ONLY IF A READ ACTUALLY HAPPENED. A session that explored nothing
    // AND read nothing must not read as "read first" — that would make the
    // milestone's first clause pass on a session that did nothing at all.
    //
    // ⚠ THIS CLAUSE IS ORIGINAL, NOT A D173 REPAIR. The council's "vacuous
    // pass" objection was against the BRIEF's one-line summary of this rule;
    // the rule itself already required `firstReadOrdinal !== null` and D173
    // cites it rather than changing it. Do not "fix" it a second time.
    const readExists = rec.firstReadOrdinal !== null
    const beforeKnownExplore =
      rec.firstExploreOrdinal === null ||
      (readExists && (rec.firstReadOrdinal as number) < rec.firstExploreOrdinal)
    const unknownFirst =
      rec.firstUnknownOrdinal !== null &&
      (!readExists || rec.firstUnknownOrdinal < (rec.firstReadOrdinal as number))
    return {
      reads: rec.reads,
      writes: rec.writes,
      readBeforeExplore: readExists && beforeKnownExplore && !unknownFirst,
      // D173: never a silent pass. An unknown tool that ran before the first
      // read means this build cannot say whether the agent explored first — so
      // it says so, rather than failing open in the agent's favour.
      readInconclusive: readExists && beforeKnownExplore && unknownFirst,
      // D173: the DIAGNOSTIC. Not a pass/fail input, and never combined with the
      // two flags above into a single verdict anywhere downstream. ⚠ It reads
      // `firstShellOrdinal` ONLY — `firstExploreOrdinal` is never consulted here
      // and `isShellTool` never writes it (see `noteToolUse`).
      shellFirst:
        rec.firstShellOrdinal !== null &&
        (!readExists || rec.firstShellOrdinal < (rec.firstReadOrdinal as number))
    }
  }

  /** The five BROADCAST facts, and only those — never the ordinals. */
  function sameUsage(a: SessionMemoryUsage, b: SessionMemoryUsage): boolean {
    return (
      a.reads === b.reads &&
      a.writes === b.writes &&
      a.readBeforeExplore === b.readBeforeExplore &&
      a.readInconclusive === b.readInconclusive &&
      a.shellFirst === b.shellFirst
    )
  }

  /**
   * One completed tool call, classified and counted (D168, amended by D173).
   *
   * ⚠ THE NAME DIES IN THIS FUNCTION. It arrives as a parameter, is passed to
   * the four pure classifiers, and is never assigned, stored, logged or
   * returned. There is no branch in here that can put it anywhere.
   *
   * ⚠ TWO DISTINCT THINGS HAPPEN HERE, AND CONFLATING THEM IS THE EXACT D168
   * FAILURE: (1) the COUNTERS AND ORDINALS ARE UPDATED UNCONDITIONALLY, on
   * every receipt; (2) the NOTIFICATION is suppressed when the five broadcast
   * facts did not change. The suppression compares only the broadcast
   * projection (`sameUsage`) and never gates the increments above it.
   */
  function noteToolUse(sessionId: string, toolName: string | null): void {
    const rec = memoryUsage.get(sessionId) ?? {
      reads: 0,
      writes: 0,
      firstReadOrdinal: null,
      firstExploreOrdinal: null,
      firstUnknownOrdinal: null,
      firstShellOrdinal: null,
      ordinal: 0
    }
    // The broadcast projection BEFORE this receipt — the edge is decided
    // against it below, after the counters have moved.
    const before = toUsage(rec)

    // ⚠ THE ORDINAL ADVANCES FOR EVERY RECEIPT, INCLUDING AN UNREADABLE NAME.
    // It is a position in the session's tool stream; skipping a position would
    // make "before" mean something slightly different from what it says.
    rec.ordinal += 1
    if (toolName) {
      const memory = classifyMemoryTool(toolName)
      if (memory === 'read') {
        rec.reads += 1
        if (rec.firstReadOrdinal === null) rec.firstReadOrdinal = rec.ordinal
      } else if (memory === 'write') {
        rec.writes += 1
      } else if (isExplorationTool(toolName)) {
        if (rec.firstExploreOrdinal === null) rec.firstExploreOrdinal = rec.ordinal
      } else if (isShellTool(toolName)) {
        // D173: DIAGNOSTIC ONLY. This branch must never touch
        // `firstExploreOrdinal` — that conflation is the thing the council
        // removed, and it would restore itself in one careless line.
        if (rec.firstShellOrdinal === null) rec.firstShellOrdinal = rec.ordinal
      } else if (!isKnownTool(toolName)) {
        // D173: a name this build has never heard of. NOT exploration (that
        // would be a guess against the agent) and NOT ignored (that would be a
        // guess in its favour, and a renamed `Read` would become a free pass).
        // It makes the ordering result INCONCLUSIVE instead. Only the ORDINAL
        // is recorded — never which tool it was.
        if (rec.firstUnknownOrdinal === null) rec.firstUnknownOrdinal = rec.ordinal
      }
      // A KNOWN non-exploration tool (`ToolSearch`, `WebFetch`, `Write`,
      // `Edit`, a todo tool, a future `chorus-memory` tool) falls through
      // deliberately: it moves nothing. `ToolSearch` reaching this line rather
      // than the exploration branch is F92's whole point.
    }
    memoryUsage.set(sessionId, rec)

    // The edge — on the BROADCAST payload, never on the counters above.
    const next = toUsage(rec)
    if (sameUsage(before, next)) return
    for (const listener of memoryListeners) {
      try {
        listener(sessionId, next)
      } catch (err) {
        // One bad listener must not stop the others and must never take down
        // the HTTP request that is mid-flight (the `record()` rule, verbatim).
        // ⚠ `{ err }` ONLY — no body, no name, no payload (D173 Q1).
        logger.error({ err }, '[agent-events] memory usage listener threw')
      }
    }
  }

  /** Every rejection looks identical from outside (security note 3). */
  function reject(res: http.ServerResponse): void {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end('{}')
  }

  function handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (req.method !== 'POST') {
      req.resume() // drain, or the socket hangs
      reject(res)
      return
    }
    const token = parseHookPath(req.url)
    const sessionId = token ? tokens.get(token) : undefined
    if (!sessionId) {
      req.resume()
      reject(res)
      return
    }

    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        // Destroy rather than respond: a sender past the cap is not a client
        // we owe a reply to (security note 4).
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      // ⚠ ALWAYS ANSWER, AND ANSWER FAST. A hook command that blocks is a hook
      // command that stalls the AGENT — Claude Code waits on it. Chorus must
      // never be the reason a session hangs, so the response is sent before
      // any derivation work and the body is parsed defensively after.
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{}')

      let body: unknown = null
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        return // untrusted input; a malformed body is simply not an event
      }
      // v16: the context ring, BEFORE the event-name gate below. An event this
      // module cannot classify still carries a perfectly good transcript path,
      // and `SessionStart` — deliberately unclassified, so it lights nothing —
      // is the first hook of a resumed session and therefore the earliest
      // chance to draw a ring at all. Gating the path on the activity map would
      // have made the ring's freshness an accident of which events happen to be
      // in `WORKING_EVENTS`.
      const transcriptPath = readTranscriptPath(body)
      if (transcriptPath) {
        for (const listener of transcriptListeners) {
          try {
            listener(sessionId, transcriptPath)
          } catch (err) {
            // ⚠ The path is NOT in this log line — it names a directory under
            // the user's home. Same rule as the token.
            logger.error({ err }, '[agent-events] transcript listener threw')
          }
        }
      }

      // D168: the memory-usage counters, taken off the RAW RECEIPT and
      // deliberately BEFORE `record()` below.
      //
      // ⚠ IF THIS BLOCK EVER MOVES BELOW `record()`, THE FEATURE BECOMES A LIE
      // THAT PASSES ITS OWN TESTS. `record()`'s early return at the top of this
      // file collapses twenty consecutive tool calls into ONE callback (F55,
      // F56); a count taken after it would report "1 read" for a session that
      // made twenty. `onTranscriptPath` above is the same shape for the same
      // reason. The event name is read ONCE here and reused by the
      // classification gate below, so this block is provably ahead of it.
      //
      // `PostToolUse` ONLY, compared with `===`. `PreToolUse` is an ATTEMPT —
      // one the user may deny — and an attempt is not a read. `PostToolUseFailure`
      // is a SEPARATE NAME that shares the prefix (agentEventsCore.ts
      // WORKING_EVENTS), so a `startsWith` here would count failures as reads.
      //
      // ⚠ AND THE SPLIT IS WHAT EARNS THE WORD "SUCCESSFUL" IN THE UI. Measured
      // 2026-08-19 on claude 2.1.235 (kickoff and Task 6b-1 alike): a broken
      // Cypher fired `PostToolUseFailure` (with an `error` key), the well-formed
      // call fired `PostToolUse` (`_verify/6b-4/hookprobe/`, `_verify/6b-1/hookprobe/`).
      // So this `===` is not only a naming precaution — it is the reason
      // `memoryUsageLine` may say "successful memory reads" at all. Widen it and
      // that label becomes false.
      //
      // ⚠ `readToolName`'s result goes to `noteToolUse` and nowhere else; it is
      // never logged, including on the paths below that return early.
      const eventName = readHookEventName(body)
      if (eventName === 'PostToolUse') {
        noteToolUse(sessionId, readToolName(body))
      }

      if (!eventName) return
      const next = classifyHookEvent(eventName)
      // null = an event that says nothing about who holds the ball. The
      // session's activity is LEFT ALONE rather than reset (agentEventsCore).
      if (!next) return
      // `needsYouReasonFor` returns null for every WORKING_EVENTS name, so
      // `working` carries no reason by construction rather than by a branch.
      record(sessionId, next, needsYouReasonFor(eventName))
    })
    req.on('error', () => {
      /* client vanished mid-body; nothing to clean up beyond the socket */
    })
  }

  return {
    start(): Promise<number> {
      if (starting) return starting
      starting = new Promise<number>((resolve, reject_) => {
        const srv = http.createServer(handle)
        srv.setTimeout(REQUEST_TIMEOUT_MS)
        srv.on('error', (err) => {
          logger.error({ err }, '[agent-events] listener failed to bind')
          reject_(err)
        })
        // Port 0 -> the OS picks a free ephemeral port (security note 1).
        srv.listen(0, '127.0.0.1', () => {
          server = srv
          port = (srv.address() as AddressInfo).port
          logger.info({ port }, '[agent-events] hook listener bound on 127.0.0.1')
          resolve(port)
        })
      })
      return starting
    },

    register(sessionId: string): string {
      if (port === null) {
        throw new Error('agent event listener not started')
      }
      const previous = bySession.get(sessionId)
      if (previous) tokens.delete(previous)
      const token = crypto.randomBytes(32).toString('hex')
      tokens.set(token, sessionId)
      bySession.set(sessionId, token)
      // ⚠ The token is NOT logged, here or anywhere. It is a capability.
      return `http://127.0.0.1:${port}/hook/${token}`
    },

    registerOutputDriven(sessionId: string): void {
      outputDriven.add(sessionId)
    },

    revoke(sessionId: string): void {
      const token = bySession.get(sessionId)
      if (token) tokens.delete(token)
      bySession.delete(sessionId)
      // ⚠ CLEARED HERE TOO, and for a sharper reason than tidiness: a stale
      // membership would let a DEAD session's last drainage of PTY output mint
      // a fresh `working` claim that nothing can ever retire, because the PTY
      // it would have to fall silent on is already gone. That is the latch bug
      // this whole mechanism exists downstream of.
      outputDriven.delete(sessionId)
      activity.delete(sessionId)
      // D168: a revoked session's live counters are gone for the same reason its
      // activity is — the token is dead and the sessions row is the durable
      // record (written per receipt, monotonically, by `main/ipc.ts`).
      memoryUsage.delete(sessionId)
    },

    noteOutput(sessionId: string): void {
      const rec = activity.get(sessionId)
      // Only a working session, and only a field write — see the interface.
      // A needs-you session's output is a redraw of the question it is asking;
      // refreshing anything from it would just be noise.
      if (rec?.activity === 'working') {
        rec.lastSignAt = Date.now()
        return
      }
      // ⚠ THE CREATE BRANCH, AND IT IS GUARDED THREE TIMES OVER: the session
      // must have been declared hook-less, it must have NO record at all, and
      // the claim it mints carries `source: 'output'` so the sweep retires it
      // on the short window rather than the 45 s backstop.
      //
      // ⚠ `!rec`, NOT `rec?.activity !== 'working'`. A `needs-you` record can
      // only come from a hook event, so it cannot exist on a session in this
      // set — but if one ever did, overwriting it would be this module doing
      // the single thing its header forbids: replacing an agent's own account
      // of itself with an inference drawn from pixels.
      if (!rec && outputDriven.has(sessionId)) {
        const now = Date.now()
        activity.set(sessionId, {
          activity: 'working',
          reason: null,
          since: now,
          lastSignAt: now,
          source: 'output'
        })
        announce(sessionId, 'working', now, null, 'output')
      }
    },

    sweepStale(now: number): number {
      // Collected first, mutated second: `announce` runs listeners that call
      // back into this module (the roll-up reads `recordFor`), and deleting
      // from a Map mid-iteration while those run is how a sweep starts
      // depending on listener order.
      const stale: string[] = []
      for (const [sessionId, rec] of activity) {
        if (isWorkingStale(rec, now)) stale.push(sessionId)
      }
      for (const sessionId of stale) {
        const rec = activity.get(sessionId)
        if (!rec) continue
        activity.delete(sessionId)
        // ⚠ `since` IS THE LAST SIGN OF LIFE, NOT `now`. The session stopped
        // being observably busy at `lastSignAt`; `now` is only when this timer
        // happened to notice, and a consumer stamping a turn's end with it
        // would put up to 45 seconds of invented work on the row. The
        // renderer deletes its entry on a null activity, so the number is read
        // by the turn recorder and no one else.
        announce(sessionId, null, rec.lastSignAt, null, rec.source)
      }
      // ⚠ NOT LOGGED PER SESSION. A line per expiry would be a durable record
      // of exactly when the operator's agents went quiet — the privacy rule
      // `turns.ts` states for its own per-turn logging, one module over.
      return stale.length
    },

    activityFor(sessionId: string): AgentActivity | null {
      return activity.get(sessionId)?.activity ?? null
    },

    recordFor(sessionId: string): AgentActivityRecord | null {
      return activity.get(sessionId) ?? null
    },

    memoryUsageFor(sessionId: string): SessionMemoryUsage | null {
      const rec = memoryUsage.get(sessionId)
      return rec ? toUsage(rec) : null
    },

    snapshot(): ReadonlyArray<{
      sessionId: string
      activity: AgentActivity
      since: number
      reason: NeedsYouReason | null
    }> {
      // ⚠ THE MAPPED LITERAL IS EXPLICIT, SO A NEW FIELD MUST BE ADDED BY HAND.
      // A miss here is D143(f) in its other half: the schema would accept the
      // object and `reason` would simply be absent, so the cold read would show
      // every waiting session as reasonless while the live stream showed
      // reasons — a discrepancy that looks like a race and is not one.
      return [...activity.entries()].map(([sessionId, a]) => ({
        sessionId,
        activity: a.activity,
        since: a.since,
        reason: a.reason
      }))
    },

    onActivity(listener: AgentActivityListener): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    onTranscriptPath(listener: TranscriptPathListener): () => void {
      transcriptListeners.add(listener)
      return () => transcriptListeners.delete(listener)
    },

    onMemoryUsage(listener: MemoryUsageListener): () => void {
      memoryListeners.add(listener)
      return () => memoryListeners.delete(listener)
    },

    async dispose(): Promise<void> {
      tokens.clear()
      bySession.clear()
      activity.clear()
      listeners.clear()
      transcriptListeners.clear()
      memoryUsage.clear()
      memoryListeners.clear()
      const srv = server
      server = null
      starting = null
      port = null
      if (!srv) return
      await new Promise<void>((resolve) => srv.close(() => resolve()))
    }
  }
}
