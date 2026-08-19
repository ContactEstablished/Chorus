# Phase 6b — Memory Adoption & Measurement: Kickoff Prompt

_Generated 2026-08-19 against `main` at `f9a01fe` (v0.7.2 + D166). Paste the body below into a **fresh** conversation._

> **⚠ THIS IS A PHASE KICKOFF, NOT A TASK EXECUTION PROMPT.** Phase 6b was created by **D167** on 2026-08-19 and has **never been decomposed** — there are no `Task-6b-*.md` docs and no implementation specs. The new session's job is to verify the ground, settle the kickoff decisions, and produce the task documents. It is **not** to start writing feature code.
>
> **⚠ AND THE PREMISE IS MEASURED, NOT ARGUED.** Phase 6a proved an agent *can* use the graph. The 2026-08-19 audit measured that it *does not*: **zero agent writes ever, reads only when a prompt named the graph, and the installed app has no project with memory switched on.** Every number is in the roadmap's Phase 6b section with the method that produced it. Re-measure before you build on it.

---

## PROMPT BODY — copy everything below this line

---

You are the **Coordinator** for Chorus **Phase 6b — Memory Adoption & Measurement**. Your job this session is to **kick the phase off**: verify the ground, settle the kickoff decisions, and produce the phase's task documents via `/phase-kickoff`. **Do not implement feature code this session.**

Repository root: `C:\Projects\ContactEstablished\Chorus`
Expected branch: **`main`** — confirm with `git branch --show-current`. **Do not switch or create a branch without instruction.**
Expected HEAD at start: `f9a01fe` ("The red ring around a pane now shows only while you are dictating") **or a later docs-only commit carrying D167 / F89–F91 / the Phase 6b section**. If HEAD differs, re-verify every fact below before relying on it.

## 1. Read these first

- `CLAUDE.md` — locked architecture. Sessions live in main; all IPC is Zod-validated **in main only**; no new dependencies without asking; **CLI flags are verified against `--help`, never recalled**.
- `docs/Features/Foundation/roadmap.md` — **§7 Phase 6b** (the entry this prompt serves), **§6 D167** (creation + ordering), **D147 / D148 / D149 / D150 / D151** (the 6a settlements this phase refines), **D130** (the hook listener's read surface — the one this phase asks to widen by one field), **D94.3** (no confidence field), **D49** (no writing into the user's CLAUDE.md/AGENTS.md), **D55** (no number without its denominator); findings **F49**, **F89**, **F90**, **F91**, **F55/F56**.
- `docs/Features/Foundation/Phase-6a-Proposal.md` and `Phase-6-IdentityModel.md` — the identity rules every new node must obey (`wt:`/`pj:` instance ids, `repoId` = lexicographically-smallest root SHA).
- The Phase 6a documents (`Tasks/Phase-6a-Overview.md`, `Tasks/Task-6a-*.md`, the paired specs) are the **format precedent** for what you are about to write.

## 2. What already exists — verify each before building on it

| Path | What |
|---|---|
| `src/main/adapters/instructionsCore.ts:26` | `memoryContractLines()` — the 7-line usage contract. **Carries no projectId, no `:Memory` property list, no session id, no Cypher; tells the agent to link `PRODUCED` from "your own :AgentSession node"** |
| `src/main/ipc.ts:728` `withMcpEnv` · `:749` · `:823` `renderInstructionsFor` | composes the contract per launch; gated **only** on `memory.mcpLaunchInput(project.id) !== null` — *configured*, not *reachable* |
| `src/main/adapters/claude.ts:253–265` | `--append-system-prompt-file` vehicle (D148); codex is `-c developer_instructions` on ONE physical line (`assertSingleLine`) |
| `src/main/adapters/claude.ts:222` | the hook command: `curl -s -o NUL -m 2 …` — **hook stdout is deliberately discarded** (a hook's stdout is a Claude Code control channel) |
| `src/main/services/agentEventsCore.ts:57` `WORKING_EVENTS` · `:114` `NEEDS_YOU_EVENTS` · `:221` `readHookEventName` · `:250` `readTranscriptPath` | the listener reads `hook_event_name` and `transcript_path` and **nothing else** — `tool_name` is dropped by design (D130). `contextUsage.ts` is the precedent for a documented one-field widening |
| `src/main/services/provenanceCore.ts:196–211` | `validate`'s queries: denominator `chorusProjectId = $projectId AND validTo IS NULL`; numerator requires **both** `SUPPORTED_BY`→`:File|:Commit` **and** `(:AgentSession)-[:PRODUCED]->` |
| `src/main/services/graphSchemaCore.ts:69` | `session_id_unique` on `:AgentSession` — **the only place the label exists; nothing writes one** |
| `src/main/services/memoryService.ts` — `provision` :643 · `containerStatus` :776 · `containerStart` :780 · `index` :929 · `validate` :1058 | all **user-initiated only**, reached from `ipc.ts:4082–4229` (`memory:*` channels, `src/shared/ipc.ts:465–593`) |
| `src/main/services/codeIndexCore.ts:313` `UPSERT_PROJECT` | writes `p.lastIndexedAt = $runId` — the freshness fact a launch-time refresh can compare against `git rev-parse HEAD` |
| `src/main/db/schema.ts:662` `project_memory` | one row per project; `container_name` / `bolt_port` etc. are observed facts, no password column ever |
| `.mcp.json` (tracked since `47f633c`) | every Claude Code session in the repo — Chorus-launched or not — gets the `chorus-memory` tool; **only Chorus launches get the contract** |

**Not built, and not started:** read/write counters, `:AgentSession` creation, any reachability gate, container auto-start, launch-time index refresh, any hook-driven write nudge, adoption on the installed app's projects.

## 3. ⚠ THE KICKOFF DECISIONS — SETTLE THESE BEFORE DECOMPOSING

Record each as a numbered decision. **Next free is D168 — verify with BOTH patterns** (grep the table column `^| D<n>` *and* inline `**D<n>` references; check uncommitted edits and sibling branches — the roadmap's G6 note). Next free finding is **F92**.

1. **The D130 widening.** Reading `tool_name` (name only — never `tool_input`, never the prompt) from `PreToolUse`/`PostToolUse` bodies, filtered to `mcp__chorus-memory__*`, to count graph reads and writes per session. State the security argument the way `transcript_path`'s was stated: what is taken, what is never taken, where it is stored, what can leak. **This is a [CR] surface** — say whether it goes to the in-app council or is settled by Matthew.
2. **"Configured" → "configured AND reachable".** D148 emits the contract when `mcpLaunchInput !== null`. Today that tells an agent about a graph behind a stopped Docker Desktop. Decide: probe bolt before composing the contract (cost: one connect per launch), or keep D148 and add a line to the contract ("if the server is unreachable, say so once and carry on"). Measure the probe cost before choosing.
3. **The write nudge vehicle.** Claude Code hooks can inject context on `UserPromptSubmit`/`SessionStart` (stdout) and can block on `Stop` — but Chorus's hook command discards stdout **on purpose**. A nudge therefore needs a **second** hook entry whose stdout IS the nudge, and that must be **D4-verified against the installed claude's actual hook semantics** (which events add stdout to context; what a `Stop` hook's `{"decision":"block"}` does; whether `PreCompact` can carry text). Decide the vehicle or decide to defer 6b-4 — never guess from training-data memory.
4. **Index refresh cadence.** Per launch when `HEAD != lastIndexedAt`'s commit, or per commit via a git hook, or on a timer. The indexer walks 468 files + 200 commits in seconds; decide what "stale" means and where the check lives.
5. **`.mcp.json` stays committed?** It is how this repo gives *every* Claude Code session the tool; it is also how a session gets the tool *without* the contract. Decide, and record why.

**Do not decompose before 1–3 are settled**: a phase that counts reads and a phase that cannot are different phases.

## 4. Constraints that must survive decomposition

- **NO `confidence` FIELD, IN ANY FORM** (D94.3) — provenance is `assertedBy` + derived `corroborations`, never a self-graded number.
- **NO WRITING INTO THE USER'S FILES** (D49, D147(e)) — the contract travels by session-level injection; a `CLAUDE.md` block stays an explicit opt-in, never a default.
- **ONE GRAPH PER PROJECT, TWO LABEL NAMESPACES** (D147(c)) — structural nodes are machine-written and refreshed wholesale; `:Memory` is never deleted by Chorus.
- **NO `dockerode`** (D147(d)) — the `docker` CLI adapter is the mechanism. **Containers may be removed, volumes never** (D151).
- **PARAMETERS, NEVER INTERPOLATED CYPHER** for agent-authored text (`provenanceCore.memoryWriteParams`) — and any Cypher template handed to an agent must say so.
- **THE CODEX CONTRACT IS ONE PHYSICAL LINE** (`assertSingleLine`) — a longer contract must still render to one line for codex; a raw newline is silently dropped with the whole `-c` value.
- **HOOK BODIES ARE UNTRUSTED INPUT** (D83 precedent) — any new field read is length-capped and shape-checked, and the listener never widens silently.
- **D55 — no number without its denominator.** "12 reads" is meaningless; "12 reads across 3 sessions since <date>" is a fact.
- **All IPC Zod-validated in main only**; payloads across the bridge are plain objects. **No new npm dependency** without asking.

## 5. Facts to re-verify yourself (do not inherit these)

Measured at `f9a01fe`, 2026-08-19; confirm each and report any that moved:

| Fact | Value |
|---|---|
| `IpcChannel` | **107** — `src/shared/ipc.test.ts:3510` |
| `MIGRATIONS.length` | **20**, next free **v21** — ⚠ **PARSE the array with the TS AST, never grep it** (`src/main/services/storage.ts:174`) |
| `sqliteTable(` | **19** |
| Runtime dependencies | **9** (`uiohook-napi` since Task 5-3) |
| `LATEST_GRAPH_VERSION` | **2** |
| App version | **0.7.2** |
| Highest decision | **D167** (after this pass) |
| Highest finding | **F91** (after this pass) |
| vitest / typecheck | last measured **2554 / 74 files**, **0 errors** after Task 5-4 — **NOT re-run by the 2026-08-19 architect pass**; re-run |

**The memory baseline, measured 2026-08-19 — re-measure with the same method before claiming any improvement:**

| Fact | Value | Method |
|---|---|---|
| Installed app `project_memory` rows | **0** (`%APPDATA%\chorus-app\chorus.db`) | read via `ELECTRON_RUN_AS_NODE=1 electron.exe <script>` (node's ABI cannot load the repo's better-sqlite3); the installed DB is the one whose mtime is moving — five `chorus.db` files exist on this machine |
| Dev DB `project_memory` rows | **1** — Chorus → `bolt://127.0.0.1:7688`, mode `existing`, `chorus-g2-neo4j`, restart policy `no` | same |
| Graph | **468 File · 200 Commit · 37 Directory · 1 Memory · 0 AgentSession**; `lastIndexedAt` 2026-08-15T21:50Z | `MATCH (n) RETURN labels(n), count(*)` via the `chorus-memory` MCP tool (container must be up: `docker start chorus-g2-neo4j`) |
| Agent `chorus-memory` tool calls, all time | claude **20 reads / 0 writes** (14–15 Aug, 4 sessions, all prompted drives) · codex **5** (one prompted drive) | walk `~/.claude/projects/**/*.jsonl`, count `tool_use` blocks whose `name` starts `mcp__chorus-memory__`; codex: `"type":"McpToolCall"` in `~/.codex/sessions/**` |
| `validate` | **0 of 0** | the canary lacks `chorusProjectId` |

**G6 applies to any migration this phase takes:** check every sibling branch and worktree, and the dev DB's own `SELECT MAX(version)`, before claiming a version. Dev worktrees share one DB.

## 6. Findings this phase inherits

- **F89** — the contract is un-compliable as written: no projectId, no property set, no session id, no `:AgentSession` node → a diligent agent's memory is invisible to `validate`, and the provenance ratio is 0% by construction. 6b-2 owns it.
- **F90** — the feature has never been on in daily use, and everything that would keep it on (container start, index, validate) is a button. 6b-3 owns it.
- **F91** — reads are unmeasurable: `tool_name` is dropped by design, Neo4j's query log is off, and the only number is write-side provenance. A foreign fulltext index `search` on `:Memory(name,type,observations)` — the signature of the `mcp-neo4j-memory` server — appeared in the graph on 2026-08-18 19:39Z from outside Chorus's schema: **F49 in the wild** (arbitrary Cypher can reshape the graph and the graph cannot tell you). 6b-1 owns measurement; the F49 backup/restore gate is still open and is **not** this phase's.
- **F49** — no project graph may be presented as durable memory until export and restore exist and have been exercised. Nothing in 6b may claim durability.
- **F55 / F56** — tool-call *counts* are structurally unobservable from the **edge-triggered** activity path (`agentEvents.ts` returns early on unchanged activity). 6b-1's counter must hang off the raw per-event receipt **before** that edge filter, or it will under-count exactly the way F56 predicts.

## 7. What to produce this session

1. **Ground** — read the documents above, verify §5's facts against the code and the machine (start the container; re-run the transcript tally), and report anything that moved.
2. **Settle §3's decisions** with evidence, each as a numbered decision, and name which (if any) go to the council.
3. **Run `/phase-kickoff`** to author `Tasks/Phase-6b-Overview.md` plus **1–5** `Task-6b-N.md` files, each paired with `ImplementationSpecs/ImplementationSpec-6b-N.md`. Sequence them so **measurement lands first** — nothing else in the phase can be proven without it — then the contract + session identity, then always-on, then the nudge (or its deferral).
4. **Write the milestone as a binary test** in the overview: a session launched from the **installed** app, on an ordinary coding task whose prompt never names the graph, makes ≥1 graph read before filesystem exploration **and** ≥1 sourced `:Memory` write, so `validate` reads *N of N* with N ≥ 1 and the read/write counters are non-zero — **measured by 6b-1's counters, not by reading a transcript**.
5. **Do not write feature code.** No migration, no channel, no renderer file, no change to `instructionsCore.ts` this session.
6. Report: what you verified, what moved, the decisions you recorded and why, and the task list with its ordering rationale.

## 8. Verification commands

```bash
git branch --show-current      # expect: main
git log -1 --format="%H %s"    # expect: f9a01fe … (or the docs commit that follows it)
git status --porcelain
npm run typecheck              # expect 0 errors
npm test                       # last measured 2554 / 74 — report what you get
npm run grep:secrets           # expect clean
grep -n "toHaveLength(107)" src/shared/ipc.test.ts   # expect 3510
docker ps -a --filter name=chorus-g2-neo4j --format '{{.Status}}'   # start it if exited
```

## 9. Failure honesty clause

If any command fails — including for an unrelated environment reason (Docker Desktop not running, a native-module ABI mismatch, a locked database, a missing CLI) — **capture the exact output, say what you believe caused it, and do not claim success.** If you cannot verify a fact in §5, say which one and why, rather than passing it through.

---

## END OF PROMPT BODY

---

## Coordinator notes (not part of the prompt)

- **This prompt was authored from a worktree** (`.chorus/Chorus/wt-becbef31`, branch `chorus/Chorus/becbef31`, fast-forwarded to `f9a01fe`). The roadmap edits that created D167 / F89–F91 / the Phase 6b section — and this file — were left **uncommitted** on that branch by the audit session; commit them there (one docs commit) and merge to `main` before the new session starts, or the kickoff will not find D167 and will claim the number again.
- **Docker Desktop and `chorus-g2-neo4j` were started by the audit session on 2026-08-19** and left running. They were down before it — which is itself F90.
- **Phase 4's remaining three tasks (4-2 / 4-3 / 4-4) stay deferred behind this phase** (D167, superseding D154's queue). `Task-4-2`'s counters (`IpcChannel` was 86 when authored; 107 now) must be re-measured wholesale at pickup (G6).
- **F42** (council cost under-reports the final turn) and **F49** (no export/restore) remain open and are not this phase's.
