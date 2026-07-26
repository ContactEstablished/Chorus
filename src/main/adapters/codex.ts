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
    //  - reasoningEffort: POPULATED by Task 3a-4 — see CODEX_EFFORT below for
    //    the D4 evidence, which this session obtained by making the binary
    //    ACCEPT and REJECT the key rather than by reading strings out of it.
    //  - mcp / hooks / sessionResume: NULL even though the CLI has all three
    //    (`mcp` subcommand, a hook-trust flag, a `resume` subcommand) — the
    //    extension METHODS are unimplemented in Phase 3 (see claude.ts).
    return {
      interactiveTerminal: true, // observed since Phase 0
      worktreeSafe: true, // proven across Phase 2
      skills: true, // 0.145.0 config reference: skills.config, skill_approval
      subscriptionLogin: true, // ChatGPT account login today
      apiKey: true, // the capability Phase 3 is building (3-4 renders, 3-6 acts)
      reasoningEffort: CODEX_EFFORT,
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

    // Task 3a-4: the effort override, AFTER the route's `-c` overrides and the
    // `-m` model, through the SAME `-c` mechanism one line up. NO `switch` on
    // the level here — the descriptor is the mapping and this only reads it.
    // With no level chosen (the default) this contributes nothing and the
    // command line stays byte-identical to the pre-3a-4 one.
    args.push(...resolveEffortArgs(CODEX_EFFORT, spec.effortOptionId, spec.extraArgs ?? []))

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

/**
 * The codex effort mapping. ONE HOME, built through the SAME `tomlString`
 * quoter `buildLaunch` already uses for its route overrides — there is no
 * second quoter in this file and there must not be.
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
    { id: 'fast', label: 'Fast', args: ['-c', `model_reasoning_effort=${tomlString('low')}`] },
    { id: 'balanced', label: 'Balanced', args: ['-c', `model_reasoning_effort=${tomlString('medium')}`] },
    { id: 'deep', label: 'Deep', args: ['-c', `model_reasoning_effort=${tomlString('high')}`] },
    { id: 'max', label: 'Max', args: ['-c', `model_reasoning_effort=${tomlString('max')}`] }
  ]
}
