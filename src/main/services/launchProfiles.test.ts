import { describe, expect, it } from 'vitest'
import { NO_HARNESS_ADAPTER_TYPE } from '../../shared/ipc'
import {
  LEGACY_CREDENTIALED_PROFILE_ID,
  defaultProfileLabel,
  resolveLaunchProfile,
  sessionIsCredentialed,
  validateProfileShape,
  type CredentialRowLite,
  type ProfileRowLite,
  type ProfileWriteInput,
  type ProviderRowLite
} from './launchProfiles'

/* ------------------------------------------------------------------ */
/* fixtures — no real credential, no real key fragment, anywhere.       */
/* ------------------------------------------------------------------ */

const profile = (over: Partial<ProfileRowLite> = {}): ProfileRowLite => ({
  id: 'p1',
  label: 'OR/Kimi K3',
  agent: 'codex',
  providerId: 'prov1',
  credentialProfileId: 'cred1',
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
  adapterType: 'codex',
  authMode: 'api_key',
  model: 'vendor/route-default',
  ...over
})

const credential = (over: Partial<CredentialRowLite> = {}): CredentialRowLite => ({
  id: 'cred1',
  providerId: 'prov1',
  label: 'A key label',
  unavailableSince: null,
  ...over
})

const writeInput = (over: Partial<ProfileWriteInput> = {}): ProfileWriteInput => ({
  label: 'My profile',
  agent: 'codex',
  providerId: 'prov1',
  credentialProfileId: 'cred1',
  model: null,
  effort: null,
  modelEffort: null,
  permissionMode: null,
  workspaceMode: 'current-tree',
  envJson: null,
  ...over
})

/** Stands in for scrubSecrets at the call site. */
const neverSecret = (): boolean => false
const alwaysSecret = (): boolean => true

/* ================================================================== */
/* sessionIsCredentialed — one named test per row of Step 2's table.   */
/* ================================================================== */

describe('sessionIsCredentialed', () => {
  const never = (): undefined => undefined
  const resolvesTo = (credentialProfileId: string | null) => () => ({ credentialProfileId })

  it('row 1: NULL pointer -> false (no profile, no credential, restorable)', () => {
    expect(sessionIsCredentialed(null, never)).toBe(false)
  })

  it('row 2: resolves, credential NULL -> false (route-less or subscription profile)', () => {
    expect(sessionIsCredentialed('p1', resolvesTo(null))).toBe(false)
  })

  it('row 3: resolves, credential set -> true', () => {
    expect(sessionIsCredentialed('p1', resolvesTo('cred1'))).toBe(true)
  })

  /**
   * ⚠ THE MOST IMPORTANT TEST IN THE TASK.
   *
   * Returning `false` here is a one-character change that compiles, passes
   * every happy-path test above, and silently restores credentialed sessions
   * keyless — the exact F26 failure this phase has already paid for once. If
   * someone "simplifies" the `undefined` branch, THIS is what fails.
   */
  it('row 4 FAIL SAFE: pointer set but does NOT resolve -> TRUE', () => {
    expect(sessionIsCredentialed('deleted-profile-id', never)).toBe(true)
  })

  it('the legacy sentinel is NOT special-cased — it takes the ordinary unresolvable path', () => {
    // Identical inputs but for the value; identical outputs. This is what makes
    // the retirement honest: a legacy row behaves exactly like a deleted one.
    expect(sessionIsCredentialed(LEGACY_CREDENTIALED_PROFILE_ID, never)).toBe(true)
    expect(sessionIsCredentialed('some-deleted-uuid', never)).toBe(true)
  })

  it('the sentinel is deliberately not a uuid, so it can never collide with a real id', () => {
    expect(LEGACY_CREDENTIALED_PROFILE_ID).toBe('legacy-credentialed')
    expect(LEGACY_CREDENTIALED_PROFILE_ID).not.toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    )
  })
})

/* ================================================================== */
/* resolveLaunchProfile — model precedence (3a-4's normative table)     */
/* ================================================================== */

describe('resolveLaunchProfile — model precedence', () => {
  it('rank 1: the profile model wins over the route default', () => {
    const r = resolveLaunchProfile(profile({ model: 'vendor/profile-choice' }), provider(), credential())
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.plan.model).toBe('vendor/profile-choice')
  })

  it('rank 2: a NULL profile model falls back to the route default', () => {
    const r = resolveLaunchProfile(profile({ model: null }), provider(), credential())
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.plan.model).toBe('vendor/route-default')
  })

  it('rank 3: both NULL -> no model at all (the adapter emits no -m)', () => {
    const r = resolveLaunchProfile(profile({ model: null }), provider({ model: null }), credential())
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.plan.model).toBeNull()
  })

  it('⚠ the profile row is NOT MUTATED — the route default is never back-written', () => {
    const p = profile({ model: null })
    const before = JSON.stringify(p)
    resolveLaunchProfile(p, provider(), credential())
    expect(JSON.stringify(p)).toBe(before)
    expect(p.model).toBeNull()
  })
})

/* ================================================================== */
/* resolveLaunchProfile — refusals, all label-only                     */
/* ================================================================== */

describe('resolveLaunchProfile — refusals', () => {
  it('refuses when the route is gone', () => {
    const r = resolveLaunchProfile(profile(), null, credential())
    expect(r).toEqual({ ok: false, reason: 'The route for this profile no longer exists.' })
  })

  it('refuses when the credential is gone', () => {
    const r = resolveLaunchProfile(profile(), provider(), null)
    expect(r).toEqual({ ok: false, reason: 'The credential for this profile no longer exists.' })
  })

  it('refuses when the route targets a different agent', () => {
    const r = resolveLaunchProfile(profile({ agent: 'claude' }), provider(), credential())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('does not')
  })

  // ⚠ D84's resolve-time half. A row that already names a harness-less route
  // (hand-edited, or created before its provider was re-pointed) is SHOWN,
  // DISABLED and EXPLAINED — never silently launched and never hidden.
  it('refuses a saved profile whose route names NO harness (D84)', () => {
    const r = resolveLaunchProfile(
      profile(),
      provider({ adapterType: NO_HARNESS_ADAPTER_TYPE }),
      credential()
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('does not')
  })

  it('refuses a credential belonging to a different provider', () => {
    const r = resolveLaunchProfile(profile(), provider(), credential({ providerId: 'other' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain("does not belong to this profile's route")
  })

  it('an unavailable credential yields disabled-WITH-REASON, naming it BY LABEL', () => {
    const r = resolveLaunchProfile(
      profile(),
      provider(),
      credential({ label: 'Some label', unavailableSince: '2026-07-26T00:00:00.000Z' })
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe("Credential 'Some label' is unavailable — re-enter it in Settings.")
      // Label only: no URL, no env var name, no key fragment.
      expect(r.reason).not.toMatch(/https?:|_API_KEY|sk-/)
    }
  })


  it('⚠ refuses a MANAGEMENT route — it cannot do inference (D42 operational note)', () => {
    const r = resolveLaunchProfile(
      profile({ credentialProfileId: null }),
      provider({ authMode: 'management', name: 'OpenRouter admin' }),
      null
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('cannot launch an agent')
  })

  it('a management route is refused at CREATE too, so the dead row never exists', () => {
    const r = validateProfileShape(
      writeInput({ credentialProfileId: null }),
      provider({ authMode: 'management', name: 'OpenRouter admin' }),
      neverSecret
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('cannot launch an agent')
  })

  it('a route-less profile is first-class and keeps its own agent (D33 clause 9)', () => {
    const r = resolveLaunchProfile(
      profile({ providerId: null, credentialProfileId: null, agent: 'claude' }),
      null,
      null
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.plan.agent).toBe('claude')
      expect(r.plan.credentialProfileId).toBeNull()
      expect(r.plan.model).toBeNull()
    }
  })
})

/* ================================================================== */
/* the resolved plan carries no key material — over the FULL key set    */
/* ================================================================== */

describe('resolveLaunchProfile — the plan cannot carry key material', () => {
  it('asserts over the plan’s FULL KEY SET (the 3-2 discipline)', () => {
    const r = resolveLaunchProfile(profile(), provider(), credential())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(Object.keys(r.plan).sort()).toEqual(
      [
        'agent',
        'credentialProfileId',
        'effort',
        'envAdditions',
        'model',
        'modelEffort',
        'permissionMode',
        'profileId',
        'providerId',
        'workspaceMode'
      ].sort()
    )
    // The credential appears as an ID only — never a value, never a label used
    // as a key, never a fingerprint.
    expect(r.plan.credentialProfileId).toBe('cred1')
    expect(JSON.stringify(r.plan)).not.toContain('A key label')
  })
})

/* ================================================================== */
/* effort — 3a-4's vocabulary, imported, never re-declared             */
/* ================================================================== */

describe('resolveLaunchProfile — effort', () => {
  it.each(['fast', 'balanced', 'deep', 'max'])('passes %s through untouched', (level) => {
    const r = resolveLaunchProfile(profile({ effort: level }), provider(), credential())
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.plan.effort).toBe(level)
  })

  it('a value outside 3a-4’s four levels resolves to null rather than reaching a CLI', () => {
    const r = resolveLaunchProfile(profile({ effort: 'ultra' }), provider(), credential())
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.plan.effort).toBeNull()
  })

  it('this module maps nothing onto a CLI flag — the plan carries the LEVEL, not args', () => {
    const r = resolveLaunchProfile(profile({ effort: 'deep' }), provider(), credential())
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.plan.effort).toBe('deep')
      expect(JSON.stringify(r.plan)).not.toContain('--effort')
      expect(JSON.stringify(r.plan)).not.toContain('model_reasoning_effort')
    }
  })
})

/* ================================================================== */
/* validateProfileShape                                                */
/* ================================================================== */

describe('validateProfileShape', () => {
  it('accepts a well-formed profile', () => {
    expect(validateProfileShape(writeInput(), provider(), neverSecret)).toEqual({ ok: true })
  })

  it('refuses an empty label and an over-long one', () => {
    expect(validateProfileShape(writeInput({ label: '   ' }), provider(), neverSecret).ok).toBe(false)
    expect(
      validateProfileShape(writeInput({ label: 'x'.repeat(121) }), provider(), neverSecret).ok
    ).toBe(false)
  })

  it('refuses existing-worktree with a message that points at the launch dialog', () => {
    const r = validateProfileShape(
      writeInput({ workspaceMode: 'existing-worktree' }),
      provider(),
      neverSecret
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('pick it at launch instead')
  })

  it.each(['current-tree', 'new-worktree'])('accepts %s', (mode) => {
    expect(validateProfileShape(writeInput({ workspaceMode: mode }), provider(), neverSecret).ok).toBe(
      true
    )
  })

  it('refuses an agent that disagrees with the route’s adapter_type', () => {
    const r = validateProfileShape(writeInput({ agent: 'claude' }), provider(), neverSecret)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('not a claude route')
  })

  // ⚠ D84 — the guard that keeps a harness-less route out of the launch path,
  // at CREATE. It needed no new code: the existing agent-vs-adapter_type
  // comparison already refuses 'none' for every AgentKind, because 'none' is
  // not one. Asserted explicitly so a future relaxation of that comparison
  // cannot silently make an unlaunchable route launchable.
  it.each(['codex', 'claude'] as const)(
    'refuses a %s launch profile whose route names NO harness (D84)',
    (agent) => {
      const r = validateProfileShape(
        writeInput({ agent }),
        provider({ adapterType: NO_HARNESS_ADAPTER_TYPE }),
        neverSecret
      )
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toContain(`not a ${agent} route`)
    }
  )

  it('accepts a route-less profile and keeps its own agent', () => {
    expect(
      validateProfileShape(
        writeInput({ providerId: null, credentialProfileId: null, agent: 'claude' }),
        null,
        neverSecret
      )
    ).toEqual({ ok: true })
  })

  it('refuses a credential without a route', () => {
    const r = validateProfileShape(
      writeInput({ providerId: null, credentialProfileId: 'cred1' }),
      null,
      neverSecret
    )
    expect(r.ok).toBe(false)
  })

  it('refuses an effort level outside 3a-4’s four', () => {
    expect(validateProfileShape(writeInput({ effort: 'xhigh' }), provider(), neverSecret).ok).toBe(
      false
    )
    expect(validateProfileShape(writeInput({ effort: 'deep' }), provider(), neverSecret).ok).toBe(true)
  })

  describe('env_json', () => {
    it('accepts a normal flat map', () => {
      const r = validateProfileShape(
        writeInput({ envJson: '{"MY_FLAG":"1","OTHER":"value"}' }),
        provider(),
        neverSecret
      )
      expect(r).toEqual({ ok: true })
    })

    it('⚠ refuses a value matching a known key shape (the extra_headers_json precedent)', () => {
      const r = validateProfileShape(
        writeInput({ envJson: '{"SOME_VAR":"looks-like-a-key"}' }),
        provider(),
        alwaysSecret
      )
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toContain('looks like a secret')
    })

    it('refuses a non-object, a nested object, an array and a non-string value', () => {
      const bad = ['"a string"', '{"K":{"nested":"x"}}', '["a","b"]', '{"K":123}', '{"K":null}']
      for (const envJson of bad) {
        expect(validateProfileShape(writeInput({ envJson }), provider(), neverSecret).ok).toBe(false)
      }
    })

    it('refuses malformed JSON', () => {
      expect(
        validateProfileShape(writeInput({ envJson: '{not json' }), provider(), neverSecret).ok
      ).toBe(false)
    })

    it('refuses an invalid environment variable name', () => {
      expect(
        validateProfileShape(writeInput({ envJson: '{"9BAD":"x"}' }), provider(), neverSecret).ok
      ).toBe(false)
    })

    it('refuses more than 32 keys', () => {
      const many = Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`K${i}`, 'v']))
      expect(
        validateProfileShape(writeInput({ envJson: JSON.stringify(many) }), provider(), neverSecret)
          .ok
      ).toBe(false)
    })

    it('treats null and empty as an empty map', () => {
      expect(validateProfileShape(writeInput({ envJson: null }), provider(), neverSecret).ok).toBe(
        true
      )
      const r = resolveLaunchProfile(profile({ envJson: null }), provider(), credential())
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.plan.envAdditions).toEqual({})
    })
  })
})

/* ================================================================== */
/* defaultProfileLabel (D43)                                           */
/* ================================================================== */

describe('defaultProfileLabel', () => {
  it('is <provider name>/<model> when both exist', () => {
    expect(defaultProfileLabel('OpenRouter', 'moonshotai/kimi-k3', 'codex')).toBe(
      'OpenRouter/moonshotai/kimi-k3'
    )
  })

  it('names the agent when there is no route', () => {
    expect(defaultProfileLabel(null, null, 'claude')).toBe('claude')
  })

  it('falls back to the provider name alone when no model is resolved', () => {
    expect(defaultProfileLabel('OpenRouter', null, 'codex')).toBe('OpenRouter')
  })

  it('is only ever a DEFAULT — nothing in a resolution keys off it', () => {
    const label = defaultProfileLabel('OpenRouter', 'vendor/model', 'codex')
    const r = resolveLaunchProfile(profile({ label }), provider(), credential())
    expect(r.ok).toBe(true)
    // The plan identifies the profile by ID; the label appears nowhere in it.
    if (r.ok) expect(JSON.stringify(r.plan)).not.toContain(label)
  })
})
