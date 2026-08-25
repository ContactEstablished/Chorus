import { describe, expect, it } from 'vitest'
import { buildSwitcherRows, rowForDigit, MAX_DIGIT_ROWS } from './projectSwitcher'
import type { RailProject } from './projectRail'

/** A project row. Every field of `projectsListSchema` is required, so the
 *  fixture supplies them all and the test overrides only what it asserts on. */
function proj(over: Partial<RailProject> & { id: string; name: string }): RailProject {
  return {
    root_path: `C:\\repos\\${over.name}`,
    color: null,
    description: null,
    status: 'active',
    color_seed: 0,
    active: false,
    sessionCount: 0,
    ...over
  } as RailProject
}

/** The shape of Matthew's own rail when this was written: five visible, four
 *  hidden, one archived — which is exactly nine switchable rows, i.e. the
 *  digit range with no room to spare. */
function realWorldRail(): RailProject[] {
  return [
    proj({ id: 'ges', name: 'GES Workflow' }),
    proj({ id: 'tax', name: 'Tax-Organizer-1120-S' }),
    proj({ id: 'chorus', name: 'Chorus', active: true, sessionCount: 1 }),
    proj({ id: 'tru', name: 'Trupanion' }),
    proj({ id: 'mm', name: 'Mission Map' }),
    proj({ id: 'cch', name: 'CCH-integration', status: 'hidden' }),
    proj({ id: 'taxapp', name: 'TaxApp (Develop)', status: 'hidden' }),
    proj({ id: 'tr', name: 'TR-Integration', status: 'hidden' }),
    proj({ id: 'inbox', name: 'InboxRail', status: 'hidden' }),
    proj({ id: 'old', name: 'Retired', status: 'archived' })
  ]
}

describe('buildSwitcherRows — order', () => {
  it('numbers the visible rail rows 1..N in rail order', () => {
    const rows = buildSwitcherRows(realWorldRail(), 'chorus')
    expect(rows.slice(0, 5).map((r) => [r.digit, r.name])).toEqual([
      ['1', 'GES Workflow'],
      ['2', 'Tax-Organizer-1120-S'],
      ['3', 'Chorus'],
      ['4', 'Trupanion'],
      ['5', 'Mission Map']
    ])
  })

  it('continues the numbering into the tucked rows rather than restarting', () => {
    const rows = buildSwitcherRows(realWorldRail(), 'chorus')
    expect(rows.slice(5).map((r) => [r.digit, r.name])).toEqual([
      ['6', 'CCH-integration'],
      ['7', 'TaxApp (Develop)'],
      ['8', 'TR-Integration'],
      ['9', 'InboxRail']
    ])
  })

  it('marks tucked rows as tucked and visible rows as not', () => {
    const rows = buildSwitcherRows(realWorldRail(), 'chorus')
    expect(rows.filter((r) => r.tucked).map((r) => r.id)).toEqual([
      'cch',
      'taxapp',
      'tr',
      'inbox'
    ])
  })

  it('preserves the input order — main owns position via sort_order', () => {
    const reordered = [proj({ id: 'b', name: 'Bravo' }), proj({ id: 'a', name: 'Alpha' })]
    expect(buildSwitcherRows(reordered, null).map((r) => r.name)).toEqual(['Bravo', 'Alpha'])
  })
})

describe('buildSwitcherRows — who is offered', () => {
  it('⚠ KEEPS the active project, with its number, so the digits below it do not shift', () => {
    const rows = buildSwitcherRows(realWorldRail(), 'chorus')
    const chorus = rows.find((r) => r.id === 'chorus')
    expect(chorus?.current).toBe(true)
    expect(chorus?.digit).toBe('3')
    // The regression this exists to prevent: dropping the active row would put
    // Trupanion on 3 and Mission Map on 4 — every number below the one you just
    // used moves, so nothing about the gesture can ever become muscle memory.
    expect(rowForDigit(rows, '4')?.name).toBe('Trupanion')
    expect(rowForDigit(rows, '5')?.name).toBe('Mission Map')
  })

  it('marks exactly one row current, and none when no project is active', () => {
    expect(buildSwitcherRows(realWorldRail(), 'chorus').filter((r) => r.current)).toHaveLength(1)
    expect(buildSwitcherRows(realWorldRail(), null).filter((r) => r.current)).toHaveLength(0)
  })

  it('⚠ filters ARCHIVED projects — project:select refuses them in main', () => {
    const rows = buildSwitcherRows(realWorldRail(), 'chorus')
    expect(rows.map((r) => r.id)).not.toContain('old')
  })

  it('⚠ keeps HIDDEN projects — hiding is cosmetic, and this is the fast way back', () => {
    const rows = buildSwitcherRows(realWorldRail(), 'chorus')
    expect(rows.map((r) => r.id)).toContain('cch')
  })

  it('keeps a hidden project that is nonetheless the active one, in its rail slot', () => {
    // partitionRail's second clause: the active project is always visible, so
    // it sorts with the visible rows and does not fall to the tucked tail.
    const rows = buildSwitcherRows(realWorldRail(), 'cch')
    const cch = rows.find((r) => r.id === 'cch')
    expect(cch?.tucked).toBe(false)
    expect(cch?.digit).toBe('6')
  })

  it('returns nothing for an empty list, and for an all-archived one', () => {
    expect(buildSwitcherRows([], null)).toEqual([])
    expect(buildSwitcherRows([proj({ id: 'x', name: 'X', status: 'archived' })], null)).toEqual([])
  })
})

describe('buildSwitcherRows — digits run out gracefully', () => {
  it(`assigns a digit to the first ${MAX_DIGIT_ROWS} rows and null after`, () => {
    const many = Array.from({ length: 12 }, (_, i) => proj({ id: `p${i}`, name: `P${i}` }))
    const rows = buildSwitcherRows(many, null)
    expect(rows.slice(0, 9).map((r) => r.digit)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9'
    ])
    expect(rows.slice(9).map((r) => r.digit)).toEqual([null, null, null])
  })

  it('still gives every row a position, digit or not — arrows reach them all', () => {
    const many = Array.from({ length: 12 }, (_, i) => proj({ id: `p${i}`, name: `P${i}` }))
    const rows = buildSwitcherRows(many, null)
    expect(rows.map((r) => r.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })
})

describe('rowForDigit', () => {
  const rows = buildSwitcherRows(realWorldRail(), 'chorus')

  it('resolves 1-9 to the row carrying that digit', () => {
    expect(rowForDigit(rows, '1')?.name).toBe('GES Workflow')
    expect(rowForDigit(rows, '9')?.name).toBe('InboxRail')
  })

  it('⚠ ignores a digit past the end rather than clamping to the last row', () => {
    const three = buildSwitcherRows(
      [proj({ id: 'a', name: 'A' }), proj({ id: 'b', name: 'B' }), proj({ id: 'c', name: 'C' })],
      null
    )
    expect(rowForDigit(three, '7')).toBeNull()
  })

  it('⚠ ignores 0 — it has no unambiguous reading, so it has no meaning', () => {
    expect(rowForDigit(rows, '0')).toBeNull()
  })

  it('ignores letters, modifiers and named keys', () => {
    for (const k of ['a', 'Enter', 'ArrowDown', 'Shift', '', ' ', '10']) {
      expect(rowForDigit(rows, k)).toBeNull()
    }
  })
})
