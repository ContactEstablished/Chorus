# Task 10.1-3 — Execution Prompt (paste into a fresh session)

You are the **Coordinator** for **Task 10.1-3 — Migration v24, the cache-write column, and the
ledger service**, the third task of Engine Phase 10.1 and the largest of the four.

**Repo root:** `C:\Projects\ContactEstablished\Chorus`
**Expected branch:** `main`, at **`2530a98`** ("Add the token ledger's arithmetic and parse core").
Confirm with `git branch --show-current` and `git log --oneline -1`. **Do not switch branches.**

**Both dependencies have landed:**
- `f76770b` Task 10.1-1 — the `ipc.ts` edits are in, so the file conflict that ordered these is gone.
- `2530a98` Task 10.1-2 — `engineLedgerCore.ts` exists and is what this task wraps.

---

## ⚠ GATE 0 — YOU ARE CLAIMING `v24`. RUN G6 BOTH HALVES YOURSELF FIRST.

A sweep proves a number *was* free, never that it *stays* free (roadmap **F105**), and ⚠ **dev
worktrees share one database, so a version claimed on a branch you cannot see fails SILENTLY.**

**Half one — AST-parse every ref. Never grep:** the array's SQL contains backticks, and a
backtick-based count of a backtick-containing array is a lie. That is the whole reason G6 exists.

```bash
cat > /tmp/count.cjs <<'EOF'
const ts=require('typescript');let src='';process.stdin.setEncoding('utf8')
process.stdin.on('data',c=>src+=c).on('end',()=>{const sf=ts.createSourceFile('s.ts',src,ts.ScriptTarget.Latest,true);let n=null,sp=null
;(function v(x){if(ts.isVariableDeclaration(x)&&x.name.getText()==='MIGRATIONS'&&x.initializer&&ts.isArrayLiteralExpression(x.initializer)){n=x.initializer.elements.length;sp=x.initializer.elements.filter(e=>ts.isSpreadElement(e)).length}ts.forEachChild(x,v)})(sf)
console.log('length='+n+' spreads='+sp+' nextFree=v'+(n+1))})
EOF
export NODE_PATH="C:\Projects\ContactEstablished\Chorus\node_modules"
cat src/main/services/storage.ts | node /tmp/count.cjs
for r in $(git for-each-ref --format='%(refname:short)' refs/heads refs/remotes); do
  printf "%-45s " "$r"; git show "$r:src/main/services/storage.ts" 2>/dev/null | node /tmp/count.cjs || echo "(none)"
done
```

**Half two — the store.** Copy the installed DB **with its `-wal` and `-shm`** so the live writer is
never touched, then read `SELECT MAX(version) FROM schema_migrations` with `node:sqlite`.

✅ **Measured 2026-09-12 immediately before this prompt was written** — reproduce it, do not inherit
it: half one reads **23 / 0 spreads / marker v23** on the working tree, `main`, `origin`,
`origin/main`, and **12 / 4** on the two siblings — **no branch claims `v24`**. Half two reads
**MAX(version) = 23 over 23 contiguous rows** on a 4.04 MB copy.

⚠ **The store is LIVE and its numbers drift.** `dispatches` held 467 rows at the phase kickoff and
**468** by the time this prompt was written; codex went 136 → 137. Quote what you measure, and never
inherit a count from a doc.

---

## ⚠ GATE 1 — PRE-EXISTING DIRTY TREE. DO NOT REVERT, STAGE, OR COMMIT THESE

```
 M docs/Features/Foundation/roadmap.md
MM package-lock.json          <- ALREADY STAGED before you started
MM package.json               <- ALREADY STAGED before you started
 M src/renderer/src/components/TerminalPane.vue
?? .claude/
?? .procoder/
?? docs/Features/Engine/
```

⚠ `package.json` / `package-lock.json` are **staged**, not merely modified. Do not unstage them —
that discards a staging intent that is not yours. Commit by naming your files:
`git commit -F <msg> -- <paths>`, which leaves the rest of the index alone.

⚠ **Lone-CR files.** `roadmap.md` and `TerminalPane.vue` carry a lone CR byte the `Edit` tool
rewrites as LF, producing a phantom multi-thousand-line diff. **Run `git diff --stat` after EVERY
edit** and confirm the line count is what you actually changed. This task edits `contextUsage.ts`,
`storage.ts`, `schema.ts`, `ipc.ts` and `preload/index.ts` — all pure CRLF today, but the check is
not optional.

---

## ⚠ GATE 2 — TEST BASELINE, WHICH HAS MOVED TWICE

**Current baseline: 92 test files / 3244 tests, all passing.** (90 / 3194 at the phase kickoff →
91 / 3210 after 10.1-1 → 92 / 3244 after 10.1-2. ⚠ **`Task-10.1-3.md` still quotes 90 / 3194 in two
places — stale, not wrong-at-the-time.**) Your final run must be at or above **92 / 3244**.

⚠ `--reporter=basic` does not exist in this vitest: it fails with `ERR_LOAD_URL` and still exits 0,
so it looks green while running nothing. Use plain `npx vitest run`.

---

## Goal

Give the ledger somewhere to put a number the schema has never been able to hold, and give the
renderer a way to ask for the four numbers without a single byte of transcript text crossing the
bridge. Three separable pieces: **migration v24** (one nullable column), **`engineLedger.ts`**
wrapping 10.1-2's pure core, and **two IPC channels**.

---

## Ground yourself first — read before editing

- `docs/Features/Engine/Tasks/Task-10.1-3.md` — the authoritative scope, ten work steps, test
  expectations, acceptance criteria, review checklist. **Read in full.**
- `docs/Features/Engine/ImplementationSpecs/ImplementationSpec-10.1-3.md` — the exact migration SQL
  and its comment (§1), the service design and its cost argument (§2), the channel shapes, and the
  runtime commands (§5). **The spec for how.**
- `src/main/services/engineLedgerCore.ts` — what you are wrapping. ⚠ **Adapt to what it actually
  exports** (`scanLedger`, `ledgerEntryTotals`, `subagentDirFor`, `isSubagentTranscriptName`,
  `LedgerSource`, `LedgerScan`) rather than inventing a second shape.
- `src/main/services/contextUsage.ts` **in full** — this service is its sibling (in-memory map,
  edge-triggered broadcast, `snapshot()` cold read, absent-rather-than-zero), and its header at
  `:12-50` is what you amend.
- `src/main/services/launchOptionsCore.ts` (10.1-1) — the most recent example of stating a
  security-relevant invariant in a header and then enforcing it with a type.

---

## Implementation scope

**(1) Migration `v24` — ONE nullable column, `dispatches.tokens_cache_write`.**

⚠ **THE ENGINE SPEC IS WRONG ABOUT F114's MECHANISM; CORRECT IT, DO NOT REPEAT IT.** §3.6 says
`tokens_cached` "conflates" cache reads and writes. **It does not.** Measured:

```
subscriptionMeter.ts:156   tokensIn     += (fresh ?? 0) + (cacheWrite ?? 0) + (cacheRead ?? 0)
subscriptionMeter.ts:158   tokensCached += cacheRead ?? 0
```

`tokens_cached` holds **cache READS ONLY**; cache **WRITES are folded into `tokens_in`** where no
column can recover them. The conclusion survives — CE is not computable from these columns — but the
fix is an **ADDITION, not a split** (**D-a**): one nullable column, no meanings changed, **NO BACKFILL**.

⚠ **NULL IS UNKNOWN AND MUST NEVER BE COERCED TO 0.** Every one of the ~468 existing rows will read
NULL, and a fabricated zero says "this session used no cache" — the exact opposite of the truth.
Write that rule in `storage.ts` and `schema.ts` where readers will meet it.

**(1b) Wire ONE producer — COORDINATOR'S DECISION, ALREADY TAKEN: YES, WIRE IT.**
`subscriptionMeter.ts:149` already parses `cacheWrite` and throws it away at `:156`. Return it and
carry it to the row via `attributionCore`'s tokens interface and `dispatchAttribution.ts`. The
alternative — storage-only — means every dispatch written between v24 and the writer joins the rows
that can never be recovered, and no later migration recovers data never captured. Every other
producer writes NULL, honestly.

**(2) `src/main/services/engineLedger.ts` (+ test).** The impure sibling of the pure core. Walks
`<transcript>.jsonl` **and** `<transcript-dir>/subagents/*.jsonl` (**D-b / D196**).
⚠ **Computed on demand over an incremental append-only cursor, never on the hook path** — a
whole-file scan of the largest transcript here costs ~63 ms against a sub-millisecond 256 KB tail,
and the hook bus fires several times a second. The comment must carry that measured number.

**(3) The `contextUsage.ts` header amendment (D196).** Amend `:12-50` so it does not read as though
nothing changed — the same treatment that header gave `agentEvents.ts`'s promise at `:25-29`.
⚠ Restate the invariant that **survives**: content never leaves the module, only counters do.

**(4) IPC — two channels, `114 → 116`.** `engine:ledger` (event) and `engine:ledger-list` (cold
read), the exact pair `session:context` / `session:context-list` already is. Move **both** count
assertions (`src/shared/ipc.test.ts:3642` and `:4102`) and **update the running tally comments above
each**, not just the numbers — a count that changes with no note is the drift the tally exists to catch.

---

## Resolved decisions you are bound by

- **D-a (kickoff, 2026-09-12)** — F114 takes the ADDITION. One nullable column; `tokens_in` and
  `tokens_cached` keep their present meanings; no backfill; NULL means unknown.
- **D196 (SETTLED 2026-09-12, Matthew)** — the ledger walks the subagent directory, and the file
  filter is a security control. ⚠ **Content never leaves the module — only counters do.** Never open
  `agent-<id>.meta.json`: it carries a human-written `description`. Do **not** recurse the directory.
- **D-c** — no `CE_total`; there is no price column anywhere in `schema.ts`.
- **D7** — `schema.ts` and `storage.ts` DDL are hand-mirrored; add the column in both.
- **D1** — no Zod in preload; it throws `EvalError` under CSP. Parse in main, IN **and** OUT.
- **D14** — payloads crossing the bridge are PLAIN objects; a Vue Proxy fails structured clone at
  runtime with no compile-time signal.

---

## ⚠ The key-set assertion cannot be copied, and this is the third time in this phase

`src/shared/ipc.test.ts:4137` is the precedent, and its loop bars any field name matching
`/key|secret|token|blob|fingerprint|password|value/i`. **This payload IS token counts**, so
`outputTokens` fails that bar by construction. Copying it produces a test that cannot pass.

**The correct, stronger assertion for this shape: every value in the parsed totals object is a
`number`.** Content can only cross as a string, so an all-numeric assertion structurally proves no
transcript text, no path and no file name is on the wire. Keep `sessionId` in the envelope, not in
the totals. Add a name bar for `path|cwd|transcript|text|content|prompt|message|tool|file|name`, and
a `.strict()` parse-failure test for an extra field.

⚠ **Note the pattern before you write your own gates:** two of Task 10.1-1's and one of 10.1-2's
grep gates were **self-matching** — the code documents an invariant using the words the gate
searches for, so prose describing the rule registers as a violation of it. Strip comments before
grepping, or assert on structure instead.

---

## Strict non-goals

- **No UI** — no Pinia store, no component, no `ProjectSettingsView.vue` section. That is 10.1-4.
- **No change to `engineLedgerCore.ts`.** 10.1-2 owns it; a parsing bug is filed there, never
  patched with a second parser in the service.
- **No `project_engine` table.** Engine spec §6 assigns it to v24 "alongside 10.1's ledger columns" —
  ⚠ **that is Phase 10.3's and it must NOT claim v24 here.** It takes `v25`.
- **No backfill**, no index, no FK, no DEFAULT on the new column.
- **No new dependency** — `node:sqlite` is a Node builtin, not a package.
- Do not revert, stage or commit anything in GATE 1.

---

## Required workflow

Coordinator pattern: implement → review against `ImplementationSpec-10.1-3.md` clause by clause →
code-quality review → resolve findings → verification → narrate the commit.

**One intentional commit** in house style: concise imperative title, `**What this does**` in plain
language, `**Technical detail**`, `**Verification**` with an explicit `NOT verified:` list,
`**Migration**` — this one DOES add a migration, so say `v24`, say what it adds, and say that
nothing was backfilled — and `**Scope**` naming what was deliberately excluded.

**Do not push and do not open a PR unless explicitly asked.**

---

## Verification — run these, do not reason about them

```bash
npx vitest run src/main/db/schema.test.ts src/shared/ipc.test.ts src/main/services/engineLedger.test.ts
npm run typecheck
npx vitest run
git diff --stat
git status --porcelain
```

**Expected:** typecheck exit 0 · full suite **≥ 92 files / 3244 tests** · `git diff --stat` shows
only files you meant to touch, with no phantom line counts.

⚠ **`storage.ts` CANNOT BE IMPORTED BY A TEST.** Its better-sqlite3 binding is built for Electron
ABI 148 against Node's 127 and fails to load under vitest — verified, and it is why no
`storage.test.ts` exists and why `dispatches.test.ts` imports only the *type*. The migration test
slices the v24 entry out as **source text** and applies it to an in-memory **`node:sqlite`** DB.

**Runtime gate — required, and it is the first one this phase has that touches a database.**
Against a **throwaway `--user-data-dir`**, never the shared dev DB:

1. `schema_migrations` reaches **24** there — read with `node:sqlite` from a copy including `-wal`
   and `-shm`, so the live writer is never touched.
2. `PRAGMA table_info(dispatches)` reports **25** columns (24 today), with `tokens_cache_write` at
   `notnull=0`, `dflt_value=NULL`.
3. `SELECT COUNT(*) FROM dispatches WHERE tokens_cache_write IS NULL` equals the total row count
   immediately after migrating — **proving no backfill happened**.

⚠ **Getting a seeded dev instance to use your throwaway dir is harder than it looks, and the
documented route does not work.** Setting `ELECTRON_CLI_ARGS` in the environment is silently
overwritten: `electron-vite`'s CLI does `if (options['--']) process.env.ELECTRON_CLI_ARGS = …`, and
cac gives `options['--']` an **empty array** when there are no passthrough args — which is truthy —
so your value becomes `"[]"` and `--user-data-dir` never reaches the main process. Passing it after
`--` through npm or PowerShell also fails (cac camel-cases it to an unknown `--userDataDir`). The
route that worked for Task 10.1-1 was seeding the dev instance's own user-data-dir
(`%APPDATA%\chorus`) after backing it up. ⚠ **If you do that, back it up ONCE and never re-run the
backup step** — running the seeder twice overwrites the backup with an already-seeded state, which
is exactly what happened in 10.1-1 and cost the original layout.

⚠ **Kill the dev instance by `Name='electron.exe'` AND a `*remote-debugging-port=9222*` command
line.** A bare `*9222*` substring also kills Chrome renderers and the querying shell.

---

## Failure honesty

If a command fails for an unrelated environment reason, capture the exact output, explain it, and do
not claim success. If a test expectation cannot be met, say which and why rather than weakening the
assertion — a test edited to agree with the code proves nothing.

⚠ **Never report a negative from an instrument you have not validated.** In 10.1-1 a process-env
read returned "variable absent" when it had in fact failed outright; validating the reader against a
process whose environment was known is what caught it. Prove your instrument can see a positive
before you report an absence.

---

## Final report — required structure

**Status:** `DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED`

**Files changed:** each with a one-line reason.

**G6 evidence:** both halves, with the numbers you measured — not the ones above.

**Build results:** typecheck exit code · suite counts before and after · `git diff --stat`.

**Runtime results:** the three database assertions, with the actual values observed.

**Review outcomes:** spec-compliance and code-quality findings, and how each was resolved.

**Non-goals confirmation:**
- ✅ `MIGRATIONS` = 24, one column added, no backfill, no index/FK/DEFAULT
- ✅ no `project_engine`; `v25` still free for Phase 10.3
- ✅ IpcChannel = 116, both assertions and both tally comments updated
- ✅ no UI, no change to `engineLedgerCore.ts`, no new dependency
- ✅ nothing but counters crosses IPC, proven by an all-numeric assertion

**Residual risks:** anything found and deliberately not fixed, with reasoning.

**Final state:** `git status --porcelain`, commit hash and title.
