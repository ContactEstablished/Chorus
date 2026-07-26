# Implementation Spec 3b-3 — `CouncilService` and the Deliberation Protocol

_Governs exact contents for `Task-3b-3.md`. **§5 is deliberately incomplete** — it is what the `[CR]` checkpoint fills in._

## 1. The split: what is pure and what performs I/O

The whole task hangs on this boundary, and the precedents are `restore.ts`/`sessionManager.ts`, `attributionCore.ts`/`dispatchAttribution.ts`, and `modelCatalogCore.ts`/`modelCatalog.ts`.

**`councilCore.ts` — PURE.** No electron, no `fetch`, no storage, no clock (time is a parameter). Its whole surface is a function from *state* to *next action*:

```ts
export type CouncilPhase = 'positions' | 'critique' | 'arbitration' | 'synthesis' | 'done'

export interface CouncilAction =
  | { kind: 'ask'; memberId: string; phase: CouncilPhase; round: number; prompt: string }
  | { kind: 'complete'; findings: string }
  | { kind: 'abort'; reason: string }

export function nextAction(state: CouncilState): readonly CouncilAction[]
```

Returning an **array** is what makes a blind round expressible: every member is asked simultaneously and none sees another's answer, which is a property of the *shape*, not of a comment asking the implementer to be careful.

**`councilService.ts` — I/O ONLY.** It performs the actions the core returns, persists results, and feeds them back. **It contains no `if` that decides what happens next in the deliberation.** If a protocol decision leaks into the service, the protocol becomes untestable without a network — and the whole reason the core is pure is that a deliberation protocol is exactly the kind of logic that needs exhaustive cheap tests.

## 2. Run assembly

```ts
assembleRun(members, briefText): { ok: true; run: PlannedRun } | { ok: false; reason: string }
```

Rules, all **refusals by label** and none of them silent:

- **Exactly one `arbiter`.** Zero or two is a refusal, not a default-pick.
- **At least two `member`s** — one member and an arbiter is not a council, it is a review, and disagreement detection has nothing to detect.
- **A member whose credential carries `unavailable_since` is a REFUSAL of the run**, not a dropped member. Silently running four-of-five produces findings whose provenance nobody can reconstruct, and the transcript would not show the absence.
- **A member on a `management` route is refused** — the resolve-time half of the two-ended check (D62; `ImplementationSpec-3b-2.md` §4.1 is the create-time half).
- **Model resolution is D56's order**, computed here, **never back-written** to the member row.

## 3. The mint — one key per run (D64(2))

Reuse `createOpenRouterKeyClient` from `openrouterKeys.ts`. **Do not fork it, and do not add a completion endpoint to it** — that module's header states it is *structurally incapable of inference*, which is a property worth keeping.

Sequence, and every step has a failure path that must be written:

1. **Mint** with a hard `limit`. **⚠ The cap must clear the members' combined max OUTPUT allocation, not their expected spend.** 3a-3 measured this the expensive way: OpenRouter pre-authorizes each request against the key's remaining limit and returns `402 … you requested up to 65536 tokens, but can only afford 46666` **before any work happens**. A cap set to expected spend does not bound the run, it prevents it.
2. **Write the ledger row** (`minted_key_hash`, `minted_key_limit`, `minted_at`), `revoked_at` NULL. **`revoked_at IS NULL` IS the open-row predicate** boot reconciliation queries — the same definition v8 uses, deliberately.
3. **Every member session uses this key**, not the member's own stored credential, so the run has one bounded spend surface.
4. **Read usage back, THEN revoke.** Always in that order: revocation is `DELETE`, and a deleted key's usage may no longer be readable. 3a-3 established read-before-revoke for exactly this reason.
5. **Revoke on EVERY exit path** — success, member failure, user cancel, an exception mid-loop, and app quit. **A `finally`, not a happy-path call.** An abandoned run leaving a live funded key is the failure the ledger exists to catch, and boot reconciliation is the backstop, not the plan.

**⚠ The minted key is registered as a scrubber secret for every member's `SessionOutput`.** That is the D63 Q4 mechanism made real; omitting it leaves a wired-but-inert seam that passes every structural check.

## 4. Driving a member

```
resolveCredential(...)        // reused, never forked — 5 ordered refusals, management refused pre-decrypt
  → createApiSession(spec, { baseUrl, onUsage, signal: runController.signal, … })
  → createSessionOutput({ secrets: [mintedKey], maxChars, flushMs, onText })
  → for await (const chunk of handle.receive()) output.ingest(chunk)
  → output.flush()
  → persist council_messages row + accumulate usage
  → handle.dispose()
```

**Three things this sequence gets right that a rearrangement would break:**

- **`output.flush()` before persisting**, or the scrubber's held carry — the partial tail it withholds in case it is the prefix of a secret — is dropped from the transcript.
- **`handle.dispose()` in a `finally`**, or a member that throws mid-stream leaves an HTTP request running and spending.
- **One `SessionOutput` per member**, so one member's carry cannot bleed into another's text. Sharing one across members would interleave streams and corrupt both.

## 5. ⚠ The protocol — PENDING THE `[CR]` CHECKPOINT

**This section is intentionally unfinished.** D64(3) deferred the checkpoint to this task precisely so a real design would exist to review, and filling this in before the council rules would defeat the deferral.

What the brief must settle, and why each is genuinely open:

| Question | Why it is not obvious |
|---|---|
| **What does "blind" mean operationally?** | All members read the same brief, so they are never fully independent. Is blinding only "cannot see each other's positions", and is that enough to avoid the anchoring a shared brief already causes? |
| **How many critique rounds?** | One is cheap and may be shallow; three multiplies cost by three and may only produce agreement-by-exhaustion. **Cost scales linearly with rounds and this phase's envelope is real.** |
| **How is disagreement detected?** | Structurally (positions differ on an enumerated question) or by a model judging? A model judging disagreement is another opinion; a structural check needs the protocol to force enumerable answers. |
| **What triggers arbitration?** | Any disagreement, or a threshold? Does the arbiter run on unanimity — and if not, who notices that unanimity was wrong? |
| **⚠ How does synthesis preserve dissent?** | **The feature's whole value is here.** A synthesis that averages is worth less than one good model, because it launders disagreement into false confidence. Is dissent preserved structurally (a required field the synthesis cannot omit) or by asking the arbiter nicely? |

**Recommended prior for the brief, to be argued rather than assumed:** dissent preservation should be **structural** — the synthesis output schema carries a required `dissents` array, and an empty one is only valid when the core observed actual unanimity. That makes "dissents preserved" a fact about the code rather than a promise about a prompt. **Take it to the council as a proposal, not a ruling.**

## 6. IPC

`council:start` (brief **text**, not a path — file I/O is 3b-4), `council:cancel`, and a `council:progress` event carrying `{ runId, phase, round, memberId, delta }`. All Zod in main; plain objects across the bridge (**D14**); outbound `.parse` on every response.

**The progress event is a broadcast, not a reply**, following `session:data`. Its payload carries **scrubbed** text only — it comes from `SessionOutput`'s `onText`, never from the raw stream. Wiring it to the raw stream would bypass the seam at the last possible moment, which is exactly where it would be least visible in review.

## 7. Verification specifics

- **The invariant proof (D60/D63 Q2):** after a completed run, a cold boot must relaunch **nothing**. Evidence is structural — `SELECT count(*) FROM sessions WHERE …` shows no council row was ever written — plus the boot log showing no restore activity. **This is the strongest form of the guarantee**: not "restore refuses to relaunch a council member" but "there is nothing for restore to find".
- **The cancel path is a first-class drive**, not a nice-to-have: cancel mid-deliberation, assert the key is revoked, the ledger row closed, and every in-flight `ApiSessionHandle` disposed.
- **Usage honesty (D55):** if 3b-1's D4 pass found `usage` unobtainable on streamed responses, the run row records that fact rather than storing `0`. **A zero that means "not reported" is the confident-looking number D55 forbids.**

## 8. What this spec deliberately does not decide

- **The protocol** (§5) — the CR checkpoint owns it.
- **Whether unanimity skips arbitration** — part of the same ruling.
- **Token price → dollars.** `onUsage` gives tokens; dollars need a price source, and **D56's one-home rule means inventing one is a decision to raise, not to make.** Until then `cost_usd` may be read from the minted key's own usage figure, which the provider computes — one number, one authority.
- **Whether `api:probe` survives.** Decide it, and say which in the commit.
