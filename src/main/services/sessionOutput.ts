import { createScrubber } from './scrubber'

/**
 * The ONE place session output is scrubbed, buffered and broadcast — for ANY
 * session type. D45(1): scrubbing is a property of "a session emits text", not
 * "a PTY emits text", so a second session type cannot ship unredacted by
 * forgetting a second wiring point. That is the F26 failure shape, and F26 was
 * only found because a live A/B happened to expose it.
 *
 * Deliberately free of electron and node-pty: a PTY drives it from onData, and
 * an api-mode session would drive it from `for await (… of handle.receive())`.
 * The flush timer lives HERE, not in scrubber.ts — the pure scrubber stays
 * timer-free and RegExp-free, and its grep gate still holds.
 *
 * Extracted VERBATIM from SessionManager.spawn's inlined pipeline (Task 3-6
 * Commit 1, D46 — behaviour-neutral chore). The five invariants the inline
 * code carried are preserved unchanged:
 *   1. ONE scrubber.push() per chunk; its single result feeds BOTH the ring
 *      buffer append and the broadcast. Two calls advance the carry twice and
 *      corrupt the stream.
 *   2. Clear timer -> push -> reschedule, in that order, so a pending flush
 *      can never overtake an already-arrived chunk. Correct by construction:
 *      Node is single-threaded, so no timer callback can interleave inside
 *      the ingest body.
 *   3. flush() before notifying exit (the caller's wiring), so the renderer
 *      receives the final bytes ahead of the exit event.
 *   4. The timer is cleared on flush() AND in dispose() — a leaked timer
 *      holds a closure over the secret match set past teardown.
 *   5. The closure IS the match-set storage (D33 resolution a) — there is no
 *      separate structure to forget to clear; the set dies with this object.
 */
export interface SessionOutput {
  /** Feed raw text from any source. Scrubs, appends to the ring buffer, and
   *  broadcasts — ONCE, from a single computed string. */
  ingest(text: string): void
  /** Release any held carry. Timer-driven, and called at session end. */
  flush(): void
  /** The replay buffer, already scrubbed. `attach()` returns this. */
  readonly buffer: string
  /** Clear timers. The scrubber's match set dies with this object. */
  dispose(): void
}

export function createSessionOutput(opts: {
  readonly secrets: readonly string[]
  readonly maxChars: number
  readonly flushMs: number
  /** Broadcast callback. SessionManager passes its dataListeners fan-out. */
  readonly onText: (text: string) => void
}): SessionOutput {
  const scrubber = createScrubber(opts.secrets)
  let buffer = ''
  let timer: ReturnType<typeof setTimeout> | null = null

  // ONE emit path so the ring buffer and the listeners provably consume the
  // SAME scrubbed string, computed once (invariant 1).
  const emit = (text: string): void => {
    if (text.length === 0) return
    buffer += text
    if (buffer.length > opts.maxChars) {
      buffer = buffer.slice(buffer.length - opts.maxChars)
    }
    opts.onText(text)
  }

  return {
    ingest(text: string): void {
      // A pending flush must never overtake a chunk that has already arrived
      // (invariant 2): clear FIRST, then push, then reschedule.
      if (timer) {
        clearTimeout(timer)
        timer = null
      }

      // The raw chunk is referenced exactly ONCE, here. Nothing below sees it.
      emit(scrubber.push(text))

      if (scrubber.pendingLength() > 0) {
        timer = setTimeout(() => {
          timer = null
          emit(scrubber.flush())
        }, opts.flushMs)
      }
    },

    flush(): void {
      // Don't strand a held tail — and don't leave a timer pending behind it
      // (invariant 4).
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      emit(scrubber.flush())
    },

    get buffer() {
      return buffer
    },

    dispose(): void {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    }
  }
}
