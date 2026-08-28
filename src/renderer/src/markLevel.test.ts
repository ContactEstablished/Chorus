import { describe, it, expect } from 'vitest'
import {
  ATTACK_MS,
  BAR_RAMPS,
  MARK_BAR_COUNT,
  MARK_DIM,
  MARK_LEAD_INDEX,
  RELEASE_MS,
  SPEECH_FULL_SCALE,
  barOpacities,
  displayLevelFromRms,
  smoothLevel,
  smoothstep
} from './markLevel'

/** A sweep fine enough to catch a non-monotonic patch in any ramp. */
const SWEEP = Array.from({ length: 201 }, (_, i) => i / 200)

describe('the mark is symmetric at every level', () => {
  it('has one ramp per bar', () => {
    expect(BAR_RAMPS).toHaveLength(MARK_BAR_COUNT)
    expect(barOpacities(0.5)).toHaveLength(MARK_BAR_COUNT)
  })

  it('mirrors the three pairs about the lead bar', () => {
    // The symmetry IS the mark (ChorusMark.vue). If a ramp is edited on one
    // side only, the jade bar stops looking central and this fails.
    for (const level of SWEEP) {
      const o = barOpacities(level)
      expect(o[0]).toBeCloseTo(o[6], 12)
      expect(o[1]).toBeCloseTo(o[5], 12)
      expect(o[2]).toBeCloseTo(o[4], 12)
    }
  })
})

describe('bars light outward from the lead', () => {
  it('never puts an outer bar brighter than an inner one', () => {
    for (const level of SWEEP) {
      const o = barOpacities(level)
      expect(o[MARK_LEAD_INDEX]).toBeGreaterThanOrEqual(o[2] - 1e-12)
      expect(o[2]).toBeGreaterThanOrEqual(o[1] - 1e-12)
      expect(o[1]).toBeGreaterThanOrEqual(o[0] - 1e-12)
    }
  })

  it('rises with the level, bar by bar', () => {
    for (let i = 1; i < SWEEP.length; i++) {
      const prev = barOpacities(SWEEP[i - 1])
      const next = barOpacities(SWEEP[i])
      for (let bar = 0; bar < MARK_BAR_COUNT; bar++) {
        expect(next[bar]).toBeGreaterThanOrEqual(prev[bar] - 1e-12)
      }
    }
  })

  it('lights the lead bar at a whisper and the outer pair only when loud', () => {
    const quiet = barOpacities(0.05)
    expect(quiet[MARK_LEAD_INDEX]).toBeGreaterThan(MARK_DIM)
    expect(quiet[0]).toBeCloseTo(MARK_DIM, 12)

    const loud = barOpacities(1)
    for (const o of loud) expect(o).toBeCloseTo(1, 12)
  })
})

describe('the mark never disappears', () => {
  it('floors every bar at MARK_DIM in silence', () => {
    for (const o of barOpacities(0)) expect(o).toBeCloseTo(MARK_DIM, 12)
  })

  it('stays inside [MARK_DIM, 1] for any input, including nonsense', () => {
    for (const level of [...SWEEP, -5, 5, Number.NaN, Number.POSITIVE_INFINITY]) {
      for (const o of barOpacities(level)) {
        expect(o).toBeGreaterThanOrEqual(MARK_DIM - 1e-12)
        expect(o).toBeLessThanOrEqual(1 + 1e-12)
      }
    }
  })
})

describe('smoothstep', () => {
  it('is flat outside its thresholds and centred inside them', () => {
    expect(smoothstep(0.2, 0.8, 0)).toBe(0)
    expect(smoothstep(0.2, 0.8, 1)).toBe(1)
    expect(smoothstep(0.2, 0.8, 0.5)).toBeCloseTo(0.5, 12)
  })

  it('does not divide by zero on a degenerate ramp', () => {
    expect(smoothstep(0.5, 0.5, 0.4)).toBe(0)
    expect(smoothstep(0.5, 0.5, 0.5)).toBe(1)
  })
})

describe('displayLevelFromRms', () => {
  it('puts a speech peak at full scale and an ambient room at nothing', () => {
    // Anchors measured in whisperCore.ts: speech peak 0.38, ambient 0.0015.
    expect(displayLevelFromRms(0.38)).toBe(1)
    expect(displayLevelFromRms(0.0015)).toBeLessThan(0.01)
    expect(displayLevelFromRms(SPEECH_FULL_SCALE)).toBeCloseTo(1, 12)
    expect(displayLevelFromRms(SPEECH_FULL_SCALE / 2)).toBeCloseTo(0.5, 12)
  })
})

describe('smoothLevel', () => {
  it('rises faster than it falls', () => {
    const up = smoothLevel(0, 1, 16)
    const down = 1 - smoothLevel(1, 0, 16)
    expect(ATTACK_MS).toBeLessThan(RELEASE_MS)
    expect(up).toBeGreaterThan(down)
  })

  it('converges on the target and then settles exactly', () => {
    let v = 0
    for (let i = 0; i < 200; i++) v = smoothLevel(v, 1, 16)
    expect(v).toBe(1)

    for (let i = 0; i < 200; i++) v = smoothLevel(v, 0, 16)
    expect(v).toBe(0)
  })

  it('never overshoots, whatever the frame time', () => {
    for (const dt of [1, 8, 16, 33, 100, 5_000]) {
      expect(smoothLevel(0, 1, dt)).toBeLessThanOrEqual(1)
      expect(smoothLevel(1, 0, dt)).toBeGreaterThanOrEqual(0)
    }
  })

  it('is frame-rate independent to within a rounding error', () => {
    // 100 ms of easing, walked at 60 Hz and at 144 Hz, must land in the same
    // place — otherwise the mark rises at a different speed per display.
    let sixty = 0
    for (let t = 0; t < 100; t += 100 / 6) sixty = smoothLevel(sixty, 1, 100 / 6)
    let fast = 0
    for (let t = 0; t < 100; t += 100 / 14.4) fast = smoothLevel(fast, 1, 100 / 14.4)
    expect(Math.abs(sixty - fast)).toBeLessThan(0.02)
  })

  it('holds still on a zero or nonsense frame time', () => {
    expect(smoothLevel(0.4, 1, 0)).toBe(0.4)
    expect(smoothLevel(0.4, 1, -16)).toBe(0.4)
    expect(smoothLevel(0.4, 1, Number.NaN)).toBe(0.4)
  })

  it('clamps a huge frame time rather than jumping the whole way', () => {
    // A stalled renderer hands back a dt of seconds; the mark should catch up
    // over the next frames, not snap.
    expect(smoothLevel(0, 1, 60_000)).toBe(smoothLevel(0, 1, 250))
    expect(smoothLevel(0, 1, 60_000)).toBeLessThan(1)
  })
})
