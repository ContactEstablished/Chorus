# Plan: OpenRouter Provider Tiers (Budget / Balanced / Fast / Nitro) for Chorus

> **Status:** Ready for implementation
> **Author context:** Written 2026-10-01 from a design conversation. All numbers in the worked example are a snapshot from that day.
> **Target app:** Chorus (Electron + Vue 3 + TypeScript), "New session" dialog, OpenRouter harness

---

## 1. Goal

When creating an agent in Chorus using the **OpenRouter** harness, the user should be able to:

1. Pick a **model** (e.g. `deepseek/deepseek-v4.1-flash`).
2. Click **"Fetch latest numbers"** to pull current provider data (price, uptime, quantization, speed) for that model.
3. See four options and pick one:
   - **Budget**: cheap, but not *blindly* cheapest. Paying a penny or two more for twice the throughput should win.
   - **Balanced**: equal weight between speed and price.
   - **Fast**: the fastest provider that still passes the safety filters.
   - **Nitro**: raw OpenRouter `:nitro`. The model slug gets `:nitro` appended and OpenRouter routes to the highest-throughput provider. **Not filtered** by the safety rules below.
4. Launch the session with an OpenRouter **routing configuration**:
   - **Budget / Balanced / Fast:** model slug + `provider` object that pins the request to the chosen provider and its fallbacks.
   - **Nitro:** `model: "<slug>:nitro"` and no provider pinning.

### Non-negotiable safety rules (from the product owner)

| Rule | Detail |
|---|---|
| **Uptime floor** | Any provider endpoint with uptime **below 99.5%** is excluded. |
| **Native-or-better precision** | Any endpoint whose quantization is **below the model's native precision** is excluded. |

Everything that survives both filters gets scored. These rules apply to **Budget, Balanced, and Fast**.

**Nitro is the one deliberate exception.** It is OpenRouter's own `:nitro` routing, offered as-is for when raw speed matters more than the safety rules. The UI labels it clearly as unfiltered (see §9).

### Scope

- Start with **DeepSeek V4.1 Flash** only.
- Design for **5–6 curated models total**. Because the list is short, the plan favors a **hand-maintained model registry** over clever auto-detection.

---

## 2. User flow (UI)

```
New session
├── Agent: [Claude Code] [Codex] [OpenRouter] ...   ← user picks OpenRouter
├── Model: [ DeepSeek V4.1 Flash ▾ ]                ← from model registry (§11)
├── Provider routing:  [ ⟳ Fetch latest numbers ]   "Updated 4 min ago"
│
│   ┌────────── Budget ──────────┐ ┌───────── Balanced ─────────┐ ┌─────────── Fast ───────────┐ ┌───────── Nitro ⚠ ──────────┐
│   │ DeepInfra (fp8)            │ │ AtlasCloud (fp8)           │ │ Baidu Qianfan (fp8)        │ │ OpenRouter :nitro          │
│   │ $0.073/M · 68 tps          │ │ $0.094/M · 109 tps         │ │ $0.184/M · 122 tps         │ │ Likely: Together (221 tps) │
│   │ 99.95% · 0.87s             │ │ 99.92% · 1.21s             │ │ 99.63% · 0.82s             │ │ $0.184/M · 0.33s           │
│   │ Fallbacks: Morph,          │ │ Fallbacks: DeepInfra,      │ │ Fallbacks: AtlasCloud,     │ │ Fallbacks: OpenRouter      │
│   │   AtlasCloud               │ │   DeepSeek                 │ │   NextBit                  │ │   decides                  │
│   │ "7% pricier than Morph,    │ │ "Best speed-per-dollar of  │ │ "Fastest provider that     │ │ ⚠ Unfiltered: may route to │
│   │  19% faster"               │ │  12 eligible endpoints"    │ │  passes your rules"        │ │  providers your rules skip │
│   └────────────────────────────┘ └────────────────────────────┘ └────────────────────────────┘ └────────────────────────────┘
│
│   ▸ Show all providers (12 eligible · 20 excluded)  ← expandable table with exclusion reasons
│
└── [Cancel] [Launch]
```

### UI details

- The **model dropdown** lists only models in the registry (§11). Display name plus slug.
- The **"Fetch latest numbers"** button:
  - Shows a spinner and per-step progress ("Fetching endpoints…", "Measuring speed 7/12…").
  - Shows the snapshot age afterward ("Updated 4 min ago"). After the TTL (default 60 min), show a "Numbers are stale" hint.
  - If a cached snapshot exists, the tier cards render immediately from cache with the age shown. The fetch only refreshes.
- Each **tier card** shows:
  - The primary provider and its quantization badge.
  - Blended price, throughput, uptime, and latency.
  - The fallback list and a one-line rationale.
  - Optionally a small ⓘ with the score breakdown.
- The **Nitro card** is visually distinct (amber/warning border) because it bypasses the safety rules:
  - It shows a **"Likely" provider**: the highest-TPS endpoint in the snapshot that supports the required parameters, *ignoring* uptime and precision. This is an estimate; OpenRouter makes the real choice per request.
  - If the likely provider **fails** a rule, the warning names it, e.g. "⚠ Likely provider: Together, quantization not declared."
  - If the likely provider **passes** every rule, the warning softens to "Unfiltered, but currently routes to a provider that passes your rules."
  - No confirmation dialog; the label is enough.
- A **time-of-day pricing badge** (e.g. "⏱ peak pricing 01:00–04:00 UTC") appears when the chosen provider has price overrides (§7.3).
- The **"Show all providers" table** has columns: Provider/tag, Quant, Uptime (1d), Input, Output, Cache read, Blended, TPS, Latency, Status. Status is either `Eligible` or `Excluded: <reason>`, e.g. `Excluded: uptime 98.90% < 99.5%` or `Excluded: fp4 below native fp8`.
- **Empty states:**
  - If **zero** endpoints survive: "No provider meets the uptime and precision rules right now," with an option to view the table. Budget, Balanced, and Fast are disabled. **Nitro stays available** since it doesn't depend on the filters.
  - If **one** survives: show it in Budget, Balanced, and Fast with "No fallback available."
  - **Nitro works without a fetch.** It needs no snapshot, so it can be selected and launched even before "Fetch latest numbers" has run. Only its "Likely" preview requires a snapshot.
- **Default tier selection:** remember the last tier used per model.

---

## 3. Tier definitions

Budget, Balanced, and Fast use the same pipeline (§5) and the same eligible set. They differ only in the **scoring weight** `w` (0 = pure price, 1 = pure speed) and a couple of guard rules. Nitro is not computed by Chorus at all; it delegates to OpenRouter.

| Tier | Weight `w` | Filtered? | Extra rules | Intent |
|---|---|---|---|---|
| **Budget** | `0.30` | ✅ | Throughput floor (§8.3) | Price matters most, but buys speed when speed is cheap |
| **Balanced** | `0.50` | ✅ | none | Equal elasticity: 10% more speed is worth 10% more cost |
| **Fast** | `1.00` | ✅ | none | Max throughput among *eligible* endpoints |
| **Nitro** | n/a | ❌ | none | OpenRouter `:nitro`: max throughput across *all* endpoints, OpenRouter's own fallbacks |

### Why `w = 0.30` matches the "penny more, twice the tps" intuition

The score is `score = w·ln(tps) − (1−w)·ln(cost)`. Comparing provider B to provider A:

- **B is 10% pricier and 2× faster:** `0.3·ln(2) − 0.7·ln(1.10) = 0.208 − 0.067 = +0.141` → **B wins** ✅
- **B is 2× pricier and 2× faster:** `0.3·ln(2) − 0.7·ln(2) = −0.277` → **A wins** ✅ (Budget refuses to pay double)
- **B is 7% pricier and 19% faster** (DeepInfra vs Morph, real data): `0.3·ln(1.19) − 0.7·ln(1.074) = 0.052 − 0.050 ≈ +0.002` → a near-tie, resolved by tie-breakers (§8.4)

The log/ratio form is **scale-invariant**: it behaves identically whether a model runs at 20 tps or 400 tps, and whether it costs $0.10 or $10 per million tokens. That is what makes it reusable across models with no per-model normalization.

---

## 4. Data sources

### 4.1 OpenRouter endpoints API (primary, public, no key needed)

```
GET https://openrouter.ai/api/v1/models/{author}/{slug}/endpoints
e.g. https://openrouter.ai/api/v1/models/deepseek/deepseek-v4.1-flash/endpoints
```

Verified 2026-10-01. Each element of `data.endpoints[]` looks like:

```jsonc
{
  "name": "CoreWeave | deepseek/deepseek-v4.1-flash-20260910",
  "provider_name": "CoreWeave",
  "tag": "coreweave/fp8",                 // unique per endpoint, use as the key
  "quantization": "fp8",                  // int4|int8|fp4|fp6|fp8|fp16|bf16|fp32|unknown
  "context_length": 1048576,
  "max_completion_tokens": 943718,
  "pricing": {
    "prompt": "0.0000002",                // USD per token, as a STRING; ×1e6 for $/M
    "completion": "0.00000065",
    "input_cache_read": "0.00000003",
    "discount": 0,                        // listed prices ALREADY include discount
    "overrides": [ /* optional time-of-day pricing, see §7.3 */ ]
  },
  "supported_parameters": ["tools","tool_choice","reasoning","structured_outputs", "..."],
  "supports_tool_choice": { "none": true, "auto": true, "required": true, "function": true },
  "supports_implicit_caching": false,
  "status": 0,
  "uptime_last_5m": 99.69,
  "uptime_last_30m": 99.30,
  "uptime_last_1d": 98.90,
  "latency_last_30m": null,               // ⚠ was null on 2026-10-01, see §4.3
  "throughput_last_30m": null             // ⚠ was null on 2026-10-01, see §4.3
}
```

**Important observations from the live data:**

- **One provider can have several endpoints** with different prices and precision. On this model:
  - Fireworks has two: `fireworks` and `fireworks/us`.
  - BaseTen has three: two `baseten/fp8` and one `baseten/fast` at fp32.
- **The unit of ranking is the endpoint (`tag`), not the provider name.**
- **Discounts are already applied.** For example, DeepInfra shows `discount: 0.3` and `prompt` = $0.14/M, which is the post-discount price displayed on the website. Never re-apply the discount.
- **Uptime figures differ by window.** CoreWeave showed 99.92% on the website but **98.90%** for `uptime_last_1d`. The filter must use a defined window (§6.1).

### 4.2 Model registry (local, hand-maintained)

This is a JSON file shipped with Chorus. It holds what the API does not provide:
- Native precision
- First-party provider names
- Verified providers
- Workload profile
- Capability requirements

Details in §11.

### 4.3 Speed data (throughput + latency): needs a decision in Phase 0

The OpenRouter website shows P50 latency and throughput per provider. The public endpoints JSON had `latency_last_30m` and `throughput_last_30m` set to **null** at the time of writing. Options, in order of preference:

1. **API fields (preferred if they populate).**
   - Phase 0 spike: call the endpoints API **with** an `Authorization: Bearer <OPENROUTER_API_KEY>` header and at different times of day.
   - If the fields populate, use them. Check whether they're scalars or percentile objects, and prefer P50.
2. **Live speed probe (recommended fallback, and what the "Fetch latest numbers" button can always do).**
   - For each *eligible* endpoint (after uptime/precision/capability filters, so we don't waste calls), send one small streamed request pinned to that endpoint (§10.3).
   - Measure **TTFT** (time to first content token) and **output tokens/sec** after the first token.
   - **Cost:** ~12 endpoints × (~200 input + ~400 output tokens) ≈ well under $0.01 per refresh for DeepSeek V4.1 Flash.
   - Run probes in parallel with a concurrency limit of 4 and a 30s timeout each.
   - A probe that fails or times out marks the endpoint `speedUnknown`. It stays eligible but scores with the median TPS of the eligible set, flagged in the UI.
   - Disable or minimize reasoning for the probe (e.g. lowest `reasoning_effort`) so measured tokens are visible output. Alternatively, count reasoning tokens from usage and include them in the TPS calculation; pick one approach and be consistent.
   - Single samples are noisy. Take **2 samples** per endpoint and keep the better (or the mean). A later phase blends in real telemetry (option 3).
3. **Chorus's own telemetry (Phase 5).**
   - Every real session call already produces TTFT and token counts.
   - Store per-endpoint rolling P50s and blend them with probe results (e.g. 70% telemetry once ≥20 samples exist).
   - This also yields **measured cache-hit ratios** (§7.2).
4. **Not recommended:** scraping OpenRouter's website or internal frontend APIs. These are undocumented and break without notice.

---

## 5. Pipeline overview

```
fetchSnapshot(modelSlug)
  ├─ 1. GET endpoints API                                  → RawEndpoint[]
  ├─ 2. normalize (prices ×1e6, apply time-of-day override,
  │     parse numbers, attach registry info)                → Endpoint[]
  ├─ 3. filter
  │     a. uptime        (§6.1)
  │     b. precision     (§6.2, incl. "unknown" policy §6.3)
  │     c. capabilities  (§6.4: required params, context, max output)
  │     d. data policy   (optional, §6.5)
  │                                                          → eligible[], excluded[] (with reasons)
  ├─ 4. speed: API fields OR live probe on eligible[]        → tps, latency per endpoint
  ├─ 5. cost: blended $/M from workload profile (§7)
  ├─ 6. score per tier (§8)                                  → ranked lists
  ├─ 7. select primary + 2 fallbacks per tier
  ├─ 8. build OpenRouter routing payload per tier (§10)      → RoutingSelection × 3 (Budget/Balanced/Fast)
  └─ 9. Nitro: slug + ":nitro", no ranking, plus "Likely" preview → RoutingSelection
```

**Design principle:** Steps 2–9 are a **pure function** of (snapshot JSON + registry entry + settings + current time). That makes the ranker trivially unit-testable with saved fixtures (§15). Only step 1 and the probe in step 4 do I/O.

---

## 6. Filters

Every exclusion records a human-readable reason string for the UI table.

### 6.1 Uptime

- **Rule:** exclude if `uptime_last_1d < 99.5`.
  - The 1-day window is used because it's stable enough to reflect real reliability but recent enough to catch a provider that is currently struggling.
- **Additional "currently down" guard:** also exclude if `uptime_last_5m < 95`. That provider is having an outage *right now*, even if its day looks fine.
- **Missing uptime data:** exclude, with reason `no uptime data`. This keeps the cautious default.
- Settings: `minUptimePct = 99.5`, `uptimeWindow = "1d"`, `outageGuard5mPct = 95`.
- *(Optional, Phase 5)* **Hysteresis:** once an endpoint is excluded for uptime, require ≥ 99.6% to re-admit it. This avoids flapping around the threshold. On 2026-10-01, Morph sat at **99.502%**, right on the line.

### 6.2 Precision (quantization)

Precision ranking (higher = more precise):

| Value | Rank | Notes |
|---|---|---|
| `fp32` | 6 | |
| `bf16` | 5 | |
| `fp16` | 5 | Treated as equal to bf16 |
| `fp8` | 4 | |
| `int8` | 3 | Conservatively ranked *below* fp8 |
| `fp6` | 2 | |
| `fp4` | 1 | |
| `int4` | 1 | |
| `unknown` | — | Handled by policy §6.3 |

**Rule:** exclude if `rank(endpoint.quantization) < rank(model.nativePrecision)`. An endpoint **above** native passes. For example, BaseTen Fast at `fp32` passes for an fp8-native model.

`nativePrecision` comes from the model registry (§11). For **closed-weight models** (no Hugging Face weights, one serving stack), set `nativePrecision: null`, which **skips** this filter.

### 6.3 The "unknown" quantization policy

Many reputable endpoints report `quantization: "unknown"`, which means "not declared," not "degraded." On DeepSeek V4.1 Flash, this includes:
- **DeepSeek's own first-party endpoint**
- Together (the fastest endpoint by a wide margin)
- Fireworks, Wafer, Modal, Alibaba, DigitalOcean, and others

**Default policy (cautious, per the product owner's direction):**

| Endpoint | Treatment |
|---|---|
| `unknown` + provider is in the model's `firstPartyProviders` | **Treat as native** (the model's creator serves its own weights) |
| `unknown` + provider is in the model's `verifiedUnknownProviders` | **Treat as native** (we tested it, §16 Phase 5) |
| `unknown` otherwise | **Exclude** with reason `quantization not declared` |

This is a setting: `unknownQuantPolicy: "strict" | "firstPartyAndVerified" | "allow"`, with default `"firstPartyAndVerified"`.

> **Why the verified list matters a lot:** on 2026-10-01, Together had 221 tps (fastest by ~80%) and 99.96% uptime, but is `unknown`. Under the default policy, Fast picks Baidu at 122 tps instead (Nitro still reaches Together, unfiltered). Running the quality eval (§16 Phase 5) on Together and Wafer could materially improve the Fast and Budget tiers.

### 6.4 Capabilities

Chorus agents are coding agents, so they need tool calling. Per model (registry) plus global settings:

- **Required parameters:** every value in `requiredParameters` (default `["tools", "tool_choice", "max_tokens"]`) must appear in `supported_parameters`.
- **Tool-choice mode:** if the harness ever forces a tool (`tool_choice: "required"` or a specific function), also require `supports_tool_choice.required === true`. On this model, Relace, Parasail, Novita, Morph, GMICloud, Phala, Baidu, BaseTen Fast, and DeepSeek first-party report `required: false`. That's fine for `auto`-only harnesses, so make it a setting: `requireForcedToolChoice = false`.
- **Context:** `context_length >= model.minContext`. Suggested default: 262,144 for coding agents.
- **Max output:** `max_completion_tokens >= model.minMaxCompletion`. Suggested default: 65,536. Note that io.net, DeepInfra, Venice, and BaseTen Fast cap at 131,072, while others allow ~943K.
- **Image input** (only if the session needs it): the model-level architecture already declares it; no per-endpoint check needed unless an endpoint lists different modalities.

### 6.5 Data policy (optional)

Setting `dataCollection: "allow" | "deny"`, default `"allow"`. When `"deny"`, pass `provider.data_collection: "deny"` in the routing payload (§10). OpenRouter then refuses providers that may store or train on prompts.

Because the endpoints JSON doesn't clearly expose the data policy per endpoint, enforce this **server-side** via the payload rather than in the local filter. Show a note in the UI: "Data policy enforced by OpenRouter at request time."

Recommended `"deny"` for any client or employer work.

---

## 7. Cost model

### 7.1 Blended price

Prices from the API are per-token strings. Convert to $/M with `Number(x) * 1_000_000`.

```
blended = freshInputShare  × inputPrice
        + cachedInputShare × cacheReadPrice
        + outputShare      × outputPrice
```

The shares come from a **workload profile** and must sum to 1.

| Profile | Fresh input | Cached input | Output | Use for |
|---|---|---|---|---|
| `agentic-coding` (**default for Chorus**) | 0.20 | 0.70 | 0.10 | Coding agents resend big contexts every turn, so most input is cache hits |
| `chat` | 0.60 | 0.15 | 0.25 | Short interactive chats |
| `generation-heavy` | 0.30 | 0.00 | 0.70 | Writing long documents/code from short prompts |

**Reasoning tokens are billed as output.** For reasoning-heavy models or high reasoning effort, the true output share is higher than it looks. Calibrate with telemetry in Phase 5.

If `input_cache_read` is missing for an endpoint, treat cached input as fresh input (`cacheReadPrice = inputPrice`).

### 7.2 Caching caveat (important for the agentic profile)

Most endpoints on this model report `supports_implicit_caching: false`; only DeepSeek first-party reports `true`. That suggests cache hits on many providers may require explicit cache-control hints from the harness, or may not happen at all.

The `agentic-coding` profile's 70% cached share **flatters endpoints with cheap cache prices** if caching doesn't actually occur. Mitigation:

- **Phase 1:** keep the formula, but add a setting `assumeCachingWorks = true`. When `false`, only endpoints with `supports_implicit_caching === true` get the cached share; for others, the cached share is billed at `inputPrice`.
- **Phase 5:** replace the assumption with the **measured** cached-token ratio per endpoint from real usage data. OpenRouter usage/generation stats report cached tokens; verify the field names.

### 7.3 Time-of-day pricing (`pricing.overrides`)

Some endpoints change price by time of day. On this model:

- **DeepSeek (first-party):** doubles to $0.30 / $1.20 on weekdays during two UTC windows: `utc_start: 100 → utc_end: 400` and `600 → 1000`. These look like `HHMM`, i.e. **01:00–04:00 and 06:00–10:00 UTC**, which is 9pm–midnight and 2am–6am Eastern.
- **Alibaba:** $0.30 / $1.20 from `0 → 1400` UTC, then **half price** ($0.15 / $0.60) from `1400 → 0`, which is ~10am–8pm Eastern.

Implementation:

```ts
function effectivePricing(p: RawPricing, now: Date): Pricing {
  // 1. Start with base prompt/completion/input_cache_read.
  // 2. For each override: if utc_days (if present) includes today's UTC weekday AND
  //    the UTC HHMM time is within [utc_start, utc_end) — handling utc_end === 0 as 2400
  //    (wrap to midnight) — use that override's prices.
  // 3. Return $/M numbers.
}
```

- **Verify in Phase 0** that `utc_start` / `utc_end` are `HHMM` integers, by cross-checking against the website's displayed price at a known time.
- Compute prices for **"now"** (session start time) by default.
- **Show a badge** on the tier card when the chosen endpoint has overrides, with the next price-change time.
- *(Optional)* Setting `pricingTime: "now" | "workday-average"`. The average mode weights overrides across a typical working window. Sessions can run for hours and cross a boundary.

---

## 8. Scoring

### 8.1 Formula

For each eligible endpoint `e` and tier weight `w`:

```
score(e, w) = w · ln(speed(e))  −  (1 − w) · ln(blended(e))
```

- `speed(e)` = throughput in tokens/sec (P50 from API, or probe result).
- This is equivalent to ranking by `speed^w / cost^(1−w)` but numerically safer.

### 8.2 Optional: "effective throughput" instead of raw TPS (Phase 5)

For agents doing many short turns, latency (TTFT) matters as much as TPS:

```
effectiveTps = expectedOutputTokens / (latencySec + expectedOutputTokens / tps)
```

With `expectedOutputTokens = 400`, a provider with 0.33s TTFT and 221 tps comes out at 400 / (0.33 + 1.81) = 187 effective tps. A provider with 2.57s TTFT and 82 tps comes out at only 400 / (2.57 + 4.88) = 54 effective tps.

Make this a setting: `speedMetric: "tps" | "effective"`, default `"tps"` in Phase 1.

### 8.3 Budget throughput floor

Budget must not pick something unusably slow just because it's cheap. An 8 tps endpoint existed on this model's list.

```
budgetFloor = max(minBudgetTps, 0.5 × median(speed of eligible set))
```

Default `minBudgetTps = 30`. Endpoints below the floor are not eligible **for Budget only**.

### 8.4 Tie-breaking

If two scores are within **1%** of each other (`|Δscore| < ln(1.01) ≈ 0.00995`), break ties in this order:
1. Higher `uptime_last_1d`
2. Lower latency
3. Lower blended cost
4. Alphabetical `tag` (for determinism)

### 8.5 Selecting primary + fallbacks

- Sort eligible endpoints by score, descending.
- Take the top **3**:
  - Primary = #1
  - Fallbacks = #2 and #3
- If only 1–2 are eligible, use what exists and show "Limited fallbacks."
- Settings: `fallbackCount = 2`.

---

## 9. Fast vs. Nitro

Both tiers chase throughput. They differ in **who picks the provider** and **whether the safety rules apply**.

| | **Fast** | **Nitro** |
|---|---|---|
| Who chooses | Chorus ranker (`w = 1.0`) | OpenRouter, per request |
| Uptime ≥ 99.5% rule | ✅ Enforced | ❌ Not enforced |
| Native-precision rule | ✅ Enforced | ❌ Not enforced |
| Routing payload | Explicit `order` + `allow_fallbacks: false` | `model: "<slug>:nitro"`, no `order` |
| Fallbacks | Our top 2 eligible runners-up only | Whatever OpenRouter picks next, including excluded providers |
| Needs a snapshot | Yes | No (only for its "Likely" preview) |
| DeepSeek V4.1 Flash, 2026-10-01 | Baidu Qianfan, 122 tps | Together, 221 tps (quantization not declared) |

### What `:nitro` does

OpenRouter's docs say appending `:nitro` to a model slug is **exactly equivalent** to `provider.sort = "throughput"`. Load balancing is disabled, and providers are tried in order of throughput. It will route to the fastest endpoint even if that endpoint is fp4 or has 97% uptime. OpenRouter does still skip providers that don't support tool calling when the request includes tools, and it deprioritizes providers with outages in the last ~30 seconds.

### When Nitro is the right choice

- The fastest provider is `unknown` quantization but reputable (Together today), and you want its speed now, before running the quality eval in Phase 5.
- Throwaway or exploratory sessions where a rare quality dip or failed call doesn't matter.

### Implementation

- The Nitro selection is built **without** the ranker:
  - `model` = registry slug + `":nitro"`
  - No `order`, no `quantizations`, no `allow_fallbacks`
  - **Exception:** if the data-policy setting is `"deny"`, still send `provider: { data_collection: "deny" }`. Data policy is a privacy rule, not a quality rule, so it applies to every tier. Verify in Phase 0 that `:nitro` and a `provider` object combine as expected.
- **"Likely" preview** (UI only): take the snapshot's endpoints that pass the capability filter (§6.4), ignore uptime and precision, and pick the highest TPS. List which safety rules it fails, if any.
- **Graduation path:** once a provider like Together is added to `verifiedUnknownProviders`, Fast will pick it too. At that point, Fast and Nitro usually agree, and Fast is the better choice because its fallbacks stay filtered.

---

## 10. Routing payload sent to OpenRouter

### 10.1 Shape

```ts
type Tier = "budget" | "balanced" | "fast" | "nitro";

interface OpenRouterProviderPrefs {
  order?: string[];               // provider names, primary first (omitted for Nitro)
  allow_fallbacks?: false;        // never silently route to an excluded provider (omitted for Nitro)
  quantizations?: Quantization[]; // allowed precisions (omitted for Nitro)
  require_parameters?: true;      // only providers supporting every param we send (omitted for Nitro)
  data_collection?: "deny";       // when the data policy setting is "deny" — ALL tiers, incl. Nitro
}

interface RoutingSelection {
  tier: Tier;
  model: string;                  // "deepseek/deepseek-v4.1-flash" or, for Nitro, "deepseek/deepseek-v4.1-flash:nitro"
  provider?: OpenRouterProviderPrefs; // Nitro: undefined, or { data_collection: "deny" }
  filtered: boolean;              // false for Nitro — drives the warning styling/telemetry
  endpoints: string[];            // ranked tags; for Nitro, [likelyTag] (estimate only)
  snapshotId: string | null;      // Nitro may be launched without a snapshot
  computedAt: string;             // ISO
  rationale: string;              // one-liner for the card
}
```

### 10.2 Example (Balanced, DeepSeek V4.1 Flash, 2026-10-01)

```json
{
  "model": "deepseek/deepseek-v4.1-flash",
  "provider": {
    "order": ["AtlasCloud", "DeepInfra", "DeepSeek"],
    "allow_fallbacks": false,
    "quantizations": ["fp8", "unknown"],
    "require_parameters": true
  }
}
```

Building the `quantizations` list: take the set of quantization values of the selected endpoints. Include `"unknown"` **only** if a first-party or verified unknown endpoint is in the `order` list. This prevents OpenRouter from picking a provider's lower-precision sibling endpoint.

### 10.2b Example (Nitro)

```json
{ "model": "deepseek/deepseek-v4.1-flash:nitro" }
```

With the data-policy setting on `"deny"`:

```json
{ "model": "deepseek/deepseek-v4.1-flash:nitro", "provider": { "data_collection": "deny" } }
```

### 10.3 Pinning a single endpoint (used by the speed probe)

```json
{ "provider": { "order": ["CoreWeave"], "allow_fallbacks": false, "quantizations": ["fp8"] } }
```

- Verify which provider actually served the request using the response's provider field (or the generation stats endpoint).
- If it doesn't match the expected provider, discard the sample.

### 10.4 Things to verify in Phase 0

- **Provider naming for `order`.** The endpoints JSON uses `provider_name` values like `"BaseTen"`, `"Io Net"`, `"InferenceNet"`, `"Novita"`. The website shows "Baseten", "io.net", "inference.net", "NovitaAI". Confirm whether `order` expects `provider_name` or the slug prefix of `tag` (e.g. `"baseten"`). Test both against a provider whose display name differs.
- **Multi-endpoint providers.** BaseTen has two identical `fp8` endpoints plus an `fp32` one. `order: ["BaseTen"]` + `quantizations: ["fp32"]` should select Fast. Two identical-precision siblings cannot be distinguished, and that's acceptable.
- **Newer provider fields.** The docs page fetched on 2026-10-01 listed `order`, `allow_fallbacks`, `require_parameters`, `data_collection`, `ignore`, `quantizations`, and `sort`. Check the current docs for newer fields (e.g. `only`, `max_price`, throughput/latency preferences) that could simplify this.
- **Nitro + provider object.** Confirm `"<slug>:nitro"` combined with `provider: { data_collection: "deny" }` keeps throughput sorting and applies the data policy.
- **Harness support.** Confirm the OpenRouter harness Chorus is switching to can pass a `provider` object in the request body. Model-slug-only is enough for Nitro but not for Budget/Balanced/Fast. If it can't, the fallback is a thin local proxy in Chorus's main process that injects `provider` into requests before forwarding to OpenRouter.

---

## 11. Model registry

File: `src/main/routing/model-registry.json` (or wherever Chorus keeps shipped config). Hand-maintained; ~5–6 entries.

```jsonc
{
  "version": 1,
  "models": {
    "deepseek/deepseek-v4.1-flash": {
      "displayName": "DeepSeek V4.1 Flash",
      "hfId": "deepseek-ai/DeepSeek-V4.1-Flash",
      "openWeights": true,
      "nativePrecision": "fp8",
      "nativePrecisionSource": "HF model card tagged fp8; dominant tensor type F8_E4M3 (also BF16/F32/I8 present). Verified 2026-10-01.",
      "firstPartyProviders": ["DeepSeek"],
      "verifiedUnknownProviders": [],          // add after quality eval (Phase 5), e.g. "Together", "Wafer"
      "workloadProfile": "agentic-coding",
      "requiredParameters": ["tools", "tool_choice", "max_tokens"],
      "minContext": 262144,
      "minMaxCompletion": 65536,
      "notes": "CED architecture: only ~8B params active on prefill, so very low input prices are plausible and not by themselves a red flag."
    }
    // add 4–5 more models here
  }
}
```

### How to fill in `nativePrecision` for a new model

1. Find the model's Hugging Face ID. OpenRouter's models API exposes a Hugging Face ID for open-weight models; verify the field name, likely `hugging_face_id`.
2. Open the HF model page, or call `https://huggingface.co/api/models/{hfId}`.
   - The `safetensors.parameters` object lists parameter counts per dtype, e.g. `{"BF16": …, "F8_E4M3": …}`.
3. Native precision = the dtype holding the **most parameters**.
   - Map `F8_E4M3`/`F8_E5M2` → `fp8`, `BF16` → `bf16`, `F16` → `fp16`, `F32` → `fp32`.
4. Record the source and date in `nativePrecisionSource`.
5. **Closed models:** `openWeights: false`, `nativePrecision: null`. The precision filter is skipped.

> *(Optional helper, Phase 5)* A dev-only script `scripts/detect-native-precision.ts <hfId>` that performs steps 2–3 and prints a suggestion. With only 5–6 models, manual curation is fine and more trustworthy.

### Global settings (Chorus settings, with defaults)

```ts
const DEFAULT_ROUTING_SETTINGS = {
  minUptimePct: 99.5,
  uptimeWindow: "1d" as const,
  outageGuard5mPct: 95,
  unknownQuantPolicy: "firstPartyAndVerified" as const,
  requireForcedToolChoice: false,
  dataCollection: "allow" as const,
  assumeCachingWorks: true,
  pricingTime: "now" as const,
  speedMetric: "tps" as const,
  expectedOutputTokens: 400,
  minBudgetTps: 30,
  fallbackCount: 2,
  tierWeights: { budget: 0.30, balanced: 0.50, fast: 1.00 }, // Nitro has no weight — OpenRouter routes it
  snapshotTtlMinutes: 60,
  showNitro: true, // hide the unfiltered Nitro card entirely if you never want it offered
};
```

---

## 12. Architecture inside Chorus

Electron split: **all network I/O and the API key live in the main process**. The renderer (Vue) talks to it over IPC.

```
src/
├── main/
│   └── routing/
│       ├── model-registry.json
│       ├── types.ts               # RawEndpoint, Endpoint, Snapshot, RoutingSelection, settings types
│       ├── openrouterClient.ts    # fetchEndpoints(modelSlug), probeEndpoint(...)
│       ├── normalize.ts           # raw → Endpoint ($/M, overrides, registry merge)
│       ├── filters.ts             # uptime, precision, capabilities → {eligible, excluded}
│       ├── cost.ts                # blended cost, workload profiles, time-of-day
│       ├── ranker.ts              # score, tie-break, select tiers  (PURE)
│       ├── payload.ts             # RoutingSelection → OpenRouter request fragment
│       ├── snapshotStore.ts       # read/write snapshots under app.getPath('userData')/routing/
│       └── ipc.ts                 # ipcMain.handle('routing:*', ...)
├── preload/
│   └── routing.ts                 # contextBridge: window.chorus.routing.{getCached, refresh, select}
└── renderer/
    └── components/newSession/
        ├── ModelPicker.vue
        ├── ProviderTierCards.vue
        └── ProviderTable.vue      # "Show all providers" with exclusion reasons
```

### IPC contract

| Channel | Args | Returns |
|---|---|---|
| `routing:listModels` | none | `{ slug, displayName }[]` from registry |
| `routing:getCached` | `modelSlug` | `TierResult \| null` (from the latest snapshot, recomputed against the current time and settings) |
| `routing:refresh` | `modelSlug` | Streams progress events (`routing:progress`), resolves `TierResult` |
| `routing:select` | `modelSlug, tier` | `RoutingSelection` (persisted into the session config) |

```ts
interface TierResult {
  snapshotId: string;
  fetchedAt: string;
  model: string;
  tiers: Record<"budget" | "balanced" | "fast", RankedTier | null>;
  nitro: {
    model: string;                        // "<slug>:nitro"
    likely: ScoredEndpoint | null;        // highest-TPS capable endpoint, ignoring uptime/precision
    likelyFailsRules: string[];           // e.g. ["quantization not declared"]; empty if it passes
  };
  eligible: ScoredEndpoint[];
  excluded: { tag: string; providerName: string; reasons: string[] }[];
  warnings: string[]; // e.g. "Speed data from live probe (2 samples)", "DeepSeek has peak pricing at 01:00 UTC"
}
```

### Snapshot storage

- Path: `userData/routing/{model-slug-safe}/{ISO-timestamp}.json`. Contains the **raw** API response plus speed measurements, not computed results.
  - Raw storage lets you re-rank old snapshots after tweaking settings, and lets you use them as test fixtures.
- Keep the last 20 per model and prune older ones.
- `getCached` loads the newest snapshot and re-runs the pure ranker, so changes to settings or time-of-day pricing apply without refetching.

### Session launch

- The selected `RoutingSelection` is stored on the session record.
- The OpenRouter harness adapter merges `{ model, provider }` into every request.

**Runtime failover (Budget / Balanced / Fast):** with `allow_fallbacks: false`, if all three endpoints in `order` fail, the request errors out. The harness adapter should then:
1. Surface "All providers for this tier are unavailable."
2. Offer **"Re-rank now"**, which triggers `routing:refresh` and swaps the routing for subsequent requests.
3. Never fall back to an excluded provider automatically. (Switching to Nitro is the user's explicit choice, never automatic.)

**Nitro** sessions rely on OpenRouter's own fallbacks, so this failure path rarely triggers. If it does, show the raw OpenRouter error.

---

## 13. Core code sketches (TypeScript)

These are sketches to guide implementation, not final code.

```ts
// types.ts
export type Quantization = "int4" | "int8" | "fp4" | "fp6" | "fp8" | "fp16" | "bf16" | "fp32" | "unknown";

export const PRECISION_RANK: Record<Exclude<Quantization, "unknown">, number> = {
  fp32: 6, bf16: 5, fp16: 5, fp8: 4, int8: 3, fp6: 2, fp4: 1, int4: 1,
};

export interface Endpoint {
  tag: string;                 // unique key
  providerName: string;        // for provider.order
  quantization: Quantization;
  effectiveQuant: Quantization; // "unknown" upgraded to native for first-party/verified
  uptime1d: number | null;
  uptime5m: number | null;
  contextLength: number;
  maxCompletion: number | null;
  supportedParameters: string[];
  forcedToolChoice: boolean;
  implicitCaching: boolean;
  priceIn: number;             // $/M, time-of-day resolved
  priceOut: number;
  priceCacheRead: number;
  hasPriceOverrides: boolean;
  tps: number | null;
  latencySec: number | null;
  speedSource: "api" | "probe" | "telemetry" | "median-fallback";
}
```

```ts
// filters.ts
export function applyFilters(eps: Endpoint[], model: ModelEntry, s: RoutingSettings) {
  const eligible: Endpoint[] = [];
  const excluded: { tag: string; providerName: string; reasons: string[] }[] = [];

  for (const e of eps) {
    const reasons: string[] = [];

    if (e.uptime1d == null) reasons.push("no uptime data");
    else if (e.uptime1d < s.minUptimePct) reasons.push(`uptime ${e.uptime1d.toFixed(2)}% < ${s.minUptimePct}%`);
    if (e.uptime5m != null && e.uptime5m < s.outageGuard5mPct) reasons.push(`currently degraded (5m uptime ${e.uptime5m.toFixed(1)}%)`);

    if (model.nativePrecision) {
      if (e.effectiveQuant === "unknown") reasons.push("quantization not declared");
      else if (PRECISION_RANK[e.effectiveQuant] < PRECISION_RANK[model.nativePrecision])
        reasons.push(`${e.quantization} below native ${model.nativePrecision}`);
    }

    for (const p of model.requiredParameters)
      if (!e.supportedParameters.includes(p)) reasons.push(`missing parameter: ${p}`);
    if (s.requireForcedToolChoice && !e.forcedToolChoice) reasons.push("no forced tool_choice");
    if (e.contextLength < model.minContext) reasons.push(`context ${e.contextLength} < ${model.minContext}`);
    if (e.maxCompletion != null && e.maxCompletion < model.minMaxCompletion)
      reasons.push(`max output ${e.maxCompletion} < ${model.minMaxCompletion}`);

    (reasons.length ? excluded.push({ tag: e.tag, providerName: e.providerName, reasons }) : eligible.push(e));
  }
  return { eligible, excluded };
}
```

```ts
// ranker.ts  (pure)
const TIE = Math.log(1.01);

export function blendedCost(e: Endpoint, prof: WorkloadProfile, s: RoutingSettings): number {
  const cacheApplies = s.assumeCachingWorks || e.implicitCaching;
  const cachePrice = cacheApplies ? e.priceCacheRead : e.priceIn;
  return prof.freshInput * e.priceIn + prof.cachedInput * cachePrice + prof.output * e.priceOut;
}

export function speedOf(e: Endpoint, s: RoutingSettings, medianTps: number): number {
  const tps = e.tps ?? medianTps;
  if (s.speedMetric === "effective" && e.latencySec != null)
    return s.expectedOutputTokens / (e.latencySec + s.expectedOutputTokens / tps);
  return tps;
}

export function rankTier(eligible: Endpoint[], w: number, opts: RankOpts): ScoredEndpoint[] {
  const scored = eligible
    .filter(e => opts.minTps == null || speedOf(e, opts.s, opts.medianTps) >= opts.minTps)
    .map(e => {
      const cost = blendedCost(e, opts.profile, opts.s);
      const speed = speedOf(e, opts.s, opts.medianTps);
      return { ...e, cost, speed, score: w * Math.log(speed) - (1 - w) * Math.log(cost) };
    });

  return scored.sort((a, b) => {
    if (Math.abs(a.score - b.score) >= TIE) return b.score - a.score;
    return (b.uptime1d! - a.uptime1d!)
        || ((a.latencySec ?? 99) - (b.latencySec ?? 99))
        || (a.cost - b.cost)
        || a.tag.localeCompare(b.tag);
  });
}
// Fast uses w = 1.0, which reduces to "sort by speed". Nitro does not use the ranker.
// Budget passes minTps = max(s.minBudgetTps, 0.5 * medianTps).
```

---

## 14. Worked example: DeepSeek V4.1 Flash, 2026-10-01 ~11:30 ET

**Inputs:**
- Prices, quantization, and uptime from the endpoints API.
- Speed (P50 TPS / latency) from the OpenRouter providers page screenshot, because the API speed fields were null.
- Native precision **fp8**.
- Profile `agentic-coding` (0.20 fresh / 0.70 cached / 0.10 output).
- Unknown policy `firstPartyAndVerified` (verified list empty).
- Time is off-peak for DeepSeek.

### 14.1 Excluded endpoints (20)

| Endpoint | Reason(s) |
|---|---|
| Open Inference | fp4 below native fp8; uptime 97.68% |
| Sail Research | fp4 below native fp8 |
| io.net | uptime 98.10% (5m: 89.6%) |
| CoreWeave | uptime 98.90% |
| Makora | uptime 98.90% |
| BaseTen (fp8) ×2 | uptime 99.35% / 99.25% |
| Parasail | uptime 99.28% |
| inference.net | uptime 99.23%; quantization not declared |
| Ionstream | uptime 98.87%; quantization not declared |
| Together | quantization not declared |
| Wafer | quantization not declared |
| Fireworks, Fireworks (US) | quantization not declared |
| Modal, Relace, DekaLLM, Phala, DigitalOcean, Alibaba | quantization not declared |

### 14.2 Eligible endpoints (12), scored

Blended = 0.20·in + 0.70·cache + 0.10·out ($/M).

| Endpoint | Quant | Uptime 1d | In / Out / Cache | Blended | TPS | Latency | **Budget** (w=.3) | **Balanced** (w=.5) |
|---|---|---|---|---|---|---|---|---|
| DeepInfra | fp8 | 99.95 | 0.14 / 0.42 / 0.0042 | 0.0729 | 68 | 0.87s | **3.099** ① | 3.419 ② |
| Morph | fp8 | 99.50 | 0.0525 / 0.504 / 0.01 | 0.0679 | 57 | 1.35s | 3.096 ② | 3.367 |
| AtlasCloud | fp8 | 99.92 | 0.141 / 0.564 / 0.0141 | 0.0945 | 109 | 1.21s | 3.059 ③ | **3.525** ① |
| DeepSeek (1st-party, off-peak) | unknown→native | 99.98 | 0.15 / 0.60 / 0.003 | 0.0921 | 80 | 0.89s | 2.984 | 3.384 ③ |
| StreamLake | fp8 | 99.52 | 0.147 / 0.588 / 0.0029 | 0.0903 | 74 | 1.45s | 2.975 | 3.355 |
| GMICloud | fp8 | 99.64 | 0.18 / 0.72 / 0.0036 | 0.1105 | 82 | 2.57s | 2.864 | 3.305 |
| NextBit | fp8 | 99.96 | 0.21 / 0.84 / 0.004 | 0.1288 | 95 | 1.69s | 2.801 | 3.301 |
| Baidu Qianfan | fp8 | 99.63 | 0.2997 / 1.199 / 0.006 | 0.1840 | 122 | 0.82s | 2.626 | 3.248 |
| SiliconFlow | fp8 | 99.88 | 0.30 / 1.20 / 0.006 | 0.1842 | 75 | 2.46s | 2.480 | 3.005 |
| Novita | fp8 | 99.95 | 0.30 / 1.20 / 0.006 | 0.1842 | 75 | 2.89s | 2.480 | 3.005 |
| Venice | fp8 | 99.95 | 0.375 / 1.50 / 0.0075 | 0.2303 | 72 | 1.01s | 2.311 | 2.873 |
| BaseTen Fast | fp32 | 99.59 | 0.60 / 2.40 / 0.14 | 0.4580 | 95 | 1.86s | 1.913 | 2.668 |

Median eligible TPS ≈ 78, so the Budget floor is max(30, 39) = 39 tps. All 12 pass.

### 14.3 Results

| Tier | Primary | Fallbacks | Why |
|---|---|---|---|
| **Budget** | **DeepInfra** | Morph, AtlasCloud | Near-tie with Morph (scores within 0.1%); tie-break on uptime (99.95% vs 99.50%). DeepInfra is 7% pricier but 19% faster. |
| **Balanced** | **AtlasCloud** | DeepInfra, DeepSeek | Clear winner (~11% ahead): 109 tps at under 10¢/M blended. |
| **Fast** | **Baidu Qianfan** | AtlasCloud, NextBit | Fastest eligible at 122 tps. NextBit beats BaseTen Fast (both 95 tps) on uptime. |
| **Nitro** ⚠ | **Together** (likely) | OpenRouter decides (Fireworks US 195 tps, CoreWeave 147 tps, …) | 221 tps, but quantization not declared. Its next fallbacks include Fireworks (not declared) and CoreWeave (uptime 98.90%). |

**Sensitivity notes worth surfacing:**

- **At DeepSeek's peak hours,** its blended cost doubles to 0.184. Its Balanced score drops to 3.037, out of the top 3, and StreamLake or Morph take the third slot.
- **Verifying Together** (adding it to `verifiedUnknownProviders`) would make it the Fast pick (matching Nitro, but with filtered fallbacks) and a strong Balanced contender: at a blended 0.184 it scores 3.54 at w=0.5, edging out AtlasCloud.
- **Verifying Wafer** would likely make it the Budget winner. Its current prices are $0.0749 / $0.44 / $0.045.

These make the quality eval in Phase 5 worth doing early.

---

## 15. Testing plan

### Unit tests (pure ranker), the highest value

- **Golden fixture:** save the 2026-10-01 endpoints JSON plus the speed table above as `fixtures/deepseek-v4.1-flash.2026-10-01.json`.
  - With default settings and a fixed "now" (off-peak), assert:
    - Budget = DeepInfra → [Morph, AtlasCloud]
    - Balanced = AtlasCloud → [DeepInfra, DeepSeek]
    - Fast = Baidu → [AtlasCloud, NextBit]
    - Nitro: model = `deepseek/deepseek-v4.1-flash:nitro`, no `order`; likely = Together, `likelyFailsRules = ["quantization not declared"]`
    - Exactly 12 eligible and 20 excluded, with the exact reason strings.
- **Peak-time fixture:** same data, "now" = Tuesday 02:00 UTC. Assert DeepSeek's cost doubles and it drops out of Balanced's top 3.
- **Policy toggles:**
  - `unknownQuantPolicy: "allow"` → Together becomes Fast.
  - `dataCollection: "deny"` → Nitro payload includes `provider.data_collection: "deny"` and nothing else.
  - Nitro selectable with no snapshot (`snapshotId: null`).
  - `"strict"` → DeepSeek first-party excluded.
- **Scoring sanity:**
  - "10% pricier, 2× faster" → B wins Budget.
  - "2× pricier, 2× faster" → A wins Budget.
- **Edge cases:**
  - Zero eligible; one eligible.
  - Missing `input_cache_read`.
  - Missing uptime.
  - `tps` null → median fallback, flagged.
  - Ties broken deterministically.
- **Precision:**
  - fp32 above fp8 passes.
  - int8 below fp8 is excluded.
  - Closed model (`nativePrecision: null`) skips the filter.
- **Time-of-day parser:** windows that wrap midnight (`utc_end: 0`), weekday filtering, and boundary minutes.

### Integration tests (mock HTTP)

- `openrouterClient` against recorded responses.
- Probe logic with a fake streaming server: measure TTFT and TPS, handle timeouts, and discard a sample when the serving provider doesn't match.

### Manual QA

- Fetch → cards render → expand table → select tier → launch.
- Inspect the outgoing request body for the correct `provider` object.
- Kill the network mid-refresh. The cached snapshot should still display with a stale warning.

---

## 16. Implementation phases

### Phase 0: Verification spikes (do first, ~1–2 hrs)

- [ ] Confirm the new OpenRouter harness can send a `provider` object. If not, design the local injecting proxy.
- [ ] Call the endpoints API with an API key, at a few times of day. Do `latency_last_30m` / `throughput_last_30m` populate? What shape are they?
- [ ] Confirm whether `provider.order` takes `provider_name` (e.g. "Io Net") or tag slugs (e.g. "io-net").
- [ ] Confirm the `pricing.overrides` `utc_start`/`utc_end` format is `HHMM` UTC.
- [ ] Confirm single-endpoint pinning works (`order: [X]`, `allow_fallbacks: false`, `quantizations: [q]`), and identify the response field that names the serving provider.
- [ ] Check current OpenRouter provider-routing docs for newer fields (`only`, `max_price`, perf thresholds).
- [ ] Confirm the OpenRouter models API field name for the Hugging Face ID.

### Phase 1: Pure ranker + registry

- [ ] `types.ts`, `model-registry.json` (DeepSeek V4.1 Flash only), default settings
- [ ] `normalize.ts` (incl. time-of-day pricing), `filters.ts`, `cost.ts`, `ranker.ts`, `payload.ts`
- [ ] Golden fixture tests from §15 passing

### Phase 2: Data + speed

- [ ] `openrouterClient.fetchEndpoints`
- [ ] Speed source: API fields if Phase 0 says yes; otherwise the live probe (parallel, 2 samples, timeouts)
- [ ] `snapshotStore` (raw snapshots, pruning, TTL)
- [ ] IPC handlers + preload bridge, including progress events

### Phase 3: UI

- [ ] Model picker in the New Session dialog (visible when agent = OpenRouter)
- [ ] "Fetch latest numbers" button with progress and snapshot age
- [ ] Four tier cards (Budget, Balanced, Fast, Nitro ⚠) + rationale + time-of-day badge
- [ ] Nitro card: warning styling, "Likely" preview with failed-rule list, works without a snapshot
- [ ] Expandable all-providers table with exclusion reasons
- [ ] Empty and limited-fallback states; remember last tier per model

### Phase 4: Wire into sessions

- [ ] Persist `RoutingSelection` on the session
- [ ] Harness adapter injects `{ model, provider }` into every request
- [ ] Runtime failure → "All providers unavailable" + "Re-rank now"

### Phase 5: Refinement

- [ ] **Quality eval for `unknown` providers.** Run 20–50 representative prompts, mostly tool-calling and multi-step, against the first-party endpoint and each candidate (Together, Wafer, Fireworks…). Compare:
  - Tool-call validity
  - Task success
  - JSON validity

  If within ~2–3% of first-party, add to `verifiedUnknownProviders`. Re-run when a provider changes infra.
- [ ] Telemetry: per-endpoint rolling P50 TTFT/TPS and measured cached-token ratio, blended into ranking
- [ ] `speedMetric: "effective"` option
- [ ] Uptime hysteresis
- [ ] Add the remaining 4–5 models to the registry (fill `nativePrecision` per §11)
- [ ] *(Optional)* `detect-native-precision` dev script
- [ ] *(Optional, ties into "Mission Control")* record chosen tier, actual cost, and actual speed per session for later analysis

---

## 17. Open questions / decisions to revisit

1. **Unknown-quant policy default.** This plan uses `firstPartyAndVerified` (cautious). Confirm, or choose `strict` (also excludes DeepSeek's own endpoint) or `allow`.
2. **Workload profile default.** Is 20/70/10 (fresh/cached/output) right for Chorus agents? Calibrate with telemetry, and confirm caching actually happens per provider (§7.2).
3. **Data policy default.** Should OpenRouter sessions default to `data_collection: "deny"`, at least for work-related workspaces?
4. **Pricing time.** "now" vs a workday average for long sessions crossing peak/off-peak boundaries.
5. **Re-ranking during long sessions.** Re-rank automatically every N hours, or only on failure / on user request? (Plan: on failure or on request.)
6. **Latency cap.** None by default. Add `maxLatencySec` (e.g. 3s) as a filter if slow-TTFT providers prove annoying in practice.

---

## 18. References

- OpenRouter endpoints API (DeepSeek V4.1 Flash): https://openrouter.ai/api/v1/models/deepseek/deepseek-v4.1-flash/endpoints
- OpenRouter provider routing docs (provider object, `:nitro`, `:floor`, quantization values): https://openrouter.ai/docs/features/provider-routing
- DeepSeek V4.1 Flash model card (native FP8 weights, architecture): https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash
- OpenRouter model page: https://openrouter.ai/deepseek/deepseek-v4.1-flash
