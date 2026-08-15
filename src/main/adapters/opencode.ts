import path from 'node:path'
import { probeCli, resolveCli } from '../services/cliDetect'
import { buildSecretEnv } from './capabilities'
import { writeMcpConfigFile } from './mcpConfigWrite'
import type {
  AgentCapabilities,
  AuthMethodDefinition,
  InstallationStatus,
  McpFileDescriptor,
  McpWriteContext,
  McpWriteResult,
  PtyAgentAdapter,
  PtyLaunchRequest,
  PtyLaunchSpec,
  SupportsMcp
} from './types'

/**
 * The `opencode` PTY adapter (D90) — the fourth entry in the registry, and the
 * harness Matthew chose to carry the launch dialog's OpenRouter card.
 *
 * ⚠ EVERYTHING BELOW WAS D4-VERIFIED 2026-07-28 AGAINST THE INSTALLED
 * `opencode 1.18.8` (npm `opencode-ai`, resolved as
 * `%APPDATA%\npm\opencode.cmd`), BY RUNNING THE BINARY — not by reading the
 * project's docs, which are materially vaguer than the CLI itself and which
 * recommend WSL on Windows. Chorus is a native ConPTY app and this adapter is
 * verified against the NATIVE Windows build.
 *
 * ⚠ THE TRAP, AND IT IS THE SAME ONE KIMI SETS: **`-c` IS `--continue` HERE,
 * NOT `--config`.** `opencode -h` (1.18.8), verbatim: `-c, --continue
 * continue the last session`. Copying codex's `buildLaunch` — where `-c
 * key=value` carries the whole OpenRouter route (D47) — would silently resume
 * a stale conversation instead of configuring anything. It is never emitted.
 *
 * ⚠ THE FACT THAT MAKES THIS ADAPTER POSSIBLE AT ALL: **THE KEY REACHES
 * OPENCODE THROUGH THE ENVIRONMENT.** With `OPENROUTER_API_KEY` set,
 * `opencode providers list` grows a section reading, verbatim:
 *
 *     T  Environment
 *     |
 *     •  OpenRouter OPENROUTER_API_KEY
 *     |
 *     —  1 environment variable
 *
 * and `opencode models openrouter` returns 339 ids. With the variable REMOVED
 * the same command fails `Error: Provider not found: openrouter`. So the route
 * is gated on the env var and nothing needs to be written to
 * `~\.local\share\opencode\auth.json`. That is what lets Chorus adopt opencode
 * without breaching CLAUDE.md's standing rule — keys are injected as env vars
 * into child PTYs, never written to disk, never placed in argv.
 *
 * ⚠ AND THE CONSEQUENCE FOR THE UI: an OpenRouter launch through opencode
 * REQUIRES a credential. There is no subscription or ambient path to it —
 * without the variable the provider does not exist. A credential-less launch of
 * this adapter is legal and simply gets opencode's own free `opencode/*` models.
 */
export const opencodeAdapter: PtyAgentAdapter & SupportsMcp = {
  id: 'opencode',
  displayName: 'opencode',
  executionMode: 'pty',

  /**
   * ⚠ EMPTY, AND MEASURED RATHER THAN ASSUMED. `BASELINE_ENV_VARS` is what a
   * credential-bearing launch gets, and the honest way to size this list is to
   * run the binary under exactly that environment. Done, 2026-07-28: opencode
   * was spawned through `cmd.exe` with a CLEARED environment block containing
   * only PATH, SystemRoot, TEMP, TMP, HOMEDRIVE, HOMEPATH, USERPROFILE, the two
   * `PINNED_ENV_VARS` and `OPENROUTER_API_KEY`. It exited 0 and listed all 339
   * OpenRouter models. Nothing beyond the baseline is needed, so nothing is
   * claimed — env.ts's standing instruction is that additions here are admitted
   * only by empirical necessity, with the breakage recorded.
   */
  requiredEnvVars: [],

  async detectInstallation(): Promise<InstallationStatus> {
    // The SHARED probe. `where.exe opencode` returns a bash shim (extensionless)
    // AND `opencode.cmd`; `pickSpawnable` finds no `.exe`, takes the `.cmd`, and
    // routes it through `cmd.exe /c` — the identical mechanics codex has used
    // since Phase 0. `opencode --version` prints a bare `1.18.8`, so the
    // first-line version parse needs no special case.
    return probeCli(this.id)
  },

  getAuthMethods(): readonly AuthMethodDefinition[] {
    return [
      {
        // `opencode providers login` exists (`opencode providers --help`:
        // "log in to a provider"), and its credentials land in
        // `~\.local\share\opencode\auth.json`. Chorus does not drive it and
        // does not read it — a launch simply inherits whatever the user logged
        // in with, which is what every other subscription method here means.
        type: 'subscription',
        label: 'opencode provider login (opencode providers login)',
        requiredEnvVar: null,
        helpUrl: 'https://opencode.ai/docs/providers/'
      },
      {
        type: 'api_key',
        label: 'API key (OpenRouter and other env-var providers)',
        // ⚠ A DEFAULT, NOT A LAW (D34(e)): a provider row's own `env_var_name`
        // overrides it, which is how an Anthropic-direct or OpenAI-direct
        // opencode route names its own variable. OpenRouter is the default
        // because it is the route this adapter was adopted to serve and the one
        // whose env-var gating was D4-verified above.
        requiredEnvVar: 'OPENROUTER_API_KEY',
        helpUrl: 'https://opencode.ai/docs/providers/'
      }
    ]
  },

  getCapabilities(): AgentCapabilities {
    // Honesty rules (spec §4.2 / D34 Q1): declare ONLY what was verified this
    // session, and null/false for everything else.
    return {
      interactiveTerminal: true, // the default `opencode` invocation is a TUI
      worktreeSafe: true, // it takes a cwd like any CLI (and a positional `project`)
      // ⚠ FALSE — and this is a DIFFERENT ANSWER from claude/codex/kimi, so it
      // is worth stating why. opencode 1.18.8 has `agent`, `plugin` and `mcp`
      // subcommands; it has NO skills concept in `--help` at all. Declaring
      // `true` by analogy with the other three would be exactly the
      // training-memory guess CLAUDE.md's CLI rule forbids.
      skills: false,
      subscriptionLogin: true, // `opencode providers login`
      // TRUE, and the ONE capability this adapter was adopted for. Proven by
      // the env-var gating documented in the file header — not inferred.
      apiKey: true,
      // ⚠ NULL, AND FOR A PRECISE REASON WORTH RECORDING RATHER THAN A SHRUG.
      // opencode DOES have an effort knob — `--variant` ("model variant
      // (provider-specific reasoning effort, e.g., high, max, minimal)") — but
      // `opencode --help` and `opencode run --help` are DIFFERENT FLAG SETS and
      // `--variant` appears ONLY under `run`. Chorus launches the interactive
      // TUI (the top-level invocation), where the flag does not exist. Chorus's
      // slider emits argv; with nothing to emit on the path actually taken, the
      // honest declaration is null and the control correctly does not render.
      //
      // ⚠ Note also that the vocabulary is `high`/`max`/`minimal` — three
      // documented examples against Chorus's four levels, the same non-mechanical
      // mapping problem kimi.ts records. Whoever wires `run` mode later must
      // decide that deliberately.
      reasoningEffort: null,
      // NULL — unmeasured, the same posture codex.ts and kimi.ts take, and for
      // the same reason: permission is the capability where guessing costs
      // authority rather than configuration.
      permissionMode: null,
      // NULL even though `-s/--session`, `-c/--continue` and `--fork` all
      // exist: the extension METHOD is unimplemented, and D34 Q1 makes
      // "declared" and "implemented" one fact. Same posture as the other three.
      sessionResume: null,
      // POPULATED by Task 6-5 — see OPENCODE_MCP below, and the two
      // `SupportsMcp` members that earn it.
      mcp: OPENCODE_MCP,
      hooks: null
    }
  },

  /** ⚠ `[]`, AND IT IS AN ANSWER RATHER THAN A STUB — opencode is configured by
   *  a FILE and has no per-launch argv vocabulary for MCP servers. See
   *  claude.ts's identical member for why `SupportsMcp` requires both. */
  mcpLaunchArgs(): readonly string[] {
    return []
  },

  /**
   * Write the Chorus-owned opencode config.
   *
   * ⚠ THE LOCATION IS THE SECURITY PROPERTY. This file goes in Chorus's own
   * directory — NOT into the user's repository (that would put a Chorus-written
   * file in a tree an agent is about to commit from) and NOT into opencode's
   * global config at `~/.config/opencode` (that would be Chorus editing a file
   * the user owns for every project at once). `OPENCODE_CONFIG` is what makes a
   * file outside both of those places reachable, and it is set per launch.
   *
   * ⚠ `OPENCODE_CONFIG` NAMES A FILE, NOT A DIRECTORY — 6-1 Finding 4,
   * measured: pointing it at a directory fails hard with
   * `BadResource: FileSystem.readFile <dir>`. Hence a filename here.
   *
   * ⚠ ONE FILE PER APP, NOT PER PROJECT, AND THAT IS A DELIBERATE LIMIT WORTH
   * READING. `OPENCODE_CONFIG` is set per launch and the file is rewritten at
   * every launch from the launching project's own memory config, so a session
   * always starts pointed at the right graph. Two opencode sessions in DIFFERENT
   * projects, both live, share the file — the later launch's servers are what
   * sits on disk. It costs nothing today (one graph per project, and opencode
   * reads its config at startup) and the fix, when it is needed, is a
   * per-session filename here rather than a change to any caller.
   */
  async writeMcpConfig(ctx: McpWriteContext): Promise<McpWriteResult> {
    return writeMcpConfigFile(
      OPENCODE_MCP,
      path.join(ctx.chorusConfigDir, OPENCODE_MCP.configPath),
      ctx
    )
  },

  buildLaunch(spec: PtyLaunchSpec): PtyLaunchRequest {
    const cli = resolveCli(this.id)
    const args = [...cli.args]

    // D4: `-m, --model  model to use in the format of provider/model`. Present
    // on the TOP-LEVEL invocation, not merely under `run` — checked, because
    // the two flag sets genuinely differ (see `--variant` above).
    //
    // Emitted ONLY when the route names a model — a null model must never reach
    // argv as the string "null" (D48; the same rule codex.ts and kimi.ts follow).
    const modelId = qualifyModel(spec.route?.modelId ?? null, spec.route?.baseUrl ?? null)
    if (modelId) args.push('-m', modelId)

    // ⚠ NOTHING ELSE IS EMITTED, AND THE ABSENCES ARE THE DESIGN:
    //  · no `-c` — it means --continue here and would resume a stale session;
    //  · no effort args — the flag is not on this invocation (see capabilities);
    //  · no base_url override — opencode carries OpenRouter's endpoint itself,
    //    and the route is selected by the MODEL PREFIX plus the env var. A
    //    provider row's base_url is therefore NOT forwarded: it is used only to
    //    identify which opencode provider the ids belong to (qualifyModel).
    args.push(...(spec.extraArgs ?? []))

    return {
      executable: cli.file,
      args,
      cwd: spec.cwd,
      envAdditions: {},
      // The whole point of this adapter: the key travels as an ENV VAR, through
      // the shared helper, into composeChildEnv's allow-list branch and the PTY
      // scrubber's match set. Never argv, never a file.
      secretEnv: buildSecretEnv(spec.credential)
    }
  }
}

/**
 * Task 6-5: opencode's MCP descriptor.
 *
 * ⚠ `env-named-file` + `pathEnvVar: 'OPENCODE_CONFIG'` IS THE WHOLE MECHANISM,
 * and `location: 'custom'` is what says the file is neither the project's nor
 * the user's home config — it is Chorus's, in a directory main hands over at
 * write time. `configPath` is a BARE FILENAME here for that reason: the
 * directory is main's to choose (`McpWriteContext.chorusConfigDir`), and an
 * adapter that hardcoded an absolute path would be an adapter that knows
 * Electron's userData layout.
 *
 * ⚠ `dialect: 'opencode'` IS THE FIELD THAT KEEPS THIS FILE READABLE BY THE
 * CLI. 6-1's D4 addendum (Finding 1) measured the schema through
 * `opencode debug config` on 1.18.15: top-level `mcp` rather than `mcpServers`,
 * ONE `command` array rather than a string plus `args`, `environment` rather
 * than `env`, plus a required `type: 'local'`. The schema is
 * `additionalProperties: false`, so claude's shape here would not be a
 * near-miss — it would be rejected, and a rejected config is indistinguishable
 * from one nobody wrote.
 *
 * ⚠ AND THE ENV VAR IS SET THROUGH `envAdditions`, WHICH IS CORRECT BECAUSE IT
 * IS A PATH. `envAdditions` is D33/D89's NON-SECRET channel; a file path is
 * exactly what belongs there and a password never would be.
 */
const OPENCODE_MCP: McpFileDescriptor = {
  mode: 'static',
  mechanism: 'env-named-file',
  format: 'json',
  location: 'custom',
  configPath: 'opencode.json',
  pathEnvVar: 'OPENCODE_CONFIG',
  dialect: 'opencode'
}

/**
 * opencode namespaces every model as `<its own provider id>/<the provider's own
 * model id>` — D4-verified: `opencode models openrouter` returns
 * `openrouter/deepseek/deepseek-v4-pro`, `openrouter/z-ai/glm-5.2`,
 * `openrouter/qwen/qwen3-coder` (all three of which are ids already sitting in
 * this machine's `model_shortlist`), alongside opencode's own curated aliases
 * such as `openrouter/~anthropic/claude-sonnet-latest`.
 *
 * Chorus stores the PROVIDER'S id (`deepseek/deepseek-v4-pro`) because that is
 * what OpenRouter's `/models` returns and what every other consumer — the
 * council, the catalog, codex's `-m` — needs. So exactly one translation is
 * required, and this is it. It lives HERE, in the adapter, for the same reason
 * kimi.ts documents that kimi wants an ALIAS rather than a vendor id: the
 * opencode model vocabulary is opencode's business and nothing outside this
 * file should have to know it.
 *
 * ⚠ IT PREFIXES ONLY WHAT IT CAN NAME FROM EVIDENCE, AND OTHERWISE PASSES
 * THROUGH UNTOUCHED. A base URL this function does not recognise yields the id
 * exactly as stored — opencode then rejects or accepts it on its own terms,
 * which is a legible failure. Inventing a prefix from an arbitrary hostname
 * would produce a model id no one chose, which is the failure mode D48 and D76
 * both exist to prevent.
 *
 * ⚠ AND IT IS IDEMPOTENT: an id a user has already fully qualified
 * (`openrouter/…`) is left alone rather than double-prefixed.
 */
export function qualifyModel(modelId: string | null, baseUrl: string | null): string | null {
  if (!modelId) return null
  const provider = opencodeProviderFor(baseUrl)
  if (provider === null) return modelId
  return modelId.startsWith(`${provider}/`) ? modelId : `${provider}/${modelId}`
}

/** The one mapping, keyed on HOST so a path or trailing slash cannot defeat it.
 *  One entry, because one is what has been verified. Add to it only with the
 *  same `opencode models <provider>` evidence. */
function opencodeProviderFor(baseUrl: string | null): string | null {
  if (!baseUrl) return null
  let host: string
  try {
    host = new URL(baseUrl).host.toLowerCase()
  } catch {
    return null // a malformed base_url is not a routing decision to guess at
  }
  return host === 'openrouter.ai' ? 'openrouter' : null
}
