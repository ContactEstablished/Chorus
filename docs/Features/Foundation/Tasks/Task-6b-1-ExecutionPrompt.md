# Task 6b-1 — Execution Prompt (paste into a fresh session)

> **⚠ AUTHORED 2026-08-19 against `main` at `a3ba6f9`. Every number, path, line reference and CLI
> probe below was re-run at that HEAD while authoring this document** — the AST counters were
> executed, both CLIs were re-probed, the sibling-branch migration sweep was run, the hook-probe
> evidence files were opened and read, and every cited line was read rather than copied forward.
> **There is no single fatal spec bug in this task** (unlike 6a-1, whose spec shipped a feature that
> could never fire): `Task-6b-1.md` and `ImplementationSpec-6b-1.md` agree with each other and with
> the code. What there *is* — five documentation drifts, one of them inside the roadmap's own Phase 6b
> table — is in **Corrections and cross-references** below. **Read that section before the spec.**

---

You are the **Coordinator** for **Task 6b-1 — Measure**, the **first of four tasks in Phase 6b —
Memory Adoption & Measurement**. Nothing else in the phase can be judged until this lands: 6b-2 ships
a contract whose effect is unmeasurable, 6b-3 turns memory on for a milestone with no instrument to
read it off, and 6b-4 fires — or does not fire — on numbers that do not yet exist. **This task builds
the instrument, and the phase's milestone is explicitly forbidden from being read off a transcript.**

**Repo root:** `C:\Projects\ContactEstablished\Chorus`
**Expected branch:** `main` at `a3ba6f9` ("Record the memory-usage audit: Phase 6b is created and
queued next") — confirm with `git branch --show-current` and `git log --oneline -1`.

> **HEAD may legitimately differ in exactly one way:** a later **docs-only** commit carrying the
> Phase 6b kickoff documents (the Gate 0 list below, committed). If HEAD differs in **any other way**,
> **stop, re-verify every baseline number in Gate 1 yourself, and say in your report what moved.**
> **Do not switch or create branches without instruction.**

---

## ⚠ GATE 0 — THE TREE IS DIRTY AND NONE OF IT IS YOURS

`git status --porcelain` at authoring time — **twelve entries, all pre-existing**:

```
 M docs/Features/Foundation/roadmap.md
?? docs/Features/Foundation/CouncilBriefs/CouncilBrief-6b.0-AdoptionDrafts-Findings.md
?? docs/Features/Foundation/CouncilBriefs/CouncilBrief-6b.0-AdoptionDrafts.md
?? docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-6b-1.md
?? docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-6b-2.md
?? docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-6b-3.md
?? docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-6b-4.md
?? docs/Features/Foundation/Tasks/Phase-6b-Overview.md
?? docs/Features/Foundation/Tasks/Task-6b-1.md
?? docs/Features/Foundation/Tasks/Task-6b-2.md
?? docs/Features/Foundation/Tasks/Task-6b-3.md
?? docs/Features/Foundation/Tasks/Task-6b-4.md
```

- **The modified `roadmap.md` and the ten untracked documents are the Phase 6b kickoff's own output**
  (D168–D172, F92–F93, the Phase 6b section, the council brief and its findings, the four task docs
  and their four specs). They are the documents you are about to execute. **Do not revert them, do
  not stage them, do not commit them, do not "tidy" them.** Committing a phase's planning documents
  inside the phase's first implementation commit folds two unrelated pieces of work into one
  narration. **If you believe they should be committed, say so in your report and let Matthew decide.**
- **A thirteenth untracked file exists by the time you read this: `Task-6b-1-ExecutionPrompt.md`** — this
  document. Same rule.
- **⚠ IF THE TREE IS CLEAN INSTEAD, THAT IS ALSO EXPECTED AND ALSO FINE.** Matthew may have committed
  the kickoff documents before starting you. Then this gate passes trivially, HEAD is a docs-only
  commit on top of `a3ba6f9`, and **you say so in your report** rather than hunting for missing files.
- `_verify/` is gitignored working evidence (`.gitignore:165`). **Never stage anything under it.**
  `_verify/6b-4/hookprobe/` already exists on this machine and holds the kickoff's hook measurements —
  **read it, do not delete it, do not commit it.**
- Run `git status --porcelain` yourself at the start. **If you find MORE than the thirteen above, list
  what you found in your report and still touch none of it.**

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

**⚠ THE FALSE GREEN, WHICH HAS FIRED TWICE.** With the toolchain gone, `npm run typecheck` fails with
`'tsc' is not recognized` — which contains **no `error TS`**, so a grep for the compiler's error
string reports a clean pass. **Check the EXIT CODE, and grep for the toolchain's own failure, not
only for `error TS`.**

### Baseline — measured 2026-08-19 at `a3ba6f9` by running it, not by quoting the kickoff

| Gate | Value | How it was taken |
|---|---|---|
| `npm run typecheck` | **exit 0**, node + web | — |
| `npx vitest run` | **2618 passed / 2618, across 74 files** (~11.5 s) | — |
| `npm run grep:secrets` | **clean, 6 patterns** (`scripts/secret-grep.mjs`) | — |
| `IpcChannel` keys | **107** → you move it to **108** | TypeScript AST over `src/shared/ipc.ts`; both assertions live at `src/shared/ipc.test.ts:3510` and `:3897` |
| `MIGRATIONS.length` | **20** → you move it to **21** | TypeScript AST over `src/main/services/storage.ts`; the array is declared at `:174` and closes at `:944`, last entry v20 (`day_reports`) ending `:943` |
| `grep -c "sqliteTable(" src/main/db/schema.ts` | **19** — unchanged (five columns, not a table) | — |
| `sessions` columns | **14**, AST-counted → **19** after this task | `id, projectId, agent, cwd, status, exitCode, title, name, description, worktreeId, createdAt, launchProfileId, lockedAt, agentSessionId` (`src/main/db/schema.ts:68`–`:130`) |
| runtime deps in `package.json` | **9** — unchanged; `git diff -- package.json` must be **empty** | `@electron-toolkit/preload, @electron-toolkit/utils, better-sqlite3, neo4j-driver, node-pty, pino, splitpanes, uiohook-napi, zod` |
| `LATEST_GRAPH_VERSION` | **2** — unchanged (this task writes no Cypher at all) | — |
| App version | **0.7.2** | `package.json` |
| Installed CLIs | `claude` **2.1.235** (`C:\Users\matth\.local\bin\claude`) · `codex-cli` **0.148.0** | both re-run while authoring |
| Docker | `chorus-g2-neo4j` **Up**, `bolt://127.0.0.1:7688`, restart policy `no` | `docker ps -a --filter name=chorus-g2-neo4j` |
| Graph contents | **710 nodes** — 468 `:File` · 200 `:Commit` · 37 `:Directory` · 2 `:ChorusMigration` · 1 `:Memory` · 1 `:ChorusSchema` · 1 `:Project`; **0 `:AgentSession`** | kickoff measurement; you do not change it |

**Write your own baseline down before touching code (G6).** These numbers are true as of authoring
and this project has watched shared counters decay repeatedly. Every later "≥ 2618" claim is measured
against **your** number, not this one.

**⚠ AND THE G6 MIGRATION SWEEP WAS RUN, NOT ASSUMED.** At authoring, every ref parsed to:

```
agent/visible-terminal-selection -> 18      chorus/Chorus/318db258 -> 17
chorus/Chorus/39b6f2fe -> 4                 chorus/Chorus/7b2100e6 -> 12
chorus/Chorus/becbef31 -> 20                chorus/Chorus/d789a6c6 -> 15
chorus/Chorus/ff87c248 -> 15                main -> 20
worktree-agent-ac607b24c8ebfc41d -> 12      origin -> 20
origin/agent/visible-terminal-selection -> 18   origin/chorus/Chorus/ff87c248 -> 15
origin/main -> 20
```

**Maximum 20, so v21 was free at authoring. RE-RUN IT ANYWAY** — see Step 1(4). Four worktrees share
one dev database and a version claimed on a branch you cannot see fails **silently**: the runner keys
off `MAX(version)` (`storage.ts:3392`), so your v21 would be skipped without a word and the first read
of a missing column throws `no such column` at boot. `storage.ts:775`–`:788` records the v16 collision
that cost exactly that.

---

## Corrections and cross-references — READ BEFORE THE SPEC

**Nothing here changes what you build.** Three stale citations found while authoring this prompt were
fixed in the source documents the same day (the roadmap's Phase 6b table row for 6b-1 now says five
columns; `Task-6b-1.md`'s fact table and its test note now say **14** `sessions` columns, AST-counted;
the roadmap's baseline row now records that F90's "12 sessions / 5 projects" did not reproduce — 9
total, 6 in 7 days across 3 projects). Two things remain worth saying. **State in your report that
you confirmed both.**

1. **⚠ D168's BODY IS SUPERSEDED BY THE CLAUSE AT THE END OF ITS OWN CELL — READ THAT CLAUSE FIRST.**
   `roadmap.md`'s D168 row (grep `| D168 |`) now opens with a one-sentence guard saying exactly this,
   but the body underneath still reads top-to-bottom as *"three counters and two ordinals"*, *"three
   columns on `sessions`"*, and an exploration set that **includes `Bash`**. Every one of those is
   reversed by the **"⚠ AMENDED BY D173 (CR-6b.0, 2026-08-19)"** clause at the end of the same cell —
   five columns, `Bash` out, inconclusive and shell-first outcomes, a Claude-Code-scoped label. An
   implementer who reads the row in order and starts coding builds the pre-council design, and it
   compiles, type-checks and passes every test written against it. **Build from the amendment, the
   task doc and the spec — they agree.**

2. **`D83` is cited for "a hook body is untrusted input", and the roadmap's D83 row is about the
   startup splash.** D168, `Phase-6b-Overview.md`'s purity contract, and the code itself
   (`agentEventsCore.ts:206`–`:207`) cite **D83** for the untrusted-parse posture. The actual D83 row
   is the **Phase 3c** decision about the startup splash; the rule being invoked is the **`bootInfo.ts`
   precedent recorded inside it** — parse untrusted input by clamping, length-capping and
   shape-checking, never by assuming a shape. **Do not go looking for a hooks ruling under D83.** The
   hook read-surface rulings are **D130** and **D168** (+ **D173**).

**Everything else in `Task-6b-1.md` and `ImplementationSpec-6b-1.md` was checked against the code at
`a3ba6f9` and holds, line number for line number.** The two documents agree with each other,
including on the strings asserted character for character. The `sessions` column count you will pin
after your five columns land is **19**.

---

## Goal

**Give this phase an instrument.** Today nothing in Chorus can answer *"did this agent read the memory
graph, and did it read it before it started exploring the filesystem?"* except by a human opening a
JSONL transcript and counting — which is exactly what the phase's milestone forbids.

When this lands, **five** numbers exist per session — `memory_reads`, `memory_writes`,
`memory_read_first`, `memory_read_inconclusive`, `memory_shell_first` — they survive the session, they
roll up per project **with a denominator that says `Claude Code` out loud**, and a live counter appears
on the pane card beside the context ring while an agent is using the graph.

**The task is done when a real claude pane's graph call moves a number you can read off the SQLite
row and off the Memory section — and a codex pane in the same project moves neither.** Not when the
code compiles, and not when the suite is green.

**⚠ THE PRIME CONSTRAINT: THE READ SURFACE WIDENS BY EXACTLY ONE FIELD, AND THE MODULE'S OWN SECURITY
CLAIM IS REWRITTEN IN THE SAME EDIT.** `tool_name` — the **name only**, compared against fixed sets
and dropped in the same expression. Never `tool_input` (the Cypher an agent wrote), never
`tool_response` (graph content), never `prompt`, never `last_assistant_message`, never `tool_use_id`.
`agentEvents.ts`'s header currently claims at `:53`–`:56` that **"Two fields are read"**; that sentence
becomes false the moment your reader lands, and **a stale security guarantee is worse than none** —
which is the argument `contextUsage.ts:25`–`:29` already makes about the last widening.

---

## Ground yourself first — read before editing

**Authoritative, read in full, in this order:**

1. `docs/Features/Foundation/Tasks/Phase-6b-Overview.md` — the phase's verified ground facts, the
   purity contract, the milestone, and the verification every task runs.
2. `docs/Features/Foundation/Tasks/Task-6b-1.md` — scope, non-goals, the five facts that cost a
   session, test expectations, acceptance criteria, review checklist. **716 lines; read all of them.**
3. `docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-6b-1.md` — §0's probes, exact
   insertion points, code sketches, the amended header text, the SQL, the UI strings, §9's runtime
   drive. **1,716 lines. The TypeScript blocks are SKETCHES — the shape and the reasoning, not text to
   paste unread.**
4. `docs/Features/Foundation/CouncilBriefs/CouncilBrief-6b.0-AdoptionDrafts-Findings.md` §Q1–Q3 —
   the verdicts this task executes. **Its own header warns you: *"These findings are model
   deliberation, not verified fact… This project's own CR-3b.0 was unanimous, its rulings were sound,
   and the code it shipped had four compile errors."*** What was **adopted** is D173's row; the
   findings are the reasoning behind it.

**Roadmap** (`docs/Features/Foundation/roadmap.md`) — quote these as constraints, not background:

- **D168 (SETTLED 2026-08-19, Phase 6b kickoff; RATIFIED through CR-6b.0 the same day (D173); 6b-1
  owns it)** — *"**⚠ THE D130 READ SURFACE WIDENS BY EXACTLY ONE FIELD — `tool_name`, NAME ONLY, NEVER
  `tool_input` / `tool_response` / THE PROMPT**"*, with *"**⚠ THE HONEST STATEMENT IS THAT EVERY TOOL
  CALL'S NAME PASSES THROUGH THE COMPARISON, NOT ONLY MEMORY ONES**"* and *"**⚠ THE COUNTER HANGS OFF
  THE RAW RECEIPT IN `agentEvents.ts` `handle()`, BEFORE `record()`'s EDGE FILTER**"*. **Read its
  "⚠ AMENDED BY D173" clause before its body** — see correction 2.
- **D173 (RESOLVED 2026-08-19 — council run, findings recorded, two qualifications declined by Matthew
  with reasons)** — CR-6b.0, run `2f158260-bf3f-4b06-baa0-cddb8a22eca5`, 4 members + arbiter (DeepSeek
  v4 Pro · GLM 5.3 · Grok 4.6 · Qwen 3.8 Max; arbiter GPT 5.6 Terra). **Q4 and Q7 AGREE, six QUALIFY,
  none refused at arbiter level.** The six clauses that bind 6b-1, verbatim from the row:
  - **(Q1)** *"the no-retention test covers error and exception paths (a debug log of a raw body would
    undo the posture); the listener header says **every completed tool-call name is classified and
    discarded**."*
  - **(Q2)** *"the aggregate is labelled **'… across K Claude Code sessions observed since \<date\>'**
    — the instrument is Claude-only (codex has no hook bus) and an unqualified 'K sessions' would have
    implied all-agent coverage — with the restart under-count disclosed as a lower bound;
    `memory_read_first` is set-once."*
  - **(Q3)** *"**`Bash` leaves the pass/fail exploration set** — without `tool_input`, `npm test` and
    `ls` are the same event, and this metric gates 6b-4's escalation — and becomes a separate
    **shell-before-first-read diagnostic**; an **unknown non-memory tool before the first memory read
    makes the ordering result INCONCLUSIVE**, never a silent pass (vendor tool names drift);
    `ToolSearch` stays excluded (F92)."*
  - **v21 carries FIVE columns**, all `INTEGER NOT NULL DEFAULT 0`, *"all written per receipt with
    monotonic `MAX()`"*.
  - **`PostToolUse` is a SUCCESSFUL tool result, MEASURED** — *"an MCP error result fires
    `PostToolUseFailure` instead… so 'successful read' is the honest label."*
  - The council's *"vacuous pass"* objection was **against the brief's one-line summary**; the spec
    already required a **completed** read (`toUsage`'s `rec.firstReadOrdinal !== null && …`) and is
    **cited unchanged**. ⚠ **Do not "fix" it twice.**
- **D130 (ACCEPTED 2026-08-07, coordinator)** — the listener's security posture and its **named limit**:
  *"this defends against a local process that does not already have the user's file access. It does
  NOT defend against a process running as the same user."* Also: ***"`curl -o NUL` IS LOAD-BEARING,
  NOT TIDINESS: a hook command's STDOUT is a control channel."*** **You do not touch that hook entry.**
- **D55 (RESOLVED 2026-07-25, Task 3a-2)** — *"No attention number may be obtained without its
  denominator."* *"12 reads"* is not a fact; *"12 reads across 3 sessions since 2026-08-20"* is.
- **D83 / D76 / D147(e) / G6** — untrusted parse by clamp-and-shape-check (see correction 4); no stub,
  no flag, no comment promising one later; every line is paid for; re-count shared counters rather
  than trusting any document, **including this one**.
- **F55 and F56 (both OPEN, 2026-08-10, Task 8-0)** — F56 is the whole reason the count goes where it
  goes: *"`record()` returns early when a session's activity already equals the next value, so a turn's
  twenty `PreToolUse`/`PostToolUse` events collapse into **one** `'working'` callback."*
- **F91 (memory-usage audit, 2026-08-19)** — *"GRAPH READS ARE UNMEASURABLE TODAY"*; the listener
  *"deliberately discards `tool_name`"*. **This task is F91's owner.**
- **F92 (Phase 6b kickoff, 2026-08-19)** — *"CLAUDE CODE 2.1.235 DEFERS MCP TOOLS"*: the `PreToolUse`
  stream was **`ToolSearch` first, then `mcp__chorus-memory__read_neo4j_cypher`**. **This is why
  `ToolSearch` is not an exploration tool**, and it is a measurement, not a preference.

**Code to inspect — every line number below was opened and read at `a3ba6f9` on 2026-08-19 while
authoring this document. Re-confirm before quoting, per G6.**

| File | Line | Why |
|---|---|---|
| `src/main/services/agentEventsCore.ts` | `57` (`WORKING_EVENTS`), `65`/`66` (**`'PostToolUse'` and `'PostToolUseFailure'` are separate entries**), `114` (`NEEDS_YOU_EVENTS`), `138` (`classifyHookEvent` — the honesty bar for an unrecognised name), `204`–`:218` (the docblock you amend; `:209` is the existing correction, `:214`–`:217` the sentence that must be narrowed), `219` (`readHookEventName` — the shape `readToolName` mirrors), `248` (`readTranscriptPath`) | The reader, the classifiers, and the docblock. **`PostToolUse` is already subscribed — no adapter or settings change is needed anywhere.** |
| `src/main/services/agentEvents.ts` | `53`–`:66` (the header's point 5, *"Two fields are read"*), `68`–`:75` (the named limit — same-user code execution as an **excluded threat class**), `85`–`:94` (`AgentActivityRecord`), `112`–`:123` (`TranscriptPathListener`), `146` (`revoke`), `151` (`recordFor`), `164` (`onTranscriptPath` in the interface), `168`–`:175` (`createAgentEventListener`; `activity` map at `:173`, `transcriptListeners` at `:175`), `181` (`record`), **`198`** (**the edge filter** — `if (prev?.activity === next && prev.reason === reason) return`), `212`–`:220` (the listener-throws rule), `229` (`handle`), `260`–`:261` (**the 200 is answered BEFORE anything is derived — nothing you add may change that**), `276`–`:287` (the transcript-path block, the non-edge precedent), **`289`** (`readHookEventName`), `290` (`if (!eventName) return`), `294` (`if (!next) return`), **`297`** (`record(…)`), `338`–`:342` (`revoke`, `activity.delete` at `:342`), `349` (`recordFor`), `377` (`onTranscriptPath` impl), `382`–`:385` (`dispose`, `activity.clear()` at `:385`) | **The single most important geometry in this task.** Your counting block goes **after `:287` and before `:289`**. |
| `src/main/services/contextUsage.ts` | `13`–`:50`, and especially `24`–`:29` (*"⚠ `agentEvents.ts` STATES, IN ITS OWN HEADER, THAT ONLY `hook_event_name` IS READ… THIS FEATURE NARROWS THAT CLAIM AND THE HEADER HAS BEEN AMENDED TO MATCH"*) | **The precedent for how a documented read-surface widening is written**: what is taken, what is never taken, where it is stored, what can leak, why it is acceptable. Author the new posture in that shape. |
| `src/main/services/storage.ts` | `174` (`const MIGRATIONS: string[] = [`), `775`–`:788` (**the v16 collision** — dev worktrees share one DB), `790`–`:796` (why `locked_at` refused a default — the contrast your v21 comment must draw), `892`–`:898` and `912`–`:916` (**the "computed, not copied" comment discipline you copy, with the actual numbers in it**), `907` (v19's `ALTER TABLE sessions ADD COLUMN agent_session_id TEXT;`), `930`–`:943` (v20 `day_reports`), `944` (the closing `]`), `965` (`journal_mode = WAL`), `1618`–`:1648` (`createSession` normalisation), `1650` (`getSessionsForProject`), `1711`–`:1754` (the v19 accessor block whose banner is your template), `1725` (`setAgentSessionId`), `1747` (`getAgentSessionId`), `3387` (`migrate()`), `3392` (`MAX(version)`), `3396`–`:3404` (the loop; DDL + the `schema_migrations` INSERT in **one transaction** at `:3397`–`:3402`) | The migration, its number, its comment, the accessors. |
| `src/main/db/schema.ts` | `58`–`:61` (`schema_migrations`: `version`, `applied_at` — **the aggregate's floor comes from here; no new column**), `68`–`:130` (`sessions`, **14 columns**; `agentSessionId` at `:129`), `159` (`SessionRow`) | Where the five columns land. |
| `src/main/db/schema.test.ts` | `17`–`:22` (**⚠ why there is no `storage.test.ts` and you must not create one** — better-sqlite3's binding is Electron-ABI, the import throws before an assertion runs), `25` (`STORAGE_SRC`), `28`–`:34` (`migrationsSource()`), `36`–`:70` (the v19 `describe` you copy five times) | The drift guard, and the only place the aggregate's `WHERE` can be pinned. |
| `src/shared/ipc.ts` | `14` (`IpcChannel`), `43` (`SessionActivity`), `57` (`SessionContext`), `60` (`SessionContextList` — **your new key goes after it**), `2217` (`sessionContextUsageSchema`), `2229` (`sessionContextEventSchema` — the broadcast precedent), `3246` (`memoryValidateResponseSchema`, a **union** — `usage` goes on **both** branches) | The wire. |
| `src/shared/ipc.test.ts` | **`3510`** and **`3897`** (`expect(Object.keys(IpcChannel)).toHaveLength(107)` — **both move to 108**), `3505`–`:3509` and `3885`–`:3896` (the comment style each gets a one-line note in; **the history is kept, never trimmed — the recurrence is the finding**), `3513`–`:3515` (the assert-by-name-as-well-as-count rule) | Both assertions, and how to annotate them. |
| `src/shared/provenance.ts` | `31` (`completeness`), `44` (`affectedLabel`), `58` (`PROVENANCE_DISCLAIMER`) | **The wording's home — `shared/`, because the renderer may not import main-process code and this repo has no `.vue` tests at all.** |
| `src/main/services/provenanceCore.ts` | `242` (the re-export line) | Gains `memoryUsageLine`, `memoryBreakdownLine`, `MEMORY_USAGE_LOWER_BOUND_NOTE`, `sessionMemoryLine` + its type. |
| `src/main/ipc.ts` | `568` (`registerIpc` — **`storage` and `agentEvents` are both already in scope**), `4105`–`:4125` (the `MemoryValidate` handler), `4643`–`:4648` (`contextUsage.onUsage` — the fan-out shape you copy: **`.parse` in main**, then `win.webContents.send` to every window), `4654`–`:4656` (`SessionContextList`) | Where the event is parsed and fanned out. |
| `src/preload/index.ts` | `639`–`:641` (**the D1 note in the file's own words: *"a preload Zod import throws EvalError under the page CSP and silently drops events — validated in MAIN instead"***), `642` (`onSessionContext` — the forwarder you copy), `650`–`:651` (`getSessionContexts`), `773` (`ChorusApi = typeof chorusApi`) | The zero-Zod bridge. |
| `src/renderer/src/App.vue` | `227` (`offContext = window.chorus.onSessionContext(...)`), `261` (`offContext()` in `onUnmounted`) | Subscribe and unsubscribe, beside its twin. |
| `src/renderer/src/stores/session.ts` | `58`–`:69` (**the absent-not-zero rule, in the file's own words: *"a 0% ring is a claim… that Chorus cannot stand behind"***), `77`–`:78` (the `context` map in state), `112`–`:118` (dropped on exit), `142` (`contextChanged`), `149` (`contextLoaded`) | The live counter's home and the rule it inherits. |
| `src/renderer/src/stores/memory.ts` | `117` (`MemoryValidation`), `365` (`validate()`), **`370`** (`if (!res.ok) return this.refuse(res.reason)` — **the usage must be recorded BEFORE this early return**) | Why the counters live on **both** union branches. |
| `src/renderer/src/components/FilmstripRenderer.vue` | `266` (`contextFor`), `382` (`.card-foot`), `384` (the `ContextRing`, rendered `v-if="contextFor(id)"`) | Where the live counter goes. |
| `src/renderer/src/views/ProjectSettingsView.vue` | `1117`–`:1157` (`<div class="ps-provenance">` / *"Where memories came from"* at `:1118`), `1131`–`:1133` (the ratio), `357` (`memoryValidation`), `520` (`validateMemory()`) | Where the aggregate and the breakdown line land. |
| `src/main/services/memoryService.ts` | `200` (`export const CHORUS_MEMORY_SERVER = 'chorus-memory'`) | **The prefix is DERIVED from this import, never re-typed** — the 6a-1 rule, already followed by `instructionsCore.ts:20`–`:25`. |
| `src/main/adapters/claude.ts` · `codex.ts` · `grok.ts` · `kimi.ts` · `opencode.ts` | `claude.ts:215` (**why `-o NUL` is load-bearing**), `:223` (the curl command), `codex.ts:119` · `grok.ts:132` · `kimi.ts:118` · `opencode.ts:152` (**`hooks: null`** — the four adapters with no hook bus, which is why `K` filters `agent = 'claude'`) | **Read-only. Nothing under `src/main/adapters/` changes in this task and `git diff --stat` must prove it.** |

---

## ⚠ STEP 1 — RE-PROBE BEFORE WRITING ANYTHING

CLAUDE.md forbids trusting recall for CLI syntax, and **hook semantics move for the same reason flags
do** — claude went 2.1.232 → 2.1.235 between the 6a and 6b kickoffs. **The spec's §0 is the authority;
this is the short form and the evidence you are checking against.**

### (1) The CLIs

```powershell
claude --version    # was 2.1.235 at C:\Users\matth\.local\bin\claude  (re-confirmed while authoring)
codex --version     # was codex-cli 0.148.0
```

### (2) The hook body shape — the fact the whole task rests on

**⚠ FORWARD SLASHES IN THE HOOK JSON. A backslash inside a JSON string is an escape, and the kickoff's
first attempt used Windows paths and silently loaded NO HOOKS AT ALL** — no error, no hook, a probe
that looks like a negative result and is not. **Generate the settings file with a small node script**
rather than typing the path by hand; that is what the kickoff did (`_verify/6b-4/hookprobe/gen.cjs`,
`gen2.cjs`, `gen3.cjs`).

**⚠ A HOOK COMMAND MUST PRINT NOTHING TO STDOUT.** Hook stdout is a control channel — Claude Code
parses JSON there as a hook decision object (`claude.ts:215` is in the codebase for exactly this).
Append to a file and exit 0.

Run with `claude -p --model haiku --no-session-persistence --strict-mcp-config --settings <hooks.json>`,
per the spec's probes A / B / C.

**What the kickoff measured on claude 2.1.235, 2026-08-19 — evidence is on this machine at
`_verify/6b-4/hookprobe/` (`pre.log`, `ptu.log`, `ptf.log`; generators `gen*.cjs`; hook scripts
`pre.cjs`, `ptu.cjs`, `ptf.cjs`; `settings*.json`). I opened all three logs while authoring; these are
the exact key sets:**

| Event | Body keys |
|---|---|
| `PreToolUse` | `cwd`, `hook_event_name`, `permission_mode`, `prompt_id`, `session_id`, `tool_input`, `tool_name`, `tool_use_id`, `transcript_path` |
| `PostToolUse` | the nine above **plus** `duration_ms`, `tool_response` |
| **`PostToolUseFailure`** | the nine above **plus** `duration_ms`, **`error`**, **`is_interrupt`** |

- **`tool_name` = `mcp__chorus-memory__read_neo4j_cypher` verbatim**, on all three events.
- **⚠ F92 IS VISIBLE IN `pre.log`: `ToolSearch` fires BEFORE the MCP tool.** Two `PreToolUse` rows,
  `ToolSearch` first. **If your run does not show it, say so** — it would mean MCP tools are no longer
  deferred, which is a fact 6b-2 needs.
- **⚠ THE SPLIT IS THE MEASUREMENT THAT EARNS THE WORD "SUCCESSFUL".** A `chorus-memory` call with a
  deliberately broken Cypher fired **`PostToolUseFailure`**; the well-formed one fired **`PostToolUse`**.
  **Re-run probe C on this machine's CLI.** **⚠ STOP AND REPORT if that split has gone** — the
  "successful memory reads" label is then no longer earned, and that is a decision for Matthew, not a
  rewording you may make.
- **⚠ STOP AND REPORT if `PostToolUse` no longer carries `tool_name` as a plain string.** The design's
  one field is gone and there is no substitute.

### (2b) The known-tool census — load-bearing, not advisory

Probe A exercises exploration only. **Add a probe whose prompt makes claude reach for tools outside
that set** (a todo list, a web search, a file edit, a delegated sub-task) and **record every
`tool_name` it prints**. Those names seed three sets:

- **the pass/fail exploration set** — `Read`, `Glob`, `Grep`, `LS`, **and the installed CLI's
  delegation tool**. ⚠ `Agent` is the kickoff's observed name and the council flagged that it was
  `Task` within living memory. **The installed CLI decides, not this document.** The kickoff saw
  `Read`, `Glob`, `Grep`, `Bash`, `Agent`, `ToolSearch`, `WebFetch`; **`LS` was NOT observed on
  2.1.235 — keep it in the set anyway**, because a name that never arrives costs nothing and a name
  that returns would otherwise be missed;
- **the shell set** — `Bash` (a set, not a bare `=== 'Bash'`, so an alias lands in one place);
- **the known-but-not-exploration set** — `ToolSearch`, `WebFetch`, `Write`, `Edit`, and whatever else
  the probe printed.

**A name in none of those is *unknown*, and an unknown before the first memory read makes the session
INCONCLUSIVE.** An over-narrow known set costs inconclusive sessions (honest, recoverable); an
over-broad one costs a **silent pass** — the exact failure D173 removed. **Record which observed name
seeded which set, and paste the list into your report.**

### (3) The `sessions` DDL as it exists on this machine

```sql
SELECT sql FROM sqlite_master WHERE type='table' AND name='sessions';
```

Confirm the **14** columns match `schema.ts:68`–`:130`, and that **none of the five** is already there.

### (4) ⚠ v21 IS FREE — G6, THREE WAYS, AT THE MOMENT OF WRITING, NEVER QUOTED FROM A DOCUMENT

(a) this tree's `MIGRATIONS` via the **TypeScript AST** (never a grep — the array holds template
literals); (b) **every sibling ref**, with `git for-each-ref` + `git show <ref>:src/main/services/storage.ts`,
plus `git worktree list`; (c) **both real databases** — dev `%APPDATA%\chorus\chorus.db` and installed
`%APPDATA%\chorus-app\chorus.db` — `SELECT MAX(version) FROM schema_migrations`. **All three came back
20 at authoring** (the sibling sweep is printed in Gate 1). **If any comes back ≥ 21, STOP AND REPORT
the divergence rather than renumbering silently.**

**⚠ READING A DATABASE ON THIS MACHINE HAS THREE TRAPS AND ALL THREE HAVE FIRED BEFORE:**

1. **WAL.** `storage.ts:965` sets `journal_mode = WAL`. **Copy `chorus.db`, `chorus.db-wal` AND
   `chorus.db-shm`** before reading, or you can miss everything the drive just wrote. Never open the
   live file.
2. **ABI.** `better-sqlite3`'s binding is built for the **Electron** ABI. Plain `node` throws. Read
   with `ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe <script.cjs>`, requiring
   `C:/Projects/ContactEstablished/Chorus/node_modules/better-sqlite3`. **This is also why there is no
   `storage.test.ts` and why you must not create one** (`schema.test.ts:17`–`:22`).
3. **⚠ FIVE `chorus.db` FILES EXIST ON THIS MACHINE.** Claude Desktop's app container shadows
   `%APPDATA%`. **Check which file's mtime is actually moving before you read one**, and say in your
   report which path you read.

**Record all four probes' outputs in your report.**

---

## Implementation scope

**Create: NOTHING.** Every change is an edit to a file that already exists. If you find yourself adding
a file, stop — the design does not call for one, and the wording's home is `src/shared/provenance.ts`.

**Edit — and nothing outside this list:**

| File | Change |
|---|---|
| `src/main/services/agentEventsCore.ts` | `readToolName` (mirrors `readHookEventName` at `:219`: object check, `typeof === 'string'`, non-empty, **≤ 128**); `classifyMemoryTool` → `'read' \| 'write' \| null`; `isExplorationTool`; **`isShellTool`**; **`isKnownTool`**; their constant sets after `NEEDS_YOU_EVENTS` (`:121`); the amended `readHookEventName` docblock (`:204`–`:218`). **All pure; none retains, logs or returns the name.** |
| `src/main/services/agentEventsCore.test.ts` | The reader, **all four** classifiers, the hostile body. |
| `src/main/services/agentEvents.ts` | The amended module header (point 5 and the ⚠ under it); the per-session usage map beside `activity` (`:173`); the listener set beside `transcriptListeners` (`:175`); `noteToolUse` beside `record` (`:181`); the counting block in `handle()`; `onMemoryUsage` beside `onTranscriptPath` (`:377`); `memoryUsageFor` beside `recordFor` (`:349`); clearing in `revoke` (`:342`) and `dispose` (`:385`). |
| `src/main/services/agentEvents.test.ts` | The invariants, driven through the real bound port as `:24`–`:48` already does. |
| `src/main/db/schema.ts` | **Five** columns on `sessions`, after `agentSessionId` (`:129`). |
| `src/main/db/schema.test.ts` | The v21 drift guard (five times, in `:36`–`:70`'s shape); the `sessions` column count; **the aggregate's `WHERE` pinned as a source-text assertion**. |
| `src/main/services/storage.ts` | The **v21** entry appended after v20 (`:943`) before the closing `]` (`:944`); `createSession` normalisation (`:1618`–`:1648`); `setSessionMemoryUsage`; `getProjectMemoryUsage`. |
| `src/shared/ipc.ts` | `sessionMemoryUsageSchema`, `sessionMemoryEventSchema`, **one** new `IpcChannel` key after `SessionContextList` (`:60`), `memoryUsageSummarySchema`, and `usage` on **both** branches of `memoryValidateResponseSchema` (`:3246`). |
| `src/shared/ipc.test.ts` | `toHaveLength(107)` → **`108`** at **`:3510` and `:3897`**, each with a one-line note in the surrounding style; the new schemas' cases; **the channel asserted by NAME as well as by count**. |
| `src/shared/provenance.ts` | `memoryUsageLine`, `memoryBreakdownLine`, `MEMORY_USAGE_LOWER_BOUND_NOTE`, `sessionMemoryLine` (+ `SessionMemoryText`). |
| `src/main/services/provenanceCore.ts` | The re-export at `:242` gains all of them. |
| `src/main/services/provenanceCore.test.ts` | The wording cases, beside `:287`. |
| `src/main/ipc.ts` | The `onMemoryUsage` fan-out + persistence, after the `SessionContextList` handler (`:4654`–`:4656`); `usage` on the `MemoryValidate` response (`:4105`–`:4125`). |
| `src/preload/index.ts` | `onSessionMemory`, beside `onSessionContext` (`:642`) — **zero Zod**. |
| `src/renderer/src/App.vue` | Subscribe beside `offContext` (`:227`), unsubscribe at `:261`. |
| `src/renderer/src/stores/session.ts` | `memoryUsage` map, `memoryUsageChanged`, dropped on exit (`:112`–`:118`). |
| `src/renderer/src/components/FilmstripRenderer.vue` | The live counter in `.card-foot` (`:382`–`:384`). |
| `src/renderer/src/stores/memory.ts` | `usageByProject`, recorded **before** the `!res.ok` return at `:370`. |
| `src/renderer/src/views/ProjectSettingsView.vue` | The aggregate + breakdown + disclosure, in the `Where memories came from` block (`:1117`). |

### Binding rules

1. **⚠ THE COUNT IS TAKEN BEFORE THE EDGE FILTER, AND IF THIS BLOCK EVER MOVES BELOW `record()` THE
   FEATURE BECOMES A LIE THAT PASSES ITS OWN TESTS.** Exact position: **after the transcript-path block
   closes at `agentEvents.ts:287`, before `const eventName = readHookEventName(body)` at `:289`** —
   provably ahead of the `if (!eventName) return` gate at `:290`, the `if (!next) return` gate at
   `:294`, and `record(…)` at `:297`. F56 states the failure in the roadmap's own words: twenty tool
   calls collapse into one callback. **A count taken after the filter reports "1 read" for a session
   that made twenty, and every unit test written against the counter's own API still passes.**
2. **⚠ `PostToolUse` IS COMPARED WITH `===`, NEVER `startsWith`.** `PostToolUseFailure` shares the
   prefix and is a separate entry in `WORKING_EVENTS` (`agentEventsCore.ts:65` and `:66`). A
   `startsWith` would count failures as reads **and would destroy the word "successful"** in every
   label this task ships.
3. **⚠ THE COUNTER IS INCREMENTED UNCONDITIONALLY ON EVERY `PostToolUse` RECEIPT. ONLY THE
   *NOTIFICATION* IS SUPPRESSED WHEN THE BROADCAST PAYLOAD IS UNCHANGED.** Two distinct things happen
   in one block and the code's comment must make the distinction unmissable. Conflating them is the
   exact D168 failure. The suppression compares **only the five broadcast fields**, never the ordinals.
4. **⚠ THE NAME DIES IN THE EXPRESSION THAT CLASSIFIES IT.** `readToolName`'s result may reach
   `classifyMemoryTool`, `isExplorationTool`, `isShellTool` and `isKnownTool` **and nothing else** — no
   field, no array, no template literal, no `logger` call, no return value. **Then make it structural:
   `SessionMemoryUsage` and the internal record must contain NO `string` field at all**, so the promise
   is impossible to break rather than merely unbroken today.
5. **⚠ AND THAT INCLUDES THE PATHS NOBODY TESTS (D173 Q1).** Three council members raised error-path
   logging independently. The `catch` around a throwing listener, the malformed-body rejection and the
   over-cap rejection **all run with the receipt still in scope**, and one well-meant
   `logger.error({ err, body })` dumps the agent's Cypher and the graph's answer into the log while
   every existing test stays green. **Post the canary down each of those paths.**
6. **⚠ `Bash` IS NOT IN THE PASS/FAIL SET, AND ITS ABSENCE NEEDS ITS REASON WRITTEN IN THE FILE.**
   Without `tool_input` — which this task will never read — `npm test` and `ls` are the same event,
   and this metric gates 6b-4's escalation, so over-inclusion would trigger an escalation nobody's
   behaviour warranted. `isShellTool` sits on **its own branch** and **must never touch
   `firstExploreOrdinal`**; a reviewer must be able to prove that by grep. **Re-conflating them is a
   one-line regression that restores `Bash` to the pass/fail set without anyone editing the set.**
7. **⚠ `ToolSearch` IS EXCLUDED BY MEASUREMENT (F92), AND ITS REASON GOES IN THE FILE TOO.** If it
   counted as exploration, the first exploration ordinal would *always* precede the first memory read,
   `memory_read_first` would be `0` on every session forever, **and the phase's binary milestone could
   never pass — while every test stayed green.**
8. **⚠ THE ORDERING RESULT HAS THREE OUTCOMES AND THE THIRD FAILS SILENTLY WHEN IT IS MISSING.** The
   pass expression must test **`firstUnknownOrdinal` as well as `firstExploreOrdinal`**. Precisely:
   **pass** = a *completed* memory read exists AND precedes the first **known** exploration call (or
   none occurred) AND no **unknown** tool preceded it; **inconclusive** = a completed read exists,
   nothing known-exploration preceded it, but an unknown did; **otherwise not passed.** A condition
   that mentions only exploration compiles, type-checks and passes every test written against the old
   two-ordinal API — while a renamed vendor tool becomes a **free pass** on the phase's headline number.
9. **⚠ THE SERVER PREFIX IS DERIVED, NEVER RE-TYPED.** `` `mcp__${CHORUS_MEMORY_SERVER}__` `` from
   `memoryService.ts:200`, asserted against the import so a rename cannot leave a stale literal.
   An unrecognised name **under that prefix** classifies as `null` — **not counted rather than
   guessed**, the honesty bar `classifyHookEvent` sets at `agentEventsCore.ts:138`.
10. **⚠ THE MIGRATION IS ONE ENTRY, FIVE STATEMENTS, `NOT NULL DEFAULT 0`, NO INDEX, NO FK.** One entry
    because they are one schema change that must apply or fail together, and because splitting them
    would claim v22 as well when nothing has ever run against a three-column v21. **The comment records
    the number as COMPUTED with all three sources' actual output** — the discipline `storage.ts:892`–`:898`
    and `:912`–`:916` both follow. And it must say **why a default of 0 is honest here and was refused
    for `locked_at`** (`storage.ts:790`–`:796`): a session that made no memory calls really did make
    zero, whereas "the time this was locked" does not exist for an unlocked session.
11. **⚠ THE STORAGE WRITE IS MONOTONIC — `MAX(column, ?)`, never `= ?` and never `+ 1`.** `= ?` goes
    backwards after a restart (`retireHooks` at `sessionManager.ts:395` calls `this.hooks?.revoke(…)`
    at `:396`, which clears main's record, so the next registration starts at zero); `+ 1` double-counts
    on a retry. **`MAX()` is also what makes the three flags set-once at the ROW level.** It is written
    **per receipt**. **⚠ AND ITS LIMIT IS WRITTEN AT THE ACCESSOR:** a session restarted mid-life keeps
    its highest registration's numbers rather than the sum, so **the totals are a LOWER BOUND and the
    UI says so in words.** Per-receipt writing narrows that window; it does not close it.
12. **⚠ K IS FILTERED, NOT ONLY LABELLED — `WHERE project_id = ? AND agent = 'claude' AND created_at >= ?`.**
    All three predicates are denominator decisions and dropping any one inflates K with sessions the
    numerator could never have come from. The floor is `schema_migrations.applied_at` for v21, written
    in the **same transaction** as the columns (`storage.ts:3397`–`:3402`), so no fallback branch is
    needed. The `agent` predicate is D173 Q2 read at its word — **quote it in the test's comment:**
    *"Codex sessions must not be counted as measured non-use merely because no equivalent hook
    instrument exists."* Every non-claude adapter declares `hooks: null` (`codex.ts:119`, `grok.ts:132`,
    `kimi.ts:118`, `opencode.ts:152`). **The filter and the sentence are ONE change, never two.**
13. **⚠ THE AGGREGATE'S SHAPE IS D173's AND IS ASSERTED CHARACTER FOR CHARACTER:**
    > `R successful memory reads · W memory writes across K Claude Code sessions observed since <v21 applied_at day>`

    plus the lower-bound-after-restart disclosure, plus the breakdown line
    > `P read-first · I inconclusive · S shell-first of the same K Claude Code sessions`

    **`successful` and `Claude Code` are the two words the council added.** They read as verbosity to
    anyone who has not read the finding, and a tidy-up that drops either restores a claim the
    instrument cannot support. **⚠ `P + I` need not equal K** — a session can be neither — so **nothing
    anywhere may render `K - P` as a failure count.** The date is `since.slice(0, 10)`, the ISO day,
    **never `toLocaleDateString`** (a locale-dependent assertion passes here and fails elsewhere).
14. **⚠ NO ARITHMETIC AND NO STRING ASSEMBLY IN ANY `.vue` FILE.** `shared/provenance.ts:6`–`:10`
    states why: **this repo has no `.vue` tests at all**, so a sentence built in a template is
    unreachable by the suite. Both sentences come from `shared/provenance.ts` and are tested there.
15. **⚠ ZOD PARSES IN MAIN ONLY.** `shared/ipc.ts` declares, `main/ipc.ts` parses, `preload/index.ts`
    forwards with **zero Zod** — the preload's own note at `:639`–`:641` says a Zod import there throws
    `EvalError` under the page CSP **and silently drops events**. CLAUDE.md states the same rule.
16. **⚠ THE PAYLOAD CROSSING THE BRIDGE IS A PLAIN OBJECT.** It is built from primitives in main, so
    this should hold by construction — **confirm no reactive proxy or class instance is passed.**
    CLAUDE.md: Electron's structured clone rejects a Vue Proxy with *"An object could not be cloned"*
    and **no compile-time signal**. Snapshot first if any doubt exists.
17. **⚠ THE LIVE COUNTER IS ABSENT, NOT ZERO**, when both counters are 0 — the rule
    `stores/session.ts:58`–`:69` already states for the ring, and the emptiness is decided in
    `sessionMemoryLine` (which returns `null`), **where a test can reach it**, not by a `v-if`.
18. **⚠ THE HEADER AMENDMENT IS PART OF THIS DIFF, NOT A FOLLOW-UP.** Point 5 becomes **three** fields
    with `tool_name` named; the ⚠ under it gains a second paragraph in `contextUsage.ts`'s shape. The
    listener header's sentence is **D173 Q1's wording — *"every completed tool-call name is classified
    and discarded"*** — not "memory tool names are read", which is the narrower claim the council
    called misleading. **Do not delete the v16 correction: the recurrence is the finding**, exactly as
    `ipc.test.ts:3885`–`:3896` keeps its own history.
19. **⚠ ONE CHANNEL, NOT TWO. `IpcChannel` MOVES 107 → 108, NOT 109.** There is no
    `session:memory-list` cold read, and its absence is a decision. A missing memory counter is not
    *wrong*, it is **absent**, and its durable answer is already on the sessions row and in the Memory
    section's aggregate. **If a reviewer disagrees, that is a decision to take deliberately, not a line
    to slip in.**
20. **⚠ `usage` GOES ON BOTH BRANCHES OF `memoryValidateResponseSchema`** — the counters are a local
    SQLite read that works when the graph is down, and hiding them behind `ok: true` would let a
    stopped container erase a number that has nothing to do with the container.

---

## Strict non-goals

- **⚠ NO `tool_input`, NO `tool_response`, NO `prompt`, NO `last_assistant_message`, NO `tool_use_id` —
  EVER.** `tool_input` is the Cypher an agent wrote; `tool_response` is graph content. Both are
  user/agent content and neither is read, in this task or any later one. **The reader that would break
  this is one line long.**
- **No per-tool-name histogram, no "top tools", no query log.** A histogram would require keeping
  names — the surface this task exists to keep closed. **The `INCONCLUSIVE` flag is a boolean, not a
  record of which unknown tool it was.**
- **No change to `instructionsCore.ts`, to the contract text, or to `claude.ts`** — including its
  `-o NUL` (`claude.ts:215` says why). `PostToolUse` is already subscribed (`agentEventsCore.ts:65`),
  so nothing about the settings file changes. **That is 6b-2's and 6b-4's territory.**
- **No nudge route (6b-4). No `:AgentSession` MERGE (6b-2). No `docker start`, no index refresh
  (6b-3). No Cypher of any kind is written in this task.**
- **No new renderer route and no new view.** The aggregate goes in the existing Memory section; the
  live counter in the existing `.card-foot`.
- **No new dependency.** Runtime deps stay **9**; `git diff -- package.json` must be **empty**.
  **CLAUDE.md: ask before adding a dependency not named in the stack.**
- **No graph migration and no second SQLite migration.** `LATEST_GRAPH_VERSION` stays **2**;
  `MIGRATIONS.length` becomes **21** and stops. `sqliteTable(` stays **19**.
- **No `storage.test.ts`.** It cannot load under Vitest (`schema.test.ts:17`–`:22`). The denominator is
  pinned as a source-text assertion in `schema.test.ts` and proved behaviourally in the drive.
- **Nothing under `src/main/adapters/` changes**, and `git diff --stat` must prove it.
- **Do not touch the thirteen Gate 0 files. Do not push, do not open a PR, unless explicitly asked.**

---

## Required workflow

1. **Gates 0 and 1 first.** Record your own baseline before touching code.
2. **Step 1's probes.** Stop and report if `tool_name` is gone from `PostToolUse`, if the
   `PostToolUse` / `PostToolUseFailure` split has gone, or if v21 is not free.
3. Read the corrections section, then `Phase-6b-Overview.md`, then `Task-6b-1.md`, then
   `ImplementationSpec-6b-1.md`. **Read D168's "⚠ AMENDED BY D173" clause before D168's body.**
4. Implement as a **coordinator**: worker pass → **spec-compliance review clause by clause** →
   **code-quality review** → resolve findings → verification → commit narration.
5. **One intentional commit**, house style: a concise title, then a **plain-language description a
   non-technical reader can follow FIRST**, technical detail second under a `--- technical ---`
   divider. End with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. **Quote D173's `Bash`
   removal and the INCONCLUSIVE rule in the message** — they are the two things a later reader is most
   likely to try to "simplify" back out.
6. **Do not push and do not open a PR unless explicitly asked.**
7. **There is no `.codex/workflows` kit in this repository** — I checked; `.codex` does not exist.
   Follow the workflow above rather than looking for one.
8. If any instruction here conflicts with `CLAUDE.md`, **`CLAUDE.md` wins** — say so in your report.
   Its standing rules that bind this task: **IPC typed and Zod-validated via the preload bridge,
   validated in MAIN only**; **payloads crossing the bridge are PLAIN objects, snapshot first**;
   **ask before adding a dependency**; **verify CLI behaviour against the installed tool's own
   `--help`/output, never from recall**; **secrets are never logged and never written into
   transcripts** — and a hook body is adjacent to that rule, which is why no name and no body reaches
   a log line here.

---

## Verification — run these, do not reason about them

### Build gates

```powershell
npm run typecheck          # exit 0, node + web — CHECK THE EXIT CODE, not just for "error TS"
npx vitest run             # >= 2618 across >= 74 files, plus your new cases
npm run grep:secrets       # clean, 6 patterns
git diff -- package.json   # MUST BE EMPTY
```

### Counter gates — measured with the TypeScript AST, never a grep

The array holds template literals and the channel map holds comments, so a grep is wrong on both.

```powershell
# MIGRATIONS: 20 -> 21
node -e "const ts=require('typescript'),fs=require('fs');const p='src/main/services/storage.ts';const sf=ts.createSourceFile(p,fs.readFileSync(p,'utf8'),ts.ScriptTarget.Latest,true);let i=null;const w=n=>{if(ts.isVariableDeclaration(n)&&n.name.text==='MIGRATIONS')i=n.initializer;ts.forEachChild(n,w)};w(sf);console.log('MIGRATIONS.length =',i.elements.length)"

# IpcChannel: 107 -> 108
node -e "const ts=require('typescript'),fs=require('fs');const p='src/shared/ipc.ts';const sf=ts.createSourceFile(p,fs.readFileSync(p,'utf8'),ts.ScriptTarget.Latest,true);let i=null;const w=n=>{if(ts.isVariableDeclaration(n)&&n.name.text==='IpcChannel')i=n.initializer;ts.forEachChild(n,w)};w(sf);while(i&&(ts.isAsExpression(i)||ts.isSatisfiesExpression(i)))i=i.expression;console.log('IpcChannel keys =',i.properties.filter(p=>ts.isPropertyAssignment(p)).length)"

# both assertions moved together — expect two hits, both 108
Select-String -Path src/shared/ipc.test.ts -Pattern "toHaveLength\(10[789]\)"

grep -c "sqliteTable(" src/main/db/schema.ts    # 19, unchanged
```

### Structural gates — paste the output, do not summarise it

```powershell
# the FIELD `tool_name` is read in exactly ONE place (`readToolName`) and named in
# prose in the two amended docblocks. EVERY OTHER HIT IS A DEFECT.
Select-String -Path src -Include *.ts -Pattern "tool_name" -Recurse

# and the READ VALUE reaches only the four classifiers. Every hit must be a call to
# one of them; a field assignment, a template literal or a logger call is the limit
# being crossed.
Select-String -Path src -Include *.ts -Pattern "readToolName" -Recurse

# Bash is NOT in the pass/fail set — read the set's declaration and the shell set's,
# and confirm isShellTool never touches firstExploreOrdinal
Select-String -Path src/main/services/agentEventsCore.ts -Pattern "EXPLORATION|SHELL|ToolSearch|Bash"
Select-String -Path src/main/services/agentEvents.ts -Pattern "firstExploreOrdinal|firstShellOrdinal|firstUnknownOrdinal"

# five columns, five ALTERs, one migration entry
Select-String -Path src/main/services/storage.ts -Pattern "ADD COLUMN memory_"

# D173's two words are in the SENTENCE, not just in a document
Select-String -Path src/shared/provenance.ts -Pattern "successful memory read|Claude Code session"

# the header amendment landed
Select-String -Path src/main/services/agentEvents.ts -Pattern "classified and discarded"

# nothing in adapters/ changed; nothing outside the Exact Scope list changed
git diff --stat
```

### ⚠ Runtime drive — the task is not done until this has been OBSERVED, not compiled

**Environment notes for this machine, so you do not lose an hour:**

- Use the **dev** build (`npm run dev`), not the installed `Chorus.exe` on `%APPDATA%\chorus-app`. The
  installed instance self-isolates in code since 0.1.2. **⚠ KILL THE DEV ONE BY COMMAND LINE
  (`*9222*`), NEVER BY PROCESS NAME** — killing by name takes out Matthew's real instance and its
  database. Note that **`Win32_Process` CommandLine filters match themselves**: filter by `Name` +
  `CreationDate`, and compare argv **lengths** across control cases.
- Prefer **CDP on `--remote-debugging-port 9222`** over user32 automation for reading the DOM.
  **⚠ CDP keystrokes are invisible to Chromium's native paste and to the OS idle timer**, and assigning
  `.value` on a Vue `v-model` input leaves the model empty unless you also dispatch an `input` event —
  a harness bug that looks exactly like an app bug.
- The dev DB is `%APPDATA%\chorus\chorus.db`. **WAL, ABI and five-files — see Step 1(4).**

**Step 0 — the container.** `docker ps -a --filter name=chorus-g2-neo4j --format '{{.Status}}'`. It was
**Up** at authoring; if Exited, `docker start chorus-g2-neo4j` and **wait for bolt, not for TCP** —
F93 measured `docker start` returning in 358 ms and TCP accepting at 2 ms while **bolt was not ready
until 4.3 s**. **Leave it running.** ⚠ **Never `docker volume prune`** — remove only what you made, and
this task makes nothing.

**Step 1 — the memory-configured project.** Open the **Chorus** project in the dev app (the dev DB's
one `project_memory` row: `bolt://127.0.0.1:7688`, mode `existing`, auth `none`). Launch a **claude**
pane.

**Step 2 — the graph call.** Prompt the pane to use the `chorus-memory` read tool. **⚠ NAMING THE
GRAPH IN THE PROMPT IS ALLOWED FOR THIS DRIVE** — 6b-1 proves the *instrument*, not adoption; the
milestone's unnamed-prompt run belongs to 6b-3. **Capture the prompt verbatim.**

**Step 3 — (a) THE LIVE COUNTER.** Read the card's `.card-foot` (screenshot, or CDP
`document.querySelector(...).textContent`). It must show the reads count beside the context ring, and
it must have been **absent** — not zero — before the first call. **Capture both states.**

**Step 4 — (b) THE ROW.** Copy `chorus.db` **plus `-wal` plus `-shm`**, then read the copy under
Electron-as-node. Print `SELECT version, applied_at FROM schema_migrations ORDER BY version DESC
LIMIT 3` and the session's `id, agent, created_at, memory_reads, memory_writes, memory_read_first,
memory_read_inconclusive, memory_shell_first`. **Paste the exact output.** `version 21` must be present
with a real `applied_at` — **that day is the date the aggregate quotes, so (b) and (c) must agree on it.**

**Step 5 — (c) THE AGGREGATE.** Project Settings → Memory → *Count sources*. **⚠ PASTE THE RENDERED
LINE VERBATIM, INCLUDING THE WORDS `successful` AND `Claude Code`.** A screenshot reading
*"12 reads · 3 writes across 4 sessions"* is a **FAILED STEP, not a formatting nit** — both dropped
qualifications are claims the instrument cannot support. The lower-bound disclosure must be visible,
the breakdown line must render, the numbers must match (b), and **you must be able to say in one
sentence exactly which sessions K counts and why.**

**Step 6 — (c') THE DENOMINATOR'S CONTROL CASE — the ONLY place the `agent` filter is provable.** In
the **same** project, launch a **codex** pane, let it do ordinary work, exit it, and re-open Project
Settings → Memory. **K must be UNCHANGED and so must every sum. Record K before and after.** This
cannot be a unit test, because `storage.ts` does not load under Vitest. If K moves, the filter is
missing or the label is lying.

**Step 7 — THE NEGATIVE DRIVE.** Produce a `PreToolUse`-only sequence — deny the tool when the pane
asks, or set the pane's permission mode so the memory tool is refused. **Nothing may move, in the UI or
in the row.** Do the same for a `PostToolUseFailure` (a deliberately broken Cypher): **it must not
count as a read.** If Step 1's probe B already produced either shape, that capture counts and can be
cited rather than repeated.

**Step 8 — THE NAME CHECK AT RUNTIME.** `Select-String` the app's log over the whole drive for
`mcp__chorus-memory__` **and** for the built-in tool names: **zero hits.**

**Save everything under `_verify/6b-1/`. Leave the container running.**

---

## Failure honesty

If a verification command fails for an unrelated environment reason, **capture the exact output,
explain it, and do not claim success.** A gate you could not run is reported as **NOT RUN** — never as
passed, never silently omitted. **A drive that did not run is not a drive that passed.**

**Seven false-green traps this repo has already produced, all real:**

- A missing toolchain makes `npm run typecheck` fail with `'tsc' is not recognized`, which contains no
  `error TS`. **Check exit codes.**
- **A passing unit test says nothing about runtime.** On this task the gap is structural: `storage.ts`
  cannot be unit-tested at all, so the aggregate's arithmetic and the `agent` filter are proved
  **only** by steps (b), (c) and (c').
- **A hook body you did not receive is not a count.** A `--settings` file whose paths contain
  backslashes loads **no hooks at all**, silently — the probe looks like a negative result and is not.
- **A DB read that skipped the WAL files can miss everything the drive just wrote** — and on a machine
  with five `chorus.db` files, reading the wrong one looks identical to a feature that does not work.
- **CDP keystrokes are invisible to native paste and to the OS idle timer**, and a `v-model` set through
  `.value` alone leaves the model empty.
- **`Win32_Process` CommandLine filters match themselves.**
- **A green suite over a mis-placed counting block is the specific failure this task is most likely to
  ship**: a count taken after `record()`'s edge filter reports 1 for 20, and every test written against
  the counter's own API passes. **Prove it behaviourally, both ways** (twenty memory reads → `reads === 20`
  with **one** `onActivity`; twenty `Read`s → twenty internal ordinals with **zero** `onMemoryUsage`).

If the runtime drive cannot be completed (Docker down, ABI mismatch, locked DB, the agent will not
call the tool), report **`DONE_WITH_CONCERNS`** or **`BLOCKED`** with the evidence, and say **exactly
which of steps 0–8 was reached.**

---

## Final report — required structure

1. **Status:** `DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED`.
2. **Gate 0:** what `git status --porcelain` actually showed, and whether the kickoff documents were
   dirty or already committed. Anything beyond the thirteen, listed and untouched.
3. **CLI + hook probes — the ACTUAL output:** `claude --version`; `codex --version`; the `PostToolUse`
   body-key dump; the **`PostToolUseFailure`** body-key dump **with its `error` key confirmed** (the
   fact the word *successful* rests on); the `ToolSearch`-before-MCP ordering (F92) confirmed or
   refuted; **the full list of built-in tool names you measured, and which name seeded which of the
   three sets** — exploration, shell, known-but-not-exploration.
4. **v21 verified free three ways**, with the numbers pasted: the AST count, the sibling-ref sweep, and
   both databases' `MAX(version)` — **naming which `chorus.db` path you read and how you knew it was
   the live one.**
5. **Files changed**, with a one-line reason each.
6. **Build results:** typecheck exit code; vitest counts **before and after** (baseline **2618 / 74
   files**); `grep:secrets` status; `git diff -- package.json` empty.
7. **Counter confirmations:** `IpcChannel` **108** (AST), `MIGRATIONS.length` **21** (AST),
   `sqliteTable(` **19**, `LATEST_GRAPH_VERSION` **2**, runtime deps **9**, `sessions` columns **19**,
   and **both** `toHaveLength` assertions moved (`ipc.test.ts:3510` and `:3897`).
8. **Structural greps — paste the output:** the single `tool_name` reader; every `readToolName` use
   site; `Bash` absent from the exploration set with its reason in the file; `isShellTool` never
   touching `firstExploreOrdinal`; the five `ADD COLUMN memory_` statements in one entry; `successful`
   and `Claude Code` present in `shared/provenance.ts`; the amended `agentEvents.ts` header; and
   `git diff --stat` showing **nothing under `src/main/adapters/`**.
9. **Runtime results — what was ACTUALLY observed at each of steps 0–8:** the verbatim prompt; the live
   counter before and after; **the five column values**; **the verbatim aggregate line and the verbatim
   breakdown line**; the lower-bound disclosure as rendered; **K before and after the codex control
   case**; the negative drive's result for both the `PreToolUse`-only and the `PostToolUseFailure`
   sequences; the log grep's hit count. **Name any step not reached and why.**
10. **One sentence saying exactly which sessions `K` counts**, and why each of the three predicates is
    there.
11. **Review outcomes:** spec-compliance findings clause by clause, and code-quality findings, and how
    each was resolved. **Say explicitly whether the counting block's position was verified by reading
    `handle()` top to bottom, and whether the three ordering outcomes were proved disjoint.**
12. **Corrections confirmation:** which of the five items in *Corrections and cross-references* you
    confirmed against the tree, and any sixth you found.
13. **Non-goals confirmation:** no `tool_input` / `tool_response` / prompt read anywhere; no change to
    the `-o NUL` hook entry; no `:AgentSession`; no nudge; no `instructionsCore.ts` or contract change;
    no new renderer route; no new dependency; no `storage.test.ts`; nothing under `src/main/adapters/`.
14. **Residual risks and new findings, phrased for 6b-2** — which edits `src/main/ipc.ts` and
    `src/shared/ipc.ts` next, gives `withMcpEnv` a fifth `sessionId` parameter, moves
    `renderInstructionsFor` into `instructionsCore.ts`, and moves `IpcChannel` **108 → 109**. Anything
    you found and deliberately did not fix belongs here so 6b-2 inherits it rather than rediscovering
    it. **Next free numbers if you need to record one: D174 / F94.**
15. **Final `git status`** — the Gate 0 entries still present and untouched — and **the commit hash**.
