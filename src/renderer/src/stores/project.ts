import { defineStore } from 'pinia'
import type { ProjectsList, ProjectUpdateRequest } from '../../../shared/ipc'

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
    async load() {
      this.projects = await window.chorus.listProjects()
      this.activeId = this.projects.find((p) => p.active)?.id ?? this.projects[0]?.id ?? null
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
    async add(): Promise<string | null> {
      const r = await window.chorus.addProject()
      if ('cancelled' in r) return null
      await this.load()
      await this.select(r.project.id)
      return r.project.id
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
    }
  }
})
