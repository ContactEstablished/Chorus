# Implementation Spec 4-1 — The Reason On The Live Record

_Governs exact contents. `Tasks/Task-4-1.md` governs scope. Measured against `main` at `00f0f0d`; **re-read every line number before editing** — a line number in a task doc is a snapshot, not a fact (roadmap §5, the two swapped citations found in Phase 4a)._

---

## 1. `src/main/services/agentEventsCore.ts`

### 1.1 The reason type

Add above `WORKING_EVENTS`:

```ts
/**
 * WHY a session needs a human. Orthogonal to `AgentActivity`, and deliberately
 * NOT a fourth activity: the filmstrip and the project rail derive their lights
 * from `activity`, and neither should have to learn a new enum member to keep
 * working. `docs/PLAN.md:184` names two states — `waiting-for-user` and
 * `waiting-for-permission` — and this is the field that makes that distinction
 * expressible; `permission` is the second, the other two are the first.
 *
 * ⚠ THE GROUPING IS A JUDGEMENT AND IT IS CHEAP TO CHANGE, WHICH IS WHY IT IS
 * MADE NOW RATHER THAN DEFERRED. The reason is derived from the event name at
 * classification time and never stored, so regrouping later is a one-line edit
 * with no migration and no data to reinterpret. Getting it wrong costs a label.
 */
export type NeedsYouReason = 'permission' | 'stopped' | 'notice'
```

### 1.2 `NEEDS_YOU_EVENTS` becomes a map

**Replace** the flat array at `:77` with a `Record`, keeping the existing header comment (it explains why `Stop` is load-bearing) and extending it:

```ts
const NEEDS_YOU_EVENTS: Readonly<Record<string, NeedsYouReason>> = {
  Stop: 'stopped',
  StopFailure: 'stopped',
  Notification: 'permission',
  PermissionRequest: 'permission',
  Elicitation: 'permission',
  TeammateIdle: 'notice'
}
```

> **⚠ THE KEY ORDER IS PART OF THE CONTRACT, NOT COSMETIC.** `classifiedHookEventNames()` is the adapter's hook subscription list, and its order is observable in the written settings file. `Object.keys` on a string-keyed object literal preserves insertion order, so **the order above must match the array it replaces, name for name**. Task 4-1's Test Expectation 2 asserts the full 16-name array literally; that test is what makes this a contract rather than a hope.
>
> **⚠ `Notification` IS `permission`, AS SHIPPED — this line was `'notice'` when the spec was written and was changed on evidence, not on reflection.** The runtime gate observed it arriving ~6 s after a `PermissionRequest` while the pane was still blocked on "Do you want to proceed?", so the live reason downgraded mid-block. See `Tasks/Task-4-1.md` → *The reason vocabulary* for the measurement, the resulting suppression (the nag no longer fires `onActivity` at all), and the stated limit. **Note this is a VALUE edit: the key order is untouched, so the 16-name contract above is unaffected.**

### 1.3 `classifyHookEvent` — same signature, same behaviour

```ts
export function classifyHookEvent(eventName: string): AgentActivity | null {
  if (WORKING_EVENTS.includes(eventName)) return 'working'
  if (Object.prototype.hasOwnProperty.call(NEEDS_YOU_EVENTS, eventName)) return 'needs-you'
  return null
}
```

> **⚠ `hasOwnProperty`, NOT `eventName in NEEDS_YOU_EVENTS`, AND NOT A BARE TRUTHY LOOKUP.** The event name is **untrusted input** — the module header says so, citing the `bootInfo.ts` precedent (D83). `in` walks the prototype chain, so a body claiming `hook_event_name: "constructor"` or `"toString"` would classify as `needs-you` and light a card for an event that does not exist. The current flat-array `.includes()` has no such hole; the map restructure is what introduces it, so it is closed in the same edit.

### 1.4 The new derivation

```ts
/**
 * WHY this session needs a human, or `null` for every event that does not put
 * it there. Deliberately a SECOND function over the SAME map rather than a
 * widened return from `classifyHookEvent`: the existing signature has three
 * callers and a test suite pinned to it, and the value of this change does not
 * justify moving them.
 */
export function needsYouReasonFor(eventName: string): NeedsYouReason | null {
  if (!Object.prototype.hasOwnProperty.call(NEEDS_YOU_EVENTS, eventName)) return null
  return NEEDS_YOU_EVENTS[eventName]
}
```

### 1.5 `classifiedHookEventNames` — one home preserved

```ts
export function classifiedHookEventNames(): readonly string[] {
  return [...WORKING_EVENTS, ...Object.keys(NEEDS_YOU_EVENTS)]
}
```

The header's "ONE HOME" paragraph stays exactly as written — it is now more true, not less.

---

## 2. `src/main/services/agentEvents.ts`

### 2.1 The record and the listener

```ts
export interface AgentActivityRecord {
  activity: AgentActivity
  /** Why, when `activity` is 'needs-you'. ALWAYS null while 'working'. */
  reason: NeedsYouReason | null
  /** `Date.now()` at the transition into `activity`.
   *  ⚠ NOT re-stamped when only `reason` changes — see `record`. */
  since: number
}

export type AgentActivityListener = (
  sessionId: string,
  activity: AgentActivity,
  since: number,
  reason: NeedsYouReason | null
) => void
```

> **⚠ `reason` GOES LAST ON THE LISTENER, AND THAT IS A COMPATIBILITY DECISION RATHER THAN A STYLE ONE.** `turns.ts:81` destructures `(sessionId, activity, since)` and must keep compiling and behaving identically; an extra trailing parameter it ignores is free, while inserting `reason` before `since` would silently hand it a `NeedsYouReason` where it expects a millisecond stamp — a runtime corruption with **no compile error**, because the file's own callback is written inline and would simply re-type. Append; never insert.

### 2.2 `record()` — the whole delicacy of this task

Replace the body at `:158`:

```ts
  function record(sessionId: string, next: AgentActivity, reason: NeedsYouReason | null): void {
    const prev = activity.get(sessionId)
    // Edge-triggered, exactly as before — but on BOTH facts now. A working
    // agent fires PreToolUse/PostToolUse pairs continuously and must still
    // produce one callback, not twenty (F56).
    if (prev?.activity === next && prev.reason === reason) return

    // ⚠ `since` MOVES ONLY WHEN THE ACTIVITY DOES. A session that stopped and
    // then raised a permission prompt has been waiting since it STOPPED, and
    // re-stamping here would reset the escalation ladder every time the agent
    // re-classified itself — the exact failure the early return was widened to
    // fix, reintroduced one line lower down. The Inbox orders by this number.
    const activityChanged = prev?.activity !== next
    const since = activityChanged ? Date.now() : prev!.since

    activity.set(sessionId, { activity: next, reason, since })
    for (const listener of listeners) {
      try {
        listener(sessionId, next, since, reason)
      } catch (err) {
        logger.error({ err }, '[agent-events] activity listener threw')
      }
    }
  }
```

**The `prev!` is safe and the reason is worth stating:** `activityChanged` is `true` whenever `prev` is `undefined` (`undefined !== next` for both enum members), so the `else` branch is reachable only when `prev` exists. Prefer `prev?.since ?? Date.now()` if the non-null assertion offends the lint config — the behaviour is identical.

### 2.3 The call site

At `:249–255`, the classification gate becomes:

```ts
      const eventName = readHookEventName(body)
      if (!eventName) return
      const next = classifyHookEvent(eventName)
      // null = an event that says nothing about who holds the ball. The
      // session's activity is LEFT ALONE rather than reset (agentEventsCore).
      if (!next) return
      record(sessionId, next, needsYouReasonFor(eventName))
```

`needsYouReasonFor` returns `null` for every `WORKING_EVENTS` name, so `working` gets `reason: null` **by construction rather than by a branch** — there is no path that can set a reason on a working session.

Add `needsYouReasonFor` and `type NeedsYouReason` to the existing import from `./agentEventsCore` at `:5–11`.

### 2.4 The two read accessors

`recordFor` and `snapshot` return the record, so both carry `reason` for free once the interface gains it. **`snapshot()`'s mapped literal at `:311` is explicit and must be extended by hand:**

```ts
    snapshot(): ReadonlyArray<{
      sessionId: string
      activity: AgentActivity
      since: number
      reason: NeedsYouReason | null
    }> {
      return [...activity.entries()].map(([sessionId, a]) => ({
        sessionId,
        activity: a.activity,
        since: a.since,
        reason: a.reason
      }))
    },
```

**A missed field here is the D143(f) failure in its other half:** the schema would accept the object and `reason` would simply be absent, so the renderer's cold read would show every waiting session as reasonless while the live event stream showed reasons — a discrepancy that looks like a race and is not one.

### 2.5 What must NOT change

`register`, `revoke`, `activityFor`, `dispose`, the token map, the 404 shape, `MAX_BODY_BYTES`, `REQUEST_TIMEOUT_MS`, and **the entire `handle()` body above the classification gate**. The security notes in the file header stay accurate as written — verify that claim rather than assuming it, since point 5 has already been out of date once (it is corrected in-file at `:56`).

---

## 3. `src/shared/ipc.ts`

Immediately after `agentActivitySchema` (`:1831`):

```ts
/**
 * Why a session needs a human. `null` while it is working.
 *
 * ⚠ A SEPARATE FIELD RATHER THAN A WIDENED `agentActivitySchema`, because the
 * two have different consumers: the filmstrip and the project rail read the
 * activity and must not gain a fourth case to keep drawing three lights.
 */
export const needsYouReasonSchema = z.enum(['permission', 'stopped', 'notice'])
export type NeedsYouReason = z.infer<typeof needsYouReasonSchema>
```

And on `sessionActivityEventSchema` (`:1857`):

```ts
export const sessionActivityEventSchema = z.object({
  sessionId: z.string().min(1),
  activity: agentActivitySchema,
  since: stateSinceSchema,
  /** ⚠ NULLABLE AND REQUIRED, NOT OPTIONAL. `z.object` STRIPS unknown keys
   *  rather than rejecting them (D143(f)), so a field the producer sets and
   *  the schema omits vanishes on the wire in silence. Requiring it means a
   *  producer that forgets throws at the `parse()` in `ipc.ts` — loudly, in
   *  main, where it is diagnosable — instead of shipping a reasonless Inbox. */
  reason: needsYouReasonSchema.nullable()
})
```

`sessionActivityListResponseSchema` (`:1875`) is an array of that schema and needs **no edit** — confirm by reading it rather than assuming.

**⚠ `IpcChannel` is not touched.** No entry added, no entry renamed. Both `toHaveLength(86)` assertions (`ipc.test.ts:3438`, `:3816`) stay as they are.

---

## 4. `src/main/ipc.ts`

**`:4000` — the broadcast.** The callback gains the fourth parameter and passes it into the parse:

```ts
  agentEvents.onActivity((sessionId, activity, since, reason) => {
    const event = sessionActivityEventSchema.parse({ sessionId, activity, since, reason })
```

**`:4127` — the cold read.** `agentEvents.snapshot()` now carries `reason`, so the existing `.parse()` succeeds unchanged **provided §2.4 was done**. If it throws here, §2.4 was missed — that is the intended failure mode and it is why `reason` is required rather than optional.

**`:4046` — the rail roll-up.** `activityFor: (id) => agentEvents.recordFor(id)`. `attentionRollup.ts:40` types the callback's return as `{ activity: string; since: number } | null` — **structurally typed, so an added field is assignable and this line needs no edit.** Verify by typecheck, and **do not "tidy" `attentionRollup.ts` to mention the reason**: the rail derives two states and has no use for it (Task 4-1 non-goals).

---

## 5. Tests

| File | Add |
|---|---|
| `agentEventsCore.test.ts` | the six-event reason table; every `WORKING_EVENTS` name → `null`; unknown → `null` from both functions; **`"constructor"` and `"toString"` → `null` from both** (the prototype-chain case §1.3 closes); `classifiedHookEventNames()` asserted as the literal 16-name array |
| `agentEvents.test.ts` | the four edge-trigger cases from Task 4-1's Test Expectations, with `since` asserted as an **exact** value on the reason-only case |
| `turns.test.ts` | the pinning case: reason-only `needs-you` re-fire with no open turn writes **nothing** |
| `ipc.test.ts` | `sessionActivityEventSchema` accepts each reason and `null`, rejects `'urgent'`, and **`parse()` round-trips `reason`**; `IpcChannel` assertions unchanged |

**Driving the edge trigger without an HTTP server:** `agentEvents.test.ts` already exercises `record()` through the listener's public surface; follow whatever seam it uses today rather than exporting `record`. If the existing tests bind a real port on `127.0.0.1:0`, keep doing that — it is fast and it is what proves the classification gate at `:249` is wired to the new argument.

---

## 6. Verification

### Build gates

```bash
npm run typecheck        # 0 errors, node + web
npm test                 # >= 1977 / 58, exit 0
npm run grep:secrets     # clean
grep -n "toHaveLength(86)" src/shared/ipc.test.ts   # 3438, 3816 — unmoved
```

### Scope proofs

```bash
git diff --name-only     # no .vue, no src/main/adapters/, no storage.ts
git diff --stat src/main/services/turns.ts     # empty: the file is byte-identical
```

### Runtime — required, and it is where this task is actually proven

**⚠ Against a COPY of the dev DB in a throwaway `--user-data-dir`. Five databases exist on this machine and the installed app's (`%APPDATA%\chorus-app`) must never be opened.**

1. Launch a real `claude` pane. Give it a prompt that will require a permission grant (e.g. ask it to run a shell command it has not been pre-approved for).
2. Capture the `session:activity` payloads — CDP is the established instrument (`remote-debugging-port 9222`); hook `window` message traffic or log at the `ipc.ts:4000` parse.
3. **Expected, and all four must hold:**
   - the permission prompt yields `activity: 'needs-you', reason: 'permission'`;
   - granting it yields `activity: 'working', reason: null`;
   - turn completion yields `activity: 'needs-you', reason: 'stopped'`;
   - **`since` on the completion event is a NEW stamp** (activity changed via `working`), while a **second** stopping event arriving without an intervening `working` **keeps the earlier `since`** — this is the §2.2 rule and it is the one thing no unit test can prove is wired to real traffic.
4. Launch a `codex` pane in parallel. Confirm **no** activity record, **no** reason, and **nothing new in the log** — the three-state agents are untouched.
5. Confirm the filmstrip's lights and the project rail behave **exactly as before**: same colours, same escalation timing. This task must be invisible.

Keep the captures under `_verify/4-1/`.

### The negative control that is worth the two minutes

Temporarily revert **only** §2.2's `activityChanged` guard to an unconditional `Date.now()`, drive a stop-then-permission sequence, and confirm the wait's age **resets**. Then put it back. The guard is the whole task; a test that passes either way has not tested it.
