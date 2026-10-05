# Implementation specification 3-4 — Settings → Model routing and the built-app drive

Paired [task](../Tasks/Task-3-4.md). Decisions: [roadmap](../roadmap.md) MR-D10, MR-D11, MR-D19; user decisions MR-D21 to MR-D24; gates MR-G1, MR-G4, MR-G5, MR-G7; [overview](../Tasks/Phase-3-Overview.md) K3, K5, K8–K10 and clarifications C11, C17–C20. Builds on ImplementationSpecs [3-1](ImplementationSpec-3-1.md), [3-2](ImplementationSpec-3-2.md) and [3-3](ImplementationSpec-3-3.md). **Not started.**

## Files and insertion points

Verified 2026-10-02 at `5079b5d`.

| File | Action |
|---|---|
| `src/renderer/src/views/SettingsRouting.vue` | New (LF). |
| `src/renderer/src/views/SettingsView.vue` | CRLF in the working tree; keep CRLF. Import after `SettingsProviders` (:3); `'routing'` in `SettingsSection` (:30); the nav row after the Providers row (:77–84); the content line after the Providers line (:130); the header comment (:17–28) and the template comment (:68–74) say six entries and name "Model routing". Nothing else. |
| `scripts/verify-routing-settings-ui.mjs` | New. Pattern: `scripts/verify-routing-ipc.mjs` (freshness :88–107, launch :116–131, kill :149–156, interrupt :182–196, connect :228–273, key scan :440–452, shutdown :464–486). |

## `SettingsView.vue` edits (normative)

```ts
import SettingsRouting from './SettingsRouting.vue' // after SettingsProviders (:3)
type SettingsSection = 'providers' | 'routing' | 'agent-lock' | 'voice' | 'appearance' | 'jev' // :30
```

```html
      <!-- after the Providers row (:77–84) -->
      <div
        class="set-nav-item"
        :class="section === 'routing' && 'set-nav-item-on'"
        data-settings-nav="routing"
        @click="section = 'routing'"
      >
        <div v-if="section === 'routing'" class="set-nav-spine"></div>
        <span class="set-nav-label">Model routing</span>
      </div>

      <!-- content, after the Providers line (:130) -->
      <SettingsRouting v-else-if="section === 'routing'" />
```

Comments: ":17 ⚠ FIVE LIVE ENTRIES NOW" becomes "SIX", with one added sentence: `"Model routing" (Model Routing Phase 3) followed the same order: the section first, the row with it, in one change.`; the template comment (:69) says "SIX live entries" and lists "Model routing" among the rows that arrived with their sections. The section stays component-local and unpersisted (:32–35), and the `v-if` chain remounts `SettingsRouting` on every visit, which is what reloads it (C17). `git diff --stat` must show only these lines.

## `SettingsRouting.vue` (normative)

**Imports.** `vue` (`computed`, `onBeforeUnmount`, `onMounted`, `ref`); the three components from `../components/routing/`; `useRoutingStore` from `../stores/routing`; `flashSaved` from `../composables/savedFlash`; from `../../../shared/routingView`: `ROUTING_PREVIEW_NOTE`, `ROUTING_NO_CREDENTIAL_HINT`, `ROUTING_REFRESH_COST_TEXT`, `ROUTING_PROFILE_LABELS`, `ROUTING_INSPECTOR_EFFORT`, `tierCardViews`, `nitroCardView`, `resultNotes`, `providerTableView`, `snapshotAgeView`, `refreshProgressView`, `cooldownRemainingSeconds`, `refreshButtonView`, `observationView`, `credentialOptionLabel`; `DEFAULT_ROUTING_SETTINGS` from `../../../shared/routing`. `<style src="../assets/settings.css"></style>` as every settings view.

**Lifecycle.**

```ts
const store = useRoutingStore()
const nowMs = ref(Date.now())          // C19: display only (age line, countdown, "last check")
const observeDraft = ref('')           // C11: the observation select's value; '' = none
let alive = true                       // F13, as SettingsVoice.vue
let release: (() => void) | null = null
let ticker: ReturnType<typeof setInterval> | null = null

onMounted(async () => {
  release = store.connect()
  ticker = setInterval(() => { nowMs.value = Date.now() }, 1_000) // never calls IPC (K3)
  await store.load()
  if (!alive) return
  observeDraft.value = store.observation?.credentialProfileId ?? ''
})
onBeforeUnmount(() => {
  alive = false
  release?.()
  if (ticker !== null) clearInterval(ticker)
})
```

No refresh is started on mount or by the ticker (K3).

**Computed views** (all from Task 3-2, never formatted here):

| Name | Value |
|---|---|
| `settings` | `store.settings ?? DEFAULT_ROUTING_SETTINGS` |
| `cards` | `tierCardViews(store.tiers, settings)` |
| `nitro` | `nitroCardView(store.tiers, store.model ?? '')` |
| `notes` | `store.tiers ? resultNotes(store.tiers) : []` |
| `table` | `store.tiers ? providerTableView(store.tiers) : null` |
| `age` | `store.tiers ? snapshotAgeView(store.tiers.snapshotFetchedAt, nowMs, settings.snapshotMaxAgeMinutes) : null` |
| `ownRefresh` | `store.refresh.model !== null && store.refresh.model === store.model` |
| `progress` | `ownRefresh ? refreshProgressView(store.refresh.events, store.refresh.phase) : null` |
| `cooldownSeconds` | `ownRefresh ? cooldownRemainingSeconds(store.refresh.endedAtMs, nowMs) : 0` |
| `button` | `refreshButtonView({ phase: ownRefresh ? store.refresh.phase : 'idle', cooldownSeconds, canRefresh: store.model !== null && store.credentialProfileId !== null })` |
| `refreshError` | `ownRefresh ? store.refresh.error?.message ?? null : null` (a pre-network refusal, including the cooldown `BUSY`, shows main's message here) |
| `tiersErrorText` | `store.tiersError && store.tiersError.code !== 'NO_SNAPSHOT' ? store.tiersError.message : null` |
| `observation` | `store.observation ? observationView(store.observation, store.status, store.credentials, nowMs) : null` |
| `errorText` | `store.loadError?.message ?? store.actionError?.message ?? null` |

**Template** (data attributes are normative; layout per `settings.css`):

| Block | Content |
|---|---|
| Root | `div.set-page.max-w-4xl[data-routing-section]` with `:data-routing-loaded="String(store.loaded)"`. Head: `h1.set-title` `Model routing`; `span.set-subtitle` `how OpenRouter endpoints rank for a model`. `p.set-hint[data-routing-preview-note]` = `ROUTING_PREVIEW_NOTE`. While `!store.loaded && store.loading`: `div.set-blank` `Loading…`. `p.set-hint.set-hint-warn[data-routing-error]` = `errorText` when set. |
| Inspect card (`div.set-card`) | `h2.set-section-title` `Inspect`. Selects, each `:value` plus `@change` calling the store action (never `v-model` on store state): `select.set-select.set-select-sm[data-routing-model]` (one option per `store.models`, value `slug`, text `displayName`) → `store.selectModel`; `select[data-routing-profile]` (values `interactive`, `helper`, texts from `ROUTING_PROFILE_LABELS`) → `store.selectProfile`; `select[data-routing-credential]` labelled "Refresh with" (one option per `store.credentials`, text `credentialOptionLabel(c)`; when the list is empty, one disabled option `No OpenRouter API-key credential` and the select disabled) → `store.selectCredential`. `p.set-hint[data-routing-effort]` = `Ranked for reasoning effort "low", fixed in this preview.` (K5; `ROUTING_INSPECTOR_EFFORT`). `p.set-hint.set-hint-warn[data-routing-no-credential]` = `ROUTING_NO_CREDENTIAL_HINT` when `store.credentials.length === 0`. `RoutingRefreshStatus` with `button`, `costText = ROUTING_REFRESH_COST_TEXT`, `progress`, `ageText = age?.text ?? null`, `staleText = age?.staleText ?? null`, `error = refreshError`, `@refresh="store.startRefresh()"`. `p.set-hint.set-hint-warn[data-routing-tiers-error]` = `tiersErrorText` when set. |
| Tiers | `RoutingTierCards` with `cards`, `nitro`, `notes`; then `RoutingProviderTable` with `table`. |
| Background observation card | `h2` `Background observation`. `p.set-hint`: `While Chorus runs, it records OpenRouter's endpoint numbers for the registry models every 30 minutes: one free request with the credential you choose. No prompts or code are sent, and 7 days of numbers are kept.` `input[type=checkbox][data-routing-observe]` labelled `Record endpoint numbers in the background`, `:checked="store.observation?.enabled === true"`, `:disabled="store.saving"`, `@change="onObserveToggle"`. `select[data-routing-observe-credential]` bound to `observeDraft` with `@change="onObserveCredential"`: option `''` `Choose a credential…`, one option per credential (`credentialOptionLabel`), and, when `observation.designatedUsable` is false, one extra option with value `designatedId` and text `A credential that can no longer be used`. Lines `[data-routing-observe-state]` = `stateText`; `[data-routing-observe-warning]` (`set-hint-warn`) = `warning`; `[data-routing-observe-last]` = `lastText`; `[data-routing-observe-next]` = `nextText`; `[data-routing-observe-hint]` = `credentialHint` — each only when not null. |
| Data collection card | `h2` `Data collection`. `input[type=checkbox][data-routing-data-collection]` labelled `Allow providers that may store or train on prompts`, `:checked="store.settings?.dataCollection === 'allow'"`, `:disabled="store.saving"`, `@change="onDataCollection"`. `p.set-hint`: `Off (the default), every tier asks OpenRouter only for providers that do not collect prompt data (data_collection: deny). On, those providers can be ranked and chosen too.` (MR-D11, MR-D24). |

**Handlers** (K9 apply-immediately; `flashSaved()` only after a write main accepted):

```ts
async function onObserveToggle(event: Event): Promise<void> {
  const target = event.target as HTMLInputElement
  const enabled = target.checked
  // MR-D23 / C11: on carries the select's value (or null); off always clears the designation.
  const ok = await store.setObservation(enabled, enabled ? observeDraft.value || null : null)
  if (!alive) return
  if (ok) {
    if (!enabled) observeDraft.value = ''
    flashSaved()
  }
  target.checked = store.observation?.enabled === true // re-sync after a refusal
}

async function onObserveCredential(event: Event): Promise<void> {
  const value = (event.target as HTMLSelectElement).value
  observeDraft.value = value
  if (store.observation?.enabled !== true) return // C11: a local draft while off; nothing is designated
  const ok = await store.setObservation(true, value || null)
  if (!alive) return
  if (ok) flashSaved()
  else observeDraft.value = store.observation?.credentialProfileId ?? ''
}

async function onDataCollection(event: Event): Promise<void> {
  const target = event.target as HTMLInputElement
  const ok = await store.setDataCollection(target.checked ? 'allow' : 'deny') // MR-D24: read-modify-write in the store
  if (!alive) return
  if (ok) flashSaved()
  target.checked = store.settings?.dataCollection === 'allow'
}
```

A refused designation shows main's `CREDENTIAL_REFUSED` message through `errorText` (K8). Leaving the section mid-refresh releases the progress subscription; the refresh completes in main and the store records its reply, but events that arrived while away are not replayed (the next visit shows the reply's state and the reloaded tiers).

## `scripts/verify-routing-settings-ui.mjs`

Zero cost: no credential, no key, no OpenRouter request. Prerequisite: `npx electron-vite build` (dev never rebuilds MAIN on edit; a stale build would test stale code).

1. **Header comment:** what it checks, that it spends nothing, the prerequisite, the process-safety rules.
2. **Freshness.** As `verify-routing-ipc.mjs:88–107` (main bundle not older than the routing services, cores, `shared/routing.ts`, `src/main/index.ts` and the preload; `out/preload/index.js` contains `routing:credentials`), plus: `out/renderer/index.html` exists; the newest `out/renderer/assets/*.js` is not older than the newest of `SettingsRouting.vue`, `SettingsView.vue`, `components/routing/*.vue`, `stores/routing.ts`, `src/shared/routingView.ts` and `src/shared/routing.ts`; some `out/renderer/assets/*.js` contains `Preview only: launches do not use these tiers yet.`. Otherwise print `FAIL build is stale: run npx electron-vite build` and exit 1.
3. **Seed helpers.** `OUT = <ROOT>/_verify/routing-settings-ui`, emptied first. Bundle with esbuild as `verify-routing-body.mjs:20` (`stdin`, `resolveDir: ROOT`, `bundle: true`, `platform: 'node'`, `format: 'cjs'`, `packages: 'external'`) an entry re-exporting `parseEndpointsResponse`, `extractObservations` (`src/main/routing/endpointsCore`) and `modelDirName`, `snapshotFileText`, `observationsFileText` (`src/main/routing/storeCore`) into `OUT/seed-<pid>.cjs`; `require` it. The bundle is deleted in every exit path.
4. **Launch, connect, shutdown, interrupt** exactly as `verify-routing-ipc.mjs` (:116–131, :149–196, :228–273, :464–486): a free port, `profile = mkdtemp(<os tmpdir>/chorus-routing-settings-)`, env without `ELECTRON_RUN_AS_NODE` and `ELECTRON_RENDERER_URL`, its own child only, `taskkill /pid <its pid> /F` as the last resort, never by name, never port 9222, never `%APPDATA%\chorus*`. After connecting: `Runtime.enable`, and record `Runtime.exceptionThrown` and `Runtime.consoleAPICalled` events of type `error` into `rendererErrors`, plus the page `unhandledrejection` watcher of the IPC drive.
5. **DOM helpers.** `waitFor(expression, ms)` polls `Runtime.evaluate` every 200 ms; `click(selector)` runs `document.querySelector(selector).click()` (a checkbox click toggles it and fires `input` and `change`); `choose(selector, value)` sets `.value` and dispatches `input` and `change`, both bubbling (`team-member-ui-checks.mjs:7–10`; assigning `.value` alone leaves a Vue model unchanged and makes the bug look like the app's). `shot(name)` writes `Page.captureScreenshot` PNG data to `OUT/<name>`.
6. **Navigate.** Wait up to 30 s for `button[aria-label="Open settings"]` (`ProjectRail.vue:899`); clear `rendererErrors`; click it; wait for `[data-settings-nav="routing"]`; click it; wait up to 15 s for `[data-routing-section][data-routing-loaded="true"]`. A missing element fails the drive with a one-line DOM summary.
7. **Checks U1–U7** (empty throwaway profile), screenshot `empty-state.png` after U4.
8. **Seed.** `fetchedAt` = the ISO string of `floor(Date.now() / 1000) × 1000 − 300,000` (five minutes ago, whole seconds; never in the future, or `routing:tiers` answers `INVALID_TIME`). From the golden fixture (`src/main/routing/__fixtures__/endpoints-deepseek-v4.1-flash-2026-10-02.json`): `endpoints = parseEndpointsResponse(json).endpoints`; write `snapshotFileText(SLUG, { fetchedAt, endpoints })` and `observationsFileText(SLUG, extractObservations({ fetchedAt, endpoints }))` to `<profile>/routing/<modelDirName(SLUG)>/snapshot.json` and `observations.json` (directory created recursively; each written to a temp name, then renamed). No cache or account file is written: the profile has no credential.
9. **Re-enter.** Click `[data-settings-nav="voice"]`, wait for the routing section to unmount, click `[data-settings-nav="routing"]`, wait for `data-routing-loaded="true"` and for `[data-routing-tier="budget"][data-routing-tier-state="ranked"]`.
10. **Checks U8–U13**, screenshots `seeded-cards.png` after U10 and `seeded-providers.png` after U11.
11. **Shutdown**, then U14, U15, delete the profile and the bundle (`cleanup`), and print `PASS (16 checks)` (exit 0) or `FAIL (k of 16 checks)` (exit 1). On failure, print the last 30 lines of the app log as the IPC drive does (:502–506).

`SLUG` = `deepseek/deepseek-v4.1-flash`. `DEFAULTS` is a hand-written copy of `DEFAULT_ROUTING_SETTINGS`, as `verify-routing-ipc.mjs:41–56` holds. Calls marked "in the page" run `window.chorus.routing.*` with object literals written in the page, collected for U15.

| # | Check | Expect |
|---|---|---|
| U1 | Nav and section | `[data-settings-nav="routing"]` text `Model routing` and class `set-nav-item-on`; `h1` `Model routing`; `[data-routing-preview-note]` `Preview only: launches do not use these tiers yet.` |
| U2 | Inspector inputs | `[data-routing-model]`: one option, value `deepseek/deepseek-v4.1-flash`, text `DeepSeek V4.1 Flash`, selected. `[data-routing-profile]`: options `interactive`/`Interactive`, `helper`/`Team helper`, value `interactive`. `[data-routing-effort]` `Ranked for reasoning effort "low", fixed in this preview.` |
| U3 | No credential | `[data-routing-credential]` disabled with no enabled option; `[data-routing-no-credential]` `Add an OpenRouter API-key credential under Providers & keys first.`; `[data-routing-refresh]` disabled, text `Refresh`, title `Choose a model and an OpenRouter API-key credential first.`; `[data-routing-cost]` `A refresh fetches the endpoint list and checks account eligibility (both free), then may spend up to about $0.05 of OpenRouter credit verifying prompt caching. The estimate is shown before anything is spent.` |
| U4 | No snapshot | `[data-routing-tier]` `budget`, `balanced`, `fast` with state `no-snapshot` and reason `No endpoint numbers for this model yet. Refresh to rank it.`; `nitro` with state `no-snapshot`; no `[data-routing-providers-toggle]`; no `[data-routing-age]`; no `[data-routing-tiers-error]`. |
| U5 | Observation default | `[data-routing-observe]` checked; `[data-routing-observe-state]` `On, but nothing is recorded until you choose a credential.`; `[data-routing-observe-hint]` `Add an OpenRouter API-key credential under Providers & keys first.` |
| U6 | Observation off and on | Click `[data-routing-observe]`; wait until unchecked and saving ends; in the page `observationGet({})` → `{ ok: true, value: { enabled: false, credentialProfileId: null } }`; state `Off. Chorus makes no background requests.`. Click again → `{ enabled: true, credentialProfileId: null }`, checked, state as U5. |
| U7 | Data collection round trip | `[data-routing-data-collection]` unchecked. Click; wait; in the page `settingsGet({})` → `{ ...DEFAULTS, dataCollection: 'allow' }` (deep-equal) and the box checked. Click again → `DEFAULTS`, unchecked. |
| U8 | Seeded tiers match main | In the page `tiers({ model: SLUG, profile: 'interactive', effort: 'low', credentialProfileId: null })` → `ok`. For each of `budget`, `balanced`, `fast`: card state `ranked`; `[data-routing-primary]` = the reply's `tiers[t].endpoints[0]`; `[data-routing-fallbacks]` = `Fallbacks: ` + the rest joined by `, ` (or `No fallback available.`). Golden tier orders are not asserted (C18). |
| U9 | Nitro card | `[data-routing-nitro-label]` `Nitro — unfiltered provider routing`; the Nitro card has class `routing-card-nitro`, computed `border-left-width` `2px`, `border-left-color` `rgb(245, 158, 11)`; `[data-routing-nitro-likely]` `Likely: Together (together) · 223 tok/s`; `[data-routing-nitro-warning]` `Likely provider: Together (together), quantization not declared.` |
| U10 | Age and notes | `[data-routing-age]` matches `^Updated [5-9] min ago$`; no `[data-routing-stale]`; `[data-routing-note]` texts exactly `Account guardrails were not checked; a pinned endpoint may be refused.`, `Data-policy removals were not checked.`, `Limited history: 14 of 14 eligible endpoints have fewer than 3 speed observations.`, and equal to U8's reply `warnings`. |
| U11 | Providers table | Toggle `Show all providers (14 eligible · 18 excluded)`, 0 rows; click it; 32 `[data-routing-provider-row]`; the first 14 `data-eligible="true"`; the `alibaba` row's status `Excluded: uptime 97.18% < 99.5%; currently degraded (5m uptime 92.3%); status -2; quantization not declared`. |
| U12 | Stored data, no request | In the page `status({})`: `requestsSinceStart` 0; the model's `snapshotFetchedAt` equals the seeded `fetchedAt` and `observations` is 32. |
| U13 | Refresh stays unavailable | `[data-routing-refresh]` disabled; no `[data-routing-progress]`. |
| U14 | No renderer errors | `rendererErrors` and the page's unhandled rejections, since step 6, are empty; none mentions `could not be cloned`. |
| U15 | No key material | `document.body.innerText` at U13 and every in-page response match none of the patterns in `src/main/services/secret-patterns.json`, with the IPC drive's positive control (`verify-routing-ipc.mjs:440–452`). |
| `cleanup` | | The profile and the seed bundle are deleted; `OUT` holds only `empty-state.png`, `seeded-cards.png`, `seeded-providers.png`. |

Why these assertions are exact although the seed has no credential and no cache (C18): eligibility (14 of 32) depends on uptime, precision, status and capabilities, not on price or time; Nitro's likely endpoint is the fastest capable endpoint regardless of price; the notes are W2 and W3 (account unknown, data collection `deny`) and the limited-history line (one observation per tag). Tier order does depend on blended price, which time-of-day overrides (MR-D13) change with the wall clock, so U8 compares against main's own reply instead.

## Invariants

- The section is reachable only through its nav row; the row and the section ship together (D76, C17).
- No timer, mount or render triggers IPC beyond `store.load()` on mount; no refresh without a click (K3, C19).
- Every renderer-to-main payload is built by a store action from a JSON snapshot (MR-G5); the view builds none.
- Turning observation off always clears the designation; a credential is designated only by choosing it while observation is on (MR-D23, C11).
- Nothing in the section is selectable or affects a launch (MR-D21); the preview note says so (C20).
- The drive tests a fresh build in a throwaway profile, makes no OpenRouter request, stops only its own child by pid, and leaves only three PNGs.

## Verification

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

The built-app drive is this task's runtime check (MR-G1, MR-G5): paste its full output and exit code; it must end `PASS (16 checks)`, and the two earlier drives must still pass (`PASS (19 checks)`, `PASS (15 checks)`). Never point a drive at the user's profile or at an already-running instance; each launches its own. For an ad-hoc look at the dev app instead, use `$env:REMOTE_DEBUGGING_PORT='9333'` with a throwaway `--user-data-dir`, and relaunch after any main-process edit. Record `git diff --stat src/renderer/src/views/SettingsView.vue` (only the insertions and comment lines above) and one sentence per screenshot.
