import { probeCli, resolveCli } from '../services/cliDetect'
import { buildSecretEnv } from './capabilities'
import type {
  AgentCapabilities,
  AuthMethodDefinition,
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
    //  - reasoningEffort: NULL even though --help shows `--effort
    //    (low|medium|high|xhigh|max)` — effort normalization is Phase 3a's
    //    job, and guessing its descriptor here would put unverified shape on
    //    a seam 3a builds on.
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
      reasoningEffort: null,
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
    return {
      executable: cli.file,
      args: cli.args,
      cwd: spec.cwd,
      envAdditions: {},
      secretEnv: buildSecretEnv(spec.credential)
    }
  }
}
