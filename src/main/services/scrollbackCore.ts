/**
 * The scrollback mirror's PURE half (Task 4a-4 / D141): the head-truncation
 * rule, the cap arithmetic, and the "what do we replay" computation.
 *
 * ⚠ NO imports from 'electron', 'node:fs', 'better-sqlite3' or a clock. This
 * module is the house pure-core pattern (`restore.ts`'s `computeRestoreSet`,
 * `attentionCore.ts`, `turnsCore.ts`): everything that can be decided from
 * strings and numbers is decided here, where Vitest can exercise it without a
 * temp directory and without spawning anything.
 *
 * ⚠ THE RULE IMPLEMENTED HERE IS NOT A NEW ONE. It is `sessionOutput.ts:60–61`
 * — the in-memory ring buffer's own truncation — written down once so the two
 * cannot drift. "The file holds what the buffer would have held" is the whole
 * contract of this task; two independently-maintained truncation rules would
 * break it in a way nobody would ever see, because both halves would look
 * individually correct.
 */

/**
 * The mirror's cap, in CHARACTERS, deliberately equal to `BUFFER_MAX_CHARS`
 * (`sessionManager.ts:25`).
 *
 * ⚠ IT IS EQUAL BY CONTRACT, NOT BY COINCIDENCE, and `scrollbackCore.test.ts`
 * asserts the equality against `sessionManager.ts`'s own source text rather
 * than trusting this comment. The file is a MIRROR of the ring buffer, so a
 * larger cap here would replay history the live pane could never have shown,
 * and a smaller one would lose history the pane still had in memory.
 *
 * Characters rather than bytes, for the same reason: the ring buffer counts
 * characters, and a byte cap would truncate a mirror of a character-capped
 * buffer at a different point — and could split a multi-byte sequence.
 */
export const SCROLLBACK_MAX_CHARS = 4_000_000

/**
 * How far past the cap a file may grow before it is rewritten.
 *
 * ⚠ THE SLACK IS WHAT MAKES THE CAP AFFORDABLE, and without it this feature
 * would be a performance bug rather than a feature. Re-truncating on every
 * append would mean rewriting up to 4 MB, twenty times a second (`SCRUB_FLUSH_MS
 * = 50`), for EVERY open pane. With 25% slack the rewrite happens once per
 * megabyte of overflow instead — amortised to nothing — and the cost is that a
 * file may sit up to 25% over the cap between rewrites, which no reader cares
 * about because every read tails it back down to the cap anyway.
 */
export const SCROLLBACK_SLACK_RATIO = 1.25

/**
 * The head-truncation rule: append `incoming` to `existing` and keep only the
 * last `maxChars` characters.
 *
 * The TAIL is what survives, always — the newest output is the output a person
 * reopening a pane is looking for, and it is what the in-memory buffer keeps
 * too. A chunk larger than the whole cap is truncated to the cap's tail rather
 * than rejected: the alternative is a pane that shows nothing at all after a
 * single huge write, which is strictly worse than showing its end.
 */
export function capTail(existing: string, incoming: string, maxChars: number): string {
  if (maxChars <= 0) return ''
  const combined = existing + incoming
  if (combined.length <= maxChars) return combined
  return combined.slice(combined.length - maxChars)
}

/**
 * What a restored pane should be seeded with, given what is on disk.
 *
 * ⚠ THE SAME COMPUTATION AS `capTail`, ON PURPOSE, and expressed in terms of it
 * so it can never become a second rule. A file can legitimately be over the cap
 * when this runs — that is exactly what `SCROLLBACK_SLACK_RATIO` permits — so
 * the read side has to tail it, not trust it.
 */
export function planReplay(fileContents: string, maxChars: number): string {
  return capTail('', fileContents, maxChars)
}

/* ------------------------------------------------------------------------ */
/* F58 EXPERIMENT — making a replayed mirror actually VISIBLE in the pane.    */
/*                                                                            */
/* The mirror works, but a restored pane still LOOKS empty, because the fresh */
/* TUI erases the replay a moment after it lands: codex sends ESC[2J (it does */
/* NOT use the alternate screen — measured), and Claude Code switches to the  */
/* alternate screen with ?1049h. Two different mechanisms, same outcome.      */
/*                                                                            */
/* ⚠ STRIPPING THE ESCAPES DOES NOT WORK, AND IT WAS MEASURED RATHER THAN     */
/* ASSUMED. The escapes ARE the layout: absolute cursor moves are what put    */
/* text at a row and column, so removing them concatenates unrelated screen   */
/* regions ("Claude Codev2.1.229", "…\Chorus◉ xhigh · /effort"). And a        */
/* repaint stream is not a transcript — one captured mirror stripped to       */
/* 44,958 non-blank lines of which 14 were UNIQUE. There is no linear history */
/* in there to recover.                                                       */
/*                                                                            */
/* So: keep every escape, and instead make the LAST PAINTED SCREEN survive by */
/* scrolling it into xterm's scrollback before the new TUI can clear it. ESC  */
/* [2J clears the viewport, never the scrollback — so anything pushed above   */
/* the viewport first is out of its reach.                                    */
/* ------------------------------------------------------------------------ */

/** How many blank lines the epilogue emits to push the replayed screen up. */
const REPLAY_SCROLL_LINES = 40

/**
 * Remove ONLY the alternate-screen switches from a replayed mirror.
 *
 * ⚠ THE NARROWEST POSSIBLE EDIT, AND THE ONLY ONE THAT IS SAFE. The alternate
 * screen has no scrollback by definition, and leaving it DISCARDS whatever was
 * painted there — so a Claude Code mirror replayed verbatim paints its history
 * somewhere that cannot be scrolled to and is then thrown away. Dropping just
 * these switches makes the same bytes paint on the NORMAL buffer, where the
 * epilogue below can lift them into scrollback. Every other escape — colour,
 * cursor position, erase — is preserved exactly, because they are the layout.
 */
export function stripAltScreen(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[\?(?:1049|1047|47)[hl]/g, '')
}

/**
 * What to emit AFTER a replayed mirror so the screen it painted becomes
 * scrollback rather than something the next repaint overwrites.
 *
 * Reset the scroll region and attributes first (the old stream may have left
 * either set), park the cursor at the bottom, then scroll. Without the region
 * reset the newlines would scroll only a sub-window of the screen.
 */
export function replayEpilogue(scrollLines: number = REPLAY_SCROLL_LINES): string {
  return '\u001b[r\u001b[m\u001b[999;1H' + '\r\n'.repeat(scrollLines)
}

/**
 * Is this file far enough over the cap to be worth rewriting?
 *
 * Strictly greater-than, so a file sitting exactly at the threshold is left
 * alone — one fewer 4 MB rewrite, and the next chunk will cross it anyway.
 */
export function exceedsSlack(currentLength: number, maxChars: number, slackRatio: number): boolean {
  if (maxChars <= 0) return currentLength > 0
  return currentLength > maxChars * slackRatio
}
