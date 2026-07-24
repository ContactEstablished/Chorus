import { describe, expect, it } from 'vitest'
import { BASELINE_ENV_VARS, composeChildEnv, resolveEnvVarName } from './env'

// Task 3-6: the one-owner env policy (D34(d), D33 clause 4 + resolution (c)).
// The synthetic value below is realistic-shaped but built by concatenation so
// no literal in this file forms a full key shape for scripts/secret-grep.mjs.
const KEY = 'sk-or-v1-' + 'T3stV4lue'.repeat(5)

const PARENT: NodeJS.ProcessEnv = {
  PATH: 'C:\\Windows\\System32',
  SystemRoot: 'C:\\Windows',
  TEMP: 'C:\\Users\\m\\AppData\\Local\\Temp',
  TMP: 'C:\\Users\\m\\AppData\\Local\\Temp',
  HOMEDRIVE: 'C:',
  HOMEPATH: '\\Users\\m',
  USERPROFILE: 'C:\\Users\\m',
  APPDATA: 'C:\\Users\\m\\AppData\\Roaming',
  ANTHROPIC_API_KEY: 'ambient-key-the-user-did-not-choose',
  CHORUS_SESSION: 'some-internal-var'
}

describe('composeChildEnv (Task 3-6)', () => {
  it('NO credential → identity: the passed-in environment, unmodified and complete', () => {
    // The most important test in the task: it proves D33 resolution (c). A
    // regression here silently changes how every existing session launches.
    const out = composeChildEnv({
      parentEnv: PARENT,
      requiredEnvVars: ['APPDATA'],
      envAdditions: { FOO: 'bar' },
      secretEnv: {}
    })
    expect(out).toEqual(PARENT)
    expect(Object.keys(out).sort()).toEqual(Object.keys(PARENT).sort())
  })

  it('WITH a credential → allow-list: baseline + required + additions + secret, and NOTHING else', () => {
    const out = composeChildEnv({
      parentEnv: PARENT,
      requiredEnvVars: ['APPDATA'],
      envAdditions: { CHORUS_EXTRA: '1' },
      secretEnv: { OPENROUTER_KEY: KEY }
    })
    // Key-set equality, not spot-checks: an accidentally inherited variable
    // (e.g. {...process.env, ...secretEnv}) must fail here.
    expect(Object.keys(out).sort()).toEqual(
      [...BASELINE_ENV_VARS, 'APPDATA', 'CHORUS_EXTRA', 'OPENROUTER_KEY'].sort()
    )
    expect(out.OPENROUTER_KEY).toBe(KEY)
    expect(out.CHORUS_EXTRA).toBe('1')
  })

  it('ambient provider keys are EXCLUDED from a credential-bearing launch', () => {
    // The billing-separation property the whole feature exists for: an
    // ANTHROPIC_API_KEY the user did not choose must not ride along.
    const out = composeChildEnv({
      parentEnv: PARENT,
      requiredEnvVars: [],
      envAdditions: {},
      secretEnv: { OPENROUTER_KEY: KEY }
    })
    expect(out.ANTHROPIC_API_KEY).toBeUndefined()
    expect(out.CHORUS_SESSION).toBeUndefined()
  })

  it('missing baseline variables are skipped, never emitted as undefined', () => {
    const sparse: NodeJS.ProcessEnv = { PATH: 'C:\\Windows\\System32' } // no TMP etc.
    const out = composeChildEnv({
      parentEnv: sparse,
      requiredEnvVars: [],
      envAdditions: {},
      secretEnv: { OPENROUTER_KEY: KEY }
    })
    expect(out).toEqual({ PATH: 'C:\\Windows\\System32', OPENROUTER_KEY: KEY })
    expect('TMP' in out).toBe(false)
  })

  it('secret precedence: the injected value wins over an inherited name', () => {
    const out = composeChildEnv({
      parentEnv: { ...PARENT, OPENROUTER_KEY: 'inherited-value' },
      requiredEnvVars: ['OPENROUTER_KEY'], // adapter preserves the name…
      envAdditions: {},
      secretEnv: { OPENROUTER_KEY: KEY } // …but the injected value wins
    })
    expect(out.OPENROUTER_KEY).toBe(KEY)
  })
})

describe('resolveEnvVarName (D34(e))', () => {
  it('a provider override beats the adapter default', () => {
    expect(resolveEnvVarName('MY_CUSTOM_KEY', 'OPENAI_API_KEY')).toBe('MY_CUSTOM_KEY')
  })

  it('absent override falls back to the adapter default', () => {
    expect(resolveEnvVarName(null, 'OPENAI_API_KEY')).toBe('OPENAI_API_KEY')
  })

  it('null from both means this auth method injects nothing', () => {
    expect(resolveEnvVarName(null, null)).toBeNull()
  })
})
