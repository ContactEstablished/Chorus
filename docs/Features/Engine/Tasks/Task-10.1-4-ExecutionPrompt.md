# Task 10.1-4 — Execution Prompt (paste into a fresh session)

You are the **Coordinator** for **Task 10.1-4 — The usage panel: four numbers and the gap between
them**, the last task of Engine Phase 10.1 and the one that makes the phase ship value.

**Repo root:** `C:\Projects\ContactEstablished\Chorus`
**Expected branch:** `main`, at **`f1976b5`**. Confirm with `git branch --show-current` and
`git log --oneline -1`. **Do not switch branches.** All three dependencies have landed and are pushed:
`f76770b` (10.1-1), `2530a98` (10.1-2), `0ef5fd9` (10.1-3), `f1976b5` (the docs).

---

## ⚠ GATE 0 — READ THIS FIRST: THIS TASK'S SCOPE IS WIDER THAN ITS OWN TASK DOC SAYS

`Task-10.1-4.md` lists "no new IPC channel — 10.1-3 owns `shared/ipc.ts` and `main/ipc.ts`" as a
non-goal, and `ImplementationSpec-10.1-4.md` §"What 10.1-3 must carry" says *"If its payload differs
this task changes to match; no renderer arithmetic."*

⚠ **THE PAYLOAD DOES DIFFER, AND "CHANGING TO MATCH" WOULD GUT THE TASK.** 10.1-3 shipped a live,
per-session, transcript-scanned ledger:

```ts
EngineLedgerTotals { ce, rlit, naive, outputTokens, entries, files, subagentFiles,
                     cacheBreakdownMismatches }   // every field a NON-NULL number
EngineLedgerEvent  { sessionId, ledger }
```

Against what this task needs, four gaps, none cosmetic:

| needed | shipped | consequence if ignored |
|---|---|---|
| `number \| null` per metric | non-null numbers | **cannot express "unknown"** — an unmeasured session renders **0**, claiming it was free |
| `agent: string`, `hasSource` | no agent field | cannot render the `no-source` row; `voice`/`grok`/`opencode` look broken |
| per-metric `main`/`subagent` | `subagentFiles`, a FILE count | cannot show "subagents were 61% of CE" — the headline finding |
| project scope + dispatch counts | flat live-session list | cannot show "N of M dispatches carry token data" |

✅ **RESOLVED BY MATTHEW, 2026-09-12: WIDEN THE PAYLOAD AS PART OF THIS TASK.** 10.1-4 therefore
edits `shared/ipc.ts`, `main/ipc.ts`, `engineLedger.ts` and `storage.ts` as well as the renderer, and
the non-goal quoted above is **superseded**. The reason is D-a: rendering an unmeasured session as 0
is the one failure both documents forbid, and every other option preserves it.

✅ **Good news that halves the work:** `engineLedgerCore.scanLedger` ALREADY returns
`{ total, main, subagent }` (`engineLedgerCore.ts:491-493`). 10.1-3 simply did not carry the split
through. You are exposing a value that already exists, not computing a new one.

---

## ⚠ GATE 1 — PRE-EXISTING DIRTY TREE. DO NOT REVERT, STAGE, OR COMMIT THESE

```
MM package-lock.json     <- ALREADY STAGED before you started; leave the index alone
MM package.json          <- ALREADY STAGED before you started; leave the index alone
 M src/renderer/src/components/TerminalPane.vue
?? .claude/
?? .procoder/
```

⚠ `package.json` / `package-lock.json` are **staged**, not merely modified — unstaging them discards
a staging intent that is not yours. Commit by naming your files: `git commit -F <msg> -- <paths>`.

⚠ **`TerminalPane.vue` is already modified AND holds a lone CR byte** that the `Edit` tool rewrites
as LF, producing a phantom multi-thousand-line diff. **This task must not touch it.**
✅ `ProjectSettingsView.vue` was measured this session at **2002 CRLF lines, 0 lone CR** — safe to
edit. **Run `git diff --stat` after every edit anyway** and confirm the line count is yours.

---

## ⚠ GATE 2 — TEST BASELINE, WHICH HAS MOVED THREE TIMES

**Current baseline: 93 test files / 3269 tests, all passing.** (90/3194 at kickoff → 91/3210 after
10.1-1 → 92/3244 after 10.1-2 → 93/3269 after 10.1-3. ⚠ **`Task-10.1-4.md` quotes 90/3194 — stale.**)
Your final run must be at or above **93 / 3269**.

⚠ `--reporter=basic` does not exist in this vitest: it fails with `ERR_LOAD_URL` and still exits 0,
so it looks green while running nothing. Use plain `npx vitest run`.

⚠ `MIGRATIONS` is now **24** and `v25` is free. **This task adds no migration** — the `v24` column it
reads already exists.

---

## Goal

One project-level panel that renders the ledger's four numbers side by side, makes the **gap between
`Naive` and `CE`** the first thing you see, names **what the subagents cost**, and is honest — in
three distinguishable ways — about every number it lacks.

This is the surface that makes Phase 10.1 worth having even if 10.2, 10.3 and 10.4 are all killed.

---

## Ground yourself first — read before editing

- `docs/Features/Engine/Tasks/Task-10.1-4.md` — the ten work steps, test expectations, acceptance.
  **Read it in full**, with GATE 0's supersession in mind.
- `docs/Features/Engine/ImplementationSpecs/ImplementationSpec-10.1-4.md` — §"What 10.1-3 must carry"
  is now **your contract to build**, not a constraint to check. Also the placement rationale and the
  three-state rendering rules.
- `src/shared/ipc.ts` — the `engineLedger*` schemas you are widening, and `sessionContext`'s pair.
- `src/main/services/engineLedger.ts` + `engineLedgerCore.ts` — where the split already exists.
- `src/renderer/src/stores/memory.ts:313-325` — the per-project supersede guard, verbatim precedent.
- `src/renderer/src/components/ContextRing.vue` — how this repo draws without a chart library.
- `src/renderer/src/views/ProjectSettingsView.vue` — `.ps-section` / `.ps-label` / `.ps-hint` at
  `:1548` / `:1554` / `:1561`; mount above the `ps-section-lifecycle` block.

---

## Implementation scope

**(1) Widen the payload** — `shared/ipc.ts`, to the shape in ImplementationSpec-10.1-4 §"What 10.1-3
must carry": `LedgerMetric { total, main, subagent }` each `number | null`, `LedgerRow` carrying
`sessionId`, `agent` (⚠ **a plain string, NEVER `AgentKind`** — `voiceRefine.ts:193` writes
`agent: 'voice'`, `agentKindSchema` has no `voice`, and the installed DB holds 26 such rows; typing
it `AgentKind` takes the whole aggregate down on the outbound parse), `title`, `startedAt`,
`hasSource`, and the four metrics; `LedgerSnapshot` carrying `projectId`, `rows`,
`dispatchesWithTokens`, `dispatchesTotal`.
⚠ **Keep every field a number, a string identifier, or null — nothing that could carry transcript
text.** The all-numeric argument still holds for the metrics; extend the `ipc.test.ts` assertion
rather than dropping it.

**(2) Carry the split through** — `engineLedger.ts` exposes `main` and `subagent` per metric, which
`scanLedger` already returns. **Null means "not read", 0 means "read, and there was none"** — two
different claims that must not share a representation.

**(3) Source the project view** — `main/ipc.ts` + `storage.ts`: the dispatch rows for a project with
their `tokens_*` columns (including `v24`'s `tokens_cache_write`), plus the coverage counts.
⚠ **NULL stays NULL all the way to the renderer. A `?? 0` anywhere on this path is the bug this
phase exists to prevent.**
⚠ `hasSource` is decided **in main**, not in the renderer: does a transcript reader exist for this
agent at all? Claude and codex yes; `opencode`, `kimi`, `grok`, `shell`, `voice` no.

**(4) The pure view module** — `src/shared/engineUsageView.ts` (+ test). It takes the payload and
returns rows already carrying state, bar geometry, ratio text and title text. **D186: the component
contains no `if` that decides what Chorus is claiming.**

**(5) The store** — `src/renderer/src/stores/engineLedger.ts` (+ test), keyed by project id, with
`memory.ts:313-325`'s supersede guard **covering the `loading` flag too**.

**(6) The panel** — `src/renderer/src/components/EngineUsagePanel.vue`, `eu-`-prefixed scoped styles,
mounted as one new `<section class="ps-section">` above the Lifecycle block in
`ProjectSettingsView.vue`.

---

## The three states, and why collapsing any two is the failure

- **`measured`** — digits, and a bar.
- **`unknown`** — the ledger covers this agent, this row has no token data. Render **`—`**, and
  ⚠ **the bar element is ABSENT from the DOM, not zero-width**. A zero-height bar claims the session
  was free. In the installed DB **403 of 468 dispatches carry no token data**.
  ⚠ Per-agent NULL counts are claude 258/286, codex 130/137, opencode 13/13, grok 2/4, shell 1/2,
  voice 0/26 — **and these do not sum to the same figure as the all-columns-null count. Never derive
  one from the other; render the count main sends.**
- **`no-source`** — one sentence, *No token source for this agent*, and **no dashes at all**. A dash
  means "we looked and found nothing", which is a different and wrong claim for an agent Chorus
  cannot read.

---

## Rendering rules that carry a measurement

- **Four numbers side by side**, `Naive` labelled with what it does — *counts a cache read as if it
  were a fresh token; the industry default*.
- **Bars linear, normalised to the largest value in the group.** ⚠ **NO LOG SCALE** — a log axis
  compresses exactly the gap the panel exists to show. Measured here: `Naive/CE` **5.07x–5.86x**,
  `Naive/RLIT` **12.46x–18.71x**; the largest transcript reads `Naive = 45,379,703` ·
  `CE = 9,197,338` · `RLIT = 2,453,116` · `output = 236,040`.
- **The subagent split is a headline**: two stacked segments per bar and one line per group —
  *Subagents: 61% of CE, 75% of RLIT*. Measured **53.2%–64.9% of CE**, **74.8%–90.5% of RLIT**.
  Where the split is null, one undifferentiated segment and a line saying so — **never silently 100%
  main**.
- **Coverage, because a total over NULLs is the same lie one level up**: *N of M dispatches in this
  project carry token data*, every total computed over the measured subset and labelled with its
  denominator.
- **No `$`, no `usd`, no `cost`, no `price` anywhere** (D-c). There is no price column in the schema.

---

## Strict non-goals

- **No new dependency**, no chart library (CLAUDE.md says ask first). Hand-rolled SVG/CSS like
  `ContextRing.vue`.
- **No `CE_total`**, no dollars, no cost.
- **No change to `ContextRing.vue`** or its mount sites — it answers a different question and keeps
  answering it.
- **Do not touch `TerminalPane.vue`.**
- **No migration** — `MIGRATIONS` stays at 24.
- **No settings toggles for the 10.2 / 10.3 tiers, no A/B protocol UI.**
- **No ledger arithmetic in the renderer** — every number arrives computed; the view module shapes
  it, the component draws it.
- Do not revert, stage or commit anything in GATE 1.

---

## Required workflow

Coordinator pattern: implement → review against `ImplementationSpec-10.1-4.md` clause by clause →
code-quality review → resolve findings → verification → narrate the commit.

**One intentional commit** in house style: concise imperative title, `**What this does**` in plain
language, `**Technical detail**`, `**Verification**` with an explicit `NOT verified:` list,
`**Migration**` (none — say so), and `**Scope**`. ⚠ **The commit must state that this task widened
10.1-3's payload and why**, since that crosses a task boundary its own doc drew.

**Do not push and do not open a PR unless explicitly asked.**

---

## Verification — run these, do not reason about them

```bash
npx vitest run src/shared/engineUsageView.test.ts src/renderer/src/stores/engineLedger.test.ts
npx vitest run src/shared/ipc.test.ts
npx vitest run
npm run typecheck
git diff --stat
git status --porcelain
```

**Expected:** typecheck exit 0 · full suite **≥ 93 files / 3269 tests** · `git diff --stat` showing
only files you meant to touch, with no phantom line counts.

⚠ **THERE ARE NO COMPONENT TESTS IN THIS REPO AND THIS TASK MUST NOT ADD A RUNNER FOR THEM.** The
only renderer tests are `stores/*.test.ts`, `palette/commands.test.ts`, `attention/reporter.test.ts`.
That is exactly why the rules live in `engineUsageView.ts` — a rule written in a `.vue` is a rule
nothing can check (D186).

⚠ **Beware the self-matching gate.** Three times this phase a grep gate has failed on prose or on a
legitimately-named field — most recently a name bar that rejected `files` and `subagentFiles`, which
are counts. Strip comments before grepping, and prefer asserting on structure.

**Runtime gate — it is the acceptance check.** Seed a throwaway user-data-dir from
`%APPDATA%\chorus-app` **including `Local State`** (without the OSCrypt key every credential blob is
undecryptable and profile-backed panes fail for the wrong reason), launch with
`REMOTE_DEBUGGING_PORT=9222`, and confirm on screen:

1. A session with token data renders four numbers and bars whose ordering shows the gap.
2. **A session with no token data renders `—` with NO bar element in the DOM** — inspect it, do not
   infer it.
3. A `voice` or `grok` row renders the no-source sentence, not four dashes.
4. The panel fits the `ps-section` column and is legible in **both themes**.

⚠ **Setting `ELECTRON_CLI_ARGS` in the environment does not work** — `electron-vite`'s CLI overwrites
it (`options['--']` is an empty array, which is truthy). Passing it after `--` fails too (cac
camel-cases it to an unknown option). The route that worked was seeding the dev instance's own
user-data-dir after backing it up **once**. ⚠ **Back up once and never re-run the backup step** —
doing so captures an already-seeded state, which cost the original layout in 10.1-1.
⚠ **Kill the dev instance by `Name='electron.exe'` AND `*remote-debugging-port=9222*`** — a bare
`*9222*` also kills Chrome renderers and the querying shell. ⚠ **Confirm the installed Chorus is
still running afterwards.**

---

## Failure honesty

If a command fails for an unrelated environment reason, capture the exact output, explain it, and do
not claim success. If a test expectation cannot be met, say which and why rather than weakening the
assertion.

⚠ **Never report a negative from an instrument you have not validated.** In 10.1-1 a process-env read
reported "variable absent" when it had failed outright; validating the reader against a known-good
process is what caught it. Prove your instrument can see a positive before reporting an absence.

⚠ **If you cannot run the runtime gate, say so and mark `DONE_WITH_CONCERNS`** — this task's whole
value is what appears on screen, and a panel verified only by unit test is not verified.

---

## Final report — required structure

**Status:** `DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED`

**Files changed:** each with a one-line reason, and the payload widening called out explicitly.

**Build results:** typecheck exit code · suite counts before and after · `git diff --stat`.

**Runtime results:** the four on-screen checks, with what you actually observed — especially that the
unknown row has **no bar element**, inspected rather than assumed.

**Review outcomes:** spec-compliance and code-quality findings, and how each was resolved.

**Non-goals confirmation:**
- ✅ no migration; `MIGRATIONS` still 24
- ✅ no new dependency, no chart library
- ✅ `ContextRing.vue` and `TerminalPane.vue` untouched
- ✅ no `$`/`usd`/`cost`/`price` in any output field, asserted by a test
- ✅ no `?? 0` anywhere on the NULL path
- ✅ no ledger arithmetic in the renderer

**Residual risks:** anything found and deliberately not fixed, with reasoning.

**Final state:** `git status --porcelain`, commit hash and title.
