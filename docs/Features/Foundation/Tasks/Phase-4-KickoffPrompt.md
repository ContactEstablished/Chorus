# Phase 4 — Notifications: Kickoff Prompt

_Generated 2026-08-13 against `main` at `b0de7b7`. Paste the body below into a **fresh** conversation._

> **⚠ THIS IS A PHASE KICKOFF, NOT A TASK EXECUTION PROMPT.** Phase 4 has **never been decomposed** — there are no `Task-4-*.md` docs and no implementation specs. The new session's job is to settle one scope question, then produce the task documents. It is **not** to start writing feature code.
>
> **⚠ AND THE SCOPE QUESTION IS REAL, NOT CEREMONIAL.** The roadmap defers the `agent_events` bus "until a consumer exists". Consumers arrived while nobody was looking, and were served by something else. Decomposing before settling that is how a phase builds a table nobody needs.

---

## PROMPT BODY — copy everything below this line

---

You are the **Coordinator** for Chorus **Phase 4 — Notifications**. Your job this session is to **kick the phase off**: verify the ground, settle the one open scope question, and produce the phase's task documents. **Do not implement feature code this session.**

Repository root: `C:\Projects\ContactEstablished\Chorus`
Expected branch: **`main`** — confirm with `git branch --show-current`. **Do not switch or create a branch without instruction.**
Expected HEAD at start: `b0de7b7` ("Stop apologising for conversations that never existed"). If HEAD differs, re-verify every fact below before relying on it.

## 1. Read these first

- `CLAUDE.md` — locked architecture. Sessions live in main; all IPC is Zod-validated **in main only**; no new dependencies without asking.
- `docs/Features/Foundation/roadmap.md` — **§5** (verified ground facts, most recent block first), **§6** decisions **D39**, **D45(1)**, **D78**, **D129**, **D130**, **D134**, and **§7 Phase 4**. Also findings **F55**, **F56**, **F59**.
- `docs/PLAN.md` — the product shape.
- The Phase 4a documents (`Tasks/Phase-4a-Overview.md`, `Tasks/Task-4a-*.md`) are the **format precedent** for what you are about to write, and `Tasks/Phase-4a-ExecutionPrompt-4a-3.md` is the precedent for the execution prompts that follow.

## 2. What already exists — verify each before building on it

The Phase 4 **spine landed early and out of order** (2026-08-07, D129/D130), built for one consumer — the filmstrip activity lights — and deliberately no further.

| Path | What |
|---|---|
| `src/main/services/agentEvents.ts` (343 lines) | the localhost hook listener, per-session capability tokens |
| `src/main/services/agentEventsCore.ts` (194 lines) | its pure classification core, unit-tested |
| `src/main/services/attentionRollup.ts` (164 lines) | the project-rail rollup (added 2026-08-09, `adbf0e9`) |
| `src/main/services/notifications.ts` (45 lines) | the OS exit toast — **the only notification surface that exists** |
| `src/main/adapters/claude.ts:123` | `hooks: { mode: 'static', mechanism: 'http_listener' }` — the ONLY adapter with a non-null hooks descriptor |
| `src/main/adapters/codex.ts:105`, `kimi.ts:113`, `opencode.ts:148` | `hooks: null` — three-state agents, asserted per adapter in `adapters.test.ts` |
| `src/shared/ipc.ts:43,47,50,54` | `session:activity`, `session:activity-list`, `project:attention`, `project:attention-list` |

**Not built, and not started:** notification policies, toast → focus-pane, tray badge, notification centre, Attention Inbox, per-session event timeline, D39 sub-agent awareness. **There is no `agent_events` table.**

## 3. ⚠ THE SCOPE QUESTION — SETTLE THIS BEFORE DECOMPOSING ANYTHING

The roadmap says the append-only `agent_events` bus "stays this phase's to add **when a consumer exists**" — events are in memory only, because "an append-only bus with a migration behind it is a schema commitment made for nobody."

**Consumers have since arrived, and were served by something else.** `turns.ts` / `turnsCore.ts`, `contextUsage.ts` and `attentionRollup.ts` all consume the hook spine today, and **Task 8-0 answered the history need with a narrower `agent_turns` table at migration v18** — not with the bus.

So the question the phase must answer **first**:

> **Is the `agent_events` bus still wanted, or has `agent_turns` made it unnecessary?**

Answer it explicitly, with evidence, and record it as a numbered decision (**next free is D145** — verify with BOTH patterns, per the roadmap's own note: grep the table column `^| D<n>` *and* inline `**D<n>` references, and check uncommitted edits). Do not decompose the phase until it is settled: a notification centre backed by an in-memory ring and one backed by an append-only table are different phases.

## 4. Constraints that must survive decomposition

- **⚠ OS TOASTS ARE PROVEN DEAD ON THIS MACHINE, SO THE IN-APP CENTRE IS FIRST-CLASS, NOT A FALLBACK.** `ToastEnabled=0` at the registry level; every exit toast fires and fails with `HRESULT: -2143420140`. This is not a hypothetical: Task 4a-3 used that exact failure as an instrument, because `notifications.ts` logs `[notify] toast shown` / `toast failed` whether or not anything appears. **A phase whose headline feature is invisible on the developer's own machine has to be designed around that from the first task, not patched at the end.**
- **ONE PRODUCER, NOT FOUR.** Only `claude` emits hook events. Any design that assumes four producers is wrong today; widening is a **decision**, not a matcher change.
- **D130 — the hook listener's read surface does not widen** without an explicit decision. It has held through two phases; if Phase 4 needs more of the hook body, that is a decision with a security argument, not an implementation detail.
- **D45(1) — one emit path.** Anything that consumes session text hangs off the single `SessionOutput` emit, never a second tap on raw PTY bytes. (F26 is the finding that exists because this was once got wrong.)
- **All IPC Zod-validated in main only** — never in preload (it throws `EvalError` under CSP and silently drops events).
- **No new npm dependency** without asking.

## 5. Facts to re-verify yourself (do not inherit these)

Measured at `b0de7b7`; confirm each and report any that moved:

| Fact | Value |
|---|---|
| `IpcChannel` | **86** — asserted twice in `src/shared/ipc.test.ts` (3438, 3816) |
| `MIGRATIONS.length` | **19**, next free **v20** — ⚠ **PARSE the array, never grep it**: the SQL contains backticks and a naive count returns 171 |
| `sqliteTable(` | **18** |
| vitest | **1977 passed / 1977 across 58 files** |
| typecheck | **0 errors** (node + web) |
| Highest decision | **D144** |
| Highest finding | **F66** |

**G6 applies to any migration this phase takes:** check every sibling branch and worktree, and the dev DB's own `SELECT MAX(version)`, before claiming a version. Dev worktrees share one DB, so a version claimed on another branch makes yours silently no-op.

## 6. Findings this phase inherits

- **F55 / F56** — a "turn" counts **agent activity, not user prompts**, and **tool-call counts are structurally unobservable** from the edge-triggered listener (`agentEvents.ts:169` returns early when activity is unchanged, which is load-bearing for two other things and must not be removed to get a count). Any timeline or inbox that wants turn SIZE rather than turn DURATION inherits this, and needs its own decision.
- **F59** — history replays only for sessions `restore()` actually relaunches, so a session healed to `exited` shows an **empty pane beside a complete mirror on disk**. Phase 4a made this more visible, not less: resume raised the expectation that a returning pane knows things. **Not this phase's to fix**, but an Attention Inbox that lists such sessions should not make it worse.
- **D78** — amber has no source; it was parked here when D129 chose the hook listener over deriving amber from PTY-output silence.

## 7. What to produce this session

1. **Ground** — read the documents above, verify §5's facts against the code, and inspect the spine files. Report anything that moved.
2. **Settle §3's scope question**, with evidence, as a numbered decision.
3. **Run `/phase-kickoff`** to author `Tasks/Phase-4-Overview.md` plus **1–5** `Task-4-N.md` files, each paired with an `ImplementationSpecs/ImplementationSpec-4-N.md`. Sequence them so **the in-app notification centre comes before anything that depends on OS delivery**.
4. **Do not write feature code.** No migration, no channel, no renderer file this session.
5. Report: what you verified, what moved, the decision you recorded and why, and the task list with its ordering rationale.

## 8. Verification commands

```bash
git branch --show-current      # expect: main
git log -1 --format="%H %s"    # expect: b0de7b7 …
git status --porcelain
npm run typecheck              # expect 0 errors
npm test                       # expect 1977 / 58
npm run grep:secrets           # expect clean
grep -n "toHaveLength(86)" src/shared/ipc.test.ts   # expect 3438 and 3816
```

## 9. Failure honesty clause

If any command fails — including for an unrelated environment reason (a native-module ABI mismatch, a locked database, a missing CLI) — **capture the exact output, say what you believe caused it, and do not claim success.** If you cannot verify a fact in §5, say which one and why, rather than passing it through.

---

## END OF PROMPT BODY

---

## Coordinator notes (not part of the prompt)

- **The working tree is dirty and none of it belongs to Phase 4.** `docs/Features/Foundation/roadmap.md` and `docs/Plan.md` carry the Phase 4a closure, findings F64–F66, and decision D144; several untracked docs belong to Phase 5 planning. The new session should read `git status` rather than trusting this list.
- **Phase 4a closed on 2026-08-13** across four commits (`bbf6d32`, `a6fab79`, `9e3c83d`, `756066c`), plus `50662e6` (F64 — codex discovery) and `b0de7b7` (F65). Session continuity now works for **both** agents.
- **Still open from 4a, and not Phase 4's:** **F63** (two `ResumeFailureReason` members with no producer, neither produced nor reserved) and **F59** (above).
- **A release is arguably owed before this phase.** Session continuity is the fix for the user's original complaint and currently exists only in the dev tree; the installed Chorus does not have it.
