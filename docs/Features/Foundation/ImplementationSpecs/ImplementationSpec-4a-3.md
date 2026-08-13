# Implementation Spec 4a-3 — Wiring Resume Into Launch, Restore And Restart

_Governs exact contents for `Tasks/Task-4a-3.md`. **Rewritten 2026-08-13 against D139 as RESOLVED** and against coordinator amendments **D143 (b)(c)(g)**. Assumes 4a-1's column (landed), 4a-4's mirror (landed), and **4a-2's adapter contract merged** — this spec does not compile without it._

## 1. Verified starting state (`a6fab79`, re-measured 2026-08-13)

**⚠ THE FIRST DRAFT OF THIS SPEC CITED `82e16d7` AND EVERY ONE OF ITS `sessionManager.ts` / `ipc.ts` NUMBERS HAD MOVED**, because Task 4a-4 edited both files. Every number below was measured by the coordinator at `a6fab79`. **Re-confirm before editing anyway** — this phase has already had two citations go stale mid-flight.

| Symbol | Line | Current |
|---|---|---|
| `BUFFER_MAX_CHARS = 4_000_000` | `sessionManager.ts:27` | unchanged by this task |
| `SCRUB_FLUSH_MS = 50` | `sessionManager.ts:34` | unchanged by this task |
| `RESTORE_STAGGER_MS = 500` | `sessionManager.ts:38` | unchanged by this task |
| `RESTORE_CAP = 16` | `sessionManager.ts:42` | unchanged by this task |
| `attach()` | `sessionManager.ts:300` | pure view binding, returns `snapshot()` |
| `restore()` | `sessionManager.ts:321` | heal-first, then relaunch loop |
| credentialed heal | `sessionManager.ts:370` | heals to `exited`, sets a title, `continue`s — **untouched** |
| the relaunch spawn | `sessionManager.ts:395` | `this.spawn(row.agent as AgentKind, row.cwd, row.id)` — **stays byte-identical**, see §4.0 |
| `kill()` | `sessionManager.ts:499` | sets `killRequested` **before** `pty.kill()` |
| `wasKilledByChorus()` | `sessionManager.ts:543` | the flag's only reader is `dispatches.ts:155` |
| `dispose()` | `sessionManager.ts:548` | same intent-before-kill ordering |
| `snapshot()` composition | `sessionManager.ts:577` | `capTail(session.replaySeed, session.output.buffer, SCROLLBACK_MAX_CHARS)` |
| `private spawn()` | `sessionManager.ts:583` | the single spawn path |
| `adapter.buildLaunch({` | `sessionManager.ts:619` | the single launch-assembly call |
| `pty.spawn(...)` | `sessionManager.ts:652` | inside `spawn()` |
| `createSessionOutput({… onPersist})` | `sessionManager.ts:676` | the 4a-4 sink |
| `replaySeed:` IIFE | `sessionManager.ts:721` | `stripAltScreen(tail) + replayEpilogue()` |
| `child.onData(...)` | `sessionManager.ts:732` | the PTY data wiring |
| `child.onExit(...)` | `sessionManager.ts:734` | status, flush, retireHooks, contextUsage.forget |
| the exit fan-out loop | `sessionManager.ts:749` | `for (const listener of this.exitListeners) …` |
| restart comment | `sessionManager.ts:743` | _"A restart is a NEW CONVERSATION (D16 clause 4 …)"_ |
| the one `emit` path | `sessionOutput.ts:71` | `onPersist` at `:89`, `onText` at `:90`, `ingest` at `:94` |
| `stripAltScreen` / `replayEpilogue` | `scrollbackCore.ts:113` / `:126` | F58's mechanism |
| storage accessors | `storage.ts:1681` / `:1693` / `:1703` | `setAgentSessionId` / `clearAgentSessionId` / `getAgentSessionId` |
| `computeRestoreSet` | `restore.ts:31` | `RestoreCandidate = {id, status}`, structurally typed |
| `SessionLaunch` handler | `ipc.ts:1144` | — |
| row creation (`randomUUID()`) | `ipc.ts:1373`, `ipc.ts:1478` | — |
| `SessionRestart` handler | `ipc.ts:1591` | — |
| the nine `sessions.onExit` sites | `dispatches.ts:96` · `turns.ts:88` · `notifications.ts:24` · `index.ts:672` · `index.ts:678` · `dispatchAttribution.ts:275` · `ipc.ts:3966` · `ipc.ts:4011` · `ipc.ts:4169` | amendment (b)'s population |
| restart chip copy | `TerminalPane.vue:1249` | `Session restarted — new conversation` |
| Test baseline | — | **56 files / 1888 tests**, typecheck 0, `IpcChannel` **86** |

## 2. Two things the ruling deleted from this spec's first draft

**2.1 The existence pre-flight is gone.** The draft specified an `existsSync` on `~/.claude/projects/<munged-cwd>/<uuid>.jsonl` before every reopen. **Do not write it.** The council ruled reactive classification (Q4): attempt the resume, hand the adapter a bounded exit observation, act on the returned reason. Everything the pre-flight was for — the picker risk, the deleted-transcript case, the moved-worktree case — is now covered by `classifyResumeFailure` returning `not-found` / `transcript-unavailable` and by the clear-and-relaunch-once rule. The cwd-munge dependency, the worktree-cwd limitation and the "fail safe to fresh" degradation note all leave with it, because Chorus no longer depends on a path format it does not own.

**2.2 `codexSessionDiscovery.ts` is gone from this task.** Rollout-header parsing is `codex.ts`'s `discoverSessionId(context)` (4a-2). This spec owns the *orchestration* — §5.

## 3. `resumeCore.ts` — the pure decisions

Follows the `computeRestoreSet` / `attentionCore` / `turnsCore` / `scrollbackCore` house pattern: no `fs`, no `electron`, no `better-sqlite3`, no clock, **and no `randomUUID` import** — the minter is injected, the same discipline that keeps `Date.now()` out of `turnsCore`.

```ts
/**
 * Phase 4a / D139 (RESOLVED) / D140: what kind of conversation this launch is,
 * and what an exit from it means.
 *
 * PURE. Two inputs decide the launch: the row's stored pointer and the
 * adapter's declared descriptor kind. There is NO "does the transcript exist"
 * input — the council ruled reactive classification over a pre-flight stat
 * (Q4), and re-adding a third input here is how the pre-flight comes back.
 *
 * ⚠ `strategy` AND `action` ARE TWO AXES AND COLLAPSING THEM IS THE BUG THIS
 * MODULE EXISTS TO PREVENT. `strategy` says who names the conversation
 * (Chorus, or the CLI); `action` says whether this launch starts one or
 * reopens one. The pre-ruling draft had a single `idSource` axis and needed a
 * warning comment to keep `assign` and `fresh` apart; the ruled type does not.
 */
export type ResumePlan =
  /** claude, NULL pointer. The id is minted HERE but persisted by the caller
   *  AFTER the spawn succeeds — D143(c). */
  | { readonly action: 'assigned-create'; readonly agentSessionId: string }
  /** claude, stored pointer. */
  | { readonly action: 'assigned-resume'; readonly agentSessionId: string }
  /** codex, stored pointer. Q3: discovery is NEVER run for this. */
  | { readonly action: 'discovered-resume'; readonly agentSessionId: string }
  /** codex with a NULL pointer (`discoverAfterSpawn: true`), or an adapter
   *  with no resume support at all (`false` — argv byte-identical to today). */
  | { readonly action: 'fresh'; readonly discoverAfterSpawn: boolean }

export function planResume(input: {
  readonly storedAgentSessionId: string | null
  readonly descriptorKind: 'assigned' | 'discovered' | null
  readonly mintId: () => string
}): ResumePlan

/** The `PtyLaunchSpec.resume` modifier for a plan — `undefined` for `fresh`,
 *  which makes the buildLaunch call byte-identical to today's. */
export function toLaunchModifier(plan: ResumePlan): AgentSessionLaunch | undefined
```

Rules, matching the task's truth table exactly:

1. `descriptorKind === null` → `{action:'fresh', discoverAfterSpawn:false}`. **This is the branch that keeps kimi and opencode behaving exactly as they do today**, and it is the branch whose regression would be hardest to notice.
2. `'assigned'` + NULL pointer → `{action:'assigned-create', agentSessionId: mintId()}`.
3. `'assigned'` + stored pointer → `{action:'assigned-resume', agentSessionId: stored}`.
4. `'discovered'` + NULL pointer → `{action:'fresh', discoverAfterSpawn:true}`.
5. `'discovered'` + stored pointer → `{action:'discovered-resume', agentSessionId: stored}`.

`toLaunchModifier`:

| plan | modifier |
|---|---|
| `assigned-create` | `{strategy:'assigned', action:'create', agentSessionId}` |
| `assigned-resume` | `{strategy:'assigned', action:'resume', agentSessionId}` |
| `discovered-resume` | `{strategy:'discovered', action:'resume', agentSessionId}` |
| `fresh` | `undefined` |

And amendment (b)'s unit — the exit disposition, kept pure so the nine-listener consequence is decided by something a test can drive:

```ts
export type ExitDisposition =
  /** Today's behaviour: run the exit listeners. */
  | { readonly kind: 'fan-out' }
  /** D143(b): a resume failure is a DELIBERATE end. Mark intent, hold the
   *  fan-out, clear the pointer, relaunch ONCE, notify. */
  | { readonly kind: 'recover'; readonly reason: ResumeFailureReason }

export function planExitDisposition(input: {
  /** The action the launch that just exited actually carried. */
  readonly launchedAction: ResumePlan['action']
  /** Already true when the user or teardown killed it — never recover then. */
  readonly killRequested: boolean
  /** The adapter's verdict. MUST be null unless launchedAction was a resume. */
  readonly classified: ResumeFailureReason | null
}): ExitDisposition
```

> ⚠ **THE CLASSIFIER IS CONSULTED ONLY FOR A RESUME LAUNCH, AND THAT IS STRUCTURAL RATHER THAN A CONVENTION.** `planExitDisposition` returns `fan-out` whenever `launchedAction` is `'fresh'` or `'assigned-create'`, *regardless of `classified`* — so even a misbehaving adapter that classifies a fresh launch as a failure cannot reach the recovery path. This is the Q4 discovery-miss distinction, enforced by a type rather than remembered by a reader: **a codex fresh launch whose discovery missed can never produce a notice, because its exit can never reach `recover`.**

`killRequested === true` also forces `fan-out`: a user kill of a resumed session is an ordinary end, and 3a-1's flag already says so.

## 4. `sessionManager.ts` — the edits

### 4.0 One insertion point, not four — read this first

**The plan is computed inside `spawn()` (`:583`), from `this.storage`, not passed in by callers.** `spawn` is the single funnel that `launch()`, `restore()`'s relaunch at `:395`, and `session:restart` all pass through. Computing there means:

- **`restore()` needs no edit at all.** The relaunch at `:395` stays **byte-identical**, which is worth a great deal at review time: the D16 loop's credentialed heal (`:370`), `RESTORE_CAP` (`:42`), `RESTORE_STAGGER_MS` (`:38`) and the `existsSync(row.cwd)` guard are provably untouched because the file shows they were not touched.
- No call site can forget to plan, and no future call site can either.

`this.storage` may legitimately be unbound (module-scope construction). Treat unbound as a NULL pointer → `fresh`, exactly the pre-4a app.

### 4.1 Plan and capture `launchedAt` — immediately above `:619`

Directly before the `adapter.buildLaunch({` call:

```ts
const generation = (this.spawnGenerations.get(sessionId) ?? 0) + 1
this.spawnGenerations.set(sessionId, generation)
this.abortDiscovery(sessionId)          // supersede any in-flight discovery (Q3)

const plan = planResume({
  storedAgentSessionId: this.storage?.getAgentSessionId(sessionId) ?? null,
  descriptorKind: supportsResume(adapter) ? adapter.getCapabilities().sessionResume.kind : null,
  mintId: randomUUID
})
// Q3: captured IMMEDIATELY BEFORE the spawn, never after. A timestamp taken
// after the spawn would accept a rollout the spawn itself could not have
// written, which is the sibling-worktree cross-claim this bound exists to stop.
const launchedAt = Date.now()
```

### 4.2 Forward the modifier — inside the `:619` call

One added property, beside `hooks`:

```ts
    hooks,
    resume: toLaunchModifier(plan)
```

**Nothing else in that object changes.** A `fresh` plan yields `undefined`, and the assembled argv is byte-identical to today's for every adapter — which is the regression the 4a-2 argv fixtures and this task's kimi/opencode path both guard.

### 4.3 Persist an assigned id — AFTER `pty.spawn` returns (`:652`)

```ts
const child = pty.spawn(...)          // :652 — unchanged

// ⚠ D143(c). THE ID WAS MINTED BEFORE ARGV BECAUSE IT HAD TO BE IN ARGV. IT IS
// PERSISTED HERE, AFTER, BECAUSE D16 RESOLUTION (a) IS THE RULE THIS APP RUNS
// ON: restore() writes 'running' only after the spawn succeeds, so a crash
// between the two leaves a self-consistent row (:395–:400).
//
// The findings' action item 6 says "mints and persists an id before launch".
// The second half is wrong HERE and was overruled at D143(c). Persisting first
// means a failed spawn leaves a pointer to a conversation that never existed;
// the next launch resumes it, the resume fails, Q4 clears it and shows a
// "context was not restored" line — on a session that never had context. A
// spurious accusation of data loss is worse than the loss it describes.
//
// The worst this ordering can produce is an ORPHAN TRANSCRIPT — a conversation
// named on disk that Chorus forgot. That costs nothing and is invisible.
if (plan.action === 'assigned-create') {
  this.storage?.setAgentSessionId(sessionId, plan.agentSessionId)
}
```

### 4.4 Emit the conversation boundary — after the session literal, before `child.onData` (`:732`)

`LaunchOptions` gains one field:

```ts
  /**
   * Q7 / D143(g): this launch begins a conversation that is NOT continuous
   * with the history already in the mirror, so a visible boundary is emitted
   * before any PTY output. Absent for restore, which IS continuous.
   */
  readonly conversationBoundary?: 'restart' | 'context-not-restored'
```

Two coupled edits, and they only make sense together. First, the `replaySeed` IIFE at **`:721`**:

```ts
      // 4a-4's seed, MINUS the epilogue when a boundary follows — see below.
      replaySeed: (() => {
        const tail = this.scrollback?.readTail(sessionId) ?? ''
        if (tail.length === 0) return ''
        const painted = stripAltScreen(tail)
        return opts.conversationBoundary ? painted : painted + replayEpilogue()
      })(),
```

and then, immediately after the `const session: PtySession = {…}` literal and **before** `child.onData(...)` at `:732`:

```ts
    // Q7 / D143(g): the conversation boundary. Emitted THROUGH `output.ingest`
    // (sessionOutput.ts:94), so it takes the one emit path (D45(1)) and
    // therefore lands in BOTH the ring buffer and the disk mirror — a
    // permanent, correctly-placed record of when this conversation changed,
    // visible again at every future restore.
    //
    // ⚠ NOT APPENDED TO `replaySeed`. A seeded boundary would be redrawn on
    // EVERY attach, would drift to the wrong place in history, and would never
    // be recorded at all. Emitting it is what makes it true.
    //
    // ⚠ EMITTED SYNCHRONOUSLY HERE, BEFORE `child.onData` IS WIRED, so it
    // provably precedes any byte the restarted PTY produces — Node is
    // single-threaded and PTY data arrives via the event loop. "Before any
    // output from the restarted PTY is replayed or emitted" is Q7's wording and
    // this ordering is what earns it.
    //
    // ⚠ AND IT CARRIES THE EPILOGUE, WHICH IS WHY THE SEED DROPPED IT (above).
    // F58: a fresh TUI erases the viewport (codex ESC[2J) or paints over a
    // buffer with no scrollback (Claude ?1049h). A boundary printed on the last
    // viewport line would be wiped a moment later. So: the seed paints the old
    // screen, the boundary prints under it, and ONE epilogue scrolls BOTH into
    // xterm's scrollback where ESC[2J cannot reach. One epilogue, not two.
    if (opts.conversationBoundary) {
      output.ingest(conversationBoundary(opts.conversationBoundary) + replayEpilogue())
    }
```

> ⚠ **`ingest` RATHER THAN A DIRECT WRITE, DELIBERATELY.** It goes through this session's own fresh scrubber, so there is still exactly one place session text is scrubbed and exactly one place it fans out. The boundary contains no secret-prefix risk, and its trailing newlines guarantee the scrubber retains no carry.

### 4.5 Classify the exit, suppress, relaunch once — inside `child.onExit` (`:734`)

Current body order is: status → `exitCode` → `output.flush()` → `retireHooks(id)` → `contextUsage?.forget(id)` → the fan-out loop at `:749`. **Insert between `contextUsage?.forget(id)` and the fan-out loop.** Everything above the insertion still runs unconditionally — the PTY really did exit, and its hooks and context ring really must be retired.

```ts
      const disposition = planExitDisposition({
        launchedAction: plan.action,
        killRequested: session.killRequested,
        classified:
          (plan.action === 'assigned-resume' || plan.action === 'discovered-resume') &&
          supportsResume(adapter)
            ? adapter.classifyResumeFailure({
                exitCode,
                signal: null,
                // Post-scrub by construction (it IS the ring buffer), and
                // BOUNDED — the adapter needs the last screen, not the session.
                // ⚠ NEVER LOGGED. The contract says so and so does D33.
                output: session.output.buffer.slice(-RESUME_OBSERVATION_CHARS)
              })
            : null
      })

      if (disposition.kind === 'recover') {
        // ⚠ D143(b). Q4's automatic relaunch fires EVERY exit listener, and
        // there are NINE (dispatches.ts:96 · turns.ts:88 · notifications.ts:24 ·
        // index.ts:672 · index.ts:678 · dispatchAttribution.ts:275 ·
        // ipc.ts:3966 · ipc.ts:4011 · ipc.ts:4169). Left alone, ONE classified
        // resume failure closes a dispatch, closes a turn, fires an OS exit
        // toast, writes the row 'exited' and lights the project rail red — for
        // a session that came straight back.
        //
        // A resume-failure relaunch is a DELIBERATE end, which is exactly what
        // `killRequested` means (Task 3a-1: set BEFORE pty.kill() so intent can
        // never be misclassified as failure).
        //
        // ⚠ THE FLAG ALONE COVERS ONE OF THE NINE — `wasKilledByChorus`
        // (:543) is read only by dispatches.ts:155. MEASURED, not assumed. The
        // other eight see only an exit event, so holding the fan-out is the
        // half that actually works. Both are set: the flag makes the dispatch
        // classifier honest, the hold prevents the other eight.
        session.killRequested = true
        this.storage?.clearAgentSessionId(id)
        try {
          const replacement = this.spawn(agent, cwd, id, {
            ...opts,
            conversationBoundary: 'context-not-restored'
          })
          this.sessions.set(id, replacement)
          logger.warn(`[resume] context not restored for ${id} (${disposition.reason}); relaunched fresh`)
          return                       // the fan-out is HELD — nothing fires
        } catch (err) {
          // ⚠ AND IF THE RELAUNCH THROWS, THE SUPPRESSION IS REVERTED. An exit
          // suppressed for a session that did NOT come back would leave a row
          // saying 'running' with no PTY behind it — the invisible-process
          // failure D16 exists to prevent, and strictly worse than a spurious
          // toast. Fall through to the normal fan-out.
          logger.error({ err }, `[resume] relaunch after ${disposition.reason} failed for ${id}`)
        }
      }

      for (const listener of this.exitListeners) listener(id, exitCode)   // :749, unchanged
```

> **Once-only is structural, not counted.** The relaunch runs after `clearAgentSessionId`, so the replacement spawn's own `planResume` sees a NULL pointer and produces `assigned-create` or `fresh` — neither of which can ever reach `recover` (§3). There is no retry counter to reset and no way to loop.

Also add `this.abortDiscovery(session.id)` to `kill()` (`:499`) and to the `dispose()` loop (`:548`), beside the existing `output.dispose()` / `retireHooks` calls.

## 5. Discovery orchestration (Q3) — after the start-listener loop, before `return session`

```ts
    if (plan.action === 'fresh' && plan.discoverAfterSpawn && supportsResume(adapter)) {
      const controller = new AbortController()
      this.discoveries.set(sessionId, controller)
      void adapter
        .discoverSessionId({ cwd: request.cwd, launchedAt, signal: controller.signal })
        .then((discovered) => { /* see the guard below */ })
        .catch((err) => logger.info({ err }, `[discover] gave up for ${sessionId}`))
        .finally(() => {
          if (this.discoveries.get(sessionId) === controller) this.discoveries.delete(sessionId)
        })
    }
```

The rules, each of which is a separate way to get this wrong:

| Rule | Why |
|---|---|
| **Only after a successful spawn.** It sits below `pty.spawn` and below the start-listener loop, so a throwing spawn never reaches it. | A rollout cannot exist for a process that never started. |
| **Never for a resume launch.** The guard is `plan.action === 'fresh'`, not "the pointer is NULL". | Q3, verbatim. A resume already knows its id; discovery could only overwrite it with a worse guess. |
| **`launchedAt` is the value captured at §4.1**, not `Date.now()` here. | Anything captured after the spawn can accept a rollout the spawn itself did not write. |
| **`signal` is aborted on quit (`dispose()`), kill, restart and a superseding spawn** (the `abortDiscovery` at §4.1 runs on every re-spawn of the same id). | Q3. An aborted result must never be persisted. |
| **The generation is re-checked immediately before persistence.** | An abort that races a resolved promise still lands in `.then()`. The signal is necessary; the generation check is what is sufficient. |
| **Persist only a positive, exact `cwd` match on the rollout's first `session_meta` record, current relative to `launchedAt`.** Never `session_index.jsonl`. | F57 + Q3. |
| **Ambiguity returns `null`.** Two candidates matching equally → claim **neither**. | A pointer that might belong to the other pane is worse than no pointer: resuming the wrong conversation is a silent data-crossing, while no pointer is a visible, honest fresh start — and is exactly today's behaviour. |
| **A miss is an `info` log and nothing else.** No notice, no clear, no relaunch, pointer stays NULL. | Q4's discovery-miss distinction. |
| **Never propagate into a launch failure.** The whole call is `void`-ed and `.catch`-ed. | Discovery may fail; it may never cost a pane. |

The persistence guard, which is the sharp end:

```ts
        .then((discovered) => {
          if (!discovered) return                                   // miss — silent (Q4)
          if (controller.signal.aborted) return                     // quit/restart/dispose
          // ⚠ THE GENERATION CHECK IS NOT REDUNDANT WITH THE SIGNAL. An abort
          // that fires while the promise is already resolving still lands here;
          // the generation is the fact that says "this answer is about the PTY
          // that is CURRENTLY under this row id". Checked IMMEDIATELY before
          // the write, with no await between, so nothing can move in the gap.
          if (this.spawnGenerations.get(sessionId) !== generation) return
          if (this.sessions.get(sessionId)?.pty !== child) return    // superseded
          this.storage?.setAgentSessionId(sessionId, discovered)
          logger.info(`[discover] pointer recorded for ${sessionId}`)   // no id, no cwd — §7
        })
```

### The rollout-header rules 4a-3 verifies at runtime

Parsing is `codex.ts`'s (4a-2). This task does not re-implement it, but its acceptance run must demonstrate that the adapter honours all of it, because the adapter's unit tests run against fixtures and this is the only place real rollouts are involved:

- **First line only**, `type: "session_meta"`, fields `session_id`, `cwd`, `timestamp`. Any other record type, malformed JSON, a truncated line or a missing file → `null`, never a throw.
- **`cwd` equality is exact** after Windows normalisation — not a prefix match, not a parent match. A sibling worktree under the same repo must not match.
- **Header timestamp ≥ `launchedAt`** minus a small stated tolerance. State the tolerance in the code; do not leave it implied.
- **Bounded walk:** `~/.codex/sessions/YYYY/MM/DD/` for **today and yesterday only** — a launch never produces an older rollout, and two days covers a midnight boundary.
- **Bounded time:** a handful of polls over a few seconds, then `null`. The rollout appears asynchronously; waiting forever is a leak.

## 6. The boundary string — `scrollbackCore.ts`

Pure, tested, and living beside `replayEpilogue` (`:126`) because it is the same class of thing: terminal text main synthesises rather than receives.

```ts
/**
 * Q7 / D143(g): the visible boundary between a retained scrollback mirror and a
 * conversation that does not share its history.
 *
 * ⚠ THIS STRING IS PERSISTED. It goes through the session's emit path and is
 * therefore mirrored to disk like any other session text, which is the point:
 * it becomes a permanent, correctly-placed record of when the conversation
 * changed, still there at the next restore. Changing its text changes future
 * entries only — old mirrors keep the old wording, and that is correct,
 * because they are describing what happened at the time.
 */
export function conversationBoundary(reason: 'restart' | 'context-not-restored'): string
```

Exact bytes — asserted in `scrollbackCore.test.ts`, not described:

```
'\u001b[r\u001b[m\r\n'                                    // reset region + attrs, own line
+ '── Session restarted: fresh conversation ──'           // reason 'restart'
+ '\r\n'
```

and for `'context-not-restored'`, the same frame with:

```
'── Context was not restored: started a fresh conversation ──'
```

> ⚠ **THE COORDINATOR HAS RULED THAT THIS TERMINAL LINE IS ALSO Q4's "VISIBLE BADGE" — see `Task-4a-3.md`.** The council's own Q7 mitigation established the mechanism (_"formatted terminal text through the existing main-process scrollback/output path. No new IPC channel or renderer feature is required"_), and it buys three things a chip cannot: **permanence** (mirrored to disk, still there next boot), **position** (in history, at the moment it happened), and **no renderer change**, which is what keeps the findings' own "renderer code unchanged" line honest. The existing chip (`TerminalPane.vue:1249`) is untouched and still fires from `consumeRestoredBadge`. **Name the substitution in the commit.** If a chip is later wanted for the failure case, the minimal change is one optional field on the attach response plus one `v-if` — a renderer change, to be decided deliberately rather than added quietly.

## 7. What must never be logged

A log line carrying the agent session id **and** the cwd is a recipe for reconstructing a transcript path — a pointer to the full text of the user's work, in a file with different permissions from the transcript. **Log the Chorus session id and the outcome. Never the agent id. Never beside the cwd.** And `ResumeExitObservation.output` is never logged at any level: the contract says so, it is a slice of the user's terminal, and it is only post-scrub with respect to *this* session's registered secrets.

## 8. `ipc.ts` — restart clears the pointer and asks for the boundary

At `SessionRestart` (`:1591`). Two edits, and the **ordering of the first is load-bearing**:

```ts
    // D142: a restart is a DELIBERATE fresh conversation (D16 clause 4 — it is
    // what the "Session restarted" badge announces). Clearing the pointer is
    // what makes that true now that restore resumes; without this line the next
    // boot would silently reopen the conversation the user just chose to
    // abandon, and the badge would be lying.
    //
    // ⚠ BEFORE `sessions.launch`, NOT AFTER, AND THAT IS NOT STYLE. `spawn()`
    // reads the pointer from storage itself (§4.0) — clearing after the launch
    // would resume the very conversation this call exists to abandon, and then
    // clear the pointer to it. The order IS the behaviour.
    storage.clearAgentSessionId(sessionId)
    const snap = sessions.launch(row.agent as AgentKind, row.cwd, row.id, {
      // Q7 / D143(g): retained history, visibly separated. 4a-4 currently
      // re-seeds this pane SILENTLY — old conversation, then a fresh amnesiac
      // agent, nothing between them. This is the change to shipped behaviour.
      conversationBoundary: 'restart'
    })
```

**Nothing else on this path changes.** The live-session refusal, the cwd check, the unknown-agent refusal (D34(c)), the credentialed refusal (D33/F26), `exitedAt.delete`, `schedulePushProjectAttention()` and the response shape are all untouched.

## 9. Verification

### Build

```bash
npm run typecheck && npm test && npm run grep:secrets
```

`npm test` must show **no regression against 56 files / 1888 tests**. `IpcChannel` must still be **86** — `ipc.test.ts:3438` and `:3816` prove it without any edit.

### The headline demonstration (G2)

Not optional and not replaceable by tests.

1. Real project, real `claude` pane. Say: *"Remember the number 4917. Reply OK."* Then a second turn so the transcript is unambiguous.
2. `SELECT id, agent, agent_session_id FROM sessions WHERE status='running';` — capture.
3. **Quit Chorus entirely.** Then, once, repeat the whole run across a genuine machine reboot — that is the reported scenario.
4. Reopen. Pane returns. Ask: *"What number did I ask you to remember?"* → **4917**. Screenshot.
5. Repeat 1–4 for `codex`.

### The runtime checks — these are the ones a reviewer cannot do by reading

**(a) The D143(c) ordering, in both directions.**

```sql
-- immediately before a fresh claude launch
SELECT agent_session_id FROM sessions WHERE id='<row>';   -- expect NULL
-- immediately after
SELECT agent_session_id FROM sessions WHERE id='<row>';   -- expect a UUID
```

Then force the failure direction: point the adapter at an unlaunchable executable so `pty.spawn` throws, and confirm the pointer is **still NULL** — and that the next successful launch shows **no** "context was not restored" line.

**(b) The amendment (b) suppression — four negatives, measured.** Delete or truncate the transcript behind a stored pointer, reopen Chorus, and while the recovery fires:

```sql
-- no dispatch and no turn was closed by that exit
SELECT id, ended_at FROM dispatches  WHERE session_id='<row>' ORDER BY started_at DESC LIMIT 3;
SELECT id, ended_at FROM agent_turns WHERE session_id='<row>' ORDER BY started_at DESC LIMIT 3;
-- the row never reported 'exited'
SELECT status FROM sessions WHERE id='<row>';             -- expect 'running' throughout
```

plus: **no OS exit toast appeared**, and **the project rail did not go red**. Record all four as observations with the method used.

> ⚠ **CHECK THE TOAST CLAIM AGAINST THIS MACHINE BEFORE BELIEVING IT.** OS toasts are disabled here at the registry level (`ToastEnabled=0`), so "no toast appeared" is **not evidence of anything** on this box. Verify `notifications.ts:24` did not run — a temporary `logger.info` in that listener, or a breakpoint — rather than trusting the absence of a notification.

**(c) The discovery-miss silence.** Launch two codex panes in one cwd within the same second (or move `~/.codex/sessions` aside). Expect: both panes run normally, both pointers stay NULL, **no boundary line and no notice in either pane**, and an `info` log per session. `grep` the log for `warn`-level resume lines — expect none.

**(d) Discovery abort on quit.** Launch a fresh codex pane and quit Chorus within the discovery window. Expect: no `setAgentSessionId` after teardown (`SELECT agent_session_id` stays NULL), no log line after the dispose sequence, and the next launch is fresh.

**(e) The Q7 boundary, twice.** Restart a resumed pane: the pane shows retained history, then a visible `── Session restarted: fresh conversation ──`, then the fresh agent. Screenshot. **Then quit and reopen** — the boundary must still be there, in the same place in history. That second half is the proof it was mirrored rather than redrawn.

```bash
# it is in the mirror, exactly once per restart
grep -c "Session restarted: fresh conversation" "<userData>/scrollback/<sessionId>.log"
```

**(f) Restart really does clear, and in the right order.**

```bash
grep -n "clearAgentSessionId" src/main --include=*.ts
#   expect: the restart path (before sessions.launch) and the recovery path only
```

### The negative checks

```bash
# no transcript reader crept in — this task reads ZERO transcript bytes
grep -rn "\.jsonl" src/main --include=*.ts | grep -v test
#   expect: contextUsage.ts (pre-existing) and codex.ts (4a-2). NOT sessionManager.ts.

# the pre-flight did not come back
grep -rn "existsSync" src/main/services/sessionManager.ts
#   expect: only the pre-existing restore() cwd guard

# the hook listener is untouched
git diff --stat HEAD -- src/main/services/agentEvents.ts src/main/services/agentEventsCore.ts
#   expect: empty

# the restore loop's guards are untouched
git diff HEAD -- src/main/services/sessionManager.ts | grep -E "RESTORE_CAP|RESTORE_STAGGER_MS|credentialed"
#   expect: empty
```

Evidence under `_verify/4a-3/`.

## 10. What the commit message must record

- That the reboot demonstration was actually run across a **real** reboot, with the recalled value.
- Whether codex discovery proved reliable — and if not, that codex shipped **without** resume, as a stated outcome rather than a silent gap.
- **That D143(b)'s four negatives were measured, and how** — nine exit listeners exist and only one reads `killRequested`, so the suppression is the load-bearing half.
- **That D143(c) inverted the findings' action item 6** (mint before argv, persist after spawn) and why: D16 resolution (a), and the spurious-notice failure mode.
- **That D143(g) changes Task 4a-4's shipped behaviour** — a restarted pane was re-seeded silently and now carries a mirrored boundary.
- **That Q4's "visible badge" ships as an emitted terminal line rather than a pane chip**, per the coordinator ruling, and that the existing restart chip is untouched.
- That the pre-flight existence check was dropped in favour of reactive classification, so a future reader does not reinstate it.
- `IpcChannel` still 86; `agentEvents.ts` untouched; `restore()`'s relaunch call byte-identical.
