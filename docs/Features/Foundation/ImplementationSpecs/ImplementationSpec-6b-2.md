# Implementation Spec 6b-2 — Contract v2, the `:AgentSession` node, and the reachable gate

_Pairs with [`../Tasks/Task-6b-2.md`](../Tasks/Task-6b-2.md). Authored 2026-08-19 against `a3ba6f9`; amended
2026-08-19 after CR-6b.0 (D173)._

**Read the task doc first.** This document adds what a task doc should not carry: the contract's exact
text, the exact insertion points, and the runtime checks that decide whether it worked.

**D169 (`roadmap.md:672`), as amended by D173 (`roadmap.md:676`), is authoritative.** Where this spec and
D169/D173 disagree, D169/D173 win and this spec is wrong.

---

## §0 — Probe before you build (do not skip)

Five facts this spec rests on were measured on **2026-08-19**. Every one is re-runnable in under a minute, and
a spec built on a stale CLI or a restored docker volume wastes a session — which is why CLAUDE.md forbids
trusting recall for CLI and query syntax. **§0.6 adds a sixth, recorded rather than re-run:** it belongs to
6b-4's hook probe, not to this task's build, and re-running it here would mean writing a hook entry this task's
Non-Goals forbid. **§0.7 adds a seventh, and that one IS re-runnable** — it is a rolled-back transaction, so
it proves the templates and leaves the graph untouched.

### 0.1 The CLIs

```powershell
claude --version      # was 2.1.235 (Claude Code)
codex --version       # was codex-cli 0.148.0
docker ps --filter name=chorus-g2-neo4j --format "{{.Names}} {{.Status}} {{.Ports}}"
                      # was: chorus-g2-neo4j  Up …  127.0.0.1:7688->7687/tcp
```

### 0.2 Re-measure F92 — are MCP tools deferred?

Re-run the kickoff's `--settings` hook experiment (`ground` §D4): a `--settings` file with a `PreToolUse` hook
that POSTs the body, and `claude -p --model haiku --no-session-persistence --strict-mcp-config --settings <file>`
asked to call `read_neo4j_cypher`. **Expected (was measured):** two `PreToolUse` bodies, `tool_name` =
`ToolSearch` **then** `mcp__chorus-memory__read_neo4j_cypher`.

**⚠ TWO TRAPS, BOTH ALREADY PAID FOR.** Paths inside the settings JSON must use **forward slashes** (a
backslash in a JSON string is an escape), and the hook's curl **must** carry `-o NUL` — hook stdout is a
control channel.

**If F92 no longer reproduces** — the tools are live at start — the contract still names them, but line 2's
second clause becomes wrong. Change the clause, record the new measurement, do not delete the line: naming the
three tools is what closes F89's *"six discovery calls before answering"*.

### 0.3 Confirm the fulltext syntax against the running Neo4j

**Measured this session** (via `mcp__chorus-memory__read_neo4j_cypher`, against
`bolt://127.0.0.1:7688`, `CALL dbms.components()` → **Neo4j Kernel 5.26.29, community**):

```cypher
CALL db.index.fulltext.queryNodes('memory_text', $q) YIELD node AS m, score
WHERE m.chorusProjectId = $projectId AND m.validTo IS NULL
RETURN m.id AS id, m.content AS content ORDER BY score DESC LIMIT 10
```

**Accepted. Returned `[]`** — and the reason matters: the only `:Memory` in that graph is the G2 canary, whose
properties are `note` and `key` (`MATCH (m:Memory) RETURN keys(m)` → `["note","key"]`), so the index over
`content` has nothing in it. **Syntactically verified, semantically unverified** — which is exactly why the
runtime drive (§9) re-runs it *after* a real memory exists.

Two further measurements worth having in the file:

- `SHOW INDEXES` lists **`memory_text`** as `FULLTEXT` on `:Memory(content)` — and also a foreign
  **`search`** FULLTEXT on `:Memory(name,type,observations)`, left behind by `mcp-neo4j-memory` (F49 in the
  wild). **Name the index explicitly in the template**; a bare fulltext call has two candidates here.
- **`mcp-neo4j-cypher`'s read tool accepts a `CALL` query.** `MATCH … CREATE …` and even `EXPLAIN …` are
  refused with *"Only MATCH queries are allowed for read-query"*, but the READ template above ran. The check
  is *does this write*, not *does it start with `MATCH`*. Do not rewrite the template on the strength of that
  message.

### 0.4 Verify `tomlBasicString` on a real Cypher string

`mcpConfigCore.ts:41` is one line:

```ts
return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
```

**`\` → `\\`, `"` → `\"`, single quotes untouched, newlines NOT escaped.** Feed it the WRITE template from
§1.3 and confirm the output is a legal TOML basic string with the Cypher readable inside it.

**⚠ THE CONCLUSION, STATED SO NOBODY RE-DERIVES IT.** Double quotes *do* survive: `CODEX_JADE_ECHO_INSTRUCTIONS`
(`codex.ts:799`) already ships `"> "` and the v1 contract's line 1 already ships `"chorus-memory"`, and both
reach a working codex launch (6a-1's drive). **Write the Cypher with single-quoted literals anyway** —
`'memory_text'`, `'mcp'` — so the escaping depth stays at one and the live command line shows the Cypher an
agent will actually see. The only `"` left in the whole contract is the pair around the server name in line 1.

**⚠ RE-CHECKED AFTER D173, AND THE CONCLUSION SURVIVES UNCHANGED.** The self-verifying `RETURN` clauses and
the new contract line add only letters, spaces, parentheses, commas, slashes and **single** quotes — **no `"`
and no `\`** — so `tomlBasicString`'s escape depth stays at one and the only `"` in the whole contract is
still the pair around the server name in line 1. What moves is the length, and only by arithmetic.

Measured on the pre-D173 draft's 18 lines (scratch script, this session), then re-derived for the **19** lines
D173 requires. **The ≈ figures are arithmetic on the additions (+576 chars: +49 per WRITE template, +74 for
SUPERSEDE, +404 for the new line and its join space), not a fresh script run — re-measure the real render**:

| Quantity | Value |
|---|---|
| lines | **19** (18 before D173) |
| longest single line | **554** chars (SUPERSEDE, now self-verifying; was 480) |
| one-line render | **≈4 894** chars (measured 4 318 + 576) |
| after `tomlBasicString` | **≈4 898** chars (still only 2 `"` and 0 `\` in the whole text) |
| `developer_instructions=…` token | **≈4 921** chars |
| plus the jade rule (≈1 156) | **≈6 078** chars — **≈19 % of the 32 767 Windows command line** |
| Markdown render (claude's file) | **≈4 960** chars |

### 0.5 Confirm `session_id_unique` exists

```cypher
SHOW CONSTRAINTS YIELD name, type, labelsOrTypes, properties RETURN name, type, labelsOrTypes, properties
```

**Measured:** `session_id_unique` · `UNIQUENESS` · `["AgentSession"]` · `["id"]`, created by graph migration
**v1** (`graphSchemaCore.ts:69`). Also confirm `MATCH (s:AgentSession) RETURN count(s)` → **0** before the
drive, so the first row is provably this task's.

**This is why there is no graph migration:** the constraint exists, and a node whose only novelty is its
properties needs no schema in Neo4j. `LATEST_GRAPH_VERSION` (`graphSchemaCore.ts:122`) stays **2**.

### 0.6 The sixth fact, carried in rather than re-run — TWO failure modes, not one

**Measured 2026-08-19 on claude 2.1.235**, by 6b-4's hook probe and not by anything in this task
(`_verify/6b-4/hookprobe/ptf.log`, `ptu.log`): a memory tool call carrying **deliberately broken Cypher** fired
**`PostToolUseFailure`**, whose body carries `error`; the **well-formed** one fired **`PostToolUse`**.

**Why it belongs in this spec.** It settles what the agent is shown, and therefore what the contract has to
say. A malformed query is a **LOUD** failure: the MCP server returns an error, the agent sees a failed tool
result, and a competent agent retries without being told to. The failure this task exists to cover is the
**QUIET** one — the tool call **SUCCEEDS**, and nothing was created, because Cypher's `MATCH … CREATE` creates
nothing when a `MATCH` is empty and the driver reports that as a normal, successful, zero-row result.
**Two different failure modes arriving through two different channels, and §1.3's contract must name both**
(D173 Q5) — which is what the self-verifying `RETURN` and its accompanying line do. Do not re-run this probe
here; it is 6b-4's, and re-running it would mean writing a hook entry this task's Non-Goals forbid.

### 0.7 The writing templates were EXECUTED, not merely parsed — and rolled back

**Measured 2026-08-19 against the live Neo4j 5.26.29** by `_verify/6b-4/probe-write-template.cjs`. It ran the
three writing templates **exactly as §1.3 writes them** — the file-cited WRITE with `c:SUPPORTED_BY`, the
commit-cited WRITE with `r:SUPPORTED_BY` (because `c` is already bound to the `:Commit`), and SUPERSEDE with
its four counts — in four runs, inside **ONE TRANSACTION THAT WAS ROLLED BACK**. Node count **710 before and
710 after**: the probe proved the Cypher and left the graph exactly as it found it. The READ template is
§0.3's; together they are the four templates (READ, WRITE cited to a file, WRITE cited to a commit,
SUPERSEDE) — **D169(c)(4) says *three*** because it counts the two WRITE forms as one template, and they are
the same four statements.

| Run | Result |
|---|---|
| WRITE cited to a file — `relPath: 'package.json'`, `$wid = 'pj:a43b395d…'` | `{id, produced: 1, supportedBy: 1}` |
| WRITE cited to a file — a `relPath` that does not exist | **0 rows** |
| WRITE cited to a commit | `{id, produced: 1, supportedBy: 1}` |
| SUPERSEDE | `{id, produced: 1, supportedBy: 1, supersedes: 1}`, and `old.validTo` set inside the tx |

**Two things this settles, and the residual risk it closes.** First, **the aggregating `RETURN` is valid
Cypher on this server and returns the shape the contract promises**: `count(p)` / `count(c)` grouped by `m.id`
come back as **1**, not as a row count — the one thing about D173's self-verifying templates that was
reasoning rather than measurement. Second, **the contract's sentence is literally true**: an unmatched
`relPath` yields **zero rows and no error**, so *"an empty result means nothing was written"* is now measured.

**⚠ AND ONE TRAP FOR THE RUNTIME DRIVE: `CLAUDE.md` IS NOT AN INDEXED `:File` ON THIS MACHINE.** It is not in
`git ls-files`, so the indexer never wrote a node for it, and a drive that cites it gets the zero-row case
rather than a working write — a false failure that reads as a broken template. **Cite `package.json`, or
another path `git ls-files` actually lists** (§9.3).

**Re-run this at pickup.** A Cypher planner and a driver both move between versions, and the cost is a minute:
the transaction is rolled back, so re-running it has no consequence for the graph.

---

## §1 — `src/main/adapters/instructionsCore.ts`

The module stays **pure** — no `fs`, no `electron`, no `neo4j-driver`, no adapter imported. The one new import
is type-only and erases:

```ts
import type { InstructionsDescriptor } from './types'
```

`types.ts`'s own imports are both `import type` (`:5`, `:10`), so this adds no runtime edge.

### 1.1 The context

```ts
/**
 * Everything contract v2 has to name so an agent can COMPLY with it (F89).
 *
 * ⚠ THIS IS THE WHOLE OF F89's REPAIR, AND EVERY FIELD IS HERE BECAUSE ITS
 * ABSENCE MADE A DILIGENT AGENT'S MEMORY INVISIBLE TO `memory:validate`. v1
 * told an agent to draw PRODUCED "from your own :AgentSession node" while
 * nothing created that node and nobody told it the id.
 *
 * ⚠ `workspaceInstanceId` IS ALWAYS `pj:<projectId>`, NEVER `wt:<worktreeId>`,
 * EVEN FOR A WORKTREE SESSION. The identity model defines both prefixes, but
 * the only writer of :File / :Directory nodes is `memoryService.index`, which
 * calls `workspaceInstanceIdFor(projectId)` (codeIndexCore.ts:392) and always
 * writes `pj:`. Handing a worktree session `wt:<id>` would give it a WRITE
 * template whose `MATCH (f:File …)` matches nothing — no error, no rows, no
 * memory, and no way for the agent to tell that from "the file is not indexed".
 */
export interface MemoryContractContext {
  readonly projectId: string
  readonly workspaceInstanceId: string
  /** The root-commit SHA the graph's own :Commit nodes carry, or null when no
   *  commit has been indexed. Renders as `unknown`. */
  readonly repoId: string | null
  /** `sessions.id` — the same id Chorus MERGEd as the :AgentSession. */
  readonly sessionId: string
  readonly agentId: string
  /** ⚠ NULL FOR EVERY SUBSCRIPTION LAUNCH, WHICH IS MOST OF THEM. Chorus only
   *  knows a model when the launch carried a route (ipc.ts:1440). Renders as an
   *  instruction to the agent to supply its own, because the agent knows and
   *  Chorus does not — an honest null beats a guessed string in a provenance
   *  field. */
  readonly modelId: string | null
  /** Always `CHORUS_MEMORY_SERVER`. Carried rather than imported here so the
   *  composing layer (ipc.ts) supplies it from the one export, and the test can
   *  pin the rendered tool names as literals. */
  readonly serverName: string
  /** 6b-3 fills this from `:Project.lastIndexedHead`. Null renders `unknown`. */
  readonly lastIndexedHead: string | null
}
```

### 1.2 The three tool names

```ts
/**
 * ⚠ DERIVED FROM ONE NAME, PINNED AS THREE LITERALS BY THE TEST. claude's
 * mangling was MEASURED, not assumed: F92's PreToolUse bodies carried
 * `mcp__chorus-memory__read_neo4j_cypher` verbatim, hyphen intact. Deriving
 * keeps the server name in one home; the test's literals mean a change to the
 * mangling fails loudly instead of teaching every agent three names that do
 * not exist.
 */
function toolNames(server: string): { read: string; write: string; schema: string } {
  return {
    read: `mcp__${server}__read_neo4j_cypher`,
    write: `mcp__${server}__write_neo4j_cypher`,
    schema: `mcp__${server}__get_neo4j_schema`
  }
}
```

### 1.3 The contract — all 19 lines, verbatim

**Each element is ONE physical line and contains no newline.** That is what makes the codex render legal, and
it now has to hold for the four templates (READ, WRITE cited to a file, WRITE cited to a commit, SUPERSEDE)
as well as for prose — all four executed against the live server in §0.3 and §0.7.

```ts
export function memoryContractLines(ctx: MemoryContractContext): readonly string[] {
  const t = toolNames(ctx.serverName)
  const repoId = ctx.repoId ?? 'unknown'
  const model = ctx.modelId ?? 'unknown — pass your own model identifier'
  const head = ctx.lastIndexedHead ?? 'unknown'
  // ⚠ ONE STRING, USED BY THE THREE WRITING TEMPLATES (both WRITEs and
  // SUPERSEDE). A second copy would drift from
  // `memoryWriteParams` (provenanceCore.ts:174) the first time a property is
  // added, and the drift would be invisible: the write would succeed and the
  // memory would simply not be counted.
  const mem =
    "{id: randomUUID(), content: $content, chorusProjectId: $projectId, writtenVia: 'mcp'," +
    ' assertedByModel: $model, assertedByAdapter: $agent, validFrom: $now, validTo: null}'
  return [
    `This project has a memory graph: a Neo4j 5 database reachable through the "${ctx.serverName}" MCP server and queried with Cypher.`,
    `Its three tools are ${t.read}, ${t.write} and ${t.schema}. They may not be in your live tool list yet — MCP tools are loaded on demand, so look them up by name before concluding the graph is unavailable.`,
    `THESE IDS ARE ALREADY CORRECT FOR THIS SESSION; use them verbatim rather than deriving your own: $projectId = '${ctx.projectId}', $wid = '${ctx.workspaceInstanceId}', $sessionId = '${ctx.sessionId}', $agent = '${ctx.agentId}', $model = '${model}', $repoId = '${repoId}'.`,
    `Chorus has already created your session node (:AgentSession {id: $sessionId}) — do not create, rename or delete it.`,
    `Structural nodes are keyed (:File {workspaceInstanceId, relPath}) — relPath is repository-relative with forward slashes — and (:Commit {repoId, sha}); they were last indexed at commit ${head}.`,
    `READ BEFORE EXPLORING: before your first Read, Glob or Grep on a topic, run the READ template with $q set to that topic; treat what comes back as prior findings to verify, not as fact.`,
    `READ: CALL db.index.fulltext.queryNodes('memory_text', $q) YIELD node AS m, score WHERE m.chorusProjectId = $projectId AND m.validTo IS NULL RETURN m.id AS id, m.content AS content ORDER BY score DESC LIMIT 10`,
    `WRITE AFTER A MILESTONE, not after every turn: a decision taken, a durable observation, or a risk found — never a running commentary, and never something you have not verified.`,
    `A :Memory carries exactly these properties and no others: id, content, chorusProjectId, writtenVia ('mcp'), assertedByModel, assertedByAdapter, validFrom (an ISO 8601 string), validTo (null while the belief is current). There is no confidence field; do not invent one.`,
    `WRITE (cited to a file): MATCH (s:AgentSession {id: $sessionId}) MATCH (f:File {workspaceInstanceId: $wid, relPath: $relPath}) CREATE (m:Memory ${mem}) CREATE (s)-[p:PRODUCED]->(m) CREATE (m)-[c:SUPPORTED_BY]->(f) RETURN m.id AS id, count(p) AS produced, count(c) AS supportedBy`,
    `WRITE (cited to a commit): MATCH (s:AgentSession {id: $sessionId}) MATCH (c:Commit {repoId: $repoId, sha: $sha}) CREATE (m:Memory ${mem}) CREATE (s)-[p:PRODUCED]->(m) CREATE (m)-[r:SUPPORTED_BY]->(c) RETURN m.id AS id, count(p) AS produced, count(r) AS supportedBy`,
    `SUPERSEDE (never delete): MATCH (old:Memory {id: $oldId}) MATCH (s:AgentSession {id: $sessionId}) MATCH (f:File {workspaceInstanceId: $wid, relPath: $relPath}) CREATE (m:Memory ${mem}) CREATE (s)-[p:PRODUCED]->(m) CREATE (m)-[c:SUPPORTED_BY]->(f) CREATE (m)-[x:SUPERSEDES]->(old) SET old.validTo = $now RETURN m.id AS id, count(p) AS produced, count(c) AS supportedBy, count(x) AS supersedes`,
    `PASS EVERY VALUE AS A PARAMETER in ${t.write}'s params argument; never paste text into the query. Quoting your own prose into Cypher is how a note containing an apostrophe becomes a syntax error and how a note about a query becomes an injection.`,
    `CHECK WHAT EACH WRITE RETURNED — that is what its RETURN clause is for: an empty result, or produced/supportedBy below 1, means NOTHING WAS WRITTEN because the cited path or sha is not in the graph; check the value you passed and retry. A malformed query comes back as a tool ERROR, but a write whose MATCH found nothing comes back as SUCCESS with no row — only reading the result tells those two apart.`,
    `If a write returns no row, a MATCH found nothing — check $relPath with the READ tool rather than switching to CREATE, because a CREATE-ed :File would be a second node under a name Chorus does not index.`,
    `EVERY MEMORY MUST CITE ITS SOURCE: the SUPPORTED_BY edge to an existing :File or :Commit is what makes it count; the PRODUCED edge alone does not. An uncited memory lowers this project's provenance ratio and shows in Chorus as unsourced.`,
    `NEVER DELETE OR RELABEL A MEMORY YOU DID NOT WRITE — supersede it instead, with the template above.`,
    `Structural nodes (:File, :Directory, :Commit, :Project) are machine-generated by Chorus and refreshed wholesale; do not hand-edit them.`,
    `The graph is scoped to this project. Do not assume it holds anything about another repository, and do not write memories about one.`
  ]
}
```

**Why nineteen and not seven, and why not thirty.** D147(e)'s rule is unchanged: every line is paid for in
context on every launch. Lines 1, 6, 8, 16, 17, 18 and 19 are v1's seven, condensed and re-ordered. The twelve
additions each answer a numbered clause of F89, D169(c) or D173(Q5):

| New line | Answers |
|---|---|
| 2 — the three tool names, and that they may need loading | **F92**; F89's *"six discovery calls before answering"* |
| 3 — the ids | **F89**: *"the agent is never told its session id"*; D169(c)(1) |
| 4 — the node already exists | F89: v1 told it to use a node nothing created |
| 5 — structural keys + `lastIndexedHead` | D169(c)(1); the 6b-3 hook, authored now, rendering `unknown` |
| 7 — the READ template | D169(c)(4); makes line 6 executable rather than aspirational |
| 9 — the property set | **F89**: v1 named none, so `validate`'s filter could not be satisfied; D94.3's *no confidence* |
| 10, 11 — the two WRITE templates | D169(c)(4); §6's *both* edges, drawn in one statement — and **self-verifying** per D173(Q5): the named relationships `p` / `c` (`r` in the commit form, because `c` is the `:Commit`) are counted back in the `RETURN` |
| 12 — SUPERSEDE | v1's *"set validTo on the old node"* made executable; self-verifying on the same reasoning, with `count(x) AS supersedes` added because it has a third `MATCH` that can quietly find nothing |
| 13 — parameters, never interpolation | D169(c)(4)'s sentence, verbatim in intent (`provenanceCore.ts:166`) |
| 14 — read what the write returned | **D173(Q5)**, and it names **both** failure modes because §0.6 measured that they arrive differently: a malformed query is returned to the agent as a tool **error** (`PostToolUseFailure`), while a write whose `MATCH` found nothing is returned as **success with no row** — invisible without this check |
| 15 — the empty-result failure mode | measured: a `MATCH` that finds nothing returns **zero rows and no error**; without this line the obvious repair is `CREATE (f:File …)`, which forks the identity |

**Line 6 is the milestone's instruction.** *"before your first Read, Glob or Grep"* is deliberately the same
vocabulary 6b-1's classifier uses for exploration tools, so the ordinal comparison the counters make is
measuring compliance with a sentence that was actually written.

### 1.4 The renderers and the gate

`renderInstructionsMarkdown` (`:52`), `renderInstructionsOneLine` (`:57`) and `assertSingleLine` (`:70`) are
**unchanged**. What moves here is `ipc.ts`'s `renderInstructionsFor` (`ipc.ts:823`–`:833`), with one new
argument:

```ts
export type InstructionsMechanism = InstructionsDescriptor['mechanism']

/**
 * D148, refined by D169: pick the contract's rendering from the adapter's OWN
 * DECLARED MECHANISM, and withhold it entirely when the graph did not answer.
 *
 * ⚠ NO `id === 'claude'` ANYWHERE IN HERE — `mcpConfigWrite.ts`'s rule applied
 * to a second capability. The fifth adapter is wired by declaring a descriptor.
 *
 * ⚠ `ctx === null` MEANS "THE MERGE FAILED", AND IT IS THE ONLY EXPRESSION OF
 * THE REACHABLE GATE. It lives in this pure module rather than inside
 * `withMcpEnv` for one reason that is worth a sentence: THERE IS NO
 * `src/main/ipc.test.ts` — `ipc.ts` has no unit suite at all — so a gate
 * written only there could not be asserted by anything. Here it is three lines
 * of test.
 */
export function renderInstructionsFor(
  mechanism: InstructionsMechanism | null | undefined,
  ctx: MemoryContractContext | null
): string | undefined {
  if (!mechanism) return undefined
  if (!ctx) return undefined
  const lines = memoryContractLines(ctx)
  switch (mechanism) {
    case 'append-system-prompt-file':
      return renderInstructionsMarkdown(lines)
    case 'config-override':
      return renderInstructionsOneLine(lines)
  }
}
```

---

## §2 — `src/main/services/memoryService.ts`

### 2.1 The types and the Cypher

Placed beside `McpLaunchInput` (`:185`) and exported, so the no-deletion test can walk the statements the way
`codeIndexCore.test.ts` walks the indexer's.

```ts
export interface AgentSessionRegistration {
  readonly sessionId: string
  readonly agent: string
  /** The launch's model, or null. `sessions` has no model column and none is
   *  added (D169(a)). */
  readonly model: string | null
  /** ISO 8601. ⚠ A STRING, NOT `datetime()`. `memoryWriteParams`
   *  (provenanceCore.ts:182) passes `validFrom` as a string and
   *  `:Project.lastIndexedAt` is `new Date().toISOString()`
   *  (memoryService.ts:974); one type per property, or a future range query is
   *  wrong in a way no test would catch. A Neo4j temporal would also have to be
   *  normalised by `toPlainValue` (neo4jClient.ts:179) to cross IPC, and it is
   *  not. */
  readonly startedAt: string
}

/** What the registration round trip learned about the graph on the way past.
 *  ⚠ NEITHER FIELD MAY DECIDE THE GATE — see `registerAgentSession`. */
export interface AgentSessionFacts {
  readonly repoId: string | null
  readonly indexedFiles: number
}

/**
 * ⚠ THE ONLY NODE CHORUS WRITES OUTSIDE THE STRUCTURAL NAMESPACE, AND IT IS A
 * THIRD CATEGORY (D169(a)). D147(c) has two namespaces: structural nodes,
 * machine-generated and refreshed wholesale; and `:Memory`, agent-authored and
 * never touched by Chorus. `:AgentSession` is neither. It is Chorus-written
 * like a structural node but is NEVER REFRESHED AND NEVER DELETED, because
 * PRODUCED edges hang off it and deleting one would silently un-source every
 * memory it produced. And per D126 it is ATTRIBUTION, NOT PROVENANCE:
 * `validate`'s numerator still requires SUPPORTED_BY (provenanceCore.ts:208),
 * so a session node can never inflate the ratio on its own.
 *
 * ⚠ IDEMPOTENT ON RESTART AND RESTORE. `MERGE` on `sessions.id` — the identity
 * D167 settled, protected by `session_id_unique` (graphSchemaCore.ts:69) —
 * means a restart, a `session:restart` and the restore relaunch (ipc.ts:2821)
 * all land on the same row. `startedAt` is re-SET on each, which is honest:
 * it records when this process last launched that session.
 */
export const MERGE_AGENT_SESSION = `
MERGE (s:AgentSession {id: $sessionId})
  SET s.chorusProjectId = $projectId,
      s.agent           = $agent,
      s.model           = $model,
      s.startedAt       = $startedAt,
      s.writtenVia      = 'app'
`.trim()

/**
 * The two facts the contract needs that only the graph can answer, in one
 * bounded statement.
 *
 * ⚠ IT READS THE repoId THE GRAPH ACTUALLY HOLDS RATHER THAN COMPUTING ONE.
 * `selectRepoId` (provenanceCore.ts:87) would need a `git rev-list` at launch —
 * a process spawn on the launch path — and could return a SHA that disagrees
 * with what the `:Commit` nodes carry (a graph restored from a dump, or indexed
 * from another checkout). A contract naming a repoId nothing matches is worse
 * than one saying `unknown`.
 *
 * ⚠ THE AGGREGATION IS WHAT MAKES THE EMPTY CASE SAFE, AND IT WAS RUN.
 * Measured against the live 5.26.29: an unknown project yields
 * `{files: 0, repoId: null}` — one row, not zero — because an aggregation with
 * no grouping key always produces exactly one row. The Chorus project yields
 * `{files: 468, repoId: 'a92099d934dd95548e59525b7231fd4b5f5d5f6f'}`, which is
 * the repository's real root commit (`git rev-list --max-parents=0 HEAD`).
 */
export const READ_SESSION_FACTS = `
MATCH (f:File {workspaceInstanceId: $wid})
WITH count(f) AS files
OPTIONAL MATCH (c:Commit {chorusProjectId: $projectId})
RETURN files, c.repoId AS repoId
LIMIT 1
`.trim()
```

### 2.2 The interface entry

Beside `test` (`:251`) — the two are siblings: both are the app's own bolt traffic, neither is agent traffic.

```ts
  /**
   * D169: MERGE this launch's `:AgentSession` node, and answer whether the
   * graph is REACHABLE.
   *
   * ⚠ ONE ROUND TRIP ANSWERS BOTH QUESTIONS, WHICH IS THE POINT. A separate
   * probe followed by a write would be two facts that can disagree; the write
   * IS the probe. Measured 2026-08-19: a bolt connect costs 4–12 ms when the
   * server is up and <1 ms (ServiceUnavailable) when the port is closed, and
   * `CONNECT_TIMEOUT_MS` (neo4jClient.ts:53) bounds the worst case at 5 s with
   * `maxTransactionRetryTime: 0` so it is a ceiling, not a multiple.
   *
   * ⚠ BOLT-LEVEL, NEVER TCP (F93). After `docker start` the published port
   * accepts TCP at 2 ms while bolt answers at 4 296 ms — a socket probe would
   * declare the graph up for four seconds during which every query is refused.
   *
   * ⚠ AND IT IS CALLED FROM A LAUNCH, WHICH IS A CLICK. That is D58's
   * "user-initiated" widened by D169/D170 from "the button in the Memory
   * section" to "the launch the user just asked for" — not abandoned. Still no
   * timer, no watcher, no boot hook.
   */
  registerAgentSession(
    projectId: string,
    session: AgentSessionRegistration
  ): Promise<MemoryResult<AgentSessionFacts>>
```

### 2.3 The implementation

Beside `test` (`:827`), sharing its two-step opening exactly — the row read and the URI re-validation are the
idiom every bolt method in this file uses (`test` `:828`–`:838`, `seed` `:854`–`:857`, `validate` `:1059`–`:1062`).

```ts
    async registerAgentSession(projectId, session) {
      const row = store.getProjectMemory(projectId)
      if (!row) return { ok: false, reason: 'This project has no memory configured yet.' }
      const endpoint = validateBoltUri(row.boltUri)
      if (!endpoint.ok) {
        return { ok: false, reason: `The saved address is not usable. ${endpoint.reason}` }
      }
      const wid = workspaceInstanceIdFor(projectId)
      const outcome = await driver.withSession<AgentSessionFacts>(
        endpoint.value.uri,
        row.databaseName,
        async (runner) => {
          // ⚠ FIRST, AND IT ALONE DECIDES THE GATE. If this throws, the whole
          // unit of work fails and the contract is withheld.
          await runner.run(MERGE_AGENT_SESSION, {
            sessionId: session.sessionId,
            projectId,
            agent: session.agent,
            model: session.model,
            startedAt: session.startedAt
          })
          // ⚠ AND THIS ONE MAY NEVER DECIDE IT. The MERGE has already
          // succeeded, so the graph IS reachable; letting a failed read of two
          // optional facts withhold the contract would gate the feature on
          // something it does not need. Degrade to `unknown` instead.
          try {
            const rows = await runner.run(READ_SESSION_FACTS, { wid, projectId })
            const first = rows[0]
            return {
              repoId: typeof first?.repoId === 'string' ? first.repoId : null,
              indexedFiles: Number(first?.files ?? 0)
            }
          } catch {
            return { repoId: null, indexedFiles: 0 }
          }
        }
      )
      if (!outcome.ok) return { ok: false, reason: outcome.reason }
      return { ok: true, value: outcome.value }
    },
```

**⚠ `withSession` CLASSIFIES ITS ERROR AND NEVER FORWARDS IT** (`neo4jClient.ts:232`–`:237`) — *"a driver
message carries the URI on several paths"*. That is why the refusal above passes `outcome.reason` straight
through and composes nothing of its own.

---

## §3 — `src/main/services/neo4jClient.ts` — the docblock, and nothing else

`withSession`'s docblock (`:143`–`:147`) currently reads:

> ⚠ USER-INITIATED CALLERS ONLY (D58). This is a bigger door than `probe`, so the rule is restated where the
> door is: `memory:seed` and `memory:validate` are clicks. **Nothing here may be reached from a boot hook, a
> timer, a restore path or a retry.**

**That sentence stops being true the moment this task lands**, because `withMcpEnv` is reached from the restore
relaunch at `ipc.ts:2821`. Amend it — do not delete it:

```ts
  /**
   * Run a unit of work against one session.
   *
   * ⚠ USER-INITIATED CALLERS ONLY (D58), AND D169/D170 WIDENED WHAT THAT MEANS
   * RATHER THAN LOOSENING IT. `memory:seed`, `memory:index` and
   * `memory:validate` are clicks. So is a LAUNCH — which is why
   * `registerAgentSession` may be called from `withMcpEnv` (ipc.ts:728),
   * including the restore relaunch at ipc.ts:2821, where the user pressed
   * relaunch. NOTHING HERE MAY STILL BE REACHED FROM A TIMER, A FILE WATCHER, A
   * GIT HOOK OR APP BOOT.
   */
```

**Nothing else in this file changes.** In particular `CONNECT_TIMEOUT_MS` stays **5000**: the launch takes the
existing bound rather than inventing a tighter one, because two bounds drift and the measured cases (4–12 ms
up, <1 ms refused) make a tighter one worthless. The case it *does* cost is a blackholed address — §9.6
measures it.

---

## §4 — `src/main/services/sessionManager.ts` — one exported helper

```ts
/** ⚠ THE ONE DEFINITION OF "THE MODEL FOR THIS LAUNCH". It was inline at :1149
 *  while there was one reader; D169 adds a second (ipc.ts's :AgentSession
 *  MERGE), and two copies of `opts.route?.modelId ?? null` would disagree the
 *  first time a rank is added to D56's precedence order. */
export function launchModelId(opts: LaunchOptions): string | null {
  return opts.route?.modelId ?? null
}
```

and `:1149` becomes `model: launchModelId(opts),`. **Nothing else.** `LaunchOptions` gains no field — the
session id is an identity, not an option; see §5.1.

---

## §5 — `src/main/ipc.ts` — `withMcpEnv`

### 5.1 The signature

```ts
async function withMcpEnv(
  opts: LaunchOptions,
  project: ProjectRecord,
  agent: string,
  cwd: string,
  /** D169: `sessions.id` — the identity of the `:AgentSession` node this launch
   *  MERGEs. ⚠ REQUIRED, NOT OPTIONAL, AND THAT IS THE ENFORCEMENT. An optional
   *  identity would let a future call site quietly stop creating the node, and
   *  the only symptom would be the provenance ratio drifting back to 0% — the
   *  exact failure F89 recorded. A required positional parameter makes the
   *  compiler check all four sites. */
  sessionId: string
): Promise<LaunchOptions> {
```

**Why a parameter and not `LaunchOptions`.** `LaunchOptions` (`sessionManager.ts:154`–`:157`) is documented as
*"what a BYOK launch carries beyond a plain one"* — every field on it is optional and every field is a
*choice*. A session id is neither. **Why the model is NOT a parameter:** it is already on `opts`
(`opts.route?.modelId`, `ipc.ts:1440`–`:1443`), read through §4's helper, so the fact keeps one home.

### 5.2 The MERGE — exact insertion point

Insert **after** the adapter lookup (`ipc.ts:742`) and **before** the D148 comment (`:744`). The reader then
meets the gates in the order they fire: *is it configured* (`:737`) → *which adapter* (`:742`) → *is it
reachable* (new) → *the contract* → *the wiring*.

```ts
    // D169: MERGE this launch's :AgentSession node, and let the answer decide
    // whether the contract is composed.
    //
    // ⚠ UNCONDITIONAL ON THE ADAPTER, DELIBERATELY. kimi, opencode and
    // noHarness declare `instructions: null` and get no contract — but they do
    // get the MCP server, so they can write a :Memory, and a memory with no
    // session node to hang PRODUCED from is unsourced by construction
    // (identity model §6). The NODE is not gated on the contract; the CONTRACT
    // is gated on the node.
    const registration = await memory.registerAgentSession(project.id, {
      sessionId,
      agent,
      model: launchModelId(opts),
      startedAt: new Date().toISOString()
    })
    if (!registration.ok) {
      // ⚠ THE REASON IS LOGGED AND NOTHING ELSE IS. `withSession` already
      // classified the driver error rather than forwarding it (neo4jClient.ts:234)
      // — no URI, no token, no path, matching the rule the MCP write log two
      // blocks down states for itself.
      logger.warn(
        `[memory] the graph for '${project.name}' did not answer at launch; ${agent} starts without the memory contract (${registration.reason})`
      )
    }
    broadcastMemoryLaunch(project.id, sessionId, agent, registration.ok)
```

### 5.3 The amended comment and the composition

`ipc.ts:744`–`:749` becomes:

```ts
    // D148, refined by D169: the memory usage contract, composed HERE because
    // this is the layer that knows the project.
    //
    // ⚠ THERE ARE NOW TWO GATES, AND THAT IS NOT THE "TWO GATES DRIFT" THE OLD
    // COMMENT FORBADE — IT IS ONE GATE PER QUESTION. The early return above
    // (`if (!input) return opts`) is the CONFIGURED gate and remains the only
    // home of "does this project have memory at all". The MERGE above is the
    // REACHABLE gate and is the only home of "did the graph answer". Neither
    // may acquire a second condition, and no third gate may be added here.
    //
    // ⚠ WHY REACHABILITY EARNS A GATE AT ALL (F89, D169(b)): D148 emitted the
    // contract for a CONFIGURED project, so with Docker stopped an agent was
    // handed a paragraph about a database that refuses every query. It tries
    // once, fails, and learns the feature is flaky — which is worse than never
    // being told.
    const instructions = renderInstructionsFor(
      adapter?.getCapabilities().instructions?.mechanism ?? null,
      registration.ok
        ? {
            projectId: project.id,
            // ⚠ `pj:`, ALWAYS — see MemoryContractContext. The structural nodes
            // an agent will MATCH were written under this id and no other.
            workspaceInstanceId: workspaceInstanceIdFor(project.id),
            repoId: registration.value.repoId,
            sessionId,
            agentId: agent,
            modelId: launchModelId(opts),
            serverName: CHORUS_MEMORY_SERVER,
            // 6b-3 fills this from :Project.lastIndexedHead; until then the
            // contract honestly says `unknown` rather than implying freshness.
            lastIndexedHead: null
          }
        : null
    )
```

Everything from `wireMcpForLaunch` (`:751`) to the return (`:809`) is **untouched**, including the
`withInstructions` composition at `:771` — an absent contract is already `undefined` there and yields `opts`
unchanged. **Delete the local `renderInstructionsFor` at `:823`–`:833`** and import it, along with
`memoryContractLines`'s new signature, from `./adapters/instructionsCore` (the import block is already at
`:279`).

### 5.4 The four call sites

Each already has the row id one line above; add one argument.

| Site | Today | Becomes |
|---|---|---|
| `ipc.ts:1577` | `await withMcpEnv(launchOpts, p, req.agent, wt.path)` | `…, wt.path, row.id)` |
| `ipc.ts:1630` | `await withMcpEnv(launchOpts, p, req.agent, wt.path)` | `…, wt.path, row.id)` |
| `ipc.ts:1660` | `await withMcpEnv(launchOpts, p, req.agent, req.cwd)` | `…, req.cwd, row.id)` |
| `ipc.ts:2821` | `await withMcpEnv(opts, relaunchProject, row.agent, row.cwd)` | `…, row.cwd, row.id)` — `row` is read at `:2735`, and `row.id === sessionId` from `:2734` |

**⚠ `:2821` IS THE ONE THAT MATTERS FOR IDEMPOTENCE.** It passes the *same* `row.id` the original launch used,
so a relaunch MERGEs onto the existing node rather than orphaning it — which is the whole reason the identity
is `sessions.id` and not a fresh UUID.

### 5.5 The broadcast

Copy `SessionContext`'s shape (`ipc.ts:4643`–`:4648`) exactly:

```ts
  /** D169: the launch-time reachability fact. ⚠ FIRES ON BOTH OUTCOMES, not
   *  only failure — a chip that only ever hears bad news cannot say when the
   *  graph came back, and the user would be looking at a stale warning. */
  function broadcastMemoryLaunch(
    projectId: string,
    sessionId: string,
    agent: string,
    reachable: boolean
  ): void {
    const event = memoryLaunchEventSchema.parse({
      project_id: projectId,
      session_id: sessionId,
      agent,
      reachable,
      at: new Date().toISOString()
    })
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IpcChannel.MemoryLaunch, event)
    }
  }
```

---

## §6 — `src/shared/ipc.ts`, `src/preload/index.ts`

One channel, beside the other `memory:*` keys (`src/shared/ipc.ts:465`–`:593`):

```ts
  /**
   * event (main -> renderer): D169's launch-time reachability fact.
   *
   * ⚠ IT IS NOT `memory:status` AND MUST NOT BECOME A FIELD ON IT. `memory:status`
   * is a POLLABLE PURE READ of storage (its own docblock, :487) and this is a
   * live observation with main-memory lifetime — the same distinction
   * `SessionContext` (:57) draws against a persisted column. Folding it into the
   * polled read would also mean the user only learns the graph was down if they
   * happen to open Project Settings, which is F90 exactly.
   *
   * ⚠ AND IT MAY LEGITIMATELY SAY "connected" (D126). `Connected` must be earned
   * by an observed round trip — this one is a successful WRITE, which is
   * strictly stronger than the read D126 required.
   */
  MemoryLaunch: 'memory:launch',
```

```ts
export const memoryLaunchEventSchema = z.object({
  project_id: z.uuid(),
  session_id: z.uuid(),
  agent: z.string().max(64),
  reachable: z.boolean(),
  at: z.string().max(64)
})
export type MemoryLaunchEvent = z.infer<typeof memoryLaunchEventSchema>
```

**Both `toHaveLength` assertions in `src/shared/ipc.test.ts` (`:3510` and `:3897`) move by exactly one.** They
say **107** at `a3ba6f9`; take the number from the tree as 6b-1 left it and add one. Preload gets
`onMemoryLaunch`, copied from `onSessionContext` (`preload/index.ts:642`–`:647`).

---

## §7 — The renderer surface

**Decision: the Memory section's existing chip gains one line beneath it. There is no pane-level notice in v1.**

`stores/memory.ts` gains `launchByProject: Record<string, { reachable: boolean; at: string }>` and a handler
that writes it from the event.

**⚠ IT IS A SEPARATE LINE, NOT A NEW `MemoryConnection` VALUE.** The chip
(`ProjectSettingsView.vue:880`–`:899`) renders *"Connected — the database answered (`probe`)"* and there is no
probe number for a launch; reusing `'connected'` would print an empty parenthesis or invite a fabricated one.
D126 bounds what that chip may claim, so it is left exactly as it is.

```
Last launch (10:41): the graph answered — the memory contract was sent to claude.
Last launch (10:41): memory graph unreachable — contract withheld. The agent launched without it.
```

**Why the pane notice is refused for v1**, recorded so it is a decision rather than an omission:

1. The only way to put a sentence *in* a pane is to write bytes into the PTY stream, and that stream is
   mirrored into `session.output.buffer` and persisted (`sessionManager.ts:735`–`:751`). A Chorus sentence
   would become indistinguishable from agent output in a saved transcript — the worst possible provenance
   failure in a phase about provenance.
2. A banner *above* the pane is new renderer chrome in a task whose milestone is about agent behaviour.
3. The broadcast is per-session as well as per-project, so a pane surface can be added later **without a
   second channel** — the cost of deferring is one component, not one design.

---

## §8 — Tests

`instructionsCore.test.ts` keeps its header (*"this suite imports neither `electron` nor `fs`, and that is the
point"*) and gains a `describe` for contract v2. Build the context from **obviously fake, distinguishable
values** so a test that passes because a real id leaked in is impossible:

```ts
const CTX: MemoryContractContext = {
  projectId: 'PID-0001',
  workspaceInstanceId: 'pj:PID-0001',
  repoId: 'REPO-0001',
  sessionId: 'SID-0001',
  agentId: 'claude',
  modelId: null,
  serverName: CHORUS_MEMORY_SERVER,
  lastIndexedHead: null
}
```

The assertions are listed in the task doc's **Test Expectations**; four of them need their reason in the file:

```ts
it('⚠ pins the LINE COUNT — growth must be a decision, not a drift', () => {
  // D147(e): every line is paid for in context on EVERY launch of EVERY session
  // in a memory-configured project. This number is a deliberate speed bump: if
  // you are changing it, you are spending someone's context and should say so
  // in the commit.
  expect(memoryContractLines(CTX)).toHaveLength(19)
})

it('⚠ withholds the ENTIRE contract when the graph did not answer', () => {
  // This is D169(b)'s gate, and it is asserted HERE because `src/main/ipc.ts`
  // has no test file at all — a gate written only inside `withMcpEnv` would be
  // unreachable by the suite.
  for (const m of ['append-system-prompt-file', 'config-override'] as const) {
    expect(renderInstructionsFor(m, null)).toBeUndefined()
    expect(renderInstructionsFor(m, CTX)).toBeTruthy()
  }
})

it('⚠ keeps every writing template SELF-VERIFYING', () => {
  // D173 (Q5). `MATCH … CREATE` creates nothing when a MATCH is empty and the
  // tool still reports success (§0.6) — the RETURN is the only signal the agent
  // gets. Dropping the counts would restore the exact silent failure the
  // council closed, and nothing else in the suite would notice.
  const lines = memoryContractLines(CTX)
  const writes = lines.filter((l) => l.startsWith('WRITE (') || l.startsWith('SUPERSEDE '))
  expect(writes).toHaveLength(3)
  for (const w of writes) {
    expect(w).toContain('count(p) AS produced')
    expect(w).toMatch(/count\([cr]\) AS supportedBy/)
  }
  expect(writes[2]).toContain('count(x) AS supersedes')
})

it('⚠ never renders a null as the word "null"', () => {
  // `repoId = 'null'` would send an agent to MATCH (c:Commit {repoId:'null'}),
  // which matches nothing and returns no rows and no error.
  const text = renderInstructionsOneLine(memoryContractLines(CTX))
  expect(text).toContain('unknown')
  expect(text).not.toMatch(/= 'null'/)
})
```

Also pin **`expect(memoryContractLines(CTX).join(' ').length).toBeLessThan(8000)`** with a comment naming the
32 767-character Windows command line and the estimated ~4 900, and assert the eight property names by reading
`Object.keys(memoryWriteParams(...))` rather than re-typing them.

`memoryService.test.ts` uses the file's existing doubles — `fakeStore` (`:94`), `stubDriver` (`:134`),
`forbiddenDriver` (`:118`). The unreachable case needs a factory whose `run` rejects; the
*"the read cannot fail the gate"* case needs one whose **second** `run` rejects. Both are five lines beside
`stubDriver`.

---

## §9 — Verification

### Build

```
npm run typecheck        # 0
npx vitest run           # >= the 6b-1 baseline, plus the new cases
npm run grep:secrets     # clean
```

### Structural

```powershell
# exactly one emitter of the contract, and ONE home for the mechanism switch
Select-String -Path src -Include *.ts -Recurse -Pattern "memoryContractLines|renderInstructionsFor"
# expect: instructionsCore.ts (definitions), instructionsCore.test.ts, ipc.ts (one call). NOT a second switch.

# D94.3 — the word must not exist in the module at all
Select-String -Path src\main\adapters\instructionsCore.ts -Pattern "confidence" -CaseSensitive:$false
# expect: no matches

# no deletion verb in ANY Cypher this task adds
Select-String -Path src\main\adapters\instructionsCore.ts,src\main\services\memoryService.ts -Pattern "DETACH|\bDELETE\b|\bREMOVE\b"
# expect: no matches in the new constants

# the numbers that must not move
Select-String -Path src\main\services\graphSchemaCore.ts -Pattern "version: [0-9]"   # 1 and 2 only
git diff --stat                                                                      # no adapter file, no user file
```

### Runtime — the part that decides the task

Container up (`docker start chorus-g2-neo4j` if needed), dev app running.

**9.1 — the node exists and carries the Chorus session id.**

```cypher
MATCH (s:AgentSession) RETURN s.id, s.chorusProjectId, s.agent, s.model, s.startedAt, s.writtenVia
```

Expect one row per launch. `s.writtenVia = 'app'`, `s.model` `null` for a subscription launch (this is
correct — `ipc.ts:1440`), `s.startedAt` an ISO string. **Cross-check `s.id` against SQLite**, do not eyeball it:

```powershell
# the dev DB
sqlite3 "$env:APPDATA\chorus\chorus.db" "SELECT id, agent, project_id FROM sessions ORDER BY created_at DESC LIMIT 3;"
```

**9.2 — the instruction file carries the ids and the templates.**

```powershell
Get-ChildItem "$env:APPDATA\chorus\agent-instructions"
Get-Content "$env:APPDATA\chorus\agent-instructions\<sessionId>.md"
```

Expect the project id, `pj:<projectId>`, the session id, the three tool names, and all four templates (READ,
WRITE cited to a file, WRITE cited to a commit, SUPERSEDE). Confirm from the live command line that the flag
is there:

```powershell
Get-CimInstance Win32_Process | Where-Object CommandLine -like '*claude*' | Select-Object -Expand CommandLine
```

**9.3 — drive one WRITE and prove the validator counts it.** A prompt naming the graph is acceptable **for
this drive only**; adoption is the phase milestone, not this task's gate.

**⚠ CITE A TRACKED PATH.** `CLAUDE.md` is **not** an indexed `:File` on this machine (§0.7) — it is not in
`git ls-files`, so citing it returns the zero-row case and looks like a broken template. Use `package.json`,
or any path `git ls-files` lists.

**The write tool's own result must have one of these shapes** — §0.7 measured every one of them against the
live 5.26.29 inside a rolled-back transaction:

| Template driven | Expected result |
|---|---|
| WRITE cited to a file | `{id: <uuid>, produced: 1, supportedBy: 1}` |
| WRITE cited to a commit | `{id: <uuid>, produced: 1, supportedBy: 1}` |
| SUPERSEDE | `{id: <uuid>, produced: 1, supportedBy: 1, supersedes: 1}` |
| any of them with a citation that is not in the graph | **0 rows** — nothing was written, and the template is not what is wrong |

Then:

```cypher
MATCH (s:AgentSession)-[:PRODUCED]->(m:Memory)-[:SUPPORTED_BY]->(src)
RETURN m.id, m.writtenVia, m.assertedByModel, m.assertedByAdapter, m.validTo, labels(src), src.relPath
```

and press **Validate** in the Memory section: it must read **`1 of 1`**. Anything else means the memory failed
`HAS_SUPPORT` or `HAS_SESSION` (`provenanceCore.ts:208`–`:209`) and **the contract text is what is wrong**, not
the agent.

**⚠ THE VALIDATOR IS THE WRITE-SIDE TRUTH, NOT THE WRITE COUNTER (D173 Q5).** Record 6b-1's write-tool count
if it is present, but read it for what it is: *a write-tool call completed*. A call whose `MATCH` found nothing
completes too (§0.6). The milestone evidence is the validator's **sourced count**, `N of N`, and beside it the
WRITE tool's own returned `id` / `produced` / `supportedBy` — which is why §1.3's templates return them.

*Optional for the drive, and explicitly not scope:* the same question, scoped to the session just launched —

```cypher
MATCH (s:AgentSession {id: $sessionId})-[:PRODUCED]->(m:Memory)
OPTIONAL MATCH (m)-[:SUPPORTED_BY]->(src)
RETURN m.id AS id, labels(src) AS citedTo
```

One cheap extra query, run by hand. **`memory:validate` itself is not re-scoped by this task** — that would be
a behaviour change to a shipped read, and D173 asked only that the drive be able to attribute what it sees.

**Also re-run the READ template now that a real `:Memory` exists** — §0.3 only proved it parses.

**9.4 — the withheld case, which is four assertions and not one.**

```powershell
docker stop chorus-g2-neo4j
```

Launch a claude pane in the same project and confirm **all four**:

1. `Get-CimInstance Win32_Process … CommandLine` shows **no** `--append-system-prompt-file`, and
   `agent-instructions\` has **no** new file;
2. the pane launched and works;
3. the Memory section shows *"memory graph unreachable — contract withheld"*;
4. **`.mcp.json` was still merge-written** (`git status` / the file's mtime) — the MCP wiring is not gated on
   reachability, only the contract is.

Then read the log: exactly one `[memory]` warn, and **grep it for `bolt://`, `7688` and any path** — there must
be none.

**9.5 — put it back.**

```powershell
docker start chorus-g2-neo4j
docker ps --filter name=chorus-g2-neo4j
```

**The drive must leave the container running.**

**9.6 — the bound, measured on the case that costs.** Configure a throwaway project's memory at
`bolt://192.0.2.1:7687` (TEST-NET-1, guaranteed unroutable — **not** a closed local port, which returns in
<1 ms and proves nothing) and time the launch. Expect **≤ ~5.5 s** added: `CONNECT_TIMEOUT_MS` = 5000 on both
`connectionAcquisitionTimeout` and `connectionTimeout` (`neo4jClient.ts:77`–`:78`) with
`maxTransactionRetryTime: 0` (`:79`). **A longer number is a finding to record, not a constant to tune** — the
fix would be in the driver config, and inventing a second timeout here would be the second bound D169
deliberately avoided.

**9.7 — the codex render, measured against the real limit.**

```powershell
Get-CimInstance Win32_Process | Where-Object CommandLine -like '*codex*' |
  ForEach-Object { $_.CommandLine.Length; $_.CommandLine }
```

Record the full command-line length against **32 767**. Estimated ≈6 078 for the composed `-c` tokens
(§0.4 — ≈4 921 for `developer_instructions=…` plus the ≈1 156 jade rule, ≈19 % of the limit). Confirm
**exactly one** `-c developer_instructions=` token and that the **jade block still renders** in codex's first
reply — that is how you know the composition did not eat the formatting rule.

**9.8 — the foreign index: re-checked, recorded, untouched (D173's open item).**

```cypher
SHOW INDEXES YIELD name, type, entityType, labelsOrTypes, properties RETURN name, type, entityType, labelsOrTypes, properties
```

```cypher
MATCH (m:Memory) WHERE m.chorusProjectId IS NULL RETURN count(m) AS unscoped
```

Write **two findings into this task's completion summary**: whether the foreign **`search`** FULLTEXT on
`:Memory(name,type,observations)` (§0.3 — `mcp-neo4j-memory`'s signature, 2026-08-18 19:39Z) is **still
present**, and whether **any `:Memory` node lacks `chorusProjectId`**.

**⚠ THIS STEP CHANGES NOTHING IN THE GRAPH.** No `DROP INDEX`, no relabel, no delete — D173 recorded the
index as an open item and asked for an observation, and its owner is a question for Matthew, not a cleanup for
this drive. Nodes without `chorusProjectId` are outside `validate`'s denominator, so they cannot move the
ratio; F49 stays open and is not this phase's.

Save everything under `_verify/6b-2/`. **Capture exact outputs; do not claim success on a failure.**

### The invariant a reviewer should test hardest

**Two, and they are the two halves of the same sentence.**

1. **THE CONTRACT IS NEVER COMPOSED WHEN THE MERGE FAILED.** Not "the log says so" and not "we checked
   `registration.ok` before logging" — the contract text is produced by exactly one function, that function
   takes `MemoryContractContext | null`, and `null` returns `undefined` for every mechanism. Test it by
   pointing a project at a dead address and reading argv, then by grepping `src/` for any second path that can
   build contract text. **The failure this guards is not a crash. It is a paragraph of confident instructions
   about a database that refuses every query — the thing F89 measured and D169(b) exists to stop.**
2. **THE MERGE NEVER BLOCKS A LAUNCH BEYOND THE BOUNDED TIMEOUT.** Every outcome — ok, refusal, throw —
   continues to `wireMcpForLaunch` and returns options. There is no `throw`, no early `return`, and no `await`
   outside `CONNECT_TIMEOUT_MS`. This is `claude.ts:200`'s missing-curl ruling applied to a second feature:
   **losing the memory contract costs a hint; refusing to start costs the session.**

**One known limit to record rather than discover:** `withSession` disposes the process-wide cached driver on
any failure (`neo4jClient.ts:236`). That is pre-existing, but this task makes it reachable from *every* launch,
so a launch against a down graph now drops a driver a concurrent `memory:index` may be holding. It re-acquires
on the next call, so the cost is one failed operation, not a broken app — but it should be written down here
rather than found during 6b-3's background index.
