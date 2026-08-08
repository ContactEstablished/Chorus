<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { LayoutJson } from '../../../shared/layout'
import { collectSessionIds } from '../../../shared/layout'
import type { AgentKind, SessionInfo } from '../../../shared/ipc'
import TerminalPane from './TerminalPane.vue'
import StateMarker from './StateMarker.vue'
import type { SplitTarget } from '../stores/layout'
// The card's ONE piece of live state. Everything else on a card comes from the
// `sessions` prop (the persisted rows) — see the prop's own note on why that
// is deliberately not the session store.
import { useSessionStore } from '../stores/session'

/**
 * Filmstrip view (Task 1b-2 / D20): one focused session as a full
 * TerminalPane, every other leaf a compact card. Consumes the SAME persisted
 * tree + agentFor contract the spike validated
 * (docs/architecture/spike-filmstrip-notes.md) and writes NOTHING to the layout
 * store — focus flows out as an event, never a tree mutation. Cards are plain
 * flexbox: no xterm, no canvas, no PTY stream, no badge (F10).
 *
 * ⚠ 3c-3 MOVED THE STRIP FROM THE BOTTOM EDGE TO THE RIGHT RAIL, which is what
 * the design draws, and it does NOT reflow back to a bottom strip at any
 * session count — it scrolls vertically (settled at the phase kickoff). The
 * pane/card split, the focus event and the props are all unchanged; only the
 * axis and the skin moved.
 *
 * ⚠ The rail lives INSIDE this component rather than beside it in App.vue,
 * although the spec's §1 diagram draws it as a sibling of the view. Same
 * geometry either way, and this way the focused-pane/card partition stays in
 * the one component that owns it — grid mode, which has no rail at all, needs
 * no conditional in the shell to suppress one.
 *
 * ⚠ FOUR STATES NOW — D78 IS DISCHARGED, AND BY ITS OWN TERMS. 3c-3 shipped
 * three and recorded the reason: "the renderer cannot know an agent is waiting
 * for a human", so `chorusPulse` shipped with no first caller rather than being
 * "fixed" by finding something to pulse. That premise is now false. Claude
 * Code's hook bus reports `Stop`, `Notification` and `PermissionRequest`
 * directly to main's localhost listener, so `needs-you` has a SOURCE — this is
 * D83's rule applied exactly as written: the answer to "the mock draws data
 * that does not exist" is omit it OR GIVE IT A SOURCE, never fake it. The
 * animation gets its first caller here, on the CARD, which is where 3c-1 said
 * it belonged.
 *
 * ⚠ AND ONLY WHERE IT IS TRUE. Amber requires a live hook report; an agent
 * whose CLI has no hook bus (codex, kimi, opencode today) keeps exactly the
 * three states it had, because "we don't know" must never render as "it needs
 * you". A false pulse is still worse than none — that half of D78 is permanent.
 */
const props = defineProps<{
  tree: LayoutJson
  /** layout:get rows — the cards' only metadata source (title/status/
   *  exitCode/createdAt). Deliberately NOT the session store: it keys off
   *  attach and cards never attach. Persisted titles are naturally static
   *  (F12a) — no live title stream reaches a card. */
  sessions: SessionInfo[]
  /** App's resolved effective focus (the F4 fallback already applied). */
  focusedSessionId: string
  /** Leaf sessionId -> agent kind; undefined when the session row is gone. */
  agentFor: (id: string) => AgentKind | undefined
}>()

/** Card click / focused-pane focus -> App (view store); split -> launch dialog. */
const emit = defineEmits<{ focus: [sessionId: string]; split: [target: SplitTarget] }>()

const sessionStore = useSessionStore()

const labels: Record<AgentKind, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  kimi: 'Kimi Code', // D86
  opencode: 'opencode' // D90
}

/** The mock's two-letter agent tile. It is what keeps F12b true now that the
 *  full agent label no longer fits the card: same-project Codex titles collide
 *  (they are cwd basenames), so the title alone never identifies a card — the
 *  tile plus the title compose the identity. */
const codes: Record<AgentKind, string> = {
  claude: 'cc',
  codex: 'cx',
  kimi: 'km', // D86
  opencode: 'oc' // D90
}

const ids = computed(() => collectSessionIds(props.tree.root))
const cardIds = computed(() => ids.value.filter((id) => id !== props.focusedSessionId))

function infoFor(id: string): SessionInfo | undefined {
  return props.sessions.find((s) => s.id === id)
}

/** ONE shared clock at 60 s granularity: every card derives its elapsed label
 *  from this single ref — never a per-card or per-second timer. */
const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  clock = setInterval(() => {
    now.value = Date.now()
  }, 60_000)
})
onBeforeUnmount(() => clearInterval(clock))

function elapsed(id: string): string {
  const info = infoFor(id)
  if (!info) return ''
  const mins = Math.floor((now.value - Date.parse(info.createdAt)) / 60_000)
  // NaN (unparseable createdAt) and clock skew both land in the first bucket.
  if (!(mins >= 1)) return 'just now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  return hrs < 24 ? `${hrs}h` : `${Math.floor(hrs / 24)}d`
}

/**
 * The four derivable states. Three come from the persisted row (status +
 * exitCode) exactly as before; the fourth comes from the agent's own hook
 * report. `null` for a missing row — the card then renders no marker at all
 * rather than claiming a shape it cannot stand behind.
 *
 * ⚠ ACTIVITY IS READ ONLY INSIDE THE `running` BRANCH, and the nesting is the
 * safety property. An exited session's amber is meaningless — worse, it would
 * pulse for attention at a process that is gone — and while `sessionStore`
 * clears activity on exit, ordering that against the row patch would be a
 * second place the two could disagree. Here the row's status wins outright and
 * a stale activity entry cannot outrank it.
 */
function stateFor(id: string): 'needs-you' | 'running' | 'error' | 'done' | null {
  const info = infoFor(id)
  if (!info) return null
  if (info.status === 'running') {
    return sessionStore.activity[id] === 'needs-you' ? 'needs-you' : 'running'
  }
  return info.exitCode === 0 ? 'done' : 'error'
}

/**
 * The card's status line. The mock writes rich sentences here ("edited
 * TaxReturnService.cs +42", "done · 3 files changed · review ready") from facts
 * Chorus does not have — no diff summary reaches a card, and nothing parses the
 * agent's output. D76: say what is true and stop. The exit code is worth
 * naming, because a non-zero one is the whole reason the card is red.
 */
function statusLine(id: string): string {
  const info = infoFor(id)
  if (!info) return ''
  if (info.status === 'running') {
    // The words track the marker exactly, because the line under a shape that
    // has changed must not still read `running`. `needs you` is the mock's own
    // wording for this state ("Needs you"), lowercased to match the row's
    // register; `working` is said ONLY when the agent has actually reported it,
    // so a hook-less agent still reads the plain `running` it always did — the
    // status line never claims more than the light does.
    const activity = sessionStore.activity[id]
    if (activity === 'needs-you') return 'needs you'
    return activity === 'working' ? 'working' : 'running'
  }
  return info.exitCode === 0 ? 'done' : `exit ${info.exitCode ?? '?'}`
}

/**
 * The card's IDENTITY line.
 *
 * ⚠ A NAMED SESSION READS `Claude Code - Bob` AND DELIBERATELY DROPS THE OSC
 * TITLE. That title is the agent's own — a cwd basename for Codex, whatever the
 * TUI last printed for Claude — and it is precisely what made a rail of eight
 * panes unreadable: same agent, same repo, same string, eight times. A name the
 * user chose is worth more here than a string the agent chose, so when one
 * exists it wins outright rather than being appended to a line already full.
 *
 * An UNNAMED session is unchanged from before names existed: the OSC title,
 * falling back to the agent's label — never a dash, which is the placeholder
 * D76 rules out everywhere else.
 */
function titleFor(id: string): string {
  const info = infoFor(id)
  const agent = props.agentFor(id)
  const agentLabel = agent ? labels[agent] : null
  if (info?.name) return agentLabel ? `${agentLabel} - ${info.name}` : info.name
  if (info?.title) return info.title
  return agentLabel ?? 'Unknown session'
}

/** The authored note, or null. Its row is OMITTED when there is none rather
 *  than rendered empty — an unnamed, undescribed session keeps exactly the
 *  three-row card it has always had. */
function noteFor(id: string): string | null {
  return infoFor(id)?.description ?? null
}
</script>

<template>
  <div class="filmstrip">
    <!-- Centre column: the focused pane, inset from the shell the way the mock
         insets it (12px on three sides; the rail supplies the fourth). -->
    <div class="filmstrip-main">
      <div class="pane-frame">
        <!-- Keyed by session id so a focus swap is a clean remount (F5): the old
             pane's cleanup runs, the hidden PTY keeps running in main, and the
             next attach replays its buffer. -->
        <TerminalPane
          v-if="agentFor(focusedSessionId)"
          :key="focusedSessionId"
          :session-id="focusedSessionId"
          :agent="(agentFor(focusedSessionId) as AgentKind)"
          @split="(target) => emit('split', target)"
          @focus="(id) => emit('focus', id)"
        />
        <div v-else class="pane-missing">Session no longer exists</div>
      </div>
    </div>

    <!-- Right rail. Hidden with no cards rather than holding 276px of empty
         column — the pre-3c behaviour, kept. -->
    <div v-if="cardIds.length > 0" class="filmstrip-rail">
      <div class="rail-head">
        <span class="rail-eyebrow">FILMSTRIP</span>
        <span class="rail-count">{{ cardIds.length }}</span>
      </div>

      <!-- ⚠ `data-pulse` IS THE MOCK'S OWN HOOK, and this is its first caller
           (3c-3 shipped the keyframes with none — D78). It is bound to the
           attribute rather than to a class so the reduced-motion rule in
           main.css — which resolves the pulse to its BRIGHT END HELD STATIC,
           not to nothing — keeps applying without a second selector. -->
      <button
        v-for="id in cardIds"
        :key="id"
        type="button"
        class="card"
        :class="`card-${stateFor(id) ?? 'unknown'}`"
        :data-pulse="stateFor(id) === 'needs-you' ? '' : undefined"
        @click="emit('focus', id)"
      >
        <span class="card-row">
          <span class="card-tile">{{ agentFor(id) ? codes[agentFor(id) as AgentKind] : '??' }}</span>
          <span class="card-title" :title="titleFor(id)">{{ titleFor(id) }}</span>
          <StateMarker
            v-if="stateFor(id)"
            :state="(stateFor(id) as 'needs-you' | 'running' | 'error' | 'done')"
          />
        </span>
        <!-- The authored note, above the status line: it says WHAT this agent
             is for, which outranks how it is doing. Absent when unset. -->
        <span v-if="noteFor(id)" class="card-note" :title="noteFor(id) ?? undefined">
          {{ noteFor(id) }}
        </span>
        <span class="card-status">{{ statusLine(id) }}</span>
        <!-- Row 3 is elapsed ONLY. The mock puts a per-session cost on the
             right; no session row carries one (D76), so the slot is left empty
             for whichever phase adds per-session attribution. -->
        <span class="card-foot">{{ elapsed(id) }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.filmstrip {
  display: flex;
  height: 100%;
  min-height: 0;
  background: var(--color-surface-app);
}

.filmstrip-main {
  flex: 1;
  /* The horizontal twin of min-height: 0 — without it a long pane title
     refuses to ellipsize and shoves the rail off-screen. */
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 12px 0 12px 12px;
}

/* The pane's own surface: the mock frames the focused terminal as a rounded
   card outlined in periwinkle, and that outline is what marks it as the pane
   holding focus. */
.pane-frame {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--color-surface-inset);
  border: 1px solid color-mix(in srgb, var(--color-accent-periwinkle) 28%, transparent);
  border-radius: var(--radius-card);
  overflow: hidden;
}

.pane-missing {
  display: flex;
  height: 100%;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--color-text-tertiary);
  user-select: none;
}

.filmstrip-rail {
  width: 276px;
  flex: none;
  display: flex;
  flex-direction: column;
  padding: 12px;
  gap: 8px;
  overflow-y: auto;
  user-select: none;
}

.rail-head {
  flex: none;
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 0 2px;
  font-family: var(--font-mono);
  font-size: 9.5px;
}

.rail-eyebrow {
  letter-spacing: 0.18em;
  color: var(--color-text-eyebrow);
}

/* The mock also prints `ctrl+1…9` here. Chorus has no such binding, and a
   keycap for a shortcut that does nothing is an invented fact in the same
   family D76 forbids — omitted until the binding exists. */
.rail-count {
  color: var(--color-glyph-dim-high);
}

/* ⚠ min-height, NOT the fixed 88px this was. A described session carries a
   fourth row and a bare one still carries three, and pinning the height would
   either crush the note or leave a hole where one is absent. `flex: none` still
   keeps the rail from stretching cards to fill it. */
.card {
  min-height: 88px;
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 9px 11px;
  text-align: left;
  background: var(--color-surface-card);
  border: 1px solid color-mix(in srgb, var(--color-accent-periwinkle) 22%, transparent);
  border-radius: var(--radius-card);
  cursor: default;
}

.card:hover {
  background: var(--color-surface-card-hover);
}

.card-row {
  display: flex;
  align-items: center;
  gap: 7px;
}

.card-tile {
  width: 16px;
  height: 16px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-chip);
  background: var(--color-surface-badge);
  border: 1px solid var(--color-border-badge);
  font-family: var(--font-mono);
  font-size: 8.5px;
  color: var(--color-text-badge);
}

.card-title {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Prose, not machine output — so it takes the UI face while the status and
   elapsed rows below stay monospaced. That contrast is what stops the three
   lower rows reading as one undifferentiated block. */
.card-note {
  font-size: 11px;
  color: var(--color-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-status {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--color-text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-error .card-status {
  color: var(--color-state-error-text);
}

/* The one state allowed to interrupt. The border and the status line take the
   amber; the box-shadow is the mock's `chorusPulse`, driven by [data-pulse] on
   this same element. The 2.2s timing is the keyframes' own — declared once in
   main.css, never restated per surface. */
.card-needs-you {
  border-color: color-mix(in srgb, var(--color-state-attention) 55%, transparent);
  animation: chorusPulse 2.2s ease-in-out infinite;
}

.card-needs-you .card-status {
  color: var(--color-state-attention-text);
}

.card-foot {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--color-text-quiet);
}

/* Completed sessions recede: dimmer surfaces, a fainter outline, and the
   mock's .82 opacity over the whole card. */
.card-done {
  background: var(--color-surface-card-dim);
  border-color: color-mix(in srgb, var(--color-accent-periwinkle) 13%, transparent);
  opacity: 0.82;
}

.card-done:hover {
  background: var(--color-surface-card-hover-dim);
}

.card-done .card-tile {
  background: var(--color-surface-badge-dim);
  border-color: var(--color-border-dim);
  color: var(--color-text-muted);
}

.card-done .card-title {
  color: var(--color-text-secondary);
}

.card-done .card-note,
.card-done .card-status {
  color: var(--color-text-quiet);
}

.card-done .card-foot {
  color: var(--color-text-eyebrow);
}
</style>
