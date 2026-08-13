import type { AgentSessionLaunch, ResumeFailureReason } from '../adapters/types'

/**
 * Phase 4a / D139 (RESOLVED) / D140: what kind of conversation this launch is,
 * and what an exit from it means.
 *
 * PURE — the house pattern of `restore.ts`'s `computeRestoreSet`,
 * `attentionCore.ts`, `turnsCore.ts` and `scrollbackCore.ts`: no `fs`, no
 * `electron`, no `better-sqlite3`, no clock, and NO `randomUUID` import. The
 * minter is injected, the same discipline that keeps `Date.now()` out of
 * `turnsCore`.
 *
 * Two inputs decide the launch: the row's stored pointer and the adapter's
 * declared descriptor kind. There is NO "does the transcript exist" input — the
 * council ruled REACTIVE CLASSIFICATION over a pre-flight stat (CR-4a.0 Q4),
 * and adding a third input here is exactly how the pre-flight comes back. The
 * `existsSync` on a vendor transcript path was considered and it lost: it put a
 * munged-cwd path format Chorus does not own on the critical path of every
 * restore. Do not reinstate it.
 *
 * ⚠ `strategy` AND `action` ARE TWO AXES AND COLLAPSING THEM IS THE BUG THIS
 * MODULE EXISTS TO PREVENT. `strategy` says WHO NAMES the conversation (Chorus,
 * or the CLI); `action` says whether this launch STARTS one or REOPENS one. The
 * pre-ruling draft had a single `idSource` axis and needed a warning comment to
 * keep `assign` and `fresh` apart; the ruled type does not.
 */
export type ResumePlan =
  /** claude with a NULL pointer. The id is minted HERE because it has to be in
   *  argv, but it is persisted by the caller AFTER the spawn succeeds — D143(c). */
  | { readonly action: 'assigned-create'; readonly agentSessionId: string }
  /** claude with a stored pointer. */
  | { readonly action: 'assigned-resume'; readonly agentSessionId: string }
  /** codex with a stored pointer. Q3: discovery is NEVER run for this. */
  | { readonly action: 'discovered-resume'; readonly agentSessionId: string }
  /** codex with a NULL pointer (`discoverAfterSpawn: true`), or an adapter with
   *  no resume support at all (`false` — argv byte-identical to today's). */
  | { readonly action: 'fresh'; readonly discoverAfterSpawn: boolean }

/**
 * ⚠ THE ONE PREDICATE THAT DECIDES WHETHER A FAILED-RESUME RECOVERY IS EVEN
 * REACHABLE, which is why it is a named export rather than two inline string
 * comparisons at each call site. Q4's load-bearing distinction — a codex
 * DISCOVERY MISS is not a resume failure — is enforced by this returning false
 * for `fresh`, so a fresh launch's exit can never produce a notice.
 */
export function isResumeAction(action: ResumePlan['action']): boolean {
  return action === 'assigned-resume' || action === 'discovered-resume'
}

/**
 * Which conversation this launch belongs to.
 *
 * ⚠ AN EMPTY STORED POINTER IS TREATED AS NULL. `getAgentSessionId` returns
 * whatever is in a TEXT column, and an empty id is not a conversation — both
 * adapters' argv builders already refuse one (an empty value would open claude's
 * interactive picker, D143(e)), so planning a resume around it would produce a
 * launch that can only fail. NULL and empty are the same fact: nothing to
 * resume.
 */
export function planResume(input: {
  readonly storedAgentSessionId: string | null
  readonly descriptorKind: 'assigned' | 'discovered' | null
  readonly mintId: () => string
}): ResumePlan {
  const stored =
    input.storedAgentSessionId !== null && input.storedAgentSessionId.length > 0
      ? input.storedAgentSessionId
      : null

  // ⚠ THE BRANCH THAT KEEPS KIMI AND OPENCODE BEHAVING EXACTLY AS THEY DO
  // TODAY, and the one whose regression would be hardest to notice: no
  // descriptor means no modifier, which means byte-identical argv.
  if (input.descriptorKind === null) return { action: 'fresh', discoverAfterSpawn: false }

  if (input.descriptorKind === 'assigned') {
    return stored === null
      ? { action: 'assigned-create', agentSessionId: input.mintId() }
      : { action: 'assigned-resume', agentSessionId: stored }
  }

  return stored === null
    ? { action: 'fresh', discoverAfterSpawn: true }
    : { action: 'discovered-resume', agentSessionId: stored }
}

/**
 * The `PtyLaunchSpec.resume` modifier for a plan — `undefined` for `fresh`,
 * which is what makes the `buildLaunch` call byte-identical to today's for every
 * adapter that has no pointer to reopen.
 */
export function toLaunchModifier(plan: ResumePlan): AgentSessionLaunch | undefined {
  switch (plan.action) {
    case 'assigned-create':
      return { strategy: 'assigned', action: 'create', agentSessionId: plan.agentSessionId }
    case 'assigned-resume':
      return { strategy: 'assigned', action: 'resume', agentSessionId: plan.agentSessionId }
    case 'discovered-resume':
      return { strategy: 'discovered', action: 'resume', agentSessionId: plan.agentSessionId }
    case 'fresh':
      return undefined
  }
}

/** What an exit from a planned launch means. */
export type ExitDisposition =
  /** Today's behaviour, unchanged: run the exit listeners. */
  | { readonly kind: 'fan-out' }
  /** D143(b): a resume failure is a DELIBERATE end. Mark intent, HOLD the
   *  fan-out, clear the pointer, relaunch ONCE fresh — and say so, IF there was
   *  anything to say (see `notify`). */
  | {
      readonly kind: 'recover'
      readonly reason: ResumeFailureReason
      /**
       * Whether to tell the user their context was not restored.
       *
       * ⚠ F65. FALSE MEANS "NOTHING WAS LOST", NOT "STAY QUIET ABOUT A LOSS",
       * and the distinction is what keeps Q4's never-silent rule intact. A pane
       * opened and never spoken to still gets a conversation id at launch, and
       * claude writes no transcript until the first turn — so that pointer names
       * a conversation that never existed. Its resume fails, honestly, and
       * announcing lost context there is the same spurious accusation D143(c)
       * refused the findings' action item 6 over: *a spurious accusation of data
       * loss is worse than the loss it describes*. The recovery still happens in
       * full — pointer cleared, relaunched fresh — it simply has nothing to
       * report.
       */
      readonly notify: boolean
    }

/**
 * Amendment D143(b)'s unit — kept pure so the eight-listener consequence is
 * decided by something a test can drive rather than by a runtime nobody can
 * reproduce.
 *
 * ⚠ THE CLASSIFIER IS CONSULTED ONLY FOR A RESUME LAUNCH, AND THAT IS
 * STRUCTURAL RATHER THAN A CONVENTION. This returns `fan-out` whenever
 * `launchedAction` is `'fresh'` or `'assigned-create'` *regardless of
 * `classified`* — so even a misbehaving adapter that classified a fresh launch
 * as a failure cannot reach the recovery path. That is Q4's discovery-miss
 * distinction enforced by a type rather than remembered by a reader: A CODEX
 * FRESH LAUNCH WHOSE DISCOVERY MISSED CAN NEVER PRODUCE A NOTICE, BECAUSE ITS
 * EXIT CAN NEVER REACH `recover`.
 */
export function planExitDisposition(input: {
  /** The action the launch that just exited actually carried. */
  readonly launchedAction: ResumePlan['action']
  /** Already true when the user or teardown killed it — never recover then. A
   *  user kill of a resumed session is an ordinary end, and Task 3a-1's flag
   *  already says so. */
  readonly killRequested: boolean
  /** The adapter's verdict. MUST be null unless `launchedAction` was a resume,
   *  and is ignored anyway when it is not. */
  readonly classified: ResumeFailureReason | null
  /**
   * F65: did this session ever record a turn — i.e. was there a conversation
   * here at all? Drives `notify` and NOTHING else: the recovery itself is
   * identical either way, because a failed resume must still clear its pointer
   * and relaunch whether or not anything was lost.
   */
  readonly hadRecordedTurns: boolean
}): ExitDisposition {
  if (input.killRequested) return { kind: 'fan-out' }
  if (!isResumeAction(input.launchedAction)) return { kind: 'fan-out' }
  if (input.classified === null) return { kind: 'fan-out' }
  return { kind: 'recover', reason: input.classified, notify: input.hadRecordedTurns }
}
