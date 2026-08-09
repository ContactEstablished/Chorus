<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import SettingsProviders from './SettingsProviders.vue'
import SettingsAgentLock from './SettingsAgentLock.vue'
import { useSettingsStore } from '../stores/settings'

/**
 * Settings view shell (Task 3-4 / D29, layout per the D38 skeleton): a left
 * settings nav beside the content region — Chorus's first view, not a fourth
 * overlay. "back to workspace" is pinned at the bottom and also bound to Esc,
 * which yields to any open overlay (palette/launch dialog/worktree panel own
 * Esc first).
 *
 * ⚠ TWO LIVE ENTRIES NOW, AND THE NO-DEAD-ENTRIES RULE IS UNCHANGED. This shell
 * shipped with exactly one because the mock's other five sections
 * (General/Agents/Keybindings/Voice/Appearance) had nothing behind them, and
 * D76 forbids a nav row that does nothing. "Agent lock" is not an exception to
 * that rule — it is the rule being satisfied: v16 built the surface, so the
 * entry now has somewhere to go. The remaining mock sections still do not, and
 * still are not drawn.
 */
type SettingsSection = 'providers' | 'agent-lock'

/** Which section the content region shows. Component-local and NOT persisted:
 *  settings is a place you visit to do one thing, and reopening it on the pane
 *  you last used would be a small surprise every time. */
const section = ref<SettingsSection>('providers')
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
    <!-- left settings nav, against the mock's 208px rail.
         ⚠ TWO live entries, not the mock's six. The mock also draws General /
         Agents / Keybindings / Voice & dictation / Appearance; none of those
         exists, and D76 forbids rendering a surface the data does not support.
         A nav entry that does nothing is the placeholder that rule is about.
         They arrive when their phases build them — as "Agent lock" just did. -->
    <nav class="set-nav">
      <div class="set-nav-eyebrow">SETTINGS</div>
      <div
        class="set-nav-item"
        :class="section === 'providers' && 'set-nav-item-on'"
        @click="section = 'providers'"
      >
        <div v-if="section === 'providers'" class="set-nav-spine"></div>
        <span class="set-nav-label">Providers &amp; keys</span>
      </div>
      <div
        class="set-nav-item"
        :class="section === 'agent-lock' && 'set-nav-item-on'"
        @click="section = 'agent-lock'"
      >
        <div v-if="section === 'agent-lock'" class="set-nav-spine"></div>
        <span class="set-nav-label">Agent lock</span>
      </div>
      <div class="flex-1"></div>
      <button class="set-back" @click="emit('close')">
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.2">
          <path d="M7 2H3v8h6V4z" />
          <path d="M7 2v2h2" />
        </svg>
        back to workspace
        <span class="flex-1"></span>
        <span class="set-keycap">esc</span>
      </button>
    </nav>

    <!-- content region -->
    <div class="set-content">
      <SettingsProviders v-if="section === 'providers'" />
      <SettingsAgentLock v-else-if="section === 'agent-lock'" />
    </div>
  </div>
</template>

<style src="../assets/settings.css"></style>
