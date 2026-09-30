import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { StorageService } from '../src/main/services/storage'
import { GitWorktreeManager } from '../src/main/services/worktrees'
import { TeamWorkspaceService } from '../src/main/services/teamWorkspaceService'
import { reserveNextAttempt } from '../src/main/services/teamCore'
import { teamFixtureRun, teamFixtureTask, TEAM_FIXTURE_TIME as now } from '../src/main/services/teamTestFixtures'
import { teamReviewManySchema, type TeamReview } from '../src/shared/team'
import { teamCheckSpec, teamNativeCheckLaunch } from '../src/main/services/teamChecks'

export async function verifyTeamDependability(evidence: string): Promise<number> {
  let assertions = 0
  const check = (fn: () => void) => { fn(); assertions++ }
  const root = path.join(evidence, 'dependability-source'); fs.mkdirSync(root)
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true }).trim()
  git('init', '-q', '-b', 'main')
  fs.writeFileSync(path.join(root, 'first.cjs'), 'exports.value=0;\n'); fs.writeFileSync(path.join(root, 'second.cjs'), 'exports.value=0;\n')
  fs.writeFileSync(path.join(root, '.gitignore'), 'out/\nunknown.ignored\n')
  fs.writeFileSync(path.join(root, 'acceptance.test.cjs'), "const{test}=require('node:test');const a=require('node:assert/strict');test('independent acceptance',()=>{a.equal(require('./first.cjs').value,1);a.equal(require('./second.cjs').value,2)});\n")
  git('add', '.'); git('-c', 'user.name=Chorus Test', '-c', 'user.email=test@localhost', 'commit', '-qm', 'Frozen acceptance fixture')
  const base = git('rev-parse', 'HEAD'), owner = new StorageService(path.join(evidence, 'dependability.db')), teams = owner.createTeamStorage()
  const { project } = owner.getOrCreateProject(root), manager = new GitWorktreeManager(owner)
  const initial = { ...teamFixtureRun(), projectId: project.id, status: 'preparing' as const, integrationWorktreeId: null, integrationHead: null, baseSha: null }
  initial.config.publicationPolicy = 'auto-clean'; initial.config.verificationProfile = 'node-test'
  const runId = initial.id
  const op = (operation: string) => ({ runId, generation: 1, operation, actor: 'system' as const, eventId: randomUUID(), now })
  const workspace = new TeamWorkspaceService({ storage: owner, teams, worktrees: manager, assertAuthorized() {}, authorizeLead() {}, withLeadWriteLease: async (_run, work) => work(), writersStopped: async () => true, leadStopped: async () => true, stopLead: async () => true })
  try {
    teams.createRun(initial, 'dependability', { config: initial.config }, randomUUID())
    const prepared = await workspace.prepareRun(initial, new AbortController().signal)
    teams.command(op('fixture-active'), tx => { const current = tx.snapshot().run; tx.updateRun(current.version, { ...current, status: 'active', baseSha: base, integrationHead: base, version: current.version + 1 }); return { acknowledgment: {}, event: {} } })
    const actor = { role: 'lead' as const, runId, generation: 1, epoch: 'fixture' }
    const artifactIds = [] as Array<{ taskId: string; attemptId: string; sha: string; integrationId?: string; resultSha?: string }>
    for (const [i, file] of ['first.cjs', 'second.cjs'].entries()) {
      const task = teamFixtureTask(10 + i); task.command.paths = [file]; task.command.brief = 'Self-contained fixture'; task.command.references = ['acceptance.test.cjs']
      await workspace.preflight(teams.getRun(runId), task.command)
      teams.command(op('fixture-task'), tx => { tx.writeTask(task); return { acknowledgment: {}, event: {} } })
      const reservation = reserveNextAttempt(teams.getRun(runId), teams.tasks(runId), teams.attempts(runId), randomUUID(), now)!
      teams.command(op('fixture-reserve'), tx => { tx.writeAttempt(reservation.attempt); tx.writeTask(reservation.task, task.version); return { acknowledgment: {}, event: {} } })
      const isolated = await workspace.prepareAttempt(teams.getRun(runId), reservation.attempt, new AbortController().signal)
      fs.writeFileSync(path.join(isolated.cwd, file), `exports.value=${i + 1};\n`)
      teams.command(op('fixture-success'), tx => { const attempt = tx.snapshot().attempts.find(a => a.id === reservation.attempt.id)!; tx.writeAttempt({ ...attempt, status: 'succeeded', cessation: 'confirmed', version: attempt.version + 1 }, attempt.version); const currentTask = tx.snapshot().tasks.find(t => t.id === task.id)!; tx.writeTask({ ...currentTask, status: 'awaiting-review', version: currentTask.version + 1 }, currentTask.version); return { acknowledgment: {}, event: {} } })
      if (i === 0) {
        fs.writeFileSync(path.join(isolated.cwd, 'second.cjs'), 'exports.value=999;\n')
        await assert.rejects(workspace.validateResult(teams.getRun(runId), task, teams.attempts(runId).find(a => a.id === reservation.attempt.id)!), /outside its declared ownership/); assertions++
        check(() => assert.equal(teams.captureReservation(runId, reservation.attempt.id), null))
        check(() => assert.equal(teams.attempts(runId).find(a => a.id === reservation.attempt.id)!.artifact, null))
        fs.writeFileSync(path.join(isolated.cwd, 'second.cjs'), 'exports.value=0;\n')
      }
      await workspace.validateResult(teams.getRun(runId), teams.tasks(runId).find(t => t.id === task.id)!, teams.attempts(runId).find(a => a.id === reservation.attempt.id)!)
      const artifact = teams.attempts(runId).find(a => a.id === reservation.attempt.id)!.artifact!
      artifactIds.push({ taskId: task.id, attemptId: reservation.attempt.id, sha: artifact.commitSha })
    }
    check(() => assert.equal(teams.attempts(runId).length, 2))
    for (const item of artifactIds) {
      const review: TeamReview = { clientRequestId: randomUUID(), taskId: item.taskId, attemptId: item.attemptId, phase: 'artifact', reviewedSha: item.sha, decision: 'accept', explanation: 'Inspected immutable fixture content.', tests: [] }
      await workspace.review(teams.getRun(runId), review, actor)
      const integrate = { action: 'prepare' as const, clientRequestId: randomUUID(), taskId: item.taskId, attemptId: item.attemptId, reviewedHead: item.sha, expectedIntegrationHead: teams.getRun(runId).integrationHead! }
      const ack = await workspace.integrate(teams.getRun(runId), integrate, actor); await workspace.settle()
      const integration = teams.integrations(runId).find(i => i.id === ack.integrationId)!
      await workspace.review(teams.getRun(runId), { ...review, clientRequestId: randomUUID(), phase: 'prepared', integrationId: integration.id, reviewedSha: integration.resultSha! }, actor)
      await workspace.integrate(teams.getRun(runId), { ...integrate, action: 'apply', clientRequestId: randomUUID(), integrationId: integration.id }, actor); await workspace.settle()
      check(() => assert.equal(teams.integrations(runId).find(i => i.id === integration.id)!.status, 'applied'))
      item.integrationId = integration.id; item.resultSha = integration.resultSha!
    }
    const final = teams.getRun(runId).integrationHead!
    const test = await workspace.checks.run(teams.getRun(runId), owner.getWorktreeById(prepared.worktreeId)!.path, final, 'node-test')
    check(() => assert.equal(test.outcome, 'passed'))
    check(() => assert(test.verificationId))
    await assert.rejects(workspace.review(teams.getRun(runId), { clientRequestId: randomUUID(), taskId: artifactIds[0].taskId, attemptId: artifactIds[0].attemptId, phase: 'integrated', integrationId: artifactIds[0].integrationId!, reviewedSha: final, originalResultSha: artifactIds[0].resultSha!, verifiedHead: final, decision: 'accept', explanation: 'Forged report', tests: [{ ...test, output: 'Forged passing output' }] }, actor), /exact evidence/); assertions++
    const compact = teamReviewManySchema.parse({ clientRequestId: 'compact-final-reviews', reviews: artifactIds.map(item => ({ clientRequestId: `review-${item.taskId}`, taskId: item.taskId, attemptId: item.attemptId, phase: 'integrated', integrationId: item.integrationId!, reviewedSha: final, originalResultSha: item.resultSha!, verifiedHead: final, decision: 'accept', explanation: 'Independent frozen acceptance passed at combined HEAD.', verificationIds: [test.verificationId!] })) })
    await assert.rejects(workspace.reviewMany(teams.getRun(runId), { ...compact, clientRequestId: 'invalid-batch', reviews: [compact.reviews[0], { ...compact.reviews[1], originalResultSha: base }] }, actor), /original|result|identity/i); assertions++
    check(() => assert(teams.tasks(runId).every(t => t.status !== 'completed')))
    const reviewed = await workspace.reviewMany(teams.getRun(runId), compact, actor)
    check(() => assert.deepEqual(teams.acknowledgment(runId, 'review-many', compact.clientRequestId, compact), reviewed))
    check(() => assert(teams.tasks(runId).every(t => t.status === 'completed')))
    check(() => assert.equal(teams.latestReview(runId, artifactIds[0].taskId, artifactIds[0].attemptId, 'integrated')!.review.tests[0].output, test.output))
    const replay = await workspace.reviewMany(teams.getRun(runId), compact, actor)
    check(() => assert.deepEqual(replay, reviewed))
    const references = teams.events(runId).filter(e => e.operation === 'attempt-references')
    check(() => assert.equal(references.length, 2))
    check(() => assert.equal((references[0].payload.references as any[])[0].objectSha, git('rev-parse', `${base}:acceptance.test.cjs`)))
    const invalid = { ...teamFixtureTask(30).command, references: ['not-committed.pdf'] }
    await assert.rejects(workspace.preflight(teams.getRun(runId), invalid), /unavailable/); assertions++
    check(() => assert.equal(teams.attempts(runId).length, 2))
    const before = teams.actionableCursor(runId)
    teams.command({ ...op('helper-activity'), entityId: artifactIds[0].taskId }, () => ({ acknowledgment: {}, event: { text: 'noisy output' } }))
    check(() => assert.equal(teams.actionableCursor(runId), before))
    const sourceDirty = path.join(root, 'user.txt'); fs.writeFileSync(sourceDirty, 'Keep me\n')
    await workspace.finish(teams.getRun(runId), { clientRequestId: 'finish-dirty', expectedSha: final }); await workspace.settle()
    check(() => assert.equal(teams.getRun(runId).finish!.status, 'blocked')); check(() => assert.equal(git('rev-parse', 'HEAD'), base)); check(() => assert.equal(fs.readFileSync(sourceDirty, 'utf8'), 'Keep me\n'))
    fs.unlinkSync(sourceDirty) // Test-owned fixture file only.
    const helper = owner.getWorktreeById(teams.attempts(runId)[0].worktreeId!)!
    fs.writeFileSync(path.join(helper.path, 'unknown.ignored'), 'Preserve unknown ignored files\n')
    await workspace.finish(teams.getRun(runId), { clientRequestId: 'finish-clean', expectedSha: final }); await workspace.settle()
    const done = teams.getRun(runId)
    check(() => assert.equal(done.status, 'completed')); check(() => assert.equal(git('rev-parse', 'HEAD'), final))
    check(() => assert.deepEqual(done.finish!.retainedWorktreeIds, [helper.id])); check(() => assert.equal(done.finish!.removedWorktreeIds.length, 4))
    check(() => assert.equal(fs.readFileSync(path.join(helper.path, 'unknown.ignored'), 'utf8'), 'Preserve unknown ignored files\n'))
    check(() => assert.equal(git('show', `refs/chorus/teams/${runId}/final/${final}:first.cjs`), 'exports.value=1;'))
    fs.unlinkSync(path.join(helper.path, 'unknown.ignored'))
    await workspace.completion.retryCleanup(runId)
    check(() => assert.equal(teams.getRun(runId).finish!.retainedWorktreeIds.length, 0)); check(() => assert.equal(owner.getWorktreesForProject(project.id).length, 0))
    // A removed integration workspace is an archive, not a corrupt restore target.
    check(() => assert(!fs.existsSync(owner.getWorktreeById(prepared.worktreeId)?.path ?? path.join(root, 'never-created'))))
    return assertions + await verifyDependencyRefresh(evidence) + await verifyCompactSuite(evidence)
  } finally { await workspace.settle(); owner.close() }
}

export async function verifyDependencyRefresh(evidence: string): Promise<number> {
  let assertions = 0
  const check = (fn: () => void) => { fn(); assertions++ }
  const root = path.join(evidence, 'dependency-source'); fs.mkdirSync(root)
  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true }).trim()
  const commit = (cwd: string) => { git(cwd, 'add', '.'); git(cwd, '-c', 'user.name=Chorus Test', '-c', 'user.email=test@localhost', 'commit', '-qm', 'Dependency fixture'); return git(cwd, 'rev-parse', 'HEAD') }
  const npm = (cwd: string, ...args: string[]) => { const launch = teamNativeCheckLaunch(cwd, teamCheckSpec('npm-project', 'install')); execFileSync(launch.executable, [launch.args[0], ...args], { cwd, windowsHide: true, stdio: 'ignore' }) }
  git(root, 'init', '-q', '-b', 'main'); git(root, 'config', 'core.autocrlf', 'false')
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\nout/\n')
  for (const version of [1, 2]) {
    const directory = path.join(root, `lib-${version}`); fs.mkdirSync(directory)
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: 'fixture-values', version: `${version}.0.0`, main: 'index.cjs' }))
    fs.writeFileSync(path.join(directory, 'index.cjs'), `exports.value=${version};\n`)
  }
  const pkg = { name: 'dependency-fixture', version: '1.0.0', expected: 1, scripts: { test: 'node check.cjs', typecheck: 'node daemon.cjs', build: 'node --check check.cjs' }, dependencies: { 'fixture-values': 'file:./lib-1' } }
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg))
  fs.writeFileSync(path.join(root, 'check.cjs'), "require('node:assert/strict').equal(require('fixture-values').value,require('./package.json').expected);\n")
  fs.writeFileSync(path.join(root, 'daemon.cjs'), "const fs=require('node:fs');fs.mkdirSync('out',{recursive:true});const child=require('node:child_process').spawn(process.execPath,['-e',\"setInterval(()=>require('node:fs').appendFileSync('out/writer.txt','tick'),100)\"],{detached:true,stdio:'ignore'});child.unref();setTimeout(()=>{},5000);\n")
  npm(root, 'install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'); const base = commit(root)
  const owner = new StorageService(path.join(evidence, 'dependency.db')), teams = owner.createTeamStorage()
  const { project } = owner.getOrCreateProject(root), manager = new GitWorktreeManager(owner)
  const initial = { ...teamFixtureRun(), projectId: project.id, status: 'preparing' as const, integrationWorktreeId: null, integrationHead: null, baseSha: null }
  initial.config.publicationPolicy = 'auto-clean'; initial.config.verificationProfile = 'npm-project'
  const workspace = new TeamWorkspaceService({ storage: owner, teams, worktrees: manager, assertAuthorized() {}, authorizeLead() {}, withLeadWriteLease: async (_run, work) => work(), writersStopped: async () => true, leadStopped: async () => true, stopLead: async () => true })
  const updateHead = (sha: string) => teams.command({ runId: initial.id, generation: 1, operation: 'fixture-head', actor: 'system', eventId: randomUUID(), now }, tx => { const current = tx.snapshot().run; tx.updateRun(current.version, { ...current, status: 'active', baseSha: base, integrationHead: sha, version: current.version + 1 }); return { acknowledgment: {}, event: {} } })
  const installs = () => {
    let after = 0, count = 0
    for (;;) { const page = teams.events(initial.id, after); if (!page.length) return count; count += page.filter(e => e.operation === 'verification-started' && e.payload.command === 'npm ci').length; after = page.at(-1)!.sequence }
  }
  try {
    teams.createRun(initial, 'dependency-fixture', { config: initial.config }, randomUUID())
    const prepared = await workspace.prepareRun(initial, new AbortController().signal), cwd = owner.getWorktreeById(prepared.worktreeId)!.path
    updateHead(base)
    check(() => assert.equal(installs(), 1))
    check(() => assert.equal(fs.readFileSync(path.join(cwd, 'node_modules/fixture-values/index.cjs'), 'utf8'), 'exports.value=1;\n'))
    const baseline = await workspace.checks.run(teams.getRun(initial.id), cwd, base, 'test')
    check(() => assert.equal(baseline.outcome, 'passed')); check(() => assert.equal(installs(), 1))
    pkg.expected = 2; pkg.dependencies['fixture-values'] = 'file:./lib-2'
    fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify(pkg)); npm(cwd, 'install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund')
    let head = commit(cwd); updateHead(head)
    const changed = await workspace.checks.run(teams.getRun(initial.id), cwd, head, 'test')
    check(() => assert.equal(changed.outcome, 'passed')); check(() => assert.equal(installs(), 2))
    check(() => assert.equal(fs.readFileSync(path.join(cwd, 'node_modules/fixture-values/index.cjs'), 'utf8'), 'exports.value=2;\n'))
    fs.appendFileSync(path.join(cwd, 'check.cjs'), '// Code-only changes reuse the installed dependency identity.\n'); head = commit(cwd); updateHead(head)
    const codeOnly = await workspace.checks.run(teams.getRun(initial.id), cwd, head, 'test')
    check(() => assert.equal(codeOnly.outcome, 'passed')); check(() => assert.equal(installs(), 2))
    fs.writeFileSync(path.join(cwd, '.npmrc'), 'fund=false\n'); head = commit(cwd); updateHead(head)
    const configChanged = await workspace.checks.run(teams.getRun(initial.id), cwd, head, 'test')
    check(() => assert.equal(configChanged.outcome, 'passed')); check(() => assert.equal(installs(), 3))
    const goodPackage = fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')
    fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ ...pkg, scripts: { ...pkg.scripts, postinstall: 'node -e "process.exit(1)"' } })); head = commit(cwd); updateHead(head)
    const failed = await workspace.checks.run(teams.getRun(initial.id), cwd, head, 'install', randomUUID(), undefined, true)
    check(() => assert.equal(failed.outcome, 'failed'))
    fs.writeFileSync(path.join(cwd, 'package.json'), goodPackage); head = commit(cwd); updateHead(head)
    const restored = await workspace.checks.run(teams.getRun(initial.id), cwd, head, 'test')
    check(() => assert.equal(restored.outcome, 'passed')); check(() => assert.equal(installs(), 5))
    const staleId = randomUUID()
    await assert.rejects(workspace.checks.run(teams.getRun(initial.id), cwd, base, 'test', staleId), /exact clean/); assertions++
    check(() => assert(teams.verificationEvents(initial.id, staleId).some(e => e.operation === 'verification-failed')))
    check(() => assert(!teams.verificationEvents(initial.id, staleId).some(e => e.operation === 'verification-started')))
    const daemon = await workspace.checks.run(teams.getRun(initial.id), cwd, head, 'typecheck')
    check(() => assert.equal(daemon.outcome, 'passed'))
    check(() => assert.equal(teams.unretiredVerificationStarts(initial.id).length, 0))
    const written = fs.readFileSync(path.join(cwd, 'out/writer.txt'), 'utf8')
    check(() => assert(written.length > 0))
    await new Promise(resolve => setTimeout(resolve, 500))
    check(() => assert.equal(fs.readFileSync(path.join(cwd, 'out/writer.txt'), 'utf8'), written))
    const external = path.join(evidence, 'external-link-target'); fs.mkdirSync(external)
    fs.writeFileSync(path.join(external, 'keep.txt'), 'Preserve external junction targets.\n')
    fs.symlinkSync(external, path.join(cwd, 'node_modules/external-link'), 'junction')
    check(() => assert.equal(fs.readFileSync(path.join(cwd, 'lib-2/index.cjs'), 'utf8'), 'exports.value=2;\n'))
    await workspace.finish(teams.getRun(initial.id), { clientRequestId: 'dependency-finish', expectedSha: head }); await workspace.settle()
    check(() => assert.equal(teams.getRun(initial.id).finish?.status, 'cleaned')); check(() => assert.equal(owner.getWorktreesForProject(project.id).length, 0))
    check(() => assert.equal(fs.readFileSync(path.join(root, 'lib-2/index.cjs'), 'utf8'), 'exports.value=2;\n'))
    check(() => assert.equal(fs.readFileSync(path.join(external, 'keep.txt'), 'utf8'), 'Preserve external junction targets.\n'))
    const unknownId = randomUUID()
    teams.command({ runId: initial.id, generation: 1, operation: 'verification-started', actor: 'system', eventId: randomUUID(), now }, () => ({ acknowledgment: {}, event: { verificationId: unknownId, command: 'npm test', cwd, expectedSha: head } }))
    check(() => assert.throws(() => workspace.checks.assertQuiescent(initial.id), /prior project check/))
    check(() => assert.equal(teams.unretiredVerificationStarts(initial.id).length, 1))
    return assertions
  } finally { await workspace.settle(); owner.close() }
}

async function verifyCompactSuite(evidence: string): Promise<number> {
  let assertions = 0
  const check = (fn: () => void) => { fn(); assertions++ }
  const root = path.join(evidence, 'compact-suite'); fs.mkdirSync(root)
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true }).trim()
  git('init', '-q', '-b', 'main'); git('config', 'core.autocrlf', 'false')
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'compact-suite', version: '1.0.0', scripts: { test: 'node --test', typecheck: 'node --check acceptance.test.cjs', build: 'node --check acceptance.test.cjs' } }))
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ name: 'compact-suite', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'compact-suite', version: '1.0.0' } } }))
  fs.writeFileSync(path.join(root, 'acceptance.test.cjs'), "require('node:test').test('independent suite',()=>require('node:assert/strict').equal(2+2,4));\n")
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\nout/\n')
  git('add', '.'); git('-c', 'user.name=Chorus Test', '-c', 'user.email=test@localhost', 'commit', '-qm', 'Frozen suite')
  const owner = new StorageService(path.join(evidence, 'compact-suite.db')), teams = owner.createTeamStorage(), { project } = owner.getOrCreateProject(root)
  const run = { ...teamFixtureRun(), projectId: project.id, status: 'preparing' as const, integrationWorktreeId: null, integrationHead: null, baseSha: null, config: { ...teamFixtureRun().config, verificationProfile: 'npm-project' as const, publicationPolicy: 'auto-clean' as const } }
  const workspace = new TeamWorkspaceService({ storage: owner, teams, worktrees: new GitWorktreeManager(owner), assertAuthorized() {}, authorizeLead() {}, writersStopped: async () => true, leadStopped: async () => true, stopLead: async () => true })
  try {
    teams.createRun(run, 'compact-suite', {}, randomUUID())
    const prepared = await workspace.prepareRun(run, new AbortController().signal)
    teams.command({ runId: run.id, generation: 1, operation: 'fixture-active', actor: 'system', eventId: randomUUID(), now }, tx => { const current = tx.snapshot().run; tx.updateRun(current.version, { ...current, status: 'active', baseSha: prepared.baseSha, integrationHead: prepared.head, version: current.version + 1 }); return { acknowledgment: {}, event: {} } })
    const command = { clientRequestId: 'suite', expectedSha: prepared.head, command: 'suite' as const }
    const ack = await workspace.verify(teams.getRun(run.id), command)
    check(() => assert.equal((ack.verificationIds as string[]).length, 3))
    check(() => assert.deepEqual(teams.acknowledgment(run.id, 'verify', 'suite', command), ack))
    await workspace.settle()
    check(() => assert((ack.verificationIds as string[]).every(id => workspace.checks.evidence(run.id, id)?.outcome === 'passed')))
    const installs = () => teams.verificationEvents(run.id).filter(e => e.operation === 'verification-started' && e.payload.command === 'npm ci').length
    check(() => assert.equal(installs(), 1, 'A dependency-free npm ci need not create node_modules; reuse the successful fingerprint.'))
    const before = teams.verificationEvents(run.id).filter(e => e.operation === 'verification-started').length
    const again = await workspace.verify(teams.getRun(run.id), command); await workspace.settle()
    check(() => assert.deepEqual(again, ack))
    check(() => assert.equal(teams.verificationEvents(run.id).filter(e => e.operation === 'verification-started').length, before))
    await workspace.finish(teams.getRun(run.id), { clientRequestId: 'finish', expectedSha: prepared.head }); await workspace.settle()
    check(() => assert.equal(teams.getRun(run.id).finish!.status, 'cleaned'))
    check(() => assert.equal(teams.verificationEvents(run.id).filter(e => e.operation === 'verification-started').length, before, 'Finish reuses the full exact-commit suite.'))
  } finally { await workspace.settle(); owner.close() }
  return assertions
}
