# Model Routing — roadmap

**2026-10-02:** Phase 0 (verification spikes) and Phase 0b (council review MR-1.0) are complete. Phase 1, the pure ranker, is complete (`e141094`, `9c6bb9e`, `bd075ba`): see [Phase-1-Overview.md](Tasks/Phase-1-Overview.md) and the Phase 1 section below. Phase 2, data and background observation, is kicked off: see [Phase-2-Overview.md](Tasks/Phase-2-Overview.md). Nothing is wired into the app yet. The Phase 0 findings, both council documents, the 2026-10-02 fixture and the three `scripts/verify-routing-*` files are committed on `feature/model-routing` as `40b37bb`.

Created 2026-10-02. This roadmap records what is being built and why. How each piece is built belongs in the phase Task and ImplementationSpec documents.

## Purpose

When a user launches an OpenCode agent on an OpenRouter API-key credential, they pick one of four routing tiers: **Budget**, **Balanced**, **Fast** or **Nitro**. This applies to interactive sessions (launch dialog) and to Team Session helpers (per slot). Chorus ranks OpenRouter's endpoints for the model locally, from endpoint snapshots, and pins the chosen endpoints with an OpenRouter `provider` object delivered through OpenCode's own config. No proxy sits between OpenCode and OpenRouter.

The first model is DeepSeek V4.1 Flash. The registry and ranker are designed for 5–6 hand-curated models.

**Product-owner safety rules (binding):**

| Rule | Applies to |
|---|---|
| Exclude endpoints with uptime below 99.5% | Budget, Balanced, Fast |
| Exclude endpoints quantized below the model's native precision | Budget, Balanced, Fast |
| Nitro is the one labelled exception to both rules | Nitro |

## Source of truth

| Document | Role |
|---|---|
| This roadmap | Authoritative for decisions (`MR-D`), gates (`MR-G`) and phase status. Where it differs from Plan_1, this roadmap wins. |
| [Plan_1.md](Plan_1.md) | Original design (2026-10-01). Still the reference for UI sketches and the registry shape; superseded where listed below. |
| [Phase-0-Findings.md](Phase-0-Findings.md) | Measured evidence from 2026-10-02 and how to re-run it. |
| [CouncilBrief-MR-1.0-RankerPolicy.md](CouncilBrief-MR-1.0-RankerPolicy.md) | The policy put to the council, with the 2026-10-02 endpoint exhibit. |
| [CouncilBrief-MR-1.0-RankerPolicy-Findings.md](CouncilBrief-MR-1.0-RankerPolicy-Findings.md) | Council deliberation (partial run). Its disposition is recorded here as MR-D5 to MR-D11. |
| [Foundation roadmap](../Foundation/roadmap.md) | Global phase placement and the global `D`/`F` numbers. It does not yet place this feature. |
| [Master plan](../../Plan.md) | Architecture rules this feature must keep. |

`MR-D` and `MR-G` numbers are local to this feature and never collide with the Foundation roadmap's global `D`/`F` numbers. References such as D179 below are global.

**Plan_1 items superseded:**

| Plan_1 | Now | Decision |
|---|---|---|
| §4.3 live speed probe | API `throughput_last_30m` / `latency_last_30m`; probe only as a fallback | MR-D14 |
| §8.1 score on raw tps | Effective throughput with measured turn size `N` | MR-D6 |
| §7 20/70/10 agentic profile, `assumeCachingWorks: true` | Measured per-profile token shares; cache credit only with local verification | MR-D9 |
| §6.5 `dataCollection: "allow"` | `"deny"` by default | MR-D11 |
| §12 "keep the last 20 snapshots" | 30-minute background observations, 7-day retention | MR-D10 |
| §12 "Re-rank now" swaps routing mid-session | Re-rank takes effect by relaunching the session | MR-D10 |
| §6 filters | Add guardrail removal, non-zero `status`, hysteresis | MR-D8, MR-D12 |

## Verified ground facts

Verified 2026-10-02 at `d9bab55` on branch `feature/model-routing`, with OpenCode 1.18.33 installed. Line numbers drift; `/phase-kickoff` re-verifies them before each phase.

| Location | Fact |
|---|---|
| `src/main/adapters/opencode.ts:229` | `buildLaunch` returns `envAdditions: {}` (:260). It emits `-m openrouter/<slug>` only via `qualifyModel` (:391) / `opencodeProviderFor` (:401). Interactive effort travels in the config file's `agent.build.{model,variant}` (D179), not argv. |
| `src/main/adapters/env.ts:131` | `composeChildEnv` applies `envAdditions` on both the no-credential path (:162) and the credential allow-list path (:177), so an `OPENCODE_CONFIG_CONTENT` set by `buildLaunch` reaches the interactive PTY. |
| `src/main/index.ts:1039` | `agentConfigDir = <userData>/mcp`. OpenCode's `OPENCODE_CONFIG` file there is one file shared by every OpenCode session. |
| `src/main/adapters/helpers/opencode.ts:19` | `modelOptions` is the per-model options object; it declares `variants.low` only for the `:nitro` default. `measuredCodeHelper` at :21. `OPENCODE_CONFIG_CONTENT` (:39) carries `provider.openrouter.models[modelId] = modelOptions`. |
| `src/main/adapters/helpers/common.ts:23` | `composeHelperEnv`'s allow-list already includes `OPENCODE_CONFIG_CONTENT`. |
| `src/shared/teamProfiles.ts:4` | `defaultTeamHelperModel` is `deepseek/deepseek-v4.1-flash:nitro`: Nitro is already the helper default. `teamModelSchema` at :16. |
| `src/shared/team.ts:23` | `memberFields` (:23), `teamMemberSchema = z.strictObject(...)` (:30) and `teamRunConfigSchema` (:34) are strict, so a routing field must be `.optional()`. |
| `src/main/services/teamStorage.ts:54` | Stored config JSON is compared exactly (`configJson === JSON.stringify(run.config)`); an omitted optional field keeps old runs readable. |
| `src/main/adapters/helpers/types.ts:21` | `HelperExecutionInput`. `src/main/services/teamService.ts:416` calls `adapter.buildExecution(...)` during attempt preparation. |
| `src/renderer/src/components/TeamLaunchDialog.vue:27` | `config()` (:27) and `usePreset()` (:44). |
| `src/shared/ipc.ts:1296` | `launchRequestSchema` (`model_effort` :1332, `model` :1374); `agentKindSchema` at :1036. |
| `src/main/ipc.ts:938` | `withMcpEnv` (:938); SessionLaunch handler (:1747); `chosenModel = req.model ?? profileModel` (:1949, credentialed branch only); SessionRestart (:2271); SessionRelaunch (:3302) uses the provider's model, not the profile's. |
| `src/renderer/src/components/LaunchDialog.vue:283` | `modelEffortLevels` looks up the exact id in the catalog (:288), so a `:nitro` id finds no efforts. |
| `src/main/services/storage.ts:180` | `MIGRATIONS`; the last entry is v27 (`team_member_profiles`, :1073). Next free is v28. |
| `src/main/services/modelCatalog.ts:161` | `refreshProviderModels`, with an 8 MB cap (:81) and a 10 s timeout (:83). Nothing in `src/` calls OpenRouter's `/endpoints` API yet. |

## Decisions

All dated 2026-10-02. Council items cite the question in the [findings](CouncilBrief-MR-1.0-RankerPolicy-Findings.md) and state whether the ruling was Adopted, Modified or Rejected.

**MR-D1 — No Ori; OpenCode stays the harness.** Resolved (user, after research). *Why:* Ori launches the real CLIs and documents no way to pass a `provider` object. OpenCode forwards it natively (Phase 0).

**MR-D2 — Branching.** Resolved (user). The Team Sessions work is committed first as `d9bab55` on `main` (not pushed). Model Routing proceeds on `feature/model-routing`.

**MR-D3 — Routing travels per process in `OPENCODE_CONFIG_CONTENT`.** Resolved. Applies to interactive sessions and helpers alike. The shared `<userData>/mcp/opencode.json` and the `withMcpEnv` gate are unchanged. *Why:* Phase 0 proved the TUI merges the env content with the `OPENCODE_CONFIG` file. Writing routing into the one shared file would let concurrent sessions overwrite each other and leave stale routing behind (the D179 "rewrite every launch" trap).

**MR-D4 — Nitro is the `<slug>:nitro` suffix, not `provider.sort: "throughput"`.** Resolved. Every launch that sends `:nitro` declares that id's effort variants in config, because OpenCode otherwise drops the effort silently. The launch dialog strips `:nitro` before looking up efforts. *Why:* the two routed differently when measured (Together vs AtlasCloud). This supersedes the 2026-10-01 handoff's proposal to use `sort: "throughput"`; its premise, that `:nitro` fails the helper gate, was wrong.

**MR-D5 — Rank locally and pin routable tags.** Resolved; council Q1, **Adopted** with its revision. Budget, Balanced and Fast send the top three candidates as `order` with `allow_fallbacks: false`, `require_parameters: true` and a `quantizations` list; never a live `sort` or `preferred_*`. `order` holds endpoint tags only, never display names, because a display name selects every endpoint of that provider. Rows that share a tag (two `baseten/fp8` rows measured 90 and 62 tps) collapse into one candidate with conservative values: minimum uptime, exclusion if any row has a non-zero status, lowest p50 tps, highest p50 latency, highest cost, and the union of capability failures. The UI never claims a specific row. *Why:* only local ranking can enforce Chorus's own filters, and a candidate must be something `order` can actually select.

**MR-D6 — Score on effective throughput.** Resolved; council Q2, **Adopted**, with `N` set from measurement. `score = w·ln(tps_eff) − (1−w)·ln(blended cost)`, `w` = 0.30 / 0.50 / 1.00. `tps_eff = N / (L_p50 + N / tps_p50)`, with latency converted from the API's milliseconds to seconds. Provisional `N` is the median output plus reasoning tokens per DeepSeek V4.1 Flash turn in the local OpenCode history: interactive 300 (285 project turns), helper 460 (881 worktree turns). Reasoning is about 62–69% of those tokens, so `N` already includes it. Budget keeps a raw-p50 floor of `max(30, 0.5 × median eligible p50)`. p90 is stored and displayed, never scored. *Why:* agent turns are short, so time to first token matters as much as sustained speed. `N` is a calibration assumption and will be re-measured.

**MR-D7 — Undeclared quantization stays excluded.** Resolved; council Q3, **Adopted**. Excluded unless first-party or verified; no score penalty as a substitute. A verification record names the model, routable tag, reference endpoint, task-suite version, score, date, expiry and reviewer, and applies only to that tag. *Why:* `unknown` cannot be shown to meet the native-precision rule, and a penalty would let a fast unknown endpoint outscore the rule.

**MR-D8 — Reliability gates with hysteresis from the start.** Resolved; council Q4, **Adopted**. Hard gates: 1-day uptime ≥ 99.5%, 5-minute uptime ≥ 95%, `status === 0`, uptime present, not removed by the account's guardrails. An endpoint whose 1-day uptime fell below 99.5% in any retained observation inside the smoothing window is readmitted only at ≥ 99.6%. 5-minute, status and guardrail failures exclude immediately. *Why:* several endpoints sit within 0.1% of the floor and would flip between snapshots.

**MR-D9 — No unearned cache credit, priced from measured token mix.** Resolved; council Q5, **Modified**. Measured: in 2,626 real DeepSeek V4.1 Flash turns (2026-08-07 to 2026-10-02), 94.9% of prompt tokens were cache reads. Fresh / cached / output shares: 0.050 / 0.936 / 0.014 overall, 0.057 / 0.932 / 0.011 interactive, 0.038 / 0.957 / 0.005 helper. A cache probe (one ~4.4k-token prefix sent three times pinned to each endpoint) hit on 13 of the 14 eligible tags and on Together; Baidu never cached despite listing a cache-read price. The API's `supports_implicit_caching` is false for all but one endpoint and is evidence neither way. **Rule:** an endpoint gets the cached share at its cache-read price only with a local cache verification; otherwise the cached share is priced as fresh input. Reasoning tokens count as output and are already inside the measured output share. **Rejected:** the council's 0.90 input / 0.10 output fallback, because measured output is about 1.4%, not 10%. **Probe policy (user):** automatic during a fetch for endpoints with no result or a result older than 14 days, capped at about 5 cents per fetch, cost shown in the UI. Probing every eligible endpoint costs about 2.5 cents.

**MR-D10 — Background observation, smoothing and re-ranking.** Resolved; council Q6, **Adopted** with a harness correction; collection by user decision. While Chorus runs it records an observation every 30 minutes for registry models only: one call to the free endpoints API with the user's key, endpoint metadata only (no prompts or code), stored under `userData/routing`, 7-day retention, and a setting turns it off. Score inputs are the median of the ≤ 6 most recent p50 throughput and p50 latency observations; fewer than 3 shows a "limited history" label, and every hard gate still applies. A launch needs a snapshot ≤ 60 minutes old. A selection persists for the session; there is no timer re-ranking. *Correction to the council:* OpenCode reads its config at process start, so an interactive re-rank only takes effect by relaunching ("Re-rank and relaunch"); helpers re-rank between attempts. Re-rank triggers: user action, every ordered endpoint failing, or the active primary newly failing a hard gate or guardrail. Chorus notifies and never switches silently. *Why:* 30-minute windows are noisy (Morph 57 → 17 tps in a day), and switching mid-session moves the agent to a cold cache.

**MR-D11 — `data_collection: "deny"` by default; Nitro labelled.** Resolved; council Q7, **Adopted**. Deny is the default for all four tiers; "allow" only by an explicit user setting. Measured cost for DeepSeek V4.1 Flash: deny removes only first-party DeepSeek, which this account's guardrail already removes. Nitro is labelled "Nitro — unfiltered provider routing" with a data-driven warning: the likely endpoint from the snapshot and the rules it fails, possible priority-tier charges, that actual routing may differ, and that account guardrails still apply.

**MR-D12 — Discover account guardrails before ranking.** Resolved. A free preflight (`order: ["<nonexistent tag>"]`, `allow_fallbacks: false`) returns 404 with no usage, and its message names each endpoint removed by "Filter by Guardrails" or "Filter by Data Policy". A parse failure means "unknown", never "allowed". Revalidate after access failures. *Why:* the endpoints API lists guardrailed endpoints, and a tier that pinned only those would always fail.

**MR-D13 — Time-of-day pricing follows OpenRouter's documented override rules.** Resolved. HHMM UTC, start inclusive, end exclusive, windows wrap past midnight, `utc_days`, `min_prompt_tokens` (strictly greater), later entries win per key, absent keys inherit; evaluated at launch.

**MR-D14 — Speed comes from the endpoints API.** Resolved. Use the `throughput_last_30m` / `latency_last_30m` percentile objects, which populate only with an API key. Plan_1's live speed probe is dropped, except as a fallback if the fields go null.

**MR-D15 — Team helper routing is per slot.** Resolved (user). A tier dropdown sits beside each slot in TeamLaunchDialog. The default preserves today's behaviour: a slot on the `:nitro` model shows Nitro, any other slot shows "OpenRouter default". The resolved selection is snapshotted onto that member's config as an optional field.

**MR-D16 — OpenCode's remembered TUI variant overrides Chorus's effort.** **Open**; outside routing scope; user to decide. OpenCode stores a per-model variant in `~/.local/state/opencode/model.json`, and it beats the `agent.build.variant` Chorus writes (D179). This machine stores `"high"` for deepseek-v4.1-flash, so Chorus's interactive `"low"` is not applied. Helpers are unaffected.

**MR-D17 — Behaviour when the primary endpoint has a real outage.** **Open**. Untested. A filtered first `order` entry was verified to fall through to the next; a genuine outage of a pinned primary was not.

**MR-D18 — Routing's key-bearing calls are admitted, on stated constraints.** Resolved (user, Phase 2 kickoff). It will be mirrored as a global decision in the [Foundation roadmap](../Foundation/roadmap.md) when Phase 2 lands. The number reserved for it there is D214, which is contingent: a sweep shows only that the number was free today. *Why:* D58 requires every key-bearing call beyond the Test-key action to be "numbered, constrained, and narrated — never slipped in". D60 bars any path without a user gesture from resolving an inference credential. The background observer is that kind of path.

Two classes of call are admitted:

1. **User-initiated refresh.** One IPC call is one user action, made for a chosen model and credential. It may make:
   - a keyed `GET /models/{slug}/endpoints`;
   - two zero-cost preflights (MR-D12), one plain and one with `data_collection: "deny"`, because under deny the guardrail step never appears;
   - the automatic cache probe (MR-D9), capped at 5 cents per refresh.
2. **The unattended observer (MR-D10).** It makes only the free `GET /endpoints` call, every 30 minutes, with the designated credential (MR-D19). It never preflights and never probes.

Constraints, stated per credential class as D60 requires:

- **Decryption:** the key is decrypted when it is used and then dropped. There is no module-level copy and no memo, and each refresh or observer tick decrypts once.
- **Refusals before decrypting:** an unknown profile, a profile marked `unavailable_since` (refused by its label, with no decrypt attempt), a provider whose auth mode is not `api_key` (a management key is refused outright), and a provider or envelope base URL other than OpenRouter's.
- **Where the key may appear:** only in the `Authorization` header. Never in a URL, a log, a stored file, an IPC payload, a report or a child process.
- **Responses:**
  - A 2xx body is read under a size cap and never echoed into an error.
  - Every other status is cancelled unread, except the preflight's expected 404. That body is read under a cap and parsed, and only the parsed tags leave the function.
  - Every outbound message goes through `scrubSecrets`.
  - No call is retried or backed off.

**MR-D19 — The observer's consent is a designated credential.** Resolved (user, Phase 2 kickoff). A persisted setting `{ enabled, credentialProfileId }` defaults to enabled with no credential. The observer stays dormant until the user designates an OpenRouter API credential; designating it is the consent. Phase 2 adds the IPC and Phase 3 the UI. Designation runs the same pre-decrypt checks as a refresh. A refresh uses the credential its caller names, which is the launch's own credential, not the designated one. *Why:* this honours MR-D10's default-on observation without a key-bearing timer starting silently on upgrade.

**MR-D20 — Routing data lives in JSON files under `userData/routing/`, with no migration.** Resolved (user, Phase 2 kickoff). Each registry model gets:

- its latest snapshot;
- its observation history, kept for 7 days;
- its cache verifications;
- its account eligibility, stored per credential profile because guardrails belong to an account.

Files are written atomically, and one that is missing or corrupt reads as empty. Routing settings and the observation setting are JSON values in the existing `settings` table. *Why:* migration v28 stays reserved for Phase 4's routing selection (MR-G6).

**Phase 2 live verification spend is authorized up to 3 cents** (user, Phase 2 kickoff; MR-G7). The check runs in a throwaway profile with a copied credential and reports what it actually spent.

## Gates

| Gate | Rule | Why |
|---|---|---|
| MR-G1 | Every phase ends with node and web typecheck, vitest, and a real check (scripts, or the running app via CDP; worktrees drive CDP on 9333). | Run, don't just compile. |
| MR-G2 | Re-run `node scripts/verify-routing-body.mjs` after any change to how OpenCode config is generated; it must pass. | It is the only proof that the `provider` object reaches the request body. |
| MR-G3 | Any script that launches OpenCode gets its own `XDG_STATE_HOME` and `XDG_DATA_HOME`. | A 2026-10-02 spike polluted, and was skewed by, the user's real TUI state. |
| MR-G4 | Keys stay in main: never logged, never in reports, argv or plain files; `npm run grep:secrets` is clean. | Repository secret rules. |
| MR-G5 | Zod validation in main only; renderer-to-main payloads are plain objects (JSON snapshot of reactive state), runtime-verified. | Zod in preload breaks under CSP; Vue proxies fail structured clone. |
| MR-G6 | Migration v28 is verified against a throwaway `--user-data-dir`. | Dev worktrees share one DB; a version claimed on another branch silently no-ops. |
| MR-G7 | Live probes state their cost before running and report actual spend. | Probes spend the user's OpenRouter credit. |
| MR-G8 | The ranker is pure: the same observation history, registry, settings and time give the same result. Golden fixtures come from the 2026-10-02 data. | Tier choices must be explainable and regression-tested. |

## Phases

| Phase | Deliverable | Status |
|---|---|---|
| 0 | Verification spikes | Complete 2026-10-02 |
| 0b | Council review MR-1.0 | Complete 2026-10-02 (partial run) |
| 1 | Pure ranker | Complete 2026-10-02 (`e141094`, `9c6bb9e`, `bd075ba`); [overview](Tasks/Phase-1-Overview.md) |
| 2 | Data and background observation | **Kicked off 2026-10-02**; [overview](Tasks/Phase-2-Overview.md), Tasks 2-1 to 2-4 not started |
| 3 | UI | Provisional |
| 4 | Wiring into sessions and Team runs | Provisional |
| 5 | Refinement | Provisional |

### Phase 0 — Verification spikes (complete 2026-10-02)

Evidence: [Phase-0-Findings.md](Phase-0-Findings.md). Scripts: `scripts/verify-routing-body.mjs` (no cost) and `scripts/verify-routing-live.mjs` with `scripts/verify-routing-live.ts` (modes `--pricing` and `--council`). Total spend about $0.035. Golden-fixture input: [src/main/routing/__fixtures__/endpoints-deepseek-v4.1-flash-2026-10-02.json](../../../src/main/routing/__fixtures__/endpoints-deepseek-v4.1-flash-2026-10-02.json) (endpoint rows with keyed speeds, plus the guardrail, data-policy and cache-probe results). Reports go to `%TEMP%` and are not committed; the repository is public. The artifacts are committed as `40b37bb`.

### Phase 0b — Council review MR-1.0 (complete 2026-10-02)

**Partial run:** 2 of 4 members answered (DeepSeek v4 Pro, Grok 4.6), plus the arbiter (GPT 5.6 Terra). GLM 5.3 and Qwen 3.8 Max returned empty answers. The findings are model deliberation. Before adopting them, the disposition (MR-D5 to MR-D11) measured what could be measured: caching, the cost of deny, fall-through and the real token mix.

### Phase 1 — Pure ranker (complete 2026-10-02)

Kicked off 2026-10-02: [Phase-1-Overview.md](Tasks/Phase-1-Overview.md) (kickoff decisions K1–K12, clarifications C1–C10, golden expectations), [Task 1-1](Tasks/Task-1-1.md) contracts, registry, endpoints and pricing → [Task 1-2](Tasks/Task-1-2.md) eligibility, smoothing and ranking → [Task 1-3](Tasks/Task-1-3.md) payloads, `computeTiers` and the golden run, each with its [implementation specification](ImplementationSpecs/). Complete.

**Outcome (2026-10-02).** Tasks 1-1 to 1-3 landed as `e141094`, `9c6bb9e` and `bd075ba`.

- **MR-G1:** the node and web typechecks pass, `npm test` passes 127 files and 3,782 tests, and `node scripts/verify-routing-ranker.mjs` prints `PASS (30 checks)` on the fixture and exits 0.
- **MR-G4:** `npm run grep:secrets` is clean.
- **MR-G5 / K2:** every `TierResult` round-trips through JSON unchanged.
- **MR-G8:** the purity grep is empty, and shuffled endpoints and history give strictly equal results.

Both profiles reproduce the golden expectations exactly, and every exclusion and tier choice traces to a recorded rule.

**Decisions made during execution:**

- **C11 (coordinator, 2026-10-02; approved by the user 2026-10-02):** a tag whose rows declare different quantizations is excluded when any declared row is below native precision. This applies even to the first party or a verified tag, and the reason reads `${q} below native ${native}`. The binding precision rule therefore cannot be bypassed, and a payload never lists a below-native quantization. No golden value changed, because the fixture has no mixed tag.
- **Time validation:** `computeTiers` also rejects a `now` or `fetchedAt` that is not a UTC ISO instant (`z.iso.datetime()`), because `Date.parse` reads an offset-less string as local time. The Task 1-1 time functions throw `RangeError` on an unparseable `now`.
- **Nitro's failed rules:** `nitroFailsRules` keeps ImplementationSpec-1-2's narrower rule. It lists only reliability and precision reasons, the two safety rules Nitro is exempt from.
- **Additive Task 1-1 exports:** `minOrNull`, `maxOrNull`, `collapseStatus` and `byCodeUnit`, from `endpointsCore.ts`.

**Carried to Phases 2–3:**

- `computeTiers` trusts `settings` and `profile`. Phase 2 must validate them with `routingSettingsSchema` and `routingProfileIdSchema` before calling it, and must catch its `RangeError`.
- W3 (data policy not checked) has no structured field in `TierResult`. Add one the next time the contract changes, rather than matching on the warning text.
- When the Budget floor alone empties or shortens Budget, W4 and W5 read "no eligible endpoints" or "only n eligible endpoints". Phase 3 should explain this from `budgetFloorExcluded` and `budgetFloorTps`.
- A Nitro likely endpoint that fails only the speed or price gates shows an empty `likelyFailsRules`.
- Phase 3 should format from the numeric fields, not reuse these strings:
  - The rationale uses `toPrecision(3)`, which switches to exponent notation at extreme prices.
  - W1 rounds the snapshot age down, so it reads `60 minutes old (limit 60)` at 60 minutes plus 1 ms.
- An override window starting at `utc_start: 2400` never applies. This follows spec rule 4 literally, and the case has not been seen in data.

**Goal:** a pure function from observation history + model registry + settings + time to the four tier results and their explanations, tested against golden fixtures.

**Scope:**

- **Model registry and default settings.** DeepSeek V4.1 Flash: native fp8, first party DeepSeek, an empty verified-unknown list, and the verification record schema (MR-D7).
- **Normalisation.** Endpoint rows become routable candidates, collapsing shared tags conservatively (MR-D5).
- **Override pricing** per MR-D13.
- **Filters:** reliability gates and hysteresis (MR-D8), the guardrail set (MR-D12), quantization policy (MR-D7), and capabilities: required parameters, plus reasoning when an effort is set; minimum output 65,536 interactive / 64,000 helper; context 262,144.
- **Smoothing** over observation history, with the limited-history label (MR-D10).
- **Cost** with per-endpoint cache verification and per-profile token shares (MR-D9).
- **Scoring:** effective throughput, the Budget floor, tie-breaks (within 1%: higher uptime, lower latency, lower cost, then tag, per the brief), and top-three selection (MR-D6).
- **Payload builder** for all four tiers, including Nitro and deny (MR-D4, MR-D11).
- **Explanation record:** score inputs and every exclusion with its reason, for the UI to show later.

**Placement:** pure TypeScript under `src/main/routing/`, following the repo's `*Core.ts` convention. Vitest golden fixtures come from [the saved 2026-10-02 snapshot](../../../src/main/routing/__fixtures__/endpoints-deepseek-v4.1-flash-2026-10-02.json) and contain endpoint metadata only.

**Not in Phase 1:** network calls, IPC, UI, storage, migrations or launch wiring.

**Exit:** MR-G1, MR-G4 and MR-G8 pass. On the 2026-10-02 fixture, every exclusion and tier choice is explained by a recorded rule.

### Phase 2 — Data and background observation (next)

Kicked off 2026-10-02: [Phase-2-Overview.md](Tasks/Phase-2-Overview.md) (user decisions MR-D18–MR-D20, kickoff decisions K1–K10, clarifications C1–C24). The tasks run in this order:

1. [Task 2-1](Tasks/Task-2-1.md): OpenRouter transport and parsers.
2. [Task 2-2](Tasks/Task-2-2.md): the routing store and settings.
3. [Task 2-3](Tasks/Task-2-3.md): `RoutingService`, the observer and the live check.
4. [Task 2-4](Tasks/Task-2-4.md): IPC, preload and app wiring.

Each has its [implementation specification](ImplementationSpecs/). Not started.

**Goal:** feed the Phase 1 ranker with real data, in main, without a renderer. A user-initiated refresh does five things:

1. fetches the keyed endpoint list;
2. learns the account's guardrail and data-policy removals from two zero-cost preflights;
3. verifies prompt caching with a probe capped at 5 cents;
4. stores the results under `userData/routing/`;
5. returns a `TierResult`.

Once a credential is designated, a background observer records the free endpoint list every 30 minutes. A `routing:*` IPC surface exposes all of this, validated in main, and its progress events state the probe's estimated cost before any money is spent.

**Corrections the kickoff made against the evidence:**

- The preflight funnel counts endpoint *rows*, not tags, so the parse is checked row-weighted (C1).
- The Phase 0 probe prompt is about 4,460 tokens, not the "~3,000" its script comment claims (C4).

**Not in Phase 2:** renderer components, settings screens, launch or OpenCode wiring, migrations.

**Exit:** MR-G1, MR-G4, MR-G5, MR-G7 and MR-G8 pass, through two real checks:

- **A live refresh** on a copied credential. Both preflights must parse, the probe must cover at most 2 endpoints, and total spend must stay within 3 cents, with the estimate reported before probing and the actual spend after.
- **A zero-cost CDP drive** of the built app. It must exercise every channel with plain-object payloads and make no OpenRouter request.

When Phase 2 lands, mirror MR-D18 into the Foundation roadmap as the global decision D214. Re-check that the number is still free when merging; renumber at the merge, never before it.

### Phase 3 — UI (PROVISIONAL)

*Not authoritative; revise at kickoff.* Launch-dialog tier cards when the agent is OpenCode with an OpenRouter API-key credential. The Nitro card and its warning. An all-providers table with exclusion reasons. Limited-history labels. Settings for background observation and the data-collection opt-in. The per-slot tier dropdown in TeamLaunchDialog (MR-D15).

### Phase 4 — Wiring (PROVISIONAL)

*Not authoritative; revise at kickoff.* Interactive `OPENCODE_CONFIG_CONTENT` carrying the `provider` object and declared variants for `:nitro` (MR-D3, MR-D4). Migration v28 for the routing selection on sessions and launch profiles (MR-G6). Relaunch re-applies the persisted selection. Team member routing (optional field) flows through `HelperExecutionInput` to the per-model options. "Re-rank and relaunch", and helper re-rank between attempts (MR-D10). Guardrail revalidation on access errors (MR-D12). MR-G2 applies to every change here.

### Phase 5 — Refinement (PROVISIONAL)

*Not authoritative; revise at kickoff.* A quality evaluation to verify undeclared-quantization providers (MR-D7). Local per-endpoint cache-hit and token-mix telemetry, never transmitted. Longer uptime windows. An evaluation of scoring on tail latency (p90). Prefix-processing latency. Provider and region diversity. The remaining registry models.

## Out of scope

- Ori (MR-D1).
- Changing the OpenCode version or its adapter.
- OpenCode subscription launches; they have no OpenRouter route.
- A local request-rewriting proxy.
- Any shared or remote telemetry.
- Providers other than OpenRouter.

## Open items

- MR-D16 (remembered TUI variant) and MR-D17 (real primary outage), above.
- The meaning of non-zero `status` values. Only `-2` has been seen (Alibaba, alongside 97% uptime); MR-D8 excludes any non-zero value.
- Whether six observations beat three or an EWMA for smoothing (council Q6 dissent).
- The council ran with two of four members, so its votes carry less weight than their count suggests.
- The Foundation roadmap does not yet place this feature. An optional pointer can be added there.
