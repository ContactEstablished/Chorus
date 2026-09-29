# Task 11-2 — Durable team runtime and managed helper processes

**Status:** Complete as the injected runtime foundation, 2026-09-20. See [execution evidence and handoff](../Runtime-Verification.md). Production wiring and Git effects remain downstream.  
**Depends on:** 11-1 passes; council disposition recorded. The workspace dependency is injected until 11-3 supplies its implementation.  
**Paired specification:** [ImplementationSpec-11-2](../ImplementationSpecs/ImplementationSpec-11-2.md)

## Source of Truth

[Feature specification](../chorus-team-sessions-spec.md), [overview](Phase-11-Overview.md), the paired implementation specification, [master plan](../../../Plan.md), and repository CLAUDE.md. Verified source symbols are listed below; proposed interfaces remain planned until their owning task lands.

## Initial Starting Point

Planning inspection: main at `21580bda`, 2026-09-20. SessionManager owns PTYs through `launch`, `kill`, and `dispose`; helper pipes need additive ownership. StorageService owns private database handles and MIGRATIONS. Existing scrubbers can be reused. No team tables or coordinator exist. Electron-native SQLite requires a real Electron verifier.

## Goal

Provide durable bounded task coordination, run-scoped authorization, structured helper ownership, and a session-scoped broker without renderer dependencies.

## Exact Scope

New `src/shared/team.ts`/tests and main services teamCore, teamService, teamStorage, teamBridgeService, helperProcess/tests. Add SessionManager helper APIs and restore-exclusion seam/tests; team schema and one migration in schema.ts/storage.ts plus `StorageService.createTeamStorage()`. Own `scripts/verify-team-storage.mjs`.

## Non-Goals

No renderer, IPC/startup wiring, Git effects, CLI adapter changes, second database connection, fake helper AgentKind, dollar ceiling, or stored plaintext secrets. Preserve all unrelated staged, unstaged and untracked work; do not include it in any task commit.

## Dependencies

11-1 passes; council disposition recorded. The workspace dependency is injected until 11-3 supplies its implementation. Any incompatible upstream contract must be corrected through the documented ownership handoff before this task consumes it.

## Step-by-step Work

1. Define serializable contracts matching the normative feature spec and both transport/workspace consumers.
2. Implement pure lifecycle, idempotency, dependency readiness, attempt accounting and dispatch decisions.
3. Add transactional storage with immutable artifacts/reviews, integration journals and generation checks; allocate the migration only after registry verification.
4. Add SessionManager-owned helper processes and the authenticated loopback broker.
5. Implement TeamService with injected storage, executor, workspace, authorization, clock and publisher.
6. Implement pause/drain, stop, bounded waits, leases and restart-paused initialization; hand off production wiring to 11-4.

## Test Expectations

Cover concurrent reservation, duplicate/conflicting requests, dependency failures, permission blockers, failed preparation/spawn, three-attempt exhaustion, stale generations, secret fragments, duplicate exits, timeout races, lease revocation, storage rollback/reopen and unchanged ordinary sessions.

## Verification Commands

Run from repository root after creating the files owned by this task. Commands for new verifiers are deliverables, not claims that those scripts exist in the planning checkout.

```powershell
npm run typecheck
npx vitest run src/main/services/teamCore.test.ts src/main/services/teamBridgeService.test.ts src/main/services/sessionManager.team.test.ts
node scripts/verify-team-storage.mjs
node scripts/verify-team-process.mjs
npm test
npm run grep:secrets
npm run build
git diff --check
```

Replace `<disposable-repo>` with a new throwaway Git repository when present. Runtime commands that spend model usage require the selected test credentials; never use or modify the user's real project as a fixture. Record actual exit status and evidence, not just command text.

## Acceptance Criteria

- Concurrency reservations prevent oversubscription through asynchronous preparation and teardown.
- Repeated identical requests return the same operation; conflicting reuse has zero effects.
- Every attempted execution counts and no restart automatically repeats work.
- Run-scoped credential resolution and bridge tokens fail closed after revocation and never persist as plaintext.
- Pause drains, stop cancels, results survive reopen, and restored teams remain paused.
- Real Electron database evidence proves migrations/transactions/reopen; pure tests alone do not.

## Review Checklist

- [x] Check generation after every await, atomic state/event writes, prompt preservation, nullable usage, storage ownership, loopback auth, and concrete downstream interface handoff.
- [x] All task criteria have direct evidence and failed checks remain visible.
- [x] Paths, symbols, migration claims and CLI versions were rechecked at execution.
- [x] Changes are limited to ownership and explicit handoffs; unrelated work is preserved.



## Council disposition amendment — 2026-09-20

The [recorded council disposition](../Council-Disposition.md) and feature contract §10 are binding additions to this task/spec pair. Council review is recorded (partial run, limitations preserved); implementation evidence is recorded in Runtime-Verification.md.

Implement the complete final pre-spawn authorization fence including credential rotation fingerprint, normal/recovery operation scopes, immediate pausing denial, post-spawn revocation containment, and secret lifetime limits. Revoke active broker requests on generation changes. Implement the §10 HTTP/connection limits and negative environment tests. Add atomic capture reservations with existing attempt/capture/ref identity before Git effects. Store normalized review evidence. Tests must assert zero team credential/lease/process activity at boot and all Stop/Pause/rotation races.
