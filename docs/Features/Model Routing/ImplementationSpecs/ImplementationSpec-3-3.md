# Implementation specification 3-3 — Presentational components and the isolated visual harness

Paired [task](../Tasks/Task-3-3.md). Decisions: [roadmap](../roadmap.md) MR-D5, MR-D10, MR-D11; user decision MR-D21; gates MR-G1, MR-G7; [overview](../Tasks/Phase-3-Overview.md) K2, K3, K6, K7 and clarifications C15, C16. View models from [ImplementationSpec-3-2](ImplementationSpec-3-2.md). **Not started.**

## Files and insertion points

Verified 2026-10-02 at `5079b5d`.

| File | Action |
|---|---|
| `src/renderer/src/components/routing/RoutingTierCards.vue` | New. Plan_1's `ProviderTierCards.vue` (`Plan_1.md:600`), renamed for the feature. |
| `src/renderer/src/components/routing/RoutingProviderTable.vue` | New. Plan_1's `ProviderTable.vue` (`Plan_1.md:601`). |
| `src/renderer/src/components/routing/RoutingRefreshStatus.vue` | New. Plan_1's "Fetch latest numbers" control and progress (`Plan_1.md:68–71`). |
| `scripts/verify-routing-ui.mjs` | New. Pattern: `scripts/verify-team-review-ui.mjs:8–49`. |

`components/routing/` is the first subdirectory under `components/` (Plan_1 used `components/newSession/`). Plan_1's `ModelPicker.vue` (`Plan_1.md:599`) is not built: the inspector's model select lives in `SettingsRouting.vue` (Task 3-4), and the launch-dialog picker is Phase 4 (MR-D21). New files are written with LF line endings.

## Shared component rules (normative)

- **Imports:** `vue` and type-only imports from `../../../../shared/routingView`. Nothing else: no store, no `window.chorus`, no composable, no clock (C15).
- **Text:** every visible string is a field of a view model or a fixed label listed below, rendered with `{{ }}`. No `v-html`. No number is formatted in a template.
- **Styling:** `<style scoped>` plus the shared `settings.css` classes listed below (imported unscoped by the hosting view, as every settings SFC does). No Tailwind utility classes, so the look does not depend on Tailwind's source scanning in the harness's vite root. Colours only through `main.css` tokens.
- **Not selectable (MR-D21):** cards and rows have no click, keyboard or selection handler, no `tabindex`, no hover affordance that suggests a choice. The only interactive elements are the Refresh button and the table toggle, both real `<button type="button">`.

## `RoutingTierCards.vue`

```ts
defineProps<{ cards: TierCardView[]; nitro: NitroCardView; notes: string[] }>()
// no emits
```

Structure and data attributes (the harness and the Task 3-4 drive select on them):

| Element | Attributes and content |
|---|---|
| Wrapper | `div.routing-cards[data-routing-cards]`: CSS grid, `grid-template-columns: repeat(auto-fit, minmax(190px, 1fr))`, `gap: 10px`. |
| Ranked card (one per `cards` entry, in order) | `section.set-card.routing-card[data-routing-tier=<tier>][data-routing-tier-state=<state>]`. Header: `card.label` and, when `limitedHistory`, `span.set-chip.set-chip-idle[data-routing-limited]` reading `limited history`. |
| Primary (when `primary`) | `[data-routing-primary]` = `primary.tag` (mono) with a quant badge `primary.quantization`; `primary.providerName`; `[data-routing-metric]` lines `priceText`, `speedText` · `effectiveText`, `latencyText` · `uptimeText`; chips `[data-routing-cache-verified]` `cache verified` when `cacheVerified`, `[data-routing-time-of-day]` `time-of-day price` when `timeOfDayPrice`; `[data-routing-fallbacks]` = `fallbackText`. |
| Reason | `[data-routing-reason]` = `card.reason` (present in every state). |
| Notes on a card | One `p.set-hint.set-hint-warn[data-routing-card-note]` per `card.notes` entry. |
| Nitro card (last) | `section.set-card.routing-card.routing-card-nitro[data-routing-tier="nitro"][data-routing-tier-state=<nitro.state>]`: `[data-routing-nitro-label]` = `nitro.label`; `nitro.model` (mono); when `likely`, `[data-routing-nitro-likely]` = `` `Likely: ${likely.providerName} (${likely.tag}) · ${likely.speedText}` ``; `[data-routing-nitro-warning]` = `nitro.warning`; one `li[data-routing-nitro-caveat]` per caveat. |
| Notes list (below the grid, only when `notes.length > 0`) | `ul[data-routing-notes]` with one `li[data-routing-note]` per entry. |

**The Nitro edge.** `.routing-card-nitro { border-color: color-mix(in srgb, var(--color-state-attention) 30%, var(--color-border-inset)); border-left: 2px solid var(--color-state-attention); }`, after the `.set-card-protected` precedent (`settings.css:213–217`) but solid, because this is a warning rather than a "set aside" state. Ranked cards keep `.set-card`'s 1 px border. The label text, not the colour alone, carries the meaning.

## `RoutingProviderTable.vue`

```ts
defineProps<{ table: ProviderTableView | null }>()
// no emits; local state: const open = ref(false)
```

- `table === null` renders nothing (no toggle).
- Toggle: `button.set-action[data-routing-providers-toggle]`, `aria-expanded` bound to `open`, text `open ? table.hideText : table.showText`. Collapsed by default (K7).
- When open: `div.routing-providers` with `overflow-x: auto` (narrow widths scroll inside the box, never the page), containing a header row and one row per `table.rows` entry, in order. Each row is a CSS grid (`EngineUsagePanel.vue:190–196` precedent) with `grid-template-columns: minmax(170px, 1.7fr) 0.8fr 0.8fr repeat(4, 0.9fr) 0.9fr 0.7fr minmax(170px, 2.2fr)` and `min-width: 980px`.
- Header labels, in order: `Provider / tag`, `Quant`, `Uptime 1d`, `Input`, `Output`, `Cache read`, `Blended`, `TPS`, `Latency`, `Status`.
- Row: `div.routing-provider-row[data-routing-provider-row][data-tag=<tag>][data-eligible="true"|"false"]`; cells `[data-col]` = `provider` (tag in mono, `providerName`, `rowsText` when set, chips `[data-routing-limited]` `limited history`, `[data-routing-cache-verified]` `cache verified`, `[data-routing-time-of-day]` `time-of-day price` when their flags are true), `quant`, `uptime`, `input`, `output`, `cache`, `blended`, `speed`, `latency`, `status`. The status cell uses `.set-row-ok` when eligible and `.set-row-warn` when excluded (`settings.css:503–513`).

## `RoutingRefreshStatus.vue`

```ts
defineProps<{
  button: RefreshButtonView
  costText: string
  progress: RefreshProgressView | null
  ageText: string | null
  staleText: string | null
  error: string | null
}>()
defineEmits<{ refresh: [] }>()
```

| Element | Attributes and content |
|---|---|
| Button | `button.set-btn-primary[data-routing-refresh]`, `type="button"`, `:disabled="button.disabled"`, `:title="button.title"`, text `button.text`; `@click` emits `refresh` (a disabled button fires no click). |
| Cost | `p.set-hint[data-routing-cost]` = `costText`, always shown (MR-D21: the action states its cost before it runs). |
| Age | `[data-routing-age]` = `ageText` when not null; `p.set-hint.set-hint-warn[data-routing-stale]` = `staleText` when not null. |
| Progress | When `progress`: `ol[data-routing-progress][data-routing-progress-state=<state>]` with one `li[data-routing-progress-line]` per line; `[data-routing-estimate]` = `estimateText` when not null; `[data-routing-spent]` = `spentText` when not null. The estimate is styled prominently (it is the MR-G7 statement). |
| Error | `p.set-hint.set-hint-warn[data-routing-refresh-error]` = `error` when not null. |

## `scripts/verify-routing-ui.mjs`

Zero cost: no app, no profile with data, no credential, no network. It needs only `node_modules` (Electron, vite, `@vitejs/plugin-vue`, `@tailwindcss/vite`, esbuild; all present).

1. **Header comment:** what it checks, that it spends nothing and starts no Chorus instance, and that it leaves only PNGs in `_verify/routing-ui/`.
2. **Paths.** `ROOT` from `import.meta.url` (the script works from any cwd); `OUT = <ROOT>/_verify/routing-ui`; `rmSync(OUT, { recursive: true, force: true })`, then `mkdirSync`.
3. **States in Node (C16).** Bundle with esbuild, as `verify-routing-body.mjs:20` does (`stdin` with `resolveDir: ROOT`, `bundle: true`, `platform: 'node'`, `format: 'cjs'`, `packages: 'external'`), an entry re-exporting `computeTiers` (`src/main/routing/routingCore`), `parseEndpointsResponse` and `extractObservations` (`endpointsCore`), `bundledModelRegistry` and `findModel` (`registryCore`) and `DEFAULT_ROUTING_SETTINGS` (`src/shared/routing`), into `OUT/cores.cjs`; `require` it. Build the Phase 1 golden input (ImplementationSpec-1-3 "Golden input"; `now` `2026-10-02T09:20:00Z`) and compute, with their settings: `golden` (defaults); `empty` (`minUptimePct` and `readmitUptimePct` 100); `floor130` (`budgetMinTps` 130); `floor1000` (`budgetMinTps` 1000); `nitroPass` (the rows with `together`'s `quantization` set to `'fp8'`). Write `OUT/states.json` as `{ <name>: { result, settings } }`.
4. **Fixture.** Write `OUT/index.html` with the team harness's CSP (`verify-team-review-ui.mjs:19`) and a module script `/fixture.ts`, and `OUT/fixture.ts`, which: imports `createApp`, `h`, `reactive` from `vue`; `src/renderer/src/assets/main.css` and `settings.css`; the three components; the view functions from `src/shared/routingView`; `./states.json`. It keeps `const view = reactive({ state: 'golden' })`, exposes `window.__show = (name) => { view.state = name }` and `window.__refreshClicks = 0`, and renders, for `view.state`, the three components with view models built **in the page by the real `routingView` functions** (never hand-written props), at `NOW_MS = Date.parse('2026-10-02T09:20:00Z')`, and with the RV14 event fixtures of ImplementationSpec-3-2. It never defines `window.chorus`. States:

| State | Cards and table | Refresh status |
|---|---|---|
| `golden` | `golden` | `refreshButtonView({ phase: 'idle', cooldownSeconds: 0, canRefresh: true })`; age from `snapshotAgeView(fetchedAt, NOW_MS, 60)`; no progress; `@refresh` increments `__refreshClicks` |
| `no-snapshot` | `tierCardViews(null, defaults)`, `nitroCardView(null, slug)`, table `null`, notes `[]` | idle button; `ageText` and `staleText` `null` |
| `empty`, `floor130`, `floor1000`, `nitro-pass` | that state | idle button; its age |
| `running` | `golden` | phase `running`; progress over endpoints, preflight, plan and three probes |
| `done` | `golden` | phase `done`; the full sequence with `done`; cooldown 0 |
| `cooldown` | `golden` | phase `done`; the full sequence; `cooldownSeconds` 42 |
| `failed` | `golden` | phase `failed`; `[failed]` |

5. **Build.** `vite.build({ configFile: false, root: OUT, base: './', plugins: [vue(), tailwindcss()], build: { outDir: 'dist', emptyOutDir: true }, logLevel: 'warn' })` (`main.css` imports Tailwind, `main.css:24`).
6. **Runner.** Write `OUT/runner.cjs` and spawn `require('electron')` with it (env without `ELECTRON_RUN_AS_NODE`, `windowsHide: true`), as `verify-team-review-ui.mjs:38–49`. The runner: `app.disableHardwareAcceleration()`; `app.setPath('userData', OUT/profile)`; records and cancels every `http`, `https`, `ws` and `wss` request through `session.defaultSession.webRequest.onBeforeRequest`; opens an offscreen `BrowserWindow` (`show: false`, 1280 × 900, `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `offscreen: true`); collects console errors as the precedent does (:42); loads `dist/index.html`; for each check switches state with `__show`, waits for the DOM, asserts, and saves the named PNG with `capturePage()`; prints one JSON line `{ "results": [{ "name", "ok", "detail" }] }`; quits.
7. **Parent.** Waits up to 180 s for the child, then `child.kill()` on its own handle (never by process name). Prints `ok <name>` or `FAIL <name>: <detail>` per check, deletes everything under `OUT` except `*.png` (the bundle, `states.json`, the fixture, `dist/`, the runner, the profile), and ends with `PASS (15 checks)` (exit 0) or `FAIL (k of 15 checks)` (exit 1). A runner that printed no result line fails every check with the child's exit code as the detail.

The expected strings below are written into the script by hand (from ImplementationSpec-3-2), never imported from the code under test. `LIMITED_14` is `Limited history: 14 of 14 eligible endpoints have fewer than 3 speed observations.`

| # | State, action | Expect | PNG |
|---|---|---|---|
| H1 | `golden` | `[data-routing-tier]` in order `budget`, `balanced`, `fast`, `nitro`, states `ranked`, `ranked`, `ranked`, `likely`. `[data-routing-primary]` `deepinfra/fp8`, `deepinfra/fp8`, `venice/fp8`. Budget `[data-routing-fallbacks]` `Fallbacks: streamlake/fp8, gmicloud/fp8`; Budget `[data-routing-reason]` `First of 12 endpoints at or above the 45.3 tok/s Budget floor, scored mostly on price.`; the Budget card's text contains `$0.0165/M blended`; the Fast card's contains `186 tok/s`. Three `[data-routing-limited]` chips. | `cards.png` |
| H2 | `golden` | `[data-routing-nitro-label]` `Nitro — unfiltered provider routing`. The Nitro card's computed `border-left-width` is `2px` and `border-left-color` `rgb(245, 158, 11)`; the Budget card's `border-left-color` differs. `[data-routing-nitro-likely]` `Likely: Together (together) · 223 tok/s`; `[data-routing-nitro-warning]` `Likely provider: Together (together), quantization not declared.`; three `[data-routing-nitro-caveat]`. | — |
| H3 | `golden` | `[data-routing-note]` texts `[LIMITED_14]`. | — |
| H4 | `golden` | `[data-routing-providers-toggle]` text `Show all providers (14 eligible · 18 excluded)`, `aria-expanded="false"`; zero `[data-routing-provider-row]`. | — |
| H5 | `golden`, click the toggle | Toggle `Hide providers`; 32 rows; the first 14 `data-eligible="true"`, the rest `"false"`. Row `deepinfra/fp8` cells `uptime` … `latency`: `99.96%`, `$0.140/M`, `$0.420/M`, `$0.00420/M`, `$0.0165/M`, `63 tok/s`, `1.43 s`; `status` `Eligible`. Row `baseten/fp8` `provider` cell contains `2 endpoints`. Row `baseten/fast` `status` `Eligible · below the Budget floor`. Row `alibaba` `status` `Excluded: uptime 97.18% < 99.5%; currently degraded (5m uptime 92.3%); status -2; quantization not declared`, with `[data-routing-time-of-day]`. Row `together` has `[data-routing-cache-verified]`. | `providers.png` |
| H6 | `no-snapshot` | Three cards `no-snapshot` with reason `No endpoint numbers for this model yet. Refresh to rank it.`; Nitro state `no-snapshot`, warning `Unfiltered: OpenRouter picks the provider. Refresh to see which one is likely.`, no `[data-routing-nitro-likely]`; no toggle; no `[data-routing-age]`. | `no-snapshot.png` |
| H7 | `empty` | Three cards `empty`, reason `No provider meets the uptime and precision rules right now.`; Nitro warning `Likely provider: Together (together), uptime 99.96% < 100%, quantization not declared.`; notes `Budget: no eligible endpoints.`, `Balanced: no eligible endpoints.`, `Fast: no eligible endpoints.`. | `empty.png` |
| H8 | `floor130`; then `floor1000` | `floor130`: Budget `[data-routing-card-note]` `12 eligible endpoints are below the 130 tok/s Budget floor.` and fallbacks `Fallbacks: baidu/fp8`. `floor1000`: Budget state `empty`, reason `All 14 eligible endpoints are below the 1000 tok/s Budget floor.`; Balanced and Fast `ranked`. | `budget-floor.png` (of `floor130`) |
| H9 | `nitro-pass` | Nitro warning `Unfiltered, but the likely provider currently passes the uptime and precision rules.` | `nitro-passes.png` |
| H10 | `running` | `[data-routing-progress-line]` texts: `Endpoints: 33 rows, 32 tags`, `Account: guardrails removed deepseek; data policy removed deepseek`, `Cache probe: 14 endpoints, estimated $0.0494 (cap $0.05)`, `Probing caches: 3 of 14 (spent $0.0045 so far)`. `[data-routing-estimate]` `Estimated $0.0494`; no `[data-routing-spent]`. Button `Refreshing…`, disabled. | `progress-running.png` |
| H11 | `done` | Lines: the first three of H10, `Probing caches: 14 of 14`, `Done. Spent $0.021 of an estimated $0.0494.`. `[data-routing-spent]` `Spent $0.021`. Button `Refresh`, enabled. | `progress-done.png` |
| H12 | `failed` | Lines exactly `Failed: OpenRouter returned an error. Spent $0.00.`; `[data-routing-progress-state="failed"]`. | `progress-failed.png` |
| H13 | `cooldown`, click the button | Button `Refresh again in 42 s`, disabled; `__refreshClicks` stays 0. | `cooldown.png` |
| H14 | `golden`, click the button once | Button `Refresh`, enabled, `title` and `[data-routing-cost]` both `A refresh fetches the endpoint list and checks account eligibility (both free), then may spend up to about $0.05 of OpenRouter credit verifying prompt caching. The estimate is shown before anything is spent.`; `[data-routing-age]` `Updated 15 min ago`; `__refreshClicks` 1. | — |
| H15 | Across the run; then `golden` with the table open at 1280 px and after `win.setSize(900, 900)` | No console error; `typeof window.chorus === 'undefined'`; zero recorded network requests; `document.documentElement.scrollWidth <= window.innerWidth` at both widths. | `narrow.png` (900 px) |

## Invariants

- The components hold no state but the table's `open` flag; they read only their props; they import nothing but Vue and `routingView` types (C15).
- No card or row is selectable (MR-D21); the Refresh button never emits while disabled.
- Every displayed string is a view-model field or one of the fixed labels above; nothing is rendered through `v-html`.
- The harness computes results in Node, builds view models in the page with the real functions, makes no network request, starts no Chorus instance, stops only its own child, and leaves only PNGs (C16).

## Verification

```powershell
npm run typecheck
npm test
node scripts/verify-routing-ui.mjs
Get-ChildItem _verify/routing-ui
npm run grep:secrets
git diff --check
git status --short
```

The harness is this task's runtime check (MR-G1): paste its full output and exit code; it must end `PASS (15 checks)`. `Get-ChildItem _verify/routing-ui` must list exactly `budget-floor.png`, `cards.png`, `cooldown.png`, `empty.png`, `narrow.png`, `nitro-passes.png`, `no-snapshot.png`, `progress-done.png`, `progress-failed.png`, `progress-running.png`, `providers.png`. Look at each screenshot and record one sentence per image (Plan_1's sketch is a guide, not the authority; no D73 mock covers routing). Run `npm run grep:secrets` after the harness, since it scans `_verify/`.
