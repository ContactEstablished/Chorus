import { describe, expect, it } from 'vitest'
import {
  isResumeAction,
  planExitDisposition,
  planResume,
  toLaunchModifier,
  type ResumePlan
} from './resumeCore'

/** A minter that is loud about being called, so "never mints" is assertable
 *  rather than merely unobserved. */
function counter(value = 'MINTED'): { mint: () => string; calls: number } {
  const state = { mint: (): string => (state.calls++, value), calls: 0 }
  return state
}

describe('planResume — the launch truth table, exhaustively', () => {
  it('no descriptor + NULL pointer -> fresh, no discovery (kimi · opencode)', () => {
    // ⚠ THE BRANCH WHOSE REGRESSION WOULD BE HARDEST TO NOTICE. An adapter with
    // no resume support must produce no modifier at all, which is what keeps its
    // argv byte-identical to the pre-4a app.
    const m = counter()
    expect(planResume({ storedAgentSessionId: null, descriptorKind: null, mintId: m.mint })).toEqual({
      action: 'fresh',
      discoverAfterSpawn: false
    })
    expect(m.calls).toBe(0)
  })

  it('no descriptor + a stored pointer -> STILL fresh, no discovery', () => {
    // A pointer left behind by an adapter that no longer declares resume (or by
    // a row whose agent changed) must not resurrect a launch modifier the CLI
    // cannot use.
    const m = counter()
    expect(
      planResume({ storedAgentSessionId: 'abc', descriptorKind: null, mintId: m.mint })
    ).toEqual({ action: 'fresh', discoverAfterSpawn: false })
    expect(m.calls).toBe(0)
  })

  it('assigned + NULL pointer -> assigned-create, with a MINTED id', () => {
    const m = counter('NEW-ID')
    expect(
      planResume({ storedAgentSessionId: null, descriptorKind: 'assigned', mintId: m.mint })
    ).toEqual({ action: 'assigned-create', agentSessionId: 'NEW-ID' })
    expect(m.calls).toBe(1)
  })

  it('assigned + a stored pointer -> assigned-resume, and NOTHING is minted', () => {
    const m = counter()
    expect(
      planResume({ storedAgentSessionId: 'STORED', descriptorKind: 'assigned', mintId: m.mint })
    ).toEqual({ action: 'assigned-resume', agentSessionId: 'STORED' })
    expect(m.calls).toBe(0)
  })

  it('discovered + NULL pointer -> fresh, WITH discovery after the spawn', () => {
    // Codex names its own conversation, so a fresh launch carries no modifier at
    // all and Chorus asks afterwards what it chose.
    const m = counter()
    expect(
      planResume({ storedAgentSessionId: null, descriptorKind: 'discovered', mintId: m.mint })
    ).toEqual({ action: 'fresh', discoverAfterSpawn: true })
    expect(m.calls).toBe(0)
  })

  it('discovered + a stored pointer -> discovered-resume, and nothing is minted', () => {
    const m = counter()
    expect(
      planResume({ storedAgentSessionId: 'STORED', descriptorKind: 'discovered', mintId: m.mint })
    ).toEqual({ action: 'discovered-resume', agentSessionId: 'STORED' })
    expect(m.calls).toBe(0)
  })

  it('treats an EMPTY stored pointer as NULL, for both descriptor kinds', () => {
    // An empty id is not a conversation. Both adapters' argv builders already
    // refuse one — an empty value would open claude's interactive picker
    // (D143(e)) — so planning a resume around it could only produce a launch
    // that fails.
    const m = counter('FRESH-ID')
    expect(
      planResume({ storedAgentSessionId: '', descriptorKind: 'assigned', mintId: m.mint })
    ).toEqual({ action: 'assigned-create', agentSessionId: 'FRESH-ID' })
    expect(
      planResume({ storedAgentSessionId: '', descriptorKind: 'discovered', mintId: m.mint })
    ).toEqual({ action: 'fresh', discoverAfterSpawn: true })
  })

  it('mints EXACTLY ONCE per assigned-create plan', () => {
    // The id goes into argv and is persisted after the spawn; a second mint
    // would put a different id in the two places.
    const m = counter()
    const plan = planResume({
      storedAgentSessionId: null,
      descriptorKind: 'assigned',
      mintId: m.mint
    })
    expect(plan.action).toBe('assigned-create')
    expect(m.calls).toBe(1)
  })
})

describe('toLaunchModifier — plan to PtyLaunchSpec.resume', () => {
  it('assigned-create -> strategy assigned, action create', () => {
    expect(toLaunchModifier({ action: 'assigned-create', agentSessionId: 'X' })).toEqual({
      strategy: 'assigned',
      action: 'create',
      agentSessionId: 'X'
    })
  })

  it('assigned-resume -> strategy assigned, action resume', () => {
    expect(toLaunchModifier({ action: 'assigned-resume', agentSessionId: 'X' })).toEqual({
      strategy: 'assigned',
      action: 'resume',
      agentSessionId: 'X'
    })
  })

  it('discovered-resume -> strategy discovered, action resume', () => {
    expect(toLaunchModifier({ action: 'discovered-resume', agentSessionId: 'X' })).toEqual({
      strategy: 'discovered',
      action: 'resume',
      agentSessionId: 'X'
    })
  })

  it('BOTH fresh plans yield undefined — the byte-identical-argv guarantee', () => {
    // `undefined` is what makes buildLaunch assemble exactly what HEAD
    // assembled. A `{}` or a null here would be a modifier an adapter has to
    // reason about.
    expect(toLaunchModifier({ action: 'fresh', discoverAfterSpawn: false })).toBeUndefined()
    expect(toLaunchModifier({ action: 'fresh', discoverAfterSpawn: true })).toBeUndefined()
  })

  it('never collapses strategy and action — create is only ever assigned', () => {
    // `strategy` says WHO NAMES the conversation; `action` says whether this
    // launch starts or reopens one. Collapsing the two axes is the bug
    // resumeCore exists to prevent, so the pairing is asserted directly.
    const plans: readonly ResumePlan[] = [
      { action: 'assigned-create', agentSessionId: 'A' },
      { action: 'assigned-resume', agentSessionId: 'B' },
      { action: 'discovered-resume', agentSessionId: 'C' }
    ]
    for (const plan of plans) {
      const mod = toLaunchModifier(plan)
      expect(mod).toBeDefined()
      if (mod!.action === 'create') expect(mod!.strategy).toBe('assigned')
      if (mod!.strategy === 'discovered') expect(mod!.action).toBe('resume')
    }
  })
})

describe('isResumeAction — the gate on the whole recovery path', () => {
  it('is true for exactly the two resume actions', () => {
    expect(isResumeAction('assigned-resume')).toBe(true)
    expect(isResumeAction('discovered-resume')).toBe(true)
    expect(isResumeAction('assigned-create')).toBe(false)
    expect(isResumeAction('fresh')).toBe(false)
  })
})

describe('planExitDisposition — amendment D143(b)', () => {
  it('no modifier + no classification -> fan out (today, unchanged)', () => {
    expect(
      planExitDisposition({ launchedAction: 'fresh', killRequested: false,
        hadRecordedTurns: true, classified: null })
    ).toEqual({ kind: 'fan-out' })
  })

  it('a create exit fans out — a create cannot be a resume failure', () => {
    expect(
      planExitDisposition({
        launchedAction: 'assigned-create',
        killRequested: false,
        hadRecordedTurns: true,
        classified: null
      })
    ).toEqual({ kind: 'fan-out' })
  })

  it('a resume exit with NO classification fans out — an ordinary session end', () => {
    // The common case once resume ships: every normal end of every resumed
    // session lands here, and must behave exactly as it does today.
    for (const action of ['assigned-resume', 'discovered-resume'] as const) {
      expect(
        planExitDisposition({ launchedAction: action, killRequested: false,
        hadRecordedTurns: true, classified: null })
      ).toEqual({ kind: 'fan-out' })
    }
  })

  it('a resume exit classified as any of the four reasons -> recover, carrying the reason', () => {
    const reasons = ['not-found', 'in-use', 'transcript-unavailable', 'unusable-pointer'] as const
    for (const reason of reasons) {
      for (const action of ['assigned-resume', 'discovered-resume'] as const) {
        expect(
          planExitDisposition({ launchedAction: action, killRequested: false,
        hadRecordedTurns: true, classified: reason })
        ).toEqual({ kind: 'recover', reason, notify: true })
      }
    }
  })

  it('a killed session ALWAYS fans out, even carrying a classification', () => {
    // A user kill of a resumed session is an ordinary end, and Task 3a-1's flag
    // already says so. Recovering here would relaunch a pane the user just
    // closed.
    expect(
      planExitDisposition({
        launchedAction: 'assigned-resume',
        killRequested: true,
        hadRecordedTurns: true,
        classified: 'not-found'
      })
    ).toEqual({ kind: 'fan-out' })
  })

  it('⚠ A FRESH OR CREATE LAUNCH CANNOT RECOVER EVEN IF THE ADAPTER CLASSIFIES IT', () => {
    // This is Q4's discovery-miss distinction enforced structurally rather than
    // remembered: a codex fresh launch whose discovery missed can never produce
    // a "context was not restored" notice, because its exit can never reach
    // `recover` — not even via a misbehaving classifier.
    const reasons = ['not-found', 'in-use', 'transcript-unavailable', 'unusable-pointer'] as const
    for (const reason of reasons) {
      for (const action of ['fresh', 'assigned-create'] as const) {
        expect(
          planExitDisposition({ launchedAction: action, killRequested: false,
        hadRecordedTurns: true, classified: reason })
        ).toEqual({ kind: 'fan-out' })
      }
    }
  })

  // ── F65: the notice, and only the notice, turns on whether anything existed ──
  it('⚠ RECOVERS SILENTLY WHEN THE CONVERSATION NEVER HAD A TURN', () => {
    // A pane opened and never spoken to still gets a conversation id at launch,
    // and claude writes no transcript until the first turn — so its pointer names
    // a conversation that never existed. The resume fails honestly; announcing
    // lost context there is an apology for losing nothing.
    expect(
      planExitDisposition({
        launchedAction: 'assigned-resume',
        killRequested: false,
        hadRecordedTurns: false,
        classified: 'not-found'
      })
    ).toEqual({ kind: 'recover', reason: 'not-found', notify: false })
  })

  it('⚠ STILL RECOVERS — `notify:false` SUPPRESSES THE NOTICE, NEVER THE REPAIR', () => {
    // The load-bearing half: the disposition is STILL `recover`, so the pointer
    // is still cleared and the pane still relaunched. Were this to fan out
    // instead, a stale pointer would leave the pane dead — the exact regression
    // F66 was caught being.
    const quiet = planExitDisposition({
      launchedAction: 'discovered-resume',
      killRequested: false,
      hadRecordedTurns: false,
      classified: 'not-found'
    })
    const loud = planExitDisposition({
      launchedAction: 'discovered-resume',
      killRequested: false,
      hadRecordedTurns: true,
      classified: 'not-found'
    })
    expect(quiet.kind).toBe('recover')
    expect(loud.kind).toBe('recover')
    // Identical in every respect but the telling.
    expect({ ...quiet, notify: null }).toEqual({ ...loud, notify: null })
  })

  it('does not let hadRecordedTurns manufacture a recovery on its own', () => {
    // It modulates an existing recovery; it can never create one. A clean exit
    // stays a clean exit however much work the session did.
    for (const hadRecordedTurns of [true, false]) {
      expect(
        planExitDisposition({
          launchedAction: 'assigned-resume',
          killRequested: false,
          hadRecordedTurns,
          classified: null
        })
      ).toEqual({ kind: 'fan-out' })
    }
  })

  it('covers every ResumePlan action — the table has no hole', () => {
    // Exhaustiveness by construction: a new action added to ResumePlan without a
    // decision here fails to compile at the `satisfies`, and fails here if it
    // silently defaulted.
    const actions = [
      'fresh',
      'assigned-create',
      'assigned-resume',
      'discovered-resume'
    ] as const satisfies readonly ResumePlan['action'][]
    for (const action of actions) {
      const out = planExitDisposition({
        launchedAction: action,
        killRequested: false,
        hadRecordedTurns: true,
        classified: 'not-found'
      })
      expect(out.kind).toBe(isResumeAction(action) ? 'recover' : 'fan-out')
    }
  })
})
