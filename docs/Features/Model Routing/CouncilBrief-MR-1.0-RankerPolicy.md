# Council brief MR-1.0 — Provider-ranking policy for OpenRouter tiers

**To the council: answer the seven numbered items in the "Questions" section below. Do not review this document's format, completeness or status.** Everything you need is in this document; treat the measured facts in sections 3 and 5 as established.

## 1. Decision context

Chorus is a local-first desktop app that runs AI coding agents (OpenCode, Claude Code, Codex) in terminal panes. Users bring their own OpenRouter API key. One OpenRouter model is often served by 30 or more provider endpoints that differ widely in price, speed, reliability and numeric precision.

The product owner wants four routing choices when launching an OpenCode agent on OpenRouter, both for interactive sessions and for the helper agents of a "Team Session":

- **Budget:** cheap, but not blindly cheapest; paying a little more for much more speed should win.
- **Balanced:** equal weight on speed and price.
- **Fast:** the fastest endpoint that passes the safety rules.
- **Nitro:** OpenRouter's own `:nitro` routing, explicitly unfiltered, labelled as such in the UI.

Chorus would rank endpoints locally from a snapshot of OpenRouter's public endpoints data, then launch the agent with an OpenRouter `provider` object that pins the chosen endpoints. The first model is DeepSeek V4.1 Flash (open weights, native FP8); the design must extend to five or six hand-curated models. The ranking code is a pure function of snapshot + model registry + settings + current time, unit-tested against saved fixtures.

The council is asked to rule on the ranking policy before it is implemented.

## 2. Binding constraints (rulings already made, not open for debate)

- **Uptime floor:** endpoints below 99.5% uptime are excluded from Budget, Balanced and Fast.
- **Native-or-better precision:** endpoints quantized below the model's native precision are excluded from Budget, Balanced and Fast.
- **Nitro is the one deliberate exception** to both rules, and is offered as-is.
- **No proxy:** routing is delivered by OpenCode's own config, which forwards the `provider` object verbatim (verified).
- **Bring your own key:** all OpenRouter calls run locally in the app's main process; there is no Chorus server and no shared telemetry.
- **Curated models:** a small hand-maintained registry records native precision, first-party providers, and providers verified by a quality evaluation.

## 3. Facts measured on 2026-10-02 (treat as established)

- OpenCode 1.18.33 forwards a per-model `provider` object (`order`, `allow_fallbacks`, `quantizations`, `require_parameters`, `data_collection`) into the request body exactly, without dropping the reasoning effort or output cap.
- `order` + `allow_fallbacks: false` pinned the endpoint on 10 of 10 tool-bearing requests, despite OpenRouter's "Auto Exacto" reordering of tool-calling requests. `order` accepts endpoint tags (`atlas-cloud/fp8`) and display names.
- The response's top-level `provider` field names the provider that served the request. It cannot tell apart two endpoints of the same provider, but the billed cost can.
- With an API key, the endpoints API returns `throughput_last_30m` and `latency_last_30m` as `{p50, p75, p90, p99}` objects (tokens/s and milliseconds). Without a key both are null.
- 30-minute speed windows are noisy. Morph's p50 was 57 tps on 2026-10-01 and 17 tps on 2026-10-02. Two BaseTen endpoints that share one tag measured 90 and 62 tps. BaseTen's fast endpoint showed p50 31 but p90 260.
- `:nitro` is not equivalent to `provider.sort = "throughput"`: in one sample each, `:nitro` routed to Together (223 tps) and the sort routed to AtlasCloud (98 tps). `:nitro` also admits priority-tier endpoints.
- Account-level guardrails (for example "no providers that train on paid prompts") silently remove endpoints at request time. The endpoints API still lists them. A free 404 preflight request reveals which ones are removed.
- Endpoint objects carry a `status` field; one endpoint reported `-2` alongside 97% uptime.
- Only one of 33 endpoints (DeepSeek first-party) declares `supports_implicit_caching: true`. Cache-read prices are listed for nearly all.
- Some endpoints carry time-of-day price overrides (HHMM UTC windows, optionally per weekday). DeepSeek first-party doubles its price during two weekday UTC windows.

## 4. The proposed policy

**Filters**, applied to every endpoint for Budget, Balanced and Fast. Every exclusion records a reason shown in the UI:

- uptime over the last day below 99.5%, or over the last 5 minutes below 95% (a "currently down" guard); missing uptime is excluded;
- quantization below native precision;
- `unknown` quantization, unless the provider is the model's first party or has passed Chorus's quality evaluation (`firstPartyAndVerified` policy);
- missing a required parameter (`tools`, `tool_choice`, `max_tokens`, plus `reasoning` when an effort is set), context below 262,144 tokens, or maximum output below the session's need (65,536 interactive; 64,000 for helpers);
- removed by the account's guardrails, or reporting a non-zero `status`.

**Cost:** a blended $/M from a workload profile. The default `agentic-coding` profile is 20% fresh input, 70% cached input, 10% output, priced at the current time of day. Reasoning tokens bill as output.

**Score**, for each eligible endpoint and tier weight `w`:

```
score = w · ln(tps) − (1 − w) · ln(blended cost)
```

`w` is 0.30 for Budget, 0.50 for Balanced and 1.00 for Fast. The log form is scale-invariant across models: at `w = 0.30`, an endpoint 10% pricier but 2× faster wins, and one 2× pricier and 2× faster loses. Budget also drops endpoints below `max(30 tps, 0.5 × median tps of the eligible set)`. Scores within 1% tie-break on higher uptime, then lower latency, then lower cost, then tag.

**Selection and payload:** the top three by score become `order` (primary plus two fallbacks), sent with `allow_fallbacks: false`, `require_parameters: true` and a `quantizations` list built from the selected endpoints. Nitro sends `<slug>:nitro` with no `order`. A tier whose endpoints all fail shows "All providers for this tier are unavailable" with a "Re-rank now" action; Chorus never falls back to an excluded endpoint on its own.

**Lifetime:** the selection is computed at launch from the newest snapshot (refreshed on request; stale after 60 minutes) and persists for the session. Helpers snapshot their selection into the run's configuration.

## 5. Exhibit: today's data under the proposed policy

DeepSeek V4.1 Flash, 2026-10-02 ~09:15 UTC. Prices from the endpoints API; speed is the API's 30-minute p50 (p90 in parentheses); 15 of 33 endpoints are eligible. The median eligible p50 is 90 tps, so the Budget floor is 45 tps.

| Endpoint | Quant | Uptime 1d | In / Out / Cache-read ($/M) | Blended | p50 tps (p90) | p50 latency | Budget score | Balanced score |
|---|---|---|---|---|---|---|---|---|
| atlas-cloud/fp8 | fp8 | 99.62 | 0.141 / 0.564 / 0.0141 | 0.0945 | 98 (157) | 1.02s | 3.027 | 3.472 |
| gmicloud/fp8 | fp8 | 99.75 | 0.180 / 0.720 / 0.0036 | 0.1105 | 101 (157) | 2.52s | 2.926 | 3.409 |
| deepinfra/fp8 | fp8 | 99.96 | 0.140 / 0.420 / 0.0042 | 0.0729 | 63 (85) | 1.43s | 3.076 | 3.381 |
| venice/fp8 | fp8 | 99.83 | 0.375 / 1.500 / 0.0075 | 0.2303 | 186 (373) | 0.89s | 2.596 | 3.347 |
| baidu/fp8 | fp8 | 99.86 | 0.300 / 1.199 / 0.0060 | 0.1840 | 146 (248) | 1.29s | 2.680 | 3.338 |
| streamlake/fp8 | fp8 | 99.60 | 0.141 / 0.564 / 0.0028 | 0.0866 | 67 (132) | 1.49s | 2.974 | 3.326 |
| parasail/fp8 | fp8 | 99.54 | 0.300 / 1.200 / 0.0060 | 0.1842 | 126 (234) | 1.13s | 2.635 | 3.264 |
| nextbit/fp8 | fp8 | 99.96 | 0.210 / 0.840 / 0.0040 | 0.1288 | 88 (124) | 2.02s | 2.778 | 3.263 |
| makora/fp8 | fp8 | 99.61 | 0.200 / 0.990 / 0.0060 | 0.1432 | 96 (218) | 0.74s | 2.730 | 3.254 |
| novita/fp8 | fp8 | 99.92 | 0.240 / 0.960 / 0.0048 | 0.1474 | 93 (160) | 1.82s | 2.700 | 3.224 |
| baseten/fp8 (first) | fp8 | 99.93 | 0.300 / 1.200 / 0.0070 | 0.1849 | 90 (323) | 0.30s | 2.532 | 3.094 |
| baseten/fp8 (second) | fp8 | 99.96 | 0.300 / 1.200 / 0.0070 | 0.1849 | 62 (293) | 0.30s | 2.420 | 2.908 |
| morph/fp8 | fp8 | 99.54 | 0.030 / 0.420 / 0.0080 | 0.0536 | 17 (60) | 3.34s | below floor | 2.880 |
| siliconflow/fp8 | fp8 | 99.70 | 0.300 / 1.200 / 0.0060 | 0.1842 | 58 (137) | 2.36s | 2.402 | 2.876 |
| baseten/fast | fp32 | 99.93 | 0.600 / 2.400 / 0.1400 | 0.4580 | 31 (260) | 0.63s | below floor | 2.107 |

**Resulting tiers:**

| Tier | Order sent to OpenRouter | On 2026-10-01 (website speeds) |
|---|---|---|
| Budget | deepinfra/fp8 → atlas-cloud/fp8 → streamlake/fp8 | DeepInfra → Morph → AtlasCloud |
| Balanced | atlas-cloud/fp8 → gmicloud/fp8 → deepinfra/fp8 | AtlasCloud → DeepInfra → DeepSeek |
| Fast | venice/fp8 → baidu/fp8 → parasail/fp8 | Baidu → AtlasCloud → NextBit |
| Nitro | `:nitro`, likely Together (223 tps, quantization undeclared) | Together |

**Excluded (18):**

| Endpoint | Quant | Uptime 1d | p50 tps | Reasons |
|---|---|---|---|---|
| together | unknown | 99.96 | 223 | quantization not declared |
| fireworks/us | unknown | 99.93 | 168 | quantization not declared |
| coreweave/fp8 | fp8 | 98.34 | 158 | uptime below 99.5% |
| ionstream | unknown | 99.74 | 134 | quantization not declared |
| deepseek (first party) | unknown | 99.35 | 107 | uptime below 99.5%; removed by the account's guardrail |
| modal | unknown | 99.78 | 90 | quantization not declared |
| wafer | unknown | 99.41 | 89 | uptime; quantization not declared |
| fireworks | unknown | 99.62 | 81 | quantization not declared |
| inference-net | unknown | 99.495 | 77 | uptime below 99.5%; quantization not declared |
| phala | unknown | 99.76 | 76 | quantization not declared |
| dekallm | unknown | 99.18 | 65 | uptime; quantization not declared |
| relace | unknown | 99.31 | 62 | uptime; quantization not declared |
| io-net/fp8 | fp8 | 98.22 | 57 | uptime below 99.5% |
| decart/fp4 | fp4 | 99.89 | 56 | fp4 below native fp8 |
| sail-research/fp4 | fp4 | 99.61 | 55 | fp4 below native fp8 |
| digitalocean | unknown | 99.98 | 55 | quantization not declared |
| alibaba | unknown | 97.18 | 53 | uptime; degraded now (5-minute 92.4%); quantization not declared; status −2 |
| open-inference/fp4 | fp4 | 99.29 | 12 | uptime; fp4 below native fp8 |

## 6. Background for each item

### Q1 — Rank locally, or express tiers as OpenRouter preferences

OpenRouter's `provider` object now offers `sort` (by price, throughput or latency, optionally with a `partition`), `preferred_min_throughput` and `preferred_max_latency` (numbers or percentile objects), `max_price`, `quantizations`, `only` and `ignore`. A tier could be expressed as, for example, "sort by price among fp8+ endpoints not in `ignore`, preferring at least 60 tps", leaving the per-request choice to OpenRouter's live data. The proposal instead ranks locally and pins three endpoints with `allow_fallbacks: false`. Pinning keeps prompt caches warm on one endpoint and makes the choice explainable in the UI, but it freezes a decision made from a 30-minute window. The uptime rule and the undeclared-quantization rule are not directly expressible as native preferences except through an `ignore` list that Chorus would still compute.

### Q2 — Scoring shape and speed statistic

The score trades log-speed against log-cost. Budget's floor exists because an 8 tps endpoint once ranked well on price alone. The API now supplies p50 and p90 throughput and latency. Coding agents make many turns of a few hundred output tokens, often with long reasoning, so time-to-first-token and sustained throughput both matter. An "effective throughput" form, `expectedOutputTokens / (latency + expectedOutputTokens / tps)`, was proposed as a later option.

### Q3 — Undeclared quantization

`unknown` means the provider did not declare its precision, not that it is degraded. Under the proposed default, twelve undeclared endpoints (besides first-party DeepSeek) are excluded today. Seven of them fail no other rule, including the fastest endpoint overall (Together, 223 tps, 99.96% uptime) and Fireworks US (168 tps). Admitting them would change Fast and probably Balanced. The planned graduation path is a per-provider quality evaluation (20–50 tool-calling tasks compared with a reference endpoint) that adds providers to a verified list.

### Q4 — Uptime and liveness gates

Several endpoints sit within 0.1% of the floor (inference-net 99.495%, excluded; Morph 99.535% and Parasail 99.539%, admitted), so they can flip between snapshots. Hysteresis (re-admit only at 99.6%) was proposed for later. A non-zero `status` and a 5-minute uptime dip are the only "right now" signals in the data.

### Q5 — Cost model and caching

The 70% cached-input share assumes that the cache hits. Only one endpoint declares implicit caching, though nearly all list a cache-read price; whether caching happens elsewhere depends on the harness sending cache hints and on routing staying on one endpoint. If caching does not happen, endpoints with cheap cache-read prices are flattered. An alternative is to apply the cached share only where caching is declared or later measured. Reasoning-heavy runs raise the true output share well above 10%.

### Q6 — Staleness and re-ranking

A session can last hours, and helper runs are snapshotted at launch. Speed data is a 30-minute window and visibly unstable (section 3). Options include smoothing across several snapshots, using p50 and p90 together, re-ranking only on failure or on request (the proposal), or on a timer. Re-ranking mid-session would move the agent to a cold cache.

### Q7 — Nitro and data policy

Nitro currently routes to an undeclared-quantization endpoint and may use priority-tier endpoints that bill more. The account's own guardrails still apply to Nitro, and `data_collection: "deny"` combines with `:nitro` (verified). The proposal offers Nitro with a warning naming the likely endpoint and the rules it fails, and leaves `data_collection` at `allow` unless the user opts in.

## Questions

1. Should Chorus rank endpoints locally and pin them with `order` plus `allow_fallbacks: false`, or express each tier as OpenRouter-native preferences (`sort`, `partition`, `preferred_min_throughput`, `preferred_max_latency`, `max_price`, `quantizations`, `ignore`) and let OpenRouter choose per request (see Q1 background)?
2. Is `w·ln(tps) − (1−w)·ln(blended cost)` with weights 0.30 / 0.50 / 1.00 and the Budget floor the right scoring shape, and which speed statistic (p50, p90, a blend, or effective throughput with latency) should feed it (see Q2 background)?
3. Should endpoints with undeclared quantization stay excluded unless first-party or verified, be admitted with a score penalty, or be admitted outright (see Q3 background)?
4. Are 99.5% over one day, a 5-minute guard at 95%, and excluding a non-zero `status` the right reliability gates, and should hysteresis apply from the start (see Q4 background)?
5. Is the 20/70/10 fresh/cached/output profile with caching assumed to work a sound default when only one endpoint declares implicit caching, and how should reasoning-token output be accounted for (see Q5 background)?
6. Given unstable 30-minute speed windows, how should snapshots be smoothed, how long should a routing choice persist, and when should Chorus re-rank: at launch only, on failure, or on a timer (see Q6 background)?
7. Is offering the unfiltered Nitro tier consistent with the two safety rules when it routes today to an undeclared-quantization endpoint, and should `data_collection: "deny"` be the default for every tier (see Q7 background)?

## Required response

For each numbered item: approve, qualify, or revise the proposal. Where you revise, state the replacement concretely (formula, threshold, or rule) and a scenario in which the proposal would choose badly, using section 5's data where possible. Separate claims that follow from the measured facts from assumptions that would need a new measurement. Preserve dissent rather than averaging it away.

## Disposition

Findings will be stored beside this brief as `CouncilBrief-MR-1.0-RankerPolicy-Findings.md`. Adopted and rejected recommendations, with reasons, will be recorded in the Model Routing roadmap before the ranker is implemented.
