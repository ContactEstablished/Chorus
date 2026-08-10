> Council of 3 members plus an arbiter. All members completed.

> ⚠ **These findings are model deliberation, not verified fact.** Every claim below was produced by language models reading the brief. Nothing here was compiled, executed or tested, and no model in this council could see the repository. This project’s own CR-3b.0 was unanimous, its rulings were sound, and the code it shipped had four compile errors. Verify anything you are about to rely on.

# Council Findings — Reasoning-token spend in Chorus

## Per-member positions

- **DeepSeek-v4-Flash-0731**
  - **Q1: QUALIFY.** Send `reasoning` as a supported-model cap, not default exclusion. Use per-member policy with a run default/override; avoid universal numerical caps. Verify support and enforcement.
  - **Q2: AGREE.** Surface separately reported reasoning-token usage beside visible and total billed output; do not show reasoning text normally. Record the policy used and distinguish unavailable split reporting.
  - Also recommends treating empty visible output with positive usage as a failure rather than a refusal.

- **Kimi-K3**
  - **Q1: QUALIFY.** Send `reasoning.max_tokens`, preserving a visible-output reserve. Do not assume `exclude` saves cost; verify route semantics. Use per-member settings inheriting from a run default.
  - **Q2: AGREE.** Show reported visible, reasoning, and total output figures, plus totals. Do not render reasoning text by default; allow explicitly enabled, separately stored debugging capture.
  - Also recommends classifying empty output plus `finish_reason: length` as truncation rather than refusal.

- **MiniMax-M3**
  - **Q1: QUALIFY.** Cap reasoning but preserve reasoning as a capability. Prefer per-member defaults and per-run overrides; leave `exclude` opt-in and `effort` at model default except for deliberate cost-sensitive runs.
  - **Q2: QUALIFY.** Surface a separate reasoning-token number only when honestly sourced. Keep reasoning text hidden by default, with an optional debugging expansion/capture path.
  - Also recommends a warning when reasoning consumption approaches its budget and verification of route-specific billing treatment.

---

Q1: QUALIFY

Chorus should send OpenRouter’s `reasoning` parameter for council turns, but only through a provider-aware implementation that knows whether the selected model and route support the requested control. The default should be a reasoning-token cap, not blanket exclusion and not a default reduction in reasoning effort. Reasoning remains a material reason to select reasoning-capable models for council deliberation; the objective is to prevent it consuming the entire turn before a visible answer is emitted.

The cap should be expressed as **total output allowance minus a configurable visible-answer reserve**, not as a universal percentage or fixed token count. The reserve guarantees that a member has output headroom, while the cap gives a bounded worst-case reasoning spend. Values should be calibrated from observed runs and may differ for normal members and the arbiter. Policy should be stored per member, inherit a per-run default, and permit an explicit per-run override.

`exclude` should remain off by default. Whether exclusion avoids generation, billing, or only response delivery is route-specific and must be verified before Chorus presents it as either a cost-saving or quality-preserving control. Likewise, Chorus must not state that a cap was applied unless the selected route supports and enforces it. Lower `effort` may be offered as an explicitly cost-sensitive override, subject to schema and route compatibility validation.

Q2: QUALIFY

Chorus should surface reasoning-token spend as transcript metadata, but only when the API reports that split for the actual response. Each completed turn should show: visible completion tokens, reasoning tokens when reported, total billed output, and the reasoning policy requested and confirmed as applied. The transcript should include corresponding run totals. This makes hidden billed output auditable without implying that invisible reasoning was visible content.

Chorus should not render reasoning text in the normal council transcript. Such text is not necessarily the member’s final position, may be absent or transformed by the provider, can materially bloat the audit record, and may affect later critique dynamics. If debugging capture is needed, it must be enabled explicitly per run, stored separately, labelled non-authoritative, and governed by a documented retention and access policy.

Where the response does not provide a reasoning-token split, Chorus must retain the total billed-output figure and display `reasoning tokens: not reported`. It must not infer reasoning tokens by subtracting locally decoded content from billed totals or by estimating streamed text. The current single total is not necessarily inaccurate; it is incomplete for audit purposes because it does not decompose visible and hidden output.

## Synthesis and ruling

### Q1 ruling — Approved with revisions

Approve a deliberate transport expansion to send a supported `reasoning` policy on council turns. The implementation must reserve visible-answer capacity, use per-member policy with inherited run defaults, and verify provider/route support before claiming a policy is effective.

The initial rollout should not hard-code the proposed example values—such as 80%, 60–80%, 12,000, 28,000, or a 4,000-token reserve—as universal defaults. Those are useful calibration hypotheses, not established operating values. Chorus should collect member-level measurements and set defaults based on observed visible-answer lengths, reasoning use, truncation rates, quality outcomes, and cost.

This work must also correct the adjacent failure-classification defect. Empty visible output with `finish_reason: length` is a truncation condition, not a refusal. That state must be visible in both the transcript and the arbiter’s input. A retry, if used, must change the applicable allocation or policy and be attempt-limited; repeating the same request is likely to repeat the same failure at additional cost.

### Q2 ruling — Approved with revisions

Approve surfacing reasoning-token spend as separate, honestly sourced transcript metadata. The normal transcript should show aggregate accounting, not hidden reasoning text. The transcript must make unsupported or unreported values explicit rather than silently omitting the uncertainty or deriving estimates.

The reasoning-control and usage-reporting changes should be planned as one documented transport change. This reduces the risk of separately widening a deliberately minimal request path without coherent support detection, audit metadata, error handling, and tests.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| A reasoning cap is ignored or unsupported by a route. | Maintain route/model capability metadata; record requested, supported, and confirmed-applied status separately; do not claim enforcement without confirmation. |
| A cap preserves too little visible-output capacity. | Define the cap as total allowance minus a visible-answer reserve; tune reserves by member and arbiter role using observed data. |
| Fixed caps either degrade quality or leave cost excessive. | Start conservatively, measure truncation, visible-answer length, total spend, and operator quality assessments; revise defaults through versioned configuration. |
| `exclude` is assumed to save cost when it may only suppress returned content. | Treat billing and generation semantics as unverified until tested against the relevant OpenRouter route and documented response metadata. |
| `max_tokens` and `effort` have incompatible or route-specific request semantics. | Validate request schema and model behavior before exposing combined controls; reject or normalize invalid combinations in Chorus. |
| Hidden spend remains unauditable where usage details are absent. | Show total billed output and `reasoning tokens: not reported`; never estimate the split. |
| The transcript misclassifies exhausted output as a refusal. | Use empty visible content plus `finish_reason` to distinguish truncation, refusal, transport failure, and normal completion; pass the distinction to the arbiter. |
| Retries duplicate cost without improving the result. | Permit at most a configured number of retries, and only with changed budget/cap/policy; preserve the failed attempt in audit metadata. |
| Reasoning traces introduce privacy, retention, and social-dynamics concerns. | Disable reasoning-text capture by default; require explicit run-level opt-in, separate storage, non-authoritative labelling, and a retention/access policy. |
| Reasoning tokens are billed differently from normal output on some routes. | Verify route-level pricing and usage semantics before describing a cap as a precise cost ceiling; report observed billed amounts independently of token counts. |
| Operators miss an impending silent failure. | Add a run-time warning when reported reasoning usage approaches the applicable cap or output allowance; record that warning event in transcript metadata if triggered. |

## Disagreement and critique disposition

All recorded disagreements were reviewed. The labels below preserve the source record’s **R1** tag and identify the relevant question for matching.

1. **[R1 — DeepSeek-v4-Flash-0731, Q1]** DeepSeek rejects Kimi’s specific 12,000/28,000 caps and fixed 4,000 reserve as uncalibrated; it also disputes the absolute claim that `exclude` is a no-op and questions whether a single transport change is essential.  
   **Finding:** Well-founded. Example values should be treated as starting hypotheses only, and exclusion semantics are route-specific. The one-change transport plan is preferred for coherence, but it is an implementation governance recommendation rather than a technical prerequisite.

2. **[R1 — DeepSeek-v4-Flash-0731, Q1]** DeepSeek says the initial cap proposal omits dynamic adjustment, enforcement verification, billing-rate differences, and an approaching-budget warning.  
   **Finding:** Well-founded. Support/enforcement verification and route-specific billing validation are release requirements. Dynamic adjustment should follow a measured initial rollout rather than be assumed in version one. A warning is an appropriate operational safeguard.

3. **[R1 — DeepSeek-v4-Flash-0731, Q1]** DeepSeek rejects MiniMax’s 60–80% as universal, questions leaving `effort` at default for all cases, and notes the missing truncation-versus-refusal correction.  
   **Finding:** Well-founded. A visible-output reserve is the governing invariant, not a percentage. Lower effort is a legitimate explicit cost-sensitive option after compatibility testing. Classification correction is mandatory independent of reasoning controls.

4. **[R1 — DeepSeek-v4-Flash-0731, Q1]** DeepSeek raises provider portability, unsupported cap behavior, arbiter-specific needs, and failure to record `finish_reason`.  
   **Finding:** Well-founded. Capability handling, arbiter-specific allocation, and `finish_reason`-based classification are incorporated into the ruling.

5. **[R1 — Kimi-K3, Q1]** Kimi argues that 80% is the wrong invariant because it does not guarantee sufficient visible output at smaller allowances, and that retries must alter parameters and be attempt-limited.  
   **Finding:** Well-founded. The ruling adopts a visible-answer reserve and changed-parameter, bounded retries.

6. **[R1 — Kimi-K3, Q1/Q2]** Kimi notes missing treatment of debug reasoning-text retention, pre-failure warning, raising total budget as an alternative, possible different billing rates, and potential `effort`/`max_tokens` incompatibility.  
   **Finding:** Well-founded. Reasoning-text capture requires retention rules; warnings and budget adjustment are appropriate safeguards; billing and request compatibility require validation. Raising the total allowance may complement a cap but is not a substitute for a protected visible-output reserve.

7. **[R1 — Kimi-K3, Q2]** Kimi says describing the current total as misrepresentative overstates the issue: it is accurate billed output but lacks decomposition. Kimi also argues warning events belong in transcript audit metadata.  
   **Finding:** Well-founded. The current total should be retained and augmented, not discarded. Triggered warnings should be recorded as audit context, while real-time alert presentation may remain run-level.

8. **[R1 — Kimi-K3, Q1/Q2]** Kimi identifies missing support detection, missing fallback for unavailable splits, incomplete post-failure behavior, the percentage-cap flaw, and unresolved reasoning-text storage questions.  
   **Finding:** Well-founded. The ruling requires capability status, `not reported` fallback, distinct truncation treatment, reserve-based caps, and opt-in retained debugging data with policy controls.

9. **[R1 — MiniMax-M3, Q1]** MiniMax argues that an 80% cap does not itself guarantee usable output and that retry design must consider what the arbiter receives from the failed attempt.  
   **Finding:** Well-founded. The arbiter must receive `truncated at token limit`, not `refused`, and should receive the successful replacement only after the retry process completes or the terminal failure state if it does not.

10. **[R1 — MiniMax-M3, Q1/Q2]** MiniMax emphasizes the classification bug, asks for the explicit `finish_reason` signal, raises reasoning-text capture, and supports a deliberate one-time transport expansion.  
    **Finding:** Well-founded. These are incorporated. The transport change should include reasoning controls, usage collection, finish-reason handling, and transcript metadata as one coherent feature.

11. **[R1 — MiniMax-M3, Q1]** MiniMax disputes Kimi’s assertion that excluded reasoning is always generated and billed, rejects uncalibrated fixed values, and asks for explicit handling of truncated turns.  
    **Finding:** Well-founded. Chorus must not state exclusion semantics as fact without route-specific evidence. Truncation handling is specified in the ruling.

12. **[R1 — MiniMax-M3, Q1/Q2]** MiniMax asks that the arbiter receive truncation distinctly, and that debug reasoning capture specify retention, storage, labelling, and treatment of silently ignored parameters.  
    **Finding:** Well-founded. These are protocol requirements, not merely caveats: capability status and application status must be recorded, and debug capture must have documented handling rules.

## Checkable action items

1. **Capability matrix:** Create and maintain a model/route capability record for `reasoning.max_tokens`, `reasoning.effort`, `reasoning.exclude`, streamed usage reporting, and reasoning-token usage splits.

2. **Transport change:** Extend the council transport in one documented change to support:
   - the selected `reasoning` request policy;
   - streaming usage inclusion or an equivalent post-generation usage retrieval path;
   - capture of `finish_reason`;
   - request and response identifiers needed for audit.

3. **Policy schema:** Implement a per-member reasoning policy with inheritance from a per-run default and explicit run-level overrides. Include total output allowance, visible-answer reserve, reasoning cap, effort setting, and exclusion setting.

4. **Cap calculation:** Implement reasoning maximum as `total output allowance - visible-answer reserve`; reject or flag invalid configurations where the reserve is zero, negative, or exceeds the allowance.

5. **Initial calibration:** Before setting production defaults, collect at least one representative set of council runs covering ordinary member turns and arbiter turns, then document chosen reserves and caps with observed evidence.

6. **Enforcement status:** Record in each turn’s metadata: policy requested, route support status, provider acknowledgement or observable application status where available, and any fallback applied.

7. **Usage display:** Add per-turn transcript fields for visible completion tokens, reasoning tokens when reported, total billed output, and reasoning-policy status. Add run totals for each reported field.

8. **Unknown usage fallback:** When reasoning-token usage is not supplied, render `reasoning tokens: not reported` and retain the reported total billed-output value. Do not estimate a reasoning split.

9. **Normal transcript boundary:** Do not render reasoning text in normal council transcripts.

10. **Debug capture controls:** If reasoning-text capture is implemented, require explicit per-run enablement; store it separately; label it non-authoritative; and document access control, export behavior, and retention/deletion rules.

11. **Failure classification:** Replace the current “refusal” classification for empty visible output with a state machine that distinguishes at minimum: normal completion, truncation (`finish_reason: length`), explicit refusal where detectable, transport/API failure, and unknown silent completion.

12. **Arbiter input:** Ensure the arbiter receives truncation and other terminal states distinctly. It must never be told that a truncated member refused unless the source response actually supports that conclusion.

13. **Retry policy:** Add an attempt-limited retry path for truncation with empty visible output. Each retry must alter an applicable parameter—such as reasoning cap, visible reserve, or total output allowance—and the transcript must preserve both the original state and retry outcome.

14. **Budget warning:** Add a run-time warning when reported reasoning usage approaches the configured reasoning cap or total allowance. If triggered, record the event in transcript metadata.

15. **Billing validation:** Verify, per supported route, whether reasoning tokens have the same billing treatment as visible output and whether `exclude` affects generation or billing. Do not market caps or exclusion as precise savings controls until this is established.

16. **Automated tests:** Add tests for supported and unsupported routes, missing usage splits, ignored-policy fallback, normal completion, empty-output truncation, bounded retries, transcript rendering, and arbiter-state propagation.

---

## How disagreement was detected

- **Q1** — detection: `structural` · members agreed
- **Q2** — detection: `structural` · members disagreed

_`structural` means the orchestrator compared the members' own verdict tokens and counted the difference. `model-judged` means too few members answered in the required form, so the arbiter judged it from prose — a weaker signal, labelled rather than hidden._

## Dissents preserved

_13 preserved: 1 structural (computed from the members' own verdict tokens) · 12 from critique prose, from 3 members — DeepSeek-v4-Flash-0731 4 · Kimi-K3 4 · MiniMax-M3 4._

_⚠ Read the per-member split before reading breadth into the total: several objections from one member is one member disagreeing repeatedly, not several members disagreeing. Nothing is dropped to make the total smaller._

- [Structural — Q2] Should reasoning-token spend be surfaced in the council transcript, and if so how? — AGREE: DeepSeek-v4-Flash-0731, Kimi-K3 · QUALIFY: MiniMax-M3
- [Critique — R1] DeepSeek-v4-Flash-0731: I disagree with the specific cap numbers (12,000 for members, 28,000 for arbiter) as they appear arbitrary without empirical calibration to the actual reasoning lengths of the models in the roster. A fixed reserve of 4,000 tokens for the answer may be insufficient for some complex synthesis tasks. Additionally, the claim that `exclude` is a "no-op" is too absolute; while it may be true for many providers, there are routes where exclusion genuinely skips generation, and this should be verified per provider rather than assumed. The process note about widening the transport in one change is reasonable but not essential; separate additions could be managed with proper versioning.
- [Critique — R1] DeepSeek-v4-Flash-0731: The position does not consider the possibility of dynamic adjustment of the reasoning cap based on observed model behavior or the specific difficulty of the brief. It also overlooks the need to verify that the provider actually enforces the cap—if a model silently ignores the parameter, the cap is meaningless. Furthermore, it does not address the potential difference in billing rates for reasoning tokens versus output tokens, which could undermine the cost-control rationale. Finally, it does not propose a soft warning mechanism to alert operators when a member approaches its reasoning budget, which would be a proactive safeguard.
- [Critique — R1] DeepSeek-v4-Flash-0731: I disagree with the specific percentage range (60–80%) as a universal default; it may be too high for models that are verbose in reasoning or too low for models that need extensive deliberation on hard briefs. The suggestion to leave `effort` at the model's default is also questionable—lowering effort on cost-sensitive runs could be a legitimate lever, and the position does not explore that trade-off. Additionally, the position does not address the classification bug that Position A raised; without distinguishing `finish_reason: length` from `stop`, the transcript will continue to misrepresent truncated members as refusals, which is a critical audit gap.
- [Critique — R1] DeepSeek-v4-Flash-0731: The position misses the need to verify that the reasoning cap is actually enforced by the provider—if a model ignores the parameter, the cap is illusory. It also does not consider the portability of the `reasoning` parameter across the heterogeneous providers behind OpenRouter, nor the possibility that some models cannot cap reasoning at all. The position also overlooks the arbiter's specific needs; the arbiter may require a larger reasoning budget than a percentage of its total allowance would naturally provide. Finally, it does not mention the classification bug or the need to record `finish_reason` in the transcript.
- [Critique — R1] Kimi-K3: The ~80% default is too high and is framed as the wrong invariant. The property we actually need is a guaranteed floor for visible output, not a percentage of budget. Eighty percent of a 16,000-token budget leaves ~3,200 tokens for the answer — workable — but 80% of a 4,096-token budget leaves ~819, which recreates a degraded version of the original failure on smaller allowances. The cap should be expressed as "budget minus a reserved visible-output floor," with the percentage as a sanity check, not the mechanism. I also disagree with the retry as specified: retrying a turn with unchanged parameters will often deterministically reproduce the empty-answer failure while doubling the cost. The retry must modify something (lower the reasoning cap or raise the budget) and must itself be capped in attempts, with the failure surfaced to the user if retries exhaust.
- [Critique — R1] Kimi-K3: A never addresses whether reasoning text should be retained or viewable at all — even a debug-only toggle — which matters for diagnosing future incidents like 2026-08-06. There is no pre-failure detection (a mid-run warning when reasoning spend approaches the cap), only post-failure marking. A does not consider raising the total output budget as an alternative or complement to capping, does not flag that reasoning tokens may not be billed at the same rate as visible output on every route, and does not note that `effort` and `max_tokens` may be mutually exclusive in OpenRouter's schema — worth confirming before the implementation assumes both can be set.
- [Critique — R1] Kimi-K3: The claim that "the current single token count misrepresents what was produced" overstates the case. The single count accurately reports billed output; what it lacks is the visible/hidden decomposition. That distinction matters because the fix is additive (a split figure), not corrective (the existing number is not wrong), and overstating it invites ripping out a working total rather than augmenting it. I also disagree with excluding the 70% warning from the transcript. B's own honesty principle argues the other way: a warning event is auditable operational metadata, and a later reader reviewing a run deserves to see that a member approached exhaustion — that is context for evaluating the answer, not noise. Run-level surfacing is fine as the *alert*; the transcript should still record that it fired.
- [Critique — R1] Kimi-K3: B never addresses support detection — what Chorus does for models that do not accept the `reasoning` parameter — and never specifies fallback behavior when the API does not return a reasoning-token split for a given route, which A handles explicitly with the "billed output (includes hidden reasoning)" label. B has pre-failure detection but no post-failure handling: no marking, no retry, no user surfacing when a turn still comes back empty. The 60–80% range inherits the same flaw as A's 80% — it is a percentage of budget rather than a reserved visible-output floor, so it can still starve short answers on small allowances. Finally, B recommends `max_tokens` per-member with `effort` left at default without noting that the two may not be combinable in a single request, and does not consider whether reasoning text should be *stored* (not just displayed) for debugging, which raises its own retention and cost questions.
- [Critique — R1] MiniMax-M3: The "cap reasoning at roughly 80% of the per-turn output budget" rule is too loose to actually guarantee visible headroom. A model with an 8,000-token output budget could be capped at 6,400 reasoning tokens but still produce a 4,000-token visible answer, which leaves room — yet other models with very different reasoning profiles could behave unpredictably inside that 80% band. The position should reserve an explicit minimum for the visible answer (e.g. a fixed floor like B's ~4,000 tokens), rather than expressing the cap as a fraction of the same budget that includes the answer. Also: the proposed retry-on-empty-visible-output behavior needs to be paired with what the *arbiter* sees during the failed attempt — if the arbiter already rules on the turn while it's flagged failed, then retry-on-empty doesn't actually fix the deliberation, it just produces a better transcript.
- [Critique — R1] MiniMax-M3: The classification bug is the deeper point. The 2026-08-06 failure was not just a token-budget problem; three members were "recorded as refusals" when they had not refused — they exhausted their allowance before producing visible content. The stream's `finish_reason` field (`length` vs `stop`) combined with empty visible content distinguishes these states, and Chorus already receives the chunks. A's retry suggestion gestures at this but doesn't name the signal or the distinction. A's position also doesn't address what to do with the reasoning *text* itself (as opposed to the token count) — whether it should be capturable at all, by default or behind a flag. And A is silent on the transport-minimalism argument: Q1 and Q2 each widen the four-field transport, and that should be done deliberately once rather than accreted. ### Position B
- [Critique — R1] MiniMax-M3: The assertion that "excluded reasoning is still generated and billed" should not be stated as fact — it varies across the providers behind OpenRouter, and stating it confidently without verification risks the same kind of unsourced claim that the app's standing rule explicitly rejects. It should be phrased as the working hypothesis pending verification. The 12,000 / 28,000 numbers are specific enough to invite bikeshedding without strong basis — they're presented as "generous headroom" but the basis for choosing those values isn't given; A's percentage-based default, while looser, at least has the virtue of being model-relative. Also: B identifies the classification bug (truncation ≠ refusal) but stops short of prescribing behavior — what should Chorus do with a truncated member turn? Surface it to the arbiter as "silent: truncated at token limit"? Escalate? Retry? The diagnosis is correct but incomplete.
- [Critique — R1] MiniMax-M3: The interaction between the truncation signal and the arbiter's input — the arbiter needs to see "truncated" as a distinct state from "refused" or "silent," or the same misclassification will propagate downstream. B implies this but doesn't name it. The position also doesn't address whether the reasoning text, when available, should ever be capturable for debugging — it says "behind an explicit per-run flag" but doesn't specify retention policy, where it's stored, or how it's labeled in the transcript. And B doesn't address the case where the `reasoning` parameter is silently ignored by a model that doesn't support capping — A flags this; B notes it but treats it as a caveat rather than a protocol requirement.

## Provenance

- **Run id:** `b774586c-49b1-4760-828f-d255df5740ba`
- **Started:** 2026-08-07T10:55:52.250Z

| Member | Role | Model | Turns |
|---|---|---|---|
| DeepSeek-v4-Flash-0731 | member | `deepseek/deepseek-v4-flash-0731` | answered 2 turns |
| Kimi-K3 | member | `moonshotai/kimi-k3` | answered 2 turns |
| MiniMax-M3 | member | `minimax/minimax-m3` | answered 2 turns |
| GPT 5.6 Terra | arbiter | `openai/gpt-5.6-terra` | answered 2 turns |

