# Task 10.1-5 — Make the ledger take a reading, and check that reading against something else

**Phase:** Engine 10.1 (added after the phase shipped) · **Depends on:** 10.1-1 … 10.1-4, all landed
**Owns:** no production file by default — this is a **verification** task. Any code it touches is a
fix it justifies in its own report.

---

## Source Of Truth

- `docs/Features/Foundation/roadmap.md` — **D191** (the Engine is admitted measurement-first),
  **D199** (this task exists so that ruling is enforced rather than quoted), **D195(c)** (the gap
  between `Naive` and `CE` is the finding), and Phase 10's milestone, which this task does **not**
  complete.
- `docs/Features/Engine/chorus-engine-spec.md` §4 (where the weights come from), §7 (the A/B
  protocol this is *not*).
- The code under test: `engineLedgerCore.ts` (pure), `engineLedger.ts` (cursor + walk),
  `main/ipc.ts`'s `engine:ledger-snapshot`, `shared/engineUsageView.ts`, `EngineUsagePanel.vue`.

## Initial Starting Point (verified 2026-09-13 at `77cd5f8`)

- ✅ Phase 10.1 is complete and pushed: `f76770b` · `2530a98` · `0ef5fd9` · `cf54f9b`, docs
  `f1976b5`, roadmap `77cd5f8`. Suite **95 files / 3303 tests**; `IpcChannel` **117**;
  `MIGRATIONS` **24**, next free `v25`.
- ⚠ **THE LEDGER HAS NEVER PRODUCED A NUMBER.** Verified in the running app on 2026-09-12: the
  project-scoped snapshot returned **286 rows, 0 with a `ce.total`**, and the main log carried
  exactly one `agent-events` line — the listener binding — and nothing after it.
- ⚠ **AND THE CAUSE WAS MIS-DIAGNOSED THE FIRST TIME, WHICH IS WHY THIS TASK IS SMALL.** It was
  written up as **F72**, codex's content-hashed hook trust. F72 is **codex-specific**; `claude.ts`
  has no trust or hash mechanism at all and simply passes `--settings <file>`. Re-verified
  2026-09-13: there is no trust/hash logic in the claude adapter. **The real cause is that the probe
  pane stopped at Claude Code's own folder-trust prompt** — *"Quick safety check: is this a project
  you created or one you trust?"* — which sits **before** session start, so no `SessionStart` fired
  and no `transcript_path` ever reached `noteTranscript`.
- ✅ The wiring that consumes it exists and was proved on 2026-09-12: `engine:ledger-snapshot`
  returned all-numeric-or-null values, 125 no-source rows, and the panel rendered **0 bar elements
  against 644 placeholders** for unknown rows.
- ⚠ Neo4j was **not running** on 2026-09-13 (7474 unreachable, bolt 7687 closed, no container). It
  is irrelevant to this task — the ledger reads transcripts, not the graph — but do not be surprised
  by `chorus-memory` failing to connect.

## Goal

Get the token ledger to produce one real reading from one real agent turn, see it rendered as a
**measured** row, and then — the part that matters — **check that reading against a figure derived
without the ledger**. Until that comparison exists, every number the Engine reports is unvalidated,
and Phase 10.2's benefit cannot be assessed when it lands (**D199**).

## Exact Scope

**Primarily verification. Expected production diff: none.** Produce:

1. A recorded end-to-end run: pane → turn → scan → measured row on screen.
2. `_verify/engine-ledger-calibration/` — the independent calculation, its script, and its result.
   (`_verify/` is gitignored working evidence; the roadmap's `F<n>` row and the Task 6b-3 runbook are
   the precedent for keeping the artefact and citing it.)
3. A written calibration result in the task's completion report: the ledger's `CE`/`RLIT`/`Naive`
   beside the independent figures, and **the discrepancy, if any, named rather than rounded away**.

Any code change is a **fix the run justified**, listed explicitly with its reason.

## Non-Goals

- **This is NOT the A/B protocol.** §7's 30 paired sessions are the Phase 10 milestone; this is one
  session and no comparison between arms. ⚠ Do not report this as progress toward that milestone.
- **No new feature, no new metric, no `CE_total`, no UI change** beyond a fix the run forces.
- **No migration** — `MIGRATIONS` stays at **24**.
- **No Phase 10.2 work.** The `typescript` promotion (**D198**) belongs to that kickoff, not here.
- **Do not "fix" a disagreement by changing the ledger to match the hand calculation** without first
  establishing which one is wrong. ⚠ The independent figure is a *check*, not an oracle.
- Do not revert, stage or commit the pre-existing dirty files: `package.json`, `package-lock.json`
  (both **staged** — leave the index alone), `TerminalPane.vue`, `.claude/`, `.procoder/`.

## Dependencies

None outstanding — all four Phase 10.1 tasks have landed and are pushed.

## Step-by-step Work

1. **Get one pane past the folder-trust prompt.** Launch a claude pane in a directory Claude Code
   already trusts, or accept the prompt and confirm the session actually started. ⚠ **The evidence
   that it started is a hook arriving, not a pane that looks alive**: watch for `agent-events` lines
   beyond the listener binding.
2. **Run one real turn.** A trivial prompt is enough; the transcript needs at least one `assistant`
   entry carrying a `usage` block, because that is all `ledgerEntryTotals` counts.
3. **Confirm the scan fired at the TURN BOUNDARY, not per hook event.** ⚠ This is the design claim
   10.1-3 could not verify and its whole cost argument rests on it: a whole-file scan is ~63 ms
   against the ring's sub-millisecond tail read, and the hook bus fires several times a second.
   Count `refresh` invocations against tool calls for the turn.
4. **See a measured row on screen.** Open the panel: four numbers, bars ordered so `Naive` dwarfs
   `RLIT`, a ratio sentence, and the subagent line. ⚠ Confirm a `0` renders differently from a `—`
   in the same view if both are present — that distinction is the panel's reason to exist.
5. **Calibrate.** Compute `CE`, `RLIT` and `Naive` for that session's transcript with a script that
   **shares no code with `engineLedgerCore.ts`** — read the JSONL independently and apply §4's
   weights by hand. Compare.
   - ⚠ **Include the subagent files if the session spawned any**, or the two figures are measuring
     different sets and will disagree for an uninteresting reason.
   - ⚠ **Do not import the module you are checking.** A calibration that reuses the implementation
     proves only that it is self-consistent — the same trap the 10.1-2 tests avoided by asserting
     ratio literals instead of recomputing them.
6. **Write down the discrepancy.** Exact agreement, a rounding-level difference, and a structural
   difference are three different outcomes and must be reported as such.

## Test Expectations

**No new unit tests are expected, and that is the honest position:** every rule this task exercises
already has one (34 ledger-core cases, 17 service cases, 25 view cases, 7 store cases). What is
missing is not coverage — it is a single observation that the assembled system produces a true
number. If the run exposes a defect, its fix gets a test in the module that owns it.

## Verification Commands

```bash
npm run typecheck
npx vitest run
git diff --stat
git status --porcelain
```

**Expected:** typecheck 0 · suite **≥ 95 files / 3303 tests** · `git diff --stat` empty unless a fix
was justified in the report.

**The runtime run is the task.** Seed a throwaway user-data-dir from `%APPDATA%\chorus-app`
including `Local State`; launch with `REMOTE_DEBUGGING_PORT=9222`.
⚠ `ELECTRON_CLI_ARGS` **cannot** be set from the environment — electron-vite's CLI overwrites it
because `options['--']` is an empty array, which is truthy (**F119**). The route that works is
seeding the dev instance's own user-data-dir after backing it up **once**.
⚠ Kill the dev instance by `Name='electron.exe'` **and** `*remote-debugging-port=9222*`; a bare
`*9222*` also kills Chrome renderers and the querying shell.
⚠ **Validate any instrument on a known positive before believing a negative** (**F121**).

## Acceptance Criteria

- A claude pane started, ran one turn, and **at least one `agent-events` line beyond the listener
  binding** appears in the log.
- `engine:ledger-snapshot` returns **at least one row with a non-null `ce.total`**, and the panel
  renders it as four numbers with bars — observed on screen, not inferred.
- `refresh` ran **once per turn**, not once per hook event, with the counts recorded.
- An independent calculation of `CE`/`RLIT`/`Naive` exists, shares no code with the ledger, and its
  result is reported **beside** the ledger's with the discrepancy named.
- ⚠ **If the two disagree, the task is NOT failed and must NOT be closed by adjusting the ledger.**
  Report both figures, state which is suspected wrong and why, and stop — a silent reconciliation is
  the one outcome that would make every later Engine number untrustworthy.
- Suite and typecheck green; `git status` shows only the pre-existing dirty set unless a justified
  fix is listed.

## Review Checklist

- [ ] The reading came from a **real agent turn**, not a synthetic transcript or an injected store.
- [ ] The calibration script imports nothing from `engineLedgerCore.ts` or `engineLedger.ts`.
- [ ] The subagent files were included on both sides, or their exclusion is stated on both sides.
- [ ] The turn-boundary claim is backed by counted invocations, not by reading the code.
- [ ] The report distinguishes exact agreement from rounding-level from structural disagreement.
- [ ] Nothing in the report describes this as progress toward the §7 A/B milestone.
- [ ] `MIGRATIONS` is still 24 and `IpcChannel` still 117.
