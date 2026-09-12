import type { EffortLevel, PermissionMode } from '../../shared/ipc'
import type { LaunchOptions } from './sessionManager'
import {
  resolveLaunchProfile,
  type CredentialRowLite,
  type ProfileRowLite,
  type ProviderRowLite,
  type ResolvedLaunchPlan
} from './launchProfiles'

/**
 * Task 10.1-1 (closes F115): the ONE definition of "the options a session
 * launches with", so that every path which starts a PTY composes them the same
 * way.
 *
 * ─── WHY THIS MODULE EXISTS ───────────────────────────────────────────────
 * FOUR code paths start a PTY and, before this module, only two of them built
 * launch options at all:
 *
 *   1. `session:launch`   (ipc.ts) — composed in full, payload over profile
 *   2. `session:relaunch` (ipc.ts) — composed in full, profile only
 *   3. `session:restart`  (ipc.ts) — composed NOTHING but `conversationBoundary`
 *   4. boot/lazy restore  (sessionManager.restore) — composed NOTHING
 *
 * Sites 1 and 2 were near-identical copies of the same four slices. Sites 3 and
 * 4 silently dropped `effort`, `modelEffort`, `permissionMode` and
 * `envAdditions`, so a restored or restarted pane came back configured as
 * though the user had chosen nothing.
 *
 * ⚠ THE SHARPEST CONSEQUENCE, AND IT MOVES IN THE PERMISSIVE DIRECTION. An
 * absent `permissionMode` does NOT mean "emit no flag" — it means "the
 * adapter's declared default", and claude's is `auto` (`claude.ts`'s
 * `defaultLevelId`). So a pane the user deliberately launched in Plan or Manual
 * came back in Auto. Closing F115 CHANGES SHIPPED BEHAVIOUR; it is a fix, but
 * it is a visible one.
 *
 * ─── ⚠ THIS MODULE IS SYNCHRONOUS, AND THE SYNCHRONICITY IS A SECURITY
 *     CONTROL RATHER THAN A STYLE CHOICE ──────────────────────────────────
 * The composition inside `session:relaunch` is `async` for exactly one reason:
 * it may resolve a CREDENTIAL, and that awaits the vault. Everything else —
 * `resolveLaunchProfile`, the four slices, the row lookups — is already
 * synchronous.
 *
 * `ipc.ts`'s relaunch handler states the invariant this protects: the distance
 * between restore and the vault "is ONE CARELESS `await` WIDE: if any part of
 * this logic is ever factored into a helper that restore() also calls, the
 * invariant is gone and NOTHING WILL FAIL TO COMPILE." **This module is that
 * factoring.** A synchronous return type is what makes the warning obsolete
 * instead of realised: `vault.decryptForLaunch` returns a Promise, so inside a
 * `(row) => LaunchOptions` signature it cannot be awaited and its result cannot
 * be read. The compiler now enforces what that comment could only ask for.
 *
 * Therefore NOTHING here composes `secrets`, `credential` or `route`. Those
 * stay in the two `ipc.ts` credential blocks, which spread this module's result
 * and add to it — reached only when a human asked for a launch.
 *
 * It is also safe to leave them out, not merely tidy: a credentialed session
 * never reaches sites 3 or 4. Restore heals it to `exited`, and restart refuses
 * it inline, both via `sessionIsCredentialed` (fail-safe TRUE on an
 * unresolvable pointer).
 *
 * ─── PURITY ───────────────────────────────────────────────────────────────
 * No `electron`, no `node:fs`, no `storage`, no `vault`, no `logger`, no clock.
 * Row lookups and the degrade report arrive as CALLBACKS, the shape
 * `sessionIsCredentialed` already established in `launchProfiles.ts`. That is
 * what lets the whole thing be unit-tested with three fakes, and it is why this
 * lives beside `launchProfiles.ts` rather than inside either of its neighbours:
 * `launchProfiles.ts`'s header promises it never sees plaintext, and
 * `LaunchOptions` names `secrets`/`credential` in its type; `SessionManager`'s
 * own comment says storage reaches it ONLY for the restore engine's heal and
 * status writes.
 *
 * ⚠ THE `LaunchOptions` IMPORT IS TYPE-ONLY IN BOTH DIRECTIONS and must stay
 * that way. Type-only imports erase, so there is no runtime cycle between this
 * module and `sessionManager.ts`. A value import in either file creates one,
 * and it presents as an undefined class at boot — not as a compile error.
 */

/**
 * The quarter of a resolved plan a session may be given back with NO HUMAN
 * PRESENT.
 *
 * ⚠ `credentialProfileId` — and therefore `secrets`, `credential` and `route` —
 * is deliberately NOT in this Pick. See the synchronicity note above: this type
 * is the other half of the same guard.
 */
export type ProfilePlanOptions = Pick<
  ResolvedLaunchPlan,
  'effort' | 'modelEffort' | 'permissionMode' | 'envAdditions'
>

/**
 * What the launch DIALOG chose, for the one caller that has a dialog.
 *
 * The rule is one rule, not three: the payload beats the profile, because the
 * payload is what the user is looking at while the profile is the default the
 * dialog prefilled. A `null` or absent override falls through to the profile's
 * value.
 */
export interface LaunchOverrides {
  readonly effort?: EffortLevel | null
  readonly modelEffort?: string | null
  readonly permissionMode?: PermissionMode | null
}

/**
 * Row lookups supplied by the caller, so this module never imports `storage`.
 * Precedent: `sessionIsCredentialed`'s own `lookup` parameter.
 */
export interface ProfileLookups {
  readonly launchProfile: (id: string) => ProfileRowLite | null
  readonly provider: (id: string) => ProviderRowLite | null
  readonly credential: (id: string) => CredentialRowLite | null
}

/** The minimum a caller must know about a session row to resolve its options. */
export interface LaunchOptionsRow {
  readonly id: string
  readonly launchProfileId: string | null
}

/**
 * ⚠ SYNCHRONOUS BY CONTRACT — see the module header. Do not widen this to a
 * Promise; the return type is the enforcement of the no-unattended-decrypt
 * invariant, not an incidental detail of the current implementation.
 */
export type LaunchOptionsResolver = (row: LaunchOptionsRow) => LaunchOptions

/**
 * Build the non-credential launch options from a resolved plan, applying the
 * dialog's overrides when there are any.
 *
 * ⚠ AN ABSENT VALUE PRODUCES AN OMITTED KEY, NEVER `key: undefined`, AND THE
 * COMPILER WILL NOT CATCH A REGRESSION HERE. `exactOptionalPropertyTypes` is
 * not set in this repo's TS config, so `{ effort: undefined }` typechecks
 * cleanly. It is nonetheless wrong, because the composed object is SPREAD into
 * larger objects at two call sites (`{ ...composed, conversationBoundary }` and
 * the credential blocks) — and on a spread an explicit `undefined` CLOBBERS the
 * value beneath it while an absent key does not. The unit tests assert
 * `'effort' in opts === false`; nothing else will notice.
 */
export function composeLaunchOptions(
  plan: ProfilePlanOptions,
  overrides?: LaunchOverrides
): LaunchOptions {
  const effortValue: EffortLevel | null = overrides?.effort ?? plan.effort
  const effortOpt: Pick<LaunchOptions, 'effort'> = effortValue ? { effort: effortValue } : {}

  // D179: the MODEL's own effort vocabulary. Same precedence as `effort` for
  // the same reason, and its floor is effort's ("emit nothing") rather than the
  // permission mode's ("the adapter's declared default"), because a model's
  // effort names a value no adapter can default to.
  const modelEffortValue: string | null = overrides?.modelEffort ?? plan.modelEffort
  const modelEffortOpt: Pick<LaunchOptions, 'modelEffort'> = modelEffortValue
    ? { modelEffort: modelEffortValue }
    : {}

  // ⚠ The FLOOR here differs from the two above and always has: an absent
  // permission mode means the ADAPTER'S DECLARED DEFAULT, resolved in the
  // adapter rather than here. That is precisely why dropping this field on
  // restore was a silent widening rather than a silent no-op.
  const permissionValue: PermissionMode | null = overrides?.permissionMode ?? plan.permissionMode
  const permissionOpt: Pick<LaunchOptions, 'permissionMode'> = permissionValue
    ? { permissionMode: permissionValue }
    : {}

  // An empty record omits the key, matching every call site's previous shape.
  const envOpt: Pick<LaunchOptions, 'envAdditions'> =
    Object.keys(plan.envAdditions).length > 0 ? { envAdditions: plan.envAdditions } : {}

  return { ...effortOpt, ...modelEffortOpt, ...permissionOpt, ...envOpt }
}

/**
 * Build the resolver the unattended paths use: session row in, launch options
 * out, no credential anywhere on the path.
 *
 * ⚠ EVERY FAILURE DEGRADES TO `{}` AND REPORTS — IT NEVER REFUSES AND NEVER
 * THROWS, and the asymmetry with `session:relaunch` is deliberate.
 * `session:relaunch` returns `{ ok: false, reason }` on an unresolvable profile
 * because a human clicked something and there is a dialog to show the reason
 * in. Restore has no UI and no user: refusing there would mean the pane does
 * not come back at all, which is a worse regression than the bug being fixed.
 * Degrading to exactly today's behaviour, plus one line in the log, is the
 * honest answer.
 *
 * A throw would be worse still: `restore()` spawns in a loop, so one bad
 * profile row must not be able to end the restore of every later session.
 *
 * @param onDegrade Reported, never thrown, and never logged from inside this
 *   module — there is no logger here. `resolveLaunchProfile`'s refusal reasons
 *   are safe to pass on: `launchProfiles.ts` states they are label-only by
 *   construction, carrying no URL, env var name, env value or key fragment.
 *   Do not widen what is handed to it.
 */
export function makeLaunchOptionsResolver(
  lookups: ProfileLookups,
  onDegrade: (sessionId: string, reason: string) => void
): LaunchOptionsResolver {
  return (row) => {
    // Never had a profile: there is nothing to lose and nothing to report. A
    // subscription or ambient-env launch lands here and always has.
    if (row.launchProfileId === null) return {}

    const profile = lookups.launchProfile(row.launchProfileId)
    if (!profile) {
      onDegrade(row.id, 'its launch profile no longer exists')
      return {}
    }

    const resolution = resolveLaunchProfile(
      profile,
      profile.providerId ? lookups.provider(profile.providerId) : null,
      profile.credentialProfileId ? lookups.credential(profile.credentialProfileId) : null
    )
    if (!resolution.ok) {
      onDegrade(row.id, resolution.reason)
      return {}
    }

    // ⚠ `resolution.plan` carries `credentialProfileId`, and it is dropped HERE
    // by the shape of `ProfilePlanOptions`. This is the last point on the
    // unattended path where a credential could have been reached, and it is not
    // reached: no await exists in this function, and none can be added without
    // changing `LaunchOptionsResolver`'s return type.
    return composeLaunchOptions(resolution.plan)
  }
}
