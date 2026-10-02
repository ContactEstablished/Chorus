# Model Routing Phase 1 — execution prompt

Paste everything below into a new Claude Code session opened at the repository root.

---

## Role

You are the Coordinator for Chorus Model Routing Phase 1 (pure ranker). Repository root: `C:\Projects\ContactEstablished\Chorus`. Expected branch: `feature/model-routing`. HEAD should be the commit that added this prompt, directly on top of `e364404` ("Kick off Model Routing Phase 1: pure ranker task docs and specs"). Confirm with `git branch --show-current` and `git log --oneline -3`, and do not switch branches without instruction.

Chorus is a local-first Electron + Vue 3 + TypeScript desktop app. Read `CLAUDE.md` first: the stack is locked, and you must ask before adding any dependency.

## Goal

Build a pure TypeScript ranker. `computeTiers(input)` takes:

- an OpenRouter endpoints snapshot and the observation history
- a model registry entry
- account eligibility and cache-verification results
- a workload profile (`'interactive'` or `'helper'`) and a reasoning effort
- settings and the current time

It returns the Budget, Balanced, Fast and Nitro selections (OpenRouter `provider` objects) plus an explanation of every endpoint, all as plain JSON.

**Prime constraint: the phase is pure.** It makes no network calls and touches no IPC, preload, renderer or UI, storage, migrations, OpenCode config, adapters or launch code. Those belong to Phases 2–4.

## Ground yourself first

Read these before editing, in this order:

1. `CLAUDE.md`.
2. `docs/Features/Model Routing/roadmap.md`. It is authoritative for decisions MR-D1 to MR-D17 and gates MR-G1 to MR-G8; Phase 1 scope is its "Phase 1 — Pure ranker" section.
3. `docs/Features/Model Routing/Tasks/Phase-1-Overview.md`. It holds the kickoff decisions K1–K12 (resolved 2026-10-02), the clarifications C1–C10 (accepted 2026-10-02), the grounding table, the golden expectations, the risks and the handoff to Phase 2.
4. `docs/Features/Model Routing/Tasks/Task-1-1.md`, `Task-1-2.md` and `Task-1-3.md`, each with its paired `docs/Features/Model Routing/ImplementationSpecs/ImplementationSpec-1-1.md`, `-1-2.md` or `-1-3.md`. **The specs are normative:** exact contracts, function signatures, reason strings, warning templates, test tables and golden numbers.
5. Background evidence only:
   - `docs/Features/Model Routing/Phase-0-Findings.md`
   - §5 (action items) of `docs/Features/Model Routing/CouncilBrief-MR-1.0-RankerPolicy-Findings.md`
   - §6–§13 of `docs/Features/Model Routing/Plan_1.md`

   The roadmap and the K-rules win on any conflict. In particular, K9 replaces Plan_1 §13's comparator, which is not transitive.

**Code conventions (verified 2026-10-02):**

- **Tests:** `vitest.config.ts` includes `src/**/*.test.ts` with no globals, so import `{ describe, it, expect }` from `'vitest'` explicitly. Tests must never import `storage.ts` or `better-sqlite3`, because the native module is built for Electron's ABI.
- **Fixtures:** read them as `src/main/services/codeIndexCore.test.ts:64` does: `readFileSync(join(__dirname, '__fixtures__/<file>'), 'utf8')`.
- **JSON imports in main:** `src/main/services/logger.ts:2` (`import secretPatterns from './secret-patterns.json'`).
- **Pure logic:** goes in `*Core.ts` modules with colocated tests (e.g. `src/main/services/modelCatalogCore.ts`, `teamCore.ts`).
- **Shared contracts:** use Zod 4.4.3 in `src/shared/*.ts` (e.g. `src/shared/team.ts`). Both the node and the web tsconfig compile `src/shared/**`, so shared files must not import Node modules.
- **Scripts:** bundle TypeScript with esbuild the way `scripts/verify-routing-body.mjs:20` does: build into the git-ignored `_verify/`, run under node, then delete the bundle.

**The golden fixture** is at `docs/Features/Model Routing/fixtures/endpoints-deepseek-v4.1-flash-2026-10-02.json`. Task 1-1 moves it with `git mv` to `src/main/routing/__fixtures__/` and updates its two links in `docs/Features/Model Routing/roadmap.md` (lines 134 and 158).

**Before any edit,** run `git status --porcelain` and `git log --oneline -3`. Re-verify any line number you rely on; they drift.

## Pre-existing changes: do not revert, stage, commit or overwrite

At kickoff `git status --porcelain` showed exactly:

```
 M .mcp.json
 M docs/Features/Engine/chorus-engine-spec.md
 M electron-builder.yml
 M package.json
?? docs/troubleshooting/Codex-Lead-Troubleshooting-Handoff-2026-09-30.md
?? docs/troubleshooting/Compatibility-Report.md
?? docs/troubleshooting/Evaluation-Report.md
?? docs/troubleshooting/Implementation-Progress.md
?? docs/troubleshooting/Team-Nitro-Efficiency-Reboot-Handoff-2026-10-01.md
?? docs/troubleshooting/Team-Session-GPT-Troubleshooting-Plan-2026-10-01.md
?? docs/troubleshooting/Usage.md
```

The four ` M` files have no content diff (stat-only). The repository is **public** on GitHub, so always stage explicit paths and never use `git add -A` or `git add .`.

## Implementation scope

Execute the tasks in order: 1-1, then 1-2, then 1-3. Their files don't overlap. If a downstream task needs a change to an upstream contract, make it in the upstream file, add a test, and record it in your report.

### Task 1-1 — Contracts, registry, endpoint normalisation and pricing

**Files owned:**

- `src/shared/routing.ts` and `src/shared/routing.test.ts`
- `src/main/routing/model-registry.json`
- `src/main/routing/registryCore.ts`, `endpointsCore.ts` and `pricingCore.ts`, each with its `.test.ts`
- the fixture `git mv`, and the two link targets in the roadmap

**Rules:**

- **K1, K2:** placement, and plain-JSON output.
- **K4, profiles:**

  | Profile | N | Token shares (fresh / cached / output) | `typicalPromptTokens` | `minMaxCompletion` |
  |---|---|---|---|---|
  | interactive | 300 | 0.057 / 0.932 / 0.011 | 113651 | 65536 |
  | helper | 460 | 0.038 / 0.957 / 0.005 | 178058 | 64000 |

- **K8, tag collapse:** the two `baseten/fp8` rows become one candidate with conservative values.
- **K11, pricing overrides**, per OpenRouter's documented rules:
  - times are HHMM UTC; the start is inclusive and the end exclusive, and a window whose end is not after its start wraps past midnight;
  - `utc_days` scopes the window; C4 tests it against `now`'s UTC weekday;
  - `min_prompt_tokens` applies only when prompt tokens are strictly greater;
  - when several entries apply, later entries win per key, and absent keys inherit the base price.
- **Blended $/M** = fresh × prompt + cached × (cache verified ? cache-read : prompt) + output × completion.

### Task 1-2 — Eligibility, smoothing and ranking

**Files owned:** `src/main/routing/eligibilityCore.ts` and `rankerCore.ts`, with their tests.

**Rules:**

- **Hard gates:** 1-day uptime ≥ 99.5, 5-minute uptime ≥ 95 (a missing 5-minute value passes, C2), status 0, and removal by account guardrail or by data policy under `'deny'` (C3).
- **K6, hysteresis:** if any of the ≤ 6 newest observations had 1-day uptime below 99.5, re-admission needs ≥ 99.6.
- **Undeclared quantization** is excluded unless the provider is first party or has an unexpired verification for that exact tag (MR-D7).
- **K7, smoothing:** the median of the ≤ 6 newest positive values. Fewer than 3 marks the candidate `limitedHistory`, but every gate still applies.
- **Scoring:** effective throughput is `N / (latencyP50S + N / tpsP50)`, and the score is `w·ln(tps_eff) − (1−w)·ln(blended)` with w = 0.30 / 0.50 / 1.00.
- **K10, Budget floor:** `max(30, 0.5 × median eligible p50)`.
- **K9, tie-break:** candidates within ln(1.01) of a cluster's top score are ordered by higher uptime, then lower latency, then lower cost, then tag ascending.
- **Nitro's likely endpoint** is chosen as the specification says.
- **Reason strings** are exact, and percentages in them are truncated, never rounded (C1).

### Task 1-3 — Payloads, `computeTiers` and the golden run

**Files owned:** `src/main/routing/payloadCore.ts` and `routingCore.ts`, with their tests, and `scripts/verify-routing-ranker.mjs`.

**Rules:**

- **K12, payloads:**
  - Budget, Balanced and Fast send `{ order: [tags], allow_fallbacks: false, require_parameters: true, quantizations, data_collection: 'deny' }`, and never a `sort` or `preferred_*` key.
  - Nitro sends `<slug>:nitro` with `{ data_collection: 'deny' }`, or a `null` provider under `'allow'`.
- **C8:** `quantizations` are the declared row values.
- **K3:** if guardrails are unknown, the result says `'unknown'` and carries a warning, and ranking still runs.
- **K7:** a snapshot older than 60 minutes is stale.
- **C9:** `fetchedAt` later than `now` throws `RangeError`.
- **Warnings and rationale** follow the specification's templates exactly.

## Golden expectations

These must match exactly; they were computed twice, independently, at kickoff.

**Input:**

- the fixture;
- history = the single observation extracted from the snapshot at its `fetchedAt` (`2026-10-02T09:05:00Z`);
- `now` = `2026-10-02T09:20:00Z`, effort `'low'`;
- account = `{ guardrailRemoved: ['deepseek'], dataPolicyRemoved: ['deepseek'], checkedAt: '2026-10-02T09:15:39Z' }`;
- cache = the fixture's `cacheVerified`;
- default settings.

**In both profiles:** 32 candidates, of which 14 are eligible and 18 excluded. The median eligible p50 is 90.5 tps and the Budget floor is 45.25. Nitro's likely endpoint is `together` (223 tps), failing `quantization not declared`.

| Profile | Budget | Balanced | Fast |
|---|---|---|---|
| interactive | deepinfra/fp8 → streamlake/fp8 → gmicloud/fp8 | deepinfra/fp8 → streamlake/fp8 → makora/fp8 | venice/fp8 → baidu/fp8 → parasail/fp8 |
| helper | streamlake/fp8 → deepinfra/fp8 → gmicloud/fp8 | streamlake/fp8 → venice/fp8 → gmicloud/fp8 | venice/fp8 → baidu/fp8 → parasail/fp8 |

The specs carry the per-candidate numbers and the exact exclusion table; numbers match to a relative tolerance of 1e-4. If the code disagrees, re-check the code against the K-rules and report what you found. **Never edit an expectation to make a test pass.**

## Strict non-goals

- No network calls or `fetch`.
- No IPC or preload.
- No renderer or settings UI.
- No storage, migrations or database schema.
- No OpenCode config, `OPENCODE_CONFIG_CONTENT`, adapter or launch changes.
- No p90 scoring, EWMA smoothing or provider/region diversity (all Phase 5).
- No edits to `Plan_1.md`, `Phase-0-Findings.md` or the council documents. The roadmap changes only by Task 1-1's two fixture links, plus the final status update below.
- No new dependencies.
- Do not touch the pre-existing changes listed above.
- Do not work on roadmap items MR-D16 (OpenCode's remembered TUI variant) or MR-D17 (behaviour when the primary endpoint is down). They are open, but outside Phase 1.

## Required workflow

Use the coordinator pattern for each task, in this order:

1. Dispatch an implementation worker (a subagent) with the task doc and its spec.
2. Run a spec-compliance review: does the code match the spec's contracts, reason strings and test tables?
3. Run a code-quality review.
4. Resolve the findings.
5. Run the task's verification commands.
6. Make one intentional commit for the task, staging explicit paths. The message is a title, a plain-language summary and technical bullets, and it ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

Do not push or open a PR unless explicitly asked.

**Notes for this Windows machine:**

- The Bash tool can collapse backslashes in quoted heredocs, so write scripts with the file-write tool and run them by path.
- After editing an existing file, check `git diff --stat` for an unexpected whole-file line-ending rewrite.

## Verification commands

Run these from the repository root, in PowerShell:

```powershell
npm run typecheck
npx vitest run src/main/routing src/shared/routing.test.ts
npm test
node scripts/verify-routing-ranker.mjs
Get-ChildItem -Path src/main/routing, src/shared/routing.ts -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern 'Date\.now\(|Math\.random\(|new Date\(\)|from ''(node:|fs''|path''|electron|better-sqlite3)|require\('
npm run grep:secrets
git diff --check
git status --short
```

- **`node scripts/verify-routing-ranker.mjs`** exists only after Task 1-3. It is the "run, don't just compile" gate (MR-G1). It runs `computeTiers` on the real fixture for both profiles and prints a table. It must end with `PASS (n checks)`, exit 0, and leave no `_verify/routing-ranker-*.cjs` behind.
- **The `Select-String` purity check** (MR-G8) must print nothing. It also matches comments, so describe the purity rule in comments without those literal tokens.
- **`npm run grep:secrets`** is slow because it also scans `_verify/`. It must report clean; run it after the verify script has cleaned up.
- **`npm test`** must pass the whole suite, not a subset.
- **`git status --short`** must still show the pre-existing entries unchanged.

## Failure honesty

If a verification command fails for an unrelated environment reason, capture the exact output, explain it, and do not claim success. A passing subset is not a full-suite pass. Never weaken a test or an expectation to get a green result.

## Final report

Report:

- **Status:** DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT or BLOCKED.
- **Files changed** in each task, with commit SHAs.
- **Check results:** the typecheck result and the vitest summary line, plus the verify script's full output and exit code.
- **Purity check and secret scan** results.
- **Reviews:** spec-review and code-quality outcomes, and how each finding was resolved.
- **Non-goals:** confirmation that every one was respected.
- **Contract changes:** any corrections made between tasks.
- **Residual risks.**
- **Final state:** the output of `git status --short`.

Then, only if the evidence is present, update `docs/Features/Model Routing/roadmap.md` (the Phase 1 row and section) and each task doc's **Status** line, and commit those doc updates separately.
