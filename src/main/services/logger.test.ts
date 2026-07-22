import { describe, expect, it } from 'vitest'
import { REDACT_PATHS, SCRUB_PLACEHOLDER, scrubSecrets } from './logger'

// Task 3-1: the scrubber half of the redacting logger. Synthetic keys of
// realistic shape ONLY — built by concatenation so no literal in this file
// (or in the repo, for scripts/secret-grep.mjs) ever forms a full key shape.
// Never a real credential.

const anthropic = 'sk-ant-api03-' + 'a1B2c3D4'.repeat(5) // 40 filler chars
const openrouter = 'sk-or-v1-' + 'z9Y8x7W6'.repeat(5)
const openaiProject = 'sk-proj-' + 'Q7w6E5r4'.repeat(5)
const openaiClassic = 'sk-' + 'T6y5U4i3'.repeat(5) // 40 alnum, no dashes
const github = 'ghp_' + 'M2n3B4v5'.repeat(5) // 40 alnum (>= 36)
const aws = 'AKIA' + 'IOSFODNN7EXAMPLE' // the AWS docs' canonical example shape

describe('scrubSecrets (Task 3-1)', () => {
  it.each([
    ['Anthropic', anthropic],
    ['OpenRouter', openrouter],
    ['OpenAI project', openaiProject],
    ['OpenAI classic', openaiClassic],
    ['GitHub', github],
    ['AWS access key id', aws]
  ])('scrubs a %s key to the placeholder', (_name, key) => {
    expect(scrubSecrets(`boot ok, key=${key} done`)).toBe(
      `boot ok, key=${SCRUB_PLACEHOLDER} done`
    )
  })

  it('replaces MULTIPLE occurrences in one string (the g flag)', () => {
    const line = `first=${anthropic} second=${github} third=${anthropic}`
    const out = scrubSecrets(line)
    expect(out).toBe(
      `first=${SCRUB_PLACEHOLDER} second=${SCRUB_PLACEHOLDER} third=${SCRUB_PLACEHOLDER}`
    )
    expect(out).not.toContain('sk-ant-')
  })

  it('ordering: an sk-ant- key leaves NO residual sk-ant- prefix', () => {
    // Regression guard for pattern order in scripts/secret-patterns.json: the
    // generic sk- pattern must run after the specific ones.
    const out = scrubSecrets(`token ${anthropic}`)
    expect(out).toBe(`token ${SCRUB_PLACEHOLDER}`)
    expect(out).not.toContain('sk-ant')
  })

  it('leaves ordinary log text byte-identical (no over-broad scrub)', () => {
    const survivors = [
      'C:\\Projects\\ContactEstablished\\Chorus',
      '985d547b-d152-4a07-9094-ddb8da56ef8f',
      '04a8a0ddbd39118188b632966f9f37eb8694ab1d', // a real 40-char git SHA shape
      'chorus/Chorus/24b5c1fe',
      "[worktrees] reconcile: 3 row(s) across 1 repo(s); 3 surfaced"
    ]
    for (const s of survivors) expect(scrubSecrets(s)).toBe(s)
  })
})

describe('REDACT_PATHS (Task 3-1)', () => {
  it('covers the field names the vault will use', () => {
    for (const field of ['apiKey', 'key', 'token', 'secret', 'password', 'encryptedBlob']) {
      expect(REDACT_PATHS).toContain(field)
      expect(REDACT_PATHS).toContain(`*.${field}`)
    }
    for (const env of [
      'env.ANTHROPIC_API_KEY',
      'env.OPENAI_API_KEY',
      'env.GEMINI_API_KEY',
      'env.OPENROUTER_API_KEY'
    ]) {
      expect(REDACT_PATHS).toContain(env)
    }
  })
})
