# Council brief 11.0 — Team authority, execution, and integration

Created 2026-09-20. **Authored, not run. No findings or approval are claimed.**

## Decision context

Chorus currently supervises independent CLI sessions. Phase 11 adds one interactive lead delegating to cross-provider helpers in isolated worktrees. The user selected Claude and Codex leads, mixed subscription/API authentication, CLI helper engines, a fixed allowed model roster, two integration policies, and paused restart recovery.

Read the [feature specification](chorus-team-sessions-spec.md), [phase overview](Tasks/Phase-11-Overview.md), and paired [runtime](ImplementationSpecs/ImplementationSpec-11-2.md) and [integration](ImplementationSpecs/ImplementationSpec-11-3.md) specifications. The [master plan](../../Plan.md) §12 already states that CLI shell actions are not fully intercepted by Chorus. That remains true.

The council reviews the proposed implementation boundary. It must not substitute a single-provider/read-only/helper-only release for the user's chosen scope.

## Questions

1. **Credential authorization:** Is explicit Launch/Resume authority scoped to a run generation and roster sufficient for just-in-time helper decryption? Examine the narrower explicit Recover lead-only lease, lease revocation, prepare/spawn races, credential rotation/deletion, helper environment isolation, and the guarantee of zero boot decryption. Name missing checks and their owning task.
2. **Bridge boundary:** Review the tools-only stdio facade and authenticated 127.0.0.1 broker. Are token transport, Host/Origin checks, limits, generation binding, cancellation semantics, no inherited helper token, and no global config mutations adequate? Review the choice of a small dependency-free protocol surface and require conformance evidence rather than assuming it.
3. **Permission honesty:** Does the plan accurately distinguish Chorus-managed concurrency and integration approval from CLI-native permissions and cooperative worktree isolation? Can both required leads/helpers finish or block visibly without inaccessible prompts? Identify any claimed enforcement the app cannot deliver.
4. **Artifact and approval identity:** Review temporary-index snapshots, injected-file exclusion, immutable refs, staged integration, exact prepared-content approval, clean-tree checks, and stale-evidence handling. Can any changed artifact or new integration HEAD reuse approval? What must be checked before publication and promotion?
5. **Durability:** Review seven-table ownership, transaction/event atomicity, request idempotency, attempt ceilings, orphan identity, and Git/SQLite effect journals. For each crash boundary, specify evidence that distinguishes unapplied, applied, and ambiguous work without repeating writes or deleting evidence.
6. **Lifecycle:** Does Pause drain and Stop cancel coherently across lead, helpers, broker, deadlines and integration? Are ordinary restore/restart/duplicate/delete paths prevented from bypassing team policies? Assess the explicit replacement-lead handoff when conversation resume cannot be proven.
7. **Quality and measurement:** Are lead-only/team comparisons fair enough to reveal coordination overhead and quality regressions? Is incomplete provider/subscription metering disclosed accurately? Are acceptance tests bound to the actual integrated revision?

## Required response

For each numbered question: approve, qualify, or revise; state a concrete defect scenario where applicable, severity, affected contract/task, and proposed resolution. Separate source-verified facts from assumptions requiring a probe. Preserve dissent. Do not assert that a tool flag works without versioned primary documentation or captured runtime evidence.

## Disposition and gate

Run through Chorus's existing council workflow before implementing Phase 11. Store findings beside this brief as `CouncilBrief-11.0-TeamAuthority-Findings.md`; record adopted/rejected qualifications and reasons in a separate disposition section or document. Update the normative spec and affected task/spec pairs before execution when a ruling changes their behavior.

This brief does not approve new dependencies, authorize global tool configuration changes, or claim a review has occurred. If no council run is available, leave the implementation gate open and complete other planning validation; do not fabricate findings.


## Architecture exhibits for the council

The following source snapshots are included because council API members cannot open local Markdown links. Captured 2026-09-20 before implementation.

### Exhibit: chorus-team-sessions-spec.md

# Chorus Team Sessions — implementation contract

Created 2026-09-20. Status: **specified, not implemented or runtime-verified**.

## 1. User intent and decision record

Decisions below are phase-local; their D-numbers do not allocate entries in Foundation's global ledger. D1–D12 record the user's answers in the planning conversation, locked 2026-09-20. D13–D17 are the engineering defaults from the proposed plan, made explicit for execution. Changes require an amended decision with a reason, not an implementer's silent scope reduction.

| Decision | Contract |
|---|---|
| D1 | One lead terminal with expandable helper activity; no separate interactive helper terminals. |
| D2 | Lead assigns bounded work and reviews results; helpers implement and test. |
| D3 | Pursue quality, cost, and speed together; quality gates acceptance, all three measured. |
| D4 | Cross-provider teams and mixed subscription/API authentication are first-release requirements. |
| D5 | Both Claude Code and Codex must work as interactive leads. |
| D6 | Helpers run through compatible installed Claude Code, Codex, or opencode CLIs; Chorus does not build a new coding engine. |
| D7 | User selects an allowed roster and concurrency limit; lead selects members and roles within it. |
| D8 | Writing helpers use isolated worktrees. The lead owns review and coordination. |
| D9 | User steers only through the lead; helper inspection is read-only. |
| D10 | Integration policy is selected per session: ask before integration or lead integrates. |
| D11 | New team launch and saved presets; upgrading an existing conversation is deferred. |
| D12 | Bounded automatic recovery; app restart restores a paused team; concurrency and time controls, no promised dollar cap. |
| D13 | Default concurrency 2, configurable 1–8; attempt timeout 30 minutes, configurable 5–240; maximum 3 attempts per task, including revisions/reassignments. |
| D14 | Default integration policy is ask-before-integration. The team starts at an explicitly selected committed Git revision in a dedicated integration worktree. |
| D15 | No nested Chorus delegation; no automatic roster expansion, push, publish, destination-branch merge, or branch deletion. |
| D16 | Phase 11 is a standalone post-v1 phase; no dependency on the future Mission Control scheduler. |
| D17 | No new runtime dependency is planned. The small tools-only stdio bridge uses Node built-ins and the documented MCP protocol. A dependency change requires the repository's normal explicit approval. |

## 2. Launch and visible behavior

The new Team entry in LaunchDialog opens TeamLaunchDialog. Select a project/base revision, lead configuration, one or more helper configurations, concurrency, timeout, and integration policy. A roster member is a stable ID plus a label and an explicit harness/provider/auth/model/effort configuration. Duplicate models with different configurations are allowed; helpers are instantiated per task rather than kept alive indefinitely. Limit a roster to 16 entries. Models without a verified execution path are disabled with a reason.

Save this configuration as a named team preset. Presets store credential references, never credentials. Launch snapshots non-secret settings, including resolved route and model, so later preset edits do not alter a run. On resume, resolve credentials again and verify their provider relationship; if the underlying route or auth relationship changed, require a new reviewed configuration rather than silently reroute.

Create the integration worktree from a resolved commit SHA. All Chorus-generated MCP, instruction and hook configuration for team leads/helpers must live outside their Git worktrees and be delivered per launch; a harness requiring project-file mutation is ineligible until that limitation is resolved. Do not copy dirty files from the source checkout, run dependency installers implicitly, or reuse a writable build output directory between helpers. Task briefs include project setup requirements where needed. The lead terminal remains a real PTY; helpers consume structured pipes.

The Team panel displays member/model, task, state, elapsed time, reported usage, artifact files, lead review, pending approval, and blockers. It offers team Pause, Resume, Stop and exact-change Approve/Reject actions. It has no helper prompt box. Use text/icons as well as color and support keyboard navigation.

## 3. Main-process boundaries

- SessionManager owns the lead PTY and managed helper process handles; a helperProcess utility supplies pipe parsing and process-tree teardown. Helpers are not fake terminal sessions or new AgentKind values.
- TeamService owns run/task state and schedules ready tasks through an injected executor. The pure teamCore decides transitions, limits, deduplication, and dependency readiness.
- TeamWorkspaceService owns workspace/artifact/integration effects. It uses the existing GitWorktreeManager journal and additive managed-workspace methods.
- TeamStorage shares StorageService's SQLite connection through a narrow factory. Do not open a second writable connection or put SQL in the renderer.
- TeamBridgeService is a new authenticated loopback broker. A tools-only stdio facade launched by the lead forwards validated calls to it. Fleet Comms sockets and the third-party Neo4j MCP server are not repurposed.
- All renderer IPC is typed and Zod-validated in main on input and output; preload forwards names/types without executing Zod. Convert Vue proxies to plain objects before crossing the bridge.

Task documents define exclusive ownership. Task 11-4 alone wires production composition, IPC, preload, and renderer entry points. Task 11-5 may revisit these files for the specified recovery and hardening work after handoff.

## 4. Team control and context

The lead alone receives the team MCP configuration and contract instructions. The instructions explain when to delegate, how to make independent tasks, how to inspect results, and when to wait. They require the lead to use this workflow for the selected team rather than launch untracked native subagents. This is a cooperative CLI policy, not an OS sandbox guarantee.

Expose exactly these tool operations, with schemas served from the broker's common contract:

| Tool | Inputs and result |
|---|---|
| `team_roster` | No input; authorized member capabilities, limits, run status. No credential values. |
| `team_delegate` | clientRequestId, memberId, kind (`code`/`analysis`), title, brief, acceptance criteria, context, advisory paths, dependsOn; returns durable taskId immediately. |
| `team_status` | Optional taskId, afterSequence; returns current state and bounded event page. |
| `team_wait` | taskIds, afterSequence, timeoutMs (0–20000); returns changed results or running status. A wait timeout never cancels tasks. |
| `team_review` | taskId, attemptId, phase (`artifact`/`prepared`/`integrated`), integrationId for the latter two, exact reviewed SHA, verifiedHead for integrated phase, decision (`accept`/`revise`), review/test evidence; immutable review event. Analysis uses artifact phase without a SHA. |
| `team_revise` | taskId, clientRequestId, memberId, revised brief; new attempt only after a revisable result/failure and below the attempt ceiling. |
| `team_integrate` | action (`prepare`/`apply`), taskId, attemptId, reviewedHead, expectedIntegrationHead, clientRequestId, integrationId on apply; returns integrationId and pending/complete/block status. |
| `team_cancel` | taskId, reason; idempotent, preserves work and result history. |

Task context is a bounded, explicit brief plus relevant paths and prior result references. Do not copy the lead's whole transcript or unrelated helper output. Shared project memory is optional and must identify the branch/base revision; it is not the authority for the current tree. Helper output is untrusted evidence and cannot rewrite run policy or grant permissions.

Use strict schemas: request body at most 1 MiB; brief/context each at most 64 KiB UTF-8; at most 32 existing dependency IDs and 128 advisory paths; title 200 characters. Reject oversized input, do not silently truncate task instructions. Task IDs and roster membership are scoped by the authenticated run. Dependencies can refer only to existing tasks in that run, preventing forward cycles. A failed dependency blocks its dependents. An analysis dependency is ready on accepted review; a code dependency is ready only after integration.

Client request IDs are unique per run and operation. Before a run exists, launch is durably unique by project and client request ID. Same ID and canonical payload returns the original acknowledgment; reuse with different payload returns `REQUEST_CONFLICT`. Persist canonical hashes and original acknowledgments for launch, delegate, revise and both integration actions. Polling and reconnect do not create tasks. A helper must produce a valid structured completion plus observed process termination before review; an exit code alone is insufficient.

Analysis results do not require code integration. Their adapter permissions must deny edits; a changed analysis worktree invalidates the result. Conservatively allocate isolated worktrees for both kinds in the first release.

## 5. Persistence and lifecycle

Add seven tables: team_presets, team_runs, team_members, team_tasks, team_attempts, team_events, team_integrations. Keep helper attempts separate from ordinary sessions; the run references its lead session. Allocate migration IDs at execution after checking the merged registry and database evidence, never from this planning snapshot.

Runs store status, generation, immutable config snapshot, project/base SHA, lead session ID, integration worktree ID, and policy. Members store the roster snapshot and credential references. Tasks store normalized briefs, dependency IDs, current attempt, status, and client request identity. Attempts store member, base SHA, worktree ID, process identity, deadline, terminal outcome, immutable artifact/result, and nullable usage with provenance. Events provide ordered, sanitized state/review/workspace journals. Integrations store reviewed artifact, expected base, staging worktree, prepared result SHA, approval principal/version, and state. Presets store versioned configuration for future launches.

Artifact identity is the attempt ID. Store its manifest and SHA/reference in the attempt's immutable artifact payload; reviews live in events. Workspace operation IDs are durable, unique journal entries tied to the run/attempt/integration records. State changes and their events are one transaction. Enforce one applying integration per run and compare-and-set versions for decisions. Multiple prepared requests may coexist, but an integration HEAD change invalidates their preparation and approval. Delete presets without deleting historical runs; historical snapshots survive renamed/deleted profiles. Missing credentials block resume. No automatic history or worktree deletion.

Runs: `preparing → active → pausing → paused`, with `stopping → stopped`, `completed`, `recovering`, or `blocked` where appropriate. The panel's Complete action is accepted only when no unfinished work or integration remains; it revokes the run lease. Explicit Resume may reopen a paused/completed run after revalidation and reestablishing its generation-scoped lead bridge. Before replacement, confirm the prior lead process tree has stopped; preserve the run's lead session record and verified conversation pointer. Unknown prior-lead identity blocks replacement. Task states: queued, running, awaiting-review, needs-revision, awaiting-approval, integrating, completed, blocked, failed, cancelled. Attempts separately record succeeded, failed, interrupted, timed-out, cancelled, or permission-blocked. A stopped/failed attempt is never presented as a successfully completed task.

Queue ordering is ready-time then creation order. Each reserved/active attempt holds one concurrency slot until preparation fails or its entire owned process tree is confirmed stopped. Preparation has a separate five-minute bound; execution timeout begins at process start; queue time is displayed separately. The lead may request a revision/reassignment within the same three-attempt ceiling. Failed preparation/spawn consumes an attempt too; no hidden attempt budget. Exhaustion requires lead explanation and a new user-directed task, not a silent reset.

Pause prevents new dispatch and integration, allows active helpers to finish, and lets an already-applying atomic integration settle. The panel says Pausing until drained. Stop cancels helpers and lead, rejects new effects, settles or records an in-progress Git operation, and preserves evidence. Resume is an explicit user action, not a timer. Closing a pane detaches its view; explicit stop/quit owns process termination.

## 6. Credentials, bridge, and honest enforcement

Launch/Resume creates an in-memory authorization lease scoped to run generation and the selected credential IDs. TeamService may decrypt an authorized credential just before dispatch during that lease; no secret is persisted with it. Pausing drains existing work but disallows new decryption; paused/stopped/completed/blocked runs revoke the lease. Recovery mode uses only its separate narrow lease. App exit/crash invalidates all leases. Boot never decrypts or automatically restarts a team lead, including subscription-authenticated leads.

Explicit recovery-only launch is a separate user action with a lead-credential-only lease and inspect-only broker; it cannot authorize helpers or integration. It ends on exit or transition to normal Resume.

Each lead receives a fresh random bridge token through an environment variable; the MCP configuration contains only its variable name/placeholder. The loopback broker binds 127.0.0.1 on an ephemeral port, validates Host, rejects browser Origin requests, authenticates before dispatch, and validates body size/run generation. The facade forwards to an env-provided local endpoint; it must reject non-loopback destinations. Never pass the bridge token, lead credential, or unrelated provider keys into helpers. Rotation/revocation makes old tokens fail closed.

The stdio facade supports MCP initialization/lifecycle, ping, tools/list, tools/call and cancellation notifications for outstanding waits. Cancelling a wait is not `team_cancel`. Declare only tools capability; no sampling, resources, prompts, arbitrary URLs, or external callbacks. Use protocol revision 2025-06-18 and test version negotiation with both installed lead clients in 11-1. stdout is protocol only; stderr is sanitized. The private bridge-to-broker HTTP endpoint is not an advertised Streamable HTTP MCP server.

Default helper permission intent is local file edits and test commands inside its assigned worktree, no interactive prompt, no inherited full-access override. Adapter probes must demonstrate the actual CLI mode; do not relabel broad tool permissions as filesystem enforcement. Permission denials return to the lead as blockers. Configurations that cannot safely finish or fail without invisible prompts are ineligible. Worktrees and cooperative lead instructions are not a security boundary against arbitrary shell commands, other local processes, or malicious repository code. UI approval governs Chorus-managed integration only.

Disable native recursive agent tools using supported adapter controls where available. Record residual behavior where a CLI cannot enforce that policy. The displayed concurrency bound is explicitly **Chorus-managed helpers**, not a claim about every subprocess a coding CLI can create.

## 7. Artifacts and integration

Only after the helper process tree exits, capture the base-to-result tracked changes and nonignored untracked candidates into an isolated temporary Git index. Exclude Chorus-generated configuration and require an explicit path manifest; ignored secrets/build outputs are never force-added. Do not alter the helper's existing index. Create an immutable, single-parent artifact commit based on the attempt base and keep it reachable by a private Chorus ref. Unexpected submodule/conflict states block capture for lead resolution.

The lead reviews the artifact and test evidence. For code, acceptance permits an integration request but does not yet complete the task. Approval binds artifact SHA, expected integration HEAD, prepared-result SHA, immutable preparation ID and policy version. A change to any bound value invalidates approval. Mutable record versions are used only for compare-and-set decisions; recording approval does not invalidate itself. Ask-before-integration requires a renderer user decision; lead-integrates records the lead's decision under the launch authorization.

Prepare integration in a separate staging worktree at expected HEAD using the immutable artifact, yielding a single-parent prepared commit. The lead reviews that prepared diff through `team_review` before either policy can authorize apply; the user then decides when the policy requires it. Conflicts remain in staging and block the request. A cooperative integration lease tells the lead to stop editing the integration tree. Recheck clean tree/index, expected HEAD, approval, and generation immediately before ff-only promotion. Never force-reset or overwrite unexpected edits. Journal expected and result SHAs before promotion. Task 11-3's spec defines effect ordering and failure recovery. After promotion the code task returns to awaiting-review for integrated verification: the lead records `(integrationId, originalResultSha, verifiedHead, testEvidence)`. verifiedHead must equal the current clean HEAD and descend from originalResultSha. This permits fresh tests after another valid integration or lead checkpoint. Only accepted integrated verification completes the task. Failed checks block the task for a counted revision. Distinguish helper-reported checks from lead-verified checks; later changes invalidate claims about the current tree but do not rewrite historical evidence.

Git and SQLite cannot commit atomically. On recovery, compare journaled SHAs with actual branch/worktree/index state. Recognize an already-promoted result once; never replay merely because the database write was interrupted. Ambiguous evidence blocks integration and preserves all work. User destination branches remain untouched by the team integration service.

## 8. Recovery, reporting, and acceptance

Before ordinary session restore, exclude every team-owned lead and reconcile team records. Verify process creation identity before terminating an orphan; PID alone is insufficient. Unknown identity blocks new writing attempts in that workspace. Restore history/workspaces as paused with interrupted attempts, without replaying prompts or decrypting keys.

Explicit Resume revalidates configuration, credentials, workspaces, and ownership. Resume the lead only through a verified adapter conversation pointer. If unavailable, start a visibly labeled replacement lead conversation carrying the persisted task/result handoff. Never imply that the original conversation survived. Interrupted helpers are not automatically rerun; the lead chooses a counted retry or explains the blocker.

Retained dirty lead work with all writers accounted for and no ambiguous applying integration may be opened with the panel's Recover action. This launches only a recovery lead under a lead-credential-only lease; bridge access is inspect-only and helper dispatch/integration remain disabled. The user can steer that lead to inspect/checkpoint retained work. Normal Resume repeats reconciliation and confirms recovery-lead exit before a fresh active generation. Unknown writers or ambiguous promotion remain blocked and require explicit external resolution; recovery mode cannot bypass them. Preparing runs with a timed-out handshake use explicit Activate retry against the existing lead, never a duplicate launch.

Report nullable provider-sourced token/cost fields and their coverage. Subscription cost is unknown unless a defensible source exists, never zero. Do not double-count helper events and transcript telemetry. Cap retained event text at 10 MiB per attempt with a visible truncation marker while preserving terminal outcome, artifact and review records; keep the latest 1 MiB result and reject oversized structured results rather than guessing success.

Acceptance includes both leads, two simultaneous helpers, a cross-provider roster, both auth modes, both approval policies, dirty workspace refusal, timeout/retry exhaustion, crash recovery at every durable boundary, credential isolation, packaged bridge operation, and ordinary-session regressions.

Compare three tasks (bug fix, parallelizable feature, refactor with tests), three paired lead-only/team runs each: 18 runs. Hold task/base/environment/lead/acceptance tests fixed within each pair; alternate run order. Report quality, elapsed time, human interventions, lead usage, total available usage and cost, coverage, median and range. Improvements are evaluated, not guaranteed; regressions stay in the report.

## 9. References and gates

Current interface references inspected during planning; exact installed-version flags still require 11-1 runtime evidence:

- [Claude programmatic execution](https://code.claude.com/docs/en/headless): structured helper execution.
- [Codex non-interactive execution](https://learn.chatgpt.com/docs/non-interactive-mode): structured events and automation.
- [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli): lead tool delivery.
- [opencode CLI](https://opencode.ai/docs/cli/): external-model helper execution.
- [MCP transport](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports) and [tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools): bridge conformance.

[Council review](CouncilBrief-11.0-TeamAuthority.md) precedes feature implementation. Record the disposition in this feature folder and update contracts if the council finds a flaw. An unmet probe or review gate is reported as unmet; it does not remove a user-selected requirement.

### Exhibit: ImplementationSpecs/ImplementationSpec-11-2.md

# Implementation specification 11-2 — Durable runtime and process ownership

Paired [task](../Tasks/Task-11-2.md). Normative [feature contract](../chorus-team-sessions-spec.md). **Planned, not executed.**

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

### Exhibit: ImplementationSpecs/ImplementationSpec-11-3.md

# Implementation specification 11-3 — Artifacts, review, and integration

Paired [task](../Tasks/Task-11-3.md). Normative [feature contract](../chorus-team-sessions-spec.md). **Planned, not executed.**

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
