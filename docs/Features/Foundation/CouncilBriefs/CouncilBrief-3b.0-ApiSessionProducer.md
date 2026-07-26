# Council Brief CR-3b.0 — Who Produces an `ApiSessionHandle`?

_Issued 2026-07-26 · Status: **CLOSED — findings filed 2026-07-26 (`CouncilBrief-3b.0-Findings.md`), recorded as D63 with coordinator resolutions (a)–(f)** · Decision owner: Matthew Wilson · Recorder: Claude (roadmap §6) · Code state verified this session at commit `341ea5c` (Phase 3a closed)_

You are a review council of independent LLM models. Deliberate on the decision below and return findings in the **Required Output Format** at the end. You have no other context on this project — everything you need is in this document. Where you are uncertain about an external fact (a provider's API shape, a library's behaviour), **say so explicitly rather than guessing**; the implementer re-verifies every such fact against the vendor's own documentation before coding.

---

## 1. What Chorus is

Chorus is a local-first, BYOK (bring-your-own-key) Windows desktop app — Electron 43 + Vue 3 + TypeScript + Vite + Pinia — for running multiple AI coding agents in parallel terminal panes. Each pane hosts an xterm.js terminal attached over typed IPC to a PTY session (node-pty/ConPTY) owned by the Electron **main** process. It runs two real interactive CLI TUIs today: Claude Code (`claude.exe` 2.1.218) and Codex CLI (`codex-cli` 0.145.0).

Locked rules, **not up for review**: sessions live in main, owned by `SessionManager`; the renderer never spawns processes and never resolves executables; all Zod validation in main only; the preload is a narrow, Zod-free typed forwarder; IPC payloads are plain objects; SQLite with hand-rolled versioned migrations (currently at **v10**, eleven tables plus `launch_profiles`); credentials are encrypted with Electron `safeStorage`/DPAPI and injected into child processes as **environment variables only — never argv, never disk, never logs**.

## 2. Why this decision exists now

Chorus is starting **Phase 3b — Native Council Review**: the very review mechanism you are part of becomes a feature of the app. A `CouncilService` in main will orchestrate 3–5 API-mode council members plus a frontier arbiter, take a brief `.md` path as input, stream deliberation live, and write a findings `.md` beside the brief.

Every one of those members is an **API-mode session**: an HTTP call to an OpenAI-compatible chat-completions endpoint (OpenRouter), not a spawned process. Chorus has **never made one**. Phase 3b is therefore the first consumer of api-mode machinery, and a prior decision (D45, quoted in §4) makes that consequential: *whatever this phase builds becomes the de-facto api-mode machinery for the whole app*, including a native chat pane the product has already committed to.

The question is narrow and structural: **what object hands back an `ApiSessionHandle`, and does that producer live inside the existing agent-adapter registry or outside it?** Getting it wrong in one direction forces a schema-and-registry widening the project has deliberately deferred to a later phase; getting it wrong in the other forks the api-mode mechanism into two shapes.

## 3. Current implementation state (verified 2026-07-26 at commit `341ea5c`)

### 3.1 The adapter layer exists, and api mode is declared but has zero implementations

`src/main/adapters/types.ts` declares a discriminated union (line 297):

```ts
export type AgentAdapter = PtyAgentAdapter | ApiAgentAdapter

export interface ApiAgentAdapter extends BaseAgentAdapter {
  readonly executionMode: 'api'
  getModels(credential?: ResolvedCredential, signal?: AbortSignal): Promise<readonly ModelInfo[]>
  startApiSession(spec: ApiLaunchSpec, signal?: AbortSignal): Promise<ApiSessionHandle>
}

export interface ApiLaunchSpec {
  readonly sessionId: string
  readonly modelId: string
  readonly credential: ResolvedCredential
  readonly systemPrompt?: string
}

export interface ApiSessionHandle {
  readonly sessionId: string
  send(message: string): Promise<void>
  receive(): AsyncIterable<string>
  dispose(): Promise<void>
}
```

`getModels` and `startApiSession` have **zero implementations** in the repo. `isPtyAdapter` / `isApiAdapter` type guards exist (lines 299–305) and nothing calls the api one.

### 3.2 The registry is typed so that adding an adapter forces widening the wire enum

`src/main/adapters/registry.ts` in full is 35 lines. The load-bearing part:

```ts
export const staticRegistry: Readonly<Record<AgentKind, AgentAdapter>> = Object.freeze({
  claude: claudeAdapter,
  codex: codexAdapter
})
```

Its own comment states the intent: *"adding a kind to `agentKindSchema` without adding an adapter here is a BUILD failure, and vice versa."*

`agentKindSchema` is the **wire authority**, declared once in `src/shared/ipc.ts:157`:

```ts
export const agentKindSchema = z.enum(['claude', 'codex'])
```

It is referenced by `attachRequestSchema` (180), `launchRequestSchema` (262), `launchProfileWireSchema` (339), `launchProfileCreateRequestSchema` (367), `sessionInfoSchema` (1203) and `legacyPaneSchema` (1325), and appears as a nullable field on the CLI-detection row schema (1047).

The corresponding database columns — `sessions.agent`, `launch_profiles.agent`, `dispatches.agent` — are plain `TEXT` and enforce nothing. **That gap between an unconstrained column and a two-value wire enum is exactly where F25 lived**, and it is why the enum's membership is load-bearing rather than cosmetic.

### 3.3 A real, already-paid-for bug says registry membership and enum membership must not drift

**F25** (found 2026-07-23, fixed by a dedicated chore commit): `sessions.agent` is a TEXT column that can hold anything, but `sessionInfoSchema.agent` is `agentKindSchema`, and the `layout:get` handler **outbound-parses the entire `{layout, sessions[]}` response**. One row holding an unknown agent value rejected the whole IPC invoke, the renderer's load watcher had no catch, and **an entire project's view rendered as the empty state despite having a real saved layout**.

The fix filters unknown-agent rows out of the projection via a `getAdapter(row.agent)` registry lookup. That fix **treats registry membership as proof of `agentKindSchema` validity** — which is true only while the registry is keyed by the enum. The project's standing constraint, written in the roadmap: *an adapter id admitted outside the enum passes the filter and then fails the outbound parse, reintroducing F25 exactly.*

### 3.4 The ingest-scrub seam is ALREADY unified, and was built for this moment

`src/main/services/sessionOutput.ts` (107 lines) was extracted in a dedicated behaviour-neutral chore commit specifically so a second session type could not ship unredacted. Its header says so:

> *"The ONE place session output is scrubbed, buffered and broadcast — for ANY session type… scrubbing is a property of 'a session emits text', not 'a PTY emits text', so a second session type cannot ship unredacted by forgetting a second wiring point… Deliberately free of electron and node-pty: a PTY drives it from `onData`, and an api-mode session would drive it from `for await (… of handle.receive())`."*

Surface:

```ts
export function createSessionOutput(opts: {
  readonly secrets: readonly string[]
  readonly maxChars: number
  readonly flushMs: number
  readonly onText: (text: string) => void
}): SessionOutput   // { ingest(text), flush(), readonly buffer, dispose() }
```

It wraps a pure `Scrubber` (`push(chunk): string` / `flush(): string` / `pendingLength(): number`) that exact-matches registered secret values across chunk boundaries via a held carry.

**This is not an open question — the seam exists and works.** It matters to you only as a constraint: whatever produces an api session must drive text through *this* object, not around it.

### 3.5 `SessionManager` is PTY-shaped and holds the restore contract

`src/main/services/sessionManager.ts` (550 lines) owns `Map<string, PtySession>` keyed by database row id, and `spawn()` (line 407) builds the secrets list (line 469) and constructs the `SessionOutput` (line 478). Its public surface — `write`, `resize`, `kill`, `getAgent`, `onExit`, `attach`, `restore` — is PTY-shaped throughout. It also carries the **boot restore contract**: on startup it reconciles persisted `running` rows against the layout tree and relaunches or heals them.

The project has already written down (D45, §4) that eventually splitting this class by session type is the single highest-regression-risk refactor in the codebase, and has deferred it twice.

### 3.6 Credential resolution already exists and must be reused, not forked

`src/main/ipc.ts:332` holds a nested `resolveCredential(profileId, agent)` with five ordered refusals, label-only error messages (never a key fragment), and a decrypt-at-use discipline. A higher-privilege **management** credential class is refused **before** decryption. It returns `{ ok, credential, route, authType: 'subscription' | 'api_key' | null }`.

There is also a proven OpenRouter HTTP client precedent, `src/main/services/openrouterKeys.ts`: injected `fetchImpl` for testability, 10 s timeout, sanitize-on-the-way-out, and a `Result<T>` union instead of throwing. It is deliberately **structurally incapable of inference** — it contains no completion endpoint at all.

## 4. Binding prior rulings — constraints on your answer, not open questions

**D45 (resolved 2026-07-24)** committed Chorus to *both* pane types — an agent CLI pointed at OpenRouter (PTY) and a native api-mode chat pane — and attached four mitigations as binding:

1. **ONE ingest-scrub seam.** Discharged; see §3.4.
2. **`ApiSessionHandle` is the SINGLE primitive.** Verbatim: *"Phase 3b's council must be an **orchestrator over** that handle, never a parallel implementation, or the blind-round batch shape and the interactive-chat shape diverge into two mechanisms."*
3. **Pane type is a versioned, migrated layout-schema change**, and auto-titling needs a non-OSC mechanism. **Already avoided for this phase** — Matthew ruled on 2026-07-26 that a council run renders as a dedicated **view/route** in the main window (the existing Settings-view precedent), not as a leaf in the persisted layout tree. No layout migration is in scope.
4. **No api-mode work before Phase 3b kicks off.** Satisfied — this is that kickoff.

D45 also records a risk **accepted rather than solved**: `write` / `resize` / `kill` / `exitCode` / `dispose` are PTY-shaped and mean nothing to a conversation, and *"restore semantics will differ BY DESIGN"* — an api session can genuinely resume a conversation, whereas a restored PTY session is deliberately a fresh one.

**D34 Q5 (council-ruled, 3-of-3, 2026-07-22):** *"the adapter `id` IS the persisted `sessions.agent` value (no mapping layer); a static frozen registry for Phase 3 with a registration seam deferred to Phase 6; unknown persisted ids refuse cleanly, never crash."*

**D52 (resolved 2026-07-24):** two new PTY adapters (Kimi CLI; an OpenAI-compatible agent CLI) were moved into a separate later phase, **Phase 3d**, and — verbatim — *"D34 Q5's frozen-registry ruling travels WITH the adapters and is lifted in Phase 3d as its own numbered decision, together with widening `agentKindSchema` and the static registry in the same change."*

So: **another phase currently owns the registry lift.** If your answer requires lifting it in 3b instead, say so explicitly and argue why the ownership should move — that is a legitimate outcome, not a disqualifier.

**Settled by Matthew on 2026-07-26, for context (not for review):** the council surface is a view/route, not a layout pane; per-run cost is bounded by **one minted OpenRouter key per council run** with a hard limit, with per-member token/cost granularity read from each response's `usage` block; the pre-identified council checkpoint on the *deliberation protocol itself* is deferred to a later task, once a protocol design exists to review.

## 5. The decision

**Who constructs an `ApiSessionHandle`, and where does that producer live?**

### Option A — A standalone factory in main, outside the agent registry

`src/main/services/apiSession.ts` exports something like `createApiSession(spec): ApiSessionHandle`. `agentKindSchema` stays `'claude' | 'codex'`. The static registry is untouched. Council members get no `sessions` row and no layout leaf. `SessionManager` is not modified at all. Output is scrubbed by driving `createSessionOutput().ingest()` from `receive()`.

*For:* zero blast radius on the wire enum, the persisted columns, the F25 filter, or the restore contract; leaves D34 Q5's lift with Phase 3d as D52 assigned it; a council member genuinely is not an agent (D45's own framing: *"A raw OpenRouter model is not an agent"* — the installed CLIs have tool loops, file editing and shell access; a chat-completions endpoint has none).

*Against:* `ApiAgentAdapter.startApiSession` stays a dead declaration while a second, parallel producer does the real work — arguably the exact "parallel implementation" D45(2) forbids, dressed differently. Two producers of one primitive may be no better than two primitives.

### Option B — Implement `ApiAgentAdapter` and register it

Add an api-mode adapter (e.g. id `'openrouter-api'`) to `staticRegistry`, widening `agentKindSchema` in the same change. `startApiSession` becomes live. D34 Q5 is consciously lifted here, as a numbered decision, and Phase 3d inherits an already-lifted ruling.

*For:* honours the declared interface exactly as designed; one producer, one primitive, no divergence; the registry becomes genuinely execution-mode-polymorphic, which is where the product is heading anyway.

*Against:* every `session:launch`-shaped schema then admits an id that **cannot spawn a PTY**, and the launch dialog, restart, restore and the F25 filter must all learn to refuse it; it moves a lift another phase owns; and it puts a wire-enum widening into the same session as the first-ever api transport.

### Option C — A council-specific client; leave `ApiSessionHandle` unimplemented

`councilClient.ts` calls chat-completions directly. Simplest and smallest.

*Against:* directly contradicts D45(2). Listed for completeness and to be argued down explicitly rather than ignored — if you think D45(2) was wrong, this is where to say so.

### Option D — Standalone factory now, with a committed adoption path

Option A's module, but its signature is deliberately shaped as `(spec: ApiLaunchSpec, deps) => ApiSessionHandle` so that a future `ApiAgentAdapter.startApiSession` is a **one-line delegation** to it when Phase 3d or the native chat pane lifts the registry. The factory is the implementation; the adapter method, when it exists, is a thin wrapper.

*For:* A's safety with B's convergence; the "two producers" objection dissolves because one is the other's caller.

*Against:* it is a prediction about a future call site, and the project's own history (D34's struck `SupportsStateDetection`, a declared-but-unimplemented interface that had to be removed) is evidence that speculative shaping ages badly.

### Q2 — Does a council member belong to `SessionManager` at all?

Independent of Q1. A council member is transient: it exists for one deliberation round, has no cwd, no worktree, no restart semantics, and must **not** be resurrected by the boot restore engine. Options: keep it entirely outside `SessionManager` (a `CouncilRun` owns its handles); admit it to `SessionManager` behind the eventual session-type split; or a third shape you name.

### Q3 — Is `receive(): AsyncIterable<string>` the right primitive for a *blind-round* council?

D45(2)'s whole argument is that the batch shape and the interactive-chat shape must not diverge. But a council round is fundamentally **request → one complete answer**, whereas `AsyncIterable<string>` is a streaming primitive, and the roadmap wants the deliberation **streamed live** to the view. Is `send` + `receive` genuinely the right pair here, or is the declared handle over-shaped (or under-shaped) for a batch orchestrator? If you would change `ApiSessionHandle` itself, **now is the only cheap moment** — it has zero implementations.

### Q4 — Where does secret scrubbing bind for an api session?

For a PTY, the registered secret is the injected API key and the risk is the CLI echoing it (a real, observed failure: Claude Code prints a masked fragment of `ANTHROPIC_API_KEY` at startup). For an api session, Chorus itself puts the key in an `Authorization` header — the model never sees it, and *cannot* echo what it was never sent. Does routing api text through `sessionOutput`'s scrubber earn its keep, or is it ceremony that buys a false sense of coverage? Note the countervailing risk: **council members read a brief `.md` that may itself quote secrets**, and their output is written to a findings `.md` on disk.

### Q5 — Option-fixation check

Is there a shape above that should be discarded entirely for one not listed? Name one only if you would actually argue for it.

## 6. Constraints the winner must survive

1. **`ApiSessionHandle` must remain the single primitive** the eventual native chat pane also uses. If your answer makes the council's mechanism unreusable by an interactive chat, it fails D45(2) regardless of its other merits.
2. **All api text is scrubbed and buffered through `sessionOutput.ts`** unless Q4 rules otherwise with an argument, not a preference.
3. **Credential resolution reuses the existing `resolveCredential`** — no second decryption path, and the management-credential class stays refused before decryption.
4. **Keys never reach argv, disk, or a log line.** A repo-wide secret-grep gate runs before every commit and is mandatory for this phase.
5. **The boot restore engine must never resurrect a council member.** Whatever you choose, a crashed council run must not relaunch itself unattended — the project has a standing invariant that no credential is resolved for inference without a user gesture.
6. **No new npm dependency.** Use `fetch` with an injected `fetchImpl` for testability, as the existing OpenRouter client does.
7. **Bounded implementation.** This is one task in a four-task phase, landing as a single reviewable commit. A shape that takes three sessions to adopt is a worse answer than a plain one that lands.
8. **Windows-only v1.**

## 7. Evaluation rubric (weigh in this order)

1. **Non-divergence of the api mechanism** — the native chat pane, later, reuses this without a rewrite (30%).
2. **Blast radius containment** — what this forces to change in the wire enum, the persisted columns, the F25 filter, and the restore contract (25%).
3. **Type-level honesty** — no declared-but-dead interface, no id admitted where it cannot be executed (20%).
4. **Adoptability in one session** (15%).
5. **Simplicity** — a contributor can follow the path from "council needs a member" to "HTTP request" in one file (10%).

## 8. Questions for the council

1. **Q1:** A, B, C, D, or a named hybrid — with the **exact module and signature you would write today**, in TypeScript, and the strongest argument against your own choice.
2. **Q2:** does a council member enter `SessionManager`? Rule, with the restore consequence stated.
3. **Q3:** is `ApiSessionHandle` as declared (`send` / `receive(): AsyncIterable<string>` / `dispose`) correct for a blind-round council **and** a future interactive chat? If not, give the replacement verbatim.
4. **Q4:** does api-mode text route through the existing scrub seam? Rule, with the threat model that justifies it.
5. **Q5:** option-fixation check — load-bearing alternatives only.
6. **If your Q1 answer requires lifting the frozen-registry ruling inside Phase 3b**, say so explicitly and argue why that ownership should move off Phase 3d.

## 9. Success criteria for this council session

The council **succeeds** if it returns: (a) one committed answer per question Q1–Q5, or an explicit tie with the tie-breaker named; (b) **the producer's module boundary and signature written out as TypeScript an implementer can paste and fill in**; (c) an enumerated risk list with mitigations, including what breaks if the native chat pane later disagrees with this shape; (d) explicit dissents preserved — do not average away disagreement.

The council **fails** if it returns a survey without commitment, if it answers Q1 without addressing whether `startApiSession` stays a dead declaration, or if it achieves unanimity by dropping the rubric.

## 10. Required output format

```
## Per-model positions
<model>: Q1 <A|B|C|D|hybrid(named)> / Q2 <in|out|named shape> / Q3 <correct|replace> / Q4 <scrub|bypass> / Q5 <none|named>
  — <2-4 sentence rationale>
  — Strongest counterargument to my own choice: <1-2 sentences>

## Council synthesis
Q1: <choice> (<unanimous | majority N-of-M>) — <3-6 sentences>
Q2: <ruling> (<vote>) — <2-4 sentences, restore consequence stated>
Q3: <ruling> (<vote>) — <2-4 sentences; if replace, the verbatim interface>
Q4: <ruling> (<vote>) — <2-4 sentences, threat model named>
Q5: <ruling> (<vote>)

## The producer (verbatim TypeScript, implementable)
<module path, exported signature, and the ApiSessionHandle it returns>

## What Phase 3b implements vs declares
<bullets>

## Risks & mitigations for the winner
<enumerated>

## Dissents preserved
<model>: <position> — <why it should be revisited if X happens>

## Action items for implementation
<enumerated, each one checkable>
```
