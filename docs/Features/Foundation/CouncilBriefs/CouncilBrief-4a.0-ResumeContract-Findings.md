> ⚠ **PARTIAL RUN — 3 of 4 members completed.**
>
> - Qwen 3.8 refused at **positions** (round 0): The model returned an empty answer (its output budget may have gone to reasoning).
>
> These findings are the output of a council that did not fully convene. Read them as such.

> ⚠ **These findings are model deliberation, not verified fact.** Every claim below was produced by language models reading the brief. Nothing here was compiled, executed or tested, and no model in this council could see the repository. This project’s own CR-3b.0 was unanimous, its rulings were sound, and the code it shipped had four compile errors. Verify anything you are about to rely on.

## Per-model positions

**DeepSeek v4 Pro 0813:** Q1 single `buildLaunch` path with a launch modifier; Q2 adapter-owned argv branching; Q3 descriptor discriminator plus post-fresh-launch discovery; Q4 visible fresh fallback; Q5 behavioural honesty tests; Q6 no alternative; Q7 clear scrollback.

**GLM 5.2:** Q1 single `buildLaunch` path; Q2 adapter-owned argv branching; Q3 descriptor discriminator and bounded discovery; Q4 visible fresh fallback; Q5 descriptor-kind and behavioural honesty tests; Q6 no alternative; Q7 retain scrollback behind a separator.

**Grok 4.5:** Q1 single `buildLaunch` path; Q2 adapter-owned argv branching; Q3 fresh-launch-only best-effort discovery; Q4 visible fresh fallback for actual resume failures only; Q5 behavioural honesty testing plus required discovery method; Q6 no alternative; Q7 retain scrollback behind a separator.

## Council synthesis

**Q1 — approved: one launch path, with an agent-session launch modifier.** `PtyLaunchSpec` gains an optional `resume` modifier and `buildLaunch(spec)` remains the only launch entry point. `ResumeSpec` and `SupportsResume.resumeSession()` are removed. The modifier must represent Claude’s assigned-id fresh creation as well as resumption, because Claude must receive the Chorus-minted vendor id on its first launch and a stored vendor id on restore. The strongest argument against this design is semantic: a field named `resume` containing a `create` action is less intuitive than a dedicated method. That cost is accepted because the dedicated-method alternative recreates a second launch path that can drift from credential, route, effort, extra-argument, and hook handling, contrary to D33 and the principal correctness requirement.

**Q2 — approved: argv grammar belongs exclusively in adapter `buildLaunch`.** Claude and codex branch inside their own `buildLaunch` implementations. Claude uses its assigned-id creation form or `--resume <id>` as appropriate; codex uses normal fresh argv when no modifier is present and `codex resume <id>` when the modifier requests resumption. A redefined `SupportsResume` loses the one-launch-path property and duplicates launch assembly. A richer descriptor interpreted by `SessionManager` loses adapter encapsulation by making shared code understand vendor subcommands, positional grammar, and argument ordering.

**Q3 — approved: descriptor kind plus a required discovery method for discovered adapters.** `ResumeDescriptor` is discriminated as `assigned` or `discovered`. Claude is `assigned`; codex is `discovered`. A discovered adapter must implement `discoverSessionId(context)`. `SessionManager` captures `launchedAt` immediately before a fresh discovered-adapter spawn, invokes discovery only after that spawn succeeds, and never invokes discovery for a resume launch. Discovery is bounded and abortable. It may persist an id only after a rollout file’s first `session_meta` record positively and exactly matches the launch `cwd`, is current relative to `launchedAt`, and belongs to the current spawn generation. On quit, restart, disposal, or superseding spawn, discovery is aborted and its result is discarded. A discovered fresh session therefore has an intentional NULL-pointer interval; if the app quits during that interval, the next launch is fresh.

**Q4 — approved: visible fresh fallback for actual resume failures.** A recognized failed resume—unknown vendor id, id already in use, unavailable/pruned transcript, or an adapter-confirmed inability to apply the stored pointer—clears the pointer, relaunches once fresh under the same Chorus row id, and shows a visible pane badge that context was not restored. It never falls back silently and never refuses to launch. A codex discovery miss after a fresh launch is not a resume failure: no context was promised, no stale pointer exists, the pointer remains NULL, and no resume-failure badge is shown.

**Q5 — approved: honesty is now a structural descriptor contract plus behavioural launch tests.** The former `['sessionResume', 'resumeSession']` pairing is removed. A non-null descriptor earns its declaration only when the adapter provides the capabilities structurally required by its descriptor kind and its `buildLaunch` produces the tested assigned/create, assigned/resume, or discovered/resume argv shape. `adapters.test.ts` must assert the exact expected argv, not merely that two argv arrays differ. `supportsResume()` checks both that the descriptor is non-null and that the required companion method exists for the declared kind. It does not inspect a removed `resumeSession` method.

**Q6 — approved: no load-bearing omitted alternative.** No alternative should displace a single launch path with adapter-owned argv assembly and descriptor-governed discovery. A generic argv rewriter, middleware layer, or post-processor would simply move vendor grammar into shared code and create a new drift surface.

**Q7 — approved: retain scrollback behind a mandatory visible separator.** `session:restart` continues to clear or rotate the agent-session pointer under D142, but the scrollback mirror is retained as user-visible terminal history. Before output from the restarted PTY is replayed or emitted, Chorus inserts a visible boundary such as `── Session restarted: fresh conversation ──`. This preserves the user’s work product while making clear that the restarted agent has no prior conversation context. Continuous, unseparated replay is prohibited.

## The contract (verbatim TypeScript, implementable)

```ts
export interface AssignedResumeDescriptor {
  /**
   * Retained from the existing declared descriptor surface.
   * It is not the assign-versus-discover discriminator.
   */
  readonly mode: DescriptorMode
  readonly kind: 'assigned'
  readonly cliFlag: string | null
}

export interface DiscoveredResumeDescriptor {
  /**
   * Retained from the existing declared descriptor surface.
   * It is not the assign-versus-discover discriminator.
   */
  readonly mode: DescriptorMode
  readonly kind: 'discovered'
  readonly cliFlag: string | null
}

export type ResumeDescriptor =
  | AssignedResumeDescriptor
  | DiscoveredResumeDescriptor

/**
 * A modifier on the single buildLaunch path.
 *
 * Assigned/create is used by Claude for a fresh conversation whose vendor id
 * Chorus minted. Resume is used for an existing persisted vendor id.
 */
export type AgentSessionLaunch =
  | {
      readonly strategy: 'assigned'
      readonly action: 'create' | 'resume'
      readonly agentSessionId: string
    }
  | {
      readonly strategy: 'discovered'
      readonly action: 'resume'
      readonly agentSessionId: string
    }

export interface PtyLaunchSpec {
  readonly sessionId: string
  readonly cwd: string
  readonly modelId?: string
  readonly effortOptionId?: string
  readonly extraArgs?: readonly string[]
  readonly credential?: ResolvedCredential
  readonly route?: PtyLaunchRoute
  readonly hooks?: PtyLaunchHooks

  /**
   * Absent for a normal fresh launch by a discovered-id adapter.
   * Present for assigned-id creation and all resume launches.
   */
  readonly resume?: AgentSessionLaunch
}

export interface DiscoverSessionContext {
  readonly cwd: string

  /**
   * Epoch milliseconds captured immediately before the fresh PTY spawn.
   * Discovery must not accept an older rollout as this launch's result.
   */
  readonly launchedAt: number

  /**
   * Aborted on app quit, session disposal, restart, or superseding spawn.
   * An aborted result must never be persisted.
   */
  readonly signal: AbortSignal
}

export type ResumeFailureReason =
  | 'not-found'
  | 'in-use'
  | 'transcript-unavailable'
  | 'unusable-pointer'

export interface ResumeExitObservation {
  readonly exitCode: number | null
  readonly signal: string | null

  /**
   * The bounded terminal text needed for adapter-local failure recognition.
   * It must not be logged by this contract.
   */
  readonly output: string
}

export interface AssignedResumeSupport {
  readonly sessionResume: AssignedResumeDescriptor
  readonly discoverSessionId?: never

  /**
   * Returns a reason only for a failed assigned/resume launch.
   */
  classifyResumeFailure(
    observation: ResumeExitObservation,
  ): ResumeFailureReason | null
}

export interface DiscoveredResumeSupport {
  readonly sessionResume: DiscoveredResumeDescriptor

  discoverSessionId(
    context: DiscoverSessionContext,
  ): Promise<string | null>

  /**
   * Returns a reason only for a failed discovered/resume launch.
   */
  classifyResumeFailure(
    observation: ResumeExitObservation,
  ): ResumeFailureReason | null
}

export type SupportsResume =
  | AssignedResumeSupport
  | DiscoveredResumeSupport

export function supportsResume(
  adapter: unknown,
): adapter is SupportsResume {
  if (adapter === null || typeof adapter !== 'object') {
    return false
  }

  const candidate = adapter as {
    readonly sessionResume?: ResumeDescriptor | null
    readonly discoverSessionId?: unknown
    readonly classifyResumeFailure?: unknown
  }

  if (
    candidate.sessionResume === undefined ||
    candidate.sessionResume === null ||
    typeof candidate.classifyResumeFailure !== 'function'
  ) {
    return false
  }

  return candidate.sessionResume.kind === 'assigned'
    ? candidate.discoverSessionId === undefined
    : typeof candidate.discoverSessionId === 'function'
}

// DELETE:
// export interface ResumeSpec { ... }
// export interface SupportsResume {
//   resumeSession(spec: ResumeSpec): PtyLaunchRequest
// }
```

## What changes, file by file

- **`src/main/adapters/types.ts`**
  - Replace the former descriptor with the discriminated `ResumeDescriptor`.
  - Add `AgentSessionLaunch`, `DiscoverSessionContext`, resume-failure types, and the revised `SupportsResume`.
  - Add `resume?: AgentSessionLaunch` to `PtyLaunchSpec`.
  - Delete `ResumeSpec`.
  - Delete `resumeSession()`.
  - Replace `supportsResume()` with the structural guard above.

- **`src/main/adapters/claude.ts`**
  - Set `sessionResume` to a non-null assigned descriptor.
  - Implement assigned/create launch syntax using the Chorus-minted id.
  - Implement assigned/resume syntax using `--resume <agentSessionId>`.
  - Implement `classifyResumeFailure()` for Claude’s measured unknown-id, in-use, and unavailable-transcript outcomes.
  - Retain all route, effort, extra-argument, and hook handling in the same `buildLaunch`.

- **`src/main/adapters/codex.ts`**
  - Set `sessionResume` to a non-null discovered descriptor.
  - Keep normal fresh argv when `spec.resume` is absent.
  - Build `codex resume <agentSessionId>` when `spec.resume` is present.
  - Implement `discoverSessionId(context)` by inspecting rollout-file first-line `session_meta` records only.
  - Require exact `cwd` equality, enforce `launchedAt`, reject ambiguity, and return `null` on timeout.
  - Implement `classifyResumeFailure()` for codex resume failures.

- **`src/main/adapters/kimi.ts`**
  - No change.
  - `sessionResume` remains `null`.
  - No discovery or resume implementation.

- **`src/main/adapters/opencode.ts`**
  - No change.
  - `sessionResume` remains `null`.
  - No discovery or resume implementation.

- **`src/main/adapters/adapters.test.ts`**
  - Remove the method-pair assertion.
  - Assert that each non-null descriptor satisfies `supportsResume()`.
  - Assert Claude assigned/create and assigned/resume argv forms exactly.
  - Assert codex discovered/resume argv starts with `resume`.
  - Assert discovered adapters expose `discoverSessionId`.
  - Assert assigned adapters do not expose `discoverSessionId`.
  - Assert capable adapters classify their known resume-failure fixtures.
  - Assert kimi and opencode retain `sessionResume: null`.

- **`src/main/sessionManager.ts`**
  - Preserve the sole `buildLaunch` call path.
  - Preserve `composeChildEnv` as the sole credential-to-child-environment owner.
  - For an assigned adapter with a NULL pointer: mint and persist an agent id, then pass assigned/create.
  - For a stored pointer: pass the appropriate resume directive.
  - For a discovered adapter with NULL pointer: launch fresh with no modifier, then start bounded, abortable discovery after successful spawn.
  - Persist a discovered pointer only if the session and spawn generation remain current and the rollout header positively matches `cwd`.
  - On adapter-classified resume failure: clear the pointer, emit the visible badge, and relaunch once fresh.
  - Insert the restart separator into the mirror/output boundary before new PTY output.

- **Explicitly unchanged**
  - Migration v19 and database schema.
  - Renderer-facing IPC channels, `IpcChannel`, and renderer code.
  - Credential storage and the `composeChildEnv` ownership rule.
  - D16 stable session-row identity and D142 pointer rotation.
  - The single output fan-out path.
  - Dependencies.
  - kimi and opencode behaviour.

## Failure behaviour

An implementer follows these rules:

1. **NULL `agent_session_id`, assigned adapter**
   - Mint a new vendor agent-session id.
   - Persist it with `setAgentSessionId`.
   - Launch with `{ strategy: 'assigned', action: 'create', agentSessionId }`.
   - Do not show a resume-failure badge.

2. **NULL `agent_session_id`, discovered adapter**
   - Launch fresh without `resume`.
   - Start bounded, abortable discovery only after spawn succeeds.
   - Persist only a positively matched, current rollout-header result.
   - If discovery returns `null`, times out, is ambiguous, or is aborted, leave the pointer NULL and show no resume-failure badge.

3. **Non-NULL `agent_session_id`**
   - Perform exactly one resume launch using the stored pointer.
   - If the adapter classifies the result as `not-found`, `in-use`, `transcript-unavailable`, or `unusable-pointer`, call `clearAgentSessionId()`.
   - Relaunch once fresh under the same Chorus `sessions.id`.
   - For Claude, mint and persist a replacement id before the fresh assigned/create launch.
   - Emit a visible badge in the existing restart-badge family: “Context was not restored — started a fresh conversation,” with a stable reason where available.
   - Do not silently fall back, prompt, refuse to launch, or retry the same pointer in that spawn cycle.

4. **Ambiguity**
   - Never persist an uncertain discovered id.
   - Fresh is always preferred to a potentially wrong conversation.

## Risks & mitigations for the winner

- **Risk: an adapter advertises resume but ignores `spec.resume`.**  
  **Mitigation:** structural `supportsResume()` checks plus adapter tests asserting exact fresh and resume argv forms.

- **Risk: assigned creation is lost if the modifier models only resumption.**  
  **Mitigation:** `AgentSessionLaunch` explicitly distinguishes assigned/create from resume.

- **Risk: the name `resume` is imperfect for the assigned/create state.**  
  **Mitigation:** document it as the agent-session launch modifier and enforce valid discriminated combinations. The naming cost is lower than a second launch API.

- **Risk: codex discovery selects a stale rollout or a sibling-worktree rollout.**  
  **Mitigation:** require exact rollout-header `cwd`, apply `launchedAt`, reject ambiguity, and never use `session_index.jsonl` as the discriminator.

- **Risk: discovery writes after quit, restart, disposal, or a superseding spawn.**  
  **Mitigation:** use `AbortSignal` and a current spawn-generation check immediately before persistence.

- **Risk: generic orchestration learns vendor error strings.**  
  **Mitigation:** adapters classify vendor-specific resume outcomes; `SessionManager` applies only the generic consequence.

- **Risk: retained terminal history implies agent memory after restart.**  
  **Mitigation:** insert a mandatory separator and use the existing restart-badge family; do not replay old and new output as uninterrupted history.

- **Risk: separator implementation appears to require renderer work.**  
  **Mitigation:** write the separator as formatted terminal text through the existing main-process scrollback/output path. No new IPC channel or renderer feature is required.

## Answer to question 6

None. No load-bearing alternative shape should replace the approved single-launch-path design.

## Record of disagreements and arbiter commentary

- **[Q3 / DeepSeek R1] Discovery miss must not be called a resume failure; vendor failure recognition should remain adapter-owned; discovery must be fresh-launch-only.**  
  Well-founded and adopted. A discovery miss follows a fresh launch and therefore cannot truthfully be presented as a failed resume. The approved contract also makes failure recognition adapter-owned and discovery fresh-launch-only.

- **[Q3 / DeepSeek R1] A dedicated discovery type guard was missing, and the prior wording was inconsistent about whether `supportsResume()` itself required discovery support.**  
  Well-founded. The approved `supportsResume()` validates the descriptor-kind requirement directly: discovered descriptors require `discoverSessionId`; assigned descriptors forbid it. A separate `supportsDiscover()` guard is unnecessary under this stronger structural guard.

- **[Q3 / DeepSeek R1] Restart of a discovered session has a legitimate NULL-pointer window before rediscovery completes.**  
  Well-founded and adopted. The SessionManager action explicitly records that restart produces a fresh codex launch, followed by best-effort discovery; quitting in that interval safely degrades to another fresh launch.

- **[Q1 and Q7 / GLM R1] Mixing `create` into a field called `resume` is potentially confusing, and clearing scrollback is unnecessarily destructive.**  
  Partly well-founded. The semantic objection to the field name is real and is the strongest argument against the chosen shape. It does not outweigh the need to carry Claude’s assigned creation id through the only launch path. The scrollback objection is adopted: history is retained behind a separator rather than cleared.

- **[Q3 / GLM R1] Discovery needs a `launchedAt` lower bound as well as a `cwd` match.**  
  Well-founded and adopted. Exact `cwd` is the primary verified discriminator; `launchedAt` prevents accepting an older matching rollout from the same worktree.

- **[Q3 / GLM R1 and Grok R1] `DescriptorMode` risks duplicating the new assigned/discovered distinction.**  
  Well-founded as a maintenance concern, but removal cannot be justified from the established facts because `mode` is already declared and its other use is not supplied. The approved contract retains it only for compatibility and explicitly states that `kind`, not `mode`, expresses D140’s lifecycle distinction. A later removal requires evidence that no consumer needs it.

- **[Q7 / GLM R1] The separator must be technically achievable without renderer or IPC changes.**  
  Well-founded and adopted. The separator is injected through the existing main-process terminal/mirror output path as terminal text, not through a renderer feature or new channel.

- **[Q1 and Q7 / Grok R1] A `create` action inside `resume` is awkward, and D16 does not require destruction of user-visible scrollback.**  
  Well-founded in part. The field naming drawback is accepted as the price of one launch path; the scrollback conclusion is adopted in full through the mandatory separator.

- **[Q3, Q4, and Q5 / Grok R1] The contract must specify concrete vendor failure recognition, descriptor-kind method requirements, restart-to-rediscovery timing, and tests for incapable adapters.**  
  Well-founded and adopted. The contract adds adapter-local `classifyResumeFailure`, structural support requirements, the discovery window rule, and explicit kimi/opencode test obligations.

- **[Q3 and Q5 / Grok R1] `mode` needs justification or removal, and badge wording should remain consistent with existing restart UX.**  
  Well-founded. `mode` is retained only because its removal lacks supporting repository facts; `kind` carries the new semantics. The ruling requires reuse of the existing restart-badge family rather than introducing a renderer-facing badge mechanism.

- **[Q4 and Q5 / Grok R1] The prior position needed more core-contract detail, including transcript-check ownership and explicit incapable-adapter behaviour.**  
  Well-founded. The adopted contract places vendor transcript/error recognition in adapters and explicitly leaves kimi and opencode non-capable and unchanged.

## Action items for implementation

1. **Task 4a-2: update `types.ts`.**  
   **Check:** `ResumeSpec` and `resumeSession()` no longer exist; `PtyLaunchSpec.resume`, discriminated descriptors, discovery context, failure classifier types, and structural `supportsResume()` compile.

2. **Task 4a-2: implement Claude assigned-id launch handling.**  
   **Check:** tests demonstrate assigned/create uses the minted vendor id and assigned/resume uses `--resume <id>` while preserving normal launch options.

3. **Task 4a-2: implement codex resume argv and discovery.**  
   **Check:** tests demonstrate resume argv begins `['resume', id]`; discovery accepts only current rollout headers with exact `cwd`, rejects ambiguity, and never uses `session_index.jsonl` as identity evidence.

4. **Task 4a-2: rewrite capability honesty tests.**  
   **Check:** non-null descriptors satisfy `supportsResume()`; assigned descriptors lack discovery; discovered descriptors provide discovery; Claude and codex have exact resume argv fixtures; kimi and opencode remain `sessionResume: null`.

5. **Task 4a-2: add adapter-local resume failure classification.**  
   **Check:** fixture tests cover Claude unknown-id and id-in-use output, plus unavailable transcript handling; SessionManager need not contain vendor-specific output strings.

6. **Task 4a-3: wire assigned and stored-pointer launches through the existing `buildLaunch` call.**  
   **Check:** Claude with NULL pointer mints and persists an id before launch; any stored pointer produces exactly one resume launch; `composeChildEnv` remains called only in `SessionManager.spawn`.

7. **Task 4a-3: wire bounded codex discovery.**  
   **Check:** discovery starts only after successful fresh codex spawn; it is aborted on quit, restart, disposal, and superseding spawn; stale or aborted results never update `agent_session_id`.

8. **Task 4a-3: implement the failed-resume recovery rule.**  
   **Check:** each classified failure clears the pointer, launches once fresh under the same Chorus session row id, and emits a visible context-not-restored badge; discovery misses do none of these.

9. **Task 4a-3: add restart scrollback separation.**  
   **Check:** restart retains prior mirror content, inserts exactly one visible fresh-conversation separator before new PTY output, and requires no renderer change or IPC channel.

10. **Manual verification before closing D139.**  
    **Check:** verify Claude create, restore-resume, unknown-id recovery, and in-use recovery; verify codex fresh discovery and resume across concurrent sibling worktrees; verify quit during discovery leaves NULL and restores fresh.

---

## How disagreement was detected

- **Q1** — detection: `structural` · members agreed · no verdict token from: GLM 5.2
- **Q2** — detection: `structural` · members agreed · no verdict token from: GLM 5.2
- **Q3** — detection: `structural` · members disagreed · no verdict token from: GLM 5.2
- **Q4** — detection: `structural` · members agreed · no verdict token from: GLM 5.2
- **Q5** — detection: `structural` · members agreed · no verdict token from: GLM 5.2
- **Q6** — detection: `structural` · members agreed · no verdict token from: GLM 5.2
- **Q7** — detection: `structural` · members disagreed · no verdict token from: GLM 5.2

_`structural` means the orchestrator compared the members' own verdict tokens and counted the difference. `model-judged` means too few members answered in the required form, so the arbiter judged it from prose — a weaker signal, labelled rather than hidden._

## Dissents preserved

_14 preserved: 2 structural (computed from the members' own verdict tokens) · 12 from critique prose, from 3 members — DeepSeek v4 Pro 0813 4 · GLM 5.2 4 · Grok 4.5 4._

_⚠ Read the per-member split before reading breadth into the total: several objections from one member is one member disagreeing repeatedly, not several members disagreeing. Nothing is dropped to make the total smaller._

- [Structural — Q3] Q3: how the interface expresses assign-versus-discover, with the exact signature and timing of any method you add. — AGREE: DeepSeek v4 Pro 0813 · QUALIFY: Grok 4.5
- [Structural — Q7] Q7: whether `session:restart` should clear, keep, or visibly separate the scrollback mirror it currently re-seeds. — AGREE: DeepSeek v4 Pro 0813 · QUALIFY: Grok 4.5
- [Critique — R1] DeepSeek v4 Pro 0813: I disagree with treating failed discovery as a resume failure with a “Resume failed” badge. On a first launch where no resume was attempted, discovery miss just means no pointer was found; labeling it “Resume failed” is misleading. I also disagree with putting Claude-specific transcript-file checks and exit-string parsing in `sessionManager.ts`; that leaks vendor CLI knowledge into shared code and should be adapter-owned. The discovery trigger should also be explicitly fresh-launch-only, not merely “after the PTY starts.”
- [Critique — R1] DeepSeek v4 Pro 0813: Position A misses a real `supportsDiscover()` type guard; it relies on tests to enforce method presence but offers less implementation-safe narrowing. It also does not clearly separate discovery miss from resume failure in its contract, though its unprompted restart observation is useful.
- [Critique — R1] DeepSeek v4 Pro 0813: The Q5 wording says `supportsResume()` requires the discover method for discover-kind adapters, but the contract’s `supportsResume()` only checks `sessionResume != null` and leaves method checking to `supportsDiscover()`. That inconsistency should be fixed in favor of the contract. Also, failure detection is still under-specified: it says to detect CLI failures but does not define an adapter-owned detection surface, so implementers may still leak vendor strings into `SessionManager`.
- [Critique — R1] DeepSeek v4 Pro 0813: Position B misses Position A’s explicit observation that restart of a discovered session is a two-step process with a pointer-NULL window between spawn and discovery. It should be documented to prevent an implementer from trying to make it atomic. It also could more explicitly define where CLI-specific resume-failure detection lives.
- [Critique — R1] GLM 5.2: The inclusion of `action: 'create' | 'resume'` within the `ResumeDirective` for `assigned` kinds is contradictory. If `PtyLaunchSpec.resume` is present, the intent is inherently to resume. Mixing a "create" action into a resume directive muddies the contract and could lead to adapter authors misinterpreting when to mint a new ID versus resume an existing one. The directive should strictly govern the resume path. Additionally, Q7’s mandate to clear the scrollback mirror entirely on `session:restart` is overly destructive. Terminal scrollback is user context, not agent memory; wiping it discards useful information that the user might need to reference.
- [Critique — R1] GLM 5.2: The position does not account for the race condition between discovery and concurrent worktrees as robustly as it could. It mentions `cwd` matching but lacks a lower-bound timestamp (like `launchedAt`) to prevent matching stale rollout headers from a previous session in the same worktree. ### Position B
- [Critique — R1] GLM 5.2: The `ResumeDescriptor` retains `mode: DescriptorMode` ("keep existing 'static' | 'dynamic' if still used elsewhere"). If the resume capability has been fully reworked into the `assigned` / `discovered` dichotomy, carrying over legacy `mode` properties just in case invites dead code and confusion. If it's not strictly needed for the resume contract, it should be stripped out to keep the new contract pure.
- [Critique — R1] GLM 5.2: While the file-by-file changes are highly detailed, the position doesn't explicitly address how the "visible separator" in Q7 is technically implemented in the renderer pane. Since the prompt states IPC channels and the renderer do NOT change, it is worth explicitly noting how the separator is rendered without renderer modifications (e.g., injecting a formatted string directly into the PTY stream via the main process).
- [Critique — R1] Grok 4.5: Q1 `ResumeDirective` shape — packing `action: 'create' | 'resume'` into `resume` is misnamed and doubles identity (`spec.sessionId` vs `resume.sessionId`). Create is “no resume field”; resume is “id present.” Discovered-at-launch also should not require a pre-spawn id in the modifier. Q7 — clearing scrollback on `session:restart` over-reads D16.4 (agent/pointer honesty), not destruction of the user’s terminal work product; a visible separator achieves honesty without data loss.
- [Critique — R1] Grok 4.5: Concrete failure detection per vendor; honesty checks that `kind === 'discovered'` requires `discoverSessionId` and `assigned` forbids it; restart→rediscover timing (NULL pointer window); risks (silent ignore of `spec.resume`, sibling-worktree rollout ambiguity); file-level wiring. `ResumeDescriptor` should not need a parallel lifecycle enum beyond assign/discover unless separately justified.
- [Critique — R1] Grok 4.5: `ResumeDescriptor.mode: 'static' | 'dynamic'` is unexplained surplus if `kind` already carries assign-vs-discover — drops or justifies it to avoid two overlapping discriminators. Synthesis badge copy should stay consistent with existing “Session restarted” UX unless product renames it deliberately. Optional tight discovery timeout is good but must stay non-blocking on quit (as Q3 states).
- [Critique — R1] Grok 4.5: Little material on core contract. Minor: whether transcript existence checks for `assigned` belong in generic manager vs adapter; how pane badge reasons are i18n/stable-id’d; explicit test that kimi/opencode stay `sessionResume: null` and ignore `resume` if passed.

## Provenance

- **Run id:** `e8b8003a-2ac9-403b-940b-58d3008bfd59`
- **Started:** 2026-08-13T13:06:34.681Z

| Member | Role | Model | Turns |
|---|---|---|---|
| DeepSeek v4 Pro 0813 | member | `deepseek/deepseek-v4-pro-0813` | answered 2 turns |
| GLM 5.2 | member | `z-ai/glm-5.2` | answered 2 turns |
| Grok 4.5 | member | `x-ai/grok-4.5` | answered 2 turns |
| Qwen 3.8 | member | `qwen/qwen3.8-max` | refused 1 turn |
| GPT 5.6 Terra | arbiter | `openai/gpt-5.6-terra` | answered 2 turns |

