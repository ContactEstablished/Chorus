# Task 2-1 — OpenRouter routing transport and parsers

**Status:** Complete 2026-10-02 (`17c7d72`).\
**Depends on:** Phase 1 complete (`e141094`, `9c6bb9e`, `bd075ba`).\
**Paired specification:** [ImplementationSpec-2-1](../ImplementationSpecs/ImplementationSpec-2-1.md)

## Source Of Truth

[Feature roadmap](../roadmap.md) (MR-D9, MR-D12, MR-D14; gates MR-G1, MR-G4, MR-G8), user decision MR-D18 as recorded in the [Phase 2 overview](Phase-2-Overview.md) (with K1–K4, C1–C11), the paired specification, [Phase-0-Findings.md](../Phase-0-Findings.md) (new findings 1–2, council follow-up table), Foundation roadmap D33, D58 and D60, and repository CLAUDE.md. Where [Plan_1](../Plan_1.md) differs, the roadmap and the overview win.

## Initial Starting Point

Branch `feature/model-routing` at `a9842a5`, verified 2026-10-02 by reading each file.

- No routing code calls OpenRouter. The only key-bearing GET is `refreshProviderModels` (`src/main/services/modelCatalog.ts:161`): management refused first (:175), `unavailableSince` refused by label (:186), one decrypt (:196), the key only in `authorization` (:221), a fetch exception becomes `unreachable` (:231), non-2xx cancelled unread (:243), 2xx read through the private `readCapped` (:124, :251). `FetchResponseLike` (:50), `FetchInitLike` (:61, no `body`) and `FetchLike` (:67) are exported.
- `REFRESH_FAILURE` is the precedent vocabulary (`modelCatalogCore.ts:107`); `scrubSecrets` is at `logger.ts:81`; the gateway address has one home, `OPENROUTER_GATEWAY_BASE_URL` (`openrouterKeys.ts:53`).
- The OpenRouter-API-credential predicate is `authMode === 'api_key'` plus a trailing-slash-normalised `baseUrl` equal to the gateway (`teamMemberProfiles.ts:15`, :41). `vault.decryptForLaunch` (`vault.ts:244`) does not check `unavailableSince`; callers must refuse first.
- `parseEndpointsResponse` (`src/main/routing/endpointsCore.ts:75`) throws on a bad envelope (:77). `byCodeUnit` is exported from the same file.
- Phase 0's preflight body is `verify-routing-live.ts:63`; its cache probe is :77–93 (220 filler lines, `max_tokens: 64`, 1.5 s gaps, batches of 5). The real 404 bodies are in `%TEMP%\chorus-routing-live-MDU7qB\report.json` and `chorus-routing-live-A9VBtp\report.json`; the specification carries them verbatim.
- `modelCatalog.test.ts` shows the stub style: the fake key built by concatenation (:25), `okVault` (:52), `forbiddenVault` (:64), `stubResponse` (:76).
- The Phase 1 purity grep and the layering grep both print nothing. The worktree has the pre-existing changes listed in the overview.

## Goal

Make the three key-bearing request shapes of MR-D18 (the endpoints GET, the two preflights, a probe call) available as a stateless, size-capped, time-bounded transport that returns only fixed vocabulary, numbers and validated tags; and the pure logic around them: the preflight parser, the cache-probe planner and evaluator, and the pre-decrypt credential predicate.

## Exact Scope

- `src/shared/routing.ts`: append the "Phase 2 — transport vocabulary" block (tag pattern, failure vocabulary and messages, preflight steps and issues, probe outcomes and skip reasons). `src/shared/routing.test.ts`: append table S2.
- `src/main/routing/preflightCore.ts` and test: request body, `rowsPerTag`, `parsePreflight`.
- `src/main/routing/cacheProbeCore.ts` and test: probe constants, prompt and body, estimate, `planCacheProbe`, usage extraction, evaluation and spend.
- `src/main/routing/routingCredentialCore.ts` and test: the pre-decrypt predicate, the envelope base-URL check and the refusal messages.
- `src/main/routing/__fixtures__/preflight-guardrails-2026-10-02.json` and `preflight-data-policy-2026-10-02.json`, verbatim from the specification.
- `src/main/services/routingClient.ts` and test: `fetchRoutingEndpoints`, `sendRoutingPreflight`, `sendRoutingProbeCall`.
- `src/main/services/modelCatalog.ts`: add `export` to `readCapped` (:124). Nothing else in that file.

## Non-Goals

No decrypting, storing, scheduling, IPC or service (Tasks 2-2 to 2-4); this task's functions receive a key from their caller and hold nothing. No live network call, not even a free one. No renderer, launch, OpenCode config, adapter or Team changes (Phases 3–4). No migration or schema change. No edit to an existing export of `src/shared/routing.ts` or `src/main/routing/*`, or to the golden fixture. No edits to Plan_1, Phase-0-Findings, the council documents or the roadmap. No new dependencies. No p90, EWMA or diversity work (Phase 5); MR-D16 and MR-D17 untouched. Do not touch, stage or revert the pre-existing modified and untracked files.

## Dependencies

Phase 1 only. Task 2-3 consumes every export; a later correction is made here, with a test, and recorded in that task's report.

## Step-by-step Work

1. Re-run `git status --short` and record the pre-existing entries.
2. Append the transport-vocabulary block to `src/shared/routing.ts` exactly as specified; import nothing new.
3. Write both fixtures verbatim. Check each parses as JSON and that each Fallback clause's tags plus `deepseek` equal the golden fixture's 32 tags.
4. Write `preflightCore.ts`, following the eleven parsing rules in order.
5. Write `cacheProbeCore.ts`. The filler must reproduce Phase 0's text byte for byte (B1's SHA-256). The planner takes `now` and the cache as parameters.
6. Write `routingCredentialCore.ts` with structural row types; do not import `db/schema`, `vaultCore` or `shared/ipc`.
7. Add `export` to `readCapped` in `modelCatalog.ts` and confirm `git diff --stat` shows one changed line.
8. Write `routingClient.ts` with the narrated file header (third key-bearing call class, MR-D18) and the body-handling table.
9. Write the tests in tables S2, P, Q, E, B, K and T, then run the verification commands.

## Test Expectations

- **Preflight:** the real bodies give `['deepseek']` for guardrails (with and without `Apply Status Sorting`) and for data policy under deny; guardrails read from the deny body give `[]` (documented, never used); nested parentheses, multi-tag clauses, row weighting, count mismatch, non-404, missing funnel, missing marker, unbalanced reason, bad and key-shaped tags, step mismatches and funnel drift each give the specified result.
- **Probe planning:** on the golden fixture with an empty cache, all 14 eligible tags are planned in Balanced order for $0.0493873956; a $0.02 cap plans 7 for $0.017288676; a limit of 2 plans `atlas-cloud/fp8` and `morph/fp8` for $0.002497428; fresh records plan nothing; the 14-day boundary is exclusive.
- **Evaluation:** the four real Phase 0 sample sets give `verified`, `not-cached`, `verified`, `verified` with the recorded spends; missing fields and failed calls are inconclusive.
- **Credentials:** each refusal in its order; trailing slash accepted; case not folded; management refused even when also unavailable.
- **Transport:** exact URLs, headers and bodies; caps enforced by cancelling the reader; every non-2xx cancelled unread except the preflight 404; the fake key never appears in a URL or a result, even when a body or an exception echoes it.

## Verification Commands

Run from the repository root after creating the task's files.

```powershell
npm run typecheck
npx vitest run src/main/routing src/main/services/routingClient.test.ts src/main/services/modelCatalog.test.ts src/shared/routing.test.ts
npm test
Get-ChildItem -Path src/main/routing, src/shared/routing.ts -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern 'Date\.now\(|Math\.random\(|new Date\(\)|from ''(node:|fs''|path''|electron|better-sqlite3)|require\('
Get-ChildItem -Path src/main/routing -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern "from '\.\./(services|db|adapters)/"
node scripts/verify-routing-ranker.mjs
npm run grep:secrets
git diff --check
git status --short
```

Both `Select-String` lines must print nothing (MR-G8, K1). The ranker script must still print `PASS (30 checks)`. `git status --short` must show ` M src/main/services/modelCatalog.ts`, ` M src/shared/routing.ts`, ` M src/shared/routing.test.ts`, the new files, and the pre-existing entries unchanged. Record actual exit codes.

## Acceptance Criteria

- The shared block exports every name in the specification; no existing export changed; both typechecks pass.
- P1–P27 pass, including the real bodies and the nested-parenthesis, row-weighting and key-shaped-tag cases.
- Q1–Q9, E1–E11 and B1–B3 pass with the stated values.
- K1–K11 pass; the core imports nothing outside `zod`, shared routing and sibling cores.
- T1–T20 pass; no request URL or result contains the fake key; every non-2xx body other than the preflight 404 is cancelled unread.
- `modelCatalog.ts` differs by one line; its tests pass unchanged.
- `npm test` and `npm run grep:secrets` pass; both greps print nothing; the ranker script passes; the pre-existing worktree entries are untouched.

## Review Checklist

- [ ] The parser's rules run in the specified order, and only the target step is count-checked (C1, C2).
- [ ] A parse failure is always `null` with an issue, never an empty list.
- [ ] The probe prompt is Phase 0's measured shape, and the estimate uses 4,500 tokens (C4).
- [ ] No core reads the clock or randomness; the nonce and `now` are parameters.
- [ ] The client sends only `accept`, `authorization` and, on POST, `content-type` (C9), and returns nothing derived from a body except tags, numbers and fixed vocabulary.
- [ ] The file header of `routingClient.ts` narrates MR-D18's constraints the way `modelCatalog.ts` narrates D58.
- [ ] Changes are limited to owned files; pre-existing work is preserved and not committed.
