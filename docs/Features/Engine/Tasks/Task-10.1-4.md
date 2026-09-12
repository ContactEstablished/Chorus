# Task 10.1-4 — The usage panel: four numbers and the gap between them

**Phase:** Engine 10.1 · **Depends on:** Task 10.1-3 · **Owns:** `src/shared/engineUsageView.ts` (+test),
`src/renderer/src/stores/engineLedger.ts` (+test), `src/renderer/src/components/EngineUsagePanel.vue`,
and **one** new `ps-section` in `src/renderer/src/views/ProjectSettingsView.vue`.

**This is the task that makes 10.1 ship value even if 10.2–10.4 are killed** — spec §5: the ledger
"ships as a usage panel regardless". It renders what the ledger measured, and nothing else.

---

## Source Of Truth

- `docs/Features/Engine/chorus-engine-spec.md` — **§5 Phase 10.1** (the four metrics; "report `Naive`
  beside `CE` deliberately — the gap between them is the finding"), **§7**, **§8 / D195**.
- `GROUND-FACTS-10.1.md` — **D-a** (NULL is unknown, never 0), **D-b** (subagent files are read),
  **D-c** (`CE_total` is NOT in v1: there is no price source), and every measured number below.
- Conventions to match rather than reinvent: `ContextRing.vue:9-16` (there is no unknown state and
  there must not be one — the caller renders nothing instead); `stores/session.ts:64-69` (an absent
  entry is "no source", not "0%"); `contextUsage.ts:17` ("a session with no reading is ABSENT rather
  than zero"); `FilmstripRenderer.vue:275` / `:285-291` (live main-memory facts come through the
  store, and **the emptiness is decided in a tested core, not by a `v-if`**);
  `ImplementationSpecs/ImplementationSpec-1-4.md` from Fleet Comms (placement is a non-goal boundary —
  consulted, never pushed — and two different reasons for "no number" must not share one label).

## Initial Starting Point (verified 2026-09-12 at `3e391a0`)

- ✅ **Baseline measured this session:** `npx vitest run` → **90 files / 3194 tests, all passing**; no `engineLedger*` exists in `src/main/services/`.
- ✅ `ProjectSettingsView.vue` is **2002 lines**. `ps-section` opens at `:793`, `:811`, `:832`,
  `:906`, `:1067` (memory schema, gated on `v-if="memoryStatus?.configured"`) and `:1324`
  (`ps-section-lifecycle`). CSS: `.ps-section` `:1548`, `.ps-label` `:1554`, `.ps-hint` `:1561`.
- ✅ **The insertion point is line 1320** — after the memory-schema `</section>` at `:1319`, before the
  destructive-door comment at `:1321-1323`.
- ✅ `ContextRing.vue` is 162 lines and draws its donut with a stroked `<circle>` and
  `stroke-dasharray` — **no charting library, and none is needed here either**.
- ✅ `dispatches` is already project-scoped: `project_id` `schema.ts:294`, `session_id` `:293`,
  `tokens_in` `:311`, `tokens_out` `:312`, `tokens_cached` `:315`.
- ⚠ ✅ **`dispatches.agent` is NOT `AgentKind`.** `voiceRefine.ts:193` writes `agent: 'voice'`
  (`attributionCore.ts:690` acknowledges it, `ipc.ts:5530` comments on it), and `agentKindSchema`
  (`src/shared/ipc.ts:974`) is `claude | codex | grok | kimi | opencode | shell`. The installed DB
  holds **26 voice rows**. A panel typed on `AgentKind` drops or throws on them.
- ✅ **No `.vue` test exists anywhere in this repo** — the only renderer tests are `stores/*.test.ts`,
  `palette/commands.test.ts`, `attention/reporter.test.ts`. D186 applies unchanged: a rule written in
  a component is a rule nothing can check.
- ⚠ ✅ **Line endings, measured byte-wise this session:** `ProjectSettingsView.vue` is 2002 CRLF lines
  with **0 lone CR** — safe to edit. `TerminalPane.vue` is 2297 CRLF lines with **1 lone CR and 60 lone
  LF** and is already `M` in the tree. This task does not touch it.

## Goal

One project-level panel that renders the ledger's four numbers side by side, makes the **gap between
`Naive` and `CE`** the first thing you see, names **what the subagents cost**, and is honest — in
three distinguishable ways — about every number it lacks.

## Exact Scope

**Create three things and their tests:** `src/shared/engineUsageView.ts` + `engineUsageView.test.ts`
(the pure rules — state classification, bar geometry, ratio text, coverage text; every claim the panel
makes is decided here); `src/renderer/src/stores/engineLedger.ts` + `engineLedger.test.ts` (a Pinia
store keyed by project id, with the per-project supersede guard `memory.ts:313` established); and
`src/renderer/src/components/EngineUsagePanel.vue`, which draws the result and holds no logic.

**Edit exactly one existing file:** `ProjectSettingsView.vue` — import the panel and mount it inside a
new `<section class="ps-section">` at line 1320, with a `ps-label` and a `ps-hint`, matching `:1067`.

## Non-Goals

- **No ledger computation in the renderer.** Every number arrives over IPC already computed; a
  quantity the wire does not carry is a change to Task 10.1-3, not a sum here.
- **No new IPC channel.** 10.1-3 owns `src/shared/ipc.ts` and `src/main/ipc.ts`. Do not touch the two
  `IpcChannel` count assertions (`src/shared/ipc.test.ts:3642` and `:4102`, currently **114**).
- **No `CE_total`, no dollars, no cost.** D-c: `model_catalog` (`schema.ts:460`) has no price column,
  so a blend would carry an unsourced constant inside the one figure the phase exists to trust. Raw
  `output_tokens` stays un-folded — spec §7 makes a fall in output the signature of a silent
  thinking-disable, which a blend would hide as a saving.
- **No change to `ContextRing.vue`** or its mount sites. The ring answers a different question (how
  full is the window *now*) and keeps answering it.
- ⚠ **Do not touch `TerminalPane.vue`.** It is already modified and holds a lone CR byte; the `Edit`
  tool rewrites it as LF and produces a phantom multi-thousand-line diff. If a later change genuinely
  needs it, say so out loud and run `git diff --stat` after **every** edit to it.
- No new dependency of any kind — no chart library (CLAUDE.md: ask first). No settings toggles for the
  10.2/10.3 tiers, no A/B protocol UI, and no normalisation claim other than spec §5's **per
  completed task**.
- Do not revert, stage or commit the pre-existing modified/untracked files (`roadmap.md`,
  `package*.json`, `TerminalPane.vue`, `.claude/`, `.procoder/`, `docs/Features/Engine/`).

## Dependencies

**Task 10.1-3** — the IPC channel and its payload. This task consumes it and imposes three
requirements on it (see `ImplementationSpec-10.1-4.md` §"What 10.1-3 must carry"): every token
quantity is `number | null`, where **`null` means unknown and `0` means measured zero**; the subagent
split is a separate nullable field per metric, so "no subagent files read" and "subagent files read,
there were none" are different values; and the agent identifier on the wire is a **plain string**, not
`AgentKind`, because `voice` exists.

## Step-by-step Work

1. **Write the pure module first** (`src/shared/engineUsageView.ts`): it takes the wire payload and
   returns rows already carrying state, bar widths, ratio sentence and title text. D186 — the
   component must contain no `if` that decides what Chorus is claiming.
2. **Classify into exactly three states, and prove there is no fourth.** `measured` · `unknown`
   (the ledger covers this agent; this row has no token data) · `no-source` (no reader for this agent
   at all). ⚠ **Collapsing `unknown` and `no-source` into one label is the failure mode this task
   exists to avoid** — the first is probably temporary, the second permanent, the same distinction
   `ImplementationSpec-1-4` draws between `no-entry` and `not-claude`.
3. **Render `unknown` as `—`, never as `0`, never as a zero-height bar.** In the installed DB **402 of
   467 dispatches carry no token data**, and per agent the NULL-`tokens_in` counts are claude 258/286,
   codex 129/136, opencode 13/13, grok 2/4, shell 1/2 — ⚠ which sum to **403**, one more, so never
   derive one of those figures from the other. Drawn as zero they would claim those sessions were free.
   The bar element is **absent**, not zero-width.
4. **Render `no-source` as one sentence and nothing else:** *No token source for this agent.* No
   dashes in the four columns — a dash means "we looked and found nothing", a different and wrong
   claim for `opencode`, `kimi`, `grok`, `shell` and `voice`. `contextUsage.ts:17`'s rule, second surface.
5. **Four numbers, side by side, one row group per session:** `CE`, `RLIT`, `Naive`, `output_tokens`,
   each labelled with what it is and `Naive` labelled with what it does — *counts a cache read as if
   it were a fresh token; the industry default*.
6. **Make the gap legible.** Bars are **linear and normalised to the largest value in the group**, so
   `RLIT` renders as a sliver beside `Naive` and that sliver is the finding. ⚠ **No log scale** — a log
   axis compresses exactly the 5x–19x gap the panel exists to show. Beside the bars, the ratios in
   words: measured here `Naive/CE` is **5.07x–5.86x** and `Naive/RLIT` **12.46x–18.71x**, and the
   largest Chorus transcript reads `Naive = 45,379,703` · `CE = 9,197,338` · `RLIT = 2,453,116` ·
   `output = 236,040`.
7. **The subagent split is a headline, not a detail.** Measured on three real sessions, subagent work
   is **53.2%–64.9% of CE** and **74.8%–90.5% of RLIT**. Each bar is two stacked segments and the group
   carries one line: *Subagents: 61% of CE, 75% of RLIT*. Where the split is `null` the bar is one
   undifferentiated segment and the line says so — it must not silently render as 100% main.
8. **State coverage, because a total over NULLs is the same lie one level up.** One line under the
   table — *N of M dispatches in this project carry token data* — and every total is computed over the
   measured subset only and labelled with its denominator.
9. **Store**: `engineLedger.ts`, keyed by project id, loaded `onMounted` and on an explicit Refresh,
   with `memory.ts:313-325`'s per-project supersede guard (an unguarded `loading = false` lets a stale
   load clear a live one's spinner). Session-lifetime; nothing cached across app runs.
10. **Mount it** at `ProjectSettingsView.vue` line 1320, a `<section class="ps-section">` with
    `ps-label` + `ps-hint`, above Lifecycle. The panel owns `eu-` prefixed scoped styles;
    `SettingsView.vue:112-114` is the precedent for a view mounting a child that styles itself.

## Test Expectations

**Honest split: almost none of this is testable in the `.vue`, and that is why the rules leave it.**
There are no component tests in this repo and this task must not add a runner for them. Unit-testable
in `engineUsageView.test.ts` — the substance:

- A row with `ce: null` classifies as `unknown`, renders `—`, and **carries no bar geometry at all**
  — assert the bar field is absent/null, not `0`. ⚠ A test that only asserts the label is `—` passes
  against a zero-width bar.
- A row with `ce: 0` classifies as `measured` and renders `0`. **`null` and `0` produce different
  output** — one assertion, side by side, is the whole point of D-a.
- `opencode`, `kimi`, `grok`, `shell` and **`voice`** classify as `no-source` and produce the sentence,
  not four dashes. A string agent id the module has never heard of lands here rather than throwing.
- Bar widths for `{ce: 9197338, rlit: 2453116, naive: 45379703, output: 236040}`: `naive` is 100%,
  `rlit` under 6%, ordering preserved. Assert the ratios read `5.0x` and `18.5x` as literals rather
  than recomputing them with the same expression as the code.
- Subagent split `null` ≠ split `0`: unknown versus "no subagent work". Coverage text for 65 of 467
  says 65 and 467, and a total names its denominator.
- ⚠ **A test asserting no output field ever contains `$`, `usd`, `cost` or `price`** — D-c made
  executable at the shape level, because there is no price source and a later reader will assume there is.

In `engineLedger.test.ts`: the supersede guard (a slow load for project A does not overwrite a fast
load for B, nor clear B's spinner), and an error leaves the last good rows intact. Needs a live check:
that the panel reads as unknown **on screen**, fits the 560px `ps-section` column, and is legible in
both themes.

## Verification Commands

```
npx vitest run src/shared/engineUsageView.test.ts src/renderer/src/stores/engineLedger.test.ts
npx vitest run
npm run typecheck
git diff --stat
```

**Runtime gate — run it, it is the acceptance check.** Seed a throwaway user-data-dir from
`%APPDATA%\chorus-app` **including `Local State`** (plain `npm run dev` has no credentials and every
credential blob is undecryptable without it), launch with `REMOTE_DEBUGGING_PORT=9222`, drive CDP on
9222, and confirm the installed Chorus is still running afterwards.

- ⚠ **Assigning `.value` to a `v-model` input leaves the model empty** — dispatch an `input` event or
  the bug looks like the app's, not the harness's.
- ⚠ **Kill the dev instance by matching BOTH `Name=electron.exe` AND `*remote-debugging-port=9222*`.**
  The bare `*9222*` substring also kills Chrome renderers and the querying shell.

## Acceptance Criteria

- ⚠ **A session with NULL token data renders as unknown, not as zero** — confirmed on screen in the
  running app, not only in a unit test: the numeral is `—`, there is no bar element in the DOM for
  that metric, and the row is visibly dimmed.
- An `opencode` (or `voice`) row reads *No token source for this agent* — not an empty chart, not four
  dashes, not a broken-looking row.
- `CE`, `RLIT`, `Naive` and raw `output_tokens` all appear side by side, `Naive` labelled as the metric
  that overstates, the `Naive/CE` and `Naive/RLIT` ratios stated in words, and the subagent share
  visible without expanding anything.
- No dollar figure and no `CE_total` anywhere in the DOM; the coverage line names both numbers and no
  total is computed over unknown rows.
- Exactly one existing file is modified; `git diff --stat` shows `ProjectSettingsView.vue` with a small
  line count and **no entry for `TerminalPane.vue`**.
- Full suite at or above the measured baseline (**90 files / 3194 tests**), `npm run typecheck` → 0
  errors, and `package.json` / `package-lock.json` untouched by this task.

## Review Checklist

- [ ] `unknown`, `no-source` and `measured` are three states with three renderings, and a test proves
      there is no fourth.
- [ ] `null` and `0` are distinguishable in the pure module's output, not just in the component, and
      no bar, track or placeholder is drawn for an unknown value.
- [ ] `Naive` is present, labelled honestly, the gap is the loudest thing in the group, and the bars
      are linear and normalised to the group max — no log scale crept in to "make it readable".
- [ ] The subagent share is a headline, and an unknown split does not render as 100% main.
- [ ] Nothing in the renderer computes a ledger quantity; no new dependency; the drawing is CSS/SVG
      in `ContextRing.vue`'s idiom; the agent id is a string and `voice` renders correctly.
- [ ] `git diff --stat` is clean of `TerminalPane.vue` and of the pre-existing modified files.
