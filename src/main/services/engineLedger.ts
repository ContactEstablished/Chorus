import fs from 'node:fs/promises'
import { logger } from './logger'
import {
  isSubagentTranscriptName,
  scanLedger,
  subagentDirFor,
  type LedgerSource
} from './engineLedgerCore'
import type { EngineLedgerTotals, LedgerMetric } from '../../shared/ipc'

/**
 * Engine Phase 10.1, Task 10.1-3: the impure half of the token ledger. It opens
 * files, keeps a cursor per file, and hands the bytes to
 * `engineLedgerCore.ts`, which turns them into numbers. Everything that can be
 * pure lives there; everything that touches a disk lives here.
 *
 * Modelled on `contextUsage.ts`: an in-memory map, an edge-triggered broadcast,
 * a `snapshot()` for the renderer's cold read, and the rule that a session with
 * no reading is ABSENT rather than zero.
 *
 * ─── ⚠ WHY THIS IS ON DEMAND AND NOT ON THE HOOK PATH ─────────────────────
 * `contextUsage` recomputes on every hook event, and it is right to: it reads a
 * 256 KB tail and finishes in under a millisecond. A ledger cannot copy that
 * shape, and the difference was measured rather than assumed:
 *
 *   contextUsage tail read        262,144 bytes   sub-ms, throttled to 1/s
 *   largest transcript here    19,540,543 bytes   63 ms (46 read + 17 parse)
 *
 * That is ~75x the bytes, and Claude Code fires PreToolUse and PostToolUse on
 * every tool call — several per second during real work. A 63 ms scan
 * allocating ~19.5 MB at that rate, in the process that owns every PTY, is a GC
 * storm in main. Polling is no better: a timer pays the full cost for every
 * live session whether anything changed or not.
 *
 * ✅ So: `noteTranscript` RECORDS A PATH AND READS NOTHING, and the scan happens
 * on demand — at a turn boundary, or when the renderer asks. And because a
 * transcript is APPEND-ONLY JSONL, a rescan reads only `[offset, size)`: the
 * 63 ms is paid once per file and every later scan costs a few KB plus one
 * `stat`.
 *
 * ─── ⚠ THE CURSOR'S THREE HAZARDS, EACH WITH ITS OWN TEST ─────────────────
 *  1. A PARTIAL TRAILING LINE. The file is being appended to while it is read,
 *     so the tail is routinely half an object. The cursor advances only to the
 *     LAST NEWLINE; anything after it is left for next time and never parsed.
 *     Getting this wrong silently drops or double-counts a turn.
 *  2. TRUNCATION OR ROTATION. If the file is smaller than the cursor, the file
 *     is not the file we were reading. Discard everything and rescan whole; a
 *     negative delta would otherwise read as a negative cost.
 *  3. A FILE THAT VANISHES. Dropped from the set in silence — the path came
 *     from an agent that may have rotated or deleted it.
 *
 * ─── THE BOUNDARY (D196) ──────────────────────────────────────────────────
 * ⚠ THIS MODULE IS THE ONE THAT ACTUALLY WIDENS `contextUsage.ts`'s "one file,
 * a 256 KB tail" posture: it opens MANY files and WALKS A DIRECTORY. The rules
 * that bound the widening are stated on `engineLedgerCore.ts`, which this file
 * defers to rather than restating.
 *
 * ⚠ CONTENT NEVER LEAVES THIS MODULE. ONLY COUNTERS DO. No message text, no
 * tool input, no file name and no path is retained beyond the cursor map,
 * broadcast, logged or returned over IPC. ⚠ THE PATH IS NEVER LOGGED, on any
 * branch, including the error ones — it names a directory under the user's home
 * and is itself mildly identifying, which is `contextUsage.ts`'s rule too.
 *
 * ⚠ AND THE `.jsonl` FILTER IS A CONTENT CONTROL, NOT TIDINESS: every subagent
 * transcript has an `agent-<id>.meta.json` sibling carrying a human-written
 * `description`. `isSubagentTranscriptName` is what keeps this module from
 * opening it. The directory is NOT recursed — every such directory on this
 * machine is flat, even for depth-2 subagents, so recursion buys nothing and
 * would add a symlink surface.
 */

export type EngineLedgerListener = (sessionId: string, ledger: EngineLedgerTotals) => void

export interface EngineLedgerTracker {
  /** ⚠ RECORDS THE PATH AND READS NOTHING. One map write, per hook event. */
  noteTranscript(sessionId: string, transcriptPath: string): void
  /** Rescan from the cursor. Fire-and-forget by contract: never awaited by a
   *  hook handler, and every failure is silent. */
  refresh(sessionId: string): void
  ledgerFor(sessionId: string): EngineLedgerTotals | null
  snapshot(): ReadonlyArray<{ sessionId: string; ledger: EngineLedgerTotals }>
  onLedger(listener: EngineLedgerListener): () => void
  /**
   * The four metrics for a session, each split main / subagent.
   *
   * ⚠ RETURNS null FOR A SESSION NEVER SCANNED, and the caller must render
   * that as UNKNOWN rather than as zero. ⚠ A metric's `subagent` is `0` only
   * when the subagent directory WAS read and held no work; it is never used
   * to mean "not read", because a panel cannot tell those apart afterwards
   * and would report "100% main thread" for a session it never looked at.
   */
  metricsFor(sessionId: string): {
    ce: LedgerMetric
    rlit: LedgerMetric
    naive: LedgerMetric
    output: LedgerMetric
  } | null
  forget(sessionId: string): void
  dispose(): void
}

/** One file's place in the append-only stream. */
interface FileCursor {
  offset: number
  size: number
  mtimeMs: number
}

interface SessionState {
  transcriptPath: string
  /** filePath -> cursor. The only place a path is held, and it never leaves. */
  cursors: Map<string, FileCursor>
  /** Accumulated text per file is NOT kept — only the numbers it produced. */
  totals: EngineLedgerTotals | null
  /**
   * The same numbers, kept split by origin.
   *
   * ⚠ HELD SEPARATELY RATHER THAN DERIVED, because `total - main` is not
   * `subagent` once a file has been dropped or a scan has failed: the two
   * would disagree silently and the difference would be attributed to
   * subagents that did not run.
   */
  split: { main: OriginTotals; subagent: OriginTotals } | null
}

interface OriginTotals {
  ce: number
  rlit: number
  naive: number
  output: number
}

const zeroOrigin = (): OriginTotals => ({ ce: 0, rlit: 0, naive: 0, output: 0 })

const EMPTY_TOTALS: EngineLedgerTotals = {
  ce: 0,
  rlit: 0,
  naive: 0,
  outputTokens: 0,
  entries: 0,
  files: 0,
  subagentFiles: 0,
  cacheBreakdownMismatches: 0
}

export function createEngineLedgerTracker(): EngineLedgerTracker {
  const sessions = new Map<string, SessionState>()
  const listeners = new Set<EngineLedgerListener>()
  /** sessionId -> a scan is already in flight; a second must not stack. */
  const scanning = new Set<string>()
  let disposed = false

  function record(sessionId: string, next: EngineLedgerTotals): void {
    const state = sessions.get(sessionId)
    if (!state) return
    const current = state.totals
    state.totals = next
    // ⚠ EDGE-TRIGGERED ON `entries`: a rescan that found no new usage-bearing
    // lines is not news, and broadcasting it would wake the renderer for
    // nothing. `contextUsage.record`'s rule, on the quantity that matters here.
    if (current !== null && current.entries === next.entries && current.ce === next.ce) return
    for (const listener of listeners) {
      try {
        listener(sessionId, next)
      } catch (err) {
        // One bad listener must not stop the others, and must never take down
        // the caller that led here.
        logger.error({ err }, '[engine-ledger] listener threw')
      }
    }
  }

  /**
   * Read `[from, to)` of a file as text.
   *
   * ⚠ EVERY FAILURE IS SILENT AND RETURNS null. The path came from an agent
   * that may have rotated, compacted or deleted the file, and the read races an
   * active writer. Losing one scan costs nothing: the previous totals stand and
   * the next turn boundary tries again. ⚠ THE PATH IS NOT LOGGED.
   */
  async function readRange(filePath: string, from: number, to: number): Promise<string | null> {
    if (to <= from) return ''
    let handle: fs.FileHandle | null = null
    try {
      handle = await fs.open(filePath, 'r')
      const length = to - from
      const buffer = Buffer.alloc(length)
      const { bytesRead } = await handle.read(buffer, 0, length, from)
      return buffer.subarray(0, bytesRead).toString('utf8')
    } catch {
      return null
    } finally {
      await handle?.close().catch(() => undefined)
    }
  }

  /** The file set for a session: the main transcript plus its subagents. */
  async function filesFor(transcriptPath: string): Promise<{ main: string[]; subagent: string[] }> {
    const main = [transcriptPath]
    const subagent: string[] = []
    const dir = subagentDirFor(transcriptPath)
    if (dir === null) return { main, subagent }
    let names: string[]
    try {
      names = await fs.readdir(dir)
    } catch {
      // No subagents directory is the common case, not an error.
      return { main, subagent }
    }
    for (const name of names) {
      // ⚠ The filter that keeps `agent-<id>.meta.json` — which holds a
      // human-written description — out of this module. Never widen it.
      if (isSubagentTranscriptName(name)) subagent.push(dir + '/' + name)
    }
    return { main, subagent }
  }

  async function scan(sessionId: string): Promise<void> {
    const state = sessions.get(sessionId)
    if (!state || disposed) return

    const { main, subagent } = await filesFor(state.transcriptPath)
    const sources: LedgerSource[] = []
    const seen = new Set<string>()
    let files = 0
    let subagentFiles = 0

    for (const [filePath, origin] of [
      ...main.map((p) => [p, 'main'] as const),
      ...subagent.map((p) => [p, 'subagent'] as const)
    ]) {
      let stat: { size: number; mtimeMs: number }
      try {
        const s = await fs.stat(filePath)
        stat = { size: s.size, mtimeMs: s.mtimeMs }
      } catch {
        // Vanished between readdir and stat. Drop it in silence.
        continue
      }
      seen.add(filePath)
      files++
      if (origin === 'subagent') subagentFiles++

      const cursor = state.cursors.get(filePath)
      // ⚠ HAZARD 2: a file smaller than our cursor, or whose mtime moved
      // backwards, is not the file we were reading — truncated, rotated or
      // compacted. Discard and rescan whole rather than computing a negative
      // delta, which would read as a negative cost.
      const invalidated =
        cursor !== undefined && (stat.size < cursor.offset || stat.mtimeMs < cursor.mtimeMs)
      const from = cursor === undefined || invalidated ? 0 : cursor.offset
      if (invalidated) state.cursors.delete(filePath)

      const text = await readRange(filePath, from, stat.size)
      if (text === null) continue

      // ⚠ HAZARD 1: advance only to the LAST NEWLINE. Everything after it is a
      // partial write and is neither parsed now nor lost — the next scan starts
      // at the newline and reads it whole.
      const lastNewline = text.lastIndexOf('\n')
      const consumed = lastNewline === -1 ? 0 : lastNewline + 1
      const usable = lastNewline === -1 ? '' : text.slice(0, consumed)

      state.cursors.set(filePath, {
        offset: from + consumed,
        size: stat.size,
        mtimeMs: stat.mtimeMs
      })
      if (usable.length > 0) sources.push({ origin, text: usable })
    }

    // A file that disappeared entirely leaves its cursor behind otherwise.
    for (const known of [...state.cursors.keys()]) {
      if (!seen.has(known)) state.cursors.delete(known)
    }

    const delta = scanLedger(sources)
    const previous = state.totals ?? EMPTY_TOTALS
    // The per-origin halves, accumulated alongside the total from the same
    // scan so the three can never drift apart.
    const priorSplit = state.split ?? { main: zeroOrigin(), subagent: zeroOrigin() }
    state.split = {
      main: {
        ce: priorSplit.main.ce + delta.main.ce,
        rlit: priorSplit.main.rlit + delta.main.rlit,
        naive: priorSplit.main.naive + delta.main.naive,
        output: priorSplit.main.output + delta.main.outputTokens
      },
      subagent: {
        ce: priorSplit.subagent.ce + delta.subagent.ce,
        rlit: priorSplit.subagent.rlit + delta.subagent.rlit,
        naive: priorSplit.subagent.naive + delta.subagent.naive,
        output: priorSplit.subagent.output + delta.subagent.outputTokens
      }
    }
    // ⚠ THE SCAN IS INCREMENTAL, SO THE RESULT IS ADDED, NOT REPLACED — except
    // the file counts, which describe the CURRENT set rather than a running sum.
    record(sessionId, {
      ce: previous.ce + delta.total.ce,
      rlit: previous.rlit + delta.total.rlit,
      naive: previous.naive + delta.total.naive,
      outputTokens: previous.outputTokens + delta.total.outputTokens,
      entries: previous.entries + delta.total.entries,
      files,
      subagentFiles,
      cacheBreakdownMismatches:
        previous.cacheBreakdownMismatches + delta.consistency.mismatches
    })
  }

  return {
    noteTranscript(sessionId, transcriptPath) {
      if (disposed) return
      const existing = sessions.get(sessionId)
      if (existing && existing.transcriptPath === transcriptPath) return
      // A different path under the same session id is a new conversation:
      // start its cursors and its totals from nothing.
      sessions.set(sessionId, {
        transcriptPath,
        cursors: new Map(),
        totals: null,
        split: null
      })
    },

    refresh(sessionId) {
      if (disposed || !sessions.has(sessionId)) return
      if (scanning.has(sessionId)) return
      scanning.add(sessionId)
      void scan(sessionId)
        .catch((err) => {
          // Never throws into the caller — this is reached from a hook-adjacent
          // event and a rejection there would be unhandled.
          logger.error({ err }, '[engine-ledger] scan failed')
        })
        .finally(() => {
          scanning.delete(sessionId)
        })
    },

    ledgerFor(sessionId) {
      return sessions.get(sessionId)?.totals ?? null
    },

    metricsFor(sessionId) {
      const state = sessions.get(sessionId)
      if (!state || state.totals === null || state.split === null) return null
      const { totals, split } = state
      // ⚠ Plain numbers only, and `main`/`subagent` are never null on this
      // branch: reaching here means the files WERE read. Null is produced by
      // the caller for a session this tracker has never seen — which is the
      // only honest source of "unknown".
      return {
        ce: { total: totals.ce, main: split.main.ce, subagent: split.subagent.ce },
        rlit: { total: totals.rlit, main: split.main.rlit, subagent: split.subagent.rlit },
        naive: { total: totals.naive, main: split.main.naive, subagent: split.subagent.naive },
        output: {
          total: totals.outputTokens,
          main: split.main.output,
          subagent: split.subagent.output
        }
      }
    },

    snapshot() {
      // ⚠ PLAIN OBJECTS ONLY (D14): this crosses the context bridge, and
      // anything class-shaped or reactive fails structured clone at runtime
      // with no compile-time signal. ⚠ ABSENT RATHER THAN ZERO: a session that
      // has never been scanned is omitted, not reported as a row of zeros.
      const out: { sessionId: string; ledger: EngineLedgerTotals }[] = []
      for (const [sessionId, state] of sessions) {
        if (state.totals === null) continue
        out.push({ sessionId, ledger: { ...state.totals } })
      }
      return out
    },

    onLedger(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    forget(sessionId) {
      sessions.delete(sessionId)
      scanning.delete(sessionId)
    },

    dispose() {
      disposed = true
      sessions.clear()
      listeners.clear()
      scanning.clear()
    }
  }
}
