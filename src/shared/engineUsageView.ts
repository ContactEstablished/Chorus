import type { LedgerMetric, LedgerRow, LedgerSnapshot } from './ipc'

/**
 * Engine Phase 10.1, Task 10.1-4: every rule the usage panel applies, in one
 * pure module the component may not second-guess.
 *
 * ⚠ D186 — THE COMPONENT CONTAINS NO `if` THAT DECIDES WHAT CHORUS IS CLAIMING.
 * There are no component tests in this repo and this task must not add a runner
 * for them, so a rule written in a `.vue` is a rule nothing can check. The
 * classification, the bar geometry, the ratio wording and the coverage sentence
 * are all decided here and asserted in `engineUsageView.test.ts`; the panel
 * renders what it is handed.
 *
 * ─── ⚠ THE THREE STATES, AND WHY COLLAPSING ANY TWO IS THE FAILURE ────────
 *
 *   measured   we read it. Digits, and a bar.
 *   unknown    we CAN read this agent, but this row has no token data.
 *   no-source  we CANNOT read this agent at all.
 *
 * The first two are the D-a distinction carried to the screen: 403 of the 468
 * dispatch rows on this machine have no token data, and drawing them as `0`
 * claims those sessions were free. ⚠ So an `unknown` row carries NO BAR
 * GEOMETRY AT ALL — the field is absent, not zero — because a zero-height bar
 * is a zero drawn in a different colour.
 *
 * The second and third are the distinction that is easiest to lose and most
 * misleading when lost: `unknown` is probably temporary (scan it and a number
 * appears), `no-source` is permanent for that agent. ⚠ A `no-source` row shows
 * ONE SENTENCE AND NO DASHES, because a dash means "we looked and found
 * nothing" — a different and wrong claim for an agent Chorus cannot read.
 */

export type UsageRowState = 'measured' | 'unknown' | 'no-source'

/**
 * One drawable bar.
 *
 * ⚠ THIS SHAPE ONLY EXISTS FOR A `measured` METRIC. There is deliberately no
 * "empty" variant and no zero width: an unknown metric has no `bar` field at
 * all, so the component cannot render a zero-height bar even by accident.
 */
export interface UsageBar {
  /** 0–100, linear, relative to the largest metric in this row. */
  readonly widthPercent: number
  /** The main-transcript share of `widthPercent`, or null when unsplit. */
  readonly mainPercent: number | null
  /** The subagent share of `widthPercent`, or null when unsplit. */
  readonly subagentPercent: number | null
}

export interface UsageMetricView {
  readonly key: 'ce' | 'rlit' | 'naive' | 'output'
  readonly label: string
  /** What this number is, for the column header's title attribute. */
  readonly description: string
  /** Digits for a measured metric; `—` for unknown. Never `0` for unknown. */
  readonly text: string
  readonly measured: boolean
  /** ⚠ ABSENT when not measured. Never a zero-width bar. */
  readonly bar?: UsageBar
}

export interface UsageRowView {
  readonly sessionId: string
  readonly agent: string
  readonly title: string
  readonly startedAt: string
  readonly state: UsageRowState
  /** Empty for `no-source` — that row shows a sentence, not columns. */
  readonly metrics: readonly UsageMetricView[]
  /** Present only for `no-source`. */
  readonly noSourceText?: string
  /** `Naive is 5.0x CE, 18.5x RLIT` — present only when both are measured. */
  readonly ratioText: string | null
  /** `Subagents: 61% of CE, 75% of RLIT` — or the honest unsplit sentence. */
  readonly subagentText: string | null
}

export interface UsageView {
  readonly rows: readonly UsageRowView[]
  /** `65 of 467 dispatches in this project carry token data`. */
  readonly coverageText: string
  readonly measuredCount: number
  readonly totalCount: number
}

const METRIC_DEFS = [
  {
    key: 'ce' as const,
    label: 'CE',
    description:
      'Cost-equivalent tokens: a cache write counts above a fresh token and a cache read far below one.'
  },
  {
    key: 'rlit' as const,
    label: 'RLIT',
    description: 'Rate-limit input tokens: exactly what counts against your per-minute limit.'
  },
  {
    key: 'naive' as const,
    label: 'Naive',
    description:
      'Counts a cache read as if it were a fresh token; the industry default, and the reason the other two look small.'
  },
  {
    key: 'output' as const,
    label: 'Output',
    description:
      'Raw output tokens, never folded into the others: a fall here is the signature of thinking being switched off, which a blended total would hide as a saving.'
  }
]

/** `1,234,567` — the panel never shows a bare unpunctuated million. */
function formatCount(value: number): string {
  return Math.round(value).toLocaleString('en-US')
}

/** `5.0x`. One decimal: the finding is the order of magnitude, not the digits. */
function formatRatio(numerator: number, denominator: number): string | null {
  if (denominator <= 0) return null
  return `${(numerator / denominator).toFixed(1)}x`
}

function percentOf(part: number, whole: number): number | null {
  if (whole <= 0) return null
  return Math.round((part / whole) * 100)
}

/**
 * ⚠ `hasSource === false` WINS OVER EVERYTHING, INCLUDING A MEASURED NUMBER.
 * If Chorus has no reader for an agent then any number attached to it came from
 * somewhere unaccounted for, and reporting it would be worse than reporting
 * nothing.
 */
export function classifyRow(row: LedgerRow): UsageRowState {
  if (!row.hasSource) return 'no-source'
  return row.ce.total === null ? 'unknown' : 'measured'
}

function metricViews(row: LedgerRow): UsageMetricView[] {
  const metrics: Record<string, LedgerMetric> = {
    ce: row.ce,
    rlit: row.rlit,
    naive: row.naive,
    output: row.output
  }
  // Linear, normalised to the largest value in THIS row. ⚠ NOT a log scale: a
  // log axis compresses exactly the 5x-19x gap this panel exists to show, which
  // would make the chart argue against its own point.
  const largest = Math.max(
    0,
    ...Object.values(metrics).map((m) => (m.total === null ? 0 : m.total))
  )

  return METRIC_DEFS.map((def) => {
    const metric = metrics[def.key]
    if (metric.total === null) {
      // ⚠ NO `bar` KEY. Not a zero-width one — absent.
      return { ...def, text: '—', measured: false }
    }
    const widthPercent = largest > 0 ? (metric.total / largest) * 100 : 0
    const mainPercent =
      metric.main === null || metric.total <= 0 ? null : (metric.main / metric.total) * widthPercent
    const subagentPercent =
      metric.subagent === null || metric.total <= 0
        ? null
        : (metric.subagent / metric.total) * widthPercent
    return {
      ...def,
      text: formatCount(metric.total),
      measured: true,
      bar: { widthPercent, mainPercent, subagentPercent }
    }
  })
}

function ratioTextFor(row: LedgerRow): string | null {
  if (row.naive.total === null || row.ce.total === null || row.rlit.total === null) return null
  const vsCe = formatRatio(row.naive.total, row.ce.total)
  const vsRlit = formatRatio(row.naive.total, row.rlit.total)
  if (vsCe === null && vsRlit === null) return null
  const parts: string[] = []
  if (vsCe !== null) parts.push(`${vsCe} CE`)
  if (vsRlit !== null) parts.push(`${vsRlit} RLIT`)
  return `Naive is ${parts.join(', ')}`
}

/**
 * ⚠ AN UNSPLIT ROW SAYS SO RATHER THAN READING AS 100% MAIN THREAD. `subagent:
 * null` means the subagent files were not read; `subagent: 0` means they were
 * read and there was no subagent work. Rendering the first as "0%" is the same
 * class of lie as rendering `unknown` as zero, one level down.
 */
function subagentTextFor(row: LedgerRow): string | null {
  if (row.ce.total === null) return null
  if (row.ce.subagent === null) return 'Subagent files were not read for this session.'
  const cePct = percentOf(row.ce.subagent, row.ce.total)
  const rlitPct =
    row.rlit.total === null || row.rlit.subagent === null
      ? null
      : percentOf(row.rlit.subagent, row.rlit.total)
  if (cePct === null) return null
  const parts = [`${cePct}% of CE`]
  if (rlitPct !== null) parts.push(`${rlitPct}% of RLIT`)
  return `Subagents: ${parts.join(', ')}`
}

export function buildUsageView(snapshot: LedgerSnapshot): UsageView {
  const rows = snapshot.rows.map((row): UsageRowView => {
    const state = classifyRow(row)
    const base = {
      sessionId: row.sessionId,
      agent: row.agent,
      title: row.title ?? 'Untitled session',
      startedAt: row.startedAt,
      state
    }
    if (state === 'no-source') {
      // ⚠ One sentence and NOTHING else. No dashes: a dash would claim we
      // looked. See the header note.
      return {
        ...base,
        metrics: [],
        noSourceText: `No token source for ${row.agent}.`,
        ratioText: null,
        subagentText: null
      }
    }
    return {
      ...base,
      metrics: metricViews(row),
      ratioText: ratioTextFor(row),
      subagentText: subagentTextFor(row)
    }
  })

  // ⚠ THE DENOMINATOR IS NAMED, because a total over mostly-NULL rows is the
  // same lie one level up. Both numbers come from main; neither is derived from
  // the other, because they genuinely disagree (a row can carry a null
  // `tokens_in` beside a non-null sibling).
  const { dispatchesWithTokens: measured, dispatchesTotal: total } = snapshot
  const coverageText =
    total === 0
      ? 'No dispatches recorded for this project yet.'
      : `${formatCount(measured)} of ${formatCount(total)} dispatches in this project carry token data.`

  return { rows, coverageText, measuredCount: measured, totalCount: total }
}
