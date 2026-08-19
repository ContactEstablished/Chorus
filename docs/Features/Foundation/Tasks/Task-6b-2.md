# Task 6b-2 — Contract v2, the `:AgentSession` node, and the reachable gate

_Phase 6b, task 2 of 4. Authored 2026-08-19 against `a3ba6f9`; amended 2026-08-19 after CR-6b.0 (D173)._

## Source Of Truth

| Document | Owns |
|---|---|
| `roadmap.md` §6 — **D169** (`roadmap.md:672`), **as amended by D173** (`roadmap.md:676`) | Every ruling this task executes. **They are authoritative; where this doc and D169/D173 disagree, D169/D173 win.** |
| `roadmap.md` §5 — **F89** (`:375`), **F92** (`:378`), **F93** (`:379`) | The three measured failures the task repairs |
| `roadmap.md` §6 — D148, D147(c), D147(e), D126, D94.3, D55, D58, D83, D49 | The rulings this task must not cross |
| [`Phase-6b-Overview.md`](Phase-6b-Overview.md) | The phase's verified ground facts and its milestone |
| [`../Phase-6-IdentityModel.md`](../Phase-6-IdentityModel.md) §2, §3, §6 | `workspaceInstanceId`, `repoId`, and what *"sourced"* means |
| [`../ImplementationSpecs/ImplementationSpec-6b-2.md`](../ImplementationSpecs/ImplementationSpec-6b-2.md) | The full contract text, exact insertion points, and the runtime drive |

## Initial Starting Point — verified 2026-08-19 at `a3ba6f9`, amended 2026-08-19 after CR-6b.0 (D173)

Every line number below was opened and read this session. Anything not in this table was not checked.

| Fact | Where | Value |
|---|---|---|
| `memoryContractLines()` | `instructionsCore.ts:26` | **seven lines, no parameters** — the v1 contract F89 indicts |
| `renderInstructionsMarkdown` / `renderInstructionsOneLine` | `instructionsCore.ts:52` / `:57` | the two renderers; shape unchanged by this task |
| `assertSingleLine` | `instructionsCore.ts:70` | throws on `\r` or `\n`; already imported by `codex.ts:7` |
| `withMcpEnv` | `ipc.ts:728` | `(opts, project, agent, cwd)` — **no `sessionId`, no model** |
| the configured gate | `ipc.ts:734` · `:737` | `memory.mcpLaunchInput(project.id)` then `if (!input) return opts` |
| the adapter lookup | `ipc.ts:742` | `getAdapter(agent) ?? null` — one lookup for both consumers |
| **the comment this task amends** | `ipc.ts:744`–`:748` | *"gated by the `if (!input) return opts` above and by nothing else … two gates drift"* |
| the contract composition | `ipc.ts:749` | `const instructions = renderInstructionsFor(adapter)` |
| `renderInstructionsFor` | `ipc.ts:823`–`:833` | switches on `getCapabilities().instructions?.mechanism`; **no `id ===` anywhere** |
| `withMcpEnv` call sites | `ipc.ts:1577` · `:1630` · `:1660` · `:2821` | **all four confirmed**; every one already has the session row id in scope (`:1540`/`:1614`/`:1645` create the row; the relaunch handler reads it at `:2735` and also has `sessionId` from the payload at `:2734`) |
| the launch's model | `ipc.ts:1440`–`:1443` · `sessionManager.ts:1149` | `opts.route?.modelId ?? null` — **the only definition of "the model for this launch" in the app** |
| `claude.instructionsArgs` | `claude.ts:253`–`:266` | writes the file, returns `['--append-system-prompt-file', path]`, `[]` on failure |
| `codex.instructionsArgs` | `codex.ts:173`–`:181` | **the one home** of `developer_instructions`; `tomlBasicString(assertSingleLine(parts.join(' ')))` |
| `CODEX_JADE_ECHO_INSTRUCTIONS` | `codex.ts:795`–`:807` | 11 lines joined with `' '`; **already contains `"> "` — double quotes reach a working codex launch today** |
| `tomlBasicString` | `mcpConfigCore.ts:40`–`:42` | escapes `\` → `\\` and `"` → `\"`. **Single quotes are untouched. Newlines are not escaped.** |
| `PtyLaunchInstructions` | `types.ts:542`–`:550` | `{ text, filePath }` — unchanged by this task |
| `InstructionsDescriptor` | `types.ts:245` | `{ mode, mechanism: 'append-system-prompt-file' \| 'config-override' }` |
| `types.ts` imports | `types.ts:5` · `:10` | **both `import type`** — so `instructionsCore.ts` may import from it and stay pure |
| `mcpLaunchInput` | `memoryService.ts:217` (decl) · `:591` (impl) | pure storage read + URI re-validation; returns `null` for an unconfigured project |
| `MemoryResult<T>` | `memoryService.ts:129` | `{ok:true,value}` \| `{ok:false,reason}` — the shape the new method returns |
| `driver.withSession` | `neo4jClient.ts:148` (decl) · `:220` (impl) | `SessionResult<T>`; **disposes the cached driver on any failure** (`:236`) |
| **the docblock this task amends** | `neo4jClient.ts:143`–`:147` | *"USER-INITIATED CALLERS ONLY (D58) … Nothing here may be reached from a boot hook, a timer, a restore path or a retry."* |
| `CONNECT_TIMEOUT_MS` | `neo4jClient.ts:53` · used `:77`–`:78` | **5000**, on both `connectionAcquisitionTimeout` and `connectionTimeout`; `maxTransactionRetryTime: 0` (`:79`) so 5 s is a ceiling, not a multiple |
| `memoryWriteParams` | `provenanceCore.ts:174`–`:185` | `id · content · chorusProjectId · writtenVia · assertedByModel · assertedByAdapter · validFrom · validTo` — **all strings, no `confidence`** (`:35`) |
| `HAS_SUPPORT` / `HAS_SESSION` | `provenanceCore.ts:208` / `:209` | `SUPPORTED_BY` to a `:File` or `:Commit`, **and** `(:AgentSession)-[:PRODUCED]->` |
| `workspaceInstanceId()` | `provenanceCore.ts:66`–`:71` | `wt:<worktreeId>` or `pj:<projectId>` |
| **`workspaceInstanceIdFor()`** | `codeIndexCore.ts:387`–`:394` | **always `pj:<projectId>`** — *"the project's OWN checkout, and only that"* |
| `session_id_unique` | `graphSchemaCore.ts:69` (graph migration **v1**) | the only mention of `:AgentSession` in the codebase; **no node is ever created** |
| `memory_text` | `graphSchemaCore.ts:82` (v1) | `FULLTEXT INDEX … FOR (m:Memory) ON EACH [m.content]` — **created, never queried anywhere in `src/`** |
| `LATEST_GRAPH_VERSION` | `graphSchemaCore.ts:122` | **2**; a property-only node needs no new version — see Non-Goals |
| `:File` / `:Commit` identity | `codeIndexCore.ts:320` / `:346` | `(workspaceInstanceId, relPath)` and `(repoId, sha)` |
| the memory chip | `ProjectSettingsView.vue:880`–`:899` · `stores/memory.ts:25` | `MemoryConnection = 'unknown' \| 'connected' \| 'failed'`, session-lifetime, set only by `memory:test` |
| the broadcast precedent | `ipc.ts:4643`–`:4648` · `preload/index.ts:642` | `SessionContext` — main-memory fact → `webContents.send` → preload subscription → store |
| `IpcChannel` count | `src/shared/ipc.test.ts:3510` **and** `:3897` | **`toHaveLength(107)` in both places.** (The `node -e` one-liner in older task docs reports **111**; it over-counts nested object keys and is **not** the authority.) |
| Baseline | Phase-6b-Overview | typecheck **0** · vitest **2618 / 74 files** · `grep:secrets` clean · `MIGRATIONS.length` **20** · runtime deps **9** |

### ⚠ Seven facts measured this session that will cost a session if they are not believed

1. **`workspaceInstanceId` FOR EVERY STRUCTURAL NODE IN THE GRAPH IS `pj:<projectId>`, NEVER `wt:<worktreeId>`.**
   The identity model (§2, `Phase-6-IdentityModel.md:41`) defines both prefixes, but the *only* writer of
   `:File` / `:Directory` nodes is `memoryService.index`, which calls `workspaceInstanceIdFor(projectId)`
   (`memoryService.ts:972` → `codeIndexCore.ts:392`) and therefore always writes `pj:`. **A worktree-backed
   session handed `wt:<id>` would get a WRITE template whose `MATCH (f:File …)` matches nothing, the `CREATE`
   would never run, and the tool would return an empty result set with no error.** The contract renders
   `workspaceInstanceIdFor(project.id)` and nothing else.
2. **THE FULLTEXT CALL SYNTAX WAS RUN, NOT RECALLED.** Against the live `chorus-g2-neo4j`
   (**Neo4j Kernel 5.26.29, community**, verified by `CALL dbms.components()` this session):
   `CALL db.index.fulltext.queryNodes('memory_text', $q) YIELD node AS m, score WHERE m.chorusProjectId = $projectId AND m.validTo IS NULL RETURN m.id AS id, m.content AS content ORDER BY score DESC LIMIT 10`
   was **accepted** and returned `[]` — zero rows because the single `:Memory` in that graph is the G2 canary
   and carries `note`/`key`, not `content`, so the fulltext index has nothing in it. **Accepted ≠ useful:
   re-run it after a real memory exists.**
3. **`mcp-neo4j-cypher`'s READ TOOL ACCEPTS A `CALL` QUERY, DESPITE ITS ERROR MESSAGE.** Measured: the READ
   template above ran through `mcp__chorus-memory__read_neo4j_cypher` fine, while a `MATCH … CREATE …` and even
   an `EXPLAIN`-prefixed query were refused with *"Only MATCH queries are allowed for read-query"*. The check is
   *does this query write*, not *does it start with `MATCH`*. **Do not "fix" the READ template into a `MATCH`
   form on the strength of that message.**
4. **DOUBLE QUOTES ALREADY SURVIVE THE CODEX RENDER — MEASURED IN SHIPPED CODE, NOT ARGUED.** `tomlBasicString`
   (`mcpConfigCore.ts:41`) turns `"` into `\"`, which is a legal TOML basic string, and `CODEX_JADE_ECHO_INSTRUCTIONS`
   (`codex.ts:799`) already contains `"> "` while the v1 contract line 1 contains `"chorus-memory"` — both reach a
   working codex launch today (6a-1's runtime drive). **The templates should still use single-quoted Cypher string
   literals**, so the escaping depth stays at one and a reader of the live command line sees the Cypher they wrote.
5. **`session_id_unique` EXISTS ON THE REAL GRAPH.** `SHOW CONSTRAINTS` this session lists it as `UNIQUENESS`
   over `:AgentSession(id)`, alongside `file_identity`, `commit_identity` and `memory_id_unique`. **`MATCH (s:AgentSession) RETURN count(s)` returns 0** — the constraint has never had a node to protect.
6. **A BROKEN MEMORY CALL AND A SILENT ONE ARE TWO DIFFERENT FAILURES, AND ONLY THE FIRST IS VISIBLE TO THE
   AGENT.** Measured on **claude 2.1.235**, 2026-08-19 (`_verify/6b-4/hookprobe/ptf.log`, `ptu.log`): a memory
   tool call carrying deliberately broken Cypher fired **`PostToolUseFailure`** — its body carries `error` —
   while the well-formed one fired **`PostToolUse`**. **Why it matters to this task:** a malformed query is a
   LOUD failure, returned to the agent as a failed tool result, and a competent agent retries. The failure this
   task must cover is the QUIET one — the tool **SUCCEEDS**, returns no row and creates nothing, because
   `MATCH … CREATE` creates nothing when a `MATCH` is empty and the driver calls that a normal result. **Two
   failure modes, two channels; the contract must name both** (D173 Q5), which is what the self-verifying
   `RETURN` and its contract line do.
7. **THE THREE WRITING TEMPLATES WERE EXECUTED AGAINST THE LIVE GRAPH — AND ROLLED BACK.** 2026-08-19,
   `_verify/6b-4/probe-write-template.cjs`, Neo4j **5.26.29**, **one transaction, rolled back**; node count
   **710 before and 710 after**, so the graph is exactly as the probe found it. Run verbatim as the spec
   writes them: WRITE cited to a file (`relPath: 'package.json'`, `$wid = 'pj:a43b395d…'`) →
   `{id, produced: 1, supportedBy: 1}`; **the same WRITE with a relPath that does not exist → 0 rows**;
   WRITE cited to a commit → `{id, produced: 1, supportedBy: 1}`; SUPERSEDE →
   `{id, produced: 1, supportedBy: 1, supersedes: 1}` with `old.validTo` set inside the tx. **So the
   aggregating `RETURN` is valid Cypher on this server, `count(p)` returns 1 rather than a row count, and the
   contract's sentence about an empty result is measured rather than argued.** **⚠ AND THE TRAP THE DRIVE
   MUST AVOID: `CLAUDE.md` IS NOT AN INDEXED `:File` ON THIS MACHINE** — it is not in `git ls-files`, so the
   indexer never wrote a node for it and a drive that cites it gets the zero-row case, which reads as a broken
   template. **Cite `package.json`, or another path `git ls-files` actually lists.** **Re-run the probe at
   pickup** — planners and drivers move between versions, and a rolled-back transaction costs a minute and
   nothing else.

## Goal

Make the contract **compliable** and make its emission **honest**.

F89's finding is that an agent obeying the v1 contract to the letter still produces a memory the validator
counts as unsourced: it is told to draw `PRODUCED` *"from your own `:AgentSession` node"* while nothing creates
that node and nobody tells it its session id, and it is told to write a `:Memory` without being told the
property set `validate` filters on. This task creates the node, names the ids, names the three tool names, names
the property set, and hands over **four templates (READ, WRITE cited to a file, WRITE cited to a commit,
SUPERSEDE)**, each parameterised and each one physical line — and it *withholds the whole contract* when the
graph did not answer, so an agent is never told about a database it cannot reach. (**D169(c)(4) says *three*** because it
counts the two WRITE forms as one template; the count in these documents is **four**, and they are the same
four statements.)

When this task lands, `MATCH (s:AgentSession) RETURN s` returns one row per launch into a memory-configured
project, and an agent that follows the contract produces a memory that `memory:validate` counts as **sourced**.

## Exact Scope

**Edit**

- `src/main/adapters/instructionsCore.ts` — `MemoryContractContext`; `memoryContractLines(ctx)`; move
  `renderInstructionsFor` here from `ipc.ts` and give it the reachability gate.
- `src/main/adapters/instructionsCore.test.ts` — the pinned line count and every structural assertion.
- `src/main/services/memoryService.ts` — `registerAgentSession` on the interface and the implementation;
  `AgentSessionRegistration` / `AgentSessionFacts` types; the Cypher constants.
- `src/main/services/memoryService.test.ts` — the ok / unreachable / never-configured paths.
- `src/main/services/neo4jClient.ts` — **the `withSession` docblock only** (`:143`–`:147`). No behaviour change.
- `src/main/services/sessionManager.ts` — export `launchModelId(opts)`; use it at `:1149`.
- `src/main/ipc.ts` — `withMcpEnv` gains `sessionId`; the MERGE; the amended gate comment; the broadcast;
  delete the local `renderInstructionsFor` (`:823`–`:833`); update the four call sites.
- `src/shared/ipc.ts` — one channel (`MemoryLaunch`) and one event schema.
- `src/shared/ipc.test.ts` — **both** `toHaveLength` assertions (`:3510`, `:3897`).
- `src/preload/index.ts` — `onMemoryLaunch`, modelled on `onSessionContext` (`:642`).
- `src/renderer/src/stores/memory.ts` — `launchByProject` state + the event handler.
- `src/renderer/src/views/ProjectSettingsView.vue` — one line under the existing chip.

**Nothing else.** No adapter file changes. No `types.ts` change (see §5 of the spec for why the context type
lives in `instructionsCore.ts` and not there).

## Non-Goals

- **⚠ NO MIGRATION OF ANY KIND — SQLITE OR GRAPH.** `MIGRATIONS.length` is whatever 6b-1 left it at (20 → 21)
  and this task adds none. `LATEST_GRAPH_VERSION` stays **2**: `session_id_unique` was created by graph
  migration **v1** (`graphSchemaCore.ts:69`) and **is present on the live graph** (`SHOW CONSTRAINTS`, this
  session); a node whose only novelty is its *properties* needs no schema in Neo4j, and adding a v3 that
  created nothing would claim a schema change that did not happen.
- **No auto-start, no bolt-wait, no `docker start`.** D170 / 6b-3. If the container is down, the contract is
  withheld and the launch proceeds — that is the whole of this task's failure behaviour.
- **No index refresh and no `lastIndexedHead` write.** 6b-3. **But the contract line that reports it is
  authored here**, rendering `null` as `unknown`, so 6b-3 changes one argument and no text.
- **No nudge (6b-4). No counters (6b-1).** Do not touch the `-o NUL` hook entry (`claude.ts:222`–`:224`);
  its invariant is 6b-4's vehicle on a *different* route and breaking it here would be silent.
- **⚠ NO TCP PROBE, ANYWHERE (F93).** A socket connect declares Neo4j up **~4.3 s early** — measured. The
  gate is the bolt round trip and nothing else.
- **No deletion path.** No `DELETE`, `DETACH DELETE` or `REMOVE` in any Cypher this task adds — neither in
  Chorus's own statement nor in a contract template. `:AgentSession` nodes are append-only forever.
- **No new dependency** (runtime deps stay **9**). **No new renderer route** — the surface is the existing
  Memory section in `ProjectSettingsView.vue`.
- **No `CLAUDE.md` / `AGENTS.md` / `~/.codex/config.toml` write** (D49). The contract still travels only in
  a Chorus-owned per-session file and in argv.
- **No `confidence` field in any form** (D94.3). The word must not appear in `instructionsCore.ts` at all.
- **Do not revert, stage or commit unrelated working-tree changes. Do not commit.**

### What happens if the baseline fails

This task ships the first clean baseline of the repaired contract, and D173 (Q5) pre-registers what comes next
if it does not take. If a drive with the contract fixed, the gate honest and the graph reachable still shows
**no write attempts**, or attempts that stay **unsourced**, the named escalation is a Chorus-owned `recall` /
`remember` MCP pair — an agent-invoked convenience path over the same graph. **It is a FUTURE decision and is
explicitly NOT in this task's scope:** whether an agent-invoked Chorus tool satisfies D126's *"no app-mediated
graph writes"* is an interpretation nobody has ruled on, and nothing here authorises it. Raw Cypher through
`mcp-neo4j-cypher` stays available in any case — a convenience pair would sit beside these templates, never
replace them.

## Dependencies

**6b-1 must have landed.** Two reasons, and the second is the operational one:

1. Its counters are how the phase milestone will be read, and this task's runtime drive reports them.
   **⚠ THEY ARE NOT THE WRITE-SIDE EVIDENCE (D173 Q5).** A moved write counter says one thing only: a
   write-tool call succeeded. `memory:validate`'s sourced count — **`N of N`** — is what says a memory was
   actually created and cited, and it is the milestone evidence wherever the two could be confused.
2. **6b-1 edits `ipc.ts` and `src/shared/ipc.ts`, and so does this task.** Running them in parallel produces
   a conflict in the one file in this repo nobody wants to merge by hand. Sequential, not concurrent.

Take `IpcChannel`'s count and `MIGRATIONS.length` **from the tree as 6b-1 left it**, not from the table above.

## Step-by-step Work

1. **Run §0 of the spec before writing anything.** Six probes: `claude --version`; the F92 re-measurement;
   the fulltext syntax against the running Neo4j; `tomlBasicString` on a Cypher string; `SHOW CONSTRAINTS`;
   and §0.7's rolled-back execution of the three writing templates.
   **Every one of them has already been run once this session and the answers are in the spec — re-run them
   anyway.** A CLI moved a minor version and a docker volume can be restored from anywhere.
2. **`instructionsCore.ts` — the context type and contract v2.** `memoryContractLines(ctx)` now takes the
   identity bundle and returns **19 lines** (the spec gives every one verbatim). Keep the module pure: the
   only new import is `import type { InstructionsDescriptor } from './types'`, which erases.
3. **Move `renderInstructionsFor` out of `ipc.ts` into `instructionsCore.ts`**, with the signature
   `(mechanism, ctx: MemoryContractContext | null)` — `null` means *the graph did not answer*. **This is what
   makes the gate testable**: `src/main/ipc.ts` has no test file (verified — `src/main/ipc.test.ts` does not
   exist), so a gate expressed only inside `withMcpEnv` could not be asserted at all. Carry the *"no
   `id === 'claude'` anywhere in here"* docblock across unchanged; it is still the rule.
4. **`memoryService.ts` — `registerAgentSession(projectId, {sessionId, agent, model, startedAt})`.** One
   `withSession`, two statements: the MERGE (which decides the gate) and a bounded read that returns the
   `repoId` the graph's own `:Commit` nodes carry plus the indexed `:File` count. **The read is wrapped so it
   can never fail the gate.** Returns `MemoryResult<AgentSessionFacts>`.
5. **`neo4jClient.ts` — amend the `withSession` docblock** (`:143`–`:147`). It currently says no caller may be
   reached from a restore path; `withMcpEnv` is called from the restore relaunch at `ipc.ts:2821`. **The claim
   must not outlive the code** — the same rule D168 applies to `agentEvents.ts`'s header. Name the launch path,
   say why a launch is a click (D169/D170), and keep the refusal of timers, watchers and boot hooks verbatim.
6. **`sessionManager.ts` — export `launchModelId(opts)` and call it at `:1149`.** Three lines. It exists so
   *"the model for this launch"* keeps exactly one definition when `withMcpEnv` starts reading it too.
7. **`ipc.ts` — the surgery.** `withMcpEnv` gains a **required** fifth parameter `sessionId: string`; the
   MERGE goes immediately after the adapter lookup (`:742`) and before the contract comment (`:744`); the
   comment is amended to the two-gates wording in the spec; `renderInstructionsFor` is deleted from this file
   and imported; the four call sites pass `row.id`. Broadcast on **both** outcomes; `[memory]` warns on
   failure only.
8. **The channel, the preload hook, the store field, the one line of UI.** Copy `SessionContext`'s wiring
   (`ipc.ts:4643`, `preload/index.ts:642`) rather than inventing a shape.
9. **Tests**, per Test Expectations below.
10. **The runtime drive.** It is the part that decides the task; do not report the task done on a green suite.

## Test Expectations

**`instructionsCore.test.ts`** — extended, and it carries the deliberate speed bump:

- **the line count is pinned to an exact number** (`expect(lines).toHaveLength(19)`) with a comment saying
  D147(e) is why: every line is paid for in context on every launch, so growth must be a decision;
- **every line contains no `\r` and no `\n`** — the existing assertion, now over the templates too;
- the render contains the project id, the `pj:` workspace instance id, the session id and the agent id
  **as given in the context**, not as literals;
- `repoId: null` renders `unknown` and **never the string `null`**; same for `modelId` and `lastIndexedHead`;
- **the three tool names appear as exact literals** — `mcp__chorus-memory__read_neo4j_cypher`,
  `mcp__chorus-memory__write_neo4j_cypher`, `mcp__chorus-memory__get_neo4j_schema` — even though the code
  derives them from `CHORUS_MEMORY_SERVER`, so a change to the derivation fails loudly (F92);
- **all eight `:Memory` property names appear**, drawn from `memoryWriteParams`' own key list rather than
  re-typed, and **`writtenVia: 'mcp'`** appears;
- **`/confidence/i` does not match the rendered text, and does not match the source file either** (D94.3);
- each of the four templates (READ, WRITE cited to a file, WRITE cited to a commit, SUPERSEDE) is a single physical
  line and contains **no** `DELETE`, `DETACH` or `REMOVE`;
- **the two WRITE templates and SUPERSEDE return their own evidence** (D173 Q5) — assert the literals
  `count(p) AS produced` and `AS supportedBy` in all three, and `count(x) AS supersedes` in SUPERSEDE, together
  with the named relationship variables (`[p:PRODUCED]`, `[c:SUPPORTED_BY]` / `[r:SUPPORTED_BY]`,
  `[x:SUPERSEDES]`), because that `RETURN` is the only thing separating a write that created nothing from one
  that worked;
- the one-line render passes `assertSingleLine`, and its length is asserted **under 8 000 characters** — a
  bound with headroom over the measured ~4 900, so a future line that doubles the contract is a failing test
  rather than a truncated command line;
- **`renderInstructionsFor(mechanism, null)` returns `undefined` for every mechanism** — this is the gate;
- `renderInstructionsFor('append-system-prompt-file', ctx)` returns Markdown,
  `renderInstructionsFor('config-override', ctx)` returns one line, `renderInstructionsFor(null, ctx)`
  returns `undefined`.

**`memoryService.test.ts`** — new `describe`, using the file's existing doubles (`fakeStore` `:94`,
`stubDriver` `:134`, `forbiddenDriver` `:118`):

- **ok path**: a stub driver records the statements; the first is the MERGE, it carries exactly the five
  `SET` properties plus the id, `writtenVia` is `'app'`, and the returned `repoId` is what the read yielded;
- **unreachable path**: a factory whose `session().run` rejects → `{ok:false}`, and the reason is the
  classified string, **never the bolt URI**;
- **the read cannot fail the gate**: a driver whose *second* statement throws still returns `{ok:true}` with
  `repoId: null`;
- **unconfigured project** → `{ok:false}` **without touching the driver** — assert with `forbiddenDriver`,
  the file's own idiom;
- **no `DELETE`/`DETACH`/`REMOVE` in either statement**, asserted over the exported constants the way
  `codeIndexCore.test.ts` already does for the indexer.

**`adapters.test.ts`** — unchanged behaviour, re-run as a regression: the capability-honesty loop over five
adapters and three descriptors still passes, and **a launch with no memory configured is still byte-identical**
for all four PTY adapters. This task must not touch that file.

**`src/shared/ipc.test.ts`** — both length assertions move by exactly one.

## Verification Commands

```
npm run typecheck
npx vitest run
npm run grep:secrets
```

```powershell
# the word that must not exist
Select-String -Path src\main\adapters\instructionsCore.ts -Pattern "confidence" -CaseSensitive:$false

# exactly one emitter of the contract, and one home for the mechanism switch
Select-String -Path src -Include *.ts -Recurse -Pattern "renderInstructionsFor|memoryContractLines"

# no deletion verb in any new Cypher
Select-String -Path src\main\adapters\instructionsCore.ts,src\main\services\memoryService.ts -Pattern "DETACH|DELETE|REMOVE "

# the counters this task moves by a known amount
Select-String -Path src\shared\ipc.test.ts -Pattern "toHaveLength\("
```

**Runtime drive — the task is not done until this has been observed, with the container up:**

1. Launch a **claude** pane on the Chorus project in the dev app. Then, against `bolt://127.0.0.1:7688`:
   `MATCH (s:AgentSession) RETURN s.id, s.agent, s.model, s.startedAt, s.writtenVia` — **one row, whose `id`
   is the Chorus `sessions.id`** (confirm it against the DB row, do not eyeball a UUID).
2. Read the file under `userData\agent-instructions\<sessionId>.md`: it contains the project id, `pj:<id>`,
   the session id, the three tool names and all four templates (READ, WRITE cited to a file, WRITE cited to a
   commit, SUPERSEDE).
3. Drive the agent to run the WRITE template **once, with parameters**, **citing a TRACKED path —
   `package.json`, never `CLAUDE.md`, which is not an indexed `:File` on this machine (fact 7)**. A prompt
   naming the graph is acceptable *for this drive* — adoption is the phase milestone, not this task's gate.
   The tool's own result must be `{id, produced: 1, supportedBy: 1}` (`{id, produced: 1, supportedBy: 1,
   supersedes: 1}` for SUPERSEDE) — the exact shapes §0.7 measured; **0 rows means the citation was not in
   the graph, not that the template is wrong**. Then run `memory:validate`: it must read
   **`1 of 1`**. **⚠ THE VALIDATOR'S SOURCED COUNT IS THE EVIDENCE, NOT THE WRITE COUNTER** (D173 Q5): a moved
   write counter says only that a write-tool call succeeded, and a call whose `MATCH` found nothing succeeds
   too. *Optional, not scope:* `MATCH (s:AgentSession {id: $sessionId})-[:PRODUCED]->(m:Memory) OPTIONAL MATCH
   (m)-[:SUPPORTED_BY]->(src) RETURN m.id, labels(src)` scopes the same question to the session just launched
   — one cheap extra query for the drive, and no change to `memory:validate` itself.
4. `docker stop chorus-g2-neo4j`. Launch again. Confirm **four things**: the contract is absent from argv and
   no instruction file is written; the launch still works; the Memory section says the graph was unreachable
   and the contract was withheld; **the MCP config file is still written** (`.mcp.json` merged as before).
5. `docker start chorus-g2-neo4j` — **the drive must leave it running.**
6. Point a throwaway project's memory row at a **blackholed** address (`bolt://192.0.2.1:7687`) and time the
   launch. Expect **≤ ~5.5 s** added (`CONNECT_TIMEOUT_MS` = 5000, `maxTransactionRetryTime: 0`). Longer is a
   finding, not a tuning exercise.
7. **Re-run `SHOW INDEXES`** and record two things in this task's completion summary: whether the foreign
   **`search`** FULLTEXT on `:Memory(name,type,observations)` is **still present**, and whether **any `:Memory`
   node lacks `chorusProjectId`** (`MATCH (m:Memory) WHERE m.chorusProjectId IS NULL RETURN count(m)`). D173's
   recorded open item; **this step changes nothing in the graph** — no `DROP INDEX`, no relabel, no delete.

Evidence under `_verify/6b-2/`. **Capture exact outputs. Do not claim success on a failure** — a withheld
contract that was supposed to be present is the single most valuable thing this drive can find.

## Acceptance Criteria

- [ ] `claude --version` and the F92 measurement re-run this session and recorded.
- [ ] The fulltext template **run against the live Neo4j after a real `:Memory` exists**, and its output saved.
- [ ] `MATCH (s:AgentSession) RETURN count(s)` goes from **0** to ≥ 1, and every node carries
      `chorusProjectId`, `agent`, `startedAt` and `writtenVia = 'app'`.
- [ ] `memory:validate` reads **`1 of 1`** after the driven write — both halves of §6 (`SUPPORTED_BY` **and**
      `PRODUCED`) satisfied by an agent following the contract text. **This count, not a moved write counter,
      is the write-side evidence** (D173 Q5); record the WRITE tool's own `produced` / `supportedBy` values
      beside it.
- [ ] With the container stopped: contract **absent**, launch **succeeds**, MCP config **still written**,
      notice **visible**, `[memory]` warn present and **containing no URI, token or path**.
- [ ] `memoryContractLines` is **19 lines**, pinned by a test; the one-line render is a single physical line;
      the rendered codex `developer_instructions` token measured against **32 767** and the number recorded
      (estimated ≈ 4 921 for the token, ≈ 6 078 with the jade rule — **≈ 19 %** of the limit).
- [ ] `/confidence/i` matches **nothing** in `instructionsCore.ts`.
- [ ] `LATEST_GRAPH_VERSION` **2** · `MIGRATIONS.length` unchanged from 6b-1 · runtime deps **9** ·
      `IpcChannel` exactly **+1**, both assertions updated.
- [ ] typecheck **0** · vitest ≥ the 6b-1 baseline · `grep:secrets` clean.
- [ ] `docker ps` shows `chorus-g2-neo4j` **running** when the drive ends.

## Review Checklist

A spec reviewer must confirm:

1. **The contract is never composed when the MERGE failed.** Not "usually", not "the log says so" — the
   composition takes `ctx | null` and `null` returns `undefined` for every mechanism, asserted directly.
   Grep for any other path that can build contract text: there must be exactly one.
2. **The MERGE never fails a launch.** Every outcome of `registerAgentSession` — ok, refusal, throw — leads to
   `wireMcpForLaunch` running and `withMcpEnv` returning options. There is no `throw`, no early `return` and
   no `await` that is not bounded by `CONNECT_TIMEOUT_MS`.
3. **`sessionId` is a required parameter, not an optional one.** An optional identity would let a future call
   site silently stop creating the node, and the symptom would be a provenance ratio quietly returning to 0%.
   All four call sites compile only because they pass it.
4. **`workspaceInstanceId` in the contract is `pj:<projectId>`.** If it is `wt:<worktreeId>` for a worktree
   session, the WRITE template matches nothing and fails silently. Check the call, not the comment.
5. **No `id === 'claude'` in the moved `renderInstructionsFor`.** The descriptor is still what decides.
6. **The `-o NUL` hook entry is untouched** (`claude.ts:222`–`:224`) — diff it, do not assume.
7. **All four templates (READ, WRITE cited to a file, WRITE cited to a commit, SUPERSEDE) use single-quoted
   string literals** and contain no `DELETE`/`DETACH`/`REMOVE`,
   **and the three writing templates return their own evidence** — `m.id` plus `produced` / `supportedBy` (and
   `supersedes`). A template that returns only `m.id` cannot tell a successful write from a `MATCH` that found
   nothing, which is the exact silent failure D173 Q5 closed.
8. **`neo4jClient.ts`'s `withSession` docblock now tells the truth** about who calls it. A doc that still says
   "never a restore path" beside a caller reached from `ipc.ts:2821` is worse than no doc.
9. **The failure log carries no URI, no token and no file path** — the `ipc.ts:762`–`:765` rule, applied.
10. **`withSession` disposes the shared driver on failure** (`neo4jClient.ts:236`). That is pre-existing, but
    this task makes it reachable from *every launch*, so a launch against a down graph now drops a driver a
    concurrent `memory:index` may be using. Confirm the reviewer has seen this and that it is recorded as a
    known limit rather than discovered later.
11. **The foreign FULLTEXT `search` index was re-checked and written down, not acted on.** The completion
    summary says whether `:Memory(name,type,observations)` is still there and whether any `:Memory` lacks
    `chorusProjectId`. D173 left this open and asked only for an observation — a drive that dropped the index,
    or that silently omitted the check, both fail this item.
