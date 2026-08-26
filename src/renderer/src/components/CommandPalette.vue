<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { fuzzyFilter, type PaletteCommand } from '../palette/commands'

/**
 * Ctrl+K command palette (Task 1b-3 / D21). A modal over the extensible
 * command registry: type to fuzzy-filter, ↑/↓ move the highlight (wrapping),
 * Enter runs the selected command, Esc closes, Tab is trapped in the panel
 * (the LaunchDialog idiom). App owns the open state and the hotkey; this
 * component only receives the built command list and emits close.
 *
 * A click on the scrim also closes. ⚠ IT IS `mousedown.self`, NOT `click`:
 * `.self` keeps a click inside the panel from bubbling out and closing it, and
 * mousedown rather than click means a text selection dragged out of the input
 * and released over the scrim does not count as an outside click. Without this
 * the palette became unclosable — the Esc handler is a `keydown` on the scrim,
 * so once a stray click moved focus off the input no key ever reached it.
 */
const props = defineProps<{ commands: PaletteCommand[] }>()
const emit = defineEmits<{ close: [] }>()

const panel = ref<HTMLDivElement | null>(null)
const input = ref<HTMLInputElement | null>(null)
const query = ref('')
const selectedIndex = ref(0)

// Disabled commands are OMITTED rather than rendered dimmed (the spec's
// sanctioned simpler choice): fuzzyFilter already filters to enabled().
const filtered = computed(() => fuzzyFilter(props.commands, query.value))
watch(filtered, () => {
  selectedIndex.value = 0 // reset the highlight on every re-filter
})

onMounted(() => {
  input.value?.focus()
})

function move(delta: number): void {
  const n = filtered.value.length
  if (n === 0) return
  selectedIndex.value = (selectedIndex.value + delta + n) % n
}

async function runSelected(): Promise<void> {
  const cmd = filtered.value[selectedIndex.value]
  if (!cmd) return
  emit('close') // close first — running may open LaunchDialog / swap views
  await cmd.run()
}

function onRowClick(i: number): void {
  selectedIndex.value = i
  void runSelected()
}

/**
 * Clicks on the panel's own chrome — the header strip, the footer hint, the
 * padding between rows — land on elements that cannot hold focus, so the
 * browser blurs the input and parks focus on <body>. `onKeydown` is a listener
 * on the scrim, and <body> is OUTSIDE it, so from that moment Esc (and ↑/↓, and
 * typing) reached nothing and the palette could only be dismissed by running a
 * command. Cancelling the mousedown leaves the caret where it was.
 *
 * ⚠ Rows keep working: preventDefault on mousedown suppresses the focus change,
 * not the subsequent click event.
 */
function onPanelMousedown(e: MouseEvent): void {
  if (e.target !== input.value) e.preventDefault()
}

/** Esc closes, arrows navigate, Enter runs; Tab/Shift-Tab cycle within the
 *  panel — the focus-trap tail is copied from LaunchDialog.onKeydown. */
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    emit('close')
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    move(1)
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    move(-1)
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    void runSelected()
    return
  }
  if (e.key !== 'Tab' || !panel.value) return
  const focusables = Array.from(
    panel.value.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')
  )
  if (focusables.length === 0) return
  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  const active = document.activeElement
  if (e.shiftKey && active === first) {
    last.focus()
    e.preventDefault()
  } else if (!e.shiftKey && active === last) {
    first.focus()
    e.preventDefault()
  }
}
</script>

<template>
  <div
    class="overlay-scrim overlay-scrim-palette"
    @keydown="onKeydown"
    @mousedown.self="emit('close')"
  >
    <div
      ref="panel"
      class="overlay-panel overlay-panel-palette palette"
      role="dialog"
      aria-modal="true"
      @mousedown="onPanelMousedown"
    >
      <!-- Query row. The mock draws a jade `›` prompt, the placeholder and an
           `esc` keycap; the real input replaces the mock's static text. -->
      <div class="overlay-header palette-query">
        <span class="palette-caret" aria-hidden="true">›</span>
        <input
          ref="input"
          v-model="query"
          placeholder="type a command…"
          class="palette-input"
        />
        <span class="overlay-keycap">esc</span>
      </div>

      <ul class="overlay-body palette-list">
        <li
          v-for="(cmd, i) in filtered"
          :key="cmd.id"
          class="palette-row"
          :class="{ 'palette-row-on': i === selectedIndex }"
          @click="onRowClick(i)"
          @mouseenter="selectedIndex = i"
        >
          <span class="palette-label">{{ cmd.label }}</span>
        </li>
        <li v-if="filtered.length === 0" class="palette-empty">No matching command</li>
      </ul>

      <div class="overlay-footer palette-foot">↑↓ navigate · enter run · esc close</div>
    </div>
  </div>
</template>

<style src="../assets/overlays.css"></style>

<style scoped>
/* Geometry from the `<!-- ══ command palette (ctrl+k or tweak) ══ -->` block of
   docs/design/v2/Chorus Workspace.dc.html (D73). Shared anatomy — scrim, panel,
   keycap, header/footer rules — comes from overlays.css above. */
.palette {
  width: 560px;
}

.palette-query {
  padding: 12px 14px;
}

.palette-caret {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--color-accent-jade);
}

.palette-input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  outline: none;
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--color-text-primary);
}

.palette-input::placeholder {
  color: var(--color-text-eyebrow);
}

.palette-list {
  display: flex;
  flex-direction: column;
  padding: 6px;
}

/* ⚠ The 2px left border is on EVERY row, transparent when unselected — the
   mock's own construction. Without it the selected row would be 2px wider than
   its neighbours and the whole list would shift as the highlight moves. */
.palette-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: var(--radius-icon);
  border-left: 2px solid transparent;
  cursor: default;
}

.palette-row:hover:not(.palette-row-on) {
  background: var(--color-surface-tile);
}

.palette-row-on {
  background: color-mix(in srgb, var(--color-accent-jade) 8%, transparent);
  border-left-color: var(--color-accent-jade);
}

.palette-label {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  color: var(--color-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.palette-row-on .palette-label {
  color: var(--color-text-primary);
}

.palette-empty {
  padding: 8px 10px;
  font-size: 12.5px;
  color: var(--color-text-eyebrow);
}

.palette-foot {
  padding: 7px 14px;
  font-family: var(--font-mono);
  font-size: 9.5px;
  color: var(--color-text-eyebrow);
}
</style>
