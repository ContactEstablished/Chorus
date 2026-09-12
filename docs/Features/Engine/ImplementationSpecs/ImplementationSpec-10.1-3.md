# Implementation Spec 10.1-3 — v24, `tokens_cache_write`, and `engineLedger.ts`

Companion to `Tasks/Task-10.1-3.md`: exact SQL, exact shapes, exact insertion points, and the
rationale that must survive into the code as comments. Every line number was read this session at
`3e391a0` — re-read before you paste.

---

## 1. Migration v24, and the schema.ts mirror (D7)

Insert after the v23 entry (it ends at `storage.ts:1032`), before the `]` at `:1033`, adding a `,` to
v23's closing backtick. The same `,` is needed after `VoiceModelStatus` for §4's channels.

```ts
  // v24 (Phase 10 / Engine 10.1 / D-a, correcting F114): the cache-WRITE
  // quantity. ONE nullable column, and it is an ADDITION, not a split.
  // ⚠ THE ENGINE SPEC §3.6 IS WRONG ABOUT THE MECHANISM AND THIS IS THE
  // CORRECTION. It says `tokens_cached` "conflates" cache reads and writes. It
  // does not. `subscriptionMeter.ts:156` adds fresh + cacheWrite + cacheRead
  // into `tokensIn`; `:158` adds cacheRead alone into `tokensCached` — the
  // convention that module's own header states at `:44-45` and
  // `attributionCore.ts:352-357` repeats. So `tokens_cached` is cache READS
  // ONLY and a SUBSET of `tokens_in`; the WRITES are already inside `tokens_in`
  // and unrecoverable. The spec's CONCLUSION stands — the ledger cannot express
  // CE from these columns — but the fix is one more column, not a re-meaning of
  // two. NOTHING ABOVE THIS LINE CHANGES MEANING.
  //
  // ⚠ THE NUMBER WAS COMPUTED, NOT COPIED (G6, both halves, 2026-09-12): the
  // array AST-parses to 23 with highest marker v23 on every ref, and the
  // installed DB (read from a COPY with `-wal`/`-shm`) reports MAX(version)=23.
  // ⚠ NULLABLE, NO DEFAULT, NO FK, NO INDEX — the NULL is the whole point. All
  // 467 dispatch rows that exist today get NULL, which honestly means
  // "unknown". `NOT NULL DEFAULT 0` would write "this dispatch used no cache"
  // onto every historical row — the OPPOSITE of the truth for an agent against
  // a large CLAUDE.md — and no reader could tell that fabrication from a
  // measured zero. Same ruling as v22's `reasoning_efforts`; the opposite of
  // v21's counters, whose `DEFAULT 0` was true. ⚠ RENDER NULL AS UNKNOWN, NEVER
  // COERCE IT TO 0. NO BACKFILL (D-a). No index (reads are by primary key), no
  // FK — D16(d): this is history.
  `ALTER TABLE dispatches ADD COLUMN tokens_cache_write INTEGER;`
```

⚠ **`project_engine` MUST NOT ride along.** §6 puts it in "migration **v24**, alongside 10.1's ledger
columns". It is Phase 10.3's table and would claim a version 10.3 then cannot use; it takes **v25**.

**The D7 mirror**, in `schema.ts` after `tokensCached` (`:315`), before `costUsd` (`:316`). The
comment at `:313-314` stays — it is about `tokens_cached` and it is still true. ⚠ `:687-690` and
`:716-717` carry their own `tokens_*` on other tables; **only `dispatches` changes**, so scope the
edit by line, not by symbol.

```ts
  tokensCached: integer('tokens_cached'),
  /* ── v24 (D-a, correcting F114): the third column, and the relationship ──
   * `tokens_in`          the TOTAL prompt side: fresh + cache write + cache read
   * `tokens_cached`      a SUBSET of `tokens_in` — cache READS ONLY
   * `tokens_cache_write` the cache WRITE quantity, previously folded into
   *                      `tokens_in` with no way back out
   *
   * Not disjoint, and never to be summed: `tokens_in` already contains both of
   * the others. Reads price at ~0.1x fresh input and writes at 1.25x (5-min
   * TTL) or 2.0x (1-hour) — 12.5-20x apart, moving in OPPOSITE directions under
   * a context engine, which is why the ledger could not express CE until this
   * column existed. ⚠ NULL MEANS UNKNOWN, NOT ZERO, AND A READER THAT WRITES
   * `?? 0` IS A BUG: a zero claims the 467 pre-v24 rows used no cache.
   */
  tokensCacheWrite: integer('tokens_cache_write'),
  costUsd: real('cost_usd'),
```

## 2. `engineLedger.ts` — polled, event-driven, or on demand?

**On demand, over an incremental append-only cursor, and NEVER on the hook path.** The cost
difference is the argument, measured this session rather than asserted:

| what | bytes | measured |
|---|---|---|
| `contextUsage` tail read (`TAIL_BYTES`, `:63`) | 262,144 | sub-ms, throttled to 1/s (`:75`) |
| largest Chorus transcript, whole file | 19,540,543 | **63 ms** (46 read + 17 parse), 591 lines |
| heaviest subagent session measured | 11,884,923 | 10 files (9 subagents) |

**A whole-file scan is ~75x the tail's bytes and allocates ~19.5 MB in the process that owns every
PTY**, and Claude fires PreToolUse + PostToolUse per tool call, several per second (`:69-73`). So:

- ❌ **Hook-event-driven** (contextUsage's own shape): correct for 256 KB; a 63 ms scan and 19.5 MB
  of garbage several times a second is a GC storm in main. ❌ **Polled**: a timer pays the full cost
  for every live session whether anything changed or not. Both rejected on the measurement.
- ✅ **On demand + incremental**: transcripts are **append-only JSONL**, so cache
  `{ size, mtimeMs, offset, totals }` per file and read only `[offset, size)` on a rescan — 63 ms
  **once**, then the delta (a few KB), one `stat` per known file and one `readdir`. Recompute fires at
  the **turn boundary** (`agentEvents.onActivity` reporting an activity no longer `'working'`, at most
  once per model turn — median 1.8 min, `agentEventsCore.ts:291`) plus the throttled cold read.

```ts
export interface EngineLedgerTracker {
  /** RECORDS THE PATH AND READS NOTHING — one map write, per hook event. */
  noteTranscript(sessionId: string, transcriptPath: string): void
  /** Rescan from the cursor. Async, throttled, fire-and-forget by contract. */
  refresh(sessionId: string): void
  ledgerFor(sessionId: string): EngineLedgerTotals | null
  snapshot(): ReadonlyArray<{ sessionId: string; ledger: EngineLedgerTotals }>
  onLedger(listener: EngineLedgerListener): () => void
  forget(sessionId: string): void
  dispose(): void
}
```

File set, per **D-b**: `<transcript>.jsonl` **plus** `<dir>/<basename without .jsonl>/subagents/*.jsonl`
— a main-file-only scan under-reads CE by ~2.5x and RLIT by up to 90% on the sessions that cost most.

⚠ **Invalidation, each its own test.** `size < cachedOffset`, or `mtimeMs` going backwards →
truncated, rotated or compacted: discard and full-rescan. **The cursor advances only to the last
`\n`**; a partial trailing line is carried, never parsed — the file is being written while we read
it. ⚠ **Read the parent `usage` only**: `usage.iterations[]` repeats the same counters (30,404
entries carry one) and a walker that descends double-counts. ⚠ Assert
`ephemeral_5m + ephemeral_1h === cache_creation_input_tokens` (0 mismatches across 118 files),
surfacing a violation as a counter rather than silently preferring one source.

⚠ **The pure/impure line.** This file does `readdir`, `open`, `read`, `stat`, `Date.now`, `logger`;
everything that turns text into numbers is **10.1-2's `engineLedgerCore.ts`**, whose export names are
**10.1-2's to define** — adapt to them, do not write a second parser. Copy `contextUsage.ts` in shape:
`record()` (`:124-145`) with its per-listener try/catch, the silent-failure read posture (`:150-158`),
the in-flight guard (`:111`), absent-rather-than-zero.

## 3. The header amendment (D196)

`contextUsage.ts:24-49` promises one file, a 256 KB tail, three integers. 10.1 adds a sibling that
opens many files and walks a directory. Amend in place — the treatment this header gave
`agentEvents.ts` at `:25-29`. Keep points 1, 2 and 4: **this module's own behaviour has not changed.**
After point 3, record that `engineLedger.ts` consumes the SAME `transcript_path` and reads **whole
files plus the `subagents/` directory beside them**, so "one file, a 256 KB tail" is no longer the
whole of what this path leads to; and say what that costs — main now reads tens of MB from a path a
hook body named, bounded by the same per-session capability token and never echoed where the caller
can observe it. ⚠ **Restate the surviving invariant, in both files:** *content never leaves the
module — only counters do.* No message text, no tool input, no file name, no path is retained,
broadcast, logged or returned over IPC — unchanged by the widening, and what §4's key-set test pins.

## 4. IPC — two channels, `114 → 116`

Into `shared/ipc.ts` after `VoiceModelStatus` (`:858`), before `} as const` (`:859`). The
`session:context` pair's exact shape (`:72`/`:75`) and exact reason: a live per-session number held
in main's memory, never a column, plus the cold read a renderer reload would otherwise paint blank.
`engine:` is reserved as the namespace; 10.3's toggles join it.

```ts
  /** event (main -> renderer): this session's ledger changed. Edge-triggered —
   *  a rescan that finds no new bytes sends nothing. */
  EngineLedger: 'engine:ledger',
  /** invoke: a PURE READ of main memory. May SCHEDULE a rescan, never await. */
  EngineLedgerList: 'engine:ledger-list'
```

⚠ **`CE_total` is deliberately absent (D-c)** — no table in the schema has a price column
(`model_catalog`, `:460`, included), so a ratio here would be an unsourced constant inside the one
number the phase exists to trust; `outputTokens` is reported RAW because a fall in output is the
signature of a silent thinking-disable (spec §7) that a blended total would hide as a saving.
⚠ **Every field is a number, and that is a security property, not a style**: content can only cross
as a string, so an all-numeric payload cannot carry a message, tool input, file name or path.
⚠ `sessionId` therefore lives in the **envelope**, never in the totals. ⚠ `ce` is **not an integer**
(`input + 1.25·eph5m + 2.0·eph1h + 0.1·cache_read`); `rlit` is `input + cache_creation`, exactly what
ITPM charges; `naive` adds `cache_read` and is the metric that lies — reported beside `ce` because
the gap between them is the finding (D195(c)).

```ts
export const engineLedgerTotalsSchema = z
  .object({
    ce: z.number().nonnegative(),
    rlit: z.number().int().nonnegative(),
    naive: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    entries: z.number().int().nonnegative(),
    /** `subagentFiles` is the D-b widening, counted apart from `files`. */
    files: z.number().int().nonnegative(),
    subagentFiles: z.number().int().nonnegative(),
    cacheBreakdownMismatches: z.number().int().nonnegative()
  })
  .strict()
export const engineLedgerEventSchema = z
  .object({ sessionId: z.string().min(1), ledger: engineLedgerTotalsSchema })
  .strict()
export const engineLedgerListResponseSchema = z
  .object({ ledgers: z.array(engineLedgerEventSchema) })
  .strict()
export type EngineLedgerTotals = z.infer<typeof engineLedgerTotalsSchema>
export type EngineLedgerEvent = z.infer<typeof engineLedgerEventSchema>
export type EngineLedgerListResponse = z.infer<typeof engineLedgerListResponseSchema>
```

**`main/ipc.ts`** — after the `onMemoryUsage` block ends at `:5329`, before the `// 3a-3: the FIFTH
independent onExit listener` comment at `:5331`. Thread the tracker as the fourteenth service
parameter, beside `contextUsage: ContextUsageTracker` (`:636`), and parse **out** as well as in — the
`sessionContextEventSchema.parse` shape at `:5284`. ⚠ `snapshot()` must return **plain objects** (D14):
anything reactive or class-shaped fails structured clone at runtime with no compile signal.

```ts
  engineLedger.onLedger((sessionId, ledger) => {
    const event = engineLedgerEventSchema.parse({ sessionId, ledger })
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IpcChannel.EngineLedger, event)
  })
  ipcMain.handle(IpcChannel.EngineLedgerList, (): EngineLedgerListResponse => {
    return engineLedgerListResponseSchema.parse({ ledgers: engineLedger.snapshot() })
  })
```

**`preload/index.ts`** — after `getSessionContexts` (`:690-691`), before the Task 6b-1 comment
(`:693`): `onEngineLedger` and `getEngineLedgers`, copied line for line from `onSessionContext`
(`:682-688`) and `getSessionContexts` with the types swapped. **No Zod** (D1 — a preload Zod import
throws `EvalError` under the page CSP and silently drops events) and no logic of any kind between
`ipcRenderer` and the callback. **`main/index.ts`** — construct beside `createContextUsageTracker`
(`:645`); subscribe inside the existing `agentEvents.onTranscriptPath` callback (`:664-668`), one
line below `:665`. `onActivity` already fires edge-triggered, so no new listener type is needed.

## 5. Verification

```
# G6 half one — AST, never grep (the array's SQL contains backticks)
node -e "const ts=require('typescript');const s=require('fs').readFileSync('src/main/services/storage.ts','utf8');const sf=ts.createSourceFile('s',s,99,true);let n=0,sp=0;sf.forEachChild(function w(x){if(ts.isVariableDeclaration(x)&&x.name.getText()==='MIGRATIONS'&&x.initializer&&ts.isArrayLiteralExpression(x.initializer)){n=x.initializer.elements.length;sp=x.initializer.elements.filter(ts.isSpreadElement).length}x.forEachChild(w)});console.log('MIGRATIONS',n,'spreads',sp)"

# G6 half two + the post-migration column state — against a COPY (+ -wal, -shm)
node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1]);console.log(db.prepare('SELECT MAX(version) v, COUNT(*) n FROM schema_migrations').get());console.log(db.prepare('PRAGMA table_info(dispatches)').all().filter(c=>c.name.startsWith('tokens_')));console.log(db.prepare('SELECT COUNT(*) total, SUM(tokens_cache_write IS NULL) nulls FROM dispatches').get())" <copy-of-chorus.db>
```

- ✅ Expected: `MIGRATIONS 24 spreads 0`; four `tokens_*` columns, `tokens_cache_write` at
  `notnull: 0, dflt_value: null`; `nulls === total` right after migrating. ⚠ Against a **throwaway
  `--user-data-dir`**, never the shared dev DB: worktrees share one database and a version claimed
  elsewhere no-ops silently, since the runner keys off `MAX(version)`.
- **Runtime, live app:** launch a claude pane, let it run one turn, confirm from the main log that
  `refresh` ran **once** at the turn boundary and not per hook event — the whole design rests on that
  and no unit test can make the claim — then that the renderer received an `engine:ledger` event
  carrying only numbers (`Object.values(payload.ledger).every(v => typeof v === 'number')`, DevTools
  console). ⚠ **Do not claim a runtime verification you did not run.**
