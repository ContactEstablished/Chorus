# Implementation specification 4b-3 — The Team dialog's per-slot tier

Paired [task](../Tasks/Task-4b-3.md). Decisions: [roadmap](../roadmap.md) MR-D11, MR-D15, MR-D19, MR-D21, MR-D26, MR-D32; gates MR-G1, MR-G5, MR-G8; [overview](../Tasks/Phase-4b-Overview.md) K2, K4–K6, K10, K11, K13, K16, clarifications C10–C13 and C20, answers Q2 and Q8. Contracts consumed from [ImplementationSpec-4b-1](ImplementationSpec-4b-1.md) (`memberFields.routingTier`, the member refine, `routingLaunchRequestSchema.profile`, the `helper` ranking) and [ImplementationSpec-4b-2](ImplementationSpec-4b-2.md) (main's `team:launch` refusal and the per-attempt resolution); Phase 4a contracts from [ImplementationSpec-4a-4](ImplementationSpec-4a-4.md) (`launchTierViews`, the disabled reasons, `unavailableHint`, Table LS). **Not started.**

Test IDs: **HV** (Team helper view model, a new table in `routingView.test.ts`), **HS** (Team routing store, a new `routingTeam.test.ts`).

## Files and insertion points

Verified 2026-10-05 at `70d5dda` (each file opened, its bytes counted byte-wise, `git ls-files --eol` run; `src/` and `scripts/` equal `HEAD`). Tasks 4b-1 and 4b-2 edit none of these files.

| File | Line endings | Action |
|---|---|---|
| `src/shared/routingView.ts` (684 lines, 32,168 bytes) | CRLF: 684 CRLF, 0 LF, 0 CR; `i/lf w/crlf` | One import name after :2 (`ROUTING_FAILURE_MESSAGES,`); K13 replaces the note's text on :50; the "Phase 4b — Team helpers (Task 4b-3)" block is appended after :684. Every new line CRLF. |
| `src/shared/routingView.test.ts` (966 lines, 49,383 bytes) | CRLF: 966, 0, 0; `w/crlf` | Nine names (`ROUTING_HELPER_PROFILE`, `helperChoiceView`, `helperDefaultChoice`, `helperRoutingEligibility`, `helperRoutingWanted`, `helperTierSelectLabel`, `helperTierSelectView`, `helperTierToSend`, `routingHelperCaption`) and one type (`HelperTierOptionView`) join the `./routingView` import (:16–63); RV21's note expectation (:747) changes with K13; `describe('Table HV — Team helper tiers (Task 4b-3)')` is appended after :966, reusing `SLUG` (:88), `tiersFor` (:100–114), `S_EMPTY` (:116), `S_FLOOR1000` (:118), `helper` (:121), `deepFreeze` (:165–171), `A_ID` (:595), `C_ID` (:597). Every new line CRLF. |
| `src/renderer/src/stores/routingTeam.ts`, `routingTeam.test.ts` | new, LF | `useRoutingTeamStore`, `routingTeamKey`, Table HS. Pattern: `stores/routingLaunch.ts` (`reset` :93–107, `load` :110–137, `rank` :140–158) and `routingLaunch.test.ts` (spy :35–38, stub :133–164, LS13 :471–499). |
| `src/renderer/src/components/routing/HelperTierSelect.vue` | new, LF | Presentational; pattern `RoutingTierCards.vue` (header :1–22, type-only import :24). |
| `src/renderer/src/components/TeamLaunchDialog.vue` (118 lines, 14,484 bytes) | CRLF: 118, 0, 0; `w/crlf` | Six insertions and ten in-line replacements, below. Edited byte-wise only. |
| `scripts/verify-routing-settings-ui.mjs` (909 lines, 44,962 bytes) | CRLF: 909, 0, 0; `w/crlf` | One line: `PREVIEW_NOTE` (:68), K13. Its freshness check (:159) and U1 (:592) read it; the drive still ends `PASS (16 checks)`. |

No main, preload, `src/shared/routing.ts`, `src/shared/team.ts`, `src/shared/ipc.ts`, `LaunchDialog.vue`, `RoutingTierCards.vue`, `SettingsRouting.vue`, `stores/routing.ts` or `stores/routingLaunch.ts` change.

**Line endings.** `routingView.ts`, its test and the Settings drive may be edited with any tool, but afterwards every line must be CRLF (`lf: 0`, `cr: 0` byte-wise) and `git diff --stat` must show only the intended lines; the `Edit` tool has rewritten CRLF files as LF in this repository, which `git diff` cannot see under `core.autocrlf=true`, so the byte count is the check. `TeamLaunchDialog.vue` is edited only by the byte-safe script below. New files are LF.

## Recorded amendment (K13)

A contract change made on purpose; no test edit reads as "changing an expectation to make a test pass".

| Amendment | Test or script that changes with it |
|---|---|
| `ROUTING_PREVIEW_NOTE` (`routingView.ts:50`) becomes exactly `Launches use a tier only when you choose one: in the launch dialog, or for each helper in the Team dialog.` (the Settings section's first line, `SettingsRouting.vue:168`, stops saying that Team helpers do not use tiers). Its trailing comment becomes `// C20; Phase 4a K14; Phase 4b K13`. | RV21 (`routingView.test.ts:747`) expects the new text. `verify-routing-settings-ui.mjs:68` `PREVIEW_NOTE` holds the new text, so its freshness check (:159) looks for it in the built renderer and U1 (:592) asserts it; the drive still prints `PASS (16 checks)`. |

## Normative contracts — `src/shared/routingView.ts` (Phase 4b block)

The top import gains one value name, inserted after :2: `  ROUTING_LAUNCH_CHOICES,` (`['budget', 'balanced', 'fast', 'nitro', 'default']`, `routing.ts:614`). Every other name the block uses is already imported or defined in the file (`routingBaseModelId`, `RoutingCredential`, `RoutingLaunchChoice`, `RoutingLaunchTier`, `RoutingProfileId`; `NITRO_CARD_LABEL`, `ROUTING_LAUNCH_CHOICE_LABELS`, `ROUTING_DEFAULT_CHOICE_LABEL`, `ROUTING_DEFAULT_CHOICE_DESCRIPTION`, `LaunchTierView`, `LaunchChoiceView`, `routingLaunchTierToSend`, `routingUnavailableText`, and the private `launchViewOf`, `choiceLaunchable` and `unavailableHint`). The file still imports only `./routing`, never calls `.parse`/`.safeParse` (Phase 3 C13), and contains none of `Date.now(`, `Math.random(`, `new Date()`, `require(`, `from 'node:` — comments included.

Appended after :684, as one blank line and then exactly this block (with the block as written the file ends at 793 CRLF lines):

```ts
// ── Phase 4b — Team helpers (Task 4b-3) ──
//
// The Team dialog's per-slot tier (ImplementationSpec-4b-3, Table HV). Main is
// the authority for what a tier means (K2): `team:launch` refuses a tier it
// cannot serve, and main resolves the tier again before EVERY helper attempt,
// on the numbers it holds then (MR-D32). These functions decide only which
// slots show a dropdown, what it offers and which tier NAME a slot sends. Pure,
// like the blocks above.

/** K5: a helper slot ranks for the helper profile (never the interactive one). */
export const ROUTING_HELPER_PROFILE: RoutingProfileId = 'helper'

/** K4: the one harness and the one auth mode whose helpers can be routed. The Team dialog never writes the literals. */
const HELPER_ROUTING_HARNESS = 'opencode'
const HELPER_ROUTING_AUTH_MODE = 'api_key'

export type HelperRoutingIneligibility = 'not-opencode' | 'credential-not-routable' | 'model-not-routable'
/** `baseModel`: the registry slug the slot ranks on and main resolves on (K5, K6); null when not eligible. */
export interface HelperRoutingEligibility { eligible: boolean; reason: HelperRoutingIneligibility | null; baseModel: string | null }
export interface HelperTierOptionView { choice: RoutingLaunchChoice; label: string; text: string; disabled: boolean; title: string | null }
export interface HelperTierSelectView { options: HelperTierOptionView[]; selected: RoutingLaunchChoice; hint: string | null; busy: boolean }

/** K4: the rule the dialog knows before loading anything (main's `notOpencode`). */
export function helperRoutingWanted(member: { harness: string; authMode: string }): boolean {
  return member.harness === HELPER_ROUTING_HARNESS && member.authMode === HELPER_ROUTING_AUTH_MODE
}

/**
 * K4, C4: main's helper eligibility, mirrored only to decide whether a slot
 * shows a dropdown (absent, not disabled). First match, in main's order
 * (`planHelperRouting`, less `unavailable`, which the dialog learns from its
 * load). `model` is the member's model as `normalizeTeamModel` returns it (this
 * file imports only ./routing). Unlike a launch (4a K3), the `:nitro` form is
 * eligible: it ranks, and main resolves, on its base slug.
 */
export function helperRoutingEligibility(input: {
  harness: string; authMode: string; credentialProfileId: string | null; model: string
  credentials: readonly RoutingCredential[]; models: readonly { slug: string }[]
}): HelperRoutingEligibility {
  const no = (reason: HelperRoutingIneligibility): HelperRoutingEligibility => ({ eligible: false, reason, baseModel: null })
  if (!helperRoutingWanted(input)) return no('not-opencode')
  const { credentialProfileId } = input
  if (credentialProfileId === null || !input.credentials.some((c) => c.id === credentialProfileId)) return no('credential-not-routable')
  const baseModel = routingBaseModelId(input.model)
  if (!input.models.some((m) => m.slug === baseModel)) return no('model-not-routable')
  return { eligible: true, reason: null, baseModel }
}

/** K10, MR-D15: a slot whose option is chosen starts on Nitro for the `:nitro` model, else on OpenRouter default. */
export function helperDefaultChoice(model: string): RoutingLaunchChoice {
  return routingBaseModelId(model) !== model ? 'nitro' : 'default'
}

/**
 * K10: the slot's stored choice (null = its option's default) while it can be
 * launched; otherwise OpenRouter default with 4a's hint. Unlike a launch
 * (4a K9) nothing falls back to Balanced and nothing is remembered.
 */
export function helperChoiceView(input: { stored: RoutingLaunchChoice | null; model: string; views: readonly LaunchTierView[] }): LaunchChoiceView {
  const choice = input.stored ?? helperDefaultChoice(input.model)
  return choiceLaunchable(choice, input.views) ? { selected: choice, hint: null } : { selected: 'default', hint: unavailableHint(choice, input.views) }
}

/**
 * K11, C10: the slot's one dropdown, in ROUTING_LAUNCH_CHOICES order: Budget,
 * Balanced, Fast, Nitro, OpenRouter default. A ranked option that cannot be
 * launched now is disabled and says why in its own text (MR-D26, 4a's
 * reasons); Nitro carries its meaning in its label (MR-D11); the default
 * option's title says what it sends. While the slot's ranking is in flight the
 * select is busy and shows no hint; a ranking failure other than NO_SNAPSHOT
 * shows main's message in place of the hint.
 */
export function helperTierSelectView(input: {
  views: readonly LaunchTierView[]; choice: LaunchChoiceView; busy: boolean; error: string | null
}): HelperTierSelectView {
  const options = ROUTING_LAUNCH_CHOICES.map((choice): HelperTierOptionView => {
    if (choice === 'nitro') return { choice, label: NITRO_CARD_LABEL, text: NITRO_CARD_LABEL, disabled: false, title: null }
    if (choice === 'default') {
      return { choice, label: ROUTING_DEFAULT_CHOICE_LABEL, text: ROUTING_DEFAULT_CHOICE_LABEL, disabled: false, title: ROUTING_DEFAULT_CHOICE_DESCRIPTION }
    }
    const label = ROUTING_LAUNCH_CHOICE_LABELS[choice]
    const view = launchViewOf(input.views, choice)
    if (view?.launchable === true) return { choice, label, text: label, disabled: false, title: null }
    const reason = view?.reason ?? null
    return { choice, label, text: reason === null ? label : `${label} — ${reason}`, disabled: true, title: reason }
  })
  const hint = input.busy ? null : input.error !== null ? routingUnavailableText(input.error) : input.choice.hint
  return { options, selected: input.choice.selected, hint, busy: input.busy }
}

/** K2: the member's `routingTier`; null = send none (OpenRouter default, or a slot routing cannot serve). */
export function helperTierToSend(eligible: boolean, choice: RoutingLaunchChoice): RoutingLaunchTier | null {
  return routingLaunchTierToSend(eligible, choice)
}

/** A slot's accessible name. Never starts with "Helper ": the Team drives count helper slots by that prefix. */
export function helperTierSelectLabel(index: number): string {
  return `Routing tier for helper ${index + 1}`
}

/** K11, C10: what the dialog ranked for, and that each attempt checks again (MR-D32). */
export function routingHelperCaption(effort: string | null): string {
  const again = 'Each attempt checks its tier again on the latest numbers.'
  return effort === null
    ? `Ranked for a Team helper with no reasoning effort set. ${again}`
    : `Ranked for a Team helper at reasoning effort "${effort}". ${again}`
}
```

### Rules, restated

**`helperRoutingEligibility` (K4 mirror; C4's order less `unavailable`),** first match:

| # | Condition | `reason` |
|---|---|---|
| 1 | `harness !== 'opencode'` or `authMode !== 'api_key'` | `not-opencode` (main's `notOpencode`, C1) |
| 2 | `credentialProfileId === null`, or no entry of `credentials` (the `routing:credentials` list) has that id | `credential-not-routable` (main's `credentialRefused`) |
| 3 | no entry of `models` (the `routing:models` list) has `slug === routingBaseModelId(model)` | `model-not-routable` (main's `unknownModel`) |
| — | otherwise | `{ eligible: true, reason: null, baseModel: routingBaseModelId(model) }` |

Main's `unavailable` (its second rule) is not mirrored: the dialog learns it from its own load and then shows no dropdown at all (C12). A `:nitro` id is eligible on its base slug (K4, unlike 4a's `routingLaunchEligibility:565`). The function strips nothing else: the dialog passes `normalizeTeamModel(member.model)` (`teamProfiles.ts:12–15`), because this file imports only `./routing`; HV3 pins that a prefixed model is not eligible unnormalized.

**K10 defaults.** `helperDefaultChoice(model)` is `nitro` exactly when the model ends in `:nitro`, else `default`. `helperChoiceView({ stored, model, views })`: the choice is `stored ?? helperDefaultChoice(model)`; when that choice is launchable (`default` and `nitro` always are) it is selected with no hint; otherwise `default` is selected with 4a's `unavailableHint` — `Refresh to use <Tier>.` for a refreshable (no-snapshot or stale) view, `<Tier> has no endpoint that meets the rules right now.` otherwise. There is no Balanced fallback (4a K9 does not apply to helpers) and no memory.

**The dropdown.** Five options in the order Budget, Balanced, Fast, Nitro, OpenRouter default (`ROUTING_LAUNCH_CHOICES`). Budget, Balanced and Fast take their 4a label and are disabled exactly when their `launchTierViews` entry is not launchable, with the text `<Label> — <reason>` and `title` = the reason (4a's reasons, C25 of 4a: stale before empty). Nitro is labelled `NITRO_CARD_LABEL` (`Nitro — unfiltered provider routing`, MR-D11) and never disabled. OpenRouter default is labelled `OpenRouter default`, never disabled, and titled `ROUTING_DEFAULT_CHOICE_DESCRIPTION`. `hint` is null while busy, else `Routing is unavailable: <message>` for a ranking failure other than `NO_SNAPSHOT`, else the choice's hint.

**The payload rule.** `helperTierToSend(eligible, choice)` is `routingLaunchTierToSend`: a tier name for an eligible slot whose choice is a tier; null for OpenRouter default or an ineligible slot. The dialog spreads `…(tier ? { routingTier: tier } : {})` into that helper (C12); absent means OpenRouter default, which sends the member's model unchanged (Q8).

Every function returns fresh plain JSON and never mutates its input (HV12).

## Normative contracts — `src/renderer/src/stores/routingTeam.ts`

New file, LF. It replaces nothing: 4a's launch store keeps one input at a time and owns a refresh, so it cannot serve several slots (overview grounding).

```ts
import { defineStore } from 'pinia'
import type { RoutingCredential, RoutingModelList, RoutingSettings, TierResult } from '../../../shared/routing'
import { ROUTING_HELPER_PROFILE } from '../../../shared/routingView'
import { plainRoutingInput, routingFailure, routingValue, type RoutingFailureInfo } from './routing'

/**
 * Model Routing Task 4b-3: the Team dialog's routing store (ImplementationSpec-4b-3, Table HS).
 * Talks to `window.chorus.routing` only, and only to its free reads.
 *
 * ⚠ NOT THE SETTINGS STORE AND NOT THE LAUNCH STORE. A Team dialog ranks one
 * input per helper slot (K5): the helper profile, the slot's own credential and
 * effort. It has no progress subscription, no refresh (K11, Q2), no timer and
 * no write. It imports `stores/routing.ts`'s helper functions, never its state.
 *
 * - Every renderer-to-main argument is a `plainRoutingInput` snapshot or the
 *   literal `{}` (D14, MR-G5). Replies are never parsed here (Phase 3 C13).
 * - No action throws or rejects to its caller; failures land in state.
 */

/** K5: what one helper slot ranks with: the base registry slug, the member's own effort and credential. */
export interface RoutingTeamRankInput { model: string; effort: string | null; credentialProfileId: string }
/** One ranking's state. `loading` while the request is in flight; `tiers` or `error` once it answered. */
export interface RoutingTeamResult { input: RoutingTeamRankInput; loading: boolean; tiers: TierResult | null; error: RoutingFailureInfo | null }

/** C11: one ranking per distinct (credential, base model, effort); slots that share it share the answer. */
export function routingTeamKey(input: RoutingTeamRankInput): string {
  return `${input.credentialProfileId}|${input.model}|${input.effort ?? ''}`
}

// This module's own counters (never another routing store's).
/** Orders `load` replies: a reply from before the latest `reset()` is dropped. */
let loadSeq = 0
/** Orders `rank` replies per key: only the latest request for a key may write that key. */
let rankSeq = 0
const latestRank = new Map<string, number>()

export const useRoutingTeamStore = defineStore('routing-team', {
  state: () => ({
    loaded: false,
    loading: false,
    loadError: null as RoutingFailureInfo | null,
    models: [] as RoutingModelList['models'],
    credentials: [] as RoutingCredential[],
    settings: null as RoutingSettings | null,
    results: {} as Record<string, RoutingTeamResult>
  }),
  actions: {
    /** C11: one per dialog open. Every field returns to its initial value; late `load` and `rank` replies are dropped. */
    reset(): void {
      ++loadSeq
      latestRank.clear()
      this.loaded = false
      this.loading = false
      this.loadError = null
      this.models = []
      this.credentials = []
      this.settings = null
      this.results = {}
    },

    /** The three free reads; the first failure in request order wins. It never ranks. */
    async load(): Promise<void> {
      if (this.loading) return
      const seq = ++loadSeq
      this.loading = true
      this.loadError = null
      let models: RoutingModelList['models'], credentials: RoutingCredential[], settings: RoutingSettings
      try {
        const api = window.chorus.routing
        const replies = await Promise.all([api.models({}), api.credentials({}), api.settingsGet({})])
        models = routingValue(replies[0]).models
        credentials = routingValue(replies[1]).credentials
        settings = routingValue(replies[2])
      } catch (err) {
        if (seq !== loadSeq) return
        this.loadError = routingFailure(err)
        this.loading = false
        return
      }
      if (seq !== loadSeq) return
      this.models = models
      this.credentials = credentials
      this.settings = settings
      this.loaded = true
      this.loading = false
    },

    /**
     * K5, K11: free (no network). The key's entry is set to loading BEFORE the
     * first await, so a second slot with the same key in the same pass sees it.
     * A reply that is no longer the latest request for its key is dropped.
     */
    async rank(input: RoutingTeamRankInput): Promise<void> {
      const { model, effort, credentialProfileId } = input
      const key = routingTeamKey({ model, effort, credentialProfileId })
      const seq = ++rankSeq
      latestRank.set(key, seq)
      this.results[key] = { input: { model, effort, credentialProfileId }, loading: true, tiers: null, error: null }
      try {
        const value = routingValue(
          await window.chorus.routing.tiers(plainRoutingInput({ model, profile: ROUTING_HELPER_PROFILE, effort, credentialProfileId }))
        )
        if (latestRank.get(key) !== seq) return
        this.results[key] = { input: { model, effort, credentialProfileId }, loading: false, tiers: value, error: null }
      } catch (err) {
        if (latestRank.get(key) !== seq) return
        // NO_SNAPSHOT is the view's no-snapshot state, not an error.
        this.results[key] = { input: { model, effort, credentialProfileId }, loading: false, tiers: null, error: routingFailure(err) }
      }
    }
  }
})
```

The key is unambiguous: a credential id is a UUID, a model slug matches `^[A-Za-z0-9._:/@~-]{1,200}$` and an effort `^[a-z0-9_-]{1,40}$` (`routing.ts:411–413`), so none holds `|`, and no effort is the empty string. `window.chorus.routing` missing (an isolated harness) is a caught `TypeError`, recorded as `OPERATION_FAILED`.

## Normative contracts — `src/renderer/src/components/routing/HelperTierSelect.vue`

New file, LF. Presentational (Phase 3 C15, C12): no store, no `window.chorus`, no clock; every string from `routingView`, imported as types only.

```vue
<script setup lang="ts">
/**
 * Model Routing Task 4b-3: the routing tier of one Team helper slot
 * (ImplementationSpec-4b-3).
 *
 * ⚠ PRESENTATIONAL ONLY (Phase 3 C15, C12). Every string arrives built by
 * `shared/routingView.ts`, which has the tests; this component formats
 * nothing and decides nothing. No store, no `window.chorus`, no clock.
 *
 * One native <select> (MR-D15 says a dropdown, not the cards): Budget,
 * Balanced, Fast, Nitro, OpenRouter default. A disabled option says why in its
 * own text; the hint below the select says why a restored tier fell back. A
 * change emits `select` once, and only for an enabled option.
 */
import { useId } from 'vue'
import type { HelperTierSelectView, RoutingLaunchChoice } from '../../../../shared/routingView'

const props = defineProps<{ view: HelperTierSelectView; label: string }>()
const emit = defineEmits<{ select: [choice: RoutingLaunchChoice] }>()
const hintId = useId()

function onChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  const option = props.view.options.find((o) => o.choice === value && !o.disabled)
  if (option !== undefined && option.choice !== props.view.selected) emit('select', option.choice)
}
</script>

<template>
  <span
    class="helper-tier"
    data-routing-helper-tier
    :data-routing-helper-selected="view.selected"
    :data-routing-helper-busy="String(view.busy)"
  >
    <select
      data-routing-helper-select
      :aria-label="label"
      :aria-describedby="view.hint !== null ? hintId : undefined"
      :disabled="view.busy"
      :value="view.selected"
      @change="onChange"
    >
      <option v-for="o in view.options" :key="o.choice" :value="o.choice" :disabled="o.disabled" :title="o.title ?? undefined">{{ o.text }}</option>
    </select>
    <span v-if="view.hint !== null" :id="hintId" class="helper-tier-hint" data-routing-helper-hint>{{ view.hint }}</span>
  </span>
</template>

<style scoped>
.helper-tier{display:flex;flex-direction:column;gap:4px;flex:0 0 15rem;min-width:0}
select{width:100%;min-width:0;padding:7px;background:var(--color-bg-secondary,#202226);color:inherit;border:1px solid #555;border-radius:5px}
select:disabled{opacity:.45}
.helper-tier-hint{font-size:12px;color:var(--color-state-attention-text)}
</style>
```

| Element | Contract (the drive in Task 4b-4 reads exactly these) |
|---|---|
| Root `span.helper-tier[data-routing-helper-tier]` | `data-routing-helper-selected` = `view.selected`; `data-routing-helper-busy` = `"true"`/`"false"`. It sits in the helper's own `div.row`, between the helper select and Remove. |
| `select[data-routing-helper-select]` | `aria-label` = the `label` prop (`Routing tier for helper N`, never starting with `Helper `, so `select[aria-label^="Helper "]` still counts helper slots only: `verify-team-packaged-ui.mjs:87`, `:90`, `team-member-ui-checks.mjs:57`, `:64–65`; `verify-team-review-ui.mjs:46` counts by the unquoted `select[aria-label^=Helper]`, which the label does not match either); `aria-describedby` the hint when there is one; `disabled` while busy; `value` = `view.selected`. Vue mounts children before props, so the value selects an existing option. |
| `option` × 5 | `value` = the choice; text = `o.text`; `disabled` = `o.disabled`; `title` only when `o.title` is not null. |
| `span.helper-tier-hint[data-routing-helper-hint]` | Only when `view.hint !== null`. |

The dialog's `fieldset :disabled="busy"` (:96) disables this select during a launch, as it does the helper selects. Colours: the dialog's own select style for the control (`TeamLaunchDialog.vue:117`), `--color-state-attention-text` (`main.css:136`) for the hint.

## Normative contracts — `TeamLaunchDialog.vue`

### Behaviour

`helperTiers` is a `RoutingLaunchChoice[]` index-aligned with `helperKeys` (C12): every handler that pushes, splices or replaces one does the same to the other in the same call.

| Event | `helperKeys` (today) | `helperTiers` (new) |
|---|---|---|
| Initial state (:15) | `['codex', 'codex']` | `['default', 'default']` |
| Mount defaults (:26, R3) | `Array(2).fill(<the :nitro option, else the first enabled helper>)` | `helperKeys.map(helperTierDefault)` — Nitro for the default `:nitro` option (K10, MR-D15) |
| Add helper (:98, R8) | `push(helperKeys[0] ?? '')` | `push(helperTierDefault(key))` |
| Remove (:97, R7) | `splice(i, 1)` | `splice(i, 1)` |
| A slot's option changes (:97, R7: `@change` beside the `v-model`) | the `v-model` writes it | `[i] = helperTierDefault(<the new key>)`, read from the event target, so the order of the two `change` listeners does not matter |
| Manage team members closes with a new member (:39, R5) | `push(selectedId)` | `push(helperTierDefault(selectedId))` |
| Manage team members closes, an option vanished (:37) | that key becomes `''` | unchanged; the slot shows no dropdown until an option is chosen, which resets it |
| A preset is chosen (`usePreset`, I3) | `preset.config.helpers.map(match)` (`match` unchanged, C13) | `preset.config.helpers.map(h => h.routingTier ?? 'default')` — a preset helper with none, every pre-4b preset, shows OpenRouter default even on `:nitro`, which is exactly what it sent before (K10, Q8) |
| A tier is chosen (`HelperTierSelect` `select`) | — | `[i] = choice` |

Per slot (the `helperSlots` computed, I2): a slot whose option is OpenCode on an API key *wants* routing; while the store has not loaded (and has no load error) it is busy; once loaded, the eligibility mirror decides; an eligible slot ranks `{ model: baseModel, effort: member.effort, credentialProfileId }` once per distinct key per open, is busy until that key's reply lands, and offers `helperTierSelectView`. `routingBusy` is any slot busy; Launch and Save preset are disabled while it holds, and both handlers return early (I4, I5). A load failure makes every slot not busy and shows one `Routing is unavailable: <message>` line (C12); the helpers then go unrouted. No slot wanting routing means no `window.chorus.routing` call at all (the review-UI harness's bridge has no `routing`). `config()` adds `…(tier ? { routingTier: tier } : {})` to each helper (R4), `tier` being the slot's `helperTierToSend` value, null while busy. The note under the helpers is one `data-routing-helper-caption` line per distinct caption among the slots that show a dropdown (K11).

### Insertions (line numbers at `70d5dda`; apply bottom-up so earlier numbers stay valid)

Every inserted line is CRLF.

| # | After line (anchor) | Insert |
|---|---|---|
| I6 | 97 (the helper row; SHA-256 `1e3614fd06eef449…`) | The two template lines below. |
| I5 | 63 `async function launch(): Promise<void> {` | `  if (routingBusy.value) return // 4b-3 (C12): a team is never launched before main's tiers arrive` |
| I4 | 50 `async function savePreset(): Promise<void> {` | `  if (routingBusy.value) return // 4b-3 (C12): a preset is never saved before main's tiers arrive` |
| I3 | 48 `  leadContext.value = preset.config.leadContext ?? 'standard'` | `  helperTiers.value = preset.config.helpers.map(helper => helper.routingTier ?? 'default') // 4b-3 (K10, C13): restored per index, after the keys; none = OpenRouter default` |
| I2 | 25 `onBeforeUnmount(() => { alive = false; release() })` | The routing block (49 lines, below). |
| I1 | 9 `import TeamMemberEditor from './TeamMemberEditor.vue'` | The imports (7 lines, below). |

I6:

```html
          <p v-for="caption in helperCaptions" :key="caption" class="muted" data-routing-helper-caption>{{ caption }}</p>
          <p v-if="routingUnavailable !== null" class="error" data-routing-helper-unavailable>{{ routingUnavailable }}</p>
```

The unavailable line carries no `role="alert"`, so it is never read as the dialog's own error line (:110).

I1:

```ts
import HelperTierSelect from './routing/HelperTierSelect.vue'
import { routingTeamKey, useRoutingTeamStore, type RoutingTeamRankInput } from '../stores/routingTeam'
import { DEFAULT_ROUTING_SETTINGS, type RoutingLaunchChoice, type RoutingLaunchTier } from '../../../shared/routing'
import {
  helperChoiceView, helperDefaultChoice, helperRoutingEligibility, helperRoutingWanted, helperTierSelectLabel, helperTierSelectView,
  helperTierToSend, launchTierViews, routingHelperCaption, routingUnavailableText, type HelperTierSelectView
} from '../../../shared/routingView'
```

I2 (all names normative):

```ts
/* ── Model Routing 4b-3: the routing tier of each OpenCode helper slot ──
 * ⚠ MAIN DECIDES WHAT A TIER MEANS (K2). A slot sends only a tier NAME,
 * `routingTier`, on its member; `team:launch` checks it, and main resolves it
 * again before EVERY attempt on the numbers it holds then (MR-D32). Eligibility
 * is mirrored (K4) only to decide whether a slot shows a dropdown.
 * ⚠ NO REFRESH HERE (K11, Q2): ranking is free; Settings → Model routing refreshes.
 * ⚠ helperTiers IS INDEX-ALIGNED WITH helperKeys (C12): every handler that
 * pushes, splices or replaces one does the same to the other. */
const routingTeam = useRoutingTeamStore()
routingTeam.reset()
const helperTiers = ref<RoutingLaunchChoice[]>(['default', 'default'])
const helperOption = (key: string) => helpers.value.find(o => o.key === key)
/** K10: a slot whose option is chosen starts on Nitro for the `:nitro` model, else on OpenRouter default. */
const helperTierDefault = (key: string): RoutingLaunchChoice => helperDefaultChoice(helperOption(key)?.member.model ?? '')
function resetHelperTier(index: number, key: string): void { helperTiers.value[index] = helperTierDefault(key) }
function chooseHelperTier(index: number, choice: RoutingLaunchChoice): void { helperTiers.value[index] = choice }
function addHelper(): void { const key = helperKeys.value[0] ?? ''; helperKeys.value.push(key); helperTiers.value.push(helperTierDefault(key)) }
function removeHelper(index: number): void { helperKeys.value.splice(index, 1); helperTiers.value.splice(index, 1) }
interface HelperSlotRouting { wanted: boolean; input: RoutingTeamRankInput | null; busy: boolean; view: HelperTierSelectView | null; tier: RoutingLaunchTier | null; caption: string | null }
const routingSettings = computed(() => routingTeam.settings ?? DEFAULT_ROUTING_SETTINGS)
const helperSlots = computed(() => helperKeys.value.map((key, index): HelperSlotRouting => {
  const member = helperOption(key)?.member ?? null
  const wanted = member !== null && helperRoutingWanted(member)
  const none: HelperSlotRouting = { wanted, input: null, busy: false, view: null, tier: null, caption: null }
  if (member === null || !wanted || routingTeam.loadError !== null) return none
  if (!routingTeam.loaded) return { ...none, busy: true }
  const eligibility = helperRoutingEligibility({ harness: member.harness, authMode: member.authMode, credentialProfileId: member.credentialProfileId, model: normalizeTeamModel(member.model), credentials: routingTeam.credentials, models: routingTeam.models })
  if (!eligibility.eligible || eligibility.baseModel === null || member.credentialProfileId === null) return none
  const input: RoutingTeamRankInput = { model: eligibility.baseModel, effort: member.effort, credentialProfileId: member.credentialProfileId }
  const entry = routingTeam.results[routingTeamKey(input)]
  const busy = entry === undefined || entry.loading
  const views = launchTierViews(entry?.tiers ?? null, routingSettings.value)
  const choice = helperChoiceView({ stored: helperTiers.value[index] ?? null, model: member.model, views })
  const error = entry !== undefined && entry.error !== null && entry.error.code !== 'NO_SNAPSHOT' ? entry.error.message : null
  const view = helperTierSelectView({ views, choice, busy, error })
  return { wanted, input, busy, view, tier: busy ? null : helperTierToSend(true, view.selected), caption: routingHelperCaption(member.effort) }
}))
/** C12: Launch and Save preset wait for main's free answers for every slot that wants routing. */
const routingBusy = computed(() => helperSlots.value.some(s => s.busy))
/** K11: the note under the helpers, once per distinct effort among the slots that show a dropdown. */
const helperCaptions = computed(() => [...new Set(helperSlots.value.flatMap(s => s.view !== null && s.caption !== null ? [s.caption] : []))])
/** C12: a load failure hides every dropdown and says so once; the helpers then go unrouted. */
const routingUnavailable = computed(() => routingTeam.loadError !== null && helperSlots.value.some(s => s.wanted) ? routingUnavailableText(routingTeam.loadError.message) : null)
// C11: the three free reads, once per open, as soon as a slot wants routing.
watch(() => helperSlots.value.some(s => s.wanted), wanted => { if (wanted && !routingTeam.loaded && !routingTeam.loading && routingTeam.loadError === null) void routingTeam.load() }, { immediate: true })
// K11: one free ranking per distinct (credential, base model, effort) per open; slots that share it share the answer.
watch(() => helperSlots.value.flatMap(s => s.input !== null ? [routingTeamKey(s.input)] : []).join(' '), () => {
  for (const slot of helperSlots.value) if (slot.input !== null && routingTeam.results[routingTeamKey(slot.input)] === undefined) void routingTeam.rank(slot.input)
}, { immediate: true })
```

`TeamLaunchDialog` is mounted afresh on each open (`LaunchDialog.vue:1241`, `v-if="showTeam"`), so `routingTeam.reset()` runs once per open; Manage team members swaps only the template (:84–85), so the routing state survives it. The two DeepSeek options share one key (`<credential>|deepseek/deepseek-v4.1-flash|low`), so a default dialog ranks once.

### In-line replacements

Each replacement changes only the quoted substring, which must occur **exactly once** in its line; the line keeps its CRLF. The anchor is the line's SHA-256 (first 16 hex digits of the UTF-8 text without its CRLF), measured at `70d5dda`.

| # | Line (SHA-256 prefix) | Old substring → new substring |
|---|---|---|
| R1 | 2 (`a1ed89eae6849d62`) | `import { defaultTeamHelperModel } from '../../../shared/teamProfiles'` → `import { defaultTeamHelperModel, normalizeTeamModel } from '../../../shared/teamProfiles'` |
| R2 | 5 (`5c05f55f97722051`) | `import { computed, onBeforeUnmount, onMounted, ref } from 'vue'` → `import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'` |
| R3 | 26 (`53d55d5223b52f1b`) | `?? 'codex') } catch (e) {` → `?? 'codex'); helperTiers.value = helperKeys.value.map(helperTierDefault) } catch (e) {` |
| R4 | 31 (`06006aa60decf50b`) | (a) `const helper = member(key, true);` → `const helper = member(key, true), tier = helperSlots.value[index]?.tier ?? null;` and (b) `+ (index + 1) }` → `+ (index + 1), ...(tier ? { routingTier: tier } : {}) }` |
| R5 | 39 (`0bcb16afcd660d46`) | `helperKeys.value.push(selectedId)` → `{ helperKeys.value.push(selectedId); helperTiers.value.push(helperTierDefault(selectedId)) } // 4b-3 (K10)` |
| R6 | 96 (`82e3684e30a0eff4`) | `<fieldset :disabled="busy">` → `<fieldset :disabled="busy" :data-routing-helpers-busy="String(routingBusy)">` |
| R7 | 97 (`1e3614fd06eef449`) | (a) ``:aria-label="`Helper ${i + 1}`">`` → ``:aria-label="`Helper ${i + 1}`" @change="resetHelperTier(i, ($event.target as HTMLSelectElement).value)">`` and (b) `</select><button type="button" :disabled="helperKeys.length === 1" @click="helperKeys.splice(i, 1)">Remove</button>` → `</select><HelperTierSelect v-if="helperSlots[i]?.view" :view="helperSlots[i]!.view!" :label="helperTierSelectLabel(i)" @select="choice => chooseHelperTier(i, choice)" /><button type="button" :disabled="helperKeys.length === 1" @click="removeHelper(i)">Remove</button>` |
| R8 | 98 (`dfec219872f840b1`) | `@click="helperKeys.push(helperKeys[0] ?? '')"` → `@click="addHelper()"` |
| R9 | 107 (`2366a213efbd3ab4`) | `<button :disabled="busy \|\| !presetLabel.trim()" @click="savePreset">Save preset</button>` → `<button :disabled="busy \|\| routingBusy \|\| !presetLabel.trim()" @click="savePreset">Save preset</button>` |
| R10 | 108 (`1cb1acbe50724888`) | `:disabled="busy \|\| !capabilities?.options.some(o => o.lead && o.enabled)"` → `:disabled="busy \|\| routingBusy \|\| !capabilities?.options.some(o => o.lead && o.enabled)"` |

The insertion anchors' prefixes: 9 `088dc0cafac0571d`, 25 `e9c026b2e0b768c1`, 48 `e73cc9d5007b8952`, 50 `f2298c9620caff48`, 63 `ae021278da0625ad`, 97 `1e3614fd06eef449`. (In the table cells, `\|` is Markdown's escaped `|`; the file holds `||`.)

Nothing else changes: not `usePreset`'s `match` (:46, C13), not `launch`'s retry of the same immutable payload (:66–68), not the Codex helper's `effort: null` (:31), not the lead or the presets' own controls.

### Byte-safe edit (TeamLaunchDialog.vue)

Never edit `TeamLaunchDialog.vue` with the `Edit` tool or an editor (4a C35). Write a Node script with the `Write` tool (the Bash tool collapses backslashes in heredocs) into the session scratchpad, run it with the file's path as its argument, then delete it. It must:

1. Read the file as a `Buffer`; split it byte-wise into `{ text, eol }` records, one per terminated line (`eol` `'\r\n'` or `'\n'`); abort on a lone CR or on bytes after the last terminator.
2. Assert the starting point before changing anything: exactly 118 records, all `'\r\n'`; every anchor line's SHA-256 prefix as tabled; every replacement's old substring occurring exactly once in its line. Any mismatch aborts without writing.
3. Apply the edits bottom-up by original line number: R10, R9, R8, then on line 97 I6 (insert after) and R7, then R6, I5, I4, I3, R5, R4, R3, I2, I1, R2, R1. A replacement uses `text.replace(old, () => new)` (a function, so `$` in the new text is literal). Every inserted record has `eol = '\r\n'`.
4. Write the joined bytes; re-read and report `{ inserted, lines, crlf, lf, cr, bytesBefore, bytesAfter }`. Expected: `inserted` 61 (I1 7 + I2 49 + I3 1 + I4 1 + I5 1 + I6 2), `lines` 179, `crlf` 179, `lf` 0, `cr` 0, `bytesBefore` 14,484, `bytesAfter` 21,090.
5. Delete the script.

Then `git diff --stat src/renderer/src/components/TeamLaunchDialog.vue` must read `1 file changed, 71 insertions(+), 10 deletions(-)` and `git ls-files --eol` must still print `i/lf w/crlf`. Paste both and the report.

Measured 2026-10-05: a script that follows these steps, run against a scratch copy of the file at `70d5dda`, reported exactly the expected values, and `git diff --no-index --stat` against the original printed 71 insertions and 10 deletions; the edited copy, with the block, store and component above and a stand-in for Task 4b-1's `memberFields.routingTier`, passed `tsc -p tsconfig.node.json` and `vue-tsc -p tsconfig.web.json` (nothing in the repository was edited).

## Normative contracts — `scripts/verify-routing-settings-ui.mjs` (K13)

Line 68 becomes exactly `const PREVIEW_NOTE = 'Launches use a tier only when you choose one: in the launch dialog, or for each helper in the Team dialog.'`. Nothing else in the drive changes.

## Test cases

**How the expected values were obtained.** Computed on 2026-10-05 at `70d5dda` (nothing committed): a scratch copy of `routingView.ts` with exactly the block above appended was bundled with esbuild together with the real Phase 1 cores and run over the inputs below; the two tables were then written as vitest code and run in a scratch copy of the repository (its `node_modules` a junction to the checkout's): Table HV passed 12 of 12 and Table HS 11 of 11, beside the unchanged `routingLaunch.test.ts` and `routing.test.ts`. Every expected string below is written by hand from this specification; no test imports a value it asserts.

**Table HV — `src/shared/routingView.test.ts`.** Inputs: `D` = `DEFAULT_ROUTING_SETTINGS`; `NITRO_ID` = `SLUG + ':nitro'`; `CREDS` = `[{ id: C_ID, label: 'OR key', providerName: 'OpenRouter' }]`; `MODELS` = `[{ slug: SLUG, displayName: 'DeepSeek V4.1 Flash' }]`; the module's `helper` (`tiersFor({ profile: 'helper' })`), and three built inside the block: `helperStale` = `tiersFor({ profile: 'helper', now: '2026-10-02T10:06:00Z' })`, `helperEmpty` = `tiersFor({ profile: 'helper', settings: S_EMPTY })`, `helperFloor` = `tiersFor({ profile: 'helper', settings: S_FLOOR1000 })`. Strings: `STALE` = `Refresh first: the numbers are older than 60 min.`; `NO_SNAPSHOT` = `No endpoint numbers for this model yet. Refresh to rank it.`; `EMPTY` = `No provider meets the uptime and precision rules right now.`; `FLOOR` = `All 14 eligible endpoints are below the 1000 tok/s Budget floor.`; `NITRO_LABEL` = `Nitro — unfiltered provider routing`; `DEFAULT_DESC` = `Chorus sends no routing: OpenRouter picks the provider for each request, as before. The data-collection setting is not sent.`; `TAIL` = `Each attempt checks its tier again on the latest numbers.`. Views as `{ tier, launchable, reason, refreshable }`: `HF` = Budget, Balanced, Fast `{ true, null, false }` + Nitro `{ true, null, false }`; `HS` = the three `{ false, STALE, true }` + Nitro; `HN` = the three `{ false, NO_SNAPSHOT, true }` + Nitro; `HE` = the three `{ false, EMPTY, false }` + Nitro; `HL` = Budget `{ false, FLOOR, false }`, Balanced and Fast `{ true, null, false }` + Nitro. Options as `{ choice, label, text, disabled, title }`: `ranked(r)` = Budget, Balanced, Fast with `text` = label and `{ disabled: false, title: null }` when `r` is null, else `text` = `<Label> — <r>`, `disabled: true`, `title: r`; `NITRO_OPTION` = `{ 'nitro', NITRO_LABEL, NITRO_LABEL, false, null }`; `DEFAULT_OPTION` = `{ 'default', 'OpenRouter default', 'OpenRouter default', false, DEFAULT_DESC }`.

| # | Case | Expect |
|---|---|---|
| HV1 | Constants; `helperTierSelectLabel(0)`, `(15)` | `ROUTING_HELPER_PROFILE` `helper`; `Routing tier for helper 1`; `Routing tier for helper 16`; the first does not start with `Helper `. |
| HV2 | `helperRoutingWanted` of `{opencode, api_key}`, `{opencode, subscription}`, `{claude, api_key}`, `{codex, subscription}` | `true`, `false`, `false`, `false`. |
| HV3 | `helperRoutingEligibility` with base `{ harness: 'opencode', authMode: 'api_key', credentialProfileId: C_ID, model: SLUG, credentials: CREDS, models: MODELS }` and: base; `model: NITRO_ID`; `harness: 'claude'`; `harness: 'codex'`; `authMode: 'subscription'`; `credentialProfileId: null`; `credentialProfileId: A_ID`; `credentials: []`; `model: 'z-ai/glm-5.3'`; `models: []`; `model: 'openrouter/' + SLUG`; `model: NITRO_ID + ':nitro'`; `{ harness: 'claude', credentialProfileId: null, model: 'z-ai/glm-5.3' }`; `{ credentialProfileId: A_ID, model: 'z-ai/glm-5.3' }` | As `{ eligible, reason, baseModel }`: `{ true, null, SLUG }`; `{ true, null, SLUG }`; `not-opencode`; `not-opencode`; `not-opencode`; `credential-not-routable`; `credential-not-routable`; `credential-not-routable`; `model-not-routable`; `model-not-routable`; `model-not-routable`; `model-not-routable`; `not-opencode`; `credential-not-routable` (each ineligible row with `eligible: false`, `baseModel: null`). |
| HV4 | `helperDefaultChoice` of `NITRO_ID`, `SLUG`, `'z-ai/glm-5.3'`, `'openrouter/' + NITRO_ID`, `''` | `nitro`, `default`, `default`, `nitro`, `default`. |
| HV5 | The helper rankings, then `launchTierViews(·, D)` of `helper`, `helperStale`, `null`, `helperEmpty`, `helperFloor` | `[helper.stale, helper.snapshotAgeMinutes]` `[false, 15]`; `[helperStale.stale, helperStale.snapshotAgeMinutes]` `[true, 61]`; `helper.tiers.balanced.endpoints` `['streamlake/fp8', 'venice/fp8', 'gmicloud/fp8']`; the views strictly `HF`, `HS`, `HN`, `HE`, `HL`. |
| HV6 | `helperChoiceView({ stored, model, views })` over: (`null`, `NITRO_ID`, HF); (`null`, SLUG, HF); (`balanced`, `NITRO_ID`, HF); (`budget`, SLUG, HF); (`fast`, SLUG, HF); (`balanced`, SLUG, HS); (`balanced`, `NITRO_ID`, HN); (`fast`, SLUG, HE); (`budget`, SLUG, HL); (`balanced`, SLUG, HL); (`nitro`, SLUG, HS); (`default`, `NITRO_ID`, HS); (`null`, `NITRO_ID`, HN); (`null`, SLUG, HE) | As `{ selected, hint }`: `{ nitro, null }`; `{ default, null }`; `{ balanced, null }`; `{ budget, null }`; `{ fast, null }`; `{ default, 'Refresh to use Balanced.' }`; `{ default, 'Refresh to use Balanced.' }`; `{ default, 'Fast has no endpoint that meets the rules right now.' }`; `{ default, 'Budget has no endpoint that meets the rules right now.' }`; `{ balanced, null }`; `{ nitro, null }`; `{ default, null }`; `{ nitro, null }`; `{ default, null }`. |
| HV7 | `helperTierSelectView({ views: HF, choice: { selected: 'balanced', hint: null }, busy: false, error: null })` | Strictly `{ options: [...ranked(null), NITRO_OPTION, DEFAULT_OPTION], selected: 'balanced', hint: null, busy: false }`: values in the order `budget, balanced, fast, nitro, default`. |
| HV8 | `helperTierSelectView` with `busy: false`, `error: null` and the choice from `helperChoiceView`: (HS, stored `balanced`, SLUG); (HN, stored `null`, `NITRO_ID`); (HE, stored `fast`, SLUG); (HL, stored `budget`, SLUG) | `{ [...ranked(STALE), NITRO_OPTION, DEFAULT_OPTION], 'default', 'Refresh to use Balanced.', false }`; `{ [...ranked(NO_SNAPSHOT), …], 'nitro', null, false }`; `{ [...ranked(EMPTY), …], 'default', 'Fast has no endpoint that meets the rules right now.', false }`; `{ [Budget { text: 'Budget — ' + FLOOR, disabled: true, title: FLOOR }, Balanced and Fast enabled, NITRO_OPTION, DEFAULT_OPTION], 'default', 'Budget has no endpoint that meets the rules right now.', false }` (as `{ options, selected, hint, busy }`). E.g. the stale Balanced option's text is `Balanced — Refresh first: the numbers are older than 60 min.` |
| HV9 | Over HN with `choice = { selected: 'default', hint: 'Refresh to use Balanced.' }`: `busy: true, error: null`; `busy: false, error: 'Routing has stopped.'`; and `{ selected: 'nitro', hint: null }` with `busy: true, error: 'Routing has stopped.'` | `{ [...ranked(NO_SNAPSHOT), …], 'default', null, true }`; hint `Routing is unavailable: Routing has stopped.`; hint `null`. |
| HV10 | `helperTierToSend` of (`true`, `balanced`), (`true`, `nitro`), (`true`, `default`), (`false`, `nitro`), (`false`, `budget`), (`true`, `budget`), (`true`, `fast`) | `balanced`, `nitro`, `null`, `null`, `null`, `budget`, `fast`. |
| HV11 | `routingHelperCaption(null)`, `('low')` | `Ranked for a Team helper with no reasoning effort set. Each attempt checks its tier again on the latest numbers.`; `Ranked for a Team helper at reasoning effort "low". Each attempt checks its tier again on the latest numbers.` |
| HV12 | Determinism: every HV function over deep-frozen inputs (`helper`, `D`, `HS`, `HF`, `CREDS`, `MODELS`, the eligibility input with `model: NITRO_ID`, the choices), twice | No throw; strictly equal results; `JSON.parse(JSON.stringify(r))` strictly equals `r`; the inputs' JSON unchanged; two calls return distinct `options` arrays and distinct option objects. |

**RV21 (amended, K13):** `expect(ROUTING_PREVIEW_NOTE).toBe('Launches use a tier only when you choose one: in the launch dialog, or for each helper in the Team dialog.')`; every other RV21 expectation unchanged.

**Table HS — `src/renderer/src/stores/routingTeam.test.ts`.** Setup as `routingLaunch.test.ts`: the pass-through `plainRoutingInput` spy (`vi.mock('./routing', …)`, as :35–38); `setActivePinia(createPinia())` before each test; `vi.unstubAllGlobals()` and real timers after each. `HELPER` and `HELPER_STALE` = `computeTiers` over the golden fixture with `profile: 'helper'`, `effort: 'low'`, at `2026-10-02T09:20:00Z` and `10:06:00Z`. `A`, `C` as `routingLaunch.test.ts:69–70`; `MODELS` = `{ models: [{ slug: SLUG, displayName: 'DeepSeek V4.1 Flash' }] }`. `RANK` = `{ model: SLUG, effort: 'low', credentialProfileId: C_ID }`, `RANK_A` = `{ model: SLUG, effort: null, credentialProfileId: A_ID }`; `KEY` = `5f0c1a2e-8a3b-4c5d-9e6f-0123456789ab|deepseek/deepseek-v4.1-flash|low`; `KEY_A` = `0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a|deepseek/deepseek-v4.1-flash|`; `TIERS_REQUEST` = `{ model: SLUG, profile: 'helper', effort: 'low', credentialProfileId: C_ID }`; `TIERS_REQUEST_A` the same for `RANK_A`. A `stubRouting()` stubs every `RoutingApi` member with a `vi.fn` (`models`, `credentials`, `settingsGet`, `tiers` answer; `refresh`, `status`, `settingsSet`, `observationGet`, `observationSet`, `launchPreferences` answer a failure and must never be called; `onProgress` returns a no-op); `NEVER` = those seven names.

| # | Case | Expect |
|---|---|---|
| HS1 | `routingTeamKey` of `RANK`, `RANK_A`, `{ ...RANK, effort: 'medium' }` | `KEY`; `KEY_A`; `5f0c1a2e-8a3b-4c5d-9e6f-0123456789ab|deepseek/deepseek-v4.1-flash|medium`. |
| HS2 | `load()` | `models`, `credentials`, `settingsGet` each called once with `{}`; `tiers` and every `NEVER` member not called; `loaded` true, `loading` false, `loadError` null; `models` strictly `MODELS.models`; `credentials` strictly `[A, C]`; `settings` strictly `DEFAULT_ROUTING_SETTINGS`. |
| HS3 | `credentials` answers `{ ok: false, code: 'OPERATION_FAILED', message: 'x' }`, `settingsGet` `{ ok: false, code: 'INVALID_REQUEST', message: 'y' }` | `loadError` `{ OPERATION_FAILED, 'x' }` (first in request order); `loaded` false; `loading` false; `models` `[]`, `credentials` `[]`, `settings` null (nothing half-assigned). |
| HS4 | `rank(RANK)`: read `results` before awaiting, then after | Before: strictly `{ [KEY]: { input: RANK, loading: true, tiers: null, error: null } }` (set before the first await). After: `tiers` called once with `TIERS_REQUEST` (profile `helper`, never `interactive`); `results` strictly `{ [KEY]: { input: RANK, loading: false, tiers: HELPER, error: null } }`. |
| HS5 | `rank(RANK)` and `rank(RANK_A)` together; `tiers` answers `HELPER`, then `HELPER_STALE` | `tiers` arguments in order `[TIERS_REQUEST, TIERS_REQUEST_A]`; result keys sorted `[KEY_A, KEY]`; `results[KEY].tiers` strictly `HELPER`, `results[KEY_A].tiers` strictly `HELPER_STALE`. |
| HS6 | Three deferred replies: `rank(RANK)` #1, `rank(RANK)` #2, `rank(RANK_A)` #3; resolve #2 with `HELPER_STALE` and #3 with `HELPER`, await them; then resolve #1 with `HELPER` | `results[KEY]` strictly `{ RANK, false, HELPER_STALE, null }` (the late #1 dropped); `results[KEY_A]` strictly `{ RANK_A, false, HELPER, null }` (a sequence per key, not 4a's single one). |
| HS7 | `tiers` answers `NO_SNAPSHOT`, `No endpoint snapshot is stored for this model yet. Refresh first.` | `results[KEY]` strictly `{ input: RANK, loading: false, tiers: null, error: { code: 'NO_SNAPSHOT', message: … } }`. |
| HS8 | A pending `load()` (deferred `models`) and a pending `rank(RANK)` (deferred `tiers`); `reset()`; both replies arrive; then `rank(RANK)` again | `$state` strictly `{ loaded: false, loading: false, loadError: null, models: [], credentials: [], settings: null, results: {} }` after the late replies; the second rank lands: `results[KEY]` strictly `{ RANK, false, HELPER, null }`. |
| HS9 | `load()`, then `rank(reactive({ ...RANK }))`; inspect every recorded argument of every request member | Each `types.isProxy(arg) === false` and `structuredClone(arg)` does not throw (4 arguments in all); `models`, `credentials`, `settingsGet` called with `{}`; the spy called once and the `tiers` argument **is** the object it returned; `tiers` called with `TIERS_REQUEST`. Negative control (D14): `types.isProxy(store.results[KEY].input) === true` and `structuredClone(store.results[KEY].input)` throws `could not be cloned`. |
| HS10 | `tiers` rejects with `new Error('An object could not be cloned.')`; then `vi.stubGlobal('window', {})` and a fresh store | `rank` resolves; `results[KEY].error` `{ OPERATION_FAILED, 'An object could not be cloned.' }`. With no bridge: `load()` resolves with `loadError.code` `OPERATION_FAILED` and `loading` false; `rank(RANK)` resolves with `results[KEY].error.code` `OPERATION_FAILED` and `loading` false; `reset()` does not throw. |
| HS11 | Fake timers; a launch store and a Settings store present; `load`, `rank`, `reset` | `vi.getTimerCount()` 0 after each; no `NEVER` member called; the launch store's and the Settings store's `$state` JSON unchanged. |

## Invariants

- The renderer sends a tier name and nothing else about routing, on a helper member, only for an eligible slot and only for a tier; main checks it at `team:launch` and resolves it before each attempt (K2, MR-D32). A renderer-built routing object never exists.
- A dropdown exists only for a slot main would route (K4); its ranking uses the `helper` profile, the slot's credential and the slot's effort, free, once per key per open (K5, K11).
- Nothing refreshes: no Refresh control, no subscription, no timer in the store or the dialog (Q2, MR-D26).
- A ranked option is selectable only when fresh and non-empty; Nitro and OpenRouter default always (MR-D26); a restored ranked tier that cannot be used falls back with a visible hint (K10); no memory (K10).
- `helperTiers` stays index-aligned with `helperKeys` on every path (C12); a preset helper with no tier is OpenRouter default (Q8).
- Launch and Save preset wait for routing data; a load failure leaves the helpers unrouted and says so once (C12); no routing call when no slot wants routing.
- `routingView.ts` stays pure and imports only `./routing` (MR-G8); every renderer-to-main argument is a `plainRoutingInput` snapshot or `{}` (MR-G5); the team store shares no state with the other routing stores.
- `TeamLaunchDialog.vue` stays all-CRLF and gains exactly the specified lines.
- The Settings section's first line names both places a tier is chosen (K13); no other Phase 3–4a expected value changes.

## Verification

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

The four `Select-String` lines print nothing. `npm test`: one more file and 23 more tests than after Task 4b-2 (reference: 149 files and 4,304 tests when each table row is one test). Drives: `PASS (30 checks)`, `PASS (20 checks)` (UI harness, unchanged), `PASS (20 checks)` (IPC), `PASS (16 checks)` (Settings, `PREVIEW_NOTE` amended by K13, count unchanged); `verify-team-review-ui.mjs` prints `"passed":true` as before the edit. Byte counts: `TeamLaunchDialog.vue` `{ bytes: 21090, crlf: 179, lf: 0, cr: 0 }`; `routingView.ts` `{ crlf: 793, lf: 0, cr: 0 }` with the block exactly as written; `lf: 0`, `cr: 0` for the test file and the Settings drive. `git diff --stat` `1 file changed, 71 insertions(+), 10 deletions(-)`; `git ls-files --eol` `i/lf w/crlf` for all four. The built-app check of this task's UI is Task 4b-4's drive; this task's runtime evidence is Table HS over real `structuredClone` and real Vue reactivity, the review-UI harness mounting the edited dialog, and the Settings drive showing the K13 note.
