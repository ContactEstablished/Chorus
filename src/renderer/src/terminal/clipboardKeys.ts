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
 * ⚠ CTRL+C IS NOT COPY HERE, AND THAT IS THE LOAD-BEARING LINE IN THIS FILE.
 * It must keep reaching the PTY as SIGINT: it is the only way to interrupt a
 * running agent, and this is an app whose entire purpose is running agents.
 * Windows Terminal's copy-when-there-is-a-selection compromise was considered
 * and rejected for exactly that reason — it makes "can I interrupt this?"
 * depend on whether some text happens to be selected, which is invisible at the
 * moment you need the answer.
 *
 * So copy is Ctrl+Shift+C, the convention in every terminal emulator, and the
 * one `App.vue` already assumes when it refuses to bind that chord globally.
 *
 * Paste takes BOTH Ctrl+V and Ctrl+Shift+V. Ctrl+V is what people on Windows
 * press, it is what Windows Terminal and VS Code's terminal both bind, and the
 * thing it would otherwise send (0x16, readline's quoted-insert) is not
 * something an agent TUI needs.
 */
export function clipboardIntent(e: ClipboardKeyEvent): ClipboardIntent {
  // xterm runs its custom handler for keypress and keyup as well; only keydown
  // decides, or a single press would fire the action more than once.
  if (e.type !== 'keydown') return null
  // AltGr arrives as ctrl+alt on Windows layouts — a composed character, never
  // a chord. Meta is excluded for the same reason: it is a different binding.
  if (!e.ctrlKey || e.altKey || e.metaKey) return null
  // `key` is case-shifted by Shift itself, so 'V' and 'v' are one chord.
  const key = e.key.toLowerCase()
  if (key === 'v') return 'paste'
  if (key === 'c' && e.shiftKey) return 'copy'
  return null
}
