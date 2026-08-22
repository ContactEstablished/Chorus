import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ALL_INDEX_STATEMENTS,
  batched,
  baseName,
  buildRows,
  directoryChain,
  extensionOf,
  INDEX_BATCH_SIZE,
  INDEX_COMMIT_LIMIT,
  LOG_FIELD_SEP,
  LOG_RECORD_PREFIX,
  normalizeRelPath,
  parseGitLogNameOnly,
  repoIdFrom,
  UPSERT_PROJECT,
  workspaceInstanceIdFor
} from './codeIndexCore'

/**
 * Task 6a-2's pure core.
 *
 * ⚠ THE LOG PARSER IS DRIVEN BY CAPTURED BYTES, NOT BY A HAND-TYPED FIXTURE.
 * `_verify/6a-2/log-name-only.txt` is 200 real records from this repository,
 * taken with the spec's §0 invocation before the parser was written. Two
 * framing facts came out of that capture and neither was guessable from the
 * flags: a commit touching NO files has no blank line after it (ten merges and
 * four empty commits in that window), while a commit that does have files is
 * followed by one.
 *
 * ⚠ AND THE NO-DELETION TEST IS THE PROVENANCE TRAP TURNED INTO A GUARD. A
 * `:Memory` counts as sourced only while its `SUPPORTED_BY` target exists, so
 * an indexer that deleted a `:File` would make the project's trust ratio fall
 * *because a refresh ran*. That cannot be left to review.
 */

/** The captured evidence. Read from disk on purpose: if the capture is ever
 *  deleted, this suite fails loudly rather than quietly falling back to an
 *  invented fixture that proves nothing. */
const CAPTURED_LOG = readFileSync(
  join(__dirname, '../../../_verify/6a-2/log-name-only.txt'),
  'utf8'
)

describe('6a-2: path identity (identity model §4)', () => {
  it('converts separators, strips ./ and trailing slashes', () => {
    expect(normalizeRelPath('src\\main\\ipc.ts')).toEqual({ ok: true, value: 'src/main/ipc.ts' })
    expect(normalizeRelPath('./src/a.ts')).toEqual({ ok: true, value: 'src/a.ts' })
    expect(normalizeRelPath('src/main/')).toEqual({ ok: true, value: 'src/main' })
  })

  it('⚠ REFUSES rather than clamps — a clamped `..` invents an identity', () => {
    const up = normalizeRelPath('../outside/x.ts')
    expect(up.ok).toBe(false)
    if (!up.ok) expect(up.reason).toContain('escapes the repository root')

    const abs = normalizeRelPath('C:/Projects/x.ts')
    expect(abs.ok).toBe(false)
    if (!abs.ok) expect(abs.reason).toContain('absolute path')

    expect(normalizeRelPath('/etc/passwd').ok).toBe(false)
    expect(normalizeRelPath('').ok).toBe(false)
  })

  it('applies NFC so two spellings of the same character are one identity', () => {
    // 'é' as e + combining acute, versus the precomposed form.
    const decomposed = normalizeRelPath('src/cafe\u0301.ts')
    const precomposed = normalizeRelPath('src/caf\u00e9.ts')
    expect(decomposed.ok && precomposed.ok).toBe(true)
    if (decomposed.ok && precomposed.ok) expect(decomposed.value).toBe(precomposed.value)
  })

  it('⚠ PRESERVES CASE — SRC/App.vue and src/app.vue stay TWO identities', () => {
    // The declared Windows limit, asserted so nobody "fixes" it into a fold.
    // git is case-sensitive and NTFS is not; folding would MERGE two files git
    // considers distinct, which is silent data loss.
    const a = normalizeRelPath('SRC/App.vue')
    const b = normalizeRelPath('src/app.vue')
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) expect(a.value).not.toBe(b.value)
  })
})

describe('6a-2: directory chains', () => {
  it('yields each ancestor in order, and never the repository root', () => {
    expect(directoryChain('a/b/c.ts')).toEqual(['a', 'a/b'])
    // A top-level file has no ancestor: the root is not a :Directory, because
    // its relPath would be '' and that identity collides across every instance.
    expect(directoryChain('README.md')).toEqual([])
  })

  it('names files and directories by their last segment', () => {
    expect(baseName('a/b/c.ts')).toBe('c.ts')
    expect(baseName('README.md')).toBe('README.md')
  })

  it('lowercases the extension but never the path — attribute versus identity', () => {
    expect(extensionOf('App.VUE')).toBe('.vue')
    expect(extensionOf('Makefile')).toBe('')
    // A dotfile is not an extension.
    expect(extensionOf('.gitignore')).toBe('')
  })
})

describe('6a-2: batching', () => {
  it('splits exactly, leaves a remainder batch, and emits NOTHING for empty input', () => {
    expect(batched([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4]
    ])
    expect(batched([1, 2, 3], 2)).toEqual([[1, 2], [3]])
    // An empty input must produce no batch at all — a single empty batch would
    // send a pointless UNWIND [] round trip per statement.
    expect(batched([], 2)).toEqual([])
  })

  it('carries the documented defaults', () => {
    expect(INDEX_BATCH_SIZE).toBe(200)
    expect(INDEX_COMMIT_LIMIT).toBe(200)
  })
})

describe('6a-2: row building', () => {
  const built = buildRows(['src/main/ipc.ts', 'src/main/services/git.ts', 'README.md'], 'C:\\repo')

  it('builds one file row per path, with name, extension and where it was', () => {
    expect(built.files).toHaveLength(3)
    expect(built.files[0]).toEqual({
      relPath: 'src/main/ipc.ts',
      name: 'ipc.ts',
      ext: '.ts',
      absPathAtWrite: 'C:/repo/src/main/ipc.ts'
    })
  })

  it('derives each directory once, however many files share it', () => {
    expect(built.directories.map((d) => d.relPath).sort()).toEqual([
      'src',
      'src/main',
      'src/main/services'
    ])
  })

  it('links parent to child, and gives a top-level file no parent edge', () => {
    const pairs = built.contains.map((c) => `${c.parent}>${c.child}`)
    expect(pairs).toContain('src>src/main')
    expect(pairs).toContain('src/main>src/main/ipc.ts')
    expect(pairs).toContain('src/main>src/main/services')
    // README.md sits at the root, which is not a node.
    expect(pairs.some((p) => p.endsWith('>README.md'))).toBe(false)
  })

  it('counts a refused path instead of dropping it silently', () => {
    const r = buildRows(['../escape.ts', 'ok.ts'], 'C:/repo')
    expect(r.files.map((f) => f.relPath)).toEqual(['ok.ts'])
    expect(r.refused).toHaveLength(1)
    expect(r.refused[0].reason).toContain('escapes the repository root')
  })
})

describe('6a-2: the git log parser, against CAPTURED bytes', () => {
  const parsed = parseGitLogNameOnly(CAPTURED_LOG)

  it('reads every record in the capture', () => {
    // The capture was taken with -n 200.
    expect(parsed.commits.length).toBeGreaterThan(150)
    expect(parsed.commits.length).toBeLessThanOrEqual(200)
  })

  it('reads sha, authored time and subject off the header', () => {
    const first = parsed.commits[0]
    expect(first.sha).toMatch(/^[0-9a-f]{40}$/)
    expect(first.authoredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(first.subject.length).toBeGreaterThan(0)
  })

  it('⚠ HANDLES A COMMIT THAT TOUCHES NO FILES — no blank line follows it', () => {
    // Ten merges and four empty commits in this window. A parser driven by
    // blank lines rather than by the record sentinel swallows the record that
    // follows one of these.
    const empty = parsed.commits.filter((c) => c.paths.length === 0)
    expect(empty.length).toBeGreaterThan(0)
    // And the record AFTER an empty one is still parsed intact.
    const idx = parsed.commits.findIndex((c) => c.paths.length === 0)
    expect(idx).toBeGreaterThanOrEqual(0)
    const next = parsed.commits[idx + 1]
    if (next !== undefined) expect(next.sha).toMatch(/^[0-9a-f]{40}$/)
  })

  it('attaches file paths to the commit that touched them', () => {
    const withFiles = parsed.commits.find((c) => c.paths.length > 0)
    expect(withFiles).toBeDefined()
    expect(withFiles?.paths.every((p) => !p.startsWith('/') && !p.includes('\\'))).toBe(true)
  })

  it('finds no quoted paths in this capture, which is what core.quotepath=false buys', () => {
    // Measured: no tracked path on this machine needs quoting, and NTFS forbids
    // the two characters that would still force it. The counter exists for a
    // repository cloned from elsewhere.
    expect(parsed.skippedPaths).toBe(0)
  })

  it('COUNTS a quoted path rather than guessing at its bytes', () => {
    const synthetic =
      `${LOG_RECORD_PREFIX}abc123${LOG_FIELD_SEP}2026-08-15T00:00:00-04:00${LOG_FIELD_SEP}Subject\n` +
      'src/plain.ts\n' +
      '"src/caf\\303\\251.ts"\n'
    const r = parseGitLogNameOnly(synthetic)
    expect(r.commits[0].paths).toEqual(['src/plain.ts'])
    expect(r.skippedPaths).toBe(1)
  })

  it('is TOTAL — a malformed header costs that record, never the parse', () => {
    expect(() => parseGitLogNameOnly('garbage\nmore garbage\n')).not.toThrow()
    expect(parseGitLogNameOnly('').commits).toEqual([])
  })
})

describe('6a-2: identities', () => {
  it('scopes a workspace instance to the project’s own checkout', () => {
    expect(workspaceInstanceIdFor('abc-123')).toBe('pj:abc-123')
  })

  it('⚠ TAKES THE LEXICOGRAPHICALLY SMALLEST ROOT COMMIT, never a date', () => {
    // Committer and author dates are user-settable and rev-list does not
    // document its output order, so a date rule is not guaranteed to give two
    // machines the same repoId — the one property this identifier must have.
    expect(repoIdFrom(['ffff', 'aaaa', 'cccc'])).toBe('aaaa')
    expect(repoIdFrom(['a92099d934dd95548e59525b7231fd4b5f5d5f6f'])).toBe(
      'a92099d934dd95548e59525b7231fd4b5f5d5f6f'
    )
  })

  it('returns null for a repository with no commits — not an error', () => {
    // A project need not be a git repository at all. Then there is no repoId,
    // no :Commit may be written, and files still index.
    expect(repoIdFrom([])).toBeNull()
  })
})

describe('6a-2: ⚠ THE PROVENANCE TRAP, AS A TEST', () => {
  it('NO statement deletes, detaches or removes anything', () => {
    // A :Memory counts as sourced only while its SUPPORTED_BY target exists.
    // An indexer that deleted a :File would drop memories out of
    // memory:validate's numerator, and the trust ratio would fall BECAUSE A
    // REFRESH RAN — a corruption that looks like a measurement.
    for (const statement of ALL_INDEX_STATEMENTS) {
      expect(statement).not.toMatch(/\bDELETE\b/i)
      expect(statement).not.toMatch(/\bDETACH\b/i)
      expect(statement).not.toMatch(/\bREMOVE\b/i)
    }
  })

  it('⚠ UPSERT_PROJECT STILL CARRIES lastIndexedHead — dropping it makes every graph permanently "never indexed"', () => {
    // Task 6b-3: the whole freshness feature reads this one property back. A
    // future edit that quietly drops the clause would leave `isIndexStale`
    // returning true on every launch, forever — an index on every click, which
    // is the failure D170 refuses in the shape it is hardest to notice.
    expect(UPSERT_PROJECT).toContain('lastIndexedHead')
    expect(UPSERT_PROJECT).toContain('$headSha')
    // And it is still listed, so the sweep above covers the amended text.
    expect(ALL_INDEX_STATEMENTS).toContain(UPSERT_PROJECT)
  })

  it('every statement is a MERGE, a SET, an UNWIND, a MATCH or a RETURN — nothing else writes', () => {
    for (const statement of ALL_INDEX_STATEMENTS) {
      for (const line of statement.split('\n')) {
        const trimmed = line.trim()
        if (trimmed === '' || trimmed.startsWith('//')) continue
        expect(trimmed).toMatch(/^(UNWIND|MERGE|MATCH|WHERE|SET|RETURN|[a-zA-Z_.]+\s*=|\w+:)/)
      }
    }
  })

  it('⚠ WRITES ONLY THE STRUCTURAL NAMESPACE — no memory label appears anywhere', () => {
    // The label boundary is the entire safety argument for keeping ONE graph
    // rather than two databases (D147(c)).
    for (const statement of ALL_INDEX_STATEMENTS) {
      expect(statement).not.toMatch(/:Memory\b/)
      expect(statement).not.toMatch(/:Decision\b/)
      expect(statement).not.toMatch(/:Observation\b/)
      expect(statement).not.toMatch(/:Risk\b/)
      expect(statement).not.toMatch(/SUPPORTED_BY/)
      expect(statement).not.toMatch(/PRODUCED/)
    }
  })

  it('marks a vanished file by run stamp rather than by shipping the whole tree back', () => {
    const mark = ALL_INDEX_STATEMENTS.find((s) => s.includes('missingSince = $runId'))
    expect(mark).toBeDefined()
    // The complement is computed in the database; no list of present paths is
    // sent as a parameter, which is what keeps this O(1) on the wire.
    expect(mark).toContain('f.lastIndexedAt <> $runId')
    expect(mark).not.toContain('$presentPaths')
  })
})
