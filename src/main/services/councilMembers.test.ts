import { describe, expect, it } from 'vitest'
import {
  defaultMemberLabel,
  parseMemberParams,
  resolveCouncilMember,
  resolveMemberModel,
  validateMemberShape,
  type CouncilCredentialRowLite,
  type CouncilProviderRowLite,
  type MemberRowLite,
  type MemberWriteInput
} from './councilMembers'

/* ------------------------------------------------------------------ */
/* fixtures — no real credential, no real key fragment, anywhere.       */
/* ------------------------------------------------------------------ */

const member = (over: Partial<MemberRowLite> = {}): MemberRowLite => ({
  id: 'm1',
  label: 'OR/Kimi K3',
  credentialProfileId: 'cred1',
  model: null,
  role: 'member',
  paramsJson: null,
  ...over
})

const provider = (over: Partial<CouncilProviderRowLite> = {}): CouncilProviderRowLite => ({
  id: 'prov1',
  name: 'OpenRouter',
  authMode: 'api_key',
  model: 'vendor/route-default',
  ...over
})

const credential = (over: Partial<CouncilCredentialRowLite> = {}): CouncilCredentialRowLite => ({
  id: 'cred1',
  providerId: 'prov1',
  label: 'A key label',
  unavailableSince: null,
  ...over
})

const writeInput = (over: Partial<MemberWriteInput> = {}): MemberWriteInput => ({
  label: 'My member',
  credentialProfileId: 'cred1',
  model: null,
  role: 'member',
  paramsJson: null,
  ...over
})

/** Stands in for scrubSecrets at the call site. */
const neverSecret = (): boolean => false
const alwaysSecret = (): boolean => true

/* ================================================================== */
/* resolveMemberModel — D56's three ranks, and nothing else.           */
/* ================================================================== */

describe('resolveMemberModel (D56, the only home for the order)', () => {
  it('rank 1: the member’s own model wins over the route default', () => {
    expect(resolveMemberModel(member({ model: 'vendor/member-choice' }), provider())).toBe(
      'vendor/member-choice'
    )
  })

  it('rank 2: a NULL member model inherits the route’s provider_configs.model', () => {
    expect(resolveMemberModel(member({ model: null }), provider())).toBe('vendor/route-default')
  })

  it('rank 3: NULL member model on a route with no default emits nothing', () => {
    expect(resolveMemberModel(member({ model: null }), provider({ model: null }))).toBeNull()
  })

  it('rank 3: no route at all emits nothing rather than guessing', () => {
    expect(resolveMemberModel(member({ model: null }), null)).toBeNull()
  })

  it('⚠ RESOLUTION DOES NOT MUTATE THE MEMBER — rank 2 is never back-written into rank 1', () => {
    const row = member({ model: null })
    const resolved = resolveMemberModel(row, provider())
    expect(resolved).toBe('vendor/route-default')
    // The column the database holds is STILL NULL. This is the assertion that
    // fails if anyone ever "helpfully" persists the inherited value — the exact
    // second-home failure D48 exists to prevent.
    expect(row.model).toBeNull()
  })
})

/* ================================================================== */
/* resolveCouncilMember — the RESOLVE half of the management refusal.  */
/* ================================================================== */

describe('resolveCouncilMember', () => {
  it('resolves a healthy member, carrying D56’s answer', () => {
    const r = resolveCouncilMember(member(), provider(), credential())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.member.model).toBe('vendor/route-default')
    expect(r.member.role).toBe('member')
    expect(r.member.memberId).toBe('m1')
  })

  it('⚠ REFUSES A MANAGEMENT ROUTE AT RESOLVE (D62 — the second half of the refusal)', () => {
    const r = resolveCouncilMember(member(), provider({ authMode: 'management' }), credential())
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toContain('management key')
    expect(r.reason).toContain('A key label')
  })

  it('a create-time-only check would be defeated by a hand-edited auth_mode: resolve still refuses', () => {
    // auth_mode is an UNCONSTRAINED TEXT column, so this row can exist in a
    // database no UI ever produced. Main never trusts what it reads either.
    const handEdited = provider({ authMode: 'management' })
    expect(validateMemberShape(writeInput(), [], credential(), handEdited, neverSecret).ok).toBe(false)
    expect(resolveCouncilMember(member(), handEdited, credential()).ok).toBe(false)
  })

  it('refuses an unavailable credential BY LABEL, in vaultCore’s vocabulary', () => {
    const r = resolveCouncilMember(
      member(),
      provider(),
      credential({ unavailableSince: '2026-07-26T00:00:00.000Z' })
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe(
      "Credential profile 'A key label' is unavailable: decryption failed. Re-enter the credential in Settings."
    )
  })

  it('refuses a member whose credential is gone (hand-edited DB; the FK stops the app’s own paths)', () => {
    const r = resolveCouncilMember(member(), provider(), null)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toContain('no longer exists')
  })

  it('refuses a member whose route is gone', () => {
    const r = resolveCouncilMember(member(), null, credential())
    expect(r.ok).toBe(false)
  })

  it('refuses an unrecognised role rather than coercing it', () => {
    const r = resolveCouncilMember(member({ role: 'moderator' }), provider(), credential())
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toContain('unrecognised role')
  })

  it('accepts the arbiter role', () => {
    const r = resolveCouncilMember(member({ role: 'arbiter' }), provider(), credential())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.member.role).toBe('arbiter')
  })

  it('⚠ THE KEY SET: a resolution carries ids, a model, a role and params — nothing else', () => {
    const r = resolveCouncilMember(member(), provider(), credential())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // The 3-2 discipline: assert the WHOLE key set, so a future field that
    // could carry key material cannot be added without failing here.
    expect(Object.keys(r.member).sort()).toEqual([
      'credentialProfileId',
      'memberId',
      'model',
      'params',
      'role'
    ])
  })

  it('no refusal message names a URL or an env var — labels only', () => {
    const cases = [
      resolveCouncilMember(member(), provider({ authMode: 'management' }), credential()),
      resolveCouncilMember(member(), provider(), credential({ unavailableSince: 'x' })),
      resolveCouncilMember(member(), null, credential()),
      resolveCouncilMember(member(), provider(), null)
    ]
    for (const c of cases) {
      expect(c.ok).toBe(false)
      if (c.ok) continue
      expect(c.reason).not.toContain('http')
      expect(c.reason).not.toContain('_API_KEY')
    }
  })
})

/* ================================================================== */
/* validateMemberShape — the four refusals the task doc names, plus.   */
/* ================================================================== */

describe('validateMemberShape', () => {
  it('accepts a well-formed member', () => {
    expect(validateMemberShape(writeInput(), [], credential(), provider(), neverSecret)).toEqual({
      ok: true
    })
  })

  it('refusal 1: an empty label', () => {
    const r = validateMemberShape(writeInput({ label: '   ' }), [], credential(), provider(), neverSecret)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toContain('1–120 characters')
  })

  it('refusal 1b: an over-long label', () => {
    const r = validateMemberShape(
      writeInput({ label: 'x'.repeat(121) }),
      [],
      credential(),
      provider(),
      neverSecret
    )
    expect(r.ok).toBe(false)
  })

  it('refusal 2: a duplicate label (the UNIQUE constraint stays a backstop)', () => {
    const r = validateMemberShape(
      writeInput({ label: 'Taken' }),
      ['Taken'],
      credential(),
      provider(),
      neverSecret
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe("A council member named 'Taken' already exists.")
  })

  it('refusal 2b: duplicate detection is case- and whitespace-insensitive', () => {
    const r = validateMemberShape(
      writeInput({ label: '  taken ' }),
      ['Taken'],
      credential(),
      provider(),
      neverSecret
    )
    expect(r.ok).toBe(false)
  })

  it('a rename to a label only THIS member holds is accepted (caller drops self)', () => {
    // D43: the label is freely renameable. The caller passes every OTHER
    // member's label, so re-saving the same name is not a duplicate.
    expect(
      validateMemberShape(writeInput({ label: 'Mine' }), ['Someone else'], credential(), provider(), neverSecret)
        .ok
    ).toBe(true)
  })

  it('refusal 3: an unknown credential', () => {
    const r = validateMemberShape(writeInput(), [], null, provider(), neverSecret)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toContain('no longer exists')
  })

  it('⚠ REFUSAL 4: a credential on a MANAGEMENT route, refused AT CREATE (D62)', () => {
    // The 3a-5 defect this task must not repeat: a row that can never do
    // inference must not become a row the user has to discover is dead.
    const r = validateMemberShape(
      writeInput(),
      [],
      credential(),
      provider({ authMode: 'management' }),
      neverSecret
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toContain('management key')
    expect(r.reason).toContain('A key label')
  })

  it('refuses an unknown role', () => {
    const r = validateMemberShape(writeInput({ role: 'chair' }), [], credential(), provider(), neverSecret)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toContain('member or an arbiter')
  })

  it('accepts arbiter', () => {
    expect(
      validateMemberShape(writeInput({ role: 'arbiter' }), [], credential(), provider(), neverSecret).ok
    ).toBe(true)
  })

  it('refuses a credential that does not belong to the route', () => {
    const r = validateMemberShape(
      writeInput(),
      [],
      credential({ providerId: 'other' }),
      provider(),
      neverSecret
    )
    expect(r.ok).toBe(false)
  })

  it('⚠ refuses a params value carrying a known key shape (the extra_headers_json precedent)', () => {
    const r = validateMemberShape(
      writeInput({ paramsJson: '{"system_hint":"not-a-real-key"}' }),
      [],
      credential(),
      provider(),
      alwaysSecret
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toContain('belong in a credential')
  })

  it('refuses params that are not valid JSON', () => {
    const r = validateMemberShape(writeInput({ paramsJson: '{oops' }), [], credential(), provider(), neverSecret)
    expect(r.ok).toBe(false)
  })

  it('refuses params that are an array rather than name/value pairs', () => {
    const r = validateMemberShape(writeInput({ paramsJson: '[1,2]' }), [], credential(), provider(), neverSecret)
    expect(r.ok).toBe(false)
  })

  it('refuses a nested params structure', () => {
    const r = validateMemberShape(
      writeInput({ paramsJson: '{"a":{"b":1}}' }),
      [],
      credential(),
      provider(),
      neverSecret
    )
    expect(r.ok).toBe(false)
  })

  it('accepts scalar params', () => {
    expect(
      validateMemberShape(
        writeInput({ paramsJson: '{"temperature":0.2,"top_p":1}' }),
        [],
        credential(),
        provider(),
        neverSecret
      ).ok
    ).toBe(true)
  })

  it('⚠ does NOT refuse an unavailable credential at create — that state is transient', () => {
    // A successful replace clears unavailable_since (F-5a), so refusing here
    // would make a recoverable state look permanent. It is refused at RESOLVE,
    // which is what renders the member shown-disabled-and-explained.
    const unavailable = credential({ unavailableSince: '2026-07-26T00:00:00.000Z' })
    expect(validateMemberShape(writeInput(), [], unavailable, provider(), neverSecret).ok).toBe(true)
    expect(resolveCouncilMember(member(), provider(), unavailable).ok).toBe(false)
  })
})

/* ================================================================== */
/* defaultMemberLabel + parseMemberParams                              */
/* ================================================================== */

describe('defaultMemberLabel (D43)', () => {
  it('is <route name>/<model>', () => {
    expect(defaultMemberLabel('OpenRouter', 'moonshotai/kimi-k3')).toBe('OpenRouter/moonshotai/kimi-k3')
  })

  it('⚠ names the route ALONE when the member has no model of its own', () => {
    // It deliberately does NOT borrow the route's default here: showing a
    // rank-2 value in a rank-1 field is how the back-write D56 forbids starts
    // looking reasonable.
    expect(defaultMemberLabel('OpenRouter', null)).toBe('OpenRouter')
    expect(defaultMemberLabel('OpenRouter', '  ')).toBe('OpenRouter')
  })
})

describe('parseMemberParams (the READ side)', () => {
  it('degrades to {} rather than throwing on corruption', () => {
    expect(parseMemberParams('{not json')).toEqual({})
    expect(parseMemberParams('[1,2]')).toEqual({})
    expect(parseMemberParams(null)).toEqual({})
  })

  it('returns the parsed pairs when they are well formed', () => {
    expect(parseMemberParams('{"temperature":0.2}')).toEqual({ temperature: 0.2 })
  })
})
