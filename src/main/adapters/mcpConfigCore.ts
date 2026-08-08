import secretPatterns from '../services/secret-patterns.json'
import type { McpDescriptor, McpServerRef } from './types'

/**
 * Task 6-2 (Phase 6 Stage 1) — THE MCP SECURITY CORE.
 *
 * PURE: no `fs`, no `electron`, no adapter imported. Nothing in this file can
 * write anything, and that is the deliverable rather than a side effect —
 * Stage 1 ships the guard BEFORE anything acquires the ability to write a file
 * (D91's staging, plan §9: *"logic that is not in a pure core is logic that
 * cannot be tested"*).
 *
 * Importing `secret-patterns.json` directly is the councilService.ts:5
 * precedent: ONE pattern list, several consumers. A second list here would be a
 * second thing to keep in step, and the one that drifted would be the one that
 * mattered.
 *
 * ⚠ THE BRIGHT LINE THIS FILE EXISTS TO HOLD (D49 · D93 · AUTH-PRECEDENCE
 * FINDING): NO SECRET VALUE REACHES ANY CLI'S CONFIG FILE OR ARGV, IN ANY MODE.
 * Not "not by default" — never. A credentialed mode passes a variable NAME.
 */

/* ─── Rendering ──────────────────────────────────────────────────────── */

/**
 * Quote a value as a TOML basic string for a `-c key=<value>` override, so
 * names with spaces (provider names are user-authored) parse as one string
 * rather than falling back to `-c`'s raw-literal rescue path.
 *
 * ⚠ MOVED HERE FROM `codex.ts` BY TASK 6-2, AND THE ALGORITHM IS UNCHANGED —
 * backslashes first, then quotes, or the escapes introduced by the second
 * replace would themselves be escaped by the first. codex.ts's own docblock
 * says there must not be a second quoter in that file; `mcpLaunchArgs` needed
 * the same one, so the quoter moved to where both callers can share it rather
 * than being copied. Byte-for-byte neutrality of codex's existing route and
 * effort overrides is pinned by `adapters.test.ts` and by the escaping cases in
 * this module's own suite — which did NOT exist before this task and is why the
 * move was safe to make only alongside them.
 */
export function tomlBasicString(v: string): string {
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** A TOML inline array of basic strings, in codex's own emitted form —
 *  `["a","b"]`, no space after the comma, exactly as 6-1's probe accepted. */
function tomlStringArray(values: readonly string[]): string {
  return `[${values.map(tomlBasicString).join(',')}]`
}

/**
 * The argv tokens for a `launch-args` mechanism (codex).
 *
 * ⚠ `-c` AND ITS PAYLOAD ARE TWO SEPARATE ARGV ENTRIES, matching the idiom
 * `buildLaunch` already uses for its D47 route overrides. One combined token
 * would not survive the shim.
 *
 * Emits per server:
 *   -c mcp_servers.<name>.command="<command>"
 *   -c mcp_servers.<name>.args=["<a>","<b>"]
 *   -c mcp_servers.<name>.env_vars=["NEO4J_PASSWORD"]      (only when asked)
 *
 * ⚠ AND DELIBERATELY NEVER `mcp_servers.<name>.env=…`. codex accepts that field
 * — 6-1 probed it live — and it carries name→VALUE pairs. `env_vars` carries
 * NAMES ONLY, and the value arrives through the environment `composeChildEnv`
 * built. This is the same class of fact D47/D49 already ratified for
 * `model_providers.<key>.env_key`: a name in argv, not a value. So H1 (argv is
 * world-readable via `Get-CimInstance Win32_Process`, the hazard `types.ts`
 * records against `extraArgs`) is NO WIDENING over the line codex already
 * emits.
 *
 * ⚠ `McpServerRef.env` IS THEREFORE NOT RENDERED HERE AT ALL, and that is not
 * an omission. `env` holds the FILE mechanisms' interpolation placeholders
 * (`${VAR}` for claude, `{env:VAR}` for opencode); codex interpolates neither,
 * so emitting it would put literal placeholder text into argv. Anything codex
 * needs from the environment travels as a name in `envPassthrough`.
 */
export function renderMcpLaunchArgs(servers: readonly McpServerRef[]): readonly string[] {
  const args: string[] = []
  for (const s of servers) {
    args.push('-c', `mcp_servers.${s.name}.command=${tomlBasicString(s.command)}`)
    args.push('-c', `mcp_servers.${s.name}.args=${tomlStringArray(s.args)}`)
    if (s.envPassthrough && s.envPassthrough.length > 0) {
      args.push('-c', `mcp_servers.${s.name}.env_vars=${tomlStringArray(s.envPassthrough)}`)
    }
  }
  return args
}

/**
 * Render a file-mechanism config to the EXACT BYTES that would be written.
 *
 * ⚠ NOTHING IN PHASE 6 STAGE 1 CALLS THIS, AND STAGE 1 WRITES NO FILE ANYWHERE.
 * It exists so `assertNoSecretInRendered` has rendered bytes to run over, and
 * so Stage 4 inherits a renderer that was tested before it had a caller.
 *
 * ⚠ JSON ONLY, AND THE ABSENCE OF THE OTHER TWO BRANCHES IS A SECURITY
 * PROPERTY RATHER THAN AN UNFINISHED SWITCH. `format: 'toml'` names exactly one
 * file in this app's world — `~/.codex/config.toml`, the file D49 forbids
 * writing — so there is deliberately no code path that can produce TOML. That
 * is also why Phase 6 adds NO TOML WRITER DEPENDENCY: its absence from
 * `package.json` is machine-checkable evidence that the file is never written.
 * `yaml` has no adapter behind it at all.
 *
 * ⚠ THE PER-CLI SCHEMA IS NOT D4-ESTABLISHED AND STAGE 4 OWES THAT WORK. The
 * `{"mcpServers": {…}}` shape below is claude's `.mcp.json`; opencode's own
 * JSON config is known to differ, and 6-1 could not read either CLI's
 * substitution semantics back non-interactively. Recorded here rather than
 * guessed at: the descriptor as it stands cannot tell the two apart, and
 * whoever wires a real file must settle the schema against the CLI first.
 */
export function renderMcpConfig(
  descriptor: Extract<McpDescriptor, { mechanism: 'project-file' | 'env-named-file' }>,
  servers: readonly McpServerRef[]
): string {
  if (descriptor.format !== 'json') {
    throw new Error(
      `Chorus has no ${descriptor.format} renderer, deliberately: Phase 6 adds no TOML writer, ` +
        'because the only TOML file in play is ~/.codex/config.toml and D49 forbids writing it.'
    )
  }
  const mcpServers: Record<string, unknown> = {}
  for (const s of servers) {
    mcpServers[s.name] = {
      command: s.command,
      args: [...s.args],
      // Placeholders only — `assertNoSecretInRendered` is what enforces that.
      // Omitted entirely when absent, so a ref without env produces no key
      // rather than a `null` the CLI would have to interpret.
      ...(s.env ? { env: { ...s.env } } : {})
    }
  }
  // ⚠ `envPassthrough` is NOT rendered into a file. It is codex's argv-only
  // vocabulary; no file format in play has a pass-a-name-through concept, and
  // inventing one would be guessing at a schema nobody has measured. The names
  // are non-secret, so dropping them leaks nothing — it only means a file
  // adapter must express its needs through `env` placeholders instead.
  return `${JSON.stringify({ mcpServers }, null, 2)}\n`
}

/* ─── The guard ──────────────────────────────────────────────────────── */

/**
 * ⚠ THE GUARD. Returns a refusal reason, or `null` when the output is clean.
 *
 * ⚠ IT RUNS OVER THE RENDERED BYTES — not the `McpServerRef` objects that
 * produced them, not the caller's intent. A secret that survives an escaping
 * transform into the output is still in the output, so checking the inputs
 * would be checking the wrong thing. Precedent: `providerSecretRefusal`
 * (`ipc.ts`) tests the value it is handed, through `containsSecret`, which is
 * `scrubSecrets(value) !== value`.
 *
 * ⚠ BOTH HALVES RUN, NOT EITHER:
 *   · the SHAPE half, from `secret-patterns.json` — catches a credential the
 *     caller never told us about;
 *   · the EXACT-VALUE half, a substring test against `knownSecrets` — catches a
 *     credential that looks like prose, which no pattern list can recognise.
 * An EMPTY `knownSecrets` therefore does NOT make this vacuous: the shape half
 * still runs, and the suite asserts that in both directions.
 *
 * ⚠ THE MATCHED TEXT IS NEVER ECHOED — naming the field or the shape is what a
 * reader needs; quoting the value back would put the credential into a refusal
 * string, a log line and possibly a screenshot, reintroducing the exposure the
 * refusal exists to prevent (the `providerSecretRefusal` rule).
 *
 * ⚠ NOT ROUTED THROUGH `scrubber.ts`. That module is the per-session EXACT
 * value scrubber for PTY output and its docblock forbids applying
 * `secret-patterns.json` to it, for good reason — shape-matching a terminal
 * stream mangles legitimate agent output. The shape half belongs here.
 */
export function assertNoSecretInRendered(
  rendered: string,
  knownSecrets: readonly string[]
): string | null {
  // The exact-value half first: a hit here is certain rather than heuristic,
  // so it is the better thing to report when both would fire.
  //
  // ⚠ EMPTY ENTRIES ARE FILTERED, AND THAT IS LOAD-BEARING: `''` is a substring
  // of every string, so one empty secret would refuse every render — a guard
  // that always refuses gets switched off, which is how a guard dies.
  for (const secret of knownSecrets) {
    if (secret.length === 0) continue
    if (rendered.includes(secret)) {
      return (
        'The rendered MCP configuration contains a known credential VALUE. Refusing to emit it — ' +
        'a credential may travel as a variable NAME, never as a value (D49/D93).'
      )
    }
  }
  for (const pattern of secretPatterns.patterns) {
    // Compiled per call rather than once with /g: a `g` regex carries
    // `lastIndex` between calls, and a stateful matcher skips matches. Six
    // patterns over one rendered config — the cost is irrelevant. The
    // `scanBriefForSecrets` precedent.
    if (new RegExp(pattern.source).test(rendered)) {
      return (
        `The rendered MCP configuration matched a known credential shape ("${pattern.name}"). ` +
        'Refusing to emit it — a credential may travel as a variable NAME, never as a value (D49/D93).'
      )
    }
  }
  return null
}
