import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useLayoutStore } from './layout'
import type { LayoutJson } from '../../../shared/layout'

// Store-level clamp assertion (Task 1-3): an out-of-range ratio submitted via
// applyRatio is clamped to [0.05, 0.95] in the store BEFORE it is persisted —
// the client half of the council's defense-in-depth clamping (main re-clamps).
// Pure logic: no DB, no Electron; window.chorus.setLayout is stubbed.
// Task 1-5: loadLayout takes the owning project id and every persist payload
// carries it as {project_id, layout}.

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

const rootRatio = (tree: LayoutJson | null): number => {
  if (!tree || tree.root.type === 'leaf') throw new Error('expected internal root')
  return tree.root.ratio
}

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

  it('clamps an above-range ratio before persist', async () => {
    const store = useLayoutStore()
    store.loadLayout(twoLeafTree(), PID)

    store.applyRatio([], 0.99)
    expect(rootRatio(store.tree)).toBe(0.95)
    expect(store.dirty).toBe(true)

    await vi.advanceTimersByTimeAsync(500)
    const setLayout = (window as unknown as { chorus: { setLayout: ReturnType<typeof vi.fn> } })
      .chorus.setLayout
    expect(setLayout).toHaveBeenCalledOnce()
    const persisted = setLayout.mock.calls[0][0] as { project_id: string; layout: LayoutJson }
    expect(persisted.project_id).toBe(PID)
    expect(rootRatio(persisted.layout)).toBe(0.95)
    expect(store.dirty).toBe(false)
  })

  it('clamps a below-range ratio before persist', async () => {
    const store = useLayoutStore()
    store.loadLayout(twoLeafTree(), PID)

    store.applyRatio([], 0.01)
    expect(rootRatio(store.tree)).toBe(0.05)

    await vi.advanceTimersByTimeAsync(500)
    const setLayout = (window as unknown as { chorus: { setLayout: ReturnType<typeof vi.fn> } })
      .chorus.setLayout
    const persisted = setLayout.mock.calls[0][0] as { project_id: string; layout: LayoutJson }
    expect(rootRatio(persisted.layout)).toBe(0.05)
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

  it('insertLaunchedLeaf makes the first launch the root leaf (empty state)', async () => {
    const store = useLayoutStore()
    store.loadLayout(null, PID)

    store.insertLaunchedLeaf(null, 'new-1')
    expect(store.tree).toEqual({ version: 1, root: { type: 'leaf', sessionId: 'new-1' } })

    await vi.advanceTimersByTimeAsync(500)
    const setLayout = (window as unknown as { chorus: { setLayout: ReturnType<typeof vi.fn> } })
      .chorus.setLayout
    expect(setLayout).toHaveBeenLastCalledWith({
      project_id: PID,
      layout: { version: 1, root: { type: 'leaf', sessionId: 'new-1' } }
    })
  })

  it('insertLaunchedLeaf splits the target pane in the requested direction', () => {
    const store = useLayoutStore()
    store.loadLayout(twoLeafTree(), PID)

    store.insertLaunchedLeaf({ targetSessionId: 'b', direction: 'column' }, 'new-2')
    expect(store.tree?.root).toEqual({
      type: 'row',
      ratio: 0.5,
      children: [
        { type: 'leaf', sessionId: 'a' },
        {
          type: 'column',
          ratio: 0.5,
          children: [
            { type: 'leaf', sessionId: 'b' },
            { type: 'leaf', sessionId: 'new-2' }
          ]
        }
      ]
    })
  })
})
