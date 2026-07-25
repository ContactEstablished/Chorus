import { describe, expect, it } from 'vitest'
import { createSubscriptionMeter, encodeProjectDir, type MeterFs } from './subscriptionMeter'

// Task 3a-3: fixture-driven parse tests for the subscription meter.
//
// ⚠ THE FIXTURES CONTAIN NO KEY MATERIAL, and cannot: this module reads token
// COUNTS out of a CLI's own local logs. It has no network, no key, and no way
// to route anything anywhere — which is the property the tests exist to keep.
//
// The fixture shape was read off THIS MACHINE's real Claude Code install
// (2026-07-25), not written from memory.

const CWD = 'C:\\Projects\\ContactEstablished\\Chorus'
const DIR = 'C--Projects-ContactEstablished-Chorus'
const ROOT = 'X:\\fake\\.claude\\projects'
const SEP = '\\'

function line(opts: {
  at: string
  sessionId?: string
  input?: number
  output?: number
  cacheWrite?: number
  cacheRead?: number
}): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: opts.at,
    cwd: CWD,
    sessionId: opts.sessionId ?? 'sess-a',
    message: {
      model: 'claude-opus-5',
      usage: {
        input_tokens: opts.input ?? 0,
        output_tokens: opts.output ?? 0,
        cache_creation_input_tokens: opts.cacheWrite ?? 0,
        cache_read_input_tokens: opts.cacheRead ?? 0
      }
    }
  })
}

/** An in-memory MeterFs. Every file's mtime is "now" unless overridden, so the
 *  mtime shortcut never accidentally hides a fixture. */
function fakeFs(files: Record<string, string>, mtimes: Record<string, number> = {}): MeterFs {
  return {
    existsSync: (p) => p === `${ROOT}${SEP}${DIR}` || p in files,
    readdirSync: () => Object.keys(files).map((f) => f.split(SEP).pop() as string),
    statSync: (p) => ({ mtimeMs: mtimes[p] ?? Date.now() }),
    readFileSync: (p) => files[p] ?? ''
  }
}

function meterWith(files: Record<string, string>, mtimes?: Record<string, number>) {
  return createSubscriptionMeter({ fsImpl: fakeFs(files, mtimes), projectsRoot: ROOT })
}

const WINDOW = { startedAt: '2026-07-25T12:00:00.000Z', endedAt: '2026-07-25T12:10:00.000Z' }

describe('encodeProjectDir — read off this machine, not from memory', () => {
  it('maps the drive colon and every separator to a dash', () => {
    expect(encodeProjectDir(CWD)).toBe(DIR)
  })

  it('leaves existing dashes alone', () => {
    expect(encodeProjectDir('C:\\Projects\\Bryk-Site\\Bryk')).toBe('C--Projects-Bryk-Site-Bryk')
  })

  it('handles forward slashes too', () => {
    expect(encodeProjectDir('C:/Projects/ContactEstablished/Chorus')).toBe(DIR)
  })
})

describe('summing usage across a window', () => {
  it('reports the three token numbers with cached as a SUBSET of tokensIn', () => {
    const file = `${ROOT}${SEP}${DIR}${SEP}sess-a.jsonl`
    const meter = meterWith({
      [file]: [
        line({ at: '2026-07-25T12:01:00.000Z', input: 100, output: 20, cacheWrite: 30, cacheRead: 400 }),
        line({ at: '2026-07-25T12:02:00.000Z', input: 50, output: 10, cacheWrite: 0, cacheRead: 200 })
      ].join('\n')
    })
    const result = meter.meter({ cwd: CWD, ...WINDOW })
    // tokensIn is the TOTAL prompt volume (fresh + cache writes + cache reads),
    // matching the convention the analytics path uses, so the column means one
    // thing regardless of which source filled it.
    expect(result).toEqual({
      tokensIn: 100 + 30 + 400 + 50 + 0 + 200,
      tokensOut: 30,
      tokensCached: 600,
      source: 'cli-logs'
    })
    // The subset relationship holds, which is what makes the two columns
    // additive rather than double-counting.
    expect(result!.tokensCached!).toBeLessThan(result!.tokensIn!)
  })

  it('labels its output cli-logs so no consumer mistakes it for gateway-grade data', () => {
    const file = `${ROOT}${SEP}${DIR}${SEP}sess-a.jsonl`
    const meter = meterWith({ [file]: line({ at: '2026-07-25T12:01:00.000Z', input: 1, output: 1 }) })
    expect(meter.meter({ cwd: CWD, ...WINDOW })!.source).toBe('cli-logs')
  })

  it('ignores entries outside the window', () => {
    const file = `${ROOT}${SEP}${DIR}${SEP}sess-a.jsonl`
    const meter = meterWith({
      [file]: [
        line({ at: '2026-07-25T11:59:59.000Z', input: 9999, output: 9999 }), // before
        line({ at: '2026-07-25T12:05:00.000Z', input: 10, output: 5 }), // inside
        line({ at: '2026-07-25T12:10:01.000Z', input: 8888, output: 8888 }) // after
      ].join('\n')
    })
    expect(meter.meter({ cwd: CWD, ...WINDOW })).toEqual({
      tokensIn: 10,
      tokensOut: 5,
      tokensCached: 0,
      source: 'cli-logs'
    })
  })
})

describe('unknown is a real answer — and it is never a zero', () => {
  it('returns null when the project directory does not exist', () => {
    const meter = meterWith({})
    expect(meter.meter({ cwd: 'C:\\Nowhere', ...WINDOW })).toBeNull()
  })

  it('returns null when no entry falls in the window', () => {
    const file = `${ROOT}${SEP}${DIR}${SEP}sess-a.jsonl`
    const meter = meterWith({ [file]: line({ at: '2026-07-25T09:00:00.000Z', input: 5 }) })
    expect(meter.meter({ cwd: CWD, ...WINDOW })).toBeNull()
  })

  it('returns null for a malformed log rather than a fabricated number', () => {
    const file = `${ROOT}${SEP}${DIR}${SEP}sess-a.jsonl`
    const meter = meterWith({ [file]: 'not json at all\n{"also":"not a usage line"}\n' })
    expect(meter.meter({ cwd: CWD, ...WINDOW })).toBeNull()
  })

  it('returns null for an inverted or unparseable window', () => {
    const file = `${ROOT}${SEP}${DIR}${SEP}sess-a.jsonl`
    const meter = meterWith({ [file]: line({ at: '2026-07-25T12:01:00.000Z', input: 5 }) })
    expect(meter.meter({ cwd: CWD, startedAt: WINDOW.endedAt, endedAt: WINDOW.startedAt })).toBeNull()
    expect(meter.meter({ cwd: CWD, startedAt: 'nonsense', endedAt: WINDOW.endedAt })).toBeNull()
  })

  it('never throws when the filesystem does', () => {
    const meter = createSubscriptionMeter({
      projectsRoot: ROOT,
      fsImpl: {
        existsSync: () => true,
        readdirSync: () => {
          throw new Error('EACCES')
        },
        statSync: () => ({ mtimeMs: 0 }),
        readFileSync: () => ''
      }
    })
    expect(meter.meter({ cwd: CWD, ...WINDOW })).toBeNull()
  })

  it('tolerates a partially-flushed final line', () => {
    const file = `${ROOT}${SEP}${DIR}${SEP}sess-a.jsonl`
    const meter = meterWith({
      [file]: line({ at: '2026-07-25T12:01:00.000Z', input: 7, output: 3 }) + '\n{"timestamp":"2026-07-2'
    })
    expect(meter.meter({ cwd: CWD, ...WINDOW })).toEqual({
      tokensIn: 7,
      tokensOut: 3,
      tokensCached: 0,
      source: 'cli-logs'
    })
  })
})

describe('⚠ the ambiguity guard — a confidently wrong number is worse than none', () => {
  it('returns null when TWO CLI sessions have usage inside the same window', () => {
    const a = `${ROOT}${SEP}${DIR}${SEP}sess-a.jsonl`
    const b = `${ROOT}${SEP}${DIR}${SEP}sess-b.jsonl`
    const meter = meterWith({
      [a]: line({ at: '2026-07-25T12:01:00.000Z', sessionId: 'sess-a', input: 100, output: 10 }),
      [b]: line({ at: '2026-07-25T12:02:00.000Z', sessionId: 'sess-b', input: 200, output: 20 })
    })
    // Summing them would attribute another pane's work to this dispatch —
    // several agents routinely share a cwd on this machine.
    expect(meter.meter({ cwd: CWD, ...WINDOW })).toBeNull()
  })

  it('still attributes when the two files belong to the SAME CLI session', () => {
    const a = `${ROOT}${SEP}${DIR}${SEP}part-1.jsonl`
    const b = `${ROOT}${SEP}${DIR}${SEP}part-2.jsonl`
    const meter = meterWith({
      [a]: line({ at: '2026-07-25T12:01:00.000Z', sessionId: 'sess-a', input: 100, output: 10 }),
      [b]: line({ at: '2026-07-25T12:02:00.000Z', sessionId: 'sess-a', input: 200, output: 20 })
    })
    expect(meter.meter({ cwd: CWD, ...WINDOW })).toEqual({
      tokensIn: 300,
      tokensOut: 30,
      tokensCached: 0,
      source: 'cli-logs'
    })
  })
})

describe('the mtime shortcut', () => {
  it('skips files last written before the dispatch began', () => {
    const stale = `${ROOT}${SEP}${DIR}${SEP}stale.jsonl`
    const meter = meterWith(
      { [stale]: line({ at: '2026-07-25T12:01:00.000Z', input: 999 }) },
      { [stale]: Date.parse('2026-07-25T11:00:00.000Z') }
    )
    // The entry claims to be inside the window, but the file has not been
    // touched since before it began — it cannot be this dispatch's.
    expect(meter.meter({ cwd: CWD, ...WINDOW })).toBeNull()
  })
})
