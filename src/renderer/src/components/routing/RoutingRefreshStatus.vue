<script setup lang="ts">
/**
 * Model Routing Task 3-3: the Refresh button, its cost statement, the snapshot
 * age, the per-stage progress, the estimate and spend, and an error line
 * (ImplementationSpec-3-3).
 *
 * ⚠ PRESENTATIONAL ONLY (C15). The button's text, disabled state and title,
 * the progress lines and the money lines all arrive built by
 * `shared/routingView.ts`. This component starts nothing: it emits `refresh`
 * and the host decides (K3: never on mount, never on a timer). A disabled
 * button fires no click, so a cooldown or a running refresh emits nothing.
 *
 * MR-D21 / MR-G7: the cost statement is always shown, before anything runs,
 * and the estimate sits above the progress lines, so it is read before any
 * probe line and before the spend.
 */
import type { RefreshButtonView, RefreshProgressView } from '../../../../shared/routingView'

defineProps<{
  button: RefreshButtonView
  costText: string
  progress: RefreshProgressView | null
  ageText: string | null
  staleText: string | null
  error: string | null
}>()

const emit = defineEmits<{ refresh: [] }>()
</script>

<template>
  <div class="routing-refresh">
    <div class="routing-refresh-row">
      <button
        type="button"
        class="set-btn-primary"
        data-routing-refresh
        :disabled="button.disabled"
        :title="button.title"
        @click="emit('refresh')"
      >{{ button.text }}</button>
      <span v-if="ageText !== null" class="routing-age" data-routing-age>{{ ageText }}</span>
    </div>

    <p class="set-hint" data-routing-cost>{{ costText }}</p>
    <p v-if="staleText !== null" class="set-hint set-hint-warn" data-routing-stale>{{ staleText }}</p>

    <div v-if="progress" class="routing-progress">
      <p v-if="progress.estimateText !== null" class="routing-estimate" data-routing-estimate>{{ progress.estimateText }}</p>
      <ol class="routing-progress-lines" data-routing-progress :data-routing-progress-state="progress.state">
        <li v-for="(line, i) in progress.lines" :key="i" data-routing-progress-line>{{ line }}</li>
      </ol>
      <p v-if="progress.spentText !== null" class="routing-spent" data-routing-spent>{{ progress.spentText }}</p>
    </div>

    <p v-if="error !== null" class="set-hint set-hint-warn" data-routing-refresh-error>{{ error }}</p>
  </div>
</template>

<style scoped>
.routing-refresh {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.routing-refresh-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}

.routing-age {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--color-text-quiet);
}

.routing-progress {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 2px;
  padding: 9px 12px;
  border: 1px solid var(--color-border-badge);
  border-radius: var(--radius-rail);
  background: var(--color-surface-well);
  overflow-wrap: anywhere;
}

/* The MR-G7 statement: what the probe may spend, stated before it spends. */
.routing-estimate {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.routing-progress-lines {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-family: var(--font-mono);
  font-size: 10.5px;
  line-height: 1.5;
  color: var(--color-text-body);
}

.routing-spent {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-primary);
}
</style>
