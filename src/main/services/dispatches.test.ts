import { describe, expect, it } from 'vitest'
import { classifyOutcome, createDispatchRecorder } from './dispatches'
import type { DispatchRow, NewDispatchRow } from '../db/schema'
import type { SessionManager, SessionStartInfo } from './sessionManager'
import type { StorageService } from './storage'

// Task 3a-1: the dispatch telemetry spine. Two mandated suites — the
// classifier as a pure mapping TABLE (§4.2 of the implementation spec: every
// observable, no gaps) and the never-propagate property (a telemetry write
// may lose a data point; it may never fail a launch) — plus recorder flow
// tests over a stub storage.
//
// ⚠ better-sqlite3 is compiled for Electron (NODE_MODULE_VERSION 148) and
// cannot load under plain-node vitest, so NO test here may import the real
// StorageService. The accessor SQL itself (the outcome-IS-NULL open
// predicate, the idempotent close WHERE) is proven at runtime — the v7 dump
// and the seven-step drive — not in this file.

describe('classifyOutcome (Task 3a-1) — every observable, no gaps', () => {
  it('PTY exits on its own, code 0 → completed/exit', () => {
    expect(classifyOutcome({ reason: 'exit', exitCode: 0, killRequested: false }))
      .toEqual({ outcome: 'completed', closedBy: 'exit' })
  })

  it('PTY exits on its own, code non-zero → failed/exit', () => {
    expect(classifyOutcome({ reason: 'exit', exitCode: 1, killRequested: false }))
      .toEqual({ outcome: 'failed', closedBy: 'exit' })
  })

  it('killRequested DOMINATES a non-zero code → abandoned/kill', () => {
    // The whole reason this function exists: on Windows a killed PTY reports
    // -1073741510 (STATUS_CONTROL_C_EXIT); classifying by code would poison
    // the estimator's only quality signal with phantom failures.
    expect(classifyOutcome({ reason: 'exit', exitCode: -1073741510, killRequested: true }))
      .toEqual({ outcome: 'abandoned', closedBy: 'kill' })
  })

  it('killRequested dominates a ZERO code too → abandoned/kill', () => {
    expect(classifyOutcome({ reason: 'exit', exitCode: 0, killRequested: true }))
      .toEqual({ outcome: 'abandoned', closedBy: 'kill' })
  })

  it('app quit (dispose, no exit delivered) → abandoned/dispose', () => {
    expect(classifyOutcome({ reason: 'dispose', exitCode: null, killRequested: true }))
      .toEqual({ outcome: 'abandoned', closedBy: 'dispose' })
  })

  it('still open at boot → abandoned/boot-heal', () => {
    expect(classifyOutcome({ reason: 'boot-heal', exitCode: null, killRequested: false }))
      .toEqual({ outcome: 'abandoned', closedBy: 'boot-heal' })
  })

  it('a missing exit code never reads as success → failed/exit', () => {
    expect(classifyOutcome({ reason: 'exit', exitCode: null, killRequested: false }))
      .toEqual({ outcome: 'failed', closedBy: 'exit' })
  })
})

/* ------------------------------------------------------------------------ */
/* Recorder over a stub storage. The stub models the accessor contract —     */
/* "OPEN" means outcome IS NULL, close writes only while open — so recorder  */
/* flow tests exercise real sequencing, not a mock's imagination.            */
/* ------------------------------------------------------------------------ */

type ClosePatch = {
  outcome: 'completed' | 'abandoned' | 'failed'
  closedBy: 'exit' | 'kill' | 'dispose' | 'boot-heal'
  endedAt: string | null
  exitCode: number | null
}

function makeStubStorage(opts: { throwing?: boolean; projectId?: string | null } = {}) {
  const rows = new Map<string, DispatchRow>()
  const calls = { create: 0, close: [] as Array<{ id: string; patch: ClosePatch }> }
  const boom = (): never => {
    throw new Error('stub storage failure')
  }
  const storage = {
    createDispatch(row: NewDispatchRow): DispatchRow {
      if (opts.throwing) boom()
      calls.create++
      const full = { ...row } as DispatchRow
      rows.set(full.id, full)
      return full
    },
    getOpenDispatchForSession(sessionId: string): DispatchRow | null {
      if (opts.throwing) boom()
      const open = [...rows.values()].filter((r) => r.sessionId === sessionId && r.outcome === null)
      return open.at(-1) ?? null
    },
    listOpenDispatches(): DispatchRow[] {
      if (opts.throwing) boom()
      return [...rows.values()].filter((r) => r.outcome === null)
    },
    closeDispatch(id: string, patch: ClosePatch): void {
      if (opts.throwing) boom()
      calls.close.push({ id, patch })
      const row = rows.get(id)
      // The accessor's WHERE clause: writes nothing when already closed.
      if (row && row.outcome === null) Object.assign(row, patch)
    },
    getSessionById(id: string) {
      if (opts.throwing) boom()
      return opts.projectId !== undefined && opts.projectId !== null
        ? { id, projectId: opts.projectId }
        : null
    },
    rows
  }
  return { storage: storage as unknown as StorageService, calls, rows }
}

function makeManager(killed = false) {
  const fired: { start: ((i: SessionStartInfo) => void) | null; exit: ((id: string, code: number) => void) | null } = {
    start: null,
    exit: null
  }
  const manager = {
    onStart: (l: (i: SessionStartInfo) => void) => {
      fired.start = l
    },
    onExit: (l: (id: string, code: number) => void) => {
      fired.exit = l
    },
    wasKilledByChorus: () => killed
  } as unknown as SessionManager
  return { manager, fired }
}

const START: SessionStartInfo = {
  sessionId: 'sess-1',
  agent: 'codex',
  cwd: 'C:\\proj',
  authMode: 'api_key',
  model: 'moonshotai/kimi-k3',
  providerName: 'OpenRouter'
}

describe('DispatchRecorder (Task 3a-1)', () => {
  it('opens on start: one row, outcome/ended NULL, token+cost columns NULL, facts from the bundle', () => {
    const { storage, rows } = makeStubStorage({ projectId: 'proj-1' })
    const recorder = createDispatchRecorder(storage)
    const { manager, fired } = makeManager()
    recorder.attach(manager)
    fired.start!(START)
    const row = [...rows.values()][0]
    expect(row.sessionId).toBe('sess-1')
    expect(row.projectId).toBe('proj-1') // resolved from the sessions row
    expect(row.agent).toBe('codex')
    expect(row.authMode).toBe('api_key') // D42's discriminator
    expect(row.model).toBe('moonshotai/kimi-k3')
    expect(row.providerName).toBe('OpenRouter')
    expect(row.startedAt).toBeTruthy()
    expect(row.outcome).toBeNull() // NULL means OPEN — never ended_at
    expect(row.endedAt).toBeNull()
    expect(row.closedBy).toBeNull()
    expect(row.exitCode).toBeNull()
    expect(row.taskId).toBeNull() // no seed exists
    expect(row.tokensIn).toBeNull() // 3a-3's columns, declared now, NULL always
    expect(row.tokensOut).toBeNull()
    expect(row.tokensCached).toBeNull()
    expect(row.costUsd).toBeNull()
  })

  it('closes on exit with the code-derived outcome and a real ended_at', () => {
    const { storage, rows } = makeStubStorage({ projectId: 'proj-1' })
    const recorder = createDispatchRecorder(storage)
    const { manager, fired } = makeManager()
    recorder.attach(manager)
    fired.start!(START)
    fired.exit!('sess-1', 0)
    const row = [...rows.values()][0]
    expect(row.outcome).toBe('completed')
    expect(row.closedBy).toBe('exit')
    expect(row.exitCode).toBe(0)
    expect(row.endedAt).toBeTruthy()
  })

  it('a user kill closes abandoned/kill even with a non-zero Windows code', () => {
    const { storage, rows } = makeStubStorage({ projectId: 'proj-1' })
    const recorder = createDispatchRecorder(storage)
    const { manager, fired } = makeManager(true) // wasKilledByChorus → true
    recorder.attach(manager)
    fired.start!(START)
    fired.exit!('sess-1', -1073741510)
    const row = [...rows.values()][0]
    expect(row.outcome).toBe('abandoned')
    expect(row.closedBy).toBe('kill')
    expect(row.exitCode).toBe(-1073741510) // the real code is kept as a FACT
  })

  it('an exit with no open dispatch is a no-op, not an error', () => {
    const { storage, calls } = makeStubStorage()
    const recorder = createDispatchRecorder(storage)
    const { manager, fired } = makeManager()
    recorder.attach(manager)
    expect(() => fired.exit!('never-seen', 1)).not.toThrow()
    expect(calls.close).toHaveLength(0)
  })

  it('boot heal closes orphans abandoned/boot-heal with ended_at NULL — and a second heal does NOT re-touch them', () => {
    const { storage, rows, calls } = makeStubStorage({ projectId: 'proj-1' })
    const recorder = createDispatchRecorder(storage)
    const { manager, fired } = makeManager()
    recorder.attach(manager)
    fired.start!(START) // left open: the previous run crashed
    recorder.healOrphansAtBoot()
    let row = [...rows.values()][0]
    expect(row.outcome).toBe('abandoned')
    expect(row.closedBy).toBe('boot-heal')
    expect(row.endedAt).toBeNull() // "it ended, we never saw when" — a VALUE
    const closesAfterFirstHeal = calls.close.length
    // The §4.3 property: OPEN means outcome IS NULL. A boot-healed row keeps
    // ended_at NULL forever, so an ended_at-based predicate would re-select
    // and re-close it on every boot — the quiet-fiction failure. Run twice:
    recorder.healOrphansAtBoot()
    expect(calls.close.length).toBe(closesAfterFirstHeal) // no re-close
    row = [...rows.values()][0]
    expect(row.closedBy).toBe('boot-heal') // history not rewritten
  })

  it('close is idempotent: a second exit for the same session writes nothing', () => {
    const { storage, rows, calls } = makeStubStorage({ projectId: 'proj-1' })
    const recorder = createDispatchRecorder(storage)
    const { manager, fired } = makeManager()
    recorder.attach(manager)
    fired.start!(START)
    fired.exit!('sess-1', 0)
    fired.exit!('sess-1', 1) // a loop or a duplicate announcement
    const row = [...rows.values()][0]
    expect(row.outcome).toBe('completed') // not rewritten to failed
    expect(calls.close).toHaveLength(1) // the second found no OPEN row
  })

  it('quit close abandons what survived dispose, with a real ended_at — and is idempotent', () => {
    const { storage, rows } = makeStubStorage({ projectId: 'proj-1' })
    const recorder = createDispatchRecorder(storage)
    const { manager, fired } = makeManager()
    recorder.attach(manager)
    fired.start!(START)
    fired.start!({ ...START, sessionId: 'sess-2' })
    recorder.closeOpenOnQuit()
    for (const row of rows.values()) {
      expect(row.outcome).toBe('abandoned')
      expect(row.closedBy).toBe('dispose')
      expect(row.endedAt).toBeTruthy()
    }
    const endedAts = [...rows.values()].map((r) => r.endedAt)
    recorder.closeOpenOnQuit() // a second quit path must not rewrite history
    expect([...rows.values()].map((r) => r.endedAt)).toEqual(endedAts)
    for (const row of rows.values()) expect(row.closedBy).toBe('dispose')
  })

  it('never fails a launch: every recorder path swallows a throwing storage and only logs', () => {
    const { storage } = makeStubStorage({ throwing: true })
    const recorder = createDispatchRecorder(storage)
    const { manager, fired } = makeManager()
    expect(() => recorder.healOrphansAtBoot()).not.toThrow()
    expect(() => recorder.attach(manager)).not.toThrow()
    expect(() => fired.start!(START)).not.toThrow() // the open failing must NOT propagate into spawn
    expect(() => fired.exit!('sess-1', 0)).not.toThrow()
    expect(() => recorder.closeOpenOnQuit()).not.toThrow()
  })
})
