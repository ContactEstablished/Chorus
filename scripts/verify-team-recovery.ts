import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import Database from 'better-sqlite3'
import { StorageService } from '../src/main/services/storage'
import { SessionManager } from '../src/main/services/sessionManager'
import { GitWorktreeManager } from '../src/main/services/worktrees'
import { TeamRuntime } from '../src/main/services/teamRuntime'
import { TeamWorkspaceService } from '../src/main/services/teamWorkspaceService'
import { teamFixtureRun, teamFixtureTask, teamFixtureIntegration } from '../src/main/services/teamTestFixtures'
import { reserveNextAttempt, type TeamLease } from '../src/main/services/teamCore'
import { teamCreateArtifactObjects, teamPublishArtifactRef, teamPromoteIntegration, teamResolveCommit, teamListPrivateRefs, teamPrepareIntegrationObjects, teamPublishIntegrationRef, teamIntegrationRef } from '../src/main/services/git'
import { windowsHelperPlatform } from '../src/main/services/helperProcess'
import type { CredentialVault } from '../src/main/services/vault'
import type { TeamRun, TeamCaptureReservation } from '../src/shared/team'
const evidence = process.env.CHORUS_TEAM_RECOVERY_EVIDENCE!, phase = process.env.CHORUS_TEAM_RECOVERY_PHASE!, mode = process.env.CHORUS_TEAM_RECOVERY_MODE!
app.setPath('userData', path.join(evidence, 'profile'))
const database = path.join(evidence, 'fixture.db'), source = path.join(evidence, 'source'), now = () => new Date().toISOString()
const write = (name: string, value: unknown) => fs.writeFileSync(path.join(evidence, name), JSON.stringify(value, null, 2))
app.whenReady().then(async () => {
  if (mode === 'seed') {
    fs.mkdirSync(source)
    const git = (...args: string[]) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8', windowsHide: true }).trim()
    git('init', '-q'); fs.writeFileSync(path.join(source, 'value.txt'), 'base\n'); git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Fixture')
    const storage = new StorageService(database), teams = storage.createTeamStorage(), { project } = storage.getOrCreateProject(source)
    let run: TeamRun = { ...teamFixtureRun(), projectId: project.id, status: 'preparing', baseSha: null, integrationHead: null, integrationWorktreeId: null }
    if (phase.startsWith('credential-')) {
      const providerId = randomUUID(), credentialId = randomUUID()
      storage.createProviderConfig({ id: providerId, name: 'Fixture provider', adapterType: 'opencode', authMode: 'api_key', baseUrl: 'https://openrouter.ai/api/v1', createdAt: now() })
      storage.createCredentialProfile({ id: credentialId, providerId, label: 'Fixture unavailable ciphertext', encryptedBlob: Buffer.from('not-a-real-DPAPI-envelope'), fingerprintHash: 'fixture-before-rotation', createdAt: now() })
      run = { ...run, config: { ...run.config, helpers: [{ ...run.config.helpers[0], harness: 'opencode', model: 'z-ai/glm-5.3', effort: null, installedVersion: '1.18.31', authMode: 'api_key', providerId, credentialProfileId: credentialId }] } }
    }
    teams.createRun(run, 'fixture', {}, randomUUID())
    const op = (operation: string) => ({ runId: run.id, generation: 1, operation, actor: 'system' as const, eventId: randomUUID(), now: now() })
    const workspace = new TeamWorkspaceService({ storage, teams, worktrees: new GitWorktreeManager(storage), assertAuthorized() {}, authorizeLead() {}, writersStopped: async () => true, leadStopped: async () => true })
    if (phase === 'workspace-intent') {
      const baseSha = await teamResolveCommit(source, 'HEAD'), requestId = randomUUID()
      await new GitWorktreeManager(storage).createManagedWorktree({ projectId: project.id, repoRoot: source, baseSha, signal: new AbortController().signal, assertAuthorized() {}, reserve: row => teams.reserveWorkspace({ ...op('workspace-reserved'), clientRequestId: requestId }, { kind: 'run', id: run.id, worktreeId: row.id, expectedVersion: run.version }) })
    } else if (phase !== 'reserved') {
      const ready = await workspace.prepareRun(run, new AbortController().signal), current = teams.getRun(run.id)
      teams.command(op('fixture-active'), tx => { tx.updateRun(current.version, { ...current, status: 'active', baseSha: ready.baseSha, integrationHead: ready.head, version: current.version + 1 }); return { acknowledgment: {}, event: {} } })
      run = teams.getRun(run.id)
      if (phase === 'dirty') fs.writeFileSync(path.join(storage.getWorktreeById(run.integrationWorktreeId!)!.path, 'retained.txt'), 'Uncommitted lead work must survive.\n')
      if (phase === 'missing-workspace') fs.renameSync(storage.getWorktreeById(run.integrationWorktreeId!)!.path, path.join(evidence, 'retained-moved-workspace'))
      if (phase === 'lead-unready') {
        const wt = storage.getWorktreeById(run.integrationWorktreeId!)!, sessionId = randomUUID()
        storage.createSession({ id: sessionId, projectId: project.id, agent: 'claude', cwd: wt.path, status: 'running', createdAt: now(), worktreeId: wt.id })
        const node = execFileSync('where.exe', ['node.exe'], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/)[0]
        const child = spawn(node, ['-e', 'setInterval(()=>{},1000)'], { cwd: wt.path, detached: true, stdio: 'ignore', windowsHide: true }); child.unref()
        const observed = await windowsHelperPlatform.inspect(child.pid!, []); assert(observed.root)
        teams.command(op('lead-spawn-intent'), tx => { tx.updateRun(run.version, { ...run, leadSessionId: sessionId, status: 'preparing', version: run.version + 1 }); return { acknowledgment: {}, event: { sessionId } } })
        teams.command(op('lead-process'), () => ({ acknowledgment: {}, event: { sessionId, identities: observed.identities } }))
        write('processes.json', observed.identities)
      }
      if (phase.startsWith('credential-')) {
        const member = run.config.helpers[0]
        if (phase === 'credential-deleted') storage.deleteCredentialProfile(member.credentialProfileId!)
        if (phase === 'credential-rotated') storage.updateCredentialBlob(member.credentialProfileId!, Buffer.from('different-fixture-ciphertext'), 'fixture-after-rotation')
        if (phase === 'credential-route') storage.updateProviderConfig(member.providerId!, { baseUrl: 'https://changed.invalid/api/v1' })
      }
      if (!['workspace', 'corrupt', 'dirty', 'missing-workspace', 'lead-unready'].includes(phase) && !phase.startsWith('credential-')) {
        const task = teamFixtureTask(); teams.command(op('fixture-task'), tx => { tx.writeTask(task); return { acknowledgment: {}, event: {} } })
        const reserved = reserveNextAttempt(run, [task], [], randomUUID(), now())!
        teams.command(op('fixture-attempt'), tx => { tx.writeAttempt(reserved.attempt); tx.writeTask(reserved.task, task.version); return { acknowledgment: {}, event: {} } })
        if (phase !== 'attempt-reserved') {
        const helper = await workspace.prepareAttempt(run, reserved.attempt, new AbortController().signal)
        let attempt = teams.attempts(run.id)[0]
        if (phase.startsWith('helper-')) {
          const node = execFileSync('where.exe', ['node.exe'], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/)[0]
          const script = path.join(evidence, 'orphan.cjs')
          fs.writeFileSync(script, "const{spawn}=require('node:child_process');spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});setInterval(()=>{},1000)")
          const child = spawn(node, [script], { cwd: helper.cwd, detached: true, stdio: 'ignore', windowsHide: true }); child.unref()
          await new Promise(resolve => setTimeout(resolve, 2000))
          const observed = await windowsHelperPlatform.inspect(child.pid!, [])
          assert(observed.root && observed.identities.length >= 2)
          teams.command(op('fixture-running'), tx => { tx.writeAttempt({ ...attempt, status: 'running', process: phase === 'helper-reused' ? { ...observed.root!, creationTime: '1' } : observed.root, descendants: observed.identities.filter(p => p.pid !== child.pid), cessation: 'live', version: attempt.version + 1 }, attempt.version); return { acknowledgment: {}, event: {} } })
          write('processes.json', observed.identities)
        } else {
          fs.writeFileSync(path.join(helper.cwd, 'value.txt'), 'helper output\n')
          teams.command(op('fixture-result'), tx => { tx.writeAttempt({ ...attempt, status: 'succeeded', cessation: 'confirmed', endedAt: now(), version: attempt.version + 1 }, attempt.version); const t = tx.snapshot().tasks[0]; tx.writeTask({ ...t, status: 'awaiting-review', version: t.version + 1 }, t.version); return { acknowledgment: {}, event: {} } })
          attempt = teams.attempts(run.id)[0]
          const reservation: TeamCaptureReservation = { runId: run.id, attemptId: attempt.id, captureId: randomUUID(), baseSha: attempt.baseSha!, ref: `refs/chorus/teams/${run.id}/artifacts/${attempt.id}`, authorName: 'Chorus', authorEmail: 'chorus@localhost', at: now() }
          teams.reserveCapture(reservation, attempt.version, randomUUID())
          if (phase !== 'capture-reserved') {
          const objects = await teamCreateArtifactObjects(helper.cwd, reservation)
          const artifact = { id: attempt.id, captureId: reservation.captureId, baseSha: objects.baseSha, finalHelperHead: objects.finalHelperHead, treeSha: objects.treeSha, commitSha: objects.commitSha!, ref: reservation.ref, manifest: objects.manifest, capturedAt: reservation.at }
          teams.recordCaptureObjects(reservation, objects.treeSha, objects.commitSha!, randomUUID(), now(), artifact)
          if (phase !== 'capture-objects') {
          await teamPublishArtifactRef(helper.cwd, reservation, objects.commitSha!)
          if (phase !== 'artifact-ref') teams.publishArtifact(run.id, artifact, attempt.version, randomUUID(), now())
          if (phase === 'unknown-ref') git('update-ref', `refs/chorus/teams/${run.id}/unowned/fixture`, objects.commitSha!)
          if (phase === 'prepared-ref') {
            let integration = { ...teamFixtureIntegration(), id: randomUUID(), preparationId: randomUUID(), attemptId: attempt.id, artifactSha: artifact.commitSha, expectedHead: run.integrationHead!, resultSha: null as string | null, stagingWorktreeId: null as string | null, status: 'preparing' as const, preparedReviewId: null }
            teams.command(op('fixture-prepare-intent'), tx => { tx.writeIntegration(integration); const t = tx.snapshot().tasks[0]; tx.writeTask({ ...t, status: 'integrating', version: t.version + 1 }, t.version); return { acknowledgment: {}, event: {} } })
            const requestId = randomUUID()
            const staging = await new GitWorktreeManager(storage).createManagedWorktree({ projectId: project.id, repoRoot: source, baseSha: integration.expectedHead, signal: new AbortController().signal, assertAuthorized() {}, reserve: row => teams.reserveWorkspace({ ...op('workspace-reserved'), clientRequestId: requestId }, { kind: 'integration', id: integration.id, worktreeId: row.id, expectedVersion: integration.version }) })
            teams.completeWorkspace({ ...op('workspace-completed'), clientRequestId: requestId }, { worktreeId: staging.id, head: integration.expectedHead })
            integration = teams.integrations(run.id)[0] as typeof integration
            const prepared = await teamPrepareIntegrationObjects(staging.path, integration, attempt.baseSha!, () => {}); assert.equal(prepared.status, 'prepared')
            if (prepared.status !== 'prepared') throw Error('Unexpected fixture conflict')
            const intended = { ...integration, resultSha: prepared.resultSha, version: integration.version + 1 }
            teams.command(op('integration-objects'), tx => { tx.writeIntegration(intended, integration.version); return { acknowledgment: {}, event: { integrationId: integration.id, treeSha: prepared.treeSha, resultSha: prepared.resultSha, ref: teamIntegrationRef(integration) } } })
            await teamPublishIntegrationRef(staging.path, intended)
          }
          if (phase.startsWith('applying-') || phase === 'approval-accepted') {
            const actor = { role: 'lead' as const, runId: run.id, generation: 1, epoch: 'fixture' }
            await workspace.review(run, { clientRequestId: randomUUID(), taskId: task.id, attemptId: attempt.id, phase: 'artifact', reviewedSha: artifact.commitSha, decision: 'accept', explanation: 'Exact fixture artifact inspected.', tests: [] }, actor)
            await workspace.integrate(run, { action: 'prepare', clientRequestId: randomUUID(), taskId: task.id, attemptId: attempt.id, reviewedHead: artifact.commitSha, expectedIntegrationHead: run.integrationHead! }, actor); await workspace.settle()
            const integration = teams.integrations(run.id)[0]; assert.equal(integration.status, 'prepared')
            if (phase === 'approval-accepted') {
              await workspace.review(run, { clientRequestId: randomUUID(), taskId: task.id, attemptId: attempt.id, phase: 'prepared', integrationId: integration.id, reviewedSha: integration.resultSha!, decision: 'accept', explanation: 'Prepared fixture tree inspected.', tests: [] }, actor)
              const pending = teams.integrations(run.id)[0]
              await workspace.decideIntegration(run, { runId: run.id, integrationId: pending.id, expectedVersion: pending.version, clientRequestId: randomUUID(), decision: 'approve' }, { role: 'user', principal: 'recovery-fixture' })
            } else {
            const journal = () => teams.command(op('integration-applying'), tx => { tx.writeIntegration({ ...integration, status: 'applying', version: integration.version + 1 }, integration.version); const t = tx.snapshot().tasks[0]; tx.writeTask({ ...t, status: 'integrating', version: t.version + 1 }, t.version); return { acknowledgment: {}, event: { integrationId: integration.id, expectedHead: integration.expectedHead, resultSha: integration.resultSha } } })
            const wt = storage.getWorktreeById(run.integrationWorktreeId!)!
            if (phase === 'applying-result') await teamPromoteIntegration(wt.path, wt.branch, integration.expectedHead, integration.resultSha!, journal)
            else journal()
            }
          }
          }
          }
        }
        }
      }
    }
    write('before.json', teams.snapshot(run.id)); write('refs-before.json', await teamListPrivateRefs(source, run.id))
    if (phase === 'corrupt') { const raw = new Database(database); raw.prepare('UPDATE team_runs SET record_json=? WHERE id=?').run('{corrupt', run.id); raw.close() }
    // Abrupt process termination after durable writes, without runtime/storage shutdown.
    app.exit(73); return
  }
  let assertions = 0, decrypts = 0, launches = 0, memories = 0
  const check = (fn: () => void) => { fn(); assertions++ }
  const storage = new StorageService(database), teams = storage.createTeamStorage(), sessions = new SessionManager(); sessions.bindStorage(storage)
  sessions.launch = (() => { launches++; throw Error('Boot attempted a process launch') }) as typeof sessions.launch
  const vault = { decryptForLaunch: async () => { decrypts++; throw Error('Boot attempted credential resolution') } } as unknown as CredentialVault
  const runtime = new TeamRuntime({ storage, sessions, vault, worktrees: new GitWorktreeManager(storage), configDirectory: path.join(evidence, 'config'), bridgeScript: path.resolve('resources/teamBridge.cjs'), memory: async () => { memories++; return { servers: [] } } })
  const before = JSON.parse(fs.readFileSync(path.join(evidence, 'before.json'), 'utf8')), runId = before.run.id
  const nativeInspect = windowsHelperPlatform.inspect
  if (phase === 'helper-unknown') windowsHelperPlatform.inspect = async () => { throw Error('Injected native process-information access denial') }
  await runtime.start(); await runtime.restorePaused()
  check(() => assert.equal(decrypts + launches + memories, 0))
  check(() => assert.equal((runtime as unknown as { leases: Map<string, unknown> }).leases.size, 0))
  if (phase === 'corrupt') {
    check(() => assert.equal(runtime.service.getRestoreBlockers()[0].runId, runId))
    check(() => assert.throws(() => runtime.service.getSnapshot(runId), /unavailable/))
  } else {
    let snapshot = teams.snapshot(runId)
    check(() => assert.equal(snapshot.run.status, ['reserved', 'unknown-ref', 'helper-reused', 'helper-unknown', 'missing-workspace', 'capture-reserved', 'capture-objects'].includes(phase) ? 'blocked' : 'paused'))
    check(() => assert.equal(snapshot.run.generation, 2))
    check(() => assert.equal(snapshot.attempts.length, before.attempts.length))
    check(() => assert.equal(snapshot.tasks.length, before.tasks.length))
    if (phase === 'helper-running') {
      const attempt = snapshot.attempts[0]
      check(() => assert.equal(attempt.status, 'interrupted')); check(() => assert.equal(attempt.cessation, 'confirmed'))
      const observed = await windowsHelperPlatform.inspect(attempt.process!.pid, [attempt.process!, ...attempt.descendants])
      check(() => assert.equal(observed.identities.length, 0)); check(() => assert.equal(snapshot.tasks[0].attemptCount, 1))
    }
    if (phase === 'helper-reused' || phase === 'helper-unknown') {
      const identities = JSON.parse(fs.readFileSync(path.join(evidence, 'processes.json'), 'utf8'))
      const observed = await nativeInspect(identities[0].pid, identities)
      check(() => assert.ok(observed.identities.length >= 2, 'Recovery must not signal an identity mismatch'))
      check(() => assert.equal(snapshot.attempts[0].cessation, 'unknown'))
    }
    if (phase === 'lead-unready') {
      const identities = JSON.parse(fs.readFileSync(path.join(evidence, 'processes.json'), 'utf8'))
      const observed = await nativeInspect(identities[0].pid, identities)
      check(() => assert.equal(observed.identities.length, 0))
      check(() => assert.equal(snapshot.run.leadSessionId, before.run.leadSessionId))
    }
    if (phase === 'attempt-reserved') { check(() => assert.equal(snapshot.attempts[0].status, 'interrupted')); check(() => assert.equal(snapshot.tasks[0].attemptCount, 1)); check(() => assert.equal(snapshot.attempts[0].worktreeId, null)) }
    if (phase.startsWith('capture-')) {
      check(() => assert.equal(snapshot.attempts[0].artifact, null)); check(() => assert.match(snapshot.run.blocker!, /Capture|Artifact/))
      check(() => assert.equal(fs.readFileSync(path.join(storage.getWorktreeById(snapshot.attempts[0].worktreeId!)!.path, 'value.txt'), 'utf8'), 'helper output\n'))
      if (phase === 'capture-objects') {
        const commit = snapshot.events.find(e => e.operation === 'capture-objects')!.payload.commitSha as string
        check(() => assert.equal(execFileSync('git', ['-C', source, 'cat-file', '-t', commit], { windowsHide: true, encoding: 'utf8' }).trim(), 'commit'))
      }
    }
    if (phase === 'approval-accepted') { check(() => assert.equal(snapshot.integrations[0].status, 'approved')); check(() => assert.deepEqual(snapshot.integrations[0].approval, before.integrations[0].approval)); check(() => assert.equal(snapshot.run.integrationHead, before.run.integrationHead)) }
    if (phase.startsWith('credential-')) {
      const member = snapshot.run.config.helpers[0]
      check(() => assert.deepEqual(snapshot.run.config, before.run.config))
      if (phase === 'credential-deleted') check(() => assert.equal(storage.getCredentialProfileById(member.credentialProfileId!), null))
      if (phase === 'credential-rotated') check(() => assert.equal(storage.getCredentialProfileById(member.credentialProfileId!)!.fingerprintHash, 'fixture-after-rotation'))
      if (phase === 'credential-route') check(() => assert.equal(storage.getProviderConfigById(member.providerId!)!.baseUrl, 'https://changed.invalid/api/v1'))
    }
    if (phase === 'dirty') {
      check(() => assert.match(snapshot.run.blocker!, /Recover/))
      check(() => assert.equal(fs.readFileSync(path.join(storage.getWorktreeById(snapshot.run.integrationWorktreeId!)!.path, 'retained.txt'), 'utf8'), 'Uncommitted lead work must survive.\n'))
    }
    if (phase === 'artifact-ref') check(() => assert.ok(snapshot.attempts[0].artifact))
    if (phase === 'workspace-intent') { check(() => assert.ok(snapshot.run.baseSha)); check(() => assert.equal(snapshot.run.integrationHead, snapshot.run.baseSha)); check(() => assert.equal(teams.unfinishedOperations(runId).length, 0)) }
    if (phase === 'prepared-ref') { check(() => assert.equal(snapshot.integrations[0].status, 'prepared')); check(() => assert.equal(snapshot.tasks[0].status, 'awaiting-review')); check(() => assert.ok(snapshot.events.find(e => e.operation === 'integration-prepared' && e.payload.recovered))) }
    if (phase.startsWith('applying-')) {
      check(() => assert.equal(snapshot.integrations[0].status, phase === 'applying-result' ? 'applied' : 'interrupted'))
      check(() => assert.equal(snapshot.tasks[0].status, 'awaiting-review'))
      const wt = storage.getWorktreeById(snapshot.run.integrationWorktreeId!)!
      check(() => assert.equal(awaitableHead(wt.path), phase === 'applying-result' ? snapshot.integrations[0].resultSha : snapshot.integrations[0].expectedHead))
    }
    const stable = JSON.stringify(snapshot)
    await runtime.restorePaused(); snapshot = teams.snapshot(runId)
    check(() => assert.equal(JSON.stringify(snapshot), stable))
    write('after.json', snapshot)
  }
  check(() => assert.deepEqual(awaitableRefs(source, runId), JSON.parse(fs.readFileSync(path.join(evidence, 'refs-before.json'), 'utf8'))))
  check(() => assert.equal(fs.readFileSync(path.join(source, 'value.txt'), 'utf8'), 'base\n'))
  check(() => assert.equal(decrypts + launches + memories, 0))
  windowsHelperPlatform.inspect = nativeInspect
  if (phase.startsWith('credential-')) {
    const snapshot = teams.snapshot(runId)
    const command = { runId, action: 'resume', expectedVersion: snapshot.run.version, clientRequestId: 'explicit-credential-resume' }
    if (phase === 'credential-rotated') {
      // Isolate the final lead spawn boundary; keep real native compatibility,
      // provider/profile validation and generation-scoped lease construction.
      let resumedLease: TeamLease | undefined
      ;(runtime as unknown as { launchLead(run: TeamRun, lease: TeamLease): Promise<{sessionId: string}> }).launchLead = async (_run, lease) => { resumedLease = lease; return { sessionId: randomUUID() } }
      await runtime.service.lifecycle(command, { role: 'user', principal: 'recovery-verifier' })
      check(() => assert.equal(teams.getRun(runId).generation, 3))
      check(() => assert.equal(resumedLease?.credentials[0].fingerprint, 'fixture-after-rotation'))
      check(() => assert.equal(resumedLease?.credentials[0].credentialId, snapshot.run.config.helpers[0].credentialProfileId))
      check(() => assert.equal(resumedLease?.mode, 'normal'))
    } else {
      await assert.rejects(runtime.service.lifecycle(command, { role: 'user', principal: 'recovery-verifier' }), (error: {code?: string}) => error.code === (phase === 'credential-deleted' ? 'CREDENTIAL_UNAVAILABLE' : 'UNVERIFIED_COMBINATION')); assertions++
      check(() => assert.equal(teams.getRun(runId).generation, 2))
      check(() => assert.equal((runtime as unknown as { leases: Map<string, unknown> }).leases.size, 0))
      check(() => assert.equal(teams.getRun(runId).status, 'paused'))
    }
    check(() => assert.equal(decrypts + launches + memories, 0))
    write('explicit-resume.json', { mutation: phase, refused: phase !== 'credential-rotated', generation: teams.getRun(runId).generation, actualProcessLaunches: launches, decrypts, finalLeadSpawnBoundaryStubbed: phase === 'credential-rotated' })
  }
  if (phase === 'helper-reused' || phase === 'helper-unknown') { const identities = JSON.parse(fs.readFileSync(path.join(evidence, 'processes.json'), 'utf8')); try { await windowsHelperPlatform.stop(identities) } catch { /* Fixture cleanup races descendant exit. */ }; const observed = await windowsHelperPlatform.inspect(identities[0].pid, identities); check(() => assert.equal(observed.identities.length, 0)) }
  // Do not invoke runtime.shutdown: its explicit Stop semantics would alter the boot observations.
  await runtime.bridge.dispose(); sessions.dispose(); storage.close()
  write('report.json', { phase, assertions, passed: true, realProcessRestart: true, at: now() }); app.exit(0)
}).catch(error => { write('failure.json', { message: error.message, stack: error.stack }); app.exit(1) })
function awaitableHead(cwd: string): string { return execFileSync('git', ['-C', cwd, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim() }
function awaitableRefs(cwd: string, runId: string): Array<{ ref: string; sha: string }> { return execFileSync('git', ['-C', cwd, 'for-each-ref', '--format=%(refname) %(objectname)', `refs/chorus/teams/${runId}/`], { encoding: 'utf8', windowsHide: true }).trim().split('\n').filter(Boolean).map(line => { const [ref, sha] = line.trim().split(' '); return { ref, sha } }) }
