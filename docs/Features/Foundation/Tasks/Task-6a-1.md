# Task 6a-1 — The Usage Contract

_Phase 6a, task 1 of 4. Authored 2026-08-14 against `47f633c`._

## Source Of Truth

| Document | Owns |
|---|---|
| [`../Phase-6a-Proposal.md`](../Phase-6a-Proposal.md) §3 (6a-1) | Why this task exists and what it must say |
| [`Phase-6a-Overview.md`](Phase-6a-Overview.md) | The verified ground facts below — **use its table, never the proposal's mechanism names** |
| `roadmap.md` §6 — **D148**, D147(e), **D49**, D93, D130 | The rulings this task executes and the bright line it must not cross |
| [`../ImplementationSpecs/ImplementationSpec-6a-1.md`](../ImplementationSpecs/ImplementationSpec-6a-1.md) | Exact file contents, insertion points and runtime checks |

## Initial Starting Point — verified 2026-08-14 at `47f633c`

| Fact | Where | Value |
|---|---|---|
| `AgentCapabilities` | `src/main/adapters/types.ts:45` | five booleans + `reasoningEffort`, `sessionResume`, `mcp`, `hooks` — **no instructions field** |
| `HooksDescriptor` | `types.ts:175` | the shape the new descriptor mirrors |
| `supportsMcp` / `supportsHooks` / `supportsResume` | `types.ts:776` / `:784` / `:806` | the three type guards the new one joins |
| `PtyLaunchSpec` | `types.ts:335` | **no instructions field** |
| `PtyLaunchHooks` | `types.ts:402` | the main-owns-path / adapter-owns-format split this task copies verbatim |
| claude's capabilities | `claude.ts:114`–`:124` | `hooks: { mode: 'static', mechanism: 'http_listener' }` |
| `claude.writeHooksConfig` | `claude.ts:182`–`:221` | writes the file, returns `['--settings', path]`, **returns `[]` rather than throwing** on any failure |
| `claude.buildLaunch` | `claude.ts:223` | `args: [...cli.args, ...effortArgs, ...hookArgs, ...resumeArgs]` at `:242` |
| codex's capabilities | `codex.ts:105` | `hooks: null` |
| `codex.buildLaunch` | `codex.ts:131` | `const args = [...cli.args, ...CODEX_BASELINE_ARGS]` at `:142` |
| `CODEX_BASELINE_ARGS` | `codex.ts:742` | **two `-c` pairs: `tui.status_line=…` and `developer_instructions=<jade>`** |
| `CODEX_JADE_ECHO_INSTRUCTIONS` | `codex.ts:717` | one physical line, joined with `' '` — and `:697` says why |
| `tomlBasicString` | `mcpConfigCore.ts:40` | escapes `\` and `"` — **not newlines** |
| kimi / opencode / noHarness capabilities | `kimi.ts:113` · `opencode.ts:148` · `noHarness.ts:87` | `hooks: null` — the rows the new descriptor joins as `null` |
| The honesty table | `adapters.test.ts:1009` (`EXTENSION_METHODS`) | `[['mcp','writeMcpConfig'], ['hooks','writeHooksConfig']]` |
| The honesty list | `adapters.test.ts:80` (`capabilityAdapters`) | derived from `staticRegistry` — **all five adapters, automatically** |
| `SessionManager.hookConfigDir` | `sessionManager.ts:229` · bound at `:277` | `null` is a legal steady state |
| `retireHooks` | `sessionManager.ts:338`, called at `:636` and `:928` | **two call sites, and both must gain the sibling** |
| The hooks mint | `sessionManager.ts:697`–`:709` | the exact block the instructions mint sits beside |
| `buildLaunch` call | `sessionManager.ts:735` | where the new spec field is passed |
| `agent-hooks` dir | `index.ts:339`, bound at `:352` | `join(app.getPath('userData'), 'agent-hooks')` |
| `withMcpEnv` | `ipc.ts:638` | already has `project`, `agent` and `cwd`, already calls `memory.mcpLaunchInput(project.id)` at `:644` |
| `LaunchOptions` | `sessionManager.ts:154` | the options bag the text travels in |
| Baseline | — | typecheck **0** · vitest **2012 / 59 files** · `grep:secrets` clean |

### ⚠ Two facts that will cost a session if they are not believed

1. **`--settings` CANNOT CARRY AN INSTRUCTION.** D147(e) names it; it is a settings-JSON file and has
   no system-prompt field. **The vehicle is `--append-system-prompt-file <file>`, D148** — measured
   on the installed **claude 2.1.232** by omitting its argument and reading back
   `error: option '--append-system-prompt-file <file>' argument missing`. **Re-probe it before
   writing code; do not trust this line.**
2. **`-c developer_instructions=` IS ALREADY OCCUPIED BY THE JADE RULE**, and `-c` **replaces**
   (`codex.ts:708`). Emitting a second one silently destroys one of the two values, and codex reports
   nothing at all for a duplicate or unknown `-c` path (`codex.ts:680`). **There is exactly one
   token, composed from both parts.**

## Goal

Teach the two agents that can be told — claude and codex — that this project has a memory graph, when
to read it, when to write to it, and what a written memory must cite to count as sourced. The text is
delivered **per session, at launch, through mechanisms that touch no file the user owns**, and it is
emitted **only for a project that actually has memory configured**. When this task lands, an agent
that was never told about `chorus-memory` in its prompt still knows the server exists and what it is
for — which is the precondition every other task in this phase depends on.

## Exact Scope

**Create**

- `src/main/adapters/instructionsCore.ts` — the pure snippet core. No `fs`, no `electron`, no adapter
  imported.
- `src/main/adapters/instructionsCore.test.ts`

**Edit**

- `src/main/adapters/types.ts` — `InstructionsDescriptor`, `AgentCapabilities.instructions`,
  `PtyLaunchInstructions`, `PtyLaunchSpec.instructions`, `SupportsInstructions`,
  `supportsInstructions`.
- `src/main/adapters/claude.ts` — declare the descriptor; implement `instructionsArgs`; compose it
  into `buildLaunch`.
- `src/main/adapters/codex.ts` — declare the descriptor; implement `instructionsArgs` as **the one
  home for the `developer_instructions` token**; `CODEX_BASELINE_ARGS` loses that pair to it.
- `src/main/adapters/kimi.ts`, `opencode.ts`, `noHarness.ts` — `instructions: null`, one line each.
- `src/main/adapters/adapters.test.ts` — one row in `EXTENSION_METHODS`; the argv pins.
- `src/main/services/sessionManager.ts` — `instructionsDir`, `bindInstructionsDir`,
  `retireInstructions`, the mint beside the hooks mint, the new `buildLaunch` field.
- `src/main/index.ts` — the `agent-instructions` directory, bound beside `agent-hooks`.
- `src/main/ipc.ts` — compose the text in `withMcpEnv` and carry it on `LaunchOptions`.

**Nothing else.**

## Non-Goals

- **⚠ NO USER FILE IS READ, WRITTEN OR CREATED.** Not `CLAUDE.md`, not `AGENTS.md`, not
  `.chorus/memory-usage.md`, not `~/.codex/config.toml`, not `.claude/settings.json`. **D49 is this
  task's central constraint**, and option (a) of the proposal — the marked idempotent block — is
  **not built here**, not even behind a disabled flag (D76's no-stub rule).
- **No opt-in setting, no toggle, no preference.** The contract is emitted for a project with memory
  configured and for no other project. A switch is a decision nobody has made.
- **No kimi and no opencode injection.** Both declare `instructions: null` (D148). kimi's only vehicle
  (`--agent-file`) replaces the agent profile wholesale; opencode's `instructions` config key is
  unmeasured, and its schema is `additionalProperties:false` (`mcpConfigCore.ts:135`).
- **No change to what the jade rule says or when it is emitted.** A codex launch with no memory
  configured must produce **byte-identical argv to HEAD**.
- **No graph writes, no MCP changes, no new IPC channel.** `IpcChannel` stays at **86**.
- **No migration.** `MIGRATIONS.length` stays **19**.
- **Do not revert, stage, commit or delete unrelated working-tree changes.** `CLAUDE-PROJECT-MARKER.txt`
  is untracked at kickoff and stays that way.

## Dependencies

**None.** This is the first task of the phase.

## Step-by-step Work

1. **Re-probe both CLIs before writing anything.** `claude --version`, `claude --help | grep
   append-system-prompt`, and the argument-missing probe for the `-file` variant. `codex --version`.
   **STOP and report if `--append-system-prompt-file` is not accepted** — the task's mechanism is
   wrong and the design, not the code, is what needs fixing.
2. **Probe codex's duplicate-`-c` behaviour** (`_verify/6a-1/`): run codex with two
   `-c developer_instructions=` tokens and record which value survives. The result is recorded in the
   spec's Verification section either way; the implementation must not depend on it, because it emits
   exactly one.
3. **Write `instructionsCore.ts`** — the sentences, plus a Markdown renderer and a one-line renderer,
   plus `assertSingleLine` used by the codex path. Pure; no adapter imports it in reverse.
4. **Widen `types.ts`** — descriptor, launch-spec field, guard. `AgentCapabilities.instructions` is
   **required and nullable**, exactly like `hooks`, so every adapter has to answer.
5. **claude**: declare `{ mode: 'static', mechanism: 'append-system-prompt-file' }`; implement
   `instructionsArgs`, which creates the parent directory, writes the file, and returns
   `['--append-system-prompt-file', path]` — **and returns `[]` on any failure, logging it**, exactly
   as `writeHooksConfig` degrades when curl is missing. Compose into `buildLaunch` **after
   `hookArgs`, before `resumeArgs`**.
6. **codex**: declare `{ mode: 'static', mechanism: 'config-override' }`; move the
   `developer_instructions` pair out of `CODEX_BASELINE_ARGS` into `instructionsArgs`, which composes
   jade **plus** the memory line when there is one; call it unconditionally from `buildLaunch` in the
   position the pair occupies today.
7. **kimi, opencode, noHarness**: `instructions: null`.
8. **`adapters.test.ts`**: add `['instructions', 'instructionsArgs']` to `EXTENSION_METHODS`; pin the
   no-instructions argv for all four PTY adapters as **exact equality**, never by difference.
9. **`sessionManager.ts`**: `bindInstructionsDir`, the mint beside the hooks mint, `retireInstructions`
   at **both** `retireHooks` call sites, the `instructions` field on the `buildLaunch` call.
10. **`index.ts`**: `join(app.getPath('userData'), 'agent-instructions')`, bound unconditionally —
    **not inside the hook-listener branch**, because instructions must work when the listener does not.
11. **`ipc.ts`**: in `withMcpEnv`, when `mcpLaunchInput` returns non-null, compose the text and put it
    on the returned `LaunchOptions`. **The existing early return for an unconfigured project already
    gives the gate D148 requires** — no second condition is needed, and adding one would be a second
    home for the same rule.

## Test Expectations

New (`instructionsCore.test.ts`):

- the Markdown render contains every sentence and ends with a newline;
- the one-line render **contains neither a raw newline nor a carriage return** — asserted directly,
  because a raw newline in a TOML basic string is a config-load failure and `tomlBasicString` does not escape one;
- `assertSingleLine` throws on a multi-line input (the guard is load-bearing, not decorative);
- the text names `chorus-memory` exactly as `CHORUS_MEMORY_SERVER` spells it — imported from
  `memoryService.ts`, never re-typed.

Extended (`adapters.test.ts`):

- **the generic honesty case now covers three descriptors for five adapters** with one row added;
- claude with no instructions → argv **exactly** `[...cli.args, ...effort, ...hooks, ...resume]`
  (unchanged);
- claude with instructions → exactly two extra tokens, the second of which is the reserved path;
- **codex with no instructions → argv byte-identical to HEAD**, including the position of the
  `developer_instructions` pair (this is the regression that would be hardest to notice);
- codex with instructions → **exactly one** `developer_instructions` token, whose value contains both
  the jade rule and the memory contract, and which is a single physical line;
- kimi / opencode / noHarness → `instructions` is `null` and `instructionsArgs` is absent.

## Verification Commands

```
npm run typecheck
npx vitest run
npm run grep:secrets

# the counters this task must NOT move
node -e "const s=require('fs').readFileSync('src/shared/ipc.ts','utf8');console.log('IpcChannel keys:',(s.match(/^\s+[A-Za-z]+: '/gm)||[]).length)"
```

**Runtime drive — the task is not done until this has been observed, not compiled:**

1. Configure memory on a project that has it (or point it at a `docker run -d --name chorus-probe -p
   7688:7687 -e NEO4J_AUTH=none neo4j:5-community`), launch a **claude** pane, and confirm from the
   live process command line (`Get-CimInstance Win32_Process | ? CommandLine -like '*claude*'`) that
   `--append-system-prompt-file` is present and the file exists with the expected content.
2. In that pane, ask a question the contract answers — *"what memory do you have available for this
   project?"* — **without naming `chorus-memory`**, and record the answer. This is the phase's
   milestone rehearsal.
3. Close the pane and confirm **the instructions file is gone** from `userData\agent-instructions`.
4. Launch a **codex** pane in the same project and confirm from the live command line that there is
   **exactly one** `-c developer_instructions=` token and that the jade block still renders in its
   reply.
5. Launch a pane in a project with **no** memory configured and confirm argv carries **no**
   instructions token at all, for both agents.

Evidence under `_verify/6a-1/`.

## Acceptance Criteria

- [ ] `claude --append-system-prompt-file` re-probed against the installed CLI this session, and the
      version recorded.
- [ ] Five adapters answer `instructions`; two non-null, three null; the generic honesty case passes
      for all five with one added row.
- [ ] A claude launch in a memory-configured project carries the flag and a readable file; the file is
      deleted on every exit path.
- [ ] A codex launch in a memory-configured project carries **exactly one** `developer_instructions`
      token containing both parts, on one physical line.
- [ ] A launch in a project **without** memory is byte-identical to HEAD for all four PTY adapters.
- [ ] No user-owned file is created, read or modified anywhere in the diff — provable by inspection of
      the changed files, and by `~/.codex/config.toml` being byte-identical (hash before and after).
- [ ] `IpcChannel` **86**, `MIGRATIONS.length` **19**, runtime deps **8** — all unchanged.
- [ ] typecheck **0** · vitest **≥ 2012** · `grep:secrets` clean.
- [ ] A claude session that was **not** told about the server in its prompt names it when asked what
      memory it has.

## Review Checklist

A spec reviewer must confirm:

1. **No `fs` call anywhere in `instructionsCore.ts`**, and no import of `claude.ts` / `codex.ts` from
   it — the core must stay loadable under plain node with no Electron ABI.
2. **The `developer_instructions` token has exactly one home.** Grep for `developer_instructions` in
   `src/`: it must appear in `codex.ts` and its tests, and nowhere else, and only once as an emitter.
3. **The no-memory argv pins are exact equality**, not `toContain` and not a length comparison.
4. **`retireInstructions` is called at both `retireHooks` sites** — a file left behind is a session's
   contract readable on disk after the session is gone. Grep, do not assume.
5. **The instructions directory is bound outside the hook-listener branch.** If it is inside, a machine
   whose listener port is refused silently loses the contract too.
6. **The gate is `mcpLaunchInput !== null` and there is not a second one.** Two gates drift.
7. **The text never contains a secret and never could:** it is a static string plus a server name.
   `grep:secrets` covers `src/`, and the guard belongs to `mcpConfigCore`, not here — confirm nothing
   in this task routes user input into the snippet.
