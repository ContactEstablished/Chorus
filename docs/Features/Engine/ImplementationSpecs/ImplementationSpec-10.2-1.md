# Implementation Spec 10.2-1 — the adoption spike

Companion to `Tasks/Task-10.2-1.md`. The exact template, the phrasing rule and why it is the
variable under test, how to run codex without contaminating the result, and how to read the answer
out of its own records. Every line number was read at `3cae586` on 2026-09-13.

---

## Why a spike at all, in one paragraph

Codex spends **20.9%** of its tool calls searching (8,270 of 39,604, `rg` dominant) and has called
the memory server **zero** times. Taken alone that reads as a settled negative. It is not: the
server config reaches codex in **146** rollouts while the contract reaches **3**, and the
trigger-situation line reaches **0**. The intervention the spec wants to reuse has never been
applied to this agent. ⚠ **So the cheapest honest thing is to apply it once and look** — one
template, one line, one run — rather than spend ~7 days building an index behind an unanswered
question.

## 1. Find the delivery gap first

`renderInstructionsFor` is called at `ipc.ts:1085`; `memoryContractLines` at
`instructionsCore.ts:196`. Something upstream gates it — most plausibly memory being configured for
the project, since the contract is meaningless without a graph.

⚠ **This step can end the task on its own, and that is a good outcome.** If the contract reaches 3
of 146 codex sessions because it is only written when memory is configured, and memory is rarely
configured, then **the tier's ceiling is set by configuration, not by phrasing** — and no amount of
symbol indexing changes that. Report the cause before touching the phrasing.

## 2. The template

Over data that already exists — **607 `:File` nodes**, keyed `(:File {workspaceInstanceId,
relPath})`, `relPath` repository-relative with forward slashes. No parser, no migration.

```
FIND A FILE: MATCH (f:File {workspaceInstanceId: $wid}) WHERE toLower(f.relPath) CONTAINS toLower($needle) RETURN f.relPath AS path ORDER BY size(f.relPath) LIMIT 20
```

- **Parameterised**, like every existing template — `PASS EVERY VALUE AS A PARAMETER` is already a
  contract line and the reason is already written down there.
- `ORDER BY size(f.relPath)` puts the shallowest match first, which is almost always the one meant.
- `$wid` is already supplied to the contract (`ctx.workspaceInstanceId`) and already documented as
  correct-for-this-session, so the template adds **no new context the agent must derive**.

⚠ **It must be genuinely better than `rg` for its trigger, or a negative result means nothing.** It
is: one round trip, whole-repo, no output to wade through, and no working-directory subtleties. If
the honest comparison were "about the same", the spike would be measuring novelty rather than value.

## 3. The phrasing — the variable actually under test

The spec asks to reuse the 2026-08-30 `project-memory` result: **same model, same prompt, a
description-only change flipped a tool from never firing to firing first**, by leading with the
*trigger situation* rather than the *subject noun*.

```
✗ SUBJECT-NOUN:      "A file index is available through the memory graph."
✓ TRIGGER-SITUATION: "When you need to find where something lives in this repository — before
                      running rg, ls or a directory walk — ask the graph instead: it answers from
                      an index of every tracked file, in one round trip."
```

⚠ **Do not smuggle an instruction to obey into the phrasing.** "You MUST use the graph" would
produce a call that measures compliance, not adoption, and the number would not transfer to the real
tools in 10.2-4. The existing `READ BEFORE EXPLORING` line is the right register: it says *when*,
and leaves *whether* to the agent.

⚠ **One line.** `assertSingleLine` (`instructionsCore.ts:214`) already enforces it, and codex's
`config-override` mechanism renders the contract one line per entry.

## 4. Running codex without contaminating the result

- Launch a **codex** pane through Chorus in this repo, so the real delivery path is exercised. A
  hand-run `codex` outside Chorus proves nothing about what Chorus delivers.
- ⚠ **The task text must never mention the graph, the index, Cypher or the memory server.** Ask for
  something whose natural first move is a repo-wide search — *"where is the launch-options
  composition defined, and what calls it?"* is realistic, on-topic for this repo, and exactly the
  shape `find_callers` would later serve.
- ⚠ **Read-only.** The pane is in the real repository: the prompt must ask it to report, not to
  edit. Check `git status` afterwards regardless.
- ⚠ **Kill the pane and the dev instance by `Name='electron.exe'` AND
  `*remote-debugging-port=9222*`**; a bare `*9222*` also kills Chrome renderers and the querying
  shell. Snapshot live `claude.exe` pids first — a probe that kills the session driving it has
  happened here before.

## 5. Reading the answer

Codex writes rollout records to `~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-*.jsonl`. The shape,
measured rather than assumed: `{type: 'response_item', payload: {...}}`, where a tool call is
`payload.type` of `function_call` (with `name` + `arguments`), `local_shell_call` (with `action`), or
`custom_tool_call`. `session_meta` carries `cwd`.

Count, for the spike session only:

- calls whose `name` matches `read_neo4j_cypher`
- calls whose arguments match `\b(rg|grep|findstr|Select-String|ast-grep)\b`
- **the ordinal of the first of each** — "it eventually queried the graph after grepping four times"
  is a different result from "it queried first", and the second is the one the tier needs.

⚠ **Do not count from the pane's rendered screen.** Codex redraws, wraps and truncates; the rollout
is the record.

## 6. What each outcome means

| observed | reading | what to do |
|---|---|---|
| graph query **first**, no shell search | adoption works on this trigger | proceed to 10.2-2, report n=1 and its limits |
| graph query **after** shell searches | partial — the contract is read but loses to habit | report; 10.2-4's phrasing work becomes the risk |
| **no** graph query, shell search only | the intervention did not take | ⚠ **recommend closing the tier**; record the finding |
| contract **not delivered** to the run | the gap in §1 was not fixed | ⚠ **not a result at all** — fix delivery and re-run |

⚠ **The fourth row is the trap.** A run where the contract never arrived looks exactly like a
negative result and is worthless. **Verify the contract text is present in the spike session's own
rollout before reading anything into the counts** — grep that rollout for a distinctive phrase from
the new line. This is F121 applied to the experiment itself: prove the instrument delivered a
positive before believing its negative.

## 7. Verification

- `npx vitest run src/main/adapters/instructionsCore.test.ts` — the new line, single-line,
  parameterised, line count moved deliberately.
- `npm run typecheck` → 0; full suite ≥ **95 files / 3303 tests**.
- `GRAPH_MIGRATIONS` still parses to **2**; `package.json` runtime deps still **9**.
- `docker ps --filter name=chorus-memory` shows **Up** before the run, recorded in the report.
- `git status --porcelain` shows only `instructionsCore.ts`, its test, and the pre-existing dirty
  set — the codex pane must have edited nothing.
- ⚠ The report states **n**, names which outcome row above was observed, and — if negative —
  recommends against the remaining tasks rather than proposing a stronger prompt.
