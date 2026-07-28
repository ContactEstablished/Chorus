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
5.8×.** Against the median completed turn (140,472) it is **28×**.

**READING: this is ImplementationSpec-3e-1 §4.2's "pathological" row.** Kimi is not producing a
longer answer; it is producing an **unbounded** one. The other three models — including a
reasoning model and the arbiter on its largest turn — all finished comfortably inside 18% of the
cap.

**⚠ THEREFORE `RESPONSE_CAP_BYTES` MUST NOT BE RAISED.** Raising it would move the wall, not reach
the far side of it, and would re-authorise an unbounded stream — which is precisely what D63(e)
put the bound there to prevent. **3e-2 bounds or drops the member; it does not touch the constant.**

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
| F39 — pathological vs cap-too-small | **RESOLVED BY MEASUREMENT: pathological (5.8×).** Do not raise the cap |
| F39 — no usage block | **REPRODUCED.** Every cost figure including kimi is a floor |
| 3c-5's streaming proof | **3 of 4 boxes discharged**; Esc-mid-run still unproven |
| F40 | **Not reproducible on a partial run.** Still open, owned by 3e-2 |
