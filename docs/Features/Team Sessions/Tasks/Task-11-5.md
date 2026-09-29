# Task 11-5 — Recovery, release verification, and comparative evaluation

**Status:** In progress, updated 2026-09-21 UTC. Recovery/ownership checks passed 278 assertions across 22 real restart scenarios and 55 native process assertions; the full suite passed 3,426 tests. Both leads passed complete development-app workflows, with recovery, shutdown, activation retry, credential refusal and ordinary-preset evidence recorded. All 18 fresh fixed-build comparison executions are retained: Team 9/9, lead-only 8/9 with one permission-related timeout, and confirmed cleanup for all runs. Earlier amended results remain historical evidence. After the user disabled Advanced Threat Defense, recreated packages ran successfully. A failed Codex recovery checkpoint exposed an instruction conflict, now corrected and rebuilt. Current packaged outcomes and remaining limits are in the [restoration record](../Release-Restoration.md). See [Release-Gate-Audit.md](../Release-Gate-Audit.md).  
**Depends on:** 11-4 complete; all earlier handoffs recorded.  
**Paired specification:** [ImplementationSpec-11-5](../ImplementationSpecs/ImplementationSpec-11-5.md)

## Source of Truth

[Feature specification](../chorus-team-sessions-spec.md), [overview](Phase-11-Overview.md), the paired implementation specification, [master plan](../../../Plan.md), and repository CLAUDE.md. Verified source symbols are listed below; proposed interfaces remain planned until their owning task lands.

## Initial Starting Point

Planning inspection: main at `21580bda`, 2026-09-20. Ordinary session restoration is automatic for eligible rows, while team restart must be paused. Workspace effects and SQLite are separately durable. Prior tasks supply journals and classifiers; no crash-recovery or comparative outcome has been proved by this planning package.

## Goal

Prove teams recover without duplicate writes or credential use, complete release gates, and measure quality/time/usage without hiding overhead or missing data.

## Exact Scope

New teamRecoveryCore/teamRecoveryService/tests and `scripts/verify-team-recovery.mjs`. As final integrating owner, change earlier-owned files only for recorded recovery/hardening gaps, including restore/delete guards. Own Runtime-Verification.md, Evaluation-Report.md and phase status updates.

## Non-Goals

No automatic retry after crash, forced dirty cleanup, silent dropping of a required lead/provider path, fabricated metering, broad unrelated refactor, or staging pre-existing user changes. Preserve all unrelated staged, unstaged and untracked work; do not include it in any task commit.

## Dependencies

11-4 complete; all earlier handoffs recorded. Any incompatible upstream contract must be corrected through the documented ownership handoff before this task consumes it.

## Step-by-step Work

1. Implement evidence-first recovery before ordinary team-lead restore can occur.
2. Handle orphan identities, interrupted helpers, partial launch, staged conflicts and applying journals without replay.
3. Drive crash cases, renderer detach/reopen, stop/quit and explicit resume with both lead tools.
4. Test missing conversation pointers and visible replacement-lead handoffs.
5. Run full checks and dev/packaged app verification, retaining failures honestly.
6. Perform 18 controlled comparison runs and report quality, elapsed time, human attention and available usage/cost.
7. Audit every task criterion and record phase completion only when evidence supports it.

## Test Expectations

Exercise crash before/after every durable effect, PID reuse, unknown orphan identity, late output, repeated boot reconcile, profile deletion/rotation, app quit during integration, destination branch preservation, retry exhaustion, metering absence and ordinary-session regression.

## Verification Commands

Run from the repository root. Recovery core/IPC regressions run under Vitest; service orchestration is exercised by the real Electron restart verifier rather than a nonexistent `teamRecoveryService.test.ts` file. Packaged checks now run with Advanced Threat Defense disabled; enabled-protection behavior remains unverified.

```powershell
npm run typecheck
npx vitest run src/main/services/teamRecoveryCore.test.ts src/main/services/teamIpc.test.ts
npm test
npm run grep:secrets
npm run build
node scripts/verify-team-recovery.mjs
node scripts/verify-team-process.mjs
node scripts/verify-team-storage.mjs
npm run dev
npm run dist
git diff --check
```

Replace `<disposable-repo>` with a new throwaway Git repository when present. Runtime commands that spend model usage require the selected test credentials; never use or modify the user's real project as a fixture. Record actual exit status and evidence, not just command text.

## Acceptance Criteria

- Restart restores every nonterminal team paused and performs no credential decryption or new agent launch.
- Recovery classifies committed versus uncommitted Git effects without repeating promotion or deleting evidence.
- Unknown process identity blocks workspace reuse; explicit resume safely reconciles verified identities.
- Both lead resume paths are truthful, including visibly labeled replacement conversations when required.
- The complete app/packaged compatibility matrix passes and ordinary sessions retain behavior.
- Evaluation reports all 18 runs, failures, fixed acceptance criteria and incomplete metering; it does not require invented cost/speed gains.
- All task evidence is audited before roadmap status changes from planned to complete.

## Review Checklist

- [ ] Check startup order, restore/restart/delete bypasses, PID creation identity, idempotent recovery, no hidden schema gaps, actual full-suite collection, and fair evaluation reporting.
- [ ] All task criteria have direct evidence and failed checks remain visible.
- [ ] Paths, symbols, migration claims and CLI versions were rechecked at execution.
- [ ] Changes are limited to ownership and explicit handoffs; unrelated work is preserved.



## Council disposition amendment — 2026-09-20

The [recorded council disposition](../Council-Disposition.md) and feature contract §10 are binding additions to this task/spec pair. Council review is recorded (partial run, limitations preserved); implementation evidence is still pending.

Verify zero team credential resolution, lease issuance and process launch on boot across every persisted nonterminal state. Exercise pausing/recovery tool allowlists, old-token active-wait invalidation, Resume generation rotation, credential fence races and ownership CRUD/restore guards. Reconcile reserved and orphaned artifact refs at every crash boundary; unknown identities stay blocked. Match verification depth across the 18 comparisons, retain all failures, separate approval delays and cost coverage, and disclose limited generalization.
