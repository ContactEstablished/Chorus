<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import ProjectTabs from './components/ProjectTabs.vue'
import LayoutRenderer from './components/LayoutRenderer.vue'
import EmptyState from './components/EmptyState.vue'
import LaunchDialog from './components/LaunchDialog.vue'
import type { AgentKind, AttachResponse, SessionInfo } from '../../shared/ipc'
import { useLayoutStore, type SplitTarget } from './stores/layout'
import { useProjectStore } from './stores/project'
import { useSessionStore } from './stores/session'

const layout = useLayoutStore()
const projectStore = useProjectStore()
const sessionStore = useSessionStore()
const sessions = ref<SessionInfo[]>([])

// Launch dialog state: open/closed plus the pane it is splitting (null when
// launched from the empty state — the new leaf then becomes the root).
const dialogOpen = ref(false)
const splitTarget = ref<SplitTarget | null>(null)

onMounted(async () => {
  await projectStore.load()
})

// Single source of truth for "which project's layout is on screen": the
// project store's activeId. Boot (load) and every tab switch flow through
// this one watcher — one round-trip: the tree seeds the layout store and the
// session rows resolve each leaf's agent kind. Main has already restored (or
// is staggered-restoring) the sessions; each TerminalPane attaches as a view.
let loadToken = 0
watch(
  () => projectStore.activeId,
  async (id) => {
    if (!id) return
    const token = ++loadToken
    const { layout: tree, sessions: rows } = await window.chorus.getLayout(id)
    if (token !== loadToken) return // superseded by a faster tab switch
    layout.loadLayout(tree, id)
    sessions.value = rows
  },
  { immediate: true }
)

/** Leaf sessionId -> agent kind; undefined when the session row is missing
 *  (LayoutRenderer renders a placeholder leaf that holds the geometry). */
const agentFor = (id: string): AgentKind | undefined =>
  sessions.value.find((s) => s.id === id)?.agent

function openLaunchDialog(target: SplitTarget | null = null): void {
  splitTarget.value = target
  dialogOpen.value = true
}

/** Launch succeeded: register the new session locally and drop its leaf into
 *  the split tree. Only the main-returned session id is ever inserted; the
 *  layout store persists the tree through layout:set as usual. */
function onLaunched(payload: { agent: AgentKind; snapshot: AttachResponse }): void {
  const { agent, snapshot } = payload
  sessionStore.attached(snapshot.sessionId, agent, snapshot.status, snapshot.exitCode)
  sessions.value = [...sessions.value, { id: snapshot.sessionId, agent, status: snapshot.status }]
  layout.insertLaunchedLeaf(splitTarget.value, snapshot.sessionId)
  dialogOpen.value = false
}
</script>

<template>
  <div class="flex h-full flex-col">
    <ProjectTabs />
    <div class="min-h-0 flex-1">
      <LayoutRenderer
        v-if="layout.tree"
        :node="layout.tree.root"
        :path="[]"
        :agent-for="agentFor"
        @split="openLaunchDialog"
      />
      <EmptyState v-else @launch="openLaunchDialog()" />
    </div>
    <LaunchDialog
      v-if="dialogOpen && projectStore.activeId"
      :project-id="projectStore.activeId"
      @cancel="dialogOpen = false"
      @launched="onLaunched"
    />
  </div>
</template>
