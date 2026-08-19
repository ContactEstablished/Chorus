# Implementation Spec 6b-1 — Measure

_Pairs with [`../Tasks/Task-6b-1.md`](../Tasks/Task-6b-1.md). Authored 2026-08-19 against `a3ba6f9`;
**amended 2026-08-19 after CR-6b.0 (D173)** — §0 gains the `PostToolUseFailure` measurement, §1 loses
`Bash` from the exploration set and gains two classifiers, §3 gains two ordinals, §4/§5 go from three
columns to **five**, §6/§7/§8 carry the new label and the new schema fields._

**Read the task doc first.** **The D168 ratification gate is DISCHARGED** — D168 was ratified through
**CR-6b.0 (D173)** on 2026-08-19, so the task may start; read D168's "⚠ AMENDED BY D173" clause before
building on the row's body. This document adds what a task doc should not carry: the exact insertion
points, the proposed code shapes, the amended header text, the SQL, the UI strings, and the runtime
checks that decide whether it worked.

Every `file:line` cited below was opened and checked on 2026-08-19 at `a3ba6f9`, and **none of them
moved in the D173 amendment** — the council changed rulings, not the code they point at. **TypeScript
blocks are SKETCHES** — they are the shape and the reasoning, not text to paste unread.

---

## §0 — Probe before you build (do not skip)

Five facts this spec rests on were measured on 2026-08-19, and **D173 added a sixth** — the
`PostToolUse` / `PostToolUseFailure` split, below, which is what earns the word *successful* in every
label this task ships. **Re-measure all six.** CLAUDE.md forbids
trusting recall for CLI syntax, and hook semantics move for exactly the same reason flags do — claude
went 2.1.232 → 2.1.235 between the 6a and 6b kickoffs.

### (1) The CLI

```powershell
claude --version            # was 2.1.235 at C:\Users\matth\.local\bin\claude
```

### (2) The `PostToolUse` body shape — the fact the whole task rests on

Write two files. **⚠ FORWARD SLASHES IN THE JSON.** A backslash inside a JSON string is an escape;
the kickoff's first attempt used Windows paths and **silently loaded no hooks at all** — no error, no
hook, a probe that looks like a negative result and is not.

`%TEMP%\6b1\dump.js` — a hook command that reads stdin and writes nothing to stdout:

```js
// ⚠ PRINTS NOTHING. A hook command's stdout is a control channel (claude.ts:215
// is in the codebase for this reason). Append to a file and exit 0.
const fs = require('fs')
let b = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (c) => (b += c))
process.stdin.on('end', () => {
  fs.appendFileSync('C:/Users/<you>/AppData/Local/Temp/6b1/bodies.jsonl', b.trim() + '\n')
  process.exit(0)
})
```

`%TEMP%\6b1\hooks.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "", "hooks": [ { "type": "command", "command": "node C:/Users/<you>/AppData/Local/Temp/6b1/dump.js" } ] }
    ],
    "PostToolUse": [
      { "matcher": "", "hooks": [ { "type": "command", "command": "node C:/Users/<you>/AppData/Local/Temp/6b1/dump.js" } ] }
    ],
    "PostToolUseFailure": [
      { "matcher": "", "hooks": [ { "type": "command", "command": "node C:/Users/<you>/AppData/Local/Temp/6b1/dump.js" } ] }
    ]
  }
}
```

Two runs. **Probe A — the built-in exploration names** (any directory; MCP off so the stream is
clean):

```powershell
claude -p --model haiku --no-session-persistence --strict-mcp-config `
  --settings C:/Users/<you>/AppData/Local/Temp/6b1/hooks.json `
  "List the files in this directory and then read one of them."
```

**Probe B — the MCP tool name** (from the repository root, `chorus-g2-neo4j` **running**, the
project's `.mcp.json` passed explicitly so `--strict-mcp-config` still permits it):

```powershell
docker start chorus-g2-neo4j
claude -p --model haiku --no-session-persistence --mcp-config .mcp.json --strict-mcp-config `
  --settings C:/Users/<you>/AppData/Local/Temp/6b1/hooks.json `
  "Using the chorus-memory tool, run the Cypher query: RETURN 1 AS ok"
```

Then:

```powershell
Get-Content C:\Users\<you>\AppData\Local\Temp\6b1\bodies.jsonl |
  ForEach-Object { $o = $_ | ConvertFrom-Json; "$($o.hook_event_name)`t$($o.tool_name)" }
```

**What must come back, and what to do with each answer:**

- `PostToolUse` carries `tool_name` as a plain string. **If it does not, STOP and report** — the
  design's one field is gone and that is a decision, not a substitution.
- The kickoff measured `mcp__chorus-memory__read_neo4j_cypher` **verbatim** on both edges, plus
  `tool_use_id`, `tool_input`, and on `PostToolUse` `tool_response` + `duration_ms`. Confirm the
  prefix spelling — the code derives it from `CHORUS_MEMORY_SERVER` (`memoryService.ts:200` =
  `'chorus-memory'`), so `mcp__` + name + `__` is the assumption to check.
- **Write down every built-in name you observe, and PASTE THE LIST INTO THE REPORT.** The kickoff saw
  `Read`, `Glob`, `Grep`, `Bash`, `Agent`, `ToolSearch`, `WebFetch`. `LS` was **not** observed on
  2.1.235 — keep it in the set anyway: a name that never arrives costs nothing, and a name that
  returns would otherwise be missed.

  **⚠ D173 MADE THIS LIST LOAD-BEARING RATHER THAN ADVISORY, AND IT NOW SEEDS THREE SETS, NOT ONE.**
  The observed names are sorted into: the **pass/fail exploration set** (`Read`, `Glob`, `Grep`, `LS`
  and the delegation tool — **`Agent` is the kickoff's name and the council flagged that it was `Task`
  within living memory, so the installed CLI decides, not this line**); the **shell set** (`Bash`);
  and the **known-but-not-exploration set** (`ToolSearch`, `WebFetch`, `Write`, `Edit`, and whatever
  else the probe printed). A name in **none** of those is *unknown*, and an unknown before the first
  memory read makes the session **inconclusive** — so an over-narrow known set costs inconclusive
  sessions (honest, recoverable) while an over-broad one costs a silent pass (the failure D173
  removed). **Record which observed name seeded which set.**
- **⚠ `ToolSearch` MUST APPEAR BEFORE THE MCP TOOL IN PROBE B.** That is F92, and it is why
  `ToolSearch` is not exploration. If your run does not show it, say so — it means MCP tools are no
  longer deferred and 6b-2's contract can drop a sentence.
- **If probe B produces `PreToolUse` and then a permission denial with no `PostToolUse`**, that is
  not a failure: **capture it, because it is exactly the negative drive** the task requires (an
  attempt the user denied is not a read). Then re-run with the tool allowed to get the positive case.

**⚠ MEASURED FACT — `PostToolUse` MEANS THE CALL SUCCEEDED (D173, 2026-08-19, claude 2.1.235).**
This is the one item CR-6b.0 ranked first as [UNVERIFIED] and it was **settled by measurement the same
day, not by argument**. Evidence: `_verify/6b-4/hookprobe/ptf.log` and `_verify/6b-4/hookprobe/ptu.log`.

- A `chorus-memory` call carrying a **deliberately broken Cypher** fired **`PostToolUseFailure`**,
  body keys: `cwd`, `duration_ms`, `error`, `hook_event_name`, `is_interrupt`, `permission_mode`,
  `prompt_id`, `session_id`, `tool_input`, `tool_name`, `tool_use_id`, `transcript_path`.
- The **well-formed** call fired **`PostToolUse`** (no `error`, no `is_interrupt`; it carries
  `tool_response` instead).

**The consequence runs through this whole document: a `PostToolUse` count is a SUCCESSFUL-TOOL-RESULT
count.** So the metric is labelled **"successful memory reads"** and **"memory writes (tool-level)"** —
never "memory tool calls", which is what the counters would have been worth had the split not been
measured. And the write-side label keeps its limit attached wherever it appears: **the validator is
the write-side truth**, because a successful `write_neo4j_cypher` is still not a *sourced* memory
(D173 Q5 — `MATCH … CREATE` creates nothing when the match is empty and the tool reports success
anyway; that is 6b-2's problem, not this task's, but the label is written here).

**⚠ `PostToolUseFailure` IS STILL NOT COUNTED.** The measurement changes what a `PostToolUse` count
*means*; it does not add a second counted edge. **Probe C, and run it:** re-issue probe B with a
syntactically invalid Cypher and confirm the two event names on **this** machine's CLI — if the split
has gone, the "successful" label is no longer earned and that is a **STOP and report**, not a
rewording.

### (2b) The known-tool census — new in the D173 amendment

Probe A's prompt exercises exploration only. **Add a third probe whose prompt makes claude reach for
tools outside that set** (a todo list, a web search, a file edit, a delegated sub-task), and record
every `tool_name` it prints. Those names are the seed for `KNOWN_NON_EXPLORATION_TOOLS` in §1. The
point is not completeness — it cannot be complete — but that **every name this build has actually
seen is classified, so INCONCLUSIVE fires on genuine drift rather than on ordinary work.**

### (3) v21 is free — G6, three ways, at the moment of writing

```powershell
# (a) this tree
node -e "const ts=require('typescript'),fs=require('fs');const p='src/main/services/storage.ts';const sf=ts.createSourceFile(p,fs.readFileSync(p,'utf8'),ts.ScriptTarget.Latest,true);let i=null;const w=n=>{if(ts.isVariableDeclaration(n)&&n.name.text==='MIGRATIONS')i=n.initializer;ts.forEachChild(n,w)};w(sf);console.log('MIGRATIONS.length =',i.elements.length)"   # expect 20

# (b) every sibling ref — dev worktrees share ONE database (storage.ts:775-788)
foreach ($r in (git for-each-ref --format='%(refname:short)' refs/heads refs/remotes)) {
  $f = Join-Path $env:TEMP "st-$($r -replace '[\\/]','_').ts"
  git show "${r}:src/main/services/storage.ts" 2>$null | Set-Content -Encoding UTF8 $f
  if (Test-Path $f) {
    $n = node -e "const ts=require('typescript'),fs=require('fs');const p=process.argv[1];const sf=ts.createSourceFile(p,fs.readFileSync(p,'utf8'),ts.ScriptTarget.Latest,true);let i=null;const w=x=>{if(ts.isVariableDeclaration(x)&&x.name.text==='MIGRATIONS')i=x.initializer;ts.forEachChild(x,w)};w(sf);console.log(i?i.elements.length:'n/a')" $f
    "$r -> $n"
  }
}

# (c) both real databases (see §9 for the reader script and the WAL warning)
#     dev:       %APPDATA%\chorus\chorus.db
#     installed: %APPDATA%\chorus-app\chorus.db
#     SELECT MAX(version) FROM schema_migrations   -- expect 20 on both
```

**If any of the three comes back ≥ 21, STOP and report the divergence** rather than renumbering. A
version claimed on a branch you cannot see fails **silently**: the runner keys off `MAX(version)`
(`storage.ts:3392`), so your v21 is skipped without a word and the first read of a missing column
throws `no such column` out of whichever query touches it first, at boot.

### (4) The `sessions` DDL as it exists on this machine

```sql
SELECT sql FROM sqlite_master WHERE type='table' AND name='sessions';
```

Confirm the **14** columns match `schema.ts:68`–`:130`, and that **none of the five** — `memory_reads`,
`memory_writes`, `memory_read_first`, `memory_read_inconclusive`, `memory_shell_first` (D173) — is
already there.

### (5) The baseline gates

```powershell
npm run typecheck ; npx vitest run ; npm run grep:secrets
```

`0` · `2618 / 2618 across 74 files` · clean (6 patterns). Record what you actually get; every later
"≥ 2618" claim is measured against **your** number, not this one.

---

## §1 — `src/main/services/agentEventsCore.ts`

**Placement rationale:** the reader and both classifiers are pure string work over an untrusted body,
which is precisely what this module is for — `parseHookPath`, `readHookEventName` and
`readTranscriptPath` all live here so the rejection cases are unit-testable without binding a port
(`:184`–`:186` says so). Nothing new goes into `agentEvents.ts` that could have gone here.

### The one import

```ts
import { CHORUS_MEMORY_SERVER } from './memoryService'
```

**⚠ THE SERVER NAME IS IMPORTED, NEVER RE-TYPED.** This is 6a-1's rule verbatim
(`ImplementationSpec-6a-1.md` §1): a second spelling would classify a tool the config does not
produce, and the failure is a counter that stays at zero while the agent is using the graph. The
import is node-safe — `instructionsCore.ts` (a pure core with no `fs` and no Electron) already does
it, and `instructionsCore.test.ts` proves it loads under Vitest's `environment: 'node'`.

### The constant sets — placed after `NEEDS_YOU_EVENTS` (`:121`)

**⚠ D173 TOOK THIS FROM THREE SETS TO FIVE.** `Bash` left the exploration set for a set of its own,
and a `KNOWN_NON_EXPLORATION_TOOLS` set arrived so that "unknown" is a decidable category rather than
"anything my `if` chain fell through".

```ts
/**
 * Claude's tool-name prefix for an MCP server's tools, DERIVED rather than
 * typed: measured 2026-08-19 on claude 2.1.235 as
 * `mcp__chorus-memory__read_neo4j_cypher`.
 */
const CHORUS_MEMORY_TOOL_PREFIX = `mcp__${CHORUS_MEMORY_SERVER}__`

/** The server's read tools. `get_neo4j_schema` counts as a read because it is
 *  the agent asking the graph what it holds — the behaviour the milestone is
 *  measuring — even though it returns no data rows. */
const MEMORY_READ_TOOLS: readonly string[] = ['read_neo4j_cypher', 'get_neo4j_schema']

/** The server's one write tool. `write_neo4j_cypher` has been called ZERO times
 *  in this machine's entire transcript history (Phase 6b kickoff, 384 files) —
 *  which is the finding this counter exists to make visible rather than
 *  archaeological. */
const MEMORY_WRITE_TOOLS: readonly string[] = ['write_neo4j_cypher']

/**
 * Claude's built-in tools that mean "the agent has started looking at the
 * filesystem". FIXED, and D4-verified against the installed CLI at execution.
 *
 * ⚠ `ToolSearch` IS DELIBERATELY ABSENT, AND THIS IS THE SINGLE MOST
 * LOAD-BEARING OMISSION IN THIS FILE. F92: claude 2.1.235 DEFERS MCP tools
 * behind `ToolSearch`, so an agent must call `ToolSearch` before it can call
 * `mcp__chorus-memory__read_neo4j_cypher` at all. Counting `ToolSearch` as
 * exploration would put an exploration ordinal in front of EVERY memory read
 * that has ever happened — `memory_read_first` would be 0 for every session
 * forever, the phase's binary milestone could never pass, and every unit test
 * here would still be green. It is excluded by MEASUREMENT, not by taste.
 *
 * ⚠ `WebFetch` is absent for a smaller reason: it is the network, not the
 * filesystem. ⚠ `Write` and `Edit` are absent because they are not exploration;
 * an agent that edits before reading the graph has a different problem. D173
 * REFUSED to add them: doing so would silently change the milestone from
 * "before filesystem exploration" to "before repository interaction".
 *
 * ⚠ `Bash` IS ABSENT, AND THIS REVERSES AN EARLIER DRAFT OF THIS FILE (D173,
 * CR-6b.0 Q3). The earlier argument was that including `Bash` makes the bar
 * STRICTER, which is the safe direction. The council's counter is decisive and
 * turns THIS TASK'S OWN LIMIT against it: because Chorus deliberately never
 * reads `tool_input`, `npm test`, `git status`, `docker ps` and `ls` are the
 * SAME EVENT here. Treating every shell call as exploration would depress the
 * metric for work that never explored anything — and because this metric GATES
 * 6b-4's escalation decision, a depressed metric does not merely misreport, it
 * triggers an intervention nobody's behaviour warranted. `Bash` moves to
 * SHELL_TOOLS below and becomes a DIAGNOSTIC, never a pass/fail input.
 *
 * `LS` is kept although claude 2.1.235 was not observed emitting it: a name that
 * never arrives costs one string comparison, and one that comes back would
 * otherwise be missed in silence.
 *
 * ⚠ THE DELEGATION TOOL'S NAME IS MEASURED, NOT QUOTED. `Agent` is what the
 * kickoff observed on 2.1.235; the council flagged that the same tool was
 * `Task` within living memory. §0 decides this literal, and the measured name
 * goes in the implementer's report.
 */
const EXPLORATION_TOOLS: readonly string[] = ['Read', 'Glob', 'Grep', 'LS', 'Agent']

/**
 * The shell. ONE MEMBER TODAY, AND A SET ANYWAY, so an alias or a rename lands
 * in one place instead of behind a `=== 'Bash'` scattered through a branch.
 *
 * ⚠ THIS SET FEEDS THE DIAGNOSTIC AND NOTHING ELSE. It must not be reachable
 * from the pass/fail derivation in `toUsage`, and a reviewer should be able to
 * prove that by grepping every use of `isShellTool`. `Bash` before the first
 * memory read is INTERESTING — it is D173's acknowledgement that `Bash` really
 * is a filesystem escape hatch — but it is shown as an aggregate diagnostic and
 * never decides whether a session passed.
 */
const SHELL_TOOLS: readonly string[] = ['Bash']

/**
 * Names this build HAS SEEN and has deliberately decided are not exploration.
 * Seeded from §0's census on the installed CLI (§0(2) and §0(2b)).
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
const KNOWN_NON_EXPLORATION_TOOLS: readonly string[] = ['ToolSearch', 'WebFetch', 'Write', 'Edit']
```

### The reader — placed immediately after `readTranscriptPath` (`:253`)

```ts
/**
 * The tool's NAME off a `PostToolUse` body, and nothing else from the tool call
 * (D168).
 *
 * ⚠ WHAT THIS DOES NOT READ IS THE POINT. `tool_input` is the Cypher the agent
 * wrote and `tool_response` is graph content; both are user/agent content and
 * neither is touched here or anywhere else. `tool_use_id` is not read either —
 * it would let a name be correlated across events, which is a capability this
 * feature has no use for.
 *
 * ⚠ A LENGTH CAP AND NO CHARSET CHECK, for the reason `readTranscriptPath`
 * gives one file down: validation beyond the cap would be theatre. The value's
 * only fate is a comparison against the fixed sets and then the garbage
 * collector — a name that matches nothing does nothing. 128 is far above every
 * observed name (the longest measured is 36 characters) and far below anything
 * that could pressure main's heap.
 */
export function readToolName(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  const name = (body as Record<string, unknown>).tool_name
  if (typeof name !== 'string' || name.length === 0 || name.length > 128) return null
  return name
}
```

### The four classifiers — two from D168, two added by D173

```ts
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
 */
export function classifyMemoryTool(name: string): 'read' | 'write' | null {
  if (!name.startsWith(CHORUS_MEMORY_TOOL_PREFIX)) return null
  const tool = name.slice(CHORUS_MEMORY_TOOL_PREFIX.length)
  if (MEMORY_READ_TOOLS.includes(tool)) return 'read'
  if (MEMORY_WRITE_TOOLS.includes(tool)) return 'write'
  return null
}

/** Membership in the fixed set above. Case-sensitive by design, exactly as
 *  `classifyHookEvent` is (`agentEventsCore.test.ts:56` pins `'stop'`). */
export function isExplorationTool(name: string): boolean {
  return EXPLORATION_TOOLS.includes(name)
}

/** D173: the shell-before-first-read DIAGNOSTIC's input, and nothing else.
 *  Never called from the pass/fail derivation. */
export function isShellTool(name: string): boolean {
  return SHELL_TOOLS.includes(name)
}

/**
 * D173: does this build recognise the name at all?
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
```

### The docblock amendment — `readHookEventName` (`:204`–`:218`)

`:209`–`:212` already carries **one** correction ("THIS USED TO SAY 'ONLY `hook_event_name` IS
READ'"). Add the second in the same voice, and **narrow the paragraph at `:214`–`:217`**, which today
lists *"tool inputs"* among the things "still deliberately NOT extracted" — true of the input, false
of the name, and a reader would conclude the tool call is untouched.

Replacement for that paragraph:

```
 * ⚠ AND IT NOW READS A THIRD, `tool_name` — see `readToolName` below, added for
 * the memory-usage counters (D168). The NAME only: it is compared against two
 * fixed sets and dropped in the same expression, and no name is stored, logged,
 * broadcast or persisted anywhere in this application.
 *
 * Everything else in the payload is still deliberately NOT extracted:
 * `tool_input` (the arguments — the agent's own Cypher, a file path, a shell
 * command), `tool_response` (what the tool returned), `prompt`,
 * `last_assistant_message`, `tool_use_id`. That is the user's source code and
 * conversation content; it would have to be scrubbed and stored to be useful,
 * and nothing here needs it. What is not taken cannot leak.
```

---

## §2 — `src/main/services/agentEvents.ts` — the header

**⚠ THIS EDIT IS NOT OPTIONAL AND IT IS NOT COSMETIC.** Point 5 of the security note (`:53`–`:56`)
currently reads *"**Two fields are read** … `hook_event_name` … and `transcript_path` … no tool input
is extracted, stored or logged"*, and the ⚠ beneath it (`:58`–`:66`) exists **because the last
widening left a stale claim standing**. Repeating that mistake in the file that documents it would be
the whole failure in miniature.

Replace point 5 and extend the ⚠, in `contextUsage.ts:24`–`:49`'s five-part shape — **what is taken,
what is never taken, where it is stored, what can leak, why it is acceptable**:

```
 *  5. **Three fields are read** off the body, and only three: `hook_event_name`
 *     (the lights), `transcript_path` (the context ring, v16) and `tool_name`
 *     (the memory-usage counters, v21/D168). No prompt text, no
 *     `last_assistant_message`, no `tool_input` and no `tool_response` is
 *     extracted, stored or logged.
 *
 *     ⚠ POINT 5 HAS NOW BEEN NARROWED TWICE. It first read "**Only
 *     `hook_event_name` is read** … no transcript path"; v16 made that false and
 *     corrected it; D168 makes the two-field version false and corrects it here.
 *     The history is KEPT rather than tidied, because the recurrence is the
 *     finding: this surface widens roughly once a phase, and each widening was
 *     believed at the time to be the last.
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
 *     a raw body would undo everything above it.** **Where the result is
 *     stored:** two counters and four ordinals per session, in memory beside
 *     `activity` and cleared by the same `revoke`; and five integer columns on
 *     the session's row (`memory_reads`, `memory_writes`, `memory_read_first`,
 *     `memory_read_inconclusive`, `memory_shell_first`). **What can leak:**
 *     nothing new. A tool's name is not user content, no file is opened (the
 *     `transcript_path` widening does open one and was accepted), and the body
 *     is still authenticated by the per-session capability token — so a hostile
 *     local process can at most inflate ITS OWN session's counters, which is a
 *     subset of the named limit below. That bound is an INTEGRITY bound, not a
 *     confidentiality one, and these counters are not adversarially tamper-proof
 *     (D173 Q1). **Why it is acceptable:** the alternative is reading the user's
 *     JSONL transcript to answer "did this agent use the graph", which is
 *     strictly more content for strictly less certainty.
 *
 *     ⚠ WHAT `PostToolUse` MEANS, MEASURED. A tool call that FAILED fires
 *     `PostToolUseFailure` instead (measured 2026-08-19 on claude 2.1.235: a
 *     broken Cypher produced `PostToolUseFailure` carrying an `error` key, the
 *     well-formed call produced `PostToolUse` — `_verify/6b-4/hookprobe/`). So
 *     these counters are SUCCESSFUL-tool-result counts, and they are labelled
 *     that way everywhere they surface. The residual limit is stated with them:
 *     a successful WRITE call is not yet a SOURCED memory — the validator is the
 *     write-side truth.
```

---

## §3 — `src/main/services/agentEvents.ts` — the record, the listener, the count

### The record type — beside `AgentActivityRecord` (`:85`–`:94`)

```ts
/**
 * What main remembers about one session's use of the memory graph.
 *
 * ⚠ ORDINALS, NOT TIMESTAMPS. "Did a graph read happen before filesystem
 * exploration" is a question about ORDER, and a clock answers it worse: two tool
 * calls in the same millisecond are common over a hook bus, and `Date.now` is
 * already stubbed in this module's tests for exactly that reason
 * (`agentEvents.test.ts:16`-`:19`). `ordinal` counts `PostToolUse` RECEIPTS —
 * every one, whatever the tool — so the two "first" fields are directly
 * comparable.
 *
 * ⚠ NO TOOL NAME IS IN THIS TYPE, AND THAT IS THE INVARIANT A REVIEWER SHOULD
 * TEST HARDEST. If a `string` field ever appears here, D168's limit has been
 * crossed. Note in particular that the INCONCLUSIVE flag records only THAT an
 * unknown tool ran, never WHICH — the ordinal is the whole permitted output of
 * that branch.
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
```

### The listener type — beside `TranscriptPathListener` (`:112`–`:123`)

```ts
/**
 * D168: called with this session's memory-usage snapshot whenever the snapshot
 * CHANGES.
 *
 * ⚠ THE DISTINCTION THAT MATTERS, AND THE ONE THIS PHASE WILL BE JUDGED ON:
 * the COUNTERS are incremented on EVERY `PostToolUse` receipt, unconditionally,
 * before `record()` and its edge filter (`:198`) can collapse anything — that is
 * D168's requirement and F55/F56 are why. What is edge-gated is only the
 * NOTIFICATION: a receipt that leaves all FIVE broadcast facts — `reads`,
 * `writes`, `readBeforeExplore`, `readInconclusive`, `shellFirst` — unchanged
 * (i.e. almost every tool call an agent makes) fires nothing,
 * because forwarding it would put an IPC message and a SQLite write behind every
 * tool call — the failure `ipc.ts:4476`-`:4480` describes for the activity
 * stream, in a place where it would be much more expensive.
 *
 * ⚠ SAME CONTRACT AS `TranscriptPathListener`: it must not throw and must not
 * block. It is invoked from inside the hook request handler, which Claude Code
 * waits on.
 */
export type MemoryUsageListener = (sessionId: string, usage: SessionMemoryUsage) => void
```

with a **type-only** import at the top of the file:

```ts
import type { SessionMemoryUsage } from '../../shared/ipc'
```

**Rationale:** `contextUsage.ts:3` already imports `SessionContextUsage` from `shared/ipc` for the
same reason — the broadcast shape is declared once, so the tracker cannot drift from the schema that
validates it. It is type-only, so it adds nothing at runtime.

### The map and the listener set — inside `createAgentEventListener` (`:168`–`:175`)

```ts
  const memoryUsage = new Map<string, MemoryUsageRecord>()
  const memoryListeners = new Set<MemoryUsageListener>()
```

### The counting block — in `handle()`'s `end` callback

**⚠ EXACT POSITION: after the transcript-path block closes at `:287`, and before
`const eventName = readHookEventName(body)` at `:289`.** It reads the event name itself (the same
call, one line earlier) so the block is self-contained and provably ahead of the classification gate
at `:290`, the `classifyHookEvent` gate at `:294`, and `record()` at `:297`.

```ts
      // D168: the memory-usage counters, taken off the RAW RECEIPT and
      // deliberately BEFORE `record()` below.
      //
      // ⚠ IF THIS BLOCK EVER MOVES BELOW `record()`, THE FEATURE BECOMES A LIE
      // THAT PASSES ITS OWN TESTS. `record()`'s early return at the top of this
      // file collapses twenty consecutive tool calls into ONE callback (F55,
      // F56); a count taken after it would report "1 read" for a session that
      // made twenty. `onTranscriptPath` above is the same shape for the same
      // reason.
      //
      // `PostToolUse` ONLY, compared with `===`. `PreToolUse` is an ATTEMPT —
      // one the user may deny — and an attempt is not a read. `PostToolUseFailure`
      // is a SEPARATE NAME that shares the prefix (agentEventsCore.ts:66), so a
      // `startsWith` here would count failures as reads.
      //
      // ⚠ AND THE SPLIT IS WHAT EARNS THE WORD "SUCCESSFUL" IN THE UI. Measured
      // 2026-08-19 on claude 2.1.235: a broken Cypher fired `PostToolUseFailure`
      // (with an `error` key), the well-formed call fired `PostToolUse`
      // (`_verify/6b-4/hookprobe/ptf.log`, `ptu.log`). So this `===` is not only
      // a naming precaution — it is the reason `memoryUsageLine` may say
      // "successful memory reads" at all. Widen it and that label becomes false.
      const rawEvent = readHookEventName(body)
      if (rawEvent === 'PostToolUse') {
        noteToolUse(sessionId, readToolName(body))
      }
```

and the helper, placed beside `record` (`:181`):

```ts
  /**
   * One completed tool call, classified and counted.
   *
   * ⚠ THE NAME DIES IN THIS FUNCTION. It arrives as a parameter, is passed to
   * two pure classifiers, and is never assigned, stored, logged or returned.
   * There is no branch in here that can put it anywhere.
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
        // It makes the ordering result INCONCLUSIVE instead.
        if (rec.firstUnknownOrdinal === null) rec.firstUnknownOrdinal = rec.ordinal
      }
      // A KNOWN non-exploration tool (`ToolSearch`, `WebFetch`, `Write`,
      // `Edit`, a future `chorus-memory` tool) falls through deliberately: it
      // moves nothing. `ToolSearch` reaching this line rather than the
      // exploration branch is F92's whole point.
    }
    memoryUsage.set(sessionId, rec)

    // The edge — on the BROADCAST payload, never on the counters above.
    const next = toUsage(rec)
    if (previous && sameUsage(previous, next)) return   // see note below
    for (const listener of memoryListeners) {
      try {
        listener(sessionId, next)
      } catch (err) {
        // One bad listener must not stop the others and must never take down the
        // HTTP request that is mid-flight (the `record()` rule, verbatim).
        logger.error({ err }, '[agent-events] memory usage listener threw')
      }
    }
  }
```

**Note on `previous`:** capture `toUsage(rec)` **before** mutating, or keep a `lastSent` field on the
record. The sketch above is deliberately incomplete on that point so the implementer chooses one and
writes it clearly — **the requirement is that the suppression compares only the five broadcast
fields**, never the ordinals, and that it never gates the increments.

```ts
/** The wire projection. ⚠ THE ORDINALS DO NOT CROSS THE BRIDGE: they are an
 *  internal mechanism, and the three derived flags are the only things anyone
 *  outside this module needs from them.
 *
 *  ⚠ D173'S THREE-WAY ORDERING RESULT, WRITTEN OUT ONCE HERE SO IT CANNOT BE
 *  RE-DERIVED DIFFERENTLY ANYWHERE ELSE:
 *    · PASS          — a COMPLETED memory read exists, AND it precedes the
 *                      first KNOWN exploration call (or none occurred), AND no
 *                      UNKNOWN tool preceded it;
 *    · INCONCLUSIVE  — a COMPLETED memory read exists, nothing in the known
 *                      exploration set preceded it, BUT an unknown tool did;
 *    · NOT PASSED    — everything else.
 *  The two flags are mutually exclusive by construction; assert that.
 */
function toUsage(rec: MemoryUsageRecord): SessionMemoryUsage {
  // ⚠ TRUE ONLY IF A READ ACTUALLY HAPPENED. A session that explored nothing
  // AND read nothing must not read as "read first" — that would make the
  // milestone's first clause pass on a session that did nothing at all.
  //
  // ⚠ THIS CLAUSE IS ORIGINAL, NOT A D173 REPAIR. The council's "vacuous pass"
  // objection was against the BRIEF's one-line summary of this rule; the rule
  // itself already required `firstReadOrdinal !== null` and D173 cites it
  // rather than changing it. Do not "fix" it a second time.
  const readExists = rec.firstReadOrdinal !== null
  const beforeKnownExplore =
    rec.firstExploreOrdinal === null || (rec.firstReadOrdinal as number) < rec.firstExploreOrdinal
  const unknownFirst =
    rec.firstUnknownOrdinal !== null &&
    (!readExists || rec.firstUnknownOrdinal < (rec.firstReadOrdinal as number))

  return {
    reads: rec.reads,
    writes: rec.writes,
    readBeforeExplore: readExists && beforeKnownExplore && !unknownFirst,
    // D173: never a silent pass. An unknown tool that ran before the first read
    // means this build cannot say whether the agent explored first — so it says
    // so, rather than failing open in the agent's favour.
    readInconclusive: readExists && beforeKnownExplore && unknownFirst,
    // D173: the DIAGNOSTIC. Not a pass/fail input, and never combined with the
    // two flags above into a single verdict anywhere downstream.
    shellFirst:
      rec.firstShellOrdinal !== null &&
      (!readExists || rec.firstShellOrdinal < (rec.firstReadOrdinal as number))
  }
}
```

**⚠ All three derived flags are MONOTONE, and that is what makes the row's `MAX()` write safe rather
than merely convenient.** Each is built from set-once ordinals, so once `true` no later receipt can
make it `false`: a later exploration call cannot precede a read that already happened, a later unknown
tool arrives after the read, and a later shell call cannot move a `firstShellOrdinal` already set.
`MAX()` on the row then enforces the same property across a **restart**, where main's in-memory record
starts empty (D173 Q2's set-once requirement, satisfied at both levels).

### The interface additions (`:135`–`:166`)

```ts
  /** D168: this session's memory-graph usage, or null when it has reported no
   *  completed tool call. ABSENT IS NOT ZERO — the same rule the context ring
   *  states at `stores/session.ts:63`-`:68`. */
  memoryUsageFor(sessionId: string): SessionMemoryUsage | null
  /** D168: fired when a session's memory usage CHANGES. Not edge-gated on the
   *  activity map — see `MemoryUsageListener`. */
  onMemoryUsage(listener: MemoryUsageListener): () => void
```

implemented beside `recordFor` (`:349`) and `onTranscriptPath` (`:377`).

### Cleanup

- `revoke` (`:338`–`:343`): add `memoryUsage.delete(sessionId)` **beside `activity.delete`** at
  `:342`. A revoked session's live counters are gone for the same reason its activity is: the token
  is dead and the row is the durable record.
- `dispose` (`:382`–`:394`): `memoryUsage.clear()` and `memoryListeners.clear()` beside their
  siblings at `:385`–`:387`.

---

## §4 — `src/main/db/schema.ts` + the v21 migration

### `schema.ts` — after `agentSessionId` (`:129`)

```ts
  // v21 (Phase 6b / D168): what this session did with the project's memory
  // graph, counted from the agents' own `PostToolUse` hook receipts.
  //
  // ⚠ `NOT NULL DEFAULT 0`, WHICH IS v15's RULING AND NOT v17's, AND THE
  // DIFFERENCE IS WHETHER ZERO IS TRUE. `locked_at` took NULL-with-no-default
  // because "the time this was locked" DOES NOT EXIST for an unlocked session
  // and a sentinel would be a lie (storage.ts:790-796). A session that made no
  // graph calls really did make ZERO of them — 0 is the measurement, not a
  // stand-in for one — and every pre-v21 row reads 0 truthfully too, because it
  // ran before the instrument existed and the aggregate excludes it by date.
  // ⚠ "SUCCESSFUL", NOT "ATTEMPTED", AND THAT IS MEASURED: a failed tool call
  // fires `PostToolUseFailure`, which is a separate event name and is not
  // counted (D173, `_verify/6b-4/hookprobe/`). `memory_writes` is a TOOL-LEVEL
  // count — a successful write call is not yet a SOURCED memory, and the
  // validator remains the write-side truth.
  memoryReads: integer('memory_reads').notNull().default(0),
  memoryWrites: integer('memory_writes').notNull().default(0),
  // ⚠ 0/1 RATHER THAN A BOOLEAN, because SQLite has no boolean and the rest of
  // this schema stores flags nowhere else — these are the first. 1 means "a
  // chorus-memory read happened before this session's first filesystem
  // exploration tool", which is the milestone's first clause verbatim.
  //
  // ⚠ SET-ONCE (D173 Q2): every write goes through MAX(), so a 1 can never be
  // overwritten by a 0 — including by a restart, whose fresh in-memory record
  // starts at zero.
  memoryReadFirst: integer('memory_read_first').notNull().default(0),
  // v21 / D173: the third state. 1 means "a completed call to a tool this build
  // does not recognise ran before the first memory read", so the ordering
  // question has no answer for this session. It is NOT a failure and NOT a
  // pass; a row with `memory_read_first = 0` and `memory_read_inconclusive = 1`
  // is the instrument declining to guess, and the two are mutually exclusive by
  // construction in `agentEvents.ts`.
  //
  // ⚠ THE FLAG RECORDS THAT AN UNKNOWN TOOL RAN, NEVER WHICH ONE. There is no
  // column here for a name and there must never be.
  memoryReadInconclusive: integer('memory_read_inconclusive').notNull().default(0),
  // v21 / D173: the shell-before-first-read DIAGNOSTIC. `Bash` left the
  // pass/fail exploration set because without `tool_input` — which Chorus never
  // reads — `npm test` and `ls` are the same event, and this metric gates
  // 6b-4's escalation. The signal is kept because a shell call really can be a
  // filesystem escape hatch; it is shown as an aggregate and NEVER joined to
  // the two flags above into a verdict.
  memoryShellFirst: integer('memory_shell_first').notNull().default(0)
```

### `storage.ts` — the v21 entry, appended after v20 (`:943`) and before the closing `]` (`:944`)

```ts
  ,
  // v21 (Phase 6b / D168, amended by D173): the memory-usage counters. FIVE
  // columns on `sessions`, no new table, no index, no FK.
  //
  // ⚠ THE NUMBER WAS COMPUTED, NOT COPIED (G6, and the v16 collision at :775
  // above is why). At <SHA> `MIGRATIONS.length` parsed to 20 with the TypeScript
  // AST; the dev DB and the installed DB both reported `MAX(version) = 20`; and
  // every sibling ref parsed to <list them>. A version claimed on a branch you
  // cannot see fails SILENTLY here, because the runner keys off MAX(version).
  //
  // ⚠ FIVE STATEMENTS IN ONE ENTRY, the shape v14 already uses (:641-:642) —
  // they are one schema change and must apply or fail together, and the runner
  // wraps each entry in a transaction (:3397). ⚠ ONE ENTRY, NOT TWO: splitting
  // the three D168 columns from the two D173 ones would claim v22 as well, and
  // nothing has ever run against a three-column v21.
  //
  // ⚠ NOT NULL DEFAULT 0 — see schema.ts for why zero is the truth here and was
  // refused for `locked_at`. NO INDEX: every read is by primary key or the
  // per-project scan the rail already runs over these rows.
  `ALTER TABLE sessions ADD COLUMN memory_reads INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE sessions ADD COLUMN memory_writes INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE sessions ADD COLUMN memory_read_first INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE sessions ADD COLUMN memory_read_inconclusive INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE sessions ADD COLUMN memory_shell_first INTEGER NOT NULL DEFAULT 0;`
```

**Fill `<SHA>` and `<list them>` with what §0(3) actually printed.** A comment that says "verified"
without the numbers is the thing G6 exists to stop.

### `createSession` (`:1618`–`:1648`)

The five columns are `NOT NULL DEFAULT 0`, so SQLite fills them — but the **returned object** would
carry `undefined` where a re-read gives `0`, which is the exact mismatch `:1634`–`:1646` normalises
for four other columns. Add, in the same style and with a one-line reason:

```ts
      // v21: normalised for the reason every line above it is — the returned row
      // must match what a re-read would give. A NEW session has made no graph
      // calls, and 0 says so. All five, D173's two included: a session that has
      // reported nothing is not "inconclusive" and has run no shell command.
      memoryReads: row.memoryReads ?? 0,
      memoryWrites: row.memoryWrites ?? 0,
      memoryReadFirst: row.memoryReadFirst ?? 0,
      memoryReadInconclusive: row.memoryReadInconclusive ?? 0,
      memoryShellFirst: row.memoryShellFirst ?? 0
```

---

## §5 — `src/main/services/storage.ts` — the two accessors

Placed in their own commented block **after** the v19 resume-pointer block (`:1711`–`:1754`), whose
banner comment is the template.

### The write

```ts
  /**
   * Persist one session's memory-graph counters (v21 / D168).
   *
   * ⚠ MONOTONIC ON PURPOSE — `MAX(column, ?)`, never `= ?` and never `+ 1`.
   *   · `= ?` would go BACKWARDS after a `session:restart`: `retireHooks`
   *     revokes the token (sessionManager.ts:396), which clears main's
   *     in-memory record, so the next registration starts at zero and would
   *     overwrite a real 12 with a real 0.
   *   · `+ 1` would DOUBLE-COUNT on any retry, and would need delta
   *     bookkeeping in a second place that could disagree with the first.
   *   · `MAX` is idempotent, needs no bookkeeping anywhere, and can only ever
   *     be wrong in ONE direction.
   *
   * ⚠ AND `MAX` IS WHAT MAKES THE THREE FLAGS SET-ONCE AT THE ROW LEVEL (D173
   * Q2). A 1 can never be overwritten by a 0, whatever a later registration
   * believes — which is the durable half of the guarantee `toUsage`'s set-once
   * ordinals give inside one registration.
   *
   * ⚠ CALLED PER RECEIPT (D173 Q2). Every receipt that moves any of the five
   * values writes immediately; a receipt that moves none would write identical
   * numbers, so the edge gate upstream suppresses it and loses nothing. That
   * keeps the loss window ONE RECEIPT wide.
   *
   * ⚠ AND THE DIRECTION IT IS WRONG IN IS WRITTEN DOWN: a session that is
   * restarted mid-life keeps the HIGHEST registration's numbers rather than the
   * sum of all of them, so a restarted session UNDER-reports. Per-receipt
   * writing NARROWS that window; it does NOT close it, so the aggregate is a
   * LOWER BOUND and the Memory section says so in words (D173 Q2). Under-count
   * is the safe direction for a number this phase quotes as evidence — a
   * milestone must not be able to pass on an inflated count — and it matches
   * how the context ring treats a restart as a new conversation
   * (stores/session.ts:112-118).
   *
   * A missing row id is a zero-row no-op, matching `updateSessionStatus` and
   * `setAgentSessionId`.
   */
  setSessionMemoryUsage(
    id: string,
    usage: {
      reads: number
      writes: number
      readBeforeExplore: boolean
      readInconclusive: boolean
      shellFirst: boolean
    }
  ): void {
    this.db
      .prepare(
        `UPDATE sessions
            SET memory_reads             = MAX(memory_reads, ?),
                memory_writes            = MAX(memory_writes, ?),
                memory_read_first        = MAX(memory_read_first, ?),
                memory_read_inconclusive = MAX(memory_read_inconclusive, ?),
                memory_shell_first       = MAX(memory_shell_first, ?)
          WHERE id = ?`
      )
      .run(
        usage.reads,
        usage.writes,
        usage.readBeforeExplore ? 1 : 0,
        usage.readInconclusive ? 1 : 0,
        usage.shellFirst ? 1 : 0,
        id
      )
  }
```

### The aggregate read — and its denominator, which is the whole D55 question

```ts
/**
 * ⚠ A HISTORICAL CONSTANT, NOT `MIGRATIONS.length`. The version that introduced
 * the five counter columns never moves; `MIGRATIONS.length` moves every time
 * anyone adds a migration, and using it here would silently redefine the
 * aggregate's floor on the next unrelated schema change.
 */
const MEMORY_COUNTERS_VERSION = 21

  /**
   * One project's memory-graph usage, with the denominator that makes it a fact
   * (D55).
   *
   * ⚠ THE SET IS BOUNDED BELOW BY WHEN THE INSTRUMENT ARRIVED, AND THAT IS THE
   * ENTIRE REASON THIS QUERY IS NOT `WHERE project_id = ?` ALONE. Every session
   * that ran before v21 has `memory_reads = 0` because nothing was counting —
   * not because the agent read nothing. Including those rows would inflate the
   * denominator with sessions the numerator could never have come from, and the
   * sentence "0 reads across 47 sessions" would be a measurement of the
   * instrument's install date dressed up as a measurement of agent behaviour.
   * That is exactly the failure D55 exists to prevent, one level up from a bare
   * number.
   *
   * The floor is `schema_migrations.applied_at` for v21 — an exact timestamp
   * that already exists, written in the SAME TRANSACTION as the columns
   * (:3397-:3402), so a v21 row without the columns (or the reverse) is
   * impossible by construction and this query needs no fallback branch.
   * `sessions.created_at` and `applied_at` are both `new Date().toISOString()`
   * (ipc.ts:1547, :3401), so the string comparison is a chronological one.
   *
   * `since` is the OLDEST counted session, or the floor itself when none has run
   * yet — so the sentence always has a date to anchor its denominator to.
   *
   * ⚠ AND THE DENOMINATOR IS CLAUDE-CODE-SCOPED IN THE `WHERE` **AND** IN THE
   * LABEL, WHICH MOVE TOGETHER (D173 Q2). The finding is explicit:
   *
   *     "Codex sessions must not be counted as measured non-use merely because
   *      no equivalent hook instrument exists."
   *
   * A non-claude pane contributes a row whose five counters can only ever read
   * 0 — not because the agent ignored the graph, but because **Chorus cannot
   * instrument it at all**. Every non-claude adapter declares `hooks: null`
   * (`codex.ts:119`, `grok.ts:132`, `kimi.ts:118`, `opencode.ts:152`), and
   * grok's comment is the sharpest case: it documents a Claude-COMPATIBLE hook
   * bus but has no `--settings` flag, so there is nowhere to load the listener.
   * Counting those rows in K would be the pre-v21 mistake repeated along a
   * second axis — a denominator full of sessions the numerator could never have
   * come from.
   *
   * ⚠ SO THE FILTER AND THE SENTENCE ARE ONE CHANGE, NEVER TWO. `WHERE agent =
   * 'claude'` here, "K **Claude Code** sessions" in `memoryUsageLine`. A
   * filtered count under an unfiltered label — or the reverse — is the D55
   * failure with extra steps, and it is the single most likely way this line
   * rots. If a future agent kind gains a hook bus, this predicate and that
   * wording are edited in the same commit.
   *
   * ⚠ `agent` IS UNCONSTRAINED TEXT holding an `agentKindSchema` value
   * (`schema.ts:73`; `shared/ipc.ts:849` = `'claude' | 'codex' | 'grok' |
   * 'kimi' | 'opencode'`). The literal is compared, not validated — a row with
   * an unrecognised agent simply falls outside K, which is the correct
   * direction: unmeasurable is not measured non-use.
   *
   * ⚠ `memory_read_first` IS SUMMED HERE AFTER ALL. It is the milestone's
   * headline clause, and the per-row flag can answer "did THIS session read
   * first" but never "is this getting better" — a trend needs the roll-up, and
   * D55 is satisfied because it renders against the same K as everything else.
   * It joins the DIAGNOSTICS line rather than the headline, because D173 fixed
   * the headline's shape and that is not ours to extend.
   */
  getProjectMemoryUsage(projectId: string): {
    reads: number
    writes: number
    sessions: number
    since: string | null
    /** D173 + the read-first roll-up: diagnostics, all sharing `sessions`. */
    readFirst: number
    inconclusive: number
    shellFirst: number
  } {
    const floor = (
      this.db
        .prepare('SELECT applied_at AS at FROM schema_migrations WHERE version = ?')
        .get(MEMORY_COUNTERS_VERSION) as { at: string } | undefined
    )?.at
    if (!floor)
      return {
        reads: 0,
        writes: 0,
        sessions: 0,
        since: null,
        readFirst: 0,
        inconclusive: 0,
        shellFirst: 0
      }
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(memory_reads), 0)              AS reads,
                COALESCE(SUM(memory_writes), 0)             AS writes,
                COUNT(*)                                    AS sessions,
                MIN(created_at)                             AS since,
                COALESCE(SUM(memory_read_first), 0)         AS readFirst,
                COALESCE(SUM(memory_read_inconclusive), 0)  AS inconclusive,
                COALESCE(SUM(memory_shell_first), 0)        AS shellFirst
           FROM sessions
          -- ⚠ THREE PREDICATES, AND EACH ONE IS A DENOMINATOR DECISION.
          --   project_id : the scope the sentence claims;
          --   agent      : the only agent kind Chorus can instrument (D173 Q2);
          --   created_at : after the instrument existed (v21's applied_at).
          -- Dropping any one of them inflates K with sessions the numerator
          -- could never have come from.
          WHERE project_id = ? AND agent = 'claude' AND created_at >= ?`
      )
      .get(projectId, floor) as {
      reads: number
      writes: number
      sessions: number
      since: string | null
      readFirst: number
      inconclusive: number
      shellFirst: number
    }
    return { ...row, since: row.since ?? floor }
  }
```

**⚠ All three diagnostic sums share `COUNT(*)`, and that is the point.** They are counted over the
same rows in the same scan, so `P read-first · I inconclusive · S shell-first` can never be shown
against a different denominator from the headline — which is what D173 means by *"diagnostics with
their own denominator K"*: the same K, stated again, not a K of their own invention.

**⚠ THE FILTER IS PINNED BY SOURCE TEXT IN `db/schema.test.ts`, BECAUSE THERE IS NOWHERE ELSE TO
PIN IT.** `storage.ts` imports better-sqlite3, whose native binding is built for the **Electron** ABI
while Vitest runs under **Node**, so importing the module throws before a single assertion runs —
`schema.test.ts:17`–`:22` states exactly this and is why that file already reads `storage.ts` as
TEXT via `STORAGE_SRC`. **Do not create a `storage.test.ts`; it cannot run.** Add a `describe`
beside the v21 column cases that slices `getProjectMemoryUsage`'s body out of `STORAGE_SRC` and
asserts:

- **each of the three predicates separately** — `project_id = ?`, `agent = 'claude'`,
  `created_at >= ?`. Asserting the whole `WHERE` as one string would let a reformat break the test
  and, worse, would let one predicate be removed while the assertion was "fixed" wholesale. Put the
  D173 quote in the test's comment: *"Codex sessions must not be counted as measured non-use merely
  because no equivalent hook instrument exists."*;
- **no `JOIN` in the sliced body** — the property that keeps `COUNT(*)` a count of sessions;
- **all three breakdown sums are selected in the same statement as `COUNT(*)`**, so the breakdown
  can never be rendered against a denominator from a different scan;
- **`MEMORY_COUNTERS_VERSION` is the literal `21`**, not `MIGRATIONS.length` — the historical-floor
  rule above, asserted rather than merely written down.

**⚠ The arithmetic is proved at RUNTIME, not here.** A source-text assertion proves the predicate is
present; it cannot prove the numbers. The drive's control case does that, and it is the only place a
real SQLite file exists: in one project, run a claude pane that uses the graph, then a **codex** pane
doing ordinary work, and confirm **K does not move** and the sums do not change. That single
observation is what would catch a dropped `AND agent = 'claude'`.

**Raw `this.db.prepare` rather than Drizzle** for both, deliberately: the correlated floor and the
five `MAX()` calls read as SQL and would read as noise as a query builder. `migrate()` (`:3392`)
already uses `this.db.prepare` for a read, so the seam is precedented.

---

## §6 — `src/shared/ipc.ts` (and `ipc.test.ts`)

### The channel — after `SessionContextList` (`:60`)

```ts
  /** event (main -> renderer): this session's memory-graph usage changed
   *  (D168). Edge-triggered on the five counted facts — a tool call that moves
   *  none of them sends nothing. */
  SessionMemory: 'session:memory',
```

**⚠ ONE CHANNEL, NOT TWO. There is no `session:memory-list` cold read**, and its absence is a
decision rather than an oversight. `session:activity-list` and `session:context-list` exist because a
renderer reload would otherwise paint a *wrong* answer — a green light on a waiting agent, a blank
ring on a measured one. A missing memory counter is not wrong, it is **absent**, its durable answer
is already on the sessions row and in the Memory section's aggregate, and D147(e)'s "every line is
paid for" applies to a channel, a preload method, a handler and a store action bought for a hint.
`IpcChannel` moves **107 → 108**.

### The schemas — beside `sessionContextEventSchema` (`:2229`)

```ts
/**
 * One session's use of the project's memory graph (D168).
 *
 * ⚠ NO TOOL NAME IS IN THIS SHAPE AND NONE MAY EVER BE ADDED. The producer
 * compares names against fixed sets and drops them; this schema is the wire
 * boundary where that promise becomes checkable by a reviewer reading one
 * object.
 *
 * ⚠ ALL THREE FLAGS ARE REQUIRED, NOT OPTIONAL — the `sessionActivityEvent.reason`
 * discipline (`:2160`-`:2164`): `z.object` STRIPS unknown keys, so a field the
 * producer sets and the schema omits vanishes on the wire in silence, and a
 * producer that forgets a required one throws at the `parse()` in main, where it
 * is diagnosable. ⚠ FOR `readInconclusive` THE STAKES ARE HIGHER THAN THE
 * GENERAL RULE: a silently stripped `readInconclusive` leaves `readBeforeExplore
 * === false` with no third state, which reads downstream as an ordinary
 * not-passed — i.e. it re-creates exactly the silent verdict D173 removed.
 *
 * ⚠ `reads` IS A SUCCESSFUL-RESULT COUNT, not an attempt count (a failed call
 * fires `PostToolUseFailure`, measured). `writes` is TOOL-LEVEL: a successful
 * write call is not yet a sourced memory, and the validator is the write-side
 * truth. The names stay short because the SENTENCE carries the qualification
 * (`shared/provenance.ts`), but a reader of this schema is told here.
 */
export const sessionMemoryUsageSchema = z.object({
  reads: z.number().int().nonnegative(),
  writes: z.number().int().nonnegative(),
  readBeforeExplore: z.boolean(),
  /** D173: an unknown tool ran before the first read — the ordering result has
   *  no answer. Mutually exclusive with `readBeforeExplore`. */
  readInconclusive: z.boolean(),
  /** D173: DIAGNOSTIC. A shell call completed before the first memory read.
   *  ⚠ Never an input to pass/fail — do not let a consumer combine it. */
  shellFirst: z.boolean()
})
export type SessionMemoryUsage = z.infer<typeof sessionMemoryUsageSchema>

export const sessionMemoryEventSchema = z.object({
  sessionId: z.string().min(1),
  usage: sessionMemoryUsageSchema
})
export type SessionMemoryEvent = z.infer<typeof sessionMemoryEventSchema>
```

### The aggregate on `memory:validate` — `memoryValidateResponseSchema` (`:3246`)

```ts
/**
 * The project's memory-usage roll-up, carried on BOTH branches of
 * `memory:validate` (D168).
 *
 * ⚠ ON BOTH BRANCHES, AND THAT IS THE POINT RATHER THAN AN OVERSIGHT. The
 * provenance ratio needs the graph; these numbers are a local SQLite read
 * that is equally true with the container stopped. Hanging them off `ok: true`
 * would let a stopped Docker container erase a number that has nothing to do
 * with Docker — and the Memory section would show nothing where it should show
 * "0 successful memory reads · 0 memory writes across 4 Claude Code sessions
 * observed since …", which is a finding.
 *
 * ⚠ `text` IS BUILT IN MAIN by the tested pure core, exactly as `text` beside it
 * is. No renderer assembles this sentence; this repo has no `.vue` tests at all
 * (shared/provenance.ts:6-10).
 */
export const memoryUsageSummarySchema = z.object({
  reads: z.number().int().nonnegative(),
  writes: z.number().int().nonnegative(),
  /** ⚠ THE DENOMINATOR. Never sent without it (D55) — and it is a count of
   *  CLAUDE CODE sessions in the SQL as well as in the sentence: the accessor
   *  filters `agent = 'claude'`, because a pane Chorus cannot instrument must
   *  not be counted as measured non-use (D173 Q2). */
  sessions: z.number().int().nonnegative(),
  /** ISO-8601, or null when the counters have never been installed. */
  since: z.string().nullable(),
  /** The breakdown, all three over the SAME `sessions` denominator above.
   *  ⚠ `readFirst` is a PASS count and `inconclusive` is NOT its complement —
   *  `readFirst + inconclusive` may be less than `sessions`, and no consumer may
   *  compute failures as `sessions - readFirst`. */
  readFirst: z.number().int().nonnegative(),
  inconclusive: z.number().int().nonnegative(),
  shellFirst: z.number().int().nonnegative(),
  text: z.string(),
  /** The breakdown sentence, or null when there is nothing to show. Built by
   *  the same tested core as `text`. */
  breakdownText: z.string().nullable()
})
export type MemoryUsageSummary = z.infer<typeof memoryUsageSummarySchema>
```

and `usage: memoryUsageSummarySchema` added to **each** member of the existing union at `:3247` and
`:3261`.

### `ipc.test.ts`

Both `expect(Object.keys(IpcChannel)).toHaveLength(107)` — **`:3510` and `:3897`** — become `108`,
each with a note in the surrounding voice (`:3889`, `:3895`):

```
    // ⚠ 107 → 108: Task 6b-1's one `session:memory` channel, re-counted from the
    // merged tree with the AST rather than added to 107. There is deliberately
    // NO `session:memory-list` cold read — see the channel's own note.
```

---

## §7 — `src/shared/provenance.ts` (+ the re-export and its tests)

**Placement rationale:** `:12`–`:15` states it — the renderer may not import main-process code, and
`provenanceCore.ts:242` re-exports so there is still one home for the wording while main keeps the
Cypher. Both new sentences are D55 sentences, so they belong beside `completeness`.

```ts
/** ⚠ SINGULAR AND PLURAL, because "1 reads" in the one place this project will
 *  screenshot for a milestone is exactly the detail that undermines it. */
function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

/**
 * The project's memory-usage line, WITH ITS DENOMINATOR (D55).
 *
 * ⚠ THE SHAPE IS FIXED BY D173 (Q2) AND IS NOT A WORDING CHOICE:
 *
 *     R successful memory reads · W memory writes
 *     across K Claude Code sessions observed since <day>
 *
 * ⚠ "SUCCESSFUL" IS EARNED BY MEASUREMENT, NOT ADDED FOR TONE. A failed tool
 * call fires `PostToolUseFailure`, a separate event this instrument does not
 * count (measured 2026-08-19, claude 2.1.235 — `_verify/6b-4/hookprobe/`), so
 * every counted read really did return a result. If that split ever goes, this
 * word must go with it.
 *
 * ⚠ "CLAUDE CODE" IS LOAD-BEARING AND MUST NOT BE TIDIED AWAY. The instrument is
 * a Claude Code hook bus; CODEX HAS NO HOOK BUS, so a codex pane can only ever
 * contribute a zero. An unqualified "K sessions" would claim all-agent coverage
 * this cannot provide and would report unmeasurable panes as measured non-use.
 *
 * ⚠ "MEMORY WRITES" IS TOOL-LEVEL AND ITS LIMIT TRAVELS WITH IT: a successful
 * `write_neo4j_cypher` is not yet a SOURCED memory, and the validator is the
 * write-side truth (D173). The disclosure paragraph beside this line carries
 * that, and the milestone reads `memory:validate`, not W.
 *
 * ⚠ THE DATE IS THE ISO DAY, NOT A LOCALE FORMAT. `toLocaleDateString` would
 * make this function's test depend on the runner's locale and time zone — a
 * pinned assertion that passes here and fails in CI. `since.slice(0, 10)` is the
 * UTC day, deterministic, and already the format every other date in this
 * codebase is stored in.
 *
 * ⚠ THE EMPTY CASE SAYS SO. "0 reads · 0 writes across 0 sessions since —" is a
 * number with a denominator of zero, which is the D55 failure wearing a
 * denominator as a disguise.
 */
export function memoryUsageLine(
  reads: number,
  writes: number,
  sessions: number,
  since: string | null
): string {
  if (!since) return 'these counters have not been installed yet'
  const day = since.slice(0, 10)
  if (sessions === 0)
    return `no Claude Code sessions have run in this project since the counters were added on ${day}`
  return (
    `${count(reads, 'successful memory read')} · ${count(writes, 'memory write')} ` +
    `across ${count(sessions, 'Claude Code session')} observed since ${day}`
  )
}

/** ⚠ THE LOWER-BOUND DISCLOSURE, AS A TESTED CONSTANT RATHER THAN TEMPLATE PROSE
 *  (D173 Q2). The counters are written per receipt and monotonically, which
 *  NARROWS the loss window to one receipt — it does not close it: a session
 *  restarted mid-life keeps its highest registration's numbers, not their sum.
 *  Saying "totals may be a lower bound" is the difference between a measurement
 *  and a precise-looking claim the instrument cannot support. */
export const MEMORY_USAGE_LOWER_BOUND_NOTE =
  'Totals are a lower bound: counts are saved as each tool call completes, but a session ' +
  'restarted mid-life resumes from zero, so its row keeps the highest run rather than the sum.'

/**
 * The per-project breakdown line — `null` when there is nothing to show.
 *
 *     P read-first · I inconclusive · S shell-first of K Claude Code sessions
 *
 * ⚠ IT CARRIES THE SAME DENOMINATOR K AS THE HEADLINE, deliberately restated
 * rather than assumed: a bare "2 inconclusive" is exactly the naked numerator
 * D55 exists to refuse, and all four numbers come from the same `COUNT(*)` scan
 * over the same rows.
 *
 * ⚠ `read-first` IS THE MILESTONE'S HEADLINE CLAUSE, SHOWN AS A TREND. The
 * per-row flag answers "did THIS session read the graph before exploring"; only
 * the roll-up answers "is this getting better", which is the question every
 * later task in this phase is actually asking. It is put HERE rather than in
 * the main line because D173 fixed that line's shape word for word and
 * extending it would be this document overruling the finding it is folding in.
 *
 * ⚠ P IS A PASS COUNT, AND I IS NOT ITS COMPLEMENT. `P + I` does not have to
 * equal K and usually will not: a session can be neither — it explored first,
 * or never touched the graph at all. Do not let a caller compute "failures" as
 * `K - P`; that number would fold "we cannot say" together with "it did not",
 * which is the exact conflation D173 introduced INCONCLUSIVE to prevent.
 *
 * ⚠ NEITHER I NOR S IS A FAILURE COUNT. `inconclusive` means an unrecognised
 * tool ran before the first memory read, so this build declines to judge the
 * ordering; `shell-first` means a shell command completed first, which is a
 * SIGNAL, never a verdict — `Bash` is out of the pass/fail set precisely because
 * `npm test` and `ls` are indistinguishable without `tool_input`.
 */
export function memoryBreakdownLine(
  readFirst: number,
  inconclusive: number,
  shellFirst: number,
  sessions: number
): string | null {
  if (readFirst === 0 && inconclusive === 0 && shellFirst === 0) return null
  return (
    `${readFirst} read-first · ${inconclusive} inconclusive · ${shellFirst} shell-first ` +
    `of the same ${count(sessions, 'Claude Code session')}`
  )
}

/**
 * The live per-session pair for a filmstrip card.
 *
 * ⚠ RETURNS `null` FOR A SESSION THAT HAS DONE NEITHER, so the card renders
 * NOTHING rather than "0 reads · 0 writes". That is the context ring's rule
 * verbatim (stores/session.ts:63-68): a zero is a claim, and "this agent has not
 * touched the graph" is not a claim worth putting on every card in the strip.
 * The emptiness is decided HERE, where a test can reach it, rather than by a
 * `v-if` in a template nothing tests.
 *
 * `full` carries the denominator ("this session") for the tooltip; `short` is
 * what fits beside the ring.
 */
export interface SessionMemoryText {
  readonly short: string
  readonly full: string
}
export function sessionMemoryLine(reads: number, writes: number): SessionMemoryText | null {
  if (reads === 0 && writes === 0) return null
  return {
    short: `${count(reads, 'read')} · ${count(writes, 'write')}`,
    full: `Project memory, this session: ${count(reads, 'graph read')} · ${count(writes, 'memory write')}`
  }
}
```

`provenanceCore.ts:242` gains `memoryUsageLine, memoryBreakdownLine, MEMORY_USAGE_LOWER_BOUND_NOTE,
sessionMemoryLine, type SessionMemoryText`; the cases go in `provenanceCore.test.ts` beside `:287`,
where `completeness`'s already are. **⚠ Assert `successful` and `Claude Code` character for
character** — they are the two words CR-6b.0 added, they read as verbosity to anyone who has not read
D173, and a test that only checks the numbers would stay green while the sentence quietly went back to
claiming coverage it does not have.

---

## §8 — `src/main/ipc.ts`, `src/preload/index.ts`, the renderer

### `main/ipc.ts` — the fan-out, placed after the `SessionContextList` handler (`:4654`–`:4656`)

**Rationale for the position:** it is the context ring's structural twin — a live per-session number
off main's memory — and a reader should meet them together, exactly as `:4633`–`:4637` argues for the
ring sitting beside the activity pair. It is **not** folded into the `onActivity` block at `:4481`,
which also recomputes project attention; two unrelated jobs in one callback is how a throw in one
kills the other.

```ts
  /* ── D168: the memory-usage broadcast + the row write ────────────────────
   *
   * ⚠ ALREADY EDGE-TRIGGERED AT THE SOURCE (see `MemoryUsageListener`), so
   * there is no debounce to add here and none is needed: a memory tool call is
   * RARE — 30 in this machine's entire transcript history at the 6b kickoff —
   * while the exploration calls that would have justified a debounce never reach
   * this callback at all.
   *
   * ⚠ BROADCAST FIRST, PERSIST SECOND, AND THE WRITE CANNOT THROW OUT OF HERE.
   * This callback runs inside the hook request handler Claude Code blocks on. A
   * locked database must cost the row, never the live counter and never the
   * agent's turn. */
  agentEvents.onMemoryUsage((sessionId, usage) => {
    const event = sessionMemoryEventSchema.parse({ sessionId, usage })
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IpcChannel.SessionMemory, event)
    }
    try {
      storage.setSessionMemoryUsage(sessionId, usage)
    } catch (err) {
      logger.warn({ err, sessionId }, '[memory] could not persist this session’s graph counters')
    }
  })
```

`storage` is `registerIpc`'s second parameter and `agentEvents` its ninth (`:568`–`:593`) — both are
already in scope; nothing new is threaded.

### `main/ipc.ts` — `MemoryValidate` (`:4105`–`:4125`)

Compute the aggregate **before** the graph call, and put it on **both** returns:

```ts
    const agg = storage.getProjectMemoryUsage(p.id)
    const usage = {
      ...agg,
      text: memoryUsageLine(agg.reads, agg.writes, agg.sessions, agg.since),
      // null when there is nothing to show — the renderer's `v-if` then has a
      // tested emptiness to key off rather than a rule of its own.
      breakdownText: memoryBreakdownLine(
        agg.readFirst,
        agg.inconclusive,
        agg.shellFirst,
        agg.sessions
      )
    }
    const result = await memory.validate(p.id)
    if (!result.ok) {
      return memoryValidateResponseSchema.parse({ ok: false, reason: result.reason, usage })
    }
    …
    return memoryValidateResponseSchema.parse({ ok: true, …, usage })
```

`memoryUsageLine` and `memoryBreakdownLine` are imported from `./services/provenanceCore` (the
re-export), following the rule that main-process code reads the wording through the core.

**⚠ Do not add the aggregate to the log line at `:4112`.** That line is the provenance ratio and its
"never a bare numerator in the log either" note is about that number. If the aggregate is worth
logging, log it as its own line **with its denominator**.

### `preload/index.ts` — after `getSessionContexts` (`:651`)

```ts
  /* D168: the memory-usage counter. Same zero-Zod forwarder shape as every
   * sibling above (D1: a preload Zod import throws EvalError under the page CSP
   * and silently drops events — validated in MAIN instead). */
  onSessionMemory: (callback: (event: SessionMemoryEvent) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: SessionMemoryEvent): void => {
      callback(payload)
    }
    ipcRenderer.on(IpcChannel.SessionMemory, listener)
    return () => ipcRenderer.removeListener(IpcChannel.SessionMemory, listener)
  },
```

`ChorusApi` is `typeof chorusApi` (`:773`), so nothing else needs declaring.

### `App.vue` — beside `offContext` (`:227`, unsubscribed at `:261`)

```ts
  const offMemory = window.chorus.onSessionMemory((event) => {
    sessionStore.memoryUsageChanged(event.sessionId, event.usage)
  })
```

**No cold read** — see §6. Add `offMemory()` to `onUnmounted`.

### `stores/session.ts`

- state: `memoryUsage: Record<string, SessionMemoryUsage>` beside `context` (`:77`), initialised `{}`;
- `memoryUsageChanged(sessionId, usage)` beside `contextChanged` (`:142`);
- `delete this.memoryUsage[sessionId]` in `exited` (`:118`), with the same one-line reason: a restart
  is a new conversation and main drops its own copy on `revoke`, so a counter carried across the exit
  would describe a session that no longer exists. The durable answer is the row.

### `FilmstripRenderer.vue` — the live counter

A `memoryFor(id)` beside `contextFor` (`:266`), reading `sessionStore.memoryUsage[id] ?? null`, and a
computed that runs it through `sessionMemoryLine`. In `.card-foot` (`:382`–`:385`), whose comment at
`:379`–`:380` already says *"the row is a flex pair, so a third member costs no layout change"*:

```html
        <span class="card-foot">
          <span class="card-elapsed">{{ elapsed(id) }}</span>
          <!-- ⚠ ABSENT, NOT ZEROED — `sessionMemoryLine` returns null for a
               session that has touched neither counter, and the emptiness is
               decided in the tested core rather than by this v-if. -->
          <span v-if="memoryTextFor(id)" class="card-memory" :title="memoryTextFor(id)!.full">
            {{ memoryTextFor(id)!.short }}
          </span>
          <ContextRing v-if="contextFor(id)" :usage="(contextFor(id) as SessionContextUsage)" />
        </span>
```

`.card-memory` gets the same muted small-text treatment as `.card-elapsed`, with `white-space: nowrap`.

### `stores/memory.ts`

`MemoryUsage` interface + `usageByProject: Record<string, MemoryUsage>`, assigned in `validate()`
(`:365`) **before** the `if (!res.ok) return this.refuse(res.reason)` at `:370`:

```ts
        const res = await window.chorus.validateMemory(projectId)
        // ⚠ RECORDED BEFORE THE REFUSAL BRANCH. The counters are a local read
        // and are just as true when the graph is unreachable — see the schema's
        // note on why `usage` is on both branches.
        this.usageByProject[projectId] = { …res.usage }
        if (!res.ok) return this.refuse(res.reason)
```

### `ProjectSettingsView.vue` — the aggregate, in the `Where memories came from` block (`:1117`)

A computed beside `memoryValidation` (`:357`):

```ts
const memoryUsage = computed(() => memoryStore.usageByProject[props.projectId] ?? null)
```

and, immediately after the ratio row that closes at `:1134`:

```html
            <!-- ⚠ THE STRINGS COME FROM MAIN, BUILT BY THE TESTED CORE. This
                 template does no arithmetic and no assembly — the denominator is
                 already inside the sentence (D55), and so are the words
                 "successful" and "Claude Code" (D173 Q2). -->
            <p v-if="memoryUsage" class="ps-hint ps-hint-tight">{{ memoryUsage.text }}</p>
            <!-- The breakdown, absent when there is nothing to show. The
                 emptiness is decided by `memoryBreakdownLine` returning null,
                 not by a rule invented in this template. ⚠ `read-first` is the
                 milestone's own clause shown as a per-project trend; it is here
                 rather than in the line above because D173 fixed that line's
                 shape word for word. -->
            <p v-if="memoryUsage?.breakdownText" class="ps-hint ps-hint-tight">
              {{ memoryUsage.breakdownText }}
            </p>
            <p v-if="memoryUsage" class="ps-hint ps-hint-tight">
              Counted from the agents' own tool calls, and only for Claude Code panes — codex has no
              hook bus, so its sessions cannot be measured here and are not counted. Chorus reads the
              NAME of each completed tool call and nothing else — never the query it sent or the
              answer it got — and counts only sessions that started after these counters were added.
              A call that failed is not counted. {{ MEMORY_USAGE_LOWER_BOUND_NOTE }}
            </p>
```

**⚠ The third paragraph is not decoration, and D173 added two of its clauses.** D168's honest
statement is that *every* tool call's name passes through the comparison; the surface that shows the
resulting number is the one place a user can be told so. **CR-6b.0 added the Claude-only scope and
the lower-bound disclosure**, and both are there for the same reason: this line is the only place a
user learns what the number does **not** cover. The lower-bound sentence is imported from
`provenanceCore` as a constant, not typed into the template, so the suite can assert it exists.

---

## §9 — Verification

### Build

```powershell
npm run typecheck        # 0, node + web
npx vitest run           # >= your §0(5) baseline, plus this task's cases
npm run grep:secrets     # clean, 6 patterns
```

### Structural

```powershell
# 20 -> 21 and 107 -> 108, with the AST (never a grep — the array holds template
# literals and the map holds comments)
node -e "const ts=require('typescript'),fs=require('fs');const p='src/main/services/storage.ts';const sf=ts.createSourceFile(p,fs.readFileSync(p,'utf8'),ts.ScriptTarget.Latest,true);let i=null;const w=n=>{if(ts.isVariableDeclaration(n)&&n.name.text==='MIGRATIONS')i=n.initializer;ts.forEachChild(n,w)};w(sf);console.log('MIGRATIONS.length =',i.elements.length)"
node -e "const ts=require('typescript'),fs=require('fs');const p='src/shared/ipc.ts';const sf=ts.createSourceFile(p,fs.readFileSync(p,'utf8'),ts.ScriptTarget.Latest,true);let i=null;const w=n=>{if(ts.isVariableDeclaration(n)&&n.name.text==='IpcChannel')i=n.initializer;ts.forEachChild(n,w)};w(sf);while(i&&(ts.isAsExpression(i)||ts.isSatisfiesExpression(i)))i=i.expression;console.log('IpcChannel keys =',i.properties.filter(p=>ts.isPropertyAssignment(p)).length)"

# the FIELD `tool_name` is read in exactly one place — `readToolName` — and named
# in prose in the two amended docblocks. Every other hit is a defect.
Select-String -Path src -Include *.ts -Pattern "tool_name" -Recurse

# and the READ VALUE reaches only the four classifiers. Every hit here must be a
# call to one of them; a field assignment, a template literal or a logger call is
# the D168/D173 limit being crossed.
Select-String -Path src -Include *.ts -Pattern "readToolName" -Recurse

# five columns, five ALTERs, one migration entry
Select-String -Path src/main/services/storage.ts -Pattern "ADD COLUMN memory_"

# D173's two words are in the sentence, not just in this document
Select-String -Path src/shared/provenance.ts -Pattern "successful memory read|Claude Code session"

# nothing in adapters/ changed; nothing outside the Exact Scope list changed
git diff --stat
```

### Runtime — the part that decides the task

Evidence under `_verify/6b-1/`. The container is left **running**.

1. `docker ps -a --filter name=chorus-g2-neo4j --format '{{.Status}}'`; `docker start chorus-g2-neo4j`
   if needed and **wait for bolt, not for TCP** (F93; measured 4.3 s warm).
2. `npm run dev`, open the **Chorus** project, launch a **claude** pane, and prompt it to use the
   `chorus-memory` read tool. **Naming the graph is allowed in THIS drive** — 6b-1 proves the
   instrument; the unnamed-prompt milestone run belongs to 6b-3. Record the prompt verbatim.
3. **(a) The live counter** appears in the card's `.card-foot` — and was **absent** before the call.
   Capture it (screenshot, or CDP `document.querySelector('.card-memory').textContent`).
4. **(b) The row.** ⚠ **The database is in WAL mode (`storage.ts:965`), so copying `chorus.db` alone
   can miss everything written this session.** Copy `chorus.db`, `chorus.db-wal` and `chorus.db-shm`
   when present, then read the copy:

```js
// _verify/6b-1/read-row.js  — run under Electron-as-node: the repo's
// better-sqlite3 is built for the ELECTRON ABI and plain `node` throws on it.
const fs = require('fs'), path = require('path')
const src = path.join(process.env.APPDATA, 'chorus', 'chorus.db')   // dev DB
const dst = path.join(__dirname, 'chorus-copy.db')
for (const suffix of ['', '-wal', '-shm']) {
  if (fs.existsSync(src + suffix)) fs.copyFileSync(src + suffix, dst + suffix)
}
const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'))
const db = new Database(dst, { readonly: true })
console.log(db.prepare('SELECT version, applied_at FROM schema_migrations ORDER BY version DESC LIMIT 3').all())
console.log(db.prepare(
  `SELECT id, agent, created_at, memory_reads, memory_writes, memory_read_first,
          memory_read_inconclusive, memory_shell_first
     FROM sessions ORDER BY created_at DESC LIMIT 5`).all())
```

```powershell
$env:ELECTRON_RUN_AS_NODE=1
node_modules\electron\dist\electron.exe _verify\6b-1\read-row.js
```

   **Paste the exact output.** `version 21` must be present with a real `applied_at`, and the
   session's **five** columns must match what the UI showed. The `applied_at` day is the date the
   aggregate quotes, so (b) and (c) must agree on it.

5. **(c) The aggregate.** Project Settings → Memory → *Count sources*. The line under the ratio must
   read **`R successful memory reads · W memory writes across K Claude Code sessions observed since
   <date>`**, the lower-bound disclosure must be visible beside it, the numbers must match (b), and
   the implementer must be able to say in one sentence **which sessions K counts and why**.
   **⚠ Paste the rendered line verbatim.** A screenshot reading "12 reads · 3 writes across 4
   sessions" is a **failed** step, not a formatting nit: both dropped qualifications are claims the
   instrument cannot support (D173 Q2), and this is the step that catches them.
6. **(c') The denominator's control case — the ONLY place the `agent` filter can be proved.** In the
   **same** project, launch a **codex** pane, let it do ordinary work, exit it, and re-open Project
   Settings → Memory. **K must be unchanged**, and so must every sum. **Record K before and after.**
   A source-text assertion (§5) proves the predicate is written; only this proves it works — and it
   cannot be a unit test, because `storage.ts` does not load under Vitest. If K moves, the filter is
   missing or the label is lying, and D173 Q2 is unmet: *"Codex sessions must not be counted as
   measured non-use merely because no equivalent hook instrument exists."*
7. **The negative drive.** A `PreToolUse`-only sequence — deny the tool when the pane asks, so there
   is no `PostToolUse` — must move **nothing**, in the UI and in the row. (If §0's probe B already
   produced this shape, that capture counts and can be cited rather than repeated.)
8. **The name check at runtime.** `Select-String` the app's log for `mcp__chorus-memory__` and for
   the built-in tool names over the whole drive: **zero hits**.

**⚠ Failure-honesty clause.** Any command that fails — Docker down, ABI mismatch, locked DB, missing
CLI — is reported **with its output**, and the step is **not claimed**. Environmental failure is a
legitimate result; a silently skipped step is not.

### The invariants a reviewer should test hardest

**Three things now — D173 added the third, and it is the one that fails silently.**

1. **NO TOOL NAME IS EVER STORED, LOGGED, BROADCAST OR PERSISTED — INCLUDING ON THE ERROR AND
   EXCEPTION PATHS.** Do not accept this from a summary. Read every use of `readToolName`'s result in
   the diff: it may reach `classifyMemoryTool`, `isExplorationTool`, `isShellTool` and `isKnownTool`
   and nothing else — no field, no array, no template literal, no `logger` call, no return value.
   Then check the wire types: `SessionMemoryUsage` and `MemoryUsageRecord` must contain **no `string`
   field at all**, which makes the promise structurally impossible to break rather than merely
   unbroken today. Then run the canary tests and the runtime log grep. The entire justification for
   widening D130's read surface is that the name has nowhere to go; a single `logger.debug({
   toolName })` left in from debugging retires that argument.

   **⚠ D173 Q1 EXTENDED THIS TO THE PATHS NOBODY TESTS.** Three members of the council raised
   error-path logging independently, and they were right to: the `catch` around a throwing listener,
   the malformed-body rejection and the over-cap rejection all run **with the receipt still in
   scope**, and a well-meant `logger.error({ err, body })` in any of them dumps a raw hook body — the
   agent's Cypher and the graph's answer included — into the log. That single line would undo the
   whole "what is not taken cannot leak" posture while every existing test stayed green. The canary
   must be posted down **each** of those paths, not only the happy one.

2. **THE COUNT IS TAKEN BEFORE THE EDGE FILTER, AND ONLY THE BROADCAST IS GATED.** Read `handle()`
   top to bottom and confirm the counting block sits above `readHookEventName`'s gate and far above
   `record()`. Then prove it behaviourally, both ways: twenty consecutive memory-read `PostToolUse`
   bodies must yield **`reads === 20` with `onActivity` firing exactly once**, and twenty consecutive
   `Read` bodies must yield **twenty internal ordinals with zero `onMemoryUsage` callbacks**. A
   feature that counts after the filter reports "1 read" for a session that made twenty — and every
   unit test written against the counter's own API would still pass, which is precisely why F55 and
   F56 are in the roadmap and why this is the harder of the two invariants to catch by reading.

3. **THE ORDERING RESULT HAS THREE OUTCOMES, NOT TWO, AND THE THIRD ONE FAILS SILENTLY WHEN IT IS
   MISSING** (D173 Q3). Read the pass expression in `toUsage`: it must test **`firstUnknownOrdinal`
   as well as `firstExploreOrdinal`**. A pass condition that mentions only exploration compiles,
   type-checks, and passes every test written against the old two-ordinal API — while a renamed
   vendor tool (`Agent` was `Task` within living memory) silently becomes a **free pass** on this
   phase's headline number. Then read the branch order in `noteToolUse`: `isShellTool` must sit on
   its own branch and must never touch `firstExploreOrdinal`, because re-conflating the two is a
   one-line regression that restores `Bash` to the pass/fail set without anyone editing the set.

   Prove all three outcomes behaviourally and prove them **disjoint**: unknown-then-read →
   `readInconclusive` alone; `Bash`-then-read → `readBeforeExplore` **and** `shellFirst`, never
   `readInconclusive`; `Read`-then-read → neither flag. And prove **set-once**: once any flag is
   `true`, no later receipt of any kind returns it to `false`, at the record level *and* through the
   `MAX()` write.
