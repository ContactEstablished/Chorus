---
case_id: 7c1f4a2e-9d3b-4e51-8a6c-2f0b5d84e913
project: Chorus
phase: 3f
opened: 2026-08-01
---

# CR-3f.0 — The Exhibit Pack: bounding and confining the first deliberate exfiltration surface

> **⚠ ANSWER THE QUESTIONS IN SECTION 4. DO NOT REVIEW THIS DOCUMENT.** This is a case put to the
> council, not a design document submitted for critique. Do not comment on its structure, length,
> completeness or wording. Every question in §4 requires a `Qn: AGREE | DISAGREE | QUALIFY` verdict
> token on its own line, followed by your reasoning.

---

## 1. Context

**Chorus** is a local-first Windows desktop app (Electron · Vue 3 · TypeScript · SQLite) for running
several AI coding agents in parallel terminal panes. It contains a **native multi-model Council
Review** feature, shipped and in daily use: 3–5 API-mode council members plus an arbiter deliberate
over a document in four phases — blind positions, critique, arbitration, synthesis — and emit a
findings document. You are that council. This case is about a change to how you are fed.

**Today a council member can only reason about text pasted into the document by hand.** Members are
plain API calls; they have no filesystem, no tools, and no retrieval. A question about the codebase
is therefore answered from whatever a human thought to paste in, which is both laborious and
silently lossy.

**The proposed change — "exhibits".** A case may declare an `## Exhibits` section listing repository
paths and globs. Before the blind round, the main process resolves them into a numbered,
path-labelled, line-numbered pack and appends it to the case text **every member receives
byte-identically**. Members never choose what to read.

**⚠ THIS IS THE FIRST FEATURE IN THE PROJECT THAT SENDS PROJECT SOURCE CODE TO THIRD-PARTY APIS BY
DESIGN, AND THAT IS WHY IT IS BEFORE YOU.** Everything shipped so far moves in the opposite
direction — see §3. The design is settled; **its bounds are not**, and two numbers were deliberately
left unset rather than guessed.

**⚠ THE HONEST LIMIT OF THIS RUN, STATED UP FRONT:** exhibits do not exist yet, so **this council is
deliberating about repository access without having any.** The code and figures in §2 and §3 were
pasted in by hand and are the only evidence you have. If an answer depends on a fact not present in
this document, say so explicitly rather than inferring it — "insufficient information" is a
legitimate finding here and is more useful than a confident guess.

---

## 2. The mechanism as it will be built

**Resolution.** Only the `## Exhibits` section is read. Paths and globs resolve against a root chosen
per run — the project root by default, or one of the project's git worktrees. Resolution is
`realpath`-confined to that root. Path-like strings appearing anywhere else in the case are **not**
resolved: the project's own documents are full of file paths written as prose, and sniffing them
would turn every mention into a paid exhibit.

**Delivery.** Full exhibit text is sent in **round 0 (blind positions) only**. Later rounds receive
the exhibit *index* — number, path, line range — and cite by number. The reason is mechanical: the
case text is re-sent on every round (four sequential phases), so an unbounded pack multiplies the
single largest cost in the feature by the number of rounds.

**Measured cost baseline, from this project's own runs.** A full four-member deliberation on a
~40 KB case costs **$1.089** and takes **21 minutes** (run `c06874ad`, 8 turns, usage reported for
all 8). An earlier estimate of ~$0.83 was wrong because it was computed from runs in which one
member never finished — a partial-run number used as a full-run number.

**Truncation.** If the pack exceeds its bound, the run proceeds with what fits and the truncation is
rendered in the UI **and written into the findings document**. It is never silent.

**Why not give members retrieval tools instead.** Rejected before this case was written, on the
following argument, which you may attack in Q6: the council's output includes a **mechanically
computed disagreement vector** — per question, per member, from each member's own verdict token —
and a "structural" disagreement is only meaningful if every member answered from the same evidence.
Members that fetch different files produce disagreements that record what each model chose to read
rather than what it concluded. Tool-calling support across the current roster is also uneven, so a
capability gap would silently become a quality gap.

---

## 3. Binding prior rulings — constraints on your answer, not open questions

These are settled decisions in this project. **Do not re-litigate them.** An answer that requires
overturning one of them is out of scope; say so and answer within the constraint.

1. **Secrets never leave the vault in plaintext.** API keys are encrypted at rest with the OS
   credential store, decrypted only at process launch, injected only as environment variables —
   never in command-line arguments, never written to disk in plaintext, never logged, never written
   into a transcript.
2. **Scrub on ingest, not on display.** Every byte of model output passes an exact-value scrubber at
   the single ingest seam before it reaches any buffer, view, or stored transcript. Proven live: a
   planted secret arriving over 19 streamed chunks was ingested as a single redaction placeholder.
3. **Refuse, never degrade.** Where a security property cannot be guaranteed, the shipped behaviour
   is to refuse the operation with an actionable message — not to proceed with a weaker guarantee.
4. **A repository-wide secret grep runs as a release gate**, over the source tree and scripts. **It
   does not and cannot cover a prompt in flight**, and it does not reach files outside the project.
   This is a stated limit, not an oversight.
5. **No number without its denominator.** A count derived from partial data must carry the
   denominator that makes it honest; a truncated or partial reading may never render as a complete
   one. This rule is enforced by schema in one subsystem already and is being extended to the
   council's own verdict summary.
6. **The deliberation protocol itself is closed.** Four phases, blind first round, unconditional
   preservation of dissent. Not in scope here.

---

## 4. Questions — answer each one; do not review this document

Each answer must begin with a verdict token on its own line, exactly in the form `Q1: AGREE`,
`Q1: DISAGREE` or `Q1: QUALIFY`, followed by your reasoning in prose. Use **QUALIFY** when you
support the proposal only under a condition you must then state.

1. Exhibit eligibility should be restricted to files **tracked by git** (`git ls-files`) rather than
   governed by a deny-list of patterns such as `.env*`, `*.pem` and `id_*`, because an ignored file
   is already the repository's own declaration that it does not belong in shared history.

2. When a secret-shaped pattern matches inside a resolved exhibit, the correct behaviour is to
   **refuse the entire run** with the offending path named, rather than dropping that exhibit and
   disclosing the drop in the findings.

3. The exhibit pack should be bounded by a **byte budget on the assembled pack** — a single number,
   checked after resolution and before the first API call — rather than by a per-file cap, a file
   count, or an estimated token count. State the number you would set and your reasoning for its
   magnitude.

4. A run whose estimated cost exceeds a fixed threshold should require an **explicit confirmation**
   naming the estimate before any API call is made, rather than proceeding and reporting the cost
   afterward. State the threshold you would set, in US dollars, given the measured $1.089 baseline
   for a four-member run on a case with no exhibits.

5. Sending full exhibit text in the **blind round only**, and an index thereafter, will materially
   degrade the quality of the critique and arbitration rounds — because a member asked to critique
   another's position may need to re-read the source to judge whether the position is supported.

6. **Evidence parity is the right principle and the argument in §2 is sound**: an identical
   pre-resolved pack is genuinely superior to per-member retrieval for a council whose output
   includes a computed disagreement measure — rather than a rationalisation of the simpler
   implementation.

---

## 5. What a useful answer looks like

- A verdict token for every question, on its own line, before the prose.
- Where you disagree, say what you would do **instead**, concretely enough to build.
- Where a question asks for a number, **give a number**, and say what it is derived from. A range is
  acceptable; a refusal to commit is not, unless you state which missing fact would settle it.
- Where you believe a question rests on a false premise, say which premise and why — but check §3
  first, because several premises are settled rulings rather than assumptions.
