# Phase 11 planning verification

Verified 2026-09-20 against main at `21580bda1c7c9c5aa11162dd23aadbf0f0f1f2c0` plus the pre-existing working-tree changes described below. **This report verifies the planning package, not the feature implementation.**

## Delivered artifacts

- Feature roadmap and normative specification with date-locked user decisions and explicit engineering defaults.
- Phase overview with live-source grounding, dependencies, exclusive ownership and final integration handoff.
- Five task documents, each paired with exactly one deeper implementation specification.
- Council brief, authored and explicitly not run.
- Execution handoff prompt following the repository's phase workflow.
- Master plan and Foundation roadmap entries admitting the bounded post-v1 team capability.

The feature folder contains 16 Markdown documents including this report. [Start at the overview](Tasks/Phase-11-Overview.md) or read the [feature contract](chorus-team-sessions-spec.md).

## Requirement audit

| Requirement from the planning conversation | Authoritative plan location |
|---|---|
| One lead terminal, helpers inspectable, user steers through lead | Feature D1/D9; task/spec 11-4 |
| Delegation, implementation/testing, lead review | Feature D2 and tool/review protocol; task/spec 11-2/11-3 |
| Quality, cost and speed measured together | Feature D3; 11-5 evaluation protocol, 18 runs |
| Cross-provider and mixed subscription/API auth | Feature D4/D6; 11-1 compatibility gate |
| Claude and Codex required as leads | Feature D5; 11-1 and 11-5 acceptance |
| User-selected roster, bounded concurrency and time | Feature D7/D13; 11-2 scheduling and leases |
| Isolated worktrees and exact-content integration approval | Feature D8/D10/D14; 11-3 artifact/staging protocol |
| New team launches and saved presets | Feature D11; 11-4 launch/preset IPC and UI |
| Bounded recovery and paused restart | Feature D12; 11-2 lifecycle and 11-5 recovery matrix |
| Repository architecture, credentials and ordinary behavior preserved | Overview grounding; explicit Plan/Foundation exceptions; all ownership contracts |

## Checks performed

The planning audit checked:

1. Every Task-11-1 through Task-11-5 has exactly one matching ImplementationSpec and all eleven required task headings.
2. All 79 relative Markdown links in the feature folder and newly added global plan/roadmap text resolve; link casing is checked against Git's tracked names, including `docs/Plan.md`. Historical global-document links are outside this check's scope.
3. Markdown code fences are paired; phase documents contain no unresolved drafting markers. Proposed source files and future evidence reports are explicitly labeled planned rather than verified existing artifacts.
4. Core contracts and task ownership agree after review: migration/storage owner, helper process owner, application wiring owner and final hardening exception are named.
5. Corrected review findings include project-scoped launch idempotency, durable retry/integration acknowledgments, explicit restore exclusion, activation retry, one applying integration per run, immutable approval identity, outside-worktree configuration, single-lead replacement, revision-bound acceptance and recovery-only handling of retained dirt.
6. Documentation-only whitespace checking passes for modified tracked documentation and the new feature files. The whole-working-tree `git diff --check` also reports a pre-existing trailing-whitespace line in TerminalPane.vue; that file's content hash is unchanged by this planning work.

No feature typecheck, Vitest, build, CLI execution probe, paid model run, council run, migration or live application verification was performed for this documentation-only change. Commands in task documents are future implementation requirements, not reported results. The installed Claude help was read to confirm it advertises per-launch MCP configuration; that is not a live compatibility proof.

## Preserved working-tree state

Initial status contained staged and unstaged package/package-lock changes, an unstaged TerminalPane change, and untracked `.claude/` / `.procoder/`. No staging, commit, push, source edit, or configuration edit was performed by this planning work.

The following SHA-256 values were captured before writing and checked again during final verification:

| Existing modified file | SHA-256 |
|---|---|
| package.json | `4D0B498EBB888CA93D95856DD0EC01C2B40654C4DA8A13FF5D2763F096F88F52` |
| package-lock.json | `B797062C9DA8D6B4C34AC8456AB0EC1956150994D603A7CCDD2291759867F87B` |
| src/renderer/src/components/TerminalPane.vue | `83F2801D1F9BFC5257AC71FB960C989B243F38BC64B0EDD56624B9E9B677D7AF` |

No migration ID or global Foundation decision/finding number is reserved. The only new files are under this feature documentation directory; existing documentation changes are limited to the master plan and Foundation roadmap.

## What remains before the feature exists

Planning is complete. Implementation remains unstarted: run and disposition the council review, pass 11-1's compatibility proof, then execute 11-2 through 11-5. This is an implementation gate sequence, not missing planning work. Do not mark Phase 11 shipped until the required real runtime and evaluation evidence exists.
