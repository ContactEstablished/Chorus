# Implementation Spec 4a-1 — The Resume Pointer: Schema + Storage

_Governs exact contents for `Tasks/Task-4a-1.md`. Where this spec and the task disagree on scope, the task wins; where they disagree on contents, this spec wins._

## 1. Insertion points (verified at `82e16d7`, 2026-08-12)

| Target | Verified state |
|---|---|
| `src/main/db/schema.ts` | `sessions` table opens at **line 68**; its last column is `lockedAt: text('locked_at')` at **line 114**; the table closes `})` at **line 115**. |
| `src/main/services/storage.ts` | `const MIGRATIONS: string[] = [` at **line 171**. The array's final element is the `agent_turns` DDL beginning at **line 869** and ending with its two `CREATE INDEX` lines; the array closes `]` at **line 883**. |
| `src/main/services/storage.ts` | `updateSessionTitle` at **line 1634** — the one-line-update idiom to copy. `setSessionLocked` at **line 1645** — the "clock lives here" idiom. |
| `src/main/services/storage.ts` | `getSessionsForProject` at **line 1577**, returning `SessionRow[]`. |

**Re-verify all six before editing.** These are line numbers, and line numbers rot.

## 2. `schema.ts` — the column

Append **after** `lockedAt` (line 114), inside the `sessions` table literal. The comment carries the *why*, in the register the surrounding columns use:

```ts
  // v19 (Phase 4a / D140): the AGENT'S OWN conversation id — Claude Code's
  // `--session-id` UUID, codex's rollout `session_id` — NOT Chorus's. NULL
  // means "no conversation to go back to": a pre-v19 row, a session that
  // never reported one, or a restart that deliberately forgot (D142).
  //
  // ⚠ THIS IS A SECOND IDENTITY WITH A DIFFERENT LIFETIME, AND THAT IS THE
  // WHOLE REASON IT IS NOT `sessions.id`. The row id is stable across PTY
  // re-creation by D16's contract; this one ROTATES underneath it, because
  // `claude --session-id` refuses a live id outright ("Session ID … is
  // already in use.", verified 2026-08-12). One row, many conversations,
  // in sequence.
  //
  // No FK and no index: the agent's store is not a table Chorus owns, and
  // every read is by primary key on `sessions` itself.
  agentSessionId: text('agent_session_id')
```

`lockedAt` must gain a trailing comma. Matches migration v19's DDL exactly — **check this character by character**; v10's `launch_profile_id` and v14's `name`/`description` both needed a hand-check.

## 3. `storage.ts` — the migration

Append as the array's new final element, after the `agent_turns` DDL:

```ts
  // v19 (Phase 4a / D140): the resume pointer. Applied in place; every
  // existing row back-fills to NULL and MEANS it — "this session predates the
  // pointer and starts fresh, once". No backfill from ~/.claude/projects or
  // ~/.codex/sessions: guessing which transcript belonged to which pane would
  // resume the wrong conversation, which is worse than resuming none.
  `ALTER TABLE sessions ADD COLUMN agent_session_id TEXT;`
```

**No index accompanies it**, unlike v18 — `agent_turns` earned two because it is queried by `outcome` and by `session_id`; this column is only ever read on a row already fetched by primary key.

### The version number

```
MIGRATIONS.length at 82e16d7 = 18   →   this migration is v19
```

**Do not trust that.** Before appending:

1. `MIGRATIONS.length` in the **merged** tree.
2. `main`'s highest applied version.
3. **Stop on divergence.** Do not renumber to make it fit (G6).

## 4. `storage.ts` — the accessors

Place them adjacent to `updateSessionTitle` (line 1634), inside the same session-accessor neighbourhood, under a banner comment matching the v16 agent-lock block's style (`storage.ts:1639`).

```ts
  /* -------------------------------------------------------------------- */
  /* v19: the resume pointer. Two writes and one read. WHICH agent id this  */
  /* holds is the adapter's business (D140: claude assigns it, codex has    */
  /* it discovered); storage only knows it is a string that came back from  */
  /* the CLI and goes back to the CLI unchanged.                            */
  /* -------------------------------------------------------------------- */

  /** Record the agent's own conversation id for this session. A missing row
   *  id is a zero-row no-op, matching updateSessionStatus/updateSessionTitle. */
  setAgentSessionId(id: string, agentSessionId: string): void {
    this.d.update(sessions).set({ agentSessionId }).where(eq(sessions.id, id)).run()
  }

  /** Forget the conversation — the RESTART path (D142), and the only way this
   *  column returns to NULL.
   *
   *  ⚠ A SEPARATE METHOD RATHER THAN `setAgentSessionId(id, null)`, AND THAT IS
   *  DELIBERATE. Forgetting is an intentional act with a name; a nullable
   *  setter lets a caller that merely had nothing to pass erase a live
   *  conversation pointer by accident, and the failure would be silent and
   *  unrecoverable — the id is gone and the transcript is unfindable. */
  clearAgentSessionId(id: string): void {
    this.d.update(sessions).set({ agentSessionId: null }).where(eq(sessions.id, id)).run()
  }

  getAgentSessionId(id: string): string | null {
    const row = this.d
      .select({ agentSessionId: sessions.agentSessionId })
      .from(sessions)
      .where(eq(sessions.id, id))
      .get()
    return row?.agentSessionId ?? null
  }
```

**`?? null` is load-bearing:** a missing row and a row with a NULL column must be indistinguishable to the caller — both mean "nothing to resume", and 4a-3 must not have to tell them apart.

## 5. `SessionRow` propagation — verify, do not assume

`getSessionsForProject` (line 1577) returns `SessionRow[]`, and `computeRestoreSet`'s `RestoreCandidate` (`restore.ts:20`) is **structurally typed** — it declares only `{id, status}` and accepts anything wider. 4a-3 reads `agentSessionId` off the rows this returns.

**Confirm the field actually arrives** by logging one row's keys at runtime, or by a type-level assertion. A Drizzle select that enumerates columns explicitly will *not* pick the new one up; a `select()` over the table will. **Check which one this is.**

## 6. Verification

### Build

```bash
npm run typecheck && npm test && npm run grep:secrets
```

Baseline to beat: **53 files / 1837 tests** at `82e16d7`. A *lower* test count is a regression even if everything passes.

### Migration — the three-dump protocol, on a COPY

> **⚠ NEVER AGAINST THE REAL OR INSTALLED DB.** Five SQLite stores exist on this machine and the Claude desktop app's container shadows `%APPDATA%`. Copy `chorus.db` to a scratch directory and point an isolated `--user-data-dir` at it.
>
> **⚠ AND VERIFY THE VERSION IS ACTUALLY FREE THERE.** Dev worktrees share one DB; a version already claimed by another branch makes this migration a silent no-op — the column never appears and every later task fails in a way that looks like a code bug. The throwaway user-data-dir is what makes this observable.

1. **Pre-dump** — `PRAGMA table_info(sessions);` plus `SELECT MAX(version) FROM schema_migrations;`
2. Boot the app once against the copy.
3. **Post-dump** — the same two queries. Expect exactly one new column and `MAX(version)` incremented by one.
4. Restart the app.
5. **Post-restart dump** — identical to the post-dump. Nothing re-applies.

Assertions:

```sql
-- every pre-existing row reads NULL and means it
SELECT COUNT(*) FROM sessions WHERE agent_session_id IS NOT NULL;  -- expect 0
```

Keep all three dumps under `_verify/4a-1/`.

### The scope proof

```bash
grep -rn "agentSessionId\|agent_session_id" src/ --include=*.ts
```

Every hit must be in `schema.ts`, `storage.ts`, or a test. **A hit in `sessionManager.ts`, `ipc.ts`, an adapter, the preload or the renderer is a scope violation** — this task ships a dormant column, and its whole value is that reverting it breaks nothing.

## 7. What the commit message must record

- The version actually used, and that `MIGRATIONS.length + 1` was confirmed against the merged tree (G6).
- That the column is dormant — no reader ships in this commit.
- The dev-DB copy the migration was proven against, and that the installed app was untouched.
