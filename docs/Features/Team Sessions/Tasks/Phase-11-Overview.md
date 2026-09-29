# Phase 11 — Team Sessions overview

Created 2026-09-20; updated 2026-09-21 UTC. **Implementation started 2026-09-20. Council disposition and Tasks 11-1–11-3 scoped gates are recorded. Application wiring, both-lead development workflows and recovery checks are implemented and verified. A fresh fixed-build comparison records all 18 executions (Team 9/9, lead-only 8/9 with one retained timeout), all with confirmed cleanup. The earlier amended batch remains historical evidence; packaged verification resumed after the user disabled Advanced Threat Defense, with a recovery-instruction correction and rebuilt installer.** See the [restoration record](../Release-Restoration.md) for current evidence. **Protection-enabled installation remains unverified.**

## Phase contract

Ship one lead terminal with a selected, cross-provider helper team. Claude Code and Codex are required leads; Claude Code, Codex and opencode provide verified helper execution. The lead delegates and reviews; the user inspects helpers and steers through the lead. Both integration policies, isolated worktrees, saved presets, bounded recovery, and paused restart restoration are required.

The [feature specification](../chorus-team-sessions-spec.md) is normative for D1–D17, limits, interfaces, lifecycle and security boundaries. The [feature roadmap](../roadmap.md) owns this package's status; [Foundation](../../Foundation/roadmap.md) records global placement. A failed prerequisite is not permission to silently reduce scope.

## Grounding and preserved state

Inspected on 2026-09-20, branch `main`, HEAD `21580bda1c7c9c5aa11162dd23aadbf0f0f1f2c0`. These are source observations, not runtime claims:

| Verified source | Reusable fact / gap |
|---|---|
| `src/main/services/sessionManager.ts` — `launch`, `restore`, `kill`, `dispose` | Owns PTYs; helpers need a separate owned pipe-process registry. Restore currently relaunches eligible ordinary sessions; team leads need an explicit exclusion. |
| `src/main/adapters/registry.ts` — `staticRegistry` | Existing Claude, Codex, Grok, Kimi, opencode and shell adapters. Presence is not proof of structured helper support. |
| `src/main/adapters/types.ts` — `McpServerRef`, `SupportsMcp`, `SupportsInstructions` | Launch-scoped MCP/instruction delivery exists; team eligibility additionally requires outside-worktree configuration. No team-control protocol exists. |
| `src/main/ipc.ts` — `registerIpc`, `wireMcpForLaunch` call sites | Main owns launch composition; memory and team configuration must be composed once, not overwrite each other. |
| `src/main/services/worktrees.ts` — `createWorktree`, `computeWorktreeReconcile` | Existing creation requires a session; add managed workspaces without weakening journal/retention rules. |
| `src/main/services/storage.ts` — `MIGRATIONS`, `StorageService`; `src/main/db/schema.ts` | One migration owner/connection. Existing worktree rows allow nullable session association; new team records are absent. |
| `src/main/services/apiSession.ts` — `createApiSession` | Streaming council transport is not a file-editing helper engine. |
| `src/main/services/fleetRegistry.ts` | Observes existing fleet state; its socket prohibition remains intact. |
| `src/main/services/launchProfiles.ts` — `resolveLaunchProfile` | Reuse credential/route validation and non-secret launch configuration vocabulary. |
| `src/renderer/src/components/LaunchDialog.vue` | Existing Solo/Pair/Workbench/Swarm pane presets are not coordinated team sessions. Keep them compatible. |

Pre-existing changes: `MM package.json`, `MM package-lock.json`, modified `src/renderer/src/components/TerminalPane.vue`, untracked `.claude/` and `.procoder/`. Do not revert, stage, commit, or overwrite them. During later implementation, re-read current changes and integrate additive edits deliberately. Those planning observations remain historical. Implementation now adds runtime code and audited migration 25; see Runtime-Verification.md.

## Sequence and file ownership

Execute 11-1 → 11-2 → 11-3 → 11-4 → 11-5. Shared-file ownership below is explicit; a downstream task requests an upstream contract correction before consuming it. Task 11-5 is the final integrating owner and may change earlier files for recovery/hardening after recording the handoff.

| Task | Exclusive implementation ownership until final hardening |
|---|---|
| [11-1](Task-11-1.md) / [spec](../ImplementationSpecs/ImplementationSpec-11-1.md) | New `src/main/adapters/helpers/` contracts/adapters/tests; `src/main/adapters/teamLead.ts`/tests; `resources/teamBridge.cjs`; `scripts/verify-team-compatibility.mjs`; compatibility report. No app wiring. |
| [11-2](Task-11-2.md) / [spec](../ImplementationSpecs/ImplementationSpec-11-2.md) | New `src/shared/team.ts` and tests; new teamCore/teamService/teamStorage/teamBridgeService/helperProcess and tests; additive SessionManager methods/tests; `src/main/db/schema.ts`, `src/main/services/storage.ts`; `scripts/verify-team-storage.mjs`. |
| [11-3](Task-11-3.md) / [spec](../ImplementationSpecs/ImplementationSpec-11-3.md) | New teamWorkspaceCore/teamWorkspaceService/tests; additive `src/main/services/worktrees.ts`, `git.ts` and their tests. Consumes 11-2 storage APIs without another migration owner. |
| [11-4](Task-11-4.md) / [spec](../ImplementationSpecs/ImplementationSpec-11-4.md) | `src/main/index.ts`, `src/main/ipc.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/preload/index.d.ts`; new teamIpc, teamInstructionsCore and tests; new renderer team store, TeamLaunchDialog, TeamPanel; additive LaunchDialog/TerminalPane; `electron-builder.yml` bridge packaging. |
| [11-5](Task-11-5.md) / [spec](../ImplementationSpecs/ImplementationSpec-11-5.md) | New teamRecoveryCore/teamRecoveryService/tests and recovery verifier; final integration edits to earlier-owned files, ordinary restore/delete guards, packaging/runtime fixes; release and evaluation reports. |

Task-owned file existence and verification are tracked by the feature roadmap and execution reports. Full paths for new service files are under `src/main/services/`; renderer files live under existing stores/components. Each task owns its paired tests and execution evidence. Do not add a dependency without the explicit approval required by CLAUDE.md.

## Gates

1. [Council brief](../CouncilBrief-11.0-TeamAuthority.md) reviewed; findings and coordinator disposition recorded. It concerns authority, credentials, protocol, persistence, and integration. The recorded disposition includes the partial council-run limitation.
2. 11-1 capability report proves both lead clients, required helpers, mixed auth, concurrent delegation, cancellation, result retrieval, and packaging assumptions. Model catalog visibility is not evidence of tool execution.
3. 11-2/11-3 unit and real persistence/Git fixtures pass before UI adoption.
4. 11-4 runs in the real app; no Proxy IPC payload, inaccessible prompt, lost config, or duplicate pane.
5. 11-5 proves restart/kill/retry behavior and documents comparative quality/time/usage/cost results. Unknown metering remains unknown.

Council or capability failures require an explicit disposition and revised plan where necessary. They are implementation prerequisites, not missing planning documents. The measured compatibility gate passed; unverified model/auth/version combinations remain disabled.

## Verification and completion

Future implementation gates, run from the repository root:

```powershell
npm run typecheck
npm test
npm run grep:secrets
npm run build
git diff --check
```

Each task adds focused commands and runtime cases. Electron-native SQLite checks run in an Electron harness against disposable databases, not the live installed database. Git fixtures use disposable repositories. Validate the installed build's bridge path as well as dev mode. Preserve test collection failures as failures; do not quote a passing subset as a full-suite pass.

Phase completion requires both leads, two concurrent helpers, cross-provider/mixed-auth execution, exact-content review/approval, integrated acceptance tests, paused recovery without duplicate writes, and ordinary-session compatibility. Evaluation is 18 paired-condition runs over three fixed tasks, with honest coverage and failures.

For this planning work, completion evidence is in [Planning-Verification.md](../Planning-Verification.md): document pairing, ownership, links, decisions, prerequisites and preserved source state. Feature implementation is a separate execution session using [Phase-11-KickoffPrompt.md](Phase-11-KickoffPrompt.md).
