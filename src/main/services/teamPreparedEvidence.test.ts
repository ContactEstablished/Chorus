import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { TeamWorkspaceService } from './teamWorkspaceService'
import { teamChangedContentIdentity, teamDiff } from './git'
import { teamDetailSchema, type TeamAttempt, type TeamReview } from '../../shared/team'
import { teamFixtureRun, teamFixtureTask, teamFixtureIntegration, teamFixtureId as id } from './teamTestFixtures'

describe('complete prepared content evidence with real Git objects', () => {
  let root: string, base: string, artifact: string, changed: string, baseline: string, prepared: string
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true }).trim()
  const commit = () => { git('add', '--all'); git('commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD') }
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'chorus-prepared-proof-'))
    git('init', '-qb', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@localhost'); git('config', 'core.autocrlf', 'false')
    fs.writeFileSync(path.join(root, 'large.txt'), 'base\n'); fs.writeFileSync(path.join(root, 'deleted.txt'), 'delete me\n'); base = commit()
    git('checkout', '-qb', 'artifact')
    fs.writeFileSync(path.join(root, 'large.txt'), 'line\n'.repeat(60000) + 'end-A\n')
    fs.writeFileSync(path.join(root, 'binary.bin'), Buffer.from([0, 1, 2, 255])); fs.unlinkSync(path.join(root, 'deleted.txt')); artifact = commit()
    // Differences after the human-readable summary cap must remain visible to the proof.
    fs.writeFileSync(path.join(root, 'large.txt'), 'line\n'.repeat(60000) + 'end-B\n'); changed = commit()
    git('checkout', '-q', 'main'); fs.writeFileSync(path.join(root, 'unrelated.txt'), 'new baseline\n'); baseline = commit()
    git('checkout', '-qb', 'prepared'); git('cherry-pick', artifact); prepared = git('rev-parse', 'HEAD'); git('checkout', '-q', 'main')
  }, 30000)
  afterAll(() => {
    if (!root) return
    expect(path.dirname(path.resolve(root))).toBe(path.resolve(os.tmpdir()))
    expect(path.basename(root)).toMatch(/^chorus-prepared-proof-/)
    fs.rmSync(root, { recursive: true, force: true })
  })

  function fixture() {
    const run = { ...teamFixtureRun(), integrationHead: baseline }
    const task = { ...teamFixtureTask(), currentAttemptId: id(20), status: 'awaiting-review' as const }
    const attempt = { id: id(20), runId: run.id, taskId: task.id, status: 'succeeded', cessation: 'confirmed', artifact: { baseSha: base, commitSha: artifact } } as TeamAttempt
    const integration = { ...teamFixtureIntegration(), artifactSha: artifact, expectedHead: baseline, resultSha: prepared }
    let accepted: { id: string; review: TeamReview } | null = { id: id(70), review: { clientRequestId: 'accepted', taskId: task.id, attemptId: attempt.id, phase: 'artifact', reviewedSha: artifact, decision: 'accept', explanation: 'Reviewed full artifact', tests: [] } }
    const service = new TeamWorkspaceService({
      teams: { snapshot: () => ({ run, tasks: [task], attempts: [attempt], integrations: [integration] }), latestReview: () => accepted, unretiredVerificationStarts: () => [] } as never,
      storage: { getWorktreeById: () => ({ projectId: run.projectId, path: root, repoRoot: root, branch: 'main' }) } as never,
      worktrees: {} as never, assertAuthorized() {}, writersStopped: async () => true
    })
    const detail = (overrides = {}) => service.detail(run, teamDetailSchema.parse({ section: 'diff', integrationId: integration.id, reuseReviewed: true, ...overrides })) as Promise<any>
    return { run, task, attempt, integration, detail, setReview: (value: typeof accepted) => { accepted = value }, accepted }
  }
  it('proves an accepted artifact on a different, disjoint baseline without returning diff text', async () => {
    const f = fixture(), result = await f.detail()
    expect(result).toMatchObject({ kind: 'reviewed-equivalent', artifactReviewId: id(70), artifactBaseSha: base, artifactSha: artifact, expectedHead: baseline, resultSha: prepared })
    expect(result).not.toHaveProperty('text')
    const full = await teamDiff(root, baseline, prepared)
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(Buffer.byteLength(full.text) / 100)
  })
  it('keeps full diff access and pagination available', async () => {
    const page = await fixture().detail({ reuseReviewed: false })
    expect(page.text).toContain('diff --git'); expect(page.nextOffset).toBe(16384)
    expect((await fixture().detail({ offset: page.nextOffset })).text).toBeTruthy()
  })
  it('detects complete content differences beyond 256 KiB', async () => {
    const [a, b] = await Promise.all([teamDiff(root, base, artifact), teamDiff(root, base, changed)])
    expect(a.truncated && b.truncated).toBe(true)
    // Raw full blob IDs remain distinct regardless of capped text similarity.
    expect(await teamChangedContentIdentity(root, base, artifact)).not.toBe(await teamChangedContentIdentity(root, base, changed))
    const f = fixture(); f.integration.resultSha = changed
    expect(await f.detail()).not.toHaveProperty('kind', 'reviewed-equivalent')
  })
  it.each(['missing', 'rejected', 'wrong-sha', 'stale-head', 'conflict', 'running', 'old-attempt'])('refuses compact proof for %s', async condition => {
    const f = fixture()
    if (condition === 'missing') f.setReview(null)
    if (condition === 'rejected') f.accepted!.review.decision = 'revise'
    if (condition === 'wrong-sha') f.accepted!.review.reviewedSha = changed
    if (condition === 'stale-head') f.integration.expectedHead = base
    if (condition === 'conflict') f.integration.status = 'conflict'
    if (condition === 'running') f.attempt.cessation = 'unknown'
    if (condition === 'old-attempt') {
      f.integration.attemptId = id(21)
      await expect(f.detail()).rejects.toThrow(/current artifact/); return
    }
    expect(await f.detail()).not.toHaveProperty('kind', 'reviewed-equivalent')
  })
  it('rejects an unknown integration instead of returning an artifact under the wrong identity', async () => {
    await expect(fixture().detail({ integrationId: id(99), taskId: id(10) })).rejects.toThrow(/integration in this run/)
  })
})
