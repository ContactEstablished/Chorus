# 3e-2 — The Proving Run, and What It Corrected

**Run `c06874ad-7c89-4548-8f46-1314658b874d` · 2026-07-28 · 21 minutes · `$1.08921689`.** Brief:
`CouncilBrief-3b.0-ApiSessionProducer.md`, **verbatim** (D98) — the fifth data point against it.
Findings: `CouncilBrief-3b.0-ApiSessionProducer-Findings-2.md`, **54,640 bytes** (main derived a
non-clobbering path, so 3e-1's document survives on disk beside it).

**⚠ THE FIRST RUN IN THE PROJECT'S HISTORY WHERE ALL FOUR MEMBERS ANSWERED.** `4/4 members
answered · 0 refused · 8 turns answered, 0 refused · usage reported for 8, absent for 0`.

## Envelope, stated before the run

**~$0.83 expected** (D71's figure) against **~$3.30 remaining** of the ~$4.00 Matthew authorised.

**Actual `$1.08921689` — 31% OVER the estimate, and the overrun is explained rather than absorbed.**
Every prior figure for this brief came from a run kimi did not finish. Kimi contributed **23,991
output tokens at $15/M ≈ $0.36** — on its own most of the gap. **The ~$0.83 estimate was a
partial-run number being used as a full-run number.**

| | |
|---|---|
| Phase spend to date | `$0.037` + `$0.658` + `$1.089` = **`$1.784`** of ~$4.00 |
| Remaining | **~$2.22** |
| Duration | **21 min** (16:02:46Z → 16:23:46Z) vs the ~14 min estimate — also a first-full-run figure |

**⚠ THIS FIGURE IS NOT A FLOOR, AND THAT IS ITSELF A FINDING** — see F39's second half below. It is
still Chorus's own number and **has not been checked against OpenRouter's billing page.**

## The row F39 landed in, quoted as Task 3e-2 step 1 requires

`ImplementationSpec-3e-1.md` §4.2, **row 2**:

> | kimi ≈ the largest successful turns, just over the line | **the cap is too small for this roster** | raise `RESPONSE_CAP_BYTES` **to a stated multiple of the observed maximum**, with the number in the commit message |

**⚠ IT LANDS THERE ONLY AFTER NORMALISING TO A SHARED UNIT, AND SAYING SO IS THE WHOLE POINT.** Read
in the raw BYTES the table itself uses, 3e-1's figures (kimi 4,000,372 vs largest completed 692,858
— 5.8×) look like **row 1, "pathological"** — and that is exactly the reading 3e-1 retracted.
Normalised: every member had the same 16,000-token allowance, kimi was inside it, and a **byte**
bound stopped it before its **token** bound did. The cap was the binding constraint. Row 2.

**And this run settled it empirically rather than by argument.**

## Result 1 — F39 is RESOLVED, and the cap was the binding constraint

The instrument (D96) on all eight turns, against the new 8,000,000 cap:

| Turn | Stream bytes | `tokens_out` | **bytes / token** | Under the OLD 4 MB cap? |
|---|---|---|---|---|
| **CR Kimi (k3) · critique · r1** | **4,168,377** | 10,237 | **407.2** | ❌ **REFUSED at 104% of it** |
| CR Kimi (k3) · positions · r0 | 2,446,913 | 13,754 | 177.9 | ✅ would have passed |
| CR GLM (5.2) · positions · r0 | 525,405 | 3,922 | 134.0 | ✅ |
| CR Arbiter (opus-5) · arbitration · r2 | 316,539 | 23,044 | 13.7 | ✅ |
| CR Arbiter (opus-5) · synthesis · r3 | 173,148 | 17,694 | 9.8 | ✅ |
| CR Qwen (3-coder) · positions · r0 | 171,088 | 802 | 213.3 | ✅ |
| CR Qwen (3-coder) · critique · r1 | 143,820 | 735 | 195.7 | ✅ |
| CR GLM (5.2) · critique · r1 | 20,843 | 1,853 | 11.2 | ✅ |

- **KIMI'S REAL RATIO IS MEASURED AT LAST: 177.9 – 407.2 bytes/token.** This is what the run was
  for, and it only yields it because kimi's turn **completed**.
- **⚠ 3e-1's BOUND OF "> 250" WAS TOO STRONG.** Kimi's positions turn ran at **177.9**, below it.
  The `> 250` was a property of one capped turn, not of the model. Kimi's ratio **straddles** it and
  varies **2.3× within a single run**.
- **⚠ AND KIMI'S STREAMS STRADDLE THE OLD CAP.** 2.45 MB passed it; 4.17 MB did not. **A single
  observation could not have set this bound**, which is why it is derived from the allowance.

### ⚠ THE DERIVATION IN MY OWN FIRST DRAFT WAS THE SAME UNIT ERROR 3e-1 RETRACTED

The cap was raised **before** this run, on: *worst measured ratio (205.1, qwen) × the largest
allowance any member gets (32,000, the arbiter's) = 6,563,200.* **That is a cross-model product** —
one model's framing against another's budget — and it is precisely the mistake the retraction was
filed for. **It landed within 1% of the right answer by luck.**

Corrected, per member — **each model's own worst ratio × its OWN allowance**:

| Member | worst ratio | own allowance | worst-case stream |
|---|---|---|---|
| **CR Kimi (k3)** | **407.2** | 16,000 | **6,515,200** ← the binding case |
| CR Qwen (3-coder) | 213.3 | 16,000 | 3,412,800 |
| CR GLM (5.2) | 134.0 | 16,000 | 2,144,000 |
| CR Arbiter (opus-5) | 13.7 | 32,000 | 438,400 |

**`RESPONSE_CAP_BYTES = 8_000_000` is 1.23× the binding case** and tolerates up to **500
bytes/token** at a 16,000-token allowance. The constant's comment carries this arithmetic, the wrong
first version, and the reason it is called out rather than quietly replaced.

**⚠ THE ASYMMETRY WITH `modelCatalog` IS DISSOLVED, DELIBERATELY.** The old comment argued 4 MB as
*"HALF modelCatalog's 8 MB"* because *"4 MB is roughly a million tokens of prose"*. **That
arithmetic was about TEXT; the bound counts SSE FRAMES.** At kimi's 407 bytes/token, 4 MB is ~9,800
tokens — the cap was ~100× tighter than its own comment believed for the one member that kept
hitting it. The two caps are equal now because nobody has measured a reason for them to differ.

**⚠ STILL THE WRONG SHAPE, RECORDED NOT FIXED.** A byte cap and a token allowance bounding one
stream, never reconciled, is the defect F39 actually exposed. The honest fix is a **per-turn** bound
derived from that turn's own allowance — `maxResponseBytes` is already a dep of
`createApiSession` — and that is a `councilService` change Task-3e-2's Exact Scope does not reach.
**If a member ever exceeds 500 bytes/token, that is the answer, not another global raise.**

## Result 2 — F39's second half DID NOT reproduce, and the reason dissolves it

3e-1 recorded *"the capped turn contributed NO `usage` block… every cost figure from a run kimi
participates in is a floor."* This run: **`usage reported for 8, absent for 0`.**

**⚠ THE MISSING USAGE BLOCK WAS A PROPERTY OF THE ABORT, NOT OF THE MODEL.** An aborted stream never
receives the final SSE frame that carries `usage`. Kimi reports usage perfectly well when allowed to
finish. **So the cost under-reporting F39 predicted was a SYMPTOM of the cap firing, and fixing the
cap fixed it too** — one cause, two observed defects. F35's narrowing follows: a completed run's
figure is Chorus's own number, not a floor.

## Result 3 — F40 is CLOSED, and 3e-1's record of it was WRONG

**⚠ 3e-1's DOCUMENT SAYS `grep -c "^## Dissents preserved"` RETURNED 1 ON RUN `4c17069c`. IT
RETURNS 2.** Verified on the committed file (`21d255c`):

```
$ grep -n "Dissents preserved" CouncilBrief-3b.0-ApiSessionProducer-Findings.md
364:## Dissents preserved      <- the arbiter's own section
420:## Dissents preserved      <- the core's unconditional append
```

**F40 reproduced on the very document that was recorded as not reproducing it.** 3e-1's warning
("this is not evidence F40 is absent") was right in spirit; the observation under it was
mis-measured. Its byte figure for the same file is also off — **40,057, recorded as 39,832.**

**After the fix, on this run's full-council document:**

```
$ grep -c "^## Dissents preserved" ...-Findings-2.md
1
306:## Dissents preserved                                  <- the arbiter's, untouched
396:### Dissents preserved — the orchestrator's record      <- the core's, demoted
```

The defect condition was **present** — the arbiter did write its own section — so this is the fix
working, not the defect being absent.

**Lane (a), the code-shaped guarantee, and the synthesis prompt is BYTE-IDENTICAL.** Lane (b)
(instruct the arbiter not to write the section) was declined for three reasons: the spec prefers
(a); (b) depends on the arbiter obeying and the duplicate returns **silently** when it does not; and
leaving the prompt alone is what let F40 **reproduce** on this run so the fix could be shown rather
than asserted.

**⚠ THE UNCONDITIONAL APPEND IS UNTOUCHED.** 13 dissent lines are in the document. The condition
governs a **heading level**; it can never govern the presence of the lines. D67 Q5 ruling 5C stands.

## Result 4 — verdict-token compliance on a FULL frontier roster

**5 of 6 questions resolved STRUCTURALLY, 1 fell to `model-judged`.**

| Q1 | Q2 | Q3 | Q4 | Q5 | Q6 |
|---|---|---|---|---|---|
| structural | structural | structural | structural | structural | **model-judged** |

| Measurement | Roster | Cap | Structural |
|---|---|---|---|
| F38 | cheap | 700 | **2 of 6** |
| 3e-1 (`4c17069c`) | frontier, **2 of 3 answered** | 16,000 | **4 of 6** |
| **3e-2 (`c06874ad`)** | frontier, **3 of 3 answered** | 16,000 | **5 of 6** |

**⚠ STILL NOT ATTRIBUTABLE TO ANY SINGLE DIAL** — the same caution 3e-1 filed applies, and this run
changed the member count too. **But the per-question detail says something new and actionable: the
non-compliance is concentrated in a MEMBER, not in a question type.** `CR Qwen (3-coder)` emitted
**no verdict token on any of the six questions**; GLM missed only Q6. Q1–Q5 resolved structurally on
kimi's and GLM's tokens alone, and Q6 fell through because only kimi's survived.

**That is a prompt-compliance question about one model, and it is recorded here rather than fixed** —
3e-2's scope is F40, the matcher and F39.

## Result 5 — the dissent matcher

Both permitted changes shipped; nothing was capped, merged or dropped for similarity.

- **Precision — `statesNoObjection`.** A **closed list** of forms that can only mean "nothing",
  matched against the **whole body**, failing toward **keeping**. `DISAGREE: None` yields no
  dissent; `DISAGREE: None of the three addressed back-pressure` is kept.
- **Attribution, rendered ABOVE the list** (spec §2's "safest of the available fixes"). This run:

  > _13 preserved: 1 structural (computed from the members' own verdict tokens) · 12 from critique
  > prose, from 3 members — CR GLM (5.2) 4 · CR Kimi (k3) 4 · CR Qwen (3-coder) 4._

  **The split is even this time, and the rendering says so honestly.** The change is not "make the
  number smaller" — it is "say whose number it is". A future six-from-one will read as six-from-one.

**No non-objection labels appeared in this run**, so the precision half is proven by unit test and
not by this document. Stated rather than implied.

## Result 6 — the last box Phase 3c-5 left UNPROVEN

- ✅ **Esc REFUSES to leave mid-run.** Pressed during `positions`: still in the council view,
  `running: true`. **Ctrl+Shift+K refused too** — the second door out, same rule.
- ✅ **Negative control:** Esc after the run left for the workspace. So the refusal is a guard, not
  a broken keybinding. **One direction alone would have proved nothing.**
- ✅ **F37 grouping holds on 8 turns** — 8 live blocks for 8 turns, none fragmented.
- ✅ Streaming into the restyled view, and the findings `.md` landed beside the brief.

## Bottom line

| Item | Status |
|---|---|
| **F39** | ✅ **RESOLVED.** Row 2 — the cap was the binding constraint, proven by a turn at **104% of the old cap that completed under the new one**. Kimi's real ratio: **177.9–407.2 B/token** |
| **F39, second half** | ✅ **DISSOLVED.** The absent `usage` block was the abort's fault, not the model's. 8 of 8 reported |
| **F40** | ✅ **CLOSED** on a full run, with the defect condition present. **3e-1's record of it was wrong and is corrected here** |
| Dissent matcher | ✅ Precision (closed list, keeps on doubt) + per-member attribution. Recall untouched |
| Verdict-token compliance | **MEASURED: 5 of 6 structural.** ⚠ New finding: non-compliance is **one member's**, not one question type's |
| 3c-5's Esc box | ✅ **DISCHARGED**, both directions |
| Cost | **$1.089**, 31% over an estimate that was a partial-run figure. Phase: **$1.784 of ~$4.00** |
