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
 *  side, 'column' = stacked — the axes splitPane() knows). `focus` fires when
 *  the terminal's input gains focus (1b-2), so the view store tracks the pane
 *  the user is actually typing in. */
const emit = defineEmits<{ split: [target: SplitTarget]; focus: [sessionId: string] }>()

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

/** D16 chrome: the transient fresh-conversation badge (auto-restore and
 *  manual restart both mean "this is a new conversation"), and the overlay
 *  message for the pane's own states — restoring spinner, "Working directory
 *  not found" (cwd-missing is never a sentinel exit code), restart refusal. */
const badge = ref(false)
const paneMessage = ref<string | null>(null)
let badgeTimer: ReturnType<typeof setTimeout> | undefined

/** Session title (1b-1/D18): OSC 0/2 via onTitleChange wins and may keep
 *  updating live; the first Enter-terminated typed line is the fallback while
 *  no title has ever arrived. All writes go through session:set-title,
 *  debounced 500 ms TRAILING so a redraw-storm of OSC updates collapses to
 *  ~1 write per settle and the final title always lands. */
const title = ref<string | null>(null)
let pendingLine = ''
let titleTimer: ReturnType<typeof setTimeout> | undefined

/** Worktree branch label (2-2): seeded from the attach/launch response and
 *  STATIC per session — a worktree's branch never changes under Chorus, so
 *  there is no live update path (the seed survives F5 remounts exactly the
 *  way the title does). Null for current-tree sessions. */
const branch = ref<string | null>(null)

/** Owning worktree row id (2-3): seeded from the attach response with the
 *  same seed-once discipline as branch. The close flow's clean-removal
 *  offer / dirty detach acts by this id. Null for current-tree sessions. */
const worktreeId = ref<string | null>(null)

/** 2-3 (D26 clause 5): the INLINE clean-worktree removal offer — never a
 *  window.confirm (it blocks the renderer thread). onClose parks on this
 *  promise until the user clicks Remove or Keep. */
const closeOffer = ref(false)
let closeOfferResolve: ((remove: boolean) => void) | null = null

function offerCleanRemoval(): Promise<boolean> {
  closeOffer.value = true
  return new Promise((resolve) => {
    closeOfferResolve = resolve
  })
}

function resolveCloseOffer(remove: boolean): void {
  closeOffer.value = false
  closeOfferResolve?.(remove)
  closeOfferResolve = null
}

/** 2-3: close-flow notices must outlive this pane (it unmounts as the close
 *  completes), so they ride a window CustomEvent up to App's notice surface
 *  — emitting through the layout renderers would widen files outside 2-3's
 *  scope. Same window-listener pattern as App's Ctrl+K hotkey. */
function notify(text: string): void {
  window.dispatchEvent(new CustomEvent('chorus:worktree-notice', { detail: { text } }))
}

function persistTitle(t: string): void {
  // An OSC title change can deliver '' (e.g. a TUI clearing its title);
  // main's schema requires min(1), so the write would reject as an unhandled
  // rejection. Whitespace-only would be silently no-oped in main anyway.
  if (t.trim().length === 0) return
  clearTimeout(titleTimer)
  titleTimer = setTimeout(() => {
    void window.chorus.setSessionTitle(props.sessionId, t)
  }, 500)
}

function showBadge(): void {
  badge.value = true
  clearTimeout(badgeTimer)
  badgeTimer = setTimeout(() => {
    badge.value = false
  }, 5000)
}

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
 *  replaying buffered output. Attach is a PURE VIEW BINDING — it has no spawn
 *  path at all (Task 1-5/D16 removed the 1-4 attach-time relaunch gate;
 *  relaunch lives in session:restart and the restore engine only). The
 *  response's restore flags
 *  drive this pane's chrome: spinner while the engine's stagger reaches this
 *  id, the badge when it just came up, the cwd-missing message. */
async function attachToSession(): Promise<void> {
  const attach = await window.chorus.attachSession({
    sessionId: props.sessionId,
    agent: props.agent
  })
  store.attached(attach.sessionId, props.agent, attach.status, attach.exitCode)
  // Seed the header from the persisted row ONLY while no live title exists —
  // a mid-session remount (F5) must not clobber a live OSC title with a stale
  // row value still waiting out the debounce.
  if (title.value === null && attach.title !== null) title.value = attach.title
  // 2-2: same seed-once discipline for the (static) worktree branch label.
  if (branch.value === null && attach.branch !== null) branch.value = attach.branch
  // 2-3: and for the owning worktree row id the close flow acts on.
  if (worktreeId.value === null && attach.worktreeId !== null) worktreeId.value = attach.worktreeId
  if (attach.restorePending) {
    paneMessage.value = 'Restoring session…'
  } else if (attach.cwdMissing) {
    paneMessage.value = 'Working directory not found'
  } else {
    paneMessage.value = null
  }
  if (attach.buffer.length > 0) {
    terminal?.write(attach.buffer)
  }
  if (attach.restored) showBadge()
}

/** Resolve when the given session's exit event arrives (used by the Restart
 *  and Close race guards). */
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
  if (closeOffer.value) return // a clean-removal offer is already pending
  if (pane.value.status === 'running') {
    if (!window.confirm('Kill this session and close the pane?')) return
    store.setBusy(props.sessionId, true)
    try {
      // Race guard: register before killing, and close only after the old
      // session's exit event lands — no row is deleted while its PTY lives.
      const exited = waitForExit(props.sessionId)
      await window.chorus.killSession(props.sessionId)
      await exited
    } finally {
      store.setBusy(props.sessionId, false)
    }
  }
  // 2-3 (D26 clause 5): the worktree decision lands AFTER the awaited exit
  // (the process tree is dead before anything is removed — clause 8) and
  // BEFORE the leaf/row cleanup. Cleanliness is read FRESH here via
  // worktree:dirty-files — an attach-time snapshot would be stale by close;
  // main's worktree:remove re-checks once more at execution (defense in
  // depth: this read narrows the race window, the handler's closes it).
  if (worktreeId.value) {
    const wtId = worktreeId.value
    let clean = false
    try {
      clean = (await window.chorus.getWorktreeDirtyFiles(wtId)).length === 0
    } catch {
      clean = false // unreadable → protective dirty: no offer, silent detach
    }
    if (clean) {
      // Inline offer (no window.confirm); declining takes the same path as
      // dirty — session:delete below detaches, retaining the worktree.
      const remove = await offerCleanRemoval()
      if (!terminal) return // unmounted mid-offer (F13): abandon the close
      if (remove) {
        try {
          const res = await window.chorus.removeWorktree({ worktreeId: wtId })
          if (!res.ok) {
            // Main's live re-check disagreed (dirtied in the race) or git
            // refused — the worktree is retained and detached instead.
            notify(res.reason)
          }
        } catch (err) {
          console.error('[pane] worktree:remove failed:', err)
          notify('Worktree removal failed — it is retained; see Manage worktrees')
        }
      }
    } else {
      // Dirty: silent detach is the contract default (clause 5) — the
      // session:delete below detaches transactionally; the notice tells the
      // user where their uncommitted work went.
      notify('Worktree kept (uncommitted work) — see Manage worktrees')
    }
  }
  // Close ordering (D16 clause 5): kill -> awaited exit -> leaf removed ->
  // row deleted. Sibling absorbs the freed slot; closing the LAST leaf nulls
  // the tree and clears the persisted layout, returning to the empty state.
  layoutStore.removeLeaf(props.sessionId)
  try {
    await window.chorus.deleteSession(props.sessionId)
  } catch (err) {
    // The pane is already gone; the surviving row is exited drift that the
    // next boot's reconcile pass cleans up. Log and move on.
    console.error('[pane] session:delete failed:', err)
  }
}

async function onRestart(): Promise<void> {
  store.setBusy(props.sessionId, true)
  try {
    if (pane.value.status === 'running') {
      // Race guard: register before killing, and restart only after the old
      // session's exit event lands — main refuses to restart a live session.
      const exited = waitForExit(props.sessionId)
      await window.chorus.killSession(props.sessionId)
      await exited
    }
    // D16 clause 4: ONE restart path — in-run and post-restart alike. Main
    // reads the row, re-validates cwd, spawns under the SAME row id (no row
    // creation), and writes 'running' only after the spawn succeeds.
    const res = await window.chorus.restartSession(props.sessionId)
    if ('ok' in res) {
      paneMessage.value = res.reason
      return
    }
    paneMessage.value = null
    terminal?.reset()
    store.attached(res.sessionId, props.agent, res.status, res.exitCode)
    if (res.buffer.length > 0) {
      terminal?.write(res.buffer)
    }
    showBadge()
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

  // 1b-2: xterm's input textarea exists once open() has run (D4-verified:
  // `readonly textarea: HTMLTextAreaElement | undefined` in @xterm/xterm 6).
  const onTextareaFocus = (): void => emit('focus', props.sessionId)
  terminal.textarea?.addEventListener('focus', onTextareaFocus)
  cleanups.push(() => terminal?.textarea?.removeEventListener('focus', onTextareaFocus))

  await attachToSession()

  // A focus swap (F5 keyed remount) or pane close can unmount this component
  // while the attach is in flight; onBeforeUnmount has then already run the
  // cleanups and nulled `terminal`. Registering anything past this point would
  // leak listeners for the app lifetime (the leaked onSessionRestored handler
  // could even re-attach a dead pane and consume the F10 badge meant for the
  // live one) — bail out instead.
  if (!terminal) return

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
    }),
    window.chorus.onSessionRestored((event) => {
      if (event.sessionId !== props.sessionId) return
      // The restore engine concluded for this id (relaunched, healed, or
      // cwd-missing): re-attach to land on whatever main now reports. The
      // badge shows only when the attach comes back live (attach.restored).
      terminal?.reset()
      void attachToSession()
    })
  )

  // OSC 0/2 title capture (D18): xterm parses the escape sequence and fires
  // onTitleChange with the new title. OSC wins and may keep updating live.
  const titleDisposable = terminal.onTitleChange((t) => {
    title.value = t
    persistTitle(t)
  })
  cleanups.push(() => titleDisposable.dispose())

  const dataDisposable = terminal.onData((data) => {
    if (pane.value.status === 'running') {
      void window.chorus.writeSession(props.sessionId, data)
    }
    // First-line fallback (D18): buffer keystrokes until Enter; adopt the line
    // only while no title (OSC or earlier fallback) has ever arrived.
    if (title.value !== null) return
    if (data === '\r') {
      const line = pendingLine.trim().slice(0, 120)
      pendingLine = ''
      if (line.length > 0) {
        title.value = line
        persistTitle(line)
      }
    } else if (data === '\x7f') {
      pendingLine = pendingLine.slice(0, -1)
    } else if (data >= ' ') {
      pendingLine += data
    }
  })
  cleanups.push(() => dataDisposable.dispose())

  resizeObserver = new ResizeObserver(() => onContainerResize())
  resizeObserver.observe(container.value!)

  fitAndSyncPty()
})

onBeforeUnmount(() => {
  clearTimeout(resizeTimer)
  clearTimeout(badgeTimer)
  clearTimeout(titleTimer)
  // Resolve a parked clean-removal offer so onClose's continuation can bail
  // (it checks `terminal` right after) instead of leaking the promise (F13).
  closeOfferResolve?.(false)
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
        <span v-if="title" class="max-w-[16rem] truncate text-xs text-neutral-400" :title="title">{{
          title
        }}</span>
        <span v-if="branch" class="max-w-[12rem] truncate text-xs text-sky-400" :title="branch">{{
          branch
        }}</span>
        <span v-if="badge" class="rounded bg-sky-900 px-2 py-0.5 text-[10px] text-sky-200">
          Session restarted — new conversation
        </span>
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
    <div class="relative min-h-0 flex-1">
      <div ref="container" class="terminal-container h-full bg-[#1e1e1e] p-1"></div>
      <div
        v-if="paneMessage"
        class="absolute inset-0 flex items-center justify-center bg-[#1e1e1e]/90 text-sm text-neutral-400 select-none"
      >
        {{ paneMessage }}
      </div>
      <!-- 2-3 (D26 clause 5): inline clean-worktree removal offer — never a
           window.confirm (it blocks the renderer thread). -->
      <div
        v-if="closeOffer"
        class="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 border-t border-neutral-700 bg-neutral-900/95 px-3 py-2 text-xs"
      >
        <span class="min-w-0 truncate text-neutral-300">
          Worktree
          <span v-if="branch" class="text-sky-400">{{ branch }}</span>
          is clean — nothing uncommitted. Remove it?
        </span>
        <span class="flex shrink-0 gap-2">
          <button
            class="rounded bg-red-700 px-2 py-0.5 text-white hover:bg-red-600"
            title="Remove the worktree directory and its record (the branch is kept)"
            @click="resolveCloseOffer(true)"
          >
            Remove worktree
          </button>
          <button
            class="rounded px-2 py-0.5 text-neutral-300 hover:bg-neutral-700"
            title="Keep the worktree — find it later under Manage worktrees"
            @click="resolveCloseOffer(false)"
          >
            Keep
          </button>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Hide xterm's viewport scrollbar: its appearing/disappearing on fit() would
   resize the container and re-fire the ResizeObserver in a loop (CR-1.2). */
.terminal-container :deep(.xterm-viewport) {
  overflow: hidden !important;
}
</style>
