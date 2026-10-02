# Model Routing — Phase 0 findings

Measured 2026-10-02 against OpenCode 1.18.33 and the live OpenRouter API, for the plan in [Plan_1.md](Plan_1.md). Total spend: about 3.5 cents of OpenRouter credit, most of it the council follow-up cache probe.

**Verdict: go.** OpenCode delivers an OpenRouter `provider` object without a proxy, an explicit `order` pins the endpoint, and the endpoints API returns speed data when called with a key. Three parts of Plan_1 change (see the last section).

## How to re-run

| Script | What it does | Cost |
|---|---|---|
| `node scripts/verify-routing-body.mjs` | Points OpenCode at a loopback stand-in and records the request body it would send, for Team helpers (`opencode run`) and the interactive TUI (node-pty). Each run gets its own `XDG_STATE_HOME`/`XDG_DATA_HOME`. | None |
| `node scripts/verify-routing-live.mjs` | Decrypts the installed app's OpenRouter credential through the production vault (windowless Electron), calls the endpoints API with the key, makes pinned completions, and runs OpenCode end to end through a pass-through proxy that records which provider served each request. | < $0.01 |
| `node scripts/verify-routing-live.mjs --pricing` | One request pinned to DeepSeek first-party plus three zero-cost routing preflights. | None if refused |
| `node scripts/verify-routing-live.mjs --council` | Guardrail and data-policy preflights, `order` fall-through, and a three-call cache probe on each of 15 endpoints. | ≈ $0.025 |

Reports go to `%TEMP%/chorus-routing-body-*` and `%TEMP%/chorus-routing-live-*`. The key is never written to a report.

## Results

| Question | Answer | Evidence |
|---|---|---|
| (a) Does a `provider` object in OpenCode's per-model `options` reach the request body? | **Yes, exactly**, for helpers (`OPENCODE_CONFIG_CONTENT`) and for the interactive TUI. | Body capture: `order`, `allow_fallbacks`, `quantizations`, `require_parameters` and `data_collection` arrived deep-equal in all four cases. |
| (a) Does the interactive TUI merge `OPENCODE_CONFIG_CONTENT` with the `OPENCODE_CONFIG` file Chorus already writes? | **Yes.** Routing came from the env var and the effort came from the file's `agent.build.variant`. | `tui-routed` case. |
| (b) Does routing keep the helper's effort and output cap? | **Yes.** Plain id and `:nitro` both sent `reasoning.effort: "low"` and `max_tokens: 64000`. Interactive sessions send 32000 (unchanged existing behaviour). | `helper-routed`, `helper-nitro-deny`. |
| (b) Does `:nitro` keep its effort? | **Only when the config declares the variants** for the `:nitro` id. Without them the effort is silently dropped. The helper code already declares `low`; interactive launches must declare every effort. | `tui-nitro-variants` sent `low`; the `tui-nitro-bare` control sent no `reasoning`. |
| (c) Do `throughput_last_30m` / `latency_last_30m` populate with a key? | **Yes**, on all 33 endpoints. Each is an object `{p50, p75, p90, p99}`. Throughput is tokens/s; latency is **milliseconds**. They are `null` without a key. | `endpointsWithKey` in the live report. |
| (d) Does `order` + `allow_fallbacks: false` pin the endpoint for a request that carries tools (where Auto Exacto applies)? | **Yes**, 10 of 10. That covers 8 direct pinned calls (DeepInfra ×2, AtlasCloud ×2, Morph, BaseTen fast, BaseTen fp8, a three-endpoint order) and 2 real OpenCode runs (DeepInfra, AtlasCloud). | `calls`, `opencodeRuns`. |
| (d) Which response field names the server? | **Top-level `provider`**, the display name ("DeepInfra"). It cannot tell apart two endpoints of one provider; the billed `usage.cost` matched each endpoint's own price exactly (BaseTen fast $0.000327 vs fp8 $0.0000918), so cost can. The `/generation` lookup returned no data 4 s after the call; it is not needed. | `calls[*].servedBy`, `usage.cost`. |
| (d) Do `order` values take tags or names? | **Both.** `atlas-cloud/fp8`, `baseten/fast` and the display name `DeepInfra` all pinned. A base slug (`baseten`) with `quantizations: ["fp8"]` selected the fp8 endpoint, not the fp32 fast one. | `calls`. |
| (d) Is `:nitro` the same as `sort: "throughput"`? | **No.** `:nitro` went to Together (p50 223 tps); `sort: "throughput"` on the plain id went to AtlasCloud (98 tps). One sample each. | `calls`. |
| (d) Do `:nitro` and `provider: { data_collection: "deny" }` combine? | **Yes**, served by Together. | `calls`. |
| (e) Are `pricing.overrides` `utc_start`/`utc_end` HHMM? | **Yes, per OpenRouter's [models documentation](https://openrouter.ai/docs/guides/overview/models):** HHMM UTC, start inclusive, end exclusive, and a window whose end is not after its start wraps past midnight. A live check against DeepSeek was impossible (next row). | Documentation. |
| (f) Interactive delivery: shared config file or per-process content? | **Per process (`OPENCODE_CONFIG_CONTENT`).** Proven to merge (row 2), so the shared `<userData>\mcp\opencode.json` and the `withMcpEnv` gate stay unchanged. | `tui-routed`. |

## New findings

1. **Account guardrails remove endpoints before routing.** A request pinned to DeepSeek first-party returned 404: *"Filter by Guardrails removed deepseek (Paid model training violation (account settings))"*. The endpoints API still lists that endpoint, even with a key. A tier that pins only guardrailed endpoints would always fail.
2. **A zero-cost preflight reveals them.** `provider: { order: ["<a tag that does not exist>"], allow_fallbacks: false }` returns 404 with no usage. Its `error.metadata.routing_funnel` reports the step `Filter by Guardrails` with a count and reason, and its message names each removed endpoint. `only: [...]` and `max_price: 0` fail earlier in the funnel and reveal nothing. Parsing the message is the only per-endpoint source, so the ranker must treat a parse failure as "unknown", not "allowed".
3. **Endpoint `status` can be non-zero.** Alibaba reported `status: -2` together with 97% uptime. Plan_1 does not use the field.
4. **Overrides have a second condition.** `min_prompt_tokens` applies a long-context price above a prompt-token threshold. Later entries win per key, absent keys inherit the base price, and `input_cache_write` is also a price key. DeepSeek's schedule now tiles the whole week, with the base price as the peak price.
5. **Speed windows are noisy.** Morph's p50 was 57 tps in Plan_1's 2026-10-01 table and 17 today. Both BaseTen fp8 endpoints share one tag but measured 90 and 62 tps. BaseTen fast had p50 31 but p90 260.
6. **Existing bug, outside routing: the TUI's remembered effort overrides Chorus's.** OpenCode stores the last variant picked in the TUI per model in `~/.local/state/opencode/model.json`, and that value beats the `agent.build.variant` Chorus writes (D179). With an isolated state holding `high`, a launch configured for `low` sent `high`. With an empty state it sent `low`. This machine's state holds `"openrouter/deepseek/deepseek-v4.1-flash": "high"`, so Chorus's interactive effort is not applied for that model today. Helpers are unaffected (`--variant` on `run`).

## Changes to Plan_1

- **Speed source:** use the API's p50 (with p90 available) instead of the live probe in Plan_1 §4.3. Keep the probe only as a fallback if the fields go null.
- **Filters gain two exclusions:** endpoints removed by the account's guardrails (from the preflight), and endpoints with a non-zero `status`.
- **Time-of-day pricing:** implement the documented rules, including days-only entries, `min_prompt_tokens` and later-wins-per-key.
- **Confirmed as planned:** Nitro stays the `:nitro` suffix (it is not equivalent to `sort: "throughput"`) and declares its variants; `order` uses endpoint tags; routing travels in `OPENCODE_CONFIG_CONTENT` for interactive sessions and helpers alike.

## Council follow-up measurements (2026-10-02)

These answer points the [council findings](CouncilBrief-MR-1.0-RankerPolicy-Findings.md) left as assumptions. Re-run with `node scripts/verify-routing-live.mjs --council` (≈ $0.025).

| Question | Answer | Evidence |
|---|---|---|
| Do endpoints cache prompts, despite `supports_implicit_caching: false`? | **14 of the 15 probed endpoints do** (the 14 eligible tags plus Together). A ~4,460-token prompt sent three times to each endpoint returned 4,332–4,463 cached tokens on a later call. Baidu returned 0 cached tokens on all three calls, despite listing a cache-read price. BaseTen fp8 and Morph first hit on the third call, which fits more than one backend behind each tag. | `caching` in the `--council` report. |
| What is the real token mix and turn size? | In 2,626 real DeepSeek V4.1 Flash turns (2026-08-07 to 2026-10-02, read-only from the local OpenCode database), **94.9% of prompt tokens were cache reads**. Token shares fresh / cached / output were 0.050 / 0.936 / 0.014. Median output + reasoning per turn: 288 overall, 294 interactive (285 turns), 461 helper worktrees (881 turns). p90: 2,274. Reasoning was 62–69% of output. | Aggregate token counts only; no prompt or file content was read. |
| How much does `data_collection: "deny"` remove? | **Only DeepSeek first-party**, which this account's guardrail already removes. The preflight funnel reports a `Filter by Data Policy` step. | `dataPolicyPreflight`. |
| Does a removed first `order` entry fall through? | **Yes.** `["deepseek", "deepinfra/fp8"]` was served by DeepInfra, and `["<nonexistent>", "atlas-cloud/fp8"]` by AtlasCloud. A real outage of the primary was not tested. | `fallthrough`. |

## Bounds not proven

- The pinning, Nitro and `sort` results are 1–2 samples per case, taken within a few minutes.
- The interactive TUI was tested against the loopback stand-in only. The real-provider end-to-end runs used `opencode run`, which shares the config loader but not the TUI.
- HHMM rests on the documentation, not a live price observation.
- The guardrail preflight depends on an unversioned error-message format.
