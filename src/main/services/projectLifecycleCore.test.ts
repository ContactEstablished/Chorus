import { describe, expect, it } from 'vitest'
import { computeSuccessorActiveId, type SuccessorCandidate } from './projectLifecycleCore'

const p = (id: string, status: SuccessorCandidate['status'] = 'active'): SuccessorCandidate => ({
  id,
  status
})

/**
 * The rule that decides where you land when the project you were in goes away.
 * It is pure precisely so it can be asserted here — vitest cannot import
 * `storage.ts` (better-sqlite3 is built for the Electron ABI), so a successor
 * rule written inline in the handler would be verifiable only by hand, at
 * runtime, once.
 */
describe('computeSuccessorActiveId', () => {
  it('leaves the active project alone when something ELSE departs', () => {
    // Archiving a background project must not move the user out of what they
    // are doing. This is the common case and the one a naive "just pick the
    // first active project" implementation gets wrong.
    expect(computeSuccessorActiveId('b', 'a', [p('a'), p('b'), p('c')])).toBe('a')
  })

  it('picks the first remaining active project, in rail order', () => {
    expect(computeSuccessorActiveId('a', 'a', [p('a'), p('b'), p('c')])).toBe('b')
    // Rail order, not id order: the candidates arrive in the order the rail
    // draws them, and "the top of the rail" is the one answer a user can
    // predict by looking at the screen.
    expect(computeSuccessorActiveId('a', 'a', [p('a'), p('z'), p('b')])).toBe('z')
  })

  it('skips the departing project even when it is still in the candidate list', () => {
    // The caller reads the list BEFORE the write, so the departing project is
    // normally still in it — and still says 'active' when it is being deleted
    // rather than archived.
    expect(computeSuccessorActiveId('a', 'a', [p('a'), p('b')])).toBe('b')
  })

  it('skips archived projects', () => {
    expect(
      computeSuccessorActiveId('a', 'a', [p('a'), p('b', 'archived'), p('c')])
    ).toBe('c')
  })

  /**
   * ⚠ HIDDEN IS NOT A CANDIDATE, THOUGH IT IS PERFECTLY USABLE. Being dropped
   * into a project you deliberately tucked out of sight — with no row in the
   * rail to explain where you are — is worse than landing nowhere.
   */
  it('skips hidden projects, even though they are launchable', () => {
    expect(computeSuccessorActiveId('a', 'a', [p('a'), p('b', 'hidden'), p('c')])).toBe('c')
    expect(computeSuccessorActiveId('a', 'a', [p('a'), p('b', 'hidden')])).toBeNull()
  })

  it('returns null when nothing qualifies — the honest empty state', () => {
    expect(computeSuccessorActiveId('a', 'a', [p('a')])).toBeNull()
    expect(computeSuccessorActiveId('a', 'a', [])).toBeNull()
    expect(
      computeSuccessorActiveId('a', 'a', [p('a'), p('b', 'archived'), p('c', 'archived')])
    ).toBeNull()
  })

  it('leaves a null active id null when an inactive project departs', () => {
    // Boot can legitimately reach a state with no active project at all
    // (`src/main/index.ts` says so). Deleting some other project then must not
    // silently select one.
    expect(computeSuccessorActiveId('b', null, [p('a'), p('b')])).toBeNull()
  })
})
