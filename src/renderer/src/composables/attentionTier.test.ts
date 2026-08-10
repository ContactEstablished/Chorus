import { describe, expect, it } from 'vitest'
import { ageLabel, tierFor } from './attentionTier'

/**
 * The escalation ladder, asserted against the rungs the design doc states
 * verbatim (`docs/design/v2/Chorus Needs Attention.html`, panel D):
 *
 *   0–30s  calm · 30s–5m  pulse · 5m–20m  urgent · 20m+  stale
 *
 * The boundaries are the whole contract, so they are tested ON the second
 * rather than in the middle of each band.
 */

const T0 = 1_000_000_000_000
const at = (msAgo: number): number => T0 + msAgo

describe('tierFor — the rungs and their boundaries', () => {
  it('is calm for the first 30 seconds — the stop may resolve itself', () => {
    expect(tierFor(T0, at(0))).toBe('calm')
    expect(tierFor(T0, at(29_999))).toBe('calm')
  })

  it('begins pulsing at exactly 30s', () => {
    expect(tierFor(T0, at(30_000))).toBe('pulse')
    expect(tierFor(T0, at(4 * 60_000 + 59_999))).toBe('pulse')
  })

  it('escalates to urgent at exactly 5m', () => {
    expect(tierFor(T0, at(5 * 60_000))).toBe('urgent')
    expect(tierFor(T0, at(19 * 60_000 + 59_999))).toBe('urgent')
  })

  it('goes STALE at exactly 20m — the pulse stops rather than intensifying', () => {
    // ⚠ THE LADDER IS NOT A DECAY CURVE AND NOT A RAMP. Intensity peaks in the
    // MIDDLE: motion you have already ignored for 20 minutes has stopped being
    // information, so it resolves. This assertion is the one that fails if
    // someone "fixes" the ladder into a monotonic escalation.
    expect(tierFor(T0, at(20 * 60_000))).toBe('stale')
    expect(tierFor(T0, at(60 * 60_000))).toBe('stale')
    expect(tierFor(T0, at(72 * 3_600_000))).toBe('stale')
  })

  it('treats a null instant as stale — never as fresh', () => {
    // Null means "began before this app run" (an error with no recorded exit
    // instant). It must never pulse: substituting a fresh-looking age would
    // make every launch look like an emergency.
    expect(tierFor(null, at(0))).toBe('stale')
  })

  it('lands clock skew from the future on the CALM rung', () => {
    // A light that is briefly too quiet is a smaller failure than one that
    // pulses at nothing.
    expect(tierFor(at(60_000), T0)).toBe('calm')
  })
})

describe('ageLabel — the copy that takes over when the motion stops', () => {
  it('counts seconds while seconds still matter', () => {
    expect(ageLabel(T0, at(0))).toBe('0s')
    expect(ageLabel(T0, at(45_000))).toBe('45s')
  })

  it('reads minutes-and-seconds under 10m, in the mock’s own register', () => {
    // The mock writes `waiting 4m 12s` / `waiting 6m 40s`.
    expect(ageLabel(T0, at(4 * 60_000 + 12_000))).toBe('4m 12s')
    expect(ageLabel(T0, at(6 * 60_000 + 40_000))).toBe('6m 40s')
    expect(ageLabel(T0, at(3 * 60_000))).toBe('3m')
  })

  it('drops the seconds past 10m, where they are noise on the number', () => {
    expect(ageLabel(T0, at(24 * 60_000 + 37_000))).toBe('24m')
  })

  it('rolls up to hours and days', () => {
    expect(ageLabel(T0, at(90 * 60_000))).toBe('1h')
    expect(ageLabel(T0, at(50 * 3_600_000))).toBe('2d')
  })

  it('says NOTHING rather than a placeholder for an unknown instant', () => {
    // D76: say what is true and stop. "—" is exactly the placeholder the rule
    // rules out everywhere else in the app.
    expect(ageLabel(null, at(0))).toBe('')
  })
})
