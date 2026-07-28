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
 * The `kimi` (Kimi Code CLI) PTY adapter — the third entry in the registry,
 * and the reason D86 lifts D34 Q5's freeze.
 *
 * ⚠ EVERYTHING BELOW WAS D4-VERIFIED THIS SESSION (2026-07-27) AGAINST THE
 * INSTALLED `kimi.exe 0.29.1`, by running the binary, not by reading about it.
 * The roadmap's Phase 3d line said Kimi "is not yet verified as installed on
 * this machine"; it is — `C:\Users\matth\.kimi-code\bin\kimi.exe`, on PATH,
 * and already authenticated (`kimi provider list` -> `source=oauth`).
 *
 * ⚠ THE TRAP THIS FILE EXISTS TO NOT FALL INTO: `-c` IS NOT `--config` HERE.
 * On codex, `-c key=value` is the per-launch config override that carries the
 * whole OpenRouter route (D47). On kimi 0.29.1, **`-c` is `--continue`** — it
 * resumes the previous session for the working directory. Copying codex's
 * `buildLaunch` shape would silently resume a conversation instead of
 * configuring a route. `kimi --help` in full: -V/--version, -S/--session,
 * -c/--continue, -y/--yolo, --auto, -m/--model, -p/--prompt, --output-format,
 * --skills-dir, --agent, --agent-file, --add-dir, --plan, -h/--help.
 *
 * ⚠ AND THE CONSEQUENCE, WHICH IS THE WHOLE SHAPE OF THIS ADAPTER: kimi has NO
 * per-invocation configuration override at all. Providers, model aliases,
 * base URLs and keys are PERSISTENT STATE in `~/.kimi-code/config.toml`.
 * codex's adapter can point at an arbitrary OpenAI-compatible endpoint per
 * launch precisely because `-c` exists and `~/.codex/config.toml` is therefore
 * never written; kimi offers no such door. So THIS adapter launches kimi under
 * the user's OWN configuration and writes nothing — see D87 for the separate,
 * deliberately-scoped question of Chorus authoring config entries, which is
 * NOT what this file does and must not become what it does by accident.
 */
export const kimiAdapter: PtyAgentAdapter = {
  id: 'kimi',
  displayName: 'Kimi Code',
  executionMode: 'pty',

  // Nothing beyond the Windows baseline (main owns it), exactly as claude and
  // codex declare. kimi reads its credentials from ~/.kimi-code, not from the
  // environment, so there is nothing to preserve into an allow-list launch.
  requiredEnvVars: [],

  async detectInstallation(): Promise<InstallationStatus> {
    // The SHARED probe — same where.exe -> pickSpawnable -> --version path the
    // other two use. kimi resolves to a real .exe rather than an npm .cmd shim,
    // which means `resolveCli` returns it directly with no cmd.exe indirection;
    // that is a difference in the RESOLUTION, not in this adapter's logic, and
    // it is why nothing here special-cases it.
    return probeCli(this.id)
  },

  getAuthMethods(): readonly AuthMethodDefinition[] {
    return [
      // ⚠ ONE METHOD, AND THE ABSENCE OF `api_key` IS THE DECLARATION. claude
      // and codex both offer a second, key-bearing method; kimi has no flag and
      // no env var to receive one, so offering it would put a dead option in
      // the provider form. D4: `kimi login --help` -> "Authenticate with Kimi
      // Code CLI via the device-code flow." Already completed on this machine —
      // `kimi provider list` reports `managed:kimi-code type=kimi source=oauth`.
      {
        type: 'subscription',
        label: 'Kimi subscription (kimi login — device code)',
        requiredEnvVar: null,
        helpUrl: 'https://moonshotai.github.io/kimi-code/'
      }
    ]
  },

  getCapabilities(): AgentCapabilities {
    // Honesty rules (spec §4.2 / D34 Q1): declare ONLY what was verified, and
    // null/false for everything else. Four of these differ from claude/codex
    // and every difference is a measured fact rather than a default.
    return {
      interactiveTerminal: true, // the default `kimi` invocation is a TUI
      worktreeSafe: true, // it takes a cwd like any CLI; --add-dir extends it
      // D4: `--skills-dir <dir>  Load skills from this directory instead of
      // auto-discovered user and project directories.` Skills are real here.
      skills: true,
      subscriptionLogin: true, // `kimi login`, device-code, already done
      // ⚠ FALSE, AND DELIBERATELY SO. There is no `--api-key` flag and no env
      // var kimi reads for one: authentication is ~/.kimi-code state, written
      // by `kimi login` or by a provider entry carrying `api_key`. Chorus
      // cannot hand this CLI a key at launch the way it hands one to claude or
      // codex, so declaring the capability would be a lie the launch dialog
      // would then act on by offering an api_key auth mode that can do nothing.
      apiKey: false,
      // ⚠ NULL, AND THIS IS THE `-c` TRAP'S SECOND CONSEQUENCE. kimi DOES have
      // an effort ladder — `[thinking] effort` globally, and per-model
      // `support_efforts = ["low","high","max"]` with `default_effort` — but it
      // lives in config.toml and there is NO CLI FLAG to set it per launch.
      // Chorus's slider emits argv; with nothing to emit, the honest
      // declaration is null and the control correctly does not render.
      //
      // ⚠ AND NOTE THE LADDER IS THREE LEVELS, NOT FOUR. Even given a flag,
      // low/high/max does not map onto Fast/Balanced/Deep/Max without inventing
      // a fourth position — the same objection D34/3a-4 raised against
      // stretching claude's five values across four. Whoever implements this
      // must decide that deliberately; it is not a mechanical port.
      reasoningEffort: null,
      // NULL even though `-S/--session` and `-c/--continue` exist: the
      // extension METHOD is unimplemented, and D34 Q1 makes "declared" and
      // "implemented" one fact. Same posture as claude.ts and codex.ts.
      sessionResume: null,
      mcp: null,
      hooks: null
    }
  },

  buildLaunch(spec: PtyLaunchSpec): PtyLaunchRequest {
    const cli = resolveCli(this.id)
    const args = [...cli.args]

    // D4: `-m, --model <model>  LLM model alias to use for this invocation.
    // Defaults to default_model in config.toml.`
    //
    // ⚠ AN ALIAS, NOT A MODEL ID, AND THE DIFFERENCE IS NOT COSMETIC. codex
    // takes a raw vendor id (`-m deepseek/deepseek-v4-pro`); kimi takes a KEY
    // into its own `[models."..."]` table — on this machine `kimi-code/k3`,
    // `kimi-code/k3-256k`, `kimi-code/kimi-for-coding`,
    // `kimi-code/kimi-for-coding-highspeed`. Passing a vendor id kimi has no
    // alias for is a launch-time failure, not a fallback.
    //
    // Emitted ONLY when the route names one — a null model must never reach
    // argv as the string "null" (D48, the same rule codex.ts follows).
    if (spec.route?.modelId) args.push('-m', spec.route.modelId)

    // ⚠ NOTHING ELSE IS EMITTED, AND THE ABSENCES ARE THE DESIGN:
    //  · no `-c` — it means --continue here and would resume a stale session;
    //  · no effort args — there is no flag (see getCapabilities);
    //  · no route overrides — kimi has no per-launch config door at all, so a
    //    base_url or key on the provider row CANNOT reach this child. A route
    //    that carries one is not silently half-applied: `apiKey: false` keeps
    //    the launch dialog from offering the credential in the first place.
    args.push(...(spec.extraArgs ?? []))

    return {
      executable: cli.file,
      args,
      cwd: spec.cwd,
      envAdditions: {},
      // Always empty in practice — `apiKey: false` means no credential reaches
      // this adapter. Wired through the SHARED helper anyway rather than
      // hardcoding `{}`, so that if D87 ever gives kimi a key path it inherits
      // the same handling the other two get instead of growing a private one.
      secretEnv: buildSecretEnv(spec.credential)
    }
  }
}
