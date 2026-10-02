# Task 2-2 — Routing store and settings

**Status:** Not started.\
**Depends on:** Phase 1 complete. Independent of Task 2-1; scheduled after it.\
**Paired specification:** [ImplementationSpec-2-2](../ImplementationSpecs/ImplementationSpec-2-2.md)

## Source Of Truth

[Feature roadmap](../roadmap.md) (MR-D9, MR-D10; gates MR-G1, MR-G4, MR-G8), user decisions MR-D19 and MR-D20 as recorded in the [Phase 2 overview](Phase-2-Overview.md) (with K1, K5, K6, C11–C14), the paired specification, and repository CLAUDE.md. Where [Plan_1](../Plan_1.md) §12 differs ("keep the last 20 snapshots", timestamped snapshot files), the overview wins.

## Initial Starting Point

Branch `feature/model-routing` at `a9842a5`, verified 2026-10-02 by reading each file.

- Nothing persists routing data. `src/shared/routing.ts` has `routingObservationSchema` (:86), `accountEligibilitySchema` (:206) and `cacheVerificationSchema` (:213) but no file or settings schemas; `isoTime` (:29) is module-private.
- The settings precedent is one JSON value per key in the `settings` table (`src/main/db/schema.ts:54`): `VOICE_SETTINGS_KEY` (`storage.ts:1101`), `APPEARANCE_SETTINGS_KEY` (:1103), `readVoiceSettings` (:3856: defaults underneath, a bad row reads as the defaults with a warning), `writeVoiceSettings` (:3876: parsed before writing), `writeAppearanceSettings` (:3911–3918). The last migration is v27; MR-D20 needs none.
- Atomic-write precedents: `mcpConfigWrite.ts:79` (`writeFileSync(temp)` then `renameSync(temp, target)`, temp removed on failure) and `scrollbackStore.ts:129`.
- Credential ids are `randomUUID()` (`vault.ts:144`) and `src/shared/ipc.ts:1311` validates them with `z.uuid()`.
- `vitest.config.ts:3`: tests never import `storage.ts` or `better-sqlite3`.
- Task 2-1's block may already be appended to `src/shared/routing.ts`; this task appends after it and touches nothing above. The worktree has the pre-existing changes listed in the overview.

## Goal

Persist everything Phase 2 learns, crash-safely and validated both ways: per-model snapshot, observation history with 7-day retention, cache verifications and per-credential account eligibility as JSON files under `userData/routing/`, and the two routing settings as JSON values in `settings`, with pure helpers that make all of it testable without SQLite or Electron.

## Exact Scope

- `src/shared/routing.ts`: append the "Phase 2 — store and settings" block (store version, `credentialProfileIdSchema`, observation settings schema and defaults, four file schemas). `src/shared/routing.test.ts`: append table S3.
- `src/main/routing/storeCore.ts` and test: directory and file names, file parsing and serialising, observation merge with retention, cache merge, settings parse helpers.
- `src/main/services/routingStore.ts` and test: the `RoutingStore` class over a root directory.
- `src/main/services/storage.ts`: `ROUTING_SETTINGS_KEY`, `ROUTING_OBSERVATION_KEY`, two imports, and `readRoutingSettings`, `writeRoutingSettings`, `readRoutingObservation`, `writeRoutingObservation`.

## Non-Goals

No network, decrypt, service, timer or IPC (Tasks 2-1, 2-3, 2-4). No migration, table or column (MR-D20). No renderer, launch, OpenCode config, adapter or Team changes. No edit to an existing export of `src/shared/routing.ts` or `src/main/routing/*`, or to the golden fixture. No other change to `storage.ts`. No edits to Plan_1, Phase-0-Findings, the council documents or the roadmap. No new dependencies. Do not touch, stage or revert the pre-existing modified and untracked files.

## Dependencies

Phase 1 only. Task 2-3 consumes `RoutingStore`, the settings methods and the shared block; a later correction is made here, with a test, and recorded in that task's report.

## Step-by-step Work

1. Re-run `git status --short` and record the pre-existing entries.
2. Append the store-and-settings block to `src/shared/routing.ts` exactly as specified.
3. Write `storeCore.ts`: `modelDirName`, `accountFileName`, the four parse and four text functions, `storeWarning`, `mergeObservations`, `mergeCacheVerifications`, and the two settings parse helpers. No clock, randomness or I/O.
4. Write `routingStore.ts`: registry check, reads that never throw for file problems, one warning per file, atomic writes with a pid-suffixed temp file.
5. Add the two keys, two imports and four methods to `storage.ts`, following `readVoiceSettings`/`writeVoiceSettings`. Confirm with `git diff --stat` that nothing else in the file changed.
6. Write the tests in tables S3, C and F, then run the verification commands.

## Test Expectations

- **Names:** `deepseek/deepseek-v4.1-flash` maps to `deepseek%2Fdeepseek-v4.1-flash`; the mapping is injective; non-UUID credential ids are refused.
- **Files:** each kind round-trips; a missing file is empty with no warning; invalid JSON, a schema failure or a mismatched `model` is empty with one warning that never quotes the file; an oversized file is not read.
- **Retention:** duplicates by tag and instant collapse with the newer write winning; exactly 7 days old is kept and one second older is dropped; the newest 400 per tag survive.
- **Settings:** a missing row reads as fresh defaults; a partial row reads with defaults underneath; unknown keys, bad JSON, non-objects and refine failures read as defaults with a warning.
- **Store:** atomic writes leave no temp file, even on failure; a corrupt file survives reads untouched and warns once; unknown models are refused before touching the disk.

## Verification Commands

Run from the repository root after creating the task's files.

```powershell
npm run typecheck
npx vitest run src/main/routing/storeCore.test.ts src/main/services/routingStore.test.ts src/shared/routing.test.ts
npm test
Get-ChildItem -Path src/main/routing, src/shared/routing.ts -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern 'Date\.now\(|Math\.random\(|new Date\(\)|from ''(node:|fs''|path''|electron|better-sqlite3)|require\('
Get-ChildItem -Path src/main/routing -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern "from '\.\./(services|db|adapters)/"
node scripts/verify-routing-ranker.mjs
npm run grep:secrets
git diff --check
git status --short
```

Both `Select-String` lines must print nothing. `git status --short` must show ` M src/main/services/storage.ts`, ` M src/shared/routing.ts`, ` M src/shared/routing.test.ts`, the new files, and the pre-existing entries unchanged. Record actual exit codes.

## Acceptance Criteria

- The shared block exports every name in the specification; no existing export changed; both typechecks pass.
- S3, C1–C17 and F1–F12 pass with the stated values.
- `storeCore.ts` passes both greps; `routingStore.ts` imports neither `storage.ts` nor `electron`.
- `storage.ts` gains exactly the two keys, two imports and four methods, written in the voice-settings shape.
- `npm test` and `npm run grep:secrets` pass; the ranker script still prints `PASS (30 checks)`; the pre-existing worktree entries are untouched.

## Review Checklist

- [ ] Every file is parsed with its schema on read and validated before it is written.
- [ ] No read path deletes, renames or rewrites a file (C12); warnings never quote content or paths.
- [ ] Temp files carry the pid and are removed on failure.
- [ ] Retention is relative to the `now` passed in, never the clock.
- [ ] Settings helpers return fresh objects; defaults are never mutated.
- [ ] Changes are limited to owned files; pre-existing work is preserved and not committed.
