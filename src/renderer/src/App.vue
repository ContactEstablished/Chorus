<script setup lang="ts">
import { onMounted, ref } from 'vue'
import TerminalPane from './components/TerminalPane.vue'
import type { Pane } from '../../shared/ipc'

// Pane layout comes from the persisted project (seeded claude|codex). Still a
// fixed equal split for Phase 0; the real split tree arrives in Phase 1.
const panes = ref<Pane[]>([])

onMounted(async () => {
  const layout = await window.chorus.getLayout()
  panes.value = [...layout].sort((a, b) => a.slot - b.slot)
})
</script>

<template>
  <div class="flex h-full flex-row divide-x divide-neutral-700">
    <div v-for="{ slot, agent } in panes" :key="slot" class="relative min-w-0 flex-1">
      <TerminalPane :agent="agent" />
    </div>
  </div>
</template>
