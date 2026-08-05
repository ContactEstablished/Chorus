> ⚠ **PARTIAL RUN — 2 of 3 members completed.**
>
> - CR DeepSeek (v4-flash) refused at **positions** (round 0): The response exceeded its time limit and was stopped.
>
> These findings are the output of a council that did not fully convene. Read them as such.

> ⚠ **These findings are model deliberation, not verified fact.** Every claim below was produced by language models reading the brief. Nothing here was compiled, executed or tested, and no model in this council could see the repository. This project’s own CR-3b.0 was unanimous, its rulings were sound, and the code it shipped had four compile errors. Verify anything you are about to rely on.

# Council Findings — Brief 3f.2  
## Follow-ups left open by the Verdict strip

### Scope

This finding rules on the five proposed changes in the brief. It records the members’ positions, preserves and addresses all recorded dissents, identifies implementation risks, and assigns checkable follow-up actions.

---

## Executive verdicts

| Question | Proposal | Ruling |
|---|---|---|
| Q1 | Rename `disagreed` to `unanimous-against` | **APPROVED-WITH-REVISIONS** |
| Q2 | Cache derived Verdict strips | **REJECTED** |
| Q3 | Show project-level cost total as “at least $X” | **APPROVED** |
| Q4 | Re-probe installed agent CLIs on settings open | **APPROVED-WITH-REVISIONS** |
| Q5 | Impose a fixed 256 KiB repository-pack maximum | **INSUFFICIENT-INFORMATION** |

---

# Per-member positions

## CR GLM (5.2)

| Question | Position | Basis |
|---|---|---|
| Q1 | **AGREE** | The current `disagreed` label is readily confused with disagreement among members, which is actually `split`. Historical-label inconsistency is bounded and can be normalized on read. |
| Q2 | **DISAGREE** | A 7 ms derivation cost, including disk reads, does not justify cache and invalidation complexity. |
| Q3 | **AGREE** | A sum of lower bounds remains a valid lower bound; “at least $X” is mathematically and semantically honest. |
| Q4 | **QUALIFY** | Refreshing availability is useful, but must be asynchronous and non-blocking because the probe takes about 500 ms and starts four processes. |
| Q5 | **AGREE** | A 256 KiB limit provides a cost, latency, and data-exposure guardrail, particularly while cost reporting under-reports actual charges. |

## CR Qwen (3.8-max)

| Question | Position | Basis |
|---|---|---|
| Q1 | **QUALIFY** | Supports the clearer term, provided historical findings are not rewritten or invalidated and `disagreed` remains accepted as a legacy alias. |
| Q2 | **DISAGREE** | 7 ms is already acceptable, and invalidating only on brief changes is unsound because turns and run state also affect the derived strip. |
| Q3 | **DISAGREE** | Although the sum is technically a lower bound, the large variable under-reporting gap could make an aggregate misleading for budget use. |
| Q4 | **QUALIFY** | Supports a settings refresh only if it is asynchronous, rate-limited or deduplicated, and able to present prior results while refreshing. |
| Q5 | **DISAGREE** | The fixed number is not supported by evidence about real pack sizes, model requirements, context limits, or exceedance behavior. |

---

# Synthesis and rulings

## Q1 — Rename `disagreed` to `unanimous-against`

### Ruling: APPROVED-WITH-REVISIONS

The rename is approved for future-facing displays and newly produced findings.

The present label is materially ambiguous. In a strip containing both `agreed` and `disagreed`, a reasonable reader may infer that `disagreed` means members disagreed with one another. That interpretation is wrong: member division is represented by `split`; `disagreed` means unanimous opposition. `unanimous-against` communicates the intended state directly.

The approval is conditional on explicit historical compatibility:

- Existing findings documents must remain unchanged as durable historical artefacts.
- Readers and parsers must continue to recognize `disagreed` as a legacy representation of the same semantic state.
- New Verdict-strip displays and new findings should use `unanimous-against`.
- Historical displays should provide a concise legacy explanation or mapping where practical, so old wording is not silently misunderstood.

No database migration is required for this approach. It is a read/write vocabulary policy rather than stored-data mutation.

### Risks and mitigations

| Risk | Mitigation |
|---|---|
| Historical documents and integrations use the old term. | Preserve `disagreed` as a supported legacy alias in readers/parsers; do not rewrite existing documents. |
| Readers see old and new terms and believe they represent different states. | Document the alias relationship and display a legacy-label explanation when rendering historical findings. |
| `unanimous-against` may be visually long for the Verdict strip. | Validate the strip layout with the actual label before release; use a tooltip or accessible explanation if space is constrained. |
| A label-only change accidentally alters state semantics. | Retain the five-state semantic model and add tests proving that old and new labels resolve to the same state. |

### Recorded disagreements and arbiter assessment

- **[Structural — Q1] CR GLM: AGREE; CR Qwen: QUALIFY.**  
  This difference is well-founded. Both members identify the readability defect, while CR Qwen correctly treats historical compatibility as a release condition rather than a secondary implementation detail. The ruling adopts that condition.

- **[Critique — R1, Q1] CR GLM: `unanimous-against` is overly verbose and alternatives such as `all-disagreed` or `no-yeas` may be better.**  
  This concern is partly well-founded. Label length and UI scanability should be tested. However, the proposal before the council specifically names `unanimous-against`, and it is substantially clearer than the current label. `all-disagreed` retains some ambiguity, while `no-yeas` introduces unfamiliar voting terminology. The approved name stands, subject to layout validation.

- **[Critique — R1, Q1] CR Qwen: archival inconsistency is not automatically bounded without a legend or display mapping for legacy labels.**  
  This is well-founded and adopted. Legacy acceptance alone is insufficient if readers cannot understand the relationship between old and new wording.

---

## Q2 — Cache the derived Verdict strip

### Ruling: REJECTED

The proposed cache is rejected.

The measured derivation time is 7 ms for a five-run Docket, including brief-file reads. This is below a user-perceptible threshold and does not justify the added state, invalidation, and correctness burden of caching.

The specified invalidation rule is also incomplete. Verdict strips derive from stored turns and run state as well as the brief file. A cache invalidated only by brief changes can become stale when turn data or run status changes without a corresponding file edit.

This is not a prohibition on future optimization. Reconsideration is appropriate only after measurement at realistic larger Docket sizes shows meaningful user-visible latency, and only with invalidation that covers every input to the derived output.

### Risks and mitigations

| Risk | Mitigation |
|---|---|
| Performance may degrade as Dockets grow beyond the measured five-run case. | Instrument or benchmark derivation at representative larger sizes before proposing an optimization. |
| A future cache is reintroduced with incomplete invalidation. | Define the complete input set—brief content, stored turns, run status, and any other derived inputs—before cache design. |
| Teams mistake “no cache now” for “performance is irrelevant.” | Establish a measurable latency threshold that would trigger reconsideration. |

### Recorded disagreements and arbiter assessment

- **[Critique — R1, Q2] CR Qwen: the cache analysis must account for invalidation from stored turns and run state, not just brief changes.**  
  This is well-founded and decisive. The proposed cache key and invalidation condition do not match the full dependency set of the Verdict strip.

- **[Critique — R1] CR Qwen: the position does not sufficiently address cache invalidation under async re-probe or stale settings decisions.**  
  The cache-invalidation portion is well-founded for **Q2** and is incorporated above. The async re-probe portion belongs to **Q4**, where stale probe-state handling is explicitly required. The two features should not share or imply a cache design merely because both involve refreshed derived information.

---

## Q3 — Show a project-level Docket cost total labelled “at least $X”

### Ruling: APPROVED

The project-level total is approved as a lower-bound display.

The F42 figures establish that stored per-run costs are under-reported by 37–60% and that the shortfall is non-constant. This prevents Chorus from presenting the sum as a provider bill, an estimate of the true bill, or a budget forecast. It does not prevent presenting the mathematical lower bound.

If every displayed run cost is at least the stored amount, then the sum of those stored amounts is also a valid amount the project cost was at least. The total must therefore retain exact lower-bound language: **“At least $X.”**

The presentation must make the limitation difficult to miss. It is approved as a lower bound, not as an ordinary “project cost total.”

### Risks and mitigations

| Risk | Mitigation |
|---|---|
| Users interpret “at least $X” as an accurate bill or budget estimate. | Label it exactly as a lower bound and add concise explanatory text that provider charges are known to be higher and variably under-reported. |
| The aggregate’s absolute gap from the true bill grows with project activity. | Do not show estimated-overhead percentages, forecasts, or billing-equivalent language until F42 is fixed. |
| The total is styled like a precise accounting number. | Visually distinguish it as a lower-bound diagnostic rather than a final cost figure. |
| F42 persists and users rely on the value for spend control. | Prioritize repair of the underlying cost calculation in the next available engineering cycle. |

### Recorded disagreements and arbiter assessment

- **[Structural — Q3] CR GLM: AGREE; CR Qwen: DISAGREE.**  
  This disagreement is well-founded. CR Qwen correctly identifies a real risk of user overinterpretation, especially because the known gap is large and variable. Nevertheless, the proposal’s explicit “at least” label remains mathematically valid and useful. The approval therefore requires stronger uncertainty presentation than a bare aggregate number.

- **[Critique — R1] CR Qwen: the aggregate floor should be presented only as a bounded lower bound, not as a project total or cost estimate.**  
  This is well-founded in substance and adopted. The Docket may provide a project-level aggregate, but its wording and treatment must make clear that it is a lower bound, not a bill or usable budget estimate.

- **[Critique — R1] CR Qwen: F42 should be fixed before cached or aggregated cost displays to avoid persisting misleading figures.**  
  This is partly well-founded. F42 is the higher-priority root issue and should be addressed at the next available opportunity. However, Q3 does not persist a new cost figure; it derives and labels a valid lower bound. That is acceptable provided the uncertainty controls in this finding are implemented.

---

## Q4 — Re-probe installed agent CLIs when settings opens

### Ruling: APPROVED-WITH-REVISIONS

The settings screen should refresh installed-agent CLI availability, but the refresh must be asynchronous and non-blocking.

The existing launch-dialog probe can become stale if a user installs, removes, or changes an agent CLI while Chorus remains open. Settings is an appropriate location to refresh availability. However, opening settings must not be delayed by roughly 500 ms or made unresponsive while four processes start.

The approved behavior is:

1. Render settings immediately.
2. Show the latest known availability state, if one exists.
3. Start one asynchronous refresh.
4. Update individual results as probes complete.
5. Avoid redundant probes through in-flight deduplication and a bounded refresh policy.

A synchronous probe on each settings open is not approved.

### Risks and mitigations

| Risk | Mitigation |
|---|---|
| Settings opening becomes visibly slow or blocked. | Render before probing; perform all probes off the UI path. |
| Repeated opens spawn excessive processes. | Deduplicate an in-flight refresh and apply a defined freshness interval or rate limit. |
| Users act on stale results while refresh is running. | Mark prior results as “last checked” or “refreshing” and update results as they arrive. |
| One slow or failed CLI probe prevents useful settings interaction. | Treat each probe independently and expose per-agent loading/error states. |

### Recorded disagreements and arbiter assessment

- **[Critique — R1] CR Qwen: stale settings decisions and async re-probe behavior need explicit treatment.**  
  This is well-founded and adopted. The approved design requires visible refresh state, prior-result handling, independent completion, and probe deduplication. These controls reduce both stale-decision risk and unnecessary process churn.

---

## Q5 — Set a fixed 256 KiB repository-file pack maximum per council run

### Ruling: INSUFFICIENT-INFORMATION

No ruling is made in favor of or against the proposed fixed 256 KiB limit at this time.

A bounded repository-file pack may be justified. The stated goals—controlling model cost and latency and reducing third-party data exposure—are legitimate. However, the record does not establish that 256 KiB is the appropriate threshold.

The missing information includes:

- actual repository-pack size distribution;
- typical and exceptional council-context requirements;
- provider and model context constraints;
- whether size is measured before or after any compression;
- the required behavior when a pack exceeds the limit;
- whether users can review, choose, or consent to the transmitted content.

A fixed cap without a defined exceedance policy risks silently degrading answers by dropping important context. Conversely, no bound may create unpredictable latency, cost, and data-exposure outcomes. The decision should follow evidence and an explicit transmission policy.

### Risks and mitigations

| Risk | Mitigation |
|---|---|
| A fixed cap silently truncates context and degrades council quality. | Define a visible exceedance workflow before setting a cap: warn, show selected files, and require an intentional selection, truncation, or cancellation path. |
| Unbounded packs cause excessive cost, latency, or external data transfer. | Collect pack-size and outcome data, then set a policy based on observed usage and provider limits. |
| Compression is treated as a universal solution. | Evaluate compression separately: it may reduce bytes in transit but does not necessarily reduce decompressed model context or resolve consent and selection concerns. |
| Users do not know which repository content was sent to third parties. | Provide clear pack visibility and a user-facing review or consent mechanism appropriate to the product’s policy. |

### Recorded disagreements and arbiter assessment

- **[Structural — Q5] CR GLM: AGREE; CR Qwen: DISAGREE.**  
  This disagreement is well-founded. CR GLM correctly identifies the need for a safety guardrail; CR Qwen correctly identifies that the proposed number and exceedance behavior are unsupported. The ruling preserves the need for a policy while declining to ratify the specific 256 KiB threshold.

- **[Critique — R1, Q5] CR GLM: compression should be considered as an alternative to truncation or capping.**  
  This is well-founded as an option for investigation, but not as a replacement for a pack policy. Compression may reduce transfer size or storage overhead, but it does not answer which content should be sent, what model-context budget applies, how decompression is handled, or how users are informed. It belongs in the options analysis.

- **[Critique — R1] CR Qwen: the cap analysis must define whether overflow means truncation, rejection, warning, prioritization, and must address user-visible uncertainty and consent.**  
  This is well-founded and adopted. Exceedance behavior and user visibility are prerequisite design decisions, not implementation details to defer until after choosing a numerical limit.

---

# Cross-cutting finding: F42 cost accuracy

F42 remains the most material unresolved issue in this brief. Stored per-run costs under-report real provider charges by 37–60%, with no stable correction factor. Token counts remain accurate.

The approval of Q3 does not resolve F42; it permits only a plainly labelled lower-bound aggregate. Chorus must not represent the Docket’s cost values as bills, estimates of bills, forecasts, or budgeting figures until the accounting defect is corrected or a defensible provider-billing reconciliation method exists.

The underlying cost-calculation repair should take priority over the rejected cache proposal and over discretionary presentation refinements.

---

# Checkable action items

## Q1 — Vocabulary and historical compatibility

- [ ] Change the label used by newly generated Verdict strips and newly generated findings from `disagreed` to `unanimous-against`.
- [ ] Confirm that existing findings documents are neither rewritten nor invalidated by the change.
- [ ] Implement reader/parser support that accepts both `disagreed` and `unanimous-against` as the same unanimous-opposition semantic state.
- [ ] Add a visible legacy-label explanation when historical findings containing `disagreed` are displayed.
- [ ] Add automated tests demonstrating equivalent parsing and rendering semantics for both labels.
- [ ] Validate that `unanimous-against` fits the Verdict-strip UI or has an accessible overflow/tooltip treatment.

## Q2 — Verdict-strip performance

- [ ] Do not implement the proposed run-keyed Verdict-strip cache.
- [ ] Record a benchmark plan for larger realistic Docket sizes, including the latency threshold that would justify reconsidering caching.
- [ ] If a future cache is proposed, document all derived inputs and invalidation triggers, including stored turns, run state, and brief content.

## Q3 — Cost lower-bound aggregate

- [ ] Add a Docket aggregate labelled exactly **“At least $X”** or equivalent language that unambiguously states it is a lower bound.
- [ ] Add nearby explanatory text stating that actual provider charges are known to be higher and variably under-reported.
- [ ] Ensure the aggregate is not labelled or styled as a provider bill, estimated total cost, forecast, or budget figure.
- [ ] Verify that the aggregate equals the sum of the displayed per-run lower-bound figures.
- [ ] Add a test covering projects with multiple runs and confirming lower-bound wording is present.

## Q4 — Settings-screen CLI refresh

- [ ] Render the settings screen without awaiting the CLI probe.
- [ ] Launch the four-process probe asynchronously after settings becomes interactive.
- [ ] Display prior probe results, if available, with visible refresh or last-checked state until new results arrive.
- [ ] Update each agent’s availability independently as its probe completes or fails.
- [ ] Prevent repeated settings opens from initiating duplicate concurrent probe sets.
- [ ] Define and implement a refresh rate limit or freshness interval.
- [ ] Add a test or instrumentation check showing that settings interaction is available before probe completion.

## Q5 — Repository-pack policy discovery

- [ ] Collect representative repository-pack size data before selecting a numerical cap.
- [ ] Document provider/model context constraints relevant to council repository packs.
- [ ] Define the required behavior for an oversized pack: reject, warn, require user selection, prioritize files, truncate, compress, or another explicit policy.
- [ ] Define whether pack size is measured before compression, after compression, or by model-visible content size.
- [ ] Define what the user can see and control before repository content is sent to third-party model APIs.
- [ ] Return with evidence and a concrete exceedance policy before resubmitting a fixed-size cap proposal.

## F42 — Under-reported cost figures

- [ ] Schedule investigation of the 37–60% variable provider-cost under-reporting defect for the next available engineering cycle.
- [ ] Preserve accurate token counts as the primary reliable aggregate usage measure until the cost defect is corrected.
- [ ] Do not introduce new cost displays that imply provider-bill accuracy before reconciliation is validated.

---

# Final finding

The council supports clarity improvements, transparent lower-bound reporting, and fresh settings information where they can be delivered without corrupting historical meaning, overstating cost certainty, or degrading interactivity. It rejects unmeasured caching complexity and declines to set an arbitrary repository-transmission cap without operational evidence and a user-visible overflow policy.

The central follow-up remains F42: cost presentation may be safely improved only within the strict limits of lower-bound disclosure until actual provider-cost accounting is corrected.

---

## How disagreement was detected

- **Q1** — detection: `structural` · members disagreed
- **Q2** — detection: `structural` · members agreed
- **Q3** — detection: `structural` · members disagreed
- **Q4** — detection: `structural` · members agreed
- **Q5** — detection: `structural` · members disagreed

_`structural` means the orchestrator compared the members' own verdict tokens and counted the difference. `model-judged` means too few members answered in the required form, so the arbiter judged it from prose — a weaker signal, labelled rather than hidden._

## Dissents preserved

_7 preserved: 3 structural (computed from the members' own verdict tokens) · 4 from critique prose, from 2 members — CR GLM (5.2) 2 · CR Qwen (3.8-max) 2._

_⚠ Read the per-member split before reading breadth into the total: several objections from one member is one member disagreeing repeatedly, not several members disagreeing. Nothing is dropped to make the total smaller._

- [Structural — Q1] Rename the consensus state `disagreed` to `unanimous-against`, leaving the — AGREE: CR GLM (5.2) · QUALIFY: CR Qwen (3.8-max)
- [Structural — Q3] Show a project-level cost total on the Docket by summing the per-run figures, — AGREE: CR GLM (5.2) · DISAGREE: CR Qwen (3.8-max)
- [Structural — Q5] Set the maximum size of a repository-file pack that Chorus may send to third — AGREE: CR GLM (5.2) · DISAGREE: CR Qwen (3.8-max)
- [Critique — R1] CR GLM (5.2): I disagree with the specific alternative name `unanimous-against` (Q1). While it resolves the ambiguity with `split`, it is overly verbose and awkward for a UI strip label. A shorter, equally unambiguous term like `all-disagreed` or `no-yeas` would be preferable, though I agree entirely with the condition to preserve historical aliases.
- [Critique — R1] CR GLM (5.2): In the assessment of the 256 KiB maximum repository-file pack size (Q5), Position A missed the possibility of applying compression as an alternative to truncation or capping. Compression could mitigate both the privacy/cost concerns and the model context-limit constraints without silently dropping potentially vital repository context.
- [Critique — R1] CR Qwen (3.8-max): I disagree that the aggregate floor is “strictly better” than no total without stronger presentation constraints: because F42 under-reporting is non-constant, an aggregate “at least $X” can still be mistaken for a usable budget estimate, so it should be shown only as a bounded lower bound, not as a project total or cost estimate; I also disagree that archival inconsistency is automatically bounded unless old documents include a legend or display mapping for legacy labels.
- [Critique — R1] CR Qwen (3.8-max): The position does not sufficiently address cache invalidation under async re-probe or stale settings decisions, migration/legend for historical verdict labels, user-visible uncertainty language for aggregate floors, behavior when the 256 KiB cap is exceeded (truncate, reject, warn, prioritize), and whether F42 fix should precede any cached or aggregated cost display to avoid persisting misleading figures.

## Provenance

- **Run id:** `b534ed99-9d5d-4828-b36f-cee8d44eaab7`
- **Started:** 2026-08-05T13:13:11.386Z

| Member | Role | Model | Turns |
|---|---|---|---|
| CR DeepSeek (v4-flash) | member | `deepseek/deepseek-v4-flash-0731` | refused 1 turn |
| CR GLM (5.2) | member | `z-ai/glm-5.2` | answered 2 turns |
| CR Qwen (3.8-max) | member | `qwen/qwen3.8-max` | answered 2 turns |
| CR Arbiter (gpt-5.6-terra) | arbiter | `openai/gpt-5.6-terra` | answered 2 turns |

