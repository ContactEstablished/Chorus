import { describe, it, expect } from 'vitest'
import { buildReport, shouldReport, type AttentionReportFacts } from './reporter'

const facts = (over: Partial<AttentionReportFacts> = {}): AttentionReportFacts => ({
  projectId: '985d547b-0000-4000-8000-000000000001',
  sessionId: '985d547b-0000-4000-8000-00000000000a',
  view: 'workspace',
  overlayOpen: false,
  ...over
})

describe('shouldReport — edge-triggered, never polled', () => {
  it('always sends the first report (main has none yet)', () => {
    expect(shouldReport(null, buildReport(facts()))).toBe(true)
  })

  it('identical consecutive reports produce NO send', () => {
    const a = buildReport(facts())
    const b = buildReport(facts())
    expect(shouldReport(a, b)).toBe(false)
  })

  it('any one field changing produces exactly one send', () => {
    const prev = buildReport(facts())
    expect(shouldReport(prev, buildReport(facts({ sessionId: null })))).toBe(true)
    expect(shouldReport(prev, buildReport(facts({ view: 'settings' })))).toBe(true)
    expect(shouldReport(prev, buildReport(facts({ overlayOpen: true })))).toBe(true)
    expect(shouldReport(prev, buildReport(facts({ projectId: null })))).toBe(true)
  })

  it('a settled sequence sends once per real edge, not once per evaluation', () => {
    // The shape App.vue's watcher produces: many re-evaluations, four changes.
    const script = [
      facts(),
      facts(),
      facts({ sessionId: null }),
      facts({ sessionId: null }),
      facts({ sessionId: null, overlayOpen: true }),
      facts({ sessionId: null, overlayOpen: true }),
      facts({ sessionId: null, overlayOpen: false, view: 'settings' }),
      facts({ sessionId: null, overlayOpen: false, view: 'settings' })
    ]
    let prev: ReturnType<typeof buildReport> | null = null
    let sends = 0
    for (const f of script) {
      const next = buildReport(f)
      if (shouldReport(prev, next)) {
        sends += 1
        prev = next
      }
    }
    expect(sends).toBe(4)
  })
})

describe('buildReport — the D14 trap, as a test rather than a comment', () => {
  it('emits a PLAIN object literal whose every value is a primitive or null', () => {
    const r = buildReport(facts())
    // A Pinia/reactive value is a Vue Proxy; Electron's structured clone rejects
    // it at RUNTIME with no compile-time signal. This assertion is what makes
    // that class of bug fail in CI instead of in a dump.
    expect(Object.getPrototypeOf(r)).toBe(Object.prototype)
    for (const value of Object.values(r)) {
      expect(value === null || typeof value !== 'object').toBe(true)
      expect(typeof value === 'function').toBe(false)
    }
  })

  it('carries exactly the four reported facts — nothing else rides along', () => {
    expect(Object.keys(buildReport(facts())).sort()).toEqual([
      'overlayOpen',
      'projectId',
      'sessionId',
      'view'
    ])
  })

  it('does not alias its input — a later mutation of the facts cannot rewrite a sent report', () => {
    const f = { ...facts() }
    const r = buildReport(f)
    f.sessionId = 'mutated'
    expect(r.sessionId).not.toBe('mutated')
  })
})
