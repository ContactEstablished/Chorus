# Task 3b-3 — `CouncilService` and the Deliberation Protocol

_Phase 3b, Task 3 of 4. **⚠ THIS TASK CARRIES THE PHASE'S `[CR]` CHECKPOINT (D64(3)). It stops mid-task and briefs a council before implementing the protocol.**_

## Source Of Truth

- `docs/Features/Foundation/Tasks/Phase-3b-Overview.md`, and `ImplementationSpec-3b-3.md` for exact contents.
- Roadmap §4 (the CR mechanism — **this task productizes the thing it must also invoke**), §6: **D42** (attribution keyed on auth mode), **D45(2)** (orchestrator over the handle), **D55** (no number without its denominator), **D56** (model precedence), **D58** (how a key-bearing call is admitted), **D60** (the credential-class invariant), **D63** (the primitive), **D64** (run-scoped mint; the deferred CR).
- **3a-3's mint ledger** — `src/main/services/openrouterKeys.ts`, `attributionCore.ts`, `dispatchAttribution.ts`. **Reuse the client; do not fork it.**

## Initial Starting Point

After 3b-2. `createApiSession` exists and is proven live. `council_members` holds real rows; `council_runs` and `council_messages` exist and are **empty** — this task is their first writer. `api:probe` from 3b-1 is still present and **this task must adopt it or delete it, and say which.**

## Goal

Turn N configured members into a deliberation: independent blind positions → cross-critique → disagreement detection → arbiter ruling → synthesized findings with **dissents preserved**. One minted key bounds the whole run. Every message is persisted. Every member's tokens are attributed.

## ⚠ The CR checkpoint — how this task actually runs

**D64(3) deferred the protocol checkpoint to this kickoff precisely so a real design exists to review.** So this task has a hard stop in the middle:

1. **Build the mechanism first** — run assembly, the mint, the orchestration loop, transcript persistence, cost. All of it is testable with a stub protocol that does one round.
2. **Then design the protocol and STOP.** Write the protocol spec — round structure, what "blind" means operationally, how disagreement is detected, when the arbiter is triggered, how dissents survive synthesis.
3. **Flag, brief, pause (§4).** Prepare `CouncilBriefs/CouncilBrief-3b.1-DeliberationProtocol.md` and **do not implement past the checkpoint.**
4. **Record the findings** as a numbered decision before continuing.

**⚠ And verify the findings against reality before building on them.** CR-3b.0 is the standing example: its rulings were sound and its verbatim TypeScript had four compile errors plus two gaps, because it had the brief and not the repo (D63(a)–(g)). **A council's output is deliberation, not verified fact** — that is true of the external council reviewing this design, and it is equally true of the feature this task ships.

### The protocol sketch the brief starts from

The roadmap's own: *independent blind positions → cross-critique round → disagreement detection → arbiter ruling → synthesized findings with dissents preserved.* **It is a sketch, not a ruling.** Questions the brief must actually pose: does blinding survive a shared brief? How many critique rounds before diminishing returns? Is disagreement detected by a model or by structure? What triggers arbitration — any disagreement, or a threshold? **And the one the feature lives or dies on: how does synthesis avoid averaging away the dissent that makes a council worth more than one model?**

## Exact Scope

- **CREATE** `src/main/services/councilCore.ts` (+ test) — the **PURE** protocol state machine. Electron-free, storage-free, `fetch`-free, clock-injected. Given a run state and the messages so far, it returns *what to ask next, of whom*. **Every policy decision lives here; the service only performs I/O.**
- **CREATE** `src/main/services/councilService.ts` — the orchestrator. Assembles the run, mints and revokes the key, drives `createApiSession` handles through `createSessionOutput`, persists messages, reports progress.
- **EDIT** `src/main/services/storage.ts` — run/message accessors wired (created in 3b-2).
- **EDIT** `src/main/ipc.ts` / `src/shared/ipc.ts` / `src/preload/index.ts` — `council:start`, `council:cancel`, and a progress event.
- **EDIT** `src/shared/ipc.test.ts`.
- **CREATE (untracked)** `_verify/3b-3/`.

## Non-Goals

- **NO renderer file.** The view is 3b-4. Progress is emitted; nothing renders it yet.
- **NO migration.** v11 was the phase's only one.
- **NO second api transport.** `createApiSession` is the only producer (D45(2)/D63). **A "just for the arbiter" client is the shape this fails in** — it will look like reasonable specialization and it will fork the mechanism.
- **NO second scrubber.** Every member's output goes through `createSessionOutput` (D63(d)).
- **NO writes to `dispatches`.** A council run is not a PTY dispatch; it has its own table. **No council id smuggled onto a dispatch row.**
- **NO price table.** `onUsage` reports tokens. Converting to dollars needs price data and **D56's one-home rule applies** — if a price source is needed, that is a decision to raise, not to invent.
- **NO retry, no fallback member, no partial-run resume.** A failed member is a recorded refusal and the run continues or aborts by an explicit rule — not by improvisation.
- **NO file I/O.** The brief is read and findings are written in 3b-4. This task takes brief **text** and returns findings **text**.
- **Do not touch** the two `TASK-*-REVIEW-FABLE.md` files.

## Dependencies

**Task 3b-2** committed. **And the CR checkpoint, mid-task.**

## Step-by-step Work

1. **Run assembly and its rules** — how many members, exactly one arbiter, what happens with zero members or two arbiters, and what happens when a member's credential is unavailable. **Refuse by label; never silently drop a member**, because a council that quietly ran with three of five members produces findings nobody can interpret.
2. **The mint (D64(2))** — one key per run via the existing `OpenRouterKeyClient`, hard limit clearing the members' **max output allocation** (3a-3's `402` lesson: the cap is a pre-authorization ceiling, not a budget), revoked and read back at run end. **Reuse `openrouterKeys.ts`; do not fork it.** Boot reconciliation must see an open ledger row (`revoked_at IS NULL`) exactly as a dispatch's does.
3. **The orchestration loop** against a stub one-round protocol; transcript persistence; `onUsage` per member into the run's totals.
4. **⚠ STOP. Design the protocol, write the brief, pause.**
5. **Record the findings as a numbered decision.** Verify them against the code first.
6. **Implement the ruled protocol in `councilCore.ts`.**
7. **Tests, gates, the live drive.**

## Test Expectations

`councilCore.test.ts` covers the protocol as a **pure state machine** — feed it states, assert the next action — including: a member refusing; a member timing out; unanimous agreement (**does the arbiter still run?** — the ruling must be tested either way); total disagreement; and **a synthesis that must preserve a dissent**, asserted structurally rather than by reading prose.

**The cost accounting needs D55's discipline.** A run reporting `cost_usd` must also carry what it is a cost *of*: how many members answered, how many refused, and whether usage was reported or absent. **A total with an unknown denominator is the confident-looking number D55 exists to prevent** — and if the D4 pass in 3b-1 found `usage` unobtainable on streamed responses, that fact must surface in the run record rather than being silently zeroed.

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

### Grep gates

- **zero** `fetch(` in `councilService.ts` and `councilCore.ts` — all HTTP goes through `createApiSession` and `openrouterKeys.ts`;
- **zero** `createScrubber` outside `sessionOutput.ts`;
- **zero** `INSERT INTO dispatches` in council code;
- `src/main/adapters/` diff **empty**; `sessionManager.ts` **byte-identical**; `MIGRATIONS.length` still **11**.

### The live drive (G2)

**One real council run on a short brief**, three members plus an arbiter, on the standing OR route. Assert: the run row opens and closes; the key is minted, used, **revoked, and read back**; every member's messages persist with round and phase; token usage attributed per member; **the invariant proof** — the run's decrypt(s) happen with a user gesture and **no `sessions` row is written**, so a cold boot after the run relaunches nothing (D63 Q2 / D60).

**Also drive the ugly path:** cancel a run mid-deliberation and confirm the key is **still revoked**. An abandoned run leaving a live funded key is the failure mode 3a-3's ledger exists for.

### ⚠ Cost envelope

**Under $0.25**, and it is the phase's largest. A run is 3–5 members plus an arbiter over a real brief; a long brief multiplies every member's input tokens. **Use a SHORT brief for every drive but the last.** Report actual cost, per member if the data allows. **If a single drive exceeds $0.10, stop and report before running another.**

## Acceptance Criteria

1. `councilCore.ts` is pure and holds **every** protocol decision; `councilService.ts` performs I/O and decides nothing.
2. The CR checkpoint was **flagged, briefed, paused on, and recorded** as a numbered decision — with the findings verified against the code before implementation.
3. One minted key per run, revoked and read back, **including on the cancel path**.
4. Every member's messages persist with round, phase and token counts; **refusals persist too**, so a partial council is legible.
5. Dissent preservation is asserted structurally in a test, not by prose inspection.
6. Cost is reported **with its denominator** (members answered / refused / usage available) per D55.
7. No second transport, no second scrubber, no `dispatches` write, no renderer file, no migration.
8. Typecheck 0; vitest green; grep:secrets clean over `src/` and `_verify/3b-3/`.
9. Cost reported against the **< $0.25** envelope.
10. **`api:probe` is adopted or deleted, and the commit says which.**

## Review Checklist

1. **Did the CR actually pause, or did implementation continue past the checkpoint?** Check the commit order against the brief's timestamp.
2. **Were the council's findings verified against the code before being built on?** CR-3b.0's four compile errors are the precedent; treating findings as verified fact is the failure this whole phase must not model.
3. **Is there exactly one HTTP path?** A specialized arbiter client is the most likely scope breach and the hardest to undo.
4. **Is the key revoked on every exit path** — success, member failure, user cancel, and an exception mid-loop?
5. **Does a partial run read as partial?** A council that ran with three of five members must say so in its output, not present findings as though five deliberated.
6. **Does synthesis preserve dissent structurally**, or does it depend on the arbiter model choosing to?
