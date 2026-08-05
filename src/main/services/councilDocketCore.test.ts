import { describe, expect, it } from 'vitest'
import {
  assembleVerdictStrip,
  digestFor,
  toDocketRow,
  type DocketRow,
  type VerdictStrip
} from './councilDocketCore'
import { describeRemoval } from '../../shared/councilDocket'
import type { CouncilRunStats } from './storage'
import type { CouncilRunRow } from '../db/schema'

/**
 * The Docket's shaping rules, as cases rather than as comments.
 *
 * ⚠ EVERY TEST HERE IS A NUMBER THIS MODULE REFUSED TO INVENT. The states that
 * matter to a history view — a run that crashed, a run whose providers reported
 * no usage, a run that ended before its first turn — are all states nobody can
 * produce on demand at $1.09 and 21 minutes a go. Writing them down is the only
 * way they are ever exercised.
 */

const RUN: CouncilRunRow = {
  id: 'run-1',
  projectId: 'proj-1',
  briefPath: 'C:\\Projects\\Chorus\\docs\\CouncilCase-3f.0-Exhibits.md',
  findingsPath: 'C:\\Projects\\Chorus\\docs\\CouncilCase-3f.0-Exhibits-Findings.md',
  status: 'complete',
  startedAt: '2026-08-01T10:00:00.000Z',
  endedAt: '2026-08-01T10:21:04.000Z',
  mintedKeyHash: 'hash',
  mintedKeyLimit: 10,
  mintedAt: '2026-08-01T09:59:59.000Z',
  revokedAt: '2026-08-01T10:21:05.000Z',
  tokensIn: null,
  tokensOut: null,
  tokensCached: null,
  costUsd: 1.089
}

const STATS: CouncilRunStats = { turns: 48, tokensIn: 190_000, tokensOut: 24_000, turnsWithTokens: 48 }

const row = (run: Partial<CouncilRunRow> = {}, stats?: CouncilRunStats): DocketRow =>
  toDocketRow({ ...RUN, ...run }, stats)

describe('toDocketRow', () => {
  it('shapes a complete run', () => {
    const r = row({}, STATS)
    expect(r.runId).toBe('run-1')
    expect(r.label).toBe('CouncilCase-3f.0-Exhibits.md')
    expect(r.status).toBe('complete')
    expect(r.turns).toBe(48)
    expect(r.durationMs).toBe(1_264_000) // 21m 04s
    expect(r.hasFindings).toBe(true)
  })

  /* ---- the label is a label, never an identity (CR-3f.1 A1) -------------- */

  it('labels from the basename and keeps the full path beside it', () => {
    const r = row({}, STATS)
    expect(r.label).toBe('CouncilCase-3f.0-Exhibits.md')
    expect(r.briefPath).toBe(RUN.briefPath)
  })

  it('⚠ falls back to the raw value rather than rendering a blank title', () => {
    // A stored path that is somehow all separator. The row must still say
    // something a person can click.
    const r = row({ briefPath: '\\' }, STATS)
    expect(r.label.length).toBeGreaterThan(0)
  })

  /* ---- duration is stored, never measured against now -------------------- */

  it('⚠ reports NO duration for a run whose end was never observed', () => {
    // The boot heal renames a crashed run `abandoned` and deliberately leaves
    // `ended_at` NULL. Measuring that against the clock would render how long
    // ago it died as how long it ran.
    const r = row({ status: 'abandoned', endedAt: null }, { ...STATS, turns: 12 })
    expect(r.durationMs).toBeNull()
    expect(r.turns).toBe(12)
  })

  it('⚠ refuses a negative span rather than rendering one', () => {
    const r = row({ endedAt: '2026-08-01T09:00:00.000Z' }, STATS)
    expect(r.durationMs).toBeNull()
  })

  it('refuses an unparseable timestamp rather than returning NaN', () => {
    expect(row({ endedAt: 'not-a-date' }, STATS).durationMs).toBeNull()
  })

  /* ---- D76: absent is not zero ------------------------------------------ */

  it('⚠ a run with NO messages has zero turns but NULL tokens', () => {
    // `getCouncilRunStats` leaves such a run out of its map entirely. Zero turns
    // is a true statement; zero tokens is not the same statement.
    const r = row({}, undefined)
    expect(r.turns).toBe(0)
    expect(r.tokensIn).toBeNull()
    expect(r.tokensOut).toBeNull()
    expect(r.tokensArePartial).toBe(false)
  })

  it('⚠ carries a NULL token sum through as null, never as 0', () => {
    // Every turn stored, not one of them with usage — `persistTurn` writes null
    // rather than 0, so SUM() is null and it has to survive to the view.
    const r = row({}, { turns: 8, tokensIn: null, tokensOut: null, turnsWithTokens: 0 })
    expect(r.tokensIn).toBeNull()
    expect(r.turns).toBe(8)
    expect(r.tokensArePartial).toBe(false) // absent, not partial
  })

  it('⚠ omits the cost rather than showing $0.00 when none was recorded', () => {
    expect(row({ costUsd: null }, STATS).costFloorUsd).toBeNull()
  })

  it('reports hasFindings false when no findings document was written', () => {
    expect(row({ findingsPath: null }, STATS).hasFindings).toBe(false)
  })

  /* ---- D55: a partial total announces itself ---------------------------- */

  it('⚠ flags a token total summed from SOME of the turns as partial', () => {
    // qwen3-coder returned no usage on six of six questions in 3e-2. A total
    // built from the other members is not the run's total.
    const r = row({}, { turns: 48, tokensIn: 120_000, tokensOut: 9_000, turnsWithTokens: 30 })
    expect(r.tokensArePartial).toBe(true)
    expect(r.turnsWithTokens).toBe(30)
    expect(r.turns).toBe(48)
  })

  it('does not flag a complete total as partial', () => {
    expect(row({}, STATS).tokensArePartial).toBe(false)
  })

  /* ---- D115: the cost is a floor, and nothing here adds two together ----- */

  it('⚠ passes cost_usd through untouched — it is a floor, not a total', () => {
    // F42 measured this figure 37-60% under the real bill. This module reports
    // it as stored and never aggregates it; the absence of any sum-of-costs
    // function in this file is the actual guarantee, and it is enforced by the
    // module's export surface rather than by an assertion here.
    expect(row({}, STATS).costFloorUsd).toBe(1.089)
  })
})

describe('describeRemoval', () => {
  it('states the turn count before the removal is taken (D109)', () => {
    expect(describeRemoval(16)).toContain('16 transcript turns')
  })

  it('singularises one turn', () => {
    expect(describeRemoval(1)).toContain('1 transcript turn')
    expect(describeRemoval(1)).not.toContain('1 transcript turns')
  })

  it('handles a run with nothing stored', () => {
    expect(describeRemoval(0)).toContain('0 transcript turns')
  })

  it('⚠ promises the findings document on disk is left alone', () => {
    // The file lives beside the user's own brief, in the user's own repository.
    // Chorus did not create it and must not imply it deleted it.
    expect(describeRemoval(16)).toContain('left where it is')
    expect(describeRemoval(16)).toContain('database')
  })
})

/* ================================================================== *\
 * The Verdict strip (D106)                                           *
\* ================================================================== */

const QUESTIONS = ['Should orphan runs stay visible?', 'Is the cache safe?', 'Merge cleanly?']

/** Three members, each answering all three questions with the given tokens. */
const positionsFrom = (rows: Record<string, string[]>) =>
  Object.entries(rows).map(([memberId, tokens]) => ({
    memberId,
    content: tokens.map((t, i) => `Q${i + 1}: ${t}`).join('\n')
  }))

const UNANIMOUS = positionsFrom({
  a: ['AGREE', 'AGREE', 'AGREE'],
  b: ['AGREE', 'AGREE', 'AGREE'],
  c: ['AGREE', 'AGREE', 'AGREE']
})

const SPLIT_ON_Q2 = positionsFrom({
  a: ['AGREE', 'AGREE', 'AGREE'],
  b: ['AGREE', 'DISAGREE', 'AGREE'],
  c: ['AGREE', 'AGREE', 'QUALIFY']
})

const strip = (
  positions = UNANIMOUS,
  arbitration: string | null = '## Verdict\nQ1: APPROVED\nQ2: REVISE\nQ3: APPROVED'
): VerdictStrip =>
  assembleVerdictStrip({
    questions: QUESTIONS,
    positions,
    arbitration,
    labelFor: (id) => id.toUpperCase()
  })

describe('assembleVerdictStrip — two facts, two sources, neither faked', () => {
  it('carries the arbiter ruling and the member consensus side by side', () => {
    const s = strip()
    expect(s.rows).toHaveLength(3)
    expect(s.rows[0].verdict).toBe('APPROVED')
    expect(s.rows[1].verdict).toBe('REVISE')
    expect(s.rows[0].consensus.state).toBe('agreed')
    expect(s.ruled).toBe(3)
    expect(s.total).toBe(3)
  })

  it('⚠ shows the members splitting while the arbiter approves anyway', () => {
    // The single most informative thing a council can report, and the reason
    // these are two fields rather than one reconciled state.
    const s = strip(SPLIT_ON_Q2, '## Verdict\nQ1: APPROVED\nQ2: APPROVED\nQ3: APPROVED')
    expect(s.rows[1].consensus.state).toBe('split')
    expect(s.rows[1].verdict).toBe('APPROVED')
  })

  /* ---- the three-way arbiter shape ------------------------------------- */

  it('⚠ a run with NO verdict block reports null on every row, not unparsed', () => {
    // Every council recorded before D106 shipped. It was never asked.
    const s = strip(UNANIMOUS, 'The first question is sound. The second needs work.')
    expect(s.arbiterAsked).toBe(false)
    expect(s.rows.map((r) => r.verdict)).toEqual([null, null, null])
    expect(s.ruled).toBe(0)
  })

  it('⚠ a run that never REACHED arbitration also reports null, not unparsed', () => {
    const s = strip(UNANIMOUS, null)
    expect(s.arbiterAsked).toBe(false)
    expect(s.rows.every((r) => r.verdict === null)).toBe(true)
  })

  it('⚠ a block that skips a question marks THAT question unparsed', () => {
    // Asked and did not answer — a different fact from never having been asked,
    // and `ruled` counts neither of them.
    const s = strip(UNANIMOUS, '## Verdict\nQ1: APPROVED\nQ3: REVISE')
    expect(s.arbiterAsked).toBe(true)
    expect(s.rows.map((r) => r.verdict)).toEqual(['APPROVED', 'unparsed', 'REVISE'])
    expect(s.ruled).toBe(2)
    expect(s.total).toBe(3)
  })

  it('⚠ the denominator is the BRIEF’s question count, not the ruling’s', () => {
    // D106: the strip carries `n of m answered`. An arbiter that ruled on one
    // question of three must not read as having ruled on everything.
    const s = strip(UNANIMOUS, '## Verdict\nQ1: APPROVED')
    expect(s.ruled).toBe(1)
    expect(s.total).toBe(3)
  })

  it('reports members that left no parseable token, with their labels', () => {
    const s = strip(
      positionsFrom({ a: ['AGREE', 'AGREE', 'AGREE'], b: ['AGREE', 'AGREE', 'AGREE'] }).concat({
        memberId: 'c',
        content: 'I have thoughts but no tokens.'
      })
    )
    expect(s.rows[0].consensus.silent).toContain('C')
  })

  it('survives a run whose brief yielded no questions', () => {
    const s = assembleVerdictStrip({
      questions: [],
      positions: UNANIMOUS,
      arbitration: '## Verdict\nQ1: APPROVED',
      labelFor: (id) => id
    })
    expect(s.rows).toHaveLength(0)
    expect(s.total).toBe(0)
  })
})

describe('digestFor — it counts, it does not roll up', () => {
  it('reports the counts and the denominator, most severe first', () => {
    // ⚠ SEVERITY ORDER, NOT COUNT ORDER. The one question needing revision is
    // what a reader scanning a history is looking for; leading with "2 approved"
    // would bury it behind the good news.
    expect(digestFor(strip())).toBe('1 revise · 2 approved · 3 of 3 ruled')
  })

  it('⚠ never reduces several rulings to one run-level verdict', () => {
    // The arbiter rules per question and never issues an overall verdict;
    // inventing one would put words in the council's mouth.
    const d = digestFor(strip()) ?? ''
    expect(d).not.toMatch(/^(approved|revise|rejected)$/i)
    expect(d).toContain('3 of 3 ruled')
  })

  it('mentions a member split, because that is what is worth seeing on a row', () => {
    const d = digestFor(strip(SPLIT_ON_Q2)) ?? ''
    expect(d).toContain('members split on 1')
  })

  it('stays quiet about consensus when the members agreed', () => {
    expect(digestFor(strip())).not.toContain('split')
  })

  it('⚠ says so plainly when there is no ruling to report', () => {
    const d = digestFor(strip(UNANIMOUS, 'prose only'))
    expect(d).toBe('no arbiter ruling recorded')
  })

  it('falls back to the denominator alone when the counts get unreadable', () => {
    const many = assembleVerdictStrip({
      questions: ['a', 'b', 'c', 'd'],
      positions: positionsFrom({
        a: ['AGREE', 'AGREE', 'AGREE', 'AGREE'],
        b: ['AGREE', 'AGREE', 'AGREE', 'AGREE']
      }),
      arbitration:
        '## Verdict\nQ1: APPROVED\nQ2: REVISE\nQ3: REJECTED\nQ4: INSUFFICIENT-INFORMATION',
      labelFor: (id) => id
    })
    expect(digestFor(many)).toBe('4 of 4 ruled')
  })

  it('returns null for a run with no questions, so the line is omitted', () => {
    const empty = assembleVerdictStrip({
      questions: [],
      positions: [],
      arbitration: null,
      labelFor: (id) => id
    })
    expect(digestFor(empty)).toBeNull()
  })
})
