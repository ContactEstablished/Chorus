import { describe, expect, it } from 'vitest'
import { BASELINE_ENV_VARS, PINNED_ENV_VARS, composeChildEnv, resolveEnvVarName } from './env'

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
  it('NO credential → parent env plus the pins, and nothing else changed', () => {
    // The most important test in the task: it proves D33 resolution (c) survives
    // D54's amendment — nothing is stripped, two rendering constants are added.
    // A regression here silently changes how every existing session launches.
    const out = composeChildEnv({
      parentEnv: PARENT,
      requiredEnvVars: ['APPDATA'],
      envAdditions: { FOO: 'bar' },
      secretEnv: {}
    })
    // Key-set equality, so an accidental extra fails here rather than in prod.
    expect(Object.keys(out).sort()).toEqual(
      [...Object.keys(PARENT), ...Object.keys(PINNED_ENV_VARS)]
        .filter((k, i, a) => a.indexOf(k) === i)
        .sort()
    )
    for (const [k, v] of Object.entries(PARENT)) {
      if (k in PINNED_ENV_VARS) continue
      expect(out[k]).toBe(v) // every non-pinned value untouched
    }
    expect(out.TERM).toBe('xterm-256color')
  })

  it('WITH a credential → allow-list: baseline + required + pins + additions + secret, and NOTHING else', () => {
    const out = composeChildEnv({
      parentEnv: PARENT,
      requiredEnvVars: ['APPDATA'],
      envAdditions: { CHORUS_EXTRA: '1' },
      secretEnv: { OPENROUTER_KEY: KEY }
    })
    // Key-set equality, not spot-checks: an accidentally inherited variable
    // (e.g. {...process.env, ...secretEnv}) must fail here.
    expect(Object.keys(out).sort()).toEqual(
      [...BASELINE_ENV_VARS, 'APPDATA', 'CHORUS_EXTRA', 'OPENROUTER_KEY', 'TERM', 'COLORTERM'].sort()
    )
    expect(out.OPENROUTER_KEY).toBe(KEY)
    expect(out.CHORUS_EXTRA).toBe('1')
  })

  it('the pin beats an inherited TERM=dumb — no-credential branch', () => {
    // The D54 regression guard (F28): the hostile host value must not survive.
    const out = composeChildEnv({
      parentEnv: { ...PARENT, TERM: 'dumb' },
      requiredEnvVars: [],
      envAdditions: {},
      secretEnv: {}
    })
    expect(out.TERM).toBe('xterm-256color')
  })

  it('the pin beats an inherited TERM=dumb — credential branch', () => {
    const out = composeChildEnv({
      parentEnv: { ...PARENT, TERM: 'dumb' },
      requiredEnvVars: [],
      envAdditions: {},
      secretEnv: { OPENROUTER_KEY: KEY }
    })
    expect(out.TERM).toBe('xterm-256color')
  })

  it('COLORTERM is imposed in both branches, even when the parent never defined it', () => {
    // PARENT deliberately carries no COLORTERM.
    expect(PARENT.COLORTERM).toBeUndefined()
    const noCred = composeChildEnv({ parentEnv: PARENT, requiredEnvVars: [], envAdditions: {}, secretEnv: {} })
    expect(noCred.COLORTERM).toBe('truecolor')
    const cred = composeChildEnv({
      parentEnv: PARENT,
      requiredEnvVars: [],
      envAdditions: {},
      secretEnv: { OPENROUTER_KEY: KEY }
    })
    expect(cred.COLORTERM).toBe('truecolor')
  })

  it('envAdditions beats the pin — an adapter declaring TERM wins', () => {
    // The pin is a default, not an authority: F28's per-adapter option stays open.
    const out = composeChildEnv({
      parentEnv: PARENT,
      requiredEnvVars: [],
      envAdditions: { TERM: 'screen-256color' },
      secretEnv: { OPENROUTER_KEY: KEY }
    })
    expect(out.TERM).toBe('screen-256color')
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
    expect(out).toEqual({
      PATH: 'C:\\Windows\\System32',
      OPENROUTER_KEY: KEY,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor'
    })
    expect('TMP' in out).toBe(false)
  })

  it('secret precedence: the injected value wins over an inherited name — and over the pin', () => {
    const out = composeChildEnv({
      parentEnv: { ...PARENT, OPENROUTER_KEY: 'inherited-value', TERM: 'dumb' },
      requiredEnvVars: ['OPENROUTER_KEY'], // adapter preserves the name…
      envAdditions: {},
      secretEnv: { OPENROUTER_KEY: KEY, TERM: 'screen' } // …but the injected value wins
    })
    expect(out.OPENROUTER_KEY).toBe(KEY)
    expect(out.TERM).toBe('screen')
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
