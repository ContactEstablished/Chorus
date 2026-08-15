import * as pty from 'node-pty'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { getAdapterOrThrow } from '../adapters/registry'
import {
  isPtyAdapter,
  supportsHooks,
  supportsInstructions,
  supportsResume,
  type DiscoverSessionContext,
  type PtyLaunchHooks,
  type PtyLaunchInstructions,
  type PtyLaunchRoute,
  type ResolvedCredential
} from '../adapters/types'
import type { AgentEventListener } from './agentEvents'
import type { ContextUsageTracker } from './contextUsage'
import { composeChildEnv } from '../adapters/env'
import { computeRestoreSet } from './restore'
import { logger } from './logger'
import { createSessionOutput, type SessionOutput } from './sessionOutput'
import {
  isResumeAction,
  planExitDisposition,
  planResume,
  toLaunchModifier
} from './resumeCore'
import {
  capTail,
  conversationBoundary,
  flattenTerminalText,
  replayEpilogue,
  stripAltScreen,
  SCROLLBACK_MAX_CHARS
} from './scrollbackCore'
import type { ScrollbackStore } from './scrollbackStore'
import type { AgentKind, EffortLevel } from '../../shared/ipc'
import type { StorageService } from './storage'

/**
 * Ring buffer cap for session replay, in characters. Roughly 50k lines of
 * typical terminal output. Full transcript-to-disk mirroring comes later.
 */
const BUFFER_MAX_CHARS = 4_000_000

/** D33 resolution (e): a held carry (a chunk tail that could be the start of
 *  a secret) is released by timer so a TUI pausing mid-prefix never stalls
 *  rendering. 50 ms is long enough that a normal output burst never triggers
 *  a mid-burst flush, short enough to be imperceptible — measured at runtime
 *  (Task 3-5 verification), not just asserted. */
const SCRUB_FLUSH_MS = 50

/** D16: spawns within one restore run are staggered to keep ConPTY creation
 *  off the UI thread's critical path. */
const RESTORE_STAGGER_MS = 500
/** Soft cap on restore relaunches per project per run — bounds process count
 *  against a pathological persisted layout (spec §6/§12). Beyond-cap members
 *  are healed to exited chrome, never spawned. */
const RESTORE_CAP = 16

/**
 * Phase 4a: how much of the ring buffer's TAIL the adapter's failure classifier
 * sees (`ResumeExitObservation.output`).
 *
 * ⚠ BOUNDED ON PURPOSE. The adapter needs the last screen — a one-line vendor
 * error — not the session. The value is post-scrub by construction (it IS the
 * ring buffer, fed by the single emit path), and it is NEVER LOGGED: the
 * contract says so, and it is a slice of the user's terminal.
 */
const RESUME_OBSERVATION_CHARS = 8_000

/* ⚠ THE DISCOVERY POLL SCHEDULE THAT USED TO LIVE HERE IS GONE (F64). It ran
 * four scans over ~10.5 s and could never have worked: codex does not write its
 * rollout until the user submits their FIRST TURN — 22.6 s after spawn in one
 * measured run, 3 m 19 s in another — so the window always expired before the
 * file existed. Waiting is now the ADAPTER's job (it resolves when the rollout
 * appears) and bounding that wait is this file's, via the abort signal. */

export interface SessionSnapshot {
  sessionId: string
  buffer: string
  status: 'running' | 'exited'
  exitCode: number | null
}

interface PtySession {
  id: string
  agent: AgentKind
  pty: pty.IPty
  status: 'running' | 'exited'
  exitCode: number | null
  /** Task 3a-1: end intent, set by kill()/dispose() BEFORE pty.kill() so the
   *  exit event can never race the flag and misclassify a user kill as an
   *  agent failure. Lives on the session record, so it dies with the record. */
  killRequested: boolean
  /** The session-shaped ingest pipeline (Task 3-6 Commit 1, D46): scrub →
   *  ring buffer → broadcast, plus the carry-flush timer. Its scrubber
   *  closure is — via the match set — THE ONLY PLACE in Chorus that retains
   *  injected plaintext beyond the spawn call.
   *
   *  D33 resolution (a), verbatim in intent: clause 4 says the decrypted
   *  plaintext "never enters a retained variable". Exact-match scrubbing
   *  REQUIRES exactly that, so clause 4 carries an explicit carve-out for this
   *  match set: main memory only, never persisted, never logged, never sent
   *  over IPC, cleared on session end.
   *
   *  NAMED LIMIT: this widens the crash-dump exposure window from the
   *  milliseconds of a spawn call to the lifetime of the session. Ratified as
   *  sound without a council round-trip because an attacker who can read this
   *  heap can already read the child process's environment block — the same
   *  excluded threat class, a longer duration, no new class.
   *
   *  The match set dies with this object — the closure IS the storage, so
   *  there is no separate structure to forget to clear (safer by construction
   *  than a Map<sessionId, Set<string>> alongside). */
  output: SessionOutput
  /**
   * Task 4a-4: the history this session had BEFORE this PTY existed, read once
   * from the disk mirror at spawn. Empty for a session with no mirror — which
   * is every brand-new session.
   *
   * ⚠ IT IS PREPENDED CONTEXT, NOT LIVE OUTPUT, AND IT LIVES HERE RATHER THAN
   * INSIDE `output` FOR EXACTLY THAT REASON. It must never be re-broadcast
   * through `dataListeners` as if it had just arrived, and it must never be
   * re-persisted — a seed that flowed back through the emit path would double
   * the history on every restart until the cap ate the oldest of it. Keeping it
   * outside `SessionOutput` makes that structural instead of remembered:
   * `snapshot()` is the only reader.
   */
  replaySeed: string
}

type DataListener = (sessionId: string, data: string) => void
type ExitListener = (sessionId: string, exitCode: number) => void
type RestoredListener = (sessionId: string) => void

/** What a dispatch record needs and `spawn` already has (Task 3a-1).
 *  Deliberately a plain fact bundle, not a telemetry type: SessionManager
 *  announces lifecycle and stays ignorant of what listens. */
export interface SessionStartInfo {
  readonly sessionId: string
  readonly agent: AgentKind
  readonly cwd: string
  /** D42's discriminator, derived from the SAME fact composeChildEnv uses to
   *  select its policy: a credential is present, or it is not. */
  readonly authMode: 'subscription' | 'api_key'
  readonly model: string | null
  readonly providerName: string | null
}
type StartListener = (info: SessionStartInfo) => void

/** What a BYOK launch carries beyond a plain one (Task 3-6). All three are
 *  produced by the IPC layer's resolveCredential step, which retains nothing
 *  after the launch call returns (D33 clause 4). */
export interface LaunchOptions {
  /** Exact values to register with the per-session scrubber (3-5's seam).
   *  The spawn-time registration set is the UNION of this and the request's
   *  secretEnv values, so "injected" and "scrubbed" cannot diverge. */
  readonly secrets?: readonly string[]
  /** The decrypted credential, handed to the adapter's buildLaunch. */
  readonly credential?: ResolvedCredential
  /** The route's non-secret connection metadata (D47/D48), for adapters that
   *  point the CLI at a custom endpoint. */
  readonly route?: PtyLaunchRoute
  /**
   * D148: the memory usage contract text, already rendered for THIS agent's
   * mechanism by ipc.ts — the layer that knows the project and can therefore
   * answer "does it have memory configured at all". Absent for a project with
   * no memory, which is most of them.
   *
   * ⚠ NON-SECRET, AND UNLIKE EVERY OTHER FIELD ON THIS INTERFACE IT CANNOT
   * BECOME ONE: it is a static string plus an MCP server name, with no path
   * from user input into it. That is why it may legally reach argv.
   */
  readonly instructions?: string
  /** Task 3a-4: the app-level effort level for this launch (PLAN §4's
   *  Fast/Balanced/Deep/Max). PER-LAUNCH AND UNPERSISTED — `launch_profiles`
   *  (3a-5) is its home. Absent means no effort argument is emitted at all. */
  readonly effort?: EffortLevel
  /** Task 3a-4: raw CLI override tokens, rank 1 of the effort precedence
   *  order. No input surface exists in 3a-4 — see PtyLaunchSpec.extraArgs for
   *  the argv-is-world-readable warning 3a-5 inherits. */
  readonly extraArgs?: readonly string[]
  /**
   * Task 3a-5: NON-SECRET env additions from a launch profile's `env_json`.
   *
   * ⚠ NEVER A CREDENTIAL. Main REFUSES to store a value matching a known key
   * shape (`validateProfileShape`, reusing scrubSecrets — the
   * extra_headers_json precedent), so by the time a value reaches here it has
   * already been rejected if it looked like one. A key travels `secrets` /
   * `credential`, which is a different channel with different handling.
   *
   * Merged over the ADAPTER's own envAdditions in spawn(), which makes the full
   * chain: inherited < pins (D54) < adapter additions < PROFILE ENV <
   * secretEnv. Deliberately merged there rather than in an adapter, because
   * `src/main/adapters/` is byte-identical across this commit by design.
   */
  readonly envAdditions?: Readonly<Record<string, string>>
  /**
   * Q7 / D143(g): this launch begins a conversation that is NOT continuous with
   * the history already in the mirror, so a visible boundary is emitted before
   * any PTY output.
   *
   * ⚠ ABSENT FOR RESTORE, WHICH IS CONTINUOUS — a restored session resumes the
   * same conversation, so its retained history needs no separator. Present for
   * `session:restart` (a deliberate fresh conversation) and for the automatic
   * relaunch after a classified resume failure.
   */
  readonly conversationBoundary?: 'restart' | 'context-not-restored'
}

/**
 * Owns PTY sessions in the main process. Renderers are views: they attach by
 * sessionId over IPC and never touch the process. N concurrent sessions per
 * agent kind are supported (Task 1-4): each session is a distinct sessions-row
 * id + PTY, and no lookup ever collapses same-kind sessions together.
 *
 * Storage reaches this class ONLY for the D16 restore engine (heal writes and
 * the after-success 'running' write are the contract's own steps); launch/
 * attach keep the 1-4 division of labor — the IPC layer owns rows.
 */
export class SessionManager {
  private sessions = new Map<string, PtySession>()
  private dataListeners = new Set<DataListener>()
  private exitListeners = new Set<ExitListener>()
  private restoredListeners = new Set<RestoredListener>()
  private startListeners = new Set<StartListener>()
  private storage: StorageService | null = null
  /** Restore-relaunched sessions whose pane has not attached since — the badge
   *  signal. An entry is consumed by the first attach that reports it, so
   *  every restored pane wears the fresh-conversation badge exactly once, no
   *  matter how late it mounts (a timestamp window would lose slow dev cold
   *  starts — found at runtime in 1-5 verification). */
  private restoredUnbadged = new Set<string>()
  /** projectId -> restore-set ids queued but not yet spawned this run. */
  private restorePending = new Map<string, Set<string>>()
  /** The hook listener, or null when none is bound — every hook path below is
   *  written so that null means "launch exactly as this app always has". */
  private hooks: AgentEventListener | null = null
  /** Directory main reserved for per-session hook config files. */
  private hookConfigDir: string | null = null
  /**
   * D148: directory main reserved for per-session instruction files.
   *
   * ⚠ NULL IS A LEGAL STEADY STATE, like `hookConfigDir` above — an app that
   * could not create the directory launches without contracts, never not at
   * all. And it is a SEPARATE field from `hookConfigDir` on purpose: hooks bind
   * only when the listener claims its port, and the memory contract has to
   * survive a machine where it does not.
   */
  private instructionsDir: string | null = null
  /**
   * v16: the context-usage tracker, or null. Only the CODEX path uses it from
   * here — Claude's readings arrive through the hook listener instead, so this
   * reference exists purely to give the output scan somewhere to report to.
   *
   * ⚠ NULL IS A LEGAL STEADY STATE, exactly like `hooks` above: an app booted
   * without a tracker runs sessions that draw no ring, and nothing else differs.
   */
  private contextUsage: ContextUsageTracker | null = null
  /**
   * Task 4a-4: the scrollback mirror, or null. Same late-binding shape and the
   * same "unbound is legal" contract as `hooks` and `contextUsage` above — an
   * app booted without one runs sessions whose panes come back empty after a
   * restart, which is exactly the pre-4a-4 app.
   *
   * ⚠ BOUND RATHER THAN CONSTRUCTED HERE because the directory is
   * `join(app.getPath('userData'), 'scrollback')`, and this file imports no
   * Electron — `index.ts` owns that resolution beside the `agent-hooks`
   * directory it already owns.
   */
  private scrollback: ScrollbackStore | null = null
  /**
   * Phase 4a / Q3: how many PTYs this row id has had this run. Bumped by every
   * `spawn()`, and re-checked IMMEDIATELY before a discovered pointer is
   * persisted.
   *
   * ⚠ NOT REDUNDANT WITH THE ABORT SIGNAL, and that is the reason it exists. An
   * abort that fires while the discovery promise is already resolving still
   * lands in its own continuation; the generation is the fact that says "this
   * answer is about the PTY that is CURRENTLY under this row id". The signal is
   * necessary, the generation is what is sufficient.
   */
  private spawnGenerations = new Map<string, number>()
  /** In-flight session-id discovery per row id (Q3). Aborted on kill, quit,
   *  restart and any superseding spawn of the same id. */
  private discoveries = new Map<string, AbortController>()

  /** Called once from the boot sequence after storage init (the manager is
   *  constructed at module scope, before the DB exists). */
  bindStorage(storage: StorageService): void {
    this.storage = storage
  }

  /** Same late-binding shape as `bindStorage`, and for the same reason: the
   *  listener needs a bound port and a userData path, neither of which exists
   *  at module scope. Unbound is a legal steady state — an app booted without
   *  a listener spawns hook-free sessions and shows the pre-hooks lights. */
  bindHooks(hooks: AgentEventListener, configDir: string): void {
    this.hooks = hooks
    this.hookConfigDir = configDir
  }

  /**
   * D148: same late-binding shape, and DELIBERATELY NOT PART OF `bindHooks`.
   * `bindHooks` is only reached when the hook listener binds its port; folding
   * this into it would mean a machine whose port is refused silently loses the
   * memory contract too — two unrelated failures welded together.
   */
  bindInstructionsDir(dir: string): void {
    this.instructionsDir = dir
  }

  /** v16, same late-binding shape and the same "unbound is legal" contract. */
  bindContextUsage(tracker: ContextUsageTracker): void {
    this.contextUsage = tracker
  }

  /** Task 4a-4, same late-binding shape and the same "unbound is legal"
   *  contract. Must be bound BEFORE the first restore, or the sessions that
   *  restore relaunches spawn with no history to seed from. */
  bindScrollback(store: ScrollbackStore): void {
    this.scrollback = store
  }

  /**
   * Drop a session's disk mirror. Called when its ROW is deleted (D16
   * resolution (d): pane close deletes the row), because a mirror that outlives
   * its row is a plaintext record of the user's work with nothing left pointing
   * at it — and nothing that would ever show it to them again.
   *
   * Tolerant of an unknown id and of an unbound store, like `retireHooks`: this
   * is cleanup on a destruction path, and throwing here would break closing a
   * pane for the sake of a file that may not exist.
   */
  removeScrollback(sessionId: string): void {
    this.scrollback?.remove(sessionId)
  }

  /**
   * Q3: abandon any session-id discovery still in flight for this row id.
   *
   * ⚠ CALLED ON EVERY PATH THAT ENDS OR REPLACES A PTY — `kill()`, `dispose()`
   * and the top of `spawn()` (which covers `session:restart` and the restore
   * relaunch, since both go through it). A discovery that outlives its PTY can
   * only answer a question about a process that no longer exists, and an aborted
   * result must never be persisted.
   *
   * Tolerant of an unknown id, like `retireHooks`: this runs on destruction
   * paths where there may be nothing to abandon.
   */
  private abortDiscovery(sessionId: string): void {
    const controller = this.discoveries.get(sessionId)
    if (!controller) return
    this.discoveries.delete(sessionId)
    controller.abort()
  }

  /**
   * Retire a session's hook wiring: revoke the capability token and delete the
   * config file that carried it.
   *
   * ⚠ CALLED ON EVERY EXIT PATH, and that is a security property rather than
   * tidiness — a token left in the map is a live capability to impersonate a
   * session that no longer exists, and the file that holds it is readable for
   * as long as it is on disk. Deliberately tolerant of a missing file: a
   * hook-less launch (no curl, unwritable dir) has nothing to remove, and
   * throwing here would break exit handling for a cleanup no-op.
   */
  private retireHooks(sessionId: string): void {
    this.hooks?.revoke(sessionId)
    const dir = this.hookConfigDir
    if (!dir) return
    try {
      fs.rmSync(join(dir, `${sessionId}.json`), { force: true })
    } catch (err) {
      logger.warn({ err, sessionId }, '[hooks] could not remove session hook config')
    }
  }

  /**
   * D148: the instruction file's sibling of `retireHooks`.
   *
   * ⚠ THE SAME "EVERY EXIT PATH" RULE, FOR A LESSER REASON. The file holds no
   * capability — it is a static contract plus a server name — but a per-session
   * file left on disk after the session is gone is litter that accumulates one
   * entry per launch, forever. Tolerant of a missing file for the same reason
   * `retireHooks` is: a launch that never got a contract has nothing to remove.
   */
  private retireInstructions(sessionId: string): void {
    const dir = this.instructionsDir
    if (!dir) return
    try {
      fs.rmSync(join(dir, `${sessionId}.md`), { force: true })
    } catch (err) {
      logger.warn({ err, sessionId }, '[memory] could not remove session instruction file')
    }
  }

  /**
   * Launch a brand-new session: spawn a fresh PTY under the given stable
   * sessions-row id (the IPC layer creates the row first — launch is the only
   * op that starts a PTY for a session this manager has never seen).
   *
   * `opts.secrets` are exact values to register with the per-session scrubber
   * so Chorus never STORES or REPLAYS them (D33 clause 7); `opts.credential`
   * and `opts.route` flow into the adapter's buildLaunch. Task 3-6 is the one
   * legal caller.
   *
   * SETTLED by Task 3-6 Step 7 (decision (b), F26): the restore path
   * (restore() -> this.spawn) passes NO options, and credentialed sessions
   * are NEVER auto-restored — restore() heals their rows to 'exited' instead
   * of relaunching them keyless. A restored BYOK session running silently on
   * ambient credentials is the one unacceptable outcome.
   */
  launch(agent: AgentKind, cwd: string, sessionId: string, opts: LaunchOptions = {}): SessionSnapshot {
    const session = this.spawn(agent, cwd, sessionId, opts)
    this.sessions.set(sessionId, session)
    return this.snapshot(session)
  }

  /**
   * Reattach a view to a session this manager already knows, replaying its
   * buffered output. A PURE VIEW BINDING — no spawn path at all (Task 1-5/D16:
   * the 1-4 attach-time relaunch gate is removed; Vue remounts panes on
   * sibling close, so attach must never resurrect a session — F5). An unknown id yields
   * `null` so the caller reports the row's persisted exit state; relaunch
   * lives in `restore()` and the session:restart channel only.
   */
  attach(sessionId: string): SessionSnapshot | null {
    const existing = this.sessions.get(sessionId)
    if (!existing) return null
    return this.snapshot(existing)
  }

  /**
   * The D16 restore contract, run at boot (active project) and on first tab
   * activation (lazy). Order matters:
   *   1. HEAL FIRST — every persisted 'running' row with no layout leaf is
   *      flipped to 'exited' BEFORE any spawn (the invisible-process guard:
   *      no PTY may exist that no pane can reach).
   *   2. Relaunch the restore set (leaves ∩ 'running' rows, minus live) under
   *      the ORIGINAL row ids with fresh PTYs: cwd re-validated per spawn
   *      (missing -> heal + the pane's own "Working directory not found"
   *      chrome, no sentinel exit code), 'running' written ONLY AFTER the
   *      spawn succeeds, spawns staggered, each success announced via
   *      onRestored for the fresh-conversation badge.
   * Idempotent within a run: healed rows stay healed, live sessions are
   * excluded by computeRestoreSet's live guard.
   */
  async restore(projectId: string): Promise<void> {
    const storage = this.requireStorage()
    const set = computeRestoreSet(
      storage.getPaneLayout(projectId),
      storage.getSessionsForProject(projectId),
      new Set(this.sessions.keys())
    )

    // better-sqlite3 is synchronous: the heal block and the selection read are
    // transactionally adjacent by construction (findings action 2).
    for (const row of set.toHeal) {
      storage.updateSessionStatus(row.id, 'exited', row.exitCode ?? null)
      logger.info(`[restore] healed running row with no layout leaf -> exited: ${row.id}`)
    }

    const pending = new Set(set.toRelaunch.map((r) => r.id))
    this.restorePending.set(projectId, pending)
    // Every member's conclusion is announced, success or not: a pane holding a
    // restorePending spinner re-attaches on the event and lands on live chrome
    // (running) or honest exited chrome (heal / cwd-missing / spawn failure).
    const conclude = (sessionId: string): void => {
      pending.delete(sessionId)
      for (const listener of this.restoredListeners) listener(sessionId)
    }
    // Task 3-6 Step 7, decision (b) — F26 settled: a session that launched on
    // a stored credential is NEVER auto-restored. Re-resolving it would mean
    // UNATTENDED DECRYPTION AT BOOT (a wider surface than D33's
    // decrypt-on-explicit-user-action model); relaunching it keyless would
    // silently run the agent on ambient credentials while the user believes
    // it runs on their profile — the one unacceptable outcome. So its row is
    // healed to honest exited chrome and its title carries the reason.
    //
    // Task 3a-5 / D49 + D53: the SET'S SOURCE changed and NOTHING ELSE. The
    // fact is now DERIVED per-session from the launch profile the session ran
    // under (fail-safe on an unresolvable pointer), replacing 3-6's global
    // `credentialed_sessions` settings list — an accepted Phase-3-only
    // expedient the roadmap flagged for retirement. This is a BODY SWAP, not a
    // call-site rewrite: the heal, the title, the log line and the
    // session:restart refusal are all byte-identical, deliberately, because
    // "behaviour did not regress" is the claim this task has to earn.
    //
    // ⚠ THIS FILE STILL CONTAINS ZERO REFERENCES TO THE VAULT, and that is the
    // structural half of the no-unattended-decrypt invariant. Restore heals; it
    // never resolves a credential. The user-initiated session:relaunch handler
    // in ipc.ts is the ONLY thing that does, and it is not reachable from here.
    const credentialed = storage.getCredentialedSessionIds(projectId)
    let spawned = 0
    try {
      for (const row of set.toRelaunch) {
        if (credentialed.has(row.id)) {
          storage.updateSessionStatus(row.id, 'exited', row.exitCode ?? null)
          storage.updateSessionTitle(
            row.id,
            'Credential not re-supplied — relaunch from the dialog to re-enter it'
          )
          logger.info(`[restore] credentialed session healed -> exited (no keyless restore): ${row.id}`)
          conclude(row.id)
          continue
        }
        if (spawned >= RESTORE_CAP) {
          storage.updateSessionStatus(row.id, 'exited', row.exitCode ?? null)
          logger.info(`[restore] cap ${RESTORE_CAP} reached; healed beyond-cap row -> exited: ${row.id}`)
          conclude(row.id)
          continue
        }
        if (!fs.existsSync(row.cwd)) {
          // Own chrome state ("Working directory not found"), resolved at
          // attach time from the row — no sentinel exit code (resolution c).
          storage.updateSessionStatus(row.id, 'exited', row.exitCode ?? null)
          logger.info(`[restore] cwd missing, healed -> exited: ${row.id} (${row.cwd})`)
          conclude(row.id)
          continue
        }
        try {
          const session = this.spawn(row.agent as AgentKind, row.cwd, row.id)
          this.sessions.set(row.id, session)
          // 'running' is written ONLY AFTER the spawn succeeds (resolution a):
          // a crash between spawn and write leaves the row 'exited', which is
          // self-consistent at the next boot's reconcile.
          storage.updateSessionStatus(row.id, 'running', null)
          this.restoredUnbadged.add(row.id)
          logger.info(`[restore] relaunched ${row.agent} session ${row.id}`)
          spawned++
        } catch (err) {
          // Spawn threw: no PTY exists, so the row must not say 'running'.
          storage.updateSessionStatus(row.id, 'exited', row.exitCode ?? null)
          logger.error({ err }, `[restore] spawn failed for ${row.id}:`)
        }
        conclude(row.id)
        await new Promise((resolve) => setTimeout(resolve, RESTORE_STAGGER_MS))
      }
    } finally {
      this.restorePending.delete(projectId)
    }
  }

  /**
   * How many sessions `restore(projectId)` would relaunch, WITHOUT relaunching
   * anything. Read-only: no spawn, no heal, no write of any kind.
   *
   * The launch splash's boot line is the only caller (`src/main/index.ts` reads
   * it just before creating the window and stamps it onto the renderer URL —
   * see `renderer/src/boot/bootInfo.ts` for why that, and not a channel).
   *
   * ⚠ IT SHARES `computeRestoreSet` AND ITS EXACT THREE INPUTS WITH `restore()`
   * ABOVE, and that is the whole design. The number on the splash cannot drift
   * from the number the engine acts on, because there is only one function that
   * decides it. Re-deriving "which sessions come back" here — even correctly,
   * even once — would create a second answer that stays right only until D16's
   * rules move.
   *
   * ⚠ IT IS THE RESTORE SET'S SIZE, WHICH IS AN UPPER BOUND. Three of
   * `restore()`'s own guards can still heal a member instead of spawning it
   * (a credentialed session is never keyless-restored, the RESTORE_CAP tail,
   * and a cwd that no longer exists). Predicting those would mean duplicating
   * the loop — a credential lookup and a filesystem stat per row — on the boot
   * path, to sharpen a number that is on screen for 2.75 seconds. "The restore
   * set" is D16's own vocabulary for this population and is what is reported.
   */
  planRestoreCount(projectId: string): number {
    const storage = this.requireStorage()
    return computeRestoreSet(
      storage.getPaneLayout(projectId),
      storage.getSessionsForProject(projectId),
      // The live map, not an assumed-empty set: at boot it IS empty, but this
      // must stay correct if it is ever called at another moment.
      new Set(this.sessions.keys())
    ).toRelaunch.length
  }

  /** True while a live (running) PTY exists for this id — session:restart and
   *  session:delete both refuse to touch a live session. */
  isRunning(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.status === 'running'
  }

  /**
   * Forget every queued restore for a project (Phase 3h — archive).
   *
   * ⚠ THE MAP IS PRIVATE AND HAD NO PUBLIC CLEAR, WHICH IS WHY THIS EXISTS.
   * `restore()` fills it, spawns on a stagger, and empties it in its own
   * `finally`. Archiving a project MID-RESTORE kills the PTYs out from under
   * that loop, and the ids it had already queued stay in the map — so
   * `isRestorePending` keeps answering true, and `TerminalPane.vue` keeps
   * showing a "restoring…" spinner for a session that is never coming. A
   * spinner that never concludes is worse than an error: it invites the user to
   * wait indefinitely.
   *
   * Clearing the entry does NOT stop the in-flight `restore()` loop — it cannot
   * reach into an awaited stagger — but the loop's own live guard and the
   * healed 'exited' rows mean the remaining iterations have nothing to relaunch.
   * This is about the FLAG the renderer reads, and the flag is the thing that
   * was stuck.
   */
  clearRestorePending(projectId: string): void {
    this.restorePending.delete(projectId)
  }

  /** Restore engine has this id queued for a staggered relaunch right now. */
  isRestorePending(sessionId: string): boolean {
    for (const pending of this.restorePending.values()) {
      if (pending.has(sessionId)) return true
    }
    return false
  }

  /** Consume the restore badge signal for an attach: true exactly once per
   *  restore relaunch — the first attach to report it wears the badge. */
  consumeRestoredBadge(sessionId: string): boolean {
    return this.restoredUnbadged.delete(sessionId)
  }

  onRestored(listener: RestoredListener): void {
    this.restoredListeners.add(listener)
  }

  /** Kill a live session by id. State transition is handled by the existing
   *  onExit handler — do NOT mutate status here. No-op if already exited. */
  kill(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    if (session.status === 'exited') return
    // Q3: whatever this PTY was going to be called, nobody is going to ask it
    // again. Abandoned BEFORE the kill, for the same reason `killRequested` is.
    this.abortDiscovery(sessionId)
    // Set BEFORE the kill: the exit event can arrive immediately, and a flag
    // set afterwards is a race that misclassifies user kills as failures —
    // intermittently, which is the worst kind (Task 3a-1).
    session.killRequested = true
    session.pty.kill()
  }

  write(sessionId: string, data: string): void {
    const s = this.requireSession(sessionId)
    if (s.status !== 'running') return
    s.pty.write(data)
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const s = this.requireSession(sessionId)
    if (s.status !== 'running') return
    s.pty.resize(cols, rows)
  }

  /** Which agent a session belongs to (undefined when the manager has never
   *  seen the id this run). */
  getAgent(sessionId: string): AgentKind | undefined {
    return this.sessions.get(sessionId)?.agent
  }

  onData(listener: DataListener): void {
    this.dataListeners.add(listener)
  }

  onExit(listener: ExitListener): void {
    this.exitListeners.add(listener)
  }

  onStart(listener: StartListener): void {
    this.startListeners.add(listener)
  }

  /** Task 3a-1: true when kill()/dispose() initiated this session's end — the
   *  dispatch classifier's "user abandoned it" fact. The flag lives on the
   *  session record, so it dies with the record and leaks nothing. */
  wasKilledByChorus(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.killRequested ?? false
  }

  /** Kill all live PTYs (and their process trees, via ConPTY teardown) on app quit. */
  dispose(): void {
    for (const session of this.sessions.values()) {
      // A leaked timer holds a closure over the match set past teardown.
      session.output.dispose()
      // Quit is an exit path too: the PTY's own onExit may not run before the
      // process goes, so tokens and config files are retired explicitly here.
      this.retireHooks(session.id)
      // D148: and the instruction file, on the same exit path and for the same
      // reason — quit is an exit path too.
      this.retireInstructions(session.id)
      // Q3: and so is a pending discovery. A write that landed after teardown
      // would record a pointer for a session the app has already forgotten —
      // and would log after the dispose sequence, which is how "quit cleanly"
      // stops being true.
      this.abortDiscovery(session.id)
      if (session.status === 'running') {
        // Same before-the-kill ordering as kill(): an exit delivered during
        // teardown must still classify as intent, not failure (Task 3a-1).
        session.killRequested = true
        session.pty.kill()
      }
    }
    this.sessions.clear()
    // The generation counters describe PTYs that no longer exist, and every
    // discovery that could still have read one was aborted in the loop above.
    // Cleared beside `sessions` so the two cannot disagree about what is live.
    this.spawnGenerations.clear()
  }

  private snapshot(session: PtySession): SessionSnapshot {
    return {
      sessionId: session.id,
      // Task 4a-4: the pre-restart history, then this run's live output. Capped
      // as ONE stream by the same rule the ring buffer uses, so a restored pane
      // is handed exactly what a pane that had been open all along would hold —
      // never more.
      //
      // ⚠ COMPOSED HERE RATHER THAN SEEDED INTO `output.buffer`, so the history
      // provably never re-enters the emit path: it is not re-broadcast to
      // `dataListeners` and it is not re-persisted. That is what stops the
      // mirror doubling on every restart.
      buffer: capTail(session.replaySeed, session.output.buffer, SCROLLBACK_MAX_CHARS),
      status: session.status,
      exitCode: session.exitCode
    }
  }

  private spawn(agent: AgentKind, cwd: string, sessionId: string, opts: LaunchOptions = {}): PtySession {
    // Task 3-3: the adapter owns HOW this agent starts. The registry lookup is
    // a genuine RUNTIME check even though `agent` is typed — sessions.agent is
    // a TEXT column, so the caller's cast is unsound by construction and this
    // is where that unsoundness is caught. UnknownAgentError propagates to the
    // restore engine's existing catch, which heals the row to 'exited' and
    // logs it (D34(c)) — no new failure path, no new status value.
    const adapter = getAdapterOrThrow(agent)
    if (!isPtyAdapter(adapter)) {
      throw new Error(`Agent '${agent}' is not a PTY agent`)
    }
    // Task 3a-4: `effortOptionId` has been declared on PtyLaunchSpec since
    // Task 3-3 and unread until now; `extraArgs` joins it. buildLaunch stays
    // SYNCHRONOUS — launch() returns a snapshot to its IPC caller
    // synchronously, and the effort path introduces no await.
    // Phase 4 spine: mint this session's hook capability ONLY for an adapter
    // that both declares hooks and implements them (the D34 Q1 guard checks
    // both halves), and only when a listener is bound. Everything else launches
    // exactly as before — `hooks: undefined` makes buildLaunch's argv identical.
    //
    // ⚠ REGISTERED BEFORE SPAWN, NOT AFTER. Claude Code fires SessionStart
    // immediately; a token minted one tick later would arrive to find its own
    // first events already rejected as unknown.
    let hooks: PtyLaunchHooks | undefined
    if (this.hooks && this.hookConfigDir && supportsHooks(adapter)) {
      try {
        hooks = {
          endpointUrl: this.hooks.register(sessionId),
          configPath: join(this.hookConfigDir, `${sessionId}.json`)
        }
      } catch (err) {
        // A listener that never bound (port refused at boot) must cost the
        // lights, never the launch.
        logger.warn({ err, sessionId }, '[hooks] could not register session; launching without hooks')
      }
    }
    // D148: the memory usage contract. Composed by ipc.ts — which is the layer
    // that knows the project and can therefore ask whether it has memory
    // configured at all — and merely DELIVERED here. Main owns the path, the
    // adapter owns the format: the same split `hooks` uses one block up.
    let instructions: PtyLaunchInstructions | undefined
    if (this.instructionsDir && opts.instructions && supportsInstructions(adapter)) {
      instructions = {
        text: opts.instructions,
        filePath: join(this.instructionsDir, `${sessionId}.md`)
      }
    }
    // ⚠ PHASE 4a / D139 + D140: WHICH CONVERSATION THIS LAUNCH BELONGS TO IS
    // DECIDED HERE, INSIDE THE ONE SPAWN FUNNEL, AND NOT PASSED IN BY CALLERS.
    // `launch()`, `restore()`'s relaunch (:395) and `session:restart` all pass
    // through this function, so planning here means RESTORE NEEDS NO EDIT AT
    // ALL — its credentialed heal, its RESTORE_CAP tail, its stagger and its
    // cwd guard are provably untouched because the file shows they were not
    // touched — and no future call site can forget to plan either.
    const resumable = supportsResume(adapter) ? adapter : null
    const generation = (this.spawnGenerations.get(sessionId) ?? 0) + 1
    this.spawnGenerations.set(sessionId, generation)
    // A superseding spawn under the same row id invalidates any discovery still
    // running for the PTY this one replaces (Q3).
    this.abortDiscovery(sessionId)
    const plan = planResume({
      // An unbound storage is legal (this class is constructed at module scope,
      // before the DB exists) and reads as "no pointer" — i.e. exactly the
      // pre-4a app.
      storedAgentSessionId: this.storage?.getAgentSessionId(sessionId) ?? null,
      descriptorKind: resumable?.getCapabilities().sessionResume?.kind ?? null,
      mintId: randomUUID
    })
    // Q3: captured IMMEDIATELY BEFORE the spawn, never after. A timestamp taken
    // afterwards would accept a rollout the spawn itself could not have written,
    // which is the sibling-worktree cross-claim this bound exists to stop.
    const launchedAt = Date.now()
    const request = adapter.buildLaunch({
      sessionId,
      cwd,
      credential: opts.credential,
      route: opts.route,
      effortOptionId: opts.effort,
      extraArgs: opts.extraArgs,
      hooks,
      instructions,
      // D139: resumption is a MODIFIER on the one launch path, never a second
      // entry point. A `fresh` plan yields `undefined` and the assembled argv
      // is byte-identical to what HEAD produced — which is what keeps kimi,
      // opencode and every un-pointed launch behaving exactly as they do today.
      resume: toLaunchModifier(plan)
    })
    // Stable identity: the sessions DB row id. Fresh PTYs are re-created
    // under the same id by the restore engine and session:restart.
    const id = sessionId

    // SUPERSEDES D5 (Phase 0 → Task 3-6). Env policy has ONE owner and this is
    // the call site (D34(d)): a launch with no credential inherits process.env
    // wholesale, exactly as it always has (D33 resolution c); a credential-
    // bearing launch gets a constructed allow-list so the developer's ambient
    // provider keys do not ride along (D33 clause 4). The key travels ONLY in
    // this env block — never in argv, never in a log, never on disk.
    const env = composeChildEnv({
      parentEnv: process.env,
      requiredEnvVars: adapter.requiredEnvVars,
      // Task 3a-5: a launch profile's non-secret env_json wins over the
      // adapter's own additions and LOSES to secretEnv (composeChildEnv applies
      // that last, by construction) — so a profile can shape a launch but can
      // never displace an injected credential. Merged HERE rather than inside
      // an adapter so no adapter file changes in this commit.
      envAdditions: opts.envAdditions
        ? { ...request.envAdditions, ...opts.envAdditions }
        : request.envAdditions,
      secretEnv: request.secretEnv
    })

    const child = pty.spawn(request.executable, [...request.args], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: request.cwd,
      env,
      useConpty: true
    })

    // ⚠ D143(c). THE ID WAS MINTED BEFORE ARGV BECAUSE IT HAD TO BE IN ARGV. IT
    // IS PERSISTED HERE, AFTER THE SPAWN, BECAUSE D16 RESOLUTION (a) IS THE RULE
    // THIS APP ALREADY RUNS ON: restore() writes 'running' only once the spawn
    // has succeeded (:395–:400), so a crash between the two leaves a
    // self-consistent row.
    //
    // The council findings' action item 6 says "mints and persists an id before
    // launch". The second half is wrong HERE and was overruled at D143(c).
    // Persisting first means a failed spawn leaves a pointer to a conversation
    // that never existed; the next launch resumes it, the resume fails, Q4
    // clears it and shows a "context was not restored" line — ON A SESSION THAT
    // NEVER HAD ANY CONTEXT. A spurious accusation of data loss is worse than
    // the loss it describes.
    //
    // The worst THIS ordering can produce is an ORPHAN TRANSCRIPT: a
    // conversation named on disk that Chorus forgot. It is invisible and costs
    // nothing.
    if (plan.action === 'assigned-create') {
      this.storage?.setAgentSessionId(sessionId, plan.agentSessionId)
    }

    // Scrubber registration derives from what is ACTUALLY being injected
    // (request.secretEnv's values), unioned with the caller's explicit list —
    // so "injected" and "scrubbed" cannot diverge, and a separately-passed
    // list is never the only place a value is registered. createScrubber
    // dedupes, empty-filters and sorts longest-first, so the union needs no
    // pre-processing here.
    const secrets = [...(opts.secrets ?? []), ...Object.values(request.secretEnv)]

    // Task 3-6 Commit 1 (D46): the whole output pipeline — scrubber, carry-
    // flush timer, ring buffer, broadcast — lives in ONE session-shaped
    // object (D45 mitigation 1: scrubbing is a property of "a session emits
    // text", not "a PTY emits text"). Constructed in the SAME synchronous
    // block as pty.spawn and the onData wiring: one tick later and the first
    // chunk — exactly when a shell might echo its environment — is lost or
    // unscrubbed.
    const output = createSessionOutput({
      secrets,
      maxChars: BUFFER_MAX_CHARS,
      flushMs: SCRUB_FLUSH_MS,
      onText: (text) => {
        for (const listener of this.dataListeners) listener(id, text)
        // v16: the context ring's CODEX source — a passive scrape of the
        // `N% context left` its TUI already draws (contextUsageCore).
        //
        // ⚠ WIRED TO `onText`, WHICH IS POST-SCRUB, AND THAT ORDERING IS NOT
        // NEGOTIABLE. `ingest` sees raw PTY bytes; this callback sees what the
        // scrubber has already passed. Reading the raw side would put a second
        // consumer on unredacted output — precisely the F26 shape D45(1) exists
        // to prevent — for a scan whose entire input is two digits and the word
        // "context". Scrubbing cannot affect that match.
        //
        // ⚠ AND IT IS INSIDE THE ONE `onText`, NOT A SECOND SUBSCRIPTION, so
        // there is still exactly one place session text fans out from.
        this.contextUsage?.ingestOutput(id, agent, text)
      },
      // Task 4a-4 / D141: the disk mirror. A THIRD consumer of the one string
      // `emit` already computed — see sessionOutput.ts's invariant 1. The store
      // never throws and never blocks, so this cannot cost the pane anything.
      onPersist: (text) => this.scrollback?.append(id, text)
    })

    const session: PtySession = {
      id,
      agent,
      pty: child,
      status: 'running',
      exitCode: null,
      killRequested: false,
      // Task 4a-4: read ONCE, here, so a pane that attaches immediately after
      // the spawn already has its history. Read SYNCHRONOUSLY on purpose — an
      // awaited read would race `session:attach` and make restored history
      // appear only sometimes. This is a launch, not the data path.
      //
      // F58: replayed verbatim the history is INVISIBLE — the fresh TUI erases
      // it (codex ESC[2J) or paints over it on a buffer with no scrollback
      // (Claude Code ?1049h). So the alternate-screen switches are dropped, so
      // the same bytes paint on the normal buffer, and an epilogue scrolls the
      // result into scrollback where the next repaint cannot reach it. Every
      // other escape is preserved: they are the layout, and stripping them
      // garbles the text (measured).
      //
      // ⚠ AND THE EPILOGUE MOVES TO THE BOUNDARY WHEN THERE IS ONE (Q7 /
      // D143(g), below). The seed paints the old screen, the boundary prints
      // under it, and ONE epilogue scrolls BOTH into xterm's scrollback where
      // ESC[2J cannot reach. Two epilogues would scroll the boundary away from
      // the history it is separating.
      replaySeed: (() => {
        const tail = this.scrollback?.readTail(sessionId) ?? ''
        if (tail.length === 0) return ''
        const painted = stripAltScreen(tail)
        return opts.conversationBoundary ? painted : painted + replayEpilogue()
      })(),
      // Task 3-5 (D33 clause 7): exact-value scrub on INGEST, so the ring
      // buffer, the session:data stream, and attach()'s replay all see only
      // scrubbed text. A no-credential launch registers zero secrets — the
      // identity fast path makes that case free.
      output
    }

    // Q7 / D143(g): the conversation boundary. Emitted THROUGH `output.ingest`
    // (sessionOutput.ts:94), so it takes the ONE emit path (D45(1)) and
    // therefore lands in BOTH the ring buffer and the disk mirror — a permanent,
    // correctly-placed record of when this conversation changed, visible again
    // at every future restore.
    //
    // ⚠ NOT APPENDED TO `replaySeed`. A seeded boundary would be redrawn on
    // EVERY attach, would drift to the wrong place in history, and would never
    // be recorded at all. Emitting it is what makes it true.
    //
    // ⚠ EMITTED SYNCHRONOUSLY HERE, BEFORE `child.onData` IS WIRED, so it
    // provably precedes any byte the new PTY produces — Node is single-threaded
    // and PTY data arrives via the event loop. "Before any output from the
    // restarted PTY is replayed or emitted" is Q7's wording, and this ordering
    // is what earns it.
    //
    // ⚠ AND IT MUST FOLLOW THE `session` LITERAL ABOVE, WHICH IS NOT STYLE:
    // `replaySeed` reads the mirror from disk, and this write appends to that
    // same mirror. Emitting first would put the boundary in the file BEFORE the
    // seed read it, and the pane would show it twice.
    //
    // ⚠ `ingest` RATHER THAN A DIRECT WRITE, DELIBERATELY. It goes through this
    // session's own fresh scrubber, so there is still exactly one place session
    // text is scrubbed and exactly one place it fans out. The boundary carries
    // no secret-prefix risk and its trailing newline leaves the scrubber no
    // carry to hold.
    if (opts.conversationBoundary) {
      output.ingest(conversationBoundary(opts.conversationBoundary) + replayEpilogue())
    }

    child.onData((data) => output.ingest(data))

    child.onExit(({ exitCode }) => {
      session.status = 'exited'
      session.exitCode = exitCode
      // ⚠ F64: THE SESSION'S END IS WHAT BOUNDS DISCOVERY NOW. The adapter waits
      // indefinitely for a rollout that only appears when the user speaks, so
      // the wait has to be ended by something — and a PTY that has exited will
      // never produce one. Abandoned here as well as on kill, quit and a
      // superseding spawn, so no discovery outlives the process it is about.
      this.abortDiscovery(id)
      // Don't strand a held tail on exit — flush BEFORE notifying, so the
      // renderer receives the final bytes before the exit event.
      output.flush()
      // The capability dies with the process, and BEFORE the exit fans out:
      // an exit listener that re-launches must not find the old token alive.
      this.retireHooks(id)
      // D148: the session's contract file dies with the session. A relaunching
      // exit listener mints a fresh one, so removing it here cannot race a
      // launch that has not happened yet.
      this.retireInstructions(id)
      // v16: and so does the context reading. A restart is a NEW CONVERSATION
      // (D16 clause 4 — it is what the "Session restarted" badge announces), so
      // a ring carried across the exit would describe a transcript the agent no
      // longer has. Dropped BEFORE the exit fans out, for the same reason the
      // token is: a listener that relaunches must not find the old value.
      this.contextUsage?.forget(id)

      // ⚠ EVERYTHING ABOVE STILL RUNS UNCONDITIONALLY. The PTY really did exit,
      // so its hooks and its context ring really must be retired, whatever this
      // exit turns out to mean.
      const disposition = planExitDisposition({
        launchedAction: plan.action,
        killRequested: session.killRequested,
        // F65: was there a conversation here to lose? Turns, not bytes — a TUI
        // paints a banner and a prompt whether or not anything happened.
        //
        // ⚠ NAMED LIMIT: turns come from the hook listener, so an app running
        // without one records none and every recovery goes quiet. That is the
        // SAFE direction (a missing notice beside a visibly amnesiac pane, vs an
        // accusation of losing work that never existed), and an app with no hook
        // listener is already running without its lights.
        hadRecordedTurns: this.storage?.hasRecordedTurn(id) ?? false,
        // ⚠ THE CLASSIFIER IS CONSULTED ONLY FOR A LAUNCH THAT CARRIED
        // `action:'resume'` — Q4's load-bearing distinction. A CODEX DISCOVERY
        // MISS IS NOT A RESUME FAILURE: it follows a FRESH launch, no context
        // was promised, no stale pointer existed, nothing was lost. Its exit
        // never reaches here with a reason, so it can never produce a notice.
        classified:
          resumable && isResumeAction(plan.action)
            ? resumable.classifyResumeFailure({
                exitCode,
                signal: null,
                // Post-scrub by construction (it IS the ring buffer, fed by the
                // one emit path), and BOUNDED — the adapter needs the last
                // screen, not the session.
                //
                // ⚠ FLATTENED, AND WITHOUT THAT THIS WHOLE PATH IS DEAD CODE.
                // Claude prints its failure with CURSOR-FORWARD ESCAPES WHERE
                // THE SPACES SHOULD BE (`No` ESC[1C `conversation` …), so an
                // adapter regex written in plain prose — which is what both
                // adapters have, and what their 4a-2 fixtures test — matches
                // nothing at all against real PTY bytes. Measured in this task's
                // runtime gate 4. Flattening once HERE keeps terminal decoding
                // out of every adapter (the D45(1) argument, applied to reading
                // instead of writing).
                //
                // ⚠ BOUNDED FIRST, FLATTENED SECOND, so the cost is bounded too.
                // ⚠ NEVER LOGGED. The contract says so, and so does D33.
                output: flattenTerminalText(session.output.buffer.slice(-RESUME_OBSERVATION_CHARS))
              })
            : null
      })

      if (disposition.kind === 'recover') {
        // ⚠ D143(b). Q4's automatic relaunch fires EVERY exit listener, and
        // there are EIGHT registrations (dispatches.ts:96 · turns.ts:88 ·
        // notifications.ts:24 · index.ts:672 · index.ts:678 · ipc.ts:3966 ·
        // ipc.ts:4011 · ipc.ts:4169). Left alone, ONE classified resume failure
        // closes a dispatch, closes a turn, fires an OS exit toast, writes the
        // row 'exited' and lights the project rail red — for a session that came
        // straight back.
        //
        // A resume-failure relaunch is a DELIBERATE end, which is exactly what
        // `killRequested` means (Task 3a-1: set BEFORE pty.kill() so intent can
        // never be misclassified as failure).
        //
        // ⚠ THE FLAG ALONE COVERS ONE OF THE EIGHT — `wasKilledByChorus` (:543)
        // is read only by dispatches.ts:155. MEASURED, not assumed. The other
        // seven see nothing but an exit event, so HOLDING THE FAN-OUT is the
        // half that actually works. Both are done: the flag makes the dispatch
        // classifier honest, the hold prevents the rest.
        session.killRequested = true
        this.storage?.clearAgentSessionId(id)
        try {
          const replacement = this.spawn(agent, cwd, id, {
            ...opts,
            // F65: the boundary is the NOTICE. A conversation that never had a
            // turn has nothing to announce, so the pane comes back fresh without
            // being told it lost something it never had. The recovery above and
            // below is identical either way.
            conversationBoundary: disposition.notify ? 'context-not-restored' : undefined
          })
          this.sessions.set(id, replacement)
          // ⚠ THE REASON AND THE CHORUS ID ONLY. Never the agent session id, and
          // never beside the cwd: the two together reconstruct a path to the
          // full text of the user's work (spec §7).
          //
          // ⚠ STILL LOGGED WHEN THE USER IS NOT TOLD — at `info`, because
          // nothing was lost, but never NOTHING: an unexplained relaunch that
          // leaves no trace is how a silent failure becomes undiagnosable.
          if (disposition.notify) {
            logger.warn(`[resume] context not restored for ${id} (${disposition.reason}); relaunched fresh`)
          } else {
            logger.info(
              `[resume] stale pointer for ${id} (${disposition.reason}); relaunched fresh — the conversation had no turns, so nothing was lost`
            )
          }
          // The fan-out is HELD — nothing below fires.
          return
        } catch (err) {
          // ⚠ AND IF THE RELAUNCH THROWS, THE SUPPRESSION IS REVERTED. An exit
          // suppressed for a session that did NOT come back would leave a row
          // saying 'running' with no PTY behind it — the invisible-process
          // failure D16 exists to prevent, and strictly worse than a spurious
          // toast. Fall through to the normal fan-out.
          logger.error({ err }, `[resume] relaunch after ${disposition.reason} failed for ${id}`)
        }
      }

      for (const listener of this.exitListeners) listener(id, exitCode)
    })

    // Additive announcement (Task 3a-1), AFTER the PTY exists and the output
    // pipeline is wired, so it can never precede a working session — and a
    // throwing spawn above leaves no listener-fired row behind. Defensive by
    // construction: this is a NEW loop, so wrapping it changes nothing that
    // exists, and a throwing listener must never be able to fail a launch.
    const startInfo: SessionStartInfo = {
      sessionId: id,
      agent,
      cwd: request.cwd,
      authMode: opts.credential ? 'api_key' : 'subscription',
      model: opts.route?.modelId ?? null,
      providerName: opts.route?.providerName ?? null
    }
    for (const listener of this.startListeners) {
      try {
        listener(startInfo)
      } catch (err) {
        logger.error({ err }, '[session] start listener threw')
      }
    }

    // Q3: codex names its own conversation, so Chorus has to ask it afterwards
    // what it chose.
    //
    // ⚠ THE GUARD IS `plan.action === 'fresh'`, NOT "the pointer is NULL", AND
    // THAT IS Q3 VERBATIM: discovery NEVER runs for a resume launch. A resume
    // already knows its id, and discovery could only overwrite it with a worse
    // guess.
    //
    // ⚠ AND IT SITS HERE, BELOW `pty.spawn` AND BELOW THE START-LISTENER LOOP,
    // so a throwing spawn never reaches it: a rollout cannot exist for a process
    // that never started.
    if (plan.action === 'fresh' && plan.discoverAfterSpawn && resumable) {
      const discover = resumable.discoverSessionId
      if (typeof discover === 'function') {
        this.beginDiscovery({
          sessionId,
          generation,
          child,
          cwd: request.cwd,
          launchedAt,
          discover: (context) => discover.call(resumable, context)
        })
      }
    }

    return session
  }

  /**
   * Ask a `discovered` adapter what the conversation it just started is called,
   * and record the answer — or, far more often, record nothing at all.
   *
   * ⚠ A MISS IS SILENT AND THAT IS THE POINT (Q4). No notice, no clear, no
   * relaunch, pointer stays NULL, log line is `info`. A codex pane that starts
   * fresh and cannot find its rollout is behaving exactly as this app behaved
   * before Phase 4a, and the user must not be told that something failed.
   *
   * ⚠ NOTHING HERE MAY EVER COST A PANE. The whole thing runs detached from the
   * launch, and every failure is swallowed: discovery may fail, it may never
   * turn a working session into a failed launch.
   */
  private beginDiscovery(input: {
    readonly sessionId: string
    readonly generation: number
    readonly child: pty.IPty
    readonly cwd: string
    readonly launchedAt: number
    readonly discover: (context: DiscoverSessionContext) => Promise<string | null>
  }): void {
    const { sessionId, generation, child, cwd, launchedAt } = input
    const controller = new AbortController()
    this.discoveries.set(sessionId, controller)
    const signal = controller.signal

    void (async () => {
      try {
        // ⚠ ONE CALL THAT WAITS, NOT A POLL LOOP THAT GIVES UP — F64. The
        // adapter now resolves when the rollout APPEARS, and codex does not
        // write one until the user submits their first turn: measured at 22.6 s
        // after spawn in one run and 3 m 19 s in another. Every bounded window
        // this loop used to run therefore expired before the file existed, which
        // is why codex never resumed. Ending the wait is the SIGNAL's job, and
        // the signal is aborted when this session ends.
        const discovered = await input.discover({ sessionId, cwd, launchedAt, signal })

        // ⚠ `null` COVERS BOTH "NOTHING MATCHED" AND "TWO THINGS MATCHED", and
        // both are silent (Q4). A pointer that might belong to the other pane is
        // worse than no pointer: resuming the wrong conversation is a silent
        // data-crossing, while no pointer is a visible, honest fresh start.
        if (discovered === null) {
          if (!signal.aborted) {
            // Informational, never a warning: nothing failed.
            logger.info(`[discover] no rollout matched this launch for ${sessionId}`)
          }
          return
        }

        if (signal.aborted) return
        // ⚠ THE GENERATION CHECK IS NOT REDUNDANT WITH THE SIGNAL. An abort that
        // fires while the promise is already resolving still lands here. Checked
        // IMMEDIATELY before the write, with no `await` in the gap, so nothing
        // can move underneath it.
        if (this.spawnGenerations.get(sessionId) !== generation) return
        // And the PTY under this row id is still the one we launched.
        if (this.sessions.get(sessionId)?.pty !== child) return

        this.storage?.setAgentSessionId(sessionId, discovered)
        // ⚠ NO AGENT ID AND NO CWD IN THIS LINE (spec §7): the two together
        // reconstruct a path to the user's transcript, in a file with different
        // permissions from the transcript.
        logger.info(`[discover] pointer recorded for ${sessionId}`)
      } catch (err) {
        logger.info({ err }, `[discover] gave up for ${sessionId}`)
      } finally {
        // Only if it is still OURS — a superseding spawn has already replaced
        // the entry and must not have it deleted out from under it.
        if (this.discoveries.get(sessionId) === controller) this.discoveries.delete(sessionId)
      }
    })()
  }

  private requireSession(sessionId: string): PtySession {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`Unknown sessionId: ${sessionId}`)
    }
    return session
  }

  private requireStorage(): StorageService {
    if (!this.storage) {
      throw new Error('SessionManager: bindStorage() was not called before restore()')
    }
    return this.storage
  }
}
