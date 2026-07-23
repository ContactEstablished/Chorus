<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import ProjectTabs from './components/ProjectTabs.vue'
import LayoutRenderer from './components/LayoutRenderer.vue'
import FilmstripRenderer from './components/FilmstripRenderer.vue'
import EmptyState from './components/EmptyState.vue'
import LaunchDialog from './components/LaunchDialog.vue'
import CommandPalette from './components/CommandPalette.vue'
import WorktreePanel from './components/WorktreePanel.vue'
import SettingsView from './views/SettingsView.vue'
import { buildCommands, type PaletteCommand } from './palette/commands'
import type { AgentKind, AttachResponse, SessionInfo } from '../../shared/ipc'
import { collectSessionIds } from '../../shared/layout'
import { useLayoutStore, type SplitTarget } from './stores/layout'
import { useProjectStore } from './stores/project'
import { useSessionStore } from './stores/session'
import { resolveFocused, useViewStore } from './stores/view'

const layout = useLayoutStore()
const projectStore = useProjectStore()
const sessionStore = useSessionStore()
const viewStore = useViewStore()
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
    // View state rides the same supersede token as the layout (1b-2): a fast
    // tab switch can cross neither. (loadFor resolves void and seeds the view
    // store itself, with its own store-level supersede guard.)
    const [{ layout: tree, sessions: rows }] = await Promise.all([
      window.chorus.getLayout(id),
      viewStore.loadFor(id)
    ])
    if (token !== loadToken) return // superseded by a faster tab switch
    layout.loadLayout(tree, id)
    sessions.value = rows
  },
  { immediate: true }
)

/** The session the filmstrip renders full-size: the persisted focus when it
 *  is still a live leaf, else the first leaf in tree order (F4 — total; a
 *  stale focusedSessionId is normal drift, never a crash). */
const effectiveFocused = computed<string | null>(() =>
  resolveFocused(layout.tree, viewStore.focusedSessionId)
)

/** Leaf sessionId -> agent kind; undefined when the session row is missing
 *  (LayoutRenderer renders a placeholder leaf that holds the geometry). */
const agentFor = (id: string): AgentKind | undefined =>
  sessions.value.find((s) => s.id === id)?.agent

function openLaunchDialog(target: SplitTarget | null = null): void {
  splitTarget.value = target
  dialogOpen.value = true
}

/* ------------------------------------------------------------------ */
/* Ctrl+K command palette (Task 1b-3 / D21)                            */
/* ------------------------------------------------------------------ */

const paletteOpen = ref(false)

/* ------------------------------------------------------------------ */
/* Workspace ⇄ settings view switch (Task 3-4 / D29)                    */
/* ------------------------------------------------------------------ */

/** Chorus's first navigation concept: a ref + v-if around the MAIN REGION
 *  only (the top bar stays mounted in both views, so the user is never
 *  stranded). No router — same shape as viewStore.mode; Phase 3b's council
 *  UI inherits this switch. The panes unmount while settings is open
 *  (expected: PTYs live in main; attach() replays on the way back) — NO
 *  keep-alive wrapper, which would keep live xterm instances invisible
 *  (the leak class de98679 removed). */
const activeView = ref<'workspace' | 'settings'>('workspace')

/** True while any overlay is open above the view — the settings view's
 *  Esc-to-close yields to it (overlays own Esc first). */
const anyOverlayOpen = computed(
  () => dialogOpen.value || paletteOpen.value || worktreePanelOpen.value
)

/** Ctrl+K toggles the palette even while a terminal is focused: a focused
 *  xterm consumes key events before they bubble, so this listener rides the
 *  CAPTURE phase on window (attachCustomKeyEventHandler is the fallback if
 *  capture ever proves unreliable — it would touch every TerminalPane). */
function onGlobalKey(e: KeyboardEvent): void {
  if (e.ctrlKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    paletteOpen.value = !paletteOpen.value
  }
}
onMounted(() => window.addEventListener('keydown', onGlobalKey, true))
onUnmounted(() => {
  window.removeEventListener('keydown', onGlobalKey, true)
  clearTimeout(noticeTimer)
})

/** Transient surface for a palette-restart refusal from main ({ok:false,
 *  reason}) — App has no pane-level chrome of its own to show it in. */
const paletteNotice = ref<string | null>(null)
let noticeTimer: ReturnType<typeof setTimeout> | undefined
function showNotice(text: string): void {
  paletteNotice.value = text
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => {
    paletteNotice.value = null
  }, 6000)
}

/* ------------------------------------------------------------------ */
/* 2-3: retained-worktree panel (D26g) + close-flow transient notices   */
/* ------------------------------------------------------------------ */

const worktreePanelOpen = ref(false)

/** A pane's close flow reports its dirty-detach outcome here. TerminalPane
 *  cannot emit up to App without widening LayoutRenderer/FilmstripRenderer
 *  (both outside 2-3's scope), so the notice rides a window CustomEvent —
 *  the same window-listener pattern as the Ctrl+K hotkey above. The pane
 *  itself is gone by the time the notice matters, so it must live at App
 *  level to outlive the closed pane. */
function onWorktreeNotice(e: Event): void {
  const text = (e as CustomEvent<{ text?: unknown }>).detail?.text
  if (typeof text === 'string' && text.length > 0) showNotice(text)
}
onMounted(() => window.addEventListener('chorus:worktree-notice', onWorktreeNotice))
onUnmounted(() => window.removeEventListener('chorus:worktree-notice', onWorktreeNotice))

/** Restart the effective focused session — the TerminalPane.onRestart
 *  sequence driven by id from App: if running, register the exit-waiter
 *  BEFORE killing, await the exit (main refuses to restart a live session),
 *  then session:restart. A missing store entry means the session never
 *  attached this run — treat as not-running and restart directly.
 *  NOTE: session:restart does NOT emit session:restored (only the restore
 *  engine does), so the store flip to 'running' must happen here — exactly
 *  what TerminalPane.onRestart does via store.attached. The pane's own
 *  session:data listener (same row id) streams the fresh TUI's output. */
async function restartFocused(): Promise<void> {
  const id = effectiveFocused.value
  if (!id) return
  const state = sessionStore.sessions[id]
  if (state?.busy) return
  sessionStore.setBusy(id, true)
  try {
    if (state?.status === 'running') {
      const exited = new Promise<void>((resolve) => {
        const off = window.chorus.onSessionExit((ev) => {
          if (ev.sessionId === id) {
            off()
            resolve()
          }
        })
      })
      await window.chorus.killSession(id)
      await exited
    }
    const res = await window.chorus.restartSession(id)
    if ('ok' in res) {
      // Structured refusal from main — surface it, never swallow it.
      console.error('[palette] restart refused:', res.reason)
      showNotice(res.reason)
      return
    }
    const agent = state?.agent ?? agentFor(id)
    if (agent) sessionStore.attached(id, agent, res.status, res.exitCode)
  } finally {
    sessionStore.setBusy(id, false)
  }
}

/** The registry, rebuilt on any store change (computed — never cache the
 *  array: the toggle label reads the CURRENT mode, focus/switch entries
 *  track the current leaves/projects). */
const paletteCommands = computed<PaletteCommand[]>(() =>
  buildCommands({
    openLaunchDialog: () => openLaunchDialog(null),
    projects: projectStore.projects,
    selectProject: (id) => projectStore.select(id),
    leaves: layout.tree
      ? collectSessionIds(layout.tree.root).map((id) => ({
          id,
          agent: agentFor(id),
          title: sessions.value.find((s) => s.id === id)?.title ?? null
        }))
      : [],
    focusSession: (id) => viewStore.setFocused(id),
    focusedSessionId: effectiveFocused.value,
    toggleMode: () => viewStore.setMode(viewStore.mode === 'filmstrip' ? 'grid' : 'filmstrip'),
    currentMode: viewStore.mode,
    restartFocused,
    manageWorktrees: () => (worktreePanelOpen.value = true),
    openSettings: () => (activeView.value = 'settings')
  })
)

/** Launch succeeded: register the new session locally and drop its leaf into
 *  the split tree. Only the main-returned session id is ever inserted; the
 *  layout store persists the tree through layout:set as usual. */
function onLaunched(payload: { agent: AgentKind; snapshot: AttachResponse }): void {
  const { agent, snapshot } = payload
  sessionStore.attached(snapshot.sessionId, agent, snapshot.status, snapshot.exitCode)
  sessions.value = [
    ...sessions.value,
    {
      id: snapshot.sessionId,
      agent,
      status: snapshot.status,
      title: snapshot.title,
      exitCode: snapshot.exitCode,
      // 2-2: branch rides the attach response (required-nullable, the 1b-1
      // title precedent) — the launch snapshot's is already correct.
      branch: snapshot.branch,
      // Approximation until the next layout:get refresh — main stamped the
      // real created_at moments ago; card elapsed reads "just now" either way.
      createdAt: new Date().toISOString()
    }
  ]
  // F23: a palette launch carries no split target. Anchor it to the pane the
  // user is actually looking at (effectiveFocused already resolves stale focus
  // to the first leaf, F4); a null focus falls through to the store's own
  // first-leaf fallback. The store is total either way — this only chooses a
  // BETTER anchor, it is not what makes the operation safe.
  const anchor: SplitTarget | null =
    splitTarget.value ??
    (layout.tree && effectiveFocused.value
      ? { targetSessionId: effectiveFocused.value, direction: 'row' }
      : null)
  layout.insertLaunchedLeaf(anchor, snapshot.sessionId)
  // A split's (or empty-state launch's) new session becomes the focused one.
  viewStore.setFocused(snapshot.sessionId)
  dialogOpen.value = false
}
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex items-stretch">
      <ProjectTabs class="min-w-0 flex-1" />
      <!-- View toggle lives here (App.vue's template, NOT ProjectTabs.vue);
           the border/bg continue the tab bar's row. -->
      <div class="flex items-center border-b border-neutral-800 bg-neutral-900 pr-2">
        <button
          class="rounded px-2 py-1 text-xs text-neutral-400 hover:text-neutral-200"
          :title="viewStore.mode === 'filmstrip' ? 'Switch to grid view' : 'Switch to filmstrip view'"
          @click="viewStore.setMode(viewStore.mode === 'filmstrip' ? 'grid' : 'filmstrip')"
        >
          {{ viewStore.mode === 'filmstrip' ? 'Grid view' : 'Filmstrip view' }}
        </button>
        <!-- Workspace ⇄ settings switch (3-4 / D29) — the top bar stays
             mounted in BOTH views so the way back is always visible. -->
        <button
          class="rounded px-2 py-1 text-xs text-neutral-400 hover:text-neutral-200"
          :title="activeView === 'settings' ? 'Back to the workspace' : 'Open settings'"
          @click="activeView = activeView === 'settings' ? 'workspace' : 'settings'"
        >
          {{ activeView === 'settings' ? 'Workspace' : 'Settings' }}
        </button>
      </div>
    </div>
    <div class="min-h-0 flex-1">
      <!-- The v-if wraps the MAIN REGION ONLY (spec §1): the top bar and the
           overlays stay mounted in both views — that is what makes this a
           view switch rather than a fourth overlay. -->
      <SettingsView
        v-if="activeView === 'settings'"
        :overlay-open="anyOverlayOpen"
        @close="activeView = 'workspace'"
      />
      <template v-else>
        <template v-if="layout.tree">
          <FilmstripRenderer
            v-if="viewStore.mode === 'filmstrip' && effectiveFocused"
            :tree="layout.tree"
            :sessions="sessions"
            :focused-session-id="effectiveFocused"
            :agent-for="agentFor"
            @focus="(id) => viewStore.setFocused(id)"
            @split="openLaunchDialog"
          />
          <LayoutRenderer
            v-else
            :node="layout.tree.root"
            :path="[]"
            :agent-for="agentFor"
            @split="openLaunchDialog"
          />
        </template>
        <EmptyState v-else @launch="openLaunchDialog()" />
      </template>
    </div>
    <LaunchDialog
      v-if="dialogOpen && projectStore.activeId"
      :project-id="projectStore.activeId"
      @cancel="dialogOpen = false"
      @launched="onLaunched"
    />
    <CommandPalette v-if="paletteOpen" :commands="paletteCommands" @close="paletteOpen = false" />
    <WorktreePanel
      v-if="worktreePanelOpen && projectStore.activeId"
      :project-id="projectStore.activeId"
      @close="worktreePanelOpen = false"
    />
    <div
      v-if="paletteNotice"
      class="fixed bottom-4 right-4 z-50 rounded bg-neutral-800 px-3 py-2 text-sm text-red-400 shadow-lg"
    >
      {{ paletteNotice }}
    </div>
  </div>
</template>
