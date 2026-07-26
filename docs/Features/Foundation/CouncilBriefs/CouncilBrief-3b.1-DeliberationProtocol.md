# Council Brief CR-3b.1 — The Deliberation & Arbitration Protocol

_Issued 2026-07-26 · Status: **CLOSED — findings filed 2026-07-26 (`CouncilBrief-3b.1-Findings.md`), recorded as D67 with six coordinator corrections, two of them load-bearing** · Decision owner: Matthew Wilson · Recorder: Claude (roadmap §6) · Code state verified this session at commit `525c7f3` (Task 3b-3 commit 1 of 3, the D66 reconcile chore)_

> **⚠ Retrospective note, added when the findings were recorded.** All three reviewers opened by flagging CRITICAL for the same meta-reason: this document's own status line said *"OPEN — awaiting findings"*, so they read the task as reviewing a document rather than as answering its questions. They then answered Q1–Q6 anyway, and the arbiter synthesized per-question votes from their implied positions. **A future brief in this format should carry an unambiguous instruction line — "answer these questions; do not review this document" — because the status line is written for the repository and was read as an instruction by the council.** The rulings stand; the vote counts carry less weight than their numbers suggest, and D67 records that rather than smoothing it over.

You are a review council of independent LLM models. Deliberate on the decision below and return findings in the **Required Output Format** at the end. You have no other context on this project — everything you need is in this document. Where you are uncertain about an external fact (a provider's API shape, a model family's instruction-following reliability), **say so explicitly rather than guessing**; the implementer re-verifies every such fact against the vendor's own documentation, and against the repository, before coding.

> ⚠ **The last council that reviewed this project (CR-3b.0) produced sound rulings and verbatim TypeScript containing four compile errors, plus three gaps it never raised — because it had the brief and not the repository.** That is not a criticism; it is the standing operating assumption. **A council's output is deliberation, not verified fact.** Prefer stating a rule and its reasoning over emitting code you cannot compile.
>
> It is also, precisely, the thing this feature ships. You are designing the protocol for a tool that will do what you are doing now — which means every weakness you name in the design is a weakness you should assume applies to your own output.

---

## 1. What Chorus is

Chorus is a local-first, BYOK (bring-your-own-key) Windows desktop app — Electron 43 + Vue 3 + TypeScript + Vite + Pinia — for running multiple AI coding agents in parallel terminal panes. Each pane hosts an xterm.js terminal attached over typed IPC to a PTY session (node-pty/ConPTY) owned by the Electron **main** process. It runs two real interactive CLI TUIs today: Claude Code (`claude.exe` 2.1.218) and Codex CLI (`codex-cli` 0.145.0).

Locked rules, **not up for review**: sessions live in main; the renderer never spawns processes; all Zod validation in main only; IPC payloads are plain objects; SQLite with hand-rolled versioned migrations (currently **v11**, fifteen tables); credentials are encrypted with Electron `safeStorage`/DPAPI and are never written to argv, disk, or a log line.

## 2. Why this decision exists now

Chorus is in **Phase 3b — Native Council Review**: the review mechanism you are part of becomes a feature of the app. Tasks 3b-1 and 3b-2 have landed. The api-mode transport exists and is proven live against a real billable route; the council's schema and configuration UI exist; the orchestrator, the per-run minted key, transcript persistence and cost accounting are built and tested **against a deliberate one-round stub**.

The stub is where you come in. The project's own roadmap sketched the protocol as:

> *independent blind positions → cross-critique round → disagreement detection → arbiter ruling → synthesized findings with dissents preserved*

**That is a sketch, not a ruling.** The implementation spec's §5 was left deliberately unfinished so that this checkpoint would fire against a real design rather than a blank page, and the session implementing it has stopped here rather than filling it in.

**The question is narrower and harder than "design a good protocol".** The machinery is already built and is not up for review. What is up for review is the set of rules that machinery executes — and in particular the one the feature lives or dies on: **how a synthesis avoids averaging away the disagreement that makes a council worth more than one good model.**

## 3. Current implementation state (verified 2026-07-26 at commit `525c7f3`)

### 3.1 The pure core / IO split already exists, and every protocol decision must live on the pure side

`src/main/services/councilCore.ts` is Electron-free, storage-free, `fetch`-free and clock-free. `src/main/services/councilService.ts` performs I/O and **contains no `if` that decides what happens next in the deliberation**. The core's whole surface to the orchestrator is:

```ts
export type CouncilPhase = 'positions' | 'critique' | 'arbitration' | 'synthesis' | 'done'

export type CouncilAction =
  | { kind: 'ask'; memberId: string; phase: CouncilPhase; round: number; prompt: string }
  | { kind: 'complete'; findings: string }
  | { kind: 'abort'; reason: string }

export function nextAction(state: CouncilState): readonly CouncilAction[]
```

**Returning an ARRAY is load-bearing and is not up for review.** Every `ask` in one returned batch is issued concurrently by the orchestrator, so no member's prompt can contain another member's answer — none of those answers exists yet when the batch is handed out. Blindness within a round is therefore a property of the *shape*, not of a comment asking the implementer to be careful.

Note the consequence for your answer: **the prompt is built by the core, never by the service.** A prompt *is* the protocol. Any rule you propose has to be expressible as "given the transcript so far, emit these prompts next".

### 3.2 The state the core reasons over

```ts
export type TurnOutcome = 'answered' | 'refused'

export interface CouncilTranscriptEntry {
  memberId: string | null      // null for orchestrator-authored framing and the synthesis
  round: number
  phase: CouncilPhase
  content: string
  outcome: TurnOutcome
}

export interface CouncilState {
  run: PlannedRun              // { members: PlannedMember[]; arbiter: PlannedMember; briefText: string }
  transcript: readonly CouncilTranscriptEntry[]
  cancelled: boolean
}
```

A `PlannedMember` carries `{ memberId, label, credentialProfileId, model, role, params }`. The core sees model *ids* and user-chosen *labels*; it has no notion of a model being "better".

### 3.3 Assembly already refuses, by label, and never drops a member

Enforced today, before anything is spent: exactly one arbiter (zero or two is a refusal, not a default-pick); at least two non-arbiter members (*one member plus an arbiter is not a council — it is a review, and disagreement detection has nothing to detect*); a member whose credential is marked unavailable refuses the run; a member on a management-credential route refuses the run; a member whose model cannot be resolved refuses the run; a member whose route is not the OpenRouter gateway refuses the run, because the run's single capped key cannot authenticate anywhere else.

The rule under all of them: **a council that quietly ran with three of five members produces findings nobody can interpret, and the transcript would not show the absence.**

### 3.4 A refusal mid-run is a recorded turn, not a gap

If a member fails mid-stream, times out, or returns an empty answer, the orchestrator persists a `council_messages` row with `outcome: 'refused'` and the reason, carrying its round and phase like any other turn. **There is no retry, no fallback member and no partial-run resume** — those are explicit non-goals. What the protocol does when a member refuses is *your* ruling to make (see Q6).

### 3.5 Cost is bounded, measured, and the envelope is real

One minted OpenRouter key per **run**, hard-capped, created before the first request and destroyed after the last one on every exit path. Two measured facts bind you:

- **Reasoning tokens bill as output tokens, and a badly-capped reasoning model returns nothing.** Measured 2026-07-26: a probe against `moonshotai/kimi-k3` with `max_tokens: 60` returned `usage.tokensOut = 60` — *exactly* the cap — with zero content frames and an empty answer. The identical prompt at a 1000 cap answered in 66 output tokens. Live pricing read the same day: that model is $3/M input, $15/M output.
- **Cost scales linearly with rounds, and superlinearly with context.** Each critique round re-sends prior positions as input to every member. A council of 4 over a 2,000-token brief costs ~8,000 input tokens in round 1; a critique round that shows each member the other three positions costs that again *plus* the positions.

**This is not a reason to prefer the cheapest protocol.** It is a reason to say what a round buys, so the cost is a choice rather than a surprise.

### 3.6 The output the feature must ultimately produce

Task 3b-4 writes a findings `.md` beside the brief, in the same format you are being asked to return below — per-model positions, a synthesis, **dissents preserved**, action items. The protocol you design must be able to fill that document. This document is therefore both the brief and a worked example of the target output.

## 4. Binding prior rulings — constraints on your answer, not open questions

- **D45(2) / D63 Q1.** All model traffic goes through one factory, `createApiSession(spec, deps)`, which yields `receive(): AsyncIterable<string>`. **There is no second transport and none may be added** — including "just for the arbiter". A protocol that needs structured-output APIs, function calling, JSON mode, or any request field beyond `model` / `messages` / `stream` / `max_tokens` **cannot be implemented in this task**, because the transport builds its body from exactly those four things and this task must leave it byte-identical. If your answer requires more, say so explicitly and name what it needs — that is a legitimate outcome that becomes a scope decision, not a disqualifier.
- **D63 Q2.** A council member never enters the session manager and writes no session row, so a crashed run is lost, deliberately. **No resumption, no checkpointing.** A protocol that depends on surviving a restart is out.
- **D63 Q4 / F27.** All model text is scrubbed on ingest with the run's minted key registered as a secret. The honest coverage wording, and the only one this project permits — quote it verbatim if you need to state it:

  > *Chorus redacts registered exact values on ingest; it cannot redact values an agent derives, and it cannot redact content it was asked to read.*

  **Never** "agents cannot echo the key."
- **D55.** No number ships without its denominator, enforced by schema rather than by discipline. A findings document reporting a cost must also carry how many members answered, how many refused, and whether usage was reported or absent. This applies to *your* protocol's outputs too: any confidence, score, or agreement level it produces must travel with what it was computed from.
- **D56 / D48.** The core sees a resolved model id; it never ranks models and has no notion of a "frontier" one beyond the user having marked exactly one member as the arbiter.
- **No new npm dependency.** No JSON-schema validator, no diffing library, no embedding model.
- **Bounded implementation.** This is one commit in a four-task phase. A protocol that takes three sessions to land is a worse answer than a plain one that ships.

## 5. The decision, as named options

The five questions below are genuinely open. They interact — an answer to Q3 constrains Q4 and Q5 — so answer them as a **set**, and say which one you treated as load-bearing.

### Q1 — What does "blind" mean operationally?

Every member reads the same brief, so members are never fully independent: the brief's framing anchors all of them identically. Within-round blindness (no member sees another's answer) is already structural (§3.1). The question is whether that is *enough*, and what else is cheap.

- **Option 1A — Within-round blindness only.** Round 1 is independent; the critique round shows each member the others' positions **attributed by label**. Simplest; matches how a human review round works.
- **Option 1B — Blind + anonymised critique.** The critique round shows positions as "Position A / B / C" with no model identity. The *core* retains the mapping, so the transcript and the findings still attribute everything; only the *prompt* is anonymised. Costs nothing. Removes deference to a model a member recognises as authoritative.
- **Option 1C — 1B plus decorrelated framing.** Each member additionally receives a different system prompt (e.g. "argue from risk", "argue from simplicity", "argue from the user's perspective") to reduce the shared-brief anchoring at its source.

*Against 1C:* it manufactures disagreement rather than measuring it, and the feature's value claim is that the disagreement is real. *Against 1B:* anonymisation is a claim about the prompt, and a model can often identify itself or another model from style.

### Q2 — How many critique rounds?

- **Option 2A — Exactly one, fixed.**
- **Option 2B — Two, fixed.**
- **Option 2C — Adaptive: repeat until positions stop changing, capped.**

*Against 2C:* "stopped changing" needs the same machinery as Q3's disagreement detection, and risks agreement-by-exhaustion — models converging because they were asked again, not because anyone was persuaded. *Against 2A:* one round may be too shallow to surface a real objection. **Cost scales linearly here** (§3.5).

### Q3 — How is disagreement detected? ⚠ This is the structural crux.

- **Option 3A — Structurally, over a protocol-imposed answer schema.** The core requires every member to answer in a fixed shape — for each numbered question in the brief, a short verdict token plus prose. Disagreement is then a *computed* fact: the verdict vectors differ at index *i*. **Cost:** the protocol must impose a format on free-text briefs, and a member that does not comply is a recorded refusal, not a reinterpreted answer. Small, cheap models comply unreliably.
- **Option 3B — Model-judged.** A pass (the arbiter, or a dedicated call) reads all positions and reports where they disagree. Handles free-form briefs and prose nuance. **Cost:** disagreement becomes another opinion — unverifiable, unauditable, and capable of missing exactly the disagreement it is least comfortable with.
- **Option 3C — Hybrid.** Structural where members complied; model-judged over the remainder, labelled as such in the output.

**The brief format is a live input to this question.** Briefs in this project — including this one — already carry a numbered "Questions for the council" section and a required output format, so 3A has something to key on *for this project's own briefs*. **Whether the feature should REQUIRE that of every brief is part of your ruling**, and it is a real product constraint, not an implementation detail.

### Q4 — What triggers arbitration, and does the arbiter run on unanimity?

- **Option 4A — The arbiter always runs**, and on unanimity its job is explicitly *"say whether this agreement is warranted, and what the council collectively missed"*. One member is then the designated noticer of a wrong consensus.
- **Option 4B — Arbitration only on detected disagreement**; on unanimity the synthesis is assembled mechanically from the agreed positions. Cheaper by one call.
- **Option 4C — Split the roles:** arbitration (ruling on a conflict) is conditional; synthesis (producing findings) is unconditional and may be a different member.

The project's own history is evidence here: **CR-3b.0 was 3-of-3 unanimous on four of five questions, and the coordinator subsequently found four compile errors and three unraised gaps in its output.** Unanimity was not the problem, but it also was not protection. *If your answer is 4B, name who notices that a unanimous council was wrong.*

### Q5 — ⚠ How does synthesis preserve dissent? The feature's whole value is here.

A synthesis that averages is worth **less** than one good model, because it launders disagreement into false confidence and presents it as consensus.

- **Option 5A — Ask the arbiter nicely.** The synthesis prompt instructs the arbiter to include a "Dissents preserved" section.
- **Option 5B — Structural, arbiter-filled.** The synthesis must return a `dissents` array; an empty one is accepted **only when the core observed actual unanimity** in Q3's detection. If the core observed disagreement and the arbiter returned none, the synthesis is rejected and re-asked.
- **Option 5C — Structural, core-filled.** The core **generates the dissent section itself** from the transcript it holds, and the arbiter may add narrative but **cannot remove a dissent**. "Dissents preserved" then becomes a fact about the code rather than a promise about a prompt.

**Recommended prior, offered as a proposal to be ARGUED rather than assumed: 5C.** The reasoning: 5A is unenforceable; 5B is enforceable but its enforcement depends on Q3's detection being correct *and* on a re-ask that may simply produce a compliant-looking empty array on the second try. 5C is the only one where the guarantee survives a badly-behaved arbiter. **Its weakness is that a mechanically-extracted dissent may be noise** — a member's throwaway aside promoted to a headline disagreement — which would degrade the findings in a different direction. Argue it down if you think that trade is wrong.

### Q6 — Option-fixation check, and the refusal rule

Two parts. First: is there a shape above that should be discarded entirely for one not listed? Name one only if you would actually argue for it.

Second, concretely: **what should the protocol do when a member refuses mid-run?** Continue with the remainder and mark the findings partial; abort the whole run; or abort only if the count drops below a threshold you name. Assembly already refuses to *start* a council with fewer than two members plus an arbiter — say whether that same floor should apply mid-run, and what happens if the **arbiter itself** refuses.

## 6. Constraints the winner must survive

1. **Every protocol decision is expressible as `nextAction(state) → readonly CouncilAction[]`**, with prompts built by the core. If your rule cannot be written that way, it cannot be implemented here.
2. **No transport change.** `model` / `messages` / `stream` / `max_tokens` only (§4).
3. **Blindness within a round stays structural**, not prompt-instructed.
4. **A refused member is a recorded turn**, never a silent absence, and never retried.
5. **A partial run must read as partial** in its own output — not as a smaller council that agreed.
6. **The cost of the protocol is stated in rounds and in re-sent context**, so the envelope is a choice.
7. **No resumption** (D63 Q2), no new dependency, no price table.
8. **The findings document must be fillable** in §3.6's format, by this protocol, from this state.
9. **Windows-only v1.**

## 7. Evaluation rubric (weigh in this order)

1. **Dissent survival** — the probability that a real disagreement reaches the findings document intact, *including when the arbiter is uncooperative, wrong, or sycophantic* (35%).
2. **Verifiability** — how much of the protocol's claim about itself is checkable by a unit test over a state, versus asserted by a prompt (25%).
3. **Cost proportionality** — what each round buys, per dollar (15%).
4. **Robustness to weak instruction-following** — the feature must work when a member is a cheap model that ignores a format instruction (15%).
5. **Implementability in one commit** (10%).

## 8. Questions for the council

1. **Q1:** 1A, 1B, 1C or a named hybrid — what "blind" means operationally, and whether within-round blindness is sufficient given the shared brief.
2. **Q2:** how many critique rounds, and what the marginal round buys.
3. **Q3:** structural, model-judged, or hybrid disagreement detection — and whether the feature should **require** briefs to carry enumerated questions.
4. **Q4:** what triggers arbitration; does the arbiter run on unanimity; if not, who notices a wrong consensus.
5. **Q5:** how synthesis preserves dissent — and an explicit verdict on the 5C proposal, agreed or argued down.
6. **Q6:** option-fixation check, plus the mid-run refusal rule, including the arbiter refusing.
7. **Across all six:** name the single failure mode you think this design is most likely to ship with, and the cheapest check that would catch it.

## 9. Success criteria for this council session

The council **succeeds** if it returns: (a) one committed answer per question Q1–Q6, or an explicit tie with the tie-breaker named; (b) the round structure written out concretely enough that an implementer can derive `nextAction`'s branches from it — **as rules and pseudocode, not as TypeScript you cannot compile**; (c) the dissent-preservation mechanism stated as something a unit test can assert over a state object; (d) an enumerated risk list with mitigations; (e) **explicit dissents preserved — do not average away disagreement.**

The council **fails** if it returns a survey without commitment; if it answers Q5 with "instruct the arbiter to include dissents" without addressing enforceability; if it proposes a mechanism requiring a transport change without saying so; or if it reaches unanimity by dropping the rubric.

> **A closing note that is part of the brief, not decoration.** If this council reaches unanimity on Q5, that unanimity is itself an instance of the thing Q5 is about. Say what would have to be true for the agreement to be wrong.

## 10. Required output format

```
## Per-model positions
<model>: Q1 <1A|1B|1C|hybrid(named)> / Q2 <1|2|adaptive> / Q3 <structural|model-judged|hybrid> /
         Q4 <always|conditional|split> / Q5 <5A|5B|5C|named> / Q6 <none|named> + <continue|abort|threshold N>
  — <2-4 sentence rationale>
  — Strongest counterargument to my own choice: <1-2 sentences>

## Council synthesis
Q1: <ruling> (<unanimous | majority N-of-M>) — <3-6 sentences>
Q2: <ruling> (<vote>) — <2-4 sentences, what the marginal round buys>
Q3: <ruling> (<vote>) — <2-4 sentences; state whether briefs must carry enumerated questions>
Q4: <ruling> (<vote>) — <2-4 sentences; if conditional, who notices a wrong consensus>
Q5: <ruling> (<vote>) — <3-6 sentences; explicit verdict on the 5C proposal>
Q6: <ruling> (<vote>) — <2-4 sentences; the mid-run refusal rule, arbiter included>

## The protocol, concretely
<round-by-round: phase, who is asked, what they see, what they must return, what the core computes next>
<the terminating conditions>
<pseudocode for nextAction's branches — NOT TypeScript>

## The dissent-preservation mechanism
<stated as an assertion a unit test can make over a state object>

## What a prompt must instruct vs what the code must enforce
<two lists — the boundary between them IS the ruling>

## Risks & mitigations for the winner
<enumerated>

## Dissents preserved
<model>: <position> — <why it should be revisited if X happens>

## If this council was unanimous on Q5
<what would have to be true for that agreement to be wrong>

## Action items for implementation
<enumerated, each one checkable>
```
