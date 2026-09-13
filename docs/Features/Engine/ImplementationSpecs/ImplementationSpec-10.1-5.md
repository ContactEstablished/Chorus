# Implementation Spec 10.1-5 — the first reading, and how to know it is right

Companion to `Tasks/Task-10.1-5.md`. How to get a pane to a turn, where to count the scans, and how
to build a calibration that can actually disagree. Every line number was read at `77cd5f8` on
2026-09-13.

---

## Why this task is small, and why it nearly was not

The first write-up blamed the silent ledger on **F72** — codex's content-hashed hook trust, where
Chorus's per-session hook URL changes every launch so the hash never matches and the user is
re-prompted forever. If that had been the cause here, this task would be a redesign: the hook command
string would have to be made constant and the URL moved into the environment.

⚠ **It is not the cause, and the difference is the whole size of this task.** F72 is codex-specific.
`claude.ts` has no trust or hash mechanism: `writeHooksConfig` (`claude.ts:201`) writes a settings
file and `--settings <path>` is passed on the argv (`claude.ts:231-239`). Re-verified 2026-09-13 —
there is no `trust` or `hash` logic anywhere in that adapter.

What actually happened is visible in the 10.1-1 probe transcript, which captured the pane's own
screen: *"Quick safety check: Is this a project you created or one you trust?"* with `❯ No, exit` /
`Yes, I trust this folder`. **That gate sits before session start**, so no `SessionStart` fires, no
`transcript_path` reaches `agentEvents.onTranscriptPath`, and `noteTranscript` is never called. The
ledger was not broken; it was never handed anything.

⚠ **Which means the most likely outcome of this task is that everything already works.** That is a
real possibility and the report should say so plainly if it happens — "it worked first time" is a
result, not a missing investigation. The value is in step 5, the calibration, which has never been
done at all.

## Getting a pane to a turn

The 10.1-4 probe launched into `%TEMP%\chorus-panel-probe` — a fresh directory, so the prompt fired.
Two ways past it, in order of preference:

1. **Launch in a directory Claude Code already trusts.** The repo itself is trusted (this session is
   running in it). A pane in a trusted directory starts immediately and fires `SessionStart`.
   ⚠ Then use a *read-only* prompt so the turn cannot modify the repo — see below.
2. **Accept the prompt.** Send `Down` then `Enter` as **two separate writes**; one combined write is
   read as a paste rather than as keystrokes (the standing rule for driving these panes).
   ⚠ The 10.1-4 attempt did exactly this and still saw no hook, so if this route is taken, **prove
   the session started by a hook arriving**, not by the pane looking alive.

**The turn itself must be read-only.** `"what is 2 + 2"` is enough: it produces an `assistant` entry
with a `usage` block, which is all `ledgerEntryTotals` counts, and it touches nothing. ⚠ Do not use a
prompt that reads the repo — a large `Read` would inflate the very numbers being calibrated and make
the hand calculation harder to check, for no benefit.

## Counting the scans — the claim nobody has tested

`engineLedger.ts`'s header argues the whole design from one measurement: a whole-file scan of the
largest transcript here costs **63 ms** and allocates ~19.5 MB, against the context ring's sub-ms
256 KB tail, and the hook bus fires several times a second. The conclusion — scan at the **turn
boundary**, never on the hook path — is wired at `main/index.ts` via
`agentEvents.onActivity((sessionId, activity) => { if (activity !== 'working') engineLedger?.refresh(sessionId) })`.

⚠ **Nothing has ever verified that it fires once per turn rather than once per event**, and the
argument is worthless if it does not. To count without changing production code, either:

- read the main log and count `[engine-ledger]` lines (only failures log today, so this needs a
  temporary log line — **if one is added, it must be removed before the report, and the report must
  say it was there**); or
- drive it from the renderer: call `getEngineLedgerSnapshot` before and after the turn and compare
  `entries`, which advances only when a scan consumed new bytes.

The second is preferred: it changes nothing and measures the effect rather than the call.

⚠ **One scan per turn is the target; more than one is not automatically a failure.** The snapshot
handler also schedules a rescan when the panel is opened (`cf54f9b`), by design. Count the scans
attributable to *hook events during a turn* — that is the number that must be ~1, not the total.

## The calibration — how to build one that can disagree

The point is to catch a wrong ledger, so the calculation must be able to produce a different answer.

```
CE    = input + 1.25·eph5m + 2.0·eph1h + 0.1·cache_read
RLIT  = input + cache_creation
Naive = input + cache_creation + cache_read
```

⚠ **Import nothing from `engineLedgerCore.ts` or `engineLedger.ts`.** A calibration that reuses the
implementation proves only self-consistency — the same trap the 10.1-2 tests avoided by asserting
ratio literals rather than recomputing them with the code's own expression.

Three traps that will otherwise produce a fake disagreement, each already measured:

1. ⚠ **`usage.iterations[]` repeats the parent's counters.** Its length is only ever 1 or 0 across
   77,436 entries, so a walker that descends inflates every number by **exactly 2.00×**. A 2× gap
   between the two figures means the *calibration* recursed, not that the ledger is wrong.
2. ⚠ **Subagent files.** The ledger reads `<transcript>/subagents/agent-*.jsonl` as well as the main
   file. If the calibration reads only the main file and the session spawned subagents, the two
   measure different sets — and on real sessions that gap is 53–65% of `CE`. Include them on both
   sides or exclude them on both, and say which.
3. ⚠ **The `.jsonl` anchor.** `agent-<id>.meta.json` sits beside every subagent transcript; it is not
   a transcript and must not be parsed on either side.

**Expected outcome:** exact agreement to floating-point, because both sides apply the same four
arithmetic rules to the same bytes. ⚠ **A rounding-level difference is worth reporting but not
alarming; a structural difference means one side is reading a different set of entries, and the
report must say which set before anything is changed.**

## What a fix may and may not do

If the run exposes a defect, fix it in the module that owns it and add a test there — the ownership
split is the point of the pure/impure division.

⚠ **What must not happen is the ledger being adjusted to agree with the hand calculation.** The
calibration is a second opinion, not an oracle; a hand script written quickly is at least as likely
to be wrong as tested code with 83 cases behind it. If they disagree, the report names both figures,
states which is suspected wrong **and why**, and stops. Silently reconciling them would make every
number the Engine ever reports unfalsifiable, which is the exact failure D195 was written to prevent.

## Verification

- The run itself: a pane, a turn, a hook line beyond the listener binding, a non-null `ce.total`, and
  a measured row on screen.
- `npm run typecheck` → 0; `npx vitest run` → ≥ 95 files / 3303 tests.
- `git status --porcelain` shows only the pre-existing dirty set unless a fix is listed with reasons.
- ⚠ **The installed Chorus must still be running afterwards**, and any probe pane and dev instance
  must be killed by `Name='electron.exe'` **and** `*remote-debugging-port=9222*`.
- ⚠ **This run is not the §7 A/B protocol and the report must not describe it as progress toward the
  Phase 10 milestone.** It is one session, one arm, no comparison — a calibration of the instrument,
  which is the thing that has to be true before the milestone means anything.
