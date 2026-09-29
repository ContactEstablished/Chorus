import { defineStore } from 'pinia'
import type { TeamRun, TeamSnapshot, TeamReply } from '../../../shared/team'

export function plainTeamInput<T>(input: T): T { return JSON.parse(JSON.stringify(input)) as T }
export function teamValue<T>(reply: TeamReply<T>): T { if (!reply.ok) throw new Error(reply.message); return reply.value }
export function newerTeamSnapshot(current: TeamSnapshot | undefined, next: TeamSnapshot): boolean {
  return !current || next.run.generation > current.run.generation || (next.run.generation === current.run.generation && next.run.version >= current.run.version && next.lastSequence >= current.lastSequence)
}
let unsubscribe: (() => void) | null = null
let consumers = 0
export const useTeamStore = defineStore('team', {
  state: () => ({ runs: {} as Record<string, TeamRun>, snapshots: {} as Record<string, TeamSnapshot>, errors: {} as Record<string, string>, unavailable: {} as Record<string, { projectId: string; reason: string }> }),
  actions: {
    connect(): () => void {
      consumers++
      if (!unsubscribe) unsubscribe = window.chorus.team.onChanged(event => {
        const current = this.snapshots[event.runId]
        if (current && current.run.version >= event.version && current.lastSequence >= event.lastSequence) return
        void this.refresh(event.runId).catch(() => {})
      })
      let released = false
      return () => { if (released) return; released = true; if (--consumers === 0) { unsubscribe?.(); unsubscribe = null } }
    },
    async load(projectId: string): Promise<void> {
      const result = teamValue(await window.chorus.team.list({ projectId }))
      for (const [id, record] of Object.entries(this.unavailable)) if (record.projectId === projectId) delete this.unavailable[id]
      for (const run of result.runs) { if (!this.runs[run.id] || this.runs[run.id].version <= run.version) this.runs[run.id] = run }
      for (const record of result.unavailable) { this.unavailable[record.runId] = { projectId, reason: record.reason }; delete this.runs[record.runId]; delete this.snapshots[record.runId] }
    },
    async refresh(runId: string, afterSequence = 0): Promise<TeamSnapshot> {
      try {
        const next = teamValue(await window.chorus.team.snapshot({ runId, afterSequence }))
        if (newerTeamSnapshot(this.snapshots[runId], next)) { this.snapshots[runId] = next; this.runs[runId] = next.run }
        delete this.errors[runId]; return next
      } catch (error) { this.errors[runId] = error instanceof Error ? error.message : 'Team state unavailable.'; throw error }
    }
  }
})
