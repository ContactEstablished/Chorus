import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import path from 'node:path'
import { StorageService } from '../src/main/services/storage'
import { TeamService, type TeamServiceDependencies } from '../src/main/services/teamService'
import type { HelperProcessOutcome, HelperProcessOptions } from '../src/main/services/helperProcess'
import type { TeamLease } from '../src/main/services/teamCore'
import { teamFixtureRun, teamFixtureTask, teamFixtureIntegration, teamFixtureId as id } from '../src/main/services/teamTestFixtures'
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
async function until(condition: () => boolean) { const deadline = Date.now() + 5000; while (!condition()) { if (Date.now() > deadline) throw Error('Runtime fixture timed out.'); await delay(5) } }

export async function verifyTeamRuntime(evidence: string): Promise<number> {
  let assertions = 0, fixtureNumber = 0
  const check = (fn: () => void) => { fn(); assertions++ }
  async function fixture(api = false, autoActivate = false, custom = false) {
    const number = ++fixtureNumber
    const owner = new StorageService(path.join(evidence, `runtime-${number}.db`)), storage = owner.createTeamStorage()
    let sequence = number * 1000, fingerprint = 'original'
    const config = teamFixtureRun().config
    config.concurrency = 2 // Exercise multiple slots explicitly; the product default is one.
    if (api) config.helpers[0] = { ...config.helpers[0], harness: 'opencode', authMode: 'api_key', providerId: id(90), credentialProfileId: id(91), model: 'z-ai/glm-5.3', effort: null, installedVersion: '1.18.31' }
    if (custom) config.helpers[0] = { ...config.helpers[0], profileId: id(92), customModel: true, model: 'vendor/custom-model', instructions: 'Review accessibility carefully.' }
    const calls = { helper: 0, decrypt: 0, lead: 0, workspace: 0, lease: 0, cancel: 0 }
    const barriers: { decrypt?: ReturnType<typeof deferred<void>>; prepare?: ReturnType<typeof deferred<void>>; validate?: ReturnType<typeof deferred<void>>; identify?: ReturnType<typeof deferred<void>> } = {}
    let preparationFails = false, lease: TeamLease | undefined
    const handles = new Map<string, { finish(success?: boolean, cessation?: 'confirmed' | 'unknown', permissionBlocked?: boolean): void; options: HelperProcessOptions; settled: boolean }>()
    const deps: TeamServiceDependencies = {
      storage, autoActivate, id: () => id(++sequence), validateProject() {}, validateMember: async () => {}, leaseIssued: value => { lease = value; calls.lease++ },
      credentials: {
        inspect: member => member.authMode === 'api_key' ? { credentialId: member.credentialProfileId!, fingerprint, providerId: member.providerId!, authMode: 'api_key', routeIdentity: 'fixture-route' } : undefined,
        resolve: async () => { calls.decrypt++; await barriers.decrypt?.promise; return { value: 'fixture-selected-credential', envVarName: 'OPENROUTER_API_KEY', isSecret: true } },
        route: member => member.authMode === 'api_key' ? { providerKey: 'openrouter', providerName: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', modelId: member.model } : undefined
      },
      workspace: {
        prepareRun: async () => { calls.workspace++; return { baseSha: 'a'.repeat(40), head: 'a'.repeat(40), worktreeId: id(80) } },
        prepareAttempt: async (_run, attempt) => { calls.workspace++; await barriers.prepare?.promise; if (preparationFails) throw Error('Injected preparation failure'); return { cwd: evidence, baseSha: attempt.baseSha!, worktreeId: id(++sequence) } },
        validateResult: async () => { await barriers.validate?.promise },
        inspectRecovery: async () => ({ writersStopped: true, ordinaryDirty: false, ambiguousIntegration: false })
      },
      lead: { launch: async (_run, _lease, authorization) => { authorization.assertAuthorized(); calls.lead++; return { sessionId: id(81) } }, stopped: async () => true, stop: async () => true },
      executor: {
        spawnHelper: (attemptId, options) => {
          options.authorizeSpawn(); calls.helper++
          const done = deferred<HelperProcessOutcome>(), process = { pid: 12345, creationTime: '123456789', executable: 'fixture.exe' }
          const handle = { options, settled: false, finish: (success = true, cessation: 'confirmed' | 'unknown' = 'confirmed', permissionBlocked = false) => {
            if (handle.settled) return; handle.settled = true
            done.resolve({ exitCode: success ? 0 : 1, cessation, result: success ? { type: 'result', summary: 'Fixture result', isError: false } : null, permissionBlocked, protocolError: false, intent: success ? null : 'cancelled', process, descendants: [], usage: [{ inputTokens: 2, outputTokens: 3, cachedTokens: null, costUsd: null, costKind: 'unknown', source: 'fixture' }] })
          } }
          handles.set(attemptId, handle)
          return { identified: (async () => { await barriers.identify?.promise; return process })(), done: done.promise, cancel: async intent => { calls.cancel++; options.onTerminationIntent?.(intent ?? 'cancelled'); handle.finish(false) }, inspect: () => ({ process, descendants: [], cessation: handle.settled ? 'confirmed' : 'live', intent: null }) }
        },
        cancelHelper: async attemptId => { const handle = handles.get(attemptId); if (handle && !handle.settled) { calls.cancel++; handle.options.onTerminationIntent?.('cancelled'); handle.finish(false) } }
      }
    }
    const service = new TeamService(deps)
    const launch = { projectId: id(4), clientRequestId: 'launch-fixture', config }
    const ack = await service.createRun(launch, { role: 'user', principal: 'renderer-fixture' }), runId = String(ack.runId)
    await until(() => service.getSnapshot(runId).run.leadSessionId !== null)
    const actor = () => ({ role: 'lead' as const, runId, generation: lease!.generation, epoch: lease!.epoch })
    service.markBridgeReady(actor())
    const action = async (name: 'activate' | 'pause' | 'resume' | 'stop' | 'recover', request = name) => service.lifecycle({ runId, clientRequestId: request, expectedVersion: service.getSnapshot(runId).run.version, action: name }, { role: 'user', principal: 'renderer-fixture' })
    if (!autoActivate) await action('activate')
    const submit = (request: string, kind: 'code' | 'analysis' = 'code') => service.submitTask(runId, { ...teamFixtureTask().command, clientRequestId: request, paths: [request + ".txt"], kind, memberId: config.helpers[0].id }, actor())
    const close = async () => {
      barriers.decrypt?.resolve(); barriers.prepare?.resolve(); barriers.validate?.resolve(); barriers.identify?.resolve()
      for (const handle of handles.values()) handle.finish(false)
      await delay(30); owner.close()
    }
    return { service, storage, owner, calls, barriers, handles, runId, actor, action, submit, close, deps, launch, ack, rotate: () => { fingerprint = 'rotated' }, failPreparation: () => { preparationFails = true } }
  }
  {
    const f = await fixture(false, true)
    check(() => assert.equal(f.service.getSnapshot(f.runId).run.status, 'active'))
    check(() => assert.equal(f.calls.lead, 1))
    f.service.leadExited(f.runId)
    check(() => assert.equal(f.service.getSnapshot(f.runId).run.status, 'blocked'))
    check(() => assert.throws(() => f.submit('after-lead-exit'), /authorization|lease|active/i))
    await f.close()
  }
  {
    const f = await fixture(), ack = f.submit('retained-approval-wait')
    await until(() => f.calls.helper === 1)
    ;[...f.handles.values()][0].finish()
    await until(() => f.storage.tasks(f.runId).find(t => t.id === ack.taskId)?.status === 'awaiting-review')
    const snapshot = f.service.getSnapshot(f.runId), task = snapshot.tasks.find(t => t.id === ack.taskId)!, attempt = snapshot.attempts[0]
    f.storage.command({ runId: f.runId, generation: snapshot.run.generation, actor: 'system', operation: 'fixture-legacy-wait', eventId: id(900001), now: snapshot.run.updatedAt }, tx => {
      tx.writeIntegration({ ...teamFixtureIntegration(), id: id(900002), preparationId: id(900003), runId: f.runId, taskId: task.id, attemptId: attempt.id, stagingWorktreeId: null, status: 'awaiting-approval' })
      tx.writeTask({ ...task, status: 'awaiting-approval', version: task.version + 1 }, task.version)
      return { acknowledgment: {}, event: {} }
    })
    f.service.retireApprovalGates()
    check(() => assert.equal(f.storage.tasks(f.runId)[0].status, 'awaiting-review'))
    check(() => assert.equal(f.storage.integrations(f.runId)[0].status, 'prepared'))
    check(() => assert.equal(f.storage.integrations(f.runId)[0].approval, null))
    const version = f.storage.getRun(f.runId).version
    f.service.retireApprovalGates()
    check(() => assert.equal(f.storage.getRun(f.runId).version, version))
    check(() => assert.equal(f.calls.helper, 1))
    await f.close()
  }
  {
    const f = await fixture()
    const ack = f.submit('visible-permission-blocker')
    await until(() => f.calls.helper === 1)
    const helper = [...f.handles.values()][0]
    helper.options.onEvent({ type: 'activity', category: 'text', text: 'x'.repeat(100000) })
    helper.options.onEvent({ type: 'permission-blocked', reason: 'Reference folder read denied: external_directory.' })
    check(() => assert.equal(f.storage.tasks(f.runId).find(t => t.id === ack.taskId)?.blocker, 'Reference folder read denied: external_directory.'))
    helper.finish(true, 'confirmed', true)
    await until(() => f.storage.attempts(f.runId)[0].status === 'permission-blocked')
    check(() => assert.equal(f.storage.attempts(f.runId)[0].blocker, 'Reference folder read denied: external_directory.'))
    check(() => assert.equal(f.storage.tasks(f.runId).find(t => t.id === ack.taskId)?.blocker, 'Reference folder read denied: external_directory.'))
    await f.close()
  }
  {
    const f = await fixture()
    check(() => assert.equal(f.calls.lead, 1)); check(() => assert.equal(f.calls.lease, 1))
    const replay = await f.service.createRun(f.launch, { role: 'user', principal: 'renderer' })
    check(() => assert.deepEqual(replay, f.ack)); check(() => assert.equal(f.calls.lead, 1)); check(() => assert.equal(f.calls.lease, 1))
    const a = f.submit('a'), b = f.submit('b'), c = f.submit('c')
    check(() => assert.deepEqual(f.submit('a'), a))
    await until(() => f.calls.helper === 2)
    check(() => assert.equal(f.storage.attempts(f.runId).length, 2)); check(() => assert.equal(f.storage.tasks(f.runId).find(t => t.id === c.taskId)?.status, 'queued'))
    const first = [...f.handles.values()][0]
    first.options.onEvent({ type: 'activity', category: 'tool', text: 'Inspecting the isolated fixture.' })
    first.options.onEvent({ type: 'activity', category: 'text', text: 'x'.repeat(100000) })
    first.finish()
    await until(() => f.calls.helper === 3)
    const activity = f.storage.events(f.runId).filter(e => e.operation === 'helper-activity')
    check(() => assert.equal(activity.length, 1))
    check(() => assert.equal(activity[0].payload.truncated, true))
    check(() => assert.ok(String(activity[0].payload.text).includes('Inspecting the isolated fixture.')))
    check(() => assert.ok(Buffer.byteLength(String(activity[0].payload.text)) <= 65536))
    check(() => assert.equal(f.storage.attempts(f.runId)[0].usage[0].costUsd, null))
    const pauseInput = { runId: f.runId, clientRequestId: 'pause-replay', expectedVersion: f.service.getSnapshot(f.runId).run.version, action: 'pause' }
    const paused = await f.service.lifecycle(pauseInput, { role: 'user', principal: 'renderer' })
    check(() => assert.equal(paused.status, 'pausing'))
    check(() => assert.throws(() => f.submit('denied-while-pausing'), /inspection/))
    for (const h of f.handles.values()) h.finish()
    await until(() => f.service.getSnapshot(f.runId).run.status === 'paused')
    const pauseReplay = await f.service.lifecycle(pauseInput, { role: 'user', principal: 'renderer' })
    check(() => assert.deepEqual(pauseReplay, paused))
    check(() => assert.equal(f.calls.decrypt, 0)); check(() => assert.equal(f.storage.tasks(f.runId).find(t => t.id === b.taskId)?.status, 'awaiting-review'))
    await f.close()
  }
  {
    const f = await fixture(true); f.barriers.decrypt = deferred<void>(); f.submit('decrypt-pause')
    await until(() => f.calls.decrypt === 1)
    await f.action('pause'); f.barriers.decrypt.resolve()
    await until(() => f.service.getSnapshot(f.runId).run.status === 'paused')
    check(() => assert.equal(f.calls.helper, 0)); check(() => assert.equal(f.calls.decrypt, 1)); check(() => assert.equal(f.storage.attempts(f.runId)[0].status, 'failed'))
    await f.close()
  }
  {
    const f = await fixture(true); f.barriers.decrypt = deferred<void>(); f.submit('decrypt-rotation')
    await until(() => f.calls.decrypt === 1); f.rotate(); f.barriers.decrypt.resolve()
    await until(() => f.storage.attempts(f.runId)[0]?.status === 'failed')
    check(() => assert.equal(f.calls.helper, 0)); check(() => assert.equal(f.storage.tasks(f.runId)[0].attemptCount, 1))
    await f.close()
  }
  {
    const f = await fixture(); f.barriers.prepare = deferred<void>(); const ack = f.submit('cancel-preparation')
    await until(() => f.storage.attempts(f.runId).length === 1)
    f.service.cancelTask(f.runId, { clientRequestId: 'cancel-request', taskId: ack.taskId, reason: 'Fixture cancellation' }, f.actor())
    f.barriers.prepare.resolve(); await until(() => f.storage.attempts(f.runId)[0].status === 'cancelled')
    check(() => assert.equal(f.calls.helper, 0)); check(() => assert.equal(f.storage.tasks(f.runId)[0].status, 'cancelled'))
    await f.close()
  }
  {
    const f = await fixture(); f.barriers.validate = deferred<void>(); const ack = f.submit('validation-fence', 'analysis')
    await until(() => f.calls.helper === 1); [...f.handles.values()][0].finish()
    await until(() => f.storage.attempts(f.runId)[0].status === 'succeeded')
    const attemptId = f.storage.attempts(f.runId)[0].id
    const review = { clientRequestId: 'analysis-review', taskId: ack.taskId, attemptId, phase: 'artifact', decision: 'accept', explanation: 'Independent analysis verified.', tests: [] }
    await assert.rejects(f.service.review(f.runId, review, f.actor()), /validated/); assertions++
    f.barriers.validate.resolve(); await until(() => f.storage.tasks(f.runId)[0].status === 'awaiting-review')
    const reviewed = await f.service.review(f.runId, review, f.actor())
    check(() => assert.equal(f.storage.tasks(f.runId)[0].status, 'completed'))
    check(() => assert.ok(reviewed.decisionId))
    check(() => assert.deepEqual(f.storage.attempts(f.runId)[0].usage.map(u => u.costUsd), [null]))
    await f.close()
  }
  {
    const f = await fixture(); f.failPreparation(); const ack = f.submit('three-attempts')
    await until(() => f.storage.attempts(f.runId).length === 1 && f.storage.tasks(f.runId)[0].status === 'failed')
    for (let number = 2; number <= 3; number++) {
      f.service.revise(f.runId, { clientRequestId: `revision-${number}`, taskId: ack.taskId, memberId: id(3), brief: 'Retry explicit fixture preparation.' }, f.actor())
      await until(() => f.storage.attempts(f.runId).length === number && f.storage.tasks(f.runId)[0].status === 'failed')
    }
    check(() => assert.equal(f.storage.tasks(f.runId)[0].attemptCount, 3))
    check(() => assert.throws(() => f.service.revise(f.runId, { clientRequestId: 'revision-four', taskId: ack.taskId, memberId: id(3), brief: 'One more' }, f.actor()), /exhausted/))
    check(() => assert.equal(f.calls.helper, 0)); await f.close()
  }
  {
    const f = await fixture(); f.submit('stop-one'); f.submit('stop-two'); f.submit('stop-queued')
    await until(() => f.calls.helper === 2)
    await f.action('stop'); await until(() => f.service.getSnapshot(f.runId).run.status === 'stopped')
    check(() => assert.equal(f.calls.helper, 2)); check(() => assert.equal(f.calls.cancel, 2)); check(() => assert.ok(f.storage.tasks(f.runId).every(t => t.status === 'cancelled')))
    await f.close()
  }
  {
    const f = await fixture(); f.barriers.identify = deferred<void>(); f.submit('post-spawn-pause')
    await until(() => f.calls.helper === 1)
    await f.action('pause'); f.barriers.identify.resolve()
    await until(() => f.service.getSnapshot(f.runId).run.status === 'paused')
    check(() => assert.equal(f.calls.cancel, 1)); check(() => assert.equal(f.storage.attempts(f.runId)[0].status, 'cancelled'))
    check(() => assert.ok(f.storage.events(f.runId).some(e => e.operation === 'termination-intent')))
    await f.close()
  }
  {
    const f = await fixture(true); await f.action('pause')
    f.deps.workspace.inspectRecovery = async () => ({ writersStopped: true, ordinaryDirty: true, ambiguousIntegration: false })
    await f.action('recover'); await until(() => f.calls.lead === 2 && f.storage.getRun(f.runId).leadSessionId !== null)
    f.service.markBridgeReady(f.actor())
    check(() => assert.equal(f.storage.getRun(f.runId).generation, 2)); check(() => assert.equal(f.storage.getRun(f.runId).status, 'recovering'))
    check(() => assert.throws(() => f.submit('recovery-cannot-delegate'), /inspection/))
    check(() => assert.equal(f.calls.helper, 0)); check(() => assert.equal(f.calls.decrypt, 0))
    const before = f.actor()
    await assert.rejects(f.action('resume'), /clean, unambiguous/); assertions++
    f.deps.workspace.inspectRecovery = async () => ({ writersStopped: true, ordinaryDirty: false, ambiguousIntegration: false })
    await f.action('resume'); await until(() => f.calls.lead === 3)
    check(() => assert.equal(f.storage.getRun(f.runId).generation, 3))
    check(() => assert.throws(() => f.service.authorizeLead(before, 'team_status'), /stale/))
    check(() => assert.equal(f.storage.getRun(f.runId).leadSessionId, id(81)))
    await f.close()
  }
  {
    const f = await fixture(); f.submit('shutdown-active'); f.submit('shutdown-active-two'); f.submit('shutdown-queued')
    await until(() => f.calls.helper === 2)
    const result = await f.service.shutdown()
    check(() => assert.equal(result.complete, true)); check(() => assert.deepEqual(result.blockedRunIds, [])); check(() => assert.equal(f.storage.getRun(f.runId).status, 'stopped'))
    await assert.rejects(f.service.createRun({ ...f.launch, clientRequestId: 'after-quit' }, { role: 'user', principal: 'renderer' }), /shutdown/); assertions++
    await f.close()
  }
  {
    const f = await fixture(), validation = deferred<void>()
    f.deps.workspace.validateResult = async () => { await validation.promise; throw Error('Late invalid result') }
    const ack = f.submit('cancel-during-validation')
    await until(() => f.calls.helper === 1); [...f.handles.values()][0].finish()
    await until(() => f.storage.attempts(f.runId)[0].status === 'succeeded')
    f.service.cancelTask(f.runId, { clientRequestId: 'cancel-validation', taskId: ack.taskId, reason: 'Cancel before review' }, f.actor())
    validation.resolve(); await delay(30)
    check(() => assert.equal(f.storage.tasks(f.runId)[0].status, 'cancelled'))
    check(() => assert.equal(f.storage.events(f.runId).filter(e => e.operation === 'result-validation-failed').length, 0))
    await f.close()
  }
  {
    const f = await fixture(), validation = deferred<void>(), before = { ...f.calls }
    f.deps.validateMember = async () => { await validation.promise }
    const launch = f.service.createRun({ ...f.launch, clientRequestId: 'racing-shutdown' }, { role: 'user', principal: 'renderer' })
    await f.service.shutdown(); validation.resolve()
    await assert.rejects(launch, /shutdown/); assertions++
    check(() => assert.equal(f.storage.listRunIds().length, 1))
    check(() => assert.equal(f.calls.lead, before.lead)); check(() => assert.equal(f.calls.lease, before.lease))
    await f.close()
  }
  {
    const f = await fixture(); await f.action('pause')
    const before = { ...f.calls }, restored = new TeamService(f.deps)
    restored.restorePaused()
    check(() => assert.equal(f.calls.helper, before.helper)); check(() => assert.equal(f.calls.decrypt, before.decrypt)); check(() => assert.equal(f.calls.lead, before.lead)); check(() => assert.equal(f.calls.lease, before.lease)); check(() => assert.equal(f.calls.workspace, before.workspace)); check(() => assert.equal(restored.getSnapshot(f.runId).run.status, 'paused'))
    await f.close()
  }
  {
    const f=await fixture();f.submit('durable-process-observations')
    await until(()=>f.storage.attempts(f.runId)[0]?.status==='running')
    const handle=[...f.handles.values()][0],process=f.storage.attempts(f.runId)[0].process!,descendant={pid:23456,creationTime:'123456790',executable:'fixture-child.exe'}
    handle.options.onProcessObservation!(process,[descendant])
    check(()=>assert.deepEqual(f.owner.createTeamStorage().attempts(f.runId)[0].descendants,[descendant]))
    handle.options.onProcessObservation!(process,[])
    check(()=>assert.deepEqual(f.storage.attempts(f.runId)[0].descendants,[]))
    check(()=>assert.deepEqual(f.storage.events(f.runId).filter(e=>e.operation==='helper-process-observed').at(-1)!.payload.retired,[descendant]))
    check(()=>assert.throws(()=>handle.options.onProcessObservation!({...process,creationTime:'999'},[]),/root identity cannot change/))
    check(()=>assert.deepEqual(f.storage.attempts(f.runId)[0].process,process))
    await f.close()
  }
  for (const action of ['pause', 'stop'] as const) {
    const f = await fixture(); f.submit(`late-cessation-${action}`)
    await until(() => f.calls.helper === 1)
    const handle = [...f.handles.values()][0]
    handle.finish(true, 'unknown')
    await until(() => f.storage.attempts(f.runId)[0].status === 'failed')
    const terminalAt = f.storage.attempts(f.runId)[0].endedAt
    f.deps.executor.cancelHelper = async () => { handle.options.onTerminationIntent?.('cancelled') }
    await f.action(action)
    check(() => assert.equal(f.storage.getRun(f.runId).status, action === 'pause' ? 'pausing' : 'stopping'))
    handle.options.onCessationConfirmed!()
    await until(() => f.storage.getRun(f.runId).status === (action === 'pause' ? 'paused' : 'stopped'))
    handle.options.onCessationConfirmed!()
    const attempt = f.storage.attempts(f.runId)[0], task = f.storage.tasks(f.runId)[0]
    check(() => assert.equal(attempt.cessation, 'confirmed'))
    check(() => assert.equal(attempt.status, 'failed'))
    check(() => assert.equal(task.status, 'blocked'))
    check(() => assert.equal(task.attemptCount, 1))
    check(() => assert.equal(attempt.artifact, null))
    check(() => assert.equal(attempt.endedAt, terminalAt))
    check(() => assert.equal(f.storage.events(f.runId).filter(e => e.operation === 'helper-retirement-intent').length, action === 'stop' ? 1 : 0))
    check(() => assert.equal(f.storage.events(f.runId).filter(e => e.operation === 'helper-cessation-confirmed').length, 1))
    await f.close()
  }
  {
    const f = await fixture(true, true, true)
    f.submit('custom-model-dispatch', 'analysis')
    await until(() => f.calls.helper === 1)
    check(() => assert.equal(f.calls.decrypt, 1))
    check(() => assert.equal(f.storage.getRun(f.runId).config.helpers[0].model, 'vendor/custom-model'))
    const handle = [...f.handles.values()][0]
    check(() => assert(JSON.stringify(handle.options).includes('openrouter/vendor/custom-model')))
    check(() => assert(JSON.stringify(handle.options).includes('Review accessibility carefully.')))
    handle.finish(); await until(() => f.storage.attempts(f.runId)[0].status === 'succeeded')
    check(() => assert.equal(f.storage.attempts(f.runId)[0].result?.isError, false))
    await f.close()
  }
  {
    const f = await fixture()
    try {
      f.barriers.prepare = deferred<void>()
      const makeTask = (n: number) => ({ ...teamFixtureTask(n).command, clientRequestId: `batch-task-${n}`, kind: 'analysis' as const, references: ['SPEC.md'] })
      const batch = { clientRequestId: 'batch-delegation', tasks: [makeTask(10), makeTask(11)] }
      f.deps.workspace.preflight = async (_run, task) => { if (task.references?.includes('missing.md')) throw Error('Missing committed reference') }
      await assert.rejects(f.service.dispatch(f.actor(), 'team_delegate_many', { ...batch, tasks: [batch.tasks[0], { ...batch.tasks[1], references: ['missing.md'] }] }, new AbortController().signal), /Missing committed/); assertions++
      check(() => assert.equal(f.storage.tasks(f.runId).length, 0))
      check(() => assert.equal(f.calls.helper, 0))
      const ack: any = await f.service.dispatch(f.actor(), 'team_delegate_many', batch, new AbortController().signal)
      check(() => assert.equal(ack.tasks.length, 2))
      check(() => assert.equal(f.storage.tasks(f.runId).length, 2))
      const again = await f.service.dispatch(f.actor(), 'team_delegate_many', batch, new AbortController().signal)
      check(() => assert.deepEqual(again, ack))
      check(() => assert.equal(f.storage.tasks(f.runId).length, 2))
      const ids = ack.tasks.map((task: any) => task.taskId)
      const before: any = await f.service.dispatch(f.actor(), 'team_status', {}, new AbortController().signal)
      const quiet: any = await f.service.dispatch(f.actor(), 'team_wait', { target: 'results', taskIds: ids, afterSequence: before.lastSequence, timeoutMs: 30 }, new AbortController().signal)
      check(() => assert.equal(quiet.wakeReason, 'timeout'))
      f.barriers.prepare.resolve()
      await until(() => f.calls.helper === 2)
      check(() => assert([...f.handles.values()].every(h => h.options.request.stdin.includes('read these before implementation'))))
      let returned = false
      const pending = f.service.dispatch(f.actor(), 'team_wait', { target: 'results', taskIds: ids, afterSequence: quiet.lastSequence, timeoutMs: 2000 }, new AbortController().signal).then(result => { returned = true; return result as any })
      await delay(30)
      check(() => assert.equal(returned, false))
      for (const handle of f.handles.values()) handle.finish()
      const ready = await pending
      check(() => assert.equal(ready.wakeReason, 'ready'))
      await until(() => f.storage.tasks(f.runId).every(t => t.status === 'awaiting-review'))
      const reviews = f.storage.tasks(f.runId).map((task, i) => ({ clientRequestId: `batch-review-${i}`, taskId: task.id, attemptId: task.currentAttemptId, phase: 'artifact', decision: 'accept', explanation: 'Read the helper analysis against its acceptance criteria.' }))
      await assert.rejects(f.service.dispatch(f.actor(), 'team_review_many', { clientRequestId: 'reviews-invalid', reviews: [reviews[0], { ...reviews[1], attemptId: id(999999) }] }, new AbortController().signal), /current stopped/); assertions++
      check(() => assert(f.storage.tasks(f.runId).every(t => t.status === 'awaiting-review')))
      const reviewed = await f.service.dispatch(f.actor(), 'team_review_many', { clientRequestId: 'reviews', reviews }, new AbortController().signal)
      check(() => assert(f.storage.tasks(f.runId).every(t => t.status === 'completed')))
      check(() => assert.equal(f.storage.events(f.runId).filter(e => e.operation === 'review').length, 2))
      const reviewedAgain = await f.service.dispatch(f.actor(), 'team_review_many', { clientRequestId: 'reviews', reviews }, new AbortController().signal)
      check(() => assert.deepEqual(reviewedAgain, reviewed))
      check(() => assert.equal(f.storage.events(f.runId).filter(e => e.operation === 'review').length, 2))
      const selectedChecks = [id(999991), id(999992)]
      for (const verificationId of [...selectedChecks, ...Array.from({ length: 65 }, (_, n) => id(999000 + n))]) {
        f.storage.command({ runId: f.runId, generation: f.storage.getRun(f.runId).generation, operation: 'verification-queued', actor: 'system', eventId: randomUUID(), now: new Date().toISOString() }, () => ({ acknowledgment: {}, event: { verificationId, command: 'npm test' } }))
      }
      const waitingChecks: any = await f.service.dispatch(f.actor(), 'team_wait', { target: 'checks', verificationIds: selectedChecks, timeoutMs: 30 }, new AbortController().signal)
      check(() => assert.equal(waitingChecks.wakeReason, 'timeout'))
      check(() => assert.deepEqual(waitingChecks.checks.map((c: any) => c.id).sort(), [...selectedChecks].sort()))
      check(() => assert(waitingChecks.checks.every((c: any) => c.status === 'queued')))
      await assert.rejects(f.service.dispatch(f.actor(), 'team_wait', { target: 'checks', verificationIds: [id(999999)], timeoutMs: 0 }, new AbortController().signal), /does not belong/); assertions++
      const controller = new AbortController()
      const cancelled = f.service.dispatch(f.actor(), 'team_wait', { target: 'finish', timeoutMs: 2000 }, controller.signal)
      controller.abort()
      const cancelledResult = await cancelled as any
      check(() => assert.equal(cancelledResult.wakeReason, 'cancelled'))
    } finally { await f.close() }
  }
  return assertions
}
