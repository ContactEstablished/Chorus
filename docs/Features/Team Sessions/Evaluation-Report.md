# Phase 11 evaluation — 18 executions recorded

Current Codex continuation: packaged Astra and Sol leads both complete tasks with two concurrent DeepSeek helpers, zero retries, publication and complete cleanup. Both also pass retained-work recovery on the latest package. These are compatibility checks, not comparative performance trials. The first extended Astra solo trial passed in 458.537 seconds with exact model/medium effort and verified-thread usage. Its Team trial stopped before delegation: the Node reader was unavailable, and the fixture prohibited fallback shell reads. The batch was stopped before repeating that blocker; its baseline and incomplete trial remain in `%TEMP%/chorus-team-benchmark-a2JnAK/cancelled.json`. The fixture now permits read-only native shell inspection. The separate calibration failed after exhausting data-helper attempts, with permission denials and job-code review defects; it reached the 900-second deadline (`chorus-team-pilot-JeCjwo`). It is excluded from comparisons. Fixture guidance now separates lead/helper readers, defers full tests until integration, and forbids private cross-task utility imports. The verifier recognizes a blocked completed native turn promptly, with six accounting tests passing. The fresh twelve-trial batch at `%TEMP%/chorus-team-benchmark-BDjf4H` was stopped at the user's request for an overnight handoff; source SHA-256 `90d37ed63996286bf193682b5be457e4f89a27df4cdc5b0375789986da288cbd`. Six results were recorded: Sol solo passed in 584.082, 632.171 and 638.999 seconds; Sol Team failed in 278.115, 840.740 and 773.119 seconds, with 0/4/4 counted retries. The next Astra solo trial was cancelled and five trials never started. `runs.json` and `cancelled.json` preserve the partial cohort; interrupted shutdown/cleanup is unverified. No savings result is established. See the [troubleshooting handoff](Codex-Lead-Troubleshooting-Handoff-2026-09-30.md). See [current compatibility](Compatibility-Report.md).

Evidence: [manifest](Evidence/Window-4/evaluation-manifest.json) and [per-run metrics](Evidence/Window-4/evaluation-metrics.json). Execution mode: formal-18. 18/18 executions recorded. Failed and censored executions remain in the denominator.

This frozen build predates the later recovery-instruction wording correction. The comparison was not rerun or amended after that change; [restoration verification](Release-Restoration.md) covers the corrected installer separately.

Three frozen fixtures: TTL/LRU cache bug, parallel slug/order feature, and a one-pass iterable refactor. Each has independent committed node:test acceptance tests. Three pairs per fixture alternate lead-only/Team order. Claude sonnet, default effort, subscription authentication, the same base and six-minute submission deadline are matched within each pair. Team uses a fixed Claude/Codex subscription roster, concurrency two and lead-integrates policy. Launch time is excluded equally. Native production services run on one Windows machine; this is not a packaged UI performance measurement.

| Fixture / pair | Condition | Code acceptance | Seconds | Attempts / revisions | Lead tokens* | Helper input / output | Controller inputs | Cleanup |
|---|---|---|---:|---:|---:|---:|---:|---|
| cache-bug / 1 | lead-only | pass | 133.8 | 0 / 0 | 358731 | unknown / unknown | 1 | confirmed |
| cache-bug / 1 | team | pass | 287.9 | 1 / 0 | 4196571 | 103376 / 1833 | 1 | confirmed |
| cache-bug / 2 | team | pass | 193.9 | 1 / 0 | 2870354 | 48970 / 862 | 0 | confirmed |
| cache-bug / 2 | lead-only | pass | 45.6 | 0 / 0 | 359012 | unknown / unknown | 0 | confirmed |
| cache-bug / 3 | lead-only | censored | 360.1 | 0 / 0 | 209794 | unknown / unknown | 3 | confirmed |
| cache-bug / 3 | team | pass | 219.0 | 1 / 0 | 3875031 | 83367 / 1704 | 0 | confirmed |
| parallel-feature / 1 | lead-only | pass | 53.8 | 0 / 0 | 314065 | unknown / unknown | 0 | confirmed |
| parallel-feature / 1 | team | pass | 192.1 | 2 / 0 | 3386470 | 65514 / 1526 | 0 | confirmed |
| parallel-feature / 2 | team | pass | 214.4 | 3 / 1 | 4419621 | 81188 / 3123 | 0 | confirmed |
| parallel-feature / 2 | lead-only | pass | 61.1 | 0 / 0 | 350288 | unknown / unknown | 0 | confirmed |
| parallel-feature / 3 | lead-only | pass | 50.8 | 0 / 0 | 313512 | unknown / unknown | 0 | confirmed |
| parallel-feature / 3 | team | pass | 288.2 | 3 / 1 | 6114854 | 65935 / 3531 | 0 | confirmed |
| stream-refactor / 1 | lead-only | pass | 32.6 | 0 / 0 | 305377 | unknown / unknown | 0 | confirmed |
| stream-refactor / 1 | team | pass | 179.7 | 1 / 0 | 2850939 | 82668 / 793 | 0 | confirmed |
| stream-refactor / 2 | team | pass | 151.3 | 1 / 0 | 2357855 | 98560 / 708 | 0 | confirmed |
| stream-refactor / 2 | lead-only | pass | 32.4 | 0 / 0 | 300624 | unknown / unknown | 0 | confirmed |
| stream-refactor / 3 | lead-only | pass | 40.6 | 0 / 0 | 307624 | unknown / unknown | 0 | confirmed |
| stream-refactor / 3 | team | pass | 166.7 | 1 / 0 | 3002404 | 48831 / 744 | 0 | confirmed |

*Lead tokens sum input, output, cache-read and cache-creation usage from the exact assigned Claude conversation, deduplicated by assistant message ID. Helper columns retain normalized reported counts. Complete Team total tokens and billed subscription cost are unknown; cached-token semantics and missing helper cache-creation counts prevent a complete combined total. Provider list-price estimates in raw metrics are not billed subscription dollars.

| Condition | Code pass / executions | Pass with confirmed cleanup | Censored | Median seconds | Range seconds | Median lead tokens |
|---|---:|---:|---:|---:|---|---:|
| lead-only | 8/9 | 8/9 | 1 | 50.8 | 32.4–360.1 | 313512 |
| team | 9/9 | 9/9 | 0 | 193.9 | 151.3–288.2 | 3386470 |

Elapsed summaries include observed times for censored runs; they are not estimates of time to eventual completion. Pair differences below require both conditions to pass without censoring and confirm cleanup. Timing ends at accepted verification or censoring and excludes subsequent shutdown in both conditions. Native permission waits are included; their duration was not separately instrumented. Team-panel approval delay does not apply to the fixed lead-integrates policy.

This batch used one frozen implementation bundle and bridge, sequential executions, and no intentional concurrent builds or model tests. Source hashes and installed CLI versions were checked before and after each execution. Per-run machine-observation.json files retain CPU-counter and memory snapshots. Normal operating-system and user background activity was not disabled; this is not exclusive-machine benchmarking.

| Fixture / pair | Team minus lead-only seconds | Team minus lead-only lead tokens |
|---|---:|---:|
| cache-bug / 1 | 154.1 | 3837840 |
| cache-bug / 2 | 148.3 | 2511342 |
| cache-bug / 3 | not comparable | not comparable |
| parallel-feature / 1 | 138.3 | 3072405 |
| parallel-feature / 2 | 153.3 | 4069333 |
| parallel-feature / 3 | 237.4 | 5801342 |
| stream-refactor / 1 | 147.1 | 2545562 |
| stream-refactor / 2 | 118.9 | 2057231 |
| stream-refactor / 3 | 126.1 | 2694780 |

Automated disposable-workspace trust, allowed file edits and command approvals are recorded separately in every report. Out-of-band input.json actions were supplied by the assistant test controller, not a human participant. Current reports use controllerInterventions; older reports that named the counter humanInterventions are normalized without altering raw evidence. No human participant drove these runs, and no human-attention savings were measured. Human interaction duration remains null. Pilots are excluded and retained separately. No general savings claim follows from these small tasks, CLI-managed accounts or incomplete cost coverage.

- cache-bug / 3 / lead-only: Matched evaluation deadline reached before accepted completion. Evidence: C:/Users/matth/AppData/Local/Temp/chorus-team-evaluation-91NHs8/cache-bug-pair3-lead-only.

The [earlier amended comparison](Evaluation-Report-Window-3.md) remains historical evidence. This fresh batch is separate and does not replace its failures.

The cache-bug pair 3 baseline reached its deadline while awaiting native permission for an inline edge-case check. The controller had rejected an earlier scratch-file write and restated the original editable-file constraints. The timeout includes permission/driver/controller delay; it is not proof that the generated implementation was incorrect. No rerun was substituted. Native temporary test exports were not a hermetic filesystem sandbox, and controller inputs were not a human-attention experiment.

## September 30, 2026 dependability pilots

The historical 18-execution batch above is unchanged. These new exploratory pilots use actual Opus `claude-opus-5-5` at explicit medium effort, OpenCode/OpenRouter DeepSeek V4.1 Flash helpers, recorded npm checks and guarded publication/cleanup. They are development production-service fixtures, not full packaged-app task measurements. Timings include task coordination and final project checks, exclude initial launch equally, and exclude subsequent shutdown. The small fixture has two implementation files and five independent frozen acceptance tests.

| Exploratory condition | Seconds | Lead output tokens | Lead cache-read tokens | Lead cache-creation tokens | Helper CLI-reported USD |
|---|---:|---:|---:|---:|---:|
| Standard-context solo | 27.785 | 1,591 | 292,910 | 25,702 | — |
| Standard-context one helper | 180.620 | 12,910 | 2,550,012 | 69,752 | 0.00099634536 |
| Focused-context solo probe | 33.824 | 1,952 | 403,793 | 8,992 | — |
| Focused-context two helpers | 193.658 | 13,207 | 2,561,051 | 94,199 | 0.00121788576 |

Reports are in [Evidence/Dependability](Evidence/Dependability/). The helper pilots in this table passed with zero retries, and the two-helper pilot recorded actual overlap. Both published and removed all five worktrees. These pilots used evolving builds; the standard solo and one-helper examples also overlapped in wall time. They cannot establish a controlled improvement from focused context or a general time/cost effect. Even the expanded comparison fixture remains small relative to a real multi-file feature.

Earlier failing probes remain in temporary evidence: request payload canonicalization, canonical evidence property order, native Windows script-shell resolution, trust/prompt-driving mistakes, and a false solo-completion detector were corrected. A later solo probe timed out at a compound-command permission prompt (`invalid-solo-timeout.json`); its comparison batch was invalidated after a harness change. A separate probe was explicitly stopped at the current Claude Windows `PowerShell` tool's npm approval (`cancelled-solo-probe.json`); its Bash-only fixture allowlist was corrected to name both native tools. These are retained harness/runtime failures, not hidden successful trials. CLI permission denials in subsequently frozen trials count as failed helper attempts and remain in usage, timing and retention totals.

Claude subscription expenditure and complete billed Team cost remain unknown. Cache reads, cache creation, ordinary input and output are separate counters; adding them across models is not a dollar estimate. Helper dollars are the CLI's reported deltas, deduplicated by record ID, without provider-ledger reconciliation. No human-attention benefit was measured. The current evidence supports the workflow's functionality, not lower lead token use, lower overall billed cost or faster completion.

## Completed September 30 comparison

The new [frozen 18-run report](Evidence/Dependability/benchmark-before-dependency-refresh.json) compares Opus alone, Opus with one DeepSeek helper, and Opus with two DeepSeek helpers. Each condition ran three times on each of two fixtures, sequentially with rotating order and the same explicit medium effort. Source hashes and independent acceptance were frozen throughout this batch. Every run passed. Team runs published their verified result and removed eligible successful worktrees; five unsuccessful helper attempts were retained with explicit dispositions. Two-helper runs recorded actual parallel execution.

| Fixture | Condition | Passed | Median seconds | Median lead output tokens | Median lead cache-read tokens | Helper retries | Retained worktrees |
|---|---|---:|---:|---:|---:|---:|---:|
| Small | Solo | 3/3 | 32.888 | 1,797 | 406,949 | 0 | 0 |
| Small | One helper | 3/3 | 190.965 | 13,782 | 2,498,825 | 2 | 2 |
| Small | Two helpers | 3/3 | 171.905 | 12,745 | 2,227,665 | 1 | 1 |
| Expanded | Solo | 3/3 | 46.071 | 2,851 | 473,993 | 0 | 0 |
| Expanded | One helper | 3/3 | 189.660 | 14,563 | 2,226,768 | 0 | 0 |
| Expanded | Two helpers | 3/3 | 205.886 | 16,182 | 2,943,748 | 2 | 2 |

Coordination outweighed the helpers' implementation work on both fixtures. Teams did not reduce lead tokens or elapsed time. One versus two helpers had mixed timing results; this batch does not establish that adding a second helper helps. The expanded fixture has eleven independent acceptance tests but remains small compared with a real multi-file feature. Use solo for similarly small changes; evaluate Teams on larger tasks with genuinely independent work before expecting savings. Keep helper briefs bounded, group related edits into substantial tasks, and verify the combined result once at an exact SHA rather than repeating the same full suite for every task.

The raw report's `leadUsageCompleteTrials` field counts trials with recorded transcript usage; it is not a completeness guarantee for billing. Future reports name that field `leadUsageRecordedTrials`. All counters are observed CLI/transcript records. Subscription and total billed dollars remain unknown; CLI-reported helper costs do not establish overall savings.

This comparison predates the final dependency-refresh and native process/cleanup corrections. Those corrections have separate regression evidence; the frozen report was preserved without amendment and is not a performance measurement of the final rebuilt executable. The task timing excludes initial launch and subsequent shutdown consistently. No full packaged-app task, human-attention savings, or provider-ledger reconciliation was measured.

## Larger two-condition follow-up

At the user's request, a separate [larger comparison](Evidence/Dependability/benchmark-long.json) ran Opus alone versus Opus with two DeepSeek helpers, once each, with a 15-minute limit per run. It used the final hardened runtime, frozen source, the same medium effort and focused context, fresh repositories, sequential execution, and [identical acceptance hashes](Evidence/Dependability/long-fixture.json). No builds, model trials or native regression runs intentionally overlapped the comparison.

The task required eight new modules: streaming CSV parsing, formatting, typed row validation and import composition; plus dependency-graph validation, constrained scheduling, immutable job transitions and replay-validated snapshots. There were 57 independent acceptance tests, including every CSV chunk split, deterministic roundtrips, malformed input, prototype names, invalid transitions, forged snapshots and a 60-job scheduling/replay scenario. Both conditions passed. Teams had zero retries/permission failures, actual helper overlap, exact publication and removal of all five worktrees.

| Condition | Task time | Lead output tokens | Lead cache-read tokens | Lead cache-creation tokens | Helper CLI-reported USD |
|---|---:|---:|---:|---:|---:|
| Opus alone | 204.306 s (3:24) | 19,749 | 701,952 | 42,087 | — |
| Opus + two DeepSeek helpers | 397.871 s (6:38) | 31,406 | 5,349,228 | 139,607 | 0.01590329016 |

The two helper attempts lasted 96.350 and 123.640 seconds and overlapped for approximately 70 seconds. The Team lead made 48 model requests containing 55 tool calls (the earlier report's 48-call counter retained only the last content block per message and undercounted calls). Planning, review, integration, checks and finish coordination outweighed the implementation speedup in this pair: elapsed time was approximately 1.95 times solo, and lead output was approximately 1.59 times solo. Larger work reduced the relative output overhead compared with the tiny fixtures, but still did not show savings. Original raw reports remain unchanged; token totals were verified and are unaffected by this call-count correction.

Opus finished this larger task sooner than the intended 10–15 minute workload. This is a multi-minute comparison, not evidence about an actual 10–15 minute solo task or an hour-long feature. One pair, fixed solo-first order, synthetic work and unknown subscription billing limit the conclusion. It supports measuring larger real features and reducing lead coordination further; it does not justify assuming an eventual cost/time crossover. Keep output/cache counters separate, and retain reported helper dollars without treating them as total billed cost.

## Lead activity audit

A follow-up [request-level audit](Evidence/Dependability/lead-activity-breakdown.json) reconstructed every assistant content block from the exact assigned transcripts, deduplicating usage by message ID and tools by tool-use ID. Repeated blocks for each message carry identical usage; totals match the frozen report. Each request is assigned to its tool activity, including any accompanying text or unseparated reasoning. These are request totals, not exact per-sentence or per-argument tokenization.

| Team lead activity | Model requests | Output tokens | Output share | Cache-read tokens |
|---|---:|---:|---:|---:|
| Helper delegation | 1 | 9,345 | 29.76% | 54,102 |
| Final verification-evidence submission | 1 | 10,381 | 33.05% | 138,339 |
| Artifact/prepared review | 5 | 4,216 | 13.42% | 507,749 |
| Waiting | 28 | 4,262 | 13.57% | 3,302,967 |
| Setup, reads, integration and finish | 13 | 3,202 | 10.20% | 1,346,071 |
| Total | 48 | 31,406 | 100% | 5,349,228 |

The two delegation calls contain 7,666 and 7,297 characters of brief text despite both helpers having the committed SPEC.md reference. The two final integrated-review calls each repeat the same 7,010-character test output, plus its structured evidence, although Chorus already owns that record under a verificationId. Together, these two model requests account for 62.81% of output. The current instructions explicitly request complete self-contained briefs and resubmission of the full exact evidence object; this creates avoidable copying work for the expensive lead.

Waiting is the largest cache-read activity (approximately 61.7%). Its 28 requests include 20-second timeouts and rapid catch-up wakeups for workspace/dependency preparation and finish-check transitions that do not require a lead decision. For example, startup cursors advance through reserved/workspace/check/ready/spawn events, and finish cursors advance through each check's start/completion. The current actionable cursor filters stdout and process observations but still includes these internal journal events. Repeated waits grow and reread the conversation even when implementation is already proceeding correctly.

The first artifact review also attempted to submit helper-reported checks and was rejected as UNRECORDED_CHECK; the corrected review used an empty tests array. This adds one avoidable model request without creating a helper retry. Solo used 11 model requests containing 27 tool calls, with 17,246 output tokens (87.33%) in implementation/edit requests and 2,503 elsewhere.

Recommended next changes, in priority order: let integrated reviews reference server-owned verification IDs and validate run/SHA/outcome in main without round-tripping logs; let concise helper briefs point to complete committed contracts rather than copying them; add waits for decision-ready task results or terminal finish status, suppressing preparation/check housekeeping wakeups; and clarify that artifact/prepared reviews do not need invented independent check evidence. Keep recorded verification, immutable SHA checks and review authority. The audit identifies optimization targets; it does not measure the savings those changes would produce.


## Coordination fixes and larger calibration

The approved follow-up replaces copied integrated evidence with run-scoped verification IDs; references committed contracts in concise briefs; adds result/check decision waits within one MCP call; and supports atomic bounded delegation/review batches plus configured verification suites. Existing proof ownership, exact SHA, cessation, recovery and cleanup requirements remain enforced. The updated transcript audit counts all content blocks and exports activity/argument-size/wait metadata without retaining prompts or reasoning.

The [twenty-module calibration](Evidence/Dependability/efficiency-calibration.json) passed in 533.255 seconds (8:53) with [194 frozen independent tests](Evidence/Dependability/extended-fixture.json). Opus 5.5 medium wrote 59,845 output tokens using 21 recorded model requests and 52 tool calls. This single solo calibration established that the contract is implementable and materially larger than the earlier eight-module fixture; it is excluded from the fresh matched comparison. Actual duration was below ten minutes. The measured pair uses the unchanged contract, fresh independent repositories, focused context, the same effort, sequential runs and a 15-minute submission limit for both conditions.

Source tests passed 3,517 cases in 120 files; native lifecycle/verification/recovery and freshly packaged UI checks passed. Claude Code 2.1.286 was already installed and its [real Opus medium lead diagnostic](Evidence/Dependability/efficiency-claude-2.1.286.json) passed; new helper versions and arbitrary future lead versions remain gated. No speed or cost conclusion is drawn from these correctness checks.


## Frozen ten-minute matched pair after coordination fixes

The [original report](Evidence/Dependability/benchmark-efficiency-extended-raw.json) is preserved, including its failing Team harness verdict. The [derived audit](Evidence/Dependability/benchmark-efficiency-extended-audit.json) explains the measurement defect: the overlap assertion compared two consecutive attempts of the same task rather than intervals belonging to different helper identities. Recorded intervals prove 276.474 seconds of helper overlap across the initial and replacement attempts. Independently rerunning all 194 frozen tests against the published Team destination passes; both tasks and all exact integrated reviews completed, and the destination is clean. The original raw verdict was not edited into a pass.

| Condition | Observed seconds | Lead output tokens | Lead cache-read tokens | Lead requests / tool calls | Lead API-equivalent + helper reported USD |
|---|---:|---:|---:|---:|---:|
| Opus alone | 603.703 (10:04) | 73,422 | 1,395,859 | 13 / 51 | 2.7210 |
| Opus + two DeepSeek helpers | 522.094 (8:42) | 15,368 | 5,324,005 | 45 / 51 | 2.5304 |

Team elapsed includes final harness checks before the erroneous assertion and is a conservative observed duration. The lead estimate is 2.448057 USD; all 76 helper usage records reported cost, totaling 0.082326705 USD. Dollar values use [standard global Opus 5.5 API rates](https://platform.claude.com/docs/en/models/opus-5-5/whats-new-opus-5-5) with observed one-hour cache writes, plus CLI-reported helper costs. They are not subscription charges or reconciled bills. One solo-first pair suggests 79.07% less lead output, 13.52% less observed time, and 7.01% less API-equivalent-plus-reported cost. Higher cache reads offset much of the output savings. No statistical or hour-long-task claim follows.

The two initial helpers attempted denied shell directory listings. The lead explicitly revised each once; the replacements succeeded. These failures, extra calls, helper costs and time remain included. Five worktrees were removed; the two failed-work worktrees were retained with evidence, as required by guarded cleanup. This was not a zero-retry or complete-cleanup trial.

Compared with the earlier eight-module protocol audit (different workload, not a matched speed comparison), delegation output fell from 9,345 to 1,847 tokens and initial brief/context lengths from 7,666/7,297 to 1,293/1,233 characters. Inline verification log characters are now zero. All reviews together used 3,523 output tokens, versus 14,597 for the earlier artifact/prepared plus final evidence requests. Waiting used 15 requests and 1,966,327 cache-read tokens, versus 28 and 3,302,967 previously. A single actual result wait remained open for 146.252 seconds through eight broker segments, with no 120-second Claude auto-background wake. Model requests remained high (45), including permission recovery, paginated diff inspection and two avoidable queued-check errors; reducing output did not eliminate coordination.

### Follow-up fixes and bounded regression

After preserving the pair, the queued-check lookup was corrected to include suite queue records and query selected IDs independently of the bounded global history. Native regression covers waiting on queued IDs after more than 64 newer checks and rejecting an unknown ID. Initial helper instructions now explicitly require native read/glob/grep for discovery and prohibit shell listings, matching the successful replacement instructions. The overlap audit now handles unordered retries and measures the union of actual concurrent intervals; preparation timing derives from the recorded reservation deadline rather than a nonexistent createdAt field.

A short live two-DeepSeek regression (`%TEMP%/chorus-team-pilot-lhY7IV`) completed both tasks on first attempts without permission blockers and used the compact suite workflow. Its initial cleanup exposed a Windows exit race: StartTime could become null after Get-Process returned. Process inspection now snapshots identity fields, checks again when fields disappear, and retains uncertainty for an unidentified live PID. A guarded cleanup retry passed (`cleanup-retry.json`) and removed all five owned worktrees. The original short-run failure is retained; the retry is separate evidence. This is correctness regression, not another matched performance trial. The longer measured pair predates these last fixes; their effect on ten-minute performance has not been measured.

Use Teams for substantial independent implementation with committed contracts and explicit ownership. The new pair supports the intended division of labor, but a real feature trial is the next dependability check. Keep the Team panel visible for blockers and retained workspaces. For small changes, the earlier comparisons still favor solo execution.


## October 1 GPT Team troubleshooting

The current source fixes captured-artifact revision continuity, Windows environment casing, native generation-failure evidence and corrected-request recovery. New DeepSeek V4.1 Flash selections on OpenCode 1.18.33 use low effort, the measured 64,000-token code-helper cap and verified relative-path guidance. Existing recorded runs keep their original settings. Revisions retain the original assignment and start from the last captured successful implementation.

Sol, Astra and Claude passed small controlled recovery. Both GPT leads completed actual two-helper tasks in the unpacked application. Sol also passed medium and extended tasks. An extended ten-file-per-helper repeat missed its overall deadline; the failed comparison remains invalid. Smaller assignments passed a separate twenty-module/194-test qualification in 1,225.562 seconds with three content corrections, zero helper/permission failures, unattended publication and removal of all sixteen worktrees. That condition uses three rounds of two helpers and a 30-minute overall benchmark limit. The final frozen Team-first Sol pair passed both conditions: solo 725.023 seconds versus Team 1,415.986 seconds. Team used 28.96% fewer lead output tokens, but took 95.30% longer and had a 229.38% higher API-equivalent-plus-helper-reported cost estimate (actual subscription billing remains unknown). There is no demonstrated speed or cost saving. Team had two content revisions and no helper/permission failures; one worktree was safely retained after a Git cleanup error, then removed by the existing guarded retry without changing the original comparison. This is one pair, not an average or a broad reliability claim.

Final validation passes 3,528 tests/118 files, node/web typechecks, build, secret scan and packaged UI checks. The final unpacked build is `_verify/team-troubleshooting-final/win-unpacked/Chorus.exe`; it has not been installed. The real revision fixture passed 47 assertions, and selected real restart scenarios passed 102 assertions. See the [execution record](../../troubleshooting/Team-Session-GPT-Execution-2026-10-01.md) for exact evidence and retained failures.

### October 1 offline efficiency audit

The [request and timing audit](../../troubleshooting/Team-Session-GPT-Efficiency-Audit-2026-10-01.md) reconciles the exact native usage with the frozen Sol pair. Team made 64 model requests versus 21 for Solo. Fifteen outer Codex wait-resumption turns consumed 1,297,646 input tokens, almost all cached. Decoded artifact/prepared diff pages include 43,188 characters repeated byte-for-byte. Helper execution occupied a union of 772.236 seconds; 643.750 seconds had no helper executing, or 599.613 seconds excluding preparation too. The longer helper chain itself required 741.513 seconds versus Solo's entire 725.023 seconds, so eliminating coordination alone does not establish a speed win. Earlier Claude Team output was 15,368 versus Sol Team's 13,903; Claude's much larger output-saving percentage partly reflects its much larger Solo baseline. Those historical pairs use different task partitioning, helper configuration and context policies. The audit prioritizes a short outer-wait diagnostic, compact verified diff equivalence, prompt/context reduction and isolated helper-throughput investigation before another matched comparison. No new live trial or production change was made for this audit, and prospective savings remain unmeasured.
