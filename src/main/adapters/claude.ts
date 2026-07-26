import { probeCli, resolveCli } from '../services/cliDetect'
import { buildSecretEnv } from './capabilities'
import { resolveEffortArgs } from './effort'
import type {
  AgentCapabilities,
  AuthMethodDefinition,
  EffortDescriptor,
  InstallationStatus,
  PtyAgentAdapter,
  PtyLaunchRequest,
  PtyLaunchSpec
} from './types'

/**
 * The `claude` (Claude Code) PTY adapter. Everything declared here was
 * verified THIS SESSION against claude 2.1.218's own `--help` (D4); anything
 * unverified or unimplemented is null/false, not a guess (spec §4.2).
 */
export const claudeAdapter: PtyAgentAdapter = {
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
    //  - mcp / hooks / sessionResume: NULL even though the CLI has all three
    //    (`mcp` subcommand, hooks support, `-r/--resume`) — the extension
    //    METHODS are unimplemented in Phase 3, and D34 Q1 makes "declared"
    //    and "implemented" one fact: a non-null descriptor without its
    //    method fails the capability-honesty test. Phase 4 (hooks/resume)
    //    and Phase 6 (MCP) declare these when they implement them.
    return {
      interactiveTerminal: true, // observed since Phase 0
      worktreeSafe: true, // proven across Phase 2
      skills: true, // verified via --help this session (above)
      subscriptionLogin: true, // both agents authenticate this way today
      apiKey: true, // the capability Phase 3 is building (3-4 renders, 3-6 acts)
      reasoningEffort: CLAUDE_EFFORT,
      sessionResume: null,
      mcp: null,
      hooks: null
    }
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
    return {
      executable: cli.file,
      args: [...cli.args, ...effortArgs],
      cwd: spec.cwd,
      envAdditions: {},
      secretEnv: buildSecretEnv(spec.credential)
    }
  }
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
