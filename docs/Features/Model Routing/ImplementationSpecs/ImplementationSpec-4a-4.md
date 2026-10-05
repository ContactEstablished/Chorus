# Implementation specification 4a-4 — The launch-dialog tier picker

Paired [task](../Tasks/Task-4a-4.md). Decisions: [roadmap](../roadmap.md) MR-D4, MR-D10, MR-D11, MR-D19, MR-D21, MR-D22; user decisions MR-D25 to MR-D28; gates MR-G1, MR-G5, MR-G8; [overview](../Tasks/Phase-4a-Overview.md) K1–K4, K7–K9, K12–K14 and clarifications C23–C35. Contracts from [ImplementationSpec-4a-1](ImplementationSpec-4a-1.md) (the "Phase 4a — launch routing (Task 4a-1)" block of `src/shared/routing.ts`, `RoutingApi.launchPreferences`) and [ImplementationSpec-4a-3](ImplementationSpec-4a-3.md) (`launchRequestSchema.routing_tier`); Phase 3 contracts from ImplementationSpecs [3-2](ImplementationSpec-3-2.md) and [3-3](ImplementationSpec-3-3.md). **Not started.**

Test IDs: **LV** (launch view model, a new table in `routingView.test.ts`), **LS** (launch store), **H16–H20** (continuing the Phase 3 harness).

## Files and insertion points

Verified 2026-10-03 at `a57ef1b` (each file opened this session). Tasks 4a-1 to 4a-3 touch none of the files this task edits; the `src/main/ipc.ts` lines cited for main's precedence are at `a57ef1b`, before Task 4a-3 edits that file, and this task cites no line of `src/shared/routing.ts`.

| File | Line endings | Action |
|---|---|---|
| `src/shared/routingView.ts` (504 lines) | LF | Extend the top import (:1–17) with the 4a-1 names below; append a "Phase 4a — launch (Task 4a-4)" block after the last line (:504). One Phase 3 line changes: `ROUTING_PREVIEW_NOTE` (:46), K14. |
| `src/shared/routingView.test.ts` (736 lines) | LF | Append `describe('Table LV — launch view model (Task 4a-4)')`, reusing `golden` (:100), `stale` (:103), `empty` (:104) and `floor1000` (:106). Add the new names to the import (:15–43). RV21's preview-note expectation (:727) changes with K14. |
| `src/renderer/src/stores/routingLaunch.ts`, `routingLaunch.test.ts` | new, LF | `useRoutingLaunchStore` and Table LS. Pattern: `stores/routing.ts` (:24–39 helpers, :56–59 module state, :83–101 subscription and adoption, :136–157 sequenced tiers, :188–210 refresh). |
| `src/renderer/src/components/routing/RoutingTierCards.vue` (224 lines) | LF | One optional prop `selection` and one emit `select` (props today :20; the comment at :10–13 announces this). Off by default; Settings passes nothing (`SettingsRouting.vue:233`). |
| `src/renderer/src/components/LaunchDialog.vue` (2,095 lines) | **mixed**: 2,088 CRLF, 7 lone LF (lines 33, 34, 35, 1102, 1103, 1117, 1118), 0 lone CR — measured byte-wise 2026-10-03 | Seven insertions and one one-line replacement, below. Edited byte-wise only (see "Byte-safe edit", C35). |
| `scripts/verify-routing-ui.mjs` (762 lines) | LF | States and checks H16–H20; `PASS (15 checks)` → `PASS (20 checks)` (recorded amendment, K12). |
| `scripts/verify-routing-settings-ui.mjs` (909 lines) | LF | One line: the constant `PREVIEW_NOTE` (:68), K14. Its freshness check (:159) and U1 (:592) read it; the drive still ends `PASS (16 checks)`. |

No main, preload, `src/shared/routing.ts` or `src/shared/ipc.ts` change in this task; no `TeamLaunchDialog.vue`, `SettingsRouting.vue`, `SettingsView.vue` or `stores/routing.ts` change.

## Recorded amendments (K12, K14)

These are contract changes made on purpose; no test edit reads as "changing an expectation to make a test pass".

| Amendment | Phase 3 test or script that changes with it |
|---|---|
| K14: `ROUTING_PREVIEW_NOTE` (`routingView.ts:46`) becomes exactly `Launches use a tier only when you choose it in the launch dialog. Team helpers do not use tiers yet.` (the Settings section's first line, `SettingsRouting.vue:168`, stops claiming that no launch uses tiers) | RV21 (`routingView.test.ts:727`) expects the new text. `verify-routing-settings-ui.mjs:68` `PREVIEW_NOTE` holds the new text, so its freshness check (:159) looks for it in the built renderer and U1 (:592) asserts it; the drive still prints `PASS (16 checks)`. |
| K12: `RoutingTierCards` gains the opt-in `selection` prop and `select` emit; with no `selection` it renders exactly as before (MR-D21 holds there) | None: H1–H15 and U1–U15 keep every expected value. |
| K12: `verify-routing-ui.mjs` gains the selectable states and H16–H20 | Its last line becomes `PASS (20 checks)`; `_verify/routing-ui` gains two PNGs (13 in all). |

## Normative contracts — `src/shared/routingView.ts` (Phase 4a block)

The top import gains, from `./routing`: `routingBaseModelId`, `type RoutingLaunchChoice`, `type RoutingLaunchPreferences`, `type RoutingLaunchTier`. The file still imports only `./routing`, never calls `.parse`/`.safeParse` (Phase 3 C13), and contains none of `Date.now(`, `Math.random(`, `new Date()`, `require(`, `from 'node:` — comments included.

```ts
// ── Phase 4a — launch (Task 4a-4) ──
/** Re-exported so the presentational components keep their type-only routingView import (Phase 3 C15). */
export type { RoutingLaunchChoice, RoutingLaunchTier }

/** K3: the one agent kind whose interactive launches can be routed. LaunchDialog never writes the literal. */
export const ROUTING_LAUNCH_AGENT = 'opencode'
/** K4: a launch always ranks for the interactive profile (never the inspector's chosen profile). */
export const ROUTING_LAUNCH_PROFILE: RoutingProfileId = 'interactive'
export const ROUTING_LAUNCH_SECTION_LABEL = 'Routing'
export const ROUTING_LAUNCH_GROUP_LABEL = 'Routing tier'
export const ROUTING_LAUNCH_CHOICE_LABELS: Record<RoutingLaunchChoice, string> = {
  budget: 'Budget', balanced: 'Balanced', fast: 'Fast', nitro: 'Nitro', default: 'OpenRouter default'
}
export const ROUTING_DEFAULT_CHOICE_LABEL = 'OpenRouter default'
export const ROUTING_DEFAULT_CHOICE_DESCRIPTION =
  'Chorus sends no routing: OpenRouter picks the provider for each request, as before. The data-collection setting is not sent.'

export type RoutingLaunchIneligibility =
  'not-opencode' | 'no-credential' | 'credential-not-routable' | 'no-model' | 'model-not-routable' | 'profile-env'
export interface RoutingLaunchEligibility { eligible: boolean; reason: RoutingLaunchIneligibility | null }
export interface LaunchTierView { tier: RoutingLaunchTier; launchable: boolean; reason: string | null; refreshable: boolean }
export interface LaunchChoiceView { selected: RoutingLaunchChoice; hint: string | null }
/** RoutingTierCards' opt-in selection mode: present = a radio group; absent/null = the Phase 3 read-out. */
export interface RoutingCardSelection {
  groupLabel: string
  selected: RoutingLaunchChoice | null
  disabledReasons: Partial<Record<RoutingLaunchTier, string>>
  defaultOption: { label: string; description: string }
}

export function routingLaunchEligibility(input: {
  agent: string | null; credentialProfileId: string | null; model: string | null
  credentials: readonly RoutingCredential[]; models: readonly { slug: string }[]
  profileEnvKeys: readonly string[]
}): RoutingLaunchEligibility
export function envJsonKeys(envJson: string | null): string[]
export function launchTierViews(result: TierResult | null, settings: RoutingSettings): LaunchTierView[] // budget, balanced, fast, nitro
export function launchDisabledReasons(views: readonly LaunchTierView[]): Partial<Record<RoutingLaunchTier, string>>
export function routingCardSelection(selected: RoutingLaunchChoice | null, views: readonly LaunchTierView[]): RoutingCardSelection
export function rememberedLaunchChoice(preferences: RoutingLaunchPreferences | null, model: string | null): RoutingLaunchChoice | null
export function defaultLaunchChoice(remembered: RoutingLaunchChoice | null, views: readonly LaunchTierView[]): LaunchChoiceView
export function launchChoiceView(input: {
  userChoice: RoutingLaunchChoice | null; remembered: RoutingLaunchChoice | null; views: readonly LaunchTierView[]
}): LaunchChoiceView
export function routingLaunchCaption(effort: string | null): string
export function routingLaunchTierToSend(eligible: boolean, choice: RoutingLaunchChoice): RoutingLaunchTier | null
export function routingUnavailableText(message: string): string
```

### Rules

**`routingLaunchEligibility` (K3 mirror),** first match:

| # | Condition | `reason` |
|---|---|---|
| 1 | `agent !== ROUTING_LAUNCH_AGENT` (including `null`) | `not-opencode` |
| 2 | `credentialProfileId === null` | `no-credential` |
| 3 | no entry of `credentials` (the `routing:credentials` list) has that id | `credential-not-routable` |
| 4 | `model === null` | `no-model` |
| 5 | `routingBaseModelId(model) !== model` (a `:nitro` id) or no entry of `models` (the `routing:models` list) has `slug === model` | `model-not-routable` |
| 6 | some `profileEnvKeys` entry equals `OPENCODE_CONFIG_CONTENT` ignoring case (K7: main refuses a routed launch whose launch profile sets it; C29) | `profile-env` |
| — | otherwise | `{ eligible: true, reason: null }` |

The order is main's (ImplementationSpec-4a-1, `planRoutingLaunch`). The dialog renders the routing section only when `eligible` (absent, not disabled; the file's rule since 3a-4), so a launch main would refuse to route is offered as today's unrouted launch. Main repeats every check and refuses an ineligible `routing_tier` (K3, K7); this function decides only what the user sees.

**`envJsonKeys(envJson)`:** the keys of a launch profile's `env_json` (`launchProfileWireSchema`): `null`, unparseable JSON, `null`, an array or any non-object → `[]`; otherwise `Object.keys(JSON.parse(envJson))`. `JSON.parse` is not Zod parsing (Phase 3 C13's grep allows it).

**`launchTierViews(result, settings)` (MR-D26, C25).** Built from `tierCardViews(result, settings)` (Phase 3, unchanged) plus Nitro, in the order `budget`, `balanced`, `fast`, `nitro`. For each ranked card, first match:

| Card | `launchable` | `reason` | `refreshable` |
|---|---|---|---|
| `state === 'no-snapshot'` (`result === null`) | false | the card's own `reason` (`No endpoint numbers for this model yet. Refresh to rank it.`) | true |
| `result.stale` | false | `` `Refresh first: the numbers are older than ${settings.snapshotMaxAgeMinutes} min.` `` | true |
| `state === 'empty'` (`tiers[tier] === null`) | false | the card's own `reason` (the empty reason) | false |
| otherwise | true | `null` | false |

Nitro is always `{ tier: 'nitro', launchable: true, reason: null, refreshable: false }`: its payload needs no snapshot, only its preview does (MR-D26). Staleness is checked before emptiness, so a stale empty tier reads "Refresh first".

**`launchDisabledReasons(views)`:** `{ [tier]: reason }` for every view with `launchable === false` and a non-null `reason`; `{}` when all are launchable.

**`routingCardSelection(selected, views)`:** `{ groupLabel: ROUTING_LAUNCH_GROUP_LABEL, selected, disabledReasons: launchDisabledReasons(views), defaultOption: { label: ROUTING_DEFAULT_CHOICE_LABEL, description: ROUTING_DEFAULT_CHOICE_DESCRIPTION } }`.

**`rememberedLaunchChoice(preferences, model)` (MR-D28, K8):** `null` when either is `null`; otherwise `preferences.lastChoiceByModel[model]` when `Object.hasOwn(preferences.lastChoiceByModel, model)`, else `null` (so `toString` and other prototype keys never read as a memory).

**`defaultLaunchChoice(remembered, views)` (K9, MR-D28),** with `launchable('default') = true`, `launchable(t)` from the view, and `unavailable(t)` = `` `Refresh to use ${ROUTING_LAUNCH_CHOICE_LABELS[t]}.` `` when that view is `refreshable`, else `` `${ROUTING_LAUNCH_CHOICE_LABELS[t]} has no endpoint that meets the rules right now.` ``:

1. `remembered !== null` and launchable → `{ selected: remembered, hint: null }`.
2. `remembered !== null` (a ranked tier that is not launchable) → `{ selected: 'default', hint: unavailable(remembered) }`. K9 reads literally: Balanced is the fallback only "with no memory" (C26).
3. no memory and Balanced launchable → `{ selected: 'balanced', hint: null }`.
4. otherwise → `{ selected: 'default', hint: unavailable('balanced') }`.

Nitro is never selected unless remembered (K9).

**`launchChoiceView({ userChoice, remembered, views })` (C27):** a choice the user clicked in this dialog wins while it stays launchable.

1. `userChoice !== null` and launchable → `{ selected: userChoice, hint: null }`.
2. Otherwise `d = defaultLaunchChoice(remembered, views)` and `hint = userChoice !== null ? `` `${ROUTING_LAUNCH_CHOICE_LABELS[userChoice]} can no longer be launched. ${reason of userChoice}` `` : d.hint`; return `{ selected: d.selected, hint }`. Nothing switches silently: the radio moves and the hint says why.

**`routingLaunchCaption(effort)` (K4):** `null` → `Ranked for an interactive session with no reasoning effort set.`; otherwise `` `Ranked for an interactive session at reasoning effort "${effort}".` ``

**`routingLaunchTierToSend(eligible, choice)` (K2):** `eligible && choice !== 'default' ? choice : null`. The payload carries this value, and only it.

**`routingUnavailableText(message)`:** `` `Routing is unavailable: ${message}` ``.

Every function returns fresh plain JSON and never mutates its input.

**`ROUTING_PREVIEW_NOTE` (:46), K14:** its value becomes exactly `Launches use a tier only when you choose it in the launch dialog. Team helpers do not use tiers yet.` Nothing else in the Phase 3 block changes. RV21 (`routingView.test.ts:727`) and `verify-routing-settings-ui.mjs:68` change with it (see "Recorded amendments").

## Normative contracts — `src/renderer/src/stores/routingLaunch.ts`

```ts
import { defineStore } from 'pinia'
import type {
  RoutingCredential, RoutingLaunchPreferences, RoutingModelList, RoutingSettings, TierResult
} from '../../../shared/routing'
import { ROUTING_LAUNCH_PROFILE } from '../../../shared/routingView'
import { plainRoutingInput, routingFailure, routingValue, type RoutingFailureInfo, type RoutingRefreshState } from './routing'

/** K4: what one launch ranks with. The credential is the launch's own (MR-D19, MR-D20). */
export interface RoutingLaunchRankInput { model: string; effort: string | null; credentialProfileId: string }
```

**Module state** (this module's own; never the Settings store's): `let unsubscribe: (() => void) | null = null`, `let consumers = 0`, `let tiersSeq = 0`, `let loadSeq = 0`.

**State** (`defineStore('routing-launch', …)`): `loaded` (false), `loading` (false), `loadError` (`RoutingFailureInfo | null`), `models` (`RoutingModelList['models']`, `[]`), `credentials` (`RoutingCredential[]`, `[]`), `settings` (`RoutingSettings | null`), `preferences` (`RoutingLaunchPreferences | null`), `input` (`RoutingLaunchRankInput | null`), `tiers` (`TierResult | null`), `tiersError` (`RoutingFailureInfo | null`), `tiersLoading` (false), `refresh` (`RoutingRefreshState`, idle as in `stores/routing.ts:51–53`).

**Actions** (none throws or rejects to its caller; none starts a timer):

| Action | Behaviour |
|---|---|
| `connect(): () => void` | As `stores/routing.ts:83–88`, on this module's variables: a second, independent `onProgress` subscription; idempotent release. |
| `ingestProgress(event)` | As `stores/routing.ts:95–101`: only while `refresh.phase === 'running'` and `event.model === refresh.model`; binds the first id; drops other ids. |
| `reset()` | One per dialog open (C30). `++loadSeq; ++tiersSeq`; restores every field to its initial value **except `refresh`**, so a reopened dialog keeps its own countdown (Phase 3 C12) and an in-flight refresh still lands. |
| `load(): Promise<void>` | Returns at once while `loading`. `seq = ++loadSeq`, `loading = true`, `loadError = null`. `Promise.all([models({}), credentials({}), settingsGet({}), launchPreferences({})])`, then `routingValue` on each reply in that order (the first failure in request order wins, Phase 3's rule). A result with `seq !== loadSeq` is dropped. Failure → `loadError = routingFailure(err)`, `loading = false`. Success → assign `models` (`.models`), `credentials` (`.credentials`), `settings`, `preferences`; `loaded = true`; `loading = false`. It never ranks. |
| `rank(input): Promise<void>` | `seq = ++tiersSeq`; `this.input = { model, effort, credentialProfileId }` (a fresh literal of the three fields); `tiersLoading = true`; `tiers(plainRoutingInput({ model, profile: ROUTING_LAUNCH_PROFILE, effort, credentialProfileId }))`. A reply with `seq !== tiersSeq` is dropped. Success → `tiers`, `tiersError = null`. Failure → `tiers = null`, `tiersError = routingFailure(err)` (`NO_SNAPSHOT` is the no-snapshot state for the view, not an error). Then `tiersLoading = false` (same seq only). |
| `clearTiers()` | `++tiersSeq`; `input = null`, `tiers = null`, `tiersError = null`, `tiersLoading = false`. |
| `startRefresh(): Promise<void>` | Returns at once when `refresh.phase === 'running'` or `input === null`. `const q = this.input`; `refresh = { phase: 'running', model: q.model, refreshId: null, events: [], result: null, error: null, endedAtMs: null }`; `refresh(plainRoutingInput({ model: q.model, credentialProfileId: q.credentialProfileId, profile: ROUTING_LAUNCH_PROFILE, effort: q.effort }))`. Success and failure exactly as `stores/routing.ts:194–208` (Phase 3 C12: `endedAtMs` only when the refresh reached the network). Then `if (this.input !== null) await this.rank(this.input)`. A cooldown `BUSY` (MR-D22) means the numbers were just refreshed, so the launch proceeds on them; the store keeps main's message, which names the seconds left, in `refresh.error` and re-ranks (MR-D26, C32). The live countdown runs only after the dialog's own network-reaching refresh (Phase 3 C12). |

There is no settings, observation or preference write: main records the remembered choice (K8). Reusing `plainRoutingInput`, `routingValue`, `routingFailure` and the two types from `stores/routing.ts` imports functions, never that store's state.

## Normative contracts — `RoutingTierCards.vue` (opt-in selection)

```ts
import { useId } from 'vue'
import type { NitroCardView, RoutingCardSelection, RoutingLaunchChoice, TierCardView } from '../../../../shared/routingView'

const props = withDefaults(
  defineProps<{ cards: TierCardView[]; nitro: NitroCardView; notes: string[]; selection?: RoutingCardSelection | null }>(),
  { selection: null }
)
const emit = defineEmits<{ select: [choice: RoutingLaunchChoice] }>()
const group = useId() // Vue 3.5.40 is installed; one radio name per instance
```

**Off (`selection === null`, Settings and the existing harness states).** The rendered DOM is exactly today's: no radio, no `label`, no `role`, no `aria-*`, no title, no click listener (bind listeners with `v-on="selection ? { click: … } : {}"`, never an always-present handler), no new class or data attribute. MR-D21's "not selectable" holds wherever the mode is off; H1–H15 and the Settings drive's U1–U15 run unchanged.

**On (`selection !== null`, LaunchDialog only).** Why one prop and not three (C23): "off" is a single absent value, so no combination of half-set props can render a half-selectable card; and every string (group label, default option, disabled reasons) arrives from the view model, so the component keeps Phase 3 C15's type-only import. Why the "OpenRouter default" option lives here and not in LaunchDialog (C24): it is the fifth answer to the same question, so it must be the fifth radio of the same group — one `name`, native arrow-key movement across all five, one accessible group name — which two components cannot give without sharing a radio name across a component boundary.

| Element | Attributes and content (on mode only; `disabled(c)` = `c !== 'default' && selection.disabledReasons[c] !== undefined`) |
|---|---|
| Wrapper `div.routing-cards[data-routing-cards]` | `role="radiogroup"`, `aria-label` = `selection.groupLabel`. |
| Every choice section (Budget, Balanced, Fast, Nitro, then default) | class `routing-card-selectable`, plus `routing-card-selected` when `selection.selected === c` and `routing-card-disabled` when `disabled(c)`; `data-routing-choice=<c>`; `data-routing-selected="true"\|"false"`; `data-routing-disabled="true"\|"false"`; `title` = the disabled reason when disabled; a click on the section outside its `input`/`label` emits `select(c)` unless disabled or already selected (the radio's own `change` covers clicks on the radio and its label, so each click emits once). The section takes no `tabindex`; the radio is the focus target. |
| Radio (first in the card header) | `input.routing-radio[type=radio][data-routing-radio]`, `id` = `${group}-${c}`, `name` = `group`, `value` = `c`, `:checked` = `selection.selected === c`, `:disabled` = `disabled(c)`, `@change` emits `select(c)`. |
| Label | The existing label text becomes `label.routing-card-label[for=${group}-${c}]`: the card's `label` (Budget, Balanced, Fast), Nitro's `nitro.label` (`Nitro — unfiltered provider routing`, still `[data-routing-nitro-label]`, so the label text carries Nitro's meaning), or `selection.defaultOption.label`. In off mode the `span.routing-card-label` stays. |
| Disabled reason | `p.set-hint.set-hint-warn[data-routing-disabled-reason]` after `[data-routing-reason]`, only when `disabled(c)` and the reason differs from `card.reason` (a no-snapshot or empty card already says why; a stale card does not; C25). |
| Default option (last, on mode only) | `section.set-card.routing-card.routing-card-default.routing-card-selectable[data-routing-choice="default"]`, spanning the grid (`grid-column: 1 / -1`): radio, label, and `p.routing-reason[data-routing-default-description]` = `selection.defaultOption.description`. It has no `data-routing-tier`, so the harness's and the Settings drive's card readers never see it. |

Styling (scoped): `.routing-radio { margin: 0; accent-color: var(--color-accent-jade); }`; `.routing-card-selected { border-color: var(--color-accent-jade); box-shadow: inset 0 0 0 1px var(--color-accent-jade); }`; `.routing-card-nitro.routing-card-selected { border-left-color: var(--color-state-attention); }` (the amber edge survives selection); `.routing-card-disabled .routing-card-body, .routing-card-disabled .routing-reason, .routing-card-disabled .routing-card-label { opacity: 0.55; }`; `.routing-card-default { grid-column: 1 / -1; }`. Colours only through `main.css` tokens; no Tailwind utilities.

## Normative contracts — `LaunchDialog.vue`

### Insertions (line numbers at `a57ef1b`; apply bottom-up so earlier numbers stay valid)

| # | After line (verbatim anchor) | Insert |
|---|---|---|
| I7 | 1685 `<style src="../assets/overlays.css"></style>` | `<style src="../assets/settings.css"></style>` |
| I6 | 1661 `            busy \|\|` (inside the Launch button's `:disabled`, :1658–1664) | `            routingBusy \|\|` |
| I5 | 1472 `      </div>` (closes the D179 model-effort section, :1456–1472) | The routing section (template below). |
| I4 | 1035 `        ...(own && modelChoice.value !== null ? { model: modelChoice.value } : {}),` | Two comment lines and `        ...(own && routingTier.value !== null ? { routing_tier: routingTier.value } : {}),` |
| I3 | 917 `  if (!selected.value \|\| !cwd.value \|\| busy.value) return` | `  if (routingBusy.value) return // 4a-4: Enter in a field must not launch before main's tiers arrive` |
| I2 | 375 `})` (closes `missingModelRow`, :370–375) | The routing script block (below). |
| I1 | 19 `import { useFleetStore } from '../stores/fleet'` | The imports (below). |

| # | Line | Replace (content only; the line keeps its CRLF) |
|---|---|---|
| R1 | 288 `  const efforts = catalog.value.find((m) => m.modelId === model)?.reasoningEfforts` | `  const efforts = catalog.value.find((m) => m.modelId === routingBaseModelId(model))?.reasoningEfforts // MR-D4` |

R1 makes a directly picked `:nitro` id (from the shortlist or catalog) show its base model's efforts. Since K13 that is also what the launch does: a credentialed OpenCode launch on the OpenRouter gateway that sends a `:nitro` id with an effort declares that id's variants in `OPENCODE_CONFIG_CONTENT` (no provider object, nothing persisted), with or without a tier. The routing section stays hidden for such a model (`model-not-routable`), so no tier is sent.

Nothing else changes: not the batch logic, not "Save as launch profile" (it still stores `model: null` and no tier, MR-D27), not the "Will launch" hint (:1639–1641).

### I1 — imports

```ts
import RoutingTierCards from './routing/RoutingTierCards.vue'
import RoutingProviderTable from './routing/RoutingProviderTable.vue'
import RoutingRefreshStatus from './routing/RoutingRefreshStatus.vue'
import { useRoutingLaunchStore } from '../stores/routingLaunch'
import { DEFAULT_ROUTING_SETTINGS, routingBaseModelId, type RoutingLaunchChoice } from '../../../shared/routing'
import {
  ROUTING_LAUNCH_AGENT, ROUTING_LAUNCH_SECTION_LABEL, ROUTING_REFRESH_COST_TEXT, cooldownRemainingSeconds, envJsonKeys, launchChoiceView,
  launchTierViews, nitroCardView, providerTableView, refreshButtonView, refreshProgressView, rememberedLaunchChoice,
  resultNotes, routingCardSelection, routingLaunchCaption, routingLaunchEligibility, routingLaunchTierToSend,
  routingUnavailableText, snapshotAgeView, tierCardViews
} from '../../../shared/routingView'
```

Inserted after :19, not beside `AgentMark` (:33–34), because :33–35 are three of the seven lone-LF lines; nothing is inserted adjacent to them.

### I2 — the routing block

```ts
/* ── Model Routing 4a-4: the routing tier of an own-agent OpenCode launch ──
 * ⚠ MAIN DECIDES WHAT A TIER MEANS (K2). This block picks a tier NAME and shows
 * main's free `routing:tiers` answer; `session:launch` resolves the tier again
 * and refuses a stale or ineligible one. Eligibility is mirrored (K3, K7) only to
 * decide whether the section renders — absent, not disabled.
 * ⚠ NO REFRESH WITHOUT A CLICK (MR-D26): ranking is free; the section's Refresh
 * button is the only paid path, and it uses this launch's credential (MR-D19).
 * The 1 s ticker moves the age line and the countdown only; it calls no IPC. */
const routingLaunch = useRoutingLaunchStore()
routingLaunch.reset()
const releaseRouting = routingLaunch.connect()
const routingNowMs = ref(Date.now())
const routingTicker = setInterval(() => { routingNowMs.value = Date.now() }, 1_000)
onBeforeUnmount(() => { releaseRouting(); clearInterval(routingTicker) })
/** The tier the user clicked in THIS dialog; null = follow the remembered/default rule (K9). */
const routingUserChoice = ref<RoutingLaunchChoice | null>(null)
```

Then these computeds and watchers, in this order (all names normative; every string comes from `routingView`):

| Name | Value |
|---|---|
| `launchCredentialId` | `selectedLaunchProfile.value !== null ? selectedLaunchProfile.value.credential_profile_id : authChoice.value === 'api_key' ? selectedProfile.value : null` — the credential main resolves (profile first, `ipc.ts:1831`, :1868; C28). |
| `launchModelEffort` | `modelEffort.value ?? selectedLaunchProfile.value?.model_effort ?? null` — payload beats profile, as `composeLaunchOptions` does (`ipc.ts:1897–1909`; C28). |
| `wantsRouting` | `selected.value === ROUTING_LAUNCH_AGENT && launchCredentialId.value !== null` — rules 1–2 of the eligibility table, which the dialog knows before loading anything. |
| `routingEligibility` | `routingLaunchEligibility({ agent: selected.value, credentialProfileId: launchCredentialId.value, model: effectiveModel.value, credentials: routingLaunch.credentials, models: routingLaunch.models, profileEnvKeys: envJsonKeys(selectedLaunchProfile.value?.env_json ?? null) })` |
| `routingEligible` | `routingLaunch.loaded && routingLaunch.loadError === null && routingEligibility.value.eligible` |
| `routingBusy` | `wantsRouting.value && (routingLaunch.loading \|\| routingLaunch.tiersLoading)` — Launch and Enter wait for it (C31). |
| `routingSettings` | `routingLaunch.settings ?? DEFAULT_ROUTING_SETTINGS` |
| `routingViews` | `launchTierViews(routingLaunch.tiers, routingSettings.value)` |
| `routingChoice` | `launchChoiceView({ userChoice: routingUserChoice.value, remembered: rememberedLaunchChoice(routingLaunch.preferences, effectiveModel.value), views: routingViews.value })` |
| `routingTier` | `routingLaunchTierToSend(routingEligible.value, routingChoice.value.selected)` |
| `routingCards`, `routingNitro`, `routingNotes`, `routingTable` | `tierCardViews(tiers, routingSettings)`, `nitroCardView(tiers, effectiveModel ?? '')`, `tiers ? resultNotes(tiers) : []`, `tiers ? providerTableView(tiers) : null` |
| `routingSelection` | `routingCardSelection(routingChoice.value.selected, routingViews.value)` |
| `routingAge` | `tiers ? snapshotAgeView(tiers.snapshotFetchedAt, routingNowMs.value, routingSettings.value.snapshotMaxAgeMinutes) : null` |
| `routingOwnRefresh` | `routingLaunch.refresh.model !== null && routingLaunch.refresh.model === routingLaunch.input?.model` |
| `routingProgress`, `routingCooldown` | as `SettingsRouting.vue:86–87` over `routingOwnRefresh`, `routingNowMs` |
| `routingButton` | `refreshButtonView({ phase: routingOwnRefresh ? refresh.phase : 'idle', cooldownSeconds: routingCooldown, canRefresh: routingLaunch.input !== null })` |
| `routingRefreshError` | E1 of Phase 3 (`SettingsRouting.vue:99–101`): the store's message unless an adopted `failed` event already prints it. A cooldown `BUSY` means the numbers were just refreshed, so the launch proceeds on them; the dialog shows main's message, which names the seconds left (MR-D26, C32). The live countdown (`routingCooldown`) runs only after the dialog's own network-reaching refresh (Phase 3 C12). |
| `routingTiersError` | `tiersError && tiersError.code !== 'NO_SNAPSHOT' ? tiersError.message : null` |
| `routingCaption` | `routingLaunchCaption(launchModelEffort.value)` |

```ts
// C30: load the free reads once per open, when an OpenCode launch has a credential.
watch(wantsRouting, (want) => { if (want && !routingLaunch.loaded && !routingLaunch.loading) void routingLaunch.load() }, { immediate: true })
// Rank (free) whenever what main would rank with changes (K4); clear when ineligible.
watch([routingEligible, effectiveModel, launchModelEffort, launchCredentialId], () => {
  const model = effectiveModel.value
  const credentialProfileId = launchCredentialId.value
  if (routingEligible.value && model !== null && credentialProfileId !== null) {
    void routingLaunch.rank({ model, effort: launchModelEffort.value, credentialProfileId })
  } else routingLaunch.clearTiers()
}, { immediate: true })
// A choice belongs to a model (MR-D28): a new model starts from its own memory.
watch(effectiveModel, () => { routingUserChoice.value = null })
function chooseRoutingTier(choice: RoutingLaunchChoice): void { routingUserChoice.value = choice }
```

### I4 — the payload

```ts
        // Model Routing 4a-4 (K2): only the tier NAME crosses, a string primitive, on
        // own-agent slots; absent = OpenRouter default. Main resolves what it means.
        ...(own && routingTier.value !== null ? { routing_tier: routingTier.value } : {}),
```

The literal stays a fresh object of primitives (D14, comment :991); `routing_tier` is typed by 4a-3's `launchRequestSchema`, so a typo fails `npm run typecheck`. Pair's partner and Workbench's shell never carry it (`own`, :966).

### I5 — the section

```html
      <!-- Model Routing 4a-4: the routing tier (K2, K3, MR-D26, MR-D28). Rendered
           only for a routable launch — absent, not disabled. -->
      <div
        v-if="routingEligible"
        class="launch-section"
        data-routing-launch
        :data-routing-launch-ready="String(routingLaunch.input !== null && !routingLaunch.tiersLoading)"
        :data-routing-choice-selected="routingChoice.selected"
      >
        <span class="overlay-label">{{ ROUTING_LAUNCH_SECTION_LABEL }}</span>
        <p class="overlay-note" data-routing-caption>{{ routingCaption }}</p>
        <p v-if="routingChoice.hint !== null" class="launch-warn" data-routing-launch-hint>{{ routingChoice.hint }}</p>
        <RoutingRefreshStatus
          :button="routingButton"
          :cost-text="ROUTING_REFRESH_COST_TEXT"
          :progress="routingProgress"
          :age-text="routingAge?.text ?? null"
          :stale-text="routingAge?.staleText ?? null"
          :error="routingRefreshError"
          @refresh="routingLaunch.startRefresh()"
        />
        <p v-if="routingTiersError !== null" class="launch-warn" data-routing-tiers-error>{{ routingTiersError }}</p>
        <RoutingTierCards
          :cards="routingCards"
          :nitro="routingNitro"
          :notes="routingNotes"
          :selection="routingSelection"
          @select="chooseRoutingTier"
        />
        <RoutingProviderTable :table="routingTable" />
      </div>
      <p v-else-if="wantsRouting && routingLaunch.loadError !== null" class="launch-warn" data-routing-unavailable>
        {{ routingUnavailableText(routingLaunch.loadError.message) }}
      </p>
```

The providers table stays collapsed by default; at the dialog's 640 px it scrolls sideways inside its own box (the Phase 3 carry-over about its layout stays open; C34). The 1 s `routingTicker` is display-only, after the Phase 3 C19 precedent (C34).

### I7 — `settings.css` (C33)

The routing components use `settings.css` classes (`set-card`, `set-chip-*`, `set-hint*`, `set-btn-primary`, `set-action`), which their host imports (ImplementationSpec-3-3, "Styling"). They already reach the built dialog through `App.vue:17` → `SettingsView.vue:153` (one `.set-card-protected` rule in today's `out/renderer/assets/index-*.css`), but LaunchDialog states the dependency itself rather than borrowing it. Measured 2026-10-03 with the repository's vite and `@vitejs/plugin-vue` on a scratch fixture: two SFCs referencing one `<style src>` at block indices 0 and 1 emit it once. Verification counts `.set-card-protected` in `out/renderer/assets/*.css`: exactly 1.

### Byte-safe edit of the mixed-line-ending file

Never edit `LaunchDialog.vue` with the `Edit` tool or an editor: both have rewritten line endings in this repository (a whole-file diff that `git diff` cannot see with `core.autocrlf=true`). Write a Node script with the `Write` tool (the Bash tool collapses backslashes in heredocs) into the session scratchpad and run it by path. It must:

1. Read the file as a `Buffer`; split it byte-wise into `{ text, eol }` records, one per terminated line, where `eol` is `'\r\n'` or `'\n'`. The file ends with a CRLF, so there is no unterminated last line; if bytes remain after the last terminator, abort.
2. Assert the starting point: exactly 2,095 terminated records and no unterminated tail; 2,088 `\r\n`, 7 `\n` at lines 33, 34, 35, 1102, 1103, 1117, 1118; 0 lone `\r`; and each anchor line of the tables above equals its verbatim text. Any mismatch aborts without writing.
3. Apply R1 (replace `text`, keep `eol`) and I7 → I1 bottom-up; every inserted record has `eol = '\r\n'`.
4. Write the joined bytes back; re-read and report: total lines `2,095 + I`, CRLF `2,088 + I`, lone LF 7 at lines `33 + a, 34 + a, 35 + a` and `1102 + b, 1103 + b, 1117 + b, 1118 + b` (`I` = all inserted lines, `a` = lines in I1, `b` = lines in I1 + I2 + I3 + I4), lone CR 0.
5. Delete the script.

Then `git diff --stat src/renderer/src/components/LaunchDialog.vue` must read `1 file changed, <I + 1> insertions(+), 1 deletion(-)` and `git ls-files --eol` must still print `i/lf w/mixed`. Paste both and the four counts in the report.

## Normative contracts — `scripts/verify-routing-ui.mjs` amendments (recorded, K12)

| Where | Change |
|---|---|
| Header (:1–20) | `checks H1-H15` → `H1-H20`; "the eleven PNGs" → "the thirteen PNGs"; last line `PASS (20 checks)`. Add one sentence: the selectable states mount `RoutingTierCards` with a `selection` built by the real `launchTierViews`/`routingCardSelection`. |
| `CHECK_IDS` (:30), `PNG_OF` (:31–35) | Add `H16`–`H20`; `H16: 'select-golden.png'`, `H18: 'select-stale.png'`. |
| `writeStates` (:42–110) | `tiersFor` (:78–89) takes `now` (default `NOW`); add `states.stale = { result: tiersFor(D, golden, '2026-10-02T10:06:00Z'), settings: D }`. |
| Fixture (:136–256) | Import `launchTierViews`, `routingCardSelection` from `routingView`. `view` gains `selected` (reset by `__show`), and `window.__selections = []` (reset by `__show`). Add `VIEWS` `select-golden` (golden; initial selected `balanced`), `select-stale` (stale; `default`), `select-no-snapshot` (`null` result; `default`), each `...idle` with `selection: routingCardSelection(view.selected, launchTierViews(result, settings))` computed at render time, and `onSelect: (c) => { window.__selections.push(c); view.selected = c }`. Existing states pass no `selection`. |
| Report (:735–762) | The leftover-file failure attaches to H15 by ID (`outcomes.find((o) => o.name.split(' ')[0] === 'H15')`), not to the last outcome (:754), which is now H20. |

Expected strings are written into the runner by hand from this specification. `STALE` = `Refresh first: the numbers are older than 60 min.`; `NO_SNAPSHOT` = `No endpoint numbers for this model yet. Refresh to rank it.`; `DEFAULT_DESC` = `Chorus sends no routing: OpenRouter picks the provider for each request, as before. The data-collection setting is not sent.`

| # | State, action | Expect | PNG |
|---|---|---|---|
| H16 | `select-golden` | One `[role="radiogroup"]` with `aria-label` `Routing tier`. `input[data-routing-radio]` values in order `budget, balanced, fast, nitro, default`, all enabled, one shared non-empty `name`, only `balanced` checked; each radio's `labels[0].textContent.trim()`: `Budget`, `Balanced`, `Fast`, `Nitro — unfiltered provider routing`, `OpenRouter default`. `[data-routing-choice]` in the same order, `data-routing-selected` `true` only for `balanced`, `data-routing-disabled` all `false`. `[data-routing-default-description]` = `DEFAULT_DESC`. Zero `[data-routing-disabled-reason]`. `[tabindex]` count 0; the page's buttons still `['button:refresh', 'button:toggle']`. | `select-golden.png` |
| H17 | `select-golden`: mouse click on the Fast card's `[data-routing-reason]`; focus the Fast radio and send `ArrowRight` (`sendInputEvent` `keyDown`/`keyUp`, `keyCode: 'Right'`); mouse click on the Budget card's label | `__selections` exactly `['fast', 'nitro', 'budget']` (one event per gesture); after the arrow `document.activeElement` is the Nitro radio and the Nitro card's `border-left-color` is still `rgb(245, 158, 11)`; finally only `budget` checked. | — |
| H18 | `select-stale`; mouse click on the Balanced card's `[data-routing-reason]` | The three ranked radios disabled, Nitro and default enabled, `default` checked; three `[data-routing-disabled-reason]`, each `STALE`; ranked `data-routing-disabled` `true`, Nitro and default `false`; ranked cards' `title` = `STALE`; the Nitro card's state `likely`; `__selections` stays `[]` and `default` stays checked. | `select-stale.png` |
| H19 | `select-no-snapshot`; mouse click on the Nitro card's `[data-routing-nitro-warning]` | Ranked radios disabled with `title` = `NO_SNAPSHOT`; zero `[data-routing-disabled-reason]` (the card already says why); ranked card states `no-snapshot`; `__selections` `['nitro']`, Nitro checked. | — |
| H20 | `golden` (selection off) | Zero `input[type="radio"]`, zero `[data-routing-choice]`, zero `[role="radiogroup"]`, zero `label.routing-card-label`, zero `.routing-card-default`, zero elements with a `title` inside `[data-routing-cards]`; four `span.routing-card-label`. MR-D21 holds with the mode off. | — |

H1–H15 keep every expected value; `Get-ChildItem _verify/routing-ui` lists the eleven Phase 3 PNGs plus `select-golden.png` and `select-stale.png`.

## Test cases

**Table LV — `src/shared/routingView.test.ts`.** Inputs: `golden`, `stale` (`now` 10:06:00Z, `stale: true`, `snapshotAgeMinutes` 61), `empty`, `floor1000` as the file already builds them (:100–106); `DEFAULT_ROUTING_SETTINGS`; `SLUG`; `C_ID` = `5f0c1a2e-8a3b-4c5d-9e6f-0123456789ab`, `A_ID` = `0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a`; `CREDS = [{ id: C_ID, label: 'OR key', providerName: 'OpenRouter' }]`; `MODELS = [{ slug: SLUG, displayName: 'DeepSeek V4.1 Flash' }]`. `STALE`, `NO_SNAPSHOT` and `DEFAULT_DESC` as above. Every expected value below was computed on 2026-10-03 by bundling the Phase 1 cores and `routingView.ts` at `a57ef1b` with esbuild in a scratch directory and running a prototype of these rules over these inputs; the prototype is not committed.

| # | Case | Expect |
|---|---|---|
| LV1 | Constants | `ROUTING_LAUNCH_AGENT` `opencode`; `ROUTING_LAUNCH_PROFILE` `interactive`; `ROUTING_LAUNCH_SECTION_LABEL` `Routing`; `ROUTING_LAUNCH_GROUP_LABEL` `Routing tier`; `ROUTING_LAUNCH_CHOICE_LABELS` `{ budget: 'Budget', balanced: 'Balanced', fast: 'Fast', nitro: 'Nitro', default: 'OpenRouter default' }`; `ROUTING_DEFAULT_CHOICE_LABEL` `OpenRouter default`; `ROUTING_DEFAULT_CHOICE_DESCRIPTION` = `DEFAULT_DESC`. |
| LV2 | `routingLaunchEligibility` with base `{ agent: 'opencode', credentialProfileId: C_ID, model: SLUG, credentials: CREDS, models: MODELS, profileEnvKeys: [] }` and: base; `agent: 'claude'`; `agent: null`; `credentialProfileId: null`; `credentialProfileId: A_ID`; `model: null`; `model: SLUG + ':nitro'`; `model: 'z-ai/glm-5.3'`; `credentials: []`; `models: []`; `{ agent: 'claude', credentialProfileId: null, model: null }`; `profileEnvKeys: ['opencode_config_content']`; `profileEnvKeys: ['FOO']`; `{ model: null, profileEnvKeys: ['OPENCODE_CONFIG_CONTENT'] }` | `{ true, null }`; `not-opencode`; `not-opencode`; `no-credential`; `credential-not-routable`; `no-model`; `model-not-routable`; `model-not-routable`; `credential-not-routable`; `model-not-routable`; `not-opencode`; `profile-env`; `{ true, null }`; `no-model` (each `eligible: false` except the first and the thirteenth). `envJsonKeys` of `null`, `'{"OPENCODE_CONFIG_CONTENT":"x","FOO":"1"}'`, `'not json'`, `'[1]'`, `'null'`, `'{}'`: `[]`, `['OPENCODE_CONFIG_CONTENT', 'FOO']`, `[]`, `[]`, `[]`, `[]`. |
| LV3 | `launchTierViews(golden, D)` | Strictly `[{ budget, true, null, false }, { balanced, true, null, false }, { fast, true, null, false }, { nitro, true, null, false }]` (as `{ tier, launchable, reason, refreshable }`). |
| LV4 | `launchTierViews(null, D)` | Budget, Balanced, Fast `{ launchable: false, reason: NO_SNAPSHOT, refreshable: true }`; Nitro `{ true, null, false }`. |
| LV5 | `launchTierViews(stale, D)` | Budget, Balanced, Fast `{ false, STALE, true }`; Nitro `{ true, null, false }`. (Their cards stay `ranked`: `tierCardViews(stale, D)` states `ranked, ranked, ranked`.) |
| LV6 | `launchTierViews(empty, D)` | Budget, Balanced, Fast `{ false, 'No provider meets the uptime and precision rules right now.', false }`; Nitro launchable. |
| LV7 | `launchTierViews(floor1000, D)` | Budget `{ false, 'All 14 eligible endpoints are below the 1000 tok/s Budget floor.', false }`; Balanced, Fast, Nitro launchable. |
| LV8 | `launchDisabledReasons` of LV3, LV4, LV5, LV7 | `{}`; `{ budget: NO_SNAPSHOT, balanced: NO_SNAPSHOT, fast: NO_SNAPSHOT }`; `{ budget: STALE, balanced: STALE, fast: STALE }`; `{ budget: 'All 14 eligible endpoints are below the 1000 tok/s Budget floor.' }`. |
| LV9 | `routingCardSelection('balanced', LV3)`; `routingCardSelection('default', LV5)` | `{ groupLabel: 'Routing tier', selected: 'balanced', disabledReasons: {}, defaultOption: { label: 'OpenRouter default', description: DEFAULT_DESC } }`; the same with `selected: 'default'` and LV8's stale map. |
| LV10 | `rememberedLaunchChoice` with `P = { lastChoiceByModel: { [SLUG]: 'nitro', 'z-ai/glm-5.3': 'default' } }`: `(null, SLUG)`, `(P, null)`, `(P, SLUG)`, `(P, 'z-ai/glm-5.3')`, `(P, 'other/model')`, `({ lastChoiceByModel: {} }, SLUG)`, `(P, 'toString')` | `null`, `null`, `nitro`, `default`, `null`, `null`, `null`. |
| LV11 | `defaultLaunchChoice` over (remembered, views): (`null`, LV3); (`fast`, LV3); (`nitro`, LV4); (`default`, LV3); (`null`, LV4); (`null`, LV5); (`null`, LV6); (`budget`, LV7); (`budget`, LV5); (`null`, LV7); (`fast`, LV6) | `{ balanced, null }`; `{ fast, null }`; `{ nitro, null }`; `{ default, null }`; `{ default, 'Refresh to use Balanced.' }`; `{ default, 'Refresh to use Balanced.' }`; `{ default, 'Balanced has no endpoint that meets the rules right now.' }`; `{ default, 'Budget has no endpoint that meets the rules right now.' }`; `{ default, 'Refresh to use Budget.' }`; `{ balanced, null }`; `{ default, 'Fast has no endpoint that meets the rules right now.' }` (as `{ selected, hint }`). No row with `remembered: null` selects `nitro`. |
| LV12 | `launchChoiceView` over (userChoice, remembered, views): (`fast`, `null`, LV3); (`fast`, `null`, LV5); (`fast`, `nitro`, LV5); (`default`, `balanced`, LV3); (`nitro`, `null`, LV4); (`budget`, `balanced`, LV7); (`null`, `null`, LV3) | `{ fast, null }`; `{ default, 'Fast can no longer be launched. Refresh first: the numbers are older than 60 min.' }`; `{ nitro, 'Fast can no longer be launched. Refresh first: the numbers are older than 60 min.' }`; `{ default, null }`; `{ nitro, null }`; `{ balanced, 'Budget can no longer be launched. All 14 eligible endpoints are below the 1000 tok/s Budget floor.' }`; `{ balanced, null }`. |
| LV13 | `routingLaunchCaption(null)`, `('low')`; `routingLaunchTierToSend` of `(true, 'balanced')`, `(true, 'nitro')`, `(true, 'default')`, `(false, 'nitro')`, `(false, 'default')`; `routingUnavailableText('Routing has stopped.')` | `Ranked for an interactive session with no reasoning effort set.`; `Ranked for an interactive session at reasoning effort "low".`; `balanced`, `nitro`, `null`, `null`, `null`; `Routing is unavailable: Routing has stopped.` |
| LV14 | Determinism: every LV function over deep-frozen inputs (`golden`, `stale`, the views, `P`, `CREDS`, `MODELS`), twice | No throw; strictly equal results; `JSON.parse(JSON.stringify(r))` strictly equals `r`; inputs unchanged. |

**Table LS — `src/renderer/src/stores/routingLaunch.test.ts`.** Setup as `routing.test.ts:35–181`: `setActivePinia(createPinia())`; the golden `TierResult` computed with `computeTiers`; a `stubRouting` whose `api` adds `launchPreferences: vi.fn(async () => ok({ lastChoiceByModel: { [SLUG]: 'nitro' } }))` to the Phase 3 members; `vi.stubGlobal('window', { chorus: { routing: api } })`; every opened `connect()` released in `afterEach`. `RANK = { model: SLUG, effort: 'high', credentialProfileId: C_ID }`.

| # | Case | Expect |
|---|---|---|
| LS1 | `useRoutingLaunchStore().connect()` and `useRoutingStore().connect()` (the stub keeps every listener and returns one dispose spy per subscription); release the launch one; release the Settings one | `onProgress` called twice with two different listener functions; the first release calls only the launch subscription's dispose, the second only the Settings one; a second `connect()` on the launch store while it is connected does not subscribe again (its own reference count). |
| LS2 | `load()` | `models`, `credentials`, `settingsGet`, `launchPreferences` each called once with `{}`; `status`, `observationGet` and `tiers` not called; `loaded` true; `preferences` `{ lastChoiceByModel: { [SLUG]: 'nitro' } }`; `credentials` `[A, C]`. |
| LS3 | `credentials` answers `{ ok: false, code: 'OPERATION_FAILED', message: 'x' }` and `launchPreferences` `{ ok: false, code: 'INVALID_REQUEST', message: 'y' }` | `loadError` `{ OPERATION_FAILED, 'x' }` (first failure in request order); `loaded` false; `loading` false. |
| LS4 | `rank(RANK)`; then `rank({ ...RANK, effort: null })` | `tiers` called with `{ model: SLUG, profile: 'interactive', effort: 'high', credentialProfileId: C_ID }`, then with `effort: null` (never the inspector's `'low'`); `input` strictly `{ model: SLUG, effort: null, credentialProfileId: C_ID }`; `tiers` strictly golden; `tiersLoading` false. |
| LS5 | Two overlapping `rank` calls whose first reply arrives last | The late reply is dropped; state reflects the second. |
| LS6 | `tiers` answers `NO_SNAPSHOT`, `No endpoint snapshot is stored for this model yet. Refresh first.` | `tiers` null; `tiersError` `{ NO_SNAPSHOT, … }`; `tiersLoading` false. |
| LS7 | `clearTiers()` while a `rank` is pending, then the reply arrives | `tiers`, `input`, `tiersError` null; the late reply is dropped. |
| LS8 | Fake timers at 2,000,000 ms. `connect()`, `rank(RANK)`, `startRefresh()` pending; deliver `endpoints` (R1), an event for `other/model`, an event with R2, `preflight` (R1); resolve ok with `refreshId` R1 | `refresh` called once with `{ model: SLUG, credentialProfileId: C_ID, profile: 'interactive', effort: 'high' }` (the launch credential, MR-D19; the launch effort, K4). Two adopted events; `phase` `done`; `endedAtMs` 2,000,000; `tiers` called twice in total with the same `RANK` request. |
| LS9 | `startRefresh()` with `input === null`; then twice while one is pending | No call; then exactly one call. |
| LS10 | `refresh` answers `BUSY`, `This model was refreshed less than a minute ago. Try again in 42 s.` with no event | `phase` `failed`; `error.message` exactly that; `endedAtMs` null (no countdown, Phase 3 C12); `tiers` re-ranked once more (MR-D26: proceed on the fresh numbers). |
| LS11 | After LS8 (`endedAtMs` set), `reset()` while a `rank` is pending; its reply arrives | Every field initial except `refresh` (still `done`, same `endedAtMs`); the late reply dropped; a `load()` started before `reset()` and resolved after it is dropped too. |
| LS12 | Isolation: run LS2, LS4 and LS8 on the launch store with a Settings store present | `useRoutingStore()` state unchanged (`tiers` null, `refresh.phase` idle, `loaded` false); no `tiers` request ever carries `effort: 'low'` unless the input says so. |
| LS13 | `rank(reactive({ ...RANK }))`, then every recorded argument of every `api` mock | Each `types.isProxy(arg) === false` and survives `structuredClone`; negative control: `types.isProxy(store.input) === true` and `structuredClone(store.input)` throws `could not be cloned`. |
| LS14 | `refresh` rejects with `new Error('An object could not be cloned.')`; and `vi.stubGlobal('window', {})` for every action | `startRefresh` resolves; `error` `{ OPERATION_FAILED, 'An object could not be cloned.' }`; with no bridge every action resolves and records `OPERATION_FAILED`. |
| LS15 | `vi.useFakeTimers()`; run `load`, `rank`, `startRefresh`, `clearTiers`, `reset` | `vi.getTimerCount()` is 0 after each: the store starts no timer. |

## Invariants

- The renderer sends a tier name and nothing else about routing; main resolves and refuses (K2). `routing_tier` rides only on own-agent slots of an eligible launch with a ranked or Nitro choice.
- The section exists only for a launch main would route (K3, K7); its rank uses main's inputs: `interactive`, the launch's effort, the launch's credential (K4).
- Nothing refreshes without a click; the Refresh button uses the launch's credential; the ticker never calls IPC (MR-D26, MR-D19).
- A ranked tier is selectable only when fresh and non-empty; Nitro always; "OpenRouter default" always (MR-D26).
- The preselection is the remembered choice if launchable, else Balanced (no memory) if launchable, else OpenRouter default with a hint; a choice never moves without a visible reason (K9, MR-D28).
- `routingView.ts` stays pure (MR-G8); every renderer-to-main argument is a `plainRoutingInput` snapshot or `{}` (MR-G5); the launch store shares no state with `stores/routing.ts`.
- With `selection` absent, `RoutingTierCards` renders Phase 3's DOM exactly (MR-D21).
- `LaunchDialog.vue` keeps its seven lone-LF lines and gains only CRLF lines.
- The Settings section's first line no longer claims that no launch uses tiers (K14); no other Phase 3 expected value changes (K12).

## Verification

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

The four `Select-String` lines print nothing (the last proves the old preview note is gone from all three K14 places). Drives: `PASS (30 checks)`, `PASS (20 checks)` (harness, amended), `PASS (20 checks)` (IPC, after 4a-1), `PASS (16 checks)` (Settings; its `PREVIEW_NOTE` amended by K14, its count unchanged). The CSS count prints `1`. The EOL line prints `crlf` = 2,088 + I, `lf` 7, `cr` 0; `git ls-files --eol` prints `i/lf w/mixed`. The built-app check of this task's UI is Task 4a-5's drive; this task's runtime evidence is Table LS over real `structuredClone` and real Vue reactivity, the harness screenshots, and the Settings drive showing the K14 note.
