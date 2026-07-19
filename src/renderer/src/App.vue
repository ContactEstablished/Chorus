<script setup lang="ts">
import TerminalPane from './components/TerminalPane.vue'
import { useSessionStore } from './stores/session'

const session = useSessionStore()
</script>

<template>
  <div class="app-shell">
    <TerminalPane />
    <div v-if="session.status === 'exited'" class="exit-banner">
      Claude Code exited (code {{ session.exitCode }}) — restart the app to relaunch.
    </div>
  </div>
</template>

<style scoped>
.app-shell {
  height: 100%;
  position: relative;
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
