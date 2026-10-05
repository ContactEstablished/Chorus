# Task 4a-2 — OpenCode interactive config and the remembered variant

**Status:** Complete 2026-10-04 (`b6a1eff`; the body script's TUI readiness fix followed as `349d373`). Coordinator additions: VW9–VW12.\
**Depends on:** Task 4a-1 (`launchCore.ts`: `resolveLaunchSelection`, `buildOpenCodeRoutingContent`).\
**Paired specification:** [ImplementationSpec-4a-2](../ImplementationSpecs/ImplementationSpec-4a-2.md)

## Source Of Truth

[Feature roadmap](../roadmap.md) (MR-D3, MR-D4, MR-D16 — resolved by MR-D25; gates MR-G1, MR-G2, MR-G3, MR-G4), user decision MR-D25 as recorded in the [Phase 4a overview](Phase-4a-Overview.md) (with K1, K6, K11, K13 and the clarifications this specification states), the paired specification, [Phase-0-Findings](../Phase-0-Findings.md) (rows (a), (b) and (f); new finding 6), [ImplementationSpec-4a-1](../ImplementationSpecs/ImplementationSpec-4a-1.md) (the content builders, K13's unrouted `:nitro` declaration included), Foundation decisions D179 (opencode's effort in `agent.build`) and D49 (where Chorus may write), and repository CLAUDE.md (verify CLI behaviour against the installed tool; keys only as env vars into the child).

## Initial Starting Point

Branch `feature/model-routing` at `a57ef1b`, verified 2026-10-03 by opening each file and by running the installed OpenCode.

- `src/main/adapters/opencode.ts` (CRLF): `writeMcpConfig` (:217–227) writes the shared `<userData>/mcp/opencode.json` with `agentBlockFor(ctx)` (:323–329, private; null unless `ctx.agentDefaults.modelEffort` and a model; `{ model: qualifyModel(...), variant }`). `buildLaunch` (:229–266) emits `-m` from `qualifyModel(spec.route?.modelId, spec.route?.baseUrl)` (:239–240), states that `spec.modelEffortId` is not read (:249), and returns `envAdditions: {}` (:260). `qualifyModel` (:391–396) is exported. The descriptor is `env-named-file` / `OPENCODE_CONFIG` (:355–363).
- `src/main/adapters/types.ts` (CRLF): `PtyLaunchSpec` (:433–558, last member `resume` :557); `PtyLaunchRoute` (:623–628); `McpWriteContext` (:833–882; `agentDefaults` :876–880, `signal` :881). No routing field exists.
- `src/main/adapters/mcpConfigWrite.ts`: `writeMcpConfigFile` (:106–163) renders, guards (:159) and writes atomically; `wireMcpForLaunch` (:199–306) calls `adapter.writeMcpConfig(ctx)` (:291) for opencode on every call (its file is `custom`, :236–238).
- `src/main/adapters/env.ts`: `composeChildEnv` (:131) — no credential: `{ ...parentEnv, ...PINNED_ENV_VARS, ...envAdditions }` (:162); credential: `BASELINE_ENV_VARS` (:10–20; no `XDG_*`) then `envAdditions` (:177) then `secretEnv` (:178).
- `src/main/adapters/helpers/opencode.ts`: helpers set `OPENCODE_CONFIG_CONTENT` themselves (:33–43) and declare `variants.low` only for the `:nitro` default on 1.18.33 (:19–20). Not changed here.
- Tests live in `src/main/adapters/adapters.test.ts` (CRLF; the opencode block :540–688; the file-adapter neutrality pin :1325–1333 expects `envAdditions` `{}`) and `src/main/adapters/mcpConfigWrite.test.ts` (CRLF; the D179 block :314–439, harness `ctx()` :54–56).
- `scripts/verify-routing-body.mjs` (LF, 121 lines): loopback stand-in (:29–40), placeholder key (:43, :79), isolated XDG per run (`isolated` :52–57), exact-version precondition (:96–97), helper cases patched by hand (:45–47), TUI cases hand-built (file :76, content :77, `-m` :80), nine checks (:108–117), no PASS line — exit code from `report.passed` (:119–120).
- Measured 2026-10-03 on this machine: `opencode --version` prints `1.18.33`; `~\.local\state\opencode\model.json` is one line of compact JSON (1,157 bytes, no newline) with top-level keys `recent`, `favorite`, `variant`, and `variant` holds `"openrouter/deepseek/deepseek-v4.1-flash":"high"` and `"openrouter/deepseek/deepseek-v4.1-flash:nitro":"default"`. `opencode debug paths` (zero cost) resolves the state directory to `XDG_STATE_HOME\opencode` when set, else `<USERPROFILE>\.local\state\opencode`; `HOME` is ignored, and with `USERPROFILE` removed it still finds the OS profile directory.
- The real interactive builders run under plain Node when bundled with `packages: 'external'`: `opencodeAdapter.buildLaunch`, `opencodeAdapter.writeMcpConfig` (it wrote `{"$schema":…,"mcp":{},"agent":{"build":{"model":"openrouter/deepseek/deepseek-v4.1-flash:nitro","variant":"low"}}}`) and `composeChildEnv` (checked 2026-10-03 in a scratch directory). No new exported seam is needed; `agentBlockFor` stays private.
- The worktree has the pre-existing changes listed in the overview.

## Goal

Make the OpenCode adapter carry a launch's per-process config — a routed session's content (MR-D3, K6), or the variant declaration an unrouted `:nitro` launch with an effort needs (K13, MR-D4) — and make an interactive OpenCode effort actually apply (MR-D25): before a launch that writes an effort, rewrite only that model's entry in OpenCode's remembered-variant state, safely and only on the verified version. Prove both at zero cost with `verify-routing-body.mjs` built from Chorus's real builders (MR-G2, MR-G3).

## Exact Scope

- `src/main/adapters/types.ts`: `PtyLaunchRouting`; `PtyLaunchSpec.routing?`; `McpWriteContext.cliState?`.
- `src/main/adapters/opencode.ts`: `buildLaunch` sets `envAdditions.OPENCODE_CONFIG_CONTENT` from `spec.routing`; `writeMcpConfig` calls `applyRememberedVariant` when it writes an effort block and `ctx.cliState` is present.
- New `src/main/adapters/opencodeVariantStateCore.ts` and test (Table VS): `patchRememberedVariant`, `classifyRememberedVariant`, `opencodeStateHome`, `opencodeModelStatePath`, the version and size constants.
- New `src/main/adapters/opencodeVariantState.ts` and test (Table VW): `applyRememberedVariant`, the atomic writer.
- `src/main/adapters/adapters.test.ts`: one appended describe (Table OA).
- `src/main/adapters/mcpConfigWrite.test.ts`: one appended describe (Table MW).
- `scripts/verify-routing-body.mjs`: TUI cases from the real builders, the K13 unrouted `:nitro` case, the MR-D25 case, the real-state check, deletion of its whole `%TEMP%\chorus-routing-body-*` evidence directory on every exit path (the report goes to stdout only), and a final `PASS (16 checks)` line.

## Non-Goals

- No launch wiring: `src/main/ipc.ts` composing `cliState` and `routing`, `sessionManager.ts`, `storage.ts`, `index.ts` and `src/shared/ipc.ts` are Task 4a-3. Until 4a-3 lands, nothing in the app sets `spec.routing` or `ctx.cliState`.
- No change to `launchCore.ts` or any routing service (Task 4a-1), and no renderer change (Task 4a-4).
- No helper routing: `helpers/opencode.ts`, `helpers/common.ts` and the helper cases of `verify-routing-body.mjs` are unchanged (Phase 4b). No `TeamLaunchDialog.vue`, re-rank or guardrail revalidation.
- No change to the shared `opencode.json` format, to `mcpConfigCore.ts`, `mcpConfigWrite.ts` or `env.ts`, and no export of `agentBlockFor`.
- No write to OpenCode state for helpers, for launches without an effort, or on any OpenCode version other than 1.18.33.
- No paid run; the script stays loopback-only with a placeholder key. No OpenCode version change and no new dependency.
- No edits to the roadmap, Plan_1 or the Phase 0–3 documents.
- Do not touch, stage or revert the pre-existing modified and untracked files.

## Dependencies

Task 4a-1 (the script and Table OA use `buildOpenCodeRoutingContent` and `resolveLaunchSelection`). Task 4a-3 consumes `PtyLaunchRouting`, `McpWriteContext.cliState` and `opencodeStateHome`. A correction needed downstream is made here, with a test, and recorded in that task's report.

## Step-by-step Work

1. Re-run `git status --short`; record the pre-existing entries. Run `opencode --version` (expect `1.18.33`) and record it.
2. Add the types to `types.ts` (CRLF): check `git diff --stat` shows only insertions and `git ls-files --eol` still reports `w/crlf`.
3. Write `opencodeVariantStateCore.ts` and Table VS, then `opencodeVariantState.ts` and Table VW.
4. Edit `opencode.ts` (CRLF): the `envAdditions` line, the import and the `writeMcpConfig` hook. Run `adapters.test.ts` and `mcpConfigWrite.test.ts` before adding tests: every existing test must pass unchanged.
5. Append Table OA to `adapters.test.ts` and Table MW to `mcpConfigWrite.test.ts` (both CRLF; same checks).
6. Rewrite the TUI half of `scripts/verify-routing-body.mjs` as specified; leave the helper half as it is.
7. Run the verification commands, the script last (it takes a few minutes; it needs no build).

## Test Expectations

- **Core (Table VS):** the patch rewrites only the named model's entry and reproduces 1.18.33's compact format byte for byte on a compact input; an absent or equal entry, an unreadable file, a non-object root or `variant`, and invalid input write nothing; the state-home rule matches the measurement.
- **Writer (Table VW):** `written` / `unchanged` / `skipped` exactly as specified on a real temp directory; atomic (no temp file left, the original intact when the rename fails); never throws; logs only fixed text.
- **Adapter (Table OA):** `buildLaunch` puts the exact content in `envAdditions` and changes nothing else, routed or K13 unrouted `:nitro` alike; every other launch-behaviour adapter ignores `routing`; a launch without routing is byte-identical to today.
- **Hook (Table MW):** `writeMcpConfig` updates the state only with an effort block and `cliState` on 1.18.33, keyed by the block's own model string; the config file is written as before either way; claude never touches it.
- **Existing tests:** every test in `adapters.test.ts` and `mcpConfigWrite.test.ts` passes unchanged (no recorded amendment in this task).
- **MR-G2 runtime:** `node scripts/verify-routing-body.mjs` ends `PASS (16 checks)` with exit code 0, `providerTraffic: false`, against the installed OpenCode 1.18.33, with the user's real `model.json` byte-identical before and after, the K13 case sending `low` with no provider object, and no `chorus-routing-body-*` directory left in `%TEMP%`.

## Verification Commands

Run from the repository root.

```powershell
npm run typecheck
npx vitest run src/main/adapters/opencodeVariantStateCore.test.ts src/main/adapters/opencodeVariantState.test.ts src/main/adapters/adapters.test.ts src/main/adapters/mcpConfigWrite.test.ts
npm test
Select-String -Path src/main/adapters/opencodeVariantStateCore.ts -Pattern "from 'node:fs'|from 'fs'|Date\.now\(|new Date\(\)|process\.env"
opencode --version
node scripts/verify-routing-body.mjs
npm run grep:secrets
git diff --check
git diff --stat -- src/main/adapters/opencode.ts src/main/adapters/types.ts src/main/adapters/adapters.test.ts src/main/adapters/mcpConfigWrite.test.ts
git ls-files --eol -- src/main/adapters/opencode.ts src/main/adapters/types.ts src/main/adapters/adapters.test.ts src/main/adapters/mcpConfigWrite.test.ts
git status --short
```

The `Select-String` line must print nothing. `opencode --version` prints `1.18.33` (the script refuses any other version). The script's last line is `PASS (16 checks)` with exit code 0; paste the whole output. `npm run grep:secrets` runs after the script has deleted its bundle. `git diff --stat` shows only insertions for `types.ts` and both test files and a small change for `opencode.ts`; `git ls-files --eol` still reports `w/crlf` for all four (with `core.autocrlf` true the diff cannot see a CRLF→LF rewrite). `git status --short` shows ` M` for the owned files, `??` for the four new files, and the pre-existing entries unchanged. Record actual exit codes.

## Acceptance Criteria

- The types, the two `opencode.ts` changes and the two new modules match the specification; both typechecks pass.
- VS1–VS8, VW1–VW8, OA1–OA5 and MW1–MW9 pass; every pre-existing adapter and MCP-write test passes unchanged.
- `node scripts/verify-routing-body.mjs` prints `PASS (16 checks)`, exit 0, with OpenCode 1.18.33, no provider traffic, every OpenCode run on isolated XDG directories (MR-G3), and the real state file unchanged.
- `npm test` and `npm run grep:secrets` pass; the pre-existing worktree entries are untouched; CRLF files still report `w/crlf`.

## Review Checklist

- [ ] `buildLaunch` adds exactly one env entry and only when `spec.routing` is present; argv, cwd and `secretEnv` are unchanged; `modelEffortId` is still not read.
- [ ] The routing content never reaches the shared `opencode.json`, argv or a log (MR-D3).
- [ ] The state write happens only inside `writeMcpConfig`, only when `agentBlockFor(ctx)` is non-null and `ctx.cliState` is present, keyed by `agent.model` — the same `qualifyModel` spelling as `-m`.
- [ ] `applyRememberedVariant` never throws, writes only when the entry exists and differs, preserves every other key, writes temp-fsync-rename beside the target, and is gated to `1.18.33`.
- [ ] No log line carries a path, file content or key; the info line names only the model key and the effort.
- [ ] The script's TUI cases call the real builders; its only harness change is the loopback `baseURL` and `share: 'disabled'`; the helper half is unchanged; it deletes its bundle.
- [ ] Every OpenCode run in the script has its own `XDG_STATE_HOME` and `XDG_DATA_HOME` (MR-G3; config and cache are deliberately left the user's own, as before), and the real `model.json` is compared before and after.
- [ ] Changes are limited to owned files; pre-existing work is preserved and not committed.
