# Implementation Spec 10.1-2 — `engineLedgerCore.ts`

Companion to `Tasks/Task-10.1-2.md`. Deeper: exact shapes, the full header note, the parse rules,
the traps that must survive into the code as comments, and verification.

---

## Placement rationale

`src/main/services/engineLedgerCore.ts`, beside `contextUsageCore.ts` — **a sibling, never an edit**,
because the two answer opposite questions off the same bytes. `contextUsageCore` asks *how full is
the window now* and reads the **newest** entry of a 256 KB tail of **one** file; this asks *what did
the work cost* and reads **every** entry of **every** file. Folded together they are one parser with
a "sum or take-latest" flag, and that flag would eventually be wrong somewhere. Task 10.1-3's
service is then a thin shell that gathers text and calls in here.

## Shapes

```ts
/** ⚠ THE ONLY STRING ANYTHING HERE CARRIES — a security property, not a style
 *  choice (header note). `LedgerSource` is one transcript's whole text, tagged,
 *  with ⚠ NO NAME AND NO PATH FIELD, EVER: a name that never enters cannot be
 *  returned, so the shape is the enforcement rather than the comment. */
export type LedgerOrigin = 'main' | 'subagent'
export interface LedgerSource {
  readonly origin: LedgerOrigin
  readonly text: string
}
/** ⚠ THE FOUR NUMBERS, ALWAYS TOGETHER — ONE base interface, not three copies,
 *  so "never report CE alone" is enforced by the type system and not by
 *  discipline. `outputTokens` is RAW, never folded into the rest. */
export interface LedgerFour {
  readonly ce: number
  readonly rlit: number
  readonly naive: number
  readonly outputTokens: number
}
export interface LedgerTotals extends LedgerFour {
  readonly entries: number    // usage-bearing entries behind these; 0 is real
}
export interface LedgerTurn extends LedgerFour {
  /** Epoch ms from `timestamp`; null when absent/unparseable — such a turn
   *  counts into the totals but cannot be windowed (84,114/84,114 had one). */
  readonly at: number | null
  readonly origin: LedgerOrigin
}
export interface LedgerConsistency {
  readonly checked: number
  readonly mismatches: number
  readonly driftTokens: number   // signed Σ eph − scalar; 0 in all 84,093 real
}
export interface LedgerSkips {   // refused input, counted and never logged
  readonly unparseableLines: number
  readonly nonAssistantEntries: number
  readonly assistantEntriesWithoutUsage: number
  readonly turnsWithoutTimestamp: number
}
export interface LedgerEntry extends LedgerFour {
  readonly cacheWriteDrift: number
}
/** ⚠ `subagentSources` IS A COUNT, NOT A LIST. "What did the subagents cost" is
 *  answered by `subagent` vs `main`; "which one cost most" needs a file name,
 *  which the header note forbids. A per-agent breakdown needs a decision about
 *  whether an opaque `agent-<id>` identifies anyone — not a quiet field addition.
 *  `turns` is ascending by `at`, nulls last. */
export interface LedgerScan {
  readonly total: LedgerTotals
  readonly main: LedgerTotals
  readonly subagent: LedgerTotals
  readonly subagentSources: number
  readonly turns: readonly LedgerTurn[]
  readonly consistency: LedgerConsistency
  readonly skips: LedgerSkips
}
export const CE_WEIGHT_EPHEMERAL_5M = 1.25
export const CE_WEIGHT_EPHEMERAL_1H = 2.0
export const CE_WEIGHT_CACHE_READ = 0.1
/** null when the usage object carries no counters at all — parse rule 4. */
export function ledgerEntryTotals(usage: unknown): LedgerEntry | null
export function scanLedger(sources: readonly LedgerSource[]): LedgerScan
export function subagentDirFor(transcriptPath: string): string | null
export function isSubagentTranscriptName(fileName: string): boolean
```

## The header note, in full — place it verbatim at the top of the file

```
/**
 * ─── THE BOUNDARY, WHICH THIS MODULE WIDENS AGAIN (D196) ──────────────────
 * ⚠ `contextUsage.ts:12-50` records a deliberately narrow read: ONE file named
 * by a hook body, a 256 KB TAIL of it, THREE integers out, and the promise that
 * the file's content never leaves the module. THIS FEATURE WIDENS THAT AGAIN,
 * and the note is written down rather than assumed. What is true now:
 *   1. MANY files, not one — the main transcript PLUS every
 *      `<transcript-dir>/subagents/agent-*.jsonl` beside it.
 *   2. A DIRECTORY IS WALKED to find them. `contextUsage.ts` only opened a path
 *      it was handed; the service built on this module enumerates one.
 *   3. Each file is read WHOLE — the ring wants the newest turn, a ledger wants
 *      every turn, so the old byte cap is not here.
 *
 * ⚠ WHY THE WIDENING IS NOT OPTIONAL — MEASURED, NOT ARGUED: 0 of 268
 * transcripts on this machine carry an `isSidechain: true` line. Claude Code
 * 2.1.259 writes subagent work to separate files, and on three real sessions
 * those files were 53–65% of CE and up to 90.5% of RLIT, the quantity that
 * charges against rate limits. A main-file-only ledger is not conservative; it
 * is wrong by ~2.5x on exactly the sessions that cost the most.
 *
 * ─── THE INVARIANT THAT DOES NOT CHANGE ───────────────────────────────────
 * ⚠ CONTENT NEVER LEAVES THIS MODULE. ONLY COUNTERS DO. No message text, no
 * tool input, no tool result, no file name and no path is retained, broadcast,
 * logged or returned. The transcript is the user's own conversation and source
 * code; the whole point of taking numbers out of it is that numbers are all we
 * take. That is STRUCTURAL, not a promise: `LedgerSource` has no name field so
 * a name cannot be carried in, and `LedgerScan` holds no string but the
 * `'main'`/`'subagent'` discriminators so none can be carried out — a unit test
 * walks the result and asserts exactly that. ⚠ AND `agent-<id>.meta.json` IS
 * NEVER OPENED: it sits beside every subagent transcript holding a human-written
 * `description` (a real one: "Write Impl-18-3"), which is content and the
 * easiest accidental leak in this design. `isSubagentTranscriptName` anchors on
 * `.jsonl` for that reason, not for tidiness.
 *
 * ⚠ THIS FILE ITSELF OPENS NOTHING — it is handed strings and returns numbers,
 * pure like its sibling. The note lives here because this is where the rules
 * that BOUND the widening are expressed; `engineLedger.ts` (Task 10.1-3) does
 * the opening and points back here rather than restating it.
 */
```

## The parse, rule by rule

1. Split `text` on `\n`; trim; skip empty lines and any line not starting `{`. Then `JSON.parse` in
   a `try`; a throw increments `unparseableLines` and continues. **No logging** — a live
   transcript's last line is routinely a partial write, so a warn-per-partial would flood the log
   describing normal operation (`parseClaudeTranscriptTail`'s posture).
2. Require `entry.type === 'assistant'`; anything else → `nonAssistantEntries`. ✅ Measured: **84,170
   of 84,170 usage-bearing entries are `assistant`** and no other type carried a `usage` object.
3. Read `entry.message.usage`. ⚠ **`entry.usage` does not exist** — 0 entries carried a top-level
   one. Do not fall back to it; a fallback that never fires is untested code that one day fires.
4. `ledgerEntryTotals` → `null` when none of `input_tokens`, `cache_creation_input_tokens`,
   `cache_read_input_tokens`, `output_tokens`, `cache_creation` is present — `claudeUsedTokens`'s
   contract ("no usage block" is not "zero tokens"). Coerce every counter through
   `contextUsageCore.counter()`'s rule, *number, finite, ≥ 0, else 0*: one `"x"` must not poison a
   45-million-token sum with `NaN`.
5. `at` = `Date.parse(entry.timestamp)` when `timestamp` is a string and the result is finite; else
   `null` + `turnsWithoutTimestamp`. ⚠ `Date.parse` is a pure string→number function, not a clock
   read, and does not violate the no-`Date.now()` rule — say so, or someone will "fix" it.
6. `isSidechain` is **read and ignored for gating**. ⚠ Say why: the obvious move is to copy line
   209's skip, but those lines are the subagent's OWN turns in its own file (`true` on 109 of 109
   lines of a sampled one) and are exactly the cost this ledger exists to surface. Skipping them
   reproduces the bug being fixed.

### ⚠ The `iterations` double-count

```
"usage": { "input_tokens": 2, "cache_creation_input_tokens": 17996,
  "cache_read_input_tokens": 27883, "output_tokens": 106,
  "cache_creation": { "ephemeral_1h_input_tokens": 17996, "ephemeral_5m_input_tokens": 0 },
  "iterations": [ { "input_tokens": 2, "output_tokens": 106, "type": "message",
    "cache_read_input_tokens": 27883, "cache_creation_input_tokens": 17996,
    "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 17996 } } ] }
```

A real entry, copied — the array element is the parent, again. Corpus-wide `iterations.length` is
✅ **1 in 76,878 of the 76,884 entries that carry one, 0 in the other 6, never greater**, so summing
iterations as well as the parent is wrong by **exactly 2.00×** on every number, uniformly — the
worst failure mode there is, because a uniform 2× reads as a plausible total rather than a bug. On
the largest Chorus transcript, both ways — `CE 9,197,338 → 18,394,675`, `RLIT 2,453,116 →
4,906,232`, `Naive 45,379,703 → 90,759,406`. **Read the parent `usage`'s own keys; never recurse.**

### ⚠ The consistency check, and what a violation does

`ephemeral_5m_input_tokens + ephemeral_1h_input_tokens === cache_creation_input_tokens` held in
✅ **84,093 of 84,093 entries across 495 files — 0 mismatches**. It is free, so check it. On violation:
**do not throw, and do not silently prefer a source.** `CE` keeps the breakdown (nothing else
supplies the TTL weighting), `RLIT` and `Naive` keep the scalar (it is what ITPM charges), and
`driftTokens` accumulates the signed difference so a reader sees the magnitude and not just a count.
That is `contextUsageCore`'s house convention exactly — `counter()` degrades bad input to zero,
`claudeUsedTokens` returns `null` for absent input, `parseClaudeTranscriptTail` swallows a bad line,
nothing in that file throws or logs. An absent `cache_creation` is the degenerate case of the same
check (`0 − scalar`) and needs no second counter.

## Per-task normalisation

§5 requires normalising **per completed task**. ⚠ **A transcript cannot tell you where a task ends.**
Its per-entry fields are `uuid`, `parentUuid`, `sessionId`, `requestId`, `timestamp`, `cwd`,
`gitBranch`, `version`, `effort`, `agentId`, `entrypoint` — none marks completion — and §7's A/B
protocol defines a task **externally** (three shapes × five reps, git-reset between runs, order
randomised). Inferring a boundary from a timestamp gap would be a fabricated denominator wearing a
measurement's clothes, which D76/D83 forbid. **So: this core reports per-scan (per-session) totals
plus `turns[]` — every turn's four numbers positioned in wall-clock time, ascending, across both
origins** — and per-task folding is the caller's job. It lands in Task 10.1-3, which holds the only
real task boundary Chorus owns: a `dispatches` row's start and end; summing the turns in that window
is one `filter` + `reduce`. ⚠ Two limits to state in the comment: a turn's timestamp is when the
reply was **written** while its tokens were charged for the request before it, so a turn straddling
a window edge can land on the wrong side; and a session with no dispatch row — a pane driven by
hand — has no boundary at all and is reported per-session.

## The two string rules

`subagentDirFor('…/projects/<enc>/<id>.jsonl')` → `'…/projects/<enc>/<id>/subagents'`; `null` when
the input does not end `.jsonl`, because "that is not a transcript path" is a real answer and must
not produce a plausible directory. ⚠ **`node:path` is banned here, and not out of purism:**
`path.join` on win32 rewrites `/` to `\`, so one input gives different output here and on a POSIX
CI — a pure function that is not. Split on `/[\\/]/`, remember the last separator seen, rejoin with
it (`/` when there is none), and test both spellings.

`isSubagentTranscriptName` is `/^agent-[^\\/]+\.jsonl$/i`. ⚠ Two things ride on it: it rejects the
`agent-<id>.meta.json` sibling (**228 meta files to 227 transcripts** — one subagent wrote a meta
and never a transcript, so a glob of `agent-*` reads a non-transcript), and its separator-excluding
class doubles as a traversal guard on a name coming off `readdir`. ⚠ **And do not recurse the
directory:** all **83** on this machine sit at exactly `<project>/<sessionId>/subagents`, none
nested, and depth-2 subagents (`spawnDepth: 2` appears in the meta files) still write into that same
flat directory. Recursion buys nothing and would let a symlink take the service somewhere it was
never asked to read.

## Verification

Every `export ` appears in the test file; the task's purity grep returns `CLEAN`; a grep for
`iterations` returns comment lines only. **A runtime check is deliberately absent, and correct** —
this module touches no file. ⚠ Do not "verify" it by pointing a throwaway script at a real
transcript and reporting the totals as evidence: that verifies the script. The first genuine runtime
gate is Task 10.1-3, where these functions first meet a real `~/.claude/projects/`.
