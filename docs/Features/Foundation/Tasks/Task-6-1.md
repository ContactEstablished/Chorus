# Task 6-1 — The Council Gate and the D4 Pass (Stage 0)

**Phase:** 6 · **Task 1 of 5** · **Depends on:** none. **Blocks:** every other task in the phase.

## Source Of Truth

- [`Phase-6-Overview.md`](Phase-6-Overview.md) — the purity contract, and **D100/D101/D102**.
- [`../Phase-6-MemoryPlan.md`](../Phase-6-MemoryPlan.md) — **§10 (D4 obligations) and §12 (what the
  brief must contain) are this task's actual specification.**
- `../ImplementationSpecs/ImplementationSpec-6-1.md`.
- Roadmap §4 — the CR mechanism; §6 **D67** — the protocol this task uses and does not change.
- `../CouncilBriefs/CouncilBrief-3b.0-ApiSessionProducer.md` — **the format precedent**, and the only
  brief with five data points behind it.

## Initial Starting Point (verified 2026-07-28 at `3fa295d`)

- **The council runs natively and is proven.** Run `c06874ad` completed 4/4 members, 8 turns, 0
  refused, `usage for 8 absent for 0`, **$1.08921689 in 21 minutes**.
- **The roster exists in the real DB** — 4 members, all with `params_json` `{"max_tokens":16000}`
  (32,000 for the arbiter), all on one OpenRouter credential profile.
  **⚠ `params_json` IS SETTABLE AT CREATE ONLY** — `updateCouncilMember` takes `{id,label}` — so a
  mistake means deleting and recreating all four.
- `RESPONSE_CAP_BYTES = 8_000_000` (`apiSession.ts`) — raised by 3e-2 on a measured basis.
- **`council:transcript` exists**, so this run's deliberation is re-openable afterwards (D97/3e-4).
- Tool versions re-probed today: codex **0.145.0**, claude **2.1.218**, opencode **1.18.8**, kimi
  **0.29.1**, docker **28.0.4**, uvx/uv **0.11.19**, npx **11.12.1** — all on PATH.
- **Nothing in `src/` relates to Neo4j.** No `neo4j-driver`, no `dockerode`, no `memory_*` table, no
  provisioner. `mcp` is `null` on all five adapters.

## Goal

**Close `[CR: memory schema + provenance model]` — the phase's G5 gate — and establish, by
measurement rather than by reading, the six facts plan §10 lists as unverified.** The output is a
brief, a findings document, a recorded decision, and an evidence appendix that says *how* each fact
was obtained. **No production code.**

## Exact Scope

**Create:**
- `docs/Features/Foundation/CouncilBriefs/CouncilBrief-6.0-MemorySchemaProvenance.md`
- `docs/Features/Foundation/Investigations/6-1-D4-Pass.md`

**Edit:** `docs/Features/Foundation/roadmap.md` (the CR findings as a numbered decision, and the
phase table).

**The findings `.md` lands beside the brief automatically** — main derives the path; do not author it
by hand.

## Non-Goals

- **⚠ NO PRODUCTION CODE. NONE.** Not a type, not a test, not a `package.json` line. If a D4 probe
  needs a script, it goes in the session scratchpad, never in `src/` or `scripts/`.
- **Do not install `neo4j-driver` or `dockerode`.** D100 approves the former **for Task 6-3**.
- **Do not change the deliberation protocol** (D67, closed). This task *uses* the council.
- **Do not edit `Plan.md`.** D102 says annotate via the roadmap — the D42/LiteLLM precedent.
- **Do not revert or commit unrelated changes.** The tree is clean at `3fa295d`; keep it that way
  apart from this task's own files.
- **Do not answer the CR's questions yourself in the brief.** The brief asks; the council answers.

## Dependencies

None. **But it blocks all four remaining tasks, and that is G5, not sequencing preference.**

## Step-by-step Work

1. **Re-run every §10 D4 probe** and record the date and the **method**, not just the answer. The
   three-way split — live-probed / binary-inspected / unverified — is mandatory (spec §1).
2. **Establish the six unverified items** (spec §2). Two of them can change the design: whether the
   Neo4j MCP server connects with auth disabled, and whether the loopback publish is really
   loopback-only.
3. **Write `6-1-D4-Pass.md`** — the evidence, with its provenance labels intact.
4. **Author the brief** (spec §3). **⚠ It opens with "answer these questions; do not review this
   document."**
5. **State the envelope, then run the council** (spec §4).
6. **Record the findings as a numbered decision** and close G5 in the roadmap (spec §5).

## Test Expectations

**None, and this is the one task in the phase where that is correct rather than a gap.** It adds no
code, so there is nothing to unit-test. `npx vitest run` must still report **1055 across 30 files**
— if it moved, something outside this task's scope was touched.

## Verification Commands

```bash
npm run typecheck && npx vitest run && npm run grep:secrets
```

```bash
git status --porcelain -- src/ package.json package-lock.json    # EMPTY — no code, no deps
grep -c "^## Dissents preserved" docs/Features/Foundation/CouncilBriefs/CouncilBrief-6.0-MemorySchemaProvenance-Findings.md   # exactly 1
grep -n "answer these questions" docs/Features/Foundation/CouncilBriefs/CouncilBrief-6.0-MemorySchemaProvenance.md           # in the first 20 lines
```

## Acceptance Criteria

- [ ] `git status` shows **no change under `src/`** and **no dependency added**.
- [ ] `6-1-D4-Pass.md` exists and **every fact in it carries how it was obtained and on what date.**
- [ ] The brief exists, opens with the do-not-review instruction, and puts **all five** of plan §12's
      questions plus anything the D4 pass turned up.
- [ ] **A real council run completed**, its findings landed beside the brief, and the run id is
      recorded.
- [ ] The CR's findings are recorded as **a numbered decision in the roadmap**, with dissents noted
      and **the coordinator's own resolutions stated separately from the council's** (the D33/D63
      idiom).
- [ ] **G5 is marked closed in the roadmap**, naming the decision that closed it.
- [ ] Cost stated against the ~$2.20 envelope, **as a bound, saying which number is quoted.**
- [ ] **If a D4 finding contradicts the design, that is written down and the affected task doc is
      amended** — not left for the implementer of 6-2 to discover.

## Review Checklist

1. **`git diff --stat -- src/` is empty.** This is the whole purity claim of the task.
2. **The evidence appendix keeps its three-way split.** ⚠ *"A council reasoning from an unmarked mix
   of live-probed, binary-inspected and unverified facts produces confident findings about facts
   nobody established"* — the D70 failure, which came one ratification away from being adopted.
3. **The brief's first line tells the council to answer rather than review.** Standing failure mode;
   check it literally.
4. **The recorded decision separates the council's findings from the coordinator's resolutions.** A
   council does not get to ratify itself.
5. **The cost figure says whose number it is.**
6. **Question 4 — the D93 posture — actually got an adversarial read.** The plan names it *"the
   question most worth an adversarial read"*; if the council merely agreed with it, say so plainly
   rather than treating agreement as validation.
