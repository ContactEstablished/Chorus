# Codex lead troubleshooting handoff — September 30, 2026

Prepared for troubleshooting on October 1. Times below refer to the September 30 evening session in America/New_York; evidence timestamps after midnight UTC are October 1.

## Current assessment

GPT leads can launch, use the Team bridge, delegate to two independent DeepSeek helpers, review and integrate results, publish, and clean up. Both tested GPT models passed smaller packaged workflows. The unresolved problem is reliable completion of the larger development workload. In the latest frozen cohort, Sol passed all three solo trials and failed all three two-helper Team trials. That establishes a reproducible workflow problem at this workload; it does not establish that GPT cannot serve as lead.

The current evidence contains environment problems, verifier assumptions carried over from Claude, helper permission failures, helper response truncation, and code defects found during review. They must be investigated separately. No single root cause has been proven. The most useful first investigation is the difference between the actual environment and controls of an ordinary Codex launch and a Team Codex launch, followed by a matched Claude control using the current build and helpers.

**Work is paused for the night at the user's request.** The benchmark runner and its positively identified descendant processes were terminated, with zero captured owned processes remaining. Six trials had recorded results. The next Astra solo trial was interrupted and is cancelled, not a task failure or pass. Its disposable profile/workspace remains available; normal application shutdown and cleanup were not verified for that interrupted trial. No new installation, commit, push, global CLI configuration change, or antivirus configuration change was made during this continuation.

## Exact setup and qualification boundaries

| Component | Recorded setup |
|---|---|
| Codex CLI | `codex-cli 0.159.3` |
| GPT leads | `gpt-6-astra` and `gpt-6.1-sol`, subscription authentication, explicit medium effort |
| OpenCode | `1.18.33` |
| Helpers | Two independent OpenCode/OpenRouter `deepseek/deepseek-v4.1-flash` slots, isolated task/worktree identities |
| Claude CLI | `2.1.286 (Claude Code)`; historical Claude success is a baseline, not a fresh matched control for this cohort |
| System Node | `22.14.0` |
| Electron verification runtime | Official checksum-verified `43.1.1`, `_verify/electron-runtime-43.1.1` |
| GPT context | Standard; the Claude focused-context option is not applied to Codex |
| Team integration | `lead-integrates`; legacy `ask` inputs normalize to it. Human Team approvals remain removed. Native CLI trust and command permissions are separate. |
| Latest unpacked package | `_verify/team-codex-1593-qualified/win-unpacked/Chorus.exe` |
| Extended fixture | Twenty CommonJS modules, 194 frozen acceptance tests, fifteen-minute limit per trial |

CLI 0.159.3 is admitted for the exact GPT **lead** combinations above. It is not newly qualified for Codex helper use. Arbitrary later CLI versions and other authentication/model combinations are not covered by these results.

The normal `node_modules/electron/dist/electron.exe` path is still unresolved: the executable was missing and restoration/copying returned Access denied. A verified runtime works from `_verify` with a command-scoped `ELECTRON_OVERRIDE_DIST_PATH`. Normal-looking ACLs did not explain the denial. Antivirus interference is plausible, but no protection event has been correlated with these current failures, so it must not be stated as the cause.

The latest package executable SHA-256 is `09ec603d86d3d66d363476c9d31fb80c7eb28a78152d7e7cc5cb8ffbb75fef69`; `app.asar` is `bc96b08f94e46c887b98e93fbb04dbcdd11917cde1e9f440ff138e18d411a0d4`. The payload audit matches fifteen built JavaScript/CSS/HTML entries and the external Team bridge. Earlier successful task/UI packages predate the final terminal-dimension fix; their scope must remain distinct from the latest recovery package.

## What passed

| Verification | Evidence and limits |
|---|---|
| Full automated suite | 3,522 tests in 118 files, zero failures; `_verify/codex-1593-qualified-tests.json`. Node/web typechecks and build passed. Six benchmark-accounting tests passed separately after that full-suite run; a new full-suite total was not run. |
| Native storage/runtime/workspace/integration/members/dependability | 46/125/46/82/25/68 assertions; `%TEMP%/chorus-team-storage-96gid6`. Process ownership: 65 assertions, `chorus-team-process-pyueyJ`; facade compatibility: 57, `chorus-team-compat-i3ti86`. |
| Selected native restart recovery | Seven scenarios, 89 assertions; `%TEMP%/chorus-team-recovery-DNtdOM`. This is selected coverage, not certification of every lifecycle path. |
| GPT native long waits | Both models held exactly one model MCP call for 75 seconds over four bounded broker requests: `%TEMP%/chorus-codex-team-client-rAbtn3` and `chorus-codex-team-client-W8CeWm`. This demonstrates transport beyond the ordinary sixty-second timeout; it does not prove larger-task completion. |
| Packaged GPT tasks | Both leads, two overlapping DeepSeek helpers, zero retries, independent frozen acceptance, publication, all five worktrees removed, clean app exit: `%TEMP%/chorus-team-app-qdbmvN`. |
| Packaged launch UI and legacy policy | Both leads passed the task workflow again; lead/helper eligibility was checked and legacy `ask` normalized: `%TEMP%/chorus-team-app-tzpXNj`. |
| Latest packaged retained-work recovery | Both leads passed dirty Resume refusal, visible recovery, fixture-note checkpoint, no new helper attempts during recovery, generation rotation on Resume, confirmed Stop, keyboard input and clean exit: `%TEMP%/chorus-codex-lifecycle-RAyrqU/report.json`. These recovery trials did not execute delegated helper tasks. |
| Other packaged lifecycle checks | Running-helper shutdown, shutdown during integration, and activation-timeout/visible Retry passed in `%TEMP%/chorus-codex-lifecycle-cPrOPb`. That parent report also contains earlier recovery failures; it must not be described as wholly passing. |

## Larger-workload evidence

The latest cohort is `%TEMP%/chorus-team-benchmark-BDjf4H`. Its source SHA-256 is `90d37ed63996286bf193682b5be457e4f89a27df4cdc5b0375789986da288cbd`. The driver froze source and CLI versions before/after trials and rotated condition order. `runs.json` preserves the six recorded results; `cancelled.json` records the user-requested stop and captured process identities.

| Lead / condition / repetition | Result | Seconds | Counted retries | Evidence under `%TEMP%` |
|---|---|---:|---:|---|
| Sol / two helpers / 1 | Failed; lead ended before Team completion | 278.115 | 0 | `chorus-team-pilot-ndRXPO` |
| Sol / solo / 1 | Passed | 584.082 | N/A | `chorus-team-pilot-x0r77R` |
| Sol / solo / 2 | Passed | 632.171 | N/A | `chorus-team-pilot-48RFru` |
| Sol / two helpers / 2 | Failed; attempts exhausted, no completed Team | 840.740 | 4 | `chorus-team-pilot-zL3gxK` |
| Sol / two helpers / 3 | Failed; lead ended before Team completion | 773.119 | 4 | `chorus-team-pilot-T0if1Y` |
| Sol / solo / 3 | Passed | 638.999 | N/A | `chorus-team-pilot-LWVrRd` |
| Astra / solo / 1 | Cancelled at user request; excluded | — | — | `chorus-team-pilot-DfLJqo` |

Five of the twelve scheduled trials never started. No completed Team-versus-solo savings comparison exists. `comparisonValid: true` on a failed trial denotes verified accounting/model attribution; it does not override `passed: false` or establish a successful comparison. Subscription billing remains unknown. Any API-equivalent amounts are benchmark estimates, not bills or application metering.

Two earlier groups must remain separate:

- `%TEMP%/chorus-team-benchmark-a2JnAK`: Astra solo passed in 458.537 seconds. Its Team trial stopped before delegation because the Node reader was unavailable and the prompt prohibited fallback shell reads. The batch was cancelled before repeating that blocker. It used a different source hash and cannot be pooled with the latest cohort.
- `%TEMP%/chorus-team-pilot-JeCjwo`: separate calibration failed at 900.27 seconds after helper permission denials and content/review failures. It is excluded from comparison. Later prompt and completion-detection corrections followed this run.

## Confirmed observations and unresolved hypotheses

### 1. Codex file-reader/runtime discovery failed in a Team launch

The first extended Astra Team transcript called `mcp__node_repl__js` and received: `Node runtime not found; install Node or set NODE_REPL_NODE_PATH`. System Node was installed, while the parent `NODE_REPL_NODE_PATH` was absent. The fixture simultaneously prohibited shell reads, leaving the lead unable to inspect the committed specification. Claude has a native file-reader route, so that instruction was not portable. The fixture now explicitly permits read-only native shell inspection for the lead; helper restrictions remain unchanged.

There is a concrete environment difference to investigate. `src/main/adapters/env.ts` inherits the parent environment for launches with no injected secrets, but constructs an allowlist for launches with secrets. `teamRuntime.ts` injects `CHORUS_TEAM_ENDPOINT` and `CHORUS_TEAM_TOKEN` even for subscription leads. `sessionManager.ts` merges those into `secretEnv` before `composeChildEnv`; the Codex adapter declares `requiredEnvVars: []`. Team launches can therefore lose runtime/discovery variables that an ordinary subscription or solo launch inherits.

**Hypothesis, not proven cause:** this asymmetry can affect Codex runtime discovery, configuration or tool availability. The absent parent override means we cannot claim that `NODE_REPL_NODE_PATH` itself was stripped in the observed run. Also check runtime compatibility and which process/tool performs discovery before choosing a fix.

### 2. Helpers requested writes outside their assigned worktree

In Sol Team repetition 1, one helper attempted `wt-at84774f/import.cjs` while its actual directory was `wt-ad84774f`: a path typo. The other attempted a scratch test under `%TEMP%/opencode/jobcheck.test.cjs`, outside its assigned worktree. Native external-directory permissions denied those calls. The lead subsequently cancelled both tasks instead of obtaining completed reviewed artifacts.

These denials are expected enforcement, not evidence that a GPT-specific filesystem sandbox broke. Investigate the briefs, path construction and revision decisions. Do not allow arbitrary external writes to make this fixture pass. Also, an aggregate `permissionFailures: 0` does not rule out native denied calls in a cancelled attempt; consult the native records and durable attempt status together.

### 3. A DeepSeek helper exhausted its response budget

In Sol Team repetition 2, a helper response ended with `finish_reason: length`. Its recorded usage included output `1`, reasoning `31999`, and total `58698` tokens. Almost the entire approximately 32k generation allowance was spent on reasoning, with no useful final response for that step. This happened in the **OpenCode/DeepSeek helper**, not the GPT lead.

The current OpenCode parser in `src/main/adapters/helpers/parser.ts` reports non-`stop`/non-`tool-calls` finishes generically as `opencode ended with an unsuccessful finish reason.` That hides a useful distinction between truncation and other failures. Determine which client/provider option established the allowance and what reasoning controls this exact provider/model supports before proposing a cap. No output-budget or reasoning configuration fix has been made.

### 4. Other helper permissions and code review failures accumulated

Retained attempts include unsupported `node --version`, `node -e`, shell log filtering/reading, and external-directory/glob requests. Helpers are currently allowed only exact standalone verification commands; discovery must use native read/glob/grep. A denied tool poisons an attempt even if the helper subsequently corrects course. That behavior is shared across lead providers.

Some attempts produced artifacts successfully, then required revisions for actual code defects, including heap-key validation and checkpoint hashing. Later attempts failed or exhausted the task's three-attempt budget. Distinguish implementation defects, supported-command misunderstandings, and lead review expectations. Check whether review requests follow the frozen acceptance contract or add avoidable requirements beyond it. The third Sol Team run also had succeeded artifacts alongside failed/permission-blocked attempts, but did not reach integration and completion; successful artifacts alone are insufficient.

### 5. Some apparent failures were verifier problems

Earlier recovery drivers expected retired UI text, Claude-style trust handling, or unsupported compound Git commands. Corrections use current recovery state, exact standalone fixture-note Git commands, and a narrowly scoped native approval recognizer. These are verifier changes, not expanded production permissions. The application now preserves fitted terminal dimensions when replacing a stopped pane, with a regression test.

The older benchmark waited toward fifteen minutes after Codex had already ended a blocked turn. It now records that condition promptly when the Team is unfinished and no helper is active. Native turn completion is not treated as Team success. Several file-not-found/search errors during development were also investigator command mistakes, not product failures. Neither category should be counted as proof of GPT protocol failure.

## GPT-specific technical controls to audit

| Control | Current behavior | Morning check |
|---|---|---|
| CLI/model/role gate | Exact verified versions/models; medium lead effort; helper gate independent | Confirm native version, actual model/effort and selected role match the capability result. |
| Environment composition | Team secrets select the allowlist branch; Codex has no additional required names | Compare a safe whitelist of non-secret environment names/values between ordinary, solo and Team launch; confirm runtime discovery in the actual child. |
| MCP wait timeout | `mcp_servers.chorus-team.tool_timeout_sec=930`, server required | Preserve the scoped override. Native 75-second waits passed; capture any actual disconnect/timeout before changing transport. Official [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference). |
| Process isolation and updates | Team-scoped `--no-daemon`, `check_for_update_on_startup=false` | Confirm effective arguments for CLI 0.159.3 and process ownership. Do not change global settings. |
| Native agents | Launch supplies `features.multi_agent=false` | Verify the installed CLI recognizes and applies it; inspect the warning text. Do not infer it is ignored solely from newer documentation. No unintended native agent spawning has been established. |
| Windows sandbox and permissions | Team launch supplies `windows.sandbox="elevated"` and manual permission mapping; solo/full-access conditions differ | Inspect effective native settings and prompts. Match the intended authority before interpreting a solo-versus-Team result as a pure model comparison. |
| Team tool approvals | Per-tool Chorus MCP approval settings plus the normal native trust flow | Separate Team authority from native command approvals; preserve removed human Team approval behavior. |
| Instruction/context delivery | Codex uses one composed `developer_instructions` setting and standard context; Claude has a distinct tool/context route | Capture the redacted effective instruction contract, tool inventory, configured integrations/hooks and exact read route. Avoid copying Claude-only tool assumptions. |
| Terminal/replacement | Fitted dimensions now survive replacement | Reuse the latest package for recovery tests; earlier packages have different payloads. |
| Completion recognition | Team requires durable completed/cleaned finish plus independent acceptance; solo requires native completion plus independent acceptance | Keep failure detection and success criteria separate; never promote process exit or an ended turn to a pass. |

## Recommended morning sequence

1. **Start with a controlled launch diagnostic, before another long benchmark.** Compare ordinary Codex, Codex solo fixture and Codex Team fixture using the same executable, account, project and runtime. Record effective command arguments, working directory, permission mode, available tools, warning text, and non-secret runtime variables. Exercise specification reads through the intended native route and the documented fallback. If only Team loses a required non-secret discovery setting, add the narrow adapter declaration or launch addition and a focused environment-composition test. If runtime compatibility is the issue, use the supported runtime explicitly rather than changing permissions.
2. **Run a minimal matched Claude/GPT Team control.** One small owned file per helper, the same DeepSeek model/provider, identical frozen acceptance, worktree isolation, checks and completion policy. Record context/tool differences explicitly. Establish delegation, wait, review, integration and finish for both leads. If both fail similarly, investigate shared helper/environment controls; if only GPT fails, compare its launch and instruction path at the first divergence. Historical Claude success alone cannot answer this.
3. **Make helper failures diagnosable.** Preserve the native finish reason and relevant usage summary in error evidence. Inspect the actual provider request options for response and reasoning budgets; use documented controls only after confirming support. Review whether existing task granularity leaves room for implementation output. Fix scratch paths/relative paths in the helper contract and decide whether any harmless diagnostic command should be explicitly admitted. Keep external-write denials and failed-attempt accounting intact. OpenCode [permissions documentation](https://opencode.ai/docs/permissions/) explains separate external-directory controls; [model documentation](https://opencode.ai/docs/models/) describes model options and variants.
4. **Inspect the lead's response to a recoverable helper error.** Compare actual serialized briefs and review/revision requests for Claude and GPT. Determine why a path mistake led to cancelling both tasks and why later revisions consumed every attempt. Prefer a precise correction tied to the native error and frozen contract. Avoid repeatedly redispatching an unchanged blocker or adding unrelated review requirements.
5. **Investigate the Electron path issue independently.** Correlate Access denied with filesystem/protection logs and executable identity. Check whether failures occur only at the dependency path or also in disposable packaged profiles. Continue using the verified command-scoped runtime while isolating the cause; do not assume it explains native helper errors or disable protection broadly.
6. **Expand only after the small control is stable.** Validate one targeted fix, then one frozen extended solo/Team pair with the matched Claude control. Stop on a repeated unchanged cause. Schedule repeated performance trials only after Team completion is reliable. Preserve every cohort's original hash, failures and cancelled trials; do not combine pre-fix baselines with post-fix trials.

## Working-tree handoff

Current continuation changes are uncommitted. They cover exact 0.159.3 lead admission (`src/shared/team.ts`, helper evidence gates and lead tests); independent lead/helper capability/UI eligibility (`teamRuntime.ts`, `TeamLaunchDialog.vue`); terminal replacement geometry (`sessionManager.ts` and tests); native/packaged verifier corrections; frozen benchmark and exact native conversation accounting; and updated Team reports.

New `scripts/team-recovery-approval.mjs` and `src/main/services/teamRecoveryApproval.test.ts` implement/test the verification-only exact recovery-note approval matcher. It is not imported by the application. Benchmark reader/brief changes live in `scripts/verify-team-pilot.ts`; native turn-state accounting is in `scripts/team-codex-audit.ts` with tests in `src/main/services/teamCodexAudit.test.ts`.

Pre-existing user changes include `.mcp.json`, `docs/Features/Engine/chorus-engine-spec.md`, `electron-builder.yml`, and `package.json`. Preserve them. `.mcp.json` may contain credentials and was not read or included in this handoff. Do not restore the abandoned application metering/repository-facade experiment or reintroduce human Team approval flows.

Private/local evidence is retained under `%TEMP%` and `_verify`. The safe aggregate is `docs/Features/Team Sessions/Evidence/Dependability/codex-1593-followup.json`; these evidence locations are ignored and are not guaranteed to travel with a checkout. Copy only selected redacted evidence if another developer needs it. Raw native transcripts, local OpenCode databases, credentials and full environment dumps must not be pasted into tracked documentation.

For verification commands requiring Electron, set the override in that PowerShell process:

```powershell
$env:ELECTRON_OVERRIDE_DIST_PATH = (Resolve-Path '_verify/electron-runtime-43.1.1').Path
```

The interrupted full benchmark command was:

```powershell
node scripts/benchmark-team-dependability.mjs --leads codex-sol,codex --conditions team-2,lead-only --workload extended --repetitions 3 --context standard
```

Do not restart the twelve-trial batch as the first morning action. Read `runs.json`, `cancelled.json`, and the specific failed-trial evidence first, then perform the bounded diagnostics above. Hard termination retained the interrupted fixture rather than proving normal cleanup; its workspace must not be mistaken for a completed archive.

The main process lesson is to separate a portable launch/tool contract from workload performance before spending another hour on repeated trials. The existing smaller successes give us a useful starting point, and the environment-composition asymmetry plus specific helper failures give us concrete controls to test and fix.

Related current records: [Compatibility](Compatibility-Report.md), [Evaluation](Evaluation-Report.md), [Implementation progress](Implementation-Progress.md), [Usage](Usage.md).
