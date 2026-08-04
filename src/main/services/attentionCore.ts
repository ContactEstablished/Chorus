/**
 * Attention capture — the PURE core (Phase 3a / Task 3a-2, Mission Control spec
 * §5.3). Classification, slot resolution, tick accounting and coverage, with no
 * Electron, no database, and no clock of its own: **time arrives as a
 * parameter**. `attention.ts` is the seam that supplies both.
 *
 * The split is mandatory rather than tasteful. `vitest.config.ts` states the
 * constraint outright — tests never import `storage.ts` or `better-sqlite3`,
 * because the native binding is built for the Electron ABI (148) while Vitest
 * runs under Node 22 (127), so the first `new Database()` throws. A core that
 * imports Electron or Drizzle is a core with no tests, and this is the only
 * part of the feature unit tests can reach, so it carries all the logic worth
 * testing. Precedent: `restore.ts` (`computeRestoreSet`) and `vaultCore.ts`.
 *
 * ⚠ NO imports from 'electron', 'better-sqlite3', 'drizzle-orm', or
 *   '../db/schema'. No `Date.now()` anywhere in this file.
 */

/** §5.3's mandated threshold, verbatim: "anything over a 60-second idle
 *  threshold does not count". Not configurable. */
export const IDLE_THRESHOLD_SECONDS = 60

/**
 * One clock, 15 s, for the whole application. Chosen so that it divides the
 * 60 s idle threshold evenly (the boundary lands ON a tick, never between two),
 * sits well below the minute the output is displayed in, and bounds worst-case
 * data loss on a tree-kill at exactly one tick.
 *
 * ⚠ The cadence is recorded PER ROW (`attention_spans.tick_seconds`) precisely
 * so that changing this constant cannot silently rewrite what historical rows
 * mean. Read helpers must derive samples per row from that row's own
 * `tick_seconds` — never `seconds / TICK_SECONDS` applied globally.
 */
export const TICK_SECONDS = 15

/**
 * The five mutually exclusive states a tick can land in. Every tick lands in
 * exactly one, which is what makes the accounting identity in `coverage()`
 * checkable at any scale.
 */
export type AttentionClass = 'pane' | 'overhead' | 'blurred' | 'idle' | 'locked'

export const ATTENTION_CLASSES: readonly AttentionClass[] = [
  'pane',
  'overhead',
  'blurred',
  'idle',
  'locked'
]

/**
 * Everything `classify()` is allowed to know. Deliberately a flat bag of
 * primitives: it is also the exact set of facts the runtime proof has to be
 * able to force, and anything not here cannot influence the number.
 */
export interface AttentionInputs {
  /** `BrowserWindow.isFocused()`, latched from 'focus'/'blur' in main. */
  readonly windowFocused: boolean
  /** `BrowserWindow.isMinimized()`, latched from 'minimize'/'restore'. */
  readonly windowMinimized: boolean
  /** `powerMonitor.getSystemIdleTime()` — SECONDS, and OS-WIDE. It cannot tell
   *  which application received the input. See attention.ts's header. */
  readonly osIdleSeconds: number
  /** Latched from powerMonitor 'lock-screen'/'suspend', cleared on the matching
   *  'unlock-screen'/'resume'. */
  readonly osLocked: boolean
  /** The active project. null suppresses the row entirely (table row 12). */
  readonly projectId: string | null
  /** RENDERER-REPORTED: the session whose TERMINAL HOST holds DOM focus, or
   *  null for chrome. NOT `viewStore.focusedSessionId`, which is persisted view
   *  state with a different lifetime and is never updated in grid mode. */
  readonly activeSessionId: string | null
  /** 3b-4 added `council`. Everything that is not the workspace is `overhead`
   *  — ⚠ AMENDED BY D95: unless it is `council` AND `councilProjectId` names a
   *  project. See `classify()`. */
  readonly rendererView: 'workspace' | 'settings' | 'project-settings' | 'council'
  /**
   * ⚠ D95 (Task 3e-3): the project the COUNCIL VIEW is bound to, or null.
   *
   * Null whenever the renderer is not in the council view, **and** whenever it
   * is in the council view with no project selected. So a non-null value is a
   * single fact — *"the council view is doing paid work on a named project"* —
   * which is exactly the fact D95's exception turns on.
   *
   * ⚠ IT IS A FIELD OF ITS OWN RATHER THAN A READ OF `projectId`, AND NOT A
   * REUSE OF `activeSessionId`. This bag's own contract is that *"anything not
   * here cannot influence the number"*, so a classifier that reached outside it
   * would stop being forceable by the runtime proof. And `activeSessionId` is
   * the wrong home twice over: a council run has no session, and overloading it
   * would make `pane` and council attribution indistinguishable downstream.
   *
   * ⚠ TODAY IT EQUALS `projectId` WHENEVER IT IS NON-NULL, because `CouncilView`
   * is handed `projectStore.activeId`. That is a coincidence of the current
   * wiring, not a rule — `slotFor` credits THIS field, so a future council bound
   * to something other than the active project still attributes correctly.
   */
  readonly councilProjectId: string | null
  readonly overlayOpen: boolean
  /** True between a renderer reload and its first report (table row 11). */
  readonly reportStale: boolean
  /** The `attention_capture_enabled` kill switch, read live each tick. */
  readonly captureEnabled: boolean
}

/** What a tick is credited to. `sessionId` is non-null only for `pane`. */
export interface AttentionSlot {
  readonly projectId: string
  readonly sessionId: string | null
  readonly cls: AttentionClass
}

/**
 * ⚠ FIRST MATCH WINS, AND THE ORDER IS THE SPECIFICATION — see Task-3a-2.md's
 * focus-state table, whose thirteen rows are this function's test cases.
 * Precedence: locked → idle → blurred → overhead → pane.
 *
 * A ruling silently changed here (blur counted as overhead, the overlay check
 * placed after the pane check) produces numbers that still look plausible,
 * which is why the review reads this against the table row by row rather than
 * trusting the tests alone.
 */
/**
 * D95's predicate, factored so `classify()` and `slotFor()` cannot disagree
 * about it. **Both halves are required**: the council view alone is not enough,
 * and a project id reported from any other view is not council work.
 */
function isCouncilWork(i: AttentionInputs): boolean {
  return i.rendererView === 'council' && i.councilProjectId !== null
}

export function classify(i: AttentionInputs): AttentionClass {
  // Rows 1-2. Ranked above `idle` because "locked" is a STRONGER statement than
  // "untouched", and separating them keeps "walked away" distinguishable from
  // "locked up and left". Suspend/resume latches the same flag.
  if (i.osLocked) return 'locked'
  // Row 3. Beats blur so that `blurred` retains its precise meaning: the
  // machine is in active use, elsewhere.
  if (i.osIdleSeconds >= IDLE_THRESHOLD_SECONDS) return 'idle'
  // Rows 4-5. §5.3 scopes the overhead bucket to "time spent IN CHORUS"; another
  // app on top is not in Chorus. Minimize is blur with the window gone.
  // Recorded rather than dropped, so the histogram can show how much of the day
  // happened elsewhere instead of leaving a consumer to infer it did not happen.
  if (!i.windowFocused || i.windowMinimized) return 'blurred'
  // ⚠ D95 — THE ONE NARROW EXCEPTION, AND ITS POSITION IS DELIBERATE: AFTER
  // EVERY GUARD THAT DESCRIBES WHETHER THE USER IS PRESENT AT ALL, AND BEFORE
  // THE GENERIC `overhead` FALLBACK BELOW.
  //
  // `locked`, `idle` and `blurred` still win, because those guards describe the
  // HUMAN, not the view: a blurred window is not attention on the council
  // however good the intent, and a council run continues while its owner is at
  // lunch. Placing this above them would credit a fourteen-minute walk away.
  //
  // The rule: a view with no pane mounted is `overhead` UNLESS IT IS ITSELF
  // PERFORMING WORK ATTRIBUTABLE TO A PROJECT. The council view with a project
  // is the only such view today — it is doing paid work on a named project,
  // which `settings` never is.
  //
  // ⚠ IT DOES NOT REVERT D70 AND MUST NOT BE READ AS DOING SO. D70's reasoning
  // stands for `settings` and for every view Phase 4 and 5 add: they are
  // `overhead` BY CONSTRUCTION via the fallback below, with nobody having to
  // remember a list. A future view must EARN its way out of overhead exactly as
  // the council view just did — by naming the project it is working for.
  if (isCouncilWork(i)) return 'pane'
  // Row 8. Configuring Chorus is Chorus work, not task work — and it is also
  // the state where every TerminalPane is unmounted (3-4 spec §1), so there is
  // no pane to attribute to even if we wanted one.
  //
  // ⚠ WRITTEN AS "NOT THE WORKSPACE" RATHER THAN A LIST OF VIEWS (3b-4). The
  // council view has the identical property — no pane is mounted, so there is
  // nothing to attribute a tick to — and every view this app grows will too.
  // A list would have to be remembered; this cannot be forgotten.
  if (i.rendererView !== 'workspace') return 'overhead'
  // Row 9. ⚠ THIS CHECK MUST PRECEDE THE activeSessionId CHECK BELOW. An overlay
  // can be open WHILE a terminal underneath still holds DOM focus, so testing
  // activeSessionId first would credit dialog time to a pane. This is the single
  // easiest ordering mistake in the function.
  if (i.overlayOpen) return 'overhead'
  // Row 11. Fail toward the bucket that cannot corrupt a per-task number. At
  // most a tick or two, between a renderer reload and its first report.
  if (i.reportStale) return 'overhead'
  // Row 7. The attribute lives on the TERMINAL HOST, not the pane card, so
  // header/split-button/filmstrip/splitter clicks land here by construction.
  // Row 10 arrives here too: main clears activeSessionId when that session exits.
  if (i.activeSessionId === null) return 'overhead'
  // Row 6 — the one state that counts. It requires BOTH halves: main knows the
  // window has OS keyboard focus, the renderer knows which terminal has DOM
  // focus. Neither alone is sufficient.
  return 'pane'
}

/**
 * The slot a tick is credited to, or null when there is nothing to credit.
 *
 * Two suppressions, both of which write no row at all rather than inventing a
 * home for the tick: capture disabled by the user (row 13 — the tick still
 * fires, so the setting is live without a restart), and no active project
 * (row 12 — there is no bucket, and inventing a project id would be worse than
 * losing the sample).
 */
export function slotFor(i: AttentionInputs): AttentionSlot | null {
  if (!i.captureEnabled) return null
  const council = isCouncilWork(i)
  // Row 12, widened by exactly the width of D95: council work HAS a bucket even
  // if it were the only project id in the bag. When `councilProjectId` is null
  // this is byte-for-byte the old condition.
  if (i.projectId === null && !council) return null
  const cls = classify(i)
  return {
    // ⚠ D95 CREDITS THE COUNCIL'S OWN PROJECT, NOT "the active one". They are
    // the same value today; reading the field the decision is about is what
    // keeps that a coincidence rather than a dependency.
    projectId: council ? (i.councilProjectId as string) : (i.projectId as string),
    // Only `pane` names a session. Every other class is the per-project bucket.
    //
    // ⚠ AND COUNCIL WORK IS `pane` WITHOUT BEING PANE WORK, SO IT IS EXCLUDED
    // HERE EXPLICITLY RATHER THAN BY LUCK. `activeSessionId` is renderer-latched
    // from `focusin`; switching to the council view unmounts every TerminalPane
    // WITHOUT necessarily firing another `focusin`, so the last-focused session
    // can still be reported while the council runs. Without this guard a council
    // tick would be credited to whichever terminal the user last touched — the
    // most plausible-looking wrong number this function could produce.
    sessionId: cls === 'pane' && !council ? i.activeSessionId : null,
    cls
  }
}

export function sameSlot(a: AttentionSlot | null, b: AttentionSlot | null): boolean {
  if (a === null || b === null) return a === b
  return a.projectId === b.projectId && a.sessionId === b.sessionId && a.cls === b.cls
}

/** The open run, held in memory by the seam between firings. */
export interface AttentionRun {
  readonly slot: AttentionSlot
  readonly startedAtMs: number
  readonly lastTickMs: number
  /** Ticks credited to this run. Credited seconds is ALWAYS `samples ×
   *  tickSeconds` — never a wall-clock difference. */
  readonly samples: number
}

export type TickAction = 'none' | 'open' | 'extend'

export interface TickOutcome {
  readonly action: TickAction
  /** Run state AFTER this firing; null when nothing is being recorded. */
  readonly run: AttentionRun | null
  /** The run this firing closed — a slot change, a gap, or a suppression. */
  readonly closed: AttentionRun | null
  /** This firing arrived more than two ticks after the previous one. */
  readonly gap: boolean
}

/** Credited time, and the ONLY way it is ever computed. */
export function creditedSeconds(run: AttentionRun, tickSeconds: number = TICK_SECONDS): number {
  return run.samples * tickSeconds
}

/**
 * Advance the sampler by exactly one firing.
 *
 * ⚠ THE RULE THAT MAKES SLEEP AND CLOCK SKEW HARMLESS: a firing credits
 * **exactly one** sample, whatever the wall clock says. A timer that should
 * fire every 15 s can arrive ten minutes late — a suspended laptop, a
 * hibernating VM, a wildly loaded machine. Any code path computing
 * `now - lastTick` and adding it would credit those ten minutes as focused
 * attention and the day's headline number becomes fiction. There is no such
 * path here, and `creditedSeconds()` above is the only arithmetic that ever
 * produces a duration.
 *
 * A late firing (> 2 ticks) sets `gap` and CLOSES the open run rather than
 * extending it. Extending would leave one row whose `ended_at - started_at`
 * implies forty samples while it carries one — a row that lies about its own
 * contiguity. Closing keeps every row internally contiguous and leaves the hole
 * visible where it belongs: between two runs, where `coverage()` finds it.
 */
export function advance(
  prev: AttentionRun | null,
  inputs: AttentionInputs,
  nowMs: number,
  tickSeconds: number = TICK_SECONDS
): TickOutcome {
  const slot = slotFor(inputs)
  const gap = prev !== null && nowMs - prev.lastTickMs > tickSeconds * 2 * 1000

  // Suppressed (no project, or capture off): the open run is dropped. It is
  // already durable in the database — the seam writes on every tick — so this
  // costs nothing and stops a disabled stretch being spanned by one run.
  if (slot === null) return { action: 'none', run: null, closed: prev, gap }

  if (prev !== null && !gap && sameSlot(prev.slot, slot)) {
    return {
      action: 'extend',
      run: { slot: prev.slot, startedAtMs: prev.startedAtMs, lastTickMs: nowMs, samples: prev.samples + 1 },
      closed: null,
      gap: false
    }
  }

  return {
    action: 'open',
    run: { slot, startedAtMs: nowMs, lastTickMs: nowMs, samples: 1 },
    closed: prev,
    gap
  }
}

/** One stored span, reduced to the facts `coverage()` needs. The seam maps DB
 *  rows onto this; the core never sees a Drizzle row or an ISO string. */
export interface AttentionSpanFact {
  readonly cls: AttentionClass
  readonly seconds: number
  /** THIS ROW's cadence, not the current constant. */
  readonly tickSeconds: number
  readonly startedAtMs: number
  readonly endedAtMs: number
}

/**
 * The denominator. Not a display concern: **if the capture layer does not
 * record it, no later layer can invent it.** A window in which the app was shut
 * for six hours and a window in which the user worked for six hours at 8%
 * attention are indistinguishable from a minutes figure alone.
 */
export interface AttentionCoverage {
  /** Ticks credited, by class. Sums to `samples` — the accounting identity. */
  readonly byClass: Readonly<Record<AttentionClass, number>>
  readonly samples: number
  readonly tickSeconds: number
  /** Ticks the sampler SHOULD have produced across the window the returned
   *  spans envelope. Divergence means the app was not running, or was
   *  suspended, or was killed. */
  readonly expectedSamples: number
  readonly missingSamples: number
  /** `samples / expectedSamples`, one decimal. 0 when nothing was recorded. */
  readonly coveragePct: number
}

export function emptyByClass(): Record<AttentionClass, number> {
  return { pane: 0, overhead: 0, blurred: 0, idle: 0, locked: 0 }
}

/**
 * Roll a set of stored spans up into a histogram plus its denominator.
 *
 * `expectedSamples` is derived from the ENVELOPE of the returned spans
 * (`max(ended_at) - min(started_at)`), not from the sum of their individual
 * lengths. That is the whole point: summing per-span lengths would report 100%
 * coverage for a window with a crash-shaped hole in it, because each surviving
 * span is internally complete. The envelope sees the hole.
 *
 * Samples per span come from **that span's own** `tickSeconds`, so a future
 * cadence change cannot retroactively re-scale historical rows.
 */
export function coverage(
  spans: readonly AttentionSpanFact[],
  tickSeconds: number = TICK_SECONDS
): AttentionCoverage {
  const byClass = emptyByClass()
  let samples = 0
  let minStart = Number.POSITIVE_INFINITY
  let maxEnd = Number.NEGATIVE_INFINITY

  for (const s of spans) {
    const tick = s.tickSeconds > 0 ? s.tickSeconds : tickSeconds
    const n = Math.round(s.seconds / tick)
    if (!Number.isFinite(n) || n <= 0) continue
    byClass[s.cls] += n
    samples += n
    if (s.startedAtMs < minStart) minStart = s.startedAtMs
    if (s.endedAtMs > maxEnd) maxEnd = s.endedAtMs
  }

  // A run of n samples has its first tick at started_at and its last at
  // ended_at, so a CONTIGUOUS envelope of E seconds holds E/tick + 1 ticks.
  // Rounded, not floored: timer jitter of a few hundred ms must not fabricate a
  // missing sample.
  const expectedSamples =
    samples === 0 || !Number.isFinite(minStart) || !Number.isFinite(maxEnd)
      ? 0
      : Math.round((maxEnd - minStart) / 1000 / tickSeconds) + 1

  const missingSamples = Math.max(0, expectedSamples - samples)
  const coveragePct =
    expectedSamples === 0 ? 0 : Math.round((samples / expectedSamples) * 1000) / 10

  return { byClass, samples, tickSeconds, expectedSamples, missingSamples, coveragePct }
}
