# Task 6b-1 — Measure

_Phase 6b, task 1 of 4. Authored 2026-08-19 against `a3ba6f9`; **amended 2026-08-19 after CR-6b.0
(D173)** — the exploration set, the INCONCLUSIVE rule, the **five** v21 columns, the aggregate's label
and the no-retention test all changed. **Every `file:line` citation below is still the one verified at
`a3ba6f9` and none of them moved**; the amendment changed rulings, not the code it points at._

## Source Of Truth

| Document | Owns |
|---|---|
| `roadmap.md` §6 — **D168**, **as amended by D173** | The ruling this task executes, word for word. Read it twice; every judgement below is downstream of it — **and read the row's "⚠ AMENDED BY D173" clause before its body, because six of its clauses were superseded on the same day they were written** |
| `roadmap.md` §6 — **D173** (CR-6b.0) · [`../CouncilBriefs/CouncilBrief-6b.0-AdoptionDrafts-Findings.md`](../CouncilBriefs/CouncilBrief-6b.0-AdoptionDrafts-Findings.md) §Q1–Q3 | The council verdict that **discharged D168's [CR]** and rewrote parts of it. **Q1** = the no-retention test's error/exception paths and the listener header's wording · **Q2** = the aggregate's Claude-Code label, the lower-bound disclosure, the set-once flag · **Q3** = `Bash` out of the pass/fail set, the shell diagnostic, INCONCLUSIVE |
| `roadmap.md` §6 — D130, D83, D55, D76, D147(e), G6 | The read-surface limit being widened, the untrusted-input rule, the denominator rule, the omit-rather-than-stub rule, the every-line-is-paid-for rule, the migration-number rule |
| [`Phase-6b-Overview.md`](Phase-6b-Overview.md) | The verified ground facts and the phase milestone — **use its table, never a number recalled from a decision row** |
| [`../ImplementationSpecs/ImplementationSpec-6b-1.md`](../ImplementationSpecs/ImplementationSpec-6b-1.md) | Exact insertion points, code shapes, the amended header text, the SQL, the UI strings, the runtime checks |
| `src/main/services/contextUsage.ts:12`–`:50` | **The precedent for how a documented read-surface widening is written.** The new posture in `agentEvents.ts` is authored in that shape: what is taken, what is never taken, where it is stored, what can leak, why it is acceptable |

## Initial Starting Point — verified 2026-08-19 at `a3ba6f9`; amended 2026-08-19 after CR-6b.0 (D173)

Every line number below was opened and checked in this authoring session, and **none of them moved in
the D173 amendment** — the rows the amendment added carry their own evidence path instead of a
`file:line`.

| Fact | Where | Value |
|---|---|---|
| The listener's read surface | `agentEventsCore.ts:219` `readHookEventName` · `:248` `readTranscriptPath` | **two fields, and the docblock at `:204`–`:218` says so in writing.** `:209` already carries one correction of this claim; this task writes the second |
| The header's security note | `agentEvents.ts:53`–`:66` (point 5) | *"**Two fields are read** … `hook_event_name` … and `transcript_path` … no tool input is extracted, stored or logged."* **This sentence becomes false the moment `readToolName` lands** |
| The named limit | `agentEvents.ts:68`–`:75` | same-user code execution is an **excluded threat class**, recorded rather than papered over. D168's *"what can leak"* answer rests on it |
| `WORKING_EVENTS` | `agentEventsCore.ts:57` | includes `'PostToolUse'` at `:65` and `'PostToolUseFailure'` at `:66` — **so `PostToolUse` is already subscribed and NO adapter change is needed** |
| **⚠ `PostToolUse` MEANS THE CALL SUCCEEDED — MEASURED, NOT ASSUMED (D173)** | `_verify/6b-4/hookprobe/ptf.log` + `_verify/6b-4/hookprobe/ptu.log`, 2026-08-19, claude **2.1.235** | a `chorus-memory` call carrying a **deliberately broken Cypher** fired **`PostToolUseFailure`** — body keys `cwd`, `duration_ms`, `error`, `hook_event_name`, `is_interrupt`, `permission_mode`, `prompt_id`, `session_id`, `tool_input`, `tool_name`, `tool_use_id`, `transcript_path` — while the **well-formed** call fired **`PostToolUse`**. **A `PostToolUse` count is therefore a SUCCESSFUL-tool-result count.** This settled by measurement the one [UNVERIFIED] item CR-6b.0 ranked first; `PostToolUseFailure` is still **not counted** |
| The edge filter | `agentEvents.ts:198` | `if (prev?.activity === next && prev.reason === reason) return` — F55/F56's collapse point. Twenty tool calls, one callback |
| The non-edge precedent | `agentEvents.ts:162`–`:164` `onTranscriptPath`; fired from `handle()` at `:276`–`:287`, **before** `readHookEventName` at `:289` and **before** `record()` at `:297` | the exact shape D168 asks for |
| The per-session map | `agentEvents.ts:173` `const activity = new Map<…>()` · cleared at `:342` in `revoke` · `:385` in `dispose` | where the new map goes and what clears it |
| `handle()` | `agentEvents.ts:229`; answers 200 at `:260`–`:261` **before** parsing at `:265` | ⚠ the response is sent before any derivation. Nothing added here may change that |
| `MIGRATIONS` | `storage.ts:174` (`const MIGRATIONS: string[] = [`), array closes at `:944`; last entry is **v20** (`day_reports`, `:936`–`:943`); v19 is `ALTER TABLE sessions ADD COLUMN agent_session_id TEXT;` at `:907` | **20 elements, AST-parsed this session → next free is v21** |
| The migration runner | `storage.ts:3387` `migrate()`; `MAX(version)` read at `:3392`; loop `:3396`–`:3404`; DDL and the `schema_migrations` INSERT run **in one transaction** at `:3397`–`:3402` | so a v21 row cannot exist without v21's columns, and vice versa |
| `schema_migrations` | `schema.ts:58`–`:61` (`version`, `applied_at`) | already a Drizzle table — **the aggregate's floor comes from here, no new column** |
| `sessions` | `schema.ts:68`–`:130`; `SessionRow` at `:159` | **14 columns, AST-counted** (`id`, `projectId`, `agent`, `cwd`, `status`, `exitCode`, `title`, `name`, `description`, `worktreeId`, `createdAt`, `launchProfileId`, `lockedAt`, `agentSessionId`) — this row said 13 before the D173 amendment and the count was wrong; `agentSessionId` at `:129` is the newest. **The five new ones (D173) join it** |
| `createSession` normalisation | `storage.ts:1618`–`:1648` | every nullable column is normalised in the returned row (`:1646` is v19's). **All five new columns are `NOT NULL DEFAULT 0`, so they need the same treatment for a different reason** — see Step 4 |
| Session accessors to copy | `storage.ts:1725` `setAgentSessionId` · `:1747` `getAgentSessionId` · `:1650` `getSessionsForProject` | the shape the new accessors take |
| `sessions.created_at` | written `new Date().toISOString()` — `ipc.ts:1547` (and `:1621`, `:1652`) | ISO-8601 UTC, **lexicographically comparable with `schema_migrations.applied_at`** (`storage.ts:3401`, same call) |
| `IpcChannel` | `shared/ipc.ts:14`; `SessionActivity` `:43`, `SessionContext` `:57`, `SessionContextList` `:60` | **107 keys, AST-counted this session.** Both assertions: `shared/ipc.test.ts:3510` and `:3897` |
| The broadcast precedent | `shared/ipc.ts:2217` `sessionContextUsageSchema` · `:2229` `sessionContextEventSchema` · main-side `ipc.ts:4643`–`:4648` | plain object, Zod-parsed **in main**, fanned out to every window |
| `memory:validate` | `shared/ipc.ts:3246` `memoryValidateResponseSchema` (a **union**) · handler `main/ipc.ts:4105`–`:4125` | `with_source` + `total` + `text` travel together (D55); `text` is built by the pure core, never in a template |
| The wording's home | `shared/provenance.ts:31` `completeness` · `:44` `affectedLabel` · `:58` `PROVENANCE_DISCLAIMER`; re-exported by `provenanceCore.ts:242`; tested in `provenanceCore.test.ts:287`–`:315` | **shared/, because the renderer may not import main-process code**, and because this repo has **no `.vue` tests at all** |
| The Memory section | `ProjectSettingsView.vue:1117`–`:1157` (`Where memories came from`); the ratio at `:1131`–`:1133`; `memoryValidation` at `:357`; `validateMemory()` at `:520` | where the aggregate line lands |
| The renderer store | `stores/memory.ts:117` `MemoryValidation` · `:365` `validate()` (note the `!res.ok` early return at `:370`) | where the aggregate is recorded |
| The per-session surface | `FilmstripRenderer.vue:266` `contextFor` · `:384` the `ContextRing` in `.card-foot` · `stores/session.ts:77` `context` state · `:118` dropped on exit · `:142` `contextChanged` | where the live counter lands, and the "absent, not zeroed" rule it copies |
| Bridge + wiring | `preload/index.ts:642` `onSessionContext` · `:773` `ChorusApi = typeof chorusApi` · `App.vue:227` subscribe · `:261` unsubscribe · `main/ipc.ts:568` `registerIpc(sessions, storage, …, agentEvents)` | `storage` **and** `agentEvents` are both already in `registerIpc`'s scope |
| `CHORUS_MEMORY_SERVER` | `memoryService.ts:200` = `'chorus-memory'`; already imported by a pure core (`instructionsCore.ts`) and by `instructionsCore.test.ts` | **the prefix is derived from it, never re-typed** (the 6a-1 rule) |
| Baseline | — | typecheck **0** (node + web) · vitest **2618 / 2618 across 74 files** · `grep:secrets` clean (6 patterns) · `sqliteTable(` **19** · runtime deps **9** |

### ⚠ Five facts that will cost a session if they are not believed

1. **`ToolSearch` IS NOT AN EXPLORATION TOOL, AND GETTING THIS WRONG SILENTLY BREAKS THE MILESTONE.**
   F92 measured claude 2.1.235 deferring MCP tools: the `PreToolUse` stream was **`ToolSearch` first,
   then `mcp__chorus-memory__read_neo4j_cypher`**. If `ToolSearch` counted as exploration, the first
   exploration ordinal would *always* precede the first memory read, `memory_read_first` would be `0`
   on every session forever, and the phase's binary milestone could never pass — while every test
   still went green. It is excluded **by measurement**, not by taste. `WebFetch` is excluded too: it
   is network, not filesystem.

   **⚠ AND `Bash` IS NOW EXCLUDED AS WELL — D173 (Q3) REVERSED THIS TASK'S FIRST DRAFT.** The
   pass/fail exploration set is **`Read`, `Glob`, `Grep`, `LS`, and the installed CLI's delegation
   tool (`Agent`, or whatever the installed claude calls it — verified at execution and the measured
   names recorded)**. `Bash` moves out of pass/fail entirely and becomes a **separate
   shell-before-first-read diagnostic** (fact 5's sibling, Step 2). The reason is this task's own
   limit turned against it: **without `tool_input` — which this task will never read — `npm test` and
   `ls` are the same event**. Counting every shell call as exploration would depress the number, and
   because **this metric gates 6b-4's escalation**, over-inclusion would trigger an escalation
   nobody's behaviour warranted. `Write`, `Edit` and every other mutation tool stay out too: D173
   refused to broaden the milestone from *filesystem exploration* to *repository interaction*.
2. **THE COUNT MUST BE TAKEN BEFORE `record()` (`agentEvents.ts:198`).** F55/F56 are in the roadmap
   because a count taken after `if (prev?.activity === next …) return` collapses twenty tool calls
   into one. `onTranscriptPath` (`:162`–`:164`, fired at `:276`) is the shape to copy; it is fired
   from `handle()`'s `end` callback and is not gated by anything.
3. **v21 IS NOT A NUMBER YOU MAY QUOTE FROM THIS DOCUMENT.** `MIGRATIONS.length` parsed to **20** on
   `a3ba6f9`, and both the installed and the dev DB sat at `MAX(version) = 20` at kickoff — but dev
   worktrees share one database (`storage.ts:775`–`:788` records the v16 collision that cost a boot),
   so a sibling branch can claim 21 where you cannot see it. **G6 is re-run at the moment of writing**
   (Verification Commands below). If it does not come back 20, **stop and report** rather than
   renumbering silently.
4. **`PostToolUseFailure` IS A SEPARATE EVENT NAME, NOT A FLAG ON `PostToolUse`** (`agentEventsCore.ts:66`).
   A `startsWith('PostToolUse')` test would count failures as reads. Compare with `===`.

   **⚠ AND BECAUSE OF THAT SPLIT, MEASURED ON 2026-08-19, A `PostToolUse` COUNT IS A
   *SUCCESSFUL-TOOL-RESULT* COUNT** (`_verify/6b-4/hookprobe/ptf.log` + `ptu.log`, claude 2.1.235: a
   broken Cypher fired `PostToolUseFailure` with an `error` key; the well-formed call fired
   `PostToolUse`). **So the metric is labelled "successful memory reads" and "memory writes
   (tool-level)", never "memory tool calls"** — and the write-side label carries its limit wherever it
   appears: **the validator is the write-side truth**, because a successful `write_neo4j_cypher` is
   still not a *sourced* memory (Cypher's `MATCH … CREATE` creates nothing when the match is empty and
   the tool reports success anyway — D173 Q5, and 6b-2's problem, not this task's).
5. **AN UNKNOWN TOOL BEFORE THE FIRST MEMORY READ MAKES THE SESSION *INCONCLUSIVE*, NOT A PASS**
   (D173 Q3). A completed call to a tool that is **not** a `chorus-memory` tool, **not** in the
   exploration set, **not** `ToolSearch` and **not** in the known-but-not-exploration set, arriving
   before the first memory read, sets a second set-once flag and the session's ordering result stops
   being pass/fail. Precisely:

   - **pass** — a *completed* memory read exists **AND** it precedes the first **known** exploration
     call (or no known exploration call occurred) **AND** no **unknown** tool preceded it;
   - **inconclusive** — a *completed* memory read exists, nothing in the known exploration set
     preceded it, **but an unknown tool did**;
   - **otherwise not passed.**

   The two flags are mutually exclusive by construction, and an inconclusive session is **not** a
   failure either — it is the instrument saying it does not know. **Why:** vendor tool names drift
   (`Agent` was `Task` within living memory, and D173 made installed-CLI verification load-bearing for
   that reason), and a name this build has never heard of is exactly the case where guessing is worst.
   Guessing "not exploration" would **fail open in the agent's favour** — a renamed `Read` would
   become a free pass on the phase's headline number. Inconclusive fails toward *"we cannot say"*,
   which is the only direction a milestone may fail in.

   ⚠ **This is a narrowing of the existing rule, not a repair of a hole in it.** The council's
   "vacuous pass" objection was aimed at the **brief's one-line summary**; this spec already required
   a *completed* read — `ImplementationSpec-6b-1.md` §3 `toUsage`, `rec.firstReadOrdinal !== null && …`
   — and that clause is cited unchanged. Do not "fix" it twice.

## Goal

Give this phase an **instrument**. Today nothing in Chorus can answer *"did this agent read the
memory graph, and did it read it before it started exploring the filesystem?"* except by a human
opening a JSONL transcript and counting — which is exactly what the milestone forbids. When this task
lands, **five** numbers exist per session (`memory_reads`, `memory_writes`, `memory_read_first`,
`memory_read_inconclusive`, `memory_shell_first` — D173), they survive the session, they roll up per
project **with their denominator, and that denominator says `Claude Code` out loud** (D173 Q2: the
instrument is a Claude hook bus and **codex has none**, so an unqualified "K sessions" would claim
all-agent coverage this cannot provide), and a live counter appears on the pane beside the context
ring while an agent is using the graph. **6b-2, 6b-3 and 6b-4 are all judged by these numbers; none
of them can be evaluated without this task.**

The instrument is built by widening the hook listener's read surface **by exactly one field, and the
module's own security claim is rewritten in the same edit** — a stale guarantee is worse than none,
which is the argument `contextUsage.ts:25`–`:29` already makes about the last widening.

## Exact Scope

**Create**

- **Nothing.** Every change is an edit to a file that exists. If you find yourself adding a file,
  stop — the design does not call for one, and the wording's home is `shared/provenance.ts`.

**Edit**

- `src/main/services/agentEventsCore.ts` — `readToolName`, `classifyMemoryTool`,
  `isExplorationTool`, **`isShellTool`** and **`isKnownTool`** (D173), their constant sets, and the
  amended `readHookEventName` docblock.
- `src/main/services/agentEventsCore.test.ts` — the reader, **all four** classifiers, the hostile body.
- `src/main/services/agentEvents.ts` — the amended module header (point 5 and the ⚠ under it), the
  per-session usage map, `onMemoryUsage`, the counting block in `handle()`, `memoryUsageFor`,
  clearing in `revoke` and `dispose`.
- `src/main/services/agentEvents.test.ts` — counting survives the edge filter; `PreToolUse` and
  `PostToolUseFailure` do not count; the inconclusive and shell-first flags; revoke clears; **no tool
  name reaches a listener or a log — on the success path, the ERROR path and the EXCEPTION path**
  (D173 Q1).
- `src/main/db/schema.ts` — **five** columns on `sessions` (D173).
- `src/main/db/schema.test.ts` — the v21 drift guard, in the shape `:36`–`:70` already uses.
- `src/main/services/storage.ts` — the **v21** migration entry, `createSession` normalisation, the
  write accessor, the per-project aggregate read.
  **⚠ There is NO `storage.test.ts` and this task does not create one** — `storage.ts` imports
  better-sqlite3, whose binding is built for the Electron ABI while Vitest runs under Node, so the
  import throws before an assertion runs (`schema.test.ts:17`–`:22` states this and is why it reads
  `storage.ts` as TEXT). The aggregate's denominator is pinned in `schema.test.ts` as a source-text
  assertion and proved behaviourally in the runtime drive.
- `src/shared/ipc.ts` — `sessionMemoryUsageSchema`, `sessionMemoryEventSchema`, **one** new
  `IpcChannel` key, and `usage` on **both** branches of `memoryValidateResponseSchema`.
- `src/shared/ipc.test.ts` — `toHaveLength(107)` → **`108`** at **`:3510` and `:3897`**; the new
  schemas' cases.
- `src/shared/provenance.ts` — `memoryUsageLine`, `sessionMemoryLine` (the D55 sentences),
  `memoryBreakdownLine` (D173's diagnostics plus the read-first roll-up) and the lower-bound
  disclosure constant.
- `src/main/services/provenanceCore.ts` — the re-export at `:242` gains **all four** names.
- `src/main/services/provenanceCore.test.ts` — the wording cases.
- `src/main/ipc.ts` — the `onMemoryUsage` fan-out + persistence; `usage` on the `MemoryValidate`
  response.
- `src/preload/index.ts` — `onSessionMemory`, beside `onSessionContext` at `:642`.
- `src/renderer/src/App.vue` — subscribe and unsubscribe, beside `offContext`.
- `src/renderer/src/stores/session.ts` — `memoryUsage` map, `memoryUsageChanged`, dropped on exit.
- `src/renderer/src/components/FilmstripRenderer.vue` — the live counter in `.card-foot`.
- `src/renderer/src/stores/memory.ts` — `usageByProject`, recorded **before** the `!res.ok` return.
- `src/renderer/src/views/ProjectSettingsView.vue` — the aggregate line beside the ratio.

**Nothing else.**

## Non-Goals

- **⚠ NO `tool_input`, NO `tool_response`, NO `prompt`, NO `last_assistant_message`, NO
  `tool_use_id` — EVER.** `tool_input` is the Cypher an agent wrote and `tool_response` is graph
  content; both are user/agent content and neither is read, in this task or any later one. This is
  the whole limit D168 draws, and the reader that would break it is one line long.
- **No per-tool-name histogram, no "top tools", no Neo4j query log.** The name is compared against
  the fixed sets and **dropped in the same expression** — including on the error and exception paths,
  where a raw body in a debug log would undo the whole posture (D173 Q1). A histogram would require
  keeping names, which is the surface this task exists to keep closed. **And the `INCONCLUSIVE` flag
  is a boolean, not a record of *which* unknown tool it was** — the flag is the whole permitted
  output of that comparison.
- **No change to `instructionsCore.ts`, to the contract text, or to `claude.ts`.** The hook command
  at `claude.ts:200` — including its `-o NUL` (`:215` says why) — is **untouched**; `PostToolUse` is
  already in the subscription list (`agentEventsCore.ts:65`), so nothing about the settings file
  changes. That is 6b-2's and 6b-4's territory.
- **No nudge route** (6b-4), **no `:AgentSession` MERGE** (6b-2), **no `docker start`, no index
  refresh** (6b-3). No Cypher of any kind is written in this task.
- **No new renderer route and no new view.** The aggregate goes in the existing Memory section; the
  live counter goes in the existing `.card-foot`.
- **No second IPC channel for a cold read.** `session:context` has one (`shared/ipc.ts:60`) and the
  reasoning is quoted in its docblock — but a context ring lost on reload is a *missing measurement*,
  while a memory counter lost on reload is a *hint whose durable answer is already on the sessions
  row and in the Memory section's aggregate*. `IpcChannel` moves **107 → 108**, not 109. If a
  reviewer disagrees, that is a decision to take deliberately, not a line to slip in.
- **No new npm dependency.** Runtime deps stay **9**.
- **No graph migration and no second SQLite migration.** `LATEST_GRAPH_VERSION` stays **2**;
  `MIGRATIONS.length` becomes **21** and stops. `sqliteTable(` stays **19** (columns, not a table).
- **Do not revert, stage, commit or delete unrelated working-tree changes.** `roadmap.md` is modified
  at kickoff (D168–D172, F92–F93, the Phase 6b section). Report anything else you find; absorb
  nothing. **Do not commit.**

## Dependencies

**None in code — this is the first task of the phase and nothing in 6b has landed yet.**

**The one gate was not technical, and it is DISCHARGED.**

> ### ✅ THE D168 RATIFICATION GATE IS DISCHARGED — THE TASK MAY START
>
> D168's status cell now reads *"SETTLED 2026-08-19 (Phase 6b kickoff); **RATIFIED through CR-6b.0 the
> same day (D173)**; 6b-1 owns it"*. The kickoff offered two valid discharges — a word from Matthew,
> or a council verdict on the questions below — and **Matthew chose the council**: CR-6b.0 ran on
> 2026-08-19 (4 members + arbiter; Q1 QUALIFY), its findings are recorded as **D173**, and its
> qualifications are folded into this document and its spec. **No further approval is needed before
> writing code.** What the council changed is not optional, though: read D168's "⚠ AMENDED BY D173"
> clause, then facts 1, 4 and 5 above, before the first edit.

**The four questions the council answered** (kept as history — they are the record of what was asked
and are quoted verbatim from the kickoff, so a reader can compare the question to D173's answer; the
answers, not these, are what the implementer builds):

1. Is reading the **name** of every tool call — not only memory ones — acceptable, given that the
   only things stored are three counters and two ordinals per session, and that no name is logged,
   broadcast or persisted anywhere?
   → **D173 Q1 QUALIFY: yes, proceed** — with the no-retention test extended to the error and
   exception paths, the header wording narrowed, and the metric renamed to say *successful*.
2. Is a **fixed set of claude's built-in exploration tools** (`Read`, `Glob`, `Grep`, `Bash`,
   `Agent`, `LS`, D4-verified at execution; `ToolSearch` and `WebFetch` deliberately excluded) the
   right operational definition of *"a graph read before filesystem exploration"*?
   → **D173 Q3 QUALIFY: the shape yes, the membership no.** `Bash` is **removed** to a separate
   diagnostic and an unknown tool makes the result **inconclusive** — fact 1 and fact 5 above are the
   ruling; **this question's list is history and must not be implemented.**
3. Should the counters **persist** (three `sessions` columns, migration v21) so the Memory section
   can say *"R reads · W writes across K sessions since <date>"* (D55), or stay in-memory for the
   life of a live session only?
   → **D173 Q2 QUALIFY: persist — but FIVE columns, not three**, and the label must name **Claude
   Code** and disclose the post-restart lower bound. Step 7 and the spec's §4/§5/§7 are the ruling.
4. What does a **same-user attacker** gain? — the kickoff's answer is *nothing beyond D130's
   already-named limit*: the body is still authenticated by the per-session capability token, so a
   hostile process can at most inflate **its own session's** counters, and no file is opened (the
   `transcript_path` widening does open one, and was accepted).
   → **D173 Q1: accepted as a bounded [UNVERIFIED] integrity risk, not a confidentiality expansion**
   — the counters are not to be described as adversarially tamper-proof.

## Step-by-step Work

1. **Run §0 of the spec before writing a line.** `claude --version`; re-take the `PostToolUse` body
   shape with the `--settings` hook experiment (the exact JSON is in the spec, **forward slashes** —
   backslashes in a JSON string are escapes and the first attempt at kickoff silently loaded no hooks
   at all); **re-verify v21 is free** (G6, three ways); dump the `sessions` DDL. **Record the tool
   names you actually observe, and write the list into the report** — D173 made installed-CLI
   verification load-bearing, not advisory: the exploration set, the delegation tool's *current* name,
   and the known-but-not-exploration set are all **measured at execution**, never quoted from here.
   A name this build has not heard of does not fail the session; it makes it **inconclusive** (fact 5),
   which is why the measured list is the difference between a usable metric and a column of `1`s.
2. **`agentEventsCore.ts`: the reader and the classifiers.** `readToolName` mirrors
   `readHookEventName` (`:219`) exactly — object check, `typeof === 'string'`, non-empty, `≤ 128` —
   and nothing else, because the value is compared against fixed sets and dropped; a charset check
   would be theatre on a string that can only ever match or not match. `classifyMemoryTool` returns
   `'read' | 'write' | null`, keyed on a prefix **derived from `CHORUS_MEMORY_SERVER`**
   (`memoryService.ts:200`), never re-typed. `isExplorationTool` is a fixed-set membership test over
   the **D173 set** — `Read`, `Glob`, `Grep`, `LS`, delegation tool — and **`Bash` is not in it**.
   Two more, both fixed-set membership tests, both new in the amendment:
   - **`isShellTool`** — a set (not a bare `=== 'Bash'`), so an alias or a rename lands in one place.
     Its only consumer is the **diagnostic** flag; it must never be reachable from the pass/fail
     branch, and a reviewer should be able to prove that by grep.
   - **`isKnownTool`** — memory prefix **or** exploration **or** shell **or** `ToolSearch` **or** the
     known-but-not-exploration built-ins measured in §0 (`WebFetch`, `Write`, `Edit`, and whatever
     else the probe printed). Everything else is **unknown**, and an unknown before the first read is
     fact 5's INCONCLUSIVE. ⚠ **Seed this set from §0's measured output, and say in the report what
     seeded it** — an over-narrow known set costs inconclusive sessions (recoverable, honest), while
     an over-broad one costs a silent pass (not recoverable, and the thing D173 removed).

   **All of them are pure and none of them retains, logs or returns the name for any purpose other
   than the classification.**
3. **`agentEventsCore.ts`: amend `readHookEventName`'s docblock (`:204`–`:218`).** `:209` already
   corrects one stale claim; add the second correction in the same voice. The sentence at `:214`–`:217`
   — *"Everything else in the payload … is still deliberately NOT extracted"* — **must be narrowed
   to name `tool_name` as the exception and to say the name is compared and dropped**, because
   "tool inputs" is listed there today and a reader would conclude the tool call is untouched.
4. **`agentEvents.ts`: the per-session record and the listener.** A second `Map` beside `activity`
   (`:173`) holding `{ reads, writes, firstReadOrdinal, firstExploreOrdinal, firstUnknownOrdinal,
   firstShellOrdinal, ordinal }` — **four ordinals now, not two** (D173: the unknown-tool ordinal
   decides INCONCLUSIVE, the shell ordinal feeds the diagnostic, and both are set-once for the same
   reason the first two are); a
   `MemoryUsageListener` set beside `transcriptListeners` (`:175`); `onMemoryUsage` beside
   `onTranscriptPath` (`:377`); `memoryUsageFor(sessionId)` beside `recordFor` (`:349`); cleared in
   `revoke` (`:342`) and `dispose` (`:385`) exactly where `activity` is.
5. **`agentEvents.ts`: the counting block in `handle()`.** It goes **after** the transcript-path
   block (`:287`) and **before** `readHookEventName` (`:289`) — i.e. before the classification gate
   and long before `record()` (`:297`). It reads the event name for the `PostToolUse` comparison via
   `readHookEventName`, which means the name is read once and used twice; **that is fine and it is
   the reason the block sits where it does.** ⚠ **The counter is incremented unconditionally on every
   `PostToolUse` receipt. Only the *notification* is suppressed when the broadcast payload is
   unchanged** — see the spec's §3; conflating the two is the exact D168 failure.
6. **`agentEvents.ts`: amend the module header (`:53`–`:66`).** Point 5 becomes **three** fields with
   `tool_name` named, and the ⚠ under it gets a second paragraph in `contextUsage.ts`'s shape: what is
   taken, what is never taken, where it is stored, what can leak, why it is acceptable. **The listener
   header's sentence is D173 Q1's wording: *"every completed tool-call name is classified and
   discarded"*** — not "memory tool names are read", which is the narrower claim the council called
   misleading. **Do not delete the v16 correction** — the recurrence is the finding, exactly as
   `ipc.test.ts:3885` keeps its own history.
7. **`schema.ts` + v21 — FIVE columns (D173).** `memory_reads`, `memory_writes`, `memory_read_first`,
   `memory_read_inconclusive`, `memory_shell_first`, all `INTEGER NOT NULL DEFAULT 0`, in **one**
   migration entry, with an authored comment saying **why a default of 0 is honest here and was
   refused for `locked_at`** (`storage.ts:790`–`:796`): a session that made no memory calls really did
   make zero, so 0 is the truth rather than a sentinel — the opposite of "the time this was locked",
   which does not exist for an unlocked session. `createSession` (`:1618`) normalises **all five**,
   for the sibling reason `:1646` gives.
8. **Storage accessors.** One write, one read. The write takes the absolute snapshot of **all five**
   values and is **monotonic** (`MAX(column, ?)`) on every one of them, so it is idempotent, cannot go
   backwards, and needs no delta bookkeeping anywhere. **`MAX()` is what makes the three flags
   set-once at the row level** (D173 Q2): a `1` can never be overwritten by a `0`, whatever a later
   registration believes. It is written **per receipt** — every receipt that moves any of the five;
   a receipt that moves none would write the same numbers, so suppressing it loses nothing and the
   under-count window is one receipt wide. The honest limit is written at the accessor: a session
   **restarted** mid-life re-registers with fresh in-memory counters, so its row keeps the highest
   registration's numbers rather than the sum. **Per-receipt writing NARROWS that window; it does not
   close it**, so the totals are a **lower bound** and the UI says so (D173 Q2). Under-counting never
   over-counts, which is the safe direction for a milestone claim. The read returns
   `{ reads, writes, sessions, since, readFirst, inconclusive, shellFirst }` for one project over a
   set defined **exactly** in the spec's §5.

   **⚠ K IS FILTERED, NOT ONLY LABELLED — `WHERE project_id = ? AND agent = 'claude' AND created_at
   >= ?`.** All three predicates are denominator decisions and dropping any one inflates K with
   sessions the numerator could never have come from. The `agent` predicate is D173 Q2 read at its
   word: *"Codex sessions must not be counted as measured non-use merely because no equivalent hook
   instrument exists."* Every non-claude adapter declares `hooks: null` (`codex.ts:119`,
   `grok.ts:132`, `kimi.ts:118`, `opencode.ts:152` — grok's comment is the sharpest: a
   Claude-*compatible* hook bus with no `--settings` flag to load one into), so those rows can only
   ever read 0 for a reason that has nothing to do with the agent's behaviour. **The filter and the
   label are one change, never two:** `agent = 'claude'` in the SQL, "K **Claude Code** sessions" in
   the sentence. **And `memory_read_first` IS summed** — the per-row flag answers "did this session
   read first", but only the roll-up answers "is this getting better", which is what 6b-2..4 are
   asking; it renders on the breakdown line against the same K.
9. **IPC.** One event channel; the schema in `shared/ipc.ts`; `parse()` in **main only** (D1 — a
   preload Zod import throws `EvalError` under the page CSP); the payload a **plain object**. Then
   `usage` on **both** branches of `memoryValidateResponseSchema` — both, because the counters are a
   local SQLite read that works when the graph is down, and hiding them behind `ok: true` would make
   a stopped container erase a number that has nothing to do with the container.
10. **Both `toHaveLength(107)` assertions move to `108`** — `ipc.test.ts:3510` **and** `:3897` —
    and each gets a one-line note in the style the surrounding comments already use
    (`:3889`, `:3895`), **re-counted from the merged tree with the AST, never deltaed**.
11. **Wording.** `memoryUsageLine`, `memoryBreakdownLine`, the lower-bound disclosure constant and
    `sessionMemoryLine` in `shared/provenance.ts`, re-exported at
    `provenanceCore.ts:242`, tested in `provenanceCore.test.ts`. **⚠ The aggregate sentence's exact
    shape is D173's and is asserted character for character, `successful` and `Claude Code`
    included** — they read as verbosity to anyone who has not read the finding, and a tidy-up that
    drops either restores a claim the instrument cannot support. **No arithmetic and no string
    assembly in any `.vue` file** — `shared/provenance.ts:6`–`:10` states why: this repo has no `.vue`
    tests at all, so a sentence built in a template is unreachable by the suite.
12. **UI.** The aggregate under the ratio in the `Where memories came from` block
    (`ProjectSettingsView.vue:1117`); the live counter in `.card-foot` beside the ring
    (`FilmstripRenderer.vue:384`), **absent rather than zeroed** when both counters are 0 — the rule
    `stores/session.ts:63`–`:68` already states for the ring. **⚠ The aggregate's shape is fixed by
    D173 Q2 and is not a wording choice:**

    > `R successful memory reads · W memory writes across K Claude Code sessions observed since <date>`

    where `<date>` is **v21's `applied_at` day**, plus a short disclosure that the totals are a
    **lower bound after an app restart**, plus a second line carrying the breakdown — **`P
    read-first · I inconclusive · S shell-first of the same K Claude Code sessions`** — all three
    against that same denominator K. `Claude Code` is not decoration: this instrument is a Claude
    hook bus and **codex has none**, so a bare "K sessions" would silently claim all-agent coverage,
    and the SQL filters `agent = 'claude'` to match. **⚠ The headline line's shape is D173's and is
    not extended**; `read-first` goes on the breakdown line precisely so the finding's wording stays
    intact. **⚠ `P + I` need not equal K** — a session can be neither — so nothing may render
    "failures" as `K - P`. The exact strings are in the spec's §7 and §8.
13. **Run every gate, then the runtime drive and the negative drive.** A compiled feature is not a
    delivered one (roadmap §3, step 4).

## Test Expectations

**`agentEventsCore.test.ts`** — in the shape `:200`–`:229` already uses:

- `readToolName` reads `tool_name` off a well-formed `PostToolUse` body;
- returns `null` for: `null`, a bare string, a number, an array, `{}`, a non-string name, an empty
  name, **and a 129-character name** (the cap is `128`, asserted at the boundary in both directions —
  128 passes, 129 fails);
- `classifyMemoryTool` → `'read'` for `…__read_neo4j_cypher` and `…__get_neo4j_schema`, `'write'` for
  `…__write_neo4j_cypher`, **`null` for an unrecognised name under the same prefix** (a future
  chorus-memory tool is **not counted rather than guessed** — the honesty bar `classifyHookEvent`
  sets at `agentEventsCore.ts:138`), and `null` for a name with the right suffix under a **different**
  server prefix;
- the prefix **equals** `` `mcp__${CHORUS_MEMORY_SERVER}__` `` — asserted against the import, so a
  server rename cannot leave a stale literal here;
- `isExplorationTool` is `true` for exactly `Read`, `Glob`, `Grep`, `LS` and the delegation tool
  (`Agent`, or the name §0 measured), and **`false` for `ToolSearch`** — with the F92 reason in the
  test's own comment, because this is the assertion that stops someone "fixing" the set later — and
  `false` for `WebFetch`, `Write`, `Edit` and an empty string;
- **⚠ `isExplorationTool('Bash')` is `false`, and the D173 reason is in the test's own comment**
  (without `tool_input`, `npm test` and `ls` are the same event, and this metric gates 6b-4's
  escalation). This assertion is the twin of the `ToolSearch` one: it exists to stop a well-meaning
  re-addition, and a reviewer should treat its deletion as a scope change;
- `isShellTool` is `true` for `Bash` and `false` for every exploration name, every memory name and
  `ToolSearch` — **the two sets are disjoint, asserted directly**, so no name can reach both the
  pass/fail branch and the diagnostic;
- `isKnownTool` is `true` for every name in §0's measured list and `false` for a plausible future
  name (`Read2`, `FileRead`, a renamed delegation tool) — the case that produces INCONCLUSIVE;
- **case sensitivity is deliberate**: `read` and `glob` classify as nothing (the
  `classifyHookEvent('stop')` precedent at `:56`);
- a **hostile body** — prototype-shaped keys, a megabyte-long name, `tool_name` on the prototype
  chain — yields `null` and touches nothing.

**`agentEvents.test.ts`** — driven through the real bound port, as `:24`–`:48` already does:

- **the invariant**: twenty consecutive `PostToolUse` bodies naming
  `mcp__chorus-memory__read_neo4j_cypher` produce **`reads === 20`** and **twenty `onMemoryUsage`
  callbacks**, while **`onActivity` fires exactly once** — the F55/F56 collapse, proven not asserted;
- twenty consecutive `PostToolUse` bodies naming `Read` produce `reads === 0`, `writes === 0` and
  **zero `onMemoryUsage` callbacks** (nothing observable changed) while the internal ordinal advances
  to 20 — so a reviewer can see the count is not gated and the *broadcast* is;
- **`PreToolUse` with the memory read name does not count** (an attempt the user denied is not a
  read) and **`PostToolUseFailure` with it does not count** (a failed call read nothing);
- a memory read before any exploration tool → `readBeforeExplore === true`; a `Read` first, then a
  memory read → `false`; a memory read with **no** exploration at all → `true`; **no memory read at
  all → `false`** (the completed-read requirement, already the rule — see fact 5);
- **⚠ THE D173 ORDERING CASES, ALL FIVE, BECAUSE THE THREE OUTCOMES MUST BE PROVEN DISJOINT:**
  - `Bash` then a memory read → `readBeforeExplore === true` **and** `readInconclusive === false`
    **and** `shellFirst === true`. **This is the case D173 changed**, and it is the one that would
    silently revert if someone put `Bash` back;
  - a memory read then `Bash` → `shellFirst === false`;
  - an **unknown** name then a memory read → `readInconclusive === true`, `readBeforeExplore ===
    false`, and the session is **not** counted as a failure either;
  - a memory read then an **unknown** name → `readInconclusive === false`, `readBeforeExplore ===
    true` (the unknown arrived too late to cast doubt on the ordering);
  - `Read` then an unknown then a memory read → `readBeforeExplore === false` and
    `readInconclusive === false` — a **known** exploration call already decided it, so the unknown
    adds no doubt;
- **the three flags are set-once**: after each becomes `true`, a later receipt of any kind leaves it
  `true` (`Bash`, `Read`, unknown, a second memory read, in any order);
- `revoke(sessionId)` clears the usage record as it clears `activity`, and `dispose()` clears the map
  and the listener set;
- **⚠ NO TOOL NAME REACHES ANY OUTPUT — ON THE SUCCESS PATH, THE ERROR PATH AND THE EXCEPTION PATH**
  (D173 Q1). Post bodies whose `tool_name` is a distinctive canary string, with `logger` spied, and
  assert the canary appears in **no** log call, **no** persisted value, **no** `onMemoryUsage` /
  `onActivity` payload and **no** HTTP response body (`JSON.stringify` of every captured argument).
  Cover, each as its own case:
  - a **valid** memory name, an **exploration** name, an **unknown** name — the classification paths;
  - a **malformed body** (the canary present but the body otherwise junk — a bare string, an array,
    `tool_name` on the prototype chain) — the rejection path;
  - an **oversized name** (129+ characters, canary embedded) — the cap's rejection path;
  - **a listener that throws** — the `catch` runs with the receipt in scope, and this is the exact
    place a `logger.error({ err, body })` would dump a raw hook body and undo the entire posture.
    Assert the canary is absent from the error log call too;
- a bad `onMemoryUsage` listener that throws does not stop the others and does not fail the HTTP
  request (the `:212`–`:220` rule).

**`db/schema.test.ts`** — a `describe` in the shape of `:36`–`:70`:

- all **five** Drizzle columns declare the exact DB names `memory_reads`, `memory_writes`,
  `memory_read_first`, `memory_read_inconclusive`, `memory_shell_first`, and each appears in
  `migrationsSource()`;
- each is `notNull` **with** a default (the opposite assertion to `:48`–`:49`, and the comment says
  why the ruling differs);
- each is added by **exactly one** migration (`:64`–`:70`'s guard, **five** times);
- **the drift guard gains a column count on `sessions`**, so a sixth column added later cannot arrive
  unnoticed. ⚠ **Count it from the merged tree** (`Object.keys(getTableColumns(sessions)).length`)
  and pin **that** number, exactly as `ipc.test.ts` pins `IpcChannel`'s — **do not delta the "14
  columns" recorded in this document's fact table** (AST-counted at `a3ba6f9`; the expected pinned
  value after this task is therefore **19**), because a prose count decays and an asserted one does not;
- the v21 entry contains **no** `REFERENCES` and **no** `CREATE INDEX` — every read is by primary key
  or a per-project scan the rail already runs.

**The aggregate's denominator — pinned in `db/schema.test.ts`, NOT in a storage test**

⚠ **`storage.ts` is unreachable from Vitest** (better-sqlite3's binding is Electron-ABI;
`schema.test.ts:17`–`:22` says so and is why that file reads `storage.ts` as text). So the filter is
pinned the way the migrations already are — **as a source-text assertion**, in a `describe` beside
the v21 column cases, slicing `getProjectMemoryUsage`'s body out of `STORAGE_SRC`:

- the sliced `WHERE` contains **all three** predicates — `project_id = ?`, `agent = 'claude'` and
  `created_at >= ?`. **⚠ Assert them individually**, so removing one cannot pass under cover of the
  others, and put the D173 quote in the test's comment: *"Codex sessions must not be counted as
  measured non-use merely because no equivalent hook instrument exists."* Without this assertion,
  deleting `AND agent = 'claude'` is an invisible change that inflates K forever;
- the sliced body contains **no `JOIN`** — the property that keeps `COUNT(*)` a session count;
- it selects all three breakdown sums (`memory_read_first`, `memory_read_inconclusive`,
  `memory_shell_first`) alongside `COUNT(*)`, so the breakdown cannot drift onto a different scan
  from the denominator it is rendered against;
- the floor is read from `schema_migrations` for `MEMORY_COUNTERS_VERSION`, and that constant is the
  literal `21`, **not** `MIGRATIONS.length`.

**The arithmetic itself is proved at runtime, not in a unit test** — see the drive's step (c'), which
is the only place a real SQLite file exists.

**`shared/ipc.test.ts`**

- `Object.keys(IpcChannel)` → **108**, at `:3510` **and** `:3897`;
- `IpcChannel.SessionMemory` is asserted **by name as well as by count** (the `:3513`–`:3515` rule: a
  count alone stays green through a rename);
- `sessionMemoryUsageSchema` rejects a negative count, a fractional count and a missing
  `readBeforeExplore`, **`readInconclusive` or `shellFirst`** (**all three required, not optional** —
  `z.object` strips unknown keys, so an omitted field vanishes silently: the D143(f) argument written
  out at `shared/ipc.ts:2160`–`:2164`; and a silently-stripped `readInconclusive` would restore
  exactly the silent pass D173 removed);
- `memoryUsageSummarySchema` rejects a summary missing `readFirst`, `inconclusive` or `shellFirst`;
- `memoryValidateResponseSchema` accepts `usage` on **both** branches and rejects a response missing
  it on either.

**`provenanceCore.test.ts`** — beside `:287`:

- `memoryUsageLine(12, 3, 4, '2026-08-20T09:15:00.000Z')` → **the exact D173 string**:
  `12 successful memory reads · 3 memory writes across 4 Claude Code sessions observed since
  2026-08-20`. ⚠ **`Claude Code` and `successful` are asserted character for character** — they are
  the two words the council added, and a "tidy-up" that drops either restores the misleading claim;
- the zero case still carries the denominator (`0 successful memory reads · 0 memory writes across
  4 Claude Code sessions observed since …`);
- the **empty-set** case says so instead of rendering `across 0 Claude Code sessions observed since —`;
- singular/plural at 1 (`1 successful memory read · 1 memory write across 1 Claude Code session`);
- `memoryBreakdownLine(0, 0, 0, 4)` returns `null` — nothing to show renders nothing — and
  `memoryBreakdownLine(3, 1, 2, 4)` → `3 read-first · 1 inconclusive · 2 shell-first of the same 4
  Claude Code sessions`, i.e. it carries **the same denominator K as the headline** (D173: a
  breakdown is not allowed to float free of the sessions the headline counted);
- each of the three moves the line on its own (`(1,0,0,…)`, `(0,1,0,…)`, `(0,0,1,…)` all render),
  so no member can be dropped without a red test;
- `sessionMemoryLine(0, 0)` returns **`null`** (the signature is `SessionMemoryText | null` — the
  spec's §7 is the authority) — the caller renders nothing, and the emptiness is the tested contract
  rather than a template's `v-if`.

## Verification Commands

Runnable as written from the repository root (PowerShell).

```powershell
npm run typecheck          # 0 errors, node + web
npx vitest run             # >= 2618 (the kickoff baseline) plus this task's new cases
npm run grep:secrets       # clean, 6 patterns
```

**The counters this task moves, each measured with the TypeScript AST rather than a grep:**

```powershell
# IpcChannel: 107 -> 108
node -e "const ts=require('typescript'),fs=require('fs');const p='src/shared/ipc.ts';const sf=ts.createSourceFile(p,fs.readFileSync(p,'utf8'),ts.ScriptTarget.Latest,true);let i=null;const w=n=>{if(ts.isVariableDeclaration(n)&&n.name.text==='IpcChannel')i=n.initializer;ts.forEachChild(n,w)};w(sf);while(i&&(ts.isAsExpression(i)||ts.isSatisfiesExpression(i)))i=i.expression;console.log('IpcChannel keys =',i.properties.filter(p=>ts.isPropertyAssignment(p)).length)"

# MIGRATIONS: 20 -> 21
node -e "const ts=require('typescript'),fs=require('fs');const p='src/main/services/storage.ts';const sf=ts.createSourceFile(p,fs.readFileSync(p,'utf8'),ts.ScriptTarget.Latest,true);let i=null;const w=n=>{if(ts.isVariableDeclaration(n)&&n.name.text==='MIGRATIONS')i=n.initializer;ts.forEachChild(n,w)};w(sf);console.log('MIGRATIONS.length =',i.elements.length)"

# both assertions moved together
Select-String -Path src/shared/ipc.test.ts -Pattern "toHaveLength\(10[789]\)"
```

**⚠ G6 — run this BEFORE writing the migration, not after** (the full three-way check is in the
spec's §0; this is the one-liner that decides whether v21 is yours):

```powershell
foreach ($r in (git for-each-ref --format='%(refname:short)' refs/heads refs/remotes)) {
  $f = Join-Path $env:TEMP "st-$($r -replace '[\\/]','_').ts"
  git show "${r}:src/main/services/storage.ts" 2>$null | Set-Content -Encoding UTF8 $f
  if (Test-Path $f) {
    $n = node -e "const ts=require('typescript'),fs=require('fs');const p=process.argv[1];const sf=ts.createSourceFile(p,fs.readFileSync(p,'utf8'),ts.ScriptTarget.Latest,true);let i=null;const w=x=>{if(ts.isVariableDeclaration(x)&&x.name.text==='MIGRATIONS')i=x.initializer;ts.forEachChild(x,w)};w(sf);console.log(i?i.elements.length:'n/a')" $f
    "$r -> $n"
  }
}
```

**Runtime drive — the task is not done until this has been observed, not compiled.** Evidence under
`_verify/6b-1/`; the container is left **running**.

1. `docker ps -a --filter name=chorus-g2-neo4j --format '{{.Status}}'` — if it is Exited, run
   `docker start chorus-g2-neo4j` and wait for bolt (measured 4.3 s warm, F93: **TCP accepting is
   not bolt ready**).
2. `npm run dev`; open the **Chorus** project (dev DB row `a43b395d…`, mode `existing`,
   `bolt://127.0.0.1:7688`); launch a **claude** pane.
3. In that pane, ask for a `chorus-memory` read. **Naming the graph in the prompt is allowed for
   THIS drive** — 6b-1 proves the instrument, not adoption; the milestone's unnamed-prompt run is
   6b-3's. Capture the prompt verbatim.
4. **(a) The live counter.** Screenshot / CDP-read the pane card's `.card-foot`: it must show the
   reads count beside the context ring, and it must have been **absent** before the first call.
5. **(b) The row.** Copy `%APPDATA%\chorus\chorus.db` (never read the live file), then read the
   **five** columns with Electron-as-node against the **repo's** `better-sqlite3` — the ABI is
   Electron's, so plain `node` throws:

   ```powershell
   $env:ELECTRON_RUN_AS_NODE=1
   node_modules\electron\dist\electron.exe _verify\6b-1\read-row.js
   ```

   The script (given in the spec) prints `id, agent, created_at, memory_reads, memory_writes,
   memory_read_first, memory_read_inconclusive, memory_shell_first` for the session, and
   `SELECT version, applied_at FROM schema_migrations ORDER BY version DESC LIMIT 2`. **Paste the
   exact output.** The `applied_at` is not incidental — it is the date the aggregate's sentence
   quotes, so (b) and (c) must agree on it.
6. **(c) The aggregate.** Open Project Settings → Memory → *Count sources*. The line beside the
   ratio must read **`R successful memory reads · W memory writes across K Claude Code sessions
   observed since <date>`** with the numbers from (b) and v21's `applied_at` day as `<date>`, the
   lower-bound disclosure must be visible, and **K must be explainable** — say which sessions it
   counts and why. **Paste the rendered line verbatim, including the words `successful` and `Claude
   Code`** (D173 Q2): a screenshot that shows "12 reads · 3 writes across 4 sessions" is a **failed**
   step, not a formatting nit.
7. **(c') The denominator's control case — the only place the `agent` filter is provable.** In the
   **same** project, launch a **codex** pane, let it do ordinary work, and exit it. Then re-open
   Project Settings → Memory: **K must not have increased**, and the sums must be unchanged.
   Paste K before and after. This is the observation that would catch a dropped `AND agent =
   'claude'`, and it cannot be made in a unit test because `storage.ts` does not load under Vitest.
8. **The negative drive.** Launch a second pane, deny a tool permission so the sequence is
   `PreToolUse` with **no** `PostToolUse` (or set the pane's permission mode so the memory tool is
   refused). Confirm the counter does **not** move, in the UI **and** in the row.
9. **The name check, at runtime.** `Select-String -Path (main log) -Pattern "mcp__chorus-memory__"`
   over the app's log for the drive — **zero hits.**

**⚠ Failure-honesty clause.** A command that fails for any reason — Docker Desktop down, an ABI
mismatch, a locked DB, a missing CLI — is reported **with its output**, and the step is **not
claimed**. A drive that did not run is not a drive that passed.

## Acceptance Criteria

- [x] **The D168 ratification gate is DISCHARGED** — ratified through CR-6b.0 (D173) on 2026-08-19.
      Nothing to wait for; the implementer confirms they read D168's "⚠ AMENDED BY D173" clause
      before the first edit.
- [ ] §0's probes re-run this session: `claude --version` recorded; a live `PostToolUse` body dumped;
      **a live `PostToolUseFailure` body dumped and its `error` key confirmed** (the fact the
      "successful" label rests on); the observed tool names listed; **the exploration set, the
      delegation tool's current name, the shell set and the known-tool set all confirmed against the
      measured list, and the list pasted into the report.**
- [ ] **`tool_name` is the only new field read**, and `agentEvents.ts`'s header + `readHookEventName`'s
      docblock both state the new truth. Neither claims two fields any more.
- [ ] **No tool name is stored, logged, broadcast or returned — on the success, ERROR and EXCEPTION
      paths** (D173 Q1) — proven by the canary tests (valid / exploration / unknown / malformed /
      oversized / throwing listener) and by the runtime log grep, not by inspection alone.
- [ ] Twenty `PostToolUse` bodies produce twenty increments and **one** `onActivity` callback.
- [ ] `PreToolUse` and `PostToolUseFailure` do not count; `revoke` clears.
- [ ] **`Bash` is NOT in the pass/fail exploration set** — `isExplorationTool('Bash') === false`,
      asserted with the D173 reason in the test's comment — and the shell diagnostic is a separate
      set-once flag that never reaches the pass/fail branch.
- [ ] **An unknown tool before the first memory read yields INCONCLUSIVE, never a pass**, and the
      three outcomes (pass / inconclusive / not-passed) are proven disjoint by the five ordering
      cases. All three flags are **set-once** at both levels: derived from set-once ordinals in main,
      and `MAX()`-written on the row.
- [ ] **v21 verified free three ways at the moment of writing** (`MIGRATIONS` AST, both DBs'
      `MAX(version)`, every sibling ref) and the numbers pasted into the report.
- [ ] `MIGRATIONS.length` **21** · `IpcChannel` **108** (both `ipc.test.ts` assertions moved) ·
      `sqliteTable(` **19** · `LATEST_GRAPH_VERSION` **2** · runtime deps **9**.
- [ ] The aggregate renders **with its denominator and in D173's exact shape** — `R successful memory
      reads · W memory writes across K Claude Code sessions observed since <v21 applied_at day>` —
      **with the lower-bound-after-restart disclosure beside it**, and the implementer can state, in
      one sentence, exactly which sessions `K` counts.
- [ ] **K is FILTERED as well as labelled**: the accessor's `WHERE` carries `agent = 'claude'`
      alongside `project_id` and the v21 `applied_at` floor; `schema.test.ts` pins all three
      predicates by source text (there is no `storage.test.ts` — the module cannot load under
      Vitest); and the runtime drive proves a codex session in the same project moves neither the
      sums nor K. A pane Chorus cannot instrument is never counted as measured non-use (D173 Q2,
      quoted in the test's comment).
- [ ] **The breakdown line renders** `P read-first · I inconclusive · S shell-first of the same K
      Claude Code sessions` against that same K, and nothing anywhere renders `K - P` as a failure
      count — `P + I` need not equal K.
- [ ] The live counter is **absent, not zero**, on a session that has made no memory calls.
- [ ] typecheck **0** · vitest **≥ 2618** + the new cases · `grep:secrets` clean.
- [ ] The runtime drive's four observations (a), (b), (c), (c') and the negative drive are captured under
      `_verify/6b-1/` with exact outputs.
- [ ] Nothing under `src/main/adapters/` changed; `git diff --stat` proves it.

## Review Checklist

A spec reviewer must confirm:

1. **The count is taken before the edge filter.** Read `handle()` top to bottom: the counting block
   must appear before `readHookEventName`'s gate at `:289` and before `record()` at `:297`. If it
   sits after either, the feature is a lie that passes its own unit tests — grep for the block's
   position, do not take a summary's word for it.
2. **The name never survives the expression that classifies it.** Grep the diff for every use of the
   `readToolName` result: it may be passed to `classifyMemoryTool` and `isExplorationTool` and to
   nothing else. It must never be assigned to a field, pushed to an array, put in a template literal,
   or passed to `logger`.
3. **`ToolSearch` is excluded and a comment says why.** Without the F92 reason written down, the next
   person adds it back in good faith and the milestone can never pass again.
   **And `Bash` is excluded, with D173's reason written down beside it** — the two omissions are the
   same kind of load-bearing absence and both need their reason in the file, not in this document.
   `Bash`'s presence in the pass/fail set is a **regression**, not a preference.
   **And an unknown tool produces INCONCLUSIVE, not a pass.** Grep the derivation: the pass expression
   must test `firstUnknownOrdinal` as well as `firstExploreOrdinal`. A pass condition that mentions
   only exploration is the silent-pass bug D173 removed, and it passes every test written against the
   old two-ordinal API.
4. **`PostToolUse` is compared with `===`, not `startsWith`.** `PostToolUseFailure` shares the prefix.
5. **The broadcast suppression is not the count suppression.** Two distinct things happen in one
   block; the code and its comment must make the distinction unmissable, and the test that proves it
   (twenty `Read` receipts → 20 ordinals, 0 callbacks) must exist.
6. **The migration is one entry, appended, FIVE columns, with `NOT NULL DEFAULT 0` and no index**,
   and its comment
   records the number as **computed at execution** with the three sources — the discipline
   `storage.ts:892`–`:898` and `:912`–`:916` both follow, and which exists because of the v16
   collision at `:775`–`:788`.
7. **The storage write is monotonic and its limit is written down.** A `SET column = ?` that can go
   backwards, or a `+ 1` that can double-count on a retry, is a defect; so is a monotonic write whose
   restart under-count is undocumented.
8. **The aggregate's denominator is defined in the code, not in prose, and its LABEL names Claude
   Code.** A reader must be able to point at the SQL and say which sessions `K` counts. If the answer
   is "all of them", pre-v21 sessions are inflating a denominator they were never measured for. And
   if the rendered sentence says "K sessions" rather than "K **Claude Code** sessions", it is
   claiming coverage of codex panes this instrument cannot see (D173 Q2) — check the string in
   `shared/provenance.ts`, not the screenshot.
9. **Zod parses in main only** (`shared/ipc.ts` declares, `main/ipc.ts` parses, `preload/index.ts`
   forwards with zero Zod — D1, and the CSP `EvalError` is silent).
10. **The payload crossing the bridge is a plain object.** It is built from primitives in main, so
    this should be true by construction — confirm no reactive or class instance is passed.
11. **No `.vue` file does arithmetic or string assembly** for either sentence. Both come from
    `shared/provenance.ts` and are tested there.
12. **`git diff --stat` shows no file outside the Exact Scope list**, and `roadmap.md`'s pre-existing
    kickoff edits are untouched by this task's diff.
