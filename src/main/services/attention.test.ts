import { describe, expect, it } from 'vitest'
import { createAttentionTracker, type AttentionTracker } from './attention'
import type { StorageService } from './storage'
import type { AttentionReport } from '../../shared/ipc'

/**
 * F43 — the attention tracker must stop crediting a project that has been
 * deleted.
 *
 * ⚠ THIS FILE IS POSSIBLE ONLY BECAUSE `attention.ts` IMPORTS `StorageService`
 * AS A TYPE. That import is erased at compile, so unlike everything that
 * touches `storage.ts` itself this module IS reachable from vitest
 * (better-sqlite3 is built for the Electron ABI and a plain `node` cannot load
 * the binding). The tracker takes its storage as an injected dependency —
 * `AttentionTrackerDeps`, described in the module as a substitutable seam — so
 * a stub is the intended way in rather than a workaround.
 *
 * The clock is driven by hand: `tickMs` is set enormous so the constructor's
 * `setInterval` never fires on its own, and `now`/`readIdleSeconds` are pure
 * functions of test-local state.
 */

interface Written {
  id: string
  projectId: string | null
  sessionId: string | null
}

/** A storage stub carrying only what the tracker actually calls. Deliberately
 *  NOT a mock framework: what matters is which project ids reach
 *  `openAttentionSpan`, and a plain array records that exactly. */
function stubStorage(existingProjectIds: string[]): {
  storage: StorageService
  opened: Written[]
  extended: string[]
  setProjects: (ids: string[]) => void
} {
  let projects = new Set(existingProjectIds)
  const opened: Written[] = []
  const extended: string[] = []
  const storage = {
    getAttentionCaptureEnabled: () => true,
    getActiveProjectId: () => [...projects][0] ?? null,
    getProjectById: (id: string) => (projects.has(id) ? ({ id } as never) : null),
    openAttentionSpan: (row: { id: string; projectId: string | null; sessionId: string | null }) => {
      opened.push({ id: row.id, projectId: row.projectId, sessionId: row.sessionId })
    },
    extendAttentionSpan: (id: string) => {
      extended.push(id)
    }
  } as unknown as StorageService
  return { storage, opened, extended, setProjects: (ids) => (projects = new Set(ids)) }
}

function makeTracker(storage: StorageService): { tracker: AttentionTracker; tick: () => void } {
  let nowMs = 1_700_000_000_000
  const tracker = createAttentionTracker({
    storage,
    readIdleSeconds: () => 0,
    now: () => nowMs,
    // Large enough that the internal interval never fires during a test; every
    // firing below is driven explicitly through the private tick.
    tickMs: 60 * 60 * 1000
  })
  const tick = (): void => {
    nowMs += 15_000
    // The tick is private by design (there is ONE clock and it is internal);
    // reaching it is what lets the test drive that clock deterministically
    // instead of sleeping.
    ;(tracker as unknown as { tick: () => void }).tick()
  }
  return { tracker, tick }
}

const PA = '11111111-1111-4111-8111-111111111111'
const PB = '22222222-2222-4222-8222-222222222222'
const SESSION = '33333333-3333-4333-8333-333333333333'

function report(over: Partial<AttentionReport> = {}): AttentionReport {
  return {
    projectId: PA,
    sessionId: SESSION,
    view: 'workspace',
    councilProjectId: null,
    overlayOpen: false,
    ...over
  }
}

describe('applyReport — project ids are resolved against the projects table (F43)', () => {
  it('keeps a project id that still names a project', () => {
    const { storage, opened } = stubStorage([PA])
    const { tracker, tick } = makeTracker(storage)
    tracker.setWindowFocused(true)
    tracker.applyReport(report())
    tick()
    expect(opened.at(-1)?.projectId).toBe(PA)
    tracker.dispose()
  })

  /**
   * ⚠ THE ATTRIBUTION IS DROPPED, NOT THE REPORT. `projectId` is already
   * nullable on this payload with exactly this meaning — "the active project,
   * or null — nothing to attribute to" — so a stale id degrades to the state
   * the schema already has a word for, rather than to a refusal the sender
   * could not hear.
   */
  it('nulls a project id that names no project, and does NOT throw', () => {
    const { storage, opened } = stubStorage([PB])
    const { tracker, tick } = makeTracker(storage)
    tracker.setWindowFocused(true)
    expect(() => tracker.applyReport(report({ projectId: PA }))).not.toThrow()
    tick()
    // Falls back to getActiveProjectId(), which is PB — the surviving project.
    expect(opened.at(-1)?.projectId).not.toBe(PA)
    tracker.dispose()
  })

  it('nulls a stale councilProjectId on the same rule', () => {
    const { storage } = stubStorage([PB])
    const { tracker } = makeTracker(storage)
    tracker.applyReport(report({ projectId: PB, councilProjectId: PA }))
    const held = (tracker as unknown as { report: AttentionReport }).report
    expect(held.councilProjectId).toBeNull()
    expect(held.projectId).toBe(PB)
    tracker.dispose()
  })

  /* F4's ruling stands and is deliberately NOT extended to sessions: a report
     can legitimately name a session main has just seen exit, and that is what
     `onSessionExited` retires. A session id going stale is ordinary; a project
     id going stale means the row was deleted. */
  it('leaves sessionId unchecked — F4 is not widened by this fix', () => {
    const { storage } = stubStorage([PA])
    const { tracker } = makeTracker(storage)
    tracker.applyReport(report({ sessionId: SESSION }))
    expect((tracker as unknown as { report: AttentionReport }).report.sessionId).toBe(SESSION)
    tracker.dispose()
  })

  it('survives a storage failure by dropping the attribution rather than the report', () => {
    const storage = {
      getAttentionCaptureEnabled: () => true,
      getActiveProjectId: () => null,
      getProjectById: () => {
        throw new Error('database is locked')
      }
    } as unknown as StorageService
    const { tracker } = makeTracker(storage)
    expect(() => tracker.applyReport(report())).not.toThrow()
    expect((tracker as unknown as { report: AttentionReport }).report.projectId).toBeNull()
    tracker.dispose()
  })
})

describe('onProjectDeleted (F43)', () => {
  /**
   * ⚠ THE UNBOUNDED HALF OF THE LEAK. `readInputs()` reads
   * `this.report?.projectId ?? storage.getActiveProjectId()`. The fallback is
   * already safe because `deleteProject` reassigns the active pointer — but the
   * RETAINED REPORT is not, and it keeps naming the deleted project on EVERY
   * TICK for as long as the app runs.
   */
  it('stops crediting the deleted project on every subsequent tick', () => {
    const { storage, opened, setProjects } = stubStorage([PA, PB])
    const { tracker, tick } = makeTracker(storage)
    tracker.setWindowFocused(true)
    tracker.applyReport(report({ projectId: PA }))
    tick()
    expect(opened.at(-1)?.projectId).toBe(PA)

    // The project is deleted: the row goes, the pointer moves, the tracker is told.
    setProjects([PB])
    tracker.onProjectDeleted(PA)
    tick()
    tick()
    expect(opened.some((o) => o.projectId === PA && opened.indexOf(o) > 0)).toBe(false)
    expect(opened.at(-1)?.projectId).toBe(PB)
    tracker.dispose()
  })

  /* `deleteProject` purged this project's spans inside its transaction, so the
     open row id names a row that is GONE — an `extend` would update zero rows
     and the run would go on believing it had a home. markGap()'s reasoning:
     the stretch becomes a hole BETWEEN two runs rather than a lie inside one. */
  it('ends the run rather than re-pointing it, so the next tick opens a fresh row', () => {
    const { storage, opened, extended, setProjects } = stubStorage([PA, PB])
    const { tracker, tick } = makeTracker(storage)
    tracker.setWindowFocused(true)
    tracker.applyReport(report({ projectId: PA }))
    tick()
    tick()
    const rowBefore = opened.at(-1)!.id
    expect(extended).toContain(rowBefore)

    setProjects([PB])
    tracker.onProjectDeleted(PA)
    const extendedCount = extended.length
    tick()
    // A NEW row, not an extension of the purged one.
    expect(opened.at(-1)!.id).not.toBe(rowBefore)
    expect(extended.length).toBe(extendedCount)
    tracker.dispose()
  })

  /* Deleting a project in the background must not disturb a run that has
     nothing to do with it — the same restraint `onSessionExited` shows. */
  it('leaves an unrelated run completely alone', () => {
    const { storage, opened, extended, setProjects } = stubStorage([PA, PB])
    const { tracker, tick } = makeTracker(storage)
    tracker.setWindowFocused(true)
    tracker.applyReport(report({ projectId: PA }))
    tick()
    const rowBefore = opened.at(-1)!.id

    setProjects([PA])
    tracker.onProjectDeleted(PB)
    tick()
    // Same row, extended — the run was not broken.
    expect(opened.at(-1)!.id).toBe(rowBefore)
    expect(extended).toContain(rowBefore)
    tracker.dispose()
  })

  it('clears a deleted project from councilProjectId too', () => {
    const { storage, setProjects } = stubStorage([PA, PB])
    const { tracker } = makeTracker(storage)
    tracker.applyReport(report({ projectId: PB, councilProjectId: PA }))
    setProjects([PB])
    tracker.onProjectDeleted(PA)
    const held = (tracker as unknown as { report: AttentionReport }).report
    expect(held.councilProjectId).toBeNull()
    expect(held.projectId).toBe(PB)
    tracker.dispose()
  })
})
