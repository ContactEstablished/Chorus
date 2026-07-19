<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { AgentKind } from '../../../shared/ipc'
import { useSessionStore, type PaneSessionState } from '../stores/session'
import { useLayoutStore, type SplitTarget } from '../stores/layout'

const props = defineProps<{ sessionId: string; agent: AgentKind }>()

/** Ask App to open the launch dialog splitting THIS pane ('row' = side by
 *  side, 'column' = stacked — the axes splitPane() knows). */
const emit = defineEmits<{ split: [target: SplitTarget] }>()

const labels: Record<AgentKind, string> = { claude: 'Claude Code', codex: 'Codex' }

const container = ref<HTMLDivElement | null>(null)
const store = useSessionStore()
const layoutStore = useLayoutStore()
// Session state is keyed by the stable sessions-row id (D10); before the first
// attach lands there is no entry yet, so read through a detached fallback.
const pane = computed<PaneSessionState>(
  () =>
    store.sessions[props.sessionId] ?? {
      agent: props.agent,
      status: 'detached',
      exitCode: null,
      busy: false
    }
)
const dotStatus = computed(() => store.dotStatus(props.sessionId))

let terminal: Terminal | null = null
let fitAddon: FitAddon | null = null
let resizeObserver: ResizeObserver | null = null
let resizeTimer: ReturnType<typeof setTimeout> | undefined
const cleanups: Array<() => void> = []

function fitAndSyncPty(): void {
  if (!terminal || !fitAddon) return
  fitAddon.fit()
  if (pane.value.status === 'running') {
    void window.chorus.resizeSession(props.sessionId, terminal.cols, terminal.rows)
  }
}

/** Council resize strategy (D9/CR-1.2): `fit()` on every observer tick so the
 *  canvas tracks the pane visually, but the PTY resize is debounced to 150 ms
 *  of inactivity / drag-end — alt-screen TUIs corrupt under SIGWINCH storms. */
function onContainerResize(): void {
  if (!terminal || !fitAddon) return
  fitAddon.fit()
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => {
    if (terminal && pane.value.status === 'running') {
      void window.chorus.resizeSession(props.sessionId, terminal.cols, terminal.rows)
    }
  }, 150)
}

/** Attach to this pane's main-process session by its stable sessions-row id,
 *  replaying buffered output. A plain view attach never respawns a dead
 *  session; `respawn` is set ONLY by the Restart chrome (after kill + exit). */
async function attachToSession(respawn = false): Promise<void> {
  const attach = await window.chorus.attachSession({
    sessionId: props.sessionId,
    agent: props.agent,
    respawn
  })
  store.attached(attach.sessionId, props.agent, attach.status, attach.exitCode)
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
  if (pane.value.status !== 'running') return
  store.setBusy(props.sessionId, true)
  try {
    await window.chorus.killSession(props.sessionId)
    // no local state change — the onSessionExit listener flips the status
  } finally {
    store.setBusy(props.sessionId, false)
  }
}

async function onClose(): Promise<void> {
  if (pane.value.busy) return
  if (pane.value.status === 'running') {
    if (!window.confirm('Kill this session and close the pane?')) return
    store.setBusy(props.sessionId, true)
    try {
      await window.chorus.killSession(props.sessionId)
    } finally {
      store.setBusy(props.sessionId, false)
    }
  }
  // Sibling absorbs the freed slot; closing the LAST leaf nulls the tree and
  // clears the persisted layout, returning the app to the empty state.
  layoutStore.removeLeaf(props.sessionId)
}

async function onRestart(): Promise<void> {
  store.setBusy(props.sessionId, true)
  try {
    if (pane.value.status === 'running') {
      // Race guard: register before killing, and re-attach only after the old
      // session's exit event lands — respawn requires the exited state.
      const exited = waitForExit(props.sessionId)
      await window.chorus.killSession(props.sessionId)
      await exited
    }
    terminal?.reset()
    // Restart is the sole respawn path: the dead PTY is re-created under the
    // same stable row id. Plain attaches (mount/remount) never respawn.
    await attachToSession(true)
  } finally {
    store.setBusy(props.sessionId, false)
  }
}

onMounted(async () => {
  terminal = new Terminal({
    cursorBlink: true,
    // 5000 caps scrollback-reflow cost on column change (50-200 ms at 10k+).
    scrollback: 5_000,
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
      if (event.sessionId === props.sessionId) {
        terminal?.write(event.data)
      }
    }),
    window.chorus.onSessionExit((event) => {
      if (event.sessionId === props.sessionId) {
        store.exited(props.sessionId, event.exitCode)
      }
    })
  )

  const dataDisposable = terminal.onData((data) => {
    if (pane.value.status === 'running') {
      void window.chorus.writeSession(props.sessionId, data)
    }
  })
  cleanups.push(() => dataDisposable.dispose())

  resizeObserver = new ResizeObserver(() => onContainerResize())
  resizeObserver.observe(container.value!)

  fitAndSyncPty()
})

onBeforeUnmount(() => {
  clearTimeout(resizeTimer)
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
          title="Launch a session in a split beside this pane"
          @click="emit('split', { targetSessionId: props.sessionId, direction: 'row' })"
        >
          Split ⬌
        </button>
        <button
          class="rounded px-2 py-0.5 text-xs text-neutral-200 hover:bg-neutral-700 disabled:opacity-40"
          title="Launch a session in a split below this pane"
          @click="emit('split', { targetSessionId: props.sessionId, direction: 'column' })"
        >
          Split ⬍
        </button>
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
        <button
          class="rounded px-2 py-0.5 text-xs text-neutral-200 hover:bg-red-700 disabled:opacity-40"
          :disabled="pane.busy"
          title="Kill session and close pane"
          @click="onClose"
        >
          ✕
        </button>
      </div>
    </div>
    <div ref="container" class="terminal-container min-h-0 flex-1 bg-[#1e1e1e] p-1"></div>
  </div>
</template>

<style scoped>
/* Hide xterm's viewport scrollbar: its appearing/disappearing on fit() would
   resize the container and re-fire the ResizeObserver in a loop (CR-1.2). */
.terminal-container :deep(.xterm-viewport) {
  overflow: hidden !important;
}
</style>
