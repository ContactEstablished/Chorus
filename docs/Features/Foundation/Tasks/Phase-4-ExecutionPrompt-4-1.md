# Phase 4 — Execution Prompt (Task 4-1)

_Generated 2026-08-13 against `main` at `00f0f0d`. Paste the body below into a **fresh** conversation._

> **⚠ THIS IS THE FIRST TASK OF PHASE 4, AND IT IS DELIBERATELY THE SMALLEST.** It adds one field to a record that already exists and puts it on a wire that already exists. **Nothing renders it.** The whole point of splitting it out is that a revert costs one commit.
>
> **⚠ IT ALSO TOUCHES THE HOOK SPINE, WHICH TWO PHASES KEPT BYTE-IDENTICAL ON PURPOSE.** `agentEvents.ts` and `agentEventsCore.ts` were unchanged across all four Phase 4a tasks. Changing them is this task's entire job.

---

## PROMPT BODY — copy everything below this line

---

You are the **Coordinator** for Chorus **Phase 4 — Notifications, Task 4-1: The Reason On The Live Record**.

Repository root: `C:\Projects\ContactEstablished\Chorus`
Expected branch: **`main`** — confirm with `git branch --show-current`. **Do not switch or create a branch without instruction.**
Expected HEAD at start: **`00f0f0d`** ("Release version 0.5.0 so session continuity is installable"). If HEAD differs, **re-verify every line number and count below before relying on it.**

## 1. Goal

Give the live agent-activity record a **reason** — which of six stopping events put a session into `needs-you` — so a later task can say *"asking permission"* rather than *"stopped"*, and so the notification policy can treat a permission request differently from a finished turn.

One field on the in-memory record, one field on the wire schema, and the edge trigger taught to notice it. **No new IPC channel. No migration. No renderer file. Nothing renders the field in this task.**

## 2. Ground yourself first — read before editing

**Documents:**

- `CLAUDE.md` — locked architecture. Sessions live in main; all IPC Zod-validated **in main only**; no new dependencies without asking.
- `docs/Features/Foundation/Tasks/Task-4-1.md` — **governs scope.**
- `docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-4-1.md` — **governs exact contents.** Where the two disagree on *scope* the task doc wins; on *contents* the spec wins.
- `docs/Features/Foundation/Tasks/Phase-4-Overview.md` — §2 (why there is no `agent_events` table), §5 (constraints that survive decomposition).
- `docs/Features/Foundation/roadmap.md` — §5 (ground facts, most recent block first), §6 decisions **D145**, **D130**, **D129**, **D78**, **D143(f)**, **D14**, gates **G1–G4**, **G6**; findings **F55**, **F56**, **F67**.
- `docs/PLAN.md:184` and `:200` — the two states this field makes expressible, and the policy that will consume it.

**Code anchors — inspect each and report any that moved.** All verified at `00f0f0d`:

| Anchor | What is there |
|---|---|
| `src/main/services/agentEventsCore.ts:42` | `const WORKING_EVENTS: readonly string[] = [` — 10 names |
| `src/main/services/agentEventsCore.ts:77` | `const NEEDS_YOU_EVENTS: readonly string[] = [` — **6** names |
| `src/main/services/agentEventsCore.ts:101` | `export function classifyHookEvent(eventName: string): AgentActivity \| null {` |
| `src/main/services/agentEventsCore.ts:117` | `export function classifiedHookEventNames(): readonly string[] {` |
| `src/main/services/agentEventsCore.ts:160` | `export function readHookEventName(body: unknown): string \| null {` |
| `src/main/services/agentEvents.ts:83` | `export interface AgentActivityRecord {` |
| `src/main/services/agentEvents.ts:89` | `export type AgentActivityListener = (` |
| `src/main/services/agentEvents.ts:150` | `const activity = new Map<string, AgentActivityRecord>()` |
| `src/main/services/agentEvents.ts:158` | `function record(sessionId: string, next: AgentActivity): void {` |
| `src/main/services/agentEvents.ts:169` | `if (activity.get(sessionId)?.activity === next) return` — **the edge trigger** |
| `src/main/services/agentEvents.ts:249` | `const eventName = readHookEventName(body)` — the classification gate |
| `src/main/services/agentEvents.ts:255` | `record(sessionId, next)` — the call site |
| `src/main/services/agentEvents.ts:311` | `snapshot(): ReadonlyArray<{ sessionId; activity; since }>` — **an explicit mapped literal** |
| `src/shared/ipc.ts:1831` | `export const agentActivitySchema = z.enum(['working', 'needs-you'])` |
| `src/shared/ipc.ts:1848` | `export const stateSinceSchema = z.number().int().nonnegative()` |
| `src/shared/ipc.ts:1857` | `export const sessionActivityEventSchema = z.object({` |
| `src/shared/ipc.ts:1875` | `export const sessionActivityListResponseSchema = z.object({` |
| `src/main/ipc.ts:4000` | `agentEvents.onActivity((sessionId, activity, since) => {` — the broadcast |
| `src/main/ipc.ts:4046` | `activityFor: (id) => agentEvents.recordFor(id),` — the rail roll-up |
| `src/main/ipc.ts:4127` | `ipcMain.handle(IpcChannel.SessionActivityList, …)` — the cold read |
| `src/main/services/turns.ts:81` | `events.onActivity((sessionId, activity, since) => {` — **the consumer that must not change behaviour** |
| `src/main/index.ts:413` | `agentEvents.onTranscriptPath((sessionId, transcriptPath) => {` — the fourth consumer, untouched here |
| `src/main/services/attentionRollup.ts:40` | `activityFor: (sessionId) => { activity: string; since: number } \| null` — **structurally typed, so an added field needs no edit here** |

**Git checks to run before editing:**

```bash
git branch --show-current      # expect: main
git log -1 --format="%h %s"    # expect: 00f0f0d …
git status --porcelain
```

**⚠ MEASURE YOUR OWN TEST BASELINE BEFORE EDITING.** The figure below was measured at `00f0f0d`, but run `npm test` yourself first and compare against **your** number, not this document's.

## 3. Ground facts, verified at `00f0f0d`

| Fact | Value | How to check |
|---|---|---|
| `IpcChannel` | **86** | asserted twice in `src/shared/ipc.test.ts` — lines **3438** and **3816** |
| `MIGRATIONS.length` | **19** | ⚠ **PARSE the array, never grep it** — see the warning below |
| `sqliteTable(` | **18** | in `src/main/db/schema.ts` only |
| vitest | **1977 passed / 1977, across 58 files** | `npm test`, exit 0 |
| typecheck | **0 errors** (node + web) | `npm run typecheck`, exit 0 |
| secret-grep | clean, 6 patterns | `npm run grep:secrets` |
| Highest decision | **D145** | roadmap §6 |
| Highest finding | **F67** | roadmap §5 |

> **⚠ THE MIGRATION COUNT MUST BE PARSED, NEVER GREPPED — A NAIVE COUNT RETURNS 171.** The **comments between the array elements contain backticks** (e.g. `` `title: text('title')` `` at `storage.ts:196`), so any character-scanner treats a comment as a template literal and every count after it is garbage. Use the TypeScript compiler's AST if you need to check it. **This task takes no migration, so the number must still read 19 when you finish.**

## 4. Pre-existing changes — DO NOT REVERT, STAGE, OR COMMIT THESE

`git status --porcelain` at generation time. **None of it is yours.** Stage by explicit path; never `git add -A`, never `git add .`:

```
 M docs/Features/Foundation/roadmap.md
 M docs/Plan.md
?? CLAUDE-PROJECT-MARKER.txt
?? docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-4-1.md
?? docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-4-2.md
?? docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-4-3.md
?? docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-4-4.md
?? docs/Features/Foundation/Investigations/Voice-Input-Feature-Requirements-source.md
?? docs/Features/Foundation/Phase-5-VoicePlan.md
?? docs/Features/Foundation/Tasks/Phase-4-KickoffPrompt.md
?? docs/Features/Foundation/Tasks/Phase-4-Overview.md
?? docs/Features/Foundation/Tasks/Phase-4a-ExecutionPrompt-4a-3.md
?? docs/Features/Foundation/Tasks/Task-4-1.md
?? docs/Features/Foundation/Tasks/Task-4-2.md
?? docs/Features/Foundation/Tasks/Task-4-3.md
?? docs/Features/Foundation/Tasks/Task-4-4.md
?? "docs/Features/Voice Input/"
```

The modified `roadmap.md` carries **D145** and **F67**, which this task depends on. **Read it; do not commit it.** This list is a snapshot — read `git status` yourself rather than trusting it.

**Your commit is CODE ONLY.** The eight Phase 4 documents are the coordinator's to commit separately.

## 5. Implementation scope — files owned, nothing else

| File | Change |
|---|---|
| `src/main/services/agentEventsCore.ts` | **Edit.** `NEEDS_YOU_EVENTS` becomes a name→reason map; add `NeedsYouReason` and `needsYouReasonFor`. `classifyHookEvent` and `classifiedHookEventNames` keep their exact signatures **and outputs**. |
| `src/main/services/agentEvents.ts` | **Edit.** `AgentActivityRecord` and `AgentActivityListener` gain `reason`; `record()` gains the argument and the widened trigger; `snapshot()`'s literal gains the field. |
| `src/shared/ipc.ts` | **Edit.** Add `needsYouReasonSchema`; add `reason` to `sessionActivityEventSchema`. **No channel added.** |
| `src/main/ipc.ts` | **Edit.** The broadcast (`:4000`) and the cold read (`:4127`) carry the field. |
| `src/main/services/agentEventsCore.test.ts` | **Edit.** |
| `src/main/services/agentEvents.test.ts` | **Edit.** |
| `src/main/services/turns.test.ts` | **Edit.** One pinning test. |
| `src/shared/ipc.test.ts` | **Edit.** Schema shape. **`IpcChannel` assertions stay at 86.** |

**Nothing else.** No renderer file, no preload change, no adapter file, no migration, no npm dependency.

### The reason vocabulary — three values over six events

| Reason | Events | Means |
|---|---|---|
| `permission` | `PermissionRequest`, `Elicitation`, `Notification` | blocked on an answer |
| `stopped` | `Stop`, `StopFailure` | the turn ended; the ball is with the human |
| `notice` | `TeammateIdle` | surfaced something without asking a question |

> **⚠ AS SHIPPED. `Notification` was `notice` when this prompt was generated and moved to `permission` on runtime evidence** — it arrives ~6 s after a `PermissionRequest` while the pane is still blocked, so the live reason downgraded mid-block. The nag is now SUPPRESSED by the widened edge trigger rather than relabelled. Full record in `Task-4-1.md` → *The reason vocabulary*.

`working` carries `reason: null`, **always**. The grouping is a judgement recorded in the task doc; a wrong grouping is a **label** problem, not a data-loss one, because the reason is derived from the event name at classification time and never stored.

## 6. ⚠ THE ONE THING THIS TASK IS ACTUALLY ABOUT

`record()`'s early return (`agentEvents.ts:169`) is keyed on **activity alone**. Left that way, this sequence loses the reason:

```
PermissionRequest  -> needs-you / permission   (recorded)
   ... user answers, agent works ...
Stop               -> needs-you / stopped      (SWALLOWED — activity unchanged)
```

…and the reverse is worse: a session that stopped and then raised a permission prompt would sit labelled *"stopped"* while it is in fact **blocking on a question**.

**The rule, and it has two halves that must both hold:**

1. **Fire when EITHER `activity` OR `reason` changes.**
2. **⚠ RE-STAMP `since` ONLY WHEN `activity` CHANGES.** A reason-only transition **keeps the original `since`**. `since` is the instant the session started needing a human; `agentEvents.ts:79` and `:164` both state why a re-stamp is fatal — a waiting agent becomes permanently one second old, the escalation ladder can never climb, and "oldest first" silently becomes "most recently re-classified first".

**⚠ WIDEN THE EARLY RETURN. DO NOT REMOVE IT.** F56 records that it is load-bearing for three separate things: the filmstrip's no-op suppression, `since` staying honest, and `turnsCore`'s two-state machine.

## 7. Resolved decisions — quote them in code comments where they bite

- **D145 (RESOLVED 2026-08-13)** — *"The `agent_events` bus is NOT built in Phase 4… What is actually missing is not history at all — it is the REASON on the current state."* **This task is that field.** No table, no migration.
- **D130 (RESOLVED 2026-08-07)** — the hook listener's read surface does not widen without an explicit decision with a security argument. **This task is a RETENTION change, not a read-surface change:** `hook_event_name` is already read at `agentEventsCore.ts:160`. **If your implementation reads a new body field — `prompt`, `last_assistant_message`, tool input, `tool_name` — you have left this task's scope.**
- **D143(f) (ADOPTED 2026-08-13)** — *"`z.object` **strips** unknown keys rather than rejecting them, so a `kind` added to the runtime object and not to the schema would vanish on the wire **silently**."* The identical hazard applies to `reason`. Make it **required and nullable**, not optional, so a producer that forgets throws loudly in main.
- **D14** — IPC payloads crossing the bridge must be **plain objects**; Pinia/reactive values fail structured clone at runtime with no compile-time signal.
- **D78 / D129** — amber has a source because the hook bus reports the agent's own lifecycle. This task is what finally gives it a *reason* as well as a source.

## 8. Strict non-goals

- **⚠ NOTHING RENDERS THE REASON.** No `.vue` file is touched. A reviewer who finds one has found a scope violation.
- **No new IPC channel.** `IpcChannel` stays **86**; both assertions (`ipc.test.ts:3438`, `:3816`) stay as they are.
- **No change to `agentActivitySchema`.** It stays `z.enum(['working', 'needs-you'])` — the filmstrip and the rail derive from *activity* and must not learn a new enum.
- **No change to turn semantics.** `turns.ts` and `turnsCore.ts` are **not edited**. A mid-turn `Notification` closing a turn as `completed/stop` is pre-existing behaviour and not yours to change.
- **No removal of the early return.** Widen; do not delete.
- **No new hook body field** (D130).
- **No `agent_events` table, no migration.** `MIGRATIONS.length` stays **19**; `sqliteTable(` stays **18**.
- **No reason for `working`.** It is `null`, not an enum member meaning "not applicable".
- **No per-event log line.** `turns.ts:65` states the shared rule: a per-event log is a second, unredacted record of exactly when the operator was working.
- **No edit to `attentionRollup.ts`.** Its callback type is structural; it needs no change and must not be "tidied" to mention the reason.
- **No npm dependency.**
- **Do not revert, stage, or commit the §4 files.**

## 9. Required workflow

There is **no workflow kit** in this repo (no `.codex/workflows/subagents/`), so the coordinator pattern is followed manually:

1. **Ground** — read §2's documents and inspect every code anchor **before editing**. Report any line number that moved.
2. **Spec review** — re-read `ImplementationSpec-4-1.md` and confirm your plan matches. Task doc wins on scope; spec wins on contents.
3. **Measure your own test baseline BEFORE editing.** Do not trust this document's 1977 / 58.
4. **Implement.**
5. **Code-quality review** — review your own diff against `Task-4-1.md`'s Review Checklist, item by item. Fix what fails.
6. **Verification** — run everything in §10, in full. **Run, don't just compile (G2).**
7. **One intentional narrated commit (G3)** — a concise title, then a description a non-technical reader understands first and a technical reader second. Stage by explicit path. **Code only.**
8. **Do not push and do not open a PR** unless explicitly asked.

## 10. Verification commands

Run from the repo root.

### Build gates

```bash
npm run typecheck      # G1 — expect 0 errors, node + web
npm test               # compare against YOUR measured baseline, not 1977/58
npm run grep:secrets   # G4 — expect clean
```

### Counters that must NOT move

```bash
grep -n "toHaveLength(86)" src/shared/ipc.test.ts   # expect exactly two hits: 3438, 3816
grep -c "sqliteTable(" src/main/db/schema.ts        # expect 18
```

`MIGRATIONS.length` must still be **19** — **parse it, do not grep it** (§3).

### Structural proofs — prove the non-goals, do not assert them

```bash
git diff --name-only                            # no .vue, no src/main/adapters/, no storage.ts, no schema.ts
git diff --stat src/main/services/turns.ts      # EMPTY — byte-identical
git diff --stat src/main/services/turnsCore.ts  # EMPTY
git diff --stat src/main/services/attentionRollup.ts   # EMPTY
```

Grep your own diff for accesses to the hook body beyond `hook_event_name` and `transcript_path` (D130).

### Runtime gates (G2 — measure the app, do not reason about it)

**⚠ AGAINST A COPY OF THE DEV DB IN A THROWAWAY `--user-data-dir`. FIVE DATABASES EXIST ON THIS MACHINE AND THE INSTALLED APP'S (`%APPDATA%\chorus-app`) MUST NEVER BE OPENED.**

Capture the `session:activity` payloads — CDP (`--remote-debugging-port 9222`) is the established instrument, or log at the `ipc.ts:4000` parse.

1. Launch a real `claude` pane. Give it a prompt requiring a permission grant (a shell command it has not been pre-approved for).
2. **The permission prompt yields** `activity: 'needs-you', reason: 'permission'`.
3. **Granting it yields** `activity: 'working', reason: null`.
4. **Turn completion yields** `activity: 'needs-you', reason: 'stopped'`.
5. **⚠ THE `since` RULE, WHICH NO UNIT TEST CAN PROVE IS WIRED TO REAL TRAFFIC:** the completion event carries a **new** `since` (activity changed via `working`), while a **second stopping event with no intervening `working`** keeps the **earlier** `since`. Show both numbers.
6. **A `codex` pane launched alongside is unaffected** — no activity record, no reason, nothing new in the log. The three-state agents stay three-state.
7. **The filmstrip lights and the project rail behave exactly as before** — same colours, same escalation timing. **This task must be invisible.**

Keep the captures under `_verify/4-1/`.

### The negative control — worth the two minutes

Temporarily revert **only** the `since` guard to an unconditional `Date.now()`, drive a stop-then-permission sequence, and confirm the wait's age **resets**. Then put it back. **The guard is the whole task; a test that passes either way has not tested it.**

## 11. Findings this task inherits

- **F56** — tool-call counts are structurally unobservable from `onActivity` because `agentEvents.ts:169` returns early when activity is unchanged. **That early return is load-bearing and must survive as a widened condition.** Do not remove it to make anything easier.
- **F55** — a "turn" counts agent activity, not user prompts. Not yours to fix; relevant because `turns.ts` consumes the same callback you are widening, and its behaviour must not change.
- **F67** — `SubagentStart`/`SubagentStop` both classify `working`, so the edge trigger swallows them and D39's sub-agent count is unobservable. **Deferred with the bus by D145 — do not attempt it here**, and do not "fix" it by moving either name between the two sets.

## 12. Failure honesty clause

If any verification command fails — including for an unrelated environment reason (a native-module ABI mismatch, a locked database, a missing CLI, a flaky test) — **capture the exact output verbatim, explain what you believe caused it, and do not claim success.** A partial pass reported as a pass is worse than a clean failure, because the next task builds on it. If a runtime gate cannot be run, **say so explicitly and name what was skipped.** Do not silently drop it.

**F66 is in this repository because two adapter classifiers looked correct, matched nothing against real terminal bytes, and would have shipped an entire recovery path as dead code.** Do not claim a runtime behaviour works because the code reads correctly.

## 13. Final report — required format

**Status:** one of `DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED`

Then:

1. **Files changed** — every path, created/edited marked.
2. **Build results** — typecheck, `npm test` with file and test counts **compared to YOUR measured baseline**, `grep:secrets`.
3. **Runtime results** — what you actually did and observed for each of the seven gates in §10. Not "verified" — say what you saw, and attach the evidence. **Include the two `since` values from gate 5.**
4. **The negative control** — state whether you ran it and what happened when the guard was inverted.
5. **Review outcomes** — `Task-4-1.md`'s Review Checklist, item by item, pass/fail.
6. **Non-goals confirmation** — explicitly confirm: `IpcChannel` still **86** with both assertions unmoved; `MIGRATIONS.length` still **19** (parsed); `sqliteTable(` still **18**; `turns.ts`, `turnsCore.ts` and `attentionRollup.ts` byte-identical; no `.vue` file touched; no adapter file touched; no new hook-body field read; no npm dependency; the §4 dirty files untouched.
7. **`classifiedHookEventNames()`** — paste the array it returns, and confirm it is identical to the 16 names it returned before your change, in the same order.
8. **Residual risks and findings** — anything Task 4-2 should own. **The highest finding in the roadmap is currently F67, so propose F68 or later**, and say why. If the reason grouping felt wrong for any event, say which and why — it is cheap to change now and expensive to change once a surface labels it.
9. **Final `git status --porcelain`**, with confirmation that only intended code paths were staged.

---

## END OF PROMPT BODY

---

## Coordinator notes (not part of the prompt)

- **Task 4-1 is first of four.** After it lands, generate the execution prompt for **Task 4-2 (the Attention Inbox)** — that is the task that moves `IpcChannel` 86 → 88, so its prompt must re-read the counter from the merged tree rather than inheriting 86 from here (G6/F54: this counter has collided four times).
- **The §4 dirty-tree list is a snapshot.** The eight Phase 4 documents and the roadmap edits were uncommitted at generation time. **If the coordinator commits them first, the list shrinks** — the next session should re-read `git status` rather than trusting it verbatim.
- **`roadmap.md` is modified in the tree and carries D145 and F67**, which this task depends on. That is why the prompt says *read it, do not commit it*.
- **No workflow kit exists in this repo** — no `.codex/workflows/subagents/`. `Phase-4a-ExecutionPrompt-4a-3.md` is the format precedent and the record of how the previous phase's final task was run.
- **The runtime gate needs a real permission prompt**, which means launching `claude` against a directory where a shell command is not pre-approved. If the executing session cannot manufacture one, gates 2 and 5 are the ones at risk — they should say so rather than substituting a `Notification` event. **(As executed: a real prompt WAS manufactured — `systeminfo | findstr …`, which Claude Code refuses to run unprompted. Note that substituting `Notification` would now prove even less than this warning assumed: it classifies to `permission` and, mid-block, is suppressed entirely rather than emitted.)**
