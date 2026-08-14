# Task 4-1 — The Reason On The Live Record

_Phase 4, task 1 of 4. **One narrated commit (G3).** This task adds one field to a record that already exists and puts it on a wire that already exists. **No new channel, no migration, no renderer file, no new surface.** This task governs scope; `ImplementationSpecs/ImplementationSpec-4-1.md` governs exact contents._

> **⚠ THIS TASK TOUCHES THE HOOK SPINE, WHICH TWO PHASES HAVE KEPT BYTE-IDENTICAL ON PURPOSE.** `agentEvents.ts` and `agentEventsCore.ts` were unchanged across every task of Phase 4a (roadmap §7, phase-close tally). Changing them is this task's whole job, and it is why the task is **first and alone**: a revert must cost one commit.
>
> **⚠ AND IT IS A RETENTION CHANGE, NOT A READ-SURFACE CHANGE. D130 IS NOT BEING WIDENED.** `hook_event_name` is already read (`agentEventsCore.ts:160`). This task retains a **classification of a field already read**. No new field is taken from the hook body — not `prompt`, not `last_assistant_message`, not tool input. **If your implementation reads a new body field, you have left this task's scope and need a decision with a security argument.**

## Source Of Truth

- `Tasks/Phase-4-Overview.md` — §2 (the settled scope question), §5 (constraints).
- Roadmap §6 **D145** (why this field and not a bus), **D130** (the read surface), **D78/D129** (why amber has a source at all), **D143(f)** (`z.object` strips unknown keys — a runtime field not added to the schema vanishes on the wire **silently**).
- `docs/PLAN.md:184` — names **two** states, `waiting-for-user` and `waiting-for-permission`. This task is what makes that distinction expressible.
- `docs/PLAN.md:200` — the policy rules that consume it (Task 4-3).
- Roadmap §5 **F55 / F56** — why `agentEvents.ts:169`'s early return is load-bearing and must survive this change.

## Initial Starting Point — verified at `00f0f0d`

| Location | State today |
|---|---|
| `agentEventsCore.ts:42` | `WORKING_EVENTS` — a flat `readonly string[]` of 10 names |
| `agentEventsCore.ts:77` | `NEEDS_YOU_EVENTS` — a flat `readonly string[]` of **6** names: `Stop`, `StopFailure`, `Notification`, `PermissionRequest`, `Elicitation`, `TeammateIdle` |
| `agentEventsCore.ts:101` | `classifyHookEvent(eventName): AgentActivity \| null` |
| `agentEventsCore.ts:117` | `classifiedHookEventNames()` — the adapter's subscription list, deliberately the **same one home** as the classification map |
| `agentEvents.ts:83` | `AgentActivityRecord { activity, since }` |
| `agentEvents.ts:89` | `AgentActivityListener = (sessionId, activity, since) => void` |
| `agentEvents.ts:150` | `const activity = new Map<string, AgentActivityRecord>()` — **one record per live session; there is no ring** |
| `agentEvents.ts:158` | `record(sessionId, next)` |
| `agentEvents.ts:169` | `if (activity.get(sessionId)?.activity === next) return` — **the edge trigger** |
| `shared/ipc.ts:1831` | `agentActivitySchema = z.enum(['working', 'needs-you'])` |
| `shared/ipc.ts:1857` | `sessionActivityEventSchema { sessionId, activity, since }` |
| `shared/ipc.ts:1875` | `sessionActivityListResponseSchema { activities }` |
| `ipc.ts:4000` | the broadcast that parses and sends `SessionActivity` |
| `ipc.ts:4127` | the `SessionActivityList` cold-read handler |

**All six `needs-you` events collapse to one undifferentiated state today.** That is the gap.

## Goal

Give the live activity record a **reason** — which of the six stopping events put this session in `needs-you` — so the Inbox can say *"asking permission"* rather than *"stopped"*, and so Task 4-3's policy can treat a permission request differently from a finished turn. One field on the in-memory record, one field on the wire schema, and the edge trigger taught to notice it. **Nothing renders it in this task.**

## Exact Scope

| File | Change |
|---|---|
| `src/main/services/agentEventsCore.ts` | **Edit.** `NEEDS_YOU_EVENTS` becomes a name→reason map; add `NeedsYouReason` and `needsYouReasonFor`. `classifyHookEvent` and `classifiedHookEventNames` keep their exact signatures and outputs. |
| `src/main/services/agentEvents.ts` | **Edit.** `AgentActivityRecord` and `AgentActivityListener` gain `reason`; `record()` gains the reason argument and the widened edge trigger. |
| `src/shared/ipc.ts` | **Edit.** Add `needsYouReasonSchema`; add `reason` to `sessionActivityEventSchema`. **No channel added.** |
| `src/main/ipc.ts` | **Edit.** The broadcast at `:4000` and the cold read at `:4127` carry the new field. |
| `src/main/services/agentEventsCore.test.ts` | **Edit.** The reason map, and that the two derived outputs did not drift. |
| `src/main/services/agentEvents.test.ts` | **Edit.** The edge-trigger semantics below. |
| `src/main/services/turns.test.ts` | **Edit.** One pinning test — see Test Expectations. |
| `src/shared/ipc.test.ts` | **Edit.** Schema shape; **`IpcChannel` assertions stay at 86 and must not move.** |

Nothing else. **No renderer file, no preload change, no adapter file, no migration, no npm dependency.**

### The reason vocabulary

Three values, mapping the six events. The grouping is a **judgement, recorded here so it can be corrected without archaeology**:

| Reason | Events | Means |
|---|---|---|
| `permission` | `PermissionRequest`, `Elicitation`, `Notification` | blocked on an answer |
| `stopped` | `Stop`, `StopFailure` | the turn ended; the ball is with the human |
| `notice` | `TeammateIdle` | the agent surfaced something without asking a question |

`working` carries `reason: null`, always. **A wrong grouping here is a LABEL problem, not a data-loss one** — the event name determines the reason deterministically at classification time, so regrouping later is a one-line edit with no stored data to migrate. That asymmetry is why three values are chosen now rather than deferred.

> **⚠ `Notification` MOVED FROM `notice` TO `permission` DURING THE TASK, AND THE MOVE IS A MEASUREMENT RATHER THAN A SECOND OPINION.** The runtime gate observed it arriving **~6 s after a `PermissionRequest`, while the pane was still visibly blocked on "Do you want to proceed?"** — so the live reason DOWNGRADED from `permission` to `notice` purely because the agent nagged, leaving a session blocking on a question labelled as one that merely mentioned something. Task 4-3's policy would have read the softer label on exactly the case this field exists to sharpen.
>
> **The consequence is a suppression, and Task 4-2 should know about it before reaching for a nag count:** with both facts now unchanged, the widened edge trigger swallows the second event entirely — the session keeps its label, keeps its `since`, and costs one IPC message instead of two. `Notification` is therefore INVISIBLE to `onActivity` while a session is already `needs-you`/`permission`.
>
> **The honest limit, recorded rather than hidden:** Claude Code also fires `Notification` for plain idle-waiting-for-input, so an idle pane can now read as `permission` when it is not. That is the safe direction — both cases already show the same amber light, and a blocked agent under-reported is a human who never comes back. If a later surface needs the distinction, the fix is a precedence rule (never downgrade `permission` until `working`), not a regrouping.

## ⚠ The edge trigger — the part that is easy to get silently wrong

`record()`'s early return is keyed on **activity alone**. Left that way, this sequence loses the reason:

```
PermissionRequest  -> needs-you / permission   (recorded)
   ... user answers, agent works ...
Stop               -> needs-you / stopped      (SWALLOWED — activity unchanged)
```

…and the reverse case is worse: a session that stopped, then raised a permission prompt, would sit in the Inbox labelled *"stopped"* while it is in fact **blocking on a question**.

**The fix, and its exact constraint:**

- **Fire when EITHER `activity` OR `reason` changes.**
- **⚠ RE-STAMP `since` ONLY WHEN `activity` CHANGES.** A reason-only transition **keeps the original `since`**. `since` is the instant the session started needing a human, and `agentEvents.ts:79` and `:164` both state why: a re-stamp makes a waiting agent permanently one second old, the escalation ladder can never climb, and the Inbox's "oldest first" ordering silently becomes "most recently re-classified first".

That single rule is the whole delicacy of this task. **`agentEvents.ts:169`'s early return must be WIDENED, never removed** — F56 records that it is load-bearing for three separate things.

## Non-Goals

- **⚠ NOTHING RENDERS THE REASON IN THIS TASK.** No renderer file is touched. The field goes on the wire and no component reads it. A reviewer who finds a `.vue` diff has found a scope violation.
- **No new IPC channel.** `IpcChannel` stays **86** and both assertions in `ipc.test.ts` (3438, 3816) stay as they are. This task adds a **field to an existing payload**, which is a Zod change and not a channel change.
- **No change to `agentActivitySchema`.** It stays `z.enum(['working', 'needs-you'])`. The filmstrip and the rail roll-up derive from *activity*, and neither should have to learn a new enum to keep working.
- **No change to turn semantics.** `turns.ts` and `turnsCore.ts` are **not edited**. A mid-turn `Notification` closing a turn as `completed/stop` is pre-existing behaviour (F55's neighbourhood) and is not this task's to change.
- **No new hook body field.** D130 stands. No `prompt`, no `last_assistant_message`, no tool input, no `tool_name`.
- **No removal of the early return.** Widen the condition; do not delete it.
- **No `agent_events` table, no migration.** D145. `MIGRATIONS.length` stays **19**.
- **No reason for `working`.** It is `null`, not `'working'`. A nullable field that is only ever populated in one state is honest; an enum member meaning "not applicable" is not.
- **No logging of the reason per event.** `turns.ts:65` states the rule this file shares: a per-event log line is a second, unredacted record of exactly when the operator was working.
- **Do not revert, stage, or commit unrelated or untracked files** — see Overview §7.

## Dependencies

**None.** This task is first and stands alone.

## Test Expectations

Unit, all reachable under Vitest's `environment: 'node'` — every file here is pure or dependency-injected:

1. **`agentEventsCore`** — each of the six events maps to its stated reason; every `WORKING_EVENTS` name yields `null`; an unknown name yields `null` from **both** functions.
2. **`agentEventsCore` — the drift guard.** `classifiedHookEventNames()` still returns **exactly the same 16 names in the same order** as before this change. The file's own header calls the subscription list and the classification map "ONE HOME" and warns the drift is **silent in both directions**; the map restructure is precisely the change that could break it. Assert the array literally.
3. **`agentEvents` — the edge trigger, four cases:**
   - identical activity **and** identical reason → **no** listener call;
   - same activity, **different** reason → **one** listener call, **and `since` is unchanged** (assert the exact number, not "roughly");
   - different activity → one listener call, `since` re-stamped;
   - `working` after `needs-you` → `reason` is `null`.
4. **`turns` — the pinning test.** A reason-only `needs-you` re-fire, with no open turn, must **write nothing**: no second `closeAgentTurn`, no `openAgentTurn`. This is the one behavioural risk a widened trigger creates for an existing consumer, and it is pinned rather than reasoned about.
5. **`shared/ipc`** — `sessionActivityEventSchema` accepts a valid reason and `null`, rejects an unknown string, and **`reason` survives a `parse()` round-trip** (D143(f): `z.object` strips unknown keys, so a field present at runtime and absent from the schema disappears silently — assert its presence after parsing, not just that parsing succeeds).

**No test count regression** against 1977 / 58.

## Verification Commands

```bash
npm run typecheck          # 0 errors, node + web
npm test                   # >= 1977 tests across 58 files, exit 0
npm run grep:secrets       # clean
grep -n "toHaveLength(86)" src/shared/ipc.test.ts    # still 3438 and 3816
```

Plus, to prove the non-goals rather than assert them:

```bash
git diff --name-only        # no .vue file, no adapter, no migration
grep -n "MIGRATIONS" src/main/services/storage.ts   # array untouched
```

## Acceptance Criteria

1. `npm run typecheck` exits 0; `npm test` passes with **no test count regression**; `npm run grep:secrets` clean.
2. `IpcChannel` is still **86**, both assertions unchanged.
3. `MIGRATIONS.length` is still **19**; `sqliteTable(` still **18**.
4. `classifiedHookEventNames()` returns the identical 16-name array it returned before, **asserted literally**.
5. A reason-only transition **preserves `since`** — proven by a test asserting the exact value, not by inspection.
6. `git diff --name-only` lists **no** `.vue` file, no file under `src/main/adapters/`, and no change to `MIGRATIONS`.
7. **Runtime:** a real `claude` pane driven to a permission prompt reports `reason: 'permission'`, and the same pane on turn completion reports `reason: 'stopped'`. Capture the two `session:activity` payloads. **⚠ Verify against a throwaway `--user-data-dir`, never the installed app's DB.**
8. A `codex` pane (`hooks: null`) is **unaffected**: no activity record, no reason, no crash, nothing logged. The three-state agents must stay three-state.

## Review Checklist

- [ ] `NEEDS_YOU_EVENTS` and the subscription list still have exactly **one home** — no second list of names anywhere.
- [ ] The early return was **widened**, not removed (F56).
- [ ] `since` is re-stamped **only** on an activity change — read the code, do not trust the test name.
- [ ] `reason` is on `sessionActivityEventSchema`; a round-trip `parse()` preserves it (D143(f)).
- [ ] `agentActivitySchema` is unchanged.
- [ ] No new hook-body field is read (D130) — grep the diff for `body` accesses.
- [ ] No renderer file, no adapter file, no migration, no channel.
- [ ] `turns.ts` is byte-identical; only its **test** gained the pinning case.
- [ ] No per-event log line was added.
