# Task 4b-3 — The Team dialog's per-slot tier

**Status:** Not started.\
**Depends on:** Tasks 4b-1 and 4b-2 pass (`memberFields.routingTier` exists and the strict member schema refuses it off OpenCode on an API key; `routingLaunchRequestSchema.profile` and `RoutingService.resolveLaunch` rank the `helper` profile; `team:launch` refuses a tier it cannot serve with `Helper "<label>": <reason>`; `verify-routing-team.mjs` prints `PASS (16 checks)` and `verify-team-storage.mjs` reports `"passed": true`).\
**Paired specification:** [ImplementationSpec-4b-3](../ImplementationSpecs/ImplementationSpec-4b-3.md)

## Source Of Truth

[Feature roadmap](../roadmap.md) (MR-D11, MR-D15, MR-D19, MR-D21, MR-D26, MR-D32; gates MR-G1, MR-G5, MR-G8), kickoff decisions K2, K4–K6, K10, K11, K13 and K16, clarifications C10–C13 and C20, and answers Q2 and Q8, as recorded in the [Phase 4b overview](Phase-4b-Overview.md); the paired specification; ImplementationSpecs [4b-1](../ImplementationSpecs/ImplementationSpec-4b-1.md) (`memberFields.routingTier`, the member refine, `routingLaunchRequestSchema.profile`, `HELPER_ROUTING_REFUSALS`) and [4b-2](../ImplementationSpecs/ImplementationSpec-4b-2.md) (main's refusal at `team:launch`, the per-attempt resolution) for the contracts this task consumes; [ImplementationSpec-4a-4](../ImplementationSpecs/ImplementationSpec-4a-4.md) for `launchTierViews`, the disabled reasons, the fallback hints and the store pattern (Table LS); ImplementationSpecs [3-2](../ImplementationSpecs/ImplementationSpec-3-2.md) and [3-3](../ImplementationSpecs/ImplementationSpec-3-3.md) for every Phase 3 string and the presentational-component rule (Phase 3 C15); Foundation D14; repository CLAUDE.md (plain-object payloads, runtime-verify, no new dependencies).

## Initial Starting Point

Branch `feature/model-routing` with Tasks 4b-1 and 4b-2 landed. Facts verified 2026-10-05 at `70d5dda` (each file opened, its bytes counted and `git ls-files --eol` run this session; `src/` and `scripts/` equal `HEAD`). Tasks 4b-1 and 4b-2 edit none of the files below.

- `src/renderer/src/components/TeamLaunchDialog.vue` is 118 lines and 14,484 bytes, **all CRLF: 118 CRLF, 0 lone LF, 0 lone CR**, ending with a CRLF; `git ls-files --eol` prints `i/lf w/crlf`. Script :1–81, template :83–115, scoped style :116–118. Imports :2–9 (`defaultTeamHelperModel` :2, `vue` :5, `TeamMemberEditor` :9); `helperKeys` starts `['codex', 'codex']` (:15); `helpers` maps options with `helperEnabled` (:22); `onBeforeUnmount` :25; the mount defaults are one line (:26); `config()` :27–32 copies each helper from `option.member` and maps `helperKeys` on one line (:31); `membersClosed` :33–43 pushes an added member (:39); `usePreset` :44–49 matches on harness, model, authMode, credentialProfileId, installedVersion, profileId and instructions (:46) and restores on :47–48; `savePreset` :50–52; `launch` :63–79 (its guard :64). Template: the helpers fieldset :96, the helper row :97 (`select[aria-label="Helper N"]` with `v-model`, and Remove), Add helper :98, the presets `details` :107 (Save preset), Launch team :108. No routing import, no routing call.
- `src/shared/routingView.ts` is 684 lines and 32,168 bytes, all CRLF (684, 0, 0), `w/crlf`. It imports only `./routing` (:1–21; `ROUTING_FAILURE_MESSAGES,` is :2). `NITRO_CARD_LABEL` :44; `ROUTING_PREVIEW_NOTE` :50 holds 4a K14's text. The Phase 4a launch block is :510–684: `ROUTING_LAUNCH_PROFILE = 'interactive'` :522, `ROUTING_LAUNCH_CHOICE_LABELS` :525–527, `ROUTING_DEFAULT_CHOICE_LABEL` :528, `ROUTING_DEFAULT_CHOICE_DESCRIPTION` :529–530, `routingLaunchEligibility` :554–568 (refuses a `:nitro` id, :565), `launchTierViews` :588–603, the private `launchViewOf` :627–629, `choiceLaunchable` :631–633 and `unavailableHint` :636–640, `defaultLaunchChoice` :647–655, `routingLaunchTierToSend` :678–680, `routingUnavailableText` :682–684.
- `src/shared/routingView.test.ts` is 966 lines and 49,383 bytes, all CRLF (966, 0, 0), `w/crlf`. The `./routingView` import :16–63; `SLUG` :88, `tiersFor` :100–114, `S_EMPTY` :116, `S_FLOOR1000` :118, `helper` (the helper-profile golden ranking) :121, `deepFreeze` :165–171, `A_ID` :595, `C_ID` :597. RV6 (:275–288) pins the helper golden column; **RV21 (:745–755) pins the preview note at :747**. Table LV is :763–966.
- `src/renderer/src/stores/routingLaunch.ts` (199 lines, `w/crlf`) is 4a's launch store: one input at a time (`input` :51, `tiers` :52), ranks `interactive` (:147), owns a progress subscription (:59–77) and a refresh (:176–197). It cannot serve several Team slots; it is the pattern for the new store. `stores/routing.ts` exports `RoutingFailureInfo` (:21), `plainRoutingInput` (:24), `routingValue` (:30–33) and `routingFailure` (:35–39). `stores/routingLaunch.test.ts` is the Table LS pattern (the pass-through `plainRoutingInput` spy :35–38, the reactive negative control :471–499).
- `src/renderer/src/components/routing/RoutingTierCards.vue` (381 lines, `w/crlf`) is the presentational precedent: every string from `routingView`, a type-only `routingView` import (:24), no store, no `window.chorus`.
- `src/shared/teamProfiles.ts`: `defaultTeamHelperModel` = `deepseek/deepseek-v4.1-flash:nitro` (:3–4); `normalizeTeamModel` strips a legacy `openrouter/` prefix (:12–15). `src/renderer/src/stores/team.ts` (`w/lf`): `plainTeamInput` :4, `teamValue` :5.
- `scripts/verify-routing-settings-ui.mjs` is 909 lines and 44,962 bytes, all CRLF, `w/crlf`: `PREVIEW_NOTE` :68, read by its freshness check :159 and by U1 :592; it ends `PASS (16 checks)`. `SettingsRouting.vue:168` shows the note. **No other file pins it** (`git grep` outside `docs/`).
- **Other consumers of the Team dialog's DOM.** `scripts/verify-team-review-ui.mjs` mounts `TeamLaunchDialog` in an isolated harness (:23) with a `window.chorus` that has **no `routing` member** (:33), asserts exactly two `select[aria-label^=Helper]` and clicks its stubbed Launch (:46); its fixture helper is a Codex subscription member. `scripts/verify-team-packaged-ui.mjs:87`, `:90` and `scripts/team-member-ui-checks.mjs:57`, `:64–65` count helper slots by `select[aria-label^="Helper "]`. So the tier select's accessible name must never start with `Helper `, and the dialog must not touch `window.chorus.routing` when no slot wants routing.
- Vue 3.5.40 (`useId`), Pinia 4.0.2, esbuild 0.25.12 are installed. `npm test` at `70d5dda`: 144 files and 4,236 tests pass (measured this session).
- The worktree has the pre-existing changes listed in the overview.

## Goal

When a Team helper slot is OpenCode on an OpenRouter API-key credential that routing lists, with the registry model in its base or `:nitro` form, the Team dialog shows one tier dropdown beside it — Budget, Balanced, Fast, Nitro or OpenRouter default — preset to Nitro for the `:nitro` model and to OpenRouter default otherwise, ranked for free on the `helper` profile with that slot's own credential and effort, with stale, missing or empty ranked tiers disabled and saying why. The slot sends exactly one new field, `routingTier`, and only for a tier. Presets restore each slot's tier, and a restored ranked tier that cannot be used now falls back to OpenRouter default with 4a's hint. Launch and Save preset wait for routing data; a routing failure hides every dropdown and says so once. The Settings note stops saying that Team helpers do not use tiers (K13).

## Exact Scope

- `src/shared/routingView.ts` and its test: one import name, the K13 note, the appended "Phase 4b — Team helpers (Task 4b-3)" block, and Table HV (HV1–HV12).
- New `src/renderer/src/stores/routingTeam.ts` and `routingTeam.test.ts`: `useRoutingTeamStore`, `routingTeamKey`, and Table HS (HS1–HS11).
- New `src/renderer/src/components/routing/HelperTierSelect.vue`: presentational, props `{ view, label }`, one `select` emit.
- `src/renderer/src/components/TeamLaunchDialog.vue`: six insertions and ten in-line replacements, byte-safe, with asserted anchors and counts.
- **K13, a recorded amendment owned by this task:** `ROUTING_PREVIEW_NOTE` (`routingView.ts:50`) becomes exactly `Launches use a tier only when you choose one: in the launch dialog, or for each helper in the Team dialog.`; RV21 (`routingView.test.ts:747`) and `PREVIEW_NOTE` (`scripts/verify-routing-settings-ui.mjs:68`) change with it. The Settings drive still ends `PASS (16 checks)`.

## Non-Goals

- No main, preload, IPC, `src/shared/routing.ts` or `src/shared/team.ts` change: 4b-1 and 4b-2 own them. Anything missing is recorded and made in the owning task's file with a test, never worked around here.
- No Refresh in the Team dialog (K11, Q2), no progress subscription, no timer, no remembered tier for helpers (K10: Teams never write `launch-preferences.json`), no tier on launch profiles (MR-D27).
- No change to `usePreset`'s `match` (C13), to `LaunchDialog.vue`, `RoutingTierCards.vue`, `SettingsRouting.vue` or any routing store other than the new one.
- No Zod parsing in the renderer (Phase 3 C13); no new dependency; no `.vue` unit test (Phase 3 K2): the dialog's runtime evidence is Task 4b-4's drive.
- No paid run; no test or harness presses Refresh; no app or drive runs in this task beyond the listed verification commands.
- No edits to the roadmap, Plan_1 or the Phase 0–4a documents. Do not touch, stage or revert the pre-existing modified and untracked files.

## Dependencies

Task 4b-1 (`memberFields.routingTier`, so `preset.config.helpers[i].routingTier` and the `config()` literal type-check; `routingLaunchRequestSchema.profile`, which `routing:tiers` already accepts as `helper`) and Task 4b-2 (main refuses an unservable tier at `team:launch` and resolves the tier before each attempt). Task 4b-4 drives everything here in the built app.

## Step-by-step Work

1. Re-run `git status --short` and record the pre-existing entries. Read the 4b-1 and 4b-2 reports for deviations, in particular the final name and placement of `routingTier` and the refusal texts.
2. Run `node scripts/verify-team-review-ui.mjs` once **before** editing and record its output (it mounts this dialog; a pre-existing failure is recorded, not fixed here).
3. Edit `routingView.ts` as specified (one import line, the K13 note, the block appended after :684). Keep it free of `Date.now(`, `Math.random(`, `new Date()`, `require(` and `from 'node:`, comments included. Confirm the byte counts are still all CRLF.
4. Apply K13 in its three places with the one exact string.
5. Append Table HV to `routingView.test.ts` and extend its import; amend RV21.
6. Write `stores/routingTeam.ts`, then `routingTeam.test.ts` (Table HS) over a stubbed `window.chorus.routing`.
7. Write `components/routing/HelperTierSelect.vue`.
8. Edit `TeamLaunchDialog.vue` byte-wise with a scratch Node script (written with the `Write` tool, run by path, then deleted), as the specification's "Byte-safe edit" describes. Record its report, `git diff --stat` and `git ls-files --eol`.
9. `npm run typecheck`, the targeted vitest run, then `npm test`.
10. `npx electron-vite build`; run the Settings drive (now expecting the K13 note), the UI harness, the IPC drive and the review-UI harness.
11. Run the verification commands.

## Test Expectations

- **Eligibility mirror (HV2, HV3):** only OpenCode on an API key wants routing; the credential must be listed by `routing:credentials`; the base slug must be a registry model; the `:nitro` form is eligible on its base slug (unlike 4a); a legacy-prefixed model is not eligible until the dialog normalizes it; first match in main's order.
- **Defaults (HV4, HV6):** a `:nitro` option starts on Nitro, any other on OpenRouter default; nothing falls back to Balanced; a stored ranked tier that cannot be used now becomes OpenRouter default with `Refresh to use <Tier>.` or `<Tier> has no endpoint that meets the rules right now.`; Nitro and OpenRouter default always hold.
- **Dropdown (HV5, HV7–HV9):** five options in the order Budget, Balanced, Fast, Nitro (`Nitro — unfiltered provider routing`), OpenRouter default (titled with what it sends); an unlaunchable ranked option is disabled and its text carries 4a's reason; busy hides the hint; a ranking failure other than `NO_SNAPSHOT` shows `Routing is unavailable: <message>`.
- **Payload rule (HV10):** a tier name only for an eligible slot and never for OpenRouter default.
- **Caption (HV11)** and **purity (HV12).**
- **Store (HS1–HS11):** its own state; three free reads and nothing else; a ranking per `(credential, base model, effort)` key, loading before the first await, late replies dropped per key; `NO_SNAPSHOT` is an entry state; `reset()` drops late replies; every IPC argument plain, with a reactive negative control (4a LS13); no timer, no subscription, no refresh, no write, no other routing store touched.
- **Dialog:** a dropdown only on an eligible slot; `routingTier` only for a tier; `helperTiers` index-aligned with `helperKeys` through mount, Add helper, Remove, a changed option, an added member and a preset; Launch and Save preset disabled while routing loads; a load failure shows one `Routing is unavailable: …` line and the helpers go unrouted; no routing call at all when no slot wants routing; the file stays all-CRLF.
- **Settings note (K13):** RV21 and the Settings drive expect the new text; the Settings drive still passes 16 checks.

## Verification Commands

Run from the repository root.

```powershell
npm run typecheck
npx vitest run src/shared/routingView.test.ts src/renderer/src/stores/routingTeam.test.ts src/renderer/src/stores/routingLaunch.test.ts src/renderer/src/stores/routing.test.ts
npm test
Get-ChildItem -Path src/main/routing, src/shared/routing.ts, src/shared/routingView.ts -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern 'Date\.now\(|Math\.random\(|new Date\(\)|from ''(node:|fs''|path''|electron|better-sqlite3)|require\('
Select-String -Path src/shared/routingView.ts -Pattern "from '(?!\./routing')"
Select-String -Path src/shared/routingView.ts, src/renderer/src/stores/routing.ts, src/renderer/src/stores/routingLaunch.ts, src/renderer/src/stores/routingTeam.ts -Pattern '(?<!Date|JSON)\.(safeParse|parse)\('
Select-String -Path src/shared/routingView.ts, src/shared/routingView.test.ts, scripts/verify-routing-settings-ui.mjs -Pattern 'Team helpers do not use tiers yet\.'
node scripts/verify-routing-ranker.mjs
node scripts/verify-routing-ui.mjs
npx electron-vite build
node scripts/verify-routing-ipc.mjs
node scripts/verify-routing-settings-ui.mjs
node scripts/verify-team-review-ui.mjs
node -e "for(const f of ['src/renderer/src/components/TeamLaunchDialog.vue','src/shared/routingView.ts','src/shared/routingView.test.ts','scripts/verify-routing-settings-ui.mjs']){const b=require('fs').readFileSync(f);let c=0,l=0,r=0;for(let i=0;i<b.length;i++){if(b[i]===13){if(b[i+1]===10){c++;i++}else r++}else if(b[i]===10)l++}console.log(f,JSON.stringify({bytes:b.length,crlf:c,lf:l,cr:r}))}"
git diff --stat src/renderer/src/components/TeamLaunchDialog.vue
git ls-files --eol src/renderer/src/components/TeamLaunchDialog.vue src/shared/routingView.ts src/shared/routingView.test.ts scripts/verify-routing-settings-ui.mjs
npm run grep:secrets
git diff --check
git status --short
```

The four `Select-String` lines print nothing (the last proves 4a K14's note is gone from all three places). `npm test` passes with one more file and 23 more tests than after Task 4b-2 (12 HV, 11 HS; reference: 149 files and 4,304 tests when each table row is one test). The drives end `PASS (30 checks)` (ranker), `PASS (20 checks)` (UI harness, unchanged), `PASS (20 checks)` (IPC) and `PASS (16 checks)` (Settings, with the K13 note), each with exit code 0; `verify-team-review-ui.mjs` prints a line with `"passed":true` and exits 0 (as it did before the edit). The byte counts print `TeamLaunchDialog.vue` `{bytes: 21090, crlf: 179, lf: 0, cr: 0}` when every text is exactly as specified, and `lf: 0, cr: 0` for the other three; `git diff --stat` reads `1 file changed, 71 insertions(+), 10 deletions(-)`; `git ls-files --eol` still prints `i/lf w/crlf` for all four. `git status --short` shows the four modified files (`routingView.ts`, `routingView.test.ts`, `TeamLaunchDialog.vue`, `verify-routing-settings-ui.mjs`), the three new files (`stores/routingTeam.ts`, `stores/routingTeam.test.ts`, `components/routing/HelperTierSelect.vue`) and the pre-existing entries unchanged. Record actual exit codes and output; a passing subset is not a full-suite pass.

## Acceptance Criteria

- `routingView.ts` exports every name in the specification, imports only `./routing`, and passes the purity, import and no-parse greps; HV1–HV12 pass with the stated values.
- HS1–HS11 pass; no store action throws to its caller; every recorded IPC argument is plain and cloneable, and the negative control throws `could not be cloned`.
- `HelperTierSelect.vue` takes `{ view, label }`, emits only `select`, imports `routingView` for types only, and renders the DOM of the specification.
- `TeamLaunchDialog.vue` contains exactly the specified insertions and replacements; its byte counts and `git diff --stat` match; `routingTier` is sent only as specified; the review-UI harness still passes.
- K13 is applied in exactly three places with one exact string; RV21 passes and the Settings drive passes 16 checks against a fresh build.
- `npm test`, `npm run grep:secrets` and the ranker, UI, IPC and Settings drives pass; the pre-existing worktree entries are untouched.

## Review Checklist

- [ ] The dialog sends only `routingTier` (a string primitive) on a helper member, only for an eligible slot and only for a tier; OpenRouter default sends nothing; no renderer-built routing object exists anywhere (K2, MR-G5).
- [ ] The dropdown appears only where main would route (K4): OpenCode, API key, a credential `routing:credentials` lists, the base or `:nitro` form of a registry model; the `openrouter/` prefix is stripped with `normalizeTeamModel` before the mirror.
- [ ] Ranking uses the `helper` profile, the slot's own credential and the slot's own effort, once per distinct key per open, and only free reads (K5, K11; no Refresh, Q2).
- [ ] Defaults follow K10 on every path (mount, Add helper, changed option, added member); a preset restores tiers by index; a preset helper with none shows OpenRouter default even on `:nitro` (Q8).
- [ ] A ranked option is selectable only when fresh and non-empty, with 4a's reason in its text; Nitro and OpenRouter default always (MR-D26); a restored unusable tier falls back with a visible hint.
- [ ] Launch and Save preset are disabled while routing loads, and both handlers refuse while it does; a load failure shows one line and leaves the helpers unrouted.
- [ ] No `window.chorus.routing` call when no slot wants routing (the review-UI harness's bridge has none).
- [ ] The tier select's accessible name is `Routing tier for helper N` and never starts with `Helper `.
- [ ] The store shares no state with `stores/routing.ts` or `stores/routingLaunch.ts`; it has no subscription, timer, refresh or write.
- [ ] `TeamLaunchDialog.vue` was edited byte-wise; every line is CRLF; every anchor and count was asserted before writing.
- [ ] K13 is identical in `routingView.ts:50`, RV21 and the Settings drive; no other Phase 3–4a expected value moved.
- [ ] Changes are limited to owned files; pre-existing work is preserved and not committed.
