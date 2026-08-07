import { randomUUID } from 'crypto'
import {
  advance,
  coverage,
  creditedSeconds,
  TICK_SECONDS,
  type AttentionClass,
  type AttentionInputs,
  type AttentionRun,
  type AttentionSpanFact
} from './attentionCore'
import type { StorageService } from './storage'
import type { AttentionByClass, AttentionReport, AttentionSummary } from '../../shared/ipc'

/**
 * Attention capture — the Electron seam (Phase 3a / Task 3a-2, Mission Control
 * spec §5.3). Owns THE ONE CLOCK; every decision is delegated to the pure core
 * in attentionCore.ts.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS MEASURES, STATED PLAINLY — because the number will be read by
 * someone who did not write it, and the spec's own §11 names "an unreliable
 * input driving the headline output" as a top risk.
 *
 *   `powerMonitor.getSystemIdleTime()` returns SECONDS SINCE THE LAST KEYBOARD
 *   OR MOUSE INPUT ANYWHERE ON THE MACHINE. It is OS-wide. It cannot tell which
 *   application received the input, so it can never CONFIRM the user was
 *   interacting with Chorus — only that they were interacting with something.
 *   Conjoined with window focus it is a reasonable proxy, and it is the only
 *   tractable one available from inside the process. IT IS NOT A MEASUREMENT
 *   OF ATTENTION.
 *
 * Three consequences, each biasing the number DOWNWARD:
 *
 *  1. Reading is undercounted, and reading is what review panes produce. An
 *     inactive stretch is credited its first <=60 s and nothing after: a
 *     20-minute careful read of a diff counts as ONE MINUTE. Four short reads
 *     count as four. This is the largest known bias and attentionCore.test.ts
 *     pins the exact 4-pane-then-8-idle split so it cannot drift silently.
 *  2. Work done outside the Chorus window is not counted at all. Reading the
 *     same diff in GitKraken, a browser, or an editor reads as `blurred`. §5.3
 *     scopes the overhead bucket to "time spent in Chorus", so this is correct
 *     per the spec and wrong per reality — hence `blurred` is RECORDED rather
 *     than dropped, so a consumer can see how much of the day happened
 *     elsewhere instead of inferring that it did not happen.
 *  3. Presence is over-trusted in one direction only. A focused window with the
 *     mouse being jiggled while attention is on a second monitor counts. No
 *     signal available from inside the process distinguishes it.
 *
 * NET: THE ATTENTION FIGURE IS A LOWER BOUND, biased against reading-heavy and
 * multi-window work. `attention:summary` carries `estimateBound: 'lower-bound'`
 * as a field for exactly this reason.
 *
 * ⚠ KNOWN GAP, verified 2026-07-25 on this machine: `getSystemIdleState()` was
 * never observed returning 'locked' (only 'active' / 'idle'), and the lock
 * probe was not driven because unlocking needs a password. The `locked` class
 * therefore rests on the 'lock-screen' / 'suspend' EVENTS alone. That is a
 * smaller claim than the table's row 1 implies, and it is recorded as smaller.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PRIVACY — this subsystem records HOW LONG A HUMAN BEING SAT IN FRONT OF A
 * SCREEN, which deserves an explicit statement rather than an inference from
 * the absence of a network call. Every clause below is honoured by this file:
 *
 *  · LOCAL-ONLY. Rows live in the same local SQLite the rest of the app uses.
 *    "The plan is shared, the telemetry is personal."
 *  · NOTHING LEAVES THE MACHINE. No fetch, no analytics, no telemetry endpoint,
 *    no crash-reporter attachment, no sync. Grep-verifiable, and grepped.
 *  · NOTHING ENTERS ANY TRANSCRIPT, RING BUFFER, OR PTY. This task does not
 *    touch sessionOutput.ts, scrubber.ts, or SessionManager.spawn's data path.
 *    AN AGENT MUST NEVER BE ABLE TO READ THE OPERATOR'S ATTENTION RECORD, and
 *    the only way to guarantee that is to keep the two paths from meeting.
 *  · NOTHING IS LOGGED PER TICK. One boot line, naming cadence and enabled
 *    state — a per-tick line would turn the log into a second, unredacted
 *    behavioural record of the operator's day, four lines a minute forever.
 *  · WHAT IS RECORDED, EXHAUSTIVELY: a project id, a session id (or null), a
 *    class enum, two timestamps, two integers. WHAT IS NOT, AND MUST NOT
 *    BECOME SO: keystrokes, keystroke timing, window titles of other
 *    applications, process names, screenshots, clipboard, or anything about
 *    activity outside the Chorus window beyond the single bit "the window did
 *    not have focus".
 *  · AN OFF SWITCH EXISTS — `attention_capture_enabled` in `settings`, default
 *    on, read at boot and honoured LIVE. The tick still fires when it is off
 *    (so the setting takes effect without a restart) and writes nothing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DESIGN: SAMPLED RUNS — sampling semantics, run-length storage.
 *
 * ONE `setInterval` for the entire application (the 1b-2 FilmstripRenderer
 * shared-clock rule, one process further in). Panes are not subscribers; ten
 * panes cost exactly what one pane costs. Each firing computes the current slot
 * and either EXTENDS the open span in place or CLOSES it and INSERTS a new one.
 *
 * WORST-CASE DATA LOSS IS 15 SECONDS, independent of how long the user has been
 * focused. That is the design's headline property and the reason the cadence is
 * what it is: Chorus gets tree-killed (`taskkill /PID <root> /T /F` is standing
 * harness practice), and an interval design that persists only on a clean stop
 * would lose the whole open interval — by definition the deepest work session
 * of the day.
 *
 * ⚠ The cadence may not change without also changing what historical rows mean.
 * It is recorded PER ROW in `attention_spans.tick_seconds` so such a change is
 * visible in the data instead of silently rewriting it.
 */
export interface AttentionTracker {
  /** The live kill-switch value, for the one boot log line. */
  readonly enabled: boolean
  /** Latched window state, called from createWindow's event wiring. */
  setWindowFocused(v: boolean): void
  setWindowMinimized(v: boolean): void
  /** Latched from powerMonitor 'lock-screen'/'suspend' and their inverses. */
  setOsLocked(v: boolean): void
  /** 'resume': force the next firing to start a fresh run, so the suspended
   *  stretch shows up as a hole between two runs rather than inside one. */
  markGap(): void
  /** The renderer's report (already Zod-parsed in the ipc handler). */
  applyReport(r: AttentionReport): void
  /** webContents 'did-finish-load': the old DOM is gone and the new one has not
   *  mounted, so the last report no longer describes anything (table row 11). */
  markReportStale(): void
  /** A session exited — drop it if it is the one being credited (row 10). */
  onSessionExited(sessionId: string): void
  /** A project was DELETED — stop crediting it, and end the run that was (F43). */
  onProjectDeleted(projectId: string): void
  summary(projectId: string, fromIso: string, toIso: string): AttentionSummary
  dispose(): void
}

export interface AttentionTrackerDeps {
  storage: StorageService
  /** INJECTED, not imported, so the seam stays substitutable and the module
   *  body holds no Electron reference. The actual
   *  `powerMonitor.getSystemIdleTime` binding happens in index.ts, where every
   *  other Electron singleton is already wired. */
  readIdleSeconds: () => number
  now: () => number
  tickMs?: number
}

class AttentionTrackerImpl implements AttentionTracker {
  private windowFocused = false
  private windowMinimized = false
  private osLocked = false
  private report: AttentionReport | null = null
  /** True until the renderer's first report lands. A fresh boot has no report
   *  yet, which is exactly the row-11 state. */
  private reportStale = true
  private run: AttentionRun | null = null
  private openRowId: string | null = null
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly deps: AttentionTrackerDeps) {
    const tickMs = deps.tickMs ?? TICK_SECONDS * 1000
    // THE ONE CLOCK. There is exactly one setInterval in this feature.
    this.timer = setInterval(() => this.tick(), tickMs)
  }

  get enabled(): boolean {
    return this.deps.storage.getAttentionCaptureEnabled()
  }

  setWindowFocused(v: boolean): void {
    this.windowFocused = v
  }

  setWindowMinimized(v: boolean): void {
    this.windowMinimized = v
  }

  setOsLocked(v: boolean): void {
    this.osLocked = v
  }

  markGap(): void {
    this.run = null
    this.openRowId = null
  }

  /**
   * ⚠ THE PROJECT IDS ARE RESOLVED AGAINST THE PROJECTS TABLE HERE, AND ONLY
   * THE PROJECT IDS (F43). A report naming a project that no longer exists is
   * credited to NO project rather than to the dead one — `projectId` is already
   * nullable on this payload with exactly that meaning ("the active project, or
   * null — nothing to attribute to").
   *
   * ⚠ IT DOES NOT THROW, AND THAT IS THE WHOLE REASON IT LIVES HERE RATHER THAN
   * IN THE HANDLER. `attention:report` is a fire-and-forget send and the ipc
   * layer says so; refusing a report would break a channel that has no way to
   * hear the refusal. Normalising it costs the renderer nothing and loses only
   * the attribution, which was already wrong.
   *
   * ⚠ AND `sessionId` IS STILL DELIBERATELY UNCHECKED. F4's ruling stands: a
   * report can legitimately name a session main has just seen exit, and
   * `onSessionExited` is how that one is retired. Sessions and projects differ
   * because a session id going stale is ORDINARY and a project id going stale
   * means the row was deleted.
   *
   * The cost is one primary-key lookup per non-null id, on a channel that fires
   * ONLY ON A REAL EDGE and never on a timer (`renderer/src/attention/
   * reporter.ts`) — so this is not on the tick path and not on any hot path.
   */
  applyReport(r: AttentionReport): void {
    this.report = {
      ...r,
      projectId: this.liveProjectId(r.projectId),
      councilProjectId: this.liveProjectId(r.councilProjectId)
    }
    this.reportStale = false
  }

  /** The id if it still names a project, else null. A storage failure resolves
   *  to null rather than propagating: this runs inside a fire-and-forget send,
   *  and losing an attribution beats taking the report down. */
  private liveProjectId(id: string | null): string | null {
    if (id === null) return null
    try {
      return this.deps.storage.getProjectById(id) ? id : null
    } catch {
      return null
    }
  }

  /**
   * A project was deleted. Stop crediting it — and END THE RUN THAT WAS.
   *
   * ⚠ THIS IS `onSessionExited`'s SHAPE, ONE FIELD OVER, AND WITHOUT IT THE
   * LEAK IS UNBOUNDED RATHER THAN A RACE. `readInputs()` reads
   * `this.report?.projectId ?? storage.getActiveProjectId()`. The FALLBACK is
   * already safe — `deleteProject` reassigns or clears `active_project_id` in
   * its own transaction — but the RETAINED REPORT is not: it keeps naming the
   * deleted project on every tick, for as long as the app runs, until the
   * renderer happens to send a fresh one. Every one of those ticks writes or
   * extends a span attributing the user's attention to a project that no longer
   * exists.
   *
   * ⚠ AND THE RUN IS DROPPED, NOT MERELY RE-POINTED, WHICH `onSessionExited`
   * DOES NOT DO. `deleteProject` purged this project's spans inside its
   * transaction, so `openRowId` names a row that is gone: the next `extend`
   * would update zero rows and the run would go on believing it had a home,
   * losing every tick until the slot changed. `markGap()`'s reasoning applies
   * exactly — the stretch becomes a hole BETWEEN two runs rather than a lie
   * inside one — so the next tick opens a fresh row under the corrected slot.
   *
   * Only fires when this project is actually the one being credited. Deleting a
   * project in the background must not disturb a run that has nothing to do
   * with it.
   */
  onProjectDeleted(projectId: string): void {
    const creditedByRun = this.run?.slot.projectId === projectId
    const creditedByReport =
      this.report?.projectId === projectId || this.report?.councilProjectId === projectId
    if (!creditedByRun && !creditedByReport) return
    if (this.report) {
      this.report = {
        ...this.report,
        projectId: this.report.projectId === projectId ? null : this.report.projectId,
        councilProjectId:
          this.report.councilProjectId === projectId ? null : this.report.councilProjectId
      }
    }
    this.markGap()
  }

  markReportStale(): void {
    this.report = null
    this.reportStale = true
  }

  onSessionExited(sessionId: string): void {
    if (this.report?.sessionId !== sessionId) return
    // Row 10: reading a dead pane's scrollback is real work, but it is not work
    // the agent is doing — crediting it would inflate that dispatch's cost
    // after the dispatch ended. Ruled to overhead knowingly.
    this.report = { ...this.report, sessionId: null }
  }

  /**
   * One firing. ONE `powerMonitor` read, ONE snapshot of state, AT MOST one row
   * written. Never throws: telemetry may lose a data point, it may never take
   * the app down with it (the dispatches.ts `safely` precedent).
   */
  private tick(): void {
    const nowMs = this.deps.now()
    let out: ReturnType<typeof advance>
    try {
      out = advance(this.run, this.readInputs(), nowMs, TICK_SECONDS)
    } catch {
      // Reading the inputs touches storage (active project, kill switch); if
      // that fails there is nothing to decide. Swallowed WITHOUT A LOG LINE —
      // a per-tick log is barred by the privacy contract above.
      return
    }

    try {
      if (out.action === 'extend' && out.run && this.openRowId) {
        // Extend IN PLACE, on every tick. This is what makes a tree-kill lose
        // 15 s instead of the whole run; a design that writes only on slot
        // change passes every unit test and fails the one thing that matters.
        this.deps.storage.extendAttentionSpan(
          this.openRowId,
          new Date(nowMs).toISOString(),
          creditedSeconds(out.run, TICK_SECONDS)
        )
      } else if (out.run) {
        // 'open' — or 'extend' with no row to extend, which means a previous
        // write failed. Both are served by inserting the run AS IT STANDS, so a
        // transient DB error costs at most the ticks it spanned rather than
        // silently detaching the run from its row for the rest of its life.
        const id = randomUUID()
        this.deps.storage.openAttentionSpan({
          id,
          // Resolving session -> dispatch -> task is a READ-TIME JOIN (Mission
          // Control's "derived, never stored"), and it keeps a span from being
          // orphaned by a dispatch that closed early. Never written here.
          dispatchId: null,
          sessionId: out.run.slot.sessionId,
          projectId: out.run.slot.projectId,
          startedAt: new Date(out.run.startedAtMs).toISOString(),
          endedAt: new Date(out.run.lastTickMs).toISOString(),
          seconds: creditedSeconds(out.run, TICK_SECONDS),
          class: out.run.slot.cls,
          tickSeconds: TICK_SECONDS,
          // 'corrected' is the other member of 3a-1's vocabulary and belongs to
          // the deferred one-tap correction control — which is purely ADDITIVE
          // because of this: a correction is a NEW ROW, never an edit, so the
          // measured value survives forever alongside it.
          source: 'measured',
          createdAt: new Date(nowMs).toISOString()
        })
        this.openRowId = id
      } else {
        this.openRowId = null
      }
    } catch {
      // A failed write must NOT leave openRowId naming a row this run does not
      // own; the next tick opens a fresh row instead of extending a stale one.
      this.openRowId = null
    }

    this.run = out.run
  }

  private readInputs(): AttentionInputs {
    return {
      windowFocused: this.windowFocused,
      windowMinimized: this.windowMinimized,
      // ONE powerMonitor read per tick — not per pane, not per query.
      osIdleSeconds: this.deps.readIdleSeconds(),
      osLocked: this.osLocked,
      // The fresh report wins; storage is the fallback for the window between a
      // renderer reload and its first report, so the overhead bucket still has
      // a home instead of the tick being suppressed.
      projectId: this.report?.projectId ?? this.deps.storage.getActiveProjectId(),
      activeSessionId: this.report?.sessionId ?? null,
      rendererView: this.report?.view ?? 'workspace',
      // ⚠ D95: null on a STALE report, deliberately. The fallback above defaults
      // the view to 'workspace' for the same reason — between a renderer reload
      // and its first report, main does not know a council is running, and
      // assuming one would credit a project for work it cannot see.
      councilProjectId: this.report?.councilProjectId ?? null,
      overlayOpen: this.report?.overlayOpen ?? false,
      reportStale: this.reportStale,
      captureEnabled: this.deps.storage.getAttentionCaptureEnabled()
    }
  }

  summary(projectId: string, fromIso: string, toIso: string): AttentionSummary {
    const rows = this.deps.storage.readAttentionSpans(projectId, fromIso, toIso)
    const facts: AttentionSpanFact[] = rows.map((r) => ({
      cls: r.class as AttentionClass,
      seconds: r.seconds,
      // THIS ROW's cadence, never the current constant.
      tickSeconds: r.tickSeconds,
      startedAtMs: Date.parse(r.startedAt),
      endedAtMs: Date.parse(r.endedAt)
    }))
    const cov = coverage(facts, TICK_SECONDS)

    const perSession = new Map<string, number>()
    for (const r of rows) {
      if (r.class !== 'pane' || r.sessionId === null) continue
      const n = Math.round(r.seconds / (r.tickSeconds > 0 ? r.tickSeconds : TICK_SECONDS))
      perSession.set(r.sessionId, (perSession.get(r.sessionId) ?? 0) + n)
    }

    return {
      projectId,
      from: fromIso,
      to: toIso,
      byClass: cov.byClass as AttentionByClass,
      samples: cov.samples,
      tickSeconds: cov.tickSeconds,
      expectedSamples: cov.expectedSamples,
      missingSamples: cov.missingSamples,
      coveragePct: cov.coveragePct,
      bySession: [...perSession.entries()]
        .map(([sessionId, samples]) => ({ sessionId, samples }))
        .sort((a, b) => b.samples - a.samples),
      estimateBound: 'lower-bound'
    }
  }

  /**
   * Stop the clock and drop the in-memory handle.
   *
   * ⚠ THERE IS NOTHING TO FLUSH, AND THAT IS THE PROPERTY RATHER THAN AN
   * OMISSION. Every tick has already written durably, so the database is
   * current to within one tick at every instant — which is precisely why a
   * tree-kill (where dispose never runs at all) loses the same 15 s that a
   * clean quit does. Crediting a final partial interval here would credit time
   * that was never sampled and would break `credited == samples x tick`.
   */
  dispose(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.run = null
    this.openRowId = null
  }
}

export function createAttentionTracker(deps: AttentionTrackerDeps): AttentionTracker {
  return new AttentionTrackerImpl(deps)
}
