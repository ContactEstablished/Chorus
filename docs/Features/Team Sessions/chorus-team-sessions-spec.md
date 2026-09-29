# Chorus Team Sessions — implementation contract

Created 2026-09-20. Status: **implementation and runtime verification in progress; release/evaluation gate open**. See [current progress](Implementation-Progress.md).

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

## 10. Council amendments — 2026-09-20

The [recorded disposition](Council-Disposition.md) adopts the partial council's requirements below. These amendments take precedence over less-specific earlier wording. Implementation and runtime evidence remain separate gates.

Authorization carries run/generation, lease epoch and mode (`normal`/`recovery`), credential reference and rotation fingerprint, provider/auth/route snapshot, and allowed operations. Revalidate this fence after awaited decryption and immediately before environment construction/spawn; do not retain secrets during workspace preparation. Deny new preparation/decryption/spawn in pausing or terminal states. If revocation races OS spawn, terminate the positively identified process tree and preserve a blocked outcome. Release secret references promptly; JavaScript memory zeroization is not promised. Each explicit Resume/replacement increments generation, revokes old tokens and aborts their active connections/waits. Activate does not rotate or spawn.

Recovery and pausing broker access allows only `team_roster`, `team_status`, and `team_wait`. All mutations, including review, revision and cancellation through the lead, are denied; renderer Stop retains its lifecycle authority. Recovery permits only explicit recovery-lead credential resolution. Boot has zero team credential resolution, team lease issuance, helper/lead spawn or automatic activation; existing unrelated attribution reconciliation is outside this team assertion.

Parse broker endpoints structurally: HTTP, exact literal 127.0.0.1, explicit valid nonprivileged port, no userinfo/query/fragment, and only the advertised private route. Use direct Node HTTP requests with no proxy/redirect/upgrade support. Bound headers to 16 KiB, frames/bodies to 1 MiB, pending facade calls and broker requests per token to 32, headers to 10 seconds, body reading to 10 seconds, and response completion to 30 seconds (waits already max 20 seconds). Enforce token/run/generation/epoch/mode on every request. Disconnect/revoke aborts a wait only, never a task. Declare truthful tool read/write annotations and prove both clients' approval behavior without global config mutation.

Helper eligibility requires versioned native permission evidence and visible unattended completion or denial. Structured vendor denials produce permission-blocked; an unexplained hang produces timeout/unknown cause. Analysis requires native edit denial plus a clean post-exit tracked/nonignored tree. Subscription routes explicitly use the CLI-managed current account; independent per-roster subscription identities remain unavailable absent a proven per-launch mechanism. Known owned processes must be confirmed stopped; unknown descendant/writer identity blocks capture and slot/workspace reuse. This does not claim visibility into arbitrary same-user processes.

Before any artifact Git write, transactionally reserve the existing attempt ID, capture operation ID, base SHA, expected ref namespace and immutable service identity/timestamp. Record run/attempt/capture IDs in the service-created commit message. After tree/commit creation, journal intended tree/commit SHA before create-if-absent ref publication; then publish metadata. Reconciliation enumerates the run's private refs and checks reserved identities, parents, tree/manifest and intended SHAs. Unknown/mismatched refs block; never allocate a replacement attempt to hide one. Apply the analogous reserved preparation identity to integration refs. Inject crashes at each reservation/object/ref/publication boundary.

Review evidence includes exact command, outcome, workspace context, verifiedHead, relevant test-source paths/diff identity, and provenance (helper-reported, lead-rerun, automated acceptance, user-accepted, integrated-head verified). Compare equal verification depth; retain historical evidence when HEAD changes. Report approval-wait time separately, identify per-run metering sources/coverage and cost-known/unknown subsets, label subscription list-price estimates separately from billed spend, and limit benchmark conclusions to the measured tasks.
