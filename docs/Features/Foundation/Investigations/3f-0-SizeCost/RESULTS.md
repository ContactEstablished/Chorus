# 3f-0 — Council size & cost instrument

**Built 2026-08-01.** Four variants of one new case (**CR-3f.1 — Where the Docket's truth lives**),
identical except for an appended `## 6. Exhibits` section. Purpose is **flow, orchestration and
bounds** — not the findings. The findings are a by-product.

**⚠ NO HISTORICAL CASE IS USED.** This is a new case with new questions, per Matthew's ruling of
2026-08-01.

## 1. The variants

Regenerate at any time with:

```bash
node docs/Features/Foundation/Investigations/3f-0-SizeCost/build-variants.mjs
```

| Variant | Files in pack | Bytes | KiB | ~tokens @3.5 B/tok | What it answers |
|---|---|---|---|---|---|
| **A** | 0 | 6,440 | 6.3 | ~1,840 | Same-case baseline. **Required** — every prior cost figure is for a different, larger document and is not a valid control. |
| **B** | 1 | 73,359 | 71.6 | ~20,960 | Does pack input register at all against an output-dominated bill? |
| **C** | 4 | 231,323 | 225.9 | ~66,092 | The realistic case — the council subsystem, whole. |
| **D** | 12 | 807,987 | **789.0** | ~230,853 | **The boundary probe.** |

**⚠ WHY D IS THE INTERESTING ONE.** `qwen/qwen3-coder` has a **262,144-token** context window and a
16,000-token output allowance, leaving ~246,144 for input. D is ~230,853 tokens **at 3.5 bytes per
token** — under the line. **At 3.0 bytes per token it is ~269,329 — over it.** Source code
frequently tokenizes nearer 3.0 than 3.5, so **D is deliberately placed where the answer is not
predictable from arithmetic.** What we want to learn is not whether it fits but **how it fails if it
doesn't**: loudly, with a refusal Chorus renders, or silently, with a truncated context nobody is
told about. A silent truncation is the worst outcome this feature could have and it is worth $3 to
find out now.

## 2. Predictions — recorded so the run can falsify them

The case text reaches **three member turns (positions) and both arbiter turns (arbitration,
synthesis)**. It does **not** reach the critique round — `buildCritiquePrompt` takes positions only,
not the brief. So input cost per token of case text, on the D71 roster:

| Consumer | Turns | $/M in | Contribution |
|---|---|---|---|
| kimi-k3 + glm-5.2 + qwen3-coder | 1 each | 3.00 + 0.72 + 0.30 | **$4.02/M** |
| arbiter (opus-5) | **2** | 5.00 × 2 | **$10.00/M** |
| | | | **total ≈ $14.02/M** |

**⚠ THE ARBITER COSTS MORE THAN ALL THREE MEMBERS COMBINED — 71% of every exhibit byte's input
cost — because it sees the case TWICE.** This was not in the design discussion, and it is the single
biggest lever on exhibit economics. It is why §4 exists.

Predicted **input** cost, before output:

| Variant | Predicted input $ | Predicted total $ (output assumed ~$0.30–0.80, roughly constant) |
|---|---|---|
| A | $0.026 | ~$0.35 |
| B | $0.294 | ~$0.60 |
| C | $0.927 | ~$1.25 |
| D | $3.237 | ~$3.55 |

**Envelope for all four: ~$5.75.** Each run is separately bounded by `COUNCIL_MINT_LIMIT_USD`
(**$10.00**, already), and the arbiter's 32,000-token allowance pre-authorizes $0.80 of it per
request (D71's measured lesson: OpenRouter pre-authorizes against the remaining limit).

**The hypothesis being tested:** that input is close to noise against an output-dominated bill, and
therefore **the pack cap is a context-window question, not a cost question.** If A→D shows total
cost roughly tracking the predicted input line, the hypothesis holds. If output moves too, the
answer-length instruction in the case failed and the runs are not comparable.

## 3. Results — fill in after each run

Pull the figures with:

```bash
node docs/Features/Foundation/Investigations/3f-0-SizeCost/read-run.mjs
```

| Variant | run id | status | tokens in | tokens out | **`cost_usd`** | OpenRouter billed | duration | answered | verdict tokens | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| **A** | `7dda3482` | complete | **35,722** | **30,117** | **$0.413684483** | **$0.66** ⚠ **+59.5%** | 11m 32s | **3 / 3** | **18 / 18** | Q5 split 3 ways · **F42** |
| **B** | `8087fbf5` | complete | **152,323** | **36,919** | **$0.733987** | **$1.13** ⚠ **+53.9%** · computed **$1.130450** | 12m 06s | **3 / 3** | _tbc_ | ratio **1.540**, not 1.596 |
| C | | | | | | | | / 3 | / 18 | |
| D | | | | | | | | / 3 | / 18 | |

### ⚠ Read the token columns from `council_messages`, NOT from `council_runs`

**`council_runs.tokens_in` and `tokens_out` are NULL on a completed run, and it is a code gap rather
than a quirk of this run.** The row is inserted with `tokensIn: null, tokensOut: null`
(`councilService.ts:694`) and `settle()` updates **only** `costUsd` (`:1031`); the per-turn figures
are written to `council_messages` (`:1074`) and never rolled up. `cost_usd` is populated, so the gap
is invisible unless you look for it. The 35,722 / 30,117 above are **summed from the message rows**,
which is what `read-run.mjs` does.

### ⚠⚠ F42 — `council_runs.cost_usd` UNDER-REPORTS BY 37%, AND IT IS NOT THE CAUSE PHASE 3e DIAGNOSED

**The most important result this instrument has produced, and it arrived on the control run.** The
roadmap has carried the caveat *"still Chorus's own figure, not checked against OpenRouter's billing
page"* since Phase 3b. **It is now checked.**

| Source | Figure |
|---|---|
| `council_runs.cost_usd` | **$0.413684483** |
| OpenRouter dashboard (Matthew, 2026-08-01) | **$0.66** |
| **Chorus's OWN stored tokens × live published prices** | **$0.660306** |

**⚠ THE DIAGNOSIS IS EXACT BECAUSE THE THIRD ROW EXISTS.** Summing `council_messages.tokens_in` and
`tokens_out` for all 8 turns, priced at each model's live rate from OpenRouter's free `/models`
(`kimi-k3` 3.00/15.00 · `glm-5.2` 0.72/2.25 · `qwen3-coder` 0.30/1.00 · `opus-5` 5.00/25.00),
reproduces the billed figure to **0.05%**. Therefore:

- **The token counts Chorus stores are CORRECT.**
- **The prices are correct.**
- **`cost_usd` alone is wrong** — it reports **62.7%** of true spend; the bill is **1.595×** it.

**⚠ AND IT IS A SECOND, INDEPENDENT DEFECT — 3e-2's CONCLUSION IS FALSIFIED AS A GENERAL CLAIM.**
Phase 3e found that a capped stream never receives the frame carrying `usage`, concluded *"one cause,
two observed defects"*, and recorded that fixing the byte cap fixed the under-reporting too. **That
holds only for the abort case.** This run had **zero turns with a NULL usage figure** — every one of
the 8 reported complete usage — **and it still under-reports by 37%.** The remaining defect is in how
`usageUsd` is DERIVED (`councilService.ts:1012–1043`), not in what was measured.

**⚠ CONSEQUENCES, AND THEY REACH BEYOND THIS INVESTIGATION:**

1. **Every cost figure recorded in the roadmap is low by roughly this factor.** Run `c06874ad`'s
   celebrated **$1.089** is likely **~$1.74**; Phase 3e's *"total spend $1.784 of ~$4.00 authorised"*
   is likely **~$2.85**. Those figures should be re-derived from `council_messages`, not re-run.
2. **⚠ D111 RESOLUTION (c) CANNOT BE BUILT ON `cost_usd` AS IT STANDS.** A $5.00 confirmation gate
   fed by this number would not fire until roughly **$8.00** of real spend. The threshold debate
   ($2.00 vs $5.00) was arguing about the wrong digit.
3. **`COUNCIL_MINT_LIMIT_USD` is unaffected and remains the real protection.** The $10 cap is enforced
   by OpenRouter's own pre-authorisation against the minted key, not by Chorus's arithmetic.
4. **The fix is available and cheap:** derive cost from the stored tokens × the model's published
   price — which is exactly the calculation that reproduced the bill above. The catalog already
   holds prices (`model_catalog`, v9).

**⚠ STATED LIMIT: this is ONE run at ONE roster.** The 1.595× ratio should not be treated as a
constant until B, C and D confirm it. **What is already established beyond this run is the
DIRECTION and the CAUSE** — the tokens are right, the derived dollar figure is not, and it is not the
abort gap.

### ✅ THE COMPUTED-FROM-TOKENS METHOD IS NOW CONFIRMED TWICE, AT TWO DIFFERENT MIXES

| Run | computed from stored tokens | OpenRouter billed | agreement |
|---|---|---|---|
| A | $0.660306 | **$0.66** | **0.05%** |
| B | $1.130450 | **$1.13** | **0.04%** |

**⚠ THE SECOND CONFIRMATION IS WORTH MORE THAN THE FIRST, BECAUSE THE MIX MOVED.** B's input/output
ratio is completely different from A's (input 44.0% of cost vs 20.4%), and the method still lands
inside 0.05%. **One agreement could be luck; two at different mixes is a verified method.** Meanwhile
`cost_usd` missed by **1.596×** and **1.540×** — confirming again that the error is not a constant.

### ⚠ THE MECHANISM, DIAGNOSED 2026-08-02 — IT IS A RACE, NOT AN ARITHMETIC BUG

**F42's original write-up assumed the arithmetic was wrong. It is not — the number was never derived
from the run's own data at all.** `cost_usd` is a single scalar read from the **minted key's spend
counter** (`councilService.ts:775` → `:1046–1050` → `openrouterKeys.ts:131–137`,
`GET /api/v1/keys/{hash}` → `parseCount(data.usage)`). That counter is OpenRouter's
**eventually-consistent** per-key aggregate: a generation joins it only once accounting finalises,
which is *after* the SSE stream closes. `settle()` reads it milliseconds after the last stream ends —
**and the very next call `DELETE`s the key, so the reading can never be revised.**

**⚠ THE ARITHMETIC PROOF IS THE CONVINCING PART.** Brute-forcing all 256 subsets of run A's per-turn
charges, the subset closest to the recorded $0.413684483 is **every turn except the last** —
$0.409346, within **1.06%** — and the last turn is the arbiter's **synthesis**, the final and most
expensive request of the run. All eight turns give $0.660306.

**So 62.7% was never a bias to correct for — it is whatever the race happened to catch, which is
strictly worse than a fixed offset**, and it explains the 1.596 / 1.540 variation directly.

**The fix that was already sitting there:** `apiSession.readUsage` parsed the final frame's `usage`
object for tokens and **discarded `usage.cost`** — the gateway's own charge for that generation,
documented as *"the total amount charged to your account"* and always present on the last SSE
message.

**⚠ AND A PREMISE IN THE COORDINATOR'S OWN BRIEF WAS FALSE, WHICH IS WHY THE FIX IS NOT A LOCAL
PRICE TABLE.** The brief asserted that `model_catalog` (v9) already holds prices. **It does not** —
its columns are `provider_id`, `model_id`, `display_name`, `context_length`, `expires_at`,
`first_seen_at`, `refreshed_at`, `missing_since`, and **no price column exists** (`schema.ts:295–305`,
verified 2026-08-02). `storage.ts` refused to cache prices deliberately, and that refusal was
**right**: D71 recorded `glm-5.2` at $0.67/$2.10 on 2026-07-26 and it measured $0.72/$2.25 six days
later. **A cached price table would have shipped a second, staler source of truth for the number this
whole finding is about.**

### Run B observations (2026-08-02) — three predictions falsified, including two of the coordinator's

Run `8087fbf5`, 8 turns, 12m 06s, zero null usage figures. Pack: `councilCore.ts`, 66,919 bytes.

| | A | B | delta |
|---|---|---|---|
| input tokens | 35,722 | **152,323** | +116,601 |
| output tokens | 30,117 | **36,919** | **+6,802 (+22.6%)** |
| true cost | $0.6603 | **$1.1304** | +$0.4701 |
| `cost_usd` | $0.4137 | $0.7340 | — |
| **under-report ratio** | **1.596** | **1.540** | ⚠ **not constant** |
| input as % of total cost | 20.4% | **44.0%** | — |
| arbiter % of input **tokens** | 67.1% | **53.4%** | ⚠ fell |
| arbiter % of input **cost** | **89.0%** | **81.8%** | — |

- **⚠ 1. THE UNDER-REPORT RATIO IS NOT A CONSTANT — 1.596 vs 1.540 — WHICH RETIRES THE IDEA OF A
  CORRECTION FACTOR.** F42's first write-up scaled two historical figures by 1.595. **That method is
  withdrawn.** Every past run must be re-derived from **its own** `council_messages` rows. The
  variation also tells us something diagnostic: whatever `usageUsd` gets wrong, it gets wrong by an
  amount that **moves with the input/output mix**, which is a stronger clue than a flat offset.
- **⚠ 2. "INPUT IS CLOSE TO NOISE" IS FALSIFIED, AT THE SMALLEST PACK TESTED.** Input was **20.4%**
  of A's cost and **44.0%** of B's. **The working hypothesis — that the pack cap is a context-window
  question and not a cost question — does not survive contact with a 71 KiB pack.** It is *both*.
- **⚠ 3. THE COORDINATOR PREDICTED THE ARBITER'S SHARE WOULD CLIMB WITH PACK SIZE. IT FELL, 67.1% →
  53.4%, AND THE MECHANISM IS NOW OBVIOUS IN HINDSIGHT.** The pack reaches **3 member turns and 2
  arbiter turns**, so as the pack grows the arbiter's share of pack tokens converges toward **2/5 =
  40%**; A's 67% was inflated by the arbiter's *fixed* overhead of reading the whole deliberation,
  which does not grow with the pack. **⚠ BUT THE UNDERLYING POINT SURVIVES AND IS STRONGER IN THE
  UNIT THAT MATTERS: the arbiter is 82–89% of INPUT COST**, because it is priced at $5.00/M against a
  member average near $1.34/M. **Token share was the wrong measure; cost share is the right one.**
- **Source code tokenizes at 2.87 bytes/token — measured, not assumed** (66,919 pack bytes → 23,320
  tokens per exposure). The case's markdown measured 3.48. **⚠ THIS SETTLES VARIANT D IN ADVANCE:**
  its 801,547-byte pack is **~279,285 tokens**, against `qwen3-coder`'s ~246,144 usable window.
  **D will exceed it by ~33,000 tokens — the boundary probe is now near-certain rather than
  speculative.** Projected D cost: **~$4.6–5.0 true** (~$3.0 as Chorus would report it), inside the
  $10 mint cap.
- **⚠ OUTPUT ROSE 22.6%, SO THE COST DELTA IS NOT PURELY INPUT.** Of the +$0.4701, roughly $0.33 is
  attributable to pack input (23,320 tokens × ~$14.02/M across the five exposures — which matches the
  prediction almost exactly) and the balance to members writing more when given source. **Whether
  that is verbosity drift or a real effect of having evidence is not separable by this instrument**,
  and is recorded rather than resolved.
- **Projected C: ~$1.9–2.1 true cost** (pack ~78,356 tokens, comfortably inside every context window).

### Run A observations (2026-08-01)

- **Cost $0.4137 against a $0.35 prediction — 18% over, and the miss is on the OUTPUT side.**
  Input was 35,722 tokens; output 30,117. The prediction assumed ~$0.30–0.80 output and the members
  simply wrote more than the case asked for.
- **⚠ THE 400-WORD CAP DID NOT HOLD, AND THIS IS THE INSTRUMENT'S MAIN VALIDITY RISK.** Measured
  answer lengths: Qwen **355**, GLM **803**, Kimi **1,025**; arbiter **2,076** (arbitration) and
  **3,090** (synthesis). The comparison across variants survives only if output stays *similarly*
  inflated each time — **so output tokens must be recorded per run and checked before any cost delta
  is attributed to the pack.** If output drifts materially between runs, the cost curve is measuring
  verbosity, not exhibits.
- **✅ ARBITER INPUT SHARE: 67.1% (23,963 of 35,722)** — against a 71% prediction. **The mechanism is
  confirmed but its cause is bigger than the case text**: at this size the arbiter's input is
  dominated by the *accumulated deliberation* it must read, not by the case. The pack will add
  **2× pack tokens** to the arbiter on top of that, so the share should climb as the pack grows.
  **That trend is the number to watch across B → D.**
- **✅ VERDICT-TOKEN COMPLIANCE: 18 of 18 — every member, every question.** GLM `1A 2A 3A 4A 5Q 6A`,
  Kimi `1A 2A 3A 4A 5D 6A`, Qwen `1A 2A 3A 4A 5A 6A`. **⚠ AND `qwen3-coder` IS THE HEADLINE: 3e-2
  recorded it emitting NO verdict token on ANY of six questions, and here it emitted all six.** The
  plausible cause is question SHAPE — these six are assertions to agree or disagree with, which map
  onto AGREE/DISAGREE/QUALIFY without the model having to invent a mapping. **If that holds on B–D it
  is a case-authoring rule worth writing into the D107 template**, and it is cheap evidence against
  the "it's the model" reading.
- **✅ Q5 SPLIT THREE WAYS — `AGREE` / `QUALIFY` / `DISAGREE`** across Qwen / GLM / Kimi, with the
  other five unanimous. The structural disagreement path fired on a real disagreement, which is
  exactly what the instrument needed in order to exercise arbitration rather than a rubber stamp.
- **Calibration: the case measured ~3.48 bytes/token** (6,440 bytes → ~1,852 input tokens per
  member). **⚠ THAT IS MARKDOWN PROSE. Source code typically tokenizes nearer 3.0**, so variant D's
  801,547-byte pack may be ~267,000 tokens rather than ~229,000 — **which would put it OVER
  `qwen3-coder`'s ~246,144 usable window.** D remains a genuine boundary probe.

**Record for D specifically:** did any member refuse? What did the refusal say? Was the refusal
rendered in the UI, or did the member answer as though it had seen everything?

## 4. ⚠ The arm this method CANNOT reach without a code change

A pasted pack lives in the case text, and the case text is re-sent to the arbiter in **both** its
turns. **So all four runs above are "arbiter sees the pack" runs.** The members-only arm cannot be
simulated by pasting.

**Two ways to get the answer, and they answer different questions:**

- **The cost half needs no second run.** `council_messages` stores `tokens_in` per turn, keyed by
  member, phase and round. Run C or D once and the arbiter's exact share is a query, not an
  estimate — no extra spend.
- **The quality half does need one.** "Does the arbiter synthesize worse without the source?" can
  only be answered by running it both ways. That is a **~2-line change** in `councilCore.ts` —
  strip the exhibits section from `buildArbitrationPrompt` and `buildSynthesisPrompt` — plus one
  paired run at variant C.

**Recommendation: measure the cost half first from C's transcript.** If the arbiter's share is as
large as predicted (71%), the quality run is clearly worth $1.25. If it isn't, the question is moot
and the second run is skipped.

## 4b. ⚠ STATE AT END OF DAY 2026-08-02 — the fix EXISTS but is NOT APPLIED

**The F42 fix is committed as `27dc928` on branch `worktree-agent-ac607b24c8ebfc41d`, in a git
worktree under `.claude/worktrees/`. It has NOT been merged into the working tree and the running app
does NOT have it.** That is deliberate: `electron-vite dev` restarts the main process on any
`src/main` change, so applying it mid-run would have killed a paid council.

**⚠ AND ONE CLAIM IN THE AGENT'S REPORT DID NOT SURVIVE INDEPENDENT VERIFICATION — CHECK THIS BEFORE
MERGING.** The agent reported *"2 pre-existing failures on main, verified against a clean worktree"*
in `councilCore.test.ts` (`parseBriefQuestions` fixtures returning 21 and 23 questions — the
**pre-D68(1)** numbers). Re-run on the real working tree:

| Tree | Result |
|---|---|
| **main working tree** | `councilCore.test.ts` — **96 passed, 0 failed** |
| **agent worktree** | `councilCore.test.ts` — **101 passed, 2 FAILED** |

**The fixture file itself differs between the two checkouts:**
`CouncilBrief-3b.0-ApiSessionProducer.md` is **21,500 bytes in main** and **21,749 in the worktree** —
a **249-byte delta consistent with one byte per line (CRLF vs LF)** — while `git status` reports the
file **unmodified**. So the failures are **an artefact of how the worktree was checked out, not a
defect on main.** The agent reported them in good faith; its verification ran *inside* the same
worktree, so it could not have seen the difference.

**⚠ TWO CONSEQUENCES, BOTH FOR TOMORROW:**

1. **The fix's test evidence must be re-run in the main tree after merging** — its "1063 passing"
   figure was measured under the same skewed checkout, so the real post-merge baseline is unknown.
   Expected: **1055 → 1065** with **zero** failures.
2. **⚠ A REAL FINDING HIDES INSIDE THE FALSE ONE: `parseBriefQuestions`'s fixture tests read real
   `.md` files off disk and are therefore SENSITIVE TO LINE ENDINGS.** A test that passes or fails
   depending on how git materialised a checkout is not a test — and this one guards **D68(1)**, the
   defect that once turned a rubric into 21 "questions". Worth a `.gitattributes` rule or normalising
   the read, and worth doing before it fails on someone's fresh clone.

**Also reported by the agent and NOT yet verified by the coordinator** (recorded so it is not lost):
`dispatchAttribution.ts` reads the same key counter after the work is done at three sites (`:303`,
`:542`, `:560`), so **per-dispatch cost attribution plausibly carries the same lag** — but PTY agents
have no SSE frame to read, so the fix does **not** transfer directly, and nobody has measured it.

## 5. Roster

**⚠ THE LIVE ROSTER IS D71's, VERIFIED IN THE DEV DB 2026-08-01:** `moonshotai/kimi-k3` ·
`z-ai/glm-5.2` · `qwen/qwen3-coder` · arbiter `anthropic/claude-opus-5`.

Requested changes, both **verified to exist** against OpenRouter's free `GET /api/v1/models`
(336 models, 2026-08-01) — the F32 instrument D71 itself used:

| Change | Model | Context | $/M in | $/M out | Effect |
|---|---|---|---|---|---|
| arbiter → | `openai/gpt-5.6-sol` | 1,050,000 | 5.00 | **30.00** | Same input price as opus-5, **+20% output**. Arbiter output is the synthesis, so this costs slightly more. |
| member → | `deepseek/deepseek-v4-flash-0731` | 1,048,576 | **0.14** | **0.28** | Less than half qwen3-coder's input price. |

**⚠ THERE WAS NO `deepseek-v4-pro` IN THE ROSTER TO REPLACE** — deepseek was not a council member at
all, so the request could not be executed as worded and was put back rather than guessed at.

### ✅ RATIFIED 2026-08-01 (Matthew) — the swap, and the order

**The swap:** `deepseek/deepseek-v4-flash-0731` **replaces** `qwen/qwen3-coder`; `openai/gpt-5.6-sol`
**replaces** `anthropic/claude-opus-5` as arbiter. Afterwards the smallest context in the roster is
**1,000,000+**, so **the pack ceiling stops being a roster property** and the binding constraint
becomes cost and `RESPONSE_CAP_BYTES` alone.

**The order: PROBE FIRST, SWAP SECOND.** All four variants run on the **current** roster —
`kimi-k3` · `glm-5.2` · `qwen3-coder` · arbiter `opus-5` — **because variant D only means something
while a 262,144-token member is still in the room.** What D is for is not the cost number; it is the
answer to *"when a member's context window is exceeded, does Chorus refuse loudly or truncate
silently?"* **Silent truncation is the worst failure this feature could have**, and after the swap
there is no member small enough to provoke it. The window to ask closes when the swap lands.

**⚠ THEREFORE: DO NOT TOUCH THE ROSTER UNTIL VARIANT D HAS RUN.** The predictions in §2 are computed
against the current roster and are invalidated by an early swap.

**Optional fifth run, decided after D:** re-run variant **C** on the new roster to measure the swap's
real effect on cost and answer quality rather than predicting it (~$1.25).

**⚠ ANY ROSTER CHANGE GOES THROUGH THE APP'S OWN `council-member:update` CHANNEL, NOT SQL** — D71's
own precedent, and the reason the credential stays untouched while only `model` moves.

**⚠ PRICE DRIFT SINCE D71, MEASURED NOT ASSUMED (2026-08-01):** `z-ai/glm-5.2` is now **$0.72/M in ·
$2.25/M out**, where D71 recorded **$0.67 · $2.10** — +7.5% in, +7.1% out. Small, but it is the
second time the F32 instrument has caught a recorded figure going stale, and every cost prediction in
§2 uses the **live** numbers rather than D71's.

## 6. Dials, for the record

| Dial | Current | Where |
|---|---|---|
| `COUNCIL_MINT_LIMIT_USD` | **$10.00** | `councilService.ts:137` |
| `MAX_OUTPUT_TOKENS_CEILING` | 32,000 | `councilService.ts:201` |
| `COUNCIL_TURN_TIMEOUT_MS` | 15 min | `councilService.ts:241` |
| `RESPONSE_CAP_BYTES` | 8,000,000 | `apiSession.ts:222` |
| per-member `params_json` | arbiter 32,000 · members 16,000 | DB |

**The cost-confirmation threshold discussed for Phase 3f (D111 resolution (c)) is a SEPARATE dial
that does not exist yet.** The council proposed $2.00; Matthew proposed $5.00. A $5 confirmation
under a $10 mint cap is coherent — the cap refuses, the confirmation asks.
