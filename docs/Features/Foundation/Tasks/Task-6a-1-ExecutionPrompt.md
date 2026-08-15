# Task 6a-1 — Execution Prompt (paste into a fresh session)

> **⚠ AUTHORED 2026-08-14 against `main` at `47f633c`. Every number, path, line reference and CLI
> probe below was re-run at that HEAD while authoring this document** — the baseline suite was
> executed, both CLIs were re-probed, and every cited line was read rather than copied forward.
> Where this document disagrees with `Task-6a-1.md` or `ImplementationSpec-6a-1.md`, **read the
> disagreement section first**: there is exactly one, it is in the spec's §8, and taken literally the
> spec ships a feature that passes every unit test and does nothing at runtime.

---

You are the **Coordinator** for **Task 6a-1 — The Usage Contract**, the **first of four tasks in
Phase 6a — Memory In Practice**. Nothing else in the phase pays off until this lands: 6a-2 builds a
codebase index that agents have no reason to query, and 6a-4 provisions a database nobody has been
told exists, unless an agent is first told the graph is there and what it is for.

**Repo root:** `C:\Projects\ContactEstablished\Chorus`
**Expected branch:** `main` at `47f633c` — confirm with `git branch --show-current` and
`git log --oneline -1`. **Do not switch or create branches without instruction.**

---

## ⚠ GATE 0 — THE TREE IS DIRTY AND NONE OF IT IS YOURS

`git status --porcelain` at authoring time — **eleven entries, all pre-existing**:

```
 M docs/Features/Foundation/roadmap.md
?? CLAUDE-PROJECT-MARKER.txt
?? docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-6a-1.md
?? docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-6a-2.md
?? docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-6a-3.md
?? docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-6a-4.md
?? docs/Features/Foundation/Tasks/Phase-6a-Overview.md
?? docs/Features/Foundation/Tasks/Task-6a-1.md
?? docs/Features/Foundation/Tasks/Task-6a-2.md
?? docs/Features/Foundation/Tasks/Task-6a-3.md
?? docs/Features/Foundation/Tasks/Task-6a-4.md
```

- **The modified `roadmap.md` and the nine untracked phase documents are the Phase 6a kickoff's
  output.** They are the documents you are about to execute. **Do not revert them, do not stage them,
  do not commit them, do not "tidy" them.** Committing the phase's planning documents inside the
  phase's first implementation commit would fold two unrelated pieces of work into one narration.
  **If you believe they should be committed, say so in your report and let Matthew decide.**
- `CLAUDE-PROJECT-MARKER.txt` is a one-line write-permission probe. It is **deliberately never
  committed.** Leave it.
- **A twelfth untracked file exists by the time you read this: `Task-6a-1-ExecutionPrompt.md`** — this
  document. Same rule.
- `_verify/` is gitignored working evidence. **Never stage anything under it.**
- Run `git status --porcelain` yourself at the start. **If you find MORE than the twelve above, list
  what you found in your report and still touch none of it.**

**Your commit contains source files and nothing else.**

---

## ⚠ GATE 1 — ENVIRONMENT, AND THE FALSE GREEN IT PRODUCES

**`node_modules` in this repo has been found EMPTY at the start of two separate past sessions.** It
is **one shared directory**: every `.chorus` worktree junctions into
`C:\Projects\ContactEstablished\Chorus\node_modules`, so emptying it removes typecheck and vitest
from every worktree at once.

```bash
npm ci                          # not `npm install` — ci installs the lockfile exactly
npm run rebuild:better-sqlite3  # the /Od workaround; .npmrc documents why
```

**⚠ THE FALSE GREEN, WHICH HAS FIRED TWICE.** With the toolchain gone, `npm run typecheck` fails with
`'tsc' is not recognized` — which contains **no `error TS`**, so a grep for the compiler's error
string reports a clean pass. **Check the EXIT CODE, and grep for the toolchain's own failure, not
only for `error TS`.**

### Baseline — measured 2026-08-14 at `47f633c` by running it, not by quoting the kickoff

| Gate | Value |
|---|---|
| `npm run typecheck` | **exit 0**, node + web |
| `npx vitest run` | **2012 passed / 2012, across 59 files**, exit 0 |
| `npm run grep:secrets` | **clean** — `G4 secret-grep: clean (6 patterns over src/, scripts/, _verify/, package.json, root configs)` |
| `IpcChannel` keys | **86** — you add **none** |
| `MIGRATIONS.length` | **19** — you add **none** |
| `grep -c "sqliteTable(" src/main/db/schema.ts` | **18** — unchanged |
| runtime deps in `package.json` | **8** — unchanged; `git diff -- package.json` must be **empty** |

**Write your own baseline down before touching code (G6).** These numbers are true as of authoring
and this project has watched shared counters decay three times.

> **Known flake, recorded as F50:** `src/main/adapters/adapters.test.ts` fails intermittently in
> full-suite runs (once observed in nine) while passing in isolation — cross-file interference,
> pre-existing. **⚠ THIS IS A FILE YOU ARE EDITING, so you will see it. Re-run before diagnosing.**

---

## ⚠ THE ONE PLACE THE SPEC IS WRONG — READ THIS BEFORE YOU READ THE SPEC

**`ImplementationSpec-6a-1.md` §8 tells you to attach the contract text to the options returned by
`withMcpEnv`. Done literally, THE CONTRACT NEVER REACHES EITHER TARGET ADAPTER, AND EVERY UNIT TEST
STILL PASSES.**

`src/main/ipc.ts`'s `withMcpEnv` has **two** early returns, not one:

| Line | Code | What it does |
|---|---|---|
| `647` | `if (!input) return opts` | **This is D148's gate.** No memory configured → no contract. Correct, and the spec is right that you must not add a second one. |
| **`669`** | **`if (Object.keys(wiring.envAdditions).length === 0) return opts`** | **⚠ THE TRAP.** Returns the untouched options whenever the wiring produced no environment additions. |

**`wiring.envAdditions` is empty for BOTH adapters this task targets**, and this is structural rather
than incidental — read `src/main/adapters/mcpConfigWrite.ts:190`:

- **codex** is a `launch-args` mechanism, so `wireMcpForLaunch` returns `NOTHING_TO_DO`
  (`mcpConfigWrite.ts:181`) — `envAdditions: {}`.
- **claude** is a `project-file` mechanism with **no `pathEnvVar`**, so line `192` yields
  `envAdditions: {}` as well.
- Only **opencode** (`env-named-file`, `OPENCODE_CONFIG`) ever produces a non-empty map — **and
  opencode is one of the three adapters that declares `instructions: null`.**

So the composition must be attached **at or before line 669**, and the `return opts` at 669 must
carry it too. Concretely, the shape that works:

```ts
    // D148: composed once, ABOVE the envAdditions early return — that return
    // fires for BOTH adapters this contract targets (claude writes a project
    // file and names no env var; codex is argv-only), so attaching below it
    // would ship a contract that never launches.
    const withInstructions = instructions ? { ...opts, instructions } : opts

    if (Object.keys(wiring.envAdditions).length === 0) return withInstructions
    …
    return { ...withInstructions, envAdditions: { ...wiring.envAdditions, ...profileEnv } }
```

**⚠ AND THIS IS EXACTLY THE CLASS OF BUG NO UNIT TEST IN THIS TASK CAN CATCH.** Every test named in
`Task-6a-1.md`'s *Test Expectations* exercises `instructionsCore` or an adapter's `buildLaunch` with
a `PtyLaunchSpec` handed to it directly. **Nothing under test calls `withMcpEnv`.** A green suite
would sit on top of a feature that does nothing, and the only signal would be step 2 of the runtime
drive coming back with the agent saying it has no memory tools — which is indistinguishable from a
dozen other causes. **Add a test that covers this seam if you can find one that does not require
Electron; if you cannot, say so plainly in your report and lean harder on the runtime drive.**

Everything else in the spec was checked against the code and holds. The three smaller drifts are in
*Line-number corrections* below.

---

## Goal

**Teach the two agents that can be told — `claude` and `codex` — that this project has a memory
graph: when to read it, when to write to it, and what a written memory must cite to count as
sourced.** The text is delivered **per session, at launch, through mechanisms that touch no file the
user owns**, and it is emitted **only for a project that actually has memory configured**.

**The task is done when a `claude` session that was never told about `chorus-memory` in its prompt
names the server when asked what memory it has for this project.** Not when the code compiles, and
not when the suite is green.

**⚠ THE PRIME CONSTRAINT: NO USER-OWNED FILE IS READ, WRITTEN OR CREATED, ANYWHERE IN THIS DIFF.**
Not `CLAUDE.md`, not `AGENTS.md`, not `~/.codex/config.toml`, not `.claude/settings.json`, not
`.chorus/memory-usage.md`. **D49 is this task's central constraint**, and the natural place to put
*"query before assuming"* — the user's own hand-authored instruction file — is the forbidden place.
That is the whole reason the capability exists in this shape.

---

## Ground yourself first — read before editing

**Authoritative, read in full, in this order:**

1. `docs/Features/Foundation/Tasks/Phase-6a-Overview.md` — the phase's verified ground facts, the
   purity contract, and the two findings where **D147's own mechanisms did not survive contact with
   the installed CLI**.
2. `docs/Features/Foundation/Tasks/Task-6a-1.md` — scope, non-goals, acceptance criteria, review
   checklist.
3. `docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-6a-1.md` — the exact contract
   text, insertion points and runtime checks. **§8 is corrected above; §1–§7 and §9 stand.**
4. `docs/Features/Foundation/Phase-6a-Proposal.md` — scope authority (adopted as D147). Read §3.

**Roadmap** (`docs/Features/Foundation/roadmap.md`) — **all RESOLVED; quote them as constraints, not
as background:**

- **D148 (RESOLVED 2026-08-14 — Phase 6a kickoff; Matthew chose the vehicle)** — *"The usage
  contract's claude mechanism is `--append-system-prompt-file`, not `--settings` — correcting D147(e)
  on a measurement taken at the Phase 6a kickoff."* Main reserves the path under
  `userData\agent-instructions`, the adapter writes it, **every exit path deletes it**. The codex
  half: `-c developer_instructions` is **already occupied** by the jade rule, `-c` **replaces** rather
  than appends, and codex ignores a duplicated or unknown `-c` path **silently** — so **6a-1 gives
  that key exactly one emitter**. **Scope is two adapters, not four**; `kimi`, `opencode` and
  `noHarness` declare the capability **null**. **And the contract is emitted only when the project has
  memory configured** (`mcpLaunchInput !== null` — already the early return at `ipc.ts:647`, so one
  gate rather than two).
- **D147(e) (RESOLVED 2026-08-14, product decision, Matthew)** — session-level injection, **not**
  writing the user's files. Named cost, stated rather than hidden: *"it consumes context every launch
  and is invisible to an agent the user runs outside Chorus."* A marked idempotent block in
  `CLAUDE.md` stays available as an explicit **opt-in, never a default** — **and is not built here.**
- **D49 (RESOLVED 2026-07-24)** — the bright line on writing another CLI's auth/config.
- **D93 (ACCEPTED 2026-07-28)** — names, never values.
- **D130** — `--settings` is the hooks mechanism. It is the precedent for the file idiom, **not** the
  vehicle for this contract.
- **D76** — the no-stub rule: no method, no flag, no comment promising one later.
- **G2** — run it, do not just compile it. **G3** — one intentional commit. **G6** — re-count shared
  counters rather than trusting any document, including this one.

**Code to inspect — every line number below was read at `47f633c` on 2026-08-14. Re-confirm before
quoting, per G6.**

| File | Line | Why |
|---|---|---|
| `src/main/adapters/types.ts` | `45` (`AgentCapabilities`), `55` (`hooks`), `175` (`HooksDescriptor`), `335` (`PtyLaunchSpec`), `402` (`PtyLaunchHooks`), `776`/`784`/`806` (the three guards) | Every insertion point for the new descriptor, launch field and guard. |
| `src/main/adapters/claude.ts` | `114`–`124` (capabilities), `182`–`221` (`writeHooksConfig`), `223` (`buildLaunch`), `239` (`resumeArgs`), `242` (the args spread) | The shape you copy, and the exact spread you extend. **`writeHooksConfig` returns `[]` rather than throwing on any failure — copy that, deliberately.** |
| `src/main/adapters/codex.ts` | `105` (capabilities, `hooks: null`), `131` (`buildLaunch`), `142` (`const args = …`), `680` (silent-ignore), `697`/`708` (why one physical line, and that `-c` replaces), `717` (`CODEX_JADE_ECHO_INSTRUCTIONS`), `742` (`CODEX_BASELINE_ARGS`) | **The delicate one.** Read `:697`–`:708` before writing a character. |
| `src/main/adapters/mcpConfigCore.ts` | `40` (`tomlBasicString`), `84` (`renderMcpLaunchArgs`) | `tomlBasicString` escapes `\` and `"` and **NOT newlines** — the reason `assertSingleLine` is load-bearing. |
| `src/main/adapters/mcpConfigWrite.ts` | `170`–`196` (`wireMcpForLaunch`), `190`–`192` | **Read this to understand why `envAdditions` is empty for claude and codex.** Also `:161`'s rule: *"every decision here reads the descriptor; there is no `id === 'opencode'` anywhere in it"* — **follow it in `ipc.ts` when picking a renderer.** |
| `src/main/adapters/adapters.test.ts` | `80` (`capabilityAdapters`), `599` (the registry-coverage assertion), `1009` (`EXTENSION_METHODS`), `1019`–`1024` | The honesty machinery. One added row makes the generic case cover three descriptors across five adapters. |
| `src/main/services/sessionManager.ts` | `154` (`LaunchOptions`), `229` (`hookConfigDir`), `277` (`bindHooks`), **`338`** (`retireHooks`), `636` and `928` (**both** call sites), `698`–`709` (the hooks mint), `735` (the `buildLaunch` call) | The main-owns-path / adapter-owns-format idiom, verbatim. |
| `src/main/index.ts` | `339` (`agent-hooks` dir), `346` (the boot sweep), `350`–`355` (the `try` that guards `bindHooks`), `361` (the "same directory idiom" comment) | **Bind the instructions dir OUTSIDE that `try`.** |
| `src/main/ipc.ts` | `638` (`withMcpEnv`), `644` (`mcpLaunchInput`), `647` (**the gate**), `649` (`wireMcpForLaunch`), **`669`** (**the trap**), `1409`/`1462`/`1492`/`2649` (the four call sites, including restore) | Where the text is composed and attached. |
| `src/main/services/memoryService.ts` | `160` (`CHORUS_MEMORY_SERVER = 'chorus-memory'`), `254` (`mcpLaunchInput`) | **Import the server name. Never re-type it.** |

---

## ⚠ STEP 1 — RE-PROBE BOTH CLIS BEFORE WRITING ANYTHING

CLAUDE.md forbids trusting recall for CLI syntax, and the whole vehicle of this task rests on one
flag existing. **Probed 2026-08-14 on this machine, and the exact outputs were:**

```powershell
claude --version
#   2.1.232 (Claude Code)

claude --help | Select-String "append-system-prompt"
#     --append-system-prompt <prompt>       Append a system prompt to the default
#                                           --append-system-prompt[-file], --add-dir

claude --append-system-prompt-file
#   error: option '--append-system-prompt-file <file>' argument missing   <-- the flag EXISTS

codex --version
#   codex-cli 0.147.0
```

**Re-run all four. Record the versions in your report.**

**⚠ STOP AND REPORT if `--append-system-prompt-file` is not accepted.** The fallback,
`--append-system-prompt <text>`, puts the whole snippet on a **world-readable command line**
(`Get-CimInstance Win32_Process`) — that is a **decision for Matthew**, not a substitution you may
make. The design would be wrong, not the code.

### The fourth probe — no fallback, recorded either way

codex's duplicate-key behaviour. The implementation emits exactly **one** token regardless; the probe
exists so the next person does not have to wonder, and because the entire delicacy of §4 rests on the
claim that a second token destroys a value silently.

```powershell
codex --strict-config -c developer_instructions="A" -c developer_instructions="B" debug prompt-input
```

Save the output to `_verify/6a-1/codex-duplicate-c.txt` **whatever it shows.**

---

## Implementation scope

**Create**

- `src/main/adapters/instructionsCore.ts` — the pure snippet core. **No `fs`, no `electron`, no
  `neo4j-driver`, and no adapter imported.** It lives in `adapters/` beside `mcpConfigCore.ts`,
  which is the precedent for *a pure core adapters share so a rule does not get two homes*.
- `src/main/adapters/instructionsCore.test.ts`

**Edit — and nothing outside this list**

| File | Change |
|---|---|
| `src/main/adapters/types.ts` | `InstructionsDescriptor`, `AgentCapabilities.instructions` (**required and nullable**, like its three siblings, so every adapter is forced to answer), `PtyLaunchInstructions`, `PtyLaunchSpec.instructions?`, `SupportsInstructions`, `supportsInstructions`. |
| `src/main/adapters/claude.ts` | Descriptor `{ mode: 'static', mechanism: 'append-system-prompt-file' }`; `instructionsArgs` placed immediately after `writeHooksConfig`; composed into `buildLaunch` **after `hookArgs`, before `resumeArgs`**. |
| `src/main/adapters/codex.ts` | Descriptor `{ mode: 'static', mechanism: 'config-override' }`; **the `developer_instructions` pair moves out of `CODEX_BASELINE_ARGS` into `instructionsArgs`**, which composes jade **plus** the memory line when there is one; called **unconditionally** from `buildLaunch` in the position the pair occupies today. |
| `src/main/adapters/kimi.ts`, `opencode.ts`, `noHarness.ts` | `instructions: null`. **One line each. No method, no stub, no comment promising one later (D76).** |
| `src/main/adapters/adapters.test.ts` | One row `['instructions', 'instructionsArgs']` in `EXTENSION_METHODS` (`:1009`); the argv pins. |
| `src/main/services/sessionManager.ts` | `instructionsDir`, `bindInstructionsDir`, `retireInstructions`, the mint beside the hooks mint, the new field on the `buildLaunch` call, `LaunchOptions.instructions?`. |
| `src/main/index.ts` | The `agent-instructions` directory, bound beside `agent-hooks` and **outside the hook-listener `try`**. |
| `src/main/ipc.ts` | Compose the text in `withMcpEnv` and carry it on `LaunchOptions` — **above line 669, per the correction section.** |

### Binding rules

1. **⚠ THE `developer_instructions` KEY GETS EXACTLY ONE EMITTER.** `-c` **replaces** rather than
   appends (`codex.ts:708`) and codex ignores a duplicated or unknown `-c` path **without a word**
   (`codex.ts:680`). Two tokens means one of the two values is silently destroyed and **the only
   symptom is a formatting rule that quietly stopped working.** Compose both parts into one value.
2. **⚠ ONE PHYSICAL LINE, ENFORCED BY A THROW.** `tomlBasicString` (`mcpConfigCore.ts:40`) escapes
   backslashes and quotes and **not newlines**, so a raw newline inside a `-c key="…"` override is an
   illegal TOML basic string — which codex discards silently. `assertSingleLine` is **load-bearing,
   not defensive**, and it needs a unit test proving it throws.
3. **⚠ THE SERVER NAME IS IMPORTED, NEVER RE-TYPED.** `import { CHORUS_MEMORY_SERVER } from
   '../services/memoryService'`. `memoryService.ts:160` already records that renaming it would strand
   the old entry in every `.mcp.json` Chorus has written; a second spelling here would teach agents a
   name the config does not use.
4. **⚠ THE CONTRACT DEGRADES, IT NEVER BLOCKS A LAUNCH.** `instructionsArgs` returns `[]` and logs on
   any write failure — the same ruling as `writeHooksConfig`'s missing-curl branch. *Losing the memory
   contract costs a hint; refusing to start costs the session.*
5. **⚠ THE INSTRUCTIONS DIRECTORY IS BOUND OUTSIDE THE HOOK-LISTENER BRANCH.** `bindHooks` sits inside
   a `try` because a listener may fail to bind its port (`index.ts:350`–`355`). If the instructions
   binder went in with it, a machine whose hook port is refused would **silently lose the memory
   contract too** — two unrelated failures welded together by an indentation level.
6. **⚠ `retireInstructions` IS CALLED AT BOTH `retireHooks` SITES — `sessionManager.ts:636` AND
   `:928`. Grep, do not assume.** One missed site leaves a session's contract readable on disk after
   the session is gone, accumulating one file per launch, forever.
7. **The renderer is chosen from the descriptor, never from the id.** Read
   `adapter.getCapabilities().instructions?.mechanism` and switch on it, exactly as
   `mcpConfigWrite.ts:161` requires: *"there is no `id === 'opencode'` anywhere in it"*, so the fifth
   adapter is wired by declaring a descriptor.
8. **Nothing routes user input into the snippet.** It is a static string plus an imported server
   name. Keep it that way — that is what makes `PtyLaunchInstructions.text` non-secret **by
   construction** rather than by inspection.

### A judgment call the spec does not make — decide it and say which way you went

`index.ts:340`–`350` sweeps the whole `agent-hooks` directory at boot, because *"a tree-kill or a
power loss leaves them behind"* and boot is the one moment it is provably safe. **The same is true of
`agent-instructions`, and the spec does not ask for the sweep.** Adding it matches the established
idiom and costs four lines; leaving it out means a crashed session's contract file survives
indefinitely. **Either choice is defensible — make one, implement it, and state it in your report.**
Do not add it silently.

---

## Strict non-goals

- **⚠ NO USER FILE IS READ, WRITTEN OR CREATED.** Not `CLAUDE.md`, not `AGENTS.md`, not
  `.chorus/memory-usage.md`, not `~/.codex/config.toml`, not `.claude/settings.json`. **Option (a) of
  the proposal — the marked idempotent block — is not built here, not even behind a disabled flag
  (D76).**
- **No opt-in setting, no toggle, no preference.** The contract is emitted for a project with memory
  configured and for no other project. **A switch is a decision nobody has made.**
- **No kimi and no opencode injection.** Both declare `instructions: null` (D148). kimi's only vehicle
  (`--agent-file`) replaces the agent profile wholesale; opencode's `instructions` config key is
  unmeasured and its schema is `additionalProperties: false`.
- **No change to what the jade rule says or when it is emitted.** A codex launch with **no** memory
  configured must produce **byte-identical argv to HEAD**.
- **No graph writes, no MCP changes, no new IPC channel.** `IpcChannel` stays **86**.
- **No migration.** `MIGRATIONS.length` stays **19**. (If you somehow find you need one, the next free
  number is `v20` **confirmed at the moment of writing, never quoted from a document** — it has decayed
  three times in this project's history.)
- **No new dependency.** Runtime deps stay **8**; `git diff -- package.json` must be empty.
- **No UI.** No Settings control, no chip, no indicator. The contract is invisible by design this task.
- **Do not touch the twelve Gate 0 files.** Do not push, do not open a PR, unless explicitly asked.

---

## Line-number corrections to the spec — three small ones

Checked at `47f633c`; the spec is otherwise accurate.

1. **`ImplementationSpec-6a-1.md` §6 cites `retireHooks` at `:347`.** It is at **`sessionManager.ts:338`**
   (`:340` is `const dir = this.hookConfigDir`). The two **call sites** the spec names — `:636` and
   `:928` — are both correct.
2. **§6 places the mint "immediately after the hooks mint (`:709`)".** The hooks mint runs
   `:697`–`:709`; `:709` is the closing brace of its `catch`. Insert **after** it, before the D139/D140
   conversation-id block that begins at `:710`.
3. **§4's `buildLaunch` edit is at `codex.ts:142`, and that line is only the first of several
   `args.push(…)` calls** — the route block (`:162`), the effort args (`:179`) and the resume
   subcommand (`:204`) all append afterwards. **Put `instructionsArgs` in the initial array at `:142`,
   as the spec says**: today's baseline is `['-c','tui.status_line=…','-c','developer_instructions=…']`,
   so `[...cli.args, ...CODEX_BASELINE_ARGS, ...this.instructionsArgs(null)]` reproduces exactly that
   sequence and keeps `CODEX_BASELINE_ARGS` a genuine argv **prefix** — which is what lets every
   existing exact-equality pin stay an exact-equality pin instead of reasoning about a tail
   (`codex.ts:735`–`741` explains why that matters).

---

## Required workflow

1. **Gates 0 and 1 first.** Record your own baseline before touching code.
2. **Step 1's four CLI probes.** Stop and report if the flag is gone.
3. Read the correction section, then the Overview, then the task doc, then the spec.
4. Implement as a **coordinator**: worker pass → **spec-compliance review clause by clause** (noting
   that §8 is superseded by the correction above) → **code-quality review** → resolve findings →
   verification → commit narration.
5. **One intentional commit (G3)**, house style: a concise title, then a plain-language description a
   non-technical reader can follow **first**, technical detail second under a `--- technical ---`
   divider. **Quote D148's correction of D147(e) in the message** — that `--settings` cannot carry an
   instruction is the measurement the whole mechanism rests on.
6. **Do not push and do not open a PR unless explicitly asked.**
7. If any instruction here conflicts with `CLAUDE.md`, **`CLAUDE.md` wins** — say so in your report.

---

## Verification — run these, do not reason about them

### Build gates

```bash
npm run typecheck          # exit 0 — check the EXIT CODE, not just for "error TS"
npx vitest run             # >= 2012 passed across >= 59 files, plus your new cases
npm run grep:secrets       # clean, 6 patterns
git diff -- package.json   # MUST BE EMPTY
```

### Counter gates — the numbers this task must not move

```bash
node -e "const s=require('fs').readFileSync('src/shared/ipc.ts','utf8');console.log('IpcChannel keys:',(s.match(/^\s+[A-Za-z]+: '/gm)||[]).length)"   # 86
grep -c "sqliteTable(" src/main/db/schema.ts                                                                                                          # 18
```

### Structural gates

```bash
# EXACTLY ONE EMITTER of the key. Expect it in codex.ts and its tests, and nowhere else.
grep -rn "developer_instructions" src/

# BOTH retire sites, side by side.
grep -n "retireHooks\|retireInstructions" src/main/services/sessionManager.ts

# The core stays pure: NO HITS for fs, electron or an adapter import.
grep -nE "from 'fs'|from 'node:fs'|from 'electron'|from './claude'|from './codex'" src/main/adapters/instructionsCore.ts

# No user-owned file anywhere in the diff.
git diff --stat
```

### ⚠ Runtime drive — the task is not done until this has been OBSERVED, not compiled

**Environment notes for this machine, so you do not lose an hour:**

- Use the **dev** build, not the installed `Chorus.exe` on `%APPDATA%\chorus-app`. The installed
  instance self-isolates in code since 0.1.2. **Kill the dev one by command line (`*9222*`), never by
  process name** — killing by name takes out Matthew's real instance and its database.
- **Five SQLite databases exist on this box** (Claude Desktop's app container shadows `%APPDATA%`).
  Check which file is actually growing before you read one.
- Prefer **CDP on `--remote-debugging-port 9222`** over user32 automation for driving the window.

**Step 0 — the container** (Chorus does not provision one until 6a-4; start it by hand). Note the
explicit loopback bind — **D151(b) made this the standard, and `-p 7688:7687` alone publishes an
unauthenticated database to the local network**:

```powershell
docker run -d --name chorus-6a1-neo4j -e NEO4J_AUTH=none -p 127.0.0.1:7688:7687 neo4j:5-community
docker logs chorus-6a1-neo4j --tail 20    # wait for "Started."
```

Then in Chorus: **Project Settings → Memory**, local mode, `bolt://127.0.0.1:7688`, click **Test** and
confirm a successful probe **before going further**.

**Step 1 — hash the file that must not change.** Re-baseline **immediately before** the launch —
codex writes this file itself, and a stale hash reports a change Chorus did not make (the Phase 6 G2
lesson, learned the hard way):

```powershell
Get-FileHash $env:USERPROFILE\.codex\config.toml
```

**Step 2 — claude, in the memory-configured project.** Launch a pane, then:

```powershell
Get-CimInstance Win32_Process | Where-Object CommandLine -like '*claude*' | Select-Object -Expand CommandLine
Get-ChildItem "$env:APPDATA\chorus-app\agent-instructions"    # or the dev userData path
```

Expect `--append-system-prompt-file <path>` on the command line and a **readable Markdown file** at
that path. Print the file.

**Step 3 — 🎯 THE REHEARSAL FOR THE PHASE MILESTONE.** In that pane, ask — **without naming
`chorus-memory`**:

```
what memory do you have available for this project?
```

**An agent that names the server has read the contract.** Save the transcript. **This is the step
that decides whether the task worked**; everything before it is machinery.

**Step 4 — the deletion.** Close the pane. `Get-ChildItem` the directory again: **the file is gone.**

**Step 5 — codex, same project.** Confirm from the live command line that there is **exactly one**
`-c developer_instructions=` token, that its value contains **both** the jade rule and the memory
contract, and that it is **one physical line**. Then confirm **the jade block still renders in its
first reply** — that is how you know the composition did not eat the formatting rule.

**Step 6 — the byte-identity control.** Launch both agents in a project with **no** memory configured.
Capture argv and diff it against a pre-change capture. **Identical — not "equivalent", not "the same
tokens in a different order".** *Every argv regression this project has shipped was invisible to the
person who made it and obvious in a diff.*

**Step 7 — re-hash `~/.codex/config.toml`: byte-identical.**

**Step 8 — tear down:** `docker rm -f chorus-6a1-neo4j`. **The container is disposable; do not remove
any volume** (D151 — F49 gates durability on an export/restore path this phase has not built).

**Save everything under `_verify/6a-1/`.**

---

## Failure honesty

If a verification command fails for an unrelated environment reason, **capture the exact output,
explain it, and do not claim success.** A gate you could not run is reported as **NOT RUN** — never
as passed, never silently omitted.

**Four false-green traps this repo has already produced, all real:**

- A missing toolchain makes `npm run typecheck` fail with `'tsc' is not recognized`, which contains no
  `error TS`. **Check exit codes.**
- A passing unit test says nothing about runtime behaviour. **Do not infer a passing runtime result
  from a passing suite** — and on this task the gap is not theoretical: see the `ipc.ts:669`
  correction, where a fully green suite sits on top of a feature that never fires.
- **A flag on a command line is not a contract an agent read.** The milestone is step 3's answer, not
  step 2's argv.
- A stale hash of `~/.codex/config.toml` reports a change Chorus did not make. **Re-baseline
  immediately before the launch.**

If the runtime drive cannot be completed (no Docker, agent will not connect, memory cannot be
configured), report **`DONE_WITH_CONCERNS`** or **`BLOCKED`** with the evidence, and say **exactly
which of steps 0–7 was reached.**

---

## Final report — required structure

1. **Status:** `DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED`.
2. **CLI probes:** `claude --version`, the `--help` line, the argument-missing probe, `codex --version`
   — the **actual output**, plus the duplicate-`-c` result and where you saved it.
3. **The `ipc.ts:669` correction:** confirmed or refuted, and how you attached the text. **If you
   found a way to unit-test that seam, say so; if not, say that too.**
4. **Files changed**, with a one-line reason each.
5. **Build results:** typecheck exit code, vitest counts **before and after** (baseline **2012 / 59
   files**), `grep:secrets` status, `package.json` diff empty.
6. **Counter confirmations:** `IpcChannel` **86**, `MIGRATIONS.length` **19**, `sqliteTable(` **18**,
   runtime deps **8**.
7. **Structural greps — paste the output:** the single `developer_instructions` emitter, both retire
   call sites, the purity grep over `instructionsCore.ts`.
8. **Runtime results:** what was **actually observed** at each of steps 0–7, including **the exact
   answer the agent gave in step 3** and **whether the jade block still rendered in step 5**. Name any
   step not reached and why.
9. **The byte-identity control:** the two argv captures and the diff result, stated as a fact rather
   than an assertion.
10. **The `~/.codex/config.toml` hash, before and after.**
11. **The boot-sweep judgment call:** which way you went and why.
12. **Review outcomes:** spec-compliance findings (naming which §8 clauses the correction voided) and
    code-quality findings, and how each was resolved.
13. **Non-goals confirmation:** no user file touched anywhere in the diff, no migration, no channel,
    no dependency, no UI, kimi/opencode/noHarness still `null` by decision.
14. **Residual risks and new findings** — anything found and deliberately not fixed, phrased so the
    next task (6a-2, which edits `ipc.ts` and `types.ts` again) inherits it rather than rediscovers it.
15. **Final `git status`** — the twelve Gate 0 entries still present and untouched — and **the commit
    hash**.
