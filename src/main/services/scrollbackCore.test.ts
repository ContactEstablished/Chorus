import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  capTail,
  conversationBoundary,
  exceedsSlack,
  flattenTerminalText,
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

describe('flattenTerminalText — making a vendor error line matchable', () => {
  const ESC = String.fromCharCode(27)

  it('⚠ RECOVERS THE REAL claude FAILURE LINE, WHICH SPELLS ITS SPACES AS ESC[1C', () => {
    // ⚠ THESE ARE CAPTURED BYTES, NOT AN INVENTED FIXTURE. Task 4a-3 runtime
    // gate 4, claude 2.1.229, `--resume <stale uuid>`, read out of the session's
    // own disk mirror (_verify/4a-3/). The adapter's regex is
    // /No conversation found with session ID/i — against these bytes, unflattened,
    // it matches NOTHING, and the entire Q4 recovery path never runs.
    const real =
      `${ESC}[?2004l` +
      `No${ESC}[1Cconversation${ESC}[1Cfound${ESC}[1Cwith${ESC}[1Csession${ESC}[1CID:` +
      `${ESC}[1C8b93d641-e6d3-4d65-989d-a6d94aba91cd\r\n`

    expect(/No conversation found with session ID/i.test(real)).toBe(false)
    expect(/No conversation found with session ID/i.test(flattenTerminalText(real))).toBe(true)
  })

  it('recovers the in-use line the same way', () => {
    const real = `Error:${ESC}[1CSession${ESC}[1CID${ESC}[1Cabc${ESC}[1Cis${ESC}[1Calready${ESC}[1Cin${ESC}[1Cuse.`
    expect(/Session ID .* is already in use/i.test(flattenTerminalText(real))).toBe(true)
  })

  it('turns a CSI sequence into ONE space, never into nothing', () => {
    // Dropping them yields "Noconversation" — the failure this function exists
    // to prevent. The transform only ever inserts word boundaries.
    expect(flattenTerminalText(`No${ESC}[1Cconversation`)).toBe('No conversation')
    expect(flattenTerminalText(`a${ESC}[1;31ma`)).toBe('a a')
  })

  it('collapses runs of horizontal whitespace so one space is one space', () => {
    expect(flattenTerminalText(`No${ESC}[1C${ESC}[m${ESC}[Kconversation`)).toBe('No conversation')
    expect(flattenTerminalText('a      b')).toBe('a b')
  })

  it('keeps line structure — CR and LF survive', () => {
    expect(flattenTerminalText('one\r\ntwo')).toBe('one\r\ntwo')
  })

  it('strips OSC window-title strings rather than leaking them into the match', () => {
    // A title carries the agent's own words and would otherwise be matchable
    // text that was never printed in the pane body.
    const s = `${ESC}]0;No conversation found with session ID: xready`
    expect(flattenTerminalText(s).includes('No conversation')).toBe(false)
  })

  it('leaves ordinary prose untouched', () => {
    expect(flattenTerminalText('No conversation found with session ID: abc')).toBe(
      'No conversation found with session ID: abc'
    )
    expect(flattenTerminalText('')).toBe('')
  })

  it('never invents text — output length never exceeds input length', () => {
    // A one-for-one or shrinking substitution, so it cannot manufacture a
    // phrase that was not on screen.
    for (const s of [`a${ESC}[1Cb`, `${ESC}[2J${ESC}[H`, 'plain', `${ESC}]0;t`]) {
      expect(flattenTerminalText(s).length).toBeLessThanOrEqual(s.length)
    }
  })
})

describe('Q7 / D143(g) — the conversation boundary', () => {
  const ESC = String.fromCharCode(27)

  it('emits the restart wording, byte for byte', () => {
    // ⚠ ASSERTED, NOT DESCRIBED. This string is PERSISTED into the disk mirror
    // and read back at every future restore, so its bytes are a contract with
    // history rather than a cosmetic choice.
    expect(conversationBoundary('restart')).toBe(
      `${ESC}[r${ESC}[m${ESC}[999;1H\r\n── Session restarted: fresh conversation ──\r\n`
    )
  })

  it('emits the context-not-restored wording, byte for byte', () => {
    expect(conversationBoundary('context-not-restored')).toBe(
      `${ESC}[r${ESC}[m${ESC}[999;1H\r\n── Context was not restored: started a fresh conversation ──\r\n`
    )
  })

  it('resets the scroll region and attributes before printing', () => {
    // The stream above may have left either set; without the reset the line
    // lands inside whatever sub-window the previous conversation was using.
    for (const reason of ['restart', 'context-not-restored'] as const) {
      expect(conversationBoundary(reason).startsWith(`${ESC}[r${ESC}[m`)).toBe(true)
    }
  })

  it('⚠ PARKS THE CURSOR AT THE BOTTOM BEFORE PRINTING — the "above" in Q7', () => {
    // Measured, not reasoned (runtime gate 6): the replayed screen is painted
    // with ABSOLUTE cursor moves and leaves the cursor mid-screen, so a boundary
    // that prints at the current position lands THROUGH the retained history and
    // overwrites the text it is separating. The park is what puts the history
    // above the line instead of behind it. The spec's §6 frame omits it; that
    // frame was shipped, photographed and corrected.
    for (const reason of ['restart', 'context-not-restored'] as const) {
      const out = conversationBoundary(reason)
      expect(out.startsWith(`${ESC}[r${ESC}[m${ESC}[999;1H\r\n`)).toBe(true)
      // The park precedes the text, never follows it.
      expect(out.indexOf(`${ESC}[999;1H`)).toBeLessThan(out.indexOf('──'))
    }
  })

  it('puts the text on a line of its own at both ends', () => {
    for (const reason of ['restart', 'context-not-restored'] as const) {
      const out = conversationBoundary(reason)
      expect(out.endsWith('\r\n')).toBe(true)
      // Exactly two line breaks: one opening the line, one closing it. A third
      // would leave a blank line the epilogue then scrolls inconsistently.
      expect(out.split('\r\n')).toHaveLength(3)
    }
  })

  it('leaves no scrubber carry — it ends on a newline, not mid-token', () => {
    // It goes through the session's own scrubber via `output.ingest`, which
    // holds a tail that could be the start of a secret. A trailing newline
    // guarantees there is nothing to hold.
    expect(conversationBoundary('restart').at(-1)).toBe('\n')
  })

  it('the two reasons are distinguishable — one wording cannot stand for both', () => {
    expect(conversationBoundary('restart')).not.toBe(conversationBoundary('context-not-restored'))
  })

  it('does not scroll on its own — the caller composes exactly ONE epilogue', () => {
    // F58: the seed paints the old screen, the boundary prints under it, and ONE
    // epilogue scrolls BOTH into scrollback. A boundary that scrolled itself
    // would separate the history from its own separator. It shares the park with
    // the epilogue but emits none of the epilogue's scroll lines.
    const out = conversationBoundary('restart')
    expect(out.split('\r\n')).toHaveLength(3)
    expect(out).not.toContain(replayEpilogue())
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
