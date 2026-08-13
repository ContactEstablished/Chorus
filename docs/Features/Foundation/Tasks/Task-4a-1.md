# Task 4a-1 — The Resume Pointer: Schema + Storage

_Phase 4a, task 1 of 4. **One narrated commit (G3).** This task ships a column and its accessors and **nothing reads them** — deliberately, so the schema move lands separately from the behaviour that depends on it. This task governs scope; `ImplementationSpecs/ImplementationSpec-4a-1.md` governs exact contents._

> **⚠ DO NOT ASSUME THE MIGRATION VERSION.**
> `MIGRATIONS.length` was **18** on `main` at `82e16d7` (counted in the array at `storage.ts:171`, 2026-08-12), so the next free version is **v19**. **G6 outranks that figure:** confirm `MIGRATIONS.length + 1` at the moment of writing, check `main`'s highest applied version as well, and **stop on divergence rather than renumbering.** Per F54 this has already gone wrong twice on migration versions, once shipping a silent runtime failure. Per the dev-worktree hazard, a version claimed on another branch makes yours silently no-op — verify against a throwaway `--user-data-dir`, never the real DB.

## Source Of Truth

- `Tasks/Phase-4a-Overview.md` — §2 (store the pointer, not the conversation), §3 (the verified CLI facts that force a **separate, rotatable** column), **D140**, **D142**.
- Roadmap §6 **D16** (session identity is the row id; resolution (d): pane close deletes the row), **G6** (re-count shared counters after merging).
- `src/main/db/schema.ts:68` — the `sessions` table; `:114` is its current last column (`locked_at`, v16).
- `src/main/services/storage.ts:171` — the hand-rolled `MIGRATIONS` array (engine stays hand-rolled per D7 scope cut; Drizzle provides types only).
- Accessor style precedent: `updateSessionTitle` (`storage.ts:1634`) for the one-line update, `setSessionLocked` (`storage.ts:1645`) for the "the clock lives here, not in the caller" discipline.

## Goal

Give a Chorus session row a place to remember **the agent CLI's own session id**, so a later task can hand it back on relaunch. One nullable column, its migration, and the four accessors that will be needed — no readers, no launch-path change, no behaviour delta of any kind.

## Why the column must exist at all

Chorus session row ids are **already** `randomUUID()` (`ipc.ts:1373`, `:1474`), which made "pass the row id as `--session-id`" the tempting zero-schema design. **It was tested live on 2026-08-12 and it fails:**

```
Error: Session ID 7dd104c0-4fb5-4ae8-9e00-63172b5d1739 is already in use.
```

`session:restart` (`ipc.ts:1587`) and `restore()` (`sessionManager.ts:272`) both **reuse the row id on purpose** — that is D16's stable-identity contract. The agent's conversation id therefore has a different lifetime from the row's id: it rotates when the row's does not. **Two lifetimes, two columns.** That is the whole argument for this task.

## Exact Scope

| File | Change |
|---|---|
| `src/main/db/schema.ts` | **Edit.** Add `agentSessionId: text('agent_session_id')` to the `sessions` table, after `lockedAt`. Nullable, no default, **no `.references()`**. |
| `src/main/services/storage.ts` | **Edit.** One migration at `MIGRATIONS.length + 1` (**expected v19**) — `ALTER TABLE sessions ADD COLUMN agent_session_id TEXT;` — plus the accessors listed below. |
| `src/main/services/storage.test.ts` *(or the established storage-test home)* | **Edit/Create.** See Test Expectations. |

Nothing else. **No adapter file, no `sessionManager.ts`, no `ipc.ts`, no preload, no renderer, no IPC channel, no npm dependency.**

### The accessors

| Accessor | Contract |
|---|---|
| `setAgentSessionId(id, agentSessionId)` | Write the pointer. A missing row id is a zero-row no-op, matching `updateSessionStatus`/`updateSessionTitle`. |
| `clearAgentSessionId(id)` | Set it to `NULL`. **A distinct method, not `setAgentSessionId(id, null)`** — D142 makes "forget the conversation" an intentional act with a name, and a nullable setter invites an accidental clear from a caller that merely had nothing to pass. |
| `getAgentSessionId(id)` | `string \| null`. |

`getSessionsForProject` (`storage.ts:1577`) returns `SessionRow[]` and will carry the new field for free once the schema type gains it — **verify that it does rather than assuming**, since `computeRestoreSet`'s `RestoreCandidate` is structurally typed and 4a-3 depends on the field arriving through that path.

## Non-Goals

- **⚠ NOTHING READS THE COLUMN IN THIS TASK.** No launch writes it, no restore reads it, no adapter sees it. If this commit is reverted, nothing else breaks — that is the point of splitting it out. A reviewer who finds a reader has found a scope violation.
- **No second column.** Not `agent_session_started_at`, not `resume_count`, not `last_resumed_at`. `sessions.created_at` and the transcript's own mtime already answer every question those would. Add one when a task needs one.
- **No `NOT NULL`, no `DEFAULT`.** Every pre-v19 row must read `NULL` and mean it: *"this session predates the pointer and starts fresh, once"* (Overview §6, no backfill).
- **No FK, no `REFERENCES`, no index.** Same D16-resolution-(d) reason as `dispatches`, `attention_spans` and `agent_turns`. An index on a column that is only ever read by primary key is dead weight.
- **No change to `SessionRow`'s consumers.** Adding an optional field to a returned row must not require edits at call sites; if it does, the field was declared wrong.
- **No renaming of the existing `sessions.id` semantics anywhere**, in code or comment. The row id remains session identity (D16).
- **Do not revert, stage, or commit unrelated or untracked files** — see the Overview §6 list of what is already dirty in the tree.

## Dependencies

**None.** This task is first and stands alone.

## Test Expectations

Vitest cannot import `storage.ts` (`vitest.config.ts` header: the `better-sqlite3` binding is built for the Electron ABI while Vitest runs under Node). So the *unit* obligation here is small and the *runtime* obligation is where the proof lives.

Unit:
- The schema object exposes `agentSessionId` and the migration string's column name matches it **character for character**. A drift test is worth writing precisely because v10's `launch_profile_id` and v14's `name`/`description` both had to be hand-checked against their DDL.

Runtime (Acceptance 2–4) carries the rest.

## Verification Commands

```bash
npm run typecheck          # 0 errors
npm test                   # baseline at 82e16d7 was 53 files / 1837 tests
npm run grep:secrets       # clean
```

## Acceptance Criteria

1. `npm run typecheck` exits 0; `npm test` passes with **no test count regression** against the 53 files / 1837 tests measured at `82e16d7`; `npm run grep:secrets` clean.
2. `MIGRATIONS.length + 1` was **confirmed at the moment of writing**, and the version actually used is recorded in the commit message.
3. The migration is applied to a **COPY of the real dev DB in an isolated `--user-data-dir`** through the three-dump protocol (pre / post / post-restart), dumps kept under `_verify/4a-1/`. **The installed app's DB is never touched** — five DBs exist on this machine and the wrong one is easy to open.
4. `PRAGMA table_info(sessions)` shows `agent_session_id TEXT` nullable, and **every pre-existing row reads `NULL`**.
5. A second app boot re-applies nothing (the migration is idempotent by version, as every prior one is).
6. `getSessionsForProject` returns rows carrying the new field — **shown, not assumed.**

## Review Checklist

- [ ] `MIGRATIONS.length + 1` confirmed against the merged tree, not against the number in this doc.
- [ ] DDL column name matches `schema.ts` exactly.
- [ ] Nullable; no `DEFAULT`; no `NOT NULL`; no `REFERENCES`; no index.
- [ ] `clearAgentSessionId` exists as its own method (D142).
- [ ] Zero readers of the column in this commit — grep proves it.
- [ ] No file outside the three in Exact Scope is modified.
- [ ] Migration verified against a throwaway user-data-dir, not the real or installed DB.
