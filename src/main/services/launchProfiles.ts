import {
  MANAGEMENT_AUTH_MODE,
  effortLevelSchema,
  permissionModeSchema,
  type EffortLevel,
  type PermissionMode
} from '../../shared/ipc'

/**
 * Task 3a-5 / D43: the PURE half of launch profiles — the credentialed
 * predicate, profile resolution (including 3a-4's model precedence), the
 * create/update validators, and the default label.
 *
 * No `electron`, no `fetch`, no `node:fs`, no storage, NO CLOCK. Precedent:
 * vaultCore.ts, computeRestoreSet (restore.ts), composeChildEnv (env.ts),
 * attributionCore.ts (3a-3), modelCatalogCore.ts (3a-4).
 *
 * Everything in this module is a DECISION; everything in storage.ts is
 * rows-in-rows-out; everything in ipc.ts is wiring.
 *
 * ⚠ THE ONE THING THIS MODULE MAY NEVER LEARN TO DO. It never sees plaintext,
 * by construction: a profile stores a credential PROFILE ID, and resolution
 * carries that id and the credential's LABEL and nothing else. The unit test
 * asserts over the resolution's full KEY SET (the 3-2 discipline) so a future
 * field cannot smuggle one in.
 */

/**
 * The "credentialed, but there is no profile that reproduces it" pointer.
 * Deliberately NOT a uuid, so it can never collide with a real profile id, and
 * deliberately DOES NOT RESOLVE.
 *
 * ⚠ IT COVERS TWO POPULATIONS, and it must cover both or the retirement
 * REINTRODUCES THE F26 FAILURE IT EXISTS TO PRESERVE AGAINST:
 *
 *  1. THE LEGACY ROWS — every session named by the retired
 *     `credentialed_sessions` settings list, written by v10's data migration.
 *     That list recorded session ids and NOTHING ELSE — no profile, no
 *     provider, no credential — so there is no data from which to synthesize a
 *     launch profile, and synthesizing one would put a fake row in the user's
 *     picker.
 *
 *  2. ⚠ A LAUNCH ON A BARE CREDENTIAL, WITH NO PROFILE — still a first-class
 *     path (D33 clause 9 / the 3-6 dialog flow, which 3a-5 deliberately does
 *     not remove). Such a session IS credentialed but has no profile to point
 *     at. Writing NULL for it would make `sessionIsCredentialed` return FALSE
 *     and the restore engine would relaunch it KEYLESS — silently running the
 *     agent on ambient credentials while the user believes it runs on their
 *     key. That is exactly F26, and exactly what Task 3-6's global list was
 *     protecting against.
 *
 * An unresolvable pointer means "Chorus cannot prove this session was keyless",
 * which the fail-safe predicate reads as credentialed. Both populations are
 * that same statement, so both get this same value.
 *
 * ⚠ NOTHING SPECIAL-CASES THIS VALUE. It flows through the ordinary
 * unresolvable-pointer path, so a legacy row, a bare-credential row and a
 * deleted-profile row all behave identically — which is what makes the
 * retirement honest, and is asserted by a named unit test.
 */
export const LEGACY_CREDENTIALED_PROFILE_ID = 'legacy-credentialed'

/** A saved profile may not pin a transient worktree row. */
export type SavedWorkspaceMode = 'current-tree' | 'new-worktree'

/* ------------------------------------------------------------------ */
/* Structural row views — deliberately minimal, so the core depends on */
/* shapes rather than on Drizzle inference or the storage layer.       */
/* ------------------------------------------------------------------ */

export interface ProfileRowLite {
  readonly id: string
  readonly label: string
  readonly agent: string
  readonly providerId: string | null
  readonly credentialProfileId: string | null
  readonly model: string | null
  readonly effort: string | null
  /** D179: the MODEL'S OWN effort (an opencode variant name). Free text at this
   *  layer for the same reason `effort` is — the row is whatever the DB holds,
   *  and narrowing happens where the vocabulary is known. */
  readonly modelEffort: string | null
  readonly permissionMode: string | null
  readonly workspaceMode: string
  readonly envJson: string | null
}

export interface ProviderRowLite {
  readonly id: string
  readonly name: string
  readonly adapterType: string
  /** D42 operational note: 'management' is an ACCOUNT-LEVEL credential class
   *  that cannot do inference, so it can never back a launch. */
  readonly authMode: string
  /** v6/D48: the route's DEFAULT model — precedence rank 2, not an authority. */
  readonly model: string | null
}

export interface CredentialRowLite {
  readonly id: string
  readonly providerId: string
  readonly label: string
  readonly unavailableSince: string | null
}

/* ------------------------------------------------------------------ */
/* 1. The fail-safe predicate                                          */
/* ------------------------------------------------------------------ */

/**
 * Does this session hold a credential — i.e. must it NEVER be auto-restored
 * keyless? Replaces Task 3-6's global `credentialed_sessions` settings list
 * (D49): the fact is now DERIVED from the profile the session launched under,
 * per-session and therefore per-project, which retires the Phase-3-only
 * global-scoping expedient the roadmap flagged.
 *
 * ⚠ FAIL SAFE, AND THIS IS THE WHOLE DESIGN. An unresolvable pointer means
 * Chorus CANNOT PROVE the session was keyless, and the only safe reading of
 * "cannot prove" is "do not restore it keyless" (F26's failure shape, which
 * this phase has already paid for once).
 *
 * ⚠ DO NOT "SIMPLIFY" THE `undefined` BRANCH TO `false`. It is a one-character
 * change that compiles, passes every happy-path test, and silently restores
 * credentialed sessions keyless. There is a named unit test that fails against
 * exactly that inversion.
 */
export function sessionIsCredentialed(
  launchProfileId: string | null,
  lookup: (id: string) => { readonly credentialProfileId: string | null } | undefined
): boolean {
  // No profile at all: this session was launched without one, so there was no
  // credential to lose. Restorable.
  if (launchProfileId === null) return false
  const profile = lookup(launchProfileId)
  // Deleted profile, or the legacy sentinel. FAIL SAFE.
  if (profile === undefined) return true
  return profile.credentialProfileId !== null
}

/* ------------------------------------------------------------------ */
/* 2. Resolution                                                        */
/* ------------------------------------------------------------------ */

export interface ResolvedLaunchPlan {
  readonly profileId: string
  readonly agent: string
  /**
   * 3a-4's normative precedence, resolved HERE:
   *   rank 1  profile.model            (the choice for this launch)
   *   rank 2  provider.model           (the route's DEFAULT, v6/D48)
   *   rank 3  null                     (no -m emitted at all)
   * ⚠ NEVER written back to the profile row. Copying the route default into
   * the profile is how a second home for "which model" gets created by
   * accident — which is the exact failure D48 exists to prevent.
   */
  readonly model: string | null
  readonly providerId: string | null
  readonly credentialProfileId: string | null
  readonly workspaceMode: SavedWorkspaceMode
  readonly envAdditions: Readonly<Record<string, string>>
  /** An EffortOption.id (3a-4). Flows into LaunchOptions.effort untouched —
   *  this module maps NOTHING onto a CLI flag and touches no adapter. */
  readonly effort: EffortLevel | null
  /**
   * D179: the MODEL'S OWN effort, flowing into `LaunchOptions.modelEffort`
   * untouched.
   *
   * ⚠ IT IS NOT NARROWED AGAINST A VOCABULARY HERE, AND THAT IS THE ONE
   * DIFFERENCE FROM ITS TWO NEIGHBOURS. `effort` and `permissionMode` are
   * checked against sets this app owns; the words this field can hold belong to
   * a MODEL, and nothing in main holds a list of them for every model a
   * provider might publish. The check that matters happens where the fact
   * lives: a value only ever reaches the row through `modelEffortSchema` (the
   * charset guard), and opencode itself discards a name the chosen model does
   * not expose (F99). Inventing a set here would either be a second home for
   * the catalog or a list that goes stale the day a provider ships a rung.
   */
  readonly modelEffort: string | null
  /**
   * ⚠ STOPPED BEING INERT ON 2026-08-14. 3a-5 created this field with the
   * comment "stored by 3a-5, consumed by nothing in 3a-5", and it stayed
   * `string | null` free text for exactly that reason. It now flows into
   * `LaunchOptions.permissionMode` and onto a CLI flag, so it is narrowed to
   * the app vocabulary here — an out-of-vocabulary row degrades to null and the
   * ADAPTER'S DEFAULT applies, which is the same treatment `effort` gets one
   * line up and the reason a hand-edited DB cannot put an unknown word in argv.
   */
  readonly permissionMode: PermissionMode | null
}

export type ProfileResolution =
  | { readonly ok: true; readonly plan: ResolvedLaunchPlan }
  /**
   * Not a throw, and NOT a hidden row: the picker SHOWS this profile, disables
   * it, and renders `reason` verbatim. A launch profile is a thing the USER
   * NAMED — a named entry that silently vanishes is worse than one that says
   * why it cannot launch. (This deliberately differs from 3-6's
   * `eligibleProfiles`, which HIDES unavailable CREDENTIAL profiles; those are
   * plumbing, not user-named rows.)
   */
  | { readonly ok: false; readonly reason: string }

/**
 * ⚠ DERIVED from 3a-4's `effortLevelSchema`, never re-listed. Writing
 * `['fast','balanced','deep','max']` here would be a SECOND HOME for the effort
 * vocabulary — the exact two-homes failure D48 exists to prevent, in the task
 * whose headline output is a one-home ruling. If 3a-4's ladder ever changes,
 * this follows it for free and cannot silently disagree.
 */
const EFFORT_LEVELS: ReadonlySet<string> = new Set(effortLevelSchema.options)

/** Same rule, same reason, for the permission vocabulary. DERIVED, never
 *  re-listed — the moment `permissionModeSchema` grows a rung this follows it. */
const PERMISSION_MODES: ReadonlySet<string> = new Set(permissionModeSchema.options)

/**
 * Resolve a saved profile into a launch plan, or an authored refusal.
 *
 * Refusal messages are LABEL-ONLY, mirroring `resolveCredential`'s discipline:
 * no URL, no env var name or value, no key fragment ever reaches a message.
 */
export function resolveLaunchProfile(
  profile: ProfileRowLite,
  provider: ProviderRowLite | null,
  credential: CredentialRowLite | null
): ProfileResolution {
  // The FK guarantees these first two cannot arise through the app's own
  // delete paths (count-and-refuse runs first). They are guards against a
  // hand-edited database and against a future path that forgets to count —
  // they cost nothing, and they are the reason the fail-safe predicate never
  // has to guess.
  if (profile.providerId !== null && provider === null) {
    return { ok: false, reason: 'The route for this profile no longer exists.' }
  }
  if (profile.credentialProfileId !== null && credential === null) {
    return { ok: false, reason: 'The credential for this profile no longer exists.' }
  }
  if (provider !== null && provider.adapterType !== profile.agent) {
    return {
      ok: false,
      reason: `This profile targets ${profile.agent} but its route '${provider.name}' does not.`
    }
  }
  // ⚠ D42's operational note, enforced HERE too. A management route holds an
  // ACCOUNT-LEVEL credential that mints and revokes keys and CANNOT do
  // inference, so a launch profile naming one can never launch anything. It is
  // shown, disabled and explained rather than silently launching credential-
  // less on a route it cannot use — which is what a profile with a null
  // credential on a management route would otherwise quietly do.
  if (provider !== null && provider.authMode === MANAGEMENT_AUTH_MODE) {
    return {
      ok: false,
      reason: `Route '${provider.name}' is an OpenRouter management key and cannot launch an agent.`
    }
  }
  if (credential !== null && credential.providerId !== profile.providerId) {
    return {
      ok: false,
      reason: `Credential '${credential.label}' does not belong to this profile's route.`
    }
  }
  // D33 clause 8: refuse BY LABEL, and note the caller must not re-attempt
  // decryption for such a row.
  if (credential !== null && credential.unavailableSince !== null) {
    return {
      ok: false,
      reason: `Credential '${credential.label}' is unavailable — re-enter it in Settings.`
    }
  }
  if (profile.workspaceMode !== 'current-tree' && profile.workspaceMode !== 'new-worktree') {
    return {
      ok: false,
      reason: 'This profile has an unsupported workspace mode — recreate it.'
    }
  }

  const env = parseEnvJson(profile.envJson)
  if (!env.ok) return { ok: false, reason: env.reason }

  return {
    ok: true,
    plan: {
      profileId: profile.id,
      agent: profile.agent,
      // Rank 1 -> rank 2 -> nothing. Resolved, never persisted.
      model: profile.model ?? provider?.model ?? null,
      providerId: profile.providerId,
      credentialProfileId: profile.credentialProfileId,
      workspaceMode: profile.workspaceMode,
      envAdditions: env.value,
      effort: profile.effort !== null && EFFORT_LEVELS.has(profile.effort)
        ? (profile.effort as EffortLevel)
        : null,
      // D179: passed through as stored — see the field's docblock for why this
      // one is not narrowed against a set the way its neighbours are.
      modelEffort: profile.modelEffort,
      permissionMode:
        profile.permissionMode !== null && PERMISSION_MODES.has(profile.permissionMode)
          ? (profile.permissionMode as PermissionMode)
          : null
    }
  }
}

/* ------------------------------------------------------------------ */
/* 3. Validators                                                        */
/* ------------------------------------------------------------------ */

export interface ProfileWriteInput {
  readonly label: string
  readonly agent: string
  readonly providerId: string | null
  readonly credentialProfileId: string | null
  readonly model: string | null
  readonly effort: string | null
  /** D179 — see `ProfileRowLite.modelEffort`. */
  readonly modelEffort: string | null
  readonly permissionMode: string | null
  readonly workspaceMode: string
  readonly envJson: string | null
}

export type ShapeCheck = { readonly ok: true } | { readonly ok: false; readonly reason: string }

/**
 * Create/update shape validation. Called BEFORE any insert so every refusal is
 * an authored message, never a reverse-engineered SQLite error.
 *
 * `containsSecret` is INJECTED rather than imported so this module stays free
 * of the logger (and therefore of pino and of any transport). It is always
 * `scrubSecrets`-backed at the call site — ONE pattern list, one home, the
 * `extra_headers_json` precedent (`providerSecretRefusal` in ipc.ts).
 */
export function validateProfileShape(
  input: ProfileWriteInput,
  provider: ProviderRowLite | null,
  containsSecret: (text: string) => boolean
): ShapeCheck {
  const label = input.label.trim()
  if (label.length < 1 || label.length > 120) {
    return { ok: false, reason: 'A launch profile needs a name of 1–120 characters.' }
  }
  if (input.workspaceMode === 'existing-worktree') {
    return {
      ok: false,
      reason: 'A saved profile cannot pin an existing worktree — pick it at launch instead.'
    }
  }
  if (input.workspaceMode !== 'current-tree' && input.workspaceMode !== 'new-worktree') {
    return { ok: false, reason: 'A launch profile needs a valid workspace mode.' }
  }
  // §2.3: `agent` is authoritative even when a route is present (provider_id is
  // nullable, so a route-less profile has nowhere else to record it). Drift is
  // closed HERE — one authoritative field, one validator, no hope.
  if (input.providerId !== null) {
    if (provider === null) return { ok: false, reason: 'That route no longer exists.' }
    // Refused at CREATE as well as at resolve: a profile that can never launch
    // should not become a row the user has to discover is dead.
    if (provider.authMode === MANAGEMENT_AUTH_MODE) {
      return {
        ok: false,
        reason: `Route '${provider.name}' is an OpenRouter management key and cannot launch an agent.`
      }
    }
    if (provider.adapterType !== input.agent) {
      return {
        ok: false,
        reason: `Route '${provider.name}' is not a ${input.agent} route.`
      }
    }
  }
  // A credential without a route is meaningless: the credential's own provider
  // IS the route.
  if (input.credentialProfileId !== null && input.providerId === null) {
    return { ok: false, reason: 'Pick a route before picking a credential for it.' }
  }
  if (input.effort !== null && !EFFORT_LEVELS.has(input.effort)) {
    return { ok: false, reason: 'That effort level is not one this app offers.' }
  }
  if (input.permissionMode !== null && !PERMISSION_MODES.has(input.permissionMode)) {
    return { ok: false, reason: 'That permission mode is not one this app offers.' }
  }
  // D179: the CHARSET, not a vocabulary — the value is a MODEL'S own word and
  // this layer holds no list of those (see `ResolvedLaunchPlan.modelEffort`).
  // It is checked at all because the row it lands in is written into another
  // tool's config file, and a hand-built request is the one path into it that
  // did not already pass `modelEffortSchema`.
  if (input.modelEffort !== null && !/^[a-z0-9_-]{1,40}$/.test(input.modelEffort)) {
    return { ok: false, reason: 'That is not a valid model effort.' }
  }
  const env = parseEnvJson(input.envJson)
  if (!env.ok) return { ok: false, reason: env.reason }
  for (const [k, v] of Object.entries(env.value)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) {
      return { ok: false, reason: `'${k}' is not a valid environment variable name.` }
    }
    // The extra_headers_json precedent: if scrubbing changes it, it carries a
    // known key shape and must not be stored in plaintext in a settings row.
    if (containsSecret(v)) {
      return {
        ok: false,
        reason: `The value for '${k}' looks like a secret — keys belong in a credential, not in a profile's environment.`
      }
    }
  }
  return { ok: true }
}

/**
 * D43: "the label — defaulted to `<provider name>/<model display name>` — stays
 * freely renameable."
 *
 * `OpenRouter/moonshotai/kimi-k3` is an ugly default and is still correct: it is
 * the user's to rename, and generating something prettier by parsing model
 * slugs would bake a vendor-specific assumption into a label the user controls.
 * A route-less profile has no provider name, so it names the agent instead.
 *
 * ⚠ The label is a DEFAULT the user immediately owns. It is NEVER a key.
 */
export function defaultProfileLabel(
  providerName: string | null,
  model: string | null,
  agent: string
): string {
  const left = providerName ?? agent
  return model === null ? left : `${left}/${model}`
}

/* ------------------------------------------------------------------ */

type EnvParse =
  | { readonly ok: true; readonly value: Readonly<Record<string, string>> }
  | { readonly ok: false; readonly reason: string }

/** A flat object of string values, ≤ 32 keys. A non-object, an array, a nested
 *  object and a non-string value are all refused — an env block is strings. */
function parseEnvJson(envJson: string | null): EnvParse {
  if (envJson === null || envJson.trim() === '') return { ok: true, value: {} }
  let parsed: unknown
  try {
    parsed = JSON.parse(envJson)
  } catch {
    return { ok: false, reason: 'This profile’s environment settings are not valid JSON.' }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'A profile’s environment must be a set of name/value pairs.' }
  }
  const entries = Object.entries(parsed as Record<string, unknown>)
  if (entries.length > 32) {
    return { ok: false, reason: 'A profile may carry at most 32 environment values.' }
  }
  const out: Record<string, string> = {}
  for (const [k, v] of entries) {
    if (typeof v !== 'string') {
      return { ok: false, reason: `The value for '${k}' must be text.` }
    }
    out[k] = v
  }
  return { ok: true, value: out }
}
