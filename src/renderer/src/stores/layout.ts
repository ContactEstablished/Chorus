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
 *
 * Task 1-5: the tree is scoped to one project (`projectId`); every persist
 * payload carries it so main can FK-check and store per-project.
 */
let persistTimer: ReturnType<typeof setTimeout> | undefined

export const useLayoutStore = defineStore('layout', {
  state: () => ({
    tree: null as LayoutJson | null,
    dirty: false,
    projectId: null as string | null
  }),
  actions: {
    /** Seed from the single `layout:get` round-trip made by App.vue (the tree
     *  and the sessions array travel together; a second fetch would race).
     *  Null = no persisted layout: the app shows the empty state. */
    loadLayout(layout: LayoutJson | null, projectId: string) {
      // A pending debounce belongs to the OLD project — flush it there before
      // the tree is replaced, or the switch would persist it under the new
      // project_id (or silently lose the old project's final ratio).
      if (this.dirty && this.projectId && this.projectId !== projectId) {
        this.persistNow(this.projectId, this.tree)
      }
      clearTimeout(persistTimer)
      this.tree = layout
      this.projectId = projectId
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
        if (this.projectId) this.persistNow(this.projectId, this.tree)
        this.dirty = false
      }, 500)
    },
    persistNow(projectId: string, tree: LayoutJson | null) {
      // Pinia state is a reactive proxy; Electron's structured clone refuses
      // proxies ("An object could not be cloned") — send a plain snapshot (D14).
      void window.chorus.setLayout({
        project_id: projectId,
        layout: tree ? JSON.parse(JSON.stringify(tree)) : null
      })
    }
  }
})
