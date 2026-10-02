# Task 3-4 — Settings → Model routing and the built-app drive

**Status:** Not started.\
**Depends on:** Tasks 3-1 to 3-3 pass (the IPC drive passes 19 checks; Tables RV and RS pass; the isolated harness passes 15 checks).\
**Paired specification:** [ImplementationSpec-3-4](../ImplementationSpecs/ImplementationSpec-3-4.md)

## Source Of Truth

[Feature roadmap](../roadmap.md) (MR-D10, MR-D11, MR-D19; gates MR-G1, MR-G4, MR-G5, MR-G7), user decisions MR-D21 to MR-D24 as recorded in the [Phase 3 overview](Phase-3-Overview.md) (with K3, K5, K8, K9, K10 and C11, C17–C20), the paired specification, ImplementationSpecs [3-2](../ImplementationSpecs/ImplementationSpec-3-2.md) and [3-3](../ImplementationSpecs/ImplementationSpec-3-3.md), Foundation D14, D76 (no dead nav entries) and D214, and repository CLAUDE.md (runtime-verify every renderer-to-main payload; verify the real app, not only tests).

## Initial Starting Point

Branch `feature/model-routing` with Tasks 3-1 to 3-3 landed on `5079b5d`. Facts verified 2026-10-02 at `5079b5d`:

- `SettingsView.vue` (139 lines, CRLF in the working tree) has five live sections. `SettingsSection` (:30), the `section` ref (:35, not persisted), the nav (:75–126; `data-settings-nav` on Voice :96, Appearance :105, JEV :112; none on Providers or Agent lock), the content `v-if` chain (:129–135), and the rule that a row and its section land in one change (:17–28, :68–74). No script selects nav items by position.
- Settings opens through the rail button `aria-label="Open settings"` (`ProjectRail.vue:899–900`), which sets `activeView = 'settings'` (`App.vue:909`); `SettingsView` mounts under `v-if` (`App.vue:1038`).
- The apply-immediately precedent is `SettingsAppearance.vue` (:21–24, `commit` :43–55); `flashSaved()` confirms a write main accepted (`SettingsVoice.vue:203`, `savedFlash.ts:33`).
- `scripts/verify-routing-ipc.mjs` is the built-app CDP precedent: freshness (:88–107), its own child with a throwaway `--user-data-dir` and a free port (:116–131), kill by its own pid only (:149–156), connect (:228–273), the secret-pattern scan (:440–452). Filling a v-model field over CDP needs `.value` plus `input` and `change` events (`team-member-ui-checks.mjs:7–10`).
- The store layout is `<userData>/routing/<modelDirName(slug)>/snapshot.json` and `observations.json` (`storeCore.ts:65`, :150, :161). The golden fixture's `fetchedAt` is 2026-10-02T09:05:00Z, in the past.
- The installed Chorus is running from `%LOCALAPPDATA%\Programs\Chorus` with its data in `%APPDATA%\chorus-app`; the drive must touch neither.
- The worktree has the pre-existing changes listed in the overview.

## Goal

Ship the Settings → Model routing section, with its nav row in the same change, wired to the routing store and the three components; and prove on the built app, at zero cost and in a throwaway profile, that it opens, shows the honest empty states, writes both settings through main with plain payloads, renders a seeded snapshot consistently with main's own `TierResult`, and makes no OpenRouter request.

## Exact Scope

- `src/renderer/src/views/SettingsRouting.vue`: the section (inspect card with model, profile, effort caption, "Refresh with" credential and refresh status; tier cards and notes; providers table; background observation; data collection).
- `src/renderer/src/views/SettingsView.vue`: the import, the `'routing'` member of `SettingsSection`, the nav row (`data-settings-nav="routing"`, "Model routing", directly after "Providers & keys"), the content line, and the two "five entries" comments.
- `scripts/verify-routing-settings-ui.mjs`: the zero-cost CDP drive of the built app (checks U1–U15 and `cleanup`).

## Non-Goals

- No `LaunchDialog.vue`, `TeamLaunchDialog.vue`, launch, Team, adapter or OpenCode-config change; nothing selectable (MR-D21).
- No ranking-knob controls (MR-D24); no timer that refreshes or reloads (K3); no refresh on mount.
- No change to the store, the view model or the components except a recorded, tested correction in their owning task's files.
- No main, preload or shared-contract change; no migration.
- No paid check in this task's required verification (K10); the optional manual check below is user-run only.
- No new dependencies; no `.vue` unit test (K2).
- No edits to the roadmap, Plan_1 or the Phase 0–2 documents.
- Do not touch, stage or revert the pre-existing modified and untracked files.

## Dependencies

Tasks 3-1 to 3-3. Phase 4 reuses the components and the store in the launch dialog.

## Step-by-step Work

1. Re-run `git status --short` and record the pre-existing entries. Read the Task 3-1 to 3-3 reports for deviations.
2. Write `SettingsRouting.vue` as specified: store-bound, `:value`/`:checked` plus `@change` handlers (not `v-model` on store state), a 1 s display clock that never calls IPC, `flashSaved()` only on a `true` action result.
3. Edit `SettingsView.vue`: import, type, row, content line and comments in one change. The file is CRLF: keep CRLF, check `git diff --stat src/renderer/src/views/SettingsView.vue` shows only the intended insertions and the two comment edits, and check `git ls-files --eol src/renderer/src/views/SettingsView.vue` still reports `w/crlf` (with `core.autocrlf` true the diff cannot see a line-ending rewrite).
4. `npm run typecheck`, then `npx electron-vite build`.
5. Write `scripts/verify-routing-settings-ui.mjs` and run it against the fresh build.
6. Look at the three screenshots.
7. Run the verification commands.
8. Optionally, and only if the user chooses to run it, the manual paid check below.

## Test Expectations

- **Navigation:** the row exists, selects, and mounts the section; leaving and re-entering remounts and reloads it.
- **Empty profile:** one model, two profiles, the effort caption; no credential (hint shown, Refresh disabled with its reason, cost statement shown); every card in its no-snapshot state; no table; observation on but undesignated.
- **Writes (MR-G5):** turning observation off stores `{ enabled: false, credentialProfileId: null }` and on stores `{ enabled: true, credentialProfileId: null }`; the data-collection checkbox stores `'allow'` then `'deny'` with every other setting at its default; zero clone errors.
- **Seeded snapshot:** the three ranked cards match main's own `routing:tiers` reply; the Nitro card is amber with `together` likely; the age reads 5–9 minutes and not stale; the notes are exactly W2, W3 and the limited-history line; the table opens to 32 rows, 14 eligible first.
- **No network, no secrets:** `requestsSinceStart` stays 0; no response or page text matches a key pattern; no renderer exception or console error after navigation began.

## Verification Commands

Run from the repository root.

```powershell
npm run typecheck
npm test
Get-ChildItem -Path src/main/routing, src/shared/routing.ts, src/shared/routingView.ts -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern 'Date\.now\(|Math\.random\(|new Date\(\)|from ''(node:|fs''|path''|electron|better-sqlite3)|require\('
node scripts/verify-routing-ranker.mjs
npx electron-vite build
node scripts/verify-routing-ipc.mjs
node scripts/verify-routing-ui.mjs
node scripts/verify-routing-settings-ui.mjs
Get-ChildItem _verify/routing-settings-ui
npm run grep:secrets
git diff --check
git diff --stat src/renderer/src/views/SettingsView.vue
git ls-files --eol src/renderer/src/views/SettingsView.vue
git status --short
```

The `Select-String` line must print nothing. The three drives end `PASS (19 checks)`, `PASS (15 checks)` and `PASS (16 checks)` with exit code 0. `_verify/routing-settings-ui` holds only `empty-state.png`, `seeded-cards.png` and `seeded-providers.png`. `git status --short` shows ` M src/renderer/src/views/SettingsView.vue`, the two new files, and the pre-existing entries unchanged; `out/` is build output and is not committed. Record actual exit codes and the full drive output.

**Optional manual check (user-run; spends up to about 5 cents; not required by any gate).** Claude Code's auto mode blocks paid runs, so this is for the user to do by hand, once, if they want to see MR-G7 live in the UI:

1. Leave the installed Chorus running and stop no process by name. Create a throwaway folder under `%TEMP%`. Copy the installed profile's database and `Local State` into it (`%APPDATA%\chorus-app\chorus.db` with its `-wal`/`-shm` files if present, and `%APPDATA%\chorus-app\Local State`); first check the source database is the one that is growing (several copies exist on this machine).
2. `$env:REMOTE_DEBUGGING_PORT='9333'; npx electron-vite dev -- "--user-data-dir=<throwaway>"`.
3. Settings → Model routing: choose the copied OpenRouter credential under "Refresh with", press Refresh, and watch the estimate line appear before any probe line, then the spend line after `Done` (at most about $0.05). The button then reads `Refresh again in n s` and counts down from about 60; the cooldown itself is main's (MR-D22) and is unit-tested in Task 3-1.
4. Close the dev app (its own window), then delete the throwaway folder: it holds a decryptable copy of the credential.

## Acceptance Criteria

- The row and the section land together; the nav shows six live entries; the section remounts per visit (C17).
- The section renders every state with the Task 3-2 strings and the Task 3-3 components; nothing in it is selectable; no timer calls IPC (C19); it shows `Preview only: launches do not use these tiers yet.` (C20).
- Observation and data-collection writes apply immediately, adopt main's stored value, re-sync a control after a refused write, and call `flashSaved()` only after a write main accepted (K9, C11, MR-D23, MR-D24).
- `node scripts/verify-routing-settings-ui.mjs` passes U1–U15 and `cleanup` against a fresh build and a throwaway profile, and the two earlier drives still pass.
- `npm test` and `npm run grep:secrets` pass; the purity grep prints nothing; the ranker script passes; `SettingsView.vue` has no whole-file diff; the pre-existing worktree entries are untouched.

## Review Checklist

- [ ] The row and the section are in the same change; the comments say six entries (D76).
- [ ] Every renderer-to-main call goes through a store action that snapshots its payload; the view builds no payload itself (MR-G5).
- [ ] Turning observation off sends `{ enabled: false, credentialProfileId: null }`; the credential select only designates while observation is on (MR-D23, C11).
- [ ] The Refresh button is the only path to a paid call; it states its cost, shows the estimate before spend, and counts down after its own network-reaching refresh (K3, MR-G7, C12).
- [ ] The drive built the app first, refused a stale build, launched its own child with a throwaway profile and a free port, killed only that child by pid, never touched 9222 or `%APPDATA%\chorus*`, and deleted the profile and its bundle.
- [ ] `SettingsView.vue` kept its CRLF line endings.
- [ ] Changes are limited to owned files; pre-existing work is preserved and not committed.
