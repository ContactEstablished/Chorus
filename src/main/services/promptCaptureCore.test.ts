import { describe, expect, it } from 'vitest'
import {
  EMPTY_PROMPT_BUFFER,
  MAX_PROMPT_CHARS,
  feedPrompt,
  type PromptBuffer
} from './promptCaptureCore'

/** Feed a series of writes the way SessionManager.write would, and collect
 *  every prompt they completed. */
function drive(...chunks: string[]): { prompts: string[]; buf: PromptBuffer } {
  let buf = EMPTY_PROMPT_BUFFER
  const prompts: string[] = []
  for (const chunk of chunks) {
    const r = feedPrompt(buf, chunk)
    buf = r.buf
    prompts.push(...r.submitted)
  }
  return { prompts, buf }
}

/** One keystroke per write — what xterm's `onData` actually produces. */
function typed(s: string): string[] {
  return [...s]
}

describe('prompt capture — the two Enter keys', () => {
  it('CR submits the buffer', () => {
    expect(drive(...typed('fix the palette'), '\r').prompts).toEqual(['fix the palette'])
  })

  it('LF is a newline inside the prompt, not a submit (D180: ^J is line feed)', () => {
    const { prompts } = drive(...typed('first line'), '\n', ...typed('second line'), '\r')
    expect(prompts).toEqual(['first line\nsecond line'])
  })

  it('clears the buffer after a submit, so the next prompt stands alone', () => {
    expect(drive(...typed('one'), '\r', ...typed('two'), '\r').prompts).toEqual(['one', 'two'])
  })

  it('commits nothing for a bare Enter at a confirmation dialog', () => {
    expect(drive('\r', '\r').prompts).toEqual([])
  })

  it('commits nothing for whitespace alone', () => {
    expect(drive(...typed('   '), '\r').prompts).toEqual([])
  })

  it('trims surrounding whitespace off a committed prompt', () => {
    expect(drive(...typed('  spaced  '), '\r').prompts).toEqual(['spaced'])
  })

  it('reports both prompts when one write carries two submits', () => {
    expect(drive('alpha\rbeta\r').prompts).toEqual(['alpha', 'beta'])
  })
})

describe('prompt capture — line editing', () => {
  it('backspace deletes the last character', () => {
    expect(drive(...typed('helloo'), '\x7f', '\r').prompts).toEqual(['hello'])
  })

  it('treats \\b as backspace too', () => {
    expect(drive(...typed('abc'), '\b', '\r').prompts).toEqual(['ab'])
  })

  it('Ctrl+U kills the line', () => {
    expect(drive(...typed('throw this away'), '\x15', ...typed('keep this'), '\r').prompts).toEqual([
      'keep this'
    ])
  })

  it('Ctrl+C abandons the line without committing it', () => {
    expect(drive(...typed('half a thought'), '\x03', '\r').prompts).toEqual([])
  })

  it('Ctrl+W deletes the last word', () => {
    expect(drive(...typed('fix the palette'), '\x17', ...typed('dialog'), '\r').prompts).toEqual([
      'fix the dialog'
    ])
  })

  it('Ctrl+W on trailing space still removes the word before it', () => {
    expect(drive(...typed('one two '), '\x17', '\r').prompts).toEqual(['one'])
  })

  it('backspace on an empty buffer is harmless', () => {
    expect(drive('\x7f', '\x7f', ...typed('ok'), '\r').prompts).toEqual(['ok'])
  })

  it('a lone ESC abandons the composed prompt', () => {
    expect(drive(...typed('never mind'), '\x1b', ...typed('actual prompt'), '\r').prompts).toEqual([
      'actual prompt'
    ])
  })
})

describe('prompt capture — control sequences are dropped, never appended', () => {
  it('drops arrow keys rather than recording their escape sequences', () => {
    const { prompts } = drive(...typed('word'), '\x1b[D', '\x1b[C', '\x1b[A', '\x1b[B', '\r')
    expect(prompts).toEqual(['word'])
  })

  it('drops SS3-form arrows (application cursor mode)', () => {
    expect(drive(...typed('word'), '\x1bOA', '\x1bOD', '\r').prompts).toEqual(['word'])
  })

  it('drops a CSI sequence with parameters', () => {
    expect(drive(...typed('a'), '\x1b[1;5D', ...typed('b'), '\r').prompts).toEqual(['ab'])
  })

  it('drops Tab and other C0 bytes', () => {
    expect(drive(...typed('/co'), '\t', '\x07', '\r').prompts).toEqual(['/co'])
  })

  it('drops an ESC-prefixed meta chord', () => {
    expect(drive(...typed('x'), '\x1bb', ...typed('y'), '\r').prompts).toEqual(['xy'])
  })

  it('drops an unterminated CSI without losing the buffer', () => {
    const { prompts, buf } = drive(...typed('kept'), '\x1b[12')
    expect(prompts).toEqual([])
    expect(buf.text).toBe('kept')
  })
})

describe('prompt capture — bracketed paste', () => {
  it('keeps the payload and strips the wrappers', () => {
    expect(drive('\x1b[200~pasted text\x1b[201~', '\r').prompts).toEqual(['pasted text'])
  })

  it('⚠ CR inside a paste is a newline, not a submit', () => {
    const { prompts } = drive('\x1b[200~line one\rline two\x1b[201~', '\r')
    expect(prompts).toEqual(['line one\nline two'])
  })

  it('CR submits again once the paste has ended', () => {
    const { prompts } = drive('\x1b[200~pasted\x1b[201~', ...typed(' plus typed'), '\r')
    expect(prompts).toEqual(['pasted plus typed'])
  })

  it('carries paste state across writes, since a paste can span chunks', () => {
    const { prompts } = drive('\x1b[200~first\r', 'second\x1b[201~', '\r')
    expect(prompts).toEqual(['first\nsecond'])
  })
})

describe('prompt capture — dictation', () => {
  // Voice calls SessionManager.write ONCE with the whole transcript and
  // deliberately no trailing newline (voice.ts's stated safety rule), so the
  // Enter that submits it is a separate write from the keyboard. This is the
  // case a renderer-side keystroke tap could not see at all.
  it('one dictated chunk plus a later Enter is one prompt', () => {
    expect(drive('please refactor the launch dialog', '\r').prompts).toEqual([
      'please refactor the launch dialog'
    ])
  })

  it('dictation appended to already-typed text commits as one prompt', () => {
    const { prompts } = drive(...typed('note: '), 'the spoken part', '\r')
    expect(prompts).toEqual(['note: the spoken part'])
  })
})

describe('prompt capture — bounds', () => {
  it('caps a giant paste instead of buffering it', () => {
    const huge = 'x'.repeat(MAX_PROMPT_CHARS * 3)
    const { prompts } = drive(`\x1b[200~${huge}\x1b[201~`, '\r')
    expect(prompts[0]).toHaveLength(MAX_PROMPT_CHARS)
  })

  it('stays capped across many writes', () => {
    let buf = EMPTY_PROMPT_BUFFER
    for (let i = 0; i < 200; i++) buf = feedPrompt(buf, 'y'.repeat(100)).buf
    expect(buf.text.length).toBe(MAX_PROMPT_CHARS)
  })

  it('does not mutate the buffer it was handed', () => {
    const before = EMPTY_PROMPT_BUFFER
    feedPrompt(before, 'typing')
    expect(before.text).toBe('')
    expect(before.inPaste).toBe(false)
  })
})

describe('prompt capture — the honest bounds, asserted so they stay honest', () => {
  it('records typed order, NOT final order, when the cursor is moved mid-prompt', () => {
    // Types "world", goes home, types "hello ". A terminal would show
    // "hello world"; this module records what was typed, in order. D191 names
    // this bound and the history is what makes it recoverable.
    const { prompts } = drive(...typed('world'), '\x1b[H', ...typed('hello '), '\r')
    expect(prompts).toEqual(['worldhello'])
  })

  it('records a short dialog answer as its own prompt', () => {
    expect(drive(...typed('do the thing'), '\r', ...typed('y'), '\r').prompts).toEqual([
      'do the thing',
      'y'
    ])
  })
})
