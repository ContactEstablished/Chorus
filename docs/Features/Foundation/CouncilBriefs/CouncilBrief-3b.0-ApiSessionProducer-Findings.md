> ⚠ **PARTIAL RUN — 2 of 3 members completed.**
>
> - CR Kimi (k3) refused at **positions** (round 0): The response exceeded its size limit and was stopped.
>
> These findings are the output of a council that did not fully convene. Read them as such.

> ⚠ **These findings are model deliberation, not verified fact.** Every claim below was produced by language models reading the brief. Nothing here was compiled, executed or tested, and no model in this council could see the repository. This project’s own CR-3b.0 was unanimous, its rulings were sound, and the code it shipped had four compile errors. Verify anything you are about to rely on.

# Council Brief CR-3b.0 — Findings

_Filed 2026-07-26 · Arbiter ruling · Decision owner: Matthew Wilson · Code state verified at `341ea5c`_

**Council composition:** 2 independent members (CR GLM 5.2 — whose submission contains a nested `claude-opus-4` voice; treated as **one** member for vote-breadth purposes — and CR Qwen 3-coder) plus arbiter. Treat unanimity below as **2-of-2 members + arbiter**, not 3 independent reads.

---

## Per-model positions

**CR GLM (5.2):** Q1 D / Q2 out / Q3 correct-with-doc-comment (QUALIFY) / Q4 scrub / Q5 none
— Argues D dissolves the "two producers" objection because the factory *is* the implementation and a future `ApiAgentAdapter.startApiSession` is a one-line delegation; supplies paste-ready code; explicitly flags the OpenRouter SSE envelope, the `ResolvedCredential` key field, attribution headers and the `usage` block as unverified. Rules the member out of `SessionManager` on the restore invariant; scrubs on the brief→findings exfiltration path; volunteers the member-concurrency question as an unprompted observation.
— Strongest counterargument to own choice (as stated): the `deps`/`signal` signature mismatch between factory and declared adapter method means D's "one-line delegation" is a prediction that may not hold.

**CR Qwen (3-coder):** Q1 D / Q2 out / Q3 QUALIFY *with a batch-mode caveat* (`receive()` should yield exactly one complete response for a blind round) / Q4 scrub / Q5 none
— Same structural reasoning, more compressed; adds the sharpest single point in the council: D is **conformance to an already-declared shape, not speculation**, which is what separates it from the struck `SupportsStateDetection`. Grounds Q4 in brief-leakage rather than key-echo. Observes that "session" is now overloaded across PTY sessions and transient inference tasks.
— Strongest counterargument to own choice: leaving `ApiAgentAdapter` declared-but-unactionable is deferred debt, not discharged debt.

**Arbiter:** Q1 **D, as amended** (factory outside the registry, provider-parameterised, dependency-injected) / Q2 **out, with a persisted non-restorable run record** / Q3 **REPLACE** (verbatim below) / Q4 **scrub, bidirectionally** / Q5 **named: a provider registry disjoint from `AgentKind`** — identified, deliberately deferred
— The members got the structural question right and the interface question wrong. Their Q3 answer is internally contradictory: both accept that per-member `usage` is a **settled requirement of this phase** (bounded spend, hard limit, per-member cost granularity), and both then keep an interface that structurally cannot carry `usage` — `receive(): AsyncIterable<string>` discards every field that is not a text delta. That is the "declared-but-dishonest type" the rubric penalises, arriving in the one session where fixing it is a diff in a file with zero implementations.
— Strongest counterargument to my own choice: I am editing a declared interface on the strength of one phase's requirements, which is exactly the failure mode of `SupportsStateDetection`. Mitigation: the replacement is **smaller in surface** than what it replaces (two methods, not three), is forced by two present-tense facts (settled cost accounting; multi-round deliberation) rather than a forecast, and lands in the same commit as its only implementation — so it is never a declaration without a body.

---

## Council synthesis

### Q1: Option D — standalone factory in `src/main/services/apiSession.ts`, outside the agent registry, shaped so a future `ApiAgentAdapter.startApiSession` is a one-line delegation (**unanimous, 2-of-2 members + arbiter, with arbiter amendments**)

D wins on the rubric as weighted, not as a compromise. It scores maximally on **blast radius (25%)**: `agentKindSchema` untouched, `staticRegistry` untouched, the F25 projection filter untouched, `sessions`/`launch_profiles`/`dispatches` untouched, `SessionManager` untouched, no layout migration. It scores maximally on **non-divergence (30%)** *provided* the factory is the only producer and the endpoint is a parameter rather than a literal — hence the first amendment: GLM's draft hardcodes `openrouter.ai/api/v1/chat/completions`, and a native chat pane pointed at any other OpenAI-compatible base would then need a second producer, failing the exact constraint D exists to satisfy. `baseUrl` moves onto `ApiLaunchSpec`; provider attribution headers move into injected deps.

On **type-level honesty (20%)** D is *not* neutral, and both members were too comfortable here: `startApiSession` remains a declaration with no body. I rule that acceptable only because **the body exists** — in `createApiSession` — and the sole reason the method is unwired is a registry lift D52 assigned elsewhere. That is *deferred wiring*, not dead capability, and Phase 3b must say so in a comment on the method so a future reader cannot mistake it for unimplemented capability. This is the direct answer to the success criterion that forbade dodging the `startApiSession` question.

Option **B** is rejected: it drags a wire-enum widening, the launch dialog, restart, restore and the F25 projection filter into the same reviewable commit as the first HTTP transport the app has ever made — two high-risk changes in one unit, against constraint 7 — and moves a lift another phase owns for no benefit available today. Option **C** is rejected on D45(2) and, independently, on cost: the council protocol is **multi-round** (this very session ran position → critique), so a "batch client" would have to grow conversation state anyway and would arrive at the handle by a worse road. D45(2) was right, and C is correctly argued down rather than ignored.

**Four things the members collectively missed**, all now folded into the ruling:

1. **`usage` is unreachable through the declared handle** while being a settled hard cost-control requirement. GLM's mitigation ("the orchestrator parses the final SSE chunk") is not implementable — the orchestrator never sees SSE, only the `string` deltas the factory chose to yield.
2. **Every timeout and abort detail in the only concrete code offered would ship a bug.** A 10 s `setTimeout` abort spanning a whole streamed completion kills any member that thinks for eleven seconds; `signal ?? activeController.signal` silently disables the internal timeout whenever a caller passes a signal; and pushing each delta into `messages` as its own `assistant` entry replays round one as hundreds of one-token turns in round two.
3. **A crash leaves a minted key with live spend allowance.** Both members proved the restore engine cannot *relaunch* a run, then treated "leaves no trace" as a virtue. No trace means no reconciliation. "Out of `SessionManager`" must not mean "out of the database."
4. **Scrubbing was ruled in one direction only.** The novel api-mode threat is that Chorus now *ships user-authored markdown to a third party*; a brief quoting a secret exfiltrates it on the **request**, before any output exists to scrub.

### Q2: OUT — a council member never enters `SessionManager`; a `CouncilRun` owns its handles. Amended: the *run* gets a persisted `council_runs` row the restore engine is structurally unable to read (**unanimous on "out", 2-of-2 + arbiter; persistence is an arbiter amendment**)

`SessionManager`'s map is keyed by `sessions` row id and its boot reconciliation walks persisted `running` rows against the layout tree; a council member holding such a row is a credential resolved for inference with no user gesture, breaking constraint 5.

**Restore consequence, stated:** on boot, no council member is relaunched, no handle is recreated, and the council view opens empty; a run interrupted by crash or quit is **terminal**, and the user re-issues it. The amendment: `council_runs` lives outside `sessions`, is never joined into the layout projection (so the F25 class of failure cannot reach it), and boot performs exactly one action against any row left `running` — mark it `aborted` and **revoke/expire its minted key** — never relaunch. Because leaving `SessionManager` also means leaving the app's only lifecycle owner, `CouncilService` must hold a process-level registry of live runs and `dispose()` every handle on `before-quit` and on navigation away from the view.

### Q3: REPLACE (**arbiter overrules the 2-of-2 QUALIFY; both dissents preserved verbatim below**)

Two present-tense forces, not predictions. (a) Per-member token/cost granularity is already ruled binding for this phase and **cannot cross an `AsyncIterable<string>`**. (b) The deliberation protocol is multi-turn, so the unwritten `send`-then-`receive` pairing — which turn does this iterable answer? what if nobody iterates? what if two callers do? — becomes a **correctness** question in round two, not a documentation question. The replacement makes a *turn* the unit; it is smaller in surface than what it replaces, serves a blind-round fan-out (`Promise.all` over `turn.done`) and an interactive chat (`for await (c of turn.text)`) with the same object, and leaves the sessionOutput wiring identical. Verbatim:

```ts
// src/main/adapters/types.ts — amended (zero existing implementations; this diff is free today)

/** Provider-reported accounting for one assistant turn. All fields nullable:
 *  providers omit them, and a streamed turn may need an explicit opt-in to
 *  report them at all (VERIFY against the provider's own docs before coding). */
export interface ApiUsage {
  readonly promptTokens: number | null
  readonly completionTokens: number | null
  readonly totalTokens: number | null
  /** Cost in USD if the provider reports it; null if it must be derived. */
  readonly costUsd: number | null
}

export interface ApiTurnResult {
  readonly finishReason: string | null
  readonly usage: ApiUsage | null
  /** Model the provider actually served; may differ from the requested id. */
  readonly servedModelId: string | null
}

export interface ApiTurn {
  /** Assistant text deltas for THIS turn, in order. Iterate at most once.
   *  The request is already in flight before the first `next()`. */
  readonly text: AsyncIterable<string>
  /** Settles when the turn ends: resolves with accounting, or rejects with a
   *  sanitized error (never a header, never a key fragment, never a raw body).
   *  Settles whether or not `text` was consumed. */
  readonly done: Promise<ApiTurnResult>
}

export interface ApiSessionHandle {
  readonly sessionId: string
  /** Appends `message` as a user turn and starts exactly one assistant turn.
   *  THROWS if the handle is disposed or a turn is already in flight. */
  send(message: string, signal?: AbortSignal): ApiTurn
  /** Idempotent. Aborts any in-flight turn and drops the credential reference. */
  dispose(): Promise<void>
}

export interface ApiLaunchSpec {
  readonly sessionId: string
  readonly modelId: string
  /** OpenAI-compatible base, no trailing slash, e.g. 'https://openrouter.ai/api/v1'.
   *  A parameter, NOT a literal: the native chat pane may target another base. */
  readonly baseUrl: string
  readonly credential: ResolvedCredential
  readonly systemPrompt?: string
}

export interface ApiAgentAdapter extends BaseAgentAdapter {
  readonly executionMode: 'api'
  getModels(credential?: ResolvedCredential, signal?: AbortSignal): Promise<readonly ModelInfo[]>
  /** DEFERRED WIRING, not missing capability: the implementation is
   *  services/apiSession.ts#createApiSession. This method goes live in the same
   *  change that lifts the frozen registry (D52 → Phase 3d). */
  startApiSession(spec: ApiLaunchSpec, signal?: AbortSignal): Promise<ApiSessionHandle>
}
```

### Q4: SCRUB — and scrub **bidirectionally** (**unanimous on scrub, 2-of-2 + arbiter; the inbound leg is an arbiter addition**)

Threat model, named:

- **(a) Egress-on-request.** A brief authored by the user may quote a registered secret; Chorus transmits it to a third-party inference provider. Outbound-only scrubbing cannot touch this — the leak completes before the first token returns. Every prompt assembled for a member therefore passes a `Scrubber` before `fetch`, and a registered-secret hit in a brief is logged label-only.
- **(b) Echo-to-disk.** Model output is broadcast to the view **and** written to a findings `.md`. All response text drives `createSessionOutput().ingest()`, and the findings file is written **from the scrubbed buffer** — never from a parallel raw accumulation. That specific mistake is what converts "we route through the seam" into the false sense of coverage Q4 warned about.
- **(c) The PTY threat does not apply** and I record it plainly: the model never receives the key and cannot echo what it was never sent. Scrubbing here earns its keep on (a) and (b) alone.

One correction to both members: the **per-run minted key is not in the pre-existing registered-secret set**, so `CouncilRun` must register it (and the resolving parent credential) with the run's prompt scrubber and per-member `SessionOutput` explicitly — otherwise coverage is zero for the only key actually in play.

### Q5: NAMED — a provider registry disjoint from `AgentKind`; identified as load-bearing, **deliberately deferred** (arbiter overrules both "none" answers)

The shape neither member considered discharges D's only real weakness: put api adapters in their own frozen record keyed by an `ApiProviderId` enum that is **not** `agentKindSchema` and never reaches `sessions.agent`. `startApiSession` goes live immediately, nothing on the wire widens, the F25 filter is untouched. I do **not** adopt it for Phase 3b — it adds a second registry whose merger with the first is precisely the Phase 3d question, and constraint 7 favours the plainest thing that lands — but it is the correct escape hatch if the deferred-wiring comment proves insufficient, and it is a ~30-line addition on top of the winner, not a rewrite of it.

### Q6: No lift of the frozen-registry ruling inside Phase 3b

`agentKindSchema` stays `z.enum(['claude','codex'])`; `staticRegistry` stays two PTY adapters; D34 Q5's lift stays with Phase 3d per D52. Nothing in the winner requires the enum to admit an id that cannot spawn a PTY.

---

## The producer (verbatim TypeScript, implementable)

```ts
// src/main/services/apiSession.ts
//
// THE single producer of ApiSessionHandle. One HTTP transport for every api-mode
// consumer in the app: Phase 3b's CouncilService today, the native chat pane later.
// Deliberately free of electron, node-pty, SessionManager and the agent registry.
// When the frozen registry is lifted (Phase 3d), ApiAgentAdapter.startApiSession
// becomes:  async startApiSession(spec, signal) { return createApiSession(spec) }
// — the signal is per-TURN here, so it is passed to send(), not to construction.

import type {
  ApiLaunchSpec,
  ApiSessionHandle,
  ApiTurn,
  ApiTurnResult,
  ApiUsage
} from '../adapters/types'

export interface ApiSessionDeps {
  /** Injected for tests; defaults to global fetch. Mirrors openrouterKeys.ts. */
  readonly fetchImpl?: typeof fetch
  /** Time to first byte. NOT a cap on total turn duration. */
  readonly connectTimeoutMs?: number
  /** Idle gap between bytes before the turn aborts. NOT a total-duration cap:
   *  a 10s total cap kills any member that thinks for eleven seconds. */
  readonly idleTimeoutMs?: number
  /** Provider attribution headers if the provider wants them (VERIFY names). */
  readonly extraHeaders?: Readonly<Record<string, string>>
}

type Role = 'system' | 'user' | 'assistant'
interface Msg { readonly role: Role; readonly content: string }

/** Synchronous: constructing a handle performs no I/O and resolves no credential. */
export function createApiSession(
  spec: ApiLaunchSpec,
  deps: ApiSessionDeps = {}
): ApiSessionHandle {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch
  const connectTimeoutMs = deps.connectTimeoutMs ?? 20_000
  const idleTimeoutMs = deps.idleTimeoutMs ?? 90_000

  const history: Msg[] = spec.systemPrompt
    ? [{ role: 'system', content: spec.systemPrompt }]
    : []

  let disposed = false
  let inFlight: AbortController | null = null

  function send(message: string, signal?: AbortSignal): ApiTurn {
    if (disposed) throw new Error('apiSession: handle disposed')
    if (inFlight) throw new Error('apiSession: turn already in flight')
    history.push({ role: 'user', content: message })

    const ctl = new AbortController()
    inFlight = ctl
    // Compose, never replace: passing the caller's signal INSTEAD of ours
    // silently disables our own timeouts.
    // VERIFY AbortSignal.any is available in this Electron's Node; if not,
    // add a 6-line manual forwarder rather than dropping either signal.
    const linked = signal ? AbortSignal.any([ctl.signal, signal]) : ctl.signal

    const chunks: string[] = []          // queue: producer pushes, consumer drains
    let waiter: (() => void) | null = null
    let ended = false
    const wake = () => { const w = waiter; waiter = null; w?.() }

    let settle!: (r: ApiTurnResult) => void
    let fail!: (e: unknown) => void
    const done = new Promise<ApiTurnResult>((res, rej) => { settle = res; fail = rej })
    void done.catch(() => {})            // a text-only consumer must not trip UnhandledRejection

    // EAGER: the request is in flight before anyone iterates, so a fan-out of
    // five members is Promise.all over turn.done with no consumer loop required.
    void (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const arm = (ms: number) => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => ctl.abort(new Error('apiSession: timeout')), ms)
      }
      const assembled: string[] = []
      let usage: ApiUsage | null = null
      let finishReason: string | null = null
      let servedModelId: string | null = null
      try {
        arm(connectTimeoutMs)
        const res = await fetchImpl(`${spec.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${spec.credential.value}`,   // VERIFY field name on ResolvedCredential
            ...(deps.extraHeaders ?? {})
          },
          body: JSON.stringify({
            model: spec.modelId,
            messages: history.slice(),
            stream: true
            // FILL: the provider's opt-in for usage accounting ON A STREAMED
            // response. Do NOT assume usage arrives by default. VERIFY.
          }),
          signal: linked
        })
        if (!res.ok || !res.body) {
          // Status only. Never the response body, never a header, never a key fragment.
          throw new Error(`apiSession: HTTP ${res.status}`)
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let carry = ''
        for (;;) {
          arm(idleTimeoutMs)
          const { done: eof, value } = await reader.read()
          if (eof) break
          carry += decoder.decode(value, { stream: true })
          const lines = carry.split('\n')
          carry = lines.pop() ?? ''
          for (const raw of lines) {
            const line = raw.trim()
            if (!line.startsWith('data:')) continue
            const payload = line.slice(5).trim()
            if (payload === '[DONE]') { carry = ''; break }
            // FILL after verifying the provider's SSE envelope: extract the text
            // delta, finish_reason, served model id, and the usage block.
            // Malformed lines are skipped, never thrown on.
            const evt = safeParse(payload)
            if (!evt) continue
            const delta = pickDelta(evt)
            if (delta) { assembled.push(delta); chunks.push(delta); wake() }
            finishReason = pickFinishReason(evt) ?? finishReason
            servedModelId = pickModelId(evt) ?? servedModelId
            usage = pickUsage(evt) ?? usage
          }
        }
        // ONE assistant message per turn. Pushing each delta separately replays
        // round one as hundreds of one-token turns in round two.
        history.push({ role: 'assistant', content: assembled.join('') })
        settle({ finishReason, usage, servedModelId })
      } catch (e) {
        fail(sanitizeError(e))
      } finally {
        if (timer) clearTimeout(timer)
        ended = true
        inFlight = null
        wake()
      }
    })()

    const text: AsyncIterable<string> = {
      async *[Symbol.asyncIterator]() {
        for (;;) {
          while (chunks.length > 0) yield chunks.shift() as string
          if (ended) return
          await new Promise<void>(r => { waiter = r })
        }
      }
    }

    return { text, done }
  }

  return {
    sessionId: spec.sessionId,
    send,
    async dispose() {
      disposed = true
      inFlight?.abort(new Error('apiSession: disposed'))
      inFlight = null
      history.length = 0
    }
  }
}

// --- local helpers, all pure, all provider-shape-specific: FILL after VERIFY ---
function safeParse(s: string): unknown | null { try { return JSON.parse(s) } catch { return null } }
function pickDelta(evt: unknown): string | null { /* FILL */ return null }
function pickFinishReason(evt: unknown): string | null { /* FILL */ return null }
function pickModelId(evt: unknown): string | null { /* FILL */ return null }
function pickUsage(evt: unknown): ApiUsage | null { /* FILL */ return null }
/** Strips anything that could carry a credential out of an error before it
 *  crosses a log line, an IPC boundary, or a findings file. */
function sanitizeError(e: unknown): Error { /* FILL — mirror openrouterKeys.ts */ return e instanceof Error ? e : new Error('apiSession: failed') }
```

**Facts the implementer must verify against vendor documentation before coding** — none of us can settle these, and the council flagged only some: the provider's SSE envelope and delta path; whether a streamed response requires an explicit opt-in body parameter to include `usage`, and where that block appears; whether a cost figure is reported and under what name; any required attribution headers; the exact field on `ResolvedCredential` holding the key string; and `AbortSignal.any` availability in this Electron's Node runtime.

---

## What Phase 3b implements vs declares

**Implements**
- `createApiSession` in `src/main/services/apiSession.ts` — the only api transport in the app.
- The amended `ApiUsage` / `ApiTurnResult` / `ApiTurn` / `ApiSessionHandle` / `ApiLaunchSpec` types in `adapters/types.ts` (free: zero existing implementations).
- `CouncilService` / `CouncilRun` — owns handles, fans out members, mints and revokes the per-run key, enforces the hard spend limit from `turn.done.usage`, disposes on quit and on abort.
- Prompt-side scrubbing before `fetch`; response-side `createSessionOutput().ingest()`; findings `.md` written from the scrubbed buffer.
- A `council_runs` table (migration **v11**) the layout projection and restore engine never read; boot marks stale `running` rows `aborted` and revokes their minted keys.
- The council view/route (per Matthew's 2026-07-26 ruling), with **one `SessionOutput` per member**.

**Declares only (deferred wiring, commented as such)**
- `ApiAgentAdapter.startApiSession` and `getModels`.
- The `'openrouter-api'`-style id, its `staticRegistry` entry, and the `agentKindSchema` widening. All land together in Phase 3d per D52.

**Not touched**
- `agentKindSchema`, `staticRegistry`, `SessionManager`, the F25 projection filter, `sessions` / `launch_profiles` / `dispatches`, the persisted layout tree.

---

## Risks & mitigations for the winner

1. **`startApiSession` reads as unimplemented capability to a future contributor.** → The doc-comment in the amended interface names `createApiSession` as its body and D52/Phase 3d as the wiring owner. If insufficient, adopt Q5's disjoint provider registry (~30 lines, no wire change).
2. **The native chat pane later disagrees with the shape.** The likely disagreement is structured content (tool calls, images, citations), not turn mechanics. → `ApiTurn.text` stays `string` so the scrub seam is unchanged; a future `turn.events: AsyncIterable<ApiEvent>` is *additive beside it* and does not fork the producer. If the pane instead needs mid-turn interruption, `send()` already takes a per-turn `AbortSignal`.
3. **Provider omits `usage` on streamed responses.** → The hard limit must not depend on it: `CouncilRun` also relies on the minted key's server-side cap, and treats `usage: null` as "cost unknown, cap enforced upstream" — never as zero.
4. **Total-duration vs idle timeout confusion.** → Connect + idle timeouts only, as coded. One test asserts a member streaming slowly for >60 s survives.
5. **Multi-round history corruption.** → One assistant message per turn, as coded. One test runs two rounds against a mock `fetchImpl` and asserts the second request body has exactly three messages.
6. **Orphaned minted key after a crash.** → `council_runs` + boot revocation sweep. This is precisely why Q2's "out" must not mean "unpersisted."
7. **Scrubber covers only registered secrets.** → Register the minted key and the resolving parent credential for the run; document that unregistered secrets pasted into a brief are out of coverage; warn label-only when a registered secret is found in a brief rather than silently redacting.
8. **3–5 members interleaving into one view.** → Eager-start `send()` plus **one `SessionOutput` per member** (never one shared, or transcripts interleave irreversibly); the view composes per-member streams.
9. **Endpoint/provider hardcoding.** → `baseUrl` on `ApiLaunchSpec`; attribution headers via `ApiSessionDeps.extraHeaders`. No provider literal inside the transport except the path suffix `/chat/completions`.
10. **Amending a declared interface repeats the `SupportsStateDetection` mistake.** → The amendment *removes* a method, is driven by two settled requirements, and ships in the same commit as its only implementation.

---

## Dissents preserved

Every recorded disagreement is reproduced below with arbiter commentary on whether it is well-founded, tagged to the question it bears on.

**[Critique — R1] CR GLM (5.2) — on Q3:** *"I disagree with Position A's Q3 qualification that `receive(): AsyncIterable<string>` should enforce exactly one complete response for blind-round batch usage. An `AsyncIterable` is fundamentally a streaming interface; forcing exactly one yield per invocation breaks the contract of the type and introduces mode-specific bifurcation. Consumers needing a single complete response should simply aggregate the stream themselves. The interface should remain a pure, consistent streaming primitive regardless of the caller's interactive or batch intent."*
→ **Well-founded, and upheld.** This is the strongest single critique in the record and it decided the Q3 sub-question: mode-specific yield semantics on one `AsyncIterable` is a fork wearing a doc-comment. My replacement adopts GLM's principle exactly — `ApiTurn.text` is an unconditioned stream of deltas in both modes — and satisfies the batch caller through the *separate* `turn.done` promise rather than by changing what `text` yields. Qwen's caveat is overruled; revisit only if the view abandons live streaming.

**[Critique — R1] CR GLM (5.2) — on Q1:** *"Position A missed the risk of hidden coupling in Q1's Option D. By rigidly shaping the standalone factory to match the declared `ApiAgentAdapter` signature today, we bind the factory's stability to a shape that might need to evolve before Phase 3d integration. If `ApiAgentAdapter` requirements shift, the standalone factory may require breaking changes, which Option D was meant to prevent."*
→ **Well-founded, and acted on — it is the reason I amended rather than conformed.** Rather than freeze the factory to a shape written before any transport existed, I moved the shape to where the requirements now are: the `AbortSignal` becomes **per-turn** on `send()` (its natural scope), test/transport dependencies live in a separate `ApiSessionDeps` object the adapter never has to carry, and `baseUrl` becomes spec data. Delegation is therefore `return createApiSession(spec)` with no argument gymnastics. Residual risk is logged as risk 1 with Q5's disjoint provider registry as the named escape hatch; GLM's own Option-B hindsight note (below) is its trigger.

**[Critique — R1] CR Qwen (3-coder) — on Q1/Q6:** *"The claim that 'Phase 3b does NOT require lifting the frozen registry' holds technically, but is misleading. While the enum isn't widened, the design still depends on `ApiAgentAdapter` being declared (but unimplemented) in types. This is subtle technical debt — leaving interfaces declared but not actionable risks confusing future developers or tooling relying on full interface parity. The 'dead declaration' problem isn't fully solved; it's deferred."*
→ **Well-founded, and I record it as an accepted cost rather than a solved problem.** The success criteria forbade answering Q1 without addressing whether `startApiSession` stays a dead declaration, so this is stated plainly: **it stays declared and unwired for the duration of Phase 3b.** The mitigations are (i) the mandatory deferred-wiring comment naming `createApiSession` as its body and Phase 3d as its owner, and (ii) Q5's provider registry, which converts the debt to zero for ~30 lines if a contributor is actually confused. I judged the honesty cost (20% weight) smaller than B's blast-radius cost (25%) in the same commit as the first HTTP transport — but Qwen is right that this is a trade, not a win.

**[Critique — R1] CR Qwen (3-coder) — on Q1 (orchestration, raised as GLM's unprompted observation):** *"While the concurrency orchestration point is noted unprompted, it's not addressed in the evaluative sections (Q1-Q5). Given its strong downstream impact on UX and system behavior (e.g., fairness, interleave semantics), it deserves more than a footnote. Especially since the handle design supports both models but the view must mediate them, there's architectural risk in ignoring implementation-level coordination too early."*
→ **Well-founded, and promoted out of the footnote into two binding decisions.** First, `send()` is **eager**: the request is in flight before anyone iterates, so a five-member fan-out is `Promise.all` over `turn.done` with no consumer loop required and no member starved by the order in which the view happens to subscribe. Second, **one `SessionOutput` per member** — a shared instance interleaves five transcripts irreversibly inside the scrub buffer, which is unrecoverable once written to findings. Both appear in the producer code and in risk 8.

**[Critique — R1] CR Qwen (3-coder) — on Q1 (configurability):** *"There is little attention paid to configurability of endpoints or secrets handling at scale. Though acceptable for Phase 3b, hardcoding OpenRouter assumptions without a clear path to multi-provider support introduces technical friction. A note on how `ApiSessionOpts` might evolve to support dynamic endpoints or provider-specific headers would better future-proof the analysis."*
→ **Well-founded, and adopted outright — I went further than "a note."** Hardcoding the provider inside the transport would have failed rubric item 1 directly: a chat pane on another OpenAI-compatible base would need a second producer, which is the divergence D45(2) forbids. So `baseUrl` is a required field on `ApiLaunchSpec` and attribution headers are injected via `ApiSessionDeps.extraHeaders`. On the secrets half of the point: the per-run minted key must be *registered* with the scrubber, which neither member's design did.

**[Position — R1] CR GLM (5.2) and CR Qwen (3-coder) — Q3 QUALIFY, not REPLACE:** both would ship the declared `send`/`receive()`/`dispose` triplet with a doc-comment. **Revisit if** verification shows the provider reports `usage` only on a *non*-streamed response — in that case a batch council and a streaming chat genuinely diverge at the transport, and the minimal-diff QUALIFY path (keep `receive()`, add `turnResult(): Promise<ApiTurnResult>`) becomes the cheaper correct answer.

**[Position — R1] CR GLM (5.2) — Option B would look better in hindsight if the factory's dependencies drift from what the adapter needs:** preserved as the concrete trigger for Q5. If Phase 3d finds `startApiSession(spec, signal)` cannot delegate in one line, that is the signal to adopt the **disjoint provider registry**, not to widen `agentKindSchema`.

**[Position — R1] CR Qwen (3-coder) — "session" is overloaded across PTY sessions and transient inference tasks:** **upheld and acted on.** The council surface persists as `council_runs`, not `sessions`; `ApiSessionHandle.sessionId` survives only as the correlation key for the sessionOutput/broadcast plumbing and must not be read as a `sessions` row id anywhere.

---

## Action items for implementation

1. [ ] Amend `src/main/adapters/types.ts` with `ApiUsage`, `ApiTurnResult`, `ApiTurn`, the replaced `ApiSessionHandle`, `ApiLaunchSpec` gaining `baseUrl`, and the deferred-wiring comment on `startApiSession`.
2. [ ] Verify against vendor docs **before** writing any FILL body: SSE envelope and delta path; the opt-in for `usage` on a streamed response and where it lands; cost field name; required attribution headers; `ResolvedCredential`'s key field; `AbortSignal.any` availability in this Electron's Node.
3. [ ] Create `src/main/services/apiSession.ts` exactly as printed above; fill `pickDelta` / `pickFinishReason` / `pickModelId` / `pickUsage` / `sanitizeError`.
4. [ ] Confirm by grep that `agentKindSchema`, `registry.ts`, `sessionManager.ts` and the `layout:get` projection filter are **unchanged** in this commit.
5. [ ] Add migration **v11**: `council_runs` plus per-member rows carrying `usage`, with a comment stating that no restore path may read this table.
6. [ ] Implement the boot sweep: any `council_runs` row left `running` → mark `aborted` **and** revoke/expire its minted key. Never relaunch.
7. [ ] `CouncilRun`: mint one key with a hard cap; resolve via the existing `resolveCredential` (management class refused pre-decryption); register the minted key *and* the resolving parent credential as scrubber secrets; construct **one `SessionOutput` per member**.
8. [ ] Scrub every assembled prompt through a `Scrubber` before `fetch`; emit a label-only warning on a registered-secret hit in a brief.
9. [ ] Write the findings `.md` from the scrubbed `SessionOutput` buffer only; assert in a test that no raw accumulation path exists.
10. [ ] Dispose all live handles on `before-quit` and on leaving the council view; assert no in-flight `fetch` survives either.
11. [ ] Tests with injected `fetchImpl`: (a) canned SSE → scrubbed text **and** populated `usage`; (b) two rounds → second request body has exactly three messages; (c) slow stream >60 s survives; (d) caller-supplied signal aborts **and** the internal idle timeout still fires; (e) `send()` during an in-flight turn throws; (f) `HTTP 401` rejects `done` with a message containing no header, body or key fragment; (g) `dispose()` mid-stream aborts and is idempotent; (h) `turn.done` settles when `turn.text` is never iterated.
12. [ ] Run the repo-wide secret-grep gate; additionally grep the produced findings fixture for every registered secret.
13. [ ] Record this ruling as a numbered decision (D63) stating explicitly that D34 Q5's frozen-registry lift **remains owned by Phase 3d, unchanged**, and that Q5's disjoint provider registry is the named fallback if the deferred-wiring comment proves insufficient.

---

## How disagreement was detected

- **Q1** — detection: `structural` · members agreed
- **Q2** — detection: `structural` · members agreed
- **Q3** — detection: `structural` · members agreed
- **Q4** — detection: `structural` · members agreed
- **Q5** — detection: `model-judged` · not measured · no verdict token from: CR Qwen (3-coder)
- **Q6** — detection: `model-judged` · not measured · no verdict token from: CR GLM (5.2), CR Qwen (3-coder)

_`structural` means the orchestrator compared the members' own verdict tokens and counted the difference. `model-judged` means too few members answered in the required form, so the arbiter judged it from prose — a weaker signal, labelled rather than hidden._

## Dissents preserved

- [Critique — R1] CR GLM (5.2): I disagree with Position A's Q3 qualification that `receive(): AsyncIterable<string>` should enforce exactly one complete response for blind-round batch usage. An `AsyncIterable` is fundamentally a streaming interface; forcing exactly one yield per invocation breaks the contract of the type and introduces mode-specific bifurcation. Consumers needing a single complete response should simply aggregate the stream themselves. The interface should remain a pure, consistent streaming primitive regardless of the caller's interactive or batch intent.
- [Critique — R1] CR GLM (5.2): Position A missed the risk of hidden coupling in Q1's Option D. By rigidly shaping the standalone factory to match the declared `ApiAgentAdapter` signature today, we bind the factory's stability to a shape that might need to evolve before Phase 3d integration. If `ApiAgentAdapter` requirements shift, the standalone factory may require breaking changes, which Option D was meant to prevent.
- [Critique — R1] CR Qwen (3-coder): The claim that “Phase 3b does NOT require lifting the frozen registry” holds technically, but is misleading. While the enum isn’t widened, the design still depends on `ApiAgentAdapter` being declared (but unimplemented) in types. This is subtle technical debt — leaving interfaces declared but not actionable risks confusing future developers or tooling relying on full interface parity. The "dead declaration" problem isn’t fully solved; it’s deferred.
- [Critique — R1] CR Qwen (3-coder): While the concurrency orchestration point is noted unprompted, it’s not addressed in the evaluative sections (Q1-Q5). Given its strong downstream impact on UX and system behavior (e.g., fairness, interleave semantics), it deserves more than a footnote. Especially since the handle design supports both models but the view must mediate them, there's architectural risk in ignoring implementation-level coordination too early.
- [Critique — R1] CR Qwen (3-coder): There is little attention paid to configurability of endpoints or secrets handling at scale. Though acceptable for Phase 3b, hardcoding OpenRouter assumptions without a clear path to multi-provider support introduces technical friction. A note on how `ApiSessionOpts` might evolve to support dynamic endpoints or provider-specific headers would better future-proof the analysis.

## Provenance

- **Run id:** `4c17069c-5fd4-4750-8671-5149281cfce5`
- **Started:** 2026-07-28T14:33:44.875Z

| Member | Role | Model | Turns |
|---|---|---|---|
| CR GLM (5.2) | member | `z-ai/glm-5.2` | answered 2 turns |
| CR Kimi (k3) | member | `moonshotai/kimi-k3` | refused 1 turn |
| CR Qwen (3-coder) | member | `qwen/qwen3-coder` | answered 2 turns |
| CR Arbiter (opus-5) | arbiter | `anthropic/claude-opus-5` | answered 2 turns |

