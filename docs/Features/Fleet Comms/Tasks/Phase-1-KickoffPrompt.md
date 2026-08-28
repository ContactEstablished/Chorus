# Fleet Comms Phase 1 — kickoff prompt for a fresh session

_Written 2026-08-27. Paste the body below into a NEW conversation. It is self-contained: it assumes no memory of the session that produced it._

> **✅ AMENDED 2026-08-27 — THE TASK DOCS NOW EXIST.** When this was written, Fleet Comms had a spec
> and a roadmap entry but no task decomposition, so the instruction below was to run
> `/phase-kickoff` first. That has since been done: `Phase-1-Overview.md`, `Task-1-1` … `Task-1-4`
> and their `ImplementationSpec-1-#.md` pairs are all written, and every code citation in them was
> verified against the tree at `07708c8`. **Read them instead of re-deriving the split** — and note
> that the kickoff resolved two decisions, recorded in the Overview §3.

---

## Prompt body — copy from here

You are the Coordinator for **Chorus — Fleet Comms, Phase 1 (peer awareness and the honest chip)**.

Repository root: `C:\Projects\ContactEstablished\.chorus\Chorus\wt-e27d8654` (a git worktree —
run everything from here, never `cd` to `C:\Projects\ContactEstablished\Chorus`).
Expected branch: **`chorus/Chorus/e27d8654`**. Confirm it; do not switch without instruction.

### Start from the task docs — they already exist

Read `docs/Features/Fleet Comms/Tasks/Phase-1-Overview.md` first. It carries the phase contract, the
verified ground facts, the two decisions resolved at kickoff, the four-task split, the phase-wide
non-goals, and five gates (G-A … G-E) every task inherits.

Then work the tasks **in order** — each has a paired implementation spec that goes deeper:

| Task | Owns | Depends on |
| --- | --- | --- |
| `Task-1-1.md` | the pure decision core (`fleetRegistryCore.ts`) | None |
| `Task-1-2.md` | the service, `procStart` liveness, migration `v23`, the §8.2 log | 1-1 |
| `Task-1-3.md` | one IPC channel and the pane address chip | 1-2 |
| `Task-1-4.md` | the fleet roster — **droppable if the phase runs long** | 1-3 |

⚠ **Re-verify the line numbers before you rely on them.** They were true at `07708c8`; if anything
landed since, the docs' Initial Starting Point sections are stale and fixing them is your first
edit, not a footnote.

### Ground yourself before editing anything

Read, in this order:

1. `docs/Features/Fleet Comms/chorus-fleet-comms-spec.md` — **authoritative on design**, 907 lines.
   §4 is measured ground facts; **§6.1 is the addressing rule and is binding**; §7.1–7.2 are this
   phase's UI; §8 is where the data comes from; §10 phases the work; §14 records what a council
   ruled and where the spec deliberately departs from it.
2. `docs/Features/Foundation/roadmap.md` — **§6 decision D182** (the Fleet Comms decision) and
   **§7 Phase 9** (placement, dependencies, verified code facts, and Phase 0's landing evidence).
3. The council findings, for the reasoning behind the rulings, not for instructions:
   `docs/Features/Fleet Comms/CouncilBrief-FleetComms-1.0-AddressAndVisibility-Findings.md`.
   ⚠ Its action items 13–15 contain **two ground-fact errors** that the spec corrects — see
   §14 "Where this spec departs from the findings". Trust the spec over the findings.

Then read the Phase 0 code this phase builds on (`git show 3aa57a4` is the whole of it):

- `src/main/adapters/types.ts:496` — `PtyLaunchSpec.sessionName`, with the comment explaining why
  it is read from storage rather than threaded through `LaunchOptions`.
- `src/main/services/sessionManager.ts:872` — `sessionName: this.storage?.getSessionById(...)`.
- `src/shared/agentNames.ts:110` — `toPeerAddress`, the argv sanitiser.
- `src/main/index.ts:651` — `agentEvents.onTranscriptPath`, the join key this phase must record
  against.
- `src/main/services/storage.ts:1777` — `getSessionById`.

Run `git log --oneline -8`, `git status --porcelain`, and `git branch --show-current` before you
start.

### Pre-existing changes — do not touch

`.mcp.json` is **modified in the working tree** and is unrelated to this work (a local Neo4j port
override). **Do not revert, stage, or commit it.** If `git status` shows anything else modified,
stop and ask rather than assuming it is yours.

### What Phase 1 is

From the spec §10 and roadmap Phase 9:

> Registry reader with schema validation and tolerant reads (missing file, invalid JSON, torn write
> → `unknown`, never a stale address). Liveness by pid **and** start-time comparison against
> `procStart`. Protocol gate on `peerProtocol`. The `sessionId` join. Record
> `messagingSocketPath` → `sessionId` on every poll, for Phase 2's sender join. The pane address
> chip with its three states. Fleet roster. Log registry-vs-heuristic status disagreements for
> claude panes.

### Decisions that bind you — all RESOLVED, quoted rather than summarised

**D182 (SETTLED 2026-08-27), the addressing rule — spec §6.1.** Chorus persists pane identity, the
claude `sessionId`, and `requestedName`. **It does not persist, key, index, or treat as
authoritative the registry `name`.** It **never re-asserts a name** — no registry writes, no
relaunch to reclaim, no typed rename. The live registry name is the only string shown as currently
routable; drift renders as a **sticky** state, not a one-poll badge.

**Three address states, not six:** `verified`, `changed`, `unknown`. Cause (collision vs AI title)
is an **enrichment where evidence exists, never a state**, because a measured collision wrote
`nameSource: "derived"` — indistinguishable from a session that never asked for a name.

**Socket prohibition, permanent and not revisitable (spec §7.4):** never open
`messagingSocketPath`, never read a `.key` file, never send peer-protocol bytes. *Reading the
socket path string out of a registry file or a message record is not opening it and is required by
Phase 2's join.*

**No composer in Phases 0–3.**

### Traps that already cost this project time

1. **`LaunchOptions` is empty on restore and `session:restart`.** Anything that must survive an app
   restart cannot ride on it. Phase 0 hit this; `LaunchOptions.permissionMode`'s own comment
   records the same trap from earlier. If Phase 1 adds per-launch data, check this first.
2. **A registry file outlives a hard-killed process.** Liveness is a pid check **plus** a
   `procStart` comparison. **Verify the Windows mechanism for reading a process's true start time
   against the platform rather than assuming an API or timestamp format** — the roadmap flags this
   as unverified on purpose.
3. **The socket hash is not derivable from the `sessionId`** (md5/sha256 variants tested, none
   match). The `messagingSocketPath` → `sessionId` mapping must be **observed and recorded during
   the poll**, or Phase 2's sender join is impossible for any session that has since exited.
4. **`queue-operation` / `enqueue` is not a message filter** — it is the generic "something entered
   this turn" record. Phase 2 needs the `<cross-session-message>` content as the filter. Not this
   phase's code, but do not build an index schema that assumes otherwise.
5. **This worktree has no `node_modules`.** Junction the main checkout's in to run the gates, and
   remove it afterwards:
   `New-Item -ItemType Junction -Path node_modules -Target "C:\Projects\ContactEstablished\Chorus\node_modules"`
6. **`roadmap.md` contains a lone CR byte** inside a documented literal. Edit it byte-wise (read as
   a Buffer, splice, assert the CR count is unchanged); a text-mode round-trip splits that line and
   produces a thousands-of-lines phantom diff.

### Strict non-goals

- No message composer, and no writing to `messagingSocketPath` or reading `.key` files — ever.
- No timeline, no transcript tailing, no message index (Phase 2).
- No broadcast (Phase 3).
- No unread counts, notifications, presence pings, or ambient placement anywhere.
- No attempt to make codex, opencode, kimi or grok addressable — they are in no registry. A
  non-claude pane renders as *not addressable*, which is a fact about the agent, not a failure.
- No claim that the roster is complete: the fleet is larger than Chorus in both directions.

### Verification

Run from the repo root, after junctioning `node_modules`:

```
npm run typecheck        # expect 0 errors, node and web
npx vitest run           # expect 82+ files, 3015+ tests, ALL passing
npm run grep:secrets     # expect: clean, 6 patterns
```

**Runtime gate — run it, do not merely compile it.** `npm run dev -- --remote-debugging-port=9333`,
then confirm against the live app: a claude pane shows its current address; a pane whose address
was taken by another session shows `changed` with both names **and keeps showing it** rather than
flashing once; a killed session leaves the roster rather than lingering on its leaked registry
file; an unreadable registry renders `unknown`, never the last good name; a non-claude pane reads
*not addressable*.

⚠ **The installed Chorus at `%LOCALAPPDATA%\Programs\Chorus` is the user's real instance and is
usually running with live agent sessions. Never kill Electron or Chorus by process name.** Identify
the dev app by its command line (`*9333*`) and kill only that tree. Verify the installed one is
still alive afterwards.

### Failure honesty

If a verification command fails for an unrelated environment reason, **capture the exact output,
explain it, and do not claim success.** Establish whether a failure pre-exists your change by
stashing your work and re-running — and if you stash, tag it (`git stash push -u -m "<unique>"`),
capture the SHA immediately, restore with `git stash apply <sha>`, and check what came back. The
stash stack is shared with every other worktree on this machine.

### Reporting

Finish with: **status** (DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED), files changed,
typecheck + vitest + grep results as actually observed, **what you observed in the running app**
(not what you expect it would do), non-goals confirmed, residual risks, and final `git status`.

One intentional commit per completed piece of work. **Do not push or open a PR unless explicitly
asked.**

## Prompt body — copy to here
