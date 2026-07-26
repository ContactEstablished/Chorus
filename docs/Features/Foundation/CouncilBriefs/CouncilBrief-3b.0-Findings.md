# Council Findings — CR-3b.0: Who Produces an `ApiSessionHandle`?

_Arbitrated 2026-07-26 · Decision owner: Matthew Wilson · Recorder: Kilo (automated council session)_

---

## 1. Council Configuration

| Role | Model | Provider |
|------|-------|----------|
| Reviewer #1 | Kimi K2.7 Code | Moonshot AI |
| Reviewer #2 | GLM 5.2 | Z-AI |
| Reviewer #3 | Qwen 3.7 Max | Qwen |
| Arbiter | GPT 5.5 | OpenAI |

**Provider routing:** throughput-priority

---

## 2. Synthesized Verdict

| Field | Value |
|-------|-------|
| **Verdict** | **PASS** |
| **Confidence** | **8 / 10** |
| **Top Priority** | None (no blocking issues) |
| **Reviewer consensus** | Kimi ✓, GLM ✓, Qwen ✓ — unanimous pass |

---

## 3. Issues Found (Severity-Ranked)

### Issue #1 — [MEDIUM] `ApiSessionHandle` cancellation semantics unsettled

**Flagged by:** Kimi, GLM

**Description:** The brief's declared `ApiSessionHandle` has `send()` / `receive(): AsyncIterable<string>` / `dispose()` but no per-operation cancellation. Kimi argues an optional `AbortSignal` parameter on `send` or `receive` should be added now while the interface has zero implementations. GLM argues `dispose()` alone is sufficient for session-level teardown and that per-request cancellation can be added later. For a future interactive chat pane, the ability to cancel a mid-generation without destroying the entire session context may be material.

**Recommended fix:** Decide now — either add `AbortSignal` parameters or explicitly document in the interface contract that cancellation is session-level only via `dispose()`. Do not leave it implicit.

**Council ruling:** The arbiter (GPT 5.5) leans toward keeping `dispose()` as the sole cancellation mechanism for Phase 3b, with an explicit docstring stating per-operation cancellation is deferred to a later phase if the interactive chat pane requires it. Rationale: the council round and chat pane share the same primitive; adding `AbortSignal` now would force every consumer to thread signals even when not needed; `dispose()` with an `AbortController` internally is the natural implementation and any consumer can wrap with its own `AbortSignal.timeout()` externally.

---

### Issue #2 — [MEDIUM] Scrubbing rationale may overclaim coverage for brief-quoted secrets

**Flagged by:** Kimi, GLM

**Description:** The brief argues that API-mode text should route through `sessionOutput`'s scrubber (§3.4, constraint 6.2). The scrubber exact-matches registered secret values (API keys injected as environment variables). However, the council members read a brief `.md` that may itself quote secrets (e.g., a `credential:` field, a sample API key in documentation). Those secrets are **not** the API key used in the `Authorization` header — they are arbitrary strings in a markdown document. The scrubber would not detect them unless they are explicitly registered. This creates a gap between the claimed coverage ("all api text is scrubbed") and the actual detection mechanism ("exact-match only for registered values").

**Recommended fix:** Define explicitly what secrets are registered for council output scrubbing before the findings are written to disk. At minimum, register the minted OpenRouter key used for the council run. If brief contents may contain secrets, either (a) scan the brief for known patterns and register candidates, or (b) document the limitation: the scrubber protects against credential echo, not against brief-quoted content.

**Council ruling:** Route API text through `sessionOutput.ts` — the scrub seam exists and costs nothing to use. Register at minimum the minted council-run API key. Document that the scrubber protects against **injected credential echo only**, not against content the model was given in its prompt. If the brief itself contains secrets, that is a pre-brief sanitization concern, not a runtime scrub concern.

---

### Issue #3 — [LOW] Future `ApiAgentAdapter.startApiSession` risk of staleness

**Flagged by:** Kimi, GLM

**Description:** The brief's Option D proposes a standalone factory (`createApiSession`) that `ApiAgentAdapter.startApiSession` will one day delegate to. But the project's own history (D34's struck `SupportsStateDetection`) shows that declared-but-unimplemented interface methods decay over time. If Phase 3d changes direction, the delegation path may never materialize, leaving `startApiSession` as dead code indefinitely.

**Recommended fix:** Add a clear comment on `ApiAgentAdapter.startApiSession` linking it to `createApiSession` as the intended implementation, with a reference to the Phase 3d registry-lift decision. Optionally, add a compile-time assertion test that would fail if the two signatures diverge.

**Council ruling:** Accept the risk with the comment-and-test mitigation. The cost of doing nothing is a future dead method; the cost of moving the registry lift into Phase 3b is higher (blast radius on wire enum, F25 filter, restore contract). A comment plus a type-level assertion test in the adapter types file is sufficient.

---

## 4. Per-Reviewer Position Summary

### Kimi (K2.7 Code) — PASS

**Q1:** Lean D (standalone factory with adoption path). Prefers `src/main/services/apiSession.ts` exporting `createApiSession(spec: ApiLaunchSpec, deps: { fetchImpl, signal? }): Promise<ApiSessionHandle>`. Argues that the factory is the implementation and the future adapter method is a thin wrapper, satisfying both A's safety and B's convergence. Strongest counterargument: speculative shaping ages badly (the `SupportsStateDetection` precedent).

**Q2:** OUT — council members stay outside `SessionManager`. A `CouncilRun` owns its handles. Restore engine is never invoked because there is no `sessions` row to reconcile.

**Q3:** Correct but under-specified. `send` + `receive()` works for both batch and interactive. Suggests adding optional `AbortSignal` to `send()` so the interactive chat pane can cancel mid-generation without destroying session context.

**Q4:** SCRUB — register the minted API key. Document that the scrubber protects against credential echo, not brief-quoted content. The seam exists; using it costs nothing.

**Q5:** No alternative beyond A–D. Recommends discarding C explicitly as contradicting D45(2).

**Registry lift position:** Does NOT require moving the registry lift to Phase 3b — Option D avoids it.

---

### GLM (5.2) — PASS

**Q1:** D (standalone factory with adoption path). Same module and signature as Kimi. Argues the "two producers" objection dissolves because the factory is the canonical producer and the adapter becomes a delegator. Strongest counterargument: the registry lift happening later could discover that `ApiAgentAdapter` needs more than a one-line delegation, at which point the factory signature may be wrong.

**Q2:** OUT — keep council members entirely outside `SessionManager`. Council is transient; `SessionManager` is PTY-shaped; forcing a council member into it requires either a premature session-type split or a fragile conditional. The `CouncilRun` orchestration class owns the handles.

**Q3:** Correct as declared. `AsyncIterable<string>` is the right streaming primitive for both use cases. The council round streams deliberation live (so streaming is needed, not just a `Promise<string>`), and the chat pane streams token-by-token. `dispose()` is sufficient cancellation; per-request `AbortSignal` is premature.

**Q4:** SCRUB — threat model: credential echo. The scrubber exact-matches registered secrets (the API key). The model never sees the key, but defense-in-depth is warranted because a future model or proxy could theoretically reflect headers. Brief-quoted secrets are a separate pre-processing concern.

**Q5:** None. A–D are exhaustive.

**Registry lift position:** Does NOT require moving the registry lift. Option D defers it cleanly.

---

### Qwen (3.7 Max) — PASS

**Q1:** D (standalone factory with adoption path). Argues D is the only option that satisfies all rubric dimensions: it does not diverge the api mechanism (native chat pane reuses the same factory), it contains blast radius (no wire enum change), it is type-honest (the factory exists, the adapter declaration remains dormant but documented), and it lands in one session. Strongest counterargument: the factory may need to accept different deps than the adapter call site provides, creating an impedance mismatch later.

**Q2:** OUT — `CouncilService` manages council member lifecycle directly. No `SessionManager` involvement. Restore consequence: if the app crashes mid-council-run, the run is lost. That is acceptable because council is user-initiated, transient, and bounded by one minted key per run. Restarting a council run unattended would violate constraint 6.5.

**Q3:** Correct. `send` + `receive(): AsyncIterable<string>` is the right primitive. The council streams deliberation live, which requires streaming. An interactive chat also requires streaming. No change needed.

**Q4:** SCRUB — the seam is already unified and costs nothing to use. Register the minted API key. Threat model: accidental credential emission by a downstream provider or proxy that reflects headers. Accept that brief-quoted secrets are not covered by this mechanism.

**Q5:** None.

**Registry lift position:** Does NOT require moving the registry lift.

---

## 5. Council Synthesis (Arbitrated by GPT 5.5)

### Q1: Who constructs `ApiSessionHandle`, and where?

**Ruling: Option D** — standalone factory with committed adoption path (unanimous 3-of-3).

All three reviewers independently converged on Option D. The factory lives at `src/main/services/apiSession.ts` and exports `createApiSession()`. The existing `ApiAgentAdapter.startApiSession` declaration remains dormant until Phase 3d lifts the registry, at which point it becomes a one-line delegation to the factory. This satisfies:

- **Non-divergence (rubric #1):** the native chat pane reuses the exact same factory. The adapter adds a registry key; the mechanism underneath is identical.
- **Blast radius (rubric #2):** zero changes to `agentKindSchema`, the static registry, the F25 filter, or the restore contract. Phase 3d retains ownership of the registry lift per D52.
- **Type-level honesty (rubric #3):** the factory is real and `startApiSession` is documented as deferred, not dead. A compile-time assertion test ties them together.

Option C was explicitly discarded by all reviewers as contradicting D45(2). Option B was rejected because it forces a wire-enum widening into the same session as the first-ever API transport. Option A was rejected because leaving `startApiSession` as dead code without a documented adoption path violates type-level honesty.

### Q2: Does a council member enter `SessionManager`?

**Ruling: OUT** (unanimous 3-of-3).

Keep council members entirely outside `SessionManager`. `CouncilService` (or `CouncilRun`) owns the handles directly. Restore consequence: a crashed council run is lost — it never persists a row and never triggers the boot restore engine. This is correct per constraint 6.5: no credential is resolved for inference without a user gesture. A council member is transient, has no cwd, no worktree, and no restart semantics.

### Q3: Is `ApiSessionHandle` correct as declared?

**Ruling: CORRECT** (2-of-3; Kimi suggests optional `AbortSignal` parameter).

The declared interface — `send(message: string): Promise<void>` / `receive(): AsyncIterable<string>` / `dispose(): Promise<void>` — is correct for both the blind-round council and the future interactive chat. The council streams deliberation live (so `AsyncIterable<string>` is needed, not `Promise<string>`). The chat pane streams token-by-token.

Kimi's suggestion to add optional `AbortSignal` to `send()` is noted in the dissents section. The arbiter rules that `dispose()` is sufficient cancellation for Phase 3b. An implementation detail: `createApiSession` should use an `AbortController` internally, and `dispose()` calls `controller.abort()` before tearing down the underlying HTTP connection.

### Q4: Does API-mode text route through the scrub seam?

**Ruling: SCRUB** (unanimous 3-of-3).

Route API text through `createSessionOutput().ingest()` driven from `for await (const chunk of handle.receive())`. The threat model is **credential echo**: a downstream provider, proxy, or future model behavior could reflect the `Authorization` header value. Defense-in-depth through the existing scrub seam costs nothing and protects against this class of error.

At minimum, register the minted council-run API key. Document that the scrubber protects against injected credential echo only — not against brief-quoted secrets, which require separate pre-processing.

### Q5: Option-fixation check

**Ruling: NONE** (unanimous 3-of-3).

Options A–D are exhaustive. No reviewer proposed an alternative shape.

---

## 6. The Producer — Verbatim TypeScript

```typescript
// src/main/services/apiSession.ts

import type { ApiLaunchSpec, ApiSessionHandle } from '../adapters/types.js'
import type { Scrubber } from './sessionOutput.js'

export interface ApiSessionDeps {
  readonly fetchImpl: typeof fetch
  readonly scrubber: Pick<Scrubber, 'push' | 'flush' | 'pendingLength'>
  readonly baseUrl?: string
  readonly signal?: AbortSignal
}

export function createApiSession(
  spec: ApiLaunchSpec,
  deps: ApiSessionDeps
): ApiSessionHandle {
  // Implementation:
  // 1. Build OpenAI-compatible chat-completions POST to deps.baseUrl
  //    (default https://openrouter.ai/api/v1/chat/completions)
  // 2. Authorization header = `Bearer ${spec.credential.key}`
  // 3. Body: { model: spec.modelId, messages: [...], stream: true }
  // 4. Use deps.fetchImpl for testability
  // 5. Abort via deps.signal if provided
  // 6. receive() yields SSE-decoded content deltas
  // 7. dispose() aborts the underlying request and cleans up
  //
  // Signature is deliberately shaped as (ApiLaunchSpec, deps) =>
  // ApiSessionHandle so that a future ApiAgentAdapter.startApiSession
  // is a one-line delegation: return createApiSession(spec, deps)
  throw new Error('Not implemented — this is the council-approved signature')
}
```

Module path: `src/main/services/apiSession.ts`
Exported: `createApiSession(spec, deps)` returning `ApiSessionHandle`

---

## 7. What Phase 3b Implements vs Declares

**Phase 3b implements:**
- `src/main/services/apiSession.ts` — `createApiSession()` factory (Option D)
- `src/main/services/councilService.ts` — orchestrates 3–5 API council members + arbiter
- Council view/route in the renderer (Settings-view precedent, not a layout pane)
- Wiring: council members call `createApiSession()` directly, NOT through the adapter registry
- Output scrubbing: each council member's text routes through `sessionOutput.ts`
- Credential resolution reuses existing `resolveCredential()`

**Phase 3b does NOT implement:**
- `ApiAgentAdapter.startApiSession` — remains declared but unwired
- Widening `agentKindSchema` — stays `'claude' | 'codex'`
- Modifying `staticRegistry` — stays frozen per D34 Q5 / D52
- Adding any council-related rows to `sessions` table
- Modifying `SessionManager` — council members are outside it entirely
- Any layout migration — council is a view/route, not a pane

---

## 8. Risks & Mitigations for the Winner (Option D)

1. **Risk: `ApiAgentAdapter.startApiSession` becomes permanently dead code.**
   Mitigation: Add a compile-time assertion test that verifies `createApiSession`'s signature is compatible with `ApiAgentAdapter.startApiSession`. Add a `@deferred` JSDoc tag linking to Phase 3d. If Phase 3d never lifts the registry, the declaration is removed in a cleanup sweep.

2. **Risk: The factory signature `(ApiLaunchSpec, ApiSessionDeps)` may not match what the adapter call site provides.**
   Mitigation: `ApiSessionDeps` uses `Pick` types (`Pick<Scrubber, 'push' | 'flush' | 'pendingLength'>`) rather than concrete classes. The adapter call site provides these deps from `SessionManager` at registry-lift time. If the shape doesn't fit, the type error is caught at compile time.

3. **Risk: The native chat pane requires a richer handle than `send` / `receive()` / `dispose()`.**
   Mitigation: The chat pane is a future consumer. If it needs `AbortSignal` on `send()`, that can be added to `ApiSessionHandle` before the chat pane is built — the interface has only one implementation and that implementation lives in `apiSession.ts`. No downstream breakage.

4. **Risk: Two consumers (`CouncilService` and future chat pane) diverge in how they call the factory.**
   Mitigation: The factory is the single source of truth. Both consumers import `createApiSession`. Divergence is prevented by the module boundary — there is no alternative path to an `ApiSessionHandle`.

5. **Risk: Brief-quoted secrets pass through the scrubber undetected.**
   Mitigation: Document that the scrubber protects against credential echo only. Add a pre-processing step in `CouncilService` that scans the brief for known secret patterns before passing it to council members. This is a separate concern from `sessionOutput.ts`.

6. **Risk: The `signal` dep on `ApiSessionDeps` is not sufficient for the interactive chat pane's per-request cancellation.**
   Mitigation: The current `signal` is session-level (passed at construction). If per-request cancellation is needed later, add an optional `signal?` parameter to `send()`. The factory implementation can merge the session-level signal with the per-request signal internally. This is additive and backward-compatible.

---

## 9. Dissents Preserved

**Kimi (K2.7 Code):** `ApiSessionHandle` should include an optional `AbortSignal` on `send()` now, not later.
- **Why revisit:** If the interactive chat pane is built and developers discover that `dispose()`-only cancellation makes "stop generating but keep context" impossible, then `send()` needs an `AbortSignal` parameter. By that point, the interface has implementations and the change is breaking. Revisit if the chat pane design begins before Phase 3d.

---

## 10. Action Items for Implementation

- [ ] Create `src/main/services/apiSession.ts` with `createApiSession(spec: ApiLaunchSpec, deps: ApiSessionDeps): ApiSessionHandle`
- [ ] Implement the factory body: POST to OpenRouter chat-completions, SSE stream decoding, `receive()` yields deltas, `dispose()` aborts
- [ ] Inject `fetchImpl` for testability (follow `openrouterKeys.ts` precedent)
- [ ] Implement `sessionOutput` scrubbing: each council member's `receive()` output drills through `createSessionOutput().ingest()`
- [ ] Register the minted council-run API key in the scrubber's secrets list
- [ ] Add a compile-time type assertion test linking `createApiSession` to `ApiAgentAdapter.startApiSession` signature compatibility
- [ ] Add `@deferred Phase 3d` JSDoc on `ApiAgentAdapter.startApiSession` with link to this council's findings
- [ ] Implement `CouncilService` in `src/main/services/councilService.ts` — orchestrates N members + arbiter, drives factory, streams to view
- [ ] Build council view/route in renderer (Settings-view precedent)
- [ ] Wire council IPC channel from `CouncilService` to renderer view
- [ ] Document scrubber limitation: protects against credential echo, not brief-quoted content
- [ ] Add pre-processing step to scan brief for known secret patterns before council deliberation
- [ ] Verify constraint 6.4: no API keys in argv, disk, or log lines (repo-wide secret-grep gate)
- [ ] Verify constraint 6.5: boot restore engine never resurrects a council member (no `sessions` row = no restore)

---

## 11. Arbiter Commentary (GPT 5.5)

The brief CR-3b.0 is well-constructed: it presents a genuine architectural tension with binding prior rulings, precise code-state verification, and an explicit evaluation rubric. The council converged quickly and unanimously because the options are well-framed and the constraints are tight.

Option D wins by construction: it satisfies every rubric dimension without requiring any reviewer to argue against their own rubric weighting. The "strongest counterargument" exercise was productive — both the staleness risk (D34 precedent) and the signature mismatch risk are real — but the mitigations (type assertion test, `Pick` deps, `@deferred` tag) are sufficient for Phase 3b.

The only meaningful divergence between reviewers was on `AbortSignal` semantics (Q3), and the arbiter rules with GLM + Qwen that `dispose()` is sufficient for Phase 3b. Kimi's concern is preserved as a dissent that should be revisited when the interactive chat pane design begins.

The scrubber question (Q4) produced a nuanced answer: route through `sessionOutput`, but do not overclaim coverage. The threat model is specifically credential echo, not brief-quoted content. This is the correct scope for a runtime output scrubber.