# Phase 6b — Memory Adoption & Measurement — Task Overview

**Kicked off 2026-08-19** against the verified codebase at **`a3ba6f9`** (v0.7.2 + the docs commit that
carries D167 / F89–F91), the day the memory-usage audit answered Matthew's question — *"do we know
that Claude is writing to it and reading from it frequently?"* — with a measured **no**. **Scope
authority is the roadmap's Phase 6b entry (D167) as refined by the five decisions this kickoff
settled, D168–D172.** This overview adds what a roadmap row cannot: the code as it stands now, the
measurements the decisions rest on, and the one binary test that decides whether the phase worked.

## The one thing to read before this document

**The premise is measured, not argued, and it must be re-measured before anything is built on it.**
Phase 6a proved an agent *can* use the graph when a prompt points at it. The audit (roadmap §7 Phase
6b, F89–F91) measured what happens when nobody points: **zero agent writes ever, reads only inside
prompted drives, and the installed app has no project with memory configured.** Every number below was
re-taken by this kickoff with the method beside it. A later session that cannot reproduce a number
reports that, rather than inheriting it.

## Verified ground facts — every one checked 2026-08-19 at `a3ba6f9`

| Fact | Where | Value |
|---|---|---|
| Baseline gates | — | typecheck **0** (node + web) · vitest **2618 / 2618 across 74 files** · `grep:secrets` **clean (6 patterns)** |
| `IpcChannel` keys | `src/shared/ipc.test.ts:3510`, `:3897` | **107** — both assertions move together |
| `MIGRATIONS.length` | `src/main/services/storage.ts:174` (`const MIGRATIONS: string[]`), **AST-parsed** | **20**; next free **v21** — and G6 was run: installed DB (`%APPDATA%\chorus-app\chorus.db`) and dev DB (`%APPDATA%\chorus\chorus.db`) both at `MAX(version)=20`; no sibling branch's array exceeds 20 |
| `sqliteTable(` | `src/main/db/schema.ts` | **19**; `sessions` at `:68` has **no `model` column**; `project_memory` at `:662` |
| Runtime dependencies | `package.json` | **9** (`uiohook-napi` since Task 5-3) — **this phase adds none** |
| `LATEST_GRAPH_VERSION` | `graphSchemaCore.test.ts:78` | **2**, derived — **this phase adds no graph migration** (a property on a node is not schema) |
| App version | `package.json` | **0.7.2** |
| Decisions / findings | roadmap §6 / §5 | **D168–D172** and **F92–F93** written by this kickoff; next free **D173 / F94** |
| The contract | `src/main/adapters/instructionsCore.ts:26` | **7 lines**; no project id, no property set, no session id, no Cypher, no tool names (F89, F92) |
| Where it is composed | `src/main/ipc.ts:728` `withMcpEnv` · `:749` · `:823` `renderInstructionsFor` | gated **only** on `memory.mcpLaunchInput(project.id) !== null` — *configured*, not *reachable* |
| Claude vehicle | `src/main/adapters/claude.ts:253` | `--append-system-prompt-file` (D148); hook command `:200` is `curl -s -o NUL -m 2 …` — **hook stdout deliberately discarded** |
| The listener's read surface | `agentEventsCore.ts:219` `readHookEventName` · `:248` `readTranscriptPath` | **`tool_name` is dropped by design (D130)**; `contextUsage.ts:1–60` is the precedent for a documented one-field widening |
| Where a count must hang | `agentEvents.ts:198` | `record()`'s edge filter collapses twenty tool calls into one callback (F55/F56); `onTranscriptPath` (`:164`; impl `:377`) is the non-edge-triggered precedent, fired from `handle()` (`:229`) at `:276` **before** `record()` (`:181`) |
| `validate`'s definition | `provenanceCore.ts:196–211` | denominator `chorusProjectId = $projectId AND validTo IS NULL`; numerator requires **both** `SUPPORTED_BY`→`:File|:Commit` **and** `(:AgentSession)-[:PRODUCED]->` |
| `:AgentSession` | `graphSchemaCore.ts:69` | the **only** place the label exists — **nothing writes one** |
| `:Memory` property set | `provenanceCore.ts:174` `memoryWriteParams` | `id · content · chorusProjectId · writtenVia · assertedByModel · assertedByAdapter · validFrom · validTo` — **no `confidence`, in any form (D94.3)** |
| Indexer freshness | `codeIndexCore.ts:313` `UPSERT_PROJECT` | writes `p.lastIndexedAt = $runId` (a timestamp) — **no head SHA**; last full run **2.5–3.0 s** for 447–468 files + 200 commits (`_verify/6a-2/drive-index-output.txt`) |
| Reachability probe | `neo4jClient.ts:139` `probe` · `:53` `CONNECT_TIMEOUT_MS = 5000` | already exists, bolt-level; measured **4–12 ms** up, **<1 ms** refused |
| Memory service entry points | `memoryService.ts` `provision` :643 · `containerStatus` :776 · `containerStart` :780 · `test` :827 · `index` :929 · `validate` :1058 | all **user-initiated only** today (D149(c), D151(c)) |
| `.mcp.json` | `git ls-files` | **tracked** (`47f633c`); Chorus merge-writes it at every launch (`mcpConfigWrite.ts:28`) — stays so (D172) |

### D4 versions, probed this session rather than inherited

`claude` **2.1.235** (`~/.local/bin/claude`) · `codex-cli` **0.148.0** · `docker` container `chorus-g2-neo4j`
(restart policy `no`, `127.0.0.1:7688→7687`, two anonymous volumes). Claude moved 2.1.232 → 2.1.235
since the 6a kickoff; **every hook measurement below was taken on 2.1.235 and is re-taken by the
task that depends on it** (CLAUDE.md: flags move fast; so do hook semantics).

### The memory baseline, re-measured this session — the numbers every later claim is checked against

| Fact | Value | Method |
|---|---|---|
| Graph | **468 `:File` · 200 `:Commit` · 37 `:Directory` · 1 `:Memory` · 0 `:AgentSession`** (+2 `:ChorusMigration`, 1 `:ChorusSchema`, 1 `:Project` = 710 nodes); `lastIndexedAt` 2026-08-15T21:50Z; newest indexed commit `78c0893` — **HEAD is 21 commits ahead** | `MATCH (n) RETURN labels(n), count(*)` via the `chorus-memory` MCP tool |
| The one `:Memory` | the Task 6-5 canary — no `chorusProjectId`, 0 `PRODUCED`, 0 `SUPPORTED_BY` → `validate` **0 of 0** | `MATCH (m:Memory) OPTIONAL MATCH (:AgentSession)-[pr:PRODUCED]->(m) …` |
| Foreign index | FULLTEXT `search` on `:Memory(name,type,observations)` still present (F49 in the wild) | `SHOW INDEXES` |
| Claude Code transcripts | **20 `chorus-memory` calls before 2026-08-19** (4 sessions, 14–15 Aug), **+10 on the 19th** from the audit and kickoff sessions themselves; **`write_neo4j_cypher`: 0, ever**; by name `read_neo4j_cypher` 28, `get_neo4j_schema` 2 | walk `~/.claude/projects/**/*.jsonl` (384 files), count `tool_use` blocks whose `name` starts `mcp__chorus-memory__` |
| Codex transcripts | **5** (2 resource listings, 2 `get_neo4j_schema`, 1 `read_neo4j_cypher`), 14–15 Aug | `~/.codex/sessions/**/*.jsonl` (345 files), `McpToolCall` entries |
| Installed app | **0 `project_memory` rows**; 6 projects; 9 sessions total, **6 in the last 7 days across 3 projects** (F90's "12 across 5" did not reproduce — the zero did) | `ELECTRON_RUN_AS_NODE=1 electron.exe <script>` requiring the repo's `better-sqlite3`, against a copy of `%APPDATA%\chorus-app\chorus.db` (the one whose mtime moves) |
| Dev DB | **1 row** — project `a43b395d…` (Chorus) → `bolt://127.0.0.1:7688`, mode `existing`, auth `none`, container columns NULL | same, against `%APPDATA%\chorus\chorus.db` |
| Container start | `docker start` returns in **358 ms**; TCP accepts at **2 ms**; **bolt ready at 4.3 s** (F93 — a TCP probe is a false positive for the whole boot) | stop → start → poll with `net.connect` and `verifyConnectivity` |

### ⚠ WHAT THE HOOK MEASUREMENTS SAID, AND WHY THEY CHANGE THE PLAN

Run on claude 2.1.235 with `claude -p --model haiku --no-session-persistence --strict-mcp-config
--settings <hooks.json>` from an empty directory (hook paths with forward slashes — backslashes inside
JSON strings are escapes, and the first attempt silently loaded no hooks at all):

1. **`PostToolUse` carries `tool_name` = `mcp__chorus-memory__read_neo4j_cypher` verbatim** (plus
   `tool_use_id`, `tool_input`, `tool_response`, `duration_ms`). The count 6b-1 needs is one string
   compare away — and the string is never stored.
2. **MCP tools are DEFERRED (F92).** The `PreToolUse` stream was `ToolSearch` *first*, then the MCP
   tool: the agent had to load the tool's schema before it could call it. A contract that does not
   name the tools is asking the agent to use tools it cannot see. 6b-2 names them.
3. **`UserPromptSubmit` plain stdout reaches the model** (a hook printed a codeword; the model
   repeated it). That is the nudge vehicle (D171), and it costs no extra turn.
4. **A `Stop` hook's `hookSpecificOutput.additionalContext` continues the turn** (the model appended
   the asked-for word), with `stop_hook_active` `false` → `true` across the two fires and a
   documented 8-continuation cap. **Refused as the nudge vehicle** — every fire is a full extra model
   turn, and an agent told it may not stop writes something to satisfy the gate.
5. **`PreCompact` cannot carry text** (its only decision is `block`). Not a vehicle.

## The decisions this kickoff settles — D168 … D172, and the council's D173

Full text in roadmap §6; the one-line versions, with the task that owns each. **Every row below is as amended by
D173 (CR-6b.0, 2026-08-19) — read the roadmap row's "⚠ AMENDED BY D173" clause before building on the one-liner.**

| Decision | Settles | Owner |
|---|---|---|
| **D168** | `tool_name` is read off `PostToolUse` — name only, compared against fixed sets and dropped; **`PostToolUse` is a successful tool result (measured: an MCP error fires `PostToolUseFailure`)**; per-session counters + ordinals; persisted as **five** `sessions` columns (**v21**: reads, writes, read-first, read-inconclusive, shell-first), monotonic `MAX()` per receipt; the pass/fail exploration set is `Read`/`Glob`/`Grep`/`LS`/the delegation tool — **`Bash` is a separate diagnostic, an unknown tool before the first read makes the result inconclusive**; the aggregate is labelled *"… across K **Claude Code** sessions observed since <date>"* (lower bound after restart); counted **before** the edge filter. **[CR] discharged through CR-6b.0 (D173).** | 6b-1 |
| **D169** | Chorus MERGEs `(:AgentSession {id: sessions.id})` at launch; **that MERGE is the reachability probe** (bolt-level, never TCP — F93); on failure the contract is **withheld**, the MCP wiring and the launch proceed, the pane says so. Contract v2 carries ids, the three tool names (F92), the `:Memory` property set, three parameterised templates; codex stays one physical line; count pinned. **D173: the WRITE template is self-verifying (returns the id and the `PRODUCED` / `SUPPORTED_BY` counts; an empty result means nothing was written); the validator is the write-side milestone evidence; `recall`/`remember` tools are the pre-registered escalation, a future decision.** | 6b-2 |
| **D170** | Always-on is **launch-time only** — D149(c)/D151(c) narrowed, not discarded: `docker start` + a 20 s wall-clock bolt-wait for Chorus-provisioned containers (`mode = 'local-docker'`; `existing` never started; the launch dialog's busy state is the only surface during the wait); `p.lastIndexedHead` + a once-per-HEAD background index after a reachable launch; no timer, watcher, git hook or boot action; adoption on the installed app is an **act** in 6b-3's drive. **D173: fail-fast when `docker start` fails (no bolt poll); a cancel button for the wait was declined by Matthew — revisit if the installed-app drive measures > 10 s.** | 6b-3 |
| **D171** | The nudge is a **second `UserPromptSubmit` hook entry without `-o NUL`** whose stdout is the listener's response body — one factual line from 6b-1's counters, never imperative; `Stop`-blocking refused; `PreCompact` not a vehicle; codex none; **executes only if 6b-3's milestone drive still shows 0 writes**. **D173: if it ever activates — once per session, also on reads-without-writes, only when the contract was emitted and the graph is reachable, an invariant line with no counters/timestamps (replayed on resume); a pane-visible hook error is a hard gate; "build the route now, disabled" was declined — disabled means the entry is not written.** | 6b-4 |
| **D172** | `.mcp.json` stays committed (D147(4) reaffirmed — git cannot close the "tool without contract" gap; 6b-2's contract does). | — |

### ⚠ THE [CR] IS CLOSED — CR-6b.0 RAN ON 2026-08-19 AND IS RECORDED AS D173

The kickoff chose Matthew's ratification over a council for D168; Matthew chose the council for all
four decisions and the drafts' judgement calls. Brief: [`../CouncilBriefs/CouncilBrief-6b.0-AdoptionDrafts.md`](../CouncilBriefs/CouncilBrief-6b.0-AdoptionDrafts.md)
(eight questions, parsed to exactly 8 by the app's own `parseBriefQuestions`); findings:
[`../CouncilBriefs/CouncilBrief-6b.0-AdoptionDrafts-Findings.md`](../CouncilBriefs/CouncilBrief-6b.0-AdoptionDrafts-Findings.md)
(4 members + arbiter; **Q4 and Q7 AGREE, six QUALIFY, none DISAGREE** at arbiter level). **D173** records
what was adopted (folded into D168–D171 and the four task documents), what was already in the drafts
and merely cited, and the **two qualifications Matthew declined with reasons** — a cancel button for the
launch wait, and a "dormant" nudge route written in advance — both revisitable. **The one [UNVERIFIED]
item the council ranked first — whether `PostToolUse` fires for a failed query — was measured the same
day: it does not; an MCP error result fires `PostToolUseFailure`** (`_verify/6b-4/hookprobe/ptf.log`).
**6b-1 may start.** One open item rides with 6b-2's drive: the owner of the foreign `search` FULLTEXT
index on `:Memory` (a second writer reached port 7688 on 2026-08-18) is unidentified; Matthew is asked.

## The tasks

Ordered so **measurement lands first** — nothing else in the phase can be proven without it — then the
contract and session identity, then always-on, then the nudge or its deferral. **Each depends on the
previous one having landed**: 6b-1, 6b-2 and 6b-3 all edit `src/main/ipc.ts` and `src/shared/ipc.ts`,
and 6b-4 reads 6b-1's counters. They are not parallelisable and the docs do not pretend otherwise.

| Task | Scope | Decision | Migration | Depends on |
|---|---|---|---|---|
| **[6b-1](Task-6b-1.md)** | **Measure.** `tool_name` reader + pure classifiers (memory read/write · exploration set without `Bash` · shell diagnostic · unknown → inconclusive); per-session in-memory record fired from `handle()` before the edge filter; five `sessions` columns; Claude-Code-scoped aggregate beside the provenance ratio with its denominator; the listener's header re-stated. | D168 + D173 | **v21** — `memory_reads`, `memory_writes`, `memory_read_first`, `memory_read_inconclusive`, `memory_shell_first` on `sessions` | None (D168 ratified via D173) |
| **[6b-2](Task-6b-2.md)** | **Contract v2 + `:AgentSession` + the reachable gate.** One MERGE in `withMcpEnv` that is also the probe; contract withheld on failure; `memoryContractLines(ctx)` with ids, tool names, property set, three parameterised single-line templates; codex still one line; length measured. | D169 (F89, F92, F93) | none | 6b-1 |
| **[6b-3](Task-6b-3.md)** | **Always on, at launch.** `docker start` + a wall-clock-bounded bolt-wait for `local-docker` rows; `p.lastIndexedHead` read in 6b-2's MERGE round-trip; once-per-HEAD background index after a reachable launch (`memory:freshness`); the installed-app adoption drive. | D170 (F90) | none (graph property) | 6b-2 |
| **[6b-4](Task-6b-4.md)** | **Write nudge — CONDITIONAL.** `POST /nudge/<token>` route; second `UserPromptSubmit` entry without `-o NUL`; one invariant factual line (no counters/timestamps), at most once per session; nothing is written until three hard gates pass. | D171 + D173 | none | 6b-3, its installed-app drive recording writes = 0, listener-down behaviour measured silent, and Matthew's authorisation |

**⚠ THE FOUR TASK DOCUMENTS WERE AUTHORED IN PARALLEL AGAINST `a3ba6f9`, SO EACH LATER TASK RE-VERIFIES
THE EARLIER ONE'S LANDED SHAPE BEFORE EDITING.** Concretely: 6b-2 gives `withMcpEnv` a fifth
`sessionId` parameter and moves `renderInstructionsFor` into `instructionsCore.ts`; 6b-3 builds its
start-wait and index trigger around *that* `withMcpEnv`, not the one at `ipc.ts:728` today; 6b-4
reads 6b-1's per-session record by whatever name 6b-1 shipped and derives "reachable" from 6b-2's
gate. Every line number in a later task's *Initial Starting Point* is a kickoff-day pointer and is
re-taken at pickup (G6) — the documents say so, and an implementer who skips that step will edit the
wrong line. `IpcChannel` moves **107 → 108** in 6b-1, **108 → 109** in 6b-2 (`memory:launch`) and **109 → 110**
in 6b-3 (`memory:freshness`); 6b-4 adds no channel — each doc re-counts at pickup.

**⚠ ONE MIGRATION IN THIS PHASE, AND IT IS 6b-1's.** `MIGRATIONS.length` moves 20 → 21 exactly once;
6b-2, 6b-3 and 6b-4 add no SQLite migration and no graph migration (an `:AgentSession` node and a
`lastIndexedHead` property are data, not schema — `session_id_unique` already exists). **If a later
task nonetheless finds it needs one, the number is confirmed at the moment of writing against
`storage.ts`, the dev DB's `SELECT MAX(version) FROM schema_migrations`, and every sibling worktree
(G6 — dev worktrees share one DB) — never quoted from here.**

## The milestone — a binary test, read off 6b-1's counters and never off a transcript

**A session launched from the INSTALLED app, on an ordinary coding task whose prompt never names the
graph:**

1. makes **≥ 1 graph read before filesystem exploration** — `memory_read_first = 1` on the session's
   row (6b-1's ordinal comparison: a successful `chorus-memory` read exists and precedes the first
   successful call to a tool in the exploration set — `Read`/`Glob`/`Grep`/`LS`/the delegation tool;
   `Bash` is a separate diagnostic; an unknown tool before the first read makes the result
   **inconclusive**, which is not a pass — D173), **and**
2. makes **≥ 1 sourced `:Memory` write** — `memory_writes ≥ 1` on the row (a successful write-tool
   call) **and, decisively,** `memory:validate` reads **N of N with N ≥ 1** for that project (the write carried `PRODUCED` from the session's own
   `:AgentSession` and `SUPPORTED_BY` to a `:File` or `:Commit` that exists).

**Pass/fail is decided by those three numbers**, re-read after the session ends, with their
denominators (D55): the row, the project's aggregate line, and `validate`'s ratio. Reading the
transcript to "confirm" a pass is not permitted — the point of 6b-1 is that the instrument is the
counters. **Preconditions, each recorded as done or not done:** the installed build carries 6b-1..3;
the installed Chorus's own *Chorus* project has memory provisioned (the 6a-4 provisioner, a volume on
loopback) and the `chorus-memory` server approved once; the container auto-started at launch; the
contract was emitted (the MERGE succeeded). If the test fails with 6b-1..3 landed, 6b-4 runs; if it
passes, 6b-4 is deferred and the deferral recorded.

## The purity contract for this phase

- **No `confidence` field, in any form** (D94.3) — provenance is `assertedBy` + derived
  `corroborations`, never a self-graded number. The word does not appear in any new contract line.
- **No writing into the user's files** (D49, D147(e)) — the contract travels by session-level
  injection; a `CLAUDE.md` block stays an explicit opt-in; no git hook is written into a repository
  (which is why per-commit index refresh was refused — D170).
- **One graph per project, two label namespaces** (D147(c)) — structural nodes are machine-written and
  refreshed wholesale; `:Memory` is never deleted by Chorus; **`:AgentSession` is a third category:
  Chorus-written, append-only, never refreshed, never deleted** (D169).
- **No `dockerode`** (D147(d)); **containers may be started and removed, volumes never** (D151);
  **`mode = 'existing'` containers are never started by Chorus** (D170).
- **Parameters, never interpolated Cypher**, for agent-authored text — and every template the contract
  hands an agent says so in words (D169).
- **The codex contract is one physical line** (`assertSingleLine`); a raw newline is silently dropped
  with the whole `-c` value.
- **Hook bodies are untrusted input** (D83): every new field read is length-capped and shape-checked;
  **the listener never widens silently** — the header states the new truth (D168).
- **D55 — no number without its denominator.** "12 reads" is not a fact; "12 reads across 3 sessions
  since 2026-08-20" is.
- **All IPC Zod-validated in main only**; payloads across the bridge are plain objects (snapshot
  before sending). **No new npm dependency.** No new renderer route.
- **Nothing in 6b may claim durability** (F49 — export/restore is still open and not this phase's).
- **The `-o NUL` events hook entry is never touched**; the nudge is a second entry on a second route.

## Verification every task runs

```
npm run typecheck          # 0 errors, node + web
npx vitest run             # never fewer than 2618 / 74 (the kickoff baseline) plus the task's own tests
npm run grep:secrets       # clean, 6 patterns
docker ps -a --filter name=chorus-g2-neo4j --format '{{.Status}}'   # dev drives need it Up: docker start chorus-g2-neo4j
```

Plus, per task, the runtime drive named in its own Verification Commands section — **this project does
not accept a compiled feature as a delivered one** (roadmap §3, step 4). Every drive ends with the
container left **running** and with exact outputs captured; **the failure-honesty clause applies**: a
command that fails for any reason, including an environmental one (Docker Desktop down, ABI mismatch,
locked DB, missing CLI), is reported with its output and the step is not claimed.

## ⚠ Pre-existing working-tree state at kickoff

`git status` at `a3ba6f9` was **clean**; this kickoff's own edits are `docs/Features/Foundation/roadmap.md`
(D168–D172, F92–F93, the Phase 6b section, the gate re-run) and the new documents under `Tasks/` and
`ImplementationSpecs/`. **Any task that finds other modified files must report them rather than
reverting or absorbing them.** Two test sessions from the kickoff's hook experiments ran with
`--no-session-persistence` and left nothing under `~/.claude/projects`; the hook probe scripts live in
the kickoff session's scratchpad, not in the repository.
