# Phase 6a — Memory In Practice (PROPOSAL)

_Drafted 2026-08-14 against `main` at `263b6cc`, immediately after Phase 6's milestone was met and driven._

> **⚠ THIS IS A PROPOSAL, NOT A PLAN OF RECORD. It asks for one decision (D147) and builds nothing until that decision exists.** The roadmap currently holds Phase 6 as *milestone-met, not complete*, precisely because Stage 5's fate is a ruling somebody has to make rather than scope to be silently inherited.

---

## 1. Why this exists

Phase 6 proved that an agent can query a project's memory graph. Asked for a node seeded by hand minutes earlier, a `claude` pane called `chorus-memory` and returned it.

**What it did not prove is that anyone will ever benefit from that.** Measured on the same run:

| Observation | Evidence |
|---|---|
| The graph is **empty of anything an agent wrote** | `memory:validate` → `0 of 0` |
| **Nothing tells either agent the graph exists** | no `CLAUDE.md` / `AGENTS.md` snippet anywhere; the only tool description comes from `mcp-neo4j-cypher` and describes Cypher, not this project |
| The agent used it **only because it was told to, by name** | the milestone prompt names `chorus-memory` explicitly |
| **codex does not receive the server at all** | **F75** — `mcpLaunchArgs` is built, tested and never called |
| A working database needed **one command** | `docker run -d --name … neo4j:5-community` |

**The stated goal is Matthew's, 2026-08-14:** *"agents can manage project memory as well as documenting code structure so that the models don't have to constantly re-discover a project."*

Stage 5 as originally listed — Docker provisioner, `skill.yaml`, `index-codebase` — was ordered by **architecture**. This proposal reorders it by **that goal**, and the reordering is not cosmetic: it puts the cheapest, highest-value item first and the item Stage 5 led with last.

## 2. What Stage 5 was, and what today changed about it

D91's ruling stands and is the reason this is a proposal at all:

> *"The milestone is met at Stage 4; Stage 5 is the tail, and if the phase runs long that is where it gets cut."*

Stage 5's contents, from `Plan.md` §10–§11: a **dockerode provisioner** (`provision-neo4j`), a **provider-neutral skill format** (`skill.yaml` + `instructions.md` + `scripts/`), and a launch set of skills — `index-codebase`, `backup-graph`, `repo-orientation`, `summarize-session`.

**Three things learned today move the value around inside that list:**

1. **The provisioner is convenience, not capability.** The whole memory path — connect, seed, write configs, query — ran against a container started by hand with one `docker run`. A one-click provisioner is genuinely nice; it is **not** what stands between here and the goal.
2. **The usage contract is the actual gap.** An agent that does not know the graph exists will never query it, no matter how the container was started.
3. **`index-codebase` is the goal, restated.** *"Models don't have to re-discover a project"* **is** the structural indexer. It was one item in a list of five; it is the point.

## 3. Proposed scope, ordered by value

### 6a-1 — The usage contract *(smallest, and it unblocks the value)*

Teach both agents that the graph exists, when to read it, and what belongs in it. `Plan.md` §10 already specifies this and it was never built:

> *"drop a `MEMORY.md`/`CLAUDE.md` usage snippet ('query before assuming; write Decisions after milestones')"*

**⚠ THIS TASK'S CENTRAL QUESTION IS NOT THE WORDING — IT IS WHERE THE TEXT LIVES, AND IT SITS ON THE D49 BRIGHT LINE.** `CLAUDE.md` and `AGENTS.md` are **the user's files, authored by the user**, in the user's repo. Chorus writing into them is a different act from writing `.mcp.json` — which is a machine-owned config file whose whole purpose is tooling. **A clobbered `CLAUDE.md` is unforgivable in a way a clobbered `.mcp.json` is not.**

Options the task must choose between, with evidence:

- **(a) A marked, idempotent block** in `CLAUDE.md` / `AGENTS.md` (`<!-- chorus:memory:start -->` … `end`), rewritten in place and never touching anything outside the markers. Precedent exists in the wild; the risk is that Chorus now edits a file the user hand-writes.
- **(b) A separate file** Chorus fully owns (`.chorus/memory-usage.md`) plus **one line** in `CLAUDE.md` pointing at it — smaller footprint in the user's file, but still an edit, and adds indirection an agent may not follow.
- **(c) Session-level injection** — claude's `--settings` (already used for hooks, D130) and codex's `-c developer_instructions` (**already in use**, as today's process dump showed: Chorus injects the jade formatting rule that way). **⚠ THIS TOUCHES NO USER FILE AT ALL** and is the only option fully clear of D49. Cost: it consumes context on every launch, and it is invisible to an agent the user runs outside Chorus.

**Recommendation: (c) as the default, with (a) offered as an explicit opt-in.** It respects the bright line by construction, and Chorus already does exactly this for codex today.

**Also in this task:** the snippet must be **per-agent**, because the vocabularies differ (`CLAUDE.md` vs `AGENTS.md`), and it must say *when to write*, not only when to read — CR-6.0 chose **advisory-and-measured over app-mediated writes**, so write quality is governed by instructions plus the provenance ratio, and by nothing else.

### 6a-2 — `index-codebase` *(the goal)*

A walker that upserts `File` / `Class` / `Method` / `Namespace` nodes and the `CONTAINS` / `DECLARES` / `HAS_METHOD` / `CALLS` edges. **Structural metadata only — no source chunks, no embeddings** (`Plan.md` §10's v1 line, unchanged).

**Set the expectation honestly, in the task doc and in the UI:** this replaces **finding** code, not **reading** it. "What calls this method", "which files did this commit touch", "where is this class declared" — real wins against re-discovery. It is not a semantic memory of the codebase and must not be sold as one.

**Two traps already recorded, to be handled rather than rediscovered:**

- **D94: `File.path` uniqueness breaks on worktrees.** Chorus is a worktree-first app; the same logical file exists at several absolute paths. Identity must be repo-relative, and the task must say so.
- **Refresh policy is a real decision.** `Plan.md` says *"manual + optional post-commit"*. A watcher that re-indexes on every save will fight the agents for the database.

### 6a-3 — codex's argv (F75)

Two gaps, and **fixing only the first ships a server codex cannot reach**:

1. `mcpLaunchArgs` is never called — `PtyLaunchSpec` carries no servers and `buildLaunch` never composes them. The misleading comment at `mcpConfigWrite.ts:179` should die with the fix.
2. `renderMcpLaunchArgs` emits `env_vars` (passthrough **names**) but has **no path for env values**, and local mode needs `NEO4J_URL=bolt://…` as a value.

**Placed third deliberately.** Until 6a-1 exists there is nothing worth connecting codex *to* — it would join claude in not knowing the graph is there.

### 6a-4 — The provisioner *(optional, and droppable)*

One-click `docker run` + lifecycle UI. **Explicitly the tail of the tail.**

**The dependency question, which `Phase-6-MemoryPlan.md` §11 already answered and which this proposal endorses:**

> *"`dockerode` … **recommend evaluating a `git.ts`-style `docker` CLI adapter FIRST** and recording the outcome as a numbered decision."*

`docker` is already probed by `cliDetect`, `git.ts` is a proven controlled-process pattern, and `docker … --format '{{json .}}'` gives structured output. **Recommendation: no new dependency; a CLI adapter.** If 6a-4 is dropped, the question never needs answering.

## 4. What this proposal does NOT ask for

- **No `skill.yaml` framework.** Stage 5 bundled a provider-neutral skill format with the skills themselves. **Building a framework to ship two skills is premature** — `index-codebase` should be an app capability first and be generalised when there is a third consumer. `backup-graph`, `repo-orientation` and `summarize-session` are **not** proposed here.
- **No app-mediated writes.** D126 stands: agents write via MCP, Chorus measures provenance.
- **No embeddings, no source chunks, no semantic index.**
- **No cross-project graph**, no Enterprise, no multi-database — D128(e) measured that ceiling and it has not moved.
- **No change to the milestone already claimed.** Phase 6's milestone is met and evidenced; nothing here revisits it.

## 5. The decision this asks for — proposed **D147**

**(a) Phase 6 CLOSES at its milestone.** Stage 5 does not remain inside it as silent unfinished scope. The phase is recorded complete, with Stage 5's contents explicitly carried out of it.

**(b) Stage 5 becomes provisional Phase 6a — Memory In Practice**, re-scoped as §3, with `skill.yaml` and three of the five launch skills dropped rather than deferred (§4).

**(c) ⚠ ONE GRAPH PER PROJECT, TWO LABEL NAMESPACES — NOT TWO CONTAINERS.** Asked directly whether project memory and code structure should be separate containers, the answer is no, on three grounds and the first is decisive:

1. **The value is in the edges between them.** `Plan.md` §10 already specifies `(AgentSession)-[:PRODUCED]->(Observation)-[:SUPPORTED_BY]->(File)` and `(Commit)-[:MODIFIED]->(File)` — *a memory that points at the code it is about*. **Two databases sever exactly that edge**, which is the most valuable thing in the schema.
2. **Community Edition cannot join across databases anyway.** `CREATE DATABASE` is Enterprise-gated — measured, and Memgraph was checked and refuses identically (D128(e)). Two containers means two isolated graphs with no cross-query, forever.
3. **Cost.** Each Neo4j wants ~0.5–1 GB heap. Chorus is multi-project by design; doubling per project does not survive a workstation.

**The separation being sought is real but is a LABEL boundary:** `File`/`Class`/`Method` are machine-generated and disposable and can be wiped and re-indexed wholesale; `Decision`/`Observation`/`Risk` are expensive and must never be. Same graph, joins intact.

**(d) `dockerode` is NOT approved.** If 6a-4 is built, it uses a `git.ts`-style CLI adapter (§3).

## 6. Open questions for Matthew

1. **6a-1's delivery mechanism** — (a) marked block in `CLAUDE.md`, (b) owned file plus a pointer line, or (c) session-level injection. **Recommendation: (c), with (a) as opt-in.** This is the only question in the proposal that touches the D49 bright line.
2. **Is 6a-4 in or out?** Dropping it removes the last new-dependency question from Phase 6's lineage entirely.
3. **Does 6a run next, or does Phase 4 finish first?** Phase 4 has three tasks left and an execution prompt already written for 4-2. **No recommendation offered — this is a priority call, not a technical one.**
4. **`.mcp.json` and the repo** — still untracked, still not gitignored, and now load-bearing for a working feature. **Do not delete it.** Gitignore, commit, or leave: a real choice, unrelated to this proposal's scope but overdue.
