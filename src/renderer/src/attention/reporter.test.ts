import { describe, it, expect } from 'vitest'
import { buildReport, shouldReport, type AttentionReportFacts } from './reporter'

const facts = (over: Partial<AttentionReportFacts> = {}): AttentionReportFacts => ({
  projectId: '985d547b-0000-4000-8000-000000000001',
  sessionId: '985d547b-0000-4000-8000-00000000000a',
  view: 'workspace',
  // D95: null unless the council view is the active one, which `buildReport`
  // enforces rather than trusting — see the D95 block at the bottom.
  councilProjectId: null,
  overlayOpen: false,
  ...over
})

const COUNCIL_P = '985d547b-0000-4000-8000-0000000000cc'

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

  // ⚠ FOUR -> FIVE IS D95's RESHAPE OF AN EXISTING PAYLOAD, AND IT IS UPDATED
  // DELIBERATELY HERE RATHER THAN LOOSENED. `IpcChannel` does not move: this is
  // a field on `attention:report`, not a channel. The assertion stays exact —
  // `toEqual` on the sorted key list — because its whole job is to catch a field
  // riding along uninvited, and `toContain` would let one through.
  it('carries exactly the five reported facts — nothing else rides along', () => {
    expect(Object.keys(buildReport(facts())).sort()).toEqual([
      'councilProjectId',
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

describe('D95 — the council project id, and the rule enforced where it is built', () => {
  it('carries the id when the council view is the active one', () => {
    const r = buildReport(facts({ view: 'council', councilProjectId: COUNCIL_P }))
    expect(r.councilProjectId).toBe(COUNCIL_P)
    expect(r.view).toBe('council')
  })

  it('⚠ NULLS IT FROM EVERY OTHER VIEW, even when the caller passes one', () => {
    // App.vue passes `projectStore.activeId` unconditionally — one primitive,
    // no branch at the call site — so this is the rule's only home. Main trusts
    // this field to mean "the council is working for this project"; a value
    // arriving from the workspace would credit council time to a view that is
    // not running a council.
    expect(buildReport(facts({ view: 'workspace', councilProjectId: COUNCIL_P })).councilProjectId).toBeNull()
    expect(buildReport(facts({ view: 'settings', councilProjectId: COUNCIL_P })).councilProjectId).toBeNull()
  })

  it('⚠ a project change WHILE IN the council view is a real edge and must send', () => {
    // Without `councilProjectId` in `shouldReport`, this switch changes no
    // reported field, no report is sent, and main goes on crediting the previous
    // project for the rest of the run.
    const prev = buildReport(facts({ view: 'council', councilProjectId: COUNCIL_P }))
    const next = buildReport(
      facts({ view: 'council', councilProjectId: '985d547b-0000-4000-8000-0000000000dd' })
    )
    expect(shouldReport(prev, next)).toBe(true)
  })

  it('entering and leaving the council view each send exactly once', () => {
    const inWorkspace = buildReport(facts())
    const inCouncil = buildReport(facts({ view: 'council', councilProjectId: COUNCIL_P }))
    expect(shouldReport(inWorkspace, inCouncil)).toBe(true)
    expect(shouldReport(inCouncil, inWorkspace)).toBe(true)
    expect(shouldReport(inCouncil, buildReport(facts({ view: 'council', councilProjectId: COUNCIL_P })))).toBe(
      false
    )
  })

  it('stays a primitive-or-null, so D14 still holds with the field added', () => {
    const r = buildReport(facts({ view: 'council', councilProjectId: COUNCIL_P }))
    expect(Object.getPrototypeOf(r)).toBe(Object.prototype)
    expect(typeof r.councilProjectId === 'string' || r.councilProjectId === null).toBe(true)
  })
})
