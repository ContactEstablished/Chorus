<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useCouncilStore } from '../stores/council'
import StateMarker from '../components/StateMarker.vue'

/**
 * Council view (Task 3b-4 / D64(1)): brief `.md` in, deliberation on screen,
 * findings `.md` out beside the brief. A VIEW/ROUTE on the `SettingsView`
 * precedent, deliberately NOT a layout pane — D45(3)'s versioned layout-schema
 * change stays entirely out of this phase.
 *
 * Three rendering rules here are not styling (spec §4):
 *  1. every byte of the live deliberation arrived through main's ONE scrub seam
 *     (`SessionOutput.onText`); this component is given no other channel;
 *  2. a partial run READS as partial — the roster says who could not take part
 *     and the accounting says how many actually answered;
 *  3. findings are presented as DELIBERATION, not as verification. CR-3b.0's
 *     four compile errors are the standing evidence for why.
 */
const props = defineProps<{ overlayOpen: boolean; projectId: string | null }>()
const emit = defineEmits<{ close: [] }>()

const council = useCouncilStore()

/**
 * ⚠ THE ONLY SENTENCE THIS FEATURE MAY SHIP ABOUT REDACTION (F27, and
 * `Task-3b-4.md` quotes it verbatim). It is bounded on purpose: the pre-pass
 * matches KNOWN SHAPES from `secret-patterns.json` and cannot recognise a
 * credential that looks like prose. "Your brief is safe" is the claim this
 * wording exists to refuse.
 */
const REDACTION_WORDING =
  'Chorus redacts registered exact values on ingest and scans briefs for known credential shapes. ' +
  'It cannot redact values an agent derives, and it cannot recognize a secret it has no pattern for.'

// F13 (de98679): the view can unmount while the roster load is in flight. The
// flag is set BEFORE the first await and checked after it; the Esc listener and
// the progress subscription get the same discipline — registered on mount,
// released on unmount, never leaked.
let alive = true
onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  council.subscribe()
  await council.loadMembers()
  if (!alive) return
})
onBeforeUnmount(() => {
  alive = false
  window.removeEventListener('keydown', onKeydown)
  council.unsubscribe()
})

function onKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  // An overlay above the view owns Esc first (the SettingsView rule). A run in
  // flight also owns it: leaving mid-deliberation would strand a paid-for run
  // with nowhere to render.
  if (props.overlayOpen || council.running) return
  emit('close')
}

const briefName = computed<string>(() => {
  const path = council.briefPath
  if (!path) return ''
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] ?? path
})

const canRun = computed<boolean>(
  () => !council.running && council.briefPath !== null && council.deliberators.length >= 2 && council.arbiters.length === 1
)

const labelFor = (memberId: string | null): string => {
  if (memberId === null) return 'orchestrator'
  return council.members.find((m) => m.id === memberId)?.label ?? memberId
}

const PHASE_LABEL: Record<string, string> = {
  positions: 'Positions (blind)',
  critique: 'Critique (anonymised)',
  arbitration: 'Arbitration',
  synthesis: 'Synthesis',
  done: 'Done'
}

/**
 * The five-stop phase track (3c-5, ImplementationSpec §1a). Discrete stops with
 * a round counter, NOT a progress bar — the mock's own sample transcript argues
 * the reason and it is worth keeping: a bar implies a rate that cannot honestly
 * be estimated over a ~14-minute run.
 *
 * The qualifier under each stop is the mock's; the long PHASE_LABEL above stays
 * the transcript's vocabulary so the two surfaces do not disagree.
 */
const PHASE_STOPS = [
  { key: 'positions', num: '01', label: 'Positions', qualifier: 'blind', flex: 1.2 },
  { key: 'critique', num: '02', label: 'Critique', qualifier: 'anonymised', flex: 1.2 },
  { key: 'arbitration', num: '03', label: 'Arbitration', qualifier: null, flex: 1 },
  { key: 'synthesis', num: '04', label: 'Synthesis', qualifier: null, flex: 1 },
  { key: 'done', num: '05', label: 'Done', qualifier: null, flex: 0.62 }
] as const

/** -1 before a run starts, so every stop reads pending. */
const phaseIndex = computed<number>(() =>
  council.phase === null ? -1 : PHASE_STOPS.findIndex((s) => s.key === council.phase)
)

function stopState(i: number): 'done' | 'active' | 'pending' {
  if (phaseIndex.value < 0) return 'pending'
  if (i < phaseIndex.value) return 'done'
  return i === phaseIndex.value ? 'active' : 'pending'
}

/**
 * ⚠ D76, AND THIS IS THE PLACE IT BINDS HARDEST IN THIS TASK. The mock's phase
 * header also renders `elapsed 4:38`, `est. remaining ~9m`, `round 1 of 2` and
 * `$0.31 so far`. NONE of the four has a source:
 *   - the store carries no run start time, and adding one is store logic, which
 *     this task may not touch;
 *   - an estimate is the dishonest number the five-stop track exists to refuse;
 *   - the renderer is never told how many rounds are planned, only which round
 *     it is in — so "of 2" would be invented;
 *   - `costUsd` arrives with the accounting at the END of a run, so there is no
 *     "so far" figure to show while one is in flight.
 * What ships is the round ordinal alone, and only once a run has reported one.
 * Render what the data supports; omit the rest; never a placeholder.
 */
const roundLabel = computed<string | null>(() =>
  council.round === null ? null : `round ${council.round}`
)

/**
 * Per-member roster state during a run. Honest by construction: "answering"
 * means this member has produced output in the CURRENT phase and round, which
 * is exactly what the roster is reporting. The store carries no turn-closed
 * signal, so nothing here claims a turn finished.
 *
 * ⚠ 'queued' is NOT a StateMarker state and must not become one. StateMarker's
 * four geometries are the SESSION vocabulary (D77/D78); a waiting council turn
 * is a different kind of thing, and adding a fifth shape there would change a
 * contract the workspace depends on. It renders as the mock's own hollow ring,
 * defined locally below.
 */
function memberState(memberId: string): 'error' | 'running' | 'done' | 'queued' {
  const m = council.members.find((x) => x.id === memberId)
  if (m && !m.available) return 'error'
  if (council.phase === null) return 'queued'
  const spoke = council.messages.some(
    (msg) => msg.memberId === memberId && msg.phase === council.phase && msg.round === council.round
  )
  if (!council.running) return spoke || council.findings !== null ? 'done' : 'queued'
  return spoke ? 'running' : 'queued'
}

/**
 * The same state narrowed to what `StateMarker` accepts, or null for 'queued'.
 * Kept as its own function rather than a cast in the template: the null is the
 * point — it is what says "this state has no marker" out loud, instead of a
 * cast quietly asserting that 'queued' can never arrive.
 */
function markerFor(memberId: string): 'error' | 'running' | 'done' | null {
  const state = memberState(memberId)
  return state === 'queued' ? null : state
}

/**
 * The roster's 2px spine, cycled by position. Four tokens exist and the mock
 * uses exactly these four, in this order, for its four roster cards.
 */
const SPINES = [
  'var(--color-accent-periwinkle)',
  'var(--color-spine-blue)',
  'var(--color-spine-sand)',
  'var(--color-spine-violet)'
] as const

function spineFor(i: number): string {
  return SPINES[i % SPINES.length]
}
</script>

<template>
  <div class="flex h-full">
    <!-- roster -->
    <nav class="cn-rail">
      <div class="cn-rail-head">
        <span class="cn-eyebrow">COUNCIL</span>
        <span class="flex-1"></span>
        <span v-if="council.members.length > 0" class="cn-meta">
          {{ council.members.length }}
        </span>
      </div>

      <!-- ⚠ NO MEMBERS: the mock's own empty state — the dimmed chorus glyph
           over a sentence that says where to go. -->
      <div v-if="council.members.length === 0" class="cn-empty">
        <div class="cn-glyph">
          <span v-for="(h, i) in [9, 15, 21, 26, 21, 15, 9]" :key="i" :style="{ height: `${h}px` }" />
        </div>
        <p class="cn-empty-text">
          No council members are configured. Add some in Settings first.
        </p>
      </div>

      <div class="cn-roster">
        <div
          v-for="(m, i) in council.members"
          :key="m.id"
          class="cn-member"
          :class="{ 'cn-member-live': memberState(m.id) === 'running', 'cn-member-done': memberState(m.id) === 'done' }"
          :data-council-member-state="memberState(m.id)"
        >
          <div class="cn-spine" :style="{ background: spineFor(i) }"></div>
          <div class="flex items-center gap-2">
            <span class="cn-member-name truncate">{{ m.label }}</span>
            <span class="flex-1"></span>
            <!-- Per-member state is a STABLE marker, never a spinner: motion
                 lives in the phase track (ImplementationSpec-3c-5 §1a). -->
            <StateMarker v-if="markerFor(m.id)" :state="markerFor(m.id)!" />
            <span v-else class="cn-marker-queued"></span>
          </div>
          <div class="cn-member-sub">
            <span class="cn-role">{{ m.role }}</span>
            <span class="cn-member-model truncate">{{ m.resolvedModel ?? 'no model resolved' }}</span>
          </div>
          <!-- ⚠ A member that cannot deliberate is SHOWN AND EXPLAINED, never
               quietly dropped: assembly refuses the whole run over it, and a
               roster that hid it would make that refusal unreadable. -->
          <div v-if="!m.available" class="cn-member-refused">
            {{ m.unavailableReason ?? 'unavailable' }}
          </div>
        </div>
      </div>

      <!-- The roster legend: the marker vocabulary, readable without prior
           knowledge (ImplementationSpec-3c-5 §1a). -->
      <div v-if="council.members.length > 0" class="cn-legend">
        <span class="cn-legend-item"><span class="cn-marker-queued"></span>queued</span>
        <span class="cn-legend-item"><StateMarker state="running" />answering</span>
        <span class="cn-legend-item"><StateMarker state="done" />done</span>
        <span class="cn-legend-item"><StateMarker state="error" />refused</span>
      </div>

      <div v-if="council.members.length > 0" class="cn-roster-summary">
        {{ council.deliberators.length }} deliberator{{ council.deliberators.length === 1 ? '' : 's' }}
        · {{ council.arbiters.length }} arbiter{{ council.arbiters.length === 1 ? '' : 's' }}
      </div>

      <div class="flex-1"></div>
      <button class="cn-back" :disabled="council.running" @click="emit('close')">
        back to workspace
        <span class="flex-1"></span>
        <span class="cn-keycap">esc</span>
      </button>
    </nav>

    <!-- run surface -->
    <div class="cn-main">
      <h1 class="cn-title">Council review</h1>
      <p class="cn-lede">
        Point Chorus at a brief. Every member answers its numbered questions blind, critiques the
        others anonymised, and the arbiter rules and synthesizes. The findings land as a
        <code class="cn-code">-Findings.md</code> file beside the brief.
      </p>

      <!-- brief picker -->
      <div class="mt-4 flex items-center gap-3">
        <button
          class="cn-btn"
          :disabled="council.running"
          data-testid="council-choose-brief"
          @click="council.pickBrief()"
        >
          Choose brief…
        </button>
        <span v-if="briefName" class="cn-brief" :title="council.briefPath ?? ''">{{ briefName }}</span>
        <span v-else class="cn-meta">no brief chosen</span>

        <span class="flex-1"></span>

        <button
          v-if="council.running"
          class="cn-btn"
          :disabled="council.runId === null"
          @click="council.cancel()"
        >
          Cancel run
        </button>
        <button
          v-else
          class="cn-btn cn-btn-primary"
          :disabled="!canRun"
          data-testid="council-run"
          @click="council.run(props.projectId)"
        >
          Run council
        </button>
      </div>

      <!-- ⚠ F27, verbatim and unabridged. This is the first surface a user reads
           a redaction claim on, and the claim is deliberately bounded. -->
      <p class="cn-redaction">{{ REDACTION_WORDING }}</p>

      <p v-if="council.error" class="cn-error">{{ council.error }}</p>

      <!-- ══ the five-stop phase track ══
           Rendered once a run has reported a phase. Discrete stops, an explicit
           round ordinal, and NO progress bar — see PHASE_STOPS above. -->
      <div v-if="council.phase !== null" class="cn-phases" data-council-phase-track>
        <div class="flex items-center gap-2.5">
          <span class="cn-eyebrow">PHASE</span>
          <span v-if="roundLabel" class="cn-meta cn-meta-bright">{{ roundLabel }}</span>
          <span class="cn-meta">{{ PHASE_LABEL[council.phase] ?? council.phase }}</span>
        </div>
        <div class="cn-track">
          <div
            v-for="(stop, i) in PHASE_STOPS"
            :key="stop.key"
            class="cn-stop"
            :style="{ flex: stop.flex }"
            :data-council-stop="stop.key"
            :data-council-stop-state="stopState(i)"
          >
            <div class="cn-stop-bar" :class="`cn-stop-bar-${stopState(i)}`" data-slide></div>
            <div class="flex items-center gap-1.5">
              <span class="cn-stop-num" :class="`cn-stop-${stopState(i)}`">{{ stop.num }}</span>
              <span class="cn-stop-label" :class="`cn-stop-${stopState(i)}`">
                {{ stop.label }}
                <span v-if="stop.qualifier" class="cn-stop-qualifier">{{ stop.qualifier }}</span>
              </span>
              <span class="flex-1"></span>
              <span v-if="stopState(i) === 'done'" class="cn-stop-status">done</span>
            </div>
          </div>
        </div>
      </div>

      <!-- live deliberation -->
      <section v-if="council.messages.length > 0" class="mt-5">
        <div class="flex items-center gap-2.5">
          <span class="cn-eyebrow">TRANSCRIPT</span>
          <span class="cn-meta">
            {{ council.messages.length }} turn{{ council.messages.length === 1 ? '' : 's' }} so far
          </span>
        </div>
        <div class="mt-2 flex flex-col gap-2">
          <article v-for="(msg, i) in council.messages" :key="i" class="cn-turn">
            <div class="cn-turn-head">
              <span class="cn-turn-who">{{ labelFor(msg.memberId) }}</span>
              <span class="cn-turn-meta">
                {{ PHASE_LABEL[msg.phase] ?? msg.phase }} · round {{ msg.round }}
              </span>
            </div>
            <pre class="cn-turn-body">{{ msg.text }}</pre>
          </article>

          <!-- ⚠ REFUSED TURNS ARE ROWS, NOT GAPS (Task-3c-5 invariant 3, as the
               mock extends it). A member that is unavailable contributed
               nothing to this run and says so here as well as in the roster —
               a council that quietly shrinks cannot be audited afterwards. -->
          <div
            v-for="m in council.unavailable"
            :key="`refused-${m.id}`"
            class="cn-turn cn-turn-refused"
            data-council-refused-row
          >
            <div class="cn-turn-head">
              <span class="cn-turn-who">{{ m.label }}</span>
              <span class="cn-turn-refused-tag">refused · no output</span>
            </div>
            <div class="cn-turn-refused-why">
              {{ m.unavailableReason ?? 'unavailable' }} · this member contributed nothing and is
              counted as refused, not answered
            </div>
          </div>

          <!-- next-up placeholder, so a waiting round reads as waiting rather
               than as finished. -->
          <div v-if="council.running" class="cn-nextup" data-council-nextup>
            <span class="cn-marker-queued"></span>
            <span class="flex-1">waiting for the rest of this round to close</span>
            <span class="cn-stop-status">queued</span>
          </div>
        </div>
      </section>

      <!-- findings -->
      <section v-if="council.findings" class="cn-result">
        <!-- findings document -->
        <div class="cn-panel min-w-0 flex-1">
          <div class="cn-panel-head">
            <span class="cn-eyebrow">FINDINGS</span>
            <span class="flex-1"></span>
            <span v-if="council.findingsPath" class="cn-meta truncate" :title="council.findingsPath">
              written beside the brief
            </span>
          </div>
          <div class="cn-panel-body">
            <!-- ⚠ SPEC §4.3 / §3.2: presented as DELIBERATION, not as
                 verification, and this caveat sits ABOVE the synthesis,
                 unconditionally and undismissibly. CR-3b.0 produced sound
                 rulings containing four compile errors; this is the mechanism
                 that keeps that visible. -->
            <p class="cn-caveat">
              These findings are model deliberation, not verified fact. Nothing here was compiled, run or
              tested, and no member could see the repository.
            </p>

            <p v-if="council.findingsPath" class="cn-meta mt-2 break-all">
              Written to <span class="cn-meta-bright">{{ council.findingsPath }}</span>
            </p>
            <p v-else-if="council.findingsError" class="cn-error mt-2">{{ council.findingsError }}</p>

            <pre class="cn-findings">{{ council.findings }}</pre>
          </div>
        </div>

        <!-- ⚠ D55 ONE LAYER UP: no number without its denominator. A cost or a
             token count rendered alone is the same defect the schema already
             forbids on the wire. -->
        <div v-if="council.accounting" class="cn-panel cn-accounting">
          <div class="cn-panel-head">
            <span class="cn-eyebrow">ACCOUNTING</span>
            <span class="flex-1"></span>
            <span class="cn-denominator-note">every figure carries its denominator</span>
          </div>
          <div class="cn-acct-body">
            <div class="cn-acct-group">
              <span class="cn-acct-label">MEMBERS</span>
              <span class="cn-acct-figure">
                {{ council.accounting.membersAnswered }} answered
                <span class="cn-acct-of">of</span> {{ council.accounting.membersPlanned }} planned
              </span>
              <span v-if="council.accounting.membersRefused > 0" class="cn-acct-sub cn-acct-sub-bad">
                {{ council.accounting.membersRefused }} refused at least once
              </span>
            </div>

            <div class="cn-acct-rule"></div>

            <div class="cn-acct-group">
              <span class="cn-acct-label">TURNS</span>
              <span class="cn-acct-figure">
                {{ council.accounting.turnsAnswered }} answered
                <span class="cn-acct-of">·</span> {{ council.accounting.turnsRefused }} refused
              </span>
              <span class="cn-acct-sub">
                {{ council.accounting.turnsAnswered + council.accounting.turnsRefused }} attempted in
                total
              </span>
            </div>

            <div class="cn-acct-rule"></div>

            <div class="cn-acct-group">
              <span class="cn-acct-label">USAGE COVERAGE</span>
              <span class="cn-acct-figure">
                reported for {{ council.accounting.usageReported }}
                <span class="cn-acct-of">of</span>
                {{ council.accounting.usageReported + council.accounting.usageAbsent }} turns
              </span>
              <span class="cn-acct-sub">
                absent for {{ council.accounting.usageAbsent }} of
                {{ council.accounting.usageReported + council.accounting.usageAbsent }} turns
              </span>
              <div class="cn-coverage">
                <span
                  class="cn-coverage-on"
                  :style="{ flex: council.accounting.usageReported || 0.0001 }"
                ></span>
                <span
                  v-if="council.accounting.usageAbsent > 0"
                  class="cn-coverage-off"
                  :style="{ flex: council.accounting.usageAbsent }"
                ></span>
              </div>
            </div>

            <div class="cn-acct-rule"></div>

            <div class="cn-acct-group">
              <span class="cn-acct-label">TOKENS</span>
              <span class="cn-acct-figure">
                <template
                  v-if="council.accounting.tokensIn === null && council.accounting.tokensOut === null"
                >
                  not reported
                </template>
                <template v-else>
                  {{ council.accounting.tokensIn ?? 'n/r' }} in
                  <span class="cn-acct-of">·</span> {{ council.accounting.tokensOut ?? 'n/r' }} out
                </template>
              </span>
              <span class="cn-acct-sub">
                covers the {{ council.accounting.usageReported }} of
                {{ council.accounting.usageReported + council.accounting.usageAbsent }} turns that
                reported usage
              </span>
            </div>

            <div class="cn-acct-rule"></div>

            <div class="cn-acct-group">
              <span class="cn-acct-label">COST</span>
              <span class="cn-acct-cost">
                <template v-if="council.costUsd === null">not reported</template>
                <template v-else>${{ council.costUsd }}</template>
              </span>
              <!-- ⚠ F39 MADE VISIBLE, and the clause is CONDITIONAL because it
                   is a fact, not a disclaimer: when every turn reported usage
                   the figure IS the total, and saying otherwise would be its
                   own dishonesty. -->
              <span class="cn-acct-sub">
                covers {{ council.accounting.usageReported }} of
                {{ council.accounting.usageReported + council.accounting.usageAbsent }} turns<template
                  v-if="council.accounting.usageAbsent > 0"
                >
                  · {{ council.accounting.usageAbsent }} turns
                  <span class="cn-acct-sub-bright">not reported by the provider</span> · true total is
                  at least this</template
                >
              </span>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
/* ═══════════════════════════════════════════════════════════════════════════
   Council view — Task 3c-5, against docs/design/v2/Chorus Council.dc.html.

   Every value is a 3c-1 token. The three the council mock introduced
   (--color-spine-blue, --color-glyph-dim-mid, --color-glyph-dim-high) were
   already added by 3c-1 ahead of this task, per ImplementationSpec-3c-5 §1b.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── Roster rail ─────────────────────────────────────────────────────────
   208px, same width and surface as the project rail and the settings nav —
   the mock draws one rail in three contexts, not three rails. */
.cn-rail {
  width: 208px;
  flex: none;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  background: var(--color-surface-rail);
  border-right: 1px solid var(--color-border-chrome);
  padding: 10px 8px 8px;
}

.cn-rail-head {
  display: flex;
  align-items: center;
  padding: 0 4px 8px;
}

.cn-eyebrow {
  flex: none;
  font-family: var(--font-mono);
  font-size: 9.5px;
  letter-spacing: 0.18em;
  color: var(--color-text-eyebrow);
  user-select: none;
}

.cn-meta {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--color-text-quiet);
}

.cn-meta-bright {
  color: var(--color-text-muted);
}

/* ── "no members configured" — the mock's own empty state ───────────────── */
.cn-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 28px 8px;
}

/* The chorus mark at rest, in the dimmed tones the mock uses for it. The
   centre bar keeps the jade so the glyph is still recognisably the app's. */
.cn-glyph {
  display: flex;
  align-items: center;
  gap: 3px;
  opacity: 0.5;
}

.cn-glyph span {
  width: 3px;
  border-radius: var(--radius-bar);
  background: var(--color-glyph-dim-high);
}

.cn-glyph span:nth-child(1),
.cn-glyph span:nth-child(7) {
  background: var(--color-glyph-dim-low);
}

.cn-glyph span:nth-child(2),
.cn-glyph span:nth-child(6) {
  background: var(--color-glyph-dim-mid);
}

.cn-glyph span:nth-child(4) {
  background: var(--color-accent-jade);
}

.cn-empty-text {
  font-size: 11.5px;
  line-height: 1.5;
  text-align: center;
  color: var(--color-text-quiet);
}

/* ── Member cards ────────────────────────────────────────────────────────
   Left padding is 14px, not 10px: the 2px spine sits in that gutter. */
.cn-roster {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.cn-member {
  position: relative;
  background: var(--color-surface-card);
  border: 1px solid var(--color-border-inset);
  border-radius: var(--radius-rail);
  padding: 9px 10px 9px 14px;
}

/* A member currently producing output takes the running border; a member whose
   turn is behind it dims, exactly as the mock draws them. Neither animates —
   motion lives in the phase track. */
.cn-member-live {
  background: var(--color-surface-card-hover);
  border-color: color-mix(in srgb, var(--color-state-running) 28%, transparent);
}

.cn-member-done {
  opacity: 0.82;
}

.cn-spine {
  position: absolute;
  left: 0;
  top: 8px;
  bottom: 8px;
  width: 2px;
  border-radius: 1px;
}

.cn-member-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-primary);
}

.cn-member-sub {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 3px;
  min-width: 0;
}

.cn-role {
  flex: none;
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-eyebrow);
}

.cn-member-model {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--color-text-quiet);
}

.cn-member-refused {
  margin-top: 5px;
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 1.5;
  color: var(--color-state-error-text);
}

/* NOT a StateMarker state — see memberState()'s comment. The mock's hollow
   ring for a turn that has not begun. */
.cn-marker-queued {
  width: 8px;
  height: 8px;
  flex: none;
  border-radius: 50%;
  border: 1.5px solid var(--color-text-eyebrow);
}

/* ── Legend ──────────────────────────────────────────────────────────────
   So the marker vocabulary is readable without prior knowledge. */
.cn-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  padding: 10px 4px 6px;
}

.cn-legend-item {
  display: flex;
  align-items: center;
  gap: 5px;
  font-family: var(--font-mono);
  font-size: 9px;
  color: var(--color-text-eyebrow);
}

.cn-roster-summary {
  padding: 4px 4px 0;
  font-family: var(--font-mono);
  font-size: 9.5px;
  line-height: 1.6;
  color: var(--color-text-eyebrow);
}

.cn-back {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 6px;
  border: 0;
  background: transparent;
  font-size: 12px;
  color: var(--color-text-quiet);
  cursor: default;
}

.cn-back:hover:not(:disabled) {
  color: var(--color-text-secondary);
}

.cn-back:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* Matched to the status bar's and overlays.css's keycap, not re-derived. */
.cn-keycap {
  flex: none;
  font-family: var(--font-mono);
  font-size: 9.5px;
  border: 1px solid var(--color-border-divider);
  background: var(--color-surface-keycap);
  border-radius: var(--radius-chip);
  padding: 1px 5px;
  color: var(--color-text-quiet);
}

/* ── Main column ───────────────────────────────────────────────────────── */
.cn-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 22px 32px;
}

.cn-title {
  flex: none;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.cn-lede {
  flex: none;
  max-width: 46rem;
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-text-secondary);
}

.cn-code {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-text-body);
}

.cn-btn {
  flex: none;
  border: 1px solid var(--color-border-badge);
  background: var(--color-surface-field);
  border-radius: var(--radius-rail);
  padding: 6px 12px;
  font-size: 11.5px;
  color: var(--color-text-secondary);
  cursor: default;
}

.cn-btn:hover:not(:disabled) {
  border-color: var(--color-logo-bar-low);
  color: var(--color-text-body);
}

.cn-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.cn-btn-primary {
  border-color: color-mix(in srgb, var(--color-accent-jade) 40%, transparent);
  background: color-mix(in srgb, var(--color-accent-jade) 7%, transparent);
  color: var(--color-accent-jade);
}

.cn-btn-primary:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--color-accent-jade) 40%, transparent);
  background: color-mix(in srgb, var(--color-accent-jade) 14%, transparent);
  color: var(--color-accent-jade);
}

.cn-brief {
  min-width: 0;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-text-body);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* F27's sentence. Quiet, but never small enough to be skipped. */
.cn-redaction {
  flex: none;
  max-width: 46rem;
  margin-top: 12px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--color-text-eyebrow);
}

.cn-error {
  flex: none;
  max-width: 46rem;
  margin-top: 14px;
  border: 1px solid color-mix(in srgb, var(--color-state-error) 35%, transparent);
  background: color-mix(in srgb, var(--color-state-error) 8%, transparent);
  border-radius: var(--radius-rail);
  padding: 8px 12px;
  font-size: 11.5px;
  color: var(--color-state-error-text);
}

/* ── The five-stop phase track ───────────────────────────────────────────── */
.cn-phases {
  flex: none;
  margin-top: 18px;
  background: var(--color-surface-card);
  border: 1px solid var(--color-border-inset);
  border-radius: var(--radius-card);
  padding: 11px 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.cn-track {
  display: flex;
  align-items: stretch;
  gap: 6px;
}

.cn-stop {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.cn-stop-bar {
  height: 4px;
  border-radius: var(--radius-bar);
}

.cn-stop-bar-pending {
  background: var(--color-border-inset);
}

.cn-stop-bar-done {
  background: color-mix(in srgb, var(--color-accent-jade) 55%, transparent);
}

/* ⚠ THE ONLY ANIMATION IN THIS VIEW, AND THAT IS THE DESIGN RULING. The mock
   puts the motion here rather than on four per-member spinners, because the
   user is waiting on the round, not on any single voice. The stripe travels
   22px, which is one full period of the gradient. */
.cn-stop-bar-active {
  background-image: linear-gradient(
    100deg,
    var(--color-accent-jade) 0 11px,
    color-mix(in srgb, var(--color-accent-jade) 45%, transparent) 11px 22px
  );
  background-size: 22px 100%;
  animation: phaseSlide 1.1s linear infinite;
}

@keyframes phaseSlide {
  0% {
    background-position: 0 0;
  }
  100% {
    background-position: 22px 0;
  }
}

/* The reduced-motion resolution is the BRIGHT end held static, matching the
   rule 3c-1 wrote for chorusPulse: a user who cannot tolerate motion must not
   also lose the signal. */
@media (prefers-reduced-motion: reduce) {
  .cn-stop-bar-active {
    animation: none;
    background-image: none;
    background-color: var(--color-accent-jade);
  }
}

.cn-stop-num {
  flex: none;
  font-family: var(--font-mono);
  font-size: 9.5px;
}

.cn-stop-label {
  min-width: 0;
  font-size: 11.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cn-stop-pending {
  color: var(--color-text-eyebrow);
}

.cn-stop-done {
  color: var(--color-text-secondary);
}

.cn-stop-active {
  color: var(--color-text-primary);
  font-weight: 600;
}

.cn-stop-qualifier {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 400;
  color: var(--color-text-quiet);
}

.cn-stop-status {
  flex: none;
  font-family: var(--font-mono);
  font-size: 9.5px;
  color: var(--color-text-eyebrow);
}

/* ── Transcript ──────────────────────────────────────────────────────────
   ⚠ A block is keyed on (member, phase, round) BY THE STORE — F37's fix, after
   a live run rendered 291 fragments where 8 turns belonged. Nothing here
   touches what defines a block; this styles the block. */
.cn-turn {
  background: var(--color-surface-inset);
  border: 1px solid var(--color-border-inset);
  border-radius: var(--radius-rail);
  padding: 9px 12px;
}

.cn-turn-head {
  display: flex;
  align-items: baseline;
  gap: 9px;
}

.cn-turn-who {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.cn-turn-meta {
  font-family: var(--font-mono);
  font-size: 9.5px;
  color: var(--color-text-eyebrow);
}

.cn-turn-body {
  margin-top: 6px;
  font-family: var(--font-sans);
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-text-body);
  white-space: pre-wrap;
  overflow-wrap: break-word;
}

/* A refused turn is a ROW, not a gap. */
.cn-turn-refused {
  border-color: color-mix(in srgb, var(--color-state-error) 28%, transparent);
}

.cn-turn-refused-tag {
  font-family: var(--font-mono);
  font-size: 9.5px;
  color: var(--color-state-error-text);
}

.cn-turn-refused-why {
  margin-top: 6px;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.6;
  color: var(--color-state-error-text);
}

.cn-nextup {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 10px;
  border: 1px dashed var(--color-border-inset);
  border-radius: var(--radius-rail);
  opacity: 0.6;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--color-text-quiet);
}

/* ── Result: findings beside accounting ──────────────────────────────────── */
.cn-result {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  margin-top: 20px;
  min-width: 0;
}

.cn-panel {
  background: var(--color-surface-inset);
  border: 1px solid var(--color-border-inset);
  border-radius: var(--radius-card);
  overflow: hidden;
}

.cn-panel-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 13px;
  border-bottom: 1px solid var(--color-border-panel);
}

.cn-panel-body {
  padding: 12px 13px;
}

/* ⚠ THE STANDING CAVEAT. Above the synthesis, unconditional, not dismissible,
   and deliberately given the attention treatment rather than a quiet grey —
   it is the one thing on this screen a reader must not skim past.
   ⚠ NO SUCCESS CHROME ANYWHERE IN THIS VIEW: no checkmark, no green "complete"
   badge. A finished run reads as FINISHED, never as CORRECT. */
.cn-caveat {
  border: 1px solid color-mix(in srgb, var(--color-state-attention) 35%, transparent);
  background: color-mix(in srgb, var(--color-state-attention) 7%, transparent);
  border-radius: var(--radius-rail);
  padding: 8px 12px;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--color-state-attention-text);
}

.cn-findings {
  margin-top: 12px;
  max-height: 48vh;
  overflow: auto;
  background: var(--color-surface-well);
  border: 1px solid var(--color-border-panel);
  border-radius: var(--radius-rail);
  padding: 10px 12px;
  font-family: var(--font-sans);
  font-size: 12px;
  line-height: 1.65;
  color: var(--color-text-body);
  white-space: pre-wrap;
  overflow-wrap: break-word;
}

/* ── Accounting ──────────────────────────────────────────────────────────── */
.cn-accounting {
  width: 330px;
  flex: none;
}

.cn-denominator-note {
  flex: none;
  font-family: var(--font-mono);
  font-size: 9px;
  color: var(--color-logo-bar-low);
}

.cn-acct-body {
  padding: 12px 13px;
  display: flex;
  flex-direction: column;
  gap: 11px;
}

.cn-acct-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.cn-acct-label {
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--color-text-eyebrow);
}

.cn-acct-figure {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--color-text-primary);
}

/* The connective word inside a figure is quieter than the numbers it joins —
   which is how "3 answered of 4 planned" reads as one fact rather than two. */
.cn-acct-of {
  color: var(--color-text-quiet);
}

.cn-acct-cost {
  font-family: var(--font-mono);
  font-size: 17px;
  color: var(--color-text-primary);
}

.cn-acct-sub {
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 1.6;
  color: var(--color-text-quiet);
}

.cn-acct-sub-bad {
  color: var(--color-state-error-text);
}

.cn-acct-sub-bright {
  color: var(--color-text-muted);
}

.cn-acct-rule {
  height: 1px;
  background: var(--color-border-panel);
}

/* The usage-coverage bar: reported against absent, drawn to scale. It is the
   only place a proportion is drawn, and it is drawn because both halves of it
   are measured — unlike the progress bar the phase track refuses. */
.cn-coverage {
  display: flex;
  gap: 2px;
  margin-top: 2px;
}

.cn-coverage-on,
.cn-coverage-off {
  height: 4px;
  border-radius: var(--radius-bar);
}

.cn-coverage-on {
  background: var(--color-logo-bar-low);
}

.cn-coverage-off {
  background: var(--color-border-inset);
}

/* ── Scrollbars ──────────────────────────────────────────────────────────── */
.cn-main::-webkit-scrollbar,
.cn-rail::-webkit-scrollbar,
.cn-findings::-webkit-scrollbar {
  width: 10px;
}

.cn-main::-webkit-scrollbar-track,
.cn-rail::-webkit-scrollbar-track,
.cn-findings::-webkit-scrollbar-track {
  background: transparent;
}

.cn-main::-webkit-scrollbar-thumb,
.cn-rail::-webkit-scrollbar-thumb,
.cn-findings::-webkit-scrollbar-thumb {
  background: var(--color-border-badge);
  border-radius: 5px;
  border: 3px solid transparent;
  background-clip: padding-box;
}

.cn-main::-webkit-scrollbar-thumb:hover,
.cn-rail::-webkit-scrollbar-thumb:hover,
.cn-findings::-webkit-scrollbar-thumb:hover {
  background: var(--color-logo-bar-low);
  background-clip: padding-box;
}
</style>
