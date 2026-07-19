# ImplementationSpec 1-3 — Layout View (Deep Spec)

Companion to `docs/Features/Foundation/Tasks/Task-1-3.md`. Read the task first. Exact component sketches, IPC schema, resize code, spike mechanics with a deletion checklist, NO-GO fallback, and runtime verification. Absolute dates; state verified 2026-07-18 (post-1-2).

---

## 1. Spike page construction + deletion checklist
**Mechanism (temporary):** in `App.vue`, read `new URLSearchParams(location.search).get('spike')`. When `=== 'layout'`, render `<SpikeLayout />` (a scratch SFC) instead of the real view. Launch with the dev URL carrying `?spike=layout`.

`SpikeLayout.vue` (scratch, deleted before commit): nested `<Splitpanes>`/`<Pane>` with 2-3 `TerminalPane`s (or bare xterm instances) mounted. Manually resize the OS window to **1024 / 1440 / 2560** px and observe.

**Deletion checklist (run before the commit):**
- [ ] Delete `SpikeLayout.vue`.
- [ ] Remove the `?spike` branch and the `URLSearchParams` read from `App.vue`.
- [ ] `grep -r "spike" src/` returns nothing in shipped code.
- [ ] `npm run typecheck` clean after removal.

Record the outcome (GO/NO-GO + observations) in roadmap D9.

---

## 2. Spike acceptance table (council action item 1)
| Check | 1024px | 1440px | 2560px | Pass condition |
|---|---|---|---|---|
| Canvas paints | ☐ | ☐ | ☐ | Terminal glyphs render, no blank canvas |
| No clipping / z-fighting | ☐ | ☐ | ☐ | Splitter + canvas layer cleanly |
| ResizeObserver fires during drag | ☐ | ☐ | ☐ | Callback logs mid-drag, not only drag-end |
| `fit()` plausible cols/rows | ☐ | ☐ | ☐ | cols/rows track pane pixel size sanely |

All green at all widths → **GO**. Any persistent red → **NO-GO**.

---

## 3. NO-GO fallback procedure (custom renderer)
1. Note NO-GO + the failing checks in roadmap D9.
2. Do **not** install splitpanes.
3. Implement `LayoutRenderer.vue` internals as **CSS grid** (`grid-template-columns`/`-rows: <ratio>fr <1-ratio>fr` for row/column nodes) with a `<div>` resize handle between the two children.
4. Handle logic: pointerdown → capture, pointermove → compute new ratio from pointer position relative to the container rect, `applyRatio(path, ratio)`; pointerup → drag-end persist. Cursor `col-resize` (row node) / `row-resize` (column node).
5. **Identical props/emits contract** as the splitpanes variant: props `{ node: LayoutNode }`, emits ratio changes with node path. TerminalPane, the store, IPC, and persistence are unchanged. Only `LayoutRenderer.vue`'s internals differ.

---

## 4. `LayoutRenderer.vue` — recursive component sketch (GO / splitpanes path)
```vue
<script setup lang="ts">
import { Splitpanes, Pane } from 'splitpanes'
import 'splitpanes/dist/splitpanes.css'
import type { LayoutNode } from '../../../shared/layout'
import TerminalPane from './TerminalPane.vue'
import { useLayoutStore } from '../stores/layout'
import LayoutRenderer from './LayoutRenderer.vue'   // recursive self-import

const props = defineProps<{ node: LayoutNode; path: (0 | 1)[]; agentFor: (id: string) => AgentKind }>()
const layout = useLayoutStore()

function onResize(sizes: { size: number }[]) {
  // splitpanes reports both pane sizes as %; take child[0] → ratio
  requestAnimationFrame(() => layout.applyRatio(props.path, sizes[0].size / 100))
}
</script>

<template>
  <TerminalPane
    v-if="node.type === 'leaf'"
    :sessionId="node.sessionId"
    :agent="agentFor(node.sessionId)" />

  <Splitpanes
    v-else
    :horizontal="node.type === 'column'"
    @resize="onResize">
    <Pane :size="node.ratio * 100">
      <LayoutRenderer :node="node.children[0]" :path="[...path, 0]" :agentFor="agentFor" />
    </Pane>
    <Pane :size="(1 - node.ratio) * 100">
      <LayoutRenderer :node="node.children[1]" :path="[...path, 1]" :agentFor="agentFor" />
    </Pane>
  </Splitpanes>
</template>
```
Notes:
- **Path addressing:** `path` is an array of `0|1` indices from the root. `applyRatio(path, ratio)` walks the tree to the internal node and calls `setRatio`.
- `agentFor` resolves a leaf's agent from the `sessions[]` returned by `layout:get` (passed down from `App.vue`).
- Recursive self-import works in Vue 3 `<script setup>` because the component references its own SFC file.
- `@resize` is used **only** to write ratios back — splitpanes owns no layout state.

---

## 5. Layout Pinia store (`src/renderer/src/stores/layout.ts`)
```ts
import { defineStore } from 'pinia'
import type { LayoutJson } from '../../../shared/layout'
import { setRatio, removePane, clampRatio } from '../../../shared/layout'

let persistTimer: ReturnType<typeof setTimeout> | undefined

export const useLayoutStore = defineStore('layout', {
  state: () => ({ tree: null as LayoutJson | null, dirty: false }),
  actions: {
    async loadLayout() {
      const { layout } = await window.chorus.getLayout()
      this.tree = layout
    },
    applyRatio(path: (0 | 1)[], ratio: number) {
      if (!this.tree) return
      this.tree = { ...this.tree, root: setRatio(this.tree.root, path, clampRatio(ratio)) }
      this.dirty = true
      this.schedulePersist()
    },
    removeLeaf(sessionId: string) {
      if (!this.tree) return
      const root = removePane(this.tree.root, sessionId)
      if (root === null) return            // last leaf; Phase 1 close-guard prevents this
      this.tree = { ...this.tree, root }
      this.schedulePersist()
    },
    schedulePersist() {
      clearTimeout(persistTimer)
      persistTimer = setTimeout(() => {
        if (this.tree) window.chorus.setLayout(this.tree)   // debounce 500ms
        this.dirty = false
      }, 500)
    },
  },
})
```

---

## 6. `layout:set` IPC schema + main handler
`src/shared/ipc.ts` (add):
```ts
export const layoutSetRequestSchema = layoutJsonSchema   // reuse
```
`src/main/ipc.ts` handler:
```ts
ipcMain.handle('layout:set', (_e, payload) => {
  const parsed = layoutJsonSchema.parse(payload)          // main-only
  const clamped = reClampRatios(parsed)                   // walk tree, clampRatio each internal
  storage.savePaneLayout(project.id, clamped)             // persist JSON
})
```
`src/preload/index.ts` (add): `setLayout: (layout) => ipcRenderer.invoke('layout:set', layout)`. Renderer never `.parse()`s. Ratios are clamped both client-side (store) and server-side (handler) — defense in depth per council.

---

## 7. TerminalPane resize rework — exact code
Replace the current ResizeObserver → `fit()` + immediate `resizeSession` (line ~44 area) with the council debounce sketch:
```ts
let resizeTimer: ReturnType<typeof setTimeout> | undefined

const ro = new ResizeObserver(() => {
  fitAddon.fit()                                          // continuous visual tracking
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => {
    resizeSession(props.sessionId, term.cols, term.rows)  // debounced PTY resize
  }, 150)
})
ro.observe(containerEl)                                    // OUR pane container, not splitpanes internals
onBeforeUnmount(() => { clearTimeout(resizeTimer); ro.disconnect() })
```
- `fit()` runs every observer tick (visual); `pty.resize` fires only after 150 ms of inactivity / drag-end — prevents SIGWINCH storms that corrupt alt-screen TUIs.
- Event filtering on `session:data`/`session:exit` stays keyed on `props.sessionId`.

**Scrollback + scrollbar** (change scrollback 10 000 → 5 000; add CSS):
```ts
const term = new Terminal({ scrollback: 5000, /* … */ })
```
```css
/* scoped, or global xterm override */
.xterm-viewport { overflow: hidden !important; }
```
Rationale: scrollback reflow on column change costs 50-200 ms; capping at 5000 bounds it. Hiding the viewport scrollbar prevents the fit→scrollbar-appears→ResizeObserver-refires loop.

---

## 8. Pane header + close/kill flow
Header markup (each pane): three buttons.
```html
<button :disabled="true" title="Launch a session — coming in Task 1-4">Split ⬍</button>
<button :disabled="true" title="Launch a session — coming in Task 1-4">Split ⬌</button>
<button @click="onClose">✕</button>
```
`onClose` (reuses `session:kill` from Task 1-1):
```ts
async function onClose() {
  if (isRunning && !window.confirm('Kill this session and close the pane?')) return
  await window.chorus.killSession(props.sessionId)          // Task 1-1 IPC
  layout.removeLeaf(props.sessionId)                      // removePane → sibling absorbs → persist
}
```
Phase-1 close-guard: if this is the last remaining leaf, keep the pane (do not allow `removePane` → `null` to blank the app); this edge is acceptable to leave until multi-session lands.

---

## 9. Filmstrip validation spike — scope fence
- `FilmstripRenderer.vue`: consumes the **same** `LayoutNode` tree **read-only** (no writes, no store mutations, no IPC). Renders leaves as a horizontal strip of thumbnails to prove model-view separation.
- Capture one screenshot.
- Write `docs/architecture/spike-filmstrip-notes.md` — exactly 5 bullets: (1) tree consumed unchanged? (2) any coupling discovered? (3) render cost impression, (4) de-risks Phase 1b? yes/no, (5) recommendation.
- **Delete `FilmstripRenderer.vue`** (chosen over keeping behind a dead flag). The notes doc survives.

---

## 10. App.vue final wiring
```ts
const layout = useLayoutStore()
const { sessions } = await window.chorus.getLayout()
await layout.loadLayout()
const agentFor = (id: string) => sessions.find(s => s.id === id)!.agent
```
```html
<LayoutRenderer v-if="layout.tree" :node="layout.tree.root" :path="[]" :agentFor="agentFor" />
```
Interim flatten adapter from Task 1-2 is removed. Spike branch removed (checklist §1).

---

## 11. Runtime verification script
```
npm run typecheck        # zero errors
npx vitest run           # green (incl. store clamp assertion)
npm run dev
```
In the running app:
1. **Drag splitter over the Claude TUI** — during drag the TUI stays visually intact (continuous `fit()`); at drag-end it snaps to the settled cols/rows; no cursor/box-drawing corruption.
2. **Close the Codex pane** — confirm dialog → session killed → Claude leaf absorbs full width (`removePane` sibling-absorb) → tree persisted.
3. **Restart the app** (`before-quit` disposes; relaunch) — the split ratio is restored from `pane_layouts`.
4. **Spike gone** — `?spike=layout` no longer resolves; `grep -r spike src/` clean; `FilmstripRenderer.vue` absent; `docs/architecture/spike-filmstrip-notes.md` present.
5. **DB check** (ELECTRON_RUN_AS_NODE trick) — `pane_layouts.layout_json` reflects the last dragged ratio (clamped).

---

## 12. Invariants + guardrails recap
- Ratios clamped `[0.05,0.95]` client (store) and server (handler).
- ResizeObserver on our container div only; splitpanes `@resize` writes ratios only.
- PTY resize debounced 150 ms / drag-end; alt-screen TUI integrity preserved.
- Scrollback 5 000; xterm scrollbar hidden (no observer loop).
- `sessionId` non-empty invariant intact (split disabled, no empty leaf).
- All `.parse()` in main only; splitpanes pinned `~4.1.2` behind `LayoutRenderer.vue` (or custom renderer on NO-GO, same contract).
- Spike code fully deleted before commit; no secrets in args/logs/transcripts; no unrelated/untracked files touched (the two intended docs excepted).
