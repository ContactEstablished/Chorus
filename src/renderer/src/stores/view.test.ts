import { describe, expect, it } from 'vitest'
import { resolveFocused } from './view'
import type { LayoutJson } from '../../../shared/layout'

// The F4 total-fallback contract (Task 1b-2): a focusedSessionId legitimately
// outlives its session — resolveFocused must never crash, never assert
// non-null, and always land on a renderable leaf (or null for a null tree).
// Pure function: no Pinia instance, no window.chorus.

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

describe('resolveFocused (F4 fallback)', () => {
  it('passes a live leaf id through', () => {
    expect(resolveFocused(twoLeafTree(), 'b')).toBe('b')
  })

  it('falls back to the first leaf in tree order for a stale id', () => {
    expect(resolveFocused(twoLeafTree(), 'gone-session-id')).toBe('a')
  })

  it('falls back to the first leaf for a null id (fresh default state)', () => {
    expect(resolveFocused(twoLeafTree(), null)).toBe('a')
  })

  it('yields null for a null tree (empty state), stale id or not', () => {
    expect(resolveFocused(null, 'anything')).toBeNull()
    expect(resolveFocused(null, null)).toBeNull()
  })

  it('handles a single-leaf root', () => {
    const single: LayoutJson = { version: 1, root: { type: 'leaf', sessionId: 'only' } }
    expect(resolveFocused(single, null)).toBe('only')
    expect(resolveFocused(single, 'only')).toBe('only')
    expect(resolveFocused(single, 'stale')).toBe('only')
  })
})
