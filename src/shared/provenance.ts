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
