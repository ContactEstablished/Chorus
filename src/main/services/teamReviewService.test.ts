import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { readTeamFile, readTeamPreview, readTeamReview } from './teamReviewService'
import { teamFixtureIntegration, teamFixtureRun, teamFixtureTask } from './teamTestFixtures'
import type { TeamStorage } from './teamStorage'
import type { StorageService } from './storage'

describe('Immutable Team review previews', () => {
  let cwd: string, before: string, after: string
  const git = (...args: string[]) => execFileSync('git', args, { cwd, windowsHide: true, encoding: 'utf8' }).trim()
  beforeAll(() => {
    cwd = mkdtempSync(join(tmpdir(), 'chorus-review-test-'))
    git('init', '-q'); git('config', 'user.name', 'Review test'); git('config', 'user.email', 'test@localhost')
    writeFileSync(join(cwd, 'page.html'), '<h1>Before</h1>'); git('add', '.'); git('commit', '-qm', 'before'); before = git('rev-parse', 'HEAD')
    writeFileSync(join(cwd, 'page.html'), '<h1>Proposed</h1>'); writeFileSync(join(cwd, 'sheet.pdf'), Buffer.from('%PDF-1.7\nfixture'))
    writeFileSync(join(cwd, 'raw.bin'), Buffer.from([0, 1, 2])); git('add', '.'); git('commit', '-qm', 'after'); after = git('rev-parse', 'HEAD')
    writeFileSync(join(cwd, 'page.html'), '<h1>Unreviewed edit</h1>')
  })
  afterAll(() => rmSync(cwd, { recursive: true, force: true }))
  function fixture() {
    const run = teamFixtureRun(), integration = { ...teamFixtureIntegration(), expectedHead: before, resultSha: after }
    const teams = { getRun: () => run, integrations: () => [integration], tasks: () => [teamFixtureTask()], latestReview: vi.fn(() => null) } as unknown as TeamStorage
    const storage = { getWorktreeById: () => ({ path: cwd, projectId: run.projectId }) } as unknown as StorageService
    return { teams, storage, integration, q: { runId: run.id, integrationId: integration.id, expectedVersion: integration.version } }
  }
  it('reads before and after from commits despite mutable checkout changes', async () => {
    expect(await readTeamFile(cwd, before, 'page.html')).toMatchObject({ kind: 'html', content: '<h1>Before</h1>', sha: before })
    expect(await readTeamFile(cwd, after, 'page.html')).toMatchObject({ kind: 'html', content: '<h1>Proposed</h1>', sha: after })
  })
  it('encodes PDFs without corrupting binary bytes and labels missing files', async () => {
    const pdf = await readTeamFile(cwd, after, 'sheet.pdf')
    expect(pdf.kind).toBe('pdf'); expect(Buffer.from(pdf.content, 'base64').toString()).toBe('%PDF-1.7\nfixture')
    expect(await readTeamFile(cwd, before, 'sheet.pdf')).toMatchObject({ kind: 'unavailable' })
    expect(await readTeamFile(cwd, after, 'raw.bin')).toMatchObject({ kind: 'unavailable' })
  })
  it('loads current evidence without traversing hundreds of history events', async () => {
    const { teams, storage, q } = fixture()
    expect(await readTeamReview(teams, storage, q)).toMatchObject({ paths: ['page.html', 'raw.bin', 'sheet.pdf'], tests: [], explanation: expect.stringContaining('No lead review') })
  })
  it('rejects stale versions and paths outside the prepared changes', async () => {
    const { teams, storage, q } = fixture()
    await expect(readTeamReview(teams, storage, { ...q, expectedVersion: 999 })).rejects.toThrow('changed')
    await expect(readTeamPreview(teams, storage, { ...q, side: 'after', path: '../secret' })).rejects.toThrow('changed file')
    await expect(readTeamPreview(teams, storage, { ...q, side: 'before', path: 'page.html' })).resolves.toMatchObject({ content: '<h1>Before</h1>' })
  })
  it('does not attach a different preparation’s lead explanation', async () => {
    const { teams, storage, q, integration } = fixture()
    vi.mocked(teams.latestReview).mockReturnValue({ id: integration.preparedReviewId!, review: { integrationId: integration.id, reviewedSha: before, explanation: 'Stale claim', tests: [] } } as never)
    expect((await readTeamReview(teams, storage, q)).explanation).not.toBe('Stale claim')
  })
})
