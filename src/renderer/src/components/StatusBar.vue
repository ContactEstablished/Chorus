<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { SessionInfo } from '../../../shared/ipc'

/**
 * The 30px status bar (Task 3c-3), created by this task — the app had none.
 *
 * Geometry and colour come from the `<!-- ══ status bar ══ -->` block of
 * docs/design/v2/Chorus Workspace.dc.html (D73); every value is a 3c-1 token
 * and this file contains no raw hex, which a grep gate asserts.
 *
 * ⚠ IT RENDERS FEWER FACTS THAN THE MOCK DRAWS, AND THAT IS THE RULING, NOT AN
 * OMISSION TO FIX LATER (D76 — render what the data supports, never fake the
 * rest; D78 — the renderer cannot know an agent is blocked on a human):
 *
 *   the graph-database chip       ❌ that database is Phase 6 and does not exist
 *   `worktrees 4`                 ✅ worktree:list
 *   `7 sessions · 3 running · …`  ✅ the project's own session rows
 *   the fourth-state tally        ❌ D78 — no source; three states exist, not four
 *   the two cost figures          ❌ no per-project or per-day rollup exists
 *   `ctrl+k commands`             ✅
 *
 * ⚠ TWO OMISSIONS MEANS ONE SEPARATOR, NOT TWO. The mock draws a divider either
 * side of the cost group; with the group gone, a second divider would be a rule
 * with nothing on one side of it, which reads as a rendering bug.
 */
const props = defineProps<{
  /** The active project's session rows (`layout:get`) — the SAME source the
   *  filmstrip cards read, deliberately: two surfaces reporting session state
   *  from two sources would eventually disagree on screen. Note the scope, and
   *  that it is one consistent denominator across the whole tally: every figure
   *  in the group describes THIS project. The mock's `7 sessions` is a
   *  cross-project total, but the running/error split has no cross-project
   *  source, and a total from one population beside a split from another is the
   *  denominator-mixing D55 already forbids one layer down. */
  sessions: SessionInfo[]
  projectId: string | null
}>()

/** Worktree count, fetched here because there is no worktree store — the panel
 *  calls `worktree:list` directly too. Null means "not known" (never fetched,
 *  or the read failed), and a null count renders NOTHING rather than a zero:
 *  the D76 rule applies to a fact the app could not obtain exactly as it does
 *  to one that does not exist. */
const worktreeCount = ref<number | null>(null)

watch(
  () => props.projectId,
  async (id) => {
    if (!id) {
      worktreeCount.value = null
      return
    }
    try {
      const rows = await window.chorus.listWorktrees(id)
      // Guard against a slow response landing after a faster project switch.
      if (props.projectId !== id) return
      worktreeCount.value = rows.length
    } catch (err) {
      // A git/read failure must not take the status bar with it — drop the
      // figure rather than showing a wrong or placeholder one.
      console.warn('[status] worktree:list failed:', err)
      worktreeCount.value = null
    }
  },
  { immediate: true }
)

/**
 * The three states the app can actually derive (D78): `running`, then `exited`
 * split by exit code into done and error. There is no fourth — nothing reads
 * the PTY stream looking for an agent's prompt, and inferring one would invent
 * a signal D76 forbids.
 */
const tally = computed(() => {
  let running = 0
  let error = 0
  for (const s of props.sessions) {
    if (s.status === 'running') running += 1
    else if (s.exitCode !== 0) error += 1
  }
  return { total: props.sessions.length, running, error }
})

const sessionLabel = computed(() => (tally.value.total === 1 ? '1 session' : `${tally.value.total} sessions`))
</script>

<template>
  <div class="statusbar" data-testid="status-bar">
    <span v-if="worktreeCount !== null">worktrees {{ worktreeCount }}</span>

    <span class="statusbar-spacer" />

    <span>
      {{ sessionLabel }}
      <template v-if="tally.running > 0"> · {{ tally.running }} running</template>
      <template v-if="tally.error > 0"> · {{ tally.error }} error</template>
    </span>

    <!-- The one separator. -->
    <span class="statusbar-divider" />

    <span class="statusbar-hint">
      <span class="statusbar-keycap">ctrl+k</span>
      commands
    </span>
  </div>
</template>

<style scoped>
.statusbar {
  height: 30px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 0 14px;
  background: var(--color-surface-chrome);
  border-top: 1px solid var(--color-border-chrome);
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--color-text-quiet);
  user-select: none;
}

.statusbar-spacer {
  flex: 1;
}

.statusbar-divider {
  width: 1px;
  height: 12px;
  background: var(--color-border-divider);
}

.statusbar-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-muted);
}

.statusbar-keycap {
  font-size: 9.5px;
  border: 1px solid var(--color-border-divider);
  background: var(--color-surface-keycap);
  border-radius: var(--radius-chip);
  padding: 1px 5px;
  color: var(--color-text-quiet);
}
</style>
