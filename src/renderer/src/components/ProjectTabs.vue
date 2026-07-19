<script setup lang="ts">
import { useProjectStore } from '../stores/project'

/**
 * Project tab bar (Task 1-5). Tabs come from `project:list` via the project
 * store; the active tab is highlighted; "+ Add Project" opens the native
 * directory picker in main.
 *
 * Deliberately NO rename/delete controls (non-goal): edit the DB manually to
 * rename or remove a project; that UI is Phase 1b+.
 */
const store = useProjectStore()
</script>

<template>
  <div class="flex items-center gap-1 border-b border-neutral-800 bg-neutral-900 px-2 select-none">
    <button
      v-for="p in store.projects"
      :key="p.id"
      :class="
        p.id === store.activeId
          ? 'border-b-2 border-sky-500 text-neutral-100'
          : 'text-neutral-400 hover:text-neutral-200'
      "
      class="px-3 py-1.5 text-sm"
      @click="store.select(p.id)"
    >
      {{ p.name }}
    </button>
    <button
      class="ml-auto px-2 text-sm text-neutral-400 hover:text-neutral-200"
      title="Add project"
      @click="store.add()"
    >
      + Add Project
    </button>
  </div>
</template>
