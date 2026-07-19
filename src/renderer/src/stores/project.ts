import { defineStore } from 'pinia'
import type { ProjectsList } from '../../../shared/ipc'

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
  actions: {
    async load() {
      this.projects = await window.chorus.listProjects()
      this.activeId = this.projects.find((p) => p.active)?.id ?? this.projects[0]?.id ?? null
    },
    /** Native directory picker (main-side); cancel is a no-op. A chosen
     *  directory becomes a tab and is selected immediately. */
    async add() {
      const r = await window.chorus.addProject()
      if ('cancelled' in r) return
      await this.load()
      await this.select(r.project.id)
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
    }
  }
})
