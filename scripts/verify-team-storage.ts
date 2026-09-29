import { app } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { StorageService } from '../src/main/services/storage'
import { hashTeamPayload } from '../src/main/services/teamStorage'
import { reserveNextAttempt } from '../src/main/services/teamCore'
import { teamFixtureRun, teamFixtureTask, teamFixtureIntegration, teamFixtureId as id, TEAM_FIXTURE_TIME as now } from '../src/main/services/teamTestFixtures'
import { verifyTeamRuntime } from './verify-team-runtime'
import { verifyTeamWorkspace } from './verify-team-workspace'
import { verifyTeamIntegration } from './verify-team-integration'
import { verifyTeamMembers } from './verify-team-members'

const evidence = process.env.CHORUS_TEAM_STORAGE_EVIDENCE!
app.setPath('userData', path.join(evidence, 'electron-profile'))
app.whenReady().then(async () => {
  let assertions = 0
  const check = (fn: () => void) => { fn(); assertions++ }
  const dbPath = path.join(evidence, 'fixture.db')
  let storage = new StorageService(dbPath)
  let teams = storage.createTeamStorage()
  const run = teamFixtureRun(), task = teamFixtureTask()
  const operation = (n: number, name = 'fixture', request?: string) => ({ runId: run.id, operation: name, clientRequestId: request, payload: { value: 1 }, actor: 'user' as const, generation: 1, eventId: id(n), now })
  const ack = teams.createRun(run, 'launch-one', { config: run.config }, id(100))
  check(() => assert.deepEqual(ack, { runId: run.id }))
  check(() => assert.deepEqual(teams.createRun({ ...run, id: id(99) }, 'launch-one', { config: run.config }, id(101)), ack))
  check(() => assert.throws(() => teams.createRun(run, 'launch-one', { different: true }, id(102)), /different content/))
  // Saved roster identities can be reused in another run; member identity is scoped by run.
  teams.createRun({ ...run, id: id(99) }, 'launch-two', { config: run.config }, id(103))
  check(() => assert.equal(teams.members(id(99)).length, 2))
  let effects = 0
  const submit = () => teams.command(operation(104, 'delegate', 'request-one'), tx => { effects++; tx.writeTask(task); return { acknowledgment: { taskId: task.id }, event: { state: 'queued' } } })
  const original = submit(); check(() => assert.deepEqual(submit(), original)); check(() => assert.equal(effects, 1))
  check(() => assert.throws(() => teams.command({ ...operation(105, 'delegate', 'request-one'), payload: { value: 2 } }, () => ({ acknowledgment: {}, event: {} })), /different content/))
  check(() => assert.equal(hashTeamPayload({ b: 1, a: 'exact\n' }), hashTeamPayload({ a: 'exact\n', b: 1 })))
  const beforeRollback = teams.snapshot(run.id)
  check(() => assert.throws(() => teams.command(operation(106, 'rollback', 'rollback'), tx => { tx.writeTask(teamFixtureTask(11)); throw Error('Injected before acknowledgment') }), /Injected/))
  check(() => assert.equal(teams.tasks(run.id).length, beforeRollback.tasks.length))
  check(() => assert.equal(teams.snapshot(run.id).lastSequence, beforeRollback.lastSequence))
  const reservation = reserveNextAttempt(run, [task], [], id(20), now)!
  teams.command(operation(107, 'reserve'), tx => { tx.writeAttempt(reservation.attempt); tx.writeTask(reservation.task, task.version); return { acknowledgment: { attemptId: id(20) }, event: { number: 1 } } })
  check(() => assert.equal(teams.attempts(run.id).length, 1))
  check(() => assert.equal(teams.tasks(run.id)[0].attemptCount, 1))
  const workspaceOp = { ...operation(130, 'workspace', 'workspace-one'), clientRequestId: 'workspace-one' }
  const workspaceEntity = { kind: 'attempt' as const, id: reservation.attempt.id, worktreeId: id(82), expectedVersion: reservation.attempt.version }
  const workspaceAck = teams.reserveWorkspace(workspaceOp, workspaceEntity)
  check(() => assert.equal(teams.attempts(run.id)[0].worktreeId, id(82)))
  check(() => assert.deepEqual(teams.reserveWorkspace(workspaceOp, workspaceEntity), workspaceAck))
  check(() => assert.equal(teams.unfinishedOperations(run.id).length, 1))
  check(() => assert.throws(() => teams.completeWorkspace({ ...workspaceOp, eventId: id(131) }, { worktreeId: id(83), head: 'a'.repeat(40) }), /durable ownership/))
  teams.completeWorkspace({ ...workspaceOp, eventId: id(132) }, { worktreeId: id(82), head: 'a'.repeat(40) })
  check(() => assert.equal(teams.unfinishedOperations(run.id).length, 0))
  check(() => assert.throws(() => teams.command(operation(108, 'stale'), tx => { tx.writeTask({ ...reservation.task, version: 2 }, 1); return { acknowledgment: {}, event: {} } }), /changed/))
  check(() => assert.throws(() => teams.command(operation(109, 'duplicate-attempt'), tx => { tx.writeAttempt({ ...reservation.attempt, id: id(21) }); return { acknowledgment: {}, event: {} } }), /UNIQUE/))
  check(() => assert.throws(() => teams.command(operation(110, 'foreign-task'), tx => { tx.writeAttempt({ ...reservation.attempt, id: id(22), taskId: id(999) }); return { acknowledgment: {}, event: {} } }), /FOREIGN KEY/))
  const integration = teamFixtureIntegration()
  teams.command(operation(111, 'integration'), tx => { tx.writeIntegration({ ...integration, status: 'applying' }); return { acknowledgment: { integrationId: integration.id }, event: {} } })
  check(() => assert.throws(() => teams.command(operation(112, 'second-applying'), tx => { tx.writeIntegration({ ...integration, id: id(44), preparationId: id(45), status: 'applying' }); return { acknowledgment: {}, event: {} } }), /UNIQUE/))
  check(() => assert.equal(teams.integrations(run.id).length, 1))
  teams.savePreset(id(60), 'Reusable', run.config, now); teams.deletePreset(id(60))
  teams.savePresetVersioned(id(60), null, 'Versioned', run.config, now)
  check(() => assert.equal(teams.listPresets()[0].version, 1))
  teams.savePresetVersioned(id(60), 1, 'Updated', run.config, now)
  check(() => assert.equal(teams.listPresets()[0].version, 2))
  check(() => assert.throws(() => teams.savePresetVersioned(id(60), 1, 'Stale', run.config, now), /changed/))
  check(() => assert.throws(() => teams.deletePresetVersioned(id(60), 1), /changed/))
  teams.deletePresetVersioned(id(60), 2)
  check(() => assert.equal(teams.getRun(run.id).id, run.id))
  check(() => assert.deepEqual(teams.events(run.id).map(e => e.sequence), [1, 2, 3, 4, 5, 6]))
  const attempt = teams.attempts(run.id)[0]
  teams.command(operation(120, 'fixture-stopped'), tx => { tx.writeAttempt({ ...attempt, status: 'succeeded', cessation: 'confirmed', worktreeId: id(82), endedAt: now, result: { summary: 'Fixture complete', isError: false, tests: [] }, version: attempt.version + 1 }, attempt.version); return { acknowledgment: {}, event: {} } })
  const capture = { runId: run.id, attemptId: attempt.id, captureId: id(121), baseSha: 'a'.repeat(40), ref: `refs/chorus/teams/${run.id}/artifacts/${attempt.id}`, authorName: 'Chorus' as const, authorEmail: 'chorus@localhost' as const, at: now }
  const stoppedAttempt = teams.attempts(run.id)[0]
  teams.reserveCapture(capture, stoppedAttempt.version, id(122))
  check(() => assert.equal(teams.unfinishedOperations(run.id).length, 1))
  const artifact = { id: attempt.id, captureId: capture.captureId, baseSha: capture.baseSha, finalHelperHead: capture.baseSha, treeSha: 'd'.repeat(40), commitSha: 'e'.repeat(40), ref: capture.ref, manifest: ['sum.cjs'], capturedAt: now }
  check(() => assert.throws(() => teams.publishArtifact(run.id, artifact, stoppedAttempt.version, id(123), now), /journaled/))
  teams.recordCaptureObjects(capture, artifact.treeSha, artifact.commitSha, id(124), now)
  const published = teams.publishArtifact(run.id, artifact, stoppedAttempt.version, id(125), now)
  check(() => assert.deepEqual(teams.publishArtifact(run.id, artifact, stoppedAttempt.version, id(126), now), published))
  check(() => assert.equal(teams.unfinishedOperations(run.id).length, 0))
  check(() => assert.equal(teams.attempts(run.id)[0].artifact?.id, attempt.id))
  check(() => assert.throws(() => teams.reserveCapture({ ...capture, captureId: id(127) }, stoppedAttempt.version, id(128)), /different content/))
  check(() => assert.throws(() => teams.command(operation(129, 'mutate-artifact'), tx => { const current = tx.snapshot().attempts[0]; tx.writeAttempt({ ...current, artifact: { ...artifact, commitSha: 'f'.repeat(40) }, version: current.version + 1 }, current.version); return { acknowledgment: {}, event: {} } }), /cannot change/))
  storage.close()
  storage = new StorageService(dbPath); teams = storage.createTeamStorage()
  check(() => assert.equal(teams.tasks(run.id)[0].currentAttemptId, id(20)))
  storage.close()
  // Native SQL is used only by this disposable verifier for corruption/DDL fault injection.
  let raw = new Database(dbPath)
  check(() => assert.equal(raw.pragma('foreign_keys', { simple: true }), 1))
  check(() => assert.equal((raw.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number }).v, 27))
  check(() => assert.throws(() => raw.prepare('DELETE FROM team_runs WHERE id=?').run(run.id), /FOREIGN KEY/))
  const originalJson = (raw.prepare('SELECT record_json AS value FROM team_tasks WHERE id=?').get(task.id) as { value: string }).value
  raw.prepare('UPDATE team_tasks SET record_json=? WHERE id=?').run('{corrupt', task.id); raw.close()
  storage = new StorageService(dbPath); teams = storage.createTeamStorage()
  check(() => assert.throws(() => teams.snapshot(run.id), /Stored team JSON/))
  storage.close(); raw = new Database(dbPath)
  raw.prepare('UPDATE team_tasks SET record_json=? WHERE id=?').run(originalJson, task.id); raw.close()

  // Derive a v24 fixture from an empty migrated database, retaining all pre-v25 schema.
  const upgradePath = path.join(evidence, 'upgrade.db')
  const upgraded = new StorageService(upgradePath); const { project } = upgraded.getOrCreateProject(path.join(evidence, 'legacy-project')); upgraded.close()
  raw = new Database(upgradePath)
  raw.pragma('foreign_keys=OFF')
  for (const table of ['team_member_profiles', 'team_integrations', 'team_events', 'team_attempts', 'team_tasks', 'team_members', 'team_runs', 'team_presets']) raw.exec(`DROP TABLE ${table}`)
  raw.prepare('DELETE FROM schema_migrations WHERE version>=25').run(); raw.close()
  storage = new StorageService(upgradePath)
  check(() => assert.equal(storage.getProjectById(project.id)?.id, project.id))
  storage.close(); raw = new Database(upgradePath)
  check(() => assert.equal((raw.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }).n, 27))
  check(() => assert.equal((raw.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name LIKE 'team_%'").get() as { n: number }).n, 8))
  raw.close()
  const v25Path = path.join(evidence, 'upgrade-v25.db')
  storage = new StorageService(v25Path); storage.createTeamStorage().savePreset(id(60), 'Retained v25 preset', run.config, now); storage.close()
  raw = new Database(v25Path); raw.exec('ALTER TABLE team_presets DROP COLUMN version'); raw.exec('DROP TABLE team_member_profiles'); raw.prepare('DELETE FROM schema_migrations WHERE version>=26').run(); raw.close()
  storage = new StorageService(v25Path)
  check(() => assert.equal(storage.createTeamStorage().listPresets()[0].version, 1))
  check(() => assert.deepEqual(storage.createTeamStorage().listPresets()[0].config, run.config))
  storage.close()
  const runtimeAssertions = await verifyTeamRuntime(evidence)
  const workspaceAssertions = await verifyTeamWorkspace(evidence)
  const integrationAssertions = await verifyTeamIntegration(evidence)
  const memberAssertions = await verifyTeamMembers(evidence)
  const report = { passed: true, assertions, runtimeAssertions, workspaceAssertions, integrationAssertions, memberAssertions, electron: process.versions.electron, node: process.versions.node, sqlite: process.versions.sqlite, evidence, at: new Date().toISOString() }
  fs.writeFileSync(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2)); app.exit(0)
}).catch(error => { fs.writeFileSync(path.join(evidence, 'failure.json'), JSON.stringify({ message: error.message, stack: error.stack })); app.exit(1) })
