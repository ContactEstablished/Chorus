/**
 * Normalise a terminal selection before it goes to the clipboard.
 *
 * ⚠ WHY THIS EXISTS. A terminal buffer is a GRID, not text: every row is padded
 * to the full column width, so `getSelection()` hands back the selection
 * RECTANGLE — `"AFTERFIX-CTRLV-EPSILON            "` for a one-word selection,
 * measured in the running app. Nothing downstream wants those cells; they are an
 * artefact of how a terminal stores a line, not something the user selected.
 *
 * ⚠ LEADING WHITESPACE IS NEVER TOUCHED, and that is the load-bearing half. The
 * most valuable thing anyone copies out of an agent pane is a block of code or a
 * diff, where indentation IS the content — a `.trim()` per line would quietly
 * flatten it. Only the trailing side is padding.
 *
 * Factored out for the same reason as `clipboardIntent`: it is a pure string
 * decision and belongs where it can be tested without a DOM or a PTY.
 */

/**
 * Strip trailing spaces/tabs from every line, then drop wholly-blank lines at
 * the end of the selection.
 *
 * ⚠ THE LINE BREAKS THEMSELVES ARE PRESERVED BYTE FOR BYTE — the pattern matches
 * only horizontal whitespace (`[^\S\r\n]`) and looks ahead at the break rather
 * than consuming it. Splitting on newlines and rejoining with `\n`, the obvious
 * implementation, would silently rewrite CRLF selections to LF and make this
 * function a line-ending converter as a side effect.
 */
export function trimSelectionForClipboard(text: string): string {
  return (
    text
      // Horizontal whitespace immediately before a line break or the very end.
      .replace(/[^\S\r\n]+(?=\r?\n|$)/g, '')
      // Blank rows dragged past the end of the content. They are the same
      // padding one dimension up, so they go for the same reason.
      .replace(/(?:\r?\n)+$/, '')
  )
}
