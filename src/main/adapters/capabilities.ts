import type { AgentCapabilities, ResolvedCredential } from './types'

/** Mutable view for building the merged result; the INPUT stays readonly. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] }

/**
 * Merge detected capabilities over an adapter's static declaration.
 *
 * The null/undefined distinction is MEANINGFUL and is the whole reason this is
 * a function rather than a spread (CR-3.1 risk 7):
 *   undefined -> the probe did not determine this; keep the static value.
 *   null      -> the probe determined the capability is ABSENT; override.
 * A naive `{...base, ...detected}` gets this right for `undefined` only by
 * accident of how the object was constructed, and wrong the moment a probe
 * builds its result with explicit `undefined` fields.
 *
 * Written as per-key writes rather than a Record<string, unknown> loop: the
 * loop's single `as AgentCapabilities` boundary cast does not compile under
 * this repo's TS 5.9 strict config (TS2352 — interfaces carry no implicit
 * index signature). The per-key form needs NO cast, admits no undeclared key,
 * and preserves the spec's semantics exactly.
 */
export function mergeCapabilities(
  base: AgentCapabilities,
  detected?: Partial<AgentCapabilities>
): AgentCapabilities {
  if (!detected) return base
  const out: Mutable<AgentCapabilities> = { ...base }
  if (detected.interactiveTerminal !== undefined) out.interactiveTerminal = detected.interactiveTerminal
  if (detected.worktreeSafe !== undefined) out.worktreeSafe = detected.worktreeSafe
  if (detected.skills !== undefined) out.skills = detected.skills
  if (detected.subscriptionLogin !== undefined) out.subscriptionLogin = detected.subscriptionLogin
  if (detected.apiKey !== undefined) out.apiKey = detected.apiKey
  if (detected.reasoningEffort !== undefined) out.reasoningEffort = detected.reasoningEffort
  if (detected.sessionResume !== undefined) out.sessionResume = detected.sessionResume
  if (detected.mcp !== undefined) out.mcp = detected.mcp
  if (detected.hooks !== undefined) out.hooks = detected.hooks
  return out
}

/**
 * The credential half of buildLaunch, shared by both shipped adapters:
 * a resolved credential contributes its value under its own env var name in
 * `secretEnv` — NEVER in `envAdditions`, so the non-secret half of a launch
 * request can never carry key material (D33: secret-distinguishable payloads).
 * `spec.credential` is always `undefined` in Phase 3; the seam is written and
 * unit-tested now so Task 3-6 inherits a tested path.
 */
export function buildSecretEnv(
  credential: ResolvedCredential | undefined
): Readonly<Record<string, string>> {
  return credential ? { [credential.envVarName]: credential.value } : {}
}
