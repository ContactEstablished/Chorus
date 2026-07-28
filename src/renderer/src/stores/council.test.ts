import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCouncilStore } from './council'
import type { CouncilMemberWire, CouncilProgressEvent } from '../../../shared/ipc'

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
  unavailableReason: null
})

const progress = (over: Partial<CouncilProgressEvent> = {}): CouncilProgressEvent => ({
  runId: RUN,
  phase: 'positions',
  round: 0,
  memberId: M1,
  delta: 'hello',
  ...over
})

interface ChorusStub {
  listCouncilMembers: ReturnType<typeof vi.fn>
  onCouncilProgress: ReturnType<typeof vi.fn>
  pickCouncilBrief: ReturnType<typeof vi.fn>
  startCouncilRun: ReturnType<typeof vi.fn>
  cancelCouncilRun: ReturnType<typeof vi.fn>
  getCouncilTranscript: ReturnType<typeof vi.fn>
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

/** Deliver a delta the way main's `webContents.send` would. */
const emit = (event: CouncilProgressEvent): void => {
  for (const l of [...listeners]) l(event)
}

function stubChorus(overrides: Partial<ChorusStub> = {}): ChorusStub {
  listeners.clear()
  offCalls = 0
  const stub: ChorusStub = {
    listCouncilMembers: vi.fn().mockResolvedValue({ members: [] }),
    onCouncilProgress: vi.fn((cb: (e: CouncilProgressEvent) => void) => {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
        offCalls++
      }
    }),
    pickCouncilBrief: vi.fn().mockResolvedValue({ cancelled: true }),
    startCouncilRun: vi.fn().mockResolvedValue({ ok: false, reason: 'no' }),
    cancelCouncilRun: vi.fn().mockResolvedValue({ cancelled: true }),
    getCouncilTranscript: vi
      .fn()
      .mockResolvedValue({ run_id: RUN, turns: [], total_turns: 0, truncated: false, chars: 0, cap_chars: 1_000_000 }),
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
      cost_usd: 0.002
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
