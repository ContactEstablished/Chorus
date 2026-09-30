import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { StorageService } from '../src/main/services/storage'
import { GitWorktreeManager } from '../src/main/services/worktrees'
import { TeamWorkspaceService } from '../src/main/services/teamWorkspaceService'
import { reserveNextAttempt } from '../src/main/services/teamCore'
import { teamResolveCommit } from '../src/main/services/git'
import { teamFixtureRun, teamFixtureTask, teamFixtureId as id, TEAM_FIXTURE_TIME as now } from '../src/main/services/teamTestFixtures'
const exec = promisify(execFile)
export async function verifyTeamWorkspace(evidence: string): Promise<number> {
  let assertions = 0, sequence = 5000
  const check = (fn: () => void) => { fn(); assertions++ }, nextId = () => id(++sequence)
  const root = path.join(evidence, 'workspace-repo'); fs.mkdirSync(root)
  const git = async (cwd: string, ...args: string[]) => (await exec('git', args, { cwd, windowsHide: true, timeout: 15000 })).stdout
  await git(root, 'init', '-b', 'main'); await git(root, 'config', 'core.autocrlf', 'false'); fs.writeFileSync(path.join(root, 'source.txt'), 'base\n')
  await git(root, 'add', '--all'); await git(root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-m', 'base')
  const base = await teamResolveCommit(root, 'HEAD')
  fs.writeFileSync(path.join(root, 'source.txt'), 'source dirt must be preserved\n')
  const owner = new StorageService(path.join(evidence, 'workspace.db')), teams = owner.createTeamStorage(), manager = new GitWorktreeManager(owner)
  try {
    const { project } = owner.getOrCreateProject(root)
    let run = { ...teamFixtureRun(), projectId: project.id, status: 'preparing' as const, baseSha: null, integrationHead: null, integrationWorktreeId: null }
    teams.createRun(run, 'workspace-launch', {}, nextId())
    const workspace = new TeamWorkspaceService({ storage: owner, teams, worktrees: manager, assertAuthorized() {}, writersStopped: async () => true, now: () => now, id: nextId })
    const prepared = await workspace.prepareRun(run, new AbortController().signal)
    const managed = owner.getWorktreeById(prepared.worktreeId)!
    check(() => assert.equal(managed.status, 'detached')); check(() => assert.equal(managed.sessionId, null))
    check(() => assert.equal(fs.readFileSync(path.join(managed.path, 'source.txt'), 'utf8'), 'base\n'))
    check(() => assert.equal(teams.getRun(run.id).integrationWorktreeId, managed.id))
    check(() => assert.equal(teams.unfinishedOperations(run.id).length, 0))
    const current = teams.getRun(run.id)
    teams.command({ runId: run.id, generation: 1, actor: 'system', operation: 'fixture-activate', eventId: nextId(), now }, tx => { tx.updateRun(current.version, { ...current, status: 'active', baseSha: base, integrationHead: base, version: current.version + 1 }); return { acknowledgment: {}, event: {} } })
    async function resultTask(n: number, kind: 'code' | 'analysis', changed = true) {
      const active = teams.getRun(run.id), task = { ...teamFixtureTask(n), command: { ...teamFixtureTask(n).command, kind, paths: n === 10 ? ['source.txt', `result-${n}.txt`] : [`result-${n}.txt`] } }
      teams.command({ runId: run.id, generation: 1, actor: 'system', operation: 'fixture-task', eventId: nextId(), now }, tx => { tx.writeTask(task); return { acknowledgment: {}, event: {} } })
      const reservation = reserveNextAttempt(active, teams.tasks(run.id), teams.attempts(run.id), nextId(), now)!
      teams.command({ runId: run.id, generation: 1, actor: 'system', operation: 'fixture-reserve', eventId: nextId(), now }, tx => { tx.writeAttempt(reservation.attempt); tx.writeTask(reservation.task, task.version); return { acknowledgment: {}, event: {} } })
      const isolated = await workspace.prepareAttempt(active, reservation.attempt, new AbortController().signal)
      if (changed) fs.writeFileSync(path.join(isolated.cwd, `result-${n}.txt`), `Result ${n}\n`)
      const attempt = teams.attempts(run.id).find(a => a.id === reservation.attempt.id)!
      teams.command({ runId: run.id, generation: 1, actor: 'system', operation: 'fixture-result', eventId: nextId(), now }, tx => { tx.writeAttempt({ ...attempt, status: 'succeeded', cessation: 'confirmed', endedAt: now, version: attempt.version + 1 }, attempt.version); return { acknowledgment: {}, event: {} } })
      return { active, task: teams.tasks(run.id).find(t => t.id === task.id)!, attempt: teams.attempts(run.id).find(a => a.id === attempt.id)!, isolated }
    }
    const first = await resultTask(10, 'code')
    fs.writeFileSync(path.join(first.isolated.cwd, 'source.txt'), 'helper final tracked content\n')
    const indexPath = (await git(first.isolated.cwd, 'rev-parse', '--path-format=absolute', '--git-path', 'index')).trim(), indexBefore = fs.readFileSync(indexPath)
    await workspace.validateResult(first.active, first.task, first.attempt)
    check(() => assert.deepEqual(fs.readFileSync(indexPath), indexBefore))
    const artifact = teams.attempts(run.id).find(a => a.id === first.attempt.id)!.artifact!
    check(() => assert.ok(artifact)); check(() => assert.equal(artifact.id, first.attempt.id))
    check(() => assert.equal(artifact.baseSha, base)); check(() => assert.ok(artifact.manifest.includes('result-10.txt')))
    check(() => assert.match(artifact.ref, /^refs\/chorus\/teams\//))
    assert.equal(await teamResolveCommit(root, artifact.ref), artifact.commitSha); assertions++
    await workspace.validateResult(first.active, first.task, first.attempt)
    check(() => assert.deepEqual(teams.attempts(run.id).find(a => a.id === first.attempt.id)!.artifact, artifact))
    const analysis = await resultTask(11, 'analysis')
    await assert.rejects(workspace.validateResult(analysis.active, analysis.task, analysis.attempt), /Analysis changed/); assertions++
    check(() => assert.equal(teams.attempts(run.id).find(a => a.id === analysis.attempt.id)!.artifact, null))
    const interrupted = await resultTask(12, 'code')
    const publish = teams.publishArtifact.bind(teams)
    teams.publishArtifact = () => { throw Error('Injected after Git ref before metadata') }
    await assert.rejects(workspace.validateResult(interrupted.active, interrupted.task, interrupted.attempt), /Injected/); assertions++
    const capture = teams.captureReservation(run.id, interrupted.attempt.id)!
    check(() => assert.equal(teams.unfinishedOperations(run.id).length, 1))
    const durableRef = await teamResolveCommit(root, capture.ref)
    teams.publishArtifact = publish
    await workspace.validateResult(interrupted.active, interrupted.task, interrupted.attempt)
    check(() => assert.equal(teams.attempts(run.id).find(a => a.id === interrupted.attempt.id)!.artifact?.commitSha, durableRef))
    check(() => assert.equal(teams.unfinishedOperations(run.id).length, 0))
    const unchanged = await resultTask(13, 'code', false)
    await workspace.validateResult(unchanged.active, unchanged.task, unchanged.attempt)
    check(() => assert.equal(teams.attempts(run.id).find(a => a.id === unchanged.attempt.id)!.artifact, null))
    const noChanges = teams.noChangesCapture(run.id, unchanged.attempt.id)!
    check(() => assert.equal(noChanges.noChanges, true))
    check(() => assert.throws(() => teams.recordCaptureObjects(teams.captureReservation(run.id, unchanged.attempt.id)!, base, base, nextId(), now), /cannot become/))
    check(() => assert.equal(teams.unfinishedOperations(run.id).length, 0))
    check(() => assert.equal(fs.readFileSync(path.join(root, 'source.txt'), 'utf8'), 'source dirt must be preserved\n'))
    // Simulate process loss after each durable capture boundary. Retried capture must
    // reuse its existing attempt/capture/ref identity rather than inventing new work.
    for (const [offset, method] of ['reserveCapture', 'recordCaptureObjects', 'publishArtifact'].entries()) {
      const candidate = await resultTask(20 + offset, 'code')
      const mutable = teams as unknown as Record<string, (...args: unknown[]) => unknown>
      const original = mutable[method].bind(teams)
      mutable[method] = (...args) => { original(...args); throw Error(`Injected after ${method}`) }
      await assert.rejects(workspace.validateResult(candidate.active, candidate.task, candidate.attempt), /Injected after/); assertions++
      mutable[method] = original
      const reservation = teams.captureReservation(run.id, candidate.attempt.id)!
      check(() => assert.equal(reservation.attemptId, candidate.attempt.id))
      check(() => assert.equal(teams.unfinishedOperations(run.id).length, method === 'publishArtifact' ? 0 : 1))
      if (method !== 'publishArtifact') { await assert.rejects(teamResolveCommit(root, reservation.ref)); assertions++ }
      await workspace.validateResult(candidate.active, candidate.task, candidate.attempt)
      const completed = teams.attempts(run.id).find(a => a.id === candidate.attempt.id)!.artifact!
      check(() => assert.equal(completed.captureId, reservation.captureId))
      check(() => assert.equal(teams.unfinishedOperations(run.id).length, 0))
    }
    let reservedId = '', checks = 0
    await assert.rejects(manager.createManagedWorktree({ projectId: project.id, repoRoot: root, baseSha: base, signal: new AbortController().signal,
      reserve: row => { reservedId = row.id; check(() => assert.ok(owner.getWorktreeById(row.id))); check(() => assert.equal(fs.existsSync(row.path), false)) },
      assertAuthorized: () => { if (++checks === 2) throw Error('Injected revocation before Git') }
    }), /revocation/); assertions++
    check(() => assert.equal(owner.getWorktreeById(reservedId)?.status, 'creating'))
    check(() => assert.equal(fs.existsSync(owner.getWorktreeById(reservedId)!.path), false))
    return assertions
  } finally { owner.close() }
}
