<script setup lang="ts">
/**
 * Empty state (Task 1-4): shown by App.vue when the layout tree is null (fresh
 * project or the last pane was closed). The launched session becomes the
 * single root leaf.
 *
 * ⚠ THIS SURFACE HAS NO MOCK, AND IT IS HELD TO TOKEN-AND-PRIMITIVE
 * CONFORMANCE ONLY (D83). `Task-3c-4.md` cited `Chorus Startup.dc.html` for it,
 * but that mock is an animated 2.75 s LAUNCH SPLASH over the workspace — a
 * surface Chorus does not have at all (there is no splash anywhere in main or
 * the renderer), and whose boot line "waking 7 voices · restoring 3 sessions"
 * would need live restore progress the renderer is never told (D76). No mock
 * anywhere draws the no-project screen, so this is restyled onto the theme and
 * deliberately NOT redesigned. It is the phase's SECOND unmocked surface,
 * alongside WorktreePanel.vue.
 *
 * ⚠ Its button is NOT the rail's "Add project" row, however similar they look:
 * that one adds a PROJECT (`store.add()`), this one opens the LAUNCH DIALOG for
 * a session. They are deliberately not unified.
 */
const emit = defineEmits<{ launch: [] }>()
</script>

<template>
  <div class="empty">
    <p class="empty-line">No agents running.</p>
    <button type="button" class="overlay-btn-primary empty-cta" @click="emit('launch')">
      Launch an agent
    </button>
  </div>
</template>

<style src="../assets/overlays.css"></style>

<style scoped>
.empty {
  display: flex;
  height: 100%;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  background: var(--color-surface-app);
  user-select: none;
}

.empty-line {
  font-size: 13px;
  color: var(--color-text-tertiary);
}

/* The primary button is the shared overlay one — the launch dialog's Launch
   button and this are the same verb, so they read as the same control. */
.empty-cta {
  padding: 8px 18px;
}
</style>
