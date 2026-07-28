# ImplementationSpec 3e-1 — The Instrument, the Roster, and the Measurement

**Normative for:** [`../Tasks/Task-3e-1.md`](../Tasks/Task-3e-1.md).

## 1. The instrument (D96)

`src/main/services/apiSession.ts`, verified at `0ac1f3e`:

```ts
totalBytes += value.byteLength
if (totalBytes > maxResponseBytes) {
  await cancelReader(active)
  controller.abort()
  refuse(API_SESSION_FAILURE.tooLarge)
  return
}
```

**The defect this fixes is diagnostic, not behavioural: the number that answers F39 is computed on
the line above the refusal and then thrown away.**

### 1.1 What to add

Two log lines through `services/logger` — the same seam every other main module uses:

- **At the refusal**, before `refuse(...)`: the member/session label, `totalBytes`, and
  `maxResponseBytes`. Emitting the cap alongside the count is what makes the line readable a year
  later when the constant has moved.
- **At normal stream completion**, once per turn: the same label and the final `totalBytes`.
  **This is the half that makes the measurement work.** A refusal alone is compatible with both of
  F39's hypotheses; it is the *comparison* against the turns that succeeded that separates them.

### 1.2 Constraints

- **⚠ NO STREAM CONTENT, EVER.** A byte count and a label. Never a fragment, never a prefix, never
  "the last line seen". Model output can carry a credential — that is why the scrub seam exists —
  and a diagnostic that leaks one is a worse bug than the one it diagnoses.
- **⚠ THE LABEL MUST NOT BE A SECRET EITHER.** Use whatever identifier the session already carries
  in its other log lines. Do not add the base URL, the env var name, or the key fingerprint.
- **`refuse()`'s payload shape is on the wire; do not reshape it.** If the byte count is genuinely
  needed by a caller rather than by a human reading logs, that is a wire change and therefore out
  of scope — **log it**.
- **No behaviour changes.** Same abort, same refusal, same ordering. The cap still fires at exactly
  the same byte.

### 1.3 Tests

Cover: a stream that exceeds the cap logs the count and still refuses identically; a stream that
completes logs its count; **neither log line contains any byte of the streamed body.** The third is
the one worth asserting explicitly — it is the property that is easy to lose in a later edit.

## 2. The roster

Created through **`council-member:create`** — the app's own channel, driven over CDP or by hand in
Settings. **Never SQL.** D71 established this and the reason is that a row written by hand skips
every validation the channel enforces.

| Label | Role | Model | `params_json` |
|---|---|---|---|
| `CR Kimi (k3)` | member | `moonshotai/kimi-k3` | `{"max_tokens": 16000}` |
| `CR GLM (5.2)` | member | `z-ai/glm-5.2` | `{"max_tokens": 16000}` |
| `CR Qwen (3-coder)` | member | `qwen/qwen3-coder` | `{"max_tokens": 16000}` |
| `CR Arbiter (opus-5)` | **arbiter** | `anthropic/claude-opus-5` | `{"max_tokens": 32000}` |

**⚠ THE KEY IS `max_tokens`, AND THIS TABLE SAID `max_completion_tokens` UNTIL A RUN PROVED IT
WRONG — CORRECTED 2026-07-28 AFTER THE FIRST ATTEMPT ABORTED.** `resolveMaxOutputTokens`
(`councilService.ts:1119`) reads **`member.params.max_tokens`** and falls back to
`MAX_OUTPUT_TOKENS_DEFAULT = 1200` when it is absent — **silently, because an absent parameter is a
legal state.** `max_completion_tokens` is OpenRouter's own API field name, which is exactly why it
is the wrong guess to make here: **Chorus's `params_json` is not passed through verbatim, it is
read.**

**What that cost, measured rather than imagined:** the first attempt gave every member **1,200**
output tokens instead of 16,000. Two of the three reasoning members spent the entire budget on
reasoning and returned **empty** content — `tokens_out: 1200` exactly, `content:` *"The model
returned an empty answer (its output budget may have gone to reasoning)"* — and the run **aborted
on D67 Q6's two-member floor**. It cost **$0.037** and produced no document.

**⚠ THE ROADMAP'S D71 ROW RECORDS THE VALUES AND NOT THE KEY**, which is what made this
mis-settable. Anyone rebuilding this roster from D71 alone will make the same mistake. **Verify
after creating the roster** — read a member's resolved budget back, or run one cheap turn — rather
than trusting that a JSON blob was understood.

All four on the **standing OpenRouter route** — the credential is unchanged and only `model`
differs, exactly as D71 configured it.

**⚠ The 16,000 / 32,000 asymmetry is MEASURED, not assumed:** D71 recorded the largest member
answer at **11,796 output tokens**, so the members demonstrably do not need the arbiter's ceiling.
Do not "simplify" them to one value.

**⚠ Re-check every id against OpenRouter's live `/models` first** (free, unauthenticated — the F32
instrument). D71's roster was chosen 2026-07-26; an id retired since then converts a paid run into
a refusal, and the roadmap's own D42/kimi-k2.7 history is what that check exists to prevent.
**Record the date of the check and the count returned.**

## 3. The run

- **Brief: `CouncilBrief-3b.0-ApiSessionProducer.md`, verbatim** (D98).
- **State the envelope before starting.** ~$0.83 expected, ~$4.00 authorised for the phase.
- **Watch it stream** — this run is also the evidence for the three boxes 3c-5 could not tick.

## 4. Reading the measurement

### 4.1 Verdict-token compliance

`councilCore` resolves each enumerated question by one of two `DetectionPath`s. **F38 measured
4 of 6 falling to `model-judged` on the cheap roster at the 700-token cap.** Report the same
fraction for this run: **`N of M` structural, `M − N` model-judged**, per question.

**⚠ Report the DENOMINATOR and the per-question detail, not a percentage.** "67% compliant" hides
whether the failures cluster on one question type, which is the thing 3e-2 would need to act on.

**⚠ AND STATE THE COMPARISON HONESTLY.** The prior number was measured on a **different roster at
a different cap**, so a change between them is **not attributable to any single dial**. If it
improved, that is evidence the arm works *on this roster*, not proof the tuning fixed it.

### 4.2 F39

Report, from the instrument:

- kimi's `totalBytes` when the cap fired (or **that it did not fire this run**, which is itself a
  result and changes what 3e-2 does),
- the **largest** successful turn's `totalBytes` in the same run,
- the ratio, and a stated read.

**The two readings and what each licenses 3e-2 to do:**

| Evidence | Reading | 3e-2 may |
|---|---|---|
| kimi ≫ every successful turn (e.g. 4 MB vs ~200 KB) | **pathological** — it is not producing a longer answer, it is producing an unbounded one | drop the member, or bound it per-member; **raising the global cap would not help** |
| kimi ≈ the largest successful turns, just over the line | **the cap is too small for this roster** | raise `RESPONSE_CAP_BYTES` **to a stated multiple of the observed maximum**, with the number in the commit message |
| kimi did not refuse at all | the earlier three refusals were transient or roster-dependent | **change nothing**; record that F39 did not reproduce, and say so plainly |

**⚠ DO NOT ACT ON THE READING IN THIS TASK.** The separation is the point: a task that measures and
fixes in one pass cannot be reviewed, because the fix's author is the only witness to the evidence.

## 5. Verification

```bash
npm run typecheck && npx vitest run && npm run grep:secrets
grep -n "RESPONSE_CAP_BYTES = " src/main/services/apiSession.ts   # 4_000_000, unmoved
git diff --stat docs/Features/Foundation/CouncilBriefs/           # empty
```

**Runtime (G2) — the run itself is the runtime proof.** It must also discharge, explicitly:

- [ ] a real run **streams into the restyled `CouncilView`** (3c-5's first UNPROVEN box),
- [ ] **Esc refuses to leave while `council.running`** (second box),
- [ ] the **findings `.md` lands beside the brief** (third box),
- [ ] the **F37 grouping holds** — turns render as turns, not as hundreds of fragments.

## 6. The record

`docs/Features/Foundation/Investigations/3e-1-Measurement.md`:

1. Envelope stated **before** the run, and the measured cost after — **as a bound**, noting that
   any turn without a `usage` block makes Chorus's figure a floor.
2. The roster, with each id's re-check date.
3. Verdict-token compliance: `N of M`, per question, with the detection path.
4. F39: the three byte figures, the ratio, the reading, and **which row of §4.2's table it lands
   in**.
5. Anything else the run exposed — **recorded, not fixed.**
6. The four runtime boxes above.

**⚠ WRITE IT EVEN IF THE NUMBERS ARE DISAPPOINTING.** The milestone is a number and a decision
taken on it, not a particular number. This is the document that stops the next reader from having
to spend $0.83 to learn what today already knew.
