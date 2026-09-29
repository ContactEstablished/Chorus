import { describe, expect, it } from 'vitest'
import {
  UI_ZOOM_DEFAULT_PERCENT,
  UI_ZOOM_MAX_PERCENT,
  UI_ZOOM_MIN_PERCENT,
  applyZoomAction,
  normalizeZoomPercent,
  zoomActionForKey
} from './uiZoom'

const key = (k: string, mods: Partial<{ control: boolean; alt: boolean; meta: boolean; type: string }> = {}) => ({
  type: 'keyDown',
  key: k,
  control: true,
  alt: false,
  meta: false,
  ...mods
})

describe('text size ladder', () => {
  it('steps 5% at a time, not Chromium’s preset jumps', () => {
    expect(applyZoomAction(100, 'in')).toBe(105)
    expect(applyZoomAction(105, 'in')).toBe(110)
    expect(applyZoomAction(100, 'out')).toBe(95)
    expect(applyZoomAction(135, 'reset')).toBe(UI_ZOOM_DEFAULT_PERCENT)
  })

  it('stops at the ends instead of wrapping or overshooting', () => {
    expect(applyZoomAction(UI_ZOOM_MAX_PERCENT, 'in')).toBe(UI_ZOOM_MAX_PERCENT)
    expect(applyZoomAction(UI_ZOOM_MIN_PERCENT, 'out')).toBe(UI_ZOOM_MIN_PERCENT)
  })

  it('snaps an off-ladder value before stepping from it', () => {
    expect(normalizeZoomPercent(103)).toBe(105)
    expect(normalizeZoomPercent(12)).toBe(UI_ZOOM_MIN_PERCENT)
    expect(normalizeZoomPercent(999)).toBe(UI_ZOOM_MAX_PERCENT)
    expect(normalizeZoomPercent(Number.NaN)).toBe(UI_ZOOM_DEFAULT_PERCENT)
    expect(applyZoomAction(103, 'in')).toBe(110)
  })
})

describe('zoom shortcuts', () => {
  it('maps Ctrl+= / Ctrl++ / Ctrl+- / Ctrl+0, main row and numpad alike', () => {
    expect(zoomActionForKey(key('='))).toBe('in')
    expect(zoomActionForKey(key('+'))).toBe('in')
    expect(zoomActionForKey(key('-'))).toBe('out')
    expect(zoomActionForKey(key('0'))).toBe('reset')
  })

  it('never reads Ctrl+Shift+- (^_) or Ctrl+Shift+0 as a zoom', () => {
    expect(zoomActionForKey(key('_'))).toBeNull()
    expect(zoomActionForKey(key(')'))).toBeNull()
  })

  it('ignores key-up, bare keys, AltGr (Ctrl+Alt) and Meta', () => {
    expect(zoomActionForKey(key('=', { type: 'keyUp' }))).toBeNull()
    expect(zoomActionForKey(key('=', { control: false }))).toBeNull()
    expect(zoomActionForKey(key('0', { alt: true }))).toBeNull()
    expect(zoomActionForKey(key('-', { meta: true }))).toBeNull()
  })
})
