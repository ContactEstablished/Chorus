<script setup lang="ts">
/**
 * Empty state (Task 1-4): shown by App.vue when the layout tree is null (fresh
 * project or the last pane was closed). The launched session becomes the
 * single root leaf.
 */
const emit = defineEmits<{ launch: [] }>()
</script>

<template>
  <div class="flex h-full flex-col items-center justify-center gap-3 bg-[#1e1e1e] text-neutral-400 select-none">
    <p class="text-sm">No agents running.</p>
    <button
      class="rounded bg-sky-600 px-4 py-2 text-sm text-white hover:bg-sky-500"
      @click="emit('launch')"
    >
      Launch an agent
    </button>
  </div>
</template>
