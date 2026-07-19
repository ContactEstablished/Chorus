import { defineStore } from 'pinia'
import type { LayoutJson } from '../../../shared/layout'
import { clampRatio, removePane, setRatio } from '../../../shared/layout'

/**
 * The persisted binary split tree (D9) as renderer-local state. splitpanes
 * owns no layout state: splitter drags write ratios back here (clamped),
 * and the tree is persisted to main via a 500 ms-debounced `layout:set`.
 */
let persistTimer: ReturnType<typeof setTimeout> | undefined

export const useLayoutStore = defineStore('layout', {
  state: () => ({ tree: null as LayoutJson | null, dirty: false }),
  actions: {
    /** Seed from the single `layout:get` round-trip made by App.vue (the tree
     *  and the sessions array travel together; a second fetch would race). */
    loadLayout(layout: LayoutJson) {
      this.tree = layout
      this.dirty = false
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
      // Phase-1 close-guard: never blank the app by dropping the last leaf.
      if (root === null) return
      this.tree = { ...this.tree, root }
      this.dirty = true
      this.schedulePersist()
    },
    schedulePersist() {
      clearTimeout(persistTimer)
      persistTimer = setTimeout(() => {
        // Pinia state is a reactive proxy; Electron's structured clone refuses
        // proxies ("An object could not be cloned") — send a plain snapshot.
        if (this.tree) void window.chorus.setLayout(JSON.parse(JSON.stringify(this.tree)))
        this.dirty = false
      }, 500)
    }
  }
})
