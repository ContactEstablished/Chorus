# Task 10.2-4 — The `find_callers` template, and the measurement that decides the tier

**Phase:** Engine 10.2 — Code index: the symbol layer
**Status:** authored 2026-09-13, unexecuted
**Estimated:** ~1 day to ship the two lines · ~1 day to run the battery

---

## Source Of Truth

- `docs/Features/Engine/Tasks/Phase-10.2-Overview.md` — the phase contract and its six inherited gates
- `Tasks/Task-10.2-3.md` + its spec — the extractor whose output these templates read
- `docs/Features/Foundation/roadmap.md` — **D148** (codex is told things through
  `developer_instructions`), **D198** (codex only), **D200**/**D201** (the spike, and the limits of
  its evidence), **D203**, **D205**, **D208**, **F122**, **F124**, **F125**, **F126**, **F127**,
  **F130**
- Code under change: `src/main/adapters/instructionsCore.ts` and its test

---

## Initial Starting Point (verified 2026-09-13 at `b0a1291`)

| fact | value | how it was verified |
|---|---|---|
| contract | **21 lines · 5,017 chars ≈ 1,254 tokens**, on every codex launch | parsed from `instructionsCore.ts` |
| delivery | one `-c developer_instructions=` token (**D148**); contract is ~67% of codex's 7,438-char argv | `codex.ts:150-159`, measured argv |
| template lines today | **6**, averaging **321 chars** | parsed |
| ⚠ every line must be **one physical line** | `assertSingleLine` throws on `\r` or `\n` | `instructionsCore.ts:216-219` |
| pinned line-count test | `expect(lines).toHaveLength(21)` | `instructionsCore.test.ts:56` |
| graph schema | **v3 live**, `:Symbol` + `CALLS`/`REFERENCES`/`DEFINED_IN` | `11299bf`, verified on the live graph |
| `:Symbol` count | **0** | `MATCH (s:Symbol) RETURN count(s)` |

---

## ⚠ THE BLOCKING DEPENDENCY, AND IT IS NOT A FORMALITY

**10.2-4 cannot run until 10.2-3 is EXECUTED *and* an index has populated `:Symbol`.**

`FIND CALLERS` reads `:Symbol` and `CALLS`. Today both are empty. A template that answers **zero
rows** is exactly **F122**'s failure: the agent tries once, gets nothing, and learns the feature is
broken — and the adoption number measured in that state is meaningless. ⚠ **A run in that state is
VOID, not negative**, which is the same distinction that made the 10.2-1 spike worth anything.

**Gate:** `MATCH (s:Symbol) RETURN count(s)` must be non-zero before either arm of the battery runs.

---

## Goal

Ship **two contract lines** — a trigger line and the `FIND CALLERS` template — and then **measure
whether they change codex's behaviour**, with the control arm D200 and D201 never had.

---

## Decisions

**D209 (SETTLED 2026-09-13, Matthew): `find_callers` only, two lines.** Not `find_references`, not
`impact_of`. Contract **21 → 23** (+~520 chars, **+130 tokens on every codex launch**). This is the
question the tier is sold on; the other two ship only if this one is used. ⚠ **The cost is paid by
every session whether or not the template is used, in a phase whose purpose is reducing tokens** —
which is precisely why the smallest attributable change is the right one.

**D210 (SETTLED 2026-09-13, Matthew): the template DISCLOSES ITS OWN UNCERTAINTY IN THE RESULT.** It
returns `r.resolution AS confidence` and orders confident callers first, rather than silently hiding
ambiguous ones.

⚠⚠ **THIS SUPERSEDES THE READ-SHAPE HALF OF D208.** D208(c) said the reader *"filters
`r.resolution = 'unique'` by default"*. It does not. **D208's write-side half stands** — every edge
still carries `resolution`, and that is what makes D210 possible at all. Recorded explicitly because
a reader of D208 alone would write the wrong template.

- **Why:** filtering silently makes `find_callers('dispose')` return 4 of 10 callers as though that
  were the whole answer. Labelling lets the agent see both buckets and decide.
- ⚠ **What it costs:** a careless agent may read an `ambiguous` row as fact. The trigger line does
  not warn about this — deliberately, because warning about reliability in the same breath as asking
  for adoption would contaminate the very thing being measured (F130's 37.7%).

**D211 (SETTLED 2026-09-13, Matthew): adoption is measured with a fixed task battery, both arms.**
The same N questions asked with the templates absent and present. ⚠ **Both arms must run against a
POPULATED index** — otherwise the control differs by two variables (no template *and* no data) and
the comparison measures nothing.

---

## Exact Scope

**Edit:**
- `src/main/adapters/instructionsCore.ts` — two lines in `memoryContractLines`.
- `src/main/adapters/instructionsCore.test.ts` — line count 21 → 23, plus the template's own cases.

**Create:**
- `_verify/10.2-4/` — the battery's questions, its runner, and its raw rollout evidence.

**Touch nothing else.** No graph change, no extractor change, no UI change.

---

## Non-Goals

- ❌ **No `find_references`, no `impact_of`** (D209). They ship only if `find_callers` is used.
- ❌ **No new MCP tool** — `chorus-memory` is third-party and Chorus does not own its tool list
  (**F124**). Chorus ships prose carrying Cypher.
- ❌ **No claude delivery** (D198).
- ❌ **No graph migration, no extractor change.** `GRAPH_MIGRATIONS` stays at length 3.
- ❌ **No commanding phrasing.** *"You must use the graph"* buys a call that measures obedience, not
  adoption, and would not transfer (D200(e)).
- ❌ **Do not revert, stage or commit the pre-existing dirty files:** `package.json`,
  `package-lock.json` (**both staged**), `TerminalPane.vue`, `.claude/`, `.procoder/`.

---

## Dependencies

- **10.2-2** ✅ landed (`11299bf`).
- **10.2-3** ⚠ **authored but NOT EXECUTED.** This task is blocked on it, and on an index run.
- ⚠ **`chorus-memory` has `RestartPolicy=no`** (F122). Prove it is up, and say so in the report.

---

## Step-by-step Work

1. **Add the two lines**, matching the measured phrasing shape: lead with the **trigger situation**,
   name the command being replaced, do not command.
2. **Update the pinned test** 21 → 23, with a comment saying why — as the 19 → 21 change did.
3. **Populate the index** (10.2-3 executed, then a user-initiated index run). Confirm non-zero.
4. **Run the control arm** at the commit *before* the two lines, against the populated index.
5. **Run the treatment arm** at the commit *after*, same questions, same index, same day.
6. **Read both arms on INNER invocations** (F125), with a repo filter that matches worktrees (F126).

---

## Test Expectations

- The contract is **23** lines, and the two new ones are **single physical lines** (`assertSingleLine`).
- The trigger line leads with the situation and **contains no imperative to use the graph**.
- The template is **parameterised** (`$wid`, `$name`) — never interpolated.
- ⚠ The template filters `r.lastIndexedAt = s.lastIndexedAt` and **never** `p.lastIndexedAt` (**F127**).
- ⚠ The template **returns** `r.resolution` and does **not** filter it out (**D210**), and orders so
  that confident callers come **first**.
- ⚠ A test saying out loud that both lines come back out if the tier is dropped — a spike instrument
  that quietly becomes permanent is a real failure mode.

---

## Verification Commands

```bash
npm run typecheck
npx vitest run
npx vitest run src/main/adapters/instructionsCore.test.ts
docker ps --filter name=chorus-memory --format '{{.Names}} {{.Status}}'
```

```cypher
MATCH (s:Symbol) RETURN count(s)        -- MUST be non-zero before the battery
```

⚠ **Before reading any arm's result, prove the contract reached that session** — the check that made
the 10.2-1 spike count, and whose absence would make a negative indistinguishable from a void run:

```powershell
(Get-CimInstance Win32_Process -Filter 'ProcessId=<pid>').CommandLine -like '*FIND CALLERS*'
```

---

## Acceptance Criteria

- [ ] Contract is **23** lines; both new lines are single physical lines
- [ ] Template parameterised, filters on the callee's own stamp, returns `resolution`
- [ ] `:Symbol` count non-zero in **both** arms
- [ ] Contract delivery verified in argv **per session**, before any result is read
- [ ] Both arms measured on **inner invocations**, with a worktree-matching repo filter
- [ ] The result is reported with its **n**, and with what it does *not* establish
- [ ] Pre-existing dirty files untouched

---

## Review Checklist

1. Does the trigger line command, or describe a situation? Commanding invalidates the measurement.
2. Does the template filter `resolution` out? It must not (D210) — and does it order confident first?
3. ⚠ Did both arms have a populated index? If the control ran empty, the comparison is void.
4. Was contract delivery confirmed per session *before* the result was read?
5. Was the sweep run on **inner** `tools.*()` invocations, not outer `exec` calls (F125)?
6. ⚠ Does any gate match the prose documenting its own rule? Six have landed (F120, F123, F128).
7. Is the reported number honest about n, and about the absence of anything it did not test?
