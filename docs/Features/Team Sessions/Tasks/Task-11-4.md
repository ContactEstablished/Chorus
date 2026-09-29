# Task 11-4 — Team launch, presets, inspection, and application wiring

**Status:** Implemented, updated 2026-09-21 UTC. Both leads passed complete development-app integration workflows under both policies across the retained windows, plus explicit keyboard checks and an actual-window concurrent mixed subscription/API roster; earlier packaged lifecycle/ownership checks also passed. The development-window matrix now includes approval reload/staleness, recovery, ordinary presets, history/exhaustion, credential refusal, activation retry and quit during helper/preparation/apply work. Packaged work resumed after the user disabled Advanced Threat Defense; a recovery instruction conflict was corrected and rebuilt. See the [restoration record](../Release-Restoration.md) for corrected-payload results and protection-enabled verification limits. Evidence and verification limits are tracked in [Application-Verification.md](../Application-Verification.md); full acceptance is not yet certified.  
**Depends on:** 11-1 through 11-3 implemented and their focused gates passed.  
**Paired specification:** [ImplementationSpec-11-4](../ImplementationSpecs/ImplementationSpec-11-4.md)

## Source of Truth

[Feature specification](../chorus-team-sessions-spec.md), [overview](Phase-11-Overview.md), the paired implementation specification, [master plan](../../../Plan.md), and repository CLAUDE.md. Verified source symbols are listed below; proposed interfaces remain planned until their owning task lands.

## Initial Starting Point

Planning inspection: main at `21580bda`, 2026-09-20. LaunchDialog currently supports independent pane presets. TerminalPane attaches to a main-owned session. Main IPC composes route, credentials, MCP and instructions; preload forwards typed calls. Current terminal and package edits predate this phase and must be preserved.

## Goal

Make the complete team workflow available through one lead terminal with inspect-only helpers, reusable presets and the selected integration policy.

## Exact Scope

Main index/ipc, shared ipc, preload index.ts/index.d.ts; new teamIpc and teamInstructionsCore/tests; renderer team store/tests, TeamLaunchDialog and TeamPanel; additive LaunchDialog/TerminalPane changes; electron-builder.yml packaging. Keep shared domain types owned by 11-2.

## Non-Goals

No interactive helper terminals, hot conversion of existing sessions, changes to Solo/Pair/Workbench/Swarm semantics, automatic destination merges, or provider-specific conditional UI outside capability data. Preserve all unrelated staged, unstaged and untracked work; do not include it in any task commit.

## Dependencies

11-1 through 11-3 implemented and their focused gates passed. Any incompatible upstream contract must be corrected through the documented ownership handoff before this task consumes it.

## Step-by-step Work

1. Wire service construction, storage, broker and lifecycle before any restore path; add team lead restore/restart guards.
2. Register validated IPC and narrow preload methods with plain-object request/response payloads.
3. Add team launch/preset controls and capability reasons; snapshot selected configuration at launch.
4. Compose team MCP and instructions with existing memory configuration in one launch pass.
5. Add the team panel, exact prepared-change approvals, usage coverage, and lifecycle actions.
6. Package the bridge, then drive both leads and policies in dev and packaged app.

## Test Expectations

Verify payloads survive Electron structured clone, reactive objects are stripped, disabled combinations cannot launch, duplicate launch clicks do not create teams, preset edits do not alter runs, stale approvals fail, listeners unsubscribe, and ordinary pane presets retain behavior.

## Verification Commands

Run from repository root after creating the files owned by this task. Commands for new verifiers are deliverables, not claims that those scripts exist in the planning checkout.

```powershell
npm run typecheck
npx vitest run src/main/services/teamIpc.test.ts src/main/services/teamInstructionsCore.test.ts src/renderer/src/stores/team.test.ts src/shared/ipc.test.ts
npm run grep:secrets
npm run build
npm run dev
npm run dist
git diff --check
```

Replace `<disposable-repo>` with a new throwaway Git repository when present. Runtime commands that spend model usage require the selected test credentials; never use or modify the user's real project as a fixture. Record actual exit status and evidence, not just command text.

## Acceptance Criteria

- User can launch and save/reuse a new team with either required lead and at least one helper.
- One pane owns the lead; helper activity is inspectable without helper prompt inputs or fake panes.
- Both integration policies work with current artifact/base/result identity and visible pending decisions.
- MCP memory and team tools coexist; no global config writes or secret-bearing command arguments.
- Keyboard, resize, renderer remount, packaged bridge path, activate/recover/pause/resume/stop and ordinary presets work in a real window.

## Review Checklist

- [ ] Check source-state preservation, compose-once launch data, outbound validation, view detach versus stop, displayed auth/coverage, keyboard focus and packaged resource resolution.
- [ ] All task criteria have direct evidence and failed checks remain visible.
- [ ] Paths, symbols, migration claims and CLI versions were rechecked at execution.
- [ ] Changes are limited to ownership and explicit handoffs; unrelated work is preserved.



## Council disposition amendment — 2026-09-20

The [recorded council disposition](../Council-Disposition.md) and feature contract §10 are binding additions to this task/spec pair. Council review is recorded (partial run, limitations preserved); implementation evidence is still pending.

Render CLI-managed subscription account scope and verified/unsupported capabilities honestly. Carry explicit team launch authority and preserve only proven per-launch MCP settings. Each Resume/replacement rotates generation and closes old bridge requests; Recover/Pausing are inspection-only. Display timeouts separately from structured permission blocks, approval-wait time separately from execution, and metering estimates separately from billed spend. Preserve exact test evidence/provenance and enforce actor/ownership guards.
