<script setup lang="ts">
import { computed } from 'vue'
import type { LayoutJson } from '../../../shared/layout'
import { collectSessionIds } from '../../../shared/layout'
import type { AgentKind } from '../../../shared/ipc'
import TerminalPane from './TerminalPane.vue'

/**
 * Grid view (D174) — every agent on screen at once, laid out left to right and
 * wrapped by the window's width.
 *
 * ⚠ THIS REPLACED `LayoutRenderer`, WHICH RENDERED THE SPLIT TREE'S SHAPE
 * through recursive `splitpanes` splits. The tree is still the persisted model
 * (D9) and is still what `layout:get` returns, but this component reads exactly
 * ONE fact off it — `collectSessionIds`, the leaf order — and lays those ids out
 * itself. Ratios and axes are no longer drawn by anything.
 *
 * WHY. The old grid's geometry was a RECORD OF HOW EACH PANE WAS LAUNCHED: the
 * fourth agent's size and position depended on which pane you had clicked
 * "split below" on two launches ago. That is unpredictable in the strict sense
 * — you cannot know where a pane will land before you make it — and the
 * measured consequence was that grid view went unused. A wrapping grid trades
 * away arbitrary geometry for a property worth far more: you always know what
 * you are going to get, because the answer only ever depends on how many agents
 * there are and how wide the window is.
 *
 * ⚠ NO SPLITTERS, AND THEREFORE NO DRAG STATE. Panes are uniform. That is the
 * cost of the trade and it is deliberate — resizable panes are what made the
 * layout unpredictable in the first place. `layout.applyRatio` went with them.
 *
 * ⚠ CELLS ARE KEYED BY SESSION ID, WHICH IS LOAD-BEARING. Vue then reuses each
 * TerminalPane across every reflow — a launch, a close, a window resize — so no
 * pane detaches its PTY view and replays its scrollback because a NEIGHBOUR
 * changed. Keying by index would remount half the grid on every close.
 *
 * ⚠ IT BINDS NO `@focus`, deliberately, and App.vue's `onFocusIn` walk is why:
 * grid mode keeps every pane mounted, so "which pane holds the keyboard" is a
 * live DOM fact, read where it is true rather than mirrored into a persisted
 * store that would go stale between panes. The `focused` prop below is the
 * other direction — it tells the one resolved pane to TAKE the keyboard on
 * mount — and it is not a claim about the others.
 */
const props = defineProps<{
  tree: LayoutJson
  /** Leaf sessionId -> agent kind; undefined when the session row is gone. */
  agentFor: (id: string) => AgentKind | undefined
  /**
   * The workspace's focused leaf (`effectiveFocused`), threaded down so the
   * leaf that matches it takes the keyboard on mount. Grid mode keeps every
   * pane mounted, so this is the ONLY way a pane here learns it is the focused
   * one — the filmstrip gets it for free by remounting.
   */
  focusedSessionId: string | null
}>()

/** Both relayed unchanged to App, which owns the launch dialog and the view
 *  mode. This component holds no state of its own. */
const emit = defineEmits<{ newAgent: []; maximize: [sessionId: string] }>()

/** Launch order, which is also screen order: left to right, then wrapped. */
const ids = computed(() => collectSessionIds(props.tree.root))
</script>

<template>
  <div class="agent-grid">
    <div v-for="id in ids" :key="id" class="agent-grid-cell">
      <TerminalPane
        v-if="agentFor(id)"
        :session-id="id"
        :agent="(agentFor(id) as AgentKind)"
        :focused="id === focusedSessionId"
        :maximized="false"
        @new-agent="emit('newAgent')"
        @maximize="(sessionId) => emit('maximize', sessionId)"
      />
      <!-- Leaf whose session row is missing: holds its cell, mounts nothing
           (the same skip behaviour the split renderer had). -->
      <div v-else class="cell-missing">Session no longer exists</div>
    </div>
  </div>
</template>

<style scoped>
/**
 * THE TWO NUMBERS THIS WHOLE VIEW TURNS ON, and they are here rather than in
 * main.css because they are this component's geometry, not app-wide tokens.
 *
 * `--pane-min-w` is what "wrap by the window's width" MEANS in practice: the
 * column count is `floor(workspace width / 480px)` and nothing else. 480px is a
 * terminal of roughly 60 columns at the app's font — narrow enough to put three
 * agents across a 1600px window, wide enough that an agent's TUI still lays out
 * rather than reflowing into noise. Raise it for fewer, roomier panes; lower it
 * for more.
 *
 * `--pane-min-h` is the floor under a row. Past it the grid SCROLLS instead of
 * shrinking further — a 120px terminal is not a smaller view of an agent, it is
 * an unusable one, and silently degrading every pane to fit one more is the
 * failure mode this floor exists to prevent.
 */
.agent-grid {
  --pane-min-w: 480px;
  --pane-min-h: 300px;

  display: grid;
  height: 100%;
  min-height: 0;
  padding: 12px;
  gap: 12px;
  background: var(--color-surface-app);

  /* ⚠ auto-FIT, NOT auto-fill. auto-fill keeps empty tracks, so two agents on a
     three-column window would sit in the left two thirds with a third of the
     screen blank. auto-fit collapses the empty tracks and the panes share the
     full width — which is what "side by side" has to mean to be worth doing.
     `min(…, 100%)` is the narrow-window guard: without it the track floor
     exceeds the container and the grid scrolls sideways. */
  grid-template-columns: repeat(auto-fit, minmax(min(var(--pane-min-w), 100%), 1fr));
  grid-auto-rows: minmax(var(--pane-min-h), 1fr);

  overflow-y: auto;
  overflow-x: hidden;
  /* Reserve the scrollbar's width whether or not it is showing: without it the
     pane widths jump the moment a row overflows, and every xterm in the grid
     re-fits over a change the user did not make. */
  scrollbar-gutter: stable;
}

/* The filmstrip's `.pane-frame`, applied per cell: the same inset surface,
   hairline and card radius, so a pane looks like the same object in both views
   and maximizing reads as one pane growing rather than as a different screen. */
.agent-grid-cell {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--color-surface-inset);
  border: 1px solid var(--color-border-panel);
  border-radius: var(--radius-card);
  overflow: hidden;
  transition: border-color 120ms ease;
}

/* The focused cell takes the filmstrip's periwinkle outline.
   ⚠ `:focus-within`, NOT the `focusedSessionId` PROP — TerminalPane's own note
   on its header tint is the reason and applies verbatim here: nothing updates
   that value in grid mode, so binding it would leave two panes sharing one
   stale highlight. This changes the COLOUR of an edge that is already drawn,
   which is why it does not reintroduce the competing-borders problem that
   turned the pane's focus ring into a header tint. */
.agent-grid-cell:focus-within {
  border-color: color-mix(in srgb, var(--color-accent-periwinkle) 28%, transparent);
}

@media (prefers-reduced-motion: reduce) {
  .agent-grid-cell {
    transition: none;
  }
}

.cell-missing {
  display: flex;
  height: 100%;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--color-text-tertiary);
  user-select: none;
}
</style>
