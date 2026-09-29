# Phase 11 implementation progress — 2026-09-20

Closed authorized development window: **21:15:38–23:45:38 UTC (2.5 hours)**. Baseline `21580bda1c7c9c5aa11162dd23aadbf0f0f1f2c0`. The [first-window record](Implementation-Progress-Window-1.md) is preserved separately. No changes were staged, committed, pushed or installed. The user's pre-existing version/package and terminal font changes remain intact.

**The Team workflow is implemented in the working tree and has run with both Claude and Codex leads. Phase 11 is not release-complete.** Tasks 11-1 through 11-3 passed their scoped gates. Task 11-4 production composition/UI is implemented with substantial native and packaged evidence. Task 11-5 recovery and ownership hardening are implemented in part; the remaining release matrix and all 18 matched evaluation executions are outstanding. The existing 0.7.11 installer predates this feature. The latest isolated verification package was built successfully, then its executable and bridge were quarantined by Bitdefender during workflow testing; it is not a runnable release.

## Current implementation

- Main-owned TeamRuntime composes TeamService, TeamWorkspaceService, durable TeamStorage, SessionManager helpers, generation-scoped broker leases, selected credentials, native interactive leads and external MCP configuration. Boot excludes all Team leads from ordinary restore before reconciliation. Shutdown awaits Team cessation before closing storage.
- SQLite migration 25 adds the seven Team tables; migration 26 adds compare-and-set preset versions. Immutable launch configuration, payload-hash deduplication, entity versions and ordered events remain authoritative. Credentials stay encrypted at rest; plaintext is passed only in child environments and registered with the scrubber.
- Helpers use isolated managed worktrees. Code capture creates journaled single-parent immutable artifacts while preserving the real index and source checkout. Integration uses a separate staging worktree, exact prepared review, the selected approval policy, journal-before-effect and ff-only promotion. A separate integrated test review completes the task.
- New Team launch UI, roster/limits/policy selection, capability reasons, saved presets, history reopening, one lead pane, read-only helper activity, exact approval evidence and lifecycle controls use typed, validated, plain-object IPC. Closing a Team view detaches it. Ordinary restart/relaunch/kill/delete and workspace/project cleanup cannot bypass Team ownership.
- Recovery checks persisted process creation/executable identities, stops only proven owned orphans, validates private refs/commit parents/trees/manifests, reconciles proven artifact/preparation/promotion metadata, preserves dirty work, interrupts attempts without retrying and invalidates generation. Unknown identities or ambiguous Git evidence block replacement. Repeating reconciliation is idempotent.
- Explicit replacement verifies Claude workspace/conversation records or Codex exact stamped rollout ownership. Unverified pointers produce a visible new-conversation boundary and bounded retained-task handoff. Recovery-only leads cannot dispatch or integrate.

## Evidence

See [Compatibility-Report.md](Compatibility-Report.md), [Runtime-Verification.md](Runtime-Verification.md), [Integration-Verification.md](Integration-Verification.md), [Application-Verification.md](Application-Verification.md), and [Recovery-Verification.md](Recovery-Verification.md).

Most recent recorded checks at this update (machine-readable roll-up: `_verify/phase11-final-summary.json`):

| Check | Actual result |
|---|---|
| Full Vitest suite | 108 files / 3,426 tests passed, `_verify/phase11-final-tests.log`; earlier channel-count failures were corrected for the ten added Team channels |
| Typecheck / production build / secret grep | Passed after the final production hardening, `_verify/phase11-final-build.log` and `_verify/phase11-final-secrets.log` |
| Native storage/runtime/workspace/integration | 46 + 67 + 46 + 70 assertions, `%TEMP%/chorus-team-storage-Yd5wmX/report.json` |
| Native process ownership/cancellation | 40 assertions, `%TEMP%/chorus-team-process-QqlEnG/` and `_verify/phase11-final-process.log` |
| Real process restart recovery | 149 assertions / 13 interruption scenarios, `%TEMP%/chorus-team-recovery-FncDUL/report.json` |
| Codex production flow | Passed delegation through accepted integrated tests, `%TEMP%/chorus-team-production-V2x2Mx/report.json` |
| Claude production flow | Passed the same flow, `%TEMP%/chorus-team-production-sw0jau/report.json` |
| Packaged Codex lifecycle | Passed bridge, panel, seven ownership guards, view detach, pause/resume/generation rotation and confirmed Stop, `%TEMP%/chorus-team-packaged-5LGqog/report.json` |
| Packaged Claude lifecycle | Same checks passed, `%TEMP%/chorus-team-packaged-I3DMWq/report.json` |
| Final full packaged workflows | Incomplete: Bitdefender quarantined the test executable, bridge and temporary SQLite journals. Confirmed read-only metadata in `_verify/phase11-antivirus-evidence.json`; details in Application-Verification.md |

Failures and limitations are retained in the detailed reports. These are functional/runtime checks, not comparative evaluations or evidence of lower cost/time. Subscription dollars and missing usage remain unknown.

## Remaining release work

1. Investigate the confirmed Bitdefender quarantine before repeating packaged tests or releasing an installer. Finish the real application matrix: mixed subscription/API roster through the production composition, both policies through renderer approval controls, recovery-only dirty-work interaction, active-helper/integration quit races, invalid/stale approval UI, attempt exhaustion, and regression drives of ordinary Solo/Pair/Workbench/Swarm. Existing native/pure fixtures cover several rules but do not replace those application-level rows.
2. Complete recovery fault coverage for all prescribed boundaries, including selected credential/provider changes across restart and inaccessible/unverifiable native process information. Reserved capture objects without a published ref or sufficient immutable metadata remain conservatively blocked; no new ref/object is guessed or replayed.
3. Freeze three representative fixtures and execute the required 18 lead-only versus Team comparisons. Publish every result, including failures/censoring, human interventions, lead/helper/total usage and cost coverage. No performance claim is supported yet.
4. Run final checks, audit all task criteria, then prepare an intentional release/version/installer after the release gate is satisfied. Do not certify the phase merely because the development timebox ends.

## Upstream handoffs made by final integration

Task 11-4 required a main-only `teamLaunchArgs` SessionManager seam: ordinary `extraArgs` supplies argument-level precedence and does not append arbitrary MCP/model arguments. Live CLI evidence caught and corrected that distinction. Required Team instructions now fail closed; Team launches disable ordinary silent resume fallback.

Task 11-5 adds complete immutable artifact metadata to the pre-ref capture journal, exact ownership CRUD guards, persisted lead cessation, shared lead-stop operations to prevent replacement races, conversation ownership verification, read-only bounded helper activity and separate approval-wait display. Process inspection reports identity mismatch as uncertainty; post-signal identity inspection decides cessation even when a child exits during the signal command. None of these changes add dependencies or alter global Git/CLI configuration. Native trust acceptance was limited to disposable verification workspaces.

Final hardening also rejects older processes attached to recycled parent IDs and rechecks observed identities before returning ownership. Resume/Recover inspects dirty/ambiguous work before stopping the current lead, so an invalid replacement request leaves the recovery lead available. Corrupt history appears as an unavailable run alongside healthy history; it cannot retain stale actionable state in the renderer. Claude resume additionally requires a conversation ID actually assigned by that run's launch journal.

The final IPC regressions cover a version change during asynchronous recovery inspection and refusal to replace a lead whose cessation is unknown. After the interrupted packaged tests, all six recorded lead/helper process groups were inspected using creation/executable identity; none remained alive or uncertain (`_verify/phase11-fixture-cessation.json`). Read-only Bitdefender evidence records `Atc4.Detection`; its exact trigger still requires investigation. No quarantine restoration or security-setting changes were made.

The 2.5-hour development window ended at 23:45:38 UTC. Implementation stops at this timebox; Phase 11 remains incomplete for the explicitly listed release gates. The next work starts with the packaging detection investigation and remaining application verification, then the 18 matched evaluation executions.
