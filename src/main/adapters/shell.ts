import { resolveCli, type ResolvedCli } from '../services/cliDetect'
import type {
  AgentCapabilities,
  AuthMethodDefinition,
  InstallationStatus,
  PtyAgentAdapter,
  PtyLaunchRequest,
  PtyLaunchSpec
} from './types'

/*
 * ⚠ `buildSecretEnv` IS NOT IMPORTED, AND ITS ABSENCE IS PART OF THE DESIGN.
 * Every other PTY adapter imports it from `./capabilities` — including
 * `kimi.ts`, which declares `apiKey: false` and routes through it anyway "so
 * that if D87 ever gives kimi a key path it inherits the same handling the
 * other two get instead of growing a private one" (kimi.ts:158-:162). That is a
 * good reason to keep a door open for an adapter whose key path might one day
 * exist. HERE THE DOOR IS THE DEFECT: a shell must never receive a credential
 * under any future change, so the honest expression is a literal `{}` — and a
 * reviewer grepping this file for `credential` should find nothing at all.
 * `probeCli` is not imported either, for `detectInstallation`'s reason below.
 */

/**
 * The shell Chorus opens, in preference order.
 *
 * ⚠ `pwsh` FIRST BECAUSE IT IS THE ONE THE USER CHOSE. PowerShell 7 is an
 * opt-in install; a machine that has it has it deliberately, and it is the
 * shell that machine's owner uses. `powershell` is the floor, present on every
 * supported Windows, so this list cannot come back empty on a working machine —
 * and if it does, that is a fact about the environment worth failing loudly on
 * rather than papering over with cmd.exe.
 *
 * ⚠ NO `cmd`, NO `bash`, NO WSL, AND NO USER SETTING. One kind, one policy. A
 * shell picker is a settings surface and this phase builds none; adding one here
 * would put a PREFERENCE into an adapter, which is where MEASURED FACTS about a
 * CLI live (D34 Q1).
 */
const SHELL_CANDIDATES: readonly string[] = ['pwsh', 'powershell']

/**
 * ⚠ ONE RESOLVER, USED BY BOTH `detectInstallation` AND `buildLaunch`, SO
 * DETECTION AND LAUNCH CAN NEVER DISAGREE ABOUT WHICH BINARY THE USER GETS.
 * That is `probeCli`'s own rule one level in (`cliDetect.ts:157`-`:163`: "ONE
 * implementation, because … two copies of this logic are how it drifts"). A card
 * that says "found" while the launch throws, or the reverse, is the failure this
 * shape exists to make impossible.
 *
 * ⚠ SYNCHRONOUS, AND THAT IS A COST TAKEN DELIBERATELY. `resolveCli` is
 * `execFileSync('where.exe', …)`, so `detectInstallation` — which is async, and
 * whose four siblings are genuinely async — blocks main's loop for one or two
 * `where.exe` calls per dialog open. MEASURED 2026-08-27 on this machine:
 * `where.exe pwsh` 135.5 ms cold / ~50 ms warm, `where.exe powershell` 51.7 ms;
 * `pwsh` resolves first so the second call is not made. The alternative is an
 * ASYNC copy of where.exe resolution living in this file, which is a second
 * resolver that can drift from the one `buildLaunch` uses. Drift is the more
 * expensive failure and it is silent; fifty milliseconds is neither.
 *
 * `null` rather than a throw, so `detectInstallation` can report "not found" the
 * way every other probe does. `buildLaunch` turns it back into a throw, because
 * a launch with no executable has nothing else to be.
 */
function resolveShell(): ResolvedCli | null {
  for (const name of SHELL_CANDIDATES) {
    try {
      return resolveCli(name)
    } catch {
      // `resolveCli` throws for "not on PATH" and for "on PATH but nothing
      // spawnable". Both mean the same thing here: try the next candidate.
    }
  }
  return null
}

/**
 * The `shell` PTY adapter — a real PowerShell in a pane, labelled `Terminal`.
 * The SIXTH registry entry (D185), added 2026-08-26 so that Phase 7a's Workbench
 * preset ("an agent plus a shell in the same tree", D183(b)) has something to
 * launch.
 *
 * ⚠ THE ONE STRUCTURAL DIFFERENCE FROM EVERY ADAPTER BEFORE IT: `id` IS A
 * REGISTRY KEY, NOT A BINARY NAME. `probeCli(this.id)` and `resolveCli(this.id)`
 * are correct in claude.ts, codex.ts, grok.ts, kimi.ts and opencode.ts and are
 * WRONG here — there is no `shell.exe`, so the first would report "not found"
 * for ever and the second THROWS. Everything else in this file follows from that
 * one divergence.
 *
 * ⚠ WHY AN ADAPTER AND NOT A `session.kind` DISCRIMINATOR (D185). A
 * discriminator would say structurally that a shell is not an agent, which is
 * true and expensive: it touches the DB schema, the wire and every session
 * surface, to buy a distinction THE SIX NULL CAPABILITIES BELOW ALREADY ENFORCE
 * AT EVERY CALL SITE. `supportsMcp`, `supportsHooks`, `supportsResume` and
 * `supportsInstructions` each narrow to `false` here by the existing BOTH-HALVES
 * rule (`types.ts:1003`-`:1057`), so no MCP file is written, no hook config is
 * minted, no resume pointer is assigned and no instructions file is created —
 * without one `if (kind === 'shell')` anywhere in the app.
 *
 * ⚠ AND THE ONE THING THIS ROUTE DOES NOT BUY: A REFUSAL. An adapter can decline
 * to ASK for a credential; it cannot stop main from RESOLVING one that arrived on
 * the launch payload. That guard lives in `main/ipc.ts` beside its sibling
 * refusal.
 */
export const shellAdapter: PtyAgentAdapter = {
  id: 'shell',
  displayName: 'Terminal',
  executionMode: 'pty',

  /** Nothing beyond the Windows baseline. A shell inherits `process.env`
   *  wholesale on the no-credential branch of `composeChildEnv`, exactly as
   *  every subscription-auth launch does today, so there is nothing to preserve
   *  that is not already preserved. */
  requiredEnvVars: [],

  async detectInstallation(): Promise<InstallationStatus> {
    // ⚠ NOT `probeCli(this.id)`. See the header: `this.id` is 'shell' and there
    // is no shell.exe.
    const cli = resolveShell()
    if (!cli) return { found: false, path: null, version: null }
    // ⚠ `version: null` IS A DECISION, NOT AN OMISSION (D185), AND THE NUMBERS
    // BEHIND IT WERE MEASURED RATHER THAN ASSUMED (2026-08-27). `probeCli` would
    // spawn `<shell> --version` with a 10 s timeout on EVERY dialog open.
    // `pwsh --version` costs 139.1 ms and answers "PowerShell 7.6.5";
    // `powershell --version` DOES NOT PARSE — Windows PowerShell 5.1 reads `--`
    // as a unary operator and dies with `MissingExpressionAfterOperator` after
    // 496.3 ms, yielding 'unknown' for half a second of every dialog open. A
    // `$PSVersionTable` probe costs the same and buys the version of the user's
    // WINDOWS INSTALL, which identifies the machine rather than the agent and
    // which nothing in Chorus acts on. The card renders a blank line for a null
    // version, which is the honest form of "no version claimed" — D76: omit
    // rather than stub.
    return { found: true, path: cli.path, version: null }
  },

  /**
   * ⚠ EMPTY, AND THE EMPTINESS IS THE DECLARATION — `kimi.ts:56`-`:58` makes the
   * same move for the narrower case ("the ABSENCE of `api_key` is the
   * declaration"). There is nothing to log into and nothing to bill. The launch
   * dialog reads this and offers no auth control at all.
   *
   * ⚠ AND THIS IS NOT THE SECURITY BOUNDARY. An empty list means the dialog
   * never OFFERS a credential; it does not mean main REFUSES one. Those are
   * different statements, and the second one lives in `main/ipc.ts`.
   */
  getAuthMethods(): readonly AuthMethodDefinition[] {
    return []
  },

  getCapabilities(): AgentCapabilities {
    // ⚠ EVERY NULL BELOW MEANS "THIS DOES NOT EXIST FOR A SHELL" — WHICH IS A
    // STRONGER CLAIM THAN THE "UNMEASURED" NULLS IN grok.ts AND LOOKS IDENTICAL
    // IN THE TYPE. grok's nulls are an invitation to measure; these are a closed
    // question. A reader who cannot tell them apart will one day "finish" this
    // adapter, so each one says which it is.
    return {
      // A PowerShell prompt is the most interactive terminal there is.
      interactiveTerminal: true,
      // It takes a cwd like any process; a worktree is just a directory.
      worktreeSafe: true,
      // Skills are an agent concept. There is no agent here.
      skills: false,
      // Nothing to log into.
      subscriptionLogin: false,
      // ⚠ FALSE, AND THIS BOOLEAN IS LOAD-BEARING BEYOND THIS FILE: the refusal
      // in `main/ipc.ts` is keyed on it, so that the guard generalises to any
      // future adapter that cannot take a key rather than to the string 'shell'.
      // ⚠ NOTE `kimi.ts:94` ALSO DECLARES FALSE, for a different reason — it has
      // no flag and no env var to receive a key. The refusal addresses that
      // overlap deliberately rather than discovering it later; a census taken
      // 2026-08-27 found ZERO `launch_profiles` rows in both the installed and
      // dev databases, so the shared predicate changes nothing for kimi today.
      apiKey: false,

      // ── The six descriptors, all null, all INAPPLICABLE ──────────────────
      // No model to choose, so no Model select renders.
      reasoningEffort: null,
      // No permission ladder: the shell has exactly the user's own authority,
      // which is the same authority Chorus itself runs with. Nothing to broker,
      // so no Permission segment renders.
      permissionMode: null,
      // No conversation to resume. A shell's history is the user's own
      // PowerShell history file; Chorus neither owns it nor reopens it, and a
      // `session:restart` gives a fresh prompt exactly as it gives every agent a
      // fresh conversation (D142).
      sessionResume: null,
      // No agent to give tools to. `withMcpEnv` writes nothing because
      // `supportsMcp` narrows to false here.
      mcp: null,
      // No lifecycle events, because there is no agent lifecycle. The pane keeps
      // exactly THREE states (D129) — a false amber is worse than no amber.
      hooks: null,
      // No system prompt and no instructions file: there is nothing to instruct.
      instructions: null
    }
  },

  buildLaunch(spec: PtyLaunchSpec): PtyLaunchRequest {
    const cli = resolveShell()
    if (!cli) {
      // The same shape `resolveCli` throws for every other adapter, so the
      // failure surfaces the way a missing CLI already does: a rejected invoke,
      // rendered inline by the launch dialog.
      throw new Error(
        `Could not find a shell on PATH (tried ${SHELL_CANDIDATES.join(', ')}). ` +
          'Install PowerShell 7 or repair the Windows PATH.'
      )
    }
    return {
      executable: cli.file,
      // ⚠ CHORUS AUTHORS ZERO ARGUMENTS, AND `cli.args` IS NOT ONE OF ITS OWN.
      // On this machine both candidates are real .exe files, so `pickSpawnable`
      // returns `args: []` and this spreads to nothing. It is spread anyway
      // rather than written as a bare `[]`, because `args` is the RESOLVER'S
      // spawn form — `['/c', <shim>]` on the cmd.exe fallback route — and
      // dropping it would silently break the branch F96 put there. D185 says
      // "args: []"; that is a statement about what CHORUS adds, and this honours
      // it exactly.
      //
      // ⚠ AND NO `-NoProfile`. The user's PowerShell profile is the shell they
      // expect; suppressing it is a judgement about their machine that this task
      // is not entitled to make.
      args: [...cli.args],
      cwd: spec.cwd,
      envAdditions: {},
      // ⚠ A LITERAL, NOT `buildSecretEnv(spec.credential)`, AND THIS IS THE
      // SECOND HALF OF THE DEFENCE. The refusal in `main/ipc.ts` stops a
      // credential ARRIVING; this stops one being USED if that guard is ever
      // moved, narrowed or reordered. A decrypted API key injected into a raw
      // shell is readable by the human at the prompt — `echo
      // $env:ANTHROPIC_API_KEY`. Every other adapter hands its key to a CLI that
      // spends it; this one would hand it to a person.
      secretEnv: {}
    }
  }
}
