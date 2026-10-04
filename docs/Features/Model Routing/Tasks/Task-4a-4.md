# Task 4a-4 — The launch-dialog tier picker

**Status:** Not started.\
**Depends on:** Tasks 4a-1 to 4a-3 pass (`src/shared/routing.ts` has the "Phase 4a — launch routing (Task 4a-1)" block with `routingBaseModelId`, `RoutingLaunchTier`, `RoutingLaunchChoice` and `RoutingLaunchPreferences`; `window.chorus.routing.launchPreferences` exists and the IPC drive passes 20 checks; `launchRequestSchema` has `routing_tier`).\
**Paired specification:** [ImplementationSpec-4a-4](../ImplementationSpecs/ImplementationSpec-4a-4.md)

## Source Of Truth

[Feature roadmap](../roadmap.md) (MR-D4, MR-D10, MR-D11, MR-D19, MR-D21, MR-D22; gates MR-G1, MR-G5, MR-G8), user decisions MR-D25 to MR-D28, kickoff decisions K1–K4, K7–K9, K12–K14 and clarifications C23–C35 as recorded in the [Phase 4a overview](Phase-4a-Overview.md), the paired specification, ImplementationSpecs [4a-1](../ImplementationSpecs/ImplementationSpec-4a-1.md) and [4a-3](../ImplementationSpecs/ImplementationSpec-4a-3.md) for the contracts this task consumes, ImplementationSpecs [3-2](../ImplementationSpecs/ImplementationSpec-3-2.md) and [3-3](../ImplementationSpecs/ImplementationSpec-3-3.md) for every Phase 3 string and component rule, [Plan_1](../Plan_1.md) §2 "User flow (UI)" for the picker sketch and empty states (the roadmap and the overview win where they differ), Foundation D14 and D90, and repository CLAUDE.md (plain-object payloads, runtime-verify, no new dependencies).

## Initial Starting Point

Branch `feature/model-routing` with Tasks 4a-1 to 4a-3 landed. Facts verified 2026-10-03 at `a57ef1b` (Tasks 4a-1 to 4a-3 touch none of these files):

- `src/renderer/src/components/LaunchDialog.vue` is 2,095 lines with **mixed line endings: 2,088 CRLF and 7 lone LF (lines 33, 34, 35, 1102, 1103, 1117, 1118), 0 lone CR** (counted byte-wise; the file ends with a CRLF); `git ls-files --eol` prints `i/lf w/mixed`. Script :1–1099, template :1101–1683, `overlays.css` :1685, scoped style :1687–2095.
- In that file: `import { useFleetStore }` :19; `authChoice` :164–165; `selectedProfile` :168; `eligibleProfiles` :174–186; `modelEffort` :266; `modelEffortLevels` :283–291 looks up the exact id at :288, so a `:nitro` id finds no efforts (MR-D4); `selectedLaunchProfile` :319–321; `resolvedModel` :336–342; `effectiveModel` :350; `missingModelRow` :370–375; the profile watcher prefills `modelEffort` from `profile.model_effort` (:542); `submit()` :916–1073 with its guard :917, `own` :966 and the payload literal :998–1041 (`model` spread :1035); the D179 model-effort section :1456–1472; the Launch button's `:disabled` :1658–1664 (`busy ||` :1661).
- `RoutingTierCards.vue` (224 lines, LF): props `{ cards, nitro, notes }` (:20), no emits; its comment (:10–13) says Phase 4 adds a selection prop and event. The label is `span.routing-card-label` (:34; Nitro's at :64 with `[data-routing-nitro-label]`). `SettingsRouting.vue:233` is its only app user.
- `stores/routing.ts` is the Settings singleton (`defineStore('routing')` :61) with module-level subscription state (:56–59), the helpers `plainRoutingInput` :24, `routingValue` :30–33, `routingFailure` :35–39, the exported type `RoutingRefreshState` :41–49, and the inspector's fixed effort in `loadTiers` (:146) and `startRefresh` (:195).
- `routingView.ts` (504 lines, LF) imports only `./routing` (:1–17); `tierCardViews` :179–231 gives no-snapshot and empty cards their own `reason`. `ROUTING_PREVIEW_NOTE` (:46) reads `Preview only: launches do not use these tiers yet.`, which this phase makes untrue; it is shown first in Settings → Model routing (`SettingsRouting.vue:168`) and pinned in exactly two more places: RV21 (`routingView.test.ts:727`) and the Settings drive's constant `PREVIEW_NOTE` (`scripts/verify-routing-settings-ui.mjs:68`, read by its freshness check :159 and by U1 :592).
- `settings.css` is imported unscoped by `SettingsRouting.vue:301` and `SettingsView.vue:153`; `App.vue:17` imports `SettingsView` statically, so today's built `out/renderer/assets/index-*.css` holds one `.set-card-protected` rule. LaunchDialog imports only `overlays.css`. A scratch vite build (2026-10-03) showed a `<style src>` shared by two SFCs at different block indices is emitted once.
- `App.vue` mounts the dialog under `v-if="dialogOpen && projectStore.activeId"` (:1091–1098), so every open is a fresh component; `onLaunchDone` closes it (:995–998).
- `scripts/verify-routing-ui.mjs` (762 lines) runs H1–H15 and prints `PASS (15 checks)` (:761); H1 asserts the page's only buttons are Refresh and the toggle and that nothing has a `tabindex` (:470–471).
- Vue 3.5.40 is installed (`useId` is available).
- The worktree has the pre-existing changes listed in the overview.

## Goal

When a user launches OpenCode on an OpenRouter API-key credential with a registry model, the launch dialog shows the four tier cards and an "OpenRouter default" option as one radio group, preselects the remembered choice (else Balanced, else default with a reason), lets only fresh, non-empty ranked tiers and Nitro be chosen, offers an explicit Refresh on the launch's own credential, and sends exactly one new field — the tier name — on own-agent slots. The Settings inspector renders as before, except that its first line now says truthfully when launches use a tier (K14).

## Exact Scope

- `src/shared/routingView.ts` and its test: the "Phase 4a — launch (Task 4a-4)" block (eligibility mirror, launchability and disabled reasons, card selection, remembered and default choice, caption, the payload rule) and Table LV.
- `src/renderer/src/stores/routingLaunch.ts` and `routingLaunch.test.ts`: `useRoutingLaunchStore` and Table LS.
- `src/renderer/src/components/routing/RoutingTierCards.vue`: the opt-in `selection` prop and `select` emit, including the "OpenRouter default" option.
- `src/renderer/src/components/LaunchDialog.vue`: imports, the routing block, the section, the `routing_tier` payload field, the MR-D4 lookup, the Launch guard and `settings.css` — seven insertions and one one-line replacement, byte-safe.
- `scripts/verify-routing-ui.mjs`: selectable states and checks H16–H20 (`PASS (20 checks)`, a recorded amendment, K12).
- **K14, a recorded amendment owned by this task for this one edit:** `ROUTING_PREVIEW_NOTE` (`src/shared/routingView.ts:46`) becomes exactly `Launches use a tier only when you choose it in the launch dialog. Team helpers do not use tiers yet.`; RV21 (`src/shared/routingView.test.ts:727`) and `PREVIEW_NOTE` (`scripts/verify-routing-settings-ui.mjs:68`) change with it. The Settings drive still ends `PASS (16 checks)`.

## Non-Goals

- No `TeamLaunchDialog.vue` change and no Team routing (Phase 4b, MR-D15).
- No Settings view or store change: `SettingsRouting.vue`, `SettingsView.vue` and `stores/routing.ts` are untouched (the K14 note text lives in `routingView.ts`).
- No other Phase 1–3 expectation changes (K12): only the three K14 places and the harness count move.
- No main, preload or shared-contract change beyond what Tasks 4a-1 and 4a-3 provide; anything missing is recorded and made in their files with a test.
- No re-rank, "Re-rank and relaunch" or helper re-rank (Phase 4b); no launch-profile tier (MR-D27: "Save as launch profile" still stores `model: null` and no tier).
- No refresh on open, on a timer or on a selection; no Zod parsing in the renderer (Phase 3 C13); no new dependencies; no `.vue` unit tests (Phase 3 K2).
- No paid run: neither this task's tests nor its harness press a real Refresh.
- No edits to the roadmap, Plan_1 or the Phase 0–3 documents.
- Do not touch, stage or revert the pre-existing modified and untracked files.

## Dependencies

Tasks 4a-1 (shared names, `routing:launch-preferences`), 4a-2 (none directly) and 4a-3 (`launchRequestSchema.routing_tier`, which the payload literal type-checks against; K13's `:nitro` variants for an untiered launch). Task 4a-5 drives everything here in the built app.

## Step-by-step Work

1. Re-run `git status --short` and record the pre-existing entries. Read the Task 4a-1 to 4a-3 reports for deviations, in particular the exact launch refusal messages and any change to the fixed names.
2. Append the routingView block exactly as specified; keep it free of `Date.now(`, `Math.random(`, `new Date()`, `require(` and `from 'node:` even in comments.
3. Apply K14: the new `ROUTING_PREVIEW_NOTE` text, RV21's expectation, and the Settings drive's `PREVIEW_NOTE` constant — the same exact string in all three.
4. Write Table LV with the hand-written expected values of the specification.
5. Write `stores/routingLaunch.ts`, then Table LS over a stubbed `window.chorus.routing`.
6. Add the selection mode to `RoutingTierCards.vue`; check that with no `selection` the template renders today's elements and attributes only.
7. Edit `LaunchDialog.vue` byte-wise with a scratch Node script (written with the `Write` tool, run by path, then deleted), as the specification's "Byte-safe edit" describes. Record CRLF/LF/CR counts, `git diff --stat` and `git ls-files --eol`.
8. `npm run typecheck` and the targeted vitest run.
9. Amend `scripts/verify-routing-ui.mjs`, run it, and look at `select-golden.png` and `select-stale.png`.
10. `npx electron-vite build`; run the IPC drive and the Settings drive (which now expects the K14 note).
11. Run the verification commands.

## Test Expectations

- **Eligibility mirror (LV2):** each K3 condition, and a launch profile whose env sets `OPENCODE_CONFIG_CONTENT` (K7), hides the section with its own reason, in main's order; a `:nitro` id is not routable.
- **Launchability (LV3–LV8):** fresh ranked tiers launchable; no snapshot and stale tiers say "Refresh"; an empty tier says why; Nitro always launchable.
- **Choice (LV10–LV12):** remembered if launchable; Balanced with no memory; otherwise OpenRouter default with the exact hint; Nitro never preselected unless remembered; a user's choice that becomes unlaunchable falls back with a visible reason.
- **Store (LS1–LS15):** its own subscription and state; ranks with `interactive`, the launch effort and the launch credential; refreshes with the launch credential; drops stale replies; plain payloads with a reactive negative control; no timer.
- **Cards:** off, the Phase 3 DOM exactly (H1–H15 and H20); on, one radio group of five with accessible names, disabled reasons, one event per gesture, the amber Nitro edge kept (H16–H19).
- **Dialog:** the section renders only for a routable launch; `routing_tier` only on own-agent slots and never for "OpenRouter default"; efforts of a `:nitro` id come from its base model (MR-D4, and K13 makes them take effect); Launch waits for routing data; the file keeps its seven lone-LF lines.
- **Settings note (K14):** RV21 and the Settings drive's U1 and freshness check expect the new text; the Settings drive still passes 16 checks.

## Verification Commands

Run from the repository root.

```powershell
npm run typecheck
npx vitest run src/shared/routingView.test.ts src/renderer/src/stores/routingLaunch.test.ts src/renderer/src/stores/routing.test.ts
npm test
Get-ChildItem -Path src/main/routing, src/shared/routing.ts, src/shared/routingView.ts -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern 'Date\.now\(|Math\.random\(|new Date\(\)|from ''(node:|fs''|path''|electron|better-sqlite3)|require\('
Select-String -Path src/shared/routingView.ts -Pattern "from '(?!\./routing')"
Select-String -Path src/shared/routingView.ts, src/renderer/src/stores/routing.ts, src/renderer/src/stores/routingLaunch.ts -Pattern '(?<!Date|JSON)\.(safeParse|parse)\('
Select-String -Path src/shared/routingView.ts, src/shared/routingView.test.ts, scripts/verify-routing-settings-ui.mjs -Pattern 'Preview only: launches do not use these tiers yet\.'
node scripts/verify-routing-ranker.mjs
node scripts/verify-routing-ui.mjs
Get-ChildItem _verify/routing-ui
npx electron-vite build
(Select-String -Path out/renderer/assets/*.css -Pattern '\.set-card-protected\s*\{' -AllMatches).Matches.Count
node scripts/verify-routing-ipc.mjs
node scripts/verify-routing-settings-ui.mjs
node -e "const b=require('fs').readFileSync('src/renderer/src/components/LaunchDialog.vue');let c=0,l=0,r=0;for(let i=0;i<b.length;i++){if(b[i]===13){if(b[i+1]===10){c++;i++}else r++}else if(b[i]===10)l++}console.log(JSON.stringify({crlf:c,lf:l,cr:r}))"
git diff --stat src/renderer/src/components/LaunchDialog.vue
git ls-files --eol src/renderer/src/components/LaunchDialog.vue
npm run grep:secrets
git diff --check
git status --short
```

The four `Select-String` lines print nothing (the fourth proves the old preview note is gone from all three K14 places). The drives end `PASS (30 checks)` (ranker), `PASS (20 checks)` (harness), `PASS (20 checks)` (IPC) and `PASS (16 checks)` (Settings, with the K14 note) with exit code 0. `_verify/routing-ui` holds the eleven Phase 3 PNGs plus `select-golden.png` and `select-stale.png`. The CSS count prints `1`. The EOL counts are `crlf` 2,088 + the inserted lines, `lf` 7, `cr` 0; `git diff --stat` shows only the insertions and the one replaced line; `git ls-files --eol` prints `i/lf w/mixed`. `git status --short` shows the six modified files (`routingView.ts`, `routingView.test.ts`, `RoutingTierCards.vue`, `LaunchDialog.vue`, `verify-routing-ui.mjs`, `verify-routing-settings-ui.mjs`), the two new store files and the pre-existing entries unchanged. Record actual exit codes and output; a passing subset is not a full-suite pass.

## Acceptance Criteria

- `routingView.ts` exports every name in the specification, imports only `./routing`, and passes the purity, import and no-parse greps; LV1–LV14 pass with the stated strings.
- LS1–LS15 pass; no action throws to its caller; every recorded IPC argument is plain and cloneable.
- `RoutingTierCards.vue` with no `selection` renders Phase 3's DOM; with one, the five-radio group of the specification. H1–H20 pass.
- K14 is applied in exactly three places with one exact string; RV21 passes and the Settings drive passes 16 checks against a fresh build.
- `LaunchDialog.vue` contains exactly the specified insertions and replacement; its line-ending counts and `git diff --stat` match; `routing_tier` is sent only as specified.
- `npm test`, `npm run grep:secrets` and the ranker, IPC, harness and Settings drives pass; the pre-existing worktree entries are untouched.

## Review Checklist

- [ ] The dialog sends only `routing_tier` (a string primitive) and only on own-agent slots of a routable launch; "OpenRouter default" sends nothing (K2).
- [ ] The section's visibility mirrors K3 (from `routing:credentials` and `routing:models`) and K7 (the launch profile's env keys); no gateway URL or agent literal is written in the dialog.
- [ ] Ranking uses `interactive`, the launch's effective model effort and the launch's credential (K4); Refresh uses the launch's credential (MR-D19) and only on a click (MR-D26).
- [ ] Ranked tiers are selectable only when fresh and non-empty; Nitro always (MR-D26); the preselection follows K9/MR-D28 with exact hints.
- [ ] A cooldown `BUSY` shows main's message, which names the seconds left, and the launch proceeds on the just-refreshed numbers; the live countdown runs only after the dialog's own network-reaching refresh (MR-D26, Phase 3 C12).
- [ ] The launch store never touches the Settings store's state; no timer in either store.
- [ ] `RoutingTierCards` off renders the Phase 3 DOM (no radio, role, title, class or listener added); on, one radio group whose label text still carries Nitro's meaning.
- [ ] `modelEffortLevels` looks up `routingBaseModelId(model)` (MR-D4).
- [ ] `LaunchDialog.vue` was edited byte-wise; 7 lone-LF lines remain; every new line is CRLF.
- [ ] The K14 note is identical in `routingView.ts:46`, RV21 and the Settings drive; no other Phase 3 expected value moved.
- [ ] Changes are limited to owned files; pre-existing work is preserved and not committed.
