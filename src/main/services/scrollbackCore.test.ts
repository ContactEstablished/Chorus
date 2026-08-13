import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  capTail,
  exceedsSlack,
  planReplay,
  replayEpilogue,
  stripAltScreen,
  SCROLLBACK_MAX_CHARS,
  SCROLLBACK_SLACK_RATIO
} from './scrollbackCore'

describe('capTail — the head-truncation rule', () => {
  it('leaves content under the cap untouched', () => {
    expect(capTail('abc', 'def', 100)).toBe('abcdef')
  })

  it('leaves content EXACTLY at the cap untouched (the off-by-one guard)', () => {
    // The boundary is the only place this rule can be wrong without being
    // obviously wrong: `>` vs `>=` costs one character on every capped read.
    const out = capTail('abc', 'def', 6)
    expect(out).toBe('abcdef')
    expect(out).toHaveLength(6)
  })

  it('head-truncates past the cap, keeping the tail, to exactly the cap', () => {
    const out = capTail('abcdef', 'ghij', 4)
    expect(out).toBe('ghij')
    expect(out).toHaveLength(4)
  })

  it('keeps the NEWEST characters, not the oldest', () => {
    // The direction of the truncation is the feature: a reopened pane wants the
    // end of its history, not its beginning.
    expect(capTail('OLD-', 'NEW', 3)).toBe('NEW')
  })

  it('truncates a single chunk larger than the whole cap rather than rejecting it', () => {
    const huge = 'x'.repeat(50) + 'TAIL'
    const out = capTail('', huge, 4)
    expect(out).toBe('TAIL')
  })

  it('treats an empty incoming chunk as a no-op on existing content', () => {
    expect(capTail('abc', '', 100)).toBe('abc')
  })

  it('handles an empty everything', () => {
    expect(capTail('', '', 100)).toBe('')
  })

  it('degrades to empty for a non-positive cap rather than throwing', () => {
    expect(capTail('abc', 'def', 0)).toBe('')
    expect(capTail('abc', 'def', -1)).toBe('')
  })
})

describe('planReplay — what a restored pane is seeded with', () => {
  it('returns a whole file that is under the cap', () => {
    expect(planReplay('hello world', 100)).toBe('hello world')
  })

  it('tails an over-cap file — a file CAN legitimately exceed the cap (slack)', () => {
    expect(planReplay('abcdefghij', 4)).toBe('ghij')
  })

  it('reads an empty file as empty', () => {
    expect(planReplay('', 100)).toBe('')
  })

  it('is the same computation as capTail, so the two rules cannot drift', () => {
    const contents = 'x'.repeat(1000) + 'END'
    expect(planReplay(contents, 10)).toBe(capTail('', contents, 10))
  })
})

describe('exceedsSlack — when a rewrite is worth its cost', () => {
  it('is false under the cap', () => {
    expect(exceedsSlack(100, 1000, 1.25)).toBe(false)
  })

  it('is false between the cap and the slack threshold — that is the whole point', () => {
    // A file 20% over cap is left alone: rewriting it would be the 4 MB write
    // twenty times a second that the slack margin exists to prevent.
    expect(exceedsSlack(1200, 1000, 1.25)).toBe(false)
  })

  it('is false exactly AT the threshold, true past it', () => {
    expect(exceedsSlack(1250, 1000, 1.25)).toBe(false)
    expect(exceedsSlack(1251, 1000, 1.25)).toBe(true)
  })
})

describe('F58 — making a replayed mirror visible', () => {
  const ESC = String.fromCharCode(27)

  it('drops alternate-screen switches, which have no scrollback to survive in', () => {
    const s = `${ESC}[?1049hpainted${ESC}[?1049l`
    expect(stripAltScreen(s)).toBe('painted')
    expect(stripAltScreen(`${ESC}[?1047h${ESC}[?47l`)).toBe('')
  })

  it('preserves every OTHER escape, because they are the layout', () => {
    // Colour, absolute cursor position and erase all survive untouched:
    // stripping them concatenates unrelated screen regions and garbles the text.
    const s = `${ESC}[2J${ESC}[3;40Hhello${ESC}[m${ESC}[31mred`
    expect(stripAltScreen(s)).toBe(s)
  })

  it('leaves ordinary text alone', () => {
    expect(stripAltScreen('no escapes here')).toBe('no escapes here')
    expect(stripAltScreen('')).toBe('')
  })

  it('does not eat a literal "[?1049h" that is not an escape sequence', () => {
    // Without the leading ESC it is just text a pane might legitimately show.
    expect(stripAltScreen('the code [?1049h means alt screen')).toBe(
      'the code [?1049h means alt screen'
    )
  })

  it('emits an epilogue that resets the scroll region before scrolling', () => {
    // Without the region reset the newlines would scroll only a sub-window that
    // the old stream happened to leave set.
    const e = replayEpilogue(3)
    expect(e.startsWith(`${ESC}[r${ESC}[m${ESC}[999;1H`)).toBe(true)
    expect(e.split('\r\n')).toHaveLength(4)
  })
})

describe('the cap is bound to the ring buffer it mirrors', () => {
  it('equals BUFFER_MAX_CHARS as written in sessionManager.ts', () => {
    // ⚠ READ FROM SOURCE, NOT IMPORTED, AND THAT IS FORCED RATHER THAN LAZY.
    // sessionManager.ts imports node-pty, whose native binding cannot load
    // under Vitest's Node ABI — importing it here would throw before a single
    // assertion ran. So the equality is asserted against the literal itself,
    // which is the thing that would actually drift.
    const src = readFileSync(join(__dirname, 'sessionManager.ts'), 'utf8')
    const match = src.match(/const BUFFER_MAX_CHARS = ([0-9_]+)/)
    expect(match, 'BUFFER_MAX_CHARS not found in sessionManager.ts').not.toBeNull()
    const bufferMax = Number(match![1].replace(/_/g, ''))
    expect(bufferMax).toBe(4_000_000)
    expect(SCROLLBACK_MAX_CHARS).toBe(bufferMax)
  })

  it('ships a slack ratio above 1 — a ratio of 1 would be the naive rewrite', () => {
    expect(SCROLLBACK_SLACK_RATIO).toBeGreaterThan(1)
  })
})
