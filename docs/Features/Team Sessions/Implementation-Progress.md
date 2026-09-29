# Phase 11 implementation progress — 2026-09-21

**Team Sessions is implemented; Phase 11 remains in release verification.** The current window runs from 10:20:17 to 12:50:17 UTC. Version **0.7.12** has a rebuilt NSIS installer candidate with a corrected recovery instruction. Packaged checks now run after the user disabled Advanced Threat Defense. The user disabled Advanced Threat Defense and authorized recreation. The 0.7.12 package and installer were restored, a recovery-instruction conflict was corrected, and packaged checks resumed. Protection-enabled compatibility remains unverified. See the [restoration record](Release-Restoration.md) for current results and the superseding installer hash.

At the historical 11:48 UTC handoff, the additional development-app checks, fixed-build comparison, secret scan and retained-evidence audit are complete at their recorded scope. That interruption was subsequently bypassed by the user changing protection state; the restoration record contains the subsequent evidence. The timebox has not expired, and Phase 11 has not been marked complete.

The [release window record](Release-Window-4.md), [criterion-by-criterion acceptance audit](Acceptance-Audit.md), and [release gate audit](Release-Gate-Audit.md) identify the exact remaining work. Nothing has been staged, committed, pushed or installed during this continuation. Existing user configuration, staged package changes and terminal-font edits are preserved; only the authorized package version fields advanced from the preceding working-tree version.

## Current implementation

The [usage guide](Usage.md) describes launch choices, approvals, lifecycle controls and the currently verified model combinations.

- Main-owned TeamRuntime composes TeamService, TeamWorkspaceService, durable TeamStorage, SessionManager helpers, generation-scoped broker leases, selected credentials, native interactive leads and external MCP configuration. Boot excludes all Team leads from ordinary restore before reconciliation. Shutdown awaits Team cessation before closing storage.
- SQLite migration 25 adds the seven Team tables; migration 26 adds compare-and-set preset versions. Immutable launch configuration, payload-hash deduplication, entity versions and ordered events remain authoritative. Credentials stay encrypted at rest; plaintext is passed only in child environments and registered with the scrubber.
- Helpers use isolated managed worktrees. Code capture creates journaled single-parent immutable artifacts while preserving the real index and source checkout. Integration uses a separate staging worktree, exact prepared review, the selected approval policy, journal-before-effect and ff-only promotion. A separate integrated test review completes the task.
- New Team launch UI, roster/limits/policy selection, capability reasons, saved presets, history reopening, one lead pane, read-only helper activity, exact approval evidence and lifecycle controls use typed, validated, plain-object IPC. Closing a Team view detaches it. Ordinary restart/relaunch/kill/delete and workspace/project cleanup cannot bypass Team ownership.
- Recovery checks persisted process creation/executable identities, stops only proven owned orphans, validates private refs/commit parents/trees/manifests, reconciles proven artifact/preparation/promotion metadata, preserves dirty work, interrupts attempts without retrying and invalidates generation. Unknown identities or ambiguous Git evidence block replacement. Repeating reconciliation is idempotent.
- Explicit replacement verifies Claude workspace/conversation records or Codex exact stamped rollout ownership. Unverified pointers produce a visible new-conversation boundary and bounded retained-task handoff. Recovery-only leads cannot dispatch or integrate.


## Current verification

- Production typechecks/build and the complete suite passed: **108 files / 3,426 tests**. The main/preload and all renderer assets checked in the packaged archive match the build (72 files); the external Team bridge matches its source.
- Both native leads passed real-main-app memory registration in an isolated Neo4j graph and confirmed Stop. The separate earlier installed-MCP checks cover memory/Team tool coexistence. Graph indexing was not exercised by these checks.
- The fresh 18-execution comparison completed sequentially with one frozen bundle, bridge, source hashes and CLI-version checks: Team passed 9/9, lead-only passed 8/9 with one retained permission-related timeout, and all runs confirmed cleanup. Median elapsed times were 193.9 seconds for Team and 50.8 seconds for lead-only. No complete cost or human-attention savings claim is supported.
- Both leads passed keyboard input in both Team-panel states. Additional full development-app workflows passed for Claude with a Codex helper under lead-integrates, Codex under ask, and a two-helper mixed subscription/API roster under ask. Each performed independent final-result verification and confirmed Stop. The latter two runs retain command-permission failures and one controller clarification each.
- Fresh `Atc4.Detection` records at 10:25–10:26 UTC explain the missing rebuilt test executable/bridge and interrupted package fixtures. Their surviving positively identified processes were retired, and all four recorded groups then proved absent. Subsequent packaged retries proceeded after the user disabled Advanced Threat Defense; the initial failures remain historical evidence.

Selected reports are retained in [Evidence/Window-4](Evidence/Window-4/README.md). The passing native storage/runtime/workspace/integration assertions (46/90/46/70), 55 process assertions, and 278 assertions across 22 real restart scenarios remain historical evidence at their original scope in [Evidence/Window-3](Evidence/Window-3/README.md). After the initial source-continuity check, one production instruction module and its existing regression test changed to permit explicit user-authorized recovery checkpoints while keeping Team MCP inspection-only. The corrected build passed the full suite; earlier reports retain their original source identities.

## Remaining release work

Audit the corrected-payload packaged results in the restoration record; an enabled-protection installation remains outside the completed checks. The source secret scan and verifier typecheck passed; retained evidence and links are audited separately. Update roadmap completion only when every required criterion passes. A successful installer build or an expired timebox does not establish completion.

## Earlier windows and detailed reports

The [first](Implementation-Progress-Window-1.md), [second](Implementation-Progress-Window-2.md), and [third](Implementation-Progress-Window-3.md) window records preserve earlier implementation handoffs, failures, fixes and validation limits. The [amended third-window evaluation](Evaluation-Report-Window-3.md) remains unchanged. Detailed evidence is in [compatibility](Compatibility-Report.md), [runtime](Runtime-Verification.md), [integration](Integration-Verification.md), [application](Application-Verification.md), [recovery](Recovery-Verification.md), and [evaluation](Evaluation-Report.md).
