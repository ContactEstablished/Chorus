# Phase 6 — Neo4j Project Memory + Skills — Task Overview

**Kicked off 2026-07-28** against the verified codebase at `3fa295d`, immediately after Phase 3e
closed. **Matthew's sequencing ruling (D91): *"plan now, execute after 3e."*** 3e is closed, so
execution is licensed; nothing here reorders anything.

## The one thing to read before this document

**[`../Phase-6-MemoryPlan.md`](../Phase-6-MemoryPlan.md) is AUTHORITATIVE ON DESIGN and this
overview does not restate it.** It was authored 2026-07-28 against `35a592f` in a dedicated design
pass, and **D91–D94 exist so this kickoff inherits its conclusions rather than re-deriving them.**
Where the two disagree, the plan wins on design and the roadmap wins on current status (§2's
authority split).

What this overview adds is the part the plan could not: **the code as it actually stands now**, and
the places where the plan's own citations have drifted.

## Verified ground facts — every one checked 2026-07-28 at `3fa295d`

**Nothing below is inherited on trust, including from the design plan.** Three of the plan's
citations are off and two of its premises are wrong; those are called out rather than silently
corrected.

| Fact | Where | Value |
|---|---|---|
| `McpDescriptor` | `src/main/adapters/types.ts:88` | file-shaped — `{mode, format, location, configPath}` |
| `McpServerRef` | `types.ts:337` | `{name, command, args}` — **no `env` field** |
| `writeMcpConfig` | `types.ts:344` | returns `Promise<void>` — no refusal channel |
| `supportsMcp` type guard | `types.ts:383` | `typeof a.writeMcpConfig === 'function'` |
| The argv-is-world-readable note | `types.ts:174` | present, on `extraArgs` |
| Every adapter's `mcp` descriptor | `claude.ts:86` · `codex.ts:77` · `kimi.ts:112` · `opencode.ts:140` · `noHarness.ts:86` | **all `null`** |
| Capability-honesty blanket-false | `adapters.test.ts:498` | `supportsMcp`/`supportsHooks`/`supportsResume` all false |
| Generic declared-iff-implemented | `adapters.test.ts:507` (describe) · `:515` (the case) | vacuous while every descriptor is null |
| `staticRegistry` | `adapters/registry.ts:35` | 4 kinds — claude, codex, kimi, opencode |
| `agentKindSchema` | `src/shared/ipc.ts:309` | the same 4 |
| The `composeChildEnv` policy flip | **`src/main/adapters/env.ts:142`** | `if (Object.keys(secretEnv).length === 0)` |
| `BASELINE_ENV_VARS` | **`src/main/adapters/env.ts:10`** | the COPY-FROM list |
| `LaunchOptions.secrets` | `sessionManager.ts:99` | present — the H2 mitigation seam |
| `headersContainSecret` | `src/main/ipc.ts:252` (definition) · `:1375`, `:1400` (call sites) | the refuse-the-write precedent |
| `MIGRATIONS` | `storage.ts:75` | **length 12** |
| `credential:delete` dependents | `storage.ts:1655`, `:1750` · `ipc.ts:1515–1516` | **exactly TWO** |
| `docker` in `DETECTED_TOOLS` | `cliDetect.ts:78` | present |
| Baseline | — | typecheck **0** · vitest **1055 / 1055 across 30 files** · `grep:secrets` clean · `IpcChannel` **58** · `ipcMain.handle(` **53 / 0** · `sqliteTable(` **16** · `MIGRATIONS.length` **12** |

### D4 versions, re-probed today rather than inherited

Per the plan's own §10 instruction and CLAUDE.md's standing rule that CLI syntax moves fast. **Method
was `<tool> --version` on this machine, 2026-07-28.** Every one matches the plan — it was authored
the same day, so there has been no drift yet, and **that will not be true by the time this phase
executes if it slips.**

`codex` **0.145.0** · `claude` **2.1.218** · `opencode` **1.18.8** · `kimi` **0.29.1** · `docker`
**28.0.4** · `uvx` / `uv` **0.11.19** · `npx` **11.12.1**. All on PATH.

### ⚠ THREE OF THE PLAN'S CITATIONS HAVE DRIFTED — use this table, not the plan's line numbers

| Plan says | Actually | Why it matters |
|---|---|---|
| `types.ts:343` for `writeMcpConfig` | **`:344`** | off by one |
| `types.ts:170` for the argv note | **`:174`** | off by four |
| `env.ts:18` reserves the `BASELINE_ENV_VARS` slot | the const is at **`:10`**; the reserved-slot comment is at **`:26`** | and **the path is `src/main/adapters/env.ts`, not `src/main/services/env.ts`** — the plan cites it bare, and the wrong directory is a real dead end |
| `ipc.ts:1350` for `headersContainSecret` | defined at **`src/main/ipc.ts:252`**, called at **`:1375`** and **`:1400`** | Phase 3e added ~80 lines to this file |

### ⚠ TWO OF THE PLAN'S PREMISES ARE WRONG, AND BOTH CHANGE WORK

**FINDING 1 — the capability-honesty test covers 2 of 5 adapters, not 5.**
`adapters.test.ts:41` reads:

```ts
const adapters: readonly PtyAgentAdapter[] = [claudeAdapter, codexAdapter]
```

**`kimiAdapter` and `opencodeAdapter` were never added to it** — they arrived in Phase 3d (D86
lifted the registry freeze 2 → 3, D90 widened it 3 → 4) and both are imported and individually
tested elsewhere in the same file, but **neither has ever been through the capability-honesty
loops.** `noHarness` is absent too.

So the plan's §3 instruction — *"replace the mcp arm with an explicit table `{claude:true,
codex:true, opencode:true, kimi:false, none:false}`"* — **cannot be carried out as written**: three
of its five keys name adapters the test does not iterate. **The list must be widened from 2 to 5
FIRST**, which is itself a gap this phase closes, and the generic `:515` case then starts covering
kimi, opencode and none **for the first time** rather than merely "starting to do real work".

**FINDING 2 — `Plan.md` §10 is wrong in SIX places, not four.** D94 records four. Two more, both
found by reading `Plan.md:214` against decisions taken after it:

- **It prescribes `generated password → vault`.** That is precisely the step **D93 rejected** — a
  generated password whose only purpose is to be handed to a config file. The provision flow in
  `Plan.md` §10 therefore describes the design D93 forbids, in one clause, in passing.
- **It names containers `agentdesk-neo4j-<slug>`.** The app is Chorus; **D92 specifies
  `chorus-neo4j-<slug>`**, and D92's whole argument is that the name is the human's index in Docker
  Desktop. A stale product name in the one string a human reads is not cosmetic.

**Both are annotated, not rewritten** — the D42/LiteLLM precedent, the same treatment D94 gave the
other four. **Recorded as D102.**

## Decisions settled at this kickoff

### D100 — `neo4j-driver` is approved *(Matthew, 2026-07-28)*

**It is already named in `Plan.md` §2's locked stack (`Plan.md:52`)**, and it is the only supported
way to speak bolt: `memory:test`, the seeder and the validator all need it. **Pure JS with no native
build**, so unlike `better-sqlite3` it does not inherit the Electron-ABI rebuild problem — which is
also why `neo4jClient.ts` *could* be unit-tested if that turns out to be worth it. Runtime deps
**8 → 9**, in **Task 6-3 only**.

**⚠ `dockerode` IS NOT APPROVED BY THIS DECISION.** The plan's §11 explicitly defers it: evaluate a
`git.ts`-style `docker` CLI adapter first and record the outcome as a numbered decision **at Stage
5, not now.** Stage 5 is out of this phase's task docs (see below), so the question does not arise
here.

### D101 — the CR envelope is ~$2.20, two runs *(Matthew, 2026-07-28)*

**⚠ THE PLAN'S "~$0.83 and ~14 minutes" IS STALE AND WOULD HAVE UNDER-BUDGETED THIS.** Phase 3e
measured a full four-member run at **$1.08921689 and 21 minutes** — the older figure came from runs
where kimi never finished. Two runs buys one real attempt plus one retry: 3e lost a run to a
`params_json` key mistake for $0.037, and this brief carries **five** questions, so a partial run is
expensive to lose.

**⚠ AND F39's COST CAVEAT NO LONGER APPLIES THE WAY THE PLAN STATES IT.** The plan says kimi
contributes no `usage` block so Chorus under-reports. **3e-2 established the cause was the ABORT,
not the model** — a capped stream never receives the frame carrying `usage`. With `RESPONSE_CAP_BYTES`
now 8 MB and kimi completing, run `c06874ad` reported `usage for 8, absent for 0`. **The figure is
still Chorus's own and still unchecked against OpenRouter's billing page** — but it is not a floor
for that reason.

### D102 — `Plan.md` §10 is superseded on SIX points, not four *(coordinator, 2026-07-28)*

D94's four, plus the generated-password step and the `agentdesk-` container prefix above. Annotated,
not rewritten.

## Tasks

**Five tasks, one per stage 0–4, and the dependency chain is STRICTLY SERIAL: 6-1 → 6-2 → 6-3 →
6-4 → 6-5.** That is not caution: **G5 blocks coding until the CR closes**, Stage 1 must land before
anything writes a file, Stage 3 has to be provable against the real graph Stage 2 opens, and Stage 4
is the first write and needs Stage 1's guard.

| Task | Stage | Scope | New deps | Depends on |
|---|---|---|---|---|
| **[6-1](Task-6-1.md)** | 0 | **The CR gate and the D4 pass. NO CODE.** Re-probe everything in plan §10, establish the six unverified items, author `CouncilBrief-6.0-MemorySchemaProvenance.md`, run the council, record the findings as a numbered decision. | — | — |
| **[6-2](Task-6-2.md)** | 1 | **MCP capability honesty + codex wiring.** The three `types.ts` defects, `mcpConfigCore.ts` + `assertNoSecretInRendered`, the capability table (**after widening the list 2 → 5**), codex's launch-args mechanism. **Writes no file anywhere.** | **none** | 6-1 |
| **[6-3](Task-6-3.md)** | 2 | **Connect to an existing Neo4j.** Migration **v14** (⚠ corrected from v13, 2026-08-01) (`project_memory`), `memoryConfigCore.ts`, `neo4jClient.ts`, `memoryService.ts`, the `memory:*` channels, `stores/memory.ts`, the Settings surface, the D76 status chip, and **`countProjectMemoryForCredential`**. | `neo4j-driver` | 6-2 |
| **[6-4](Task-6-4.md)** | 3 | **Graph schema + provenance + validator.** `graphSchemaCore.ts`, `provenanceCore.ts`, `memory:seed`, `memory:validate`. | — | 6-3 |
| **[6-5](Task-6-5.md)** | 4 | **`writeMcpConfig` for claude + opencode. ⚠ MILESTONE MET HERE.** The first commit in this repo that writes another tool's config file. | — | 6-4 |

### ⚠ STAGE 5 IS DELIBERATELY NOT DECOMPOSED HERE

**D91: *"The milestone is met at Stage 4; Stage 5 is the tail, and if the phase runs long that is
where it gets cut."*** Stage 5 is the Docker provisioner plus `skill.yaml` and `index-codebase` — a
new dependency question (`dockerode` vs a `docker` CLI adapter), container lifecycle, a destroy
confirmation gate, and a progress event. **That is a phase's worth of work wearing a stage's
number**, and decomposing it now would produce specs written against a Neo4j nobody has connected
to yet. **It gets its own decomposition after 6-5 lands, and the roadmap says so.**

## The purity contract for this phase

- **Task 6-1 writes NO CODE.** Its deliverables are a brief, a findings document and a decision. A
  6-1 that touches `src/` has left its scope entirely.
- **Task 6-2 adds NO DEPENDENCY and WRITES NO FILE.** That is D91's whole argument for putting it
  first: codex's mechanism is per-launch argv, so **the first MCP commit cannot cross a bright line
  by construction.** If 6-2 finds itself needing a TOML writer, the staging premise has failed and
  that is a stop-and-report, not a `npm install`.
- **⚠ NO SECRET VALUE IN ANY CLI CONFIG FILE, IN ANY MODE, EVER (D93).** Not "not by default" —
  never. A credentialed mode passes a variable **name**; the value stays in the DPAPI envelope and
  is resolved per launch by `vault.decryptForLaunch`.
- **⚠ `npm run grep:secrets` DOES NOT COVER THIS PHASE'S RIGHEST-RISK WRITE.** It reaches `src/`,
  `scripts/`, `_verify/`, `package.json` and root configs — **neither `~/.codex/` nor a project's
  `.mcp.json`.** G4 is therefore *necessary and not sufficient* from Stage 2 onward, and
  `assertNoSecretInRendered` is what actually covers it. **Task 6-2 must also update
  `scripts/secret-grep.mjs`'s scope comment to state that limit**, because a gate believed to cover
  more than it does is worse than one that admits its edge.
- **There is no password column on `project_memory`, in any form, and there must never be one.**
- **`MIGRATIONS.length` moves 13 → 14 exactly once, in Task 6-3.** Assert `MIGRATIONS.length + 1 === 14`
  before appending and **STOP on divergence** rather than renumbering. `sqliteTable(` **16 → 17**.
  **⚠ CORRECTED 2026-08-01 — THIS READ `12 → 13` AND `=== 13` UNTIL THEN.** `v13` was spent while the
  phase waited (`projects.color` + `projects.description`, `schema.ts:20`), which is the first time a
  waiting phase's fixed migration number has decayed in this project. **The premise is uncommitted:
  if that work is reverted the assertion fails at 12 and you stop and report — the rule outranks the
  number in both directions.** Full record in `ImplementationSpec-6-3.md` §1 and the roadmap's
  Phase 6 entry.
- **No test may be edited to accommodate a change.** Baseline **1055 across 30 files**, and the rule
  is **"never fewer"**. The two capability-honesty tests are *widened* (2 → 5 adapters) and the mcp
  arm is *split into a table* — **neither is a loosening, and if either has to weaken to pass, stop
  and report.**
- **The deliberation protocol is closed (D67).** Task 6-1 runs a council; it does not change how one
  works.

## Cost, stated before the first run

**~$2.20 authorised (D101), all of it in Task 6-1.** Tasks 6-2 … 6-5 spend **$0.00** — they add no
paid call path.

| Task | Runs | Envelope |
|---|---|---|
| 6-1 | 1, plus 1 only if the first is refused before producing a document | ~$1.10–$2.20 |
| 6-2 … 6-5 | 0 | $0.00 |

**⚠ STATE THE ENVELOPE BEFORE THE RUN AND MEASURE AGAINST IT** (3b-1's standing lesson, and 3e-2
overran an estimate by 31% for the very reason it had been measured on a partial run). **Quote
whichever number you are quoting** — Chorus's own or OpenRouter's billing page — and say which.

## Gates

- **G1** `npm run typecheck` exits 0.
- **G2** **Run it, don't just compile it.** For 6-1 that is a real council run. For 6-3 onward it is
  the running app over CDP against a **real Neo4j** — *"a memory chip that renders is not a memory
  graph that answers."*
- **G3** One narrated commit per task.
- **G4** `npm run grep:secrets` clean across 6 patterns — **load-bearing from Task 6-3 onward, and
  its blind spot goes in the commit narration.**
- **G5** **Council review checkpoint — FIRED, and it BLOCKS.** `[CR: memory schema + provenance
  model]` has never run. **Task 6-1 is that gate. No task after it may begin until it closes.** This
  is the first phase since 3b where G5 is a real gate rather than a recorded absence.

## What this phase inherits and must not lose

- **The AUTH-PRECEDENCE FINDING and D49.** Never a key in `~/.codex/config.toml`, a `--settings`
  file, or an `apiKeyHelper` script. D93 is that line restated for MCP, not a new rule.
- **D88's three-lists trap** — COPY-FROM / IMPOSE / REMOVE — applies to whoever edits
  `BASELINE_ENV_VARS`, and plan §10 item 6 expects that edit to be needed (`uv` caches under
  `%LOCALAPPDATA%`, which is not on the list).
- **D33 / D53 / D58: no unattended decryption.** `memory:status` is a **pure read** that decrypts
  nothing and opens no bolt session; `memory:test` is **one** user-initiated connect. Getting that
  split wrong turns a status chip into a 15-second unattended-decrypt loop.
- **D76.** The `● neo4j :7688` chip was *omitted* from Phase 3c rather than stubbed, because it had
  no data source. It returns in 6-3 when `memory:status` gives it one, and it renders **nothing at
  all** for a project with no memory configured.
- **D55.** `memory:validate` reports *"43 of 512"*, never *"43"*.

## Milestone

**Agents read and write a per-project memory graph via MCP.** Met at **Task 6-5**, and the honest
statement of what "met" means: **claude and opencode receive a Chorus-written MCP config naming a
real Neo4j, codex receives it as launch argv, and no secret value appears in any file Chorus
wrote** — proven by `assertNoSecretInRendered` over the rendered bytes, not by inspection.

**⚠ THE MILESTONE IS NOT "IT WORKS ON THIS MACHINE".** Plan §10 item 2 records that nobody has
established whether the Neo4j MCP server connects at all with auth disabled. **If it refuses,
local mode falls back to env-var indirection in every mode** — and that is a legitimate outcome of
Task 6-1's D4 pass, not a failure of the phase. **The design must survive its own measurement, which
is what Phase 3e spent four tasks learning.**
