import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { probeCli, resolveCli } from '../services/cliDetect'
import { buildSecretEnv } from './capabilities'
import { resolveEffortArgs } from './effort'
import { renderMcpLaunchArgs, tomlBasicString, tomlStringArray } from './mcpConfigCore'
import type {
  AgentCapabilities,
  AuthMethodDefinition,
  DiscoveredResumeSupport,
  DiscoverSessionContext,
  EffortDescriptor,
  InstallationStatus,
  McpDescriptor,
  McpServerRef,
  McpWriteResult,
  PtyAgentAdapter,
  PtyLaunchRequest,
  PtyLaunchSpec,
  ResumeExitObservation,
  ResumeFailureReason,
  SupportsMcp
} from './types'

/**
 * The `codex` (Codex CLI) PTY adapter. Everything declared here was verified
 * THIS SESSION against codex-cli 0.145.0's own `--help` / `login --help` /
 * official config reference (D4); anything unverified or unimplemented is
 * null/false (spec §4.2).
 */
export const codexAdapter: PtyAgentAdapter & SupportsMcp & DiscoveredResumeSupport = {
  id: 'codex',
  displayName: 'Codex',
  executionMode: 'pty',

  // Nothing beyond the Windows baseline (main owns it) — today this adapter
  // needs no env var preserved into an allow-list launch.
  requiredEnvVars: [],

  async detectInstallation(): Promise<InstallationStatus> {
    // The same where.exe -> pickSpawnable -> --version probe cliDetect has
    // always run (10 s timeout, windowsHide, first line, 'unknown' on
    // failure) — shared, not reimplemented; codex resolves to its npm .cmd
    // shim via the same pickSpawnable logic SessionManager used directly.
    return probeCli(this.id)
  },

  getAuthMethods(): readonly AuthMethodDefinition[] {
    return [
      {
        type: 'subscription',
        label: 'ChatGPT account (codex login)',
        requiredEnvVar: null,
        helpUrl: 'https://github.com/openai/codex'
      },
      {
        type: 'api_key',
        label: 'OpenAI API key',
        // D4-verified against `codex login --help` (0.145.0, this session):
        // "--with-api-key  Read the API key from stdin (e.g. `printenv
        // OPENAI_API_KEY | codex login --with-api-key`)".
        requiredEnvVar: 'OPENAI_API_KEY',
        helpUrl: 'https://github.com/openai/codex'
      }
    ]
  },

  getCapabilities(): AgentCapabilities {
    // Honesty rules (spec §4.2) — declare only what this session verified:
    //  - skills: TRUE — 0.145.0's official config reference documents
    //    `skills.config` per-skill enablement, `skill_approval` under
    //    approval_policy.granular, and `features.skill_mcp_dependency_install`
    //    (stable, on by default). Corrected from the 0.144.6-era `false`.
    //  - reasoningEffort: POPULATED by Task 3a-4 — see CODEX_EFFORT below for
    //    the D4 evidence, which this session obtained by making the binary
    //    ACCEPT and REJECT the key rather than by reading strings out of it.
    //  - hooks: NULL even though the CLI has a hook-trust flag — the extension
    //    METHOD is unimplemented (see claude.ts).
    //  - sessionResume: NOW POPULATED by Task 4a-2 (D139/D140), and it no
    //    longer shares a sentence with `hooks`: the two were null for the same
    //    reason and are not any more. `discoverSessionId` and
    //    `classifyResumeFailure` below are the methods that earn it.
    //
    //    `kind: 'discovered'` is D140's other half, and it is a MEASURED
    //    asymmetry rather than a style choice: `codex --help` on 0.147.0 has no
    //    `--session-id` equivalent, so there is no way to tell codex what to
    //    call a conversation. It names its own and Chorus must ask afterwards
    //    what it chose, by reading rollout `session_meta` headers.
    //
    //    ⚠ `cliFlag: null` IS MEANINGFUL HERE RATHER THAN A PLACEHOLDER. It
    //    says "resumption is not flag-driven for this CLI", which is exactly
    //    true — codex resumes by SUBCOMMAND (`codex resume <id>`), so there is
    //    no flag to name. `kind` carries the rest.
    //  - mcp: POPULATED by Task 6-2 — see CODEX_MCP below.
    return {
      interactiveTerminal: true, // observed since Phase 0
      worktreeSafe: true, // proven across Phase 2
      skills: true, // 0.145.0 config reference: skills.config, skill_approval
      subscriptionLogin: true, // ChatGPT account login today
      apiKey: true, // the capability Phase 3 is building (3-4 renders, 3-6 acts)
      reasoningEffort: CODEX_EFFORT,
      sessionResume: { mode: 'static', kind: 'discovered', cliFlag: null },
      mcp: CODEX_MCP,
      hooks: null
    }
  },

  /**
   * Task 6-2: codex's MCP mechanism is ARGV, so "supporting MCP" here costs no
   * filesystem access at all. Delegates to the pure core — the guard
   * (`assertNoSecretInRendered`) and this renderer must never have two homes.
   */
  mcpLaunchArgs(servers: readonly McpServerRef[]): readonly string[] {
    return renderMcpLaunchArgs(servers)
  },

  /**
   * ⚠ THE STRUCTURED REFUSAL, AND IT IS NOT A NO-OP AND NOT A THROW. A caller
   * that reaches this has made a category error and deserves a reason.
   *
   * ⚠ AND IT IS THE D49 BRIGHT LINE EXPRESSED AS CODE. The only file codex is
   * configured by is `~/.codex/config.toml`, which Chorus must never write —
   * so the honest implementation of "write a config file" for this adapter is
   * to decline, permanently, rather than to grow one later.
   */
  async writeMcpConfig(): Promise<McpWriteResult> {
    return { ok: false, reason: 'codex is configured by launch arguments, not by a file.' }
  },

  buildLaunch(spec: PtyLaunchSpec): PtyLaunchRequest {
    // Behavior-neutral (Task 3-3): resolveCli is the same synchronous
    // where.exe resolution SessionManager used directly before this refactor.
    // For codex that yields { file: 'cmd.exe', args: ['/c', <shim>] } — the
    // cmd.exe indirection is the shim mechanics, preserved EXACTLY.
    const cli = resolveCli(this.id)
    // v17: FIRST, so it is a genuine prefix of every codex command line. `-c`
    // overrides distinct keys and is order-independent, so position is free
    // here — and putting it at the front is what lets every "base + extras"
    // assertion in adapters.test.ts stay an exact-equality pin instead of
    // having to reason about a tail. See `CODEX_BASELINE_ARGS`.
    const args = [...cli.args, ...CODEX_BASELINE_ARGS]

    // D47 (Task 3-6): the OpenRouter route. A credential whose provider
    // carries a base_url points codex at that OpenAI-compatible endpoint via
    // PER-LAUNCH `-c` dotted-path overrides — ~/.codex/config.toml is never
    // written, and nothing here is secret: the key itself reaches the child
    // ONLY through secretEnv -> composeChildEnv -> the environment block.
    // `-c` is argv; a base URL, an env-var NAME, and a wire-api string are
    // legal there; a key never is (Non-Goal #1).
    //
    // D4-verified against the INSTALLED 0.145.0 this session:
    //  - `wire_api = "chat"` is REJECTED ("no longer supported") — the only
    //    supported value is `responses` (the default; emitted explicitly).
    //  - `model_providers.<id>.name` is REQUIRED ("provider name must not be
    //    empty") — the user-authored provider name supplies it.
    //  - `env_key` = the NAME of the env var codex reads at runtime for the
    //    bearer token — exactly what composeChildEnv injects (D33 clause 5).
    if (spec.credential && spec.route) {
      const key = spec.route.providerKey
      const baseUrl = spec.route.baseUrl.replace(/\/+$/, '') // a trailing slash is a known failure mode
      args.push(
        '-c', `model_provider=${tomlBasicString(key)}`,
        '-c', `model_providers.${key}.name=${tomlBasicString(spec.route.providerName)}`,
        '-c', `model_providers.${key}.base_url=${tomlBasicString(baseUrl)}`,
        '-c', `model_providers.${key}.env_key=${tomlBasicString(spec.credential.envVarName)}`,
        '-c', `model_providers.${key}.wire_api=${tomlBasicString('responses')}`
      )
      // D48: the route's DEFAULT model. Emitted only when the provider
      // carries one — a NULL model must never reach argv as "null".
      if (spec.route.modelId) args.push('-m', spec.route.modelId)
    }

    // Task 3a-4: the effort override, AFTER the route's `-c` overrides and the
    // `-m` model, through the SAME `-c` mechanism one line up. NO `switch` on
    // the level here — the descriptor is the mapping and this only reads it.
    // With no level chosen (the default) this contributes nothing and the
    // command line stays byte-identical to the pre-3a-4 one.
    args.push(...resolveEffortArgs(CODEX_EFFORT, spec.effortOptionId, spec.extraArgs ?? []))

    // Task 4a-2 / D139: resume is a SUBCOMMAND, so the modifier changes argv
    // SHAPE rather than merely its contents — and it is appended LAST, after
    // every option the normal path emits. With no modifier this contributes
    // nothing and the command line is byte-identical to HEAD.
    //
    // ⚠ THE POSITION IS MEASURED, NOT ASSUMED (spec §3's open question).
    // Against the installed 0.147.0, in a real TTY (_verify/4a-2/):
    //   - `codex -c … resume <id>` DOES dispatch to the resume subcommand —
    //     proven by the subcommand's own error, "No saved session found with ID
    //     …", not by an exit code;
    //   - the `-c` overrides SURVIVE in this position — `-c model=` drew
    //     codex's own "This session was recorded with model X but is resuming
    //     with Y" warning, and a full baseline + `-m` + effort argv resumed
    //     showing `gpt-5.6-codex high`, i.e. BOTH overrides applied.
    // The subcommand-first ordering (`codex resume -c … <id>`) also works. This
    // one is chosen because it keeps CODEX_BASELINE_ARGS a genuine argv PREFIX,
    // which is what lets adapters.test.ts's assertions stay exact-equality pins
    // instead of reasoning about a tail (see CODEX_BASELINE_ARGS).
    //
    // ⚠ `-c` HERE IS `--config`, NOT `--continue`. On kimi and opencode the
    // same two characters mean `--continue` and would silently resume a stale
    // session (kimi.ts, opencode.ts). Nothing in this function may be copied
    // there without re-reading those warnings.
    args.push(...codexResumeArgs(spec))

    return {
      executable: cli.file,
      args,
      cwd: spec.cwd,
      envAdditions: {},
      secretEnv: buildSecretEnv(spec.credential)
    }
  },

  /**
   * Ask codex what it called the conversation it just started, by reading
   * rollout `session_meta` headers.
   *
   * ⚠ NOTHING CALLS THIS IN TASK 4a-2. Its invocation, bounding and persistence
   * are 4a-3's — this ships a tested function with no caller, the same
   * deliberate shape Task 4a-1 shipped its database column in.
   *
   * ⚠ ROLLOUT HEADERS ONLY, NEVER `session_index.jsonl`. F57 measured that the
   * index carries `{id, thread_name, updated_at}` and NO `cwd`, so it cannot
   * answer "the session I just launched in THIS directory" — which is the only
   * question worth asking. Header shape verified against a real 0.147.0 session
   * this task created: first line `{type:'session_meta', payload:{session_id,
   * cwd, timestamp, …}}`.
   *
   * ⚠ AND A WRONG ANSWER IS WORSE THAN NO ANSWER. A mistaken pointer resumes
   * SOMEONE ELSE'S CONVERSATION INTO THIS PANE; an empty one costs a manual
   * relaunch (D140). So ambiguity returns null rather than "the newest", the
   * cwd compare is exact, and `launchedAt` is a hard lower bound.
   */
  async discoverSessionId(context: DiscoverSessionContext): Promise<string | null> {
    const root = path.join(os.homedir(), '.codex', 'sessions')
    let candidates: readonly string[]
    try {
      candidates = listRolloutFiles(root, context.signal)
    } catch {
      // A missing or unreadable sessions tree is "not found", not an error:
      // every null-ish outcome is the same answer to the caller.
      return null
    }
    let found: string | null = null
    for (const file of candidates) {
      if (context.signal.aborted) return null
      const meta = readSessionMeta(file)
      if (!meta) continue
      // Exact equality. Not a prefix, not case-insensitive, not a realpath
      // guess — a sibling worktree is a DIFFERENT conversation.
      if (meta.cwd !== context.cwd) continue
      // An older rollout from this same worktree is not this launch's result.
      if (!(meta.startedAt >= context.launchedAt)) continue
      // Two candidates is null, not "the newest": preferring the newest is
      // exactly how a pane adopts the wrong conversation.
      if (found !== null && found !== meta.sessionId) return null
      found = meta.sessionId
    }
    // Re-checked after the scan: an aborted result must never be persisted.
    return context.signal.aborted ? null : found
  },

  /**
   * Map a MEASURED codex resume failure to a generic reason. Same discipline as
   * claude's: pure, no I/O, no logging, and `null` for everything unrecognised
   * — including every clean exit, which is what stops 4a-3 turning an ordinary
   * session end into a pointer-clearing relaunch.
   */
  classifyResumeFailure(observation: ResumeExitObservation): ResumeFailureReason | null {
    // ⚠ SAME EXIT-CODE GATE AS CLAUDE'S, FOR THE SAME REASON: `output` is agent
    // conversation, and a clean exit is never a failed resume however the text
    // reads. Measured — codex 0.147.0 `resume <unknown uuid>` exits 1 in a TTY
    // (_verify/4a-2/); `exitCode === null` is a signal kill Chorus caused.
    if (observation.exitCode === 0 || observation.exitCode === null) return null
    // Measured 2026-08-13 in a real TTY, codex-cli 0.147.0 (_verify/4a-2/):
    //   `codex resume <unknown uuid>` -> "ERROR: No saved session found with ID
    //   <uuid>. Run `codex resume` without an ID to choose from existing
    //   sessions."
    if (/No saved session found with ID/i.test(observation.output)) return 'not-found'
    return null
  }
}

/**
 * The `resume` subcommand and its positional id, or nothing.
 *
 * ⚠ AN EMPTY POINTER EMITS NO SUBCOMMAND AT ALL, for the same reason claude's
 * guard exists: `codex resume` with no positional SHOWS A PICKER
 * (`codex resume --help`: "picker by default"), which would strand a pane
 * waiting for a human who is not looking at it.
 *
 * ⚠ NO `--last`, EVER. It resumes the most recent session for the directory,
 * which is emphatically not "this pane's conversation" when several panes share
 * a cwd. Resume is by explicit id or not at all.
 */
function codexResumeArgs(spec: PtyLaunchSpec): readonly string[] {
  const resume = spec.resume
  if (!resume) return []
  if (resume.agentSessionId.length === 0) return []
  // codex is a DISCOVERED adapter; an 'assigned' modifier is unreachable and
  // degrades to a normal fresh launch rather than throwing.
  if (resume.strategy !== 'discovered') return []
  return ['resume', resume.agentSessionId]
}

/** Rollout files, newest day first. Bounded by the caller's signal. */
function listRolloutFiles(root: string, signal: AbortSignal): readonly string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    if (signal.aborted) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (signal.aborted) return
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl'))
        out.push(full)
    }
  }
  walk(root)
  return out
}

/**
 * The FIRST LINE only. A rollout's `session_meta` record is its header, and
 * reading further would mean parsing conversation content to answer a question
 * about identity.
 */
function readSessionMeta(
  file: string
): { readonly sessionId: string; readonly cwd: string; readonly startedAt: number } | null {
  let firstLine: string
  try {
    // Rollout headers carry the full base instructions, so this is not a small
    // line — but it is one line, and only the first.
    const buf = fs.readFileSync(file, 'utf8')
    const nl = buf.indexOf('\n')
    firstLine = nl === -1 ? buf : buf.slice(0, nl)
  } catch {
    return null
  }
  try {
    const rec = JSON.parse(firstLine) as {
      type?: unknown
      payload?: { session_id?: unknown; cwd?: unknown; timestamp?: unknown }
    }
    if (rec.type !== 'session_meta') return null
    const p = rec.payload
    if (!p || typeof p.session_id !== 'string' || typeof p.cwd !== 'string') return null
    const startedAt = typeof p.timestamp === 'string' ? Date.parse(p.timestamp) : NaN
    if (Number.isNaN(startedAt)) return null
    return { sessionId: p.session_id, cwd: p.cwd, startedAt }
  } catch {
    return null
  }
}

/**
 * Task 6-2: codex's MCP descriptor.
 *
 * ⚠ `mode` IS `DescriptorMode` ('static' = "known ahead of time rather than
 * probed", the same value CODEX_EFFORT carries), NOT A SUPPORT FLAG. Support is
 * expressed by the descriptor being non-null AND both `SupportsMcp` methods
 * existing — that is what `supportsMcp()` checks, and inventing a
 * `mode: 'supported'` would be adding a third value to a closed union.
 *
 * ⚠ `mechanism: 'launch-args'` MEANS THERE IS NO `configPath` FIELD TO FILL IN.
 * Before 6-2 the only descriptor shape that fit codex was
 * `{format:'toml', location:'home', configPath:'.codex/config.toml'}` — the
 * type's own vocabulary naming the file D49 forbids writing. It cannot be
 * named here now, which is the type doing the work a comment was doing badly.
 *
 * Evidence (6-1, live-probed against the INSTALLED codex 0.147.0, not inherited
 * from the design plan): `codex mcp list --json -c 'mcp_servers.chorus_probe.…'`
 * returned the probe server in parsed JSON with `env_vars` intact, and
 * `~/.codex/config.toml` was byte-identical afterwards — same size, same mtime,
 * same sha256. Per-invocation `-c mcp_servers.*` MERGES into the existing
 * config rather than replacing it: Chorus's argv ADDS a server, it does not
 * define the set.
 */
const CODEX_MCP: McpDescriptor = {
  mode: 'static',
  mechanism: 'launch-args'
}

/**
 * The status-line items a Chorus-launched codex session shows (v17).
 *
 * ⚠ THIS EXISTS BECAUSE CODEX DOES NOT REPORT CONTEXT BY DEFAULT, which was
 * MEASURED rather than assumed: on codex-cli 0.147.0 a fresh session printed no
 * context anywhere, `/status` showed model / directory / account / weekly limits
 * and no context line at all, and `/statusline` revealed why — `context-remaining`
 * and `context-used` are OPT-IN items, unchecked out of the box. Without this
 * override the progress ring simply never appears for codex, and the failure is
 * silent (an absent ring is indistinguishable from an agent with no source).
 *
 * ⚠ THE FIRST TWO ARE CODEX'S OWN DEFAULTS AND ARE RESTATED ON PURPOSE. `-c`
 * SETS a value, it does not append, so emitting only `context-remaining` would
 * REPLACE the status line rather than extend it — the user would gain a context
 * reading and lose the model and directory they have always had. Listing the
 * defaults first reproduces the stock appearance exactly and adds one item to
 * the end. (Verified against the `/statusline` picker on 0.147.0: `[x]
 * model-with-reasoning`, `[x] current-dir`, everything else unchecked.)
 *
 * ⚠ AND IT OVERRIDES A CUSTOMISED STATUS LINE, WHICH IS THE HONEST COST. A user
 * who has curated their own items in `~/.codex/config.toml` sees THIS list
 * inside Chorus instead. Merging their list would mean READING that file and
 * parsing TOML to compose the override — buying a better default by taking a
 * dependency on the one file D49 exists to keep Chorus away from. The trade was
 * made deliberately (Matthew, this session, asking for the flag); it is
 * per-launch, so their own `codex` outside Chorus is untouched.
 *
 * ⚠ `context-remaining`, NOT `context-used`, AND THE PARSER DEPENDS ON IT.
 * `contextUsageCore.parseCodexContextLeft` matches `N% context left` — the
 * phrasing `context-remaining` renders. Switching this id without switching that
 * regex would leave the ring permanently blank, with nothing in the logs.
 *
 * ⚠ THE KEY IS `tui.status_line`, NOT `status_line`, AND THE BARE FORM FAILS
 * SILENTLY — which is the whole reason this warning exists. A first attempt
 * emitted `-c status_line=[…]`; the token reached argv intact (confirmed on the
 * live child's command line), codex accepted it without a word, and the status
 * line was simply unchanged. There is no error, no warning and no log: an
 * unknown `-c` path is ignored, so the only symptom is a ring that never
 * appears. Verified by reading the CLI's own config struct out of the shipped
 * 0.147.0 binary, where `status_line` sits in the same field group as
 * `alternate_screen` / `status_line_use_colors` / `terminal_title` and beside
 * the already-dotted `tui.keymap.*` paths.
 */
const CODEX_STATUS_LINE: readonly string[] = [
  'model-with-reasoning',
  'current-dir',
  'context-remaining'
]

/**
 * The tokens EVERY codex launch carries, whatever the spec.
 *
 * ⚠ THIS IS THE ONE DELIBERATE EXCEPTION TO THE NEUTRALITY RULE (spec §4.1:
 * "buildLaunch reproduces resolveCli EXACTLY"), and it is exported so the rule
 * can keep being tested rather than being loosened to accommodate it.
 * `adapters.test.ts` asserts `resolveCli(id).args` PLUS this, so a seventh token
 * appearing here still fails the pin — which is what the rule is for. Every
 * other adapter's baseline stays empty and its assertion is unchanged.
 */
export const CODEX_BASELINE_ARGS: readonly string[] = [
  '-c',
  `tui.status_line=${tomlStringArray(CODEX_STATUS_LINE)}`
]

/**
 * The codex effort mapping. ONE HOME, built through the SAME `tomlBasicString`
 * quoter `buildLaunch` already uses for its route overrides — there is no
 * second quoter in this file and there must not be — Task 6-2 MOVED it to
 * `mcpConfigCore.ts` so `mcpLaunchArgs` could share the one quoter rather than
 * grow a copy, and pinned its escaping behaviour with tests that did not exist
 * when the rule was first written.
 *
 * ⚠ D4 — this is the fact the task doc called the weakest in the authoring set,
 * and it was re-established this session (2026-07-25) by MAKING THE INSTALLED
 * BINARY ACCEPT AND REJECT IT, not by reading strings out of the executable:
 *
 *   `codex --help`                                  -> NO `--effort` flag exists on
 *                                                      0.145.0; only -c/--config and
 *                                                      -m/--model. The knob must be
 *                                                      a config key.
 *   `codex --strict-config -c chorus_not_a_real_key="x"`
 *        -> "Error loading config.toml: unknown configuration field
 *            `chorus_not_a_real_key` in -c/--config override"
 *   `codex --strict-config -c model_reasoning_effort="high"`
 *        -> passes config load (fails later, only because the harness has no
 *           tty). It SURVIVES the exact check that kills the invented key.
 *   `codex --strict-config -c model_reasoning_effort=123`
 *        -> "Error loading config.toml: invalid type: integer `123`, expected
 *            a string in `model_reasoning_effort`"
 *
 * The last one is the strongest single piece of evidence: codex NAMES the
 * field and states its type. A non-existent field cannot produce that.
 *
 * ⚠ AND THE MEASURED LIMIT OF THAT EVIDENCE. The field is typed String, not a
 * closed enum — `-c model_reasoning_effort="banana"` also loads cleanly, while
 * the control `-c sandbox_mode="banana"` is rejected with "unknown variant …
 * expected one of read-only, workspace-write, danger-full-access". So codex
 * does police enum config fields, and deliberately does not police this one.
 * Consequences: no launch can FAIL AT CONFIG LOAD because of the effort value,
 * and what codex does at REQUEST time with a level the selected model does not
 * support (`codex debug models` shows the ladder is per-model) is NOT
 * established — observing it costs a real completion. `mode: 'static'` and the
 * `'dynamic'` seam stay exactly where they were.
 */
const CODEX_EFFORT: EffortDescriptor = {
  mode: 'static',
  levels: [
    { id: 'fast', label: 'Fast', args: ['-c', `model_reasoning_effort=${tomlBasicString('low')}`] },
    { id: 'balanced', label: 'Balanced', args: ['-c', `model_reasoning_effort=${tomlBasicString('medium')}`] },
    { id: 'deep', label: 'Deep', args: ['-c', `model_reasoning_effort=${tomlBasicString('high')}`] },
    { id: 'max', label: 'Max', args: ['-c', `model_reasoning_effort=${tomlBasicString('max')}`] }
  ]
}
