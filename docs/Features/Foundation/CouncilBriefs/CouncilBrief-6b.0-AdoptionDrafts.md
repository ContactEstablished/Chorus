# Council Brief 6b.0 — Making an agent-written memory graph actually get used: measurement, contract, always-on, nudge

**Answer these questions. Do not review this document.**

_Issued 2026-08-19 · Status: AWAITING FINDINGS · Decision owner: Matthew Wilson_

You are a review council of independent LLM models. Answer the eight numbered questions in section 3 —
section 4 elaborates on each in the same order — in the **Required Output Format** at the end. You
have no other context on this project — everything you need is in this document. Where you are
uncertain about an external fact, say so explicitly rather than guessing.

**Do not write code.** A previous council in this project returned verbatim TypeScript that shipped
four compile errors, because a council has the brief and not the repository. Rulings and reasoning
are what is wanted here.

Every factual claim below is labelled **[MEASURED]** (taken on this machine on 2026-08-19 with the
method stated), **[INSPECTED]** (read in the code or the vendor's documentation) or **[UNVERIFIED]**
(an argument, an assumption, or a prediction). Those labels are load-bearing: a previous failure in
this project came from reasoning over an unmarked mix of the three. **Treat [UNVERIFIED] claims as
open, and say so if your answer depends on one.**

---

## 1. Context

**Chorus** is a Windows desktop app (Electron, Vue 3, TypeScript) that runs several AI coding agents
(Claude Code, Codex, OpenCode, Grok CLIs) side by side in terminal panes. Each agent is a child
process Chorus launches; Chorus owns the launch command line, the environment, and — for Claude Code —
a per-session *hooks* settings file and a *system-prompt appendix* file.

**The memory feature** (Phases 6 and 6a, shipped): each project can have its own Neo4j graph
database in a Docker container on loopback. Agents reach it through an MCP server
(`mcp-neo4j-cypher`, tools `read_neo4j_cypher`, `write_neo4j_cypher`, `get_neo4j_schema`). Chorus
writes *structural* nodes into the graph by indexing the repository — `:File`, `:Directory`,
`:Commit` with `CONTAINS` / `MODIFIED` edges — and agents are meant to write `:Memory` nodes
(decisions, observations, risks) that cite the code they are about:

```
(:AgentSession)-[:PRODUCED]->(:Memory)-[:SUPPORTED_BY]->(:File | :Commit)
```

A `:Memory` counts as **sourced** only if it has both edges; a validator reports *"N sourced of M
current memories"*. A prior council (6.0, 2026-08-08) ruled that provenance should be
*advisory-and-measured* (a ratio, not an enforced write path), that there is **no `confidence`
field** (a self-graded number reads as rigour), that Chorus must **never write into the user's
`CLAUDE.md`/`AGENTS.md`**, and that a Chorus-written session node is *attribution, not provenance*.

At launch, when a project has memory configured, Chorus injects a seven-line **usage contract** into
the agent's system prompt ("this project has a memory graph; read before assuming; write after a
milestone; cite your sources; never delete a memory you did not write…"). For Claude Code it travels
as `--append-system-prompt-file`; for Codex as a single-line `-c developer_instructions=…` override
(a raw newline there is silently fatal to the whole value).

**Chorus also receives Claude Code's lifecycle hooks.** Its hooks file subscribes every event to one
command: `curl -s -o NUL -m 2 -X POST --data-binary @- http://127.0.0.1:<port>/hook/<token>`. The
listener reads **only** `hook_event_name` and `transcript_path` off the body and drives the pane's
working/needs-you light and a context-usage ring. `-o NUL` is deliberate: **a hook command's stdout
is a control channel** — Claude Code parses JSON printed there as a decision object — so the
listener's HTTP response must never reach stdout. The listener's header states this read surface as
a security posture: *"what is not taken cannot leak."* Widening it once before (adding
`transcript_path`) was done in-task with a written posture and no council.

## 2. What was measured on 2026-08-19, before this council convened

**The feature is built and is not being used.** [MEASURED]

- Across **every** Claude Code transcript on the development machine (384 files): **20 calls** to the
  memory tools before 2026-08-19, all inside four sessions on 14–15 August where the prompt named the
  graph; **`write_neo4j_cypher`: 0 calls, ever**. Codex: 5 calls, one prompted drive.
- The graph: 468 `:File`, 200 `:Commit`, 37 `:Directory`, **1 `:Memory`** (a hand-seeded test
  canary with no citations), **0 `:AgentSession`**. The validator reads **0 of 0**.
- The installed app (the one used for real work, 9 sessions across 3 projects in the last 7 days)
  has **zero projects with memory configured**. The only configured project is in the dev database,
  pointing at a hand-started container; Docker Desktop was not running when the audit began.

**Why, per the audit (three findings, all [INSPECTED] in code):**

- **F89 — the contract cannot be complied with.** It tells the agent to attach `PRODUCED` *"from
  your own `:AgentSession` node"* — but nothing ever creates that node and the agent is never told
  its session id. It names no project id, no `:Memory` property set, no Cypher. A diligent agent's
  memory is therefore invisible to the validator; the ratio is 0 % by construction.
- **F90 — nothing keeps the feature on.** Container start, index refresh and validation are each a
  button in a settings section; the contract is emitted whenever memory is *configured*, even when
  the container is stopped.
- **F91 — reads are unmeasurable.** `tool_name` is dropped by design; Neo4j's query log is off; the
  only instrument is write-side provenance, which reads 0 of 0.

**Measurements taken for the decisions** (method in brackets):

- [MEASURED] Claude Code **2.1.235**: `PreToolUse` / `PostToolUse` hook bodies carry `tool_name`
  verbatim, e.g. `mcp__chorus-memory__read_neo4j_cypher`; `PostToolUse` adds `tool_response` and
  `duration_ms` (a `--settings` hook file logging the body's keys, under `claude -p`).
- [MEASURED] **MCP tools are deferred in 2.1.235**: the agent called `ToolSearch` *before* the memory
  tool — the tool was not in its live tool list at start. (Same method.)
- [MEASURED] A `UserPromptSubmit` hook's **plain stdout reaches the model** (a hook printed a codeword;
  the model repeated it). A `Stop` hook returning `{"hookSpecificOutput":{"additionalContext":…}}`
  **continues the turn** (the model appended the asked-for word); `stop_hook_active` was `false` on
  the first fire and `true` on the second. [INSPECTED] The vendor docs add: exit-0 stdout is context
  only for `UserPromptSubmit`/`SessionStart`; `PreCompact` can only block; injected text is saved in
  the transcript and **replayed on resume**; hooks on one event run in parallel; text framed as an
  out-of-band system command trips the model's prompt-injection defences and is surfaced to the user.
- [MEASURED] A bolt connect to the live graph costs **4–12 ms**; to a closed port **<1 ms**. After
  `docker start` the published TCP port accepts at **2 ms** but bolt answers at **4.3 s** — a TCP
  probe is a false positive for the whole boot. A full index run of this repo took **2.5–3.0 s**.
- [INSPECTED] The SQLite `sessions` table has no model column; the next free migration is v21; the
  `:Memory` property set in code is `id · content · chorusProjectId · writtenVia · assertedByModel ·
  assertedByAdapter · validFrom · validTo`.

**The phase's milestone, already fixed, which the questions serve:** a session launched from the
*installed* app, on an ordinary coding task whose prompt never mentions the graph, makes ≥ 1 graph
read *before* filesystem exploration and ≥ 1 sourced `:Memory` write — **read off Chorus's own
counters, never off a transcript.**

The kickoff settled five decisions (D168–D172) and four task documents were drafted from them. The
questions below put those decisions, and the drafts' main judgement calls, to you. "The proposal" in
each question is what the drafts currently say.

---

## 3. The questions

**Answer these questions. Do not review this document.**

1. Should Chorus's hook listener read the tool name off every Claude Code tool-call event — comparing it against two fixed sets and keeping only counters, never the name — as the instrument for measuring graph reads and writes?
2. Should the per-session read and write counters be persisted as three columns on the existing sessions table, with the aggregate's denominator floored at the migration's own apply time, rather than kept in memory or written to a separate table?
3. Is "the first completed memory read precedes the first completed call to a fixed set of built-in exploration tools" a sound operational definition of the milestone's "reads the graph before exploring the filesystem"?
4. Should the Chorus-written session node's MERGE at launch double as the reachability gate, with the usage contract withheld entirely when it fails rather than emitted with a caveat?
5. Should the usage contract hand agents three parameterised Cypher templates to copy, rather than Chorus shipping its own purpose-built MCP tools such as recall and remember that write the provenance edges themselves?
6. Should a launch of a memory-configured project start its stopped container and wait up to twenty seconds for the database before the agent starts, rather than launching immediately and delivering the contract later?
7. Should the structural index refresh run automatically only at launch when the repository head has moved, in the background, never on a timer, file watcher, git hook or at application start?
8. Should the write nudge be a second UserPromptSubmit hook whose stdout is one factual status line from the counters, built now but executed only if the milestone fails without it, with Stop-hook continuation refused outright?

---

## 4. Notes on each, in order

### Q1 — The one-field widening of the listener's read surface

**The proposal (D168).** On `PostToolUse` bodies the listener reads `tool_name` (string, length-capped
at 128, shape-checked like every other field) and compares it against **two fixed sets**: the
`mcp__chorus-memory__` prefix (classified *read* = `read_neo4j_cypher` / `get_neo4j_schema`, *write*
= `write_neo4j_cypher`) and Claude Code's built-in exploration tools (`Read`, `Glob`, `Grep`, `Bash`,
`Agent`, `LS`). The output is three counters and two ordinals per session. **The name itself is never
stored, logged, broadcast or persisted.** `tool_input` (the Cypher text), `tool_response` (graph
content), `prompt`, `last_assistant_message` are never read. The count is taken from the raw receipt,
*before* the listener's edge filter (which collapses twenty tool calls into one "working" callback —
a measured prior finding), and `PreToolUse` is not counted (an attempt the user denied is not a
read). The module header's security claim is rewritten to say exactly this.

**The honest statement** is that *every* tool call's name passes through the comparison, not only
memory ones — because the milestone needs to know whether a memory read preceded exploration.

**Why it was not sent to the council by the kickoff** (you are being asked anyway, at the owner's
request): the precedent widening (`transcript_path`, which opens and reads a file) was settled
in-task; this one is strictly narrower. [UNVERIFIED] The kickoff's threat assessment: a same-user
process that can hold the per-session token can at most inflate its own session's counters; nothing
new can leak because nothing new is retained.

**The alternative considered:** read `tool_name` only when it starts with the memory prefix and
measure nothing about exploration — which makes the milestone's "before exploration" clause
unmeasurable except by reading transcripts, the very thing the phase refuses.

### Q2 — Where the counters live

**The proposal.** Migration v21 adds `memory_reads`, `memory_writes`, `memory_read_first` (0/1) to
`sessions`. Writes are monotonic (`MAX(col, ?)`), so an app restart can under-count but never
double-count. The Memory section shows *"R reads · W writes across K sessions since <date>"*, where
K counts only sessions created **after v21 was applied** (the migration ledger's `applied_at`), so
sessions the instrument never observed do not inflate the denominator. A project rule (D55) forbids
showing any number without its denominator.

**Alternatives:** in-memory only (the milestone is then readable only while the session is alive,
and no trend is possible); a separate `memory_tool_calls` table keyed by session and day (more
general, more schema, no consumer for the generality yet).

### Q3 — What "before exploration" means

**The proposal.** Per session, two ordinals: the receipt ordinal of the first completed memory
*read* and of the first completed call to a tool in the fixed exploration set. `memory_read_first =
1` iff the former precedes the latter (or exploration never happened). `ToolSearch` is **excluded**
from the exploration set on purpose: the measured deferral (section 2) means a compliant agent's
very first tool call may be `ToolSearch` to load the memory tool, and counting it as exploration
would make the milestone unpassable while every test stays green. The implementer re-verifies the
built-in tool names against the installed CLI at execution.

**The risk to weigh:** the set is a hard-coded list of another vendor's tool names; a renamed or new
exploration tool silently widens the definition in the agent's favour. [UNVERIFIED] The kickoff judged
that acceptable because the failure direction is an over-generous pass that the write-side ratio
would still expose.

### Q4 — The MERGE as the gate, and withholding the contract

**The proposal (D169).** Before composing the contract, Chorus runs one bolt write:
`MERGE (s:AgentSession {id: $sessionId}) SET s.chorusProjectId, s.agent, s.model, s.startedAt,
s.writtenVia = 'app'`. The node is a third category — Chorus-written, append-only, never refreshed
or deleted (provenance edges hang off it), attribution not provenance. **That MERGE is the
reachability probe**: one round-trip answers "can this session write provenance" and "is the graph
up". On failure the MCP server is still wired, the launch proceeds, the log warns, and the Memory
section shows *"graph unreachable at launch — contract withheld"*. Measured cost when up: 4–12 ms
plus one write; bounded by the driver's 5 s connect timeout when down-but-listening. The probe is
bolt-level, never TCP (the 2 ms / 4.3 s measurement).

**The alternative considered:** keep emitting the contract when configured, adding the line *"if the
server is unreachable, say so once and carry on"*. [UNVERIFIED] The kickoff's reason for refusing it:
an agent told about a graph behind a stopped Docker Desktop tries once, fails, and learns for the
rest of the session that the feature is flaky — which is worse for adoption than not being told.

**A second alternative:** emit the contract regardless and let the 6b-3 auto-start make
"unreachable" rare. The drafts chose to gate *and* auto-start.

### Q5 — Cypher templates versus Chorus-owned tools

**The proposal (D169).** Contract v2 (18 lines, count pinned by a test) carries: the project id, the
workspace instance id, the repository id, **the session id**, the agent and model ids (so
`assertedByModel` / `assertedByAdapter` can be filled), the three tool names verbatim with the note
that they may need loading first, the `:Memory` property set verbatim (no `confidence`), and **three
single-line parameterised Cypher templates** — READ (full-text over current memories of this
project), WRITE (`CREATE (m:Memory {id: randomUUID(), …})`, `MATCH` the session and the cited
`:File` by `(workspaceInstanceId, relPath)` or `:Commit` by `(repoId, sha)`, create `PRODUCED` and
`SUPPORTED_BY`), SUPERSEDE (set `validTo` on the old node, link `SUPERSEDES`). The contract says in
words *"pass values as parameters; never paste text into the query"*, because agent-authored content
interpolated into Cypher is an injection site. [MEASURED] The READ template parses and runs on the
live Neo4j 5.26; the rendered single-line Codex form is ~5.5 k characters, 17 % of the Windows
command-line limit.

**The alternative the kickoff did not take, and wants your view on:** Chorus ships a small MCP server
of its own (or two extra tools beside the Cypher server) — `recall(topic)` returning current memories
of this project, and `remember(content, citedPaths | commitShas)` that creates the `:Memory`, the
`PRODUCED` edge from the session, and the `SUPPORTED_BY` edges, refusing an uncited write. Compliance
becomes a function signature instead of a Cypher template an LLM must copy correctly. Against it:
the 6.0 council's "no app-mediated graph writes; agents write through MCP; Chorus measures" —
[UNVERIFIED] whether a Chorus-owned MCP tool counts as "through MCP" in the spirit of that ruling; it
is more code to build and maintain; it hides the graph's shape from the agent; and the raw Cypher
tool would still exist beside it (F49: arbitrary Cypher can reshape the graph). For it: [UNVERIFIED]
an agent that must compose a three-clause Cypher `CREATE` with six parameters will get it wrong or
skip it more often than one that calls `remember(...)`; and the measured deferral means tool
discovery already costs a step either way.

### Q6 — Waiting for the container at launch

**The proposal (D170).** When the project's memory row is Chorus-provisioned (`local-docker`) and the
container is stopped, the launch path issues `docker start` (measured 358 ms to return) and polls
**bolt** readiness on a **wall-clock deadline of 20 s** (15 s budget + one in-flight 5 s probe;
measured 4.3 s to ready on a warm volume). During the wait the only surface is the launch dialog's
own busy state — there is no pane yet. On timeout the launch proceeds without the contract and the
Memory section says so. Containers the user configured as *existing* are never started by Chorus.
Boot-time start is refused: ~0.5–1 GB of heap per project for projects the user may not touch, and it
would be the app's first unattended Docker call. A prior decision said *"nothing runs unattended;
every docker call is user-initiated"*; the kickoff narrows it: **the launch is the click.**

**The alternative considered:** launch immediately without the contract, start the container in the
background, and deliver the contract *late* through a `UserPromptSubmit` hook's stdout once the
graph is up (the same vehicle as Q8). [UNVERIFIED] The kickoff judged a ≤ 5 s typical wait, once per
day, cheaper than a contract that arrives mid-conversation and is replayed on resume.

### Q7 — When the structural index refreshes

**The proposal (D170).** The indexer stamps the `:Project` node with `lastIndexedHead` (the commit it
indexed at). After a successful, reachable launch, if `git rev-parse HEAD` differs or the stamp is
absent, the index runs **once per (project, HEAD)**, in the background after the launch has returned,
behind an in-flight guard — 2.5–3.0 s measured, never on the launch's critical path. [MEASURED] At the
kickoff the graph was 21 commits behind HEAD with no way to tell. Refused, each for its own reason: a
timer (a prior ruling: refresh is manual only, because *"a watcher would fight the agents for the
database"*); a file watcher (same); a post-commit git hook (it writes into the user's repository,
which the 6.0 council forbade for `CLAUDE.md` and the kickoff reads as the same line); app start
(nothing runs unless a launch happened). The contract states the indexed head so the agent knows how
fresh the structural nodes are.

### Q8 — The write nudge

**The proposal (D171).** The hooks file gains a **second** entry under `UserPromptSubmit`: the same
curl **without `-o NUL`**, posting to a second route `/nudge/<token>`. The listener answers an
**empty body** unless a rule fires; when one does, the body — which becomes the hook's stdout and
therefore context the model sees — is **one factual line**, e.g. *"Project memory: this session has
made 0 graph reads and 0 memory writes so far; the graph is reachable."* Never an imperative, because
[INSPECTED] command-framed text trips the model's injection defences and is surfaced to the user.
v1 rules: never on the first prompt; only while both counters are zero; at most twice per session;
silent when the graph is unreachable. The events entry's `-o NUL` is untouched. **`Stop`-hook
continuation is refused** although it measurably works: every fire costs a full extra model turn;
[UNVERIFIED] an agent told it may not stop writes something to satisfy the gate — the "running
commentary" the contract forbids; the 8-continuation cap is a trap for a misfiring rule.
`PreCompact` cannot carry text. Codex has no hook bus and gets nothing. **Execution is conditional**:
the task is documented now because its vehicle is measured, but it runs only if the milestone fails
with the first three tasks landed; otherwise it is deferred and the deferral recorded.

**What the drafts flagged as open:** a non-`-o NUL` curl that exits non-zero (listener down) may show
a hook-error notice in the pane — to be measured and silenced before shipping; and [INSPECTED] the
vendor docs say injected text is replayed on `--resume`, so a "0 reads" line fired at turn 2 replays
forever in a resumed conversation — the rules above (no timestamps, ≤ 2 per session, only while zero)
are the drafts' mitigation.

---

## 5. Evidence appendix

### Live-probed on 2026-08-19 (strong)

- Transcript tally: walk `~/.claude/projects/**/*.jsonl`, count `tool_use` blocks whose `name`
  starts `mcp__chorus-memory__`, grouped by session file and day → 20 before the 19th across 4
  sessions, 0 `write_neo4j_cypher`; codex `McpToolCall` entries → 5.
- Graph counts: `MATCH (n) RETURN labels(n), count(*)` over bolt → 468/200/37/1/0; `SHOW INDEXES`
  lists `session_id_unique` on `:AgentSession`, `memory_text` FULLTEXT on `:Memory(content)`, and a
  foreign FULLTEXT `search` on `:Memory(name,type,observations)` created outside Chorus's schema.
- Installed and dev SQLite databases read through Electron-as-node against copies (WAL files
  included): installed 0 `project_memory` rows, dev 1; both at migration 20.
- Hook bodies and stdout semantics: three `claude -p --model haiku --no-session-persistence
  --strict-mcp-config --settings <file>` runs on claude 2.1.235 with node hook scripts logging body
  keys and printing controlled stdout; outputs kept under the repository's ignored `_verify/6b-4/`.
- Bolt/TCP timing: a node script polling `net.connect` and `neo4j-driver.verifyConnectivity` every
  250 ms after `docker start` of the real container: `{tcpReadyMs: 2, boltReadyMs: 4296}`; the
  container was left running and the graph re-counted intact (710 nodes).

### Inspected only (weaker)

- The vendor hooks reference (fetched 2026-08-19): exit-0 stdout handling per event; the decision
  table (`PreCompact` block-only; `Stop` `decision`/`additionalContext`); parallel execution of
  hooks on one event; the prompt-injection framing note; the resume-replay note; the 10,000-character
  cap on injected values.
- Code: the listener's `-o NUL` rationale, the edge filter, the contract's seven lines, the
  validator's two-edge definition, the `:Memory` property set, the driver's 5 s connect timeout, the
  indexer's 200-commit window and its "never deletes a node" rule.

### Unverified

- Every behavioural prediction about how an agent responds to a withheld contract, a late contract,
  a Stop-hook continuation, or a Cypher template versus a purpose-built tool. None has been A/B
  measured; the milestone is the first measurement.

---

## 6. Required Output Format

Answer each question separately, in this shape:

```
Q1: AGREE | DISAGREE | QUALIFY
<your reasoning, a few short paragraphs>

Q2: AGREE | DISAGREE | QUALIFY
<your reasoning, a few short paragraphs>

… through Q8.
```

Begin each answer with the verdict token on its own line as shown — the app counts those tokens to
summarise where the council agreed. Interpret **AGREE** as "yes, do what the question proposes",
**DISAGREE** as "no, do not", and **QUALIFY** as "yes, but only under conditions you then state".

For Q5 and Q6 state explicitly which alternative you would take if you DISAGREE. For Q3 name any tool
you would add to or remove from the exploration set. For Q8, if you QUALIFY, state the rule set you
would ship instead.

**Answer these questions. Do not review this document.**
