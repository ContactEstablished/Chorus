import { defineStore } from 'pinia'
import type { ViewMode, ViewState } from '../../../shared/ipc'
import type { LayoutJson } from '../../../shared/layout'
import { collectSessionIds, findLeaf } from '../../../shared/layout'

/**
 * Resolve the session the filmstrip should focus (F4 — total, never throws,
 * never a non-null assertion): the wanted id when it is still a live leaf,
 * else the first leaf in tree document order, else null for a null tree.
 * A stale focusedSessionId is normal drift, not an error.
 */
export function resolveFocused(tree: LayoutJson | null, wanted: string | null): string | null {
  if (!tree) return null
  if (wanted && findLeaf(tree.root, wanted)) return wanted
  return collectSessionIds(tree.root)[0] ?? null
}

/** Supersede guard for loadFor (the store-level twin of App.vue's loadToken):
 *  a fast tab switch must not let the slower project's view:get land last. */
let loadSeq = 0

/**
 * Per-project view state (Task 1b-2 / D20): which renderer is active
 * (filmstrip is the default) and which session is focused. Every mutation
 * persists immediately via view:set — writes are low-frequency (toggle and
 * focus clicks), so no debounce; contrast layout.ts, which debounces
 * continuous ratio drags.
 */
export const useViewStore = defineStore('view', {
  state: (): { mode: ViewMode; focusedSessionId: string | null; projectId: string | null } => ({
    mode: 'filmstrip', // D20 default until loadFor resolves
    focusedSessionId: null,
    projectId: null
  }),
  actions: {
    async loadFor(projectId: string) {
      // Pending state belongs to the OLD project — persist it there before
      // switching (mirrors layout.ts::loadLayout's flush-old-project guard).
      if (this.projectId && this.projectId !== projectId) this.persistNow()
      const seq = ++loadSeq
      const state = await window.chorus.getViewState(projectId)
      if (seq !== loadSeq) return // superseded by a faster tab switch
      this.projectId = projectId
      this.mode = state.mode
      this.focusedSessionId = state.focusedSessionId
    },
    setMode(mode: ViewMode) {
      this.mode = mode
      this.persistNow()
    },
    setFocused(sessionId: string) {
      this.focusedSessionId = sessionId
      this.persistNow()
    },
    persistNow() {
      if (!this.projectId) return
      // Fresh object literal from primitives (D14): the reactive store proxy
      // would fail Electron's structured clone at runtime.
      const snapshot: ViewState = { mode: this.mode, focusedSessionId: this.focusedSessionId }
      void window.chorus.setViewState(this.projectId, snapshot)
    }
  }
})
