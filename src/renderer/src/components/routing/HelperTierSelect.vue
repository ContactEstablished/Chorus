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
