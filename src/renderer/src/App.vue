<script setup lang="ts">
import { onMounted, ref } from 'vue'
import TerminalPane from './components/TerminalPane.vue'
import type { AgentKind } from '../../shared/ipc'
import { collectSessionIds } from '../../shared/layout'

// Interim flatten adapter (Task 1-2): the persisted layout is now a binary
// split tree whose leaves bind stable session ids. Until Task 1-3's real
// layout view lands, we flatten the leaves in document order and render the
// same fixed 50/50 flexbox — pixel-identical to the previous fixed split.
interface LeafPane {
  sessionId: string
  agent: AgentKind
}

const panes = ref<LeafPane[]>([])

onMounted(async () => {
  const { layout, sessions } = await window.chorus.getLayout()
  panes.value = collectSessionIds(layout.root)
    .map((sessionId) => ({
      sessionId,
      agent: sessions.find((s) => s.id === sessionId)?.agent
    }))
    .filter((pane): pane is LeafPane => pane.agent !== undefined)
})
</script>

<template>
  <div class="flex h-full flex-row divide-x divide-neutral-700">
    <div v-for="pane in panes" :key="pane.sessionId" class="relative min-w-0 flex-1">
      <TerminalPane :session-id="pane.sessionId" :agent="pane.agent" />
    </div>
  </div>
</template>
