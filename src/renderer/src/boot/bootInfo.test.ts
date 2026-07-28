import { describe, it, expect } from 'vitest'
import { bootLine, footerLine, parseBootInfo } from './bootInfo'

describe('parseBootInfo', () => {
  it('reads a well-formed query', () => {
    expect(parseBootInfo('?restoring=3&v=0.1.0&platform=windows%20x64')).toEqual({
      restoringSessions: 3,
      version: '0.1.0',
      platform: 'windows x64'
    })
  })

  it('is total on an empty query — the cold-boot / no-args case', () => {
    expect(parseBootInfo('')).toEqual({
      restoringSessions: 0,
      version: null,
      platform: null
    })
  })

  // D76: a malformed count must degrade to "say nothing", never to a guess.
  it.each([
    ['?restoring=0', 'an explicit zero'],
    ['?restoring=-2', 'a negative'],
    ['?restoring=3abc', 'trailing garbage parseInt would have accepted as 3'],
    ['?restoring=2.5', 'a fraction'],
    ['?restoring=16.9', 'a fraction parseInt would have accepted as 16'],
    ['?restoring=', 'an empty value'],
    ['?restoring=NaN', 'the literal NaN'],
    ['?restoring=1e3', 'exponent notation above the cap'],
    ['?restoring=17', 'one past RESTORE_CAP'],
    ['?restoring=9001', 'far past RESTORE_CAP']
  ])('resolves %s to 0 (%s)', (search) => {
    expect(parseBootInfo(search).restoringSessions).toBe(0)
  })

  it('accepts the cap itself', () => {
    expect(parseBootInfo('?restoring=16').restoringSessions).toBe(16)
  })

  it('drops blank and over-long labels rather than rendering them', () => {
    const info = parseBootInfo(`?v=${'9'.repeat(41)}&platform=%20%20`)
    expect(info.version).toBeNull()
    expect(info.platform).toBeNull()
  })

  it('trims labels', () => {
    expect(parseBootInfo('?v=%200.1.0%20&platform=%20windows%20x64%20')).toMatchObject({
      version: '0.1.0',
      platform: 'windows x64'
    })
  })
})

describe('bootLine', () => {
  it('omits the line entirely on a cold boot (D76 — never render a zero)', () => {
    expect(bootLine(parseBootInfo(''))).toBeNull()
  })

  it('is singular for one session', () => {
    expect(bootLine(parseBootInfo('?restoring=1'))).toBe('restoring 1 session')
  })

  it('is plural beyond one', () => {
    expect(bootLine(parseBootInfo('?restoring=4'))).toBe('restoring 4 sessions')
  })
})

describe('footerLine', () => {
  it('renders both halves', () => {
    expect(footerLine(parseBootInfo('?v=0.1.0&platform=windows%20x64'))).toBe(
      'chorus v0.1.0 · windows x64'
    )
  })

  // A dangling separator reads as a bug; no footer reads as a design.
  it.each([
    ['?v=0.1.0', 'version alone'],
    ['?platform=windows%20x64', 'platform alone'],
    ['', 'neither']
  ])('omits the footer given %s (%s)', (search) => {
    expect(footerLine(parseBootInfo(search))).toBeNull()
  })
})
