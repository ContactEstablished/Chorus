import { defineStore } from 'pinia'
import type {
  AgentActivity,
  AgentKind,
  SessionContextUsage,
  SessionMemoryUsage,
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
   *
   * ⚠ AND `memoryUsage` IS A FOURTH (Task 6b-1 / D168), under the same rule
   * again: absent means "this session has reported no memory use", and the
   * card shows NOTHING rather than "0 reads" — the emptiness is decided by
   * `sessionMemoryLine` in `shared/provenance.ts`, where a test can reach it.
   * Filled only from main's edge-triggered broadcast; there is deliberately no
   * cold read (see `IpcChannel.SessionMemory`).
   */
  state: (): {
    sessions: Record<string, PaneSessionState>
    // ⚠ `SessionActivityState`, not a bare `AgentActivity` — the rail's age
    // ladder needs to know WHEN the activity started, not only what it is, so
    // the value is the pair. Kept over main's bare enum at the merge because it
    // is a superset: `state.activity[id].activity` is main's value unchanged.
    activity: Record<string, SessionActivityState>
    context: Record<string, SessionContextUsage>
    memoryUsage: Record<string, SessionMemoryUsage>
  } => ({ sessions: {}, activity: {}, context: {}, memoryUsage: {} }),
  getters: {
    /**
     * Header-dot status: a recorded non-zero exit code -> red (error);
     * 0 or NO CODE AT ALL -> gray (ok).
     *
     * ⚠ NULL IS NOT A FAILURE, and reading it as one was a bug shared by all
     * four surfaces that classify an exit. `exit_code` is NULL for a session the
     * app tidied away at boot rather than watched fail, so `exitCode !== 0` put
     * a red dot on every pane that was merely alive when you last quit.
     * `attentionRollup.classify` carries the full note.
     */
    dotStatus:
      (state) =>
      (sessionId: string): DotStatus => {
        const s = state.sessions[sessionId]
        if (!s) return 'detached'
        if (s.status === 'running') return 'running'
        if (s.status === 'exited') {
          return typeof s.exitCode === 'number' && s.exitCode !== 0 ? 'exited-error' : 'exited-ok'
        }
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
      // ⚠ And the memory counter (Task 6b-1), for the same reason once more: a
      // restart is a new conversation and main drops its own copy on `revoke`,
      // so a counter carried across the exit would describe a session that no
      // longer exists. The durable answer is the sessions row.
      delete this.memoryUsage[sessionId]
      const s = this.sessions[sessionId]
      if (!s) return
      s.status = 'exited'
      s.exitCode = exitCode
      s.busy = false
    },

    /**
     * Main's edge-triggered broadcast, or the cold-read list at startup.
     *
     * ⚠ A NULL ACTIVITY DELETES THE ENTRY RATHER THAN STORING A NULL. Main
     * sends it when it retires a `working` claim that has shown no sign of
     * life (`sessionActivityEventSchema`), and the state that leaves behind is
     * the one a session has before its first hook event: nothing known.
     * ABSENCE is how this map already spells that — `activityLoaded` and every
     * reader depend on it — so storing `{ activity: null }` would invent a
     * second spelling that every `?.activity === 'working'` reader would get
     * right by luck and every `sessionId in activity` reader would get wrong.
     */
    activityChanged(sessionId: string, activity: AgentActivity | null, since: number) {
      if (activity === null) {
        delete this.activity[sessionId]
        return
      }
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

    /** Main's edge-triggered memory-usage broadcast (Task 6b-1 / D168). */
    memoryUsageChanged(sessionId: string, usage: SessionMemoryUsage) {
      this.memoryUsage[sessionId] = usage
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
