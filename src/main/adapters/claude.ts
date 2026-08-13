import fs from 'node:fs'
import path from 'node:path'
import { probeCli, resolveCli } from '../services/cliDetect'
import { classifiedHookEventNames } from '../services/agentEventsCore'
import { logger } from '../services/logger'
import { buildSecretEnv } from './capabilities'
import { resolveEffortArgs } from './effort'
import { writeMcpConfigFile } from './mcpConfigWrite'
import type {
  AgentCapabilities,
  AgentSessionLaunch,
  AssignedResumeSupport,
  AuthMethodDefinition,
  EffortDescriptor,
  InstallationStatus,
  McpFileDescriptor,
  McpWriteContext,
  McpWriteResult,
  PtyAgentAdapter,
  PtyLaunchHooks,
  PtyLaunchRequest,
  PtyLaunchSpec,
  ResumeExitObservation,
  ResumeFailureReason,
  SupportsHooks,
  SupportsMcp
} from './types'

/**
 * The `claude` (Claude Code) PTY adapter. Everything declared here was
 * verified THIS SESSION against claude 2.1.218's own `--help` (D4); anything
 * unverified or unimplemented is null/false, not a guess (spec §4.2).
 */
export const claudeAdapter: PtyAgentAdapter & SupportsHooks & SupportsMcp & AssignedResumeSupport = {
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
    //    admits. `xhigh` is deliberately NOT reachable from the four-level
    //    slider: stretching four normalized positions across five vendor
    //    values would make "Deep" mean a different distance here than on
    //    codex. The raw extra_args override is what reaches it (PLAN §4).
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
      sessionResume: { mode: 'static', kind: 'assigned', cliFlag: '--resume' },
      mcp: CLAUDE_MCP,
      hooks: { mode: 'static', mechanism: 'http_listener' }
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

  buildLaunch(spec: PtyLaunchSpec): PtyLaunchRequest {
    // Behavior-neutral (Task 3-3): resolveCli is the same synchronous
    // where.exe resolution SessionManager used directly before this refactor.
    // The .exe-vs-.cmd shim decision stays inside cliDetect where it has been
    // proven; the adapter's job here is to OWN the knowledge, not change it.
    const cli = resolveCli(this.id)
    // Task 3a-4: NO `switch` on the level here, deliberately — the descriptor
    // above IS the mapping and this only reads it. With no level chosen (and
    // that is the default) `resolveEffortArgs` returns [] and these args stay
    // byte-identical to the pre-3a-4 launch.
    const effortArgs = resolveEffortArgs(CLAUDE_EFFORT, spec.effortOptionId, spec.extraArgs ?? [])
    // Absent whenever main has no listener bound, so a hook-less launch is
    // byte-identical to the pre-hooks one.
    const hookArgs = spec.hooks ? this.writeHooksConfig(spec.hooks) : []
    // Task 4a-2 / D139: APPENDED, and everything above is untouched, so a
    // launch with no modifier is provably byte-identical to HEAD.
    const resumeArgs = claudeResumeArgs(spec.resume)
    return {
      executable: cli.file,
      args: [...cli.args, ...effortArgs, ...hookArgs, ...resumeArgs],
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
 * D4, re-run 2026-07-25 against claude 2.1.218:
 *   `claude --help` -> `--effort <level>  Effort level for the current session
 *                       (low, medium, high, xhigh, max)`
 *
 * `mode: 'static'` because these five values are frozen on the CLI, not probed.
 * The `'dynamic'` variant is the declared seam for a later phase to refine
 * per model; populating it here would be model-capability probing, an
 * explicit non-goal.
 */
const CLAUDE_EFFORT: EffortDescriptor = {
  mode: 'static',
  levels: [
    { id: 'fast', label: 'Fast', args: ['--effort', 'low'] },
    { id: 'balanced', label: 'Balanced', args: ['--effort', 'medium'] },
    { id: 'deep', label: 'Deep', args: ['--effort', 'high'] },
    { id: 'max', label: 'Max', args: ['--effort', 'max'] }
  ]
}
