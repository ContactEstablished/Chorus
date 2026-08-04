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

/* D109's confirm wording lives in `src/shared/councilDocket.ts`, because the
 * renderer is what shows it and this module is main-only — it imports the
 * database row types. */
