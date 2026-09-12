# Task 10.1-2 — Execution Prompt (paste into a fresh session)

You are the **Coordinator** for **Task 10.1-2 — `engineLedgerCore.ts`: the whole-file scanner and
the metric (pure)**, the second task of Engine Phase 10.1.

**Repo root:** `C:\Projects\ContactEstablished\Chorus`
**Expected branch:** `main`, at **`f76770b`** ("Restore a pane's permission mode and env on restart
and reboot" — Task 10.1-1). Confirm with `git branch --show-current` and `git log --oneline -1`.
**Do not switch branches without instruction.**

---

## ⚠ GATE 0 — THIS TASK ADDS NO MIGRATION, NO CHANNEL, NO FILE I/O

`MIGRATIONS` stays at **23**; `v24` stays free and is reserved for Task 10.1-3. Confirm you did not
touch it — **AST-parse it, never grep it**, because the array's SQL contains backticks and a
backtick-based count of a backtick-containing array is a lie (roadmap rule **G6**):

```bash
node -e "const ts=require('typescript'),fs=require('fs');const sf=ts.createSourceFile('s.ts',fs.readFileSync('src/main/services/storage.ts','utf8'),ts.ScriptTarget.Latest,true);let n=null;(function v(x){if(ts.isVariableDeclaration(x)&&x.name.getText()==='MIGRATIONS'&&x.initializer&&ts.isArrayLiteralExpression(x.initializer))n=x.initializer.elements.length;ts.forEachChild(x,v)})(sf);console.log('length='+n+' nextFree=v'+(n+1))"
```

**Expected: `length=23 nextFree=v24`.** Anything else means you changed something you must not, or
another branch moved — stop and report.

The IPC channel count stays **114**: `npx vitest run src/shared/ipc.test.ts` must pass **untouched**.

---

## ⚠ GATE 1 — PRE-EXISTING DIRTY TREE. DO NOT REVERT, STAGE, OR COMMIT THESE

```
 M docs/Features/Foundation/roadmap.md
MM package-lock.json          <- ALREADY STAGED before you started; leave the index alone
MM package.json               <- ALREADY STAGED before you started; leave the index alone
 M src/renderer/src/components/TerminalPane.vue
?? .claude/
?? .procoder/
?? docs/Features/Engine/      <- this task's own documents; expected
```

⚠ **`package.json` and `package-lock.json` are staged, not merely modified.** Do not unstage them —
that would discard a staging intent that is not yours. When you commit, name your files explicitly
(`git commit -F <msg> -- <paths>`) so the rest of the index is untouched.

⚠ **Lone-CR files.** `roadmap.md` and `TerminalPane.vue` carry a lone CR byte that the `Edit` tool
rewrites as LF, producing a phantom multi-thousand-line diff. This task touches neither, but run
`git diff --stat` after every edit anyway and confirm the line count is what you actually changed.

---

## ⚠ GATE 2 — TEST BASELINE, AND IT MOVED WITH TASK 10.1-1

**Current baseline: 91 test files / 3210 tests, all passing.** (It was 90 / 3194 before 10.1-1
added `launchOptionsCore.test.ts` and its 16 cases. **The task doc for 10.1-2 still quotes the old
90 / 3194 — that figure is stale, not wrong-at-the-time.**) Your final run must be at or above
**91 / 3210**.

⚠ `--reporter=basic` does not exist in this vitest version: it fails with `ERR_LOAD_URL` and still
exits 0, so it looks green while running nothing. Use plain `npx vitest run` or `--reporter=dot`.

---

## Goal

Author the pure arithmetic and parse layer of the token ledger. Given the **text** of a main
transcript and of its subagent transcripts, produce `CE`, `RLIT`, `Naive` and raw `output_tokens` —
for the whole scan, for main alone, and for subagents alone — plus a timestamped turn series a
caller can fold into tasks, plus counters for every line refused.

No `fs`, no logging, no IPC, no schema. Task 10.1-3 owns the service that reads files and calls in.

---

## Ground yourself first — read before editing

- `docs/Features/Engine/Tasks/Task-10.1-2.md` — the authoritative scope, the eight work steps, the
  test expectations, acceptance criteria and review checklist. **Read it in full; it is the spec for
  what.**
- `docs/Features/Engine/ImplementationSpecs/ImplementationSpec-10.1-2.md` — exported shapes as real
  TypeScript, the header note text, parse rules. **The spec for how.**
- `docs/Features/Engine/Tasks/Phase-10.1-Overview.md` §2 (measured ground facts) and §3 (decisions).
- `src/main/services/contextUsageCore.ts` **in full** — this module is its *sibling* and must match
  its conventions: pure functions, `null` means "no answer" rather than zero, malformed counters
  degrade quietly, every trap carries a loud `⚠` comment.
- `src/main/services/contextUsage.ts:12-50` — the boundary note this module's header **amends**.
  Read it so the new note reads as a deliberate amendment rather than an unrelated blurb.
- `src/main/services/launchOptionsCore.ts` (landed in 10.1-1) — the most recent example of this
  repo's pure-core house style, including how a security-relevant invariant is stated in the header
  and then enforced by a type.

---

## Implementation scope

**Create exactly two files. Touch nothing else.**

1. `src/main/services/engineLedgerCore.ts`
2. `src/main/services/engineLedgerCore.test.ts`

The eight work steps are in `Task-10.1-2.md`; follow them rather than improvising. The four exports
are `ledgerEntryTotals`, `scanLedger`, `subagentDirFor`, `isSubagentTranscriptName`.

---

## Resolved decisions you are bound by

- **D196 (SETTLED 2026-09-12, Matthew) — the ledger reads the subagent directory, and the file
  filter is a security control.** The scan covers `<transcript>.jsonl` **and**
  `<transcript-dir>/subagents/agent-*.jsonl`. ⚠ **The invariant that does not move: content never
  leaves the module — only counters do.** No message text, no tool input, no file name and no path
  is retained or returned. This is enforced structurally: the input type carries no name, so a name
  cannot enter, and a test asserts the result holds no string but the `'main'`/`'subagent'`
  discriminators.

- **D-c (kickoff, 2026-09-12) — `CE_total` is NOT in v1.** No price column exists anywhere in
  `schema.ts`, so the out/in ratio has no source. ⚠ **And output must stay un-folded for a
  correctness reason too:** a fall in output tokens is the only visible signature of Claude Code's
  capability-downgrade retry disabling thinking for the rest of a conversation. A blended number
  renders that lobotomy **as a saving**.

- **The Engine spec §5 is wrong in two places; correct it in the file's own comments, not only in
  the docs**, or the next reader will "restore" the bug:
  - *"include sidechains"* is obsolete — **0 of 268 main transcripts** carry an `isSidechain: true`
    line; subagent work lives in separate files. Inverting `contextUsageCore.ts:209` changes
    nothing. Still handle `isSidechain` where it does appear (inside subagent files).
  - *"include `output_tokens` (weighted)"* — there is no ratio to weight with. Raw and separate.

---

## Measured facts this task encodes as tests — do not re-derive, do not soften

- ⚠ **`usage.iterations[]` double-counts by exactly 2.00×**, uniformly: it is carried by ~76,884 of
  ~84,100 usage-bearing entries and its length is **only ever 1 or 0, never more**. Read the parent
  `usage` only; never recurse.
- ✅ **`eph5m + eph1h === cache_creation_input_tokens` in 84,093 of 84,093 entries, 0 mismatches.**
  Assert it; on violation neither throw nor silently prefer a source — keep each metric on its
  definitionally-correct source and report `{ checked, mismatches, driftTokens }`.
- ⚠ **No real entry carries both TTLs non-zero (0 of 84,093** — 10,943 5m-only, 73,109 1h-only**).**
  A both-TTL fixture is therefore hand-built and the test must say so.
- ⚠ **228 `agent-*.meta.json` files to 227 `agent-*.jsonl` transcripts.** A glob of `agent-*` reads
  a non-transcript, and the meta carries a human-written `description` — content. The `.jsonl`
  anchor is load-bearing.
- ✅ Only `type: 'assistant'` entries carry usage (84,170 of 84,170).
- ⚠ **The corpus is live and these totals drift** — it grew by ~116 entries during the 20 minutes
  of measuring it. **Encode the shapes, never the totals.**

---

## Strict non-goals

- No `node:fs`, `node:path`, `child_process`, `logger`, `electron`, `Date.now()`, `Math.random()`
  or `process.*`. The directory rules are two **pure string functions**, not an injected `fs`.
- No edit to `contextUsageCore.ts` or `contextUsage.ts` — the header amendment to the latter belongs
  to Task 10.1-3, and two notes would drift apart.
- No `engineLedger.ts` service, no IPC channel, no Zod schema, no migration, no column, no UI.
- No `CE_total`.
- Do not revert, stage or commit anything in GATE 1.

---

## Required workflow

Coordinator pattern: implement → review against `ImplementationSpec-10.1-2.md` clause by clause →
code-quality review → resolve findings → run verification → narrate the commit.

**One intentional commit**, in this repo's house style: a concise imperative title, then
`**What this does**` in plain language a non-technical reader can follow, then `**Technical
detail**`, `**Verification**` (including an explicit `NOT verified:` list), `**Migration**` (none —
say so and say `v23` stays locked), and `**Scope**` naming what was deliberately excluded.

**Do not push and do not open a PR unless explicitly asked.** There is no `.codex/workflows/`
subagent kit in this repo; do not reference one.

---

## Verification — run these, do not reason about them

```bash
npx vitest run src/main/services/engineLedgerCore.test.ts
npm run typecheck
npx vitest run
npx vitest run src/shared/ipc.test.ts
git diff --stat
git status --porcelain
```

**Expected:** typecheck exit 0 · full suite **≥ 91 files / 3210 tests**, all passing ·
`ipc.test.ts` green untouched · `git status` shows your two new files plus exactly the GATE 1 set.

**Purity gate — ⚠ STRIP COMMENTS FIRST.** The header *names* `fs` and `logger` while explaining that
it uses neither, so a plain grep reports a pure file impure. This is the same self-matching trap the
roadmap records for `F<n>` greps, and it bit Task 10.1-1's gates too:

```bash
node -e "const s=require('fs').readFileSync('src/main/services/engineLedgerCore.ts','utf8');const code=s.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');const bad=['node:fs','node:path','child_process','setInterval','logger','electron','better-sqlite3','Date.now','Math.random','process.'];const hits=bad.filter(b=>code.includes(b));console.log(hits.length?'IMPURE: '+hits.join(', '):'CLEAN')"
```

**Expected: `CLEAN`.** Also confirm `grep -n "iterations" src/main/services/engineLedgerCore.ts`
returns **comment lines only**.

**No runtime gate.** This module is pure and reachable from nothing yet — there is no app behaviour
to observe, and claiming one would be dishonest. Its proof is the fixtures. ⚠ **Label every fixture
`real-derived` or `hand-built` in a comment**; two required cases do not exist in nature on this
machine, and a doc implying otherwise is the exact failure mode this repo keeps finding.

---

## Failure honesty

If a command fails for an unrelated environment reason, capture the exact output, explain it, and do
not claim success. If you cannot satisfy a test expectation, say which and why rather than weakening
the assertion to make it pass — a test edited to agree with the code proves nothing.

⚠ Two standing traps in this repo: **dev worktrees share one database** (verify against a throwaway
`--user-data-dir`, though this task needs no DB at all), and **the Bash tool collapses backslashes**,
so quoted heredocs are unsafe for Windows paths and regex — write scripts to a file and run them by
path.

---

## Final report — required structure

**Status:** `DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED`

**Files changed:** each with a one-line reason.

**Build results:** `npm run typecheck` exit code · `npx vitest run` counts before and after ·
purity gate output · the `iterations` grep · IPC channel count unchanged at 114 · `MIGRATIONS` = 23.

**Fixture provenance:** which fixtures are real-derived and which are hand-built, stated explicitly.

**Review outcomes:** spec-compliance and code-quality findings, and how each was resolved.

**Non-goals confirmation:**
- ✅ no migration; `MIGRATIONS` still 23, `v24` free
- ✅ no IPC channel; count still 114
- ✅ no `fs`/`path`/`logger`/clock in the module (comments stripped)
- ✅ `contextUsageCore.ts` and `contextUsage.ts` untouched
- ✅ no `CE_total`
- ✅ the result carries no string but the origin discriminators, proven by a test

**Residual risks:** anything found and deliberately not fixed, with reasoning.

**Final state:** `git status --porcelain`, commit hash and title.
