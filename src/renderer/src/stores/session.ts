import { defineStore } from 'pinia'
import type { AgentActivity, AgentKind, SessionStatus } from '../../../shared/ipc'

/** Coarse lifecycle shown by the pane header dot, derived from status + exitCode. */
export type DotStatus = 'detached' | 'running' | 'exited-ok' | 'exited-error'

export interface PaneSessionState {
  /** Agent kind, kept for labels/icons — never the key into this store (D10). */
  agent: AgentKind
  status: SessionStatus | 'detached'
  exitCode: number | null
  /** True while a kill/restart is in flight; disables the header buttons. */
  busy: boolean
}

/**
 * Per-session pane state, keyed by the stable sessions-row id (D10). Entries
 * are created by `attached()` on launch/attach, never pre-seeded: N concurrent
 * sessions of the same agent kind are N independent entries, so two Codex
 * panes never share status, busy flags, or exit events.
 */
export const useSessionStore = defineStore('session', {
  /**
   * ⚠ `activity` IS A SECOND MAP, NOT A FIELD ON `PaneSessionState`, and the
   * separation is load-bearing rather than stylistic.
   *
   * `sessions` entries are created by `attached()` — a pane mounted and bound
   * to this id. But the surface that needs activity most is the FILMSTRIP CARD,
   * and **a card never attaches**: it is a plain flexbox summary with no xterm,
   * no PTY stream and no attach call. Hanging activity off `PaneSessionState`
   * would have made it available for exactly the panes that already show their
   * state in full, and absent for every pane reduced to a light.
   *
   * So this map is keyed by sessionId alone, filled from main's broadcast for
   * ALL sessions, and deliberately independent of whether anything is mounted.
   */
  state: (): {
    sessions: Record<string, PaneSessionState>
    activity: Record<string, AgentActivity>
  } => ({ sessions: {}, activity: {} }),
  getters: {
    /** Header-dot status: exit code 0 -> gray (ok), non-zero -> red (error). */
    dotStatus:
      (state) =>
      (sessionId: string): DotStatus => {
        const s = state.sessions[sessionId]
        if (!s) return 'detached'
        if (s.status === 'running') return 'running'
        if (s.status === 'exited') return s.exitCode === 0 ? 'exited-ok' : 'exited-error'
        return 'detached'
      }
  },
  actions: {
    attached(sessionId: string, agent: AgentKind, status: SessionStatus, exitCode: number | null) {
      this.sessions[sessionId] = { agent, status, exitCode, busy: false }
    },
    exited(sessionId: string, exitCode: number) {
      // ⚠ The activity is dropped whether or not a pane entry exists — BEFORE
      // the early return below, which is the whole reason this line is first.
      // A dead session has no activity, and an amber left behind by the `Stop`
      // that preceded the exit would outlive the agent that reported it.
      delete this.activity[sessionId]
      const s = this.sessions[sessionId]
      if (!s) return
      s.status = 'exited'
      s.exitCode = exitCode
      s.busy = false
    },

    /** Main's edge-triggered broadcast, or the cold-read list at startup. */
    activityChanged(sessionId: string, activity: AgentActivity) {
      this.activity[sessionId] = activity
    },

    /** Replace the whole map from `session:activity-list`. A session absent
     *  from main's snapshot has no activity — assigning the object wholesale
     *  is what makes that true, where merging would strand stale entries. */
    activityLoaded(entries: readonly { sessionId: string; activity: AgentActivity }[]) {
      this.activity = Object.fromEntries(entries.map((e) => [e.sessionId, e.activity]))
    },
    setBusy(sessionId: string, busy: boolean) {
      const s = this.sessions[sessionId]
      if (s) s.busy = busy
    }
  }
})
