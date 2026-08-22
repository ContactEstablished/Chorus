import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useLayoutStore } from './layout'
import type { LayoutJson } from '../../../shared/layout'
import { collectSessionIds } from '../../../shared/layout'

// Store-level growth and removal assertions. Pure logic: no DB, no Electron;
// window.chorus.setLayout is stubbed.
// Task 1-5: loadLayout takes the owning project id and every persist payload
// carries it as {project_id, layout}.
// D174: `applyRatio` and its two clamp assertions are GONE with the splitters
// that fed them. The clamp itself is not — `setRatio` is still covered
// directly in src/shared/layout.test.ts, and main re-clamps on read and write.

const PID = '550e8400-e29b-41d4-a716-446655440000'

const twoLeafTree = (): LayoutJson => ({
  version: 1,
  root: {
    type: 'row',
    ratio: 0.5,
    children: [
      { type: 'leaf', sessionId: 'a' },
      { type: 'leaf', sessionId: 'b' }
    ]
  }
})

describe('layout store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
    ;(globalThis as Record<string, unknown>).window = {
      chorus: { setLayout: vi.fn().mockResolvedValue(undefined) }
    }
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    delete (globalThis as Record<string, unknown>).window
  })

  it('removeLeaf absorbs the sibling and drops the last leaf into the empty state', async () => {
    const store = useLayoutStore()
    store.loadLayout(twoLeafTree(), PID)

    store.removeLeaf('a')
    expect(store.tree?.root).toEqual({ type: 'leaf', sessionId: 'b' })

    // Task 1-4: empty layouts are legal — the last close nulls the tree and
    // persists null (main deletes the pane_layouts row; absence = empty).
    store.removeLeaf('b')
    expect(store.tree).toBeNull()

    await vi.advanceTimersByTimeAsync(500)
    const setLayout = (window as unknown as { chorus: { setLayout: ReturnType<typeof vi.fn> } })
      .chorus.setLayout
    expect(setLayout).toHaveBeenLastCalledWith({ project_id: PID, layout: null })
  })

  it('appendLaunchedLeaf makes the first launch the root leaf (empty state)', async () => {
    const store = useLayoutStore()
    store.loadLayout(null, PID)

    store.appendLaunchedLeaf('new-1')
    expect(store.tree).toEqual({ version: 1, root: { type: 'leaf', sessionId: 'new-1' } })

    await vi.advanceTimersByTimeAsync(500)
    const setLayout = (window as unknown as { chorus: { setLayout: ReturnType<typeof vi.fn> } })
      .chorus.setLayout
    expect(setLayout).toHaveBeenLastCalledWith({
      project_id: PID,
      layout: { version: 1, root: { type: 'leaf', sessionId: 'new-1' } }
    })
  })

  it('D174: every launch lands LAST in document order, whatever is focused', () => {
    // The order the grid reads. Two launches in a row must read a, b, x, y —
    // this is the whole user-visible contract of the new model.
    const store = useLayoutStore()
    store.loadLayout(twoLeafTree(), PID)

    store.appendLaunchedLeaf('x')
    store.appendLaunchedLeaf('y')

    expect(collectSessionIds(store.tree!.root)).toEqual(['a', 'b', 'x', 'y'])
  })

  it('F23 regression: appending to a POPULATED tree GROWS it — nothing is replaced', () => {
    // Pre-fix (and pre-D174, when a null split target meant "no anchor") this
    // discarded every other leaf, orphaning their sessions into leafless
    // 'running' rows that D16's boot heal then killed.
    const store = useLayoutStore()
    store.loadLayout(twoLeafTree(), PID)
    const before = collectSessionIds(store.tree!.root)

    store.appendLaunchedLeaf('new-3')

    const after = collectSessionIds(store.tree!.root)
    for (const id of before) expect(after).toContain(id)
    expect(after).toContain('new-3')
    expect(after).toHaveLength(before.length + 1)
  })

  it('appendLaunchedLeaf is a no-op for a session already in the tree', () => {
    const store = useLayoutStore()
    store.loadLayout(twoLeafTree(), PID)

    store.appendLaunchedLeaf('b')

    expect(collectSessionIds(store.tree!.root)).toEqual(['a', 'b'])
  })
})
