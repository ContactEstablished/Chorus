<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { AgentKind, WorktreeDiffSummary } from '../../../shared/ipc'
import StateMarker from './StateMarker.vue'
import ChorusMark from './ChorusMark.vue'
import { useSessionStore, type PaneSessionState } from '../stores/session'
import { useLayoutStore, type SplitTarget } from '../stores/layout'
import { clipboardIntent } from '../terminal/clipboardKeys'
import { trimSelectionForClipboard } from '../terminal/selectionText'

const props = defineProps<{ sessionId: string; agent: AgentKind }>()

/** Ask App to open the launch dialog splitting THIS pane ('row' = side by
 *  side, 'column' = stacked — the axes splitPane() knows). `focus` fires when
 *  the terminal's input gains focus (1b-2), so the view store tracks the pane
 *  the user is actually typing in. */
const emit = defineEmits<{ split: [target: SplitTarget]; focus: [sessionId: string] }>()

const labels: Record<AgentKind, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  kimi: 'Kimi Code', // D86
  opencode: 'opencode' // D90
}

/** The design's two-letter agent tile, same codes the filmstrip card uses. */
const codes: Record<AgentKind, string> = {
  claude: 'cc',
  codex: 'cx',
  kimi: 'km', // D86
  opencode: 'oc' // D90
}

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

/**
 * The session's authored name and note, seeded from the attach response with
 * the same seed-once discipline as `branch` below.
 *
 * ⚠ STATIC, UNLIKE `title` ABOVE. Nothing streams these: they were typed once
 * in the launch dialog and no OSC sequence, first-line fallback or debounce
 * touches them. That is exactly why the footer can show the name beside the
 * agent label without it flickering to whatever the TUI last printed.
 */
const sessionName = ref<string | null>(null)
const sessionNote = ref<string | null>(null)

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
 * ⚠ `background` IS FULLY TRANSPARENT, AND IT IS NOT A MISSING VALUE. It used
 * to be `--color-surface-rail`. The pane's tone is now painted by CSS on
 * `.pane-terminal-region` instead, one layer down, so that the watermark can
 * sit BETWEEN the tone and the text (Matthew, 2026-07-27). The rendered colour
 * behind a cell is unchanged — the same token, drawn by a different element.
 *
 * ⚠ IT ONLY WORKS PAIRED WITH `allowTransparency: true` at construction. Left
 * off, xterm composites every cell against opaque black and the terminal turns
 * into a black rectangle — a dramatic failure, but one that looks like a theme
 * bug rather than a missing constructor flag. The two belong together.
 *
 * ⚠ AND THE VALUE MUST BE 8-DIGIT HEX, NOT A CSS `rgb(… / 0)`. Measured against
 * xterm 6.0.0 on 2026-07-27: `'rgb(0 0 0 / 0)'` came back out of its colour
 * parser as OPAQUE BLACK and was written onto `.xterm-scrollable-element`,
 * blacking out the pane. `#RRGGBBAA` is the form its parser round-trips with
 * the alpha intact. There is no warning and no type error — the only signal is
 * the rendered colour, which is why the measurement is recorded here.
 *
 * Cells the AGENT colours (an ANSI background) still paint over this, which is
 * correct: the watermark is behind Chorus's own surface, not behind the agent's
 * output.
 */
function paneTheme(): { background: string; foreground: string; cursor: string; selectionBackground: string } {
  const jade = token('--color-accent-jade')
  return {
    background: '#00000000',
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
  // The authored identity, seeded the same way. Unlike the title above there is
  // no live source to lose a race with — the guard is here for consistency, not
  // because a second writer exists.
  if (sessionName.value === null && attach.name !== null) sessionName.value = attach.name
  if (sessionNote.value === null && attach.description !== null) {
    sessionNote.value = attach.description
  }
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

/**
 * Tell App this session is LIVE AGAIN, so it can patch its persisted row.
 *
 * ⚠ NEEDED BECAUSE `session:restart` EMITS NO EVENT. `session:restored` is the
 * restore ENGINE's alone (the F10 badge rides it), so a user-driven restart or
 * relaunch is invisible to everything outside this component — App's rows would
 * still say `exited`, and the moment this pane loses focus its card would show
 * a grey "done" square for a session that is running right now.
 *
 * Same window-CustomEvent route as `chorus:session-closed` above, and for the
 * same stated reason: this component cannot emit up to App without widening
 * both LayoutRenderer and FilmstripRenderer to relay it.
 */
function announceRelaunched(): void {
  window.dispatchEvent(
    new CustomEvent('chorus:session-relaunched', { detail: { sessionId: props.sessionId } })
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
    announceRelaunched()
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
    announceRelaunched()
    if (res.buffer.length > 0) {
      terminal?.write(res.buffer)
    }
    showBadge()
  } finally {
    store.setBusy(props.sessionId, false)
  }
}

/* ------------------------------------------------------------------ */
/* Clipboard                                                           */
/* ------------------------------------------------------------------ */

/**
 * ⚠ WITHOUT THIS HANDLER, CTRL+V DOES NOT PASTE — IT SENDS ^V TO THE AGENT.
 * That is not a Chorus bug so much as xterm.js's default keymap doing exactly
 * what a terminal is supposed to do, and it made the app unusable for anything
 * that has to be pasted in (an API key, a prompt, a stack trace).
 *
 * The mechanism, because it is not guessable from the symptom. xterm's
 * `_keyDown` maps every ctrl+letter to its control character — Ctrl+V is
 * keyCode 86, so `String.fromCharCode(86 - 64)` = 0x16 — writes it to the PTY,
 * and then calls its own `cancel(event, true)`, which is `preventDefault()` +
 * `stopPropagation()`. That preventDefault is what actually breaks paste:
 * Chromium's native paste is a DEFAULT ACTION of the keydown, so cancelling the
 * keydown means no `paste` event is ever dispatched.
 *
 * ⚠ AND THE FIX IS TO GET OUT OF THE WAY, NOT TO READ THE CLIPBOARD OURSELVES.
 * xterm ALREADY listens for `paste` on both its textarea and its element, and
 * its handler is the one worth having: it normalises newlines to CR and wraps
 * the text in ESC[200~ / ESC[201~ when the app has bracketed-paste mode on —
 * which every agent TUI here does, and which is what lets them treat a pasted
 * block as one edit instead of a burst of keystrokes. Reading the clipboard and
 * writing it to the PTY by hand would bypass all of that to reimplement it
 * worse. So this returns `false` (xterm: "do not process") and deliberately
 * does NOT preventDefault, leaving Chromium's own paste to run and xterm's own
 * handler to receive it.
 *
 * Returning false is checked at the TOP of `_keyDown`, before the keymap and
 * before `cancel` — so nothing reaches the PTY either.
 *
 * ⚠ CTRL+C IS DELIBERATELY UNTOUCHED and still sends SIGINT. It is the only way
 * to interrupt a running agent, and this is an app whose whole purpose is
 * running agents — trading that for a copy shortcut would break the more
 * important of the two. Copy is Ctrl+Shift+C, which is the convention in every
 * terminal emulator and already what `App.vue` assumes when it refuses to bind
 * that chord globally.
 */
function onTerminalKey(e: KeyboardEvent): boolean {
  // Which chord this is lives in clipboardKeys.ts, tested without a DOM; what
  // to DO about it lives here, where the terminal and the clipboard are.
  const intent = clipboardIntent(e)
  if (intent === null) return true

  // ⚠ PASTE RETURNS WITHOUT preventDefault, ON PURPOSE. Returning false is
  // enough to keep xterm from sending ^V; leaving the default action intact is
  // what lets Chromium paste and xterm's own `paste` listener receive it.
  if (intent === 'paste') return false

  // ⚠ TRIMMED, because a terminal selection is a RECTANGLE: every row arrives
  // padded to the full column width, so an untrimmed copy carries a tail of
  // spaces into whatever it is pasted into. The emptiness test runs on the
  // TRIMMED text — a selection of nothing but padding is a selection of
  // nothing, and should no-op rather than put blanks on the clipboard.
  const selection = trimSelectionForClipboard(terminal?.getSelection() ?? '')
  e.preventDefault()
  if (selection.length > 0) void copySelection(selection)
  return false
}

/** ⚠ NEVER LOG THE TEXT. A terminal selection routinely contains an API key —
 *  the same reason the scrubber exists — so the failure path reports the ERROR
 *  and says nothing about what was being copied. */
async function copySelection(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch (err) {
    // Covers a missing `navigator.clipboard` (TypeError) and a denied write
    // alike. Silent-but-visible: the user sees no toast, a developer sees this.
    console.error('[pane] copy failed:', err)
  }
}

/*
 * ⚠ THERE IS DELIBERATELY NO `contextmenu` HANDLER HERE, AND IT IS NOT AN
 * OVERSIGHT — one was written, shipped into a test build, and removed after it
 * was measured.
 *
 * Right-click ALREADY pastes in this window without any code of ours: Chromium
 * performs it, and it did so before the clipboard work started. Adding a
 * handler that read the clipboard and called `terminal.paste()` therefore made
 * a single right-click paste TWICE — verified two ways on a cleared prompt, and
 * isolated by neutering our own read (the text still landed once, from
 * Chromium, with our handler doing nothing).
 *
 * So the fix for right-click was to delete the handler, not to add one. If a
 * future change makes right-click stop pasting, the thing to re-add is a
 * handler that ONLY runs when the browser did not — not this one.
 */

onMounted(async () => {
  terminal = new Terminal({
    cursorBlink: true,
    // 5000 caps scrollback-reflow cost on column change (50-200 ms at 10k+).
    scrollback: 5_000,
    fontSize: 14,
    fontFamily: '"Cascadia Mono", Consolas, "Courier New", monospace',
    // The other half of the transparent theme background above — see the
    // warning on paneTheme(). This app uses xterm's DOM renderer (no
    // addon-webgl / addon-canvas is loaded anywhere), which is where the
    // upstream "may impact performance" caveat for this flag bites least: the
    // DOM renderer already emits per-cell elements, so a transparent default
    // background removes paint work rather than adding it.
    allowTransparency: true,
    theme: paneTheme()
  })
  fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  // Before open(), so no keystroke can reach the default keymap first.
  terminal.attachCustomKeyEventHandler(onTerminalKey)
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
  <!-- `pane-shell` exists for ONE reason: the focus ring below. It carries no
       layout — the Tailwind utilities still do all of that — so removing the
       ring removes the class with nothing else attached to it. -->
  <div class="pane-shell flex h-full flex-col">
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
        <!-- `Claude Code - Bob`, matching the filmstrip card's identity line so
             the focused pane and the card that opened it agree on who this is.
             The note follows as its own segment, omitted when unset. -->
        <span class="pane-agent">
          {{ sessionName ? `${labels[props.agent]} - ${sessionName}` : labels[props.agent] }}
        </span>
        <template v-if="sessionNote">
          <span class="pane-rule-sm" />
          <span class="pane-note" :title="sessionNote">{{ sessionNote }}</span>
        </template>
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
    <div class="pane-terminal-region relative min-h-0 flex-1">
      <!-- The watermark. FIRST in the region and therefore under everything
           that follows it — the terminal, the pane overlay, the close offer.
           It is inert decoration: no state, no props, no listeners. -->
      <div class="pane-watermark" aria-hidden="true">
        <ChorusMark :height="76" />
      </div>
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
        class="pane-offer absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 px-3 py-2 text-xs"
      >
        <span class="pane-offer-text min-w-0 truncate">
          Worktree
          <span v-if="branch" class="pane-offer-branch">{{ branch }}</span>
          is clean — nothing uncommitted. Remove it?
        </span>
        <span class="flex shrink-0 gap-2">
          <button
            class="pane-offer-danger px-2 py-0.5"
            title="Remove the worktree directory and its record (the branch is kept)"
            @click="resolveCloseOffer(true)"
          >
            Remove worktree
          </button>
          <button
            class="pane-offer-ghost px-2 py-0.5"
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
/* ── The active pane: a tinted TITLE BAR, not a border ───────────────────
 *
 * "Where is my cursor?" — with several panes on screen, the answer was nowhere
 * on the screen.
 *
 * ⚠ THIS REPLACED A 1px FOCUS RING, AND THE REASON IS WORTH KEEPING: the ring
 * COMPETED WITH THE BORDERS ALREADY THERE. A pane sits inside splitpanes
 * gutters and carries its own `--color-border-panel` header rule, so a third
 * line an alpha away from the other two read as a rendering artefact rather
 * than as state. A FILLED REGION does not compete with a line — it is a
 * different visual channel, so it reads at a glance without adding a fourth
 * edge to a screen already full of them.
 *
 * ⚠ `:focus-within`, NOT A `focused` PROP, AND THAT PART SURVIVED THE REDESIGN.
 * The app has a `viewStore.focusedSessionId` and it would have been the obvious
 * thing to bind — but it is WRONG here: `LayoutRenderer` binds no `@focus`
 * (App.vue says so in as many words), so in split mode — the only mode where
 * this question can even be asked — that value never updates, and two panes
 * would share one stale highlight. `:focus-within` reads the live DOM, is true
 * in both view modes, needs no store, prop, event or parent wiring, and cannot
 * drift because there is nothing to keep in sync. Same reasoning as App's own
 * `onFocusIn` walk.
 *
 * ⚠ A BACKGROUND FILL MOVES NOTHING. Like the inset shadow it replaced, and
 * unlike a border, it occupies no box — so focus cannot shift the terminal by a
 * pixel and re-fire the ResizeObserver that the rule below exists to keep quiet.
 *
 * ⚠ THE COLOUR IS MIXED FROM `--color-accent-jade`, NOT COPIED FROM THE
 * WATERMARK'S TOKEN, AND THAT IS DELIBERATE. The brief was "the same faded-out
 * green as the watermark logo", and the watermark is `ChorusMark` at
 * `--opacity-terminal-watermark: 0.04`. Referencing that token would couple this
 * rule to it; mixing from the jade token both files already share gets the same
 * family with no dependency. The ALPHA is deliberately NOT 4%: the watermark is
 * a large shape where 4% reads, while this is a ~60px strip where it would not.
 * The value below was chosen by looking at it, not by arithmetic. */
.pane-shell .pane-header {
  transition: background-color 120ms ease;
}

.pane-shell:focus-within .pane-header {
  background-color: color-mix(in srgb, var(--color-accent-jade) 10%, transparent);
}

/* The fade is decoration; the tint itself is information, so reduced motion
   drops the transition and KEEPS the tint (3c-1's standing rule). */
@media (prefers-reduced-motion: reduce) {
  .pane-shell .pane-header {
    transition: none;
  }
}

/* Hide xterm's viewport scrollbar: its appearing/disappearing on fit() would
   resize the container and re-fire the ResizeObserver in a loop (CR-1.2). */
.terminal-container :deep(.xterm-viewport) {
  overflow: hidden !important;

  /* ⚠ AND UNPAINT IT, WHICH IS NOT THE SAME AS THE THEME BEING TRANSPARENT.
     `@xterm/xterm/css/xterm.css` hard-codes `.xterm .xterm-viewport {
     background-color: #000 }` — a STATIC RULE, commented there as a macOS
     scrollbar-opacity workaround, that no theme value can reach. Verified
     against xterm 6.0.0 at runtime (2026-07-27): with the theme already
     transparent this element still computed to `rgb(0, 0, 0)` and turned the
     whole terminal black. The scrollbar it protects is hidden one line above,
     and Chorus is Windows-only in v1, so there is nothing here to preserve.

     Without this the watermark is invisible AND the pane's tone is wrong —
     and it reads as a theme bug, because the theme is the only place anyone
     looks. */
  background-color: transparent !important;
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
  white-space: nowrap;
  color: var(--color-text-body);
}

/* The note is the one thing on this bar that can be long, so it is the one
   thing allowed to shrink and ellipsize — everything else stays `flex: none`. */
.pane-note {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--color-text-quiet);
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

/* ── The clean-worktree removal offer ───────────────────────────────────────
   ⚠ UNMOCKED SURFACE — TOKEN CONFORMANCE ONLY. No mock draws this strip (D26
   clause 5 invented it), so nothing here is read from one literally; each
   value is the 3c-1 token whose documented ROLE this element plays. Phase 3c
   left five stock palette utilities here because the strip is 3c-3's
   territory and 3c-5 declined to widen its diff silently; this is that debt.

   The strip is an ELEVATED PANEL over the terminal, not part of the terminal:
   `--color-surface-overlay` is the token for that (command palette, launch
   dialog, mission popover). The 95% is the one thing carried over verbatim
   from the utility it replaced — a colour swap, not an opacity retune. The
   rule matches the pane's own header rule rather than the Launch Dialog
   footer's `--color-border-segment`, so this card draws ONE rule colour. */
.pane-offer {
  border-top: 1px solid var(--color-border-panel);
  background: color-mix(in srgb, var(--color-surface-overlay) 95%, transparent);
}

.pane-offer-text {
  color: var(--color-text-body);
}

/* Jade, matching `WorktreePanel.vue`'s `.wt-branch` and the Launch Dialog
   mock's worktree path (`#3BCFAE`). Deliberately colour-only: the mock also
   sets that identifier in mono, and changing the face here would be a
   restyle rather than the token swap this change is. */
.pane-offer-branch {
  color: var(--color-accent-jade);
}

/* ⚠ THIS WAS A SOLID RED FILL, AND NO TOKEN SUPPORTS ONE. The mocks draw
   exactly two destructive treatments: the titlebar close hover (whose token
   says "titlebar close only") and the kill button's tint. The tinted confirm
   below is what `.overlay-btn-danger` already gives THE SAME ACTION — the
   worktree panel's "Remove worktree" — so this strip now agrees with the
   other place the app offers it, and no new token was invented. */
.pane-offer-danger {
  border: 1px solid color-mix(in srgb, var(--color-state-error) 45%, transparent);
  border-radius: var(--radius-icon);
  background: color-mix(in srgb, var(--color-state-error) 14%, transparent);
  color: var(--color-state-error-text);
  cursor: default;
}

.pane-offer-danger:hover {
  background: color-mix(in srgb, var(--color-state-error) 22%, transparent);
  color: var(--color-state-error-hover);
}

/* The declining action, in the pane's own ghost-control idiom (`.pane-btn`). */
.pane-offer-ghost {
  border: 0;
  border-radius: var(--radius-icon);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: default;
}

.pane-offer-ghost:hover {
  background: var(--color-surface-icon-hover);
  color: var(--color-text-body);
}

/* ⚠ THE BACKGROUND MOVED UP ONE LEVEL, AND THAT IS WHAT MAKES THE WATERMARK
   POSSIBLE. It used to live here, on the terminal host. It now lives on
   `.pane-terminal-region` below, with this element and the xterm theme both
   fully transparent — so the paint order is: region tone, then watermark, then
   the terminal's glyphs. Put a background back on this element and the
   watermark vanishes behind it with no other symptom. */
.terminal-container {
  background: transparent;
}

/* The terminal region: the tone the xterm theme used to paint itself, now
   painted once behind everything in the region. */
.pane-terminal-region {
  background: var(--color-surface-rail);
}

/* ── The watermark (Matthew, 2026-07-27) ────────────────────────────────────
   The official mark, ghosted behind each session's output. THE BRIEF WAS
   "very, very subtle … just barely visible so as to not interfere with text",
   and every value here serves that:

   - `--opacity-terminal-watermark` (main.css) is the one dial. It is a token so
     it can be tuned in one place against a real screenshot rather than guessed
     at per pane.
   - `pointer-events: none` — it must never eat a click meant for the terminal,
     which sits above it and owns every interaction in this region.
   - It scales with the pane (`width: 34%`) instead of holding a fixed size, so
     a narrow split gets a proportionally smaller mark rather than a cropped
     one. The clamp keeps it from becoming either a speck or a billboard.
   - `aria-hidden` on the element: it is decoration, and a screen reader
     announcing the logo once per pane would be noise. */
.pane-watermark {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  opacity: var(--opacity-terminal-watermark);
}

.pane-watermark :deep(svg) {
  width: clamp(72px, 34%, 300px);
  height: auto;
}
</style>
