<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import TitleBar from './components/TitleBar.vue'
import StartupSplash from './components/StartupSplash.vue'
import ProjectRail from './components/ProjectRail.vue'
import StatusBar from './components/StatusBar.vue'
import LayoutRenderer from './components/LayoutRenderer.vue'
import FilmstripRenderer from './components/FilmstripRenderer.vue'
import EmptyState from './components/EmptyState.vue'
import LaunchDialog from './components/LaunchDialog.vue'
import CommandPalette from './components/CommandPalette.vue'
import WorktreePanel from './components/WorktreePanel.vue'
import SettingsView from './views/SettingsView.vue'
import ProjectSettingsView from './views/ProjectSettingsView.vue'
import CouncilView from './views/CouncilView.vue'
import { buildCommands, type PaletteCommand } from './palette/commands'
import { buildReport, shouldReport } from './attention/reporter'
import type { AgentKind, AttachResponse, AttentionReport, SessionInfo } from '../../shared/ipc'
import { collectSessionIds } from '../../shared/layout'
import { useCouncilStore } from './stores/council'
import { useLayoutStore, type SplitTarget } from './stores/layout'
import { useProjectStore } from './stores/project'
import { useSessionStore } from './stores/session'
import { resolveFocused, useViewStore } from './stores/view'

const layout = useLayoutStore()
const projectStore = useProjectStore()
const sessionStore = useSessionStore()
const viewStore = useViewStore()
/** Read ONLY for the Ctrl+Shift+K guard — App neither starts nor cancels a run.
 *  `CouncilView` remains the sole driver; this is the same `running` fact its
 *  own Esc handler reads, deliberately not a second copy of it. */
const council = useCouncilStore()
const sessions = ref<SessionInfo[]>([])

/**
 * The launch splash (`Chorus Startup.dc.html`, the feature D83 parked). True
 * for the first ~2.75s of every renderer load, then never again for that load.
 *
 * ⚠ IT IS NOT A GATE. Everything below mounts, loads and restores UNDERNEATH
 * it from the first frame — the splash is a sheet over a workspace that is
 * already coming up, exactly as the mock draws it (the mock renders the whole
 * workspace behind its splash layer). Deferring the app until the splash
 * finished would turn a 2.75s flourish into 2.75s of real latency, and would
 * put a timer on the critical path of every boot.
 */
const splashOn = ref(true)

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

/**
 * Re-read the active project's session ROWS ONLY, discarding the tree.
 *
 * ⚠ THE DISCARD IS THE POINT, not laziness: the caller below runs just after a
 * close has already mutated the layout store and queued its debounced
 * `layout:set`, so feeding this response's tree back through `loadLayout` would
 * clobber the local tree with main's not-yet-written copy. `layout:get` is
 * simply the only channel that returns a project's session rows — there is no
 * `session:list` — so this reads it for the half it needs.
 *
 * It OBSERVES `loadToken` rather than consuming one: taking a token would make
 * this refresh supersede an in-flight project switch and skip that switch's
 * `loadLayout`, which is the one thing the token exists to protect.
 */
async function refreshSessionRows(): Promise<void> {
  const id = projectStore.activeId
  if (!id) return
  const token = loadToken
  const { sessions: rows } = await window.chorus.getLayout(id)
  // A project switch started while this was in flight — its own load owns the
  // rows now, and landing these would show the previous project's sessions.
  if (token !== loadToken || projectStore.activeId !== id) return
  sessions.value = rows
}

/**
 * A pane closed (the window event TerminalPane dispatches as it unmounts).
 * Both session-counting surfaces are refreshed FROM MAIN:
 *
 *  - the status bar's tally, off the project's session rows;
 *  - the rail's per-project count, which rides `project:list` (D80) and so is
 *    only refetched by the project store.
 *
 * ⚠ NEITHER IS DECREMENTED LOCALLY. A count kept by arithmetic drifts from the
 * table the moment one close takes a path this handler did not model — and
 * "counting is where an off-by-one hides" is the standing note on exactly this.
 * Two reads on a deliberate, user-initiated close is not a cadence worth
 * optimising.
 */
async function onSessionClosed(): Promise<void> {
  const id = projectStore.activeId
  await refreshSessionRows()
  // If a switch landed meanwhile, that switch's own watcher already refreshed
  // everything this would — and project:list would fight it for activeId.
  if (projectStore.activeId !== id) return
  await projectStore.load()
}
onMounted(() => window.addEventListener('chorus:session-closed', onSessionClosed))
onUnmounted(() => window.removeEventListener('chorus:session-closed', onSessionClosed))

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
 *  stranded). No router — same shape as viewStore.mode. The panes unmount
 *  while another view is open (expected: PTYs live in main; attach() replays
 *  on the way back) — NO keep-alive wrapper, which would keep live xterm
 *  instances invisible (the leak class de98679 removed).
 *
 *  ⚠ WIDENED TO THREE BY TASK 3b-4 (D68(3)). D64(1) rules the council surface a
 *  view/route on this very precedent, and the precedent IS this union plus a
 *  conditional render — so a third view could not exist without touching it.
 *  Council is NOT in the top-bar toggle: unlike settings it is reached
 *  deliberately, from the palette, and a run in flight owns the way back. */
const activeView = ref<'workspace' | 'settings' | 'project-settings' | 'council'>('workspace')

/**
 * Which project the project-settings view is editing. Held SEPARATELY from
 * `projectStore.activeId` on purpose: the rail's gear must be able to open the
 * settings for a project you are not currently working in, and reusing the
 * active id would force a workspace switch — tearing down the panes of
 * whatever you were doing — just to rename something.
 */
const projectSettingsId = ref<string | null>(null)

/**
 * Whether the open project-settings screen is the LAST STEP OF CREATING a
 * project rather than an edit of an existing one. The screen itself is
 * identical either way — this is the one thing that differs, and only on save:
 * a brand-new project becomes the active one on the way back to the workspace,
 * an edited one does not.
 *
 * ⚠ THE DISTINCTION IS THE WHOLE POINT. The rail's gear can open settings for a
 * project you are NOT working in (see `projectSettingsId` above), and making
 * every save switch the active project would tear down the panes of whatever
 * you were doing just because you renamed something else.
 */
const projectSettingsIsNew = ref(false)

function openProjectSettings(projectId: string, isNew = false): void {
  projectSettingsId.value = projectId
  projectSettingsIsNew.value = isNew
  activeView.value = 'project-settings'
}

/**
 * A project's settings were saved: confirm it, then leave. The toast lives at
 * App level, so it survives the view swap and lands over the workspace the user
 * is being returned to — a confirmation rendered inside the screen we are
 * closing would unmount before it could be read.
 *
 * The new project is already active (`projectStore.add` selects it before this
 * screen ever opens); `select` is a no-op in that case and is called anyway so
 * the guarantee lives here rather than in an assumption about the add flow.
 */
async function onProjectSaved(projectId: string, wrote: boolean): Promise<void> {
  const wasNew = projectSettingsIsNew.value
  projectSettingsIsNew.value = false
  // Say what actually happened. `wrote: false` only reaches here from the
  // create flow's untouched form, where "Changes have been saved" would be
  // claiming an edit the user never made.
  showToast(wrote ? 'Changes have been saved…' : 'Project added…')
  if (wasNew) await projectStore.select(projectId)
  activeView.value = 'workspace'
}

/**
 * A project was DELETED from its settings screen.
 *
 * ⚠ THE VIEW SWITCH HAPPENS FIRST, AND THE ORDER IS THE WHOLE FUNCTION.
 * `ProjectSettingsView` resolves its row out of the store by id; the row is
 * already gone, and its own template renders a permanent `Loading project…`
 * branch when it cannot find one. Leaving the view mounted for a project that
 * no longer exists strands the user on that message with no control on screen
 * but the keyboard's Esc. Switching to the workspace before anything else means
 * the screen unmounts while its data is still coherent.
 *
 * `projectSettingsId` is cleared for the same reason: it is the prop that would
 * re-open the dead screen if anything set the view back.
 */
function onProjectDeleted(projectId: string): void {
  activeView.value = 'workspace'
  projectSettingsId.value = null
  projectSettingsIsNew.value = false
  const name = projectStore.projects.find((p) => p.id === projectId)?.name
  showToast(name ? `Deleted ${name}…` : 'Project deleted…')
}

/**
 * Open the council for the ACTIVE project — its Docket first (D114).
 *
 * ⚠ A NAMED FUNCTION RATHER THAN THE INLINE ARROW IT REPLACED, because it now
 * has two callers: the palette's `council.run` command and the project rail's
 * Council row. Two literals setting the same view is how they eventually stop
 * agreeing about what else opening the council entails.
 *
 * ⚠ AND IT TAKES NO PROJECT ID. `CouncilView` reads `projectStore.activeId`
 * through its `projectId` prop, so the Docket is always the active project's —
 * the same project a run would be recorded against.
 */
function openCouncil(): void {
  activeView.value = 'council'
}

/**
 * Add project: pick a folder, then land on that project's settings screen.
 *
 * ⚠ THE PICKER STILL RUNS FIRST AND THE ROW IS STILL CREATED BY IT. The
 * settings screen is where you NAME and COLOUR the project, not where it comes
 * into existence — so a user who backs out of it has a working project with the
 * folder's name, exactly what they got before this screen existed. Cancelling
 * the picker returns null and nothing happens at all.
 */
async function addProject(): Promise<void> {
  const id = await projectStore.add()
  if (id) openProjectSettings(id, true)
}

/** True while any overlay is open above the view — the settings view's
 *  Esc-to-close yields to it (overlays own Esc first). */
const anyOverlayOpen = computed(
  () => dialogOpen.value || paletteOpen.value || worktreePanelOpen.value
)

/** Ctrl+K toggles the palette even while a terminal is focused: a focused
 *  xterm consumes key events before they bubble, so this listener rides the
 *  CAPTURE phase on window (attachCustomKeyEventHandler is the fallback if
 *  capture ever proves unreliable — it would touch every TerminalPane).
 *
 * ⚠ CAPTURE PHASE + preventDefault MEANS THIS LISTENER *STEALS* WHATEVER IT
 * BINDS — the terminal never sees it. That is what makes the choice of
 * combination a design decision rather than a preference:
 *
 *  · Ctrl+Shift+K -> Council. Pairs with Ctrl+K (whose palette already lists
 *    Council), and steals nothing a terminal user needs.
 *  · Ctrl+Shift+C was REJECTED despite being the obvious mnemonic. It is COPY
 *    in every terminal emulator, and this is an app made of terminals — taking
 *    it would break the single most-used shortcut in the product to save one
 *    keystroke of discoverability.
 *
 * ⚠ AND THE SHIFT CHECK ON THE PALETTE BRANCH IS LOAD-BEARING, NOT TIDINESS.
 * The original condition tested ctrl/alt/meta but NOT shift, so Ctrl+Shift+K
 * already opened the palette; without `!e.shiftKey` the new binding would fire
 * both behaviours off one chord. The Council branch is also tested FIRST so
 * the more specific chord wins regardless.
 */
function onGlobalKey(e: KeyboardEvent): void {
  if (e.altKey || e.metaKey || !e.ctrlKey) return
  const key = e.key.toLowerCase()
  if (key === 'k' && e.shiftKey) {
    e.preventDefault()
    // ⚠ THE SAME RULE COUNCILVIEW'S ESC HANDLER ENFORCES, AND FOR ITS REASON:
    // "a run in flight owns the way back — leaving mid-deliberation would
    // strand a paid-for run with nowhere to render." Going TO the council is
    // always allowed; leaving it while a run is live is not, and a hotkey that
    // ignored that would be a second, sloppier door out of the same room.
    if (activeView.value === 'council') {
      if (!council.running) activeView.value = 'workspace'
      return
    }
    activeView.value = 'council'
    return
  }
  if (key === 'k' && !e.shiftKey) {
    e.preventDefault()
    paletteOpen.value = !paletteOpen.value
  }
}
onMounted(() => window.addEventListener('keydown', onGlobalKey, true))
onUnmounted(() => {
  window.removeEventListener('keydown', onGlobalKey, true)
  clearTimeout(noticeTimer)
  clearTimeout(toastTimer)
})

/**
 * The affirmative twin of `paletteNotice` below: a brief confirmation that
 * something the user asked for HAPPENED. Deliberately a separate ref rather
 * than a `tone` on the notice — a refusal and a confirmation have different
 * dwell times (6s vs 2.5s: you read a refusal, you only glance at a tick) and
 * neither should be able to cancel the other's timer.
 */
const toast = ref<string | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | undefined
function showToast(text: string): void {
  toast.value = text
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toast.value = null
  }, 2500)
}

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

/* ------------------------------------------------------------------ */
/* Attention capture — the renderer half (Task 3a-2 / spec §5.3)       */
/*                                                                     */
/* NO CLOCK HERE. The one setInterval lives in main; this side only    */
/* reports, and only on a real edge. Four facts, three of which App    */
/* already owns; the fourth is which terminal holds DOM focus, which   */
/* is renderer-only knowledge main cannot derive.                      */
/* ------------------------------------------------------------------ */

const attentionSessionId = ref<string | null>(null)
let lastAttentionReport: AttentionReport | null = null

/** The DOM-focus walk. Mode-agnostic BY CONSTRUCTION — it reads the live DOM
 *  rather than viewStore.focusedSessionId, which grid mode never updates
 *  (LayoutRenderer binds no @focus). 'focusin' bubbles, so no capture phase is
 *  needed; the house idiom of a window listener at App scope is already here
 *  twice (Ctrl+K, worktree notices) and this follows it, removal included. */
function onFocusIn(): void {
  const el = document.activeElement as HTMLElement | null
  const host = el?.closest('[data-attention-session]') as HTMLElement | null
  attentionSessionId.value = host?.dataset.attentionSession ?? null
}

/** D14: build from PRIMITIVES read out of the refs/computeds first — passing a
 *  computed itself, or any store-sourced object, hands a Vue proxy to
 *  structured clone and fails at runtime with no compile-time signal. */
function sendAttentionReport(): void {
  const next = buildReport({
    projectId: projectStore.activeId,
    sessionId: attentionSessionId.value,
    view: activeView.value,
    // ⚠ D95: THE SAME VALUE `CouncilView` IS BOUND TO, READ FROM THE SAME PLACE.
    // `buildReport` nulls it outside the council view, so this passes the fact
    // and the reporter enforces the rule — one primitive, no computed, no store
    // object crossing the bridge (D14).
    councilProjectId: projectStore.activeId,
    overlayOpen: anyOverlayOpen.value
  })
  if (!shouldReport(lastAttentionReport, next)) return
  lastAttentionReport = next
  void window.chorus.reportAttention(next)
}

watch(
  () => [projectStore.activeId, attentionSessionId.value, activeView.value, anyOverlayOpen.value],
  () => sendAttentionReport()
)

onMounted(() => {
  window.addEventListener('focusin', onFocusIn)
  // A fresh renderer clears main's reportStale immediately, so the row-11
  // overhead window is one tick at most.
  sendAttentionReport()
})
onUnmounted(() => window.removeEventListener('focusin', onFocusIn))

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
    openSettings: () => (activeView.value = 'settings'),
    openCouncil,
    hasActiveProject: projectStore.activeId !== null
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
      // The authored name/note ride the launch response for the same reason
      // `title` does: the card must read correctly on the very first paint,
      // without waiting for the next layout:get refresh.
      name: snapshot.name,
      description: snapshot.description,
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
  // The other half of the close refresh above: a launch moves the same rail
  // count. The status bar needs nothing here — its rows were just appended
  // locally from main's own launch response — but `sessionCount` rides
  // `project:list` (D80), so only a refetch moves it.
  void projectStore.load()
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 3c-2 / D74: window chrome, so it sits above everything and renders in
         all three views — `frame: false` means this bar is the only way to
         minimize, maximize or close from any of them. It is `flex: none` at
         36px; the region below stays `min-h-0 flex-1` so the terminal host
         still shrinks rather than pushing the layout past a viewport that sets
         `overflow: hidden`.
         (3c-3 deleted the tab-bar row that used to sit under it: the projects
         moved into the left rail, and the mode toggle and settings entry moved
         into that rail's footer.) -->
    <TitleBar />
    <!-- The body row (3c-3 / spec §1): rail | view | (the filmstrip's own right
         rail, which FilmstripRenderer carries). `min-h-0` is what lets the
         terminal host shrink instead of pushing the status bar off a viewport
         that sets `overflow: hidden` — its absence presents as a MISSING STATUS
         BAR and gets misdiagnosed as a status-bar bug. -->
    <div class="flex min-h-0 flex-1">
      <!-- ⚠ Workspace only. Settings and Council are full-window routes below
           the titlebar; the titlebar and status bar span all three views, the
           rail does not. -->
      <ProjectRail
        v-if="activeView === 'workspace'"
        :view-mode="viewStore.mode"
        @toggle-mode="viewStore.setMode(viewStore.mode === 'filmstrip' ? 'grid' : 'filmstrip')"
        @open-settings="activeView = 'settings'"
        @open-project-settings="openProjectSettings"
        @add-project="addProject"
        @open-council="openCouncil"
      />
      <!-- min-w-0 is the horizontal twin of min-h-0: without it a long pane
           title refuses to ellipsize and shoves the filmstrip off-screen. -->
      <div class="min-h-0 min-w-0 flex-1">
        <!-- The v-if wraps the MAIN REGION ONLY (spec §1): the window chrome and
             the overlays stay mounted in every view — that is what makes this a
             view switch rather than a fourth overlay. -->
        <SettingsView
          v-if="activeView === 'settings'"
          :overlay-open="anyOverlayOpen"
          @close="activeView = 'workspace'"
        />
        <ProjectSettingsView
          v-else-if="activeView === 'project-settings' && projectSettingsId"
          :key="projectSettingsId"
          :project-id="projectSettingsId"
          :overlay-open="anyOverlayOpen"
          :is-new="projectSettingsIsNew"
          @close="activeView = 'workspace'"
          @saved="onProjectSaved"
          @deleted="onProjectDeleted"
        />
        <CouncilView
          v-else-if="activeView === 'council'"
          :overlay-open="anyOverlayOpen"
          :project-id="projectStore.activeId"
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
    </div>
    <!-- Spans all three views, like the titlebar above it. -->
    <StatusBar :sessions="sessions" :project-id="projectStore.activeId" />
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
    <!-- The transient corner, lifted clear of the 30px status bar. A STACK, not
         two independently-positioned boxes: the confirmation toast and the
         refusal notice occupy the same corner, and fixing both to it would have
         drawn one on top of the other the first time they were live together.
         Toast first so it sits above; the notice keeps the corner. -->
    <div class="notice-stack">
      <Transition name="toast">
        <div v-if="toast" class="app-toast">
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M2.5 6.4l2.4 2.4L9.5 3.6" />
          </svg>
          {{ toast }}
        </div>
      </Transition>
      <div v-if="paletteNotice" class="palette-notice">
        {{ paletteNotice }}
      </div>
    </div>
    <!-- Last in the tree and z-100: in front of the titlebar, the overlays and
         the status bar alike. It owns its own dismissal timer and simply
         reports when it is finished. -->
    <StartupSplash v-if="splashOn" @done="splashOn = false" />
  </div>
</template>

<style scoped>
.notice-stack {
  position: fixed;
  right: 16px;
  /* 30px status bar + the 16px inset the notice used to have. */
  bottom: 46px;
  z-index: 50;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  /* The stack spans the corner but must never swallow clicks on the pane
     underneath it; the boxes inside are non-interactive too. */
  pointer-events: none;
}

.palette-notice,
.app-toast {
  border: 1px solid var(--color-border-badge);
  border-radius: var(--radius-icon);
  background: var(--color-surface-overlay);
  padding: 8px 12px;
  font-size: 13px;
  box-shadow: 0 12px 30px rgb(0 0 0 / 0.5);
}

.palette-notice {
  color: var(--color-state-error-text);
}

.app-toast {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-state-running-text);
  user-select: none;
}

/* In from the right and out again — the same direction the corner implies.
   Short enough that a 2.5s toast is mostly steady-state rather than motion. */
.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 140ms ease,
    transform 140ms ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(8px);
}
</style>
