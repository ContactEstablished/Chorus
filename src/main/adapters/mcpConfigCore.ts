import secretPatterns from '../services/secret-patterns.json'
import type { McpDialect, McpFileDescriptor, McpServerRef } from './types'

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

/**
 * A TOML inline array of basic strings, in codex's own emitted form —
 * `["a","b"]`, no space after the comma, exactly as 6-1's probe accepted.
 *
 * ⚠ EXPORTED BY v17, ON THE SAME GROUNDS `tomlBasicString` WAS MOVED HERE:
 * `codex.ts`'s `status_line` override needs an inline array and its docblock
 * forbids a second quoter in that file. One renderer, two callers, rather than
 * a copy that can drift on spacing the CLI happens to accept today.
 */
export function tomlStringArray(values: readonly string[]): string {
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

/** opencode's own schema URL, emitted so the file it owns is self-describing in
 *  an editor. 6-1 Finding 1 read this back out of `opencode debug config`, so
 *  it is measured output rather than a nicety copied from a docs page. */
const OPENCODE_SCHEMA_URL = 'https://opencode.ai/config.json'

/**
 * ONE server entry in claude's `.mcp.json` dialect.
 *
 * Shape (6-1 Finding 1's left-hand column): a `command` STRING plus a separate
 * `args` ARRAY, and the env map is spelled `env`.
 */
function claudeServerEntry(s: McpServerRef): Record<string, unknown> {
  return {
    command: s.command,
    args: [...s.args],
    // Placeholders only — `assertNoSecretInRendered` is what enforces that.
    // Omitted entirely when absent, so a ref without env produces no key
    // rather than a `null` the CLI would have to interpret.
    ...(s.env ? { env: { ...s.env } } : {})
  }
}

/**
 * ONE server entry in opencode's dialect.
 *
 * ⚠ EVERY FIELD HERE DIFFERS FROM CLAUDE'S AND THE DIFFERENCES ARE MEASURED,
 * NOT STYLISTIC (6-1's D4 addendum, Finding 1 — read back through
 * `opencode debug config` on 1.18.15, cross-checked against the published
 * schema at https://opencode.ai/config.json and an independent re-fetch on
 * 2026-08-10 that matched both):
 *
 *   · `type: 'local'` is REQUIRED — the discriminant between a local process
 *     and a remote endpoint;
 *   · `command` is ONE ARRAY holding the executable AND its arguments, where
 *     claude splits them across `command` + `args`;
 *   · the env map is `environment`, not `env`;
 *   · `enabled: true` is stated rather than left to the default, because the
 *     resolved output carries it.
 *
 * ⚠ AND THE SCHEMA IS `additionalProperties: false`, SO A WRONG KEY IS NOT
 * TOLERATED THE WAY CLAUDE TOLERATES ONE — it is rejected, and a rejected
 * config looks exactly like a config nobody wrote. That is why this is a
 * separate function rather than claude's with two renames.
 *
 * ⚠ A WARNING FOR WHOEVER SHIPS CREDENTIALED MODE, LEFT AT THE PLACE THAT WOULD
 * EMIT THE PLACEHOLDER (6-1 Finding 3, measured): opencode resolves an UNSET
 * `{env:VAR}` to the EMPTY STRING — silently, no error, no warning. That is the
 * OPPOSITE of claude, which reports `missingVars` and leaves the token literal.
 * A password placeholder pointing at a variable that never arrives therefore
 * ships an EMPTY PASSWORD while looking configured. It cannot bite this phase —
 * D128(a) ships local mode only, so `environment` carries a bolt URL and
 * nothing else — but it will bite the first credentialed opencode mode, and it
 * must be measured per CLI rather than assumed from claude's behaviour.
 */
function opencodeServerEntry(s: McpServerRef): Record<string, unknown> {
  return {
    type: 'local',
    command: [s.command, ...s.args],
    enabled: true,
    ...(s.env ? { environment: { ...s.env } } : {})
  }
}

/**
 * The whole config object for a dialect, as a plain object ready for
 * `JSON.stringify`. Split from the byte rendering so the MERGE path can reach
 * the entries without re-parsing what it just wrote.
 */
function configObjectFor(
  dialect: McpDialect,
  servers: readonly McpServerRef[],
  agent: AgentConfigBlock | null = null
): Record<string, unknown> {
  const entries: Record<string, unknown> = {}
  for (const s of servers) {
    entries[s.name] = dialect === 'claude' ? claudeServerEntry(s) : opencodeServerEntry(s)
  }
  if (dialect === 'claude') return { mcpServers: entries }
  return {
    $schema: OPENCODE_SCHEMA_URL,
    mcp: entries,
    // D179. ⚠ THE KEY IS OMITTED ENTIRELY WHEN NOBODY CHOSE AN EFFORT, rather
    // than written empty: an `agent` block naming a model would make Chorus's
    // file an authority on which model opencode starts with, which is argv's
    // job (`-m`) and D48's rule about second homes.
    ...(agent === null ? {} : { agent: { [CHORUS_OPENCODE_AGENT]: { ...agent } } })
  }
}

/**
 * D179: the block Chorus writes into opencode's own config to carry a reasoning
 * effort, and the ONE agent name it writes under.
 *
 * ⚠ `build` IS opencode's OWN DEFAULT PRIMARY AGENT, not a name Chorus
 * invented, and that is deliberate. Chorus passes no `--agent`, so `build` is
 * what a launch actually runs as; writing under any other name would produce a
 * block opencode never reads. A Chorus-invented agent would also carry a
 * Chorus-invented prompt and tool set, which is a far larger claim than
 * "reason harder".
 *
 * ⚠ AND CHORUS OWNS THIS KEY IN THIS FILE. The merge REMOVES it when a launch
 * carries no effort, instead of preserving what was there — see `mergeMcpConfig`
 * for why leaving it would make the last effort you ever picked permanent.
 */
export const CHORUS_OPENCODE_AGENT = 'build'

/**
 * ⚠ BOTH FIELDS, ALWAYS. opencode applies `variant` only when the model the
 * launch selects is the one this block names — a variant alone is dropped, and
 * so is one whose model differs (D179(b), measured). A type that allowed the
 * model to be absent would be a type that allowed a silent no-op.
 */
export interface AgentConfigBlock {
  readonly model: string
  readonly variant: string
}

/** The top-level key each dialect keeps its servers under. Named once: the
 *  renderer and the merge must never disagree about it. */
function serversKeyFor(dialect: McpDialect): string {
  return dialect === 'claude' ? 'mcpServers' : 'mcp'
}

/**
 * Render a file-mechanism config to the EXACT BYTES that would be written.
 *
 * ⚠ TASK 6-5 SPLIT THIS PER DIALECT, AND THE SPLIT IS THE TASK. As 6-2 shipped
 * it, this function emitted claude's `{"mcpServers": …}` shape for BOTH file
 * mechanisms and its own docblock said so — *"opencode's own JSON config is
 * known to differ … whoever wires a real file must settle the schema against
 * the CLI first."* 6-1's D4 addendum settled it (Finding 1); the two dialects
 * now have two renderers, chosen by `descriptor.dialect` and by nothing else.
 *
 * ⚠ JSON ONLY, AND THE ABSENCE OF THE OTHER TWO BRANCHES IS A SECURITY
 * PROPERTY RATHER THAN AN UNFINISHED SWITCH. `format: 'toml'` names exactly one
 * file in this app's world — `~/.codex/config.toml`, the file D49 forbids
 * writing — so there is deliberately no code path that can produce TOML. That
 * is also why Phase 6 adds NO TOML WRITER DEPENDENCY: its absence from
 * `package.json` is machine-checkable evidence that the file is never written.
 * `yaml` has no adapter behind it at all.
 *
 * ⚠ `envPassthrough` IS NOT RENDERED INTO A FILE, in either dialect. It is
 * codex's argv-only vocabulary; no file format in play has a pass-a-name-through
 * concept, and inventing one would be guessing at a schema nobody has measured.
 * The names are non-secret, so dropping them leaks nothing — it only means a
 * file adapter must express its needs through `env` placeholders instead.
 */
export function renderMcpConfig(
  descriptor: McpFileDescriptor,
  servers: readonly McpServerRef[],
  /** D179: opencode's effort block, or null. Ignored by the claude dialect,
   *  which has no such concept and must not grow one by accident. */
  agent: AgentConfigBlock | null = null
): string {
  if (descriptor.format !== 'json') {
    throw new Error(
      `Chorus has no ${descriptor.format} renderer, deliberately: Phase 6 adds no TOML writer, ` +
        'because the only TOML file in play is ~/.codex/config.toml and D49 forbids writing it.'
    )
  }
  return `${JSON.stringify(configObjectFor(descriptor.dialect, servers, agent), null, 2)}\n`
}

/**
 * ⚠ MERGE, DO NOT CLOBBER — AND REFUSE RATHER THAN GUESS (spec §2).
 *
 * `.mcp.json` is a PROJECT file the user may own servers in. Chorus replaces
 * ONLY the keys it is writing and hands every other key back untouched,
 * including top-level keys it has never heard of.
 *
 * ⚠ AND AN EXISTING FILE THAT DOES NOT PARSE IS A REFUSAL, NOT A FRESH START.
 * Silently overwriting a user's broken-but-precious config is worse than
 * declining: the broken bytes are the only copy of whatever they were editing.
 * The refusal names the file so the sentence is actionable.
 *
 * ⚠ THE REFUSAL NEVER QUOTES THE FILE'S CONTENT — the same rule the guard's
 * refusals follow. A parse error's offending text could be anything, including
 * a credential a user put in their own server entry.
 *
 * `existing === null` means "no file there", which is the ordinary first run
 * and merges with nothing.
 */
export function mergeMcpConfig(
  descriptor: McpFileDescriptor,
  servers: readonly McpServerRef[],
  existing: string | null,
  /** For the refusal sentence only — never read, never written. */
  targetPath: string,
  /**
   * D179: this launch's opencode effort block, or null for "this launch chose
   * none".
   *
   * ⚠ NULL IS AN INSTRUCTION, NOT AN ABSENCE OF ONE. Chorus owns
   * `agent.build` in the file it owns, so null REMOVES a block a previous
   * launch wrote. Preserving it the way every other key here is preserved
   * would make the last effort anyone ever picked permanent — a launch dialog
   * with the control blank would silently keep sending `xhigh`, and the file
   * would be the only place that said so.
   */
  agent: AgentConfigBlock | null = null
): { readonly ok: true; readonly rendered: string } | { readonly ok: false; readonly reason: string } {
  if (descriptor.format !== 'json') {
    return {
      ok: false,
      reason: `Chorus has no ${descriptor.format} renderer, deliberately — see mcpConfigCore.`
    }
  }
  const fresh = configObjectFor(descriptor.dialect, servers, agent)
  // Nothing on disk, or a file with nothing in it: the fresh render IS the
  // answer. An empty file is treated as absent rather than as broken JSON —
  // it holds no user work to protect, and a zero-byte config is what an
  // interrupted write by some OTHER tool leaves behind.
  if (existing === null || existing.trim() === '') {
    return { ok: true, rendered: `${JSON.stringify(fresh, null, 2)}\n` }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(existing)
  } catch {
    return {
      ok: false,
      reason:
        `${targetPath} exists but is not valid JSON, so Chorus cannot add its memory server ` +
        'without discarding what is already in it. Fix or move that file and try again.'
    }
  }
  // `null` parses fine and is not an object; an array is an object to
  // `typeof` and would silently become `{"0": …}` on spread.
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      reason:
        `${targetPath} exists but does not hold a JSON object, so Chorus cannot add its memory ` +
        'server without discarding what is already in it. Fix or move that file and try again.'
    }
  }

  const key = serversKeyFor(descriptor.dialect)
  const root = parsed as Record<string, unknown>
  const existingServers = root[key]
  // A servers key of the wrong TYPE is the same class of problem as a broken
  // file: spreading a string or an array under it would produce a config that
  // parses and means something no one intended.
  if (
    existingServers !== undefined &&
    (existingServers === null || typeof existingServers !== 'object' || Array.isArray(existingServers))
  ) {
    return {
      ok: false,
      reason:
        `${targetPath} has a "${key}" entry that is not a set of servers, so Chorus cannot merge ` +
        'into it. Fix or move that file and try again.'
    }
  }

  const merged: Record<string, unknown> = {
    ...root,
    ...fresh,
    [key]: {
      ...((existingServers as Record<string, unknown> | undefined) ?? {}),
      // Chorus's own entries LAST, so they replace a same-named entry and
      // nothing else. Every other server the user wrote survives byte-for-byte
      // through the round trip.
      ...(fresh[key] as Record<string, unknown>)
    }
  }

  // D179: the `agent` key, which follows the SAME merge rule as the servers
  // above with ONE difference — Chorus's own entry is removed when this launch
  // has none, because this key is Chorus's to own here (see the parameter's
  // docblock). Every OTHER agent in the block, and every other key on Chorus's
  // own agent that some later feature writes, survives untouched.
  if (descriptor.dialect === 'opencode') {
    const existingAgents = root.agent
    if (
      existingAgents !== undefined &&
      (existingAgents === null || typeof existingAgents !== 'object' || Array.isArray(existingAgents))
    ) {
      return {
        ok: false,
        reason:
          `${targetPath} has an "agent" entry that is not a set of agents, so Chorus cannot merge ` +
          'into it. Fix or move that file and try again.'
      }
    }
    const agents: Record<string, unknown> = { ...((existingAgents as Record<string, unknown>) ?? {}) }
    if (agent === null) delete agents[CHORUS_OPENCODE_AGENT]
    else agents[CHORUS_OPENCODE_AGENT] = { ...agent }
    // ⚠ AN EMPTY `agent: {}` IS OMITTED RATHER THAN WRITTEN. It parses and
    // means nothing, but it is a key Chorus put there, and a file that gains a
    // key every time a feature declines to use it is a file nobody can read.
    if (Object.keys(agents).length === 0) delete merged.agent
    else merged.agent = agents
  }

  return { ok: true, rendered: `${JSON.stringify(merged, null, 2)}\n` }
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

/**
 * ⚠ THE GUARD, MADE STRUCTURALLY UNBYPASSABLE (Task 6-5 / spec §4).
 *
 * The order `render → assertNoSecretInRendered → refuse OR write` is the whole
 * design, and *"a convention that the guard is called first is exactly what
 * fails in the fourth adapter someone adds."* So the write helper does not take
 * a string: it takes a `GuardedRender`, and the ONLY way to obtain one is to
 * call this function and have it come back `ok`.
 *
 * ⚠ THE BRAND IS WHAT MAKES THAT TRUE, AND IT ERASES AT RUNTIME. `guardedBrand`
 * is a `declare`d unique symbol that is NOT exported, so no code outside this
 * module can write an object literal that satisfies the type — not with a cast
 * it would have to author deliberately, and never by accident. There is no
 * runtime cost: the field does not exist in the emitted object.
 */
declare const guardedBrand: unique symbol

export interface GuardedRender {
  readonly [guardedBrand]: true
  /** The exact bytes the guard passed. What gets written, unchanged — any
   *  transform after this point would be bytes the guard never saw. */
  readonly bytes: string
}

export type GuardResult =
  | { readonly ok: true; readonly guarded: GuardedRender }
  | { readonly ok: false; readonly reason: string }

/** Run the guard over rendered bytes and, on success, mint the token the write
 *  helper requires. `assertNoSecretInRendered` stays exported and unchanged —
 *  this is a wrapper around it, not a second copy of it. */
export function guardRendered(rendered: string, knownSecrets: readonly string[]): GuardResult {
  const refusal = assertNoSecretInRendered(rendered, knownSecrets)
  if (refusal !== null) return { ok: false, reason: refusal }
  return { ok: true, guarded: { bytes: rendered } as GuardedRender }
}
