import type { SessionContextUsage } from '../../shared/ipc'

/**
 * The context-ring derivation, factored PURE so Vitest's `environment: 'node'`
 * covers it without a PTY, an HTTP listener or a filesystem — the
 * `agentEventsCore` / `attentionCore` shape, and for the same reason: every
 * decision worth arguing about here is a string-in, number-out decision.
 *
 * ─── WHY TWO SOURCES THAT LOOK NOTHING ALIKE ──────────────────────────────
 * The two agents that can answer "how full is your context" answer completely
 * differently, and no amount of abstraction makes them the same shape:
 *
 *   claude  → its hook payload names a TRANSCRIPT FILE; the last assistant
 *             message in it carries exact token counters, and the WINDOW has to
 *             be supplied from outside.
 *   codex   → it PRINTS the answer, already divided, into its own TUI footer,
 *             and never exposes the tokens behind it.
 *
 * So they meet at `usedPercent` and nowhere else. That is why
 * `SessionContextUsage` has one required number and two nullable ones, and why
 * this module exports two unrelated parsers rather than one clever one.
 *
 * ⚠ AND NEITHER IS AN ESTIMATE. D83's rule is that the answer to "the mock
 * draws data that does not exist" is omit it OR GIVE IT A SOURCE, never fake
 * it — so every function here returns `null` rather than a plausible number
 * when its input does not actually contain one. An agent with no source (today:
 * opencode) gets NO ring at all, exactly as a hook-less agent gets no amber.
 */

/* ------------------------------------------------------------------ */
/* Claude Code: the transcript                                          */
/* ------------------------------------------------------------------ */

/**
 * Claude Code's default context window, in tokens.
 *
 * ⚠ D4-VERIFIED AGAINST THE INSTALLED claude 2.1.225 ON 2026-08-08, BY READING
 * ITS OWN MODEL TABLE RATHER THAN BY RECALLING IT — CLAUDE.md's rule ("CLI agent
 * flags move fast … don't trust training-data memory") applies to a model's
 * context window for exactly the reason it applies to a flag. Every entry in
 * that table reads `context:{window:200000, supports_1m_beta:…,
 * supports_1m_suffix:…}` — Opus, Sonnet and Haiku alike. 200k is the window; the
 * million-token variants are an OPT-IN on top of it, which is what
 * `CLAUDE_1M_SUFFIX` below detects.
 */
export const CLAUDE_DEFAULT_CONTEXT_WINDOW = 200_000

/** The opt-in 1M window, from the same table's `supports_1m_suffix` path. */
export const CLAUDE_1M_CONTEXT_WINDOW = 1_000_000

/**
 * How a 1M session is spelled: a `[1m]` suffix on the model id.
 *
 * ⚠ THIS IS READ OFF CHORUS'S OWN LAUNCH PROFILE, NOT OFF THE TRANSCRIPT, AND
 * THE DISTINCTION IS A CORRECTNESS BUG IF GOT WRONG. The transcript records the
 * BASE model (`"model":"claude-opus-5"`) with no suffix, so a 1M session and a
 * 200k session are byte-identical there. Only the launch knows which was asked
 * for. Resolving the window from the transcript would silently report a 1M
 * session as five times fuller than it is — a ring at 100% on a conversation
 * with 800k tokens of headroom.
 */
const CLAUDE_1M_SUFFIX = '[1m]'

/**
 * Resolve the denominator for a Claude session from the model id it was
 * launched with. `null`/absent — the ordinary case, a plain subscription launch
 * that named no model — is the 200k default, because that is what the CLI's own
 * table says every current model is.
 *
 * ⚠ THIS IS RANK 2, NOT THE AUTHORITY. `parseClaudeBannerWindow` below outranks
 * it, and the reason was MEASURED rather than reasoned about: a session launched
 * with no profile at all came up as `Opus 5 (1M context)` because the USER'S OWN
 * ambient Claude Code configuration selects the 1M variant. Chorus never chose
 * that model and no launch profile mentions it, so this function answered 200k
 * and the ring read 23% for a conversation that was actually at 4.6% — plausible,
 * and five times wrong. What the CLI PRINTS beats what the launch INTENDED.
 */
export function claudeContextWindow(launchModelId: string | null | undefined): number {
  if (launchModelId && launchModelId.trim().toLowerCase().endsWith(CLAUDE_1M_SUFFIX)) {
    return CLAUDE_1M_CONTEXT_WINDOW
  }
  return CLAUDE_DEFAULT_CONTEXT_WINDOW
}

/**
 * Claude Code's startup banner names its own context window, and this reads it.
 *
 * ⚠ OBSERVED ON THIS MACHINE, 2026-08-08, off a live PTY stream rather than from
 * documentation. The banner line is, verbatim:
 *
 *     Opus 5 (1M context) with xhigh effort · Claude Max
 *
 * ⚠ RANK 1 FOR THE DENOMINATOR — see `claudeContextWindow` above for the bug
 * that made it rank 1. This is the same passive-scrape technique the Codex
 * footer uses, and it is preferred here for the same reason: what the agent
 * prints about itself is a fact, while what the launch profile says is an
 * intention that the CLI's own config can silently override.
 *
 * ⚠ ABSENCE IS NOT 200k, IT IS "NO ANSWER" — hence `null` rather than a default.
 * A standard-window session prints no parenthetical at all, and conflating "the
 * banner did not say" with "the banner said 200k" would stop the caller from
 * falling through to the launch profile, which may legitimately know better.
 *
 * Accepts `K` and `M` so a future banner spelling `(500K context)` is read
 * rather than ignored. Case-insensitive; tolerant of the ANSI colour runs that
 * surround it in the real stream (the match needs no adjacency to them).
 */
const CLAUDE_BANNER_WINDOW = /\(\s*(\d{1,4})\s*([KM])\s+context\s*\)/i

export function parseClaudeBannerWindow(chunk: string): number | null {
  const m = CLAUDE_BANNER_WINDOW.exec(chunk)
  if (!m) return null
  const value = Number.parseInt(m[1], 10)
  if (!Number.isFinite(value) || value <= 0) return null
  const tokens = m[2].toUpperCase() === 'M' ? value * 1_000_000 : value * 1_000
  // A banner claiming a 4-token or 4-billion-token window is a coincidental
  // match in some other output, not a context window. Bound it to the range any
  // real model could plausibly have.
  if (tokens < 1_000 || tokens > 100_000_000) return null
  return tokens
}

/**
 * The three counters that make up "how much of the window is spent".
 *
 * ⚠ THE FORMULA IS NOT OURS AND MUST NOT DRIFT FROM CLAUDE CODE'S. Read out of
 * the installed 2.1.225 bundle on 2026-08-08, where the function that builds the
 * `context_window` block of the statusline payload reads, in full:
 *
 *   total_input_tokens: e.input_tokens + e.cache_creation_input_tokens
 *                       + e.cache_read_input_tokens
 *   used  = round(total_input_tokens / context_window_size * 100)  [clamped 0-100]
 *
 * ⚠ `output_tokens` IS DELIBERATELY EXCLUDED, and it is the one term a
 * reasonable person would add. Claude Code excludes it, so including it here
 * would make Chorus's ring disagree with the number the agent shows in its own
 * terminal — two readings of one fact, differing by a few percent, with no way
 * for the user to tell which is lying. Matching the source of truth beats being
 * independently defensible.
 *
 * ⚠ CACHE READS ARE THE BULK OF IT AND ARE NOT OPTIONAL. A long conversation is
 * almost entirely `cache_read_input_tokens`; summing only `input_tokens` (which
 * is routinely 1) would draw an empty ring on a nearly-full context.
 */
export interface ClaudeUsageCounters {
  input_tokens?: unknown
  cache_creation_input_tokens?: unknown
  cache_read_input_tokens?: unknown
}

/** Coerce one counter. Anything that is not a finite non-negative number
 *  contributes zero — a transcript is UNTRUSTED INPUT (the bootInfo/D83
 *  precedent) and a malformed field must not poison the sum with NaN. */
function counter(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

/** Sum the three counters Claude Code sums. Returns null when the object
 *  carries none of them — "this message had no usage block" is a real answer
 *  and must not read as "zero tokens used". */
export function claudeUsedTokens(usage: unknown): number | null {
  if (typeof usage !== 'object' || usage === null) return null
  const u = usage as ClaudeUsageCounters
  const present =
    'input_tokens' in u || 'cache_creation_input_tokens' in u || 'cache_read_input_tokens' in u
  if (!present) return null
  return (
    counter(u.input_tokens) +
    counter(u.cache_creation_input_tokens) +
    counter(u.cache_read_input_tokens)
  )
}

/**
 * Pull the newest assistant-message usage out of a chunk of transcript JSONL.
 *
 * ⚠ IT SCANS BACKWARDS AND STOPS AT THE FIRST HIT, which is both the fast path
 * and the correct one. The context is whatever the MOST RECENT turn sent, not a
 * sum over the file: every line already includes the whole conversation in its
 * `cache_read_input_tokens`, so adding lines together would multiply the
 * context by the number of turns.
 *
 * ⚠ A TRAILING PARTIAL LINE IS EXPECTED, NOT AN ERROR CASE. The caller reads the
 * TAIL of a file the CLI is appending to, so the first line of the chunk is
 * usually cut mid-object and the last may be too. Every line is parsed
 * defensively and an unparseable one is skipped in silence — no logging, because
 * this runs on every tool call and a warn-per-partial-read would be a log flood
 * describing normal operation.
 *
 * ⚠ AND SIDECHAIN LINES ARE SKIPPED. A sub-agent's turns are written into the
 * same file with `isSidechain: true`, and they carry their OWN much smaller
 * context. Counting one would make the ring collapse to near-zero the moment a
 * Task tool ran, then jump back — a flicker that looks like a bug in the ring
 * rather than what it is.
 */
export function parseClaudeTranscriptTail(chunk: string): number | null {
  const lines = chunk.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (line.length === 0 || !line.startsWith('{')) continue
    let entry: unknown
    try {
      entry = JSON.parse(line)
    } catch {
      continue // a partial or malformed line — expected while tailing
    }
    if (typeof entry !== 'object' || entry === null) continue
    const e = entry as Record<string, unknown>
    if (e.isSidechain === true) continue
    if (e.type !== 'assistant') continue
    const message = e.message
    if (typeof message !== 'object' || message === null) continue
    const used = claudeUsedTokens((message as Record<string, unknown>).usage)
    // A zero here means the line had usage keys that were all zero/garbage,
    // which is not a reading worth reporting — keep scanning back for a real one.
    if (used !== null && used > 0) return used
  }
  return null
}

/** Compose the wire value for a Claude reading. Exported so the percent
 *  arithmetic has ONE home and the service does none of its own. */
export function claudeUsage(usedTokens: number, windowTokens: number): SessionContextUsage | null {
  if (!Number.isFinite(windowTokens) || windowTokens <= 0) return null
  if (!Number.isFinite(usedTokens) || usedTokens < 0) return null
  return {
    usedPercent: clampPercent(Math.round((usedTokens / windowTokens) * 100)),
    usedTokens: Math.round(usedTokens),
    windowTokens: Math.round(windowTokens),
    source: 'claude-transcript'
  }
}

/* ------------------------------------------------------------------ */
/* Codex: the TUI footer                                                */
/* ------------------------------------------------------------------ */

/**
 * Codex prints its own context reading into the status line, continuously, once
 * the `context-remaining` item is enabled (which `codex.ts` does on every
 * Chorus launch via `-c tui.status_line=[...]`).
 *
 * WARNING: THE RENDERED FORM IS `Context 100% left` - WORD FIRST, THEN THE
 * NUMBER - AND AN EARLIER VERSION OF THIS PARSER HAD IT BACKWARDS. The mistake
 * is worth recording because of how it was made: the shipped 0.147.0 binary's
 * string table contains the literals `% context left` and `100% context left`,
 * which read exactly like a `N% context left` format, so the first regex matched
 * that shape. It never fired once. The ACTUAL bytes, captured off a live PTY on
 * 2026-08-08, are (ESC shown as \x1b):
 *
 *   ...wt-a49c9544\x1b[m\x1b[2m . \x1b[38;2;242;181;144m\x1b[22mContext 100% left\x1b[K
 *
 * A string in a binary is evidence that a string EXISTS, not evidence of what
 * gets rendered. Both spellings are accepted below: the observed one because it
 * is what actually appears, the table one because it demonstrably exists in the
 * CLI and may be another item's or another version's wording.
 *
 * WARNING: THIS IS A PASSIVE SCRAPE AND MUST STAY ONE. The obvious alternative -
 * have Chorus type `/status` into the PTY on a timer - was rejected: it would
 * inject keystrokes into a terminal the user is typing in, race their own input,
 * and print a status block into their scrollback every tick. Reading what the
 * TUI already draws costs the agent nothing and cannot corrupt its input.
 *
 * WARNING: THE WORD `context` IS MANDATORY IN BOTH ALTERNATIVES, AND THAT IS A
 * CORRECTNESS GUARD RATHER THAN TIDINESS. Codex's own `/status` block prints
 * `Weekly limit: [####] 96% left (resets 16:46 on 15 Aug)`, and a second line
 * like it for the Spark limit. A regex relaxed to `(\d+)%\s*left` would read a
 * QUOTA reading as a CONTEXT reading - a plausible number, the wrong fact, and
 * no way for anyone to tell from the ring. The unit suite pins this.
 *
 * ANSI is tolerated between the number and the words in the table-spelling arm,
 * because a TUI does split a phrase across colour escapes. The observed arm
 * needs none - its phrase arrives contiguous, as the capture above shows.
 *
 * WARNING: THE TRAILING WORD IS OPTIONAL BECAUSE CODEX ELLIPSISES ITS OWN
 * FOOTER, AND REQUIRING IT WAS A REAL, SILENT BUG. Observed 2026-08-13 in a pane
 * whose cwd was long enough to overflow the status line:
 *
 *   gpt-5.6-sol high . C:\Projects\ContactEstablished\Mission Map . Context 29% l…
 *
 * codex truncates the COMPOSED line to the terminal width and appends `…`, so
 * the bytes on the wire genuinely end mid-word. The old `\s*left` never matched
 * them, and the failure is invisible in exactly the way an absent ring is: the
 * value freezes at whatever the last wide-enough redraw said, and nothing is
 * logged. Narrow panes, deep project paths and split layouts all produce it.
 * Accepted terminators are therefore `left`, any prefix of `left` followed by an
 * ellipsis, a bare ellipsis, or end-of-chunk.
 *
 * WARNING: `used` IS STILL REJECTED, AND THAT IS WHY THE TERMINATOR SET IS A
 * LIST RATHER THAN "ANYTHING". `context-used` is a real codex status item and it
 * renders `Context 29% used` — the SAME shape carrying the OPPOSITE fact.
 * Relaxing this to `context\s+(\d+)\s*%` would invert the ring for anyone who
 * enables it with `/statusline` inside the pane, and the reading would look
 * perfectly reasonable while being 100-minus-the-truth. The unit suite pins it.
 */
const CODEX_FOOTER =
  /context\s+(\d{1,3})\s*%\s*(?:left\b|(?:left|lef|le|l)?\s*(?:\u2026|\.\.\.)|$)|(\d{1,3})\s*%(?:\x1b\[[0-9;?]*[A-Za-z]|[\s\x00-\x1f])*context\s+left/gi

/**
 * Find the LAST context reading in a chunk of Codex output, or null.
 *
 * ⚠ LAST, NOT FIRST, AND IT MATTERS ON EVERY SINGLE CHUNK. A TUI redraw commonly
 * carries several frames of the footer in one write; the earliest is the most
 * stale. Taking the first would leave the ring one redraw behind forever.
 *
 * ⚠ `codex` REPORTS CONTEXT **LEFT**, AND THIS RETURNS CONTEXT **USED**. The
 * inversion is the single easiest thing to get backwards in this whole feature,
 * and getting it backwards produces a ring that looks entirely plausible while
 * being exactly wrong — full when the session is fresh, empty when it is about
 * to compact.
 */
export function parseCodexContextLeft(chunk: string): SessionContextUsage | null {
  CODEX_FOOTER.lastIndex = 0
  let match: RegExpExecArray | null
  let left: number | null = null
  while ((match = CODEX_FOOTER.exec(chunk)) !== null) {
    // Group 1 is the OBSERVED spelling (`Context 100% left`), group 2 the
    // string-table one (`100% context left`). Exactly one can be set per match;
    // reading both is what lets the two alternatives share this loop.
    const digits = match[1] ?? match[2]
    const value = Number.parseInt(digits, 10)
    if (Number.isFinite(value) && value >= 0 && value <= 100) left = value
  }
  if (left === null) return null
  return {
    usedPercent: clampPercent(100 - left),
    // ⚠ BOTH NULL, DELIBERATELY. Codex gives a percent and nothing else;
    // back-computing tokens from an assumed window would be a fabricated
    // denominator wearing a measurement's clothes (D76). The tooltip says
    // "62% of context used" for Codex and names real token counts only for
    // Claude, because only Claude supplied any.
    usedTokens: null,
    windowTokens: null,
    source: 'codex-footer'
  }
}

/** 0–100, integer. One home, so no caller rounds or bounds differently. */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, Math.round(value)))
}
