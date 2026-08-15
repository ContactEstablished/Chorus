import { describe, expect, it } from 'vitest'
import {
  buildLogArgs,
  buildSummaryPrompt,
  canonicalRepoKey,
  dayWindowBounds,
  filterDirtyByMtime,
  formatUtcOffset,
  harvestSymbols,
  isEmptyRepo,
  isGeneratedPath,
  isHarvestablePath,
  mergeDayEvidence,
  LOG_FIELD_SEP,
  LOG_RECORD_SEP,
  parseCommitLog,
  parseStatusLine,
  renderMarkdown,
  type DayEvidence,
  type DayRepoEvidence
} from './dayReportCore'

/**
 * The day report's pure core (D153).
 *
 * ⚠ THREE OF THESE TESTS ENCODE TRAPS THAT WERE FOUND BY RUNNING THE SWEEP
 * AGAINST THIS MACHINE'S REAL REPOSITORIES, NOT BY REASONING ABOUT IT. They
 * are marked. Each one produced a plausible-looking, wrong report first:
 * stash commits read as work, one repo's commits counted twice, and a week of
 * stale dirt billed to today. A regression in any of them is silent — the
 * report still renders, it just lies — which is exactly the class of bug a
 * test has to hold.
 */
describe('D153: day window', () => {
  it('renders a UTC offset in ISO form, both signs', () => {
    expect(formatUtcOffset(-240)).toBe('-04:00')
    expect(formatUtcOffset(330)).toBe('+05:30')
    expect(formatUtcOffset(0)).toBe('+00:00')
  })

  it('bounds a local calendar day and carries the offset explicitly', () => {
    // The offset is what stops a stored report drifting by an hour when it is
    // regenerated on the other side of a DST boundary.
    const w = dayWindowBounds('2026-08-15', -240)
    expect(w.since).toBe('2026-08-15T00:00:00-04:00')
    expect(w.until).toBe('2026-08-15T23:59:59-04:00')
  })

  it('stops one second short of midnight so adjacent days cannot double-count', () => {
    expect(dayWindowBounds('2026-08-15', 0).until).not.toContain('T24')
    expect(dayWindowBounds('2026-08-15', 0).until).toBe('2026-08-15T23:59:59+00:00')
  })
})

describe('D153: log arguments', () => {
  const args = buildLogArgs(dayWindowBounds('2026-08-15', -240))

  it('⚠ TRAP 1 (MEASURED) — selects refs explicitly and never --all, because --all includes the stash', () => {
    // The first live run of this sweep returned "On main: Auto stash before
    // merge…" and "index on main: 3f364cd Phase 6 docs" as though they were
    // work. A stash is a save point. It must never reach a timesheet.
    expect(args).toContain('--branches')
    expect(args).toContain('--tags')
    expect(args).toContain('--remotes')
    expect(args).not.toContain('--all')
  })

  it('excludes merges and asks for names rather than line counts', () => {
    expect(args).toContain('--no-merges')
    expect(args).toContain('--name-status')
    // --numstat would invite "32,788 insertions" — a real number from a real
    // lockfile — to read as a big day's work.
    expect(args).not.toContain('--numstat')
  })

  it('bounds both ends of the window', () => {
    expect(args).toContain('--since=2026-08-15T00:00:00-04:00')
    expect(args).toContain('--until=2026-08-15T23:59:59-04:00')
  })
})

describe('D153: commit log parsing', () => {
  /** Shaped exactly as git 2.50.0.windows.1 emits it for `buildLogArgs`. */
  const sample =
    `${LOG_RECORD_SEP}7d659c61090ecc0353fd7b6c270d97d8941f27e1${LOG_FIELD_SEP}2026-08-15T06:18:49-04:00${LOG_FIELD_SEP}Vue Vite fix\n` +
    'M\tpackage.json\n' +
    'M\tsrc/renderer/src/components/LaunchDialog.vue\n' +
    '\n' +
    `${LOG_RECORD_SEP}3c0e82ebd211533f9dc407fa99a8f179105cef83${LOG_FIELD_SEP}2026-08-15T05:40:27-04:00${LOG_FIELD_SEP}Tell claude and codex that this project has a memory graph\n` +
    'A\tsrc/main/adapters/instructionsCore.ts\n' +
    'M\tsrc/main/ipc.ts\n'

  const commits = parseCommitLog(sample)

  it('reads every commit, its short sha, its committer date and its subject', () => {
    expect(commits).toHaveLength(2)
    expect(commits[0].sha).toBe('7d659c6')
    expect(commits[0].at).toBe('2026-08-15T06:18:49-04:00')
    expect(commits[0].subject).toBe('Vue Vite fix')
    expect(commits[1].subject).toBe('Tell claude and codex that this project has a memory graph')
  })

  it('attaches each file with its status letter', () => {
    expect(commits[1].files).toEqual([
      { status: 'A', path: 'src/main/adapters/instructionsCore.ts' },
      { status: 'M', path: 'src/main/ipc.ts' }
    ])
  })

  it('takes the DESTINATION path of a rename, which is the file that exists now', () => {
    const renamed =
      `${LOG_RECORD_SEP}abc1234${LOG_FIELD_SEP}2026-08-15T01:00:00Z${LOG_FIELD_SEP}Move it\n` +
      'R100\tsrc/old.ts\tsrc/new.ts\n'
    expect(parseCommitLog(renamed)[0].files).toEqual([{ status: 'R100', path: 'src/new.ts' }])
  })

  it('is TOTAL — a malformed record costs that record, never the whole day', () => {
    const broken = `${LOG_RECORD_SEP}not-a-real-header-line\nM\tfoo.ts\n${sample}`
    expect(parseCommitLog(broken)).toHaveLength(2)
    expect(parseCommitLog('')).toEqual([])
  })

  it('survives a subject containing characters that would break a naive delimiter', () => {
    const nasty =
      `${LOG_RECORD_SEP}abc1234${LOG_FIELD_SEP}2026-08-15T01:00:00Z${LOG_FIELD_SEP}Fix a|pipe, a\ttab and "quotes"\n` +
      'M\tfoo.ts\n'
    expect(parseCommitLog(nasty)[0].subject).toBe('Fix a|pipe, a\ttab and "quotes"')
  })
})

describe('D153: generated files', () => {
  it('recognises lockfiles and build output', () => {
    expect(isGeneratedPath('package-lock.json')).toBe(true)
    expect(isGeneratedPath('spikes/p0-foundation/pnpm-lock.yaml')).toBe(true)
    expect(isGeneratedPath('src/dist/bundle.js')).toBe(true)
    expect(isGeneratedPath('app/bin/Release/x.dll')).toBe(true)
    expect(isGeneratedPath('vendor/thing.min.js')).toBe(true)
  })

  it('leaves real source alone, including paths that merely contain the words', () => {
    expect(isGeneratedPath('src/main/services/dayReportCore.ts')).toBe(false)
    expect(isGeneratedPath('src/distribution/rules.ts')).toBe(false)
    expect(isGeneratedPath('src/main/binding.ts')).toBe(false)
  })
})

describe('D153: symbol and test harvest', () => {
  const patch = [
    'diff --git a/src/main/adapters/instructionsCore.ts b/src/main/adapters/instructionsCore.ts',
    '+++ b/src/main/adapters/instructionsCore.ts',
    '@@ -0,0 +1,5 @@',
    '+export function memoryContractLines(): readonly string[] {',
    '+export interface InstructionsDescriptor {',
    '+const notExported = 1',
    ' export function untouchedContextLine() {}',
    'diff --git a/src/main/adapters/instructionsCore.test.ts b/src/main/adapters/instructionsCore.test.ts',
    '+++ b/src/main/adapters/instructionsCore.test.ts',
    "+  it('codex renders the composed value as ONE physical line', () => {",
    'diff --git a/package-lock.json b/package-lock.json',
    '+++ b/package-lock.json',
    '+export function shouldNeverBeHarvested() {}'
  ].join('\n')

  const { symbols, tests } = harvestSymbols(patch)

  it('harvests exported TypeScript surface from ADDED lines only', () => {
    expect(symbols).toContain('memoryContractLines')
    expect(symbols).toContain('InstructionsDescriptor')
    // A context line is not new work, even though it says `export`.
    expect(symbols).not.toContain('untouchedContextLine')
    // Unexported locals are implementation detail.
    expect(symbols).not.toContain('notExported')
  })

  it('never harvests from a generated file', () => {
    expect(symbols).not.toContain('shouldNeverBeHarvested')
  })

  it('never mistakes the diff’s own +++ header for an added line', () => {
    expect(symbols.some((s) => s.includes('instructionsCore'))).toBe(false)
  })

  it('harvests test names', () => {
    expect(tests).toContain('codex renders the composed value as ONE physical line')
  })

  it('harvests C# types and ASP.NET routes, because half the rail is .NET', () => {
    // TaxApp and TrupanionDE are C#; a TypeScript-only harvest would make
    // their days look empty rather than unreported.
    const csharp = [
      'diff --git a/Api/ReturnsController.cs b/Api/ReturnsController.cs',
      '+++ b/Api/ReturnsController.cs',
      '+public sealed class ReturnsController : ControllerBase',
      '+    [HttpGet("api/returns/{id}")]',
      '+public record TaxReturnDto(int Id);',
      '+    private class Hidden {}'
    ].join('\n')
    const r = harvestSymbols(csharp)
    expect(r.symbols).toContain('ReturnsController')
    expect(r.symbols).toContain('TaxReturnDto')
    expect(r.symbols).toContain('api/returns/{id}')
    expect(r.symbols).not.toContain('Hidden')
  })

  it('⚠ TRAP 4 (MEASURED) — never harvests from a prose file, because docs contain code samples', () => {
    // The `Phase 6 docs` commit added ten markdown specs full of TypeScript
    // and Cypher samples, and the first real run reported INDEX_BATCH_SIZE,
    // UPSERT_COMMITS, ContainerState and IndexReport as new API surface for
    // the day. None of them was written as code. A timesheet naming work that
    // never happened is worse than one naming nothing.
    const docs = [
      'diff --git a/docs/ImplementationSpec-6a-2.md b/docs/ImplementationSpec-6a-2.md',
      '+++ b/docs/ImplementationSpec-6a-2.md',
      '+export const INDEX_BATCH_SIZE = 500',
      '+export interface IndexReport {'
    ].join('\n')
    expect(harvestSymbols(docs).symbols).toEqual([])
  })

  it('classifies harvestable paths by extension, across both language families', () => {
    expect(isHarvestablePath('src/main/services/dayReport.ts')).toBe(true)
    expect(isHarvestablePath('src/TaxApp.Domain/Entities/TokenGrant.cs')).toBe(true)
    expect(isHarvestablePath('src/renderer/src/views/DayView.vue')).toBe(true)
    expect(isHarvestablePath('docs/Features/Foundation/roadmap.md')).toBe(false)
    expect(isHarvestablePath('README.txt')).toBe(false)
    expect(isHarvestablePath('package.json')).toBe(false)
    // Generated code is still code, and still not harvestable.
    expect(isHarvestablePath('dist/bundle.js')).toBe(false)
  })

  it('returns sorted, de-duplicated lists', () => {
    const dup = [
      'diff --git a/a.ts b/a.ts',
      '+export function zeta() {}',
      '+export function alpha() {}',
      '+export function alpha() {}'
    ].join('\n')
    expect(harvestSymbols(dup).symbols).toEqual(['alpha', 'zeta'])
  })
})

describe('D153: working-tree status', () => {
  it('parses porcelain v1 lines including renames and quoted paths', () => {
    expect(parseStatusLine(' M src/main/ipc.ts')).toEqual({ status: 'M', path: 'src/main/ipc.ts' })
    expect(parseStatusLine('?? docs/new file.md')).toEqual({
      status: '??',
      path: 'docs/new file.md'
    })
    expect(parseStatusLine('R  src/old.ts -> src/new.ts')).toEqual({
      status: 'R',
      path: 'src/new.ts'
    })
    expect(parseStatusLine('?? "docs/quoted path.md"')).toEqual({
      status: '??',
      path: 'docs/quoted path.md'
    })
    expect(parseStatusLine('')).toBeNull()
  })

  it('⚠ TRAP 3 (MEASURED) — dirt is filtered by mtime, because git status has no timestamp', () => {
    // InboxRail carries 31 dirty paths / 809 insertions last written on
    // August 9–10. A report that listed "what is dirty now" would have billed
    // all of it to today. This filter is the difference between a summary and
    // a false timesheet.
    const dayStart = Date.parse('2026-08-15T00:00:00-04:00')
    const dayEnd = Date.parse('2026-08-15T23:59:59-04:00')
    const entries = [
      { status: 'M', path: 'today.ts', mtimeMs: Date.parse('2026-08-15T14:22:00-04:00') },
      { status: '??', path: 'stale-from-aug-9.md', mtimeMs: Date.parse('2026-08-09T08:12:00-04:00') },
      { status: 'M', path: 'tomorrow.ts', mtimeMs: Date.parse('2026-08-16T09:00:00-04:00') }
    ]
    const kept = filterDirtyByMtime(entries, dayStart, dayEnd)
    expect(kept.map((k) => k.path)).toEqual(['today.ts'])
  })

  it('keeps files written exactly on the window boundaries', () => {
    const start = Date.parse('2026-08-15T00:00:00Z')
    const end = Date.parse('2026-08-15T23:59:59Z')
    const kept = filterDirtyByMtime(
      [
        { status: 'M', path: 'a.ts', mtimeMs: start },
        { status: 'M', path: 'b.ts', mtimeMs: end }
      ],
      start,
      end
    )
    expect(kept).toHaveLength(2)
  })
})

describe('D153: repository identity', () => {
  it('⚠ TRAP 2 (MEASURED) — two projects sharing one .git collapse to one key', () => {
    // `TR-Integration` and `CCH-integration` are two worktrees of ONE repo:
    // both resolve to C:/Projects/TaxApp/TaxApp/.git. Keying on the working
    // tree would count every TaxApp commit twice, in two different projects,
    // on the same report.
    const a = canonicalRepoKey('C:/Projects/TaxApp/TaxApp/.git')
    const b = canonicalRepoKey('C:\\Projects\\TaxApp\\TaxApp\\.git\\')
    expect(a).toBe(b)
  })

  it('treats distinct repositories as distinct', () => {
    expect(canonicalRepoKey('C:/Projects/A/.git')).not.toBe(canonicalRepoKey('C:/Projects/B/.git'))
  })
})

describe('D153: render', () => {
  const repo: DayRepoEvidence = {
    repoKey: 'c:/projects/contactestablished/chorus/.git',
    projectNames: ['Chorus'],
    commits: [
      {
        sha: '3c0e82e',
        at: '2026-08-15T05:40:27-04:00',
        subject: 'Tell claude and codex that this project has a memory graph',
        files: [
          { status: 'A', path: 'src/main/adapters/instructionsCore.ts' },
          { status: 'M', path: 'src/main/ipc.ts' },
          { status: 'M', path: 'package-lock.json' }
        ]
      }
    ],
    dirty: [{ path: 'src/main/services/dayReport.ts', status: '??', modifiedAt: '2026-08-15T18:00:00.000Z' }],
    symbols: ['memoryContractLines', 'renderInstructionsMarkdown'],
    tests: ['codex emits EXACTLY ONE developer_instructions token']
  }

  const evidence: DayEvidence = {
    date: '2026-08-15',
    generatedAt: '2026-08-15T22:00:00.000Z',
    repos: [repo],
    skipped: [{ projectName: 'Mission Map', reason: 'not a git repository' }]
  }

  const md = renderMarkdown(evidence, 'Wired the memory contract into both adapters.')

  it('leads with the date and the tie-together prose', () => {
    expect(md.startsWith('# Work summary — 2026-08-15')).toBe(true)
    expect(md).toContain('Wired the memory contract into both adapters.')
  })

  it('names the work, the new files, the API surface and the tests', () => {
    expect(md).toContain('Tell claude and codex that this project has a memory graph')
    expect(md).toContain('New: src/main/adapters/instructionsCore.ts')
    expect(md).toContain('memoryContractLines')
    expect(md).toContain('Tests added (1)')
  })

  it('counts generated files separately rather than letting them inflate the day', () => {
    expect(md).toContain('2 files, 1 generated')
  })

  it('separates in-flight work from committed work', () => {
    expect(md).toContain('In flight (uncommitted, edited this day)')
    expect(md).toContain('src/main/services/dayReport.ts')
  })

  it('says what it did NOT include, rather than omitting it silently', () => {
    expect(md).toContain('Mission Map — not a git repository')
  })

  it('renders without prose when no summarizer is configured', () => {
    const bare = renderMarkdown(evidence, null)
    expect(bare).toContain('# Work summary — 2026-08-15')
    expect(bare).toContain('Tell claude and codex')
    expect(bare).not.toContain('Wired the memory contract')
  })

  it('says so plainly when the day is empty', () => {
    const empty = renderMarkdown({ ...evidence, repos: [], skipped: [] }, null)
    expect(empty).toContain('No commits and no in-flight changes')
  })

  it('drops repositories that contributed nothing, so six projects do not yield six empty headings', () => {
    const quiet: DayRepoEvidence = { ...repo, projectNames: ['Quiet'], commits: [], dirty: [] }
    expect(isEmptyRepo(quiet)).toBe(true)
    expect(renderMarkdown({ ...evidence, repos: [repo, quiet] }, null)).not.toContain('## Quiet')
  })
})

describe('D153: merging a regenerated day', () => {
  const base = {
    repoKey: 'k',
    projectNames: ['Chorus'],
    commits: [],
    dirty: [],
    symbols: [],
    tests: []
  } satisfies DayRepoEvidence

  const day = (repos: DayRepoEvidence[]): DayEvidence => ({
    date: '2026-08-15',
    generatedAt: '2026-08-15T22:00:00.000Z',
    repos,
    skipped: []
  })

  it('⚠ NEVER LOSES IN-FLIGHT WORK THAT HAS SINCE BEEN COMMITTED', () => {
    // Monday's report is regenerated on Wednesday. By then the files it caught
    // mid-edit are committed, so a fresh sweep sees no dirt at all — and a
    // plain overwrite would empty the one section git cannot rebuild.
    const stored = day([
      {
        ...base,
        dirty: [{ path: 'src/a.ts', status: 'M', modifiedAt: '2026-08-15T14:00:00.000Z' }]
      }
    ])
    const fresh = day([
      {
        ...base,
        commits: [{ sha: 'abc1234', at: '2026-08-15T16:00:00-04:00', subject: 'Ship a.ts', files: [] }]
      }
    ])
    const merged = mergeDayEvidence(stored, fresh)
    expect(merged.repos[0].dirty.map((d) => d.path)).toEqual(['src/a.ts'])
    expect(merged.repos[0].commits).toHaveLength(1)
  })

  it('replaces commits rather than accumulating them, because git always reproduces those', () => {
    const stored = day([
      { ...base, commits: [{ sha: 'old1111', at: 'x', subject: 'Amended away', files: [] }] }
    ])
    const fresh = day([
      { ...base, commits: [{ sha: 'new2222', at: 'x', subject: 'The real one', files: [] }] }
    ])
    const merged = mergeDayEvidence(stored, fresh)
    expect(merged.repos[0].commits.map((c) => c.sha)).toEqual(['new2222'])
  })

  it('de-duplicates dirty paths seen in both captures', () => {
    const entry = { path: 'src/a.ts', status: 'M', modifiedAt: '2026-08-15T14:00:00.000Z' }
    const merged = mergeDayEvidence(day([{ ...base, dirty: [entry] }]), day([{ ...base, dirty: [entry] }]))
    expect(merged.repos[0].dirty).toHaveLength(1)
  })

  it('carries over a repository the fresh sweep never saw', () => {
    // A project removed from the rail must not erase the day it was worked on.
    const stored = day([{ ...base, repoKey: 'gone', projectNames: ['Retired'], dirty: [{ path: 'x.ts', status: 'M', modifiedAt: 'z' }] }])
    const merged = mergeDayEvidence(stored, day([]))
    expect(merged.repos.map((r) => r.repoKey)).toEqual(['gone'])
  })

  it('unions symbols and project names without duplicating them', () => {
    const stored = day([{ ...base, projectNames: ['Chorus'], symbols: ['alpha'] }])
    const fresh = day([{ ...base, projectNames: ['Chorus', 'Chorus Two'], symbols: ['beta'] }])
    const merged = mergeDayEvidence(stored, fresh)
    expect(merged.repos[0].symbols).toEqual(['alpha', 'beta'])
    expect(merged.repos[0].projectNames).toEqual(['Chorus', 'Chorus Two'])
  })
})

describe('D153: summarizer prompt', () => {
  const evidence: DayEvidence = {
    date: '2026-08-15',
    generatedAt: '2026-08-15T22:00:00.000Z',
    repos: [
      {
        repoKey: 'k',
        projectNames: ['Chorus'],
        commits: [
          {
            sha: 'abc1234',
            at: '2026-08-15T05:40:27-04:00',
            subject: 'Add the day report',
            files: [
              { status: 'A', path: 'src/main/services/dayReportCore.ts' },
              { status: 'M', path: 'package-lock.json' }
            ]
          }
        ],
        dirty: [],
        symbols: ['renderMarkdown'],
        tests: []
      }
    ],
    skipped: []
  }

  const prompt = buildSummaryPrompt(evidence)

  it('carries the facts the prose needs', () => {
    expect(prompt).toContain('Date: 2026-08-15')
    expect(prompt).toContain('Project: Chorus')
    expect(prompt).toContain('Add the day report')
    expect(prompt).toContain('src/main/services/dayReportCore.ts')
    expect(prompt).toContain('renderMarkdown')
  })

  it('⚠ SENDS NO FILE CONTENT AND NO DIFF TEXT — paths, subjects and symbol names only', () => {
    // This report can be generated across every project at once without the
    // user reading it first, so the egress surface is checked here rather than
    // trusted to the caller.
    expect(prompt).not.toContain('diff --git')
    expect(prompt).not.toContain('@@')
    expect(prompt.split('\n').every((l) => !l.startsWith('+'))).toBe(true)
  })

  it('omits generated files from the model’s view of the day', () => {
    expect(prompt).not.toContain('package-lock.json')
  })
})
