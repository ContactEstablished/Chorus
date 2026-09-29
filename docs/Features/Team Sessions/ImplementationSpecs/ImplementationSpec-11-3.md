# Implementation specification 11-3 — Artifacts, review, and integration

Paired [task](../Tasks/Task-11-3.md). Normative [feature contract](../chorus-team-sessions-spec.md). **Implementation in progress, 2026-09-20; not yet complete.**

## Ownership and insertion points

Create `src/main/services/teamWorkspaceCore.ts`, `teamWorkspaceService.ts` and tests. The core contains no filesystem, subprocess, Electron or SQLite imports. Add `src/main/services/git.team.test.ts` for real Git wrapper fixtures.

Add `GitWorktreeManager.createManagedWorktree({ projectId, repoRoot, baseSha })` in worktrees.ts. Share DB-first creation mechanics with existing `createWorktree(sessionId, repoRoot, baseBranch)` while preserving its session validation and signature. Managed rows use nullable sessionId, the same generated path/branch conventions and journal, and settle detached until explicitly attached. Team ownership is persisted by 11-2 before an agent can start there.

Add narrow wrappers in git.ts for commit resolution, NUL-delimited status/manifests, isolated-index capture, private ref creation, staging and ff-only promotion. Keep the generic runner private. Do not expose arbitrary Git arguments, repo paths, or branch names through IPC/MCP. TeamStorage/schema remain owned by 11-2; runtime composition belongs to 11-4, final hardening to 11-5.

## Service surface

```text
createTeamWorkspace(runId, selectedRevision) -> workspace identity/baseSha
createAttemptWorkspace(runId, attemptId, integrationHead) -> workspace identity
captureArtifact(runId, attemptId, helperResult) -> immutable artifact / no-changes
prepareIntegration(runId, taskId, attemptId, expectedHead) -> prepared bundle / conflict
recordLeadReview(runId, ReviewCommand) -> immutable decision
recordUserDecision(runId, integrationId, expectedVersion, decision) -> state
integrate(runId, integrationId) -> applied / blocker
inspectRecovery(runId) -> evidence and pure classification
```

Service calls receive authenticated actors from TeamService. Stored ownership, policy and resolved Git identities are authoritative. Return discriminated outcomes: prepared, awaiting-review, awaiting-approval, integrated-awaiting-verification, no-changes, conflict, dirty-workspace, stale-review, process-live, interrupted, recovery-required. Include sanitized actionable reasons and retained workspace IDs.

Task 11-2 supplies atomic reserve/complete workspace operations, immutable artifact publication, append-only review, integration intent/preparation/decision/CAS transitions and unfinished-operation queries. Require unique operation identities, immutable artifacts and one applying integration per run. Artifact ID equals attempt ID; no extra artifact table. Missing storage APIs are an upstream contract correction, not permission to access its raw database.

## Workspace and artifact construction

1. Resolve launch selection to a commit SHA and anchor all managed paths using `resolveMainRepoRoot`. Reject a missing/unborn selected revision; no automatic initial commit. Never copy dirty source-checkout content.
2. Journal creation ownership before effects. Create the integration worktree; record its initial HEAD. Create each attempt from the current completed integration HEAD. Analysis receives isolation too and an edit-denying native mode.
3. Before capture, require confirmed full helper process-tree exit and verify repo identity, expected branch and base ancestry. Unknown liveness or switched branch blocks capture. Do not delete partial output.
4. Derive the complete candidate manifest from tracked final content plus nonignored untracked files. Team eligibility requires Chorus-generated configuration outside worktrees; prove there are no such launch modifications before capture. As defensive handling of retained older/probe evidence, exclude only exactly attributed Chorus-generated config paths supplied by launch composition. For a tracked config temporarily changed by Chorus, restore its pre-injection blob in the artifact tree; simply excluding it would accidentally retain its modified blob or delete it. If the helper also edits such a path, surface an explicit conflict requiring a new result rather than silently drop work.
5. Use a temporary `GIT_INDEX_FILE` seeded from the helper's final committed tree, apply tracked changes/deletions and explicit candidate paths, then write-tree. Preserve the real helper index. Handle NUL-delimited paths, binaries, renames, Unicode and pathspec-leading characters. Never force-add ignored files. Reject unresolved index entries or unsupported dirty submodule state.
6. Create an immutable single-parent artifact commit whose parent is the attempt base. Both artifact and prepared integration commits use explicit Chorus service author/committer identity and recorded timestamps; never depend on configured developer identity. This squashes helper-created commits and uncommitted final output into one base-relative result. Keep it reachable under `refs/chorus/teams/<runId>/artifacts/<attemptId>` with create-if-absent semantics; a different existing object is a conflict.
7. Journal the intended SHA/ref before publishing metadata. Persist base/artifact SHA, complete manifest, summary and test evidence as one immutable attempt result. If capture detects files changing, invalidate the snapshot, reconfirm liveness and report a blocker. Worktree isolation does not prevent other local programs from writing.

If the tree equals its base, return no-changes. A code task with no diff still requires the lead to explain why the task is satisfied and record acceptance evidence against the current integration revision; it cannot claim an applied change. Analysis starts from a recorded clean commit with all Chorus launch configuration outside the worktree. Any tracked/nonignored working-tree delta after execution is rejected; ignored writes are not claimed detectable by Git, so the native edit-denying capability remains required. Temporary indexes are app-owned artifacts and may be removed after capture; worktrees/branches are preserved.

## Review and integration protocol

The lead first accepts the artifact through `team_review` phase artifact. `team_integrate` action prepare then reserves an integration ID, captures expected integration HEAD, creates a staging worktree and produces a prepared bundle. The lead inspects it and calls `team_review` phase prepared. Ask policy then waits for a renderer user decision; lead-integrates uses the lead's prepared acceptance under the run policy. Only `team_integrate` action apply may promote. Integrated-phase verification is a final, separate review.

Preparation, under the per-run integration mutex:

1. Read a clean integration tree/index at the caller's expected HEAD. Reserve an integration intent with artifact SHA, base, policy version and staging worktree identity.
2. Apply the one-parent artifact in staging using `cherry-pick --no-commit`. On conflict, retain staging and return conflict paths; the integration tree stays untouched.
3. Turn the prepared tree into a single-parent commit at expected integration HEAD using commit-tree, with explicit Chorus service identity. Keep it reachable under a private integration ref. Record prepared result SHA before offering review or approval.
4. Present the artifact diff, resulting prepared diff, both SHAs, base, manifest and test provenance. Approval binds `(integrationId, preparationId, artifactSha, integrationHead, resultSha, policyVersion)`. Any bound-value change invalidates it. Mutable recordVersion is only the CAS precondition for a decision; incrementing it to record approval does not revoke that approval. Each reprepare creates a new immutable preparationId.

Promotion:

```text
require accepted prepared review and policy-appropriate approval
acquire cooperative lead write lease + per-run integration mutex
recheck run generation, branch, HEAD, clean index/tree, artifact and result identities
persist applying(expectedHead, resultSha) before Git effect
git merge --ff-only <resultSha> in the team integration worktree
inspect actual HEAD/index/tree
persist applied or recovery-required; release lease
```

The lead contract requires no outstanding/new write command during that lease. Because CLI shell access is not intercepted, this is cooperative coordination, not an enforced filesystem lock. Unexpected dirt or changed HEAD blocks before promotion; a racing change detected afterward creates a recovery case and is preserved. Never stash, force-reset, clean, overwrite files or delete branches to make integration succeed.

Use argument-array Git invocations, hidden windows and finite timeouts; no helper-supplied command execution. commit-tree avoids commit hooks, but do not claim all Git effects are hook-free: control merge hooks with an app-owned empty hooks directory for Chorus-managed operations and document any repository-configured filters as repository execution risk. Respect the user's normal Git configuration outside these service calls.

After promotion, the task is awaiting-review. The lead runs acceptance checks and sends integrated-phase acceptance with integrationId, originalResultSha, verifiedHead, commands and outcomes. Require current clean HEAD equal verifiedHead and originalResultSha to be its ancestor. Only then mark completed and release dependents. Failed checks block the task for a counted helper revision; do not automatically revert the applied result. A new attempt starts from the then-current integration HEAD. If HEAD changes before verification, require fresh evidence at the new revision; preserve older evidence as historical.

## Recovery matrix

Git and SQLite cannot share an atomic transaction. Persist intent before effects and reconcile observed evidence afterward:

| Journal/evidence | Recovery action |
|---|---|
| Workspace reservation with no Git/filesystem evidence | Mark interrupted preparation; no implicit recreate at boot. |
| Artifact ref exists but publication interrupted | Verify expected object/base/manifest; reconcile metadata or retain ambiguous evidence. |
| Staging conflict or timeout | Retain staging, mark blocked; lead must request a revised result. |
| Prepared/approved, not applying | Restore paused; approval usable only after exact tuple revalidation. |
| Applying; actual HEAD equals expected base and clean | Interrupted before promotion; no boot replay. |
| Applying; actual HEAD equals prepared result and clean | Record applied once; integrated verification may still be pending. |
| Other HEAD, dirty index/tree, missing object, unknown writer | Recovery-required; retain evidence and block new writing work. |

Repeated recovery must be idempotent. Ordinary retained dirt with no ambiguous applying operation and all writers accounted for may use explicit recovery-only lead mode; unknown writers and ambiguous promotion cannot. Do not infer an already-applied result solely from matching file content; use recorded Git identity. Even successful metadata reconciliation restores the team paused. Task 11-5 wires this after worktree reconcile and before any session auto-restore.

## Verification and handoff

Pure tests cover exact approval identity, policy, stale versions, state transitions, duplicate requests and every recovery row. Service tests inject failures before/after each journal boundary. Real temporary repositories prove helper commits plus dirt, renamed/deleted/binary/untracked files, repositories without configured user identity, external launch configuration, defensive generated-configuration restoration, simultaneous artifacts from one base, conflicts and dirty lead preservation. Hash the source checkout and real helper index before/after to prove preservation.

Handoff storage method requirements and capture/lease hooks to 11-2; bundles, versions and blockers to 11-4; crash fixtures/evidence matrix to 11-5. Record actual Git/runtime test outcomes. Commit only owned changes after verification; do not mark this task done from mocked Git alone.


## Council disposition amendment — 2026-09-20

The [recorded council disposition](../Council-Disposition.md) and feature contract §10 are binding additions to this task/spec pair. Council review is recorded (partial run, limitations preserved); implementation evidence is still pending.

Consume the durable capture reservation before Git writes; include run/attempt/capture identity in service commit metadata, journal intended tree/commit SHA before publishing the reserved ref, and reconcile all run-owned refs without substitute attempt IDs. Require cessation of known owned processes and block unverifiable writers. Use real Git fixtures and exact source/index preservation checks. Bind integrated review to command/outcome/context/test-source identity/provenance, not only success prose. Inject each reservation/object/ref/publication failure boundary.
