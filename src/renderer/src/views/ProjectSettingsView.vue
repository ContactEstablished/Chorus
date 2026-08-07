<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { PROJECT_DESCRIPTION_MAX, type ProjectImpact } from '../../../shared/ipc'
import {
  describeArchive,
  describeHide,
  describeProjectDeletion
} from '../../../shared/projectLifecycle'
import { PROJECT_COLORS, PROJECT_COLOR_PATTERN } from '../../../shared/projectColors'
import { resolveChipHex } from '../projectChip'
import { useProjectStore } from '../stores/project'

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
