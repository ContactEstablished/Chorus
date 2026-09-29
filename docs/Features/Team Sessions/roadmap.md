# Team Sessions — Phase 11 roadmap

**2026-09-21 — v0.7.13:** [Named Team Members](Named-Team-Members.md) adds reusable friendly names, custom OpenRouter model IDs through OpenCode, encrypted API-key entry/reuse, optional role instructions, and roster management in Team setup. Custom-model eligibility is now separate from measured model evidence; the adapter/runtime gates remain. See the addendum for usage, migration, verification, and installer details.

**2026-09-29 — v0.8.0:** Team Sessions is committed to `main` and released in 0.8.0. `pdfjs-dist` is an approved renderer dependency (see the [master plan's stack table](../../Plan.md)); [TeamFilePreview.vue](../../../src/renderer/src/components/TeamFilePreview.vue) renders PDFs from memory with its bundled worker. Run evidence under `Evidence/` stays local and is not committed, because the repository is public; links into it resolve only in a checkout that has it.

Created 2026-09-20. **Implementation in progress: Tasks 11-1 through 11-3 passed scoped gates; application wiring and recovery are implemented with release verification still in progress.**

The [implementation progress record](Implementation-Progress.md) contains current code and verification evidence. Both-lead development-app workflows and all 18 fresh fixed-build comparison executions are recorded: Team 9/9, lead-only 8/9 with one retained timeout, and confirmed cleanup for all runs. Following that quarantine, the user disabled Advanced Threat Defense; restored packaged runs now produce passing reports. A recovery wording correction was rebuilt and rechecked. [Current restoration evidence](Release-Restoration.md) distinguishes original and corrected payloads; protection-enabled installation remains unverified. The earlier amended comparison remains historical evidence. No Team installer release is certified.

## Purpose

One interactive lead terminal coordinates a user-selected, cross-provider helper roster. The lead delegates, reviews, requests corrections, and integrates approved results. Helpers run concurrently in isolated worktrees. The user talks to the lead and can inspect the team without supervising separate terminals.

Quality is the acceptance gate. Lower lead-model usage and shorter completion time are measured objectives, not assumed outcomes. The [Reddit example](https://www.reddit.com/r/vibecoding/comments/1wl3lfi/i_built_an_orchestration_package_that_lowered_my/) inspired the workflow; its savings are not a Chorus benchmark or a dependency recommendation.

## Authority and placement

- [Feature specification](chorus-team-sessions-spec.md): scope, date-locked decisions, common contracts, defaults, and explicit limits.
- [Phase overview](Tasks/Phase-11-Overview.md): sequence, file ownership, grounding, and acceptance.
- [Foundation roadmap](../Foundation/roadmap.md): global phase placement and status.
- [Master plan](../../Plan.md): architecture and the explicit Phase 11 exceptions.

Phase 11 is post-v1. It does not depend on Mission Control's scheduler or Engine 10.2–10.4. It reuses existing session, credential, provider, worktree, instruction, and MCP configuration infrastructure. Fleet Comms remains observational; Phase 11 introduces a separate authenticated team-control channel.

## Delivery

| Task | Deliverable | Depends on | Status |
|---|---|---|---|
| [11-1](Tasks/Task-11-1.md) | Prove both leads, structured helpers, bridge, authentication, cancellation | Council disposition | Complete for measured combinations |
| [11-2](Tasks/Task-11-2.md) | Durable team runtime, bounded attempts, execution ownership, credential lease | 11-1 passes | Complete; injected runtime verified |
| [11-3](Tasks/Task-11-3.md) | Isolated workspaces, immutable artifacts, review and integration | 11-2 | Scoped gate passed; real Git/native verification |
| [11-4](Tasks/Task-11-4.md) | New team launch, presets, lead terminal panel, approvals and app wiring | 11-3 | Implemented; development-app matrix recorded, final packaged gate blocked |
| [11-5](Tasks/Task-11-5.md) | Recovery, release gates, real app validation, comparative evaluation | 11-4 | Recovery/hardening verified; 18 fixed-build comparisons recorded; packaged gate open |

Each task has a matching implementation specification. Execute sequentially. Task 11-5 is the designated final integrating owner for hardening earlier task files.

## Gates and completion

The [council review](CouncilBrief-11.0-TeamAuthority-Findings.md) ran on 2026-09-20; its [disposition](Council-Disposition.md) records the partial-run limitation and adopted amendments. Task 11-1 must prove the required Claude and Codex lead paths; a failure blocks the affected architecture, not permission to silently remove a required lead.

Feature completion requires every task's acceptance evidence, both integration modes, mixed authentication and cross-provider helpers, restart recovery with no duplicate writes, and the evaluation report. Passing static checks alone is insufficient. The [planning verification](Planning-Verification.md) records document checks only; it does not discharge implementation gates.
