import fs from 'node:fs'
import path from 'node:path'
import { probeCli, resolveCli } from '../services/cliDetect'
import { classifiedHookEventNames } from '../services/agentEventsCore'
import { logger } from '../services/logger'
import { buildSecretEnv } from './capabilities'
import { resolveEffortArgs } from './effort'
import type {
  AgentCapabilities,
  AuthMethodDefinition,
  EffortDescriptor,
  InstallationStatus,
  PtyAgentAdapter,
  PtyLaunchHooks,
  PtyLaunchRequest,
  PtyLaunchSpec,
  SupportsHooks
} from './types'

/**
 * The `claude` (Claude Code) PTY adapter. Everything declared here was
 * verified THIS SESSION against claude 2.1.218's own `--help` (D4); anything
 * unverified or unimplemented is null/false, not a guess (spec §4.2).
 */
export const claudeAdapter: PtyAgentAdapter & SupportsHooks = {
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
    //  - mcp / sessionResume: NULL even though the CLI has both (`mcp`
    //    subcommand, `-r/--resume`) — the extension METHODS are unimplemented,
    //    and D34 Q1 makes "declared" and "implemented" one fact: a non-null
    //    descriptor without its method fails the capability-honesty test.
    //    Phase 6 (MCP) declares these when it implements them.
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
      sessionResume: null,
      mcp: null,
      hooks: { mode: 'static', mechanism: 'http_listener' }
    }
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
    return {
      executable: cli.file,
      args: [...cli.args, ...effortArgs, ...hookArgs],
      cwd: spec.cwd,
      envAdditions: {},
      secretEnv: buildSecretEnv(spec.credential)
    }
  }
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
