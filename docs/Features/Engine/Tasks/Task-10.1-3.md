# Task 10.1-3 — Migration v24, the cache-write column, and the ledger service

**Phase:** Engine 10.1 · **Depends on:** 10.1-2 (the pure core), 10.1-1 (edits `src/main/ipc.ts` first)
**Owns:** `storage.ts` MIGRATIONS v24 · `schema.ts` `dispatches` · `engineLedger.ts` (+ test) ·
`contextUsage.ts` header · `shared/ipc.ts` channels + schemas · `main/ipc.ts` handlers ·
`preload/index.ts` forwarders · `schema.test.ts` · `ipc.test.ts`

---

## Source Of Truth

- `docs/Features/Engine/chorus-engine-spec.md` — **§5 Phase 10.1** (the four numbers, the files
  list), **§3.6 F114**, **§7** (contract tests), **§6** (settings shape only — *not built here*).
- `docs/Features/Engine/Tasks/Phase-10.1-Overview.md` — the kickoff ground facts, D-a/D-b/D-c.
- Convention to follow: `src/main/services/contextUsage.ts` — in-memory map, edge-triggered
  broadcast, `snapshot()` cold read, absent-rather-than-zero. This task's service is its sibling.
- D7 (schema.ts/storage.ts hand-mirrored), D1 (no Zod in preload), D14 (plain objects on the bridge),
  D147(e) (every line is paid for).

## Initial Starting Point (verified 2026-09-12 at `3e391a0`)

- ✅ **`MIGRATIONS.length` = 23, 0 spreads, highest `// vN` marker = v23** — AST-parsed on the working
  tree, `main`, `origin/main`, `origin` and both sibling worktrees. The installed DB's
  `SELECT MAX(version) FROM schema_migrations` reads **23 over 23 contiguous rows**, read from a
  WAL-inclusive COPY. **v24 is free in code and in the store.** Re-run both halves before writing it.
- ✅ The array spans `storage.ts:175`–`:1033`; the last entry (v23, `peer_sessions`) ends at `:1032`
  and `]` is `:1033`. `MEMORY_COUNTERS_VERSION = 21` at `:1042` is a HISTORICAL constant — do not
  touch it.
- ✅ `dispatches` in `schema.ts`: `tokensIn` `:311`, `tokensOut` `:312`, the two-line comment
  `:313-314`, `tokensCached` `:315`, `costUsd` `:316`. The DDL half is `storage.ts:292-295`.
- ✅ `src/shared/ipc.ts` `IpcChannel` — **114 keys, 0 spreads**, object opens `:14`, closes
  `} as const` at `:859`, last member `VoiceModelStatus` at `:858`.
- ✅ `src/shared/ipc.test.ts:3642` and `:4102` both assert `toHaveLength(114)`. ⚠ **The Engine spec
  omits the `src/shared/` prefix** and names `ipc.test.ts`; there is no such file under `src/main/`.
- ✅ The key-set precedent is `src/shared/ipc.test.ts:4137` (`it('carries host and port and NOTHING
  capable of holding a key…')`); the spec's `:4138` is that test's first line, not the `it(`.
- ✅ `contextUsage.ts` header runs `:12-50`; the security posture is `:24-49`; "THE FILE'S CONTENT
  NEVER LEAVES THIS MODULE" is `:35`. `TAIL_BYTES = 256 * 1024` `:63`; `READ_THROTTLE_MS` `:75`.
- ✅ `main/index.ts:664-668` is `agentEvents.onTranscriptPath(...)`; `:665` calls
  `contextUsage?.noteClaudeTranscript(...)`. That callback is where this service gets its path.
- ✅ Vitest baseline at `3e391a0`: **90 files / 3194 tests, all passing** (16.8 s).
- ✅ `vitest.config.ts` is `environment: 'node'` and **tests must never import `storage.ts`** — its
  better-sqlite3 binding is Electron ABI 148 against Node's 127. `node:sqlite` works here (Node
  22.14.0) and is already used by `_verify/rail-activity/verify_counts.mjs`.

## Goal

Give the ledger somewhere to put a number the schema has never been able to hold, and give the
renderer a way to ask for the four numbers without a single byte of transcript text crossing the
bridge. Three separable pieces: migration **v24** (one nullable column), the impure
**`engineLedger.ts`** wrapping 10.1-2's pure core, and **two IPC channels**.

## Exact Scope

**(1) Migration v24 — ONE nullable column, `dispatches.tokens_cache_write`.**

⚠ **THE SPEC IS WRONG ABOUT F114's MECHANISM AND THIS TASK CORRECTS IT.** §3.6 says
`tokens_cached` "conflates" cache reads and writes. **It does not.** Measured this session:

```
subscriptionMeter.ts:156   tokensIn     += (fresh ?? 0) + (cacheWrite ?? 0) + (cacheRead ?? 0)
subscriptionMeter.ts:158   tokensCached += cacheRead ?? 0
```

So `tokens_cached` holds **cache READS ONLY**, and cache **WRITES are folded into `tokens_in`**,
where no column can recover them. The module's own header at `subscriptionMeter.ts:44-45` already
states this correctly, and `attributionCore.ts:352-357` agrees (`tokensCached` is a SUBSET of
`tokensIn`). **The spec's conclusion survives — the ledger cannot express CE from these columns —
but the fix is an ADDITION, not a split.** Per **D-a**: add one column, change no meanings,
**NO BACKFILL**.

**(1b) One producer, wired.** `subscriptionMeter.ts:149` already parses `cacheWrite` and then
discards it at `:156`. Return it and carry it to the row. ⚠ **If the coordinator prefers v24 to be
storage-only, say so explicitly and accept the cost**: every dispatch written between v24 and the
writer joins the 467 rows that can never be recovered — the D50 argument that put v7's telemetry
spine before its UI, restated.

**(2) `src/main/services/engineLedger.ts` (+ `engineLedger.test.ts`).** The impure sibling of
10.1-2's `engineLedgerCore.ts`, modelled on `contextUsage.ts`. Walks `<transcript>.jsonl` **and**
`<transcript-dir>/subagents/*.jsonl` (**D-b**).

**(3) The `contextUsage.ts` header amendment (D196).** Amend `:12-50` so it does not read as though
nothing changed. Restate the invariant that SURVIVES: **content never leaves the module, only
counters do.**

**(4) IPC — two channels, `114 → 116`.** `engine:ledger` (event) + `engine:ledger-list` (cold read),
the exact pair `session:context` / `session:context-list` already is.

## Non-Goals

- **No UI** — no Pinia store, no component, no `ProjectSettingsView.vue` section. Task 10.1-4.
- **No change to `engineLedgerCore.ts`.** 10.1-2 owns it. If a parsing bug appears, file it there;
  do not add a second parser in the service.
- **No `project_engine` settings table.** §6 assigns it to v24 "alongside 10.1's ledger columns" —
  ⚠ **that is Phase 10.3's work and it must NOT claim v24 here.** 10.1 needs no per-project toggle.
- **No backfill.** All 467 existing rows read NULL, and NULL means *unknown*.
- **No tool filtering, no proxy, no `CE_total`** (D-c: there is no price source in the schema).
- **No new dependency.** `node:sqlite` is a Node builtin, not a package.
- Do not revert or commit the pre-existing dirty files: `docs/Features/Foundation/roadmap.md`,
  `package.json`, `package-lock.json`, `src/renderer/src/components/TerminalPane.vue`, `.claude/`,
  `.procoder/`, `docs/Features/Engine/`.

## Dependencies

- **10.1-2 must land first.** This module imports the pure core's exported fold. ⚠ The names below
  are 10.1-2's to define — adapt to what it actually exports rather than inventing a second shape.
- **10.1-1 must land first.** It edits `src/main/ipc.ts` (F115's restart path at `:2258`). Two tasks
  editing one 5,610-line file in parallel is a merge conflict bought for nothing.

## Step-by-step Work

1. **Re-run G6, both halves.** AST-parse `MIGRATIONS` on every ref (never grep — the array's SQL
   contains backticks) and read `MAX(version)` from a WAL-inclusive **copy** of the installed DB.
   ⚠ **Dev worktrees share one DB**: a version claimed on a branch you cannot see fails SILENTLY.
2. **Write v24** into `storage.ts` after the v23 entry (`:1032`), following the `// vN` marker
   convention exactly. Exact SQL and comment: ImplementationSpec §1.
3. **Mirror it in `schema.ts`** after `tokensCached` (`:315`), with a comment naming the
   **three-column relationship**: `tokens_in` is the TOTAL, `tokens_cached` is a READ SUBSET of it,
   `tokens_cache_write` is the write quantity that was previously invisible inside `tokens_in`.
4. **Write the NULL rule where readers will see it**, in both files: ⚠ **NULL is UNKNOWN and must
   never be coerced to 0.** A fabricated zero reads as "this session used no cache", which is the
   exact opposite of the truth for every one of the 467 historical rows.
5. **Wire the one producer** (scope 1b): `subscriptionMeter.ts` returns `tokensCacheWrite`;
   `attributionCore`'s tokens interface carries it; `dispatchAttribution.ts` passes it where it
   already passes `tokensCached ?? null` (`:322`, `:335`, `:366`, `:482`, `:563`, `:627`). Every
   other producer writes NULL, honestly.
6. **Author `engineLedger.ts`.** Design decision and its cost argument: ImplementationSpec §2. In
   short — **computed on demand over an incremental append-only cursor, never on the hook path.**
7. **Subscribe it** in `main/index.ts` beside `:665` for the path, and to
   `agentEvents.onActivity` for the turn boundary. Do not add a new `agentEvents` listener type.
8. **Amend the `contextUsage.ts` header** (D196) — the same treatment that header gave
   `agentEvents.ts`'s promise at `:25-29`.
9. **Add the channels and schemas** to `shared/ipc.ts` after `:858`; handlers in `main/ipc.ts` after
   the `onMemoryUsage` block ends at `:5329`; forwarders in `preload/index.ts` after `:691`.
10. **Move both count assertions** to 116 — and update the running tally COMMENTS above each, not
    just the number. A count that changes with no note is the drift the tally exists to catch.

## Test Expectations

- **`src/main/db/schema.test.ts`** — extend, following the v19/v21 blocks (`:37`, `:88`):
  - `dispatches.tokensCacheWrite.name === 'tokens_cache_write'`, and the DDL string appears verbatim
    in `migrationsSource()`.
  - `notNull === false`, `hasDefault === false` — **the NULL is the semantic**.
  - The v24 statement matches no `REFERENCES`, no `NOT NULL`, no `DEFAULT`, no `CREATE INDEX`.
  - `ADD COLUMN tokens_cache_write` appears **exactly once** in the whole array.
- **The migration test that proves the NULL** — ⚠ this cannot import `storage.ts`. Slice the v24
  entry out as source text, apply it to an **in-memory `node:sqlite`** DB holding a pre-v24
  `dispatches` shape with one row already inserted, then assert the row reads
  **`tokens_cache_write === null`, and explicitly `!== 0`**. Verified this session: `ALTER TABLE`
  leaves a pre-existing row at `null`, and `node:sqlite` runs under vitest's node environment.
- **`src/shared/ipc.test.ts`** — `:3642` and `:4102` both → **116**; plus assert the two channels
  **by name** (`engine:ledger`, `engine:ledger-list`), because a count alone stays green through a
  rename (the Task 6b-1 rule at `:3645`).
- **The key-set assertion**, mirroring `:4137-4160`. ⚠ **Do NOT copy its
  `/key|secret|token|blob|fingerprint|password|value/i` loop blindly — `outputTokens` would fail it,
  and this payload IS token counts.** The correct, stronger assertion for this shape: **every value
  in the parsed totals object is a `number`**. Content can only cross as a string, so an all-numeric
  assertion structurally proves no transcript text, no path and no file name is on the wire. Keep
  `sessionId` in the envelope, not the totals. Add a name bar for `path|cwd|transcript|text|content|
  prompt|message|tool|file|name`, and a `.strict()` parse-failure test for an extra field.
- **`engineLedger.test.ts`** — against temp fixture dirs, no network, no DB:
  - A main file with no `subagents/` directory scans and reports.
  - A `subagents/` directory with two files is included, and `subagentFiles` says how many.
  - ⚠ **The partial trailing line** (a file whose last line has no `\n`) is NOT parsed and the cursor
    stops at the last newline; appending the rest on the next scan produces the same totals as one
    whole-file scan. This is the sharpest bug an incremental reader has.
  - ⚠ **Truncation invalidates**: a file that shrinks below the cached offset triggers a full
    rescan, not a negative delta.
  - A session with no readable transcript is **ABSENT from `snapshot()`**, not a row of zeros.
  - The broadcast is **edge-triggered**: a rescan that finds no new bytes fires no listener.
  - A listener that throws does not stop the others (`contextUsage.ts:139-143`).

## Verification Commands

```
npx vitest run src/main/db/schema.test.ts src/shared/ipc.test.ts src/main/services/engineLedger.test.ts
npx vitest run
npm run typecheck
git diff --stat
```

⚠ **Run `git diff --stat` after EVERY edit and confirm the line count is what you actually changed.**
`roadmap.md` and `TerminalPane.vue` hold a lone CR byte that the `Edit` tool rewrites as LF, giving a
phantom multi-thousand-line diff. `contextUsage.ts` was not flagged, but the check is not optional.

Runtime, after the migration lands (ImplementationSpec §5 has the exact commands):

1. Boot the dev app against a **throwaway `--user-data-dir`** and confirm `schema_migrations` reaches
   **24** there, read with `node:sqlite` from a copy including `-wal` and `-shm`.
2. Confirm `PRAGMA table_info(dispatches)` reports **25** columns (24 today) and that
   `tokens_cache_write` is `notnull=0`, `dflt_value=NULL`.
3. `SELECT COUNT(*) FROM dispatches WHERE tokens_cache_write IS NULL` equals the total row count
   immediately after migrating — **no backfill happened**.

## Acceptance Criteria

- v24 exists in `storage.ts` with a `// v24` marker; `MIGRATIONS.length` parses to **24**; nothing
  else in the array moved.
- `schema.ts` and the DDL agree character for character, and `schema.test.ts` proves it.
- A pre-existing row reads `null`, not `0`, after the ALTER — asserted, not claimed.
- `Object.keys(IpcChannel)` is **116**, both assertions moved, both tally comments updated.
- The key-set assertion passes and would FAIL if a string field were added to the totals.
- `contextUsage.ts`'s header names the sibling that opens many files, and still states that content
  never leaves the module.
- Full suite at **90 files / 3194 tests** or higher, all passing. `npm run typecheck` → 0 errors.
- `git diff --stat` shows no file you did not intend to touch, and no phantom line counts.

## Review Checklist

- [ ] The doc and the code both say `tokens_cached` is READS ONLY, and neither repeats the spec's
      "conflates".
- [ ] No reader anywhere coerces `tokens_cache_write` NULL to 0 — grep for `?? 0` near it.
- [ ] `tokens_in` and `tokens_cached` still mean exactly what they meant at `3e391a0`.
- [ ] v24 adds nothing but the one column — no `project_engine`, no index, no FK, no DEFAULT.
- [ ] `engineLedger.ts` never reads a whole file on a hook event, and the comment says what that
      would cost with the measured number.
- [ ] Nothing but counters crosses IPC: no path, no file name, no message text, no tool input.
- [ ] Every payload crossing the bridge is a plain object (D14) and no Zod is imported in preload (D1).
- [ ] `main/ipc.ts` parses on the way IN and on the way OUT.
- [ ] The ledger map is absent-rather-than-zero for an unmeasured session.
- [ ] 10.1-1 landed before this touched `src/main/ipc.ts`.
