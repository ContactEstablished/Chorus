import { describe, expect, it } from 'vitest'
import { buildUsageView, classifyRow } from './engineUsageView'
import type { LedgerMetric, LedgerRow, LedgerSnapshot } from './ipc'

const metric = (total: number | null, main: number | null = null, subagent: number | null = null): LedgerMetric => ({
  total,
  main,
  subagent
})

const row = (over: Partial<LedgerRow> = {}): LedgerRow => ({
  sessionId: 's1',
  agent: 'claude',
  title: 'A session',
  startedAt: '2026-09-12T10:00:00.000Z',
  hasSource: true,
  ce: metric(null),
  rlit: metric(null),
  naive: metric(null),
  output: metric(null),
  ...over
})

const snapshot = (rows: LedgerRow[], withTokens = 0, total = 0): LedgerSnapshot => ({
  projectId: 'p1',
  rows,
  dispatchesWithTokens: withTokens,
  dispatchesTotal: total
})

/** ✅ REAL measured figures — the largest Chorus transcript. */
const REAL = {
  ce: 9197338,
  rlit: 2453116,
  naive: 45379703,
  output: 236040
}

describe('classifyRow', () => {
  it('is measured when the agent has a source and CE is a number', () => {
    expect(classifyRow(row({ ce: metric(1) }))).toBe('measured')
  })

  it('is measured for a REAL zero — 0 is a measurement, not an absence', () => {
    expect(classifyRow(row({ ce: metric(0) }))).toBe('measured')
  })

  it('is unknown when the agent has a source but no token data', () => {
    expect(classifyRow(row({ ce: metric(null) }))).toBe('unknown')
  })

  it.each(['opencode', 'kimi', 'grok', 'shell', 'voice'])(
    'is no-source for %s',
    (agent) => {
      expect(classifyRow(row({ agent, hasSource: false }))).toBe('no-source')
    }
  )

  it('is no-source for an agent string it has never heard of, rather than throwing', () => {
    expect(() => classifyRow(row({ agent: 'brand-new-cli', hasSource: false }))).not.toThrow()
    expect(classifyRow(row({ agent: 'brand-new-cli', hasSource: false }))).toBe('no-source')
  })

  /** ⚠ hasSource wins over a number: a figure attached to an agent Chorus
   *  cannot read came from somewhere unaccounted for. */
  it('is no-source even when a number is present', () => {
    expect(classifyRow(row({ agent: 'voice', hasSource: false, ce: metric(999) }))).toBe('no-source')
  })
})

describe('buildUsageView — the unknown/zero distinction', () => {
  /**
   * ⚠ THE ASSERTION THE WHOLE PANEL EXISTS FOR. A test that only checks the
   * label is `—` passes against a zero-width bar, which renders as a zero in a
   * different colour. So assert the bar FIELD IS ABSENT.
   */
  it('renders unknown as an em dash and carries NO bar geometry at all', () => {
    const view = buildUsageView(snapshot([row()], 0, 1))
    const [r] = view.rows
    expect(r.state).toBe('unknown')
    for (const m of r.metrics) {
      expect(m.text).toBe('—')
      expect(m.measured).toBe(false)
      expect('bar' in m).toBe(false)
      expect(m.bar).toBeUndefined()
    }
  })

  it('renders a measured ZERO as 0 with a bar — null and 0 produce different output', () => {
    const unknown = buildUsageView(snapshot([row({ ce: metric(null) })], 0, 1)).rows[0]
    const zero = buildUsageView(
      snapshot([row({ ce: metric(0), rlit: metric(0), naive: metric(0), output: metric(0) })], 1, 1)
    ).rows[0]

    expect(unknown.metrics[0].text).toBe('—')
    expect('bar' in unknown.metrics[0]).toBe(false)

    expect(zero.state).toBe('measured')
    expect(zero.metrics[0].text).toBe('0')
    expect('bar' in zero.metrics[0]).toBe(true)
  })
})

describe('buildUsageView — no-source rows', () => {
  it('produces one sentence and NO metric columns, so there are no dashes', () => {
    const view = buildUsageView(snapshot([row({ agent: 'voice', hasSource: false })], 0, 1))
    const [r] = view.rows
    expect(r.state).toBe('no-source')
    expect(r.metrics).toEqual([])
    expect(r.noSourceText).toBe('No token source for voice.')
    // ⚠ A dash would claim we looked and found nothing — a different claim.
    expect(JSON.stringify(r)).not.toContain('—')
  })
})

describe('buildUsageView — the gap, which is the finding', () => {
  const measured = row({
    ce: metric(REAL.ce),
    rlit: metric(REAL.rlit),
    naive: metric(REAL.naive),
    output: metric(REAL.output)
  })

  it('normalises bars linearly to the largest metric in the row', () => {
    const [r] = buildUsageView(snapshot([measured], 1, 1)).rows
    const by = Object.fromEntries(r.metrics.map((m) => [m.key, m]))
    expect(by.naive.bar!.widthPercent).toBe(100)
    // ⚠ RLIT is a sliver beside Naive, and the sliver IS the point. A log scale
    // would compress this to look comparable, which is why it is banned.
    expect(by.rlit.bar!.widthPercent).toBeLessThan(6)
    expect(by.ce.bar!.widthPercent).toBeGreaterThan(by.rlit.bar!.widthPercent)
    expect(by.naive.bar!.widthPercent).toBeGreaterThan(by.ce.bar!.widthPercent)
  })

  /** Asserted as LITERALS, not recomputed with the same expression as the
   *  code — a test that repeats the implementation proves only that it is
   *  self-consistent. */
  it('states the ratios in words', () => {
    const [r] = buildUsageView(snapshot([measured], 1, 1)).rows
    expect(r.ratioText).toBe('Naive is 4.9x CE, 18.5x RLIT')
  })

  it('has no ratio text when a term is unknown', () => {
    const [r] = buildUsageView(snapshot([row({ ce: metric(5) })], 1, 1)).rows
    expect(r.ratioText).toBeNull()
  })

  it('formats counts with separators', () => {
    const [r] = buildUsageView(snapshot([measured], 1, 1)).rows
    expect(r.metrics.find((m) => m.key === 'naive')!.text).toBe('45,379,703')
  })
})

describe('buildUsageView — the subagent split is a headline', () => {
  it('states the subagent share of CE and RLIT', () => {
    const r = buildUsageView(
      snapshot(
        [
          row({
            ce: metric(100, 39, 61),
            rlit: metric(100, 25, 75),
            naive: metric(100, 50, 50),
            output: metric(10, 5, 5)
          })
        ],
        1,
        1
      )
    ).rows[0]
    expect(r.subagentText).toBe('Subagents: 61% of CE, 75% of RLIT')
  })

  /** ⚠ null ≠ 0 one level down: "not read" must not render as "0% subagent". */
  it('says so when the subagent files were NOT read, rather than implying 100% main', () => {
    const r = buildUsageView(snapshot([row({ ce: metric(100, null, null) })], 1, 1)).rows[0]
    expect(r.subagentText).toBe('Subagent files were not read for this session.')
    expect(r.subagentText).not.toContain('0%')
  })

  it('reports a real 0% when the files WERE read and held nothing', () => {
    const r = buildUsageView(snapshot([row({ ce: metric(100, 100, 0) })], 1, 1)).rows[0]
    expect(r.subagentText).toBe('Subagents: 0% of CE')
  })

  it('splits the bar into main and subagent segments that fit inside its width', () => {
    const r = buildUsageView(snapshot([row({ ce: metric(100, 40, 60) })], 1, 1)).rows[0]
    const bar = r.metrics.find((m) => m.key === 'ce')!.bar!
    expect(bar.mainPercent! + bar.subagentPercent!).toBeCloseTo(bar.widthPercent, 6)
  })

  it('leaves the bar undifferentiated when the split is unknown', () => {
    const r = buildUsageView(snapshot([row({ ce: metric(100, null, null) })], 1, 1)).rows[0]
    const bar = r.metrics.find((m) => m.key === 'ce')!.bar!
    expect(bar.mainPercent).toBeNull()
    expect(bar.subagentPercent).toBeNull()
  })
})

describe('buildUsageView — coverage names its denominator', () => {
  it('states both numbers as main sent them', () => {
    const view = buildUsageView(snapshot([row()], 65, 467))
    expect(view.coverageText).toBe(
      '65 of 467 dispatches in this project carry token data.'
    )
    expect(view.measuredCount).toBe(65)
    expect(view.totalCount).toBe(467)
  })

  it('says so plainly when there is nothing recorded yet', () => {
    expect(buildUsageView(snapshot([], 0, 0)).coverageText).toBe(
      'No dispatches recorded for this project yet.'
    )
  })
})

/**
 * ⚠ D-c MADE EXECUTABLE AT THE SHAPE LEVEL. There is no price column anywhere
 * in the schema, so any money word in this output would be an unsourced
 * constant wearing a measurement's clothes. A later reader WILL assume a cost
 * figure exists; this is the test that stops one being added quietly.
 */
describe('buildUsageView — no money, anywhere', () => {
  it('emits no $, usd, cost or price in any field', () => {
    const view = buildUsageView(
      snapshot(
        [
          row({
            ce: metric(REAL.ce, 1, 2),
            rlit: metric(REAL.rlit),
            naive: metric(REAL.naive),
            output: metric(REAL.output)
          }),
          row({ agent: 'voice', hasSource: false }),
          row()
        ],
        65,
        467
      )
    )
    const serialised = JSON.stringify(view)
    expect(serialised).not.toContain('$')
    expect(serialised.toLowerCase()).not.toContain('usd')
    expect(serialised.toLowerCase()).not.toContain('price')
    expect(serialised.toLowerCase()).not.toContain('dollar')
    // ⚠ "cost" IS NOT BARRED OUTRIGHT, AND THE REASON IS THE POINT: `CE` is
    // literally "cost-equivalent tokens" — a TOKEN COUNT — so banning the
    // substring would reject the honest description while catching nothing real.
    // That is the same self-matching mistake the roadmap records for `F<n>`
    // greps, and it has now happened four times in this phase. The enforceable
    // rule is narrower: the word may appear ONLY as "cost-equivalent".
    for (const hit of serialised.toLowerCase().matchAll(/cost[a-z-]*/g)) {
      expect(hit[0]).toBe('cost-equivalent')
    }
  })
})
