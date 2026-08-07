import { describe, expect, it } from 'vitest'
import {
  moveItem,
  partitionRail,
  tuckedLabel,
  visibleIndexToFullIndex,
  type RailProject
} from './projectRail'

/** A rail row. Only `id` and `status` decide anything here; the rest is the
 *  shape `ProjectsList` requires and is filled in once. */
function p(id: string, status: RailProject['status'] = 'active'): RailProject {
  return {
    id,
    name: id,
    root_path: `C:\\${id}`,
    color: null,
    description: null,
    status,
    color_seed: 0,
    active: false,
    sessionCount: 0
  }
}

describe('partitionRail', () => {
  it('shows active projects and tucks hidden and archived ones away', () => {
    const { visible, tucked } = partitionRail(
      [p('a'), p('b', 'hidden'), p('c'), p('d', 'archived')],
      'a'
    )
    expect(visible.map((x) => x.id)).toEqual(['a', 'c'])
    expect(tucked.map((x) => x.id)).toEqual(['b', 'd'])
  })

  /**
   * ⚠ THE CLAUSE THIS FUNCTION EXISTS FOR. Hiding is cosmetic: it does not
   * change which project you are working in, and `project:select` accepts a
   * hidden project on purpose. Without "or it is the active one" you would be
   * staring at a workspace full of panes whose project is nowhere in the rail,
   * with nothing highlighted.
   */
  it('keeps the ACTIVE project visible even when it is hidden', () => {
    const { visible, tucked } = partitionRail([p('a'), p('b', 'hidden'), p('c')], 'b')
    expect(visible.map((x) => x.id)).toEqual(['a', 'b', 'c'])
    expect(tucked).toEqual([])
  })

  it('keeps the active project visible even when it is archived', () => {
    // Main will not let this state arise (it reassigns the active project on
    // archive), but the invariant being protected is "the active project is
    // always in the rail" — not a fact about hiding — so it holds regardless.
    const { visible } = partitionRail([p('a', 'archived'), p('b')], 'a')
    expect(visible.map((x) => x.id)).toEqual(['a', 'b'])
  })

  it('preserves the order it is given and never sorts', () => {
    // Position is main's authority (`sort_order`). A second one here would
    // disagree the first time a reorder raced a list refresh.
    const { visible } = partitionRail([p('z'), p('m'), p('a')], null)
    expect(visible.map((x) => x.id)).toEqual(['z', 'm', 'a'])
  })

  it('handles an empty rail and an all-tucked rail', () => {
    expect(partitionRail([], null)).toEqual({ visible: [], tucked: [] })
    const allAway = partitionRail([p('a', 'hidden'), p('b', 'archived')], null)
    expect(allAway.visible).toEqual([])
    expect(allAway.tucked.map((x) => x.id)).toEqual(['a', 'b'])
  })
})

describe('tuckedLabel', () => {
  it('names the kind when there is only one kind', () => {
    expect(tuckedLabel([p('a', 'hidden'), p('b', 'hidden')])).toBe('Hidden (2)')
    expect(tuckedLabel([p('a', 'archived')])).toBe('Archived (1)')
  })

  it('generalises when both kinds are present', () => {
    expect(tuckedLabel([p('a', 'hidden'), p('b', 'archived'), p('c', 'archived')])).toBe(
      'Tucked away (3)'
    )
  })

  /* D122: the count is what makes "nothing silently vanishes" a promise the
     rail visibly keeps — whatever is not above is counted below. A disclosure
     reading only "Archived" is a control with no reason to open it. */
  it('always carries the count', () => {
    expect(tuckedLabel([p('a', 'archived')])).toContain('(1)')
    expect(tuckedLabel([p('a', 'hidden')])).toContain('(1)')
  })

  it('is empty when nothing is tucked away — there is no disclosure to draw', () => {
    expect(tuckedLabel([])).toBe('')
  })
})

describe('moveItem', () => {
  it('moves an item down and up', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('moves to the very start and the very end', () => {
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
  })

  /* The callers are a drag that can end anywhere and an Alt+Arrow at the ends
     of the list. "Nothing moved" is the correct answer to both — a throw would
     make the component guard every keystroke. */
  it('returns an unchanged copy for a no-op or an out-of-range move', () => {
    expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c'])
    expect(moveItem(['a', 'b', 'c'], -1, 1)).toEqual(['a', 'b', 'c'])
    expect(moveItem(['a', 'b', 'c'], 0, 9)).toEqual(['a', 'b', 'c'])
    expect(moveItem(['a', 'b', 'c'], 9, 0)).toEqual(['a', 'b', 'c'])
    expect(moveItem([], 0, 0)).toEqual([])
  })

  /* ⚠ D14: the result of this is what crosses the IPC bridge. A mutation would
     leave the caller sending the Pinia array it already had — a Vue Proxy —
     which `invoke` rejects at RUNTIME with no compile-time signal. */
  it('never mutates its input, and returns a genuinely new array', () => {
    const input = ['a', 'b', 'c']
    const out = moveItem(input, 0, 2)
    expect(input).toEqual(['a', 'b', 'c'])
    expect(out).not.toBe(input)
    // Even the no-op path must hand back a copy, or one branch would return the
    // caller's own array and the other a fresh one.
    expect(moveItem(input, 1, 1)).not.toBe(input)
  })
})

describe('visibleIndexToFullIndex', () => {
  /**
   * ⚠ THE FUNCTION THAT KEEPS A REORDER FROM SCRAMBLING PROJECTS THE USER
   * CANNOT SEE. The drag happens among visible rows; `project:reorder` takes
   * EVERY id. Dropping the third visible row while a hidden project sits second
   * means position 3 in the full list, not position 2.
   */
  it('resolves a visible position against the full list, skipping tucked rows', () => {
    const list = [p('a'), p('b', 'hidden'), p('c'), p('d', 'archived'), p('e')]
    expect(visibleIndexToFullIndex(list, null, 0)).toBe(0) // a
    expect(visibleIndexToFullIndex(list, null, 1)).toBe(2) // c, not b
    expect(visibleIndexToFullIndex(list, null, 2)).toBe(4) // e, not d
  })

  it('counts a hidden ACTIVE project as visible — the partition rule, restated', () => {
    const list = [p('a'), p('b', 'hidden'), p('c')]
    // With 'b' active it IS drawn, so visible index 1 is 'b' at full index 1.
    expect(visibleIndexToFullIndex(list, 'b', 1)).toBe(1)
    expect(visibleIndexToFullIndex(list, 'b', 2)).toBe(2)
    // With nothing active, visible index 1 skips 'b' and lands on 'c'.
    expect(visibleIndexToFullIndex(list, null, 1)).toBe(2)
  })

  it('is the identity when every project is active', () => {
    const list = [p('a'), p('b'), p('c')]
    expect(visibleIndexToFullIndex(list, null, 0)).toBe(0)
    expect(visibleIndexToFullIndex(list, null, 1)).toBe(1)
    expect(visibleIndexToFullIndex(list, null, 2)).toBe(2)
  })

  it('returns -1 when there is no such visible row', () => {
    const list = [p('a'), p('b', 'hidden')]
    expect(visibleIndexToFullIndex(list, null, 1)).toBe(-1)
    expect(visibleIndexToFullIndex(list, null, 9)).toBe(-1)
    expect(visibleIndexToFullIndex(list, null, -1)).toBe(-1)
    expect(visibleIndexToFullIndex([], null, 0)).toBe(-1)
  })
})
