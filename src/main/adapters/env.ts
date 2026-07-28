/**
 * The Windows baseline every child process needs regardless of agent (D33
 * clause 4 + council finding [MEDIUM] "Environment allow-list under-specified
 * for Windows/ConPTY"). Entries beyond the council's list are ADDED ONLY BY
 * EMPIRICAL NECESSITY — each one must have been observed to break an agent
 * when absent, and the reason recorded here. Do not add speculatively: an
 * over-broad allow-list silently reintroduces the ambient-credential leak this
 * whole mechanism exists to close.
 */
export const BASELINE_ENV_VARS: readonly string[] = [
  'PATH',
  'SystemRoot',
  'TEMP',
  'TMP',
  'HOMEDRIVE',
  'HOMEPATH',
  'USERPROFILE'
  // ↓ additions from the Task 3-6 empirical pass go here, each with a comment
  //   naming what broke without it.
]

/**
 * Values Chorus IMPOSES on every child, regardless of what the host shell
 * exported. D54 (2026-07-24), amending D33's seven-variable allow-list.
 *
 * ⚠ This is deliberately NOT part of BASELINE_ENV_VARS, and the distinction is
 * load-bearing rather than stylistic. BASELINE_ENV_VARS is a list of NAMES TO
 * COPY FROM THE PARENT — every entry is a channel through which host state
 * reaches the child. This is a map of VALUES TO IMPOSE, carrying zero bytes of
 * host state. Adding 'TERM' to the array instead would compile, read as the
 * fix, and inherit TERM=dumb — i.e. reproduce F28 exactly.
 *
 * WHY (F28, observed live 2026-07-24): the execution shell exported TERM=dumb;
 * inherited, it put codex 0.145.0 into a fallback renderer that emits
 * cursor-advance escapes BETWEEN individual characters (`-  a  p  i  0  3  -
 * K  7 …`). The value was fully legible ON SCREEN and simultaneously INVISIBLE
 * to substring matching, so exact-value scrubbing was defeated with no bug in
 * the scrubber. That is D33's accepted ANSI-interleaving residual, observed
 * rather than theorised — and it is a rendering-policy problem, so it is fixed
 * where rendering policy lives.
 *
 * COLORTERM travels with TERM by decision, not by accident: without it a
 * credential-bearing launch strips COLORTERM (not on the allow-list) while
 * TERM advertises 256-colour, and a no-credential launch passes a host value
 * through — the same two-policies-disagree asymmetry that produced F28. It is
 * admitted on consistency grounds; F28 does not evidence it on its own.
 */
export const PINNED_ENV_VARS: Readonly<Record<string, string>> = {
  TERM: 'xterm-256color',
  COLORTERM: 'truecolor'
}

/**
 * Session markers an agent harness exports to tell ITS OWN children "you are
 * running inside my session". They describe the process that launched Chorus —
 * never the pane Chorus is about to open — and every one of them is a lie by
 * the time a child PTY reads it.
 *
 * WHY (observed live 2026-07-27): launching Chorus from inside a Claude Code
 * session leaves `CLAUDE_CODE_CHILD_SESSION` in `process.env`. The no-credential
 * path inherits wholesale, so the marker reached every `claude` pane and each
 * one printed, at the bottom of its own terminal:
 *     ⚠ Transcript saving is off — inherited CLAUDE_CODE_CHILD_SESSION marker
 * i.e. Chorus was silently disabling transcript persistence for its users'
 * sessions because of who happened to start Chorus. A pane is a TOP-LEVEL
 * session by construction; there is no sense in which it is a child of the
 * shell's agent, and the launcher's identity is not session state Chorus may
 * pass on.
 *
 * ⚠ NAMED ENTRIES, NOT A `CLAUDE_CODE_*` WILDCARD, AND THE DISTINCTION IS
 * LOAD-BEARING. The same prefix carries legitimate USER configuration that a
 * developer sets in their own profile and expects honoured —
 * `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`,
 * `CLAUDE_CODE_MAX_OUTPUT_TOKENS`. Stripping by prefix would fix this bug by
 * breaking a Bedrock user's routing, which is the over-broad-fix shape D33
 * warns about in the other direction. Add a name here only once it has been
 * OBSERVED to misdescribe a Chorus pane, with the observation recorded.
 *
 * D4 (2026-07-27): `CLAUDE_CODE_CHILD_SESSION` and
 * `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE` were both confirmed to exist as
 * strings inside the installed `claude.exe` (26 and 6 occurrences) rather than
 * taken from the on-screen message alone. The force-persistence override is
 * deliberately NOT set: it treats the symptom, and would go on suppressing the
 * warning if a FUTURE, genuine reason to skip persistence ever arose. Removing
 * the false premise leaves the CLI's own default — save — in charge.
 */
export const HOST_AGENT_SESSION_VARS: readonly string[] = [
  'CLAUDE_CODE_CHILD_SESSION', // the observed cause; see above
  // The launching session's own ids. Stripped WITH the marker rather than
  // after it, because fixing the marker alone would turn "no transcript" into
  // a worse bug: several panes inheriting one session id, each believing it is
  // the same session, writing over one another's transcript.
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_HOST_SESSION_ID',
  // How the LAUNCHER was entered (`sdk-ts`, `cli`, …). A pane is an interactive
  // terminal; inheriting the launcher's value mislabels it at its own source.
  'CLAUDE_CODE_ENTRYPOINT'
]

/**
 * Applied to the parent env ONCE, before either branch reads it, so the two
 * policies cannot disagree about it — the F28/D54 lesson, applied structurally
 * rather than repeated in two places. The allow-list branch already excluded
 * these by omission; doing it here makes that a property of the function
 * instead of an accident of which names are on the allow-list.
 */
function stripHostAgentSessionVars(parentEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out = { ...parentEnv }
  for (const name of HOST_AGENT_SESSION_VARS) delete out[name]
  return out
}

export interface ComposeInput {
  /** The parent environment, passed in so this function stays pure. */
  readonly parentEnv: NodeJS.ProcessEnv
  /** Adapter-declared names to preserve beyond the baseline. */
  readonly requiredEnvVars: readonly string[]
  /** Adapter-declared non-secret additions. */
  readonly envAdditions: Readonly<Record<string, string>>
  /** The injected credential(s). EMPTY means this is a no-credential launch,
   *  and that distinction — not a boolean flag — is what selects the policy. */
  readonly secretEnv: Readonly<Record<string, string>>
}

/**
 * Env policy has ONE owner — main (D34(d)) — and this function is the whole
 * policy. It is pure: the environment arrives as a PARAMETER, because a
 * function that reads process.env internally is untestable, and this is the
 * function that most needs testing.
 */
export function composeChildEnv(input: ComposeInput): Record<string, string> {
  const { requiredEnvVars, envAdditions, secretEnv } = input
  // The launcher's session identity is removed BEFORE the branch, so neither
  // policy can pass it on. See HOST_AGENT_SESSION_VARS for what and why.
  const parentEnv = stripHostAgentSessionVars(input.parentEnv)

  // ── D33 resolution (c): NO CREDENTIAL → INHERIT WHOLESALE ──────────────
  // Ambient keys riding along on a no-profile launch is today's behavior and
  // stays: this feature adds a way to be explicit, it does not take away the
  // developer's own environment. Applying the allow-list here would be a
  // silent behavior change to every existing session in the app.
  if (Object.keys(secretEnv).length === 0) {
    // D54: still "inherit wholesale" — resolution (c) is about NOT stripping
    // the developer's ambient environment, and nothing is stripped here. Two
    // rendering constants are imposed on top. Pinning only on the credential
    // path would leave the COMMON path inheriting TERM=dumb and make the two
    // policies render differently, which is the F28 shape.
    return { ...parentEnv, ...PINNED_ENV_VARS } as Record<string, string>
  }

  // ── Credential-bearing → CONSTRUCTED ALLOW-LIST ────────────────────────
  const out: Record<string, string> = {}
  for (const name of [...BASELINE_ENV_VARS, ...requiredEnvVars]) {
    const v = parentEnv[name]
    // Skip absent vars rather than emitting `undefined`, which node-pty would
    // stringify into the literal text "undefined".
    if (typeof v === 'string') out[name] = v
  }
  Object.assign(out, PINNED_ENV_VARS) // D54: beats anything INHERITED…
  Object.assign(out, envAdditions) // …but an adapter that declares TERM wins,
  Object.assign(out, secretEnv) //   which leaves F28's per-adapter option open.
  return out
}

/** D34(e) precedence: a provider's env_var_name override beats the adapter's
 *  AuthMethodDefinition.requiredEnvVar default. Null from both means this auth
 *  method injects nothing — a subscription method, or an adapter whose API-key
 *  variable could not be D4-verified (in which case api_key auth must be
 *  refused rather than guessed at). */
export function resolveEnvVarName(
  providerOverride: string | null,
  adapterDefault: string | null
): string | null {
  return providerOverride ?? adapterDefault
}
