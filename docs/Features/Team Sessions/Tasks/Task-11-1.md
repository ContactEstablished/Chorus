# Task 11-1 — Compatibility proof and structured helper adapters

**Status:** Complete for the measured combinations; [compatibility evidence](../Compatibility-Report.md) and exclusions recorded 2026-09-20.  
**Depends on:** Recorded council disposition; no production Phase 11 prerequisites.  
**Paired specification:** [ImplementationSpec-11-1](../ImplementationSpecs/ImplementationSpec-11-1.md)

## Source of Truth

[Feature specification](../chorus-team-sessions-spec.md), [overview](Phase-11-Overview.md), the paired implementation specification, [master plan](../../../Plan.md), and repository CLAUDE.md. Verified source symbols are listed below; proposed interfaces remain planned until their owning task lands.

## Initial Starting Point

Planning inspection: main at `21580bda`, 2026-09-20. The existing adapter registry launches interactive CLIs. `McpServerRef` and launch instructions exist, but a model catalog entry does not prove structured execution, cancellation, or lead delegation. Claude, Codex, opencode and Node executables were discoverable during planning; versions and actual team behavior have not been verified.

## Goal

Prove the required execution paths before committing the app to them, then expose a small tested helper adapter contract.

## Exact Scope

New `src/main/adapters/helpers/` types, Claude/Codex/opencode adapters, registry and tests; `src/main/adapters/teamLead.ts` and tests for outside-worktree lead configuration; `resources/teamBridge.cjs`; `scripts/verify-team-compatibility.mjs`; `Compatibility-Report.md` in this feature folder. The harness uses a disposable fixture broker; production TeamBridgeService belongs to 11-2.

## Non-Goals

No app startup/IPC wiring, database migration, external package installation, global CLI configuration edits, replacement coding engine, or reduction to one supported lead. Preserve all unrelated staged, unstaged and untracked work; do not include it in any task commit.

## Dependencies

Recorded council disposition; no production Phase 11 prerequisites. Any incompatible upstream contract must be corrected through the documented ownership handoff before this task consumes it.

## Step-by-step Work

1. Record installed versions and relevant help output, route/auth compatibility and native permission behavior.
2. Implement structured helper launch/parsing/cancellation descriptors and fixture tests.
3. Implement the bounded tools-only stdio bridge with the specified protocol and loopback authentication.
4. Build a disposable compatibility harness with saved non-secret artifacts and real CLI probes.
5. For each required lead, demonstrate two concurrent delegated tasks, result collection, correction, and cancellation; include cross-provider helpers and mixed auth.
6. Record tested combinations, failures, exact commands, unsupported modes, and packaged-path requirements before passing the gate.

## Test Expectations

Test fragmented JSON/Unicode, malformed/oversized records, unknown events, missing terminal results, auth failure, inaccessible permissions, stdin prompt transport, secret redaction, bridge lifecycle/negotiation and cancellation. Live probes must verify real process trees and actual file changes.

## Verification Commands

Run from repository root after creating the files owned by this task. Commands for new verifiers are deliverables, not claims that those scripts exist in the planning checkout.

```powershell
npm run typecheck
npx vitest run src/main/adapters/helpers
node scripts/verify-team-compatibility.mjs --fixture
node scripts/verify-team-compatibility.mjs --live --interactive --evidence "$env:TEMP/chorus-team-compat-new"
node scripts/verify-team-compatibility.mjs --live --helper-matrix
node scripts/verify-team-compatibility.mjs --live --permissions-only
npm run grep:secrets
git diff --check
```

The live verifier creates a disposable fixture at the provided temporary path and refuses to overwrite an existing non-fixture directory. Runtime commands that spend model usage require the selected test credentials; never use or modify the user's real project as a fixture. Record actual exit status and evidence, not just command text.

## Acceptance Criteria

- Both Claude and Codex actually use the bridge and retrieve two concurrent helper results.
- Claude, Codex and opencode helper paths each have versioned structured execution evidence; at least one opencode external-provider model edits/tests successfully.
- Subscription and API paths are demonstrated without exposing credentials or rewriting global configuration.
- Cancellation stops the owned process tree; no hidden prompt or terminal-output heuristic stands in for completion.
- The report explicitly blocks unproved combinations and hands stable contracts to 11-2.

## Review Checklist

- [x] Check protocol stdout purity, env isolation, Windows shim/path handling, unsupported-capability labels, live evidence, and the absence of claimed savings.
- [x] All task criteria have direct evidence and failed checks remain visible.
- [x] Paths, symbols, migration claims and CLI versions were rechecked at execution.
- [x] Changes are limited to ownership and explicit handoffs; unrelated work is preserved.



## Council disposition amendment — 2026-09-20

The [recorded council disposition](../Council-Disposition.md) and feature contract §10 are binding additions to this task/spec pair. Council review is recorded (partial run, limitations preserved); implementation evidence is still pending.

Capture native permission-denial evidence, analysis edit prevention, supported CLI-managed subscription identity scope, external launch configuration preservation, per-route metering provenance, both clients’ negotiated MCP revision/approval behavior, stdout purity, bounded frames, and wait cancellation. Apply the endpoint/resource limits in feature §10 to the facade. Record the measured Windows sandbox and PATHEXT requirements. Keep all unproved combinations disabled; diagnostic print/exec probes are not interactive lead proof.
