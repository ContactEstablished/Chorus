<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { fuzzyFilter, type PaletteCommand } from '../palette/commands'

/**
 * Ctrl+K command palette (Task 1b-3 / D21). A modal over the extensible
 * command registry: type to fuzzy-filter, ↑/↓ move the highlight (wrapping),
 * Enter runs the selected command, Esc closes, Tab is trapped in the panel
 * (the LaunchDialog idiom). App owns the open state and the hotkey; this
 * component only receives the built command list and emits close.
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
    class="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-24"
    @keydown="onKeydown"
  >
    <div ref="panel" class="w-[32rem] rounded-lg bg-neutral-900 p-3 shadow-xl" role="dialog" aria-modal="true">
      <input
        ref="input"
        v-model="query"
        placeholder="Type a command…"
        class="w-full rounded bg-neutral-800 px-3 py-2 text-sm text-neutral-100 outline-none"
      />
      <ul class="mt-2 max-h-80 overflow-y-auto">
        <li
          v-for="(cmd, i) in filtered"
          :key="cmd.id"
          :class="i === selectedIndex ? 'bg-sky-600 text-white' : 'text-neutral-300 hover:bg-neutral-800'"
          class="cursor-pointer rounded px-3 py-1.5 text-sm"
          @click="onRowClick(i)"
          @mouseenter="selectedIndex = i"
        >
          {{ cmd.label }}
        </li>
        <li v-if="filtered.length === 0" class="px-3 py-1.5 text-sm text-neutral-500">
          No matching command
        </li>
      </ul>
    </div>
  </div>
</template>
