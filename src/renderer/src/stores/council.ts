import { defineStore } from 'pinia'
import type {
  CouncilAccounting,
  CouncilDocketRun,
  CouncilMemberWire,
  CouncilVerdictResponse,
  CouncilProgressEvent,
  CouncilQuestionSummary,
  CouncilRunStage,
  CouncilTranscriptTurn
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
  /** The per-question glance, as MAIN computed it. ⚠ EMPTY MEANS "no run has
   *  reported one", which is why the strip is hidden on emptiness rather than
   *  drawn with zeroes — a summary of nothing is not a summary saying nothing
   *  happened. Never computed on this side: the verdict tokens are parsed once,
   *  in `councilCore`, and re-parsing them here would be a second measurement
   *  free to disagree with the findings file. */
  questionSummary: CouncilQuestionSummary[]
  accounting: CouncilAccounting | null
  costUsd: number | null
  /** ⚠ TRUE = the figure omits the run's final turn (F41). Held beside the cost
   *  rather than derived, because this side cannot tell the two apart. */
  costIsProvisional: boolean
  error: string | null
  /**
   * ⚠ TWO FACTS, AND THEY ARE DELIBERATELY STILL ONE FLAG. It means both "a
   * deliberation is being broadcast into this surface" and "a `council:start`
   * invoke is outstanding", and every escape the user has — Cancel vs Run
   * council, the Esc handler, `showDocket`, `newRun`, `clearRun`, `openRun` — is
   * gated on it.
   *
   * ⚠ SPLITTING THE TWO WAS CONSIDERED AND REFUSED, on evidence rather than on
   * taste. The split would let the surface unlock while the invoke was still in
   * flight, and `run()`'s only guard against a concurrent council is this flag —
   * so `Run council` would have to stay disabled anyway, with nothing on screen
   * saying why, which is the same trap in a new costume. The reason it is not
   * needed is that `council:start` ALWAYS settles: every await in
   * `councilService.start` is bounded — the management calls by
   * `AbortSignal.timeout(10_000)`, every member turn by `COUNCIL_TURN_TIMEOUT_MS`
   * raced around both the fetch and each stream read, and the protocol loop by
   * `MAX_PROTOCOL_STEPS`. There is no "stuck forever" state to escape from; there
   * was a state nobody could SEE, and that is what `cancelStage` below fixes.
   */
  running: boolean
  /**
   * What main last said the run was doing when a cancel reached it, or null when
   * no cancel has been asked for this run.
   *
   * ⚠ IT UNLOCKS NOTHING. It is feedback and only feedback: `running` is
   * untouched by every value it can take, because in the `settling` case the
   * invoke is still outstanding and about to resolve with real findings. Clearing
   * `running` there would re-enable `Run council` and let a second paid
   * deliberation start over the top of the first.
   *
   * ⚠ THE FACT LIVES HERE AND THE WORDS LIVE IN THE VIEW. Main answers with a
   * stage, not a sentence — the same separation `questionSummary` keeps, and the
   * reason this is testable on the fact rather than on a string.
   */
  cancelStage: CouncilRunStage | null
  /** Store-level supersede token — `view.ts::loadFor`'s idiom. A component-level
   *  token cannot cancel an await already running INSIDE the store. */
  loadSeq: number

  /* ---- the STORED transcript (D97 / Task 3e-4) --------------------------
   *
   * ⚠ FOUR FIELDS OF ITS OWN, AND THE SEPARATION FROM `messages` IS THE WHOLE
   * DESIGN (ImplementationSpec-3e-4 §3). `messages` is fed by the live
   * `council:progress` broadcast through `ingest()`, whose block identity is
   * keyed on (member, phase, round) — F37's fix, after a live run rendered 291
   * fragments where 8 turns belonged. Loading historical rows into it would put
   * finished text through a delta-append path it is not, and would collide with
   * a run in flight. These rows arrive whole; they never need appending; they
   * live here. */
  /** null means "not loaded", which is different from "loaded and empty". */
  transcript: CouncilTranscriptTurn[] | null
  /** Rows stored for the run — `transcript.length`'s denominator (D55). */
  transcriptTotal: number
  /** The read hit its cap. Rendered, never swallowed. */
  transcriptTruncated: boolean
  transcriptError: string | null
  transcriptLoading: boolean
  /** ⚠ NOT `loadSeq`. Sharing one token would let a roster reload silently
   *  cancel a transcript read, which is a bug nobody would look for. */
  transcriptSeq: number

  /* ---- the DOCKET (D112–D115) -------------------------------------------
   *
   * ⚠ THE VIEW'S TWO SURFACES ARE ONE STORE, AND THE PAST RUN'S FIELDS ARE ITS
   * OWN. `pastFindings` is deliberately NOT `findings`: that field is written by
   * the live `run()` path and cleared at the top of it. Pointing a history reader
   * at it would mean opening an old run mid-deliberation overwrote the running
   * council's result, and starting a run silently blanked the archived document
   * you were reading. This is the same separation — and the same reason — as the
   * stored-transcript quartet above, whose comment explains what mixing live and
   * finished text cost the first time (F37). */
  /** Which surface the main pane shows. The Docket is the LANDING view (D114):
   *  opening the council answers "what has this project decided" before it offers
   *  to spend $1.09 asking something new. */
  mode: 'docket' | 'run'
  /** null means "not loaded", which is different from "loaded and empty" — an
   *  empty Docket is a real, renderable state (no councils yet). */
  docket: CouncilDocketRun[] | null
  docketError: string | null
  docketLoading: boolean
  /** Its own token, for `transcriptSeq`'s reason. */
  docketSeq: number
  /** The run being READ, which is never the run being RUN. Null in docket mode
   *  and during a live run. */
  viewingRunId: string | null
  pastFindings: string | null
  pastFindingsPath: string | null
  /** The reason beside an absent document, so a missing file is never a missing
   *  explanation — `findingsError`'s contract, applied to history. */
  pastFindingsError: string | null
  pastFindingsLoading: boolean
  /** ⚠ Separate from `docketSeq` AND from `transcriptSeq`. Opening a run fires a
   *  findings read and a transcript read together; one token could not supersede
   *  them independently, and clicking through three rows quickly is the ordinary
   *  way to use this surface, not an edge case. */
  pastFindingsSeq: number

  /* ---- the Verdict strip (D106) ------------------------------------------
   * ⚠ ONE MORE FIELD SET THAT IS THE PAST RUN'S OWN, for the reason the
   * `pastFindings` block above gives. `questionSummary` is the LIVE strip, fed by
   * the `council:summary` broadcast; this is a stored run's, derived in main from
   * its turns. A single field would mean opening history mid-run repainted the
   * running council's glance strip with a three-week-old result. */
  verdict: CouncilVerdictResponse | null
  verdictLoading: boolean
  verdictError: string | null
  verdictSeq: number
}

/** ⚠ NOT IN STATE. The unsubscribe handle is a function; Pinia state is
 *  devtools-serialized and structured-cloned, and a function there is a trap
 *  waiting for the first person who snapshots the store. */
let offProgress: (() => void) | null = null
/** Its own handle, for the same reason and with the same discipline. Held
 *  separately rather than folded into one composite unsubscribe so neither
 *  channel can be released by accident while the other stays live. */
let offSummary: (() => void) | null = null
/** The third, on the same terms. */
let offOpened: (() => void) | null = null

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
    questionSummary: [],
    accounting: null,
    costUsd: null,
    costIsProvisional: false,
    error: null,
    running: false,
    cancelStage: null,
    loadSeq: 0,
    transcript: null,
    transcriptTotal: 0,
    transcriptTruncated: false,
    transcriptError: null,
    transcriptLoading: false,
    transcriptSeq: 0,
    mode: 'docket',
    docket: null,
    docketError: null,
    docketLoading: false,
    docketSeq: 0,
    viewingRunId: null,
    pastFindings: null,
    pastFindingsPath: null,
    pastFindingsError: null,
    pastFindingsLoading: false,
    pastFindingsSeq: 0,
    verdict: null,
    verdictLoading: false,
    verdictError: null,
    verdictSeq: 0
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

      /**
       * ⚠ THE RUN ID, AT THE EARLIEST INSTANT IT IS TRUE — AND THIS IS WHAT
       * MAKES CANCEL REACHABLE. `council:start` is one invoke that does not
       * resolve until the deliberation is over, and the progress listener below
       * cannot bind the id until a member emits its FIRST TOKEN, which for a
       * reasoning model is minutes. In that gap the run was live and spending in
       * main and `Cancel run` was disabled on `runId === null`, so the only exit
       * from a run that died there was restarting the app.
       *
       * ⚠ THE ADOPTION RULE IS THE PROGRESS LISTENER'S, VERBATIM AND FOR ITS
       * REASON: only while a run of OURS is in flight, and only when no id is
       * bound yet. This event is broadcast to every window, so without the
       * `running` check a council convened in another window would bind this
       * store to a run it did not start — and this store's Cancel would then
       * abort a deliberation on somebody else's screen.
       */
      offOpened = window.chorus.onCouncilOpened((event) => {
        if (!this.running || this.runId !== null) return
        this.runId = event.runId
      })

      offProgress = window.chorus.onCouncilProgress((event) => {
        // ⚠ IT STILL ADOPTS, AND IT IS NO LONGER THE ONLY THING THAT DOES.
        // `council:opened` above now binds the id at the mint, minutes earlier,
        // which is what made Cancel reachable at all. This is kept as the
        // fallback for the one case that event cannot cover: a store that
        // subscribed AFTER the run opened — re-entering the view mid-run — has
        // missed the one-shot broadcast and would otherwise never learn the id.
        // Same adoption rule, same reason: only while a run of ours is in
        // flight, so a stray delta from another window's run cannot bind us.
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

      /**
       * The at-a-glance vector, which arrives when the positions round closes —
       * four phases before the findings do.
       *
       * ⚠ IT DOES NOT ADOPT A RUN ID THE WAY `onCouncilOpened` AND
       * `onCouncilProgress` DO. Those two adopt because the id has to reach this
       * side while `council:start` is still in flight — the first at the mint,
       * the second as the fallback for a store that subscribed late. This event
       * has no such job: by the time the positions round closes, deltas have been
       * arriving for minutes and the id is long since bound. So it only ever
       * CHECKS — which means a summary cannot bind this store to a run, and a
       * second window's run cannot paint a strip here.
       */
      offSummary = window.chorus.onCouncilSummary((event) => {
        if (this.runId === null || event.runId !== this.runId) return
        this.questionSummary = event.questions
      })
    },

    unsubscribe(): void {
      if (offProgress) offProgress()
      offProgress = null
      if (offSummary) offSummary()
      offSummary = null
      if (offOpened) offOpened()
      offOpened = null
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
     * Put the run surface back to "no council has run here yet".
     *
     * ⚠ ONE AUTHORITY FOR WHAT A RUN LEAVES BEHIND, and both callers go through
     * it. `run()` used to clear these fields inline and `newRun()` cleared none
     * of them, which is how "New council" landed the user on a surface still
     * showing the LAST run's phase track, transcript, glance strip and findings
     * — a finished run wearing a live run's clothes. Two lists that had to agree
     * and no reason they would.
     *
     * ⚠ `briefPath` IS DELIBERATELY KEPT. It is the one field the user chose
     * themselves, re-running the same brief is the ordinary next move, and main
     * re-validates the path on start anyway — the picker is a convenience, not
     * the boundary.
     *
     * ⚠ AND IT REFUSES WHILE A COUNCIL IS RUNNING, for `newRun`'s reason: this
     * would blank a paid deliberation off the screen while it is still being
     * broadcast into, and the deltas would immediately start rebuilding a
     * transcript with its first minutes missing. Cancel ends a run; this only
     * ever clears one that has already ended.
     */
    clearRun(): void {
      if (this.running) return
      this.error = null
      // The stage main reported for THIS run's cancel. A "still settling" note
      // left standing over the next council would describe a run that ended.
      this.cancelStage = null
      this.findings = null
      this.findingsPath = null
      this.findingsError = null
      // ⚠ CLEARED WITH THE FINDINGS, not left standing while the new run works.
      // The strip sits ABOVE the transcript, so a stale one would read as this
      // run's own early result for the whole length of a fourteen-minute run.
      this.questionSummary = []
      this.accounting = null
      this.costUsd = null
      this.costIsProvisional = false
      this.messages = []
      this.phase = null
      this.round = null
      this.runId = null
      // A stored transcript belonging to the PREVIOUS run must not survive into
      // this one's panel — it would read as this run's own history.
      this.clearTranscript()
    },

    /**
     * Run the council. ⚠ D14: the payload is a FRESH LITERAL built from
     * primitives read out of state — handing a Pinia proxy to `ipcRenderer`
     * fails Electron's structured clone at runtime with no compile-time signal.
     */
    async run(projectId: string | null): Promise<void> {
      if (this.running || this.briefPath === null) return
      // ⚠ BEFORE `running` GOES TRUE, because `clearRun` refuses while it is.
      // The guard above has already established that it is false here.
      this.clearRun()
      this.running = true
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
        this.questionSummary = res.question_summary
        this.accounting = res.accounting
        this.costUsd = res.cost_usd
        this.costIsProvisional = res.cost_is_provisional
        this.phase = 'done'
      } catch (err) {
        this.error = err instanceof Error ? err.message : 'The council run failed.'
      } finally {
        this.running = false
        // ⚠ REFRESHED WHATEVER THE OUTCOME, AND THAT IS THE POINT. A run that
        // failed or was cancelled is still history — it cost tokens and minutes,
        // and `council_runs` recorded it. A Docket that listed only the successes
        // would be a more flattering account than the one the database holds.
        // Awaited nowhere: the run surface already has its result, and the list
        // behind it can arrive when it arrives.
        if (projectId !== null) void this.loadDocket(projectId)
      }
    },

    /**
     * Load a stored run's transcript (D97). **Read-only, and it touches
     * `messages` nowhere** — see the state comment.
     *
     * Superseded reads are dropped rather than applied late, the `loadMembers`
     * idiom, on a token of its own.
     */
    async loadTranscript(runId: string): Promise<void> {
      const seq = ++this.transcriptSeq
      this.transcriptLoading = true
      this.transcriptError = null
      try {
        const res = await window.chorus.getCouncilTranscript({ run_id: String(runId) })
        if (seq !== this.transcriptSeq) return // superseded by a newer read
        this.transcript = res.turns
        this.transcriptTotal = res.total_turns
        this.transcriptTruncated = res.truncated
      } catch (err) {
        if (seq !== this.transcriptSeq) return
        this.transcript = null
        this.transcriptError =
          err instanceof Error ? err.message : 'That run’s transcript could not be read.'
      } finally {
        if (seq === this.transcriptSeq) this.transcriptLoading = false
      }
    },

    /** Dropped when the view closes, so a re-entry re-reads rather than showing
     *  a transcript belonging to a run the user has moved on from. */
    clearTranscript(): void {
      this.transcriptSeq++
      this.transcript = null
      this.transcriptTotal = 0
      this.transcriptTruncated = false
      this.transcriptError = null
      this.transcriptLoading = false
    },

    /**
     * Ask main to stop the run, and KEEP WHAT IT ANSWERS.
     *
     * ⚠ THE ANSWER USED TO BE THROWN AWAY, AND THAT WAS THE SECOND HALF OF THE
     * DEFECT. Main replies with the stage the run was in, and for the whole
     * settle-and-reconcile tail after a deliberation ends that stage is
     * `settling` — the run has left main's live map, its key is being revoked and
     * its cost read back, and its `council:start` invoke is still outstanding.
     * Discarding that reply meant a user clicking Cancel in that window saw
     * absolutely nothing change, on a surface that already looked hung. The
     * window is ~10s when the provider answers promptly and up to ~90s when it
     * does not (six analytics reads at a 10s timeout, 2s apart, after two
     * management calls at the same timeout).
     *
     * ⚠ AND IT STILL DOES NOT TOUCH `running`. Not on `settling`, not on
     * `unknown`, not on any value. The invoke is in flight and will resolve with
     * real findings; `running` is the ONLY guard `run()` has against a concurrent
     * council, so clearing it here would let a second paid deliberation start
     * over the top of the first — two runs billed, one visible, and the findings,
     * accounting and cost of the first written over the second's state. The
     * recovery this action offers is an honest sentence, not an unlocked button.
     */
    async cancel(): Promise<void> {
      if (this.runId === null) return
      try {
        const res = await window.chorus.cancelCouncilRun({ run_id: String(this.runId) })
        this.cancelStage = res.stage
      } catch (err) {
        // A cancel that could not even be delivered is the one case the user
        // must not be left guessing about — it is the only outcome here that is
        // an error rather than a stage.
        this.error = err instanceof Error ? err.message : 'That run could not be cancelled.'
      }
    },

    /* ---- the Docket (D112–D115) ------------------------------------------ */

    /**
     * Load one project's history. Superseded reads are dropped rather than
     * applied late — `loadMembers`' idiom, on a token of its own.
     *
     * ⚠ IT DOES NOT CLEAR `docket` FIRST. Re-entering the view or switching
     * projects would otherwise flash an empty list before the rows arrive, and an
     * empty Docket is a MEANINGFUL state here ("no councils yet") rather than a
     * loading placeholder. The old rows stay until the new ones replace them.
     */
    async loadDocket(projectId: string): Promise<void> {
      const seq = ++this.docketSeq
      this.docketLoading = true
      this.docketError = null
      try {
        const res = await window.chorus.getCouncilDocket({ project_id: String(projectId) })
        if (seq !== this.docketSeq) return // superseded by a newer load
        this.docket = res.runs
      } catch (err) {
        if (seq !== this.docketSeq) return
        this.docketError =
          err instanceof Error ? err.message : 'This project’s councils could not be listed.'
      } finally {
        if (seq === this.docketSeq) this.docketLoading = false
      }
    },

    /**
     * Open a stored run: its findings and its transcript, read back together.
     *
     * ⚠ IT REFUSES WHILE A COUNCIL IS RUNNING. The main pane is one surface, and
     * swapping it to an archived run mid-deliberation would strand the live
     * transcript with no way back to it — the same reason the Esc handler already
     * refuses to close the view. The Docket rows are simply not clickable then.
     */
    async openRun(runId: string): Promise<void> {
      if (this.running) return
      this.viewingRunId = runId
      this.mode = 'run'
      // A previous run's document must not survive into this one's pane while the
      // read is in flight — it would read as this run's own findings.
      this.pastFindings = null
      this.pastFindingsPath = null
      this.pastFindingsError = null
      this.clearTranscript()
      this.clearVerdict()

      const seq = ++this.pastFindingsSeq
      this.pastFindingsLoading = true
      // Fired together, awaited together: the three halves of one finished run —
      // what it decided, how the members got there, and what it ruled. Each read
      // carries its own supersede token, so none can cancel another.
      const transcript = this.loadTranscript(runId)
      const verdict = this.loadVerdict(runId)
      try {
        const res = await window.chorus.getCouncilFindings({ run_id: String(runId) })
        if (seq !== this.pastFindingsSeq) return // superseded by a newer open
        this.pastFindings = res.text
        this.pastFindingsPath = res.path
        // ⚠ `reason` IS NOT AN ERROR AND IS NOT TREATED AS ONE. A findings file
        // moved by a branch switch is the ordinary fate of a document in someone's
        // own repository; main states it, the row shows it, and the transcript
        // beside it is still perfectly readable.
        this.pastFindingsError = res.reason
      } catch (err) {
        if (seq !== this.pastFindingsSeq) return
        this.pastFindingsError =
          err instanceof Error ? err.message : 'That run’s findings could not be read.'
      } finally {
        if (seq === this.pastFindingsSeq) this.pastFindingsLoading = false
      }
      await Promise.all([transcript, verdict])
    },

    /**
     * A stored run's Verdict strip (D106), derived in main from its own turns.
     *
     * ⚠ AN EMPTY STRIP WITH A REASON IS A RESULT, NOT A FAILURE. When the brief
     * has been moved the questions cannot be recovered, and main says so; that
     * lands in `verdict.reason` rather than in `verdictError`, which is reserved
     * for the read itself going wrong. The view renders the two differently
     * because they are different facts.
     */
    async loadVerdict(runId: string): Promise<void> {
      const seq = ++this.verdictSeq
      this.verdictLoading = true
      this.verdictError = null
      try {
        const res = await window.chorus.getCouncilVerdict({ run_id: String(runId) })
        if (seq !== this.verdictSeq) return // superseded by a newer open
        this.verdict = res
      } catch (err) {
        if (seq !== this.verdictSeq) return
        this.verdict = null
        this.verdictError =
          err instanceof Error ? err.message : 'That run’s verdict could not be read.'
      } finally {
        if (seq === this.verdictSeq) this.verdictLoading = false
      }
    },

    clearVerdict(): void {
      this.verdictSeq++
      this.verdict = null
      this.verdictError = null
      this.verdictLoading = false
    },

    /** Back to the history. The past run's fields are dropped so re-opening the
     *  same row re-reads rather than showing a document the file may no longer
     *  hold. */
    showDocket(): void {
      this.mode = 'docket'
      this.viewingRunId = null
      this.pastFindingsSeq++
      this.pastFindings = null
      this.pastFindingsPath = null
      this.pastFindingsError = null
      this.pastFindingsLoading = false
      this.clearTranscript()
      this.clearVerdict()
    },

    /** Leave the Docket for the run surface, ready to convene a new council.
     *
     *  ⚠ IT CLEARS THE PREVIOUS RUN. "New council" that lands on the last
     *  council's transcript is not a new council, and the finished run is not
     *  lost by clearing it: `run()` refreshed the Docket the moment it ended and
     *  the findings are a file on disk. */
    newRun(): void {
      if (this.running) return
      this.clearRun()
      this.mode = 'run'
      this.viewingRunId = null
    },

    /**
     * "Remove from Docket" (D109) — purges the run's DATABASE rows and leaves the
     * findings document on disk.
     *
     * ⚠ THE CONFIRM IS THE CALLER'S, NOT THIS ACTION'S. A store action that
     * blocked on a dialog would be untestable and would make the destructive path
     * depend on a UI concern. This performs; the view asks.
     *
     * Removes the row locally rather than re-reading the whole list: the response
     * is authoritative about what happened to that one run, and a full reload
     * would make a delete flicker the entire history.
     */
    async forgetRun(runId: string): Promise<void> {
      try {
        const res = await window.chorus.forgetCouncilRun({ run_id: String(runId) })
        if (!res.forgot) return // no such run — a race the user cannot see
        if (this.docket !== null) this.docket = this.docket.filter((r) => r.run_id !== runId)
        // If the removed run is the one on screen, there is nothing left to show.
        if (this.viewingRunId === runId) this.showDocket()
      } catch (err) {
        this.docketError =
          err instanceof Error ? err.message : 'That run could not be removed from the Docket.'
      }
    }
  }
})
