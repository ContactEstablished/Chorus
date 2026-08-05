import {
  computeDisagreement,
  parseArbiterVerdicts,
  summariseQuestions,
  type ArbiterVerdict,
  type QuestionSummary
} from './councilCore'
import type { CouncilRunRow } from '../db/schema'
import type { CouncilRunStats } from './storage'

/**
 * The Docket: the PURE half of per-project council history (D112–D115).
 *
 * No `electron`, no `fetch`, no storage, NO CLOCK. The precedent is
 * `councilCore.ts` ↔ `councilService.ts`, and the reason is the same one that
 * file gives: every branch that leaks into the service becomes a branch only a
 * billable live run can exercise. A history view has a second version of that
 * problem — its interesting cases are runs that crashed, ran without reporting
 * usage, or ended in a state nobody has produced since 3b-3, and none of those
 * can be conjured on demand. They can all be written down as a row here.
 *
 * ⚠ THIS MODULE'S WHOLE JOB IS REFUSING TO INVENT NUMBERS. Three rules from the
 * roadmap converge on the Docket row and every one of them is a null this file
 * has to carry rather than smooth over:
 *
 *   • **D55** — no number without its denominator. A token total summed from 30
 *     turns out of 48 is not the run's token total, and says so.
 *   • **D76** — omit rather than stub. An absent figure renders as nothing, never
 *     as `0`, `—`, or `$0.00`.
 *   • **F42** — `council_runs.cost_usd` measured 37–60% UNDER the real bill, and
 *     a stored row carries no settlement flag the way a live response does. So
 *     the cost that leaves here is explicitly a FLOOR (D115), and there is
 *     deliberately no function in this file that adds two of them together.
 */

/* ------------------------------------------------------------------ */
/* 1. Vocabulary                                                       */
/* ------------------------------------------------------------------ */

/**
 * One row of the Docket, already reduced to what the view renders.
 *
 * ⚠ EVERY NULLABLE FIELD HERE IS NULLABLE ON PURPOSE and none of them may be
 * defaulted downstream. The shape is the contract: if this file could not
 * establish a figure honestly, the field is null and the view omits it.
 */
export interface DocketRow {
  runId: string
  /**
   * ⚠ A DISPLAY LABEL, NOT AN IDENTITY. `basename(brief_path)` is what a person
   * recognises, but two projects can hold the same filename and a rename breaks
   * it, so nothing joins on this — CR-3f.1's action A1 forbids a path in a join
   * predicate and honouring it now costs nothing. `runId` is the identity.
   */
  label: string
  /** The full path, for the row's tooltip — the label's disambiguator. */
  briefPath: string
  /** One of `COUNCIL_RUN_STATUSES`. The row's single status affordance. */
  status: string
  startedAt: string
  /** NULL = the run's end was never observed (a crash the boot heal renamed, or
   *  a run still in flight). */
  endedAt: string | null
  /**
   * Whole milliseconds between the two timestamps, or null when there is no
   * honest span to report.
   *
   * ⚠ NEVER MEASURED AGAINST "NOW". An abandoned run from March would otherwise
   * render a five-month duration, which is not how long it ran — it is how long
   * ago it died. Those are different facts and only one of them is stored.
   */
  durationMs: number | null
  turns: number
  tokensIn: number | null
  tokensOut: number | null
  /** True when some turns reported usage and others did not, so the view knows to
   *  print the denominator instead of a bare total (D55). */
  tokensArePartial: boolean
  turnsWithTokens: number
  /** ⚠ A FLOOR, NOT A TOTAL (D115/F42). Null when the run never recorded one. */
  costFloorUsd: number | null
  /** Whether a findings document was ever written for this run. Its readability
   *  is a filesystem question answered later, by main, on open. */
  hasFindings: boolean
}

/* ------------------------------------------------------------------ */
/* 2. Shaping                                                          */
/* ------------------------------------------------------------------ */

/**
 * Turn a stored run plus its message aggregate into a row.
 *
 * `stats` is `undefined` when the run has no messages at all — the absence
 * `getCouncilRunStats` deliberately leaves in its map. That is a real state
 * (a run that failed before its first turn landed) and it reads as zero TURNS,
 * which is true, but as null TOKENS, which is also true and is not the same
 * statement.
 */
export function toDocketRow(run: CouncilRunRow, stats: CouncilRunStats | undefined): DocketRow {
  const turns = stats?.turns ?? 0
  const turnsWithTokens = stats?.turnsWithTokens ?? 0
  return {
    runId: run.id,
    label: labelForBrief(run.briefPath),
    briefPath: run.briefPath,
    status: run.status,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    durationMs: durationMs(run.startedAt, run.endedAt),
    turns,
    tokensIn: stats?.tokensIn ?? null,
    tokensOut: stats?.tokensOut ?? null,
    // Partial only when SOME turns reported and some did not. All-or-nothing is
    // not partial: zero reporting turns is an absent total (already null above),
    // and every turn reporting is a whole one.
    tokensArePartial: turnsWithTokens > 0 && turnsWithTokens < turns,
    turnsWithTokens,
    costFloorUsd: run.costUsd,
    hasFindings: run.findingsPath !== null
  }
}

/**
 * ⚠ SPLIT BY HAND RATHER THAN WITH `path.basename`, WHICH IS PLATFORM-DEPENDENT.
 * POSIX `basename` does not treat `\` as a separator, so on any non-Windows host
 * — a CI runner, a contributor's machine — it would hand back a whole stored
 * Windows path as the row's title, and the tests covering this would pass on the
 * dev box and fail nowhere anyone was looking. The app is Windows-only for v1;
 * its test suite should not be.
 *
 * A blank result falls back to the raw value rather than to an empty row.
 */
function labelForBrief(briefPath: string): string {
  const cut = Math.max(briefPath.lastIndexOf('/'), briefPath.lastIndexOf('\\'))
  const base = (cut >= 0 ? briefPath.slice(cut + 1) : briefPath).trim()
  return base.length > 0 ? base : briefPath
}

/**
 * Both timestamps are ISO-8601 as `councilService` wrote them.
 *
 * Returns null rather than a negative or `NaN` span: an unparseable or
 * out-of-order pair is a fact about the data, and rendering "-3s" would present
 * a storage bug as a measurement.
 */
function durationMs(startedAt: string, endedAt: string | null): number | null {
  if (endedAt === null) return null
  const start = Date.parse(startedAt)
  const end = Date.parse(endedAt)
  if (Number.isNaN(start) || Number.isNaN(end)) return null
  const span = end - start
  return span >= 0 ? span : null
}

/* ------------------------------------------------------------------ */
/* 3. The Verdict strip (D106)                                         */
/* ------------------------------------------------------------------ */

/**
 * One question, with BOTH facts D106 requires and no attempt to reconcile them.
 *
 * ⚠ THE STRIP EXISTS TO SHOW THESE TWO DISAGREEING. "The members split and the
 * arbiter approved anyway" is the single most informative thing a council can
 * report, and it is only expressible because `consensus` and `verdict` are
 * separate fields from separate sources. Nothing here ever derives one from the
 * other.
 */
export interface VerdictStripRow {
  readonly index: number
  readonly question: string
  /** ⚠ THE MEMBERS' FACT. Carried straight from `summariseQuestions` — the same
   *  computation the live glance strip and the findings document already use, so
   *  a re-read of an old run cannot disagree with what it filed at the time. */
  readonly consensus: QuestionSummary
  /**
   * ⚠ THE ARBITER'S FACT, AND ITS THREE-WAY SHAPE IS THE POINT.
   *   • a verdict — the arbiter ruled;
   *   • `'unparsed'` — the arbiter was asked and this question got no ruling;
   *   • `null` — there was no verdict block at all, so it was never asked.
   * The last case is every run recorded before D106 shipped. Rendering those
   * three the same way would tell a reader the council failed when in fact the
   * question was never put to it.
   */
  readonly verdict: ArbiterVerdict | 'unparsed' | null
}

export interface VerdictStrip {
  readonly rows: readonly VerdictStripRow[]
  /** Questions the arbiter actually ruled on. */
  readonly ruled: number
  /** Questions in the brief — `ruled`'s denominator, which D106 requires the
   *  strip to carry rather than leaving the reader to count rows. */
  readonly total: number
  /** False when no verdict block was found: this run's arbiter was never asked
   *  for one. Distinct from `ruled === 0`, which would mean asked and silent. */
  readonly arbiterAsked: boolean
}

/**
 * Build the strip from one run's stored turns.
 *
 * ⚠ PURE, AND EVERY INPUT IS SOMETHING ALREADY ON DISK. Questions come from the
 * brief the run recorded, positions and the arbitration turn from
 * `council_messages`. Nothing here needs a column that does not exist, which is
 * why the Verdict strip required no migration — and why v14 stays free for
 * Phase 6's `project_memory`.
 *
 * ⚠ IT RE-DERIVES THE CONSENSUS RATHER THAN STORING IT, and that is the same
 * measurement rather than a second one: `computeDisagreement` → `summariseQuestions`
 * is the exact chain `summariseState` runs live. The store's warning against
 * re-parsing applies to the RENDERER doing it — a second measurement free to
 * disagree with the findings file. Here, in main, with the same pure functions
 * over the same stored text, the result is identical by construction.
 */
export function assembleVerdictStrip(input: {
  readonly questions: readonly string[]
  readonly positions: readonly { readonly memberId: string; readonly content: string }[]
  /** The arbitration turn's text, or null when the run never reached one. */
  readonly arbitration: string | null
  readonly labelFor: (memberId: string) => string
}): VerdictStrip {
  const consensus = summariseQuestions({
    // ⚠ THE RAW TURNS GO IN. `computeDisagreement` calls `parseVerdicts` itself
    // (councilCore.ts:687), so pre-parsing here would not just be redundant — it
    // would be a SECOND measurement of the same text, free to drift from the one
    // the findings document was built from. Handing it the stored content is what
    // makes a re-read agree with the original run by construction.
    disagreement: computeDisagreement({ questions: input.questions, positions: input.positions }),
    labelFor: input.labelFor
  })

  // A run that failed before arbitration has no ruling to find, which reads the
  // same as one whose arbiter was never asked — because in both cases it was not.
  const ruling =
    input.arbitration === null
      ? { blockPresent: false, verdicts: new Map<number, ArbiterVerdict>() }
      : parseArbiterVerdicts(input.arbitration)

  const rows: VerdictStripRow[] = consensus.map((c) => ({
    index: c.index,
    question: c.question,
    consensus: c,
    // ⚠ The annotation is load-bearing: without it TypeScript widens the union
    // to `string | null` and the three-way distinction this feature rests on
    // stops being checkable at every call site downstream.
    verdict: ruling.blockPresent ? (ruling.verdicts.get(c.index) ?? 'unparsed') : null
  }))

  return {
    rows,
    ruled: rows.filter((r) => r.verdict !== null && r.verdict !== 'unparsed').length,
    total: rows.length,
    arbiterAsked: ruling.blockPresent
  }
}

/** Display order and short forms, most severe first. Used only for the compact
 *  Docket line; the strip itself renders the full state. */
const VERDICT_ORDER: readonly { readonly v: ArbiterVerdict; readonly short: string }[] = [
  { v: 'REJECTED', short: 'rejected' },
  { v: 'REVISE', short: 'revise' },
  { v: 'APPROVED-WITH-REVISIONS', short: 'with revisions' },
  { v: 'APPROVED', short: 'approved' },
  { v: 'INSUFFICIENT-INFORMATION', short: 'insufficient info' }
]

/**
 * One line of TEXT for a Docket row (D114 / CR-3f.1's badge economy: the row
 * already owns its single status affordance, so this is text and never a badge).
 *
 * ⚠ IT COUNTS, IT DOES NOT ROLL UP. There is deliberately no run-level verdict
 * anywhere in this feature: the arbiter rules per question and never issues one
 * overall, so reducing six rulings to a single word would put a verdict in the
 * council's mouth that it did not give. When the counts get too long to read the
 * line falls back to `n of m ruled` — a smaller true statement, not a summary
 * that guesses.
 *
 * Returns null when there is nothing honest to say, and the caller omits the
 * line entirely rather than printing an empty one (D76).
 */
export function digestFor(strip: VerdictStrip): string | null {
  if (strip.total === 0) return null
  const parts: string[] = []

  if (!strip.arbiterAsked) {
    parts.push('no arbiter ruling recorded')
  } else {
    const counts = VERDICT_ORDER.map((o) => ({
      short: o.short,
      n: strip.rows.filter((r) => r.verdict === o.v).length
    })).filter((c) => c.n > 0)
    // Three kinds of ruling across six questions is still scannable; more than
    // that is a table pretending to be a sentence.
    if (counts.length > 0 && counts.length <= 3) {
      parts.push(counts.map((c) => `${c.n} ${c.short}`).join(' · '))
    }
    parts.push(`${strip.ruled} of ${strip.total} ruled`)
  }

  // The members' half, mentioned only when it is interesting: a split is the
  // thing worth surfacing on a row, agreement is the default.
  const split = strip.rows.filter((r) => r.consensus.state === 'split').length
  if (split > 0) parts.push(`members split on ${split}`)

  return parts.join(' · ')
}

/* D109's confirm wording lives in `src/shared/councilDocket.ts`, because the
 * renderer is what shows it and this module is main-only — it imports the
 * database row types. */
