# Task 11-3 — Reviewable artifacts and team integration

**Status:** Scoped implementation gate passed, 2026-09-20. Artifact capture, staging, review, approval and promotion passed real Git/native SQLite verification. Full app recovery remains Task 11-5. See [integration evidence](../Integration-Verification.md).  
**Depends on:** 11-1 execution/config-path evidence and 11-2 runtime/storage interfaces.  
**Paired specification:** [ImplementationSpec-11-3](../ImplementationSpecs/ImplementationSpec-11-3.md)

## Source of Truth

[Feature specification](../chorus-team-sessions-spec.md), [overview](Phase-11-Overview.md), the paired implementation specification, [master plan](../../../Plan.md), and repository CLAUDE.md. Verified source symbols are listed below; proposed interfaces remain planned until their owning task lands.

## Initial Starting Point

Planning inspection: main at `21580bda`, 2026-09-20. `GitWorktreeManager.createWorktree(sessionId, repoRoot, baseBranch)` requires an existing session. Worktree rows permit `sessionId: null`. Creation is DB-first and reconcile preserves ambiguous evidence. There is no artifact/review/integration service.

## Goal

Capture immutable helper results and integrate reviewed changes through isolated staging, exact-content approval, and recoverable Git journals.

## Exact Scope

New `src/main/services/teamWorkspaceCore.ts`, teamWorkspaceService.ts and tests; additive managed-worktree creation in worktrees.ts and bounded typed Git wrappers/tests in git.ts. Consume 11-2 storage APIs; do not add another migration owner.

## Non-Goals

No destination-branch merge, push, publishing, automatic branch deletion, destructive cleanup, UI/IPC registration, or claim that CLI shell access is fully intercepted. Preserve all unrelated staged, unstaged and untracked work; do not include it in any task commit.

## Dependencies

11-1 execution/config-path evidence and 11-2 runtime/storage interfaces. Any incompatible upstream contract must be corrected through the documented ownership handoff before this task consumes it.

## Step-by-step Work

1. Implement pure eligibility/review/recovery decisions and additive managed worktree creation.
2. Create integration and attempt workspaces from recorded committed SHAs.
3. Capture exited helper results through an isolated Git index into immutable single-parent artifact commits.
4. Prepare changes in a staging worktree and provide a complete prepared-review bundle.
5. Bind lead review and any user approval to artifact, prepared result, integration base and policy version.
6. Serialize ff-only promotion after rechecking clean state and the cooperative lead lease.
7. Expose recovery evidence and post-integration verification requirements to 11-4/11-5.

## Test Expectations

Use pure state tests and real disposable Git repositories for binary/renamed/deleted/untracked files, helper-created commits, injected-config exclusion, submodule refusal, dirty lead trees, two helpers from one base, stale approval, conflicts and crashes around journals.

## Verification Commands

Run from repository root after creating the files owned by this task. Commands for new verifiers are deliverables, not claims that those scripts exist in the planning checkout.

```powershell
npm run typecheck
npx vitest run src/main/services/teamWorkspaceCore.test.ts src/main/services/worktrees.test.ts src/main/services/git.team.test.ts
node scripts/verify-team-storage.mjs
npm run grep:secrets
git diff --check
```

Replace `<disposable-repo>` with a new throwaway Git repository when present. Runtime commands that spend model usage require the selected test credentials; never use or modify the user's real project as a fixture. Record actual exit status and evidence, not just command text.

## Acceptance Criteria

- Team, attempt and staging workspaces have recorded ownership without fake session rows.
- Artifacts include intended final helper changes while preserving its real index and source checkout dirt.
- Both policies require lead prepared-result review; ask policy additionally requires exact-content user approval.
- Conflicts stay in staging; dirty or unexpected lead changes are retained and block promotion.
- Stale/duplicate requests cannot reapply a change; ambiguous recovery never forces cleanup.
- Integrated task completion waits for lead acceptance evidence at the integrated revision.

## Review Checklist

- [ ] Check process-exit proof, artifact immutability, Git argument arrays, exact approval tuple, serial promotion, dirty-state preservation, and the limits of cooperative locking.
- [ ] All task criteria have direct evidence and failed checks remain visible.
- [ ] Paths, symbols, migration claims and CLI versions were rechecked at execution.
- [ ] Changes are limited to ownership and explicit handoffs; unrelated work is preserved.



## Council disposition amendment — 2026-09-20

The [recorded council disposition](../Council-Disposition.md) and feature contract §10 are binding additions to this task/spec pair. Council review is recorded (partial run, limitations preserved); implementation evidence is still pending.

Consume the durable capture reservation before Git writes; include run/attempt/capture identity in service commit metadata, journal intended tree/commit SHA before publishing the reserved ref, and reconcile all run-owned refs without substitute attempt IDs. Require cessation of known owned processes and block unverifiable writers. Use real Git fixtures and exact source/index preservation checks. Bind integrated review to command/outcome/context/test-source identity/provenance, not only success prose. Inject each reservation/object/ref/publication failure boundary.
