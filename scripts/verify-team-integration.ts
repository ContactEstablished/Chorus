import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { StorageService } from '../src/main/services/storage'
import { GitWorktreeManager } from '../src/main/services/worktrees'
import { TeamWorkspaceService } from '../src/main/services/teamWorkspaceService'
import { reserveNextAttempt } from '../src/main/services/teamCore'
import { teamResolveCommit, teamReadCommit } from '../src/main/services/git'
import type { TeamRun, TeamReview, TeamIntegrate } from '../src/shared/team'
import { teamFixtureRun, teamFixtureTask, teamFixtureId as id, TEAM_FIXTURE_TIME as now } from '../src/main/services/teamTestFixtures'
const exec = promisify(execFile)
export async function verifyTeamIntegration(evidence: string): Promise<number> {
  let assertions = 0, sequence = 20000
  const nextId = () => id(++sequence), check = (fn: () => void) => { fn(); assertions++ }
  for (const policy of ['ask', 'lead-integrates'] as const) {
    const root = path.join(evidence, `integration-${policy}`); fs.mkdirSync(root)
    const git = async (cwd: string, ...args: string[]) => (await exec('git', args, { cwd, windowsHide: true, timeout: 15000 })).stdout
    await git(root, 'init', '-b', 'main'); await git(root, 'config', 'core.autocrlf', 'false')
    fs.writeFileSync(path.join(root, 'value.txt'), 'base\n'); await git(root, 'add', '--all')
    await git(root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-m', 'base')
    const base = await teamResolveCommit(root, 'HEAD')
    const owner = new StorageService(path.join(evidence, `integration-${policy}.db`)), teams = owner.createTeamStorage()
    try {
      const { project } = owner.getOrCreateProject(root)
      const run: TeamRun = { ...teamFixtureRun(), projectId: project.id, status: 'preparing', baseSha: null, integrationHead: null, integrationWorktreeId: null, config: { ...teamFixtureRun().config, integrationPolicy: policy } }
      teams.createRun(run, 'launch', {}, nextId())
      const actor = { role: 'lead' as const, runId: run.id, generation: 1, epoch: 'fixture' }, user = { role: 'user' as const, principal: 'fixture-renderer' }
      let leases = 0
      const workspace = new TeamWorkspaceService({ storage: owner, teams, worktrees: new GitWorktreeManager(owner), assertAuthorized() {}, authorizeLead() {}, writersStopped: async () => true, leadStopped: async () => true, withLeadWriteLease: async (_run, work) => { leases++; return work() }, id: nextId, now: () => now })
      const ready = await workspace.prepareRun(run, new AbortController().signal), integrationPath = owner.getWorktreeById(ready.worktreeId)!.path
      const current = teams.getRun(run.id)
      const op = (operation: string) => ({ runId: run.id, generation: 1, actor: 'system' as const, operation, eventId: nextId(), now })
      teams.command(op('activate'), tx => { tx.updateRun(current.version, { ...current, baseSha: base, integrationHead: base, status: 'active', version: current.version + 1 }); return { acknowledgment: {}, event: {} } })
      async function artifact(n: number, value: string, output = 'value.txt') {
        const task = teamFixtureTask(n), active = teams.getRun(run.id)
        task.command.paths = [output]
        teams.command(op('task'), tx => { tx.writeTask(task); return { acknowledgment: {}, event: {} } })
        // This fixture deliberately constructs conflicting artifacts; scheduler overlap has separate coverage.
        const reserved = reserveNextAttempt(active, [task], teams.attempts(run.id), nextId(), now)!
        teams.command(op('attempt'), tx => { tx.writeAttempt(reserved.attempt); tx.writeTask(reserved.task, task.version); return { acknowledgment: {}, event: {} } })
        const isolated = await workspace.prepareAttempt(active, reserved.attempt, new AbortController().signal)
        fs.writeFileSync(path.join(isolated.cwd, output), value)
        const attempt = teams.attempts(run.id).find(a => a.id === reserved.attempt.id)!
        teams.command(op('result'), tx => { tx.writeAttempt({ ...attempt, status: 'succeeded', cessation: 'confirmed', endedAt: now, version: attempt.version + 1 }, attempt.version); return { acknowledgment: {}, event: {} } })
        await workspace.validateResult(active, reserved.task, attempt)
        const captured = teams.attempts(run.id).find(a => a.id === attempt.id)!
        const running = teams.tasks(run.id).find(t => t.id === task.id)!
        teams.command(op('validated'), tx => { tx.writeTask({ ...running, status: 'awaiting-review', version: running.version + 1 }, running.version); return { acknowledgment: {}, event: {} } })
        const review: TeamReview = { clientRequestId: nextId(), taskId: task.id, attemptId: attempt.id, phase: 'artifact', reviewedSha: captured.artifact!.commitSha, decision: 'accept', explanation: 'Fixture inspected exact artifact.', tests: [] }
        await workspace.review(active, review, actor)
        return { taskId: task.id, attemptId: attempt.id, artifact: captured.artifact! }
      }
      const first = await artifact(10, 'first\n'), competing = await artifact(11, 'competing\n')
      const independent = await artifact(12, 'cheat sheet\n', 'cheat-sheet.txt')
      fs.writeFileSync(path.join(root, 'value.txt'), 'source dirt remains\n')
      const prepare: TeamIntegrate = { action: 'prepare', clientRequestId: nextId(), taskId: first.taskId, attemptId: first.attemptId, reviewedHead: first.artifact.commitSha, expectedIntegrationHead: base }
      const ack = await workspace.integrate(teams.getRun(run.id), prepare, actor)
      check(() => assert.equal(ack.status, 'preparing')); await workspace.settle()
      let prepared = teams.integrations(run.id).find(i => i.id === ack.integrationId)!
      check(() => assert.equal(prepared.status, 'prepared')); check(() => assert.ok(prepared.resultSha))
      const beforeBusy = teams.integrations(run.id).length
      await assert.rejects(workspace.integrate(teams.getRun(run.id), { ...prepare, clientRequestId: nextId(), taskId: independent.taskId, attemptId: independent.attemptId, reviewedHead: independent.artifact.commitSha }, actor), /Finish the pending integration/); assertions++
      check(() => assert.equal(teams.integrations(run.id).length, beforeBusy))
      check(() => assert.equal(teams.tasks(run.id).find(t => t.id === first.taskId)!.status, 'awaiting-review'))
      const result = await teamReadCommit(root, prepared.resultSha!)
      check(() => assert.deepEqual(result.parents, [base])); check(() => assert.ok(result.message.includes(prepared.preparationId)))
      assert.equal(await teamResolveCommit(integrationPath, 'HEAD'), base); assertions++
      const apply: TeamIntegrate = { ...prepare, action: 'apply', clientRequestId: nextId(), integrationId: prepared.id }
      await assert.rejects(workspace.integrate(teams.getRun(run.id), apply, actor), /accepted prepared/); assertions++
      const review: TeamReview = { clientRequestId: nextId(), taskId: first.taskId, attemptId: first.attemptId, phase: 'prepared', integrationId: prepared.id, reviewedSha: prepared.resultSha!, decision: 'accept', explanation: 'Prepared tree inspected.', tests: [] }
      await workspace.review(teams.getRun(run.id), review, actor)
      prepared = teams.integrations(run.id).find(i => i.id === prepared.id)!
      check(() => assert.equal(prepared.status, 'prepared'))
      check(() => assert.equal(prepared.approval, null))
      // Dirty integration content blocks promotion without resetting it.
      fs.writeFileSync(path.join(integrationPath, 'dirty.txt'), 'retain me')
      const dirtyAck = await workspace.integrate(teams.getRun(run.id), { ...apply, clientRequestId: nextId() }, actor); await workspace.settle()
      check(() => assert.equal(teams.integrations(run.id).find(i => i.id === dirtyAck.integrationId)!.status, 'interrupted'))
      check(() => assert.equal(fs.readFileSync(path.join(integrationPath, 'dirty.txt'), 'utf8'), 'retain me'))
      // Fixture owner explicitly removes its own injected file, then obtains a new preparation/review.
      fs.unlinkSync(path.join(integrationPath, 'dirty.txt'))
      const blocked = teams.tasks(run.id).find(t => t.id === first.taskId)!
      teams.command(op('fixture-retry-review'), tx => { tx.writeTask({ ...blocked, status: 'awaiting-review', version: blocked.version + 1 }, blocked.version); return { acknowledgment: {}, event: {} } })
      const retryAck = await workspace.integrate(teams.getRun(run.id), { ...prepare, clientRequestId: nextId() }, actor); await workspace.settle()
      prepared = teams.integrations(run.id).find(i => i.id === retryAck.integrationId)!
      await workspace.review(teams.getRun(run.id), { ...review, clientRequestId: nextId(), integrationId: prepared.id, reviewedSha: prepared.resultSha! }, actor)
      prepared = teams.integrations(run.id).find(i => i.id === prepared.id)!
      const applyCommand = { ...apply, clientRequestId: nextId(), integrationId: prepared.id }
      const appliedAck = await workspace.integrate(teams.getRun(run.id), applyCommand, actor); await workspace.settle()
      const applied = teams.integrations(run.id).find(i => i.id === prepared.id)!
      check(() => assert.equal(applied.status, 'applied')); check(() => assert.equal(leases, 2))
      assert.equal(await teamResolveCommit(integrationPath, 'HEAD'), applied.resultSha); assertions++
      check(() => assert.equal(teams.tasks(run.id).find(t => t.id === first.taskId)!.status, 'awaiting-review'))
      assert.deepEqual(await workspace.integrate(teams.getRun(run.id), applyCommand, actor), appliedAck); assertions++
      assert.equal(await git(integrationPath, 'show', 'HEAD:value.txt'), 'first\n'); assertions++
      const verified: TeamReview = { ...review, clientRequestId: nextId(), phase: 'integrated', integrationId: applied.id, reviewedSha: applied.resultSha!, originalResultSha: applied.resultSha!, verifiedHead: applied.resultSha!, tests: [{ command: 'fixture acceptance', outcome: 'passed', exitCode: 0, executionContext: 'integration', testedSha: applied.resultSha!, testSource: 'tracked', sourcePaths: ['value.txt'], provenance: 'independent', output: 'Verified expected content.' }] }
      await workspace.review(teams.getRun(run.id), verified, actor)
      check(() => assert.equal(teams.tasks(run.id).find(t => t.id === first.taskId)!.status, 'completed'))
      // The second helper's original artifact merges onto the new baseline, without recopying or approval.
      const secondCommand = { ...prepare, clientRequestId: nextId(), taskId: independent.taskId, attemptId: independent.attemptId, reviewedHead: independent.artifact.commitSha, expectedIntegrationHead: applied.resultSha! }
      const secondAck = await workspace.integrate(teams.getRun(run.id), secondCommand, actor); await workspace.settle()
      const second = teams.integrations(run.id).find(i => i.id === secondAck.integrationId)!
      await workspace.review(teams.getRun(run.id), { ...review, clientRequestId: nextId(), taskId: independent.taskId, attemptId: independent.attemptId, integrationId: second.id, reviewedSha: second.resultSha! }, actor)
      await workspace.integrate(teams.getRun(run.id), { ...secondCommand, action: 'apply', clientRequestId: nextId(), integrationId: second.id }, actor); await workspace.settle()
      const combinedHead = await teamResolveCommit(integrationPath, 'HEAD')
      check(() => assert.equal(combinedHead, second.resultSha))
      assert.equal(await git(integrationPath, 'show', 'HEAD:value.txt'), 'first\n'); assertions++
      assert.equal(await git(integrationPath, 'show', 'HEAD:cheat-sheet.txt'), 'cheat sheet\n'); assertions++
      check(() => assert.equal(teams.tasks(run.id).find(t => t.id === independent.taskId)!.attemptCount, 1))
      check(() => assert.equal(teams.integrations(run.id).find(i => i.id === second.id)!.approval, null))
      const conflictAck = await workspace.integrate(teams.getRun(run.id), { ...prepare, clientRequestId: nextId(), taskId: competing.taskId, attemptId: competing.attemptId, reviewedHead: competing.artifact.commitSha, expectedIntegrationHead: combinedHead }, actor); await workspace.settle()
      const conflict = teams.integrations(run.id).find(i => i.id === conflictAck.integrationId)!
      check(() => assert.equal(conflict.status, 'conflict')); check(() => assert.equal(teams.tasks(run.id).find(t => t.id === competing.taskId)!.status, 'needs-revision'))
      assert.equal(await teamResolveCommit(integrationPath, 'HEAD'), combinedHead); assertions++
      check(() => assert.equal(fs.readFileSync(path.join(root, 'value.txt'), 'utf8'), 'source dirt remains\n'))
      if (policy === 'ask') {
        for (const [offset, boundary] of ['integration-objects', 'integration-prepared', 'integration-applying', 'integration-settled'].entries()) {
          const candidate = await artifact(20 + offset, `fault-${offset}\n`), head = await teamResolveCommit(integrationPath, 'HEAD')
          const request: TeamIntegrate = { ...prepare, clientRequestId: nextId(), taskId: candidate.taskId, attemptId: candidate.attemptId, reviewedHead: candidate.artifact.commitSha, expectedIntegrationHead: head }
          const originalCommand = teams.command.bind(teams)
          let armed = true
          const inject = () => { teams.command = (operation, change) => {
            if (operation.operation !== boundary || !armed) return originalCommand(operation, change)
            armed = false
            if (boundary === 'integration-objects' || boundary === 'integration-applying') originalCommand(operation, change)
            throw Error(`Injected boundary ${boundary}`)
          } }
          if (boundary === 'integration-objects' || boundary === 'integration-prepared') inject()
          const preparing = await workspace.integrate(teams.getRun(run.id), request, actor); await workspace.settle()
          let item = teams.integrations(run.id).find(i => i.id === preparing.integrationId)!
          if (boundary === 'integration-applying' || boundary === 'integration-settled') {
            await workspace.review(teams.getRun(run.id), { ...review, clientRequestId: nextId(), taskId: candidate.taskId, attemptId: candidate.attemptId, integrationId: item.id, reviewedSha: item.resultSha! }, actor)
            item = teams.integrations(run.id).find(i => i.id === item.id)!
            inject()
            await workspace.integrate(teams.getRun(run.id), { ...request, action: 'apply', clientRequestId: nextId(), integrationId: item.id }, actor); await workspace.settle()
          }
          teams.command = originalCommand
          item = teams.integrations(run.id).find(i => i.id === item.id)!
          check(() => assert.equal(armed, false))
          check(() => assert.equal(item.status, boundary.startsWith('integration-a') || boundary === 'integration-settled' ? 'recovery-required' : 'interrupted'))
          const actualHead = await teamResolveCommit(integrationPath, 'HEAD')
          check(() => assert.equal(actualHead, boundary === 'integration-settled' ? item.resultSha : head))
          check(() => assert.ok(owner.getWorktreeById(item.stagingWorktreeId!)))
          if (boundary === 'integration-applying' || boundary === 'integration-settled') {
            check(() => assert.equal(teams.getRun(run.id).status, 'blocked'))
            await assert.rejects(workspace.integrate(teams.getRun(run.id), { ...request, clientRequestId: nextId() }, actor), /current active lead/); assertions++
            // Fixture-only metadata repair lets the next independent boundary run.
            // Production boot repair belongs to the separate recovery verifier.
            const blockedRun = teams.getRun(run.id), blockedTask = teams.tasks(run.id).find(t => t.id === candidate.taskId)!
            teams.command(op('fixture-evidence-repair'), tx => {
              tx.updateRun(blockedRun.version, { ...blockedRun, status: 'active', integrationHead: actualHead, blocker: null, version: blockedRun.version + 1 })
              tx.writeIntegration({ ...item, status: actualHead === item.resultSha ? 'applied' : 'interrupted', version: item.version + 1 }, item.version)
              tx.writeTask({ ...blockedTask, status: actualHead === item.resultSha ? 'awaiting-review' : 'blocked', version: blockedTask.version + 1 }, blockedTask.version)
              return { acknowledgment: {}, event: { boundary, head: actualHead } }
            })
          }
        }
        // A clean lead checkpoint becomes the next reserved helper base.
        fs.writeFileSync(path.join(integrationPath, 'checkpoint.txt'), 'lead checkpoint\n')
        await git(integrationPath, 'add', '--all'); await git(integrationPath, '-c', 'user.name=Lead', '-c', 'user.email=lead@localhost', 'commit', '-m', 'checkpoint')
        const checkpoint = await teamResolveCommit(integrationPath, 'HEAD')
        await workspace.refreshIntegrationHead(teams.getRun(run.id))
        check(() => assert.equal(teams.getRun(run.id).integrationHead, checkpoint))
        fs.writeFileSync(path.join(integrationPath, 'dirty-checkpoint.txt'), 'uncommitted')
        await assert.rejects(workspace.refreshIntegrationHead(teams.getRun(run.id)), /Checkpoint and clean/); assertions++
      }
    } finally { owner.close() }
  }
  return assertions
}
