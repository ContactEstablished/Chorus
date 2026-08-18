import { describe, it, expect } from 'vitest'
import {
  DEFAULT_REFINEMENT_MODE,
  REFINEMENT_MODES,
  describeFallback,
  fallbackOutcome,
  isNetworkMode,
  judgeReply,
  normalizeResponse,
  outputTokenCap,
  preservesFacts,
  promptFor
} from './voiceRefineCore'

/**
 * ⚠ THE CHECK IS WRITTEN AND TESTED BEFORE THE CALL, so the call is never the
 * thing under test (Task 5-4 step 1). Every fixture below is a realistic
 * dictation, and every rule has BOTH a rejection and a false-positive guard —
 * a check that rejects legal normalisations makes refinement useless, and a
 * check that misses a dropped number makes it dangerous.
 */

describe('voiceRefineCore — modes and prompts', () => {
  it('has three modes with Clean up as the default and Verbatim as the floor', () => {
    expect(REFINEMENT_MODES).toEqual(['verbatim', 'cleanup', 'organize'])
    expect(DEFAULT_REFINEMENT_MODE).toBe('cleanup')
    expect(isNetworkMode('verbatim')).toBe(false)
    expect(isNetworkMode('cleanup')).toBe(true)
    expect(isNetworkMode('organize')).toBe(true)
  })

  it('each network mode produces its OWN prompt, and Verbatim has none', () => {
    const cleanup = promptFor('cleanup', 'um so fix the parser')
    const organize = promptFor('organize', 'um so fix the parser')
    expect(cleanup.system).not.toEqual(organize.system)
    expect(cleanup.system).toContain('CLEAN UP')
    expect(organize.system).toContain('ORGANIZE')
    // The transcript rides the USER turn, alone — it is data, not instruction.
    expect(cleanup.user).toBe('um so fix the parser')
    expect(organize.user).toBe('um so fix the parser')
    expect(cleanup.system).not.toContain('fix the parser')
    // ⚠ NO VERBATIM PROMPT: a "change nothing" prompt would break the offline floor.
    expect(() => promptFor('verbatim', 'x')).toThrow(/no call/)
  })

  it('states the do-not-invent contract in every network prompt', () => {
    for (const mode of ['cleanup', 'organize'] as const) {
      const { system } = promptFor(mode, 'x')
      expect(system).toMatch(/verbatim/i)
      expect(system).toMatch(/\[unclear\]/)
      expect(system).toMatch(/uncertainty/i)
      expect(system).toMatch(/only the corrected text/i)
      // The transcript is data: instructions inside it are not to be followed.
      expect(system).toMatch(/not a request/i)
    }
  })
})

describe('voiceRefineCore — preservesFacts: digits', () => {
  it('rejects a refinement that DROPS a number', () => {
    const original = 'bump the retry count to 7 and the timeout to 30 seconds'
    const refined = 'Bump the retry count and the timeout to 30 seconds.'
    expect(preservesFacts(original, refined)).toEqual({ ok: false, reason: 'digits', count: 1 })
  })

  it('rejects a refinement that ALTERS a number', () => {
    const original = 'the invoice was 1450 dollars'
    const refined = 'The invoice was 1540 dollars.'
    expect(preservesFacts(original, refined)).toEqual({ ok: false, reason: 'digits', count: 1 })
  })

  it('accepts "twenty twenty six" → "2026" — a digit GAINED is legal (original→refined, never reverse)', () => {
    const original = 'ship it in twenty twenty six'
    const refined = 'Ship it in 2026.'
    expect(preservesFacts(original, refined)).toEqual({ ok: true })
  })

  it('treats a thousands separator as the same fact: 1000 ↔ 1,000', () => {
    expect(preservesFacts('we have 1000 users', 'We have 1,000 users.')).toEqual({ ok: true })
    expect(preservesFacts('we have 1,000 users', 'We have 1000 users.')).toEqual({ ok: true })
  })

  it('keeps decimals, versions and money', () => {
    const original = 'upgrade to 3.12 and cap it at $5.99'
    const refined = 'Upgrade to 3.12 and cap it at $5.99.'
    expect(preservesFacts(original, refined)).toEqual({ ok: true })
    expect(preservesFacts(original, 'Upgrade to 3.2 and cap it at $5.99.')).toMatchObject({
      ok: false,
      reason: 'digits'
    })
  })
})

describe('voiceRefineCore — preservesFacts: quoted spans', () => {
  it('rejects a refinement that paraphrases a quoted span', () => {
    const original = 'the error says "connection refused" every time'
    const refined = 'The error says "could not connect" every time.'
    expect(preservesFacts(original, refined)).toEqual({ ok: false, reason: 'quote', count: 1 })
  })

  it('accepts a quoted span kept verbatim, even with curly quotes and re-punctuation', () => {
    const original = 'the error says "connection refused" every time'
    const refined = 'The error says “connection refused” every time.'
    expect(preservesFacts(original, refined)).toEqual({ ok: true })
  })

  it('accepts a quoted span whose internal whitespace was collapsed', () => {
    const original = 'log line is "user  not   found" I think'
    const refined = 'The log line is "user not found", I think.'
    expect(preservesFacts(original, refined)).toEqual({ ok: true })
  })
})

describe('voiceRefineCore — preservesFacts: identifiers', () => {
  it('rejects a refinement that renames a snake_case identifier', () => {
    const original = 'set retry_count to seven in the config'
    const refined = 'Set retryCount to seven in the config.'
    expect(preservesFacts(original, refined)).toEqual({ ok: false, reason: 'identifier', count: 1 })
  })

  it('rejects a refinement that drops a file name', () => {
    const original = 'the bug is in apiSession.ts near the top'
    const refined = 'The bug is in the API session file near the top.'
    // apiSession.ts is BOTH camelCase and dotted; one token, one miss.
    expect(preservesFacts(original, refined)).toEqual({ ok: false, reason: 'identifier', count: 1 })
  })

  it('accepts identifiers kept verbatim: camelCase, snake_case, paths and namespaces', () => {
    const original =
      'um so in src/main/ipc.ts the resolveCredential function reads MAX_RETRIES and std::vector too'
    const refined =
      'In src/main/ipc.ts, the resolveCredential function reads MAX_RETRIES and std::vector too.'
    expect(preservesFacts(original, refined)).toEqual({ ok: true })
  })

  it('does not treat an ordinary word with a trailing full stop as an identifier', () => {
    // "parser." is the word parser, not the identifier "parser."; the model may
    // legitimately re-punctuate around it.
    const original = 'we should fix the parser. then the lexer'
    const refined = 'We should fix the parser, then the lexer.'
    expect(preservesFacts(original, refined)).toEqual({ ok: true })
  })
})

describe('voiceRefineCore — preservesFacts: length and emptiness', () => {
  it('rejects a reply that is more than 1.5x the original (commentary, not cleanup)', () => {
    const original = 'fix the parser'
    const refined =
      'Certainly! Here is a cleaned up version of your dictation: fix the parser. Let me know if you need anything else.'
    expect(preservesFacts(original, refined)).toMatchObject({ ok: false, reason: 'length' })
  })

  it('rejects a reply that is less than 0.4x the original (it dropped most of the text)', () => {
    const original =
      'okay so first we need to look at the parser and then after that the lexer and then finally the emitter'
    const refined = 'Look at the parser.'
    expect(preservesFacts(original, refined)).toMatchObject({ ok: false, reason: 'length' })
  })

  it('accepts a normal filler removal, which shortens the text within bounds', () => {
    const original = 'um so uh I think we should, we should probably fix the parser first you know'
    const refined = 'I think we should probably fix the parser first.'
    expect(preservesFacts(original, refined)).toEqual({ ok: true })
  })

  it('rejects an empty reply', () => {
    expect(preservesFacts('fix the parser', '   ')).toEqual({ ok: false, reason: 'empty', count: 0 })
  })

  it('reports a COUNT and never the missing text', () => {
    const result = preservesFacts('call 555 1234 about "the invoice" in billing_core', 'Call about it.')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      // Whatever it reports, the shape carries no string field at all.
      expect(Object.keys(result).sort()).toEqual(['count', 'ok', 'reason'])
      expect(typeof result.count).toBe('number')
    }
  })
})

describe('voiceRefineCore — normalizeResponse', () => {
  it('strips a whole-reply code fence', () => {
    expect(normalizeResponse('```\nFix the parser.\n```', 'fix the parser')).toBe('Fix the parser.')
    expect(normalizeResponse('```text\nFix the parser.\n```', 'fix the parser')).toBe('Fix the parser.')
  })

  it('strips a whole-reply pair of quotes when the original was not quoted', () => {
    expect(normalizeResponse('"Fix the parser."', 'fix the parser')).toBe('Fix the parser.')
    expect(normalizeResponse('“Fix the parser.”', 'fix the parser')).toBe('Fix the parser.')
  })

  it('leaves quotes alone when the original itself began with one', () => {
    expect(normalizeResponse('"connection refused" is the error', '"connection refused" is the error')).toBe(
      '"connection refused" is the error'
    )
  })

  it('does not touch quotes INSIDE the text', () => {
    expect(normalizeResponse('The error is "refused" here.', 'the error is "refused" here')).toBe(
      'The error is "refused" here.'
    )
  })
})

describe('voiceRefineCore — judgeReply and fallbacks', () => {
  it('returns the refined text when the reply preserves every fact', () => {
    const out = judgeReply('um fix the parser in ipc.ts', 'cleanup', 'Fix the parser in ipc.ts.')
    expect(out).toEqual({
      text: 'Fix the parser in ipc.ts.',
      refined: true,
      mode: 'cleanup',
      fallback: null,
      failure: null
    })
  })

  it('returns the ORIGINAL on an empty reply', () => {
    const out = judgeReply('fix the parser', 'cleanup', '   \n')
    expect(out).toEqual({ text: 'fix the parser', refined: false, mode: 'cleanup', fallback: 'empty', failure: null })
  })

  it('returns the ORIGINAL when the reply fails validation, naming the rule', () => {
    const out = judgeReply('bump it to 7', 'organize', 'Bump it.')
    expect(out).toEqual({
      text: 'bump it to 7',
      refined: false,
      mode: 'organize',
      fallback: 'validation',
      failure: 'digits'
    })
  })

  it('fallbackOutcome always carries the original and never claims refinement', () => {
    for (const f of ['verbatim', 'not-configured', 'no-credential', 'transport', 'timeout', 'refused', 'empty'] as const) {
      const out = fallbackOutcome('the words', 'cleanup', f)
      expect(out.text).toBe('the words')
      expect(out.refined).toBe(false)
      expect(out.fallback).toBe(f)
    }
  })

  it('describes every fallback with a fixed string that carries no transcript', () => {
    const transcript = 'a very specific sentence nobody else would say'
    for (const f of ['verbatim', 'not-configured', 'no-credential', 'transport', 'timeout', 'refused', 'empty', 'validation'] as const) {
      const text = describeFallback(f, f === 'validation' ? 'digits' : null)
      expect(text.length).toBeGreaterThan(0)
      expect(text).not.toContain(transcript)
    }
    expect(describeFallback('validation', 'identifier')).toMatch(/identifier/)
    expect(describeFallback('validation', 'quote')).toMatch(/quotation/)
    expect(describeFallback('validation', 'length')).toMatch(/length/)
  })
})

describe('voiceRefineCore — outputTokenCap', () => {
  it('has a floor, a ceiling, and scales with the original between them', () => {
    expect(outputTokenCap('')).toBe(256)
    expect(outputTokenCap('a'.repeat(1000))).toBe(878)
    expect(outputTokenCap('a'.repeat(100_000))).toBe(4096)
  })
})
