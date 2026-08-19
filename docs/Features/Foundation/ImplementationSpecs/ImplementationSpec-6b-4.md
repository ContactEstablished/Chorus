# Implementation Spec 6b-4 — Write Nudge (CONDITIONAL)

_Pairs with [`../Tasks/Task-6b-4.md`](../Tasks/Task-6b-4.md). Authored 2026-08-19 against `a3ba6f9`;
amended 2026-08-19 after CR-6b.0 (D173)._

**Read the task doc first**, and read its execution condition before you read anything else here:
**this task runs only if all three of D173's activation gates have passed** — **(a)** a clean baseline
(6b-1..3 landed, 6b-3's installed-app milestone drive run) recorded **`writes = 0`**; **(b)** the
listener-down / non-zero-curl-exit behaviour has been **measured on the installed claude** and is
**silent in the pane** — *if it cannot be silenced, the nudge does not ship*; and **(c)** **Matthew
has explicitly authorised** activation. If any one of them has not passed, the deliverable is one
roadmap row saying *"deferred — milestone met without the nudge"* (or *"deferred — activation gate not
passed"*) and nothing in this document is built.

**⚠ AND THE RULE SET BELOW IS D173's, WHICH SUPERSEDES D171's v1 LIST**: never on the first prompt;
only when the contract was emitted at launch **and** the graph is reachable; only while the session
has **no memory writes yet, reads-without-writes included**; **at most once** per session; and a line
with **no counters, no timestamps, no commands and no imperatives**.

This document adds what a task doc should not carry: the probes, the exact strings, the insertion
points, and the runtime checks that decide whether it worked.

---

## §0 — Probe before you build (do not skip)

Four facts. Three are named by D171; the fourth is not, and is raised here because it is a real
hazard for **this** app and not for the generic hook user.

All four run from an **empty directory** with the kickoff's measurement method:

```powershell
mkdir $env:TEMP\6b4probe; cd $env:TEMP\6b4probe
claude --version                      # was 2.1.235 at the Phase 6b kickoff — RECORD WHAT YOU SEE
claude -p --model haiku --no-session-persistence --strict-mcp-config `
       --settings <file> --debug-file .\debug.txt "<prompt>"
```

`--debug-file` is the instrument, not a nicety: *"Hook execution details, including which hooks
matched, their exit codes, and full stdout and stderr, are written to the debug log file"*
(`hooks.md:3434`). **The injected line is not visible in the pane** (`hooks.md:1302`), so the debug
log is the only place delivery can be confirmed directly.

### A fact already measured (D173) — cite it, do not re-derive it

**On claude 2.1.235, 2026-08-19 (recorded in D173):** a memory tool call with a deliberately **broken
Cypher** fired **`PostToolUseFailure`** — its body carries `error` and `is_interrupt` — while the
well-formed call fired **`PostToolUse`** (`_verify/6b-4/hookprobe/ptf.log` and
`_verify/6b-4/hookprobe/ptu.log`).

**Why it belongs in this document.** This task's *"the session has no memory writes yet"* is read off
6b-1's **`PostToolUse`-based** counter, so that counter is a count of **successful** write-tool calls:
a call that failed on bad Cypher never reaches it, and therefore never silences the nudge. The
residual caveat is the one that already held — a successful `write_neo4j_cypher` is not yet a
**sourced** memory, and `memory:validate` stays the write-side truth (D173 Q5).

### §0.0 — Generate the hook JSON with a script, never by hand

**⚠ BACKSLASHES IN JSON STRINGS ARE ESCAPES.** `"C:\Windows\System32\curl.exe"` is not a Windows
path in JSON, it is `\W` and `\S` — invalid escapes — and the settings file is silently useless.
The kickoff hit this and solved it the same way (`hookprobe/gen.cjs`). Copy the pattern:

```js
// _verify/6b-4/gen.cjs  —  node _verify/6b-4/gen.cjs
const fs = require('fs')
const path = require('path')
const fwd = (p) => p.split(path.sep).join('/')            // ⚠ the whole point of this file
const curl = fwd(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'curl.exe'))
const TOKEN = 'a'.repeat(64)                              // shape-legal, deliberately not a real one
const dead = `http://127.0.0.1:9/nudge/${TOKEN}`          // port 9 = discard, closed on this machine
const live = (port) => `http://127.0.0.1:${port}/nudge/${TOKEN}`

const curlCmd = (url, extra) =>
  `"${curl}" -s ${extra} -m 2 -X POST -H "Content-Type: application/json" --data-binary @- "${url}"`
const group = (command) => [{ matcher: '', hooks: [{ type: 'command', command }] }]
const write = (name, command) =>
  fs.writeFileSync(path.join(__dirname, name), JSON.stringify({ hooks: { UserPromptSubmit: group(command) } }, null, 1))

write('a1-bare.json', curlCmd(dead, ''))                       // the nudge entry as D171 spells it
write('a2-semicolon.json', curlCmd(dead, '') + ' ; exit 0')    // candidate silencer
write('a3-onul.json', curlCmd(dead, '-o NUL'))                 // BASELINE: today's events entry
write('a4-live.json', curlCmd(live(Number(process.argv[2])), '') + ' ; exit 0')
```

and the stand-in listener for the live case:

```js
// _verify/6b-4/stub.cjs  —  node _verify/6b-4/stub.cjs   (prints the port it bound)
const http = require('http')
const LINE = 'Project memory is reachable for this session; sourced memories can be recorded for completed milestones.'   // §1's NUDGE_LINE, D173
http.createServer((req, res) => {
  req.resume()
  req.on('end', () => { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); res.end(LINE + '\n') })
}).listen(0, '127.0.0.1', function () { console.log(this.address().port) })
```

### §0.1 — What the pane shows when the listener is down, and how to silence it

Run `a1`, `a2` and `a3` with the same trivial prompt (`"reply with the word ok"`) and **capture the
full terminal output and the debug log for each**.

**What the reference predicts, and what you are checking it against.** From *Other exit codes*
(`hooks.md:805`): *"With stdout that Claude Code treats as plain text, or with empty stdout, it's a
non-blocking error for most hook events: the action proceeds, and the transcript shows a
`<hook name> hook error` notice followed by the first line of stderr, prefixed with
`Failed with non-blocking status code:`."* A curl that cannot connect exits **7**; one that hits
`-m 2` exits **28**; both write nothing to stdout. So the prediction is a visible notice.

**⚠ `a3` IS THE BASELINE AND IT MATTERS MORE THAN THE OTHER TWO.** `-o NUL` changes where a
*successful* response body goes; it does not change the exit code, and a failed curl produces no
stdout either way. **If `a3` also shows the notice, then every Chorus claude session already shows it
on every hook whenever the listener is down — a pre-existing defect this task did not introduce.**
Record it as such, raise it as a finding (next free F-number, checked at pickup), and **do not fix
the events entry here**: the non-goals forbid touching it, and a silencer applied to fifteen event
entries is a separate, larger change than this task.

**Choosing the silencer.** Preference order, and the reason for it:

| Candidate | Verdict |
|---|---|
| **Nothing** — if the notice does not actually appear | Best. Measure before you add a workaround for a problem you have not seen. |
| **`… ; exit 0`** | The candidate. `;` separates statements and `exit 0` sets the code in **both** shells claude may use — `sh`/Git Bash **and** PowerShell. |
| `… \|\| exit 0` | **Refused unless `;` fails.** *"The `command` string is passed to a shell: `sh -c` on macOS and Linux, Git Bash on Windows, or PowerShell when Git Bash isn't installed"* (`hooks.md:462`). `\|\|` is a **parse error in Windows PowerShell 5.1**, so this works on the dev machine and breaks on a user machine with no Git Bash. |
| `cmd /c "curl … \|\| exit 0"` | Refused unless both above fail: it nests double quotes inside a command string that already quotes a path containing spaces. |
| `"shell": "bash"` on the entry | Refused. It makes the nudge require Git Bash on the user's machine. Chorus does not get to add a dependency to someone else's box. |
| curl `-f` / `--fail` | **Does not help.** `-f` changes the exit code for HTTP **error statuses**; it does nothing for exit 7 or 28, which are the two codes at issue. |

Whatever wins, **`a4` must still deliver stdout with the silencer attached** — that is the point of
running it. A silencer that also swallows the body has silenced the feature.

> **⚠ THIS MEASUREMENT IS ACTIVATION GATE (b) (D173 Q8), NOT A REFINEMENT.** If nothing in the table
> above makes the listener-down case **silent in the user's pane**, **the nudge does not ship**:
> record what you measured, defer the task, and write no code. The council made a pane-visible hook
> error on the non-`-o NUL` entry a hard gate precisely because it is a Chorus defect appearing in
> the user's conversation, on every prompt, for a feature they never asked for.

### §0.2 — That plain stdout still reaches the model (re-run ZEBRA)

D171 rests on a measurement taken on **2026-08-19 against claude 2.1.235**. Versions move; CLAUDE.md's
D4 rule exists for exactly this. Re-run the kickoff's probe unchanged — `hookprobe/ups.cjs` prints
`The project codeword is ZEBRA-7731.` on exit 0 — with the prompt *"what is the project codeword?"*.

**Pass:** the model says `ZEBRA-7731`. **Fail: STOP AND REPORT.** The vehicle is gone, and the design
needs fixing, not the code. Do not substitute `additionalContext` JSON on your own authority — that
would put a JSON object on the stdout of a hook whose sibling entry's whole invariant is that stdout
is a control channel, and it is a decision, not a substitution.

### §0.3 — That the real nudge is acted on, not surfaced as an injection

Same harness, but the hook prints **the exact `NUDGE_LINE` from §1**, and the prompt is an ordinary
one that has nothing to do with memory (*"list the files in this directory"*).

**What you are testing.** `hooks.md:974`: *"Write the text as factual statements rather than
imperative system instructions… Text framed as out-of-band system commands can trigger Claude's
prompt-injection defenses, which causes Claude to surface the text to you instead of treating it as
context."*

**Pass:** the reply answers the prompt and **does not quote, flag, or ask about the injected line**.
Record the verbatim reply either way.

**⚠ THE BEHAVIOURAL HALF IS NOT MEASURED HERE.** *"Does the agent then make a graph read?"* cannot be
answered in a `-p` run with `--strict-mcp-config` and no memory server — there is nothing to read.
That question belongs to the runtime drive (§8, step 2), where the server exists and 6b-1's counter
is watching. Do not claim it from this probe.

### §0.4 — The check D171 does not name: what `--resume` replays

`hooks.md:976`: *"Claude Code saves the injected text in the session transcript. For mid-session
events like `PostToolUse` or `UserPromptSubmit`, when you resume with `--continue` or `--resume`,
Claude Code **replays the saved text** rather than re-running the hook for past turns, so values like
timestamps or commit SHAs become stale."*

**Chorus resumes claude sessions by design** (Phase 4a / D139 — `--resume <uuid>` at
`sessionManager`'s resume path). So a nudge injected at turn 2 is **replayed on every later resume of
that conversation** — and **this is why D173 struck the counters out of the line.** The draft's
*"0 graph reads and 0 memory writes so far"* would still be in the transcript long after the session
had made fifty of each: not a stale nicety, but **durable false context**, which is the council's
phrase and its reason. Measure it anyway: run a session that fires the nudge, resume it, and read the
debug log and the model's behaviour.

**Three consequences, all of which the implementation already honours — state them in the code
comment rather than discovering them later:**

1. **The line carries no counter, no timestamp, no SHA, no command — nothing that can become false**
   (D173 Q8). §1's line states an **invariant**: memory is reachable for this session, and sourced
   memories can be recorded for completed milestones. Replayed at turn 200 it is the same sentence
   and it is still true, which is the property "so far" could not give.
2. **The ≤ 1 cap is also a replay bound.** At most **one** injected line can ever accumulate in one
   conversation's replay (D173 Q8 lowered the draft's two for exactly this reason).
3. **The write-only condition is read at fire time and never stated in the line.** The rule may look
   at `writes` to decide whether to speak; the sentence it speaks says nothing about the count, so a
   session that writes fifty memories after the nudge leaves no contradiction behind it.

If the measurement shows the replay is materially confusing (the model reasons from the stale line),
**record it as a finding and say so in the report**. Do not invent a mitigation in this task.

---

## §1 — `src/main/services/nudgeCore.ts` (new, pure)

**Placement rationale.** It sits in `services/` beside `agentEventsCore.ts` — the precedent for *a
pure core factored out so Vitest's `environment: 'node'` covers it with no HTTP server, no PTY and no
Electron* (`agentEventsCore.ts:1`–`:4`). It is a **separate file** from `agentEventsCore.ts` because
that module's subject is *classifying an untrusted body* and this one's is *a policy about when to
speak*: they change for different reasons, and a policy that can be unit-tested with three integers and a boolean is
worth keeping that cheap.

**⚠ IT IMPORTS NOTHING.** Not `memoryService` (whose `CHORUS_MEMORY_SERVER` `instructionsCore.ts`
does import), not the logger, not `agentEvents`. The line deliberately does **not** name the server:
the contract already names it, in the same session's system prompt, and every word here is paid for
on every prompt where the rule fires.

```ts
/**
 * The write-nudge rule (D171, Task 6b-4), factored PURE for the reason
 * `agentEventsCore` gives: three integers and a boolean decide this, and a
 * policy that cheap should be testable without binding a port.
 *
 * ⚠ THIS MODULE DECIDES WHETHER TO SPEAK, AND `agentEvents` DECIDES NOTHING.
 * The listener increments a counter, calls this, and writes the answer to a
 * socket. Every "when" lives here so there is exactly one place to read the
 * rule and exactly one place to change it.
 *
 * ⚠ AND THE LINE IS A STATEMENT, NEVER AN INSTRUCTION. The hooks reference
 * (Add context for Claude): "Write the text as factual statements rather than
 * imperative system instructions… Text framed as out-of-band system commands
 * can trigger Claude's prompt-injection defenses, which causes Claude to
 * surface the text to you instead of treating it as context." A nudge that
 * gets surfaced is worse than no nudge: it is a Chorus string appearing in the
 * user's conversation, unexplained.
 */

/** What the listener knows about one session when a prompt arrives. */
export interface NudgeState {
  /** 1-based ordinal of the prompt being submitted RIGHT NOW — the count of
   *  `UserPromptSubmit` receipts on the nudge route this session, incremented
   *  BEFORE this is called. The first prompt is 1. */
  readonly turnOrdinal: number
  /** 6b-1's per-session WRITE counter (D168) — and the ONLY counter this rule
   *  reads (D173 Q8). It is `PostToolUse`-based, so it counts SUCCESSFUL memory
   *  write-tool calls: a broken-Cypher call fires `PostToolUseFailure` and never
   *  reaches it (measured, claude 2.1.235 — §0).
   *
   *  ⚠ THERE IS DELIBERATELY NO `reads` FIELD. Reads-without-writes is a case
   *  that FIRES; the draft's both-counters-zero condition was dropped by D173. */
  readonly writes: number
  /** How many nudges this session has already been given. */
  readonly nudgesSent: number
  /** D173: the contract was emitted at this session's launch AND the graph was
   *  reachable. After D169 those are ONE predicate — the contract is emitted only
   *  when the launch-time `:AgentSession` MERGE succeeded — which is why a single
   *  flag carries both of D173's conditions and there is no second signal that
   *  could disagree with the first. Unknown is false: silent is the safe
   *  direction.
   *
   *  ⚠ ACCEPTED LIMIT, NAMED RATHER THAN HIDDEN: "currently reachable" is read as
   *  "reachable at launch". The nudge path may not await anything (§3f), so it
   *  cannot probe; if a later task ever produces a mid-session reachability
   *  signal, it updates THIS flag and nothing else in the rule changes. */
  readonly graphReachable: boolean
}

/** D173 Q8: "at most ONCE per session" — it lowered D171's draft of twice,
 *  because one fire is enough for a measured intervention and every fire is
 *  replayed on `--resume`. */
export const MAX_NUDGES_PER_SESSION = 1

/** D171: "never on the first prompt of a session". A session's first prompt is
 *  the one the user just typed to start work; a fact about what it has not done
 *  yet is not a fact, it is noise. */
export const FIRST_ELIGIBLE_TURN = 2

/**
 * ⚠ THE EXACT TEXT, AND EVERY PROPERTY OF IT IS LOAD-BEARING.
 *
 *  - ONE LINE. It is written to an HTTP body and read off a hook's stdout.
 *  - ASCII ONLY. It crosses a socket, curl, a shell of unknown identity and a
 *    Windows console before the model sees it. A typographic apostrophe is one
 *    mojibake away from a nudge that reads as corrupted text.
 *  - IT DOES NOT START WITH `{`. Claude Code chooses plain-text vs JSON on the
 *    first non-whitespace character; a leading brace would make this a HOOK
 *    DECISION OBJECT rather than context.
 *  - NO IMPERATIVE, NO SECOND PERSON, NO "SYSTEM" FRAMING. See the docblock.
 *  - IT CARRIES NO COUNTER, NO TIMESTAMP, NO COMMAND (D173 Q8). Injected text is
 *    REPLAYED on `--resume` (hooks.md:976), so anything that can become false
 *    becomes DURABLE FALSE CONTEXT. This sentence is an INVARIANT: replayed at
 *    turn 200 it is the same claim, and still true.
 *  - AND SO NOTHING IN IT DEPENDS ON THE RULE THAT GATED IT. The rule reads
 *    `writes` to decide whether to speak; the sentence says nothing about any
 *    count, so it cannot outlive its guard.
 *    ⚠ IF A LATER EDIT PUTS A NUMBER BACK IN, THE REPLAY PROPERTY IS GONE AND
 *    D173 IS BEING REOPENED, NOT REFINED — and the tests would still pass, which
 *    is why the structural "no digits" assertion is in `nudgeCore.test.ts`.
 */
export const NUDGE_LINE =
  'Project memory is reachable for this session; sourced memories can be recorded ' +
  'for completed milestones.'

/**
 * The rule, in the order D173 states it — cheapest and most decisive first.
 * ⚠ D173 (CR-6b.0 Q8) SUPERSEDES D171's v1 LIST; where the two differ, this is
 * the one that shipped.
 *
 * ⚠ THE COUNTER TEST IS `writes === 0`, AND `reads` IS NOT READ AT ALL. The
 * draft's `reads === 0 && writes === 0` was DROPPED with its reason recorded:
 * this is a WRITE nudge, and an agent that has read the graph but written
 * nothing is the target case, not an exemption. What keeps it from becoming a
 * demand for running commentary — the concern the draft's condition was
 * protecting, and the contract's own "write after a MILESTONE, not after every
 * turn" (`instructionsCore.ts:26`) — is the rest of the set: never the first
 * prompt, at most once per session, and a sentence that states a possibility
 * rather than asking for anything.
 */
export function composeNudge(state: NudgeState): string | null {
  // Silent unless the contract was emitted at launch AND the graph was reachable
  // (D173; one predicate after D169). An agent nudged about a graph it was never
  // given a contract for is being told to use a feature it does not have — the
  // same failure D169(b) withholds the contract to avoid.
  if (!state.graphReachable) return null
  // Never the first prompt of a session.
  if (state.turnOrdinal < FIRST_ELIGIBLE_TURN) return null
  // At most ONCE (D173 Q8). A second would be nagging — and every fire is
  // replayed on `--resume`, so the cap is a replay bound as well as a manners
  // rule.
  if (state.nudgesSent >= MAX_NUDGES_PER_SESSION) return null
  // Only while the session has written nothing. ⚠ READS DO NOT SILENCE IT.
  if (state.writes !== 0) return null
  return NUDGE_LINE
}
```

**⚠ `composeNudge` RETURNS THE BARE LINE, WITH NO TRAILING NEWLINE.** The route appends `'\n'` when
it writes the body, so the unit test can assert an exact string with no whitespace ambiguity while
the wire format still matches the kickoff's measured probe (`hookprobe/ups.cjs` wrote `…\n` and the
model read it).

---

## §2 — `src/main/services/agentEventsCore.ts`

**Replace `parseHookPath` (`:188`–`:202`) with `parseListenerPath`.** Not *add beside* — replace.
Two functions would mean two places that write down the token shape and the query-string rejection,
and the module's own comment says the point of keeping the parser here is that *"a miss is never a
partial match, so a probe cannot walk the surface"*. That property survives only while there is one
parser.

```ts
/** The listener's two routes. Nothing else exists (D171 added the second). */
export type ListenerRoute = 'hook' | 'nudge'

/**
 * The listener's URL contract: `POST /hook/<token>` — the event bus, whose reply
 * is always `{}` — and `POST /nudge/<token>` (D171), whose reply is `text/plain`
 * and is read by the model. Returns the route and the token, or `null` for any
 * shape that is not exactly one of those two.
 *
 * ⚠ TWO PREFIXES, ONE TOKEN, ONE SHAPE CHECK, ONE REJECTION POLICY. The routes
 * differ in what they ANSWER, never in who they trust: both look the token up in
 * the same map, so a nudge cannot be solicited for a session whose events could
 * not be posted, and rotating a token rotates both at once.
 *
 * Kept here (pure) rather than inline in the server so the rejection cases are
 * unit-testable without binding a port.
 */
export function parseListenerPath(url: string | undefined): { route: ListenerRoute; token: string } | null {
  if (!url) return null
  // Query strings and fragments are not part of the contract; a URL carrying
  // one is rejected outright rather than trimmed, so there is exactly one
  // accepted spelling of a valid request.
  if (url.includes('?') || url.includes('#')) return null
  const prefixes: ReadonlyArray<readonly [string, ListenerRoute]> = [
    ['/hook/', 'hook'],
    ['/nudge/', 'nudge']
  ]
  for (const [prefix, route] of prefixes) {
    if (!url.startsWith(prefix)) continue
    const token = url.slice(prefix.length)
    // Token shape is fixed by the minting side (32 bytes -> 64 lowercase hex).
    // Checking it HERE means a malformed token never reaches the token map at
    // all, so the map's own timing profile cannot be probed with junk.
    if (!/^[0-9a-f]{64}$/.test(token)) return null
    return { route, token }
  }
  return null
}
```

**⚠ `return null` INSIDE THE LOOP, NOT `continue`.** `/hook/zzz…` must be rejected, not fall through
to be tested against `/nudge/`. `continue` there would be harmless today and wrong the moment a third
prefix is a prefix of another.

**Test migration:** `agentEventsCore.test.ts:170`–`:197` (`describe('parseHookPath — the listener has
exactly one route')`) becomes `describe('parseListenerPath — the listener has exactly two routes')`.
Its 13 rejection cases keep their URLs and assert `null`; add the `/nudge/` mirror of each; add the
two acceptance cases. **Keep the "rejects a malformed token BEFORE any map lookup" case for both
prefixes** — it is a property of the parser and it is why the check lives here.

---

## §3 — `src/main/services/agentEvents.ts`

### 3a — The header (`:34`–`:75`), amended in this commit

**Security note 3 (`:48`–`:50`) becomes false the moment this lands** and must be rewritten, not left
standing — D168 already establishes the rule that a stale security claim must not outlive the code.

```
 *  3. **The surface is two routes.** POST `/hook/<64 hex>`, whose reply is
 *     always `{}` and is thrown away by the caller (`-o NUL`), and POST
 *     `/nudge/<64 hex>` (D171), whose reply is `text/plain` and is READ BY THE
 *     MODEL. Both take the same token from the same map. Every other method,
 *     path and token shape gets an identical 404 with an empty body, so the
 *     listener never confirms what exists.
 *
 *     ⚠ THE NUDGE ROUTE'S REPLY IS AN OUTPUT SURFACE, WHICH NO OTHER PART OF
 *     THIS MODULE HAS. It may emit exactly two things: one constant sentence
 *     from `nudgeCore`, or nothing. It must never emit a leading `{` — Claude
 *     Code would parse that as a hook DECISION object and Chorus would be
 *     answering a question it was never asked.
```

**Security note 5** keeps its count — this task reads **no new field**. Add one sentence: *"the nudge
route reads the same `hook_event_name` and nothing else, and only to confirm the body is a
`UserPromptSubmit`."*

### 3b — The per-session record

**⚠ ADD THREE FIELDS TO 6b-1's EXISTING PER-SESSION COUNTER RECORD. DO NOT CREATE A SECOND MAP.**
D168 put `{ reads, writes, firstReadOrdinal, firstExploreOrdinal }` in an in-memory per-session record
beside `activity`. Whether 6b-1 shipped that on `AgentActivityRecord` (`:85`) or as its own `Map`,
**this task adds to that same record**:

```ts
  /** D171: `UserPromptSubmit` receipts on the NUDGE route this session. */
  turnOrdinal: number
  /** D171: how many nudges this session has been given. Capped at 1 by nudgeCore
   *  (D173 Q8). */
  nudgesSent: number
  /** D171/D173: set once at launch by `setGraphReachable`. ⚠ FALSE UNTIL TOLD
   *  OTHERWISE — a session nobody vouched for is silent. It carries BOTH of
   *  D173's launch conditions — the contract was emitted, and the graph was
   *  reachable — because after D169 those are one predicate. */
  graphReachable: boolean
```

**The rule reads `writes` off 6b-1's existing fields and does not read `reads` at all** (D173 Q8:
reads-without-writes fires). Nothing new is counted for the write side.

Two maps would mean two things `revoke()` has to remember to clear, and `revoke()` is the security
boundary (`:338`–`:343`). One record, one delete.

### 3c — `register()` returns both URLs (`:325`–`:336`)

```ts
/** The two URLs one session's hook config needs. Minted together, from one
 *  token, because they ARE one capability. */
export interface AgentEndpoints {
  readonly endpointUrl: string
  readonly nudgeUrl: string
}
```

```ts
    register(sessionId: string): AgentEndpoints {
      if (port === null) throw new Error('agent event listener not started')
      const previous = bySession.get(sessionId)
      if (previous) tokens.delete(previous)
      const token = crypto.randomBytes(32).toString('hex')
      tokens.set(token, sessionId)
      bySession.set(sessionId, token)
      // ⚠ NEITHER URL IS LOGGED, here or anywhere. They are the same capability
      // in two spellings.
      return {
        endpointUrl: `http://127.0.0.1:${port}/hook/${token}`,
        nudgeUrl: `http://127.0.0.1:${port}/nudge/${token}`
      }
    },
```

**⚠ A TUPLE RATHER THAN A SECOND METHOD, AND THAT IS THE POINT.** A `nudgeUrlFor(sessionId)` beside
`register()` would work only if it were called **after** `register()` rotated the token; in an object
literal that is true today because JS evaluates properties in source order, and it is one line-move
from silently minting a nudge URL against the **previous** token. Returning both makes the trap
unrepresentable. The cost is three call sites (`sessionManager.ts:780`, `agentEvents.test.ts:61` and
`:191`) and the interface docblock at `:138`–`:144`; that is the whole blast radius.

### 3d — `setGraphReachable`, on the interface beside `revoke` (`:146`)

```ts
  /**
   * D171: whether this session was launched with the memory contract — which
   * after D169 means the launch-time `:AgentSession` MERGE succeeded.
   *
   * ⚠ THIS ONE BOOLEAN IS BOTH OF D173's CONDITIONS — "the contract was emitted
   * at launch" AND "the graph is reachable". See `NudgeState.graphReachable` for
   * why they are one predicate here, and for the accepted limit on the word
   * *currently*.
   *
   * ⚠ CALLED FOR BOTH ANSWERS, NEVER ONLY THE TRUE ONE. An explicit `false` and
   * an absent record must behave identically (silent), and calling it on both
   * branches is what proves that at the call site rather than in a default.
   */
  setGraphReachable(sessionId: string, reachable: boolean): void
```

### 3e — `handle()` (`:229`), the branch

Replace the parse block at `:235`–`:241`:

```ts
    const parsed = parseListenerPath(req.url)
    const sessionId = parsed ? tokens.get(parsed.token) : undefined
    if (!parsed || !sessionId) {
      req.resume()
      reject(res)          // ⚠ 404 `{}` — the SAME rejection for both routes
      return
    }
    if (parsed.route === 'nudge') {
      handleNudge(req, res, sessionId)
      return
    }
```

Everything below (`:243`–`:301`) is **untouched**.

### 3f — `handleNudge`, placed immediately above `handle`

```ts
  /**
   * D171's route. Same token, same cap, same "never stall the agent" duty — and
   * two deliberate differences from `handle`, each with a reason.
   *
   * ⚠ IT CANNOT ANSWER BEFORE IT PARSES, because the ANSWER IS THE POINT. The
   * events route replies `{}` before deriving anything (`:256`–`:261`) so it can
   * never make an agent wait; here the reply IS the derivation. What bounds it
   * instead is that the derivation touches nothing: a Map lookup, three integer
   * comparisons and a constant string. No file, no socket, no database, no
   * await. Above that sit curl's `-m 2` and `UserPromptSubmit`'s own 30-second
   * hook timeout, after which the prompt proceeds without the context.
   *
   * ⚠ AND IT NEVER DESTROYS THE SOCKET. `handle` destroys past the cap (`:250`)
   * because a sender past the cap is not owed a reply. Here a destroyed socket
   * means curl exits non-zero, and a non-zero exit on THIS entry puts a
   * "hook error" notice in the user's transcript (§0.1). A `UserPromptSubmit`
   * body carries the whole prompt, so a large paste can legitimately exceed the
   * cap — an ordinary user action must not print an error. Past the cap the
   * buffer is dropped and drained, heap stays bounded, `REQUEST_TIMEOUT_MS`
   * bounds the time, and the answer is an empty 200.
   */
  function handleNudge(req: http.IncomingMessage, res: http.ServerResponse, sessionId: string): void {
    let size = 0
    let over = false
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (over) return
      if (size > MAX_BODY_BYTES) {
        over = true
        chunks.length = 0
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      let line: string | null = null
      if (!over) {
        let body: unknown = null
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        } catch {
          body = null // untrusted input; a malformed body is simply not a turn
        }
        // ⚠ THE ONLY FIELD READ ON THIS ROUTE, and only to confirm the shape.
        // Not `prompt`, not `cwd`, not `session_id` — the body's own claim about
        // which session it is has never been trusted (security note 2) and is
        // not trusted here either: `sessionId` came from the TOKEN.
        if (readHookEventName(body) === 'UserPromptSubmit') line = takeTurn(sessionId)
      }
      // ⚠ `text/plain` ON EVERY PATH, AND NEVER A `{`.
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(line === null ? '' : `${line}\n`)
    })
    req.on('error', () => {
      /* client vanished mid-body; nothing to clean up beyond the socket */
    })
  }

  /**
   * Count this prompt, then ask the rule. ⚠ THE COUNT HAPPENS ON THIS ROUTE AND
   * ONLY THIS ROUTE. Both hook entries fire on `UserPromptSubmit` and "all
   * matching hooks run in parallel" (hooks reference), so counting on `/hook`
   * as well would double every turn, and counting on `/hook` INSTEAD would race
   * the composition that reads the count.
   */
  function takeTurn(sessionId: string): string | null {
    const rec = counterRecordFor(sessionId)      // 6b-1's record; created on demand
    rec.turnOrdinal += 1
    const line = composeNudge({
      turnOrdinal: rec.turnOrdinal,
      // ⚠ `rec.reads` IS NOT PASSED, AND THAT IS D173 Q8: reads-without-writes is
      // a case that fires. `NudgeState` has no field for it, so a future edit
      // cannot reinstate the draft's condition by accident.
      writes: rec.writes,
      nudgesSent: rec.nudgesSent,
      graphReachable: rec.graphReachable
    })
    if (line !== null) rec.nudgesSent += 1
    // ⚠ THE OUTCOME, NEVER THE TEXT, NEVER THE URL, NEVER THE TOKEN. This is the
    // line the runtime drive asserts against, which is why it is `debug` and why
    // it says only "sent" or "none".
    logger.debug({ sessionId, nudge: line === null ? 'none' : 'sent' }, '[nudge]')
    return line
  }
```

### 3g — `revoke()` (`:338`–`:343`)

Whatever 6b-1 added there, confirm the counter record is deleted. **A stale `nudgesSent` on a
re-registered id silences a legitimate nudge; a stale `graphReachable` fires one into a dead graph.**
If 6b-1 folded the counters into the `activity` record, `activity.delete(sessionId)` (`:342`) already
does it — assert that with a test rather than reading it and believing it.

---

## §4 — `src/main/adapters/types.ts`

**On `PtyLaunchHooks`, after `endpointUrl` (`:521`), before `configPath` (`:525`) — required, not
optional.** Optional would let a mint forget it with no compile error; required turns that into a
type error at both construction sites.

```ts
  /**
   * D171 (Task 6b-4): the URL the SECOND `UserPromptSubmit` entry POSTs to.
   * Same host, same port, same token as `endpointUrl` — a different path.
   *
   * ⚠ EVERY WARNING ON `endpointUrl` APPLIES VERBATIM: it carries the same
   * capability token, so never log it, never put it in an Error, never return it
   * across IPC, and never let it reach argv. It MAY be written to `configPath`,
   * for the same reason and by the same mechanism.
   *
   * ⚠ AND IT IS MINTED, NOT DERIVED. An adapter must never build this by string
   * surgery on `endpointUrl` (replacing `/hook/` with `/nudge/`): that would put
   * the listener's URL contract in a second file, one that has no way to know
   * when the route set changes.
   */
  readonly nudgeUrl: string
```

**The two construction sites** — `sessionManager.ts:779`–`:782` and the test literal at
`adapters.test.ts:1620`–`:1621` — are the entire blast radius. Grep `endpointUrl:` to confirm before
and after.

---

## §5 — `src/main/adapters/claude.ts`

**Insert after the `for (const event of classifiedHookEventNames()) config[event] = entry` loop
(`:227`) and before the `try` that writes the file (`:229`).** Nothing at `:200`–`:227` changes.

```ts
    // ── D171 (Task 6b-4): the write nudge ────────────────────────────────────
    //
    // ⚠ THE MISSING `-o NUL` IS THE MECHANISM, NOT AN OVERSIGHT. Read the block
    // above first: a hook command's stdout is a control channel, which is why
    // the events entry throws its response away. For `UserPromptSubmit` — and
    // only for `UserPromptSubmit`, `UserPromptExpansion` and `SessionStart` —
    // claude adds plain-text stdout to the MODEL'S CONTEXT (hooks reference,
    // "Exit code 0"; measured on 2.1.235, 2026-08-19: a hook printed a codeword
    // and the model repeated it). This entry therefore lets the listener's
    // RESPONSE BODY through, deliberately, on a route that answers `text/plain`
    // and can never answer a `{`.
    //
    // ⚠ THE EVENTS ENTRY IS NOT TOUCHED. Same command, same flags, same events.
    //
    // ⚠ `<SILENCER>` IS MEASURED, NOT ASSUMED (spec §0.1). A curl that cannot
    // reach the listener exits 7, or 28 on `-m 2`, and a non-zero exit with empty
    // stdout puts a "<hook> hook error" notice in the USER'S transcript. The
    // quietest command that still delivers stdout on success wins; what this
    // machine actually showed is in `_verify/6b-4/`.
    const nudgeCommand =
      `"${curl}" -s -m 2 -X POST -H "Content-Type: application/json" ` +
      `--data-binary @- "${hooks.nudgeUrl}"<SILENCER>`
    const nudgeEntry = { matcher: '', hooks: [{ type: 'command', command: nudgeCommand }] }
    // ⚠ A NEW ARRAY, NEVER A PUSH. `entry` above is ONE array object assigned by
    // reference to every key in the loop, so `config.UserPromptSubmit.push(...)`
    // would add the nudge to EVERY classified event at once — fifteen nudges per
    // prompt, silently, with no type error anywhere.
    config.UserPromptSubmit = [...((config.UserPromptSubmit as unknown[]) ?? []), nudgeEntry]
```

**`?? []` is not defensive padding.** `UserPromptSubmit` is in `WORKING_EVENTS`
(`agentEventsCore.ts:60`) so the key exists today, and a test pins that. If a later change drops it
from the classified set, the nudge must still be written — it does not depend on classification — and
this expression is what makes that true instead of a crash.

**The resulting file shape:**

```jsonc
{ "hooks": {
    "UserPromptSubmit": [ <events entry, -o NUL>, <nudge entry, no -o NUL> ],
    "PreToolUse":       [ <events entry, -o NUL> ],
    "PostToolUse":      [ <events entry, -o NUL> ],
    "…":                [ <events entry, -o NUL> ]
} }
```

Two matcher groups on one event, rather than two handlers inside one group, because
*"all matching hooks run in parallel"* either way (`hooks.md:410`) and this spelling keeps the events
entry object **byte-identical to the one every other event gets** — which is what the aliasing test
asserts. Each hook's stdout is handled independently; the events entry's stdout is empty and adds
nothing.

---

## §6 — `src/main/services/sessionManager.ts`

**The mint (`:776`–`:788`)** — one destructure, everything else unchanged:

```ts
      try {
        const { endpointUrl, nudgeUrl } = this.hooks.register(sessionId)
        hooks = {
          endpointUrl,
          nudgeUrl,
          configPath: join(this.hookConfigDir, `${sessionId}.json`)
        }
      } catch (err) {
        // unchanged: a listener that never bound must cost the lights, never the launch
        logger.warn({ err, sessionId }, '[hooks] could not register session; launching without hooks')
      }
```

**The reachability call, immediately after the instructions mint (`:793`–`:799`):**

```ts
    // D171 (6b-4): the nudge is silent unless this session actually has the
    // contract.
    //
    // ⚠ "HAS THE CONTRACT" IS READ HERE RATHER THAN PLUMBED FROM ipc.ts, AND
    // THAT IS THE DECISION. After D169 the contract is emitted only when the
    // launch-time `:AgentSession` MERGE succeeded, so "instructions present" and
    // "graph reachable" are the SAME predicate — D173 names two conditions and
    // this one call carries both — and reading the one that is
    // already computed means there is no second signal that can disagree with
    // the first. It is also the better semantics: nudging an agent about rules
    // it was never given is nudging it to fail.
    //
    // ⚠ CALLED ON BOTH BRANCHES, and only for a session that actually holds a
    // token — the record's lifetime then matches the token's, and `revoke()`
    // stays the single place that cleans up.
    if (hooks && this.hooks) this.hooks.setGraphReachable(sessionId, instructions !== undefined)
```

**No new field, no new binder, no `ipc.ts` change.** If 6b-2 landed an explicit reachability flag on
`LaunchOptions`, read **that** instead and delete this derivation — but do not keep both.

---

## §7 — Tests

| File | Adds |
|---|---|
| `nudgeCore.test.ts` (new) | every rule of D173's set alone — **including that reads-without-writes FIRES**; the exact `NUDGE_LINE` as a literal; the **≤ 1** cap driven over turns 1–10; ASCII-only; no leading `{`; **no digit anywhere** (the replay-safety check); no imperative opener / directive phrase |
| `agentEventsCore.test.ts` | `parseListenerPath`: 13 rejections × 2 prefixes, 2 acceptances, malformed-token-before-map-lookup for both |
| `agentEvents.test.ts` | the nudge route, driven through the real bound port (see the task doc's Test Expectations for the full list) |
| `adapters.test.ts` | the written settings file: exactly one non-`-o NUL` command, under `UserPromptSubmit`, and no other event's array grew |

**The forbidden-opener list, written in `nudgeCore.test.ts` and nowhere else:**

```ts
const FORBIDDEN_OPENERS = [
  'read', 'query', 'write', 'run', 'use', 'call', 'check', 'consider', 'remember',
  'please', 'ensure', 'make', 'do', 'note', 'start', 'begin', 'before', 'always',
  'never', 'you', 'your', 'must', 'should', 'system', 'important', 'attention',
  'reminder', 'instruction', 'instructions'
]
const FORBIDDEN_PHRASES = [
  'you must', 'you should', 'you need', 'please ', 'make sure', 'do not', "don't",
  'system:', '<system', 'important:', 'reminder:', 'as a reminder'
]
// D173 Q8: the line must also be REPLAY-SAFE — no counters, no timestamps, no
// commands — and that is checkable by SHAPE rather than by reading it.
const FORBIDDEN_SHAPES: ReadonlyArray<RegExp> = [
  /\d/,        // any digit at all: a counter, a date, a version, a port
  /[`$]/,      // a command or a shell fragment
  /[\\/]/,     // a path
  /:/          // "system:" / "reminder:" and label-shaped framing generally
]
```

The test lowercases the line, asserts its first word is not in `FORBIDDEN_OPENERS` (so it cannot open
with a verb), asserts none of `FORBIDDEN_PHRASES` occurs anywhere, and asserts **no
`FORBIDDEN_SHAPES` pattern matches**. **The three lists together are the specification of "factual,
not imperative, and still true when replayed"; a future reword that trips any of them should have to
argue with a red test.**

**`agentEvents.test.ts` needs a body-returning helper** — the existing `post()` (`:26`–`:48`) discards
the response with `res.resume()`. Add `postForReply(url, body)` returning
`{ status, contentType, text }`, and **keep `post()` unchanged** so none of the eleven edge-trigger
cases move.

**The log-hygiene assertion** (cheap half): read `claude.ts`, `agentEvents.ts` and `sessionManager.ts`
as text and assert no line matching `logger\.\w+\(` also contains `nudgeUrl`, `endpointUrl` or
`token`. The real half is the runtime grep in §8.

---

## §8 — Verification

### Build

```
npm run typecheck        # 0
npx vitest run           # >= the 6b-3 baseline, plus the new cases
npm run grep:secrets     # clean
```

### Structural

```powershell
# 1. EXACTLY ONE non `-o NUL` hook entry, and it is under UserPromptSubmit.
#    Run the adapter into a temp dir (the adapters.test.ts case does this), then:
node -e "const c=require('fs').readFileSync(process.argv[1],'utf8');const h=JSON.parse(c).hooks;let n=0;for(const[e,g]of Object.entries(h))for(const m of g)for(const k of m.hooks)if(!k.command.includes('-o NUL')){n++;console.log('non -o NUL under',e)}console.log('total:',n)" <settings.json>
# expect: exactly one line, 'non -o NUL under UserPromptSubmit', total: 1

# 2. NO `Stop` DECISION OUTPUT ANYWHERE in the diff.
git diff -U0 | Select-String -Pattern 'hookSpecificOutput|"decision"|stop_hook_active|PreCompact|SubagentStop|SessionStart'
# expect: no hits

# 3. The events entry is untouched.
git diff src/main/adapters/claude.ts
# expect: only ADDED lines, all of them after the classifiedHookEventNames loop

# 4. One parser, one route set.
Select-String -Path src -Include *.ts -Pattern "parseHookPath|'/hook/'|'/nudge/'" -Recurse
# expect: the prefixes appear ONLY in agentEventsCore.ts and its test; parseHookPath is gone

# 5. Two construction sites, still two.
Select-String -Path src -Include *.ts -Pattern 'endpointUrl:' -Recurse
```

**The nudge text contains no imperative verbs.** Pinned by the `nudgeCore.test.ts` list above.
Forbidden openers, restated so a reviewer can check by eye: **read · query · write · run · use · call
· check · consider · remember · please · ensure · make · do · note · start · begin · before · always
· never · you · your · must · should · system · important · attention · reminder · instruction(s)**.
Forbidden anywhere: **"you must" · "you should" · "you need" · "please " · "make sure" · "do not" ·
"don't" · "system:" · "&lt;system" · "important:" · "reminder:" · "as a reminder"**. And the line must
not begin with `{`.

**And forbidden by shape (D173 Q8, the replay-safety half): any digit · a backtick or `$` · a path
separator · a colon.** The line carries no counter, no timestamp and no command, so it is as true on
a `--resume` replay as it was when it was injected.

### Runtime — the part that decides the task

Dev app, container up, memory configured on a real project, a **claude** pane. Everything below goes
into `_verify/6b-4/` as pasted output, including whatever did not go your way.

1. **First prompt → `nudge: none`.** From the debug-level log line only. **Confirm the log line
   carries no text, no URL and no token** — that is half of what step 7 checks anyway.
2. **Second prompt, the write counter still zero → `nudge: sent`.** Then the three things that
   matter, in order of how much they matter:
   - **6b-1's write counter moves** — the agent recorded a memory, and `memory:validate` says whether
     it was *sourced*. *This is the task's whole purpose* (it is a write nudge, D173 Q8; a read with
     no write is a partial result and is recorded as one).
   - the line is **not** visible in the pane (`hooks.md:1302`) — **record exactly what is visible,
     including "nothing"**, so the next person does not go looking for it;
   - the model does not surface or query the line.
3. **Five or more prompts → exactly ONE nudge, ever** (D173's ≤ 1 cap). Record the count.
4. **Listener down.** Do **not** stop the dev app's listener — that would take the pane's activity
   lights with it and measure two things at once. Copy the session's `--settings` file, point the
   **nudge** entry at a closed port, and run `claude -p --settings <copy>` from an empty directory.
   **Paste what the transcript shows**, then repeat with the silencer and paste the difference.
5. **Resume** (§0.4): resume the conversation that fired a nudge and record whether the line replays
   — and, if it does, that the replayed sentence is **still true** (D173 struck the counters out of
   it for exactly this reason).
6. **Codex, same project**: argv byte-identical to the pre-task capture; no `/nudge/` anywhere.
7. **Close the pane**: the `--settings` file is gone; a POST to the old `/nudge/<token>` returns
   `404 {}`; and `Select-String` the app log for the session token and for `/nudge/` → **zero hits**.

### The invariant a reviewer should test hardest

**Two clauses, and they fail in opposite directions.**

**(1) The events entry's `-o NUL` is untouched.** Not "equivalent", not "still there in spirit" —
byte-identical, for every one of the classified events, with the same flags in the same order and its
comment intact. The failure mode is not subtle in a diff and is invisible at runtime until an agent
receives a hook decision Chorus never made, on every tool call. `git diff src/main/adapters/claude.ts`
must show **added lines only**, all after the loop. And the aliasing test (`entry` is one shared array
object) is the other half of the same invariant: a nudge that leaked onto `PreToolUse` would put a
plain-text sentence on the stdout of an entry whose stdout is a control channel — the exact thing the
`-o NUL` comment exists to prevent, arrived at from the other side.

**(2) The nudge route can never return a JSON decision object.** Its response body has exactly two
legal values — `NUDGE_LINE + '\n'` and `''` — and its `content-type` is `text/plain` on every path,
including the malformed-body path, the over-cap path and the wrong-event path. Claude Code decides
plain-text vs JSON on the first non-whitespace character of stdout (`hooks.md:766`), so a single `{`
reaching that socket turns a nudge into a hook decision on the user's prompt — and `UserPromptSubmit`
is an event that **can block** (`hooks.md`, exit-code-2 table: *"Blocks prompt processing and erases
the prompt"*). **Chorus silently erasing a user's prompt is the worst outcome this task can produce**,
and it is one stray brace away. Test it by pointing the nudge entry at a hand-written stub that
returns `{"decision":"block"}` and confirming that the real listener never can — then delete the stub.
