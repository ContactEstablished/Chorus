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
  const { parentEnv, requiredEnvVars, envAdditions, secretEnv } = input

  // ── D33 resolution (c): NO CREDENTIAL → INHERIT WHOLESALE ──────────────
  // Exactly today's behavior (D5), preserved deliberately and permanently.
  // Ambient keys riding along on a no-profile launch is today's behavior and
  // stays: this feature adds a way to be explicit, it does not take away the
  // developer's own environment. Applying the allow-list here would be a
  // silent behavior change to every existing session in the app.
  if (Object.keys(secretEnv).length === 0) {
    return { ...parentEnv } as Record<string, string>
  }

  // ── Credential-bearing → CONSTRUCTED ALLOW-LIST ────────────────────────
  const out: Record<string, string> = {}
  for (const name of [...BASELINE_ENV_VARS, ...requiredEnvVars]) {
    const v = parentEnv[name]
    // Skip absent vars rather than emitting `undefined`, which node-pty would
    // stringify into the literal text "undefined".
    if (typeof v === 'string') out[name] = v
  }
  Object.assign(out, envAdditions)
  // Secrets last: an injected credential always wins over anything inherited
  // or added under the same name.
  Object.assign(out, secretEnv)
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
