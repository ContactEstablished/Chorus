# Implementation specification 11-2 — Durable runtime and process ownership

Paired [task](../Tasks/Task-11-2.md). Normative [feature contract](../chorus-team-sessions-spec.md). **Implemented and verified as the injected runtime foundation, 2026-09-20.** See [runtime evidence and downstream contracts](../Runtime-Verification.md).

## Files and insertion points

Create `src/shared/team.ts` for serializable domain types and strict Zod schemas. Consumers in preload use type-only imports. Create `src/main/services/teamCore.ts`, `teamService.ts`, `teamStorage.ts`, `teamBridgeService.ts`, `helperProcess.ts` and their tests. Pure teamCore imports neither Electron nor SQLite.

Add a separate helper map beside SessionManager's PTY `sessions` map, with `spawnHelper`, `cancelHelper`, `inspectHelper`, and helper event subscriptions; extend `dispose` to clean up both kinds. Add `bindRestoreExclusion(predicate: (sessionId: string) => boolean)` and apply it in restore selection and planRestoreCount before any heal/relaunch decision; Task 11-4 supplies the team-lead predicate. Test that excluded subscription leads are never automatically launched. Helpers never enter pane write/resize/restore paths. `helperProcess` owns mechanics on SessionManager's behalf, not a competing global process registry.

Append seven tables and inferred types to `src/main/db/schema.ts`. Append one migration to StorageService's `MIGRATIONS`, allocating its version after the execution-time registry audit. Add `StorageService.createTeamStorage()` over the existing private connection after migration. Do not expose the raw handle or open a second writable database. Create `scripts/verify-team-storage.mjs` for Electron-native database checks.

## Public service contracts

TeamService is constructed with storage, executor, workspace, credential authorization, clock, ID factory and publisher dependencies. It contains no vendor CLI flags or Electron IPC imports. Proposed methods:

```text
createRun(projectId, clientRequestId, validatedConfig, userActor) -> runId
submitTask(runId, leadActor, validatedTask) -> taskId
getSnapshot(runId, afterSequence?) -> TeamSnapshot
wait(runId, taskIds, afterSequence, timeoutMs, signal) -> TeamSnapshot
review(runId, leadActor, ReviewCommand) -> decisionId
revise(runId, leadActor, RevisionCommand) -> attempt reservation
integrate(runId, leadActor, PrepareOrApplyCommand) -> integrationId
decideIntegration(runId, userActor, id, expectedVersion, decision) -> state
activate / recover / pause / resume / stop / completeRun / cancelTask -> current state
subscribe(listener) -> unsubscribe
```

Actor identity comes from the authenticated transport, never a claimed role in JSON. User approval is callable only by the registered renderer IPC handler; an MCP lead cannot manufacture userActor. The common contract defines model roster, run config, task kind, events, attempts, review phases and request limits exactly as the feature specification.

Workflow: validate/normalize → transactionally reserve/record event → prepare workspace → recheck lease/generation → resolve credential → SessionManager spawn → parse events → record result after process exit → lead artifact review → analysis completion or prepared integration/review/approval/apply → integrated-phase verification.

## State, scheduling, and idempotency

Implement pure transition functions returning next state plus explicit effects. Serialize commands per run; transactional reservations protect concurrency across awaits. Reserve a slot before workspace preparation. Release it only after failed preparation or confirmed full process-tree exit. Queue ready tasks by ready-time then creation order. Dependency failure blocks children. Code dependencies are satisfied only after integrated verification completes; analysis dependencies after accepted review.

Use the feature's task/attempt states. Preparation timeout is five minutes; execution timeout starts at spawn using the configured 5–240-minute limit. Cancellation/timeout intent is recorded before signaling the process; a racing final result cannot override it. Unknown surviving descendants block slot/workspace reuse. Every reservation consumes one of three attempts, including failed preparation/spawn and revisions. The lead requests bounded retry/reassignment explicitly; no invisible transport respawn.

Normalize validated commands to a stable field order, retain brief/context bytes, trim title/identifier boundaries, and canonicalize dependency sets. Hash the canonical payload. Unique `(run_id, operation, client_request_id)` returns the original acknowledgment on identical reuse, `REQUEST_CONFLICT` on a different hash. Acknowledgments identify operations; poll current status separately. Launch deduplication is stored directly on team_runs as `(project_id, launch_request_id, launch_payload_hash, launch_ack_json)` with unique project/request identity. Reserve that row before workspace/process effects; identical replay returns the original run ID. For other operations, team_events stores operation, client_request_id, canonical payload hash and original acknowledgment under a unique run/operation/request key. Reservation and acknowledgment commit atomically with the operation's first domain transition; later lifecycle events do not reuse that request-key field. Unknown run/member/task, dependency mismatch, unsupported capability, invalid input, revoked authorization and stale state fail before effects. Generic diagnostic text is sanitized.

Every callback carries run generation and attempt ID. Late data may append historical diagnostics to its original attempt only; it cannot revive cancelled work, modify a new attempt, or release another attempt's slot. Record terminal outcome once. A successful process does not complete a task without the applicable review gates.

Pause blocks dispatch/decryption/integration immediately; drains active helpers and an already-applying integration; then enters paused and revokes authorization. Stop revokes immediately, cancels pending work and owned processes, and preserves outputs. Boot restoration invalidates leases and exposes nonterminal runs paused without launching anything. Activate retries bridge readiness on the existing preparing run/lead, without creating another process or credential lease. Recover is an explicit user action for retained ordinary dirt with known stopped writers and no ambiguous promotion; it creates a lead-only lease and inspect-only broker, with dispatch/integration disabled. Resume confirms old/recovery lead exit, retains session identity/conversation pointer, and then establishes a new generation. Task 11-5 integrates full evidence-based recovery.

## Data model and transactions

Use TEXT UUIDs, ISO timestamps, integer versions/generations and monotonically increasing per-run event sequence. The feature spec lists required fields. Implement these table relationships:

- team_presets: label, schema version and validated config JSON; active references are resolved on launch.
- team_runs: project and nullable lead-session reference, config snapshot, policy/version, generation/status, base SHA, integration-worktree reference and timestamps.
- team_members: run/member identity and validated immutable non-secret configuration, credential reference.
- team_tasks: run identity, kind/brief/context/acceptance/dependency IDs, request identity/hash, state/version/current attempt.
- team_attempts: task/attempt number/member, status, base SHA/worktree, process identity, deadlines, result/artifact JSON and usage provenance.
- team_events: run sequence, operation ID/type, optional client request ID/hash/original acknowledgment, actor, entity ID, generation, sanitized payload/time.
- team_integrations: task/attempt, artifact/base/prepared result SHAs, immutable preparation ID, staging worktree, review/approval/policy version, mutable operation state/version.

Within the team tables use real foreign keys with restrictive deletion; presets may be deleted without erasing runs. Historical snapshots retain deleted profile labels/configuration while credentials are revalidated on resume. Reuse repository conventions for historical external IDs rather than cascading deletion of projects/worktrees/sessions into team history. Task 11-5 guards destructive existing CRUD paths and reports retained-team ownership before deletion.

Enforce unique member ID per run, attempt number per task, event sequence per run, operation request identity, and one applying integration per run (partial unique index or equivalent transactional constraint). Validate JSON at read boundaries; incompatible/corrupt state becomes a visible blocked run, not an empty healthy team.

State updates, version checks and their events are one transaction. Storage exceptions cannot emit a success event. TeamStorage exposes transactional methods for run/task lifecycle and workspace/integration effects: reserve/complete workspace operation, publish immutable attempt artifact, append review, create integration intent, record prepared result, record principal decision, compare-and-set integration state, enumerate unfinished operations. Artifact ID equals attempt ID. Workspace links live in run/attempt/integration records; journals live in events. No separate artifact/workspace tables are required.

## Process and broker implementation

Spawn validated helper requests using native pipes, hidden Windows processes and tested shim handling. Never insert prompt text into a composed shell command. Parse protocol transiently in main memory; apply known-secret redaction to all strings before display, logging or persistence, including structured errors. Reuse `createSessionOutput`/complete-string scrubbing where applicable and test split secret fragments.

Only the selected helper credential is injected. Clear unrelated inherited provider variables and the team bridge token; preserve the required CLI-managed subscription behavior proved by 11-1. No whole-environment logging. Store PID plus process creation identity and executable identity for recovery, not PID alone. Termination must include descendants and prove cessation through the fixture; a kill call returning is not proof.

TeamBridgeService uses a new Node HTTP server bound to 127.0.0.1/ephemeral port. It accepts only bounded POST requests from the facade, validates Host/Origin and bearer token before parsing/domain dispatch, and binds the token to one run/generation. It serves tool schemas and calls, not arbitrary URLs/commands. Reject browser Origin requests and remote/redirected endpoints. Keep outstanding waits bounded, abort on request disconnect, and never equate disconnect with task cancellation. Do not share or widen the Fleet Comms listener.

The authorization provider creates only in-memory leases on explicit Launch/Resume, or a lead-only lease on explicit Recover. The broker enforces inspection-only operations in recovery mode. Validate authorized credential membership immediately before decryption and again after asynchronous preparation. Missing/deleted/rotated relationships block dispatch; no ambient credential fallback. Epoch changes invalidate old tokens. One token exists only in the lead/facade environment and broker memory. An all-local attacker remains outside the promised isolation boundary.

## Verification and handoff

Pure tests cover full state/effect sequences, simultaneous submits, failed preparation, duplicate terminal messages, cancellation during spawn, stale epochs, exhausted revisions and all review phases. Fixture children cover backpressure, fragmented protocol/secret strings, malformed output, Windows descendants, timeout and permission blockers.

The Electron verifier bundles/imports the real StorageService, uses disposable database paths, and tests fresh creation, upgrade from the immediately preceding schema, rollback, uniqueness, foreign keys, corrupt JSON, event ordering and reopen. Never open the installed database for mutations. Record the Electron/runtime versions and explicit assertion count.

Hand off stable executor/storage/workspace contracts to 11-3 and broker/service contracts to 11-4. Shared-contract corrections remain this task's ownership until 11-5's documented final handoff. Commit only task-owned changes and evidence, preserving the pre-existing working tree.


## Council disposition amendment — 2026-09-20

The [recorded council disposition](../Council-Disposition.md) and feature contract §10 are binding additions to this task/spec pair. Council review is recorded (partial run, limitations preserved); implementation evidence is recorded in Runtime-Verification.md.

Implement the complete final pre-spawn authorization fence including credential rotation fingerprint, normal/recovery operation scopes, immediate pausing denial, post-spawn revocation containment, and secret lifetime limits. Revoke active broker requests on generation changes. Implement the §10 HTTP/connection limits and negative environment tests. Add atomic capture reservations with existing attempt/capture/ref identity before Git effects. Store normalized review evidence. Tests must assert zero team credential/lease/process activity at boot and all Stop/Pause/rotation races.
