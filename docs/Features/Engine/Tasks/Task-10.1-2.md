# Task 10.1-2 — `engineLedgerCore.ts`: the whole-file scanner and the metric (pure)

**Phase:** Engine 10.1 · **Depends on:** None · **Owns:** `src/main/services/engineLedgerCore.ts`, `src/main/services/engineLedgerCore.test.ts`

---

## Source Of Truth

- `docs/Features/Engine/chorus-engine-spec.md` — **§5 Phase 10.1** (the four numbers, the sibling
  rule, the boundary warning), **§4** (where the `1.25` / `2.0` / `0.1` weights come from), **§7**
  (why a fall in output tokens is a quality signal, not a saving), **§8** D195.
- `docs/Features/Engine/Tasks/Phase-10.1-Overview.md` — measured ground facts and **D-a/D-b/D-c**;
  this task implements the D-b and D-c halves.
- Convention to follow: `src/main/services/contextUsageCore.ts` — this module is its **sibling**,
  not an edit to it: same pure shape, same `null`-means-no-answer rule, same
  degrade-a-malformed-counter-to-zero rule, same loud `⚠` above every trap.
- `src/main/services/contextUsage.ts:12-50` — the boundary/security note this module's header
  **amends** (D196). Verified: the block opens at line 12 and closes at line 50.

## Initial Starting Point (verified 2026-09-12 at `3e391a0`)

- **No engine code exists.** `src/main/services/` contains no `engineLedger*` file.
- `contextUsageCore.ts` is 343 lines; its sidechain skip is at **line 209**, verbatim
  `if (e.isSidechain === true) continue`. This task does **not** touch it.
- ✅ Baseline suite, run this session: **90 test files / 3194 tests, all passing**, `exit 0`.
- Corpus walked this session under `~/.claude/projects/`: **44 project dirs · 268 main transcripts ·
  227 subagent transcripts in 83 `subagents/` dirs · 84,093–84,209 usage-bearing entries** — the
  range is not sloppiness, the corpus grew by 116 entries during the 20 minutes of measuring it.

## Goal

Author the pure arithmetic and parse layer for the token ledger: given the **text** of a main
transcript and of its subagent transcripts, produce `CE`, `RLIT`, `Naive` and raw `output_tokens`
— for the whole scan, for main alone, for subagents alone — plus a timestamped turn series a caller
can fold into tasks and counters for every line refused. No fs, no logging, no IPC, no schema;
Task 10.1-3 owns the service that reads the files and calls into this.

## Exact Scope

Create exactly two files — `src/main/services/engineLedgerCore.ts` and
`src/main/services/engineLedgerCore.test.ts`. Touch nothing else.

## Non-Goals

- **No I/O of any kind** — no `node:fs`, no `node:path`, no `logger`, no `Date.now()`. The scanner
  is handed strings; the directory walk is two pure string rules (step 6), not an injected `fs`.
- **No edit to `contextUsageCore.ts` or `contextUsage.ts`.** The amendment to `contextUsage.ts`'s
  own header is Task 10.1-3's; duplicating it here would leave two notes to drift apart.
- No `engineLedger.ts` service, IPC channel, Zod schema, migration, column or UI. **No `CE_total`**
  either — dropped from v1 by D-c; see step 2.
- Do not revert or commit the pre-existing modified/untracked files in the overview's standing rules
  (`roadmap.md`, `package*.json`, `TerminalPane.vue`, `.claude/`, `.procoder/`, `docs/…/Engine/`).

## Dependencies

**None.** It is pure, it depends on no other task in the phase, and it can be written first.

## Step-by-step Work

1. **The per-entry arithmetic, `ledgerEntryTotals(usage: unknown)`.** Four numbers from one
   `message.usage` object, `null` when it carries no counters at all — the `claudeUsedTokens`
   contract, for the same reason ("no usage block" is not "zero tokens").

   ```
   CE     = input_tokens + 1.25·eph5m + 2.0·eph1h + 0.1·cache_read_input_tokens
   RLIT   = input_tokens + cache_creation_input_tokens          # exactly what ITPM charges
   Naive  = input_tokens + cache_creation_input_tokens + cache_read_input_tokens
   output = output_tokens                                        # raw, never folded in
   ```

   ⚠ **`CE` reads the TTL breakdown; `RLIT` and `Naive` read the scalar** — deliberate, not an
   inconsistency. CE's whole content is the TTL weighting, which the scalar cannot supply; ITPM
   charges the scalar. They agree in every real entry (step 4); when they do not, each metric keeps
   the source that is definitionally correct for it.

2. **Four numbers, never three, and no blend.** `CE_total` is **out of v1**: there are no price
   columns anywhere in `schema.ts` (`model_catalog` at `:460` has `contextLength` and
   `reasoningEfforts`, no price), so the out/in ratio has no source and a hardcoded one would put an
   unsourced constant inside the one number the phase exists to trust. ⚠ **And output must stay
   un-folded for a correctness reason, not only a sourcing one:** §7 records that Claude Code's
   capability-downgrade retry disables thinking for the rest of a conversation, whose *only* visible
   signature is output tokens falling. A blended `CE_total` renders that lobotomy as a saving.

3. **The `iterations` trap — the loudest comment in the file.** ⚠ `usage.iterations[]` repeats the
   parent's counters *and* a nested `cache_creation`. Measured corpus-wide this session: ✅ **76,884 of
   ~84,100 usage-bearing entries carry one, `iterations.length` being 1 in 76,878 and 0 in 6 — never
   more.** So summing iterations as well as the parent inflates by **exactly 2.00×**, uniformly; on
   the largest Chorus transcript, both ways: `CE 9,197,338 → 18,394,675`, `RLIT 2,453,116 →
   4,906,232`, `Naive 45,379,703 → 90,759,406`. **Read the parent `usage` only. Never recurse.**

4. **The free consistency check.** `eph5m + eph1h === cache_creation_input_tokens` held in
   ✅ **84,093 of 84,093 entries across all 495 transcript files — 0 mismatches**. Assert it, and on
   violation **neither throw nor silently prefer a source**: keep each metric on its own source
   (step 1) and report `{ checked, mismatches, driftTokens }`, `driftTokens` being the signed
   `(eph5m + eph1h) − cache_creation_input_tokens`. A missing `cache_creation` object is the
   degenerate case of the same check and needs no second counter.

5. **Malformed input is a value, never a throw.** A transcript is appended to as it is read, so
   the last line is routinely a partial write. `JSON.parse` failures are counted and skipped in
   silence — no `logger`, matching `parseClaudeTranscriptTail`'s stated posture.

6. **The directory rules, as two pure string functions.** `subagentDirFor(transcriptPath)` →
   `<dir>/<basename minus .jsonl>/subagents`, or `null` when the input does not end `.jsonl`.
   `isSubagentTranscriptName(fileName)` → `/^agent-[^\\/]+\.jsonl$/i`. ⚠ **The `.jsonl` anchor is
   load-bearing:** every subagent transcript has an `agent-<id>.meta.json` sibling and there are
   **228 meta files to 227 transcripts** — one subagent wrote a meta and never a transcript, so a
   glob of `agent-*` reads a file that is not one. The meta also carries a human-written
   `description` (measured: `"Write Impl-18-3"`) — **content**, which the header note forbids
   opening.

7. **`scanLedger(sources)` — whole-file, many files, no names.** Input is
   `readonly { origin: 'main' | 'subagent'; text: string }[]`. ⚠ **The input type carries no file
   name and no path, and that is the header note's enforcement mechanism, not a convenience** — a
   name that never enters cannot be returned. Output: `total` / `main` / `subagent` totals,
   `subagentSources`, an ordered `turns[]`, `consistency`, `skips`. Only `type: 'assistant'` entries
   carry usage (✅ measured: **84,170 of 84,170**), so filter on it.

8. **Per-task normalisation, honestly.** §5 requires normalising per *completed task*. ⚠ **Task
   boundaries are not knowable from a transcript.** Its per-entry fields are `uuid`, `parentUuid`,
   `sessionId`, `requestId`, `timestamp`, `cwd`, `gitBranch`, `version`, `effort` — none marks
   "done", and §7's own A/B protocol defines a task externally (three shapes × five reps, git-reset
   between runs). So **this core reports per-scan totals plus an ascending, timestamped `turns[]`,
   and per-task folding is the caller's job**: 10.1-3 joins a `[startedAt, endedAt]` window from the
   `dispatches` row onto the series, 10.1-4 presents it. Every usage-bearing entry carried a string
   `timestamp` (84,114/84,114) so the series is dense; `at` stays `number | null` and a null-`at`
   turn counts into the totals but cannot be windowed. ⚠ Comment that the timestamp is when the
   reply was *written* while its tokens were charged for the request before it, so one turn can
   land on the wrong side of a window boundary.

### The two places §5 is wrong — ⚠ put this in the file's comments, not only in this doc

Otherwise the next reader "restores" the sidechain inversion.

| §5 says | Measured, this session | What this task does |
|---|---|---|
| "include sidechains (else work pushed into subagents looks free)" — implementable only as inverting `contextUsageCore.ts:209` | ✅ **0 of 268 main transcripts contain an `isSidechain: true` line.** Claude Code 2.1.259 writes subagent work to `<sessionId>/subagents/agent-*.jsonl`. Inverting line 209 changes nothing. | Walk the subagent directory (step 6). Still handle `isSidechain` where it *does* appear — it is `true` on **109 of 109** lines of a sampled subagent file. |
| "include `output_tokens` (weighted)" | The weight needs an out/in price ratio; no price column exists in the schema. | Report `output_tokens` **raw and separate** (D-c, step 2). |

**Why the widening is not optional.** Main-only versus main+subagents, recomputed this session on
two real `C--Projects-Bryk-Site-Bryk` sessions — subagent share of each metric:

| session | subagent files | of CE | of RLIT | of Naive |
|---|---|---|---|---|
| ✅ `28b8a03a` | 7 | 61.0% | 74.8% | 57.8% |
| `a9f05535` | 8 | 64.9% | **90.5%** | 45.2% |

A main-only ledger under-reads CE by ~2.5× and RLIT — the quantity that charges against rate
limits — by up to 10×, on exactly the sessions that cost the most.

## Test Expectations

New file `engineLedgerCore.test.ts`, vitest, `environment: 'node'`, no `fs` mocks because there is
no `fs` to mock. ⚠ **Label every fixture real-derived or hand-built in a comment** — two required
cases do not exist in nature on this machine, and a doc implying they do is the failure mode this
repo keeps finding.

- **Real-derived** (copy the captured shape verbatim — `service_tier`, `inference_geo`, `speed`,
  `output_tokens_details`, `server_tool_use` included, so an unknown key cannot break the parse):
  a 1-hour-TTL entry (`input 2`, `cache_creation_input_tokens 17996`, `eph1h 17996`, `eph5m 0`,
  `cache_read 27883`, `output 106`) and a 5-minute-TTL entry from a real subagent file
  (`cache_creation_input_tokens 10512`, `eph5m 10512`, `eph1h 0`, `cache_read 5599`).
  ⚠ **No real entry anywhere carries BOTH TTLs non-zero — 0 of 84,093** (10,943 5m-only, 73,109
  1h-only). A both-TTL fixture is therefore **hand-built** and must say so.
- **Real-derived:** an `iterations` array repeating its parent exactly, where breaking the rule
  gives exactly 2× — so a regression is unmissable rather than a plausible drift.
- **Real-derived:** a subagent source whose every line carries `isSidechain: true`, proving those
  lines are counted rather than skipped. Plus a **hand-built** main-transcript line carrying it — 0
  of 268 real ones do; the test pins the decision that the flag does not gate the sum.
- **Hand-built:** a trailing partial line (a real line truncated mid-object), empty string, `null`
  JSON, a bare array, `{}`, and `message.usage` present but empty. None throws; each lands in a
  `skips` counter; the surrounding real lines still total correctly.
- **Hand-built:** a `cache_creation` whose halves do not sum to the scalar → `mismatches: 1`, signed
  `driftTokens`, `CE` still on the breakdown, `RLIT` still on the scalar, no throw.
- `subagentDirFor` on a Windows path, a POSIX path, no separator, a non-`.jsonl` path (→ `null`) and
  `.JSONL`. ⚠ **Assert separator preservation** — `node:path` is banned, a hardcoded `\` fails CI.
- `isSubagentTranscriptName` accepts `agent-a462ae42617c35be5.jsonl`; **rejects
  `agent-a462ae42617c35be5.meta.json`** (the 228-vs-227 trap); rejects `foo.jsonl`,
  `../agent-x.jsonl` and `sub\agent-x.jsonl` (the separator class doubles as a traversal guard).
- **Per-source breakdown:** two main + three subagent sources; `main + subagent === total` on all
  four numbers, `subagentSources === 3`, and a zero-source scan returns zeros with `entries: 0`
  rather than `null`. `turns[]` ascending by `at`, interleaved across origins, null-`at` last.
- ⚠ **A test asserting the result contains no string anywhere except the `origin` discriminators**
  — walk it with `JSON.stringify` and a type check. This is the header note's invariant as an
  assertion, and the one test that fails when someone later adds a helpful `fileName` field.

## Verification Commands

```
npx vitest run src/main/services/engineLedgerCore.test.ts
npm run typecheck
npx vitest run
```
In a worktree, junction the main checkout's `node_modules` in first and remove it after.

## Acceptance Criteria

- Both files exist; `git status --porcelain` shows no other tracked file changed.
- Purity check passes. ⚠ **Strip comments first** — the header names `fs` and `logger` while saying
  it uses neither, so a plain grep reports a pure file impure:

  ```
  node -e "const s=require('fs').readFileSync('src/main/services/engineLedgerCore.ts','utf8');const code=s.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');const bad=['node:fs','node:path','child_process','setInterval','logger','electron','better-sqlite3','Date.now','Math.random','process.'];const hits=bad.filter(b=>code.includes(b));console.log(hits.length?'IMPURE: '+hits.join(', '):'CLEAN')"
  ```
- `grep -n "iterations" src/main/services/engineLedgerCore.ts` returns comment lines only.
- The header note is present and contains the sentence that content never leaves the module.
- Full suite at or above baseline: **90 files / 3194 tests**, all passing; `npm run typecheck` → 0.

## Review Checklist

- [ ] Every export is pure — same inputs, same output, no ambient reads, no clock.
- [ ] Four numbers together everywhere; no code path returns `CE` alone, and `output_tokens` is raw
      and never added into `CE`, `RLIT` or `Naive`.
- [ ] `CE_total` does not appear, and a comment says why (no price source; a blend hides a
      thinking-disable as a saving). The `iterations` comment carries the measured 2.00×.
- [ ] A consistency violation produces counters and correct-per-metric sourcing — never a throw,
      never a silent choice of source.
- [ ] No `fs`; the input type carries no file name or path; the result carries no string but
      `'main'` / `'subagent'`, and a test proves it.
- [ ] The spec-correction table's substance, and the per-task answer (core per-session, caller
      folds), are in the file's own comments and not only in this doc.
