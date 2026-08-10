import { defineStore } from 'pinia'
import type {
  AgentActivity,
  AgentKind,
  SessionContextUsage,
  SessionStatus
} from '../../../shared/ipc'

/** Coarse lifecycle shown by the pane header dot, derived from status + exitCode. */
export type DotStatus = 'detached' | 'running' | 'exited-ok' | 'exited-error'

/**
 * An activity AND when it began.
 *
 * ⚠ THE INSTANT IS STORED, NEVER AN AGE, and the escalation ladder is the whole
 * reason. An age would have to be recomputed by every holder of this map on
 * every tick; an instant is written once at the transition and every surface
 * subtracts it from the one shared clock (`composables/attentionTier.ts`). It
 * is also what keeps this store free of timers — nothing here ticks.
 */
export interface SessionActivityState {
  activity: AgentActivity
  /** `Date.now()` in MAIN's clock, at the transition. */
  since: number
}

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
  /**
   * ⚠ AND `context` IS A THIRD MAP, FOR THE SAME REASON `activity` IS A SECOND
   * ONE — the argument above applies unchanged, so it is not repeated. Card,
   * not pane; keyed by sessionId alone; filled from main's broadcast for ALL
   * sessions whether or not anything is mounted.
   *
   * ⚠ AN ABSENT ENTRY IS "NO SOURCE", NOT "0%", AND THE DISTINCTION IS THE
   * FEATURE. Only Claude Code and Codex can answer this question (see
   * contextUsageCore); an `opencode` pane has no reading and must render NO
   * RING rather than an empty one, because a 0% ring is a claim — "this agent
   * has used none of its context" — that Chorus cannot stand behind. Same rule
   * as the amber light: we don't know must never render as we do know.
   */
  state: (): {
    sessions: Record<string, PaneSessionState>
    // ⚠ `SessionActivityState`, not a bare `AgentActivity` — the rail's age
    // ladder needs to know WHEN the activity started, not only what it is, so
    // the value is the pair. Kept over main's bare enum at the merge because it
    // is a superset: `state.activity[id].activity` is main's value unchanged.
    activity: Record<string, SessionActivityState>
    context: Record<string, SessionContextUsage>
  } => ({ sessions: {}, activity: {}, context: {} }),
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
      // ⚠ And so is the context reading, for the matching reason: a restart is
      // a NEW CONVERSATION (D16 clause 4), so a ring carried across the exit
      // would describe a transcript the agent no longer has. Main drops its own
      // copy on the same event (SessionManager.onExit) — this is the renderer
      // half, needed because the broadcast is edge-triggered and therefore
      // sends nothing at all when a session simply stops existing.
      delete this.context[sessionId]
      const s = this.sessions[sessionId]
      if (!s) return
      s.status = 'exited'
      s.exitCode = exitCode
      s.busy = false
    },

    /** Main's edge-triggered broadcast, or the cold-read list at startup. */
    activityChanged(sessionId: string, activity: AgentActivity, since: number) {
      this.activity[sessionId] = { activity, since }
    },

    /** Replace the whole map from `session:activity-list`. A session absent
     *  from main's snapshot has no activity — assigning the object wholesale
     *  is what makes that true, where merging would strand stale entries. */
    activityLoaded(
      entries: readonly { sessionId: string; activity: AgentActivity; since: number }[]
    ) {
      this.activity = Object.fromEntries(
        entries.map((e) => [e.sessionId, { activity: e.activity, since: e.since }])
      )
    },
    /** Main's edge-triggered context broadcast (v16). */
    contextChanged(sessionId: string, usage: SessionContextUsage) {
      this.context[sessionId] = usage
    },

    /** Replace the whole map from `session:context-list`, for the same reason
     *  `activityLoaded` assigns wholesale: a session absent from main's
     *  snapshot has no reading, and merging would strand stale rings. */
    contextLoaded(entries: readonly { sessionId: string; usage: SessionContextUsage }[]) {
      this.context = Object.fromEntries(entries.map((e) => [e.sessionId, e.usage]))
    },

    setBusy(sessionId: string, busy: boolean) {
      const s = this.sessions[sessionId]
      if (s) s.busy = busy
    }
  }
})
