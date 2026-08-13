# Phase 4a — Session Continuity

_Kickoff authored 2026-08-12 against a verified `main` at `82e16d7`. Four tasks, one narrated commit each (G3). This overview governs scope and sequencing; each `Task-4a-#.md` governs its own task; each `ImplementationSpec-4a-#.md` governs exact contents._

_**Revised 2026-08-13 at `a6fab79`**, after Tasks 4a-1 and 4a-4 landed and after CR-4a.0 ruled. **⚠ EVERY LINE NUMBER IN THE ORIGINAL DRAFT OF THIS PHASE'S DOCS FOR `sessionManager.ts` AND `ipc.ts` HAS MOVED**, because Task 4a-4 edited both — the task docs were re-measured against `a6fab79` and this one records that they were._

> **✅ THE COUNCIL REVIEW CHECKPOINT IS CLOSED — CR-4a.0 RAN 2026-08-13 AND D139 IS RESOLVED.**
> The adapter-interface shape was a §4 trigger by name (_"Hard-to-reverse architectural shapes — adapter interface"_). Matthew ratified 2026-08-12: **author the docs now, run the council before 4a-2's code lands** — which is what happened. The council **approved the single-launch-path shape** and added one thing the brief had missed: the modifier must model **assigned creation** as well as resumption. **⚠ ITS RULING IS CONDITIONED BY SIX COORDINATOR AMENDMENTS AT D143, AND THEY ARE BINDING ON 4a-2 AND 4a-3 — four of them close gaps a council that could not see the repository could not have closed.** See **D139 (RESOLVED)** below, roadmap §6 D143, and `CouncilBriefs/CouncilBrief-4a.0-ResumeContract-Findings.md`.

---

## 1. The problem, stated as the user stated it

> _"If my PC reboots at night, or I have to shut Chorus down to install a new version, then I lose all my sessions."_

**Half of that is already false, and the half that is true is the expensive half.** Session rows persist (`sessions`, `schema.ts:68`), the pane tree persists (`pane_layouts`), and `SessionManager.restore()` (`sessionManager.ts:272`) already relaunches the right panes under their original row ids — the D16 contract, working as designed since Task 1-5.

What is lost is **the conversation inside the pane**. The roadmap already says so in its own words, in the Phase 8 note: _"a restored session is a genuinely **fresh conversation**, not a resumed one — the id survives, the context does not."_ That sentence was written as a caveat for dispatch records. This phase is the task that removes it.

Two distinct losses, two different mechanisms:

| Lost | Why | Fixed by |
|---|---|---|
| The agent's conversation | `restore()` calls `spawn(row.agent, row.cwd, row.id)` (`sessionManager.ts:346`) with no resume argv. Every adapter declares `sessionResume: null`. | Tasks 4a-1 · 4a-2 · 4a-3 |
| The terminal scrollback | `createSessionOutput`'s ring buffer is an in-memory string (`sessionOutput.ts:44`, cap `BUFFER_MAX_CHARS = 4_000_000` at `sessionManager.ts:25`). Nothing writes it to disk. | Task 4a-4 |

## 2. The organising decision: store the pointer, not the conversation

**The conversations are already on disk, already crash-safe, and already owned by someone else.** Claude Code writes `~/.claude/projects/<munged-cwd>/<session-uuid>.jsonl` continuously; codex writes `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`. Both verified on this machine 2026-08-12.

Copying either into `chorus.db` would mean duplicating a source of truth Chorus does not own, in a format that changes without notice, to produce bytes that **cannot be replayed into the CLI anyway** — the CLIs resume from their own stores or not at all. So Chorus stores **one nullable column** holding the agent's own session id, and hands it back on relaunch.

This is the same "derived, never stored" instinct `attention.ts:312` applies to spans and Task 8-0 applies to `dispatch_id` — one step further: **not even derived, just referenced.**

## 3. Verified ground facts

**⚠ RE-MEASURED 2026-08-13 AT `a6fab79`. The kickoff column is kept beside it because two of the six numbers moved, and a task doc built on the stale ones would waste a session.**

| Fact | At kickoff (`82e16d7`) | **NOW (`a6fab79`)** | How verified |
|---|---|---|---|
| Test baseline | 53 files / 1837 tests | **56 files / 1888 tests**, all passing | `npm test` |
| `IpcChannel` | 86, asserted twice | **86 — unchanged** | `ipc.test.ts:3438`, `:3816` |
| `MIGRATIONS.length` | 18 — next free v19 | **19 — v19 SPENT by 4a-1; next free is v20** | parsed from the `storage.ts` array |
| Highest decision / finding | D138 / F56 | **D143 / F60** (working tree; a clean clone of `main` still tops out at D134 — see roadmap §5) | roadmap §6, §5 |
| Chorus session row id | already `randomUUID()` | **unchanged** | `ipc.ts:1373`, **`:1478`** (was `:1474`) |
| `sessions` last column | `locked_at` (v16) | **`agent_session_id` (v19)** | `schema.ts:129` |

> **⚠ AND EVERY `sessionManager.ts` LINE NUMBER IN THE ORIGINAL TASK DOCS MOVED, BECAUSE TASK 4a-4 EDITED THAT FILE.** Re-measured at `a6fab79`: `attach()` **:300** (was :251) · `restore()` **:321** (was :272) · the credentialed heal **:370** (was :321) · the relaunch `spawn` **:395** (was :346) · `spawn()` **:583** (was :525) · the `buildLaunch` call **:619** (was :561) · `RESTORE_STAGGER_MS` **:38** · `RESTORE_CAP` **:42** · the restart-is-a-new-conversation comment **:743** (was :665). In `ipc.ts`, `SessionRestart` is **:1591** (was :1587). `Task-4a-2.md` and `Task-4a-3.md` carry the corrected values; this note exists so nobody trusts a number from an older draft.

### The Claude CLI, verified end-to-end (D4, not from memory)

Run live against the installed CLI on 2026-08-12, in a throwaway cwd:

| Check | Result |
|---|---|
| `claude --session-id <uuid> -p …` | ✅ session created; transcript written as `<uuid>.jsonl` |
| `claude --resume <uuid> -p …` | ✅ **recalled a word planted in the earlier turn** — context genuinely restored |
| `claude --session-id <uuid>` reusing a live id | ❌ `Error: Session ID <uuid> is already in use.` |
| `claude --resume <unknown-uuid>` | `No conversation found with session ID: <uuid>` |

**The third row is the load-bearing one and it is why this phase needs a new column.** Chorus row ids are already valid UUIDs, so passing the row id as `--session-id` was the tempting zero-schema design. It cannot work: `session:restart` (`ipc.ts:1587`) and `restore()` both **reuse the row id deliberately**, and the second launch under that id would fail outright. The agent's session id must be **separately stored and rotatable**.

### The codex CLI, verified (codex-cli 0.147.0)

**Codex is structurally different from Claude and the phase must not pretend otherwise.**

| Aspect | Claude | Codex |
|---|---|---|
| Resume syntax | flag: `--resume <uuid>` | **subcommand**: `codex resume [SESSION_ID] [PROMPT]` |
| Assign id at launch | ✅ `--session-id <uuid>` | ❌ **no such option exists** |
| Therefore | Chorus **assigns** | Chorus must **discover** |

- `codex resume --help` confirms the positional `[SESSION_ID]` (_"Session id (UUID) or session name. UUIDs take precedence if it parses."_) plus `--last` and `--all`.
- **F57 (new):** `~/.codex/session_index.jsonl` carries only `{id, thread_name, updated_at}` — **no cwd**, so the index alone cannot identify "the session I just launched in this directory".
- The rollout file's first line is a `session_meta` record carrying `session_id`, `cwd`, `originator`, `cli_version` and `source`. **That is the discovery surface**, and it is the only one verified to exist.

**This asymmetry is why resume cannot be a single shared "append a flag" mechanism.** For codex the executable's whole argv shape changes. See D139.

## 4. Task sequence

Strictly sequential — 4a-3 depends on both 4a-1 and 4a-2, and three of the four touch `sessionManager.ts`.

| Task | Delivers | Status | Depends on |
|---|---|---|---|
| **4a-1** | Migration **v19**: `sessions.agent_session_id` + storage accessors. Dormant — nothing reads it. | ✅ **LANDED 2026-08-13 (`bbf6d32`)** | None |
| **4a-2** | The adapter resume contract; `claude` and `codex` implement it and stop declaring `sessionResume: null`. | ⬜ **READY — CR closed, D139 resolved, D143 binding** | 4a-1 |
| **4a-3** | Wiring: mint/discover on launch, resume on restore, rotate on restart. **This is the task that fixes the reported problem.** | ⬜ **READY — after 4a-2 merges** | 4a-1, 4a-2 |
| **4a-4** | Scrollback mirrored to disk; replayed on attach. | ✅ **LANDED 2026-08-13 (`bbf6d32` + `a6fab79`)** | None (sequenced last for file ownership) |

**That plan survived contact: 4a-1 and 4a-4 shipped while the council deliberated**, and the phase spent the gate in the degraded-but-honest state this section predicted — scrollback survives, conversations do not. **⚠ 4a-4 GREW A FIFTH DELIVERABLE AFTER IT LANDED (F58):** the mirror was correct and a restored pane still looked empty, because a fresh TUI erases or covers the replay. `a6fab79` fixed the visibility; a readable *transcript* was proven impossible from a repaint stream and belongs to Phase 7.

**⚠ AND 4a-3 INHERITS ONE PIECE OF ALREADY-SHIPPED BEHAVIOUR TO CHANGE, NOT ONLY NEW CODE TO WRITE.** D142's scrollback half is now closed by CR-4a.0 Q7: a restarted pane currently re-seeds its history **silently**, and 4a-3 must put a visible separator in front of it (D143(g)).

## 5. Decisions taken at kickoff

> **⚠ G6 APPLIES TO EVERY NUMBER BELOW, AND IT ALREADY BIT ONCE DURING THIS KICKOFF.**
>
> `D139`–`D142` and `F57` are the next free values **as measured in the WORKING TREE at `82e16d7`** — which is not the same as the committed tree. **The uncommitted Phase 5 Voice edits to `roadmap.md` already claim `D135`–`D138`**, and this kickoff's first draft numbered from `D136` because a prose-matching grep missed the table's own first column. Caught and corrected before the docs shipped; recorded here because it is F54's exact shape and the next person will make it too.
>
> **⚠ UPDATE 2026-08-13 — THE CONTINGENCY GREW RATHER THAN CLOSING.** The phase's own numbers held (`D139`–`D142`, `F57`), and registering the phase added `F58`–`F60` and `D143`, so **nine decisions and four findings now sit on top of Phase 5's still-uncommitted `roadmap.md` edits.** Nothing has gone wrong and the ceiling was re-measured this pass — but the exposure is larger than it was, and **the cheap way to end it is to commit the Phase 5 roadmap edits**, after which these numbers stop being contingent on anything.
>
> **Therefore: these four numbers are contingent on the Phase 5 roadmap edits landing as written.** If those edits change or are dropped, re-derive from the merged tree — match `^| D<n>`, not `**D<n>` — and renumber this phase, not Phase 5. Do not add a delta to what this file said.

| ID | Decision | Status |
|---|---|---|
| **D139** | **The resume contract's shape.** The declared `SupportsResume` / `ResumeSpec` (`types.ts:351`, `:574`) is **too thin to use as written**: `ResumeSpec` is `{sessionId, cwd}`, which cannot carry credential, route, effort, extraArgs or hooks — every one of which `buildLaunch` receives today (`sessionManager.ts:561`). Implementing it verbatim would fork the launch path in two and guarantee drift. **Proposed:** `PtyLaunchSpec` gains an optional `resume` field so `buildLaunch` stays the single launch path, and `SupportsResume`/`ResumeSpec` are **redefined rather than deleted** for codex's argv-shape change. **⚠ RULED 2026-08-13 — THE SHAPE IS APPROVED AND THE HEDGE IS NOT.** `PtyLaunchSpec` gains the optional modifier and `buildLaunch` stays the single launch path, as proposed; but `ResumeSpec` and `SupportsResume.resumeSession()` are **DELETED OUTRIGHT**, not redefined — the council put codex's subcommand grammar inside its own `buildLaunch` instead, so nothing needs a second entry point to house it. **And it added what this row missed: the modifier must carry ASSIGNED CREATION as well as resumption** (`action: 'create' | 'resume'`), because Claude needs the minted id on its *first* launch, not only on a restore. `SupportsResume` survives only as a discriminated union of support shapes carrying `discoverSessionId` and `classifyResumeFailure`. **⚠ THIS ROW'S OWN CITATION WAS WRONG AND IS CORRECTED IN ROADMAP D139: `ResumeSpec` is at `types.ts:351` and `SupportsResume` at `:574` — the pair above is SWAPPED.** | **RESOLVED 2026-08-13 by CR-4a.0 · conditioned by SIX coordinator amendments at roadmap D143** |
| **D140** | **Claude assigns, codex discovers, and the capability declares which.** Not a uniform mechanism, because the CLIs are not uniform (§3). A discovered id is written only after a positive `cwd` match on the rollout header. | RESOLVED 2026-08-12 |
| **D141** | **Scrollback goes to a flat file per session, never into SQLite.** It is a 50 ms-cadence append-only byte stream (`SCRUB_FLUSH_MS = 50`, `sessionManager.ts:32`), not queryable records. `docs/PLAN.md:173` already specifies _"full transcript mirrored to disk (size-capped)"_ — this executes that line. | RESOLVED 2026-08-12 |
| **D142** | **`session:restart` rotates the pointer; `restore()` preserves it.** D16 clause 4 makes restart a deliberate fresh conversation (`sessionManager.ts:665` says so in comment). Restart therefore clears `agent_session_id` and mints anew; only restore resumes. **The "Session restarted" badge keeps meaning exactly what it means today.** | RESOLVED 2026-08-12 |

## 6. Phase-wide non-goals

- **No transcript content is ever read, copied, parsed or stored by Chorus.** The pointer is an id and a path check (`existsSync`). Reading a `.jsonl` body to *display* history is a different feature and is not this one. `contextUsage.ts` already reads Claude transcript tails for the context ring under its own rules; **this phase adds no second reader.**
- **No change to D33/F26's credential rule.** A session launched on a stored credential is still **never auto-restored** (`sessionManager.ts:321`) — resume does not create an exception, because the objection was never about context, it was about unattended decryption at boot.
- **No new IPC channel.** `IpcChannel` stays at **86** across all four tasks. Restore already announces itself via `onRestored`; the badge copy may change, the channel count may not. **⚠ THIS IS A NON-GOAL ABOUT CHANNELS, NOT ABOUT `src/shared/ipc.ts`, AND D143(f) TURNS ON THAT DISTINCTION.** Task 4a-2 **does** edit that file: `resumeDescriptorSchema` (`:2219`) feeds `agentCapabilitiesSchema` and rides `adapter:list`, so the descriptor's new `kind` field is a **Zod schema change** — and `z.object` *strips* unknown keys rather than rejecting them, so a `kind` added to the runtime object and not to the schema would vanish on the wire **silently**. The renderer never reads `sessionResume` (grep-verified), so nothing breaks either way; the schema is updated for honesty, per D1. The channel COUNT is what may not move.
- **No UI beyond badge/label copy.** No settings toggle, no resume picker, no history browser.
- **No resume for `kimi` or `opencode`.** Both adapter files carry explicit warnings that their `-c`/resume syntax differs and would **silently resume a stale session** (`kimi.ts:136`, `opencode.ts:204`). They keep `sessionResume: null` and are untouched.
- **No backfill.** Sessions that exist before v19 have `agent_session_id = NULL` and start fresh, once. No archaeology against `~/.claude/projects` to guess which transcript belonged to which pane.
- **Do not revert, stage, or commit unrelated or untracked files.** At kickoff the tree carries modified `docs/Features/Foundation/roadmap.md` and `docs/Plan.md`, plus untracked `CLAUDE-PROJECT-MARKER.txt`, `docs/Features/Foundation/Investigations/Voice-Input-Feature-Requirements-source.md` and `docs/Features/Foundation/Phase-5-VoicePlan.md`. **None of these belong to this phase.**

## 7. Phase acceptance — the one demonstration that matters

Not a test suite. **G2, driven on the real app:**

1. Launch a `claude` session in a real project; hold a conversation with at least two turns; establish a fact the agent could only know from that conversation.
2. Launch a `codex` session in the same project.
3. **Quit Chorus entirely** (the new-version-install path) — and separately, once, **hard-reboot the machine** (the 3 a.m. Windows Update path).
4. Reopen Chorus. Both panes return.
5. Ask each agent the established fact. **It answers correctly.**
6. The scrollback above the prompt shows the prior conversation, not an empty pane.
7. Press restart on one pane: it comes back **empty and amnesiac**, and the "Session restarted" badge appears — proving D142 and D16 clause 4 still hold.

Evidence under `_verify/4a/`.

---

## Milestone

A reboot costs a developer nothing but the time to reopen the app. The prime contract in roadmap §1 says Chorus keeps agents _"restart-safe"_ — after this phase that is true of the conversations, not merely the rows.
