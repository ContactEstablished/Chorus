/**
 * Per-session exact-value scrubber for PTY output (D33 clause 7, council
 * majority 2-of-3; Qwen's accept-and-document dissent preserved in D33).
 *
 * EXACT VALUES, not shapes — and the distinction is the design:
 *   · logger.ts scrubs by SHAPE, because it cannot know which secrets exist
 *     and must catch any of them in arbitrary free text.
 *   · this scrubs by VALUE, because it knows precisely which strings were
 *     injected into this session. Zero false positives, by construction.
 * A shape-based scrubber here would mangle legitimate agent output — a code
 * review of a file containing an example key, a `git diff` of `.env.example`,
 * a docs page — for no security gain. Do not "improve" this by applying
 * secret-patterns.json to the terminal stream.
 *
 * HONEST LIMITS (D33 clause 7, risks 1 and 5 — the council's own words):
 *   · The raw chunk is transiently in main-process memory before scrubbing;
 *     node-pty delivers it there. This mechanism REDUCES RETENTION and
 *     prevents storage/replay/transcript exposure. It does not prevent all
 *     transient main-heap presence, and must never be described as doing so.
 *   · An agent that base64-encodes the key, interleaves ANSI escapes inside
 *     it, or splits it across writes with other content between DEFEATS exact
 *     matching. Out of scope by ruling.
 *   · Scrubbing mutates user-visible terminal output.
 * It does not, and cannot, stop an agent from exfiltrating a key it holds.
 *
 * This module is pure: no electron, no node-pty, no timers (the flush timer
 * lives in SessionManager, which owns the per-session scrubber instance).
 */

/** D33 risk 5: a distinct marker so a reader can tell WHICH mechanism fired —
 *  this, or logger.ts's '[redacted]'. Deliberately different. */
export const CREDENTIAL_PLACEHOLDER = '[REDACTED-CREDENTIAL]'

export interface Scrubber {
  /** Feed a chunk; returns the text safe to store and forward. May return
   *  less than it was given — a tail that could be the start of a secret is
   *  HELD until the next push or a flush. */
  push(chunk: string): string
  /** Release any held tail. Called on a timer (SessionManager) and at session
   *  exit, so a paused TUI never leaves output stranded mid-prefix. */
  flush(): string
  /** Characters currently held. The caller schedules its flush timer on this
   *  being > 0 — exposed as a number so the caller never reaches into state. */
  pendingLength(): number
}

/**
 * Create a scrubber matching the exact values registered for one session.
 *
 * Ordering invariant: the concatenation of every push() return, followed by
 * flush(), equals the concatenation of every input chunk with secrets
 * replaced. Nothing is dropped, nothing is reordered, nothing is emitted
 * twice.
 */
export function createScrubber(secrets: readonly string[]): Scrubber {
  // Longest first: with secrets A and AB both registered, replacing A first
  // would consume AB's prefix and leave 'B' as recognizable residue.
  // Deduplicated and empty-filtered: an empty secret would match everywhere
  // and destroy the stream (belt and braces — the registration API is public
  // within main).
  const ordered = [...new Set(secrets)].filter((s) => s.length > 0).sort((a, b) => b.length - a.length)
  const maxLen = ordered.reduce((m, s) => Math.max(m, s.length), 0)
  let carry = ''

  function push(chunk: string): string {
    // IDENTITY FAST PATH. Every session pays this on every chunk forever, and
    // the overwhelming majority of sessions have no registered secret at all.
    // Return the SAME string reference — no copy, no scan, no allocation.
    if (ordered.length === 0) return chunk

    const work = carry + chunk
    let out = work
    for (const s of ordered) out = out.split(s).join(CREDENTIAL_PLACEHOLDER)

    // Hold the longest suffix that could still grow into a secret. Bounded at
    // maxLen - 1 (D33 resolution e): a full-length suffix would already have
    // been replaced above, so anything longer cannot be a PROPER prefix.
    const hold = heldSuffixLength(out, ordered, maxLen)
    carry = hold === 0 ? '' : out.slice(out.length - hold)
    return hold === 0 ? out : out.slice(0, out.length - hold)
  }

  function flush(): string {
    const held = carry
    carry = ''
    return held
  }

  return { push, flush, pendingLength: () => carry.length }
}

/** Longest k ≤ min(maxLen-1, s.length) such that s's last k characters are a
 *  proper prefix of some secret. 0 when nothing could be forming.
 *
 *  `secret.length > k` is what makes it a PROPER prefix — without it a
 *  complete secret sitting at the end of a chunk would be held instead of
 *  replaced (it was already replaced in push; the guard keeps the two halves
 *  consistent). Scans at most maxLen-1 characters regardless of chunk size. */
function heldSuffixLength(s: string, ordered: readonly string[], maxLen: number): number {
  const limit = Math.min(maxLen - 1, s.length)
  for (let k = limit; k > 0; k--) {
    const tail = s.slice(s.length - k)
    for (const secret of ordered) {
      if (secret.length > k && secret.startsWith(tail)) return k
    }
  }
  return 0
}
