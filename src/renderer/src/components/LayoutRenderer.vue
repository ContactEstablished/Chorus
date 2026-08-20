<script setup lang="ts">
import { Splitpanes, Pane } from 'splitpanes'
import 'splitpanes/dist/splitpanes.css'
import type { LayoutNode } from '../../../shared/layout'
import type { AgentKind } from '../../../shared/ipc'
import TerminalPane from './TerminalPane.vue'
import LayoutRenderer from './LayoutRenderer.vue' // recursive self-import
import { useLayoutStore, type SplitTarget } from '../stores/layout'

/**
 * Recursive adapter over the persisted binary split tree (D9): internal nodes
 * render a splitpanes split whose two children are LayoutRenderers; leaves
 * mount one TerminalPane per sessionId. splitpanes is a DUMB renderer — it
 * owns no layout state; `@resize` only writes ratios back to the store.
 */
const props = defineProps<{
  node: LayoutNode
  /** 0|1 indices from the root, addressing this node's internal node. */
  path: (0 | 1)[]
  /** Leaf sessionId -> agent kind; undefined when the session row is gone. */
  agentFor: (id: string) => AgentKind | undefined
  /**
   * The workspace's focused leaf (`effectiveFocused`), threaded down the
   * recursion so the leaf that matches it takes the keyboard on mount. Grid
   * mode keeps every pane mounted, so this is the ONLY way a pane here learns
   * it is the focused one — the filmstrip gets it for free by remounting.
   */
  focusedSessionId: string | null
}>()

/** Split requests from a leaf's header buttons are relayed unchanged up to
 *  App.vue, which owns the launch dialog and its split-target state. */
const emit = defineEmits<{ split: [target: SplitTarget] }>()

const layout = useLayoutStore()

// splitpanes v4.1.2 payload, verified against the shipped typings and source
// (D4) — the ImplementationSpec sketch's `sizes: {size}[]` parameter does not
// exist in v4; pane sizes ride the payload object.
interface SplitpanesResizePayload {
  panes: { min: number; max: number; size: number }[]
}

function onResize(payload: SplitpanesResizePayload): void {
  const size = payload.panes[0]?.size
  if (size === undefined) return
  // rAF-batched: ratios flow to the store once per frame during a drag.
  requestAnimationFrame(() => layout.applyRatio(props.path, size / 100))
}
</script>

<template>
  <template v-if="node.type === 'leaf'">
    <TerminalPane
      v-if="agentFor(node.sessionId)"
      :key="node.sessionId"
      :session-id="node.sessionId"
      :agent="(agentFor(node.sessionId) as AgentKind)"
      :focused="node.sessionId === focusedSessionId"
      @split="(target) => emit('split', target)"
    />
    <!-- Leaf whose session row is missing: hold the split geometry, mount
         nothing (same skip behavior as the interim adapter's filter). -->
    <div v-else class="leaf-missing">Session no longer exists</div>
  </template>

  <Splitpanes
    v-else
    class="chorus-splitpanes"
    :horizontal="node.type === 'column'"
    @resize="onResize"
  >
    <Pane :size="node.ratio * 100">
      <LayoutRenderer
        :node="node.children[0]"
        :path="[...path, 0]"
        :agent-for="agentFor"
        :focused-session-id="focusedSessionId"
        @split="(target) => emit('split', target)"
      />
    </Pane>
    <Pane :size="(1 - node.ratio) * 100">
      <LayoutRenderer
        :node="node.children[1]"
        :path="[...path, 1]"
        :agent-for="agentFor"
        :focused-session-id="focusedSessionId"
        @split="(target) => emit('split', target)"
      />
    </Pane>
  </Splitpanes>
</template>

<style scoped>
/* Grid mode is the one workspace surface the design never drew (the mock shows
   filmstrip only), so 3c-3 holds it to token-and-primitive conformance rather
   than to a screenshot diff — the same bar the milestone amendment sets for
   WorktreePanel. No raw hex, no stock palette utility, nothing redesigned. */
.leaf-missing {
  display: flex;
  height: 100%;
  align-items: center;
  justify-content: center;
  background: var(--color-surface-app);
  font-size: 12px;
  color: var(--color-text-tertiary);
  user-select: none;
}
</style>

<style>
/* splitpanes chrome in the app's dark palette. Unscoped on purpose: these
   classes live in the library's own DOM below this component. */
.chorus-splitpanes > .splitpanes__splitter {
  background: var(--color-border-panel);
  flex-shrink: 0;
}
.chorus-splitpanes > .splitpanes__splitter:hover,
.chorus-splitpanes > .splitpanes__splitter:active {
  background: var(--color-border-badge);
}
.chorus-splitpanes.splitpanes--vertical > .splitpanes__splitter {
  width: 5px;
  cursor: col-resize;
}
.chorus-splitpanes.splitpanes--horizontal > .splitpanes__splitter {
  height: 5px;
  cursor: row-resize;
}
</style>
