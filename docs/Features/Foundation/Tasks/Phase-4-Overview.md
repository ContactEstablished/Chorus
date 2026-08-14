# Phase 4 — Notifications: Overview

_Decomposed 2026-08-13 against `main` at `00f0f0d` (v0.5.0). Four tasks. The spine landed early and out of order in 2026-08-07 (D129/D130); this phase builds the surfaces on top of it._

> **⚠ THIS PHASE'S HEADLINE FEATURE IS INVISIBLE ON THE DEVELOPER'S OWN MACHINE, AND THE TASK ORDER IS THE ANSWER TO THAT.** `ToastEnabled=0` at the registry level on this machine; every OS toast fires and fails with `HRESULT: -2143420140`. The in-app surfaces are therefore **first-class and first**, and OS delivery is **last** — not because it matters least, but because it is the only half that cannot be verified by looking at it.

---

## 1. What already exists — the spine, and its four consumers

The Phase 4 spine was built for one consumer and deliberately no further. Verified at `00f0f0d`:

| Path | Lines | What |
|---|---|---|
| `src/main/services/agentEvents.ts` | 343 | the localhost hook listener, per-session capability tokens |
| `src/main/services/agentEventsCore.ts` | 194 | its pure classification core, unit-tested |
| `src/main/services/attentionRollup.ts` | 164 | the project-rail roll-up (`adbf0e9`, 2026-08-09) |
| `src/main/services/notifications.ts` | 45 | the OS exit toast — **the only notification surface that exists** |
| `src/main/adapters/claude.ts:123` | — | `hooks: { mode: 'static', mechanism: 'http_listener' }` — the only non-null hooks descriptor |
| `src/main/adapters/codex.ts:105`, `kimi.ts:113`, `opencode.ts:148` | — | `hooks: null` — three-state agents, asserted per adapter in `adapters.test.ts` |

**The four consumers of the spine, all verified this pass:**

| Consumer | Where | Reads |
|---|---|---|
| the filmstrip broadcast | `ipc.ts:4000` | `onActivity` |
| the project-rail roll-up | `ipc.ts:4046` | `recordFor` |
| the turn recorder (v18) | `turns.ts:81` | `onActivity` |
| the context ring (v16) | `index.ts:413` | `onTranscriptPath` |

**Not one of them reads history.** That fact is what settles the phase's scope question — see §2.

**Not built, and not started:** notification policies, toast → focus-pane, tray badge, notification centre, Attention Inbox, per-session event timeline, D39 sub-agent awareness.

---

## 2. The scope question, settled — D145

The roadmap deferred the append-only `agent_events` bus *"until a consumer exists"*. **It stays unbuilt, and `agent_turns` is not the reason.** The full argument is **D145**; the four facts it rests on, each measured this pass:

1. **There is no in-memory ring, so "ring versus table" was a false choice.** `agentEvents.ts` holds a `Map<sessionId, {activity, since}>` of **exactly one record per live session** (`:150`), and `revoke()` **deletes** it on every exit path (`:296`). Nothing in this app retains a second event.
2. **`agent_turns` has no reader either.** `readAgentTurns` (`storage.ts:2292`) is grep-proven to have **zero callers outside `storage.ts`**. v18 built the recorder and left the reader to Phase 8. History has no consumer in *either* store.
3. **A bus would carry event NAMES; the mock draws event BODIES.** `docs/design/v2/Chorus Attention Inbox.dc.html` renders the tool name, the tool input, the agent's own message and the prompt's numbered options — **every one a hook-body field `readHookEventName` refuses to take** (D130). An `agent_events` table would be built, migrated, and still leave the Inbox undrawable.
4. **What is actually missing is the REASON on the current state, not the history.** `docs/PLAN.md:184` names **two** states — `waiting-for-user` and `waiting-for-permission` — and `classifyHookEvent` collapses **six** events into one undifferentiated `needs-you`. That is a retention change to a value derived from a field already read. **It is Task 4-1.**

**Deferred with the bus, and named rather than dropped:** the per-session event timeline sidebar (D130-blocked, exactly as the Inbox preview is) and D39's sub-agent awareness (**F67** — `SubagentStart`/`SubagentStop` both classify `working`, so the edge trigger swallows them, and a table fed from `onActivity` would inherit the same blindness).

---

## 3. What the Inbox shows, and what it does not

**Resolved with Matthew 2026-08-13.** The Inbox renders **metadata and an age**: agent, project, reason, waiting-for. `j`/`k` navigates; `Enter` focuses the real pane. **There is no preview text and no inline answer.**

This is D83 applied as D83 states it — *"the answer to 'the mock draws data that does not exist' is omit it OR give it a source, never fake it."* The preview was considered and **is not omitted for lack of a source**: the pane's own post-scrub ring buffer (`sessionManager.ts:43`, 4,000,000 chars) holds the prompt text and `session:write` already exists, so a preview needs **no D130 widening at all**. It is omitted because **F58 measured those buffers to be TUI repaint streams, not transcripts** — 44,958 non-blank lines with 14 unique, 3,211× duplication on one file; 21/13 and 100% chrome on another. A preview built on that is unproven, and answering a prompt you cannot see is worse than not offering to.

**If a later phase wants the preview, it needs a measured spike first, and it does not need the bus.**

---

## 4. The tasks

| # | Task | Ships | Depends on |
|---|---|---|---|
| **4-1** | The reason on the live record | `NeedsYouReason` on the activity record and its wire schema. No new channel. | None |
| **4-2** | The Attention Inbox | Cross-project ordered queue of waiting sessions; `j`/`k`/`Enter`/`Esc`. Two new channels. | 4-1 |
| **4-3** | Notification policy + the in-app centre | Pure policy module (PLAN.md:200's defaults, no UI) and the in-app notification centre it feeds. | 4-1, 4-2 |
| **4-4** | OS delivery: toast → focus-pane + tray badge | The exit toast learns to focus the exact pane; the tray gains a count. | 4-3 |

**Ordering rationale.** 4-1 is the fact every later surface needs and the only one that touches the spine — it lands alone so a revert is cheap. 4-2 is the headline in-app surface and is fully verifiable on this machine. 4-3 needs 4-2's ranking rule and gives 4-4 something to obey. 4-4 is last because **half of it cannot be seen here** and specifying an unverifiable surface first is how a phase ends with a feature nobody has watched work.

---

## 5. Constraints that survive decomposition

- **ONE PRODUCER, NOT FOUR.** Only `claude` emits hook events; `codex`, `kimi` and `opencode` carry `hooks: null` and are asserted so per adapter in `adapters.test.ts`. **Every surface in this phase must be correct and quiet for a session that will never report activity** — a three-state agent must not appear in the Inbox as permanently calm-and-unknown, nor be silently excluded from exit notifications, which it *does* produce. Widening to a second producer is a decision, not a matcher change.
- **D130 — the hook listener's read surface does not widen.** It has held through two phases. Task 4-1 changes what is **retained** from a field already read; it does not read a new field. Any task that wants more of the hook body has left this phase.
- **D45(1) — one emit path.** Anything consuming session text hangs off the single `SessionOutput` emit, never a second tap on raw PTY bytes (F26 exists because this was once got wrong). No task in this phase should need session text at all — if one does, that is a scope violation, not a design.
- **All IPC Zod-validated in MAIN only** — never in preload, where it throws `EvalError` under CSP and silently drops events.
- **D14 — IPC payloads crossing the bridge must be plain objects.** Snapshot before sending; a Pinia/reactive value fails structured clone at runtime with no compile-time signal.
- **No new npm dependency** without asking.
- **G6 on the `IpcChannel` counter.** It is **86** at `00f0f0d`, asserted twice in `src/shared/ipc.test.ts` (lines **3438** and **3816**). Task 4-2 moves it. **F54 records this counter colliding four times across parallel branches** — re-read it against the merged tree at the moment of writing, and update **both** assertions.
- **No migration is expected anywhere in this phase.** `MIGRATIONS.length` is **19** and should still be 19 at phase close. If a task believes it needs v20, that is a scope question to raise, not a migration to take — and G6 applies in full if it is ever answered yes.

---

## 6. Ground facts, verified at `00f0f0d`

| Fact | Value | How it was checked |
|---|---|---|
| `IpcChannel` | **86** | asserted twice in `src/shared/ipc.test.ts` (3438, 3816); suite green |
| `MIGRATIONS.length` | **19**, next free **v20** | **PARSED via the TypeScript AST**, not grepped |
| `sqliteTable(` | **18** | `schema.ts` only; the 19th grep hit is a comment in `ipc.ts:387` |
| vitest | **1977 passed / 1977 across 58 files** | `npm test`, exit 0 |
| typecheck | **0 errors** (node + web) | `npm run typecheck`, exit 0 |
| secret-grep | clean, 6 patterns | `npm run grep:secrets` |
| Highest decision | **D145** (this phase's, added 2026-08-13) | was D144 |
| Highest finding | **F67** (this phase's, added 2026-08-13) | was F66 |

> **⚠ THE MIGRATION COUNT MUST BE PARSED, NEVER GREPPED, AND THE TRAP WAS REPRODUCED THIS PASS RATHER THAN RECALLED.** A naive backtick count of the `MIGRATIONS` array at `storage.ts:171` returns **171**, because the **comments between the elements contain backticks** (e.g. `` `title: text('title')` `` at `:196`). The AST parse returns **19**. Fifth consecutive pass in which G6 was executed rather than remembered.

**G6 was run on the migration counter in both halves**, even though no task expects to take a version: every sibling branch and the live worktree parsed to **19 / 18 / 17 / 15 / 15 / 12 / 12 / 4** — `main` is the highest and **none claims v20** — and the dev DB's own `SELECT MAX(version)` read **18** while the installed app's read **19**. *(The dev DB is one behind because v19 landed after it was last opened; the installed app has it. Neither contradicts `MIGRATIONS.length`.)*

**HEAD moved between the kickoff prompt and this decomposition.** The prompt expected `b0de7b7`; HEAD is `00f0f0d`, *"Release version 0.5.0 so session continuity is installable"* — the release the prompt's own coordinator notes said was arguably owed. Every fact above was re-measured at `00f0f0d`; none moved except the decision and finding ceilings, which this session raised itself.

---

## 7. The dirty tree — do not revert, do not commit

`git status` at decomposition time. **None of this is Phase 4's, and no task may stage, revert or commit any of it:**

```
 M docs/Features/Foundation/roadmap.md        <- Phase 4a closure, F64-F67, D144-D145
 M docs/Plan.md
?? CLAUDE-PROJECT-MARKER.txt
?? docs/Features/Foundation/Investigations/Voice-Input-Feature-Requirements-source.md
?? docs/Features/Foundation/Phase-5-VoicePlan.md
?? docs/Features/Foundation/Tasks/Phase-4-KickoffPrompt.md
?? docs/Features/Foundation/Tasks/Phase-4a-ExecutionPrompt-4a-3.md
?? docs/Features/Voice Input/
```

Read `git status` yourself rather than trusting this list — it is a snapshot.

---

## 8. Findings this phase inherits

- **F55 / F56** — a "turn" counts **agent activity, not user prompts**, and **tool-call counts are structurally unobservable** from the edge-triggered listener. Any surface quoting turn counts owes the distinction. `agentEvents.ts:169`'s early return is load-bearing for three separate things and **must not be removed to get a count.**
- **F67** *(new, this session)* — D39's sub-agent count is unobservable for the same structural reason, and an `agent_events` table fed from `onActivity` would inherit the blindness. Deferred with the bus by D145.
- **F59** — history replays only for sessions `restore()` actually relaunches, so a session healed to `exited` shows an **empty pane beside a complete mirror on disk**. **Not this phase's to fix**, but the Inbox must not make it worse: an exited session is not a waiting one and must not be ranked as if it were.
- **F64 (RESOLVED `50662e6`) / F65 (RESOLVED `b0de7b7`)** — codex resume and the spurious "context was not restored" line. Both closed; listed so a reader does not re-open them.
- **F63** — two `ResumeFailureReason` members with no producer, neither produced nor reserved. Still open, still not this phase's.
- **D78** — amber has no source; parked here when D129 chose the hook listener over deriving amber from PTY silence. **Task 4-1 is what finally gives amber a *reason* as well as a source.**

---

## 9. Phase-close gate

At the last task's commit, re-measure and record in roadmap §5:

```bash
npm run typecheck        # 0 errors, node + web
npm test                 # no regression against 1977 / 58
npm run grep:secrets     # clean
grep -n "toHaveLength(" src/shared/ipc.test.ts   # both assertions agree with IpcChannel
```

Plus: `MIGRATIONS.length` still **19**, `sqliteTable(` still **18**, and the `IpcChannel` figure **parsed from the merged tree**, not carried forward from this document.
