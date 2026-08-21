import type { InstructionsDescriptor } from './types'

/**
 * The memory usage contract: what Chorus tells an agent about this project's
 * graph at launch (D148, Task 6a-1; contract v2 by D169/D173, Task 6b-2).
 *
 * ⚠ PURE, AND DELIBERATELY SO. No `fs`, no `electron`, no `neo4j-driver`, and
 * no adapter imported. It lives here beside `mcpConfigCore.ts` for the same
 * reason that module exists: two adapters need the same rule and a rule with
 * two homes drifts. Both of this module's consumers are adapters and the ipc
 * composition, which is why it is not in `services/`.
 *
 * ⚠ THE ONE IMPORT IS TYPE-ONLY AND ERASES. `types.ts`'s own imports are both
 * `import type` (`:5`, `:10`), so this adds no runtime edge and the module
 * stays loadable by a test that imports neither `electron` nor `fs`.
 *
 * ⚠ v1's SERVER-NAME IMPORT IS GONE ON PURPOSE. `CHORUS_MEMORY_SERVER` now
 * arrives in the context, supplied by the composing layer from the one export,
 * so this module holds no runtime edge to `memoryService` at all — and the
 * three tool names it derives can be pinned as literals by the test.
 *
 * ⚠ THE PHASE 6 G2 DRIVE IS WHY THIS EXISTS AT ALL. A complete working memory
 * path was proven end to end — and `memory:validate` still returned `0 of 0`,
 * because nothing anywhere had told either agent the graph was there. The
 * provisioner is convenience; this is the gap (D147(b)).
 */

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
   *  knows a model when the launch carried a route (ipc.ts). Renders as an
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

/**
 * ⚠ DERIVED FROM ONE NAME, PINNED AS THREE LITERALS BY THE TEST. claude's
 * mangling was MEASURED, not assumed: F92's PreToolUse bodies carried
 * `mcp__chorus-memory__read_neo4j_cypher` verbatim, hyphen intact — re-measured
 * on claude 2.1.237 by Task 6b-2 and unchanged. Deriving keeps the server name
 * in one home; the test's literals mean a change to the mangling fails loudly
 * instead of teaching every agent three names that do not exist.
 */
function toolNames(server: string): { read: string; write: string; schema: string } {
  return {
    read: `mcp__${server}__read_neo4j_cypher`,
    write: `mcp__${server}__write_neo4j_cypher`,
    schema: `mcp__${server}__get_neo4j_schema`
  }
}

/**
 * ⚠ EVERY LINE IS PAID FOR ON EVERY LAUNCH, IN CONTEXT — which is the named
 * cost D147(e) accepted rather than hid, and the reason the count is pinned by
 * a test. Nineteen, not seven, because F89 measured that an agent obeying the
 * seven still produced an unsourced memory: it was told to cite a node nothing
 * created, and never told the property set the validator filters on. Each new
 * line answers a numbered clause of F89, D169(c) or D173(Q5) — see the task's
 * spec §1.3 for the mapping. Growth beyond this is a decision, not a drift.
 *
 * ⚠ EACH ELEMENT IS ONE PHYSICAL LINE AND CONTAINS NO NEWLINE, TEMPLATES
 * INCLUDED. That is what makes the codex render legal at all — see
 * `assertSingleLine`.
 *
 * ⚠ THE CYPHER USES SINGLE-QUOTED STRING LITERALS THROUGHOUT, AND THAT IS
 * DELIBERATE. `tomlBasicString` (mcpConfigCore.ts:40) escapes `"` to `\"`, which
 * is legal — double quotes demonstrably survive the codex render today. Single
 * quotes keep the escaping depth at one, so a reader of the live command line
 * sees the Cypher an agent will actually run. The only `"` in the whole
 * contract is the pair around the server name in line 1.
 *
 * ⚠ NO DELETION VERB APPEARS IN ANY TEMPLATE. `:Memory` is superseded, never
 * deleted (D147(c)); `:AgentSession` is append-only forever (D169(a)).
 */
export function memoryContractLines(ctx: MemoryContractContext): readonly string[] {
  const t = toolNames(ctx.serverName)
  const repoId = ctx.repoId ?? 'unknown'
  const model = ctx.modelId ?? 'unknown — pass your own model identifier'
  const head = ctx.lastIndexedHead ?? 'unknown'
  // ⚠ ONE STRING, USED BY THE THREE WRITING TEMPLATES (both WRITEs and
  // SUPERSEDE). A second copy would drift from `memoryWriteParams`
  // (provenanceCore.ts:174) the first time a property is added, and the drift
  // would be invisible: the write would succeed and the memory would simply not
  // be counted.
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
    `A :Memory carries exactly these properties and no others: id, content, chorusProjectId, writtenVia ('mcp'), assertedByModel, assertedByAdapter, validFrom (an ISO 8601 string), validTo (null while the belief is current). Do not add a property of your own invention, however useful it seems: Chorus reads only the list above, so anything else is invisible to it and to every later session. How sure you are is not a property — say it in the content, or cite a second source.`,
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

/** claude's file: Markdown, headed, trailing newline. */
export function renderInstructionsMarkdown(lines: readonly string[]): string {
  return ['# Project memory (Chorus)', '', ...lines.map((l) => `- ${l}`), ''].join('\n')
}

/** codex's argv: ONE physical line. */
export function renderInstructionsOneLine(lines: readonly string[]): string {
  return assertSingleLine(lines.join(' '))
}

/** The adapter's own declared vehicle for the contract, or nothing. */
export type InstructionsMechanism = InstructionsDescriptor['mechanism']

/**
 * D148, refined by D169: pick the contract's rendering from the adapter's OWN
 * DECLARED MECHANISM, and withhold it entirely when the graph did not answer.
 *
 * ⚠ NO `id === 'claude'` ANYWHERE IN HERE, and that is `mcpConfigWrite.ts`'s
 * rule applied to a second capability: *"every decision here reads the
 * descriptor"*. The fifth adapter is wired by declaring a descriptor, not by
 * editing this function — and an adapter that declares `null` gets no text at
 * all, which is what makes kimi, opencode and noHarness honest rather than
 * merely unimplemented.
 *
 * ⚠ `ctx === null` MEANS "THE MERGE FAILED", AND IT IS THE ONLY EXPRESSION OF
 * THE REACHABLE GATE. It lives in this pure module rather than inside
 * `withMcpEnv` for one reason that is worth a sentence: THERE IS NO
 * `src/main/ipc.test.ts` — `ipc.ts` has no unit suite at all — so a gate
 * written only there could not be asserted by anything. Here it is three lines
 * of test.
 *
 * ⚠ WHY REACHABILITY EARNS A GATE (F89, D169(b)): v1 emitted the contract for a
 * CONFIGURED project, so with Docker stopped an agent was handed a paragraph of
 * confident instructions about a database that refuses every query. It tries
 * once, fails, and learns the feature is flaky — which is worse than never
 * being told.
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

/**
 * ⚠ LOAD-BEARING, NOT DEFENSIVE — AND THE FAILURE IT PREVENTS IS SILENT.
 * `tomlBasicString` (mcpConfigCore.ts) escapes backslashes and quotes and NOT
 * newlines, so a raw newline reaching a `-c key="…"` override is an illegal
 * TOML basic string — and codex reports an unknown or malformed `-c` path by
 * IGNORING IT WITHOUT A WORD (codex.ts). The symptom would not be an error; it
 * would be a contract that simply never arrives, indistinguishable from an
 * agent that read it and ignored it.
 */
export function assertSingleLine(v: string): string {
  if (/[\r\n]/.test(v)) throw new Error('A codex developer instruction must be one physical line.')
  return v
}
