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
 * Flatten terminal bytes to the plain text a PERSON would read on the screen,
 * for MATCHING ONLY. Never for display, never for the mirror.
 *
 * ⚠ THIS EXISTS BECAUSE A CLASSIFIER READING RAW PTY BYTES CANNOT FIND A
 * SENTENCE, AND THAT WAS MEASURED RATHER THAN ANTICIPATED. Task 4a-3's runtime
 * gate 4 caught `claude --resume <stale uuid>` printing its failure as:
 *
 *   `No` ESC[1C `conversation` ESC[1C `found` ESC[1C `with` ESC[1C `session` …
 *
 * — the renderer emits CURSOR-FORWARD-ONE for each space rather than a space
 * character. Both adapters' `classifyResumeFailure` regexes are written against
 * ordinary prose (`/No conversation found with session ID/i`) and are unit
 * tested against ordinary prose, so against real bytes they matched NOTHING and
 * the entire Q4 recovery path was dead code: a stale pointer left the pane
 * exited instead of relaunching it fresh.
 *
 * ⚠ AND IT IS DONE HERE, IN MAIN, RATHER THAN IN EACH ADAPTER'S REGEX. The
 * alternative is every adapter — including every future one — hand-rolling
 * escape-tolerant patterns for text it only ever describes in plain language.
 * That is vendor-agnostic terminal decoding smeared across the adapter layer,
 * which is the same "one place, not N places" argument D45(1) makes about
 * scrubbing. `ResumeExitObservation.output` is documented as "the bounded
 * terminal TEXT needed for adapter-local failure recognition"; this is what
 * makes the word "text" true.
 *
 * A CSI sequence becomes ONE SPACE rather than nothing, because the sequence
 * this bug turns on (`ESC[1C`) IS a space visually — dropping them instead
 * yields `Noconversationfoundwith`. The transform only ever INSERTS word
 * boundaries, never removes characters, so it cannot manufacture a phrase that
 * was not on the screen.
 *
 * ⚠ RESIDUAL RISK, NAMED: an escape sequence in the MIDDLE of a word (a colour
 * change mid-token) would insert a space inside it and defeat a regex. The
 * measured vendor failure lines are unstyled plain text printed after the TUI
 * has torn down, so this does not bite today — but a future adapter matching
 * against styled output should know it is possible.
 */
export function flattenTerminalText(text: string): string {
  return (
    text
      // CSI: ESC [ <params> <intermediates> <final @-~>. This is the one that
      // matters — ESC[1C is how the space arrives.
      // eslint-disable-next-line no-control-regex
      .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, ' ')
      // OSC strings (window titles): ESC ] … BEL, or ESC ] … ESC \
      // eslint-disable-next-line no-control-regex
      .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, ' ')
      // Any other ESC-introduced sequence.
      // eslint-disable-next-line no-control-regex
      .replace(/\u001b[@-_]?/g, ' ')
      // Stray C0 controls, keeping CR, LF and TAB.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
      // Collapse horizontal whitespace runs, so one space is one space.
      .replace(/[^\S\r\n]+/g, ' ')
  )
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
 * Q7 / D143(g): the visible boundary between a retained scrollback mirror and a
 * conversation that does NOT share its history.
 *
 * Lives here, beside `replayEpilogue`, because it is the same class of thing:
 * terminal text main SYNTHESISES rather than receives.
 *
 * ⚠ THIS STRING IS PERSISTED. It goes through the session's one emit path
 * (`sessionOutput.ts:94`) and is therefore mirrored to disk like any other
 * session text — which is the whole point. It becomes a permanent, correctly
 * placed record of when the conversation changed, still there at the next
 * restore. Appended to `replaySeed` instead it would be redrawn at every
 * attach, would drift to the wrong place in history, and would never be
 * recorded at all.
 *
 * ⚠ CHANGING THIS TEXT CHANGES FUTURE ENTRIES ONLY. Old mirrors keep the old
 * wording, and that is correct: they are describing what happened at the time.
 *
 * The frame resets the scroll region and attributes first — the stream above
 * may have left either set — then PARKS THE CURSOR AT THE BOTTOM before
 * printing, and puts the line on a row of its own at both ends.
 *
 * ⚠ THE `[999;1H` PARK IS NOT DECORATION, AND IT IS NOT WHAT THE SPEC WROTE.
 * ImplementationSpec-4a-3 §6 specifies this frame WITHOUT it, and shipping that
 * literally was MEASURED AS VISIBLY WRONG (Task 4a-3 runtime gate 6; the
 * evidence is `_verify/4a-3/09-codex-boundary-scrolled.png`, captured BEFORE
 * this fix). The replayed screen is painted with ABSOLUTE cursor moves, so it
 * leaves the cursor wherever that screen happened to end — mid-screen — and an
 * unparked boundary prints THROUGH the retained history rather than below it,
 * overwriting the very text it exists to separate. Q7 requires the pane to show
 * retained history ABOVE a visible boundary; the park is what earns "above".
 *
 * Sequence, each step load-bearing: park at the last row, `\r\n` to scroll the
 * retained screen up by one, print the line on the freed row, `\r\n` to close
 * it. The caller's ONE `replayEpilogue()` then lifts history and boundary
 * together into xterm's scrollback, in that order.
 */
export function conversationBoundary(reason: 'restart' | 'context-not-restored'): string {
  const text =
    reason === 'restart'
      ? '── Session restarted: fresh conversation ──'
      : '── Context was not restored: started a fresh conversation ──'
  return '\u001b[r\u001b[m\u001b[999;1H\r\n' + text + '\r\n'
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
