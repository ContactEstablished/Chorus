import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useLayoutStore } from './layout'
import type { LayoutJson } from '../../../shared/layout'

// Store-level clamp assertion (Task 1-3): an out-of-range ratio submitted via
// applyRatio is clamped to [0.05, 0.95] in the store BEFORE it is persisted —
// the client half of the council's defense-in-depth clamping (main re-clamps).
// Pure logic: no DB, no Electron; window.chorus.setLayout is stubbed.

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
    store.loadLayout(twoLeafTree())

    store.applyRatio([], 0.99)
    expect(rootRatio(store.tree)).toBe(0.95)
    expect(store.dirty).toBe(true)

    await vi.advanceTimersByTimeAsync(500)
    const setLayout = (window as unknown as { chorus: { setLayout: ReturnType<typeof vi.fn> } })
      .chorus.setLayout
    expect(setLayout).toHaveBeenCalledOnce()
    const persisted = setLayout.mock.calls[0][0] as LayoutJson
    expect(rootRatio(persisted)).toBe(0.95)
    expect(store.dirty).toBe(false)
  })

  it('clamps a below-range ratio before persist', async () => {
    const store = useLayoutStore()
    store.loadLayout(twoLeafTree())

    store.applyRatio([], 0.01)
    expect(rootRatio(store.tree)).toBe(0.05)

    await vi.advanceTimersByTimeAsync(500)
    const setLayout = (window as unknown as { chorus: { setLayout: ReturnType<typeof vi.fn> } })
      .chorus.setLayout
    const persisted = setLayout.mock.calls[0][0] as LayoutJson
    expect(rootRatio(persisted)).toBe(0.05)
  })

  it('removeLeaf keeps the last leaf (close-guard) and absorbs otherwise', () => {
    const store = useLayoutStore()
    store.loadLayout(twoLeafTree())

    store.removeLeaf('a')
    expect(store.tree?.root).toEqual({ type: 'leaf', sessionId: 'b' })

    // Now a single leaf: removing it must be a no-op.
    store.removeLeaf('b')
    expect(store.tree?.root).toEqual({ type: 'leaf', sessionId: 'b' })
  })
})
