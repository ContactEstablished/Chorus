import { EMPTY_PROMPT_BUFFER, feedPrompt, type PromptBuffer } from './promptCaptureCore'

/**
 * The last few prompts a human sent to each live session (D190).
 *
 * ─── WHAT THIS RETAINS, AND WHY IT IS NOT A NEW EXPOSURE ──────────────────
 * Prompt text, in main's memory, for the life of the session. Nothing is
 * written to disk here and there is NO SCHEMA CHANGE: D130's ruling that
 * `agent_turns` carries "NO CONTENT COLUMN OF ANY KIND" is untouched, and so
 * is the hook listener's standing promise that it reads no `prompt` field off
 * a hook body. The one thing a reader should check before calling this a
 * widening: `scrollbackStore` ALREADY mirrors every pane's rendered output —
 * the user's own prompts included — to `userData/scrollback/*.log` in plain
 * text, post-scrub. This ring holds strictly less, for less time.
 *
 * ⚠ IT IS SCRUBBED THROUGH THE SESSION'S OWN MATCH SET, not a second one.
 * `note()` takes the scrub function from the caller rather than building a
 * scrubber, because D33 resolution (a) makes the per-session scrubber closure
 * "THE ONLY PLACE in Chorus that retains injected plaintext", and its safety
 * argument rests on there being exactly one such place per session. A second
 * `createScrubber` here would quietly falsify that sentence. The consequence
 * that matters to a user: a credential pasted into a prompt reads as
 * `[REDACTED-CREDENTIAL]` in the modal, exactly as it does in the mirror.
 *
 * ─── LIFETIME ────────────────────────────────────────────────────────────
 * In-memory only, by decision — the history is about the run you are in. It
 * deliberately SURVIVES a restart of the session's PTY (same row id, new
 * process: "what was I asking it before it died" is the question a restart
 * creates, not one it answers), and is dropped when the row itself goes away.
 */

/** One completed prompt. `at` is an ISO string because it crosses IPC and a
 *  Date does not survive structured clone as a Date the renderer can rely on. */
export interface CapturedPrompt {
  readonly text: string
  readonly at: string
}

/** Deep enough to survive a run of short dialog answers ("y", "1", "2") without
 *  losing the real prompt underneath them — which is the whole reason this is a
 *  history and not a single slot. */
export const MAX_PROMPTS_PER_SESSION = 10

export interface PromptCaptureService {
  /**
   * Feed one PTY write.
   *
   * @param scrub applied to a COMPLETED prompt only. Optional so a session
   *   with no registered secret pays nothing, and so tests need no scrubber.
   */
  note(sessionId: string, data: string, scrub?: (text: string) => string): void
  /** Newest first — the order the modal renders. Always a fresh array; a
   *  caller cannot reach the ring through it. */
  history(sessionId: string): CapturedPrompt[]
  /** Drop everything for a session whose row is gone. */
  forget(sessionId: string): void
  /** Teardown: every session at once. */
  clear(): void
}

interface SessionPrompts {
  buf: PromptBuffer
  /** Oldest first internally; reversed on read. */
  ring: CapturedPrompt[]
}

export function createPromptCapture(opts?: {
  readonly maxPrompts?: number
  /** Injectable for tests; production passes nothing and gets the wall clock. */
  readonly now?: () => Date
}): PromptCaptureService {
  const max = opts?.maxPrompts ?? MAX_PROMPTS_PER_SESSION
  const now = opts?.now ?? ((): Date => new Date())
  const bySession = new Map<string, SessionPrompts>()

  return {
    note(sessionId, data, scrub): void {
      if (data.length === 0) return
      let entry = bySession.get(sessionId)
      if (!entry) {
        entry = { buf: EMPTY_PROMPT_BUFFER, ring: [] }
        bySession.set(sessionId, entry)
      }
      const { buf, submitted } = feedPrompt(entry.buf, data)
      entry.buf = buf
      if (submitted.length === 0) return

      const at = now().toISOString()
      for (const raw of submitted) {
        const text = scrub ? scrub(raw) : raw
        // A scrubbed prompt can become empty only if it was entirely a
        // secret; there is nothing left worth showing, and a blank row would
        // read as a bug.
        if (text.trim().length === 0) continue
        entry.ring.push({ text, at })
      }
      if (entry.ring.length > max) entry.ring.splice(0, entry.ring.length - max)
    },

    history(sessionId): CapturedPrompt[] {
      const entry = bySession.get(sessionId)
      if (!entry) return []
      return [...entry.ring].reverse()
    },

    forget(sessionId): void {
      bySession.delete(sessionId)
    },

    clear(): void {
      bySession.clear()
    }
  }
}
