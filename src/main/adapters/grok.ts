import { probeCli, resolveCli } from '../services/cliDetect'
import { buildSecretEnv } from './capabilities'
import { resolveLevelArgs } from './argLevels'
import type {
  AgentCapabilities,
  AgentSessionLaunch,
  AssignedResumeSupport,
  AuthMethodDefinition,
  EffortDescriptor,
  InstallationStatus,
  PermissionModeDescriptor,
  PtyAgentAdapter,
  PtyLaunchRequest,
  PtyLaunchSpec,
  ResumeExitObservation,
  ResumeFailureReason
} from './types'

/**
 * The `grok` (Grok CLI — xAI's terminal agent, "Grok Build" in its own user
 * guide) PTY adapter. The FIFTH registry entry (D164), added at Matthew's
 * request on 2026-08-18: "have Grok be an option when adding an agent like
 * Claude, Codex, or OpenCode".
 *
 * ⚠ EVERYTHING BELOW WAS D4-VERIFIED ON 2026-08-18 AGAINST THE INSTALLED
 * `grok 1.0.5 (5115b46bc9) [stable]` — `C:\Users\matth\.grok\bin\grok.exe`,
 * a real .exe on the USER PATH (installer-added, so any Chorus process started
 * before the install will not see it until it restarts) — by RUNNING THE
 * BINARY, never by recalling it. Its user guide ships beside it in
 * `~/.grok/docs/user-guide/` and is quoted where a flag's meaning needed more
 * than `--help` gives.
 *
 * ⚠ THE `-c` TRAP, FOR THE THIRD TIME (kimi D87, opencode D90): on grok
 * `-c` is `--continue` — "Continue the most recent session for the current
 * working directory". Never emitted here. With several panes on one cwd it
 * would silently adopt someone else's conversation, which is exactly the
 * failure D139 exists to prevent.
 *
 * ⚠ AND THE SHAPE THAT MAKES GROK A PEER OF CLAUDE RATHER THAN OF KIMI: it has
 * a real per-launch flag for every one of the levelled capabilities Chorus
 * knows how to drive — `-m`, `--reasoning-effort`, `--permission-mode` — AND
 * a claude-shaped ASSIGNED resume pair (`--session-id` to name a new
 * conversation, `--resume` to reopen it). So this file is modelled on
 * `claude.ts`, not `kimi.ts`, and reads the same descriptors through the same
 * `resolveLevelArgs`.
 */
export const grokAdapter: PtyAgentAdapter & AssignedResumeSupport = {
  id: 'grok',
  displayName: 'Grok',
  executionMode: 'pty',

  /**
   * ⚠ EMPTY, AND MEASURED RATHER THAN ASSUMED — the same probe opencode was put
   * through (D90). 2026-08-18: `grok models` was spawned from node with a
   * CLEARED environment block holding exactly `BASELINE_ENV_VARS` (PATH,
   * SystemRoot, TEMP, TMP, HOMEDRIVE, HOMEPATH, USERPROFILE), the two
   * `PINNED_ENV_VARS` and `XAI_API_KEY`. It exited 0, printed "You are using
   * XAI_API_KEY." and listed both models. Nothing beyond the baseline is
   * needed, so nothing is claimed.
   */
  requiredEnvVars: [],

  async detectInstallation(): Promise<InstallationStatus> {
    // The SHARED probe. `where.exe grok` -> `C:\Users\matth\.grok\bin\grok.exe`,
    // a real .exe (no cmd.exe shim); `grok --version` prints
    // `grok 1.0.5 (5115b46bc9) [stable]` on its first line, which is what the
    // launch card shows.
    return probeCli(this.id)
  },

  getAuthMethods(): readonly AuthMethodDefinition[] {
    return [
      {
        // `grok login` — browser OAuth against auth.x.ai by default,
        // `--device-code` for headless. On this machine it is already done:
        // `grok models` -> "You are logged in with grok.com." Chorus neither
        // drives nor reads it; a launch inherits whatever the user logged in
        // with, which is what every other subscription method here means.
        type: 'subscription',
        label: 'Grok subscription (grok login — grok.com account)',
        requiredEnvVar: null,
        helpUrl: 'https://docs.x.ai/'
      },
      {
        type: 'api_key',
        label: 'xAI API key',
        // D4, by running the binary rather than by reading about it
        // (2026-08-18): with an ISOLATED home (no auth.json) and a bogus
        // `XAI_API_KEY`, `grok models` printed "You are using XAI_API_KEY."
        // and `grok --debug -p` logged `resolved credentials … auth_type=ApiKey`
        // followed by the server's "Incorrect API key provided" — i.e. the
        // variable is read and sent. The user guide (02-authentication.md,
        // "Auth Precedence") ranks it BELOW an active session token, so on a
        // machine that has run `grok login` the key is a fallback, not an
        // override.
        requiredEnvVar: 'XAI_API_KEY',
        helpUrl: 'https://console.x.ai/'
      }
    ]
  },

  getCapabilities(): AgentCapabilities {
    // Honesty rules (spec §4.2 / D34 Q1): declare ONLY what was verified, and
    // null/false for everything else. Every non-null below names its evidence.
    return {
      interactiveTerminal: true, // the default `grok` invocation is a TUI ("Grok Build TUI")
      worktreeSafe: true, // takes a cwd like any CLI; `--cwd <CWD>` also exists
      // `grok --help` has no skills flag, but `~/.grok/bundled/skills/` ships
      // 25 skills and 08-skills.md documents them; the marketplace source in
      // config.toml is a skills source. Real here.
      skills: true,
      subscriptionLogin: true, // `grok login`, done on this machine
      apiKey: true, // XAI_API_KEY — see getAuthMethods for the measurement
      reasoningEffort: GROK_EFFORT,
      permissionMode: GROK_PERMISSION,
      // ASSIGNED, exactly claude's shape (D140): `-s, --session-id <SESSION_ID>`
      // "Use a specific session UUID for a **new** conversation" and
      // `-r, --resume [<SESSION_ID_OR_TITLE>]` to reopen it. Chorus mints the
      // id before a byte of output exists. Earned by `classifyResumeFailure`
      // below (D34 Q1: declared and implemented are one fact).
      sessionResume: { mode: 'static', kind: 'assigned', cliFlag: '--resume' },
      // ⚠ NULL, NOT "NO". `grok mcp` exists and 07-mcp-servers.md documents a
      // config file — but nothing here has MEASURED its dialect or where it
      // must live, and Chorus's file writers know exactly two dialects
      // (`McpDialect`). A guess would write a file grok ignores.
      mcp: null,
      // ⚠ NULL, NOT "NO". 10-hooks.md documents a Claude-compatible hook bus,
      // but there is no `--settings <file>` flag to load a per-launch hook
      // config the way claude.ts does it, and the file-based route means
      // writing into the user's repository. Unmeasured; a false amber is
      // worse than no amber (D129).
      hooks: null,
      // ⚠ NULL. `--rules <RULES>` ("Extra rules to append to the system prompt")
      // is a genuine APPEND vehicle, but it is argv-only — the memory contract
      // would sit in a world-readable command line — and it is unmeasured
      // against the TUI. Recorded as the seam; not claimed.
      instructions: null
    }
  },

  buildLaunch(spec: PtyLaunchSpec): PtyLaunchRequest {
    const cli = resolveCli(this.id)
    // The two descriptors ARE the mapping; this only reads them (Task 3a-4's
    // rule, and claude.ts's shape verbatim). With no level chosen the declared
    // defaults apply — `--reasoning-effort high --permission-mode auto` — and
    // a raw `--reasoning-effort` / `--permission-mode` in extraArgs suppresses
    // Chorus's own tokens for that knob entirely (rank 1).
    const effortArgs = resolveLevelArgs(GROK_EFFORT, spec.effortOptionId, spec.extraArgs ?? [])
    const permissionArgs = resolveLevelArgs(
      GROK_PERMISSION,
      spec.permissionModeId,
      spec.extraArgs ?? []
    )
    // `-m, --model <MODEL>  Model ID to use` — on the top-level TUI invocation.
    // A raw vendor id (`grok-4.6`, `grok-4.5` — `grok models` lists exactly
    // those two on this account), not an alias table like kimi's. Emitted
    // ONLY when the route names one; a null model never reaches argv as the
    // string "null" (D48). ⚠ `route.baseUrl` is NOT applied: grok has no
    // per-launch endpoint flag (custom endpoints are `[model.<name>]` tables in
    // config.toml), so a route's base_url cannot reach this child and is not
    // half-applied by pretending otherwise.
    const modelArgs = spec.route?.modelId ? ['-m', spec.route.modelId] : []
    // Resume LAST, as in claude.ts — it changes what the launch IS, and keeping
    // it after every option keeps the no-modifier argv byte-identical to a
    // fresh launch.
    const resumeArgs = grokResumeArgs(spec.resume)
    return {
      executable: cli.file,
      args: [...cli.args, ...effortArgs, ...permissionArgs, ...modelArgs, ...resumeArgs],
      cwd: spec.cwd,
      envAdditions: {},
      // The key travels in the ENVIRONMENT (XAI_API_KEY) and never in argv.
      secretEnv: buildSecretEnv(spec.credential)
    }
  },

  /**
   * Map a MEASURED grok resume failure to a generic reason. Adapter-local,
   * pure, no I/O, no logging — `observation.output` is read and goes nowhere
   * else (D143(a)). Same posture as claude.ts: NARROW matches on strings
   * measured against the installed CLI, and anything unrecognised is a clean
   * exit — a generous classifier turns ordinary ends into pointer-clearing
   * relaunches, which is worse than never having shipped resume.
   */
  classifyResumeFailure(observation: ResumeExitObservation): ResumeFailureReason | null {
    // A clean exit is never a failed resume, whatever the text says (the
    // agent may be quoting this very file). Measured 2026-08-18: both failure
    // shapes below exit 1. A signal kill (`exitCode === null`) is Chorus's.
    if (observation.exitCode === 0 || observation.exitCode === null) return null
    // Measured 2026-08-18, grok 1.0.5, `grok --resume <unknown uuid>`:
    //   Session "<uuid>" not found locally, restoring conversation from remote...
    //   Error: Failed to restore session from remote: fetching session record:
    //   session get failed: 404 Not Found
    // ⚠ MATCHED ON THE 404, NOT ON "Failed to restore". grok tries a REMOTE
    // restore for any id it does not hold locally, so a network outage would
    // print the same prefix with a different tail — and clearing a healthy
    // pointer because the machine was offline is precisely the over-eager
    // classification this function must not make.
    if (/Failed to restore session from remote:.*404 Not Found/i.test(observation.output)) {
      return 'not-found'
    }
    // Measured 2026-08-18, `grok --session-id <live uuid>`:
    //   Error: Error: Session ID <uuid> is already in use.
    // (Byte-for-byte claude's wording after the doubled prefix.)
    if (/Session ID .* is already in use/i.test(observation.output)) return 'in-use'
    return null
  }
}

/**
 * The resume argv for one launch — claude.ts's `claudeResumeArgs`, for grok.
 *
 * ⚠ THE VALUE IS OPTIONAL TO THE CLI, SO AN EMPTY POINTER DOES NOT FAIL — IT
 * RESUMES SOMETHING ELSE. `grok --help` verbatim: `-r, --resume
 * [<SESSION_ID_OR_TITLE>]  Resume a session by ID or title, or the most recent
 * if omitted`. "The most recent" is the D139 failure exactly (another pane's
 * conversation on the same cwd), so: no value, no flag. (D143(e).)
 */
function grokResumeArgs(resume: AgentSessionLaunch | undefined): readonly string[] {
  if (!resume) return []
  if (resume.agentSessionId.length === 0) return []
  // grok is an ASSIGNED adapter; a 'discovered' modifier is unreachable and
  // degrades to a fresh launch rather than throwing.
  if (resume.strategy !== 'assigned') return []
  // ⚠ NEVER BOTH. `--session-id` refuses an id that already exists ("Session ID
  // … is already in use.") and `--resume` requires one that does; the flags'
  // own help says `--session-id` "does not resume existing sessions — use
  // `--resume` / `--continue` instead". Verified headless on 1.0.5: create
  // under a minted id exits 0, and `--resume <that id>` continues it.
  return resume.action === 'create'
    ? ['--session-id', resume.agentSessionId]
    : ['--resume', resume.agentSessionId]
}

/**
 * The grok effort mapping. ONE HOME — `buildLaunch` reads it and nothing
 * duplicates it.
 *
 * D4, 2026-08-18, grok 1.0.5. `grok --help`: `--reasoning-effort <EFFORT>
 * Reasoning effort for reasoning models [aliases: --effort]`. The accepted
 * values are PER MODEL and the CLI rejects an unlisted one AT LAUNCH — measured:
 * `grok --model grok-4.5 --reasoning-effort xhigh -p …` -> exit 1,
 * "unknown effort level 'xhigh'; use one of: high, medium, low". The menus
 * this account sees (`~/.grok/models_cache.json`, and the ACP `initialize`
 * response in the debug log):
 *
 *      grok-4.6 (default)  low · medium · high · xhigh     default high
 *      grok-4.5            low · medium · high             default high
 *
 * ⚠ FOUR VENDOR VALUES, FOUR POSITIONS, ONE-TO-ONE — the first adapter where
 * the ladder needs no unreachable rung and no collapse:
 *
 *      Fast     -> low           Deep -> high
 *      Balanced -> medium        Max  -> xhigh
 *
 * ⚠ THE ONE TRAP THAT MAPPING CARRIES: `Max` on a `grok-4.5` route fails at
 * launch (measured above), because 4.5's menu stops at `high`. Chorus does not
 * probe per-model menus (model-capability probing is an explicit non-goal, as
 * claude.ts and 3a-4 record), so this is documented rather than special-cased:
 * the exit is visible in the pane, and every other rung is legal on both.
 *
 * `defaultLevelId: 'deep'` = `high` = grok's OWN default on both models, so an
 * unconfigured launch is safe on either and the dialog shows the rung the
 * launch will actually carry (the same "what the control shows is what the
 * launch sends" argument LaunchDialog's anchoring makes for claude).
 */
const GROK_EFFORT: EffortDescriptor = {
  mode: 'static',
  levels: [
    { id: 'fast', label: 'Fast', args: ['--reasoning-effort', 'low'] },
    { id: 'balanced', label: 'Balanced', args: ['--reasoning-effort', 'medium'] },
    { id: 'deep', label: 'Deep', args: ['--reasoning-effort', 'high'] },
    { id: 'max', label: 'Max', args: ['--reasoning-effort', 'xhigh'] }
  ],
  defaultLevelId: 'deep'
}

/**
 * The grok permission mapping. PLAN principle 009: Chorus picks the word, the
 * CLI enforces it.
 *
 * D4, 2026-08-18, grok 1.0.5. `grok --help` verbatim:
 *   --permission-mode <MODE>  Permission mode
 *       [possible values: default, acceptEdits, auto, dontAsk, bypassPermissions, plan]
 * and 22-permissions-and-safety.md's table gives each its meaning:
 *   default (**ask**)   read-only tools run; everything else prompts
 *   acceptEdits         file edits without a prompt
 *   auto                "work the safety check allows; other calls are blocked
 *                        or escalated" — the same concept claude calls auto
 *   plan                "accepted for compatibility; use plan mode for gated
 *                        planning"
 *   dontAsk             only pre-approved tools (CI allowlists)
 *   bypassPermissions   always-approve
 * `--permission-mode` is documented to work "in both modes" (TUI and headless).
 *
 * ⚠ THREE OF THE SIX, AND EACH OMISSION IS THE DECISION.
 *   - `bypassPermissions`: `permissionModeSchema`'s standing ruling — one
 *     click from "Auto" is not where always-approve belongs. Reachable via
 *     extra_args like every unmapped rung.
 *   - `plan`: "accepted for compatibility" is the CLI saying it does not do
 *     what the word says, and nothing here MEASURED what it does instead;
 *     spec §4.2 forbids shipping a control position Chorus is guessing at.
 *   - `dontAsk`: unmeasured, and a CI posture rather than a pane's.
 *
 * ⚠ ORDER IS THE RENDERED ORDER (LaunchDialog renders `levels` as declared):
 * the default first, then the alternatives, ask-me-everything last — the same
 * layout claude's control has, so the two read alike.
 *
 * `defaultLevelId: 'auto'` follows the one line claude's descriptor exists for
 * (Matthew, 2026-08-14: "when I start an agent … I want it in auto mode on"),
 * applied to the agent he asked to add beside it. Flip it here if grok should
 * start on Manual instead; nothing else needs to change.
 */
const GROK_PERMISSION: PermissionModeDescriptor = {
  mode: 'static',
  levels: [
    { id: 'auto', label: 'Auto', args: ['--permission-mode', 'auto'] },
    { id: 'accept-edits', label: 'Accept edits', args: ['--permission-mode', 'acceptEdits'] },
    { id: 'manual', label: 'Manual', args: ['--permission-mode', 'default'] }
  ],
  defaultLevelId: 'auto'
}
