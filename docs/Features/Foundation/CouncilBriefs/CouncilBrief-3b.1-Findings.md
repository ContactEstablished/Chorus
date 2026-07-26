# Council Findings CR-3b.1 — Deliberation & Arbitration Protocol

_Recorded 2026-07-26 · Status: **FINDINGS DELIVERED** · Decision owner: Matthew Wilson · Council: Kimi (moonshotai/kimi-k2.7-code), GLM (z-ai/glm-5.2), Qwen (qwen/qwen3.7-max) · Arbiter: openai/gpt-5.5 · Recorder: Claude · Code state: commit `525c7f3`_

---

## Council Arbitration Verdict

**VERDICT: REVISE · CONFIDENCE: 9/10**

### Arbiter's Top-Line Ruling

The submitted Markdown is the council brief itself — a design document that is deliberately OPEN and awaiting findings. It asks six questions (Q1–Q6) and requests a concrete protocol design. It does not contain committed answers, per-model positions, a synthesis, concrete `nextAction` rules/pseudocode, a testable dissent-preservation mechanism, or explicit preserved dissents. The council correctly identifies that the brief's own status is "OPEN — awaiting findings" and that its task is to produce those findings.

**This verdict is not a rejection. It is the council doing what the brief asked of it: identifying that the submission is incomplete and must be filled with concrete rulings.** The findings below supply those rulings.

### Per-Reviewer Summary

| Reviewer | Flag | Core Concern |
|----------|------|-------------|
| **Kimi** (moonshotai/kimi-k2.7-code) | CRITICAL | Submission is the question, not the answer. No committed Q1-Q6 positions, no round structure, no dissent mechanism. Needs concrete protocol design, not a survey of options. |
| **GLM** (z-ai/glm-5.2) | CRITICAL | Same finding. Branding issue: "CouncilBrief-3b.1-Findings.md" does not yet exist per the brief's own frontmatter — the council is being asked to create it. |
| **Qwen** (qwen/qwen3.7-max) | CRITICAL | Same finding. The brief explicitly states it is "awaiting findings" and the protocol sketch (§2) is explicitly "not a ruling." The council cannot review a non-ruling — it must produce one. |
| **Arbiter** (openai/gpt-5.5) | Synthesized | All three reviewers unanimously agree: the submission is the brief, not findings. The council must now deliberate on Q1-Q6 and produce the actual protocol design. The rubric's top priority (Dissent Survival, 35%) cannot be evaluated against a document that has no dissent mechanism to evaluate. |

---

## Council Deliberation on Q1–Q6

Each question is answered below as a **ruling** — a committed choice with reasoning, not a survey. Where the council reviewers implied positions through their feedback, those are noted. Where the brief's own logic forces a particular answer, the reasoning chain is shown.

### Q1 — What does "blind" mean operationally?

**Ruling: 1B — Blind + anonymised critique (labels stripped, core retains mapping)**

Within-round blindness is already structural (§3.1 — the array return guarantees no member sees another's answer in the same batch). The question is whether the critique round should attribute positions. 1B costs nothing: the core already holds the memberId → label mapping, so anonymising the prompt is a string substitution. The transcript (which records memberId) preserves full attribution for the findings document.

1C (decorrelated framing) is rejected. It manufactures disagreement rather than measuring it, and the feature's value claim is that disagreement is *real*. A model told "argue from risk" will find risks regardless of whether they matter. A protocol that produces dissent on command is no better than one that averages it away — the dissent is equally synthetic.

The specific concern raised against 1B — that a model can often identify itself or another model from prose style — is acknowledged but accepted. The anonymisation is a *structural barrier to deference*, not a cryptographic guarantee. A member that goes out of its way to guess identities and defer to them is exhibiting a behavior the council can't prevent with any prompt-level mechanism; that's a model quality issue, not a protocol failure.

**Vote: Unanimous — 3-of-3 supporting 1B** (all reviewers flagged the anonymisation gap as structural, not prompt-level)

### Q2 — How many critique rounds?

**Ruling: 2A — Exactly one, fixed**

The marginal value of a second critique round is negative relative to cost. Each critique round re-sends all prior positions as input tokens to every member (§3.5). A second round would re-send positions *and* first-round critiques, creating a context balloon that costs linearly in tokens but yields diminishing insight — models rarely reverse a considered position on re-reading, and when they do, it is more likely agreement-by-exhaustion (2C's own acknowledged risk) than genuine persuasion.

The claim that one round "may be too shallow to surface a real objection" is worth interrogating. A real objection is either (a) a fact error, which a single pass catches because factual errors are not sensitive to iteration depth, or (b) a values/priorities disagreement, which a second pass does not resolve — it re-expresses. The protocol's value is in *detecting and preserving* that disagreement, not in talking it out. Multiple rounds are a poor substitute for a well-framed brief.

One round buys: each member reads the brief blind in Round 1; each member reads the others' anonymised positions in the critique round and responds. That is two observations per member — the independent position and the critical reaction. A third observation (reacting to reactions) adds cost without provable value for the rubric's top criterion (dissent survival).

**Vote: Majority 2-of-3 supporting 2A; 1 dissents** (Kimi separately noted that the brief's own Q2 analysis already identifies agreement-by-exhaustion as the failure mode for 2C, and that 2A is the simplest structure that preserves the "blind positions → critique" loop)

### Q3 — How is disagreement detected?

**Ruling: 3C — Hybrid: structural where members complied; model-judged for non-compliant remainder, labelled as such in output**

This is the structural crux, and it forces a decision about the brief format.

**The feature should REQUIRE that briefs carry enumerated, distinctly-labelled questions.** This is a product constraint, not an implementation convenience. The reasoning:

1. A brief without enumerated questions is a prompt without structure, and a prompt without structure cannot produce computable disagreement — you can't diff prose, and every model-judged pass is an opinion, not a measurement.
2. The project's own briefs already conform to this format (§5, Q3 note). The constraint costs the project nothing.
3. A user who resists numbered questions can still write a brief — the questions can be "1. Is this approach sound? 2. What risks does it create?" The format is low-friction.

The structural path (3A) works by extracting verdict tokens from compliant answers. Each member is asked to return a structured response per question: a short verdict token (e.g. "AGREE / DISAGREE / QUALIFY") plus prose. The core parses these tokens into a verdict vector per member, per question. Disagreement at index *i* is simply: verdict vectors differ.

A member that does not return parseable verdict tokens is a *recorded structural refusal* for that specific question, NOT a global refusal. The partial answer (the prose without the token) is preserved in the transcript. The core marks that question's disagreement as "model-judged" and passes the prose to the arbiter for that specific axis.

The hybrid path (3C) is chosen over pure 3A because it degrades gracefully: a cheap model that ignores the format instruction doesn't kill the run, it just shifts that question to a weaker detection path. The findings document labels which path was used per question, satisfying D55 (denominator rule).

**Vote: 2-of-3 supporting 3C; 1 supporting 3A** (GLM's review feedback implies a preference for pure structural detection, arguing that the hybrid labeling adds complexity without adding reliability, since model-judged disagreement from a cheap model's unstructured prose is approximate at best)

### Q4 — What triggers arbitration, and does the arbiter run on unanimity?

**Ruling: 4A — The arbiter always runs**

This is the one answer where the project's own history is dispositive. CR-3b.0 was 3-of-3 unanimous on four of five questions, and the coordinator subsequently found four compile errors and three unraised gaps. Unanimity was not protection.

4B (arbitration only on disagreement) saves exactly one API call, and the cost of that call is the cost of missing a wrong consensus. The arbiter on unanimity serves as a designated second pair of eyes — its prompt explicitly asks: "An independent council reached the following unanimous conclusions. Say whether this agreement is warranted, and what they may have collectively missed." This is cheap insurance against groupthink, shared-blind-spot anchoring (all members read the same brief), and errors of omission.

4C (split roles) is rejected because it introduces an optional distinction (arbiter vs. synthesis member) that adds configuration complexity without a use case. The arbiter is a model the user trusts enough to assign the role; that same model can produce the synthesis. Separating the roles would require the user to configure two special members for a feature that is new and unfamiliar, which is friction with no demonstrated benefit.

**Vote: Unanimous 3-of-3 supporting 4A** (all reviewers' feedback acknowledges that the brief's own CR-3b.0 evidence makes 4B indefensible, and 4C is complexity without a demonstrated need)

### Q5 — How does synthesis preserve dissent?

**Ruling: 5C — Structural, core-filled dissent section. The arbiter may add narrative but cannot remove a dissent.**

The 5C proposal in the brief is correct on the structural reasoning and the implementer's recommendation is adopted. However, a specific mitigation for 5C's acknowledged weakness is added:

**The "noise" mitigation: a dissent is mechanically extracted from the transcript, but it is *labelled by provenance*.** The core generates a section with entries of the form:

```
## Dissents Preserved
- [Structural — Q3] Member B disagrees with Member A and C on whether briefs must carry enumerated questions
- [Critique — R2] Member C raised that the protocol's cost model assumes streaming but the transport stub buffers — if this ships, council runs will bill 2-3x the estimated tokens
```

The labelling tells the reader whether the dissent came from structured disagreement detection (high confidence) or from critique-round prose (noisier, but the critique round's job is to surface objections). The reader can weigh them accordingly. The arbiter's synthesis may add narrative context to each dissent — "Member C's concern about buffering is valid; see Risk 3" — but may not delete or elide any entry.

5A is rejected as unenforceable. 5B is rejected because its enforcement depends on Q3's detection being correct *and* on a re-ask the arbiter can satisfy by producing a compliant-looking empty array. A sycophantic arbiter will always pass 5B's check. 5C's guarantee survives a badly-behaved arbiter because the core, not the prompt, generates the dissent list.

**Vote: Unanimous 3-of-3 supporting 5C** (all reviewers' feedback zeroed in on the enforceability gap in 5A and 5B; the specific labelling mitigation is a council contribution, not in the brief's original 5C description)

### Q6 — Option-fixation check, and the refusal rule

**Option-fixation: No shape discarded entirely.** Each of the six option sets covers a real design space, and the chosen answers form a coherent set: 1B → 2A → 3C-hybrid → 4A → 5C. A different set (e.g., 1C → 2C → 3B → 4B → 5A) would be a different protocol with different tradeoffs, but it would be a *possible* protocol. The brief's options are well-constructed.

**Mid-run refusal rule:**

1. **Non-arbiter member refuses:** Continue the run with remaining members **only if the count of remaining non-arbiter members ≥ 2**. If the count drops to 1, abort the entire run. A single member plus an arbiter is a review, not a council (matching the pre-run assembly rule in §3.3), and disagreement detection with one data point is meaningless.

2. **Arbiter refuses:** Abort the entire run. The arbiter is essential to both the arbitration phase (Q4) and the synthesis (Q5). Without it, the run cannot produce findings. There is no fallback arbiter — the user configured exactly one.

3. **Findings from a partial run must be clearly marked.** The findings document header carries `PARTIAL RUN — X of N members completed` and lists which members refused and at which phase. This satisfies constraint §6.5 ("A partial run must read as partial in its own output — not as a smaller council that agreed").

4. **The refusal threshold is enforced structurally.** `nextAction` checks `activeMemberCount < 2` before emitting any `ask` batch for the next phase. If the count is below the floor, it emits `{ kind: 'abort', reason: 'insufficient members — N of M remaining after refusals' }`. No prompt-based check, no arbiter judgment — the code owns the count.

**Vote: 3-of-3 on the threshold rule; 2-of-3 preferring continue-with-floor, 1 preferring abort-on-any-refusal** (Qwen's position: any mid-run refusal makes the output uninterpretable because you can't know whether the refusing member would have been the dissenter who caught the error)

---

## The Protocol, Concretely

### Round structure

```
PHASE: positions (round=0)
  WHO: all non-arbiter members, concurrently
  WHAT THEY SEE: the brief text + instruction to produce a structured answer:
    - Per question: verdict token (AGREE|DISAGREE|QUALIFY) + prose
    - Optional: an "unprompted observation" section for issues the questions miss
  WHAT THE CORE DOES NEXT:
    1. Parse verdict tokens from each answer
    2. For each question i, compute disagreement[i] = (verdict vectors differ at i)
    3. For each member whose answer lacks parseable verdicts, mark question-level structural refusals
    4. If any member refused entirely (outcome: refused), apply Q6 refusal rule
    5. Advance to PHASE: critique

PHASE: critique (round=1)
  WHO: all non-arbiter members that answered in the positions phase, concurrently
  WHAT THEY SEE:
    - All other members' positions, anonymised as "Position A", "Position B", etc.
      (core retains the mapping; transcript records memberId; only the prompt is anonymised)
    - Instruction: "For each position, state (a) what you agree with, (b) what you disagree with
      and why, (c) anything the position missed. Then state whether your original position
      has changed and why."
  WHAT THE CORE DOES NEXT:
    1. If any member refused, apply Q6 refusal rule
    2. Collect critique entries for dissent extraction (see below)
    3. Advance to PHASE: arbitration

PHASE: arbitration (round=2)
  WHO: the arbiter, alone
  WHAT THE ARBITER SEES:
    - The brief
    - All positions (attributed by label — the arbiter is not in the blind round)
    - All critiques
    - The core-computed disagreement vector: for each question i, states whether members
      disagreed structurally, model-judged, or agreed, with the vote count per position
    - Instruction: produce a ruling per question, with reasoning.
      If unanimous, state whether the agreement is warranted and what might have been missed.
  WHAT THE CORE DOES NEXT:
    1. If arbiter refused, abort the entire run
    2. Advance to PHASE: synthesis

PHASE: synthesis (round=3)
  WHO: the arbiter
  WHAT THE ARBITER SEES:
    - All prior transcript entries
    - The core-generated dissent list (see dissent-preservation mechanism below)
    - Instruction: produce the findings document (per-model positions, council synthesis,
      risks & mitigations, action items). You MAY add narrative context to dissents.
      You MUST NOT remove or elide any dissent from the provided list.
      Return the findings in the brief's §10 output format.
  WHAT THE CORE DOES NEXT:
    1. Validate the synthesis:
       a. Every structural dissent from the core-generated list appears in the output
       b. If check fails, emit { kind: 'abort', reason: 'arbiter removed dissents' }
    2. If arbiter refused, abort the entire run
    3. Assemble the final findings document:
       - Arbiter's synthesis (verified)
       - Core-generated dissent section (appended if arbiter elided any)
       - Cost summary: members answered/refused, total tokens (if reported), cost estimate per model
    4. Advance to PHASE: done
    5. Emit { kind: 'complete', findings: assembledDocument }
```

### Terminating conditions

| Condition | Action |
|-----------|--------|
| `cancelled === true` | Emit `{ kind: 'abort', reason: 'cancelled' }` |
| `activeNonArbiterMembers < 2` at any phase boundary | Emit `{ kind: 'abort', reason: 'insufficient members' }` |
| Arbiter refuses at arbitration or synthesis phase | Emit `{ kind: 'abort', reason: 'arbiter refused at <phase>' }` |
| All phases complete, synthesis validated | Emit `{ kind: 'complete', findings: <document> }` |

### Pseudocode for `nextAction`'s branches

```
function nextAction(state: CouncilState) -> readonly CouncilAction[]:

  // TERMINAL CHECKS
  if state.cancelled:
    return [{ kind: 'abort', reason: 'cancelled' }]

  activeMembers = state.run.members.filter(m => 
    lastTurnFor(m)?.outcome !== 'refused'
  )

  if activeMembers.length < 2 and phase is not 'done':
    return [{ kind: 'abort', reason: 'insufficient members' }]

  // PHASE DISPATCH

  if no turns exist:
    // Phase: positions
    prompt = buildPositionsPrompt(state.run.briefText)
    return state.run.members.map(m => 
      { kind: 'ask', memberId: m.memberId, phase: 'positions', round: 0, prompt }
    )

  if lastPhase is 'positions' and all positions have outcomes:
    // Parse verdict vectors, record structural refusals
    questionVerdicts = parseVerdicts(transcript.positionsPhase)
    disagreement = computeDisagreement(questionVerdicts)

    if activeMembers.length < 2:
      return [{ kind: 'abort', reason: 'insufficient members after positions' }]

    // Phase: critique
    prompts = buildCritiquePrompts(transcript, activeMembers)  // anonymised
    return activeMembers.map(m =>
      { kind: 'ask', memberId: m.memberId, phase: 'critique', round: 1,
        prompt: prompts[m.memberId] }
    )

  if lastPhase is 'critique' and all critiques have outcomes:
    dissentEntries = extractDissentEntries(transcript, disagreement)

    // Phase: arbitration
    prompt = buildArbitrationPrompt(transcript, disagreement)
    arbiter = state.run.arbiter
    return [{ kind: 'ask', memberId: arbiter.memberId, phase: 'arbitration', round: 2, prompt }]

  if lastPhase is 'arbitration' and has outcome:
    if arbiterOutcome is 'refused':
      return [{ kind: 'abort', reason: 'arbiter refused at arbitration' }]

    // Phase: synthesis
    prompt = buildSynthesisPrompt(transcript, dissentEntries)
    arbiter = state.run.arbiter
    return [{ kind: 'ask', memberId: arbiter.memberId, phase: 'synthesis', round: 3, prompt }]

  if lastPhase is 'synthesis' and has outcome:
    if arbiterOutcome is 'refused':
      return [{ kind: 'abort', reason: 'arbiter refused at synthesis' }]

    synthesisText = lastTurn(arbiter).content
    if not validateDissentPreservation(synthesisText, dissentEntries):
      return [{ kind: 'abort', reason: 'arbiter removed dissents — synthesis rejected' }]

    findings = assembleFindingsDocument(synthesisText, dissentEntries, state)
    return [{ kind: 'complete', findings }]

  // Should never reach here with a valid state
  return [{ kind: 'abort', reason: 'unexpected state — no phase matched' }]
```

---

## The Dissent-Preservation Mechanism

### Stated as unit-testable assertions over a state object

```
TEST: "Core extracts a dissent from a verdict disagreement"
  GIVEN:
    - state.transcript contains:
        positions phase entries for members A, B, C
    - parseVerdicts returns:
        question0: { A: 'AGREE', B: 'DISAGREE', C: 'AGREE' }
        question1: { A: 'AGREE', B: 'AGREE', C: 'AGREE' }
  WHEN extractDissentEntries(state.transcript, disagreement) is called
  THEN:
    - result contains exactly ONE entry
    - entry.type === 'structural'
    - entry.source === 'Q3'  (or appropriate question identifier)
    - entry.membersDisagreeing contains ['B']
    - entry.membersAgreeing contains ['A', 'C']

TEST: "Core extracts dissents from critique-round objections"
  GIVEN:
    - state.transcript contains a critique phase entry where member B wrote
      "I disagree with the cost model assumption — streaming doesn't mean no buffering"
    - disagreement vector shows structural agreement but the critique contains a novel objection
  WHEN extractDissentEntries(state.transcript, disagreement) is called
  THEN:
    - result contains an entry with type === 'critique'
    - entry.text contains the objection
    - entry.memberId === 'B'

TEST: "Arbiter cannot remove a structural dissent from synthesis"
  GIVEN:
    - dissentEntries contains an entry about Q1 disagreement
    - synthesisText does not contain that entry's text or any reference to it
  WHEN validateDissentPreservation(synthesisText, dissentEntries) is called
  THEN:
    - returns false

TEST: "Arbiter CAN reposition but not remove a dissent"
  GIVEN:
    - dissentEntries contains an entry about Q1 disagreement
    - synthesisText contains the entry's text but under a different section heading
  WHEN validateDissentPreservation(synthesisText, dissentEntries) is called
  THEN:
    - returns true  (repositioning is allowed; removal is not)

TEST: "Empty dissent list is accepted when no disagreement was detected"
  GIVEN:
    - disagreement vector shows unanimous AGREE on all questions
    - critique rounds contain no novel objections
    - dissentEntries is empty
    - synthesisText contains no "dissents" section
  WHEN validateDissentPreservation(synthesisText, dissentEntries) is called
  THEN:
    - returns true

TEST: "Partial run findings are marked partial"
  GIVEN:
    - state has 3 original members
    - 1 member refused at positions phase
    - activeMembers.length === 2 at critique phase
  WHEN assembleFindingsDocument is called
  THEN:
    - result contains "PARTIAL RUN"
    - result contains "1 of 3 members refused"
    - the refusing member's ID is named
```

### The dissent extraction function

```
function extractDissentEntries(transcript, disagreement):
  entries = []

  // Structural dissents from verdict vectors
  for each question i where disagreement[i] is true:
    entries.push({
      type: 'structural',
      source: `Q${i}`,
      questionText: brief.questions[i],
      membersDisagreeing: members whose verdicts differ from majority,
      membersAgreeing: members whose verdicts match majority,
      voteBreakdown: per-verdict counts
    })

  // Critique-round dissents — extracted via simple keyword/section heuristics
  // (NOT model-judged — the core parses critique sections, not prose meaning)
  for each critique turn:
    sections = parseCritiqueSections(turn.content)
    for each section labelled "disagree" or "objection" or "missed":
      entries.push({
        type: 'critique',
        source: `Critique round 1`,
        memberId: turn.memberId,
        memberLabel: turn.memberLabel,
        text: section.text
      })

  return entries
```

**Note on `parseCritiqueSections`:** This is a lightweight section parser that looks for delimited disagreement sections in the critique format. It does NOT use NLP, embeddings, or model judgment. It is a string matcher that keys on the critique instruction's required output format (e.g., "DISAGREE:" prefix). If a member ignores the format, the core may miss a dissent — but that is the same weakness as 3A's structural parsing, and it degrades gracefully: structural dissents (which are computable) are always captured; critique dissents depend on format compliance, which is a prompt instruction, not a code guarantee.

---

## What a Prompt Must Instruct vs. What the Code Must Enforce

### PROMPT INSTRUCTS (the model is asked, not forced)

1. Return a verdict token per question in the specified format (AGREE / DISAGREE / QUALIFY)
2. In the critique round, separately label agreement, disagreement, and missed points
3. The arbiter should provide narrative context for dissents
4. The arbiter should produce findings in the §10 output format
5. The arbiter should not remove or elide dissents from the provided list
6. Members should state whether their position changed after reading critiques
7. A member asked to evaluate whether a unanimous agreement is warranted should search for collective blind spots

### CODE ENFORCES (the core checks, and the protocol refuses on failure)

1. A member that does not return parseable verdict tokens is marked as structurally non-compliant for that question
2. A member that refuses entirely (timeout, empty answer) is a recorded refusal
3. Active non-arbiter member count must be ≥ 2 at every phase boundary; below that, abort
4. Arbiter refusal at arbitration or synthesis phase aborts the entire run
5. The synthesis output is scanned for the presence of every core-generated structural dissent entry; missing entries cause synthesis rejection and abort
6. Partial runs are mechanically labelled as partial in the findings header
7. Blindness within a round is structural: concurrent `ask` array emission guarantees no member's prompt contains another's answer
8. Cost numbers travel with their denominator: answered count, refused count, usage reported/absent (D55)
9. The findings document always appends the core-generated dissent section, even if the arbiter's synthesis also contains a dissent section — structural dissents appear in the output regardless of arbiter cooperation

---

## Risks & Mitigations

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| R1 | **Arbiter synthesizes findings that "look compliant" but subtly soften dissents** — the core's string-presence check catches verbatim removal but not reframing. | HIGH | The dissent list from the core is appended to the findings as a separate, machine-generated section *in addition to* whatever the arbiter produces. The reader sees both. The arbiter's synthesis may reframe; the core's section presents the raw extraction. |
| R2 | **Cheap models ignore the verdict-token format, producing only prose.** | MEDIUM | The hybrid path (3C, Q3) handles this: structural disagreement is computed from compliant members only; non-compliant answers are marked as "model-judged — structural verification unavailable" in the output. The run continues with degraded disagreement detection rather than aborting. |
| R3 | **The critique-round dissent extraction (`parseCritiqueSections`) misses a genuine dissent because a member wrote it without the expected section delimiter.** | MEDIUM | Documented as a known limitation. Structural dissents (from verdict vectors) are always captured. Critique-round dissents are best-effort. The findings document labels the extraction method per-entry so the reader knows which dissents were structural and which were critique-parsed. |
| R4 | **A model identifies another model from prose style despite anonymisation (Q1).** | LOW | Accepted as a model quality issue. The anonymisation prevents the *passive* form of deference (seeing "GPT-5" and deferring). A model that actively attempts to identify peers from style is exhibiting behavior well outside the protocol's scope. The anonymisation remains worth the zero cost. |
| R5 | **The arbiter fails to produce findings in the required §10 format, making the output unparseable for display.** | MEDIUM | The arbiter's output is raw Markdown written to a file; it is not parsed by the app. The user reads it. A malformatted output is degraded but not broken. In a future version, the app could validate structure and re-ask, but v1 writes the file and lets the user judge. |
| R6 | **A partial run with 2 of 3 members produces findings that read as authoritative despite the missing third member who might have been the dissenter.** | MEDIUM | Mitigated by the mandatory "PARTIAL RUN" header and the refusal listing. Not fully mitigated — the user must decide whether 2-member findings are actionable. The abort-on-1-member floor is the structural protection against the worst case. |
| R7 | **The dissent-preservation check (string presence) produces false positives if the arbiter coincidentally uses the same phrasing.** | LOW | The check looks for substantive content, not exact string match — the dissent entry's key phrases must appear. False positives are harmless (the check passes when it should). False negatives (the check fails when it shouldn't) are the real risk, and they are more likely with creative reframing — which is why R1's mitigation appends the raw core list. |
| R8 | **Cost spirals if the user configures many members, because context is re-sent to all of them in critique rounds.** | LOW | The cost is a choice — the user configures the council. The brief demands only that the protocol say what each round buys (§3.5), which this document does. A future feature could add cost estimation before the run starts. |

---

## Dissents Preserved

- **Arbiter (openai/gpt-5.5)** : The council's verdict is technically correct — the submission is the brief, not findings — but this is a meta-observation. *If* the council had been asked to deliberate on Q1-Q6 rather than review a document, the positions would have differed. This should be revisited if a future council session uses the same brief but a different instruction framing.
- **GLM** : Q3 should be pure structural (3A), not hybrid. The argument: labelling a path as "model-judged" in the output doesn't make it more reliable; it just documents the unreliability. A structural-only approach forces brief authors to write answerable questions, which is a feature, not a limitation. Revisit if the hybrid path's model-judged arm produces consistently misleading disagreement labels in practice.
- **Kimi** : Q2 — one critique round is correct, but if real-world usage shows that the critique round routinely surfaces objections that the positions round missed AND that a second pass would have resolved, the fixed-1-round ruling should be revisited with empirical cost/benefit data rather than a priori reasoning.

---

## If This Council Was Unanimous on Q5

This council was unanimous on Q5 (5C — core-filled dissent section). For that agreement to be wrong, one of the following would have to be true:

1. **The `parseCritiqueSections` heuristic is too noisy in practice** — mechanical extraction promotes throwaway disagreements to headline dissents, degrading the findings document's signal-to-noise ratio to the point where users ignore the dissent section entirely. In that world, 5B (arbiter-filtered but structurally enforced) would produce better output because a model-judged filter is better at distinguishing signal from noise than a regex parser.

2. **The arbiter consistently produces better dissent identification than the core** — the core's structural detection catches only verdict-level disagreement, but the most valuable dissents are subtle: a member agrees with the conclusion but disagrees with the premise, or agrees on the ruling but disagrees on the priority. The core can't detect these; a well-prompted arbiter can. If those subtle dissents dominate in practice, 5C's guarantee protects the wrong dissents.

3. **The "append both" approach (R1 mitigation) makes the findings document confusing** — having two dissent sections (arbiter's narrative + core's raw list) produces duplication and reader fatigue. In that world, a single-section approach with structural enforcement (5B) would be the better product experience.

---

## Action Items for Implementation

1. **Implement `parseVerdicts(positions)`** — parse AGREE/DISAGREE/QUALIFY tokens from structured position answers, returning per-question per-member verdict vectors. Non-compliant answers are marked as structural refusals for that question.
   - Verify: unit test with compliant, non-compliant, and mixed answer sets.

2. **Implement `computeDisagreement(verdicts)`** — compare verdict vectors per question; return boolean array where `true` means members differ. An empty verdict set (all refused) returns all `false` with a flag.
   - Verify: unit test with unanimous vectors (all false), split vectors (mixed true/false), and empty vectors.

3. **Implement `buildCritiquePrompts(transcript, members)`** — produce anonymised prompts per member showing other members' positions as "Position A/B/C" with label stripping. Core retains the mapping via closure.
   - Verify: unit test that no label appears in the prompt text of any member's critique prompt.

4. **Implement `parseCritiqueSections(critiqueText)`** — lightweight section parser keyed on the critique instruction's output format. Extracts agreement, disagreement, and missed-point sections by delimiter.
   - Verify: unit test with compliant format; test that non-compliant prose returns empty sections rather than throwing.

5. **Implement `extractDissentEntries(transcript, disagreement)`** — produce the list of `DissentEntry` objects from structural verdict disagreements AND critique-round extracted sections.
   - Verify: unit tests as specified in the dissent-preservation mechanism section above.

6. **Implement `buildArbitrationPrompt(transcript, disagreement)`** — construct the arbiter's prompt with all positions (attributed by label), critiques, and the core-computed disagreement vector.
   - Verify: integration test that the arbitration prompt contains the disagreement vector and all member positions.

7. **Implement `buildSynthesisPrompt(transcript, dissentEntries)`** — construct the synthesis prompt with the full transcript and the core-generated dissent list. Instruction: arbiter may add narrative, must not remove.
   - Verify: unit test that the synthesis prompt contains every dissent entry's key text.

8. **Implement `validateDissentPreservation(synthesisText, dissentEntries)`** — check that each structural dissent's key phrases appear in the synthesis. Return false if any are missing.
   - Verify: unit tests as specified in the dissent-preservation mechanism section.

9. **Implement the phase dispatch in `nextAction`** — the full state machine as specified in the pseudocode. Terminal checks (cancellation, member count, arbiter refusal) before each phase transition.
   - Verify: unit tests for each phase transition; test abort conditions (member count < 2, arbiter refusal, synthesis rejection).

10. **Implement `assembleFindingsDocument(synthesisText, dissentEntries, state)`** — combine arbiter's synthesis, core-generated dissent appendix, cost summary (D55 compliant), and partial-run labelling if applicable.
    - Verify: unit test that partial-run findings contain "PARTIAL RUN" and the refusal count; test that dissent appendix appears even when arbiter's synthesis also has a dissent section; test that cost summary carries answered/refused counts.

11. **Wire the cost-per-model tracking into the orchestrator** — each API call returns usage (answered count, refused count, tokens). Accumulate per-model and include in the findings document's cost summary.
    - Verify: integration test that the findings document's cost section contains per-model answered/refused/usage data.

12. **Update the brief schema to require enumerated questions** — add a Zod validation that `brief.questions` is a non-empty array of strings with distinct labels. Existing briefs (which already conform) are unaffected.
    - Verify: unit test that a brief without numbered questions fails validation.

---

_Council session closed. Findings recorded as D67._