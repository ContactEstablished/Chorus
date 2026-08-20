import { describe, it, expect } from 'vitest'
import {
  AFFECTED_LIMIT,
  MEMORY_USAGE_LOWER_BOUND_NOTE,
  PROVENANCE_DISCLAIMER,
  PROVENANCE_QUERIES,
  WRITTEN_VIA,
  affectedLabel,
  completeness,
  memoryBreakdownLine,
  memoryUsageLine,
  memoryWriteParams,
  normalizeRelPath,
  selectRepoId,
  sessionMemoryLine,
  workspaceInstanceId,
  type MemoryRecord
} from './provenanceCore'

/**
 * Task 6-4's provenance core. The queries are asserted AS STRINGS because a pure
 * core cannot execute Cypher; their behaviour against a real graph is G2's job.
 * The headline cases are the definition of "sourced" (the session edge alone
 * must not count) and the completeness pair (0-of-0 is "0 of 0", never NaN and
 * never 100%).
 */

describe('provenanceCore — workspaceInstanceId', () => {
  it('prefixes a worktree instance', () => {
    expect(workspaceInstanceId({ worktreeId: 'wt-1', projectId: 'p-1' })).toBe('wt:wt-1')
  })

  it('falls back to the project for a session in the project’s own checkout', () => {
    // sessions.worktree_id is NULL here, and this is the COMMONEST case rather
    // than an edge case — a model keyed only on worktrees would key it to null.
    expect(workspaceInstanceId({ worktreeId: null, projectId: 'p-1' })).toBe('pj:p-1')
  })

  it('the two id spaces cannot collide even if the ids are identical', () => {
    const a = workspaceInstanceId({ worktreeId: 'same-id', projectId: 'x' })
    const b = workspaceInstanceId({ worktreeId: null, projectId: 'same-id' })
    expect(a).not.toBe(b)
  })
})

describe('provenanceCore — selectRepoId', () => {
  it('is the only root commit when there is one', () => {
    expect(selectRepoId(['a92099d934dd95548e59525b7231fd4b5f5d5f6f'])).toBe(
      'a92099d934dd95548e59525b7231fd4b5f5d5f6f'
    )
  })

  /**
   * ⚠ LEXICOGRAPHIC, NOT "EARLIEST". Commit dates are user-settable, can be
   * identical across two roots, and `git rev-list --max-parents=0` does not
   * document its order — so a date rule is not guaranteed to give two machines
   * the same answer, which is the one property this identifier exists to have.
   */
  it('picks the same root every time, whatever order git listed them in', () => {
    const roots = ['ffff1111', 'aaaa2222', 'cccc3333']
    expect(selectRepoId(roots)).toBe('aaaa2222')
    expect(selectRepoId([...roots].reverse())).toBe('aaaa2222')
    expect(selectRepoId(['cccc3333', 'ffff1111', 'aaaa2222'])).toBe('aaaa2222')
  })

  it('is case-insensitive about the SHA it was handed', () => {
    expect(selectRepoId(['AAAA2222'])).toBe('aaaa2222')
  })

  /**
   * A project need not be a git repository at all, and a fresh `git init` has no
   * commits. Both are real STATES rather than errors — they simply mean no
   * `:Commit` node may be written (identity model §3(ii)).
   */
  it('returns null when there is no history to cite', () => {
    expect(selectRepoId([])).toBeNull()
    expect(selectRepoId([''])).toBeNull()
    expect(selectRepoId(['not-a-sha', '  '])).toBeNull()
  })
})

describe('provenanceCore — normalizeRelPath', () => {
  const ROOT = 'C:\\Projects\\ContactEstablished\\Chorus'

  it('makes a path relative to its instance root and uses forward slashes', () => {
    const r = normalizeRelPath('C:\\Projects\\ContactEstablished\\Chorus\\src\\main\\index.ts', ROOT)
    expect(r).toEqual({ ok: true, relPath: 'src/main/index.ts' })
  })

  it('accepts a root given with a trailing slash', () => {
    const r = normalizeRelPath('C:/Projects/ContactEstablished/Chorus/src/a.ts', 'C:/Projects/ContactEstablished/Chorus/')
    expect(r.ok && r.relPath).toBe('src/a.ts')
  })

  it('strips a leading ./ and collapses doubled slashes', () => {
    expect(normalizeRelPath(`${ROOT}\\.\\src\\a.ts`, ROOT).ok && normalizeRelPath(`${ROOT}\\.\\src\\a.ts`, ROOT)).toEqual({ ok: true, relPath: 'src/a.ts' })
    expect(normalizeRelPath('C:/r//src//a.ts', 'C:/r')).toEqual({ ok: true, relPath: 'src/a.ts' })
  })

  /**
   * ⚠ CASE IS PRESERVED IN THE RESULT. git is case-sensitive; folding would
   * merge two files git considers distinct, which is silent data loss. The
   * declared cost is that two spellings on NTFS can make two nodes.
   */
  it('preserves the case of the path segments', () => {
    const r = normalizeRelPath(`${ROOT}\\src\\MyFile.TS`, ROOT)
    expect(r.ok && r.relPath).toBe('src/MyFile.TS')
  })

  /**
   * ⚠ BUT THE ROOT PREFIX IS MATCHED CASE-INSENSITIVELY, and the asymmetry is
   * deliberate: the root comes from Chorus's database while the path comes from
   * an agent, and on Windows the two can disagree on the drive letter's case.
   */
  it('tolerates a drive-letter case mismatch on the root', () => {
    const r = normalizeRelPath('c:\\Projects\\ContactEstablished\\Chorus\\src\\a.ts', ROOT)
    expect(r).toEqual({ ok: true, relPath: 'src/a.ts' })
  })

  it('normalizes unicode to NFC', () => {
    // 'e' + combining acute vs the precomposed character: one file, one node.
    const decomposed = `${ROOT}\\src\\cafe\u0301.ts`
    const composed = `${ROOT}\\src\\caf\u00e9.ts`
    const a = normalizeRelPath(decomposed, ROOT)
    const b = normalizeRelPath(composed, ROOT)
    expect(a.ok && a.relPath).toBe(b.ok && b.relPath)
  })

  it('REFUSES a path outside the workspace rather than clamping it', () => {
    // Clamping would invent an identity — two different files on one node.
    const r = normalizeRelPath('C:\\Elsewhere\\src\\a.ts', ROOT)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toMatch(/outside this workspace/)
  })

  it('REFUSES a .. escape rather than resolving it', () => {
    const r = normalizeRelPath(`${ROOT}\\src\\..\\..\\secrets.txt`, ROOT)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toMatch(/steps outside the workspace/)
  })

  it('refuses the workspace root itself — it is not a file in the workspace', () => {
    expect(normalizeRelPath(ROOT, ROOT).ok).toBe(false)
    expect(normalizeRelPath(`${ROOT}\\`, ROOT).ok).toBe(false)
  })

  it('refuses empty input on either side', () => {
    expect(normalizeRelPath('', ROOT).ok).toBe(false)
    expect(normalizeRelPath(`${ROOT}\\a.ts`, '').ok).toBe(false)
  })

  it('does not treat a sibling directory with a shared prefix as inside', () => {
    // `C:/r2/a.ts` must not be read as inside `C:/r` — the classic prefix bug.
    expect(normalizeRelPath('C:/r2/a.ts', 'C:/r').ok).toBe(false)
  })

  it('every refusal is a sentence, not a code', () => {
    const bad = ['', 'C:/Elsewhere/a.ts', `${ROOT}\\..\\x.ts`, ROOT]
    for (const p of bad) {
      const r = normalizeRelPath(p, ROOT)
      expect(r.ok).toBe(false)
      if (r.ok) continue
      expect(r.reason).toMatch(/\.$/)
      expect(r.reason).not.toMatch(/undefined|null|Error/)
    }
  })
})

describe('provenanceCore — memoryWriteParams', () => {
  const record: MemoryRecord = {
    id: 'm-1',
    content: 'The council brief parser counts numbered lines.',
    chorusProjectId: 'p-1',
    writtenVia: 'mcp',
    assertedBy: { modelId: 'anthropic/claude', adapterId: 'claude' },
    validFrom: '2026-08-08T00:00:00.000Z',
    validTo: null
  }

  /**
   * ⚠ NO `confidence`, IN ANY FORM (D94.3, ratified by CR-6.0 Q1). Self-reported
   * LLM confidence is uncalibrated and WILL BE READ AS RIGOR — the failure D55
   * legislated against.
   */
  it('carries no confidence field and nothing shaped like one', () => {
    const params = memoryWriteParams(record)
    for (const k of Object.keys(params)) {
      expect(k.toLowerCase()).not.toContain('confidence')
      expect(k.toLowerCase()).not.toMatch(/certainty|score|probability|rating/)
    }
  })

  it('records WHO asserted it rather than how sure they claimed to be', () => {
    const params = memoryWriteParams(record)
    expect(params.assertedByModel).toBe('anthropic/claude')
    expect(params.assertedByAdapter).toBe('claude')
  })

  it('flattens assertedBy — a Neo4j property cannot hold a map', () => {
    // A nested object would be rejected at write time, a long way from here.
    const params = memoryWriteParams(record)
    for (const v of Object.values(params)) {
      expect(typeof v === 'object' && v !== null).toBe(false)
    }
  })

  it('an unattributed memory is null on both halves, not an empty string', () => {
    const params = memoryWriteParams({ ...record, assertedBy: null })
    expect(params.assertedByModel).toBeNull()
    expect(params.assertedByAdapter).toBeNull()
  })

  it('carries chorusProjectId and writtenVia on every node', () => {
    const params = memoryWriteParams(record)
    expect(params.chorusProjectId).toBe('p-1')
    expect(params.writtenVia).toBe('mcp')
    expect([...WRITTEN_VIA]).toEqual(['mcp', 'app', 'skill'])
  })

  it('exposes exactly the expected key set', () => {
    expect(Object.keys(memoryWriteParams(record)).sort()).toEqual(
      [
        'assertedByAdapter',
        'assertedByModel',
        'chorusProjectId',
        'content',
        'id',
        'validFrom',
        'validTo',
        'writtenVia'
      ].sort()
    )
  })
})

describe('provenanceCore — the queries', () => {
  it('the denominator is CURRENT memories of ONE project', () => {
    // A superseded memory's provenance is history and cannot be repaired, so
    // counting it would inflate the denominator with rows no action can move.
    expect(PROVENANCE_QUERIES.total).toContain('m:Memory {chorusProjectId: $projectId}')
    expect(PROVENANCE_QUERIES.total).toContain('m.validTo IS NULL')
    expect(PROVENANCE_QUERIES.total).toContain('count(m) AS total')
  })

  /**
   * ⚠ THE CASE THAT PROVES THE SESSION NODE IS NOT COUNTED AS PROVENANCE
   * (D126's third unasked finding). Both conditions are required; a query with
   * only the PRODUCED arm would manufacture a false denominator.
   */
  it('"sourced" requires BOTH a SUPPORTED_BY citation and a PRODUCED session', () => {
    const q = PROVENANCE_QUERIES.withSource
    expect(q).toContain('SUPPORTED_BY')
    expect(q).toContain('PRODUCED')
    expect(q).toMatch(/AND EXISTS \{ MATCH \(m\)-\[:SUPPORTED_BY\]->/)
    expect(q).toMatch(/AND EXISTS \{ MATCH \(:AgentSession\)-\[:PRODUCED\]->\(m\) \}/)
  })

  it('a citation must point at a :File or :Commit that exists', () => {
    expect(PROVENANCE_QUERIES.withSource).toContain('src:File OR src:Commit')
  })

  it('the affected list is the complement, and it is bounded', () => {
    const q = PROVENANCE_QUERIES.affected
    expect(q).toContain('NOT EXISTS')
    expect(q).toContain('LIMIT $limit')
    expect(q).toContain('ORDER BY m.id') // stable, so paging is not arbitrary
    expect(AFFECTED_LIMIT).toBeGreaterThan(0)
  })

  it('no query mentions APOC or a confidence property', () => {
    for (const q of Object.values(PROVENANCE_QUERIES)) {
      expect(q.toLowerCase()).not.toContain('apoc')
      expect(q.toLowerCase()).not.toContain('confidence')
    }
  })

  it('no query keys on an absolute path or a repo root', () => {
    for (const q of Object.values(PROVENANCE_QUERIES)) {
      expect(q).not.toMatch(/repoRoot|repo_root|absPath|AtWrite/)
    }
  })

  it('every query is parameterised, never interpolated', () => {
    for (const q of Object.values(PROVENANCE_QUERIES)) {
      expect(q).toContain('$')
      expect(q).not.toMatch(/\$\{/)
    }
  })
})

describe('provenanceCore — completeness carries its denominator (D55)', () => {
  it('renders "N of M"', () => {
    expect(completeness(43, 512)).toEqual({ withSource: 43, total: 512, text: '43 of 512' })
  })

  /**
   * ⚠ AN EMPTY GRAPH IS "0 of 0" — NOT NaN, AND NOT 100%. It is not fully
   * attributed; it is empty, and those are different facts.
   */
  it('0 of 0 does not divide by zero and does not claim success', () => {
    const c = completeness(0, 0)
    expect(c.text).toBe('0 of 0')
    expect(c.text).not.toContain('NaN')
    expect(c.text).not.toContain('100')
  })

  it('never returns a bare percentage', () => {
    const c = completeness(43, 512)
    expect(c.text).not.toContain('%')
    expect(Object.keys(c).sort()).toEqual(['text', 'total', 'withSource'])
  })

  it('clamps a numerator above its denominator rather than rendering "7 of 3"', () => {
    expect(completeness(7, 3).text).toBe('3 of 3')
  })

  it('treats nonsense input as zero rather than propagating it into the sentence', () => {
    expect(completeness(Number.NaN, 10).text).toBe('0 of 10')
    expect(completeness(1, Number.NaN).text).toBe('0 of 0')
    expect(completeness(-5, -2).text).toBe('0 of 0')
  })
})

describe('provenanceCore — the affected list states its own denominator', () => {
  it('says so when truncated — a bare list looks complete', () => {
    expect(affectedLabel(50, 469)).toBe('showing 50 of 469')
  })

  it('does not say "showing" when it is the whole set', () => {
    expect(affectedLabel(12, 12)).toBe('12 of 12')
    expect(affectedLabel(0, 0)).toBe('0 of 0')
  })
})

describe('provenanceCore — the honest sentence', () => {
  it('says provenance is measured and NOT enforced', () => {
    expect(PROVENANCE_DISCLAIMER).toMatch(/cannot require it/)
    expect(PROVENANCE_DISCLAIMER).toMatch(/measures provenance/)
  })

  it('defines what the denominator counts, because "43 of 512" is ambiguous without it', () => {
    expect(PROVENANCE_DISCLAIMER).toMatch(/current/)
    expect(PROVENANCE_DISCLAIMER).toMatch(/file or commit/)
    expect(PROVENANCE_DISCLAIMER).toMatch(/session/)
  })

  /** ⚠ Nothing may hint that the deferred half exists (D128(c)). */
  it('promises no repair workflow, no trend and no per-agent breakdown', () => {
    expect(PROVENANCE_DISCLAIMER).not.toMatch(/repair|fix|trend|over time|per agent|breakdown|coming soon/i)
  })
})

/* ═══════════════════════════════════════════════════════════════════════════
 * Task 6b-1 (D168, amended by D173): the memory-usage sentences. Asserted
 * CHARACTER FOR CHARACTER, because `successful` and `Claude Code` are the two
 * words CR-6b.0 added — they read as verbosity to anyone who has not read the
 * finding, and a tidy-up that drops either restores a claim the instrument
 * cannot support.
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('memoryUsageLine — the D173 sentence, with its denominator (D55)', () => {
  it('renders the exact D173 shape', () => {
    expect(memoryUsageLine(12, 3, 4, '2026-08-20T09:15:00.000Z')).toBe(
      '12 successful memory reads · 3 memory writes across 4 Claude Code sessions observed since 2026-08-20'
    )
  })

  it('⚠ "successful" and "Claude Code" are in the sentence, character for character', () => {
    const line = memoryUsageLine(12, 3, 4, '2026-08-20T09:15:00.000Z')
    expect(line).toContain('successful memory read')
    expect(line).toContain('Claude Code session')
    // And NOT the unqualified forms the council ruled misleading.
    expect(line).not.toMatch(/\d+ memory reads/)
    expect(line).not.toMatch(/across \d+ sessions/)
  })

  it('the zero case still carries the denominator', () => {
    expect(memoryUsageLine(0, 0, 4, '2026-08-20T09:15:00.000Z')).toBe(
      '0 successful memory reads · 0 memory writes across 4 Claude Code sessions observed since 2026-08-20'
    )
  })

  it('⚠ the empty set says so instead of rendering "across 0 Claude Code sessions observed since —"', () => {
    const line = memoryUsageLine(0, 0, 0, '2026-08-20T09:15:00.000Z')
    expect(line).toBe(
      'no Claude Code sessions have run in this project since the counters were added on 2026-08-20'
    )
    expect(line).not.toContain('across 0')
  })

  it('says the counters are not installed when there is no floor', () => {
    expect(memoryUsageLine(0, 0, 0, null)).toBe('these counters have not been installed yet')
  })

  it('singular and plural at 1', () => {
    expect(memoryUsageLine(1, 1, 1, '2026-08-20T09:15:00.000Z')).toBe(
      '1 successful memory read · 1 memory write across 1 Claude Code session observed since 2026-08-20'
    )
  })

  it('⚠ the date is the ISO day, never a locale format', () => {
    // `toLocaleDateString` would make this assertion pass here and fail in CI.
    const line = memoryUsageLine(1, 0, 1, '2026-12-31T23:59:59.999Z')
    expect(line.endsWith('observed since 2026-12-31')).toBe(true)
    expect(line).not.toMatch(/\d{1,2}\/\d{1,2}\/\d{2,4}/)
  })
})

describe('memoryBreakdownLine — the diagnostics, against the SAME K (D173)', () => {
  it('returns null when there is nothing to show', () => {
    expect(memoryBreakdownLine(0, 0, 0, 4)).toBeNull()
  })

  it('renders the breakdown with the headline\'s denominator restated', () => {
    expect(memoryBreakdownLine(3, 1, 2, 4)).toBe(
      '3 read-first · 1 inconclusive · 2 shell-first of the same 4 Claude Code sessions'
    )
  })

  it('each of the three members moves the line on its own', () => {
    // No member can be dropped without a red test.
    expect(memoryBreakdownLine(1, 0, 0, 4)).toBe(
      '1 read-first · 0 inconclusive · 0 shell-first of the same 4 Claude Code sessions'
    )
    expect(memoryBreakdownLine(0, 1, 0, 4)).toBe(
      '0 read-first · 1 inconclusive · 0 shell-first of the same 4 Claude Code sessions'
    )
    expect(memoryBreakdownLine(0, 0, 1, 4)).toBe(
      '0 read-first · 0 inconclusive · 1 shell-first of the same 4 Claude Code sessions'
    )
  })

  it('singular at K = 1, and "Claude Code" on this line too', () => {
    const line = memoryBreakdownLine(1, 0, 0, 1)
    expect(line).toBe('1 read-first · 0 inconclusive · 0 shell-first of the same 1 Claude Code session')
    expect(line).toContain('Claude Code session')
  })

  it('⚠ P + I need not equal K — a breakdown can leave sessions unaccounted for', () => {
    // 1 + 1 of 5: three sessions were neither (explored first, or never touched
    // the graph). The line renders exactly that, and nothing in it is K - P.
    const line = memoryBreakdownLine(1, 1, 0, 5) as string
    expect(line).toContain('of the same 5 Claude Code sessions')
    expect(line).not.toContain('4')
    expect(line).not.toMatch(/fail/i)
  })
})

describe('MEMORY_USAGE_LOWER_BOUND_NOTE — the restart disclosure as a tested constant (D173 Q2)', () => {
  it('says the totals are a lower bound, and why', () => {
    expect(MEMORY_USAGE_LOWER_BOUND_NOTE).toContain('lower bound')
    expect(MEMORY_USAGE_LOWER_BOUND_NOTE).toContain('restarted')
    expect(MEMORY_USAGE_LOWER_BOUND_NOTE).toContain('highest run rather than the sum')
  })

  it('does not claim precision it cannot have', () => {
    expect(MEMORY_USAGE_LOWER_BOUND_NOTE).not.toMatch(/exact|precise|complete/i)
  })
})

describe('sessionMemoryLine — the live per-session pair, ABSENT when there is nothing', () => {
  it('⚠ returns null for a session that has done neither — the emptiness is decided HERE', () => {
    // The caller renders nothing; no `v-if` in a template invents the rule.
    expect(sessionMemoryLine(0, 0)).toBeNull()
  })

  it('renders the short pair and the full sentence with its denominator ("this session")', () => {
    expect(sessionMemoryLine(2, 0)).toEqual({
      short: '2 reads · 0 writes',
      full: 'Project memory, this session: 2 graph reads · 0 memory writes'
    })
    expect(sessionMemoryLine(0, 1)).toEqual({
      short: '0 reads · 1 write',
      full: 'Project memory, this session: 0 graph reads · 1 memory write'
    })
  })

  it('singular at 1', () => {
    expect(sessionMemoryLine(1, 1)?.short).toBe('1 read · 1 write')
  })
})
