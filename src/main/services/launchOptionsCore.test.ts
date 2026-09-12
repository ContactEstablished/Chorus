import { describe, expect, it, vi } from 'vitest'
import {
  composeLaunchOptions,
  makeLaunchOptionsResolver,
  type ProfileLookups,
  type ProfilePlanOptions
} from './launchOptionsCore'
import type { CredentialRowLite, ProfileRowLite, ProviderRowLite } from './launchProfiles'

/* ------------------------------------------------------------------ */
/* fixtures — no real credential, no real key fragment, anywhere.       */
/* ------------------------------------------------------------------ */

const plan = (over: Partial<ProfilePlanOptions> = {}): ProfilePlanOptions => ({
  effort: null,
  modelEffort: null,
  permissionMode: null,
  envAdditions: {},
  ...over
})

const profile = (over: Partial<ProfileRowLite> = {}): ProfileRowLite => ({
  id: 'p1',
  label: 'Local claude',
  agent: 'claude',
  providerId: null,
  credentialProfileId: null,
  model: null,
  effort: null,
  modelEffort: null,
  permissionMode: null,
  workspaceMode: 'current-tree',
  envJson: null,
  ...over
})

const provider = (over: Partial<ProviderRowLite> = {}): ProviderRowLite => ({
  id: 'prov1',
  name: 'OpenRouter',
  adapterType: 'claude',
  authMode: 'api_key',
  model: null,
  ...over
})

const credential = (over: Partial<CredentialRowLite> = {}): CredentialRowLite => ({
  id: 'cred1',
  providerId: 'prov1',
  label: 'OR key',
  unavailableSince: null,
  ...over
})

/** Lookups that find nothing unless told otherwise. */
const lookups = (over: Partial<ProfileLookups> = {}): ProfileLookups => ({
  launchProfile: () => null,
  provider: () => null,
  credential: () => null,
  ...over
})

const row = (launchProfileId: string | null = 'p1'): { id: string; launchProfileId: string | null } => ({
  id: 's1',
  launchProfileId
})

/* ------------------------------------------------------------------ */
/* composeLaunchOptions — the key set is the contract                   */
/* ------------------------------------------------------------------ */

describe('composeLaunchOptions', () => {
  it('composes nothing from an empty plan — every key omitted', () => {
    expect(Object.keys(composeLaunchOptions(plan())).sort()).toEqual([])
  })

  it('carries all four fields when the plan has all four', () => {
    const opts = composeLaunchOptions(
      plan({
        effort: 'deep',
        modelEffort: 'high',
        permissionMode: 'plan',
        envAdditions: { FOO: 'bar' }
      })
    )
    // Asserted as a KEY SET, not field by field, so a future field cannot
    // arrive unasserted — the discipline `launchProfiles.test.ts` established.
    expect(Object.keys(opts).sort()).toEqual(
      ['effort', 'envAdditions', 'modelEffort', 'permissionMode'].sort()
    )
    expect(opts.effort).toBe('deep')
    expect(opts.modelEffort).toBe('high')
    expect(opts.permissionMode).toBe('plan')
    expect(opts.envAdditions).toEqual({ FOO: 'bar' })
  })

  /**
   * ⚠ THE TEST NOTHING ELSE SUBSTITUTES FOR. `exactOptionalPropertyTypes` is
   * not set, so `{ effort: undefined }` typechecks — and because the composed
   * object is SPREAD into larger ones at two call sites, an explicit
   * `undefined` would clobber the value beneath it where an absent key would
   * not. `toEqual` will not catch this; `in` will.
   */
  it('OMITS absent keys rather than setting them to undefined', () => {
    const opts = composeLaunchOptions(plan({ effort: 'fast' }))
    expect('effort' in opts).toBe(true)
    expect('modelEffort' in opts).toBe(false)
    expect('permissionMode' in opts).toBe(false)
    expect('envAdditions' in opts).toBe(false)
  })

  it('proves the spread hazard the omission rule exists for', () => {
    // If composeLaunchOptions ever set `permissionMode: undefined`, this spread
    // would erase the caller's value and the pane would silently fall back to
    // the adapter default — exactly the F115 bug, reintroduced from the inside.
    const merged = { permissionMode: 'manual' as const, ...composeLaunchOptions(plan()) }
    expect(merged.permissionMode).toBe('manual')
  })

  it('omits envAdditions for an empty record rather than passing {}', () => {
    expect('envAdditions' in composeLaunchOptions(plan({ envAdditions: {} }))).toBe(false)
  })

  /* -- overrides: payload beats profile, one rule not three -------------- */

  it('lets an override beat the plan for all three overridable fields', () => {
    const opts = composeLaunchOptions(
      plan({ effort: 'fast', modelEffort: 'low', permissionMode: 'manual' }),
      { effort: 'max', modelEffort: 'xhigh', permissionMode: 'plan' }
    )
    expect(opts.effort).toBe('max')
    expect(opts.modelEffort).toBe('xhigh')
    expect(opts.permissionMode).toBe('plan')
  })

  it('falls through to the plan when an override is null or absent', () => {
    const opts = composeLaunchOptions(
      plan({ effort: 'fast', modelEffort: 'low', permissionMode: 'manual' }),
      { effort: null }
    )
    expect(opts.effort).toBe('fast')
    expect(opts.modelEffort).toBe('low')
    expect(opts.permissionMode).toBe('manual')
  })

  it('takes an override even when the plan has nothing', () => {
    const opts = composeLaunchOptions(plan(), { permissionMode: 'plan' })
    expect(opts.permissionMode).toBe('plan')
    expect('effort' in opts).toBe(false)
  })

  it('never lets an override introduce envAdditions — it is profile-only', () => {
    const opts = composeLaunchOptions(plan(), { effort: 'fast' })
    expect('envAdditions' in opts).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* makeLaunchOptionsResolver — degrade, never refuse, never throw       */
/* ------------------------------------------------------------------ */

describe('makeLaunchOptionsResolver', () => {
  it('returns {} and does NOT report when the session never had a profile', () => {
    const onDegrade = vi.fn()
    const resolve = makeLaunchOptionsResolver(lookups(), onDegrade)
    expect(resolve(row(null))).toEqual({})
    expect(onDegrade).not.toHaveBeenCalled()
  })

  it('returns {} and reports ONCE when the profile row is gone', () => {
    const onDegrade = vi.fn()
    const resolve = makeLaunchOptionsResolver(lookups(), onDegrade)
    expect(resolve(row())).toEqual({})
    expect(onDegrade).toHaveBeenCalledTimes(1)
    expect(onDegrade.mock.calls[0][0]).toBe('s1')
  })

  it('returns {} and reports ONCE when resolveLaunchProfile refuses', () => {
    const onDegrade = vi.fn()
    // A profile naming a provider that no longer exists is refused by
    // resolveLaunchProfile — the refusal path, not the missing-row path above.
    const resolve = makeLaunchOptionsResolver(
      lookups({ launchProfile: () => profile({ providerId: 'prov1' }), provider: () => null }),
      onDegrade
    )
    expect(resolve(row())).toEqual({})
    expect(onDegrade).toHaveBeenCalledTimes(1)
  })

  it('composes the options for a resolvable profile', () => {
    const onDegrade = vi.fn()
    const resolve = makeLaunchOptionsResolver(
      lookups({
        launchProfile: () =>
          profile({ permissionMode: 'plan', effort: 'deep', envJson: '{"FOO":"bar"}' })
      }),
      onDegrade
    )
    const opts = resolve(row())
    expect(opts.permissionMode).toBe('plan')
    expect(opts.effort).toBe('deep')
    expect(opts.envAdditions).toEqual({ FOO: 'bar' })
    expect(onDegrade).not.toHaveBeenCalled()
  })

  /**
   * ⚠ THE D33 GUARD, AS A TEST. Asserted over a profile that DOES name a
   * credential, because the whole point is that a credentialed profile still
   * yields no credential material on this path. Never delete this.
   */
  it('returns NO secrets, credential or route even for a credentialed profile', () => {
    const resolve = makeLaunchOptionsResolver(
      lookups({
        launchProfile: () =>
          profile({ providerId: 'prov1', credentialProfileId: 'cred1', permissionMode: 'manual' }),
        provider: () => provider(),
        credential: () => credential()
      }),
      vi.fn()
    )
    const opts = resolve(row())
    // It still composed the non-credential half...
    expect(opts.permissionMode).toBe('manual')
    // ...and the key set proves nothing else came with it.
    expect(Object.keys(opts).sort()).toEqual(['permissionMode'])
    expect('secrets' in opts).toBe(false)
    expect('credential' in opts).toBe(false)
    expect('route' in opts).toBe(false)
  })

  it('is synchronous — the return value is options, never a thenable', () => {
    // The return TYPE is the enforcement of the no-unattended-decrypt
    // invariant; this asserts it survives at runtime too.
    const resolve = makeLaunchOptionsResolver(
      lookups({ launchProfile: () => profile({ permissionMode: 'plan' }) }),
      vi.fn()
    )
    const opts = resolve(row())
    expect(opts).not.toBeInstanceOf(Promise)
    expect((opts as { then?: unknown }).then).toBeUndefined()
  })

  it('never throws on a bad profile row, so one row cannot end a restore loop', () => {
    const resolve = makeLaunchOptionsResolver(
      lookups({ launchProfile: () => profile({ envJson: 'not json at all' }) }),
      vi.fn()
    )
    expect(() => resolve(row())).not.toThrow()
  })
})
