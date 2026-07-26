# Task 3b-1 — The API-Mode Session Primitive

_Phase 3b, Task 1 of 4. Opens the phase. **No council code lands in this task.**_

## Source Of Truth

- `docs/Features/Foundation/Tasks/Phase-3b-Overview.md` — the phase contract, the file-ownership matrix, the gates, the standing conditions.
- `docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-3b-1.md` — **governs exact contents.**
- `docs/Features/Foundation/CouncilBriefs/CouncilBrief-3b.0-Findings.md` — **the rulings bind.** Its verbatim TypeScript does **not** — see **D63 resolutions (a)–(g)** (Matthew-ratified 2026-07-26), which correct four compile errors and add three gaps.
- Roadmap §6: **D45** (the four binding mitigations), **D46** (why `sessionOutput.ts` exists), **D58** (how a key-bearing call is admitted), **D60** (the credential-class invariant), **D63** (this task's council ruling).
- `CLAUDE.md` — locked stack; **D1** Zod-in-main; **D14** plain-object IPC.

## Initial Starting Point

Verified by the coordinator **2026-07-26 at `341ea5c`**. Anchor edits to **named symbols**; line numbers below are quoted only where this doc asserts a specific fact.

- **`src/main/adapters/types.ts`** declares `ApiSessionHandle` (`sessionId` / `send(message): Promise<void>` / `receive(): AsyncIterable<string>` / `dispose(): Promise<void>`), `ApiLaunchSpec` (`sessionId`, `modelId`, `credential`, `systemPrompt?`), `ApiAgentAdapter` (with `getModels` and `startApiSession`), and `ResolvedCredential` — which is **`{ envVarName, value, isSecret: true }`**. **⚠ The token is `.value`. There is no `.key` field** (D63(c) corrects the findings on this).
- **`getModels` and `startApiSession` have ZERO implementations.** `isApiAdapter` exists and nothing calls it.
- **`src/main/adapters/registry.ts`** is `Readonly<Record<AgentKind, AgentAdapter>>`, frozen, two entries. **Untouched by this task.** `agentKindSchema` stays `z.enum(['claude','codex'])`.
- **`src/main/services/sessionOutput.ts`** — `createSessionOutput({ secrets, maxChars, flushMs, onText })` → `{ ingest, flush, buffer, dispose }`. Free of electron and node-pty. Its header already names api mode as the second driver. **This is the seam; do not build beside it.**
- **`src/main/services/scrubber.ts`** — `createScrubber(secrets)` → `{ push, flush, pendingLength }`. **`Scrubber` is exported from HERE, not from `sessionOutput.ts`** (D63(a)). Its stated invariant (`scrubber.ts:50–51`): *the concatenation of every `push()` return, followed by `flush()`, equals the concatenation of every input chunk with secrets replaced* — **proven for ONE scrubber, not a chain.**
- **`src/main/services/modelCatalog.ts`** — the transport precedent: `FetchLike` / `FetchResponseLike` / `FetchInitLike` type aliases, `MODELS_RESPONSE_CAP_BYTES = 8_000_000`, a `readCapped(res, capBytes)` that cancels the reader on overflow, `refuse()` applying `scrubSecrets` on the way out, and refusals ordered **before** any decryption.
- **`src/main/services/openrouterKeys.ts`** — injected `fetchImpl`, 10 s timeout, `Result<T> = {ok:true;value:T} | {ok:false;reason:string}`, and a **decrypt-per-use thunk** rather than a cached string.
- **`src/main/ipc.ts`** — `resolveCredential(profileId, agent)` nested in `registerIpc`: five ordered refusals, label-only messages, the **management refusal before decryption**, returning `{ ok, credential, route, authType }`. **You add a caller. You do not fork it.**
- Counts: `ipcMain.handle(` = **41**, `IpcChannel` = **44**. Tests **702 across 24 files**. Migrations **v1–v10**.

## Goal

Give Chorus the ability to hold a conversation with a model over HTTP — **one module, one primitive, no council** — so that the council in 3b-3 and the native chat pane in a later phase are two consumers of one mechanism rather than two mechanisms.

The deliverable is `createApiSession()`: a factory that takes a resolved credential and a model id, POSTs to an OpenAI-compatible chat-completions endpoint with `stream: true`, and hands back an `ApiSessionHandle` whose `receive()` yields content deltas. Its output is scrubbed and buffered by **the existing `sessionOutput.ts` seam**, driven by the caller.

### ⚠ The one-sentence version of why this task exists alone

**A primitive adopted by four consumers is worth proving with one.** 3b-1 ships the transport and drives it live with a single member answering a single prompt. If the shape is wrong, it is wrong in one file with one caller, not woven through a council orchestrator.

## The D63 ruling, restated as build instructions

1. **The producer is a standalone factory outside the registry.** `src/main/services/apiSession.ts`. Not an adapter, not registered, not in `agentKindSchema`.
2. **`ApiAgentAdapter.startApiSession` stays declared and dormant**, gains a `@deferred` docstring pointing at Phase 3d and at CR-3b.0, and gains a **compile-time assertion** that the factory remains signature-compatible with it. The point is that the eventual lift is a one-line delegation, and that the two cannot silently drift apart in the meantime.
3. **`dispose()` is the SOLE cancellation mechanism**, and the interface must **say so in a docstring** rather than leave it implicit. Internally that is an `AbortController` whose `abort()` `dispose()` calls.
4. **⚠ The factory does NOT take a scrubber** (D63(d)). Scrubbing happens at the **consumer**, driving `createSessionOutput().ingest()` from `for await (… of handle.receive())`. A scrubber inside the factory would be a second scrub path — the exact shape `sessionOutput.ts` was extracted to prevent — and would chain two carries through one stream, breaking an invariant proven for one.
5. **Byte AND wall-clock caps** (D63(e)). One minted key per run caps *spend*, not *volume*; a model streaming indefinitely under the cap is unbounded. `MODELS_RESPONSE_CAP_BYTES` is the precedent for the byte half; the wall-clock half is new and is this task's own ruling to make.

## Exact Scope

| Action | File | What |
|---|---|---|
| **CREATE** | `src/main/services/apiSession.ts` | `createApiSession(spec, deps): ApiSessionHandle`, SSE decoding, caps, abort. **No electron import. No storage import. No Zod.** |
| **CREATE** | `src/main/services/apiSession.test.ts` | The unit table (see Test Expectations). |
| **EDIT** | `src/main/adapters/types.ts` | `@deferred` docstring on `startApiSession`; the cancellation docstring on `ApiSessionHandle`; the signature-compatibility assertion. **No behavioural change, no new interface.** |
| **EDIT** | `src/shared/ipc.ts` | **One** channel + request/response schemas for the live proof (`api:probe` — see below). |
| **EDIT** | `src/main/ipc.ts` | **One** handler, reusing `resolveCredential`, driving the factory through `createSessionOutput`. |
| **EDIT** | `src/preload/index.ts` | One Zod-free typed forwarder. `index.d.ts` is never hand-edited. |
| **CREATE (untracked)** | `_verify/3b-1/` | Drive scripts. `_verify/` is entirely gitignored. |

### On `api:probe` — a deliberately temporary surface

The factory needs a live proof and has no consumer until 3b-3. Rather than leave it unexercised for two tasks, this task ships **one** IPC channel that runs a single message through it and returns the assembled text.

**It is scoped as a proof, not a feature:** no renderer UI, no palette entry, no store action beyond what the drive needs. **Task 3b-3 either adopts it or deletes it, and 3b-3's doc must say which.** Shipping a channel with no caller is how dead surfaces are born, so this one is labelled at birth.

## Non-Goals

- **NO council code.** No `councilService.ts`, no `councilCore.ts`, no member schema, no protocol. That is 3b-2 and 3b-3.
- **NO migration.** `MIGRATIONS.length` is 10 before and after. The phase's only migration is 3b-2's v11.
- **NO registry change.** `agentKindSchema` stays `'claude' | 'codex'`; `staticRegistry` stays frozen; **`src/main/adapters/` diff is limited to `types.ts` docstrings and one type-level assertion** — no adapter implementation file may change.
- **NO `startApiSession` implementation.** It stays dormant. Implementing it *is* the registry lift, and D52 gives that to Phase 3d.
- **NO `SessionManager` change.** Zero lines. An api session is not a `PtySession`, writes no `sessions` row, and is invisible to `restore()` (D63 Q2).
- **NO second scrub path** (D63(d)). The factory holds no `Scrubber`.
- **NO `getModels` implementation** — 3a-4's `model_catalog` owns model listing and D56 says the catalog is never authoritative. Do not create a second home.
- **NO conversation persistence.** No transcript table, no `sessions` row, no `dispatches` row. 3b-3 decides what a council run persists.
- **NO retry, no backoff, no fallback provider.** A failed call returns a refusal. Retry is a policy decision with cost consequences and has no owner yet.
- **NO new npm dependency.** SSE is parsed by hand from the response stream; `fetch` is injected.
- **NO minting.** One minted key per *run* is D64(2) and belongs to 3b-3, which owns the run concept. This task uses the standing `OR milestone key` directly, exactly as a launch does.
- **Do not revert, stage, or delete** `TASK-3-5-REVIEW-FABLE.md` or `TASK-3-6-REVIEW-FABLE.md`, and touch nothing under `_verify/` or `docs/` beyond this task's own artifacts.

## Dependencies

**Phase 3a complete** (`341ea5c`). Nothing else. This task is the phase's floor.

### ⚠ D4 obligations — what is owed at execution

The council's implementation sketch names OpenRouter's chat-completions endpoint and an SSE stream shape. **None of that is verified against the live API**, and D4 binds:

1. **Confirm the endpoint and request shape** against OpenRouter's own current documentation — path, whether `stream: true` is the correct flag, and the exact SSE framing (`data: ` prefix, `[DONE]` sentinel, whether comment/keep-alive lines appear).
2. **Confirm where token usage arrives on a STREAMED response.** D64(2) depends on per-member `usage`, and on many OpenAI-compatible APIs `usage` is absent from streamed chunks unless a `stream_options` flag is set. **If it cannot be obtained from the stream, say so and report it** — 3b-3's cost model depends on the answer, and discovering it there is more expensive than discovering it here.
3. **Confirm the error-body shape** so a refusal can be worded without echoing a key.

**Record each answer with its source in the report.** A guess repeated as fact is what D4 exists to prevent.

## Step-by-step Work

1. **D4 first, before writing the transport.** Answer the three obligations above; they determine the request body and the usage plumbing.
2. **Write `apiSession.ts`'s pure surface and its test table before wiring anything.** The SSE line decoder is the part most likely to be subtly wrong (multi-byte characters split across chunk boundaries; `data:` lines split across reads) and it is pure, so it is cheap to test exhaustively.
3. **The factory body.** `AbortController` at construction; `dispose()` aborts then awaits teardown; `receive()` yields deltas; both caps enforced in the read loop.
4. **`types.ts`** — the two docstrings and the assertion. **If the assertion does not compile, the factory signature is wrong** — fix the factory, not the assertion.
5. **The `api:probe` channel**, reusing `resolveCredential` and driving `createSessionOutput`. Outbound `.parse` on the response, like every other handler.
6. **Tests, then the gates.**
7. **The live drive (G2)** and the five-surface-style key check.

## Test Expectations

Unit, in `apiSession.test.ts`, all with an injected `fetchImpl` and **no network**:

| # | Case | Assertion |
|---|---|---|
| 1 | SSE frames arriving one per read | `receive()` yields each delta in order |
| 2 | One SSE frame **split across two reads** | yields once, correctly assembled |
| 3 | Two frames in **one** read | yields twice |
| 4 | A multi-byte UTF-8 character split across reads | not corrupted (streaming `TextDecoder`) |
| 5 | Keep-alive / comment lines | ignored, no empty yield |
| 6 | `[DONE]` sentinel | iteration completes |
| 7 | Byte cap exceeded | iteration ends, reader cancelled, refusal surfaced |
| 8 | Wall-clock cap exceeded | same |
| 9 | `dispose()` mid-stream | request aborted, iteration ends, no further yields |
| 10 | Non-2xx response | refusal whose message contains **no** part of the credential |
| 11 | Malformed JSON in a frame | refusal, not a throw |
| 12 | **The credential never appears in any yielded value, refusal, or thrown message** | asserted over the whole run |

**Case 12 is the one that matters.** A planted key value is checked against every string the module produces.

**Also required:** a **type-level** test asserting `createApiSession`'s signature stays compatible with `ApiAgentAdapter.startApiSession` (D63 risk 1's mitigation), so the dormant declaration cannot drift.

## Verification Commands

```powershell
npm run typecheck
```
```powershell
npx vitest run
```
```powershell
npm run grep:secrets
```

**Baseline to beat:** typecheck **0** · vitest **702/702 across 24 files** · grep:secrets **clean (6 patterns)**.

### Grep gates — run before the commit, quote the counts

- **zero** `vault` in `src/main/services/apiSession.ts`;
- **zero** `Scrubber` / `createScrubber` in `apiSession.ts` (D63(d) — the factory holds no scrubber);
- **zero** `electron` imports in `apiSession.ts`;
- `agentKindSchema` still `z.enum(['claude','codex'])`; `staticRegistry` still two entries;
- **`src/main/adapters/` diff limited to `types.ts`**, and that diff limited to comments plus one type-level assertion;
- `src/main/services/sessionManager.ts` **byte-identical**;
- `MIGRATIONS.length` still **10**;
- `ipcMain.handle(` = **42**; `IpcChannel` = **45**.

### The live drive (G2) — the whole point of the task

Boot against the real DB (`_verify/3a-4/start-realdb.ps1`, copied to `_verify/3b-1/`; **copy `Local State` too** — F31). Then, over CDP:

1. **One `api:probe`** against the standing route — provider **OpenRouter**, credential **`OR milestone key`**, model **`moonshotai/kimi-k3`** — with a short prompt carrying a planted token. **Assert the model's answer comes back and contains the token**, proving the transport end-to-end rather than merely returning 200.
2. **Streaming is real, not buffered.** Assert `receive()` yielded **more than one** chunk for a response long enough to stream. A single-chunk yield is indistinguishable from a non-streaming implementation and would silently fail the chat pane later.
3. **`dispose()` mid-stream actually aborts.** Start a long generation, dispose, and assert the request terminated rather than running to completion in the background — an unaborted request keeps spending.
4. **The key is nowhere it should not be.** Walk the process tree from the electron main PID via `ParentProcessId` (**never name-matching** — `_verify/3a-3/find-child-pids.ps1` is the proven walker) and assert **no command line holds the key or any ≥ 8-character substring of it**. Note the asymmetry from a PTY launch, and state it: **an api session injects nothing into any child environment**, so unlike Task 3-6 there is no positive half to check — the key exists only in an HTTP header inside main's own process.
5. **The scrub seam is genuinely in the path.** Register a planted secret, have the model echo it back (ask it to repeat a supplied string), and assert the **ingested** text is redacted. This is the only evidence that the consumer wiring is real rather than declared.

### ⚠ Cost envelope

**Under $0.02.** Four short completions at most: the answer drive, the streaming-multiplicity drive, the abort drive (aborted early, so cheaper), and the scrub drive. **Do not press "Test key" on `OR milestone key`.** Report actual cost against the envelope. If a drive needs a fifth completion, stop and ask.

## Acceptance Criteria

1. `createApiSession(spec, deps)` exists at `src/main/services/apiSession.ts`, is electron-free, storage-free and scrubber-free, and returns an `ApiSessionHandle`.
2. `ApiSessionHandle`'s docstring states that **`dispose()` is the sole cancellation mechanism** and that per-operation cancellation is deferred (D63 Q3, with Kimi's dissent named).
3. `ApiAgentAdapter.startApiSession` carries the `@deferred Phase 3d` docstring pointing at CR-3b.0, and **a compile-time assertion ties the factory's signature to it**.
4. All 12 unit cases pass, plus the type-level assertion; **case 12 (no credential in any output) is explicitly quoted in the report**.
5. Both caps are enforced and tested — **byte and wall-clock**.
6. The live drive returns the planted token from the real model, over **more than one** streamed chunk, on the real DB.
7. `dispose()` mid-stream is proven to abort the request.
8. The scrub seam is proven **in the path** by an echoed planted secret arriving redacted.
9. Every grep gate quoted, including the byte-identical `sessionManager.ts` and the two-entry `staticRegistry`.
10. Typecheck 0; vitest **≥ 702 + the new cases**, all green; grep:secrets clean over `src/` **and `_verify/3b-1/`**.
11. Cost reported against the **< $0.02** envelope.
12. The commit message narrates: why the producer sits outside the registry (D63 Q1), why the factory holds no scrubber (D63(d) — with the carry-chaining reason), what the caps are and why one minted key would not have sufficed (D63(e)), the three D4 answers with their sources, and **that `api:probe` is a temporary proof surface 3b-3 must adopt or delete**.

## Review Checklist

1. **Is there exactly one scrub path?** Grep `apiSession.ts` for any scrubber reference. A second one is a D63(d) violation and a D45(1) regression, and it is the single most likely way this task goes wrong while looking right.
2. **Does `dispose()` actually abort the HTTP request**, or merely stop the iteration while the request runs on? Only the runtime drive can tell; a passing unit test with a fake fetch cannot.
3. **Is the SSE decoder correct across chunk boundaries** for both frame splits and multi-byte characters? Cases 2 and 4 are the ones a hand-rolled decoder fails.
4. **Did the D4 obligations get answered from the vendor's documentation**, with sources, or from memory? Check the usage-on-streamed-responses answer especially — 3b-3 depends on it.
5. **Is `src/main/adapters/` diff comments-and-assertion only?** Any behavioural change there is a scope breach.
6. **Was the streaming multiplicity actually asserted (>1 chunk)?** A buffered implementation passes every other check.
7. **Is `api:probe` labelled temporary in both the code and the commit message?**
