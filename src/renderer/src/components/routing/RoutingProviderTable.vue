<script setup lang="ts">
/**
 * Model Routing Task 3-3: the collapsible all-providers grid (K7,
 * ImplementationSpec-3-3). Eligible rows first, then excluded ones, in the
 * order `providerTableView` returns them; every cell is a view-model string.
 *
 * ⚠ PRESENTATIONAL ONLY (C15): the one piece of state is `open`, and the one
 * interaction is the toggle. Rows are not selectable (MR-D21): no handler, no
 * tabindex, no hover highlight.
 *
 * CSS-grid rows rather than a <table> (no <table> exists in the renderer;
 * EngineUsagePanel.vue's rows are the precedent). Each row has a 980px floor,
 * so a narrow window scrolls the grid inside its own box and never the page.
 */
import { ref } from 'vue'
import type { ProviderTableView } from '../../../../shared/routingView'

defineProps<{ table: ProviderTableView | null }>()

const open = ref(false)

const HEADERS = [
  'Provider / tag',
  'Quant',
  'Uptime 1d',
  'Input',
  'Output',
  'Cache read',
  'Blended',
  'TPS',
  'Latency',
  'Status'
] as const
</script>

<template>
  <div v-if="table" class="routing-table">
    <button
      type="button"
      class="set-action routing-toggle"
      data-routing-providers-toggle
      :aria-expanded="open ? 'true' : 'false'"
      @click="open = !open"
    >{{ open ? table.hideText : table.showText }}</button>

    <div v-if="open" class="routing-providers" role="table">
      <div class="routing-grid routing-head" role="row">
        <span
          v-for="(label, i) in HEADERS"
          :key="label"
          role="columnheader"
          :class="{ 'routing-num': i >= 2 && i <= 8 }"
        >{{ label }}</span>
      </div>
      <div
        v-for="row in table.rows"
        :key="row.tag"
        class="routing-grid routing-provider-row"
        :class="{ 'routing-row-excluded': !row.eligible }"
        role="row"
        data-routing-provider-row
        :data-tag="row.tag"
        :data-eligible="row.eligible ? 'true' : 'false'"
      >
        <div class="routing-col-provider" role="cell" data-col="provider">
          <span class="routing-tag">{{ row.tag }}</span>
          <span class="routing-provider-meta"><span class="routing-provider-name">{{ row.providerName }}</span> <span v-if="row.rowsText !== null" class="routing-rows">{{ row.rowsText }}</span></span>
          <span v-if="row.limitedHistory || row.cacheVerified || row.timeOfDayPrice" class="routing-chips">
            <span v-if="row.limitedHistory" class="set-chip set-chip-idle" data-routing-limited>limited history</span>
            <span v-if="row.cacheVerified" class="set-chip set-chip-ok" data-routing-cache-verified>cache verified</span>
            <span v-if="row.timeOfDayPrice" class="set-chip set-chip-warn" data-routing-time-of-day>time-of-day price</span>
          </span>
        </div>
        <div class="routing-cell" role="cell" data-col="quant">{{ row.quantization }}</div>
        <div class="routing-cell routing-num" role="cell" data-col="uptime">{{ row.uptimeText }}</div>
        <div class="routing-cell routing-num" role="cell" data-col="input">{{ row.inputText }}</div>
        <div class="routing-cell routing-num" role="cell" data-col="output">{{ row.outputText }}</div>
        <div class="routing-cell routing-num" role="cell" data-col="cache">{{ row.cacheReadText }}</div>
        <div class="routing-cell routing-num" role="cell" data-col="blended">{{ row.blendedText }}</div>
        <div class="routing-cell routing-num" role="cell" data-col="speed">{{ row.speedText }}</div>
        <div class="routing-cell routing-num" role="cell" data-col="latency">{{ row.latencyText }}</div>
        <div
          class="routing-status"
          :class="row.eligible ? 'set-row-ok' : 'set-row-warn'"
          role="cell"
          data-col="status"
        >{{ row.statusText }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.routing-table {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}

.routing-toggle {
  font-size: 10.5px;
  color: var(--color-text-secondary);
}

/* The scroll box. align-self: stretch so it takes the column's full width
   while the toggle above keeps its own. */
.routing-providers {
  align-self: stretch;
  overflow-x: auto;
  border: 1px solid var(--color-border-inset);
  border-radius: var(--radius-card);
  background: var(--color-surface-inset);
}

.routing-grid {
  display: grid;
  grid-template-columns: minmax(170px, 1.7fr) 0.8fr 0.8fr repeat(4, 0.9fr) 0.9fr 0.7fr minmax(170px, 2.2fr);
  min-width: 980px;
  column-gap: 10px;
  padding: 7px 12px;
}

.routing-head {
  padding-top: 8px;
  padding-bottom: 8px;
  font-family: var(--font-mono);
  font-size: 9.5px;
  letter-spacing: 0.04em;
  color: var(--color-text-eyebrow);
}

.routing-provider-row {
  align-items: start;
  border-top: 1px solid var(--color-border-row);
  font-family: var(--font-mono);
  font-size: 10.5px;
  line-height: 1.5;
  color: var(--color-text-body);
}

/* Excluded rows read quieter but are never hidden; the status cell keeps its
   own colour (set-row-warn). */
.routing-row-excluded {
  color: var(--color-text-tertiary);
}

.routing-col-provider {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  min-width: 0;
  overflow-wrap: anywhere;
}

.routing-tag {
  font-weight: 500;
  color: var(--color-text-primary);
}

.routing-row-excluded .routing-tag {
  color: var(--color-text-secondary);
}

.routing-provider-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  column-gap: 6px;
}

.routing-provider-name {
  font-family: var(--font-sans);
  font-size: 10.5px;
  color: var(--color-text-secondary);
}

.routing-rows {
  font-size: 10px;
  color: var(--color-text-quiet);
}

.routing-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 3px 4px;
  margin-top: 3px;
}

/* Chips one size down from settings.css's: a row carries up to three. */
.routing-chips .set-chip {
  padding: 0 5px;
  font-size: 9px;
  line-height: 1.6;
}

.routing-cell {
  min-width: 0;
  overflow-wrap: anywhere;
}

.routing-num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.routing-status {
  min-width: 0;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

/* Same treatment as settings.css gives the content column: Chromium's default
   light scrollbar would read as a different program inside a dark view. */
.routing-providers::-webkit-scrollbar {
  height: 10px;
}

.routing-providers::-webkit-scrollbar-track {
  background: transparent;
}

.routing-providers::-webkit-scrollbar-thumb {
  background: var(--color-border-badge);
  border-radius: 5px;
  border: 3px solid transparent;
  background-clip: padding-box;
}
</style>
