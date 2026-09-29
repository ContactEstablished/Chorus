# Phase 11 evaluation — 18 executions recorded

Evidence: [manifest](Evidence/Window-3/evaluation-manifest.json) and [per-run metrics](Evidence/Window-3/evaluation-metrics.json). Full traces remain in `%TEMP%/chorus-team-evaluation-eZaywb`. Execution mode: formal-18. 18/18 executions recorded. Failed and censored executions remain in the denominator.

**Protocol amendment:** this is not a single-build performance benchmark. After execution five, cleanup encountered an unretired recycled descendant PID. The ownership implementation and baseline teardown verifier were corrected before the remaining executions. Earlier results and their failed cleanup remain unchanged. The manifest records each bundle and amendment; starting commits, acceptance tests, lead configuration, roster, order and task deadlines stayed fixed. Interpret time/usage differences as exploratory functional evidence, not a controlled savings claim.

Three frozen fixtures: TTL/LRU cache bug, parallel slug/order feature, and a one-pass iterable refactor. Each has independent committed node:test acceptance tests. Three pairs per fixture alternate lead-only/Team order. Claude sonnet, default effort, subscription authentication, the same base and six-minute submission deadline are matched within each pair. Team uses a fixed Claude/Codex subscription roster, concurrency two and lead-integrates policy. Launch time is excluded equally. Native production services run on one Windows machine; this is not a packaged UI performance measurement.

| Fixture / pair | Condition | Code acceptance | Seconds | Attempts / revisions | Lead tokens* | Helper input / output | Controller inputs | Cleanup |
|---|---|---|---:|---:|---:|---:|---:|---|
| cache-bug / 1 | lead-only | pass | 52.7 | 0 / 0 | 366038 | unknown / unknown | 0 | confirmed |
| cache-bug / 1 | team | pass | 295.8 | 1 / 0 | 4075221 | 84854 / 1713 | 1 | confirmed |
| cache-bug / 2 | team | pass | 189.8 | 1 / 0 | 2839468 | 85838 / 1693 | 0 | confirmed |
| cache-bug / 2 | lead-only | pass | 49.7 | 0 / 0 | 361068 | unknown / unknown | 0 | confirmed |
| cache-bug / 3 | lead-only | pass | 55.0 | 0 / 0 | 314212 | unknown / unknown | 0 | unconfirmed |
| cache-bug / 3 | team | pass | 197.9 | 1 / 0 | 3303558 | 84265 / 1441 | 0 | confirmed |
| parallel-feature / 1 | lead-only | pass | 42.7 | 0 / 0 | 358186 | unknown / unknown | 0 | confirmed |
| parallel-feature / 1 | team | censored | 360.7 | 4 / 2 | 2203607 | 164322 / 3300 | 4 | confirmed |
| parallel-feature / 2 | team | pass | 254.7 | 3 / 1 | 8646156 | 181735 / 4554 | 0 | confirmed |
| parallel-feature / 2 | lead-only | pass | 55.1 | 0 / 0 | 366413 | unknown / unknown | 0 | confirmed |
| parallel-feature / 3 | lead-only | pass | 52.9 | 0 / 0 | 369745 | unknown / unknown | 0 | confirmed |
| parallel-feature / 3 | team | pass | 264.0 | 4 / 2 | 6994309 | 181798 / 3648 | 0 | confirmed |
| stream-refactor / 1 | lead-only | pass | 37.5 | 0 / 0 | 306855 | unknown / unknown | 0 | confirmed |
| stream-refactor / 1 | team | pass | 204.1 | 1 / 0 | 4281868 | 99667 / 804 | 0 | confirmed |
| stream-refactor / 2 | team | pass | 208.9 | 1 / 0 | 3786722 | 66920 / 957 | 0 | confirmed |
| stream-refactor / 2 | lead-only | pass | 35.5 | 0 / 0 | 298400 | unknown / unknown | 0 | confirmed |
| stream-refactor / 3 | lead-only | pass | 47.7 | 0 / 0 | 304813 | unknown / unknown | 0 | confirmed |
| stream-refactor / 3 | team | pass | 230.2 | 1 / 0 | 4211248 | 97605 / 990 | 0 | confirmed |

*Lead tokens sum input, output, cache-read and cache-creation usage from the exact assigned Claude conversation, deduplicated by assistant message ID. Helper columns retain normalized reported counts. Complete Team total tokens and billed subscription cost are unknown; cached-token semantics and missing helper cache-creation counts prevent a complete combined total. Provider list-price estimates in raw metrics are not billed subscription dollars.

| Condition | Code pass / executions | Pass with confirmed cleanup | Censored | Median seconds | Range seconds | Median lead tokens |
|---|---:|---:|---:|---:|---|---:|
| lead-only | 9/9 | 8/9 | 0 | 49.7 | 35.5–55.1 | 358186 |
| team | 8/9 | 8/9 | 1 | 230.2 | 189.8–360.7 | 4075221 |

Elapsed summaries include observed times for censored runs; they are not estimates of time to eventual completion. Pair differences below require both conditions to pass without censoring and confirm cleanup. Timing ends at accepted verification or censoring and excludes subsequent shutdown in both conditions. Native permission waits are included; their duration was not separately instrumented. Team-panel approval delay does not apply to the fixed lead-integrates policy.

Background development, builds and native verification ran on the same machine during this batch; machine load was not controlled. No other intentional model workload was run concurrently. This further limits performance comparisons.

| Fixture / pair | Team minus lead-only seconds | Team minus lead-only lead tokens |
|---|---:|---:|
| cache-bug / 1 | 243.1 | 3709183 |
| cache-bug / 2 | 140.1 | 2478400 |
| cache-bug / 3 | not comparable | not comparable |
| parallel-feature / 1 | not comparable | not comparable |
| parallel-feature / 2 | 199.7 | 8279743 |
| parallel-feature / 3 | 211.1 | 6624564 |
| stream-refactor / 1 | 166.6 | 3975013 |
| stream-refactor / 2 | 173.5 | 3488322 |
| stream-refactor / 3 | 182.5 | 3906435 |

Automated disposable-workspace trust, allowed file edits and bounded command approvals are recorded separately in every report. Out-of-band input.json actions were supplied by the assistant test controller, not a human participant. The frozen driver called this counter humanInterventions; derived metrics correct its meaning to controllerInterventions without altering raw reports. No human participant drove these runs, and no human-attention savings were measured. Human interaction duration remains null. Pilots are excluded and retained separately. No general savings claim follows from these small tasks, CLI-managed accounts or incomplete cost coverage.

- cache-bug / 3 / lead-only: Baseline cessation cannot be proved. Evidence: C:/Users/matth/AppData/Local/Temp/chorus-team-evaluation-eZaywb/cache-bug-pair3-lead-only.
- parallel-feature / 1 / team: Matched evaluation deadline reached before accepted completion. Evidence: C:/Users/matth/AppData/Local/Temp/chorus-team-evaluation-eZaywb/parallel-feature-pair1-team.
