<script setup lang="ts">
import { Splitpanes, Pane } from 'splitpanes'
import 'splitpanes/dist/splitpanes.css'
import type { LayoutNode } from '../../../shared/layout'
import type { AgentKind } from '../../../shared/ipc'
import TerminalPane from './TerminalPane.vue'
import LayoutRenderer from './LayoutRenderer.vue' // recursive self-import
import { useLayoutStore } from '../stores/layout'

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
}>()

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
    />
    <!-- Leaf whose session row is missing: hold the split geometry, mount
         nothing (same skip behavior as the interim adapter's filter). -->
    <div
      v-else
      class="flex h-full items-center justify-center bg-[#1e1e1e] text-xs text-neutral-500 select-none"
    >
      Session no longer exists
    </div>
  </template>

  <Splitpanes
    v-else
    class="chorus-splitpanes"
    :horizontal="node.type === 'column'"
    @resize="onResize"
  >
    <Pane :size="node.ratio * 100">
      <LayoutRenderer :node="node.children[0]" :path="[...path, 0]" :agent-for="agentFor" />
    </Pane>
    <Pane :size="(1 - node.ratio) * 100">
      <LayoutRenderer :node="node.children[1]" :path="[...path, 1]" :agent-for="agentFor" />
    </Pane>
  </Splitpanes>
</template>

<style>
/* splitpanes chrome in the app's dark palette. Unscoped on purpose: these
   classes live in the library's own DOM below this component. */
.chorus-splitpanes > .splitpanes__splitter {
  background: #262626; /* neutral-800 */
  flex-shrink: 0;
}
.chorus-splitpanes > .splitpanes__splitter:hover,
.chorus-splitpanes > .splitpanes__splitter:active {
  background: #525252; /* neutral-600 */
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
