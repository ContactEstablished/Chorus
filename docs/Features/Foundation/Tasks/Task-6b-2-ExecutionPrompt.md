# Task 6b-2 — Execution Prompt (paste into a fresh session)

> **⚠ AUTHORED 2026-08-20 against `main` at `1f62579`, WHICH IS NOT THE COMMIT THE TASK DOCUMENTS WERE
> WRITTEN AGAINST.** `Task-6b-2.md` and `ImplementationSpec-6b-2.md` were both authored at `a3ba6f9`,
> **before 6b-1 existed in any tree**. 6b-1 has since landed and been merged to `main`, and it added
> 58 lines to `src/main/ipc.ts` — **so every `ipc.ts` line number in both documents is now five lines
> low, and three of the baseline counters have moved.** Every number, path, line reference, CLI probe
> and Cypher statement below was re-run at `1f62579` while authoring this document: the AST counters
> were executed, both CLIs were re-probed, the live graph was queried through `mcp-neo4j-cypher`, and
> every cited line was opened and read rather than copied forward.
>
> **There is no fatal spec bug in this task.** `Task-6b-2.md`, `ImplementationSpec-6b-2.md` and the
> code agree on every behavioural claim I could check, and the two spec statements I could run
> against the live server (`READ_SESSION_FACTS` and the fulltext READ template) returned exactly the
> shapes the spec promises. What there *is* — **eleven corrections, ten of them line-number or
> counter drift caused by 6b-1 landing, and one a decision the documents could not know about** — is
> in **Corrections and cross-references** below. **Read that section before the spec.**

---

You are the **Coordinator** for **Task 6b-2 — Contract v2, the `:AgentSession` node, and the
reachable gate**, the **second of four tasks in Phase 6b — Memory Adoption & Measurement**.

6b-1 built the instrument. **This task builds the thing the instrument is pointed at.** F89's finding
is that an agent obeying the v1 contract *to the letter* still produces a memory `memory:validate`
counts as unsourced: it is told to draw `PRODUCED` from *"your own `:AgentSession` node"* while
nothing in the app has ever created one, and it is told to write a `:Memory` without being told the
property set the validator filters on. Today `MATCH (s:AgentSession) RETURN count(s)` returns **0**
on the real graph — I ran it this session — and the constraint protecting that label has never had a
node to protect.

**When this task lands, that count is ≥ 1 per launch, and an agent that follows the contract text
produces a memory the validator counts as sourced.**

**Repo root:** `C:\Projects\ContactEstablished\Chorus`
**Expected branch:** `main` at **`1f62579`** ("Bring the memory-usage counters onto main") — confirm
with `git branch --show-current` and `git log --oneline -1`.

> **HEAD may legitimately differ in exactly one way:** a later **docs-only** commit carrying this
> execution prompt. If HEAD differs in **any other way**, **stop, re-verify every number in Gate 2
> yourself, and say in your report what moved.** **Do not switch or create branches without
> instruction.**

---

## ⚠ GATE 0 — THE TREE, AND THE MERGE THAT PRECEDED YOU

`git status --porcelain` at authoring time — **four entries, all pre-existing, none of them yours**:

```
 M .mcp.json
 M package-lock.json
 M package.json
?? docs/Features/Foundation/Investigations/DeepSeek-Harness-Assessment.md
```

- **`.mcp.json` has no content diff** — `git diff -- .mcp.json` is empty output plus a line-ending
  warning. It is a CRLF normalisation artefact and nothing else. **Leave it.**
- **`package.json` / `package-lock.json` carry a version bump, `0.7.2` → `0.7.3`, and nothing else.**
  That is somebody's release prep, not yours. **Do not revert it, do not commit it, do not bump it
  further.** Note that `npm run typecheck` will print `chorus@0.7.3` — that is expected, not a sign
  you are in the wrong tree.
- **`DeepSeek-Harness-Assessment.md` is an untracked investigation document.** Not yours. Leave it.
- **⚠ A FIFTH ENTRY EXISTS BY THE TIME YOU READ THIS: this file.** Same rule.
- `_verify/` is gitignored working evidence (`.gitignore:165`). **Never stage anything under it.**
  `_verify/6b-1/` and `_verify/6b-4/` already exist and hold the kickoff's and 6b-1's measurements —
  **read them, do not delete them, do not commit them.** You will re-run one script from
  `_verify/6b-4/` (see Gate 3).
- Run `git status --porcelain` yourself at the start. **If you find MORE than the five above, list
  what you found in your report and still touch none of it.**

**⚠ THE MERGE THAT MADE THIS TASK POSSIBLE, RECORDED SO YOU DO NOT RE-DO IT.** 6b-1 was built and
driven on `chorus/Chorus/9acbf5d0` and had not reached `main`. On 2026-08-20 it was merged
(`1f62579`, a real merge — the two sides had diverged at `0e73926`). The only file both sides touched
was `src/renderer/src/App.vue`, in non-overlapping hunks (the Day-summary overlay prop near the
template at `:857`; 6b-1's `onSessionMemory` subscription in `onMounted` at `:227`). **All three gates
were re-run on the merge result and were green: typecheck 0 (node + web), vitest 2757 / 2757 across
74 files, `grep:secrets` clean over 6 patterns.** You inherit that as your baseline. **Do not
re-merge anything, and do not touch `chorus/Chorus/9acbf5d0` — it is now redundant.**

**Your commit contains source files and nothing else.**

---

## ⚠ GATE 1 — ENVIRONMENT, AND THE FALSE GREEN IT PRODUCES

**`node_modules` in this repo has been found EMPTY at the start of past sessions.** It is **one shared
directory**: every `.chorus` worktree junctions into
`C:\Projects\ContactEstablished\Chorus\node_modules`, so emptying it removes typecheck and vitest
from every worktree at once. Four worktrees are live right now (`git worktree list`).

```bash
npm ci                          # not `npm install` — ci installs the lockfile exactly
npm run rebuild:better-sqlite3  # the /Od workaround; .npmrc documents why
```

**At authoring time `node_modules` was populated (341 entries) and both gates ran clean without a
reinstall.** Check before you reinstall — an unnecessary `npm ci` costs minutes and, if the lockfile
in the working tree is mid-bump, can move a dependency you did not intend to move.

**The container must be up for the drive, and it is up now:**

```
docker ps -a --filter name=chorus-g2-neo4j --format "{{.Names}} | {{.Status}} | {{.Ports}}"
# measured 2026-08-20: chorus-g2-neo4j | Up 21 hours | 127.0.0.1:7688->7687/tcp
```

**⚠ THE DRIVE MUST LEAVE IT RUNNING.** §9.5 of the spec is not optional politeness — 6b-3 picks up
from a running container, and a stopped one silently changes what the next session measures.

---

## ⚠ GATE 2 — THE BASELINE, RE-TAKEN AT `1f62579`

**Every one of these was executed this session, not copied from the task documents.** Where the task
document disagrees, **this table is right and the task document is stale** — it was written before
6b-1 existed.

| Fact | Task-6b-2.md says | **Measured at `1f62579`** | Method |
|---|---|---|---|
| `IpcChannel` keys | 107 | **108** (0 spread assignments) | TypeScript AST, `ObjectLiteralExpression` property count |
| `toHaveLength` assertions | `:3510`, `:3897` | **`:3523`, `:3923`** — both say `108` | grep, both opened |
| `MIGRATIONS.length` | 20 | **21** (6b-1's v21) | TypeScript AST over `storage.ts`'s array literal |
| `sqliteTable(` | 19 | **19** — unchanged | TypeScript AST |
| Runtime dependencies | 9 | **9** — unchanged | `package.json` `dependencies` keys |
| `LATEST_GRAPH_VERSION` | 2 | **2** — `GRAPH_MIGRATIONS` has versions 1 and 2 only | `graphSchemaCore.ts:53`, `:102`, `:122` |
| `ipcMain.handle(` / `.on(` | 94 / 1 | **94 / 1** — unchanged | TypeScript AST |
| vitest | 2618 / 74 files | **2757 / 74 files** | `npx vitest run` on the merge result |
| typecheck | 0 | **0**, node + web | `npm run typecheck` |
| `grep:secrets` | clean, 6 patterns | **clean, 6 patterns** | `npm run grep:secrets` |
| App version | 0.7.2 | **0.7.3** (uncommitted bump — Gate 0) | `package.json` |
| `claude` | 2.1.235 | **2.1.237** — ⚠ **MOVED** | `claude --version` |
| `codex-cli` | 0.148.0 | **0.148.0** — unchanged | `codex --version` |

**So this task moves `IpcChannel` 108 → 109 and both assertions to `109`. It adds no migration:
`MIGRATIONS.length` stays 21, `LATEST_GRAPH_VERSION` stays 2.**

### The graph, re-queried this session through `mcp__chorus-memory__read_neo4j_cypher`

| Fact | Value | Statement run |
|---|---|---|
| Node census | **468 `:File` · 200 `:Commit` · 37 `:Directory` · 2 `:ChorusMigration` · 1 `:Memory` · 1 `:ChorusSchema` · 1 `:Project` = 710** | `MATCH (n) RETURN labels(n), count(*)` |
| `:AgentSession` | **0 nodes** — the label appears nowhere but the constraint | absent from the census above |
| `session_id_unique` | **present**, `UNIQUENESS` over `:AgentSession(id)` | `SHOW CONSTRAINTS` |
| `memory_text` | **present**, `FULLTEXT` over `:Memory(content)` | `SHOW INDEXES` |
| Foreign `search` index | **STILL PRESENT**, `FULLTEXT` over `:Memory(name,type,observations)` | `SHOW INDEXES` — D173's open item, still open |
| The one `:Memory` | keys are `["note","key"]`; **`chorusProjectId` IS NULL** → outside `validate`'s denominator | `MATCH (m:Memory) RETURN count(m), count(CASE WHEN m.chorusProjectId IS NULL THEN 1 END)` → `{total: 1, missingProjectId: 1}` |
| `workspaceInstanceId` on every `:File` | **`pj:a43b395d-51e2-47d3-8043-cb7b56094fca`** — one value, 468 files, **no `wt:` anywhere** | `MATCH (f:File) WITH DISTINCT f.workspaceInstanceId …` |
| `:Project.lastIndexedAt` | `2026-08-15T21:50:01.651Z`; **keys are `["lastIndexedAt","name","id"]` — there is no `lastIndexedHead`** | `MATCH (p:Project) RETURN keys(p)` |
| `repoId` on `:Commit` | **`a92099d934dd95548e59525b7231fd4b5f5d5f6f`**, and it equals `git rev-list --max-parents=0 HEAD` | both run |

**⚠ THE GRAPH IS UNCHANGED FROM THE PHASE-6b KICKOFF BASELINE — 710 nodes then, 710 now.** That is
the evidence that 6b-1's drive and §0.7's write-template probe both left it alone, and it means the
first `:AgentSession` row you see will provably be yours.

---

## ⚠ GATE 3 — RUN §0 OF THE SPEC BEFORE YOU WRITE A LINE

Seven probes, all in `ImplementationSpec-6b-2.md` §0. **Five of them I have already re-run for you
this session and the answers are in Gate 2 above.** Two you must run yourself, and one of those is
the reason this gate exists:

1. **§0.2 — re-measure F92 on claude 2.1.237.** ⚠ **THIS IS THE ONE THAT CHANGED.** Every hook and
   tool-deferral measurement in `Task-6b-2.md`, `ImplementationSpec-6b-2.md`, `Phase-6b-Overview.md`
   and F92 itself was taken on **2.1.235**. The CLI is now **2.1.237**. Contract line 2 tells the
   agent the memory tools *"may not be in your live tool list yet — MCP tools are loaded on demand"*,
   and that clause is a claim about the CLI's behaviour, not about your code. **Re-run the
   `--settings` PreToolUse probe** (`_verify/6b-1/hookprobe/` has the working harness and 6b-1's
   `RESULTS.md` documents the exact invocation that produced probe **B**). Expected: two `PreToolUse`
   bodies, `tool_name` = `ToolSearch` **then** `mcp__chorus-memory__read_neo4j_cypher`.
   **⚠ TWO TRAPS, BOTH ALREADY PAID FOR:** paths inside the settings JSON must use **forward
   slashes** (a backslash in a JSON string is an escape, and the first attempt at this silently loaded
   no hooks at all), and the hook's curl **must** carry `-o NUL` (hook stdout is a control channel).
   **If F92 no longer reproduces**, change line 2's second clause, record the new measurement, and
   **do not delete the line** — naming the three tools is what closes F89's *"six discovery calls
   before answering"*, and that half is independent of deferral.
2. **§0.7 — re-run `_verify/6b-4/probe-write-template.cjs`.** It executes the three writing templates
   verbatim inside **one transaction that is rolled back**. It costs a minute and leaves the graph at
   710 nodes. A Cypher planner moves between server versions and the aggregating `RETURN` is the one
   part of D173's self-verifying templates that was reasoning before it was measured.

The other five (§0.1 CLIs, §0.3 fulltext syntax, §0.4 `tomlBasicString`, §0.5 `SHOW CONSTRAINTS`,
§0.6 the two failure modes) are answered in Gate 2 and in **Correction 10** below. **Re-run any you
want to see with your own eyes — none of them costs more than a minute — but do not let the fact
that I ran them stop you re-running §0.2.**

---

## Corrections and cross-references

**Read this before the spec.** Ten of these are drift caused by 6b-1 landing; one is a decision the
documents could not have known about.

### 1. ⚠ EVERY `ipc.ts` LINE NUMBER IN BOTH DOCUMENTS IS FIVE LINES LOW

6b-1 added 58 lines to `src/main/ipc.ts`, most of them above `withMcpEnv`. **Both documents' line
references were correct at `a3ba6f9` and are wrong now.** Every row below was opened and read at
`1f62579`:

| What | Documents say | **Actually at `1f62579`** |
|---|---|---|
| `withMcpEnv` signature | `:728` | **`:733`** |
| `memory.mcpLaunchInput(project.id)` | `:734` | **`:739`** |
| `if (!input) return opts` (the CONFIGURED gate) | `:737` | **`:742`** |
| `const adapter = getAdapter(agent) ?? null` | `:742` | **`:743`** |
| the D148 comment this task amends | `:744`–`:748` | **`:745`–`:749`** |
| `const instructions = renderInstructionsFor(adapter)` | `:749` | **`:754`** |
| `wireMcpForLaunch` call | `:751` | **`:756`** |
| the `[memory]` log rule | `:762`–`:765` | **`:767`–`:770`** |
| `const withInstructions = …` | `:771` | **`:776`** |
| the local `renderInstructionsFor` to delete | `:823`–`:833` | **`:828`–`:838`** |
| launch route / `modelId` composition | `:1440`–`:1443` | **`:1444`–`:1447`** |
| call site 1 (worktree launch) | `:1577` | **`:1582`** |
| call site 2 (existing worktree) | `:1630` | **`:1635`** |
| call site 3 (current tree) | `:1665` — doc says `:1660` | **`:1665`** |
| call site 4 (restore relaunch) | `:2821` | **`:2826`** |
| relaunch `const { sessionId } = …` | `:2734` | **`:2739`** |
| relaunch `const row = storage.getSessionById(sessionId)` | `:2735` | **`:2740`** |
| `SessionContext` broadcast (the copy-me precedent) | `:4643`–`:4648` | **`:4663`–`:4668`** |

**All four `withMcpEnv` call sites confirmed, and all four already have the session row id in scope**
— `row.id` is created at `:1545`, `:1619`, `:1650` and read at `:2740` respectively, and every one is
one to five lines above its call. **`:2826` is the one that matters for idempotence**: it passes the
*same* `row.id` the original launch used, which is why a relaunch MERGEs onto the existing node
instead of orphaning it.

**⚠ RE-TAKE THESE YOURSELF ANYWAY (G6).** They were correct when I wrote them and your own edits will
move them the moment you start. Every number in this document is a pickup-day pointer.

### 2. `IpcChannel` is **108**, not 107 — and the assertions moved too

`src/shared/ipc.test.ts:3523` and `:3923`, both currently `toHaveLength(108)`. **The spec's §6 says
*"they say 107 at `a3ba6f9`; take the number from the tree as 6b-1 left it and add one"* — this is
that instruction, already resolved: you are moving 108 → 109.** 6b-1 additionally asserts its new
channel **by name**; do the same for `MemoryLaunch`.

### 3. `MIGRATIONS.length` is **21**, not 20 — and you add none

6b-1 took **v21** (the five memory-counter columns on `sessions`). This task's Non-Goals are
unchanged and now unambiguous: **no SQLite migration, no graph migration.** `LATEST_GRAPH_VERSION`
stays **2**, and I confirmed `session_id_unique` is on the live graph — a node whose only novelty is
its properties needs no schema in Neo4j.

**⚠ IF YOU NONETHELESS FIND YOU NEED ONE, DO NOT QUOTE 21 FROM HERE.** Dev worktrees share one DB. Re-derive
against `storage.ts`, the dev DB's `SELECT MAX(version) FROM schema_migrations`, and every sibling
worktree's array — a migration version claimed on another branch makes yours silently no-op.

### 4. `tomlBasicString` lives in `src/main/adapters/`, not `src/main/services/`

Both documents write a bare `mcpConfigCore.ts:40`–`:42`. The file is
**`src/main/adapters/mcpConfigCore.ts`** — there is no `mcpConfigCore.ts` under `services/`, and a
reader who assumes the services directory (as most of the other cited modules are) finds nothing.
The line numbers are exact: the function is `:40`, its one-line body `:41`, its close `:42`, and it
does what the spec says — `\` → `\\`, `"` → `\"`, **single quotes untouched, newlines not escaped.**

### 5. claude moved **2.1.235 → 2.1.237** — see Gate 3

Restated here because it is the single most consequential drift and it is easy to skim past in a
version table. It does not change any code in this task. It changes whether **contract line 2's
second clause is true**, and that clause is text you are about to ship to every agent.

### 6. ⚠ 6b-1 SHIPPED A CLOSER PRECEDENT THAN THE ONE BOTH DOCUMENTS NAME

The spec's §5.5 and §6 say *"copy `SessionContext`'s shape"*. That is still fine. But 6b-1 landed
**`SessionMemory`**, which is a *memory-domain* main→renderer event with the identical plumbing and
is a better model to copy:

| Layer | `SessionContext` (the doc's precedent) | **`SessionMemory` (6b-1's, closer)** |
|---|---|---|
| channel key | `src/shared/ipc.ts:57` | **`src/shared/ipc.ts:72`** |
| broadcast | `src/main/ipc.ts:4666` | **`src/main/ipc.ts:4703`** |
| preload forwarder | `src/preload/index.ts:643` | **`src/preload/index.ts:658`** |
| store handler | — | `src/renderer/src/stores/memory.ts` |
| App.vue subscribe/unsubscribe | `:227` region | **same `onMounted` block, `offMemory()` in the teardown** |

**⚠ AND ONE INCONSISTENCY YOU MUST DECIDE RATHER THAN DRIFT INTO.** 6b-1's
`sessionMemoryEventSchema` (`src/shared/ipc.ts:2300`) uses **camelCase** (`sessionId`), while the
spec's `memoryLaunchEventSchema` uses **snake_case** (`project_id`, `session_id`). Both conventions
exist in this file — `:1057` is `project_id: z.uuid()`. **The spec is authoritative: write it
snake_case as specified.** But say in your report that you noticed the two sibling memory events
disagree, so it is a recorded choice rather than an accident. (`zod` is **4.4.3**; `z.uuid()` is the
correct top-level form and is already used at `:915`, `:999`, `:1057`.)

### 7. The `memory:*` channel block is `:477`–`:605`, not `:465`–`:593`

`MemoryGet` `:477` … `MemoryContainerRemove` `:605`. Put `MemoryLaunch: 'memory:launch'` inside that
block.

### 8. The renderer surface has a neighbour the documents do not mention

`stores/memory.ts:25` (`MemoryConnection`) is exactly where the task doc says. But
`ProjectSettingsView.vue`'s memory chip has **moved and gained company**: the state line is now at
**`:891`** (the doc says `:880`–`:899`), and 6b-1 added its Claude-Code-scoped memory-usage aggregate
to the *same section*. **Your one new line lands in a section that already has two live sentences in
it.** Read `:889`–`:950` before you insert, and make sure the three do not read as contradicting each
other — one is a click-earned probe, one is a per-session counter roll-up, and yours is a launch-time
observation.

### 9. Roadmap line numbers are one low; the next free numbers have moved

`D169` is at **`roadmap.md:673`** (docs say `:672`); `D173` is at **`:677`** (docs say `:676`).
**Highest decision is now `D173` → next free `D174`. Highest finding is `F94` → next free `F95`.**

### 10. ⚠ THE COMMIT-CITATION TRAP — NEW, MEASURED THIS SESSION, AND NOT IN EITHER DOCUMENT

Both documents warn about **one** silent-zero-row trap for the drive: `CLAUDE.md` is not an indexed
`:File`. **That warning is still true — I confirmed `CLAUDE.md` and `docs/PLAN.md` are both untracked
(`git ls-files` lists neither), so the indexer never wrote nodes for them.** But there are **two more
of the same shape on the commit side**, and a drive that hits either reads as a broken template:

- **`:Commit` nodes are keyed by the FULL 40-character sha.** `MATCH (c:Commit {sha: '78c0893'})`
  returns **0** — I ran it. A short sha is the zero-row case.
- **The index is stale: HEAD is now 26 commits ahead of the newest indexed commit.** The graph was
  last indexed at `2026-08-15T21:50Z`, newest indexed commit `78c08936…`. I confirmed
  `1f62579b93ff40c6ae8e747775c3376fd764e805` (the merge you are standing on) is **not** in the graph.
  **Citing a recent commit gets zero rows and nothing is written.**

**Use these values for the drive. Every one was verified present in the graph this session:**

| Parameter | Drive-safe value |
|---|---|
| `$projectId` | `a43b395d-51e2-47d3-8043-cb7b56094fca` |
| `$wid` | `pj:a43b395d-51e2-47d3-8043-cb7b56094fca` |
| `$relPath` (file citation) | `package.json` — **confirmed indexed**. `src/main/ipc.ts` also works. |
| `$repoId` | `a92099d934dd95548e59525b7231fd4b5f5d5f6f` |
| `$sha` (commit citation) | `78c08936f8ca4951d0b41330b301af1c83fd852e` — **confirmed present, full sha** |

**⚠ AND THE RULE BEHIND THE VALUES, WHICH MATTERS MORE THAN THE VALUES:** a WRITE that returns **0
rows** means **the citation was not in the graph**, not that the template is wrong. Contract lines 14
and 15 exist to teach an agent exactly this. If your own drive hits it and you "fix" the template,
you will have broken the thing the task shipped.

**`READ_SESSION_FACTS` was run verbatim against the live server this session and returns what §2.1
promises**, in both cases:

```
{wid: 'pj:a43b395d-…', projectId: 'a43b395d-…'}  ->  {files: 468, repoId: 'a92099d9…'}
{wid: 'pj:does-not-exist', projectId: 'does-not-exist'}  ->  {files: 0, repoId: null}
```

**One row, never zero** — the aggregation with no grouping key is what makes the empty case safe, and
that is now measured rather than argued.

### 11. ⚠ 6b-2 OWNS A DECISION NEITHER DOCUMENT LISTS — F94 ASSIGNED IT AFTER THEY WERE WRITTEN

`Task-6b-2.md` and its spec were authored at `a3ba6f9`. **F94 was written at 6b-1's close-out**
(`roadmap.md:380`) and explicitly hands this task a decision, reserving **`D174`** for it:

> *"The reviewer's low-risk widening — **treat any `mcp__`-prefixed name as known-non-exploration,
> since a renamed `Read` can never be an `mcp__` name** — is left as a deliberate decision for
> **6b-2** (next free **D174**; no new decision is taken here)."*

**The problem it solves is real and it lands on your milestone.** 6b-1's `isKnownTool` recognises only
the names three one-shot probes produced. **Every other MCP server's `mcp__<server>__*` tools — which
a real pane loads from the user's global config — are UNKNOWN, and one completed unknown call before
the first memory read marks the session INCONCLUSIVE, which is not a pass.** The phase milestone is
read off `memory_read_first`, so a narrow known-tool set costs passes that the agent actually earned.

**This is a judgement call and it is not yours to take alone.** Do the following:

1. **Do not silently widen the set**, and do not silently skip it either.
2. **Raise it with Matthew explicitly**, with the tradeoff in one paragraph: widening makes more
   sessions conclusive at the cost of assuming no future exploration tool will ever be named
   `mcp__…`; not widening keeps the instrument conservative and loses passes.
3. If he rules, **record it as `D174` in `roadmap.md` §6** and implement it in
   `agentEventsCore.ts`'s classifier. If he defers, **say so in your report** and leave 6b-1's set
   exactly as it shipped.

**⚠ IT IS NOT IN THIS TASK'S "Exact Scope" LIST.** If you implement it, `agentEventsCore.ts` and its
test are a documented addition to scope with a decision number attached — not scope creep, but say so
plainly in the report either way.

---

## The work

**`ImplementationSpec-6b-2.md` is the build document and it is unusually complete** — §1.3 gives all
19 contract lines verbatim, §2.1 gives both Cypher constants, §5.2/§5.3 give the exact insertion
points and the amended comment text. **Follow it.** `Task-6b-2.md`'s *Step-by-step Work* gives the
order; the corrections above give the line numbers.

Two things the spec implies but does not spell out, both of which will bite at the first compile:

**A. `ipc.ts`'s import block changes more than "add one import."** Today `:277`–`:282` imports
`memoryContractLines`, `renderInstructionsMarkdown` and `renderInstructionsOneLine` from
`./adapters/instructionsCore` — **all three become unused the moment you delete the local
`renderInstructionsFor`**, because all three move behind it. Replace them with
`renderInstructionsFor`. Then add **three value imports that do not exist in this file yet**:

| Symbol | From | Note |
|---|---|---|
| `CHORUS_MEMORY_SERVER` | `./services/memoryService` | `:293` currently imports **types only** — it becomes a mixed import, or add a second line |
| `launchModelId` | `./services/sessionManager` | `:335` currently imports **types only** — same |
| `workspaceInstanceIdFor` | `./services/codeIndexCore` | **a new import edge entirely** |

**I checked for cycles: none of those three modules imports `ipc.ts`, and `codeIndexCore.ts` has zero
imports of its own — it is a pure module.** So these are safe runtime edges. Say in your report that
you introduced two type-only imports becoming value imports, because that is the kind of change that
looks free and occasionally is not.

**B. `src/main/ipc.test.ts` does not exist — I confirmed it.** That is not an oversight to fix; it is
the entire architectural reason §1.4 moves `renderInstructionsFor` into `instructionsCore.ts` and
gives it a `ctx: MemoryContractContext | null` parameter. **The gate has to live in a module that has
a test file, or the most important invariant in this task cannot be asserted by anything.** Do not
"simplify" it back into `withMcpEnv`.

**`instructionsCore.test.ts` is currently 79 lines and 9 `it` blocks** under one `describe` (*"Task
6a-1: the memory usage contract text (D148)"*). Its existing assertions — the single-physical-line
rule, the `assertSingleLine` throw, the Markdown render — all still apply and must keep passing over
the new 19-line contract. `Task-6b-2.md`'s **Test Expectations** section lists fourteen additions;
they are the acceptance criteria for the test file, not suggestions.

---

## Verification

```
npm run typecheck        # 0, node + web
npx vitest run           # >= 2757 / 74 files, plus your new cases
npm run grep:secrets     # clean, 6 patterns
```

```powershell
# the word that must not exist anywhere in the module (D94.3)
Select-String -Path src\main\adapters\instructionsCore.ts -Pattern "confidence" -CaseSensitive:$false
# expect: no matches

# exactly ONE emitter of the contract and ONE home for the mechanism switch
Select-String -Path src -Include *.ts -Recurse -Pattern "renderInstructionsFor|memoryContractLines"
# expect: instructionsCore.ts (definitions), instructionsCore.test.ts, ipc.ts (ONE call). NOT a second switch.

# no deletion verb in any Cypher this task adds
Select-String -Path src\main\adapters\instructionsCore.ts,src\main\services\memoryService.ts -Pattern "DETACH|\bDELETE\b|\bREMOVE\b"
# expect: no matches in the new constants

# the counters that move by a known amount
Select-String -Path src\shared\ipc.test.ts -Pattern "toHaveLength\("     # 108 -> 109, twice
Select-String -Path src\main\services\graphSchemaCore.ts -Pattern "version: [0-9]"   # 1 and 2 only

# the entry that must NOT move — diff it, do not assume (6b-4's vehicle rides on it)
git diff src\main\adapters\claude.ts
# `-o NUL` is at claude.ts:222-:224 and 6b-1 did not touch this file. It must still be there.
```

**⚠ `git diff --stat` must show no adapter file beyond `instructionsCore.ts`, and no user file.**
No `CLAUDE.md`, no `AGENTS.md`, no `~/.codex/config.toml` (D49).

---

## The runtime drive — the part that decides the task

**Do not report this task done on a green suite.** `ImplementationSpec-6b-2.md` §9.1–§9.8 is the
drive; the corrections above give you the drive-safe parameter values. The short form:

1. **§9.1** — launch a claude pane on the Chorus project. `MATCH (s:AgentSession) RETURN s.id,
   s.chorusProjectId, s.agent, s.model, s.startedAt, s.writtenVia` → **one row**, `writtenVia = 'app'`,
   `model` null for a subscription launch (correct, not a bug). **Cross-check `s.id` against the
   SQLite `sessions` row — do not eyeball a UUID.**
2. **§9.2** — read `%APPDATA%\chorus\agent-instructions\<sessionId>.md`: project id, `pj:<id>`,
   session id, three tool names, all four templates. Confirm `--append-system-prompt-file` is on the
   live command line via `Get-CimInstance Win32_Process`.
   **⚠ Filter that query by `Name` + `CreationDate`, never by a `CommandLine` substring** — a
   `CommandLine`-substring filter matches the PowerShell process running the filter.
3. **§9.3** — drive one WRITE with parameters, **citing `package.json`** (Correction 10). Expect
   `{id, produced: 1, supportedBy: 1}`. Then `memory:validate` must read **`1 of 1`**.
   **⚠ THE VALIDATOR'S SOURCED COUNT IS THE EVIDENCE, NOT 6b-1's WRITE COUNTER.** A write counter
   says only *a write-tool call completed*; a call whose `MATCH` found nothing completes too. Record
   both, and read them for what each one is. **Then re-run the fulltext READ template now that a real
   `:Memory` finally exists** — §0.3 only proved it parses, against an index with nothing in it.
4. **§9.4** — `docker stop chorus-g2-neo4j`, launch again, and confirm **four** things: contract
   absent from argv **and** no instruction file written; the launch still works; the Memory section
   says the graph was unreachable and the contract was withheld; **`.mcp.json` was still
   merge-written**. Then grep the `[memory]` warn for `bolt://`, `7688` and any path — **there must be
   none.**
5. **§9.5** — `docker start chorus-g2-neo4j`. **The drive must leave it running.**
6. **§9.6** — point a throwaway project at `bolt://192.0.2.1:7687` (TEST-NET-1, guaranteed
   unroutable — **not** a closed local port, which returns in <1 ms and proves nothing) and time the
   launch. Expect **≤ ~5.5 s** added. **A longer number is a finding to record, not a constant to
   tune.**
7. **§9.7** — measure the codex `developer_instructions` token against **32 767** and record it.
   Estimate is ≈4 921 for the token, ≈6 078 with the jade rule (≈19 %). Confirm **exactly one**
   `-c developer_instructions=` token and that the **jade block still renders in codex's first
   reply** — that is how you know the composition did not eat the formatting rule.
8. **§9.8** — re-run `SHOW INDEXES` and `MATCH (m:Memory) WHERE m.chorusProjectId IS NULL RETURN
   count(m)`. **At authoring time: the foreign `search` FULLTEXT is STILL PRESENT, and the one
   `:Memory` node lacks `chorusProjectId` (so `unscoped` = 1).** Record whether that is still true.
   **⚠ THIS STEP CHANGES NOTHING** — no `DROP INDEX`, no relabel, no delete. D173 asked for an
   observation and its owner is a question for Matthew, not a cleanup for this drive.

**Evidence under `_verify/6b-2/` (the directory does not exist yet — create it). Capture exact
outputs. Do not claim success on a failure** — a withheld contract that was supposed to be present is
the single most valuable thing this drive can find.

**⚠ TWO HOUSE RULES FOR DRIVING THE DEV APP.** Kill the dev instance **by command line** (`*9222*`),
never by process name — the installed Chorus is a separate, real instance on `%APPDATA%\chorus-app`
and blanket-killing Electron takes it down. And the dev DB (`%APPDATA%\chorus`) already has the one
`project_memory` row you need (project `a43b395d…` → `bolt://127.0.0.1:7688`, mode `existing`), so a
plain `npm run dev` will work for this drive without seeding.

---

## Reporting

Your report must state, plainly and with the output beside each claim:

- **Gate 0** — what `git status --porcelain` showed at pickup, and that you touched none of it.
- **Gate 2** — every counter re-taken, and **what moved from this document's table**. If a number
  differs from mine, yours is right and say so.
- **Gate 3** — **the F92 re-measurement on 2.1.237**, verbatim, and whether contract line 2's second
  clause survived it. And the §0.7 rollback probe's four results plus the node count before and
  after (it must be 710 → 710).
- **The drive** — all eight steps, each marked done or not done. The validator's `N of N`, the WRITE
  tool's own `produced` / `supportedBy`, the codex token length against 32 767, and the blackhole
  timing.
- **Correction 11** — what you did about `D174`, whichever way it went.
- **The known limit, recorded rather than discovered** (spec §9 closing): `withSession` disposes the
  process-wide cached driver on any failure (`neo4jClient.ts:236`). Pre-existing, but this task makes
  it reachable from **every launch**, so a launch against a down graph now drops a driver a
  concurrent `memory:index` may be holding. It re-acquires on the next call — the cost is one failed
  operation, not a broken app — but 6b-3 builds a background index on this path and should not
  rediscover it.
- **Anything that failed for any reason, including an environmental one** (Docker Desktop down, ABI
  mismatch, locked DB, missing CLI), with its output. **The failure-honesty clause applies: a step
  that did not run is not a step that passed.**

**Do not commit.** Matthew decides when this lands.
