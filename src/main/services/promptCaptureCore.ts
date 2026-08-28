/**
 * Reconstruct the prompts a HUMAN sent to an agent, from the bytes Chorus
 * writes to its PTY (D191).
 *
 * ─── WHY THE INPUT SIDE AND NOT THE SCREEN ────────────────────────────────
 * The obvious source is the terminal buffer: `TerminalPane.paintUserRows`
 * already groups the user's own rows by a per-agent marker glyph. It was
 * rejected because that marker is MEASURED FOR CLAUDE ONLY (`USER_ROW_MARKER`
 * holds exactly one entry, and its own docblock says an unmeasured agent must
 * render as it always has). A feature built on it would be permanently blank
 * on codex, opencode, kimi and grok panes.
 *
 * Everything a human sends to ANY agent instead passes through one function —
 * `SessionManager.write` — with exactly two callers: the renderer's keystrokes
 * off `session:write`, and voice dictation's `writeToTarget`. Reading there is
 * agent-agnostic by construction, and it is the only source that catches a
 * DICTATED prompt at all (voice writes straight to main and never touches
 * `terminal.onData`).
 *
 * ─── WHAT THIS MODULE IS NOT ──────────────────────────────────────────────
 * It is not a terminal emulator. It reconstructs what was TYPED, which is
 * usually but not always what was SENT:
 *
 *   · Cursor movement is DROPPED, not applied. Arrow-key editing in the middle
 *     of a composed prompt therefore records the characters in typed order
 *     rather than final order. Accepted deliberately: applying cursor motion
 *     means modelling the agent's own line editor, per agent, and the caller
 *     keeps a HISTORY of the last several prompts precisely so an imperfect
 *     row is recoverable rather than misleading.
 *   · Text the TUI inserts on the user's behalf never reaches the write path
 *     at all — tab-completion, an `@file` picker, a slash-command menu. `/co`
 *     plus Tab records as `/co`.
 *
 * Both bounds are stated in D191 and must not be quietly dropped from it.
 *
 * ─── THE TWO ENTER KEYS ───────────────────────────────────────────────────
 * `\r` (CR) submits; `\n` (LF) is a newline INSIDE the prompt. That is not a
 * guess and not a convention borrowed from elsewhere: D180's keybinding survey
 * established that ^J is line feed — the newline key inside claude's and
 * codex's composers — which is why Ctrl+J was refused as an app shortcut.
 *
 * ⚠ AND INSIDE A BRACKETED PASTE, CR IS NOT A SUBMIT. A pasted multi-line
 * block arrives wrapped in `ESC[200~ … ESC[201~` with its own line endings; a
 * naive reader commits the first line and attributes the rest to the next
 * prompt. Paste state is therefore part of the buffer, not a local.
 *
 * Pure: no electron, no node-pty, no timers, no clock. The caller stamps time.
 */

/** A secret longer than this cannot be typed in one go anyway, and the cap is
 *  what stops a multi-megabyte paste from sitting in main's heap for the rest
 *  of the session. Text past it is dropped, not buffered. */
export const MAX_PROMPT_CHARS = 4096

/**
 * One session's in-progress prompt. Treated as immutable by `feedPrompt` —
 * every call returns a fresh object rather than mutating, so a caller may hold
 * one without it changing underneath.
 */
export interface PromptBuffer {
  /** What has been typed since the last submit or clear. */
  readonly text: string
  /** True between `ESC[200~` and `ESC[201~`, where CR means a newline. */
  readonly inPaste: boolean
}

export const EMPTY_PROMPT_BUFFER: PromptBuffer = { text: '', inPaste: false }

export interface PromptFeedResult {
  readonly buf: PromptBuffer
  /** Prompts completed by this chunk, in order. Almost always empty or one —
   *  an array because a single write CAN carry two submits, and silently
   *  keeping the last would lose a prompt with no way to notice. */
  readonly submitted: readonly string[]
}

/** ESC `[` … final byte in 0x40–0x7E. The final byte is what ends it, so this
 *  handles parameters of any length without a table of known sequences. */
function csiEnd(chunk: string, start: number): number {
  for (let i = start + 2; i < chunk.length; i++) {
    const c = chunk.charCodeAt(i)
    if (c >= 0x40 && c <= 0x7e) return i
  }
  return -1 // unterminated in this chunk
}

function dropLastWord(text: string): string {
  const trimmed = text.replace(/\s+$/, '')
  const cut = trimmed.lastIndexOf(' ')
  return cut === -1 ? '' : trimmed.slice(0, cut + 1)
}

/**
 * Feed one PTY write. Returns the new buffer and anything it completed.
 *
 * Everything not named here is DROPPED rather than appended — an unrecognised
 * control byte must never become a visible character in a recalled prompt.
 */
export function feedPrompt(buf: PromptBuffer, chunk: string): PromptFeedResult {
  let text = buf.text
  let inPaste = buf.inPaste
  const submitted: string[] = []

  const append = (s: string): void => {
    if (text.length >= MAX_PROMPT_CHARS) return
    text = (text + s).slice(0, MAX_PROMPT_CHARS)
  }

  const submit = (): void => {
    const done = text.trim()
    // An empty buffer commits nothing, which is what keeps a bare Enter at a
    // confirmation dialog from adding a blank row to the history.
    if (done.length > 0) submitted.push(done)
    text = ''
  }

  for (let i = 0; i < chunk.length; i++) {
    const ch = chunk[i]

    if (ch === '\x1b') {
      if (chunk[i + 1] === '[') {
        const end = csiEnd(chunk, i)
        if (end === -1) return { buf: { text, inPaste }, submitted } // partial; drop the rest
        const seq = chunk.slice(i, end + 1)
        if (seq === '\x1b[200~') inPaste = true
        else if (seq === '\x1b[201~') inPaste = false
        i = end
        continue
      }
      if (chunk[i + 1] === 'O') {
        i += 2 // SS3 — arrow keys in application cursor mode
        continue
      }
      if (i + 1 < chunk.length) {
        i += 1 // ESC-prefixed meta chord
        continue
      }
      // A LONE ESC IS THE ESCAPE KEY, and in every agent composer measured
      // here that abandons what was being written. Recording a prompt the
      // user explicitly discarded is worse than recording nothing.
      text = ''
      continue
    }

    if (ch === '\r') {
      if (inPaste) append('\n')
      else submit()
      continue
    }
    if (ch === '\n') {
      append('\n')
      continue
    }
    if (ch === '\x7f' || ch === '\b') {
      text = text.slice(0, -1)
      continue
    }
    if (ch === '\x15' || ch === '\x03') {
      text = '' // Ctrl+U kills the line, Ctrl+C abandons it
      continue
    }
    if (ch === '\x17') {
      text = dropLastWord(text)
      continue
    }

    const code = chunk.charCodeAt(i)
    if (code < 0x20) continue // any other C0: Tab, Ctrl+anything, bells
    append(ch)
  }

  return { buf: { text, inPaste }, submitted }
}
