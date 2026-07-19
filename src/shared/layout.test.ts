import { describe, it, expect } from 'vitest'
import {
  createLeaf,
  splitPane,
  removePane,
  setRatio,
  changeDirection,
  swapPanes,
  collectSessionIds,
  findLeaf,
  normalizeTree,
  convertLegacyFlatLayout,
  type LayoutInternal,
  type LayoutLeaf,
  type LayoutNode
} from './layout'

const leaf = (id: string): LayoutLeaf => createLeaf(id)
const rowOf = (a: LayoutNode, b: LayoutNode, ratio = 0.5): LayoutInternal => ({
  type: 'row',
  ratio,
  children: [a, b]
})

describe('internal node children', () => {
  it('splitPane produces exactly 2 children by construction', () => {
    const result = splitPane(leaf('a'), 'a', 'row', 'b') as LayoutInternal
    expect(result.type).toBe('row')
    expect(result.children).toHaveLength(2)
  })
})

describe('ratio clamp on write', () => {
  it('clamps below-range ratios to 0.05', () => {
    const tree = setRatio(rowOf(leaf('a'), leaf('b')), [], 0.02) as LayoutInternal
    expect(tree.ratio).toBe(0.05)
  })

  it('clamps above-range ratios to 0.95', () => {
    const tree = setRatio(rowOf(leaf('a'), leaf('b')), [], 0.99) as LayoutInternal
    expect(tree.ratio).toBe(0.95)
  })

  it('keeps in-range ratios as-is', () => {
    const tree = setRatio(rowOf(leaf('a'), leaf('b')), [], 0.3) as LayoutInternal
    expect(tree.ratio).toBe(0.3)
  })
})

describe('ratio clamp on read', () => {
  it('normalizeTree clamps out-of-range stored ratios', () => {
    const dirty: LayoutNode = {
      type: 'row',
      ratio: 0.01,
      children: [leaf('a'), { type: 'column', ratio: 1.4, children: [leaf('b'), leaf('c')] }]
    }
    const clean = normalizeTree(dirty) as LayoutInternal
    expect(clean.ratio).toBe(0.05)
    expect((clean.children[1] as LayoutInternal).ratio).toBe(0.95)
  })

  it('legacy conversion output ratios are within bounds', () => {
    const flat = Array.from({ length: 5 }, (_, i) => ({ slot: i, agent: `agent${i}` }))
    const layout = convertLegacyFlatLayout(flat, (agent) => `id-${agent}`)
    const check = (node: LayoutNode): void => {
      if (node.type === 'leaf') return
      expect(node.ratio).toBeGreaterThanOrEqual(0.05)
      expect(node.ratio).toBeLessThanOrEqual(0.95)
      check(node.children[0])
      check(node.children[1])
    }
    check(layout.root)
  })
})

describe('dedupe keep-first', () => {
  it('normalizeTree drops later duplicates and keeps the first occurrence', () => {
    // 'a' appears as the first leaf and again nested on the right.
    const dirty: LayoutNode = rowOf(leaf('a'), {
      type: 'column',
      ratio: 0.5,
      children: [leaf('b'), leaf('a')]
    })
    const clean = normalizeTree(dirty)
    expect(collectSessionIds(clean)).toEqual(['a', 'b'])
    // The first 'a' stays in place; the duplicate subtree collapses to 'b'.
    expect(clean).toEqual({
      type: 'row',
      ratio: 0.5,
      children: [leaf('a'), leaf('b')]
    })
  })
})

describe('single-leaf minimum', () => {
  it('a lone leaf is a valid tree and survives normalization', () => {
    const tree = leaf('only')
    expect(normalizeTree(tree)).toEqual(tree)
    expect(collectSessionIds(tree)).toEqual(['only'])
  })
})

describe('version literal', () => {
  it('convertLegacyFlatLayout emits version 1', () => {
    const layout = convertLegacyFlatLayout([{ slot: 0, agent: 'claude' }], () => 'id')
    expect(layout.version).toBe(1)
  })
})

describe('removePane', () => {
  it('sibling absorbs the slot when one leaf of a pair is removed', () => {
    expect(removePane(rowOf(leaf('a'), leaf('b')), 'b')).toEqual(leaf('a'))
    expect(removePane(rowOf(leaf('a'), leaf('b')), 'a')).toEqual(leaf('b'))
  })

  it('root collapse: removing the only leaf returns null', () => {
    expect(removePane(leaf('a'), 'a')).toBeNull()
  })

  it('sibling absorb works through nested levels', () => {
    const tree = rowOf(leaf('a'), { type: 'column', ratio: 0.5, children: [leaf('b'), leaf('c')] })
    expect(removePane(tree, 'b')).toEqual(rowOf(leaf('a'), leaf('c')))
  })

  it('unknown sessionId leaves the tree unchanged', () => {
    const tree = rowOf(leaf('a'), leaf('b'))
    expect(removePane(tree, 'zzz')).toEqual(tree)
  })
})

describe('splitPane', () => {
  it('target leaf becomes an internal node with the original plus a new leaf at ratio 0.5', () => {
    expect(splitPane(leaf('a'), 'a', 'row', 'b')).toEqual({
      type: 'row',
      ratio: 0.5,
      children: [leaf('a'), leaf('b')]
    })
  })

  it('honors the requested direction', () => {
    expect(splitPane(leaf('a'), 'a', 'column', 'b')).toEqual({
      type: 'column',
      ratio: 0.5,
      children: [leaf('a'), leaf('b')]
    })
  })

  it('splits a nested target without touching the rest of the tree', () => {
    const tree = rowOf(leaf('a'), leaf('b'))
    expect(splitPane(tree, 'b', 'row', 'c')).toEqual(
      rowOf(leaf('a'), { type: 'row', ratio: 0.5, children: [leaf('b'), leaf('c')] })
    )
  })

  it('splits the same target again with a second new session (multi-session launch)', () => {
    const once = splitPane(leaf('a'), 'a', 'row', 'b')
    expect(splitPane(once, 'a', 'column', 'c')).toEqual({
      type: 'row',
      ratio: 0.5,
      children: [{ type: 'column', ratio: 0.5, children: [leaf('a'), leaf('c')] }, leaf('b')]
    })
  })

  it('no-ops on an unknown target or a duplicate new sessionId', () => {
    const tree = rowOf(leaf('a'), leaf('b'))
    expect(splitPane(tree, 'zzz', 'row', 'c')).toEqual(tree)
    expect(splitPane(tree, 'a', 'row', 'b')).toEqual(tree)
  })
})

describe('legacy conversion', () => {
  it('2-entry flat array converts to a single row split at ratio 0.5 with resolved ids', () => {
    const ids: Record<string, string> = { claude: 'id-claude', codex: 'id-codex' }
    const layout = convertLegacyFlatLayout(
      [
        { slot: 0, agent: 'claude' },
        { slot: 1, agent: 'codex' }
      ],
      (agent) => ids[agent]
    )
    expect(layout).toEqual({
      version: 1,
      root: {
        type: 'row',
        ratio: 0.5,
        children: [leaf('id-claude'), leaf('id-codex')]
      }
    })
  })

  it('resolver receives agent and slot; entries are ordered by slot', () => {
    const calls: Array<[string, number]> = []
    convertLegacyFlatLayout(
      [
        { slot: 1, agent: 'codex' },
        { slot: 0, agent: 'claude' }
      ],
      (agent, slot) => {
        calls.push([agent, slot])
        return `id-${agent}`
      }
    )
    expect(calls).toEqual([
      ['claude', 0],
      ['codex', 1]
    ])
  })

  it('duplicate agents collapse keep-first', () => {
    const layout = convertLegacyFlatLayout(
      [
        { slot: 0, agent: 'claude' },
        { slot: 1, agent: 'claude' }
      ],
      (_agent, slot) => `id-${slot}`
    )
    expect(collectSessionIds(layout.root)).toEqual(['id-0'])
  })
})

describe('collectSessionIds', () => {
  it('returns ids in left-to-right document order', () => {
    const tree: LayoutNode = {
      type: 'row',
      ratio: 0.5,
      children: [
        { type: 'column', ratio: 0.5, children: [leaf('a'), leaf('b')] },
        leaf('c')
      ]
    }
    expect(collectSessionIds(tree)).toEqual(['a', 'b', 'c'])
  })
})

describe('changeDirection', () => {
  it('toggles row to column at the addressed node', () => {
    expect(changeDirection(rowOf(leaf('a'), leaf('b')), [])).toEqual({
      type: 'column',
      ratio: 0.5,
      children: [leaf('a'), leaf('b')]
    })
  })

  it('toggles column to row', () => {
    const col: LayoutInternal = { type: 'column', ratio: 0.5, children: [leaf('a'), leaf('b')] }
    expect((changeDirection(col, []) as LayoutInternal).type).toBe('row')
  })
})

describe('swapPanes', () => {
  it('reverses the children of the addressed internal node', () => {
    expect(swapPanes(rowOf(leaf('a'), leaf('b')), [])).toEqual(rowOf(leaf('b'), leaf('a')))
  })
})

describe('findLeaf', () => {
  it('finds a leaf by sessionId and returns null for unknown ids', () => {
    const tree = rowOf(leaf('a'), leaf('b'))
    expect(findLeaf(tree, 'b')).toEqual(leaf('b'))
    expect(findLeaf(tree, 'zzz')).toBeNull()
  })
})
