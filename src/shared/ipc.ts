import { z } from 'zod'
import type { LayoutNode } from './layout'
import { PROJECT_COLOR_PATTERN } from './projectColors'

/**
 * IPC contract between renderer and main.
 *
 * Every payload crossing the boundary is described here with a Zod schema.
 * Main parses all renderer -> main payloads before acting on them.
 * (D1: .parse() is called only in the main process — never in preload or
 * renderer, whose CSP forbids the eval Zod compiles parsers with.)
 */

export const IpcChannel = {
  /** invoke: attach to (or lazily start) an agent's session */
  SessionAttach: 'session:attach',
  /** invoke: create a session row + spawn its PTY (launch dialog) */
  SessionLaunch: 'session:launch',
  /** invoke: project root + recent cwds + repo context (workspace modes, 2-2)
   *  for the launch dialog */
  SessionLaunchContext: 'session:launch-context',
  /** invoke: keyboard input from the renderer -> PTY stdin */
  SessionWrite: 'session:write',
  /** invoke: terminal geometry change -> pty.resize */
  SessionResize: 'session:resize',
  /** invoke: kill a live session's PTY process tree */
  SessionKill: 'session:kill',
  /** invoke: relaunch a session under its existing row id (D16 Q4: THE one
   *  restart path — in-run and post-restart alike; attach never spawns) */
  SessionRestart: 'session:restart',
  /** invoke: delete an exited session's row (pane close; rejects live sessions) */
  SessionDelete: 'session:delete',
  /** invoke: persist a session's captured title (OSC 0/2 or first-line fallback) */
  SessionSetTitle: 'session:set-title',
  /** event (main -> renderer): PTY output chunk */
  SessionData: 'session:data',
  /** event (main -> renderer): PTY process exited */
  SessionExit: 'session:exit',
  /** event (main -> renderer): restore engine relaunched this session (badge) */
  SessionRestored: 'session:restored',
  /** event (main -> renderer): the agent's own hook bus says this session
   *  started working, or stopped and needs a human. Edge-triggered. */
  SessionActivity: 'session:activity',
  /** invoke: every live session's current activity — the renderer's cold read,
   *  since the event above only reports CHANGES. PURE READ of main memory:
   *  touches no database, no network, no credential. */
  SessionActivityList: 'session:activity-list',
  /** event (main -> renderer): the rail's per-project roll-up changed. Carries
   *  the COMPLETE list of lit projects, so absence clears a light. */
  ProjectAttention: 'project:attention',
  /** invoke: the same roll-up, read cold. Needed on its own because the event
   *  reports only changes, and a project sitting on a pre-existing failed
   *  session must be lit on the very first frame after a reload. */
  ProjectAttentionList: 'project:attention-list',
  /** event (main -> renderer): this session's context-window usage changed.
   *  Edge-triggered on the whole-number percent, exactly like SessionActivity. */
  SessionContext: 'session:context',
  /** invoke: every session with a known context reading — the cold read the
   *  event above cannot supply. PURE READ of main memory. */
  SessionContextList: 'session:context-list',
  /** event (main -> renderer): this session's memory-graph usage changed
   *  (Task 6b-1 / D168). Edge-triggered on the five counted facts — a tool
   *  call that moves none of them sends nothing.
   *
   *  ⚠ ONE CHANNEL, NOT TWO. There is deliberately NO `session:memory-list`
   *  cold read. `session:context-list` exists because a renderer reload would
   *  otherwise paint a WRONG answer (a blank ring on a measured session). A
   *  missing memory counter is not wrong, it is ABSENT: its durable answer is
   *  already on the sessions row and in the Memory section's aggregate, and
   *  D147(e)'s "every line is paid for" applies to a channel, a preload method,
   *  a handler and a store action bought for a hint. */
  SessionMemory: 'session:memory',
  /** invoke (v16): lock or unlock ONE agent. Unlocking is what the PIN guards;
   *  locking never asks for it — adding protection is not the risky direction. */
  SessionSetLocked: 'session:set-locked',
  /** invoke (v16): whether a lock PIN exists. A BOOLEAN AND NOTHING ELSE — the
   *  stored scrypt digest never crosses this bridge in any form. */
  AgentLockPinStatus: 'agent-lock:pin-status',
  /** invoke (v16): set or change the lock PIN. Write-only inbound, the
   *  credential:create posture: the plaintext travels as a parameter and no
   *  response ever carries it back. */
  AgentLockPinSet: 'agent-lock:pin-set',
  /** invoke (v16): remove the lock PIN. Deliberately needs no prior PIN, and
   *  deliberately leaves every existing lock STANDING (see storage.ts). */
  AgentLockPinClear: 'agent-lock:pin-clear',
  /** invoke: report which agent/tool CLIs are installed */
  CliDetect: 'cli:detect',
  /** invoke: static adapter declarations — capabilities + auth methods. No
   *  probing; cli:detect owns installation state. */
  AdapterList: 'adapter:list',
  /** invoke: fetch the persisted pane layout for a project */
  LayoutGet: 'layout:get',
  /** invoke: persist the current pane layout tree (ratio write-back) */
  LayoutSet: 'layout:set',
  /** invoke: read a project's persisted view state (mode + focused session) */
  ViewGet: 'view:get',
  /** invoke: persist a project's view state */
  ViewSet: 'view:set',
  /** invoke: native directory picker -> find-or-create a project (main only) */
  ProjectAdd: 'project:add',
  /** invoke: all projects with the active flag derived from settings */
  ProjectList: 'project:list',
  /** invoke: persist the active project, lazy-restore it, retitle the window */
  ProjectSelect: 'project:select',
  /** invoke: save a project's name + colour + description (settings screen) */
  ProjectUpdate: 'project:update',
  /** invoke: list a project's worktrees for the retained-worktree panel (2-3) */
  WorktreeList: 'worktree:list',
  /** invoke: remove a worktree through the D26 gates (typed token if dirty) */
  WorktreeRemove: 'worktree:remove',
  /** invoke: fresh git status --porcelain lines for one worktree (2-3) */
  WorktreeDirtyFiles: 'worktree:dirty-files',
  /** invoke: read-only {filesChanged, insertions, deletions, untracked} for a
   *  session's worktree (2-4); null for current-tree sessions */
  WorktreeDiffSummary: 'worktree:diff-summary',
  /** invoke: list provider configs (plaintext, non-secret metadata only) */
  ProviderList: 'provider:list',
  /** invoke: create a provider config */
  ProviderCreate: 'provider:create',
  /** invoke: update a provider config's non-secret fields */
  ProviderUpdate: 'provider:update',
  /** invoke: delete a provider config; refuses while profiles reference it */
  ProviderDelete: 'provider:delete',
  /** invoke: list credential profile METADATA — never key material (D33 c3) */
  CredentialList: 'credential:list',
  /** invoke: store a plaintext key; WRITE-ONLY INBOUND — returns only an id */
  CredentialCreate: 'credential:create',
  /** invoke: replace a profile's key by id; write-only inbound */
  CredentialReplace: 'credential:replace',
  /** invoke: delete a credential profile by id */
  CredentialDelete: 'credential:delete',
  /** invoke: ONE live auth probe, user-initiated only (D33 resolution d —
   *  "at your request" is load-bearing). Never at boot, launch, on a timer,
   *  or on profile creation. Returns a boolean + sanitized message. */
  CredentialTest: 'credential:test',
  /** invoke: read the cached model list for one provider + its freshness.
   *  PURE READ — makes NO network call and decrypts nothing. */
  ModelList: 'model:list',
  /** invoke: ONE live GET <base_url>/models, user-initiated only. The SECOND
   *  key-bearing call in the app — D33 resolution (d)'s carve-out, widened by
   *  exactly this call (Task 3a-4). Never at boot, launch, on a timer, on
   *  settings-open, or on profile creation. A success is NOT proof of
   *  authentication and does NOT write last_verified_at: this endpoint answers
   *  200 with no key at all. */
  ModelRefresh: 'model:refresh',
  /** invoke: D85 — add or remove ONE model id from a route's shortlist. PURE
   *  LOCAL WRITE: no network call, no decryption, no credential of any kind.
   *  It is the only channel that writes `model_shortlist`, and nothing that
   *  writes `model_catalog` can reach it. */
  ModelShortlistSet: 'model:shortlist-set',
  /** invoke: WRITE-ONLY INBOUND — the renderer's edge-triggered report of the
   *  four facts main cannot see (active project, which terminal host holds DOM
   *  focus, which view is up, whether an overlay owns the keyboard). Returns
   *  void; there is no read-back. Fire-and-forget, so main never throws at it. */
  AttentionReport: 'attention:report',
  /** invoke: attention-minutes for a project over a window — ALWAYS with its
   *  denominator. See attentionSummaryResponseSchema: there is no `minutes`
   *  field, by design. */
  AttentionSummary: 'attention:summary',
  /** invoke: "% of spend attributed" (D42) over a window — ALWAYS with the
   *  counts and dollars it was computed from (D55). Carries NO key material of
   *  any kind: not the minted key, not its hash, not the management key. */
  AttributionSummary: 'attribution:summary',
  /** invoke: the saved launch profiles, resolved and ordered by label in main.
   *  PURE READ — decrypts nothing. Carries a credential PROFILE ID and its
   *  LABEL and nothing else. */
  LaunchProfileList: 'launch-profile:list',
  /** invoke: save a launch profile (D43's (agent x route x model) triple). */
  LaunchProfileCreate: 'launch-profile:create',
  /** invoke: patch a launch profile. A RENAME IS A PURE UI EVENT with zero
   *  downstream consequences — every pointer stores the immutable id (D43). */
  LaunchProfileUpdate: 'launch-profile:update',
  /** invoke: delete a launch profile. Sessions hold a SOFT pointer, so no
   *  guard is needed here; the fail-safe predicate absorbs the dangling id. */
  LaunchProfileDelete: 'launch-profile:delete',
  /** invoke: the saved council members, resolved and ordered by label in main.
   *  PURE READ — decrypts nothing, calls nothing, spends nothing. Carries a
   *  credential PROFILE ID and its LABEL and nothing else. */
  CouncilMemberList: 'council-member:list',
  /** invoke: save a council member. A member names a ROUTE BY NAMING A
   *  CREDENTIAL (D48/D56): there is no base URL and no provider id on this
   *  channel, because there is none on the row. */
  CouncilMemberCreate: 'council-member:create',
  /** invoke: patch a council member. A RENAME IS A PURE UI EVENT with zero
   *  downstream consequences — every pointer stores the immutable id (D43). */
  CouncilMemberUpdate: 'council-member:update',
  /** invoke: delete a council member. Runs and messages hold SOFT pointers
   *  (D62), so no guard is needed here — a transcript stays true once the
   *  member that spoke it is gone. */
  CouncilMemberDelete: 'council-member:delete',
  /** invoke: relaunch a session that was healed to `exited` because it held a
   *  credential (D53).
   *
   *  ⚠ THE ONLY LAUNCH-CREDENTIAL DECRYPT ADDED BY TASK 3a-5, and it happens
   *  because a HUMAN CLICKED SOMETHING. Restore stays decision (b): there is no
   *  unattended boot-time resolution of a launch credential, and this channel
   *  is not reachable from any boot path, timer, restore path or retry. That
   *  distance is the entire security argument (D49/F26). */
  SessionRelaunch: 'session:relaunch',
  /** invoke: open the native picker for a brief `.md`. Main-side
   *  `dialog.showOpenDialog` (the `project:add` precedent), cancel returning a
   *  structured no-op rather than an error. ⚠ A CONVENIENCE, NOT A BOUNDARY —
   *  `council:start` re-validates whatever comes back. */
  CouncilPickBrief: 'council:pick-brief',
  /**
   * invoke: run a council deliberation over a brief and return its findings.
   *
   * ⚠ IT CARRIES THE BRIEF'S **PATH**, AND MAIN IS WHAT OPENS IT (3b-4).
   * `brief_text` was REMOVED rather than deprecated (D68(4)): two sources of
   * truth for what the council deliberated on, with the renderer controlling
   * the authoritative one, would have made the path validation decorative.
   * The findings `.md` path is DERIVED from it in main and never supplied.
   *
   * ⚠ THE FOURTH KEY-BEARING CALL PATH, admitted on D58's terms exactly as
   * `api:probe` was: user-initiated only — no boot hook, no timer, no restore
   * path, no retry — reusing `resolveCredential` rather than forking it, so the
   * management refusal still sits BEFORE decryption. D60 remains the invariant
   * and not the count.
   */
  CouncilStart: 'council:start',
  /** invoke: cancel a running deliberation. The run's minted key is still read
   *  back and revoked — an abandoned run leaving a live funded key is the
   *  failure mode 3a-3's ledger exists for. */
  CouncilCancel: 'council:cancel',
  /**
   * event (main -> renderer): a run now EXISTS and can be cancelled. Fired once,
   * the instant the ledger row is written and the run enters main's `live` map.
   *
   * ⚠ IT EXISTS BECAUSE CANCEL WAS UNREACHABLE FOR THE FIRST MINUTES OF EVERY
   * RUN, and that is not a UI polish problem. `council:start` is ONE invoke that
   * does not resolve until the whole deliberation is over, so the run id on its
   * response arrives ~15 minutes too late to cancel anything. Until this event
   * the renderer's ONLY source for the id was the first `council:progress`
   * delta — which does not arrive until a member emits its first token, and a
   * reasoning model's first token can legitimately take minutes. In that gap the
   * run was live, spending, and abortable in main, while the button that aborts
   * it was disabled for want of a name to give it.
   *
   * ⚠ IT IS AN EVENT AND NOT A FIELD ON THE START RESPONSE for the reason above:
   * the response is the thing that arrives too late. It is a channel of its own
   * rather than a zero-length `council:progress` because that event's `delta` is
   * contractually "scrubbed text from one member's stream" and no member has
   * spoken yet — a run's existence is a different fact at a different cadence
   * (once, not hundreds of times), which is `council:summary`'s argument applied
   * to the other end of the run.
   *
   * ⚠ AND IT CARRIES NOTHING BUT THE ID. No brief path, no roster, no cost: the
   * renderer already knows what it asked for, and the one thing it cannot know
   * is what main called it.
   */
  CouncilOpened: 'council:opened',
  /** event (main -> renderer): one scrubbed delta from one member's stream.
   *  ⚠ ITS TEXT COMES FROM `SessionOutput`'s `onText`, never from the raw
   *  stream — see `councilService.driveMember`. */
  CouncilProgress: 'council:progress',
  /**
   * event (main -> renderer): the per-question at-a-glance vector, broadcast
   * ONCE when the positions round closes.
   *
   * ⚠ WHY IT IS NOT A FIELD ON `council:progress`. That event fires per text
   * DELTA — hundreds of times a run — and its `delta` is contractually "scrubbed
   * text from one member's stream". A summary is neither that thing nor that
   * cadence: attaching it there would either repeat the whole vector on every
   * delta or make the field meaningful on one arbitrary event and empty on the
   * rest. Different fact, different rate, own channel.
   *
   * ⚠ AND IT CARRIES NO MODEL TEXT. The payload is verdict TOKENS from a closed
   * enum, member LABELS, and the questions the brief itself enumerated — the
   * brief being a file the user chose and main read. No byte of a model's prose
   * crosses on this channel, so it needs no scrub seam and must never be given
   * one to justify carrying any.
   */
  CouncilSummary: 'council:summary',
  /**
   * invoke: read a stored run's transcript back. **D97, Task 3e-4 — and THE ONLY
   * CHANNEL PHASE 3e ADDS**, declared in `Phase-3e-Overview.md` before the task
   * ran (the D74/D80 discipline: an exception is stated up front or it is not an
   * exception, it is a leak). 57 → 58, and every other 3e task holds at 58.
   *
   * ⚠ READ-ONLY, AND THERE IS NO PARAMETER HERE THAT COULD BECOME A WRITE. It
   * takes a run id and returns rows. `deleteCouncilRun` exists in storage and is
   * deliberately NOT reachable from the renderer: a delete path is a different
   * decision with a different blast radius, and D97 did not make it.
   *
   * Why it exists: `council_messages` has been written on every run since 3b-3
   * and read by nothing. A run costs ~$0.83 and ~14 minutes, and until now the
   * only view of its deliberation was the live one — gone on the next run, gone
   * on restart. This is the door to data that was already being paid for.
   */
  CouncilTranscript: 'council:transcript',
  /**
   * ══ The Docket (D112–D115): THREE channels, declared as an exception ══
   *
   * The D74/D80 discipline is that an exception is stated up front or it is not
   * an exception, it is a leak. **60 → 63**, and the Docket adds no others.
   *
   * ⚠ AND THE RUNNING TALLY ABOVE WAS STALE WHEN THIS WAS WRITTEN. The
   * `council:transcript` comment records "57 → 58, and every other 3e task holds
   * at 58", which was true for 3e-4 — but Task 3c-2's four `window:*` channels
   * landed afterwards and nobody moved the number. The count was 60, not 58.
   * Corrected here rather than quietly inherited, because a tally nobody
   * maintains is worse than no tally: it reads as a check that has been passing.
   *
   * invoke: one project's council history, newest first. The Docket's whole read.
   *
   * ⚠ IT TAKES A PROJECT ID AND NOTHING ELSE — no case id, no path, no filter.
   * D105's `case_id` does not exist yet (D112 ships the Docket ahead of Cases),
   * and CR-3f.1's action A1 forbids a folder path in a join predicate, so
   * `project_id` is the only key there is. Runs recorded before this feature
   * shipped therefore appear, which is the intent: they are the only history the
   * app has.
   */
  CouncilDocket: 'council:docket',
  /**
   * invoke: read a stored run's findings document back off disk.
   *
   * ⚠ THE DELIBERATE SIBLING OF `council:transcript` — same noun form, same job,
   * same read-only discipline. Between them they reopen a finished run
   * completely: that channel returns what the members SAID, this one returns what
   * the council DECIDED. Splitting them is not ceremony; a findings document is
   * one bounded file and a transcript is a capped scan of many rows, and folding
   * both into the Docket list would drag every run's full prose across the bridge
   * to render a list of dates.
   *
   * ⚠ A MISSING FILE IS A RESPONSE, NOT A THROW. The document lives beside the
   * user's own brief in the user's own repository; it can be moved, renamed by a
   * branch switch, or never have been written at all. Each of those is a fact the
   * row states — with the path it looked in — rather than an error that blanks
   * the pane.
   */
  CouncilFindings: 'council:findings',
  /**
   * invoke: "Remove from Docket" (D109) — purge one run's rows.
   *
   * ⚠ THE FIRST COUNCIL WRITE THE RENDERER HAS EVER BEEN GIVEN, and the reason
   * the restraint at `council:transcript` above no longer applies. That comment
   * says `deleteCouncilRun` is "deliberately NOT reachable from the renderer: a
   * delete path is a different decision with a different blast radius, and D97
   * did not make it." D109 makes it. The storage transaction it calls is the one
   * D99 kept alive uncalled for exactly this moment.
   *
   * ⚠ IT DELETES FROM THE DATABASE AND FROM NOWHERE ELSE. No filesystem path is
   * reachable from this channel's payload — it takes a run id — and the handler
   * touches no file. D109's second action, "Delete case…", would remove a folder
   * and does NOT exist here: there are no case folders to remove until D105.
   */
  CouncilForgetRun: 'council:forget-run',
  /**
   * invoke: one stored run's Verdict strip — D106's two facts, per question.
   *
   * ⚠ 63 → 64, THE FOURTH AND LAST OF THE DOCKET'S CHANNELS, declared before the
   * code per D74/D80. The third sibling of `council:transcript` and
   * `council:findings`, and the family now covers a finished run completely:
   * what the members SAID, what the council DECIDED, and what it RULED.
   *
   * ⚠ IT IS A SEPARATE CALL FROM `council:findings` RATHER THAN A FIELD ON IT,
   * because the strip is derived and the findings are read. One is a parse over
   * `council_messages`; the other is a file off disk that may be gone. Folding
   * them together would make a missing findings document able to take the
   * verdict down with it, when the two have nothing to do with each other.
   *
   * ⚠ AND IT IS DERIVED ON EVERY READ, ON PURPOSE. No column stores this — the
   * arbiter's ruling has been sitting in its stored arbitration turn all along.
   * That is what kept the Verdict strip out of a migration, leaving v14 free for
   * Phase 6's `project_memory` (Task-6-3.md:53) rather than taking it out from
   * under a phase that has already claimed it.
   */
  CouncilVerdict: 'council:verdict',
  /**
   * Task 3c-2 / D74: the four window-control channels, and THE ONLY IPC
   * ADDITION IN ALL OF PHASE 3c. They exist because `frame: false` removed the
   * native frame: with no OS chrome, the renderer's own buttons have no way to
   * minimize, maximize or close except by asking main. The exception is
   * bounded and was recorded in `Phase-3c-Overview.md` BEFORE the task ran —
   * no other 3c task may add a channel, and 3c-2 may add none beyond these.
   */
  /** invoke: minimize the main window. Renderer -> main, no payload, no result. */
  WindowMinimize: 'window:minimize',
  /** invoke: maximize if restored, restore if maximized. Returns the NEW state
   *  so the caller can settle its icon without waiting for the event below. */
  WindowToggleMaximize: 'window:toggle-maximize',
  /** invoke: close the main window (the normal quit path, not a force kill —
   *  `close()` runs 'before-quit' and the session teardown behind it). */
  WindowClose: 'window:close',
  /** event (main -> renderer): the maximized state changed.
   *
   *  ⚠ REQUIRED, NOT A CONVENIENCE. The state changes by routes the renderer
   *  never sees — double-clicking the drag region, Win+↑ / Win+↓, or the OS
   *  snapping the window. Wiring only the button's own click leaves the
   *  restore icon silently desynced from the window it describes, which is the
   *  classic defect here. */
  WindowMaximizedChanged: 'window:maximized-changed',
  /**
   * ══ Project lifecycle (D125): FOUR channels, declared as an exception ══
   *
   * **64 → 68**, and Phase 3h adds no others: Task 1 held at 64, these four land
   * together here in Task 2, and Task 3 holds at 68. `ipcMain.handle(` in
   * `src/main/ipc.ts` goes **58 → 62**; in `src/main/index.ts` it stays **0**.
   * `sqliteTable(` stays **16** (no new table) and `MIGRATIONS.length` stays
   * **15** (v15 was Task 1's, and it is the phase's only migration).
   *
   * Declared before the code, the D74/D80 discipline the Docket's block above
   * follows — and for the reason that block gives: a tally nobody maintains is
   * worse than no tally, because it reads as a check that has been passing.
   *
   * Why each of the four cannot ride an existing channel is stated on it.
   */
  /**
   * invoke: hide, archive, or restore a project to active.
   *
   * ⚠ IT CANNOT RIDE `project:update`, AND THIS IS NOT A TASTE JUDGEMENT.
   * `project:update` is a TOTAL OVERWRITE SENT BY A FORM — name, colour and
   * description together, every time the settings screen saves. A status change
   * KILLS PTY PROCESSES. Folding a process-killing side effect into the
   * identity-save path would put every future edit of that form one typo away
   * from stopping the user's agents, and the blast radius of the two writes has
   * nothing in common.
   */
  ProjectSetStatus: 'project:set-status',
  /**
   * invoke: state the rail's order.
   *
   * ⚠ IT TAKES EVERY PROJECT ID IN THE NEW ORDER, NOT A MOVED PAIR. A
   * `{from, to}` payload would make main reconstruct an order it cannot see,
   * and a renderer that dropped one row mid-drag would write a silently
   * different list. Main validates `ordered_ids` is a FULL PERMUTATION of
   * `listProjects()`'s ACTUAL ids and refuses otherwise — against the real ids,
   * never a uuid predicate, because a well-formed uuid that is not a project is
   * still not a permutation.
   */
  ProjectReorder: 'project:reorder',
  /**
   * invoke: purge one project and everything Chorus wrote about it.
   *
   * ⚠ ITS OWN CHANNEL BECAUSE IT IS THE ONLY IRREVERSIBLE ONE. A destructive
   * verb sharing a handler with a reversible one is how the wrong branch gets
   * taken — and the payload carries the typed project name (D123), which is a
   * confirmation that cannot survive being folded into a channel that also does
   * something safe.
   *
   * ⚠ IT DELETES FROM THE DATABASE AND FROM NOWHERE ELSE (D121). No filesystem
   * path is reachable from this payload, the handler touches no file, and the
   * user's project folder and worktree directories are left exactly as they are.
   */
  ProjectDelete: 'project:delete',
  /**
   * invoke: how much there is to lose — the counts the delete confirmation
   * states BEFORE the user commits to it (D123/D109).
   *
   * ⚠ IT CANNOT RIDE `project:list`. The transcript-turn count scans
   * `council_messages` through `council_runs`, and `project:list` runs at boot
   * and on every `store.load()` — putting that scan on the app's most-travelled
   * read to serve a dialog that opens rarely.
   *
   * ⚠ NOR MAY IT BE A `dry_run` FLAG ON `project:delete`. A dropped boolean on a
   * destructive channel deletes data, and nothing about the two payloads'
   * shapes would announce the mistake.
   */
  ProjectImpact: 'project:impact',
  /* ------------------------------------------------------------------ *
   * Phase 6 / Task 6-3: the FIVE memory channels. Not six — an earlier
   * draft of the task doc said six and the spec's own table lists five.
   *
   * ⚠ `memory:seed` AND `memory:validate` ARE TASK 6-4'S AND ARE ABSENT,
   * NOT STUBBED. A stub channel is a channel this count has to explain.
   * ------------------------------------------------------------------ */
  /**
   * invoke: what this project's memory is configured as — mode, host, port.
   *
   * ⚠ THE PAYLOAD CARRIES NO PASSWORD FIELD AND NO BOLT URI. Not "no password
   * today": the key-set assertion in `ipc.test.ts` fails if either arrives, and
   * that assertion is the thing that catches a password field being added in
   * 2027. The URI is withheld even though `memoryConfigCore` refuses to store
   * one carrying credentials — a normalised string is still a string, and host
   * and port are what the UI actually renders.
   */
  MemoryGet: 'memory:get',
  /**
   * invoke: point a project at a Neo4j.
   *
   * Takes a credential ID if it ever takes a credential at all (D33 clause 2) —
   * never a key, and in this phase never a credential: D128(a) ships local mode
   * only. The full mode vocabulary is admitted here and REFUSED IN THE SERVICE
   * with an authored reason, because a Zod parse failure is a stack trace where
   * a sentence belongs.
   */
  MemoryConfigure: 'memory:configure',
  /**
   * invoke: forget where this project's memory is.
   *
   * ⚠ IT DELETES THE CONFIG ROW AND NOTHING ELSE. No graph data is destroyed —
   * nothing behind this channel speaks bolt — and the UI must say which, or a
   * user will read "disable" as "delete my knowledge graph".
   */
  MemoryDisable: 'memory:disable',
  /**
   * invoke: the status chip's read.
   *
   * ⚠ PURE READ. DECRYPTS NOTHING AND OPENS NO BOLT SESSION — the `model:list`
   * vs `model:refresh` split, and the single most dangerous line in Task 6-3. A
   * chip polling a channel that decrypted would be an unattended-decrypt loop on
   * a timer, which D33/D53/D58 forbid outright. A structural test asserts the
   * absence with a driver that throws if touched.
   */
  MemoryStatus: 'memory:status',
  /**
   * invoke: ONE live connect, USER-INITIATED ONLY — no boot hook, no timer, no
   * restore path, no retry (D58's terms, verbatim).
   *
   * ⚠ IT ISSUES A REAL QUERY (`RETURN 1`) AND CHECKS THE ANSWER. A handshake is
   * a false green, measured rather than feared: the 6-1 D4 pass found the MCP
   * server's `initialize` and `tools/list` succeeding on EVERY failing row of
   * its connect matrix, with the error surfacing only at `tools/call`. The
   * analogue here is `driver.verifyConnectivity()`, and it is not evidence.
   */
  MemoryTest: 'memory:test',
  /**
   * invoke: apply the graph's pending schema migrations. Task 6-4.
   *
   * ⚠ IT WRITES, SO IT IS USER-INITIATED AND NEVER A BOOT HOOK (D58). And it
   * RE-READS THE GRAPH'S OWN VERSION FIRST: `project_memory.schema_version` is a
   * CACHE, not the authority, because the same graph can be restored from a dump
   * or reached by a second Chorus install. When the two disagree the response
   * says so rather than papering over it — that disagreement is a real
   * diagnostic.
   */
  MemorySeed: 'memory:seed',
  /**
   * invoke: how much of this project's memory cites where it came from.
   *
   * ⚠ ALWAYS THE PAIR AND ITS DENOMINATOR — *"43 of 512"*, never a bare count
   * and never a lone percentage (D55). The affected list carries its own total
   * when truncated, which is the same rule one level down.
   *
   * ⚠ AND IT MEASURES SOMETHING CHORUS CANNOT ENFORCE. Agents write through MCP
   * with a Cypher tool; nothing stops one creating a memory with no source. The
   * honest sentence travels with the number.
   */
  MemoryValidate: 'memory:validate',
  /**
   * invoke: walk this project's tracked files and recent commits into the
   * graph's STRUCTURAL namespace — `:File`, `:Directory`, `:Commit` and two
   * edge types (Task 6a-2, D149).
   *
   * ⚠ USER-INITIATED ONLY. Never a boot hook, never a watcher, never a timer:
   * a re-index that fired on every save would fight the agents for the same
   * database (D58).
   *
   * ⚠ IT RECORDS WHERE CODE LIVES, NOT WHAT IT DOES. No symbols, no call
   * graph, no source text (D149) — the UI states that limit at the control
   * rather than in a tooltip, because a user expecting comprehension will
   * conclude the feature is broken.
   */
  MemoryIndex: 'memory:index',
  /* ─────────────────── Task 6a-4: the provisioner ──────────────────────
   *
   * ⚠ FIVE CHANNELS, 92 → 97, AND THE NUMBER WAS COMPUTED RATHER THAN COPIED
   * (G6). `Task-6a-4.md` pins "87 → 92" because it was authored at `47f633c`,
   * before the day-report feature added five of its own; the tally at
   * `b2b73df` is 92 and `ipc.test.ts` asserts it in two places.
   *
   * ⚠ WHY FIVE RATHER THAN ONE `memory:container` WITH AN ACTION FIELD. An
   * action string would put "start", "stop" and "remove" behind one Zod schema
   * and one handler, so the typed-confirmation gate that only `remove` needs
   * would have to be conditional — a guard inside a branch of a shared handler
   * is precisely the shape that gets walked past. Separate channels keep the
   * dangerous one dangerous-looking.
   *
   * ⚠ AND NONE OF THEM MAY COLOUR THE STATUS CHIP. A running container is not a
   * connection; `Connected` is still earned by `memory:test`'s observed read
   * (D126). */

  /**
   * invoke: create (or adopt) this project's Neo4j container and point the
   * project at it.
   *
   * ⚠ USER-INITIATED ONLY, like every other memory channel (D58). There is no
   * boot reconciliation and no retry: a stale `container_id` is healed by the
   * status read, when a person opens the screen.
   *
   * ⚠ IT PUBLISHES ON LOOPBACK ONLY. The container binds
   * `127.0.0.1:<port>:7687` — the security property of this whole task, since
   * `NEO4J_AUTH=none` on `0.0.0.0` would publish an unauthenticated database to
   * the local network (D93).
   */
  MemoryProvision: 'memory:provision',
  /** invoke: what docker says about this project's container, right now.
   *  ⚠ THE READ THAT HEALS A STALE ROW — a container removed behind Chorus's
   *  back reports `exists: false` rather than echoing the stored row. */
  MemoryContainerStatus: 'memory:container-status',
  MemoryContainerStart: 'memory:container-start',
  MemoryContainerStop: 'memory:container-stop',
  /**
   * invoke: remove the container process.
   *
   * ⚠ THE DATA VOLUME IS NEVER TOUCHED (F49/D151). Chorus has no code path that
   * can destroy a graph, because durability is gated on an export/restore path
   * that does not exist yet. Re-provisioning re-attaches the same volume.
   *
   * ⚠ TYPED-CONFIRMATION GATED IN MAIN. The caller must send the container's
   * exact name — the `project:delete` (D123) and `worktree:remove` (D26 clause
   * 7) precedent, because a renderer-only guard is walked past by the command
   * palette, by a second window, and by any future caller.
   */
  MemoryContainerRemove: 'memory:container-remove',

  /**
   * invoke: collect (or re-collect) one local calendar day of work across
   * EVERY project, and store it. D153.
   *
   * ⚠ ITS SOURCE IS GIT, NOT THE HOOK SPINE, AND THAT IS THE POINT. The hook
   * bus is Claude-only (D129) and codex cannot even be discovered (F64), so no
   * telemetry-derived answer can cover a mixed fleet. Git observes ARTIFACTS —
   * commits, files, new symbols — which read identically whichever agent, or
   * which human, produced them. The response deliberately carries NO per-agent
   * attribution: it is not withheld, it genuinely is not in the source.
   *
   * ⚠ SLOW BY THE STANDARDS OF THIS BRIDGE — it spawns several git processes
   * per repository and may call a model. Callers must treat it as a job, not a
   * getter.
   */
  DayReportGenerate: 'day:generate',
  /** invoke: read a previously-stored day. PURE READ — spawns nothing, calls
   *  no model, costs nothing. Null when that day was never captured. */
  DayReportRead: 'day:read',
  /** invoke: the dates that have a stored report, newest first. */
  DayReportList: 'day:list',
  /** invoke: which credential profile + model write the day report's prose,
   *  or null when none is chosen. Carries NO key material — a profile ID and a
   *  model ID, both non-secret. */
  DayReportSummarizerGet: 'day:summarizer-get',
  /** invoke: choose the summarizer, or clear it with null. */
  DayReportSummarizerSet: 'day:summarizer-set',

  /**
   * ══ Voice capture (Phase 5, Task 5-1): FOUR channels, declared up front ══
   *
   * The D74/D80 discipline is that an exception is stated before the task runs
   * or it is not an exception, it is a leak. Task 5-1 adds exactly these four
   * and no others; transcription (5-2), the hotkey and the overlay (5-3) and
   * refinement (5-4) add their own and are not smuggled in here.
   *
   * ⚠ AND THE COUNT BELOW IS NOT QUOTED FROM THIS TASK'S PLANNING DOCUMENTS. It
   * was re-counted from the merged tree, per G6 — the one procedure that has
   * ever produced the right number for `IpcChannel` (see `ipc.test.ts`, where
   * three branches once landed at 78, 84 and 80 against a merged truth of 86).
   *
   * invoke: open the microphone's main-side sink and mint a capture id. Refuses
   * while a capture is already live rather than replacing it — VoicePlan §7.2
   * requires overlapping activations to be structurally impossible, and a
   * refusal at the single owner is what makes it structural rather than a
   * guard the next caller can forget.
   */
  VoiceCaptureStart: 'voice:capture-start',
  /**
   * ⚠ SEND-SHAPED, NOT INVOKE-SHAPED, AND IT MAKES THE CHANNEL TALLY
   * THREE-CATEGORY FOR THE FIRST TIME IN THIS APP.
   *
   * Not `invoke`: at ~16 frames/second (16000 Hz ÷ 1024 samples) every frame
   * would allocate a promise and await a main-process round trip, for a reply
   * nobody reads. Audio frames are fire-and-forget bulk — `ipcRenderer.send` on
   * the renderer side, `ipcMain.on` in main.
   *
   * Before this channel the tally closed exactly:
   *     97 channels = 87 ipcMain.handle( + 10 main->renderer event channels
   * This channel is renderer->main and is NOT handled, so from now on:
   *     total = handle() + main->renderer events + renderer->main sends
   * `ipc.test.ts` asserts only the total, so nothing breaks today — which is
   * exactly why it is written here rather than left for whoever next tries to
   * reconcile 87 + 10 and finds it no longer adds up.
   *
   * ⚠ A MALFORMED FRAME ON THIS CHANNEL IS A COUNTED DROP, NEVER A THROW. There
   * is no reply for an error to travel on, and a throw inside `ipcMain.on`
   * becomes a process-level warning raised by ordinary speech. Main `safeParse`s
   * and counts (see `voiceFrameSchema` below and `voice.ts`).
   */
  VoiceCaptureFrame: 'voice:capture-frame',
  /** invoke: close the sink, drain what is queued, release the capture id.
   *  Idempotent — stopping when nothing is live is a state, not an error. */
  VoiceCaptureStop: 'voice:capture-stop',
  /**
   * event (main -> renderer): the capture's state, its frame accounting and
   * whether it is still keeping up.
   *
   * ⚠ IT CARRIES NO AUDIO AND NO TRANSCRIPT, and it must never be given any.
   * Counts, a state token from a closed enum, and a drop reason from a closed
   * enum — the phase's purity contract forbids audio or transcript content
   * anywhere it could be logged or persisted, and an event the renderer stores
   * is exactly such a place.
   */
  VoiceState: 'voice:state',

  /**
   * ══ Voice activation and targeting (Task 5-3): THREE channels ══
   *
   * Declared up front, the D74/D80 discipline. 101 -> 104, re-counted from the
   * merged tree with the AST rather than deltaed (G6).
   *
   * invoke: the renderer reports which pane currently holds DOM focus, so main
   * knows what a capture started by the GLOBAL hotkey should aim at.
   *
   * ⚠ IT IS A PUSH FROM THE RENDERER BECAUSE ONLY THE RENDERER CAN ANSWER, AND
   * IT IS A DEDICATED CHANNEL RATHER THAN A READ OF `focusedSessionId`.
   * `attention/reporter.ts:11-22` records three separately verified reasons that
   * store is the wrong instrument, and all three bite dictation: it SURVIVES
   * blur/minimize/exit (persisted state, where this needs an instantaneous
   * fact); GRID MODE NEVER UPDATES IT (LayoutRenderer binds no `@focus`, so the
   * ring would point at whichever pane was last focused in the FILMSTRIP —
   * "confidently wrong and therefore worse than missing"); and it is never
   * FK-checked (F4) and legitimately names a deleted session.
   */
  VoiceTargetSet: 'voice:target-set',
  /**
   * event (main -> renderer): which pane wears the dictation ring.
   *
   * ⚠ THE RING IS SHOWN BEFORE THE USER SPEAKS (`Plan.md` §7, glanceability) and
   * moves as Tab cycles it. It is pushed from MAIN because main owns the target
   * for the capture's lifetime — the renderer must render what main will
   * actually write to, not its own idea of focus, or the ring and the write
   * would disagree exactly when they matter.
   */
  VoiceTarget: 'voice:target',
  /**
   * invoke: is push-to-talk available on this machine?
   *
   * ⚠ IT EXISTS BECAUSE THE ANSWER CAN BE NO AND THE FEATURE STILL WORKS.
   * `uiohook` failing to load is a real failure mode (VoicePlan §10); when it
   * does, PTT is unavailable and CLICK-TO-TALK still dictates end to end.
   * Click-to-talk is the accessibility path (VoicePlan §7.2 — a sustained hold
   * is exactly the interaction a motor-impaired user cannot perform), so it is a
   * PEER of the hotkey, never downstream of it.
   */
  VoiceHotkeyStatus: 'voice:hotkey-status',

  /**
   * ══ Voice settings (Task 5-4): THREE channels ══
   *
   * Declared up front, the D74/D80 discipline. 104 -> 107, re-counted from the
   * merged tree with the AST rather than deltaed (G6).
   *
   * ⚠ A DEDICATED CHANNEL GROUP — THE `agent-lock:*` SHAPE — NOT A GENERIC
   * KEY/VALUE BAG (VoicePlan §8.4). A `settings:get(key)` channel would let any
   * renderer code read any setting main ever stores, including ones that were
   * deliberately kept main-side (the agent-lock PIN hash is the standing
   * example: the renderer learns ONE bit about it). Each settings surface
   * therefore gets its own typed get/set pair, and the response schema is the
   * only thing that can cross.
   *
   * invoke: the whole voice settings object, or the defaults when nothing has
   * ever been saved.
   */
  VoiceSettingsGet: 'voice:settings-get',
  /**
   * invoke: replace the voice settings. Main validates the chord with
   * `parseChord` and REFUSES an unparseable one rather than coercing it to the
   * default (hotkeyCore's rule) — the response says so and carries what is
   * actually stored, which the renderer renders instead of its own draft.
   */
  VoiceSettingsSet: 'voice:settings-set',
  /**
   * invoke: which whisper models are on disk, with their sizes. Read-only, so
   * the settings screen can say "installed" / "downloads on first use (465 MB)"
   * from a fact rather than a guess (D159 — show the sizes).
   */
  VoiceModelStatus: 'voice:model-status'
} as const

/**
 * Task 3a-3: the `provider_configs.auth_mode` value marking an ACCOUNT-LEVEL
 * credential rather than a way to launch an agent.
 *
 * ⚠ THIS IS DELIBERATELY NOT AN `AuthMethodDefinition.type`, and that is the
 * whole point. Widening the adapter auth union would make "Management key"
 * appear in the launch picker as a way to run codex — semantically false, and
 * it would push the highest-privilege credential in the app toward the exact
 * launch path this task exists to keep it away from. Instead the value lives
 * here, on the wire contract, where `auth_mode` already is an unconstrained
 * string on both sides (no migration, no wire-schema change), and:
 *
 *  - `LaunchDialog.vue` already filters `provider.auth_mode === 'api_key'`, so
 *    a management row is invisible to the launch picker FOR FREE;
 *  - `resolveCredential` in main refuses it outright, because main never trusts
 *    the renderer and a filter in the dialog is not a guarantee.
 */
export const MANAGEMENT_AUTH_MODE = 'management'

/**
 * D84 (Task 3d-1): the `provider_configs.adapter_type` value marking a route
 * that NO LOCAL HARNESS RUNS.
 *
 * ⚠ `adapter_type` NAMES THE HARNESS, NOT THE SERVICE. That is the ruling. It
 * was carrying two jobs — "which CLI will run this" (the launch path's
 * ownership check, correct and load-bearing) and "which service is being
 * talked to" (which has nothing to do with a PTY agent) — and every provider
 * had to answer the first even when only the second was true. A council member
 * on OpenRouter had to claim `codex` or `claude`, which is a false statement
 * the launch dialog then acts on.
 *
 * `'none'` is the honest answer to "which harness": there isn't one. It is a
 * PROVIDER-TYPE value, exactly as `MANAGEMENT_AUTH_MODE` is an AUTH-MODE
 * value, and for the same reason it lives here rather than in `agentKindSchema`
 * or `staticRegistry`: those two must widen TOGETHER or F25 returns (the
 * `layout:get` filter treats `getAdapter(row.agent)` membership as proof of
 * `agentKindSchema` validity), and the registry freeze is D34 Q5 / D63 Q1,
 * owned by Phase 3d proper. Neither widens here.
 *
 * What holds it in place, none of it new:
 *  - `LaunchDialog.vue`'s `eligibleProfiles` filters `adapter_type === agent`,
 *    so a harness-less provider is invisible to the launch picker FOR FREE;
 *  - `validateProfileShape` / `resolveLaunchProfile` refuse a launch profile
 *    whose route disagrees with its agent, unchanged;
 *  - `resolveCredential`'s ownership check (Blocker B) is UNTOUCHED for every
 *    caller that names a harness.
 *
 * ⚠ `adapter_type` stays `TEXT NOT NULL` / `z.string().min(1).max(60)`. This is
 * a value in an already-open vocabulary, not a schema change and not a
 * migration.
 */
export const NO_HARNESS_ADAPTER_TYPE = 'none'

export const sessionStatusSchema = z.enum(['running', 'exited'])
export type SessionStatus = z.infer<typeof sessionStatusSchema>

/**
 * Agent CLIs Chorus can run. N concurrent sessions per kind (Task 1-4).
 *
 * ⚠ D86 (Task 3d-3) LIFTED D34 Q5's FREEZE AND ADDED `'kimi'`. Two entries
 * became three, and the lift is a numbered decision rather than an edit
 * because of what this enum is coupled to:
 *
 * **THIS AND `staticRegistry` WIDEN TOGETHER OR F25 RETURNS.** `layout:get`'s
 * projection filter treats `getAdapter(row.agent)` membership as PROOF of
 * `agentKindSchema` validity — true only while the registry is keyed by this
 * enum. An id admitted to one and not the other passes the filter and then
 * fails the outbound parse, taking the WHOLE aggregate down over one row.
 * `registry.ts` is typed `Readonly<Record<AgentKind, AgentAdapter>>`, so the
 * compiler enforces exact coverage in both directions: adding a kind here
 * without an adapter is a BUILD failure, and vice versa. That property is
 * D34(b)'s and it is what makes this lift safe to perform at all.
 *
 * ⚠ AND `NO_HARNESS_ADAPTER_TYPE` IS STILL NOT IN HERE (D84). A provider type
 * is not an agent kind; 'none' names the absence of a harness and must never
 * become a launchable id.
 *
 * ⚠ D90 (2026-07-28) ADDED `'opencode'` — THREE ENTRIES BECAME FOUR, under the
 * same widen-together rule D86 performed the last lift by. `opencode` is the
 * harness Matthew chose for the OpenRouter launch card: it is a real PTY agent
 * CLI (`opencode 1.18.8`, npm `opencode-ai`), so it belongs HERE and in
 * `staticRegistry`, unlike `NO_HARNESS_ADAPTER_TYPE` above. See `opencode.ts`
 * for the D4 evidence that a key can reach it through the ENVIRONMENT — which
 * is what makes it adoptable at all under the project's secret rules.
 *
 * ⚠ D165 (2026-08-18) ADDED `'grok'` — FOUR ENTRIES BECAME FIVE, same rule.
 * The xAI Grok CLI (`grok 1.0.5`, a real .exe under `~/.grok/bin`), added at
 * Matthew's request as a launch card beside Claude, Codex and OpenCode. See
 * `grok.ts` for the D4 evidence: `XAI_API_KEY` reaches it through the
 * environment, `--reasoning-effort` / `--permission-mode` / `-m` are all
 * top-level TUI flags, and `--session-id` / `--resume` give it claude's
 * assigned-resume shape.
 */
export const agentKindSchema = z.enum(['claude', 'codex', 'grok', 'kimi', 'opencode'])
export type AgentKind = z.infer<typeof agentKindSchema>

/**
 * Task 3a-4: the app-level effort vocabulary — PLAN §4's Fast / Balanced /
 * Deep / Max slider. ONE vocabulary, shared by the wire, both adapters, and
 * (later) 3a-5's `launch_profiles.effort`.
 *
 * Declared this early in the file because both `launchRequestSchema` and
 * `effortOptionSchema` consume it, and a second copy would be a second home
 * for the same fact.
 *
 * Four normalized levels cannot cover every vendor's ladder, and stretching
 * them to try would make "Deep" mean different distances on different
 * adapters. The raw `extra_args` override is what reaches whatever a level is
 * not mapped to (PLAN §4), which is why it is rank 1 of the effort precedence
 * order.
 *
 * ⚠ THE LEVELS ARE POSITIONS, NOT VENDOR VALUES, AND THE MAPPING IS THE
 * ADAPTER'S ALONE. This enum deliberately says nothing about which CLI value a
 * position resolves to — `claude.ts` moved its whole ladder up one rung
 * (2026-08-14, Matthew: he never picks the bottom rung, so spending a position
 * on it wasted a quarter of the control) WITHOUT this file changing, which is
 * the property the split exists to give.
 */
export const effortLevelSchema = z.enum(['fast', 'balanced', 'deep', 'max'])
export type EffortLevel = z.infer<typeof effortLevelSchema>

/**
 * The app-level PERMISSION vocabulary — the sibling of `effortLevelSchema`
 * above, and built to the same rules for the same reasons (2026-08-14).
 *
 * PLAN principle 009 is "CLI-NATIVE PERMISSION MODES; app broker only for
 * automations", so this is a NORMALIZED NAME FOR A FLAG CHORUS PASSES THROUGH,
 * never a permission system Chorus implements. Chorus does not decide what an
 * agent may do; it decides which word to hand the CLI that already does.
 *
 * ⚠ THERE IS DELIBERATELY NO `bypass` POSITION, AND ITS ABSENCE IS THE
 * DECISION. claude's own `--permission-mode bypassPermissions` is described by
 * its `--help` as "Bypass all permission checks. Recommended only for sandboxes
 * with no internet access." A segmented control puts that one click away from
 * "Auto", in a dialog whose every other control is reversible. It stays
 * reachable exactly where the unmapped effort rungs stay reachable — the raw
 * `extra_args` override, rank 1 — so nothing is taken away; it just cannot be
 * hit by accident. (Same shape of ruling as 3a-4's unmapped-rung argument.)
 */
export const permissionModeSchema = z.enum(['auto', 'accept-edits', 'plan', 'manual'])
export type PermissionMode = z.infer<typeof permissionModeSchema>

export const attachRequestSchema = z.object({
  agent: agentKindSchema,
  /** Stable sessions-row id (Task 1-2). Attach is a PURE VIEW BINDING with no
   *  spawn path at all (Task 1-5/D16: the 1-4 attach-time relaunch gate is
   *  gone — all relaunch goes through session:restart or the restore engine). */
  sessionId: z.uuid()
})
export type AttachRequest = z.infer<typeof attachRequestSchema>

export const attachResponseSchema = z.object({
  sessionId: z.string().min(1),
  /** replay of recent output so a reloaded renderer repaints the screen */
  buffer: z.string(),
  status: sessionStatusSchema,
  exitCode: z.number().int().nullable(),
  /** Restore engine found the row's cwd gone (D16 clause 3): the pane renders
   *  its own "Working directory not found" chrome — never a sentinel exit code. */
  cwdMissing: z.boolean().optional(),
  /** The restore engine has this id queued for a staggered relaunch: the pane
   *  shows a restoring spinner instead of transient exited chrome. */
  restorePending: z.boolean().optional(),
  /** The restore engine relaunched this session and no pane has attached
   *  since: the first attach to report it wears the transient "new
   *  conversation" badge (consumed on report — exactly one badge per relaunch,
   *  immune to how late the pane mounts). */
  restored: z.boolean().optional(),
  /** 1b-1: seed the header on attach. Required-NULLABLE (not .optional()) so a
   *  producer that forgets it fails the outbound parse loudly. */
  title: z.string().nullable(),
  /**
   * The session's human NAME and NOTE, chosen at launch.
   *
   * ⚠ NEITHER IS `title`, AND THE DISTINCTION IS THE WHOLE REASON THEY ARE
   * SEPARATE COLUMNS. `title` is CAPTURED — an OSC 0/2 sequence the agent emits,
   * which changes under the user without warning and can be clobbered by the
   * next thing the TUI prints (D18). These are AUTHORED: typed by a person once,
   * written by nothing else, and stable for the life of the row. Folding them
   * into `title` would put a live stream and a human's label in one field, where
   * the stream always wins.
   *
   * Required-nullable, the same discipline as `title` above: null is "never
   * named", which is every session that existed before this feature.
   */
  name: z.string().nullable(),
  description: z.string().nullable(),
  /** 2-2: the session's worktree branch, or null for current-tree sessions.
   *  Required-nullable, same discipline as title. Resolved in main from the
   *  WORKTREES side (worktrees.session_id — F18 resolution a), so a
   *  crash-window NULL sessions.worktree_id never hides the label. */
  branch: z.string().nullable(),
  /** 2-3: the owning worktree row's id, or null for current-tree sessions.
   *  Required-nullable, same discipline as branch. The pane close flow acts by
   *  worktree id (clean-removal offer / dirty detach); resolved row-side
   *  exactly like branch (F18a). */
  worktreeId: z.string().nullable(),
  /**
   * v16: whether this agent is locked against kill/close.
   *
   * ⚠ A PLAIN BOOLEAN, NOT THE `locked_at` TIMESTAMP THE COLUMN STORES. The
   * renderer's only question is "may I offer the destructive buttons", and
   * shipping the timestamp would invite a surface to render "locked 3h ago" —
   * a per-card clock for a fact that does not change, which is exactly the
   * cadence discipline F12 exists to hold. The column keeps the richer value for
   * whoever needs it later; the wire carries the answer to the question asked.
   *
   * ⚠ AND IT IS SEEDED, NOT STREAMED. Unlike `title` there is no live source to
   * race: nothing outside the user's own click changes a lock, so the pane seeds
   * this once at attach and patches it from its own mutation's response — the
   * `name`/`description` discipline, not the OSC-title one.
   */
  locked: z.boolean()
})
export type AttachResponse = z.infer<typeof attachResponseSchema>

/* ------------------------------------------------------------------ */
/* Task 2-2: workspace modes (D22 + D26f)                              */
/* ------------------------------------------------------------------ */

/** The three workspace modes a launch can run in (D22; read-only deferred to
 *  Phase 3+). The mode ALWAYS travels explicitly in the launch payload — main
 *  computes a suggestion for the dialog and validates the chosen mode at
 *  launch, but never silently substitutes one mode for another. */
export const workspaceModeSchema = z.enum(['current-tree', 'new-worktree', 'existing-worktree'])
export type WorkspaceMode = z.infer<typeof workspaceModeSchema>

/** A worktree the existing-worktree picker can offer: `detached`, or `active`
 *  with no live owning session (main computes attachability — the picker is a
 *  view of main's verdict, never its own authority). */
export const pickableWorktreeSchema = z.object({
  id: z.uuid(),
  branch: z.string(),
  path: z.string(),
  status: z.string()
})
export type PickableWorktree = z.infer<typeof pickableWorktreeSchema>

/**
 * The caps on a session's authored name and note. Enforced HERE, on the
 * boundary — the PROJECT_DESCRIPTION_MAX rule, for its reason: a length the
 * user can hit by typing belongs where the dialog can render it as a live
 * counter, not where it surfaces as a failed write.
 *
 * ⚠ Declared UP HERE, not beside the other caps further down, because
 * `launchRequestSchema` below reads them at module-evaluation time.
 */
export const AGENT_NAME_MAX = 40
export const AGENT_DESCRIPTION_MAX = 50

/**
 * v16: the agent-lock PIN's length bounds, on the boundary for the same reason
 * the two caps directly above are — the Settings field renders "at least 4
 * characters" as guidance the user can act on while typing, which a failed
 * write cannot be.
 *
 * ⚠ 4 IS A FLOOR ON DELIBERATENESS, NOT ON STRENGTH, and the distinction is the
 * feature. This guard exists so a stray keypress cannot clear a lock; it is not
 * an authorization boundary and the PIN is clearable in Settings with no prior
 * PIN. `agentLockCore.ts` carries the full argument — read it before hardening
 * anything here, because hardening the hash while the clear path stays open buys
 * nothing.
 *
 * ⚠ DECLARED HERE, IN SHARED, AND IMPORTED BY MAIN — never the reverse.
 * `agentLockCore` (main) reads these; a copy of the numbers there would be a
 * second home for one rule, and the drift would be silent in the direction that
 * matters (a renderer accepting what main refuses).
 */
export const PIN_MIN_LENGTH = 4
export const PIN_MAX_LENGTH = 64

/** The D26(f) suggestion rule, factored pure for the unit test: a non-git
 *  project root offers only current-tree; ≥1 OTHER live session already
 *  writing the same repo flips the dialog DEFAULT to new-worktree; anything
 *  else stays current-tree. A suggestion only — the chosen mode is
 *  re-validated against the actual cwd at launch. */
export function suggestMode(repoRoot: string | null, liveSessionsInRepo: number): WorkspaceMode {
  if (repoRoot === null) return 'current-tree'
  return liveSessionsInRepo >= 1 ? 'new-worktree' : 'current-tree'
}

/**
 * session:launch request. `cwd` is only min(1) here BY DESIGN: the absolute-
 * path + exists checks touch the filesystem and live in the main-process
 * handler, where they are the security boundary — never in a shared schema.
 */
export const launchRequestSchema = z.object({
  /** Task 1-5: every handler resolves the project per-request (validated here
   *  as a uuid, FK-checked against the projects table in main). */
  project_id: z.uuid(),
  agent: agentKindSchema,
  cwd: z.string().min(1),
  /** 2-2: the chosen workspace mode — REQUIRED, always explicit (D22). */
  workspace_mode: workspaceModeSchema,
  /** The existing-worktree pick. Required-when-existing is enforced in MAIN
   *  (an {ok:false} inline reason), not by schema branching; absent/ignored
   *  for current-tree and new-worktree. */
  worktree_id: z.uuid().optional(),
  /** Task 3-6: the BYOK pick — a credential PROFILE ID, never a key (D33
   *  clause 2/Q2: main resolves and decrypts server-side only). Absent is
   *  the first-class subscription/ambient path (D33 clause 9). */
  credential_profile_id: z.uuid().optional(),
  /** Task 3a-4: the app-level effort level for THIS launch. Optional, and
   *  absent means Chorus emits no effort argument at all — the CLI's own
   *  default, which is what makes a no-effort launch byte-identical to a
   *  pre-3a-4 one.
   *
   *  Task 3a-5 persists it on `launch_profiles.effort` and PREFILLS THIS SAME
   *  FIELD from the chosen profile — there is deliberately NO second effort
   *  field on this payload. If the payload carries one, THE PAYLOAD WINS,
   *  because it is what the user is looking at; the profile is the default. */
  effort: effortLevelSchema.optional(),
  /** The app-level permission mode for THIS launch (2026-08-14). Optional, and
   *  absent does NOT mean "no flag" the way an absent `effort` used to: it means
   *  "whatever the adapter declares as its default", which for claude is `auto`.
   *  The same rank order as `effort` — payload beats profile beats the
   *  adapter's declared default beats the CLI's own. */
  permission_mode: permissionModeSchema.optional(),
  /** Task 3a-5 / D43: launch from a saved profile.
   *
   *  ⚠ MUTUALLY EXCLUSIVE with credential_profile_id — both present is refused
   *  in MAIN with an authored reason, deliberately NOT by schema branching, so
   *  the refusal has a place to say why. ONE resolver, ONE source of truth for
   *  the credential.
   *
   *  The division of authority: the PROFILE supplies the credential, route,
   *  model, effort, permission mode and env; the PAYLOAD still supplies
   *  `agent`, `cwd` and `workspace_mode`, because the user may change all three
   *  after picking a profile and because `cwd` is the SECURITY BOUNDARY main
   *  validates itself — a stored row is untrusted input like any other. */
  launch_profile_id: z.uuid().optional(),
  /**
   * D90 (2026-07-28): THE MODEL CHOSEN FOR THIS LAUNCH — rank 0 of D56's
   * precedence order, ahead of `launch_profiles.model` and
   * `provider_configs.model`.
   *
   * ⚠ THIS REVISES D81, WHICH SAID `LaunchDialog` HAS NO MODEL INPUT, AND IT
   * DOES NOT REOPEN WHAT D48 CLOSED. D48's objection was to a FREE-TEXT model
   * field standing beside the route's own default — two hand-authored homes for
   * one fact, drifting apart. This is not that. It is a CLOSED PICK from a list
   * main already owns (`model_shortlist`, then `model_catalog` — D85), it is
   * never persisted by the launch path, and it writes to NOTHING: grep this
   * feature for `UPDATE provider_configs` and the answer is still zero. The
   * route's default remains the default; this says only "not that one, today".
   *
   * ⚠ AND IT IS RESOLVED IN MAIN, exactly like every other rank. The renderer
   * sends the id it was offered; `session:launch` decides what wins. There is
   * no second precedence table in a `.vue` file (the D48/D56 rule that
   * `resolvedModel` in LaunchDialog.vue already obeys).
   *
   * Absent means "no per-launch choice" and the pre-D90 order applies
   * unchanged, which is what keeps every existing launch byte-identical.
   */
  model: z.string().min(1).max(200).optional(),
  /**
   * The session's name and one-line note, typed in the dialog.
   *
   * ⚠ OPTIONAL, and absent means UNNAMED — not "pick one for me". The
   * suggestion is made in the RENDERER, where the user can see and overwrite it
   * before it is sent; main never invents a name, so a payload with no name
   * produces a row with no name and a card that reads exactly as it did before
   * this feature. (Same discipline as `effort` and `model` above: the untouched
   * path stays byte-identical.)
   *
   * Main trims both and folds an all-whitespace value to NULL, so "" and NULL
   * cannot both be storable — the projects.description rule, applied here.
   */
  name: z.string().max(AGENT_NAME_MAX).optional(),
  description: z.string().max(AGENT_DESCRIPTION_MAX).optional()
})
export type LaunchRequest = z.infer<typeof launchRequestSchema>

/** Launch outcome: the attach-style snapshot of the new session, or a
 *  structured validation failure the dialog shows inline. */
export const launchResponseSchema = z.union([
  attachResponseSchema,
  z.object({ ok: z.literal(false), reason: z.string() })
])
export type LaunchResponse = z.infer<typeof launchResponseSchema>

export const launchContextRequestSchema = z.object({ project_id: z.uuid() })
export type LaunchContextRequest = z.infer<typeof launchContextRequestSchema>

/* ------------------------------------------------------------------ */
/* Task 3a-5 / D43: launch profiles                                     */
/* ------------------------------------------------------------------ */

/** ⚠ A SAVED profile may not pin a transient worktree row. `existing-worktree`
 *  names a specific `worktrees` row that may be gone by the next launch, so it
 *  is a launch-time choice, never a stored one. Deliberately a SUBSET of
 *  workspaceModeSchema rather than a second copy. */
export const savedWorkspaceModeSchema = z.enum(['current-tree', 'new-worktree'])
export type SavedWorkspaceMode = z.infer<typeof savedWorkspaceModeSchema>

/**
 * One launch profile on the wire.
 *
 * ⚠ Carries a credential PROFILE ID and its LABEL and NOTHING ELSE. There is no
 * field here capable of holding key material, and `src/shared/ipc.test.ts`
 * asserts that over the parse output's KEY SET (the 3-2 discipline) rather than
 * by spot-checking.
 *
 * `disabled_reason` is computed in MAIN by resolveLaunchProfile. An unlaunchable
 * profile is SHOWN and DISABLED with its reason, never filtered out: a launch
 * profile is a row the USER NAMED, and hiding it is a worse experience than
 * explaining it. (This deliberately differs from 3-6's `eligibleProfiles`,
 * which hides unavailable CREDENTIAL profiles — those are plumbing.)
 */
export const launchProfileWireSchema = z.object({
  id: z.uuid(),
  label: z.string().min(1).max(120),
  agent: agentKindSchema,
  provider_id: z.uuid().nullable(),
  provider_name: z.string().max(120).nullable(),
  credential_profile_id: z.uuid().nullable(),
  credential_label: z.string().max(120).nullable(),
  /** The RESOLVED model (profile -> route -> null), so the renderer never
   *  re-implements 3a-4's precedence table and cannot create a second home. */
  model: z.string().max(200).nullable(),
  /** 3a-4's effortLevelSchema, IMPORTED — not z.string(), and not a second
   *  enum. A parallel effort vocabulary is exactly the two-homes failure D48
   *  exists to prevent. */
  effort: effortLevelSchema.nullable(),
  /** ⚠ TIGHTENED from `z.string().max(40)` on 2026-08-14, when this column
   *  stopped being inert. 3a-5 created it as free text precisely because
   *  nothing consumed it ("stored, consumed by nothing" — ImplementationSpec
   *  3a-5 §120); now that it maps onto a CLI flag it gets the same treatment
   *  `effort` already had — the ONE vocabulary, imported, never re-listed. Rows
   *  outside it are narrowed to null by `resolveLaunchProfile`, exactly as an
   *  out-of-vocabulary `effort` already is, so a hand-edited DB degrades to the
   *  adapter default instead of failing the outbound parse. */
  permission_mode: permissionModeSchema.nullable(),
  workspace_mode: savedWorkspaceModeSchema,
  env_json: z.string().max(4096).nullable(),
  disabled_reason: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string()
})
export type LaunchProfileWire = z.infer<typeof launchProfileWireSchema>

export const launchProfileListResponseSchema = z.object({
  profiles: z.array(launchProfileWireSchema)
})
export type LaunchProfileListResponse = z.infer<typeof launchProfileListResponseSchema>

export const launchProfileCreateRequestSchema = z.object({
  label: z.string().min(1).max(120),
  agent: agentKindSchema,
  provider_id: z.uuid().nullable(),
  credential_profile_id: z.uuid().nullable(),
  model: z.string().min(1).max(200).nullable(),
  effort: effortLevelSchema.nullable(),
  permission_mode: permissionModeSchema.nullable(),
  workspace_mode: savedWorkspaceModeSchema,
  /** NON-SECRET string->string additions. Main runs every VALUE through
   *  scrubSecrets and REFUSES if it carries a known key shape — the
   *  extra_headers_json precedent. A key belongs in a credential. */
  env_json: z.string().max(4096).nullable()
})
export type LaunchProfileCreateRequest = z.infer<typeof launchProfileCreateRequestSchema>

export const launchProfileCreateResponseSchema = z.union([
  z.object({ ok: z.literal(true), profile: launchProfileWireSchema }),
  z.object({ ok: z.literal(false), reason: z.string() })
])
export type LaunchProfileCreateResponse = z.infer<typeof launchProfileCreateResponseSchema>

/** Patch semantics: absent = unchanged; null = clear; a value = set. */
export const launchProfileUpdateRequestSchema = z.object({
  id: z.uuid(),
  label: z.string().min(1).max(120).optional(),
  model: z.string().min(1).max(200).nullable().optional(),
  effort: effortLevelSchema.nullable().optional(),
  permission_mode: permissionModeSchema.nullable().optional(),
  workspace_mode: savedWorkspaceModeSchema.optional(),
  credential_profile_id: z.uuid().nullable().optional(),
  env_json: z.string().max(4096).nullable().optional()
})
export type LaunchProfileUpdateRequest = z.infer<typeof launchProfileUpdateRequestSchema>

export const launchProfileUpdateResponseSchema = z.union([
  z.object({ ok: z.literal(true), profile: launchProfileWireSchema }),
  z.object({ ok: z.literal(false), reason: z.string() })
])
export type LaunchProfileUpdateResponse = z.infer<typeof launchProfileUpdateResponseSchema>

export const launchProfileDeleteRequestSchema = z.object({ id: z.uuid() })
export type LaunchProfileDeleteRequest = z.infer<typeof launchProfileDeleteRequestSchema>

export const launchProfileDeleteResponseSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), reason: z.string() })
])
export type LaunchProfileDeleteResponse = z.infer<typeof launchProfileDeleteResponseSchema>

/* ------------------------------------------------------------------ */
/* Phase 3b / Task 3b-2 (D62): council members                          */
/* ------------------------------------------------------------------ */

/**
 * The two things a member can be. `arbiter` breaks a deadlock; `member` argues.
 *
 * ⚠ THE VOCABULARY LIVES HERE AND NOWHERE ELSE. There is deliberately NO
 * `CHECK` constraint on `council_members.role` — that would put the list in two
 * places and make widening it a MIGRATION, which is exactly how `auth_mode` and
 * `status` are already handled. Main validates against this schema on the way
 * in AND on the way out, so a hand-edited row cannot render as a legal role.
 */
export const councilRoleSchema = z.enum(['member', 'arbiter'])
export type CouncilRole = z.infer<typeof councilRoleSchema>

/**
 * One council member on the wire.
 *
 * ⚠ IDS AND LABELS ONLY. There is no field here capable of holding key
 * material, and `src/shared/ipc.test.ts` asserts that over the parse output's
 * KEY SET (the 3-2 discipline) rather than by spot-checking. `.strict()` makes
 * it loud: zod would otherwise silently STRIP an unknown key, letting a raw row
 * pass with its extra columns dropped unnoticed.
 *
 * ⚠ NO `baseUrl` AND NO `providerId`, MIRRORING THE ROW. The route has ONE home
 * (D48) and is reached through the credential; `providerName` is here purely so
 * the list can say which route a member speaks on, and it is a NAME, not a
 * route. Adding either field back is the change a reviewer must refuse.
 *
 * ⚠ NO `paramsJson` EITHER — deliberately WRITE-ONLY INBOUND. A member's
 * parameters are user-authored free text and therefore the field most able to
 * carry a pasted key; main refuses one that matches a known key shape at write
 * time, and never echoes the value back into the DOM.
 *
 * `model` is the RAW COLUMN and `resolvedModel` is D56's answer. Both are on
 * the wire on purpose: the UI has to be able to show that a NULL model column
 * INHERITS the route's default rather than being empty, and a single field
 * would make those two facts indistinguishable — which is precisely how a
 * "helpful" back-write into rank 1 gets written by someone reading the UI.
 */
export const councilMemberWireSchema = z
  .object({
    id: z.uuid(),
    label: z.string().min(1).max(120),
    credentialProfileId: z.uuid(),
    credentialLabel: z.string().max(120).nullable(),
    providerName: z.string().max(120).nullable(),
    /** D56 RANK 1 — the raw column, NULL when this member inherits. */
    model: z.string().max(200).nullable(),
    /** D56 RESOLVED — rank 1 > the route's rank 2 > null. COMPUTED IN MAIN and
     *  NEVER WRITTEN BACK to the row (that is the second home D48 forbids). */
    resolvedModel: z.string().max(200).nullable(),
    role: councilRoleSchema,
    /** False when the member cannot deliberate — a management route, a missing
     *  or unavailable credential. The row is still SHOWN and EXPLAINED. */
    available: z.boolean(),
    /** Main's authored, LABEL-ONLY reason. Never a URL, an env var name, or a
     *  key fragment — the `vaultCore.failureMessage` vocabulary. */
    unavailableReason: z.string().nullable(),
    /**
     * This member's own `max_tokens`, or NULL when it inherits the role default
     * beside it. The one parameter the transport actually sends (F34), so it is
     * the one the settings form can edit.
     *
     * ⚠ A NUMBER, AND THAT IS WHAT MAKES IT SAFE TO ECHO. `params_json` itself
     * still NEVER round-trips — see `toCouncilMemberWire` — because it is the
     * field most able to carry a pasted key. A `z.number()` cannot carry one,
     * so this projection of it can cross the bridge where the string may not.
     */
    maxTokens: z.number().int().nullable(),
    /** The role default main would apply for this row — the placeholder behind
     *  an empty field. On the wire so the renderer hardcodes neither number. */
    defaultMaxTokens: z.number().int(),
    /** The NAMES of every other stored parameter, so an edit form can say what
     *  it is preserving. ⚠ NAMES ONLY, NEVER VALUES — a value is the thing that
     *  could be a key, and the reason `params_json` stays off the wire. */
    otherParamNames: z.array(z.string().max(120)).max(32)
  })
  .strict()
export type CouncilMemberWire = z.infer<typeof councilMemberWireSchema>

export const councilMemberListRequestSchema = z.object({})
export type CouncilMemberListRequest = z.infer<typeof councilMemberListRequestSchema>

export const councilMemberListResponseSchema = z.object({
  members: z.array(councilMemberWireSchema)
})
export type CouncilMemberListResponse = z.infer<typeof councilMemberListResponseSchema>

export const councilMemberCreateRequestSchema = z.object({
  label: z.string().min(1).max(120),
  /** ⚠ NOT NULLABLE, and there is no `providerId` beside it. A council member
   *  ALWAYS AUTHENTICATES — D33 clause 9's route-without-credential case does
   *  not reach here — so the credential is the one pointer, and the route is
   *  derived from it. */
  credentialProfileId: z.uuid(),
  /** D56 rank 1. NULL means "inherit this route's default", which is a real
   *  choice and not an absence. */
  model: z.string().min(1).max(200).nullable(),
  role: councilRoleSchema,
  /** NON-SECRET JSON object of member parameters (temperature, top_p, …).
   *  Main REFUSES any value carrying a known key shape — the
   *  `extra_headers_json` precedent. Never echoed back. */
  paramsJson: z.string().max(4096).nullable()
})
export type CouncilMemberCreateRequest = z.infer<typeof councilMemberCreateRequestSchema>

export const councilMemberCreateResponseSchema = z.union([
  z.object({ ok: z.literal(true), member: councilMemberWireSchema }),
  z.object({ ok: z.literal(false), reason: z.string() })
])
export type CouncilMemberCreateResponse = z.infer<typeof councilMemberCreateResponseSchema>

/** Patch semantics: absent = unchanged; null = clear; a value = set. */
export const councilMemberUpdateRequestSchema = z.object({
  id: z.uuid(),
  label: z.string().min(1).max(120).optional(),
  credentialProfileId: z.uuid().optional(),
  model: z.string().min(1).max(200).nullable().optional(),
  role: councilRoleSchema.optional(),
  paramsJson: z.string().max(4096).nullable().optional(),
  /**
   * `max_tokens` ALONE, merged into whatever the row already stores. Patch
   * semantics like the rest: absent = unchanged, null = clear (fall back to the
   * role default), a number = set.
   *
   * ⚠ IT EXISTS BECAUSE THE RENDERER CANNOT SEE THE OTHER PARAMETERS. Editing
   * `max_tokens` through `paramsJson` would mean sending the whole object back —
   * which the renderer does not have, because values never round-trip — so a
   * save would silently drop every parameter it could not see. Main does the
   * merge instead, over the row it already holds.
   *
   * Sent WITH `paramsJson`, the replacement is applied first and this lands on
   * top of the result. That order is what lets the settings form offer "replace
   * the others" and "set max_tokens" as two independent controls.
   */
  maxTokens: z.number().int().nullable().optional()
})
export type CouncilMemberUpdateRequest = z.infer<typeof councilMemberUpdateRequestSchema>

export const councilMemberUpdateResponseSchema = z.union([
  z.object({ ok: z.literal(true), member: councilMemberWireSchema }),
  z.object({ ok: z.literal(false), reason: z.string() })
])
export type CouncilMemberUpdateResponse = z.infer<typeof councilMemberUpdateResponseSchema>

export const councilMemberDeleteRequestSchema = z.object({ id: z.uuid() })
export type CouncilMemberDeleteRequest = z.infer<typeof councilMemberDeleteRequestSchema>

export const councilMemberDeleteResponseSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), reason: z.string() })
])
export type CouncilMemberDeleteResponse = z.infer<typeof councilMemberDeleteResponseSchema>

export const relaunchRequestSchema = z.object({ sessionId: z.string().min(1) })
export type RelaunchRequest = z.infer<typeof relaunchRequestSchema>

/**
 * Same union SHAPE as restartResponseSchema, and deliberately its OWN schema
 * rather than an alias: the two verbs differ in meaning — restart means "same
 * configuration, NO credential"; relaunch means "same configuration, credential
 * RE-RESOLVED because you asked" — and they will diverge before they converge.
 */
export const relaunchResponseSchema = z.union([
  attachResponseSchema,
  z.object({ ok: z.literal(false), reason: z.string() })
])
export type RelaunchResponse = z.infer<typeof relaunchResponseSchema>

export const launchContextResponseSchema = z.object({
  projectRoot: z.string().min(1),
  /** recent launch cwds, newest first, deduped, capped at 10 in main */
  recentCwds: z.array(z.string()),
  /** 2-2: git toplevel of projectRoot (resolveRepoRoot's forward-slash form);
   *  null when the project root is not inside a git repo — the dialog then
   *  offers only current-tree (findings risk 3). */
  repoRoot: z.string().nullable(),
  /** 2-2: OTHER live sessions whose cwd resolves to repoRoot (D26f). */
  liveSessionsInRepo: z.number().int(),
  /** 2-2: main's dialog default (D26f) — a suggestion, never an override. */
  suggestedMode: workspaceModeSchema,
  /** 2-2: attachable worktrees for the existing-worktree picker. */
  worktrees: z.array(pickableWorktreeSchema),
  /** Task 3a-5: the picker's rows, resolved and ordered by label in MAIN.
   *  They ride in on the existing launch-context call — no fifth round trip. */
  launchProfiles: z.array(launchProfileWireSchema),
  /** Task 3a-5: the PER-PROJECT last-used pointer, or null when there is none
   *  or when it DANGLES (the profile was deleted). Computed in MAIN: the
   *  renderer never derives a default and never persists one, and a dangling
   *  pointer resolves to "no default" rather than to a fuzzy label match. */
  lastLaunchProfileId: z.uuid().nullable(),
  /** The names already in use in THIS project, so the dialog's suggestion does
   *  not hand out a second "Bob" (the whole point of a name is telling two
   *  Claude Code panes apart). Computed in main from the session rows; the
   *  renderer only subtracts it from the pool. NOT a uniqueness constraint —
   *  the user may type any name they like, including a duplicate. */
  usedAgentNames: z.array(z.string())
})
export type LaunchContextResponse = z.infer<typeof launchContextResponseSchema>

/* ------------------------------------------------------------------ */
/* Task 2-3: cleanup flows + retained-worktree panel (D26 clauses 5-8) */
/* ------------------------------------------------------------------ */

export const worktreeListRequestSchema = z.object({ project_id: z.uuid() })
export type WorktreeListRequest = z.infer<typeof worktreeListRequestSchema>

/** One row for the retained-worktree panel (risk 6 columns + prune
 *  surfacing). `isPruneCandidate` is recomputed LIVE at list time (2-1's
 *  reconcile never persists surface findings): the directory is gone while
 *  the row/git metadata remains (population 2), or the entry is a surfaced
 *  orphan directory (population 5, nil-uuid sentinel id). `ahead`/`behind`
 *  are -1 when not computable — adopted rows carry empty branch/base_branch
 *  and an empty ref fails rev-list (the panel renders — instead). */
export const worktreeSummarySchema = z.object({
  id: z.uuid(),
  path: z.string(),
  branch: z.string(),
  status: z.string(),
  clean: z.boolean(),
  dirtyCount: z.number().int(),
  ahead: z.number().int(),
  behind: z.number().int(),
  isPruneCandidate: z.boolean()
})
export type WorktreeSummary = z.infer<typeof worktreeSummarySchema>

export const worktreeListResponseSchema = z.array(worktreeSummarySchema)
export type WorktreeListResponse = z.infer<typeof worktreeListResponseSchema>

export const worktreeRemoveRequestSchema = z.object({
  worktreeId: z.uuid(),
  /** opt-in ONLY (D26 Q4) — default false; branches are never auto-deleted. */
  deleteBranch: z.boolean().optional(),
  /** required to equal the worktree path for a DIRTY removal (D26 clause 6).
   *  It licenses nothing else — F21 split the -D escalation off into its own
   *  token below. */
  confirmation: z.string().optional(),
  /** F21: a SEPARATE acknowledgment from `confirmation`, required before main
   *  will ever pass `force: true` to branchDelete. D26(j) said "the same typed
   *  confirmation"; that overloaded one token to license two different
   *  destructions — uncommitted FILES (confirmation, naming the path) and
   *  unmerged COMMITS (this, naming the branch). They are now distinct, so
   *  neither can stand in for the other. */
  branchForceConfirmation: z.string().optional()
})
export type WorktreeRemoveRequest = z.infer<typeof worktreeRemoveRequestSchema>

export const worktreeRemoveResponseSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), reason: z.string() })
])
export type WorktreeRemoveResponse = z.infer<typeof worktreeRemoveResponseSchema>

export const worktreeDirtyFilesRequestSchema = z.object({ worktreeId: z.uuid() })
export type WorktreeDirtyFilesRequest = z.infer<typeof worktreeDirtyFilesRequestSchema>

export const worktreeDirtyFilesResponseSchema = z.array(z.string())
export type WorktreeDirtyFilesResponse = z.infer<typeof worktreeDirtyFilesResponseSchema>

/** The D26 clause-6 confirmation gate, factored pure for the unit test (the
 *  worktree:remove handler is the authority; the panel mirrors it). A clean
 *  worktree removes without confirmation; a dirty one removes only when the
 *  typed token exactly matches its path. */
export function dirtyRemovalAllowed(
  wt: { path: string; clean: boolean },
  confirmation: string | undefined
): boolean {
  if (wt.clean) return true
  return confirmation === wt.path
}

/** The F21 branch-force gate, factored pure for the unit test (the
 *  worktree:remove handler is the authority). `-D` destroys unmerged commits,
 *  so it is licensed ONLY by an acknowledgment naming the BRANCH — never by
 *  the dirty-removal path token, and never by its absence. The empty-branch
 *  guard is load-bearing: adopted rows (population 4) are born with
 *  `branch = ''`, and without it an empty-string ack would be `'' === ''` —
 *  licensing a force-delete of a nameless branch. */
export function branchForceAllowed(
  wt: { branch: string },
  ack: string | undefined
): boolean {
  if (wt.branch === '') return false
  return ack === wt.branch
}

/* ------------------------------------------------------------------ */
/* Task 2-4: diff summary (read-only; F18a worktree resolution)        */
/* ------------------------------------------------------------------ */

export const worktreeDiffRequestSchema = z.object({ sessionId: z.uuid() })
export type WorktreeDiffRequest = z.infer<typeof worktreeDiffRequestSchema>

/** `{filesChanged, insertions, deletions}` come from `git diff --shortstat
 *  HEAD` in the worktree (tracked changes vs HEAD); `untracked` counts `??`
 *  lines in `git status --porcelain`. Read-only — the channel never stages,
 *  commits, merges, or removes anything. */
export const worktreeDiffSummarySchema = z.object({
  filesChanged: z.number().int(),
  insertions: z.number().int(),
  deletions: z.number().int(),
  untracked: z.number().int()
})
export type WorktreeDiffSummary = z.infer<typeof worktreeDiffSummarySchema>

/** null when the session has no worktree (current-tree), the worktree row is
 *  gone, or its directory no longer exists — the pane shows no counts. */
export const worktreeDiffResponseSchema = worktreeDiffSummarySchema.nullable()
export type WorktreeDiffResponse = z.infer<typeof worktreeDiffResponseSchema>

/* ------------------------------------------------------------------ */
/* Task 3-2: providers + credential vault (D33)                        */
/*                                                                     */
/* The security shape of this surface is the deliverable:              */
/*  1. WRITE-ONLY INBOUND — `key` exists on exactly two request        */
/*     schemas (create/replace) and on NO response schema. A handler   */
/*     that forgets fails the OUTBOUND parse loudly instead of leaking */
/*     quietly (D33 clause 3).                                         */
/*  2. THE SALTED KEY DIGEST NEVER LEAVES MAIN (D33 resolution b) — no       */
/*     schema here admits the digest column; duplicate disambiguation is the */
/*     mandatory label's job.                                                */
/*  3. No masked preview, no hint, no length — clause 3 admits no      */
/*     exception.                                                      */
/* ------------------------------------------------------------------ */

/** A provider_configs row as it crosses IPC: NON-SECRET metadata only (D33
 *  resolution e documents base_url / extra_headers_json as non-secret; the
 *  credential envelope's own values override them at launch). snake_case
 *  column names on the wire, same convention as projectSchema.root_path.
 *  Nullable fields are required-nullable (the house discipline since 1b-1). */
export const providerConfigSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(120),
  adapter_type: z.string().min(1).max(60),
  auth_mode: z.string().min(1).max(60),
  env_var_name: z.string().max(120).nullable(),
  base_url: z.string().max(2048).nullable(),
  extra_headers_json: z.string().max(8192).nullable(),
  /** D48 (migration v6): the route's DEFAULT model id. Nullable — a
   *  subscription route has no model to name. NOT a catalog entry: one
   *  hand-entered scalar per route, no list, no fetch, no refresh. */
  model: z.string().max(200).nullable(),
  created_at: z.string()
})
export type ProviderConfig = z.infer<typeof providerConfigSchema>

export const providerListRequestSchema = z.object({})
export type ProviderListRequest = z.infer<typeof providerListRequestSchema>

export const providerListResponseSchema = z.array(providerConfigSchema)
export type ProviderListResponse = z.infer<typeof providerListResponseSchema>

export const providerCreateRequestSchema = z.object({
  name: z.string().min(1).max(120),
  /** Plain TEXT this task (3-2) — nothing validates it against an adapter
   *  registry until Task 3-3. */
  adapter_type: z.string().min(1).max(60),
  auth_mode: z.string().min(1).max(60),
  env_var_name: z.string().min(1).max(120).optional(),
  base_url: z.string().min(1).max(2048).optional(),
  /** Plaintext and documented non-secret — main runs it through scrubSecrets
   *  and REFUSES if it carries a known key shape (spec §6.4). */
  extra_headers_json: z.string().min(1).max(8192).optional(),
  /** D48: the route's default model id (optional; hand-entered). */
  model: z.string().min(1).max(200).optional()
})
export type ProviderCreateRequest = z.infer<typeof providerCreateRequestSchema>

export const providerCreateResponseSchema = z.union([
  z.object({ ok: z.literal(true), provider: providerConfigSchema }),
  z.object({ ok: z.literal(false), reason: z.string() })
])
export type ProviderCreateResponse = z.infer<typeof providerCreateResponseSchema>

/** Patch semantics: absent = unchanged; null = clear (nullable fields only);
 *  a value = set. Non-nullable columns reject null outright. */
export const providerUpdateRequestSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(120).optional(),
  adapter_type: z.string().min(1).max(60).optional(),
  auth_mode: z.string().min(1).max(60).optional(),
  env_var_name: z.string().min(1).max(120).nullable().optional(),
  base_url: z.string().min(1).max(2048).nullable().optional(),
  extra_headers_json: z.string().min(1).max(8192).nullable().optional(),
  model: z.string().min(1).max(200).nullable().optional()
})
export type ProviderUpdateRequest = z.infer<typeof providerUpdateRequestSchema>

export const providerUpdateResponseSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), reason: z.string() })
])
export type ProviderUpdateResponse = z.infer<typeof providerUpdateResponseSchema>


export const providerDeleteRequestSchema = z.object({ id: z.uuid() })
export type ProviderDeleteRequest = z.infer<typeof providerDeleteRequestSchema>

export const providerDeleteResponseSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), reason: z.string() })
])
export type ProviderDeleteResponse = z.infer<typeof providerDeleteResponseSchema>

/** D33 clause 3 — the shape that leaves main. There is NO encrypted_blob and
 *  NO key-digest column here, and that absence is the enforcement mechanism:
 *  every credential handler outbound-parses through this schema, so a handler
 *  that returns a raw row fails loudly instead of leaking quietly. Adding a
 *  secret-bearing field to this schema is the one change reviewers must refuse.
 *  F-5b (D36 chore): `.strict()` makes "fails loudly" literal — zod's default
 *  silently STRIPS unknown keys, which would let a raw row pass with its
 *  digest/blob dropped unnoticed; strict throws on them instead. */
export const credentialProfileMetaSchema = z
  .object({
    id: z.uuid(),
    providerId: z.uuid(),
    label: z.string().min(1).max(120),
    createdAt: z.string(),
    lastVerifiedAt: z.string().nullable(),
    unavailableSince: z.string().nullable()
  })
  .strict()
export type CredentialProfileMetaWire = z.infer<typeof credentialProfileMetaSchema>

export const credentialListRequestSchema = z.object({})
export type CredentialListRequest = z.infer<typeof credentialListRequestSchema>

export const credentialListResponseSchema = z.array(credentialProfileMetaSchema)
export type CredentialListResponse = z.infer<typeof credentialListResponseSchema>

export const credentialCreateRequestSchema = z.object({
  providerId: z.uuid(),
  label: z.string().min(1).max(120),
  /** The plaintext key. This is the ONLY field in the entire IPC surface that
   *  ever carries key material, and it travels in ONE direction. There is no
   *  corresponding response field, by design. Bounded to keep a pathological
   *  payload from becoming a memory event; 8 KiB is far above any real key and
   *  far below anything worth worrying about. */
  key: z.string().min(1).max(8192),
  baseUrl: z.string().min(1).max(2048).optional(),
  /** Encrypted into the envelope alongside the key — correct by construction. */
  extraHeaders: z.record(z.string(), z.string().max(2048)).optional()
})
export type CredentialCreateRequest = z.infer<typeof credentialCreateRequestSchema>

/** create returns ONLY the new id (write-only inbound, D33 clause 3); failure
 *  is the inline-failure idiom Task 2-2 established, so the future dialog
 *  renders refusals without an exception path. */
export const credentialCreateResponseSchema = z.union([
  z.object({ ok: z.literal(true), id: z.uuid() }),
  z.object({ ok: z.literal(false), reason: z.string() })
])
export type CredentialCreateResponse = z.infer<typeof credentialCreateResponseSchema>

export const credentialReplaceRequestSchema = z.object({
  id: z.uuid(),
  key: z.string().min(1).max(8192),
  baseUrl: z.string().min(1).max(2048).optional(),
  extraHeaders: z.record(z.string(), z.string().max(2048)).optional()
})
export type CredentialReplaceRequest = z.infer<typeof credentialReplaceRequestSchema>

export const credentialReplaceResponseSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), reason: z.string() })
])
export type CredentialReplaceResponse = z.infer<typeof credentialReplaceResponseSchema>

export const credentialDeleteRequestSchema = z.object({ id: z.uuid() })
export type CredentialDeleteRequest = z.infer<typeof credentialDeleteRequestSchema>

export const credentialDeleteResponseSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), reason: z.string() })
])
export type CredentialDeleteResponse = z.infer<typeof credentialDeleteResponseSchema>

/** Task 3-6: the test-key probe (D33 resolution d). Request is a profile id;
 *  the response is a boolean plus a SANITIZED message — no response body, no
 *  exception text, no field capable of carrying key material (the unit test
 *  asserts the key set, same discipline as this file's meta schema). */
export const credentialTestRequestSchema = z.object({ id: z.uuid() })
export type CredentialTestRequest = z.infer<typeof credentialTestRequestSchema>

export const credentialTestResponseSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), reason: z.string() })
])
export type CredentialTestResponse = z.infer<typeof credentialTestResponseSchema>

/* ------------------------------------------------------------------ */
/* Task 3a-4: the model catalog (migration v9)                         */
/*                                                                     */
/* ⚠ A LIST OF WHAT EXISTS, NOT AN AUTHORITY. Nothing on this wire can  */
/* instruct main to change a route's default model: there is no field   */
/* for it, in either direction, and that absence is the enforcement.    */
/* The precedence order is launch_profiles.model (3a-5) >              */
/* provider_configs.model (v6, D48) > nothing; model_catalog is not in  */
/* it. See the v9 migration comment in storage.ts.                      */
/* ------------------------------------------------------------------ */

/** The three freshness states, COMPUTED IN MAIN. The renderer does no date
 *  arithmetic — a renderer-side threshold would be a second home for the
 *  policy. `'never'` is a third state, not a flavour of `'stale'`. */
export const catalogFreshnessSchema = z.enum(['never', 'fresh', 'stale'])
export type CatalogFreshnessWire = z.infer<typeof catalogFreshnessSchema>

/** One catalogued model. `.strict()` for the F-5b reason: zod otherwise
 *  STRIPS unknown keys silently, which would let a raw row pass with extra
 *  columns dropped unnoticed. There is no field here capable of carrying key
 *  material, and adding one is the change reviewers must refuse. */
export const modelCatalogEntrySchema = z
  .object({
    modelId: z.string().min(1).max(200),
    displayName: z.string().max(200),
    /** Stored and DISPLAYED, never reasoned over (explicit non-goal). */
    contextLength: z.number().int().nullable(),
    expiresAt: z.string().nullable(),
    /** Set once when a refresh stops seeing the id; never moved while it stays
     *  missing; cleared when it returns. The row is never deleted. */
    missingSince: z.string().nullable()
  })
  .strict()
export type ModelCatalogEntry = z.infer<typeof modelCatalogEntrySchema>

export const modelListRequestSchema = z.object({ provider_id: z.uuid() })
export type ModelListRequest = z.infer<typeof modelListRequestSchema>

export const modelListResponseSchema = z
  .object({
    models: z.array(modelCatalogEntrySchema),
    /** MAX(refreshed_at) over the provider's rows; null = never refreshed. */
    refreshedAt: z.string().nullable(),
    freshness: catalogFreshnessSchema,
    /**
     * D85 (Task 3d-2): the ids the USER shortlisted for this route, in the
     * order they added them.
     *
     * ⚠ A FLAT ARRAY BESIDE `models`, NOT A `shortlisted` FLAG ON EACH ENTRY,
     * and the difference is load-bearing. A flag could only ever describe ids
     * the catalog currently holds — so a shortlisted model that went missing,
     * or that a refresh never returned, would vanish from the user's own list
     * the moment the provider stopped mentioning it. The shortlist is user
     * intent and outlives the cache (v12), so it crosses the wire as its own
     * fact. Rendering the intersection is the renderer's job; deciding what
     * the user chose is not.
     */
    shortlist: z.array(z.string().min(1).max(200))
  })
  .strict()
export type ModelListResponse = z.infer<typeof modelListResponseSchema>

/** D85: add or remove ONE id from a route's shortlist. Idempotent in both
 *  directions, so the renderer may send the desired state rather than a
 *  toggle — a toggle would double-fire under a double click and silently
 *  undo itself. */
export const modelShortlistSetRequestSchema = z
  .object({
    provider_id: z.uuid(),
    /** NOT constrained to the catalog. A user may shortlist an id no refresh
     *  has ever returned — the same freedom D48/D56 protect by keeping the
     *  model input free text with a `<datalist>` rather than a `<select>`. */
    model_id: z.string().min(1).max(200),
    shortlisted: z.boolean()
  })
  .strict()
export type ModelShortlistSetRequest = z.infer<typeof modelShortlistSetRequestSchema>

/** The provider's shortlist AFTER the write, so the renderer never rebuilds
 *  the list from its own optimistic guess about what it just sent. */
export const modelShortlistSetResponseSchema = z.union([
  z.object({ ok: z.literal(true), shortlist: z.array(z.string().min(1).max(200)) }).strict(),
  z.object({ ok: z.literal(false), reason: z.string() }).strict()
])
export type ModelShortlistSetResponse = z.infer<typeof modelShortlistSetResponseSchema>

/** `credential_id` is a PROFILE ID or null — never a key. Null is the
 *  unauthenticated path, a shipped behaviour rather than a fallback. */
export const modelRefreshRequestSchema = z.object({
  provider_id: z.uuid(),
  credential_id: z.uuid().nullable()
})
export type ModelRefreshRequest = z.infer<typeof modelRefreshRequestSchema>

/** ⚠ COUNTS, NEVER LISTS OF IDS in the failure path, and no field capable of
 *  carrying key material (D42/D55: a telemetry number never ships without its
 *  denominator, enforced by the outbound schema). `.strict()` on both arms. */
export const modelRefreshResponseSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      added: z.number().int().nonnegative(),
      updated: z.number().int().nonnegative(),
      missing: z.number().int().nonnegative(),
      /** Rows the provider sent that failed ingest validation. */
      dropped: z.number().int().nonnegative(),
      refreshedAt: z.string()
    })
    .strict(),
  z.object({ ok: z.literal(false), reason: z.string() }).strict()
])
export type ModelRefreshResponse = z.infer<typeof modelRefreshResponseSchema>

/* ------------------------------------------------------------------ */
/* Task 3a-2: attention capture (Mission Control spec §5.3)            */
/*                                                                     */
/* The honesty shape of this surface is the deliverable:               */
/*  1. There is NO `minutes` FIELD. Minutes are DERIVED by the caller  */
/*     from `samples x tickSeconds`, so it is structurally impossible  */
/*     to obtain a number without having been handed its denominator.  */
/*  2. `byClass`, `expectedSamples` and `coveragePct` are REQUIRED —   */
/*     a denominator-less response fails the outbound .parse in main   */
/*     rather than shipping a bare figure (the D33 clause-3 move,      */
/*     applied to a different kind of dangerous value).                */
/*  3. `estimateBound` states the direction of the bias as a FIELD, so */
/*     a consumer rendering this record cannot render the number       */
/*     without the qualifier travelling beside it.                     */
/* ------------------------------------------------------------------ */

/** Mirrors `AttentionClass` in main/services/attentionCore.ts — the classifier
 *  owns the vocabulary, this is its wire form (the adapters/types.ts pattern). */
export const attentionClassSchema = z.enum(['pane', 'overhead', 'blurred', 'idle', 'locked'])
export type AttentionClassWire = z.infer<typeof attentionClassSchema>

/**
 * attention:report — the renderer's half of §5.3's first clause. Sent only on a
 * real edge (see renderer/src/attention/reporter.ts), never on a timer.
 *
 * `sessionId` is deliberately NOT FK-checked in main, exactly as `view:set`'s
 * `focusedSessionId` is not (F4): a report can legitimately name a session main
 * has just seen exit, and throwing would break a fire-and-forget send.
 */
export const attentionReportSchema = z
  .object({
    /** The active project, or null — nothing to attribute to (table row 12). */
    projectId: z.uuid().nullable(),
    /** The session whose TERMINAL HOST holds DOM focus; null for chrome
     *  (tab bar, header buttons, filmstrip cards, splitter, body). */
    sessionId: z.uuid().nullable(),
    /** ⚠ WIDENED BY 3b-4 TO CARRY `council`, and reporting it as `settings`
     *  would have been the cheaper lie. Every non-workspace view classifies as
     *  `overhead` (attentionCore.classify) — the CLASS would have been right
     *  either way, but this field is a fact about where the user was, and a
     *  telemetry field that is confidently wrong is worse than one that is
     *  coarse. The class vocabulary is untouched, so there is no migration.
     *
     *  ⚠ WIDENED AGAIN FOR `project-settings`, ON EXACTLY THE PRECEDENT ABOVE.
     *  Folding it into `settings` would be the same cheap lie 3b-4 refused:
     *  they are different screens reached different ways, and one of them is a
     *  step in creating a project. `classify()` still returns `overhead` for
     *  everything that is not `workspace`, so no class, no row and no query
     *  changes — only the label on the fact gets more honest.
     *
     *  ⚠ WIDENED A THIRD TIME FOR `day-summary` (D153), on the same precedent
     *  twice over. It is a fifth screen reached its own way, `classify()` still
     *  returns `overhead` for everything that is not `workspace`, and again no
     *  class, row, query or migration moves. */
    view: z.enum(['workspace', 'settings', 'project-settings', 'council', 'day-summary']),
    /**
     * ⚠ D95 / Task 3e-3 — A RESHAPE OF THIS EXISTING PAYLOAD, **NOT A NEW
     * CHANNEL.** `IpcChannel` stays where 3e-4 left it; nothing is added here
     * but a field, and it is declared the way D80 declared its reshape.
     *
     * The project the COUNCIL VIEW is bound to. **Null unless `view` is
     * `'council'` AND a project is selected** — the renderer must not leak an
     * attribution out of a view that is not doing the work, so it is sent as
     * null from every other view rather than being filtered in main.
     *
     * ⚠ IT IS NOT A DUPLICATE OF `projectId` EVEN THOUGH IT EQUALS IT TODAY.
     * `projectId` answers "which project is active"; this answers "is the
     * council working, and for whom" — and `classify()` needs the second
     * question, because a project being active says nothing about whether a
     * deliberation is running for it.
     */
    councilProjectId: z.uuid().nullable(),
    /** Launch dialog / command palette / worktree panel. Checked BEFORE
     *  sessionId in classify(): an overlay can own the keyboard while a
     *  terminal underneath still holds DOM focus. */
    overlayOpen: z.boolean()
  })
  .strict()
export type AttentionReport = z.infer<typeof attentionReportSchema>

export const attentionSummaryRequestSchema = z.object({
  project_id: z.uuid(),
  /** ISO instants bounding the window. Spans OVERLAPPING it are returned. */
  from: z.string().min(1),
  to: z.string().min(1)
})
export type AttentionSummaryRequest = z.infer<typeof attentionSummaryRequestSchema>

/** All five classes are REQUIRED. A histogram missing a class is a histogram
 *  that cannot be checked against the accounting identity, so it does not
 *  parse. `.strict()` for the F-5b reason: zod silently STRIPS unknown keys. */
export const attentionByClassSchema = z
  .object({
    pane: z.number().int().nonnegative(),
    overhead: z.number().int().nonnegative(),
    blurred: z.number().int().nonnegative(),
    idle: z.number().int().nonnegative(),
    locked: z.number().int().nonnegative()
  })
  .strict()
export type AttentionByClass = z.infer<typeof attentionByClassSchema>

/** Per-session pane samples. `samples`, not minutes — same rule, one level in. */
export const attentionSessionSamplesSchema = z
  .object({
    sessionId: z.string().min(1),
    samples: z.number().int().nonnegative()
  })
  .strict()

export const attentionSummaryResponseSchema = z
  .object({
    projectId: z.uuid(),
    from: z.string(),
    to: z.string(),
    /** THE DENOMINATOR — required, and it sums to `samples`. */
    byClass: attentionByClassSchema,
    samples: z.number().int().nonnegative(),
    /** The cadence samples are expressed in. Minutes = samples x this / 60. */
    tickSeconds: z.number().int().positive(),
    /** Ticks the sampler SHOULD have produced across the window the returned
     *  spans envelope; divergence means the app was down or suspended. */
    expectedSamples: z.number().int().nonnegative(),
    missingSamples: z.number().int().nonnegative(),
    coveragePct: z.number().min(0),
    /** Pane samples per session. Overhead is byClass.overhead — it has no
     *  session by construction (§5.3's per-project bucket). */
    bySession: z.array(attentionSessionSamplesSchema),
    /** ALWAYS 'lower-bound'. Attention is undercounted BY CONSTRUCTION: a long
     *  read past 60 s of no input stops counting, and work done outside the
     *  Chorus window is `blurred` rather than attributed. Present as a field so
     *  the qualifier cannot be separated from the number. */
    estimateBound: z.literal('lower-bound')
  })
  .strict()
export type AttentionSummary = z.infer<typeof attentionSummaryResponseSchema>

/* ------------------------------------------------------------------ */
/* Task 3a-3: "% of spend attributed" (D42, Mission Control spec §5.1) */
/*                                                                     */
/* The honesty shape of this surface is, again, the deliverable — and  */
/* D55 binds it exactly as it bound 3a-2:                              */
/*  1. NEITHER RATIO MAY BE READ ALONE. `attributedUsd`,               */
/*     `gatewayTotalUsd`, `attributedDispatches`, `totalDispatches`    */
/*     and `subscriptionDispatches` are ALL REQUIRED, so a             */
/*     denominator-less response fails the outbound .parse in main     */
/*     rather than shipping a bare percentage that will be believed.   */
/*  2. `spendBasis` states the SCOPE of the dollar figure as a FIELD,  */
/*     so a consumer cannot render the number without the qualifier    */
/*     travelling beside it — 3a-2's `estimateBound` move, applied to  */
/*     the other honesty gap D42 names.                                */
/*  3. `tokensSourceBreakdown` says how many rows' tokens were         */
/*     MEASURED versus DERIVED (§8). A derived number labelled as      */
/*     derived is fine; labelled as measured it is not.                */
/*  4. NO FIELD CAN CARRY KEY MATERIAL. There is no key, no hash, no   */
/*     label, no profile id — and `.strict()` means one cannot be      */
/*     added by accident, because zod silently STRIPS unknown keys     */
/*     (F-5b) and a stripped field is an invisible one.                */
/* ------------------------------------------------------------------ */

export const attributionSummaryRequestSchema = z.object({
  /** ISO instants bounding the window. Dispatches STARTED inside it count. */
  from: z.string().min(1),
  to: z.string().min(1)
})
export type AttributionSummaryRequest = z.infer<typeof attributionSummaryRequestSchema>

/** How each row's token numbers were obtained. Sums to the row count that had
 *  any attribution attempted, so the derived share is checkable rather than
 *  asserted. */
export const tokensSourceBreakdownSchema = z
  .object({
    analytics: z.number().int().nonnegative(),
    analyticsDerived: z.number().int().nonnegative(),
    cliLogs: z.number().int().nonnegative(),
    /** Task 5-4: rows metered from the provider's own usage frame (voice
     *  refinement). The F42-safe source. */
    apiUsage: z.number().int().nonnegative(),
    unknown: z.number().int().nonnegative()
  })
  .strict()
export type TokensSourceBreakdown = z.infer<typeof tokensSourceBreakdownSchema>

export const attributionSummaryResponseSchema = z
  .object({
    from: z.string(),
    to: z.string(),
    /** attributedUsd / gatewayTotalUsd. NULL when the total is unknown or
     *  zero — never 0, never NaN. */
    spendPct: z.number().nullable(),
    /** attributedDispatches / totalDispatches. NULL on a zero-dispatch
     *  window — never 0. */
    dispatchPct: z.number().nullable(),
    /* ---- THE DENOMINATORS. All required. ---- */
    attributedUsd: z.number(),
    unattributedUsd: z.number().nullable(),
    gatewayTotalUsd: z.number().nullable(),
    totalDispatches: z.number().int().nonnegative(),
    attributedDispatches: z.number().int().nonnegative(),
    /** ⚠ COUNTED, NEVER PRICED. A flat-rate subscription has no honest
     *  $/token rate, and inventing one would fabricate precisely the number
     *  D42 wants made visible. */
    subscriptionDispatches: z.number().int().nonnegative(),
    tokensSourceBreakdown: tokensSourceBreakdownSchema,
    /** ALWAYS 'gateway-only'. The dollar figure can see OpenRouter spend and
     *  nothing else; subscription work contributes zero dollars BY DESIGN,
     *  not by omission. Present as a field so the qualifier cannot be
     *  separated from the number. */
    spendBasis: z.literal('gateway-only'),
    /** Whether a management key is configured at all. Without one, `spendPct`
     *  is null for a reason a caller would otherwise have to guess at. */
    managementKeyConfigured: z.boolean()
  })
  .strict()
export type AttributionSummary = z.infer<typeof attributionSummaryResponseSchema>

export const writeRequestSchema = z.object({
  sessionId: z.string().min(1),
  data: z.string()
})
export type WriteRequest = z.infer<typeof writeRequestSchema>

export const resizeRequestSchema = z.object({
  sessionId: z.string().min(1),
  cols: z.number().int().min(1).max(1000),
  rows: z.number().int().min(1).max(1000)
})
export type ResizeRequest = z.infer<typeof resizeRequestSchema>

export const killRequestSchema = z.object({
  sessionId: z.string().min(1)
})
export type KillRequest = z.infer<typeof killRequestSchema>

export const sessionDataEventSchema = z.object({
  sessionId: z.string().min(1),
  data: z.string()
})
export type SessionDataEvent = z.infer<typeof sessionDataEventSchema>

export const sessionExitEventSchema = z.object({
  sessionId: z.string().min(1),
  exitCode: z.number().int()
})
export type SessionExitEvent = z.infer<typeof sessionExitEventSchema>

/**
 * What the AGENT says it is doing, as reported by its own hook bus.
 *
 * ⚠ ORTHOGONAL TO `sessionStatusSchema`, NOT AN EXTENSION OF IT, and keeping
 * the two apart is deliberate. `status` is `running | exited` — a fact about
 * the PTY PROCESS, owned by the sessions table and durable across restarts.
 * This is a fact about the CONVERSATION, owned by main's memory and meaningful
 * only while the process lives. Folding them into one enum would have made
 * "the process is alive" and "the agent is mid-turn" the same field, and the
 * first is persisted while the second must never be.
 */
export const agentActivitySchema = z.enum(['working', 'needs-you'])
export type AgentActivity = z.infer<typeof agentActivitySchema>

/**
 * Why a session needs a human. `null` while it is working.
 *
 * ⚠ A SEPARATE FIELD RATHER THAN A WIDENED `agentActivitySchema`, because the
 * two have different consumers: the filmstrip and the project rail read the
 * ACTIVITY and must not gain a fourth case to keep drawing three lights.
 *
 * Six stopping events collapse to three labels: `permission` (blocked on an
 * answer — `PermissionRequest`, `Elicitation`, and `Notification`, which real
 * traffic showed arriving while a permission prompt was still on screen),
 * `stopped` (the turn ended), `notice` (it surfaced something without asking —
 * `TeammateIdle`).
 */
export const needsYouReasonSchema = z.enum(['permission', 'stopped', 'notice'])
export type NeedsYouReason = z.infer<typeof needsYouReasonSchema>

/**
 * When a state began, as `Date.now()` epoch milliseconds in MAIN's clock.
 *
 * ⚠ AN ABSOLUTE INSTANT, NEVER AN AGE, and the difference is the whole reason
 * the escalation ladder can be built on it. An age ("waiting 90s") is only true
 * at the moment it is serialised: it goes stale in flight, it goes stale again
 * while the renderer holds it, and every consumer would need its own refresh to
 * stop lying. An instant never goes stale — the renderer subtracts it from one
 * shared clock and every surface derives the same tier from the same number.
 *
 * Main and the renderer share a process clock here (same machine, same boot),
 * so no skew correction is warranted; a renderer that reads a `since` slightly
 * in its own future simply lands in the youngest tier, which is the calm one.
 */
export const stateSinceSchema = z.number().int().nonnegative()

/** Edge-triggered (main -> renderer): fired only when a session's activity
 *  actually changes, never on every hook event — a working agent emits tool
 *  pairs continuously.
 *
 *  `since` is stamped at the TRANSITION, which is exactly why the event stays
 *  edge-triggered: a level-triggered stream would re-stamp a waiting agent on
 *  every tool pair and its wait would never appear to age. */
export const sessionActivityEventSchema = z.object({
  sessionId: z.string().min(1),
  activity: agentActivitySchema,
  since: stateSinceSchema,
  /** ⚠ NULLABLE AND REQUIRED, NOT OPTIONAL. `z.object` STRIPS unknown keys
   *  rather than rejecting them (D143(f)), so a field the producer sets and the
   *  schema omits vanishes on the wire in silence. Requiring it means a
   *  producer that forgets throws at the `parse()` in `ipc.ts` — loudly, in
   *  main, where it is diagnosable — instead of shipping a reasonless Inbox. */
  reason: needsYouReasonSchema.nullable()
})
export type SessionActivityEvent = z.infer<typeof sessionActivityEventSchema>

/**
 * The renderer's cold-start read of live activity.
 *
 * ⚠ A SEPARATE CHANNEL RATHER THAN A FIELD ON `layout:get`'s session rows, and
 * that is the point. Those rows are the sessions TABLE; activity is main's
 * in-memory state and is deliberately never persisted. Hanging it off the
 * layout response would have reshaped a payload (the thing D80 admitted once,
 * bounded, and told the next task not to repeat) AND put a volatile fact in
 * the shape everything treats as durable. Without this channel a renderer
 * reload would show a stale green for an agent that is in fact waiting.
 */
export const sessionActivityListResponseSchema = z.object({
  activities: z.array(sessionActivityEventSchema)
})
export type SessionActivityListResponse = z.infer<typeof sessionActivityListResponseSchema>

/* ------------------------------------------------------------------ */
/* Context-window usage (v16): the progress ring                        */
/* ------------------------------------------------------------------ */

/**
 * WHERE a context reading came from. It travels with the number because the two
 * sources are not equally precise and the UI has to be able to say so.
 *
 * ⚠ THIS IS THE FIELD THAT KEEPS THE RING HONEST, so it is not decoration.
 * `claude-transcript` is EXACT — the same three usage counters Claude Code
 * itself divides by the same window (verified against the installed 2.1.225
 * bundle; see contextUsageCore). `codex-footer` is the number CODEX PRINTS,
 * scraped from its own TUI, so it is exact for Codex but arrives only as a
 * whole percent with no token counts behind it. A tooltip that claimed
 * "113,081 / 200,000" for a Codex session would be inventing two numbers out of
 * one, which is the D76 failure in miniature.
 */
export const contextSourceSchema = z.enum(['claude-transcript', 'codex-footer'])
export type ContextSource = z.infer<typeof contextSourceSchema>

/**
 * One session's context-window usage.
 *
 * ⚠ `usedPercent` IS THE ONLY REQUIRED NUMBER, AND THE TOKEN FIELDS ARE
 * NULLABLE, BECAUSE THE TWO SOURCES MEET ONLY AT THE PERCENT. Claude gives
 * tokens and a window, from which a percent is derived; Codex gives a percent
 * and nothing else. Requiring tokens would have forced the Codex path to
 * back-compute them from an assumed window — a fabricated denominator dressed
 * as a measurement. Required-nullable rather than optional, the
 * `sessionInfoSchema.title` discipline: every producer states its answer,
 * including when the answer is "I do not have this".
 */
export const sessionContextUsageSchema = z.object({
  /** 0–100, whole numbers. Clamped by the producer, re-bounded here. */
  usedPercent: z.number().int().min(0).max(100),
  usedTokens: z.number().int().nonnegative().nullable(),
  windowTokens: z.number().int().positive().nullable(),
  source: contextSourceSchema
})
export type SessionContextUsage = z.infer<typeof sessionContextUsageSchema>

/** Edge-triggered (main -> renderer), on the PERCENT rather than on the raw
 *  token count: Claude re-reads its transcript on every tool call, and a ring
 *  cannot render the difference between 41.2% and 41.3%. */
export const sessionContextEventSchema = z.object({
  sessionId: z.string().min(1),
  usage: sessionContextUsageSchema
})
export type SessionContextEvent = z.infer<typeof sessionContextEventSchema>

/** The renderer's cold-start read — same reasoning as
 *  `sessionActivityListResponseSchema`, and a separate channel for the same
 *  reason: this is main's in-memory state, never a column on the sessions row. */
export const sessionContextListResponseSchema = z.object({
  contexts: z.array(sessionContextEventSchema)
})
export type SessionContextListResponse = z.infer<typeof sessionContextListResponseSchema>

/* ------------------------------------------------------------------ */
/* The memory-usage counters (Task 6b-1 / D168, amended by D173)        */
/* ------------------------------------------------------------------ */

/**
 * One session's use of the project's memory graph (D168).
 *
 * ⚠ NO TOOL NAME IS IN THIS SHAPE AND NONE MAY EVER BE ADDED. The producer
 * (`agentEvents.ts`) compares names against fixed sets and drops them; this
 * schema is the wire boundary where that promise becomes checkable by a
 * reviewer reading one object — there is no `string` field here at all.
 *
 * ⚠ ALL THREE FLAGS ARE REQUIRED, NOT OPTIONAL — the `sessionActivityEvent.reason`
 * discipline above: `z.object` STRIPS unknown keys, so a field the producer
 * sets and the schema omits vanishes on the wire in silence, and a producer
 * that forgets a required one throws at the `parse()` in main, where it is
 * diagnosable. ⚠ FOR `readInconclusive` THE STAKES ARE HIGHER THAN THE GENERAL
 * RULE: a silently stripped `readInconclusive` leaves `readBeforeExplore ===
 * false` with no third state, which reads downstream as an ordinary not-passed
 * — i.e. it re-creates exactly the silent verdict D173 removed.
 *
 * ⚠ `reads` IS A SUCCESSFUL-RESULT COUNT, not an attempt count (a failed call
 * fires `PostToolUseFailure`, measured 2026-08-19). `writes` is TOOL-LEVEL: a
 * successful write call is not yet a sourced memory, and the validator is the
 * write-side truth. The names stay short because the SENTENCE carries the
 * qualification (`shared/provenance.ts`), but a reader of this schema is told
 * here.
 */
export const sessionMemoryUsageSchema = z.object({
  reads: z.number().int().nonnegative(),
  writes: z.number().int().nonnegative(),
  /** A completed memory read preceded the first KNOWN exploration tool, and no
   *  unknown tool preceded the read. The milestone's first clause. */
  readBeforeExplore: z.boolean(),
  /** D173: an unknown tool ran before the first read — the ordering result has
   *  no answer. Mutually exclusive with `readBeforeExplore`. */
  readInconclusive: z.boolean(),
  /** D173: DIAGNOSTIC. A shell call completed before the first memory read.
   *  ⚠ Never an input to pass/fail — do not let a consumer combine it. */
  shellFirst: z.boolean()
})
export type SessionMemoryUsage = z.infer<typeof sessionMemoryUsageSchema>

/** Edge-triggered (main -> renderer) on the five facts above, exactly as
 *  `sessionContextEventSchema` is on the whole percent. */
export const sessionMemoryEventSchema = z.object({
  sessionId: z.string().min(1),
  usage: sessionMemoryUsageSchema
})
export type SessionMemoryEvent = z.infer<typeof sessionMemoryEventSchema>

/**
 * The project's memory-usage roll-up, carried on BOTH branches of
 * `memory:validate` (D168).
 *
 * ⚠ ON BOTH BRANCHES, AND THAT IS THE POINT RATHER THAN AN OVERSIGHT. The
 * provenance ratio needs the graph; these numbers are a local SQLite read that
 * is equally true with the container stopped. Hanging them off `ok: true`
 * would let a stopped Docker container erase a number that has nothing to do
 * with Docker — and the Memory section would show nothing where it should show
 * "0 successful memory reads · 0 memory writes across 4 Claude Code sessions
 * observed since …", which is a finding.
 *
 * ⚠ `text` AND `breakdownText` ARE BUILT IN MAIN by the tested pure core
 * (`shared/provenance.ts`), exactly as the ratio's `text` beside it is. No
 * renderer assembles these sentences; this repo has no `.vue` tests at all.
 */
export const memoryUsageSummarySchema = z.object({
  reads: z.number().int().nonnegative(),
  writes: z.number().int().nonnegative(),
  /** ⚠ THE DENOMINATOR. Never sent without it (D55) — and it is a count of
   *  CLAUDE CODE sessions in the SQL as well as in the sentence: the accessor
   *  filters `agent = 'claude'`, because a pane Chorus cannot instrument must
   *  not be counted as measured non-use (D173 Q2). */
  sessions: z.number().int().nonnegative(),
  /** ISO-8601, or null when the counters have never been installed. */
  since: z.string().nullable(),
  /** The breakdown, all three over the SAME `sessions` denominator above.
   *  ⚠ `readFirst` is a PASS count and `inconclusive` is NOT its complement —
   *  `readFirst + inconclusive` may be less than `sessions`, and no consumer
   *  may compute failures as `sessions - readFirst`. */
  readFirst: z.number().int().nonnegative(),
  inconclusive: z.number().int().nonnegative(),
  shellFirst: z.number().int().nonnegative(),
  /** `memoryUsageLine(...)` — the D173 sentence, denominator included. */
  text: z.string(),
  /** The breakdown sentence, or null when there is nothing to show. Built by
   *  the same tested core as `text`. */
  breakdownText: z.string().nullable()
})
export type MemoryUsageSummary = z.infer<typeof memoryUsageSummarySchema>

/* ------------------------------------------------------------------ */
/* The agent lock (v16)                                                 */
/* ------------------------------------------------------------------ */

/**
 * Lock or unlock one agent.
 *
 * ⚠ `pin` IS OPTIONAL ON THE WIRE AND MANDATORY IN MAIN WHEN ONE IS SET, and the
 * asymmetry is deliberate rather than sloppy. Three of the four calls this
 * schema serves legitimately carry no PIN — locking (never guarded), unlocking
 * when no PIN has been configured, and the first unlock attempt from a renderer
 * that has not yet prompted. Making it required would force the renderer to send
 * a placeholder for those, and a placeholder in a credential-shaped field is how
 * an empty string ends up being accepted as a PIN somewhere downstream. Main
 * decides whether the field was needed; the schema only says it may be absent.
 *
 * ⚠ AND IT IS WRITE-ONLY INBOUND (D33 clause 3, in its small shape): the
 * plaintext arrives as a parameter, is verified, and is never echoed, logged,
 * stored, or returned.
 */
export const sessionSetLockedRequestSchema = z.object({
  sessionId: z.string().min(1),
  locked: z.boolean(),
  pin: z.string().min(1).max(PIN_MAX_LENGTH).optional()
})
export type SessionSetLockedRequest = z.infer<typeof sessionSetLockedRequestSchema>

/**
 * ⚠ A REFUSAL IS `{ok:false, reason}`, NOT A THROW, AND THAT IS THE WHOLE POINT
 * OF THIS SHAPE. A wrong PIN is an ORDINARY OUTCOME of a correct call — the user
 * fat-fingered four digits — and the settings-store convention already in this
 * file is that expected refusals come back as data the caller renders inline
 * (`providerCreate`, `worktreeRemove`). Throwing would surface a mistyped PIN as
 * an unhandled rejection in the console and give the pane nothing to display.
 *
 * `pinRequired` is what lets the renderer ask ONLY when asking is warranted,
 * without ever reading whether a PIN exists first: the first unlock click sends
 * no PIN, and main answers "I need one" if and only if one is configured.
 */
export const sessionSetLockedResponseSchema = z.union([
  z.object({ ok: z.literal(true), locked: z.boolean() }),
  z.object({
    ok: z.literal(false),
    reason: z.string(),
    /** True when the refusal is solvable by typing the PIN. */
    pinRequired: z.boolean()
  })
])
export type SessionSetLockedResponse = z.infer<typeof sessionSetLockedResponseSchema>

/** WHETHER a PIN exists — never the PIN, never its digest, never its length. */
export const agentLockPinStatusSchema = z.object({ hasPin: z.boolean() })
export type AgentLockPinStatus = z.infer<typeof agentLockPinStatusSchema>

/** Set or change the PIN. Deliberately takes NO current-PIN field: the product
 *  decision (Matthew, this session) is that the PIN is settable and clearable
 *  with no other security, and a confirmation field that guarded nothing would
 *  only imply otherwise. See agentLockCore's header. */
export const agentLockPinSetRequestSchema = z.object({
  pin: z.string().min(1).max(PIN_MAX_LENGTH)
})
export type AgentLockPinSetRequest = z.infer<typeof agentLockPinSetRequestSchema>

/** Shared by pin-set and pin-clear. Refusal (a PIN that fails validatePin) is
 *  data, matching sessionSetLockedResponseSchema directly above. */
export const agentLockPinMutateResponseSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), reason: z.string() })
])
export type AgentLockPinMutateResponse = z.infer<typeof agentLockPinMutateResponseSchema>

/**
 * The two states a PROJECT can raise to the rail. Deliberately NOT the four
 * session states: `running` and `done` are the absence of a signal, not a
 * signal, and a rail that lit green for every healthy project would spend its
 * salience on the case that needs none. Only what asks to be clicked appears.
 */
export const projectAttentionStateSchema = z.enum(['needs-you', 'error'])
export type ProjectAttentionState = z.infer<typeof projectAttentionStateSchema>

/**
 * One project's roll-up of its sessions' states.
 *
 * ⚠ COMPUTED IN MAIN, NOT IN THE RENDERER, and this channel exists because the
 * renderer structurally CANNOT compute it. Session rows reach the renderer only
 * through `layout:get(activeId)` — there is no `session:list` — so the renderer
 * holds sessions for the ACTIVE PROJECT ONLY. Every other project is an opaque
 * `sessionCount` integer on `project:list`. Rolling up in the renderer would
 * therefore have needed a cross-project session feed, which is a far larger
 * payload and hands the renderer a table it has no other reason to own (the
 * "sessions live in main" rule). Main already holds both halves — the sessions
 * table and the in-memory activity map — so the join happens where the facts
 * already are and only the two-field verdict crosses the bridge.
 *
 * `since` is the instant of the OLDEST contributing session's transition, not
 * the newest: a project that has had someone waiting 20 minutes must not have
 * its escalation reset by a second agent stopping just now.
 *
 * ⚠ `since` IS NULLABLE, AND NULL MEANS "OLDER THAN THIS APP RUN" rather than
 * "unknown". Activity lives only in main's memory and exit instants are not a
 * column, so a project lit by a session that failed before the last restart has
 * no honest instant to report. Null is rendered at the CALM end of the ladder,
 * which is the truthful reading: you were not watching when it happened, so it
 * has no claim on your attention now. The alternative — substituting app-start
 * time — would make every boot look like a fresh emergency.
 *
 * The two counts are carried so the row's tooltip can name what the single
 * light cannot: a project with both waiting and failed agents shows ONE amber
 * marker (see `state` precedence in `attentionRollup.ts`) and says "2 waiting ·
 * 1 error" in words.
 */
export const projectAttentionSchema = z.object({
  projectId: z.string().min(1),
  state: projectAttentionStateSchema,
  since: stateSinceSchema.nullable(),
  needsYou: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative()
})
export type ProjectAttention = z.infer<typeof projectAttentionSchema>

/**
 * The whole rail's worth of lights, pushed on change and readable cold.
 *
 * ⚠ A COMPLETE SNAPSHOT EVERY TIME, NOT A PER-PROJECT DELTA, and the whole-list
 * shape is what makes clearing correct. A project whose last waiting agent was
 * answered has NO entry — it is absent, not present-with-a-null — and the only
 * way a delta could say that is by inventing a "cleared" message that every
 * consumer would have to handle as a second code path. Replacing the map
 * wholesale makes absence mean exactly one thing, in both directions. The list
 * is bounded by the project count (tens, not thousands) and only ever contains
 * projects that are actually lit, so the full payload stays smaller than the
 * delta protocol it replaces.
 */
export const projectAttentionListSchema = z.object({
  projects: z.array(projectAttentionSchema)
})
export type ProjectAttentionList = z.infer<typeof projectAttentionListSchema>

/**
 * ⚠ `refresh` IS OPTIONAL SO THIS STAYS ONE CHANNEL RATHER THAN TWO. A
 * `cli:redetect` sibling would have taken the map to 65 to express a boolean,
 * and the two would have had identical responses and identical handlers. The
 * default — absent, meaning "the memo is fine" — is what every existing caller
 * already sends by passing `{}`, so nothing needed changing to keep working.
 *
 * True means re-probe the machine now: the launch dialog sends it on open,
 * because a version upgraded in a terminal since startup makes the memo not just
 * stale but wrong about what a launch would actually run.
 */
export const cliDetectRequestSchema = z.object({ refresh: z.boolean().optional() }).strict()
export type CliDetectRequest = z.infer<typeof cliDetectRequestSchema>

export const detectedCliSchema = z.object({
  name: z.string().min(1),
  found: z.boolean(),
  /** resolved location on disk (the .exe or the npm shim), null when not found */
  path: z.string().nullable(),
  /** first line of `<tool> --version`; 'unknown' when the tool exists but the probe failed */
  version: z.string().nullable(),
  /** D34(f): adapter-supplied label for agent entries; null for plain tool
   *  probes (git/docker/node). Required-nullable so a producer that forgets it
   *  fails the outbound parse (the 1b-1 `title` discipline). */
  displayName: z.string().nullable(),
  /** D34(f): the AgentKind when this row IS an agent; null when it is a plain
   *  tool. A TYPED value rather than the `agent: boolean` flag D34(f) sketched
   *  — the renderer needs an AgentKind for the launch payload, and a boolean
   *  would force a cast at exactly the boundary this refactor exists to type. */
  agentKind: agentKindSchema.nullable()
})
export type DetectedCli = z.infer<typeof detectedCliSchema>

export const cliDetectResponseSchema = z.array(detectedCliSchema)
export type CliDetectResponse = z.infer<typeof cliDetectResponseSchema>

/* ------------------------------------------------------------------ */
/* Task 3-3: adapter declarations on the wire (D34)                    */
/*                                                                     */
/* cli:detect stays the INSTALLATION probe (found / path / version,    */
/* plus D34(f) display data). adapter:list is the STATIC DECLARATION   */
/* (id, displayName, executionMode, auth methods, capabilities) — a    */
/* coordinator addition beyond D34(f), so Task 3-4's provider form     */
/* renders auth methods from the wire instead of hardcoding them in a  */
/* Vue file (the coupling D34(f) exists to remove, one layer up).      */
/* These schemas mirror src/main/adapters/types.ts; descriptors use    */
/* required-nullable for the "declared but absent" case, matching the  */
/* interface's `| null`.                                               */
/* ------------------------------------------------------------------ */

export const descriptorModeSchema = z.enum(['static', 'dynamic'])
export type DescriptorModeWire = z.infer<typeof descriptorModeSchema>

/**
 * Task 3a-4 — ⚠ `cliFlag: string` was REPLACED by `args: string[]`, not
 * supplemented. A single string cannot express what either installed CLI
 * needs: claude 2.1.218 wants `['--effort', 'high']` and codex 0.145.0 wants
 * `['-c', 'model_reasoning_effort="high"']`. A whitespace split breaks the
 * moment a value needs quoting — and codex's values ARE TOML-quoted — while
 * the alternative, a per-adapter `switch` in `buildLaunch`, would put the
 * mapping in TWO homes in the task whose headline output is a one-home ruling.
 *
 * The replacement was free at execution: grep-verified 2026-07-25, `cliFlag`
 * had ZERO producers and zero real consumers — it appeared only in the type,
 * this schema, and two test fixtures. (`ResumeDescriptor.cliFlag` below is a
 * DIFFERENT field on a different descriptor and is out of scope.)
 *
 * `id` is tightened to the four-level vocabulary, which is what makes the
 * descriptor itself the mapping table.
 */
export const effortOptionSchema = z.object({
  id: effortLevelSchema,
  label: z.string(),
  /** The EXACT argv tokens this level contributes. A flag+value pair and a
   *  `-c key=value` override are the same thing at this level of abstraction,
   *  which is why this is a token ARRAY and not a string. */
  args: z.array(z.string()).min(1)
})
export type EffortOptionWire = z.infer<typeof effortOptionSchema>

/**
 * ⚠ `defaultLevelId` IS THE ADAPTER SAYING WHICH RUNG IT STARTS ON, AND IT IS
 * OPTIONAL BECAUSE MOST ADAPTERS HAVE NOTHING TO SAY (2026-08-14).
 *
 * Before it existed, "which level is preselected" had no home at all: the
 * launch dialog started every control empty, so every launch that nobody
 * clicked through emitted no flag and got the CLI's own default. That is a fine
 * answer for an app with no opinion, and Chorus now has one — but the opinion
 * belongs BESIDE THE MAPPING IT DEFAULTS TO, not in the renderer. A renderer
 * that hardcoded `'deep'` would be a second home for a fact the descriptor
 * already owns, and it would be wrong for every adapter but one.
 *
 * ⚠ AND IT IS APPLIED IN `buildLaunch`, NOT ONLY IN THE DIALOG. The dialog is
 * one of four launch paths (restore, `session:restart`, profile relaunch are
 * the others) and it is the only one a person is looking at. A default that
 * lived in the dialog would silently evaporate the first time the app restarted
 * and restored the session — which for a PERMISSION mode is a downgrade the
 * user never asked for and would not be told about.
 */
export const effortDescriptorSchema = z.object({
  mode: descriptorModeSchema,
  levels: z.array(effortOptionSchema),
  /** Absent = no opinion; the CLI's own default stands. Must name one of
   *  `levels` — asserted per-adapter in `adapters.test.ts`, not by this schema,
   *  because a cross-field rule here would fire on the wire rather than at the
   *  declaration site where it can be fixed. */
  defaultLevelId: effortLevelSchema.optional()
})

/** The permission-mode twin of `effortOptionSchema`. Same shape, same reasons:
 *  the descriptor IS the mapping table, and a token ARRAY (not a string) is
 *  what lets an adapter whose CLI wants `-c key=value` join later without the
 *  type changing. */
export const permissionModeOptionSchema = z.object({
  id: permissionModeSchema,
  label: z.string(),
  args: z.array(z.string()).min(1)
})
export type PermissionModeOptionWire = z.infer<typeof permissionModeOptionSchema>

export const permissionModeDescriptorSchema = z.object({
  mode: descriptorModeSchema,
  levels: z.array(permissionModeOptionSchema),
  defaultLevelId: permissionModeSchema.optional()
})

/**
 * ⚠ A DISCRIMINATED UNION, BECAUSE `McpDescriptor` IS ONE AND THE TWO DECLARE
 * THE SAME FACT. This was a flat object requiring `format`, `location` and
 * `configPath` unconditionally, while `adapters/types.ts` had already split the
 * type into a `launch-args` arm that HAS none of the three — so codex's
 * descriptor (`{ mode: 'static', mechanism: 'launch-args' }`) could not satisfy
 * it, `adapter:list`'s OUTBOUND parse threw, and because one bad element rejects
 * the whole array, EVERY adapter vanished from the provider form's dropdown
 * rather than only the offending one. The form then offered no adapter at all
 * and no provider could be created.
 *
 * ⚠ AND THE SCHEMA NEVER CARRIED `mechanism` AT ALL, which is how the two got
 * to disagree in silence: the discriminant that makes the type a union was the
 * one field the wire could not see. Same failure class as F25 in
 * `adapters/registry.ts` — two declarations of one fact, widened separately —
 * and `ipc.test.ts` now parses the REAL registry through
 * `adapterListResponseSchema` so a descriptor that main can build but the wire
 * cannot carry is a test failure rather than an empty dropdown.
 */
export const mcpDescriptorSchema = z.discriminatedUnion('mechanism', [
  /** codex: servers are named by launch ARGUMENTS. There is no file, so there
   *  is no format and no path, and the schema must not demand three fields that
   *  cannot exist for this mechanism. */
  z.object({
    mode: descriptorModeSchema,
    mechanism: z.literal('launch-args')
  }),
  z.object({
    mode: descriptorModeSchema,
    mechanism: z.enum(['project-file', 'env-named-file']),
    format: z.enum(['json', 'toml', 'yaml']),
    location: z.enum(['project', 'home', 'custom']),
    /** ⚠ NON-NULLABLE here, matching `McpDescriptor`: it was `string | null`
     *  only because `launch-args` had nowhere else to live. A file adapter that
     *  cannot name its file is a bug, and the schema should say so. */
    configPath: z.string(),
    /**
     * ⚠ WHICH CLI'S JSON SCHEMA THE WRITTEN BYTES MUST SATISFY (Task 6-5).
     * `format` says the file is JSON and says nothing about the SHAPE, and 6-1
     * Finding 1 measured how far apart the two shapes are — `mcpServers` vs
     * `mcp`, a command string + args array vs one command array, `env` vs
     * `environment`. It is on the WIRE because zod strips unknown keys
     * silently: without this line the renderer would receive a descriptor whose
     * dialect had vanished, and a UI that says which file it writes for which
     * agent would be reading a field that is not there.
     */
    dialect: z.enum(['claude', 'opencode']),
    /** `env-named-file` only — the env var that names the file (opencode's
     *  `OPENCODE_CONFIG`). */
    pathEnvVar: z.string().optional()
  })
])

export const hooksDescriptorSchema = z.object({
  mode: descriptorModeSchema,
  mechanism: z.enum(['http_listener', 'script', 'file_watch'])
})

/**
 * Task 6a-1 / D148: how an adapter is given session-level instructions.
 *
 * ⚠ THIS IS ON THE WIRE BECAUSE `AdapterDescriptor` IS INFERRED FROM THIS
 * SCHEMA — `noHarness` declares its capabilities against the wire type, so the
 * field could not be omitted here even if nothing in the renderer read it yet.
 * And `z.object` STRIPS unknown keys silently, so a main-side capability with no
 * schema entry would simply vanish crossing the bridge, with no error anywhere
 * (the failure D143(f) names for `mode`).
 */
export const instructionsDescriptorSchema = z.object({
  mode: descriptorModeSchema,
  mechanism: z.enum(['append-system-prompt-file', 'config-override'])
})

export const resumeDescriptorSchema = z.object({
  // ⚠ DO NOT REMOVE `mode`. Three CR-4a.0 members flagged it as surplus beside
  // `kind`; it is a VALIDATED WIRE FIELD, and removing it would be a breaking
  // schema change made for tidiness. (D143(f).)
  mode: descriptorModeSchema,
  /** Phase 4a / D139: which mechanism obtains this CLI's conversation id.
   *  'assigned' — the CLI accepts an id Chorus mints (claude --session-id).
   *  'discovered' — the CLI names its own and Chorus must find out (codex).
   *  ⚠ ADDED HERE AS WELL AS IN types.ts BECAUSE z.object STRIPS UNKNOWN KEYS
   *  RATHER THAN REJECTING THEM: a `kind` on the runtime object and not on this
   *  schema would vanish on the wire silently, with no error anywhere. No
   *  renderer reads sessionResume today (grep-verified) — the schema moves for
   *  honesty, per D1. `IpcChannel` stays 86; no channel is added. (D143(f).) */
  kind: z.enum(['assigned', 'discovered']),
  cliFlag: z.string().nullable()
})

export const agentCapabilitiesSchema = z.object({
  interactiveTerminal: z.boolean(),
  worktreeSafe: z.boolean(),
  skills: z.boolean(),
  subscriptionLogin: z.boolean(),
  apiKey: z.boolean(),
  reasoningEffort: effortDescriptorSchema.nullable(),
  /** Null = this adapter's permission vocabulary has not been MEASURED against
   *  its CLI, which is a different statement from "it has none" and is the only
   *  one Chorus is entitled to make without running `--help`. The control is
   *  then absent, not disabled (PLAN §4). */
  permissionMode: permissionModeDescriptorSchema.nullable(),
  sessionResume: resumeDescriptorSchema.nullable(),
  mcp: mcpDescriptorSchema.nullable(),
  hooks: hooksDescriptorSchema.nullable(),
  instructions: instructionsDescriptorSchema.nullable()
})
export type AgentCapabilitiesWire = z.infer<typeof agentCapabilitiesSchema>

export const authMethodDefinitionSchema = z.object({
  type: z.enum(['subscription', 'api_key']),
  label: z.string(),
  /** The env var the api_key method injects into (the DEFAULT — a provider's
   *  env_var_name overrides it, D34(e)); null for subscription methods. */
  requiredEnvVar: z.string().nullable(),
  helpUrl: z.string().nullable()
})
export type AuthMethodDefinitionWire = z.infer<typeof authMethodDefinitionSchema>

/** One adapter's static declaration. NO installation state (that is
 *  cli:detect's job) and no secret-adjacent field anywhere. */
export const adapterDescriptorSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  executionMode: z.enum(['pty', 'api']),
  authMethods: z.array(authMethodDefinitionSchema),
  capabilities: agentCapabilitiesSchema
})
export type AdapterDescriptor = z.infer<typeof adapterDescriptorSchema>

export const adapterListRequestSchema = z.object({})
export type AdapterListRequest = z.infer<typeof adapterListRequestSchema>

export const adapterListResponseSchema = z.array(adapterDescriptorSchema)
export type AdapterListResponse = z.infer<typeof adapterListResponseSchema>

export const layoutGetRequestSchema = z.object({ project_id: z.uuid() })
export type LayoutGetRequest = z.infer<typeof layoutGetRequestSchema>

/**
 * Persisted pane layout: an owned binary split tree (D9 / CR-1.2). Leaves
 * bind a stable sessions-row id, never an agent kind. The discriminated union
 * on `type` stops an internal node masquerading as a leaf; the tuple enforces
 * exactly-2 children at the schema boundary; ratios are bounded on read.
 */
const layoutLeafSchema = z.object({
  type: z.literal('leaf'),
  sessionId: z.string().min(1)
})

export const layoutNodeSchema: z.ZodType<LayoutNode> = z.lazy(() =>
  z.discriminatedUnion('type', [
    layoutLeafSchema,
    z.object({
      type: z.enum(['row', 'column']),
      ratio: z.number().min(0.05).max(0.95),
      children: z.tuple([layoutNodeSchema, layoutNodeSchema])
    })
  ])
)

export const layoutJsonSchema = z.object({
  version: z.literal(1),
  root: layoutNodeSchema
})

/** layout:set payload — the target project plus the full layout tree, or a
 *  null tree to clear it (Task 1-4: empty layouts are legal; main deletes the
 *  pane_layouts row — the row's ABSENCE is the empty signal, never a null-root
 *  wrapper). Parsed in main only (D1); ratios are re-clamped there before
 *  persist (council D9). */
export const layoutSetRequestSchema = z.object({
  project_id: z.uuid(),
  layout: layoutJsonSchema.nullable()
})
export type LayoutSetRequest = z.infer<typeof layoutSetRequestSchema>

export const sessionInfoSchema = z.object({
  id: z.string().min(1),
  agent: agentKindSchema,
  status: sessionStatusSchema,
  /** 1b-1: required-nullable, same discipline as attachResponseSchema.title —
   *  every view reads the title from the same round-trip. */
  title: z.string().nullable(),
  /** 1b-2: SessionRow.created_at (ISO text) passes through so filmstrip cards
   *  can compute elapsed-since-launch. */
  createdAt: z.string(),
  /** 1b-2: exit code for the card status dot (exited-ok vs exited-error) —
   *  cards never attach, so this row is their ONLY status source. */
  exitCode: z.number().int().nullable(),
  /** 2-2: worktree branch for card/pane labels, null for current-tree
   *  sessions. Required-nullable, same discipline as title. */
  branch: z.string().nullable(),
  /** The authored name + note (see attachResponseSchema for why these are not
   *  `title`). The filmstrip card's identity line is built from `name`; the
   *  note is its own line, omitted entirely when null. */
  name: z.string().nullable(),
  description: z.string().nullable(),
  /** v16: the padlock on the filmstrip card. Same boolean-not-timestamp ruling
   *  as `attachResponseSchema.locked` — see the note there. A card never
   *  attaches (that is this schema's whole reason for existing), so this row is
   *  its only source for the lock, exactly as `exitCode` is for its status. */
  locked: z.boolean()
})
export type SessionInfo = z.infer<typeof sessionInfoSchema>

export const layoutGetResponseSchema = z.object({
  /** null when the project has no pane_layouts row (fresh DB or last pane
   *  closed): the renderer shows the empty state (Task 1-4). */
  layout: layoutJsonSchema.nullable(),
  sessions: z.array(sessionInfoSchema)
})
export type LayoutGetResponse = z.infer<typeof layoutGetResponseSchema>

/* ------------------------------------------------------------------ */
/* Task 1b-2: per-project view state (D20)                             */
/* ------------------------------------------------------------------ */

export const viewModeSchema = z.enum(['filmstrip', 'grid'])
export type ViewMode = z.infer<typeof viewModeSchema>

/** Per-project workspace view state (D20): which renderer is active and which
 *  session the filmstrip focuses. `focusedSessionId` is a nullable string
 *  ONLY — never FK-checked against sessions. It legitimately outlives its
 *  session (F4); views resolve staleness by falling back to the first leaf.
 *  Schema validity ≠ liveness. */
export const viewStateSchema = z.object({
  mode: viewModeSchema,
  focusedSessionId: z.string().nullable()
})
export type ViewState = z.infer<typeof viewStateSchema>

export const viewGetRequestSchema = z.object({ project_id: z.uuid() })
export type ViewGetRequest = z.infer<typeof viewGetRequestSchema>

export const viewSetRequestSchema = z.object({
  project_id: z.uuid(),
  state: viewStateSchema
})
export type ViewSetRequest = z.infer<typeof viewSetRequestSchema>

/* ------------------------------------------------------------------ */
/* Task 1-5: project tabs + D16 restore contract                       */
/* ------------------------------------------------------------------ */

/**
 * How retired a project is (migration v15 / D120). ONE ORDERED VOCABULARY, NOT
 * TWO BOOLEANS: `is_hidden` + `is_archived` expresses four states, one of which
 * (hidden-and-archived) is nonsense, and every read site would have to decide
 * for itself what that meant.
 *
 * ⚠ IT LIVES HERE, ON THE BOUNDARY, BECAUSE THERE IS NO `CHECK` CONSTRAINT ON
 * THE COLUMN. That is v13's ruling applied again — a limit belongs where it can
 * be reported, not where it surfaces as a failed write — which makes this enum
 * the actual authority on the vocabulary rather than a copy of one. Both the
 * main-process storage layer and the renderer read it from here.
 */
export const PROJECT_STATUSES = ['active', 'hidden', 'archived'] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

/**
 * The two statuses that take a project OUT of the rail — the ones the foot-of-
 * rail disclosure counts, and the only ones a project can be REACTIVATED FROM.
 *
 * ⚠ IT IS A NARROWING OF `ProjectStatus`, NOT A SECOND VOCABULARY, and it earns
 * its place by making an unreachable state unrepresentable. `reactivated_from`
 * was originally typed with the full enum, which admitted `'active'` — a value
 * that cannot occur, because reactivating a project that is already active is
 * precisely the case that reports `null`. That is the same rule `status` and
 * `color_seed` follow one screen down (nullable would encode a state that
 * cannot be reached); it was applied to the row and missed on this field, and
 * the compiler found it the moment a consumer tried to switch on the value.
 */
export const PROJECT_TUCKED_STATUSES = ['hidden', 'archived'] as const
export type TuckedProjectStatus = (typeof PROJECT_TUCKED_STATUSES)[number]

/** A projects-table row as it crosses IPC (snake_case root_path, matching the
 *  DB column; main maps its internal ProjectRecord). */
export const projectSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  root_path: z.string(),
  /**
   * The user's chosen spine colour, or null when they have never chosen one.
   *
   * ⚠ NULLABLE ON THE WIRE ON PURPOSE, and the renderer must keep honouring it.
   * Before migration v13 the rail derived every spine colour from the project's
   * LIST INDEX and stored nothing; null is how a pre-v13 row says "I still want
   * that", so collapsing this to a non-null column with a back-filled default
   * would silently repaint every project that already exists.
   */
  color: z.string().regex(PROJECT_COLOR_PATTERN).nullable(),
  /** Free-text notes. Null when never written. Rendered ONLY on the project
   *  settings screen — the rail deliberately has no room for it. */
  description: z.string().nullable(),
  /**
   * How retired this project is (migration v15 / D120): `active` is in the
   * rail and launchable, `hidden` is cosmetically tucked away with its sessions
   * still running, `archived` is stopped and unlaunchable but fully readable.
   *
   * ⚠ REQUIRED AND NON-NULLABLE — A DELIBERATE DEVIATION FROM THE
   * REQUIRED-NULLABLE HOUSE RULE `color` FOLLOWS TWO FIELDS ABOVE. `color` is
   * nullable because NULL means something there ("never chosen"). After v15
   * every row has a status and a seed, so nullable would encode a state that
   * cannot be reached — and every renderer would have to invent its own
   * fallback for a value that is never absent.
   */
  status: z.enum(PROJECT_STATUSES),
  /**
   * The seed for the pre-v13 colour cycle — fixed at migration time and never
   * moved afterwards.
   *
   * ⚠ THIS IS WHY IT IS ON THE WIRE AT ALL. The rail used to pass its LOOP
   * INDEX to `chipColorValue`, which was correct only while the rail rendered
   * every project in creation order. The moment it partitions (hidden and
   * archived out of the main list) or reorders, that index is a position in a
   * sub-array and every project with `color === null` repaints. The seed
   * travels with the row instead.
   *
   * ⚠ AND `sort_order` DOES NOT. Main returns the list already ordered; the
   * renderer sends the order it wants (`project:reorder`). Shipping the number
   * would create a second authority on position.
   */
  color_seed: z.number().int().nonnegative()
})
export type Project = z.infer<typeof projectSchema>

/** project:add — the renderer sends nothing; main runs the native directory
 *  picker (D3: dialog.showOpenDialog never leaves the main process). */
export const projectAddRequestSchema = z.object({})
export type ProjectAddRequest = z.infer<typeof projectAddRequestSchema>

/**
 * ⚠ `reactivated_from` IS THE ONE FIELD v15 ADDS OUTSIDE `projectSchema`, and it
 * is here because `project:add` can no longer only ever mean "added".
 *
 * `root_path` is UNIQUE, so picking the folder of a project you ARCHIVED
 * returns that row rather than making a second one, and v15 reactivates it —
 * picking a folder is an unambiguous statement of intent. Reactivating
 * SILENTLY would be the defect: the rail would gain a project the user thought
 * they had retired, in a position they did not choose, with nothing said. This
 * field is what lets the app say "Unarchived Chorus — it was in your archive"
 * instead.
 *
 * Null on the ordinary paths: a brand-new project, or one that was already
 * active. `null` here means "nothing to explain", which is the common case.
 *
 * ⚠ IT IS THE TUCKED ENUM, NOT THE FULL ONE. `'active'` is not a state you can
 * be reactivated FROM — a project that was already active reports `null` — so
 * admitting it would let a consumer switch on a case that cannot happen and
 * write a sentence nobody will ever read.
 */
export const projectAddResponseSchema = z.union([
  z.object({
    project: projectSchema,
    reactivated_from: z.enum(PROJECT_TUCKED_STATUSES).nullable()
  }),
  z.object({ cancelled: z.literal(true) })
])
export type ProjectAddResponse = z.infer<typeof projectAddResponseSchema>

/**
 * ⚠ `sessionCount` is Phase 3c's ONE declared payload reshape (D80), and it is
 * bounded to this field on this response. The design's project rail shows a
 * session count on EVERY project, and nothing else on the wire could supply
 * one: sessions reach the renderer only through `getLayout(activeId)`, and the
 * layout store holds a single project's tree at a time — so the count was
 * available for the active project and no other.
 *
 * It rides the response `project:list` already returns, computed in main by one
 * `GROUP BY project_id` over `sessions`. No channel and no handler was added
 * (`IpcChannel` stays 56, `ipcMain.handle(` 51), and no other task in this
 * phase may reshape a payload.
 *
 * ⚠ It sits HERE and not on `projectSchema` deliberately, the same way `active`
 * does: both are facts about a project's place in the LIST, not columns of the
 * projects row, and `project:add` must keep returning the bare row shape.
 */
export const projectsListSchema = z.array(
  projectSchema.extend({ active: z.boolean(), sessionCount: z.number().int().nonnegative() })
)
export type ProjectsList = z.infer<typeof projectsListSchema>

export const projectSelectRequestSchema = z.object({ project_id: z.uuid() })
export type ProjectSelectRequest = z.infer<typeof projectSelectRequestSchema>

/** The description cap. Enforced HERE — one number, applied on the boundary —
 *  rather than by a DB CHECK, so the renderer can show the same limit as a live
 *  character counter instead of discovering it as a failed write. */
export const PROJECT_DESCRIPTION_MAX = 1000

/**
 * project:update — the project settings screen saving name + colour +
 * description together.
 *
 * ⚠ THE `color` REGEX IS THE SECURITY BOUNDARY, not a formatting preference.
 * The rail interpolates this string into an inline `style` binding, so any
 * value that is not exactly `#RRGGBB` is a CSS-injection primitive. It is
 * validated in MAIN (D1: Zod runs here, never in the preload — see the
 * CSP/EvalError note), which means the renderer can only ever read a
 * well-formed colour back out of the database no matter what it sent.
 *
 * `name` is trimmed and must survive the trim: a whitespace-only name would
 * render as an invisible rail item and an empty window title, and there is no
 * way back to the settings screen for a project you cannot see.
 */
export const projectUpdateRequestSchema = z.object({
  project_id: z.uuid(),
  name: z.string().trim().min(1).max(120),
  color: z.string().regex(PROJECT_COLOR_PATTERN),
  /** Empty string is normalised to null by main — "" and NULL must not both be
   *  storable, or two rows can mean the same thing and read differently. */
  description: z.string().max(PROJECT_DESCRIPTION_MAX)
})
export type ProjectUpdateRequest = z.infer<typeof projectUpdateRequestSchema>

export const projectUpdateResponseSchema = z.object({ project: projectSchema })
export type ProjectUpdateResponse = z.infer<typeof projectUpdateResponseSchema>

/* ------------------------------------------------------------------ */
/* Phase 3h / D125: the four project-lifecycle channels                 */
/* ------------------------------------------------------------------ */

/**
 * project:set-status — hide, archive, or bring a project back to active.
 *
 * One channel for all three transitions rather than three verbs, because the
 * destination IS the payload and the handler's work is the same shape either
 * way. Going TO `archived` stops the project's PTYs; going away from it starts
 * nothing (see `ProjectStatus`).
 */
export const projectSetStatusRequestSchema = z.object({
  project_id: z.uuid(),
  status: z.enum(PROJECT_STATUSES)
})
export type ProjectSetStatusRequest = z.infer<typeof projectSetStatusRequestSchema>

/**
 * ⚠ THE RESPONSE CARRIES THE ACTIVE PROJECT ID, AND IT HAS TO. Archiving the
 * project you are working in reassigns `active_project_id` in main — the
 * renderer cannot predict the successor (it does not know main's ordering rule)
 * and must not guess, or the rail highlights one project while the workspace
 * shows another. Null is a real answer: archiving your only project leaves no
 * active one, which is the honest state and the one the empty rail describes.
 */
export const projectSetStatusResponseSchema = z.object({
  project: projectSchema,
  active_project_id: z.uuid().nullable(),
  /** How many live PTYs this transition stopped. Zero for hide and for
   *  un-archive; the archive confirmation reports it back to the user, who is
   *  entitled to know how many agents were just stopped on their behalf. */
  sessions_stopped: z.number().int().nonnegative()
})
export type ProjectSetStatusResponse = z.infer<typeof projectSetStatusResponseSchema>

/**
 * project:reorder — the whole rail order, stated at once.
 *
 * ⚠ `min(1)` AND NOTHING ELSE ENFORCED HERE, DELIBERATELY. The real check is
 * that this is a full permutation of the projects that actually exist, and Zod
 * cannot know that — it lives in the handler, against `listProjects()`. A uuid
 * predicate here would look like validation while waving through a well-formed
 * id that is not a project.
 */
export const projectReorderRequestSchema = z.object({
  ordered_ids: z.array(z.uuid()).min(1)
})
export type ProjectReorderRequest = z.infer<typeof projectReorderRequestSchema>

/**
 * project:delete — the only irreversible verb in the app's project surface.
 *
 * ⚠ `typed_name` IS THE CONFIRMATION ITSELF (D123), NOT A LABEL. Main compares
 * it to the stored name by EXACT equality and refuses otherwise, so a renderer
 * bug that sent the dialog's placeholder, or an empty string, or the wrong
 * project's name, cannot delete anything. The check lives in main because that
 * is the only side a compromised or simply mistaken renderer cannot skip.
 */
export const projectDeleteRequestSchema = z.object({
  project_id: z.uuid(),
  typed_name: z.string()
})
export type ProjectDeleteRequest = z.infer<typeof projectDeleteRequestSchema>

/**
 * What was ACTUALLY deleted — accumulated row counts from the transaction, not
 * a re-read prediction of what should have gone. If a soft pointer is ever
 * missed, this is the number that says so.
 */
export const projectDeleteResponseSchema = z.object({
  deleted: z.object({
    council_messages: z.number().int().nonnegative(),
    council_runs: z.number().int().nonnegative(),
    attention_spans: z.number().int().nonnegative(),
    dispatches: z.number().int().nonnegative(),
    worktrees: z.number().int().nonnegative(),
    sessions: z.number().int().nonnegative(),
    pane_layouts: z.number().int().nonnegative(),
    /** Task 6-3: `project_memory.project_id` is an ENFORCED, never-null FK to
     *  `projects(id)`, so the purge has to reach it or the whole transaction
     *  throws. Reported like every other table for the reason the shape exists:
     *  a purge that stopped naming what it deleted is how a table quietly falls
     *  out of it. ⚠ The CONFIG is what goes — no Neo4j data is touched. */
    project_memory: z.number().int().nonnegative(),
    settings: z.number().int().nonnegative(),
    projects: z.number().int().nonnegative()
  }),
  /** The project that is active now — reassigned when the deleted one was it. */
  active_project_id: z.uuid().nullable()
})
export type ProjectDeleteResponse = z.infer<typeof projectDeleteResponseSchema>

export const projectImpactRequestSchema = z.object({ project_id: z.uuid() })
export type ProjectImpactRequest = z.infer<typeof projectImpactRequestSchema>

/**
 * The size of what a delete would take, read before it is taken (D109 at a new
 * surface, D123).
 *
 * ⚠ `worktrees` IS COUNTED SEPARATELY FROM EVERYTHING ELSE FOR A REASON (D124).
 * Those rows go; the DIRECTORIES AND BRANCHES ON DISK STAY. It is the one count
 * in this object where "we deleted the row" and "we deleted your work" could be
 * confused, so the sentence built from it names the number AND says Chorus
 * merely stops tracking them.
 *
 * ⚠ `live_sessions` IS NOT A SIZE, IT IS A REFUSAL. A project with a running
 * PTY cannot be deleted — the row would delete cleanly and leave the process
 * orphaned, which no foreign key catches.
 */
export const projectImpactSchema = z.object({
  project_id: z.uuid(),
  name: z.string(),
  sessions: z.number().int().nonnegative(),
  live_sessions: z.number().int().nonnegative(),
  worktrees: z.number().int().nonnegative(),
  council_runs: z.number().int().nonnegative(),
  transcript_turns: z.number().int().nonnegative()
})
export type ProjectImpact = z.infer<typeof projectImpactSchema>

/* ------------------------------------------------------------------ */
/* Phase 6 / Task 6-3: per-project memory                              */
/* ------------------------------------------------------------------ */

/**
 * The mode vocabulary, IN FULL, matching `memoryConfigCore.MEMORY_MODES`.
 *
 * ⚠ IT IS NOT NARROWED TO THE ONE MODE THIS PHASE SHIPS, AND THAT IS THE
 * DESIGN RATHER THAN AN OVERSIGHT. `existing` is the only supported mode today;
 * `local-docker` arrives at Stage 5 and `aura` is inherently credentialed and
 * travels with D128(a). A single-value enum would refuse the other two with a
 * ZOD PARSE FAILURE — a stack trace where a sentence belongs — and would have
 * to be widened at Stage 5 anyway. The refusal is authored in the service, with
 * a different reason for each, following `resolveLaunchProfile`'s rule that a
 * disabled thing must say why.
 */
export const memoryModeSchema = z.enum(['local-docker', 'existing', 'aura'])
export type MemoryModeWire = z.infer<typeof memoryModeSchema>

/** `'credential'` NAMES a credential_profiles row; it never carries a value
 *  (D93). Only `'none'` is reachable in this phase, refused in the service for
 *  the same reason the modes are. */
export const memoryAuthModeSchema = z.enum(['none', 'credential'])
export type MemoryAuthModeWire = z.infer<typeof memoryAuthModeSchema>

/**
 * What the renderer learns about a project's memory.
 *
 * ⚠ THERE IS NO PASSWORD FIELD AND NO BOLT URI HERE, AND BOTH ABSENCES ARE
 * ASSERTED BY A KEY-SET TEST rather than merely intended. `host` and `port` are
 * what the chip and the settings row render; neither can embed a credential,
 * where a URI string can. `.strict()` so an extra field is a parse failure and
 * not a silent passenger.
 *
 * ⚠ THERE IS NO `last_tested_at` / `last_test_ok`, DELIBERATELY. D126's state
 * model earns `Connected` from an OBSERVED READ, never from a stored flag, so
 * connectivity is a session-lifetime fact the store holds from the last
 * `memory:test` — never a column. A persisted `Connected` would claim a
 * connection the app has not observed since it started.
 */
export const memoryStatusSchema = z
  .object({
    configured: z.boolean(),
    mode: memoryModeSchema.nullable(),
    auth_mode: memoryAuthModeSchema.nullable(),
    /** Null when the stored address cannot be parsed — the chip then omits the
     *  fact rather than rendering a guess (D76 one field down). */
    host: z.string().nullable(),
    port: z.number().int().positive().nullable(),
    database_name: z.string().nullable(),
    /** A CACHE of the graph's own version (plan §8). 0 until Task 6-4 seeds. */
    schema_version: z.number().int().nonnegative(),
    last_seeded_at: z.string().nullable(),
    updated_at: z.string().nullable()
  })
  .strict()
export type MemoryStatusWire = z.infer<typeof memoryStatusSchema>

export const memoryGetRequestSchema = z.object({ project_id: z.uuid() })
export type MemoryGetRequest = z.infer<typeof memoryGetRequestSchema>
export const memoryGetResponseSchema = z.object({ memory: memoryStatusSchema })
export type MemoryGetResponse = z.infer<typeof memoryGetResponseSchema>

/** `memory:status` answers the same shape `memory:get` does — one projection,
 *  not two that can disagree. They are separate CHANNELS because they are
 *  separate READS (a settings form vs a status chip), which is the `model:list`
 *  precedent; they are not separate SHAPES. */
export const memoryStatusRequestSchema = memoryGetRequestSchema
export type MemoryStatusRequest = z.infer<typeof memoryStatusRequestSchema>
export const memoryStatusResponseSchema = memoryGetResponseSchema
export type MemoryStatusResponse = z.infer<typeof memoryStatusResponseSchema>

/**
 * ⚠ `bolt_uri` IS THE ONLY FREE-TEXT FIELD IN THIS DESIGN, AND IT IS THE ONE
 * ROUTE A PASSWORD COULD TAKE INTO A TABLE THAT HAS NO PASSWORD COLUMN. Zod
 * checks it is a bounded string; `memoryConfigCore.validateBoltUri` is what
 * REFUSES `bolt://user:pass@host` with an authored reason. The length cap is
 * here rather than there because an unbounded string crossing IPC is a
 * different problem from a malformed one.
 */
export const memoryConfigureRequestSchema = z.object({
  project_id: z.uuid(),
  mode: memoryModeSchema,
  auth_mode: memoryAuthModeSchema,
  bolt_uri: z.string().max(512),
  database_name: z.string().max(120)
})
export type MemoryConfigureRequest = z.infer<typeof memoryConfigureRequestSchema>

/** Refusals are a `{ok:false, reason}` union, never a throw — the reason is
 *  rendered verbatim beside the form. */
export const memoryConfigureResponseSchema = z.union([
  z.object({ ok: z.literal(true), memory: memoryStatusSchema }),
  z.object({ ok: z.literal(false), reason: z.string() })
])
export type MemoryConfigureResponse = z.infer<typeof memoryConfigureResponseSchema>

export const memoryDisableRequestSchema = z.object({ project_id: z.uuid() })
export type MemoryDisableRequest = z.infer<typeof memoryDisableRequestSchema>

/** `removed` is false when there was nothing configured — an honest no-op
 *  rather than a claimed deletion. ⚠ Neither value means graph data was
 *  touched: nothing behind this channel speaks bolt. */
export const memoryDisableResponseSchema = z.union([
  z.object({ ok: z.literal(true), removed: z.boolean() }),
  z.object({ ok: z.literal(false), reason: z.string() })
])
export type MemoryDisableResponse = z.infer<typeof memoryDisableResponseSchema>

export const memoryTestRequestSchema = z.object({ project_id: z.uuid() })
export type MemoryTestRequest = z.infer<typeof memoryTestRequestSchema>

/**
 * ⚠ `probe` IS THE VALUE THE DATABASE ACTUALLY RETURNED, AND CARRYING IT IS THE
 * POINT. A bare `{ok:true}` would be indistinguishable from a handshake that
 * succeeded against a database the app cannot read — which the 6-1 D4 pass
 * measured happening on every failing row of its connect matrix. The number
 * crossing the wire is the evidence.
 */
export const memoryTestResponseSchema = z.union([
  z.object({ ok: z.literal(true), probe: z.number() }),
  z.object({ ok: z.literal(false), reason: z.string() })
])
export type MemoryTestResponse = z.infer<typeof memoryTestResponseSchema>

/* ---- Task 6-4: the graph's schema and its provenance measurement ---- */

export const memorySeedRequestSchema = z.object({ project_id: z.uuid() })
export type MemorySeedRequest = z.infer<typeof memorySeedRequestSchema>

/**
 * ⚠ `cache_was_stale` AND `cached_version` ARE ON THE WIRE DELIBERATELY. The
 * graph is the authority on its own version and SQLite only caches it, so the
 * two CAN disagree — a graph restored from a dump, or reached by a second
 * Chorus install. Reporting the disagreement is the point: it is the one fact
 * that demonstrates which of the two is authoritative, and silently correcting
 * it would hide the diagnostic.
 */
export const memorySeedResponseSchema = z.union([
  z.object({
    ok: z.literal(true),
    from_version: z.number().int().nonnegative(),
    to_version: z.number().int().nonnegative(),
    /** Migration NAMES, not statements — a client has no use for raw Cypher. */
    applied: z.array(z.string()),
    cache_was_stale: z.boolean(),
    cached_version: z.number().int().nonnegative()
  }),
  z.object({ ok: z.literal(false), reason: z.string() })
])
export type MemorySeedResponse = z.infer<typeof memorySeedResponseSchema>

export const memoryIndexRequestSchema = z.object({ project_id: z.uuid() })
export type MemoryIndexRequest = z.infer<typeof memoryIndexRequestSchema>

/**
 * What one index run did.
 *
 * ⚠ `commits_skipped_beyond_limit` IS NOT DECORATION. The commit window is
 * capped, and a truncation nobody is told about reads as "we covered
 * everything" — the same D55 rule `affected_total` follows one channel down.
 * Measured on this repository: 241 commits exist, 200 are linked, 41 are
 * skipped, and the user is told so.
 *
 * ⚠ `repo_id` IS NULLABLE AND NULL MEANS SOMETHING: a project with no git
 * history has no repository identity, so no `:Commit` may be written — while
 * its files still index. The UI says why rather than rendering a zero that
 * looks like a failure.
 */
export const memoryIndexResponseSchema = z.union([
  z.object({
    ok: z.literal(true),
    workspace_instance_id: z.string(),
    repo_id: z.string().nullable(),
    files_seen: z.number().int().nonnegative(),
    directories: z.number().int().nonnegative(),
    commits_linked: z.number().int().nonnegative(),
    commits_skipped_beyond_limit: z.number().int().nonnegative(),
    paths_skipped_unparseable: z.number().int().nonnegative(),
    files_marked_missing: z.number().int().nonnegative(),
    elapsed_ms: z.number().int().nonnegative()
  }),
  z.object({ ok: z.literal(false), reason: z.string() })
])
export type MemoryIndexResponse = z.infer<typeof memoryIndexResponseSchema>

export const memoryValidateRequestSchema = z.object({ project_id: z.uuid() })
export type MemoryValidateRequest = z.infer<typeof memoryValidateRequestSchema>

/**
 * ⚠ `with_source` AND `total` TRAVEL TOGETHER, ALWAYS, AND `text` IS BUILT IN
 * MAIN (D55). A renderer handed a lone numerator will eventually render it, and
 * a renderer handed a percentage cannot recover the pair. `text` is `"N of M"`
 * — computed by the tested pure core, not by string work in a `.vue` file.
 *
 * ⚠ `affected_total` IS SEPARATE FROM `affected.length` ON PURPOSE. The list is
 * bounded, so the UI must be able to say *"showing 50 of 469"* — a bounded list
 * rendered bare looks complete, which is the same failure D55 names one level up.
 *
 * ⚠ `usage` (Task 6b-1 / D168) IS ON BOTH BRANCHES — see
 * `memoryUsageSummarySchema`: the counters are a local SQLite read that is
 * true whether or not the graph answered, and a refusal must not erase them.
 */
export const memoryValidateResponseSchema = z.union([
  z.object({
    ok: z.literal(true),
    with_source: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    text: z.string(),
    affected: z.array(
      z.object({
        id: z.string(),
        content: z.string(),
        written_via: z.string()
      })
    ),
    affected_total: z.number().int().nonnegative(),
    usage: memoryUsageSummarySchema
  }),
  z.object({ ok: z.literal(false), reason: z.string(), usage: memoryUsageSummarySchema })
])
export type MemoryValidateResponse = z.infer<typeof memoryValidateResponseSchema>

/* ─────────────────── Task 6a-4: the provisioner ────────────────────────── */

export const memoryProvisionRequestSchema = z.object({ project_id: z.uuid() })
export type MemoryProvisionRequest = z.infer<typeof memoryProvisionRequestSchema>

/**
 * What one provision did.
 *
 * ⚠ `adopted` IS NOT DECORATION, for the same reason
 * `commits_skipped_beyond_limit` is not. Provisioning twice is the ordinary
 * case after a machine restart, and reporting a reused container as a fresh
 * create is how a user ends up believing they have a clean database when they
 * have their old one.
 *
 * ⚠ `bolt_port` IS WHAT DOCKER PUBLISHED, not what Chorus asked for. An adopted
 * container may sit on a different port than the row remembers, and the row is
 * the thing that gets corrected.
 *
 * ⚠ THERE IS NO `http_port`. The Neo4j browser's port is deliberately not
 * published — a second published port is a second exposure for a UI nothing in
 * Chorus uses.
 */
export const memoryProvisionResponseSchema = z.union([
  z.object({
    ok: z.literal(true),
    container_name: z.string(),
    volume_name: z.string(),
    bolt_port: z.number().int().positive(),
    container_id: z.string(),
    adopted: z.boolean(),
    /** The graph's own answer over bolt — readiness as an OBSERVED READ (D126),
     *  never a sleep that happened to be long enough. */
    probe: z.number()
  }),
  z.object({ ok: z.literal(false), reason: z.string() })
])
export type MemoryProvisionResponse = z.infer<typeof memoryProvisionResponseSchema>

export const memoryContainerRequestSchema = z.object({ project_id: z.uuid() })
export type MemoryContainerRequest = z.infer<typeof memoryContainerRequestSchema>

/**
 * What docker says about this project's container.
 *
 * ⚠ EVERY FIELD IS REQUIRED-NULLABLE RATHER THAN OPTIONAL. "This project has no
 * container" and "this project's container is gone" are both real answers a
 * producer must state, not omit — the same rule the memory status payload
 * follows.
 *
 * ⚠ `container_name: null` IS NOT AN ERROR. It means the project points at a
 * database somebody else started, and the UI renders no lifecycle controls for
 * it (D76).
 */
export const memoryContainerStatusResponseSchema = z.union([
  z.object({
    ok: z.literal(true),
    container_name: z.string().nullable(),
    exists: z.boolean(),
    running: z.boolean(),
    state: z.string().nullable(),
    status: z.string().nullable(),
    /** `127.0.0.1:7688`, or null when stopped — docker drops the published
     *  ports once a container stops (measured on 29.7.2). */
    published_at: z.string().nullable()
  }),
  z.object({ ok: z.literal(false), reason: z.string() })
])
export type MemoryContainerStatusResponse = z.infer<typeof memoryContainerStatusResponseSchema>

/**
 * ⚠ `typed_name` IS THE CONFIRMATION, AND MAIN CHECKS IT.
 *
 * The renderer disabling a button is an affordance; this is the enforcement.
 * `project:delete` (D123) set the precedent and the reasoning is unchanged: a
 * renderer-only guard is walked past by the command palette, by a second
 * window, and by any future caller.
 */
export const memoryContainerRemoveRequestSchema = z.object({
  project_id: z.uuid(),
  typed_name: z.string().min(1).max(200)
})
export type MemoryContainerRemoveRequest = z.infer<typeof memoryContainerRemoveRequestSchema>

/** ⚠ `removed` REFERS TO THE CONTAINER. The volume is never touched (F49). */
export const memoryContainerRemoveResponseSchema = z.union([
  z.object({ ok: z.literal(true), removed: z.boolean() }),
  z.object({ ok: z.literal(false), reason: z.string() })
])
export type MemoryContainerRemoveResponse = z.infer<typeof memoryContainerRemoveResponseSchema>

/** session:restart {sessionId} — D16 clause 4: read row -> re-validate cwd ->
 *  launch path under the SAME row id (no row creation); 'running' is written
 *  only after the spawn succeeds. One path for in-run and post-restart. */
export const restartRequestSchema = z.object({ sessionId: z.uuid() })
export type RestartRequest = z.infer<typeof restartRequestSchema>

export const restartResponseSchema = z.union([
  attachResponseSchema,
  z.object({ ok: z.literal(false), reason: z.string() })
])
export type RestartResponse = z.infer<typeof restartResponseSchema>

/** session:delete {sessionId} — pane close, after kill/exit completes. Main
 *  rejects the delete while the session is live in the manager. */
export const deleteSessionRequestSchema = z.object({ sessionId: z.uuid() })
export type DeleteSessionRequest = z.infer<typeof deleteSessionRequestSchema>

/** session:set-title {sessionId, title} — the ONE title write path (1b-1/D18).
 *  max(120) bounds the wire size; main additionally strips control characters
 *  and no-ops on an empty post-sanitize result. */
export const setTitleRequestSchema = z.object({
  sessionId: z.uuid(),
  title: z.string().min(1).max(120)
})
export type SetTitleRequest = z.infer<typeof setTitleRequestSchema>

/** Restore engine relaunched this session (auto-restore only — a manual
 *  Restart badges from its own return path). The pane re-attaches and wears
 *  the transient "new conversation" badge when the attach comes back running. */
export const sessionRestoredEventSchema = z.object({ sessionId: z.string().min(1) })
export type SessionRestoredEvent = z.infer<typeof sessionRestoredEventSchema>

/**
 * Pre-1-2 persisted layout shape (flat slot/agent array). Parsed only by the
 * storage lazy legacy-conversion read path; never crosses IPC.
 */
export const legacyPaneSchema = z.object({
  slot: z.number().int().min(0),
  agent: agentKindSchema
})
export type LegacyPane = z.infer<typeof legacyPaneSchema>
export const legacyFlatLayoutSchema = z.array(legacyPaneSchema)


/* ------------------------------------------------------------------ */
/* Task 3b-3: the council run                                          */
/* ------------------------------------------------------------------ */

/**
 * ⚠ THE PATH IS AUTHORITATIVE AND `brief_text` IS GONE — Task 3b-4 REPLACED it,
 * it did not widen around it (D68(4)).
 *
 * 3b-3 shipped both: a `brief_path` LABEL main never opened, beside the
 * `brief_text` that was the real input. Keeping the text alongside the path
 * would leave two sources of truth for what the council deliberated on, and the
 * one the renderer controls would be the one that counts — which would make the
 * path validation in `councilService.validateBriefPath` decorative. Main opens
 * the path itself, and there is nothing else on this request for it to read.
 *
 * Nothing here can carry key material in either direction: a run names no
 * credential at all, because a member already names its own.
 */
export const councilStartRequestSchema = z
  .object({
    project_id: z.uuid().nullable(),
    /** ⚠ VALIDATED IN MAIN, NEVER TRUSTED HERE. `min(1).max(1024)` is a bound on
     *  the string, not a security check — absolute, local, `.md`, existing, a
     *  regular file and under the size cap are all decided in main, because a
     *  renderer-supplied path main opens is an arbitrary-file-read primitive. */
    brief_path: z.string().min(1).max(1024)
  })
  .strict()
export type CouncilStartRequest = z.infer<typeof councilStartRequestSchema>

/* --- The brief picker: the `project:add` precedent, exactly ---------- */

export const councilPickBriefRequestSchema = z.object({}).strict()
export type CouncilPickBriefRequest = z.infer<typeof councilPickBriefRequestSchema>

/** Cancel is a STRUCTURED NO-OP, not an error — the `project:add` shape. The
 *  path that comes back is still re-validated by `council:start`: the dialog is
 *  a convenience, never the boundary. */
export const councilPickBriefResponseSchema = z.union([
  z.object({ path: z.string().min(1).max(1024) }).strict(),
  z.object({ cancelled: z.literal(true) }).strict()
])
export type CouncilPickBriefResponse = z.infer<typeof councilPickBriefResponseSchema>

/**
 * ⚠ D55, ENFORCED BY THE SCHEMA RATHER THAN BY DISCIPLINE. `cost_usd` cannot be
 * read without the counts it is a cost OF: how many members were planned, how
 * many answered, how many refused, and for how many the provider actually
 * reported usage. A response carrying a total alone does not parse.
 *
 * Every token field is nullable for the reason `TokenUsage`'s are: "not
 * reported" and "zero" are different facts, and a zero that means the first is
 * the confident-looking number D55 exists to forbid.
 */
export const councilAccountingSchema = z
  .object({
    membersPlanned: z.number().int().nonnegative(),
    membersAnswered: z.number().int().nonnegative(),
    membersRefused: z.number().int().nonnegative(),
    /** ⚠ TURNS, not members — a four-member council runs eight turns across its
     *  four phases, and reporting the second as the first is a denominator
     *  nobody can read. Both ship, separately named. */
    turnsAnswered: z.number().int().nonnegative(),
    turnsRefused: z.number().int().nonnegative(),
    usageReported: z.number().int().nonnegative(),
    usageAbsent: z.number().int().nonnegative(),
    tokensIn: z.number().nullable(),
    tokensOut: z.number().nullable(),
    tokensCached: z.number().nullable()
  })
  .strict()
export type CouncilAccounting = z.infer<typeof councilAccountingSchema>

/**
 * One question's bird's-eye row — the members' own verdict tokens, counted.
 *
 * ⚠ IT IS A MEASUREMENT OF AGREEMENT, NOT OF CORRECTNESS, and the view is bound
 * to say so. `not-measured` is a first-class state for exactly that reason: a
 * question too few members answered in the required form must not be able to
 * borrow the confidence of one that was actually counted (D67 Q3).
 *
 * ⚠ D55: `votes` and `silent` travel WITH the state, never behind it. "3 agreed"
 * is unreadable without the fourth member who was asked and left no token, so
 * the schema refuses a state that arrives without its roster.
 */
export const councilQuestionSummarySchema = z
  .object({
    index: z.number().int().nonnegative(),
    /** Bounded in main (`SUMMARY_QUESTION_CAP`); bounded again here, because a
     *  schema that trusts the producer is not a boundary. */
    question: z.string().max(400),
    /** `structural` = counted from verdict tokens. `model-judged` = too few
     *  tokens to count, so nothing here was measured. Carried, never flattened. */
    path: z.enum(['structural', 'model-judged']),
    state: z.enum(['agreed', 'qualified', 'split', 'disagreed', 'not-measured']),
    votes: z
      .array(
        z
          .object({
            label: z.string(),
            verdict: z.enum(['AGREE', 'DISAGREE', 'QUALIFY'])
          })
          .strict()
      )
      .max(64),
    /** Labels of members who answered but left no parseable verdict token. */
    silent: z.array(z.string()).max(64)
  })
  .strict()
export type CouncilQuestionSummary = z.infer<typeof councilQuestionSummarySchema>

export const councilStartResponseSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      run_id: z.uuid(),
      /** The findings TEXT, so the view can render it without reading a file. */
      findings: z.string(),
      /** ⚠ REQUIRED, and empty is a legitimate value only in the sense that no
       *  run can produce it: assembly refuses a brief with no enumerable
       *  questions before anything is minted. A run that got this far has a row
       *  per question, and an absent field would let the glance quietly vanish
       *  rather than fail loudly. */
      question_summary: z.array(councilQuestionSummarySchema).max(64),
      /** ⚠ DERIVED IN MAIN FROM THE BRIEF PATH, never supplied by the renderer.
       *  NULL when the write failed — never a path that does not exist. */
      findings_path: z.string().nullable(),
      /** The reason beside the null, so an absent file is never an absent
       *  explanation. NULL when the file was written. */
      findings_error: z.string().nullable(),
      /** ⚠ REQUIRED, so the number below can never travel alone. */
      accounting: councilAccountingSchema,
      /** From the provider's own ledger — it computes the figure, so there is
       *  one number and one authority. NULL when it could not be read, never 0.
       *
       *  ⚠ F41: this is the SETTLED figure when `cost_is_provisional` is false,
       *  and the early `readUsage` one when it is true. The two are not
       *  interchangeable and the flag below is not decoration. */
      cost_usd: z.number().nullable(),
      /**
       * ⚠ REQUIRED, AND IT IS A D55 DENOMINATOR IN EVERY SENSE THAT MATTERS.
       * `true` does not mean "we are unsure"; it means the number is KNOWN to be
       * short by the run's final turn, because the provider had not posted that
       * generation when the key's usage was read. Measured at 49% low across two
       * runs on two rosters. A cost that cannot say which of the two it is gets
       * believed as the settled one, which is exactly how this shipped wrong.
       */
      cost_is_provisional: z.boolean()
    })
    .strict(),
  z.object({ ok: z.literal(false), reason: z.string() }).strict()
])
export type CouncilStartResponse = z.infer<typeof councilStartResponseSchema>

export const councilCancelRequestSchema = z.object({ run_id: z.uuid() }).strict()
export type CouncilCancelRequest = z.infer<typeof councilCancelRequestSchema>

/**
 * ⚠ `cancelled: boolean` IS GONE, REPLACED RATHER THAN WIDENED, AND THE COMMENT
 * IT CARRIED WAS THE DEFECT. It said `false` meant "there was no such live run —
 * a race the user cannot see, and not an error". That is wrong, and it is wrong
 * for a window the user sees very clearly.
 *
 * A run leaves main's `live` map in the protocol loop's `finally`, and it leaves
 * it BEFORE the key is read back and revoked and before the cost is reconciled —
 * deliberately, because the delete is what stops a late cancel from re-flagging a
 * finished run as cancelled after `settle` has already read that flag. So for the
 * whole settle-and-reconcile tail — ~10s when the provider answers promptly, up
 * to ~90s when it does not — main answered `false` for a run whose `council:start`
 * invoke was still outstanding and about to resolve normally. The renderer, which
 * discarded the answer entirely, showed the user nothing at all: they clicked
 * Cancel on a council that looked hung and the app did not so much as blink.
 *
 * ⚠ THE FIX IS NOT TO LET `false` UNLOCK THE SURFACE. In that tail the invoke is
 * still in flight and will resolve with real findings; clearing the renderer's
 * `running` flag would re-enable `Run council`, whose only guard against a
 * concurrent run is that flag. A click inside the window would start a SECOND
 * paid deliberation while the first was outstanding, and the first would then
 * write its findings, accounting and cost over the second's state. Two runs
 * billed, one visible, and the numbers belonging to neither.
 *
 * So this says what the run was DOING when the cancel arrived, and the renderer
 * says it in words instead of guessing from a boolean:
 *
 *   `deliberating` — it was live and has now been aborted. The only stage in
 *                    which a cancel does anything, and the only one that used to
 *                    report `cancelled: true`.
 *   `settling`     — its deliberation is over; its key is being revoked and its
 *                    cost read back. Nothing to cancel and nothing wrong: the
 *                    run closes itself within seconds.
 *   `unknown`      — main has no record of it live or settling. Still not an
 *                    error, but no longer a claim that the user cannot see it.
 *
 * ⚠ ONE FIELD, NOT TWO. A `cancelled` boolean beside this would be exactly
 * `stage === 'deliberating'` — two fields that must agree, with no rule about
 * which wins when they do not. The stage is the fact; "did it cancel" is a
 * question the reader can answer from it.
 */
export const councilCancelResponseSchema = z
  .object({ stage: z.enum(['deliberating', 'settling', 'unknown']) })
  .strict()
export type CouncilCancelResponse = z.infer<typeof councilCancelResponseSchema>
/** The run stage main reports back to a cancel. Named so the renderer can hold
 *  it without re-deriving the union from the response type. */
export type CouncilRunStage = CouncilCancelResponse['stage']

/**
 * "A run exists and can now be cancelled." Broadcast once, from the same place
 * the ledger row is written.
 *
 * ⚠ IT IS THE EARLIEST INSTANT THE ID IS TRUE, and that is the whole point: it
 * fires after the mint and the `council_runs` row, so a renderer that has it can
 * name a run main can actually find in `live`. Everything before it — brief
 * validation, the secret pre-pass, assembly, route resolution, the mint itself —
 * happens with nothing minted, nothing spent and no row written, so there is
 * genuinely nothing to cancel yet and no id to give.
 *
 * ⚠ NO SECRET SURFACE. A run id is a v4 uuid this process generated; it names no
 * key, no path and no credential.
 */
export const councilOpenedEventSchema = z.object({ runId: z.uuid() }).strict()
export type CouncilOpenedEvent = z.infer<typeof councilOpenedEventSchema>

/** The broadcast, following `session:data` exactly. `delta` is SCRUBBED text
 *  from `SessionOutput`'s `onText`. */
export const councilProgressEventSchema = z
  .object({
    runId: z.uuid(),
    phase: z.enum(['positions', 'critique', 'arbitration', 'synthesis', 'done']),
    round: z.number().int().nonnegative(),
    memberId: z.string().nullable(),
    delta: z.string()
  })
  .strict()
export type CouncilProgressEvent = z.infer<typeof councilProgressEventSchema>

/**
 * The at-a-glance vector, broadcast when the positions round closes.
 *
 * ⚠ `runId` IS REQUIRED AND THE RENDERER MUST CHECK IT, exactly as it does on
 * `council:progress`. Both channels broadcast to EVERY window, so a second
 * window running its own council would otherwise paint this window's strip with
 * a different run's verdicts — and unlike a stray delta, which is visibly
 * foreign text, a stray summary looks entirely at home.
 */
export const councilSummaryEventSchema = z
  .object({
    runId: z.uuid(),
    questions: z.array(councilQuestionSummarySchema).max(64)
  })
  .strict()
export type CouncilSummaryEvent = z.infer<typeof councilSummaryEventSchema>

/* ---- council:transcript — the read path D97 opened (Task 3e-4) ---------- */

export const councilTranscriptRequestSchema = z.object({ run_id: z.uuid() }).strict()
export type CouncilTranscriptRequest = z.infer<typeof councilTranscriptRequestSchema>

/**
 * One stored turn, in the order `getCouncilMessagesForRun` returns.
 *
 * ⚠ `phase` IS A STRING AND NOT `councilProgressEventSchema`'s ENUM, ON PURPOSE.
 * These rows are HISTORY — written by whatever build was running at the time —
 * and a strict enum here would let one unrecognised stored value make an entire
 * paid run unreadable. The renderer already falls back to the raw string when it
 * has no label for a phase. Same reasoning as F4 for `member_id`: a transcript
 * legitimately names a member that has since been deleted (D62), so it is a
 * string rather than a `uuid()` FK-shaped claim.
 */
export const councilTranscriptTurnSchema = z
  .object({
    member_id: z.string().nullable(),
    phase: z.string().min(1),
    round: z.number().int().nonnegative(),
    text: z.string()
  })
  .strict()
export type CouncilTranscriptTurn = z.infer<typeof councilTranscriptTurnSchema>

/**
 * ⚠ BOUNDED AT THE BOUNDARY, AND THE PAYLOAD ADMITS IT WHEN IT BIT.
 * ImplementationSpec-3e-4 §1: an arbitrarily large payload crossing the bridge
 * is not a thing to discover in production. The largest transcript on this
 * machine measures **112,531 characters over 8 turns** (run `c06874ad`, a full
 * four-member council); the cap is stated in `main/ipc.ts` beside the handler as
 * a multiple of that.
 *
 * ⚠ THE UNIT IS CHARACTERS, AND IT IS NAMED THAT WAY BECAUSE F39's RETRACTION
 * COST A RUN TO LEARN THE LESSON. `content` is a JS string; its `.length` is
 * UTF-16 code units, not bytes. Calling that "bytes" would be exactly the
 * mistake the 3e-1 measurement made when it compared SSE frame bytes across
 * models as though they were words.
 *
 * `total_turns` is `turns.length`'s DENOMINATOR (D55) — the count of rows
 * stored, whether or not they all fit — so a truncated read can never be
 * mistaken for a short deliberation.
 */
export const councilTranscriptResponseSchema = z
  .object({
    run_id: z.uuid(),
    turns: z.array(councilTranscriptTurnSchema),
    /** Rows stored for this run. `turns.length` may be smaller; it is never
     *  larger. Zero means the run stored no transcript, which is itself a fact
     *  worth rendering rather than an error. */
    total_turns: z.number().int().nonnegative(),
    /** True when `turns` does not carry the whole transcript — because turns
     *  were dropped, or the last one's text was cut at the cap. */
    truncated: z.boolean(),
    /** Characters actually returned, and the cap in force. Emitted together so
     *  the figure stays readable after the constant moves. */
    chars: z.number().int().nonnegative(),
    cap_chars: z.number().int().positive()
  })
  .strict()
export type CouncilTranscriptResponse = z.infer<typeof councilTranscriptResponseSchema>

/* ---- the Docket: council:docket / :findings / :forget-run (D112–D115) --- */

export const councilDocketRequestSchema = z.object({ project_id: z.uuid() }).strict()
export type CouncilDocketRequest = z.infer<typeof councilDocketRequestSchema>

/**
 * One run in a project's history.
 *
 * ⚠ EVERY NULLABLE FIELD IS A REFUSAL TO INVENT A NUMBER, AND `.nullable()` HERE
 * IS WHAT STOPS THE INVENTION HAPPENING SILENTLY THREE LAYERS UP. If these were
 * `.default(0)` the wire would be tidier and the view would render `0 tokens` for
 * a run that burned two hundred thousand of them. D76: omit rather than stub, and
 * the boundary is where it gets enforced.
 *
 * ⚠ `status` IS A STRING, NOT AN ENUM — `councilTranscriptTurnSchema`'s reasoning
 * for `phase`, and it applies with more force here. These rows are history
 * written by whatever build was running at the time, and a strict enum would let
 * one unrecognised stored status make an entire project's Docket unreadable. The
 * closed vocabulary lives in `storage.ts` for a reader to check against; it is
 * not a constraint the wire can safely impose on the past.
 */
export const councilDocketRunSchema = z
  .object({
    run_id: z.uuid(),
    /** `basename(brief_path)`. A LABEL, NOT AN IDENTITY — nothing joins on it
     *  (CR-3f.1 A1). `run_id` is the identity. */
    label: z.string().min(1),
    /** The full path, so the label has a disambiguator in its tooltip. */
    brief_path: z.string().min(1),
    status: z.string().min(1),
    started_at: z.string().min(1),
    /** NULL = the end was never observed: a crash the boot heal renamed, or a run
     *  still in flight. */
    ended_at: z.string().nullable(),
    /** ⚠ FROM THE TWO STORED TIMESTAMPS, NEVER FROM "NOW". Null when there is no
     *  honest span — otherwise an abandoned run from March would report how long
     *  ago it died as how long it ran. */
    duration_ms: z.number().int().nonnegative().nullable(),
    /** Rows stored for the run. The denominator for the two figures below (D55). */
    turns: z.number().int().nonnegative(),
    /** ⚠ NULL MEANS NOT ONE TURN REPORTED USAGE. It does not mean zero, and
     *  `council_runs.tokens_in/out` are dead columns (F42) — these are summed from
     *  `council_messages`. */
    tokens_in: z.number().int().nonnegative().nullable(),
    tokens_out: z.number().int().nonnegative().nullable(),
    /** True when only SOME turns reported usage, so the view prints the
     *  denominator rather than a bare total (D55). */
    tokens_are_partial: z.boolean(),
    turns_with_tokens: z.number().int().nonnegative(),
    /**
     * ⚠ A FLOOR, AND THE FIELD NAME SAYS SO BECAUSE THE NUMBER CANNOT.
     * F42 measured `council_runs.cost_usd` 37–60% under the real bill, and unlike
     * a live `council:start` response a stored row carries no settlement flag to
     * qualify it with. Naming it `cost_usd` here would hand the view a figure that
     * looks authoritative and is not. D115: rendered as a floor, never summed into
     * a project total until the F42 gap is closed by measurement.
     */
    cost_floor_usd: z.number().nonnegative().nullable(),
    /** Whether a findings document was written. Whether it is still READABLE is a
     *  filesystem question, answered by `council:findings` on open. */
    has_findings: z.boolean(),
    /**
     * D106's outcome, compacted to ONE LINE OF TEXT for the row — e.g.
     * `1 revise · 2 approved · 3 of 3 ruled · members split on 1`.
     *
     * ⚠ TEXT, NEVER A BADGE, and the constraint is CR-3f.1's badge economy: the
     * row already spends its single status affordance on the run status, and
     * counts and denominators are explicitly permitted as text. A coloured
     * verdict chip here would be the second affordance that directive rules out.
     *
     * ⚠ AND IT COUNTS RATHER THAN ROLLING UP. The arbiter rules per question and
     * never issues an overall verdict, so there is no run-level outcome to show;
     * reducing six rulings to one word would attribute a judgement to the council
     * that it never made.
     *
     * Null when there is nothing honest to say — no questions, or the brief is
     * gone — and the row omits the line rather than printing an empty one (D76).
     */
    verdict_digest: z.string().nullable()
  })
  .strict()
export type CouncilDocketRun = z.infer<typeof councilDocketRunSchema>

export const councilDocketResponseSchema = z
  .object({ runs: z.array(councilDocketRunSchema) })
  .strict()
export type CouncilDocketResponse = z.infer<typeof councilDocketResponseSchema>

export const councilFindingsRequestSchema = z.object({ run_id: z.uuid() }).strict()
export type CouncilFindingsRequest = z.infer<typeof councilFindingsRequestSchema>

/**
 * ⚠ `text` AND `reason` ARE BOTH NULLABLE AND EXACTLY ONE IS EVER SET. An absent
 * document is not an error — it is the ordinary outcome of a branch switch, a
 * rename, or a run that failed before writing one — so it travels as a stated
 * absence carrying the path that was looked in. This is the shape the live run's
 * `findings_error` beside `findings_path` already established; a history read
 * inherits it rather than inventing a second convention.
 *
 * `path` survives in BOTH cases, because "we looked here and found nothing" is
 * only actionable if it says where.
 */
export const councilFindingsResponseSchema = z
  .object({
    run_id: z.uuid(),
    /** Null when the run never recorded a findings path at all. */
    path: z.string().nullable(),
    text: z.string().nullable(),
    reason: z.string().nullable()
  })
  .strict()
export type CouncilFindingsResponse = z.infer<typeof councilFindingsResponseSchema>

export const councilForgetRunRequestSchema = z.object({ run_id: z.uuid() }).strict()
export type CouncilForgetRunRequest = z.infer<typeof councilForgetRunRequestSchema>

/**
 * What was actually purged, reported after the fact.
 *
 * ⚠ THE COUNTS ARE READ BEFORE THE DELETE AND RETURNED AFTER IT, so the sentence
 * the user confirmed and the sentence the app reports are the same two numbers.
 * `forgot: false` means there was no such run — a double-click, or a second
 * window that got there first. That is a race the user cannot see and is not an
 * error worth showing them, which is `council:cancel`'s existing precedent.
 */
export const councilForgetRunResponseSchema = z
  .object({
    forgot: z.boolean(),
    turns: z.number().int().nonnegative()
  })
  .strict()
export type CouncilForgetRunResponse = z.infer<typeof councilForgetRunResponseSchema>

/* ---- council:verdict — the Verdict strip (D106) ------------------------- */

/**
 * ⚠ THE ARBITER'S FIVE STATES, AND THIS ONE *IS* A CLOSED ENUM — unlike the run
 * `status` and the transcript `phase` beside it, which are free strings because
 * they are history written by older builds. The distinction is which side
 * produced the value: those are read back from rows the app wrote long ago, this
 * is produced by a parser IN THIS BUILD that already refuses anything outside the
 * vocabulary. A sixth value cannot reach this boundary, so accepting one would
 * only mean accepting a bug.
 */
export const councilArbiterVerdictSchema = z.enum([
  'APPROVED',
  'APPROVED-WITH-REVISIONS',
  'REVISE',
  'REJECTED',
  'INSUFFICIENT-INFORMATION'
])
export type CouncilArbiterVerdict = z.infer<typeof councilArbiterVerdictSchema>

/**
 * One question's row: what the members concluded, and what the arbiter ruled.
 *
 * ⚠ THE TWO FIELDS ARE NEVER RECONCILED AND MUST NOT BE. D106: two facts, two
 * sources, neither faked. "The members split and the arbiter approved anyway" is
 * the case this shape exists to make expressible.
 */
export const councilVerdictRowSchema = z
  .object({
    index: z.number().int().nonnegative(),
    question: z.string(),
    /** The members' half, already computed by the same chain the findings
     *  document uses (`councilQuestionSummarySchema`'s fields, inline). */
    consensus: councilQuestionSummarySchema,
    /**
     * ⚠ THREE-WAY, AND THE NULL IS NOT AN OVERSIGHT.
     *   • a verdict — the arbiter ruled;
     *   • `'unparsed'` — asked, and this question got no ruling;
     *   • `null` — no verdict block at all, so it was never asked, which is
     *     EVERY run recorded before D106 shipped.
     * Collapsing the last two would tell a reader the council failed when the
     * question was in fact never put to it.
     */
    verdict: z.union([councilArbiterVerdictSchema, z.literal('unparsed')]).nullable()
  })
  .strict()
export type CouncilVerdictRow = z.infer<typeof councilVerdictRowSchema>

export const councilVerdictRequestSchema = z.object({ run_id: z.uuid() }).strict()
export type CouncilVerdictRequest = z.infer<typeof councilVerdictRequestSchema>

/**
 * ⚠ `reason` CARRIES THE ONE FAILURE THIS READ HAS. The strip is derived from the
 * brief's questions plus the stored turns; if the brief file has been moved or
 * deleted there are no questions to hang the rows on, and the honest answer is an
 * empty strip with a stated cause — the same treatment `council:findings` gives a
 * missing document, rather than a silent zero-row strip that reads as "this run
 * decided nothing".
 */
export const councilVerdictResponseSchema = z
  .object({
    run_id: z.uuid(),
    rows: z.array(councilVerdictRowSchema),
    /** Questions the arbiter actually ruled on. */
    ruled: z.number().int().nonnegative(),
    /** The brief's question count — `ruled`'s denominator, which D106 requires
     *  the strip to carry rather than making the reader count rows. */
    total: z.number().int().nonnegative(),
    /** False = no verdict block was found; this run's arbiter was never asked.
     *  Distinct from `ruled === 0`, which means asked and silent. */
    arbiter_asked: z.boolean(),
    reason: z.string().nullable()
  })
  .strict()
export type CouncilVerdictResponse = z.infer<typeof councilVerdictResponseSchema>

/**
 * Task 3c-2 / D74: the ONE payload shape the window channels carry.
 *
 * It does double duty on purpose, because it describes one fact: it is the
 * RESULT of `window:toggle-maximize` and the BODY of the
 * `window:maximized-changed` event. Two schemas for "is the window maximized"
 * could disagree, and the whole reason the event exists is that the renderer's
 * copy of this boolean is the one thing that goes stale.
 *
 * `window:minimize` and `window:close` take nothing and return nothing, so
 * they have no schema of their own — there is no payload to validate.
 *
 * `.strict()` for the F-5b reason the rest of this file documents: zod's
 * default STRIPS unknown keys, and a stripped field is an invisible one.
 */
export const windowMaximizedSchema = z.object({ maximized: z.boolean() }).strict()
export type WindowMaximized = z.infer<typeof windowMaximizedSchema>

/* ────────────────────────── Day report (D153) ────────────────────────── */

/**
 * The wire shape of one day's evidence. It MIRRORS `dayReportCore`'s
 * `DayEvidence` and is deliberately re-declared here rather than imported:
 * `src/shared` may not reach into `src/main`, and the boundary is the one
 * place a shape must be validated rather than trusted (D1).
 *
 * ⚠ `.strict()` THROUGHOUT, for the F-5b reason: zod's default STRIPS unknown
 * keys, so a field added to the main-process type and forgotten here would
 * vanish silently on the way to the renderer rather than failing loudly.
 */
export const dayFileChangeSchema = z
  .object({ status: z.string(), path: z.string() })
  .strict()

export const dayCommitSchema = z
  .object({
    sha: z.string(),
    at: z.string(),
    subject: z.string(),
    files: z.array(dayFileChangeSchema)
  })
  .strict()

export const dayDirtyFileSchema = z
  .object({ path: z.string(), status: z.string(), modifiedAt: z.string() })
  .strict()

export const dayRepoEvidenceSchema = z
  .object({
    repoKey: z.string(),
    /** Plural is normal: two projects can be two worktrees of one repository,
     *  and both names belong on the one heading. */
    projectNames: z.array(z.string()),
    commits: z.array(dayCommitSchema),
    dirty: z.array(dayDirtyFileSchema),
    symbols: z.array(z.string()),
    tests: z.array(z.string())
  })
  .strict()

export const dayEvidenceSchema = z
  .object({
    date: z.string(),
    generatedAt: z.string(),
    repos: z.array(dayRepoEvidenceSchema),
    /** The git identities the commit list was filtered to (F76). `.default([])`
     *  so a report stored before the filter existed still parses on read-back —
     *  and empty correctly renders as "unfiltered", which is the honest reading
     *  of a snapshot taken when no filter was applied. */
    identities: z.array(z.string()).default([]),
    /** What was NOT included and why — a project absent without explanation
     *  reads as "nothing happened there". */
    skipped: z.array(z.object({ projectName: z.string(), reason: z.string() }).strict())
  })
  .strict()
export type DayEvidenceWire = z.infer<typeof dayEvidenceSchema>

/** `YYYY-MM-DD`, a LOCAL calendar date. Checked rather than trusted because it
 *  reaches a SQL primary key and a git `--since` argument. */
export const dayDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')

export const dayReportGenerateRequestSchema = z
  .object({
    date: dayDateSchema,
    /** The reporting zone, minutes EAST of UTC (so New York in August is
     *  -240). Sent by the renderer because the window belongs to the user's
     *  clock, and stored so a regenerated report reproduces the same day
     *  rather than silently shifting across a DST boundary. */
    utcOffsetMinutes: z.number().int().min(-840).max(840),
    /** False skips the model call entirely and returns the deterministic
     *  render. The evidence is the durable part; the prose is a convenience
     *  over it. */
    summarize: z.boolean()
  })
  .strict()
export type DayReportGenerateRequest = z.infer<typeof dayReportGenerateRequestSchema>

export const dayReportReadRequestSchema = z.object({ date: dayDateSchema }).strict()

export const dayReportSchema = z
  .object({
    date: z.string(),
    generatedAt: z.string(),
    utcOffsetMinutes: z.number().int(),
    evidence: dayEvidenceSchema,
    /** NULL MEANS SOMETHING: no summarizer configured, or the call failed. The
     *  report is useful without it, so this is a nullable field rather than a
     *  reason to fail the whole response. */
    summary: z.string().nullable(),
    /** Why there is no summary, when there is none. Null when prose was not
     *  asked for, or when it succeeded. */
    summaryError: z.string().nullable(),
    markdown: z.string()
  })
  .strict()
export type DayReport = z.infer<typeof dayReportSchema>

export const dayReportListResponseSchema = z.object({ dates: z.array(z.string()) }).strict()
export type DayReportListResponse = z.infer<typeof dayReportListResponseSchema>

/**
 * Which credential profile and model write the day's prose (D153).
 *
 * ⚠ NULLABLE AS A WHOLE, and "none" is a fully supported configuration rather
 * than an error state: the report renders its bullets deterministically with
 * no model at all. The pair is nullable TOGETHER because half of it is
 * useless — a model with no credential cannot be dialled, and a credential
 * with no model does not say what to dial.
 *
 * ⚠ CARRIES NO KEY MATERIAL, EVER. A credential profile ID is a pointer that
 * main resolves through `resolveCredential`; the plaintext never crosses the
 * bridge in either direction (D33 clause 3).
 */
export const daySummarizerSchema = z
  .object({ credentialProfileId: z.uuid(), modelId: z.string().min(1).max(200) })
  .strict()
export type DaySummarizer = z.infer<typeof daySummarizerSchema>

export const daySummarizerGetResponseSchema = z
  .object({ summarizer: daySummarizerSchema.nullable() })
  .strict()
export type DaySummarizerGetResponse = z.infer<typeof daySummarizerGetResponseSchema>

export const daySummarizerSetRequestSchema = z
  .object({ summarizer: daySummarizerSchema.nullable() })
  .strict()
export type DaySummarizerSetRequest = z.infer<typeof daySummarizerSetRequestSchema>

/* ------------------------------------------------------------------ */
/* Phase 5 / Task 5-4: voice settings and refinement                   */
/* ------------------------------------------------------------------ */

/**
 * The three refinement levels (D137). `verbatim` is the offline floor: no
 * network, no key, no LLM (D155). `cleanup` is the default (VoicePlan §2).
 *
 * ⚠ THE MODE IS CHOSEN BEFORE DICTATION AND NEVER AFTER IT (D160). There is no
 * mode-switch-after-the-fact and no "restore the original" — once written to a
 * PTY the text is not retractable (VoicePlan §6.1) — so this is a SETTING, not
 * a per-dictation control.
 */
export const voiceRefinementModeSchema = z.enum(['verbatim', 'cleanup', 'organize'])
export type VoiceRefinementMode = z.infer<typeof voiceRefinementModeSchema>

/** D159: base.en (141 MB) is the default; small.en (465 MB) is the opt-in
 *  upgrade. `tiny.en` and `medium.en` are deliberately not offered. */
export const voiceWhisperModelSchema = z.enum(['base.en', 'small.en'])
export type VoiceWhisperModel = z.infer<typeof voiceWhisperModelSchema>

/** hold = push-to-talk (release ends the capture); toggle = press to start,
 *  press again to stop (VoicePlan §7). */
export const voiceActivationSchema = z.enum(['hold', 'toggle'])
export type VoiceActivation = z.infer<typeof voiceActivationSchema>

/**
 * Which credential profile and model perform Clean up / Organize.
 *
 * ⚠ THE SAME POINTER SHAPE AS `daySummarizerSchema`, AND FOR THE SAME REASONS:
 * a profile ID that main resolves through `resolveCredential` — the plaintext
 * never crosses the bridge in either direction (D33 clause 3) — and the pair is
 * nullable TOGETHER, because half of it is useless. Null means "no refinement
 * model": Clean up and Organize then insert the original and say so, and
 * Verbatim is unaffected.
 */
export const voiceRefinerSchema = z
  .object({ credentialProfileId: z.uuid(), modelId: z.string().min(1).max(200) })
  .strict()
export type VoiceRefiner = z.infer<typeof voiceRefinerSchema>

/**
 * The "Voice & dictation" settings (VoicePlan §8.4). Stored whole, as one JSON
 * value in `settings`, and always returned whole — the renderer never holds a
 * partial picture of them.
 */
export const voiceSettingsSchema = z
  .object({
    model: voiceWhisperModelSchema,
    activation: voiceActivationSchema,
    /**
     * The push-to-talk chord in canonical form ("ScrollLock", "Ctrl+Shift+Space"),
     * or NULL to turn the global hotkey OFF entirely. Off means the OS-wide keyboard
     * hook is not installed at all — not "installed and ignoring keys" — which
     * is the only honest form of off for a hook that sees every keystroke.
     * Click-to-talk is unaffected either way.
     */
    hotkey: z.string().max(60).nullable(),
    refinement: voiceRefinementModeSchema,
    /**
     * Chromium's `deviceId` for the microphone, or NULL for the system
     * default. An origin-scoped opaque string, not a hardware id — VoicePlan
     * §8.1's "which microphone, never a stable hardware id". The renderer
     * resolves it against `enumerateDevices()` and falls back to the default
     * if it is gone.
     */
    inputDeviceId: z.string().max(200).nullable(),
    refiner: voiceRefinerSchema.nullable(),
    /**
     * 5-4 follow-up: whether a capture stops ITSELF at the 300 s bound and
     * transcribes what it has. Off means the microphone stays open past the
     * bound (frames drop) until the user stops it — an explicit choice, and
     * the reason this is a setting rather than a rule. Default on.
     */
    autoStop: z.boolean()
  })
  .strict()
export type VoiceSettings = z.infer<typeof voiceSettingsSchema>

/**
 * The defaults, in the wire module so main and the renderer agree on them
 * without either owning them. `hotkey` MUST equal `formatChord(DEFAULT_CHORD)`
 * in `hotkeyCore` — `hotkey.test.ts` asserts the two never drift.
 */
export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  model: 'base.en',
  activation: 'hold',
  // A bare dead key — see DEFAULT_CHORD in hotkeyCore for why not Ctrl+R/D.
  hotkey: 'ScrollLock',
  refinement: 'cleanup',
  inputDeviceId: null,
  refiner: null,
  autoStop: true
}

export const voiceSettingsSetRequestSchema = z.object({ settings: voiceSettingsSchema }).strict()
export type VoiceSettingsSetRequest = z.infer<typeof voiceSettingsSetRequestSchema>

/** Both channels answer with what is STORED, so the renderer renders main's
 *  state rather than its own optimistic draft (the `setModelShortlisted`
 *  discipline). `ok: false` carries a refusal reason and the UNCHANGED stored
 *  settings. */
export const voiceSettingsResponseSchema = z
  .object({ ok: z.boolean(), reason: z.string().max(300).nullable(), settings: voiceSettingsSchema })
  .strict()
export type VoiceSettingsResponse = z.infer<typeof voiceSettingsResponseSchema>

/** One row per offered whisper model: is it on disk, and how big is it. */
export const voiceModelStatusSchema = z
  .object({
    id: voiceWhisperModelSchema,
    /** The exact download size, so the settings screen shows a measured
     *  number rather than a rounded one that drifts from the file. */
    bytes: z.number().int().positive(),
    /** `ready` = present and the right size; `missing` = downloads on first
     *  use; `wrong-size` = a truncated file that will be re-downloaded. */
    state: z.enum(['ready', 'missing', 'wrong-size'])
  })
  .strict()
export type VoiceModelStatus = z.infer<typeof voiceModelStatusSchema>

export const voiceModelStatusResponseSchema = z
  .object({ models: z.array(voiceModelStatusSchema) })
  .strict()
export type VoiceModelStatusResponse = z.infer<typeof voiceModelStatusResponseSchema>

/* ------------------------------------------------------------------ */
/* Phase 5 / Task 5-1: voice capture                                   */
/* ------------------------------------------------------------------ */

/**
 * The rate every frame on the wire is in, and the rate the schema below
 * asserts as a literal.
 *
 * ⚠ ONE HOME, IN `shared/`, BECAUSE ALL THREE PROCESSES NEED IT. The renderer
 * builds the `AudioContext` with it, main refuses anything else, and the pure
 * core re-exports it. A renderer may not import from `src/main/`, so a copy
 * over there is the only alternative — and a sample rate that disagrees across
 * two files does not error, it transcribes badly (F80's retired half: Chromium
 * honours the requested rate exactly, so a mismatch here would be silent).
 */
export const VOICE_SAMPLE_RATE = 16_000

/**
 * Samples per frame — 1024, which is **64 ms** at 16 kHz and therefore
 * ~15.6 frames/second.
 *
 * Chosen as a power of two so the worklet accumulates whole render quanta
 * (Web Audio delivers 128 samples at a time, so eight quanta make one frame
 * with no partial-frame bookkeeping), and large enough that the per-frame IPC
 * envelope is negligible beside its 2 KB payload.
 */
export const VOICE_FRAME_SAMPLES = 1_024

/**
 * The largest frame main will look at, four times the nominal size.
 *
 * ⚠ IT IS A CEILING ON A HOSTILE OR BUGGY PRODUCER, NOT A SECOND FRAME SIZE.
 * The renderer always sends `VOICE_FRAME_SAMPLES`; this is what stops a
 * `sampleCount` of 2^31 from being taken seriously before anything allocates
 * against it. The headroom exists so a future frame size can be raised without
 * a wire change, not because any producer is expected to vary.
 */
export const VOICE_MAX_FRAME_SAMPLES = 4_096

/**
 * The capture's state. `refining`, `ready-for-review` and `inserted`
 * (VoicePlan §9) arrive with 5-3 / 5-4 and are deliberately ABSENT rather than
 * declared-and-unreachable — D76's rule, one layer down.
 *
 * ⚠ `failed` HAD NO PRODUCER IN TASK 5-1 AND NOW HAS ONE. 5-1 recorded that its
 * sink could not fail — it counted frames and discarded them, and a dropped
 * frame is a normal outcome — and predicted that "Task 5-2's whisper child
 * process is the first thing main owns that can fail". It is: a missing engine,
 * a failed model download, a non-zero exit and a timeout all land here, with a
 * sanitized reason in `message`.
 *
 * ⚠ `inserted` IS THE NORMAL TERMINAL STATE FROM TASK 5-3 ONWARD, AND
 * `ready-for-review` BECAME THE RECOVERY ONE. D160 makes v1 direct-to-prompt
 * with no composer, so the happy path ends with the transcript written to the
 * dictation target's prompt — that is `inserted`. `ready-for-review` now means
 * what it always literally said, "main holds a transcript that nothing has taken
 * yet", which is exactly the target-died case: the words survive and are
 * surfaced rather than discarded or redirected (VoicePlan §7.3, §9).
 *
 * `refining` arrived with Task 5-4, between `finalizing` and the write.
 */
export const voiceStateNameSchema = z.enum([
  'ready',
  'listening',
  'finalizing',
  /**
   * Task 5-4: the transcript exists and a Clean up / Organize call is in
   * flight. Verbatim never enters this state — it makes no call — so a
   * dictation that shows `refining` is one whose text is, at that moment,
   * leaving the machine on the user's own key (VoicePlan §5's disclosure).
   */
  'refining',
  'ready-for-review',
  'inserted',
  'failed'
])
export type VoiceStateName = z.infer<typeof voiceStateNameSchema>

/**
 * Why a frame was dropped. A CLOSED ENUM, so the renderer can render a cause
 * without main ever sending it a string it composed.
 *
 * `malformed` is the one that does not come from `admitFrame`: it is what main
 * records when the envelope failed to parse at all, which is the only failure
 * that cannot be described in terms of the frame's own fields.
 */
export const voiceDropReasonSchema = z.enum([
  'queue-full',
  'stale-session',
  'bad-sequence',
  'length-mismatch',
  'bad-sample-rate',
  'malformed',
  /**
   * Task 5-2: the capture has reached the longest utterance this feature will
   * hold, and further frames are discarded.
   *
   * ⚠ DISTINCT FROM `queue-full`, AND CONFLATING THEM WOULD INVERT THE
   * DIAGNOSIS. `queue-full` means the CONSUMER stalled — a bug, or a machine
   * under load. `capture-full` means the SPEAKER kept going past the bound, which
   * is a person doing something reasonable that this feature has chosen not to
   * support. One is "something is wrong", the other is "you have said enough".
   */
  'capture-full'
])
export type VoiceDropReason = z.infer<typeof voiceDropReasonSchema>

/**
 * One frame of 16 kHz mono PCM, renderer -> main.
 *
 * ⚠ THE ENVELOPE IS FULLY VALIDATED; THE SAMPLE PAYLOAD IS LENGTH- AND
 * TYPE-CHECKED, NOT ELEMENT-VALIDATED — AND THAT IS A DECLARED POSITION, NOT A
 * D1 EXEMPTION.
 *
 * D1 requires every IPC payload be Zod-validated in main. Element-validating
 * 1,024 samples ~16 times a second would spend more time in Zod than the
 * transcriber will spend transcribing, for a check that cannot fail
 * meaningfully: an `Int16Array`'s elements are Int16 BY CONSTRUCTION — there is
 * no value you can put in one that a per-element schema would reject. What CAN
 * be wrong is the envelope — the sample rate, the sequence number, the declared
 * length against the real one — and all three are checked. `sampleCount` is
 * cross-checked against `samples.length` in main by `admitFrame`, because Zod
 * validates the two fields independently and has no opinion on whether they
 * agree; a disagreement is a DROPPED FRAME, not a throw.
 *
 * ⚠ D14, IN THE DIRECTION IT HAS NEVER BEEN TESTED IN. An `Int16Array` crosses
 * Electron's structured clone natively — but it must be a REAL `Int16Array`,
 * not a Pinia/`reactive()` proxy around one. `capture.ts` builds it fresh per
 * frame and hands it straight to `send`; a frame that is ever parked in a store
 * and forwarded from there fails with "An object could not be cloned" and there
 * is NO compile-time signal for it.
 */
export const voiceFrameSchema = z
  .object({
    captureId: z.uuid(),
    seq: z.number().int().nonnegative(),
    sampleRate: z.literal(VOICE_SAMPLE_RATE),
    sampleCount: z.number().int().positive().max(VOICE_MAX_FRAME_SAMPLES),
    samples: z.instanceof(Int16Array)
  })
  .strict()
export type VoiceFrame = z.infer<typeof voiceFrameSchema>

export const voiceCaptureStartResponseSchema = z
  .object({
    started: z.boolean(),
    /** The id every frame of this capture must carry. Null on a refusal. */
    captureId: z.uuid().nullable(),
    /** Echoed so the renderer asserts main's rate rather than assuming its own. */
    sampleRate: z.literal(VOICE_SAMPLE_RATE),
    frameSamples: z.number().int().positive(),
    /** Why not, when `started` is false. A closed token, not prose. */
    refusal: z.enum(['already-capturing']).nullable()
  })
  .strict()
export type VoiceCaptureStartResponse = z.infer<typeof voiceCaptureStartResponseSchema>

export const voiceCaptureStopRequestSchema = z.object({ captureId: z.uuid() }).strict()
export type VoiceCaptureStopRequest = z.infer<typeof voiceCaptureStopRequestSchema>

export const voiceCaptureStopResponseSchema = z
  .object({
    stopped: z.boolean(),
    framesAdmitted: z.number().int().nonnegative(),
    framesDropped: z.number().int().nonnegative()
  })
  .strict()
export type VoiceCaptureStopResponse = z.infer<typeof voiceCaptureStopResponseSchema>

/**
 * The capture's state, pushed on every change.
 *
 * ⚠ `keepingUp` IS THE FIELD BACKPRESSURE EXISTS FOR. A bounded queue that
 * drops silently is indistinguishable from a microphone that went quiet, so the
 * sink has to be able to SAY it stopped keeping up — VoicePlan §4.1's second
 * obligation, and Task 5-1's acceptance criterion that drops are reported
 * rather than swallowed.
 */
export const voiceStateEventSchema = z
  .object({
    state: voiceStateNameSchema,
    captureId: z.uuid().nullable(),
    framesAdmitted: z.number().int().nonnegative(),
    framesDropped: z.number().int().nonnegative(),
    queued: z.number().int().nonnegative(),
    /** The bound, sent so the renderer never hardcodes main's queue policy. */
    queueMax: z.number().int().positive(),
    lastDropReason: voiceDropReasonSchema.nullable(),
    keepingUp: z.boolean(),
    /**
     * Task 5-2: how many CHARACTERS the held transcript has. A COUNT, NEVER THE
     * TEXT.
     *
     * ⚠ THE TRANSCRIPT ITSELF DOES NOT CROSS THIS BRIDGE IN TASK 5-2, AND THAT
     * IS THE TASK'S OWN NON-GOAL — "the transcript stops in main". It is held in
     * main as the source of truth (D161, in memory since no table exists) and
     * Task 5-3 is what carries it to a dictation target. A count is enough for a
     * UI to say "12 words captured" and carries no content, which is why no
     * `voice:transcript` channel is added here: there is no consumer for one yet,
     * and D76's rule is not to build the surface before the thing.
     */
    transcriptChars: z.number().int().nonnegative(),
    /**
     * Task 5-3: the live input level, 0..1, for the overlay's meter.
     *
     * ⚠ THE ONE FIELD THAT IS NOT EDGE-TRIGGERED, AND ITS CADENCE IS BOUNDED BY
     * FRAME COUNT RATHER THAN BY A CLOCK. A VU meter is inherently continuous,
     * so it cannot ride the "fire only on a real change" rule the rest of this
     * event follows. Main pushes it every other admitted frame — ~8 times a
     * second at 15.6 fps, only while listening, and never at all when idle.
     * It is a NUMBER derived from the audio, never the audio.
     */
    level: z.number().min(0).max(1),
    /** A sanitized reason for `failed`, or for a refinement fallback on
     *  `inserted` / `ready-for-review`. NEVER audio, never a transcript, never
     *  a device label — the label is identifying and F79 recorded that Electron
     *  hands it out; nothing in Chorus passes it on. */
    message: z.string().nullable(),
    /**
     * Task 5-4: what happened to the last dictation's text before it was
     * written. Null until a transcript exists.
     *
     * ⚠ THE OUTCOME IS A CLOSED ENUM AND THE MESSAGE BESIDE IT IS A FIXED
     * STRING, so the renderer can say "inserted verbatim — refinement timed
     * out" without main ever composing a sentence from anything the user said.
     * `refined` means the written text is a VALIDATED refinement; `fallback`
     * means the ORIGINAL was written and `message` says why; `verbatim` means
     * the mode made no call at all — the offline floor working, not a failure.
     */
    refinement: z
      .object({
        mode: voiceRefinementModeSchema,
        outcome: z.enum(['verbatim', 'refined', 'fallback'])
      })
      .strict()
      .nullable()
  })
  .strict()
export type VoiceStateEvent = z.infer<typeof voiceStateEventSchema>

/**
 * The renderer's report of which pane holds DOM focus, and main's push of which
 * pane wears the ring. Null is meaningful in both directions: no pane focused,
 * and no ring shown.
 */
export const voiceTargetSchema = z
  .object({
    sessionId: z.uuid().nullable(),
    /** For the overlay's "dictating into <name>" line. A pane title the user
     *  already sees on screen — never transcript text. */
    title: z.string().max(200).nullable()
  })
  .strict()
export type VoiceTarget = z.infer<typeof voiceTargetSchema>

export const voiceHotkeyStatusSchema = z
  .object({
    /** Whether the global hook is running. False is a supported state, not an
     *  error — click-to-talk is unaffected either way. */
    available: z.boolean(),
    /** The bound chord in canonical form, e.g. "Ctrl+Shift+Space". Task 5-4:
     *  NULL when push-to-talk is turned off in settings — a state distinct from
     *  "the hook failed to load", and `reason` says which. */
    chord: z.string().max(60).nullable(),
    /** Why PTT is unavailable, when it is. A loader/OS message, never user
     *  content. Null when available. */
    reason: z.string().max(300).nullable()
  })
  .strict()
export type VoiceHotkeyStatus = z.infer<typeof voiceHotkeyStatusSchema>
