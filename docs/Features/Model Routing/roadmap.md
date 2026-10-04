# Model Routing — roadmap

**2026-10-02:** Phase 0 (verification spikes) and Phase 0b (council review MR-1.0) are complete. Phase 1, the pure ranker, is complete (`e141094`, `9c6bb9e`, `bd075ba`): see [Phase-1-Overview.md](Tasks/Phase-1-Overview.md) and the Phase 1 section below. Phase 2, data and background observation, is complete (`17c7d72`, `353cd39`, `a2f7226`, `21c65ff`): see [Phase-2-Overview.md](Tasks/Phase-2-Overview.md) and the Phase 2 section below. Phase 3, the routing inspector in Settings, is complete (`176a83b`, `f307b4d`, `bfa7eaf`, `4167fba`): see [Phase-3-Overview.md](Tasks/Phase-3-Overview.md) and the Phase 3 section below. Routing runs in main, is reachable over `routing:*` IPC and has a Settings → Model routing screen; no launch uses it yet. **2026-10-03:** Phase 4 is split (MR-D29). Phase 4a, interactive launches, is kicked off: see [Phase-4a-Overview.md](Tasks/Phase-4a-Overview.md). Phase 4b, Teams and re-ranking, is provisional. The Phase 0 findings, both council documents, the 2026-10-02 fixture and the three `scripts/verify-routing-*` files are committed on `feature/model-routing` as `40b37bb`. **2026-10-04:** Phase 4a, interactive launches, is complete (`12984b2`, `b6a1eff`, `349d373`, `50c29d8`, `279953f`, `eb8ee80`): see [Phase-4a-Overview.md](Tasks/Phase-4a-Overview.md) and the Phase 4a section below. The launch dialog now offers Budget, Balanced, Fast, Nitro or OpenRouter default for OpenCode on an OpenRouter API key; main resolves the tier, the session carries it per process, `sessions.routing_json` (v28) stores it and Relaunch re-applies it. Team routing and re-ranking remain Phase 4b.

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

**MR-D16 — OpenCode's remembered TUI variant overrides Chorus's effort.** **Resolved by MR-D25** (user, Phase 4a kickoff, 2026-10-03); it was open and outside routing scope until then. OpenCode stores a per-model variant in `~/.local/state/opencode/model.json`, and it beats the `agent.build.variant` Chorus writes (D179). This machine stores `"high"` for deepseek-v4.1-flash, so Chorus's interactive `"low"` is not applied. Helpers are unaffected.

**MR-D17 — Behaviour when the primary endpoint has a real outage.** **Open**. Untested. A filtered first `order` entry was verified to fall through to the next; a genuine outage of a pinned primary was not.

**MR-D18 — Routing's key-bearing calls are admitted, on stated constraints.** Resolved (user, Phase 2 kickoff). Mirrored as global decision **D214** in the [Foundation roadmap](../Foundation/roadmap.md) when Phase 2 landed (2026-10-02); a sweep of every branch and worktree confirmed D214 was still free, so no renumber was needed. *Why:* D58 requires every key-bearing call beyond the Test-key action to be "numbered, constrained, and narrated — never slipped in". D60 bars any path without a user gesture from resolving an inference credential. The background observer is that kind of path.

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

**MR-D21 — Phase 3 is the routing inspector in Settings; the launch-dialog picker and the Team per-slot dropdown move to Phase 4.** Resolved (user, Phase 3 kickoff, 2026-10-02). Phase 3 ships a working Settings → Model routing section: observation consent, the data-collection opt-in, a Refresh action that states its cost, the four tier cards and the all-providers table, built as reusable components. Phase 4 places them in the launch dialog and adds the TeamLaunchDialog per-slot dropdown (MR-D15) in the same phase that makes a tier affect a launch. *Why:* nothing selectable-but-ignored ever exists.

**MR-D22 — A refresh of one model waits 60 seconds after the previous one.** Resolved (user, Phase 3 kickoff). `RoutingService.refresh` refuses a refresh of the same model within 60 s of the end of the previous refresh that reached the network, with `BUSY` and a message naming the seconds left. It is a pre-network refusal (no event, no credential read, no decrypt); observer ticks and pre-network refusals do not start it. The length is a constructor option, never reachable from IPC. *Why:* each refresh can spend up to 5 cents, and a renderer bug must not be able to loop spend. It narrows MR-D18's class 1 and needs no Foundation number.

**MR-D23 — Turning observation off clears the designated credential.** Resolved (user, Phase 3 kickoff). The UI sends `{ enabled: false, credentialProfileId: null }`, so turning it on again means choosing a credential again. *Why:* consent stays explicit, and it resolves the Phase 2 carry-over without a main-side change.

**MR-D24 — The UI exposes only background observation and the data-collection opt-in.** Resolved (user, Phase 3 kickoff). The ranking settings keep their defaults until Phase 5. The opt-in writes the whole `RoutingSettings` object, changing only `dataCollection`.

**MR-D25 — Chorus sets OpenCode's remembered variant before an interactive launch.** Resolved (user, Phase 4a kickoff, 2026-10-03); resolves MR-D16. Before an interactive OpenCode launch that sets an effort, routed or not, Chorus rewrites only that model's entry in OpenCode's TUI state file (`<state home>/opencode/model.json`, the `variant` map, keyed by the model id as sent) to the chosen effort, and only when such an entry already exists and differs. The write is atomic and keeps every other key, and it runs only on the verified OpenCode 1.18.33. It writes nothing on another version, on an unreadable file or without an effort. The state home is the one the child will use: `XDG_STATE_HOME`, else `USERPROFILE`, measured with `opencode debug paths`. *Why:* the effort chosen in Chorus must be the effort the session runs at. *Caveat:* this writes another application's state file, and a running TUI may rewrite it.

**MR-D26 — Fresh numbers for ranked tiers; Nitro always; no refresh at launch.** Resolved (user, Phase 4a kickoff). A launch on Budget, Balanced or Fast needs a snapshot no older than `snapshotMaxAgeMinutes` (default 60) and a non-empty tier. Otherwise its card is not launchable, and main refuses the launch too. Nitro is always launchable: its payload needs no snapshot, only its "Likely" preview does. This resolves MR-D10's freshness rule against Plan_1's "Nitro works without a fetch". A launch never refreshes on its own; the dialog's Refresh is explicit and uses the launch's own credential (MR-D19). A cooldown `BUSY` (MR-D22) means the numbers were just refreshed, so the launch proceeds on them; the dialog shows main's message, which names the seconds left.

**MR-D27 — The routing selection persists on the session row only.** Resolved (user, Phase 4a kickoff). Migration v28 adds `sessions.routing_json`, the exact selection a session launched with. Relaunch re-applies it unchanged; re-ranking is Phase 4b. Launch profiles store no tier ("Save as launch profile" already stores no model). Restart still refuses credentialed sessions, and boot restore still heals them to exited.

**MR-D28 — The launch dialog preselects Balanced, then remembers.** Resolved (user, Phase 4a kickoff). The dialog preselects the last choice used for the model, or Balanced when there is none. "OpenRouter default" (an unrouted launch, today's behaviour) stays a choice. A choice that is not launchable falls back to OpenRouter default with a hint; Nitro is never preselected unless it was the last choice.

**MR-D29 — Phase 4 is split into 4a (interactive launches) and 4b (Teams and re-ranking).** Resolved (user, 2026-10-03). *Why:* each half is independently shippable and verifiable, and interactive launches are the smaller, lower-risk half.

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
| 2 | Data and background observation | Complete 2026-10-02 (`17c7d72`, `353cd39`, `a2f7226`, `21c65ff`); [overview](Tasks/Phase-2-Overview.md) |
| 3 | UI: the routing inspector in Settings | Complete 2026-10-02 (`176a83b`, `f307b4d`, `bfa7eaf`, `4167fba`); [overview](Tasks/Phase-3-Overview.md) |
| 4a | Interactive launches: the launch-dialog tier picker | Complete 2026-10-04 (`12984b2`, `b6a1eff`, `349d373`, `50c29d8`, `279953f`, `eb8ee80`); [overview](Tasks/Phase-4a-Overview.md) |
| 4b | Teams and re-ranking | Provisional |
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

### Phase 2 — Data and background observation (complete 2026-10-02)

Kicked off 2026-10-02: [Phase-2-Overview.md](Tasks/Phase-2-Overview.md) (user decisions MR-D18–MR-D20, kickoff decisions K1–K10, clarifications C1–C24). The tasks ran in this order:

1. [Task 2-1](Tasks/Task-2-1.md): OpenRouter transport and parsers (`17c7d72`).
2. [Task 2-2](Tasks/Task-2-2.md): the routing store and settings (`353cd39`).
3. [Task 2-3](Tasks/Task-2-3.md): `RoutingService`, the observer and the live check (`a2f7226`).
4. [Task 2-4](Tasks/Task-2-4.md): IPC, preload and app wiring (`21c65ff`).

Each has its [implementation specification](ImplementationSpecs/). Complete.

**Outcome (2026-10-02).** Each task had a spec-compliance review and a code-quality review with a key-handling focus; every finding was resolved before its commit.

- **MR-G1:** the node and web typechecks pass, `npm test` passes 136 files and 4,029 tests, and `node scripts/verify-routing-ranker.mjs` still prints `PASS (30 checks)`.
- **Live refresh (MR-G1, MR-G7),** `node scripts/verify-routing-phase2-live.mjs`, 2026-10-02 17:41 UTC, on a copied credential in a throwaway `%TEMP%` profile. All ten checks L1–L10 passed:
  - The observer tick made one GET with one decrypt. The refresh made one GET, both preflights and six probe calls over `makora/fp8` and `streamlake/fp8`, for two decrypts in total.
  - The estimate, $0.0049, was printed and emitted before the first probe request. Actual spend was **$0.0028** (cap $0.025; authorised $0.03).
  - Both preflights parsed today's live message: guardrails `['deepseek']`, data policy `['deepseek']`. Both probed tags cache-verified.
  - Today's snapshot had 31 rows and 30 tags (the fixture has 33 and 32). Live interactive tiers: Budget streamlake/fp8 → makora/fp8 → deepinfra/fp8; Balanced streamlake/fp8 → makora/fp8 → gmicloud/fp8; Fast venice/fp8 → parasail/fp8 → baseten/fp8; Nitro likely `together`.
  - The decryptable copy and the bundle were removed. The report stays in `%TEMP%` and is not committed.
- **Zero-cost CDP drive (MR-G1, MR-G5),** `node scripts/verify-routing-ipc.mjs` on the built app with a throwaway profile: `PASS (18 checks)`. Every channel was called with plain-object payloads; a Proxy negative control was rejected with "An object could not be cloned."; `requestsSinceStart` stayed 0; no snapshot was written; no response held key-shaped text.
- **MR-G4:** `npm run grep:secrets` is clean. Tests prove refusals happen before the decrypt, one decrypt per refresh or tick, and the fake key only in the `authorization` header.
- **MR-G8:** the purity and layering greps are empty.

**Decisions made during execution** (coordinator, from review findings; no spec expected value changed):

- **Preflight:** a clause naming a step other than Guardrails, Data Policy or Fallback reads as `step-mismatch`, so a renamed step reads as unknown, never as "nothing removed" (MR-D12).
- **Transport:** endpoint rows whose tag fails `ROUTING_TAG_PATTERN` or `scrubSecrets` are counted as rejected rows. Every routing request is sent with `redirect: 'error'`.
- **Probe spend:** a 2xx probe call whose body cannot be read is charged its per-call estimate (C6) and evaluates as inconclusive. A call that times out after sending counts $0 although OpenRouter may bill it; the estimate-capped plan bounds that.
- **Store:** writes are temp file, fsync, then rename, because observation history cannot be re-fetched. Invalid retention limits, probe caps and tag limits throw `RangeError`.
- **Service:** only `computeTiers`' `RangeError` maps to `INVALID_TIME`. `observe` never rejects and gains a `failed` outcome, ranked between `fetch-failed` and `busy`. After `dispose()`, the data-policy preflight is skipped and the remaining observed models are `failed` without a request.
- **Wiring:** a routing startup failure is logged and never stops the window opening. Broadcast `failed` messages are scrubbed a second time.
- **Live check:** the decryptable copy is removed first, each removal independently, also on timeout and Ctrl+C, and stale copies are swept at start. L5 also requires that a probe actually ran.
- **CDP drive:** 18 checks (D1–D17 plus `cleanup`).

**Carried to Phase 3:**

- There is no refresh rate limit, and each refresh can spend up to 5 cents. Add a cooldown or debounce with the refresh UI. *Resolved by MR-D22 (a 60 s main-side cooldown, Task 3-1).*
- `setObservation` runs the credential checks whenever an id is set, so disabling observation while the designated credential is refused is itself refused. Either the UI sends `credentialProfileId: null` when it disables, or Phase 3 decides to skip the check when `enabled` is false. *Resolved by MR-D23 (off clears the designation).*
- A designated credential whose envelope base URL is not the gateway is decrypted every 30 minutes and sends nothing; `status()` shows `lastOutcome: 'refused'`.
- Any application window passes the IPC sender check, the voice overlay included, as with Teams.
- W3 still has no structured field (Phase 1 carry-over).
- Before this phase, the built preload already contained Zod, through `shared/ipc`'s runtime `IpcChannel` import. The routing bridge adds none.
- Minor store risks:
  - A narrow read-error race can let an append replace the observation history.
  - A crash between write and rename leaves a `.tmp` file that is never swept.
  - An upper-case UUID would alias an account file on NTFS; credential ids are lower-case `randomUUID()` values in practice.

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

MR-D18 is mirrored into the Foundation roadmap as the global decision D214 (2026-10-02). If `feature/model-routing` merges after another branch has claimed D214, renumber at the merge, never before it.

### Phase 3 — UI: the routing inspector in Settings (complete 2026-10-02)

Kicked off 2026-10-02: [Phase-3-Overview.md](Tasks/Phase-3-Overview.md) (user decisions MR-D21–MR-D24, kickoff decisions K1–K10, clarifications C1–C20); the kickoff documents were committed as `df4329e`. The tasks ran in this order:

1. [Task 3-1](Tasks/Task-3-1.md): main support for the UI. This adds a `routing:credentials` channel listing the credentials routing would accept, without decrypting any of them, plus the MR-D22 cooldown (`176a83b`).
2. [Task 3-2](Tasks/Task-3-2.md): the pure view model (`src/shared/routingView.ts`) and the renderer routing store (`f307b4d`).
3. [Task 3-3](Tasks/Task-3-3.md): presentational tier-card, providers-table and refresh-status components, checked by an isolated visual harness (`bfa7eaf`).
4. [Task 3-4](Tasks/Task-3-4.md): the Settings → Model routing section, checked by a zero-cost drive of the built app (`4167fba`).

Each has its [implementation specification](ImplementationSpecs/). Complete.

**Outcome (2026-10-02).** Each task had a spec-compliance review (for Task 3-2, an independent row-by-row review of Tables RV and RS) and a code-quality review focused on IPC hygiene, key handling, drive process safety and view-model determinism. The coordinator re-ran every verification command; every finding was resolved before its commit. Nothing was spent.

- **MR-G1:** the node and web typechecks pass. `npm test` passes 138 files and 4,089 tests: 136 and 4,029 before the phase, plus 17 tests in Task 3-1 and 43 in Task 3-2. `node scripts/verify-routing-ranker.mjs` still prints `PASS (30 checks)`. Against a fresh `npx electron-vite build`, all three drives exit 0:
  - `node scripts/verify-routing-ipc.mjs`: `PASS (19 checks)`.
  - `node scripts/verify-routing-ui.mjs`: `PASS (15 checks)`. Every inspector state is rendered from the golden data, and the run leaves the eleven PNGs.
  - `node scripts/verify-routing-settings-ui.mjs`: `PASS (16 checks)`, at 2026-10-02 21:25 UTC. Settings → Model routing opens in a throwaway profile. Both settings are written through the real UI. The seeded snapshot shows 14 eligible · 18 excluded, Nitro likely `together` and exactly the three clock-independent notes, and the cards match main's own `routing:tiers` reply. At that hour the order was Budget atlas-cloud/fp8 → deepinfra/fp8 → streamlake/fp8, which differs from the golden order, as C18 predicts.
- **MR-G4:** `routing:credentials` makes 0 decrypts and 0 requests (V30–V33), and labels and provider names are scrubbed. Both app drives scan every response and the page text against `secret-patterns.json`, and `npm run grep:secrets` is clean after the drives.
- **MR-G5:** the new channel is parsed in and out in main (I11), and the preload gains one pass-through line and stays Zod-free. The store tests check every IPC argument with real `structuredClone` and `types.isProxy`, with reactive negative controls (RS1, RS16). The built-app drive writes observation and data collection through the UI with no clone error. Its renderer-error hooks are proven by positive controls.
- **MR-G7 (as display):** the estimate exists from `probe-plan` on, before any probe line, and the spend appears only with `done` or `failed`. This is checked over every prefix of the event sequence (RV14, RV15) and in the harness screenshots (H10, H11).
- **MR-G8:** the purity, layering, import and no-Zod-parse greps print nothing, and the view functions are deterministic over deep-frozen inputs (RV20).
- **Mutation checks:** the workers ran targeted mutations (11 across Tasks 3-1 and 3-2, plus two rounds in the Task 3-3 harness). Each made the expected test or check fail, and each was reverted.

**Decisions made during execution** (coordinator, from review findings; no spec expected value changed):

- **E1 — no duplicate failure line.** `SettingsRouting.vue` hides the refresh error line when an adopted `failed` event already prints `Failed: <message> Spent $x.`. A pre-network refusal (the cooldown `BUSY` included), or a failure whose events were missed, still shows main's message. ImplementationSpec-3-4's `refreshError` otherwise repeated the message under a mid-network failure.
- **Task 3-2 gaps filled:**
  - An empty card has `fallbackText ''`, and a no-likely Nitro card has `failsRules []`.
  - Counts say "1 endpoint" or "n endpoints".
  - `setObservation` clears `actionError` first.
  - `load()` reports the first failure in request order.
  - RS14 checks object identity, because RS16 alone cannot catch a dropped snapshot when every payload is built from fresh replies.
  - The coordinator added an RS16 negative control (the store's own state is a Proxy that structured clone refuses) and an RV8 card-count check.
- **Task 3-3 markup:**
  - `RoutingTierCards` has one root.
  - The estimate and spend lines are `<p>` siblings of the progress `<ol>`, since an `<ol>` holds only `<li>`.
  - Chips are one size down inside cards and rows. "Cache verified" uses `set-chip-ok` and "time-of-day price" uses `set-chip-warn`.
  - The table rows carry ARIA table roles.
  - The harness undoes `main.css`'s `overflow: hidden` so H15 measures real page width.
- **Task 3-4:**
  - The section's content renders once the store has loaded, so the page never claims "no credential" or "no snapshot" while the first load is still running.
  - The model and profile selects carry "Model" and "Profile" labels.
  - The observation select is disabled while saving.
  - The drive waits for the startup splash and the saved-flash overlays before each screenshot, proves its three error hooks with positive controls, and exercises the profile select through the real UI.

**Carried to Phase 4:**

- **The providers grid always scrolls inside Settings.** Its 980 px floor (ImplementationSpec-3-3) is wider than the `max-w-4xl` section, so the Status column, which carries the exclusion reasons, needs a sideways scroll inside its box. Revisit the layout when the table moves into the launch dialog.
- **Leaving the section mid-refresh** releases the progress subscription. The refresh finishes in main and the store records its reply, but events that arrived while the section was closed are not replayed.
- The [overview's handoff](Tasks/Phase-3-Overview.md#handoff-to-phase-4) still applies:
  - placement in `LaunchDialog.vue`, with selection added only there;
  - MR-D4's `:nitro` effort strip;
  - MR-D15's Team per-slot dropdown;
  - migration v28 and "remember the last tier";
  - MR-D10 freshness against "Nitro works without a fetch";
  - an explicit answer to the cooldown `BUSY` at launch time.
- **Still open from Phase 2:**
  - A credential whose envelope base URL is not the gateway passes the pre-decrypt list. Its misconfiguration shows only as the observer's `refused` last check.
  - Any window passes the IPC sender check.
  - W3 has no structured field.
- **Outside routing:** on Electron 43, `webContents.on('console-message')` passes the event first, so `scripts/verify-team-review-ui.mjs`'s `(_e, d) => d.level === 'error'` hook never collects an error. That harness's "no console error" check passes vacuously. The routing harnesses read `event.level` and prove their hooks.
- The optional user-run paid check in Task 3-4 (watching the estimate, spend and countdown live) has not been run.

**Goal:** give Phase 2 a screen. The Settings section inspects one registry model:

- the four tier cards (Budget, Balanced, Fast, Nitro), with the Nitro warning;
- the all-providers table with exclusion reasons;
- the snapshot's age;
- a Refresh action that states its estimate before spending and its spend after;
- the observation consent and the data-collection opt-in.

The section says plainly that launches do not use these tiers yet.

**Recorded amendments to Phase 2:** `ROUTING_CHANNELS` and `RoutingApi` gain `credentials`. Two Phase 2 test counts therefore change on purpose: S5-1 goes from 9 to 10, and I1/I4 from 8 to 9. The IPC drive ends `PASS (19 checks)`.

**Not in Phase 3:** `LaunchDialog.vue`, `TeamLaunchDialog.vue`, launch wiring, migrations, the ranking settings, and any paid check.

**Exit:** MR-G1, MR-G4, MR-G5, MR-G7 (as display) and MR-G8 pass, through three zero-cost checks:

- the IPC drive;
- an isolated harness that renders every inspector state from the golden data;
- a drive of the built app that opens Settings → Model routing in a throwaway profile, round-trips both settings and renders a seeded snapshot with no OpenRouter request.

Phase 4 is split (MR-D29): 4a wires interactive launches, and 4b wires Teams and re-ranking.

### Phase 4a — Interactive launches: the launch-dialog tier picker (complete 2026-10-04)

Kicked off 2026-10-03: [Phase-4a-Overview.md](Tasks/Phase-4a-Overview.md) (user decisions MR-D25–MR-D29, kickoff decisions K1–K14, clarifications C1–C44); the kickoff documents were committed as `0084293`. The tasks ran in this order:

1. [Task 4a-1](Tasks/Task-4a-1.md): launch routing contracts and resolution. This covers the selection type, the pure `launchCore`, `RoutingService.resolveLaunch`, the remembered choice and the `routing:launch-preferences` channel (`12984b2`).
2. [Task 4a-2](Tasks/Task-4a-2.md): the OpenCode adapter carries the per-process routing config, and the remembered-variant write (MR-D25). `verify-routing-body.mjs` is rebuilt on Chorus's real builders (MR-G2) (`b6a1eff`; its TUI readiness fix followed as `349d373`).
3. [Task 4a-3](Tasks/Task-4a-3.md): launch wiring. Main resolves and checks the tier at launch, migration v28 stores the selection, and Relaunch re-applies it (`50c29d8`).
4. [Task 4a-4](Tasks/Task-4a-4.md): the launch-dialog tier picker. The Phase 3 cards gain an opt-in selection mode, and Settings' preview note is amended (`279953f`).
5. [Task 4a-5](Tasks/Task-4a-5.md): a zero-cost drive of the built app with a stub `opencode`, launching routed, Nitro and unrouted sessions in a throwaway profile and home (`eb8ee80`).

Each has its [implementation specification](ImplementationSpecs/). Complete.

**Outcome (2026-10-04).** Each task had a spec-compliance review and a code-quality review. The code-quality reviews focused on:

- IPC hygiene, and key handling;
- main as the only authority for a tier, and refusals before any decrypt or row;
- MR-D25 safety, and drive process safety;
- byte-safe edits of the CRLF and mixed files;
- determinism of `launchCore.ts` and `routingView.ts`.

The coordinator re-ran every verification command, and every finding was resolved or recorded below before its commit. Nothing was spent: there was no paid run, no Refresh was pressed, and the built-app drive launched no real OpenCode.

- **MR-G1:** the node and web typechecks pass. `npm test` passes 143 files and 4,216 tests: 138 and 4,089 before the phase, plus 50 tests in Task 4a-1, 36 in 4a-2, 11 in 4a-3 and 30 in 4a-4. Against a fresh `npx electron-vite build`, at 2026-10-04 17:34–17:36 UTC, the six scripts exit 0 in order:
  - `node scripts/verify-routing-ranker.mjs`: `PASS (30 checks)`, unchanged.
  - `node scripts/verify-routing-ipc.mjs`: `PASS (20 checks)`. D19 reads an empty `routing:launch-preferences` and refuses an extra key. D16 proves v28 in the throwaway profile's own `chorus.db`.
  - `node scripts/verify-routing-ui.mjs`: `PASS (20 checks)`, with 13 PNGs (Phase 3's eleven plus `select-golden.png` and `select-stale.png`).
  - `node scripts/verify-routing-settings-ui.mjs`: `PASS (16 checks)`, with the K14 note.
  - `node scripts/verify-routing-body.mjs`: `PASS (16 checks)` against OpenCode 1.18.33 at loopback, `providerTraffic: false`.
  - `node scripts/verify-routing-launch.mjs`: `PASS (20 checks)`, with 3 PNGs. At that hour main's Balanced order was atlas-cloud/fp8 → morph/fp8 → makora/fp8, not the golden order, as C42 expects. Every launch's provider object equalled main's own `routing:tiers` reply and its `routing_json` row.
- **MR-G2:** the body script builds its TUI cases from Chorus's real builders: `buildLaunch`, `writeMcpConfig`, `composeChildEnv`, `buildOpenCodeRoutingContent` and `unroutedNitroVariantsContent`. Against the real OpenCode 1.18.33 it proves that:
  - the routed Balanced provider object arrives exactly;
  - Nitro keeps `low` only when its variants are declared;
  - without MR-D25 a remembered `high` beats `agent.build.variant`, and with it `low` is sent;
  - K13's unrouted `:nitro` keeps `low` with no provider object.
- **MR-G3:** every OpenCode run in the body script has its own `XDG_STATE_HOME` and `XDG_DATA_HOME`. The launch drive runs a stub with a throwaway home and decoy XDG directories, which stay empty. The user's real `model.json` (1,157 bytes, SHA-256 `1599A3F2…7948`) was byte-identical before and after every test run, body run and drive run of the phase.
- **MR-G4:**
  - `resolveLaunch` reads no credential row, decrypts nothing and sends nothing (V43, V46, V50).
  - The launch's only decrypt is still `resolveCredential`, and a routing refusal returns before it. The gateway refusal is scrubbed.
  - Keys reach children only as `OPENROUTER_API_KEY`. The launch drive's L18 scans page text, responses, logs, the shared config and every capture, with positive controls.
  - `npm run grep:secrets` is clean after the drives.
- **MR-G5:**
  - `routing:launch-preferences` is parsed in and out in main (I12).
  - `routing_tier` is parsed by `launchRequestSchema`, which strips a renderer-sent `provider` or `routing` object (W2).
  - The launch store's IPC arguments are `plainRoutingInput` snapshots. LS13 was mutation-checked to fail without them.
  - No drive saw a clone error.
- **MR-G6:** v28 is verified in the throwaway profiles' own databases by the IPC drive's D16 and the launch drive's L1 and L16, and in memory by the `schema.test.ts` v28 block.
- **MR-G8:** the purity, layering, import, no-parse and K14 greps print nothing, and the ranker is untouched.

**Decisions made during execution** (coordinator, from review findings). No spec expected value changed; these are additions only.

- **4a-1: C4 tightened.** `routingLaunchSelectionSchema` also requires the provider shape `payloadCore` builds for the tier (new test S7-8):
  - Nitro's provider is `null` or exactly `{ data_collection: 'deny' }`.
  - A ranked tier's provider has `allow_fallbacks: false`, `require_parameters: true` and `quantizations`.

  A hand-edited `routing_json` that allows fallbacks, or a Nitro row with a pinned order, can no longer relaunch.
- **4a-2: remembered-variant hardening** (VW9–VW12). The writer:
  - decodes strictly as UTF-8, so a stray byte or a BOM is skipped, never rewritten;
  - uses `lstat`, so a symlinked `model.json` is skipped;
  - accepts only an absolute state home;
  - still reports `written` when the logger throws after the write.

  The body script refuses to write unless the computed state home is the sandbox, guards the real file through an independent path, and kills each TUI once.
- **`verify-routing-body.mjs` readiness (`349d373`).** The script failed intermittently: 2 of 9 runs, under load, always with "sent no request".
  - **Root cause:** "ready" was a 2,000-byte screen count, reached about 0.8 s after launch. OpenCode 1.18.33's input appears about 3.2 s in, and keys typed before it exists are dropped.
  - **Fix:** the script now waits for the `Ask anything` placeholder, presses Enter only after the typed text echoes, and allows 60 s for the first request.
  - This was a harness problem only, with no product change. The K13 case was not special.
- **4a-3.**
  - Both handlers return the gateway refusal through `scrubSecrets`, because it embeds the user's credential label.
  - `withMcpEnv` composes `cliState` only for OpenCode launches with an effort. A failure skips the state write instead of failing the launch.
  - A routed plan with no routing service is refused with the `unavailable` text instead of launching unrouted.
  - `launchConfigContent` reads no catalog for a non-OpenCode launch.
  - W2 pins that the wire schema strips renderer-built routing objects.
- **4a-4.**
  - **Spec insertion I7 is omitted** (`<style src="../assets/settings.css">` in `LaunchDialog.vue`). It breaks `electron-vite build`: `@vitejs/plugin-vue` caches a `<style src>` descriptor by file name. The coordinator reproduced the failure.
    - The classes reach the dialog through `App.vue` → `SettingsView.vue`, and the rule is still emitted once.
    - The launch drive's L5 proves the section is styled, with classless negative controls.
  - A tier that ages past 60 minutes while the dialog is open stops being launchable at once, through the dialog's 1 s age view. The C27 fallback then appears instead of main's refusal.
  - Refresh shows as running while any refresh runs.
- **4a-5.**
  - The throwaway home also gets `AppData\Roaming` and `AppData\Local`. Electron's `app.getPath('appData')` throws when they are missing under a throwaway `USERPROFILE`.
  - `launchSolo` asserts the agent, the auth mode, the credential and the Solo / 1 / Current tree plan in the same evaluation as the click, so the drive can never start a real CLI. This was proved with a wrong expected agent: the launch was refused before any click.
  - L17 hashes every dirty and untracked path, with `GIT_OPTIONAL_LOCKS=0`.

**Carried to Phase 4b:**

- **The [overview's handoff](Tasks/Phase-4a-Overview.md#handoff-to-phase-4b):**
  - MR-D15's Team per-slot tier;
  - helper re-rank and "Re-rank and relaunch" (MR-D10);
  - guardrail revalidation (MR-D12) and runtime failover messages;
  - MR-D17;
  - relaunch's `provider.model` gap for unrouted sessions;
  - whether launch profiles should carry a tier;
  - Phase 3's open items: W3, the providers grid scrolling inside its box, and any window passing the IPC sender check.
- **MR-D25 limits** (recorded risks):
  - A running OpenCode TUI may rewrite `model.json` after Chorus does.
  - A TUI write that lands between Chorus's read and its rename is lost.
  - A `detectClis()` memo older than an OpenCode upgrade can let one write through for an unverified version.
- **`recordLaunchChoice` on a transient read failure** reads the file as empty and rewrites it with one entry, losing other models' remembered choices. The data is low-value, and this follows the Phase 2 observation precedent.
- **The launch store inherits two behaviours from the Settings store's pattern:**
  - A cooldown `BUSY` can adopt another refresh's progress events.
  - A frozen cooldown message from an earlier open can reappear on the next open for the same model.
- **Dialog details:**
  - A lost explicit choice can fall back to a remembered Nitro, and the hint does not name it.
  - A disabled card's reason is not tied to its radio with `aria-describedby`.
  - The dialog's settings.css styling depends on `App.vue` importing `SettingsView` statically. L5 guards this.
- **SessionLaunch** computes the route and content after `mintForDispatch`. They cannot throw in practice, but a throw there would leave an unlinked minted key until it expires.
- **Outside routing:** `ensureDevToastShortcut()` (`src/main/index.ts`) calls `app.getPath('appData')` during startup. A missing `<USERPROFILE>\AppData\Roaming` aborts startup with no window.
- **Harnesses:**
  - The launch drive's Ctrl+C path mirrors the Settings drive but was not exercised live.
  - The body script's `providerTraffic: false` relies on OpenCode's config and cache directories, which are deliberately the user's own, naming no other provider.
  - Its readiness marker, `Ask anything`, is specific to OpenCode 1.18.33.
- **The optional paid check has not been run.** It is a user-run real Balanced launch on a copied credential.

**Goal:** when an interactive OpenCode session launches on an OpenRouter API-key credential, the user can pick Budget, Balanced, Fast, Nitro or "OpenRouter default" in the launch dialog. Main resolves the tier itself (K2), so no renderer-built provider object reaches a launch. The session's OpenCode receives the provider object and, for Nitro, its declared effort variants, per process in `OPENCODE_CONFIG_CONTENT` (MR-D3, MR-D4). The selection is stored on the session row (migration v28), and Relaunch re-applies it.

**Corrections the kickoff made against the code:**

- The session row stores no model or effort, so a per-launch choice is lost on restart or relaunch; MR-D27 adds `routing_json`.
- Credentialed sessions cannot be restarted, and Relaunch needs a launch profile. So "relaunch re-applies the persisted selection" covers profile-based sessions only.
- A credentialed child receives no `XDG_*` variable, so OpenCode's state home comes from `USERPROFILE`.
- `routing` is constructed after `registerIpc`, so the launch handlers reach it through a thunk.

**Not in 4a:** `TeamLaunchDialog.vue`, helper routing and re-rank, "Re-rank and relaunch", guardrail revalidation, a tier on launch profiles, any paid check.

**Exit:** MR-G1 to MR-G6 and MR-G8 pass through zero-cost checks:

- the IPC drive, 20 checks;
- `verify-routing-body.mjs` on the real builders against real OpenCode 1.18.33 at loopback (MR-G2, MR-G3);
- the isolated UI harness with the selectable states;
- the Settings drive, unchanged at 16 checks;
- the built-app launch drive, which uses a stub `opencode` and a throwaway profile and home, and proves the user's real OpenCode state is untouched.

### Phase 4b — Teams and re-ranking (PROVISIONAL)

*Not authoritative; revise at kickoff.*

- The per-slot tier dropdown in TeamLaunchDialog (MR-D15). Team member routing becomes an optional field that flows through `HelperExecutionInput` to the helper's per-model options.
- Helper re-rank between attempts (MR-D10).
- "Re-rank and relaunch" for interactive sessions (MR-D10). A relaunch re-ranks only by that explicit action; MR-D27's plain relaunch keeps the persisted selection.
- Guardrail revalidation after access errors (MR-D12).
- Runtime failover messages (Plan_1 §12).
- MR-D17, a real outage of a pinned primary.
- Relaunch's pre-existing use of the provider's model instead of the launch profile's model for unrouted sessions, if it is still open.

MR-G2 applies to every change here.

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

- MR-D17 (real primary outage), above. MR-D16 is resolved by MR-D25.
- The meaning of non-zero `status` values. Only `-2` has been seen (Alibaba, alongside 97% uptime); MR-D8 excludes any non-zero value.
- Whether six observations beat three or an EWMA for smoothing (council Q6 dissent).
- The council ran with two of four members, so its votes carry less weight than their count suggests.
- The Foundation roadmap does not yet place this feature. An optional pointer can be added there.
