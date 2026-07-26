# Implementation Spec 3b-1 — The API-Mode Session Primitive

_Governs exact contents for `Task-3b-1.md`. Where this spec and the task doc disagree on **what** to build, the task doc wins; on **how**, this spec wins. Where either disagrees with `CouncilBrief-3b.0-Findings.md`, **D63's resolutions (a)–(g) win** — the council had the brief, not the repo._

## 1. What the council got right, and the seven places it did not

D63 records the rulings as binding and the findings' verbatim TypeScript as non-binding. Implementers will read the findings, so the corrections are restated here in the form of the code they change:

| # | Findings say | Build instead | Why |
|:--:|---|---|---|
| **a** | `import type { Scrubber } from './sessionOutput.js'` | — (dropped entirely; see **d**) | `sessionOutput.ts` does not export `Scrubber`; it is declared at `scrubber.ts:34` and `sessionOutput.ts` merely imports `createScrubber` |
| **b** | `.js` import specifiers | extensionless (`from '../adapters/types'`) | No module under `src/` uses extensions |
| **c** | `spec.credential.key` | **`spec.credential.value`** | `ResolvedCredential` is `{ envVarName, value, isSecret: true }` — there is no `key` field, and this would not compile |
| **d** | `ApiSessionDeps.scrubber: Pick<Scrubber, …>` | **STRUCK** | Contradicts the findings' own Q4 ruling, which puts scrubbing at the **consumer**. Two scrubbers over one stream chain two carries and break an invariant proven for one |
| **e** | (silent) | **byte AND wall-clock caps** | One minted key per run caps spend, not volume or time |
| **f** | "scan the brief for known secret patterns" | reuse `secret-patterns.json` | Already the ONE list shared by `logger.ts` and `scripts/secret-grep.mjs`; a second list lets the gate and the sanitizer test different shapes |
| **g** | (silent) | **`onUsage` on the deps, not on the handle** | See §2 — Q3 ruled the handle correct as declared, but the handle has **nowhere to put token usage**, which D64(2) requires |

## 2. ⚠ The gap Q3's answer left open, and how it is closed without reopening Q3

D64(2) requires **per-member token and cost granularity, read from each response's `usage` block**. D63 Q3 ruled `ApiSessionHandle` **correct as declared** — `sessionId` / `send` / `receive(): AsyncIterable<string>` / `dispose`.

Those two rulings are in tension: **`receive()` yields `string`, so a completed stream has nowhere to report how many tokens it cost.** Neither the brief nor the findings addressed it.

**Resolution (D63(g)): the usage callback lives on `ApiSessionDeps`, not on `ApiSessionHandle`.**

```ts
readonly onUsage?: (usage: TokenUsage) => void
```

This is the correct side of the boundary for a reason worth stating, because the tempting fix is the wrong one:

- **`ApiSessionHandle` is the SHARED primitive** (D45(2)) — the council and the future interactive chat pane both bind to it. Adding a `usage` field there would change the contract Q3 just ratified, and would oblige a chat pane that does not meter anything to carry a field it never reads.
- **`ApiSessionDeps` is the FACTORY's own contract**, not the shared one. A consumer that meters passes `onUsage`; a consumer that does not, omits it. The primitive is untouched.
- It also keeps usage **out of the text stream**, which matters: if usage arrived as a final `receive()` yield, it would flow through the scrubber and the ring buffer and end up rendered in the council transcript as if the model had said it.

**⚠ Whether `usage` is obtainable at all on a streamed response is a D4 obligation, not an assumption.** Many OpenAI-compatible APIs omit `usage` from streamed chunks unless a `stream_options`-style flag is set. **Answer it before building, and if the answer is no, report it** — 3b-3's cost model depends on it, and D64(2)'s per-member granularity may have to come from a follow-up call instead.

## 3. Module surface — `src/main/services/apiSession.ts`

**Exact exported surface.** Types first, so the test file can bind to them.

```ts
import type { ApiLaunchSpec, ApiSessionHandle } from '../adapters/types'
import type { FetchLike } from './modelCatalog'   // reuse; do NOT re-declare

/** Token counts as reported by the provider. All fields nullable: "not
 *  reported" and "zero" are different facts, and D55's denominator rule
 *  applies here too — a confident-looking zero is worse than a null. */
export interface TokenUsage {
  readonly tokensIn: number | null
  readonly tokensOut: number | null
  readonly tokensCached: number | null
}

export interface ApiSessionDeps {
  /** Absolute endpoint base, e.g. `https://openrouter.ai/api/v1`. Required —
   *  there is no default, because a silent default is how a request reaches a
   *  provider the user did not choose. */
  readonly baseUrl: string
  /** Injected for testability, exactly as openrouterKeys.ts and
   *  modelCatalog.ts do. Defaults to global fetch. */
  readonly fetchImpl?: FetchLike
  /** Non-secret provider headers (D33 resolution e). */
  readonly extraHeaders?: Readonly<Record<string, string>>
  /** Hard ceiling on total streamed bytes. Default RESPONSE_CAP_BYTES. */
  readonly maxResponseBytes?: number
  /** Hard ceiling on wall-clock for one send/receive cycle. Default
   *  RESPONSE_TIMEOUT_MS. */
  readonly maxWallClockMs?: number
  /** Session-scoped external abort. NOT per-operation cancellation (D63 Q3):
   *  it lets an owner — e.g. a council run — abort every member at once
   *  without tracking each handle. Linked to the same internal controller
   *  `dispose()` aborts. */
  readonly signal?: AbortSignal
  /** D63(g). Optional because a consumer that does not meter must not be
   *  obliged to carry it. Never routed through receive(). */
  readonly onUsage?: (usage: TokenUsage) => void
}

export const RESPONSE_CAP_BYTES = 4_000_000
export const RESPONSE_TIMEOUT_MS = 120_000

export function createApiSession(spec: ApiLaunchSpec, deps: ApiSessionDeps): ApiSessionHandle
```

**Notes on the constants, because both numbers are judgement calls that should be argued rather than copied:**

- `RESPONSE_CAP_BYTES = 4_000_000` is **half** `modelCatalog`'s 8 MB. A model catalog is a single large JSON document; a council member's answer that exceeds 4 MB of *text* is a runaway, not a long answer. Pick a different number if you can argue it — but pick it deliberately and say why in the commit.
- `RESPONSE_TIMEOUT_MS = 120_000` is **not** `openrouterKeys`' 10 s. A management API call is a round trip; a reasoning model's first token can legitimately take a minute. **The wall clock bounds the whole cycle, not the gap between chunks** — an idle-gap timeout is the more precise instrument and is deliberately not specified here, because it needs a measured idle distribution nobody has yet. State the choice; do not silently make it.

**The factory is synchronous.** It returns a handle immediately; the HTTP request is issued on the first `send()`. The eventual adapter delegation is therefore `async startApiSession(spec) { return createApiSession(spec, deps) }` — the `async` absorbs the sync return, and the assertion in §5 is what keeps that true.

## 4. Internal structure — the four parts, and which one is dangerous

1. **`AbortController`**, created once. `dispose()` calls `abort()` then awaits teardown. `deps.signal` is linked to it (`addEventListener('abort', …)`, removed on dispose so a long-lived external signal cannot retain a dead session).
2. **The request.** `POST ${baseUrl}/chat/completions`, `Authorization: Bearer ${spec.credential.value}`, body `{ model: spec.modelId, messages, stream: true }` plus whatever the D4 pass establishes for usage-on-stream. `spec.systemPrompt` becomes the leading system message when present.
3. **⚠ The SSE decoder — the dangerous part.** It must survive three things a naive implementation gets wrong, each of which produces a bug that is invisible in a happy-path test:
   - **A frame split across reads.** `data: {"choi` / `ces":[…]}\n\n` must yield once. Keep a line buffer across reads; never parse a partial line.
   - **Multiple frames in one read.** Split on the delimiter, not on the read boundary.
   - **A multi-byte character split across reads.** Use a **streaming** `TextDecoder` (`new TextDecoder()` with `{ stream: true }` on each `decode` call). Decoding each `Uint8Array` independently corrupts any character straddling a boundary — and the failure is data-dependent, so it will pass every ASCII test and appear the first time a council member writes an em-dash.
4. **The read loop**, enforcing both caps. On overflow: cancel the reader, abort, end iteration, surface a refusal. **Cancel before abort** so the underlying connection is released rather than left to GC — `modelCatalog.readCapped` is the precedent for the cancel-on-overflow shape, though not for its buffering (it accumulates a whole body; this streams).

**`receive()` returns an `AsyncIterable<string>` that may be consumed once.** Say so in the docstring. A second consumer getting an empty iterable is a confusing failure; a documented single-consumption contract is not.

## 5. `src/main/adapters/types.ts` — three additions, zero behaviour

**Insertion point 1** — on `ApiSessionHandle`, above the interface:

> `dispose()` is the SOLE cancellation mechanism (CR-3b.0 Q3, 2-of-3). Per-operation cancellation — stopping one generation while keeping conversation context — is DEFERRED. Kimi's dissent is preserved in D63: revisit the moment the interactive chat pane design begins, because by then this interface has implementations and adding a parameter is breaking.

**Insertion point 2** — on `ApiAgentAdapter.startApiSession`:

> `@deferred` Phase 3d. The implementation already exists as `createApiSession()` in `services/apiSession.ts`; this declaration stays dormant until the D34-Q5 registry lift (D52), at which point it becomes a one-line delegation. See CR-3b.0 / D63 Q1. The assertion below is what keeps the two signature-compatible in the meantime.

**Insertion point 3** — the compile-time assertion. It must live where **both** types are in scope and must not create a main→services import cycle in the adapter layer; if `types.ts` cannot import the factory without a cycle, **put the assertion in `apiSession.test.ts` instead and say so** — the mitigation is that the drift is caught at typecheck, not where the line sits.

```ts
// Fails to compile if the factory drifts from the dormant declaration.
type _StartApiSessionIsDelegable =
  typeof createApiSession extends (spec: ApiLaunchSpec, deps: never) => ApiSessionHandle
    ? true
    : never
```

**Write the assertion so that it actually fails.** Before committing, deliberately break the factory signature and confirm `npm run typecheck` errors. An assertion that passes vacuously is worse than none, because it will be cited as coverage.

## 6. The `api:probe` channel

`src/shared/ipc.ts`: one `IpcChannel` entry, a request schema `{ credential_profile_id: z.uuid(), model: z.string().min(1), prompt: z.string().min(1).max(4000) }`, and a response schema `{ ok: z.boolean(), text: z.string(), reason: z.string().nullable(), chunks: z.number().int() }`.

**`chunks` exists for the drive**, not for a user: it is how Task 3b-1's acceptance criterion 6 proves the response actually streamed rather than arrived whole. Say so in its comment.

`src/main/ipc.ts`: one handler that (1) `resolveCredential`s — **reused, never forked** — (2) reads `baseUrl` from the resolved route, (3) constructs `createSessionOutput({ secrets: [credential.value], … })`, (4) drives `for await (const chunk of handle.receive()) output.ingest(chunk)`, (5) `output.flush()`, (6) returns `output.buffer` outbound-`.parse`d.

**⚠ The secrets array is what makes the scrub seam real.** Registering `credential.value` is the whole mechanism; omitting it leaves a wired-but-inert seam that passes every structural check. Task 3b-1's drive 5 exists precisely to prove this line is present and effective.

**Label the channel temporary in the code**, not only in the commit message:

> ⚠ TEMPORARY (Task 3b-1). This channel exists to give the api-mode transport a live proof before Task 3b-3 has a consumer for it. **3b-3 must adopt it or delete it** and say which. It is not a product surface: no palette entry, no UI.

## 7. Verification

Beyond the task doc's gates, three runtime checks that a unit test cannot substitute for:

1. **Streaming multiplicity.** `chunks > 1` on a response long enough to stream. A buffered implementation passes every other check in this spec.
2. **Abort actually aborts.** Start a long generation, `dispose()`, and confirm the request terminated — not merely that iteration stopped. Evidence: the provider-side generation stops, or the connection closes. An unaborted request keeps spending after the user has moved on, which is a cost bug wearing a correctness bug's clothes.
3. **The scrubber is in the path.** Ask the model to repeat a planted string registered as a secret; assert the ingested text is redacted. This is the only evidence distinguishing "the seam is wired" from "the seam is declared".

**Every drive runs against the real dev DB** (F20) with `Local State` copied beside it (F31), and every dump quotes the `projects` pair.

## 8. What this spec deliberately does not decide

- **Retry and backoff.** No owner, and a retry policy has direct cost consequences. A failure is a refusal.
- **The idle-gap timeout** (§3) — needs measurement that does not exist.
- **Whether `api:probe` survives.** 3b-3's call.
- **How usage becomes cost in dollars.** `onUsage` reports tokens; converting to dollars needs price data, and **D56's one-home rule applies** — do not invent a second price table beside `model_catalog`. 3b-3 owns that decision.
