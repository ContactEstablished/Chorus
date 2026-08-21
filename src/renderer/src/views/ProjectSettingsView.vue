<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  PROJECT_DESCRIPTION_MAX,
  type AdapterDescriptor,
  type ProjectImpact
} from '../../../shared/ipc'
import {
  describeArchive,
  describeHide,
  describeProjectDeletion
} from '../../../shared/projectLifecycle'
import { PROJECT_COLORS, PROJECT_COLOR_PATTERN } from '../../../shared/projectColors'
import { resolveChipHex } from '../projectChip'
import { useProjectStore } from '../stores/project'
import { useMemoryStore } from '../stores/memory'
import {
  MEMORY_USAGE_LOWER_BOUND_NOTE,
  PROVENANCE_DISCLAIMER,
  affectedLabel
} from '../../../shared/provenance'

/**
 * Project settings — a full-window view, the fourth, built on the same shape
 * SettingsView established (left nav beside a content region, "back to
 * workspace" pinned at the bottom and bound to Esc, which yields to any open
 * overlay).
 *
 * ⚠ IT IS REACHED TWO WAYS AND THE DIFFERENCE MATTERS. The rail's per-project
 * gear opens it for a project the user already has; `Add project` opens it
 * IMMEDIATELY AFTER the folder picker, as the last step of creating one. In
 * both cases the row already exists in the database — nothing here creates a
 * project, so leaving without saving is always safe and never strands a
 * half-made row. That is why the picker still runs first and why this screen
 * has no "cancel the whole thing" path: there is nothing to unwind.
 */
const props = defineProps<{
  projectId: string
  overlayOpen: boolean
  /** True only for the `Add project` entry above — the screen is otherwise
   *  identical, and this changes exactly one thing: see `canSave`. */
  isNew: boolean
}>()
/**
 * `saved` fires when the screen is DONE — either a write main accepted, or (on
 * a brand-new project) an untouched form the user affirmed. It carries the
 * project id because App, not this screen, owns what that leads to (the toast,
 * and the return to the workspace). A FAILED save emits nothing and stays put:
 * the error belongs beside the form that caused it.
 */
const emit = defineEmits<{
  close: []
  saved: [projectId: string, wrote: boolean]
  /** ⚠ A THIRD EVENT, DISTINCT FROM `close`. The project this screen is editing
   *  no longer exists, so App must switch to the workspace BEFORE the list
   *  reloads — a plain close would race it onto the `Loading project…` branch. */
  deleted: [projectId: string]
}>()

const store = useProjectStore()

/** The row being edited, read live from the store — NOT copied at mount. The
 *  form fields below are the copy; this stays the truth to reset against. */
const project = computed(() => store.projects.find((p) => p.id === props.projectId) ?? null)

/**
 * The colour this project is ALREADY being drawn with: its stored one, or the
 * seeded-cycle token the rail falls back to for a pre-v13 row, resolved to hex.
 *
 * ⚠ THIS SCREEN MUST NOT INVENT A STARTING COLOUR. Seeding the picker from the
 * first palette entry (the obvious shortcut) told a project whose rail chip is
 * violet that jade was selected — a contradiction visible in the same window,
 * and one that would have silently repainted the project on the next save.
 *
 * ⚠ THE `findIndex` THAT USED TO FEED THIS IS GONE (v15), NOT KEPT AS A
 * FALLBACK. It computed the project's position in the store, which was the
 * rail's colour input until the rail learned to partition and reorder. Leaving
 * it here as a spare answer would leave TWO answers to "what colour is this
 * project" alive in the very file whose docstring exists because two surfaces
 * once disagreed — and the dead one would be the one that looked reasonable.
 * `color_seed` is the row's own, and it is the only input.
 */
function currentChipHex(): string {
  return resolveChipHex(project.value?.color ?? null, project.value?.color_seed ?? 0)
}

/* ------------------------------------------------------------------ */
/* Form state                                                          */
/* ------------------------------------------------------------------ */

const name = ref('')
const description = ref('')
// ⚠ Explicitly `string`. `PROJECT_COLORS` is `as const`, so an inferred ref
// would be narrowed to the literal type of the first swatch and reject every
// other colour — including anything the OS picker returns.
const color = ref<string>(PROJECT_COLORS[0].hex)

/** Seed the form from the row, and RE-seed if the id changes under us (the
 *  gear on a different project while this view is open). `immediate` covers
 *  the first paint; without it the fields would be blank until the next
 *  `project:list`. */
watch(
  project,
  (p) => {
    if (!p) return
    name.value = p.name
    description.value = p.description ?? ''
    // Not `p.color ?? <first swatch>`: a pre-v13 project has no stored colour
    // but IS being drawn in one, and that is the colour to open on.
    color.value = currentChipHex()
  },
  { immediate: true }
)

const trimmedName = computed(() => name.value.trim())
const nameValid = computed(() => trimmedName.value.length > 0 && trimmedName.value.length <= 120)
const descriptionRemaining = computed(() => PROJECT_DESCRIPTION_MAX - description.value.length)

/** Nothing to save is its own state — the button says so rather than writing a
 *  no-op row and flashing "Saved". */
const dirty = computed(() => {
  const p = project.value
  if (!p) return false
  return (
    trimmedName.value !== p.name ||
    description.value !== (p.description ?? '') ||
    color.value.toLowerCase() !== currentChipHex().toLowerCase()
  )
})

const saving = ref(false)
const error = ref<string | null>(null)

let alive = true

/**
 * When the button is live.
 *
 * ⚠ `isNew` IS AN OR, NOT A REPLACEMENT FOR `dirty`. On an EXISTING project a
 * clean form still disables the button — the reason has not changed: nothing to
 * save is its own state, and arming Save would only offer to rewrite the row
 * with what it already holds. But on a BRAND-NEW one the button is also the way
 * OUT of the create flow, and a user happy with the folder's name and the
 * default colour has nothing to make dirty — they met a dead control and had to
 * find `back to workspace` to finish adding a project.
 */
const canSave = computed(
  () => nameValid.value && !saving.value && (dirty.value || props.isNew)
)

async function save(): Promise<void> {
  // The button's own condition, re-read: Enter in the name field lands here
  // too, and it must not be a second door with different rules.
  if (!canSave.value || !project.value) return
  // Nothing to write. Only reachable on a new project, where this IS the
  // affirmative finish — main already stamped the row with these exact values,
  // so a write would be a no-op round-trip.
  if (!dirty.value) {
    emit('saved', props.projectId, false)
    return
  }
  saving.value = true
  error.value = null
  try {
    await store.update({
      project_id: props.projectId,
      name: trimmedName.value,
      color: color.value,
      // Sent RAW (not trimmed): main folds an all-whitespace description to
      // null, and trimming here as well would mean two places deciding what
      // "empty" is. Deliberate leading indentation in notes survives.
      description: description.value
    })
    if (!alive) return
    // ⚠ THE SCREEN NO LONGER SAYS "Saved" TO ITSELF. It reports the save and
    // App takes the user back to the workspace, where the toast lands — so the
    // confirmation outlives this view rather than being unmounted with it.
    emit('saved', props.projectId, true)
  } catch (e) {
    if (!alive) return
    // Main's message, not a generic one — a rejected colour and an unknown
    // project id are different problems and should not read identically.
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    if (alive) saving.value = false
  }
}

/* ------------------------------------------------------------------ */
/* The colour controls                                                 */
/* ------------------------------------------------------------------ */

/** The hidden `<input type="color">` behind the custom swatch — the OS colour
 *  picker, reached by clicking the box, exactly as it works on a web page. */
const colorInput = ref<HTMLInputElement | null>(null)

function openColorPicker(): void {
  colorInput.value?.click()
}

/**
 * `<input type="color">` emits `#rrggbb` in every engine Electron ships, but
 * this is the ONE value on this screen that a user gesture produces rather
 * than the app, so it is checked against the same pattern main will apply.
 * Rejecting it here means the Save button never arms with a value the write
 * would bounce.
 */
function onCustomColor(e: Event): void {
  const v = (e.target as HTMLInputElement).value
  if (PROJECT_COLOR_PATTERN.test(v)) color.value = v.toLowerCase()
}

/** True when the current colour is NOT one of the curated twelve — that is
 *  what puts the ring on the custom box instead of on a palette swatch. */
const isCustomColor = computed(
  () => !PROJECT_COLORS.some((c) => c.hex.toLowerCase() === color.value.toLowerCase())
)

/* ------------------------------------------------------------------ */
/* Project lifecycle — hide, archive, delete (D120–D124)               */
/* ------------------------------------------------------------------ */

/**
 * ⚠ THE LIFECYCLE ACTIONS LIVE HERE AND NOT IN THE RAIL, and that was a layout
 * decision before it was a safety one. The rail's per-project gear is already
 * an absolutely-positioned SIBLING of the row button (a button inside a button
 * is invalid HTML and browsers resolve it by dropping one); a second and third
 * sibling on a 208px row is unworkable, and there is no popover primitive in
 * this app to reuse. The safety consequence is the better half of the trade:
 * DELETE IS REACHABLE FROM EXACTLY ONE PLACE, and that place is a full screen
 * you had to navigate to.
 */
const lifecycleBusy = ref(false)
const lifecycleError = ref<string | null>(null)
const lifecycleNote = ref<string | null>(null)

/* ------------------------------------------------------------------ */
/* Memory (Task 6-3)                                                   */
/* ------------------------------------------------------------------ */

const memoryStore = useMemoryStore()
const boltUri = ref('')
const memoryError = ref<string | null>(null)
const memorySaving = ref(false)

const memoryStatus = computed(() => memoryStore.statusFor(props.projectId))
const memoryConnection = computed(() => memoryStore.connectionFor(props.projectId))
const memoryTesting = computed(() => memoryStore.isTesting(props.projectId))
const memoryProbe = computed(() => memoryStore.lastProbeByProject[props.projectId] ?? null)
/**
 * Task 6b-2 (D169): what the last launch into this project observed.
 *
 * ⚠ SEPARATE FROM THE CHIP ABOVE, NOT FOLDED INTO IT. The chip's `Connected`
 * is earned by the Test button's observed read and names the probe number it
 * returned; a launch has no probe number, so this states its own fact on its
 * own line rather than borrowing a sentence it cannot honestly complete.
 */
const memoryLaunch = computed(() => memoryStore.launchFor(props.projectId))
/** Local wall-clock, because the only question a reader has is "was that this
 *  session or ten minutes ago" — a date would be noise for a fact that cannot
 *  outlive the app's own run. */
const memoryLaunchAt = computed(() => {
  const at = memoryLaunch.value?.at
  if (!at) return ''
  const d = new Date(at)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
})
const memoryBusy = computed(() => memorySaving.value || memoryTesting.value)

/**
 * Load on mount and on project switch. ⚠ NO TIMER, AND THE ABSENCE IS THE
 * RULING. `memory:status` is pollable because main's handler is a pure read;
 * that is not a reason to poll it. In Stage 2 Chorus starts no container, so the
 * configured state cannot change behind the app's back — a 15-second loop would
 * be machinery invented for a fact that cannot move, and one refactor away from
 * the unattended-decrypt loop D33/D53/D58 forbid outright.
 */
watch(
  () => props.projectId,
  async (id) => {
    memoryError.value = null
    if (!id) return
    await memoryStore.load(id)
    // Seed the field from what is stored, so Update edits rather than retypes.
    // ⚠ REBUILT FROM HOST AND PORT, NOT READ BACK FROM A STORED STRING — the
    // payload deliberately carries no URI (it is the one string that could
    // embed a credential), so the form composes one from the two facts it does
    // carry.
    const s = memoryStore.statusFor(id)
    boltUri.value = s?.configured && s.host ? `bolt://${s.host}:${s.port}` : ''
  },
  { immediate: true }
)

/* ------------------------------------------------------------------ */
/* Memory: what each agent is given (Task 6-5)                         */
/* ------------------------------------------------------------------ */

/**
 * ⚠ READ OFF EACH ADAPTER'S OWN DESCRIPTOR, NOT HARDCODED HERE. The renderer
 * holds no list of which agent uses which mechanism — that fact has one home,
 * `getCapabilities().mcp`, and a second copy in a `.vue` file is the copy that
 * would still say "opencode: none" a release after it stopped being true.
 */
const mcpAgents = ref<{ id: string; displayName: string; where: string }[]>([])

function describeMcp(a: AdapterDescriptor): string | null {
  const mcp = a.capabilities.mcp
  if (!mcp) return null
  if (mcp.mechanism === 'launch-args') return 'launch arguments — no file is written'
  // ⚠ "the folder the session runs in", NOT "this project's folder". A
  // new-worktree launch runs in its own checkout and the file is written there,
  // so naming the project would be telling the user to look in the wrong place.
  if (mcp.mechanism === 'project-file') return `${mcp.configPath}, in the folder the session runs in`
  return `a file Chorus owns, found through ${mcp.pathEnvVar ?? 'an environment variable'}`
}

onMounted(async () => {
  try {
    const adapters = await window.chorus.listAdapters()
    mcpAgents.value = adapters.flatMap((a) => {
      const where = describeMcp(a)
      return where ? [{ id: a.id, displayName: a.displayName, where }] : []
    })
  } catch {
    // ⚠ A DISCLOSURE THAT CANNOT LOAD SIMPLY DOES NOT RENDER. It is
    // explanatory text beside a working form; failing the whole settings screen
    // over it would be the wrong trade.
  }

  // Task 6a-4. Both reads happen ON OPEN and never on a timer (D58) — a poll
  // would spawn a docker process every few seconds for a screen nobody is
  // looking at.
  try {
    dockerDetected.value = (await window.chorus.detectClis()).some(
      (c) => c.name === 'docker' && c.found
    )
  } catch {
    // ⚠ UNDETECTED IS THE SAFE DEFAULT: the Provision button stays hidden, and
    // the rest of the memory form still works against a database the user
    // started themselves — which is exactly what Phase 6 shipped.
  }
  // Only ask docker about a container when the row says there is one; for every
  // other project this would be a process spawn to learn nothing.
  if (memoryStatus.value?.configured) await memoryStore.refreshContainer(props.projectId)
})

async function saveMemory(): Promise<void> {
  memoryError.value = null
  memorySaving.value = true
  try {
    // D14: primitives read out of refs, never a reactive object across the
    // bridge.
    const reason = await memoryStore.configure(
      props.projectId,
      'existing',
      'none',
      boltUri.value.trim(),
      'neo4j'
    )
    // Rendered verbatim — never enriched with the value that caused it, which
    // for this field would mean echoing whatever was typed into it.
    if (reason) memoryError.value = reason
  } finally {
    memorySaving.value = false
  }
}

/** ⚠ ONE live connect, and this click is the only thing that starts one (D58). */
async function testMemory(): Promise<void> {
  memoryError.value = null
  const reason = await memoryStore.test(props.projectId)
  if (reason) memoryError.value = reason
}

/* ---- Task 6-4: the graph schema and the provenance count ---------- */

const memorySeed = computed(() => memoryStore.seedByProject[props.projectId] ?? null)
const memoryValidation = computed(() => memoryStore.validationByProject[props.projectId] ?? null)
/** Task 6b-1 (D168): the memory-usage roll-up, recorded on both branches of
 *  `memory:validate`. Its sentences are built in main; this view only shows them. */
const memoryUsage = computed(() => memoryStore.usageByProject[props.projectId] ?? null)
/** The lower-bound disclosure, imported as a constant rather than typed here so
 *  the suite can assert it exists and what it says (D173 Q2). */
const memoryUsageLowerBoundNote = MEMORY_USAGE_LOWER_BOUND_NOTE
const memorySeeding = computed(() => memoryStore.seedingByProject[props.projectId] ?? false)
const memoryValidating = computed(() => memoryStore.validatingByProject[props.projectId] ?? false)

/** The disclaimer is imported from the pure core rather than written here, so
 *  there is ONE wording and a test can assert what it does not say. */
const provenanceDisclaimer = PROVENANCE_DISCLAIMER

/** ⚠ THE AFFECTED LIST'S OWN DENOMINATOR (D55, one level down). A bounded list
 *  rendered bare looks complete — the label says "showing 50 of 469" when it is
 *  truncated, and it is computed by the tested core, not here. */
const affectedLabelText = computed(() =>
  memoryValidation.value
    ? affectedLabel(memoryValidation.value.affected.length, memoryValidation.value.affectedTotal)
    : ''
)

/** ⚠ IT WRITES TO THE GRAPH, so it is a click and nothing else (D58). */
async function seedMemory(): Promise<void> {
  memoryError.value = null
  const reason = await memoryStore.seed(props.projectId)
  if (reason) memoryError.value = reason
}

/* ---- Task 6a-2: the structural index ------------------------------ */

const memoryIndex = computed(() => memoryStore.indexByProject[props.projectId] ?? null)
const memoryIndexing = computed(() => memoryStore.indexingByProject[props.projectId] ?? false)

/** The report as ONE sentence. Assembled here rather than in the template
 *  because the template must not do arithmetic, and the optional clauses only
 *  appear when they are non-zero — a zero rendered as prose reads as a
 *  problem. */
const indexSummary = computed(() => {
  const r = memoryIndex.value
  if (r === null) return ''
  const files = `${r.filesSeen} file${r.filesSeen === 1 ? '' : 's'}`
  const dirs = `${r.directories} folder${r.directories === 1 ? '' : 's'}`
  const commits =
    r.repoId === null
      ? ', and no commits — this project has no git history'
      : `, and ${r.commitsLinked} commit${r.commitsLinked === 1 ? '' : 's'}`
  return `Indexed ${files} in ${dirs}${commits}.`
})

/** ⚠ EVERY ONE OF THESE IS A TRUNCATION OR A LOSS, AND IS SHOWN ONLY WHEN
 *  NON-ZERO. A cap nobody is told about reads as "we covered everything". */
const indexCaveats = computed(() => {
  const r = memoryIndex.value
  if (r === null) return [] as string[]
  const out: string[] = []
  if (r.filesMarkedMissing > 0) {
    out.push(
      `${r.filesMarkedMissing} file${r.filesMarkedMissing === 1 ? '' : 's'} ${r.filesMarkedMissing === 1 ? 'is' : 'are'} no longer in the tree and ${r.filesMarkedMissing === 1 ? 'is' : 'are'} marked, not deleted.`
    )
  }
  if (r.commitsSkippedBeyondLimit > 0) {
    out.push(
      `History beyond the newest ${r.commitsLinked} commits was not indexed (${r.commitsSkippedBeyondLimit} older ${r.commitsSkippedBeyondLimit === 1 ? 'commit' : 'commits'} skipped).`
    )
  }
  if (r.pathsSkippedUnparseable > 0) {
    out.push(
      `${r.pathsSkippedUnparseable} path${r.pathsSkippedUnparseable === 1 ? '' : 's'} could not be read and ${r.pathsSkippedUnparseable === 1 ? 'was' : 'were'} skipped rather than guessed at.`
    )
  }
  return out
})

/* ─────────────────── Task 6a-4: the provisioner ────────────────────────── */

/**
 * ⚠ THE PROVISION BUTTON APPEARS ONLY WHEN DOCKER IS DETECTED (D76: no control
 * that cannot work). Probed once when the screen opens — `detectClis` is
 * memoized for the life of the process, so this costs nothing after the first.
 */
const dockerDetected = ref(false)

/** The name the user must type to confirm removal. Cleared whenever the dialog
 *  closes, so a stale confirmation cannot be reused by a later click. */
const removeTypedName = ref('')
const removeOpen = ref(false)

const memoryContainer = computed(
  () => memoryStore.containerByProject[props.projectId] ?? null
)
const containerBusy = computed(
  () => memoryStore.containerBusyByProject[props.projectId] ?? false
)

/** True when this project's database is one Chorus started — read from
 *  `row.mode`, NEVER inferred from `container_id` being non-null, so there is
 *  one answer to "is this ours". */
const isChorusManaged = computed(() => memoryStatus.value?.mode === 'local-docker')

/**
 * The state line, e.g. `chorus-chorus-3f2a9c11 · running · on 127.0.0.1:7688`.
 *
 * ⚠ IT NEVER RENDERS "published on" WITH NOTHING AFTER IT. A stopped container
 * reports empty ports (measured on docker 29.7.2), so the endpoint clause is
 * omitted rather than left dangling.
 */
const containerStateLine = computed(() => {
  const c = memoryContainer.value
  if (c === null || c.containerName === null) return ''
  if (!c.exists) {
    // ⚠ THE ROW SAID THERE WAS A CONTAINER AND DOCKER SAYS OTHERWISE. Saying so
    // is the honest read; echoing the row would be the stale claim.
    //
    // ⚠ AND IT DOES NOT SAY WHO REMOVED IT. An earlier draft read "removed
    // outside Chorus", which was FALSE the moment Chorus's own Remove button
    // produced this state — and unprovable in general, because docker reports
    // absence and never a cause. Found by clicking Remove and reading the line
    // it left behind.
    return `${c.containerName} · no longer exists`
  }
  const parts = [c.containerName, c.state ?? 'unknown']
  if (c.publishedAt) parts.push(`on ${c.publishedAt}`)
  return parts.join(' · ')
})

async function provisionMemory(): Promise<void> {
  memoryError.value = null
  const reason = await memoryStore.provision(props.projectId)
  if (reason) memoryError.value = reason
}

async function startContainer(): Promise<void> {
  memoryError.value = null
  const reason = await memoryStore.startContainer(props.projectId)
  if (reason) memoryError.value = reason
}

async function stopContainer(): Promise<void> {
  memoryError.value = null
  const reason = await memoryStore.stopContainer(props.projectId)
  if (reason) memoryError.value = reason
}

/**
 * ⚠ THE TYPED NAME IS SENT, NOT CHECKED HERE. Main compares it against the row
 * and refuses on a mismatch — this button being disabled is an affordance, and
 * the guard that matters is the one the command palette cannot walk past
 * (`project:delete`, D123).
 */
async function removeContainer(): Promise<void> {
  memoryError.value = null
  const reason = await memoryStore.removeContainer(props.projectId, removeTypedName.value)
  if (reason) memoryError.value = reason
  else {
    removeOpen.value = false
    removeTypedName.value = ''
  }
}

/** ⚠ IT WRITES TO THE GRAPH, so it is a click and nothing else (D58) — never a
 *  watcher, never a timer. */
async function indexMemory(): Promise<void> {
  memoryError.value = null
  const reason = await memoryStore.index(props.projectId)
  if (reason) memoryError.value = reason
}

async function validateMemory(): Promise<void> {
  memoryError.value = null
  const reason = await memoryStore.validate(props.projectId)
  if (reason) memoryError.value = reason
}

async function disableMemory(): Promise<void> {
  memoryError.value = null
  memorySaving.value = true
  try {
    const reason = await memoryStore.disable(props.projectId)
    if (reason) memoryError.value = reason
    else boltUri.value = ''
  } finally {
    memorySaving.value = false
  }
}

/** The counts, read from main before the confirmation is shown (D123/D109) —
 *  never guessed from the store, which has only `sessionCount`. */
const impact = ref<ProjectImpact | null>(null)
const confirmOpen = ref(false)
const typedName = ref('')

const deleteSentence = computed(() =>
  impact.value
    ? describeProjectDeletion(impact.value.name, {
        sessions: impact.value.sessions,
        worktrees: impact.value.worktrees,
        councilRuns: impact.value.council_runs,
        transcriptTurns: impact.value.transcript_turns
      })
    : ''
)

/** Exact equality, matching main's own check. This ARMS the button; main is
 *  what enforces it — one authority, on the side a mistaken renderer cannot
 *  skip. */
const canDelete = computed(
  () =>
    !!impact.value &&
    impact.value.live_sessions === 0 &&
    typedName.value === impact.value.name &&
    !lifecycleBusy.value
)

async function setStatus(status: 'hidden' | 'archived' | 'active'): Promise<void> {
  const p = project.value
  if (!p || lifecycleBusy.value) return
  // The archive confirmation is the one that has to be read: it stops running
  // agents, and that side effect does not come back when the status does.
  if (status === 'archived') {
    const live = await store.impact(p.id)
    if (!window.confirm(describeArchive(p.name, live.live_sessions))) return
  }
  lifecycleBusy.value = true
  lifecycleError.value = null
  lifecycleNote.value = null
  try {
    const stopped = await store.setStatus(p.id, status)
    if (!alive) return
    lifecycleNote.value =
      status === 'archived'
        ? `Archived${stopped > 0 ? ` — ${stopped === 1 ? '1 agent was stopped' : `${stopped} agents were stopped`}` : ''}.`
        : status === 'hidden'
          ? 'Hidden. It is still in the command palette.'
          : 'Back in the rail.'
  } catch (e) {
    if (alive) lifecycleError.value = e instanceof Error ? e.message : String(e)
  } finally {
    if (alive) lifecycleBusy.value = false
  }
}

/** Hide states its contrast with archive before it happens — the two controls
 *  sit next to each other and one of them stops the user's agents. */
async function hide(): Promise<void> {
  const p = project.value
  if (!p) return
  if (!window.confirm(describeHide(p.name))) return
  await setStatus('hidden')
}

async function openDeleteConfirm(): Promise<void> {
  const p = project.value
  if (!p) return
  lifecycleError.value = null
  typedName.value = ''
  try {
    impact.value = await store.impact(p.id)
    if (alive) confirmOpen.value = true
  } catch (e) {
    if (alive) lifecycleError.value = e instanceof Error ? e.message : String(e)
  }
}

async function confirmDelete(): Promise<void> {
  const p = project.value
  if (!p || !canDelete.value) return
  lifecycleBusy.value = true
  lifecycleError.value = null
  try {
    await store.remove(p.id, typedName.value)
    if (!alive) return
    confirmOpen.value = false
    // ⚠ `deleted` RATHER THAN `close`, AND THE DIFFERENCE IS A BUG THIS AVOIDS.
    // App.vue must set `activeView = 'workspace'` BEFORE this screen's project
    // id can resolve to nothing; emitting a plain close would leave the view
    // open for a project that no longer exists, landing on the permanent
    // `Loading project…` branch below with no way out but the keyboard.
    emit('deleted', p.id)
  } catch (e) {
    if (alive) {
      lifecycleError.value = e instanceof Error ? e.message : String(e)
      lifecycleBusy.value = false
    }
  }
}

/* ------------------------------------------------------------------ */
/* Esc / lifecycle                                                     */
/* ------------------------------------------------------------------ */

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  alive = false
  window.removeEventListener('keydown', onKeydown)
})

function onKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  // An overlay above the view owns Esc first — the SettingsView rule, for its
  // reason: closing the view out from under an open palette strands its focus.
  if (props.overlayOpen) return
  emit('close')
}
</script>

<template>
  <div class="flex h-full">
    <nav class="ps-nav">
      <div class="ps-nav-eyebrow">PROJECT</div>
      <div class="ps-nav-item">
        <div class="ps-nav-spine" :style="{ '--chip': color }"></div>
        <span class="ps-nav-label">{{ trimmedName || 'Untitled project' }}</span>
      </div>
      <div class="flex-1"></div>
      <button class="ps-back" @click="emit('close')">
        <svg
          width="11"
          height="11"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          stroke-width="1.2"
        >
          <path d="M7 2H3v8h6V4z" />
          <path d="M7 2v2h2" />
        </svg>
        back to workspace
        <span class="flex-1"></span>
        <span class="ps-keycap">esc</span>
      </button>
    </nav>

    <div class="ps-content">
      <!-- The row can be missing for exactly one moment: the view is open and
           `project:list` has not returned. Saying so beats an empty form the
           user might start typing into. -->
      <div v-if="!project" class="ps-empty">Loading project…</div>

      <template v-else>
        <header class="ps-header">
          <h1 class="ps-title">Project settings</h1>
          <p class="ps-path" :title="project.root_path">{{ project.root_path }}</p>
        </header>

        <section class="ps-section">
          <label class="ps-label" for="ps-name">Name</label>
          <p class="ps-hint">
            Defaults to the folder name. This is what the rail and the window title show.
          </p>
          <input
            id="ps-name"
            v-model="name"
            class="ps-input"
            type="text"
            maxlength="120"
            spellcheck="false"
            placeholder="Project name"
            @keydown.enter="save"
          />
          <p v-if="!nameValid" class="ps-error-inline">A project needs a name.</p>
        </section>

        <section class="ps-section">
          <label class="ps-label" for="ps-description">Description</label>
          <p class="ps-hint">
            Notes for yourself. Shown only on this screen — never in the rail or the workspace.
          </p>
          <textarea
            id="ps-description"
            v-model="description"
            class="ps-textarea"
            :maxlength="PROJECT_DESCRIPTION_MAX"
            rows="6"
            placeholder="What this project is, what you're working towards, anything worth remembering…"
          />
          <!-- A live counter, because the cap is one the user can reach by
               typing. It only starts warning near the end — a counter that
               shouts from character one is noise. -->
          <p class="ps-counter" :class="{ 'ps-counter-low': descriptionRemaining <= 100 }">
            {{ descriptionRemaining }} characters remaining
          </p>
        </section>

        <section class="ps-section">
          <span class="ps-label">Colour</span>
          <p class="ps-hint">
            The chip beside this project in the rail. It glows while the project is selected.
          </p>

          <div class="ps-swatches">
            <button
              v-for="c in PROJECT_COLORS"
              :key="c.hex"
              type="button"
              class="ps-swatch"
              :class="{ 'ps-swatch-on': c.hex.toLowerCase() === color.toLowerCase() }"
              :style="{ '--chip': c.hex }"
              :title="c.name"
              :aria-label="c.name"
              :aria-pressed="c.hex.toLowerCase() === color.toLowerCase()"
              @click="color = c.hex"
            />

            <!-- The custom box: a swatch showing the CURRENT colour, which
                 opens the OS picker. It is the same control an HTML page gets
                 — `<input type="color">` — with the native input itself kept
                 out of the layout so the grid stays one consistent row of
                 boxes rather than a row plus a browser widget. -->
            <button
              type="button"
              class="ps-swatch ps-swatch-custom"
              :class="{ 'ps-swatch-on': isCustomColor }"
              :style="{ '--chip': color }"
              title="Choose any colour"
              aria-label="Choose any colour"
              @click="openColorPicker"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                stroke-width="1.2"
                stroke-linecap="round"
                aria-hidden="true"
              >
                <path d="M6 2.5v7M2.5 6h7" />
              </svg>
            </button>
            <input
              ref="colorInput"
              class="ps-color-native"
              type="color"
              :value="color"
              tabindex="-1"
              aria-hidden="true"
              @input="onCustomColor"
            />
          </div>

          <div class="ps-color-readout">
            <span class="ps-chip-preview" :style="{ '--chip': color }" />
            <code class="ps-hex">{{ color.toUpperCase() }}</code>
          </div>
        </section>

        <!-- ⚠ MEMORY LIVES HERE, NOT IN A NEW SETTINGS ROUTE, AND THE RULING IS
             RECORDED RATHER THAN ASSUMED (proposed D131, Task 6-3).
             ImplementationSpec-6-3 §6 originally said "a new Settings route
             beside Credentials and Providers". THAT STRUCTURE DOES NOT EXIST:
             SettingsView.vue is 78 lines with ONE nav entry and no router, and
             SettingsCredentials.vue is a CHILD of SettingsProviders.vue, not a
             route. `project_memory` is keyed by project_id, so a global screen
             would have to own a project selector duplicating the rail — a whole
             navigation mechanism, built to reach a per-project fact. The spec
             is not wrong, it is stale: it predates this file (Phase 3h). -->
        <section class="ps-section">
          <span class="ps-label">Memory</span>
          <p class="ps-hint">
            Point this project at a Neo4j so its agents can read and write a shared memory
            graph. Chorus can start one for you, or you can run your own and give Chorus its
            address. This release connects only to a Neo4j with authentication disabled.
          </p>

          <!-- ⚠ ONLY FOR A PROJECT WITH NO MEMORY, AND ONLY WHEN DOCKER IS
               DETECTED. D76: a control that cannot work is not drawn. A user
               without docker sees the address form below and nothing missing. -->
          <div v-if="!memoryStatus?.configured && dockerDetected" class="ps-lifecycle-row">
            <button class="ps-btn-quiet" :disabled="containerBusy" @click="provisionMemory">
              {{ containerBusy ? 'Starting a database…' : 'Start a database for me' }}
            </button>
            <span class="ps-lifecycle-state">
              Runs Neo4j in Docker on this machine only.
            </span>
          </div>
          <p v-if="!memoryStatus?.configured && dockerDetected" class="ps-hint ps-hint-tight">
            <!-- ⚠ THE LOOPBACK PROMISE IS STATED, because it is the reason this
                 is safe to offer with authentication disabled. -->
            The database is reachable only from this computer (127.0.0.1) and has no password,
            which is why it must never be published to your network. The first run downloads
            about 600 MB and can take a few minutes.
          </p>

          <label class="ps-label ps-label-sub" for="ps-bolt">Address</label>
          <input
            id="ps-bolt"
            v-model="boltUri"
            class="ps-input"
            type="text"
            spellcheck="false"
            placeholder="bolt://127.0.0.1:7687"
            :disabled="memoryBusy"
          />
          <!-- ⚠ SAID BEFORE THEY TYPE IT, NOT AFTER THEY ARE REFUSED. The
               refusal exists and is authored, but a field that only explains
               itself once you have already pasted a password has already had
               the password pasted into it. -->
          <p class="ps-hint ps-hint-tight">
            Host and port only. Do not include a username or password — Chorus never stores
            one in a connection string.
          </p>

          <div class="ps-lifecycle-row ps-memory-row">
            <button class="ps-btn-quiet" :disabled="memoryBusy || !boltUri.trim()" @click="saveMemory">
              {{ memoryStatus?.configured ? 'Update' : 'Connect' }}
            </button>
            <button
              v-if="memoryStatus?.configured"
              class="ps-btn-quiet"
              :disabled="memoryBusy"
              @click="testMemory"
            >
              {{ memoryTesting ? 'Testing…' : 'Test connection' }}
            </button>
            <button
              v-if="memoryStatus?.configured"
              class="ps-btn-quiet"
              :disabled="memoryBusy"
              @click="disableMemory"
            >
              Turn off
            </button>
          </div>

          <!-- ⚠ D76: NOTHING RENDERS HERE FOR A PROJECT WITH NO MEMORY. No
               placeholder row, no "not configured" chip, no skeleton. -->
          <template v-if="memoryStatus?.configured">
            <p class="ps-memory-state">
              <span class="ps-memory-dot" :class="`ps-memory-dot-${memoryConnection}`" />
              <!-- ⚠ WHAT THIS MAY CLAIM IS BOUNDED BY D126. `Connected` is
                   earned by an OBSERVED read and is a session-lifetime fact —
                   never a stored column — so a fresh launch says "not tested
                   yet" even for a database that answered a minute before the
                   restart. That is the honest state, not a regression. -->
              {{
                memoryConnection === 'connected'
                  ? `Connected — the database answered (${memoryProbe}).`
                  : memoryConnection === 'failed'
                    ? 'Failed — the last test did not reach the database.'
                    : 'Configured — not tested since Chorus started.'
              }}
            </p>
            <!-- ⚠ D169: THE LAUNCH-TIME FACT, AND IT IS ALLOWED TO SAY THE
                 GRAPH ANSWERED because the observation is a successful WRITE —
                 strictly stronger than the read D126 required. It renders only
                 after a launch has actually happened; there is no "no launches
                 yet" placeholder, for D76's reason. -->
            <p v-if="memoryLaunch" class="ps-hint ps-hint-tight ps-memory-launch">
              {{
                memoryLaunch.reachable
                  ? `Last launch (${memoryLaunchAt}): the graph answered — the memory contract was sent to ${memoryLaunch.agent}.`
                  : `Last launch (${memoryLaunchAt}): memory graph unreachable — contract withheld. ${memoryLaunch.agent} launched without it.`
              }}
            </p>
            <p class="ps-hint ps-hint-tight">
              {{ memoryStatus.host }}:{{ memoryStatus.port }} · database
              {{ memoryStatus.database_name }}
            </p>
            <!-- ⚠ THE DISTINCTION A USER WILL OTHERWISE GET WRONG, stated at
                 the control rather than in a tooltip. -->
            <p class="ps-hint ps-hint-tight">
              Turning memory off removes Chorus's record of where the database is. It does not
              delete anything inside Neo4j.
            </p>

            <!-- ⚠ TASK 6-5's DISCLOSURE, AND WHAT IT DELIBERATELY DOES NOT SAY.
                 There is NO per-agent green light here. D126 Q6 makes
                 `Connected` a state earned by an OBSERVED read, and Chorus
                 observes one place only: the Test button above, which probes
                 the database directly. Nothing in Chorus watches an agent's own
                 connection, so a per-agent dot would mean "we wrote a file" —
                 precisely the dishonest green this phase's review existed to
                 prevent. What CAN be stated truthfully is what gets written and
                 where, and that writing it is not the same as connecting.

                 ⚠ AND THE APPROVAL SENTENCE IS CAPABILITY-NEUTRAL, NOT
                 CLAUDE-SHAPED (D126 Q4). Claude Code is measured to gate a
                 Chorus-written server behind interactive approval; whether the
                 others do is unverified, so the text assumes neither. -->
            <template v-if="mcpAgents.length > 0">
              <p class="ps-hint ps-hint-tight">
                When you launch a session in this project, Chorus writes the memory server into
                that agent's own configuration:
              </p>
              <ul class="ps-mcp-list">
                <li v-for="a in mcpAgents" :key="a.id" class="ps-mcp-row">
                  <span class="ps-mcp-agent">{{ a.displayName }}</span>
                  <span class="ps-mcp-where">{{ a.where }}</span>
                </li>
              </ul>
              <p class="ps-hint ps-hint-tight">
                Writing that configuration is not the same as connecting. An agent may ask you to
                approve the new server before it will use it — Claude Code does, and shows it as
                pending until you say yes in the pane. Chorus never approves a server on your
                behalf. The state above describes Chorus's own connection to the database, not any
                agent's.
              </p>
            </template>
          </template>

          <p v-if="memoryError" class="ps-error-inline">{{ memoryError }}</p>
        </section>

        <!-- ⚠ THE SCHEMA AND PROVENANCE SECTION IS ONLY SHOWN FOR A PROJECT
             THAT HAS MEMORY CONFIGURED (D76 again). There is nothing honest to
             say about the schema of a database nobody has named. -->
        <section v-if="memoryStatus?.configured" class="ps-section">
          <span class="ps-label">Memory schema</span>
          <p class="ps-hint">
            The graph keeps its own record of how it is set up. Chorus reads that record — not its
            own copy — so a graph restored from a backup, or shared with another install, reports
            what it actually has.
          </p>

          <div class="ps-lifecycle-row ps-memory-row">
            <button class="ps-btn-quiet" :disabled="memorySeeding" @click="seedMemory">
              {{ memorySeeding ? 'Applying…' : 'Apply schema' }}
            </button>
            <span class="ps-lifecycle-state">Schema version {{ memoryStatus.schema_version }}</span>
          </div>

          <template v-if="memorySeed">
            <p class="ps-memory-state">
              <span class="ps-memory-dot ps-memory-dot-connected" />
              {{
                memorySeed.applied.length === 0
                  ? `Already up to date at version ${memorySeed.toVersion} — nothing to apply.`
                  : `Applied ${memorySeed.applied.length === 1 ? '1 step' : `${memorySeed.applied.length} steps`}: version ${memorySeed.fromVersion} to ${memorySeed.toVersion}.`
              }}
            </p>
            <!-- ⚠ THE DISAGREEMENT IS SHOWN, NOT CORRECTED SILENTLY. It is the
                 one observation that demonstrates which of the two is the
                 authority, and a user seeing it is a user who has learned
                 something true about their graph. -->
            <p v-if="memorySeed.cacheWasStale" class="ps-hint ps-hint-tight">
              Chorus had recorded version {{ memorySeed.cachedVersion }} for this project, but the
              graph itself reported {{ memorySeed.fromVersion }}. The graph wins — Chorus's copy has
              been corrected.
            </p>
          </template>

          <!-- ⚠ ONLY FOR A DATABASE CHORUS STARTED. `isChorusManaged` reads
               `row.mode`, never `container_id !== null`, so an adopted or
               hand-removed container cannot change what this section claims. -->
          <div v-if="isChorusManaged" class="ps-provenance">
            <span class="ps-label">The database Chorus started</span>

            <div class="ps-lifecycle-row">
              <span v-if="containerStateLine" class="ps-lifecycle-state">
                {{ containerStateLine }}
              </span>
              <span v-else class="ps-lifecycle-state">Checking…</span>
            </div>

            <div class="ps-lifecycle-row">
              <!-- ⚠ THE WAY BACK FROM A VANISHED CONTAINER, AND IT WAS FOUND BY
                   CLICKING RATHER THAN BY READING. A container removed outside
                   Chorus leaves the project still configured as `local-docker`,
                   so the Provision button above (which renders only for an
                   UNCONFIGURED project) is hidden, while Start and Remove are
                   both disabled because there is nothing to act on. That is a
                   dead end: the only escape was to turn memory off and lose the
                   configuration. `provision` already adopts-or-creates, so it is
                   exactly the right verb here. -->
              <button
                v-if="!memoryContainer?.exists"
                class="ps-btn-quiet"
                :disabled="containerBusy || !dockerDetected"
                @click="provisionMemory"
              >
                {{ containerBusy ? 'Starting a database…' : 'Create it again' }}
              </button>
              <button
                v-else-if="!memoryContainer?.running"
                class="ps-btn-quiet"
                :disabled="containerBusy"
                @click="startContainer"
              >
                {{ containerBusy ? 'Working…' : 'Start' }}
              </button>
              <button
                v-else
                class="ps-btn-quiet"
                :disabled="containerBusy"
                @click="stopContainer"
              >
                {{ containerBusy ? 'Working…' : 'Stop' }}
              </button>
              <!-- ⚠ AND THE VANISHED CASE SAYS SO IN WORDS, not only by a
                   disabled button. A control that is greyed out with no reason
                   beside it reads as a broken app. -->
              <span v-if="!memoryContainer?.exists && !dockerDetected" class="ps-lifecycle-state">
                Docker is not available, so Chorus cannot recreate it.
              </span>
              <button
                class="ps-btn-quiet"
                :disabled="containerBusy || !memoryContainer?.exists"
                @click="removeOpen = !removeOpen"
              >
                Remove container…
              </button>
            </div>

            <!-- ⚠ THE THREE DESTRUCTIONS, STATED AT THE CONTROLS RATHER THAN IN
                 A TOOLTIP. A user will otherwise conflate them, and the third is
                 the one Chorus refuses to offer at all. -->
            <p class="ps-hint ps-hint-tight">
              <strong>Turning memory off</strong> forgets where the database is. Nothing inside
              it changes.
            </p>
            <p class="ps-hint ps-hint-tight">
              <strong>Removing the container</strong> stops and deletes the database process. Your
              data is kept, and starting a database again re-attaches it.
            </p>
            <p class="ps-hint ps-hint-tight">
              <!-- F49: durability is gated on an export/restore path that does
                   not exist, so no code path in Chorus may destroy a graph. This
                   is the only honest position while no backup exists — it is not
                   a limitation to apologise for. -->
              <strong>Deleting the data</strong> is something Chorus will not do. Until it can
              export and restore a graph, it will not offer to destroy one. If you really mean
              to, remove the volume yourself with
              <code>docker volume rm {{ memoryStatus?.mode === 'local-docker' && memoryContainer?.containerName ? memoryContainer.containerName + '-data' : '<name>' }}</code>.
            </p>

            <div v-if="removeOpen" class="ps-lifecycle-row">
              <!-- ⚠ THE TYPED CONFIRMATION. Main compares this against the row
                   and refuses on a mismatch; disabling the button here is an
                   affordance, not the guard (D123). -->
              <input
                v-model="removeTypedName"
                class="ps-input"
                type="text"
                :placeholder="memoryContainer?.containerName ?? ''"
                aria-label="Type the container name to confirm removal"
              />
              <button
                class="ps-btn-quiet"
                :disabled="containerBusy || removeTypedName !== memoryContainer?.containerName"
                @click="removeContainer"
              >
                Remove
              </button>
            </div>
            <p v-if="removeOpen" class="ps-hint ps-hint-tight">
              Type <strong>{{ memoryContainer?.containerName }}</strong> to confirm. The data
              volume is kept.
            </p>
          </div>

          <div class="ps-provenance">
            <span class="ps-label">Code structure</span>
            <!-- ⚠ THE LIMIT IS STATED AT THE CONTROL, NOT IN A TOOLTIP, and it
                 is a requirement of D149 rather than copy polish. The feature's
                 honest value is FINDING; a user who expects understanding will
                 conclude it is broken. -->
            <p class="ps-hint">
              This records <strong>where</strong> code lives — file, folder and commit names. It
              does not read your code: it cannot say what a function does or what calls it.
            </p>

            <div class="ps-lifecycle-row">
              <button
                class="ps-btn-quiet"
                :disabled="memoryBusy || memoryIndexing"
                @click="indexMemory"
              >
                {{ memoryIndexing ? 'Indexing…' : 'Index code' }}
              </button>
              <span v-if="memoryIndex" class="ps-lifecycle-state">{{ indexSummary }}</span>
            </div>

            <p v-for="c in indexCaveats" :key="c" class="ps-hint ps-hint-tight">{{ c }}</p>
          </div>

          <div class="ps-provenance">
            <span class="ps-label">Where memories came from</span>
            <!-- ⚠ THE HONEST SENTENCE IS THE FEATURE HERE, and it comes from the
                 pure core as a constant so it cannot drift into implying
                 enforcement. -->
            <p class="ps-hint">{{ provenanceDisclaimer }}</p>

            <div class="ps-lifecycle-row">
              <button class="ps-btn-quiet" :disabled="memoryValidating" @click="validateMemory">
                {{ memoryValidating ? 'Counting…' : 'Count sources' }}
              </button>
              <!-- ⚠ NEVER A BARE NUMBER AND NEVER A LONE PERCENTAGE (D55). The
                   "N of M" string is built in main by the tested core; this
                   template does no arithmetic and no string assembly. -->
              <span v-if="memoryValidation" class="ps-lifecycle-state">
                {{ memoryValidation.text }} carry a source
              </span>
            </div>

            <!-- Task 6b-1 (D168, amended by D173): the memory-usage roll-up.
                 ⚠ THE STRINGS COME FROM MAIN, BUILT BY THE TESTED CORE. This
                 template does no arithmetic and no assembly — the denominator is
                 already inside the sentence (D55), and so are the words
                 "successful" and "Claude Code" (D173 Q2).
                 `ps-memory-usage` / `ps-memory-breakdown` carry no styling of
                 their own: they are stable hooks for the runtime drive's CDP
                 reads (`_verify/6b-1/drive/`), which must find THESE sentences
                 and not a neighbour's. -->
            <p v-if="memoryUsage" class="ps-hint ps-hint-tight ps-memory-usage">
              {{ memoryUsage.text }}
            </p>
            <!-- The breakdown, absent when there is nothing to show. The
                 emptiness is decided by `memoryBreakdownLine` returning null,
                 not by a rule invented in this template. ⚠ `read-first` is the
                 milestone's own clause shown as a per-project trend; it is here
                 rather than in the line above because D173 fixed that line's
                 shape word for word. -->
            <p v-if="memoryUsage?.breakdownText" class="ps-hint ps-hint-tight ps-memory-breakdown">
              {{ memoryUsage.breakdownText }}
            </p>
            <!-- ⚠ NOT DECORATION. D168's honest statement is that EVERY tool
                 call's name passes through the comparison; this is the one place
                 a user is told so. CR-6b.0 (D173) added the Claude-only scope and
                 the lower-bound disclosure — the latter imported as a constant,
                 not typed here, so the suite can assert it exists. -->
            <p v-if="memoryUsage" class="ps-hint ps-hint-tight">
              Counted from the agents' own tool calls, and only for Claude Code panes — codex and the
              other agents have no hook bus, so their sessions cannot be measured here and are not
              counted. Chorus reads the
              NAME of each completed tool call and nothing else — never the query it sent or the
              answer it got — and counts only sessions that started after these counters were added.
              A call that failed is not counted. {{ memoryUsageLowerBoundNote }}
            </p>

            <template v-if="memoryValidation && memoryValidation.affectedTotal > 0">
              <p class="ps-hint ps-hint-tight">
                Missing a source ({{ affectedLabelText }}) — the number points at these:
              </p>
              <ul class="ps-affected">
                <li v-for="a in memoryValidation.affected" :key="a.id" class="ps-affected-row">
                  <code class="ps-affected-id">{{ a.id }}</code>
                  <span class="ps-affected-content">{{ a.content }}</span>
                  <span class="ps-affected-via">{{ a.writtenVia }}</span>
                </li>
              </ul>
            </template>

            <!-- ⚠ F49, STATED WHERE THE NUMBER IS READ RATHER THAN ONLY IN A
                 DOC. The number is computed from data the same tool can rewrite,
                 so a damaged graph could report itself healthy. -->
            <p class="ps-hint ps-hint-tight">
              Agents write to this graph with a query tool that can also change these records, so
              this count cannot detect a graph that has been damaged or rewritten. Backups are not
              part of this release.
            </p>
          </div>
        </section>

        <!-- ⚠ THE ONE DESTRUCTIVE DOOR IN THE APP'S PROJECT SURFACE, and the
             only place delete is offered at all. The rail's tucked rows carry
             Unhide/Unarchive and nothing else. -->
        <section class="ps-section ps-section-lifecycle">
          <span class="ps-label">Lifecycle</span>
          <p class="ps-hint">
            Hide a project to tidy the rail without touching its work. Archive one you have
            finished with. Both are reversible from the rail; deleting is not.
          </p>

          <div class="ps-lifecycle-row">
            <template v-if="project.status === 'active'">
              <button class="ps-btn-quiet" :disabled="lifecycleBusy" @click="hide">Hide</button>
              <button
                class="ps-btn-quiet"
                :disabled="lifecycleBusy"
                @click="setStatus('archived')"
              >
                Archive
              </button>
            </template>
            <template v-else>
              <button class="ps-btn-quiet" :disabled="lifecycleBusy" @click="setStatus('active')">
                {{ project.status === 'archived' ? 'Unarchive' : 'Unhide' }}
              </button>
              <span class="ps-lifecycle-state">
                {{
                  project.status === 'archived'
                    ? 'Archived — not in the rail, not launchable, everything kept.'
                    : 'Hidden — not in the rail, still running, still in the palette.'
                }}
              </span>
            </template>
          </div>

          <p v-if="lifecycleNote" class="ps-lifecycle-note">{{ lifecycleNote }}</p>
          <p v-if="lifecycleError" class="ps-error-inline">{{ lifecycleError }}</p>

          <div class="ps-danger">
            <div class="ps-danger-head">
              <span class="ps-danger-title">Delete this project</span>
              <button class="ps-btn-danger" :disabled="lifecycleBusy" @click="openDeleteConfirm">
                Delete…
              </button>
            </div>
            <p class="ps-hint">
              Removes Chorus's record of it. Your files are never touched.
            </p>

            <!-- The confirmation states the counts UP FRONT (D123/D109) and
                 names what survives, from `projectLifecycle.ts` — the sentence
                 is built and tested there, not interpolated here, because a
                 sentence assembled in a template is one nothing checks. -->
            <div v-if="confirmOpen && impact" class="ps-confirm">
              <p class="ps-confirm-text">{{ deleteSentence }}</p>

              <p v-if="impact.live_sessions > 0" class="ps-error-inline">
                {{
                  impact.live_sessions === 1
                    ? '1 agent is still running in this project.'
                    : `${impact.live_sessions} agents are still running in this project.`
                }}
                Stop them, or archive the project, before deleting it.
              </p>

              <template v-else>
                <label class="ps-confirm-label" for="ps-confirm-name">
                  Type <strong>{{ impact.name }}</strong> to confirm
                </label>
                <input
                  id="ps-confirm-name"
                  v-model="typedName"
                  class="ps-input"
                  type="text"
                  spellcheck="false"
                  autocomplete="off"
                  :placeholder="impact.name"
                  @keydown.enter="confirmDelete"
                />
              </template>

              <div class="ps-confirm-actions">
                <button class="ps-btn-quiet" :disabled="lifecycleBusy" @click="confirmOpen = false">
                  Cancel
                </button>
                <button class="ps-btn-danger" :disabled="!canDelete" @click="confirmDelete">
                  {{ lifecycleBusy ? 'Deleting…' : 'Delete permanently' }}
                </button>
              </div>
            </div>
          </div>
        </section>

        <footer class="ps-actions">
          <button class="ps-btn-primary" :disabled="!canSave" @click="save">
            {{ saving ? 'Saving…' : 'Save changes' }}
          </button>
          <span v-if="error" class="ps-error">{{ error }}</span>
        </footer>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* ── Left nav ─────────────────────────────────────────────────────────────
   Deliberately the same geometry as SettingsView's (208px, eyebrow, one live
   entry, pinned back row) so the two settings surfaces read as one family.
   The single entry carries the project's colour chip rather than the jade
   spine — this screen belongs to one project, and saying which one is the
   only job that entry has. */
.ps-nav {
  width: 208px;
  flex: none;
  display: flex;
  flex-direction: column;
  background: var(--color-surface-rail);
  border-right: 1px solid var(--color-border-chrome);
  padding: 10px 8px 8px;
  user-select: none;
}

.ps-nav-eyebrow {
  padding: 2px 6px 8px;
  font-family: var(--font-mono);
  font-size: 9.5px;
  letter-spacing: 0.18em;
  color: var(--color-text-eyebrow);
}

.ps-nav-item {
  position: relative;
  padding: 9px 10px 9px 18px;
  border: 1px solid var(--color-border-inset);
  border-radius: var(--radius-rail);
  background: var(--color-surface-selected-strong);
}

.ps-nav-spine {
  position: absolute;
  left: 4px;
  top: 50%;
  transform: translateY(-50%);
  width: 5px;
  height: 18px;
  border-radius: 3px;
  background: var(--chip);
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--chip) 45%, transparent),
    0 0 10px 1px color-mix(in srgb, var(--chip) 55%, transparent);
}

.ps-nav-label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ps-back {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 7px 8px;
  border: 0;
  border-radius: var(--radius-icon);
  background: transparent;
  font-size: 12px;
  color: var(--color-text-quiet);
  cursor: default;
}

.ps-back:hover {
  background: var(--color-surface-hover);
  color: var(--color-text-secondary);
}

.ps-keycap {
  padding: 1px 5px;
  border: 1px solid var(--color-border-divider);
  border-radius: var(--radius-chip);
  background: var(--color-surface-keycap);
  font-family: var(--font-mono);
  font-size: 9.5px;
  color: var(--color-text-eyebrow);
}

/* ── Content ──────────────────────────────────────────────────────────── */
.ps-content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 26px 32px 40px;
  background: var(--color-surface-app);
}

.ps-empty {
  font-size: 12px;
  color: var(--color-text-quiet);
}

.ps-header {
  max-width: 560px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--color-border-panel);
}

.ps-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.ps-path {
  margin-top: 5px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--color-text-eyebrow);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ps-section {
  max-width: 560px;
  padding: 20px 0;
  border-bottom: 1px solid var(--color-border-panel);
}

.ps-label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-body);
}

.ps-hint {
  margin: 3px 0 10px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--color-text-quiet);
}

/* Matched to settings.css's .set-input so a project field and a settings field
   are the same control. */
.ps-input,
.ps-textarea {
  display: block;
  width: 100%;
  border: 1px solid var(--color-border-badge);
  background: var(--color-surface-field);
  border-radius: var(--radius-rail);
  padding: 7px 10px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--color-text-body);
  outline: none;
}

.ps-textarea {
  line-height: 1.6;
  resize: vertical;
  min-height: 96px;
}

.ps-input::placeholder,
.ps-textarea::placeholder {
  color: var(--color-text-eyebrow);
}

.ps-input:hover,
.ps-textarea:hover {
  border-color: var(--color-logo-bar-low);
}

.ps-input:focus,
.ps-textarea:focus {
  border-color: var(--color-accent-jade);
  background: var(--color-surface-field-focus);
}

.ps-counter {
  margin-top: 6px;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--color-text-eyebrow);
}

.ps-counter-low {
  color: var(--color-state-attention-text);
}

.ps-error-inline {
  margin-top: 6px;
  font-size: 11px;
  color: var(--color-state-error-text);
}

/* ── Swatches ─────────────────────────────────────────────────────────── */
.ps-swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.ps-swatch {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--color-border-badge);
  border-radius: var(--radius-rail);
  background: var(--chip);
  color: var(--color-surface-rail);
  cursor: default;
}

.ps-swatch:hover {
  border-color: var(--color-logo-bar-high);
}

/* The selection ring is drawn OUTSIDE the box (a gap, then the ring) so it
   never darkens the colour the user is judging. */
.ps-swatch-on {
  border-color: var(--color-surface-app);
  box-shadow: 0 0 0 2px var(--color-accent-jade);
}

/* The custom box carries a + glyph over whatever colour is current, which is
   what distinguishes it from the twelve fixed swatches beside it. */
.ps-swatch-custom {
  color: var(--color-surface-void);
}

/* Kept in the layout (not display:none) so `.click()` reliably opens the OS
   picker in Chromium, but sized to nothing so it never draws. */
.ps-color-native {
  width: 0;
  height: 0;
  padding: 0;
  border: 0;
  opacity: 0;
  pointer-events: none;
}

.ps-color-readout {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
  padding: 10px 12px;
  border: 1px solid var(--color-border-panel);
  border-radius: var(--radius-rail);
  background: var(--color-surface-well);
}

/* The rail's chip, at the rail's exact geometry and glow — this is a preview,
   so it has to be the same object, not an approximation of it. */
.ps-chip-preview {
  flex: none;
  width: 5px;
  height: 18px;
  border-radius: 3px;
  background: var(--chip);
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--chip) 45%, transparent),
    0 0 10px 1px color-mix(in srgb, var(--chip) 55%, transparent);
}

.ps-hex {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-text-secondary);
}

/* ── Actions ──────────────────────────────────────────────────────────────
   ⚠ STICKY, NOT STATIC. At the app's default 728px window the colour section
   already pushes this row below the fold, so a user filling the form in order
   reaches the bottom and finds no Save. Sticking it to the foot of the
   scrolling region keeps the only affirmative control on screen the whole
   time; the negative margins let its backdrop span the full content width so
   the section rules scroll underneath it rather than beside it. */
.ps-actions {
  position: sticky;
  bottom: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 0 -32px -40px;
  padding: 16px 32px 20px;
  background: var(--color-surface-app);
  border-top: 1px solid var(--color-border-panel);
}

.ps-btn-primary {
  flex: none;
  border: 0;
  border-radius: var(--radius-icon);
  padding: 7px 16px;
  background: var(--color-accent-jade);
  color: var(--color-surface-rail);
  font-size: 12px;
  font-weight: 600;
  cursor: default;
}

.ps-btn-primary:hover:not(:disabled) {
  background: var(--color-accent-jade-fill-hover);
}

.ps-btn-primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ps-error {
  font-size: 11px;
  color: var(--color-state-error-text);
}

/* ── Lifecycle (D120–D124) ────────────────────────────────────────────────
   The last section on the screen, deliberately: a user scrolls past name,
   description and colour to reach it, which is the right amount of distance
   between "rename this" and "delete this". */
.ps-lifecycle-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

/* ── Memory (Task 6-3) ────────────────────────────────────────────────
   3c-1 tokens only — no raw hex, no stock palette utility, which a grep gate
   asserts over this tree. */
.ps-label-sub {
  margin-top: 4px;
  font-weight: 500;
  color: var(--color-text-quiet);
}

.ps-hint-tight {
  margin: 6px 0 0;
}

/* Task 6-5: what each agent is given. Tokens only, like everything above. */
.ps-mcp-list {
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ps-mcp-row {
  display: flex;
  gap: 8px;
  font-size: 11px;
  color: var(--color-text-quiet);
}

.ps-mcp-agent {
  min-width: 92px;
  color: var(--color-text-primary);
}

.ps-mcp-where {
  flex: 1;
}

.ps-memory-row {
  margin-top: 12px;
}

.ps-memory-state {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 12px 0 0;
  font-size: 11.5px;
  color: var(--color-text-secondary);
}

.ps-memory-dot {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-text-eyebrow);
}

/* ⚠ THREE STATES, NOT FOUR. `pending-approval` is about a CLI's MCP approval
   and arrives at Task 6-5; it has no source here, so it has no colour here. */
.ps-memory-dot-connected {
  background: var(--color-accent-jade);
}

.ps-memory-dot-failed {
  background: var(--color-state-error-text);
}

/* ── Provenance (Task 6-4) ───────────────────────────────────────────── */

/* Separated from the seed control above it: they are two different questions —
   "is the schema applied" and "do the memories cite anything" — and at the
   section's own spacing they read as one block. */
.ps-provenance {
  margin-top: 22px;
}

.ps-affected {
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* ⚠ THE GAPS ARE THE FIX, NOT DECORATION. Without them the three fields render
   as `m-bareno source, no sessionmcp` — three facts fused into one unreadable
   token, which is how a list that is supposed to make a number actionable
   becomes noise. Caught on the running app, not in review. */
.ps-affected-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: 11px;
  color: var(--color-text-quiet);
}

.ps-affected-id {
  flex: none;
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--color-text-eyebrow);
}

/* The content is the variable-length part, so it takes the slack and truncates
   rather than wrapping the row into two lines per memory. */
.ps-affected-content {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text-secondary);
}

.ps-affected-via {
  flex: none;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--color-text-eyebrow);
}

.ps-lifecycle-state {
  font-size: 11px;
  color: var(--color-text-quiet);
}

.ps-lifecycle-note {
  margin-top: 8px;
  font-size: 11px;
  color: var(--color-text-secondary);
}

.ps-btn-quiet {
  flex: none;
  border: 1px solid var(--color-border-badge);
  border-radius: var(--radius-icon);
  padding: 6px 12px;
  background: var(--color-surface-field);
  font-size: 12px;
  color: var(--color-text-body);
  cursor: default;
}

.ps-btn-quiet:hover:not(:disabled) {
  border-color: var(--color-logo-bar-high);
  color: var(--color-text-primary);
}

.ps-btn-quiet:disabled {
  opacity: 0.4;
}

/* ⚠ A BORDERED WELL, NOT A RED BUTTON IN THE FLOW. The border is what makes
   this read as a different KIND of control rather than one more thing to
   click — the same reason the confirmation asks for the project's name. */
.ps-danger {
  margin-top: 22px;
  padding: 14px;
  border: 1px solid var(--color-state-error-text);
  border-radius: var(--radius-rail);
  background: var(--color-surface-well);
}

.ps-danger-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.ps-danger-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-body);
}

.ps-btn-danger {
  flex: none;
  border: 1px solid var(--color-state-error-text);
  border-radius: var(--radius-icon);
  padding: 6px 12px;
  background: transparent;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-state-error-text);
  cursor: default;
}

.ps-btn-danger:hover:not(:disabled) {
  background: var(--color-state-error-text);
  color: var(--color-surface-rail);
}

.ps-btn-danger:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ⚠ THE BOTTOM PADDING CLEARS THE STICKY SAVE ROW, AND IT IS NOT DECORATION.
   `.ps-actions` is `position: sticky; bottom: 0` with a negative bottom margin
   that cancels the content's own bottom padding, so at FULL SCROLL it still
   overlays the last ~70px of the scrolling region. Measured at runtime with the
   confirmation open, the "Delete permanently" button's lower edge sat under it —
   the one control in this app that must never be half-hidden or mis-clicked.
   The padding applies only while the confirmation is open (`v-if`), so a closed
   screen keeps the layout it had. */
.ps-confirm {
  margin-top: 14px;
  padding-top: 14px;
  padding-bottom: 80px;
  border-top: 1px solid var(--color-border-panel);
}

/* The counts, stated before the action (D123/D109). Set at reading size, not
   hint size: this is the sentence the whole dialog exists to deliver. */
.ps-confirm-text {
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-text-body);
}

.ps-confirm-label {
  display: block;
  margin: 14px 0 6px;
  font-size: 11px;
  color: var(--color-text-quiet);
}

.ps-confirm-label strong {
  font-family: var(--font-mono);
  color: var(--color-text-primary);
}

.ps-confirm-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
}
</style>
