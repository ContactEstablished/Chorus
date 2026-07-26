import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  describeSecretHits,
  findingsPathFor,
  nextFreeFindingsPath,
  scanBriefForSecrets,
  validateBriefPath,
  MAX_BRIEF_BYTES
} from './councilService'

/**
 * Task 3b-4: the FILE BOUNDARY, tested in main and before any UI exists.
 *
 * ⚠ Only the boundary functions are imported. `createCouncilService` is never
 * constructed here: it needs a `StorageService`, and storage.ts's better-sqlite3
 * binding is built for the Electron ABI (D2) — the first `new Database()` under
 * Vitest's Node would throw. Importing the module is fine; instantiating the DB
 * is not, which is why these three exports are pure enough to test on their own.
 *
 * The pure refusals run with no filesystem. The stat-dependent ones run against
 * real temp files, because "is this a regular file" is not a question a string
 * can answer — and passing a DIRECTORY is exactly the case `existsSync` alone
 * gets wrong.
 */

let dir: string
let briefPath: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'chorus-council-'))
  briefPath = join(dir, 'Brief.md')
  writeFileSync(briefPath, '# A brief\n\n## Questions\n\n1. Is this sound enough?\n', 'utf8')
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('validateBriefPath — the ordered refusal table (spec §1)', () => {
  it('accepts a real, absolute, local .md file', () => {
    const result = validateBriefPath(briefPath)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.path).toBe(briefPath)
  })

  it('refuses an EMPTY path', () => {
    expect(validateBriefPath('')).toEqual({ ok: false, reason: 'No brief was chosen.' })
    expect(validateBriefPath('   ').ok).toBe(false)
  })

  it('refuses a RELATIVE path — it would resolve against main’s cwd', () => {
    expect(validateBriefPath('docs/brief.md')).toEqual({
      ok: false,
      reason: 'A brief must be an absolute path.'
    })
    expect(validateBriefPath('.\\brief.md').ok).toBe(false)
  })

  it('⚠ refuses a NULL BYTE, and does so before the filesystem is touched', () => {
    expect(validateBriefPath('C:\\docs\\brief\0.md')).toEqual({
      ok: false,
      reason: 'That path contains a null byte.'
    })
  })

  it('⚠ refuses a UNC path — statting one can block on the network', () => {
    expect(validateBriefPath('\\\\server\\share\\brief.md').ok).toBe(false)
    expect(validateBriefPath('//server/share/brief.md').ok).toBe(false)
  })

  it('refuses anything that is not .md, case-insensitively', () => {
    expect(validateBriefPath('C:\\docs\\brief.txt')).toEqual({
      ok: false,
      reason: 'A brief must be a .md file.'
    })
    expect(validateBriefPath('C:\\docs\\brief').ok).toBe(false)
    // .MD is a brief; the check is on the extension, not on the spelling — so a
    // missing .MD file gets past the extension gate and fails on the stat.
    const upper = validateBriefPath(join(dir, 'nope.MD'))
    expect(upper).toEqual({ ok: false, reason: 'That file does not exist, or cannot be read.' })
  })

  it('refuses a path that does not EXIST', () => {
    expect(validateBriefPath(join(dir, 'no-such-brief.md'))).toEqual({
      ok: false,
      reason: 'That file does not exist, or cannot be read.'
    })
  })

  it('⚠ refuses a DIRECTORY named .md — the case existsSync alone passes', () => {
    const dirPath = join(dir, 'looks-like-a-brief.md')
    mkdirSync(dirPath, { recursive: true })
    expect(validateBriefPath(dirPath)).toEqual({ ok: false, reason: 'That path is not a file.' })
  })

  it('refuses a brief OVER THE SIZE CAP — every member pays for every byte', () => {
    const fat = join(dir, 'Fat.md')
    writeFileSync(fat, 'x'.repeat(MAX_BRIEF_BYTES + 1), 'utf8')
    const result = validateBriefPath(fat)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('the limit is')
  })

  it('⚠ NORMALIZES before re-checking, and returns the normalized path', () => {
    // A traversal that lands back on the real brief is legitimate — and what
    // comes back has no `..` left in it, so everything downstream (the run row,
    // the derived findings path) sees one canonical string.
    const traversal = join(dir, 'sub', '..', 'Brief.md')
    const result = validateBriefPath(traversal)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.path).toBe(briefPath)
      expect(result.path).not.toContain('..')
    }
  })

  it('⚠ a traversal that ESCAPES the directory still has to pass every check', () => {
    // Escaping is not itself a refusal — the user may legitimately pick a brief
    // anywhere — so what stops this one is that the resolved target has to
    // exist and be a regular file like any other. The refusal is measured on
    // the RESOLVED path, which is the property the re-check buys.
    const escaping = join(dir, 'Brief.md', '..', '..', 'hosts.txt', '..', 'passwd.md')
    expect(validateBriefPath(escaping)).toEqual({
      ok: false,
      reason: 'That file does not exist, or cannot be read.'
    })
  })

  it('⚠ NO refusal names a path fragment that was not supplied', () => {
    const supplied = 'C:\\somewhere\\secret-folder\\brief.txt'
    const result = validateBriefPath(supplied)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      // Not even the caller's own path is echoed: a resolved relative path
      // would leak main's cwd, and the user already knows what they chose.
      expect(result.reason).not.toContain('secret-folder')
      expect(result.reason).not.toContain(supplied)
    }
  })
})

describe('findingsPathFor — DERIVED, never supplied', () => {
  it('lands beside the brief with the -Findings suffix', () => {
    expect(findingsPathFor(join('C:', 'docs', 'Brief.md'))).toBe(
      join('C:', 'docs', 'Brief-Findings.md')
    )
  })

  it('⚠ stays in the brief’s own directory — there is no path the caller can steer', () => {
    const out = findingsPathFor(join(dir, 'Brief.md'))
    expect(out.startsWith(dir)).toBe(true)
  })

  it('strips a .MD extension too, rather than emitting Brief.MD-Findings.md', () => {
    expect(findingsPathFor(join('C:', 'docs', 'Brief.MD'))).toBe(
      join('C:', 'docs', 'Brief-Findings.md')
    )
  })
})

describe('nextFreeFindingsPath — the overwrite ruling: SUFFIX, never replace', () => {
  const brief = join('C:', 'docs', 'Brief.md')

  it('uses the plain name when nothing is there', () => {
    expect(nextFreeFindingsPath(brief, () => false)).toBe(join('C:', 'docs', 'Brief-Findings.md'))
  })

  it('⚠ suffixes rather than overwriting a previous council’s output', () => {
    const existing = new Set([join('C:', 'docs', 'Brief-Findings.md')])
    expect(nextFreeFindingsPath(brief, (p) => existing.has(p))).toBe(
      join('C:', 'docs', 'Brief-Findings-2.md')
    )
    existing.add(join('C:', 'docs', 'Brief-Findings-2.md'))
    expect(nextFreeFindingsPath(brief, (p) => existing.has(p))).toBe(
      join('C:', 'docs', 'Brief-Findings-3.md')
    )
  })

  it('returns NULL rather than improvising once the suffixes are exhausted', () => {
    expect(nextFreeFindingsPath(brief, () => true)).toBeNull()
  })
})

describe('scanBriefForSecrets — the pre-pass, over the ONE pattern list (D63(f))', () => {
  // ⚠ SHAPES, NOT REAL KEYS. Every fixture below is assembled at runtime from
  // fragments so this file itself stays clean under `npm run grep:secrets` —
  // the same discipline logger.test.ts and settings.test.ts already follow.
  const shape = (prefix: string, body: string): string => `${prefix}${body}`

  it('⚠ catches each known credential shape, and names the pattern and the line', () => {
    const cases: { text: string; pattern: string }[] = [
      { text: shape('sk-ant-', 'A'.repeat(24)), pattern: 'anthropic' },
      { text: shape('sk-or-v1-', 'b'.repeat(24)), pattern: 'openrouter' },
      { text: shape('sk-proj-', 'C'.repeat(24)), pattern: 'openai-project' },
      { text: shape('sk-', 'd'.repeat(40)), pattern: 'openai-classic' },
      { text: shape('ghp_', 'E'.repeat(40)), pattern: 'github' },
      { text: shape('AKIA', 'F'.repeat(16)), pattern: 'aws-access-key-id' }
    ]
    for (const c of cases) {
      const hits = scanBriefForSecrets(`# Brief\n\nSome prose.\nkey = ${c.text}\n`)
      expect(hits.length).toBeGreaterThan(0)
      expect(hits.map((h) => h.pattern)).toContain(c.pattern)
      expect(hits[0].line).toBe(4)
    }
  })

  it('⚠ the hit carries NO field able to hold the matched value', () => {
    const hits = scanBriefForSecrets(`x\n${shape('AKIA', 'G'.repeat(16))}\n`)
    expect(hits).toEqual([{ pattern: 'aws-access-key-id', line: 2 }])
    expect(Object.keys(hits[0]).sort()).toEqual(['line', 'pattern'])
  })

  it('⚠ the refusal message names the pattern and the line and NEVER the value', () => {
    const secret = shape('AKIA', 'H'.repeat(16))
    const message = describeSecretHits(scanBriefForSecrets(`a\nb\n${secret}\n`))
    expect(message).toContain('line 3')
    expect(message).toContain('aws-access-key-id')
    expect(message).not.toContain(secret)
    expect(message).not.toContain('AKIA')
  })

  it('⚠ THE FALSE-POSITIVE GUARD: a brief nobody can run is not a feature', () => {
    // The four fixtures logger.test.ts already establishes for this same list.
    // A pre-pass that refuses every brief containing a git SHA is unusable.
    const ordinary = [
      'Verified at commit 456d3d7a1b2c3d4e5f60718293a4b5c6d7e8f900 on main.',
      'The database lives at C:\\Users\\matth\\AppData\\Local\\chorus\\chorus.db',
      'Run id 9ba9b0da-cecd-4960-815d-f36166cf8c00 is the worktree fixture.',
      'Branch chorus/Chorus/24b5c1fe was retained deliberately.',
      'See docs/PLAN.md §4 and the sk- prefixed providers listed there.'
    ].join('\n')
    expect(scanBriefForSecrets(ordinary)).toEqual([])
  })

  it('is clean on a real brief’s worth of ordinary prose', () => {
    expect(scanBriefForSecrets('# Brief\n\n## Questions\n\n1. Is this sound enough?\n')).toEqual([])
  })

  it('reports EVERY offending line, in document order', () => {
    const text = ['ok', shape('AKIA', 'I'.repeat(16)), 'ok', shape('ghp_', 'J'.repeat(40))].join('\n')
    expect(scanBriefForSecrets(text).map((h) => h.line)).toEqual([2, 4])
  })
})
