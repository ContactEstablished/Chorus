# Phase 11 implementation progress — 2026-09-20

Current continuation window began **2026-09-20 23:46:50 UTC**, with a 2.5-hour cutoff of **2026-09-21 02:16:50 UTC**. Baseline `21580bda1c7c9c5aa11162dd23aadbf0f0f1f2c0`. The [first-window record](Implementation-Progress-Window-1.md) and [second-window record](Implementation-Progress-Window-2.md) are preserved separately. No changes were staged, committed, pushed or installed. The user's pre-existing version/package, terminal font and local configuration changes remain intact.

**Final handoff, 02:16 UTC:** implementation and verification work for this window is concluded. Final evidence audit checked 70 local links and all 17 retained JSON-artifact hashes; no broken links or mismatches were found. The final known-pattern secret scan passed. The remaining release work below is intentionally unfinished; this handoff does not mark Phase 11 complete.

**The Team workflow is implemented in the working tree and both leads pass complete development-window workflows. Phase 11 is not release-complete.** Tasks 11-1 through 11-3 passed their scoped gates. Production composition/UI, recovery and ownership hardening have substantial native and actual-window evidence. All 18 comparison executions are recorded, with an explicit protocol amendment and retained failures. The final packaged matrix remains blocked by Bitdefender quarantine. The existing 0.7.11 installer predates this feature; no new Team installer is certified.

## Current implementation

The [usage guide](Usage.md) describes launch choices, approvals, lifecycle controls and the currently verified model combinations.

- Main-owned TeamRuntime composes TeamService, TeamWorkspaceService, durable TeamStorage, SessionManager helpers, generation-scoped broker leases, selected credentials, native interactive leads and external MCP configuration. Boot excludes all Team leads from ordinary restore before reconciliation. Shutdown awaits Team cessation before closing storage.
- SQLite migration 25 adds the seven Team tables; migration 26 adds compare-and-set preset versions. Immutable launch configuration, payload-hash deduplication, entity versions and ordered events remain authoritative. Credentials stay encrypted at rest; plaintext is passed only in child environments and registered with the scrubber.
- Helpers use isolated managed worktrees. Code capture creates journaled single-parent immutable artifacts while preserving the real index and source checkout. Integration uses a separate staging worktree, exact prepared review, the selected approval policy, journal-before-effect and ff-only promotion. A separate integrated test review completes the task.
- New Team launch UI, roster/limits/policy selection, capability reasons, saved presets, history reopening, one lead pane, read-only helper activity, exact approval evidence and lifecycle controls use typed, validated, plain-object IPC. Closing a Team view detaches it. Ordinary restart/relaunch/kill/delete and workspace/project cleanup cannot bypass Team ownership.
- Recovery checks persisted process creation/executable identities, stops only proven owned orphans, validates private refs/commit parents/trees/manifests, reconciles proven artifact/preparation/promotion metadata, preserves dirty work, interrupts attempts without retrying and invalidates generation. Unknown identities or ambiguous Git evidence block replacement. Repeating reconciliation is idempotent.
- Explicit replacement verifies Claude workspace/conversation records or Codex exact stamped rollout ownership. Unverified pointers produce a visible new-conversation boundary and bounded retained-task handoff. Recovery-only leads cannot dispatch or integrate.

## Evidence

See [Compatibility-Report.md](Compatibility-Report.md), [Runtime-Verification.md](Runtime-Verification.md), [Integration-Verification.md](Integration-Verification.md), [Application-Verification.md](Application-Verification.md), [Recovery-Verification.md](Recovery-Verification.md), [Evaluation-Report.md](Evaluation-Report.md), and the [release audit](Release-Gate-Audit.md). Selected machine-readable reports are preserved in [Evidence/Window-3](Evidence/Window-3/README.md); full traces remain in the recorded disposable directories.

Most recent recorded checks are indexed in the [continuation roll-up](Evidence/Window-3/summary.json), also retained at `_verify/phase11-window3-summary.json`. The prior-window roll-up remains `_verify/phase11-final-summary.json`.

| Check | Actual result |
|---|---|
| Full Vitest suite | 108 files / 3,426 tests passed after the retired-identity correction, `_verify/phase11-window3-final-tests.log` |
| Typecheck / production build / secret grep | Passed after current production changes, `_verify/phase11-window3-final-build.log` and `_verify/phase11-window3-final-secrets.log` |
| Native storage/runtime/workspace/integration | 46 + 90 + 46 + 70 assertions, `%TEMP%/chorus-team-storage-ah7hG9/report.json` |
| Native process ownership/cancellation | 55 assertions, `%TEMP%/chorus-team-process-j6onRf/` and `_verify/phase11-window3-final-process.log` |
| Real process restart recovery | 278 assertions / 22 interruption scenarios, `%TEMP%/chorus-team-recovery-6fNTxl/report.json`, rerun after current production changes |
| Codex production flow | Passed delegation through accepted integrated tests, `%TEMP%/chorus-team-production-V2x2Mx/report.json` |
| Claude production flow | Passed the same flow, `%TEMP%/chorus-team-production-sw0jau/report.json` |
| Packaged Codex lifecycle | Passed bridge, panel, seven ownership guards, view detach, pause/resume/generation rotation and confirmed Stop, `%TEMP%/chorus-team-packaged-5LGqog/report.json` |
| Packaged Claude lifecycle | Same checks passed, `%TEMP%/chorus-team-packaged-I3DMWq/report.json` |
| Final full packaged workflows | Incomplete: Bitdefender quarantined the test executable, bridge and temporary SQLite journals. Confirmed read-only metadata in `_verify/phase11-antivirus-evidence.json`; details in Application-Verification.md |

Failures and limitations are retained in the detailed reports. Functional/runtime checks do not establish lower cost/time. The separate comparative report found more elapsed time and lead-token usage on these small Team fixtures; complete Team totals and subscription dollars remain unknown.

## Remaining release work

1. Resolve the confirmed Bitdefender quarantine for `_verify/team-packaged-window-final/win-unpacked/Chorus.exe` and its bridge, then repeat the final packaged both-lead/policy matrix before releasing an installer. The current development-window matrix passes; it does not substitute for the packaged gate.
2. Retain the verification limits: native access denial was injected around a real orphan; credential rotation stubs the final replacement-lead launch; attempt-exhaustion presentation uses deterministic core transitions; Neo4j coexistence probes the installed MCP package through production Team composition, not the main-app memory-registration/indexing callback. Complete any stricter release verification required by the task specifications.
3. All 18 comparisons are recorded: code acceptance 9/9 solo and 8/9 Team; accepted code with confirmed cleanup 8/9 each. Median elapsed times were 49.7s and 230.2s. The amendment after execution five, uncontrolled background load and incomplete cost coverage prevent a controlled single-build certification. A clean controlled rerun is still needed to meet that stricter evaluation claim. Later guidance/UI/disposal changes are outside the comparison bundles.
4. Preserve unrelated staged/unstaged work, review the feature changes intentionally, and prepare a release/version/installer only after the remaining gates pass. The development timebox is not phase completion. `git diff --check` still reports the pre-existing terminal-font line's trailing whitespace; that unrelated edit was preserved.

## Upstream handoffs made by final integration

Task 11-4 required a main-only `teamLaunchArgs` SessionManager seam: ordinary `extraArgs` supplies argument-level precedence and does not append arbitrary MCP/model arguments. Live CLI evidence caught and corrected that distinction. Required Team instructions now fail closed; Team launches disable ordinary silent resume fallback.

Task 11-5 adds complete immutable artifact metadata to the pre-ref capture journal, exact ownership CRUD guards, persisted lead cessation, shared lead-stop operations to prevent replacement races, conversation ownership verification, read-only bounded helper activity and separate approval-wait display. Process inspection reports identity mismatch as uncertainty; post-signal identity inspection decides cessation even when a child exits during the signal command. None of these changes add dependencies or alter global Git/CLI configuration. Native trust acceptance was limited to disposable verification workspaces.

Final hardening also rejects older processes attached to recycled parent IDs and rechecks observed identities before returning ownership. Resume/Recover inspects dirty/ambiguous work before stopping the current lead, so an invalid replacement request leaves the recovery lead available. Corrupt history appears as an unavailable run alongside healthy history; it cannot retain stale actionable state in the renderer. Claude resume additionally requires a conversation ID actually assigned by that run's launch journal.

The final IPC regressions cover a version change during asynchronous recovery inspection and refusal to replace a lead whose cessation is unknown. After the interrupted packaged tests, all six recorded lead/helper process groups were inspected using creation/executable identity; none remained alive or uncertain (`_verify/phase11-fixture-cessation.json`). Read-only Bitdefender evidence records `Atc4.Detection`; its exact trigger still requires investigation. No quarantine restoration or security-setting changes were made.

The prior development window ended at 23:45:38 UTC. The user subsequently authorized continued Phase 11 work. After the user reported adding a Bitdefender exception, rebuilt packaged workflows were attempted again; fresh quarantine records still name the test executable, bridge and test database journals at 23:51–23:52 UTC. This was reported to the user. Packaged reruns stopped pending an external change; independent development-window verification and the amended evaluation subsequently completed.

## Earlier continuation history

The following records retain earlier attempts. The current results in [Application-Verification.md](Application-Verification.md) supersede these intermediate statuses: the latest Claude workflow needed no extra terminal guidance, and the latest mixed subscription/API roster passed acceptance and confirmed cleanup.

The full Claude development-app ask-policy workflow passed at `%TEMP%/chorus-team-development-HP0xx8/report.json`, including approval through the visible panel, stale approval refusal, renderer reload, integrated verification, Pause/Resume and confirmed Stop. Controller guidance was required and is disclosed in Application-Verification.md. A mixed subscription/API production pilot passed its two-module acceptance suite but failed cleanup on an earlier frozen bundle; it is not a complete lifecycle pass.

The formal 18-run evaluation began at 00:42:27 UTC in `%TEMP%/chorus-team-evaluation-eZaywb`. Its manifest records implementation/fixture bundle hashes, starting revisions and order. After execution five, the retained cleanup failure exposed a previously retired descendant PID reused by an unrelated browser. The implementation and baseline verifier were corrected; the remaining executions resumed under a recorded amendment with a second bundle. No execution was discarded or repeated. Fixtures, configurations, order and deadlines remain fixed, but this is exploratory functional evidence across two builds, not a controlled single-build performance benchmark. Background development and native checks also leave machine load uncontrolled. Pilots are excluded, complete Team cost is unknown, and controller inputs are not human participation.

Continuation hardening preserves unknown process reservations until positive follow-up evidence; late confirmation lets Pause/Stop drain without promoting failed attempts. Windows batch termination now continues after an individual child exit race. Lead shutdown records failure stage, and bounded reinspection distinguishes native teardown from PTY exit. Expanded restart tests cover credential mutations and explicit Resume authorization; the rotated-credential test stubs only the final lead-spawn boundary.
