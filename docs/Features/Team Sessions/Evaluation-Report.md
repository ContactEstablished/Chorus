# Phase 11 evaluation — 18 executions recorded

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
