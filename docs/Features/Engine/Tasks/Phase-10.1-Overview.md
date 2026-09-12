# Engine — Phase 10.1 Overview: the token ledger and the A/A gate

**Created** 2026-09-12 by the phase kickoff. **Phase 10 admitted** 2026-09-04 by
D191. **Nothing in Phase 10 is built yet; this is the first slice.**

Spec: [`../chorus-engine-spec.md`](../chorus-engine-spec.md) §5.
Roadmap: [`../../Foundation/roadmap.md`](../../Foundation/roadmap.md) §7, Phase 10.
Decisions **D191–D195** (admitted) + **D196** (settled at this kickoff).
Findings **F110–F115** (admitted) + **F116–F117** (measured at this kickoff).

---

## 1. The phase contract

10.1 builds **the instrument**, not the optimisation. Every later tier — the
symbol index (10.2), tool-output filtering (10.3), the codex proxy probe (10.4)
and the Claude proxy that D194 refuses to build — is an argument that cannot be
settled without a trustworthy number. This slice produces that number.

**It ships value even if every later tier is killed.** The deliverable is a usage
panel that answers "what did this session actually cost", which nothing in Chorus
can answer today: **403 of 467 dispatches in the installed database carry no token
data at all** (verified three ways that agree exactly; the complement, 64, matches
`tokens_source IS NOT NULL` precisely).

**What it is not.** 10.1 changes nothing about how an agent runs. It reads
transcripts the agents already write and reports four numbers. It installs no
hook, rewrites no request, and points no agent at anything.

**The honesty clause, inherited from D195 and binding on every task here.** The
panel reports **measured** quantities on **this machine**. A gate that holds is
not evidence of "no quality loss" and must never be reported as such. `Naive` is
displayed *deliberately* beside `CE` because **the gap between them is the
finding**, not because it is a number anyone should act on.

---

## 2. Verified ground facts (measured 2026-09-12 at `3e391a0`, not recalled)

### 2.1 G6 — both halves, run as a procedure

**Half one, AST-parsed** (never grepped — the array's SQL contains backticks,
which is the exact mis-measurement G6 exists to stop):

| ref | `MIGRATIONS.length` | spreads | highest `// vN` |
|---|---|---|---|
| working tree · `main` · `origin/main` · `origin` | **23** | 0 | v23 |
| `worktree-agent-ac607b24c8ebfc41d` | 12 | 0 | v12 |
| `chorus/Chorus/39b6f2fe` | 4 | 0 | v4 |

**No branch claims `v24`.** ✅ The two instruments remain **converged** (array 23,
highest marker v23) as the 2026-08-26 pass recorded them becoming.

**Half two, the store.** The installed DB (`%APPDATA%\chorus-app\chorus.db`,
**4.00 MB**, mtime **2026-09-12T11:25:40Z**) was read **from a copy, `-wal` and
`-shm` included, so the live writer was never touched**: `SELECT MAX(version)`
reads **23 over 23 rows, contiguous 1..23 — agreeing with the parsed array**.

**`v24` is free in code and in the store.** Cost of running this: about four
minutes. Registries: highest decision **D195** → **D196 free**; the
`Highest finding` row states **F116 free**.

### 2.2 ⚠ F116 — SIDECHAINS LEFT THE TRANSCRIPT, AND THE SPEC'S INSTRUCTION IS OBSOLETE

The spec tells 10.1 to invert `contextUsageCore.ts:209`'s `isSidechain` skip so
subagent work stops looking free. **That line is dead code against reality.**

- **0 of 268 transcripts across all 44 project directories** under
  `~/.claude/projects/` contain an `isSidechain: true` line.
- Claude Code `2.1.259` writes subagent work to **separate files**:

```
~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl                       <- what transcript_path names
~/.claude/projects/<encoded-cwd>/<sessionId>/subagents/agent-<id>.jsonl  <- the subagent work
```

- **82 such `subagents/` directories exist on this machine.** A whole-file read of
  `transcript_path` alone sees **none** of them.

**The instinct behind the spec's inversion was right. Its mechanism was wrong,
and the magnitude is larger than "include sidechains" implies.**

### 2.3 ⚠ F117 — THE MAGNITUDE, MEASURED ON THREE REAL SESSIONS

| session | subagent files | subagent share of `CE` | of `RLIT` | main-only scanner reads |
|---|---|---|---|---|
| `28b8a03a` | 7 | 61.0% | 74.8% | **39.0%** of true `CE` |
| `45c2f27c` | 6 | 53.2% | 76.7% | **46.8%** of true `CE` |
| `a9f05535` | 8 | 64.9% | 90.5% | **35.1%** of true `CE` |

**A main-file-only ledger under-reads `CE` by roughly 2.5× on exactly the sessions
that cost the most, and under-reports `RLIT` — the quantity that charges against
ITPM rate limits — by up to 90%.** An A/B run on that instrument would be
measuring the wrong thing while looking precise. This is the whole reason the
read boundary widens, and why it widens in 10.1 rather than later.

### 2.4 The transcript's shape, read off real files

✅ **`cache_creation: { ephemeral_5m_input_tokens, ephemeral_1h_input_tokens }`
is present**, so `CE` is computable as specified.

✅ **A free consistency check:** `ephemeral_5m + ephemeral_1h ===
cache_creation_input_tokens` held in **every one of 84,924 entries across all 495
files — 0 mismatches**. The scanner asserts it and surfaces a violation rather than
silently preferring one source.

⚠ **`usage.iterations[]` is a double-count trap, and the factor is exactly
2.00×.** Whole-corpus: **77,436 of 84,924 usage entries carry one**, and its
length is **only ever 1 (77,430) or 0 (6) — never greater**. So it is not a
partial overlap to reason about; summing it alongside the parent doubles the
answer uniformly. It repeats `input_tokens`, `output_tokens`,
`cache_read_input_tokens`, `cache_creation_input_tokens` and a nested
`cache_creation`. **Read the parent `usage` only**, and test it with a fixture
that would visibly double.

**Both TTLs occur here, but never in the same entry** — across all 84,924 usage
entries: **0 carry both non-zero**, 11,714 are 5m-only, 73,169 are 1h-only. So a
both-TTL fixture is necessarily **hand-built**, as is any main-transcript
sidechain line, and each task must label which of its fixtures are real-derived
and which are synthetic rather than implying all are real.

⚠ **A SUBAGENT TRANSCRIPT HAS A NON-TRANSCRIPT SIBLING, AND GLOBBING `agent-*`
READS CONTENT.** Every subagent `.jsonl` sits beside an `agent-<id>.meta.json`
holding `agentType`, `toolUseId`, `spawnDepth` and a **human-written
`description`** — a real one reads `"Write Impl-18-3"`. Measured: **228 meta files
to 227 transcripts** (one orphan). **The `.jsonl` anchor in the file filter is
therefore load-bearing for D196's invariant**, not tidiness: a glob on `agent-*`
would parse a non-transcript *and* touch prose the user wrote. Directories are
flat — all 83 sit at the same depth and a `spawnDepth: 2` subagent still writes
into the same flat directory — **so recursion is unnecessary and is forbidden**,
which also keeps a symlink surface out of the walk.

⚠ **The corpus is live and these counts drift.** The subagent-directory count
moved 82 → 83 *during this kickoff* because this session spawned its own
subagents. Re-measure rather than inheriting a count; the **shapes** above
(length never >1, zero mismatches, never both TTLs) are what a test should
encode, not the totals.

**Worked real numbers** (largest Chorus transcript, main file only):
`Naive = 45,379,703` · `CE = 9,197,338` · `RLIT = 2,453,116` · `output = 236,040`.
Whole sessions including subagents measured **`Naive/CE` 5.07×–5.86×** and
**`Naive/RLIT` 12.46×–18.71×**. ✅ **D195(c) is confirmed on this machine: the gap
between `Naive` and `CE` is the finding.**

### 2.5 ⚠ F114's MECHANISM IS MIS-STATED IN THE SPEC — the conclusion survives

The spec says `dispatches.tokens_cached` "conflates" cache reads and writes.
**It does not.** Measured:

- `subscriptionMeter.ts:156` — `tokensIn += (fresh ?? 0) + (cacheWrite ?? 0) + (cacheRead ?? 0)`
- `subscriptionMeter.ts:158` — `tokensCached += cacheRead ?? 0`

**`tokens_cached` holds cache READS ONLY. Cache WRITES are folded into `tokens_in`,
where no column can recover them.** Nothing in `src/main` persists
`cache_creation` separately. The spec's conclusion — the existing ledger cannot
express the metric that decides Phase 10 — stands. **The fix is an addition, not
a split.**

### 2.6 Every spec citation, checked one by one

| Claim | Verdict |
|---|---|
| `sessionManager.ts:600` restore spawn passes no options | ✅ exact |
| `ipc.ts:2203` `SessionRestart`; `:2258` launch with only `conversationBoundary` | ✅ both exact |
| `ipc.ts:1189 mergeWiringEnv` lets a profile's env win on collision | ✅ (logged, not silent) |
| `schema.ts:311-315` `tokensCached` and its comment | ✅ |
| `contextUsageCore.ts:209` skips sidechains | ✅ — and now moot, see §2.2 |
| `contextUsage.ts` header scope/security note | ✅ lines ~12–51 |
| IpcChannel assertions at `:3642` and `:4102`, 114 keys | ✅ lines and count right — ⚠ **the path is `src/shared/ipc.test.ts`, not `src/main/`** |
| `SessionRelaunch` rebuilds the full option set | ✅ `ipc.ts:3190` |

---

## 3. Decisions resolved at kickoff, 2026-09-12 (Matthew)

**D196 — THE LEDGER WALKS THE SUBAGENT DIRECTORY, AND THE WIDENING IS WRITTEN
DOWN NOW RATHER THAN INHERITED.** The scanner reads `<transcript>.jsonl` **and**
`<transcript-dir>/subagents/*.jsonl`. `contextUsage.ts`'s header states that the
module opens **one** file, reads a 256 KB tail, parses three integers, and that
the content never leaves the module; 10.1 adds a sibling that opens **many** files
and walks a **directory**. Both headers are amended so neither reads as though
nothing changed — the same treatment `contextUsage.ts` itself gave
`agentEvents.ts`'s promise.

**The invariant that survives unchanged, and must be restated rather than
assumed: CONTENT NEVER LEAVES THE MODULE. Only counters do.** No message text, no
tool input, no file name and no path is retained, broadcast, logged or returned
over IPC. §2.3 is why the widening is worth it: without it the instrument is
2.5× wrong on the sessions that matter, which is worse than not building it.

**D-a — F114 takes the ADDITION.** `v24` adds one nullable column
`dispatches.tokens_cache_write`. `tokens_in` keeps its meaning (total prompt,
cached portion a subset) and `tokens_cached` keeps meaning cache **reads**.
**No backfill.** ⚠ All 467 existing rows get NULL, which honestly means
*unknown* — **every reader must render NULL as unknown and must never coerce it
to 0.** A fabricated zero would read as "this session used no cache", the
opposite of the truth for every historical row. *Rejected: redefining `tokens_in`
as fresh-only, which would silently change the meaning of 467 existing rows and
every consumer that reads them.*

**D-c — `CE_total` is NOT shipped in v1** (coordinator's call at kickoff, stated
so Matthew can overturn it). `model_catalog` has **no price columns** and nothing
in the schema carries a price, so `CE_total = CE + (out/in ratio)·output` has no
source; a hardcoded ratio would put an unsourced constant inside the one number
the phase exists to trust. **Report `CE`, `RLIT`, `Naive` and raw `output_tokens`
as four separate numbers.** Output is more useful un-folded anyway: **a fall in
output tokens is the documented signature of a silent thinking-disable** (spec
§7), which a blended `CE_total` would hide *as a saving*.

---

## 4. Task split

Four tasks. File ownership is disjoint except `src/main/ipc.ts`, which 10.1-1 and
10.1-3 both touch — **hence the ordering, which is a constraint and not a
preference.**

| # | Task | Owns | Depends on |
|---|---|---|---|
| **10.1-1** | One launch composition, every caller (closes **F115**) | new `launchOptionsCore.ts`, `sessionManager.ts`, `ipc.ts` (restore/restart/relaunch **and** `session:launch`) | None |
| **10.1-2** | `engineLedgerCore.ts` — the whole-file scanner and the metric (pure) | `engineLedgerCore.ts` + its test, new files only | None |
| **10.1-3** | Migration `v24`, the cache-write column, and the ledger service | `schema.ts`, `storage.ts`, `engineLedger.ts`, `contextUsage.ts` header, `shared/ipc.ts`, `main/ipc.ts`, `preload`, `shared/ipc.test.ts` | 10.1-2, and 10.1-1 for `ipc.ts` |
| **10.1-4** | The usage panel — four numbers and the gap between them | Pinia store + component | 10.1-3 |

**10.1-1 and 10.1-2 can run in parallel.** 10.1-2 is pure and touches nothing
anyone else owns.

**Why F115 leads.** `SessionRelaunch` (`ipc.ts:3190`) already rebuilds the option
set — effort, model effort, permission mode, env additions — from the persisted
`launchProfileId`. Restore (`sessionManager.ts:600`) and restart (`ipc.ts:2258`)
simply never call it. So this is **one extracted composition with several
callers, not new machinery** — and until it lands, an A/B arm is silently
averaging a mixture of configured and unconfigured panes.

⚠ **AN EARLIER DRAFT OF THIS OVERVIEW SAID A RESTORED BYOK PANE LOSES ITS
CREDENTIAL. THAT IS FALSE, AND THE CORRECTION IS THE MORE IMPORTANT FACT.** A
credentialed session never reaches either spawn: restore heals it to `exited`
with the title *"Credential not re-supplied — relaunch from the dialog to
re-enter it"* (`sessionManager.ts:571-583`) and restart refuses it inline
(`ipc.ts:2238`), both off `sessionIsCredentialed` (`launchProfiles.ts:127-138`,
fail-safe **true**). What a BYOK pane loses is **the launch, by design**.

**This is load-bearing on the task's shape, not a footnote.**
`sessionManager.ts` carries a written invariant — *"THIS FILE STILL CONTAINS ZERO
REFERENCES TO THE VAULT … Restore heals; it never resolves a credential"* — which
is the structural half of the no-unattended-decrypt promise. **The extracted
composition must therefore be credential-free and synchronous**, so that
restoring a credential from it does not merely not-happen but does not compile.

**What is actually lost is `permissionMode`, and it loses in the permissive
direction.** Absent does not mean "no flag" — it means the adapter's declared
default, and claude's is `defaultLevelId: 'auto'` (`claude.ts:540`). ⚠ **A pane
the user launched in Plan or Manual comes back in Auto.** `sessionManager.ts:203-212`
documents this mechanism as deliberate — it exists so a restored agent is not
handed back its permission prompts — but only the lenient edge was ever
addressed. Closing F115 therefore **changes shipped behaviour** and must be
called out as such, not slipped in as a fix. *(That same comment cites
`restore()` at `:474`; it is at `:600`. Two more stale self-citations sit at
`sessionManager.ts:890` and `:982`.)*

---

## 5. Phase-wide non-goals

- **No request is modified and no agent is redirected.** No hook is installed, no
  `updatedToolOutput`, no `updatedInput`, no `ANTHROPIC_BASE_URL`, no proxy, no
  listener in front of anything. 10.1 reads files and reports numbers.
- **No compression of any kind.** D192 stands and is not implemented here.
- **No `project_engine` settings table.** The §6 on/off design belongs to the
  tier that needs a toggle; 10.1 has nothing to switch off but the panel.
- **No symbol index, no graph migration v3, no `typescript` promotion to a
  runtime dependency** — that is 10.2 and it needs Matthew's sign-off first.
- **No backfill of historical token rows.** Unknown stays unknown.
- **No new dependency of any kind**, charting libraries included (CLAUDE.md).
- **No A/B run.** 10.1 builds the instrument and proves it on fixtures; the 30
  paired sessions are the phase milestone, not this slice's.
- **Do not revert or commit the pre-existing working-tree changes.** At kickoff:
  `M docs/Features/Foundation/roadmap.md`, `MM package-lock.json`,
  `MM package.json`, `M src/renderer/src/components/TerminalPane.vue`,
  `?? .claude/`, `?? .procoder/`, `?? docs/Features/Engine/`.

---

## 6. Gates every task inherits

1. **G6 before any migration.** Both halves, re-run rather than inherited from
   §2.1 — a sweep proves a number *was* free, never that it *stays* free (F105).
   **Renumber as part of the merge, never before it.**
2. **D7 — `schema.ts` and `storage.ts` DDL are hand-mirrored.** A new column is
   added in both, names and types matching.
3. **D1 — no Zod in preload.** It throws `EvalError` under CSP and silently drops
   events. Validate in main only, on the way in **and** on the way out.
4. **D14 — payloads crossing the bridge are PLAIN objects.** A Pinia/reactive
   value is a Vue Proxy and structured clone rejects it at runtime with **no
   compile-time signal**. Snapshot with `JSON.parse(JSON.stringify(x))`.
5. **A key-set assertion proving no file content and no token text crosses the
   wire** — only counters. The narrow boundary is the reason the widening was
   acceptable; the test is what keeps it narrow.
6. ⚠ **Lone-CR files.** `roadmap.md` and `TerminalPane.vue` carry a lone CR byte
   and the `Edit` tool rewrites it as LF, producing a phantom multi-thousand-line
   diff. **Run `git diff --stat` after every edit** and confirm the line count is
   what you actually changed.
7. ⚠ **Dev worktrees share one database.** A migration version claimed on another
   branch makes yours silently no-op — verify against a throwaway
   `--user-data-dir`.
8. ⚠ **`npm run dev` has no credentials.** Seed a `--user-data-dir` from
   `%APPDATA%\chorus-app` (Local State included, or every pre-existing credential
   blob is undecryptable) before any runtime check that touches a credential path.
9. ⚠ **Killing the dev instance:** match `Name=electron.exe` **and**
   `*remote-debugging-port=9222*`. The bare `*9222*` substring also kills Chrome
   renderers and the querying shell.
10. ⚠ **`dispatches.agent` IS NOT AN `AgentKind`, AND A LEDGER PAYLOAD TYPED ON
    ONE WILL FAIL IN PRODUCTION.** `agentKindSchema` (`src/shared/ipc.ts:974`) is
    `['claude','codex','grok','kimi','opencode','shell']` — **no `voice`** — yet
    `voiceRefine.ts:193` writes `agent: 'voice'` and **26 such rows exist**;
    `kimi` is in the enum with **zero**. Zod parses out as well as in (gate 3),
    so one unlisted value takes the **whole aggregate** down, not one row. Type
    this field as a plain string and say why in a comment.
11. **Every number written into a doc or a comment must have been measured this
    session.** Where the Engine spec is wrong — §2.2, §2.5 and the
    `ipc.test.ts` path — say so and give the measured truth rather than quietly
    following it.

---

## 7. Phase acceptance

10.1 is done when all of the following hold:

1. **A restored-at-boot pane and a restarted pane both carry the options their
   launch profile specifies** — effort, model effort, permission mode and env
   additions — proved at runtime and not only by unit test. ⚠ **Credentials are
   explicitly NOT in scope**: a credentialed session must still be healed or
   refused exactly as it is today, and `sessionManager.ts` must still contain
   zero references to the vault. A change that made a credential survive restore
   would be a regression of a deliberate invariant, not an improvement.
   The Plan/Manual → Auto change of §4 must be visible in the task's summary as
   a behaviour change, not buried as a fix.
2. **`engineLedgerCore` reports `CE`, `RLIT`, `Naive` and raw `output` for a real
   session, main and subagent files both**, with the main/subagent split visible
   and the `5m + 1h === flat` invariant asserted.
3. **The double-count trap is tested**, with a fixture that would visibly double
   if `usage.iterations[]` were summed.
4. **`v24` adds `tokens_cache_write` with no backfill**, and a migration test
   proves an existing row survives as NULL rather than 0.
5. **The panel renders the four numbers with `Naive` beside `CE`**, shows the
   subagent share, reads NULL as *unknown* rather than zero, and tells a
   `grok`/`opencode`/`kimi` pane that it has no token source rather than
   looking broken.
6. **`npm run typecheck` and `npx vitest run` are green**, both IpcChannel count
   assertions updated to the new number, and `git diff --stat` shows only the
   lines the tasks actually changed.

**Not in acceptance, deliberately:** any claim about what the engine saves.
10.1 measures. It does not yet have anything to measure *against*.
