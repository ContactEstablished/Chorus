# Task 3-2 — Renderer data layer and pure view model

**Status:** Complete 2026-10-02 (`f307b4d`).\
**Depends on:** Task 3-1 passes (`routing:credentials`, `RoutingCredential`, `ROUTING_REFRESH_COOLDOWN_MS` and `ROUTING_REFRESH_PROBE_CAP_USD` exist; the IPC drive passes 19 checks).\
**Paired specification:** [ImplementationSpec-3-2](../ImplementationSpecs/ImplementationSpec-3-2.md)

## Source Of Truth

[Feature roadmap](../roadmap.md) (MR-D10, MR-D11, MR-D19; gates MR-G1, MR-G5, MR-G7, MR-G8; the Phase 1 carry-overs "Carried to Phases 2–3" and the Phase 2 "Carried to Phase 3"), user decisions MR-D21 to MR-D24 as recorded in the [Phase 3 overview](Phase-3-Overview.md) (with K2–K9 and C5–C14, C20), the paired specification, [Plan_1](../Plan_1.md) §2 "UI details" for wording and empty states (the overview wins where they differ), Foundation roadmap D14, and repository CLAUDE.md (plain-object payloads, snapshot first, runtime-verify).

## Initial Starting Point

Branch `feature/model-routing` with Task 3-1 landed on `5079b5d`. Facts verified 2026-10-02 at `5079b5d`:

- No renderer code uses routing. `window.chorus.routing` is typed through `src/preload/index.d.ts` (`chorus: ChorusApi`), so the store needs no declaration.
- `stores/team.ts` is the store precedent: `plainTeamInput` (:4), `teamValue` (:5, which throws a plain `Error` and loses the code), a module-level, reference-counted `connect()` (:14–23). `team.test.ts` stubs `window` with `vi.stubGlobal` (:12) under `setActivePinia(createPinia())` (:8).
- `stores/council.ts` adopts a broadcast id only while its own run is in flight and none is bound (:292–297).
- `TierResult` (`src/shared/routing.ts:289`) carries `snapshotFetchedAt`, `stale`, `budgetFloorTps`, `candidates[].excludedBy`, `budgetFloorExcluded`, `cost.cacheCredit`, `cost.overrideApplied` and `warnings`. W1 is the first warning exactly when stale (`routingCore.ts:120–122`). Uptime reasons are truncated by `truncatePct` (`eligibilityCore.ts:50–52`). The Budget floor applies to raw p50 (`rankerCore.ts:166`).
- `vitest.config.ts` runs `src/**/*.test.ts` under `environment: 'node'` (:11–12). `src/shared/**/*` is compiled by both tsconfigs, and shared tests already read the fixture from `src/main/routing/__fixtures__` (`routing.test.ts`). `SettingsAppearance.vue:3` imports a value from `shared/ipc`, so loading a shared Zod module in the renderer has a precedent.
- The worktree has the pre-existing changes listed in the overview.

## Goal

Put every decision the routing screen makes into code that runs under plain vitest: a pure view model that turns `TierResult`, progress events, status and credentials into the exact strings and states the screen shows (formatted from numbers, never from `rationale`), and a Pinia store that talks to `window.chorus.routing` with plain payloads, keeps error codes, adopts its own refresh's progress, and reloads tiers whenever they could have changed.

## Exact Scope

- `src/shared/routingView.ts` and `src/shared/routingView.test.ts` (Table RV): constants, formatters, card, Nitro, notes, table, progress, cooldown, button, credential and observation views. Imports only from `./routing`.
- `src/renderer/src/stores/routing.ts` and `src/renderer/src/stores/routing.test.ts` (Table RS): `plainRoutingInput`, `RoutingReplyError`, `routingValue`, `routingFailure`, and `useRoutingStore` with `connect`, `ingestProgress`, `load`, `loadTiers`, `loadStatus`, `selectModel`, `selectProfile`, `selectCredential`, `startRefresh`, `setDataCollection`, `setObservation`.

## Non-Goals

- No `.vue` file and no component, view, Settings or nav change (Tasks 3-3 and 3-4). No `flashSaved()` call in the store: the view calls it (K9).
- No main, preload or shared-contract change; anything missing is recorded and made in Task 3-1's files with a test.
- No Zod parsing in the renderer (C13); no clock, randomness or I/O in `routingView.ts` (the purity grep covers it, comments included).
- No timer that refreshes or reloads (K3); no ranking-knob setter (MR-D24); nothing selectable (MR-D21).
- No new dependencies (no `@vue/test-utils`, `happy-dom` or `jsdom`; K2).
- No edits to the roadmap, Plan_1 or the Phase 0–2 documents.
- Do not touch, stage or revert the pre-existing modified and untracked files.

## Dependencies

Task 3-1. Tasks 3-3 and 3-4 consume every export of both files.

## Step-by-step Work

1. Re-run `git status --short` and record the pre-existing entries. Read the Task 3-1 report for deviations.
2. Write `routingView.ts` exactly as specified, rule by rule; keep it free of `Date.now(`, `Math.random(`, `new Date()`, `require(` and `from 'node:` even in comments.
3. Write Table RV over the golden `TierResult` built in the test from the Phase 1 golden input, plus the listed variants. Every expected string is in the specification; never compute an expectation with the code under test.
4. Write `stores/routing.ts`.
5. Write Table RS with a stubbed `window.chorus.routing` whose every method is a `vi.fn` recording its argument.
6. Run the verification commands.

## Test Expectations

- **Formatting:** money, per-million prices, throughput, latency and uptime match the tables exactly; uptime equals `truncatePct(v, 2) + '%'` for every golden candidate.
- **Cards:** the golden interactive and helper cards, the no-snapshot, empty, floor-shortened, floor-emptied and single-endpoint states, all from numbers; no output string contains a `rationale`.
- **Nitro:** the label, the failing-rule warning, the softened warning, the no-likely and no-snapshot states, and the three caveats.
- **Notes:** warnings verbatim, W1 dropped only when stale.
- **Table:** 14 eligible · 18 excluded, eligible rows first in tag order, the exact cells for the listed rows.
- **Progress:** the estimate line appears with `probe-plan` and before any probe event; the spend line only with `done` or `failed` (MR-G7).
- **Store:** every payload is a plain object (not a Proxy, survives `structuredClone`, with a reactive negative control); error codes survive; progress is adopted for the right model and id only; the countdown starts only after a refresh that reached the network; settings writes are read-modify-write; observation off clears the designation.

## Verification Commands

Run from the repository root.

```powershell
npm run typecheck
npx vitest run src/shared/routingView.test.ts src/renderer/src/stores/routing.test.ts
npm test
Get-ChildItem -Path src/main/routing, src/shared/routing.ts, src/shared/routingView.ts -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern 'Date\.now\(|Math\.random\(|new Date\(\)|from ''(node:|fs''|path''|electron|better-sqlite3)|require\('
Get-ChildItem -Path src/main/routing -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern "from '\.\./(services|db|adapters)/"
Select-String -Path src/shared/routingView.ts -Pattern "from '(?!\./routing')"
Select-String -Path src/shared/routingView.ts, src/renderer/src/stores/routing.ts -Pattern '(?<!Date|JSON)\.(safeParse|parse)\('
node scripts/verify-routing-ranker.mjs
npm run grep:secrets
git diff --check
git status --short
```

All four `Select-String` lines must print nothing (the last proves no Zod parsing in the renderer, C13). The ranker script prints `PASS (30 checks)`. `git status --short` shows the four new files and the pre-existing entries unchanged. Record actual exit codes and the vitest summary. This task's runtime evidence is the store tests over a stubbed bridge with real `structuredClone`; the real bridge is exercised in Task 3-4.

## Acceptance Criteria

- `routingView.ts` exports every name in the specification, imports only from `./routing`, and passes the purity grep.
- RV1–RV21 pass with the stated strings.
- RS1–RS16 pass; no store action throws to its caller; every recorded IPC argument passes `types.isProxy(arg) === false` and `structuredClone(arg)`.
- No `.parse(` or `.safeParse(` call in either new non-test file.
- `npm test` and `npm run grep:secrets` pass; the greps print nothing; the ranker script passes; the pre-existing worktree entries are untouched.

## Review Checklist

- [ ] No string is built from `TierSelection.rationale` or W1; every number shown comes from a numeric field (K6).
- [ ] Uptime truncates like `truncatePct`; money follows C5 exactly.
- [ ] `routingValue` keeps the code; a non-reply rejection becomes `OPERATION_FAILED` with its own message (C14).
- [ ] Every renderer-to-main argument is built with `plainRoutingInput`, including the settings write whose `tierWeights` would otherwise be a nested Proxy (D14).
- [ ] The progress listener is reference-counted and adopts only for the model being refreshed while a refresh is running (K4).
- [ ] `setObservation(false, …)` always sends `{ enabled: false, credentialProfileId: null }` (MR-D23).
- [ ] Nothing refreshes or reloads on a timer (K3).
- [ ] Changes are limited to owned files; pre-existing work is preserved and not committed.
