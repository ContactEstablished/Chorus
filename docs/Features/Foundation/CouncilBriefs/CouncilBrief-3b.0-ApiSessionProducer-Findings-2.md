> Council of 3 members plus an arbiter. All members completed.

> ⚠ **These findings are model deliberation, not verified fact.** Every claim below was produced by language models reading the brief. Nothing here was compiled, executed or tested, and no model in this council could see the repository. This project’s own CR-3b.0 was unanimous, its rulings were sound, and the code it shipped had four compile errors. Verify anything you are about to rely on.

# Council Findings — CR-3b.0: Who Produces an `ApiSessionHandle`?

_Arbiter's filing · Brief CR-3b.0 · Code state verified at `341ea5c` · To be recorded as **D63**_
_Members: CR GLM (5.2), CR Kimi (k3), CR Qwen (3-coder). Convergence on Q1/Q2/Q4 was unanimous; Q3 and Q5 required an arbiter ruling._

**Label mapping for the critique record** (each critic anonymised the others differently, and the record preserves their labels): in **CR GLM's** critique, "Position B" = CR Qwen. In **CR Kimi's** critique, "Position A" = CR GLM and "Position B" = CR Qwen. In **CR Qwen's** critique, "Position A" = CR GLM and "Position B" = CR Kimi. Every commentary below names the actual member.

---

## Per-model positions

**CR GLM (5.2): Q1 D / Q2 out / Q3 correct / Q4 scrub (caller-wired) / Q5 none**
  — Argues Option D dissolves the "two producers" objection because Phase 3d's `startApiSession` becomes a one-line delegation to the factory, and that D is not speculative shaping because `ApiLaunchSpec`/`ApiSessionHandle` already exist in `types.ts` — D supplies a body for a declared contract rather than inventing a new one. Rules council members out of `SessionManager` on the ground that the absence of a `sessions` row makes restore-resurrection structurally impossible. Holds the declared handle correct provided `receive()` is documented as a cold, consume-to-completion iterable, with an optional runtime guard against interleaved sends. Contributes the round's single most valuable unprompted item: `receive()` has no error channel, so a typed `ApiSessionError` with a `kind` discriminant must throw from iteration and be recorded per member.
  — Strongest counterargument to its own choice (as stated): D is a prediction about a future call site, and the struck `SupportsStateDetection` is in-repo precedent that such predictions age badly.

**CR Kimi (k3): Q1 D / Q2 out (`CouncilRun` holds `Map<memberLabel, ApiSessionHandle>`) / Q3 replace / Q4 scrub, bound inside the factory / Q5 named (hybrid E — unregistered `ApiAgentAdapter`, conditional on `BaseAgentAdapter.id`)**
  — Identifies two defects in the declared handle that are cheap only now: there is no channel for the `usage` block Matthew's settled per-member cost model requires, and turn pairing is unspecified, so receive-before-send, double-receive and interleaved-send are all representable. Rejects B on the arithmetic — six schema references grow refusal branches to buy a capability 3b never exercises — and refuses to import `openrouterKeys.ts`'s 10 s budget as a *total* cap into a streaming context. Binds the scrub seam inside the factory so no consumer can obtain unscrubbed api text.
  — Strongest counterargument to its own choice: D is "A wearing a promise"; if Phase 3d reshapes adapter construction, the one-line-delegation claim may not survive, leaving a real type-level-honesty debt today.

**CR Qwen (3-coder): Q1 D / Q2 out / Q3 correct / Q4 scrub / Q5 none / Q6 lift the registry in 3b**
  — Reaches the right destination on Q1/Q2/Q4 but supplies no module boundary, no signature, no owner for the `AbortController`, and no error or cancellation story — a direction rather than a reviewable artifact. Its Q6 "yes" reverses its own Q1 rationale and rests on a false dichotomy ("delay forces forking or postponement") that Option D exists specifically to refute. Its critique round contributes two things the findings adopt: the demand that `lastUsage()` nullability be specified explicitly, and a process note that the scrub threat model should be written into the repo, not just the decision record.
  — Strongest counterargument to its own choice: none coherent, given the contradiction between its Q1 and Q6.

---

## Council synthesis

**Q1: Option D — a standalone factory in `src/main/services/apiSession.ts`, shaped so a future `ApiAgentAdapter.startApiSession` is a *binding* of it (unanimous 3-of-3).** All three members reached D independently; none defended A, B or C. B is rejected because widening `agentKindSchema` admits an id into `attachRequestSchema`, `launchRequestSchema`, both launch-profile schemas, `sessionInfoSchema` and `legacyPaneSchema` that **cannot spawn a PTY**, forcing five new refusal branches plus a re-audit of the F25 projection filter — to buy a capability the council never uses (no launch-dialog entry, no `sessions` row, no layout leaf). C is rejected outright as a second implementation of the conversation mechanism, which is exactly what D45(2) forbids; no member argued D45(2) was wrong. A is strictly dominated by D: they produce the same code, and D additionally forecloses the outcome where Phase 3d writes an independent `startApiSession` body. **On the question this council was forbidden to dodge — yes, `ApiAgentAdapter.startApiSession` and `getModels` remain declared-but-unimplemented for the whole of Phase 3b.** That is ruled acceptable only because the debt is given teeth a comment cannot provide: a compile-time assertion in `apiSession.ts` that the bound factory *is* assignable to `ApiAgentAdapter['startApiSession']`, so any drift breaks the build in 3b rather than surfacing in 3d, plus a D63 entry naming Phase 3d as owner of the delegation. That is the material difference from `SupportsStateDetection`, which had no body and no scheduled consumer; this declaration has a fully exercised body and a build-enforced link to it.

**Q2: OUT — a council member never enters `SessionManager` (unanimous 3-of-3).** A `CouncilRun`, owned by `CouncilService`, holds `Map<memberLabel, ApiSessionHandle>` and disposes every handle on completion, cancel, fatal error and app quit. **Restore consequence, stated plainly:** no `sessions` row is written and `SessionManager`'s `Map<string, PtySession>` never sees a handle, so `restore()`'s reconciliation of persisted `running` rows against the layout tree has nothing to find. Resurrection of a crashed council run is therefore structurally impossible rather than policy-forbidden, and constraint 5 (no credential resolved for inference without a user gesture) holds by construction, not by a guard a future contributor can delete. The cost is that the session-type split D45 named the highest-regression-risk refactor in the codebase is deferred again — correct, since a four-task phase must not trigger it as a side effect.

**Q3: REPLACE (2-of-3 explicitly; the third member endorsed the substance of the replacement in its critique round, so 3-of-3 on substance, 2-of-3 on the vote as cast).** CR GLM's minority "correct as declared" cannot survive one fact: the settled cost model requires per-member token/cost granularity read from each response's `usage` block, only the handle ever sees that block, and `AsyncIterable<string>` cannot carry it. That is a missing channel, not a documentation gap. The second change — `send` returning its own turn's stream — makes turn pairing structural rather than documented and makes end-of-iterable the round-complete signal a blind-round orchestrator must await. Both changes serve an interactive chat pane unchanged (`await send` → iterate → render → read `lastUsage()` for a cost footer). The batch alternative (`send(prompt): Promise<string>`) is explicitly argued down: it cannot stream, the roadmap requires live deliberation, and it would force the chat pane to re-stream later — the precise divergence D45(2) exists to prevent. CR GLM's error-channel observation is folded in as a first-class part of the replacement. Verbatim interface below.

**Q4: SCRUB — and the scrub binds INSIDE the factory, not in the caller (3-of-3 on scrub; arbiter rules for CR Kimi, 1-of-2, on the binding site).** Threat model, named: **content echo, not key echo.** CR GLM and CR Kimi are both right that the model cannot echo an `Authorization` header it was never sent, so the PTY threat model does not transfer. The operative threat is that council members are fed a brief `.md` that may itself quote secrets, and their output lands on the two worst surfaces — a findings `.md` on disk (the artifact most likely to be pasted into an issue tracker) and a live-rendered view. Secondary threats: provider or gateway error bodies that reflect request metadata (**unverified for OpenRouter** — must be checked, and error text sanitized on the way out as `openrouterKeys.ts` already does), and defence-in-depth on the minted per-run key, which costs one array entry. On the binding site, CR GLM's caller-wired reading is defensible from the PTY precedent, but §3.4's stated purpose is that "a second session type cannot ship unredacted by forgetting a second wiring point" — a caller-wired seam *is* that second wiring point, and there will be at least two callers (CouncilService, the chat pane). Binding inside the factory makes the handle's stream scrubbed-by-construction: no consumer can obtain unscrubbed api text at all. Residual limit, recorded honestly: the scrubber exact-matches *registered* values and cannot catch an unregistered secret pasted into a brief; that is brief hygiene, not this seam.

**Q5: NONE (2-of-3; CR Kimi's hybrid E rejected, dissent preserved).** Hybrid E — a real `ApiAgentAdapter` object constructed but never registered — buys type-level honesty at nominally zero blast radius, and CR Kimi was right to gate it on a one-grep check of `BaseAgentAdapter.id`. It is rejected for two costs it did not price: (i) `ApiAgentAdapter` also declares `getModels`, which Phase 3b has no consumer for, so E converts one honest gap into a stub or a throw — relocating the dishonesty rather than removing it; and (ii) per-member secrets mean the adapter object must be constructed per council run, alien to a codebase where adapters are module singletons, and a registry-shaped object sitting outside the registry invites a later contributor to register it without doing the `agentKindSchema` / F25 / launch-refusal work. The factory-inside-`SessionManager` hybrid was considered and correctly discarded by two members.

**Q6 (not a numbered position, judged from prose): the frozen-registry lift STAYS with Phase 3d. 2-of-3, and the minority is plainly wrong.** CR Qwen's "yes" contradicts its own Q1 — Option D is *defined* by not touching the registry — and its justification ("delaying forces either forking logic or postponing Phase 3b indefinitely") is a false dichotomy D refutes by construction: the factory ships in 3b, and 3d's lift converts `startApiSession` into a binding of it. Nothing forks; nothing is postponed. D52 assigned the lift to 3d *together with* `agentKindSchema` widening in the same change; that pairing is the F25 mitigation itself and must not be split across phases. Moving it into 3b would land a wire-enum widening in the same commit as the first-ever api transport, breaching constraint 7.

---

## The producer (verbatim TypeScript, implementable)

```ts
// ═══════════════════════════════════════════════════════════════════════════
// (1) src/main/adapters/types.ts — AMEND: replace the ApiSessionHandle block.
//     Zero implementations exist, so this is a free change. ApiAgentAdapter
//     and ApiLaunchSpec are UNCHANGED.
// ═══════════════════════════════════════════════════════════════════════════

export interface ApiUsage {
  readonly promptTokens: number
  readonly completionTokens: number
  /** Provider-reported cost for this turn in USD. null when not reported. */
  readonly costUsd: number | null
}

export type ApiSessionErrorKind =
  | 'auth'        // 401/403 — credential refused.            NOT retryable.
  | 'rate_limit'  // 429 — provider throttled.                retryable.
  | 'provider'    // 5xx / upstream model error.              retryable.
  | 'network'     // fetch rejected, socket died.             retryable.
  | 'timeout'     // time-to-first-byte or idle deadline hit. retryable.
  | 'protocol'    // unparseable SSE / malformed payload.     NOT retryable.

export class ApiSessionError extends Error {
  constructor(
    readonly kind: ApiSessionErrorKind,
    /** MUST already be scrubbed by the thrower. Never interpolate a credential. */
    message: string,
    readonly retryable: boolean,
    readonly status?: number
  ) {
    super(message)
    this.name = 'ApiSessionError'
  }
}

export interface ApiSessionHandle {
  /**
   * Correlation label, NOT a `sessions` row id. Council members use
   * `council:<runId>:<memberLabel>`. Nothing keys SessionManager off this.
   */
  readonly sessionId: string

  /**
   * Opens exactly ONE turn. Appends `message` to this handle's internal
   * conversation history and issues the request.
   *
   * Resolves once the provider has accepted the request (response head ok,
   * body stream open) with the turn's OWN text stream.
   * Rejects with ApiSessionError for auth / rate_limit / provider / network /
   * timeout failures detected before the first body byte.
   * Rejects if a turn is already open on this handle — one turn at a time.
   *
   * The returned iterable:
   *   - yields ALREADY-SCRUBBED, buffer-coalesced text (see sessionOutput.ts);
   *   - may be iterated exactly once;
   *   - completes normally at end-of-turn — that completion IS the
   *     "member finished" signal a blind-round orchestrator awaits;
   *   - throws ApiSessionError if the stream fails mid-turn (text already
   *     yielded stays yielded);
   *   - RETURNS (never throws) if dispose() is called mid-turn, so a
   *     deliberate cancel is not recorded as a member failure.
   */
  send(message: string): Promise<AsyncIterable<string>>

  /**
   * Usage of the most recently COMPLETED turn.
   * null before any turn completes, null if the turn failed, and null when the
   * provider did not report usage for a streamed response (see VERIFY-1).
   */
  lastUsage(): ApiUsage | null

  /** Idempotent. Aborts any in-flight turn, flushes the scrub carry, releases
   *  the body stream. Never throws, including on an already-disposed handle. */
  dispose(): Promise<void>
}
```

```ts
// ═══════════════════════════════════════════════════════════════════════════
// (2) src/main/services/apiSession.ts — NEW. The single producer.
//     No electron import. No node-pty import. No new npm dependency.
// ═══════════════════════════════════════════════════════════════════════════

import { createSessionOutput } from './sessionOutput'
import { ApiSessionError } from '../adapters/types'
import type {
  ApiAgentAdapter,
  ApiLaunchSpec,
  ApiSessionHandle,
  ApiUsage
} from '../adapters/types'

export interface ApiSessionDeps {
  /** Injected for testability, exactly as openrouterKeys.ts does. */
  readonly fetchImpl: typeof fetch
  /**
   * Exact secret VALUES registered with this session's scrubber. For a council
   * run: the minted per-run OpenRouter key, plus the resolved provisioning
   * credential if it is distinct. Never a label, never a fragment.
   */
  readonly secrets: readonly string[]
  /** Default: OpenRouter chat-completions. Injected so tests never touch net. */
  readonly baseUrl?: string
  /** sessionOutput buffering. Defaults mirror SessionManager.spawn. */
  readonly maxBufferChars?: number
  readonly flushMs?: number
  /**
   * SEMANTIC deadlines, NOT a total-duration cap. A 10s total cap (the
   * openrouterKeys.ts budget) would abort healthy long deliberations.
   */
  readonly firstByteTimeoutMs?: number   // default 30_000
  readonly idleTimeoutMs?: number        // default 45_000
}

/**
 * Constructs an api-mode session. Performs NO I/O and resolves NO credential:
 * `spec.credential` arrives already resolved by ipc.ts:resolveCredential, so
 * there is exactly one decryption path in the app (constraint 3).
 */
export function createApiSession(
  spec: ApiLaunchSpec,
  deps: ApiSessionDeps,
  signal?: AbortSignal
): Promise<ApiSessionHandle>

/**
 * PHASE 3D ADOPTION SEAM. Binding deps once yields a function whose type IS
 * ApiAgentAdapter['startApiSession']. When the registry is lifted, the adapter
 * method is `startApiSession: bindApiSession(deps)` — one line, no second body.
 */
export const bindApiSession =
  (deps: ApiSessionDeps) =>
  (spec: ApiLaunchSpec, signal?: AbortSignal): Promise<ApiSessionHandle> =>
    createApiSession(spec, deps, signal)

/**
 * TEETH. Compile-time proof, enforced in Phase 3b, that this factory can serve
 * as the declared adapter method. If ApiAgentAdapter['startApiSession'] ever
 * drifts from this factory, the BUILD fails here — the same
 * failure-mode-as-guardrail discipline as registry.ts.
 */
type _StartApiSession = ApiAgentAdapter['startApiSession']
const _adoptionAssertion: (deps: ApiSessionDeps) => _StartApiSession = bindApiSession
void _adoptionAssertion
```

```ts
// ── implementation skeleton for createApiSession (same file) ────────────────
//
// Internal state per handle:
//   history: { role: 'system' | 'user' | 'assistant'; content: string }[]
//     seeded with spec.systemPrompt when present
//   turnOpen: boolean
//   disposed: boolean
//   controller: AbortController | null      // per turn
//   usage: ApiUsage | null                  // last COMPLETED turn
//   out: SessionOutput                      // ONE per handle (per member):
//                                           // never share — Scrubber carries
//                                           // chunk-boundary state.
//
// createSessionOutput({
//   secrets: deps.secrets,
//   maxChars: deps.maxBufferChars ?? <SessionManager.spawn default>,
//   flushMs: deps.flushMs ?? <SessionManager.spawn default>,
//   onText: (text) => queue.push(text)      // push→pull bridge into the
//                                           // turn's AsyncIterable
// })
//
// send(message):
//   1. if (disposed) throw ApiSessionError('protocol', 'session disposed', false)
//   2. if (turnOpen) throw ApiSessionError('protocol', 'turn already open', false)
//   3. turnOpen = true; history.push({ role: 'user', content: message })
//   4. controller = new AbortController(); link `signal` and the TTFB timer.
//   5. res = await deps.fetchImpl(url, {
//        method: 'POST',
//        signal: controller.signal,
//        headers: { Authorization: `Bearer ${<token off spec.credential>}`,
//                   'Content-Type': 'application/json' },
//        body: JSON.stringify({
//          model: spec.modelId,
//          messages: history,
//          stream: true
//          // VERIFY-1: the flag that makes a STREAMED OpenRouter response
//          // report `usage` in its terminal chunk. Do not guess it.
//        })
//      })
//      — reject mapping: 401/403 → 'auth' (retryable false);
//        429 → 'rate_limit'; 5xx → 'provider'; abort-by-timer → 'timeout';
//        fetch rejection → 'network'. Response body text is scrubbed with a
//        ONE-SHOT exact-replace over deps.secrets before being put in a
//        message — do NOT reuse `out`'s Scrubber (it holds carry state).
//   6. return the turn's AsyncGenerator:
//        for each SSE `data:` line → JSON.parse → delta content → out.ingest(text)
//        capture the terminal chunk's `usage` into a local pending value
//        on `[DONE]` / body end: out.flush(); drain queue; history.push(assistant
//        full text); usage = pending; turnOpen = false; return.
//        on mid-stream failure: out.flush(); turnOpen = false;
//        throw ApiSessionError(<kind>, <scrubbed>, <retryable>)
//        on dispose(): out.flush(); drain queue; RETURN (do not throw).
//        idle timer rearmed on every chunk.
//
// dispose():
//   disposed = true; controller?.abort(); out.flush(); out.dispose();
//   idempotent; never throws.
```

```ts
// ═══════════════════════════════════════════════════════════════════════════
// (3) src/main/services/councilRun.ts — the OWNER (Q2 ruling). Sketch only.
// ═══════════════════════════════════════════════════════════════════════════

export interface CouncilRun {
  readonly runId: string
  /** No `sessions` row, no layout leaf, no SessionManager entry — by design. */
  readonly members: ReadonlyMap<string, ApiSessionHandle>
  dispose(): Promise<void>   // disposes every handle; called on complete,
                             // cancel, fatal error, and app before-quit.
}
```

---

## What Phase 3b implements vs declares

**Implements (live code, exercised from day one):**
- `src/main/services/apiSession.ts` — `createApiSession`, `bindApiSession`, the compile-time adoption assertion.
- The amended `ApiSessionHandle` / `ApiUsage` / `ApiSessionError` in `adapters/types.ts`.
- Scrub binding *inside* the factory: one `SessionOutput` per handle; the handle's stream is scrubbed-by-construction.
- `CouncilRun` / `CouncilService` as an **orchestrator over** handles (D45(2)) — blind-round fan-out, per-member failure isolation, live stream to the council view/route, findings `.md` written from scrubbed text only.
- Per-run OpenRouter key mint and revoke through the existing `openrouterKeys.ts`; credential resolution through the existing `ipc.ts:resolveCredential`.

**Declares, deliberately not implemented in 3b (with teeth, not comments):**
- `ApiAgentAdapter.startApiSession` — unimplemented; the build now proves `bindApiSession(deps)` is assignable to it, so it cannot silently drift, and D63 names **Phase 3d** as owner of the one-line delegation.
- `ApiAgentAdapter.getModels` — unimplemented. Phase 3b has no model picker; council member model ids come from configuration, not discovery. A stub would be worse than an honest gap.

**Untouched, verifiable by the reviewer of the commit:**
- `agentKindSchema` stays `z.enum(['claude', 'codex'])`; `staticRegistry` unchanged; the F25 projection filter unchanged; `sessions` / `launch_profiles` / `dispatches` unchanged; `SessionManager` unchanged (zero diff lines); **no migration — schema stays at v10**; no layout-tree change (council is a view/route).

---

## Risks & mitigations for the winner

1. **VERIFY-1 (gating; vendor uncertainty — do not guess): can OpenRouter return a `usage` block on a *streamed* chat-completion, and what request flag enables it?** The OpenAI-compatible family has used a `stream_options`-style flag and OpenRouter has its own usage-accounting option; **I am not certain of either for OpenRouter specifically.** Verify against OpenRouter's own documentation before writing the body. *Mitigation if unavailable:* keep streaming (the roadmap requires live deliberation), let `lastUsage()` return `null`, and degrade per-member cost to run-level accounting off the minted key's spend. Aggregate cost stays bounded by the key's hard limit either way; only per-member granularity degrades. This does not invalidate `lastUsage()` — turn-pairing alone justifies the reshape.
2. **VERIFY-2: does OpenRouter's key-management API return a durable key id/hash at mint time, usable for revocation?** Needed for the quit-path revoke. Verify; do not assume.
3. **VERIFY-3: is `BaseAgentAdapter.id` typed as `AgentKind`?** One grep. If yes, Phase 3d's lift is larger than "one line" and D63 must say so; if no, hybrid E becomes cheap and CR Kimi's dissent is live.
4. **The native chat pane later disagrees with the shape.** Most likely deltas: `send(message: string)` becomes `send(message: ApiMessage)` for multimodal or tool-call content; per-turn params (temperature, max_tokens) want to move onto the send call or into `ApiLaunchSpec`; the pane wants `abortTurn()` without disposing the conversation. *Mitigation:* all three are **additive** — an optional overload, a widened `ApiLaunchSpec`, or a new method. Because the factory is the sole implementation and every consumer lives in main, the change is one file plus N call sites, never a fork. The one shape that would be a genuine rewrite — a non-streaming `send(): Promise<string>` — is exactly what this council refused.
5. **`startApiSession` stays a dead declaration for a phase.** *Mitigation:* the compile-time adoption assertion (build fails on drift), a `@see src/main/services/apiSession.ts` on the declaration, and D63 naming Phase 3d as owner with a stated trigger. Accepted risk, priced.
6. **429 storm: N concurrent members on ONE minted key makes rate-limiting the expected path, not the exceptional one.** *Mitigation:* bounded fan-out concurrency (default 3) and jittered retry/backoff **in the orchestrator, not the factory** — the factory reports `kind: 'rate_limit', retryable: true` and stays policy-free. A member that exhausts retries is recorded in the findings as failed; the run continues.
7. **Deliberate cancel mislabelled as member failure.** *Mitigation:* `dispose()` mid-turn makes the iterable **return**, not throw. This is the sole reason `'aborted'` is absent from `ApiSessionErrorKind` — cancellation is a benign completion, by contract.
8. **A timeout defined as total duration would abort healthy deliberations.** *Mitigation:* TTFB (default 30 s) plus idle (default 45 s), rearmed per chunk; a whole-run cap lives in the orchestrator, never in the transport.
9. **Secrets on disk via the findings file.** *Mitigation:* the handle's stream is scrubbed-by-construction, so the findings writer can only see scrubbed text. Residual: the scrubber matches only *registered* values, so an unregistered secret pasted into a brief passes through — brief-hygiene risk, documented, not engineered away. The pre-commit repo-wide secret grep remains mandatory.
10. **Error bodies reflecting request metadata.** Unverified for OpenRouter. *Mitigation:* every thrown `ApiSessionError.message` passes a one-shot exact-replace over `deps.secrets` first — the sanitize-on-the-way-out discipline `openrouterKeys.ts` already uses.
11. **Orphaned minted key after a hard crash or power loss.** *Mitigation:* the key's hard credit limit is the backstop (bounded, already settled). On `before-quit`, call `event.preventDefault()` once, run a bounded (≤2 s) dispose-and-revoke, then `app.exit()`. Deliberately **no** persistence of key ids in 3b: that would cost a v11 migration and breach constraint 7. If orphans are observed, add a sweep table in a later task.
12. **Scrub carry flushed at turn end may emit a partial secret prefix.** Identical to existing PTY-exit behaviour; accepted for parity, not re-litigated here.
13. **`flushMs` coalescing makes live deliberation feel chunky.** Accepted for PTY parity; tunable via `deps.flushMs` without touching the interface.

---

## Dissents preserved

**CR Kimi (k3) — hybrid E, the unregistered `ApiAgentAdapter`.** Rejected 2-of-3 because it forces a `getModels` stub and per-run construction of an object the codebase treats as a singleton. **Revisit if** VERIFY-3 shows `BaseAgentAdapter.id` is not `AgentKind` **and** a real 3b/3c consumer for `getModels` appears (e.g. a council-member model picker in Settings). E would then cost roughly fifteen lines and remove the dead declaration outright — a 20%-rubric win the council would otherwise leave on the table.

**CR GLM (5.2) — the scrub seam should be wired by the caller, as `SessionManager.spawn` does, not owned by the transport.** Overruled: two future callers make caller-wiring the "second wiring point" §3.4 was extracted to eliminate. **Revisit if** a legitimate consumer needs *unscrubbed* api text (e.g. byte-exact transcript reconciliation for a cost audit), or if `SessionOutput`'s buffering latency proves unacceptable for live deliberation — in which case expose a second, explicitly-named raw accessor rather than moving the default binding.

**CR GLM (5.2) — `ApiSessionHandle` as declared is already correct; interleaving is documentation plus an optional runtime guard.** Overruled on the usage channel, which is a missing capability rather than an under-documented one. **Revisit if** VERIFY-1 shows streamed usage is unobtainable *and* run-level accounting proves sufficient — `lastUsage()` would then be carrying little weight, though `send`-returns-its-own-stream stands on turn-pairing alone.

**CR Qwen (3-coder) — lift the frozen registry inside Phase 3b.** Rejected 2-of-3, and rejected here as internally contradictory with its own Option D vote and resting on a false dichotomy. **Revisit only if** the native api-mode chat pane is rescheduled to land *before* Phase 3d; the lift then moves to whichever phase ships the first user-facing api pane, still as a single change that widens `agentKindSchema`, `staticRegistry` and the F25 refusal branches together, exactly as D52 specified.

---

## Recorded disagreements — arbiter's commentary

Every item the orchestrator recorded is reproduced below by tag, with a ruling on whether it is well-founded and where it landed in the findings. None is dropped.

**[Structural — Q5] Split on the option-fixation check (AGREE: CR GLM · QUALIFY: CR Kimi).**
Well-founded as a disagreement, resolved against CR Kimi on the merits but not on the reasoning. CR Kimi was right that the option list did not exhaust the space and right to name hybrid E with an explicit, checkable precondition — that is exactly what a Q5 is for, and a bare "none" from two members is weaker analysis even where it reaches the right answer. E fails on the two costs given in the Q5 ruling (the `getModels` stub; per-run construction of a singleton-shaped object), not on being out of scope. Recorded as the first preserved dissent with a live revisit trigger.

**[Critique — R1] CR GLM → hybrid E creates a "shadow discovery pathway".**
Directionally well-founded, imprecisely argued. GLM is right that a registry-shaped object living outside the registry invites a later contributor to register it without doing the `agentKindSchema` / F25 / launch-refusal work, and that is the strongest single objection to E; the findings adopt it as cost (ii). But "violates the architectural invariant of a single discovery mechanism" overstates it: an object nobody can look up is not a discovery mechanism. The decisive cost is the one GLM did not name — E must stub `getModels`, relocating the dishonesty rather than removing it.

**[Critique — R1] CR GLM → `before-quit` is synchronous, so an async revoke may never complete.**
Well-founded in substance, wrong in one detail, and it changed the findings. GLM is right that you cannot await inside the handler and get a guarantee, and right that an unbounded async revoke will not reliably land. The detail: an Electron `before-quit` handler *can* call `event.preventDefault()` and defer the quit, so the correct shape is not "synchronous block or detached process" but preventDefault-once → bounded (≤2 s) revoke → `app.exit()`. That is now risk 11 and action item 13. I decline GLM's detached-background-process suggestion: it would need to carry the key, which puts a credential into a second process for a bounded-cost problem the key's own hard limit already caps. Note that Electron's precise quit-path semantics are an external fact the implementer should confirm against Electron 43's own documentation.

**[Critique — R1] CR GLM → CR Qwen's Q6 contradicts its Q1; its Q3 "correct" ignores the usage channel; its Q5 "none" misses `lastUsage()` as a load-bearing alternative.**
The first two are well-founded and both are adopted: the Q6 contradiction is decisive and stated as such in the Q6 ruling, and the missing usage channel is the basis of the Q3 replacement. The third is a category error — `lastUsage()` is an amendment to the primitive's interface, not an alternative *shape* for the producer, so it belongs to Q3, which is where the council in fact resolved it. Q5 asks about discarded producer shapes; "none" is a defensible answer there even from a member whose Q3 was wrong.

**[Critique — R1] CR GLM → CR Qwen missed the vendor uncertainty about streamed `usage`.**
Well-founded, and jointly with CR Kimi's unprompted note this is the most consequential external-fact flag in the round. Affirming the declared shape as flawless without checking whether the transport can carry the data the settled cost model requires is precisely the guess this brief forbids. Promoted to **VERIFY-1**, the sole gating item, with a documented fallback so it cannot block the commit.

**[Critique — R1] CR Kimi → the 10 s timeout default is borrowed from an unrelated call site; and the send-during-receive guard should be mandatory, not optional.**
Both well-founded; both adopted. Importing `openrouterKeys.ts`'s key-validation budget as a *total* cap into a streaming generation context would abort healthy council rounds — a real bug found before it was written, and the exact class of error the brief's "verify, don't analogise" instruction exists to catch. Timeouts are now semantic (TTFB + idle, rearmed per chunk; risk 8). On the guard: with two call sites already planned, "if I were hardening this" is the wrong register for a one-boolean invariant. The findings go further than CR Kimi asked and make turn discipline structural (`send` returns its own stream) with the boolean as backstop, so the hazard is not merely guarded but largely unrepresentable.

**[Critique — R1] CR Kimi → five gaps in CR GLM's position: (1) the adoption path has no teeth; (2) no lift-timing trigger or owner; (3) a cold iterable would re-issue the POST on a second `receive()`; (4) `dispose()` must not surface as a member failure; (5) the secrets-list wiring is assumed, and each member needs its own scrubber instance.**
All five well-founded; all five adopted, and together they are what elevated Option D from a direction to a reviewable artifact. (1) became the compile-time `_adoptionAssertion` plus the D63 entry — this is the difference between D and a promise, and it is the answer to the brief's own `SupportsStateDetection` objection. (2) became the named Phase 3d owner and revisit trigger. (3) is dissolved by the Q3 replacement: a turn's stream is handed out once by `send`, so a second POST is unrepresentable rather than prohibited by prose. (4) became the contract that `dispose()` mid-turn makes the iterable **return** — and note this is *why* `'aborted'` is deliberately absent from `ApiSessionErrorKind`; the taxonomy is closed against it on purpose (risk 7). (5) became `ApiSessionDeps.secrets` as an explicit field and the "one `SessionOutput` per handle — never share, the Scrubber carries chunk-boundary state" note in the skeleton, with a matching test in action item 10.

**[Critique — R1] CR Kimi → CR Qwen's Q6 is a self-reversal resting on a false dichotomy; and its unqualified Q3 endorsement invites the interleaving bug.**
Well-founded on both counts, and this is the sharpest analysis in the critique round. The dichotomy ("delay forces forking or postponement") is refuted by the very mechanism CR Qwen itself described under Q1, and CR Qwen neither re-confronts the blast radius it had called decisive nor engages D52's rationale. Adopted verbatim into the Q6 ruling.

**[Critique — R1] CR Kimi → six things CR Qwen omitted entirely: (1) any implementable content; (2) error propagation and per-member failure isolation; (3) cancellation and timeout semantics; (4) the turn-pairing contract; (5) Q5 asserted rather than demonstrated; (6) the same scrubber-wiring gap.**
Well-founded. Item (2) deserves emphasis: with N concurrent members on one minted key, 429 is the *expected* path, not an edge case, and a position with no error story cannot be implemented. This is why CR Qwen's vote counts toward the Q1/Q2/Q4 majorities but carries no weight in shaping the interface. Item (5) is fairly stated — "this council session must remain tightly bounded" is a process remark, not an argument. Items (1)–(4) and (6) are all now specified in the producer block above. I note that (6) is a gap CR Kimi charged to both other members and had itself closed, correctly, in its own signature.

**[Critique — R1] CR Qwen → CR GLM under-models turn structure and offers no usage channel.**
Well-founded, and CR Qwen's most substantive contribution. It correctly recognised that tying each `send()` to its own iterable is a type-level fix where GLM offered documentation plus an optional runtime check, and it correctly identified `lastUsage()` as the answer to the usage gap. This is the basis on which I treat Q3 as 3-of-3 on substance despite CR Qwen's cast vote of "correct" — its critique contradicts its own position paper, and the critique is the better analysis.

**[Critique — R1] CR Qwen → CR GLM does not confirm the factory pumps through `ingest()`, and does not raise error propagation as load-bearing.**
Half well-founded. The scrub-wiring point is correct and is precisely the Q4 binding-site question the arbiter resolved against GLM: "the current seam suffices" is an assumption about caller discipline, not a guarantee, and the findings replace it with scrubbed-by-construction. The second half is simply wrong: GLM's unprompted observation *is* the error-propagation proposal — a typed `ApiSessionError` with a `kind` discriminant thrown from iteration — and it is the origin of `ApiSessionErrorKind` in the interface above. CR Qwen appears to have discounted it because GLM labelled it an implementation concern; the label was wrong, the content was right, and CR Qwen should have credited it.

**[Critique — R1] CR Qwen → hybrid E overcomplicates and dilutes focus on D.**
Correct conclusion, weak reasoning, and it contains one error worth correcting for the record. "Dilutes the focus" is not an argument; the arbiter's rejection rests on the `getModels` stub and per-run construction. The error: CR Qwen states "the risk of enum widening still exists unless `id` is decoupled from `AgentKind`, a point not clearly resolved" — CR Kimi resolved it explicitly, by making E conditional on that exact fact and specifying a one-grep check. That check is preserved as **VERIFY-3** because it also determines whether Phase 3d's delegation is genuinely one line.

**[Critique — R1] CR Qwen → `lastUsage()` nullability and failure behaviour are unspecified.**
Well-founded and adopted verbatim into the interface: null before any turn completes, null if the turn failed, and null when the provider does not report usage for a streamed response (with a pointer to VERIFY-1). CR Qwen is also right that CR Kimi raised the vendor uncertainty in an unprompted note rather than in Q3, where the interface was being frozen. Small, precise, and it made the contract implementable — the strongest single line in CR Qwen's round.

---

## Action items for implementation

1. **Verify VERIFY-1** against OpenRouter's own documentation: the request flag that makes a *streamed* chat-completion report `usage`, and the shape and position of the terminal chunk carrying it. Record the answer in D63. If unavailable, take the documented fallback (`lastUsage()` → `null`, run-level accounting) and note it in the findings — do not drop streaming.
2. **Verify VERIFY-2**: the durable key id/hash returned at mint time and the revoke call that consumes it.
3. **Grep VERIFY-3**: `BaseAgentAdapter`'s `id` field type. Record in D63 whether Phase 3d's delegation is genuinely one line.
4. **Amend `src/main/adapters/types.ts`** with `ApiUsage`, `ApiSessionErrorKind`, `ApiSessionError` and the replacement `ApiSessionHandle`, verbatim as above. Delete `receive()`. Add `@see src/main/services/apiSession.ts` on `ApiAgentAdapter.startApiSession`. Confirm zero call sites break (there are none today).
5. **Create `src/main/services/apiSession.ts`** with `createApiSession`, `bindApiSession` and `_adoptionAssertion`. Confirm the build fails if `ApiSessionHandle` or `startApiSession` is edited without updating the factory — that failure *is* the deliverable, so demonstrate it once locally.
6. **Bind the scrub seam inside the factory**: one `createSessionOutput` per handle, `deps.secrets` populated with the minted run key (and the provisioning credential if distinct), `onText` feeding the turn's iterable, `flush()` at turn end and on dispose. Assert by test that no code path yields text bypassing `ingest()`.
7. **Test turn discipline**: `send` during an open turn rejects; a turn's iterable can be iterated exactly once; end-of-iterable is reached exactly once per `send`.
8. **Test error mapping**: 401 → `auth`/not-retryable, 429 → `rate_limit`/retryable, 500 → `provider`/retryable, fetch rejection → `network`, stalled TTFB → `timeout`, malformed SSE → `protocol`/not-retryable. All with an injected `fetchImpl`; zero network access in the suite.
9. **Test dispose mid-stream**: the iterable returns, never throws, and `dispose()` is idempotent.
10. **Test secret redaction across chunk boundaries**: a registered key split across two SSE deltas must not appear in yielded text, and a thrown `ApiSessionError.message` containing the key must be redacted.
11. **Build `CouncilRun`/`CouncilService`** owning `Map<memberLabel, ApiSessionHandle>`; bounded fan-out concurrency (default 3); per-member retry/backoff for `retryable` errors; per-member failure recorded in findings without aborting the run.
12. **Name member handles `council:<runId>:<memberLabel>`** and add the doc comment that `ApiSessionHandle.sessionId` is a correlation label, not a `sessions` row id.
13. **Wire `before-quit`**: `preventDefault()` once, bounded ≤2 s dispose-all plus revoke-run-key, then `app.exit()`. Confirm the quit-path semantics against Electron 43's documentation before relying on them.
14. **Prove the negative diff**: the landing commit touches zero lines of `agentKindSchema`, `registry.ts`, the F25 projection filter, `sessionManager.ts` and the migrations file. State this in the commit message so a reviewer can check it by inspection.
15. **Run the repo-wide secret-grep gate** before commit (mandatory for this phase), including over any test fixtures added.
16. **File D63** with: the Option D ruling; the accepted dead declarations (`startApiSession`, `getModels`) and their build-enforced link; the Q3 interface replacement and its rationale; the Q4 factory-bound scrub ruling; the explicit statement that D34 Q5's frozen-registry lift **remains owned by Phase 3d per D52**; and the three VERIFY outcomes.
17. **Adopt CR Qwen's documentation note**: add a short threat-model paragraph to `sessionOutput.ts`'s header stating the api-mode case (content echo from briefs → findings on disk), so the reasoning survives contributor turnover.

---

## How disagreement was detected

- **Q1** — detection: `structural` · members agreed · no verdict token from: CR Qwen (3-coder)
- **Q2** — detection: `structural` · members agreed · no verdict token from: CR Qwen (3-coder)
- **Q3** — detection: `structural` · members agreed · no verdict token from: CR Qwen (3-coder)
- **Q4** — detection: `structural` · members agreed · no verdict token from: CR Qwen (3-coder)
- **Q5** — detection: `structural` · members disagreed · no verdict token from: CR Qwen (3-coder)
- **Q6** — detection: `model-judged` · not measured · no verdict token from: CR GLM (5.2), CR Qwen (3-coder)

_`structural` means the orchestrator compared the members' own verdict tokens and counted the difference. `model-judged` means too few members answered in the required form, so the arbiter judged it from prose — a weaker signal, labelled rather than hidden._

### Dissents preserved — the orchestrator's record

_The synthesis above opened its own `## Dissents preserved`. This is the orchestrator's, generated from the transcript and appended whatever the arbiter chose to write — the same guarantee, rendered one level down so the document has one heading by that name instead of two (F40)._

_13 preserved: 1 structural (computed from the members' own verdict tokens) · 12 from critique prose, from 3 members — CR GLM (5.2) 4 · CR Kimi (k3) 4 · CR Qwen (3-coder) 4._

_⚠ Read the per-member split before reading breadth into the total: six objections from one member is one member disagreeing six times, not six members disagreeing. Nothing is dropped to make the total smaller._

- [Structural — Q5] Q5: option-fixation check — load-bearing alternatives only. — AGREE: CR GLM (5.2) · QUALIFY: CR Kimi (k3)
- [Critique — R1] CR GLM (5.2): I disagree with the viability of Hybrid E (Q5) as a workaround. Even if `BaseAgentAdapter.id` is not typed as `AgentKind`, instantiating an adapter outside the `staticRegistry` creates a shadow pathway that violates the architectural invariant of a single discovery mechanism. It would invite drift and defeat the very containment that makes Option D appealing. Option D stands on its own without E.
- [Critique — R1] CR GLM (5.2): The unprompted observation about `before-quit` disposing of live `CouncilRun`s and revoking the run-minted key overlooks the synchronous nature of Electron's `before-quit` event. If key revocation requires an async network call, the app may terminate before the request completes, leaving the unmetered key alive. A synchronous block or a detached background process is required to guarantee revocation. ### POSITION B
- [Critique — R1] CR GLM (5.2): B's answer to Q6 directly contradicts their answer to Q1. Option D is chosen specifically to avoid touching the static registry or `agentKindSchema` and to contain the blast radius. Lifting the frozen registry in Phase 3b (as B argues for) nullifies the entire premise of Option D and violates constraint 7 (bounded, single reviewable commit). Furthermore, B's answer to Q3 ("CORRECT") ignores the structural flaw in the declared interface's inability to return token usage, and B's Q5 ("NONE") misses that adding `lastUsage()` is a load-bearing alternative.
- [Critique — R1] CR GLM (5.2): B entirely missed the vendor uncertainty regarding whether OpenRouter's streaming chat-completions can actually return usage blocks. This is a gating technical verification item, as A correctly noted. Proceeding under the assumption that the declared shape is flawless without verifying the transport capabilities risks breaking either the streaming or cost-tracking requirements.
- [Critique — R1] CR Kimi (k3): The timeout default. Borrowing `10_000` from `openrouterKeys.ts` imports a key-validation budget into a streaming-generation context; a council member's complete response routinely exceeds ten seconds of stream time, so unless `timeoutMs` is explicitly defined as connect/time-to-first-byte or idle (not total), the stated default will abort healthy deliberations. The default should be chosen by semantics, not by analogy to an unrelated call site. Second, narrower: the send-during-receive guard is framed as optional hardening ("if I were hardening this") — with a second call site already planned, that guard belongs in the first implementation; it costs one boolean.
- [Critique — R1] CR Kimi (k3): (1) The "committed adoption path" has no teeth — no decision-record amendment, tracking issue, or conformance test asserting that `ApiAgentAdapter.startApiSession` delegates to `createApiSession`; without one, D's principal failure mode (the factory drifts council-only and 3d builds a second transport) is unmitigated. (2) A does not address the lift-timing question B engages as Q6; the adoption path needs a stated trigger and owner. (3) Receive-once-per-send: on the cold-iterable reading, a second `receive()` call after one `send()` would re-issue the POST — the contract should prohibit this alongside the consume-to-completion rule. (4) `dispose()` interacts with the proposed error taxonomy: a deliberate abort must surface as benign termination, not an `ApiSessionError` the orchestrator records as member failure — the `kind` discriminant needs `'aborted'` or a non-error completion path. (5) The claim that the injected key "IS in the secrets list" assumes wiring not yet specified: the resolved credential must be explicitly registered with the `createSessionOutput` instance, and each member stream needs its own scrubber instance so chunk-boundary state isn't corrupted by interleaved streams. ## Position B
- [Critique — R1] CR Kimi (k3): Q6, firmly. B concludes the registry lift "should occur in Phase 3b alongside initial implementation, not wait" — which reverses its own Q1 without acknowledging it. The justification is a false dichotomy: "delaying the lift until Phase 3d forces either forking logic or postponing Phase 3b indefinitely." Option D exists precisely to refute that fork — the factory ships in 3b and the 3d lift converts `startApiSession` into a one-line delegation, the very mechanism B described in its own Q1. There is no fork and no postponement. If B truly means the lift itself should move to 3b, it must re-confront the `agentKindSchema`/F25/launch-dialog/restore blast radius it cited as decisive, and must argue against D52's rationale for deferring the lift; it does neither. If B instead means only "design the convergence path now," that is already entailed by Option D and requires no YES. I also disagree with the unqualified Q3 endorsement ("the declared shape stands... unless specific non-streaming behavior proves necessary"): the signature is right, but the contract is under-specified, and affirming the shape without stating the one-in-flight-receive rule invites exactly the interleaving bug A identified.
- [Critique — R1] CR Kimi (k3): (1) Any implementable content for its own Q1: no signature, no ownership boundaries (who owns the `AbortController`, who wires the scrub seam), no dependency-injection or testability story — B's D is a direction, not a reviewable artifact. (2) Error propagation entirely: nothing on how 401/429/5xx/network failures surface through `receive()`, and nothing on per-member failure isolation in the orchestrator. This is first-order, not a nicety — N concurrent members on one OpenRouter key make 429 the *expected* failure mode, and neither retry/backoff placement nor fail-and-record is addressed. (3) Cancellation and timeout semantics: no mention of `dispose`, abort, or any timeout at all. (4) The Q3 interleaving hazard and the cold-iterable, consume-to-completion contract (A's analysis covers this; B's has nothing). (5) Q5 is asserted rather than demonstrated — "alternatives surely exist, none carry sufficient weight" never tests the space (e.g., the factory-inside-`SessionManager` hybrid A considered and rejected), and "this council session must remain tightly bounded" is a process statement, not analysis. (6) The same scrubber-wiring gap as A: explicit registration of the resolved credential and per-member scrubber instances.
- [Critique — R1] CR Qwen (3-coder): Position A underestimates the importance of modeling turn structure and usage data in the core API session handle interface. While it acknowledges that interleaving `send()` calls could be problematic, it fails to propose a strong type-level or runtime solution (e.g., tying each `send()` to its own iterable), which Position B properly addresses by returning the iterable directly from `send()` and enforcing turn-based semantics. Also, Position A’s async iterable design leaves the usage-channel problem unaddressed, while Position B explicitly solves it with `lastUsage()`.
- [Critique — R1] CR Qwen (3-coder): Position A does not address how the factory integrates with the scrubbing seam proactively — instead suggesting that the current seam suffices, without confirming that the internal streaming logic pumps through `ingest()` as Position B does. Position A also does not raise error propagation shape as a load-bearing concern, which is a notable omission given the risk of partial responses or transport failures confusing the orchestrator.
- [Critique — R1] CR Qwen (3-coder): Position B overcomplicates the case by introducing hybrid Option E (unregistered adapter) as a serious contender. While structurally possible, this introduces unnecessary indirection without clear benefit beyond temporary type honesty — the same benefit is better achieved by leaving the adapter unimplemented and letting the factory stand alone. Inclusion of E dilutes the focus on the simpler, production-ready path (D), especially since the risk of enum widening still exists unless `id` is decoupled from `AgentKind`, a point not clearly resolved.
- [Critique — R1] CR Qwen (3-coder): Position B does not clearly distinguish whether `lastUsage()` must always return a value, or how it behaves when usage data is unavailable from the provider (e.g., during streaming). A clarification on nullability and behavior under partial or failed responses would improve confidence. While it acknowledges this uncertainty with OpenRouter in an unprompted note, it should have been addressed in Q3 explicitly.

## Provenance

- **Run id:** `c06874ad-7c89-4548-8f46-1314658b874d`
- **Started:** 2026-07-28T16:02:46.445Z

| Member | Role | Model | Turns |
|---|---|---|---|
| CR GLM (5.2) | member | `z-ai/glm-5.2` | answered 2 turns |
| CR Kimi (k3) | member | `moonshotai/kimi-k3` | answered 2 turns |
| CR Qwen (3-coder) | member | `qwen/qwen3-coder` | answered 2 turns |
| CR Arbiter (opus-5) | arbiter | `anthropic/claude-opus-5` | answered 2 turns |

