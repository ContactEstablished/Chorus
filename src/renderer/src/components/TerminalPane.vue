<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { AgentKind, WorktreeDiffSummary } from '../../../shared/ipc'
import StateMarker from './StateMarker.vue'
import { useSessionStore, type PaneSessionState } from '../stores/session'
import { useLayoutStore, type SplitTarget } from '../stores/layout'

const props = defineProps<{ sessionId: string; agent: AgentKind }>()

/** Ask App to open the launch dialog splitting THIS pane ('row' = side by
 *  side, 'column' = stacked — the axes splitPane() knows). `focus` fires when
 *  the terminal's input gains focus (1b-2), so the view store tracks the pane
 *  the user is actually typing in. */
const emit = defineEmits<{ split: [target: SplitTarget]; focus: [sessionId: string] }>()

const labels: Record<AgentKind, string> = { claude: 'Claude Code', codex: 'Codex' }

/** The design's two-letter agent tile, same codes the filmstrip card uses. */
const codes: Record<AgentKind, string> = { claude: 'cc', codex: 'cx' }

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

/**
 * The header's state marker (3c-1's shared primitive, 3c-3 its first caller).
 * `dotStatus`'s four values collapse onto the THREE states the app can derive
 * (D78 — `needs-you` has no source and renders nowhere in this phase);
 * `detached` is the brief window before the first attach lands and shows no
 * marker at all, rather than claiming a shape the pane cannot stand behind.
 *
 * ⚠ SHAPE IS THE ENCODING, colour only reinforces it. A header that told these
 * states apart by colour alone would break the property StateMarker exists for.
 */
const markerState = computed<'running' | 'error' | 'done' | null>(() => {
  switch (dotStatus.value) {
    case 'running':
      return 'running'
    case 'exited-error':
      return 'error'
    case 'exited-ok':
      return 'done'
    default:
      return null
  }
})

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

/** 2-4 diff summary (F12 cadence discipline): one interval ≥15 s per MOUNTED
 *  worktree pane, plus an on-focus refresh, cleared on unmount. A non-worktree
 *  pane (branch null) never creates the interval and never fetches. Filmstrip
 *  cards are not TerminalPanes, so they never poll. */
const diff = ref<WorktreeDiffSummary | null>(null)
let diffTimer: ReturnType<typeof setInterval> | undefined
const DIFF_POLL_MS = 15_000

/** True when any count is non-zero — the header stays clean on a pristine
 *  worktree instead of shouting 0f +0 −0. */
const diffHasChanges = computed(
  () =>
    diff.value !== null &&
    (diff.value.filesChanged > 0 ||
      diff.value.insertions > 0 ||
      diff.value.deletions > 0 ||
      diff.value.untracked > 0)
)

async function refreshDiff(): Promise<void> {
  if (!branch.value) return // non-worktree session — never polls
  try {
    diff.value = await window.chorus.getWorktreeDiffSummary(props.sessionId)
  } catch (err) {
    // A transient git/read failure must not break the header — keep the last
    // good counts (or none) and let the next tick retry.
    console.warn('[pane] diff summary refresh failed:', err)
  }
}

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

/* ------------------------------------------------------------------ */
/* The xterm theme — the one surface in 3c-3 that is not CSS (spec §6)  */
/* ------------------------------------------------------------------ */

/** Read a 3c-1 token's value at runtime, so the theme object has no second
 *  home for any colour. `@theme static` guarantees every token is emitted as a
 *  :root custom property whether or not a utility references it. */
function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/** `#RRGGBB` -> `rgb(r g b / a)`. xterm takes colour STRINGS, so a translucent
 *  selection cannot be a CSS `color-mix()`; this derives it from the jade token
 *  rather than restating the literal the mock's `::selection` rule uses. */
function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return hex
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16))
  return `rgb(${r} ${g} ${b} / ${alpha})`
}

/**
 * ⚠ FOUR KEYS, AND DELIBERATELY NO ANSI PALETTE. The 16 ANSI colours are the
 * AGENT'S output colours: overriding them changes what `claude` and `codex`
 * look like when they emit colour, which is a behavioural change wearing a
 * styling costume, and no mock specifies one. If they read wrong against the
 * new background that is a design question for Matthew, not an implementer's
 * call (spec §6 — escalate rather than decide).
 *
 * `background` matches the terminal region of the mock's pane so the terminal
 * does not sit in a differently-dark rectangle inside its own frame.
 */
function paneTheme(): { background: string; foreground: string; cursor: string; selectionBackground: string } {
  const jade = token('--color-accent-jade')
  return {
    background: token('--color-surface-rail'),
    foreground: token('--color-text-body'),
    cursor: jade,
    selectionBackground: withAlpha(jade, 0.25)
  }
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
  // 3c-3: the two surfaces that COUNT sessions — the rail's per-project count
  // and the status bar's tally — have no other way to learn a close happened.
  // Same window-CustomEvent route the worktree notice above takes, and for the
  // same reason: this component cannot emit up to App without widening
  // LayoutRenderer and FilmstripRenderer, and it is unmounting anyway.
  //
  // ⚠ FIRED EVEN IF session:delete THREW. App answers this by RE-READING main,
  // never by decrementing a local number, so a row that survived a failed
  // delete is still counted — which is the truth, and is what the next boot's
  // reconcile pass will act on.
  window.dispatchEvent(
    new CustomEvent('chorus:session-closed', { detail: { sessionId: props.sessionId } })
  )
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

/**
 * Task 3a-5 / D53: relaunch a session that was healed to `exited` because it
 * held a credential.
 *
 * ⚠ THIS CLICK IS THE WHOLE SECURITY ARGUMENT. Restore stays decision (b): the
 * boot path heals such a session and decrypts NOTHING. Main re-resolves the
 * credential here only because a human asked, at the keyboard, right now.
 *
 * Mirrors onRestart's shape but does NOT kill first — a relaunch target is
 * already exited by construction (the button only renders for a non-running
 * pane), and killing a dead session would be a no-op with a race attached.
 *
 * ⚠ BOTH BUTTONS STAY. Restart's refusal on a credentialed session is not a
 * wart to hide; it is what makes the two verbs legible — restart means "same
 * configuration, NO credential", relaunch means "same configuration, credential
 * re-resolved because you asked".
 */
async function onRelaunch(): Promise<void> {
  if (pane.value.status === 'running') return
  store.setBusy(props.sessionId, true)
  try {
    const res = await window.chorus.relaunchSession(props.sessionId)
    if ('ok' in res) {
      // Every refusal is authored in main and label-only: a legacy or
      // bare-credential session says "use the launch dialog", an unavailable
      // credential names itself, and neither leaks a URL or a key fragment.
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
    theme: paneTheme()
  })
  fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  terminal.open(container.value!)

  // 1b-2: xterm's input textarea exists once open() has run (D4-verified:
  // `readonly textarea: HTMLTextAreaElement | undefined` in @xterm/xterm 6).
  // 2-4: the same focus event also refreshes the diff summary (on-focus
  // refresh, F12 — the interval is the other half of the cadence).
  const onTextareaFocus = (): void => {
    emit('focus', props.sessionId)
    void refreshDiff()
  }
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

  // 2-4: start the diff poll only for a worktree pane (branch non-null after
  // attach). One interval ≥15 s + the on-focus refresh above; cleared in
  // onBeforeUnmount. A current-tree pane never reaches this branch.
  if (branch.value) {
    void refreshDiff()
    diffTimer = setInterval(() => void refreshDiff(), DIFF_POLL_MS)
  }

  fitAndSyncPty()
})

onBeforeUnmount(() => {
  clearTimeout(resizeTimer)
  clearTimeout(badgeTimer)
  clearTimeout(titleTimer)
  clearInterval(diffTimer)
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
    <!-- The pane header, to the design's anatomy (3c-3 / spec §5): a state row
         over a metadata row. Everything on it comes from data the pane ALREADY
         has — the mock's elapsed clock, `$0.84` cost, model name, effort meter
         and permission-mode chip are all facts Chorus does not carry, and D76
         omits them rather than inventing them. No data source was added here. -->
    <div class="pane-header">
      <div class="pane-header-row">
        <StateMarker v-if="markerState" :state="markerState" />
        <span class="pane-title" :title="title ?? labels[props.agent]">
          {{ title ?? labels[props.agent] }}
        </span>
        <span class="pane-rule" />
        <div class="pane-controls">
          <button
            type="button"
            class="pane-btn"
            title="Launch a session in a split beside this pane"
            @click="emit('split', { targetSessionId: props.sessionId, direction: 'row' })"
          >
            ⬌
          </button>
          <button
            type="button"
            class="pane-btn"
            title="Launch a session in a split below this pane"
            @click="emit('split', { targetSessionId: props.sessionId, direction: 'column' })"
          >
            ⬍
          </button>
          <!-- The restart glyph is the mock's own, verbatim. The other controls
               keep their labels: the design draws five icon buttons for five
               verbs Chorus does not have (pop out, duplicate, copy transcript),
               and an icon invented for Kill would sit beside Close's ✕ as a
               second X — losing a distinction the header has today. -->
          <button
            type="button"
            class="pane-btn pane-btn-icon"
            :disabled="pane.busy"
            title="Restart this session"
            @click="onRestart"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              stroke-width="1.2"
              aria-hidden="true"
            >
              <path d="M12 7a5 5 0 1 1-1.7-3.75" />
              <path d="M12 1.5v3h-3" fill="none" />
            </svg>
          </button>
          <!-- 3a-5 (D53): only on a non-running pane. Main authors every refusal
               (no profile, unavailable credential, cwd gone), so this button is
               never conditionally hidden on a guess the renderer made. -->
          <button
            v-if="pane.status !== 'running'"
            type="button"
            class="pane-btn pane-btn-accent"
            :disabled="pane.busy"
            title="Re-resolve this session's stored credential and start it again"
            data-relaunch
            @click="onRelaunch"
          >
            Relaunch
          </button>
          <button
            type="button"
            class="pane-btn pane-btn-danger"
            :disabled="pane.busy || pane.status !== 'running'"
            title="Kill this session, keeping the pane"
            @click="onKill"
          >
            Kill
          </button>
          <button
            type="button"
            class="pane-btn pane-btn-danger"
            :disabled="pane.busy"
            title="Kill session and close pane"
            @click="onClose"
          >
            ✕
          </button>
        </div>
      </div>

      <div class="pane-meta">
        <span class="pane-tile">{{ codes[props.agent] }}</span>
        <span class="pane-agent">{{ labels[props.agent] }}</span>
        <template v-if="branch">
          <span class="pane-rule-sm" />
          <span class="pane-branch" :title="branch">
            <!-- The mock's worktree glyph. -->
            <svg
              width="10"
              height="11"
              viewBox="0 0 10 11"
              fill="none"
              stroke="currentColor"
              stroke-width="1"
              aria-hidden="true"
            >
              <circle cx="2.5" cy="2.5" r="1.5" />
              <circle cx="2.5" cy="8.5" r="1.5" />
              <circle cx="7.5" cy="5.5" r="1.5" />
              <path d="M2.5 4v3M4 5.5h2" />
            </svg>
            <span class="pane-branch-name">{{ branch }}</span>
          </span>
        </template>
        <!-- 2-4: read-only diff summary vs HEAD in this worktree; hidden while
             pristine (all-zero) so a clean header stays quiet. -->
        <template v-if="diff && diffHasChanges">
          <span class="pane-rule-sm" />
          <span class="pane-diff" title="vs HEAD in this worktree">
            {{ diff.filesChanged }}f
            <span class="pane-diff-add">+{{ diff.insertions }}</span>
            <span class="pane-diff-del">−{{ diff.deletions }}</span>
            <span v-if="diff.untracked">· {{ diff.untracked }}?</span>
          </span>
        </template>
        <span v-if="badge" class="pane-chip">Session restarted — new conversation</span>
      </div>
    </div>
    <div class="relative min-h-0 flex-1">
      <!-- 3a-2: the attention attribute sits on the TERMINAL HOST, not the
           pane card. That placement IS the ruling: a click on this pane's
           header buttons, the splitter, or a filmstrip card resolves to null
           and lands in the per-project overhead bucket (table row 7), where
           §5.3 puts "reviewing the board, reading diffs". On the card, every
           header click would become task attention and the overhead bucket
           would be nearly empty — a bug that presents as "the numbers are
           suspiciously clean". -->
      <div
        ref="container"
        :data-attention-session="props.sessionId"
        class="terminal-container h-full p-1"
      ></div>
      <div v-if="paneMessage" class="pane-overlay">
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

/* ── The pane header (3c-3), read from the mock's `<!-- pane header -->` block.
      Every value is a 3c-1 token — no raw hex, no stock palette utility. ── */

.pane-header {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 10px 12px 9px;
  border-bottom: 1px solid var(--color-border-panel);
  user-select: none;
}

.pane-header-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.pane-title {
  flex: 1;
  min-width: 0;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pane-rule {
  flex: none;
  width: 1px;
  height: 14px;
  background: var(--color-border-divider);
}

.pane-rule-sm {
  flex: none;
  width: 1px;
  height: 12px;
  background: var(--color-border-divider);
}

.pane-controls {
  display: flex;
  gap: 2px;
}

.pane-btn {
  height: 24px;
  min-width: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 6px;
  border: 0;
  border-radius: var(--radius-icon);
  background: transparent;
  color: var(--color-text-tertiary);
  font-family: var(--font-sans);
  font-size: 11px;
  cursor: default;
}

.pane-btn-icon {
  padding: 0;
}

.pane-btn:hover:not(:disabled) {
  background: var(--color-surface-icon-hover);
  color: var(--color-text-body);
}

.pane-btn:disabled {
  opacity: 0.4;
}

/* Kill and close are DESTRUCTIVE, and the mock gives that class of control its
   own hover rather than the neutral one. */
.pane-btn-danger:hover:not(:disabled) {
  background: var(--color-surface-danger-hover);
  color: var(--color-state-error-hover);
}

.pane-btn-accent {
  color: var(--color-accent-jade);
}

.pane-btn-accent:hover:not(:disabled) {
  background: var(--color-surface-icon-hover);
  color: var(--color-accent-jade-hover);
}

.pane-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-text-muted);
}

.pane-tile {
  width: 16px;
  height: 16px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-chip);
  background: var(--color-surface-badge);
  border: 1px solid var(--color-border-badge);
  font-size: 8.5px;
  letter-spacing: 0.05em;
  color: var(--color-text-badge);
}

.pane-agent {
  flex: none;
  color: var(--color-text-body);
}

.pane-branch {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  color: var(--color-text-quiet);
}

.pane-branch-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pane-diff {
  flex: none;
  font-size: 10px;
  color: var(--color-text-quiet);
}

.pane-diff-add {
  color: var(--color-state-running-text);
}

.pane-diff-del {
  color: var(--color-state-error-text);
}

/* The transient fresh-conversation badge (D16), in the mock's chip idiom. */
.pane-chip {
  flex: none;
  border: 1px solid var(--color-border-badge);
  background: var(--color-surface-field);
  border-radius: var(--radius-chip);
  padding: 1px 6px;
  font-size: 10px;
  color: var(--color-text-secondary);
}

.pane-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--color-surface-rail) 90%, transparent);
  font-size: 13px;
  color: var(--color-text-secondary);
  user-select: none;
}

/* The terminal host itself, matching the xterm theme's background so the
   canvas never sits in a differently-dark rectangle. */
.terminal-container {
  background: var(--color-surface-rail);
}
</style>
