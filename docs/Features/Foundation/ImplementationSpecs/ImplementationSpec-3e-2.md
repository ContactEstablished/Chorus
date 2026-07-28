# ImplementationSpec 3e-2 — The Fixes the Measurement Licenses

**Normative for:** [`../Tasks/Task-3e-2.md`](../Tasks/Task-3e-2.md). **Its real input is
`../Investigations/3e-1-Measurement.md`.**

## 1. F40 — the duplicated heading

**The defect:** the arbiter's synthesis writes a `## Dissents preserved` section **and**
`councilCore` appends one unconditionally, so a document that had dissents gets the heading twice.

**⚠ THE OBVIOUS FIX IS FORBIDDEN.** Removing the core's unconditional append is D67 Q5 ruling
**5A** — dissent preservation by the arbiter's goodwill — which was **explicitly rejected**. The
append is the enforceability mechanism: it is what guarantees the section exists even when the
arbiter omits it. **It stays.**

**Two lanes are permitted. Pick one and say why:**

- **(a) The core's heading.** The append stops emitting a duplicate top-level heading when the
  synthesis already carries one — detect the existing `^## Dissents preserved` in the arbiter's
  text and append **under** it rather than beside it. **The append still runs unconditionally; only
  its rendering adapts.** ⚠ The detection must be anchored (`^##`) — a mention of the phrase inside
  a member's prose is not a heading, and matching it would suppress the real section.
- **(b) The synthesis prompt.** Instruct the arbiter not to write the section, because the core
  guarantees it. Simpler, but **weaker**: it depends on the arbiter obeying, and if it disobeys the
  duplicate returns silently. **If you choose (b), say in the report that you have chosen a
  prompt-shaped guarantee over a code-shaped one**, which is the same trade D67 Q5 already ruled on
  once.

**(a) is preferred** on that reasoning. Whichever is chosen, the four existing assertions in
`councilCore.test.ts` (`:619`, `:639`, `:915`, `:927`) must still pass unmodified.

## 2. The dissent matcher's noise

**Measured on the dogfood run: two of nine "dissents" said nothing that challenges the synthesis,
and one talkative member produced six of the nine.** 3b-3 predicted both and left them rather than
tuning them away.

**⚠ THE FAILURE MODE OF A FIX HERE IS WORSE THAN THE DEFECT.** A matcher tuned to be quiet drops
real dissents, and dissent preservation is the one property this feature is built to guarantee.
**Precision may be improved; recall may not be traded for it.**

Permitted:
- **Do not count a `DISAGREE:` label whose body states no objection.** Mechanical extraction from
  a label cannot distinguish a non-objection from an objection; a fix must look at the body, and
  **when it cannot tell, it must KEEP the dissent.**
- **Attribute per member, so six-from-one is visible as six-from-one** rather than as breadth of
  disagreement. **This is a rendering change and is the safest of the available fixes** — it
  removes the misleading impression without dropping anything.

Forbidden: a cap on dissents per member, a similarity threshold that merges them, or any change
whose effect is "fewer dissents survive".

**If the analysis finds no safe precision improvement, say so and ship only the attribution
change.** That is a real outcome, not a failure.

## 3. F39 — act only on 3e-1's row

Quote the row from ImplementationSpec-3e-1 §4.2 that the measurement landed in, then:

- **pathological** → `RESPONSE_CAP_BYTES` **does not move**. Bound the member, or drop it, and say
  which. Note that dropping it takes the council to D67 Q6's **two-member floor with zero margin**
  — so if it is dropped, the roster needs a replacement member, and that is Matthew's call to make,
  not the implementer's. **Stop and ask.**
- **cap too small** → raise `RESPONSE_CAP_BYTES` **to a stated multiple of the observed maximum**
  (a factor, not a round number picked for looking generous), and **put the measured figure in the
  commit message**. ⚠ Note the constant's own comment records that it is deliberately **half**
  `modelCatalog`'s 8 MB cap; if the raise breaks that relationship, say so — the asymmetry was
  deliberate.
- **did not reproduce** → change nothing. Record that F39 did not recur on this roster, and that
  the earlier three refusals remain unexplained. **An unreproduced defect is not a fixed one**, and
  the record must not read as though it were.

## 4. Verification

```bash
npm run typecheck && npx vitest run && npm run grep:secrets
grep -c "^## Dissents preserved" <the proving run's findings.md>   # exactly 1
```

**Runtime (G2): one real run**, and the report must show the rendered heading count from **that
document**, not from a unit test. F40 is a defect that only appears when a real arbiter writes a
real section.

**Cost: ~$0.83, one run**, against the phase's ~$4.00. Report as a bound.
