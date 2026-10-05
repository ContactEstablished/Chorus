# GPT Team efficiency audit — October 1, 2026

## Finding

The completed Sol comparison exposes both coordination overhead and a slow helper execution chain. The 28.96% reduction concerns lead **output** only. Team processed 6.67 million lead input tokens versus Solo's 1.00 million, mostly cached, and took 23:36 versus 12:05. Removing coordination alone would not establish a speed win: the longer helper chain required 12:22 of actual execution, excluding preparation, review and integration.

This is an offline audit of existing evidence. No additional live benchmark or production change was made for this investigation. Results are one pair, not averages; proposed savings remain unmeasured.

## Evidence and method

- Frozen pair: `%TEMP%/chorus-team-benchmark-qe4CR0/report.json`.
- Team: `%TEMP%/chorus-team-pilot-X2ZAZd`; Solo: `%TEMP%/chorus-team-pilot-TRglxa`.
- Source hash: `f28ed8ad73cff5d8fc69b2ab0920293d8c87e31c46582a2c3c1a1440b9147962`.
- Both executed bundle hashes: `2d2a1e1a506418daeb7d3ba836a1c764208736b14346a3ae4881a1f0f4cdfa1b`.
- Lead: Codex 0.159.3, Sol medium, standard context. Helpers: OpenCode 1.18.33, DeepSeek V4.1 Flash low, qualified 64,000-token cap.
- Same twenty-module contract and 194 frozen tests; Team used six assignments in three sequential pairs. Both passed unattended. Team needed two content revisions and no helper/permission failures. Original cleanup retained one worktree; the existing guarded retry subsequently removed it. That retry is separate evidence.
- Local reproducer: `_verify/team-gpt-efficiency-audit.py`; sanitized metadata: `_verify/team-gpt-efficiency-audit.json`. These are ignored diagnostics. Native transcript session ID, originator and working directory are checked against each fixture database. Deduplicated request usage reconciles input, cached input, output and total tokens with the original reports. Raw prompt/code/reasoning content is not copied into the derived JSON.
- Helper timing uses the union of recorded execution intervals. Lead work can overlap execution; time without an executing helper is not automatically waste. Preparation estimates use the recorded five-minute reservation deadline.

## Where the time went

| Measurement | Sol Team |
| --- | ---: |
| Total observed completion | 1,415.986 s (23:36) |
| At least one helper executing | 772.236 s (12:52) |
| Neither helper executing | 643.750 s (10:44) |
| Neither helper executing nor preparing | 599.613 s (10:00) |
| Data helper's sequential execution, including revisions | 741.513 s (12:22) |
| Jobs helper's sequential execution | 520.723 s (8:41) |
| Actual overlap between executing helpers | 490.000 s (8:10) |
| Solo's entire task | 725.023 s (12:05) |

The six-task condition introduced review and integration between rounds. After each pair completed, the next round's execution began about 140 seconds and 124 seconds later, respectively. The two content corrections also required lead review and redispatch. Final completion followed the last helper by about 150 seconds. These intervals include useful contract review, integration, checks and finish handling; the audit does not attribute all of them to avoidable model latency.

Letting each independent chain advance as soon as its own foundation is committed is worth testing. It is not sufficient by itself: the observed execution union exceeds the longer chain by only 30.723 seconds. Even an ideal schedule with zero preparation/review time retains approximately 12:22 of helper execution at these observed attempt durations. Larger speed gains require faster helper completion, fewer corrections, or a different assignment strategy as well as cheaper lead coordination.

## Where the lead tokens went

| Measurement | Sol Solo | Sol Team |
| --- | ---: | ---: |
| Lead model requests | 21 | 64 |
| Lead output tokens | 19,572 | 13,903 |
| Lead input tokens, including cached input | 1,003,858 | 6,670,515 |
| Cached input, subset of input | 951,936 | 6,490,368 |
| First request input | 16,332 | 21,089 |
| Last request input | 60,660 | 180,912 |
| Tool-result characters delivered to lead | 82,308 | 456,203 |

**Outer wait resumptions are a specific Codex target.** Long `team_wait` calls run inside `functions.exec`. That outer wrapper yields while the underlying wait remains active, requiring the model to call `functions.wait`. There were 15 such additional request turns: 1,297,646 input tokens, of which 1,292,672 were cached, and 643 output tokens. That is approximately 19.5% of Team input. Twelve resumptions requested 60-second yields and three requested one second; this was not uniformly rapid polling. Increasing the inner Team timeout alone does not address the outer wrapper. Eliminating all of those turns or their wall-clock time is not yet demonstrated.

**Evidence inspection dominates the remaining context growth.** Twenty-one requests containing diff inspection account for 2,434,635 input tokens and 258,595 tool-result characters. Thirteen requests containing review/integration account for another 1,561,994 input tokens. These are whole-request activity buckets, including any accompanying prose and other calls, not token estimates for individual arguments.

Among decoded diff-page envelopes, 20 pages contained 235,159 characters of diff text. Four repeated pages were byte-identical to earlier pages, totaling **43,188 repeated characters** across three artifact/prepared comparisons. The lead later used stored strings and equality checks to avoid printing some other prepared diffs again. This makes compact, server-verified equivalence a concrete candidate; it does not justify skipping review of changed content or abandoning exact SHA checks. Revisions also reread complete artifacts; a proven change view could reduce rereading while retaining the full immutable artifact for capture and integration.

**Prompt formatting contributes additional output.** The native Team lead echoed 11,910 characters of its task prompt across three commentary messages, excluding ANSI escapes and separator rules. Solo echoed 7,328 across four messages. These are character counts, not tokenizer measurements. The inherited jade-echo requirement explains the behavior. A compact submitted task pointing to its committed contract could reduce repetition; changing the user's formatting preference is a separate decision, and no global setting was changed.

Cached input is cheaper than uncached input but still affects the measured token totals and API-equivalent estimate. Neither these counts nor the estimate establishes actual subscription charges.

## Why the Claude result looked better

The prior twenty-module Claude pair is documented in [Evaluation-Report.md](../Features/Team%20Sessions/Evaluation-Report.md), with the original raw verdict and its derived acceptance/overlap audit preserved.

| Measurement | Earlier Claude Team | Current Sol Team |
| --- | ---: | ---: |
| Team observed completion | 522.094 s (8:42) | 1,415.986 s (23:36) |
| Team lead output tokens | 15,368 | 13,903 |
| Corresponding Solo lead output tokens | 73,422 | 19,572 |
| Team lead model requests | 45 | 64 |
| Helper execution union | 327.071 s (5:27) | 772.236 s (12:52) |
| No helper executing | 195.023 s (3:15) | 643.750 s (10:44) |

Sol Team actually produced fewer lead output tokens than Claude Team. Claude's 79.07% output reduction versus Sol's 28.96% is heavily influenced by the much larger Claude Solo baseline. Cross-model tokens are not identical units of work, and this comparison does not establish that Claude's lead protocol is intrinsically more token-efficient.

The speed difference is real in the recorded trials, but several conditions changed: Claude used two ten-file assignments and focused context, while Sol used six smaller assignments, standard context and a changed helper effort/cap/prompt configuration. Claude's initial two attempts hit permission failures and were replaced; those failures remain included. The original Claude harness verdict failed an overlap assertion, and the corrected audit verified acceptance and actual concurrency separately. The comparison is not a clean experiment isolating lead model choice.

Smaller assignments solved a dependability problem for the current helper route at the cost of more sequential work and reviews. Returning immediately to two large assignments would ignore the recorded generation exhaustion and deadline failures. Both helper throughput and orchestration need isolated investigation.

## Next experiments, in order

1. **Measure and reduce outer wait resumptions.** Use one short native wait diagnostic to test available Codex dispatch/yield behavior and count actual model requests. Preserve cancellation, actionable failure delivery and user progress. A longer broker timeout is already present and is not itself a fix. Accept a change only if it removes model wakeups without hiding real decisions; do not begin another full twenty-module run to discover wrapper behavior.
2. **Avoid transmitting the same reviewed diff twice.** Prototype compact equivalence evidence for prepared content, bound to the reviewed artifact, integration baseline and immutable result. Return changed content when equality cannot be established. Test identical preparation, changed baseline, conflict and stale review. Also test a revision change view with explicit provenance; retain complete artifacts and final independent acceptance. Measure result bytes and model requests before assuming a speed improvement.
3. **Reduce prompt/context repetition.** Submit concise fixture instructions referencing the committed contract, and use compact tool results. Measure effects separately from any optional change to jade formatting. A focused-context experiment can follow, but initial context is much smaller than the final 181k-token input, so reducing initial instructions alone will not address the main growth.
4. **Improve the helper execution chain.** First inspect native usage and operation timing for the slow foundation/revision attempts; then run a bounded helper-only diagnostic on one representative assignment. Compare scope and effort/prompt choices one at a time, retaining local acceptance and failure reporting. Advancing independent committed chains may overlap more useful work, but cannot remove the observed 12:22 execution lower bound by scheduling alone.
5. **Only then compare leads under the same final workflow.** Match assignment boundaries, helper configuration, context policy and acceptance. Start with one short qualification and one frozen pair; expand repetitions only after a measured improvement. The old Claude and current Sol pairs cannot isolate which lead is better at orchestration.

The first two experiments have specific observed overhead to target. Beating Solo on elapsed time additionally requires improving helper throughput or changing the division of work. No prospective percentage saving is claimed.

## Implemented follow-up — Nitro routing and bounded review/wait changes

The original comparison above remains unchanged. The following changes were implemented afterward at the user's request; they do not establish a new Team/Solo speed or cost result.

### Nitro helpers

New built-in DeepSeek helper selections now use `deepseek/deepseek-v4.1-flash:nitro` in both default slots. Historical runs and explicitly saved standard-route presets retain their model identity; a standard-route option remains available. The native command receives `openrouter/deepseek/deepseek-v4.1-flash:nitro`, and the HTTP request receives the unprefixed OpenRouter ID with `:nitro` intact.

[OpenRouter's Nitro documentation](https://openrouter.ai/docs/guides/routing/model-variants/nitro) says the suffix sorts providers by throughput and admits eligible priority-tier endpoints. Actual speed and price depend on the endpoint serving the request.

A necessary compatibility correction was found by the native loopback probe: OpenCode 1.18.33 silently omitted `reasoning.effort` for the Nitro alias despite `--variant low`. Initial failed evidence: `%TEMP%/chorus-helper-budget-eyiMSw`. An explicit `low` variant mapping in the ephemeral model configuration fixes this. Repeated native evidence `%TEMP%/chorus-helper-budget-47zoXn` confirms the exact Nitro ID, `reasoning.effort=low`, `max_tokens=64000`, and five permitted native tools. The original standard-route controls also pass. Unknown model suffixes do not inherit the bounded helper policy. No ambient token-limit override is admitted.

`%TEMP%/chorus-helper-paths-t4KQIK` separately verifies that the bounded system prompt is delivered and relative read/write/edit/glob/grep work with the Nitro alias. These probes use a loopback server and placeholder credential; they do not measure provider throughput.

### Outer-wrapper diagnostic

Read-only inspection of the saved Sol `chorus-codex-team-client-W8CeWm` and Astra `chorus-codex-team-client-rAbtn3` native transcripts found three model requests and one outer wrapper resumption each, despite both transport reports passing. The prior verifier counted only one native MCP call and four broker segments.

The diagnostic now verifies exact owned transcript identity and reconciled request usage, and reports model requests, wrapper resumptions and requested yields. Run the candidate with:

```powershell
node scripts/verify-team-codex-client.mjs gpt-6.1-sol --wrapper-yield
```

No helpers run in this synthetic-readiness transport experiment. On Codex 0.159.3/Sol medium, `%TEMP%/chorus-codex-team-client-u4WqBS` passed with a 75.001-second underlying wait, one MCP call, four broker segments, **zero outer resumptions and two model requests**. The initial wrapper requested 120,000 ms. Exact lead usage: 31,941 input, 28,160 cached input (subset), 547 output. The saved Sol baseline used 47,764 input, but prompt differences and one observation preclude a generalized savings percentage.

Qualified Codex Team instructions now request that initial wrapper yield and resume the same cell if it still yields. The underlying decision wait, cancellation and actionable-failure behavior are unchanged. Longer waits can still require resumptions. This diagnostic establishes the short readiness case, not zero wakeups for a full Team run or a new native cancellation trial.

### Compact prepared evidence

`team_detail` accepts optional `reuseReviewed: true` with `section: "diff"` and the exact `integrationId`. An accepted current artifact, stopped successful attempt, prepared integration and clean matching baseline are required for compact proof. On equivalence it returns `kind: "reviewed-equivalent"` with the artifact review ID, run/task/attempt IDs, artifact base/result, preparation/integration IDs, expected HEAD, prepared result SHA and content identity.

The identity hashes the complete NUL-delimited Git raw manifest with full before/after blob IDs, modes and paths; rename detection, external diffs and text conversion are disabled. It never compares truncated diff prefixes. Unrelated baseline changes can retain equality; any changed content in an affected file prevents reuse. Binary changes and deletions are included. The receipt proves changed-file content equivalence, not semantic equivalence of different surrounding baselines.

When proof cannot be established, normal paginated diff review remains available. Wrong integration/current-attempt bindings are rejected. `reuseReviewed: false` always exposes the ordinary diff. Exact prepared-SHA review, promotion guards and independent final-HEAD checks remain required. Real-Git regression tests cover disjoint changed baselines, changes exceeding 256 KiB, binary/deleted files, stale or rejected reviews, conflicts and unknown integrations. For the large test fixture, serialized compact evidence is less than one percent of the capped diff body; this is a fixture byte measurement, not a measured model-token or runtime saving.

### Validation limits and next step

The intended four-file helper-only trial (`node scripts/verify-team-pilot.mjs --helpers-only --workload long --local-checks`) stopped before helper launch: Electron was absent and Windows returned Access denied while creating `node_modules/electron/dist/electron.exe`. The cause remains unconfirmed. No Nitro live-throughput result or new full comparison exists. No protection settings were changed.

Node and renderer typechecks passed. The full suite reached 3,193 passing tests in 117 files; two additional suites could not load because of the same Electron installation failure. The subsequent focused run passed 54 tests across four files, and the production build passed. After restoring the Electron runtime, resume with the bounded helper-only trial, then compare the same assignment under standard/Nitro routing with unchanged effort, cap, prompt and acceptance. Scheduling and revision-delta experiments remain separate follow-ups; do not pool these results with the old Claude or Sol pairs.
