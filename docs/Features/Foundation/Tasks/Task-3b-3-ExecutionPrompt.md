# Task 3b-3: `CouncilService`, the Mint, and the Deliberation Protocol — Execution Prompt

## Role

You are the Coordinator for Chorus — Foundation **Phase 3b, Task 3b-3** (the council orchestrator and its protocol). This is **Task 3 of 4** in the phase, **the phase's largest task**, **the phase's only task that carries a mid-task hard stop**, and **the phase's largest cost envelope**.

Repo root: `C:\Projects\ContactEstablished\Chorus`

Expected branch: `main` — confirm with `git branch --show-current`; do **NOT** switch or create branches without instruction.

**Expected HEAD: `fedf9be`** (`Roadmap: the council member this document described is not the one we built…`). The last commit to touch `src/` is **`01556a8`** (Task 3b-2 — the council's schema and Settings surface). Confirm both yourself:

```powershell
git log --oneline -5
```
```powershell
git log --oneline -3 -- src/
```

If `src/` has moved past `01556a8`, **stop and report before writing a line.**

Platform: Windows 11, PowerShell 7.

Chorus is a local-first, BYOK Electron + Vue 3 + TypeScript desktop app for running multiple AI coding agents in parallel terminal panes. Windows-only v1.

---

## Goal

Turn N configured members into a **deliberation**: independent blind positions → cross-critique → disagreement detection → arbiter ruling → synthesized findings with **dissents preserved**. One minted OpenRouter key bounds the whole run. Every message persists. Every member's tokens are attributed from that member's own response.

`council_runs` and `council_messages` were created **empty** by migration v11 (`01556a8`). **This task is their first writer.**

---

## ⚠⚠ READ THIS SECTION BEFORE ANYTHING ELSE — THIS TASK STOPS IN THE MIDDLE

**This task carries Phase 3b's `[CR]` Council Review checkpoint (D64(3)).** The checkpoint was *deferred to this kickoff, not waived*, precisely so a real protocol design would exist to review. It fires **inside** this session.

### What the CR mechanism is (roadmap §4)

Matthew runs a **multi-LLM council** — a Cursor-based setup using several other LLM models for independent review and deliberation. **You cannot run the council.** Your obligations are exactly four:

1. **Flag** when the section meets trigger criteria. (It does. This is pre-identified.)
2. **Prepare a council brief** — the specific design in question, the goals and acceptance criteria it must satisfy, and the specific questions you want answered.
3. **Pause** and prompt Matthew to run the council. **Do not proceed past the checkpoint.**
4. **Record findings** as a numbered decision — unanimous agreement, dissents, and action items — **before continuing.**

### How this task actually runs, in order

1. **Build the mechanism first.** Run assembly, the mint, the orchestration loop, transcript persistence, cost accounting. **All of it is testable against a stub one-round protocol.** None of it depends on the protocol's shape.
2. **Then design the protocol and STOP.** Write the protocol spec — round structure, what "blind" means operationally, how disagreement is detected, when the arbiter is triggered, how dissents survive synthesis.
3. **Author `docs/Features/Foundation/CouncilBriefs/CouncilBrief-3b.1-DeliberationProtocol.md` and PAUSE.** Tell Matthew the brief is ready and that you are stopped at the checkpoint. **Do not implement the protocol past this point.**
4. **When findings arrive, verify them against the code before building on them**, then record them as **decision D67** (**D66 is taken** — see STOP #4; it is this task's own pre-execution decision).
5. **Implement the ruled protocol in `councilCore.ts`.**
6. **Tests, gates, the live drive, the commit(s).**

### ⚠ And the standing lesson that applies to the council reviewing THIS design

**CR-3b.0 is the live precedent and it is recorded in D63:** the council's *rulings* were sound and its *verbatim TypeScript had four compile errors plus three gaps it never raised*, because it had the brief and not the repo. Coordinator resolutions (a)–(g) exist for exactly that reason.

> **A council's output is deliberation, not verified fact.**

That is true of the external council reviewing this protocol, and it is equally true of the feature this task ships. **Verify every finding against the code before implementing it**, and say in your report which findings you accepted, which you corrected, and why.

### The brief's format

Mirror `docs/Features/Foundation/CouncilBriefs/CouncilBrief-3b.0-ApiSessionProducer.md` (249 lines) — read it before writing yours. Its section skeleton is the house form:

1. What Chorus is · 2. Why this decision exists now · 3. Current implementation state (**verified, with commit sha**) · 4. Binding prior rulings — *constraints on your answer, not open questions* · 5. The decision, as named options · 6. Constraints the winner must survive · 7. Evaluation rubric, weighted and ordered · 8. Questions for the council · 9. Success criteria · 10. **Required output format** (which `CouncilBrief-3b.0-Findings.md` then follows: per-model positions, synthesis, dissents preserved, action items).

Findings land at `docs/Features/Foundation/CouncilBriefs/CouncilBrief-3b.1-Findings.md`.

### ⚠ The questions the brief must actually pose

The roadmap's protocol sketch — *independent blind positions → cross-critique round → disagreement detection → arbiter ruling → synthesized findings with dissents preserved* — **is a sketch, not a ruling.** `ImplementationSpec-3b-3.md` §5 is deliberately unfinished and lists what is genuinely open:

| Question | Why it is not obvious |
|---|---|
| **What does "blind" mean operationally?** | All members read the same brief, so they are never fully independent. Is blinding only "cannot see each other's positions", and is that enough to counter the anchoring a shared brief already causes? |
| **How many critique rounds?** | One is cheap and may be shallow; three multiplies cost by three and may only produce agreement-by-exhaustion. **Cost scales linearly with rounds and this phase's envelope is real.** |
| **How is disagreement detected?** | Structurally (positions differ on an enumerated question) or by a model judging? A model judging disagreement is another opinion; a structural check requires the protocol to force enumerable answers. |
| **What triggers arbitration?** | Any disagreement, or a threshold? Does the arbiter run on unanimity — and if not, who notices that the unanimity was wrong? |
| **⚠ How does synthesis preserve dissent?** | **The feature's whole value is here.** A synthesis that averages is worth *less* than one good model, because it launders disagreement into false confidence. Is dissent preserved structurally (a required field the synthesis cannot omit) or by asking the arbiter nicely? |

**Recommended prior, to be ARGUED rather than assumed:** dissent preservation should be **structural** — the synthesis output schema carries a required `dissents` array, and an empty one is valid only when the core *observed* actual unanimity. That makes "dissents preserved" a fact about the code rather than a promise about a prompt. **Take it to the council as a proposal, not a ruling.**

**Also bind the council with F27's wording** (roadmap §5, and the Phase-3b Overview says it must be quoted verbatim wherever a scrub guarantee is worded):

> *Chorus redacts registered exact values on ingest; it cannot redact values an agent derives, and it cannot redact content it was asked to read.*

**Never** "agents cannot echo the key."

### ⚠ G3 is amended for this session: THREE commits (D66)

Precedent: **D46** amended G3 for Task 3-6, and D24 / D32 / D36 / D37 / D54 are the same shape. Here, **in this order**:

1. **The reconcile CHORE commit** — flagged, behaviour-neutral, narrated as a boundary widening. **See STOP #4 / D66.** It lands **first**, before any council key can be minted.
2. **A docs-only commit at the checkpoint** — the brief, the returned findings file, and **D67 recorded in `docs/Features/Foundation/roadmap.md` §6** — so the trail shows the pause happened *before* the protocol was implemented, and the commit order can be checked against it (**Review Checklist item 1**).
3. **The task's code commit** — `src/` only.

**Confirm this with Matthew at the pause anyway**, since the pause is a human checkpoint regardless. **Do NOT push and do NOT open a pull request unless explicitly asked.**

---

## ⚠ STOP — five things that are settled, and getting any of them wrong is the likely failure

### 1. The cap is a PRE-AUTHORIZATION CEILING, not a budget — and F34 sharpens it further

**D64(2)** bounds a run with **one minted key per RUN** carrying a hard `limit`. 3a-3 measured what happens when that cap is sized to *expected spend*: OpenRouter **pre-authorizes each request against the key's remaining limit** and refuses it outright, before any work happens —

```
402 Payment Required: This request requires more credits, or fewer max_tokens.
You requested up to 65536 tokens, but can only afford 46666.
```

That is why `MINT_LIMIT_USD = 1.0` in `attributionCore.ts` and not `0.50`. **A cap set to expected spend does not bound the run; it prevents it.**

**⚠ And F34 (roadmap §5, measured in Task 3b-1) sharpens it again.** `moonshotai/kimi-k3` — **the standing OpenRouter route's configured model, the one every task in this phase reaches for by default** — is a **reasoning** model. OpenRouter charges reasoning tokens as output tokens. Measured: a probe with `max_tokens: 60` returned `usage.tokensOut = 60` — *exactly* the cap — with **zero** `choices[].delta.content` frames and an empty answer. The identical prompt at a 1000 cap answered in 66 output tokens.

`createApiSession` yields only `delta.content` **by design**, so reasoning text is invisible to the consumer while being billed in full. **The run cap must clear reasoning budget + answer, not merely "max output allocation".** A cap sized to the answer buys a paid-for silence that looks exactly like a broken transport.

### 2. Per-member cost comes from each response's own `usage` — never from `attribution:summary`

**F35, measured in Task 3b-1:** `attribution:summary` is **account-scoped and coarsely bucketed**. Asked for the trailing hour during 3b-1's drives it returned **`gatewayTotalUsd: $0.25834` against roughly $0.01 of actual drive spend** — daily bucketing plus unrelated account activity, not a defect. It is correct at the grain it was built for and **wrong at member grain.**

**And the D4 question the task doc leaves conditional is already ANSWERED — do not re-litigate it.** `_verify/3b-1/D4-VERIFICATION.md` obligation 2, verified against OpenRouter's own docs 2026-07-26:

> **YES — usage IS obtainable from the stream, and no request flag is needed.** `usage: {include:true}` and `stream_options: {include_usage: true}` are documented as **deprecated and inert**; full usage is always included on the final chunk. `createApiSession` reads it off any frame carrying one and reports it through `deps.onUsage` (D63(g)).

**D55 still binds, and this is where it bites:** a member whose stream ended *without* a usage frame reports **null, not 0**. 3b-1's drive 3 is the live example — an aborted call delivered no usage frame, so its cost is *genuinely unknown*, bounded only by its `max_tokens`, and the report said so rather than writing a zero. `TokenUsage`'s three fields are all `number | null` for exactly this reason. **A zero that means "not reported" is the confident-looking number D55 exists to forbid.**

`cost_usd` for the run comes from the **minted key's own usage figure** (`readUsage(hash)` → `usageUsd`), which the provider computes — one number, one authority. **`ImplementationSpec-3b-3.md` §8 forbids inventing a token→dollar price table**; if a price source is genuinely needed, that is a decision to raise, not to make (D56's one-home rule).

### 3. Read usage back, THEN revoke — and revoke in a `finally`, on EVERY exit path

Revocation is a `DELETE`, and a deleted key's usage may no longer be readable. **3a-3 established read-before-revoke for exactly this reason.**

Revoke on **success, member failure, user cancel, an exception mid-loop, and app quit**. **A `finally`, not a happy-path call.** An abandoned run leaving a live funded key is the failure the ledger exists to catch, and boot reconciliation is the backstop, **not the plan**.

**⚠ The minted key is registered as a scrubber secret for every member's `SessionOutput`.** That is the D63 Q4 mechanism made real. Omitting it leaves a **wired-but-inert seam that passes every structural check** — which is why 3b-1's drive 5 planted a secret, asked the model to echo it, and asserted the *ingested* text was redacted.

### 4. ⚠ BOOT RECONCILIATION CANNOT SEE A COUNCIL RUN — RESOLVED AS **D66**, AND IT IS YOUR FIRST COMMIT

`Task-3b-3.md` step 2 requires *"boot reconciliation must see an open ledger row (`revoked_at IS NULL`) exactly as a dispatch's does"*, and `ImplementationSpec-3b-3.md` §3(2) calls that predicate *"the open-row predicate boot reconciliation queries — the same definition v8 uses, deliberately."* **Both are FALSE at `01556a8`, and writing the row does not make them true.** Verified by the coordinator 2026-07-26:

- **`storage.ts:1113` `listOpenMintLedger()`** — its own docstring says *"THE BOOT RECONCILE'S INPUT: every OPEN ledger row"* — selects **from `dispatches` only**. A `council_runs` row with `revoked_at IS NULL` is invisible to it.
- **`attributionCore.ts:138`** — `MINT_NAME_PREFIX = 'chorus-dispatch-'`; **`attributionCore.ts:421`** `isChorusMintedName` tests `name.startsWith(...)`; **`attributionCore.ts:443`** `computeKeyReconcile`'s §6.1 matrix **row 4 is FIRST and unconditional** — *"a live key whose name does not start with MINT_NAME_PREFIX produces NO ACTION… nothing below may re-open the question."*
- **`attributionCore.ts:146`** — `DISPATCH_ID_SHAPE = /^[A-Za-z0-9-]{1,64}$/` guards what may be interpolated into a name **sent to a third party**.

**⚠ Both do-nothing options are wrong, in OPPOSITE directions — which is why this was decided for you rather than left to your judgement:**

| If the council key is named… | Matrix row | Outcome |
|---|---|---|
| a **different** prefix (`chorus-council-…`) | **4** | **NO ACTION, forever.** A live, funded key with **no backstop at all** — worse than where `dispatches` stood before 3a-3 built the ledger. |
| the **same** prefix (`chorus-dispatch-…`) | **3** — `revoke-unattributed` | Revoked, but **usage is never read back** (that branch skips `readAndRevoke`, and revocation is a `DELETE`), **`council_runs.revoked_at` stays NULL forever**, and the reconcile **reports it as a mint whose record was lost** — a false statement in the one log that exists to be trusted. |

**D66 (RESOLVED 2026-07-26, coordinator, pre-execution) rules it, in five parts. Read the full decision in `roadmap.md` §6 before implementing.**

**(a) ONE mechanism, not two.** The ownership predicate and the ledger input widen to cover **both tables**. A parallel council reconcile is **rejected** — two reconcilers over one live-key list is how a key gets classified twice, and row 4's prohibition only protects the user's own keys if **exactly one place decides ownership**.

**(b) The council mint gets its own prefix** (`chorus-council-`), with the predicate widened to a **closed, case-sensitive, index-0-anchored SET** rather than a single literal. Reusing `chorus-dispatch-` would put a false statement into a string sent to a third party and make the census log name a run as a dispatch. **`isChorusMintedName`'s three false-positive arguments are unchanged and apply to every member of the set**, and `DISPATCH_ID_SHAPE` travels with it.

**(c) `OpenLedgerRow` is DISCRIMINATED BY KIND**, not by a shared id field. Both id spaces are uuids so collision risk is nil, but a `dispatchId` field holding a run id is **a type that lies** — and `read-and-revoke`'s handler writes `attribution_state` on a `dispatches` row, so pointed at a run id it would silently update **nothing**.

**(d) ⚠ THE ORDERING CONSTRAINT IS INHERITED WHOLE, AND IT IS THE PART MOST LIKELY TO BE GOT WRONG.** `index.ts:259–269` says the position is *"LOAD-BEARING IN BOTH DIRECTIONS"*: reconcile runs **AFTER** `dispatches.healOrphansAtBoot()` (*"run it before the heal and every crashed dispatch still reads as RUNNING, so matrix row 1 never fires"*) and **BEFORE** `sessions.restore(...)`. **A `council_runs` row left `status='running'` by a crash needs the same heal, before the reconcile**, or the classifier reads a dead run as live (row 2) and row 1 never fires — **the reconcile appears to work while doing nothing, on exactly the rows it exists for.** D63 Q2 makes the heal trivially correct: a council writes no `sessions` row and cannot be restored, so **every open `council_runs` row at boot belongs to a run that is already over.**

**(e) It lands as a flagged behaviour-neutral CHORE COMMIT at the head of this task** — the D46 / D54 precedent. It is **provably behaviour-neutral for dispatches today because `council_runs` is empty**, it lands **before the first council key is ever minted**, and it keeps your task commit reviewable as council work.

**Proof obligation:** the existing `attributionCore.test.ts` reconcile cases pass **unchanged** — the matrix is not changing, only its inputs widening — plus new cases placing a council key at each matrix row, plus **the false-positive guard re-asserted for the widened predicate** (`Chorus-Council-…`, `' chorus-council-x'`, `'backup of chorus-council-'`, and a nameless key are all NOT ours). ***A false positive here deletes a credential the user created and depends on, with no notification and no undo.***

**Not licensed by D66:** no retention policy, no council-run pruning, and **no expiry-based classification** — `computeKeyReconcile` still takes no clock, because D4 obligation 5 could not confirm OpenRouter stops honouring a key at `expires_at`.

**Everything else outside your Exact Scope is still a raise, not a licence.** D66 widens the boundary by exactly this much and no further.

### 5. The run sends the MINTED key — so decide, and NARRATE, what happens to the member's own credential

`ImplementationSpec-3b-3.md` §3(3): *"Every member session uses this key, not the member's own stored credential, so the run has one bounded spend surface."* §4's sequence nonetheless opens with `resolveCredential(...)` — *"reused, never forked — 5 ordered refusals, management refused pre-decrypt"*.

Both are right, and the resolution has to be stated rather than left implicit: **`resolveCredential` is reused for its refusals and for the ROUTE**, and the **minted key** is what actually goes into the `Authorization` header. That means a member's own key is decrypted and discarded. **Say so in the commit** — an unremarked decrypt of a credential you never send is exactly the kind of thing a later review has to reverse-engineer.

**And the related question the spec does not answer:** the minted key is an **OpenRouter** provisioning key and authenticates **only** against OpenRouter. **A member whose credential points at a non-OpenRouter route cannot use it.** Recommended, and consistent with step 1's rule: **refuse the run by label at assembly** — never silently drop the member, never silently fall back to that member's own key (which would un-bound the run's spend surface). On the dev DB only the OpenRouter route has a usable credential, so the happy path is unaffected — but the rule must exist in code, not in this paragraph.

---

## ⚠ STOP — F31 is SOLVED and its fix is MANDATORY for any copy-DB work

**`--user-data-dir` reaches the real database but NOT the DPAPI context unless you bring the key with it.**

`safeStorage` blobs are wrapped with **Chromium's OSCrypt key, stored in `<user-data-dir>/Local State`**. Copy `chorus.db` without it and **every pre-existing credential blob is undecryptable** while blobs written in that same boot decrypt fine — an asymmetry that cost Task 3a-3 an hour.

**Copy `Local State` beside the database for every copy-DB run. Treat a credential blob as bound to the user-data DIRECTORY, not just the Windows user.**

**Probe decryptability EARLY.** Precedents: `_verify/3b-1/eval-vault-probe.js`, `_verify/3b-2/eval-vault-probe.js`. Task 3b-1 proved `OR milestone key` decryptable **for free** via `model:refresh` (the unmetered `GET /models`), never via `credential:test` — reuse that trick. **If `OR milestone key` does not decrypt: STOP and ask Matthew to re-enter it through the running app's Settings UI.** That is a **human** step. **Never ask for a key's text in chat, never read it from a file, never accept it in any form, never write it to disk yourself.**

---

## Ground Yourself First

Read these before editing anything. Paths are relative to repo root.

- `CLAUDE.md` — locked stack; **D1** Zod-in-main; **D14** plain-object IPC; secrets via safeStorage, never in argv/logs/transcripts; **D4** verify external API shapes against the vendor's own docs at execution time.
- `docs/Features/Foundation/Tasks/Task-3b-3.md` — **GOVERNS SCOPE.** Read all of it, including the six-item Review Checklist at the end.
- `docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-3b-3.md` — **GOVERNS EXACT CONTENTS.** §1 (the pure/IO split), §2 (run assembly rules), §3 (the mint sequence, five steps each with a failure path), §4 (driving a member, and the three things a rearrangement breaks), **§5 (DELIBERATELY UNFINISHED — the CR checkpoint fills it in)**, §6 (IPC), §7 (verification specifics), §8 (what it deliberately does not decide).
- `docs/Features/Foundation/Tasks/Phase-3b-Overview.md` — the phase contract, the file-ownership matrix, the five gates, the standing conditions.
- `docs/Features/Foundation/Tasks/Task-3b-4.md` — **the NEXT task, read for its BOUNDARY.** File I/O, the brief-path security surface, the sanitization pre-pass and the renderer are all **3b-4's**. This task takes brief **text** and returns findings **text**.
- `docs/Features/Foundation/roadmap.md` — §4 (**the CR mechanism this task must both invoke and productize**), §5 (**F16, F20, F27, F31, F32, F34, F35**), §6 (**D1, D14, D42, D45, D48, D55, D56, D58, D60, D62, D63, D64, D65**), §7 Phase 3b (in particular the *"Owed at Task 3b-3"* bullets under Task 3b-1 and Task 3b-2 — **five owed items in total**).
- `docs/Features/Foundation/CouncilBriefs/CouncilBrief-3b.0-ApiSessionProducer.md` and `CouncilBrief-3b.0-Findings.md` — the brief/findings format you are mirroring, **and the standing example of a council whose code did not compile.**
- `docs/PLAN.md` §4 (adapter abstraction), §6 (credentials/providers/BYOK), §13 (target data model).
- **`docs/Features/Foundation/Tasks/Task-3b-2-ExecutionPrompt.md`** — the immediately prior session's prompt. Its harness caveats are the closest thing to current and its format is the house style for the report you owe. **⚠ It is UNTRACKED — see Pre-Existing Changes.**

### Code to Inspect — anchored to NAMED SYMBOLS

All verified present by the coordinator **2026-07-26 at `01556a8`**. Line numbers appear only where this prompt quotes a specific fact, and were current at authoring time — **re-locate by symbol, do not trust the number.**

**The transport you consume — and must not change**

- **`src/main/services/apiSession.ts`** (576 lines). Read the whole header docblock: it records the D4 verification, why the module holds **no scrubber** (D63(d)), and that the credential appears in exactly one place. Exports: `TokenUsage` (**59**, all three fields `number | null`), `ApiSessionDeps` (**65**), `RESPONSE_CAP_BYTES = 4_000_000` (**129**), `RESPONSE_TIMEOUT_MS = 120_000` (**142**), `createApiSession(spec, deps)` (**197**). On the deps: `baseUrl` (required, no default), `fetchImpl`, `extraHeaders`, `maxResponseBytes`, `maxWallClockMs`, **`maxOutputTokens`** (optional, **deliberately no default** — D65(2), and F34 is what a careless value looks like), **`signal`** (session-scoped external abort — *"it lets an owner, e.g. a council run, abort every member at once without tracking each handle"*), **`onUsage`** (D63(g)), **`onRefusal`** (D65(1)).
- **`src/main/adapters/types.ts`** — `ApiLaunchSpec` (**263**): `{ sessionId, modelId, credential, systemPrompt? }`. `ApiSessionHandle` (**293**): `{ sessionId, send, receive(): AsyncIterable<string>, dispose }`. **`dispose()` is the SOLE cancellation mechanism (D63 Q3)** and the docstring says so. `startApiSession` (**260**) stays **dormant**, bound to the factory by the compile-time assertion at **318** that D65(5) proved actually fails.
- **`src/main/ipc.ts:1986`** — **the `api:probe` handler. THIS IS YOUR REFERENCE IMPLEMENTATION for driving one member**, and it is 60 lines of exactly the sequence `ImplementationSpec-3b-3.md` §4 specifies: `resolveCredential` → `createApiSession` → `createSessionOutput({secrets:[…]})` → `for await (… of handle.receive()) output.ingest(chunk)` → `output.flush()` → `finally { handle.dispose(); output.dispose() }`. Read the docblock above it (**from ~1955**): it numbers the three key-bearing calls and states why D60 is the invariant and not the count.
- **`src/main/services/sessionOutput.ts`** — `createSessionOutput({secrets, maxChars, flushMs, onText})` (**44**). **ONE per member** — a scrubber holds a *carry* across chunk boundaries, so sharing one across members interleaves streams and corrupts both. **`output.flush()` BEFORE persisting**, or the held carry (the partial tail withheld in case it is a secret's prefix) is dropped from the transcript.

**The mint you reuse — and must not fork**

- **`src/main/services/openrouterKeys.ts`** — `createOpenRouterKeyClient(deps)` (**317**); `OpenRouterKeyClient` (**57**) exposing `mint` / `readUsage` / `revoke` / `list` / `queryTokens` / `queryGatewayTotal` / `meta`; `OpenRouterKeyClientDeps` (**74**) with **`getManagementKey` as a THUNK — decrypt-per-use, never cached.** The module header states it is *structurally incapable of inference*; **do not add a completion endpoint to it.**
- **`src/main/services/attributionCore.ts`** — the **PURE** precedent your `councilCore.ts` mirrors. `MINT_NAME_PREFIX = 'chorus-dispatch-'` (**138**), `DISPATCH_ID_SHAPE` (**146**), and the D4-verified mint-body notes at **148–150**.
- **`src/main/services/dispatchAttribution.ts`** — the **I/O** precedent. `MINT_LIMIT_USD = 1.0` (**60**) with the measured `402` argument in its docblock; `MINT_TTL_MS` (**64**); `mintForDispatch` (**137**) — read its failure paths, including *"minted a key with no env var to inject it into; revoking"* and *"a mint that came back WITHOUT a limit is a mint we do not trust"*; `reconcileOrphanedKeys` (**387**).
- **`src/main/index.ts:165–178`** — where `DispatchAttribution` and `createOpenRouterKeyClient` are constructed, including the `managementProfileId()` thunk and the `[attribution] management key configured: <bool>` boot line. **This is where your service gets its key client from; do not build a second one with a second management-key path.**

**Storage — written in 3b-2, first called by you**

- **`src/main/services/storage.ts`** — `createCouncilRun` (**1534**), `getCouncilRunById` (**1541**), `listCouncilRuns` (**1546**), `updateCouncilRun` (**1550**), `deleteCouncilRun` (**1568**, purges its own `council_messages` in one transaction), `appendCouncilMessage` (**1575**), `getCouncilMessagesForRun` (**1585**). Member side: `listCouncilMembers` (**1472**) … `countCouncilMembersForCredential` (**1516**). **Rows in, rows out — every policy decision lives in the caller or in a pure core, never here.**
- **`src/main/services/storage.ts:1113`** — `listOpenMintLedger()`, the boot reconcile's input. **`dispatches` only.** See STOP #4.
- **`src/main/db/schema.ts`** — `councilRuns` carries `id`, `projectId`, `briefPath` **NOT NULL**, `findingsPath` (NULL until 3b-4), `status` **NOT NULL**, `startedAt` **NOT NULL**, `endedAt`, the mint quartet `mintedKeyHash` / `mintedKeyLimit` / `mintedAt` / `revokedAt` (**`revoked_at IS NULL` IS the open-row predicate**), and `tokensIn` / `tokensOut` / `tokensCached` / `costUsd`. `councilMessages` carries `id`, `runId` NOT NULL, `memberId` **nullable** (*"the synthesis and any orchestrator-authored framing have no member to attribute"*), `round` and `phase` **both NOT NULL**, `content` NOT NULL, `tokensIn` / `tokensOut`, `createdAt` NOT NULL. Index `council_messages_run (run_id, round)`.

**The pure cores to mirror**

- **`src/main/services/councilMembers.ts`** (345 lines, 3b-2) — Electron-free, storage-free, `fetch`-free, clock-injected. Exports `resolveMemberModel` (**91** — **D56's order, THE ONLY PLACE IT IS EXPRESSED**), `ResolvedCouncilMember` (**102**), `MemberResolution` (**111**), `resolveCouncilMember` (**143** — the **resolve-time** management refusal), `validateMemberShape` (**226** — the **create-time** one), `defaultMemberLabel` (**293**), `parseMemberParams` (**342**). **`countCouncilMembersForCredential`'s guard already exists; do not add a second one.**
- **`src/main/services/attributionCore.ts` / `modelCatalogCore.ts` / `restore.ts`** — the three other pure-core precedents named in `ImplementationSpec-3b-3.md` §1.
- **`src/main/services/councilMembers.test.ts`** (384 lines, 36 tests) — the test-table style your `councilCore.test.ts` follows.

**IPC**

- **`src/main/ipc.ts:356`** — the nested **`resolveCredential(profileId, agent)`** inside `registerIpc`: five ordered refusals, label-only messages, and the **management refusal BEFORE decryption**. **You reuse it. You never fork it.**
- **`src/shared/ipc.ts`** — `IpcChannel` currently holds **49** keys. `CouncilMemberList/Create/Update/Delete` at **126–137**; `ApiProbe: 'api:probe'` at **169**; the 3b-1 probe schemas at **1491–1565** with their own header saying *"a DELIBERATELY TEMPORARY proof surface … 3b-3 adopts this or deletes it."* `councilRoleSchema` (**466**), `councilMemberWireSchema` (**494**, `.strict()`).
- **The broadcast precedent for `council:progress`:** `IpcChannel.SessionData` (`src/shared/ipc.ts:35`), emitted by `win.webContents.send(IpcChannel.SessionData, event)` (`src/main/ipc.ts:2332`), subscribed via `onSessionData` in `src/preload/index.ts:259–265` (add-listener returning an unsubscribe closure). **Follow this shape exactly.**
- **`src/preload/index.ts`** — Zod-free typed forwarders only. **⚠ Zod in preload throws `EvalError` under CSP and silently drops events — validate in main only (D1).** `index.d.ts` is never hand-edited.

### Git checks to run first

```powershell
git branch --show-current
```
```powershell
git status --porcelain
```
```powershell
git log --oneline -3 -- src/
```

---

## Pre-Existing Changes — ONE untracked doc file, and it is NOT yours to commit

**`git status --porcelain` at prompt time returns exactly:**

```
?? docs/Features/Foundation/Tasks/Task-3b-2-ExecutionPrompt.md
```

**Plus this file itself** (`docs/Features/Foundation/Tasks/Task-3b-3-ExecutionPrompt.md`) once it exists.

**Do not revert, stage, or commit either.** Execution prompts are committed by the coordinator in their own docs pass (`39b3863`, `7fb15d5` are the precedent) — not by the session they kick off. **Any other dirt you find is something you or a tool created — account for it.**

**Two facts about the tree, verified by the coordinator 2026-07-26:**

1. **`TASK-3-5-REVIEW-FABLE.md` and `TASK-3-6-REVIEW-FABLE.md` DO NOT EXIST.** `Task-3b-3.md`'s Non-Goals and `Phase-3b-Overview.md`'s Standing Conditions both say *"do not touch the two `TASK-*-REVIEW-FABLE.md` files"* — **that instruction is stale.** The only one at the repo root is **`TASK-3-4-REVIEW-FABLE.md`, which IS tracked and committed.** Leave it alone; do not go looking for the other two and do not recreate them.
2. **`_verify/` is entirely gitignored** (last line of `.gitignore`). Your `_verify/3b-3/` artifacts will never appear in `git status`. That is expected — and it also means **`npm run grep:secrets` is the only thing standing between a `_verify/` artifact and a leaked key**, and that script does scan `_verify/`.

**Still true and still binding:** the `wt-24b5c1fe` worktree fixture — directory `C:\Projects\ContactEstablished\.chorus\Chorus\wt-24b5c1fe`, row id `9ba9b0da-cecd-4960-815d-f36166cf8c00`, branch `chorus/Chorus/24b5c1fe`. **Row, directory and branch all stay.**

**D40: stage scope files EXPLICITLY by path; never `git add -A`.**

---

## Decisions You Must Honour — all RESOLVED, none open

**The `[CR]` protocol checkpoint is the one deliberately-open item, and D64(3) is itself a RESOLVED decision mandating the mid-task pause.** Everything below is settled.

- **D1 / D14 (RESOLVED 2026-07-19)** — Zod in **main only**; **plain-object IPC**. A Pinia object is a Vue reactive Proxy; structured clone rejects it with **`Error: An object could not be cloned`** and **no compile-time signal**. Snapshot with `JSON.parse(JSON.stringify(x))` and runtime-verify every new renderer→main payload.
- **D42 (RESOLVED 2026-07-24)** — **OpenRouter is Chorus's single gateway**, and attribution is keyed on **auth mode** (`AuthMethodDefinition.type`), never on the gateway or on "does this carry a base_url". The **Management API key is a distinct, higher-privilege credential class** — it mints keys but **cannot do inference**.
- **D45(2) (RESOLVED 2026-07-24, half DISCHARGED by 3b-1, this half UNCHANGED)** — **the council must be an ORCHESTRATOR OVER `ApiSessionHandle`, never a parallel implementation.** This phase's machinery becomes the de-facto api-mode machinery for the whole app, including the native chat pane. **Building a council-shaped API client beside the factory forks the mechanism** — and the blind-round batch shape and the interactive-chat shape are not the same, which is exactly how the fork gets justified. *(D45(1), the ingest-scrub seam, was discharged live by 3b-1 over 19 streamed chunks.)*
- **D48 / D56 (RESOLVED 2026-07-24 / 2026-07-25)** — **the ROUTE's one home is `provider_configs`**, and the model-precedence order is **(1) the member's own `model` · (2) `provider_configs.model` · (3) nothing**. `model_catalog` is **never** authoritative. **Computed at resolve time, NEVER back-written** to the member row — that is how the second home D48 forbids gets created by accident. `resolveMemberModel` is the only place the order is expressed; **do not write a second one.**
- **D55 (RESOLVED 2026-07-25)** — **no number without its denominator, enforced by the SCHEMA rather than by discipline.** `attention:summary` carries no `minutes` field at all; a denominator-less response **fails the outbound `.parse` in main**. **Your run record inherits this:** a `cost_usd` must carry what it is a cost *of* — how many members answered, how many refused, and whether usage was reported or absent.
- **D58 (RESOLVED 2026-07-25)** — **any key-bearing call is admitted numbered, constrained and narrated — never slipped in.** The count today is three: `credential:test`, `model:refresh`, `api:probe`. Your council run is the fourth path a stored inference credential travels, and it inherits the same terms: **user-initiated only, decrypt at the moment of the call and drop it, refused for a profile carrying `unavailable_since` by label without re-attempting decryption, refused outright on a `management` route.**
- **D60 (RESOLVED 2026-07-26)** — **the guarantee is stated by credential CLASS, not by call-site count:** *no code path reachable without a user gesture may resolve a **LAUNCH** credential.* **⚠ Never restate it as a count** — a phase-level security sentence naming call-site counts goes stale the moment any task adds a caller, **and a stale invariant is worse than a loose one because it will be cited as proof.** The management class is separately admitted to unattended boot-time resolution on four constraints.
- **D62 (RESOLVED 2026-07-26, AMENDED 2026-07-26 by 3b-2)** — the three-way FK ruling: `council_members.credential_profile_id` **REAL `REFERENCES`, RESTRICT**; `council_runs` **ZERO**; `council_messages` **ZERO**. Verified by `PRAGMA foreign_key_list` as **1 / 0 / 0**. **F16 is a ground fact: SQLite foreign keys are ENFORCED on this machine.** Because SQLite will not cascade a soft pointer, `deleteCouncilRun` purges its own messages transactionally. **The management refusal exists at two named call sites and must fire a THIRD time — in your run-assembly path.**
- **D63 (RESOLVED 2026-07-26; resolutions (a)–(g) Matthew-ratified)** — CR-3b.0's ruling. Binding here: **Q2 OUT** — a council member **never enters `SessionManager`**, writes **no `sessions` row**, and therefore the boot restore engine **structurally cannot** resurrect a run; a crashed run is lost, **deliberately**. **Q3** — `dispose()` is the sole cancellation mechanism. **Q4 SCRUB** — api text routes through `createSessionOutput().ingest()` with the minted run key registered as a secret, **and the coverage claim is bounded in the same breath**. **(d)** — the factory holds **no** scrubber; the consumer scrubs; **one seam**. **(g)** — usage arrives via `onUsage` on the deps, never through the text stream, because a final text yield would flow through the scrubber and the ring buffer and be rendered as though the model had said it.
- **D64 (RESOLVED 2026-07-26)** — **(1)** the council surface is a **view/route**, not a layout pane, which keeps **D45(3) entirely out of this phase**. **(2)** **one minted key per RUN** with a hard cap that must clear **max output allocation**, not expected spend. **(3)** the protocol `[CR]` is **deferred to this kickoff, not waived.** **Also inherited: `usage_records` IS A DEAD NAME** — superseded by `dispatches` plus 3a-3's mint ledger. Any doc citing it is citing a table that does not exist.
- **D65 (RESOLVED 2026-07-26)** — 3b-1's five ratified deviations, including **`onRefusal`** and **`maxOutputTokens`** on `ApiSessionDeps`, and **(5)**: a type-level assertion of the form `… ? true : never` **compiles vacuously**. The shipped form constrains it (`type _Assert<T extends true> = T`) and was **verified to actually fail in both directions.** **A type-level assertion that cannot fail is worse than no assertion, because it gets cited as proof.**
- **D66 (RESOLVED 2026-07-26, coordinator, pre-execution)** — **the boot reconcile's ownership predicate and ledger input widen to cover council runs, as a flagged chore commit at the head of THIS task.** Five parts, all in **STOP #4** above and in full in `roadmap.md` §6: one mechanism not two · a distinct `chorus-council-` prefix in a closed case-sensitive set · the ledger row discriminated **by kind**, never by a shared `dispatchId` · **the `healOrphansAtBoot`-then-reconcile ordering inherited whole**, extended to council runs · and the chore lands **first**, before any council key exists. **It also amends G3 for this session to THREE commits.** **⚠ It is the second time this phase has produced the same standing lesson:** a task doc that asserts an existing mechanism *already* covers a new table is asserting something about **code the task does not own** — `Task-3b-3.md` and its spec both did, in good faith, and both were wrong.
- **F27 (2026-07-24)** — the only honest redaction wording any doc, commit, or brief in this phase may use: *"Chorus redacts registered exact values on ingest; it cannot redact values an agent derives, and it cannot redact content it was asked to read."*

---

## Implementation Scope

**`Task-3b-3.md`'s Exact Scope governs; `ImplementationSpec-3b-3.md` governs contents. This is the summary.**

**Commit 1 — the D66 chore, on its own, first:**

| Action | File | What |
|---|---|---|
| **EDIT** | `src/main/services/attributionCore.ts` (+ test) | The ownership predicate widened to a closed prefix **set**; `OpenLedgerRow` discriminated **by kind**; `buildMintRequest` generalised to carry either id under its existing shape guard. **The §6.1 matrix itself does not change.** |
| **EDIT** | `src/main/services/dispatchAttribution.ts` | `reconcileOrphanedKeys` feeds the widened inputs and routes `read-and-revoke` to the right table by kind. |
| **EDIT** | `src/main/services/storage.ts` | The reconcile input unions both tables; the council-run heal (`status='running'` → closed at boot). |
| **EDIT** | `src/main/index.ts` | The council heal called **before** `reconcileOrphanedKeys`, beside `dispatches.healOrphansAtBoot()`. |

**Commits 2 and 3 — the checkpoint docs, then the task:**

| Action | File | What |
|---|---|---|
| **CREATE** | `src/main/services/councilCore.ts` | The **PURE** protocol state machine. Electron-free, storage-free, `fetch`-free, clock-injected. Surface per spec §1: `CouncilPhase` (`'positions' \| 'critique' \| 'arbitration' \| 'synthesis' \| 'done'`), a `CouncilAction` union (`ask` / `complete` / `abort`), and **`nextAction(state): readonly CouncilAction[]`**. **Returning an ARRAY is what makes a blind round expressible** — every member is asked simultaneously and none sees another's answer, a property of the *shape* rather than of a comment asking the implementer to be careful. Also `assembleRun(members, briefText)` per spec §2. **Every policy decision lives here.** |
| **CREATE** | `src/main/services/councilCore.test.ts` | The unit table — see Test Expectations. |
| **CREATE** | `src/main/services/councilService.ts` | The orchestrator, **I/O ONLY**. Assembles the run, mints and revokes the key, drives `createApiSession` handles through `createSessionOutput`, persists messages, reports progress. **It contains no `if` that decides what happens next in the deliberation.** |
| **EDIT** | `src/main/services/storage.ts` | Wire the run/message accessors written in 3b-2. Any new accessor is rows-in/rows-out. |
| **EDIT** | `src/main/ipc.ts` / `src/shared/ipc.ts` / `src/preload/index.ts` | `council:start` (brief **TEXT**, not a path), `council:cancel`, and a `council:progress` **broadcast** carrying `{ runId, phase, round, memberId, delta }`. **Plus the `api:probe` adopt-or-delete decision.** |
| **EDIT** | `src/shared/ipc.test.ts` | Schema coverage. |
| **CREATE (untracked)** | `_verify/3b-3/` | Drive scripts, dumps, logs. Gitignored. |
| **CREATE (docs, checkpoint commit)** | `docs/Features/Foundation/CouncilBriefs/CouncilBrief-3b.1-DeliberationProtocol.md` | The brief. |
| **EDIT (docs, checkpoint commit)** | `docs/Features/Foundation/roadmap.md` | **D67** — the recorded findings. |

### `council:progress` is a broadcast, and its payload is SCRUBBED

Following `session:data`. **Its text comes from `SessionOutput`'s `onText` — never from the raw stream.** Wiring it to the raw stream would bypass the seam at the last possible moment, which is exactly where it would be least visible in review (**Review Checklist item 3 of Task 3b-4**, and the same trap here).

All Zod in main (**D1**); plain objects across the bridge (**D14**); **outbound `.parse` on every response.**

### `params_json` is WRITE-ONLY INBOUND

3b-2 made it settable at create and **never echoed on the wire** — so it is **not editable after creation**, and you read it from the **row** via storage, never from a wire payload. `parseMemberParams` (`councilMembers.ts:342`) parses it defensively (degrades to `{}` on corruption). **`ImplementationSpec-3b-2.md` §8 left it deliberately open: you decide which parameters are actually sent.** Decide it and say so.

If a change seems to require another file — **especially `sessionManager.ts`, `apiSession.ts`, `sessionOutput.ts`, `scrubber.ts`, `vault.ts`, `registry.ts`, or any adapter implementation — stop and raise it.** That is a scope signal, not a detail. **D66 widened the boundary by exactly the four files in commit 1 and no further** — and those four are for **commit 1 only**. If commit 3 needs to touch `dispatchAttribution.ts` or `attributionCore.ts` again, that is a new raise.

---

## Strict Non-Goals

- **NO renderer file.** The view is 3b-4. Progress is emitted; nothing renders it yet.
- **NO file I/O.** The brief is read and the findings are written in **3b-4**. This task takes brief **text** and returns findings **text**.
- **NO migration.** **v11 was the phase's only one**; `MIGRATIONS.length` stays **11** and `sqliteTable(` stays **15**. No drizzle-kit (**D7**), no generated migration file.
- **NO second api transport.** `createApiSession` is the only producer (**D45(2)/D63**). **⚠ A "just for the arbiter" client is the shape this fails in** — it will look like reasonable specialization and it will fork the mechanism.
- **NO second scrubber.** Every member's output goes through `createSessionOutput` (**D63(d)**). Zero `createScrubber` outside `sessionOutput.ts`.
- **NO writes to `dispatches`.** A council run is not a PTY dispatch; it has its own table. **No council id smuggled onto a dispatch row.**
- **NO price table.** `onUsage` reports tokens. Converting to dollars needs price data and **D56's one-home rule applies** — if a price source is needed, that is a decision to raise, not to invent.
- **NO retry, no fallback member, no partial-run resume.** A failed member is a **recorded refusal**, and the run continues or aborts by an **explicit rule** — not by improvisation.
- **NO silent member drop.** Refuse by label. **A council that quietly ran with three of five members produces findings nobody can interpret**, and the transcript would not show the absence.
- **NO restore involvement.** No `sessions` row, no `SessionManager` reference, no restore-path change (**D63 Q2**).
- **NO retention policy, no run pruning, no history browser.** `deleteCouncilRun` exists; nothing calls it yet and that stays true.
- **NO change to `agentKindSchema`, `staticRegistry`, or anything under `src/main/adapters/`.**
- **NO new npm dependency.**
- **Do not touch** the `wt-24b5c1fe` worktree fixture or `TASK-3-4-REVIEW-FABLE.md`.

---

## Required Workflow

Work as coordinator: **ground → implement → review the diff against the Implementation Spec → a code-quality pass → resolve findings → run the gates → narrate the commit.** **Do NOT push and do NOT open a pull request unless explicitly asked.**

Ordered work steps (`Task-3b-3.md` §Step-by-step governs):

1. **The reconcile chore FIRST (D66 / STOP #4)** — widen the ownership predicate and the ledger input, discriminate the ledger row by kind, add the council heal before the reconcile. **Existing reconcile tests pass unchanged; new cases per matrix row; the false-positive guard re-asserted.** Gates green, then **commit it on its own**, narrated as a boundary widening.
2. **Run assembly and its rules** (spec §2) — how many members, exactly one arbiter, what happens with **zero members**, **two arbiters**, a member whose credential carries **`unavailable_since`**, and a member on a **`management`** route. **All refusals by label; none silent.** Then the fifth rule STOP #5 adds: a member whose route cannot use the run's minted key.
3. **The mint (spec §3)** — the five-step sequence, each with its failure path written. **Reuse `createOpenRouterKeyClient`; do not fork it**, and mint under the `chorus-council-` prefix commit 1 taught the reconcile to recognise.
4. **The orchestration loop against a STUB one-round protocol**; transcript persistence; `onUsage` per member accumulated into the run's totals. **All of this is testable and shippable before the protocol exists.**
5. **⚠ STOP. Design the protocol, write `CouncilBrief-3b.1-DeliberationProtocol.md`, and PAUSE.** Tell Matthew you are at the checkpoint. **Do not implement past it.**
6. **When findings arrive: verify them against the code**, then record **D67** in the roadmap. Make the docs-only checkpoint commit.
7. **Implement the ruled protocol in `councilCore.ts`.**
8. **Tests, gates, the live drives, the code commit.**

---

## Verification Commands

Run from repo root in PowerShell.

```powershell
npm run typecheck
```
```powershell
npx vitest run
```
```powershell
npm run grep:secrets
```
```powershell
npm run dev
```

**Baseline to beat — coordinator-verified 2026-07-26 at `fedf9be`, by running each command:**

| Gate | Value |
|---|---|
| typecheck | **0 errors** (node + web) |
| vitest | **778 passed / 778, across 26 files** |
| grep:secrets | **clean (6 patterns over `src/`, `scripts/`, `_verify/`, `package.json`, root configs)** |
| `MIGRATIONS.length` | **11** → must stay **11** |
| `sqliteTable(` in `src/main/db/schema.ts` | **15** → must stay **15** |
| `ipcMain.handle(` in `src/main/ipc.ts` | **46** → expect **48** (`council:start`, `council:cancel`); **47** if `api:probe` is deleted |
| `IpcChannel` keys in `src/shared/ipc.ts` | **49** → expect **52** (start, cancel, progress); **51** if `api:probe` is deleted |

**If the handler/channel counts land differently, that is fine — quote what you actually get and explain the delta.** The point is that you counted, not that you hit a predicted number. **`MIGRATIONS.length` and `sqliteTable(` are NOT in that category: any movement there is a scope breach to stop and report.**

### Grep gates — run before the commit, quote every count

- **zero** `fetch(` in `councilService.ts` and `councilCore.ts` — all HTTP goes through `createApiSession` and `openrouterKeys.ts`;
- **zero** `createScrubber` outside `sessionOutput.ts`;
- **zero** `INSERT INTO dispatches` / zero `dispatches` writes in council code;
- **zero** `electron`, `fetch`, storage or clock imports in `councilCore.ts` (it is pure; time is a parameter);
- **`git diff -- src/main/adapters/` EMPTY**; `agentKindSchema` still `z.enum(['claude','codex'])`; `staticRegistry` still **two** entries;
- **`src/main/services/sessionManager.ts` and `src/main/services/apiSession.ts` byte-identical** to `01556a8`;
- **the commit-1 boundary, checked against the DIFF rather than the worktree:** `attributionCore.ts` / `dispatchAttribution.ts` / `index.ts` appear in **commit 1 only**, and `git diff <commit1>..HEAD -- src/main/services/attributionCore.ts src/main/services/dispatchAttribution.ts` is **EMPTY**;
- **the widened predicate is a closed SET, not a loosened test:** zero `.includes(`, zero `toLowerCase()` and zero `RegExp` in the ownership predicate — quote the three false-positive tests that prove it;
- `MIGRATIONS.length` still **11**.

### The live drives (G2) — three, and the second is NOT optional

**Real DB (F20): `C:\Users\matth\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\chorus\chorus.db`.** Electron ignores `APPDATA` but honours `--user-data-dir`; copy `_verify/3b-2/start-realdb.ps1` into `_verify/3b-3/`. **Every dump must quote the `projects` pair `985d547b…` (Chorus) / `f47ac10b…` (Chorus-Second)** — a dump quoting `a43b395d…`/`b684e96e…` is the scratch DB and **discharges nothing.** Drive the window over CDP (`_verify/3b-2/cdp.js`, port 9222).

**⚠ Step 0 — YOU MUST CREATE THE MEMBERS. `council_members` is EMPTY (0 rows), verified 2026-07-26 in `_verify/3b-2/final-restored.json`.** 3b-2's drives created members and cleaned them up. So:

- **There is exactly ONE usable inference credential: `OR milestone key`**, on the **`OpenRouter`** route (`api_key`, `https://openrouter.ai/api/v1`, default model `moonshotai/kimi-k3`). `Claude fake key` carries `unavailable_since` **(a free live fixture for the refusal path)** and `Anthropic direct` has **no base URL**. `OR Management Key` is on `OpenRouter admin` (`auth_mode = 'management'`) — **a free live fixture for the management refusal, and the source of the mint.**
- **Therefore your three members and one arbiter all sit on `OR milestone key` and differ by MODEL**, entered through the Settings model input (free text with an additive `<datalist>` — **D56's third enforcement site; never a closed `<select>`**).
- **⚠ Choose those models deliberately against F34.** `GET /api/v1/models` is **free and unauthenticated** (F32) — `_verify/3b-1/probe-model-params.js` and `probe-cheap-models.js` are the precedent for reading `supported_parameters` and pricing before spending anything. **A reasoning model billing a full cap for an empty answer is the single most likely way this task's envelope is blown.**

**Drive 1 — one real council run** on a **short** brief, three members plus an arbiter. Assert, quoting evidence: the run row **opens and closes**; the key is **minted, used, read back, and revoked** (in that order); every member's messages persist **with round and phase**; token usage attributed **per member**; refusals persisted where any occurred.

**Drive 2 — the ugly path, and it is first-class.** **Cancel a run mid-deliberation** and confirm the key is **still revoked**, the ledger row **closed**, and every in-flight `ApiSessionHandle` **disposed**. **An abandoned run leaving a live funded key is the failure mode 3a-3's ledger exists for.**

**Drive 3 — the invariant proof (D60 / D63 Q2), and it is STRUCTURAL.** After a completed run: **`SELECT count(*) FROM sessions`** unchanged across the run (3b-1's baseline was 20 before and 20 after), **no council row written to `sessions`**, and a **cold boot after the run relaunches nothing** — the boot log showing no restore activity for anything council-related. **This is the strongest form of the guarantee**: not *"restore refuses to relaunch a council member"* but *"there is nothing for restore to find."* Also confirm the run's decrypt(s) happened **with a user gesture** (D60's discriminating probe logs the profile id **and its provider's `auth_mode`** — a raw decrypt COUNT cannot express a class-scoped invariant).

### ⚠ Cost envelope

**Under $0.25 — and it is the phase's largest.** A run is 3–5 members plus an arbiter over a real brief; **a long brief multiplies every member's input tokens.**

- **Use a SHORT brief for every drive.** (The long-brief dogfood run is **3b-4's**, under its own $0.30 envelope.)
- **Report actual cost, per member where the data allows**, from each response's own `usage`, cross-checked against the minted key's `readUsage`.
- **⚠ If a single drive exceeds $0.10, STOP and report before running another.**
- **Do not press "Test key" on `OR milestone key`** — it is a live billable call and nothing here requires it. **3b-1's free decryptability proof via `model:refresh` is the pattern.**

### Harness caveats — verified through 2026-07-26

- **electron-vite does NOT hot-restart the main process**; HMR covers the renderer only. **Every main-process change needs a real cold boot** — and this task is almost entirely main-process.
- **`sqlite3` is NOT installed** — use the `ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe` pattern (`_verify/3b-2/dump-v11.js` is the current example). **Known flake: a dump script writes no file on its first invocation — retry once.**
- **CDP on `--remote-debugging-port=9222`** is the proven driver. **Wrap every `Runtime.evaluate` body in an IIFE** — top-level `const` collides across evaluates.
- **⚠ CDP-driven Vue forms need a microtask tick between `input` and the submit click**, or the click lands on a stale `:disabled` — **a silent no-op that reads exactly like a broken feature. This has caused a failed drive in three separate tasks**, and you are creating four members through that form.
- **⚠ Vite's SPA fallback poisons CDP-driven file reads:** `fetch('some.txt')` inside the page returns `index.html`. Use `fetch('/@fs/C:/absolute/path')`.
- **Graceful quit:** `taskkill` **without** `/F` (WM_CLOSE) does **not** terminate the dev app. Use a CDP `window.close()` evaluate (`_verify/3b-2/eval-quit.js`). Kill process **TREES** with `taskkill /PID <root> /T /F` for crash cases.
- **The dev window is NOT foregrounded by default** and other desktop apps steal foreground mid-run (F29). Foreground deliberately (`_verify/3b-2/focuswindow.ps1`) and verify before any screenshot check.
- All artifacts under `_verify/3b-3/`.

### ⚠ Standing condition — the dev vault holds REAL, BILLABLE credentials

`OR milestone key` (inference) and `OR Management Key` (management). **Never dump, echo, print, copy, or transmit `credential_profiles.encrypted_blob` or `fingerprint_hash`** — select non-secret columns explicitly and prove blob stability with `length(encrypted_blob)`. **No test, fixture, `_verify/` artifact, transcript row, log line, or council message may contain a real credential or key fragment**; `npm run grep:secrets` must pass over `_verify/3b-3/` too. **This task writes model output to disk and to the database — G4 is load-bearing here, not ceremonial.**

---

## Test Expectations

`councilCore.test.ts` covers the protocol as a **pure state machine** — feed it states, assert the next action. Required cases:

- a member **refusing**;
- a member **timing out**;
- **unanimous agreement — does the arbiter still run?** The ruling must be tested **either way**, so the test encodes what was decided rather than what happened to be built;
- **total disagreement**;
- **a synthesis that must preserve a dissent, asserted STRUCTURALLY** — over the shape of the output, not by reading prose;
- run assembly's refusals: zero members, two arbiters, one member plus an arbiter (*not a council — a review, and disagreement detection has nothing to detect*), an unavailable credential, a `management` route, and a route that cannot use the run's minted key.

**And the cost accounting needs D55's discipline, asserted:** a run reporting `cost_usd` must also carry **how many members answered, how many refused, and whether usage was reported or absent.** A total with an unknown denominator is the confident-looking number D55 exists to prevent.

---

## Failure Honesty Clause

If any verification command fails for an unrelated environment reason, **capture the EXACT output, explain it, and DO NOT claim success.** An indeterminate result is reported as indeterminate and the affected acceptance criterion is marked **FAILED** — never reasoned into a pass. **An unproven claim is worse than an honest unknown, because it will be cited later as evidence.** Temporary instrumentation must be reverted, and the review checks the **COMMIT DIFF**, not the worktree.

**Three places this bites hardest in this task:**

1. **A cost figure with no usage frame behind it.** 3b-1 reported a total *"between $0.0085 and $0.0226"* rather than a tidy number, because one aborted drive never delivered usage. **Do the same.** Do not average, do not estimate silently, do not write a zero.
2. **A revocation you did not read back.** "We called revoke" and "the key is gone" are different claims. `readUsage` before, `list()` after, quoted.
3. **A council finding you implemented without verifying.** CR-3b.0's four compile errors are the precedent. **Say which findings you verified, which you corrected, and which you could not check.**

---

## Final Reporting Requirements

Report a status of exactly one of **DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED**, plus:

- **All three commit SHAs, in order, and every file changed**, confirming the scope tables above and nothing beyond them. **The chore must land FIRST and the docs/checkpoint commit must be timestamped BEFORE the protocol implementation** — that is Review Checklist item 1 and it is checkable from the log.
- **The CR checkpoint, discharged in four parts:** the brief was written and named; the session **paused**; the findings were **verified against the code before being built on** (say which you accepted, corrected, or could not check); and **D67 is recorded** in the roadmap with unanimous agreement, dissents, and action items.
- **The pure/IO split, evidenced:** `councilCore.ts` holds **every** protocol decision and `councilService.ts` decides nothing — quote the grep showing no protocol branch in the service.
- **Typecheck / vitest / grep:secrets with actual numbers**, against the **0 / 778-across-26 / clean-6-patterns** baseline. Vitest must be **above** 778.
- **The grep gate counts, each quoted** — zero `fetch(` in the two council files, zero `createScrubber` outside `sessionOutput.ts`, zero `dispatches` writes, empty `src/main/adapters/` diff, byte-identical `sessionManager.ts` and `apiSession.ts`, `MIGRATIONS.length` **11**, `sqliteTable(` **15**.
- **All three drives, each quoted** — especially **drive 2** (cancel → key still revoked, ledger closed, handles disposed) and **drive 3** (the `sessions` count unchanged, no council row, cold boot relaunches nothing, and the decrypts class-discriminated).
- **The mint quartet from a real `council_runs` row** — `minted_key_hash` present, `minted_key_limit`, `minted_at`, and **`revoked_at` NOT NULL after the run** — with the read-back proving revocation rather than asserting it.
- **The cap you chose and WHY**, against F34's reasoning-budget lesson and 3a-3's `402`. State the arithmetic.
- **Per-member token attribution**, and **the D55 denominator with it**: members answered / refused / usage-available.
- **Actual cost against the < $0.25 envelope**, per member where the data allows, and confirmation Test key was never pressed against `OR milestone key`.
- **The `api:probe` decision — ADOPTED or DELETED — stated in the commit message**, with the resulting `IpcChannel` / `ipcMain.handle(` counts. *(Owed since 3b-1 and sharpened at 3b-2.)*
- **The D66 chore, discharged in five parts:** one mechanism (no parallel reconciler) · the prefix **set** with its false-positive tests quoted · the ledger row discriminated **by kind**, with the `attribution_state` write proven to reach the right table · **the council heal running BEFORE the reconcile**, evidenced from a boot log rather than from the code · and the existing `attributionCore.test.ts` reconcile cases passing **unchanged**. **Plus the drive that makes it real:** an open `council_runs` row left behind deliberately, a cold boot, and the key revoked with its usage read back first and `revoked_at` **written**.
- **The management refusal's THIRD call site**, named.
- **Which `params_json` parameters the service actually sends**, and why.
- **Confirmation the minted key was registered as a scrubber secret for every member's `SessionOutput`**, with the call site named.
- **Confirmation each non-goal held:** no renderer file; no file I/O; no migration (`MIGRATIONS.length` 11, `sqliteTable(` 15); no second transport; no second scrubber; no `dispatches` write; no price table; no retry/fallback/resume; no silent member drop; no `sessions` row; no retention policy; `agentKindSchema` and `staticRegistry` unchanged; `src/main/adapters/` untouched; no new dependency.
- **Confirmation `TASK-3-4-REVIEW-FABLE.md` is unmodified and unstaged**, that the **`wt-24b5c1fe` row, directory and branch are intact**, that the **standing fixtures were restored** (providers, credentials, and whatever member rows you decided to leave or remove — say which and dump it), and that **nothing under `_verify/` was staged** and **`Task-3b-2-ExecutionPrompt.md` / `Task-3b-3-ExecutionPrompt.md` were neither staged nor reverted.**
- **Residual risks and known gaps**, and the **final `git status --porcelain`**.
