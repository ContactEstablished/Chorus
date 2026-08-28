import { describe, expect, it } from 'vitest'
import { formatPromptAge } from './promptAge'

const NOW = new Date('2026-08-27T12:00:00.000Z')

/** An ISO stamp `seconds` before NOW. */
function ago(seconds: number): string {
  return new Date(NOW.getTime() - seconds * 1000).toISOString()
}

describe('formatPromptAge', () => {
  it('reads "just now" for something sent seconds ago', () => {
    expect(formatPromptAge(ago(0), NOW)).toBe('just now')
    expect(formatPromptAge(ago(44), NOW)).toBe('just now')
  })

  it('switches to minutes at the threshold', () => {
    expect(formatPromptAge(ago(45), NOW)).toBe('1m ago')
    expect(formatPromptAge(ago(300), NOW)).toBe('5m ago')
  })

  it('switches to hours past an hour', () => {
    expect(formatPromptAge(ago(3600), NOW)).toBe('1h ago')
    expect(formatPromptAge(ago(3600 * 5), NOW)).toBe('5h ago')
  })

  it('switches to days past a day', () => {
    expect(formatPromptAge(ago(3600 * 24), NOW)).toBe('1d ago')
    expect(formatPromptAge(ago(3600 * 24 * 3), NOW)).toBe('3d ago')
  })

  it('reads "just now" rather than a negative age when the clock skews', () => {
    expect(formatPromptAge(ago(-30), NOW)).toBe('just now')
  })

  it('degrades to no age on an unparseable stamp instead of rendering NaN', () => {
    expect(formatPromptAge('not a date', NOW)).toBe('')
  })
})
