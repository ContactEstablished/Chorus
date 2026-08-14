# Implementation Spec 4-3 — Notification Policy + The In-App Centre

_Governs exact contents. `Tasks/Task-4-3.md` governs scope. Measured against `main` at `00f0f0d`; **re-read every line number before editing.**_

---

## 1. `src/main/services/notificationPolicyCore.ts` — new, pure

**Reproduce Task 4-3's PLAN.md mapping table in the file header**, including the declared reading that `stopped` is "completion". A rule whose justification lives only in a task doc becomes an unexplained `if` within one refactor.

### 1.1 Shape

```ts
/** What happened. Deliberately NOT `AgentActivity` — an exit is not an
 *  activity, and folding them would make one enum mean two lifetimes. */
export type NotificationEvent =
  | { kind: 'needs-you'; sessionId: string; reason: NeedsYouReason; workingMs: number | null }
  | { kind: 'exit'; sessionId: string; exitCode: number | null }

export interface PolicyInputs {
  event: NotificationEvent
  /** The session the user is demonstrably looking at, or null. Produced by
   *  `attentionCore.classify()` via `attention.attendedSessionId()` — NEVER by
   *  reading `viewStore.focusedSessionId` (reporter.ts:11 lists three verified
   *  reasons that value is the wrong instrument). */
  attendedSessionId: string | null
}

export type PolicyVerdict =
  | { notify: true }
  | { notify: false; suppressedBy: 'focused' | 'short-turn' | 'clean-exit' | 'unobserved-exit' }

export function decide(i: PolicyInputs): PolicyVerdict
```

> **⚠ THE VERDICT NAMES ITS SUPPRESSION AND THAT IS NOT DECORATION.** A bare `boolean` makes "we chose not to" and "we had no rule for it" the same value, and the first question anyone asks a notification system is *"why didn't it tell me?"*. The reason is a **return value**, not a log line — `turns.ts:65` states the rule this file shares: a per-event log line is a second, unredacted record of exactly when the operator was working.

### 1.2 The threshold

```ts
/** PLAN.md:200 — "notify on completion only if runtime > 2 min". A completed
 *  turn shorter than this is a conversational exchange, not an errand you
 *  walked away from, and interrupting for it trains the user to ignore the
 *  channel — the same salience argument attentionRollup.ts:46 makes for amber. */
export const COMPLETION_MIN_MS = 2 * 60 * 1000
```

Named, exported, tested on both sides at 119 s / 121 s.

### 1.3 The order of the guards, which is the whole function

```ts
export function decide(i: PolicyInputs): PolicyVerdict {
  // ⚠ FOCUS FIRST, AND IT OUTRANKS EVERY "ALWAYS" ROW. PLAN.md:200's "never for
  // the focused pane" is unconditional: notifying someone about the pane they
  // are staring at is the fastest way to make the channel worthless. Placing
  // this after the permission branch would make the most urgent event the one
  // that interrupts you about your own screen.
  if (i.event.sessionId === i.attendedSessionId) return { notify: false, suppressedBy: 'focused' }

  if (i.event.kind === 'exit') {
    // ⚠ A NULL EXIT CODE NOTIFIES NOTHING, AND THIS IS THE attentionRollup.ts:143
    // TRAP VERBATIM. All five of restore()'s heal paths write
    // ('exited', row.exitCode ?? null), so a session that was merely ALIVE when
    // you last quit comes back NULL — and `null !== 0` is true. Read as failure
    // it lit three of four projects red on a cold start with nothing crashed;
    // here it would fire a burst of false failure notifications on every boot.
    if (typeof i.event.exitCode !== 'number') return { notify: false, suppressedBy: 'unobserved-exit' }
    if (i.event.exitCode === 0) return { notify: false, suppressedBy: 'clean-exit' }
    return { notify: true }
  }

  if (i.event.reason === 'permission' || i.event.reason === 'notice') return { notify: true }

  // 'stopped' == completion. A null workingMs means the working stretch was
  // never observed (a session already waiting at boot), and an unobserved
  // duration is not a long one — the dispatches convention for NULL ended_at.
  if (i.event.workingMs === null) return { notify: false, suppressedBy: 'short-turn' }
  return i.event.workingMs > COMPLETION_MIN_MS
    ? { notify: true }
    : { notify: false, suppressedBy: 'short-turn' }
}
```

---

## 2. `src/main/services/attention.ts` — one read accessor, no behaviour change

Add to the `AttentionTracker` interface (`:105`):

```ts
  /** The session the user is demonstrably attending, or null.
   *
   *  ⚠ IT ASKS `classify()` RATHER THAN REPORTING `report.sessionId` DIRECTLY,
   *  because DOM focus alone is not attention: `classify()` also requires that
   *  the window has OS keyboard focus, that the user is neither idle nor
   *  locked, and that no overlay is open. Re-deriving any of that here would
   *  fork a rule that is already unit-tested — and reporter.ts:11 records what
   *  the cheap version costs. */
  attendedSessionId(): string | null
```

Implementation reuses whatever the impl already assembles for its tick — **find the existing `AttentionInputs` construction and call it, do not build a second bag of inputs**:

```ts
  attendedSessionId(): string | null {
    const inputs = this.currentInputs()   // the SAME assembly the tick uses
    return classify(inputs) === 'pane' ? inputs.activeSessionId : null
  }
```

> **⚠ `classify()` ALSO RETURNS `'pane'` FOR COUNCIL WORK (D95, `attentionCore.ts:163`), WHERE `activeSessionId` IS NULL.** Returning `inputs.activeSessionId` rather than a boolean handles that for free: the council case yields `null`, which suppresses nothing, which is correct — a council run is not a pane the user is watching.

**If the impl does not already factor its inputs into one place, factor it — and that refactor must not change a single classification.** `attention_spans` rows are a telemetry record whose meaning is pinned per row (`attention.ts:101`'s cadence note); a behaviour change here silently rewrites what past rows meant.

---

## 3. `src/main/services/notificationCenter.ts` — new

```ts
export interface NotificationEntry {
  id: string
  sessionId: string
  projectId: string | null
  agent: AgentKind
  label: string
  kind: 'needs-you' | 'exit'
  reason: NeedsYouReason | null
  exitCode: number | null
  at: number
}
```

### 3.1 The ring

Fixed cap, oldest dropped first.

```ts
/** ⚠ IN MEMORY, THIS RUN ONLY — D145 takes no table. The cap is here so a
 *  fortnight-long session cannot grow main's heap through a list nobody is
 *  reading; it is NOT a retention policy, because there is no retention. */
const MAX_ENTRIES = 200
```

### 3.2 Producers — two, and both already exist

**`needs-you`:** subscribe to `agentEvents.onActivity`. `turns.ts:19` states the idiom and why it is safe — *"it SUBSCRIBES; it does not reach into the hook path"*; `onActivity` is `Set`-backed and additive.

**⚠ THE WORKING-STRETCH DURATION IS THIS MODULE'S OWN BOOKKEEPING, NOT THE SPINE'S.** The listener receives the **new** `since`, not the previous one, so the module keeps its own `Map<sessionId, number>` stamped when a session enters `working` and read when it leaves. **Do not reach into `agent_turns` for it:** `turns.ts` closes the row from the *same* `onActivity` fan-out, and `ipc.ts:4072` records that the order within that `Set` is **not contractual** — so the row may or may not be closed when this listener runs. A read there is a race that will pass every test and fail on someone's machine.

Clear the map entry on `revoke`/exit so a long-lived app does not accumulate one number per dead session.

**`exit`:** subscribe to `sessions.onExit`. **This becomes a ninth `sessions.onExit` registration — the count is currently EIGHT** (roadmap §5, where the long-standing "nine" was corrected to eight by grep). Update that figure when this lands; it is load-bearing for D143(b), which suppresses the fan-out on a deliberate relaunch.

> **⚠ AND THAT SUPPRESSION APPLIES TO THIS LISTENER TOO.** D143(b) exists because a resume-failure relaunch fired every exit listener and produced a spurious toast for a session that came straight back. A **notification** for that same non-event is the identical defect with a longer memory. Check `wasKilledByChorus` / the established suppression seam exactly as `dispatches.ts:155` does — **do not add a new suppression mechanism**, and drive the case in verification.

### 3.3 The push

Same discipline as the rail and the Inbox: whole list, equality guard, **and the one-turn deferral on the exit path** (`ipc.ts:4066` — the listener that persists `status='exited'` is registered after `registerIpc`, so a synchronous recompute reads a stale table). Copy it and cite it.

---

## 4. `src/shared/ipc.ts` — three channels, 88 → 91

> **⚠ RE-READ THE COUNTER.** It should be **88** after Task 4-2. If it is not, stop and reconcile (F54).

```ts
  /** invoke: this run's notifications, newest first. */
  NotificationList: 'notification:list',
  /** event (main -> renderer): the list changed. Carries the COMPLETE list. */
  NotificationChanged: 'notification:changed',
  /** invoke: empty the centre. */
  NotificationClear: 'notification:clear',
```

Schemas mirror `NotificationEntry`, using `agentKindSchema` and `needsYouReasonSchema.nullable()`. `at` uses `stateSinceSchema` — an absolute instant, never an age (`shared/ipc.ts:1837`).

Both `toHaveLength(88)` → `toHaveLength(91)` (`ipc.test.ts:3438`, `:3816`).

---

## 5. `src/renderer/src/components/NotificationCenter.vue` — new

Follow `CommandPalette.vue`'s overlay mechanics. **Register it in `anyOverlayOpen` (`App.vue:430`)** — the same clause Task 4-2 adds the Inbox to, and the same reason: `attentionCore.ts:177` returns `'overhead'` while an overlay is open, and missing it bills reading-the-centre as work on whichever pane held DOM focus.

**Newest first** — the opposite of the Inbox, deliberately. The Inbox is a **queue** (act on the oldest); the centre is a **log** (read the newest). If both sorted the same way one of them would be wrong.

Row: agent label · project · what happened · relative time. Reuse the phrasing from Task 4-2 §5.1 so one event is not described two ways in two surfaces.

**⚠ The footer states the limit in words:** *"this session only"*, or equivalent. Not "no history yet" — there is no history, and an empty state that implies otherwise is the D83 failure applied to a sentence instead of a field.

Include the **clear** action. One `ref` and one interval for relative times, stopped when closed (Task 4-2 §5.2's rule).

---

## 6. Verification

### Build gates

```bash
npm run typecheck        # 0, node + web
npm test                 # no regression
npm run grep:secrets     # clean
grep -n "toHaveLength(91)" src/shared/ipc.test.ts    # BOTH sites
git diff --stat src/main/services/notifications.ts   # EMPTY
grep -rn "sessions\.onExit(" src/main/ | wc -l       # was 8; expect 9 — record it
```

### Runtime — real app, throwaway `--user-data-dir`, never `%APPDATA%\chorus-app`

1. **Focus suppression, both directions.** Pane A focused, pane B driven to a permission prompt → **entry appears**. Then focus pane B and drive it again → **no entry**. Same event, opposite outcome, one variable.
2. **The 2-minute rule, both sides.** A short turn on an unfocused pane → nothing. A turn over two minutes → an entry. (A long `sleep` in a Bash tool call is the cheapest way to manufacture the long one.)
3. **Failure vs clean exit.** Kill a PTY with a non-zero code → entry. Close a pane normally → **none**.
4. **⚠ THE BOOT CASE — DRIVE IT, DO NOT REASON ABOUT IT.** Start the app on a DB copy holding pre-existing `exited` rows with **null** exit codes. **Zero notifications.** This is `attentionRollup.ts:143`'s trap and it has already shipped once in this app's history.
5. **⚠ THE D143(b) CASE.** Force a resume failure so the automatic relaunch fires the exit fan-out. **No notification** — the session came straight back. Capture the before/after the way D143(b) itself was proven.
6. **Overlay accounting.** Open the centre; confirm main's tracker classifies as `overhead`; close it; confirm it returns.
7. **Clear** empties the list and the renderer updates without a manual refresh.
8. A `codex` pane produces **exit** notifications (it has a PTY) and **no** `needs-you` ones (it has no hook bus). Both halves confirmed — this is where "one producer, not four" is easiest to get wrong in a surface that looks agent-agnostic.

Evidence under `_verify/4-3/`.

### The negative control

Temporarily invert §1.3's focus guard so it suppresses **unfocused** panes instead, and confirm case 1 flips both ways. A suppression rule tested in one direction is a rule that can be inverted and still pass.
