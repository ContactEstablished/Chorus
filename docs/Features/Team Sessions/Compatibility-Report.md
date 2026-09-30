# Phase 11 compatibility evidence

## Current Codex Teams qualification — September 30, 2026

Codex needs scoped launch accommodations to use the existing Teams protocol efficiently. Exact CLI **0.159.0** admits subscription leads **gpt-6-astra** and **gpt-6.1-sol**, with explicit medium effort in new lead selections. Chorus supplies `mcp_servers.chorus-team.tool_timeout_sec=930`, disables the launch-time update check, and requests `--no-daemon` for Team-owned process lifecycle isolation. It does not edit global CLI settings or extend another MCP server's timeout. Codex retains standard context; the Claude focused-context switch is not applied to it. Native agents remain disabled. Sol helper/API routes and arbitrary newer CLI versions remain unqualified; existing helper gates are unchanged.

The [official configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference) documents the default 60-second MCP tool timeout and per-server override. The real native diagnostics exceed that default: Astra and Sol each held one wait for 75 seconds through four authenticated broker segments. Final runs used `--no-daemon` and counted exactly one native MCP tool call each (`%TEMP%/chorus-codex-team-client-8ObHb5` Astra, `chorus-codex-team-client-7kAoQ7` Sol). This proves long-call transport behavior with synthetic readiness; it does not measure long-task savings.

| Native production-service fixture | Result |
|---|---|
| Astra + two DeepSeek helpers, `%TEMP%/chorus-team-pilot-JGpnRo` | Passed independent frozen acceptance, overlapping helpers, exact publication and removal of all worktrees; medium/model identity verified. One retry and a recorded prompt-submission correction. |
| Sol + two DeepSeek helpers, `%TEMP%/chorus-team-pilot-kSLcSV` | Passed independent frozen acceptance, overlapping helpers, exact publication and removal of all six worktrees; medium/model identity verified. One retry, no native permission denials. |
| Sol solo, `%TEMP%/chorus-team-pilot-ltTJH6` | Passed independent frozen acceptance with final-answer/task-complete detection; medium/model identity verified. |

The native task pilots precede the final `--no-daemon` launch addition; its live qualification currently covers both transport diagnostics. New packaged Astra/Sol drives stopped without completion reports while test executables disappeared (`chorus-team-app-eGJUZH`, `chorus-team-app-pBc4nb`). A later driver attempt refused to start because its executable was missing. The current cause is unconfirmed; no security setting was changed. These are retained failures, not packaged passes. The final full suite likewise cannot load two Electron-dependent suites; 115 files/3,161 tests pass, with node/web typechecks and build passing. Packaged qualification, protection-enabled compatibility and extended comparative savings remain pending.

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

## September 30 dependability update

The earlier version matrix above remains historical. The working-tree update explicitly admits candidate versions Claude Code **2.1.285**, Codex CLI **0.159.0**, and OpenCode **1.18.33**, without accepting arbitrary future versions. Opus **claude-opus-5-5** is a subscription lead, with explicit medium effort in the new preset; **deepseek/deepseek-v4.1-flash** is an OpenRouter helper using an existing saved credential. Multiple slots have independent task/worktree identities and can share that credential. Custom saved OpenRouter profiles remain selectable with an unverified-model diagnostic.

Production-service live pilots passed with Opus and one or two DeepSeek helpers. The focused two-helper pilot recorded overlapping helper execution, zero retries or native permission failures, independent frozen acceptance, exact publication, and removal of all five worktrees. This proves that measured workflow; it does not requalify every historical model/version combination or establish savings.

- Complete suite: **118 files / 3,495 tests passed**, plus node/web typechecks and production build.
- Native storage/runtime/workspace/integration/member assertions: **46 / 103 / 46 / 82 / 25**. The added dependability fixture passed **52 assertions**, including ownership rejection before capture reservation, exact check evidence, dependency refresh after metadata changes/failed installation, stale-check failure records, stopped background writers, dirty destination protection, publication, retention/retry, and cleanup that preserves tracked and external junction targets.
- Native owned-process fixture: **55 assertions**; Team facade: **57 assertions**.
- Real restart matrix: **30 scenarios / 383 assertions**, including interrupted owned checks and dependency bootstraps, queued checks, mixed known/unknown process ownership, pre/post-publication states, ambiguous destinations, cleaned archives, and repeated recovery without duplicate events or command replay. The [final aggregate](Evidence/Dependability/recovery-final.json) combines 29 passing cases from the full invocation and a separate corrected mixed-case assertion retry at unchanged production source. Earlier failed harness assertions remain in temporary evidence.
- An unpacked Windows executable was built at `_verify/team-package/win-unpacked/Chorus.exe`. Actual packaged-main/renderer checks passed in a disposable profile: new launch defaults, named credential-backed members, stale writes, preset reload, exhausted history, and credentialed ordinary-session restore refusal. Its external Team bridge SHA256 matches the source. These checks did not install the build, execute a complete packaged Opus/DeepSeek task, or exercise Neo4j indexing.
- Source/artifact secret scan passed. Existing unrelated working-tree changes were preserved; nothing was committed, pushed or installed.

The fixed native check runner also passed `npm ci`, `npm test`, `npm run typecheck` and `npm run build` against an isolated committed Chorus snapshot, with exit zero and confirmed cessation for each command. Installation retired its positively identified MSVC `mspdbsrv.exe` descendant before accepting success. The earlier failing dependency-refresh and Windows junction-cleanup fixtures remain in temporary evidence; their passing regressions do not replace the failures. Selected final reports include [native assertions](Evidence/Dependability/native-final.json), [dependency/process/cleanup regression](Evidence/Dependability/dependency-refresh-final.json), [project command smoke](Evidence/Dependability/project-checks-final.json), and [rebuilt packaged UI/main checks](Evidence/Dependability/packaged-ui-final.json).

Selected reports and the packaged launch screenshot are retained in [Evidence/Dependability](Evidence/Dependability/). Early pilot failures are retained separately; later passing pilots do not erase them. See [evaluation](Evaluation-Report.md) for accounting and comparison limitations.


## Efficiency follow-up: exact Claude 2.1.286 lead

The installed CLI was already 2.1.286 on 2026-09-30. Exact lead admission now includes 2.1.285 and 2.1.286 for focused context and medium effort; arbitrary future versions and new Claude helper versions remain disabled. The generated Chorus MCP server alone has `timeout: 930000`; the lead process alone receives `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS=0`. Existing user/global configuration is preserved.

Real Opus 5.5 medium CLI compatibility passed (`%TEMP%/chorus-team-compat-eGofQR`): authenticated stdio MCP, two overlapping helpers, code revision and cancellation. This is a noninteractive diagnostic, not a full packaged task. Fresh unpacked application UI/history/credential-refusal checks passed (`%TEMP%/chorus-team-app-GhSbIh`), with clean exit. The earlier packaged refusal caused by the stale exact-version gate remains retained (`%TEMP%/chorus-team-app-zdyjOw`). Unit tests cover new lead admission, unchanged helper gates, future-version refusal and scoped wait configuration. No installation or global CLI update was performed.

Decision waits keep each broker request within 20 seconds and the existing transport body/time limits. Facade tests simulate a ten-minute wait in one model call, bounded deadline, cancellation and authority/transport failures. These simulated tests establish protocol behavior; actual long helper execution and model request counts require the live comparison. Older lead clients retain 20-second guidance until their long-call behavior is tested.


Final follow-up source validation: 3,518 tests/120 files; node/web typechecks and build; native matrix 46/125/46/82/25/68; process verifier 65 assertions including deterministic null-StartTime exit races and unidentified-live-process refusal; secret grep clean. Final freshly rebuilt unpacked UI checks passed at `%TEMP%/chorus-team-app-ZAIEYA`, app exit 0. The short live helper regression succeeded without retries/denials, and its suite-check wait returned ready once without UNKNOWN_CHECK. Its original cleanup race failure is preserved; guarded retry after the process fix removed all five worktrees. These are separate from the frozen long performance pair; full packaged Opus/DeepSeek feature execution and reconciled subscription billing remain unmeasured.
