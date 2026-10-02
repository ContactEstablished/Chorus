# Phase 2 — Data and background observation overview

Created 2026-10-02. **Status: Not started.** Kickoff decisions K1–K10 are resolved (coordinator, 2026-10-02). User decisions MR-D18–MR-D20 are resolved (user, 2026-10-02) and are recorded in the roadmap by the coordinator. Clarifications C1–C24 were made while drafting the specifications; the coordinator reviewed and accepted them on 2026-10-02.

## Phase contract

Feed the Phase 1 ranker with real data, in main, without a renderer. A user-initiated refresh fetches OpenRouter's keyed endpoint list for one registry model, discovers the account's guardrail and data-policy removals with two zero-cost preflights, verifies prompt caching with a capped probe, stores everything under `userData/routing/`, and returns a `TierResult`. A background observer records the free endpoint list every 30 minutes with a credential the user designated. A `routing:*` IPC surface exposes all of it, validated in main, with progress events that state the probe's cost before any money is spent.

Nothing reaches a launch. No renderer components, no launch-dialog changes, no OpenCode config, no migrations; those are Phases 3 and 4. The [feature roadmap](../roadmap.md) is authoritative for MR-D1 to MR-D17 and gates MR-G1 to MR-G8; MR-D18 to MR-D20 are the user decisions below. Where [Plan_1](../Plan_1.md) §12 differs from this document (channel names, snapshot layout, "keep the last 20 snapshots"), this document wins. Measured evidence is in [Phase-0-Findings.md](../Phase-0-Findings.md).

**Exit:** MR-G1, MR-G4, MR-G5, MR-G7 and MR-G8 pass. One real refresh on a copied credential parses both preflights, probes at most two endpoints, reports its estimate before probing and its actual spend after, and spends at most 3 cents in total. A zero-cost drive of the built app exercises every channel with plain-object payloads and makes no OpenRouter request.

## Grounding

Verified 2026-10-02 at `a9842a5` on branch `feature/model-routing` (by reading each file this session). Line numbers drift; recheck at execution.

| Location | Fact |
|---|---|
| `src/shared/routing.ts:1` | Imports only `zod`; compiled by both tsconfigs. `isoTime = z.iso.datetime()` (:29, module-private), `rawEndpointSchema` (:58), `EndpointSnapshot` (:83), `routingObservationSchema` (:86), `routingSettingsSchema` (:134), `DEFAULT_ROUTING_SETTINGS` (:155), `accountEligibilitySchema` (:206, `null` list = unknown), `cacheVerificationSchema` (:213), `RankInput` (:216). `TierResult` (:289) is an interface with **no Zod schema**. |
| `src/main/routing/routingCore.ts:70` | `computeTiers` rejects a `now` or `fetchedAt` that is not a UTC instant (:38) and a snapshot fetched after `now` (:76), both with `RangeError`. It trusts `settings` and `profile` (comment :65–68). |
| `src/main/routing/endpointsCore.ts:75` | `parseEndpointsResponse` throws on an invalid envelope (:77) and rejects bad rows by index. `extractObservations` (:176) yields one observation per tag at `fetchedAt`. |
| `src/main/routing/rankerCore.ts:118` | `rankCandidates` merges stored history with the snapshot's own observations (:125), credits cache only for `verified === true` (:132), and sets `scores.balanced` for every eligible candidate (:168). `excludedBy` empty means eligible (:220). |
| `src/main/routing/__fixtures__/endpoints-deepseek-v4.1-flash-2026-10-02.json` | 64,233 bytes for 33 rows (32 tags; `baseten/fp8` has two rows). |
| `src/main/services/modelCatalog.ts:161` | The D58 key-bearing call. Exported `FetchResponseLike` (:50), `FetchInitLike` (:61, **no `body` field**), `FetchLike` (:67); `MODELS_RESPONSE_CAP_BYTES` (:81); 10 s timeout (:83); private `readCapped` (:124). Management refused first (:175), `unavailableSince` refused by label (:186), then one decrypt (:196); the key only in `authorization` (:221); a fetch exception becomes `unreachable` (:231); non-2xx cancelled unread (:243); 2xx read capped (:251). |
| `src/main/services/modelCatalogCore.ts:107` | `REFRESH_FAILURE`, the fixed failure vocabulary. `MODEL_ID_PATTERN` (:151), `MODEL_EFFORT_PATTERN` (:192). |
| `src/main/services/logger.ts:81` | `scrubSecrets`, the free-text key scrubber. |
| `src/main/services/openrouterKeys.ts:53` | `OPENROUTER_GATEWAY_BASE_URL = 'https://openrouter.ai/api/v1'`, the one home for the gateway address. |
| `src/main/services/teamMemberProfiles.ts:15` | The OpenRouter-API-credential predicate: `authMode === 'api_key'` and `baseUrl?.replace(/\/+$/, '') === TEAM_OPENROUTER_URL` (:11); repeated with `!unavailableSince` at :41. |
| `src/main/services/vault.ts:244` | `decryptForLaunch(id): Promise<VaultResult<ResolvedEnvelope>>`. It does **not** check `unavailableSince`; it decrypts, and marks the row unavailable on failure (:256, :266). Imports `safeStorage` from `electron` (:1), so tests use a fake. Credential ids are `randomUUID()` (:144). |
| `src/main/services/vaultCore.ts:112` | `VaultResult<T>`; `ResolvedEnvelope` (:24) = `{ key, baseUrl?, extraHeaders? }` (:15). |
| `src/main/db/schema.ts:220` | `providerConfigs` (`authMode` :224, `baseUrl` :230); `credentialProfiles` (:248, `unavailableSince` :267); `settings` key/value table (:54). |
| `src/main/services/storage.ts:1101` | `VOICE_SETTINGS_KEY`; `readVoiceSettings` (:3856, defaults underneath, bad row → defaults + warning) and `writeVoiceSettings` (:3876, parsed before writing); `writeAppearanceSettings` ends at :3918. `listProviderConfigs` (:2298), `getProviderConfigById` (:2302), `getCredentialProfileById` (:2352). Last migration v27; no migration is needed here (MR-D20). |
| `src/main/services/teamIpc.ts:14` | `registerTeamIpc`: `handle()` (:18) checks the sender is an app window's main frame (:22), parses input and output with Zod, returns `{ ok, value }` or `{ ok: false, code, message }`; broadcasts with `BrowserWindow.getAllWindows()` (:70–73). |
| `src/main/services/teamIpc.test.ts:4` | Mocks `electron` (`ipcMain.handle` into a map, `BrowserWindow.fromWebContents`, `getAllWindows`); imports only `type StorageService`. |
| `src/main/ipc.ts:617` | `registerIpc` has 19 positional parameters, `teamRuntime?` last (:720); it calls `registerTeamIpc` (:722). Council's `emitProgress` (:3503) parses in main, then sends to every window. |
| `src/preload/index.ts:143` | `team:` bridge of `ipcRenderer.invoke` pass-throughs, `as TeamApi` (:159). "NOTE: no Zod here" (:137). `ChorusApi = typeof chorusApi` (:919). `index.d.ts:5` declares `chorus: ChorusApi`, so it needs no edit. `TeamApi` and `TeamReply` live in `src/shared/team.ts:199` and :197. |
| `src/main/index.ts:590` | `storage` opened at :590 (`const store = storage` :595); `fleet.start()` :801; `const vault` :809; `teamRuntime` :1343, started :1355; `council = registerIpc(` :1356–1402; `watchSessionExits` :1403; `createWindow` :1487; `before-quit` :1510, Team-shutdown branch :1511, `fleet?.stop()` :1520. An explicit `--user-data-dir` wins over the packaged default (:125). |
| `src/main/services/fleetRegistry.ts:233` | One `setInterval` per service; `stop()` clears it. `teamRuntime.ts:82` calls `.unref()` on its timer. |
| `src/main/adapters/mcpConfigWrite.ts:79` | Atomic write: temp file then `renameSync(temp, target)`, temp removed on failure. Also `scrollbackStore.ts:129`. |
| `vitest.config.ts:3` | No globals; tests never import `storage.ts` or `better-sqlite3` (Electron ABI). |
| `src/main/services/modelCatalog.test.ts:25` | Fake key assembled by concatenation so `npm run grep:secrets` never sees a complete key shape; `okVault` (:52), `forbiddenVault` (:64), `stubResponse` (:76). |
| `scripts/verify-routing-live.ts:63` | Phase 0 preflight body; the cache probe (:77–88) used 220 filler lines, `max_tokens: 64`, 1.5 s gaps and batches of 5 (:93). Its comment says "~3,000-token" (:77); the measured prompt was 4,457–4,464 tokens. |
| `scripts/verify-routing-live.mjs:18` | Live-harness precedent: copies `Local State` (:18), bundles with esbuild (:20), strips `ELECTRON_RUN_AS_NODE` (:21), spawns windowless Electron with `--user-data-dir` (:23). `scripts/team-fixture-credential.ts:9` copies the OpenRouter API credential (:13). |
| `scripts/verify-team-packaged-ui.mjs:28` | CDP precedent: picks a free port (:28–29), spawns with `--user-data-dir` and `--remote-debugging-port` (:32), waits for the `renderer/index.html` page target (:41). |

**Evidence (not committed; `%TEMP%`).** `chorus-routing-live-MDU7qB\report.json` (`guardrailPreflight[1]`) and `chorus-routing-live-A9VBtp\report.json` (`dataPolicyPreflight[0]`, `[1]`, `caching`). They contain endpoint metadata and an account-level guardrail reason; no keys. Facts the specs rely on:

- The guardrail reason has nested parentheses: `Filter by Guardrails removed deepseek (Paid model training violation (account settings));`.
- Under `data_collection: 'deny'` the Guardrails step is absent; Data Policy removes `deepseek` first. Two preflights are therefore required.
- **The funnel counts endpoint rows, not tags.** `Filter by Fallback` goes 32 → 0 (32 rows) but its clause lists 31 tags, because `baseten/fp8` has two rows. A tag-count check must weight each tag by its row count (C1).
- The first preflight's funnel includes `Apply Status Sorting` (32 → 32); the later run's does not. `error.code` was never captured; `failed_routing_step` only in the first run.
- Cache probe: 15 tags, 4,457–4,464 prompt tokens, 3 calls each, total $0.024627. Per tag $0.000345 (`morph/fp8`) to $0.004160 (`baidu/fp8`). `baseten/fp8` and `morph/fp8` first hit on call 3; `baidu/fp8` never cached.

## Preserved state

Pre-existing worktree state at kickoff: ` M .mcp.json`, ` M docs/Features/Engine/chorus-engine-spec.md`, ` M electron-builder.yml`, ` M package.json`, and seven untracked files under `docs/troubleshooting/`. Do not revert, stage, commit or overwrite any of them. Stage explicit paths only; the repository is public.

Phase 1 contracts are frozen: no existing export of `src/shared/routing.ts` or `src/main/routing/*` changes, and the golden fixture and expectations stay as they are. Phase 2 adds exports only. `node scripts/verify-routing-ranker.mjs` must keep printing `PASS (30 checks)`.

## User decisions (resolved 2026-10-02)

| # | Decision |
|---|---|
| MR-D18 | **Key-bearing routing calls are admitted, constrained.** Mirrored as global D214 when Phase 2 lands (the number is contingent). Two classes. **(1) User-initiated refresh** (one IPC call = one user action) for (model, credential): the keyed `GET /models/{slug}/endpoints`; two zero-cost preflights (`POST /chat/completions` with `provider: { order: ['chorus-preflight-none'], allow_fallbacks: false }`, `max_tokens: 1`, `messages: [{ role: 'user', content: 'OK' }]`, the second adding `data_collection: 'deny'`); and the automatic cache probe (MR-D9), capped at $0.05 per refresh. **(2) Unattended observer:** every 30 minutes, the free `GET /endpoints` only, with the designated credential (MR-D19). **Constraints** (mirroring D58, stated per credential class as D60 requires): decrypt at the moment of use and drop it (no module-level variable, no memo; one decrypt per refresh or per tick); refuse **before** any decrypt for an unknown profile, `unavailable_since` (by label, no decrypt attempt), `authMode` not `'api_key'` (a `'management'` key outright), or a provider whose normalised base URL is not `https://openrouter.ai/api/v1`; refuse an envelope `baseUrl` that differs from it; the key only in the `Authorization` header, never in a URL, log, store file, IPC payload, report or child process; 2xx read size-capped and never echoed into an error; non-2xx cancelled unread **except the preflight's expected 404**, read capped at 64 KB, parsed, and only parsed tags plus fixed strings leave the function (401/403 always cancelled unread); every outbound message through `scrubSecrets`; no retry, no backoff. |
| MR-D19 | **Consent through a designated credential.** A persisted `routing_observation` setting `{ enabled: boolean, credentialProfileId: string \| null }`, default `{ enabled: true, credentialProfileId: null }`. The observer is dormant until a credential is designated through IPC (a user gesture; the UI is Phase 3). Designating runs the same pre-decrypt checks. A refresh uses the credential its caller names, not the designated one. |
| MR-D20 | **Storage.** JSON files under `userData/routing/`, written atomically; settings as JSON values in the existing `settings` table; no migration (v28 stays reserved for Phase 4). |
| Spend | Live verification may spend up to 3 cents, in a throwaway profile with a copied credential, reporting actual spend. |
| Phase 1 C11 | Approved; it is already in the code. Nothing to do. |

## Kickoff decisions (resolved 2026-10-02, coordinator)

| # | Decision |
|---|---|
| K1 | **Placement and purity.** Pure logic in new `src/main/routing/*Core.ts` modules; the Phase 1 purity grep over `src/main/routing` and `src/shared/routing.ts` keeps printing nothing, so no impure file goes in `src/main/routing/`. Routing cores import only `zod`, `../../shared/routing` and siblings (a second grep checks they never import `../services`, `../db` or `../adapters`). Transport, file I/O, timers and IPC go in `src/main/services/routing*.ts`. Shared schemas extend `src/shared/routing.ts` (imports only `zod`). Phase 2 calls `computeTiers` only through `RoutingService`; it never re-implements ranking. |
| K2 | **Transport.** The base URL is always `OPENROUTER_GATEWAY_BASE_URL`. Caps: endpoints response 2,000,000 bytes (the fixture is 64,233 bytes for 33 rows, about 30× headroom); preflight 404 body 65,536; probe response 262,144. Timeout 10 s per request. Injectable `fetchImpl` reusing `FetchResponseLike` and `FetchInitLike`; `readCapped` becomes exported from `modelCatalog.ts` (a one-word additive change, recorded) rather than copied. Fixed failure vocabulary: `unreachable`, `auth-failed`, `rate-limited`, `provider-error`, `unexpected-status`, `unrecognized`, `model-mismatch`. |
| K3 | **Preflight parsing (MR-D12).** A pure parser over the 404 body. From `error.message`, take the tail after `Every candidate endpoint was removed during routing: `, split it into `Filter by <Step> removed …` clauses, and take the tags of the `Filter by Guardrails` (or `Filter by Data Policy`) clause, stripping a trailing parenthesised reason with nested parentheses. Cross-check against `error.metadata.routing_funnel`. Any status other than 404, a missing funnel, an unparseable message or a count mismatch gives `null` (unknown, never "allowed"; Phase 1 K3). No such step and a consistent funnel gives `[]`. Guardrails come only from the first preflight, data policy only from the second; the two lists plus `checkedAt` form `AccountEligibility`. |
| K4 | **Cache probe (MR-D9).** Planned by a pure core. Candidates: tags eligible in the refresh's own `computeTiers` result whose cache record is missing or older than 14 days. Worst-case estimate per tag = 3 × (prompt price × probe prompt tokens + completion price × 64) at uncached prices. Add tags in Balanced-score order while the cumulative estimate stays within the cap; report the rest as not probed (`cap`). Request: a deterministic prefix with a per-run nonce (randomness lives in the service), 3 calls pinned with `order: [tag], allow_fallbacks: false`, `max_tokens: 64`, `reasoning: { effort: 'low' }`, about 1.5 s apart, at most 5 tags in flight. Verified `true` if call 2 or 3 reports `cached_tokens > 0`; `false` if all three are 200 with 0 cached; otherwise no record (inconclusive). Actual spend = sum of `usage.cost`; no new tag starts once actual spend reaches the cap. Probe text never contains user content. |
| K5 | **Store layout (MR-D20).** Under `userData/routing/`, one directory per registry model (name derived safely from the slug): the latest snapshot `{ version: 1, model, fetchedAt, endpoints }`, the observation history (pruned to `observationMaxAgeDays` at write time, bounded in count), cache verifications, and account eligibility per credential profile id (guardrails are account-specific). Each file has a Zod schema; a missing, corrupt or invalid file reads as empty with one logged warning, never throws and is never deleted by a read. Writes are temp file + rename. Keys never appear in any file. |
| K6 | **Settings.** `routing_settings` (Phase 1 `RoutingSettings`, defaults underneath, validated both ways: the voice pattern) and `routing_observation` (MR-D19), as JSON values in `settings`. Pure parse helpers, testable without `storage.ts`. |
| K7 | **Observer (MR-D10, MR-D18, MR-D19).** One timer, `unref()`ed, started after the app is ready, stopped in `before-quit`. First tick 2 minutes after start, then every 30 minutes. A model is skipped when its stored snapshot is younger than 25 minutes. Single-flight per model is shared with refresh (the second caller gets `busy`). Dormant while disabled or undesignated: no read of the credential row, no decrypt. A refused or failed tick records a fixed-vocabulary outcome and waits for the next tick. It stores the snapshot and appends observations; it never preflights or probes. |
| K8 | **Service API.** `refresh({ model, credentialProfileId, profile, effort })`: fetch, store, preflight ×2, store, `computeTiers` with stored history, cache and account, plan and run the probe, store, recompute, return. Progress events in a fixed order: `endpoints`, `preflight`, `probe-plan` (carrying the estimate before any probe call), `probe` per tag, then exactly one `done` or `failed` with actual spend (MR-G7). `tiers({ model, profile, effort, credentialProfileId \| null })` makes no network call; `NO_SNAPSHOT` when nothing is stored; a missing account file or a null credential gives `{ guardrailRemoved: null, dataPolicyRemoved: null, checkedAt: null }`. Also `status()`, settings and observation get/set. `now` comes from an injected clock. |
| K9 | **IPC (MR-G5).** Channels `routing:models`, `routing:tiers`, `routing:refresh`, `routing:status`, `routing:settings-get`, `routing:settings-set`, `routing:observation-get`, `routing:observation-set`, and the broadcast `routing:progress`. The Teams envelope and sender-frame check; Zod parse of every input and output in main; the preload is a thin pass-through with no Zod; every renderer-to-main payload runtime-verified as a plain object via CDP (CLAUDE.md, D14). Responses never carry key material, fingerprints or raw provider bodies. |
| K10 | **Verification.** Unit tests with a stub fetch, a fake clock and temp directories; no network in unit tests. Real checks: (a) a live windowless-Electron script that copies the installed OpenRouter credential into a throwaway profile (with `Local State`), runs one observer tick and one real refresh with the probe limited to 2 tags, prints the estimate before probing and the actual spend after, asserts total spend ≤ $0.03, and writes its report to `%TEMP%` only; (b) a zero-cost CDP drive of the built app with a throwaway `--user-data-dir` that exercises every channel with plain-object payloads and proves no OpenRouter request was made. |

## Clarifications made while drafting (accepted 2026-10-02)

Each fills a gap the K-rules leave, or corrects a premise against the code or evidence. Each is stated normatively in the named specification.

| # | Clarification | Spec |
|---|---|---|
| C1 | **The preflight count check weights tags by rows.** For the target step, the sum over its distinct parsed tags of `rowsPerTag[tag]` (from the refresh's own snapshot; a tag not in it counts 1) must equal the funnel's removal (previous count minus the step's count). *Why:* the funnel counts rows; with a plain tag count the real Fallback clause (31 tags, 32 rows) would fail. | 2-1 |
| C2 | **The parse is strict everywhere, count-checked only on the target step.** The funnel must start at `Initial Endpoints`, never increase, and end at 0; every clause's step must be a funnel step with a positive removal and every positive-removal step must have a clause; each tag matches `ROUTING_TAG_PATTERN` (at most 64 characters). Other steps are not count-checked. *Why:* any drift reads as unknown, while unrelated snapshot drift (a new endpoint in the Fallback list) cannot hide a guardrail answer that is itself consistent. | 2-1 |
| C3 | **A parsed tag must survive `scrubSecrets` unchanged**, or the whole list is `null` (`bad-tag`). With the 64-character limit, a key-shaped token can never leave as a tag. | 2-1 |
| C4 | **The probe keeps Phase 0's measured prompt**, not "~3,000 tokens": a system message `Session <nonce>. Reference module follows.\n` plus the same 220 filler lines, and the user message `Reply with the single word OK.`, measured at 4,457–4,464 prompt tokens. The estimate uses 4,500 tokens. *Why:* MR-D9 records a ~4.4k prefix, and only this shape's caching behaviour was measured; Phase 0's "~3,000-token" comment (`verify-routing-live.ts:77`) is wrong. With fixture prices, all 14 eligible tags estimate $0.049387, inside the $0.05 cap. | 2-1 |
| C5 | **The nonce is per run and per tag.** The service draws one random run nonce; the core writes `Session <runNonce> <tag>.`, so two tags of one provider never share a prefix. | 2-1 |
| C6 | **Probe accounting.** A 200 without a numeric `usage.cost` counts its per-call worst-case estimate toward spend. `false` requires all three calls to be 200 with an explicit `cached_tokens === 0`; a missing field is inconclusive. | 2-1, 2-3 |
| C7 | **The cap cut is a prefix.** The first due tag that would push the cumulative estimate over the cap, and every later one, is not probed (`cap`); the planner never skips ahead to a cheaper tag. A verification-only tag limit cuts the same way (`limit`). | 2-1 |
| C8 | **`FetchInitLike` has no `body`.** `routingClient.ts` declares `RoutingFetchInit = FetchInitLike & { readonly body?: string }` and `RoutingFetchLike`, and reuses `FetchResponseLike`. A `FetchLike` stub stays assignable. | 2-1 |
| C9 | **No extra headers on routing calls.** Headers are exactly `accept: application/json`, `authorization: Bearer <key>` and, on POST, `content-type: application/json`. Provider-level and envelope `extraHeaders` are not sent. *Why:* the only permitted destination is the OpenRouter gateway, which needs only the bearer. | 2-1 |
| C10 | **Credential check order:** not found → provider missing → `management` → not `api_key` → not OpenRouter → `unavailable_since`. Class refusals come first, as at `modelCatalog.ts:175`. The gateway URL is a parameter of the pure check, so `openrouterKeys.ts` stays its only home. An envelope without `baseUrl` passes. | 2-1 |
| C11 | **Shared contracts are owned by labelled block, appended in task order:** 2-1 transport vocabulary; 2-2 store and settings; 2-3 service contract (error codes, request schemas, `tierResultSchema`, refresh result, progress event, status); 2-4 IPC only (channel names, `RoutingReply`, `RoutingApi`, request wrappers). *Why:* the service in 2-3 emits and returns these shapes and its tests validate them; defining them in 2-4 would give one type two homes. | all |
| C12 | **"Never deleted" applies to reads.** A read of an invalid file warns once per file per process and returns empty; the next successful write replaces the file atomically. A missing file is not a warning. *Why:* the store holds re-fetchable public metadata; preserving corrupt copies would need its own retention. | 2-2 |
| C13 | **Observation bound:** after pruning to `observationMaxAgeDays`, keep the newest 400 per tag (7 days × 48 ticks = 336, plus refresh headroom), deduplicated by (tag, `observedAt`). | 2-2 |
| C14 | **Directory names percent-encode the slug:** every byte outside `[a-z0-9-.]`, and a leading or trailing `.`, becomes `%XX`, so the mapping is injective (`deepseek/deepseek-v4.1-flash` → `deepseek%2Fdeepseek-v4.1-flash`). Account files are `account-<uuid>.json`. Credential ids are UUIDs (`vault.ts:144`, `z.uuid()` as `shared/ipc.ts` already uses). | 2-2 |
| C15 | **Account eligibility is replaced per refresh**, nulls included, with `checkedAt` = the refresh time. *Why:* the ranker should report the latest check (Phase 1 K3); keeping an old "checked" result would hide a guardrail change. | 2-3 |
| C16 | **Failure policy inside a refresh.** The endpoints GET failing fails the refresh (`FETCH_FAILED`). A preflight transport failure nulls that list and continues. `auth-failed` or `rate-limited` on any preflight or probe call stops every further key-bearing call in that refresh (remaining tags `aborted`); the refresh still returns tiers. | 2-3 |
| C17 | **Pre-network refusals emit no progress events.** Validation, unknown model, busy, credential refusal and decrypt failure return an error only; events start with the first network step and always end with exactly one terminal event. | 2-3 |
| C18 | **The refresh returns** `{ refreshId, estimateUsd, spentUsd, probed, notProbed, result: TierResult }`, not a bare `TierResult`, so spend travels on the reliable channel (MR-G7). | 2-3 |
| C19 | **The observer re-arms one `setTimeout`** at each tick's start for +30 minutes, and keeps running while dormant (a dormant tick reads only the observation setting). One decrypt per tick covers every due model. | 2-3 |
| C20 | **`requestsSinceStart`** in `status()` counts every OpenRouter request the service started. The zero-cost CDP drive asserts it stays 0; that, plus no snapshot file, is the "no network" proof. | 2-3, 2-4 |
| C21 | **Test and verification knobs** `probeTagLimit`, `probeCapUsd` and `probeConcurrency` are constructor options only, never reachable from IPC; production uses the defaults ($0.05, 5). The live script passes `probeTagLimit: 2, probeCapUsd: 0.025`. | 2-3 |
| C22 | **Wiring lives in `src/main/index.ts` only.** `registerRoutingIpc({ service, observer })` runs right after `registerIpc(...)`, which gains no 20th parameter. `routingObserver?.stop()` and `routing?.dispose()` run at the **top** of `before-quit`, before the Team-shutdown branch (both idempotent), so no routing request starts once quitting begins. | 2-4 |
| C23 | **IPC error mapping:** an input `ZodError` is `INVALID_REQUEST`; an output `ZodError` is `OPERATION_FAILED` (a main-side bug, not the caller's). Teams maps both to `INVALID_REQUEST`. | 2-4 |
| C24 | **The CDP drive launches the built app itself** (`npx electron-vite build` first) with a throwaway `--user-data-dir` and a free CDP port, as `verify-team-packaged-ui.mjs` does. This sidesteps two traps: a long-lived dev instance holding 9222, and dev never rebuilding MAIN on edit. | 2-4 |

## Sequence and file ownership

Execute 2-1 → 2-2 → 2-3 → 2-4. Task 2-2 does not depend on 2-1 and could run in parallel, but is scheduled second. Ownership is disjoint by file, and by labelled block in `src/shared/routing.ts` and `src/shared/routing.test.ts` (C11). A downstream task that needs an upstream change records it in its report and makes it in the upstream file with a test; it does not work around it.

| Task | Deliverable | Depends on | Files owned |
|---|---|---|---|
| [2-1](Task-2-1.md) / [spec](../ImplementationSpecs/ImplementationSpec-2-1.md) | OpenRouter routing transport and parsers | Phase 1 | `src/main/routing/preflightCore.ts`, `cacheProbeCore.ts`, `routingCredentialCore.ts` and their tests; `src/main/routing/__fixtures__/preflight-guardrails-2026-10-02.json`, `preflight-data-policy-2026-10-02.json`; `src/main/services/routingClient.ts` and test; `export` on `readCapped` in `modelCatalog.ts`; the transport-vocabulary block of `src/shared/routing.ts` and its tests |
| [2-2](Task-2-2.md) / [spec](../ImplementationSpecs/ImplementationSpec-2-2.md) | Routing store and settings | Phase 1 | `src/main/routing/storeCore.ts` and test; `src/main/services/routingStore.ts` and test; the store-and-settings block of `src/shared/routing.ts` and its tests; two keys, two imports and four methods in `src/main/services/storage.ts` |
| [2-3](Task-2-3.md) / [spec](../ImplementationSpecs/ImplementationSpec-2-3.md) | `RoutingService`, observer and the live check | 2-1, 2-2 | `src/main/services/routingService.ts`, `routingObserver.ts` and their tests; the service-contract block of `src/shared/routing.ts` and its tests; `scripts/verify-routing-phase2-live.mjs`, `scripts/verify-routing-phase2-live.ts` |
| [2-4](Task-2-4.md) / [spec](../ImplementationSpecs/ImplementationSpec-2-4.md) | IPC, preload and app wiring | 2-3 | `src/main/services/routingIpc.ts` and test; the IPC block of `src/shared/routing.ts` and its tests; `src/preload/index.ts`; `src/main/index.ts`; `scripts/verify-routing-ipc.mjs` |

No new dependencies. Each task commits only its own files.

## Gates

| Gate | In Phase 2 |
|---|---|
| MR-G1 | Every task: `npm run typecheck` and `npm test` pass. Tasks 2-1 and 2-2 have runtime evidence through tests over the real 2026-10-02 bodies and real temp-directory I/O. Task 2-3 adds the live refresh and tick (≤ 3¢). Task 2-4 adds the zero-cost CDP drive of the built app. |
| MR-G4 | The key exists only inside `RoutingService.refresh` and `observe`, from one decrypt to the end of that call. Tests prove refusals happen before decrypt, one decrypt per refresh or tick, and that the fake key never appears in a request URL, store file, progress event, result, error or log call. `npm run grep:secrets` is clean. |
| MR-G5 | Zod lives in shared schemas used by main only; the preload has none. Every input and output is parsed in main; broadcasts are parsed before sending. The CDP drive proves plain-object payloads cross the bridge, with a Proxy negative control. |
| MR-G7 | The `probe-plan` event carries the worst-case estimate and is emitted before the first probe request (asserted by a shared sequence counter); `done` and the refresh result carry actual spend. The live script prints both and asserts ≤ $0.03. |
| MR-G8 | The new cores are pure: no clock, randomness or I/O, so the purity grep stays empty. The ranker is untouched and `node scripts/verify-routing-ranker.mjs` still passes. |

Not applicable: MR-G2 (no change to how OpenCode config is generated), MR-G3 (no script launches OpenCode), MR-G6 (no migration; MR-D20 keeps v28 for Phase 4).

## Risks

- **D60 is widened, not just D58.** MR-D18 class 2 is the first unattended decrypt of an `api_key`-class credential. D60 restated the guarantee by class ("no code path reachable without a user gesture may resolve a LAUNCH credential") and its probe asserts zero non-management decrypts across a boot. Designation (MR-D19) is the gesture that authorises later ticks, the first tick fires 2 minutes after start (outside the boot window), and the key never reaches a child process; but the sentence no longer holds for the app's lifetime. D214 must restate it with this one exception, and must name the class and reachability condition rather than a call-site count (D60's standing lesson). Task 2-3's tests are the discriminating probe: decrypts only of the designated id, none while dormant.
- **Unversioned error message.** The preflight parses free text. C2 turns any drift into `null` (Phase 1 K3), and the live script fails loudly if today's message no longer parses.
- **Funnel semantics are inferred.** Row counting (C1) rests on one shared-tag case. If OpenRouter ever lists a multi-row tag once per row, the distinct-tag sum still holds.
- **Probe spend.** The estimate uses `cost.promptPerM` and `completionPerM` resolved at `now` with the profile's `typicalPromptTokens`, so a `min_prompt_tokens` override could misprice a ~4.5k-token probe. A provider billing more than 64 output tokens would exceed the estimate (Baidu's measured spend was within 3% of it). The actual-spend stop bounds overshoot to the tags already in flight (at most 5).
- **Cache verification is one sample.** `baseten/fp8` and `morph/fp8` only hit on call 3, which fits several backends behind one tag; a later probe may flip the result.
- **A 10 s timeout** can make a slow probe call inconclusive; inconclusive writes nothing, so the tag is re-probed next refresh.
- **Shared dev profile.** Dev worktrees share `%APPDATA%\chorus`, so two dev instances share `routing/`. Renames keep files whole and temp names carry the pid, but one instance's append can overwrite the other's. Acceptable for dev; the installed app has its own profile.
- **Clock moving backwards** makes a stored snapshot "after now"; `tiers()` returns `INVALID_TIME` until the next refresh.

## Handoff to Phase 3

Phase 3 builds UI on these channels and shapes (all in `src/shared/routing.ts`):

- `routing:models`, `routing:tiers` (cheap; no network) and `routing:refresh` (spends up to 5 cents). Show the `probe-plan` estimate as soon as it arrives and the `done` spend after; never start a refresh without a user action.
- The designation UI writes `routing:observation-set` (MR-D19). Offer only OpenRouter API-key credentials, filtered as `teamMemberProfiles.ts:15` does; a refused designation returns `CREDENTIAL_REFUSED` with a message to show.
- Routing settings and the data-collection opt-in write `routing:settings-set`; the response is what was stored.
- Every payload is built from a JSON snapshot of reactive state, never a Pinia proxy (D14).
- Phase 1 carry-overs still apply: there is no structured field for W3, and the Budget-floor and rationale formatting notes in the roadmap.

Phase 4 needs: a refresh with the launch's own credential before a launch whose snapshot is older than `snapshotMaxAgeMinutes`; guardrail revalidation after an access failure (a refresh does it); a way for launch handlers to reach `RoutingService` (it is constructed in `index.ts`).

## Verification and completion

Each task runs its own commands. At phase end, from the repository root:

```powershell
npm run typecheck
npm test
Get-ChildItem -Path src/main/routing, src/shared/routing.ts -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern 'Date\.now\(|Math\.random\(|new Date\(\)|from ''(node:|fs''|path''|electron|better-sqlite3)|require\('
Get-ChildItem -Path src/main/routing -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern "from '\.\./(services|db|adapters)/"
node scripts/verify-routing-ranker.mjs
npx electron-vite build
node scripts/verify-routing-ipc.mjs
npm run grep:secrets
git diff --check
git status --short
```

Both `Select-String` lines must print nothing (both were empty at `a9842a5`). The live check, `node scripts/verify-routing-phase2-live.mjs`, spends real credit: run it once, in Task 2-3, and paste its output. `npm run grep:secrets` scans `_verify/` too, so run it after the scripts have deleted their bundles. `git status --short` must still show the pre-existing entries above, unchanged. Record actual exit codes and output; a passing subset is not a full-suite pass.

**Driving the dev app by hand** (not required by any gate): `$env:REMOTE_DEBUGGING_PORT='9333'; npx electron-vite dev -- "--user-data-dir=<throwaway>"`. Use 9333 in a worktree; use 9222 in the main checkout only after `http://127.0.0.1:9222/json/version` shows no other instance holds it. Dev never rebuilds MAIN on edit, so kill and relaunch before measuring a main-process change.
