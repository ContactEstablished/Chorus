import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { StorageService } from '../src/main/services/storage'
import { GitWorktreeManager } from '../src/main/services/worktrees'
import { TeamWorkspaceService } from '../src/main/services/teamWorkspaceService'
import { TeamRecoveryService } from '../src/main/services/teamRecoveryService'
import { reserveNextAttempt, reviseTask } from '../src/main/services/teamCore'
import { teamFixtureRun, teamFixtureTask, teamFixtureId as id, TEAM_FIXTURE_TIME as now } from '../src/main/services/teamTestFixtures'

/** Real Git/storage/workspace effects, controlled helper results; no model calls. */
export async function verifyTeamRevision(evidence: string): Promise<number> {
  let assertions = 0, sequence = 70000
  const nextId = () => id(++sequence), check = (fn: () => void) => { fn(); assertions++ }
  for (const scenario of ['same-base', 'advanced-base', 'already-applied', 'conflict', 'scope', 'cancel', 'missing-artifact', 'failed-partial', 'seed-crash-before-commit', 'seed-crash-after-commit']) {
    const root = path.join(evidence, scenario); fs.mkdirSync(root)
    const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true }).trim()
    git(root, 'init', '-qb', 'main'); git(root, 'config', 'core.autocrlf', 'false')
    for (const file of ['one.txt', 'two.txt', 'other.txt']) fs.writeFileSync(path.join(root, file), 'stub\n')
    git(root, 'add', '.'); git(root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'baseline')
    const base = git(root, 'rev-parse', 'HEAD'), owner = new StorageService(path.join(evidence, `${scenario}.db`)), teams = owner.createTeamStorage()
    try {
      const { project } = owner.getOrCreateProject(root)
      const run = { ...teamFixtureRun(), projectId: project.id, status: 'preparing' as const, baseSha: null, integrationHead: null, integrationWorktreeId: null }
      teams.createRun(run, 'launch', {}, nextId())
      const op = (operation: string) => ({ runId: run.id, generation: 1, actor: 'system' as const, operation, eventId: nextId(), now })
      const workspace = new TeamWorkspaceService({ storage: owner, teams, worktrees: new GitWorktreeManager(owner), assertAuthorized() {}, authorizeLead() {}, writersStopped: async () => true, withLeadWriteLease: async (_run, work) => work(), now: () => now, id: nextId })
      const ready = await workspace.prepareRun(run, new AbortController().signal), integrationPath = owner.getWorktreeById(ready.worktreeId)!.path
      const current = teams.getRun(run.id)
      teams.command(op('activate'), tx => { tx.updateRun(current.version, { ...current, status: 'active', baseSha: base, integrationHead: base, version: current.version + 1 }); return { acknowledgment: {}, event: {} } })
      const task = teamFixtureTask(10); task.command.paths = ['one.txt', 'two.txt']
      teams.command(op('task'), tx => { tx.writeTask(task); return { acknowledgment: {}, event: {} } })
      function reserve() {
        const reserved = reserveNextAttempt(teams.getRun(run.id), teams.tasks(run.id), teams.attempts(run.id), nextId(), now)!
        teams.command(op('reserve'), tx => { tx.writeAttempt(reserved.attempt); tx.writeTask(reserved.task, reserved.task.version - 1); return { acknowledgment: {}, event: {} } })
        return reserved.attempt
      }
      async function capture(attemptId: string) {
        const a = teams.attempts(run.id).find(a => a.id === attemptId)!, t = teams.tasks(run.id)[0]
        teams.command(op('result'), tx => { tx.writeAttempt({ ...a, status: 'succeeded', cessation: 'confirmed', version: a.version + 1, endedAt: now }, a.version); tx.writeTask({ ...t, status: 'awaiting-review', version: t.version + 1 }, t.version); return { acknowledgment: {}, event: {} } })
        await workspace.validateResult(teams.getRun(run.id), teams.tasks(run.id)[0], teams.attempts(run.id).find(a => a.id === attemptId)!)
        return teams.attempts(run.id).find(a => a.id === attemptId)!
      }
      const first = reserve(), initial = await workspace.prepareAttempt(teams.getRun(run.id), first, new AbortController().signal)
      fs.writeFileSync(path.join(initial.cwd, 'one.txt'), 'implementation with defect\n')
      fs.writeFileSync(path.join(initial.cwd, 'two.txt'), 'unaffected implementation\n')
      const captured = scenario === 'failed-partial' ? null : await capture(first.id)
      if (!captured) {
        const a = teams.attempts(run.id)[0], t = teams.tasks(run.id)[0]
        teams.command(op('failed'), tx => { tx.writeAttempt({ ...a, status: 'failed', cessation: 'confirmed', version: a.version + 1 }, a.version); tx.writeTask({ ...t, status: 'failed', version: t.version + 1 }, t.version); return { acknowledgment: {}, event: {} } })
      }
      if (['advanced-base', 'conflict'].includes(scenario)) {
        fs.writeFileSync(path.join(integrationPath, scenario === 'conflict' ? 'one.txt' : 'other.txt'), 'concurrent change\n')
        git(integrationPath, 'add', '.'); git(integrationPath, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'advance')
        await workspace.refreshIntegrationHead(teams.getRun(run.id))
      }
      if (scenario === 'already-applied') {
        git(integrationPath, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'cherry-pick', captured!.artifact!.commitSha)
        await workspace.refreshIntegrationHead(teams.getRun(run.id))
      }
      const active = teams.getRun(run.id), oldTask = teams.tasks(run.id)[0]
      const revised = reviseTask(active, oldTask, teams.attempts(run.id), first.memberId, 'Correct the defect in one.txt; preserve two.txt.', now)
      teams.command(op('revise'), tx => { tx.writeTask(revised, oldTask.version); return { acknowledgment: {}, event: {} } })
      const second = reserve()
      if (scenario === 'scope') {
        const t = teams.tasks(run.id)[0]
        teams.command(op('scope-change'), tx => { tx.writeTask({ ...t, command: { ...t.command, paths: ['one.txt'] }, version: t.version + 1 }, t.version); return { acknowledgment: {}, event: {} } })
      }
      if (scenario === 'missing-artifact') git(root, 'update-ref', '-d', captured!.artifact!.ref)
      const controller = new AbortController(); if (scenario === 'cancel') controller.abort()
      if (scenario.startsWith('seed-crash-')) {
        const command = teams.command.bind(teams)
        teams.command = (operation, effect) => {
          const result = command(operation, effect)
          if (operation.operation === (scenario === 'seed-crash-before-commit' ? 'revision-seed-prepared' : 'revision-seed-completed')) throw Error('Injected seed crash')
          return result
        }
        await assert.rejects(workspace.prepareAttempt(active, second, controller.signal), /Injected seed crash/); assertions++
        teams.command = command
        const stored = teams.attempts(run.id).find(a => a.id === second.id)!, revisionPath = owner.getWorktreeById(stored.worktreeId!)!.path
        const before = git(revisionPath, 'rev-parse', 'HEAD'), content = fs.readFileSync(path.join(revisionPath, 'two.txt'), 'utf8')
        const recovery = new TeamRecoveryService({ storage: owner, teams: owner.createTeamStorage(), stopLead: async () => true, stopAttempt: async () => true, unavailable() {} })
        await recovery.reconcileAll()
        check(() => assert.equal(git(revisionPath, 'rev-parse', 'HEAD'), before, 'Recovery never replays the seed effect'))
        check(() => assert.equal(fs.readFileSync(path.join(revisionPath, 'two.txt'), 'utf8'), content))
        check(() => assert.equal(teams.attempts(run.id).find(a => a.id === second.id)!.status, 'interrupted'))
        check(() => assert.equal(teams.attempts(run.id).find(a => a.id === second.id)!.revisionSeed!.artifactSha, captured!.artifact!.commitSha))
        continue
      }
      if (['conflict', 'scope', 'cancel', 'missing-artifact'].includes(scenario)) {
        await assert.rejects(workspace.prepareAttempt(active, second, controller.signal)); assertions++
        check(() => assert.equal(fs.readFileSync(path.join(root, 'one.txt'), 'utf8'), 'stub\n'))
        check(() => assert.equal(fs.readFileSync(path.join(initial.cwd, 'two.txt'), 'utf8'), 'unaffected implementation\n'))
        continue
      }
      const revision = await workspace.prepareAttempt(active, second, controller.signal)
      if (scenario === 'failed-partial') {
        check(() => assert.equal(fs.readFileSync(path.join(revision.cwd, 'two.txt'), 'utf8'), 'stub\n'))
        continue
      }
      check(() => assert.equal(fs.readFileSync(path.join(revision.cwd, 'two.txt'), 'utf8'), 'unaffected implementation\n', 'Revision must begin with the captured implementation'))
      check(() => assert.equal(fs.readFileSync(path.join(revision.cwd, 'one.txt'), 'utf8'), 'implementation with defect\n'))
      check(() => assert.equal(revision.baseSha, active.integrationHead, 'Capture base stays the integration baseline'))
      fs.writeFileSync(path.join(revision.cwd, 'one.txt'), 'corrected implementation\n')
      const final = await capture(second.id), actor = { role: 'lead' as const, runId: run.id, generation: 1, epoch: 'fixture' }
      check(() => assert.equal(git(root, 'show', `${final.artifact!.commitSha}:two.txt`), 'unaffected implementation'))
      await workspace.review(active, { clientRequestId: nextId(), taskId: task.id, attemptId: second.id, phase: 'artifact', reviewedSha: final.artifact!.commitSha, decision: 'accept', explanation: 'Correction inspected.', tests: [] }, actor)
      const command = { clientRequestId: nextId(), taskId: task.id, attemptId: second.id, action: 'prepare' as const, reviewedHead: final.artifact!.commitSha, expectedIntegrationHead: active.integrationHead! }
      const ack = await workspace.integrate(active, command, actor); await workspace.settle()
      const prepared = teams.integrations(run.id).find(i => i.id === ack.integrationId)!
      await workspace.review(teams.getRun(run.id), { clientRequestId: nextId(), taskId: task.id, attemptId: second.id, phase: 'prepared', integrationId: prepared.id, reviewedSha: prepared.resultSha!, decision: 'accept', explanation: 'Complete deliverable inspected.', tests: [] }, actor)
      await workspace.integrate(teams.getRun(run.id), { ...command, clientRequestId: nextId(), action: 'apply', integrationId: prepared.id }, actor); await workspace.settle()
      check(() => assert.equal(fs.readFileSync(path.join(integrationPath, 'one.txt'), 'utf8'), 'corrected implementation\n'))
      check(() => assert.equal(fs.readFileSync(path.join(integrationPath, 'two.txt'), 'utf8'), 'unaffected implementation\n'))
      check(() => assert.equal(fs.readFileSync(path.join(integrationPath, 'other.txt'), 'utf8'), scenario === 'advanced-base' ? 'concurrent change\n' : 'stub\n'))
      check(() => assert.equal(git(root, 'status', '--porcelain'), ''))
    } finally { owner.close() }
  }
  return assertions
}
