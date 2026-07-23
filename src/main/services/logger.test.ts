import { describe, expect, it } from 'vitest'
import { Writable } from 'node:stream'
import pino from 'pino'
import { REDACT_PATHS, SCRUB_PLACEHOLDER, scrubbedErrSerializer, scrubSecrets } from './logger'

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

describe('scrubbedErrSerializer (F24, D36 chore)', () => {
  it('scrubs a key-shaped message AND stack on a serialized Error', () => {
    // logMethod never sees { err } objects, so this serializer is the only
    // scrub on the Error path (D33 redaction item 3).
    const err = new Error(`request failed with key ${anthropic}`)
    err.stack = `Error: request failed with key ${anthropic}\n    at fakeFrame (${github})`
    const out = scrubbedErrSerializer(err) as { message: string; stack: string }
    expect(out.message).toBe(`request failed with key ${SCRUB_PLACEHOLDER}`)
    expect(out.stack).toBe(
      `Error: request failed with key ${SCRUB_PLACEHOLDER}\n    at fakeFrame (${SCRUB_PLACEHOLDER})`
    )
  })

  it('passes an ordinary Error through byte-identical to the std serializer', () => {
    const err = new Error('plain failure, no secrets')
    // raw is non-enumerable on the std output, so both spreads drop it alike.
    expect(scrubbedErrSerializer(err)).toEqual({ ...pino.stdSerializers.err(err) })
  })

  it('wired as serializers.err, an actual logger.error({ err }, …) emission is scrubbed', () => {
    // Proves the option-key wiring itself (a misspelled key would silently
    // revert to verbatim emission), not just the exported function.
    let captured = ''
    const sink = new Writable({
      write(chunk, _enc, cb) {
        captured += chunk.toString()
        cb()
      }
    })
    const probe = pino({ serializers: { err: scrubbedErrSerializer } }, sink)
    const err = new Error(`fetch failed for ${openrouter}`)
    probe.error({ err }, 'f24 wiring probe')
    const line = JSON.parse(captured)
    expect(line.err.message).toBe(`fetch failed for ${SCRUB_PLACEHOLDER}`)
    expect(line.err.stack).toContain(SCRUB_PLACEHOLDER)
    expect(captured).not.toContain('sk-or-v1-')
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
