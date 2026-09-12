<script setup lang="ts">
/**
 * Engine 10.1-4: what a session cost, and the gap between the honest number and
 * the one the industry quotes.
 *
 * ⚠ THIS COMPONENT DECIDES NOTHING. Every classification, bar width, ratio
 * sentence and coverage line arrives already computed from
 * `shared/engineUsageView.ts`, which has tests; this repo has no component test
 * runner and this task must not add one, so a rule written here would be a rule
 * nothing can check (D186). If you find yourself adding an `if` that changes
 * what Chorus is claiming, it belongs in the view module.
 */
import { computed, onMounted, watch } from 'vue'
import { useEngineLedgerStore } from '../stores/engineLedger'

const props = defineProps<{ projectId: string }>()
const store = useEngineLedgerStore()

const view = computed(() => store.viewFor(props.projectId))
const loading = computed(() => store.isLoading(props.projectId))

onMounted(() => void store.load(props.projectId))
watch(
  () => props.projectId,
  (id) => void store.load(id)
)
</script>

<template>
  <div class="eu">
    <div class="eu-head">
      <button class="eu-refresh" :disabled="loading" @click="store.load(props.projectId)">
        {{ loading ? 'Reading…' : 'Refresh' }}
      </button>
    </div>

    <p v-if="store.error" class="eu-error">{{ store.error }}</p>

    <p v-if="!view && !loading" class="eu-empty">Nothing measured yet.</p>

    <template v-else-if="view">
      <p class="eu-coverage">{{ view.coverageText }}</p>

      <div v-for="row in view.rows" :key="row.sessionId" class="eu-row">
        <div class="eu-row-head">
          <span class="eu-title">{{ row.title }}</span>
          <span class="eu-agent">{{ row.agent }}</span>
        </div>

        <!-- ⚠ ONE SENTENCE AND NO DASHES. A dash would say "we looked and found
             nothing", which is a different and wrong claim for an agent Chorus
             has no reader for. -->
        <p v-if="row.state === 'no-source'" class="eu-nosource">{{ row.noSourceText }}</p>

        <template v-else>
          <div v-for="metric in row.metrics" :key="metric.key" class="eu-metric">
            <span class="eu-metric-label" :title="metric.description">{{ metric.label }}</span>
            <span class="eu-metric-value" :class="{ 'eu-unmeasured': !metric.measured }">
              {{ metric.text }}
            </span>
            <!-- ⚠ THE BAR IS ABSENT, NOT ZERO-WIDTH, WHEN UNMEASURED. A
                 zero-height bar is a zero drawn in a different colour, and it
                 would claim the session was free. `v-if` on the geometry the
                 view module omits is what enforces that here. -->
            <span v-if="metric.bar" class="eu-bar" :style="{ width: metric.bar.widthPercent + '%' }">
              <span
                v-if="metric.bar.mainPercent !== null"
                class="eu-bar-main"
                :style="{
                  width: (metric.bar.mainPercent / metric.bar.widthPercent) * 100 + '%'
                }"
              />
            </span>
            <span v-else class="eu-bar-absent" />
          </div>

          <p v-if="row.ratioText" class="eu-ratio">{{ row.ratioText }}</p>
          <p v-if="row.subagentText" class="eu-subagent">{{ row.subagentText }}</p>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.eu {
  font-size: 11px;
}

.eu-head {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 8px;
}

.eu-refresh {
  font-size: 11px;
  padding: 3px 10px;
  border: 1px solid var(--color-border-inset);
  border-radius: 4px;
  background: var(--color-surface-field);
  color: var(--color-text-body);
  cursor: pointer;
}

.eu-refresh:disabled {
  opacity: 0.6;
  cursor: default;
}

.eu-coverage,
.eu-empty,
.eu-error {
  margin: 0 0 10px;
  color: var(--color-text-quiet);
  line-height: 1.5;
}

.eu-error {
  color: var(--color-state-error-text);
}

.eu-row {
  padding: 8px 0;
  border-top: 1px solid var(--color-border-divider);
}

.eu-row-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.eu-title {
  color: var(--color-text-body);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.eu-agent {
  color: var(--color-text-quiet);
  flex: none;
}

.eu-nosource {
  margin: 0;
  color: var(--color-text-quiet);
  font-style: italic;
}

.eu-metric {
  display: grid;
  grid-template-columns: 48px 92px 1fr;
  align-items: center;
  gap: 8px;
  margin-bottom: 3px;
}

.eu-metric-label {
  color: var(--color-text-quiet);
  cursor: help;
}

.eu-metric-value {
  text-align: right;
  color: var(--color-text-body);
  font-variant-numeric: tabular-nums;
}

/* ⚠ The em dash is DIMMED, never hidden: "we have not measured this" has to be
   visible to be honest. */
.eu-unmeasured {
  color: var(--color-text-quiet);
}

.eu-bar {
  display: block;
  height: 8px;
  min-width: 1px;
  border-radius: 2px;
  background: var(--color-logo-bar-low);
}

/* The main-thread share, drawn darker inside the bar so the remainder reads as
   subagent work without needing a legend. */
.eu-bar-main {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: var(--color-logo-bar-high);
}

/* Occupies the grid cell so the columns stay aligned, and draws nothing. */
.eu-bar-absent {
  display: block;
  height: 8px;
}

.eu-ratio,
.eu-subagent {
  margin: 5px 0 0;
  color: var(--color-text-quiet);
  line-height: 1.5;
}
</style>
