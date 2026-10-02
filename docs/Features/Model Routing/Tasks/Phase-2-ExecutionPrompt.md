# Model Routing Phase 2 — execution prompt

Paste everything below into a new Claude Code session opened at the repository root.

---

## Role

You are the Coordinator for Chorus Model Routing Phase 2 (data and background observation). Repository root `C:\Projects\ContactEstablished\Chorus`. Expected branch `feature/model-routing`. HEAD should be the commit that added this prompt, directly on top of `c8f219c` ("Kick off Model Routing Phase 2: data and background observation"). Confirm with `git branch --show-current` and `git log --oneline -3`; do not switch branches without instruction. Chorus is a local-first Electron + Vue 3 + TypeScript desktop app. Read `CLAUDE.md` first: the stack is locked, ask before adding any dependency, all IPC is Zod-validated in main, renderer→main payloads must be plain objects (runtime-verify every new one), and keys never appear in args, logs, files or transcripts.

## Goal

Feed the Phase 1 ranker with real OpenRouter data, in the main process, with no renderer UI. A user-initiated refresh fetches OpenRouter's keyed endpoint list for one registry model, discovers the account's guardrail and data-policy removals with two zero-cost preflights, verifies prompt caching with a probe capped at 5 cents, stores everything under `userData/routing/`, and returns a `TierResult`. A background observer records the free endpoint list every 30 minutes, only after the user has designated a credential. A `routing:*` IPC surface exposes all of it, validated in main, with progress events that state the probe's cost estimate before any money is spent. **Prime constraint: this phase handles a real API key and spends real money. Every key-bearing call follows MR-D18's constraints, pure logic stays pure, and nothing reaches the renderer UI, launches, OpenCode config or the database schema.**

## Ground yourself first (read in this order)

1. `CLAUDE.md`.
2. `docs/Features/Model Routing/roadmap.md` — authoritative for MR-D1 to MR-D20 and gates MR-G1 to MR-G8. Read MR-D18 (key-bearing calls admitted, two classes, constraints), MR-D19 (designated-credential consent), MR-D20 (JSON files, no migration) and the 3-cent live-spend authorisation, all resolved by the user 2026-10-02; and the "Phase 2 — Data and background observation" section.
3. `docs/Features/Model Routing/Tasks/Phase-2-Overview.md` — grounding table (verified at `a9842a5`), user decisions, kickoff decisions K1–K10, clarifications C1–C24 (accepted 2026-10-02), file ownership, gates, risks, handoff.
4. `docs/Features/Model Routing/Tasks/Task-2-1.md` … `Task-2-4.md`, each with its paired `docs/Features/Model Routing/ImplementationSpecs/ImplementationSpec-2-1.md` … `-2-4.md`. **The specs are normative:** exact contracts, schemas, failure vocabularies, request bodies, parsing rules, test tables and expected numbers.
5. Background (never edit): `docs/Features/Model Routing/Phase-0-Findings.md`; in `docs/Features/Foundation/roadmap.md` the decision rows `| D33 |` (~line 540), `| D58 |` (~630) and `| D60 |` (~632) — MR-D18 is the numbered admission D58 requires, and it widens D60 (the observer is the first unattended decrypt of an api_key-class credential); `src/main/services/modelCatalog.ts` (the D58 key-bearing-call discipline this phase copies).

**Code conventions (verified 2026-10-02 at `a9842a5`; re-verify, line numbers drift):**

- Tests: `vitest.config.ts` has no globals; import `{ describe, it, expect }` (and `vi`) from `'vitest'`. Tests never import `storage.ts`, `vault.ts` or `better-sqlite3` (Electron ABI); use fakes and type-only imports.
- Pure logic goes in new `src/main/routing/*Core.ts` modules only; anything with I/O, timers, clock, randomness or network goes in `src/main/services/routing*.ts` (K1), so the Phase 1 purity grep over `src/main/routing` keeps printing nothing.
- Shared schemas: append to `src/shared/routing.ts` in one labelled block per task (C11); it imports only `zod`; Phase 1's existing exports never change.
- Key-shaped strings in tests are assembled by concatenation (`'sk-or-v1-' + …`), as `src/main/services/modelCatalog.test.ts:25` does, or `npm run grep:secrets` fails.
- Patterns: `src/main/services/teamIpc.ts` (modular IPC, sender-frame check, Zod in/out, `{ ok, value } | { ok:false, code, message }`) and its test's `electron` mock; council `emitProgress` in `src/main/ipc.ts` (~:3503) for broadcasts validated in main; `storage.ts` `readVoiceSettings`/`writeVoiceSettings` (~:3856–3887) for settings as one JSON value; `src/main/adapters/mcpConfigWrite.ts:79` for atomic writes; `scripts/verify-routing-live.mjs` + `.ts` for the windowless-Electron live harness; `scripts/verify-team-packaged-ui.mjs` (~:28–62) for launching the built app with a CDP port; `scripts/verify-routing-body.mjs:20` for bundling TS with esbuild into git-ignored `_verify/`.

**Before any edit,** run `git status --porcelain` and `git log --oneline -3`.

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

The four ` M` files have no content diff (stat-only). The repository is **public** on GitHub: always stage explicit paths, never `git add -A` or `git add .`.

## Implementation scope

Execute the tasks in order: 2-1, 2-2, 2-3, then 2-4. Ownership is disjoint by file, and by labelled block in `src/shared/routing.ts` (C11). If a downstream task needs a change to an upstream contract, make it in the upstream file, add a test, and record it in your report.

### Task 2-1 — OpenRouter routing transport and parsers

Files owned: `src/main/routing/preflightCore.ts`, `cacheProbeCore.ts`, `routingCredentialCore.ts` and their tests; fixtures `src/main/routing/__fixtures__/preflight-guardrails-2026-10-02.json` and `preflight-data-policy-2026-10-02.json` (content verbatim from Spec 2-1); `src/main/services/routingClient.ts` and test; the one-word `export` on `readCapped` in `src/main/services/modelCatalog.ts`; the transport-vocabulary block of `src/shared/routing.ts` and its tests.

Rules:

- **Preflight parsing (MR-D12, C1–C3):** strict, ordered rules; the reason clause can contain nested parentheses; under `data_collection: 'deny'` the Guardrails step is absent, so guardrails come only from the plain preflight and data policy only from the deny preflight; the funnel's `endpoint_count` counts endpoint **rows**, so the target step's tag count is weighted by snapshot rows per tag (`baseten/fp8` has two rows); any drift gives `null` (unknown, never "allowed"); a tag that `scrubSecrets` would change makes the list `null`.
- **Cache probe planning (MR-D9, C4–C7):** eligible tags in the refresh's own result, missing or older than 14 days; estimate per tag 3 × (prompt price × 4,500 + completion price × 64) / 1e6; Balanced-score order; the cap cut is a prefix; Phase 0's measured prompt (220 filler lines, ~4,460 tokens; the "~3,000-token" comment in `scripts/verify-routing-live.ts:77` is wrong).
- **Credential check before any decrypt (MR-D18, C10):** not found → provider missing → management → not api_key → not OpenRouter (`https://openrouter.ai/api/v1` after trailing-slash removal) → unavailable; envelope base URL must match.
- **Transport (K2, C8, C9):** base URL `OPENROUTER_GATEWAY_BASE_URL`; caps 2,000,000 (endpoints) / 65,536 (preflight 404) / 262,144 (probe); 10 s timeout; only `accept`, `authorization`, `content-type` headers; 2xx read capped; non-2xx cancelled unread except the preflight's 404; 401/403 always cancelled unread; fixed failure vocabulary; no retry, no backoff, no logging.

### Task 2-2 — Routing store and settings

Files owned: `src/main/routing/storeCore.ts` and test; `src/main/services/routingStore.ts` and test; the store-and-settings block of `src/shared/routing.ts` and its tests; in `src/main/services/storage.ts` exactly two keys (`routing_settings`, `routing_observation`), two imports and four methods (`readRoutingSettings`, `writeRoutingSettings`, `readRoutingObservation`, `writeRoutingObservation`) following the voice-settings pattern. No migration (MR-D20).

Rules: per registry model under `userData/routing/<percent-encoded slug>/`: `snapshot.json`, `observations.json` (pruned to 7 days, newest 400 per tag, deduplicated by tag + instant), `cache.json`, `account-<credential uuid>.json`; every file Zod-validated both ways; a missing/corrupt/oversized file reads as empty with one warning per file and is never deleted by a read; writes are temp file + rename; registry models only; no key, label, fingerprint or provider text in any file. Observation setting default `{ enabled: true, credentialProfileId: null }` (MR-D19).

### Task 2-3 — RoutingService, observer and the live check

Files owned: `src/main/services/routingService.ts`, `routingObserver.ts` and their tests; the service-contract block of `src/shared/routing.ts` (error codes, request schemas, `tierResultSchema`, refresh result, progress events, status) and its tests; `scripts/verify-routing-phase2-live.mjs` and `scripts/verify-routing-phase2-live.ts`.

Rules:

- **Key discipline (MR-D18):** one decrypt per refresh and per non-dormant observer tick, through one credential-resolution path; every refusal happens before the decrypt; the key is a local `const`, never stored, logged, emitted, returned, thrown or written; it leaves only in the `Authorization` header.
- **Refresh (K8, C15–C18):** fetch → store → 2 preflights → store account (replaced per refresh) → `computeTiers` → plan → emit `probe-plan` with the estimate **before** any probe request (MR-G7) → probe (≤ 5 in flight, stop starting tags once actual spend reaches the cap; `auth-failed`/`rate-limited` aborts further key-bearing calls) → recompute → `done` with actual spend; pre-network refusals emit no events; returns `{ refreshId, estimateUsd, spentUsd, probed, notProbed, result }`.
- **Observer (K7, C19):** one re-armed `setTimeout`, `unref()`ed; first tick 2 minutes after start, then every 30 minutes; a model with a snapshot younger than 25 minutes is skipped; single-flight per model shared with refresh (`BUSY`); dormant (no credential read, no decrypt) while disabled or undesignated; GET only, no preflight, no probe.
- **Live check (MR-G1, MR-G7): spends real OpenRouter credit — at most 3 cents (user decision, 2026-10-02).** It copies the installed OpenRouter API credential plus `Local State` into a throwaway profile under `%TEMP%`, runs one observer tick and one refresh with `probeTagLimit: 2, probeCapUsd: 0.025`, prints the estimate before probing and the actual spend after, asserts ≤ $0.03, writes its report to `%TEMP%` only, and deletes the decryptable copy afterwards. Read both script files in full before running. **Run it once.** If check L7 fails (today's preflight message no longer parses), stop and report: OpenRouter changed the format.

### Task 2-4 — IPC, preload and app wiring

Files owned: `src/main/services/routingIpc.ts` and test; the IPC block of `src/shared/routing.ts` and its tests; `src/preload/index.ts` (a type-only `RoutingApi` import and a `routing:` pass-through block, no Zod); `src/main/index.ts` (construct store/service/observer after `registerIpc(…)`, register IPC, start the observer; stop and dispose as the first statements of `before-quit`); `scripts/verify-routing-ipc.mjs`. `src/main/ipc.ts` and `src/preload/index.d.ts` are NOT edited (C22).

Rules: channels `routing:models`, `routing:tiers`, `routing:refresh`, `routing:status`, `routing:settings-get`, `routing:settings-set`, `routing:observation-get`, `routing:observation-set`, broadcast `routing:progress`; sender-frame check, then input parse, then the service, then output parse (input failure `INVALID_REQUEST`, output failure `OPERATION_FAILED`, C23); broadcasts parsed before sending; no response or event carries key material, fingerprints, envelopes, raw provider bodies or exception text. **CDP drive (MR-G1, MR-G5): zero cost.** Build first (`npx electron-vite build`); the script launches its own built app with a throwaway `--user-data-dir` and a free CDP port, exercises every channel with plain-object payloads (including a Proxy negative control that must fail with "could not be cloned"), and proves `requestsSinceStart` stays 0. It kills only its own child process by handle, never processes by name.

## Fixed expectations

Spec values must match exactly (money to 1e-12, other numbers to 1e-4 relative where the spec says so). Notable ones, all derived from the real Phase 0 evidence and the Phase 1 golden fixture: preflight fixtures parse to `['deepseek']` for both steps; the probe plan with an empty cache on the golden fixture plans 14 tags in the order atlas-cloud/fp8, morph/fp8, makora/fp8, streamlake/fp8, deepinfra/fp8, venice/fp8, gmicloud/fp8, baidu/fp8, parasail/fp8, nextbit/fp8, novita/fp8, baseten/fp8, siliconflow/fp8, baseten/fast with estimate $0.0493873956; Spec 2-3 V1 refresh: 45 requests, 1 decrypt, final tiers equal to the Phase 1 golden interactive orders (Budget deepinfra/fp8 → streamlake/fp8 → gmicloud/fp8; Balanced deepinfra/fp8 → streamlake/fp8 → makora/fp8; Fast venice/fp8 → baidu/fp8 → parasail/fp8), spend $0.021. `node scripts/verify-routing-ranker.mjs` must keep printing `PASS (30 checks)`. If the code disagrees with a spec value, re-check the code against the K- and C-rules and report; **never edit an expectation to make a test pass.**

## Strict non-goals

- No renderer components, settings screens or launch-dialog changes (Phase 3).
- No launch, adapter, OpenCode config, `OPENCODE_CONFIG_CONTENT` or Team wiring (Phase 4).
- No migration or database schema change (MR-D20).
- No change to any existing Phase 1 export, the golden fixture or its expectations; additions only.
- No edits to `Plan_1.md`, `Phase-0-Findings.md` or the council documents.
- No new dependencies (Node 22's global `WebSocket` and `fetch` are used; no `ws`).
- No p90 scoring, EWMA or provider diversity (Phase 5); MR-D16 and MR-D17 stay open and untouched.
- No network in unit tests. Live spend only in Task 2-3's script, once, at most 3 cents.
- Do not touch the pre-existing changes.

## Required workflow

Coordinator pattern for each task, in order: (1) dispatch an implementation worker subagent with the task doc and its spec; (2) spec-compliance review (contracts, schemas, failure vocabularies, request bodies, test tables, expected values); (3) code-quality review, with particular attention to key handling (decrypt counts, refusal-before-decrypt, the key never reaching a log/file/event/error) and determinism; (4) resolve findings; (5) run the task's verification commands; (6) one intentional commit per task, staging explicit paths, message = title, plain-language summary, technical bullets, ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push or open a PR unless explicitly asked.

**Notes for this Windows machine:**

- The Bash tool can collapse backslashes in quoted heredocs: write scripts with the file-write tool and run them by path.
- After editing an existing file, check `git diff --stat` for an unexpected whole-file line-ending rewrite. `docs/Features/Foundation/roadmap.md` contains one lone CR byte; edit it byte-wise (a script that replaces exact bytes and asserts counts), never with a tool that may normalise line endings, and confirm `git diff --stat` shows only the intended lines.
- Dev worktrees share one `%APPDATA%` profile; always use a throwaway `--user-data-dir` for app runs. Never kill `electron.exe` by name: the user's installed Chorus may be running.
- If driving `npm run dev` by hand: `$env:REMOTE_DEBUGGING_PORT='9333'` in a worktree (9222 only in the main checkout and only if `http://127.0.0.1:9222/json/version` shows it free); dev never rebuilds MAIN on edit, so relaunch before measuring.

## Verification commands (repository root, PowerShell)

```powershell
npm run typecheck
npx vitest run src/main/routing src/main/services/routingClient.test.ts src/main/services/routingStore.test.ts src/main/services/routingService.test.ts src/main/services/routingObserver.test.ts src/main/services/routingIpc.test.ts src/main/services/modelCatalog.test.ts src/shared/routing.test.ts
npm test
Get-ChildItem -Path src/main/routing, src/shared/routing.ts -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern 'Date\.now\(|Math\.random\(|new Date\(\)|from ''(node:|fs''|path''|electron|better-sqlite3)|require\('
Get-ChildItem -Path src/main/routing -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern "from '\.\./(services|db|adapters)/"
node scripts/verify-routing-ranker.mjs
node scripts/verify-routing-phase2-live.mjs   # Task 2-3 only, once; spends at most 3 cents
npx electron-vite build
node scripts/verify-routing-ipc.mjs           # Task 2-4 onward; zero cost
npm run grep:secrets
git diff --check
git status --short
```

- **The focused `npx vitest run`** lists every Phase 2 test file; each task runs it once the files it owns exist (missing files simply do not match).
- **Both `Select-String` lines** must print nothing. They also match comments, so describe purity rules in comments without those literal tokens.
- **`node scripts/verify-routing-ranker.mjs`** must keep printing `PASS (30 checks)`: Phase 1 must stay intact.
- **`node scripts/verify-routing-phase2-live.mjs`** runs once, in Task 2-3. It must report `passed: true`, print the estimate line before the probe and the spend line after, and leave no `_verify/routing-phase2-live-*.cjs` and no `profile` or `routing-live.db*` in its evidence directory.
- **`node scripts/verify-routing-ipc.mjs`** runs from Task 2-4 on, after `npx electron-vite build`. It must end with `PASS (n checks)` and exit 0.
- **`npm run grep:secrets`** also scans `_verify/`, so run it after the scripts have cleaned up. It must report clean.
- **`npm test`** must pass the whole suite, not a subset. The baseline before Phase 2 is 127 files and 3,782 tests.
- **`git status --short`** must still show the pre-existing entries unchanged.

## Failure honesty

If a verification command fails for an unrelated environment reason, capture the exact output, explain it, and do not claim success. A passing subset is not a full-suite pass. Never weaken a test or an expectation to get a green result. Report the actual live spend even if a check failed.

## Final report

Report:

- **Status:** DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT or BLOCKED.
- **Files changed** in each task, with commit SHAs.
- **Check results:** the typecheck result and the vitest summary line.
- **Live check:** the script's full output, its exit code and the actual spend.
- **CDP drive:** its full output and exit code.
- **Purity, layering and secret-scan** results.
- **Reviews:** spec-review and code-quality outcomes, and how each finding was resolved.
- **Non-goals:** confirmation that every one was respected.
- **Contract changes:** any corrections made between tasks.
- **Residual risks.**
- **Final state:** the output of `git status --short`.

Then, only if the evidence is present, update docs and commit them separately: `docs/Features/Model Routing/roadmap.md` (the Phase 2 row and section, with SHAs and gate evidence), the Status line of `Tasks/Phase-2-Overview.md` and of each `Task-2-#.md`; and add MR-D18's global mirror to `docs/Features/Foundation/roadmap.md` as a new decision row after `| D213 |` (~line 790) in that table's style, stating the two admitted call classes, their constraints and that it widens D60 (restate D60's guarantee by credential class and reachability, with the observer as the one named exception, never by call-site count), status `RESOLVED 2026-10-02 (Model Routing Phase 2, <SHA>)`, and update the `| Highest decision |` ledger row (~line 90). The number D214 was free at kickoff but is contingent: before writing it, compute the larger of `max(^\| D(\d+) \|)` and `max(\bD\d{2,3}\b)` over the working-tree file, run `git fetch` and check `git log HEAD..origin/main` for roadmap changes, and use the next free number (record any renumber in MR-D18's text).
