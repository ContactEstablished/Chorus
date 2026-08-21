# Task 6b-2 — Completion Summary

_Executed 2026-08-20 against `main` at `1f62579`. Evidence under `_verify/6b-2/` (gitignored)._

**Status: the claude half is complete and proven end to end. The codex half is BLOCKED by a
fatal defect the drive found — contract v2 kills every codex launch — and the fix is outside
this task's declared scope. Nothing is committed.**

## The headline numbers

| Gate | Before | After |
|---|---|---|
| typecheck (node + web) | 0 | **0** |
| vitest | 2792 / 74 files (at pickup: 2757) | **2792 / 2792 across 74 files** |
| `grep:secrets` | clean | **clean, 6 patterns** |
| `IpcChannel` keys | 108 | **109** (`memory:launch`), both `toHaveLength` moved + asserted by name |
| `MIGRATIONS.length` | 21 | **21 — unchanged**, dev DB `MAX(version)` = 21 |
| `LATEST_GRAPH_VERSION` | 2 | **2 — unchanged** |
| runtime dependencies | 9 | **9** |
| `MATCH (s:AgentSession) RETURN count(s)` | **0** | **4** |
| `memory:validate` | `0 of 0` | **`1 of 1`** |

## Gate 3 — the two probes the prompt required

**§0.2 — F92 re-measured on claude 2.1.237 (was 2.1.235): REPRODUCES UNCHANGED.**
`_verify/6b-2/02-f92-probeB-2.1.237.txt`. Hook receipts in order: `PreToolUse ToolSearch` →
`PostToolUse ToolSearch` → `PreToolUse mcp__chorus-memory__read_neo4j_cypher` → `PostToolUse
mcp__chorus-memory__read_neo4j_cypher`. `tool_name` is a plain string, hyphen intact.
**Contract line 2's "loaded on demand" clause is still true and was not changed.**

_One new trap for whoever re-runs it:_ `--allowedTools` is variadic, so a trailing positional
prompt is swallowed as another tool name and claude exits with *"Input must be provided either
through stdin or as a prompt argument"*. Pipe the prompt through **stdin** instead.

**§0.7 — the three writing templates, re-executed and rolled back: REPRODUCES EXACTLY.**
`_verify/6b-2/01-write-template-probe.txt`. Node count **710 before, 710 after**.
WRITE cited to a file → `{id, produced: 1, supportedBy: 1}`; the same with a missing relPath →
**0 rows**; WRITE cited to a commit → `{id, produced: 1, supportedBy: 1}`; SUPERSEDE →
`{id, produced: 1, supportedBy: 1, supersedes: 1}` with `old.validTo` set inside the tx.

## The runtime drive

**§9.1 — the node exists and carries the Chorus session id.** One claude launch into the Chorus
project produced exactly one `:AgentSession`:
`{id: 793e1b75-…, chorusProjectId: a43b395d-…, agent: 'claude', model: null, startedAt:
'2026-08-20T13:15:41.047Z', writtenVia: 'app'}`. **Cross-checked against SQLite, not eyeballed**
(`06-sqlite-crosscheck.txt`): the `sessions` row is `793e1b75-4c9a-4e95-8681-949a5c34188e`,
`created_at` 13:15:41.046Z — 1 ms before the MERGE. `model: null` is correct for a subscription
launch.

**§9.2 — the instruction file.** `07-instruction-file.md`, 5 143 bytes, carries the project id,
`pj:a43b395d-…` (never `wt:`), the session id, all three tool names and all four templates.
`$repoId = 'a92099d934dd95548e59525b7231fd4b5f5d5f6f'` — **read from the graph's own `:Commit`
nodes**, and equal to `git rev-list --max-parents=0 HEAD`. `lastIndexedHead` renders `unknown`,
as 6b-3 expects. argv carries `--append-system-prompt-file` (`08-argv.txt`).

**§9.3 — an agent following the contract produced a SOURCED memory.**

```
m.id 993aa312-…  writtenVia 'mcp'  assertedByModel 'claude-opus-5[1m]'
assertedByAdapter 'claude'  validFrom 2026-08-20T13:18:55Z  validTo null
PRODUCED from :AgentSession 793e1b75-…   SUPPORTED_BY -> :File {relPath: 'package.json'}
```

**`memory:validate` reads `1 of 1`** (`09-validate.txt`). Both halves of §6 satisfied.
6b-1's counters beside it: `writes: 1`, `reads: 0`, `sessions: 1`.

⚠ **The honest-null model field worked exactly as designed.** The contract rendered
`$model = 'unknown — pass your own model identifier'`, and the agent supplied
`claude-opus-5[1m]` unprompted, saying *"my own identifier, as the contract's placeholder
instructs"*. Chorus did not guess and the provenance field is real.

**The fulltext READ template is now semantically verified, not merely parsed.** Re-run after a
real `:Memory` existed, it returned that memory. §0.3's open item is closed.

**§9.4 — the withheld case, all four assertions.** Container stopped, same code path:
no `--append-system-prompt-file` in argv (227 chars vs 352 with the contract) and **no
instruction file written**; the launch **succeeded in 136 ms**; the Memory section rendered
*"Last launch (09:21 AM): memory graph unreachable — contract withheld. claude launched without
it."*; **`.mcp.json` was still merge-written** (md5 unchanged, log line present). The `[memory]`
warn contains **no URI, no port, no host, no path, no backslash** (`14-log-leak-check.txt`).

**§9.5 — the container is UP.** Left running. Cold restart measured **bolt ready after 4 878 ms**,
which reproduces F93: a TCP probe would have declared it up ~4.8 s early.

**§9.6 — the bound, on the case that costs.** Chorus project temporarily re-pointed at
`bolt://192.0.2.1:7687` (TEST-NET-1, unroutable): launch cost **5 101 ms** — inside the
≤ ~5.5 s expectation, confirming `CONNECT_TIMEOUT_MS` = 5000 with `maxTransactionRetryTime: 0`
is a ceiling and not a multiple. **The launch still succeeded.** The address was restored in a
`finally` block; `schema_version` 1, `last_seeded_at` and the container columns all carried
forward — only `updated_at` moved.

**The gate correlates perfectly.** Seven launches: the four with a reachable graph produced four
`:AgentSession` nodes; the three unreachable ones (docker stopped ×2, blackhole ×1) produced
**none**.

**§9.7 — BLOCKED. See the fatal finding below.**

**§9.8 — the foreign index, re-checked and untouched.** Both recorded as D173 asked:

- the foreign **`search`** FULLTEXT on `:Memory(name, type, observations)` is **STILL PRESENT**.
  Nothing was dropped, relabelled or deleted.
- **1 of the 2 `:Memory` nodes lacks `chorusProjectId`** — the Task 6-5 G2 canary, whose
  properties are `note`/`key`. It is outside `validate`'s denominator and cannot move the ratio.

## ⚠ FATAL FINDING — contract v2 kills every codex launch (suggested **F96**)

Full write-up and reproduction: `_verify/6b-2/23-FATAL-codex-argv.md`.

A codex pane launched into a memory-configured project with a **reachable** graph dies with
`Error: stdout is not a terminal`, exit 1 — and leaves an empty file named **`(old)`** in the
repository root.

**The A/B, same code path, contract as the only variable:**

| Container | Contract | Result |
|---|---|---|
| up | emitted | codex **exits 1**, `(old)` created |
| stopped | withheld | codex **starts normally** (v0.148.0), no stray file |

**Mechanism.** codex resolves to `codex.cmd`, a batch file; node-pty spawns it through
`cmd.exe`, which re-parses the command line. The contract travels as
`-c developer_instructions="…"`, escaped by `tomlBasicString` **for TOML** (`\` and `"`) — not
for cmd.exe, which treats `>` as redirection and does not recognise `\"`. Contract v2's three
writing templates contain Cypher arrows (`-[p:PRODUCED]->`, `-[c:SUPPORTED_BY]->`,
`-[x:SUPERSEDES]->(old)`); `>(old)` becomes a redirection and codex's stdout stops being a
terminal. **v1 never hit this: its seven prose lines contained no `>` at all.**

**It cannot be fixed in the contract text.** Cypher has no arrow-free directed relationship, and
the reverse form `<-[r]-` substitutes `<`, also a cmd operator.

**It was not fixed here because the fix is an adapter change and `Task-6b-2.md`'s Non-Goals
forbid one** (*"No adapter file changes"*; Exact Scope names `instructionsCore.ts` only). There
are three viable fixes and choosing between them is a design decision, not an implementer's:

1. escape cmd metacharacters when building argv for a `.cmd` target (`sessionManager.spawn`);
2. invoke codex's real executable instead of the batch shim;
3. give codex a **file-based** contract the way claude already has, taking it out of argv
   entirely — which also retires the whole one-physical-line constraint.

**Impact if shipped as-is: every codex launch into a memory-configured project with a reachable
graph fails to start.** claude is unaffected (file, not argv). kimi / opencode / noHarness
declare no mechanism and get no contract.

## Second finding — the self-verifying RETURN never reaches the agent (suggested **F95**)

`_verify/6b-2/11-write-tool-return-shape.md`. D173(Q5) made the writing templates return
`m.id`, `produced` and `supportedBy`, and contract line 14 tells the agent to read them. §0.7
proved that Cypher through the **driver** — but through
`mcp__chorus-memory__write_neo4j_cypher` the server discards result rows and returns a write
summary instead: `{nodes_created: 1, relationships_created: 2, properties_set: 7}` on success,
and **`{}`** when the MATCH found nothing (probed this session; node count 712 before and after).

**The substance survives** — the two cases are still clearly distinguishable, and the agent in
this drive read `relationships_created: 2` and reasoned correctly and unprompted that both
MATCHes had found their nodes. **The wording does not** — line 14 names fields the agent will
never see. Recorded rather than rewritten: the templates are D169/D173 text and the line count
is pinned by a test.

## Third finding — the boot-restore path MERGEs no node

`sessionManager.restore()` calls `spawn()` directly with **no `LaunchOptions`**, so it never
reaches `withMcpEnv`: a session restored at app boot gets no contract *and no `:AgentSession`
node*. Confirmed by argv (restored claude PTYs are 223/227 chars, with no
`--append-system-prompt-file`; a contract-carrying launch is 352).

This is pre-existing for the contract but **new in consequence for provenance**: before this
task no session had a node, so restore was no worse than any other path; now every launched
session has one and every boot-restored session does not, and a memory written from a restored
session is unsourced by construction. Out of this task's Exact Scope (which names the four
`withMcpEnv` call sites). **6b-3 should decide whether restore joins them.**

## Deviation from the spec, stated explicitly

**Contract line 9 does not contain the word `confidence`.** `ImplementationSpec-6b-2.md` §1.3
ends that line *"There is no confidence field; do not invent one"*, but `Task-6b-2.md` forbids
the word in three places — Non-Goals, Test Expectations and Acceptance Criteria — with a named
grep as the gate. D94.3's own roadmap text bans the **field**, not the word. The task doc's
reading is the stricter and more explicit one, so the line now reads:

> *"…Do not add a property of your own invention, however useful it seems: Chorus reads only the
> list above, so anything else is invisible to it and to every later session. How sure you are is
> not a property — say it in the content, or cite a second source."*

`exactly these properties and no others` already carried the prohibition; the new clause keeps
the positive instruction about where certainty belongs. `/confidence/i` matches nothing in
`instructionsCore.ts`, asserted over both the render and the source file.

## Drift found that neither document records

1. **A THIRD `ipc.test.ts` assertion had to move.** Both documents say "both `toHaveLength`
   assertions"; there is also an exhaustive `memory:*` channel enumeration (`ipc.test.ts:4131`)
   that fails until `memory:launch` is added. It is now 14 channels, and the comment says so.
2. **`ipc.ts` needed three NEW value imports**, two of them widening existing type-only imports:
   `CHORUS_MEMORY_SERVER` (memoryService), `launchModelId` (sessionManager) and
   `workspaceInstanceIdFor` (codeIndexCore). No cycles — none of the three imports `ipc.ts`, and
   `codeIndexCore.ts` has no imports at all.
3. **`BaseAgentAdapter` became unused in `ipc.ts`** — the deleted local `renderInstructionsFor`
   was its only reader there.
4. **The `id === 'claude'` grep self-matches.** The docblock states the rule by quoting the
   forbidden expression, so the test strips comments before asserting, and separately asserts the
   warning is still present.
5. Every `ipc.ts` line number in both documents was **five lines low** (6b-1 added 58 lines).
   Recorded in `Task-6b-2-ExecutionPrompt.md` Correction 1.

## Review-checklist items, answered

1. **One emitter, and it cannot compose without a context.** `renderInstructionsFor` is
   `instructionsCore.ts`'s only export that builds contract text; `ipc.ts` calls it once
   (`:843`). `renderInstructionsFor(mechanism, null)` returns `undefined` for **every**
   mechanism, asserted directly. Structural grep in `03-structural.txt`.
2. **The MERGE never fails a launch.** Every outcome falls through to `wireMcpForLaunch`. Proven
   at runtime three ways: graph stopped (136 ms), blackholed (5 101 ms), both launched fine.
3. **`sessionId` is required, positional.** All four call sites compile only because they pass
   `row.id`.
4. **`workspaceInstanceIdFor(project.id)` → `pj:`**, verified in the emitted file, and the test
   asserts the render contains no `wt:`.
5. **No `id === 'claude'`** in the moved function — asserted over comment-stripped source.
6. **`claude.ts` is byte-identical** — `git diff` empty; `-o NUL` still at `:222`–`:224`.
7. **All four templates** use single-quoted literals, contain no `DELETE`/`DETACH`/`REMOVE`, and
   the three writing ones return their evidence. (The only deletion-verb grep hit in
   `instructionsCore.ts` is the prose line *forbidding* deletion — the self-matching trap again.)
8. **`withSession`'s docblock now tells the truth** about the launch path, and says the claim is
   maintained rather than inherited.
9. **The failure log carries no URI, token or path** — grepped.
10. **Known limit recorded:** `withSession` disposes the process-wide cached driver on any
    failure (`neo4jClient.ts:236`). Pre-existing, but this task makes it reachable from **every
    launch**, so a launch against a down graph now drops a driver a concurrent `memory:index` may
    be holding. It re-acquires on the next call — one failed operation, not a broken app — but
    6b-3 builds a background index on this path and should not rediscover it.
11. **The foreign index was re-checked and written down, not acted on** — §9.8 above.

## Tree state

Sixteen modified source files (the fourteen in scope plus the pre-existing `package.json` /
`package-lock.json` 0.7.2 → 0.7.3 bump, which is not this task's and was not reverted), and
`.mcp.json` whose diff is line-endings only. **Nothing committed.**

⚠ **One file appeared during the run that is not this task's and was not touched:**
`src/renderer/src/components/PaneIcon.vue` (untracked, written 09:40, a pane-header icon
component, unreferenced by anything). It is not in Gate 0's list and is reported rather than
absorbed.

## What must happen before this lands

**Matthew's ruling on the codex argv defect (F96).** The claude path is complete, proven, and
carries the phase's write-side evidence. Shipping as-is would break codex launches for any
project with memory configured — so the choice is: fix it (one of the three routes above,
crossing this task's Non-Goals), or gate the contract to `append-system-prompt-file` mechanisms
until 6b-3 does.
