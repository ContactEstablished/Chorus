<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import TitleBar from './components/TitleBar.vue'
import StartupSplash from './components/StartupSplash.vue'
import SavedFlash from './components/SavedFlash.vue'
import ProjectRail from './components/ProjectRail.vue'
import StatusBar from './components/StatusBar.vue'
import GridRenderer from './components/GridRenderer.vue'
import FilmstripRenderer from './components/FilmstripRenderer.vue'
import EmptyState from './components/EmptyState.vue'
import LaunchDialog from './components/LaunchDialog.vue'
import CommandPalette from './components/CommandPalette.vue'
import ProjectSwitcher from './components/ProjectSwitcher.vue'
import WorktreePanel from './components/WorktreePanel.vue'
import SettingsView from './views/SettingsView.vue'
import ProjectSettingsView from './views/ProjectSettingsView.vue'
import CouncilView from './views/CouncilView.vue'
import DayReportView from './views/DayReportView.vue'
import { buildCommands, type PaletteCommand } from './palette/commands'
import { buildReport, shouldReport } from './attention/reporter'
import type { AgentKind, AttachResponse, AttentionReport, SessionInfo } from '../../shared/ipc'
import { collectSessionIds } from '../../shared/layout'
// F45: the sentence `reactivated_from` exists to carry, kept in the shared
// module so it is testable — there are no `.vue` tests in this repo.
import { describeReactivation } from '../../shared/projectLifecycle'
import { useCouncilStore } from './stores/council'
import { useLayoutStore } from './stores/layout'
import { useProjectStore } from './stores/project'
import { useSessionStore } from './stores/session'
import { dismissSavedFlash, flashSaved, useSavedFlash } from './composables/savedFlash'
import { useAttentionStore } from './stores/attention'
import { useFleetStore } from './stores/fleet'
import { useMemoryStore } from './stores/memory'
import { resolveFocused, useViewStore } from './stores/view'

const layout = useLayoutStore()
const projectStore = useProjectStore()
const sessionStore = useSessionStore()
const attentionStore = useAttentionStore()
const fleetStore = useFleetStore()
const memoryStore = useMemoryStore()
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

// Launch dialog state — open or closed, and nothing else. D174 deleted the
// split target that used to ride alongside it: every launch lands at the end of
// the flow now, so the four entry points (a pane's New agent button, the empty
// state, the command palette, a filmstrip pane) all mean exactly the same thing
// and none of them has anything to say about position.
const dialogOpen = ref(false)

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

/** A pane restarted or relaunched itself (see TerminalPane.announceRelaunched):
 *  the row is live again under the same id, so its card must stop showing the
 *  exit it has now outlived. */
function onSessionRelaunched(event: Event): void {
  const id = (event as CustomEvent<{ sessionId: string }>).detail?.sessionId
  if (id) patchSessionRow(id, { status: 'running', exitCode: null })
}
onMounted(() => window.addEventListener('chorus:session-relaunched', onSessionRelaunched))
onUnmounted(() => window.removeEventListener('chorus:session-relaunched', onSessionRelaunched))

/** v16: a pane locked or unlocked itself (TerminalPane.announceLockChanged).
 *  The CARD reads `locked` off the persisted row — it is a column, not
 *  main-memory state — so the row is patched here, exactly as a relaunch
 *  patches `status` above. Without this the padlock on the card would not
 *  appear until the next full `layout:get`. */
function onSessionLockChanged(event: Event): void {
  const detail = (event as CustomEvent<{ sessionId: string; locked: boolean }>).detail
  if (detail?.sessionId) patchSessionRow(detail.sessionId, { locked: detail.locked })
}
onMounted(() => window.addEventListener('chorus:session-lock-changed', onSessionLockChanged))
onUnmounted(() => window.removeEventListener('chorus:session-lock-changed', onSessionLockChanged))

/**
 * Patch ONE persisted row in place.
 *
 * ⚠ THIS IS THE FIX FOR A REAL, REPRODUCED DEFECT: the filmstrip's activity
 * lights never changed. `sessions` was re-read on exactly two events — a
 * project switch and a pane close — so a card's light was frozen at whatever
 * the row said when it was last fetched. An agent could exit with a non-zero
 * code and its card would keep showing the green "running" circle indefinitely.
 * Grid mode looked fine and hid the bug, because `TerminalPane` has its own
 * `onSessionExit` listener; **a card never attaches**, so nothing on that path
 * ever reached one.
 *
 * ⚠ PATCHED FROM THE EVENT PAYLOAD, NOT RE-FETCHED, and that is deliberate.
 * Main persists the exit status in one `onExit` listener and broadcasts it in
 * another, and `ipc.ts` states outright that the order within that Set "is not
 * contractual" — so a `layout:get` fired by the broadcast could legitimately
 * read the row BEFORE the status write lands and paint a stale green all over
 * again. The event carries the authoritative `exitCode`; using it is both
 * race-free and one IPC round-trip cheaper.
 *
 * ⚠ This does NOT contradict the "never decrement locally" note above it. That
 * rule is about COUNTS, where arithmetic drifts from the table. This copies a
 * value main has already decided, and invents nothing.
 */
function patchSessionRow(sessionId: string, patch: Partial<SessionInfo>): void {
  const index = sessions.value.findIndex((s) => s.id === sessionId)
  if (index === -1) return // another project's session, or already gone
  const next = [...sessions.value]
  next[index] = { ...next[index], ...patch }
  sessions.value = next
}

/**
 * The three lifecycle facts a CARD can only learn from main, plus the agent's
 * own account of what it is doing.
 *
 * Registered once for the app's lifetime rather than per pane: these events are
 * broadcast for EVERY session, and the whole point is to reach the sessions
 * that have no component of their own.
 */
onMounted(() => {
  const offExit = window.chorus.onSessionExit((event) => {
    patchSessionRow(event.sessionId, { status: 'exited', exitCode: event.exitCode })
    // The pane store is patched too — but ONLY for a session it already knows.
    // `exited()` no-ops on an unknown id, so a card's exit never fabricates a
    // pane entry, while a mounted pane and its card stay in agreement.
    sessionStore.exited(event.sessionId, event.exitCode)
  })
  const offRestored = window.chorus.onSessionRestored((event) => {
    // The restore engine relaunched it: live again, and its previous exit code
    // is no longer true of the process now running.
    patchSessionRow(event.sessionId, { status: 'running', exitCode: null })
  })
  const offActivity = window.chorus.onSessionActivity((event) => {
    sessionStore.activityChanged(event.sessionId, event.activity, event.since)
  })
  // The rail's per-project roll-up, computed in main because the renderer holds
  // session rows for the ACTIVE PROJECT ONLY and structurally cannot derive it
  // (see projectAttentionSchema). Replaced wholesale — absence clears a light.
  const offAttention = window.chorus.onProjectAttention((event) => {
    attentionStore.loaded(event.projects)
  })
  // D182: who is reachable and what each pane is CURRENTLY called. One
  // app-lifetime subscription, on the same footing as the roll-up above — and
  // deliberately WITHOUT a cold read, because a renderer that has not heard
  // from the poll yet must show `unknown` rather than anything remembered.
  const offFleet = window.chorus.onFleetSnapshot((event) => {
    fleetStore.received(event)
  })
  // v16: the context ring, on exactly the same footing as the activity light
  // above — one app-lifetime subscription plus one cold read, because both
  // facts are broadcast for EVERY session and the surface that needs them most
  // (the filmstrip card) never attaches.
  const offContext = window.chorus.onSessionContext((event) => {
    sessionStore.contextChanged(event.sessionId, event.usage)
  })
  // Task 6b-1 (D168): the memory-usage counter, beside its twin. One
  // subscription and NO cold read — a counter lost on reload is a hint whose
  // durable answer is already on the sessions row (see `IpcChannel.SessionMemory`).
  const offMemory = window.chorus.onSessionMemory((event) => {
    sessionStore.memoryUsageChanged(event.sessionId, event.usage)
  })
  // Task 6b-2 (D169): did the graph answer when a session launched, and was the
  // memory contract therefore sent? One subscription and NO cold read — the
  // fact has main-memory lifetime by design, and a launch that happened before
  // this renderer existed is not one this window can honestly report on.
  const offMemoryLaunch = window.chorus.onMemoryLaunch((event) => {
    memoryStore.launchObserved(event)
  })
  // The cold read the edge-triggered event cannot serve — see the channel's
  // note in shared/ipc.ts. Without it a dev reload (or any renderer restart)
  // paints green over an agent that has been waiting for minutes.
  void window.chorus
    .getSessionActivities()
    .then((res) => sessionStore.activityLoaded(res.activities))
    .catch(() => {
      /* no listener bound in main: the app simply has no lights this run */
    })
  // The rail's own cold read, and it finds something the one above cannot: a
  // project lit by a session that FAILED IN A PREVIOUS APP RUN has never had a
  // transition in this process, so it exists only in the table.
  void window.chorus
    .getProjectAttention()
    .then((res) => attentionStore.loaded(res.projects))
    .catch(() => {
      /* same posture as its sibling: no roll-up, no rail lights this run */
    })
  // Its twin, and its failure is just as survivable: no readings this run means
  // no rings, which is the same thing a session with no source shows anyway.
  void window.chorus
    .getSessionContexts()
    .then((res) => sessionStore.contextLoaded(res.contexts))
    .catch(() => {
      /* no tracker in main: the app simply has no rings this run */
    })
  onUnmounted(() => {
    offExit()
    offRestored()
    offActivity()
    offAttention()
    offFleet()
    offContext()
    offMemory()
    offMemoryLaunch()
  })
})

/** The session the filmstrip renders full-size: the persisted focus when it
 *  is still a live leaf, else the first leaf in tree order (F4 — total; a
 *  stale focusedSessionId is normal drift, never a crash). */
const effectiveFocused = computed<string | null>(() =>
  resolveFocused(layout.tree, viewStore.focusedSessionId)
)

/** Leaf sessionId -> agent kind; undefined when the session row is missing
 *  (GridRenderer renders a placeholder that holds the cell). */
const agentFor = (id: string): AgentKind | undefined =>
  sessions.value.find((s) => s.id === id)?.agent

function openLaunchDialog(): void {
  dialogOpen.value = true
}

/**
 * A pane's maximize/minimize button (D174). App owns this because the ruling is
 * about the WORKSPACE's mode, which no single pane can decide.
 *
 * Maximizing means "show me only this agent": the session becomes the focused
 * one AND the view becomes the filmstrip, in that order, so the filmstrip never
 * paints a frame with the previous focus. Clicking it again on the pane that is
 * already full-size is the only case that goes back — the button is a toggle on
 * THIS pane, not a mode switch — so maximizing a card's agent while another is
 * already maximized swaps the subject and stays in the filmstrip, which is what
 * the click means.
 *
 * It compares against `effectiveFocused` rather than the raw stored id because
 * that is what the filmstrip actually drew (F4 resolves a stale focus to the
 * first leaf); comparing against the stored value could refuse to minimize the
 * very pane the user is looking at.
 */
function toggleMaximize(sessionId: string): void {
  if (viewStore.mode === 'filmstrip' && effectiveFocused.value === sessionId) {
    viewStore.setMode('grid')
    return
  }
  viewStore.setFocused(sessionId)
  viewStore.setMode('filmstrip')
}

/* ------------------------------------------------------------------ */
/* Ctrl+K command palette (Task 1b-3 / D21)                            */
/* ------------------------------------------------------------------ */

const paletteOpen = ref(false)

/* ------------------------------------------------------------------ */
/* Ctrl+G project switcher (D180)                                       */
/* ------------------------------------------------------------------ */

/** The numbered project list the palette's `Switch to …` entries became. Its
 *  own overlay rather than a palette mode: it has no search box, so the digits
 *  can mean row numbers (see ProjectSwitcher.vue). */
const switcherOpen = ref(false)

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
const activeView = ref<'workspace' | 'settings' | 'project-settings' | 'council' | 'day-summary'>(
  'workspace'
)

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
 * A project's settings were saved: confirm it, then leave. The confirmation
 * lives at App level, so it survives the view swap and lands over the workspace
 * the user is being returned to — one rendered inside the screen we are closing
 * would unmount before it could be read.
 *
 * ⚠ A WRITE IS CONFIRMED BY THE MARK, NOT BY THE CORNER TOAST (2026-08-25).
 * `flashSaved()` animates the logo in the middle of the window with the word
 * `Saved` under it; the toast stays for the OTHER outcome, because the two
 * sentences are not interchangeable. `wrote: false` reaches here only from the
 * create flow's untouched form, where nothing was written at all — and a mark
 * saying *Saved* over a save that did not happen is exactly the claim D76
 * forbids. Showing both would be two confirmations for one click.
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
  if (wrote) flashSaved()
  else showToast('Project added…')
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
 *
 * ⚠ AND "ADD" DOES NOT ALWAYS ADD (F45). `projects.root_path` is UNIQUE, so
 * picking the folder of a project that was hidden or archived returns THAT row
 * and reactivates it. Two things follow, and the app got both wrong until this
 * was wired up:
 *
 *  1. THE USER IS TOLD. A reactivation that says nothing is indistinguishable
 *     from the click having been ignored, or from a duplicate having been made
 *     quietly — and the project reappears in the rail either way.
 *  2. A REACTIVATED PROJECT IS NOT NEW, SO IT DOES NOT GET THE CREATE FLOW.
 *     That screen exists to NAME and COLOUR a project that has neither; this
 *     one has a name, a colour, a description and a history from the last time
 *     it was used. Sending the user there to "finish creating" something they
 *     made months ago is busywork that also implies the old project is gone.
 *     They picked the folder to work in it, so they land in the workspace with
 *     it selected — which `projectStore.add` has already done.
 */
async function addProject(): Promise<void> {
  const added = await projectStore.add()
  if (!added) return
  if (added.reactivatedFrom) {
    showToast(describeReactivation(added.name, added.reactivatedFrom))
    return
  }
  openProjectSettings(added.id, true)
}

/** True while any overlay is open above the view — the settings view's
 *  Esc-to-close yields to it (overlays own Esc first). */
const anyOverlayOpen = computed(
  () => dialogOpen.value || paletteOpen.value || switcherOpen.value || worktreePanelOpen.value
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
 *  · Ctrl+G -> the project switcher (D180). "Go to project", and the CHEAPEST
 *    bare Ctrl+letter left: ^G is readline's abort / the ASCII bell, which no
 *    agent TUI binds. Ctrl+J was the first choice and was REJECTED for the same
 *    reason as Ctrl+Shift+C above — ^J is LINE FEED, the key that inserts a
 *    newline in Claude Code's and Codex's prompts, so stealing it would have
 *    broken multi-line input in every pane. Nearly every other letter is worse
 *    still: ^A/^E/^U/^L/^P/^N are readline's editing keys, ^C/^D are SIGINT and
 *    EOF, ^H/^I/^M ARE Backspace/Tab/Enter, and ^R/^W are also Electron's
 *    default Reload and Close Window accelerators.
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
    switcherOpen.value = false
    paletteOpen.value = !paletteOpen.value
    return
  }
  // ⚠ NO SHIFT CHECK, UNLIKE THE PALETTE BRANCH, AND IT IS DELIBERATE. Ctrl+K
  // had to exclude Shift because Ctrl+Shift+K is a DIFFERENT command; nothing
  // is bound to Ctrl+Shift+G, and a terminal cannot encode the Shift into a
  // distinct control character anyway — so accepting both spellings costs
  // nothing and saves a user who was still holding Shift from a dead keystroke.
  if (key === 'g') {
    e.preventDefault()
    paletteOpen.value = false
    switcherOpen.value = !switcherOpen.value
  }
}
onMounted(() => window.addEventListener('keydown', onGlobalKey, true))
onUnmounted(() => {
  window.removeEventListener('keydown', onGlobalKey, true)
  clearTimeout(noticeTimer)
  clearTimeout(toastTimer)
})

/**
 * The SAVE confirmation's state, rendered at the bottom of this template.
 *
 * ⚠ THIS IS NOT A THIRD FLAVOUR OF THE TOAST BELOW, AND THE SPLIT IS THE
 * POINT. The toast and the notice are SENTENCES — text you read, in the corner,
 * with a dwell tuned to how long reading takes. This is a MARK — the logo
 * animating mid-window, which you see without looking at it. What lives in this
 * file is only which one is on screen; how long the animation runs is the
 * animation's business (`SavedFlash.vue`), which is why there is no timer here.
 */
const { savedFlashShowing, savedFlashToken } = useSavedFlash()

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
 *  cannot emit up to App without widening GridRenderer/FilmstripRenderer
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
/** The last terminal that held DOM focus this run — layer 2 of the dictation
 *  seed below. Never read by the attention report. */
const lastFocusedTerminal = ref<string | null>(null)
let lastAttentionReport: AttentionReport | null = null

/** The DOM-focus walk. Mode-agnostic BY CONSTRUCTION — it reads the live DOM
 *  rather than viewStore.focusedSessionId, which grid mode never updates
 *  (GridRenderer binds no @focus). 'focusin' bubbles, so no capture phase is
 *  needed; the house idiom of a window listener at App scope is already here
 *  twice (Ctrl+K, worktree notices) and this follows it, removal included. */
function onFocusIn(): void {
  const el = document.activeElement as HTMLElement | null
  const host = el?.closest('[data-attention-session]') as HTMLElement | null
  attentionSessionId.value = host?.dataset.attentionSession ?? null
  // The STICKY half, for the dictation seed below: the last terminal that held
  // focus, kept when focus moves to a button, a rail card or the toast's Dismiss.
  if (attentionSessionId.value !== null) lastFocusedTerminal.value = attentionSessionId.value
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

/**
 * Task 5-3: the DICTATION SEED pushed to main — which pane a dictation lands in
 * when the user has named none (click-to-talk names its own).
 *
 * ⚠ THREE LAYERS, IN ORDER, AND THE FIRST IS THE ATTENTION WALK ABOVE:
 *
 *  1. The terminal that HOLDS DOM focus, when one does. The user typed here last.
 *  2. Otherwise the last terminal that held focus THIS RUN, if it is still in the
 *     active layout. This is what keeps the seed when focus moves to a header
 *     button, a rail card, the palette, or the dictation notice's own Dismiss.
 *  3. Otherwise `effectiveFocused` — the layout's focused leaf, which in filmstrip
 *     mode IS the pane drawn full-size: the one pane the user can be looking at.
 *
 * ⚠ WHY NOT JUST LAYER 1 (the pre-0.7.1 rule): the attention walk answers null
 * whenever nothing focusable is focused, and that is the NORMAL state of a
 * window the user has merely clicked around in — launch a session, dismiss a
 * notice, click a project. With a null seed main holds every dictation for
 * recovery, and F87 records the result: words spoken at a plainly visible pane,
 * held and never written. The attention tracker keeps its strict reading (a
 * header click IS overhead); dictation needs a target, and it is told before it
 * speaks — the ring is on the pane and the overlay names it.
 *
 * ⚠ WHY LAYERS 2–3 ARE SAFE against the three reasons at
 * `attention/reporter.ts:11-22`: (a) surviving blur is what dictation WANTS —
 * the user dictates from another application; (b) grid mode never updates
 * `viewStore.focusedSessionId`, which is what layer 2 is for, and layer 1 still
 * wins whenever a grid pane is focused; (c) both are re-resolved against the
 * live layout tree, and main validates the id AGAIN at write time and holds the
 * transcript if the pane is gone — a stale id can never write to a live pane
 * that inherited focus.
 *
 * ⚠ THIS IS ONLY A SEED. Main snapshots it at capture start and owns the target
 * from then on, so a focus change mid-dictation cannot move where the words go.
 * Sending a primitive id and nothing else also keeps D14 trivially satisfied.
 */
const dictationSeed = computed<string | null>(() => {
  if (attentionSessionId.value !== null) return attentionSessionId.value
  const sticky = lastFocusedTerminal.value
  if (sticky !== null && layout.tree && collectSessionIds(layout.tree.root).includes(sticky)) return sticky
  return effectiveFocused.value
})
watch(
  () => dictationSeed.value,
  (id) => void window.chorus.setVoiceTarget(id, null),
  { immediate: true }
)

onMounted(() => {
  window.addEventListener('focusin', onFocusIn)
  // A fresh renderer clears main's reportStale immediately, so the row-11
  // overhead window is one tick at most.
  sendAttentionReport()
})
onUnmounted(() => window.removeEventListener('focusin', onFocusIn))

/**
 * Task 5-4 follow-up: a DISMISS-ONLY notice for a dictation that did not go
 * the way the user meant.
 *
 * ⚠ THE OVERLAY IS NOT ENOUGH ON ITS OWN. It lingers 4 s and it lives on the
 * primary display; a person who dictated from another app and glanced back a
 * moment later has nothing to read. OS toasts are dead on this machine
 * (ToastEnabled=0). So main's fixed sentence — never the transcript, never a
 * provider message — is held here until clicked away. It fires on `failed`
 * (nothing was inserted), on a held transcript (`ready-for-review`: the
 * target went away), and on an `inserted` whose refinement FELL BACK to the
 * original — the case the user most needs to know about, because they have
 * stopped proof-reading. Verbatim and a clean refinement say nothing.
 *
 * Edge-triggered on the (state, message) pair so main's level pushes and
 * re-emits cannot re-raise a notice the user already dismissed.
 */
const voiceNotice = ref<string | null>(null)
let lastVoiceKey = ''
const offVoiceNotice = window.chorus.onVoiceState((e) => {
  const key = `${e.state}|${e.message ?? ''}|${e.refinement?.outcome ?? ''}`
  if (key === lastVoiceKey) return
  lastVoiceKey = key
  if (e.state === 'failed') {
    voiceNotice.value = `Dictation failed — ${e.message ?? 'transcription did not complete'}.`
  } else if (e.state === 'ready-for-review') {
    voiceNotice.value = `Dictation held — ${e.message ?? 'the pane it was aimed at is gone'}. Your words were kept, not written.`
  } else if (e.state === 'inserted' && e.refinement?.outcome === 'fallback' && e.message) {
    voiceNotice.value = `Dictation inserted as spoken — ${e.message}.`
  }
})
onUnmounted(() => offVoiceNotice())

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
    // The palette's restart is the third path that brings a session back to
    // life, and it bypasses TerminalPane entirely — so it patches the row
    // itself rather than leaning on the window event the pane dispatches.
    patchSessionRow(id, { status: res.status, exitCode: res.exitCode })
  } finally {
    sessionStore.setBusy(id, false)
  }
}

/** The registry, rebuilt on any store change (computed — never cache the
 *  array: the toggle label reads the CURRENT mode, focus/switch entries
 *  track the current leaves/projects). */
const paletteCommands = computed<PaletteCommand[]>(() =>
  buildCommands({
    openLaunchDialog: () => openLaunchDialog(),
    projects: projectStore.projects,
    openProjectSwitcher: () => (switcherOpen.value = true),
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
    // D153: sweeps every project, so it needs no active one.
    openDaySummary: () => (activeView.value = 'day-summary'),
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
      // v16: from the snapshot for the same reason as everything above it —
      // and it is genuinely `false` for a brand-new session rather than merely
      // defaulted, since nothing in the launch path can lock one. Reading it
      // off the response keeps main the authority even for the trivial case.
      locked: snapshot.locked,
      // Approximation until the next layout:get refresh — main stamped the
      // real created_at moments ago; card elapsed reads "just now" either way.
      createdAt: new Date().toISOString()
    }
  ]
  // D174: the leaf goes at the END of the flow, and there is no anchor to pick
  // — which is what retired F23's stale-target fallback. Every launch path now
  // reaches the same line, so the palette, the empty state and a pane's button
  // can no longer disagree about where a session lands.
  layout.appendLaunchedLeaf(snapshot.sessionId)
  // The new session becomes the focused one: in the grid its pane takes the
  // keyboard, and in the filmstrip it comes forward as the full-size pane — in
  // both views, the agent you just launched is the one you can type at.
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
        <DayReportView
          v-else-if="activeView === 'day-summary'"
          :overlay-open="anyOverlayOpen"
          @close="activeView = 'workspace'"
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
              @new-agent="openLaunchDialog"
              @maximize="toggleMaximize"
            />
            <GridRenderer
              v-else
              :tree="layout.tree"
              :agent-for="agentFor"
              :focused-session-id="effectiveFocused"
              @new-agent="openLaunchDialog"
              @maximize="toggleMaximize"
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
    <!-- ⚠ IT IS HANDED THE PROJECTS AND REPORTS A CHOICE; it does not reach for
         the store and it does not call project:select. Same division as the
         rail: the overlay renders and reports, App performs. -->
    <ProjectSwitcher
      v-if="switcherOpen"
      :projects="projectStore.projects"
      :active-id="projectStore.activeId"
      @close="switcherOpen = false"
      @select="(id) => projectStore.select(id)"
    />
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
      <!-- Task 5-4 follow-up: dismiss-only. The one box in this stack that
           takes clicks, because it stays until it is clicked away. -->
      <div v-if="voiceNotice" class="voice-notice" role="alert" data-voice-notice>
        <span class="voice-notice-text">{{ voiceNotice }}</span>
        <button type="button" class="voice-notice-dismiss" data-voice-notice-dismiss @click="voiceNotice = null">
          Dismiss
        </button>
      </div>
    </div>
    <!-- The save confirmation, on the same self-timing contract as the splash
         below it and one layer lower (90 vs 100).
         ⚠ `:key` IS THE FEATURE, NOT A LINT FIX: a second save while the first
         is still fading must RESTART the animation, and a CSS animation only
         restarts on a fresh element. The token counts up, so every save is a
         new key. -->
    <SavedFlash
      v-if="savedFlashShowing"
      :key="savedFlashToken"
      @done="dismissSavedFlash"
    />
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

/* Task 5-4 follow-up: the dismissable dictation notice. Amber, not red — a
   fallback inserted the user's own words; nothing broke. It re-enables
   pointer events for itself only, so the rest of the stack stays click-through. */
.voice-notice {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: 460px;
  border: 1px solid color-mix(in srgb, var(--color-state-attention) 40%, transparent);
  border-radius: var(--radius-icon);
  background: var(--color-surface-overlay);
  padding: 8px 12px;
  font-size: 13px;
  color: var(--color-state-attention-text);
  box-shadow: 0 12px 30px rgb(0 0 0 / 0.5);
}

.voice-notice-text {
  flex: 1;
}

.voice-notice-dismiss {
  flex: none;
  border: 1px solid var(--color-border-badge);
  border-radius: var(--radius-chip);
  background: transparent;
  color: var(--color-text-muted);
  font-size: 11px;
  padding: 2px 8px;
  cursor: pointer;
}

.voice-notice-dismiss:hover {
  color: var(--color-text);
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
