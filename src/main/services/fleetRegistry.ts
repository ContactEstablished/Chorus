import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { logger } from './logger'
import {
  addressStateFor,
  duplicateNames,
  isLive,
  isProtocolSupported,
  nextStickyState,
  parseRegistryEntry,
  type AddressState,
  type FleetEntry,
  type ProcessProbe
} from './fleetRegistryCore'

const execFileAsync = promisify(execFile)

/**
 * Fleet Comms Phase 1 / D182 — the main-process reader.
 *
 * The I/O shell around `fleetRegistryCore`: it gathers facts (a directory of
 * JSON files, process liveness, the clock) and hands every DECISION to the
 * pure core. Nothing here decides whether an address is still true.
 *
 * ⚠ IT WRITES NOTHING TO THE FLEET. No registry file is created or modified,
 * no `.key` file is read or even listed, `messagingSocketPath` is never opened.
 * Spec §7.4's socket prohibition is permanent; storing the path string that a
 * message already carries is not connecting to it.
 */

/** Spec §8.1: "a poll on the order of seconds is inside the noise of everything
 *  else main does". Three seconds — small files, a handful of them, and a fresh
 *  pane should not be blind for long. Lifecycle events refresh out of band, so
 *  this is the ceiling on staleness, not the only trigger. */
export const FLEET_POLL_MS = 3_000

/** How long a cached process start time is trusted before it is re-read.
 *
 *  ⚠ THIS BOUNDS A REAL, NARROW HOLE. The cache exists because reading a start
 *  time costs a PowerShell spawn (see `readStartTimes`), and a pid's start time
 *  is immutable — so caching is safe UNTIL the pid dies and the OS recycles it
 *  onto a different process. We evict on the first poll that sees the pid gone,
 *  but a death-and-reuse entirely between two polls would go unnoticed. The TTL
 *  caps that window; without it, a recycled pid could be trusted forever. */
export const START_TIME_TTL_MS = 60_000

export interface FleetSnapshot {
  /** Live, protocol-supported entries. */
  readonly entries: readonly FleetEntry[]
  /** ⚠ FALSE MEANS "WE CANNOT SAY", WHICH IS NOT THE SAME CLAIM AS AN EMPTY
   *  FLEET. An empty `entries` with `readable: true` means there are no peers;
   *  `readable: false` means the registry could not be read at all and every
   *  address must render as `unknown`. Collapsing the two would turn "the
   *  directory is missing" into a confident "you have no fleet". */
  readonly readable: boolean
  readonly observedAt: number
}

/**
 * Read process start times for a set of pids, as Windows FILETIME strings
 * directly comparable to the registry's `procStart`.
 *
 * ⚠ THE MECHANISM WAS MEASURED, AND THE OBVIOUS ONE IS WRONG. Against two live
 * sessions on 2026-08-27:
 *
 *   registry procStart              134322514089929884 / 134322270119157043
 *   Get-CimInstance Win32_Process   134322514089929880 / 134322270119157040  ✗
 *   Get-Process -Id  .StartTime     134322514089929884 / 134322270119157043  ✓
 *
 * `Win32_Process.CreationDate` is a CIM datetime carrying MICROSECONDS, so
 * converting it to a FILETIME zeroes the final 100-nanosecond tick and an
 * equality test fails on every process. `Get-Process`'s `StartTime` comes from
 * the process handle and keeps full precision. Do not "simplify" this to CIM.
 *
 * Returns only the pids it could read; a pid that has exited is simply absent.
 */
export async function readStartTimes(pids: readonly number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>()
  if (pids.length === 0) return out
  const list = pids.join(',')
  const script =
    `$ErrorActionPreference='SilentlyContinue';` +
    `Get-Process -Id ${list} | ForEach-Object { "$($_.Id)=$($_.StartTime.ToFileTimeUtc())" }`
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 10_000 }
    )
    for (const line of stdout.split(/\r?\n/)) {
      const m = /^(\d+)=(\d+)$/.exec(line.trim())
      if (m) out.set(Number(m[1]), m[2])
    }
  } catch (err) {
    // A failure here degrades liveness to "cannot confirm", which the core
    // turns into `unknown` — never into a false `live`.
    logger.warn({ err }, '[fleet] could not read process start times')
  }
  return out
}

/** Liveness in two halves. `alive` is nearly free; the start time is not, so it
 *  is cached and only re-read on a miss or after the TTL. */
class StartTimeCache {
  private readonly cache = new Map<number, { value: string; readAt: number }>()

  constructor(private readonly now: () => number) {}

  /** Pids that need a (re)read before `probeFor` can answer for them. */
  missing(pids: readonly number[]): number[] {
    const t = this.now()
    return pids.filter((pid) => {
      const hit = this.cache.get(pid)
      return !hit || t - hit.readAt >= START_TIME_TTL_MS
    })
  }

  put(values: ReadonlyMap<number, string>): void {
    const readAt = this.now()
    for (const [pid, value] of values) this.cache.set(pid, { value, readAt })
  }

  /** Drop pids that are no longer alive, so a recycled pid cannot inherit a
   *  previous process's start time. */
  evictDead(alive: (pid: number) => boolean): void {
    for (const pid of [...this.cache.keys()]) if (!alive(pid)) this.cache.delete(pid)
  }

  get(pid: number): string | null {
    return this.cache.get(pid)?.value ?? null
  }
}

/** `process.kill(pid, 0)` sends no signal — it only asks whether the pid is
 *  addressable. `EPERM` means the process exists but belongs to someone else,
 *  which is still alive. */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * What crosses the bridge.
 *
 * ⚠ PLAIN OBJECTS ONLY (D14). Electron's structured clone rejects a Vue proxy
 * with "An object could not be cloned" and gives NO compile-time signal — and a
 * `Map` or `Set` is worse than a crash here, because `JSON.stringify` turns one
 * into `{}` silently. `states` is a Record and `externalPeers` an array for
 * exactly that reason; the service's own `duplicates` Set never leaves main.
 */
export interface FleetPayload {
  readonly readable: boolean
  readonly observedAt: number
  /** Keyed by CHORUS session id. */
  readonly states: Record<string, AddressState>
  /** Live peers that are NOT Chorus panes — a bare terminal, another repo, the
   *  desktop app. Listed because §4.5 says hiding them misrepresents the fleet;
   *  Task 1-4 renders them, this task only carries them. */
  readonly externalPeers: ReadonlyArray<{
    readonly name: string
    readonly cwd: string
    readonly status: string
  }>
}

export type FleetPayloadListener = (payload: FleetPayload) => void

export interface FleetRegistryDeps {
  /** Defaults to `~/.claude/sessions`. Injected so tests never touch the real one. */
  readonly sessionsDir?: string
  readonly now?: () => number
  readonly alive?: (pid: number) => boolean
  readonly readStartTimesFor?: (pids: readonly number[]) => Promise<Map<number, string>>
  /** Chorus session id -> claude sessionId, from `agentEvents.onTranscriptPath`. */
  readonly claudeSessionIdFor?: (chorusSessionId: string) => string | null
  /** The name Chorus asked for, i.e. `sessions.name`. */
  readonly requestedNameFor?: (chorusSessionId: string) => string | null
  /** Chorus's own computed activity, for the §8.2 comparison. `null` = neither
   *  working nor needing-you. Absent supplier = no comparison, no log. */
  readonly computedActivityFor?: (chorusSessionId: string) => 'working' | 'needs-you' | null
  readonly upsertPeerSession?: (socketPath: string, sessionId: string, nowIso: string) => void
}

export class FleetRegistry {
  private timer: ReturnType<typeof setInterval> | null = null
  private snapshot: FleetSnapshot = { entries: [], readable: false, observedAt: 0 }
  /** ⚠ TRACKING AND STICKINESS ARE SEPARATE SETS ON PURPOSE. They were one map
   *  first, and `acknowledge()` — which clears a remembered `changed` — also
   *  deleted the pane from the tracked set, so it silently stopped being
   *  recomputed and froze at `unknown` forever. Acknowledging a notice must not
   *  unsubscribe the pane that raised it. */
  private readonly tracked = new Set<string>()
  private readonly sticky = new Map<string, AddressState>()
  private readonly startTimes: StartTimeCache
  /** Log-once ledgers — a poll-rate log is a log nobody reads. */
  private readonly loggedProtocols = new Set<number>()
  private readonly lastDisagreement = new Map<string, string>()
  private readonly listeners = new Set<FleetPayloadListener>()

  private readonly dir: string
  private readonly now: () => number
  private readonly alive: (pid: number) => boolean
  private readonly readTimes: (pids: readonly number[]) => Promise<Map<number, string>>

  constructor(private readonly deps: FleetRegistryDeps = {}) {
    this.dir = deps.sessionsDir ?? path.join(os.homedir(), '.claude', 'sessions')
    this.now = deps.now ?? Date.now
    this.alive = deps.alive ?? pidAlive
    this.readTimes = deps.readStartTimesFor ?? readStartTimes
    this.startTimes = new StartTimeCache(this.now)
  }

  /** ONE `setInterval` for this service, per the rule stated at
   *  `attention.ts:89`. Lifecycle events call `refresh()` directly. */
  start(): void {
    if (this.timer) return
    void this.refresh()
    this.timer = setInterval(() => void this.refresh(), FLEET_POLL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  current(): FleetSnapshot {
    return this.snapshot
  }

  /** The address state for a Chorus pane, already folded for stickiness. */
  addressFor(chorusSessionId: string): AddressState {
    return (
      this.sticky.get(chorusSessionId) ?? {
        kind: 'unknown',
        reason: this.snapshot.readable ? 'not in fleet' : 'registry unreadable'
      }
    )
  }

  acknowledge(chorusSessionId: string): void {
    this.sticky.delete(chorusSessionId)
  }

  /** Subscribe to each completed poll. Returns an unsubscribe, matching
   *  `agentEvents.onActivity`'s shape. */
  onSnapshot(listener: FleetPayloadListener): () => void {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  /** The bridge-safe view of the current state. Built fresh each call — there
   *  is deliberately no cached payload to go stale. */
  payload(): FleetPayload {
    const states: Record<string, AddressState> = {}
    for (const id of this.tracked) states[id] = this.addressFor(id)

    const ours = new Set<string>()
    const claudeSessionIdFor = this.deps.claudeSessionIdFor
    if (claudeSessionIdFor) {
      for (const id of this.tracked) {
        const claudeId = claudeSessionIdFor(id)
        if (claudeId) ours.add(claudeId)
      }
    }
    const externalPeers = this.snapshot.entries
      .filter((e) => !ours.has(e.sessionId))
      .map((e) => ({ name: e.name, cwd: e.cwd, status: e.status as string }))

    return { readable: this.snapshot.readable, observedAt: this.snapshot.observedAt, states, externalPeers }
  }

  async refresh(): Promise<void> {
    const observedAt = this.now()
    const parsed = await this.readAll()
    if (parsed === null) {
      // ⚠ The directory itself could not be read, and EVERY TRACKED ADDRESS
      // MUST FALL BACK TO `unknown` — §6.1: never show an address we cannot
      // currently vouch for. Returning here without re-folding was a real bug:
      // the snapshot went unreadable while `sticky` went on serving the last
      // good name, which is precisely the cached promise this phase exists to
      // prevent. A remembered `changed` still survives (losing the registry is
      // not evidence the old name came back) — that is `nextStickyState`'s job.
      this.snapshot = { entries: [], readable: false, observedAt }
      const unreadable: AddressState = { kind: 'unknown', reason: 'registry unreadable' }
      for (const id of this.trackedSessions()) {
        this.sticky.set(id, nextStickyState(this.sticky.get(id) ?? null, unreadable, false))
      }
      this.emit()
      return
    }

    const supported = parsed.filter((e) => {
      if (isProtocolSupported(e)) return true
      if (!this.loggedProtocols.has(e.peerProtocol)) {
        this.loggedProtocols.add(e.peerProtocol)
        logger.warn(
          { peerProtocol: e.peerProtocol },
          '[fleet] unrecognised peer protocol — fleet degraded for these sessions'
        )
      }
      return false
    })

    // Refresh the start-time cache for anything we cannot already answer for.
    this.startTimes.evictDead(this.alive)
    const need = this.startTimes.missing(supported.map((e) => e.pid).filter(this.alive))
    if (need.length > 0) this.startTimes.put(await this.readTimes(need))

    const probe: ProcessProbe = {
      alive: this.alive,
      startTimeOf: (pid) => this.startTimes.get(pid)
    }
    const live = supported.filter((e) => isLive(e, probe))

    this.snapshot = { entries: live, readable: true, observedAt }
    this.recordSocketPaths(live, observedAt)
    this.updateAddresses(live)
    this.compareStatuses(live)
    this.emit()
  }

  /** ⚠ A LISTENER THAT THROWS MUST NOT END THE POLL. The renderer bridge is the
   *  only subscriber today, and a send into a window that is closing is exactly
   *  the kind of thing that throws — losing the fleet for every other pane
   *  because one window went away would be a poor trade. */
  private emit(): void {
    if (this.listeners.size === 0) return
    const payload = this.payload()
    for (const listener of this.listeners) {
      try {
        listener(payload)
      } catch (err) {
        logger.warn({ err }, '[fleet] a snapshot listener threw')
      }
    }
  }

  /** Returns null when the DIRECTORY could not be read; an unreadable single
   *  file is an ordinary skip and never ends the poll (spec §8.1). */
  private async readAll(): Promise<FleetEntry[] | null> {
    let names: string[]
    try {
      names = await fs.readdir(this.dir)
    } catch {
      return null
    }
    const out: FleetEntry[] = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue // ⚠ never even lists `.key` files
      let raw: unknown
      try {
        raw = JSON.parse(await fs.readFile(path.join(this.dir, name), 'utf8'))
      } catch {
        continue // torn write, deleted between listing and reading, or empty
      }
      const parsed = parseRegistryEntry(raw)
      if (parsed.ok) out.push(parsed.entry)
    }
    return out
  }

  private recordSocketPaths(live: readonly FleetEntry[], observedAt: number): void {
    const upsert = this.deps.upsertPeerSession
    if (!upsert) return
    const iso = new Date(observedAt).toISOString()
    for (const e of live) {
      if (!e.messagingSocketPath) continue
      try {
        upsert(e.messagingSocketPath, e.sessionId, iso)
      } catch (err) {
        logger.warn({ err }, '[fleet] could not record a peer socket mapping')
      }
    }
  }

  private updateAddresses(live: readonly FleetEntry[]): void {
    const { claudeSessionIdFor, requestedNameFor } = this.deps
    if (!claudeSessionIdFor || !requestedNameFor) return
    const duplicates = duplicateNames(live)
    const bySessionId = new Map(live.map((e) => [e.sessionId, e]))
    for (const chorusSessionId of this.trackedSessions()) {
      const claudeId = claudeSessionIdFor(chorusSessionId)
      const entry = claudeId ? (bySessionId.get(claudeId) ?? null) : null
      const incoming = addressStateFor({
        requestedName: requestedNameFor(chorusSessionId),
        entry,
        duplicates
      })
      const previous = this.sticky.get(chorusSessionId) ?? null
      this.sticky.set(chorusSessionId, nextStickyState(previous, incoming, false))
    }
  }

  /** The panes we are asked to keep an address for. */
  private trackedSessions(): readonly string[] {
    return [...this.tracked]
  }

  /** Begin tracking a Chorus pane (called on pane lifecycle events). */
  track(chorusSessionId: string): void {
    this.tracked.add(chorusSessionId)
  }

  untrack(chorusSessionId: string): void {
    this.tracked.delete(chorusSessionId)
    this.sticky.delete(chorusSessionId)
  }

  /**
   * Spec §8.2 — LOG ONLY, never act.
   *
   * The registry's `status` is claude's own, updated by the session itself;
   * Chorus reconstructs the same signal from hook events plus PTY heuristics
   * with stale sweeps (`WORKING_STALE_MS` 45 s, `OUTPUT_STALE_MS` 10 s). Where
   * they disagree on a claude pane the registry is right — and knowing that
   * either validates the heuristics or finds a bug in them, at the cost of a
   * log line. ⚠ THE ACTIVITY LIGHT IS NOT CHANGED: it covers every adapter and
   * this covers one, and swapping would trade breadth for accuracy.
   */
  private compareStatuses(live: readonly FleetEntry[]): void {
    const { claudeSessionIdFor, computedActivityFor } = this.deps
    if (!claudeSessionIdFor || !computedActivityFor) return
    const bySessionId = new Map(live.map((e) => [e.sessionId, e]))
    for (const chorusSessionId of this.trackedSessions()) {
      const claudeId = claudeSessionIdFor(chorusSessionId)
      const entry = claudeId ? bySessionId.get(claudeId) : undefined
      if (!entry) continue
      const computed = computedActivityFor(chorusSessionId)
      const registryBusy = entry.status === 'busy'
      const chorusBusy = computed === 'working'
      const pair = `${entry.status}/${computed ?? 'idle'}`
      if (registryBusy === chorusBusy) {
        this.lastDisagreement.delete(chorusSessionId)
        continue
      }
      // Edge-triggered: once per transition, not once per poll.
      if (this.lastDisagreement.get(chorusSessionId) === pair) continue
      this.lastDisagreement.set(chorusSessionId, pair)
      logger.info(
        { sessionId: chorusSessionId, registry: entry.status, chorus: computed ?? 'idle' },
        '[fleet] registry status disagrees with the computed activity'
      )
    }
  }
}
