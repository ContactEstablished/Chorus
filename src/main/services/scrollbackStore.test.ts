import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createScrollbackStore, safeName, type ScrollbackStore } from './scrollbackStore'

let dir: string
let store: ScrollbackStore

/** `append` is fire-and-forget by contract, so a test has to wait for the write
 *  CHAIN, not for the call.
 *
 *  ⚠ A `setTimeout` HERE WOULD BE A FLAKE, not a shortcut: the ordering and cap
 *  guarantees below are precisely the ones a test that sometimes samples
 *  mid-chain stops protecting — which is how the first draft of this file
 *  "failed" on a 50-chunk write that was simply still running. */
const settle = (s: ScrollbackStore = store): Promise<void> => s.whenIdle()

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'chorus-scrollback-test-'))
  store = createScrollbackStore(dir)
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('safeName — path traversal is refused explicitly', () => {
  it('accepts the ids Chorus actually mints (randomUUID)', () => {
    expect(safeName('7dd104c0-4fb5-4ae8-9e00-63172b5d1739')).toBe(
      '7dd104c0-4fb5-4ae8-9e00-63172b5d1739.log'
    )
  })

  it('refuses traversal, separators, dots and emptiness', () => {
    // `.` is excluded from the allow-list outright, which makes `..`
    // unrepresentable rather than merely filtered.
    expect(safeName('../../etc/passwd')).toBeNull()
    expect(safeName('..')).toBeNull()
    expect(safeName('.')).toBeNull()
    expect(safeName('a/b')).toBeNull()
    expect(safeName('a\\b')).toBeNull()
    expect(safeName('C:evil')).toBeNull()
    expect(safeName('')).toBeNull()
    expect(safeName('a'.repeat(129))).toBeNull()
  })

  it('refuses an unsafe id at the store boundary too — nothing is written', async () => {
    store.append('../escape', 'should never land')
    await settle()
    expect(existsSync(join(dir, '..', 'escape.log'))).toBe(false)
    expect(store.readTail('../escape')).toBe('')
  })
})

describe('append / readTail round trip', () => {
  it('round-trips a single chunk', async () => {
    store.append('s1', 'hello world')
    await settle()
    expect(store.readTail('s1')).toBe('hello world')
  })

  it('preserves order across many chunks (the per-session write chain)', async () => {
    for (let i = 0; i < 50; i++) store.append('s1', `${i},`)
    await settle()
    const expected = Array.from({ length: 50 }, (_, i) => `${i},`).join('')
    expect(store.readTail('s1')).toBe(expected)
  })

  it('keeps sessions in separate files', async () => {
    store.append('s1', 'one')
    store.append('s2', 'two')
    await settle()
    expect(store.readTail('s1')).toBe('one')
    expect(store.readTail('s2')).toBe('two')
  })

  it('ignores an empty chunk without creating a file', async () => {
    store.append('s1', '')
    await settle()
    expect(existsSync(join(dir, 's1.log'))).toBe(false)
  })

  it('continues a mirror written by an earlier run — a restored session appends', async () => {
    writeFileSync(join(dir, 's1.log'), 'FROM-LAST-RUN:')
    store.append('s1', 'and-now')
    await settle()
    expect(store.readTail('s1')).toBe('FROM-LAST-RUN:and-now')
  })
})

describe('readTail degrades, never throws', () => {
  it('reads a missing file as empty', () => {
    expect(store.readTail('never-existed')).toBe('')
  })

  it('reads a missing DIRECTORY as empty', () => {
    rmSync(dir, { recursive: true, force: true })
    expect(store.readTail('s1')).toBe('')
  })

  it('tails a file that is over the cap', async () => {
    const small = createScrollbackStore(dir, { maxChars: 10 })
    writeFileSync(join(dir, 's1.log'), 'abcdefghijklmnop')
    expect(small.readTail('s1')).toBe('ghijklmnop')
    await settle(small)
  })
})

describe('the cap, enforced on write with a slack margin', () => {
  it('lets the file sit between the cap and the slack threshold — no rewrite', async () => {
    const small = createScrollbackStore(dir, { maxChars: 100, slackRatio: 1.25 })
    small.append('s1', 'x'.repeat(120))
    await settle(small)
    // 120 chars is over the 100 cap but under the 125 threshold: still whole on
    // disk, because rewriting here is the cost the slack margin exists to avoid.
    expect(readFileSync(join(dir, 's1.log'), 'utf8')).toHaveLength(120)
    // ...and a READ still honours the cap.
    expect(small.readTail('s1')).toHaveLength(100)
  })

  it('rewrites to exactly the cap once the slack threshold is passed', async () => {
    const small = createScrollbackStore(dir, { maxChars: 100, slackRatio: 1.25 })
    small.append('s1', 'A'.repeat(100))
    small.append('s1', 'B'.repeat(50))
    await settle(small)
    const onDisk = readFileSync(join(dir, 's1.log'), 'utf8')
    expect(onDisk).toHaveLength(100)
    // The TAIL survived: the newest 50 B's, plus the newest 50 A's.
    expect(onDisk.endsWith('B'.repeat(50))).toBe(true)
    expect(onDisk).toBe('A'.repeat(50) + 'B'.repeat(50))
  })

  it('leaves no .tmp behind after a rewrite', async () => {
    const small = createScrollbackStore(dir, { maxChars: 100, slackRatio: 1.25 })
    small.append('s1', 'x'.repeat(500))
    await settle(small)
    expect(existsSync(join(dir, 's1.log.tmp'))).toBe(false)
    expect(readFileSync(join(dir, 's1.log'), 'utf8')).toHaveLength(100)
  })

  it('plateaus rather than growing without bound', async () => {
    const small = createScrollbackStore(dir, { maxChars: 100, slackRatio: 1.25 })
    for (let i = 0; i < 40; i++) small.append('s1', 'y'.repeat(20))
    await settle(small)
    expect(readFileSync(join(dir, 's1.log'), 'utf8').length).toBeLessThanOrEqual(125)
  })
})

describe('remove — the file dies with its row (D16 (d))', () => {
  it('deletes the file', async () => {
    store.append('s1', 'data')
    await settle()
    expect(existsSync(join(dir, 's1.log'))).toBe(true)
    store.remove('s1')
    expect(existsSync(join(dir, 's1.log'))).toBe(false)
  })

  it('is a no-op for a missing file', () => {
    expect(() => store.remove('never-existed')).not.toThrow()
  })

  it('a chunk queued before the remove does not resurrect the file', async () => {
    store.append('s1', 'queued-but-doomed')
    store.remove('s1')
    await settle()
    expect(existsSync(join(dir, 's1.log'))).toBe(false)
  })

  it('a session that appends again after a remove starts a fresh mirror', async () => {
    store.append('s1', 'first')
    await settle()
    store.remove('s1')
    store.append('s1', 'second')
    await settle()
    expect(store.readTail('s1')).toBe('second')
  })
})

describe('pruneOrphans — the boot sweep', () => {
  it('deletes mirrors with no live row and keeps the ones that have one', async () => {
    store.append('live-1', 'keep me')
    store.append('dead-1', 'sweep me')
    await settle()
    const fresh = createScrollbackStore(dir)
    expect(fresh.pruneOrphans(new Set(['live-1']))).toBe(1)
    expect(existsSync(join(dir, 'live-1.log'))).toBe(true)
    expect(existsSync(join(dir, 'dead-1.log'))).toBe(false)
  })

  it('never sweeps a mirror THIS run is writing, even with no row for it', async () => {
    // The boot race: a session created after the id snapshot was taken.
    store.append('brand-new', 'just launched')
    await settle()
    expect(store.pruneOrphans(new Set<string>())).toBe(0)
    expect(existsSync(join(dir, 'brand-new.log'))).toBe(true)
  })

  it('sweeps crash debris (.log.tmp) regardless of the row', () => {
    writeFileSync(join(dir, 'x.log.tmp'), 'half a rewrite')
    const fresh = createScrollbackStore(dir)
    expect(fresh.pruneOrphans(new Set(['x']))).toBe(1)
    expect(existsSync(join(dir, 'x.log.tmp'))).toBe(false)
  })

  it('ignores files that are not mirrors', () => {
    writeFileSync(join(dir, 'notes.txt'), 'unrelated')
    const fresh = createScrollbackStore(dir)
    expect(fresh.pruneOrphans(new Set<string>())).toBe(0)
    expect(existsSync(join(dir, 'notes.txt'))).toBe(true)
  })

  it('is a no-op — not a throw — when the directory does not exist', () => {
    rmSync(dir, { recursive: true, force: true })
    const fresh = createScrollbackStore(dir)
    expect(fresh.pruneOrphans(new Set<string>())).toBe(0)
  })
})

describe('the store never throws into its caller', () => {
  it('append survives a directory that cannot be created', async () => {
    // A file where the directory should be: mkdir fails for every write.
    const blocked = join(dir, 'blocked')
    writeFileSync(blocked, 'not a directory')
    const wedged = createScrollbackStore(blocked)
    expect(() => wedged.append('s1', 'data')).not.toThrow()
    await settle(wedged)
    expect(wedged.readTail('s1')).toBe('')
  })
})
