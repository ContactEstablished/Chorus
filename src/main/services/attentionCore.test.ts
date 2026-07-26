import { describe, it, expect } from 'vitest'
import {
  advance,
  classify,
  coverage,
  creditedSeconds,
  emptyByClass,
  sameSlot,
  slotFor,
  ATTENTION_CLASSES,
  IDLE_THRESHOLD_SECONDS,
  TICK_SECONDS,
  type AttentionClass,
  type AttentionInputs,
  type AttentionRun,
  type AttentionSpanFact
} from './attentionCore'

const P = 'proj-1'
const A = 'sess-A'
const B = 'sess-B'

/** The "one state that counts" (table row 6). Every case below is this base
 *  with exactly the fields its row names changed, so a test reads as the row. */
function base(over: Partial<AttentionInputs> = {}): AttentionInputs {
  return {
    windowFocused: true,
    windowMinimized: false,
    osIdleSeconds: 0,
    osLocked: false,
    projectId: P,
    activeSessionId: A,
    rendererView: 'workspace',
    overlayOpen: false,
    reportStale: false,
    captureEnabled: true,
    ...over
  }
}

const MS = 1_700_000_000_000
const TICK_MS = TICK_SECONDS * 1000

describe('constants — §5.3 verbatim, and the cadence that divides it', () => {
  it('idle threshold is 60 s and the tick divides it evenly', () => {
    expect(IDLE_THRESHOLD_SECONDS).toBe(60)
    expect(TICK_SECONDS).toBe(15)
    expect(IDLE_THRESHOLD_SECONDS % TICK_SECONDS).toBe(0)
  })
})

/* ------------------------------------------------------------------ */
/* The focus-state table — thirteen rows, one case each, named after   */
/* the row. This table IS the specification of classify().             */
/* ------------------------------------------------------------------ */

describe('focus-state table (Task-3a-2.md) — one case per row', () => {
  it('row 1 — workstation locked -> locked, credits nothing to any session', () => {
    const i = base({ osLocked: true })
    expect(classify(i)).toBe('locked')
    expect(slotFor(i)).toEqual({ projectId: P, sessionId: null, cls: 'locked' })
  })

  it('row 2 — system suspended/resuming latches the same flag -> locked', () => {
    // 'suspend' latches osLocked exactly as 'lock-screen' does; the seam
    // additionally forces the resume tick to be a gap.
    const i = base({ osLocked: true, osIdleSeconds: 900 })
    expect(classify(i)).toBe('locked')
    expect(slotFor(i)?.cls).toBe('locked')
  })

  it('row 3 — OS idle >= 60 s -> idle, credits nothing', () => {
    const i = base({ osIdleSeconds: 60 })
    expect(classify(i)).toBe('idle')
    expect(slotFor(i)).toEqual({ projectId: P, sessionId: null, cls: 'idle' })
  })

  it('row 4 — window blurred (another app on top) -> blurred, NOT overhead', () => {
    const i = base({ windowFocused: false })
    expect(classify(i)).toBe('blurred')
    // §5.3 scopes the overhead bucket to "time spent in Chorus"; another app on
    // top is not in Chorus. Recorded, not dropped.
    expect(slotFor(i)).toEqual({ projectId: P, sessionId: null, cls: 'blurred' })
  })

  it('row 5 — window minimized -> blurred', () => {
    const i = base({ windowMinimized: true })
    expect(classify(i)).toBe('blurred')
    expect(slotFor(i)?.cls).toBe('blurred')
  })

  it('row 6 — focused · workspace · a terminal host holds DOM focus -> pane, credited to THAT session', () => {
    const i = base()
    expect(classify(i)).toBe('pane')
    expect(slotFor(i)).toEqual({ projectId: P, sessionId: A, cls: 'pane' })
  })

  it('row 7 — focused · workspace · focus on chrome -> overhead, session NULL', () => {
    const i = base({ activeSessionId: null })
    expect(classify(i)).toBe('overhead')
    expect(slotFor(i)).toEqual({ projectId: P, sessionId: null, cls: 'overhead' })
  })

  it('row 8 — settings view open -> overhead', () => {
    const i = base({ rendererView: 'settings' })
    expect(classify(i)).toBe('overhead')
    expect(slotFor(i)?.sessionId).toBeNull()
  })

  it('row 8 (3b-4) — the COUNCIL view is overhead too, and for the same reason', () => {
    // No TerminalPane is mounted in a view, so there is nothing to attribute a
    // tick to. The rule is "not the workspace", not a list of view names.
    const i = base({ rendererView: 'council' })
    expect(classify(i)).toBe('overhead')
    expect(slotFor(i)?.sessionId).toBeNull()
  })

  it('row 9 — an overlay is open -> overhead', () => {
    const i = base({ overlayOpen: true })
    expect(classify(i)).toBe('overhead')
    expect(slotFor(i)?.sessionId).toBeNull()
  })

  it('row 10 — the focused pane’s session exited -> overhead (main cleared activeSessionId)', () => {
    // The seam's onSessionExited nulls the reported session when it matches, so
    // the core sees exactly the row-7 shape. Reading a dead pane's scrollback is
    // real work, but crediting it to the session would inflate that dispatch's
    // cost AFTER the dispatch ended. Ruled to overhead knowingly.
    const i = base({ activeSessionId: null })
    expect(classify(i)).toBe('overhead')
  })

  it('row 11 — renderer report is stale (reload / HMR / pre-mount) -> overhead', () => {
    const i = base({ reportStale: true })
    expect(classify(i)).toBe('overhead')
    expect(slotFor(i)?.sessionId).toBeNull()
  })

  it('row 12 — no active project -> row SUPPRESSED (no slot at all)', () => {
    const i = base({ projectId: null })
    expect(slotFor(i)).toBeNull()
  })

  it('row 13 — capture disabled by the user -> nothing written, whatever the state', () => {
    expect(slotFor(base({ captureEnabled: false }))).toBeNull()
    // Even the states that WOULD have counted write nothing.
    expect(slotFor(base({ captureEnabled: false, activeSessionId: A }))).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* Precedence — states that satisfy several rows at once               */
/* ------------------------------------------------------------------ */

describe('precedence: locked -> idle -> blurred -> overhead -> pane, first match wins', () => {
  it('locked AND idle -> locked', () => {
    expect(classify(base({ osLocked: true, osIdleSeconds: 300 }))).toBe('locked')
  })

  it('idle AND blurred -> idle (blurred keeps its precise meaning: in use, elsewhere)', () => {
    expect(classify(base({ osIdleSeconds: 120, windowFocused: false }))).toBe('idle')
  })

  it('blurred AND a pane focused -> blurred', () => {
    expect(classify(base({ windowFocused: false, activeSessionId: A }))).toBe('blurred')
  })

  it('overlay open AND a pane focused -> overhead (row 9’s trap)', () => {
    // The single easiest ordering mistake in classify(): an overlay can be open
    // while a terminal underneath still holds DOM focus.
    expect(classify(base({ overlayOpen: true, activeSessionId: A }))).toBe('overhead')
    expect(slotFor(base({ overlayOpen: true, activeSessionId: A }))?.sessionId).toBeNull()
  })

  it('settings view AND a pane reported -> overhead', () => {
    expect(classify(base({ rendererView: 'settings', activeSessionId: A }))).toBe('overhead')
  })

  it('stale report AND a pane reported -> overhead', () => {
    expect(classify(base({ reportStale: true, activeSessionId: A }))).toBe('overhead')
  })

  it('capture disabled beats EVERYTHING, including locked', () => {
    expect(slotFor(base({ captureEnabled: false, osLocked: true }))).toBeNull()
  })

  it('no project beats everything except the kill switch', () => {
    expect(slotFor(base({ projectId: null, osLocked: true }))).toBeNull()
  })
})

describe('idle boundary is exact — the threshold is >=', () => {
  it('59 s counts, 60 s is idle', () => {
    expect(classify(base({ osIdleSeconds: 59 }))).toBe('pane')
    expect(classify(base({ osIdleSeconds: 60 }))).toBe('idle')
  })

  it('59.9 counts and 60.1 does not (the seam reads an integer, but the seam is not the authority)', () => {
    expect(classify(base({ osIdleSeconds: 59.9 }))).toBe('pane')
    expect(classify(base({ osIdleSeconds: 60.1 }))).toBe('idle')
  })
})

describe('sameSlot', () => {
  const s = { projectId: P, sessionId: A, cls: 'pane' as AttentionClass }
  it('is identity over the three fields, and null-safe', () => {
    expect(sameSlot(s, { ...s })).toBe(true)
    expect(sameSlot(s, { ...s, sessionId: B })).toBe(false)
    expect(sameSlot(s, { ...s, cls: 'overhead' })).toBe(false)
    expect(sameSlot(s, { ...s, projectId: 'other' })).toBe(false)
    expect(sameSlot(null, null)).toBe(true)
    expect(sameSlot(s, null)).toBe(false)
    expect(sameSlot(null, s)).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* Tick accounting — the crash-safety and sleep properties             */
/* ------------------------------------------------------------------ */

describe('tick accounting', () => {
  it('the same slot on consecutive firings EXTENDS one run', () => {
    const t1 = advance(null, base(), MS)
    expect(t1.action).toBe('open')
    expect(t1.run).toMatchObject({ samples: 1, startedAtMs: MS, lastTickMs: MS })

    const t2 = advance(t1.run, base(), MS + TICK_MS)
    expect(t2.action).toBe('extend')
    expect(t2.closed).toBeNull()
    expect(t2.run).toMatchObject({ samples: 2, startedAtMs: MS, lastTickMs: MS + TICK_MS })
  })

  it('a CHANGED slot closes the run and opens a new one', () => {
    const t1 = advance(null, base(), MS)
    const t2 = advance(t1.run, base({ activeSessionId: B }), MS + TICK_MS)
    expect(t2.action).toBe('open')
    expect(t2.closed).toBe(t1.run)
    expect(t2.run).toMatchObject({ samples: 1, startedAtMs: MS + TICK_MS })
    expect(t2.run?.slot.sessionId).toBe(B)
  })

  it('a firing 10 MINUTES late credits EXACTLY ONE sample and sets the gap flag', () => {
    // The whole defence against suspend / hibernate / clock skew. A wall-clock
    // accumulator would credit 600 s here.
    const t1 = advance(null, base(), MS)
    const t2 = advance(t1.run, base(), MS + 600_000)
    expect(t2.gap).toBe(true)
    expect(t2.action).toBe('open')
    expect(t2.run?.samples).toBe(1)
    expect(creditedSeconds(t2.run!)).toBe(TICK_SECONDS)
  })

  it('the gap threshold is two ticks: 2x on the nose extends, beyond it does not', () => {
    const t1 = advance(null, base(), MS)
    const onTheNose = advance(t1.run, base(), MS + TICK_MS * 2)
    expect(onTheNose.gap).toBe(false)
    expect(onTheNose.action).toBe('extend')

    const beyond = advance(t1.run, base(), MS + TICK_MS * 2 + 1)
    expect(beyond.gap).toBe(true)
    expect(beyond.action).toBe('open')
  })

  it('PROPERTY: over any sequence of firings, credited seconds === samples x TICK_SECONDS, exactly', () => {
    // Firings deliberately arrive at wildly irregular intervals, including two
    // suspends. The identity must hold anyway; that is what makes sleep unable
    // to inflate the number.
    const deltas = [0, 15_000, 15_100, 14_800, 600_000, 15_000, 15_000, 3_600_000, 15_000, 200]
    const states = [base(), base(), base(), base(), base(), base(), base(), base(), base(), base()]
    let run: AttentionRun | null = null
    let t = MS
    let totalSamples = 0
    let totalCredited = 0
    deltas.forEach((d, idx) => {
      t += d
      const out = advance(run, states[idx], t)
      if (out.closed) totalCredited += creditedSeconds(out.closed)
      run = out.run
      totalSamples += 1
    })
    if (run) totalCredited += creditedSeconds(run)
    expect(totalSamples).toBe(10)
    expect(totalCredited).toBe(10 * TICK_SECONDS)
    // ...even though 4,290 s of wall clock elapsed.
    expect(t - MS).toBe(4_290_100)
  })

  it('a suppressed tick (no project) closes the open run and writes nothing', () => {
    const t1 = advance(null, base(), MS)
    const t2 = advance(t1.run, base({ projectId: null }), MS + TICK_MS)
    expect(t2.action).toBe('none')
    expect(t2.run).toBeNull()
    expect(t2.closed).toBe(t1.run)
  })

  it('a suppressed tick (capture off) writes nothing, and re-enabling opens a FRESH run', () => {
    const t1 = advance(null, base(), MS)
    const t2 = advance(t1.run, base({ captureEnabled: false }), MS + TICK_MS)
    expect(t2.action).toBe('none')
    const t3 = advance(t2.run, base(), MS + TICK_MS * 2)
    expect(t3.action).toBe('open')
    expect(t3.run?.samples).toBe(1)
  })
})

/* ------------------------------------------------------------------ */
/* No retro-debit (spec §5.1 ruling (a)) — the biggest known bias      */
/* ------------------------------------------------------------------ */

describe('no retro-debit: credit is never revoked once written', () => {
  it('a 3-minute no-input stretch at 15 s credits 4 pane samples then 8 idle samples', () => {
    // §5.3's "anything over a 60-second idle threshold does not count" admits
    // two readings; ruled (a) — the EXCESS beyond 60 s does not count, the first
    // <=60 s is never retroactively cancelled. This exact split is the ruling,
    // pinned here so it cannot drift silently.
    let run: AttentionRun | null = null
    const counted = emptyByClass()
    for (let n = 0; n < 12; n++) {
      const t = MS + n * TICK_MS
      // Real shape of an untouched stretch: the OS counter climbs 15 s per tick.
      const idleSeconds = n * TICK_SECONDS
      const out = advance(run, base({ osIdleSeconds: idleSeconds }), t)
      run = out.run
      counted[run!.slot.cls] += 1
    }
    expect(counted.pane).toBe(4) // ticks at idle 0, 15, 30, 45
    expect(counted.idle).toBe(8) // ticks at idle 60 .. 165
    expect(counted.pane + counted.idle).toBe(12)
  })

  it('the pane run is CLOSED at its 4 samples and never shrinks afterwards', () => {
    let run: AttentionRun | null = null
    let closedPane: AttentionRun | null = null
    for (let n = 0; n < 12; n++) {
      const out = advance(run, base({ osIdleSeconds: n * TICK_SECONDS }), MS + n * TICK_MS)
      if (out.closed?.slot.cls === 'pane') closedPane = out.closed
      run = out.run
    }
    expect(closedPane?.samples).toBe(4)
    expect(creditedSeconds(closedPane!)).toBe(60)
    // 20 minutes of further idle changes nothing about the credited minute.
    expect(closedPane?.samples).toBe(4)
  })
})

/* ------------------------------------------------------------------ */
/* The accounting identity — the single best correctness check         */
/* ------------------------------------------------------------------ */

describe('the accounting identity: every tick lands in exactly one class', () => {
  it('holds over a synthesized sequence covering all five classes', () => {
    const script: AttentionInputs[] = [
      ...Array(3).fill(base()), // pane
      ...Array(2).fill(base({ activeSessionId: null })), // overhead
      ...Array(4).fill(base({ windowFocused: false })), // blurred
      ...Array(5).fill(base({ osIdleSeconds: 90 })), // idle
      ...Array(2).fill(base({ osLocked: true })), // locked
      ...Array(3).fill(base({ rendererView: 'settings' })), // overhead again
      ...Array(1).fill(base({ activeSessionId: B })) // pane, other session
    ]
    let run: AttentionRun | null = null
    const spans: AttentionSpanFact[] = []
    script.forEach((inputs, n) => {
      const t = MS + n * TICK_MS
      const out = advance(run, inputs, t)
      if (out.closed) {
        spans.push({
          cls: out.closed.slot.cls,
          seconds: creditedSeconds(out.closed),
          tickSeconds: TICK_SECONDS,
          startedAtMs: out.closed.startedAtMs,
          endedAtMs: out.closed.lastTickMs
        })
      }
      run = out.run
    })
    const open = run as AttentionRun | null
    if (open) {
      spans.push({
        cls: open.slot.cls,
        seconds: creditedSeconds(open),
        tickSeconds: TICK_SECONDS,
        startedAtMs: open.startedAtMs,
        endedAtMs: open.lastTickMs
      })
    }

    const cov = coverage(spans)
    const sumByClass = ATTENTION_CLASSES.reduce((acc, c) => acc + cov.byClass[c], 0)
    // THE IDENTITY. No tick silently vanishes.
    expect(sumByClass).toBe(cov.samples)
    expect(cov.samples).toBe(script.length)
    expect(cov.byClass).toEqual({ pane: 4, overhead: 5, blurred: 4, idle: 5, locked: 2 })
    // A contiguous drive has no holes: coverage is exactly 100%.
    expect(cov.expectedSamples).toBe(20)
    expect(cov.missingSamples).toBe(0)
    expect(cov.coveragePct).toBe(100)
  })
})

/* ------------------------------------------------------------------ */
/* coverage() — the denominator, honest about a crash-shaped hole      */
/* ------------------------------------------------------------------ */

describe('coverage()', () => {
  const span = (over: Partial<AttentionSpanFact> = {}): AttentionSpanFact => ({
    cls: 'pane',
    seconds: 5 * TICK_SECONDS,
    tickSeconds: TICK_SECONDS,
    startedAtMs: MS,
    endedAtMs: MS + 4 * TICK_MS,
    ...over
  })

  it('an empty window reports zeros rather than dividing by zero', () => {
    expect(coverage([])).toEqual({
      byClass: emptyByClass(),
      samples: 0,
      tickSeconds: TICK_SECONDS,
      expectedSamples: 0,
      missingSamples: 0,
      coveragePct: 0
    })
  })

  it('back-to-back spans read 100% coverage', () => {
    const cov = coverage([
      span({ cls: 'pane', seconds: 3 * TICK_SECONDS, startedAtMs: MS, endedAtMs: MS + 2 * TICK_MS }),
      span({ cls: 'idle', seconds: 2 * TICK_SECONDS, startedAtMs: MS + 3 * TICK_MS, endedAtMs: MS + 4 * TICK_MS })
    ])
    expect(cov.samples).toBe(5)
    expect(cov.expectedSamples).toBe(5)
    expect(cov.coveragePct).toBe(100)
  })

  it('a crash-shaped hole is VISIBLE — the envelope sees what per-span sums cannot', () => {
    // 3 samples, app tree-killed, cold boot 10 minutes later, 2 more samples.
    // Summing the two spans' own lengths would report 100%.
    const cov = coverage([
      span({ cls: 'pane', seconds: 3 * TICK_SECONDS, startedAtMs: MS, endedAtMs: MS + 2 * TICK_MS }),
      span({
        cls: 'pane',
        seconds: 2 * TICK_SECONDS,
        startedAtMs: MS + 600_000,
        endedAtMs: MS + 600_000 + TICK_MS
      })
    ])
    expect(cov.samples).toBe(5)
    expect(cov.expectedSamples).toBe(42)
    expect(cov.missingSamples).toBe(37)
    expect(cov.coveragePct).toBe(11.9)
  })

  it('samples come from EACH ROW’s own tickSeconds, never the current constant', () => {
    // A row written under a hypothetical 30 s cadence must still read as 4
    // samples, not 8. This is why tick_seconds is a column.
    const cov = coverage([span({ seconds: 120, tickSeconds: 30, endedAtMs: MS + 3 * 30_000 })])
    expect(cov.samples).toBe(4)
  })

  it('a corrupt row (zero/NaN seconds) is dropped rather than throwing', () => {
    const cov = coverage([
      span({ seconds: 3 * TICK_SECONDS, endedAtMs: MS + 2 * TICK_MS }),
      span({ seconds: Number.NaN }),
      span({ seconds: 0 })
    ])
    expect(cov.samples).toBe(3)
    expect(Number.isFinite(cov.coveragePct)).toBe(true)
  })

  it('timer jitter of a few hundred ms does not fabricate a missing sample', () => {
    const cov = coverage([
      span({ seconds: 5 * TICK_SECONDS, startedAtMs: MS, endedAtMs: MS + 4 * TICK_MS - 300 })
    ])
    expect(cov.expectedSamples).toBe(5)
    expect(cov.missingSamples).toBe(0)
  })
})
