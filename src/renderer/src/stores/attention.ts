import { defineStore } from 'pinia'
import type { ProjectAttention } from '../../../shared/ipc'

/**
 * The rail's lights: which projects are asking to be clicked, and since when.
 *
 * ─── WHY A STORE OF ITS OWN, NOT A FIELD ON THE PROJECT STORE ─────────────
 * `project:list` is a read of the projects TABLE plus two facts about a
 * project's place in the list (`active`, `sessionCount`). This is neither: it
 * is a volatile derivation of session state that changes many times between two
 * reads of that table, and it arrives on its own pushed channel. Folding it in
 * would have meant either refetching the whole project list on every agent
 * transition — a table read behind every hook event — or letting one store hold
 * two things with completely different refresh rules and lifetimes.
 *
 * It is the same separation, for the same reason, that keeps `activity` out of
 * `PaneSessionState` in the session store: the durable shape and the volatile
 * one stay apart, and neither has to pretend to the other's update cadence.
 *
 * ⚠ THIS STORE HAS NO TIMER AND NO DERIVED TIER. It holds instants exactly as
 * main sent them; the rung of the ladder is computed at render time against the
 * shared clock in `composables/attentionTier.ts`. A tier cached in state would
 * be a second thing needing invalidation on a schedule, and would go wrong
 * silently the moment a component read it without the clock having ticked.
 */
export const useAttentionStore = defineStore('attention', {
  state: (): { projects: Record<string, ProjectAttention> } => ({ projects: {} }),
  getters: {
    /** This project's light, or null when it has nothing to report. Absence is
     *  the ONLY way "nothing to report" is expressed — see `loaded`. */
    forProject:
      (state) =>
      (projectId: string): ProjectAttention | null =>
        state.projects[projectId] ?? null
  },
  actions: {
    /**
     * Replace the whole map from `project:attention` (pushed) or
     * `project:attention-list` (cold read).
     *
     * ⚠ WHOLESALE ASSIGNMENT IS WHAT TURNS LIGHTS OFF. Main sends every lit
     * project every time, so a project that has just been answered is expressed
     * by its ABSENCE from this array. Merging would leave its amber burning
     * forever — the light would only ever be able to appear, never clear.
     */
    loaded(entries: readonly ProjectAttention[]) {
      this.projects = Object.fromEntries(entries.map((e) => [e.projectId, e]))
    }
  }
})
