/**
 * The provenance measurement's user-facing wording (Task 6-4, D55/D126/F49),
 * shared because the renderer shows it and it must be testable without a
 * browser.
 *
 * ⚠ NOT ASSEMBLED IN THE VIEW — the `projectLifecycle.ts` precedent, and it
 * applies here with the same force. This repo has NO `.vue` tests at all, so a
 * sentence built in a template is not merely under-tested, it is UNREACHABLE by
 * the suite. The one number this phase exists to produce is exactly the number
 * that must not be assembled somewhere nothing checks.
 *
 * ⚠ AND IT LIVES IN `shared/` RATHER THAN IN `main/services/provenanceCore.ts`
 * FOR A HARDER REASON THAN TIDINESS: the renderer may not import main-process
 * code. `provenanceCore` re-exports these so there is still ONE home for the
 * wording, and main keeps the Cypher.
 */

export interface Completeness {
  readonly withSource: number
  readonly total: number
  /** ⚠ `"N of M"`, NEVER A BARE COUNT AND NEVER A LONE PERCENTAGE (D55). */
  readonly text: string
}

/**
 * ⚠ RETURNS THE PAIR, NOT A PERCENTAGE, AND 0-OF-0 IS `"0 of 0"` — not `NaN`,
 * not 100%. An empty graph is not fully attributed; it is empty, and those are
 * different facts. A ratio computed here would be the decorative number D55
 * exists to prevent, and the one a reader would quote back.
 */
export function completeness(withSource: number, total: number): Completeness {
  const safeTotal = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0
  const safeWith = Number.isFinite(withSource) && withSource > 0 ? Math.floor(withSource) : 0
  // A numerator above the denominator is a bug upstream, not something to
  // render: clamp so the sentence cannot read "7 of 3".
  const clamped = Math.min(safeWith, safeTotal)
  return { withSource: clamped, total: safeTotal, text: `${clamped} of ${safeTotal}` }
}

/**
 * The affected list's own denominator. ⚠ A BOUNDED LIST RENDERED BARE LOOKS
 * COMPLETE, which is D55 one level down — so when it is truncated it says so.
 */
export function affectedLabel(shown: number, affectedTotal: number): string {
  return shown < affectedTotal
    ? `showing ${shown} of ${affectedTotal}`
    : `${shown} of ${affectedTotal}`
}

/**
 * The sentence that must accompany any completeness figure.
 *
 * ⚠ THE HONEST SENTENCE IS THE FEATURE HERE. It is a constant rather than copy
 * typed into a template so that it cannot drift into something implying
 * enforcement, and so a test can assert what it does NOT say — no repair
 * workflow, no trend, no per-agent breakdown, none of which exist (D128(c)).
 */
export const PROVENANCE_DISCLAIMER =
  'Chorus measures provenance; it cannot require it — agents write to the graph directly. This counts memories that are current, cite a file or commit, and name the session that produced them.'

/* ─────────────────────────────────────────────────────────────────────────
 * Task 6b-1 (D168, amended by D173): the memory-usage sentences. Same home,
 * same reason — the renderer shows them, main builds them, and the one
 * surface this phase will be screenshotted on must not assemble its own
 * number in a template nothing tests.
 * ───────────────────────────────────────────────────────────────────────── */

/** ⚠ SINGULAR AND PLURAL, because "1 reads" in the one place this project will
 *  screenshot for a milestone is exactly the detail that undermines it. */
function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

/**
 * The project's memory-usage line, WITH ITS DENOMINATOR (D55).
 *
 * ⚠ THE SHAPE IS FIXED BY D173 (Q2) AND IS NOT A WORDING CHOICE:
 *
 *     R successful memory reads · W memory writes
 *     across K Claude Code sessions observed since <day>
 *
 * ⚠ "SUCCESSFUL" IS EARNED BY MEASUREMENT, NOT ADDED FOR TONE. A failed tool
 * call fires `PostToolUseFailure`, a separate event this instrument does not
 * count (measured 2026-08-19, claude 2.1.235 — `_verify/6b-4/hookprobe/`,
 * re-measured `_verify/6b-1/hookprobe/`), so every counted read really did
 * return a result. If that split ever goes, this word must go with it.
 *
 * ⚠ "CLAUDE CODE" IS LOAD-BEARING AND MUST NOT BE TIDIED AWAY. The instrument is
 * a Claude Code hook bus; CODEX HAS NO HOOK BUS, so a codex pane can only ever
 * contribute a zero. An unqualified "K sessions" would claim all-agent coverage
 * this cannot provide and would report unmeasurable panes as measured non-use.
 * The SQL filters `agent = 'claude'` to match (`storage.ts`
 * `getProjectMemoryUsage`); the filter and this wording move together.
 *
 * ⚠ "MEMORY WRITES" IS TOOL-LEVEL AND ITS LIMIT TRAVELS WITH IT: a successful
 * `write_neo4j_cypher` is not yet a SOURCED memory, and the validator is the
 * write-side truth (D173). The disclosure paragraph beside this line carries
 * that, and the milestone reads `memory:validate`, not W.
 *
 * ⚠ THE DATE IS THE ISO DAY, NOT A LOCALE FORMAT. `toLocaleDateString` would
 * make this function's test depend on the runner's locale and time zone — a
 * pinned assertion that passes here and fails elsewhere. `since.slice(0, 10)`
 * is the UTC day, deterministic, and already the format every other date in
 * this codebase is stored in.
 *
 * ⚠ THE EMPTY CASE SAYS SO. "0 reads · 0 writes across 0 sessions since —" is a
 * number with a denominator of zero, which is the D55 failure wearing a
 * denominator as a disguise.
 */
export function memoryUsageLine(
  reads: number,
  writes: number,
  sessions: number,
  since: string | null
): string {
  if (!since) return 'these counters have not been installed yet'
  const day = since.slice(0, 10)
  if (sessions === 0) {
    return `no Claude Code sessions have run in this project since the counters were added on ${day}`
  }
  return (
    `${count(reads, 'successful memory read')} · ${count(writes, 'memory write')} ` +
    `across ${count(sessions, 'Claude Code session')} observed since ${day}`
  )
}

/** ⚠ THE LOWER-BOUND DISCLOSURE, AS A TESTED CONSTANT RATHER THAN TEMPLATE PROSE
 *  (D173 Q2). The counters are written per receipt and monotonically, which
 *  NARROWS the loss window to one receipt — it does not close it: a session
 *  restarted mid-life keeps its highest registration's numbers, not their sum.
 *  Saying "totals are a lower bound" is the difference between a measurement
 *  and a precise-looking claim the instrument cannot support. */
export const MEMORY_USAGE_LOWER_BOUND_NOTE =
  'Totals are a lower bound: counts are saved as each tool call completes, but a session ' +
  'restarted mid-life resumes from zero, so its row keeps the highest run rather than the sum.'

/**
 * The per-project breakdown line — `null` when there is nothing to show.
 *
 *     P read-first · I inconclusive · S shell-first of the same K Claude Code sessions
 *
 * ⚠ IT CARRIES THE SAME DENOMINATOR K AS THE HEADLINE, deliberately restated
 * rather than assumed: a bare "2 inconclusive" is exactly the naked numerator
 * D55 exists to refuse, and all four numbers come from the same `COUNT(*)` scan
 * over the same rows.
 *
 * ⚠ `read-first` IS THE MILESTONE'S HEADLINE CLAUSE, SHOWN AS A TREND. The
 * per-row flag answers "did THIS session read the graph before exploring"; only
 * the roll-up answers "is this getting better", which is the question every
 * later task in this phase is actually asking. It is put HERE rather than in
 * the main line because D173 fixed that line's shape word for word and
 * extending it would be this code overruling the finding it is folding in.
 *
 * ⚠ P IS A PASS COUNT, AND I IS NOT ITS COMPLEMENT. `P + I` does not have to
 * equal K and usually will not: a session can be neither — it explored first,
 * or never touched the graph at all. Do not let a caller compute "failures" as
 * `K - P`; that number would fold "we cannot say" together with "it did not",
 * which is the exact conflation D173 introduced INCONCLUSIVE to prevent.
 *
 * ⚠ NEITHER I NOR S IS A FAILURE COUNT. `inconclusive` means an unrecognised
 * tool ran before the first memory read, so this build declines to judge the
 * ordering; `shell-first` means a shell command completed first, which is a
 * SIGNAL, never a verdict — `Bash` is out of the pass/fail set precisely because
 * `npm test` and `ls` are indistinguishable without `tool_input`.
 */
export function memoryBreakdownLine(
  readFirst: number,
  inconclusive: number,
  shellFirst: number,
  sessions: number
): string | null {
  if (readFirst === 0 && inconclusive === 0 && shellFirst === 0) return null
  return (
    `${readFirst} read-first · ${inconclusive} inconclusive · ${shellFirst} shell-first ` +
    `of the same ${count(sessions, 'Claude Code session')}`
  )
}

/**
 * The live per-session pair for a filmstrip card.
 *
 * ⚠ RETURNS `null` FOR A SESSION THAT HAS DONE NEITHER, so the card renders
 * NOTHING rather than "0 reads · 0 writes". That is the context ring's rule
 * verbatim (`stores/session.ts`): a zero is a claim, and "this agent has not
 * touched the graph" is not a claim worth putting on every card in the strip.
 * The emptiness is decided HERE, where a test can reach it, rather than by a
 * `v-if` in a template nothing tests.
 *
 * `full` carries the denominator ("this session") for the tooltip; `short` is
 * what fits beside the ring.
 */
export interface SessionMemoryText {
  readonly short: string
  readonly full: string
}
export function sessionMemoryLine(reads: number, writes: number): SessionMemoryText | null {
  if (reads === 0 && writes === 0) return null
  return {
    short: `${count(reads, 'read')} · ${count(writes, 'write')}`,
    full: `Project memory, this session: ${count(reads, 'graph read')} · ${count(writes, 'memory write')}`
  }
}
