<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { AgentKind } from '../../../shared/ipc'
import { useSessionStore } from '../stores/session'

const props = defineProps<{ agent: AgentKind }>()

const labels: Record<AgentKind, string> = { claude: 'Claude Code', codex: 'Codex' }

const container = ref<HTMLDivElement | null>(null)
const store = useSessionStore()
const pane = computed(() => store.sessions[props.agent])
const dotStatus = computed(() => store.dotStatus(props.agent))

let terminal: Terminal | null = null
let fitAddon: FitAddon | null = null
let resizeObserver: ResizeObserver | null = null
const cleanups: Array<() => void> = []

function fitAndSyncPty(): void {
  if (!terminal || !fitAddon) return
  fitAddon.fit()
  if (pane.value.sessionId && pane.value.status === 'running') {
    void window.chorus.resizeSession(pane.value.sessionId, terminal.cols, terminal.rows)
  }
}

/** Attach to (or start) this agent's main-process session, replaying buffered output. */
async function attachToSession(): Promise<void> {
  const attach = await window.chorus.attachSession(props.agent)
  store.attached(props.agent, attach.sessionId, attach.status, attach.exitCode)
  if (attach.buffer.length > 0) {
    terminal?.write(attach.buffer)
  }
}

/** Resolve when the given session's exit event arrives (used by Restart's race guard). */
function waitForExit(sessionId: string): Promise<void> {
  return new Promise((resolve) => {
    const off = window.chorus.onSessionExit((event) => {
      if (event.sessionId === sessionId) {
        off()
        resolve()
      }
    })
  })
}

async function onKill(): Promise<void> {
  const sessionId = pane.value.sessionId
  if (!sessionId || pane.value.status !== 'running') return
  store.setBusy(props.agent, true)
  try {
    await window.chorus.killSession(sessionId)
    // no local state change — the onSessionExit listener flips the status
  } finally {
    store.setBusy(props.agent, false)
  }
}

async function onRestart(): Promise<void> {
  store.setBusy(props.agent, true)
  try {
    const sessionId = pane.value.sessionId
    if (sessionId && pane.value.status === 'running') {
      // Race guard: register before killing, and re-attach only after the old
      // session's exit event lands — attach() respawns only once exited.
      const exited = waitForExit(sessionId)
      await window.chorus.killSession(sessionId)
      await exited
    }
    terminal?.reset()
    await attachToSession()
  } finally {
    store.setBusy(props.agent, false)
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

  await attachToSession()

  cleanups.push(
    window.chorus.onSessionData((event) => {
      if (event.sessionId === pane.value.sessionId) {
        terminal?.write(event.data)
      }
    }),
    window.chorus.onSessionExit((event) => {
      if (event.sessionId === pane.value.sessionId) {
        store.exited(props.agent, event.exitCode)
      }
    })
  )

  const dataDisposable = terminal.onData((data) => {
    if (pane.value.sessionId && pane.value.status === 'running') {
      void window.chorus.writeSession(pane.value.sessionId, data)
    }
  })
  cleanups.push(() => dataDisposable.dispose())

  resizeObserver = new ResizeObserver(() => fitAndSyncPty())
  resizeObserver.observe(container.value!)

  fitAndSyncPty()
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
  <div class="flex h-full flex-col">
    <div
      class="flex h-8 shrink-0 items-center justify-between border-b border-neutral-800 bg-neutral-900 px-2 select-none"
    >
      <div class="flex items-center gap-2">
        <span
          class="inline-block h-2 w-2 rounded-full"
          :class="{
            'bg-green-500': dotStatus === 'running',
            'bg-neutral-500': dotStatus === 'exited-ok',
            'bg-red-500': dotStatus === 'exited-error',
            'bg-neutral-700': dotStatus === 'detached'
          }"
        />
        <span class="text-xs font-medium text-neutral-200">{{ labels[props.agent] }}</span>
      </div>
      <div class="flex items-center gap-1">
        <button
          class="rounded px-2 py-0.5 text-xs text-neutral-200 hover:bg-neutral-700 disabled:opacity-40"
          :disabled="pane.busy"
          @click="onRestart"
        >
          Restart
        </button>
        <button
          class="rounded px-2 py-0.5 text-xs text-neutral-200 hover:bg-red-700 disabled:opacity-40"
          :disabled="pane.busy || pane.status !== 'running'"
          @click="onKill"
        >
          Kill
        </button>
      </div>
    </div>
    <div ref="container" class="min-h-0 flex-1 bg-[#1e1e1e] p-1"></div>
  </div>
</template>
