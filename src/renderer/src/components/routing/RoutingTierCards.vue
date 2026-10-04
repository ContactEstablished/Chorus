<script setup lang="ts">
/**
 * Model Routing Task 3-3: the Budget, Balanced and Fast cards, the Nitro card
 * and the notes list (ImplementationSpec-3-3).
 *
 * ⚠ PRESENTATIONAL ONLY (C15). Every string arrives already built by
 * `shared/routingView.ts`, which has the tests; this component formats no
 * number and decides nothing. No store, no `window.chorus`, no clock.
 *
 * ⚠ NOTHING HERE IS SELECTABLE UNLESS THE HOST PASSES `selection` (MR-D21,
 * Task 4a-4 C23). With no `selection` (Settings, the Phase 3 harness states)
 * the DOM is exactly Phase 3's: no radio, label, role, aria, title, click
 * listener, tabindex or hover affordance. With one (the launch dialog only)
 * the four cards and an "OpenRouter default" option are ONE radio group (C24):
 * one name, native arrow keys across all five, one accessible group name. A
 * radio's own `change` emits `select`; a click elsewhere on its card emits it
 * too, so every gesture emits once. Disabled reasons, labels and the default
 * option's text all arrive in `selection`, built by routingView.
 *
 * The Nitro card is told apart by its label text first and its amber left
 * edge second; colour is never the only signal, and selection keeps the edge.
 */
import { useId } from 'vue'
import type { NitroCardView, RoutingCardSelection, RoutingLaunchChoice, TierCardView } from '../../../../shared/routingView'

const props = withDefaults(
  defineProps<{ cards: TierCardView[]; nitro: NitroCardView; notes: string[]; selection?: RoutingCardSelection | null }>(),
  { selection: null }
)
const emit = defineEmits<{ select: [choice: RoutingLaunchChoice] }>()
const group = useId() // one radio name per instance

/** The reason a choice cannot be launched, or null; "OpenRouter default" is never disabled. */
function disabledReason(choice: RoutingLaunchChoice): string | null {
  if (props.selection === null || choice === 'default') return null
  return props.selection.disabledReasons[choice] ?? null
}

function isDisabled(choice: RoutingLaunchChoice): boolean {
  return disabledReason(choice) !== null
}

function choiceClass(choice: RoutingLaunchChoice): Record<string, boolean> {
  return {
    'routing-card-selectable': true,
    'routing-card-selected': props.selection?.selected === choice,
    'routing-card-disabled': isDisabled(choice)
  }
}

/** A click on a card outside its radio and label; those two emit through the radio's own `change`. */
function onCardClick(event: MouseEvent, choice: RoutingLaunchChoice): void {
  const target = event.target
  if (target instanceof Element && target.closest('input, label') !== null) return
  if (props.selection === null || isDisabled(choice) || props.selection.selected === choice) return
  emit('select', choice)
}
</script>

<template>
  <div class="routing-tiers">
    <div
      class="routing-cards"
      data-routing-cards
      :role="selection ? 'radiogroup' : undefined"
      :aria-label="selection ? selection.groupLabel : undefined"
    >
      <section
        v-for="card in cards"
        :key="card.tier"
        class="set-card routing-card"
        :class="selection ? choiceClass(card.tier) : undefined"
        :data-routing-tier="card.tier"
        :data-routing-tier-state="card.state"
        :data-routing-choice="selection ? card.tier : undefined"
        :data-routing-selected="selection ? String(selection.selected === card.tier) : undefined"
        :data-routing-disabled="selection ? String(isDisabled(card.tier)) : undefined"
        :title="selection ? (disabledReason(card.tier) ?? undefined) : undefined"
        v-on="selection ? { click: (event: MouseEvent) => onCardClick(event, card.tier) } : {}"
      >
        <header class="routing-card-head">
          <span v-if="selection" class="routing-choice-head">
            <input
              :id="`${group}-${card.tier}`"
              class="routing-radio"
              type="radio"
              data-routing-radio
              :name="group"
              :value="card.tier"
              :checked="selection.selected === card.tier"
              :disabled="isDisabled(card.tier)"
              @change="emit('select', card.tier)"
            />
            <label class="routing-card-label" :for="`${group}-${card.tier}`">{{ card.label }}</label>
          </span>
          <span v-else class="routing-card-label">{{ card.label }}</span>
          <span v-if="card.limitedHistory" class="set-chip set-chip-idle" data-routing-limited>limited history</span>
        </header>

        <div v-if="card.primary" class="routing-card-body">
          <div class="routing-primary-line">
            <span class="routing-tag" data-routing-primary>{{ card.primary.tag }}</span>
            <span class="routing-quant">{{ card.primary.quantization }}</span>
          </div>
          <div class="routing-provider-name">{{ card.primary.providerName }}</div>
          <p class="routing-metric routing-metric-price" data-routing-metric>{{ card.primary.priceText }}</p>
          <p class="routing-metric" data-routing-metric><span class="routing-nowrap">{{ card.primary.speedText }} ·</span> <span class="routing-nowrap">{{ card.primary.effectiveText }}</span></p>
          <p class="routing-metric" data-routing-metric><span class="routing-nowrap">{{ card.primary.latencyText }} ·</span> <span class="routing-nowrap">{{ card.primary.uptimeText }}</span></p>
          <div v-if="card.primary.cacheVerified || card.primary.timeOfDayPrice" class="routing-chips">
            <span v-if="card.primary.cacheVerified" class="set-chip set-chip-ok" data-routing-cache-verified>cache verified</span>
            <span v-if="card.primary.timeOfDayPrice" class="set-chip set-chip-warn" data-routing-time-of-day>time-of-day price</span>
          </div>
          <p class="routing-fallbacks" data-routing-fallbacks>{{ card.fallbackText }}</p>
        </div>

        <p class="routing-reason" data-routing-reason>{{ card.reason }}</p>
        <!-- C25: only when the card's own reason does not already say why (a stale card does not). -->
        <p
          v-if="selection && disabledReason(card.tier) !== null && disabledReason(card.tier) !== card.reason"
          class="set-hint set-hint-warn"
          data-routing-disabled-reason
        >{{ disabledReason(card.tier) }}</p>
        <p v-for="(note, i) in card.notes" :key="i" class="set-hint set-hint-warn" data-routing-card-note>{{ note }}</p>
      </section>

      <section
        class="set-card routing-card routing-card-nitro"
        :class="selection ? choiceClass('nitro') : undefined"
        data-routing-tier="nitro"
        :data-routing-tier-state="nitro.state"
        :data-routing-choice="selection ? 'nitro' : undefined"
        :data-routing-selected="selection ? String(selection.selected === 'nitro') : undefined"
        :data-routing-disabled="selection ? String(isDisabled('nitro')) : undefined"
        :title="selection ? (disabledReason('nitro') ?? undefined) : undefined"
        v-on="selection ? { click: (event: MouseEvent) => onCardClick(event, 'nitro') } : {}"
      >
        <header class="routing-card-head">
          <span v-if="selection" class="routing-choice-head">
            <input
              :id="`${group}-nitro`"
              class="routing-radio"
              type="radio"
              data-routing-radio
              :name="group"
              value="nitro"
              :checked="selection.selected === 'nitro'"
              :disabled="isDisabled('nitro')"
              @change="emit('select', 'nitro')"
            />
            <label class="routing-card-label" :for="`${group}-nitro`" data-routing-nitro-label>{{ nitro.label }}</label>
          </span>
          <span v-else class="routing-card-label" data-routing-nitro-label>{{ nitro.label }}</span>
        </header>
        <div class="routing-card-body">
          <span class="routing-tag">{{ nitro.model }}</span>
          <p v-if="nitro.likely" class="routing-metric" data-routing-nitro-likely>Likely: {{ nitro.likely.providerName }} ({{ nitro.likely.tag }}) · {{ nitro.likely.speedText }}</p>
        </div>
        <p class="set-hint set-hint-warn" data-routing-nitro-warning>{{ nitro.warning }}</p>
        <p v-if="selection && disabledReason('nitro') !== null" class="set-hint set-hint-warn" data-routing-disabled-reason>{{ disabledReason('nitro') }}</p>
        <ul class="routing-caveats">
          <li v-for="(caveat, i) in nitro.caveats" :key="i" data-routing-nitro-caveat>{{ caveat }}</li>
        </ul>
      </section>

      <!-- C24: the fifth answer to the same question, so the fifth radio of the same group. -->
      <section
        v-if="selection"
        class="set-card routing-card routing-card-default"
        :class="choiceClass('default')"
        data-routing-choice="default"
        :data-routing-selected="String(selection.selected === 'default')"
        data-routing-disabled="false"
        @click="onCardClick($event, 'default')"
      >
        <header class="routing-card-head">
          <span class="routing-choice-head">
            <input
              :id="`${group}-default`"
              class="routing-radio"
              type="radio"
              data-routing-radio
              :name="group"
              value="default"
              :checked="selection.selected === 'default'"
              @change="emit('select', 'default')"
            />
            <label class="routing-card-label" :for="`${group}-default`">{{ selection.defaultOption.label }}</label>
          </span>
        </header>
        <p class="routing-reason" data-routing-default-description>{{ selection.defaultOption.description }}</p>
      </section>
    </div>

    <ul v-if="notes.length > 0" class="routing-notes" data-routing-notes>
      <li v-for="(note, i) in notes" :key="i" class="set-hint set-hint-warn" data-routing-note>{{ note }}</li>
    </ul>
  </div>
</template>

<style scoped>
.routing-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 10px;
}

/* A card is a read-out, not a control: default cursor, no hover change. Long
   mono strings (a fallback list, the `:nitro` slug) break anywhere rather than
   overflow a 190px column. */
.routing-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 11px 13px 12px;
  overflow-wrap: anywhere;
}

/* MR-D11: the Nitro card bypasses the uptime and precision rules. Solid amber
   edge after the .set-card-protected precedent (settings.css), but at full
   strength, because this is a warning rather than a "set aside" state. The
   label text, not the colour, carries the meaning. */
.routing-card-nitro {
  border-color: color-mix(in srgb, var(--color-state-attention) 30%, var(--color-border-inset));
  border-left: 2px solid var(--color-state-attention);
}

.routing-card-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px 8px;
}

.routing-card-label {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.routing-card-body {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.routing-primary-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.routing-tag {
  font-family: var(--font-mono);
  font-size: 11.5px;
  font-weight: 500;
  color: var(--color-text-primary);
}

.routing-quant {
  flex: none;
  border: 1px solid var(--color-border-badge);
  border-radius: var(--radius-chip);
  background: var(--color-surface-badge);
  padding: 0 5px;
  font-family: var(--font-mono);
  font-size: 9.5px;
  color: var(--color-text-badge);
}

.routing-provider-name {
  margin-bottom: 3px;
  font-size: 11px;
  color: var(--color-text-secondary);
}

.routing-metric {
  font-family: var(--font-mono);
  font-size: 10.5px;
  line-height: 1.5;
  color: var(--color-text-body);
}

.routing-metric-price {
  color: var(--color-text-primary);
}

/* A narrow card breaks a metric line at its separator, never inside "48.5
   effective tok/s". */
.routing-nowrap {
  white-space: nowrap;
}

/* Chips one size down from settings.css's, so a label and its chip share one
   line even in a 190px card. */
.routing-card .set-chip {
  padding: 1px 6px;
  font-size: 9px;
}

.routing-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 3px;
}

.routing-fallbacks {
  margin-top: 3px;
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 1.5;
  color: var(--color-text-tertiary);
}

.routing-reason {
  font-size: 10.5px;
  line-height: 1.45;
  color: var(--color-text-muted);
}

.routing-caveats {
  margin: 0;
  padding-left: 13px;
  list-style: disc outside;
  font-size: 10px;
  line-height: 1.45;
  color: var(--color-text-quiet);
}

.routing-notes {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
}

/* ── Selection mode (Task 4a-4; only with a `selection` prop) ── */

/* The radio and its label stay together on the left; a chip keeps the right. */
.routing-choice-head {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.routing-radio {
  margin: 0;
  accent-color: var(--color-accent-jade);
}

/* In selection mode a card is a control: the whole card answers a click. */
.routing-card-selectable:not(.routing-card-disabled) {
  cursor: pointer;
}

.routing-card-selected {
  border-color: var(--color-accent-jade);
  box-shadow: inset 0 0 0 1px var(--color-accent-jade);
}

/* The amber edge survives selection: it carries Nitro's warning, not the state. */
.routing-card-nitro.routing-card-selected {
  border-left-color: var(--color-state-attention);
}

.routing-card-disabled .routing-card-body,
.routing-card-disabled .routing-reason,
.routing-card-disabled .routing-card-label {
  opacity: 0.55;
}

.routing-card-default {
  grid-column: 1 / -1;
}
</style>
