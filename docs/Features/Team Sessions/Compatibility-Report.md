# Phase 11 compatibility evidence

Started 2026-09-20. **Task 11-1 compatibility gate passed for the exact combinations below.** The preliminary sections retain their original gate status; subsequent runtime/UI implementation and evidence are recorded in [Implementation-Progress.md](Implementation-Progress.md).

## Environment

Windows, Node 22.14.0, Claude Code 2.1.277, Codex CLI 0.155.1, opencode 1.18.31. Installed `--version` and relevant `--help` were captured during this execution session. The feature remains subject to both lead paths and all three helper harnesses passing the complete matrix in Task 11-1.

## Preliminary native probes

Disposable Git fixture: `C:\Users\matth\AppData\Local\Temp\chorus-team-native-sa9O2H`. Prompt was supplied over stdin and asked each CLI to read `marker.txt`. Environment contained only the existing seven-variable Windows baseline. No provider API credential or team token was inherited. CLI-managed authentication was used; authentication files were not copied.

| Probe | Actual result | Implication |
|---|---|---|
| Claude subscription; print/stream-json, verbose, dontAsk, permission-prompts none, tools Read/Glob/Grep, Agent/Task denied, strict MCP, empty setting sources | Read the marker; structured success result; process exited 0 in 4.9 seconds. Reported model `claude-opus-5`; zero native subagents in result metadata. | This launch form supports the basic read-only probe. Full analysis edit-denial, code execution, bridge, cancellation and process-tree proof remain outstanding. |
| Codex subscription; exec/json/ephemeral, ignore-user-config/ignore-rules, read-only sandbox, approval never, multi_agent disabled | Read command was blocked by policy; model reported the blocker; `turn.completed` and process exit 0 still occurred. | A completed turn/exit alone does not prove acceptance. Preserve the blocker and require lead review. |
| Same Codex probe with explicit `windows.sandbox="elevated"` | `command_execution` read the marker with exit 0; model reported its contents; `turn.completed`. | Ignoring user configuration also removes the configured Windows sandbox implementation. A launch must explicitly preserve/select the verified implementation. No sandbox installation or global config edit was performed. |

The preliminary diagnostic logs were written by the test driver inside this first fixture. They are not evidence of a clean analysis worktree. The final verifier must put all logs/configuration outside the tested worktrees and measure their Git state independently.

Claude's subscription response reports a list-price cost estimate (`costBasis: list`). This is not measured subscription expenditure and must not be presented as actual billed cost.

## Native code/test probes

Separate disposable repositories under `C:\Users\matth\AppData\Local\Temp\chorus-team-code-9Nwbfb`, with driver logs outside each repository. Each began with a committed subtraction bug in `sum.cjs` and an independent `node:test` assertion that addition returns 5. Both probes ran concurrently under the seven-variable environment baseline; no inherited API keys, bypass flags, dependency installation, or global configuration changes.

- Claude: `acceptEdits`, `permission-prompts none`, explicit Read/Glob/Grep/Edit/Write/Bash tools, `Bash(node --test)` allow rule, Agent/Task denied, strict MCP, empty setting sources. Exited 0 in 12.2 seconds; only `sum.cjs` changed; independent post-exit `node --test` passed.
- Codex: `exec --json --ephemeral --ignore-user-config --ignore-rules --sandbox workspace-write`, approval never, Windows elevated sandbox explicitly selected, native multi_agent disabled. Exited 0 in 27.0 seconds; only `sum.cjs` changed; independent post-exit `node --test` passed.

These are standalone CLI probes, not proof of lead delegation, adapter integration, API authentication, or descendant termination. Those gate rows remain open.

## External-provider code/test probe

opencode 1.18.31, model `openrouter/z-ai/glm-5.3`, selected OpenRouter vault credential passed only as `OPENROUTER_API_KEY`. A disposable Electron diagnostic used the existing vault resolver; no plaintext credential was exported to a file or command line. Launch: `run --pure --format json --model openrouter/z-ai/glm-5.3`, prompt on stdin. Per-process configuration disabled sharing, denied tools by default, allowed reading/editing and the exact `node --test` command, and denied native delegation and questions.

The initial probe edited the fixture but its PowerShell command could not locate `node`. The seven-variable baseline omits `PATHEXT`. A direct control proved `Get-Command node` failed without it and succeeded with `.COM;.EXE;.BAT;.CMD`. This is measured justification for a pinned helper environment addition, not broader inherited environment access. Initial evidence: `C:\Users\matth\AppData\Local\Temp\chorus-team-opencode-CxkGn9`.

With pinned `PATHEXT`, the rerun exited 0 in 14.7 seconds, changed the fixture, and emitted a structured Bash tool result containing the real passing TAP output. Independent post-exit tests also passed. Evidence: `C:\Users\matth\AppData\Local\Temp\chorus-team-opencode-ihCJJj`. Intermediate `step_finish` events had `reason: tool-calls`; only the final one had `reason: stop`. A parser must distinguish these and still require process-tree exit. This proves a basic external API-backed edit/test path, not the complete team gate.

## References consulted

- [Claude programmatic execution](https://code.claude.com/docs/en/headless)
- [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)
- [Codex Windows sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox)
- [opencode CLI](https://opencode.ai/docs/cli/)
- [opencode permissions](https://opencode.ai/docs/permissions/)
- [opencode 1.18.31 run implementation](https://github.com/anomalyco/opencode/blob/v1.18.31/packages/opencode/src/cli/cmd/run.ts)
- [MCP 2025-06-18 lifecycle](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle)

## Task 11-1 implementation evidence

The implemented registry builds native pipe requests, allowlists subscription and API environments, uses stdin prompts, and normalizes bounded structured records. `teamLead.ts` creates external Claude MCP files containing variable placeholders or Codex launch overrides containing variable names. No generated configuration is placed in the worktrees. `teamBridge.cjs` authenticates every broker request, including cached schema reads, and implements tools-only MCP 2025-06-18.

| Evidence | Result |
|---|---|
| `chorus-team-compat-yJZLeo` under the Windows temporary directory | **Both actual interactive ConPTY leads** (Claude 2.1.278 and Codex 0.155.1) used the production facade/configuration factory. Each delegated Claude subscription code work and opencode/OpenRouter GLM 5.3 analysis concurrently, collected and reviewed results, requested one counted revision, and cancelled Codex work. Peak helper concurrency was 2. Both revisions passed independent `node --test`; both analyses identified subtraction, actual -1, expected 5. |
| `chorus-team-compat-TiIUVa` | All three production helper adapters edited/tested the fixture. Each then ran a native test command spawning a descendant writer. Cancellation terminated 9 observed Claude-tree processes, 11 Codex-tree processes, and 7 opencode-tree processes, checked by creation identity; writer content stayed unchanged for 1.5 seconds. This is measured fixture evidence, not a promise about an unobserved arbitrary process. Runtime ownership must retain unknown liveness as a blocker. |
| `chorus-team-compat-EvLDQn`, `chorus-team-compat-KWHHGo` | Analysis mode left every isolated worktree unchanged. Claude's explicit Edit attempt produced a native disabled-tool error in the first fixture. Codex reported native patch rejection under read-only sandbox (its JSON stream omitted the rejected patch event). opencode exposed only read-only tools. No edit tool or unrestricted shell was added to make the test pass. |
| `chorus-team-compat-LYATOi` | Production facade fixture: **57 assertions passed**, including split Unicode, invalid UTF-8/JSON, initialization, duplicate IDs, revoked token, immutable schemas, unavailable broker, redirects, oversized response/frame, 32-pending limit, paused-output backpressure, and cancellation/EOF without task cancellation. |

Artifacts and terminal/protocol logs live in those disposable evidence directories; they contain scrubbed output, version snapshots, and operation journals. Credentials came from the already selected OpenRouter vault profile through a disposable Electron resolver, in environment only. Helper environments excluded the lead token and unrelated inherited keys. All fixture repositories/worktrees and generated configuration were outside the real source checkout.

### Supported launch combinations

- Claude Code **2.1.278**, CLI-managed current-account subscription, `claude-sonnet-5` (`sonnet` alias measured): code and analysis. `DISABLE_AUTOUPDATER=1` pins each helper launch against background update during execution.
- Codex CLI **0.155.1**, CLI-managed current-account ChatGPT subscription, **gpt-6-astra**, explicit installed Windows `elevated` sandbox implementation: code and analysis.
- opencode **1.18.31**, **OpenRouter z-ai/glm-5.3**, selected API credential: code and analysis.
- Interactive Claude and Codex leads: same measured binary versions. Claude required ToolSearch in the interactive fixture's deliberately limited built-in tools. Codex used per-launch approval configuration scoped to the eight fixture tools. Production launch must preserve legitimate user trust/approval behavior and show bridge readiness before dispatch.

`helpers/evidence.ts` matches exact installed versions and model/auth/route combinations. Unknown versions and combinations remain disabled pending a new probe. Native Claude/Codex API-key variants, other external providers/models, and opencode subscription routing are **unverified and disabled**. CLI-managed subscription mode selects the CLI's current account; multiple independent subscription identities are not supported.

### Failed and superseded probes

- The early `EpB2wq` run incorrectly reported overall success despite a failed Codex analysis: `gpt-5.6` was unsupported by the ChatGPT account. Its success flag is **invalid evidence**. The verifier now checks every non-cancelled task and actual analysis content. The corrected mixed-provider run above is authoritative.
- Early native analysis briefs prohibited all commands, which prevented Codex from reading files. Their summaries were blockers, not successful analysis. The fixture now explicitly permits read-only shell commands.
- The first interactive Claude fixture answered its screen-reader trust prompt with Enter rather than `y`; it was stopped. Another run with no built-in ToolSearch stalled without real calls. Neither counts as interactive proof.
- Claude's own updater moved the installed binary from 2.1.277 to 2.1.278 during probing. Final evidence and the capability gate use **2.1.278**; the original version is not inherited support.
- `NnReVt` used the unsupported Codex model and checked unchanged files without requiring a valid completion. That permission result is **superseded** by `EvLDQn`/`KWHHGo`; the verifier now rejects transport/model failure as permission proof.

### Handoff and limits

Runtime owners must call `verifiedHelperCombination` after resolving the current installed version, selected model and route; general capability badges alone do not authorize dispatch. A parser result is not process exit, and neither is task acceptance. Explicit native denial records normalize to permission-blocked; assistant prose alone does not. Native subagent suppression does not prevent arbitrary programs through a permitted shell. No measured cost or speed savings are claimed.

Node **22.14.0** was the tested bridge interpreter. Task 11-4 must resolve an installed native Node executable (never packaged `process.execPath`, which is Chorus.exe), verify the prerequisite, and pass an absolute `resources/teamBridge.cjs` dev path or `process.resourcesPath/teamBridge.cjs` packaged path. It owns `extraResources` packaging and a packaged smoke test. Task 11-2 owns the production authenticated broker, process ownership and durable scheduler; the live harness broker is deliberately disposable and is not imported into the application.

Final Task 11-1 checks: full node/web typecheck passed; 16 targeted tests and 57 facade assertions passed; repository secret grep clean. `git diff --check` reports existing whitespace on the pre-existing TerminalPane font edit; that unrelated edit was preserved. The phase remains incomplete until Tasks 11-2 through 11-5 and the evaluation matrix pass.
