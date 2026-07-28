# 3e-1 — The Measurement

**Run `4c17069c-5fd4-4750-8671-5149281cfce5` · 2026-07-28 · code at `49066ef` + the transcript
commit.** Brief: `CouncilBrief-3b.0-ApiSessionProducer.md`, **verbatim** (D98) — the same brief all
four prior data points used.

## Envelope, stated before the run

**~$0.83 expected** (D71's measured figure for this exact brief and roster) against the **~$4.00**
Matthew authorised for the phase.

**Actual: `$0.65792506` — and that figure is a FLOOR, not a total.** One of the seven turns
returned no `usage` block (`usage reported for 6, absent for 1`), so Chorus cannot know what that
turn cost. **This is Chorus's own number; it has not been checked against OpenRouter's billing
page.** Anyone needing the true total must look there.

**Phase spend to date: `$0.037` (the aborted first attempt) + `$0.658` = `$0.695` of ~$4.00.**

## The roster

Rebuilt through `council-member:create` — the app's own channel, never SQL (D71's discipline).
**All four ids re-checked against OpenRouter's live `/models` on 2026-07-28**, which returned
**339** models:

| Member | Role | Model | Present | Rate (in / out) |
|---|---|---|---|---|
| CR Kimi (k3) | member | `moonshotai/kimi-k3` | ✅ | $3.00 / $15.00 per M |
| CR GLM (5.2) | member | `z-ai/glm-5.2` | ✅ | $0.77 / $2.42 per M |
| CR Qwen (3-coder) | member | `qwen/qwen3-coder` | ✅ | $0.30 / $1.00 per M |
| CR Arbiter (opus-5) | **arbiter** | `anthropic/claude-opus-5` | ✅ | $5.00 / $25.00 per M |

### ⚠ The first attempt aborted, and the reason is a documentation defect worth more than the run cost

**Run `c68a8eee` aborted on D67 Q6's two-member floor: "Only 1 of 3 members answered."** Cost
**$0.037**, no document produced.

**Cause: `params_json` was written with the key `max_completion_tokens`, and Chorus reads
`max_tokens`.** `resolveMaxOutputTokens` (`councilService.ts:1119`) reads `member.params.max_tokens`
and falls back to `MAX_OUTPUT_TOKENS_DEFAULT = 1200` when it is absent — **silently, because an
absent parameter is a legal state.** Every member therefore got **1,200** output tokens instead of
16,000; two of the three reasoning members spent the entire budget on reasoning and returned
**empty content** (`tokens_out: 1200` exactly, `"The model returned an empty answer (its output
budget may have gone to reasoning)"`).

**⚠ THE ROADMAP'S D71 ROW RECORDS THE VALUES AND NOT THE KEY.** `max_completion_tokens` is
OpenRouter's own API field name, which is exactly why it is the wrong guess: **Chorus's
`params_json` is read, not passed through.** Anyone rebuilding this roster from D71 alone makes the
same mistake. `ImplementationSpec-3e-1.md` §2 **carried the same wrong key and has been corrected**;
the correction is the durable output of that $0.037.

**⚠ AND `params_json` CANNOT BE EDITED — it is settable at create only** (`updateCouncilMember`
takes `{id, label}`). Fixing it meant deleting and recreating all four members.

## Result 1 — verdict-token compliance, on the frontier roster

**4 of 6 questions resolved STRUCTURALLY; 2 of 6 fell to `model-judged`.**

| Q1 | Q2 | Q3 | Q4 | Q5 | Q6 |
|---|---|---|---|---|---|
| structural | structural | structural | structural | **model-judged** | **model-judged** |

**F38 measured the inverse — 4 of 6 falling to `model-judged`** — on the cheap roster at the
700-token cap. **The structural arm now carries two thirds of the questions where it previously
carried one third.**

**⚠ THIS IS NOT ATTRIBUTABLE TO ANY SINGLE DIAL, AND READING IT AS "THE TUNING FIXED IT" IS THE
EXACT OVER-READ D67 FILED F38 AS A NOT-CHECKABLE PREDICTION TO PREVENT.** Between the two
measurements the **roster**, the **output ceiling**, the **mint cap** and the **turn timeout** all
changed. Worse for comparability: **this run had only 2 of 3 members answering** (kimi refused), so
the structural arm had **fewer verdicts to reconcile** than F38's run did — which could plausibly
make agreement easier to detect rather than harder. **The honest claim is: on this roster, in this
run, the structural arm resolved 4 of 6.** It is a number, it is written down, and it is better
than the last one. It is not proof the mechanism was repaired.

**F38's compliance half is DISCHARGED as "measured", not as "fixed".**

## Result 2 — F39, and it is decisive

The instrument (D96) reported every turn:

| Turn | Bytes | Outcome |
|---|---|---|
| **CR Kimi (k3) · positions · round 0** | **4,000,372** | **CAPPED** at 4,000,000 |
| CR GLM (5.2) · positions · round 0 | 692,858 | completed |
| CR Arbiter (opus-5) · arbitration · round 2 | 265,887 | completed |
| CR Qwen (3-coder) · critique · round 1 | 140,472 | completed |
| CR Arbiter (opus-5) · synthesis · round 3 | 137,416 | completed |
| CR Qwen (3-coder) · positions · round 0 | 136,009 | completed |
| CR GLM (5.2) · critique · round 1 | 59,376 | completed |

**Kimi streamed 4,000,372 bytes. The largest turn that COMPLETED streamed 692,858 — a ratio of
5.8×.**

### ⚠ RETRACTION — the first reading of this was "pathological" and it was WRONG

**Filed 2026-07-28, before any code acted on it, after Matthew asked whether kimi actually had to
be dropped.** The 5.8× was read as *"kimi is not producing a longer answer, it is producing an
unbounded one"*. **That inference does not hold, because it compares BYTES across models whose
bytes-per-token differ by 20×.**

Computed from this run's own `council_messages` rows — stream bytes ÷ `tokens_out`:

| Member | turn | output tokens | stream bytes | **bytes / token** |
|---|---|---|---|---|
| CR Arbiter (opus-5) | synthesis | 13,922 | 137,416 | **9.9** |
| CR Arbiter (opus-5) | arbitration | 20,198 | 265,887 | **13.2** |
| CR GLM (5.2) | positions | 11,293 | 692,858 | **61.4** |
| CR GLM (5.2) | critique | 898 | 59,376 | **66.1** |
| CR Qwen (3-coder) | critique | 698 | 140,472 | **201.2** |
| CR Qwen (3-coder) | positions | 663 | 136,009 | **205.1** |

**SSE framing overhead per token is a property of the model's chunking granularity, not of how
much it said.** GLM emitted **11,293** output tokens in a single turn — 71% of its 16,000
allowance — and completed, because its framing is ~3× tighter than Qwen's.

**At Qwen's ratio, a 16,000-token allowance is ~3.3 MB.** So kimi reaching 4 MB is entirely
consistent with **spending the allowance Chorus gave it** under slightly more verbose framing. The
byte cap and the token allowance were never reconciled with each other, **and that inconsistency —
not the member — is the defect.**

### What is actually established, stated narrowly

- Kimi's bytes-per-token is **> 250** (it exceeded 4,000,000 bytes inside a 16,000-token budget).
- Its actual ratio is **UNKNOWN**, because the capped turn reported **no `usage` block at all** —
  so there is no token count to divide by. **The instrument cannot answer this alone; it needs one
  turn that completes.**
- **F39 IS NOT RESOLVED.** It is better understood and still open. The earlier "resolved by
  measurement" claim in this document is withdrawn.

**⚠ THE GENERAL LESSON, WHICH IS WORTH MORE THAN THE FINDING: a ratio between two measurements is
only meaningful if they share a unit.** The instrument was built to stop F39 being answered by
argument, and its first use was very nearly an argument dressed as a number.

### Matthew's ruling, 2026-07-28: kimi stays

No replacement member is needed and the roster is unchanged. `ImplementationSpec-3e-2.md` §3
already offers **"bound the member, or drop it"** — 3e-2 takes the **bound**. Two candidates, to be
chosen on evidence:

1. **Lower kimi's own `max_tokens`** until its worst-case stream fits the existing cap. **Touches
   no global constant.** ⚠ Risk, observed on the aborted first attempt: a reasoning model given
   too small a budget spends all of it on reasoning and returns **empty content**. 1,200 was far
   too small; the floor for a useful answer is unmeasured.
2. **Raise `RESPONSE_CAP_BYTES` on a COMPUTED basis** — worst observed ratio (205) × largest
   allowance (32,000, the arbiter) = **6.6 MB**, making the 8 MB `modelCatalog` cap the natural
   value. ⚠ This is **not** the guess D63(e) forbids: it is derived from measured ratios. It also
   replaces the constant's current *"HALF `modelCatalog`'s 8 MB"* relationship, which its own
   comment shows was never computed either.

**Either way, one more run is needed to learn kimi's real ratio, and that run only yields it if
kimi's turn COMPLETES.** Budget remaining: **~$3.30**.

**⚠ AND F39's SECOND HALF REPRODUCED: the capped turn contributed NO `usage` block** (`usage
reported for 6, absent for 1`), so **every cost figure from a run kimi participates in is a
floor.** That is the under-reporting F39 predicted, now observed directly rather than inferred.

**⚠ A DECISION FOR MATTHEW, NOT FOR THE IMPLEMENTER:** dropping kimi leaves **two** deliberating
members — **D67 Q6's floor with zero margin**, where one more failure aborts the run. This run
already proves that: it ran with 2 and survived only because neither of the survivors failed. **If
kimi is dropped, the roster needs a replacement member**, and choosing one is Matthew's call.

## Result 3 — the three boxes Phase 3c-5 left UNPROVEN

All three discharged by this run:

- ✅ **A real run streams into the restyled `CouncilView`** — turns appeared live, phase track
  advanced `positions → critique → arbitration → synthesis → done`.
- ✅ **The findings `.md` landed beside the brief** —
  `CouncilBrief-3b.0-ApiSessionProducer-Findings.md`, **39,832 bytes**, ending cleanly.
- ✅ **F37 grouping holds** — **7 turn blocks for 7 turns**, not hundreds of fragments.
- ⚠ **Esc-refuses-to-leave-mid-run was NOT tested** and stays **UNPROVEN**. The run was driven
  headlessly and pressing Esc mid-run would have risked a $0.66 run to test a guard. It is a
  keystroke on a live run; it belongs to 3e-2's proving run.

## Other things this run exposed — recorded, NOT fixed

- **F40 did not reproduce in this document.** `grep -c "^## Dissents preserved"` on the findings
  returns **1**. ⚠ **That is not evidence F40 is absent** — this was a **partial** run whose
  arbiter may simply not have written the section, so the core's unconditional append had nothing
  to duplicate. **3e-2 must re-check on a full run before closing F40**, and must not read this as
  a fix.
- **The partial-run banner works exactly as designed** — the document opens with *"⚠ PARTIAL RUN —
  2 of 3 members completed"* and names kimi's refusal and its reason. A partial run reads as
  partial.
- **Cost precision:** the UI renders `$0.65792506` in full. Not wrong, but the mock shows `$0.83`.
  A rendering decision, deliberately not taken here.

## Bottom line

| Item | Status |
|---|---|
| Verdict-token compliance on the frontier roster | **MEASURED: 4 of 6 structural.** Improved; **not** proven repaired |
| F39 — pathological vs cap-too-small | **⚠ STILL OPEN — the "pathological" reading is RETRACTED.** It compared bytes across models whose bytes/token differ **20×**. The real defect is that the byte cap and the token allowance were never reconciled. **Kimi stays** (Matthew, 2026-07-28); 3e-2 bounds rather than drops |
| F39 — no usage block | **REPRODUCED.** Every cost figure including kimi is a floor |
| 3c-5's streaming proof | **3 of 4 boxes discharged**; Esc-mid-run still unproven |
| F40 | **Not reproducible on a partial run.** Still open, owned by 3e-2 |
