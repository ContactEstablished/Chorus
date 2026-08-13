# Phase 4a — Session Continuity

_Kickoff authored 2026-08-12 against a verified `main` at `82e16d7`. Four tasks, one narrated commit each (G3). This overview governs scope and sequencing; each `Task-4a-#.md` governs its own task; each `ImplementationSpec-4a-#.md` governs exact contents._

> **⚠ THIS PHASE CARRIES A COUNCIL REVIEW CHECKPOINT AND IT GATES TASK 4a-2, NOT THIS DOCUMENT.**
> The adapter-interface shape is a §4 trigger by name (_"Hard-to-reverse architectural shapes — adapter interface"_). Matthew ratified 2026-08-12: **author the docs now, run the council before 4a-2's code lands.** Tasks 4a-1 and 4a-4 are not gated and may proceed. See **D139 (PENDING)** below.

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

## 3. Verified ground facts (measured this session at `82e16d7`)

| Fact | Value | How verified |
|---|---|---|
| Test baseline | **53 files / 1837 tests**, all passing | `npm test` |
| `IpcChannel` | **86**, asserted twice | `ipc.test.ts:3438`, `:3816` |
| `MIGRATIONS.length` | **18** — next free is **v19** | counted in `storage.ts:171` array |
| Highest decision / finding | **D138** / **F56** — see the G6 warning in §5 | roadmap §6, §5 |
| Chorus session row id | already `randomUUID()` | `ipc.ts:1373`, `:1474` |
| `sessions` last column | `locked_at` (v16) | `schema.ts:114` |

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

| Task | Delivers | Gated by CR | Depends on |
|---|---|---|---|
| **4a-1** | Migration **v19**: `sessions.agent_session_id` + storage accessors. Dormant — nothing reads it. | No | None |
| **4a-2** | The adapter resume contract; `claude` and `codex` implement it and stop declaring `sessionResume: null`. | **YES** | 4a-1 |
| **4a-3** | Wiring: mint/discover on launch, resume on restore, rotate on restart. **This is the task that fixes the reported problem.** | Inherits 4a-2's | 4a-1, 4a-2 |
| **4a-4** | Scrollback mirrored to disk; replayed on attach. | No | None (sequenced last for file ownership) |

**4a-1 and 4a-4 are both shippable while the council deliberates.** If the CR runs long, land those two and hold 4a-2/4a-3 — the phase degrades to "scrollback survives, conversations do not", which is strictly better than today.

## 5. Decisions taken at kickoff

> **⚠ G6 APPLIES TO EVERY NUMBER BELOW, AND IT ALREADY BIT ONCE DURING THIS KICKOFF.**
>
> `D139`–`D142` and `F57` are the next free values **as measured in the WORKING TREE at `82e16d7`** — which is not the same as the committed tree. **The uncommitted Phase 5 Voice edits to `roadmap.md` already claim `D135`–`D138`**, and this kickoff's first draft numbered from `D136` because a prose-matching grep missed the table's own first column. Caught and corrected before the docs shipped; recorded here because it is F54's exact shape and the next person will make it too.
>
> **Therefore: these four numbers are contingent on the Phase 5 roadmap edits landing as written.** If those edits change or are dropped, re-derive from the merged tree — match `^| D<n>`, not `**D<n>` — and renumber this phase, not Phase 5. Do not add a delta to what this file said.

| ID | Decision | Status |
|---|---|---|
| **D139** | **The resume contract's shape.** The declared `SupportsResume` / `ResumeSpec` (`types.ts:351`, `:574`) is **too thin to use as written**: `ResumeSpec` is `{sessionId, cwd}`, which cannot carry credential, route, effort, extraArgs or hooks — every one of which `buildLaunch` receives today (`sessionManager.ts:561`). Implementing it verbatim would fork the launch path in two and guarantee drift. **Proposed:** `PtyLaunchSpec` gains an optional `resume` field so `buildLaunch` stays the single launch path, and `SupportsResume`/`ResumeSpec` are **redefined rather than deleted** for codex's argv-shape change. | **PENDING COUNCIL** |
| **D140** | **Claude assigns, codex discovers, and the capability declares which.** Not a uniform mechanism, because the CLIs are not uniform (§3). A discovered id is written only after a positive `cwd` match on the rollout header. | RESOLVED 2026-08-12 |
| **D141** | **Scrollback goes to a flat file per session, never into SQLite.** It is a 50 ms-cadence append-only byte stream (`SCRUB_FLUSH_MS = 50`, `sessionManager.ts:32`), not queryable records. `docs/PLAN.md:173` already specifies _"full transcript mirrored to disk (size-capped)"_ — this executes that line. | RESOLVED 2026-08-12 |
| **D142** | **`session:restart` rotates the pointer; `restore()` preserves it.** D16 clause 4 makes restart a deliberate fresh conversation (`sessionManager.ts:665` says so in comment). Restart therefore clears `agent_session_id` and mints anew; only restore resumes. **The "Session restarted" badge keeps meaning exactly what it means today.** | RESOLVED 2026-08-12 |

## 6. Phase-wide non-goals

- **No transcript content is ever read, copied, parsed or stored by Chorus.** The pointer is an id and a path check (`existsSync`). Reading a `.jsonl` body to *display* history is a different feature and is not this one. `contextUsage.ts` already reads Claude transcript tails for the context ring under its own rules; **this phase adds no second reader.**
- **No change to D33/F26's credential rule.** A session launched on a stored credential is still **never auto-restored** (`sessionManager.ts:321`) — resume does not create an exception, because the objection was never about context, it was about unattended decryption at boot.
- **No new IPC channel.** `IpcChannel` stays at **86** across all four tasks. Restore already announces itself via `onRestored`; the badge copy may change, the channel count may not.
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
