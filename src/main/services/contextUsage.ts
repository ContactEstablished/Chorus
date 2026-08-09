import fs from 'node:fs/promises'
import { logger } from './logger'
import type { AgentKind, SessionContextUsage } from '../../shared/ipc'
import {
  claudeContextWindow,
  claudeUsage,
  parseClaudeBannerWindow,
  parseClaudeTranscriptTail,
  parseCodexContextLeft
} from './contextUsageCore'

/**
 * The context ring's data source — one tracker, two producers, one
 * edge-triggered broadcast. Modelled on `agentEvents.ts` deliberately: same
 * in-memory map, same "fires only on a real change" contract, same
 * `snapshot()` for the renderer's cold read, and the same rule that a session
 * with no reading is ABSENT rather than zero.
 *
 * ─── SCOPE ────────────────────────────────────────────────────────────────
 * Two agents can answer this question and both are wired here. `opencode` has
 * no source and therefore gets no ring — not a placeholder, not a zero. `kimi`
 * is being retired (Matthew, this session) and was not given one either.
 *
 * ─── THE SECURITY POSTURE, WHICH THIS FILE CHANGES ────────────────────────
 * ⚠ `agentEvents.ts` STATES, IN ITS OWN HEADER, THAT ONLY `hook_event_name` IS
 * READ OFF A HOOK BODY — "no prompt text, no transcript path, no tool input is
 * extracted, stored or logged … What is not taken cannot leak." THIS FEATURE
 * NARROWS THAT CLAIM AND THE HEADER HAS BEEN AMENDED TO MATCH; it must not be
 * left reading as though nothing changed. What is true now:
 *
 *   1. `transcript_path` IS read off the body, and nothing else new is.
 *   2. It is used to open ONE file and is never persisted, never returned over
 *      IPC, and never logged — the path names a directory under the user's home
 *      and is itself mildly identifying.
 *   3. THE FILE'S CONTENT NEVER LEAVES THIS MODULE. The tail is parsed for
 *      three integers and discarded; no message text, no tool input and no
 *      file name from the transcript is retained, broadcast or logged. The
 *      transcript is the user's own conversation and source code, and the
 *      whole point of taking numbers out of it is that numbers are all we take.
 *   4. Read failures are silent by design (see `readTail`).
 *
 * That is a real widening of the attack surface — a hook body can now name any
 * path on disk and make main read 256 KB of it. What bounds it: the body is
 * already authenticated by the per-session capability token (agentEvents note
 * 2), the read is size-capped, the content is never echoed anywhere the caller
 * could observe, and a same-user process — the only thing that can hold a token
 * — can read the file itself anyway. The exposure is "main wastes a read on a
 * file it will find no usage lines in", which is why this is acceptable and why
 * it is written down rather than assumed.
 */

export type ContextUsageListener = (sessionId: string, usage: SessionContextUsage) => void

/**
 * How much of the transcript's tail to read.
 *
 * ⚠ SIZED FOR THE WORST REALISTIC LINE, NOT THE AVERAGE ONE. A transcript line
 * is one message including its tool results, and a single Read of a large file
 * routinely produces a few hundred KB on one line. 256 KB usually holds several
 * messages; when it holds none that parse, `ESCALATED_TAIL_BYTES` gets one
 * larger attempt before the reading is given up on for this tick.
 */
const TAIL_BYTES = 256 * 1024
const ESCALATED_TAIL_BYTES = 2 * 1024 * 1024

/**
 * The floor between two transcript reads for one session.
 *
 * ⚠ THIS IS THE F12 CADENCE RULE APPLIED TO A HOOK BUS. Claude fires
 * PreToolUse + PostToolUse around EVERY tool call — a busy agent produces
 * several hook events per second — and each one would otherwise mean a
 * multi-hundred-KB disk read. The context cannot meaningfully change faster
 * than a model turn, so once per second is already generous.
 */
const READ_THROTTLE_MS = 1_000

export interface ContextUsageTracker {
  /**
   * A hook body named a transcript. Schedules (or throttles) a read.
   *
   * ⚠ FIRE-AND-FORGET BY CONTRACT. The caller is inside an HTTP handler that
   * Claude Code BLOCKS ON — agentEvents' "always answer, and answer fast" rule
   * — so this must never be awaited on that path and never throw into it.
   */
  noteClaudeTranscript(sessionId: string, transcriptPath: string): void
  /** Scan one chunk of a session's (already scrubbed) output. Codex only; a
   *  call for any other agent kind returns immediately. */
  ingestOutput(sessionId: string, agent: AgentKind, text: string): void
  usageFor(sessionId: string): SessionContextUsage | null
  snapshot(): ReadonlyArray<{ sessionId: string; usage: SessionContextUsage }>
  onUsage(listener: ContextUsageListener): () => void
  /** Drop a session's reading (exit, delete). Safe for an unknown id. */
  forget(sessionId: string): void
  dispose(): void
}

export function createContextUsageTracker(opts: {
  /**
   * The model id this session was LAUNCHED with, or null. Injected rather than
   * read here so this module never touches storage — and it is genuinely
   * needed: only the launch knows whether a `[1m]` window was asked for, since
   * the transcript records the base model either way (contextUsageCore).
   */
  readonly resolveLaunchModel: (sessionId: string) => string | null
}): ContextUsageTracker {
  const usage = new Map<string, SessionContextUsage>()
  const listeners = new Set<ContextUsageListener>()
  /** sessionId -> last read timestamp, for the throttle. */
  const lastReadAt = new Map<string, number>()
  /** sessionId -> a read is already in flight; a second must not stack. */
  const reading = new Set<string>()
  /**
   * sessionId -> the window Claude Code PRINTED for itself at startup.
   *
   * ⚠ RANK 1, ABOVE THE LAUNCH PROFILE, and the reason is a measured bug rather
   * than a preference — see `claudeContextWindow`'s note. Held per session and
   * dropped by `forget`, because it describes THIS process: a restart under the
   * same row id re-prints its own banner and may legitimately print a different
   * window if the user changed their model in between.
   */
  const bannerWindow = new Map<string, number>()
  let disposed = false

  function record(sessionId: string, next: SessionContextUsage): void {
    // Edge-triggered on the PERCENT (agentEvents' `record`, same reasoning): a
    // transcript re-read after a no-op tool call returns a token count that
    // differs by a handful and a ring that cannot render the difference.
    const current = usage.get(sessionId)
    if (current && current.usedPercent === next.usedPercent && current.source === next.source) {
      // Keep the fresher token counts even when the percent is unchanged, so a
      // tooltip does not go stale — but do NOT broadcast for it.
      usage.set(sessionId, next)
      return
    }
    usage.set(sessionId, next)
    for (const listener of listeners) {
      try {
        listener(sessionId, next)
      } catch (err) {
        // One bad listener must not stop the others — and must never take down
        // the hook request or the PTY data callback that led here.
        logger.error({ err }, '[context] usage listener threw')
      }
    }
  }

  /**
   * Read the last `bytes` of a file.
   *
   * ⚠ EVERY FAILURE IS SILENT AND RETURNS null, AND THAT IS DELIBERATE RATHER
   * THAN LAZY. The path comes from an agent that may have rotated, compacted or
   * deleted the file; the read races an active writer; and this runs on a hook
   * event, so a logged warning per failure would be a flood describing normal
   * operation. Losing a ring update costs nothing — the previous reading stands
   * and the next hook event tries again.
   *
   * ⚠ THE PATH IS NOT LOGGED, on any branch, including the error one.
   */
  async function readTail(filePath: string, bytes: number): Promise<string | null> {
    let handle: fs.FileHandle | null = null
    try {
      handle = await fs.open(filePath, 'r')
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size === 0) return null
      const length = Math.min(bytes, stat.size)
      const position = stat.size - length
      const buffer = Buffer.allocUnsafe(length)
      const { bytesRead } = await handle.read(buffer, 0, length, position)
      return buffer.subarray(0, bytesRead).toString('utf8')
    } catch {
      return null
    } finally {
      await handle?.close().catch(() => {})
    }
  }

  async function readClaudeTranscript(sessionId: string, transcriptPath: string): Promise<void> {
    try {
      let used: number | null = null
      const tail = await readTail(transcriptPath, TAIL_BYTES)
      if (tail !== null) used = parseClaudeTranscriptTail(tail)
      if (used === null) {
        // One larger attempt: a single enormous tool result can push every
        // assistant line out of a 256 KB window.
        const bigger = await readTail(transcriptPath, ESCALATED_TAIL_BYTES)
        if (bigger !== null) used = parseClaudeTranscriptTail(bigger)
      }
      if (used === null || disposed) return
      // Denominator precedence: what the CLI PRINTED (rank 1) > what the launch
      // profile ASKED FOR (rank 2) > the 200k default. The ranking, and the
      // measured bug behind it, are argued in contextUsageCore.
      const window = bannerWindow.get(sessionId) ?? claudeContextWindow(opts.resolveLaunchModel(sessionId))
      const next = claudeUsage(used, window)
      if (next) record(sessionId, next)
    } finally {
      reading.delete(sessionId)
    }
  }

  return {
    noteClaudeTranscript(sessionId: string, transcriptPath: string): void {
      if (disposed) return
      if (reading.has(sessionId)) return
      const now = Date.now()
      const last = lastReadAt.get(sessionId) ?? 0
      if (now - last < READ_THROTTLE_MS) return
      lastReadAt.set(sessionId, now)
      reading.add(sessionId)
      // ⚠ NOT AWAITED, AND THE `catch` IS NOT OPTIONAL. The caller is Claude
      // Code's blocking hook request; an unhandled rejection here would surface
      // as a process-level warning triggered by ordinary agent activity.
      void readClaudeTranscript(sessionId, transcriptPath).catch((err) => {
        reading.delete(sessionId)
        logger.error({ err }, '[context] transcript read failed')
      })
    },

    ingestOutput(sessionId: string, agent: AgentKind, text: string): void {
      if (disposed) return
      if (agent === 'codex') {
        const next = parseCodexContextLeft(text)
        if (next) record(sessionId, next)
        return
      }
      if (agent === 'claude') {
        // ⚠ THE BANNER IS A DENOMINATOR, NOT A READING. It never calls
        // `record` — a session that has printed its window but produced no
        // transcript usage yet still has NO ring, which is correct: we know how
        // big the context is and nothing at all about how full it is.
        //
        // ⚠ AND IT IS ONLY LEARNED, NEVER UNLEARNED. A chunk without the banner
        // leaves any known value alone rather than clearing it — the banner is
        // printed once at startup and scrolls away, so treating its absence as
        // news would drop the window on the very next keystroke.
        const window = parseClaudeBannerWindow(text)
        if (window !== null && bannerWindow.get(sessionId) !== window) {
          bannerWindow.set(sessionId, window)
          // Re-derive immediately if a reading already exists under the wrong
          // denominator: the transcript read is throttled and hook-driven, so
          // without this the ring could sit visibly wrong until the agent's
          // next tool call — which on an idle session is never.
          const current = usage.get(sessionId)
          if (current?.usedTokens != null) {
            const corrected = claudeUsage(current.usedTokens, window)
            if (corrected) record(sessionId, corrected)
          }
        }
      }
    },

    usageFor(sessionId: string): SessionContextUsage | null {
      return usage.get(sessionId) ?? null
    },

    snapshot(): ReadonlyArray<{ sessionId: string; usage: SessionContextUsage }> {
      return [...usage.entries()].map(([sessionId, u]) => ({ sessionId, usage: u }))
    },

    onUsage(listener: ContextUsageListener): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    forget(sessionId: string): void {
      usage.delete(sessionId)
      lastReadAt.delete(sessionId)
      reading.delete(sessionId)
      bannerWindow.delete(sessionId)
    },

    dispose(): void {
      disposed = true
      usage.clear()
      lastReadAt.clear()
      reading.clear()
      bannerWindow.clear()
      listeners.clear()
    }
  }
}
