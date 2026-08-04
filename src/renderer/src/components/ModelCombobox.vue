<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { ModelCatalogEntry } from '../../../shared/ipc'

/**
 * A model-id field: FREE TEXT with a searchable, filtered suggestion panel.
 *
 * ⚠ IT IS NOT A `<select>`, AND THAT IS THE POINT — D48/D56, enforced in three
 * places on the settings screen and now in one component instead. The catalog
 * is a list of what a provider SAID EXISTS; it is not a list of what the user
 * is allowed to want. A model id the catalog has never returned must remain
 * typeable and submittable, so:
 *   · the input is a plain text input and its value is never constrained;
 *   · the panel SUGGESTS and never decides — closing it does not clear or
 *     rewrite what was typed;
 *   · Enter submits whatever is in the box when nothing is highlighted.
 * A closed `<select>` here would make the catalog authoritative BY UI
 * CONSTRUCTION, with nobody deciding to. Do not "tidy" this into one.
 *
 * ⚠ IT REPLACES `<datalist>`, WHICH IS WHAT SENT MATTHEW LOOKING FOR A SEARCH
 * BOX. A datalist gives no visible affordance that it exists, opens only on a
 * gesture the user has to already know, and — on a 340-model OpenRouter
 * catalog — dumps an unfiltered list you have to scroll. This renders its own
 * panel so the control looks like what it is, filters as you type, and caps
 * what it draws.
 */
const props = withDefaults(
  defineProps<{
    /**
     * ⚠ OPTIONAL, WITH AN EMPTY-STRING DEFAULT, AND NOT AS A CONVENIENCE.
     * Callers bind this to a per-provider record (`shortlistDraft[id]`) whose
     * key does not exist until something is typed, so the first render gets
     * `undefined`. `withDefaults` normalises that to `''` — without it the
     * template's `modelValue.trim()` throws during render and the panel never
     * appears at all, which is indistinguishable from "the dropdown is broken".
     */
    modelValue?: string
    /** Catalogued ids to suggest. Callers filter out missing/already-chosen. */
    options: readonly ModelCatalogEntry[]
    placeholder?: string
    /** Extra classes for the input — callers size it (`set-input-sm`, `w-72`). */
    inputClass?: string
    maxlength?: number
    /** Rendered before the panel's list; e.g. "334 catalogued ids". */
    emptyHint?: string
  }>(),
  { modelValue: '', placeholder: '', inputClass: '', maxlength: 200, emptyHint: '' }
)

/** The prop, guaranteed to be a string. Everything below reads THIS, so a
 *  caller passing undefined can never reach a `.trim()`. */
const text = computed(() => props.modelValue ?? '')

const emit = defineEmits<{
  'update:modelValue': [value: string]
  /** Enter on the raw text, or a suggestion picked. The parent decides what
   *  "submit" means — the shortlist adds; a form field just keeps the value. */
  submit: [value: string]
}>()

/** How many rows the panel will draw. A cap, not a filter: the count of what
 *  was left out is printed, so a narrowed search is never silently truncated. */
const RENDER_CAP = 60

const open = ref(false)
const highlighted = ref(-1)

/**
 * The caret was clicked rather than the field typed in.
 *
 * ⚠ IT SUPPRESSES THE FILTER FOR ONE OPENING, and it earns its keep on a
 * field that is ALREADY FILLED. The provider form's model field arrives
 * holding `moonshotai/kimi-k3`; filtering on that text leaves the panel
 * showing exactly one row — the value you opened the list to change. A control
 * whose tooltip says "Browse model ids" has to be able to browse. Any
 * keystroke clears the flag, so typing filters again immediately.
 */
const browseAll = ref(false)
const inputEl = ref<HTMLInputElement | null>(null)
const listEl = ref<HTMLElement | null>(null)

/** Case-insensitive substring over BOTH the id and the display name — people
 *  search "sonnet" as readily as "anthropic/claude". */
const matches = computed(() => {
  if (browseAll.value) return props.options
  const q = text.value.trim().toLowerCase()
  if (q === '') return props.options
  return props.options.filter(
    (m) => m.modelId.toLowerCase().includes(q) || m.displayName.toLowerCase().includes(q)
  )
})

const shown = computed(() => matches.value.slice(0, RENDER_CAP))
const overflow = computed(() => matches.value.length - shown.value.length)

/* ---- where the panel is drawn -----------------------------------------
 *
 * ⚠ TELEPORTED TO <body> AND POSITIONED IN VIEWPORT COORDINATES, and it has to
 * be. `.set-card` sets `overflow: hidden` (it clips its nested rows to the
 * card's rounded corners), so a panel absolutely positioned inside the card is
 * CLIPPED TO THE CARD — observed live: 21 matching rows rendered and exactly
 * one was visible. `z-index` cannot escape an ancestor's overflow; only
 * leaving the subtree can. The alternative — dropping `overflow: hidden` from
 * the shared card class — would square off the corners of every card on the
 * settings screen to fix one dropdown.
 */
const panelStyle = ref<Record<string, string>>({})

function updatePanelPosition(): void {
  const el = inputEl.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const GAP = 3
  const MAX_H = 300
  // Flip above when the space below cannot hold the panel but the space above
  // can — otherwise a field near the bottom of the window opens into nothing.
  const below = window.innerHeight - r.bottom
  const flip = below < MAX_H && r.top > below
  panelStyle.value = {
    position: 'fixed',
    left: `${Math.round(r.left)}px`,
    width: `${Math.round(Math.max(r.width, 260))}px`,
    ...(flip
      ? { bottom: `${Math.round(window.innerHeight - r.top + GAP)}px` }
      : { top: `${Math.round(r.bottom + GAP)}px` })
  }
}

/** Fixed coordinates go stale the moment anything scrolls. `capture: true`
 *  catches scrolls in the settings content region, which does not bubble. */
function bindReposition(on: boolean): void {
  const fn = updatePanelPosition
  if (on) {
    window.addEventListener('scroll', fn, true)
    window.addEventListener('resize', fn)
  } else {
    window.removeEventListener('scroll', fn, true)
    window.removeEventListener('resize', fn)
  }
}

watch(open, (isOpen) => {
  bindReposition(isOpen)
  if (isOpen) void nextTick(updatePanelPosition)
})

onBeforeUnmount(() => bindReposition(false))

function onInput(e: Event): void {
  emit('update:modelValue', (e.target as HTMLInputElement).value)
  open.value = true
  browseAll.value = false
  highlighted.value = -1
}

function openPanel(): void {
  open.value = true
  highlighted.value = -1
}

function togglePanel(): void {
  open.value = !open.value
  browseAll.value = open.value
  highlighted.value = -1
  if (open.value) void nextTick(() => inputEl.value?.focus())
}

function choose(id: string): void {
  emit('update:modelValue', id)
  emit('submit', id)
  open.value = false
  browseAll.value = false
  highlighted.value = -1
}

/** Keep the highlighted row in view when arrowing past the panel's edge. */
function scrollHighlightedIntoView(): void {
  void nextTick(() => {
    const row = listEl.value?.children[highlighted.value] as HTMLElement | undefined
    row?.scrollIntoView({ block: 'nearest' })
  })
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (!open.value) return openPanel()
    highlighted.value = Math.min(highlighted.value + 1, shown.value.length - 1)
    scrollHighlightedIntoView()
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    highlighted.value = Math.max(highlighted.value - 1, -1)
    scrollHighlightedIntoView()
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    const pick = shown.value[highlighted.value]
    // ⚠ NO HIGHLIGHT -> SUBMIT THE RAW TEXT. This is the branch that keeps an
    // uncatalogued id reachable; an implementation that "helpfully" snaps to
    // the first match would quietly refuse to let the user name anything the
    // provider has not listed.
    choose(pick ? pick.modelId : text.value)
    return
  }
  if (e.key === 'Escape' && open.value) {
    // ⚠ STOP IT HERE. SettingsView binds Esc on `window` to leave the whole
    // view; without this, dismissing the suggestion panel would also throw the
    // user out of settings and lose the form they were filling in.
    e.preventDefault()
    e.stopPropagation()
    open.value = false
    browseAll.value = false
    highlighted.value = -1
  }
}
</script>

<template>
  <div class="mc" @focusout="(e) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) open = false }">
    <div class="mc-field">
      <input
        ref="inputEl"
        type="text"
        class="set-input mc-input"
        :class="inputClass"
        :value="text"
        :placeholder="placeholder"
        :maxlength="maxlength"
        spellcheck="false"
        autocomplete="off"
        role="combobox"
        :aria-expanded="open"
        aria-autocomplete="list"
        data-model-combobox
        @input="onInput"
        @focus="openPanel"
        @keydown="onKeydown"
      />
      <!-- The affordance the datalist never had: something visibly clickable
           that says "there is a list behind this field". -->
      <button
        type="button"
        class="mc-caret"
        :title="open ? 'Hide suggestions' : 'Browse model ids'"
        :aria-label="open ? 'Hide suggestions' : 'Browse model ids'"
        tabindex="-1"
        data-model-combobox-toggle
        @mousedown.prevent
        @click="togglePanel"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M3 4.5 6 7.5l3-3" />
        </svg>
      </button>
    </div>

    <Teleport to="body">
      <div v-if="open" class="mc-panel" :style="panelStyle" data-model-combobox-panel>
      <p v-if="options.length === 0" class="mc-note">
        No catalogued ids yet — run Refresh, or just type any model id.
      </p>
      <template v-else>
        <p v-if="emptyHint && (browseAll || text.trim() === '')" class="mc-note">{{ emptyHint }}</p>
        <p v-else-if="matches.length === 0" class="mc-note">
          Nothing catalogued matches — press Enter to use it anyway.
        </p>
        <div v-if="shown.length > 0" ref="listEl" class="mc-list">
          <button
            v-for="(m, i) in shown"
            :key="m.modelId"
            type="button"
            class="mc-option"
            :class="{ 'mc-option-on': i === highlighted }"
            data-model-combobox-option
            @mousedown.prevent
            @mouseenter="highlighted = i"
            @click="choose(m.modelId)"
          >
            <span class="mc-option-id">{{ m.modelId }}</span>
            <span v-if="m.contextLength" class="mc-option-meta">
              {{ Math.round(m.contextLength / 1000) }}k ctx
            </span>
          </button>
        </div>
        <!-- ⚠ SAID OUT LOUD. A capped list that does not admit the cap reads as
             "this is everything", and the user stops narrowing. -->
        <p v-if="overflow > 0" class="mc-note mc-note-cap">
          +{{ overflow }} more — keep typing to narrow.
        </p>
        </template>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.mc {
  position: relative;
  display: inline-block;
}

.mc-field {
  position: relative;
  display: flex;
  align-items: center;
}

.mc-input {
  width: 100%;
  /* room for the caret button */
  padding-right: 24px;
}

.mc-caret {
  position: absolute;
  right: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: 0;
  border-radius: var(--radius-chip);
  background: transparent;
  color: var(--color-text-eyebrow);
  cursor: default;
}

.mc-caret:hover {
  background: var(--color-surface-icon-hover);
  color: var(--color-text-secondary);
}

/* Positioned entirely by `panelStyle` (fixed, viewport coordinates) — see the
   Teleport note in the script. Only the appearance lives here. */
.mc-panel {
  z-index: 60;
  max-width: 420px;
  border: 1px solid var(--color-border-badge);
  border-radius: var(--radius-rail);
  background: var(--color-surface-overlay);
  padding: 4px;
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.55);
}

.mc-list {
  max-height: 232px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.mc-option {
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  text-align: left;
  border: 0;
  border-radius: var(--radius-chip);
  padding: 4px 7px;
  background: transparent;
  cursor: default;
}

.mc-option-on {
  background: var(--color-surface-selected-strong);
}

.mc-option-id {
  flex: 1;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--color-text-body);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mc-option-meta {
  flex: none;
  font-family: var(--font-mono);
  font-size: 9.5px;
  color: var(--color-text-eyebrow);
}

.mc-note {
  padding: 5px 7px;
  font-size: 10px;
  line-height: 1.45;
  color: var(--color-text-eyebrow);
}

.mc-note-cap {
  border-top: 1px solid var(--color-border-row);
  margin-top: 3px;
}
</style>
