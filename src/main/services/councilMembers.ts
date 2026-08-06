import { MANAGEMENT_AUTH_MODE, councilRoleSchema, type CouncilRole } from '../../shared/ipc'
import { failureMessage } from './vaultCore'

/**
 * Task 3b-2 / D62: the PURE half of council members — D56's model-precedence
 * order, the resolve-time gate, the create/update validator, and the default
 * label.
 *
 * No `electron`, no `fetch`, no `node:fs`, no storage, NO CLOCK. Precedent and
 * direct model: launchProfiles.ts (3a-5), whose shape this file mirrors.
 *
 * Everything in this module is a DECISION; everything in storage.ts is
 * rows-in-rows-out; everything in ipc.ts is wiring.
 *
 * ⚠ THE ONE THING THIS MODULE MAY NEVER LEARN TO DO. It never sees plaintext,
 * by construction: a member stores a credential PROFILE ID, and resolution
 * carries that id and the credential's LABEL and nothing else. The unit test
 * asserts over the resolution's full KEY SET (the 3-2 discipline) so a future
 * field cannot smuggle one in.
 *
 * ⚠ AND THE ONE SHAPE IT MAY NEVER GROW. There is no `providerId` and no
 * `baseUrl` on a member, here or in the row. The route has ONE home —
 * `provider_configs` (D48) — and `credential_profiles.provider_id` already
 * points a credential at it, so A MEMBER NAMES A ROUTE BY NAMING A CREDENTIAL.
 * `launch_profiles` carries both columns only because D33 clause 9 makes a
 * route-with-no-credential first class; a council member that cannot
 * authenticate cannot deliberate, so that case does not exist here and two
 * columns that could disagree would be a bug class, not a convenience.
 */

/* ------------------------------------------------------------------ */
/* Structural row views — deliberately minimal, and deliberately NOT   */
/* launchProfiles.ts's. That module's ProviderRowLite carries          */
/* `adapterType`, which a council member has no business caring about: */
/* a member is not an agent CLI and never resolves one. Each pure core */
/* depends on the shapes IT needs, never on Drizzle inference or on    */
/* the storage layer.                                                  */
/* ------------------------------------------------------------------ */

export interface MemberRowLite {
  readonly id: string
  readonly label: string
  /** NOT NULLABLE, and the table's only REFERENCES. */
  readonly credentialProfileId: string
  /** D56 rank 1. NULL = inherit the route's default. */
  readonly model: string | null
  /** Free-text in the column; validated against councilRoleSchema here. */
  readonly role: string
  readonly paramsJson: string | null
}

export interface CouncilProviderRowLite {
  readonly id: string
  readonly name: string
  /** D42's operational note: 'management' is an ACCOUNT-LEVEL credential class
   *  that cannot do inference, so it can never back a deliberation. */
  readonly authMode: string
  /** v6/D48: the route's DEFAULT model — precedence rank 2, not an authority. */
  readonly model: string | null
}

export interface CouncilCredentialRowLite {
  readonly id: string
  readonly providerId: string
  readonly label: string
  readonly unavailableSince: string | null
}

/* ------------------------------------------------------------------ */
/* 1. D56's precedence order — THE ONLY PLACE IT IS EXPRESSED          */
/* ------------------------------------------------------------------ */

/**
 * Which model does this member speak on?
 *
 *   rank 1  member.model     — the choice for THIS member
 *   rank 2  provider.model   — this route's DEFAULT (v6/D48)
 *   rank 3  null             — nothing emitted; the caller decides
 *
 * D56, normative, and expressed HERE and nowhere else in the council code. In
 * particular `model_catalog` IS NOT IN THIS ORDER — it is a list of what
 * exists, never an authority over either home.
 *
 * ⚠ THE RETURN VALUE IS NEVER WRITTEN BACK TO THE MEMBER ROW. Copying rank 2
 * into rank 1 is how a second home for "which model" gets created by accident,
 * and it is the exact failure D48 exists to prevent. A member with a NULL model
 * must STAY NULL in the database and inherit at read time, every time — which
 * is why the wire carries `model` and `resolvedModel` as two separate fields
 * rather than one collapsed answer.
 */
export function resolveMemberModel(
  member: Pick<MemberRowLite, 'model'>,
  provider: Pick<CouncilProviderRowLite, 'model'> | null
): string | null {
  return member.model ?? provider?.model ?? null
}

/* ------------------------------------------------------------------ */
/* 2. Resolution — the RESOLVE-side half of the management refusal     */
/* ------------------------------------------------------------------ */

export interface ResolvedCouncilMember {
  readonly memberId: string
  readonly credentialProfileId: string
  /** D56's answer, resolved — never persisted. */
  readonly model: string | null
  readonly role: CouncilRole
  readonly params: Readonly<Record<string, unknown>>
}

export type MemberResolution =
  | { readonly ok: true; readonly member: ResolvedCouncilMember }
  /**
   * Not a throw, and NOT a hidden row: the Settings list SHOWS this member,
   * disables it, and renders `reason` verbatim. A council member is a thing the
   * USER NAMED — a named entry that silently vanishes is worse than one that
   * says why it cannot deliberate. (Same ruling as resolveLaunchProfile, and
   * deliberately unlike 3-6's `eligibleProfiles`, which HIDES unavailable
   * CREDENTIAL profiles; those are plumbing, not user-named rows.)
   */
  | { readonly ok: false; readonly reason: string }

/**
 * Resolve a saved member into something a run could use, or an authored
 * refusal.
 *
 * ⚠ THIS IS THE SECOND HALF OF THE MANAGEMENT REFUSAL, AND IT IS NOT OPTIONAL.
 * `validateMemberShape` refuses a management route at CREATE; this function
 * refuses it again at RESOLVE. Both, not either — and D62 records why: Task
 * 3a-5 shipped exactly this defect for `launch_profiles`, where a profile
 * against a management route was accepted, RENDERED AS LAUNCHABLE, and would
 * have launched credential-less on a route that cannot do inference.
 *
 * `provider_configs.auth_mode` is an UNCONSTRAINED TEXT column, so a management
 * value can exist in the database before any UI produces it, and main never
 * trusts the renderer. A create-time-only check is defeated by a hand-edited
 * row; a resolve-time-only check renders a member as usable and fails at the
 * worst possible moment.
 *
 * Refusal messages are LABEL-ONLY, mirroring `resolveCredential`'s discipline:
 * no URL, no env var name or value, no key fragment ever reaches a message.
 */
export function resolveCouncilMember(
  member: MemberRowLite,
  provider: CouncilProviderRowLite | null,
  credential: CouncilCredentialRowLite | null
): MemberResolution {
  // The FK guarantees this cannot arise through the app's own delete paths
  // (count-and-refuse runs first). It is a guard against a hand-edited database
  // and against a future path that forgets to count — it costs nothing.
  if (credential === null) {
    return { ok: false, reason: 'The credential for this member no longer exists.' }
  }
  // `credential_profiles.provider_id` carries its own enforced FK, so a missing
  // route here means the database was edited by hand.
  if (provider === null) {
    return { ok: false, reason: `The route for credential '${credential.label}' no longer exists.` }
  }
  // ⚠ THE RESOLVE-SIDE MANAGEMENT REFUSAL. Wording mirrors resolveCredential's
  // own pre-decrypt refusal in ipc.ts — one vocabulary, named by LABEL.
  if (provider.authMode === MANAGEMENT_AUTH_MODE) {
    return {
      ok: false,
      reason: `Credential '${credential.label}' is an OpenRouter management key and cannot be used by a council member.`
    }
  }
  // D33 clause 8: refuse BY LABEL, and note the caller must not re-attempt
  // decryption for such a row. The wording is vaultCore's, IMPORTED rather than
  // re-typed — one home for the failure vocabulary.
  if (credential.unavailableSince !== null) {
    return { ok: false, reason: failureMessage('undecryptable', credential.label) }
  }
  // A hand-edited role. Refused rather than coerced: a member whose role nobody
  // can name cannot be placed in a deliberation.
  const role = councilRoleSchema.safeParse(member.role)
  if (!role.success) {
    return { ok: false, reason: 'This member has an unrecognised role — recreate it.' }
  }
  return {
    ok: true,
    member: {
      memberId: member.id,
      credentialProfileId: member.credentialProfileId,
      // Rank 1 -> rank 2 -> nothing. RESOLVED, never persisted.
      model: resolveMemberModel(member, provider),
      role: role.data,
      params: parseMemberParams(member.paramsJson)
    }
  }
}

/* ------------------------------------------------------------------ */
/* 3. Validators                                                       */
/* ------------------------------------------------------------------ */

export interface MemberWriteInput {
  readonly label: string
  readonly credentialProfileId: string
  readonly model: string | null
  readonly role: string
  readonly paramsJson: string | null
}

export type ShapeCheck = { readonly ok: true } | { readonly ok: false; readonly reason: string }

/**
 * Create/update shape validation. Called BEFORE any insert so every refusal is
 * an authored message, never a reverse-engineered SQLite error.
 *
 * `existingLabels` is every OTHER member's label (the caller drops the row
 * being updated), so the UNIQUE(label) constraint stays a BACKSTOP and is never
 * the thing a user reads.
 *
 * `containsSecret` is INJECTED rather than imported so this module stays free
 * of the logger (and therefore of pino and of any transport). It is always
 * `scrubSecrets`-backed at the call site — ONE pattern list, one home, the
 * `extra_headers_json` precedent (`providerSecretRefusal` in ipc.ts).
 *
 * ⚠ AN UNAVAILABLE CREDENTIAL IS NOT REFUSED HERE, DELIBERATELY. Unavailability
 * is TRANSIENT — a successful replace clears it (F-5a) — so refusing at create
 * would make a recoverable state look permanent. It is refused at RESOLVE
 * instead, which is what renders the member shown-disabled-and-explained. A
 * MANAGEMENT ROUTE is the opposite: a permanent category error, refused at both
 * ends.
 */
export function validateMemberShape(
  input: MemberWriteInput,
  existingLabels: readonly string[],
  credential: CouncilCredentialRowLite | null,
  provider: CouncilProviderRowLite | null,
  containsSecret: (text: string) => boolean
): ShapeCheck {
  const label = input.label.trim()
  if (label.length < 1 || label.length > 120) {
    return { ok: false, reason: 'A council member needs a name of 1–120 characters.' }
  }
  // D43: the label is not the identity, but it IS the list, so duplicates are
  // unusable. Checked here so the refusal is a sentence somebody wrote.
  if (existingLabels.some((l) => l.trim().toLowerCase() === label.toLowerCase())) {
    return { ok: false, reason: `A council member named '${label}' already exists.` }
  }
  if (!councilRoleSchema.safeParse(input.role).success) {
    return { ok: false, reason: 'A council member is either a member or an arbiter.' }
  }
  if (credential === null) {
    return { ok: false, reason: 'That credential profile no longer exists.' }
  }
  if (provider === null) {
    return { ok: false, reason: `The route for credential '${credential.label}' no longer exists.` }
  }
  // ⚠ THE CREATE-SIDE MANAGEMENT REFUSAL. Refused at CREATE as well as at
  // resolve: a member that can never deliberate should not become a row the
  // user has to discover is dead. See resolveCouncilMember for the other half
  // and for why one without the other is 3a-5's defect (D62) repeated.
  if (provider.authMode === MANAGEMENT_AUTH_MODE) {
    return {
      ok: false,
      reason: `Credential '${credential.label}' is an OpenRouter management key and cannot be used by a council member.`
    }
  }
  // Main never trusts the renderer's pairing — though with no provider_id
  // column there is nothing for the user to get wrong, only a hand-edited row.
  if (credential.providerId !== provider.id) {
    return { ok: false, reason: `Credential '${credential.label}' does not belong to that route.` }
  }
  const params = parseParamsJson(input.paramsJson)
  if (!params.ok) return { ok: false, reason: params.reason }
  for (const [k, v] of Object.entries(params.value)) {
    // The extra_headers_json precedent: if scrubbing changes it, it carries a
    // known key shape and must not be stored in plaintext on a settings row.
    if (typeof v === 'string' && containsSecret(v)) {
      return {
        ok: false,
        reason: `The value for '${k}' looks like a secret — keys belong in a credential, not in a member's parameters.`
      }
    }
  }
  return { ok: true }
}

/**
 * D43's default label — `<route name>/<model>`, freely renameable afterwards.
 *
 * `OpenRouter/moonshotai/kimi-k3` is an ugly default and is still correct: it
 * is the user's to rename, and generating something prettier by parsing model
 * slugs would bake a vendor-specific assumption into a label the user controls.
 * A member with no model of its own names the route alone rather than borrowing
 * the route's default — SHOWING a rank-2 value in a rank-1 field is how the
 * back-write D56 forbids starts looking reasonable.
 *
 * ⚠ The label is a DEFAULT the user immediately owns. It is NEVER a key.
 */
export function defaultMemberLabel(providerName: string, modelDisplayName: string | null): string {
  return modelDisplayName === null || modelDisplayName.trim() === ''
    ? providerName
    : `${providerName}/${modelDisplayName}`
}

/* ------------------------------------------------------------------ */

export type ParamsParse =
  | { readonly ok: true; readonly value: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly reason: string }

/** A flat JSON object, ≤ 32 keys. A non-object, an array and a nested object
 *  are all refused — parameters are scalars a request body can carry.
 *
 *  ⚠ THE STRICT READER, and exported as such: `ipc.ts` merges a `max_tokens`
 *  patch into a stored object and must be able to tell "this does not parse"
 *  from "this parses to nothing". `parseMemberParams` below cannot make that
 *  distinction BY DESIGN — it answers `{}` to both — so a merge built on it
 *  would silently discard input a user typed. */
export function parseParamsJson(paramsJson: string | null): ParamsParse {
  if (paramsJson === null || paramsJson.trim() === '') return { ok: true, value: {} }
  let parsed: unknown
  try {
    parsed = JSON.parse(paramsJson)
  } catch {
    return { ok: false, reason: 'This member’s parameters are not valid JSON.' }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'A member’s parameters must be a set of name/value pairs.' }
  }
  const entries = Object.entries(parsed as Record<string, unknown>)
  if (entries.length > 32) {
    return { ok: false, reason: 'A member may carry at most 32 parameters.' }
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of entries) {
    if (v !== null && typeof v === 'object') {
      return { ok: false, reason: `The value for '${k}' must be a single value, not a structure.` }
    }
    out[k] = v
  }
  return { ok: true, value: out }
}

/**
 * The READ side of the same column, and deliberately a DIFFERENT function.
 *
 * ⚠ DEGRADES TO `{}` ON ANYTHING IT CANNOT UNDERSTAND, and never throws. Spec
 * §1.1 / D15(5), the `extra_headers_json` and `getWindowBounds` precedent: a
 * corrupt or hand-edited row must not be able to break a READ, because the read
 * is what renders the row that would let a user FIX it. The write path
 * (parseParamsJson above) is the strict one — that is where a bad value is
 * refused with a sentence.
 */
export function parseMemberParams(paramsJson: string | null): Readonly<Record<string, unknown>> {
  const parsed = parseParamsJson(paramsJson)
  return parsed.ok ? parsed.value : {}
}
