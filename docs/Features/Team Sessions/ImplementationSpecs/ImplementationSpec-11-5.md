# Implementation specification 11-5 — Recovery, release, and evaluation

Paired [task](../Tasks/Task-11-5.md). Normative [feature contract](../chorus-team-sessions-spec.md). **Recovery/hardening in progress; see [recovery evidence](../Recovery-Verification.md). Release/evaluation gate remains open.**

## Final integration ownership

Create `src/main/services/teamRecoveryCore.ts`, `teamRecoveryService.ts`, tests, and `scripts/verify-team-recovery.mjs`. This task is the final integrating owner for necessary corrections to 11-1–11-4 files; log the affected contract and reason in the execution report. Do not use this exception for unrelated refactors or dependency changes.

Review SessionManager.restore/planRestoreCount, main boot restore, project selection lazy restore, session restart/relaunch/duplicate and project/worktree/session deletion handlers. All paths must recognize team ownership. An ordinary command targeting a team lead redirects to TeamService or returns a clear refusal; it must not silently spawn a standalone lead, lose helper ownership, or drop authorization checks. Protect team-retained workspaces/history from generic cleanup. Existing independent sessions retain their rules.

## Recovery API and startup order

```ts
class TeamRecoveryService {
  reconcileAll(): Promise<TeamRecoveryReport>
  inspectRun(runId: string): Promise<TeamRecoveryEvidence>
}
```

Recovery core accepts database records plus observed process/Git/filesystem evidence and returns explicit classification/effects. It imports no Electron or database. Effects can heal metadata, mark interrupted/blocked, revoke in-memory authority or terminate a positively identified orphan. They cannot decrypt, spawn, replay a prompt, integrate, force-reset or delete retained work.

Boot sequence: open/migrate storage → establish SessionManager exclusions → reconcile worktrees → reconcile teams and orphan evidence → publish paused/blocked snapshots → restore eligible ordinary sessions. Lazy project restore uses the same exclusions. Do not depend solely on credentialed-session filtering: subscription team leads must also remain paused.

For every nonterminal run, invalidate generation/leases and mark paused after reconciliation, with blocked reason where needed. Preserve successful artifacts and pending reviews/approvals. Incomplete attempts become interrupted. Completed/stopped runs stay historical and spawn nothing. A failed partial launch retains its run/workspace journal for inspection.

## Process identity and resume

Persist helper and lead PID, creation identity, executable identity and ownership generation at launch. Observe the live process against those records before termination. PID reuse, inaccessible process information or a surviving descendant without provable ownership produces unknown-writer evidence; block workspace reuse. Never kill by name or a stale PID alone.

Verified orphan termination is recovery cleanup, not a retry. Confirm the process tree is gone before releasing its workspace slot. Stop/quit must handle bridge, lead, helpers, pending waits and integration effects in the proper order; write cancellation intent before signaling. Preserve journals if app shutdown interrupts cleanup.

Explicit Resume first checks worktree/branch identity, dirty state, retained integration effects, selected route/auth meaning and CLI compatibility. Before replacement, confirm the prior lead or recovery lead process tree has exited; retain its session record and verified conversation pointer. Unknown identity blocks replacement. Then resolve required credentials under a new lease. A lead resume pointer is used only if the adapter can prove it belongs to the run; missing/invalid pointers start a visibly labeled replacement conversation after informing the user in the team surface. Supply a bounded handoff with goal/roster/policy, task outcomes, relevant artifact references and unresolved work; never reconstruct a fictitious full transcript.

If the only obstruction is retained ordinary dirty lead work, all writers are accounted for, and no applying integration is ambiguous, the explicit Recover action may launch a recovery-only lead. Its lease covers only its selected credential, bridge is inspect-only, and dispatch/integration stay disabled. The user may inspect/checkpoint via that lead; normal Resume reconciles again and stops it before starting an active generation. This path never overrides unknown writers or ambiguous promotion.

Do not restart interrupted helper attempts automatically. The resumed lead inspects them and requests a counted revision/reassignment when appropriate. If the three-attempt ceiling is reached, it explains the blocker; user direction to create a new task is a new durable record, not history erasure.

## Git recovery and UI consistency

Use 11-3's recorded expected/prepared/result SHAs and its complete recovery matrix. Head-at-result plus clean state reconciles an applied integration once; head-at-base is interrupted-before-promotion; other heads/dirt/missing objects are ambiguous. Recovery never uses matching file text alone as commit proof. Preserve approval only as a historical decision until its full tuple is revalidated; it is not permission for boot mutation.

An applied result still awaiting integrated acceptance tests remains incomplete. Restored UI must show this distinction. Task event sequence/version is authoritative after renderer reload; a stale renderer cannot approve an old integration record or revive a stopped run.

## Runtime verification

The Electron recovery verifier uses real storage in disposable directories, deterministic fixture helpers with descendant processes, and real disposable Git repositories. It must fail nonzero on any missing assertion. Inject app/process interruption at these boundaries:

1. Run persisted, workspace not created; workspace created, lead not launched; lead spawned, bridge not ready.
2. Attempt reserved; helper spawned; artifact ref created; result not yet published.
3. Prepared integration persisted; approval accepted; applying intent stored; branch promoted but DB not finalized.
4. Helper timeout/cancel races with result; app quit during active helpers or integration; renderer reload during approval.
5. Credential deleted/rotated, provider route changed, missing worktree, corrupted JSON, reused PID and unverifiable orphan.

For each, assert preserved files/refs, correct paused/blocked state, no boot credential calls or new processes, no duplicate task/integration, and idempotent second reconcile. Do not test crash safety only with a mocked method throwing.

Drive the real dev and packaged application with Claude and Codex leads. Test two helpers, a mixed-provider roster, both auth families, both approval policies, missing trust/permission behavior, activation retry, dirty-work recovery-only mode, verified single-lead replacement, invalid/stale approvals, attempt exhaustion, view detach, stop/quit/resume and replacement handoff. Repeat ordinary Solo/Pair/Workbench/Swarm launch and ordinary credential restore refusal to guard compatibility.

Run typecheck, full Vitest, secret scanner and production build. Count collected/pass/fail tests from actual output. A pre-existing uncollected fixture is recorded and resolved or explicitly blocks a clean full-suite claim; never report only the passing subset as all tests passing. Verify packaged resource path with the installed executable rather than a build manifest alone.

## Evaluation protocol

Before runs, freeze three representative fixture tasks with committed starting revisions and independently specified acceptance tests: bug fix, parallelizable feature, refactor with tests. For each task run three matched pairs (lead-only vs team), 18 total executions, alternating pair order. Use the same lead model/effort/auth, base, machine and acceptance tests within a pair. Keep team roster/limits fixed across its repeats. Reset fixtures between runs without deleting evidence.

Record per run: fixture/base/config/version IDs; pass/fail and regression results; wall-clock from submission through final accepted verification; human interventions and measured human interaction time if instrumented; attempts/revisions; lead tokens; helper and total tokens; provider-reported/estimated spend with source/coverage; failure or censoring reason. Do not count background thinking as measured human time.

Report each run, pair differences, median and range per condition. A failed/time-limited run stays in the denominator, with time reported as censored if applicable. Unknown subscription dollars are null; mixed accounting is partial, never a claimed complete total. Report lead-usage reduction separately from total cost and completion time. Quality gates a usable implementation; performance results may show no improvement and must still be published.

Create `Runtime-Verification.md` and `Evaluation-Report.md` in the feature directory only with actual evidence. Link raw sanitized artifacts, commands, versions and deviations. A release cannot claim both leads passed if only one did.

## Completion and rollout

New team sessions are opt-in from launch; independent sessions retain their path. Rollback disables new team launches and restores no team processes automatically, preserving rows/refs/worktrees for recovery. Do not remove the schema or delete evidence to roll back UI exposure.

Audit every task acceptance criterion and required matrix row. Update feature/global roadmap status only after all required evidence exists. Council disposition, compatibility report, runtime report and evaluation report must be linked. Known blockers remain explicit. Task-owned/final-hardening changes receive intentional reviewable commits; do not stage unrelated user work or push without authorization.


## Council disposition amendment — 2026-09-20

The [recorded council disposition](../Council-Disposition.md) and feature contract §10 are binding additions to this task/spec pair. Council review is recorded (partial run, limitations preserved); implementation evidence is still pending.

Verify zero team credential resolution, lease issuance and process launch on boot across every persisted nonterminal state. Exercise pausing/recovery tool allowlists, old-token active-wait invalidation, Resume generation rotation, credential fence races and ownership CRUD/restore guards. Reconcile reserved and orphaned artifact refs at every crash boundary; unknown identities stay blocked. Match verification depth across the 18 comparisons, retain all failures, separate approval delays and cost coverage, and disclose limited generalization.
