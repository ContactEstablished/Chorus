<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useSessionStore } from '../stores/session'

const container = ref<HTMLDivElement | null>(null)
const session = useSessionStore()

let terminal: Terminal | null = null
let fitAddon: FitAddon | null = null
let resizeObserver: ResizeObserver | null = null
const cleanups: Array<() => void> = []

function fitAndSyncPty(): void {
  if (!terminal || !fitAddon) return
  fitAddon.fit()
  if (session.sessionId && session.status === 'running') {
    void window.chorus.resizeSession(session.sessionId, terminal.cols, terminal.rows)
  }
}

onMounted(async () => {
  terminal = new Terminal({
    cursorBlink: true,
    scrollback: 10_000,
    fontSize: 14,
    fontFamily: '"Cascadia Mono", Consolas, "Courier New", monospace',
    theme: {
      background: '#1e1e1e',
      foreground: '#d4d4d4'
    }
  })
  fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  terminal.open(container.value!)

  // Attach to (or start) the main-process session, replaying buffered output.
  const attach = await window.chorus.attachSession()
  session.attached(attach.sessionId, attach.status, attach.exitCode)
  if (attach.buffer.length > 0) {
    terminal.write(attach.buffer)
  }

  cleanups.push(
    window.chorus.onSessionData((event) => {
      if (event.sessionId === session.sessionId) {
        terminal?.write(event.data)
      }
    }),
    window.chorus.onSessionExit((event) => {
      if (event.sessionId === session.sessionId) {
        session.exited(event.exitCode)
      }
    })
  )

  const dataDisposable = terminal.onData((data) => {
    if (session.sessionId && session.status === 'running') {
      void window.chorus.writeSession(session.sessionId, data)
    }
  })
  cleanups.push(() => dataDisposable.dispose())

  resizeObserver = new ResizeObserver(() => fitAndSyncPty())
  resizeObserver.observe(container.value!)

  fitAndSyncPty()
  terminal.focus()
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  for (const cleanup of cleanups) cleanup()
  terminal?.dispose()
  terminal = null
  fitAddon = null
})
</script>

<template>
  <div ref="container" class="terminal-container"></div>
</template>

<style scoped>
.terminal-container {
  height: 100%;
  width: 100%;
  background: #1e1e1e;
  padding: 4px;
}
</style>
