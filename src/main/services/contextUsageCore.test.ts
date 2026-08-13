import { describe, it, expect } from 'vitest'
import {
  parseClaudeBannerWindow,
  CLAUDE_1M_CONTEXT_WINDOW,
  CLAUDE_DEFAULT_CONTEXT_WINDOW,
  claudeContextWindow,
  claudeUsage,
  claudeUsedTokens,
  clampPercent,
  parseClaudeTranscriptTail,
  parseCodexContextLeft
} from './contextUsageCore'

/** One assistant transcript line, in the shape the real file uses. Built from a
 *  REAL line captured off this machine's own transcript on 2026-08-08 rather
 *  than invented — the field names are the thing under test, so a fixture that
 *  guessed them would pass while the parser failed against the CLI. */
function assistantLine(usage: Record<string, unknown>, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    parentUuid: '18d8c085-4145-4c4b-99db-1c9588018a14',
    isSidechain: false,
    type: 'assistant',
    message: { model: 'claude-opus-5', role: 'assistant', usage },
    timestamp: '2026-08-08T21:20:18.534Z',
    ...extra
  })
}

describe('claudeUsedTokens — the formula is Claude Code’s, not ours', () => {
  it('sums input + cache_creation + cache_read', () => {
    // The exact counters from the captured line: 1 + 8685 + 104395 = 113081.
    expect(
      claudeUsedTokens({
        input_tokens: 1,
        cache_creation_input_tokens: 8685,
        cache_read_input_tokens: 104395,
        output_tokens: 853
      })
    ).toBe(113_081)
  })

  it('⚠ EXCLUDES output_tokens, matching the CLI', () => {
    // Verified against the installed claude 2.1.225's own statusline builder,
    // which sums exactly three terms. Including output here would make the ring
    // disagree with the number the agent prints in its own terminal — two
    // readings of one fact, with no way for a user to tell which is lying.
    const withOutput = claudeUsedTokens({
      input_tokens: 10,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 9_999
    })
    expect(withOutput).toBe(10)
  })

  it('⚠ cache_read alone is a full reading — it is the bulk of a long session', () => {
    // The failure this guards: summing only `input_tokens` (routinely 1) draws
    // an empty ring on a nearly-full context.
    expect(claudeUsedTokens({ cache_read_input_tokens: 180_000 })).toBe(180_000)
  })

  it('returns null for an object carrying none of the counters', () => {
    // "This message had no usage block" must not read as "zero tokens used".
    expect(claudeUsedTokens({})).toBeNull()
    expect(claudeUsedTokens({ service_tier: 'standard' })).toBeNull()
    expect(claudeUsedTokens(null)).toBeNull()
    expect(claudeUsedTokens('nope')).toBeNull()
  })

  it('treats a malformed counter as zero rather than poisoning the sum', () => {
    // A transcript is untrusted input; NaN propagating into the percent would
    // render as a silently broken arc rather than as an error.
    expect(
      claudeUsedTokens({ input_tokens: 'x', cache_read_input_tokens: 5, cache_creation_input_tokens: -3 })
    ).toBe(5)
  })
})

describe('parseClaudeTranscriptTail', () => {
  it('takes the NEWEST assistant reading, not a sum over the file', () => {
    // Every line already includes the whole conversation in its cache_read, so
    // adding lines together would multiply the context by the turn count.
    const chunk = [
      assistantLine({ cache_read_input_tokens: 10_000 }),
      assistantLine({ cache_read_input_tokens: 50_000 })
    ].join('\n')
    expect(parseClaudeTranscriptTail(chunk)).toBe(50_000)
  })

  it('⚠ tolerates a cut first line — the caller reads a TAIL, so this is normal', () => {
    const chunk = ['reation_input_tokens":55}},"type":"assist', assistantLine({ cache_read_input_tokens: 7_000 })].join('\n')
    expect(parseClaudeTranscriptTail(chunk)).toBe(7_000)
  })

  it('⚠ tolerates a cut LAST line and falls back to the one before it', () => {
    const chunk = [assistantLine({ cache_read_input_tokens: 7_000 }), '{"type":"assistant","mess'].join('\n')
    expect(parseClaudeTranscriptTail(chunk)).toBe(7_000)
  })

  it('⚠ SKIPS SIDECHAIN LINES — a sub-agent has its own, much smaller context', () => {
    // The bug this prevents: the ring collapsing to near-zero the moment a Task
    // tool runs, then jumping back — which reads as a bug in the ring.
    const chunk = [
      assistantLine({ cache_read_input_tokens: 120_000 }),
      assistantLine({ cache_read_input_tokens: 800 }, { isSidechain: true })
    ].join('\n')
    expect(parseClaudeTranscriptTail(chunk)).toBe(120_000)
  })

  it('ignores non-assistant entries', () => {
    const chunk = [
      assistantLine({ cache_read_input_tokens: 4_000 }),
      JSON.stringify({ type: 'user', message: { role: 'user', usage: { input_tokens: 99_999 } } })
    ].join('\n')
    expect(parseClaudeTranscriptTail(chunk)).toBe(4_000)
  })

  it('returns null for a chunk with no usable line', () => {
    expect(parseClaudeTranscriptTail('')).toBeNull()
    expect(parseClaudeTranscriptTail('not json at all\nnor this')).toBeNull()
    expect(parseClaudeTranscriptTail(JSON.stringify({ type: 'summary' }))).toBeNull()
  })
})

describe('claudeContextWindow — the denominator', () => {
  it('defaults to 200k, which is what the CLI’s own model table says', () => {
    expect(claudeContextWindow(null)).toBe(CLAUDE_DEFAULT_CONTEXT_WINDOW)
    expect(claudeContextWindow(undefined)).toBe(200_000)
    expect(claudeContextWindow('claude-opus-5')).toBe(200_000)
  })

  it('⚠ recognises the [1m] suffix — the one case that is 5x wrong if missed', () => {
    // A 1M session reported against a 200k window shows a full ring on a
    // conversation with 800k of headroom: entirely plausible, entirely wrong.
    expect(claudeContextWindow('claude-opus-5[1m]')).toBe(CLAUDE_1M_CONTEXT_WINDOW)
    expect(claudeContextWindow('claude-sonnet-5[1M]')).toBe(1_000_000)
    expect(claudeContextWindow('  claude-opus-5[1m]  ')).toBe(1_000_000)
  })

  it('does not match a suffix that merely contains the token', () => {
    expect(claudeContextWindow('claude-opus-5[1m]-preview')).toBe(200_000)
    expect(claudeContextWindow('some[1m]model')).toBe(200_000)
  })
})

describe('parseClaudeBannerWindow — the denominator the CLI prints for itself', () => {
  it('⚠ reads the REAL banner captured off a live PTY on 2026-08-08', () => {
    // The exact line, ANSI stripped. This is the case that made the banner
    // rank 1: the session had no launch profile, so the model-id path answered
    // 200k and the ring read 5x high.
    expect(parseClaudeBannerWindow('Opus 5 (1M context) with xhigh effort · Claude Max')).toBe(
      1_000_000
    )
  })

  it('matches inside the surrounding ANSI of the raw stream', () => {
    const raw =
      '\x1b[48;2;0;0;0m█████\x1b[49m▛▘\x1b[38;2;104;115;127m  Opus 5 (1M context) with xhigh effort\x1b[K'
    expect(parseClaudeBannerWindow(raw)).toBe(1_000_000)
  })

  it('accepts K as well as M, so a future spelling is read not ignored', () => {
    expect(parseClaudeBannerWindow('Sonnet 5 (200K context)')).toBe(200_000)
    expect(parseClaudeBannerWindow('Model (500k context)')).toBe(500_000)
  })

  it('⚠ returns null — NOT 200k — when the banner says nothing', () => {
    // Absence must stay distinguishable from a stated 200k, or the caller can
    // never fall through to the launch profile.
    expect(parseClaudeBannerWindow('Opus 5 with xhigh effort · Claude Max')).toBeNull()
    expect(parseClaudeBannerWindow('')).toBeNull()
    expect(parseClaudeBannerWindow('no context here')).toBeNull()
  })

  it('rejects an implausible match rather than trusting a coincidence', () => {
    expect(parseClaudeBannerWindow('(1K context)')).toBe(1_000)
    expect(parseClaudeBannerWindow('(0M context)')).toBeNull()
    expect(parseClaudeBannerWindow('(9999M context)')).toBeNull()
  })
})

describe('claudeUsage — composing the wire value', () => {
  it('divides by the window and reports both raw numbers', () => {
    expect(claudeUsage(113_081, 200_000)).toEqual({
      usedPercent: 57,
      usedTokens: 113_081,
      windowTokens: 200_000,
      source: 'claude-transcript'
    })
  })

  it('the same token count against a 1M window is a much smaller ring', () => {
    expect(claudeUsage(113_081, 1_000_000)?.usedPercent).toBe(11)
  })

  it('refuses a nonsensical window rather than dividing by it', () => {
    expect(claudeUsage(100, 0)).toBeNull()
    expect(claudeUsage(100, -1)).toBeNull()
    expect(claudeUsage(-1, 200_000)).toBeNull()
  })

  it('clamps an over-full context to 100 rather than reporting 140%', () => {
    expect(claudeUsage(280_000, 200_000)?.usedPercent).toBe(100)
  })
})

describe('parseCodexContextLeft', () => {
  it('⚠ reads the REAL status line captured off a live PTY on 2026-08-08', () => {
    // `Context 100% left` — WORD FIRST. The first version of this parser matched
    // `N% context left`, taken from the binary's string table, and never fired
    // once against the running CLI. This is the shape that actually renders.
    const raw =
      'wt-a49c9544\x1b[m\x1b[2m \u00b7 \x1b[38;2;242;181;144m\x1b[22mContext 100% left\x1b[K\x1b[m'
    expect(parseCodexContextLeft(raw)?.usedPercent).toBe(0)
    expect(parseCodexContextLeft('gpt-5.6-sol xhigh \u00b7 C:\\p \u00b7 Context 98% left')?.usedPercent).toBe(2)
  })

  it('⚠ INVERTS: codex reports context LEFT, the ring shows context USED', () => {
    // The single easiest thing to get backwards in this feature, and getting it
    // backwards is plausible-looking and exactly wrong — full when fresh, empty
    // when about to compact.
    expect(parseCodexContextLeft('Context 98% left')?.usedPercent).toBe(2)
    expect(parseCodexContextLeft('Context 100% left')?.usedPercent).toBe(0)
    expect(parseCodexContextLeft('Context 0% left')?.usedPercent).toBe(100)
  })

  it('⚠ NEVER reads a QUOTA line as a context reading', () => {
    // codex's own /status prints these, and a regex relaxed to `(\d+)% left`
    // would turn a weekly-quota number into a context number: plausible value,
    // wrong fact, undetectable from the ring.
    expect(parseCodexContextLeft('Weekly limit:   [###░] 96% left (resets 16:46 on 15 Aug)')).toBeNull()
    expect(
      parseCodexContextLeft('GPT-5.3-Codex-Spark Weekly limit: [####] 100% left (resets 18:12)')
    ).toBeNull()
    // …and a quota line in the SAME chunk as a real reading must not win.
    const both = 'Weekly limit: 96% left (resets)\n status \u00b7 Context 40% left'
    expect(parseCodexContextLeft(both)?.usedPercent).toBe(60)
  })

  it('⚠ reads the footer codex ELLIPSISED to fit a narrow pane', () => {
    // Observed 2026-08-13: a long cwd overflowed the status line and codex
    // truncated its own composed output, so the bytes end mid-word. Requiring
    // `left` froze the ring at the last wide-enough redraw, silently.
    const real =
      'gpt-5.6-sol high \u00b7 C:\\Projects\\ContactEstablished\\Mission Map \u00b7 Context 29% l\u2026'
    expect(parseCodexContextLeft(real)?.usedPercent).toBe(71)
    // Every place the cut can land after the number.
    expect(parseCodexContextLeft('Context 29% le\u2026')?.usedPercent).toBe(71)
    expect(parseCodexContextLeft('Context 29% lef\u2026')?.usedPercent).toBe(71)
    expect(parseCodexContextLeft('Context 29% left\u2026')?.usedPercent).toBe(71)
    expect(parseCodexContextLeft('Context 29% \u2026')?.usedPercent).toBe(71)
    expect(parseCodexContextLeft('Context 29%...')?.usedPercent).toBe(71)
    // …and the chunk that simply ends at the number, mid-PTY-write.
    expect(parseCodexContextLeft('gpt-5.6-sol \u00b7 Context 29%')?.usedPercent).toBe(71)
  })

  it('⚠ NEVER reads `context-used` as `context-remaining` — that inverts the ring', () => {
    // A real codex status item renders the same shape carrying the opposite
    // fact. A reading of 29% USED reported as 29% LEFT is off by 42 points and
    // looks entirely plausible, so absence of a reading is the only safe answer.
    expect(parseCodexContextLeft('Context 29% used')).toBeNull()
    expect(parseCodexContextLeft('Context 29% u\u2026')).toBeNull()
    expect(parseCodexContextLeft('gpt-5.6-sol \u00b7 Context 71% used \u00b7 Context 29% left')?.usedPercent).toBe(
      71
    )
  })

  it('will not salvage a reading whose NUMBER was truncated', () => {
    // `Context 2…` may have been 2%, 29% or 100%. No ring beats a wrong ring.
    expect(parseCodexContextLeft('gpt-5.6-sol \u00b7 Context 2\u2026')).toBeNull()
    expect(parseCodexContextLeft('gpt-5.6-sol \u00b7 Context \u2026')).toBeNull()
  })

  it('still accepts the string-table spelling, which exists in the binary', () => {
    expect(parseCodexContextLeft('98% context left')?.usedPercent).toBe(2)
    expect(parseCodexContextLeft('100% context left')?.usedPercent).toBe(0)
  })

  it('reports no token counts — codex supplies none', () => {
    // Back-computing tokens from an assumed window would turn one measured
    // number into two invented ones (D76).
    expect(parseCodexContextLeft('62% context left')).toEqual({
      usedPercent: 38,
      usedTokens: null,
      windowTokens: null,
      source: 'codex-footer'
    })
  })

  it('⚠ takes the LAST match — a redraw carries several frames per chunk', () => {
    // Taking the first would leave the ring one redraw behind forever.
    const chunk = '75% context left ... 74% context left ... 73% context left'
    expect(parseCodexContextLeft(chunk)?.usedPercent).toBe(27)
  })

  it('matches through the ANSI a real TUI emits mid-phrase', () => {
    // The literal `\d+% context left` worked in a plain string and failed
    // against the actual stream, which is why the regex tolerates escapes.
    expect(parseCodexContextLeft('\x1b[2m41%\x1b[0m \x1b[2mcontext left\x1b[0m')?.usedPercent).toBe(
      59
    )
    expect(parseCodexContextLeft('88 % context  left')?.usedPercent).toBe(12)
  })

  it('is case-insensitive, matching however the TUI capitalises it', () => {
    expect(parseCodexContextLeft('55% Context Left')?.usedPercent).toBe(45)
  })

  it('returns null when the chunk carries no reading', () => {
    expect(parseCodexContextLeft('')).toBeNull()
    expect(parseCodexContextLeft('⏎ send  ⇧⏎ newline  ⌃C quit')).toBeNull()
    expect(parseCodexContextLeft('context left')).toBeNull()
  })

  it('ignores an out-of-range number rather than clamping it into a lie', () => {
    // 400% is not a footer, it is a coincidence in some other output.
    expect(parseCodexContextLeft('400% context left')).toBeNull()
  })

  it('⚠ is stateless across calls despite the /g regex', () => {
    // A module-level /g RegExp carries `lastIndex` between calls, so a second
    // call can silently start mid-string and miss the match. The parser resets
    // it; this is the test that keeps that true.
    const chunk = '30% context left'
    expect(parseCodexContextLeft(chunk)?.usedPercent).toBe(70)
    expect(parseCodexContextLeft(chunk)?.usedPercent).toBe(70)
    expect(parseCodexContextLeft(chunk)?.usedPercent).toBe(70)
  })
})

describe('clampPercent', () => {
  it('bounds and rounds', () => {
    expect(clampPercent(-5)).toBe(0)
    expect(clampPercent(150)).toBe(100)
    expect(clampPercent(56.6)).toBe(57)
  })

  it('⚠ degrades EVERY non-finite value to 0, including Infinity', () => {
    // Infinity is arguably "over the maximum" and could defensibly clamp to
    // 100 — but a non-finite percent means a division blew up, not that the
    // context is exhausted, and 100 paints a full red ring that says the agent
    // is about to compact. Same rule as the amber light: a false alarm is worse
    // than none, so the broken-input direction is quiet.
    expect(clampPercent(NaN)).toBe(0)
    expect(clampPercent(Infinity)).toBe(0)
    expect(clampPercent(-Infinity)).toBe(0)
  })
})
