import { defineStore } from 'pinia'
import type { LayoutJson } from '../../../shared/layout'
import { appendPane, createLeaf, removePane } from '../../../shared/layout'

/**
 * The persisted binary split tree (D9) as renderer-local state.
 *
 * ⚠ D174 TURNED THIS TREE INTO AN ORDERED LIST IN TREE CLOTHING, and that is
 * the one thing to know before reading anything below. Grid mode no longer
 * renders the tree's SHAPE: `GridRenderer` flattens it with
 * `collectSessionIds` and lays the panes out in a wrapping CSS grid whose
 * column count follows the window's width. The only thing the app still reads
 * off the tree is DOCUMENT ORDER — ratios and axes are vestigial, kept because
 * they are the persisted schema (`pane_layouts`) and main's Zod contract, not
 * because anything draws them.
 *
 * ⚠ THAT IS ALSO WHY `applyRatio` IS GONE. It existed for splitpanes to write
 * a drag back, clamped, as the client half of the council's defense-in-depth
 * clamping. There are no splitters and so no drags; a store action with no
 * caller is worse than none. The invariant did not go with it — main still
 * clamps on read AND on write (`normalizeTree`), and `setRatio`'s own clamp is
 * still covered in `src/shared/layout.test.ts`.
 *
 * A null tree is the empty state (Task 1-4) — persisted as the ABSENCE of the
 * pane_layouts row (layout:set null clears it in main).
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
      // project_id (or silently lose the old project's final order).
      if (this.dirty && this.projectId && this.projectId !== projectId) {
        this.persistNow(this.projectId, this.tree)
      }
      clearTimeout(persistTimer)
      this.tree = layout
      this.projectId = projectId
      this.dirty = false
    },
    /**
     * Drop a launched session's leaf at the END of the flow — panes line up in
     * launch order and the grid wraps them by width (D174).
     *
     * TOTAL by construction (F23): an empty layout gets a single-leaf tree, a
     * populated one always GROWS — it is never replaced, whatever else is on
     * screen. The stale-anchor fallback F23 needed is gone with the anchor
     * itself: there is no target id left to go stale, which is the strongest
     * form that fix could take. Only main-returned session ids are ever
     * inserted.
     */
    appendLaunchedLeaf(newSessionId: string) {
      this.tree = {
        version: 1,
        root: this.tree ? appendPane(this.tree.root, newSessionId) : createLeaf(newSessionId)
      }
      this.dirty = true
      // ⚠ WRITE THROUGH, DO NOT DEBOUNCE — F104. `session:launch` counts panes
      // off the PERSISTED layout; this store persisted on a 500 ms debounce; so
      // N launches inside one window all saw the SAME pre-batch count, and a
      // batch of 6 from 14 panes reached 20 against a cap of 16. Task 7a-3's
      // batch loop is what made that reachable.
      //
      // ⚠ THE DEBOUNCE IS NARROWED, NOT DELETED. It exists for bursts, and a
      // LAUNCH is a discrete, user-initiated event: at most six of them,
      // sequential, each already costing a process spawn. `removeLeaf` keeps
      // the debounce, because pane closes really can arrive in bursts.
      //
      // The main-side handler is SYNCHRONOUS and IPC from one renderer is
      // delivered in order, so the write has completed before the next
      // `session:launch` message is handled.
      if (this.projectId) {
        clearTimeout(persistTimer)
        this.persistNow(this.projectId, this.tree)
        this.dirty = false
      } else {
        // No project id yet — nothing to persist against. Falling back keeps the
        // old behaviour rather than dropping the write on the floor.
        this.schedulePersist()
      }
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
