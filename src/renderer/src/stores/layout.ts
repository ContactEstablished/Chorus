import { defineStore } from 'pinia'
import type { LayoutJson } from '../../../shared/layout'
import { clampRatio, createLeaf, removePane, setRatio, splitPane } from '../../../shared/layout'

/** Where a launched session's leaf goes: split of an existing pane, or null
 *  for the empty state (the leaf becomes the single root). */
export interface SplitTarget {
  targetSessionId: string
  direction: 'row' | 'column'
}

/**
 * The persisted binary split tree (D9) as renderer-local state. splitpanes
 * owns no layout state: splitter drags write ratios back here (clamped),
 * and the tree is persisted to main via a 500 ms-debounced `layout:set`.
 * A null tree is the empty state (Task 1-4) — persisted as the ABSENCE of
 * the pane_layouts row (layout:set null clears it in main).
 */
let persistTimer: ReturnType<typeof setTimeout> | undefined

export const useLayoutStore = defineStore('layout', {
  state: () => ({ tree: null as LayoutJson | null, dirty: false }),
  actions: {
    /** Seed from the single `layout:get` round-trip made by App.vue (the tree
     *  and the sessions array travel together; a second fetch would race).
     *  Null = no persisted layout: the app shows the empty state. */
    loadLayout(layout: LayoutJson | null) {
      this.tree = layout
      this.dirty = false
    },
    applyRatio(path: (0 | 1)[], ratio: number) {
      if (!this.tree) return
      this.tree = { ...this.tree, root: setRatio(this.tree.root, path, clampRatio(ratio)) }
      this.dirty = true
      this.schedulePersist()
    },
    /** Drop a launched session's leaf into the tree: split of the target pane,
     *  or the single root leaf when launching from the empty state. Only
     *  main-returned session ids are ever inserted. */
    insertLaunchedLeaf(target: SplitTarget | null, newSessionId: string) {
      const root =
        target && this.tree
          ? splitPane(this.tree.root, target.targetSessionId, target.direction, newSessionId)
          : createLeaf(newSessionId)
      this.tree = { version: 1, root }
      this.dirty = true
      this.schedulePersist()
    },
    removeLeaf(sessionId: string) {
      if (!this.tree) return
      const root = removePane(this.tree.root, sessionId)
      // Empty layouts are legal (Task 1-4): removing the last leaf nulls the
      // tree, and the persist below clears the pane_layouts row in main.
      this.tree = root === null ? null : { ...this.tree, root }
      this.dirty = true
      this.schedulePersist()
    },
    schedulePersist() {
      clearTimeout(persistTimer)
      persistTimer = setTimeout(() => {
        // Pinia state is a reactive proxy; Electron's structured clone refuses
        // proxies ("An object could not be cloned") — send a plain snapshot.
        void window.chorus.setLayout(this.tree ? JSON.parse(JSON.stringify(this.tree)) : null)
        this.dirty = false
      }, 500)
    }
  }
})
