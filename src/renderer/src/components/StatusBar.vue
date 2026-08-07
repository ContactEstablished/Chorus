<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { SessionInfo } from '../../../shared/ipc'
import { parseBootInfo, versionLabel } from '../boot/bootInfo'

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

/**
 * The running build's version, at the far left.
 *
 * ⚠ NO CHANNEL, NO STORE, NO ROUND TRIP — it is already on the URL. Main stamps
 * `app.getVersion()` there before the window loads (`src/main/index.ts`), which
 * is the mechanism `boot/bootInfo.ts` exists to explain: a write-once boot
 * constant that main knows before the window exists and that cannot change
 * while it lives is the opposite of what the typed `chorus.*` bridge is for.
 * Adding a `app:version` channel for it would be a channel, a Zod pair, a
 * preload forwarder and a round trip to ask a question whose answer was fixed
 * before anything mounted.
 *
 * ⚠ READ ONCE AT SETUP, NOT PER RENDER, for the reason the splash gives: these
 * are constants, and re-parsing the URL on every tick would imply they can
 * change.
 *
 * ⚠ AND IT IS `app.getVersion()`, WHICH IS THE INSTALLED BUILD'S OWN NUMBER —
 * read from the packaged app's `package.json` rather than from anything the
 * renderer bundles. That is what makes this marker able to answer the question
 * it exists for: "is the app I am looking at the one I just installed?"
 */
const version = versionLabel(parseBootInfo(window.location.search))

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
    <!-- ⚠ FIRST, AND INDEPENDENT OF EVERYTHING BESIDE IT. `worktrees N`
         disappears whenever there is no active project or the git read failed
         (D76), so anchoring the version to it would make the build number come
         and go with an unrelated fact — on the first-run empty state, the one
         moment someone is most likely to be checking which build they just
         installed, it would not be there at all. -->
    <span v-if="version" class="statusbar-version" data-testid="status-version">{{ version }}</span>

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

/* ⚠ EXTRA SEPARATION ON TOP OF THE BAR'S 14px GAP, giving ~30px in total, and
   that is the point rather than a nicety. The version is a fact about the
   APPLICATION; everything to its right is a fact about the WORK. At the shared
   gap the two read as one list — "v0.1.2 worktrees 2" scans as a single
   phrase — and the reader has to parse it to find the boundary. The wider gap
   does that work for them. Margin rather than a flex spacer: a spacer would
   push `worktrees` toward the middle of the bar, which is a different layout,
   not more padding. */
.statusbar-version {
  margin-right: 16px;
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
