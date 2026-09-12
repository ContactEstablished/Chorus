import { describe, expect, it } from 'vitest'
import {
  CE_WEIGHT_CACHE_READ,
  CE_WEIGHT_EPHEMERAL_1H,
  CE_WEIGHT_EPHEMERAL_5M,
  isSubagentTranscriptName,
  ledgerEntryTotals,
  scanLedger,
  subagentDirFor,
  type LedgerSource
} from './engineLedgerCore'

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/*                                                                     */
/* ⚠ EVERY FIXTURE BELOW IS LABELLED real-derived OR hand-built, and    */
/* the labels are load-bearing: two required cases DO NOT EXIST in     */
/* nature on this machine, and a test implying otherwise is the exact  */
/* failure this repo keeps finding. Real-derived usage objects are     */
/* copied VERBATIM from `~/.claude/projects/`, unknown keys included   */
/* (`service_tier`, `inference_geo`, `speed`, `output_tokens_details`, */
/* `server_tool_use`), so an unrecognised field cannot break the parse.*/
/* No message text, tool input or file name is reproduced — only the   */
/* usage objects, which are numbers.                                   */
/* ------------------------------------------------------------------ */

/** ✅ REAL-DERIVED — a 1-hour-TTL entry, verbatim, `iterations` included.
 *  input 2 · write 17,996 (all 1h) · read 27,883 · output 106. */
const REAL_1H_USAGE = {
  input_tokens: 2,
  cache_creation_input_tokens: 17996,
  cache_read_input_tokens: 27883,
  output_tokens: 106,
  output_tokens_details: { thinking_tokens: 77 },
  server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
  service_tier: 'standard',
  cache_creation: { ephemeral_1h_input_tokens: 17996, ephemeral_5m_input_tokens: 0 },
  inference_geo: 'not_available',
  iterations: [
    {
      input_tokens: 2,
      output_tokens: 106,
      cache_read_input_tokens: 27883,
      cache_creation_input_tokens: 17996,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 17996 },
      type: 'message'
    }
  ],
  speed: 'standard'
}
const REAL_1H_CE = 2 + CE_WEIGHT_EPHEMERAL_1H * 17996 + CE_WEIGHT_CACHE_READ * 27883
const REAL_1H_RLIT = 2 + 17996
const REAL_1H_NAIVE = 2 + 17996 + 27883

/** ✅ REAL-DERIVED — a 5-minute-TTL entry from a real SUBAGENT file, verbatim.
 *  input 2 · write 10,512 (all 5m) · read 5,599 · output 2. */
const REAL_5M_USAGE = {
  input_tokens: 2,
  cache_creation_input_tokens: 10512,
  cache_read_input_tokens: 5599,
  cache_creation: { ephemeral_5m_input_tokens: 10512, ephemeral_1h_input_tokens: 0 },
  output_tokens: 2,
  service_tier: 'standard',
  inference_geo: 'not_available'
}
const REAL_5M_CE = 2 + CE_WEIGHT_EPHEMERAL_5M * 10512 + CE_WEIGHT_CACHE_READ * 5599

const line = (usage: unknown, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ type: 'assistant', timestamp: '2026-08-28T15:22:00.069Z', message: { usage }, ...extra })

const main = (text: string): LedgerSource => ({ origin: 'main', text })
const sub = (text: string): LedgerSource => ({ origin: 'subagent', text })

/* ------------------------------------------------------------------ */
/* ledgerEntryTotals                                                   */
/* ------------------------------------------------------------------ */

describe('ledgerEntryTotals', () => {
  it('computes the four numbers for a real 1-hour-TTL entry', () => {
    const t = ledgerEntryTotals(REAL_1H_USAGE)!
    expect(t.ce).toBeCloseTo(REAL_1H_CE, 6)
    expect(t.rlit).toBe(REAL_1H_RLIT)
    expect(t.naive).toBe(REAL_1H_NAIVE)
    expect(t.outputTokens).toBe(106)
    expect(t.cacheWriteDrift).toBe(0)
  })

  it('computes the four numbers for a real 5-minute-TTL entry', () => {
    const t = ledgerEntryTotals(REAL_5M_USAGE)!
    expect(t.ce).toBeCloseTo(REAL_5M_CE, 6)
    expect(t.rlit).toBe(2 + 10512)
    expect(t.naive).toBe(2 + 10512 + 5599)
    expect(t.outputTokens).toBe(2)
    expect(t.cacheWriteDrift).toBe(0)
  })

  /** ⚠ HAND-BUILT, AND IT SAYS SO BECAUSE IT CANNOT BE OTHERWISE: 0 of 84,093
   *  real entries carry both TTLs non-zero (10,943 are 5m-only, 73,109 1h-only). */
  it('weights both TTLs when both are present (hand-built — no real entry has both)', () => {
    const t = ledgerEntryTotals({
      input_tokens: 100,
      cache_creation_input_tokens: 300,
      cache_read_input_tokens: 1000,
      output_tokens: 50,
      cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 200 }
    })!
    expect(t.ce).toBeCloseTo(100 + 1.25 * 100 + 2.0 * 200 + 0.1 * 1000, 6)
    expect(t.rlit).toBe(400)
    expect(t.cacheWriteDrift).toBe(0)
  })

  /**
   * ⚠ THE DOUBLE-COUNT REGRESSION TEST. `iterations[0]` repeats the parent
   * exactly, so a scanner that sums it as well lands on precisely 2.00x — a
   * uniform doubling that reads as a plausible total rather than a bug. These
   * assertions fail the moment anyone recurses.
   */
  it('reads the parent usage ONLY — never iterations[], which would double it', () => {
    const t = ledgerEntryTotals(REAL_1H_USAGE)!
    expect(t.ce).toBeCloseTo(REAL_1H_CE, 6)
    expect(t.ce).not.toBeCloseTo(REAL_1H_CE * 2, 6)
    expect(t.rlit).toBe(REAL_1H_RLIT)
    expect(t.rlit).not.toBe(REAL_1H_RLIT * 2)
    expect(t.naive).toBe(REAL_1H_NAIVE)
    expect(t.naive).not.toBe(REAL_1H_NAIVE * 2)
    expect(t.outputTokens).toBe(106)
    expect(t.outputTokens).not.toBe(212)
  })

  it('returns null when the object carries no counters at all', () => {
    expect(ledgerEntryTotals({})).toBeNull()
    expect(ledgerEntryTotals({ service_tier: 'standard' })).toBeNull()
    expect(ledgerEntryTotals(null)).toBeNull()
    expect(ledgerEntryTotals(undefined)).toBeNull()
    expect(ledgerEntryTotals('nope')).toBeNull()
    expect(ledgerEntryTotals(42)).toBeNull()
  })

  it('treats a present-but-zero counter as zero, not as absent', () => {
    const t = ledgerEntryTotals({ input_tokens: 0 })!
    expect(t.ce).toBe(0)
    expect(t.rlit).toBe(0)
    expect(t.naive).toBe(0)
    expect(t.outputTokens).toBe(0)
  })

  it('degrades a malformed counter to zero rather than poisoning the sum with NaN', () => {
    const t = ledgerEntryTotals({
      input_tokens: 'x',
      cache_creation_input_tokens: -5,
      cache_read_input_tokens: Number.NaN,
      output_tokens: Number.POSITIVE_INFINITY
    })!
    expect(t.ce).toBe(0)
    expect(t.rlit).toBe(0)
    expect(t.naive).toBe(0)
    expect(t.outputTokens).toBe(0)
    expect(Number.isFinite(t.ce)).toBe(true)
  })

  it('survives a non-object cache_creation without throwing', () => {
    const t = ledgerEntryTotals({ input_tokens: 5, cache_creation: 'nope' })!
    expect(t.ce).toBe(5)
  })

  /** ⚠ HAND-BUILT — 0 of 84,093 real entries disagree. */
  it('reports drift without throwing when the TTL halves do not sum to the scalar', () => {
    const t = ledgerEntryTotals({
      input_tokens: 0,
      cache_creation_input_tokens: 1000,
      cache_creation: { ephemeral_5m_input_tokens: 400, ephemeral_1h_input_tokens: 200 }
    })!
    // CE keeps the breakdown; RLIT/Naive keep the scalar. Neither silently wins.
    expect(t.ce).toBeCloseTo(1.25 * 400 + 2.0 * 200, 6)
    expect(t.rlit).toBe(1000)
    expect(t.cacheWriteDrift).toBe(600 - 1000)
  })

  it('treats an absent cache_creation as the degenerate drift case', () => {
    const t = ledgerEntryTotals({ input_tokens: 0, cache_creation_input_tokens: 500 })!
    expect(t.ce).toBe(0)
    expect(t.rlit).toBe(500)
    expect(t.cacheWriteDrift).toBe(-500)
  })
})

/* ------------------------------------------------------------------ */
/* The two string rules                                                */
/* ------------------------------------------------------------------ */

describe('subagentDirFor', () => {
  it('preserves a POSIX separator', () => {
    expect(subagentDirFor('/home/u/.claude/projects/enc/abc.jsonl')).toBe(
      '/home/u/.claude/projects/enc/abc/subagents'
    )
  })

  /** ⚠ SEPARATOR PRESERVATION IS THE POINT: `node:path` is banned here because
   *  `path.join` on win32 rewrites `/` to `\`, making one input give different
   *  output on two platforms — a pure function that is not. */
  it('preserves a Windows separator', () => {
    expect(subagentDirFor('C:\\Users\\m\\.claude\\projects\\enc\\abc.jsonl')).toBe(
      'C:\\Users\\m\\.claude\\projects\\enc\\abc\\subagents'
    )
  })

  it('joins with / when the input has no separator at all', () => {
    expect(subagentDirFor('abc.jsonl')).toBe('abc/subagents')
  })

  it('accepts .JSONL case-insensitively', () => {
    expect(subagentDirFor('/a/b.JSONL')).toBe('/a/b/subagents')
  })

  it('returns null rather than a plausible directory for a non-transcript path', () => {
    expect(subagentDirFor('/a/b.meta.json')).toBeNull()
    expect(subagentDirFor('/a/b')).toBeNull()
    expect(subagentDirFor('')).toBeNull()
  })
})

describe('isSubagentTranscriptName', () => {
  it('accepts a real subagent transcript name', () => {
    expect(isSubagentTranscriptName('agent-a462ae42617c35be5.jsonl')).toBe(true)
  })

  /** ⚠ THE 228-VS-227 TRAP. Every subagent transcript has an
   *  `agent-<id>.meta.json` sibling and there is one orphan meta, so a glob of
   *  `agent-*` reads a non-transcript — and that meta carries a human-written
   *  `description`, i.e. content the header note forbids opening. */
  it('REJECTS the agent-<id>.meta.json sibling', () => {
    expect(isSubagentTranscriptName('agent-a462ae42617c35be5.meta.json')).toBe(false)
  })

  it('rejects names that are not agent transcripts', () => {
    expect(isSubagentTranscriptName('foo.jsonl')).toBe(false)
    expect(isSubagentTranscriptName('agent-.jsonl')).toBe(false)
  })

  /** The separator-excluding class doubles as a traversal guard on a name
   *  arriving from readdir. */
  it('rejects any name carrying a path separator', () => {
    expect(isSubagentTranscriptName('../agent-x.jsonl')).toBe(false)
    expect(isSubagentTranscriptName('sub\\agent-x.jsonl')).toBe(false)
    expect(isSubagentTranscriptName('sub/agent-x.jsonl')).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* scanLedger                                                          */
/* ------------------------------------------------------------------ */

describe('scanLedger', () => {
  it('returns zeros rather than null for no sources', () => {
    const r = scanLedger([])
    expect(r.total).toEqual({ ce: 0, rlit: 0, naive: 0, outputTokens: 0, entries: 0 })
    expect(r.subagentSources).toBe(0)
    expect(r.turns).toEqual([])
  })

  it('totals a single real main entry', () => {
    const r = scanLedger([main(line(REAL_1H_USAGE))])
    expect(r.total.entries).toBe(1)
    expect(r.total.ce).toBeCloseTo(REAL_1H_CE, 6)
    expect(r.main.ce).toBeCloseTo(REAL_1H_CE, 6)
    expect(r.subagent.entries).toBe(0)
  })

  it('splits main from subagent and the two sum to the total', () => {
    const r = scanLedger([
      main(line(REAL_1H_USAGE)),
      main(line(REAL_1H_USAGE)),
      sub(line(REAL_5M_USAGE)),
      sub(line(REAL_5M_USAGE)),
      sub(line(REAL_5M_USAGE))
    ])
    expect(r.subagentSources).toBe(3)
    expect(r.main.entries).toBe(2)
    expect(r.subagent.entries).toBe(3)
    expect(r.total.entries).toBe(5)
    for (const k of ['ce', 'rlit', 'naive', 'outputTokens'] as const) {
      expect(r.total[k]).toBeCloseTo(r.main[k] + r.subagent[k], 6)
    }
  })

  /** ✅ REAL-DERIVED: every line of a sampled real subagent file carried
   *  `isSidechain: true` (109 of 109). They are the subagent's OWN turns and are
   *  exactly the cost this ledger exists to surface. */
  it('COUNTS sidechain lines in a subagent source rather than skipping them', () => {
    const r = scanLedger([sub(line(REAL_5M_USAGE, { isSidechain: true }))])
    expect(r.subagent.entries).toBe(1)
    expect(r.subagent.ce).toBeCloseTo(REAL_5M_CE, 6)
  })

  /** ⚠ HAND-BUILT — 0 of 268 real main transcripts carry the flag. The test
   *  pins the DECISION that the flag does not gate the sum anywhere. */
  it('counts a sidechain line in a MAIN source too (hand-built — none exist in nature)', () => {
    const r = scanLedger([main(line(REAL_1H_USAGE, { isSidechain: true }))])
    expect(r.main.entries).toBe(1)
    expect(r.main.ce).toBeCloseTo(REAL_1H_CE, 6)
  })

  it('counts only assistant entries and tallies the rest', () => {
    const text = [
      JSON.stringify({ type: 'user', message: { usage: REAL_1H_USAGE } }),
      JSON.stringify({ type: 'system' }),
      line(REAL_1H_USAGE)
    ].join('\n')
    const r = scanLedger([main(text)])
    expect(r.total.entries).toBe(1)
    expect(r.skips.nonAssistantEntries).toBe(2)
  })

  it('counts an assistant entry with no usage separately from one with zeros', () => {
    const text = [
      JSON.stringify({ type: 'assistant', message: {} }),
      JSON.stringify({ type: 'assistant', message: { usage: {} } }),
      line(REAL_1H_USAGE)
    ].join('\n')
    const r = scanLedger([main(text)])
    expect(r.skips.assistantEntriesWithoutUsage).toBe(2)
    expect(r.total.entries).toBe(1)
  })

  /** ⚠ HAND-BUILT: a trailing partial line is normal, because a transcript is
   *  appended to while it is read. The surrounding real lines must still total. */
  it('skips malformed input in silence and still totals the good lines', () => {
    const partial = line(REAL_1H_USAGE).slice(0, 60)
    const text = [
      line(REAL_1H_USAGE),
      '',
      '   ',
      'not json at all',
      '[1,2,3]',
      'null',
      partial,
      line(REAL_1H_USAGE)
    ].join('\n')
    const r = scanLedger([main(text)])
    expect(r.total.entries).toBe(2)
    expect(r.total.ce).toBeCloseTo(REAL_1H_CE * 2, 6)
    expect(r.skips.unparseableLines).toBeGreaterThanOrEqual(1)
  })

  it('does not throw on any malformed shape', () => {
    expect(() => scanLedger([main('null'), main('[]'), main('{}'), main('')])).not.toThrow()
  })

  it('orders turns ascending by at, with null-at turns last', () => {
    const at = (ts: string | undefined): string =>
      JSON.stringify({
        type: 'assistant',
        message: { usage: REAL_1H_USAGE },
        ...(ts === undefined ? {} : { timestamp: ts })
      })
    const r = scanLedger([
      main([at('2026-08-28T15:22:03.000Z'), at(undefined)].join('\n')),
      sub([at('2026-08-28T15:22:01.000Z'), at('2026-08-28T15:22:02.000Z')].join('\n'))
    ])
    expect(r.turns).toHaveLength(4)
    expect(r.turns.slice(0, 3).map((t) => t.at)).toEqual([
      Date.parse('2026-08-28T15:22:01.000Z'),
      Date.parse('2026-08-28T15:22:02.000Z'),
      Date.parse('2026-08-28T15:22:03.000Z')
    ])
    expect(r.turns[3].at).toBeNull()
    // Interleaved across origins, which is what makes a caller's window fold work.
    expect(r.turns.slice(0, 3).map((t) => t.origin)).toEqual(['subagent', 'subagent', 'main'])
    expect(r.skips.turnsWithoutTimestamp).toBe(1)
  })

  it('counts an unparseable timestamp as a null-at turn, not as a dropped one', () => {
    const r = scanLedger([
      main(JSON.stringify({ type: 'assistant', timestamp: 'never', message: { usage: REAL_1H_USAGE } }))
    ])
    expect(r.total.entries).toBe(1)
    expect(r.turns[0].at).toBeNull()
    expect(r.skips.turnsWithoutTimestamp).toBe(1)
  })

  it('reports consistency across the scan without throwing', () => {
    const bad = line({
      input_tokens: 0,
      cache_creation_input_tokens: 1000,
      cache_creation: { ephemeral_5m_input_tokens: 400, ephemeral_1h_input_tokens: 200 }
    })
    const r = scanLedger([main([line(REAL_1H_USAGE), bad].join('\n'))])
    expect(r.consistency.checked).toBe(2)
    expect(r.consistency.mismatches).toBe(1)
    expect(r.consistency.driftTokens).toBe(-400)
  })

  it('reports zero mismatches for real entries', () => {
    const r = scanLedger([main(line(REAL_1H_USAGE)), sub(line(REAL_5M_USAGE))])
    expect(r.consistency.mismatches).toBe(0)
    expect(r.consistency.driftTokens).toBe(0)
  })

  /**
   * ⚠ THE HEADER NOTE'S INVARIANT, AS AN ASSERTION, AND THE ONE TEST THAT FAILS
   * WHEN SOMEONE LATER ADDS A HELPFUL `fileName` FIELD. Content never leaves
   * this module: the only strings the result may contain are the two origin
   * discriminators.
   */
  it('returns NO string anywhere except the origin discriminators', () => {
    const r = scanLedger([
      main(line(REAL_1H_USAGE, { cwd: 'C:/secret/path', gitBranch: 'feature/private' })),
      sub(line(REAL_5M_USAGE, { isSidechain: true, agentId: 'agent-abc' }))
    ])
    const strings: string[] = []
    const walk = (v: unknown): void => {
      if (typeof v === 'string') strings.push(v)
      else if (Array.isArray(v)) v.forEach(walk)
      else if (v !== null && typeof v === 'object') Object.values(v).forEach(walk)
    }
    walk(r)
    expect(strings.every((s) => s === 'main' || s === 'subagent')).toBe(true)
    expect(JSON.stringify(r)).not.toContain('secret')
    expect(JSON.stringify(r)).not.toContain('feature/private')
    expect(JSON.stringify(r)).not.toContain('agent-abc')
  })

  it('holds main + subagent === total on a mixed scan with skips and drift', () => {
    const r = scanLedger([
      main([line(REAL_1H_USAGE), 'garbage', JSON.stringify({ type: 'user' })].join('\n')),
      sub([line(REAL_5M_USAGE), line(REAL_5M_USAGE)].join('\n'))
    ])
    expect(r.total.entries).toBe(r.main.entries + r.subagent.entries)
    expect(r.total.ce).toBeCloseTo(r.main.ce + r.subagent.ce, 6)
    expect(r.total.rlit).toBe(r.main.rlit + r.subagent.rlit)
    expect(r.total.naive).toBe(r.main.naive + r.subagent.naive)
    expect(r.total.outputTokens).toBe(r.main.outputTokens + r.subagent.outputTokens)
  })
})
