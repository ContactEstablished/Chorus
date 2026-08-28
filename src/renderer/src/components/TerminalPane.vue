<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { PIN_MAX_LENGTH, type AgentKind, type WorktreeDiffSummary } from '../../../shared/ipc'
import StateMarker from './StateMarker.vue'
import ChorusMark from './ChorusMark.vue'
import ContextRing from './ContextRing.vue'
import PaneIcon from './PaneIcon.vue'
import AgentMark from './AgentMark.vue'
import { useSessionStore, type PaneSessionState } from '../stores/session'
import { useDictationRing, toggleDictation } from '../voice/target'
import { useLayoutStore } from '../stores/layout'
import { useFleetStore } from '../stores/fleet'
import { clipboardIntent } from '../terminal/clipboardKeys'
import { trimSelectionForClipboard } from '../terminal/selectionText'

const props = defineProps<{
  sessionId: string
  agent: AgentKind
  /**
   * True when this pane is the one the workspace treats as focused: the
   * filmstrip's full-size pane, or the grid leaf `effectiveFocused` resolves
   * to. It is what tells the pane to TAKE the keyboard — see `focusTerminal`.
   */
  focused: boolean
  /**
   * True when this pane is the workspace's MAXIMIZED one — the filmstrip's
   * full-size pane. It is the toggle button's direction, and nothing else:
   * maximized draws `minimize` (go back to the grid), a grid cell draws
   * `maximize` (come forward).
   *
   * ⚠ IT IS A PROP, NOT A READ OF THE VIEW STORE, and that is deliberate.
   * The pane does not need to know the app's mode — only which of the two
   * roles IT is playing — and its parent already knows that for certain:
   * FilmstripRenderer passes true for the one pane it renders full-size,
   * GridRenderer passes false for every cell. Reading the store instead
   * would let a pane disagree with the component that mounted it.
   */
  maximized: boolean
}>()

/* Task 5-3: the dictation ring, and click-to-talk. Both read from MAIN's idea of
 * the target, never from this pane's own focus — see voice/target.ts. */
const { dictating } = useDictationRing(props.sessionId)

const fleetStore = useFleetStore()
/**
 * D182 / spec §6.1 — the address OTHER AGENTS must type to reach this pane.
 *
 * ⚠ IT IS READ LIVE FROM THE FLEET SNAPSHOT, NEVER FROM THE NAME CHORUS
 * ASKED FOR. Phase 0 threaded that requested name to `claude -n` and
 * deliberately rendered NOTHING, because a chip drawn from it is a cached
 * promise: the name can be taken by another session or replaced by an
 * AI-generated title at any moment (§4.7, §4.8). Rendering this from
 * `sessions.name` would silently undo the whole phase and would look like a
 * simplification.
 *
 * A non-claude pane is NOT ADDRESSABLE and says so. That is a fact about the
 * agent — codex, opencode, kimi and grok appear in no session registry and no
 * Chorus code can put them there — not a failure, and not something to hide.
 */
const addressChip = computed<{ kind: string; text: string; title: string } | null>(() => {
  if (props.agent !== 'claude') {
    return {
      kind: 'absent',
      text: 'Not addressable',
      title: 'Only Claude Code sessions join the cross-session fleet.'
    }
  }
  const state = fleetStore.addressFor(props.sessionId)
  if (state.kind === 'verified') {
    return { kind: 'verified', text: state.address, title: 'Other agents reach this pane by this name.' }
  }
  if (state.kind === 'changed') {
    return {
      kind: 'changed',
      text: state.current,
      title:
        'Requested ' + state.requested + ', now ' + state.current +
        (state.cause === 'collision' ? ' — another session took that name.' : '.')
    }
  }
  return { kind: 'unknown', text: 'Address unknown', title: state.reason }
})

function onToggleDictation(): void {
  void toggleDictation(props.sessionId)
}

/**
 * `newAgent` asks App to open the launch dialog. It carries NO PAYLOAD, and
 * the emptiness is the D174 change in one line: the pane it was clicked from
 * used to decide where the new session landed ('row' beside, 'column' below),
 * and now nothing does — every agent joins the end of the flow and the grid
 * wraps by window width. A button that cannot promise a position must not
 * pretend to send one.
 *
 * `maximize` asks App to make THIS session the full-size one (or, when it
 * already is, to go back to the grid). App owns that ruling because the
 * decision is about the WORKSPACE's mode, not this pane's state.
 *
 * `focus` fires when the terminal's input gains focus (1b-2), so the view
 * store tracks the pane the user is actually typing in.
 */
const emit = defineEmits<{
  newAgent: []
  maximize: [sessionId: string]
  focus: [sessionId: string]
}>()

const labels: Record<AgentKind, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  grok: 'Grok', // D165
  kimi: 'Kimi Code', // D86
  opencode: 'opencode', // D90
  shell: 'Terminal' // D185 — not an agent; the header still needs a name
}

/* ⚠ THE TWO-LETTER `codes` MAP LIVED HERE AND IS GONE (D184, Task 7a-1). The
 * glyph is now `AgentMark`, the same component the filmstrip card and the launch
 * picker use — so the three surfaces still cannot disagree about what an agent
 * looks like, which is the property the shared codes map used to provide. */

/**
 * The glyph an agent's TUI draws in COLUMN 1 of a row carrying the HUMAN's words.
 *
 * ⚠ EVERY ENTRY IS MEASURED FROM A REAL PTY CAPTURE, NEVER GUESSED — the same
 * discipline CLAUDE.md imposes on CLI flags, and for the same reason: these are
 * private rendering details of a fast-moving tool, and a plausible-looking wrong
 * glyph fails SILENTLY (nothing is tinted, and nothing says why).
 *
 * Claude Code v2.1.225, captured 2026-08-11 through node-pty under Chorus's own
 * pinned env (TERM=xterm-256color, COLORTERM=truecolor): the composer input row
 * and the submitted message in the transcript BOTH open with `❯` at column 1,
 * while the agent's own reply opens with `●`. One marker therefore covers both
 * halves of "things I write" — what is being typed, and what was sent.
 *
 * ⚠ RE-MEASURED AND STILL TRUE ON **v2.1.228, 2026-08-12** — the transcript row
 * addresses `ESC[7;1H` and writes `❯ ` there, so the glyph and the column both
 * hold. This is the one claim of the original pass that survived re-measurement;
 * see `paintUserRows` for the two that did not.
 *
 * ⚠ AN AGENT WITH NO ENTRY HERE RENDERS EXACTLY AS IT DOES TODAY. That is the
 * intended state for an unmeasured agent — `paintUserRows` returns immediately —
 * rather than a fallback that guesses a marker and mis-colours the agent's own
 * output. codex, kimi and opencode are unmeasured at the time of writing.
 */
const USER_ROW_MARKER: Partial<Record<AgentKind, string>> = {
  claude: '❯'
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

/** v16: this session's context reading, or undefined when it has no source.
 *  Straight off the store — main's in-memory fact, never a column, and the same
 *  map the filmstrip card reads (see the store's own note on why it is keyed by
 *  sessionId alone rather than hung off `PaneSessionState`). */
const contextUsage = computed(() => store.context[props.sessionId])

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

/* ------------------------------------------------------------------ */
/* v16: the agent lock                                                  */
/* ------------------------------------------------------------------ */

/**
 * Whether this agent is locked.
 *
 * ⚠ SEEDED FROM ATTACH AND THEN OWNED BY THIS COMPONENT'S OWN MUTATIONS, which
 * is the `name`/`branch` discipline rather than `title`'s. Nothing streams a
 * lock: it changes only when a human clicks the padlock, and the click's own
 * response carries the new value. So there is no live source to lose a race
 * with, and — unlike `title` — no need to guard the seed against one.
 *
 * ⚠ AND THE RENDERER'S COPY IS AFFORDANCE, NOT ENFORCEMENT. Main refuses a
 * locked kill/close whatever this ref says (`requireUnlockedSession`); this only
 * decides which buttons are offered. A stale `false` here costs a refusal
 * message, never a lost agent.
 */
const locked = ref(false)

/** The inline unlock prompt, parked on a promise exactly like `closeOffer`
 *  below — and for the same stated reason: never a window.confirm, which blocks
 *  the renderer thread. */
const unlockPrompt = ref(false)
/** True once main has said a PIN is configured. Drives the field vs the plain
 *  confirm — and is learned FROM MAIN'S REFUSAL rather than read up front, so
 *  the renderer never holds a stale idea of whether a PIN exists. */
const unlockNeedsPin = ref(false)
const unlockPin = ref('')
const unlockError = ref<string | null>(null)
const lockBusy = ref(false)

function closeUnlockPrompt(): void {
  unlockPrompt.value = false
  unlockNeedsPin.value = false
  unlockPin.value = ''
  unlockError.value = null
}

/**
 * Lock, or begin unlocking.
 *
 * ⚠ LOCKING IS ONE CALL AND UNLOCKING IS A CONVERSATION, which is the whole
 * shape of this feature. Adding protection is never gated; removing it always
 * costs at least one deliberate second act — the confirm — and a PIN on top
 * when one is configured.
 */
async function onToggleLock(): Promise<void> {
  if (lockBusy.value) return
  if (locked.value) {
    // Ask with no PIN first. Main answers `pinRequired` if and only if one is
    // set, so this same call covers both configurations and the renderer never
    // has to ask whether a PIN exists.
    unlockError.value = null
    unlockPin.value = ''
    unlockNeedsPin.value = false
    unlockPrompt.value = true
    return
  }
  lockBusy.value = true
  try {
    const res = await window.chorus.setSessionLocked({ sessionId: props.sessionId, locked: true })
    if (res.ok) {
      locked.value = res.locked
      announceLockChanged(res.locked)
    } else {
      paneMessage.value = res.reason
    }
  } finally {
    lockBusy.value = false
  }
}

/** Submit the unlock. Called by the confirm button and by Enter in the field. */
async function submitUnlock(): Promise<void> {
  if (lockBusy.value) return
  lockBusy.value = true
  unlockError.value = null
  try {
    const res = await window.chorus.setSessionLocked({
      sessionId: props.sessionId,
      locked: false,
      // ⚠ OMITTED, NOT SENT EMPTY, when there is nothing to send. An empty
      // string in a credential-shaped field is how "" ends up being accepted as
      // a PIN somewhere downstream; the schema marks it optional for this case.
      ...(unlockPin.value.length > 0 ? { pin: unlockPin.value } : {})
    })
    if (res.ok) {
      locked.value = res.locked
      announceLockChanged(res.locked)
      closeUnlockPrompt()
      return
    }
    // A refusal keeps the prompt OPEN — the user is mid-task and closing it
    // would make them start over to read why it failed.
    unlockError.value = res.reason
    if (res.pinRequired) unlockNeedsPin.value = true
  } finally {
    lockBusy.value = false
    // ⚠ CLEARED ON EVERY PATH, INCLUDING FAILURE. The value is plausibly reused
    // elsewhere (agentLockCore's header), so it must not sit in a reactive ref —
    // which is devtools-inspectable — for longer than the request it served.
    unlockPin.value = ''
  }
}

/**
 * Tell App the lock changed, so the filmstrip CARD's padlock follows.
 *
 * ⚠ NEEDED BECAUSE THE CARD READS `locked` OFF THE PERSISTED ROW, not off the
 * session store — and this component cannot emit up to App without widening
 * both GridRenderer and FilmstripRenderer. Same window-CustomEvent route, and
 * the same stated reason, as `chorus:session-closed` and
 * `chorus:session-relaunched` below.
 */
function announceLockChanged(next: boolean): void {
  window.dispatchEvent(
    new CustomEvent('chorus:session-lock-changed', {
      detail: { sessionId: props.sessionId, locked: next }
    })
  )
}

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
 *  selection cannot be a CSS `color-mix()`; this derives it from the dedicated
 *  terminal-selection token rather than restating a literal here. */
function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return hex
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16))
  return `rgb(${r} ${g} ${b} / ${alpha})`
}

/**
 * ⚠ FIVE KEYS, AND DELIBERATELY NO ANSI PALETTE. The 16 ANSI colours are the
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
function paneTheme(): {
  background: string
  foreground: string
  cursor: string
  selectionBackground: string
  selectionInactiveBackground: string
} {
  const jade = token('--color-accent-jade')
  const selection = withAlpha(token('--color-terminal-selection'), 0.35)
  return {
    background: '#00000000',
    foreground: token('--color-text-body'),
    cursor: jade,
    selectionBackground: selection,
    // Keep copied text visible after focus moves to the destination window.
    selectionInactiveBackground: selection
  }
}

/* ------------------------------------------------------------------ */
/* Whose words are these? — the user-text tint                          */
/* ------------------------------------------------------------------ */

/**
 * Tint the rows carrying the HUMAN's words, so a pane reads as a conversation
 * rather than one undifferentiated wall of white.
 *
 * ⚠ THE PREVIOUS VERSION OF THIS COMMENT WAS WRONG, AND THE BUG IT CAUSED IS THE
 * REASON THIS ONE EXISTS. It claimed a whole turn emits "exactly ONE SGR
 * sequence, a bare `ESC[m` at startup". Re-measured against **Claude Code
 * v2.1.228 on 2026-08-12** through node-pty under Chorus's pinned env
 * (TERM=xterm-256color, COLORTERM=truecolor): that is true of the COMPOSER only,
 * which really does emit zero SGRs. The **submitted message in the transcript is
 * fully coloured**, and the earlier pass simply never looked at it:
 *
 *     ESC[38;2;84;94;106m  ESC[48;2;18;21;26m  ESC[7;1H "❯ "
 *     ESC[38;2;199;207;216m <the message text>            ESC[49m
 *
 * So the composer tinted and the transcript did not — the exact symptom
 * reported. Two consequences, and both are load-bearing:
 *
 * ⚠ (1) THE TRANSCRIPT IS EXPLICITLY COLOURED, SO THE CSS USES `!important` AND
 * NO LONGER RELIES ON INHERITANCE. @xterm/xterm 6.0.0 renders an RGB foreground
 * through `_applyMinimumContrast(...) || _addStyle(...)`, and the `_addStyle`
 * arm writes an INLINE `color:#rrggbb` that no selector specificity beats. The
 * rule therefore overrides every foreground inside a user row — narrowly, and
 * only there. That does cross the line the old comment boasted of not crossing;
 * it is acceptable because a user row is the HUMAN's words end to end, and there
 * is no agent palette in it to preserve.
 *
 * ⚠ ONE THING HERE IS DELIBERATELY NOT EXPLAINED, RATHER THAN EXPLAINED WRONGLY.
 * In a live pane the message spans came back with NO inline colour at all
 * (measured: `style` carried only `letter-spacing`), even though the stream
 * plainly carries the SGR — so xterm took the `_applyMinimumContrast` arm for a
 * reason not chased down here. `!important` is kept because it is correct under
 * BOTH observed outcomes and costs nothing under either. Do not "simplify" it
 * away on the strength of one pane that happened not to inline the colour.
 *
 * ⚠ (2) A BLOCK IS THE MARKER ROW PLUS THE INDENTED ROWS UNDER IT, AND THE PANE
 * WIDTH DECIDES WHICH ROWS THOSE ARE. At 120 columns the marker and the first
 * words share a row; in a narrower pane the `❯` sits alone and the whole message
 * is indented beneath it. Both were observed, and the same rule covers both: run
 * until a row is blank or stops being indented. A message also wraps NATURALLY
 * (the second row gets no cursor address of its own), which is why the earlier
 * note claiming the agent hard-wraps every row absolutely was also wrong —
 * `isWrapped` is simply not needed either way.
 *
 * ⚠ (3) THE SEPARATOR MUST NOT DRAW OVER THE COMPOSER, AND THE CURSOR IS WHAT
 * TELLS THEM APART. The composer opens with the very same `❯`, so nothing in the
 * text distinguishes it from a sent message. The cursor does: it lives in the
 * composer. A block containing the absolute cursor line (`baseY + cursorY`, per
 * xterm's own definition of `cursorY` as relative to `baseY`) is therefore the
 * thing being typed, and gets the tint but no rule. This survives scrolling,
 * where "the last block on screen" would not.
 *
 * ⚠ A REJECTED APPROACH, RECORDED SO IT IS NOT RE-TRIED. At 120 columns the
 * transcript message carries a background band (`ESC[48;2;18;21;26m`) spanning
 * exactly the message, which looked like a perfect extent signal. It does NOT
 * appear in a real Chorus pane — measured live, every span came back
 * `background-color: rgba(0, 0, 0, 0)` — so a rule keyed on it drew nothing at
 * all. The band is real but conditional; the indent is not.
 *
 * ⚠ AND IT IS A VIEW EFFECT ONLY: no byte of the stream is rewritten. The PTY,
 * the scrollback and anything copied to the clipboard are untouched, so the tint
 * cannot corrupt a TUI's redraw the way injecting SGRs into the stream could.
 */
function paintUserRows(): void {
  const marker = USER_ROW_MARKER[props.agent]
  if (!marker || !terminal) return
  const rows = container.value?.querySelector('.xterm-rows')
  if (!rows) return
  const buffer = terminal.buffer.active
  const cursorLine = buffer.baseY + buffer.cursorY

  // Pass 1 — group the visible rows into blocks. Whether a block gets a rule
  // cannot be decided while walking it: the cursor may sit on any of its rows.
  const blocks: { rows: number[]; hasCursor: boolean }[] = []
  let current: { rows: number[]; hasCursor: boolean } | null = null
  const visible = Math.min(terminal.rows, rows.children.length)

  for (let i = 0; i < visible; i++) {
    const text = buffer.getLine(buffer.viewportY + i)?.translateToString(true) ?? ''
    const starts = text.startsWith(marker)
    if (starts) {
      current = { rows: [], hasCursor: false }
      blocks.push(current)
    } else if (current && (text.trim().length === 0 || !text.startsWith('  '))) {
      current = null
    }
    if (current) {
      current.rows.push(i)
      if (buffer.viewportY + i === cursorLine) current.hasCursor = true
    }
  }

  // Pass 2 — paint.
  const tinted = new Set<number>()
  const ruled = new Set<number>()
  for (const block of blocks) {
    for (const i of block.rows) tinted.add(i)
    if (!block.hasCursor) ruled.add(block.rows[0])
  }
  for (let i = 0; i < visible; i++) {
    const el = rows.children[i]
    if (!(el instanceof HTMLElement)) break
    el.classList.toggle('chorus-user-row', tinted.has(i))
    el.classList.toggle('chorus-user-row-start', ruled.has(i))
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
  // v16: the lock is ASSIGNED, not seed-once — an F5 keyed remount must land on
  // what the row says now, and there is no live stream to clobber (see the
  // ref's own note). Seeding it defensively like `title` would strand a pane
  // showing the state the session had when it first mounted.
  locked.value = attach.locked
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
  // GridRenderer and FilmstripRenderer, and it is unmounting anyway.
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
 * both GridRenderer and FilmstripRenderer to relay it.
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
 * Chorus reads the clipboard explicitly, then gives the text to `terminal.paste()`.
 * That avoids depending on Chromium dispatching a native paste event from an
 * xterm-owned textarea while still preserving xterm's newline normalisation and
 * ESC[200~ / ESC[201~ bracketed-paste framing.
 *
 * Ctrl+C copies only when text is visibly selected. A successful copy clears
 * the selection, so the next Ctrl+C reaches the PTY as SIGINT. Ctrl+Shift+C is
 * always copy. This is the familiar Windows Terminal / VS Code terminal model
 * and keeps interrupt available without making ordinary Windows copy fail.
 */
function onTerminalKey(e: KeyboardEvent): boolean {
  // Which chord this is lives in clipboardKeys.ts, tested without a DOM; what
  // to DO about it lives here, where the terminal and the clipboard are.
  const intent = clipboardIntent(e, terminal?.hasSelection() ?? false)
  if (intent === null) return true

  // Claim the key before xterm maps Ctrl+V to ^V. The helper still routes the
  // text through terminal.paste(), never directly to the PTY.
  if (intent === 'paste') {
    e.preventDefault()
    void pasteFromClipboard('keyboard')
    return false
  }

  // ⚠ TRIMMED, because a terminal selection is a RECTANGLE: every row arrives
  // padded to the full column width, so an untrimmed copy carries a tail of
  // spaces into whatever it is pasted into. The emptiness test runs on the
  // TRIMMED text — a selection of nothing but padding is a selection of
  // nothing, and should no-op rather than put blanks on the clipboard.
  const selection = trimSelectionForClipboard(terminal?.getSelection() ?? '')
  e.preventDefault()
  if (selection.length > 0) void copySelection(selection, true)
  return false
}

/** ⚠ NEVER LOG THE TEXT. A terminal selection routinely contains an API key —
 *  the same reason the scrubber exists — so the failure path reports the ERROR
 *  and says nothing about what was being copied. */
async function copySelection(text: string, clearAfter = false): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    if (clearAfter) terminal?.clearSelection()
  } catch (err) {
    // Covers a missing `navigator.clipboard` (TypeError) and a denied write
    // alike. Silent-but-visible: the user sees no toast, a developer sees this.
    console.error('[pane] copy failed:', err)
  }
}

/** One paste path for both keyboard and right-click. The source is safe to log;
 *  the clipboard text is not and never leaves this function except to xterm. */
async function pasteFromClipboard(source: 'keyboard' | 'right-click'): Promise<void> {
  const target = terminal
  if (!target) return
  try {
    const text = await navigator.clipboard.readText()
    // The component may unmount while the clipboard promise is pending.
    if (text.length > 0 && terminal === target) target.paste(text)
  } catch (err) {
    console.error(`[pane] ${source} paste failed:`, err)
  }
}

/**
 * Right-click copies a visible selection; otherwise it pastes, but ONLY in a
 * pane whose agent did not get the click.
 *
 * ⚠ THIS FILE PREVIOUSLY CARRIED A COMMENT SAYING NO HANDLER WAS NEEDED because
 * "Chromium performs it". That was measured, but the attribution was wrong, and
 * the wrong half is the load-bearing one. Chromium pastes on right-click
 * NOWHERE in this window — a `contextmenu` event fires with `defaultPrevented`
 * false and no `paste` event ever follows. What actually pasted was CLAUDE CODE:
 * its TUI turns mouse tracking on (`?1003h`/`?1006h`), so xterm forwards the
 * right-click to the child as an SGR mouse report, and the agent reads the
 * system clipboard itself. The earlier double paste was our handler AND the
 * agent, not our handler AND Chromium.
 *
 * That mis-attribution is why deleting the handler looked like a fix: it was
 * one, for Claude. Codex leaves mouse tracking OFF, so a right-click in a codex
 * pane reaches nobody — xterm keeps it, the agent never sees it, and with no
 * handler here the gesture did nothing at all. Same for any other agent whose
 * TUI does not grab the mouse.
 *
 * ⚠ SO THE GUARD IS THE MOUSE MODE, NOT THE AGENT ID. `mouseTrackingMode !==
 * 'none'` means xterm handed the click to the child and the child decides what
 * it means; pasting here as well is exactly the double paste that got the first
 * handler deleted. Keying on `props.agent` instead would be a list to maintain
 * and would still be wrong the moment an agent changes its mind mid-session —
 * this reads the state xterm already tracks, so it follows the TUI live.
 *
 * ⚠ AND IT PASTES THROUGH `terminal.paste()`, NOT BY WRITING TO THE PTY. That is
 * the same insistence as the Ctrl+V path above: xterm normalises newlines to CR
 * and applies bracketed-paste framing, which is what lets an agent treat the
 * block as one edit. Reading the clipboard is unavoidable here (there is no
 * default action to lean on); reimplementing the framing is not.
 */
async function onContextMenu(e: MouseEvent): Promise<void> {
  if (!terminal) return
  // Windows terminal behaviour: right-click copies a visible selection;
  // otherwise it pastes. Check this before mouse mode so Shift-dragged text in
  // a mouse-aware TUI can still be copied instead of being handed to the agent.
  if (terminal.hasSelection()) {
    e.preventDefault()
    const selection = trimSelectionForClipboard(terminal.getSelection())
    if (selection.length > 0) await copySelection(selection, true)
    return
  }
  if (terminal.modes.mouseTrackingMode !== 'none') return
  e.preventDefault()
  await pasteFromClipboard('right-click')
}

/* ------------------------------------------------------------------ */
/* Keyboard focus                                                      */
/* ------------------------------------------------------------------ */

/**
 * Give this pane's terminal the keyboard.
 *
 * ⚠ NOTHING IN CHORUS CALLED `terminal.focus()` BEFORE THIS, WHICH IS THE
 * WHOLE OF THE DEFECT. xterm focuses its hidden textarea when a click lands
 * INSIDE the terminal element and at no other moment, so every other way of
 * arriving at a pane left the keyboard pointing elsewhere: launching a session
 * (the dialog closes to `body`), coming back from Settings or the council
 * (every pane remounts), swapping the filmstrip's focus, or clicking any header
 * control (the button keeps focus once activated).
 *
 * ⚠ THE SYMPTOM IS THE HOLLOW CURSOR, AND IT IS ALREADY ON THE RECORD TWICE.
 * xterm's `cursorInactiveStyle` defaults to `'outline'`, so an unfocused
 * terminal draws an EMPTY RECTANGLE where the block cursor should be. F87 and
 * F88 both name that hollow cursor as the tell that nothing held DOM focus;
 * both read it as a dictation symptom, because dictation writes through MAIN
 * and so kept working in exactly the state where typing did not.
 *
 * ⚠ AND THE KEY THE USER NOTICES IS THE SPACEBAR, which is why this arrives
 * as "the spacebar is broken" rather than "the pane is not focused". Letters
 * have no default action and vanish in silence; Space is Chromium's ACTIVATE
 * key for a focused button, so it re-fires whatever was last clicked — press
 * it after using the mic button and you toggle dictation instead of typing a
 * word gap. On `body` it scrolls instead. One key fails visibly; the rest fail
 * invisibly.
 *
 * ⚠ IT REFUSES WHILE AN IN-PANE PROMPT IS OPEN. The unlock prompt owns the
 * keyboard while it is up (its PIN field is the only thing worth typing into)
 * and the clean-removal offer is a decision that must stay reachable by
 * keyboard; taking focus back to the terminal would strand either one. A header
 * control that opens an OVERLAY needs no such guard — the launch dialog and the
 * palette focus their own field on mount, a tick after this has run.
 */
function focusTerminal(): void {
  if (unlockPrompt.value || closeOffer.value) return
  terminal?.focus()
}

/**
 * Take the keyboard when this pane BECOMES the workspace's focused one.
 *
 * The filmstrip keys its full-size pane by the focused id, so a focus swap
 * there is a remount and `onMounted` serves it. This watcher is for the panes
 * that stay mounted through a focus change — grid mode, where the palette's
 * `focusSession` command can move focus with no click in any pane at all.
 *
 * ⚠ IT NEVER TAKES THE KEYBOARD OFF ANOTHER TERMINAL, and that guard is not
 * decoration. `effectiveFocused` moves for reasons the user did not ask for:
 * when the pane it named closes it falls back to the first leaf (F4), and in
 * grid mode every pane stays mounted — so that fallback would land here and
 * yank the caret out of whichever pane the user was mid-sentence in. Focus is
 * taken only when no terminal currently holds it. Losing the flag does nothing:
 * whoever gained it is about to take the keyboard, and a blur here would race
 * that.
 */
watch(
  () => props.focused,
  (isFocused) => {
    if (!isFocused) return
    if (document.activeElement?.closest('[data-attention-session]')) return
    focusTerminal()
  }
)

/**
 * Any click on the header hands the keyboard back to the terminal.
 *
 * ⚠ WHAT MATTERS IS WHERE FOCUS ENDS UP AFTER THE CLICK, NOT THE CLICK. A
 * `<button>` keeps DOM focus once activated, so before this the price of using
 * dictate, split, restart, kill or the padlock was that the next thing you
 * typed went to that button instead of to the agent. Bound on the header rather
 * than on each control so a control added later inherits it, and so a click on
 * the header's empty space — which reads as "work in this pane" — focuses it
 * too.
 *
 * ⚠ IT NEITHER CANCELS NOR STOPS THE EVENT. The control's own handler has
 * already run by the time this bubbling listener fires; this only decides where
 * the caret is left.
 *
 * ⚠ ATTENTION ACCOUNTING MOVES WITH IT, DELIBERATELY. The 3a-2 ruling on
 * `data-attention-session` (see the attribute's own comment below) put header
 * clicks in the per-project OVERHEAD bucket precisely BECAUSE focus stayed on
 * the button. With focus returned to the terminal, the seconds after a header
 * click are credited to this session instead. That is the more honest reading
 * — someone who just clicked Restart on a pane is working on that pane, not
 * reviewing the board — but it does change what the Day summary counts, and it
 * is written down here rather than discovered in a report later. The clicks the
 * ruling was really about (a filmstrip card, the splitter, the rail) still
 * resolve to null and still land in overhead.
 */
function onHeaderClick(): void {
  focusTerminal()
}

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

  // The user-text tint, re-derived on every render. Driving it off `onRender`
  // rather than off `onSessionData` is what makes it correct for free: a scroll,
  // a resize and a wholesale TUI repaint all change which buffer line sits on
  // which row element, and all three end in a render. Registered BEFORE the
  // attach below so the replayed scrollback is tinted on its first paint.
  const renderDisposable = terminal.onRender(() => paintUserRows())
  cleanups.push(() => renderDisposable.dispose())

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

  // ⚠ THE PATH THE WATCHER ABOVE CANNOT SERVE: a pane that mounts ALREADY
  // focused, so no change to the prop will ever fire. That is most of them —
  // the filmstrip remounts its full-size pane on every focus swap (it is keyed
  // by the id), `App.onLaunched` makes a newly launched session the focused one
  // before its pane renders, and every pane remounts on the way back from
  // Settings or the council. Runs LAST, after the attach and the fit, so the
  // keyboard is never handed to a terminal that is still the wrong size.
  if (props.focused) focusTerminal()
})

onBeforeUnmount(() => {
  clearTimeout(resizeTimer)
  clearTimeout(badgeTimer)
  clearTimeout(titleTimer)
  clearInterval(diffTimer)
  // v16: drop any typed PIN with the component. A focus swap (F5) unmounts this
  // pane mid-prompt, and the value must not survive in a reactive ref that
  // outlives the surface that asked for it.
  closeUnlockPrompt()
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
  <div class="pane-shell flex h-full flex-col" :class="{ 'pane-dictating': dictating }">
    <!-- The pane header, to the design's anatomy (3c-3 / spec §5): a state row
         over a metadata row. Everything on it comes from data the pane ALREADY
         has — the mock's elapsed clock, `$0.84` cost, model name, effort meter
         and permission-mode chip are all facts Chorus does not carry, and D76
         omits them rather than inventing them. No data source was added here. -->
    <div class="pane-header" @click="onHeaderClick">
      <div class="pane-header-row">
        <StateMarker v-if="markerState" :state="markerState" />
        <span class="pane-title" :title="title ?? labels[props.agent]">
          {{ title ?? labels[props.agent] }}
        </span>
        <!-- D182: the peer address. Drawn from the LIVE fleet snapshot; see
             `addressChip`. `changed` shows the current name with the
             requested one in the tooltip, and it persists rather than
             flashing once — a badge that evaporates reads as a silent
             rename to anyone who blinked. -->
        <span
          v-if="addressChip"
          class="pane-address"
          :class="'pane-address-' + addressChip.kind"
          :title="addressChip.title"
        >
          {{ addressChip.text }}
        </span>
        <!-- v16: the padlock, immediately after the title — "a little lock icon
             running near the name" (Matthew, this session). It sits BEFORE the
             rule rather than in `.pane-controls` on purpose: the controls group
             is a row of VERBS acting on the session, and the lock is a PROPERTY
             OF the thing named to its left. Putting it beside Kill and ✕ would
             also have put the safety catch inside the cluster it protects
             against, one slip apart from them. -->
        <button
          type="button"
          class="pane-lock"
          :class="{ 'pane-lock-on': locked }"
          :disabled="lockBusy"
          :aria-pressed="locked"
          :title="
            locked
              ? 'Locked — this agent cannot be stopped, closed, or its project archived or deleted. Click to unlock.'
              : 'Lock this agent against being stopped, closed, or its project archived or deleted'
          "
          @click="onToggleLock"
        >
          <!-- Closed shackle when locked, open (shifted, hinged left) when not:
               the SHAPE carries the state, so the amber is reinforcement rather
               than the only signal — StateMarker's rule, applied here. Drawn by
               PaneIcon now so it shares the header family's grid and cap; the
               open/closed distinction is Lucide's own and is unchanged.

               14px in a 22px box, up from 12/20. Still deliberately SMALLER
               than the 16/28 verbs beside it — the hierarchy the comment above
               describes is the reason this control is quiet, and enlarging the
               row must not flatten it into a fifth action. -->
          <PaneIcon :name="locked ? 'lock' : 'lock-open'" :size="14" />
        </button>
        <span class="pane-rule" />
        <div class="pane-controls">
          <!-- ⚠ CLICK-TO-TALK: THE ACCESSIBILITY PATH, AND A PEER OF THE HOTKEY
               (VoicePlan §7.2). It is a TOGGLE — click to start, click to stop,
               no key held at any moment — and nothing on this path touches
               `uiohook`, so it keeps working when the native hook does not. -->
          <button
            type="button"
            class="pane-btn pane-btn-icon"
            :class="{ 'pane-btn-accent': dictating }"
            :title="dictating ? 'Stop dictating into this pane' : 'Dictate into this pane'"
            :aria-label="dictating ? 'Stop dictating into this pane' : 'Dictate into this pane'"
            :aria-pressed="dictating"
            @click="onToggleDictation"
          >
            <!-- Mic idle, solid stop block live. ⚠ THE EMOJI THIS REPLACES WAS
                 NEVER TINTABLE: the OS drew 🎙 as full-colour art at its own
                 size, so `pane-btn-accent` had no visible effect on the one
                 control in this row whose active state most needs to be
                 obvious. The glyph now changes AND takes the jade. -->
            <PaneIcon :name="dictating ? 'stop' : 'mic'" />
          </button>
          <!-- D174: ONE button where there were two. "Beside" and "below" were
               a choice the user had to make before they could see the result,
               and the result was a split tree whose shape nobody could predict
               two launches later. A new agent now lands at the end of the flow
               and the grid wraps it by the window's width — so the only honest
               label left is the one this button carries. -->
          <button
            type="button"
            class="pane-btn pane-btn-icon"
            title="New agent — lands at the end of the grid"
            aria-label="New agent"
            @click="emit('newAgent')"
          >
            <PaneIcon name="new-agent" />
          </button>
          <!-- Its pair, and they sit together on purpose: one adds a pane to the
               grid, the other trades the whole grid for this one pane. Together
               they are the entire layout vocabulary the header now has.

               ⚠ THE SAME BUTTON IN BOTH DIRECTIONS. Maximizing takes you to
               the filmstrip with this agent full-size; clicking it again there
               puts you back in the grid. It is not a mode picker — the rail's
               footer toggle still is — it is "show me this one" and "show me
               them all", which is the question a reader actually has while
               looking at a pane. -->
          <button
            type="button"
            class="pane-btn pane-btn-icon"
            :aria-pressed="props.maximized"
            :title="
              props.maximized
                ? 'Back to the grid — show every agent'
                : 'Maximize — show only this agent'
            "
            :aria-label="props.maximized ? 'Back to the grid' : 'Maximize this agent'"
            @click="emit('maximize', props.sessionId)"
          >
            <PaneIcon :name="props.maximized ? 'minimize' : 'maximize'" />
          </button>
          <!-- Restart keeps the mock's reading — a clockwise arc with a head —
               but is cut on PaneIcon's 24 grid instead of its own 14-unit box,
               which is what lets it share a cap and weight with the five
               controls around it. It used to be the ONLY real icon here, and
               being the only one is why the row never read as a set. -->
          <button
            type="button"
            class="pane-btn pane-btn-icon"
            :disabled="pane.busy"
            title="Restart this session"
            aria-label="Restart this session"
            @click="onRestart"
          >
            <PaneIcon name="restart" />
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
          <!-- v16: both destructive verbs are DISABLED while locked, and the
               tooltip says why rather than leaving a dead button unexplained.
               ⚠ THIS IS AFFORDANCE, NOT ENFORCEMENT — main refuses either call
               regardless (`requireUnlockedSession`). If these two attributes
               were the whole feature, the command palette and a project archive
               would still destroy a locked agent without touching this file. -->
          <button
            type="button"
            class="pane-btn pane-btn-icon pane-btn-danger"
            :disabled="pane.busy || pane.status !== 'running' || locked"
            :title="locked ? 'Locked — unlock this agent to stop it' : 'Kill this session, keeping the pane'"
            :aria-label="locked ? 'Locked — unlock this agent to stop it' : 'Kill this session, keeping the pane'"
            @click="onKill"
          >
            <!-- ⚠ A POWER RING, NOT A SECOND ✕. The note above used to argue
                 Kill had to stay the WORD because any icon for it would collide
                 with Close's ✕, and against another ✕ that was correct. A
                 broken circle with a stem is not two crossed strokes: the two
                 stay apart at 16px, in grayscale, and by shape alone. The verb
                 leaves the pixels but not the accessible name. -->
            <PaneIcon name="kill" />
          </button>
          <button
            type="button"
            class="pane-btn pane-btn-icon pane-btn-danger"
            :disabled="pane.busy || locked"
            :title="locked ? 'Locked — unlock this agent to close it' : 'Kill session and close pane'"
            :aria-label="locked ? 'Locked — unlock this agent to close it' : 'Kill session and close pane'"
            @click="onClose"
          >
            <PaneIcon name="close" />
          </button>
        </div>
      </div>

      <div class="pane-meta">
        <span class="pane-tile"><AgentMark :name="props.agent" /></span>
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
        <!-- v16: the context ring, LAST in the meta row and pushed right by the
             spacer, so it holds a stable position while the segments before it
             (note, branch, diff) come and go. The meta row is the right home
             for it: everything here describes the SESSION rather than its
             moment-to-moment state, which is the top row's job.
             ⚠ Rendered only where there is a real reading. -->
        <template v-if="contextUsage">
          <span class="pane-meta-spacer" />
          <ContextRing :usage="contextUsage" :size="15" />
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
        @contextmenu="onContextMenu"
      ></div>
      <div v-if="paneMessage" class="pane-overlay">
        {{ paneMessage }}
      </div>
      <!-- v16: the inline unlock prompt. Same surface and same reasoning as the
           close offer directly below — never a window.confirm.
           ⚠ ONE PROMPT SERVES BOTH CONFIGURATIONS. With no PIN set it is a
           plain confirm (the deliberate second act Matthew chose); the field
           appears only once main has answered `pinRequired`, so the renderer
           never has to know in advance whether a PIN exists. -->
      <div
        v-if="unlockPrompt"
        class="pane-offer absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 px-3 py-2 text-xs"
      >
        <span class="pane-offer-text min-w-0 truncate">
          <template v-if="unlockError">{{ unlockError }}</template>
          <template v-else-if="unlockNeedsPin">Enter your PIN to unlock this agent.</template>
          <template v-else>Unlock this agent? It can then be stopped and closed.</template>
        </span>
        <span class="flex shrink-0 items-center gap-2">
          <!-- ⚠ type="password" so a PIN is not shoulder-readable, and
               autocomplete off so Chromium never offers to save it. -->
          <input
            v-if="unlockNeedsPin"
            v-model="unlockPin"
            type="password"
            class="pane-offer-pin"
            :maxlength="PIN_MAX_LENGTH"
            autocomplete="off"
            placeholder="PIN"
            aria-label="Unlock PIN"
            @keydown.enter.prevent="submitUnlock"
            @keydown.esc.prevent="closeUnlockPrompt"
          />
          <button
            class="pane-offer-danger px-2 py-0.5"
            :disabled="lockBusy || (unlockNeedsPin && unlockPin.length === 0)"
            title="Unlock this agent"
            @click="submitUnlock"
          >
            Unlock
          </button>
          <button
            class="pane-offer-ghost px-2 py-0.5"
            :disabled="lockBusy"
            title="Leave this agent locked"
            @click="closeUnlockPrompt"
          >
            Cancel
          </button>
        </span>
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
/* ⚠ TASK 5-3: THE DICTATION RING. Distinct from the focus ring `pane-shell`
   already carries, because the two legitimately point at DIFFERENT panes —
   that is the whole reason the target is its own state.

   ⚠ SHOWN ONLY WHILE A DICTATION IS RUNNING, NOT BEFORE (D166). It used to
   track the target whether or not a capture was running, per VoicePlan §7.3
   ("a visible ring BEFORE the user speaks"). That rule was written when the
   seed was DOM focus, so the ring came and went with the terminal's focus.
   The F87 fix (0.7.1) made the seed ALWAYS resolve to some pane, which turned
   the idle ring into a permanent red outline around one pane in every
   layout, voice in use or not — and it was reported as "a red border I want
   gone", not as a target. The target is still named before speech: the
   overlay's "dictating into …" line carries it, and the ring lights the
   pane the moment the capture opens. `useDictationRing` still knows the
   idle target; only the paint is gated.

   ⚠ JADE, NOT RED, SINCE D181. The overlay this ring belongs with stopped
   being red when the level meter became the Chorus mark, and a red ring
   around the pane the jade panel names was the last thing still disagreeing
   with it. The ring is STILL distinct from the focus indicator, which is
   what the note above requires: focus tints the HEADER (jade at 10%), this
   outlines the whole PANE at full strength, so the two read apart even when
   they point at different panes — which is the case they exist for. */
.pane-dictating {
  outline: 2px solid var(--color-accent-jade);
  outline-offset: -2px;
  border-radius: 6px;
}

/* ── The active pane: a tinted TITLE BAR, not a border ───────────────────
 *
 * "Where is my cursor?" — with several panes on screen, the answer was nowhere
 * on the screen.
 *
 * ⚠ THIS REPLACED A 1px FOCUS RING, AND THE REASON IS WORTH KEEPING: the ring
 * COMPETED WITH THE BORDERS ALREADY THERE. A pane sits inside a framed cell
 * (splitpanes gutters when this was written; a grid cell's hairline since
 * D174 — the same problem either way) and carries its own
 * `--color-border-panel` header rule, so a third line an alpha away from the
 * other two read as a rendering artefact rather than as state. A FILLED
 * REGION does not compete with a line — it is a different visual channel, so
 * it reads at a glance without adding a fourth edge to a screen already full
 * of them.
 *
 * ⚠ `:focus-within`, NOT A `focused` PROP, AND THAT PART SURVIVED THE REDESIGN.
 * The app has a `viewStore.focusedSessionId` and it would have been the obvious
 * thing to bind — but it is WRONG here: `GridRenderer` binds no `@focus`
 * (App.vue says so in as many words), so in grid mode — the only mode where
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

/* The human's own words, tinted by `paintUserRows` (see its warnings for the
   measurement all of this rests on).

   ⚠ `!important` IS KEPT ON PURPOSE AND THE EARLIER "IT DOES NOT NEED ONE" IS
   RETRACTED. A submitted message carries a TRUECOLOR foreground, and xterm's
   `_addStyle` arm writes that as an inline `color:#rrggbb` that no selector
   specificity beats. A live pane was ALSO observed rendering those same spans
   with no inline colour at all — see `paintUserRows` — so both outcomes are
   real. `!important` is the only form that is correct under both.

   The span rule is deliberately scoped INSIDE `.chorus-user-row`, so it recolours
   the human's own words and nothing else in the pane. */
.terminal-container :deep(.xterm-rows > div.chorus-user-row),
.terminal-container :deep(.xterm-rows > div.chorus-user-row span) {
  color: var(--color-terminal-user-text) !important;
}

/* The separator above each submitted message.

   ⚠ STILL NOT `border-top`, AND THAT IS STILL A CORRECTNESS CONSTRAINT, NOT A
   PREFERENCE. xterm's DOM renderer lays rows out at a computed fixed height; a
   border adds a pixel to the box and every row below it drifts, so the text
   would creep out of alignment with the cursor and the selection. This
   pseudo-element is `position: absolute`, so it is out of flow and costs no
   layout at all — the same property the inset shadow it replaces was chosen for.

   ⚠ AND IT IS NO LONGER `box-shadow: inset`, WHICH LOOKED EQUIVALENT AND WAS
   NOT. An inset shadow paints on the element's own BACKGROUND layer, and xterm
   renders each run of cells as a child `<span>` — children paint ON TOP of the
   parent's background. Any span carrying a background colour therefore erases
   the rule underneath it, silently and only for some agents.

   That is exactly how it failed. MEASURED on a live pane (2026-08-12) by
   scanning the rendered pixels: a row whose spans were transparent showed all
   812px of the rule, while a row carrying `\x1b[48;2;30;41;59m` showed only the
   419px to the RIGHT of its 393px span — the shadow surviving solely where no
   span covered it. On a real submitted Claude Code message, whose background
   run spans the full width, that leaves a SINGLE visible pixel at the far right
   edge, which reads as "the rule is broken" rather than "the rule is covered".

   A positioned pseudo-element paints above in-flow, non-positioned children, so
   it clears every span regardless of what colours the agent emits. `position:
   relative` on the row is what anchors it and changes no geometry (z-index
   stays `auto`, so no stacking context is created either). */
.terminal-container :deep(.xterm-rows > div.chorus-user-row-start) {
  position: relative;
}

.terminal-container :deep(.xterm-rows > div.chorus-user-row-start)::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background-color: var(--color-accent-jade);
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

.pane-address {
  flex: 0 0 auto;
  font-size: 11px;
  line-height: 1;
  padding: 2px 6px;
  border-radius: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 22ch;
  /* Tokens only — no raw hex, the discipline ProjectRail.vue:24 records. */
  color: var(--color-text-muted);
  border: 1px solid var(--color-border-subtle);
}
.pane-address-verified {
  color: var(--color-accent-jade);
  border-color: var(--color-accent-jade);
}
/* Distinguishable but NOT an error: a renamed agent is working fine, it is
   merely reachable under a different name. Error affordances stay for errors. */
.pane-address-changed {
  color: var(--color-text-primary);
  border-style: dashed;
}
.pane-address-unknown,
.pane-address-absent {
  opacity: 0.7;
  font-style: italic;
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
  gap: 3px;
}

/* ⚠ 28/16, NOT THE MOCK'S 24/13 — a DELIBERATE, NAMED DEPARTURE FROM D73.
   The mock draws this cluster at 24px boxes holding 13px glyphs, and in use
   that is not readable ("the icons are so small they are not recognizable" —
   Matthew, this session). A size the design cannot be read at has already
   failed the design's own intent, so it is the one value that moves: the
   anatomy, the 2-row header, the spacing rhythm, the hover model and every
   colour token stay exactly the mock's.

   The cost is 4px of header height per pane, paid once. The glyph grows 13 ->
   16px (~23%) and the hit target 24 -> 28px, which is also the first time
   these buttons meet a normal desktop toolbar target size. */
.pane-btn {
  height: 28px;
  min-width: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 7px;
  border: 0;
  border-radius: var(--radius-icon);
  background: transparent;
  color: var(--color-text-tertiary);
  font-family: var(--font-sans);
  font-size: 11px;
  cursor: default;
  transition: color 120ms ease, background-color 120ms ease;
}

/* Icon-only buttons are SQUARE — no side padding, so the 28px box IS the hit
   target and all six glyphs sit on one 28px pitch. `Relaunch` is the only text
   button left in this row and keeps its horizontal padding. */
.pane-btn-icon {
  padding: 0;
}

/* The glyph never shrinks in the flex row, and never takes a click on its own
   behalf — the BUTTON is the target, which matters more now that the visible
   mark is 16px inside a 28px box. */
.pane-btn svg {
  flex: none;
  pointer-events: none;
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

/* v16: pushes the context ring to the right edge of the meta row so it holds
   one position while the segments before it appear and disappear. */
.pane-meta-spacer {
  flex: 1;
  min-width: 8px;
}

/* ── v16: the lock toggle ────────────────────────────────────────────────
 *
 * ⚠ IT IS NOT A `.pane-btn`, ON PURPOSE. Those are the header's VERB cluster —
 * uniform 24px hit targets in a row on the right — and this is a property of
 * the title it sits beside. Giving it the same chrome would have made it read
 * as a fifth action and put a safety catch one slip away from Kill and ✕.
 * Smaller, quieter, and outside that group.
 *
 * ⚠ UNLOCKED IS DELIBERATELY LOW-CONTRAST. The default state is the common one
 * and must not decorate every pane header in the app with a control the user
 * did not ask for; it comes up to full strength on hover, which is when it is
 * being looked for. */
.pane-lock {
  height: 22px;
  width: 22px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: var(--radius-icon);
  background: transparent;
  color: var(--color-glyph-dim-high);
  cursor: default;
  transition: color 120ms ease, background-color 120ms ease;
}

.pane-lock:hover:not(:disabled) {
  background: var(--color-surface-icon-hover);
  color: var(--color-text-body);
}

.pane-lock:disabled {
  opacity: 0.4;
}

/* Locked is amber — the app's one "pay attention to this" hue — because a
   locked agent is a deliberate, standing exception to how every other pane
   behaves, and it should be visible without hovering. The SHAPE (closed vs open
   shackle) still carries the state on its own; this only reinforces it. */
.pane-lock-on {
  color: var(--color-state-attention-text);
}

.pane-lock-on:hover:not(:disabled) {
  background: var(--color-surface-icon-hover);
  color: var(--color-state-attention);
}

/* The fade is decoration; the colour is information — reduced motion drops the
   transition and keeps the tint (3c-1's standing rule, as above). */
@media (prefers-reduced-motion: reduce) {
  .pane-lock,
  .pane-btn {
    transition: none;
  }
}

/* v16: the unlock field, in the shared offer bar. Sized for a short PIN rather
   than stretched to the bar's width — a 200px box for four digits reads as a
   text field and invites a sentence. */
.pane-offer-pin {
  width: 84px;
  height: 22px;
  padding: 0 6px;
  border: 1px solid var(--color-border-panel);
  border-radius: var(--radius-icon);
  background: var(--color-surface-inset);
  color: var(--color-text-body);
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.14em;
}

.pane-offer-pin:focus {
  outline: none;
  border-color: color-mix(in srgb, var(--color-accent-jade) 55%, transparent);
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
  /* ⚠ `color` IS THE MARK'S TINT NOW, NOT TEXT STYLING, and deleting it as dead
     CSS fails silently: `AgentMark` fills with `currentColor`, so this line is the
     only thing deciding what the glyph resolves to. Without it the mark inherits
     `--color-text-muted` from `.pane-meta` and the family shifts tone in a way no
     gate catches. The `font-size`/`letter-spacing` that sat beside it ARE gone —
     this tile can never hold text again. */
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
