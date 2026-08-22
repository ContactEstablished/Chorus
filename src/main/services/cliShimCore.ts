/**
 * Pure core for resolving an npm-generated `.cmd` shim to the file it actually
 * launches (F96, 2026-08-21). No `fs`, no `child_process`, no `path`, no
 * imports at all — every filesystem check belongs to `cliDetect.ts`.
 *
 * ⚠ WHY THIS EXISTS, AND IT IS NOT TIDINESS. `pickSpawnable` used to send every
 * `.cmd` shim through `cmd.exe /c`, and cmd.exe RE-PARSES the command line it
 * is handed. node-pty escapes a double quote inside an argument as `\"`; cmd.exe
 * does not recognise that escape, so its quote tracking closes early and every
 * character after it is read as unquoted — where `>` `<` `|` `&` mean
 * redirection and piping, not text.
 *
 * Measured 2026-08-21 under node-pty with `useConpty: true`, same argv, only
 * the spawn route varying (`_verify/6b-2/24-shim-vs-exe-nodepty.txt`):
 *
 *   cmd.exe /c codex.cmd  -c developer_instructions="…-[p:PRODUCED]->(m)…"
 *     -> a file named `(old)` appears in cwd holding the version banner,
 *        and codex dies with `Error: stdout is not a terminal`
 *   codex.exe (the vendored binary) with byte-identical argv   -> clean
 *   node.exe <the shim's own bin/codex.js> with the same argv  -> clean
 *
 * And the quote state is the mechanism, not the arrow
 * (`_verify/6b-2/25-cmd-quote-state.txt`): the SAME arrow passes through the
 * SAME shim untouched when the value carries no `"` at all. So this is a whole
 * class of defect — any argv value holding a quote plus a cmd metacharacter —
 * and escaping cannot close it, because inside a quoted region cmd treats `^`
 * as a literal character and the quote state is exactly what has gone wrong.
 *
 * The fix is to stop involving cmd.exe. An npm shim is a batch file whose only
 * job is to launch something else; this module reads which something.
 *
 * ⚠ npm's shim template is a CONVENTION, NOT A CONTRACT. Every function here
 * returns `null` rather than guessing, and the caller falls back to the old
 * `cmd.exe /c` route on any doubt. A shim shape we do not recognise must behave
 * exactly as it did before this module existed.
 */

/** What an npm shim actually launches, once its `%dp0%` is expanded. */
export interface ShimTarget {
  /** absolute path to the target, with `%dp0%` resolved against the shim */
  readonly file: string
  /** `executable` spawns directly; `node-script` needs node as its interpreter */
  readonly kind: 'node-script' | 'executable'
}

/**
 * A shim larger than this is not one of npm's — the three on this machine are
 * 341 (codex), 148 (opencode) and 351 (kimi) bytes, measured 2026-08-21. The
 * cap keeps a mis-detected binary out of the parser.
 */
export const MAX_SHIM_BYTES = 8192

/** Extensions npm shims hand to node rather than to CreateProcess. */
export const NODE_SCRIPT_EXTENSIONS = ['.js', '.mjs', '.cjs'] as const

/**
 * Resolve an npm `.cmd` shim to the file it launches, or `null` when the shim
 * is not a shape we have measured.
 *
 * ⚠ THE INVOCATION LINE IS IDENTIFIED BY ITS TRAILING `%*`, AND THAT IS LOAD
 * BEARING. npm's template also mentions `"%dp0%\node.exe"` on an `IF EXIST`
 * line — the interpreter PROBE, not the target. Selecting on `%*` (the
 * forward-the-caller's-arguments token) picks the line that launches something
 * and skips the line that tests for something. If more than one line qualifies,
 * this returns `null`: two invocation lines is a shape we have not measured.
 */
export function parseNpmShim(shimText: string, shimPath: string): ShimTarget | null {
  if (shimText.length === 0 || shimText.length > MAX_SHIM_BYTES) return null

  const invocations = shimText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.endsWith('%*'))
  if (invocations.length !== 1) return null

  const relative = quotedTokens(invocations[0])
    .map(stripDp0Prefix)
    .filter((token): token is string => token !== null)
  // Exactly one `%dp0%`-relative token. codex's line also quotes `"%_prog%"`
  // (the interpreter, not dp0-relative, correctly ignored); opencode's quotes
  // only its target. Two would mean we cannot tell which is which.
  if (relative.length !== 1) return null

  const rest = relative[0]
  // An expansion we cannot resolve without running cmd. Refuse rather than
  // spawn a path with a literal `%FOO%` in it.
  if (rest.includes('%')) return null

  const dir = windowsDirname(shimPath)
  if (dir.length === 0) return null

  const file = windowsJoin(dir, rest)
  const kind = classify(file)
  return kind === null ? null : { file, kind }
}

/** Every `"…"` token on a line, quotes removed. */
function quotedTokens(line: string): string[] {
  return (line.match(/"[^"]*"/g) ?? []).map((token) => token.slice(1, -1))
}

/**
 * `%dp0%\rest` or `%~dp0\rest` -> `rest`; anything else -> null.
 *
 * `%dp0%` is npm's own `SET dp0=%~dp0`, which expands to the shim's directory
 * WITH a trailing backslash — the template then writes another one, so the
 * separator run is normalised rather than trusted.
 */
function stripDp0Prefix(token: string): string | null {
  const lower = token.toLowerCase()
  const prefix = lower.startsWith('%dp0%') ? 5 : lower.startsWith('%~dp0') ? 5 : -1
  if (prefix < 0) return null
  const rest = token.slice(prefix).replace(/^[\\/]+/, '')
  return rest.length > 0 ? rest : null
}

function classify(file: string): ShimTarget['kind'] | null {
  const lower = file.toLowerCase()
  if (lower.endsWith('.exe')) return 'executable'
  if (NODE_SCRIPT_EXTENSIONS.some((ext) => lower.endsWith(ext))) return 'node-script'
  return null
}

/** `path.win32.dirname` without importing `path`, so this module stays pure. */
function windowsDirname(file: string): string {
  const cut = Math.max(file.lastIndexOf('\\'), file.lastIndexOf('/'))
  return cut < 0 ? '' : file.slice(0, cut)
}

/** Join, collapsing the separator run npm's own template produces. */
function windowsJoin(dir: string, rest: string): string {
  return `${dir.replace(/[\\/]+$/, '')}\\${rest.replace(/[\\/]+/g, '\\')}`
}
