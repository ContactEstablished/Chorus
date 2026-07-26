import { defineStore } from 'pinia'
import type {
  CouncilAccounting,
  CouncilMemberWire,
  CouncilProgressEvent
} from '../../../shared/ipc'

/**
 * Task 3b-4: the council run's renderer-side state.
 *
 * ⚠ IT OWNS NO TRANSPORT AND NO FILESYSTEM. There is no `fetch` here, no `fs`,
 * and no path arithmetic: the brief is chosen by a MAIN-side dialog, opened by
 * main, and the findings path is DERIVED in main from the validated brief path.
 * This store holds what came back and nothing it computed itself.
 *
 * ⚠ AND EVERY BYTE OF `messages` ARRIVED PRE-SCRUBBED. `council:progress` is fed
 * from main's `SessionOutput.onText` (`councilService.driveMember`), which is
 * the one ingest seam; there is deliberately no second channel here that could
 * carry a raw model stream.
 */

/** One member's live text for one phase of one round, accumulated from deltas.
 *  Kept as a flat array in arrival order — the view renders the deliberation as
 *  it happened, and a per-member map would lose the ordering that makes a blind
 *  round legible. */
export interface CouncilMessage {
  memberId: string | null
  phase: CouncilProgressEvent['phase']
  round: number
  text: string
}

interface CouncilStoreState {
  runId: string | null
  /** As MAIN normalized it, echoed back for display only. */
  briefPath: string | null
  phase: CouncilProgressEvent['phase'] | null
  round: number | null
  members: CouncilMemberWire[]
  messages: CouncilMessage[]
  findings: string | null
  findingsPath: string | null
  /** The reason beside a null path, so an absent file is never an absent
   *  explanation. */
  findingsError: string | null
  accounting: CouncilAccounting | null
  costUsd: number | null
  error: string | null
  running: boolean
  /** Store-level supersede token — `view.ts::loadFor`'s idiom. A component-level
   *  token cannot cancel an await already running INSIDE the store. */
  loadSeq: number
}

/** ⚠ NOT IN STATE. The unsubscribe handle is a function; Pinia state is
 *  devtools-serialized and structured-cloned, and a function there is a trap
 *  waiting for the first person who snapshots the store. */
let offProgress: (() => void) | null = null

export const useCouncilStore = defineStore('council', {
  state: (): CouncilStoreState => ({
    runId: null,
    briefPath: null,
    phase: null,
    round: null,
    members: [],
    messages: [],
    findings: null,
    findingsPath: null,
    findingsError: null,
    accounting: null,
    costUsd: null,
    error: null,
    running: false,
    loadSeq: 0
  }),

  getters: {
    /** The roster the run will actually convene, in main's own resolution. */
    arbiters: (state): CouncilMemberWire[] => state.members.filter((m) => m.role === 'arbiter'),
    deliberators: (state): CouncilMemberWire[] => state.members.filter((m) => m.role === 'member'),
    /** ⚠ A PARTIAL COUNCIL MUST READ AS PARTIAL (spec §4.2). Surfaced beside the
     *  roster rather than inferred from a count the user has to do themselves. */
    unavailable: (state): CouncilMemberWire[] => state.members.filter((m) => !m.available)
  },

  actions: {
    /** The saved roster, from main. Superseded loads are dropped rather than
     *  applied late. */
    async loadMembers(): Promise<void> {
      const seq = ++this.loadSeq
      try {
        const res = await window.chorus.listCouncilMembers()
        if (seq !== this.loadSeq) return // superseded by a newer load
        this.members = res.members
      } catch (err) {
        if (seq !== this.loadSeq) return
        this.error = err instanceof Error ? err.message : 'The council members could not be loaded.'
      }
    },

    /**
     * Subscribe to the scrubbed progress broadcast.
     *
     * ⚠ IDEMPOTENT, AND THE PREVIOUS HANDLE IS RELEASED FIRST. The F13 leak
     * (`de98679`) was a listener registered after an `await` in `onMounted`
     * outliving its component; a store-level subscription has the same failure
     * with a longer life, so there is exactly one live at a time and
     * `unsubscribe` is called on unmount.
     */
    subscribe(): void {
      this.unsubscribe()
      offProgress = window.chorus.onCouncilProgress((event) => {
        // ⚠ THE FIRST DELTA IS HOW THIS SIDE LEARNS THE RUN ID, and without it
        // Cancel would be unreachable: `council:start` is ONE invoke that does
        // not resolve until the whole deliberation is over, so the id on its
        // response arrives far too late to cancel anything. Adopted only while
        // a run of ours is in flight, so a stray delta from another window's
        // run cannot bind this store to it.
        if (this.runId === null) {
          if (!this.running) return
          this.runId = event.runId
        } else if (event.runId !== this.runId) {
          return
        }
        this.phase = event.phase
        this.round = event.round
        this.ingest(event)
      })
    },

    unsubscribe(): void {
      if (offProgress) offProgress()
      offProgress = null
    },

    /**
     * Append a delta to the turn it belongs to, or open a new turn.
     *
     * ⚠ MATCHED AGAINST EVERY OPEN TURN, NOT JUST THE LAST ONE — and the first
     * build got this wrong in exactly the case the protocol is built around. A
     * blind round asks every member CONCURRENTLY, so their deltas interleave;
     * comparing only against the newest message opened a fresh block on every
     * switch between members. The live drive rendered 291 fragments for what
     * should have been eight turns. The key is (member, phase, round) and it has
     * to be looked up, because "the last one" is not the same thing.
     */
    ingest(event: CouncilProgressEvent): void {
      const open = this.messages.find(
        (m) => m.memberId === event.memberId && m.phase === event.phase && m.round === event.round
      )
      if (open) {
        open.text += event.delta
        return
      }
      this.messages.push({
        memberId: event.memberId,
        phase: event.phase,
        round: event.round,
        text: event.delta
      })
    },

    /** The MAIN-side native picker. The renderer never enumerates the
     *  filesystem, and the path that comes back is re-validated by main on
     *  start — the dialog is a convenience, not the boundary. */
    async pickBrief(): Promise<void> {
      this.error = null
      const res = await window.chorus.pickCouncilBrief()
      if ('cancelled' in res) return // a structured no-op, not an error
      this.briefPath = res.path
    },

    /**
     * Run the council. ⚠ D14: the payload is a FRESH LITERAL built from
     * primitives read out of state — handing a Pinia proxy to `ipcRenderer`
     * fails Electron's structured clone at runtime with no compile-time signal.
     */
    async run(projectId: string | null): Promise<void> {
      if (this.running || this.briefPath === null) return
      this.running = true
      this.error = null
      this.findings = null
      this.findingsPath = null
      this.findingsError = null
      this.accounting = null
      this.costUsd = null
      this.messages = []
      this.phase = null
      this.round = null
      this.runId = null
      try {
        const res = await window.chorus.startCouncilRun({
          project_id: projectId,
          brief_path: String(this.briefPath)
        })
        if (!res.ok) {
          this.error = res.reason
          return
        }
        this.runId = res.run_id
        this.findings = res.findings
        this.findingsPath = res.findings_path
        this.findingsError = res.findings_error
        this.accounting = res.accounting
        this.costUsd = res.cost_usd
        this.phase = 'done'
      } catch (err) {
        this.error = err instanceof Error ? err.message : 'The council run failed.'
      } finally {
        this.running = false
      }
    },

    /** `cancelled: false` means there was no such live run — a race the user
     *  cannot see, and not an error worth showing them. */
    async cancel(): Promise<void> {
      if (this.runId === null) return
      await window.chorus.cancelCouncilRun({ run_id: String(this.runId) })
    }
  }
})
