/**
 * Engine Phase 10.1, Task 10.1-2: the token ledger's pure arithmetic and parse
 * layer. Handed the TEXT of transcripts, it returns four numbers and nothing
 * else. `engineLedger.ts` (Task 10.1-3) does the file reading and calls in here.
 *
 * A SIBLING to `contextUsageCore.ts`, never an edit to it, because the two
 * answer opposite questions off the same bytes: that module asks *how full is
 * the window now* and reads the NEWEST entry of a 256 KB tail of ONE file; this
 * asks *what did the work cost* and reads EVERY entry of EVERY file. Folded
 * together they would be one parser with a "sum or take-latest" flag, and that
 * flag would eventually be wrong somewhere.
 *
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
 * those files were 53-65% of CE and up to 90.5% of RLIT, the quantity that
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
 *
 * ─── ⚠ TWO PLACES THE ENGINE SPEC §5 IS WRONG, CORRECTED AGAINST MEASUREMENT
 * Recorded HERE and not only in the task docs, because the next reader's
 * instinct will be to "restore" the first one.
 *
 *   (a) §5 says "include sidechains (else work pushed into subagents looks
 *       free)", implementable only as inverting `contextUsageCore.ts:209`.
 *       ⚠ THAT INVERSION CHANGES NOTHING: 0 of 268 main transcripts carry an
 *       `isSidechain: true` line at all. The work moved to separate files, so
 *       the fix is walking the subagent directory (`subagentDirFor`), not
 *       flipping a flag. `isSidechain` is still READ where it does appear —
 *       inside the subagent files, where it is `true` on 109 of 109 lines of a
 *       sampled one — and deliberately does NOT gate the sum; see `scanLedger`.
 *
 *   (b) §5 says "include `output_tokens` (weighted)". ⚠ THERE IS NOTHING TO
 *       WEIGHT WITH: no price column exists anywhere in `schema.ts`, so the
 *       out/in ratio has no source and a hardcoded one would put an unsourced
 *       constant inside the one number this phase exists to trust. Output ships
 *       RAW and SEPARATE (D-c), and that is the better shape for a second,
 *       independent reason — see `LedgerFour.outputTokens`.
 */

/**
 * ⚠ THE ONLY STRING ANYTHING HERE CARRIES — a security property, not a style
 * choice (header note). `LedgerSource` is one transcript's whole text, tagged,
 * with ⚠ NO NAME AND NO PATH FIELD, EVER: a name that never enters cannot be
 * returned, so the shape is the enforcement rather than the comment.
 */
export type LedgerOrigin = 'main' | 'subagent'

export interface LedgerSource {
  readonly origin: LedgerOrigin
  readonly text: string
}

/**
 * ⚠ THE FOUR NUMBERS, ALWAYS TOGETHER — ONE base interface, not three copies,
 * so "never report CE alone" is enforced by the type system and not by
 * discipline. Every shape that reports cost extends this one.
 *
 * ⚠ `outputTokens` IS RAW AND IS NEVER FOLDED INTO THE OTHER THREE, and the
 * reason is a correctness one rather than a sourcing one. The Engine spec §7
 * records that Claude Code's capability-downgrade retry responds to a rejected
 * request by DISABLING THINKING for the rest of the conversation — and that its
 * only visible signature is output tokens falling. A blended total renders that
 * lobotomy AS A SAVING. Keeping output beside the cost numbers rather than
 * inside them is what lets a reader see the difference.
 */
export interface LedgerFour {
  readonly ce: number
  readonly rlit: number
  readonly naive: number
  readonly outputTokens: number
}

export interface LedgerTotals extends LedgerFour {
  /** Usage-bearing entries behind these numbers. ⚠ `0` is a real answer — an
   *  empty scan totals zero rather than returning null, because the caller
   *  asked about a set of sources it already has. */
  readonly entries: number
}

export interface LedgerTurn extends LedgerFour {
  /**
   * Epoch ms parsed from the entry's `timestamp`; `null` when it is absent or
   * unparseable. ⚠ A null-`at` turn STILL COUNTS into the totals but cannot be
   * windowed by a caller. Measured: 84,114 of 84,114 usage-bearing entries
   * carried a string timestamp, so the series is dense in practice.
   */
  readonly at: number | null
  readonly origin: LedgerOrigin
}

export interface LedgerConsistency {
  readonly checked: number
  readonly mismatches: number
  /** Signed Σ(eph5m + eph1h) − Σ(cache_creation_input_tokens) over checked
   *  entries. ⚠ A COUNT ALONE HIDES MAGNITUDE: one entry off by 2 and one off
   *  by 2,000,000 both read as `mismatches: 1`. Measured 0 across all 84,093. */
  readonly driftTokens: number
}

/** Refused input, counted and never logged — see the parse rules on `scanLedger`. */
export interface LedgerSkips {
  readonly unparseableLines: number
  readonly nonAssistantEntries: number
  readonly assistantEntriesWithoutUsage: number
  readonly turnsWithoutTimestamp: number
}

export interface LedgerEntry extends LedgerFour {
  /** This entry's own signed (eph5m + eph1h) − cache_creation_input_tokens. */
  readonly cacheWriteDrift: number
}

/**
 * ⚠ `subagentSources` IS A COUNT, NOT A LIST. "What did the subagents cost" is
 * answered by `subagent` vs `main`; "WHICH one cost most" needs a file name,
 * which the header note forbids. A per-agent breakdown would need a decision
 * about whether an opaque `agent-<id>` identifies anyone — not a quiet field
 * addition here.
 */
export interface LedgerScan {
  readonly total: LedgerTotals
  readonly main: LedgerTotals
  readonly subagent: LedgerTotals
  readonly subagentSources: number
  /** Ascending by `at`; null-`at` turns last, in encounter order. */
  readonly turns: readonly LedgerTurn[]
  readonly consistency: LedgerConsistency
  readonly skips: LedgerSkips
}

/* ------------------------------------------------------------------ */
/* The weights (Engine spec §4)                                        */
/* ------------------------------------------------------------------ */

/**
 * Cache WRITES are billed above fresh input and READS far below it, which is
 * the entire content of `CE` — a cost-equivalent token count. The 5-minute TTL
 * writes at 1.25x, the 1-hour TTL at 2.0x, and a read costs 0.1x.
 */
export const CE_WEIGHT_EPHEMERAL_5M = 1.25
export const CE_WEIGHT_EPHEMERAL_1H = 2.0
export const CE_WEIGHT_CACHE_READ = 0.1

/* ------------------------------------------------------------------ */
/* Coercion                                                            */
/* ------------------------------------------------------------------ */

/** Coerce one counter. Anything that is not a finite non-negative number
 *  contributes zero — a transcript is UNTRUSTED INPUT and one malformed field
 *  must not poison a 45-million-token sum with NaN. Same rule, same reason, as
 *  `contextUsageCore.counter()`. */
function counter(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

/* ------------------------------------------------------------------ */
/* Per-entry arithmetic                                                */
/* ------------------------------------------------------------------ */

/**
 * The four numbers for ONE `message.usage` object, plus this entry's cache-write
 * drift. `null` when the object carries no counters at all — `claudeUsedTokens`'
 * contract, for the same reason: "this message had no usage block" is a real
 * answer and must not read as "zero tokens used".
 *
 * ```
 * CE     = input + 1.25·eph5m + 2.0·eph1h + 0.1·cache_read
 * RLIT   = input + cache_creation                 # exactly what ITPM charges
 * Naive  = input + cache_creation + cache_read    # the metric that lies
 * output = output_tokens                          # raw, never folded in
 * ```
 *
 * ⚠ `CE` READS THE TTL BREAKDOWN WHILE `RLIT` AND `Naive` READ THE SCALAR, and
 * that is deliberate rather than an inconsistency. CE's whole content is the TTL
 * weighting, which the scalar cannot supply; ITPM charges the scalar. They agree
 * in every real entry measured (84,093 of 84,093), and when they disagree each
 * metric keeps the source that is definitionally correct FOR IT rather than one
 * of them silently winning.
 *
 * ⚠ ⚠ `usage.iterations[]` IS A DOUBLE-COUNT TRAP AND IS DELIBERATELY NOT READ.
 * It is an array whose element repeats the parent's own counters AND a nested
 * `cache_creation` — a real entry, copied:
 *
 *   "usage": { "input_tokens": 2, "cache_creation_input_tokens": 17996,
 *     "cache_read_input_tokens": 27883, "output_tokens": 106,
 *     "cache_creation": { "ephemeral_1h_input_tokens": 17996, "ephemeral_5m_input_tokens": 0 },
 *     "iterations": [ { "input_tokens": 2, "output_tokens": 106, ... } ] }
 *
 * Corpus-wide, `iterations.length` is 1 in 76,878 of the 76,884 entries that
 * carry one and 0 in the other 6 — NEVER GREATER. So summing iterations as well
 * as the parent is wrong by EXACTLY 2.00x on every number, uniformly, which is
 * the worst failure mode available: a uniform doubling reads as a plausible
 * total rather than as a bug. On the largest Chorus transcript, both ways:
 * CE 9,197,338 -> 18,394,675, RLIT 2,453,116 -> 4,906,232, Naive 45,379,703 ->
 * 90,759,406. **Read the parent's own keys. Never recurse.**
 */
export function ledgerEntryTotals(usage: unknown): LedgerEntry | null {
  const u = asRecord(usage)
  if (u === null) return null

  const present =
    'input_tokens' in u ||
    'cache_creation_input_tokens' in u ||
    'cache_read_input_tokens' in u ||
    'output_tokens' in u ||
    'cache_creation' in u
  if (!present) return null

  const input = counter(u.input_tokens)
  const cacheWrite = counter(u.cache_creation_input_tokens)
  const cacheRead = counter(u.cache_read_input_tokens)
  const output = counter(u.output_tokens)

  const breakdown = asRecord(u.cache_creation)
  const eph5m = breakdown === null ? 0 : counter(breakdown.ephemeral_5m_input_tokens)
  const eph1h = breakdown === null ? 0 : counter(breakdown.ephemeral_1h_input_tokens)

  return {
    ce:
      input +
      CE_WEIGHT_EPHEMERAL_5M * eph5m +
      CE_WEIGHT_EPHEMERAL_1H * eph1h +
      CE_WEIGHT_CACHE_READ * cacheRead,
    rlit: input + cacheWrite,
    naive: input + cacheWrite + cacheRead,
    outputTokens: output,
    // An absent `cache_creation` is the degenerate case of the same check
    // (0 − scalar) and needs no second counter.
    cacheWriteDrift: eph5m + eph1h - cacheWrite
  }
}

/* ------------------------------------------------------------------ */
/* The two string rules                                                */
/* ------------------------------------------------------------------ */

/**
 * `…/projects/<enc>/<id>.jsonl` -> `…/projects/<enc>/<id>/subagents`.
 * `null` when the input does not end `.jsonl`, because "that is not a transcript
 * path" is a real answer and must not produce a plausible directory.
 *
 * ⚠ `node:path` IS BANNED HERE, AND NOT OUT OF PURISM: `path.join` on win32
 * rewrites `/` to `\`, so one input would give different output here and on a
 * POSIX CI — a pure function that is not. The separator actually seen in the
 * input is the separator used in the output.
 *
 * ⚠ AND THE CALLER MUST NOT RECURSE THE RESULT. All 83 such directories on this
 * machine sit at exactly `<project>/<sessionId>/subagents` with none nested, and
 * even `spawnDepth: 2` subagents write into that same flat directory. Recursion
 * buys nothing and would let a symlink take the service somewhere it was never
 * asked to read.
 */
export function subagentDirFor(transcriptPath: string): string | null {
  if (!/\.jsonl$/i.test(transcriptPath)) return null

  const withoutExt = transcriptPath.slice(0, transcriptPath.length - '.jsonl'.length)
  // The LAST separator in the path is the one this path is written with; a path
  // with none (a bare file name) joins with '/'.
  let separator = '/'
  for (let i = withoutExt.length - 1; i >= 0; i--) {
    const ch = withoutExt[i]
    if (ch === '/' || ch === '\\') {
      separator = ch
      break
    }
  }
  return withoutExt + separator + 'subagents'
}

/**
 * Does this `readdir` entry name a subagent TRANSCRIPT?
 *
 * ⚠ TWO THINGS RIDE ON THE `.jsonl` ANCHOR. First, it rejects the
 * `agent-<id>.meta.json` sibling that sits beside every subagent transcript —
 * measured 228 meta files to 227 transcripts, one subagent having written a meta
 * and never a transcript — so a glob of `agent-*` would read a file that is not
 * a transcript AND would open the human-written `description` the meta carries,
 * which is content the header note forbids. Second, the separator-excluding
 * character class doubles as a traversal guard on a name arriving from `readdir`.
 */
export function isSubagentTranscriptName(fileName: string): boolean {
  return /^agent-[^\\/]+\.jsonl$/i.test(fileName)
}

/* ------------------------------------------------------------------ */
/* The scan                                                            */
/* ------------------------------------------------------------------ */

interface MutableTotals {
  ce: number
  rlit: number
  naive: number
  outputTokens: number
  entries: number
}

const zeroTotals = (): MutableTotals => ({ ce: 0, rlit: 0, naive: 0, outputTokens: 0, entries: 0 })

const freeze = (t: MutableTotals): LedgerTotals => ({
  ce: t.ce,
  rlit: t.rlit,
  naive: t.naive,
  outputTokens: t.outputTokens,
  entries: t.entries
})

/**
 * Scan whole transcripts and total them, per origin and overall.
 *
 * ─── THE PARSE, RULE BY RULE ──────────────────────────────────────────────
 *  1. Split on newline, trim, skip empty lines and any line not starting `{`.
 *     `JSON.parse` in a try; a throw counts as `unparseableLines` and continues.
 *     ⚠ NO LOGGING, and a trailing partial line is EXPECTED rather than an error
 *     case — a transcript is appended to while it is read, so a warn-per-partial
 *     would be a log flood describing normal operation.
 *  2. Require `entry.type === 'assistant'`; anything else is `nonAssistantEntries`.
 *     Measured: 84,170 of 84,170 usage-bearing entries are `assistant`, and no
 *     other type carried a usage object.
 *  3. Read `entry.message.usage`. ⚠ `entry.usage` DOES NOT EXIST — 0 entries
 *     carried a top-level one, so there is no fallback. A fallback that never
 *     fires is untested code that one day fires.
 *  4. `ledgerEntryTotals` returns null for an entry with no counters at all;
 *     that is `assistantEntriesWithoutUsage`, not a zero.
 *  5. `at` = `Date.parse(entry.timestamp)` when it is a string and the result is
 *     finite, else null plus `turnsWithoutTimestamp`. ⚠ `Date.parse` IS A PURE
 *     STRING->NUMBER FUNCTION, NOT A CLOCK READ, and does not violate this
 *     module's no-`Date.now()` rule — said plainly so nobody "fixes" it.
 *  6. ⚠ `isSidechain` IS READ AND DELIBERATELY DOES NOT GATE THE SUM. The
 *     obvious move is to copy `contextUsageCore.ts:209`'s skip. That would
 *     reproduce the very bug this ledger exists to fix: inside a subagent file
 *     those lines are the subagent's OWN turns (true on 109 of 109 lines of a
 *     sampled one) and are exactly the cost being surfaced. The ring skips them
 *     because it wants the newest MAIN-thread context; a ledger wants the spend.
 *
 * ⚠ ON A CONSISTENCY VIOLATION: NEITHER THROW NOR SILENTLY PREFER A SOURCE.
 * `CE` keeps the TTL breakdown, `RLIT`/`Naive` keep the scalar, and
 * `consistency.driftTokens` accumulates the signed difference so a reader sees
 * magnitude and not merely a count. That is `contextUsageCore`'s house
 * convention exactly: nothing in that file throws or logs either.
 *
 * ─── PER-TASK NORMALISATION, HONESTLY ─────────────────────────────────────
 * Engine spec §5 requires normalising per COMPLETED TASK. ⚠ A TRANSCRIPT CANNOT
 * TELL YOU WHERE A TASK ENDS: its per-entry fields are `uuid`, `parentUuid`,
 * `sessionId`, `requestId`, `timestamp`, `cwd`, `gitBranch`, `version`,
 * `effort`, `agentId`, `entrypoint` — none marks completion — and §7's own A/B
 * protocol defines a task EXTERNALLY (three shapes x five reps, git-reset
 * between runs). Inferring a boundary from a timestamp gap would be a fabricated
 * denominator wearing a measurement's clothes.
 *
 * So this core reports PER-SCAN totals plus `turns[]` — every turn's four
 * numbers positioned in wall-clock time — and per-task folding is the CALLER's
 * job. It lands in Task 10.1-3, which holds the only real task boundary Chorus
 * owns: a `dispatches` row's `[startedAt, endedAt]`. Summing the turns in that
 * window is one filter and one reduce.
 *
 * ⚠ Two limits the caller inherits and must not paper over: a turn's timestamp
 * is when the reply was WRITTEN while its tokens were charged for the request
 * BEFORE it, so a turn straddling a window edge can land on the wrong side; and
 * a session with no dispatch row — a pane driven by hand — has no boundary at
 * all and can only be reported per-session.
 */
export function scanLedger(sources: readonly LedgerSource[]): LedgerScan {
  const totals: Record<LedgerOrigin, MutableTotals> = { main: zeroTotals(), subagent: zeroTotals() }
  const turns: LedgerTurn[] = []
  let checked = 0
  let mismatches = 0
  let driftTokens = 0
  let unparseableLines = 0
  let nonAssistantEntries = 0
  let assistantEntriesWithoutUsage = 0
  let turnsWithoutTimestamp = 0
  let subagentSources = 0

  for (const source of sources) {
    if (source.origin === 'subagent') subagentSources++

    for (const rawLine of source.text.split('\n')) {
      const line = rawLine.trim()
      if (line.length === 0 || !line.startsWith('{')) continue

      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        unparseableLines++
        continue
      }

      const entry = asRecord(parsed)
      if (entry === null) {
        unparseableLines++
        continue
      }
      if (entry.type !== 'assistant') {
        nonAssistantEntries++
        continue
      }

      const message = asRecord(entry.message)
      const totalsForEntry = ledgerEntryTotals(message?.usage)
      if (totalsForEntry === null) {
        assistantEntriesWithoutUsage++
        continue
      }

      const bucket = totals[source.origin]
      bucket.ce += totalsForEntry.ce
      bucket.rlit += totalsForEntry.rlit
      bucket.naive += totalsForEntry.naive
      bucket.outputTokens += totalsForEntry.outputTokens
      bucket.entries++

      checked++
      if (totalsForEntry.cacheWriteDrift !== 0) {
        mismatches++
        driftTokens += totalsForEntry.cacheWriteDrift
      }

      let at: number | null = null
      if (typeof entry.timestamp === 'string') {
        const parsedAt = Date.parse(entry.timestamp)
        if (Number.isFinite(parsedAt)) at = parsedAt
      }
      if (at === null) turnsWithoutTimestamp++

      turns.push({
        ce: totalsForEntry.ce,
        rlit: totalsForEntry.rlit,
        naive: totalsForEntry.naive,
        outputTokens: totalsForEntry.outputTokens,
        at,
        origin: source.origin
      })
    }
  }

  // Ascending by `at`, null-`at` last in encounter order. A stable sort is
  // guaranteed by the language, so equal timestamps keep their file order.
  turns.sort((a, b) => {
    if (a.at === null && b.at === null) return 0
    if (a.at === null) return 1
    if (b.at === null) return -1
    return a.at - b.at
  })

  const total: MutableTotals = {
    ce: totals.main.ce + totals.subagent.ce,
    rlit: totals.main.rlit + totals.subagent.rlit,
    naive: totals.main.naive + totals.subagent.naive,
    outputTokens: totals.main.outputTokens + totals.subagent.outputTokens,
    entries: totals.main.entries + totals.subagent.entries
  }

  return {
    total: freeze(total),
    main: freeze(totals.main),
    subagent: freeze(totals.subagent),
    subagentSources,
    turns,
    consistency: { checked, mismatches, driftTokens },
    skips: {
      unparseableLines,
      nonAssistantEntries,
      assistantEntriesWithoutUsage,
      turnsWithoutTimestamp
    }
  }
}
