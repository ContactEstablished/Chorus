# Task 4-3 — Notification Policy + The In-App Centre

_Phase 4, task 3 of 4. **One narrated commit (G3).** The rules that decide what is worth interrupting for, and the in-app surface that receives the result. This task governs scope; `ImplementationSpecs/ImplementationSpec-4-3.md` governs exact contents._

> **⚠ THIS IS THE TASK THAT MAKES OS DELIVERY POSSIBLE WITHOUT DEPENDING ON IT.** Task 4-4 adds toasts and a tray badge that **obey this policy**. The policy therefore has to be right and testable **here**, on a machine where the toast half cannot be seen at all. If the rules only become observable in 4-4, this phase has learned nothing from `ToastEnabled=0`.

## Source Of Truth

- `Tasks/Phase-4-Overview.md` — §3, §5.
- `Tasks/Task-4-1.md` — the `reason` field; `Tasks/Task-4-2.md` — the Inbox, which this task must **not** duplicate.
- `docs/PLAN.md:200` — the policy, verbatim: *"always notify on waiting-for-user / waiting-for-permission / failed; notify on completion only if runtime > 2 min; never for the focused pane."*
- Roadmap §6 **D145** (no table — the centre is in-memory and says so), **D83** (no invented data).
- `src/main/services/attentionCore.ts:131` — `classify()`. **The tested answer to "is the user actually looking at this pane", and the one this task must reuse rather than re-derive.**
- `src/renderer/src/attention/reporter.ts:11–23` — three verified reasons `viewStore.focusedSessionId` is the **wrong** instrument for that question. Read this before writing the focus check.

## Initial Starting Point — verified at `00f0f0d`

| Location | State today |
|---|---|
| `notifications.ts:23` | `watchSessionExits(sessions)` — the **only** notification surface that exists; fires an OS toast on every exit, failure or not |
| `notifications.ts:11` | `AGENT_LABELS: Record<AgentKind, string>` — the exhaustive map that has caught two agent additions |
| `attentionCore.ts:131` | `classify(i): AttentionClass` — returns `'pane'` **only** when the window has OS focus, the user is not idle/locked, no overlay is open, and a terminal holds DOM focus |
| `attention.ts:105` | `AttentionTracker` — **no accessor exposes the attended session id** |
| `attention.ts:144` | `private report: AttentionReport \| null` — it is held, just not readable |
| `shared/ipc.ts` | `IpcChannel` = **88** after Task 4-2 |

**There is no policy module, no notification centre, and no notion of a notification other than "a session exited".**

## Goal

One pure module that decides whether a given event is worth interrupting a human for, and one in-app surface that lists what it decided. **The in-app centre is first-class** — on this machine it is the only delivery that works at all.

## Exact Scope

| File | Change |
|---|---|
| `src/main/services/notificationPolicyCore.ts` | **Create.** Pure. Inputs passed in, no clock, no Electron. |
| `src/main/services/notificationPolicyCore.test.ts` | **Create.** |
| `src/main/services/notificationCenter.ts` | **Create.** The in-memory store + the producer wiring. |
| `src/main/services/notificationCenter.test.ts` | **Create.** |
| `src/main/services/attention.ts` | **Edit.** One read accessor — `attendedSessionId()`. **No behaviour change.** |
| `src/shared/ipc.ts` | **Edit.** Three channels + schemas. **88 → 91.** |
| `src/shared/ipc.test.ts` | **Edit.** Both assertions → **91**. |
| `src/main/ipc.ts` / `src/main/index.ts` | **Edit.** Construct and wire. |
| `src/renderer/src/components/NotificationCenter.vue` | **Create.** |
| `src/renderer/src/App.vue` | **Edit.** Mount it; add to `anyOverlayOpen`. |

Nothing else. **No migration, no adapter file, no `agentEvents.ts` change, no npm dependency.**

## ⚠ PLAN.md's vocabulary and Task 4-1's do not line up 1:1 — here is the mapping, declared rather than absorbed

`docs/PLAN.md:200` was written before the `reason` field existed. Its four categories map onto the shipped vocabulary like this, and **the third row is an interpretation, not a transcription**:

| PLAN.md category | Shipped source | Rule |
|---|---|---|
| waiting-for-permission | `reason: 'permission'` | **always** |
| waiting-for-user | `reason: 'notice'` | **always** |
| completion | `reason: 'stopped'` | **only if the working stretch exceeded 2 minutes** |
| failed | session exit with a **non-zero, non-null** exit code | **always** |
| — | session exit, clean or null code | **never** |

**⚠ `stopped` IS "COMPLETION", AND READING IT AS "waiting-for-user" WOULD MAKE THE 2-MINUTE RULE DEAD CODE.** `Stop` fires when the agent finishes its turn — that is completion, and it is also the moment the human is needed. PLAN.md lists both categories, so one of them must be this event; if `stopped` were "waiting-for-user", nothing would ever reach the completion branch and a rule the product spec states would silently never run. **Recorded here because a spec that quietly diverges stops being a spec** — if this reading is wrong, it is wrong in a document rather than in an unexplained `if`.

**⚠ THE CLEAN-EXIT ROW IS NOT IN PLAN.md AND IS A DELIBERATE NARROWING OF WHAT SHIPS TODAY.** `notifications.ts:24` currently toasts **every** exit, including the ones the user caused by closing a pane. PLAN.md says "failed", not "exited". Task 4-4 is where the toast changes behaviour; this task's policy states the rule, and the narrowing must be called out in the commit rather than discovered as a missing notification.

## ⚠ "Never for the focused pane" — reuse the tested rule, do not write a new one

The naive implementation reads `viewStore.focusedSessionId`. **`reporter.ts:11–23` lists three verified reasons that is wrong**, and calls the result *"CONFIDENTLY WRONG and therefore worse than missing"*: it survives blur, minimize and process exit; **grid mode never updates it**; and it is never FK-checked and legitimately names a deleted session.

The right answer already exists and is already unit-tested: **`attentionCore.classify()` returns `'pane'` only when both halves agree** — main knows the window has OS keyboard focus, the renderer knows which terminal has DOM focus — *and* the user is not idle, not locked, and has no overlay open. That is precisely "the user is looking at this pane right now."

So `attention.ts` gains **one read accessor** that returns the attended session id by asking `classify()`, and the policy consumes it. **No new focus logic is written anywhere in this task.**

> **⚠ AND THE OVERLAY CLAUSE MAKES THIS SELF-CONSISTENT IN A WAY WORTH NOTICING:** with the Inbox open, `overlayOpen` is true, so `classify()` returns `'overhead'` and **no session is attended** — meaning notifications are not suppressed while the user is reading the Inbox. That is correct, and it falls out of reusing the rule rather than having to be special-cased.

## ⚠ The centre is in-memory, and the limit is named rather than hidden

D145 takes no table, so **the centre holds the current run's notifications and nothing survives a restart.** This is consistent with the rest of the spine — `agentEvents`' activity map evaporates by design, and the rail's exit instants are in-memory for the same reason.

**The UI must not imply otherwise.** No "history", no date grouping that suggests yesterday exists, no empty state reading "no notifications yet" when the truthful statement is "nothing since Chorus started". D83's rule applies to *implications* as much as to fields.

If a later phase wants durable notification history, `agent_turns` (v18) already holds every turn's start, end and outcome on disk with **no reader** — that is where it should come from, not from a second table.

## Non-Goals

- **No OS toast change, no tray, no badge.** Task 4-4. `notifications.ts` is **not edited in this task** — the policy exists first, then 4-4 makes the toast obey it.
- **No settings screen, no per-profile configuration, no persistence of policy.** Resolved with Matthew 2026-08-13: **hard-coded defaults, no UI.** The rules go in one pure module so the UI that configures them later has one thing to configure.
- **No duplication of the Inbox.** The Inbox lists what needs you **now**; the centre lists what **fired**. A row in the centre may name a session that is no longer waiting — that is the difference, not a bug.
- **No table, no migration.** `MIGRATIONS.length` stays **19**; `sqliteTable(` stays **18**.
- **No change to `agentEvents.ts`, `agentEventsCore.ts`, `attentionRollup.ts`, `attentionInboxCore.ts`, `turns.ts`.** This task is a **consumer** of all of them.
- **No behaviour change in `attention.ts`.** It gains a read accessor. If the diff shows a changed tick, a changed classification or a changed write, that is a scope violation — attention rows are a telemetry record whose meaning is pinned per row.
- **No sound.** PLAN.md lists optional per-event sounds; they are not in this task and adding one needs an asset decision.
- **Do not revert, stage, or commit unrelated or untracked files** — see Overview §7.

## Dependencies

**Task 4-1** (the `reason`) and **Task 4-2** (the `IpcChannel` figure this task starts from, and the overlay registration pattern).

## Test Expectations

Pure policy (`notificationPolicyCore.test.ts`) — a **table test**, the `turnsCore` / `classifyOutcome` shape:

1. Each of the five rows in the mapping table above, in both directions.
2. **The 2-minute boundary asserted on both sides** — 119 s does not notify, 121 s does. A threshold with only one test is a threshold that can be off by an order of magnitude and still pass.
3. **Focused-pane suppression beats every "always" row** — a permission request on the attended pane does **not** notify.
4. A **null** attended session suppresses nothing.
5. An exit with a **null** exit code does **not** notify. `attentionRollup.ts:143` records exactly why: all five `restore()` heal paths write `('exited', row.exitCode ?? null)`, so `null !== 0` lit three of four projects red on a cold start with nothing crashed. **The identical trap applies here and would produce a burst of false failure notifications on every boot.**

Centre (`notificationCenter.test.ts`):

6. The ring is capped and drops **oldest first**.
7. `clear()` empties it and pushes once.
8. A suppressed event **adds nothing** — suppression means "no notification", not "a hidden one".

Shared: `IpcChannel` is **91**, asserted in both places.

**No test count regression.**

## Verification Commands

```bash
npm run typecheck          # 0, node + web
npm test                   # no regression
npm run grep:secrets       # clean
grep -n "toHaveLength(91)" src/shared/ipc.test.ts   # BOTH sites
git diff --stat src/main/services/notifications.ts  # EMPTY — 4-4 owns this file
```

## Acceptance Criteria

1. Typecheck 0; tests green, no regression; secret-grep clean.
2. `IpcChannel` is **91**, both assertions agree, starting figure re-read from the merged tree (G6/F54).
3. `MIGRATIONS.length` still **19**; `sqliteTable(` still **18**.
4. `src/main/services/notifications.ts` is **byte-identical**.
5. **Runtime:** a `claude` pane driven to a permission prompt **while a different pane holds focus** produces a centre entry. The **same event on the focused pane** produces none. Both captured.
6. **Runtime:** a turn completing after **under** two minutes produces no entry; one after **over** two minutes does.
7. **Runtime:** a session killed with a non-zero code produces a failure entry; a pane closed cleanly produces **none** (the declared narrowing).
8. **Runtime, the boot case:** start the app with pre-existing `exited` rows carrying **null** exit codes. **Zero** notifications. This is the `attentionRollup.ts:143` trap and it must be driven, not reasoned about.
9. The centre states plainly that it covers this run only.

Evidence under `_verify/4-3/`.

## Review Checklist

- [ ] The focus check goes through `attentionCore.classify()`; **no new focus logic**, and `focusedSessionId` appears nowhere in the diff.
- [ ] `attention.ts`'s diff is a **read accessor only** — no tick, classification or write changed.
- [ ] The 2-minute threshold is a named constant with tests on both sides.
- [ ] Null exit codes notify nothing.
- [ ] The PLAN.md mapping table is reproduced in the module's header, including the declared `stopped`-is-completion reading.
- [ ] `notifications.ts` untouched; no tray, no toast.
- [ ] The centre's UI makes no claim of surviving a restart.
- [ ] `IpcChannel` re-read from the merged tree; both assertions updated.
- [ ] Zod in main only; payloads plain objects (D14).
- [ ] No migration, no new table, no npm dependency.
