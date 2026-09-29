# Packaged restoration and recovery correction — 2026-09-21

**Subsequent user-requested retry, 12:52–13:01 UTC:** the restored files and installer remained intact, and all 84 recorded source/verifier files were unchanged. Normal Codex ask integration and independent acceptance passed again, but the recovery checkpoint again timed out while an owned GitKraken blocking hook was running. Cleanup completed. See the [separate retry evidence](Evidence/Restore-Retry-2026-09-21/README.md); this execution is outside the original timebox and the 18-drive counts below.

The user reported disabling Advanced Threat Defense and explicitly requested recreation of the missing files before rebooting. Work resumed at 12:00 UTC within the existing 12:50:17 UTC cutoff. The assistant changed no protection settings, restored no quarantine entries, and did not install Chorus or touch the installed user profile.

The test package was rebuilt at `_verify/team-packaged-window-final/win-unpacked/Chorus.exe`. Its executable, bridge and application archive initially matched the 10:25 installer candidate. Seven packaged checks passed with clean app exits: Claude ask with two concurrent subscription/API helpers; Codex lead-integrates with ordinary presets; Claude lead-integrates with a Codex helper; shutdown during a running helper; shutdown during integration apply; activation timeout/visible Retry; and a new packaged UI/memory check covering both-lead presets, stale preset refusal/reload, exhausted history, ordinary credential restore refusal and real graph registration for both leads. History uses three deterministic preparation failures, not three native model executions. Graph indexing is outside the memory check.

The eighth drive completed Codex ask integration and independent acceptance, but failed its later recovery checkpoint. The native Codex lead correctly refused to violate the generated instruction “Pausing/recovery permit inspection only.” That wording conflicted with the feature contract allowing explicit user-directed checkpoints in a recovery-only lead. The failed execution remains retained; it is not a full workflow pass.

`teamInstructionsCore.ts` now distinguishes inspection-only Team MCP authority from an explicitly user-authorized local Git checkpoint through the lead terminal. The recovery lead must preserve contents, stage/commit only authorized retained files, refrain from delegation/integration, and wait for explicit user Resume. Runtime tool permissions and recovery guards were not widened. The existing instruction regression test now checks this distinction. A verifier assertion was also corrected to require an unchanged set of helper-attempt IDs during recovery, rather than assuming the run had no earlier attempts.

The corrected build passed production typechecks and all **108 files / 3,426 tests**. NSIS was rebuilt at 12:15 UTC. The original full-suite result and controlled evaluation remain retained at their original build identities; the 18-run comparison predates this wording correction and was not rerun or amended.

The first unpacked rebuild after the correction hit `EPERM` on `dxil.dll` while the earlier bounded recovery test still held the executable open. It was retried successfully after that test exited. This file-lock failure is distinct from the earlier quarantine records.

## Current artifact

- Installer: `release/Chorus Setup 0.7.12.exe`, 120,002,546 bytes.
- SHA-256: `1d2d121b81ed8f998243e099a7a1c289d83adcdadfecc4d002236af1eef899b9`.
- Application archive SHA-256: `1b904e497ec9b50d4a057e126497d0c6626f14fe65579aeea221faf2e9da7975`.
- The installer is unsigned and has not been installed by this continuation.

Corrected-payload results and exact scope are retained in the [restored evidence index](Evidence/Window-4/Restored/README.md). The corrected Claude recovery-only drive passed: dirty Resume refusal, visible Recovery-only state, exact retained-file checkpoint, explicit Resume with generation rotation, and confirmed Stop. The corrected Codex recovery drive completed its normal reviewed integration and independent acceptance, then timed out before its checkpoint. Its terminal showed `Running hook`; read-only process inspection identified a positively owned `gk.exe` child from the installed GitKraken CLI. The note remained unchanged and untracked. This establishes the observed wait, not the hook's internal cause. No global hook setting was changed or bypassed. The app subsequently exited cleanly through the verifier's failure cleanup.

## Corrected-payload results

| Packaged check | Result |
|---|---|
| Claude ask, concurrent Claude subscription/opencode API helpers | [Passed](Evidence/Window-4/Restored/final-claude-mixed-report.json): peak two native helpers, both independent acceptance tests, exact approval/reload/stale refusal, keyboard and lifecycle. |
| Claude lead-integrates, Codex helper | [Passed](Evidence/Window-4/Restored/final-claude-integrates-report.json): independent committed-head acceptance, keyboard and lifecycle. |
| Codex lead-integrates, Claude helper | [Passed](Evidence/Window-4/Restored/final-codex-integrates-report.json): independent acceptance, keyboard, lifecycle and actual Solo/Pair/Workbench/Swarm regression. |
| Codex ask, Claude helper | [Passed](Evidence/Window-4/Restored/final-codex-ask-clean-report.json): exact approval/reload/stale refusal, independent acceptance, keyboard and ordinary Pause/Resume/Stop. |
| Saved presets, exhausted history, credential refusal, real memory registration | [Passed](Evidence/Window-4/Restored/final-packaged-ui-report.json) for both lead selections where applicable; no injected memory callback. |
| Bridge timeout and visible activation Retry | [Passed](Evidence/Window-4/Restored/final-retry-report.json) using a fresh untrusted source fixture. |
| Close during native helper execution | [Passed](Evidence/Window-4/Restored/final-quit-helper-report.json), shutdown and cessation confirmed. |
| Close during integration apply | [Passed](Evidence/Window-4/Restored/final-quit-apply-report.json), applying state observed, journal retained and shutdown confirmed. |
| Claude dirty-work recovery-only checkpoint | [Passed](Evidence/Window-4/Restored/final-claude-recovery-report.json), followed by explicit Resume and Stop. |
| Codex dirty-work recovery-only checkpoint | [Timed out](Evidence/Window-4/Restored/final-codex-ask-failure.json) while the native CLI displayed a hook wait; preceding normal integration and independent acceptance passed. This run is not counted as a full pass. |

The restored evidence contains **18 packaged drives: 16 full passes and two retained recovery failures**, split into the initial restored payload (7/8) and corrected payload (9/10). These are compatibility drives, not the separate 18-run controlled evaluation. Every app exited with code 0, including failure cleanup. A read-only [closure audit](Evidence/Window-4/Restored/app-closure.json) verifies all 22 retained runs stopped and leads exited across the 18 disposable profiles; two runs are explicitly identified as seeded, process-free history fixtures. Native attempts have confirmed cessation. The closure auditor initially assumed unspawned fixture failures used `not-started`; the core deliberately settles them as `confirmed`. The auditor was corrected to check their null process identity and deterministic preparation-failure marker, without changing product state.

The test-owned Neo4j container is stopped. The final known-pattern source secret scan and verifier typecheck passed. The installer payload identity and 84 source/verifier file hashes are retained in [source and payload audit](Evidence/Window-4/Restored/source-and-payload.json). No extra controller guidance was sent to the final native workflows beyond the verifier's recorded fixture prompts, workspace trust, scoped native approvals and Team-panel actions.

Phase 11 is not marked complete: the Codex recovery checkpoint remains unverified in this environment. Compatibility with Advanced Threat Defense enabled also remains unverified; successful disabled-protection runs do not establish that the original detection was a false positive. The installer is available for user testing, with these limits recorded.
