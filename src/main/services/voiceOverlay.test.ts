import { describe, it, expect } from 'vitest'
import { overlayPlacement } from './voiceOverlay'

/**
 * `voiceOverlay.ts` imports `electron`, which Vitest cannot load — but the
 * import is only reached when `createVoiceOverlay` runs, and `overlayPlacement`
 * is a pure function beside it. That is exactly why it was written pure and
 * exported. (It carried that claim in a comment for months with no test behind
 * it; this is the test.)
 */

/** Matches the constants in voiceOverlay.ts. Pinned here on purpose: a size
 *  change should have to be made in two places and thought about once. */
const W = 320
const H = 188

/** A plain 1920x1080 display with no docked taskbar. */
const AREA = { x: 0, y: 0, width: 1920, height: 1080 }

describe('overlayPlacement centres on the Chorus window', () => {
  it('puts the overlay in the middle of the host window', () => {
    const host = { x: 200, y: 100, width: 1200, height: 800 }
    expect(overlayPlacement(host, AREA)).toEqual({
      x: 200 + (1200 - W) / 2,
      y: 100 + (800 - H) / 2
    })
  })

  it('follows the host rather than the display', () => {
    const left = overlayPlacement({ x: 0, y: 0, width: 800, height: 600 }, AREA)
    const right = overlayPlacement({ x: 1000, y: 400, width: 800, height: 600 }, AREA)
    expect(left).not.toEqual(right)
    expect(right.x - left.x).toBe(1000)
    expect(right.y - left.y).toBe(400)
  })

  it('centres on a display on a negative-origin monitor', () => {
    // A second monitor left of the primary has negative coordinates; the
    // arithmetic must not assume the desktop starts at 0,0.
    const area = { x: -1920, y: 0, width: 1920, height: 1080 }
    const host = { x: -1720, y: 100, width: 1200, height: 800 }
    expect(overlayPlacement(host, area)).toEqual({
      x: -1720 + (1200 - W) / 2,
      y: 100 + (800 - H) / 2
    })
  })

  it('rounds to whole pixels', () => {
    const { x, y } = overlayPlacement({ x: 0, y: 0, width: 1001, height: 601 }, AREA)
    expect(Number.isInteger(x)).toBe(true)
    expect(Number.isInteger(y)).toBe(true)
  })
})

describe('overlayPlacement falls back to the work area', () => {
  it('centres on the display when there is no usable host window', () => {
    // Null covers all three of: no main window yet, destroyed, and minimized.
    expect(overlayPlacement(null, AREA)).toEqual({
      x: (1920 - W) / 2,
      y: (1080 - H) / 2
    })
  })

  it('respects a work area that excludes a docked taskbar', () => {
    const area = { x: 0, y: 0, width: 1920, height: 1032 }
    expect(overlayPlacement(null, area).y).toBe((1032 - H) / 2)
  })
})

describe('overlayPlacement never lands off-screen', () => {
  it('clamps a host hanging off the left and top edges', () => {
    const host = { x: -900, y: -700, width: 1000, height: 800 }
    expect(overlayPlacement(host, AREA)).toEqual({ x: 0, y: 0 })
  })

  it('clamps a host hanging off the right and bottom edges', () => {
    const host = { x: 1800, y: 1000, width: 1000, height: 800 }
    expect(overlayPlacement(host, AREA)).toEqual({
      x: 1920 - W,
      y: 1080 - H
    })
  })

  it('keeps a maximized host centred, since it cannot escape its own display', () => {
    expect(overlayPlacement(AREA, AREA)).toEqual(overlayPlacement(null, AREA))
  })

  it('does not invert when the work area is smaller than the overlay', () => {
    // A tiny/rotated display. The lower bound must win rather than producing an
    // x greater than the right edge.
    const tiny = { x: 40, y: 60, width: 200, height: 100 }
    expect(overlayPlacement({ x: 0, y: 0, width: 4000, height: 4000 }, tiny)).toEqual({
      x: 40,
      y: 60
    })
  })
})
