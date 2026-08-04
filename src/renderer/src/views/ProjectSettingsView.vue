<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { PROJECT_DESCRIPTION_MAX } from '../../../shared/ipc'
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
const props = defineProps<{ projectId: string; overlayOpen: boolean }>()
const emit = defineEmits<{ close: [] }>()

const store = useProjectStore()

/** The row being edited, read live from the store — NOT copied at mount. The
 *  form fields below are the copy; this stays the truth to reset against. */
const project = computed(() => store.projects.find((p) => p.id === props.projectId) ?? null)

/** The project's position in the rail — the input to the pre-v13 colour
 *  fallback, and the only reason this screen needs to know it. */
const projectIndex = computed(() => store.projects.findIndex((p) => p.id === props.projectId))

/**
 * The colour this project is ALREADY being drawn with: its stored one, or the
 * index-cycle token the rail falls back to for a pre-v13 row, resolved to hex.
 *
 * ⚠ THIS SCREEN MUST NOT INVENT A STARTING COLOUR. Seeding the picker from the
 * first palette entry (the obvious shortcut) told a project whose rail chip is
 * violet that jade was selected — a contradiction visible in the same window,
 * and one that would have silently repainted the project on the next save.
 */
function currentChipHex(): string {
  return resolveChipHex(project.value?.color ?? null, Math.max(projectIndex.value, 0))
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
const savedAt = ref(false)
const error = ref<string | null>(null)

let alive = true
let savedTimer: ReturnType<typeof setTimeout> | null = null

async function save(): Promise<void> {
  if (!nameValid.value || saving.value || !project.value) return
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
    savedAt.value = true
    if (savedTimer) clearTimeout(savedTimer)
    savedTimer = setTimeout(() => {
      savedAt.value = false
    }, 2000)
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
/* Esc / lifecycle                                                     */
/* ------------------------------------------------------------------ */

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  alive = false
  if (savedTimer) clearTimeout(savedTimer)
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

        <footer class="ps-actions">
          <button
            class="ps-btn-primary"
            :disabled="!nameValid || !dirty || saving"
            @click="save"
          >
            {{ saving ? 'Saving…' : 'Save changes' }}
          </button>
          <span v-if="savedAt && !dirty" class="ps-saved">Saved</span>
          <span v-else-if="error" class="ps-error">{{ error }}</span>
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

.ps-saved {
  font-size: 11px;
  color: var(--color-state-running-text);
}

.ps-error {
  font-size: 11px;
  color: var(--color-state-error-text);
}
</style>
