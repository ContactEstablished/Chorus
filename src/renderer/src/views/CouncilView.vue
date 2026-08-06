<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useCouncilStore } from '../stores/council'
import StateMarker from '../components/StateMarker.vue'
import { describeRemoval } from '../../../shared/councilDocket'
import type { CouncilDocketRun, CouncilQuestionSummary } from '../../../shared/ipc'

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
  // ⚠ THE DOCKET IS THE LANDING SURFACE (D114) — but NOT while a council is
  // running. Re-entering the view mid-deliberation must return the user to the
  // run they left, not to a history list with their $1.09 deliberation hidden
  // behind it.
  if (!council.running) council.showDocket()
  void loadDocket()
  await council.loadMembers()
  if (!alive) return
})

/** Reloads whenever the view is opened against a different project, so the
 *  history on screen always belongs to the project in the rail. */
watch(() => props.projectId, loadDocket)

function loadDocket(): void {
  if (props.projectId === null) return
  void council.loadDocket(props.projectId)
}
onBeforeUnmount(() => {
  alive = false
  window.removeEventListener('keydown', onKeydown)
  council.unsubscribe()
  // The stored transcript is dropped with the view (spec §3): a re-entry reads
  // it again rather than showing rows from a run the user has moved past.
  council.clearTranscript()
  // The copy button's "copied" reset would otherwise fire into a dead
  // component — the same discipline the listener above gets.
  if (copyTimer !== null) clearTimeout(copyTimer)
  if (copyFindingsTimer !== null) clearTimeout(copyFindingsTimer)
})

function onKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  // An overlay above the view owns Esc first (the SettingsView rule). A run in
  // flight also owns it: leaving mid-deliberation would strand a paid-for run
  // with nowhere to render.
  if (props.overlayOpen || council.running) return
  // ⚠ ESC UNWINDS ONE STEP AT A TIME. From a run surface it returns to the
  // Docket; only from the Docket does it leave the view. Closing the whole
  // council from a run the user opened one click ago would lose the list they
  // were working through, and "back" meaning two different distances depending on
  // where you are is how a user learns not to trust the key.
  if (council.mode === 'run') {
    council.showDocket()
    return
  }
  emit('close')
}

/* ══ the Docket (D112–D115) ══════════════════════════════════════════════ */

/** ⚠ FORMATTERS ONLY. Not one of these computes a figure — every number they
 *  render arrived from main, which got it from `councilDocketCore`. A second
 *  measurement on this side would be free to disagree with the first. */

/** The relative age of a run, as a phrase. Falls back to the raw timestamp
 *  rather than guessing when it cannot be parsed. */
function whenLabel(iso: string): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return iso
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (secs < 60) return 'just now'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(then).toLocaleDateString()
}

/** ⚠ NULL IS RENDERED AS A STATEMENT, NOT AS A DASH. A run whose end was never
 *  observed says so; it does not show an em-dash the reader has to interpret. */
function durationLabel(ms: number | null): string {
  if (ms === null) return 'ended unknown'
  const secs = Math.round(ms / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  const rest = secs % 60
  if (mins < 60) return `${mins}m ${String(rest).padStart(2, '0')}s`
  const hours = Math.floor(mins / 60)
  return `${hours}h ${String(mins % 60).padStart(2, '0')}m`
}

/**
 * The size of a run, with its denominator when the total is partial (D55).
 *
 * ⚠ RETURNS NULL RATHER THAN "0 tokens" WHEN NOTHING REPORTED USAGE (D76). The
 * caller omits the segment entirely; a zero here would be a claim about the run
 * rather than a claim about what was recorded of it.
 */
function sizeLabel(row: CouncilDocketRun): string | null {
  const turns = `${row.turns} ${row.turns === 1 ? 'turn' : 'turns'}`
  if (row.tokens_in === null && row.tokens_out === null) return turns
  const total = (row.tokens_in ?? 0) + (row.tokens_out ?? 0)
  const tokens = total >= 1000 ? `${Math.round(total / 1000)}k tokens` : `${total} tokens`
  // qwen3-coder reported no usage on six of six questions in 3e-2. A total built
  // from the members that DID report is not the run's total, and says so.
  return row.tokens_are_partial
    ? `${turns} · ${tokens} from ${row.turns_with_tokens} of ${row.turns}`
    : `${turns} · ${tokens}`
}

/**
 * ⚠ "at least", ALWAYS, AND THE WORD IS NOT DECORATION (D115/F42). The stored
 * figure measured 37–60% under the real bill, and unlike a live run's response
 * this row carries no settlement flag to qualify it with. Rendering `$1.09` bare
 * would state a number the app knows to be wrong.
 */
function costLabel(usd: number | null): string | null {
  if (usd === null) return null
  return `at least $${usd.toFixed(2)}`
}

/**
 * A stored run's status, mapped onto `StateMarker`'s four-state vocabulary.
 *
 * ⚠ THE MARKER IS COARSE ON PURPOSE AND THE WORD BESIDE IT CARRIES THE TRUTH.
 * Five stored states do not fit four marker states, and widening the marker to
 * take council vocabulary would push a council concept into a component every
 * session row also uses. So the dot conveys the shape — went fine, went wrong,
 * still going — and the status word rendered next to it says which of the five
 * it actually was. Neither is asked to do the other's job.
 *
 * ⚠ AN UNRECOGNISED STATUS GETS NO MARKER AT ALL (D76). These rows are history
 * written by whatever build was running at the time; guessing `done` for a state
 * this build has never heard of would be a claim, and guessing `error` would be
 * an accusation. The word alone is the honest render.
 */
function runMarkerFor(status: string): 'done' | 'error' | 'running' | null {
  switch (status) {
    case 'running':
      return 'running'
    case 'complete':
      return 'done'
    // A user's own decision to stop, not a fault — but it did not finish either,
    // which is why the word is always beside the dot.
    case 'cancelled':
      return 'done'
    case 'failed':
    // What a crash leaves behind once the boot heal has named it.
    case 'abandoned':
      return 'error'
    default:
      return null
  }
}

/**
 * The arbiter's five states, plus the two non-rulings (D106).
 *
 * ⚠ `unparsed` AND `never asked` ARE BOTH TONE `none`, AND NEITHER IS RED.
 * A missing ruling is not a bad ruling — colouring it like `rejected` would make
 * every pre-D106 run in the Docket look like a council that condemned something.
 * The word carries the fact; the colour is reserved for rulings the arbiter
 * actually made.
 */
const ARBITER_VERDICT: Record<
  string,
  { readonly label: string; readonly tone: 'good' | 'warn' | 'bad' | 'none' }
> = {
  APPROVED: { label: 'approved', tone: 'good' },
  'APPROVED-WITH-REVISIONS': { label: 'approved with revisions', tone: 'warn' },
  REVISE: { label: 'revise', tone: 'warn' },
  REJECTED: { label: 'rejected', tone: 'bad' },
  'INSUFFICIENT-INFORMATION': { label: 'insufficient information', tone: 'none' },
  unparsed: { label: 'unparsed', tone: 'none' }
}

const verdictDisplay = (
  v: string | null
): { readonly label: string; readonly tone: 'good' | 'warn' | 'bad' | 'none' } =>
  // ⚠ null is "never asked", and it says so in words rather than showing a dash
  // the reader has to interpret. Every run recorded before D106 lands here.
  v === null ? { label: 'not asked', tone: 'none' } : (ARBITER_VERDICT[v] ?? { label: v, tone: 'none' })

/** The run currently open, so its header can name it without a second read. */
const viewingRow = computed<CouncilDocketRun | null>(() => {
  const id = council.viewingRunId
  if (id === null || council.docket === null) return null
  return council.docket.find((r) => r.run_id === id) ?? null
})

/** Which row is awaiting its confirm. ⚠ ONE AT A TIME, and it is a row id rather
 *  than a boolean so opening a second confirm closes the first — two armed
 *  delete buttons on screen is how the wrong one gets pressed. */
const confirmingRunId = ref<string | null>(null)
const removalWording = (row: CouncilDocketRun): string => describeRemoval(row.turns)

async function confirmRemoval(runId: string): Promise<void> {
  confirmingRunId.value = null
  await council.forgetRun(runId)
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

/* ------------------------------------------------------------------ */
/* The findings / transcript toggle — D97, Task 3e-4                   */
/* ------------------------------------------------------------------ */

/**
 * Which pane of the findings panel is showing. **Local, not store state**: it is
 * a fact about this component's presentation, and the store's business is what
 * came back from main.
 *
 * ⚠ SWITCHING PANES MUST NOT MOVE THE STANDING CAVEAT OUT OF VIEW (Task-3c-5
 * invariant 2, still binding). The caveat is rendered ABOVE the toggle's output
 * and outside it, so no value of this ref can hide it.
 */
const findingsPane = ref<'findings' | 'transcript'>('findings')

/** The mock's own denominator treatment: `transcript · 13 turns`, never a bare
 *  count (D55). Before a read, the number is the live block count — the only
 *  turn count this side legitimately knows — and after one it is main's
 *  `total_turns`, which is authoritative for what is STORED. */
const transcriptCount = computed<number>(() => {
  // ⚠ A STORED RUN'S COUNT IS ONLY EVER ITS OWN. `messages` still holds the
  // live blocks of whatever ran most recently this session, so the fallback
  // below — correct for a run in flight — would print the LIVE run's turn count
  // on an archived one whose transcript read failed. That is the F37 confusion
  // in miniature: two sources of turns, one number, no way to tell which won.
  if (council.viewingRunId !== null) return council.transcriptTotal
  return council.transcript === null ? council.messages.length : council.transcriptTotal
})

/* ---- one pane, two sources (D112) --------------------------------------
 *
 * ⚠ THE RUN SURFACE RENDERS EITHER A LIVE RUN OR A STORED ONE, AND THESE THREE
 * COMPUTEDS ARE THE ONLY PLACE THAT DECIDES WHICH. The alternative — teaching
 * every `v-if` in the findings section to check `viewingRunId` — is how one of
 * them eventually forgets and shows a live run's document under an archived
 * run's header. `viewingRunId` is the single discriminator. */

const shownFindings = computed<string | null>(() =>
  council.viewingRunId !== null ? council.pastFindings : council.findings
)
const shownFindingsPath = computed<string | null>(() =>
  council.viewingRunId !== null ? council.pastFindingsPath : council.findingsPath
)
const shownFindingsError = computed<string | null>(() =>
  council.viewingRunId !== null ? council.pastFindingsError : council.findingsError
)

/**
 * Show the stored transcript, reading it on first switch.
 *
 * ⚠ IT READS ONLY WHEN THERE IS A RUN ID TO READ. Without one there is nothing
 * to ask for, and inventing a fallback (e.g. "the most recent run") would show
 * the user a deliberation that is not the one on screen.
 */
async function showTranscript(): Promise<void> {
  findingsPane.value = 'transcript'
  if (council.runId === null) return
  if (council.transcript !== null || council.transcriptLoading) return
  await council.loadTranscript(council.runId)
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

/* ------------------------------------------------------------------ */
/* At a glance — the per-question result strip                         */
/* ------------------------------------------------------------------ */

/**
 * ⚠ WHAT THE COLOURS MEAN, AND THE LIMIT OF WHAT THEY MEAN. Each light reports
 * whether the members' own verdict tokens CONVERGED on a question. It is not a
 * pass, not an approval, and not a claim that the council was right — the
 * standing caveat below still governs every word of the findings, and this strip
 * is deliberately placed ABOVE the transcript rather than inside the findings
 * panel so it cannot be read as a verdict ON the findings.
 *
 * ⚠ AND THIS IS THE ONE PLACE THE "NO SUCCESS CHROME" RULE (see `.cn-caveat`'s
 * comment) IS ARGUED RATHER THAN OBEYED BY ABSENCE. There is a green here, and
 * it survives that rule only because of what it is attached to: a measurement of
 * agreement, labelled `agreed`, under a footnote that says agreement is not
 * correctness. No checkmark, no "complete", no "passed" — those would be the
 * claim the rule forbids, and adding one later would break it.
 */
const QUESTION_STATE: Record<
  CouncilQuestionSummary['state'],
  { readonly label: string; readonly tone: 'good' | 'warn' | 'bad' | 'none' }
> = {
  agreed: { label: 'agreed', tone: 'good' },
  qualified: { label: 'qualified', tone: 'warn' },
  split: { label: 'split', tone: 'bad' },
  disagreed: { label: 'disagreed', tone: 'bad' },
  // ⚠ ITS OWN STATE AND ITS OWN (ABSENT) COLOUR. `model-judged` means too few
  // members answered in the required form to count anything; painting it green
  // for "no disagreement detected" would be inventing the measurement that its
  // whole existence records the lack of (D67 Q3).
  'not-measured': { label: 'not measured', tone: 'none' }
}

/** The order the tally reads in — worst first, so the thing worth looking at is
 *  the thing you look at. */
const TALLY_ORDER: readonly CouncilQuestionSummary['state'][] = [
  'split',
  'disagreed',
  'qualified',
  'agreed',
  'not-measured'
]

/** ⚠ D55: every count here is rendered against `questions` below it, never
 *  alone. Zero-count states are omitted rather than shown as `0 split`, which
 *  reads as an assertion about a thing that was looked for. */
const tally = computed<readonly { state: CouncilQuestionSummary['state']; count: number }[]>(() =>
  TALLY_ORDER.map((state) => ({
    state,
    count: council.questionSummary.filter((q) => q.state === state).length
  })).filter((row) => row.count > 0)
)

/**
 * The hover text for one question: the question itself, then who voted what,
 * then who left no token.
 *
 * ⚠ THE SILENT MEMBERS ARE IN HERE FOR THE SAME REASON THE ACCOUNTING PANEL
 * CARRIES `usageAbsent`. "2 agreed" over a four-member council is a different
 * fact from "2 agreed" over a two-member one, and the strip is small enough that
 * the tooltip is where that denominator has to live.
 */
function questionTitle(q: CouncilQuestionSummary): string {
  const votes =
    q.votes.length === 0
      ? 'no parseable verdict tokens'
      : q.votes.map((v) => `${v.label} = ${v.verdict}`).join('\n')
  const silent =
    q.silent.length === 0 ? '' : `\n\nno verdict token from: ${q.silent.join(', ')}`
  const how =
    q.path === 'structural'
      ? '\n\ncounted from the members’ own verdict tokens'
      : '\n\ntoo few verdict tokens to count — the arbiter judged this one from prose'
  return `Q${q.index + 1}. ${q.question}\n\n${votes}${silent}${how}`
}

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
/**
 * Copy the whole transcript out as plain text, so a deliberation that cost real
 * money can be pasted into an issue, a doc, or another agent's context.
 *
 * ⚠ IT SERIALISES WHAT IS ON SCREEN AND NOTHING MORE. The text has already been
 * through main's ONE scrub seam (`SessionOutput.onText`) on its way here — this
 * component is given no other channel — so copying cannot reach around the
 * redaction. It must stay that way: sourcing this from anywhere but
 * `council.messages` would be a second, unscrubbed path to the same content.
 */
type CopyState = 'idle' | 'copied' | 'failed'
const copyState = ref<CopyState>('idle')
const copyFindingsState = ref<CopyState>('idle')
let copyTimer: ReturnType<typeof setTimeout> | null = null
let copyFindingsTimer: ReturnType<typeof setTimeout> | null = null

/** The label a copy button shows for a given state. One place, so the two
 *  buttons cannot drift into saying different things about the same outcome. */
function copyLabel(state: CopyState): string {
  return state === 'copied' ? 'copied' : state === 'failed' ? 'copy failed' : 'copy'
}

function transcriptText(): string {
  // ⚠ THE TURN HEADER IS A RULE, NOT A MARKDOWN HEADING, AND THAT IS
  // DELIBERATE. Members write markdown, and a measured run's turns contained
  // 24 of their own `##` headings — so `## CR GLM (5.2)` would be
  // indistinguishable from a heading the model wrote, and the turn boundaries
  // would dissolve the moment the text was pasted anywhere.
  return council.messages
    .map((m) => {
      const head = `${labelFor(m.memberId)} · ${PHASE_LABEL[m.phase] ?? m.phase} · round ${m.round}`
      return `───── ${head} ─────\n\n${m.text}`
    })
    .join('\n\n')
}

async function copyTranscript(): Promise<void> {
  if (copyTimer !== null) clearTimeout(copyTimer)
  try {
    await navigator.clipboard.writeText(transcriptText())
    copyState.value = 'copied'
  } catch {
    // ⚠ Reported, never silent. A copy button that does nothing and says
    // nothing is worse than no copy button — the user walks away believing
    // they have the text.
    copyState.value = 'failed'
  }
  copyTimer = setTimeout(() => (copyState.value = 'idle'), 2000)
}

/**
 * Copy the findings document. Same rules as the transcript: it serialises what
 * is already on screen, which has been through main's one scrub seam.
 *
 * ⚠ IT COPIES THE DOCUMENT AS RENDERED, WHICH INCLUDES THE STANDING CAVEAT AND
 * ANY PARTIAL-RUN BANNER, because those are written INTO the document by
 * `councilCore` rather than added by this view. That matters: a findings
 * document pasted into an issue without its caveat is a set of model opinions
 * wearing the clothes of a verified result, which is exactly what the caveat
 * exists to prevent. Do not "clean up" the copied text.
 */
async function copyFindings(): Promise<void> {
  if (copyFindingsTimer !== null) clearTimeout(copyFindingsTimer)
  try {
    // ⚠ `shownFindings`, NOT `council.findings` — otherwise copying from an
    // archived run silently hands over the live run's document instead.
    await navigator.clipboard.writeText(shownFindings.value ?? '')
    copyFindingsState.value = 'copied'
  } catch {
    copyFindingsState.value = 'failed'
  }
  copyFindingsTimer = setTimeout(() => (copyFindingsState.value = 'idle'), 2000)
}

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
      <!-- ⚠ THE LABEL AND THE KEYCAP MUST NAME THE SAME DESTINATION. Esc unwinds
           one step at a time now that the Docket sits behind the run surface, so
           a fixed "back to workspace" beside an `esc` cap would advertise a
           journey the key does not make — and this button sits directly under
           that cap, which is the strongest possible claim that the two agree. -->
      <button
        class="cn-back"
        :disabled="council.running"
        data-testid="council-rail-back"
        @click="council.mode === 'run' ? council.showDocket() : emit('close')"
      >
        {{ council.mode === 'run' ? 'back to docket' : 'back to workspace' }}
        <span class="flex-1"></span>
        <span class="cn-keycap">esc</span>
      </button>
    </nav>

    <!-- ══ THE DOCKET — this project's council history (D112–D115) ══
         The LANDING surface: opening the council answers "what has this project
         already decided" before it offers to spend $1.09 asking something new. -->
    <div v-if="council.mode === 'docket'" class="cn-main" data-testid="council-docket">
      <h1 class="cn-title">Docket</h1>
      <p class="cn-lede">
        Every council this project has convened, newest first. Open one to re-read what it decided
        and how the members got there.
      </p>

      <div class="mt-4 flex items-center gap-3">
        <button class="cn-btn cn-btn-primary" data-testid="council-new" @click="council.newRun()">
          New council
        </button>
        <span class="flex-1"></span>
        <!-- D55: the list's own denominator. -->
        <span v-if="council.docket !== null" class="cn-meta">
          {{ council.docket.length }} {{ council.docket.length === 1 ? 'run' : 'runs' }}
        </span>
      </div>

      <p v-if="council.docketError" class="cn-error">{{ council.docketError }}</p>

      <!-- ⚠ THREE DISTINCT STATES, NOT TWO. "Not loaded yet", "loaded and
           empty", and "has rows" are different facts and an empty list is a real
           answer rather than a spinner that never resolved. -->
      <p v-else-if="council.docket === null && council.docketLoading" class="cn-meta mt-6">
        Reading this project’s history…
      </p>
      <p v-else-if="council.docket !== null && council.docket.length === 0" class="cn-meta mt-6">
        No councils yet for this project. A council reads a brief of numbered questions and returns
        findings you can keep.
      </p>

      <div v-else-if="council.docket !== null" class="cn-docket">
        <div v-for="row in council.docket" :key="row.run_id" class="cn-docket-row">
          <button
            type="button"
            class="cn-docket-open"
            :disabled="council.running"
            :title="row.brief_path"
            data-testid="council-docket-row"
            @click="council.openRun(row.run_id)"
          >
            <span class="cn-docket-head">
              <span class="cn-docket-name">{{ row.label }}</span>
              <!-- ⚠ EXACTLY ONE STATUS AFFORDANCE PER ROW (CR-3f.1's badge
                   economy). Counts below are TEXT, never more badges. -->
              <StateMarker v-if="runMarkerFor(row.status)" :state="runMarkerFor(row.status)!" />
              <span class="cn-docket-status">{{ row.status }}</span>
            </span>
            <span class="cn-docket-sub">
              {{ whenLabel(row.started_at) }} · {{ durationLabel(row.duration_ms) }}
            </span>
            <span class="cn-docket-sub">
              {{ sizeLabel(row) }}
              <!-- Omitted entirely when the run recorded no cost (D76) — never
                   rendered as $0.00. -->
              <template v-if="costLabel(row.cost_floor_usd)">
                · {{ costLabel(row.cost_floor_usd) }}
              </template>
            </span>
            <!-- ⚠ D106 AS TEXT, NEVER A BADGE. The row already spends its one
                 status affordance on the run status above (CR-3f.1's badge
                 economy); counts and denominators are explicitly allowed as
                 text. Omitted entirely when main had nothing honest to say. -->
            <span v-if="row.verdict_digest" class="cn-docket-verdict">
              {{ row.verdict_digest }}
            </span>
          </button>

          <button
            type="button"
            class="cn-docket-remove"
            :disabled="council.running"
            title="Remove this run from the Docket"
            aria-label="Remove this run from the Docket"
            @click="confirmingRunId = confirmingRunId === row.run_id ? null : row.run_id"
          >
            Remove
          </button>

          <!-- ⚠ D109: THE COUNTS ARE STATED BEFORE THE REMOVAL, NOT AFTER, and
               the sentence names what SURVIVES as well as what goes. -->
          <div v-if="confirmingRunId === row.run_id" class="cn-docket-confirm">
            <p class="cn-docket-confirm-text">{{ removalWording(row) }}</p>
            <div class="flex items-center gap-2">
              <button class="cn-btn" @click="confirmingRunId = null">Cancel</button>
              <button
                class="cn-btn cn-btn-danger"
                data-testid="council-docket-remove-confirm"
                @click="confirmRemoval(row.run_id)"
              >
                Remove from Docket
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- run surface -->
    <div v-else class="cn-main">
      <!-- ⚠ THE WAY BACK, AND IT IS THE FIRST THING IN THE PANE. The council view
           was reachable-but-not-leavable in one direction before the Docket
           existed; a surface you can enter from a list must show the way back to
           it. Hidden while running for the same reason Esc is refused then. -->
      <button
        v-if="!council.running"
        type="button"
        class="cn-docket-back"
        data-testid="council-back-to-docket"
        @click="council.showDocket()"
      >
        ← Docket
      </button>

      <!-- A stored run: its header names what is being read, so an archived
           document is never mistaken for a run that just finished. -->
      <template v-if="council.viewingRunId !== null">
        <h1 class="cn-title">{{ viewingRow?.label ?? 'Council run' }}</h1>
        <p class="cn-lede">
          <template v-if="viewingRow">
            {{ whenLabel(viewingRow.started_at) }} · {{ durationLabel(viewingRow.duration_ms) }} ·
            {{ sizeLabel(viewingRow) }}
          </template>
          <template v-else>A stored council run.</template>
        </p>
      </template>

      <template v-else>
        <h1 class="cn-title">Council review</h1>
        <p class="cn-lede">
          Point Chorus at a brief. Every member answers its numbered questions blind, critiques the
          others anonymised, and the arbiter rules and synthesizes. The findings land as a
          <code class="cn-code">-Findings.md</code> file beside the brief.
        </p>
      </template>

      <!-- brief picker — ⚠ HIDDEN WHEN READING A STORED RUN. A "Run council"
           button under an archived deliberation would invite starting a NEW paid
           run while reading an old one, with nothing on screen distinguishing
           the two afterwards. -->
      <template v-if="council.viewingRunId === null">
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

      <!-- ══ at a glance — one light per question ══
           Directly under the phase track and deliberately built from the same
           anatomy: a 4px bar over a label, one cell per item, flexed across the
           row. The track says how far the run got; this says how it came out.

           ⚠ HIDDEN UNTIL A RUN REPORTS ONE, never drawn empty or greyed. There
           is no honest placeholder for a measurement that has not been taken,
           and the store clears it at the start of every run. -->
      <div
        v-if="council.questionSummary.length > 0"
        class="cn-glance"
        data-council-glance
      >
        <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span class="cn-eyebrow">AT A GLANCE</span>
          <!-- ⚠ D55: the counts and their denominator are ONE sentence, in one
               element, so no future edit can move the total somewhere the counts
               do not follow it. -->
          <span class="cn-meta cn-meta-bright">
            {{ council.questionSummary.length }}
            question{{ council.questionSummary.length === 1 ? '' : 's' }}
          </span>
          <!-- ⚠ THE STRIP NOW ARRIVES MID-RUN, SO IT HAS TO SAY IT IS MID-RUN.
               It lands when the positions round closes — with critique,
               arbitration and synthesis still ahead — and a reader who takes it
               for the finished result has been misled by a surface that was
               being helpful. The chip is the correction, and it disappears on
               its own when the run does.

               ⚠ BEFORE THE TALLY, AND NOT PUSHED RIGHT WITH A SPACER. This row
               wraps: a spacer eats the rest of line one and strands the chip
               alone on line two, and putting the chip last does the same thing
               whenever all five states are present. The tally is the part that
               wraps gracefully — it is already a list of chips — so the tally
               goes last and the timing qualifier stays beside the count it
               qualifies. -->
          <span v-if="council.running" class="cn-glance-live" data-council-glance-live>
            positions in · still deliberating
          </span>
          <span v-for="row in tally" :key="row.state" class="cn-tally">
            <span class="cn-dot" :class="`cn-dot-${QUESTION_STATE[row.state].tone}`"></span>
            {{ row.count }} {{ QUESTION_STATE[row.state].label }}
          </span>
        </div>

        <div class="cn-glance-row">
          <div
            v-for="q in council.questionSummary"
            :key="q.index"
            class="cn-glance-cell"
            :title="questionTitle(q)"
            :data-council-glance-state="q.state"
          >
            <div class="cn-glance-bar" :class="`cn-glance-bar-${QUESTION_STATE[q.state].tone}`"></div>
            <div class="flex items-baseline gap-1.5">
              <span class="cn-stop-num cn-stop-done">Q{{ q.index + 1 }}</span>
              <span class="cn-glance-label" :class="`cn-glance-${QUESTION_STATE[q.state].tone}`">
                {{ QUESTION_STATE[q.state].label }}
              </span>
            </div>
          </div>
        </div>

        <!-- ⚠ NOT DECORATION AND NOT REMOVABLE. A colour strip with no statement
             of what it measured is exactly the surface a reader turns into "the
             council approved it". This sentence is the difference.

             ⚠ AND IT NAMES THE POSITIONS ROUND UNCONDITIONALLY, not only while
             the run is live. The vector is computed from the opening positions
             and never recomputed — it is the same reading at the end of the run
             as at the critique boundary — so "the arbiter may rule otherwise"
             stays true after the run finishes and must not be a `v-if`. -->
        <p class="cn-glance-note">
          Counted from the members’ own verdict tokens in the opening
          <em>positions</em> round — this measures whether they <em>agreed</em>, not whether
          they were right, and the arbiter’s ruling can land elsewhere. Hover a question for
          the per-member breakdown.
        </p>
      </div>

      <!-- live deliberation -->
      <!-- Same anatomy as the findings panel below: a bordered panel with a
           header bar, and ONE scrolling well inside it. The turns are flat
           blocks in that well rather than bordered cards, because a card
           inside a well inside a panel is three nested boxes and reads as a
           window inside a window. -->
      <section v-if="council.messages.length > 0" class="cn-panel cn-panel-static mt-5">
        <div class="cn-panel-head">
          <span class="cn-eyebrow">TRANSCRIPT</span>
          <span class="cn-meta">
            {{ council.messages.length }} turn{{ council.messages.length === 1 ? '' : 's' }} so far
          </span>
          <span class="flex-1"></span>
          <!-- Copy the whole transcript out. Sits at the TOP of the list rather
               than the bottom because the list scrolls: a control below a
               scroll region is a control you have to scroll to reach. -->
          <button
            class="cn-copy"
            :title="copyState === 'copied' ? 'copied' : 'copy the transcript'"
            data-council-copy
            @click="copyTranscript"
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2">
              <rect x="4.5" y="4.5" width="8" height="8" rx="1.5" />
              <path d="M9.5 2.5h-6a2 2 0 0 0-2 2v6" />
            </svg>
            {{ copyLabel(copyState) }}
          </button>
        </div>
        <!-- ⚠ HEIGHT-RESTRICTED AND SCROLLABLE ON PURPOSE. A run produces
             thirteen turns of full model output; left to grow, the transcript
             pushes the findings and accounting panels off the bottom of the
             window, and those are the two things a finished run is read FOR.
             The transcript scrolls inside its own well so all three stay on
             screen at once. -->
        <div class="cn-panel-body">
          <div class="cn-transcript">
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
        </div>
      </section>
      </template>

      <!-- ══ THE VERDICT STRIP (D106) — a stored run's two facts ══
           Rendered ABOVE the findings, because "what was decided" is what a
           person reopening a council came for; the prose is the evidence. -->
      <!-- ⚠ `cn-panel-static` IS LOAD-BEARING, NOT DECORATION. `.cn-main` is a
           flex column and `.cn-result` below grows into it, so a panel without
           `flex: none` gets squeezed to whatever is left — which clipped this
           strip to one and a half rows the first time it rendered. The live
           transcript panel carries the same class for the same reason. -->
      <section
        v-if="council.viewingRunId !== null && council.verdict"
        class="cn-panel cn-panel-static mt-5"
      >
        <div class="cn-panel-head">
          <span class="cn-eyebrow">VERDICT</span>
          <!-- ⚠ D106 REQUIRES THE DENOMINATOR ON THE STRIP ITSELF. `4 ruled` is
               unreadable without knowing six questions were put. -->
          <span v-if="council.verdict.arbiter_asked" class="cn-meta">
            {{ council.verdict.ruled }} of {{ council.verdict.total }} ruled
          </span>
          <span class="flex-1"></span>
          <span class="cn-meta">arbiter · members</span>
        </div>
        <div class="cn-panel-body">
          <!-- The brief is gone, so there are no questions to hang rows on.
               Stated, never a silently empty strip. -->
          <p v-if="council.verdict.reason" class="cn-meta">{{ council.verdict.reason }}</p>

          <!-- ⚠ NEVER ASKED IS NOT A FAILURE, AND SAYS SO IN FULL. Every council
               recorded before this feature shipped lands here; a bare empty strip
               would read as a council that decided nothing. -->
          <p v-else-if="!council.verdict.arbiter_asked" class="cn-meta">
            This run’s arbiter was not asked for a structured verdict, so only the members’
            consensus below was recorded. Councils run from now on carry both.
          </p>

          <div v-if="council.verdict.rows.length > 0" class="cn-verdicts">
            <div v-for="r in council.verdict.rows" :key="r.index" class="cn-verdict-row">
              <span class="cn-verdict-q">Q{{ r.index + 1 }}</span>
              <span class="cn-verdict-text" :title="r.question">{{ r.question }}</span>
              <!-- ⚠ TWO FACTS, TWO SOURCES, SIDE BY SIDE AND NEVER RECONCILED.
                   The arbiter's ruling and the members' consensus can disagree,
                   and that disagreement is the most informative thing here. -->
              <span
                class="cn-verdict-tag"
                :class="`cn-glance-${verdictDisplay(r.verdict).tone}`"
                >{{ verdictDisplay(r.verdict).label }}</span
              >
              <span
                class="cn-verdict-tag cn-verdict-consensus"
                :class="`cn-glance-${QUESTION_STATE[r.consensus.state].tone}`"
                :title="
                  r.consensus.votes.map((v) => `${v.label}: ${v.verdict}`).join(' · ') || 'no votes'
                "
                >{{ QUESTION_STATE[r.consensus.state].label }}</span
              >
              <!-- D55 one layer over: `3 agreed` is unreadable without knowing a
                   fourth member was asked and said nothing countable. -->
              <span v-if="r.consensus.silent.length > 0" class="cn-meta">
                {{ r.consensus.silent.length }} silent
              </span>
            </div>
          </div>
        </div>
      </section>

      <p v-else-if="council.viewingRunId !== null && council.verdictLoading" class="cn-meta mt-4">
        Reading the verdict…
      </p>
      <p v-else-if="council.verdictError" class="cn-error mt-4">{{ council.verdictError }}</p>

      <!-- ⚠ A STORED RUN THAT IS STILL BEING READ SAYS SO. Without this the pane
           is blank between the click and the file arriving, which reads as "this
           run has no findings" — a claim about the run rather than about the
           read. -->
      <p v-if="council.pastFindingsLoading" class="cn-meta mt-4">Reading the findings document…</p>

      <!-- findings — live or stored, discriminated once by `viewingRunId` -->
      <section v-if="shownFindings || shownFindingsError" class="cn-result">
        <!-- findings document -->
        <div class="cn-panel min-w-0 flex-1">
          <div class="cn-panel-head">
            <span class="cn-eyebrow">FINDINGS</span>
            <!-- ⚠ THE MOCK ALREADY DRAWS THIS (D97): a two-segment control
                 beside the eyebrow, the inactive segment quieter, and the count
                 carrying its noun. `council_messages` has been written on every
                 run since 3b-3 and read by nothing; this is its door. -->
            <span class="cn-seg" data-council-pane-toggle>
              <button
                class="cn-seg-btn"
                :class="{ 'cn-seg-on': findingsPane === 'findings' }"
                data-council-pane-findings
                @click="findingsPane = 'findings'"
              >
                findings
              </button>
              <button
                class="cn-seg-btn"
                :class="{ 'cn-seg-on': findingsPane === 'transcript' }"
                data-council-pane-transcript
                @click="showTranscript"
              >
                transcript · {{ transcriptCount }} turn{{ transcriptCount === 1 ? '' : 's' }}
              </button>
            </span>
            <span class="flex-1"></span>
            <span v-if="shownFindingsPath" class="cn-meta truncate" :title="shownFindingsPath">
              {{ council.viewingRunId === null ? 'written beside the brief' : 'read from disk' }}
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

            <!-- The written-to line doubles as the findings' action row: the
                 copy button sits on it rather than on its own, so the document
                 gains an affordance without gaining a bar. -->
            <template v-if="findingsPane === 'findings'">
              <div class="mt-2 flex items-start gap-3">
                <!-- ⚠ THE PATH AND THE REASON CAN BOTH BE PRESENT, AND WHEN THEY
                     ARE, BOTH SHOW. A findings document moved by a branch switch
                     comes back from main as a reason NAMING THE PATH IT LOOKED
                     IN — "we looked and found nothing" is only actionable if it
                     says where. The original `v-else-if` assumed the two were
                     alternatives, which is true of a live run and false of a
                     stored one. -->
                <div v-if="shownFindingsPath || shownFindingsError" class="min-w-0 flex-1">
                  <p v-if="shownFindingsPath" class="cn-meta break-all">
                    {{ council.viewingRunId === null ? 'Written to' : 'Recorded at' }}
                    <span class="cn-meta-bright">{{ shownFindingsPath }}</span>
                  </p>
                  <p v-if="shownFindingsError" class="cn-error" :class="{ 'mt-1': shownFindingsPath }">
                    {{ shownFindingsError }}
                  </p>
                </div>
                <span v-else class="flex-1"></span>
                <button
                  class="cn-copy"
                  :title="copyFindingsState === 'copied' ? 'copied' : 'copy the findings'"
                  data-council-copy-findings
                  @click="copyFindings"
                >
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2">
                    <rect x="4.5" y="4.5" width="8" height="8" rx="1.5" />
                    <path d="M9.5 2.5h-6a2 2 0 0 0-2 2v6" />
                  </svg>
                  {{ copyLabel(copyFindingsState) }}
                </button>
              </div>

              <pre v-if="shownFindings" class="cn-findings">{{ shownFindings }}</pre>
            </template>

            <!-- The STORED transcript (D97). Same `.cn-turn` treatment as the
                 live panel above, so one vocabulary describes both — a turn is a
                 turn whether it is arriving or being re-read. -->
            <template v-else>
              <div class="mt-2 flex items-start gap-3">
                <p class="cn-meta min-w-0 flex-1">
                  <template v-if="council.transcriptLoading">reading the stored transcript…</template>
                  <template v-else-if="council.transcriptError" />
                  <template v-else-if="council.runId === null">
                    No run id on this side, so there is nothing to read back.
                  </template>
                  <template v-else>
                    <span class="cn-meta-bright">{{ council.transcript?.length ?? 0 }}</span>
                    of {{ council.transcriptTotal }} stored turn{{ council.transcriptTotal === 1 ? '' : 's' }},
                    read from this run's own record
                  </template>
                </p>
              </div>
              <p v-if="council.transcriptError" class="cn-error mt-2">
                {{ council.transcriptError }}
              </p>
              <!-- ⚠ TRUNCATION IS RENDERED, NEVER SWALLOWED. A partial read that
                   does not say it is partial is worse than no reader. -->
              <p v-if="council.transcriptTruncated" class="cn-caveat mt-2">
                This read hit its size cap, so the turns below stop short of the whole record. The
                full transcript is still in the database.
              </p>
              <div class="cn-findings cn-stored-transcript">
                <article
                  v-for="(t, i) in council.transcript ?? []"
                  :key="`stored-${i}`"
                  class="cn-turn"
                  data-council-stored-turn
                >
                  <div class="cn-turn-head">
                    <span class="cn-turn-who">{{ labelFor(t.member_id) }}</span>
                    <span class="cn-turn-meta">
                      {{ PHASE_LABEL[t.phase] ?? t.phase }} · round {{ t.round }}
                    </span>
                  </div>
                  <pre class="cn-turn-body">{{ t.text }}</pre>
                </article>
                <p
                  v-if="!council.transcriptLoading && (council.transcript?.length ?? 0) === 0"
                  class="cn-meta"
                >
                  This run stored no transcript rows.
                </p>
              </div>
            </template>
          </div>
        </div>

        <!-- ⚠ D55 ONE LAYER UP: no number without its denominator. A cost or a
             token count rendered alone is the same defect the schema already
             forbids on the wire. -->
        <!-- ⚠ LIVE RUNS ONLY, AND THE GUARD IS `viewingRunId` RATHER THAN THE
             PRESENCE OF `accounting`. The store keeps the last run's accounting
             for the whole session, so a user who runs a council and then opens an
             archived one would otherwise read THIS session's members, turns and
             cost under a header naming a run from three weeks ago. A stored run's
             accounting is not reconstructable — `council_messages` has no model
             column and `council_members.model` is never back-written (D56) — so
             the honest thing is to omit the panel rather than fill it from the
             nearest data to hand (D76). -->
        <div v-if="council.accounting && council.viewingRunId === null" class="cn-panel cn-accounting">
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
              <!-- ⚠ F41. THIS IS NOT A HEDGE, IT IS A DENOMINATOR. When the
                   provider's ledger had not settled in time, the figure above is
                   `readUsage`'s early read, which omits the run's FINAL turn by
                   construction — measured at 49% low across two runs on two
                   rosters before the reconcile existed. Rendered as a
                   correction to the number rather than a footnote under it,
                   because the number is what gets quoted. -->
              <span
                v-if="council.costUsd !== null && council.costIsProvisional"
                class="cn-acct-provisional"
                data-council-cost-provisional
              >
                at least this much — the provider's ledger had not settled
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
                  · {{ council.accounting.usageAbsent }}
                  turn{{ council.accounting.usageAbsent === 1 ? '' : 's' }}
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

/* ── The Docket ──────────────────────────────────────────────────────────
   Rows take the FILMSTRIP CARD's anatomy rather than a new one: a council is
   another thing that happened inside a project, and a user who has learned to
   read one list should not have to learn a second. `--color-surface-card`, the
   periwinkle-mixed border and `--radius-card` are all `FilmstripRenderer`'s. */
.cn-docket {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 14px;
  min-height: 0;
  overflow-y: auto;
  padding-bottom: 12px;
}

.cn-docket-row {
  position: relative;
  border: 1px solid color-mix(in srgb, var(--color-accent-periwinkle) 22%, transparent);
  background: var(--color-surface-card);
  border-radius: var(--radius-card);
}

/* ⚠ The row's whole area is the open target, and Remove is a SIBLING pinned
   over it — a button inside a button is invalid HTML and browsers resolve it by
   dropping one of them. `ProjectRail`'s gear is the same problem, solved the
   same way, and its comment records what it cost to learn. */
.cn-docket-open {
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 100%;
  padding: 11px 92px 11px 13px;
  text-align: left;
  cursor: default;
  border-radius: var(--radius-card);
}

.cn-docket-open:disabled {
  opacity: 0.45;
}

.cn-docket-head {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.cn-docket-name {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cn-docket-status {
  font-family: var(--font-mono);
  font-size: 9.5px;
  letter-spacing: 0.06em;
  color: var(--color-text-eyebrow);
}

.cn-docket-sub {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--color-text-quiet);
}

/* The D106 digest. Same mono scale as the row's other facts and NOT a badge —
   it is a sentence of counts, and the row's one affordance is already spent. */
.cn-docket-verdict {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--color-text-secondary);
}

/* ── The Verdict strip ───────────────────────────────────────────────────
   One row per question: ordinal, question, the arbiter's ruling, the members'
   consensus. The two tags sit adjacent deliberately — D106's whole point is
   that a reader can see them disagree. */
.cn-verdicts {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
}

.cn-verdict-row {
  display: flex;
  align-items: baseline;
  gap: 9px;
  min-width: 0;
}

.cn-verdict-q {
  flex: none;
  width: 22px;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--color-text-eyebrow);
}

.cn-verdict-text {
  flex: 1;
  min-width: 0;
  font-size: 11.5px;
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cn-verdict-tag {
  flex: none;
  font-family: var(--font-mono);
  font-size: 9.5px;
  letter-spacing: 0.04em;
  padding: 2px 7px;
  border-radius: var(--radius-badge, 4px);
  border: 1px solid currentColor;
}

/* The members' half is quieter than the arbiter's: the ruling is the headline,
   the consensus is the context it should be read against. */
.cn-verdict-consensus {
  border-style: dashed;
  opacity: 0.85;
}

.cn-docket-remove {
  position: absolute;
  top: 10px;
  right: 10px;
  padding: 4px 9px;
  border: 1px solid transparent;
  border-radius: var(--radius-rail);
  font-size: 10.5px;
  color: var(--color-text-eyebrow);
  cursor: default;
  opacity: 0;
}

/* Revealed on hover or focus — a destructive control on every row at all times
   is an invitation. Focus-visible keeps it reachable without a mouse. */
.cn-docket-row:hover .cn-docket-remove,
.cn-docket-remove:focus-visible {
  opacity: 1;
}

.cn-docket-remove:hover {
  border-color: color-mix(in srgb, var(--color-state-error) 35%, transparent);
  color: var(--color-state-error-text);
}

.cn-docket-remove:disabled {
  opacity: 0;
  pointer-events: none;
}

.cn-docket-confirm {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 11px 13px 13px;
  border-top: 1px solid var(--color-border-inset);
}

.cn-docket-confirm-text {
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--color-text-secondary);
}

.cn-btn-danger {
  border-color: color-mix(in srgb, var(--color-state-error) 40%, transparent);
  background: color-mix(in srgb, var(--color-state-error) 8%, transparent);
  color: var(--color-state-error-text);
}

.cn-btn-danger:hover {
  color: var(--color-state-error-hover);
}

/* The way back to the history, above the run's own title. */
.cn-docket-back {
  align-self: flex-start;
  margin-bottom: 10px;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.04em;
  color: var(--color-text-eyebrow);
  cursor: default;
}

.cn-docket-back:hover {
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

/* ── At a glance ─────────────────────────────────────────────────────────
   The phase track's card and the phase track's anatomy, one row down: same
   surface, same border, same 4px bar over a label. That is the point — the two
   strips answer "how far did it get" and "how did it come out" about the same
   run, and a second visual language between them would make them look like
   readings from two different instruments. */
.cn-glance {
  flex: none;
  margin-top: 10px;
  background: var(--color-surface-card);
  border: 1px solid var(--color-border-inset);
  border-radius: var(--radius-card);
  padding: 11px 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.cn-tally {
  display: flex;
  align-items: center;
  gap: 5px;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--color-text-quiet);
}

.cn-dot {
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: 50%;
}

.cn-glance-row {
  display: flex;
  align-items: stretch;
  gap: 6px;
  flex-wrap: wrap;
}

/* `min-width` rather than a bare `flex: 1`: ten questions on a narrow window
   would otherwise squeeze each cell below its own label, and the row wraps
   instead. */
.cn-glance-cell {
  display: flex;
  flex: 1 1 96px;
  min-width: 96px;
  flex-direction: column;
  gap: 6px;
}

.cn-glance-bar {
  height: 4px;
  border-radius: var(--radius-bar);
}

/* ⚠ NO ANIMATION HERE, AND THAT IS THE SAME RULING THE PHASE TRACK MAKES. The
   one moving thing on this screen is the active phase, because motion means
   "still working". A settled result must not compete with it. */
.cn-glance-bar-good {
  background: color-mix(in srgb, var(--color-accent-jade) 60%, transparent);
}

.cn-glance-bar-warn {
  background: color-mix(in srgb, var(--color-state-attention) 65%, transparent);
}

.cn-glance-bar-bad {
  background: color-mix(in srgb, var(--color-state-error) 65%, transparent);
}

/* The unmeasured question is drawn in the PENDING treatment, not a fourth
   colour: nothing was counted, so it reads as the track's own "no reading yet". */
.cn-glance-bar-none {
  background: var(--color-border-inset);
}

.cn-glance-label {
  font-family: var(--font-mono);
  font-size: 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* The four tones, in the same order in both places they are used — the tally's
   dot (a fill) and the cell's label (a text colour). Kept adjacent rather than
   merged into shared selectors so neither can be edited without the other being
   directly under the cursor. */
.cn-dot-good {
  background: var(--color-accent-jade);
}

.cn-dot-warn {
  background: var(--color-state-attention);
}

.cn-dot-bad {
  background: var(--color-state-error);
}

.cn-dot-none {
  background: var(--color-border-inset);
}

.cn-glance-good {
  color: var(--color-accent-jade);
}

.cn-glance-warn {
  color: var(--color-state-attention-text);
}

.cn-glance-bad {
  color: var(--color-state-error-text);
}

.cn-glance-none {
  color: var(--color-text-eyebrow);
}

/* The mid-run qualifier. Deliberately NOT the attention treatment: it is a fact
   about timing, not a warning, and a yellow box here would compete with the
   standing caveat that genuinely is one. */
.cn-glance-live {
  flex: none;
  display: flex;
  align-items: center;
  gap: 5px;
  font-family: var(--font-mono);
  font-size: 9.5px;
  border: 1px solid var(--color-border-badge);
  background: var(--color-surface-field);
  border-radius: var(--radius-chip);
  padding: 1px 7px;
  color: var(--color-text-quiet);
}

.cn-glance-note {
  font-size: 11px;
  line-height: 1.55;
  color: var(--color-text-eyebrow);
}

.cn-glance-note em {
  font-style: normal;
  color: var(--color-text-quiet);
}

/* ── Transcript ──────────────────────────────────────────────────────────
   ⚠ A block is keyed on (member, phase, round) BY THE STORE — F37's fix, after
   a live run rendered 291 fragments where 8 turns belonged. Nothing here
   touches what defines a block; this styles the block. */

/* ⚠ THE HEIGHT CAP IS THE POINT, NOT A TIDINESS CHOICE. A measured run wrote
   40,057 bytes of findings over 7 turns, and a full one reaches 13; unbounded,
   the transcript pushes the FINDINGS and ACCOUNTING panels below the fold, and
   those are the two things a finished run is actually read for. Capped in `vh`
   rather than pixels so it holds its share of the window at any size. */
/* ⚠ IDENTICAL TO .cn-findings BELOW, DELIBERATELY — same well, same border,
   same radius, same padding, same scrollbar treatment. The two scrolling
   regions on this screen are the same kind of thing and must not look like two
   decisions. Only the height differs (34vh vs 48vh), because the transcript is
   the thing you skim and the findings are the thing you read. */
.cn-transcript {
  max-height: 34vh;
  overflow-y: auto;
  background: var(--color-surface-well);
  border: 1px solid var(--color-border-panel);
  border-radius: var(--radius-rail);
  padding: 10px 12px;
}

/* The copy control. Quiet at rest — it is an escape hatch, not an action the
   screen is asking for. */
.cn-copy {
  display: flex;
  align-items: center;
  gap: 5px;
  flex: none;
  border: 1px solid var(--color-border-badge);
  background: var(--color-surface-field);
  border-radius: var(--radius-icon);
  padding: 3px 8px;
  font-family: var(--font-mono);
  font-size: 9.5px;
  color: var(--color-text-quiet);
  cursor: default;
}

.cn-copy:hover {
  border-color: var(--color-logo-bar-low);
  color: var(--color-text-body);
}

/* ⚠ FLAT, NOT A CARD. A bordered card inside the bordered well inside the
   bordered panel is three nested boxes, which is what "a window inside a
   window" describes. A turn is a block in a document — separated by a rule,
   the way the findings document separates its own sections.
   THAT RULING STANDS; what follows only makes the rule findable.

   ⚠ THE SEPARATOR WAS `1px solid var(--color-border-panel)` AND THAT IS #191E24
   — barely a shade off the well it sits on. It was technically present and
   practically invisible, so a wall of model prose read as one continuous
   document and you could not see where one member stopped and the next began.
   The border ladder has nothing brighter to reach for (it tops out at #262D35),
   which is why this tints toward periwinkle instead of climbing the ladder:
   the accent is already this app's "distinct entity starts here" colour, and at
   this weight it reads as a rule rather than as decoration. */
.cn-turn {
  padding: 18px 0 16px;
  border-top: 2px solid color-mix(in srgb, var(--color-accent-periwinkle) 50%, transparent);
}

.cn-turn:first-child {
  padding-top: 2px;
  border-top: 0;
}

/* The second half of the same fix, and the one that does the most work when the
   transcript is scrolling: a spine at the speaker's name, the same shape the
   project rail uses to say "this is a distinct thing". The rule catches the eye
   arriving at a boundary; the spine tells it where the new voice starts. */
.cn-turn-head {
  display: flex;
  align-items: baseline;
  gap: 9px;
}

.cn-turn-head::before {
  content: '';
  flex: none;
  align-self: center;
  width: 3px;
  height: 14px;
  border-radius: 2px;
  background: var(--color-accent-periwinkle);
}

/* A refused turn already carries a red left accent; a periwinkle spine beside it
   would be two different claims about the same row. */
.cn-turn-refused .cn-turn-head::before {
  background: var(--color-state-error-text);
}

.cn-turn-who {
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: 0.01em;
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

/* A refused turn is a ROW, not a gap — and now that turns are flat, it earns
   its distinction from a left accent rather than from a box. */
.cn-turn-refused {
  border-left: 2px solid color-mix(in srgb, var(--color-state-error) 55%, transparent);
  padding-left: 10px;
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

/* ⚠ A panel that is a direct child of the main flex COLUMN must opt out of
   shrinking, or the column squeezes it to a single line — which is exactly what
   happened to the transcript the first time it became a panel. The findings
   panel does not need this: it sits in a flex ROW and takes `flex-1` there. */
.cn-panel-static {
  flex: none;
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

/* The stored transcript shares the findings well — same border, same inset,
   same height — and fills it with `.cn-turn` blocks instead of a document. The
   well is the panel's ONE scrolling region either way, which is what keeps the
   accounting panel beside it on screen. `pre-wrap` belongs to the document, not
   to the blocks, so it is undone here. */
.cn-stored-transcript {
  white-space: normal;
}

/* ── The findings / transcript toggle (D97) ───────────────────────────────
   The `overlay-segmented` anatomy — one bordered container, a quiet inactive
   segment, dividers between — at the mock's HEADER scale rather than the
   dialog's: 9.5px mono, 2px 9px padding, sized to its label instead of filling
   the row. */
.cn-seg {
  display: flex;
  flex: none;
  border: 1px solid var(--color-border-inset);
  background: var(--color-surface-well);
  border-radius: var(--radius-icon);
  overflow: hidden;
}

.cn-seg-btn {
  border: 0;
  border-left: 1px solid var(--color-border-segment);
  background: transparent;
  padding: 2px 9px;
  font-family: var(--font-mono);
  font-size: 9.5px;
  color: var(--color-text-quiet);
  cursor: default;
  white-space: nowrap;
}

.cn-seg-btn:first-child {
  border-left: 0;
}

.cn-seg-btn:hover:not(.cn-seg-on) {
  color: var(--color-text-body);
}

.cn-seg-on {
  background: var(--color-surface-badge);
  color: var(--color-text-primary);
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

/* F41's provisional marker. Given the ATTENTION treatment, not the quiet grey
   the other sub-lines get: every figure in this panel is meant to be reliable,
   and this is the one that says a figure is not. It sits directly under the
   number it qualifies. */
.cn-acct-provisional {
  align-self: flex-start;
  border: 1px solid color-mix(in srgb, var(--color-state-attention) 35%, transparent);
  background: color-mix(in srgb, var(--color-state-attention) 8%, transparent);
  border-radius: var(--radius-chip);
  padding: 1px 7px;
  font-family: var(--font-mono);
  font-size: 9.5px;
  color: var(--color-state-attention-text);
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
.cn-findings::-webkit-scrollbar,
.cn-transcript::-webkit-scrollbar {
  width: 10px;
}

.cn-main::-webkit-scrollbar-track,
.cn-rail::-webkit-scrollbar-track,
.cn-findings::-webkit-scrollbar-track,
.cn-transcript::-webkit-scrollbar-track {
  background: transparent;
}

.cn-main::-webkit-scrollbar-thumb,
.cn-rail::-webkit-scrollbar-thumb,
.cn-findings::-webkit-scrollbar-thumb,
.cn-transcript::-webkit-scrollbar-thumb {
  background: var(--color-border-badge);
  border-radius: 5px;
  border: 3px solid transparent;
  background-clip: padding-box;
}

.cn-main::-webkit-scrollbar-thumb:hover,
.cn-rail::-webkit-scrollbar-thumb:hover,
.cn-findings::-webkit-scrollbar-thumb:hover,
.cn-transcript::-webkit-scrollbar-thumb:hover {
  background: var(--color-logo-bar-low);
  background-clip: padding-box;
}
</style>
