# Phase 4a — Execution Prompt (Tasks 4a-1 and 4a-4)

_Generated 2026-08-12 against `main` at `82e16d7`. Paste the body below into a **fresh** conversation._

> **⚠ THIS PROMPT DELIBERATELY COVERS ONLY TWO OF THE PHASE'S FOUR TASKS.**
> Tasks **4a-2** and **4a-3** are blocked on a Council Review (decision **D139**, recorded PENDING). A kickoff prompt containing an open decision produces a blocked session, so they are excluded. Generate a second prompt for them once the council has ruled and D139 is recorded RESOLVED in `roadmap.md` §6.
>
> The two tasks below are **not** gated, have **no dependency** on D139, and together deliver the scrollback half of session continuity.

---

## PROMPT BODY — copy everything below this line

---

You are the **Coordinator** for Chorus **Phase 4a — Session Continuity**, executing **Task 4a-1** and **Task 4a-4** only.

Repository root: `C:\Projects\ContactEstablished\Chorus`
Expected branch: **`main`** — confirm with `git branch --show-current`. **Do not switch or create a branch without instruction.**
Expected HEAD at start: `82e16d7` ("Release version 0.4.4 so the clipboard and separator fixes are installable"). If HEAD differs, **re-verify every line number cited below before editing** and report any that moved.

## 1. Goal

Chorus already restores panes across an app restart, but a restored pane comes back **empty and amnesiac**: the agent's conversation is gone and the terminal scrollback is gone. This phase fixes both. **These two tasks fix the scrollback half and lay the schema for the other half.**

- **Task 4a-1** adds a nullable `sessions.agent_session_id` column and its accessors. **Nothing reads it** — it is deliberately dormant so the schema move lands separately from the behaviour that depends on it.
- **Task 4a-4** mirrors each session's already-scrubbed output to a size-capped file under `userData` and replays it when a restored pane attaches, so the pane shows its history instead of a blank terminal.

**Prime constraint: Task 4a-1 is a zero-behaviour-change commit.** If reverting it breaks anything, it was implemented wrong.

## 2. Ground yourself first — read before editing

**Phase documents (your source of truth; all are currently UNTRACKED in the working tree):**

- `docs/Features/Foundation/Tasks/Phase-4a-Overview.md` — scope, verified facts, decisions D139–D142
- `docs/Features/Foundation/Tasks/Task-4a-1.md` + `docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-4a-1.md`
- `docs/Features/Foundation/Tasks/Task-4a-4.md` + `docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-4a-4.md`

**Governing rules:**

- `CLAUDE.md` — locked architecture rules. Sessions live in main; all IPC Zod-validated in main only; no new dependencies without asking.
- `docs/Features/Foundation/roadmap.md` §6 — the decision log and **gates G1–G6**. Read **G6** in full before you touch a migration number.
- `docs/PLAN.md:173` — the pane spec line this phase executes: _"Scrollback 10k lines in xterm + full transcript mirrored to disk (size-capped)"_.

**Code to inspect before editing (verified at `82e16d7`; confirm each):**

| Path | Line | What |
|---|---|---|
| `src/main/db/schema.ts` | 68 | `sessions` table opens |
| `src/main/db/schema.ts` | 114 | `lockedAt: text('locked_at')` — the current last column |
| `src/main/db/schema.ts` | 115 | the table's closing `})` |
| `src/main/services/storage.ts` | 171 | `const MIGRATIONS: string[] = [` |
| `src/main/services/storage.ts` | 883 | the array's closing `]` (last entry is v18's `agent_turns` DDL from line 869) |
| `src/main/services/storage.ts` | 1577 | `getSessionsForProject` → `SessionRow[]` |
| `src/main/services/storage.ts` | 1620 | `deleteSession` |
| `src/main/services/storage.ts` | 1634 | `updateSessionTitle` — the one-line-update idiom to copy |
| `src/main/services/storage.ts` | 1645 | `setSessionLocked` — the "clock lives here, not in the caller" idiom |
| `src/main/services/sessionOutput.ts` | 18–30 | the **five invariants** header comment — read all five |
| `src/main/services/sessionOutput.ts` | 44 | `createSessionOutput(opts)` |
| `src/main/services/sessionOutput.ts` | 57 | the single `emit` path |
| `src/main/services/sessionOutput.ts` | 60–61 | the in-memory head-truncation the file cap must match |
| `src/main/services/sessionManager.ts` | 25 | `BUFFER_MAX_CHARS = 4_000_000` |
| `src/main/services/sessionManager.ts` | 32 | `SCRUB_FLUSH_MS = 50` |
| `src/main/services/sessionManager.ts` | 251 | `attach()` — pure view binding |
| `src/main/services/sessionManager.ts` | 519 | `buffer: session.output.buffer` inside `snapshot()` |
| `src/main/services/sessionManager.ts` | 618 | the `createSessionOutput({...})` construction |
| `src/main/ipc.ts` | 1373, 1474 | the two `randomUUID()` session-row creations |
| `src/main/ipc.ts` | 1390, 1691 | `storage.deleteSession(...)` call sites |
| `src/main/index.ts` | 320 | `new StorageService(join(app.getPath('userData'), 'chorus.db'))` |
| `src/main/index.ts` | 338 | `join(app.getPath('userData'), 'agent-hooks')` — the directory precedent to copy |
| `src/main/services/restore.ts` | 31 | `computeRestoreSet` — the pure-core house pattern |

**Git checks to run first:**

```bash
git branch --show-current      # expect: main
git log -1 --format="%H %s"    # expect: 82e16d7 …
git status --porcelain
```

## 3. Pre-existing changes — DO NOT REVERT, STAGE, OR COMMIT THESE

The tree is **already dirty** when you start. These belong to **Phase 5 (Voice Input)** and to other work, not to you:

```
 M docs/Features/Foundation/roadmap.md
 M docs/Plan.md
?? CLAUDE-PROJECT-MARKER.txt
?? docs/Features/Foundation/Investigations/Voice-Input-Feature-Requirements-source.md
?? docs/Features/Foundation/Phase-5-VoicePlan.md
```

> **⚠ THE MODIFIED `roadmap.md` MATTERS TO YOU FOR ONE REASON:** its uncommitted edits **already claim decisions D135–D138** for Phase 5. That is why this phase's decisions are numbered **D139–D142**. Do not renumber them, and do not edit `roadmap.md` — updating it is `/architect`'s job after you land.

**These ten untracked files ARE yours** and should be committed alongside your code, since they are this work's own source of truth:

```
docs/Features/Foundation/Tasks/Phase-4a-Overview.md
docs/Features/Foundation/Tasks/Phase-4a-ExecutionPrompt.md
docs/Features/Foundation/Tasks/Task-4a-1.md   … Task-4a-4.md
docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-4a-1.md … -4a-4.md
```

Stage explicitly by path. **Never `git add -A` or `git add .`** in this repo.

## 4. Implementation scope

### Task 4a-1 — the resume pointer (schema + storage)

**Files owned — nothing else:**

| File | Change |
|---|---|
| `src/main/db/schema.ts` | Add `agentSessionId: text('agent_session_id')` after `lockedAt` (line 114). Nullable, no default, **no `.references()`**. `lockedAt` gains a trailing comma. |
| `src/main/services/storage.ts` | One migration at `MIGRATIONS.length + 1` — `ALTER TABLE sessions ADD COLUMN agent_session_id TEXT;` — plus three accessors. |
| the storage test file | The DDL/schema drift test (see the spec). |

**Accessors:** `setAgentSessionId(id, agentSessionId)`, `clearAgentSessionId(id)`, `getAgentSessionId(id)`. `clearAgentSessionId` is a **separate method**, not `setAgentSessionId(id, null)` — see D142 below. `getAgentSessionId` returns `?? null` so a missing row and a NULL column are indistinguishable to the caller.

> **⚠ MIGRATION VERSION — DO NOT ASSUME.** `MIGRATIONS.length` was **18** at `82e16d7`, so the next free is **expected to be v19**. **G6 outranks that figure.** Confirm `MIGRATIONS.length + 1` in the merged tree, check `main`'s highest applied version too, and **stop on divergence rather than renumbering**. Per finding F54 this has gone wrong twice on migration versions, once shipping a silent runtime failure. Dev worktrees share one database — a version already claimed on another branch makes yours a **silent no-op**, which is why the migration must be proven against a throwaway `--user-data-dir` (§6).

### Task 4a-4 — scrollback mirrored to disk

**Files owned — nothing else:**

| File | Change |
|---|---|
| `src/main/services/scrollbackCore.ts` | **Create.** Pure: `capTail`, `planReplay`. No `fs`, no `electron`, no clock. |
| `src/main/services/scrollbackCore.test.ts` | **Create.** |
| `src/main/services/scrollbackStore.ts` | **Create.** Impure: `append`, `readTail`, `remove`, `pruneOrphans`. |
| `src/main/services/scrollbackStore.test.ts` | **Create.** Against a temp directory. |
| `src/main/services/sessionOutput.ts` | **Edit.** Add ONE optional `onPersist?: (text: string) => void`, called from inside the existing `emit` (line 57). |
| `src/main/services/sessionManager.ts` | **Edit.** Construct the store; pass the sink at line 618; seed the replay buffer on restore; remove on session delete; prune orphans at boot. |

**The one structural rule.** `sessionOutput.ts`'s invariant 1: *one* `scrubber.push()` per chunk, whose single result feeds both the ring buffer and the broadcast. **The disk write is a third consumer of that same already-computed string — never a second `scrubber.push()`, never a tap on raw PTY bytes.** F26 was a live A/B that found unredacted output reaching a new destination; D45(1) exists because of it. A reviewer must be able to see that the file cannot contain anything the pane did not.

**Storage location:** `join(app.getPath('userData'), 'scrollback')`, file `${sessionId}.log` — copy the directory idiom at `index.ts:338`. **Never TEMP, never a project directory.** Refuse path traversal on the session id explicitly, even though ids are `randomUUID()` today.

**Cap:** 4,000,000 chars, equal to `BUFFER_MAX_CHARS`. Import it once or assert equality in a test. Enforce with a **slack margin** (e.g. rewrite only past 125% of cap) — naive re-truncation would be a 4 MB write twenty times a second per pane.

**No `fsync`, no `writeFileSync`, no synchronous write on the PTY data path.**

### Resolved decisions governing these two tasks

Quote them in code comments where they bite.

- **D141 (RESOLVED 2026-08-12)** — *Scrollback goes to a flat file per session, never into SQLite.* It is a 50 ms-cadence append-only byte stream, not queryable records; the cap is a head truncation; a corrupt file costs one pane's history while a corrupt SQLite page costs the projects list. `docs/PLAN.md:173` already specifies it.
- **D142 (RESOLVED 2026-08-12)** — *`session:restart` rotates the pointer; `restore()` preserves it.* D16 clause 4 makes restart a deliberate fresh conversation. **For Task 4a-1 this is why `clearAgentSessionId` exists as its own named method** — forgetting is an intentional act, and a nullable setter would let a caller erase a live pointer by accident, silently and unrecoverably. **Task 4a-1 does not call it; it only provides it.**
- **D16 resolution (d)** — pane close **deletes the session row**. Task 4a-4's file must be deleted with its row (`ipc.ts:1390`, `:1691`) and orphans swept at boot. An orphan file is a plaintext record of the user's work with nothing pointing at it.

## 5. Strict non-goals

- **Nothing reads `agent_session_id` in this session.** No launch writes it, no restore reads it, no adapter sees it. A grep proving zero readers is an acceptance criterion.
- **Do not implement Task 4a-2 or 4a-3.** No adapter file changes. `claude.ts`, `codex.ts`, `kimi.ts`, `opencode.ts`, `capabilities.ts` and `adapters/types.ts` must be **byte-identical to HEAD**. They are blocked on council decision D139.
- **No second column.** Not `agent_session_started_at`, not `resume_count`, not `last_resumed_at`.
- **No `NOT NULL`, no `DEFAULT`, no FK, no index** on the new column.
- **No backfill** from `~/.claude/projects` or `~/.codex/sessions`.
- **No scrollback search, export, transcript viewer, or copy-transcript button** — Phase 7 owns those.
- **No new IPC channel.** `IpcChannel` stays at **86** (asserted at `src/shared/ipc.test.ts:3438` and `:3816`). No preload change, no renderer change.
- **No npm dependency.** The stack is locked in `CLAUDE.md`; ask before adding anything.
- **No change to `BUFFER_MAX_CHARS` (4,000,000) or `SCRUB_FLUSH_MS` (50).**
- **No change to `agentEvents.ts` or `agentEventsCore.ts`.**
- **Do not edit `roadmap.md`** — `/architect` does that after you land.
- **Do not revert, stage, or commit the pre-existing dirty files in §3.**

## 6. Required workflow

1. **Ground** — read the phase docs and inspect every code location in §2 before editing. Report any line number that has moved.
2. **Implement Task 4a-1 first, alone.** It is dormant and independently revertible; landing it clean makes 4a-4's review smaller.
3. **Spec review** — before writing code for each task, re-read its `ImplementationSpec-4a-#.md` and confirm your plan matches it. Where the task doc and the spec disagree on scope, the **task doc** wins; on contents, the **spec** wins.
4. **Code-quality review** — after implementing, review your own diff against the task's **Review Checklist**, item by item. Fix what fails.
5. **Verification** — §7, in full. **Run, don't just compile (G2).**
6. **One intentional narrated commit (G3)** in the style of `80e69c3`: a concise title, then a description a non-technical reader understands first and a technical reader second. Stage by explicit path.
7. **Do not push and do not open a PR** unless explicitly asked.

If the two tasks would produce an awkward single commit, **ask** before splitting — G3 says one intentional commit per execution session, and a split is a deviation the user should approve.

## 7. Verification commands

Run from the repo root.

### Build gates

```bash
npm run typecheck      # G1 — expect 0 errors
npm test               # baseline at 82e16d7: 53 files / 1837 tests, all passing
npm run grep:secrets   # G4 — expect clean
```

A **lower** test count than 53/1837 is a regression even if everything passes.

### Channel tally (must not move)

```bash
grep -n "toHaveLength(86)" src/shared/ipc.test.ts    # expect two hits: 3438 and 3816
```

### Task 4a-1 — the dormancy proof

```bash
grep -rn "agentSessionId\|agent_session_id" src/ --include=*.ts
```

Every hit must be in `schema.ts`, `storage.ts`, or a test. **A hit in `sessionManager.ts`, `ipc.ts`, an adapter, the preload or the renderer is a scope violation.**

### Task 4a-1 — the migration, on a COPY

> **⚠ NEVER AGAINST THE REAL OR INSTALLED DB.** Five SQLite stores exist on this machine, and the Claude desktop app's container shadows `%APPDATA%`. Copy `chorus.db` to a scratch directory and point an isolated `--user-data-dir` at it. The installed Chorus must never be touched.

Three-dump protocol:

1. **Pre-dump:** `PRAGMA table_info(sessions);` and `SELECT MAX(version) FROM schema_migrations;`
2. Boot the app once against the copy.
3. **Post-dump:** same two queries. Expect exactly one new column and `MAX(version)` incremented by one.
4. Restart the app.
5. **Post-restart dump:** identical to the post-dump — nothing re-applies.

```sql
SELECT COUNT(*) FROM sessions WHERE agent_session_id IS NOT NULL;   -- expect 0
```

Keep all three dumps under `_verify/4a-1/`.

### Task 4a-4 — the structural proof

```bash
grep -rn "scrubber.push\|createScrubber" src/main --include=*.ts | grep -v test
#   expect: sessionOutput.ts only (councilService.ts calls createSessionOutput, which is fine)

grep -n "onPersist" src/main/services/sessionOutput.ts
#   expect: the option declaration and EXACTLY ONE call site, inside emit
```

### Task 4a-4 — the redaction A/B (the one that matters most)

**Run it live; do not reason about it.** The whole risk of this task is a new plaintext destination for session text.

1. Launch a session on a **stored credential** (the D33 / Task 3-6 path, so `secretEnv` is genuinely populated).
2. In the pane, cause the agent or shell to echo the environment.
3. Confirm the **pane** shows the redacted form — this is the pre-existing behaviour and your control.
4. Grep the scrollback file for the secret's plaintext:

PowerShell (note: `$env:` is PowerShell syntax — this one does **not** run in the Bash tool as written):

```powershell
Select-String -Path "$env:APPDATA\chorus-app\scrollback\<sessionId>.log" `
              -SimpleMatch "<the-secret-value>" | Measure-Object | % Count   # expect 0
```

**If step 4 returns anything but 0, stop and do not commit.**

### Task 4a-4 — runtime gates (G2: run the real app, observe it)

| # | Do this | Expect |
|---|---|---|
| 1 | Produce distinctive output in a pane; **quit Chorus completely**; reopen | The pane shows the earlier output above the prompt, **not an empty terminal**. Screenshot both sides. |
| 2 | Restart the app twice in a row | History is **not duplicated** |
| 3 | Drive a session past 4,000,000 chars | The file plateaus and keeps the **tail** (`tail -c 200`) |
| 4 | Close a pane | Its `.log` is gone — confirm by path |
| 5 | Delete a session row with the app closed, then boot | The orphan file is swept |
| 6 | Run a high-output command (name it, e.g. a full `npm run build`) | Typing latency unaffected — state what you observed |

Evidence under `_verify/4a-4/`.

## 8. Failure honesty

If any verification command fails — including for an unrelated environment reason (a native-module ABI mismatch, a locked database, a missing CLI, a flaky test) — **capture the exact output verbatim, explain what you believe caused it, and do not claim success.** A partial pass reported as a pass is worse than a clean failure, because the next session builds on it.

Specifically:

- If the migration version you computed diverges from what you expected, **stop and report** — do not renumber to make it fit (G6).
- If the redaction A/B shows the secret in the file, **stop and report** — do not commit and do not attempt a workaround.
- If a runtime gate cannot be run (e.g. no stored credential is configured on this machine), say so explicitly and name what was skipped. Do not silently drop it.

## 9. Final report — required format

**Status:** one of `DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED`

Then:

1. **Files changed** — every path, with created/edited marked.
2. **Migration version actually used**, and confirmation that `MIGRATIONS.length + 1` was checked against the merged tree (G6).
3. **Build results** — `typecheck`, `npm test` (file and test counts, compared to the 53/1837 baseline), `grep:secrets`.
4. **Runtime results** — what you actually opened, did, and observed for each gate in §7, with screenshots or dump paths. Not "verified" — say what you saw.
5. **The redaction A/B result** — the grep count, explicitly.
6. **Review outcomes** — each task's Review Checklist, item by item, with pass/fail.
7. **Non-goals confirmation** — explicitly confirm: `IpcChannel` still 86; adapters byte-identical to HEAD; zero readers of `agent_session_id`; no npm dependency added; `roadmap.md` untouched; the §3 dirty files untouched.
8. **Residual risks and findings** — anything you noticed that a later task should own. If you find something worth a roadmap finding number, propose it as **F57 or later** and say why (F56 was the highest at `82e16d7`).
9. **Final `git status --porcelain`** — and confirmation that only your intended paths were staged.

---

## END OF PROMPT BODY

---

## Coordinator notes (not part of the prompt)

- **Tasks 4a-2 and 4a-3 still need their own prompt** once the council rules on D139. That prompt must additionally carry: the verified Claude CLI facts (`--session-id` assigns, `--resume` reopens, a duplicate id errors, an unknown id errors cleanly), the codex asymmetry (resume is a subcommand, no launch-time id assignment, F57's index-has-no-cwd finding), and the council's actual verdict on the interface shape.
- After this session lands, run **`/architect`** to register Phase 4a in `roadmap.md` — a new §7 section, decisions D139–D142, and finding F57. It must re-derive those numbers against the merged tree, because Phase 5's uncommitted edits currently hold D135–D138.
