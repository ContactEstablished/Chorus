<script setup lang="ts">
import { onMounted, ref } from 'vue'
import LayoutRenderer from './components/LayoutRenderer.vue'
import type { AgentKind, SessionInfo } from '../../shared/ipc'
import { useLayoutStore } from './stores/layout'

const layout = useLayoutStore()
const sessions = ref<SessionInfo[]>([])

onMounted(async () => {
  // One round-trip: the tree seeds the layout store and the session rows
  // resolve each leaf's agent kind. (The spec sketch fetched twice; two
  // boot-time IPC round-trips are a needless race.)
  const { layout: tree, sessions: rows } = await window.chorus.getLayout()
  layout.loadLayout(tree)
  sessions.value = rows
})

/** Leaf sessionId -> agent kind; undefined when the session row is missing
 *  (LayoutRenderer skips that leaf, as the interim adapter's filter did). */
const agentFor = (id: string): AgentKind | undefined =>
  sessions.value.find((s) => s.id === id)?.agent
</script>

<template>
  <LayoutRenderer
    v-if="layout.tree"
    :node="layout.tree.root"
    :path="[]"
    :agent-for="agentFor"
  />
</template>
