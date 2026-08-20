/**
 * Which clipboard action, if any, a key event in a terminal pane means.
 *
 * Factored out of `TerminalPane.vue` so the decision can be tested without a
 * DOM, an xterm instance or a PTY — the `suggestMode` / `buildReport`
 * precedent. The component keeps the side effects (preventDefault, reading and
 * writing the clipboard); this only reads the event and answers.
 */

/** The fields this decision actually reads. A real `KeyboardEvent` satisfies
 *  it structurally, so the caller passes one unchanged and the test passes a
 *  literal. */
export interface ClipboardKeyEvent {
  type: string
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
  shiftKey: boolean
  key: string
}

export type ClipboardIntent = 'paste' | 'copy' | null

/**
 * Ctrl+C follows the Windows Terminal / VS Code terminal compromise: it copies
 * a visible selection and remains SIGINT when there is no selection. Chorus
 * clears a successfully copied selection, so a second Ctrl+C is unambiguously
 * an interrupt. Ctrl+Shift+C always means copy.
 *
 * Paste takes BOTH Ctrl+V and Ctrl+Shift+V. Ctrl+V is what people on Windows
 * press, it is what Windows Terminal and VS Code's terminal both bind, and the
 * thing it would otherwise send (0x16, readline's quoted-insert) is not
 * something an agent TUI needs.
 */
export function clipboardIntent(e: ClipboardKeyEvent, hasSelection = false): ClipboardIntent {
  // xterm runs its custom handler for keypress and keyup as well; only keydown
  // decides, or a single press would fire the action more than once.
  if (e.type !== 'keydown') return null
  // AltGr arrives as ctrl+alt on Windows layouts — a composed character, never
  // a chord. Meta is excluded for the same reason: it is a different binding.
  if (!e.ctrlKey || e.altKey || e.metaKey) return null
  // `key` is case-shifted by Shift itself, so 'V' and 'v' are one chord.
  const key = e.key.toLowerCase()
  if (key === 'v') return 'paste'
  if (key === 'c' && (e.shiftKey || hasSelection)) return 'copy'
  return null
}
