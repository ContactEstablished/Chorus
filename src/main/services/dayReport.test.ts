import { describe, expect, it } from 'vitest'
import { collectDayEvidence, groupProjectsByRepo, type DayReportDeps } from './dayReport'
import { LOG_FIELD_SEP, LOG_RECORD_SEP } from './dayReportCore'

/**
 * The day report's sweep (D153), driven against a MODEL OF THIS MACHINE rather
 * than against a repository on disk.
 *
 * ⚠ THE FIXTURE IS THE REAL PROJECT LIST, INCLUDING ITS TWO AWKWARD MEMBERS.
 * `TR-Integration` and `CCH-integration` are two worktrees of one TaxApp repo,
 * and `Mission Map` is an active project with no git repository at all. Both
 * were found by running the sweep, both produced a wrong report first, and
 * both are held here rather than in prose.
 */

const TAXAPP = 'C:/Projects/TaxApp/TaxApp/.git'
const CHORUS = 'C:/Projects/ContactEstablished/Chorus/.git'

const PROJECTS = [
  {
    id: 'p1',
    name: 'TR-Integration',
    rootPath: 'C:\\Projects\\TaxApp\\TaxApp.worktrees\\feature\\ThomsonReuters-API-Integration'
  },
  { id: 'p2', name: 'Chorus', rootPath: 'C:\\Projects\\ContactEstablished\\Chorus' },
  { id: 'p3', name: 'Mission Map', rootPath: 'C:\\Projects\\ContactEstablished\\Mission Map' },
  {
    id: 'p4',
    name: 'CCH-integration',
    rootPath: 'C:\\Projects\\TaxApp\\TaxApp.worktrees\\feature\\CCH-integration'
  }
]

function commit(sha: string, at: string, subject: string, files: string[]): string {
  return (
    `${LOG_RECORD_SEP}${sha}${LOG_FIELD_SEP}${at}${LOG_FIELD_SEP}${subject}\n` +
    files.map((f) => `M\t${f}`).join('\n') +
    '\n'
  )
}

interface StubOptions {
  readonly log?: Record<string, string>
  readonly patch?: Record<string, string>
  readonly status?: Record<string, string[]>
  readonly mtimes?: Record<string, number>
  readonly worktrees?: Record<string, { path: string }[]>
  readonly historyThrowsFor?: string
  readonly identities?: string[]
}

function stubDeps(opts: StubOptions = {}): DayReportDeps {
  return {
    listProjects: async () => PROJECTS,
    commonDir: async (cwd) => {
      const c = cwd.replace(/\\/g, '/')
      if (c.includes('/TaxApp/')) return TAXAPP
      if (c.includes('/Chorus')) return CHORUS
      return null // Mission Map — a real project that is not a repository
    },
    history: async (repoRoot, args) => {
      if (opts.historyThrowsFor !== undefined && repoRoot.includes(opts.historyThrowsFor)) {
        throw new Error('fatal: bad object')
      }
      const isPatch = args.includes('-p')
      const table = isPatch ? (opts.patch ?? {}) : (opts.log ?? {})
      for (const [needle, value] of Object.entries(table)) {
        if (repoRoot.includes(needle)) return value
      }
      return ''
    },
    identities: async () => opts.identities ?? ['me@example.com'],
    listWorktrees: async (repoRoot) => {
      for (const [needle, value] of Object.entries(opts.worktrees ?? {})) {
        if (repoRoot.includes(needle)) return value
      }
      return [{ path: repoRoot }]
    },
    statusPorcelain: async (worktreePath) => {
      for (const [needle, value] of Object.entries(opts.status ?? {})) {
        if (worktreePath.includes(needle)) return value
      }
      return []
    },
    mtimeMs: async (abs) => {
      for (const [needle, value] of Object.entries(opts.mtimes ?? {})) {
        if (abs.replace(/\\/g, '/').includes(needle)) return value
      }
      return null
    },
    now: () => new Date('2026-08-15T22:00:00.000Z')
  }
}

describe('D153: grouping projects by repository', () => {
  it('⚠ TWO PROJECTS SHARING ONE .git BECOME ONE GROUP — the double-count guard', () => {
    return groupProjectsByRepo(PROJECTS, stubDeps().commonDir).then(({ groups }) => {
      expect(groups).toHaveLength(2)
      const taxapp = groups.find((g) => g.repoKey.includes('taxapp'))
      expect(taxapp?.projectNames).toEqual(['TR-Integration', 'CCH-integration'])
    })
  })

  it('records the non-git project by name and reason instead of dropping it silently', async () => {
    const { skipped } = await groupProjectsByRepo(PROJECTS, stubDeps().commonDir)
    expect(skipped).toEqual([{ projectName: 'Mission Map', reason: 'not a git repository' }])
  })
})

describe('D153: collecting a day', () => {
  it('reports a repository once even though two projects point at it', async () => {
    const deps = stubDeps({
      log: { TaxApp: commit('aaa1111', '2026-08-15T10:00:00-04:00', 'Wire up CCH client', ['src/Cch.cs']) }
    })
    const evidence = await collectDayEvidence('2026-08-15', -240, deps)
    const taxapp = evidence.repos.filter((r) => r.repoKey.includes('taxapp'))
    expect(taxapp).toHaveLength(1)
    expect(taxapp[0].commits).toHaveLength(1)
    // Both project names are carried, so the reader still sees which rail
    // entries the work belongs to.
    expect(taxapp[0].projectNames).toEqual(['TR-Integration', 'CCH-integration'])
  })

  it('drops repositories with no commits and no in-flight work', async () => {
    const evidence = await collectDayEvidence('2026-08-15', -240, stubDeps())
    expect(evidence.repos).toEqual([])
    expect(evidence.skipped).toHaveLength(1)
  })

  it('⚠ STALE DIRT IS EXCLUDED AND FRESH DIRT IS KEPT — the false-timesheet guard', async () => {
    const deps = stubDeps({
      status: {
        Chorus: [' M src/main/services/dayReport.ts', '?? docs/stale-from-august-9.md']
      },
      mtimes: {
        'dayReport.ts': Date.parse('2026-08-15T14:22:00-04:00'),
        'stale-from-august-9.md': Date.parse('2026-08-09T08:12:00-04:00')
      }
    })
    const evidence = await collectDayEvidence('2026-08-15', -240, deps)
    const chorus = evidence.repos.find((r) => r.repoKey.includes('chorus'))
    expect(chorus?.dirty.map((d) => d.path)).toEqual(['src/main/services/dayReport.ts'])
  })

  it('sweeps every worktree of a repository for in-flight work, not just the project root', async () => {
    const deps = stubDeps({
      worktrees: {
        TaxApp: [
          { path: 'C:\\Projects\\TaxApp\\TaxApp' },
          { path: 'C:\\Projects\\TaxApp\\TaxApp.worktrees\\feature\\crm-efile-workflow' }
        ]
      },
      status: { 'crm-efile-workflow': [' M src/Efile.cs'] },
      mtimes: { 'Efile.cs': Date.parse('2026-08-15T11:00:00-04:00') }
    })
    const evidence = await collectDayEvidence('2026-08-15', -240, deps)
    expect(evidence.repos[0].dirty.map((d) => d.path)).toEqual(['src/Efile.cs'])
  })

  it('harvests API surface only when something was committed', async () => {
    const patch = [
      'diff --git a/src/main/services/dayReportCore.ts b/src/main/services/dayReportCore.ts',
      '+export function renderMarkdown() {}'
    ].join('\n')
    const withCommits = stubDeps({
      log: { Chorus: commit('bbb2222', '2026-08-15T09:00:00-04:00', 'Add the day report', ['a.ts']) },
      patch: { Chorus: patch }
    })
    const evidence = await collectDayEvidence('2026-08-15', -240, withCommits)
    expect(evidence.repos[0].symbols).toEqual(['renderMarkdown'])

    // No commits ⇒ the expensive patch call is never made.
    let patchCalls = 0
    const quiet = stubDeps()
    const counted: DayReportDeps = {
      ...quiet,
      history: async (root, args) => {
        if (args.includes('-p')) patchCalls++
        return quiet.history(root, args)
      }
    }
    await collectDayEvidence('2026-08-15', -240, counted)
    expect(patchCalls).toBe(0)
  })

  it('degrades rather than failing when one repository’s history cannot be read', async () => {
    const deps = stubDeps({
      log: { Chorus: commit('ccc3333', '2026-08-15T09:00:00-04:00', 'Still fine', ['a.ts']) },
      historyThrowsFor: 'TaxApp'
    })
    const evidence = await collectDayEvidence('2026-08-15', -240, deps)
    // Chorus survives; TaxApp is named as unreadable rather than omitted.
    expect(evidence.repos.map((r) => r.projectNames[0])).toEqual(['Chorus'])
    expect(evidence.skipped.map((s) => s.reason)).toContain('git history could not be read')
  })

  it('stamps the date and generation time it was given', async () => {
    const evidence = await collectDayEvidence('2026-08-15', -240, stubDeps())
    expect(evidence.date).toBe('2026-08-15')
    expect(evidence.generatedAt).toBe('2026-08-15T22:00:00.000Z')
  })
})
