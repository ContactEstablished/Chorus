<script setup lang="ts">
import TerminalPane from './components/TerminalPane.vue'
import { useSessionStore } from './stores/session'
import type { AgentKind } from '../../shared/ipc'

// Fixed 50/50 split for Phase 0; the real split tree arrives in Phase 1.
const agents: AgentKind[] = ['claude', 'codex']
const labels: Record<AgentKind, string> = { claude: 'Claude Code', codex: 'Codex' }

const store = useSessionStore()
</script>

<template>
  <div class="app-shell">
    <div v-for="agent in agents" :key="agent" class="pane">
      <TerminalPane :agent="agent" />
      <div v-if="store.sessions[agent].status === 'exited'" class="exit-banner">
        {{ labels[agent] }} exited (code {{ store.sessions[agent].exitCode }}) — restart the app to
        relaunch.
      </div>
    </div>
  </div>
</template>

<style scoped>
.app-shell {
  height: 100%;
  display: flex;
  flex-direction: row;
}

.pane {
  flex: 1 1 0;
  min-width: 0;
  position: relative;
}

.pane + .pane {
  border-left: 1px solid #3c3c3c;
}

.exit-banner {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 6px 12px;
  background: #7f1d1d;
  color: #fecaca;
  font-family: system-ui, sans-serif;
  font-size: 13px;
}
</style>
