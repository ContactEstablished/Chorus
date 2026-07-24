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
 * The `codex` (Codex CLI) PTY adapter. Everything declared here was verified
 * THIS SESSION against codex-cli 0.145.0's own `--help` / `login --help` /
 * official config reference (D4); anything unverified or unimplemented is
 * null/false (spec §4.2).
 */
export const codexAdapter: PtyAgentAdapter = {
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
    //  - reasoningEffort: NULL — Phase 3a's job (codex has -m/--model and
    //    -c config overrides, but no verified effort descriptor this task).
    //  - mcp / hooks / sessionResume: NULL even though the CLI has all three
    //    (`mcp` subcommand, a hook-trust flag, a `resume` subcommand) — the
    //    extension METHODS are unimplemented in Phase 3 (see claude.ts).
    return {
      interactiveTerminal: true, // observed since Phase 0
      worktreeSafe: true, // proven across Phase 2
      skills: true, // 0.145.0 config reference: skills.config, skill_approval
      subscriptionLogin: true, // ChatGPT account login today
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
    // For codex that yields { file: 'cmd.exe', args: ['/c', <shim>] } — the
    // cmd.exe indirection is the shim mechanics, preserved EXACTLY.
    const cli = resolveCli(this.id)
    const args = [...cli.args]

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
        '-c', `model_provider=${tomlString(key)}`,
        '-c', `model_providers.${key}.name=${tomlString(spec.route.providerName)}`,
        '-c', `model_providers.${key}.base_url=${tomlString(baseUrl)}`,
        '-c', `model_providers.${key}.env_key=${tomlString(spec.credential.envVarName)}`,
        '-c', `model_providers.${key}.wire_api=${tomlString('responses')}`
      )
      // D48: the route's DEFAULT model. Emitted only when the provider
      // carries one — a NULL model must never reach argv as "null".
      if (spec.route.modelId) args.push('-m', spec.route.modelId)
    }

    return {
      executable: cli.file,
      args,
      cwd: spec.cwd,
      envAdditions: {},
      secretEnv: buildSecretEnv(spec.credential)
    }
  }
}

/** Quote a value as a TOML basic string for a `-c key=<value>` override, so
 *  names with spaces (provider names are user-authored) parse as one string
 *  rather than falling back to -c's raw-literal rescue path. */
function tomlString(v: string): string {
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}
