import { defineStore } from 'pinia'
import type {
  ProjectDeleteResponse,
  ProjectImpact,
  ProjectsList,
  ProjectStatus,
  ProjectUpdateRequest,
  TuckedProjectStatus
} from '../../../shared/ipc'

/**
 * Project tabs state (Task 1-5). The list comes from `project:list`; the
 * active id is DERIVED from main's persisted `active_project_id` setting —
 * main is the source of truth (boot resolves/persists it; project:select
 * re-persists it, lazy-restores the project's sessions, and retitles the
 * window). The layout tree itself is loaded by App.vue's single-round-trip
 * watcher on `activeId`.
 */
export const useProjectStore = defineStore('project', {
  state: (): { projects: ProjectsList; activeId: string | null } => ({
    projects: [],
    activeId: null
  }),
  getters: {
    /** The active project's row, or null. The settings screen edits THIS
     *  rather than holding its own copy of the list. */
    active(state) {
      return state.projects.find((p) => p.id === state.activeId) ?? null
    }
  },
  actions: {
    /**
     * ⚠ THE FALLBACK SKIPS ARCHIVED PROJECTS (v15/D120), AND IT HAS TO.
     *
     * `?? this.projects[0]?.id` was written when every project was selectable,
     * and main's `active_project_id` is legitimately ABSENT in two states now:
     * first run, and every project archived. In the second state the old
     * fallback made the FIRST ARCHIVED PROJECT locally active — a project main
     * refuses to select, which the rail then draws anyway (the partition rule
     * keeps the active project visible), leaving the renderer pointed at a
     * project the main process does not consider active. Found at runtime while
     * setting up the boot-seed check, by archiving everything.
     *
     * Null is the honest answer when nothing qualifies: the workspace's
     * no-project state already exists and says so.
     */
    async load() {
      this.projects = await window.chorus.listProjects()
      this.activeId =
        this.projects.find((p) => p.active)?.id ??
        this.projects.find((p) => p.status !== 'archived')?.id ??
        null
    },
    /**
     * Native directory picker (main-side); cancel is a no-op. A chosen
     * directory becomes a tab and is selected immediately.
     *
     * ⚠ RETURNS THE NEW PROJECT'S ID (null on cancel) so the caller can take
     * the user straight to its settings screen. Previously this returned
     * nothing and the add flow ended at "a row appeared in the rail"; naming
     * and colouring a project was impossible because there was no screen to do
     * it on and no moment that led there.
     */
    async add(): Promise<{
      id: string
      name: string
      reactivatedFrom: TuckedProjectStatus | null
    } | null> {
      const r = await window.chorus.addProject()
      if ('cancelled' in r) return null
      await this.load()
      await this.select(r.project.id)
      // ⚠ `reactivated_from` IS RETURNED TO THE CALLER, NOT SWALLOWED HERE (F45).
      // `root_path` is UNIQUE, so this call can REACTIVATE a project the user
      // retired rather than add one — and which of the two happened changes what
      // the app should do next, so it is the caller's decision and not this
      // action's. Returning only the id, as this used to, made a reactivation
      // indistinguishable from a fresh add at every call site.
      //
      // `name` rides along rather than being looked up again: it is main's
      // response, already trimmed and stored, and the sentence built from it
      // must name the project the DATABASE holds rather than one re-derived
      // from a list that a concurrent reload could have moved.
      return {
        id: r.project.id,
        name: r.project.name,
        reactivatedFrom: r.reactivated_from
      }
    },
    /** Switch the active tab. Main persists the id, runs lazy restore for the
     *  project (idempotent within a run), and retitles the window; App.vue's
     *  watcher then loads the layout. Switching never kills sessions. */
    async select(id: string) {
      if (id === this.activeId) return
      this.activeId = id
      await window.chorus.selectProject(id)
      // Refresh the active flags so the tab highlight matches main's state.
      this.projects = this.projects.map((p) => ({ ...p, active: p.id === id }))
    },
    /**
     * Save name + colour + description from the project settings screen.
     *
     * ⚠ THE ROW IS PATCHED FROM MAIN'S RESPONSE, NOT FROM THE REQUEST. Main
     * trims the name and folds an all-whitespace description to null, so
     * echoing what we sent would leave the rail showing a name the database
     * does not hold. `sessionCount` and `active` are list-only fields that
     * `project:update` does not return, so they are carried over from the row
     * already in the store rather than refetched — this is a rename, and it
     * moves neither.
     */
    async update(request: ProjectUpdateRequest): Promise<void> {
      const { project } = await window.chorus.updateProject(request)
      this.projects = this.projects.map((p) => (p.id === project.id ? { ...p, ...project } : p))
    },

    /**
     * Hide, archive, or restore a project (D120).
     *
     * ⚠ IT RELOADS RATHER THAN PATCHING THE ONE ROW, unlike `update` above, and
     * the difference is not laziness. Archiving changes facts about OTHER rows:
     * the active project may move to a different one, and this project's
     * `sessionCount` no longer describes anything running. Patching one row
     * would leave the rail showing a stale count and possibly two highlighted
     * projects. `active_project_id` comes from main because the renderer cannot
     * predict main's successor rule and must not guess.
     *
     * Returns how many live agents were stopped, so the caller can say so.
     */
    async setStatus(projectId: string, status: ProjectStatus): Promise<number> {
      const res = await window.chorus.setProjectStatus({ project_id: projectId, status })
      await this.load()
      this.activeId = res.active_project_id
      return res.sessions_stopped
    },

    /** The counts a delete confirmation states before it happens (D123). */
    async impact(projectId: string): Promise<ProjectImpact> {
      return window.chorus.projectImpact(projectId)
    },

    /**
     * Purge a project. `typedName` must match the stored name exactly — main
     * checks and throws otherwise, and this deliberately does not pre-check:
     * one authority on that, on the side a mistaken renderer cannot skip.
     */
    async remove(projectId: string, typedName: string): Promise<ProjectDeleteResponse> {
      const res = await window.chorus.deleteProject(projectId, typedName)
      await this.load()
      this.activeId = res.active_project_id
      return res
    },

    /**
     * Write the rail's order.
     *
     * ⚠ THE FRESH `string[]` IS THE POINT, NOT AN AFFECTATION (D14). `orderedIds`
     * as it arrives here may be — and from the rail always is — derived from
     * this store's own state, which Pinia serves as a VUE PROXY. Handing a Proxy
     * to `ipcRenderer.invoke` throws "An object could not be cloned" at RUNTIME
     * with NO COMPILE-TIME SIGNAL: the type is `string[]` either way. Mapping
     * every element into a new array with `String(...)` gives structured clone
     * plain primitives in a plain array, which is the only shape it accepts.
     *
     * The optimistic local reorder is what keeps the rail from snapping back
     * for a round-trip after a drag the user already watched land.
     */
    async reorder(orderedIds: string[]): Promise<void> {
      const plain = orderedIds.map((id) => String(id))
      const byId = new Map(this.projects.map((p) => [p.id, p]))
      const reordered = plain.map((id) => byId.get(id)).filter((p): p is ProjectsList[number] => !!p)
      if (reordered.length === this.projects.length) this.projects = reordered
      await window.chorus.reorderProjects(plain)
    }
  }
})
