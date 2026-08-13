# Task 4a-3 — Wiring Resume Into Launch, Restore And Restart

_Phase 4a, task 3 of 4. **One narrated commit (G3).** **This is the task that fixes the reported problem.** After it, a reboot returns agents that remember the conversation. This task governs scope; `ImplementationSpecs/ImplementationSpec-4a-3.md` governs exact contents._

> **⛔ INHERITS TASK 4a-2'S COUNCIL GATE.** It consumes the interface D139 settles. Do not start before 4a-2 is merged.

## Source Of Truth

- `Tasks/Phase-4a-Overview.md` — §2, §3, **D139**, **D140**, **D142**; §7 (the one demonstration that matters).
- `Tasks/Task-4a-1.md` (the column), `Tasks/Task-4a-2.md` (the adapter contract).
- Roadmap §6 **D16** (the restore contract, and resolution (d): pane close deletes the row), **D33 / F26** (a credentialed session is never auto-restored), **D129** (nothing is interpolated for a hookless agent), **D130** (the hook listener's read surface does not widen).
- `src/main/services/sessionManager.ts` — `restore()` at **:272**, the relaunch `spawn` at **:346**, `attach()` at **:251**, `spawn()` at **:525**, the `buildLaunch` call at **:561**, `RESTORE_CAP = 16` at **:40**, `RESTORE_STAGGER_MS = 500` at **:36**, and the restart-is-a-new-conversation comment at **:665**.
- `src/main/services/restore.ts:31` — `computeRestoreSet`, whose `RestoreCandidate` is **structurally typed** and therefore already accepts a row carrying `agentSessionId`.
- `src/main/ipc.ts` — `SessionLaunch` at **:1144**, the two `randomUUID()` row creations at **:1373** and **:1474**, `SessionRestart` at **:1587**.

## Goal

Make a restored session **the same conversation**, not a new one with the same id — while leaving restart, credentialed sessions, and every existing D16 guard behaving exactly as they do today.

## The three moments

| Moment | Today | After this task |
|---|---|---|
| **Launch** (`ipc.ts:1144`) | spawn bare; the CLI names its own conversation and Chorus never learns the name | claude: mint a UUID, pass `assign`, persist it. codex: spawn bare, then **discover** the id and persist it (D140) |
| **Restore** (`sessionManager.ts:272`) | `spawn(row.agent, row.cwd, row.id)` — a genuinely fresh conversation | if the row has a pointer **and the conversation still exists on disk**, pass `reopen`; otherwise fall back to fresh, honestly |
| **Restart** (`ipc.ts:1587`) | fresh conversation, "Session restarted" badge | **unchanged in behaviour** — but must now explicitly `clearAgentSessionId` first, or D16 clause 4 silently inverts (D142) |

**The restart row is the one most likely to be got wrong by omission.** Doing nothing there means the next restore resumes a conversation the user deliberately abandoned.

## Exact Scope

| File | Change |
|---|---|
| `src/main/services/sessionManager.ts` | **Edit.** Mint-or-reopen in `spawn`/`launch`; the resume branch in `restore()`; the pre-flight existence check; `clearAgentSessionId` on the restart path. |
| `src/main/services/resumeCore.ts` | **Create.** The **pure** decision: given a row's pointer, the adapter's `idSource`, and a "does the conversation exist" boolean, return `assign` / `reopen` / `fresh`. No `fs`, no `electron`, no `better-sqlite3`, no clock. |
| `src/main/services/resumeCore.test.ts` | **Create.** The truth table, exhaustively. |
| `src/main/services/codexSessionDiscovery.ts` | **Create.** The impure half of D140's codex path: locate the rollout file this launch produced, read its `session_meta` header, return the id or `null`. |
| `src/main/services/codexSessionDiscovery.test.ts` | **Create.** Header parsing and the negative cases, against fixture text. |
| `src/main/ipc.ts` | **Edit.** `SessionRestart` clears the pointer before relaunching. |

Nothing else. **No new IPC channel — `IpcChannel` stays at 86.** No preload change, no renderer change, no schema change, no adapter change.

## The codex discovery problem, stated honestly

**This is the least certain part of the phase and the task must treat it that way.**

Codex has no `--session-id`, so Chorus cannot name the conversation and must find out what codex named it. Verified 2026-08-12 on codex-cli 0.147.0:

- **F57:** `~/.codex/session_index.jsonl` carries only `{id, thread_name, updated_at}` — **no cwd**. The index alone cannot answer "which session did I just start in this directory".
- The rollout file `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl` has a first line of `type: "session_meta"` carrying `session_id`, `cwd`, `originator`, `cli_version`, `source`. **This is the only verified discovery surface.**

Correlation is therefore **cwd + launch time**: after spawning, look for a rollout whose header `cwd` matches this session's cwd and whose header timestamp is at or after the moment Chorus spawned it.

**Known limitations, to be written into the code as comments, not discovered later:**

- A user running `codex` **outside** Chorus in the same directory at the same moment could be matched. The window is seconds and the mitigation is the timestamp, not certainty.
- **Two Chorus panes launching codex in the same cwd within the same second are genuinely ambiguous.** The honest response is to claim **neither** — a pointer that might belong to the other pane is worse than no pointer, because resuming the wrong conversation is a silent, confusing data-crossing rather than a visible absence.
- An `originator` override env var would make this exact, but **none is documented in `codex --help` and none was found**. If the implementer finds one, use it and record the finding; do not invent one.

**If discovery proves unreliable in practice, ship claude-only resume and record codex as a finding.** Half the feature working correctly beats all of it working sometimes.

## Non-Goals

- **⚠ NO TRANSCRIPT CONTENT IS READ, PARSED OR STORED — with exactly one bounded exception.** Codex discovery reads the **first line** of a rollout file to obtain `session_id` and `cwd`. Nothing else is read; no message content, no prompt, no tool call. Claude's path reads **no bytes at all** — only `existsSync` on a path. `contextUsage.ts` remains the only transcript *content* reader in the app, under its own rules, and this task adds no second one.
- **⚠ D33 / F26 IS NOT RELAXED.** A session launched on a stored credential is still healed to `exited` at restore (`sessionManager.ts:321`) and **never keyless-restored**. Resume changes nothing here: the objection was unattended decryption at boot, not loss of context. The heal message may mention that the conversation is preserved and will resume when relaunched from the dialog — **the refusal itself does not move.**
- **No auto-resume for an agent with no pointer.** A NULL `agent_session_id` means fresh, silently and correctly.
- **No picker, ever.** If the pointer exists but the conversation does not, launch **fresh** — never let `--resume` or `codex resume` fall through to an interactive picker inside a PTY, which would strand the pane in a TUI the user did not ask for. The pre-flight existence check exists precisely to prevent this.
- **No change to `RESTORE_CAP` (16) or `RESTORE_STAGGER_MS` (500).** Resume does not make restore cheaper or more urgent.
- **No change to the heal semantics** in `computeRestoreSet` (`restore.ts:31`) or its three inputs. The restore *set* is unchanged; only what happens to a member changes.
- **No change to `agentEvents.ts` or `agentEventsCore.ts`.** D130's read surface does not widen by one field. The transcript path Chorus already receives (`index.ts:384`) is a **tempting** second source for claude's id — **and it is not needed**, because claude's id is assigned, not discovered. Do not wire it.
- **No new IPC channel, no renderer file, no npm dependency.**
- **Do not revert, stage, or commit unrelated or untracked files** — see Overview §6.

## Dependencies

- **Task 4a-1** — the column and its accessors. Hard.
- **Task 4a-2** — the adapter contract and `idSource`. Hard.

## Test Expectations

`resumeCore.test.ts` — the pure truth table:

| pointer | `idSource` | conversation exists | → |
|---|---|---|---|
| NULL | assign-at-launch | — | `assign` (mint a fresh id) |
| NULL | discover-after-launch | — | `fresh` (then discover) |
| set | assign-at-launch | true | `reopen` |
| set | assign-at-launch | false | `assign` (mint anew — the transcript was deleted) |
| set | discover-after-launch | true | `reopen` |
| set | discover-after-launch | false | `fresh` (then discover) |

`codexSessionDiscovery.test.ts`, against fixture text:

- A well-formed `session_meta` header yields its `session_id`.
- A header whose `cwd` differs is **rejected** (returns null) — the cross-session guard.
- A header older than the spawn timestamp is **rejected**.
- **Two candidates matching equally → null**, not "the newest". Asserting the ambiguity rule is the point.
- Malformed JSON, a truncated first line, and a missing file all return `null` without throwing. Discovery may fail; it may never crash a launch.

## Verification Commands

```bash
npm run typecheck
npm test
npm run grep:secrets
```

## Acceptance Criteria

**G2 — driven on the real app, not reasoned. This is the phase's headline claim and it must be shown.**

1. `npm run typecheck` exits 0; `npm test` passes with no count regression; `npm run grep:secrets` clean.
2. `IpcChannel` is still **86** — the assertions at `ipc.test.ts:3438` and `:3816` pass untouched.
3. **Claude, the real thing:** launch a claude session, establish a fact only that conversation knows, **quit Chorus completely**, reopen. Ask for the fact. **It answers correctly.** Screenshot both sides.
4. **Codex, the real thing:** same demonstration. If discovery proves unreliable, this criterion converts to a recorded finding and codex ships without resume — **stated in the commit, not quietly dropped.**
5. **Restart still forgets (D142):** press restart on a resumed pane; the agent is amnesiac and the "Session restarted" badge shows. `SELECT agent_session_id` for that row is NULL immediately after, then non-NULL again once the new conversation is named.
6. **The deleted-transcript path:** delete a session's `.jsonl` out from under Chorus, restart the app, confirm the pane launches **fresh** with no error dialog and **no interactive picker**.
7. **A credentialed session still refuses to auto-restore** (D33/F26) — shown, not assumed.
8. Evidence under `_verify/4a-3/`.

## Review Checklist

- [ ] `IpcChannel` still 86; no new channel.
- [ ] `agentEvents.ts` and `agentEventsCore.ts` byte-identical to HEAD (D130).
- [ ] The only transcript read anywhere is codex discovery's **first line**; claude's path reads zero bytes.
- [ ] Pre-flight existence check runs before every `reopen`; no path can reach an interactive picker.
- [ ] `clearAgentSessionId` is called on the restart path (D142) — grep proves it.
- [ ] D33/F26's credentialed refusal is untouched.
- [ ] Ambiguous codex discovery claims **neither** candidate.
- [ ] Discovery failure is swallowed and logged, never propagated into a launch failure.
- [ ] `computeRestoreSet` and its three inputs unchanged.
- [ ] No pointer is ever logged alongside a cwd in a way that reconstructs a transcript path in the log.
