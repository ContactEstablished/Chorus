<script setup lang="ts">
import { computed } from 'vue'
import type { LayoutJson } from '../../../shared/layout'
import { collectSessionIds } from '../../../shared/layout'
import type { AgentKind, SessionContextUsage, SessionInfo } from '../../../shared/ipc'
import TerminalPane from './TerminalPane.vue'
import StateMarker from './StateMarker.vue'
import ContextRing from './ContextRing.vue'
import type { SplitTarget } from '../stores/layout'
// The card's ONE piece of live state. Everything else on a card comes from the
// `sessions` prop (the persisted rows) — see the prop's own note on why that
// is deliberately not the session store.
import { useSessionStore } from '../stores/session'
// The escalation ladder: one app-wide clock, and the pure functions that turn
// "when did this begin" into how loud it is allowed to be right now.
import {
  ageLabel,
  tierFor,
  useAttentionClock,
  type AttentionTier
} from '../composables/attentionTier'

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
  grok: 'Grok', // D165
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
  grok: 'gk', // D165
  kimi: 'km', // D86
  opencode: 'oc' // D90
}

const ids = computed(() => collectSessionIds(props.tree.root))
const cardIds = computed(() => ids.value.filter((id) => id !== props.focusedSessionId))

function infoFor(id: string): SessionInfo | undefined {
  return props.sessions.find((s) => s.id === id)
}

/**
 * ONE clock for every card, and now for every OTHER lit surface in the app too.
 *
 * ⚠ THIS REPLACES THIS COMPONENT'S OWN 60s INTERVAL rather than sitting beside
 * it, which is a deliberate consolidation. The escalation ladder needs 5s
 * granularity (its first rung is at 30s), so once a card subscribes to that,
 * a second 60s timer buys nothing but a second wakeup and a second source of
 * "what time is it" that can disagree with the first. `elapsed()` below reads
 * the faster ref and is unchanged in behaviour — its own output is quantised to
 * whole minutes, so ticking more often cannot make it say anything new.
 */
const now = useAttentionClock()

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
    return sessionStore.activity[id]?.activity === 'needs-you' ? 'needs-you' : 'running'
  }
  // ⚠ RED REQUIRES A RECORDED NON-ZERO CODE, never merely "not zero". A NULL
  // `exit_code` means the app tidied this session away at boot rather than
  // watched it fail (the five heal paths in `SessionManager.restore`), so
  // `exitCode !== 0` painted a crash triangle on every session that was simply
  // alive when you last quit. Same fix, same reason, as
  // `attentionRollup.classify` — which is where the long form of this note
  // lives, and which is the rail's half of the identical mistake.
  return typeof info.exitCode === 'number' && info.exitCode !== 0 ? 'error' : 'done'
}

/**
 * Which rung of the escalation ladder this card is on.
 *
 * ⚠ ONLY `needs-you` CLIMBS, and every other state returns `calm` — the flat,
 * motionless rung. `docs/design/v2/Chorus Needs Attention.html`: *"Reserve the
 * alert hue for the one state that blocks progress until a human acts. Errors
 * are red and patient; waiting is amber and impatient."* A red triangle that
 * also pulsed would put two things in motion competing for the same peripheral
 * glance, and would cost the pulse the one meaning it currently has: a human is
 * the thing standing between this agent and progress.
 *
 * Returns `calm` for a missing instant too, which cannot normally happen here
 * (a `needs-you` always arrives with its transition stamped) but must not be a
 * throw on a render path.
 */
function tierOf(id: string): AttentionTier {
  if (stateFor(id) !== 'needs-you') return 'calm'
  return tierFor(sessionStore.activity[id]?.since ?? null, now.value)
}

/** The wait, in words — shown from the `urgent` rung on, which is the mock's
 *  own escalation step ("wait timer turns amber"). Empty before that: a 12s
 *  wait does not need a number, it needs to be left alone in case it resolves. */
function waitLabel(id: string): string {
  const tier = tierOf(id)
  if (tier !== 'urgent' && tier !== 'stale') return ''
  return ageLabel(sessionStore.activity[id]?.since ?? null, now.value)
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
    const activity = sessionStore.activity[id]?.activity
    if (activity === 'needs-you') {
      // ⚠ THE COPY TAKES OVER WHERE THE MOTION STOPS. The mock's `20m+` rung is
      // *"pulse stops. A blinking light you've ignored for 20 minutes is noise;
      // the copy takes over instead"* — so the wait becomes words exactly as it
      // stops being movement, and the card never goes silent about it.
      const wait = waitLabel(id)
      return wait ? `needs you · ${wait}` : 'needs you'
    }
    return activity === 'working' ? 'working' : 'running'
  }
  // ⚠ `ended`, NOT `exit ?`. A NULL code is not an unknown failure — it is the
  // app having closed this session itself at boot, which is a fact worth saying
  // plainly rather than a question mark inviting the user to hunt for a crash
  // that never happened. The marker above now reads the same three ways.
  if (info.exitCode === null || info.exitCode === undefined) return 'ended'
  return info.exitCode === 0 ? 'done' : `exit ${info.exitCode}`
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

/**
 * v16: this session's context reading, or null when it has no source.
 *
 * ⚠ FROM THE SESSION STORE, NOT THE `sessions` PROP, WHICH INVERTS THIS
 * COMPONENT'S USUAL RULE AND IS CORRECT. The prop's own note says cards read
 * their metadata from the persisted rows "deliberately NOT the session store" —
 * but that rule is about facts that LIVE IN THE DATABASE. Context usage is
 * explicitly main's in-memory state and is never a column (see
 * `sessionContextListResponseSchema`), so the store is its only home here,
 * exactly as it already is for `activity` two functions above.
 *
 * ⚠ NULL IS RENDERED AS NOTHING. Not a zero ring, not a placeholder — see
 * ContextRing's header.
 */
function contextFor(id: string): SessionContextUsage | null {
  return sessionStore.context[id] ?? null
}

/**
 * v16: whether this agent is locked.
 *
 * ⚠ THIS ONE *IS* A ROW FACT, so it comes off the prop — the opposite of
 * `contextFor` directly above, and the two sitting side by side is the clearest
 * statement of the rule: durable column -> the `sessions` prop; live main-memory
 * fact -> the store. `locked` is a `sessions.locked_at` column, and a card
 * showing a stale padlock after a reload would be a lie about a durable fact.
 */
function lockedFor(id: string): boolean {
  return infoFor(id)?.locked ?? false
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
           not to nothing — keeps applying without a second selector.

           ⚠ IT IS NOW GATED ON THE TIER, NOT ON THE STATE, and that gate is
           what finally satisfies the design system's standing prohibition on
           motion that never resolves ("Pulse forever… is trained-out within a
           day"). A `needs-you` card pulses on the two MIDDLE rungs only: it is
           still and quiet for its first 30s (it may resolve itself) and still
           and quiet again past 20m (you have already decided to ignore it, and
           the status line takes the message over in words). `data-attn` carries
           the rung itself so the border and the amber text can escalate with
           it, without four more class bindings. -->
      <button
        v-for="id in cardIds"
        :key="id"
        type="button"
        class="card"
        :class="`card-${stateFor(id) ?? 'unknown'}`"
        :data-attn="stateFor(id) === 'needs-you' ? tierOf(id) : undefined"
        :data-pulse="
          tierOf(id) === 'pulse' || tierOf(id) === 'urgent' ? '' : undefined
        "
        @click="emit('focus', id)"
      >
        <span class="card-row">
          <span class="card-tile">{{ agentFor(id) ? codes[agentFor(id) as AgentKind] : '??' }}</span>
          <span class="card-title" :title="titleFor(id)">{{ titleFor(id) }}</span>
          <!-- v16: the padlock, NEXT TO THE NAME, which is where Matthew asked
               for it ("a little lock icon running near the name"). Read-only
               here — a card is a summary and the toggle lives in the pane
               header, so clicking the card still just focuses it. -->
          <svg
            v-if="lockedFor(id)"
            class="card-lock"
            width="9"
            height="10"
            viewBox="0 0 10 11"
            fill="none"
            stroke="currentColor"
            stroke-width="1.1"
            :aria-label="`${titleFor(id)} is locked`"
            role="img"
          >
            <rect x="1.2" y="4.6" width="7.6" height="5.7" rx="1.1" />
            <path d="M3.1 4.6V3.1a1.9 1.9 0 0 1 3.8 0v1.5" />
          </svg>
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
        <!-- Row 3: elapsed on the left, and — v16 — the context ring on the
             right, in the slot the mock draws a per-session cost in.
             ⚠ THAT SLOT WAS RESERVED FOR COST AND IS BEING SPENT ON SOMETHING
             ELSE, deliberately. It was left empty because no session row
             carries a cost (D76); the ring now has a real source, and a
             measured number beats a reserved space for an unmeasured one. Cost
             lands beside it when per-session attribution exists — the row is a
             flex pair, so a third member costs no layout change.
             ⚠ ABSENT, NOT ZEROED, for an agent with no source. -->
        <span class="card-foot">
          <span class="card-elapsed">{{ elapsed(id) }}</span>
          <ContextRing v-if="contextFor(id)" :usage="(contextFor(id) as SessionContextUsage)" />
        </span>
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
/* ── needs-you, and its four rungs ────────────────────────────────────────
   `docs/design/v2/Chorus Needs Attention.html`, panel D · ESCALATION OVER TIME.

   ⚠ THE PULSE MOVED OFF `.card-needs-you` AND ONTO THE RUNG, which is the
   substantive change here. It used to run for as long as the state held —
   which is precisely the thing the same document forbids in its DON'T list
   ("Pulse forever. Motion that never resolves is trained-out within a day").
   The state still owns the colour; only the TIER owns the motion. */
.card-needs-you {
  border-color: color-mix(in srgb, var(--color-state-attention) 40%, transparent);
}

.card-needs-you .card-status {
  color: var(--color-state-attention-text);
}

/* 0–30s: "token appears, no pulse. It may resolve itself." The amber diamond
   and a faint edge, and nothing that moves — an agent that stops for four
   seconds mid-turn must never have flashed at you. */
.card[data-attn='calm'] {
  animation: none;
}

/* 30s–5m: "pulse begins, card border lifts." */
.card[data-attn='pulse'] {
  border-color: color-mix(in srgb, var(--color-state-attention) 55%, transparent);
  animation: chorusPulse 2.2s ease-in-out infinite;
}

/* 5m–20m: the peak. Same 2.2s cycle — the mock's `attn.cycle`, "slower than a
   heartbeat, faster than a breath" — over a brighter resting edge. The wait
   also becomes a number in the status line from this rung (see `waitLabel`). */
.card[data-attn='urgent'] {
  border-color: color-mix(in srgb, var(--color-state-attention) 75%, transparent);
  animation: chorusPulse 2.2s ease-in-out infinite;
}

/* 20m+: "pulse stops… the copy takes over instead." Held at a static bright
   edge rather than dropped to nothing: the item has not become less true, it
   has stopped being something motion can help with. */
.card[data-attn='stale'] {
  border-color: color-mix(in srgb, var(--color-state-attention) 60%, transparent);
  animation: none;
  box-shadow:
    0 0 0 1px rgb(245 158 11 / 0.5),
    0 0 12px rgb(245 158 11 / 0.12);
}

/* ⚠ Now a FLEX ROW rather than a bare text node (v16): elapsed left, ring
   right. `space-between` rather than a spacer span so a card with no ring
   renders byte-identically to the pre-v16 one — the single child simply sits at
   the start, exactly where it always has. */
.card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--color-text-quiet);
}

.card-elapsed {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The padlock rides the title's colour, one step down, so it reads as an
   attribute OF the name rather than as a fifth status indicator competing with
   the state marker beside it. */
.card-lock {
  flex: none;
  color: var(--color-text-tertiary);
}

.card-done .card-lock {
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
