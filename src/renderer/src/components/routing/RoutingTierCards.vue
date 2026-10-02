<script setup lang="ts">
/**
 * Model Routing Task 3-3: the Budget, Balanced and Fast cards, the Nitro card
 * and the notes list (ImplementationSpec-3-3).
 *
 * ⚠ PRESENTATIONAL ONLY (C15). Every string arrives already built by
 * `shared/routingView.ts`, which has the tests; this component formats no
 * number and decides nothing. No store, no `window.chorus`, no clock.
 *
 * ⚠ NOTHING HERE IS SELECTABLE (MR-D21). A card is not a choice in Phase 3:
 * no click, keyboard or selection handler, no tabindex and no hover
 * affordance. Phase 4 adds a selection prop and event in the same phase that
 * makes a tier affect a launch, never before.
 *
 * The Nitro card is told apart by its label text first and its amber left
 * edge second; colour is never the only signal.
 */
import type { NitroCardView, TierCardView } from '../../../../shared/routingView'

defineProps<{ cards: TierCardView[]; nitro: NitroCardView; notes: string[] }>()
</script>

<template>
  <div class="routing-tiers">
    <div class="routing-cards" data-routing-cards>
      <section
        v-for="card in cards"
        :key="card.tier"
        class="set-card routing-card"
        :data-routing-tier="card.tier"
        :data-routing-tier-state="card.state"
      >
        <header class="routing-card-head">
          <span class="routing-card-label">{{ card.label }}</span>
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
        <p v-for="(note, i) in card.notes" :key="i" class="set-hint set-hint-warn" data-routing-card-note>{{ note }}</p>
      </section>

      <section
        class="set-card routing-card routing-card-nitro"
        data-routing-tier="nitro"
        :data-routing-tier-state="nitro.state"
      >
        <header class="routing-card-head">
          <span class="routing-card-label" data-routing-nitro-label>{{ nitro.label }}</span>
        </header>
        <div class="routing-card-body">
          <span class="routing-tag">{{ nitro.model }}</span>
          <p v-if="nitro.likely" class="routing-metric" data-routing-nitro-likely>Likely: {{ nitro.likely.providerName }} ({{ nitro.likely.tag }}) · {{ nitro.likely.speedText }}</p>
        </div>
        <p class="set-hint set-hint-warn" data-routing-nitro-warning>{{ nitro.warning }}</p>
        <ul class="routing-caveats">
          <li v-for="(caveat, i) in nitro.caveats" :key="i" data-routing-nitro-caveat>{{ caveat }}</li>
        </ul>
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
</style>
