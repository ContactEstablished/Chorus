> ⚠ **PARTIAL RUN — 3 of 4 members completed.**
>
> - GLM 5.3 refused at **positions** (round 0): The model returned an empty answer (its output budget may have gone to reasoning).
>
> These findings are the output of a council that did not fully convene. Read them as such.

> ⚠ **These findings are model deliberation, not verified fact.** Every claim below was produced by language models reading the brief. Nothing here was compiled, executed or tested, and no model in this council could see the repository. This project’s own CR-3b.0 was unanimous, its rulings were sound, and the code it shipped had four compile errors. Verify anything you are about to rely on.

# CouncilBrief-11.0-TeamAuthority-Findings.md

**Council findings — Team authority, execution, and integration**  
**Date:** 2026-09-20  
**Status:** Review completed against supplied planning exhibits and member submissions.  
**Implementation status:** Not implemented; no runtime behavior, CLI flag, protocol behavior, dependency, or provider capability is approved or assumed by these findings.

## Scope and evidentiary standard

This review evaluates the authored Phase 11 contracts supplied in the brief:

- `chorus-team-sessions-spec.md`
- `ImplementationSpecs/ImplementationSpec-11-2.md`
- `ImplementationSpecs/ImplementationSpec-11-3.md`

“Source-verified” means verified against those supplied documents only. It does **not** mean runtime-verified.

Claims requiring installed CLI behavior, MCP client compatibility, subscription-authentication isolation, permission flags, process behavior, provider metering, or Git behavior under a particular environment remain **probes** until supported by:

1. versioned primary documentation; and
2. captured runtime evidence from the installed versions to be supported.

This ruling does not approve new dependencies, global configuration changes, provider authentication assumptions, or scope reduction from the selected multi-provider/mixed-auth scope.

---

# Executive disposition

| Question | Ruling | Gate condition |
|---|---|---|
| Q1 — Credential authorization | **QUALIFY / Approved with revisions** | Add fenced spawn authorization, recovery operation allowlist, pausing denial, and zero-boot-decryption tests. |
| Q2 — Bridge boundary | **QUALIFY / Approved with revisions** | Tighten endpoint and resource controls; capture MCP conformance evidence for both required leads. |
| Q3 — Permission honesty | **REVISE** | Define and prove visible noninteractive completion/blocking; correct all UI and contract enforcement claims. |
| Q4 — Artifact and approval identity | **QUALIFY / Approved with revisions** | Incorporate durable artifact identity repair and real-Git validation evidence. |
| Q5 — Durability | **REVISE** | Durably reserve attempt/capture identity before Git side effects; implement the full recovery matrix. |
| Q6 — Lifecycle | **QUALIFY / Approved with revisions** | Define generation rotation, stale bridge disconnection, pausing operation rules, and cross-service deletion/restore guards. |
| Q7 — Quality and measurement | **QUALIFY / Approved with revisions** | Normalize verification provenance, attribute approval-policy delay, and disclose per-run metering coverage. |

The implementation gate remains open. Phase 11 must not proceed as an implementation-ready feature until the normative feature contract and paired task/spec documents incorporate the adopted revisions below.

---

# Per-member positions

## DeepSeek v4 Pro 0813

| Question | Position | Principal contribution |
|---|---|---|
| Q1 | Qualify | Identified the prepare/spawn revocation race and requested a concurrent Stop-during-spawn test. |
| Q2 | Agree | Found the bridge design conservative but required runtime conformance probes for protocol-only stdout and installed client behavior. |
| Q3 | Qualify | Identified lack of a defined detection path for invisible helper prompts; requested `permission-blocked` rather than generic timeout. |
| Q4 | Agree | Found approval identity and staged review binding structurally coherent. |
| Q5 | Disagree | Identified the artifact-ref crash gap: Git ref can survive before durable artifact publication/attempt association. |
| Q6 | Qualify | Identified ambiguous generation/token behavior during lead replacement and Resume. |
| Q7 | Qualify | Required per-run metering-source disclosure, test-source identity, and normalized verification provenance. |

## Grok 4.6

| Question | Position | Principal contribution |
|---|---|---|
| Q1 | Qualify | Required explicit recovery operation scope, credential epoch checks, subscription isolation evidence, and zero-boot-decrypt tests. |
| Q2 | Qualify | Required exact endpoint validation, per-request generation/mode checks, and conformance evidence. |
| Q3 | Qualify | Distinguished cooperative isolation from enforceable containment; treated inaccessible prompts as release-blocking for affected configurations. |
| Q4 | Agree | Confirmed exact approval tuple and pre-promotion verification requirements. |
| Q5 | Qualify | Supplied a useful applied/unapplied/ambiguous crash-classification matrix. |
| Q6 | Qualify | Required restore exclusion, truthful Pause/Stop behavior, and cross-service lifecycle guards. |
| Q7 | Qualify | Required policy-delay attribution, null metering honesty, and verification tied to integrated revision. |

## Qwen 3.8 Max

Qwen’s submitted position was truncated during Q3. Its available positions are recorded without inferring conclusions for Q4–Q7.

| Question | Position available | Principal contribution |
|---|---|---|
| Q1 | Qualify | Required recovery-mode operation scope, final credential epoch check, pausing denial before final revocation, subscription isolation probes, and zero-boot-decrypt tests. |
| Q2 | Qualify | Required exact loopback/no-redirect parsing, HTTP resource limits, per-call generation/mode checks, and no-global-mutation evidence. |
| Q3 | Qualify, incomplete record | Supported honest enforcement boundaries and runtime proof of visible helper completion/blocking. |
| Q4–Q7 | No complete position captured | No conclusion attributed. |

---

# Findings by question

## Q1 — Credential authorization

### Ruling: **QUALIFY / Approved with revisions**

The proposed model—explicit in-memory Launch/Resume authority scoped to a run generation and selected credential references—is suitable as the authorization basis for just-in-time helper decryption. It is not sufficient as written until revocation, recovery, pausing, and spawn-race behavior are made explicit and testable.

### Source-verified facts

The supplied feature contract states that:

- Launch and Resume create in-memory authorization leases scoped to run generation and selected credential IDs.
- Helper credentials may be decrypted only just before dispatch.
- No secret is persisted with an authorization lease.
- Pause, Stop, Complete, Blocked, application exit, and crash revoke or invalidate authorization.
- Boot must not decrypt credentials or restart a team lead.
- Recover is separate, lead-credential-only, and inspect-only.
- Helper environments receive only the selected helper credential.
- Helper environments must not inherit the bridge token, lead credential, or unrelated provider keys.
- Resume must resolve credentials again and reject changed route/provider/auth relationships rather than silently rerouting.
- ImplementationSpec 11-2 requires a credential check before decryption and another check after asynchronous preparation and before spawn.

### Defect 1 — Prepare/decrypt/spawn revocation race

- **Scenario:** A helper credential is resolved or decrypted; workspace preparation begins; then Stop, Pause, credential deletion, credential rotation, lease revocation, or generation replacement occurs. The stale credential is still inserted into a helper environment and the helper is spawned.
- **Severity:** High.
- **Affected contract/task:** Feature contract §§5–6; ImplementationSpec 11-2 TeamService dispatch workflow, authorization provider, and `helperProcess`; Task 11-2.
- **Required resolution:**
  1. Reserve the attempt before workspace preparation.
  2. Do not retain a decrypted secret across an uncontrolled asynchronous boundary.
  3. Immediately before constructing the helper environment, validate a single authorization fence containing:
     - run ID;
     - run generation;
     - lease epoch;
     - lease mode;
     - credential ID;
     - credential row/version or rotation epoch;
     - provider/auth/route relationship;
     - current run state.
  4. Treat `pausing`, `paused`, `stopping`, `stopped`, `blocked`, and `completed` as authorization-denying states for new decryption and spawn.
  5. On failed validation, discard/zeroize resolved secret material, do not spawn, and record a visible credential-blocked or revoked outcome.
  6. If revocation races after OS process creation, terminate the known process tree immediately, preserve evidence, and record a revocation-raced/blocked outcome.

The council rejects any absolute claim that application-level code can make authorization perfectly atomic with every platform’s process creation behavior. The enforceable requirement is a linearized pre-spawn fence, immediate containment of post-fence races, and evidence that useful work does not proceed after revocation.

### Defect 2 — Recover authority is insufficiently defined

- **Scenario:** A recovery lead has a valid generation-bound bridge token and invokes `team_delegate`, `team_revise`, `team_integrate`, or a mutating review action. The service treats recovery as equivalent to a normal generation and decrypts a helper credential or mutates integration state.
- **Severity:** High.
- **Affected contract/task:** Feature contract §6; ImplementationSpec 11-2 TeamBridgeService and TeamService; Task 11-4 MCP/IPC composition.
- **Required resolution:** Add explicit lease modes:
  - `normal`;
  - `recovery`.

  Recovery mode must have an explicit broker and TeamService operation allowlist. It may allow read-only inspection operations such as roster, status, wait, and evidence retrieval. It must reject delegation, revision, helper dispatch, helper decryption, integration preparation/application, user-approval impersonation, and other mutable effects.

### Defect 3 — Pausing must deny new decryption immediately

- **Scenario:** The run has entered `pausing`, but active work has not drained. A workspace preparation completes and dispatch proceeds because the lease is not formally revoked until the later `paused` transition.
- **Severity:** Medium.
- **Affected contract/task:** Feature contract §5; ImplementationSpec 11-2 lifecycle and scheduling; Task 11-2.
- **Required resolution:** Define `pausing` as immediately dispatch-denying and decryption-denying. Active helpers may drain, but no new preparation, credential resolution, spawn, integration preparation, or integration apply may begin.

### Defect 4 — Subscription-authentication isolation is unproven

- **Scenario:** Two roster entries are configured with different subscription identities, but a CLI reads an ambient OS keychain, home-directory profile, or shared global session. Both helpers silently use the same account.
- **Severity:** High.
- **Affected contract/task:** Feature contract §§2, 6, and 9; Task 11-1 probes; Task 11-2 environment composition.
- **Required resolution:** Task 11-1 must capture installed version, auth route, required local configuration, and identity-isolation behavior for every supported helper engine/auth mode combination. A combination that cannot demonstrate correct routing and isolation must be disabled with a visible reason.

### Defect 5 — Zero boot decryption needs a negative test gate

- **Scenario:** Ordinary restore, session healing, subscription-session recovery, or bridge setup resolves credentials or spawns a team-owned process before explicit Resume.
- **Severity:** High.
- **Affected contract/task:** ImplementationSpec 11-2 restore exclusion; Task 11-4 composition; Task 11-5 recovery hardening.
- **Required resolution:** Add tests that open persisted preparing, active, paused, and interrupted team runs and assert before explicit user action:
  - zero credential decrypt calls;
  - zero lead/helper launches;
  - zero bridge lease issuance;
  - zero automatic Resume/Activate behavior.

### Assumptions requiring probes

- That supported subscription-authenticated leads can launch without Chorus storing/decrypting a secret at boot.
- That supported subscription helper modes can isolate selected identities without global configuration mutation.
- That deletion/rotation epoch behavior is observable by the credential provider in time to fence helper spawn.

---

## Q2 — Bridge boundary

### Ruling: **QUALIFY / Approved with revisions**

A tools-only stdio facade forwarding to an authenticated 127.0.0.1 broker is an appropriate small-surface architecture. It is not runtime-approved merely because the planned MCP revision and restrictions are present in authored specifications.

### Source-verified facts

The supplied plans require:

- Node HTTP broker bound to `127.0.0.1` on an ephemeral port.
- Fresh random bridge token per lead.
- Token delivery through environment rather than inclusion in MCP configuration.
- Host validation, browser-Origin rejection, authentication before domain dispatch, body-size limits, and generation binding.
- Facade rejection of non-loopback destinations.
- Tools-only MCP capability with no resources, prompts, sampling, arbitrary URLs, or external callbacks.
- Cancellation of a wait distinct from task cancellation.
- No inherited bridge token in helper environments.
- No reuse of Fleet Comms.
- No new dependency without separate approval.
- Planned protocol revision `2025-06-18` and client conformance testing with both required interactive leads.

### Defect 1 — Endpoint validation is not tight enough

- **Scenario:** The facade accepts an endpoint such as `http://127.0.0.1@attacker.example/`, an arbitrary hostname, userinfo, an unexpected route, or a redirect. It sends a bearer token outside loopback.
- **Severity:** High.
- **Affected contract/task:** Feature contract §6; ImplementationSpec 11-2 facade/broker implementation; Task 11-4 packaging.
- **Required resolution:** Parse the endpoint structurally. Permit only broker-advertised loopback endpoint forms and an explicit route allowlist. Reject:
  - userinfo;
  - non-loopback hosts;
  - arbitrary DNS hostnames;
  - proxy use;
  - redirects;
  - protocol changes;
  - upgrades/websockets;
  - unapproved paths and query strings.

The route requirement must be an allowlist rather than an unnecessarily brittle hardcoded single path, as noted in the preserved DeepSeek dissent.

### Defect 2 — Generation and lease-mode validation must apply to every call

- **Scenario:** A token from a prior generation remains valid after Resume/replacement, or a recovery token invokes normal operations. A stale wait cancellation is accepted after the run changed generation.
- **Severity:** High.
- **Affected contract/task:** Feature contract §6; ImplementationSpec 11-2 TeamBridgeService and authorization provider.
- **Required resolution:** Bind every broker token to:
  - run ID;
  - generation;
  - token epoch;
  - lease mode.

Validate all fields for every request, including waits and cancellation notifications. Invalidate active connections and stale tokens on replacement, Stop, Complete, Blocked, and lease-mode changes.

### Defect 3 — Resource controls are incomplete

- **Scenario:** A same-user local process opens slow, incomplete, or excessive broker connections and exhausts request handling or outstanding waits.
- **Severity:** Medium.
- **Affected contract/task:** ImplementationSpec 11-2 TeamBridgeService.
- **Required resolution:** Add and test:
  - POST-only handling;
  - bounded headers;
  - request/read/write timeouts;
  - rejected upgrades;
  - bounded concurrent requests and waits per token/run;
  - disconnect-driven wait abort;
  - no conversion of disconnect/cancellation notification into `team_cancel`.

### Defect 4 — Lead PTY token exposure needs bounded claims

- **Scenario:** An interactive lead shell prints its environment, writes the bridge token into a repository file, or launches an untracked child. Chorus does not fully intercept CLI shell actions.
- **Severity:** Medium within the same-user/local-process threat model.
- **Affected contract/task:** Feature contract §6, UI/security language; Task 11-1 and Task 11-2.
- **Required resolution:** Prefer token placement solely in the facade process environment where supported by the actual lead client. If the lead must receive it:
  - redact known token fragments from retained logs/PTY output where feasible;
  - prevent token inheritance by helpers;
  - state that lead-process compromise and same-user process inspection are outside the promised isolation boundary.

### Defect 5 — Conformance and no-global-mutation claims require evidence

- **Scenario:** Installed Claude Code or Codex versions negotiate a different protocol, require unsupported MCP capabilities, emit invalid stdout, require global registration, or cannot perform wait cancellation safely.
- **Severity:** High gate for D5 and D17.
- **Affected contract/task:** Feature contract §§2, 6, and 9; Task 11-1; Task 11-4.
- **Required resolution:** Capture per-installed-version evidence for:
  - initialization and negotiated version;
  - tools-only capability;
  - `tools/list`;
  - `tools/call`;
  - wait cancellation;
  - protocol-only stdout under success and error conditions;
  - sanitized stderr;
  - rejection of stale/revoked tokens;
  - absence of project, home-directory, and global configuration mutation.

Unsupported client/configuration combinations must be disabled with an explicit reason. They must not silently widen the protocol surface, mutate global configuration, or remove a selected provider from scope.

### Assumptions requiring probes

- That both required interactive lead CLIs support the proposed stdio facade without global registration.
- That MCP revision `2025-06-18` is accepted by the installed lead versions.
- That protocol-only stdout remains clean under malformed requests, errors, debug settings, BOM/newline behavior, and cancellation.

---

## Q3 — Permission honesty

### Ruling: **REVISE**

The plans are commendably candid about worktree isolation and CLI instructions being cooperative. However, the release contract is not ready because it does not define an observable, mandatory eligibility test for inaccessible prompts or unverified native permission modes.

### Source-verified facts

The supplied plans accurately state that:

- Lead instructions against native recursive delegation are cooperative policy, not an OS sandbox.
- Worktrees do not contain arbitrary shell commands, other local processes, malicious repository code, or writes outside a worktree.
- The displayed concurrency limit is only for Chorus-managed helpers.
- Integration approval covers Chorus-managed promotion only.
- Native recursive-agent controls are applied only where supported, and residual behavior must be recorded.
- Helpers unable to complete or fail visibly without inaccessible prompts are ineligible.
- Analysis edit-denial relies on native adapter behavior; tracked/nonignored changes invalidate the result after execution.
- Ignored writes are not reliably detectable through Git alone.
- Permission denials are intended to return as blockers.

### Defect 1 — Invisible prompt behavior is not operationally defined

- **Scenario:** A helper without an interactive terminal waits on a login, trust, permission, or repository prompt. The panel shows only a generic timeout after a long wait, indistinguishable from a slow test suite.
- **Severity:** Critical for D5/D6 configuration eligibility.
- **Affected contract/task:** Feature contract §6; ImplementationSpec 11-2 helper adapters and attempt outcomes; Task 11-1 and Task 11-2.
- **Required resolution:** Define an adapter capability contract requiring:
  - documented noninteractive flags/configuration;
  - a known visible prompt-denial or permission-block signal;
  - bounded detection behavior;
  - mapping to `permission-blocked` or another explicit blocker state rather than generic timeout;
  - captured evidence that tested flags/configuration are present in the actual spawned command.

If a CLI/repository combination cannot demonstrate noninteractive completion or visible failure, it is ineligible.

### Defect 2 — UI language can overstate enforceability

- **Scenario:** The UI describes helpers as “isolated,” analysis as “edit-denied,” or concurrency as globally bounded in a manner implying OS-level containment.
- **Severity:** High for user trust.
- **Affected contract/task:** Feature contract §§2 and 6; Task 11-4 renderer copy and state taxonomy.
- **Required resolution:** Require user-visible language distinguishing:
  - “Chorus-managed helper concurrency”;
  - “cooperative worktree isolation”;
  - “CLI-native permission mode”;
  - “integration approval applies only to Chorus-managed promotion.”

The product must not claim it prevents:
- network access;
- writes outside the worktree;
- malicious repository actions;
- every nested agent;
- ignored-file writes;
- untracked descendants not attributable to the known process tree;
- concurrent local editor writes during promotion.

### Defect 3 — Analysis edit denial must not be relabeled

- **Scenario:** An analysis helper edits the worktree; Chorus notices after the fact and invalidates the result, while product language claims edits were prevented.
- **Severity:** Medium.
- **Affected contract/task:** Feature contract §§4 and 6; Task 11-1, Task 11-2, and Task 11-3.
- **Required resolution:** Distinguish native prevention proven by probe from post-hoc detection. Disable unsupported analysis configurations or accurately label them as post-execution detection rather than edit denial.

### Assumptions requiring probes

- That required Claude and Codex lead configurations can finish or visibly block without inaccessible prompts.
- That helper engines support actual tested noninteractive and native permission modes.
- That recursive-agent controls, where documented, work in the installed CLI versions.

---

## Q4 — Artifact and approval identity

### Ruling: **QUALIFY / Approved with revisions**

The artifact and approval identity design is structurally sound if its immutable identities are durably anchored. A changed artifact, prepared result, integration HEAD, preparation ID, or policy version must never reuse approval.

### Source-verified facts

The exhibits require:

- Capture through a temporary Git index without altering the helper’s real index.
- Explicit manifests and NUL-safe Git path handling.
- No force-add of ignored files.
- External Chorus-generated configuration rather than worktree mutation.
- Restoring pre-injection blobs for defensively handled tracked generated files.
- Explicit conflict when a helper edits a generated/injected path rather than silent exclusion.
- Immutable artifact commits based on attempt bases and retained under private refs.
- Preparation in a separate staging worktree at an expected integration HEAD.
- Approval binding to:
  - integration ID;
  - preparation ID;
  - artifact SHA;
  - integration head;
  - prepared-result SHA;
  - policy version.
- Separate artifact review, prepared-content review, policy decision, promotion, and integrated verification.
- Pre-promotion checks for generation, branch, expected HEAD, clean tree/index, identities, and one applying integration.
- Integrated verification requiring clean current `verifiedHead` and ancestry from original result SHA.

### Required correction 1 — Durable artifact identity before publication

- **Scenario:** An artifact ref exists after a crash, but no durable attempt/capture reservation identifies or reconciles it.
- **Severity:** High.
- **Affected contract/task:** ImplementationSpec 11-2 attempt reservation/journal APIs; ImplementationSpec 11-3 capture protocol; Task 11-5 recovery.
- **Required resolution:** Adopt Q5’s durable attempt/capture identity revision before treating approval identity as complete.

### Required correction 2 — Real Git fixtures are mandatory

- **Scenario:** Mocked Git tests miss helper-index mutation, binary or rename behavior, NUL-path handling, injected-file corruption, or stale approval reuse.
- **Severity:** Medium.
- **Affected contract/task:** ImplementationSpec 11-3 verification; Task 11-3 and Task 11-5.
- **Required resolution:** Require real temporary repositories and tests covering:
  - source checkout preservation;
  - helper index preservation;
  - binary, rename, deletion, untracked, and NUL-path cases;
  - injected-file restoration and helper-edit conflict;
  - stale artifact/prepared approval invalidation;
  - promotion against changed/dirty integration state.

### Required checklists

**Before artifact publication:**

- known helper/writer process identity has exited, or unknown liveness blocks capture;
- repository identity, expected branch, and base ancestry are valid;
- file snapshot is stable;
- manifest is complete and explicit;
- unresolved index/submodule states are absent;
- generated-config handling is correct;
- private ref identity is reserved and expected;
- immutable result payload is associated with the reserved attempt.

**Before promotion:**

- prepared review accepted;
- policy-appropriate approval exists;
- exact immutable tuple still matches;
- run generation remains current;
- expected integration HEAD and clean tree/index are present;
- no other integration is applying;
- `applying(expectedHead, resultSha)` is durable before Git effect;
- actual post-Git HEAD/tree state is classified before declaring success.

---

## Q5 — Durability

### Ruling: **REVISE**

The seven-table ownership model, transactional state/event writes, idempotency hashes, attempt ceiling, and Git/SQLite effect journals provide the correct architecture. The artifact-publication crash boundary is not safe enough as written.

### Source-verified facts

The exhibits specify:

- Seven tables: presets, runs, members, tasks, attempts, events, integrations.
- A shared StorageService SQLite connection and no second writable connection.
- Foreign keys, uniqueness, state/event atomicity, and compare-and-set transitions.
- Launch request idempotency and operation idempotency.
- Attempt ceilings that include failed preparation and spawn.
- Process creation/executable identity rather than PID alone.
- Journal-before-effect handling for artifact and integration operations.
- No automatic replay of interrupted helper attempts.
- No promotion replay solely because a metadata write was interrupted.

### Material defect — Artifact identity is not durably anchored before Git side effects

- **Scenario:** Git object creation and private artifact ref creation succeed. The process crashes before the SQLite attempt artifact payload is persisted. The ref survives, but recovery cannot reliably join it to a durable attempt reservation. A retry creates a new attempt identity, leaks the old artifact, or avoids intended ref conflict detection.
- **Severity:** High.
- **Affected contract/task:** ImplementationSpec 11-2 storage/journal APIs; ImplementationSpec 11-3 artifact capture steps 6–7; Task 11-5 recovery.
- **Required resolution:**
  1. Durably reserve the attempt UUID before capture.
  2. Durably reserve a capture operation ID and expected private-ref namespace before Git writes.
  3. Place recoverable reserved identity in immutable Git-visible metadata or an equivalently durable identity mechanism.
  4. During recovery, enumerate private artifact refs for the run and reconcile each to the reserved attempt/capture identity.
  5. Never create a substitute attempt ID to bypass an orphaned or conflicting ref.
  6. Add failure injection after:
     - attempt reservation;
     - object creation;
     - ref creation;
     - journal write;
     - metadata publication.

### Required crash-boundary evidence

| Crash boundary | Unapplied evidence | Applied or reconcilable evidence | Ambiguous evidence and required handling |
|---|---|---|---|
| Workspace creation | Reservation exists; expected worktree/path/HEAD absent | Managed path and expected journaled HEAD exist | Wrong HEAD, foreign content, unknown ownership; block and retain |
| Helper spawn | Attempt reservation, no valid process identity | Recorded process identity, observed termination, structured result | PID/descendant alive with unknown creation identity; block reuse |
| Artifact publication | Reserved attempt, no private artifact ref | Ref/object/base/manifest match reserved capture journal | Ref/payload mismatch, wrong parent, unknown ref identity; block |
| Integration preparation | No prepared ref/staging output | Prepared ref/result SHA/preparation ID match journal | Dirty/conflicted staging, missing object, identity mismatch; block |
| Promotion | `applying`; actual clean HEAD remains expected base | Actual clean HEAD equals prepared result; record applied once | Other HEAD, dirty tree/index, missing object, unknown writer; preserve and block |
| State/event transaction | No committed state/event | State and ordered event sequence committed together | Storage exception must never emit success |

### Additional mandatory controls

- PID alone must never authorize orphan termination.
- Unknown process identity blocks workspace reuse and new writing attempts.
- Identical idempotency request returns original acknowledgement.
- Same request ID with a differing canonical payload returns `REQUEST_CONFLICT`.
- Recovery must run before ordinary session restore/relaunch behavior.
- An `applying` integration whose actual HEAD remains at expected base must not be automatically replayed at boot.

---

## Q6 — Lifecycle

### Ruling: **QUALIFY / Approved with revisions**

Pause-drain, Stop-cancel, explicit Resume, restore exclusion, Recover, and replacement-lead handoff are coherent in intent. Generation rotation and bridge connection handling require explicit rules.

### Source-verified facts

The supplied plans require:

- Pause blocks dispatch, decryption, and integration while active helpers drain.
- An already-applying integration may settle during Pause.
- Stop revokes authorization, cancels lead/helpers, rejects new effects, and preserves evidence.
- Ordinary restore excludes team-owned leads, leaves teams paused, and performs no credential decryption or launch.
- Recover is explicit and inspect-only, limited to retained dirt with known stopped writers and no ambiguous promotion.
- Resume is explicit and revalidates credentials, workspaces, and ownership.
- Prior/recovery lead process trees must be confirmed stopped before fresh active work.
- Unknown previous lead identity blocks replacement.
- Replacement lead sessions must be visibly labeled and carry persisted handoff; they must not imply conversation continuity.
- Activate retries bridge readiness on the existing preparing lead and must not create a duplicate lead.

### Defect 1 — Lead replacement must rotate generation and bridge authority

- **Scenario:** A prior lead process or old bridge connection survives long enough to use a token after the user believes a replacement lead owns the run.
- **Severity:** High.
- **Affected contract/task:** Feature contract §§5 and 8; ImplementationSpec 11-2 lifecycle/bridge logic; Task 11-4.
- **Required resolution:**
  - Every lead replacement increments run generation.
  - Old bridge tokens and active connections are invalidated/disconnected.
  - Prior process-tree identity must be confirmed stopped before replacement.
  - Replacement gets a new bridge token bound to the replacement generation.
  - The preferred simpler rule is to increment generation on every explicit Resume, not only replacement.

### Defect 2 — Pausing bridge operation availability is ambiguous

- **Scenario:** Revoking all bridge use during Pausing prevents status/review of drain outcomes; leaving all tools enabled permits delegation or integration.
- **Severity:** Medium.
- **Affected contract/task:** ImplementationSpec 11-2 bridge state gating.
- **Required resolution:** During `pausing`, permit only status, wait, and read-only evidence access as appropriate. Reject delegate, revise, dispatch, decrypt, prepare, apply, and new integration actions.

### Defect 3 — Restore, duplicate, delete, and complete paths require ownership guards

- **Scenario:** Session healing relaunches a team lead, destructive CRUD affects a team-owned workspace with writers, or Resume/Complete bypasses revalidation.
- **Severity:** High for restore; medium/high for destructive lifecycle operations.
- **Affected contract/task:** Task 11-4 composition; Task 11-5 lifecycle hardening.
- **Required resolution:**
  - Apply restore exclusion in selection, count, heal, and relaunch paths.
  - Guard project/session/worktree deletion or duplication when team ownership or live/unknown writers exist.
  - Require full configuration, credential, route/auth relationship, workspace, ownership, and generation revalidation before Resume from paused/completed states.

### Defect 4 — Pause/Stop status must remain truthful

- **Scenario:** A helper times out while draining but the panel says only “Pausing”; Stop occurs during Git promotion and UI implies cancellation completed without knowing whether the Git effect applied.
- **Severity:** Medium.
- **Affected contract/task:** Feature contract §5; ImplementationSpecs 11-2 and 11-3; Task 11-5.
- **Required resolution:** Surface timeout/interruption during drain. Stop during `applying` must settle into observed applied, unapplied, or ambiguous recovery state; it must never force-reset or claim clean cancellation without evidence.

---

## Q7 — Quality and measurement

### Ruling: **QUALIFY / Approved with revisions**

The proposed 18-run paired design is a credible baseline, but the comparison can be misleading without approval-policy attribution, metering coverage disclosure, verification-provenance normalization, and revision-bound test evidence.

### Source-verified facts

The feature contract specifies:

- Three task classes: bug fix, parallelizable feature, and refactor with tests.
- Three lead-only/team pairs per task, totaling 18 runs.
- Fixed task, base, environment, lead, and acceptance tests within each pair.
- Alternating run order.
- Reporting of quality, elapsed time, human interventions, lead usage, total available usage/cost, coverage, median, and range.
- Subscription cost unknown unless a defensible source exists; missing cost is never zero.
- Integrated verification requires clean `verifiedHead` and ancestry from original result SHA.
- Helper-reported checks are distinct from lead-verified checks.

### Defect 1 — Approval policy delay can be misreported as coordination cost

- **Scenario:** Team runs use ask-before-integration while lead-only runs lack a comparable approval gate. The resulting delay is reported as team coordination overhead.
- **Severity:** Medium.
- **Affected contract/task:** Feature contract §8; Task 11-4 reporting.
- **Required resolution:** Treat approval policy as an explicit factor, or report approval-wait time and human approval interventions separately from coordination/model execution time.

### Defect 2 — Metering coverage is not sufficiently attached to each run

- **Scenario:** API-auth runs have provider-reported costs while subscription runs have null costs. Aggregates imply a cost comparison without identifying coverage.
- **Severity:** Medium.
- **Affected contract/task:** Feature contract §8; Task 11-4 reporting.
- **Required resolution:** Store and report per-run metering provenance:
  - provider-reported API;
  - defensible subscription source;
  - unavailable/null;
  - estimate methodology, if any.

Report cost-available and cost-unknown subsets separately. Missing subscription costs must remain null, never `$0`.

### Defect 3 — Verification provenance is not normalized between modes

- **Scenario:** Team mode counts helper-reported tests while lead-only mode requires lead-rerun or integrated verification. Team mode appears faster at a weaker quality bar.
- **Severity:** High.
- **Affected contract/task:** Feature contract §8; Task 11-3 integrated verification evidence; Task 11-4 reporting.
- **Required resolution:** Record verification provenance as a measured field, including:
  - helper-reported;
  - lead-rerun;
  - automated CI-equivalent;
  - user-accepted;
  - integrated-head verified.

Compare like with like or stratify reported results by verification depth.

### Defect 4 — Test evidence is not sufficiently bound to revision and command

- **Scenario:** A helper changes test code and implementation together, weakens tests, or reports success against an unrecorded tree. A later checkpoint changes HEAD. “Tests passed” cannot be tied to the actual integrated revision.
- **Severity:** Medium/High.
- **Affected contract/task:** Feature contract §§7–8; ImplementationSpec 11-3 integrated review; Task 11-4 reporting.
- **Required resolution:** Store:
  - exact command;
  - command outcome;
  - working directory/context;
  - `verifiedHead`;
  - relevant test-source paths or captured diff identity;
  - evidence provenance.

Later HEAD changes require fresh verification at the later clean HEAD. Historical evidence remains historical and cannot complete the task.

### Assumptions requiring probes

- Whether provider APIs expose usage/cost for each selected API and subscription route.
- Whether equivalent metering is available across providers.
- Whether 18 runs have sufficient statistical power to make general claims beyond the stated task set.

The findings do not reject the 18-run plan, but it must report its limits and should not claim broad statistical generalization.

---

# Risks and mitigations

| Risk | Severity | Mitigation | Owner |
|---|---:|---|---|
| Helper starts with revoked/rotated credential | High | Fenced spawn authorization, no stale secret across awaits, race fixtures, process containment | 11-2 |
| Recovery lead dispatches helpers or integrates | High | Lease modes and broker/service allowlist | 11-2, 11-4 |
| Boot decrypts or revives team processes | High | Restore exclusion and negative boot tests | 11-2, 11-4, 11-5 |
| Bridge token leaks through malformed endpoint/redirect | High | Structural endpoint parser, loopback route allowlist, redirect/proxy rejection | 11-2, 11-4 |
| Unsupported MCP client behavior silently widens scope | High | Versioned docs plus captured client conformance evidence; disable unsupported configuration | 11-1, 11-4 |
| Invisible helper prompt produces inaccessible hang | Critical | Adapter eligibility contract and visible permission-block classification | 11-1, 11-2 |
| Artifact ref survives crash without durable attempt association | High | Durable capture reservation before Git effects and orphan-ref reconciliation | 11-2, 11-3, 11-5 |
| Stale lead bridge survives replacement | High | Generation bump, token revocation, active connection closure | 11-2, 11-4 |
| Approval delay is reported as coordination overhead | Medium | Separate policy waits and interventions from coordination timing | 11-4 |
| Subscription costs appear as zero or are mixed into misleading aggregate | Medium | Per-run metering provenance and null-preserving reports | 11-4 |
| UI overstates isolation/permission enforcement | High | Required honest language and explicit limitations | 11-4 |

---

# Checkable action items

## Task 11-1 — Runtime probes and compatibility gates

- [ ] Capture installed version and primary documentation reference for Claude Code, Codex, and each supported helper engine.
- [ ] Demonstrate both required interactive leads completing MCP initialization, `tools/list`, and `tools/call` against the packaged stdio facade.
- [ ] Capture negotiated MCP revision and failure behavior for incompatible revisions.
- [ ] Demonstrate `team_wait` cancellation does not invoke `team_cancel`.
- [ ] Demonstrate protocol-only stdout under normal and error conditions; record stderr sanitization behavior.
- [ ] Demonstrate whether each CLI/auth route requires home-directory, global, project, or worktree configuration mutation.
- [ ] Demonstrate each supported helper can complete noninteractively or emit a visible permission/prompt blocker.
- [ ] Capture actual spawned flags/configuration used to suppress prompts or set permission modes.
- [ ] Probe subscription/API identity isolation for every supported roster/auth combination.
- [ ] Record provider metering availability and provenance for each supported route.
- [ ] Disable unsupported lead/helper/auth combinations with visible reasons rather than changing the selected scope silently.

## Task 11-2 — Runtime authority, broker, and storage

- [ ] Add `normal` and `recovery` lease modes with explicit broker and TeamService operation allowlists.
- [ ] Deny helper decryption, dispatch, revise, prepare, and apply in recovery mode.
- [ ] Treat `pausing` as immediately decryption- and dispatch-denying.
- [ ] Implement a pre-spawn authorization fence checking run, generation, lease epoch/mode, credential version, and provider/auth relationship.
- [ ] Ensure resolved secret material is discarded on failed recheck and not retained across uncontrolled awaits.
- [ ] Add Stop/Pause/rotation/deletion race fixtures during preparation and immediately before spawn.
- [ ] Add zero-boot-decryption tests with persisted nonterminal team runs.
- [ ] Bind every bridge token to run, generation, epoch, and lease mode; check every request.
- [ ] Implement loopback endpoint structural parsing, route allowlist, no redirects, no proxies, and no userinfo.
- [ ] Add POST-only, header-size, request timeout, connection cap, wait cap, and rejected-upgrade behavior.
- [ ] Add helper environment negative tests proving absence of bridge token, lead credential, unrelated provider variables, and secret logging.
- [ ] Reserve attempt UUID and capture operation identity durably before artifact Git writes.
- [ ] Add idempotency tests for same request/same payload and same request/different payload.
- [ ] Record process creation and executable identity; prohibit PID-only orphan termination.

## Task 11-3 — Artifact, integration, and real-Git validation

- [ ] Embed or otherwise preserve recoverable attempt/capture identity in durable Git-visible artifact metadata.
- [ ] Reconcile private artifact refs to durable attempt reservations during recovery.
- [ ] Add failure injection before and after each artifact journal/ref/metadata boundary.
- [ ] Add real-Git fixtures for binary, rename, deletion, untracked, Unicode, NUL-path, no-user-identity, conflict, and dirty-tree cases.
- [ ] Hash source checkout and helper index before/after capture to prove preservation.
- [ ] Test generated-config restoration and helper-edit conflict behavior.
- [ ] Test approval invalidation for changed artifact SHA, prepared result SHA, integration HEAD, preparation ID, and policy version.
- [ ] Test promotion recovery for actual HEAD at expected base, actual HEAD at prepared result, and ambiguous states.
- [ ] Require test command/outcome/revision evidence for integrated verification.

## Task 11-4 — Composition, UI, IPC, and reporting

- [ ] Enforce authenticated actor identity so MCP leads cannot manufacture `userActor`.
- [ ] Render recovery mode as explicitly inspect-only.
- [ ] Use required honesty language for cooperative isolation, CLI-native permissions, and Chorus-managed concurrency.
- [ ] Apply restore exclusion in all ordinary restore/heal/relaunch paths.
- [ ] Present replacement lead as a replacement with persisted handoff, never as restored conversation continuity.
- [ ] Report approval-policy wait separately from execution and coordination timing.
- [ ] Add per-run metering provenance and null-preserving coverage fields.
- [ ] Add verification-provenance fields and stratified comparison reporting.
- [ ] Bind report acceptance evidence to actual clean `verifiedHead`.

## Task 11-5 — Recovery and lifecycle hardening

- [ ] Run Git/SQLite reconciliation before any ordinary session restore behavior.
- [ ] Test every recovery-matrix row with fault injection.
- [ ] Test no automatic replay of `applying` integration when actual HEAD remains expected base.
- [ ] Test stale bridge token and active connection invalidation after generation changes.
- [ ] Guard duplicate/delete/project/session/worktree destructive paths against retained team ownership and live/unknown writers.
- [ ] Test Stop during applying integration and Pause during helper deadlines.
- [ ] Test replacement-lead sequencing: old process identity stopped, active bridge closed, new generation/token issued.
- [ ] Preserve evidence in all ambiguous recovery cases; do not clean, reset, overwrite, or delete to force progress.

---

# Dissents and disagreement commentary

All recorded disagreements are preserved below. Narrative commentary states whether each is well-founded.

## Structural dissents

### [Q2] DeepSeek — Bridge boundary: Agree vs Grok/Qwen Qualify

**Record:** DeepSeek considered the proposed tools-only facade and authenticated loopback broker adequate in design, while Grok and Qwen qualified approval pending stronger endpoint, generation/mode, and resource-control requirements.

**Council commentary:** **Well-founded on both sides, with Grok/Qwen adopted for the gate.** DeepSeek correctly recognized that the planned architecture is conservative and already names important controls. However, the contract did not make endpoint parsing, per-request mode checks, resource limits, and concrete installed-client evidence sufficiently normative. The ruling therefore remains **Qualify / Approved with revisions**, not unconditional approval.

### [Q5] DeepSeek — Durability: Disagree vs Grok Qualify

**Record:** DeepSeek identified a specific artifact-publication defect where a private Git ref can exist before durable attempt artifact publication. Grok accepted the durability architecture conditionally and supplied a broader recovery matrix.

**Council commentary:** **Well-founded and adopted.** The artifact identity gap is decisive because it defeats recoverability at a Git/SQLite non-atomic boundary. Grok’s matrix is also adopted as the remediation framework. The result is **Revise**, not rejection: the architecture is repairable but incomplete.

---

## Critique dissents tagged [R1]

### [R1 — Q4] DeepSeek — “Full helper process-tree exit” is too absolute

**Record:** DeepSeek objected that requiring “full helper process-tree exit” before capture overstates what can be known when untracked descendants are unverifiable. It proposed known/recorded process identity exit plus fail-closed behavior for unknown writers.

**Council commentary:** **Well-founded and adopted.** The normative wording must not promise omniscient process-tree observation. Capture should require confirmed cessation of known owned processes and fail closed where unknown writer identity or liveness makes the workspace unsafe.

### [R1 — Q2] DeepSeek — PTY/environment leak severity is understated

**Record:** DeepSeek argued that redaction cannot protect against same-user process inspection or memory access.

**Council commentary:** **Well-founded.** Redaction is log hygiene, not protection against a compromised lead process or same-user local process inspection. The findings therefore frame this as an explicit trust-boundary limitation, not as a solved token-confidentiality problem.

### [R1 — Q2] DeepSeek — Global/home config mutation and Pausing test coverage were under-addressed

**Record:** DeepSeek noted that the initial ruling did not explicitly extend “no MCP/instruction/hook files in worktrees” to user-home/global CLI configuration, lacked a concrete broker-during-Pausing test, and did not address power/carryover limits in the 18-run plan.

**Council commentary:** **Well-founded and adopted.** Task 11-1 now requires evidence of no project, home-directory, or global config mutation. Q6 requires Pausing operation tests. Q7 must disclose limits of the 18-run comparison and not generalize beyond its measured task set.

### [R1 — Q2] DeepSeek — Single-path endpoint requirement may be brittle

**Record:** DeepSeek argued that an absolute “no path other than broker route” rule may fail when valid MCP clients normalize or append routes; it should be an allowlist of advertised routes.

**Council commentary:** **Well-founded and adopted.** The action is an explicit broker-route allowlist, not a brittle hardcoded single-path requirement.

### [R1 — Q3 through Q7] DeepSeek — Qwen submission was incomplete

**Record:** DeepSeek noted that Qwen’s position stopped during Q3 and did not address Q4–Q7.

**Council commentary:** **Well-founded.** No Qwen conclusion has been attributed to Q4–Q7. The council uses the available Qwen material only for Q1–Q3-related concerns.

### [R1 — Q2] Grok — DeepSeek’s unconditional bridge agreement was too lenient

**Record:** Grok argued that Host/Origin checks plus planned probes do not establish redirect-free endpoint behavior, bearer-token primacy, or recovery-mode operation scope.

**Council commentary:** **Well-founded and adopted.** Host/Origin are defense-in-depth. Bearer token, run/generation/mode binding, endpoint parsing, and runtime evidence are the controlling boundary requirements.

### [R1 — Q1] Grok — Same-tick/fork capability framing is platform-specific and insufficient

**Record:** Grok argued that a “capability consumed in the same tick as fork” remedy overfits a Unix-like spawn model and misses operation scope and broader revocation controls.

**Council commentary:** **Well-founded and adopted.** The ruling uses a platform-neutral authorization fence and containment requirement, not a claim of perfectly atomic same-tick authorization.

### [R1 — Q1/Q2] Grok — Missing recovery scope, pausing race, subscription isolation, boot gate, endpoint/HTTP controls, generation checks, and global mutation proof

**Record:** Grok identified several omitted or under-specified checks.

**Council commentary:** **Well-founded and adopted.** These are incorporated into Q1 and Q2 findings and action items.

### [R1 — Q2/Q3] Grok — Some Qwen controls may over-weight defense in depth

**Record:** Grok argued that header/connection caps and every conformance exhibit should not all block implementation readiness relative to core lease/spawn/recovery defects, and noted Qwen’s incomplete Q3 onward coverage.

**Council commentary:** **Partly well-founded.** Core authorization, recovery, and selected-scope compatibility defects are higher priority. However, bounded loopback broker resource controls are still required before shipping because the broker is a new privileged local service. They need not delay unrelated planning work, but they are implementation-gate items for the bridge feature.

### [R1 — Q4 through Q7] Grok — Qwen omitted later-surface issues

**Record:** Grok noted Qwen did not cover artifact identity, prompt classification, approval binding, replacement lead, metering, and verification provenance.

**Council commentary:** **Well-founded.** Those issues remain in the findings based on DeepSeek, Grok, and arbiter synthesis; no Qwen position is inferred.

### [R1 — Q1] Qwen — Same-tick spawn capability does not solve the race absolutely

**Record:** Qwen argued that userspace cannot make revocation perfectly atomic with process creation and required fenced reservations, secret scrubbing, immediate kill, and proof of no useful work.

**Council commentary:** **Well-founded and adopted.** The council explicitly rejects an absolute “cannot spawn after revocation” claim and instead requires a fenced authorization protocol plus containment and evidence.

### [R1 — Q2] Qwen — PTY exposure and client protocol evidence should be acceptance gates

**Record:** Qwen argued that lead PTY token exposure and installed-client protocol evidence should be treated as acceptance gates rather than residual probes.

**Council commentary:** **Partly well-founded.** Installed-client MCP conformance is an implementation gate for D5. PTY exposure is a disclosed trust-boundary limitation; it is not fully remediable within the claimed isolation model. Token-delivery minimization and honest disclosure are mandatory.

### [R1 — Q1/Q2/Q7] Qwen — Additional underweighted risks

**Record:** Qwen highlighted stale in-memory secrets during preparation, MCP stdout robustness, protocol capability evidence, and Q7 policy-intervention and verification-provenance normalization.

**Council commentary:** **Well-founded and adopted.** These are incorporated into Q1, Q2, and Q7 actions.

### [R1 — Q1/Q6] Qwen — Recover/Activate widening and ordinary restore relaunch are test gaps, not necessarily proof of flawed intent

**Record:** Qwen characterized these as high-risk implementation/test gaps against stated prohibitions rather than proof the design necessarily authorizes them.

**Council commentary:** **Well-founded distinction.** The council does not find that the written intent authorizes the behavior. It finds the contract insufficiently explicit and insufficiently testable. The remedy is normative operation gating and negative tests.

### [R1 — Q5] Qwen — Blanket no-replay-at-base requires evidence-based classification

**Record:** Qwen argued that a no-replay rule for `applying` when HEAD is at base must be grounded in durable journal state and recovery classification, although conservative blocking is acceptable.

**Council commentary:** **Well-founded.** The ruling requires classification using durable intent and observed Git identity. In the absence of sufficient evidence, preserving state and blocking is the correct conservative action.

### [R1 — Q5/Q7] Qwen — Artifact identity and test-evidence binding were underemphasized

**Record:** Qwen emphasized durable attempt reservation before ref creation, orphan ref reconciliation, test command/source binding, metering subsets, stdout robustness, and stale bridge disconnection.

**Council commentary:** **Well-founded and adopted.** These requirements appear in Q2, Q5, Q6, and Q7 action items.

---

# Required disposition record

Before implementation begins, maintain a separate disposition section or document recording each ruling as:

- adopted;
- rejected;
- deferred;

with:

- rationale;
- normative contract section changed;
- affected task/spec pair;
- test/probe evidence required;
- owner;
- completion status.

No ruling may be treated as implemented merely because it appears in this findings document.

---

# Final gate statement

Phase 11 remains a planned feature. The council finds the user-selected scope—both interactive leads, cross-provider helpers, mixed subscription/API authentication, helper CLI engines, selected roster, two integration policies, and paused restart recovery—must not be silently narrowed.

The feature may proceed to implementation only after:

1. the normative feature contract is revised to reflect these rulings;
2. Tasks 11-1 through 11-5 and their paired implementation specifications are updated with ownership and acceptance tests;
3. runtime probes establish the supported lead/helper/auth configurations rather than assuming CLI flags or MCP behaviors; and
4. the artifact publication and recovery defects in Q5 are corrected before any integration implementation is declared durable.

---

## How disagreement was detected

- **Q1** — detection: `structural` · members agreed
- **Q2** — detection: `structural` · members disagreed
- **Q3** — detection: `structural` · members agreed
- **Q4** — detection: `structural` · members agreed · no verdict token from: Qwen 3.8 Max
- **Q5** — detection: `structural` · members disagreed · no verdict token from: Qwen 3.8 Max
- **Q6** — detection: `structural` · members agreed · no verdict token from: Qwen 3.8 Max
- **Q7** — detection: `structural` · members agreed · no verdict token from: Qwen 3.8 Max

_`structural` means the orchestrator compared the members' own verdict tokens and counted the difference. `model-judged` means too few members answered in the required form, so the arbiter judged it from prose — a weaker signal, labelled rather than hidden._

## Dissents preserved

_14 preserved: 2 structural (computed from the members' own verdict tokens) · 12 from critique prose, from 3 members — DeepSeek v4 Pro 0813 4 · Grok 4.6 4 · Qwen 3.8 Max 4._

_⚠ Read the per-member split before reading breadth into the total: several objections from one member is one member disagreeing repeatedly, not several members disagreeing. Nothing is dropped to make the total smaller._

- [Structural — Q2] Bridge boundary: Review the tools-only stdio facade and authenticated 127.0.0.1 broker. Are token transport, Host/Origin checks, limits, generation binding, cancellation semantics, no inherited helper token, and no global config mutations adequate? Review the choice of a small dependency-free protocol surface and require conformance evidence rather than assuming it. — AGREE: DeepSeek v4 Pro 0813 · QUALIFY: Grok 4.6, Qwen 3.8 Max
- [Structural — Q5] Durability: Review seven-table ownership, transaction/event atomicity, request idempotency, attempt ceilings, orphan identity, and Git/SQLite effect journals. For each crash boundary, specify evidence that distinguishes unapplied, applied, and ambiguous work without repeating writes or deleting evidence. — DISAGREE: DeepSeek v4 Pro 0813 · QUALIFY: Grok 4.6
- [Critique — R1] DeepSeek v4 Pro 0813: I disagree with the Q4 “full helper process-tree exit” pre-capture requirement as stated: it is too absolute because A itself admits untracked descendant processes may be unrecorded or unverifiable. The enforceable requirement should be recorded/known process identity exit plus fail-closed on unknown writers, not a claim of full-tree exit. I also think A slightly understates the PTY/env leak severity: token redaction and scrubbers cannot stop a same-user attacker with process inspection or memory access.
- [Critique — R1] DeepSeek v4 Pro 0813: A does not explicitly extend “no MCP/instruction/hook files inside worktrees” to user-home/global CLI config mutation until B names it; it does not give a concrete broker-during-Pausing test beyond fail-closed dispatch; and it does not address statistical power/carryover effects in the 18-run paired design beyond alternating order. ### Position B
- [Critique — R1] DeepSeek v4 Pro 0813: B’s “no path other than the broker route” endpoint rule is potentially too brittle if MCP clients normalize or append routes; it should be an allowlist of broker-advertised routes, not a blanket single-path prohibition. B also stops during Q3 and gives no Q4–Q7, so it cannot be treated as a complete review; that is a coverage defect.
- [Critique — R1] DeepSeek v4 Pro 0813: Because of truncation, B misses artifact/integration approval reuse, SQLite/Git crash classification, lifecycle restore/recovery edge cases, and paired-evaluation metering/acceptance conditions. It also does not discuss the lead PTY/env token leak or replacement-lead UI product contract that A correctly raises.
- [Critique — R1] Grok 4.6: Q2 AGREE is too lenient—Host/Origin plus a planned probe does not make the facade redirect-free or the bearer the actual boundary, and “checked immediately before spawn” plus a race test is weaker than a recovery-mode operation allowlist; “capability consumed in the same tick as fork” also overfits Unix spawn without specifying lease mode.
- [Critique — R1] Grok 4.6: recovery-lease operation scope (delegate/revise/integrate in inspect-only), pausing-vs-revoke decryption race, subscription/keychain isolation evidence, automated zero-boot-decryption gate, exact loopback URL/no-redirect facade parse, broker HTTP/method/timeout/connection caps, per-request generation/mode revalidation, and proving no global CLI config mutation. ### Position B
- [Critique — R1] Grok 4.6: Treating header/connection/slowloris caps and every conformance exhibit as blocking “before implementation is treated as ready” over-weights defense-in-depth vs the core lease/spawn/recovery defects; Q3 is incomplete so its QUALIFY cannot be scored as a full verdict.
- [Critique — R1] Grok 4.6: Entire Q4–Q7 surface—artifact publication crash (ref exists, attempt id never reserved), Stop-during-spawn test, hung-prompt classified as permission-blocked, approval identity vs recordVersion, Pause/Resume generation increment vs token reuse, comparison metering-source/test-SHA/verification-provenance, and injected-file restore-vs-exclude.
- [Critique — R1] Qwen 3.8 Max: Position A — I disagree that a same-tick capability alone solves the spawn race: user-space authorization cannot be made perfectly atomic with fork/exec, so the plan should require fenced spawn reservations, no captured secret across async boundaries, immediate kill/visible failure if revocation lands after process creation, and proof no work occurs, rather than an absolute “cannot spawn” claim. I also think Q2 is too generous to the bridge boundary unless lead PTY token exposure and installed-client protocol evidence are treated as acceptance gates, not just residual probes.
- [Critique — R1] Qwen 3.8 Max: Position A — Position A missed or underweighted several risks: interactive lead PTY/shell can expose or write the bridge token under malicious repo instructions, requiring redaction and honest scope; MCP conformance needs explicit evidence for negotiation, tools-only, no sampling/resources/prompts, disconnect/wait behavior, and stdout BOM/newline/debug robustness for both installed leads; revocation during async preparation must drop/scrub in-memory decrypted material rather than only revalidate at spawn; and the Q7 comparison needs policy-intervention attribution (ask-before-integration) plus verification-provenance normalization, not only cost-source reporting.
- [Critique — R1] Qwen 3.8 Max: Position B — I disagree with parts of Position B’s framing: Recover/Activate widening and ordinary restore relaunch are better characterized as high-risk test gaps against an already-stated prohibition, not evidence that the design itself necessarily authorizes them; the lead PTY leak is a lead-process trust-boundary and disclosure problem more than a defect in the MCP facade boundary; and a blanket no-replay rule for applying-at-base should be justified by durable journal state and recovery classification, although conservative blocking is acceptable.
- [Critique — R1] Qwen 3.8 Max: Position B — Position B missed the specific artifact-identity publication gap: the attempt row/ID must be durably reserved before commit-tree/ref creation and orphan refs must be joinable to attempts, otherwise crashes can produce stale or duplicated artifacts that the recovery matrix cannot discover; it also underemphasized test-source/test-command version binding for acceptance evidence, per-run metering-source subset reporting, stdout protocol robustness against BOM/newline/debug output, and explicit active disconnection of stale bridge connections after generation rotation.

## Provenance

- **Run id:** `8f16eb53-6f8c-414a-b13f-589df5fe79c9`
- **Started:** 2026-09-20T18:02:34.468Z

| Member | Role | Model | Turns |
|---|---|---|---|
| DeepSeek v4 Pro 0813 | member | `deepseek/deepseek-v4-pro-0813` | answered 2 turns |
| GLM 5.3 | member | `z-ai/glm-5.3` | refused 1 turn |
| Grok 4.6 | member | `x-ai/grok-4.6` | answered 2 turns |
| Qwen 3.8 Max | member | `qwen/qwen3.8-max` | answered 2 turns |
| GPT 5.6 Terra | arbiter | `openai/gpt-5.6-terra` | answered 2 turns |

