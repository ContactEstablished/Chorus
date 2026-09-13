# Task 10.2-1 — Adoption spike: will codex query the graph instead of grepping?

**Phase:** Engine 10.2 · **Depends on:** None (10.1-5 cleared D199's gate) · **This task is a GATE**
**Owns:** `src/main/adapters/instructionsCore.ts` (one added template + one trigger line), its test,
and `_verify/codex-adoption-spike/`

---

## Source Of Truth

- `docs/Features/Engine/Tasks/Phase-10.2-Overview.md` — the measured ground facts, especially
  §2.2 (the contract reaches codex in 3 of 146 sessions) and §2.3 (there are no "new MCP tools").
- `docs/Features/Engine/chorus-engine-spec.md` §5 Phase 10.2 — the tier this gate protects, and the
  2026-08-30 phrasing result it asks to reuse.
- `src/main/adapters/instructionsCore.ts:117` `memoryContractLines` — **the whole delivery
  mechanism**: named Cypher templates in contract prose, run through the server's generic
  `read_neo4j_cypher`.
- **D198** (codex-only), **D196** (content never leaves), **F120/F121** (gates that match themselves;
  instruments that must see a positive first).

## Initial Starting Point (verified 2026-09-13 at `3cae586`)

- ✅ `memoryContractLines` returns **19 lines** today (AST-counted, not eyeballed); the templates are named inline (`READ:`,
  `WRITE (cited to a file):`, `SUPERSEDE (never delete):`), and the trigger line is
  `READ BEFORE EXPLORING: before your first Read, Glob or Grep on a topic…`.
- ✅ codex declares `instructions: { mode: 'static', mechanism: 'config-override' }`
  (`codex.ts:123`), so it **can** receive a contract. claude uses
  `append-system-prompt-file`; `opencode`, `grok`, `kimi` and `shell` are all `instructions: null`.
- ⚠ **Measured: codex receives the SERVER in 146 rollouts and the CONTRACT in 3.** `READ BEFORE
  EXPLORING` appears in **0**. Zero adoption is **absence, not refusal**.
- ✅ codex's search appetite, from its own rollouts: **8,270 search-like shell calls, 20.9% of
  39,604 tool calls** (`rg` 7,301 · `Select-String` 878 · `grep` 73 · `findstr` 18).
- ✅ The graph is up (restarted 2026-09-13) with **607 `:File`** nodes keyed
  `(:File {workspaceInstanceId, relPath})` — enough to answer a file-location question **with no
  index and no parser**.
- ⚠ `chorus-memory` has **`RestartPolicy=no`** and was down five days unnoticed. Check it is up.

## Goal

Find out, for the cost of one contract template and one live run, whether codex will use a graph
query in the situation where it currently reaches for `rg`. **If it will not, Phase 10.2's remaining
~7 days are not worth spending, and this task says so and stops.**

## Exact Scope

1. **Make the contract actually arrive.** Establish why it reaches 3 of 146 codex sessions and fix
   that if the fix is small. ⚠ **This may be the entire result of the task** — a tier cannot be
   judged on an instruction nobody received.
2. **Add ONE template to `memoryContractLines`**, backed by data already in the graph:
   a file-location lookup over `:File`. No parser, no migration, no new node type.
3. **Give it trigger-situation phrasing**, per the 2026-08-30 A/B: lead with *when you need this*,
   not with *what this is*.
4. **Run codex at a real task** in this repo that would normally start with `rg`, and read its own
   rollout record to see which it chose.
5. **Report the choice, not an impression.**

## Non-Goals

- **No parser, no `typescript` promotion, no graph migration, no `:Symbol` node.** The spike parses
  nothing and migrates nothing; `GRAPH_MIGRATIONS` stays at 2 and runtime deps stay at 9.
- **No Chorus-owned MCP server** — §2.3 of the overview: not needed, and not possible cheaply.
- **No claude changes** (D198). The contract line is added on codex's path.
- **No rewrite of the existing memory templates.** Agents may already rely on them; this ADDS one.
- **No UI.**
- Do not revert or commit the pre-existing dirty files (`package.json`, `package-lock.json` — both
  **staged** — `TerminalPane.vue`, `.claude/`, `.procoder/`).

## Dependencies

None. D199's gate was cleared by Task 10.1-5 on 2026-09-13.

## Step-by-step Work

1. **Check the graph is up** (`docker ps --filter name=chorus-memory`) and start it if not. Record
   which, because a spike run against a dead graph proves nothing.
2. **Find the delivery gap.** Trace `renderInstructionsFor` (`ipc.ts:1085`) and whatever gates it —
   most likely memory being configured for the project. ⚠ **Report the cause even if the fix is out
   of scope**, because it bounds every adoption number this phase will ever produce.
3. **Write the template.** Over `(:File {workspaceInstanceId, relPath})`, parameterised, `LIMIT`ed,
   in the style of the existing `READ:` line. It must be genuinely *better* than `rg` for its
   trigger — instant, whole-repo, no output to wade through — or a negative result is uninformative.
4. **Write the trigger line.** ⚠ Lead with the situation: *"When you need to find where something
   lives in this repository, before running rg or ls…"* rather than *"A file index is available…"*.
   The 2026-08-30 result is that this phrasing difference alone flipped a tool from never firing to
   firing first — **same model, same prompt, description-only change**.
5. **Run it.** Launch a codex pane in this repo through Chorus, give it a task whose natural first
   move is a repo-wide search, and let it work. ⚠ **Do not tell it to use the graph** — an instructed
   call measures obedience, not adoption.
6. **Read its rollout.** Count, in that session's `~/.codex/sessions/**/rollout-*.jsonl`:
   `read_neo4j_cypher` calls versus `rg`/`Select-String`/`grep`/`findstr` shell calls, and **which
   came first**.

## Test Expectations

One unit test in `instructionsCore.test.ts`: the new line is present, is a single line
(`assertSingleLine` already guards this), parameterises its inputs rather than interpolating them,
and the contract's line count assertion moves deliberately rather than silently.

⚠ **No test can tell you whether codex adopts it.** That is the whole point of the run, and it is
why this task exists rather than being folded into 10.2-4.

## Verification Commands

```bash
npx vitest run src/main/adapters/instructionsCore.test.ts
npm run typecheck
npx vitest run
git diff --stat
docker ps --filter "name=chorus-memory" --format "{{.Names}} {{.Status}}"
```

**Expected:** typecheck 0 · suite **≥ 95 files / 3303 tests** · `GRAPH_MIGRATIONS` still **2** ·
runtime deps still **9** · `git diff --stat` limited to `instructionsCore.ts` and its test.

⚠ Measure codex from **`~/.codex/sessions`**, never from `~/.claude/projects` — different corpora,
different shapes, and this phase serves codex alone.

## Acceptance Criteria

- The contract-delivery gap is **explained**, and fixed if the fix was small — with the reason
  recorded either way.
- The template and its trigger line ship, are single-line, parameterised, and tested.
- A codex session ran in this repo, unprompted about the graph, on a task that would normally start
  with a repo-wide search.
- Its rollout record is read and reports **counts**: graph queries vs shell searches, and which came
  first.
- ⚠ **A NEGATIVE RESULT CLOSES THE PHASE AND IS A SUCCESS FOR THIS TASK.** If codex shells out
  anyway, say so plainly, record it as a finding, and recommend against the remaining ~7 days. Do
  **not** retry with progressively stronger instructions until it complies — that measures how hard
  you pushed, not whether the tier works.
- ⚠ Equally, **one positive run is not proof**. Report n, and say what a single observation can and
  cannot support.

## Review Checklist

- [ ] The run was unprompted about the graph — the task text never named it.
- [ ] Counts come from codex's own rollout, not from an impression of the session.
- [ ] The template is parameterised; no value is pasted into Cypher.
- [ ] `GRAPH_MIGRATIONS` is still 2, runtime deps still 9, no parser was added.
- [ ] The contract-delivery gap is explained, not merely worked around for the one test session.
- [ ] The report states n, and does not present one run as a measurement.
- [ ] A negative result is reported as a finding and a recommendation, not as a failure to fix.
