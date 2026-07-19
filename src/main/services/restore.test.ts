import { describe, it, expect } from 'vitest'
import { computeRestoreSet, type RestoreCandidate } from './restore'
import type { LayoutJson } from '../../shared/layout'

// computeRestoreSet is the heart of the D16 restore contract: restore set =
// layout leaves ∩ 'running' rows (minus already-live), and every other
// 'running' row is the invisible-process guard's heal population. Pure: no
// Electron, no fs, no DB.

interface TestRow extends RestoreCandidate {
  id: string
  status: string
}

const row = (id: string, status = 'running'): TestRow => ({ id, status })

const treeOf = (...leafIds: string[]): LayoutJson => {
  if (leafIds.length === 1) {
    return { version: 1, root: { type: 'leaf', sessionId: leafIds[0] } }
  }
  return {
    version: 1,
    root: {
      type: 'row',
      ratio: 0.5,
      children: [
        { type: 'leaf', sessionId: leafIds[0] },
        leafIds.length === 2
          ? { type: 'leaf', sessionId: leafIds[1] }
          : {
              type: 'column',
              ratio: 0.5,
              children: [
                { type: 'leaf', sessionId: leafIds[1] },
                { type: 'leaf', sessionId: leafIds[2] }
              ]
            }
      ]
    }
  }
}

describe('computeRestoreSet', () => {
  it('partitions all four populations in one pass', () => {
    const layout = treeOf('relive', 'dead-leaf', 'exited-leaf')
    const rows = [
      row('relive'), // running + leaf          -> toRelaunch
      row('orphan'), // running, no leaf        -> toHeal (failed-spawn orphan / leafless drift)
      row('exited-leaf', 'exited') // exited + leaf -> skipped entirely
    ]
    const set = computeRestoreSet(layout, rows, new Set())

    expect(set.toRelaunch.map((r) => r.id)).toEqual(['relive'])
    expect(set.toHeal.map((r) => r.id)).toEqual(['orphan'])
    // 'dead-leaf' is a leaf with no sessions row.
    expect(set.missingRows).toEqual(['dead-leaf'])
  })

  it('excludes already-live sessions from both lists (tab re-activation guard)', () => {
    const layout = treeOf('live-leaf')
    const rows = [row('live-leaf')]
    const set = computeRestoreSet(layout, rows, new Set(['live-leaf']))

    expect(set.toRelaunch).toEqual([])
    expect(set.toHeal).toEqual([])
    expect(set.missingRows).toEqual([])
  })

  it('heals a live-looking but leafless row only when it is not actually live', () => {
    // The failed-spawn orphan: row stuck 'running' with no PTY and no leaf.
    const rows = [row('orphan')]
    expect(computeRestoreSet(null, rows, new Set()).toHeal.map((r) => r.id)).toEqual(['orphan'])
    // The same id live in the manager this run: untouched (not a drift row).
    const set = computeRestoreSet(null, rows, new Set(['orphan']))
    expect(set.toHeal).toEqual([])
  })

  it('treats a null layout as "every running row heals" (empty state project)', () => {
    const rows = [row('a'), row('b'), row('c', 'exited')]
    const set = computeRestoreSet(null, rows, new Set())

    expect(set.toRelaunch).toEqual([])
    expect(set.toHeal.map((r) => r.id)).toEqual(['a', 'b'])
    expect(set.missingRows).toEqual([])
  })

  it('skips exited rows everywhere — they keep their chrome, nothing spawns', () => {
    const layout = treeOf('a')
    const rows = [row('a', 'exited'), row('b', 'exited')]
    const set = computeRestoreSet(layout, rows, new Set())

    expect(set.toRelaunch).toEqual([])
    expect(set.toHeal).toEqual([])
  })

  it('reports every leaf without a row in missingRows, in document order', () => {
    const layout = treeOf('x', 'y', 'z')
    const set = computeRestoreSet(layout, [], new Set())
    expect(set.missingRows).toEqual(['x', 'y', 'z'])
  })
})
