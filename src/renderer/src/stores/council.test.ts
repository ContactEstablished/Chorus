import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCouncilStore } from './council'
import type {
  CouncilDocketRun,
  CouncilMemberWire,
  CouncilProgressEvent,
  CouncilSummaryEvent
} from '../../../shared/ipc'

/**
 * Council store unit tests (Task 3b-4). `window.chorus` is stubbed — test the
 * logic, not the bridge (the stores/settings.test.ts precedent).
 *
 * The two cases that are not about convenience:
 *  · the progress subscription is RELEASED on unmount. F13 (`de98679`) is a
 *    listener outliving its component; a store-level one has the same failure
 *    with a longer life.
 *  · a superseded roster load does not overwrite a newer one — the `view.ts`
 *    loadSeq idiom, which a component-level token cannot provide because it
 *    cannot cancel an await already running inside the store.
 */

const RUN = '9ba9b0da-cecd-4960-815d-f36166cf8c00'
const M1 = '3f7c1e2a-9b04-4d5e-8a11-6c2d0e9f4b73'

const memberRow = (id: string, label: string): CouncilMemberWire => ({
  id,
  label,
  credentialProfileId: '6f1d2c3b-9a4e-4c8d-b7f6-1a2b3c4d5e6f',
  credentialLabel: 'a route',
  providerName: 'a provider',
  model: 'vendor/model',
  resolvedModel: 'vendor/model',
  role: 'member',
  available: true,
  unavailableReason: null,
  // No `max_tokens` of its own, so the row reports the role default main would
  // apply — the shape the settings list renders as "inherited".
  maxTokens: null,
  defaultMaxTokens: 16_000,
  otherParamNames: []
})

const progress = (over: Partial<CouncilProgressEvent> = {}): CouncilProgressEvent => ({
  runId: RUN,
  phase: 'positions',
  round: 0,
  memberId: M1,
  delta: 'hello',
  ...over
})

const summary = (over: Partial<CouncilSummaryEvent> = {}): CouncilSummaryEvent => ({
  runId: RUN,
  questions: [
    {
      index: 0,
      question: 'Should orphan runs remain visible?',
      path: 'structural',
      state: 'split',
      votes: [
        { label: 'A', verdict: 'AGREE' },
        { label: 'B', verdict: 'DISAGREE' }
      ],
      silent: []
    }
  ],
  ...over
})

interface ChorusStub {
  listCouncilMembers: ReturnType<typeof vi.fn>
  onCouncilProgress: ReturnType<typeof vi.fn>
  onCouncilSummary: ReturnType<typeof vi.fn>
  pickCouncilBrief: ReturnType<typeof vi.fn>
  startCouncilRun: ReturnType<typeof vi.fn>
  cancelCouncilRun: ReturnType<typeof vi.fn>
  getCouncilTranscript: ReturnType<typeof vi.fn>
  getCouncilDocket: ReturnType<typeof vi.fn>
  getCouncilFindings: ReturnType<typeof vi.fn>
  forgetCouncilRun: ReturnType<typeof vi.fn>
  getCouncilVerdict: ReturnType<typeof vi.fn>
}

/**
 * ⚠ THE STUB MODELS A REAL BRIDGE, not a call recorder. `onCouncilProgress`
 * registers into a live set and its returned function REMOVES from that set, so
 * "the subscription is released on unmount" is asserted by a delta that arrives
 * afterwards and lands nowhere — rather than by checking that a mock was called,
 * which would prove nothing about the listener actually being gone.
 */
const listeners = new Set<(e: CouncilProgressEvent) => void>()
let offCalls = 0

/** The at-a-glance channel gets its OWN set and its OWN counter, so "the
 *  progress listener was released" stays a claim about the progress listener.
 *  One shared counter would let a released summary listener satisfy an assertion
 *  about the other one. */
const summaryListeners = new Set<(e: CouncilSummaryEvent) => void>()
let summaryOffCalls = 0

/** Deliver a delta the way main's `webContents.send` would. */
const emit = (event: CouncilProgressEvent): void => {
  for (const l of [...listeners]) l(event)
}

const emitSummary = (event: CouncilSummaryEvent): void => {
  for (const l of [...summaryListeners]) l(event)
}

function stubChorus(overrides: Partial<ChorusStub> = {}): ChorusStub {
  listeners.clear()
  offCalls = 0
  summaryListeners.clear()
  summaryOffCalls = 0
  const stub: ChorusStub = {
    listCouncilMembers: vi.fn().mockResolvedValue({ members: [] }),
    onCouncilProgress: vi.fn((cb: (e: CouncilProgressEvent) => void) => {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
        offCalls++
      }
    }),
    onCouncilSummary: vi.fn((cb: (e: CouncilSummaryEvent) => void) => {
      summaryListeners.add(cb)
      return () => {
        summaryListeners.delete(cb)
        summaryOffCalls++
      }
    }),
    pickCouncilBrief: vi.fn().mockResolvedValue({ cancelled: true }),
    startCouncilRun: vi.fn().mockResolvedValue({ ok: false, reason: 'no' }),
    cancelCouncilRun: vi.fn().mockResolvedValue({ cancelled: true }),
    getCouncilTranscript: vi
      .fn()
      .mockResolvedValue({ run_id: RUN, turns: [], total_turns: 0, truncated: false, chars: 0, cap_chars: 1_000_000 }),
    getCouncilDocket: vi.fn().mockResolvedValue({ runs: [] }),
    getCouncilFindings: vi
      .fn()
      .mockResolvedValue({ run_id: RUN, path: 'C:\\docs\\B-Findings.md', text: '# stored', reason: null }),
    forgetCouncilRun: vi.fn().mockResolvedValue({ forgot: true, turns: 16 }),
    getCouncilVerdict: vi.fn().mockResolvedValue({
      run_id: RUN,
      rows: [],
      ruled: 0,
      total: 0,
      arbiter_asked: false,
      reason: null
    }),
    ...overrides
  }
  ;(globalThis as Record<string, unknown>).window = { chorus: stub }
  return stub
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('the progress subscription', () => {
  it('⚠ is REMOVED on unsubscribe — the F13 leak class, one layer up', () => {
    stubChorus()
    const store = useCouncilStore()
    store.subscribe()
    expect(offCalls).toBe(0)
    store.unsubscribe()
    expect(offCalls).toBe(1)
    expect(listeners.size).toBe(0)
  })

  it('⚠ a delta arriving AFTER unsubscribe LANDS NOWHERE — the listener is gone', () => {
    stubChorus()
    const store = useCouncilStore()
    store.running = true
    store.subscribe()
    store.unsubscribe()
    expect(listeners.size).toBe(0)
    emit(progress({ delta: 'ghost' }))
    expect(store.messages).toHaveLength(0)
  })

  it('⚠ the at-a-glance listener is released too, and a late summary lands nowhere', () => {
    stubChorus()
    const store = useCouncilStore()
    store.running = true
    store.subscribe()
    store.runId = RUN
    store.unsubscribe()
    expect(summaryOffCalls).toBe(1)
    expect(summaryListeners.size).toBe(0)
    emitSummary(summary())
    expect(store.questionSummary).toEqual([])
  })

  it('keeps exactly ONE live subscription — subscribing twice releases the first', () => {
    stubChorus()
    const store = useCouncilStore()
    store.subscribe()
    store.subscribe()
    expect(offCalls).toBe(1)
    expect(listeners.size).toBe(1)
  })

  it('learns the run id from the first delta, so Cancel is reachable mid-run', () => {
    stubChorus()
    const store = useCouncilStore()
    store.running = true
    store.subscribe()
    expect(store.runId).toBeNull()
    emit(progress())
    expect(store.runId).toBe(RUN)
  })

  it('ignores a delta from another window’s run', () => {
    stubChorus()
    const store = useCouncilStore()
    store.running = true
    store.subscribe()
    emit(progress())
    emit(progress({ runId: '11111111-2222-3333-4444-555555555555', delta: ' other' }))
    expect(store.messages).toHaveLength(1)
    expect(store.messages[0].text).toBe('hello')
  })

  it('ignores a stray delta when no run of ours is in flight', () => {
    stubChorus()
    const store = useCouncilStore()
    store.subscribe()
    emit(progress())
    expect(store.messages).toHaveLength(0)
    expect(store.runId).toBeNull()
  })

  it('appends deltas into one turn, and opens a new turn on a phase change', () => {
    stubChorus()
    const store = useCouncilStore()
    store.running = true
    store.subscribe()
    emit(progress({ delta: 'one ' }))
    emit(progress({ delta: 'two' }))
    expect(store.messages).toHaveLength(1)
    expect(store.messages[0].text).toBe('one two')
    emit(progress({ phase: 'critique', round: 1, delta: 'later' }))
    expect(store.messages).toHaveLength(2)
    expect(store.phase).toBe('critique')
    expect(store.round).toBe(1)
  })

  it('⚠ INTERLEAVED members keep ONE block each — the blind round is concurrent', () => {
    // The defect a live drive found: matching only against the LAST message
    // opened a new block on every switch between members, and a three-member
    // blind round rendered 291 fragments instead of three turns.
    const M2 = '5a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d'
    stubChorus()
    const store = useCouncilStore()
    store.running = true
    store.subscribe()
    emit(progress({ memberId: M1, delta: 'a1 ' }))
    emit(progress({ memberId: M2, delta: 'b1 ' }))
    emit(progress({ memberId: M1, delta: 'a2' }))
    emit(progress({ memberId: M2, delta: 'b2' }))
    expect(store.messages).toHaveLength(2)
    expect(store.messages.find((m) => m.memberId === M1)?.text).toBe('a1 a2')
    expect(store.messages.find((m) => m.memberId === M2)?.text).toBe('b1 b2')
  })
})

/**
 * ⚠ EVERY TEST BELOW RELEASES ITS SUBSCRIPTION BEFORE IT ENDS. `offProgress` and
 * `offSummary` are MODULE-level in the store — one live pair per process, not per
 * Pinia instance — so a test that subscribes and walks away leaves a live handle
 * for the next one to trip over. That is exactly how the first draft of this
 * block broke `keeps exactly ONE live subscription` above: it counted an
 * unsubscribe this file had left lying around.
 */
describe('the at-a-glance broadcast — the strip lands when POSITIONS close', () => {
  it('fills the strip mid-run, long before the findings exist', () => {
    stubChorus()
    const store = useCouncilStore()
    store.running = true
    store.subscribe()
    // The run id is bound by the first delta, exactly as it is in a real run —
    // deltas have been arriving for minutes by the time positions close.
    emit(progress())
    expect(store.runId).toBe(RUN)

    emitSummary(summary())
    expect(store.questionSummary).toHaveLength(1)
    expect(store.questionSummary[0]?.state).toBe('split')
    // ⚠ THE POINT OF THE WHOLE CHANGE: no findings, no accounting, run still
    // live — and the user already has the glance.
    expect(store.findings).toBeNull()
    expect(store.accounting).toBeNull()
    expect(store.running).toBe(true)
    store.unsubscribe()
  })

  /**
   * ⚠ BOTH BROADCASTS REACH EVERY WINDOW, so a second window running its own
   * council would otherwise paint this one's strip. A stray delta is visibly
   * foreign text; a stray summary looks entirely at home, which makes this the
   * more dangerous of the two to get wrong.
   */
  it('⚠ ignores a summary from another window’s run', () => {
    stubChorus()
    const store = useCouncilStore()
    store.running = true
    store.subscribe()
    emit(progress())
    emitSummary(summary({ runId: '11111111-2222-4333-8444-555555555555' }))
    expect(store.questionSummary).toEqual([])
    store.unsubscribe()
  })

  /**
   * ⚠ AND IT NEVER ADOPTS ONE. `onCouncilProgress` adopts the run id off the
   * first delta because that is the only way this side can learn it while
   * `council:start` is still in flight — without it Cancel is unreachable. This
   * channel has no such job and must not grow one: adopting here would let a
   * summary bind the store to a run it is not showing.
   */
  it('⚠ a summary arriving with NO bound run id is dropped, not adopted', () => {
    stubChorus()
    const store = useCouncilStore()
    store.running = true
    store.subscribe()
    emitSummary(summary())
    expect(store.runId).toBeNull()
    expect(store.questionSummary).toEqual([])
    store.unsubscribe()
  })
})

describe('loadMembers — the loadSeq supersede token', () => {
  it('⚠ a SUPERSEDED load does not overwrite a newer one', async () => {
    let releaseSlow: (v: { members: CouncilMemberWire[] }) => void = () => {}
    const slow = new Promise<{ members: CouncilMemberWire[] }>((resolve) => {
      releaseSlow = resolve
    })
    const stub = stubChorus()
    stub.listCouncilMembers
      .mockReturnValueOnce(slow)
      .mockResolvedValueOnce({ members: [memberRow(M1, 'the newer answer')] })

    const store = useCouncilStore()
    const first = store.loadMembers()
    const second = store.loadMembers()
    await second
    expect(store.members.map((m) => m.label)).toEqual(['the newer answer'])

    // The slow one lands LAST and must be dropped rather than applied late.
    releaseSlow({ members: [memberRow(M1, 'the stale answer')] })
    await first
    expect(store.members.map((m) => m.label)).toEqual(['the newer answer'])
  })

  it('records a load failure rather than throwing at the view', async () => {
    const stub = stubChorus()
    stub.listCouncilMembers.mockRejectedValueOnce(new Error('bridge down'))
    const store = useCouncilStore()
    await store.loadMembers()
    expect(store.error).toBe('bridge down')
  })
})

describe('the brief and the run', () => {
  it('⚠ a cancelled picker is a STRUCTURED NO-OP, not an error', async () => {
    stubChorus()
    const store = useCouncilStore()
    await store.pickBrief()
    expect(store.briefPath).toBeNull()
    expect(store.error).toBeNull()
  })

  it('records the chosen path', async () => {
    const stub = stubChorus()
    stub.pickCouncilBrief.mockResolvedValueOnce({ path: 'C:\\docs\\Brief.md' })
    const store = useCouncilStore()
    await store.pickBrief()
    expect(store.briefPath).toBe('C:\\docs\\Brief.md')
  })

  it('⚠ D14: the start payload is a PLAIN object of primitives, not a store proxy', async () => {
    const stub = stubChorus()
    stub.pickCouncilBrief.mockResolvedValueOnce({ path: 'C:\\docs\\Brief.md' })
    const store = useCouncilStore()
    await store.pickBrief()
    await store.run(null)
    const payload = stub.startCouncilRun.mock.calls[0][0]
    expect(payload).toEqual({ project_id: null, brief_path: 'C:\\docs\\Brief.md' })
    // Structured clone is what this protects: a value that survives it here
    // survives Electron's bridge. A Vue proxy would not.
    expect(() => structuredClone(payload)).not.toThrow()
    // ⚠ AND THERE IS NO SECOND PATH ON IT. The findings path is derived in main.
    expect(Object.keys(payload).sort()).toEqual(['brief_path', 'project_id'])
  })

  it('surfaces a refusal verbatim and writes no findings', async () => {
    const stub = stubChorus()
    stub.pickCouncilBrief.mockResolvedValueOnce({ path: 'C:\\docs\\Brief.md' })
    stub.startCouncilRun.mockResolvedValueOnce({ ok: false, reason: 'This brief has no numbered questions.' })
    const store = useCouncilStore()
    await store.pickBrief()
    await store.run(null)
    expect(store.error).toBe('This brief has no numbered questions.')
    expect(store.findings).toBeNull()
    expect(store.running).toBe(false)
  })

  it('keeps the findings path and its accounting together on success', async () => {
    const stub = stubChorus()
    stub.pickCouncilBrief.mockResolvedValueOnce({ path: 'C:\\docs\\Brief.md' })
    stub.startCouncilRun.mockResolvedValueOnce({
      ok: true,
      run_id: RUN,
      findings: '# Findings',
      findings_path: 'C:\\docs\\Brief-Findings.md',
      findings_error: null,
      question_summary: [
        {
          index: 0,
          question: 'Should orphan runs remain visible?',
          path: 'structural' as const,
          state: 'split' as const,
          votes: [
            { label: 'A', verdict: 'AGREE' as const },
            { label: 'B', verdict: 'DISAGREE' as const }
          ],
          silent: []
        }
      ],
      accounting: {
        membersPlanned: 3,
        membersAnswered: 3,
        membersRefused: 0,
        turnsAnswered: 6,
        turnsRefused: 0,
        usageReported: 6,
        usageAbsent: 0,
        tokensIn: 100,
        tokensOut: 50,
        tokensCached: null
      },
      cost_usd: 0.002,
      cost_is_provisional: false
    })
    const store = useCouncilStore()
    await store.pickBrief()
    await store.run(null)
    expect(store.findingsPath).toBe('C:\\docs\\Brief-Findings.md')
    expect(store.findingsError).toBeNull()
    // ⚠ D55 one layer up: the cost is never held without its denominator.
    expect(store.accounting?.membersPlanned).toBe(3)
    expect(store.costUsd).toBe(0.002)
    expect(store.phase).toBe('done')
    // The at-a-glance strip is held AS MAIN COMPUTED IT. Nothing on this side
    // re-derives a state from the transcript, so the strip and the findings file
    // cannot disagree about the same run.
    expect(store.questionSummary).toHaveLength(1)
    expect(store.questionSummary[0]?.state).toBe('split')
  })

  /**
   * ⚠ F41. The store must carry the settlement state, not infer it — a cost that
   * arrives provisional and is held as settled is exactly the failure this flag
   * exists to end (two runs, two rosters, 49% low).
   */
  it('⚠ holds the provisional flag beside the cost, and clears it between runs', async () => {
    const stub = stubChorus()
    stub.pickCouncilBrief.mockResolvedValueOnce({ path: 'C:\\docs\\Brief.md' })
    const accounting = {
      membersPlanned: 3,
      membersAnswered: 3,
      membersRefused: 0,
      turnsAnswered: 6,
      turnsRefused: 0,
      usageReported: 6,
      usageAbsent: 0,
      tokensIn: 100,
      tokensOut: 50,
      tokensCached: null
    }
    stub.startCouncilRun.mockResolvedValueOnce({
      ok: true,
      run_id: RUN,
      findings: '# Findings',
      findings_path: 'C:\\docs\\Brief-Findings.md',
      findings_error: null,
      question_summary: [],
      accounting,
      cost_usd: 0.0395,
      cost_is_provisional: true
    })
    const store = useCouncilStore()
    await store.pickBrief()
    await store.run(null)
    expect(store.costUsd).toBe(0.0395)
    expect(store.costIsProvisional).toBe(true)

    // A refused second run must not leave the previous run's caveat standing on
    // a screen that now shows no cost at all.
    stub.startCouncilRun.mockResolvedValueOnce({ ok: false, reason: 'No arbiter.' })
    await store.run(null)
    expect(store.costUsd).toBeNull()
    expect(store.costIsProvisional).toBe(false)
  })

  it('⚠ clears the previous run’s glance before the next one starts', async () => {
    const stub = stubChorus()
    stub.pickCouncilBrief.mockResolvedValueOnce({ path: 'C:\\docs\\Brief.md' })
    const store = useCouncilStore()
    await store.pickBrief()
    store.questionSummary = [
      {
        index: 0,
        question: 'a question from a run the user has moved past',
        path: 'structural',
        state: 'agreed',
        votes: [
          { label: 'A', verdict: 'AGREE' },
          { label: 'B', verdict: 'AGREE' }
        ],
        silent: []
      }
    ]
    // The refusal arm returns before any summary arrives — which is exactly the
    // case a stale strip would survive, since it sits ABOVE the transcript and
    // would read as this run's own early result.
    stub.startCouncilRun.mockResolvedValueOnce({ ok: false, reason: 'No arbiter.' })
    await store.run(null)
    expect(store.questionSummary).toEqual([])
  })

  it('refuses to start without a brief, and refuses to start twice', async () => {
    const stub = stubChorus()
    const store = useCouncilStore()
    await store.run(null)
    expect(stub.startCouncilRun).not.toHaveBeenCalled()
    store.briefPath = 'C:\\docs\\Brief.md'
    store.running = true
    await store.run(null)
    expect(stub.startCouncilRun).not.toHaveBeenCalled()
  })

  it('⚠ holds no key material anywhere in $state after a completed run', async () => {
    const stub = stubChorus()
    stub.pickCouncilBrief.mockResolvedValueOnce({ path: 'C:\\docs\\Brief.md' })
    const store = useCouncilStore()
    await store.pickBrief()
    await store.run(null)
    const serialized = JSON.stringify(store.$state)
    expect(serialized).not.toContain('Authorization')
    expect(serialized.toLowerCase()).not.toContain('api_key')
  })
})

/* ------------------------------------------------------------------ */
/* The STORED transcript — D97 / Task 3e-4                             */
/* ------------------------------------------------------------------ */

describe('loadTranscript — separate state, and F37 left alone', () => {
  const storedResponse = {
    run_id: RUN,
    turns: [
      { member_id: M1, phase: 'positions', round: 0, text: 'stored position' },
      { member_id: null, phase: 'synthesis', round: 3, text: 'stored synthesis' }
    ],
    total_turns: 2,
    truncated: false,
    chars: 31,
    cap_chars: 1_000_000
  }

  it('reads a run’s rows into transcript state, with the count and the cap flag', async () => {
    const stub = stubChorus()
    stub.getCouncilTranscript.mockResolvedValueOnce(storedResponse)
    const store = useCouncilStore()
    await store.loadTranscript(RUN)
    expect(store.transcript?.map((t) => t.text)).toEqual(['stored position', 'stored synthesis'])
    expect(store.transcriptTotal).toBe(2)
    expect(store.transcriptTruncated).toBe(false)
    expect(store.transcriptLoading).toBe(false)
    expect(stub.getCouncilTranscript).toHaveBeenCalledWith({ run_id: RUN })
  })

  /**
   * ⚠ THE CASE THE SPEC CALLS THE MOST DANGEROUS PART OF THE TASK. A historical
   * read must not travel through `ingest()`, whose (member, phase, round)
   * identity is F37's fix — 291 fragments where 8 turns belonged. The two pieces
   * of state are asserted to be independent in BOTH directions here, because a
   * later refactor that merged them would still pass a test that only checked
   * one.
   */
  it('⚠ does NOT disturb live message grouping, in either direction', async () => {
    const stub = stubChorus()
    stub.getCouncilTranscript.mockResolvedValueOnce(storedResponse)
    const store = useCouncilStore()
    store.running = true
    store.subscribe()
    emit(progress({ memberId: M1, delta: 'live ' }))
    emit(progress({ memberId: M1, delta: 'delta' }))
    expect(store.messages).toHaveLength(1)

    await store.loadTranscript(RUN)
    // The live blocks are untouched — same count, same accumulated text.
    expect(store.messages).toHaveLength(1)
    expect(store.messages[0].text).toBe('live delta')
    expect(store.transcript).toHaveLength(2)

    // And a delta arriving after the read still appends to its own block rather
    // than opening a new one beside the historical rows.
    emit(progress({ memberId: M1, delta: '!' }))
    expect(store.messages).toHaveLength(1)
    expect(store.messages[0].text).toBe('live delta!')
    expect(store.transcript).toHaveLength(2)
  })

  it('⚠ a SUPERSEDED read does not overwrite a newer one — its own token, not loadSeq', async () => {
    let releaseSlow: (v: typeof storedResponse) => void = () => {}
    const slow = new Promise<typeof storedResponse>((resolve) => {
      releaseSlow = resolve
    })
    const stub = stubChorus()
    stub.getCouncilTranscript.mockReturnValueOnce(slow).mockResolvedValueOnce({
      ...storedResponse,
      turns: [{ member_id: M1, phase: 'positions', round: 0, text: 'the newer answer' }],
      total_turns: 1
    })
    const store = useCouncilStore()
    const first = store.loadTranscript(RUN)
    const second = store.loadTranscript(RUN)
    await second
    expect(store.transcript?.map((t) => t.text)).toEqual(['the newer answer'])

    releaseSlow({ ...storedResponse, turns: [{ member_id: M1, phase: 'positions', round: 0, text: 'stale' }] })
    await first
    expect(store.transcript?.map((t) => t.text)).toEqual(['the newer answer'])
  })

  it('a roster reload does NOT cancel a transcript read — the tokens are separate', async () => {
    const stub = stubChorus()
    stub.getCouncilTranscript.mockResolvedValueOnce(storedResponse)
    const store = useCouncilStore()
    const read = store.loadTranscript(RUN)
    await store.loadMembers()
    await read
    expect(store.transcript).toHaveLength(2)
  })

  it('records a read failure rather than throwing at the view, and shows no rows', async () => {
    const stub = stubChorus()
    stub.getCouncilTranscript.mockRejectedValueOnce(new Error('bridge down'))
    const store = useCouncilStore()
    await store.loadTranscript(RUN)
    expect(store.transcriptError).toBe('bridge down')
    expect(store.transcript).toBeNull()
    expect(store.transcriptLoading).toBe(false)
  })

  it('clearTranscript drops it all, and a new run does the same', async () => {
    const stub = stubChorus()
    stub.getCouncilTranscript.mockResolvedValue(storedResponse)
    const store = useCouncilStore()
    await store.loadTranscript(RUN)
    store.clearTranscript()
    expect(store.transcript).toBeNull()
    expect(store.transcriptTotal).toBe(0)

    await store.loadTranscript(RUN)
    expect(store.transcript).toHaveLength(2)
    // ⚠ A PREVIOUS RUN'S TRANSCRIPT MUST NOT SURVIVE INTO THE NEXT RUN'S PANEL.
    store.briefPath = 'C:\\docs\\Brief.md'
    await store.run(null)
    expect(store.transcript).toBeNull()
  })

  it('carries the truncation flag through instead of hiding a partial read', async () => {
    const stub = stubChorus()
    stub.getCouncilTranscript.mockResolvedValueOnce({
      ...storedResponse,
      turns: [storedResponse.turns[0]],
      total_turns: 13,
      truncated: true
    })
    const store = useCouncilStore()
    await store.loadTranscript(RUN)
    expect(store.transcriptTruncated).toBe(true)
    expect(store.transcript).toHaveLength(1)
    expect(store.transcriptTotal).toBe(13)
  })
})

/* ================================================================== *\
 * The Docket (D112-D115)                                             *
\* ================================================================== */

const PROJ = '0f8f4a1e-2b3c-4d5e-9a6b-7c8d9e0f1a2b'
const OLD_RUN = 'aa11bb22-cc33-4d44-8e55-ff6677889900'

const docketRow = (over: Partial<CouncilDocketRun> = {}): CouncilDocketRun => ({
  run_id: OLD_RUN,
  label: 'CouncilCase-3f.0-Exhibits.md',
  brief_path: 'C:\\docs\\CouncilCase-3f.0-Exhibits.md',
  status: 'complete',
  started_at: '2026-08-01T10:00:00.000Z',
  ended_at: '2026-08-01T10:21:04.000Z',
  duration_ms: 1_264_000,
  turns: 48,
  tokens_in: 190_000,
  tokens_out: 24_000,
  tokens_are_partial: false,
  turns_with_tokens: 48,
  cost_floor_usd: 1.089,
  has_findings: true,
  verdict_digest: '1 revise · 2 approved · 3 of 3 ruled',
  ...over
})

describe('loadDocket', () => {
  it('lists the project runs', async () => {
    const stub = stubChorus()
    stub.getCouncilDocket.mockResolvedValueOnce({ runs: [docketRow()] })
    const store = useCouncilStore()
    await store.loadDocket(PROJ)
    expect(stub.getCouncilDocket).toHaveBeenCalledWith({ project_id: PROJ })
    expect(store.docket).toHaveLength(1)
  })

  it('⚠ distinguishes "not loaded" from "loaded and empty"', () => {
    // An empty Docket is a real, renderable answer ("no councils yet"), not a
    // read that has not come back. `null` is the only thing that means the latter.
    stubChorus()
    const store = useCouncilStore()
    expect(store.docket).toBeNull()
  })

  it('⚠ a superseded load does not overwrite a newer one', async () => {
    const stub = stubChorus()
    let releaseFirst: (v: unknown) => void = () => {}
    stub.getCouncilDocket
      .mockReturnValueOnce(new Promise((res) => (releaseFirst = res)))
      .mockResolvedValueOnce({ runs: [docketRow({ label: 'second.md' })] })
    const store = useCouncilStore()
    const first = store.loadDocket(PROJ)
    const second = store.loadDocket(PROJ)
    await second
    releaseFirst({ runs: [docketRow({ label: 'first.md' })] })
    await first
    expect(store.docket?.[0]?.label).toBe('second.md')
  })

  it('surfaces a failure rather than leaving an empty list looking authoritative', async () => {
    const stub = stubChorus()
    stub.getCouncilDocket.mockRejectedValueOnce(new Error('db is gone'))
    const store = useCouncilStore()
    await store.loadDocket(PROJ)
    expect(store.docketError).toBe('db is gone')
    expect(store.docket).toBeNull()
  })
})

describe('openRun — ⚠ a stored run NEVER writes the live run fields', () => {
  it('loads past findings into their own field, leaving `findings` alone', async () => {
    stubChorus()
    const store = useCouncilStore()
    // A live run finished earlier this session and its result is still on screen.
    store.findings = '# the LIVE run'
    store.findingsPath = 'C:\\docs\\Live-Findings.md'

    await store.openRun(OLD_RUN)

    expect(store.pastFindings).toBe('# stored')
    expect(store.viewingRunId).toBe(OLD_RUN)
    expect(store.mode).toBe('run')
    // The live run's document is untouched — this is the F37 separation applied
    // to findings. Sharing one field would mean opening history overwrote a
    // result the user was still reading.
    expect(store.findings).toBe('# the LIVE run')
    expect(store.findingsPath).toBe('C:\\docs\\Live-Findings.md')
  })

  it('reads the stored transcript alongside the findings', async () => {
    const stub = stubChorus()
    const store = useCouncilStore()
    await store.openRun(OLD_RUN)
    expect(stub.getCouncilTranscript).toHaveBeenCalledWith({ run_id: OLD_RUN })
  })

  it('⚠ REFUSES while a council is running', () => {
    // The main pane is one surface; swapping it mid-deliberation would strand a
    // paid-for run with nowhere to render — the Esc handler's rule, in the store.
    const stub = stubChorus()
    const store = useCouncilStore()
    store.running = true
    void store.openRun(OLD_RUN)
    expect(store.viewingRunId).toBeNull()
    expect(stub.getCouncilFindings).not.toHaveBeenCalled()
  })

  it('⚠ carries an absent document as a REASON, not as an error state', async () => {
    // A findings file moved by a branch switch is the ordinary fate of a document
    // in someone's own repository. The path it looked in comes back with it.
    const stub = stubChorus()
    stub.getCouncilFindings.mockResolvedValueOnce({
      run_id: OLD_RUN,
      path: 'C:\\docs\\B-Findings.md',
      text: null,
      reason: 'That findings document is no longer at the path this run recorded.'
    })
    const store = useCouncilStore()
    await store.openRun(OLD_RUN)
    expect(store.pastFindings).toBeNull()
    expect(store.pastFindingsPath).toBe('C:\\docs\\B-Findings.md')
    expect(store.pastFindingsError).toContain('no longer at the path')
  })

  it('drops the previous document when a second row is opened', async () => {
    const stub = stubChorus()
    const store = useCouncilStore()
    await store.openRun(OLD_RUN)
    expect(store.pastFindings).toBe('# stored')
    stub.getCouncilFindings.mockResolvedValueOnce({
      run_id: RUN,
      path: null,
      text: null,
      reason: 'This run recorded no findings document.'
    })
    await store.openRun(RUN)
    expect(store.pastFindings).toBeNull()
    expect(store.viewingRunId).toBe(RUN)
  })
})

describe('showDocket / newRun', () => {
  it('showDocket clears the run being read so a re-open re-reads', async () => {
    stubChorus()
    const store = useCouncilStore()
    await store.openRun(OLD_RUN)
    store.showDocket()
    expect(store.mode).toBe('docket')
    expect(store.viewingRunId).toBeNull()
    expect(store.pastFindings).toBeNull()
    expect(store.transcript).toBeNull()
  })

  it('newRun leaves the Docket for a clean run surface', () => {
    stubChorus()
    const store = useCouncilStore()
    store.newRun()
    expect(store.mode).toBe('run')
    expect(store.viewingRunId).toBeNull()
  })

  /**
   * ⚠ "CLEAN" MEANT ONLY `mode` AND `viewingRunId` BEFORE THIS, so New council
   * landed on the LAST council's phase track, transcript, glance strip and
   * findings — a finished run wearing a live one's clothes.
   */
  it('⚠ newRun CLEARS the previous run, not just the mode', () => {
    stubChorus()
    const store = useCouncilStore()
    store.runId = RUN
    store.phase = 'done'
    store.round = 3
    store.findings = '# Findings'
    store.findingsPath = 'C:\\docs\\Brief-Findings.md'
    store.messages = [{ memberId: 'm1', phase: 'critique', round: 2, text: 'said' }]
    store.questionSummary = [
      { index: 0, question: 'q', path: 'structural', state: 'agreed', votes: [], silent: [] }
    ]
    store.costUsd = 1.09
    store.costIsProvisional = true

    store.newRun()

    expect(store.mode).toBe('run')
    expect(store.runId).toBeNull()
    expect(store.phase).toBeNull()
    expect(store.round).toBeNull()
    expect(store.findings).toBeNull()
    expect(store.findingsPath).toBeNull()
    expect(store.messages).toEqual([])
    expect(store.questionSummary).toEqual([])
    expect(store.costUsd).toBeNull()
    expect(store.costIsProvisional).toBe(false)
    expect(store.transcript).toBeNull()
  })

  it('⚠ newRun REFUSES while a council is running', () => {
    stubChorus()
    const store = useCouncilStore()
    store.mode = 'docket'
    store.running = true
    store.newRun()
    expect(store.mode).toBe('docket')
  })
})

/**
 * The way out of a finished run. It exists because a completed council left the
 * surface occupied with no control that said "I am done with this" — the only
 * way to a blank one was to start another paid run.
 */
describe('clearRun', () => {
  it('puts the surface back to "no council has run here yet"', () => {
    stubChorus()
    const store = useCouncilStore()
    store.runId = RUN
    store.phase = 'done'
    store.accounting = {
      membersPlanned: 3,
      membersAnswered: 3,
      membersRefused: 0,
      turnsAnswered: 6,
      turnsRefused: 0,
      usageReported: 6,
      usageAbsent: 0,
      tokensIn: 100,
      tokensOut: 50,
      tokensCached: null
    }
    store.error = 'something went wrong'

    store.clearRun()

    expect(store.runId).toBeNull()
    expect(store.phase).toBeNull()
    expect(store.accounting).toBeNull()
    expect(store.error).toBeNull()
  })

  /** ⚠ The one field the USER chose. Re-running the same brief is the ordinary
   *  next move, and main re-validates the path on start regardless. */
  it('⚠ KEEPS the chosen brief', async () => {
    const stub = stubChorus()
    stub.pickCouncilBrief.mockResolvedValueOnce({ path: 'C:\\docs\\Brief.md' })
    const store = useCouncilStore()
    await store.pickBrief()
    store.clearRun()
    expect(store.briefPath).toBe('C:\\docs\\Brief.md')
  })

  /** Cancel ends a run; this only ever clears one that has already ended. */
  it('⚠ REFUSES while a council is running', () => {
    stubChorus()
    const store = useCouncilStore()
    store.running = true
    store.phase = 'critique'
    store.messages = [{ memberId: 'm1', phase: 'critique', round: 2, text: 'mid-sentence' }]
    store.clearRun()
    expect(store.phase).toBe('critique')
    expect(store.messages).toHaveLength(1)
  })
})

describe('forgetRun (D109)', () => {
  it('removes the row locally rather than reloading the whole history', async () => {
    const stub = stubChorus()
    stub.getCouncilDocket.mockResolvedValueOnce({
      runs: [docketRow(), docketRow({ run_id: RUN, label: 'other.md' })]
    })
    const store = useCouncilStore()
    await store.loadDocket(PROJ)
    await store.forgetRun(OLD_RUN)
    expect(store.docket?.map((r) => r.run_id)).toEqual([RUN])
    // One call, from the initial load — the delete did not trigger a second.
    expect(stub.getCouncilDocket).toHaveBeenCalledTimes(1)
  })

  it('⚠ `forgot: false` is a no-op, not an error — a race the user cannot see', async () => {
    const stub = stubChorus()
    stub.getCouncilDocket.mockResolvedValueOnce({ runs: [docketRow()] })
    stub.forgetCouncilRun.mockResolvedValueOnce({ forgot: false, turns: 0 })
    const store = useCouncilStore()
    await store.loadDocket(PROJ)
    await store.forgetRun(OLD_RUN)
    expect(store.docket).toHaveLength(1)
    expect(store.docketError).toBeNull()
  })

  it('returns to the Docket when the run being READ is the one removed', async () => {
    stubChorus()
    const store = useCouncilStore()
    await store.openRun(OLD_RUN)
    await store.forgetRun(OLD_RUN)
    expect(store.mode).toBe('docket')
    expect(store.viewingRunId).toBeNull()
  })
})

describe('run() refreshes the Docket', () => {
  it('⚠ reloads after a FAILED run too — a failure is still history', async () => {
    // It cost tokens and minutes and `council_runs` recorded it. A Docket that
    // listed only the successes would be a more flattering account than the one
    // the database holds.
    const stub = stubChorus()
    stub.startCouncilRun.mockResolvedValueOnce({ ok: false, reason: 'no arbiter' })
    const store = useCouncilStore()
    store.briefPath = 'C:\\docs\\Brief.md'
    await store.run(PROJ)
    expect(stub.getCouncilDocket).toHaveBeenCalledWith({ project_id: PROJ })
  })

  it('does not attempt a reload with no project', async () => {
    const stub = stubChorus()
    const store = useCouncilStore()
    store.briefPath = 'C:\\docs\\Brief.md'
    await store.run(null)
    expect(stub.getCouncilDocket).not.toHaveBeenCalled()
  })
})

describe('the Verdict strip in the store (D106)', () => {
  const stripResponse = {
    run_id: OLD_RUN,
    rows: [
      {
        index: 0,
        question: 'Should orphan runs stay visible?',
        consensus: {
          index: 0,
          question: 'Should orphan runs stay visible?',
          path: 'structural',
          state: 'split',
          votes: [{ label: 'Kimi', verdict: 'AGREE' }],
          silent: []
        },
        verdict: 'APPROVED'
      }
    ],
    ruled: 1,
    total: 1,
    arbiter_asked: true,
    reason: null
  }

  it('loads the strip when a stored run is opened', async () => {
    const stub = stubChorus()
    stub.getCouncilVerdict.mockResolvedValueOnce(stripResponse)
    const store = useCouncilStore()
    await store.openRun(OLD_RUN)
    expect(stub.getCouncilVerdict).toHaveBeenCalledWith({ run_id: OLD_RUN })
    expect(store.verdict?.rows[0].verdict).toBe('APPROVED')
    expect(store.verdict?.rows[0].consensus.state).toBe('split')
  })

  it('⚠ does NOT touch the live questionSummary', async () => {
    // `questionSummary` is fed by the live `council:summary` broadcast. If the
    // stored strip shared it, opening history mid-run would repaint a running
    // council's glance strip with a three-week-old result.
    const stub = stubChorus()
    stub.getCouncilVerdict.mockResolvedValueOnce(stripResponse)
    const store = useCouncilStore()
    store.questionSummary = [
      {
        index: 0,
        question: 'the LIVE question',
        path: 'structural',
        state: 'agreed',
        votes: [],
        silent: []
      }
    ]
    await store.openRun(OLD_RUN)
    expect(store.questionSummary[0].question).toBe('the LIVE question')
    expect(store.verdict?.rows[0].question).toBe('Should orphan runs stay visible?')
  })

  it('⚠ keeps a stated reason as DATA, not as an error', async () => {
    // A brief moved on disk means no questions to hang rows on. That is a
    // result about the run, not a failure of the read, and the view renders
    // the two differently.
    const stub = stubChorus()
    stub.getCouncilVerdict.mockResolvedValueOnce({
      ...stripResponse,
      rows: [],
      ruled: 0,
      total: 0,
      arbiter_asked: false,
      reason: 'That file does not exist, or cannot be read.'
    })
    const store = useCouncilStore()
    await store.openRun(OLD_RUN)
    expect(store.verdict?.reason).toContain('does not exist')
    expect(store.verdictError).toBeNull()
  })

  it('a failed read is an error, and leaves no half-strip behind', async () => {
    const stub = stubChorus()
    stub.getCouncilVerdict.mockRejectedValueOnce(new Error('bridge died'))
    const store = useCouncilStore()
    await store.openRun(OLD_RUN)
    expect(store.verdict).toBeNull()
    expect(store.verdictError).toBe('bridge died')
  })

  it('is dropped on the way back to the Docket, so a re-open re-reads', async () => {
    const stub = stubChorus()
    stub.getCouncilVerdict.mockResolvedValueOnce(stripResponse)
    const store = useCouncilStore()
    await store.openRun(OLD_RUN)
    expect(store.verdict).not.toBeNull()
    store.showDocket()
    expect(store.verdict).toBeNull()
  })

  it('⚠ a superseded strip read does not overwrite a newer one', async () => {
    const stub = stubChorus()
    let release: (v: unknown) => void = () => {}
    stub.getCouncilVerdict
      .mockReturnValueOnce(new Promise((res) => (release = res)))
      .mockResolvedValueOnce({ ...stripResponse, run_id: RUN, ruled: 9 })
    const store = useCouncilStore()
    const first = store.loadVerdict(OLD_RUN)
    const second = store.loadVerdict(RUN)
    await second
    release({ ...stripResponse, ruled: 1 })
    await first
    expect(store.verdict?.ruled).toBe(9)
  })
})
