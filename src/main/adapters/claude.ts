import fs from 'node:fs'
import path from 'node:path'
import { probeCli, resolveCli } from '../services/cliDetect'
import { classifiedHookEventNames } from '../services/agentEventsCore'
import { logger } from '../services/logger'
import { buildSecretEnv } from './capabilities'
import { resolveLevelArgs } from './argLevels'
import { writeMcpConfigFile } from './mcpConfigWrite'
import type {
  AgentCapabilities,
  AgentSessionLaunch,
  AssignedResumeSupport,
  AuthMethodDefinition,
  EffortDescriptor,
  InstallationStatus,
  McpFileDescriptor,
  PermissionModeDescriptor,
  McpWriteContext,
  McpWriteResult,
  PtyAgentAdapter,
  PtyLaunchHooks,
  PtyLaunchInstructions,
  PtyLaunchRequest,
  PtyLaunchSpec,
  ResumeExitObservation,
  ResumeFailureReason,
  SupportsHooks,
  SupportsInstructions,
  SupportsMcp
} from './types'

/**
 * The `claude` (Claude Code) PTY adapter. Everything declared here was
 * verified THIS SESSION against claude 2.1.218's own `--help` (D4); anything
 * unverified or unimplemented is null/false, not a guess (spec §4.2).
 */
export const claudeAdapter: PtyAgentAdapter &
  SupportsHooks &
  SupportsInstructions &
  SupportsMcp &
  AssignedResumeSupport = {
  id: 'claude',
  displayName: 'Claude Code',
  executionMode: 'pty',

  // Nothing beyond the Windows baseline (main owns it) — today this adapter
  // needs no env var preserved into an allow-list launch.
  requiredEnvVars: [],

  async detectInstallation(): Promise<InstallationStatus> {
    // The same where.exe -> pickSpawnable -> --version probe cliDetect has
    // always run (10 s timeout, windowsHide, first line, 'unknown' on
    // failure) — the byte-identical cli:detect response is this task's
    // acceptance criterion, so the probe is SHARED, not reimplemented.
    return probeCli(this.id)
  },

  getAuthMethods(): readonly AuthMethodDefinition[] {
    return [
      {
        type: 'subscription',
        label: 'Claude subscription (claude.ai account login)',
        requiredEnvVar: null,
        helpUrl: 'https://code.claude.com/docs/en/overview'
      },
      {
        type: 'api_key',
        label: 'Anthropic API key',
        // D4-verified against `claude --help` (2.1.218, this session): the
        // --bare entry states Anthropic auth is "strictly ANTHROPIC_API_KEY
        // or apiKeyHelper via --settings".
        requiredEnvVar: 'ANTHROPIC_API_KEY',
        helpUrl: 'https://code.claude.com/docs/en/settings'
      }
    ]
  },

  getCapabilities(): AgentCapabilities {
    // Honesty rules (spec §4.2) — declare only what this session verified:
    //  - skills: `claude --help` documents them ("--disable-slash-commands:
    //    Disable all skills"; "--bare ... Skills still resolve via
    //    /skill-name").
    //  - reasoningEffort: POPULATED by Task 3a-4 — the seam the previous
    //    comment here deferred to Phase 3a. D4-verified against the INSTALLED
    //    claude 2.1.218 on 2026-07-25 by re-running `claude --help`, which
    //    prints verbatim:
    //        --effort <level>   Effort level for the current session
    //                           (low, medium, high, xhigh, max)
    //    Direct evidence from the tool's own help — the strongest kind D4
    //    admits. RE-VERIFIED 2026-08-14 against the installed claude 2.1.232:
    //    the five values are unchanged. ⚠ WHICH FOUR OF THE FIVE THE SLIDER
    //    REACHES CHANGED THAT DAY — see CLAUDE_EFFORT below; `low` is now the
    //    unreachable one and `xhigh` is reachable.
    //  - permissionMode: POPULATED 2026-08-14 — see CLAUDE_PERMISSION below.
    //  - mcp: POPULATED by Task 6-5 — see CLAUDE_MCP below, and the two
    //    `SupportsMcp` members that earn it.
    //  - sessionResume: NOW POPULATED by Task 4a-2 (D139/D140). It was null
    //    because the extension METHOD was unimplemented; the companion method
    //    is now `classifyResumeFailure`, so the descriptor is earned. D34 Q1's
    //    honesty rule is satisfied STRUCTURALLY rather than by a method name
    //    (CR-4a.0 Q5): `supportsResume()` checks that the descriptor's own kind
    //    matches the methods present, which is strictly stronger than the
    //    `['sessionResume','resumeSession']` pairing it replaced.
    //
    //    `kind: 'assigned'` is D140's measured half — CHORUS MINTS THE ID AND
    //    WRITES IT DOWN BEFORE A BYTE OF OUTPUT EXISTS, because claude accepts
    //    `--session-id <uuid>` at launch. codex cannot do this and is
    //    'discovered'. `mode: 'static'` is the same "known ahead of time rather
    //    than probed" value CLAUDE_EFFORT and CLAUDE_MCP carry and is NOT a
    //    support flag.
    //
    //    ⚠ `cliFlag` NAMES THE RESUME FLAG ONLY, AND ONE STRING CANNOT DESCRIBE
    //    BOTH HALVES. Creation uses `--session-id`; reopening uses `--resume`.
    //    They are mutually exclusive at the CLI (measured: `--session-id` on a
    //    live id gives "Session ID … is already in use."), so the descriptor
    //    names the flag a caller would recognise and `buildLaunch` owns the
    //    grammar.
    //  - hooks: NOW POPULATED, and it is the first non-null extension
    //    descriptor any adapter has carried. `writeHooksConfig` below is the
    //    implementation that earns it, so `supportsHooks(claudeAdapter)` is
    //    true and the honesty test passes on the OTHER side of its equality.
    return {
      interactiveTerminal: true, // observed since Phase 0
      worktreeSafe: true, // proven across Phase 2
      skills: true, // verified via --help this session (above)
      subscriptionLogin: true, // both agents authenticate this way today
      apiKey: true, // the capability Phase 3 is building (3-4 renders, 3-6 acts)
      reasoningEffort: CLAUDE_EFFORT,
      permissionMode: CLAUDE_PERMISSION,
      sessionResume: { mode: 'static', kind: 'assigned', cliFlag: '--resume' },
      mcp: CLAUDE_MCP,
      hooks: { mode: 'static', mechanism: 'http_listener' },
      // D148: `--append-system-prompt-file`, NOT `--settings` (which D147(e)
      // named and which has no system-prompt field at all). Re-probed against
      // the installed 2.1.232 on 2026-08-14:
      //   $ claude --append-system-prompt-file
      //   error: option '--append-system-prompt-file <file>' argument missing
      // The FILE variant is taken over `--append-system-prompt <text>` because
      // argv is world-readable (`Get-CimInstance Win32_Process`) and the
      // contract is seven lines long.
      instructions: { mode: 'static', mechanism: 'append-system-prompt-file' }
    }
  },

  /**
   * ⚠ `[]`, AND IT IS AN ANSWER RATHER THAN A STUB. claude learns about MCP
   * servers from a FILE; it has no per-launch argv vocabulary for them, so
   * there are no tokens to contribute. `SupportsMcp` requires both members
   * precisely so this has to be stated — an optional method would let
   * "declared" and "implemented" drift apart again (types.ts, D34 Q1).
   */
  mcpLaunchArgs(): readonly string[] {
    return []
  },

  /**
   * Write this project's `.mcp.json`.
   *
   * ⚠ THE FILE IS THE PROJECT'S, NOT CHORUS'S, AND THAT IS THE MECHANISM.
   * claude reads `.mcp.json` from the project root and treats it as shared
   * config — which is why the write MERGES rather than clobbers, and refuses
   * outright rather than discarding a file it cannot parse. Both rules live in
   * `mcpConfigCore.mergeMcpConfig`; this method only names the file.
   *
   * ⚠ AND WRITING IT DOES NOT CONNECT ANYTHING. Measured on 2.1.225 and stated
   * by `claude mcp --help` in its own words: an unapproved `.mcp.json` server
   * shows as `⏸ Pending approval` and is *"not connected to."* Approval is
   * interactive and Chorus is forbidden to write it (D49 and the CR-6.0
   * council's unanimous answer to Q6). A human approves it, in the pane.
   */
  async writeMcpConfig(ctx: McpWriteContext): Promise<McpWriteResult> {
    return writeMcpConfigFile(CLAUDE_MCP, path.join(ctx.projectRoot, CLAUDE_MCP.configPath), ctx)
  },

  /**
   * Write this session's hook config and return the argv that loads it.
   *
   * D4-verified against the INSTALLED claude 2.1.225 on 2026-08-07, by running
   * it rather than by recalling it:
   *   - `claude --help` prints `--settings <file-or-json>  Path to a settings
   *     JSON file or a JSON string to load additional settings from`.
   *   - The hook event vocabulary and the `{hooks:{<Event>:[{matcher,hooks:
   *     [{type,command}]}]}}` shape were read off a SHIPPING plugin's
   *     `hooks.json`, not reconstructed.
   *   - A real `claude -p` run with this exact file emitted, in order:
   *     SessionStart, UserPromptSubmit, PreToolUse(Read), PostToolUse(Read),
   *     Stop, SessionEnd — each POSTing its JSON body to the listener.
   *
   * ⚠ `--settings` IS A FILE, NOT THE JSON STRING THE FLAG ALSO ACCEPTS. The
   * inline form would put the capability token in ARGV, where every process on
   * the machine can read it — see the warning on `PtyLaunchHooks.endpointUrl`.
   *
   * ⚠ AND IT IS DELIBERATELY NOT `.claude/settings.json`. The roadmap's Phase 4
   * line says "hook injection into `.claude/settings.json`", and that would
   * mean Chorus WRITING INTO THE USER'S REPOSITORY — a tracked file, in a
   * worktree an agent is about to commit from. `--settings` is additive and
   * per-launch, so it gets the same result with nothing to clean up in git and
   * no chance of a hook config surviving into a commit.
   */
  writeHooksConfig(hooks: PtyLaunchHooks): readonly string[] {
    const curl = resolveCurl()
    // No curl means no hooks — and a session with no lights is strictly better
    // than a session whose every hook invocation fails. Never fatal: an agent
    // must still launch.
    if (!curl) {
      logger.warn('[hooks] curl.exe not found; claude session launches without activity hooks')
      return []
    }
    // `--data-binary @-` forwards the hook payload the CLI writes to stdin,
    // verbatim, as the request body. `-s` keeps curl's progress meter off the
    // agent's terminal, and `-m 2` bounds the agent's wait: Claude Code BLOCKS
    // on a hook command, so an unreachable listener must cost two seconds, not
    // a hung session.
    //
    // ⚠ `-o NUL` IS LOAD-BEARING, NOT TIDINESS. A hook command's STDOUT is a
    // control channel — Claude Code parses JSON printed there as a hook
    // decision object (that is how a PreToolUse hook denies a tool). Without
    // this, curl would write the listener's HTTP RESPONSE BODY to stdout and
    // hand the agent a decision it never made, on every single tool call. The
    // response is deliberately `{}`, but the fix is to never let it reach
    // stdout at all rather than to rely on an empty object staying inert.
    const command =
      `"${curl}" -s -o NUL -m 2 -X POST -H "Content-Type: application/json" ` +
      `--data-binary @- "${hooks.endpointUrl}"`
    const entry = [{ matcher: '', hooks: [{ type: 'command', command }] }]
    const config: Record<string, unknown> = {}
    for (const event of classifiedHookEventNames()) config[event] = entry

    try {
      fs.mkdirSync(path.dirname(hooks.configPath), { recursive: true })
      fs.writeFileSync(hooks.configPath, JSON.stringify({ hooks: config }, null, 2), 'utf8')
    } catch (err) {
      // Same reasoning as the missing-curl branch: degrade to no lights.
      // ⚠ `err` is logged, `hooks.endpointUrl` is NOT — it carries the token.
      logger.error({ err }, '[hooks] could not write claude hook settings; launching without them')
      return []
    }
    return ['--settings', hooks.configPath]
  },

  /**
   * D148 (Task 6a-1): the memory usage contract, delivered as a Chorus-owned
   * file that claude appends to its system prompt.
   *
   * ⚠ IT IS THE SAME SHAPE AS `writeHooksConfig` ABOVE, DELIBERATELY — main
   * reserves the path, the adapter writes the bytes, and main deletes the file
   * on every session exit path. Placed here so a reader meets the two
   * together.
   *
   * ⚠ AND IT DEGRADES EXACTLY AS THE MISSING-CURL BRANCH DOES. Losing the
   * memory contract costs a hint; refusing to start costs the session.
   */
  instructionsArgs(instructions: PtyLaunchInstructions | null): readonly string[] {
    if (!instructions) return []
    try {
      fs.mkdirSync(path.dirname(instructions.filePath), { recursive: true })
      fs.writeFileSync(instructions.filePath, instructions.text, 'utf8')
    } catch (err) {
      logger.error(
        { err },
        '[memory] could not write claude instruction file; launching without it'
      )
      return []
    }
    return ['--append-system-prompt-file', instructions.filePath]
  },

  buildLaunch(spec: PtyLaunchSpec): PtyLaunchRequest {
    // Behavior-neutral (Task 3-3): resolveCli is the same synchronous
    // where.exe resolution SessionManager used directly before this refactor.
    // The .exe-vs-.cmd shim decision stays inside cliDetect where it has been
    // proven; the adapter's job here is to OWN the knowledge, not change it.
    const cli = resolveCli(this.id)
    // Task 3a-4: NO `switch` on the level here, deliberately — the descriptor
    // below IS the mapping and this only reads it.
    //
    // ⚠ 2026-08-14: WITH NO LEVEL CHOSEN THESE ARE NO LONGER EMPTY, and that is
    // the point of the change rather than a side effect of it. Both descriptors
    // now declare a `defaultLevelId`, so every claude launch through every path
    // — the dialog, restore, `session:restart`, profile relaunch — carries
    // `--effort xhigh --permission-mode auto` unless something overrode it. A
    // raw `--effort`/`--permission-mode` in extra_args still suppresses ours
    // entirely (rank 1), including the default.
    const effortArgs = resolveLevelArgs(CLAUDE_EFFORT, spec.effortOptionId, spec.extraArgs ?? [])
    const permissionArgs = resolveLevelArgs(
      CLAUDE_PERMISSION,
      spec.permissionModeId,
      spec.extraArgs ?? []
    )
    // Absent whenever main has no listener bound, so a hook-less launch is
    // byte-identical to the pre-hooks one.
    const hookArgs = spec.hooks ? this.writeHooksConfig(spec.hooks) : []
    // Task 4a-2 / D139: APPENDED, and everything above is untouched, so a
    // launch with no modifier is provably byte-identical to HEAD.
    const resumeArgs = claudeResumeArgs(spec.resume)
    // D148: APPENDED AFTER `hookArgs` AND BEFORE `resumeArgs`, and the position
    // is not arbitrary. `resumeArgs` must stay last (claudeResumeArgs's own
    // note: resume changes argv SHAPE, not merely its contents), and appending
    // after `hookArgs` leaves the pre-6a prefix untouched — which is what keeps
    // every existing exact-equality pin passing unchanged. Absent whenever the
    // project has no memory configured, so that launch stays byte-identical.
    const instructionArgs = this.instructionsArgs(spec.instructions ?? null)
    return {
      executable: cli.file,
      args: [
        ...cli.args,
        ...effortArgs,
        ...permissionArgs,
        ...hookArgs,
        ...instructionArgs,
        ...resumeArgs
      ],
      cwd: spec.cwd,
      envAdditions: {},
      secretEnv: buildSecretEnv(spec.credential)
    }
  },

  /**
   * Map a MEASURED claude resume failure to a generic reason. Adapter-local,
   * pure, no I/O, no logging — `observation.output` is read and goes nowhere
   * else (see `ResumeExitObservation.output`, D143(a)).
   *
   * ⚠ `null` IS THE IMPORTANT RETURN AND THE ONE THIS MATCHES HARDEST FOR.
   * Once 4a-3 wires this, EVERY ordinary end of EVERY ordinary claude session
   * reaches this function. A classifier that is generous with reasons turns
   * normal exits into pointer-clearing relaunches with a "context was not
   * restored" badge — a user-visible failure WORSE THAN NEVER HAVING SHIPPED
   * RESUME AT ALL. So: narrow matches, on strings measured against the
   * installed CLI, and anything unrecognised is a clean exit.
   */
  classifyResumeFailure(observation: ResumeExitObservation): ResumeFailureReason | null {
    // ⚠ A CLEAN EXIT IS NEVER A FAILED RESUME, WHATEVER THE TEXT SAYS — AND THE
    // TEXT CAN LIE HERE IN A WAY IT CANNOT ELSEWHERE. `observation.output` is
    // agent conversation, and Chorus is a tool whose users read and write about
    // Chorus: an agent that quotes "No conversation found with session ID" while
    // discussing this very file would otherwise be classified as a failed
    // resume, clearing a healthy pointer and relaunching the pane. Gating on the
    // exit code makes the string evidence rather than the whole case.
    // MEASURED, not assumed: a failed resume exits 1 on both CLIs — claude
    // 2.1.229 `--resume <unknown uuid>` -> 1, codex 0.147.0 `resume <unknown
    // uuid>` in a TTY -> 1 (_verify/4a-2/). A signal kill (`exitCode === null`)
    // is a Chorus-side stop, never a vendor resume failure.
    if (observation.exitCode === 0 || observation.exitCode === null) return null
    // Measured 2026-08-13, claude 2.1.229 (_verify/4a-2/):
    //   `claude --resume <unknown uuid>` -> "No conversation found with session ID: <uuid>"
    if (/No conversation found with session ID/i.test(observation.output)) return 'not-found'
    //   `claude --session-id <live uuid>` -> "Error: Session ID <uuid> is already in use."
    if (/Session ID .* is already in use/i.test(observation.output)) return 'in-use'
    // ⚠ `transcript-unavailable` IS DELIBERATELY NOT RETURNED, AND THAT IS A
    // MEASUREMENT RATHER THAN AN OMISSION. The spec's table lists a
    // missing/unreadable transcript as its own reason, so it was measured: a
    // corrupt `<uuid>.jsonl` planted in `~/.claude/projects/<munged-cwd>/` and
    // resumed produced the SAME string as a wholly unknown id —
    // "No conversation found with session ID: <uuid>" (2.1.229, _verify/4a-2/).
    // claude does not distinguish the two, so neither can this function without
    // inventing a string D4 forbids. The reason stays in the union because the
    // contract is generic and another adapter may distinguish it; matching it
    // here would mean guessing.
    return null
  }
}

/**
 * The resume argv for one launch. Separated from `buildLaunch` only so the
 * empty-pointer guard is impossible to miss.
 *
 * ⚠ THE VALUE IS OPTIONAL TO THE CLI, SO AN EMPTY POINTER DOES NOT FAIL — IT
 * OPENS AN INTERACTIVE PICKER IN A PANE NOBODY IS WATCHING. `claude --help`
 * verbatim on 2.1.229: "-r, --resume [value]  Resume a conversation by session
 * ID, or open interactive picker with optional search term." The square
 * brackets are the whole problem: a session that appears hung, forever, with no
 * log line anywhere. No value, no flag. (D143(e).)
 */
function claudeResumeArgs(resume: AgentSessionLaunch | undefined): readonly string[] {
  // No modifier is the overwhelmingly common case and MUST contribute nothing.
  if (!resume) return []
  // ⚠ THE GUARD, AND IT IS UNCONDITIONAL. It lives here rather than in a caller
  // because a caller that has nothing to pass is exactly the caller that will
  // pass nothing.
  if (resume.agentSessionId.length === 0) return []
  // claude is an ASSIGNED adapter. A 'discovered' modifier is unreachable, and
  // it degrades to a normal launch rather than throwing — an unreachable case
  // that crashes a launch is worse than one that starts a fresh conversation.
  if (resume.strategy !== 'assigned') return []
  // ⚠ NEVER BOTH. `--session-id` refuses an id that already exists and
  // `--resume` requires one that does; emitting both is a guaranteed failure.
  // Verified INTERACTIVELY on 2.1.229 (D143(d), _verify/4a-2/): the transcript
  // lands under the Chorus-minted id and `--resume` genuinely restores it.
  return resume.action === 'create'
    ? ['--session-id', resume.agentSessionId]
    : ['--resume', resume.agentSessionId]
}

/**
 * `curl.exe` ships in System32 on Windows 10 1803+ (verified on this machine:
 * curl 8.21.0). Resolved through `SystemRoot` rather than hardcoded, and
 * EXISTENCE-CHECKED rather than assumed — the caller degrades to no hooks when
 * it is missing.
 *
 * ⚠ The absolute path is the point. A bare `curl` would resolve through the
 * agent's own PATH, where on this machine Git-Bash's `/mingw64/bin/curl` comes
 * first — a different binary with different flag handling, chosen by whatever
 * PATH the session happened to inherit. Windows-only v1 (CLAUDE.md), so there
 * is no POSIX branch to write yet.
 */
function resolveCurl(): string | null {
  const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows'
  const candidate = path.join(root, 'System32', 'curl.exe')
  return fs.existsSync(candidate) ? candidate : null
}

/**
 * Task 6-5: claude's MCP descriptor.
 *
 * ⚠ `project-file` + `.mcp.json` IS THE MECHANISM claude DOCUMENTS, and the
 * consequence is that Chorus writes into the USER'S REPOSITORY. That is
 * deliberate and it is the only place this file can live — `claude mcp list`
 * calls the scope *"Project config (shared via .mcp.json)"*. It is also why
 * `.mcp.json` is not gitignored by this task: whether a project tracks it is
 * the project's decision, not Chorus's.
 *
 * ⚠ `dialect: 'claude'` IS NAMED, NOT INFERRED. `format: 'json'` says the file
 * is JSON and says nothing about the shape; 6-1 Finding 1 measured how far
 * apart the two shapes are. See `McpDialect`.
 *
 * ⚠ AND `mode: 'static'` IS "KNOWN AHEAD OF TIME", NOT A SUPPORT FLAG — the
 * same value `CLAUDE_EFFORT` carries. Support is the descriptor being non-null
 * AND both `SupportsMcp` methods existing, which is what `supportsMcp()` checks.
 */
const CLAUDE_MCP: McpFileDescriptor = {
  mode: 'static',
  mechanism: 'project-file',
  format: 'json',
  location: 'project',
  configPath: '.mcp.json',
  dialect: 'claude'
}

/**
 * The claude effort mapping. ONE HOME — `buildLaunch` reads it and nothing
 * duplicates it.
 *
 * D4, re-run 2026-08-14 against the installed claude 2.1.232:
 *   `claude --help` -> `--effort <level>  Effort level for the current session
 *                       (low, medium, high, xhigh, max)`
 *
 * ⚠ THE LADDER MOVED UP ONE RUNG ON 2026-08-14 (Matthew's call). It was
 * low/medium/high/max with `xhigh` deliberately unreachable — the argument then
 * being that reaching for a fifth vendor value would make "Deep" mean a
 * different distance here than on codex. That argument lost to a measured fact
 * about the only user this app has: he never picks the bottom rung, so a
 * quarter of the control was dead. Five vendor values, four positions, and the
 * unreachable one is now `low` instead of `xhigh`:
 *
 *      Fast     -> medium        Deep -> xhigh
 *      Balanced -> high          Max  -> max
 *
 * The cross-adapter symmetry that was traded away is real and is recorded here
 * rather than in a commit message: claude's "Deep" is now one notch hotter than
 * codex's. `low` remains reachable through `extra_args` (rank 1), which is the
 * same escape hatch `xhigh` used to have — nothing was removed, the default
 * shifted.
 *
 * `mode: 'static'` because these five values are frozen on the CLI, not probed.
 * The `'dynamic'` variant is the declared seam for a later phase to refine
 * per model; populating it here would be model-capability probing, an
 * explicit non-goal.
 */
const CLAUDE_EFFORT: EffortDescriptor = {
  mode: 'static',
  levels: [
    { id: 'fast', label: 'Fast', args: ['--effort', 'medium'] },
    { id: 'balanced', label: 'Balanced', args: ['--effort', 'high'] },
    { id: 'deep', label: 'Deep', args: ['--effort', 'xhigh'] },
    { id: 'max', label: 'Max', args: ['--effort', 'max'] }
  ],
  // Where an unchosen claude launch starts. Not 'max': `max` is the CLI's own
  // ceiling and defaulting there would make the top of the control unusable as
  // a deliberate escalation.
  defaultLevelId: 'deep'
}

/**
 * The claude permission mapping. PLAN principle 009 in one object: Chorus picks
 * the word, the CLI enforces it.
 *
 * D4-verified 2026-08-14 against the installed claude 2.1.232, by running it
 * rather than recalling it. `claude --help` prints verbatim:
 *
 *   --permission-mode <mode>   Permission mode to use for the session
 *                              (choices: "acceptEdits", "auto",
 *                               "bypassPermissions", "manual", "dontAsk", "plan")
 *
 * and `claude --help`'s command list separately documents an `auto-mode`
 * subcommand — *"Inspect or reset auto mode classifier configuration"* — which
 * is the corroborating evidence that `auto` is the same mode the TUI calls
 * "auto mode on" under shift+tab, not an alias for something else.
 *
 * ⚠ FOUR OF THE SIX, AND THE TWO OMISSIONS ARE THE DECISION.
 *   - `bypassPermissions` is omitted on purpose; see `permissionModeSchema` in
 *     `shared/ipc.ts` for the argument. It stays reachable via `extra_args`.
 *   - `dontAsk` is omitted because nothing in this session MEASURED how it
 *     differs from `acceptEdits`, and spec §4.2 forbids shipping a control
 *     position whose meaning Chorus is guessing at. Adding it is a one-line
 *     change once someone has run it.
 *
 * ⚠ ORDER IS THE RENDERED ORDER. The launch dialog renders `levels` in
 * declaration order and hardcodes no label, so this array is the control's
 * layout: the default first, the escalating alternatives after it, and the
 * ask-me-everything rung last.
 */
const CLAUDE_PERMISSION: PermissionModeDescriptor = {
  mode: 'static',
  levels: [
    { id: 'auto', label: 'Auto', args: ['--permission-mode', 'auto'] },
    { id: 'accept-edits', label: 'Accept edits', args: ['--permission-mode', 'acceptEdits'] },
    { id: 'plan', label: 'Plan', args: ['--permission-mode', 'plan'] },
    { id: 'manual', label: 'Manual', args: ['--permission-mode', 'manual'] }
  ],
  // ⚠ THE ONE LINE THIS WHOLE CAPABILITY EXISTS FOR (Matthew, 2026-08-14):
  // "when I start an agent and select Claude I want it in auto mode on". Every
  // claude launch that does not say otherwise says this.
  defaultLevelId: 'auto'
}
