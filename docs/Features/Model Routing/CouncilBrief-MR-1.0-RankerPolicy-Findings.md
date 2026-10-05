> ⚠ **PARTIAL RUN — 2 of 4 members completed.**
>
> - GLM 5.3 refused at **positions** (round 0): The model returned an empty answer (its output budget may have gone to reasoning).
> - Qwen 3.8 Max refused at **positions** (round 0): The model returned an empty answer (its output budget may have gone to reasoning).
>
> These findings are the output of a council that did not fully convene. Read them as such.

> ⚠ **These findings are model deliberation, not verified fact.** Every claim below was produced by language models reading the brief. Nothing here was compiled, executed or tested, and no model in this council could see the repository. This project’s own CR-3b.0 was unanimous, its rulings were sound, and the code it shipped had four compile errors. Verify anything you are about to rely on.

# Council Findings — MR-1.0 Provider-Ranking Policy for OpenRouter Tiers

## Disposition summary

| Question | Finding | Disposition |
|---|---|---|
| Q1 — Local ranking vs. native preferences | Rank locally and pin routable identities. | **Approve with revisions** |
| Q2 — Score and speed statistic | Retain log score and tier weights; use latency-aware effective throughput. | **Approve with revisions** |
| Q3 — Undeclared quantization | Retain exclusion unless first-party or verified. | **Approve** |
| Q4 — Reliability and liveness gates | Retain hard gates; add hysteresis immediately. | **Approve with revisions** |
| Q5 — Cost, caching, and reasoning | Do not assume caching without declared or measured evidence. | **Approve with revisions** |
| Q6 — Smoothing, persistence, and reranking | Smooth pre-launch data; persist sessions; no timer reranking. | **Approve with revisions** |
| Q7 — Nitro and data policy | Offer Nitro as the single explicit exception; default data collection to deny. | **Approve with revisions** |

The council adopts local, explainable, safety-filtered routing for Budget, Balanced, and Fast. Nitro remains an explicit and conspicuous exception to the normal endpoint-quality gates.

The principal implementation condition is that Chorus must rank only identities it can actually select. It must not score API rows independently where OpenRouter can route them only through one shared tag or other ambiguous selector.

---

# 1. Per-member positions

## DeepSeek v4 Pro 0813

| Question | Position | Core recommendation |
|---|---|---|
| Q1 | Agree | Rank locally and pin with `order` and `allow_fallbacks: false`; native preferences cannot enforce all Chorus filters. |
| Q2 | Qualify | Keep log score, but use effective throughput based on p50 latency and p50 throughput. |
| Q3 | Agree | Exclude undeclared quantization unless first-party or verified. |
| Q4 | Agree | Retain the gates and add 99.6% readmission hysteresis from the start. |
| Q5 | Qualify | Use cache-read pricing only for declared or verified caching; otherwise price all input as fresh. |
| Q6 | Qualify | Smooth using at least six observations, with three as a minimum; no timer-based reranking. |
| Q7 | Qualify | Keep Nitro as a labelled exception; default `data_collection` to `"deny"`. |

DeepSeek additionally identified the same-tag BaseTen issue: separately ranking two endpoint rows is unsound if `order` can only target their common tag. It recommended unique verified selectors where available, otherwise conservative aggregation.

## Grok 4.6

| Question | Position | Core recommendation |
|---|---|---|
| Q1 | Agree | Rank locally and pin; do not mix hidden live `sort` preferences with a local pin. |
| Q2 | Qualify | Keep score and weights; use effective throughput with a provisional 1024-token turn size. |
| Q3 | Agree | Exclude undeclared quantization unless first-party or verified. |
| Q4 | Qualify | Retain hard gates; add 99.6% or consecutive-snapshot hysteresis immediately. |
| Q5 | Disagree | Reject 20/70/10 as a universal default; proposed a partially conservative fallback profile for unverified caching. |
| Q6 | Qualify | Smooth over the last three snapshots; persist the selection; rerank only on request or exhaustion of the pinned list. |
| Q7 | Qualify | Nitro is acceptable only as a named exception; default `data_collection` to `"deny"`. |

Grok likewise identified the same-tag BaseTen issue and recommended collapsing shared-tag rows unless a unique display name or identifier is verified to select a specific endpoint.

## Arbiter ruling

The Arbiter agrees with both members on the central policy direction:

- local ranking is required to enforce Chorus’s own filters;
- raw p50 throughput alone is not sufficient;
- undeclared quantization cannot be admitted by a mere score penalty;
- reliability thresholds need immediate hysteresis;
- unverified caching must not receive cache-read cost credit;
- timer-based session reranking is contrary to the cache-locality rationale for pinning;
- Nitro is acceptable only as the express exception to the normal safety rules;
- `data_collection: "deny"` should be default.

Where members differed, the Arbiter adopts:

- profile-specific effective-throughput token counts rather than one universal `N = 1024`;
- zero assumed cache-read share without declared or locally measured cache behavior;
- a six-observation smoothing target with a minimum of three observations;
- immediate readmission hysteresis at 99.6% one-day uptime.

---

# 2. Findings by question

## Q1 — Local ranking and pinning

### Ruling: Approve with revisions

Chorus shall rank endpoints locally and send an explicit `order` with:

```json
{
  "order": ["primary", "fallback-1", "fallback-2"],
  "allow_fallbacks": false,
  "require_parameters": true
}
```

Budget, Balanced, and Fast shall not primarily be expressed as OpenRouter-native live preferences such as `sort`, `preferred_min_throughput`, or `preferred_max_latency`.

### Findings supported by measured facts

1. OpenCode forwards the relevant `provider` fields verbatim.
2. `order` with `allow_fallbacks: false` pinned the endpoint in all ten measured tool-bearing requests, notwithstanding OpenRouter’s Auto Exacto behavior.
3. OpenRouter-native preferences cannot directly express Chorus’s binding filters for:
   - one-day uptime;
   - five-minute liveness;
   - non-zero `status`;
   - account-specific guardrail removals;
   - undeclared quantization.
4. `:nitro` and `sort: "throughput"` have been measured to make different selections. Native preference routing is therefore not a substitute for a named and explainable Chorus tier.
5. Pinning supports cache locality and gives Chorus a concrete route to show in its UI.

### Required revision: rank routable identities, not API rows

The BaseTen evidence is launch-blocking. Two rows share a tag but have materially different measured p50 throughput: 90 tps and 62 tps. The established facts show that `order` accepts tags and display names, but do not establish that a shared tag selects one specific underlying row.

Chorus shall apply this rule:

1. **Use a unique endpoint selector only when it has been verified to route to exactly one endpoint identity.**
2. **When a selector represents multiple endpoint rows, collapse those rows into one routable candidate.**
3. For a collapsed candidate, use conservative values:
   - minimum uptime;
   - any non-zero status excludes the candidate;
   - lowest p50 throughput;
   - highest p50 latency;
   - highest applicable blended cost;
   - union of required-parameter and context/output-capability failures.
4. The UI shall not claim that Chorus selected a specific endpoint row where only a shared tag can actually be selected.

### Scenario in which the proposal would choose badly

The current exhibit ranks BaseTen first and second as distinct candidates, despite both using `baseten/fp8`. Chorus could display “BaseTen first” at 90 tps while OpenRouter serves the 62 tps backend. This would make the displayed route, measured score, and expected performance misleading.

### Assumptions requiring new measurement

- Whether each display name accepted by `order` is a stable and unique endpoint selector.
- Whether `allow_fallbacks: false` behaves as intended when the selected identity is a shared provider tag.
- How a pinned request fails when the primary identity is unavailable, including whether OpenRouter can attempt the later entries in `order`.

---

## Q2 — Score shape and speed statistic

### Ruling: Approve with revisions

Retain the logarithmic score and the existing tier weights:

\[
score = w \cdot \ln(speed) - (1-w) \cdot \ln(blendedCost)
\]

with:

| Tier | Weight |
|---|---:|
| Budget | `0.30` |
| Balanced | `0.50` |
| Fast | `1.00` |

Replace raw p50 throughput in the score with latency-aware effective throughput:

\[
tps_{eff} = \frac{N}{L_{p50} + N/tps_{p50}}
\]

Where:

- `L_p50` is p50 latency in seconds;
- `tps_p50` is p50 throughput;
- `N` is expected generated tokens per turn, including expected reasoning tokens where reasoning is enabled.

The resulting score is:

\[
score = w \cdot \ln(tps_{eff}) - (1-w) \cdot \ln(blendedCost)
\]

### Budget floor

Retain the Budget hard gate using raw p50 throughput:

\[
tps_{p50} \ge \max(30,\;0.5 \times medianEligibleP50Tps)
\]

The floor shall remain based on p50 throughput, not `tps_eff`, because its purpose is to prevent low sustained-throughput endpoints from winning on price alone.

Under the exhibit:

- median eligible p50 throughput is 90 tps;
- Budget floor remains 45 tps;
- Morph at 17 p50 tps remains excluded from Budget.

### Findings supported by measured facts

1. The existing log form gives the intended scale-invariant speed/cost trade-off.
2. The API provides p50 latency as well as p50 throughput.
3. The exhibit has latency differences large enough to matter for interactive coding:
   - AtlasCloud: 98 p50 tps, 1.02 seconds p50 latency;
   - BaseTen first: 90 p50 tps, 0.30 seconds p50 latency.
4. For a 500-token completion:
   - AtlasCloud effective throughput is approximately 82 tps;
   - BaseTen first effective throughput is approximately 85 tps.

Raw p50 throughput alone can therefore rank AtlasCloud above BaseTen first even where BaseTen is faster for a shorter interactive turn.

### Use of p90

p90 values shall be displayed and retained for diagnostics, but shall not be the primary scoring input at launch.

The exhibit demonstrates why: BaseTen fast has 31 p50 tps and 260 p90 tps. Using p90 as the main speed input would reward favorable or bursty observations rather than typical user experience.

### Scenario in which the proposal would choose badly

The current Fast tier is:

1. Venice;
2. Baidu;
3. Parasail.

The current raw-throughput rule ignores that BaseTen first has materially lower p50 latency at 0.30 seconds. On shorter interactive turns, raw p50 tps can produce a route that is slower in perceived turn completion despite appearing faster by throughput alone.

### Required profile rule for `N`

`N` shall be configurable by workload profile:

- interactive coding;
- helper agent;
- reasoning-enabled interactive;
- reasoning-enabled helper.

A provisional value may be shipped, but must be treated as a calibration assumption rather than a measured fact. It shall be replaced or tuned once Chorus has sufficient local, non-shared measurements of completion and reasoning-token distributions.

### Preserved dissent and assessment

- **[Q2 — Grok R1]** Grok argued that p90 should not be merely display or tie-break information because it may underweight tail experience for interactive and Fast use. This concern is well-founded as a future risk, but the current data does not establish a robust tail metric or user-facing p90 objective. The adopted policy preserves p90 for diagnostics and requires future evaluation of tail-sensitive scoring.
- **[Q2 — DeepSeek R1]** DeepSeek observed that effective throughput does not model long input or prefix-processing time. This is well-founded. The adopted formula is a better approximation than raw throughput, not a complete end-to-end latency model. Chorus should add prefix-processing measurements when the API or local observations permit.
- **[Q2 — DeepSeek R1]** DeepSeek rejected a universal `N = 1024` because it can overweight output throughput for short turns and underweight reasoning-heavy work. The Arbiter adopts this objection. `N` must be profile-specific.
- **[Q2 — Grok R1]** Grok raised uncertainty about how reasoning tokens affect measured latency and throughput as well as cost. This is well-founded and remains a measurement requirement.

---

## Q3 — Undeclared quantization

### Ruling: Approve

Retain the proposed `firstPartyAndVerified` policy.

An endpoint with undeclared quantization shall be excluded from Budget, Balanced, and Fast unless it is:

1. a first-party provider for that model; or
2. explicitly verified in Chorus’s curated registry for that model and endpoint identity.

A score penalty shall not substitute for the exclusion.

### Findings supported by measured facts

1. “Unknown” means undeclared quantization, not native-or-better quantization.
2. The exhibit contains FP4 endpoints and establishes that below-native quantization exists in the provider pool.
3. Together at 223 p50 tps and Fireworks US at 168 p50 tps are both undeclared.
4. Admitting those endpoints would likely change Fast and Balanced without evidence that they satisfy the binding native-or-better requirement.
5. First-party DeepSeek is separately excluded in the exhibit by uptime and account guardrails; that treatment is consistent with the policy.

### Scenario in which an admission-with-penalty policy would choose badly

A penalty could still allow Together or Fireworks US to win Fast because their measured throughput is much higher than the filtered candidates. If either were actually FP4 or otherwise below native precision, Chorus would be violating the native-or-better rule while presenting the tier as safe.

### Required graduation rule

A provider shall be added to the verified list only after an evaluation recorded in the curated registry that identifies:

- model;
- routable endpoint identity;
- evaluation date and version;
- reference endpoint;
- task suite;
- acceptance threshold;
- expiry or reevaluation date.

If a provider tag represents multiple underlying endpoints, the evaluation must be specific to the identity Chorus can actually select, or the shared tag must remain ineligible.

### Assumptions requiring new measurement

- Whether Together, Fireworks US, and other undeclared endpoints are actually native FP8 or better.
- Whether quality evaluation on one routable provider identity generalizes to all regions or backends behind a shared tag.

### Preserved dissent and assessment

- **[Q3 — Grok R1]** Grok requested details for the quality-evaluation graduation path. This is well-founded. The policy direction is approved, but registry schema, benchmark composition, pass threshold, and reevaluation interval are implementation requirements.
- **[Q3 — DeepSeek R1]** DeepSeek required endpoint-specific graduation where tags have multiple backends. This is adopted as a mandatory condition.

---

## Q4 — Reliability and liveness gates

### Ruling: Approve with revisions

Retain the proposed hard gates for Budget, Balanced, and Fast:

- one-day uptime must be at least `99.5%`;
- five-minute uptime must be at least `95%`;
- `status` must equal `0`;
- uptime values must be present;
- account-guardrail removals remain exclusions.

Add immediate uptime hysteresis:

- an endpoint that fails the one-day uptime floor is excluded immediately;
- after exclusion for one-day uptime, it may be readmitted only when one-day uptime reaches at least `99.6%`;
- failure of five-minute uptime or a non-zero status remains an immediate exclusion and does not wait for hysteresis.

### Findings supported by measured facts

1. The 99.5% one-day uptime floor is binding.
2. Alibaba demonstrates the value of current-state signals:
   - 97.18% one-day uptime;
   - 92.4% five-minute uptime;
   - `status: -2`.
3. The exhibit contains endpoints close enough to the threshold to flap:
   - inference-net: 99.495%, excluded;
   - Morph: 99.54%, admitted;
   - Parasail: 99.54%, admitted.

### Scenario in which the proposal would choose badly

Without hysteresis, an endpoint can move in and out of Budget, Balanced, or Fast based on changes of only a few hundredths of a percentage point. A user could rerun a ranking shortly after a prior launch and receive materially different orders without a meaningful service-quality change.

### Assumptions requiring new measurement

- The semantic meaning and severity of each non-zero `status` value.
- Whether one-day uptime is sufficient to detect chronic instability.
- Whether seven-day or thirty-day uptime would improve decisions without unduly excluding newer providers.

### Preserved dissent and assessment

- **[Q4 — Structural dissent]** DeepSeek labelled the proposed hard gates acceptable, while Grok qualified approval because hysteresis was missing from the initial policy. This is not a substantive disagreement after the ruling: both members support the gates and immediate hysteresis.
- **[Q4 — Grok R1]** Grok observed that 99.6% readmission and the smoothing windows may lag genuine recovery or degradation. This is well-founded. The policy deliberately favors avoiding route flapping; Chorus must revisit thresholds after accumulating operational evidence.
- **[Q4 — DeepSeek R1]** DeepSeek recommended longer-window uptime metrics, such as seven-day or thirty-day stability. This is well-founded as a future refinement, but not yet supported by supplied data. It is recorded as a measurement and roadmap item.

---

## Q5 — Cost model, caching, and reasoning output

### Ruling: Approve with revisions

Reject the proposed universal 20/70/10 cost profile when caching has not been established.

Use endpoint-specific blended cost:

\[
blendedCost =
\begin{cases}
0.20 \cdot input + 0.70 \cdot cacheRead + 0.10 \cdot output, & \text{cache declared or locally verified} \\
0.90 \cdot input + 0.10 \cdot output, & \text{otherwise}
\end{cases}
\]

“Locally verified” means Chorus has evidence that its actual harness, cache directives, model, and routable endpoint identity result in billable cache-read behavior.

Cheap cache-read prices alone are not evidence of cache hits.

Reasoning tokens shall always be counted as output-priced tokens. When reasoning effort is enabled, the applicable workload profile must increase expected output share and expected output-token count. Chorus must not score reasoning-enabled workloads with an unchanged 10% output assumption.

Time-of-day price overrides shall be evaluated at launch and included in both formulas.

### Findings supported by measured facts

1. Only one endpoint declares `supports_implicit_caching: true`.
2. That endpoint, DeepSeek first party, is currently ineligible in the exhibit because of uptime and the account guardrail.
3. Nearly all listed eligible candidates receive the benefit of a 70% cache-read assumption despite lacking a declared cache capability.
4. Cache-read and fresh-input prices vary substantially enough to alter rankings.

For GMICloud:

\[
0.20(0.180) + 0.70(0.0036) + 0.10(0.720) = 0.1105
\]

Under the no-cache rule:

\[
0.90(0.180) + 0.10(0.720) = 0.234
\]

The assumed cache behavior reduces its apparent blended cost by more than half.

### Scenario in which the proposal would choose badly

The proposed profile can favor an endpoint with an extremely cheap cache-read price even if Chorus never receives cache hits on that endpoint. GMICloud’s `$0.0036/M` cache-read price makes it appear much cheaper under 20/70/10 than it is under a no-cache workload.

Similarly, under no-cache pricing:

- AtlasCloud is approximately `$0.1833/M`;
- DeepInfra is approximately `$0.168/M`.

AtlasCloud’s higher throughput can then outweigh its modest cost increase at the Budget weight, potentially changing the Budget order. The original policy risks optimizing a cache-read price that the workload never realizes.

### Preserved dissent and assessment

- **[Q5 — Structural dissent]** DeepSeek qualified the original policy and Grok rejected it. The Arbiter finds Grok’s rejection substantively correct: a universal cache assumption is not justified by the measured data.
- **[Q5 — Grok proposed alternative]** Grok proposed a partially conservative default of `55% fresh / 15% cache-read / 30% output` for unverified endpoints. The Arbiter rejects this specific fallback because it still grants cache-read credit without evidence of cache behavior.
- **[Q5 — DeepSeek R1]** DeepSeek made the same objection: even a 15% unverified cache share is still an unearned assumption. This is adopted.
- **[Q5 — DeepSeek R1]** DeepSeek noted that fixed cost blends should eventually be replaced with measured session token mixes. This is well-founded and adopted as a roadmap requirement.

### Assumptions requiring new measurement

- cache-hit rates by model, workload type, endpoint identity, and routing selector;
- whether cache reuse survives the precise OpenRouter pinning behavior;
- fresh-input, cached-input, normal-output, and reasoning-output mix for interactive and helper sessions;
- cost impact of reasoning effort levels;
- actual time-of-day price behavior across the full curated model registry.

---

## Q6 — Snapshot smoothing, persistence, and reranking

### Ruling: Approve with revisions

Selections shall be smoothed before launch, then persisted for the session.

### Required rule

1. Retain endpoint snapshots at approximately 30-minute intervals.
2. For each routable candidate, calculate score inputs using:
   - median of the six most recent available p50 throughput observations;
   - median of the corresponding six most recent available p50 latency observations.
3. A candidate is considered **stable** only after at least three observations.
4. Before three observations exist, a candidate may be used provisionally only if it passes all hard gates and the UI identifies it as having limited history.
5. Compute the launch-time ranking from a snapshot no older than 60 minutes.
6. Persist the selected route for the session.
7. Snapshot helper-agent selections into the Team Session run configuration.
8. Re-rank only:
   - on explicit user action;
   - if all ordered candidates fail;
   - if the active candidate newly fails a hard reliability or account-guardrail check.
9. Do not rerank on a periodic mid-session timer.

### Findings supported by measured facts

1. API speed metrics are based on 30-minute windows.
2. Morph changed from 57 p50 tps on one day to 17 p50 tps on the next.
3. Two BaseTen rows associated with one tag were measured at 90 and 62 p50 tps.
4. Pinning is intended in part to preserve endpoint-local cache behavior; moving endpoints mid-session can sacrifice that benefit.

### Scenarios in which the proposal would choose badly

- **Single-snapshot launch decision:** a temporary speed spike can promote an endpoint just before launch; a temporary dip can demote an otherwise suitable endpoint.
- **Timer reranking:** an active, successful agent can be moved to a new cold endpoint merely because one new 30-minute window looks better elsewhere.
- **Unstable Morph-like endpoint:** a route selected during a 57 tps observation can perform much worse during a later 17 tps period.

### Preserved dissent and assessment

- **[Q6 — member difference]** Grok proposed a median of three snapshots; DeepSeek recommended six observations with at least three required. The Arbiter adopts six as the target and three as the minimum stable-history threshold. The evidence establishes instability, but does not establish the statistically optimal window length.
- **[Q6 — Grok R1]** Grok warned that the six-observation and 99.6% hysteresis policy may lag real degradations. This is well-founded. Immediate five-minute, `status`, failure, and guardrail gates provide the counterbalance, but window sizes require later validation.
- **[Q6 — DeepSeek R1]** DeepSeek noted that account-specific 404 preflight results can become stale if account guardrails change mid-session. This is well-founded. Chorus shall revalidate account eligibility when a route fails with a relevant access error before reranking.
- **[Q6 — Grok R1]** Grok requested a snapshot retention and storage policy. This is well-founded and becomes an action item.

### Assumptions requiring new measurement

- Whether six observations outperform three observations or an exponentially weighted moving average.
- How quickly real degradation should outweigh older observations.
- Whether provisional candidates with fewer than three observations should be eligible at all for Fast.
- Whether local snapshot history produces enough benefit to justify storage and refresh traffic.

---

## Q7 — Nitro and data-collection policy

### Ruling: Approve with revisions

Nitro shall be offered as the sole explicit exception to the normal uptime and native-or-better precision rules.

Nitro shall send:

```text
<model-slug>:nitro
```

without a locally computed `order`.

Chorus shall default to:

```json
{
  "data_collection": "deny"
}
```

for Budget, Balanced, Fast, and Nitro. Changing to `"allow"` shall require explicit user opt-in.

### Required Nitro presentation

Nitro must be visibly labelled as:

> **Nitro — unfiltered provider routing**

The warning must state, using current snapshot information:

- that Nitro may select providers excluded from Budget, Balanced, and Fast;
- that it is not subject to Chorus’s normal uptime and native-precision filters;
- the likely current route, where observable;
- that the likely current route is Together with undeclared quantization;
- that `:nitro` is not equivalent to `sort: "throughput"`;
- that priority-tier routing and higher charges may occur;
- that actual routing can differ from the currently likely provider;
- that OpenRouter account-level guardrails still apply.

### Findings supported by measured facts

1. Nitro is bindingly the deliberate exception to the normal uptime and precision rules.
2. Nitro differs from `sort: "throughput"` in observed routing.
3. Nitro has been observed to route to Together, which has undeclared quantization.
4. Nitro may include priority-tier endpoints.
5. Account-level guardrails continue to apply.
6. `data_collection: "deny"` has been verified to work with Nitro.

### Scenario in which the proposal would choose badly

Under the proposed default of `data_collection: "allow"`, a local-first coding application can send source code and prompts to a provider whose data-use posture the user has not affirmatively selected, despite a verified deny mechanism.

Separately, presenting Nitro merely as “Fast” would hide that it may route to Together or another endpoint excluded from the normal tiers for undeclared precision or reliability reasons.

### Required account-eligibility rule

Chorus shall run the free account-specific 404 preflight before ranking and before presenting the candidate set. This prevents the UI from presenting endpoints that the user’s account guardrails will silently remove at request time.

### Preserved dissent and assessment

- **[Q7 — Grok R1]** Grok noted that default-deny can shrink the Nitro pool even if technically compatible. This is well-founded. The council nevertheless adopts default-deny because the loss of availability is an explicit privacy trade-off that users may override through informed opt-in.
- **[Q7 — DeepSeek and Grok]** Both members support explicit Nitro labeling and default-deny. This consensus is adopted.

### Assumptions requiring new measurement

- How often default-deny materially changes Nitro availability, price, or route selection.
- Whether users understand and use the data-collection opt-in.
- Whether OpenRouter can provide stable, current Nitro route information suitable for UI display.

---

# 3. Cross-cutting risks and mitigations

| Risk | Evidence / concern | Mitigation |
|---|---|---|
| A ranked API row cannot be uniquely selected | Two BaseTen rows share a tag yet have different measured speeds. | Rank only unique selectors; otherwise collapse shared identities conservatively. |
| Local speed data is stale or noisy | Metrics are 30-minute windows; Morph changed 57 to 17 p50 tps. | Median smoothing over recent observations; retain hard current-state gates; no timer reranking. |
| Pinning provides less fallback behavior than assumed | Behavior after primary failure and with shared tags is not fully established. | Verify failure behavior in integration tests before release; rerank only under defined failure conditions. |
| Cache pricing materially distorts ranking | Only one endpoint declares implicit caching; most endpoints list cheap cache-read prices. | Use fresh-input pricing unless caching is declared or locally verified. |
| Long prompts are not represented by effective throughput | `N/(latency + N/tps)` does not model prefix processing explicitly. | Treat effective throughput as an interim approximation; collect or obtain prefix-latency measurements. |
| Tail behavior can be hidden by p50 | Large p50/p90 divergence appears in the exhibit. | Display p90, log it, and evaluate tail-sensitive metrics after local experience data exists. |
| Reliability thresholds can flap | Several endpoints are within 0.1% of the uptime threshold. | Use 99.6% readmission threshold; immediate exclusion for current liveness or status failures. |
| Guardrails can change after launch | Preflight is a point-in-time account-specific test. | Revalidate on relevant access failures before reranking; record the cause. |
| Nitro can expose users to unexpected provider, precision, and cost | Nitro may select undeclared quantization and priority-tier routing. | Explicit unfiltered warning, current likely-route disclosure, default data denial, explicit opt-in for allow. |
| Provider/region concentration | Multiple candidates may depend on common underlying infrastructure or tags. | Add provider and region diversity analysis as a secondary constraint after routable identity work is complete. |
| Quality verification can become stale | A provider’s backend may change after passing evaluation. | Version verification records and require scheduled reevaluation or reevaluation after material endpoint changes. |

---

# 4. Preserved dissent and critique register

The following recorded disagreements are preserved without averaging them away.

## [Q1] Selector ambiguity and same-tag routing

**Source:** DeepSeek unprompted observation; Grok unprompted observation; DeepSeek R1.  
**Position:** The BaseTen rows cannot be truthfully ranked independently if `order` only selects their shared tag.  
**Assessment:** Well-founded and adopted. This is a launch-blocking correctness issue, not merely a UI concern.

## [Q1] Native preference `ignore` construction and failure behavior

**Source:** Grok R1.  
**Position:** The implementation must specify construction and refresh of local `ignore` lists and behavior after a pinned request failure.  
**Assessment:** Well-founded. The adopted local-ranking policy reduces dependence on native preferences but does not remove the need to verify payload semantics and failure behavior.

## [Q1] Account-guardrail freshness

**Source:** DeepSeek R1.  
**Position:** A launch-time 404 preflight can become stale if account guardrails change during a session.  
**Assessment:** Well-founded. Error-triggered revalidation is adopted; periodic revalidation may be evaluated later if it does not disturb the pin.

## [Q2] Fixed `N = 1024`

**Source:** DeepSeek R1; Grok primary recommendation.  
**Position:** Grok favored a fixed initial `N = 1024`; DeepSeek objected that one number is not suitable for helper, interactive, and reasoning-heavy work.  
**Assessment:** DeepSeek’s objection is adopted. Chorus may use provisional defaults, but they must be workload-profile-specific and visibly treated as assumptions.

## [Q2] p90 as more than a display signal

**Source:** Grok R1.  
**Position:** Using p90 only for display and tie-breaks may underweight tail experience, particularly for Fast and interactive use.  
**Assessment:** Well-founded as a product-risk concern. Not adopted as primary scoring because the supplied evidence does not establish the appropriate tail objective or reliable interpretation of these p90 values.

## [Q2] Prefix-processing latency

**Source:** DeepSeek R1.  
**Position:** Effective throughput based on output latency and throughput can miss long-context prefix-processing time.  
**Assessment:** Well-founded. The adopted formula is an interim improvement, not a complete latency model.

## [Q2] Reasoning effects on latency and throughput

**Source:** Grok R1.  
**Position:** Reasoning affects measured latency and throughput, not only output cost share.  
**Assessment:** Well-founded. It is a required measurement item for calibration of `N` and reasoning profiles.

## [Q3] Quality-evaluation graduation design

**Source:** Grok R1; DeepSeek primary recommendation.  
**Position:** The verified-provider path needs concrete evaluation criteria and must account for endpoint identity.  
**Assessment:** Well-founded and adopted as an action item.

## [Q4] Immediate hysteresis

**Source:** Structural dissent between DeepSeek and Grok.  
**Position:** DeepSeek agreed with gates and proposed immediate hysteresis; Grok qualified because the original proposal deferred it.  
**Assessment:** No remaining substantive disagreement. Immediate hysteresis is adopted.

## [Q4] Longer reliability windows

**Source:** DeepSeek R1.  
**Position:** One-day and five-minute uptime do not detect longer-term provider instability.  
**Assessment:** Well-founded but unmeasured in the supplied record. It is a roadmap measurement item.

## [Q4/Q6] Potential lag from smoothing and hysteresis

**Source:** Grok R1.  
**Position:** Six-observation smoothing and 99.6% readmission could react too slowly to real changes.  
**Assessment:** Well-founded. The adopted hard current-state gates mitigate this risk, but the parameter choices require later review.

## [Q5] Universal caching assumption

**Source:** Structural dissent between DeepSeek and Grok.  
**Position:** DeepSeek qualified the proposal; Grok rejected it. Both opposed assuming 70% cache hits without evidence.  
**Assessment:** Grok’s stronger rejection is adopted.

## [Q5] Partial assumed cache share

**Source:** Grok proposed 55/15/30; DeepSeek R1 rejected it.  
**Position:** Grok proposed limited cache credit before verification; DeepSeek argued that even 15% is unearned.  
**Assessment:** DeepSeek’s position is adopted. Unknown cache behavior receives no cache-read credit.

## [Q5] Measured token mixes

**Source:** DeepSeek R1.  
**Position:** Fixed workload profiles should ultimately be replaced with observed workload-specific token mixes.  
**Assessment:** Well-founded and adopted as a measurement requirement.

## [Q6] Three versus six smoothing observations

**Source:** Grok primary recommendation; DeepSeek primary recommendation.  
**Position:** Grok favored three; DeepSeek favored six with at least three required.  
**Assessment:** Six is adopted as the target; the optimal window remains unmeasured.

## [Q6] Snapshot retention and storage

**Source:** Grok R1.  
**Position:** Snapshot retention, persistence, and privacy need explicit policy.  
**Assessment:** Well-founded. Retention and deletion rules are required before implementation.

## [Q7] Default-deny could reduce Nitro availability

**Source:** Grok R1.  
**Position:** `data_collection: "deny"` may reduce the available Nitro route pool.  
**Assessment:** Well-founded. The council still adopts default-deny, because privacy-preserving consent should be opt-out only through explicit user action.

## [Q1/Q3] Provider and region diversity

**Source:** Grok R1.  
**Position:** Candidate order may concentrate on a common provider or region despite apparently separate rows.  
**Assessment:** Well-founded. It is not yet supported by sufficient identity data to become a hard constraint, but it should be evaluated after endpoint identity normalization.

---

# 5. Checkable action items

## Routing identity and request semantics

- [ ] **Verify unique selectors.** For every curated model endpoint, determine whether the `order` value is a unique endpoint identifier, unique display name, or shared provider tag.
- [ ] **Block ambiguous row ranking.** Add a test fixture containing two rows with the same routable tag and verify that the ranker collapses them unless a verified unique selector exists.
- [ ] **Implement conservative tag aggregation.** Verify through unit tests that collapsed tags use minimum uptime, lowest p50 throughput, highest p50 latency, highest cost, non-zero-status exclusion, and unioned capability failures.
- [ ] **Verify request-failure semantics.** Run integration tests covering primary outage, each ordered entry unavailable, shared-tag routing, and `allow_fallbacks: false`; record the actual request and response behavior.
- [ ] **Verify no hidden native sorting.** Assert that Budget, Balanced, and Fast payloads do not include a conflicting live `sort` setting.

## Scoring and workload profiles

- [ ] **Implement effective-throughput scoring.** Unit-test:

  \[
  tps_{eff} = \frac{N}{L_{p50} + N/tps_{p50}}
  \]

  including seconds/milliseconds conversion and zero/missing-value exclusions.
- [ ] **Retain the Budget p50 floor.** Unit-test that Morph-like 17 p50 tps candidates are rejected when the floor is 45 tps even if they are cheap.
- [ ] **Add profile-specific `N`.** Define configuration entries for interactive, helper, reasoning-interactive, and reasoning-helper expected output tokens.
- [ ] **Expose p90 diagnostics.** Persist p90 throughput and latency in the ranking explanation without using them in the initial score.
- [ ] **Record score inputs.** Store, with each selection, the effective throughput, latency, p50 throughput, blended cost, profile, and exclusion reasons used.

## Quantization and quality verification

- [ ] **Enforce `firstPartyAndVerified`.** Unit-test that unknown quantization is excluded unless registry metadata marks the candidate as first-party or verified.
- [ ] **Create a verification registry schema.** Include model, routable identity, reference endpoint, task suite version, score, date, expiry, and reviewer/version.
- [ ] **Define quality-evaluation acceptance criteria.** Specify the minimum tool-calling task count, quality threshold, failure criteria, and reevaluation interval before any unknown-quantization endpoint can be admitted.
- [ ] **Require selector-specific verification.** Prevent a verification record for one backend from qualifying a different backend behind a shared tag.

## Reliability and eligibility

- [ ] **Implement hard gates.** Unit-test exclusion for missing uptime, one-day uptime below 99.5%, five-minute uptime below 95%, and any non-zero `status`.
- [ ] **Implement 99.6% readmission hysteresis.** Unit-test that an endpoint excluded at 99.49% remains excluded at 99.55% and returns only at 99.60% or above.
- [ ] **Preserve immediate current-state exclusion.** Unit-test that a 5-minute uptime failure or non-zero status removes an endpoint immediately despite prior eligibility.
- [ ] **Run account-specific preflight before ranking.** Assert that removed endpoints are excluded before tiers are presented.
- [ ] **Revalidate access on relevant failures.** On a route or access failure, run a preflight before recomputing eligibility and record the result.

## Cost, caching, and reasoning

- [ ] **Implement endpoint-specific cache cost rules.** Unit-test that undeclared and unverified endpoints use `0.90 input + 0.10 output`, while declared or verified caching uses `0.20 input + 0.70 cache-read + 0.10 output`.
- [ ] **Evaluate time-window pricing at launch.** Add fixtures with weekday and UTC price overrides, including a price-doubling window.
- [ ] **Count reasoning as output.** Ensure the workload profile and cost calculator include expected reasoning tokens in output-priced tokens.
- [ ] **Create cache verification criteria.** Define what billable evidence is sufficient to mark caching as locally verified for a model and endpoint identity.
- [ ] **Collect local aggregate-free workload measurements.** Record per-profile token mix and cache-hit evidence without shared telemetry or transmission to Chorus infrastructure.

## Snapshot smoothing and lifecycle

- [ ] **Retain 30-minute observations.** Store timestamped p50 throughput and p50 latency observations by model and routable endpoint identity.
- [ ] **Implement six-observation medians.** Unit-test median calculation, missing-window handling, and the minimum-three-observation stability flag.
- [ ] **Label provisional candidates.** Verify that candidates with fewer than three observations are visibly marked and do not bypass hard gates.
- [ ] **Persist session selection.** Test that the chosen order does not change during a session absent explicit rerank or defined failure conditions.
- [ ] **Snapshot helper routing.** Test that Team Session helper selections are written into run configuration and remain reproducible.
- [ ] **Define retention policy.** Specify maximum retained snapshot age, storage location, deletion behavior, and whether snapshots contain any user content. The expected answer is that they contain endpoint metadata only.

## Nitro and privacy

- [ ] **Default all tiers to deny collection.** Assert that Budget, Balanced, Fast, and Nitro payloads send `data_collection: "deny"` unless the user explicitly opts in.
- [ ] **Verify Nitro plus deny.** Maintain an integration test proving that `<slug>:nitro` and `data_collection: "deny"` coexist.
- [ ] **Implement Nitro warning content.** Test that the UI identifies Nitro as unfiltered, names current likely routing where known, discloses undeclared quantization and possible priority-tier charges, and states that actual routing may differ.
- [ ] **Require affirmative opt-in for allow.** Ensure that switching to `"allow"` requires an explicit user action and is not implied by selecting Nitro.
- [ ] **Measure default-deny impact.** Record locally whether deny changes route availability or causes errors, without transmitting prompt or code data.

---

# 6. Final adopted policy

Chorus shall implement a local, pure ranker over endpoint snapshots, curated model metadata, account eligibility, settings, and current time.

For Budget, Balanced, and Fast, Chorus shall:

1. preflight account guardrail eligibility;
2. normalize API rows into actually routable identities;
3. apply hard safety, reliability, parameter, context, output-capacity, and account-eligibility filters;
4. exclude undeclared quantization unless first-party or verified;
5. use cache-read pricing only when caching is declared or locally verified;
6. smooth p50 throughput and p50 latency across recent snapshots;
7. score with latency-aware effective throughput and the approved log-cost formula;
8. retain the Budget raw-p50 speed floor;
9. send the top eligible candidates in explicit `order`;
10. persist the selected route for the session;
11. rerank only on user request, relevant failure, or hard-gate loss.

Nitro shall remain available as the one explicit exception to the normal uptime and precision rules, with a current, prominent warning and default `data_collection: "deny"`.

The ranker shall not claim a precision, performance, endpoint identity, cache behavior, or fallback guarantee that has not been measured or verified.

---

## How disagreement was detected

- **Q1** — detection: `structural` · members agreed
- **Q2** — detection: `structural` · members agreed
- **Q3** — detection: `structural` · members agreed
- **Q4** — detection: `structural` · members disagreed
- **Q5** — detection: `structural` · members disagreed
- **Q6** — detection: `structural` · members agreed
- **Q7** — detection: `structural` · members agreed

_`structural` means the orchestrator compared the members' own verdict tokens and counted the difference. `model-judged` means too few members answered in the required form, so the arbiter judged it from prose — a weaker signal, labelled rather than hidden._

## Dissents preserved

_6 preserved: 2 structural (computed from the members' own verdict tokens) · 4 from critique prose, from 2 members — DeepSeek v4 Pro 0813 2 · Grok 4.6 2._

_⚠ Read the per-member split before reading breadth into the total: several objections from one member is one member disagreeing repeatedly, not several members disagreeing. Nothing is dropped to make the total smaller._

- [Structural — Q4] Are 99.5% over one day, a 5-minute guard at 95%, and excluding a non-zero `status` the right reliability gates, and should hysteresis apply from the start (see Q4 background)? — AGREE: DeepSeek v4 Pro 0813 · QUALIFY: Grok 4.6
- [Structural — Q5] Is the 20/70/10 fresh/cached/output profile with caching assumed to work a sound default when only one endpoint declares implicit caching, and how should reasoning-token output be accounted for (see Q5 background)? — QUALIFY: DeepSeek v4 Pro 0813 · DISAGREE: Grok 4.6
- [Critique — R1] DeepSeek v4 Pro 0813: I disagree with two parts. First, Q5’s default `0.55·input + 0.15·cache_read + 0.30·output` still assumes an unmeasured 15% cache-read rate on endpoints that neither declare nor have measured implicit caching. That is the same category of error as the 70% assumption, only smaller: it still gives unearned weight to cheap cache-read prices. If the principle is “no unearned cache,” the no-cache default should be input/output only, with `cache_read` entering only when declared or observed. Second, Q2’s `N=1024` should not be the only launch value across all modes. A fixed 1024-token turn overweights generation throughput for short helper turns and underweights reasoning-heavy turns; the ranker should use mode-specific `N` at launch or expose sensitivity rather than ship one unmeasured default.
- [Critique — R1] DeepSeek v4 Pro 0813: The effective-speed formula does not model long input/prefix processing time; long-context prompts can dominate latency in ways `N / (latency + N / tps_p50)` misses. The cost blend should eventually use measured session token mixes rather than fixed weights. Uptime beyond one-day/5-minute is not considered: 7-day or 30-day stability would catch providers that pass today but are chronically flapping. Also, the same-tag collapse must be reconciled with Q1’s pinning mechanics—specifically whether `order` accepts a unique provider/endpoint id and whether `allow_fallbacks: false` behaves as intended across same-tag endpoints. Finally, a launch-time 404 preflight can go stale if account guardrails change mid-session; a lightweight error-triggered or periodic revalidation would help without disturbing the pin.
- [Critique — R1] Grok 4.6: Treating p90 solely as a display/tie-break signal under-weights tail latency for interactive/Fast use; the N≥6 (min 3) smoothing window plus 99.6% readmit threshold are underspecified and may lag real degradations; forcing `data_collection: deny` on Nitro by default may shrink the Nitro pool even if the combination is technically valid.
- [Critique — R1] Grok 4.6: Construction and refresh of the local `ignore` list; mid-request failure behaviour under `allow_fallbacks: false`; how reasoning tokens affect measured latency/throughput (not just cost share); snapshot retention/storage policy; quality-eval graduation path details for unknown-quant endpoints; provider/region diversity as a secondary constraint.

## Provenance

- **Run id:** `afb5a075-0c5b-4eda-b31c-8da4e9623ac2`
- **Started:** 2026-10-02T09:21:43.716Z

| Member | Role | Model | Turns |
|---|---|---|---|
| DeepSeek v4 Pro 0813 | member | `deepseek/deepseek-v4-pro-0813` | answered 2 turns |
| GLM 5.3 | member | `z-ai/glm-5.3` | refused 1 turn |
| Grok 4.6 | member | `x-ai/grok-4.6` | answered 2 turns |
| Qwen 3.8 Max | member | `qwen/qwen3.8-max` | refused 1 turn |
| GPT 5.6 Terra | arbiter | `openai/gpt-5.6-terra` | answered 2 turns |

