<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import SettingsProviders from './SettingsProviders.vue'
import { useSettingsStore } from '../stores/settings'

/**
 * Settings view shell (Task 3-4 / D29, layout per the D38 skeleton): a left
 * settings nav beside the content region — Chorus's first view, not a fourth
 * overlay. The nav carries ONE live entry ("Providers & keys"); the mock's
 * other sections (General/Agents/Keybindings/Voice/Appearance) appear when
 * their phases build them — no dead nav entries. "back to workspace" is
 * pinned at the bottom and also bound to Esc, which yields to any open
 * overlay (palette/launch dialog/worktree panel own Esc first).
 */
const props = defineProps<{ overlayOpen: boolean }>()
const emit = defineEmits<{ close: [] }>()

const settings = useSettingsStore()

// F13: the view may unmount (user clicks back) while the three-list load is
// in flight — the flag is set up BEFORE the first await and checked after
// EVERY await. The Esc listener gets the same discipline: registered on
// mount, removed on unmount, never leaked.
let alive = true
onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  await settings.load()
  if (!alive) return
})
onBeforeUnmount(() => {
  alive = false
  window.removeEventListener('keydown', onKeydown)
})

function onKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  // An overlay above the view owns Esc first — closing settings out from
  // under an open palette would strand its focus. Checked at event time, so
  // the SAME keypress that closes the palette cannot also close the view.
  if (props.overlayOpen) return
  emit('close')
}
</script>

<template>
  <div class="flex h-full">
    <!-- left settings nav (D38 skeleton, app's current neutral idiom) -->
    <nav class="flex w-52 shrink-0 flex-col gap-0.5 border-r border-neutral-800 bg-neutral-900 px-2 py-3">
      <div class="px-2 pb-2 text-[10px] tracking-[0.18em] text-neutral-500 select-none">SETTINGS</div>
      <div
        class="rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-100 select-none"
      >
        Providers &amp; keys
      </div>
      <div class="flex-1"></div>
      <button
        class="flex items-center gap-2 rounded px-3 py-1.5 text-xs text-neutral-400 hover:text-neutral-200"
        @click="emit('close')"
      >
        back to workspace
        <span class="flex-1"></span>
        <span class="rounded border border-neutral-700 bg-neutral-800 px-1 py-px text-[10px] text-neutral-500">
          esc
        </span>
      </button>
    </nav>

    <!-- content region -->
    <div class="min-w-0 flex-1 overflow-y-auto px-8 py-5">
      <SettingsProviders />
    </div>
  </div>
</template>
