# Phase 11 implementation progress — 2026-09-20

Development window authorized by the user: **17:53:48–20:23:48 UTC (2.5 hours)**. Baseline `21580bda1c7c9c5aa11162dd23aadbf0f0f1f2c0`. Changes remain in the shared working tree; nothing was staged, committed, pushed or installed by this implementation session.

**The feature is not complete or available in the application yet.** Tasks 11-1 and 11-2 passed their scoped gates. Task 11-3 is partially implemented. Tasks 11-4 and 11-5 have not started. The existing 0.7.11 installer predates this implementation and does not expose Team Sessions.

## Completed gates

- Council run and disposition recorded, including its partial-run limitation and adopted amendments.
- Task 11-1: real Claude and Codex interactive leads coordinated concurrent helpers through the facade. Claude/Codex subscription helpers and an opencode/OpenRouter API helper passed the measured combinations, including revision, native permissions and cancellation. Exact version/model/auth gating keeps unverified combinations disabled. See [Compatibility-Report.md](Compatibility-Report.md).
- Task 11-2: strict shared contracts, transactional migration/storage, pure scheduling/lifecycle, SessionManager-owned helper processes, run-scoped broker/leases and the injected TeamService. See [Runtime-Verification.md](Runtime-Verification.md).

## Task 11-3 implemented so far

`teamWorkspaceCore.ts` implements capture eligibility, exact-content prepared review and user approval, promotion preconditions, recovery classification, and final integrated verification with command/outcome/revision/context/source/provenance evidence. Pure functions do not perform Git effects or substitute for the missing integration service.

`GitWorktreeManager.createManagedWorktree` shares journal/creation mechanics with ordinary worktrees, validates project/repository/commit identity, reserves team ownership before Git effects, and creates a sessionless retained workspace. Authorization is checked before and after creation. Managed failures retain the chosen identity; they do not silently allocate a replacement workspace after an ownership reservation. Ordinary creation keeps its existing collision-retry behavior.

`teamWorkspaceService.ts` implements integration-workspace preparation, isolated attempt preparation, analysis result validation and journaled code capture. It consumes the existing connection through TeamStorage. Its capture path reserves the existing attempt/capture/ref identity, creates objects, journals intended SHAs, publishes a create-if-absent private ref, then publishes immutable metadata. No-change captures are explicit immutable results and do not claim an applied artifact. Concurrent capture calls share one in-flight operation.

Typed wrappers in `git.ts` resolve committed revisions safely, inspect status/ancestry, create squashed single-parent artifact objects using two independent temporary indexes, and publish an idempotent immutable artifact ref. They preserve the helper's real index and source checkout. Service identity and the capture timestamp determine commits; configured developer identity is not required. NUL-delimited manifests preserve filenames. Unresolved index entries and submodules fail closed. Dirty source content is never copied. Repository clean filters can execute under Git; worktree isolation is not an OS sandbox.

## Verification and limitations

- Full suite: **103 files / 3,402 tests passed**. Node/renderer typecheck, production build and secret grep passed.
- Native Electron verifier: **40 storage + 59 coordinator + 46 workspace assertions**. Electron 43.1.1 / Node 24.18.0 / SQLite 3.53.1. This uses disposable repositories/databases, not the installed application database.
- Separate native process verifier: 40 assertions; facade fixture: 57 assertions. Live model evidence is linked above.
- Real Git tests cover intermediate helper commits plus final dirty content, binary/renamed/deleted/nonignored untracked/Unicode/leading-dash files, ignored-file exclusion, service author identity, unresolved indexes, no-change results, real-index preservation and exact source-dirt preservation.
- Native workspace tests cover durable ownership before filesystem effects, clean committed bases despite dirty source, rejected analysis edits, no-change immutability, and retries after each capture reservation/object/ref/metadata boundary. Assertions also cover revocation before Git creation and retained journal rows.
- Initial workspace verifier failures (incorrect project-result destructuring and a Windows CRLF assumption) were fixture defects and were corrected. The same destructuring fix corrected an earlier ineffective upgrade-preservation assertion; the final verifier checks an actual project ID. Failed evidence directories remain available rather than being represented as passes.
- Repository-wide `git diff --check` reports the pre-existing TerminalPane font-line whitespace. It was preserved. No new dependency, global Git setting or global CLI configuration was added.

Latest passing native evidence: `%TEMP%/chorus-team-storage-Tq80oa`. Current evidence is in `%TEMP%/chorus-team-storage-*` (each has report.json or failure.json), `%TEMP%/chorus-team-process-xJNw1Q`, `%TEMP%/chorus-team-compat-7Sbuif`, and the live evidence directories named in the compatibility report. Current static/full-suite logs are under ignored `_verify/phase11-*.log`.

## Resume here

1. Finish **11-3**: staging creation and cherry-pick preparation; durable integration intents; artifact/prepared/integrated review service methods; exact renderer approval decisions; per-run serialization and cooperative lead write lease; hook-controlled ff-only promotion; post-effect reconciliation; recovery inspection implementation. Wire these through the existing optional workspace protocol hooks. `TeamWorkspaceService` currently supplies creation/capture only and is not yet a complete `TeamServiceDependencies.workspace` implementation.
2. Complete the remaining **11-3** fixtures: simultaneous artifacts/conflicts, dirty/racing integration preservation, unsupported submodule cases, defensive restoration of attributed legacy launch configuration, all promotion/crash boundaries, owned-ref recovery enumeration, and no-change code acceptance against the current integration revision. Current eligible launch configuration must remain external to worktrees.
3. Implement **11-4** production composition, external lead instructions/config, typed plain-object IPC, launch/presets, Team panel and approval UI, packaged native-Node facade path, and awaited shutdown. Bind team-lead restore exclusion before ordinary restoration. Preserve the existing terminal font/version edits.
4. Implement **11-5** recovery ordering, destructive CRUD guards, real dev/packaged app checks and **all 18 comparative evaluation runs**. No quality, time or cost improvement is claimed before those measurements.

Upstream ownership corrections recorded during 11-3: TeamStorage now closes capture reservations through a dedicated immutable no-change event and prevents later conversion into an artifact; normal Resume rejects retained dirt. Keep these contracts when completing integration/recovery. Do not restart completed compatibility work unless the installed version/model/auth route changes.

Final process hardening: cancellation does not signal a child if its durable intent callback fails. The error is surfaced to its owner, the process remains a retained blocker, and an explicit retry can proceed when the journal is available. The native verifier includes this failure and retry. Git status uses disabled optional locks so validation preserves the real helper index byte-for-byte.

Final verification snapshot: native report `chorus-team-storage-Tq80oa` at 20:22:18 UTC passed 40 storage, 59 coordinator and 46 workspace assertions; the subsequent production build passed. The final cancellation verifier `chorus-team-process-xJNw1Q` passed 40 assertions. The historical council brief contains embedded pre-implementation exhibits; their original status labels and relative links are retained as review evidence, not current execution status.
