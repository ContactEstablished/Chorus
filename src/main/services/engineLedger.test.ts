import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync, truncateSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEngineLedgerTracker, type EngineLedgerTracker } from './engineLedger'

/**
 * These tests drive the IMPURE half: the cursor, the directory walk, the
 * edge-triggered broadcast. The arithmetic belongs to `engineLedgerCore` and is
 * tested there — nothing here re-asserts a sum that module already owns.
 *
 * Real fixture directories on disk, no mocked `fs`: the three hazards being
 * tested (a partial trailing line, truncation, a vanished file) are properties
 * of a real filesystem, and a mock would only assert that the mock behaves as
 * the author already believed.
 */

const dirs: string[] = []
const trackers: EngineLedgerTracker[] = []

afterEach(() => {
  for (const t of trackers.splice(0)) t.dispose()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  vi.useRealTimers()
})

function scratch(): string {
  const d = mkdtempSync(join(tmpdir(), 'engine-ledger-'))
  dirs.push(d)
  return d
}

function tracker(): EngineLedgerTracker {
  const t = createEngineLedgerTracker()
  trackers.push(t)
  return t
}

/** ✅ REAL-DERIVED usage shape (a 1-hour-TTL entry, copied verbatim). */
const USAGE = {
  input_tokens: 2,
  cache_creation_input_tokens: 17996,
  cache_read_input_tokens: 27883,
  output_tokens: 106,
  cache_creation: { ephemeral_1h_input_tokens: 17996, ephemeral_5m_input_tokens: 0 }
}

const entry = (): string =>
  JSON.stringify({
    type: 'assistant',
    timestamp: '2026-08-28T15:22:00.069Z',
    message: { usage: USAGE }
  }) + '\n'

/** Wait for the fire-and-forget scan to settle. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 30))

describe('createEngineLedgerTracker', () => {
  it('records a transcript path WITHOUT reading anything', async () => {
    const dir = scratch()
    const main = join(dir, 'sess.jsonl')
    writeFileSync(main, entry())
    const t = tracker()

    t.noteTranscript('s1', main)
    // ⚠ The whole design rests on this: noting is a map write, never a read.
    expect(t.ledgerFor('s1')).toBeNull()
    expect(t.snapshot()).toEqual([])

    t.refresh('s1')
    await settle()
    expect(t.ledgerFor('s1')!.entries).toBe(1)
  })

  it('scans a main file with no subagents directory', async () => {
    const dir = scratch()
    const main = join(dir, 'sess.jsonl')
    writeFileSync(main, entry() + entry())
    const t = tracker()
    t.noteTranscript('s1', main)
    t.refresh('s1')
    await settle()

    const l = t.ledgerFor('s1')!
    expect(l.entries).toBe(2)
    expect(l.files).toBe(1)
    expect(l.subagentFiles).toBe(0)
    expect(l.rlit).toBe((2 + 17996) * 2)
  })

  it('includes the subagents directory and counts those files apart', async () => {
    const dir = scratch()
    const main = join(dir, 'sess.jsonl')
    writeFileSync(main, entry())
    const subs = join(dir, 'sess', 'subagents')
    mkdirSync(subs, { recursive: true })
    writeFileSync(join(subs, 'agent-a1.jsonl'), entry())
    writeFileSync(join(subs, 'agent-a2.jsonl'), entry())

    const t = tracker()
    t.noteTranscript('s1', main)
    t.refresh('s1')
    await settle()

    const l = t.ledgerFor('s1')!
    expect(l.entries).toBe(3)
    expect(l.files).toBe(3)
    expect(l.subagentFiles).toBe(2)
  })

  /**
   * ⚠ THE 228-VS-227 TRAP, AT THE SERVICE LEVEL. Every subagent transcript has
   * an `agent-<id>.meta.json` sibling carrying a human-written `description`.
   * Opening one would put CONTENT into a module whose header promises only
   * counters leave it.
   */
  it('never opens an agent-<id>.meta.json sibling', async () => {
    const dir = scratch()
    const main = join(dir, 'sess.jsonl')
    writeFileSync(main, entry())
    const subs = join(dir, 'sess', 'subagents')
    mkdirSync(subs, { recursive: true })
    writeFileSync(join(subs, 'agent-a1.jsonl'), entry())
    writeFileSync(
      join(subs, 'agent-a1.meta.json'),
      JSON.stringify({ agentType: 'spec-writer', description: 'Write Impl-18-3', spawnDepth: 1 })
    )

    const t = tracker()
    t.noteTranscript('s1', main)
    t.refresh('s1')
    await settle()

    // Two transcripts, not three files — the meta was not counted or read.
    expect(t.ledgerFor('s1')!.files).toBe(2)
    expect(t.ledgerFor('s1')!.subagentFiles).toBe(1)
  })

  /**
   * ⚠ THE SHARPEST BUG AN INCREMENTAL READER HAS. The file is appended to while
   * it is read, so the tail is routinely half an object. The cursor must stop
   * at the last newline, and the completed line must total the same as if the
   * whole file had been read at once — no drop, no double count.
   */
  it('does not parse a partial trailing line, and totals the same once it completes', async () => {
    const dir = scratch()
    const main = join(dir, 'sess.jsonl')
    const whole = entry()
    writeFileSync(main, whole + whole.slice(0, 40)) // second line cut mid-object

    const t = tracker()
    t.noteTranscript('s1', main)
    t.refresh('s1')
    await settle()
    expect(t.ledgerFor('s1')!.entries).toBe(1)

    // The rest of that line arrives.
    appendFileSync(main, whole.slice(40))
    t.refresh('s1')
    await settle()
    expect(t.ledgerFor('s1')!.entries).toBe(2)

    // And the incremental result equals a single whole-file scan.
    const fresh = tracker()
    fresh.noteTranscript('s2', main)
    fresh.refresh('s2')
    await settle()
    expect(t.ledgerFor('s1')!.entries).toBe(fresh.ledgerFor('s2')!.entries)
    expect(t.ledgerFor('s1')!.rlit).toBe(fresh.ledgerFor('s2')!.rlit)
  })

  it('adds only the new bytes on a rescan rather than re-counting the file', async () => {
    const dir = scratch()
    const main = join(dir, 'sess.jsonl')
    writeFileSync(main, entry())
    const t = tracker()
    t.noteTranscript('s1', main)
    t.refresh('s1')
    await settle()
    expect(t.ledgerFor('s1')!.entries).toBe(1)

    appendFileSync(main, entry())
    t.refresh('s1')
    await settle()
    expect(t.ledgerFor('s1')!.entries).toBe(2)
  })

  /** ⚠ A file smaller than the cursor is not the file we were reading. */
  it('rescans whole when the file is truncated rather than going backwards', async () => {
    const dir = scratch()
    const main = join(dir, 'sess.jsonl')
    writeFileSync(main, entry() + entry() + entry())
    const t = tracker()
    t.noteTranscript('s1', main)
    t.refresh('s1')
    await settle()
    expect(t.ledgerFor('s1')!.entries).toBe(3)

    // Compacted down to one entry.
    truncateSync(main, 0)
    writeFileSync(main, entry())
    t.refresh('s1')
    await settle()

    // The rescan re-read from zero; the count moved forward, never backwards,
    // and nothing produced a negative delta.
    const l = t.ledgerFor('s1')!
    expect(l.entries).toBeGreaterThanOrEqual(3)
    expect(l.ce).toBeGreaterThan(0)
    expect(l.rlit).toBeGreaterThan(0)
  })

  it('drops a vanished file in silence', async () => {
    const dir = scratch()
    const main = join(dir, 'sess.jsonl')
    writeFileSync(main, entry())
    const t = tracker()
    t.noteTranscript('s1', main)
    t.refresh('s1')
    await settle()
    expect(t.ledgerFor('s1')!.entries).toBe(1)

    rmSync(main)
    expect(() => t.refresh('s1')).not.toThrow()
    await settle()
    // The last good totals stand; files drops to zero.
    expect(t.ledgerFor('s1')!.entries).toBe(1)
    expect(t.ledgerFor('s1')!.files).toBe(0)
  })

  it('is ABSENT from snapshot() for a session that was never scanned', async () => {
    const dir = scratch()
    const main = join(dir, 'sess.jsonl')
    writeFileSync(main, entry())
    const t = tracker()
    t.noteTranscript('s1', main)

    // ⚠ Absent, not a row of zeros: "we have not measured this" and "this cost
    // nothing" are different claims and must not share a representation.
    expect(t.snapshot()).toEqual([])
    t.refresh('s1')
    await settle()
    expect(t.snapshot()).toHaveLength(1)
    expect(t.snapshot()[0].sessionId).toBe('s1')
  })

  it('broadcasts on new bytes and stays silent when a rescan finds none', async () => {
    const dir = scratch()
    const main = join(dir, 'sess.jsonl')
    writeFileSync(main, entry())
    const t = tracker()
    const seen = vi.fn()
    t.onLedger(seen)

    t.noteTranscript('s1', main)
    t.refresh('s1')
    await settle()
    expect(seen).toHaveBeenCalledTimes(1)

    // Nothing appended — edge-triggered, so no second event.
    t.refresh('s1')
    await settle()
    expect(seen).toHaveBeenCalledTimes(1)

    appendFileSync(main, entry())
    t.refresh('s1')
    await settle()
    expect(seen).toHaveBeenCalledTimes(2)
  })

  it('keeps broadcasting to the other listeners when one throws', async () => {
    const dir = scratch()
    const main = join(dir, 'sess.jsonl')
    writeFileSync(main, entry())
    const t = tracker()
    const good = vi.fn()
    t.onLedger(() => {
      throw new Error('bad listener')
    })
    t.onLedger(good)

    t.noteTranscript('s1', main)
    expect(() => t.refresh('s1')).not.toThrow()
    await settle()
    expect(good).toHaveBeenCalledTimes(1)
  })

  it('unsubscribes cleanly', async () => {
    const dir = scratch()
    const main = join(dir, 'sess.jsonl')
    writeFileSync(main, entry())
    const t = tracker()
    const seen = vi.fn()
    const off = t.onLedger(seen)
    off()

    t.noteTranscript('s1', main)
    t.refresh('s1')
    await settle()
    expect(seen).not.toHaveBeenCalled()
  })

  it('forgets a session, and a new transcript path resets its totals', async () => {
    const dir = scratch()
    const a = join(dir, 'a.jsonl')
    const b = join(dir, 'b.jsonl')
    writeFileSync(a, entry())
    writeFileSync(b, entry())
    const t = tracker()

    t.noteTranscript('s1', a)
    t.refresh('s1')
    await settle()
    expect(t.ledgerFor('s1')!.entries).toBe(1)

    // A different path under the same id is a new conversation.
    t.noteTranscript('s1', b)
    expect(t.ledgerFor('s1')).toBeNull()
    t.refresh('s1')
    await settle()
    expect(t.ledgerFor('s1')!.entries).toBe(1)

    t.forget('s1')
    expect(t.ledgerFor('s1')).toBeNull()
    expect(t.snapshot()).toEqual([])
  })

  it('returns plain objects from snapshot(), safe for structured clone (D14)', async () => {
    const dir = scratch()
    const main = join(dir, 'sess.jsonl')
    writeFileSync(main, entry())
    const t = tracker()
    t.noteTranscript('s1', main)
    t.refresh('s1')
    await settle()

    const snap = t.snapshot()
    expect(() => structuredClone(snap)).not.toThrow()
    // ⚠ Every value in the totals is a number: content could only cross the
    // bridge as a string, so this is the security property, not a style note.
    expect(Object.values(snap[0].ledger).every((v) => typeof v === 'number')).toBe(true)
  })

  it('ignores refresh for an unknown session and after dispose', async () => {
    const t = tracker()
    expect(() => t.refresh('nope')).not.toThrow()
    t.dispose()
    expect(() => t.refresh('nope')).not.toThrow()
    expect(t.snapshot()).toEqual([])
  })
})
