# Phase 11 release continuation — 2026-09-21

User objective: complete the remaining Phase 11 release work, with a 2.5-hour limit. Window starts 10:20:17 UTC and ends 12:50:17 UTC. Previous goal work produced implementation and verification evidence; this window revalidates remaining release gates rather than redefining completion.

The [criterion-by-criterion audit](Acceptance-Audit.md) preserves the full task scope. Selected [machine-readable evidence](Evidence/Window-4/README.md) is retained in the repository.

**Update after 12:00 UTC:** The user disabled Advanced Threat Defense and authorized recreation. The 0.7.12 package and installer were restored, a recovery-instruction conflict was corrected, and packaged checks resumed. Protection-enabled compatibility remains unverified. See the [restoration record](Release-Restoration.md) for current results and the superseding installer hash.

**Historical handoff at 11:48 UTC:** the available independent release checks are complete at the scope recorded below. The final known-pattern secret scan passed; 107 local documentation links and 36 retained report hashes passed inspection. Five development fixtures have verified closed database state, and the owned Neo4j test container is stopped. No verification/model job remains intentionally active. The 2.5-hour limit has not expired; further packaged work is held by the fresh Bitdefender interruption, pending the requested clarification or an external protection-state change. Phase 11 remains in progress.

## Initial state before restoration

The working tree is based on `21580bda1c7c9c5aa11162dd23aadbf0f0f1f2c0`. Existing user configuration, staged package changes and terminal-font edits are preserved. Release preparation advances only package and lockfile version fields from 0.7.11 to **0.7.12**, without dependency changes. Nothing is installed, staged, committed or pushed by this continuation.

| Gate | Current evidence |
|---|---|
| Build and full suite | Production typechecks/build passed; 108 Vitest files / 3,426 tests passed. `_verify/phase11-window4-build.log`, `_verify/phase11-window4-tests.log`. |
| Installed CLI versions | Claude 2.1.278, Codex 0.155.1, opencode 1.18.31 still match measured eligibility. |
| Installer candidate | `release/Chorus Setup 0.7.12.exe` built successfully. SHA-256 `614B2D117F2176C60A1D503C6E1416F6E81413A8D2E3D0214F0C16EE15550FC2`. Candidate status only; final packaged flows have not passed. |
| Packaged Claude ask / Codex lead-integrates | Rebuilt source package started both workflows. Fresh quarantine interrupted them before completion reports. Evidence `%TEMP%/chorus-team-packaged-pBlTpE` and `%TEMP%/chorus-team-packaged-hBDHC6`; neither is a pass. |
| Post-interruption process ownership | Four recorded lead/helper groups inspected. One lead group still had three positively identified processes; fixture retirement intent was written, those identities stopped, and all four groups then proved absent. `_verify/phase11-window4-fixture-cessation.json` and `phase11-window4-fixture-retirement.jsonl`. |
| Main-app memory callback | Passed both leads through the actual built main application: native bridge active, real `AgentSession` graph registration with correct project/model and `writtenVia: app`, then confirmed Stop. `%TEMP%/chorus-team-memory-app-WkUH8F/report.json`, 10:36:55 UTC. Separate test-owned Neo4j container on loopback port 17693, now stopped with graph evidence retained. No user graph was involved. This does not exercise graph indexing. The earlier fixture timeout was a trust-screen parser issue; its failure remains retained. |
| Controlled evaluation | Fresh `--controlled` batch `chorus-team-evaluation-91NHs8` started at 10:37:52 UTC with one frozen bundle/bridge, source hashes and CLI version checks before/after each execution, sequential runs and recorded CPU/memory observations. No concurrent builds or model tests during measured runs. `_verify/phase11-window4-evaluation.log`. All 18 executions completed, on one bundle without amendments: Team 9/9, lead-only 8/9 with one retained native-permission timeout; all 18 confirmed cleanup. Median elapsed times: 193.9s Team, 50.8s lead-only. Validation checked 73 source hashes and all per-run bundle identities. [Full report](Evaluation-Report.md). |

The additional real-window checks passed: Claude/Codex helper under lead-integrates, Codex/Claude helper under ask, and a Claude lead with concurrent Claude subscription/opencode API helpers under ask. Both leads passed keyboard input with the Team panel collapsed and expanded. Independent final tests checked clean committed HEADs and unchanged test blobs. The Codex ask and mixed-auth runs each needed one recorded controller clarification after the fixture requested unsupported helper command arguments; failed attempts remain visible. [Application results and limitations](Application-Verification.md).

The final source secret scan and verifier typecheck passed. Read-only post-exit inspection of five development fixtures confirms stopped runs, exited leads and confirmed attempt cessation. Earlier CRLF and pre-launch verifier errors remain retained in [verifier corrections](Evidence/Window-4/verifier-corrections.json).

## Antivirus evidence

The user reported briefly disabling Bitdefender and authorized recreation of missing files. Both source package rebuild and NSIS creation succeeded. Native quarantine metadata subsequently recorded `Atc4.Detection` for the test executable, bridge and disposable database journals at 10:25:53 and 10:26:28 UTC. Read-only extraction is `_verify/phase11-window4-antivirus.json`. The package files disappeared and the verifier jobs ended without completion reports; shell exit status alone is not acceptance.

No security settings or quarantined files were restored or changed by the assistant. Further packaged retries await clarification or an external protection-state change. The exact behavior triggering the detection is unknown; it is not proved to be a false positive. Bitdefender documents a separate behavior-monitoring exception switch in [Advanced Threat Defense](https://www.bitdefender.com/consumer/support/answer/2393/), which may explain the difference from an antivirus-only toggle.

## Acceptance audit at the earlier handoff

Complete the packaged both-lead/policy and cross-provider matrix, retain existing native recovery/credential/ordinary-session evidence at its actual scope, retain the now-passing real-main-app memory registration evidence, retain the completed 18-run comparison and installer-content verification, and update the roadmap only after those requirements are proven. The original amended comparison remains historical evidence; no run or failure will be discarded.
